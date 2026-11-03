/* 人员账号对照：真实姓名 / 微信名 / 数据表里的叫法 / 抖音号 / 小红书号
 * 来源：月度结算表（腾讯文档导出的 Excel，发到「经营日报」群自动导入），再按数据表里的账号自动补「数据表叫法」
 * 存在你的私密多维表格（只有你能看），不进代码仓库
 */
'use strict';
const { readXlsx } = require('./xlsx');
const NAME = '人员账号对照';
const COLS = [['真实姓名', 1], ['微信名', 1], ['抖音账号', 1], ['小红书账号', 1], ['数据表叫法', 1], ['备注', 1], ['更新时间', 5]];
const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s​-‏️'"“”‘’`·.。，,!！?？~～^（）()\[\]【】/\\|_\-—]+/g, '').replace(/l/g, 'i');
const val = v => Array.isArray(v) ? v.map(x => (x && typeof x === 'object') ? (x.text || x.name || '') : String(x)).join('') : (v && typeof v === 'object') ? (v.text || v.name || '') : (v ?? '');

function parseSettle(buf) {
  const rows = readXlsx(buf); const hi = rows.findIndex(r => r.some(c => /收款人/.test(c || '')) && r.some(c => /微信/.test(c || '')));
  if (hi < 0) return null; const H = rows[hi].map(c => String(c || '').trim());
  const iName = H.findIndex(c => /收款人/.test(c)), iWx = H.findIndex(c => /微信/.test(c));
  const accIdx = H.map((c, i) => c === '账号' ? i : -1).filter(i => i >= 0);
  const iDy = accIdx.find(i => /抖音/.test(H[i + 1] || '')) ?? accIdx[0], iXhs = accIdx.find(i => /小红书/.test(H[i + 1] || '')) ?? accIdx[1];
  const clean = v => { const t = String(v ?? '').trim(); return t === '/' ? '' : t; };
  return rows.slice(hi + 1).map(r => ({ 真实姓名: clean(r[iName]), 微信名: clean(r[iWx]), 抖音账号: iDy >= 0 ? clean(r[iDy]) : '', 小红书账号: iXhs >= 0 ? clean(r[iXhs]) : '' })).filter(x => x.真实姓名 && !/合计|总计/.test(x.真实姓名));
}

function createPeople({ cfg, api, log }) {
  const app = () => { const m = String(cfg.dailyBaseUrl || '').match(/\/base\/([A-Za-z0-9]+)/); if (!m) throw new Error('NO_PRIVATE_BASE'); return m[1]; };
  let tid = null, cache = null;
  async function table() {
    if (tid) return tid; const A = app(); const all = []; let pt = '';
    do { const d = await api.call('GET', `/bitable/v1/apps/${A}/tables`, null, Object.assign({ page_size: 100 }, pt ? { page_token: pt } : {})); all.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    const t = all.find(x => x.name === NAME); if (t) return (tid = t.table_id);
    const d = await api.call('POST', `/bitable/v1/apps/${A}/tables`, { table: { name: NAME, default_view_name: '全部', fields: COLS.map(([field_name, type]) => ({ field_name, type })) } });
    log('[人员] 新建表：' + NAME); return (tid = d.table_id);
  }
  async function list(force) {
    if (cache && !force && Date.now() - cache.at < 10 * 60e3) return cache.v;
    const A = app(), T = await table(); const out = []; let pt = '';
    do { const d = await api.call('POST', `/bitable/v1/apps/${A}/tables/${T}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); out.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    const v = out.map(r => { const f = r.fields || {}; const o = { id: r.record_id }; COLS.forEach(([c]) => { o[c] = c === '更新时间' ? f[c] : String(val(f[c]) || '').trim(); }); return o; });
    cache = { at: Date.now(), v }; return v;
  }
  // 结算表导入：按 真实姓名+微信名 去重（同一个收款人可能收两套账号的钱）
  async function importSettle(buf) {
    const rows = parseSettle(buf); if (!rows) return null; if (!rows.length) return { rows: 0 };
    const A = app(), T = await table(); const ex = await list(true); const key = x => norm(x.真实姓名) + '|' + norm(x.微信名);
    const map = new Map(ex.map(x => [key(x), x])); const add = [], upd = []; const now = Date.now();
    for (const r of rows) { const e = map.get(key(r)); const fields = Object.assign({}, r, { 更新时间: now }); if (e) upd.push({ record_id: e.id, fields }); else add.push({ fields }); }
    if (add.length) await api.call('POST', `/bitable/v1/apps/${A}/tables/${T}/records/batch_create`, { records: add });
    if (upd.length) await api.call('POST', `/bitable/v1/apps/${A}/tables/${T}/records/batch_update`, { records: upd });
    cache = null; log(`[人员] 结算表导入：新增 ${add.length}，更新 ${upd.length}`);
    return { rows: rows.length, added: add.length, updated: upd.length };
  }
  // 用数据表里「发布人员 → 账号」的统计，给每个人补上数据表里的叫法（比如 小诗 = 李诗艺）
  async function linkAliases(stats) {
    const A = app(), T = await table(); const ps = await list(true); const upd = [];
    for (const p of ps) {
      const mine = new Set([p.抖音账号, p.小红书账号].filter(Boolean).map(norm)); if (!mine.size) continue;
      const al = new Set(String(p.数据表叫法 || '').split(/[、,，]/).map(s => s.trim()).filter(Boolean));
      Object.entries(stats).forEach(([who, o]) => { const top = ['xhs', 'dy', 'sr'].map(k => Object.entries(o[k] || {}).sort((a, b) => b[1] - a[1])[0]).filter(Boolean).map(x => norm(x[0])); if (top.some(t => mine.has(t)) && who !== p.真实姓名) al.add(who); });
      const s = [...al].join('、'); if (s !== (p.数据表叫法 || '')) upd.push({ record_id: p.id, fields: { 数据表叫法: s } });
    }
    if (upd.length) { await api.call('POST', `/bitable/v1/apps/${A}/tables/${T}/records/batch_update`, { records: upd }); cache = null; }
    return upd.length;
  }
  // 名字（真名 / 微信名 / 数据表叫法 / 账号名）→ 这个人
  async function resolve(name) {
    const n = norm(String(name || '').replace(/[（(][^）)]*[）)]/g, '')); if (!n) return null; const ps = await list();
    const hit = f => ps.filter(f);
    let r = hit(p => norm(p.真实姓名) === n); if (r.length === 1) return r[0];
    r = hit(p => norm(p.微信名) === n); if (r.length === 1) return r[0];
    r = hit(p => String(p.数据表叫法 || '').split(/[、,，]/).some(a => norm(a) === n)); if (r.length === 1) return r[0];
    r = hit(p => norm(p.抖音账号) === n || norm(p.小红书账号) === n); if (r.length === 1) return r[0];
    r = hit(p => p.微信名 && (n.includes(norm(p.微信名)) || norm(p.微信名).includes(n)) && n.length >= 3); if (r.length === 1) return r[0];
    return null;
  }
  return { importSettle, list, linkAliases, resolve, parseSettle };
}
module.exports = { createPeople, parseSettle, norm };
