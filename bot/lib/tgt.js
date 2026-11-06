/* 推广通门店报表（Excel）→ 私密表格「推广通数据」
 * Debbie 每天把报表发到群里，机器人自动读、按 日期+门店ID 去重写入，并检查异常
 */
'use strict';
const { readXlsx } = require('./xlsx');
const DAY = 864e5, TZ = 8 * 3600e3;
const STORE = [[/华强北/, '深圳华强北燕南店'], [/前海|HOP/i, '深圳前海HOP店'], [/白石洲/, '深圳白石洲店'], [/江南西/, '广州江南西店'], [/玖洲道/, '珠海玖洲道店'], [/水东街/, '惠州水东街店'], [/33小镇/, '东莞东城33小镇店'], [/创意产业园/, '佛山创意产业园店'], [/千灯湖|灯湖西街|保利西街/, '佛山保利西街店'], [/陈家祠/, '广州陈家祠店'], [/花园城/, '深圳蛇口招商花园城店']];
const canon = s => { s = String(s || '').replace(/YES也是大排档/, ''); const m = STORE.find(([re]) => re.test(s)); return m ? m[1] : s; };
const COLS = [['日期', 5], ['门店', 1], ['门店ID', 1], ['花费', 2], ['曝光', 2], ['点击', 2], ['商户浏览量', 2], ['团购订单量', 2], ['订单量', 2], ['7日团购订单数', 2], ['查看团购', 2], ['收藏', 2], ['15日团购订单数', 2], ['30日团购订单数', 2], ['7日支付订单数', 2], ['15日支付订单数', 2], ['30日支付订单数', 2], ['录入时间', 5]];
const DATA = COLS.slice(3, -1); // 花费 … 30日支付订单数
const num = v => { const x = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(x) ? x : 0; };
const bjDay = t => Math.floor((t + TZ) / DAY);

function parseTgt(buf) {
  // 两种导出都认：①「下载.xlsx」（日期 20261020、门店名称、花费…、30日团购订单数）②「门店报表_起_止.xlsx」（日期 11-05、推广门店、花费（元）…，没有归因列）
  const rows = readXlsx(buf); const clean = x => String(x ?? '').replace(/[（(][^）)]*[）)]/g, '').trim();
  const hi = rows.findIndex(r => { const h = r.map(clean); return h.includes('日期') && h.includes('花费') && (h.includes('门店名称') || h.includes('推广门店')); });
  if (hi < 0) return null; const H = rows[hi].map(clean); const col = n => H.indexOf(n); const nameCol = col('门店名称') >= 0 ? col('门店名称') : col('推广门店');
  const now = new Date(Date.now() + TZ); const Y = now.getUTCFullYear(), M = now.getUTCMonth() + 1;
  const ymd = v => { const t = String(v ?? '').trim(); let m = t.match(/^(\d{4})-?(\d{2})-?(\d{2})$/); if (m) return [+m[1], +m[2], +m[3]]; m = t.match(/^(\d{1,2})[-/.](\d{1,2})$/); if (m) { const mo = +m[1]; return [mo > M + 1 ? Y - 1 : Y, mo, +m[2]]; } if (/^\d{5}(\.\d+)?$/.test(t)) { const d = new Date(Date.UTC(1899, 11, 30) + parseFloat(t) * DAY); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]; } return null; };
  return rows.slice(hi + 1).map(r => ({ r, d: ymd(r[col('日期')]) })).filter(x => x.d && String(x.r[nameCol] || '').trim()).map(({ r, d }) => {
    const ts = Date.UTC(d[0], d[1] - 1, d[2]) - TZ;
    const o = { ts, date: `${String(d[1]).padStart(2, '0')}/${String(d[2]).padStart(2, '0')}`, storeId: String(r[col('门店ID')] || '').trim(), store: canon(r[nameCol]) };
    for (const [c] of DATA) o[c] = col(c) >= 0 ? num(r[col(c)]) : null;
    return o;
  });
}

function createTgt({ cfg, api, log }) {
  const app = () => { const m = String(cfg.dailyBaseUrl || '').match(/\/base\/([A-Za-z0-9]+)/); if (!m) throw new Error('NO_PRIVATE_BASE'); return m[1]; };
  let tid = null;
  async function table() {
    if (tid) return tid; const A = app(); const all = []; let pt = '';
    do { const d = await api.call('GET', `/bitable/v1/apps/${A}/tables`, null, Object.assign({ page_size: 100 }, pt ? { page_token: pt } : {})); all.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    const t = all.find(x => x.name === '推广通数据');
    if (t) { // 老表补上新列（7/15/30 日归因）
      const fd = await api.call('GET', `/bitable/v1/apps/${A}/tables/${t.table_id}/fields`, null, { page_size: 200 }); const hv = new Set((fd.items || []).map(f => f.field_name));
      for (const [field_name, type] of COLS) if (!hv.has(field_name)) await api.call('POST', `/bitable/v1/apps/${A}/tables/${t.table_id}/fields`, { field_name, type });
      return (tid = t.table_id); }
    const d = await api.call('POST', `/bitable/v1/apps/${A}/tables`, { table: { name: '推广通数据', default_view_name: '全部', fields: COLS.map(([field_name, type]) => ({ field_name, type })) } });
    log('[推广通] 新建表：推广通数据'); return (tid = d.table_id);
  }
  async function existing() {
    const A = app(), T = await table(); const out = []; let pt = '';
    do { const d = await api.call('POST', `/bitable/v1/apps/${A}/tables/${T}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); out.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    return out.map(x => ({ id: x.record_id, f: x.fields || {} }));
  }
  const val = v => Array.isArray(v) ? v.map(x => x.text || '').join('') : (v ?? '');
  async function ingest(buf) {
    const list = parseTgt(buf); if (!list) return null; if (!list.length) return { rows: 0 };
    const A = app(), T = await table(); const ex = await existing();
    const key = (ts, id) => `${bjDay(ts)}|${id}`; const map = new Map(ex.map(x => [key(x.f['日期'], val(x.f['门店ID'])), x.id]));
    const add = [], upd = []; const now = Date.now();
    for (const o of list) { const fields = { 日期: o.ts, 门店: o.store, 门店ID: o.storeId, 录入时间: now }; DATA.forEach(([c]) => { if (o[c] !== null) fields[c] = o[c]; }); const id = map.get(key(o.ts, o.storeId)); if (id) upd.push({ record_id: id, fields }); else add.push({ fields }); }
    for (let i = 0; i < add.length; i += 400) await api.call('POST', `/bitable/v1/apps/${A}/tables/${T}/records/batch_create`, { records: add.slice(i, i + 400) });
    for (let i = 0; i < upd.length; i += 400) await api.call('POST', `/bitable/v1/apps/${A}/tables/${T}/records/batch_update`, { records: upd.slice(i, i + 400) });
    log(`[推广通] 新增 ${add.length}，更新 ${upd.length}`);
    const dset = new Set(list.map(o => bjDay(o.ts)));
    return Object.assign({ rows: list.length, added: add.length, updated: upd.length, days: dset.size, lastDay: Math.max(...dset) }, analyze(list.concat(ex.map(x => ({ ts: x.f['日期'], store: val(x.f['门店']), storeId: val(x.f['门店ID']), 花费: +x.f['花费'] || 0, 团购订单量: +x.f['团购订单量'] || 0, 商户浏览量: +x.f['商户浏览量'] || 0 })))));
  }
  // 最新一天：各店花费 vs 前 3 周同一天平均，掉一半以上提醒（可能余额不足或计划被停）
  function analyze(all) {
    const byKey = new Map(); all.forEach(o => { if (o.ts) byKey.set(`${bjDay(o.ts)}|${o.storeId}`, o); });
    const rows = [...byKey.values()]; if (!rows.length) return {};
    const last = Math.max(...rows.map(o => bjDay(o.ts))); const day = rows.filter(o => bjDay(o.ts) === last);
    const flags = [];
    for (const o of day) {
      const prev = [7, 14, 21].map(k => byKey.get(`${last - k}|${o.storeId}`)).filter(Boolean).map(x => x['花费']);
      const avg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : 0;
      if (avg >= 50 && o['花费'] < avg * 0.5) flags.push(`${o.store} 花费 ${Math.round(o['花费'])}，前几周同一天平均 ${Math.round(avg)}（可能余额不足或计划被停）`);
    }
    const tot = k => Math.round(day.reduce((s, o) => s + (o[k] || 0), 0));
    return { last: new Date(last * DAY).toISOString().slice(5, 10).replace('-', '/'), spend: tot('花费'), orders: tot('团购订单量'), views: tot('商户浏览量'), flags };
  }
  return { ingest, existing, analyze, parseTgt };
}

function replyForTgt(r) {
  if (!r) return ''; if (!r.rows) return '⚠️ 这份推广通报表里没有读到数据行';
  return `📊 推广通报表已入库：${r.rows} 行（新增 ${r.added}、更新 ${r.updated}）\n最新一天 ${r.last}：花费 ${r.spend}，团购订单 ${r.orders}，商户浏览 ${r.views}` + (r.flags && r.flags.length ? '\n⚠️ ' + r.flags.join('\n⚠️ ') : '');
}
module.exports = { createTgt, parseTgt, replyForTgt, canon };
