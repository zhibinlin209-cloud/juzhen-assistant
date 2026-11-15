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
    if (g) Object.assign(o, { total: g.total, dine: g.dine != null ? g.dine : g.revenue, takeout: g.takeout, tables: g.tables, guests: g.guests, orders: g.orders, tableAvg: g.tableAvg, perCap: g.perCap, flip: g.flip, seats: g.seats, openRate: g.openRate, seg: g.seg, refund: g.refund, gift: g.gift, seatRate: g.seatRate, mealMin: g.mealMin, discount: g.discount, peak: g.peak, hours: g.hours, top: (g.top || []).filter(x => !DRINK.test(x.name)).slice(0, 5), topAll: g.top || [], drinks: (g.top || []).filter(x => DRINK.test(x.name)).slice(0, 3) });
    else if (r) Object.assign(o, { total: num(r['总营业额']), dine: num(r['到店消费']), takeout: num(r['外卖']) });
    if (r) Object.assign(o, { rTotal: num(r['总营业额']), dp: num(r['点评评分']), mt: num(r['美团评分']), dy: num(r['抖音评分']), wm: num(r['外卖评分']), dpBad: num(r['点评差评']) || 0, mtBad: num(r['美团差评']) || 0, dyBad: num(r['抖音差评']) || 0, wmBad: num(r['外卖差评']) || 0, checkins: num(r['收藏打卡']), loss: num(r['报损']) });
    return o;
  }

  // ---------- 任意时段（日 / 周 / 月 / 自定义）：每店合计 + 环比 + 同比 ----------
  // 环比：日 = 上周同一天；周 = 上一周；月 = 上个月；自定义 = 紧挨着的前一段同样天数。同比：月 = 去年同月；其他 = 往前 364 天（同星期几）
  const span = (f, t) => Math.round((Date.parse(t) - Date.parse(f)) / DAY) + 1;
  const monthShift = (d, k) => { const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1 + k; const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12; const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate(); return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(+d.slice(8), last)).padStart(2, '0')}`; };
  const monthEnd = d => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return `${d.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
  function periods(mode, from, to) {
    const n = span(from, to);
    if (mode === 'month') { const pf = monthShift(from.slice(0, 7) + '-01', -1); return { prev: [pf, n >= span(from.slice(0, 7) + '-01', monthEnd(from)) ? monthEnd(pf) : addDays(pf, n - 1)], ly: [monthShift(from, -12), monthShift(to, -12)], prevName: '上个月', lyName: '去年同月' }; }
    if (mode === 'day' || n === 1) return { prev: [addDays(from, -7), addDays(to, -7)], ly: [addDays(from, -364), addDays(to, -364)], prevName: '上周同一天', lyName: '去年同星期几' };
    if (mode === 'week') return { prev: [addDays(from, -7), addDays(to, -7)], ly: [addDays(from, -364), addDays(to, -364)], prevName: '上一周', lyName: '去年同周' };
    return { prev: [addDays(from, -n), addDays(from, -1)], ly: [addDays(from, -364), addDays(to, -364)], prevName: `前 ${n} 天`, lyName: '去年同期' };
  }
  // 合计 + 分市 + 全品牌每小时 + 「重点 / 异常」清单（驾驶舱顶部和日报开头共用）
  function totals(has, rows, n) {
    const sum = (L, f) => L.reduce((t, r) => t + (f(r) || 0), 0); const T = {};
    T.ftables = sum(has, r => r.ftables); T.seatDays = sum(has, r => r.seatDays); T.flip = T.seatDays ? T.ftables / T.seatDays : null;
    const pv = has.filter(r => r.prev && r.prev.seatDays); const pF = sum(pv, r => r.prev.seatDays) ? sum(pv, r => r.prev.ftables) / sum(pv, r => r.prev.seatDays) : null; T.flipPrev = pF; T.flipWow = pc(T.flip, pF);
    T.seg = {}; for (const k of ['meal', 'lunch', 'dinner', 'night']) { const L = has.filter(r => r.seg && r.seg[k]); const z = { amt: sum(L, r => r.seg[k].amt), tables: sum(L, r => r.seg[k].tables), seatDays: sum(L, r => r.seg[k].seatDays) }; z.flip = z.seatDays ? z.tables / z.seatDays : null;
      const P = L.filter(r => r.prev && r.prev.seg && r.prev.seg[k]); const pa = sum(P, r => r.prev.seg[k].amt), pt = sum(P, r => r.prev.seg[k].tables), ps_ = sum(P, r => r.prev.seg[k].seatDays); const ca = sum(P, r => r.seg[k].amt), ct = sum(P, r => r.seg[k].tables), cs = sum(P, r => r.seg[k].seatDays);
      z.amtWow = pa ? pc(ca, pa) : null; z.flipWow = ps_ && cs && pt ? pc(ct / cs, pt / ps_) : null; if (L.length) T.seg[k] = z; }
    const R = has.filter(r => r.refundAmt != null); T.refund = R.length ? sum(R, r => r.refundAmt) : null; T.refundCnt = R.length ? sum(R, r => r.refundCnt) : null; const RP = R.filter(r => r.prev && r.prev.refundAmt != null); T.refundWow = RP.length ? pc(sum(RP, r => r.refundAmt), sum(RP, r => r.prev.refundAmt)) : null;
    const Gs = has.filter(r => r.giftAmt != null); T.gift = Gs.length ? sum(Gs, r => r.giftAmt) : null; T.giftManual = Gs.length ? sum(Gs, r => r.giftManual) : null; T.giftPromo = Gs.length ? sum(Gs, r => r.giftPromo) : null; const GP = Gs.filter(r => r.prev && r.prev.giftAmt != null); T.giftWow = GP.length ? pc(sum(GP, r => r.giftAmt), sum(GP, r => r.prev.giftAmt)) : null;
    const C = has.filter(r => r.cc); if (C.length) { T.collect = sum(C, r => r.cc.collect); T.checkin = sum(C, r => r.cc.checkin); const CP = C.filter(r => r.cc.collectPeer != null); T.collectPeer = CP.length ? sum(CP, r => r.cc.collectPeer) : null; T.checkinPeer = CP.length ? sum(CP, r => r.cc.checkinPeer) : null; T.collectPeerX = CP.length && T.collectPeer ? sum(CP, r => r.cc.collect) / T.collectPeer : null; T.checkinPeerX = CP.length && T.checkinPeer ? sum(CP, r => r.cc.checkin) / T.checkinPeer : null; const CW2 = C.filter(r => r.cc.prevCollect != null); T.collectWow = CW2.length ? pc(sum(CW2, r => r.cc.collect), sum(CW2, r => r.cc.prevCollect)) : null; T.checkinWow = CW2.length ? pc(sum(CW2, r => r.cc.checkin), sum(CW2, r => r.cc.prevCheckin)) : null; }
    const Ls = has.filter(r => r.loss != null); T.loss = Ls.length ? sum(Ls, r => r.loss) : null; T.lossN = Ls.length; const LP = Ls.filter(r => r.prev && r.prev.loss != null); T.lossWow = LP.length ? pc(sum(LP, r => r.loss), sum(LP, r => r.prev.loss)) : null;
    const H = {}; let seats = 0; for (const r of has) { if (!(r.hoursCmp || []).length) continue; seats += r.seats || 0; for (const h of r.hoursCmp) { const q = H[h.hh] = H[h.hh] || { hh: h.hh, tables: 0, prev: null, amt: 0, prevAmt: null }; q.tables += h.tables || 0; q.amt += h.amt || 0; if (h.prev != null) q.prev = (q.prev || 0) + h.prev; if (h.prevAmt != null) q.prevAmt = (q.prevAmt || 0) + h.prevAmt; } }
    const hk = hh => { const h = +String(hh).slice(0, 2); return h < 6 ? h + 24 : h; };
    T.hours = Object.values(H).sort((a, b) => hk(a.hh) - hk(b.hh)).map(h => Object.assign(h, { flip: seats ? h.tables / seats : null }));
    // 重点 / 异常
    const A = []; const S = r => short(r.store).replace('蛇口招商花园城', '花园城（粤迹）').replace('华强北燕南', '华强北').replace('东城33小镇', '33小镇');
    const down = has.filter(r => r.c.total.wow != null && r.c.total.wow < -0.1).sort((a, b) => a.c.total.wow - b.c.total.wow);
    for (const r of down.slice(0, 4)) { const hd = (r.hoursCmp || []).filter(h => h.prev != null).map(h => Object.assign({ d: h.tables - h.prev }, h)).sort((a, b) => a.d - b.d)[0]; const why = []; if (r.c.tables.wow != null && r.c.tables.wow < -0.08) why.push(`开台 ${ps(r.c.tables.wow)}`); if (r.c.perCap.wow != null && r.c.perCap.wow < -0.08) why.push(`人均 ${ps(r.c.perCap.wow)}`); if (r.c.takeout.wow != null && r.c.takeout.wow < -0.2 && r.takeout > 2000) why.push(`外卖 ${ps(r.c.takeout.wow)}`); if (hd && hd.d <= -2) why.push(`${String(hd.hh).slice(0, 2)} 点少开 ${Math.round(-hd.d)} 桌`);
      A.push({ lvl: 'bad', store: r.store, text: `${S(r)} 营业额 ${ps(r.c.total.wow)}${why.length ? '：' + why.join('，') : ''}` }); }
    const fl = has.filter(r => r.flip != null).sort((a, b) => a.flip - b.flip);
    if (fl.length >= 3) { const avg = T.flip; const b = fl[0]; A.push({ lvl: 'bad', store: b.store, text: `翻台垫底：${S(b)} ${dec(b.flip, 2)}（全品牌 ${dec(avg, 2)}）${b.c.flip.wow != null ? '，比上期 ' + ps(b.c.flip.wow) : ''}` }); }
    const hdrop = T.hours.filter(h => h.prev != null && h.prev >= 3).map(h => Object.assign({ d: h.tables - h.prev, r: pc(h.tables, h.prev) }, h)).filter(h => h.d <= -3 && h.r <= -0.15).sort((a, b) => a.d - b.d).slice(0, 2);
    for (const h of hdrop) A.push({ lvl: 'warn', text: `${String(h.hh).slice(0, 2)} 点时段全品牌少开 ${Math.round(-h.d)} 桌（${ps(h.r)}）` });
    if (T.seg.night && T.seg.night.amtWow != null && T.seg.night.amtWow < -0.1) A.push({ lvl: 'warn', text: `宵夜营收 ${ps(T.seg.night.amtWow)}，翻台 ${dec(T.seg.night.flip, 2)}（${ps(T.seg.night.flipWow)}）` });
    if (T.seg.meal && T.seg.meal.amtWow != null && T.seg.meal.amtWow < -0.1) A.push({ lvl: 'warn', text: `饭市营收 ${ps(T.seg.meal.amtWow)}，翻台 ${dec(T.seg.meal.flip, 2)}（${ps(T.seg.meal.flipWow)}）` });
    const rf = has.filter(r => r.refundAmt && r.dine).map(r => ({ r, x: r.refundAmt / r.dine })).sort((a, b) => b.x - a.x)[0];
    if (rf && rf.x >= 0.01) A.push({ lvl: 'warn', store: rf.r.store, text: `退菜最多：${S(rf.r)} 退 ${fmt(rf.r.refundAmt)} 元（占堂食 ${(rf.x * 100).toFixed(1)}%）${(rf.r.refundTop || [])[0] ? '，最多是 ' + rf.r.refundTop[0].name.replace(/[（(].*?[)）]/g, '').slice(0, 10) : ''}` });
    const lo = has.filter(r => r.loss && r.dine).map(r => ({ r, x: r.loss / r.dine })).sort((a, b) => b.x - a.x)[0];
    if (lo && lo.x >= 0.01) A.push({ lvl: 'warn', store: lo.r.store, text: `报损最高：${S(lo.r)} ${fmt(lo.r.loss)} 元（占堂食 ${(lo.x * 100).toFixed(1)}%）${lo.r.c.loss.wow != null ? '，比上期 ' + ps(lo.r.c.loss.wow) : ''}` });
    const gf = has.filter(r => r.giftManual && r.dine).map(r => ({ r, x: r.giftManual / r.dine })).sort((a, b) => b.x - a.x)[0];
    if (gf && gf.x >= 0.01) A.push({ lvl: 'warn', store: gf.r.store, text: `手动赠菜最多：${S(gf.r)} ${fmt(gf.r.giftManual)} 元（占堂食 ${(gf.x * 100).toFixed(1)}%）${gf.r.c.gift.wow != null ? '，赠菜合计比上期 ' + ps(gf.r.c.gift.wow) : ''}` });
    const ck = has.filter(r => r.cc && r.cc.checkinPeer).map(r => ({ r, x: r.cc.checkin / r.cc.checkinPeer })).sort((a, b) => a.x - b.x)[0];
    if (ck && ck.x < 3) A.push({ lvl: 'warn', store: ck.r.store, text: `打卡最弱：${S(ck.r)} 打卡 ${fmt(ck.r.cc.checkin)} 人，是同行店均的 ${ck.x.toFixed(1)} 倍${ck.r.cc.checkinWow != null ? '，比上期 ' + ps(ck.r.cc.checkinWow) : ''}` });
    const bad = has.map(r => ({ r, n: Math.max((r.dpBad || 0) + (r.mtBad || 0) + (r.dyBad || 0) + (r.wmBad || 0), (r.badText || []).length) })).filter(z => z.n).sort((a, b) => b.n - a.n);
    if (bad.length) A.push({ lvl: 'warn', text: `差评：${bad.slice(0, 3).map(z => S(z.r) + ' ' + z.n + ' 条').join('、')}` });
    const best = has.filter(r => r.c.total.wow != null).sort((a, b) => b.c.total.wow - a.c.total.wow)[0];
    if (best && best.c.total.wow > 0.05) A.push({ lvl: 'good', store: best.store, text: `涨得最好：${S(best)} ${ps(best.c.total.wow)}${best.c.tables.wow != null ? '（开台 ' + ps(best.c.tables.wow) + '）' : ''}` });
    T.alerts = A; return T;
  }
  function rangeData(from, to, mode) {
    const yday = addDays(ymd(Date.now()), -1); if (to > yday) to = yday; if (from > to) from = to;
    const P = periods(mode, from, to); const n = span(from, to);
    const lo = [from, P.prev[0], P.ly[0]].sort()[0]; const R = dailyRows(lo, to);
    const GC = new Map(); const gd = d => { if (!GC.has(d)) GC.set(d, gj.day(d)); return GC.get(d); };
    const days = (f, t) => { const a = []; for (let d = f; d <= t; d = addDays(d, 1)) a.push(d); return a; };
    function agg(s, f, t, full) {
      const o = { store: s, src: '', total: 0, dine: 0, takeout: 0, tables: 0, guests: 0, orders: 0, discount: 0, n: 0, gjN: 0, tkN: 0, seatDays: 0, ftables: 0, refundAmt: null, refundCnt: null, giftAmt: null, giftManual: null, giftPromo: null, loss: null, lossN: 0, seg: null }; const dishes = {}, hrs = {}; let flip = [], meal = [], open = [], last = null;
      for (const d of days(f, t)) {
        const x = storeDay(gd(d), R, s, d); if (!x.src) continue; o.n++; if (x.src === '管家') o.gjN++;
        for (const k of ['total', 'dine', 'takeout', 'tables', 'guests', 'orders', 'discount']) o[k] += x[k] || 0; if (x.takeout != null) o.tkN++;
        if (x.seats && x.tables != null && x.src === '管家') { o.seatDays += x.seats; o.ftables += x.tables; o.seats = x.seats; }
        if (x.refund) { o.refundAmt = (o.refundAmt || 0) + (x.refund.amt || 0); o.refundCnt = (o.refundCnt || 0) + (x.refund.cnt || 0); if (full) for (const z of x.refund.top || []) { const q = (o._rt = o._rt || {})[z.name] = (o._rt || {})[z.name] || { name: z.name, cnt: 0, amt: 0 }; q.cnt += z.cnt; q.amt += z.amt; } }
        if (x.gift) { o.giftAmt = (o.giftAmt || 0) + (x.gift.total || 0); o.giftManual = (o.giftManual || 0) + (x.gift.manual || 0); o.giftPromo = (o.giftPromo || 0) + (x.gift.promo || 0); if (full) for (const z of x.gift.types || []) { const t = o._gt = o._gt || {}; t[z.name] = (t[z.name] || 0) + z.amt; } }
        if (x.loss != null) { o.loss = (o.loss || 0) + x.loss; o.lossN++; }
        if (x.seg) { o.seg = o.seg || {}; for (const [k, z] of Object.entries(x.seg)) { const q = o.seg[k] = o.seg[k] || { tables: 0, people: 0, amt: 0, seatDays: 0 }; q.tables += z.tables; q.people += z.people; q.amt += z.amt; q.seatDays += x.seats || 0; } }
        for (const h of x.hours || []) { const q = hrs[h.hh] = hrs[h.hh] || { hh: h.hh, tables: 0, people: 0, amt: 0 }; q.tables += h.tables || 0; q.people += h.people || 0; q.amt += h.amt || 0; }
        if (x.openRate != null) open.push(x.openRate);
        if (!full) continue;
        if (x.flip) flip.push(x.flip); if (x.mealMin) meal.push(x.mealMin);
        for (const z of x.topAll || []) { const q = dishes[z.name] = dishes[z.name] || { name: z.name, qty: 0, amt: 0 }; q.qty += z.qty || 0; q.amt += z.amt || 0; }
        if (x.rTotal != null || x.dp != null || x.mt != null) last = x;
        for (const k of ['dpBad', 'mtBad', 'dyBad', 'wmBad']) o[k] = (o[k] || 0) + (x[k] || 0);
      }
      if (!o.n) return null;
      o.src = o.gjN ? '管家' : '日报'; o.tableAvg = o.tables ? o.dine / o.tables : null; o.perCap = o.guests ? o.dine / o.guests : null; if (!o.tables) o.tables = o.gjN ? 0 : null; if (!o.guests) o.guests = o.gjN ? 0 : null;
      // 翻台率（实际桌数）：消费桌数 ÷（桌数 × 天数）；分市同理；每小时 = 平均每天该小时开台 ÷ 桌数
      o.flip = o.seatDays ? o.ftables / o.seatDays : null; o.openRate = open.length ? open.reduce((a, b) => a + b, 0) / open.length : null;
      if (o.seg) for (const z of Object.values(o.seg)) { z.flip = z.seatDays ? z.tables / z.seatDays : null; }
      { const hk = hh => { const h = +String(hh).slice(0, 2); return h < 6 ? h + 24 : h; }; const nd = Math.max(1, o.gjN); o.hours = Object.values(hrs).sort((a, b) => hk(a.hh) - hk(b.hh)).map(h => ({ hh: h.hh, tables: h.tables / nd, people: h.people / nd, amt: h.amt / nd, flip: o.seats ? h.tables / nd / o.seats : null })); }
      if (o._gt) { o.giftTop = Object.entries(o._gt).sort((p, q) => q[1] - p[1]).slice(0, 4).map(([name, amt]) => ({ name, amt })); delete o._gt; }
      if (o._rt) { o.refundTop = Object.values(o._rt).sort((a, b) => b.amt - a.amt).slice(0, 5); delete o._rt; }
      if (full) {
        const all = Object.values(dishes).sort((a, b) => b.qty - a.qty); o.top = all.filter(z => !DRINK.test(z.name)).slice(0, 15); o.drinks = all.filter(z => DRINK.test(z.name)).slice(0, 3);
        const hk = hh => { const h = +String(hh).slice(0, 2); return h < 6 ? h + 24 : h; }; o.peak = o.hours.filter(h => hk(h.hh) >= 16).sort((a, b) => b.tables - a.tables)[0] || null;
        o.mealMin = meal.length ? Math.round(meal.reduce((a, b) => a + b, 0) / meal.length) : null;
        if (last) Object.assign(o, { dp: last.dp, mt: last.mt, dy: last.dy, wm: last.wm });
      }
      return o;
    }
    const JC = new Map(); const jd = d => { if (!JC.has(d)) JC.set(d, gj.jybDay ? gj.jybDay(d) : null); return JC.get(d); };
    function jAgg(s, f, t) { const o = { n: 0, collect: 0, collectPeer: 0, checkin: 0, checkinPeer: 0, view: 0, viewPeer: 0, pn: 0 }; for (const d of days(f, t)) { const x = (jd(d) || { stores: {} }).stores[s]; if (!x || !x.core) continue; const c = x.core; const g = (k, f2) => (c[k] && c[k][f2] != null ? c[k][f2] : null); if (g('新增收藏', 'v') == null && g('打卡人数', 'v') == null) continue; o.n++; o.collect += g('新增收藏', 'v') || 0; o.checkin += g('打卡人数', 'v') || 0; o.view += g('曝光人数', 'v') || 0; if (g('新增收藏', 'peer') != null || g('打卡人数', 'peer') != null) { o.pn++; o.collectPeer += g('新增收藏', 'peer') || 0; o.checkinPeer += g('打卡人数', 'peer') || 0; o.viewPeer += g('曝光人数', 'peer') || 0; } } return o.n ? o : null; }
    const J = []; for (const d of days(from, to)) { const j = gj.jybDay ? gj.jybDay(d) : null; if (j) J.push(j); } const CW = gj.custWeek ? gj.custWeek() : null;
    const rows = []; for (const s of STORES) {
      const a = agg(s, from, to, true); if (!a) { rows.push({ store: s, missing: true }); continue; }
      const w = agg(s, P.prev[0], P.prev[1], false), y = agg(s, P.ly[0], P.ly[1], false);
      const ok = b => b && b.n >= Math.max(1, Math.round(a.n * 0.8)); // 对比期数据要基本齐，才算环比 / 同比
      const cmp = k => ({ wow: ok(w) ? pc(a[k], w[k]) : null, yoy: ok(y) ? pc(a[k], y[k]) : null });
      const js = J.map(j => j.stores[s]).filter(Boolean);
      if (js.length) { const sumC = (k, f) => { let v = 0, c = 0; for (const x of js) { const m = (x.core || {})[k]; if (m && m[f] != null) { v += m[f]; c++; } } return c ? v : null; }; const avgC = (k, f) => { let v = 0, c = 0; for (const x of js) { const m = (x.core || {})[k]; if (m && m[f] != null) { v += m[f]; c++; } } return c ? v / c : null; };
        a.jyb = { view: sumC('曝光人数', 'v'), viewPeer: sumC('曝光人数', 'peer'), visit: sumC('访问人数', 'v'), visitPeer: sumC('访问人数', 'peer'), buy: sumC('购买人数', 'v'), buyPeer: sumC('购买人数', 'peer'), cvr: avgC('访问-购买转化率', 'v'), cvrPeer: avgC('访问-购买转化率', 'peer'), collect: sumC('新增收藏', 'v'), collectPeer: sumC('新增收藏', 'peer'), checkin: sumC('打卡人数', 'v'), checkinPeer: sumC('打卡人数', 'peer'), review: sumC('新增评价数', 'v'), reviewPeer: sumC('新增评价数', 'peer'), days: js.length };
        a.badText = js.flatMap(x => x.bad || []); }
      { const jc = jAgg(s, from, to), jp = jAgg(s, P.prev[0], P.prev[1]), jy = jAgg(s, P.ly[0], P.ly[1]); const okJ = b => jc && b && b.n >= Math.max(1, Math.round(jc.n * 0.8));
        if (jc) { a.cc = { collect: jc.collect, checkin: jc.checkin, collectPeer: jc.pn ? jc.collectPeer : null, checkinPeer: jc.pn ? jc.checkinPeer : null, days: jc.n, collectWow: okJ(jp) ? pc(jc.collect, jp.collect) : null, collectYoy: okJ(jy) ? pc(jc.collect, jy.collect) : null, checkinWow: okJ(jp) ? pc(jc.checkin, jp.checkin) : null, checkinYoy: okJ(jy) ? pc(jc.checkin, jy.checkin) : null, prevCollect: okJ(jp) ? jp.collect : null, prevCheckin: okJ(jp) ? jp.checkin : null }; } }
      const cw = CW && CW.stores[s]; if (cw) a.cust = Object.assign({ from: CW.from, to: CW.to }, cw);
      const segC = (k, f) => ({ wow: ok(w) && a.seg && w.seg && a.seg[k] && w.seg[k] ? pc(a.seg[k][f], w.seg[k][f]) : null, yoy: ok(y) && a.seg && y.seg && a.seg[k] && y.seg[k] ? pc(a.seg[k][f], y.seg[k][f]) : null });
      const cmpN = (k) => ({ wow: ok(w) && w[k] != null ? pc(a[k], w[k]) : null, yoy: ok(y) && y[k] != null ? pc(a[k], y[k]) : null });
      // 每小时：本期 vs 环比期（都按平均每天），看哪个时段掉了
      const wH = {}; if (ok(w)) for (const h of w.hours || []) wH[h.hh] = h; a.hoursCmp = (a.hours || []).map(h => ({ hh: h.hh, tables: h.tables, prev: wH[h.hh] ? wH[h.hh].tables : (ok(w) && (w.hours || []).length ? 0 : null), amt: h.amt, prevAmt: wH[h.hh] ? wH[h.hh].amt : null, flip: h.flip }));
      for (const h of (ok(w) ? w.hours || [] : [])) if (!a.hoursCmp.some(z => z.hh === h.hh)) a.hoursCmp.push({ hh: h.hh, tables: 0, prev: h.tables, amt: 0, prevAmt: h.amt, flip: 0 });
      a.prev = ok(w) ? { flip: w.flip, refundAmt: w.refundAmt, giftAmt: w.giftAmt, loss: w.loss, seg: w.seg, tables: w.tables, total: w.total, ftables: w.ftables, seatDays: w.seatDays, dine: w.dine } : null;
      rows.push(Object.assign(a, { c: { total: cmp('total'), dine: cmp('dine'), takeout: cmp('takeout'), tables: cmp('tables'), guests: cmp('guests'), perCap: cmp('perCap'), tableAvg: cmp('tableAvg'), flip: cmpN('flip'), openRate: cmpN('openRate'), refund: cmpN('refundAmt'), gift: cmpN('giftAmt'), loss: cmpN('loss'), mealAmt: segC('meal', 'amt'), mealFlip: segC('meal', 'flip'), nightAmt: segC('night', 'amt'), nightFlip: segC('night', 'flip'), lunchAmt: segC('lunch', 'amt'), dinnerAmt: segC('dinner', 'amt') }, last: { wTotal: ok(w) ? w.total : null, yTotal: ok(y) ? y.total : null } }));
    }
    const has = rows.filter(r => !r.missing); const sum = (L, k) => L.reduce((t, r) => t + (r[k] || 0), 0);
    const T = { total: sum(has, 'total'), dine: sum(has, 'dine'), takeout: sum(has, 'takeout'), tables: sum(has, 'tables'), guests: sum(has, 'guests') };
    const wHas = has.filter(r => r.last.wTotal), wT = wHas.reduce((t, r) => t + r.last.wTotal, 0), wA = wHas.reduce((t, r) => t + (r.total || 0), 0), yHas = has.filter(r => r.last.yTotal), yT = yHas.reduce((t, r) => t + r.last.yTotal, 0), yA = yHas.reduce((t, r) => t + (r.total || 0), 0);
    T.wow = wT ? pc(wA, wT) : null; T.yoy = yT ? pc(yA, yT) : null; T.yoyN = yHas.length;
    T.bad = has.reduce((t, r) => t + (r.dpBad || 0) + (r.mtBad || 0) + (r.dyBad || 0) + (r.wmBad || 0), 0);
    T.badText = has.reduce((t, r) => t + (r.badText || []).length, 0);
    Object.assign(T, totals(has, rows, n));
    const brand = {}; has.forEach(r => (r.top || []).forEach(z => { const k = z.name.replace(/[（(].*?[)）]/g, '').replace(/[.。\s]+$/, ''); brand[k] = (brand[k] || 0) + z.qty; }));
    T.top = Object.entries(brand).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, qty]) => ({ name, qty }));
    const label = n === 1 ? `${from.slice(5).replace('-', '/')}（${wk(from)}）` : mode === 'month' ? `${from.slice(0, 4)} 年 ${+from.slice(5, 7)} 月${to < monthEnd(from) ? '（到 ' + to.slice(5).replace('-', '/') + '）' : ''}` : `${from.slice(5).replace('-', '/')}–${to.slice(5).replace('-', '/')}（${n} 天）`;
    return { date: to, from, to, n, mode: mode || (n === 1 ? 'day' : 'custom'), label, week: wk(to), prevName: P.prevName, lyName: P.lyName, rows, T, gjOk: days(from, to).every(d => !!gd(d)), jybOk: J.length > 0, gjStatus: gj.status() };
  }
  // 日报用：单日
  function dailyData(d) { d = d || addDays(ymd(Date.now()), -1); return rangeData(d, d, 'day'); }
  function storeLine(r) {
    if (r.missing) return `【${short(r.store)}】昨天没有数据（管家没查到、门店也没发日报）`;
    const L = [];
    L.push(`【${short(r.store)}】营业额 ${wan(r.total)}（环比 ${ps(r.c.total.wow)}，同比 ${ps(r.c.total.yoy)}）`);
    L.push(`  堂食 ${wan(r.dine)}（${ps(r.c.dine.wow)}）· 外卖 ${wan(r.takeout)}（${ps(r.c.takeout.wow)}）`);
    if (r.src === '管家') {
      L.push(`  开台 ${fmt(r.tables)}（${ps(r.c.tables.wow)}）· 人数 ${fmt(r.guests)}（${ps(r.c.guests.wow)}）· 桌均 ${fmt(r.tableAvg)} · 人均 ${fmt(r.perCap)}（${ps(r.c.perCap.wow)}）`);
      if (r.flip != null) L.push(`  翻台 ${dec(r.flip, 2)}（${ps(r.c.flip.wow)}）${r.openRate != null ? ' · 开台率 ' + Math.round(r.openRate * 100) + '%' : ''}${r.seg && r.seg.meal ? ` · 饭市 ${wan(r.seg.meal.amt)} 翻台 ${dec(r.seg.meal.flip, 2)}（${ps(r.c.mealAmt.wow)}）` : ''}${r.seg && r.seg.night ? ` · 宵夜 ${wan(r.seg.night.amt)} 翻台 ${dec(r.seg.night.flip, 2)}（${ps(r.c.nightAmt.wow)}）` : ''}`);
      { const hd = (r.hoursCmp || []).filter(h => h.prev != null && h.prev > 0).map(h => ({ hh: h.hh, d: h.tables - h.prev, r: (h.tables - h.prev) / h.prev })).filter(h => h.d <= -2 && h.r <= -0.2).sort((a, b) => a.d - b.d).slice(0, 2); if (hd.length) L.push(`  掉的时段：${hd.map(h => `${String(h.hh).slice(0, 2)} 点少开 ${Math.round(-h.d)} 桌（${ps(h.r)}）`).join('、')}`); }
      if (r.peak) L.push(`  晚市高峰 ${r.peak.hh} 开台 ${Math.round(r.peak.tables)}${r.mealMin ? ' · 平均用餐 ' + r.mealMin + ' 分钟' : ''}`);
      if (r.top && r.top.length) L.push(`  销量前五：${r.top.slice(0, 5).map(x => `${x.name.replace(/[（(].*?[)）]/g, '').slice(0, 10)} ${x.qty}`).join('、')}`);
    } else L.push('  （管家数据没查到，先用门店日报的数）');
    if (r.cc) L.push(`  收藏 ${fmt(r.cc.collect)}（${ps(r.cc.collectWow)}${r.cc.collectPeer ? '，同行店均 ' + fmt(r.cc.collectPeer) + '，是同行 ' + (r.cc.collect / r.cc.collectPeer).toFixed(1) + ' 倍' : ''}）· 打卡 ${fmt(r.cc.checkin)}（${ps(r.cc.checkinWow)}${r.cc.checkinPeer ? '，同行店均 ' + fmt(r.cc.checkinPeer) + '，是同行 ' + (r.cc.checkin / r.cc.checkinPeer).toFixed(1) + ' 倍' : ''}）`);
    if (r.giftAmt != null) L.push(`  赠菜 ${fmt(r.giftAmt)} 元（${ps(r.c.gift.wow)}）：手动赠菜 ${fmt(r.giftManual)} · 券/活动赠送 ${fmt(r.giftPromo)}${(r.giftTop || [])[0] ? '，最多 ' + r.giftTop[0].name.slice(0, 14) : ''}`);
    if (r.refundAmt != null || r.loss != null) L.push(`  退菜 ${r.refundAmt != null ? fmt(r.refundAmt) + ' 元（' + ps(r.c.refund.wow) + '）' + ((r.refundTop || [])[0] ? '，最多 ' + r.refundTop[0].name.replace(/[（(].*?[)）]/g, '').slice(0, 10) : '') : '—'} · 报损 ${r.loss != null ? fmt(r.loss) + ' 元（' + ps(r.c.loss.wow) + '）' : '—'}`);
    const x = r.jyb; const times = (a, b) => a != null && b ? (a / b >= 10 ? Math.round(a / b) : (a / b).toFixed(1)) + '倍' : '—';
    if (x) L.push(`  同商圈：曝光 ${wan(x.view)}（同行均 ${fmt(x.viewPeer)}，${times(x.view, x.viewPeer)}）· 团购购买 ${fmt(x.buy)} 人（同行 ${fmt(x.buyPeer)}，${times(x.buy, x.buyPeer)}）· 访问→购买 ${x.cvr != null ? (x.cvr * 100).toFixed(1) + '%' : '—'}（同行 ${x.cvrPeer != null ? (x.cvrPeer * 100).toFixed(1) + '%' : '—'}）· 打卡 ${fmt(x.checkin)}（同行 ${fmt(x.checkinPeer)}）`);
    if (r.cust && (r.cust.newBuy != null)) { const tot = (r.cust.newBuy || 0) + (r.cust.oldBuy || 0); L.push(`  新客/老客（${String(r.cust.from || '').slice(4, 6)}/${String(r.cust.from || '').slice(6)}那周，美团+点评团购买单）：新客 ${fmt(r.cust.newBuy)} · 老客 ${fmt(r.cust.oldBuy)}${tot ? '（老客占 ' + Math.round((r.cust.oldBuy || 0) / tot * 100) + '%）' : ''}${r.cust.repurchase != null ? ' · 复购率 ' + (r.cust.repurchase * 100).toFixed(1) + '%' + (r.cust.repurchasePeer ? '（比同行 ' + r.cust.repurchasePeer + '）' : '') : ''}`); }
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
  const compact = D => D.rows.filter(r => !r.missing).map(r => ({ 店: short(r.store), 营业额: Math.round(r.total || 0), 环比: ps(r.c.total.wow), 同比: ps(r.c.total.yoy), 堂食: Math.round(r.dine || 0), 堂食环比: ps(r.c.dine.wow), 外卖: Math.round(r.takeout || 0), 外卖环比: ps(r.c.takeout.wow), 开台: r.tables, 开台环比: ps(r.c.tables.wow), 人数: r.guests, 人数环比: ps(r.c.guests.wow), 人均: r.perCap && Math.round(r.perCap), 人均环比: ps(r.c.perCap.wow), 差评: (r.dpBad || 0) + (r.mtBad || 0) + (r.dyBad || 0) + (r.wmBad || 0), 美团分: r.mt, 点评分: r.dp, 曝光是同行几倍: r.jyb && r.jyb.viewPeer ? +(r.jyb.view / r.jyb.viewPeer).toFixed(1) : null, 团购购买是同行几倍: r.jyb && r.jyb.buyPeer ? +(r.jyb.buy / r.jyb.buyPeer).toFixed(1) : null, 翻台: r.flip != null ? +r.flip.toFixed(2) : null, 翻台环比: ps(r.c.flip.wow), 宵夜环比: ps(r.c.nightAmt.wow), 饭市环比: ps(r.c.mealAmt.wow), 退菜: r.refundAmt, 赠菜: r.giftAmt, 手动赠菜: r.giftManual, 报损: r.loss, 收藏: r.cc && r.cc.collect, 收藏环比: r.cc && ps(r.cc.collectWow), 打卡: r.cc && r.cc.checkin, 打卡环比: r.cc && ps(r.cc.checkinWow), 打卡是同行几倍: r.cc && r.cc.checkinPeer ? +(r.cc.checkin / r.cc.checkinPeer).toFixed(1) : null, 差评内容: (r.badText || []).slice(0, 3).map(b => b.text.slice(0, 80)) }));
  async function daily(d) {
    const D = dailyData(d); const T = D.T;
    const head = [`📊 运营日报 · ${D.date.slice(5).replace('-', '/')}（${D.week}）`, `全部门店营业额 ${wan(T.total)}（环比 ${ps(T.wow)}，同比 ${ps(T.yoy)}${T.yoyN && T.yoyN < D.rows.filter(r => !r.missing).length ? '，' + T.yoyN + ' 家有去年数据' : ''}）`, `堂食 ${wan(T.dine)} · 外卖 ${wan(T.takeout)} · 开台 ${fmt(T.tables)} · 人数 ${fmt(T.guests)} · 差评 ${T.bad} 条`];
    { const sg = T.seg || {}; const L2 = []; if (T.flip != null) L2.push(`总翻台 ${dec(T.flip, 2)}（${ps(T.flipWow)}）`); if (sg.meal) L2.push(`饭市 ${wan(sg.meal.amt)}（${ps(sg.meal.amtWow)}）翻台 ${dec(sg.meal.flip, 2)}`); if (sg.night) L2.push(`宵夜 ${wan(sg.night.amt)}（${ps(sg.night.amtWow)}）翻台 ${dec(sg.night.flip, 2)}`); if (T.refund != null) L2.push(`退菜 ${fmt(T.refund)} 元（${ps(T.refundWow)}）`); if (T.gift != null) L2.push(`赠菜 ${fmt(T.gift)} 元（${ps(T.giftWow)}）`); if (T.loss != null) L2.push(`报损 ${fmt(T.loss)} 元`); if (T.checkin != null) L2.push(`收藏 ${fmt(T.collect)}（${ps(T.collectWow)}）· 打卡 ${fmt(T.checkin)}（${ps(T.checkinWow)}）${T.checkinPeerX ? '，打卡是同行 ' + T.checkinPeerX.toFixed(1) + ' 倍' : ''}`); if (L2.length) head.push(L2.join(' · ')); }
    if ((T.alerts || []).length) head.push('\n🔎 今日重点\n' + T.alerts.map(a => `${a.lvl === 'good' ? '🟢' : a.lvl === 'bad' ? '🔴' : '🟠'} ${a.text}`).join('\n'));
    if (!D.gjOk) head.push('⚠️ 美团管家昨天的数据还没查到（插件可能没跑），下面先用门店日报的数；开台、人数、菜品等管家数据缺。');
    const rows = D.rows.filter(r => !r.missing).sort((a, b) => (b.total || 0) - (a.total || 0)).concat(D.rows.filter(r => r.missing));
    const body = rows.map(storeLine).join('\n\n');
    const badL = rows.filter(r => (r.badText || []).length).map(r => `【${short(r.store)}】\n` + r.badText.slice(0, 6).map(b => `  · ${b.p} ${b.star != null ? b.star + '星' : ''} ${b.t || ''}${b.replied === false ? '（未回复）' : ''}：${b.text.slice(0, 160)}`).join('\n')).join('\n');
    const badSec = D.jybOk ? (badL ? '\n\n📝 差评原文（美团经营宝，点评 + 美团）\n' + badL : '\n\n📝 差评原文：昨天点评、美团都没有新差评') : '';
    const an = await ai('日报', { 日期: D.date + D.week, 合计: { 营业额: Math.round(T.total), 环比: ps(T.wow), 同比: ps(T.yoy), 堂食: Math.round(T.dine), 外卖: Math.round(T.takeout) }, 重点: (T.alerts || []).map(a => a.text), 门店: compact(D) });
    const tail = '\n\n说明：环比 = 和上周同一天比；同比 = 和去年同一个星期几比。营业额按实收（美团管家「营业收入」= 应收减优惠），含外卖；桌均、人均按堂食实收算；翻台率 = 消费桌数 ÷ 门店实际桌数；开台率也按实际桌数；饭市 = 22 点前结账，宵夜 = 22 点后。同商圈 = 美团经营宝「商圈同行店均」。新老客只有按周的数，按团购/买单顾客算。' + (D.jybOk ? '' : '\n⚠️ 美团经营宝昨天的数据还没查到，同商圈对比和差评原文晚点在驾驶舱里看。');
    return { data: D, text: head.join('\n') + '\n\n' + body + badSec + (an ? '\n\n🤖 分析\n' + an : '') + tail };
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
    if (kind === 'week') { const end = addDays(today, -1); const back = new Date(end + 'T00:00:00Z').getUTCDay(); const sun = addDays(end, -back); const mon = addDays(sun, -6); D = rangeData(mon, sun, 'week'); D.kind = '周报'; }
    else { const t = new Date(Date.now() + 8 * 3600e3); const y = t.getUTCFullYear(), m = t.getUTCMonth(); const f = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10), e = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); D = rangeData(f, e, 'month'); D.kind = '月报'; }
    const T = D.T; const lbl = [D.prevName, D.lyName]; const sg = T.seg || {};
    const head = [`📅 运营${D.kind} · ${D.from.slice(5).replace('-', '/')}–${D.to.slice(5).replace('-', '/')}`, `全部门店营业额 ${wan(T.total)}（比${lbl[0]} ${ps(T.wow)}，比${lbl[1]} ${ps(T.yoy)}）`, `堂食 ${wan(T.dine)} · 外卖 ${wan(T.takeout)} · 开台 ${fmt(T.tables)} · 人数 ${fmt(T.guests)}`];
    { const L2 = []; if (T.flip != null) L2.push(`平均每天翻台 ${dec(T.flip, 2)}（${ps(T.flipWow)}）`); if (sg.meal) L2.push(`饭市 ${wan(sg.meal.amt)}（${ps(sg.meal.amtWow)}）`); if (sg.night) L2.push(`宵夜 ${wan(sg.night.amt)}（${ps(sg.night.amtWow)}）`); if (T.refund != null) L2.push(`退菜 ${fmt(T.refund)} 元（${ps(T.refundWow)}）`); if (T.gift != null) L2.push(`赠菜 ${fmt(T.gift)} 元（${ps(T.giftWow)}）`); if (T.loss != null) L2.push(`报损 ${fmt(T.loss)} 元（${ps(T.lossWow)}）`); if (T.checkin != null) L2.push(`收藏 ${fmt(T.collect)}（${ps(T.collectWow)}）· 打卡 ${fmt(T.checkin)}（${ps(T.checkinWow)}）`); if (L2.length) head.push(L2.join(' · ')); }
    if ((T.alerts || []).length) head.push('\n🔎 重点\n' + T.alerts.map(a => `${a.lvl === 'good' ? '🟢' : a.lvl === 'bad' ? '🔴' : '🟠'} ${a.text}`).join('\n'));
    const rows = D.rows.filter(r => !r.missing).sort((a, b) => (b.total || 0) - (a.total || 0));
    const body = rows.map(r => storeLine(r).replace(/（环比 /, `（比${lbl[0]} `).replace(/，同比 /, `，比${lbl[1]} `)).join('\n\n');
    const an = await ai(D.kind, { 期间: D.from + '~' + D.to, 合计: { 营业额: Math.round(T.total), 比上期: ps(T.wow), 同比: ps(T.yoy), 翻台: dec(T.flip, 2) }, 重点: (T.alerts || []).map(a => a.text), 门店: compact(D) });
    return { data: D, text: head.join('\n') + '\n\n' + body + (an ? '\n\n🤖 分析\n' + an : '') + '\n\n说明：营业额按实收（美团管家「营业收入」）；翻台率按门店实际桌数；饭市 = 22 点前结账，宵夜 = 22 点后；括号里是比' + lbl[0] + '；管家数据没覆盖到的时段，用门店日报的营业额补。' };
  }

  // 驾驶舱用：近 N 天每店营业额走势
  function trend(days, endAt) {
    const yd = addDays(ymd(Date.now()), -1); const end = endAt && endAt < yd ? endAt : yd; const R = dailyRows(addDays(end, -(days - 1)), end); const out = [];
    for (let k = days - 1; k >= 0; k--) { const d = addDays(end, -k); const G = gj.day(d); const o = { date: d }; for (const s of STORES) { const x = storeDay(G, R, s, d); o[short(s)] = x.total != null ? Math.round(x.total) : null; } out.push(o); }
    return out;
  }
  return { daily, dailyData, rangeData, period, trend, STORES: STORES.map(short) };
}
module.exports = { createOpsReport };
