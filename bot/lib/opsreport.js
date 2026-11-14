/* 运营日报 / 周报 / 月报（发给运营副总，抄送老板）
 * 数据：美团管家（插件每天早上查的 gj）+ 门店经营日报（评分、差评、营业额兜底）
 * 环比 = 上周同一天（周报比上一周、月报比上个月）；同比 = 去年同星期几（往前 364 天）/ 去年同月
 */
'use strict';
const { addDays, ymd } = require('./gj');
const DAY = 864e5;
const STORES = ['深圳华强北燕南店', '深圳前海HOP店', '深圳白石洲店', '深圳蛇口招商花园城店', '广州江南西店', '珠海玖洲道店', '惠州水东街店', '东莞东城33小镇店', '佛山创意产业园店', '佛山保利西街店'];
const ALIAS = { '深圳福田华强北店': '深圳华强北燕南店', '华强北': '深圳华强北燕南店', '深圳宝安HOP天地店': '深圳前海HOP店', '宝安HOP天地店': '深圳前海HOP店', '前海HOP店': '深圳前海HOP店', '佛山灯湖西街': '佛山保利西街店', '佛山灯湖西街店': '佛山保利西街店', '佛山东湖西街': '佛山保利西街店', '蛇口花园城店': '深圳蛇口招商花园城店', '粤迹花园城店': '深圳蛇口招商花园城店', '深圳招商花园城店': '深圳蛇口招商花园城店', '东莞33小镇店': '东莞东城33小镇店' };
const canon = s => { s = String(s || '').replace(/\s+/g, '').trim(); return ALIAS[s] || ALIAS[s.replace(/店$/, '')] || s; };
const short = s => String(s).replace(/^(深圳|广州|佛山|珠海|东莞|惠州)/, '').replace(/店$/, '');
const DRINK = /柠檬茶|可乐|雪碧|芬达|啤酒|纯生|蓝妹|青岛|百威|哈尔滨|珠江|喜力|王老吉|加多宝|椰汁|椰子水|豆奶|果汁|饮料|矿泉水|苏打|凉茶|酸梅汤|奶茶|汽水|生啤|扎啤|白酒|红酒|米酒|^茶|菊花茶|柠檬水|鸳鸯|维他/;
const W = '日一二三四五六';
const wk = d => '周' + W[new Date(d + 'T00:00:00Z').getUTCDay()];
const fmt = n => n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US');
const wan = n => n == null || !isFinite(n) ? '—' : (Math.abs(n) >= 1e4 ? (n / 1e4).toFixed(n >= 1e5 ? 1 : 2).replace(/\.?0+$/, '') + '万' : fmt(n));
const pc = (a, b) => a == null || b == null || !b ? null : (a - b) / b;
const ps = x => x == null || !isFinite(x) ? '—' : (x > 0 ? '+' : '') + Math.round(x * 100) + '%';
const dec = (n, k) => n == null || !isFinite(n) ? '—' : (+n).toFixed(k == null ? 1 : k);
const val = v => { if (v == null) return ''; if (typeof v === 'object') { if (Array.isArray(v)) return v.map(x => x && typeof x === 'object' ? (x.text || x.name || '') : String(x)).join(''); return v.text || v.name || (v.value != null ? val(v.value) : ''); } return v; };
const num = v => { const x = val(v); if (typeof x === 'number') return x; const m = String(x).replace(/,/g, '').match(/(-?[\d.]+)/); return m ? parseFloat(m[1]) : null; };

function createOpsReport({ gj, store, chat, log }) {
  // 门店经营日报（门店每晚在群里发的）：按 店×日期
  function dailyRows(from, to) {
    const out = {}; if (!store || !store.ok) return out;
    let rows = []; try { rows = store.queryDaily({ from: Date.parse(from + 'T00:00:00+08:00') - 12 * 3600e3, to: Date.parse(to + 'T23:59:59+08:00') }); } catch (e) { }
    for (const f of rows) { const d = typeof f['日期'] === 'number' ? ymd(f['日期']) : null; const s = canon(val(f['门店'])); if (d && s) (out[s] = out[s] || {})[d] = f; }
    return out;
  }
  const rep = (R, s, d) => (R[s] || {})[d] || null;
  function storeDay(G, R, s, d) { // 某店某天：管家优先，日报兜底
    const g = G && G.stores[s]; const r = rep(R, s, d);
    const o = { store: s, src: g ? '管家' : (r ? '日报' : '') };
    if (g) Object.assign(o, { total: g.total, dine: g.dine != null ? g.dine : g.revenue, takeout: g.takeout, tables: g.tables, guests: g.guests, orders: g.orders, tableAvg: g.tableAvg, perCap: g.perCap, flip: g.flip, seatRate: g.seatRate, mealMin: g.mealMin, discount: g.discount, peak: g.peak, hours: g.hours, top: (g.top || []).filter(x => !DRINK.test(x.name)).slice(0, 5), drinks: (g.top || []).filter(x => DRINK.test(x.name)).slice(0, 3) });
    else if (r) Object.assign(o, { total: num(r['总营业额']), dine: num(r['到店消费']), takeout: num(r['外卖']) });
    if (r) Object.assign(o, { rTotal: num(r['总营业额']), dp: num(r['点评评分']), mt: num(r['美团评分']), dy: num(r['抖音评分']), wm: num(r['外卖评分']), dpBad: num(r['点评差评']) || 0, mtBad: num(r['美团差评']) || 0, dyBad: num(r['抖音差评']) || 0, wmBad: num(r['外卖差评']) || 0, checkins: num(r['收藏打卡']) });
    return o;
  }

  // ---------- 日报 ----------
  function dailyData(d) {
    d = d || addDays(ymd(Date.now()), -1); const lw = addDays(d, -7), ly = addDays(d, -364);
    const R = dailyRows(addDays(d, -364), d); const G = gj.day(d), GW = gj.day(lw), GY = gj.day(ly);
    const rows = []; for (const s of STORES) {
      const a = storeDay(G, R, s, d); if (!a.src) { rows.push({ store: s, missing: true }); continue; }
      const w = storeDay(GW, R, s, lw), y = storeDay(GY, R, s, ly);
      const cmp = k => ({ wow: pc(a[k], w[k]), yoy: pc(a[k], y[k]) });
      rows.push(Object.assign(a, { c: { total: cmp('total'), dine: cmp('dine'), takeout: cmp('takeout'), tables: cmp('tables'), guests: cmp('guests'), perCap: cmp('perCap'), tableAvg: cmp('tableAvg') }, last: { wTotal: w.total, yTotal: y.total } }));
    }
    const has = rows.filter(r => !r.missing); const sum = (L, k) => L.reduce((t, r) => t + (r[k] || 0), 0);
    const T = { total: sum(has, 'total'), dine: sum(has, 'dine'), takeout: sum(has, 'takeout'), tables: sum(has, 'tables'), guests: sum(has, 'guests') };
    const wHas = has.filter(r => r.last.wTotal), wT = wHas.reduce((t, r) => t + r.last.wTotal, 0), wA = wHas.reduce((t, r) => t + (r.total || 0), 0), yHas = has.filter(r => r.last.yTotal), yT = yHas.reduce((t, r) => t + r.last.yTotal, 0), yA = yHas.reduce((t, r) => t + (r.total || 0), 0);
    T.wow = wT ? pc(wA, wT) : null; T.yoy = yT ? pc(yA, yT) : null; T.yoyN = yHas.length;
    T.bad = has.reduce((t, r) => t + (r.dpBad || 0) + (r.mtBad || 0) + (r.dyBad || 0) + (r.wmBad || 0), 0);
    return { date: d, week: wk(d), rows, T, gjOk: !!G, gjStatus: gj.status() };
  }
  function storeLine(r) {
    if (r.missing) return `【${short(r.store)}】昨天没有数据（管家没查到、门店也没发日报）`;
    const L = [];
    L.push(`【${short(r.store)}】营业额 ${wan(r.total)}（环比 ${ps(r.c.total.wow)}，同比 ${ps(r.c.total.yoy)}）`);
    L.push(`  堂食 ${wan(r.dine)}（${ps(r.c.dine.wow)}）· 外卖 ${wan(r.takeout)}（${ps(r.c.takeout.wow)}）`);
    if (r.src === '管家') {
      L.push(`  开台 ${fmt(r.tables)}（${ps(r.c.tables.wow)}）· 人数 ${fmt(r.guests)}（${ps(r.c.guests.wow)}）· 桌均 ${fmt(r.tableAvg)} · 人均 ${fmt(r.perCap)}（${ps(r.c.perCap.wow)}）${r.flip ? ' · 翻台 ' + dec(r.flip, 2) : ''}`);
      if (r.peak) L.push(`  晚市高峰 ${r.peak.hh} 开台 ${r.peak.tables}${r.mealMin ? ' · 平均用餐 ' + r.mealMin + ' 分钟' : ''}`);
      if (r.top && r.top.length) L.push(`  销量前五：${r.top.map(x => `${x.name.replace(/[（(].*?[)）]/g, '').slice(0, 10)} ${x.qty}`).join('、')}`);
    } else L.push('  （管家数据没查到，先用门店日报的数）');
    const sc = [['点评', r.dp], ['美团', r.mt], ['抖音', r.dy], ['外卖', r.wm]].filter(x => x[1] != null).map(x => x[0] + ' ' + x[1]).join(' · ');
    const bad = (r.dpBad || 0) + (r.mtBad || 0) + (r.dyBad || 0) + (r.wmBad || 0);
    if (sc || bad) L.push(`  评分 ${sc || '—'}｜差评 ${bad}${bad ? '（' + [['点评', r.dpBad], ['美团', r.mtBad], ['抖音', r.dyBad], ['外卖', r.wmBad]].filter(x => x[1]).map(x => x[0] + x[1]).join('、') + '）' : ''}`);
    return L.join('\n');
  }
  async function ai(kind, facts) {
    if (!chat) return '';
    const p = `你是连锁餐饮（海鲜大排档「YES也是大排档」+ 粤菜「粤迹」）的运营分析助手，给运营副总写${kind}点评。\n要求：只用下面给的数字，不许编数字；口语、具体；不超过 8 行；先说整体，再点名 2–3 家最需要关注的店（涨得好的也可以点一家），每家一句原因判断（从人数、人均、开台、外卖、差评里找）+ 一个今天能做的动作；数据缺的就说缺，不要猜。环比=上周同一天，同比=去年同星期几。\n数据：${JSON.stringify(facts).slice(0, 9000)}`;
    try { return String(await chat(p, 900) || '').trim(); } catch (e) { log('[运营日报] AI 分析失败：' + e.message); return ''; }
  }
  const compact = D => D.rows.filter(r => !r.missing).map(r => ({ 店: short(r.store), 营业额: Math.round(r.total || 0), 环比: ps(r.c.total.wow), 同比: ps(r.c.total.yoy), 堂食: Math.round(r.dine || 0), 堂食环比: ps(r.c.dine.wow), 外卖: Math.round(r.takeout || 0), 外卖环比: ps(r.c.takeout.wow), 开台: r.tables, 开台环比: ps(r.c.tables.wow), 人数: r.guests, 人数环比: ps(r.c.guests.wow), 人均: r.perCap && Math.round(r.perCap), 人均环比: ps(r.c.perCap.wow), 差评: (r.dpBad || 0) + (r.mtBad || 0) + (r.dyBad || 0) + (r.wmBad || 0), 美团分: r.mt, 点评分: r.dp }));
  async function daily(d) {
    const D = dailyData(d); const T = D.T;
    const head = [`📊 运营日报 · ${D.date.slice(5).replace('-', '/')}（${D.week}）`, `全部门店营业额 ${wan(T.total)}（环比 ${ps(T.wow)}，同比 ${ps(T.yoy)}${T.yoyN && T.yoyN < D.rows.filter(r => !r.missing).length ? '，' + T.yoyN + ' 家有去年数据' : ''}）`, `堂食 ${wan(T.dine)} · 外卖 ${wan(T.takeout)} · 开台 ${fmt(T.tables)} · 人数 ${fmt(T.guests)} · 差评 ${T.bad} 条`];
    if (!D.gjOk) head.push('⚠️ 美团管家昨天的数据还没查到（插件可能没跑），下面先用门店日报的数；开台、人数、菜品等管家数据缺。');
    const rows = D.rows.filter(r => !r.missing).sort((a, b) => (b.total || 0) - (a.total || 0)).concat(D.rows.filter(r => r.missing));
    const body = rows.map(storeLine).join('\n\n');
    const an = await ai('日报', { 日期: D.date + D.week, 合计: { 营业额: Math.round(T.total), 环比: ps(T.wow), 同比: ps(T.yoy), 堂食: Math.round(T.dine), 外卖: Math.round(T.takeout) }, 门店: compact(D) });
    const tail = '\n\n说明：环比 = 和上周同一天比；同比 = 和去年同一个星期几比。营业额含外卖；桌均、人均按堂食算。同商圈对比、新老客占比、差评原文正在接入（美团经营宝），接好后自动加进来。';
    return { data: D, text: head.join('\n') + '\n\n' + body + (an ? '\n\n🤖 分析\n' + an : '') + tail };
  }

  // ---------- 周报 / 月报 ----------
  function periodData(from, to, pFrom, pTo, yFrom, yTo, kind) {
    const A = gj.range(from, to), P = gj.range(pFrom, pTo), Y = gj.range(yFrom, yTo);
    const R = dailyRows(yFrom, to); const repSum = (s, f, t) => { let v = 0, n = 0; for (let d = f; d <= t; d = addDays(d, 1)) { const r = rep(R, s, d); if (r && num(r['总营业额'])) { v += num(r['总营业额']); n++; } } return n ? { v, n } : null; };
    const span = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
    const rows = STORES.map(s => {
      const a = A.stores[s], p = P.stores[s], y = Y.stores[s];
      const full = x => x && x.days >= span - 1; // 管家数据基本齐才用
      const tot = x => x ? x.total : null;
      const aT = full(a) ? a.total : (repSum(s, from, to) || {}).v, pT = full(p) ? p.total : (repSum(s, pFrom, pTo) || {}).v, yT = full(y) ? y.total : (repSum(s, yFrom, yTo) || {}).v;
      if (aT == null) return { store: s, missing: true };
      return { store: s, total: aT, prev: pT, ly: yT, wow: pc(aT, pT), yoy: pc(aT, yT), dine: a && a.dine, takeout: a && a.takeout, tables: a && a.tables, guests: a && a.guests, perCap: a && a.perCap, tableAvg: a && a.tableAvg, pTables: p && p.tables, pGuests: p && p.guests, pPerCap: p && p.perCap, top: a ? a.top.filter(x => !DRINK.test(x.name)).slice(0, 5) : [], gjDays: a ? a.days : 0, _t: tot(a) };
    });
    const has = rows.filter(r => !r.missing); const sum = k => has.reduce((t, r) => t + (r[k] || 0), 0);
    const T = { total: sum('total'), dine: sum('dine'), takeout: sum('takeout'), tables: sum('tables'), guests: sum('guests') };
    const pH = has.filter(r => r.prev), yH = has.filter(r => r.ly);
    T.wow = pH.length ? pc(pH.reduce((t, r) => t + r.total, 0), pH.reduce((t, r) => t + r.prev, 0)) : null; T.yoy = yH.length ? pc(yH.reduce((t, r) => t + r.total, 0), yH.reduce((t, r) => t + r.ly, 0)) : null;
    return { kind, from, to, rows, T, span };
  }
  async function period(kind) {
    const today = ymd(Date.now()); let D;
    if (kind === 'week') { const end = addDays(today, -1); const back = new Date(end + 'T00:00:00Z').getUTCDay(); const sun = addDays(end, -back); const mon = addDays(sun, -6); D = periodData(mon, sun, addDays(mon, -7), addDays(sun, -7), addDays(mon, -364), addDays(sun, -364), '周报'); }
    else { const t = new Date(Date.now() + 8 * 3600e3); const y = t.getUTCFullYear(), m = t.getUTCMonth(); const f = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10), e = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); const pf = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10), pe = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10); const yf = new Date(Date.UTC(y - 1, m - 1, 1)).toISOString().slice(0, 10), ye = new Date(Date.UTC(y - 1, m, 0)).toISOString().slice(0, 10); D = periodData(f, e, pf, pe, yf, ye, '月报'); }
    const T = D.T; const lbl = D.kind === '周报' ? ['上周', '去年同期'] : ['上个月', '去年同月'];
    const head = [`📅 运营${D.kind} · ${D.from.slice(5).replace('-', '/')}–${D.to.slice(5).replace('-', '/')}`, `全部门店营业额 ${wan(T.total)}（比${lbl[0]} ${ps(T.wow)}，比${lbl[1]} ${ps(T.yoy)}）`, `堂食 ${wan(T.dine)} · 外卖 ${wan(T.takeout)} · 开台 ${fmt(T.tables)} · 人数 ${fmt(T.guests)}`];
    const body = D.rows.filter(r => !r.missing).sort((a, b) => b.total - a.total).map(r => {
      const L = [`【${short(r.store)}】${wan(r.total)}（比${lbl[0]} ${ps(r.wow)}，比${lbl[1]} ${ps(r.yoy)}）`];
      if (r.gjDays) L.push(`  堂食 ${wan(r.dine)} · 外卖 ${wan(r.takeout)} · 开台 ${fmt(r.tables)}（${ps(pc(r.tables, r.pTables))}）· 人数 ${fmt(r.guests)}（${ps(pc(r.guests, r.pGuests))}）· 人均 ${fmt(r.perCap)}（${ps(pc(r.perCap, r.pPerCap))}）`);
      if (r.top.length) L.push(`  销量前五：${r.top.map(x => `${x.name.replace(/[（(].*?[)）]/g, '').slice(0, 10)} ${x.qty}`).join('、')}`);
      return L.join('\n');
    }).join('\n\n');
    const an = await ai(D.kind, { 期间: D.from + '~' + D.to, 合计: { 营业额: Math.round(T.total), 比上期: ps(T.wow), 同比: ps(T.yoy) }, 门店: D.rows.filter(r => !r.missing).map(r => ({ 店: short(r.store), 营业额: Math.round(r.total), 比上期: ps(r.wow), 同比: ps(r.yoy), 开台: r.tables, 开台变化: ps(pc(r.tables, r.pTables)), 人数变化: ps(pc(r.guests, r.pGuests)), 人均: r.perCap && Math.round(r.perCap), 人均变化: ps(pc(r.perCap, r.pPerCap)) })) });
    return { data: D, text: head.join('\n') + '\n\n' + body + (an ? '\n\n🤖 分析\n' + an : '') + '\n\n说明：管家数据没覆盖到的时段，营业额用门店日报补；同比按去年同期。' };
  }

  // 驾驶舱用：近 N 天每店营业额走势
  function trend(days) {
    const end = addDays(ymd(Date.now()), -1); const R = dailyRows(addDays(end, -(days - 1)), end); const out = [];
    for (let k = days - 1; k >= 0; k--) { const d = addDays(end, -k); const G = gj.day(d); const o = { date: d }; for (const s of STORES) { const x = storeDay(G, R, s, d); o[short(s)] = x.total != null ? Math.round(x.total) : null; } out.push(o); }
    return out;
  }
  return { daily, dailyData, period, trend, STORES: STORES.map(short) };
}
module.exports = { createOpsReport };
