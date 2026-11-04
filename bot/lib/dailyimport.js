/* 历史营业日报导入（华付导出的「表格全文」xlsx，每家店一个文件）
 * 规则（2026-11-04 和林总确认）：
 *  · 「数据关联」和「日期」不一致时，这一行的数字属于「数据关联」那天（导出里是关联记录的数），按关联日期算
 *  · 同一家店同一天有多条（录错后补录）：保留最后录入的一条
 *  · 门店名「X, X」、营业额为空的行跳过；营业额超过本店中位数 5 倍的当作录错，不导入，列出来人工确认
 *  · 表里已有的店+日：不覆盖（以群消息/华付推送为准），只报告不一致
 * 只写私密表格的「经营日报数据」
 */
'use strict';
const DAY = 864e5, TZ = 8 * 3600e3;
const num = v => { if (v === null || v === undefined || v === '') return null; const s = String(v).replace(/[¥￥,人%\s]/g, ''); const n = parseFloat(s); return isFinite(n) ? n : null; };
// 日期：'2025/01/01'、'2025-01-01' 或 Excel 序号
function day(v) {
  if (v === null || v === undefined || v === '') return null; const s = String(v).trim();
  let m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/); if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) - TZ;
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = Math.floor(+s); return Date.UTC(1899, 11, 30) + d * DAY - TZ; }
  return null;
}
const MAP = { 顾客到店: '到店消费', 外卖平台: '外卖', 午市营业额: '午市', 晚市营业额: '晚市', 总营业额: '总营业额', 营业总额: '总营业额', 报损金额: '报损', 总仓订货: '总仓订货', 海鲜采购: '海鲜采购', 蔬菜采购: '蔬菜采购', 鲜肉采购: '鲜肉采购', 其它杂项: '其它杂项', 当天采购总金额: '采购总额', 营业额占比: '采购占比%',
  楼面上班人数: '楼面人数', 厨房上班人数: '厨房人数', 共计上班人数: '上班人数', 人均产值: '人均产值', 休假人数: '休假人数', 点评评分: '点评评分', '【大众点评】好评数': '点评好评', '【大众点评】差评数': '点评差评', 美团评分: '美团评分', '【美团】好评数': '美团好评', '【美团】差评数': '美团差评', 收藏打卡人数: '收藏打卡', 鸡佬采购: '鸡佬采购', 生鲜采购: '生鲜采购' };

function isHistory(rows) { const h = (rows[0] || []).map(x => String(x || '').trim()); return h.includes('日期') && h.includes('门店名称') && h.includes('顾客到店'); }

function parse(rows) {
  const H = rows[0].map(x => String(x || '').trim()); const ix = k => H.indexOf(k);
  const lo = Date.UTC(2025, 0, 1) - TZ, hi = Date.now() + DAY;
  const ok = t => t !== null && t >= lo && t <= hi;
  const out = []; let fixed = 0, badDate = [], skipped = 0;
  rows.slice(1).forEach((r, i) => {
    const store = String(r[ix('门店名称')] || '').split(/[,，]/)[0].trim(); if (!store) return;
    const f = {}; H.forEach((h, j) => { if (MAP[h] && f[MAP[h]] == null) { const v = num(r[j]); if (v !== null) f[MAP[h]] = v; } });
    if (f.总营业额 == null) { skipped++; return; }
    const a = day(r[ix('日期')]), b = ix('数据关联') >= 0 ? day(r[ix('数据关联')]) : null;
    let ts = null; if (ok(b) && b !== a) { ts = b; fixed++; } else if (ok(a)) ts = a; else if (ok(b)) ts = b;
    if (ts === null) { badDate.push(`${store} ${r[ix('日期')]}`); return; }
    out.push({ i, store, ts, f });
  });
  // 同店同日保留最后一条
  const last = new Map(); let dups = 0; out.forEach(x => { const k = x.store + '|' + x.ts; if (last.has(k)) dups++; last.set(k, x); });
  const list = [...last.values()];
  // 明显录错（> 本店中位数 5 倍）
  const by = {}; list.forEach(x => (by[x.store] = by[x.store] || []).push(x.f.总营业额));
  const med = {}; Object.entries(by).forEach(([s, a]) => { const v = a.slice().sort((p, q) => p - q); med[s] = v[Math.floor(v.length / 2)]; });
  const outliers = list.filter(x => x.f.总营业额 > med[x.store] * 5);
  const good = list.filter(x => !outliers.includes(x));
  return { good, outliers, fixed, dups, badDate, skipped, med };
}

function createDailyImport({ cfg, api, core, log }) {
  async function run(parsedList) {
    const app = await core.dailyAppToken(); if (app === await core.appToken()) throw new Error('私密表格配置不对');
    const name = cfg.dailyTable || '门店营业日报';
    const tabs = (await api.call('GET', `/bitable/v1/apps/${app}/tables`, null, { page_size: 100 })).items || []; const t = tabs.find(x => x.name === name); if (!t) throw new Error('没找到表：' + name);
    { const fd = await api.call('GET', `/bitable/v1/apps/${app}/tables/${t.table_id}/fields`, null, { page_size: 200 }); const hv = new Set((fd.items || []).map(f => f.field_name)); const need = new Set(); parsedList.forEach(x => Object.keys(x.f).forEach(k => { if (!hv.has(k)) need.add(k); })); for (const k of need) await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/fields`, { field_name: k, type: 2 }); }
    const recs = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/records/search`, { field_names: ['日期', '门店', '总营业额'] }, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); recs.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    const v = x => Array.isArray(x) ? x.map(y => (y && y.text) || y).join('') : (x ?? '');
    const k = (ts, s) => `${Math.floor((ts + TZ) / DAY)}|${String(s).trim()}`;
    const exist = new Map(recs.map(r => [k(r.fields['日期'], v(r.fields['门店'])), r]));
    const add = [], diff = [];
    for (const x of parsedList) {
      const e = exist.get(k(x.ts, x.store));
      if (e) { const ev = +e.fields['总营业额']; if (isFinite(ev) && Math.abs(ev - x.f.总营业额) > 1) diff.push(`${x.store} ${new Date(x.ts + TZ).toISOString().slice(0, 10)} 表里 ${ev} / 导出 ${x.f.总营业额}`); continue; }
      add.push({ fields: Object.assign({ 日期: x.ts, 门店: x.store, 来源: '华付历史导入', 录入时间: Date.now() }, x.f) });
    }
    for (let i = 0; i < add.length; i += 400) await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/records/batch_create`, { records: add.slice(i, i + 400) });
    log(`[历史日报] 新增 ${add.length}，表里已有跳过 ${parsedList.length - add.length}（数字不一致 ${diff.length}）`);
    return { added: add.length, existed: parsedList.length - add.length, diff };
  }
  return { run };
}
module.exports = { isHistory, parse, createDailyImport };
