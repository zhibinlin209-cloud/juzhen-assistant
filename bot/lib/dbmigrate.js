/* 飞书 → 本地库：一次性迁移 + 逐店核对 + 可归档统计
 * · 迁移可重复跑（按主键 upsert，不会产生重复行）；只在第一次启动后延迟执行，绝不阻塞启动
 * · 核对（/lib/dbcheck）：每家店在飞书和数据库里的行数、日期范围、总营业额合计，逐店对比
 * · 可归档（/lib/archivable）：数据库里已有、核对一致、日期早于 N 天的飞书行 —— 只统计，不删除
 */
'use strict';
const DAY = 864e5, TZ = 8 * 3600e3;
const v = x => Array.isArray(x) ? x.map(y => (y && y.text) || y || '').join('') : (x === null || x === undefined ? '' : (typeof x === 'object' ? (x.text || x.name || '') : String(x)));
const n = x => { const k = typeof x === 'number' ? x : parseFloat(String(v(x)).replace(/[,¥￥%\s]/g, '')); return isFinite(k) ? k : null; };
const bjDay = ts => typeof ts === 'number' ? Math.floor((ts + TZ) / DAY) : null;
const dayStr = ts => ts === null ? '' : new Date(ts * DAY).toISOString().slice(0, 10);
const r2 = x => Math.round(x * 100) / 100;

function createDbMigrate({ cfg, api, core, store, log }) {
  const dailyName = () => cfg.dailyTable || '经营日报数据';
  const TGT = '推广通数据';

  async function tableId(app, name) {
    const t = ((await api.call('GET', `/bitable/v1/apps/${app}/tables`, null, { page_size: 100 })).items || []).find(x => x.name === name);
    if (!t) throw new Error('没找到表：' + name);
    return t.table_id;
  }
  // 全量拉一张表（每页 500，飞书限流时由 api.call 自己重试）
  async function pull(name) {
    const app = await core.dailyAppToken(); const tid = await tableId(app, name);
    const out = []; let pt = '';
    do {
      const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${tid}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {}));
      out.push(...(d.items || []).map(r => r.fields || {})); pt = d.has_more ? d.page_token : '';
    } while (pt);
    return out;
  }

  // 逐店统计：行数、最早/最晚日期（按北京时间的「天」算）、营业额合计
  function stat(list, storeOf) {
    // 和库的口径一致：门店为空的行不算（库里本来就写不进去）；同店同日多行只算最后一行（库里按主键合并成一行）
    const last = new Map();
    list.forEach(f => {
      const s = String(storeOf ? storeOf(f) : v(f['门店'])).trim();
      const d = bjDay(n(f['日期']));
      if (d === null || !s) return;
      last.set(s + '|' + d, { s, d, sum: n(f['总营业额']) || 0 });
    });
    const S = {};
    for (const { s, d, sum } of last.values()) {
      const o = S[s] = S[s] || { n: 0, min: d, max: d, sum: 0 };
      o.n++; o.min = Math.min(o.min, d); o.max = Math.max(o.max, d); o.sum += sum;
    }
    const out = {};
    Object.entries(S).forEach(([s, o]) => { out[s] = { rows: o.n, from: dayStr(o.min), to: dayStr(o.max), sum: r2(o.sum) }; });
    return out;
  }

  async function migrate({ force } = {}) {
    if (!store.ok) return { ok: false, skipped: '没有可用的数据库（' + store.error + '）' };
    const at = store.meta('migrate.at');
    if (at && !force) return { ok: true, skipped: '之前已经迁移过（' + new Date(+at).toISOString() + '）' };
    const t0 = Date.now();
    const D = await pull(dailyName());
    const nD = store.upsertDailys(D);
    let T = [], nT = 0;
    try { T = await pull(TGT); nT = store.upsertTgts(T); } catch (e) { log('[数据库] 推广通表拉取失败（不影响日报）：' + e.message); }
    store.meta('migrate.at', Date.now());
    log(`[数据库] 迁移完成：日报 ${D.length} 条（写入 ${nD}）、推广通 ${T.length} 条（写入 ${nT}），耗时 ${Math.round((Date.now() - t0) / 1000)} 秒`);
    const ck = await check().catch(e => ({ error: e.message }));
    log('[数据库] 迁移核对：' + plain(ck) + (ck.ok ? '。之后日报、推广通改从数据库读' : '。核对没通过，继续从飞书读，等人工处理'));
    return { ok: true, daily: { feishu: D.length, db: nD }, tgt: { feishu: T.length, db: nT }, at: Date.now(), check: ck };
  }

  const cmp = (a, b) => (!a && !b) ? true : !!(a && b && a.rows === b.rows && a.from === b.from && a.to === b.to && Math.abs(a.sum - b.sum) <= 1);

  async function check() {
    const out = { ok: true, db: { ok: store.ok, kind: store.kind, file: store.file }, at: Date.now(), daily: {}, tgt: {} };
    const F = await pull(dailyName());
    const fs1 = stat(F), db1 = stat(store.queryDaily({}));
    const keys = [...new Set([...Object.keys(fs1), ...Object.keys(db1)])].sort();
    keys.forEach(s => { const a = fs1[s] || { rows: 0, from: '', to: '', sum: 0 }, b = db1[s] || { rows: 0, from: '', to: '', sum: 0 }; const same = cmp(fs1[s], db1[s]); if (!same) out.ok = false; out.daily[s] = { 飞书: a, 数据库: b, 一致: same }; });
    const uniq = (L, k) => new Set(L.map(f => { const a = String(v(f[k[0]]) || '').trim(), d = bjDay(n(f['日期'])); return a && d !== null ? a + '|' + d : null; }).filter(Boolean)).size;
    out.dailyTotal = { 飞书: uniq(F, ['门店']), 飞书原始行: F.length, 数据库: store.count('daily') };
    if (out.dailyTotal.飞书 !== out.dailyTotal.数据库) out.ok = false;
    try {
      const G = await pull(TGT); const fs2 = stat(G), db2 = stat(store.queryTgt({}));
      const k2 = [...new Set([...Object.keys(fs2), ...Object.keys(db2)])].sort();
      k2.forEach(s => { const a = fs2[s] || { rows: 0, from: '', to: '', sum: 0 }, b = db2[s] || { rows: 0, from: '', to: '', sum: 0 }; const same = cmp(fs2[s], db2[s]); if (!same) out.ok = false; out.tgt[s] = { 飞书: a, 数据库: b, 一致: same }; });
      out.tgtTotal = { 飞书: uniq(G, ['门店ID']), 飞书原始行: G.length, 数据库: store.count('tgt') };
      if (out.tgtTotal.飞书 !== out.tgtTotal.数据库) out.ok = false;
    } catch (e) { out.tgtError = e.message; }
    // 判定口径（逐行）：飞书里有的每一行，库里都要有、而且金额一致；库里多出来的（飞书已删/已归档的老数据）允许
    const keyed = (L, kf, vf) => { const m = new Map(); L.forEach(f => { const a = String(v(f[kf]) || '').trim(), d = bjDay(n(f['日期'])); if (a && d !== null) m.set(a + '|' + d, n(f[vf]) || 0); }); return m; };
    const lineCheck = (fsL, dbL, kf, vf) => { const A = keyed(fsL, kf, vf), B = keyed(dbL, kf, vf); let miss = 0, diff = 0; const eg = []; for (const [k, x] of A) { if (!B.has(k)) { miss++; if (eg.length < 5) eg.push('库里缺 ' + k); } else if (Math.abs(B.get(k) - x) > 1) { diff++; if (eg.length < 5) eg.push('金额不同 ' + k); } } let extra = 0; for (const k of B.keys()) if (!A.has(k)) extra++; return { 库里缺: miss, 金额不同: diff, 库里多出: extra, 例子: eg }; };
    out.逐行 = { 日报: lineCheck(F, store.queryDaily({}), '门店', '总营业额') };
    try { if (!out.tgtError) out.逐行.推广通 = lineCheck(await pull(TGT), store.queryTgt({}), '门店ID', '花费'); } catch (e) { }
    out.ok = Object.values(out.逐行).every(x => x.库里缺 === 0 && x.金额不同 === 0);
    if (store.ok) store.meta('migrate.ok', out.ok ? '1' : '0'); // 核对通过才允许改从数据库读
    return out;
  }

  // 一行字的核对结论（写日志用，不打明细）
  function plain(ck) {
    if (!ck || ck.error) return '核对失败：' + ((ck && ck.error) || '未知');
    const bad = [];
    Object.entries(ck.daily || {}).forEach(([s, o]) => { if (!o.一致) bad.push(`日报 ${s} 飞书 ${o.飞书.rows} 行 / 库 ${o.数据库.rows} 行`); });
    Object.entries(ck.tgt || {}).forEach(([s, o]) => { if (!o.一致) bad.push(`推广通 ${s} 飞书 ${o.飞书.rows} 行 / 库 ${o.数据库.rows} 行`); });
    const head = `日报 飞书 ${ck.dailyTotal.飞书} / 库 ${ck.dailyTotal.数据库}${ck.tgtTotal ? `，推广通 飞书 ${ck.tgtTotal.飞书} / 库 ${ck.tgtTotal.数据库}` : ''}`;
    return ck.ok ? head + '，逐店全部一致' : head + '；' + bad.slice(0, 6).join('；') + (bad.length > 6 ? `…共 ${bad.length} 家不一致` : '');
  }

  async function archivable(days) {
    days = days || 120;
    const cut = Date.now() - days * DAY;
    const out = { ok: true, 依据: `数据库已有 + 逐行核对一致 + 日期早于 ${days} 天前（不含今天）`, cutoff: new Date(cut + TZ).toISOString().slice(0, 10), 只统计不删除: true, daily: {}, tgt: {} };
    const F = await pull(dailyName());
    const keyOf = f => `${String(v(f['门店'])).trim()}|${bjDay(n(f['日期']))}`;
    const dbm = new Map(store.queryDaily({}).map(f => [keyOf(f), n(f['总营业额'])]));
    const rows = F.filter(f => { const ts = n(f['日期']); if (ts === null || ts >= cut) return false; const k = keyOf(f); return dbm.has(k) && Math.abs((n(f['总营业额']) || 0) - (dbm.get(k) || 0)) <= 1; });
    const S = {};
    rows.forEach(f => { const s = String(v(f['门店'])).trim() || '（空）'; const d = bjDay(n(f['日期'])); const o = S[s] = S[s] || { 行数: 0, 最早: d, 最晚: d }; o.行数++; o.最早 = Math.min(o.最早, d); o.最晚 = Math.max(o.最晚, d); });
    Object.values(S).forEach(o => { o.最早 = dayStr(o.最早); o.最晚 = dayStr(o.最晚); });
    out.daily = { 飞书总行数: F.length, 可归档行数: rows.length, 门店: S };
    try {
      const G = await pull(TGT); const tdb = new Set(store.queryTgt({}).map(keyOf));
      const trows = G.filter(f => { const ts = n(f['日期']); return ts !== null && ts < cut && tdb.has(keyOf(f)); });
      const T = {};
      trows.forEach(f => { const s = String(v(f['门店'])).trim() || '（空）'; const d = bjDay(n(f['日期'])); const o = T[s] = T[s] || { 行数: 0, 最早: d, 最晚: d }; o.行数++; o.最早 = Math.min(o.最早, d); o.最晚 = Math.max(o.最晚, d); });
      Object.values(T).forEach(o => { o.最早 = dayStr(o.最早); o.最晚 = dayStr(o.最晚); });
      out.tgt = { 飞书总行数: G.length, 可归档行数: trows.length, 门店: T };
    } catch (e) { out.tgtError = e.message; }
    return out;
  }

  return { migrate, check, plain, archivable, pull };
}

module.exports = { createDbMigrate };
