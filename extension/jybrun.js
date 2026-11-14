/* 美团经营宝每日数据：在已登录的 ecom.meituan.com 页面里（走页面自带的美团安全签名）查
 *  1) 各门店昨天的曝光、访问、收藏、打卡、团购（门店列表）
 *  2) 各门店昨天的核心指标 + 商圈同行店均 + 商圈标杆店均（流量概览）
 *  3) 各门店昨天的点评、美团差评原文（评价管理）
 *  4) 各门店上周的新客/老客、复购率（门店顾客，只有按周/按月）
 * 只取数字和差评文字回传服务器。这个函数会被整段注入页面（world: MAIN）执行，不能引用外部变量。
 */
// eslint-disable-next-line no-unused-vars
async function __rmJybRun(day, week) {
  const H = { 'x-requested-with': 'XMLHttpRequest', 'Content-Type': 'application/json' };
  const post = (u, b) => new Promise((res, rej) => {
    const x = new XMLHttpRequest(); x.open('POST', u); for (const [k, v] of Object.entries(H)) x.setRequestHeader(k, v);
    x.timeout = 60000; x.onload = () => { try { res(JSON.parse(x.responseText)); } catch (e) { rej(new Error('返回的不是数据（可能没登录经营宝）HTTP ' + x.status)); } };
    x.onerror = () => rej(new Error('网络错误')); x.ontimeout = () => rej(new Error('超时')); x.send(JSON.stringify(b));
  });
  const sleep = ms => new Promise(r => setTimeout(r, ms + Math.random() * 600));
  const n = v => { if (v == null) return null; const m = String(v).replace(/,/g, '').match(/-?[\d.]+/); if (!m) return null; return /%/.test(String(v)) ? +m[0] / 100 : +m[0]; };
  const s = new Date(day + 'T00:00:00+08:00').getTime(), e = s + 86399999;
  const out = { day, week, stores: [], errors: [] };
  // 1) 门店列表（昨天）
  let list = [];
  try {
    const j = await post('/emis/gw/TEcomBusinessAnalysisService/getTPagePoiCompareDataV3', { optionType: 1, page: { currPage: 0, pageSize: 50, totalNum: 0 }, sortOrder: 'desc', startTime: 0, endTime: 0, sortKey: 'viewUv' });
    list = ((j.data || {}).tPoiCompareDatas || []).map(r => ({ poiId: String(r.poiId), name: r.poiName, flow: { view: n(r.viewUv), visit: n(r.visitUv), collect: n(r.collectUserCnt), checkin: n(r.clockInUserCnt), dealCnt: n(r.groupPayCpnCnt), dealAmt: n(r.groupPayAmt), useCnt: n(r.groupOrderCnt), useAmt: n(r.groupAmount) } }));
    if (!list.length) throw new Error('门店列表是空的（可能没登录经营宝）');
  } catch (er) { return { error: er.message }; }
  for (const st of list) {
    if (!st.flow.view && !st.flow.visit && !st.flow.dealCnt) { out.stores.push(st); continue; } // 已关店/没数据的不查细项
    // 2) 核心指标 + 商圈同行
    try {
      const j = await post('/emis/gw/TPcFlowAnalysisService/getCoreMetric', { startTime: s, endTime: s, granularity: 'DAY', condition: { poiId: st.poiId, platform: 2, tab: '0', cmpType: 'POP' } });
      const M = {}; const walk = o => { if (Array.isArray(o)) return o.forEach(walk); if (o && typeof o === 'object') { if (Array.isArray(o.rows) && o.rows.length && Array.isArray(o.rows[0]) && o.rows[0][0] && o.rows[0][0].name) { const name = o.rows[0][0].name; const m = M[name] = M[name] || { v: n(o.rows[0][0].value), chg: o.rows[0][1] ? n(o.rows[0][1].value) : null }; for (const row of o.rows.slice(1)) { const c = row[0] || {}; if (c.name === '商圈同行店均') m.peer = n(c.value); if (c.name === '商圈标杆店均') m.bench = n(c.value); } } for (const v of Object.values(o)) walk(v); } };
      walk(j.data); st.core = M;
    } catch (er) { out.errors.push(st.name + ' 核心指标：' + er.message); }
    await sleep(1200);
    // 3) 差评原文（点评 + 美团）
    st.bad = [];
    try {
      const j = await post('/emis/gw/rpc/TFeedbackListNewService/queryDPFeedbackPCNew', { pageNo: 1, pageSize: 30, poiId: st.poiId, startTime: s, endTime: e, replyType: '全部', starType: '差评', sourceType: '全部', userType: '全部', timeType: '自定义' });
      for (const f of (((j.data || {}).data || {}).feedbacks || [])) st.bad.push({ p: '点评', star: f.accurateScore ?? f.score, t: f.feedbackTime, text: String(f.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400), replied: (f.replyCount || 0) > 0 });
    } catch (er) { out.errors.push(st.name + ' 点评差评：' + er.message); }
    await sleep(1000);
    try {
      const j = await post('/emis/gw/rpc/TFeedbackListNewService/queryMTFeedbackPCNew', { pageNo: 1, pageSize: 50, poiId: st.poiId, startTime: s, endTime: e, replyType: '全部', starType: '全部', sourceType: '全部', userType: '全部', timeType: '自定义' });
      for (const f of (((j.data || {}).data || {}).feedbacks || [])) { const sc = +f.score; if (!(sc > 0 && sc <= 2)) continue; st.bad.push({ p: '美团', star: sc, t: f.feedbackTime, text: String(f.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400), replied: (f.replyCount || 0) > 0 || (f.replyList || []).length > 0 }); }
    } catch (er) { out.errors.push(st.name + ' 美团差评：' + er.message); }
    await sleep(1000);
    // 4) 上周新客/老客（只在需要时查）
    if (week) try {
      const j = await post('/emis/gw/TCustomerAnalysisService/getCustomerAnalysisDataForPc', { customerType: '50', dateRange: week, poiIds: st.poiId, dateType: 1, platform: 2, isPc: true });
      const ov = (j.data || {}).customerOverview; if (ov) { const D = {}; (ov.customerTypeDetails || []).forEach(x => { D[x.name] = n(x.value); }); st.cust = { week, newBuy: D['售卖新客'], oldBuy: D['售卖老客'], newPot: D['潜在新客'], oldPot: D['潜在老客'], repurchase: n((ov.repurchaseRate || {}).value), repurchasePeer: (ov.repurchaseRatePeerComparison || {}).value || null, sold: n((ov.soldNum || {}).value) }; }
    } catch (er) { out.errors.push(st.name + ' 新老客：' + er.message); }
    out.stores.push(st); await sleep(1500);
  }
  return out;
}
