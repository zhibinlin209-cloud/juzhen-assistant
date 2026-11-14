/* 美团管家每日数据：在已登录的 pos.meituan.com 页面里，用页面自己的请求通道（带美团安全签名）按天查 4 张报表，
 * 只取汇总数字回传服务器。查询模板（报表的查询条件）存在 pos.meituan.com 的本机存储里，服务器也备份一份。
 * 这个函数会被整段注入到页面（world: MAIN）里执行，不能引用外部变量。
 */
// eslint-disable-next-line no-unused-vars
async function __rmGjRun(days, tplFromServer) {
  const T = {};
  for (const k of ['businessIndex', 'channel', 'dish', 'hourly']) {
    let t = null; try { t = JSON.parse(localStorage.getItem('__rm_tpl_' + k) || 'null'); } catch (e) { }
    if (!t && tplFromServer && tplFromServer[k]) { t = tplFromServer[k]; try { localStorage.setItem('__rm_tpl_' + k, JSON.stringify(t)); } catch (e) { } }
    T[k] = t;
  }
  const missing = Object.keys(T).filter(k => !T[k]);
  if (missing.length === 4) return { error: '这台电脑的美团管家里还没有报表查询模板（需要 Claude 先在这个浏览器里设置一次）' };
  const post = (t, body) => new Promise((res, rej) => {
    const x = new XMLHttpRequest(); x.open('POST', t.u); for (const [k, v] of Object.entries(t.h || {})) { try { x.setRequestHeader(k, v); } catch (e) { } }
    x.timeout = 60000; x.onload = () => { try { res(JSON.parse(x.responseText)); } catch (e) { rej(new Error('返回的不是数据（可能没登录美团管家）HTTP ' + x.status)); } };
    x.onerror = () => rej(new Error('网络错误')); x.ontimeout = () => rej(new Error('超时')); x.send(body);
  });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const num = v => v == null ? null : (typeof v === 'object' ? (v.targetNum ?? null) : (isFinite(+v) ? +v : null));
  const dayRange = d => { const s = Math.floor(new Date(d + 'T00:00:00+08:00').getTime() / 1000); return [s, s + 86399]; };
  const out = { days: [], errors: [], tpl: T, missing };
  if (!T.businessIndex || !T.businessIndex.u) { if (T.businessIndex) T.businessIndex.u = '/web/api/v2/bi/runtime/query/graphlist?yodaReady=h5&csecplatform=4&csecversion=4.3.0'; }
  for (const d of days) {
    const [s, e] = dayRange(d); const day = { date: d, index: [], channel: [], dish: [], hourly: [] };
    // 1) 营业指标统计：营业额、开台数（消费桌数）、人数、桌均、人均、翻台率、上座率、用餐时长
    if (T.businessIndex) try {
      const o = JSON.parse(T.businessIndex.b); o.pageNo = 1; o.pageSize = 200;
      (o.graphConfigList || []).forEach(g => (g.globalFilterList || []).forEach(f => { if (f.type === 'date') f.value = JSON.stringify({ startDate: s, endDate: e }); }));
      const j = await post(T.businessIndex, JSON.stringify(o)); if (j.code !== 0) throw new Error('营业指标：' + (j.message || j.msg || j.code));
      const F = { store: '0@poiName', revenue: '0@bizAmt', income: '0@ordIncomeAmt', discount: '0@discountAmt', orders: '0@orderCnt', guests: '0@customerCnt', tables: '0@restTablePaidOrderCntForRatio', tableAvg: '0@newBizAmtTableAvg', tableAvgNet: '0@newIncomeAmtTableAvg', perCap: '0@ordBizAmtPepoleAvg', perCapNet: '0@ordIncomeAmtPepoleAvg', flip: '0@flipTableRadioWithoutZero', openRate: '0@openTableRadioWithoutZero', seatRate: '0@upperSeatRatio0', mealMin: '0@mealDurationAvg' };
      for (const it of (j.data && j.data.items) || []) { const r = {}; for (const [k, f] of Object.entries(F)) r[k] = k === 'store' ? String(it[f] || '') : num(it[f]); if (r.store) day.index.push(r); }
    } catch (er) { out.errors.push(d + ' ' + er.message); }
    await sleep(1500);
    // 2) 渠道营业统计：堂食（店内销售）/ 美团外卖 / 淘宝闪购 等各渠道营业额和单数
    if (T.channel) try {
      const o = JSON.parse(T.channel.b); o.pageNo = 1; o.pageSize = 200; (o.globalFilterList || []).forEach(f => { if (f.type === 'date') f.value = JSON.stringify({ startDate: s, endDate: e }); });
      const j = await post(T.channel, JSON.stringify(o)); if (j.code !== 0) throw new Error('渠道营业：' + (j.message || j.msg || j.code));
      for (const it of (j.data && j.data.items) || []) {
        const r = { store: String(it.poiName || ''), revenue: num(it.bizAmt), ch: {} };
        for (const [k, v] of Object.entries(it)) { const m = k.match(/^(.+?)_(bizAmt|orderCnt|ordIncomeAmt)_\d+$/); if (m) { (r.ch[m[1]] = r.ch[m[1]] || {})[m[2]] = num(v); } }
        if (r.store) day.channel.push(r);
      }
    } catch (er) { out.errors.push(d + ' ' + er.message); }
    await sleep(1500);
    // 3) 菜品销售统计（按门店、按日）：每家店销量前 25 的菜（去掉茶位、白饭、餐具、赠送）
    if (T.dish) try {
      const o = JSON.parse(T.dish.b); (o.globalFilterList || []).forEach(f => { if (f.type === 'DATE-LIST') f.values = [{ startDate: s, endDate: e }]; });
      const mt = ((o.graphConfig || {}).metricList || []); const cntF = (mt.find(m => String(m.showName || '').trim() === '销售数量') || {}).fieldName; const amtF = (mt.find(m => String(m.showName || '').trim() === '销售额(元)') || {}).fieldName;
      const rows = []; for (let p = 1; p <= 8; p++) {
        o.pageNo = p; o.pageSize = 1000; const j = await post(T.dish, JSON.stringify(o)); if (j.code !== 0) throw new Error('菜品销售：' + (j.msg || j.message || j.code));
        for (const it of (j.data && j.data.items) || []) { const g = it.groupDims || {}, a = it.aggr || {}; const store = g[Object.keys(g).find(k => /^poiName_/.test(k))], dish = g[Object.keys(g).find(k => /^spuName_/.test(k))], type = g[Object.keys(g).find(k => /^itemType_/.test(k))]; rows.push({ store, dish, type, qty: num(a[cntF]), amt: a.skuSaleAmt_sum != null ? a.skuSaleAmt_sum / 100 : num(a[amtF]) }); }
        const pg = (j.data && j.data.page) || {}; if (!pg.totalPageSize || p >= pg.totalPageSize) break; await sleep(1200);
      }
      const by = {}; for (const r of rows) if (r.store && r.dish) (by[r.store] = by[r.store] || []).push(r);
      for (const [store, list] of Object.entries(by)) { list.sort((a, b) => (b.qty || 0) - (a.qty || 0)); day.dish.push({ store, top: list.filter(x => !/茶位|餐位|纸巾|白饭|米饭|打包|餐具|服务费|如需|筷子|小碗|^赠送/.test(x.dish)).slice(0, 25).map(x => [x.dish, x.qty, x.amt, x.type || '']) }); }
    } catch (er) { out.errors.push(d + ' ' + er.message); }
    await sleep(1500);
    // 4) 时段开台分析：每家店每小时开台数
    if (T.hourly) try {
      const w = JSON.parse(T.hourly.b); const q = JSON.parse(w.reqJson); q.startDate = s * 1000; q.endDate = e * 1000 + 999; q.pageNo = 1; q.pageSize = 500;
      const j = await post(T.hourly, JSON.stringify({ reqJson: JSON.stringify(q) })); if (j.code !== 0) throw new Error('时段开台：' + (j.msg || j.code));
      const dd = typeof j.data === 'string' ? JSON.parse(j.data) : j.data; const by = {};
      for (const it of dd.items || []) { const st = String(it.poiName || '').trim(); if (!st) continue; (by[st] = by[st] || []).push([it.startTime, it.openTableCnt, it.mealPeopleCnt, (it.businessAmt || 0) / 100]); }
      for (const [store, h] of Object.entries(by)) day.hourly.push({ store, h });
    } catch (er) { out.errors.push(d + ' ' + er.message); }
    out.days.push(day); await sleep(2000);
  }
  return out;
}
