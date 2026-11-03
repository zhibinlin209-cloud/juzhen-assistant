/* 月度结算：按「人员账号对照」里每个人的抖音号、小红书号，数当月各平台发布条数 × 单价
 * 数据来源（只读）：营销部多维表格 抖音-矩阵号-数据 / 抖音-素人号-数据 / 小红书矩阵号-数据
 * 结果写进你的私密表格「月度结算」（只有你能看），按 月份+姓名+账号 去重，可反复重算
 */
'use strict';
const { norm } = require('./people');
const NAME = '月度结算';
const COLS = [['月份', 1], ['真实姓名', 1], ['收款人', 1], ['微信名', 1], ['抖音账号', 1], ['抖音', 2], ['视频号', 2], ['小红书账号', 1], ['小红书', 2], ['大众点评', 2], ['携程', 2], ['微信贴图', 2], ['合计条数', 2], ['单价', 2], ['金额', 2], ['状态', 3], ['备注', 1], ['计算时间', 5]];
const val = v => Array.isArray(v) ? v.map(x => (x && typeof x === 'object') ? (x.text || x.name || x.link || '') : String(x)).join('') : (v && typeof v === 'object') ? (v.text || v.name || v.link || '') : (v ?? '');
const has = v => /https?:\/\//.test(JSON.stringify(v ?? ''));

function createSettle({ cfg, api, core, people, log }) {
  const priv = () => { const m = String(cfg.dailyBaseUrl || '').match(/\/base\/([A-Za-z0-9]+)/); if (!m) throw new Error('NO_PRIVATE_BASE'); return m[1]; };
  async function tables(app) { const all = []; let pt = ''; do { const d = await api.call('GET', `/bitable/v1/apps/${app}/tables`, null, Object.assign({ page_size: 100 }, pt ? { page_token: pt } : {})); all.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt); return all; }
  async function rows(app, tid) { const out = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${tid}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); out.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt); return out.map(r => r.fields || {}); }
  let tid = null;
  async function table() {
    if (tid) return tid; const A = priv(); const t = (await tables(A)).find(x => x.name === NAME);
    if (t) { const fd = await api.call('GET', `/bitable/v1/apps/${A}/tables/${t.table_id}/fields`, null, { page_size: 200 }); const hv = new Set((fd.items || []).map(f => f.field_name)); for (const [field_name, type] of COLS) if (!hv.has(field_name)) await api.call('POST', `/bitable/v1/apps/${A}/tables/${t.table_id}/fields`, Object.assign({ field_name, type }, type === 3 ? { property: { options: [{ name: '待确认' }, { name: '已确认' }, { name: '有疑问' }] } } : {})); return (tid = t.table_id); }
    const d = await api.call('POST', `/bitable/v1/apps/${A}/tables`, { table: { name: NAME, default_view_name: '全部', fields: COLS.map(([field_name, type]) => Object.assign({ field_name, type }, type === 3 ? { property: { options: [{ name: '待确认', color: 2 }, { name: '已确认', color: 4 }, { name: '有疑问', color: 0 }] } } : {})) } });
    log('[结算] 新建表：' + NAME); return (tid = d.table_id);
  }
  // month: 'YYYY-MM'（北京时间）
  async function compute(month) {
    const [Y, M] = month.split('-').map(Number); const from = Date.UTC(Y, M - 1, 1) - 8 * 3600e3, to = Date.UTC(Y, M, 1) - 8 * 3600e3;
    const app = await core.appToken(); const T = await tables(app); const get = async n => { const t = T.find(x => x.name === n); return t ? rows(app, t.table_id) : []; };
    const inMonth = f => typeof f['发布日期'] === 'number' && f['发布日期'] >= from && f['发布日期'] < to;
    const dy = {}, xhs = {}; const add = (o, k, f) => { (o[k] = o[k] || { 抖音: 0, 视频号: 0, 小红书: 0, 大众点评: 0, 携程: 0, 微信贴图: 0 }); return o[k]; };
    for (const f of (await get('抖音-矩阵号-数据')).concat(await get('抖音-素人号-数据'))) {
      if (!inMonth(f)) continue; const k = norm(val(f['账号名称'])); if (!k) continue; const o = add(dy, k);
      if (has(f['抖音链接'])) o.抖音++; if (has(f['视频号链接']) || has(f['视频号'])) o.视频号++; if (has(f['贴图号'])) o.微信贴图++;
    }
    for (const f of await get('小红书矩阵号-数据')) {
      if (!inMonth(f)) continue; const k = norm(val(f['账号昵称'])); if (!k) continue; const o = add(xhs, k);
      if (has(f['小红书链接'])) o.小红书++; if (has(f['点评链接'])) o.大众点评++; if (has(f['携程链接'])) o.携程++; if (has(f['微信贴图'])) o.微信贴图++;
    }
    const price = +(cfg.settlePrice || 5); const ps = await people.list(true); const out = []; const usedD = new Set(), usedX = new Set();
    for (const p of ps) {
      const a = p['抖音账号'] ? dy[norm(p['抖音账号'])] : null, b = p['小红书账号'] ? xhs[norm(p['小红书账号'])] : null;
      if (a) usedD.add(norm(p['抖音账号'])); if (b) usedX.add(norm(p['小红书账号']));
      const r = { 月份: month, 真实姓名: p['真实姓名'], 收款人: p['收款人'] || p['真实姓名'], 微信名: p['微信名'] || '', 抖音账号: p['抖音账号'] || '', 小红书账号: p['小红书账号'] || '', 抖音: a ? a.抖音 : 0, 视频号: a ? a.视频号 : 0, 小红书: b ? b.小红书 : 0, 大众点评: b ? b.大众点评 : 0, 携程: b ? b.携程 : 0, 微信贴图: (b ? b.微信贴图 : 0) + (a ? a.微信贴图 : 0) };
      r.合计条数 = r.抖音 + r.视频号 + r.小红书 + r.大众点评 + r.携程 + r.微信贴图; r.单价 = price; r.金额 = r.合计条数 * price; out.push(r);
    }
    // 数据表里有发布、但对照表里没有的账号：列出来提醒补对照
    const orphan = Object.entries(dy).filter(([k, o]) => !usedD.has(k) && o.抖音).map(([k, o]) => `抖音「${k}」${o.抖音}条`).concat(Object.entries(xhs).filter(([k, o]) => !usedX.has(k) && o.小红书).map(([k, o]) => `小红书「${k}」${o.小红书}条`));
    return { month, rows: out, orphan, total: out.reduce((s, r) => s + r.金额, 0), count: out.reduce((s, r) => s + r.合计条数, 0) };
  }
  async function save(res) {
    const A = priv(), T = await table(); const ex = await rows(A, T).catch(() => []);
    const old = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${A}/tables/${T}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); old.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    const key = r => [r.月份, r.真实姓名, r.抖音账号, r.小红书账号].map(x => norm(val(x))).join('|');
    const map = new Map(old.map(x => { const f = x.fields || {}; return [key({ 月份: f['月份'], 真实姓名: f['真实姓名'], 抖音账号: f['抖音账号'], 小红书账号: f['小红书账号'] }), x]; }));
    const add = [], upd = []; const now = Date.now();
    for (const r of res.rows) { const e = map.get(key(r)); const fields = Object.assign({}, r, { 计算时间: now }); if (e) { const st = val((e.fields || {})['状态']); if (st === '已确认') continue; upd.push({ record_id: e.record_id, fields }); } else add.push({ fields: Object.assign(fields, { 状态: '待确认' }) }); }
    for (let i = 0; i < add.length; i += 400) await api.call('POST', `/bitable/v1/apps/${A}/tables/${T}/records/batch_create`, { records: add.slice(i, i + 400) });
    for (let i = 0; i < upd.length; i += 400) await api.call('POST', `/bitable/v1/apps/${A}/tables/${T}/records/batch_update`, { records: upd.slice(i, i + 400) });
    log(`[结算] ${res.month} 写入：新增 ${add.length}，更新 ${upd.length}`); return { added: add.length, updated: upd.length };
  }
  return { compute, save };
}

function replyForSettle(res, w) {
  const top = res.rows.filter(r => r.合计条数).sort((a, b) => b.金额 - a.金额);
  return `💰 ${res.month} 结算草稿：${top.length} 人有发布，合计 ${res.count} 条，金额 ${res.total} 元（单价 ${res.rows[0] ? res.rows[0].单价 : 5} 元/条）\n` +
    top.slice(0, 50).map(r => `· ${r.真实姓名}${r.收款人 && r.收款人 !== r.真实姓名 ? '（收款 ' + r.收款人 + '）' : ''}：抖音 ${r.抖音} · 视频号 ${r.视频号} · 小红书 ${r.小红书} · 点评 ${r.大众点评} · 携程 ${r.携程} · 贴图 ${r.微信贴图} = ${r.合计条数} 条 ${r.金额} 元`).join('\n') +
    (res.orphan.length ? `\n\n⚠️ 这些账号有发布但不在人员对照表里，没算钱：${res.orphan.slice(0, 15).join('、')}` : '') +
    `\n\n已写进私密表格「月度结算」（新增 ${w.added}、更新 ${w.updated}，已确认的不覆盖）。条数来自数据表登记，第一次用请和腾讯文档对一遍。`;
}
module.exports = { createSettle, replyForSettle };
