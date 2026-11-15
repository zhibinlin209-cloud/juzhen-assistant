/* 美团管家每日数据（插件每天早上在老板浏览器里查好交过来）：
 * 营业指标（营业额、开台数=消费桌数、人数、桌均、人均、翻台率…）、渠道（堂食/外卖）、菜品销量、时段开台。
 * 每天一个文件 data/gj/YYYY-MM-DD.json；双系统门店（名字里多一个空格的那套）在读的时候合并。
 * 查询模板备份在 data/gj-tpl.json（插件那边丢了会从这里补回去）。
 */
'use strict';
const fs = require('fs'), path = require('path');
const DAY = 864e5;
const ALIAS = { '深圳招商花园城店': '深圳蛇口招商花园城店', '深圳宝安HOP天地店': '深圳前海HOP店' };
const CLOSED = /陈家祠|百信/;
const norm = s => { s = String(s || '').replace(/\s+/g, '').trim(); return ALIAS[s] || s; };
const ymd = t => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => ymd(Date.parse(d + 'T00:00:00+08:00') + n * DAY);
const TAKEOUT = /外卖|闪购|饿了么|自提|配送/;
// 各店实际桌数（林总 2026-11-15 给的；管家点单机里的桌台数不准）。翻台率 = 消费桌数 ÷ 实际桌数。可在 data/store-seats.json 里按 {关键词: 桌数} 覆盖
const SEATS = [[/华强北/, 46], [/前海|HOP/, 42], [/白石洲/, 40], [/水东街/, 42], [/33小镇/, 40], [/千灯湖|灯湖|保利西街/, 44], [/创意产业园|创产/, 36], [/江南西/, 40], [/珠海|玖洲道/, 38], [/花园城|粤迹/, 32]];
const hk = hh => { const h = +String(hh).slice(0, 2); return h < 6 ? h + 24 : h; }; // 营业日：凌晨的小时排在最后

function createGj({ dataDir, log }) {
  const DIR = path.join(dataDir, 'gj'); try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) { }
  const TPL_F = path.join(dataDir, 'gj-tpl.json'), ST_F = path.join(dataDir, 'gj-state.json');
  let st = {}; try { st = JSON.parse(fs.readFileSync(ST_F, 'utf8')); } catch (e) { }
  const seatsOf = name => { let o = {}; try { o = JSON.parse(fs.readFileSync(path.join(dataDir, 'store-seats.json'), 'utf8')); } catch (e) { }
    for (const [k, v] of Object.entries(o)) if (k && String(name).includes(k) && +v > 0) return +v;
    const f = SEATS.find(([re]) => re.test(name)); return f ? f[1] : null; };
  const save = () => { try { fs.writeFileSync(ST_F, JSON.stringify(st)); } catch (e) { } };
  const fileOf = d => path.join(DIR, d + '.json');
  const has = d => { try { const j = JSON.parse(fs.readFileSync(fileOf(d), 'utf8')); return (j.index || []).length > 0 && (j.channel || []).length > 0; } catch (e) { return false; } };
  const rawOf = d => { try { return JSON.parse(fs.readFileSync(fileOf(d), 'utf8')); } catch (e) { return null; } };

  // 要查哪几天：昨天 → 上周同日 → 去年同日（364 天前，同星期几）→ 近 35 天漏掉的 → 去年同期的近 35 天；每次最多 6 天
  function need(force) {
    const now = Date.now(), bj = new Date(now + 8 * 3600e3), today = ymd(now), y = addDays(today, -1);
    const early = bj.getUTCHours() * 60 + bj.getUTCMinutes() < 6 * 60 + 30;
    if (!force && early) return { ok: true, need: false, why: '早上 6:30 以后再查' };
    if (!force && st.failAt && now - st.failAt < 50 * 60e3) return { ok: true, need: false, why: '上次失败，过一会再试' };
    const want = [y, addDays(y, -7), addDays(y, -364)];
    for (let k = 2; k <= 35; k++) want.push(addDays(y, -k));
    for (let k = 1; k <= 35; k++) want.push(addDays(y, -364 - k));
    const tried = st.tried || {}; const days = [];
    for (const d of want) { if (days.length >= 6) break; if (days.includes(d) || has(d)) continue; if (!force && tried[d] && tried[d] >= 3 && d !== y) continue; days.push(d); }
    // 退菜统计（2026-11-15 加）：已经有营业数据、但还没有退菜数的日子，单独补（近 35 天 + 它们的上周同日），每次最多 8 天
    const rt = st.rtried || {}; const refundDays = [];
    if (!(st.noRefundTpl && now - st.noRefundTpl < DAY)) for (let k = 1; k <= 42 && refundDays.length < 8; k++) { const d = addDays(today, -k); if (days.includes(d) || !has(d) || (rt[d] || 0) >= 3) continue; const r = rawOf(d); if (r && (!r.refund || !r.gift)) refundDays.push(d); }
    let tpl = null; try { tpl = JSON.parse(fs.readFileSync(TPL_F, 'utf8')); } catch (e) { }
    return { ok: true, need: days.length > 0 || refundDays.length > 0, days, refundDays, tpl, wantTpl: !tpl || !tpl.refund || !tpl.gift || now - (tpl.at || 0) > 7 * DAY };
  }

  function ingest(j) {
    if (j.err) { st.failAt = Date.now(); st.lastErr = String(j.err).slice(0, 200); save(); log('[美团管家] 插件没查到：' + st.lastErr); return { ok: false, login: /登录/.test(j.err) }; }
    if (j.tpl && typeof j.tpl === 'object') { try { fs.writeFileSync(TPL_F, JSON.stringify(Object.assign({}, j.tpl, { at: Date.now() })), { mode: 0o600 }); } catch (e) { } }
    let n = 0; const got = []; st.tried = st.tried || {};
    for (const day of j.days || []) {
      const d = String(day.date || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      if (day.refundOnly) { st.rtried = st.rtried || {}; const r = rawOf(d); if (r && (Array.isArray(day.refund) || Array.isArray(day.gift))) { if (Array.isArray(day.refund)) r.refund = day.refund; if (Array.isArray(day.gift)) r.gift = day.gift; try { fs.writeFileSync(fileOf(d), JSON.stringify(r)); got.push(d + '退菜'); delete st.rtried[d]; } catch (e) { } } else st.rtried[d] = (st.rtried[d] || 0) + 1; continue; }
      const okDay = (day.index || []).length || (day.channel || []).length;
      if (!okDay) { st.tried[d] = (st.tried[d] || 0) + 1; continue; }
      const clean = { date: d, at: Date.now(), index: day.index || [], channel: day.channel || [], dish: day.dish || [], hourly: day.hourly || [] }; if (Array.isArray(day.refund)) clean.refund = day.refund; if (Array.isArray(day.gift)) clean.gift = day.gift;
      try { fs.writeFileSync(fileOf(d), JSON.stringify(clean)); n++; got.push(d); delete st.tried[d]; } catch (e) { log('[美团管家] 存文件失败：' + e.message); }
    }
    for (const e of j.errors || []) { const m = String(e).match(/^(\d{4}-\d{2}-\d{2}) 退菜/); if (m) { st.rtried = st.rtried || {}; st.rtried[m[1]] = (st.rtried[m[1]] || 0) + 1; } }
    if ((j.errors || []).some(e => /没有退菜统计模板/.test(e))) st.noRefundTpl = Date.now(); else if (got.some(x => /退菜/.test(x))) st.noRefundTpl = 0;
    // 只留近 60 天的失败计数
    const cut = addDays(ymd(Date.now()), -800); for (const k of Object.keys(st.tried)) if (k < cut) delete st.tried[k];
    st.failAt = 0; st.lastErr = (j.errors || []).length ? (j.errors || []).slice(0, 3).join('；') : ''; st.lastOk = Date.now(); save();
    if ((j.errors || []).length) log('[美团管家] 部分没查到：' + st.lastErr);
    log(`[美团管家] 入库 ${n} 天：${got.join('、')}`.replace('入库 0 天', '补退菜'));
    const rn = got.filter(x => /退菜/.test(x)).length; return { ok: true, days: n, text: n ? `入库 ${n} 天（${got[0]}${n > 1 ? ' 等' : ''}）` : rn ? `补了 ${rn} 天退菜数据` : '没有新数据' };
  }

  // 某一天每家店的合并数据
  function day(d) {
    const raw = rawOf(d); if (!raw) return null; const S = {};
    const get = name => { const k = norm(name); if (!k || CLOSED.test(k)) return null; return S[k] = S[k] || { store: k, revenue: 0, income: 0, discount: 0, orders: 0, guests: 0, tables: 0, _big: null, dine: null, takeout: null, ch: {}, chGross: {}, chOrders: {}, refund: null, gift: null, dishes: {}, hourly: {} }; };
    for (const r of raw.index || []) { const s = get(r.store); if (!s) continue; for (const k of ['revenue', 'income', 'discount', 'orders', 'guests', 'tables']) s[k] += r[k] || 0; if (!s._big || (r.tables || 0) > (s._big.tables || 0)) s._big = r; }
    for (const r of raw.channel || []) { const s = get(r.store); if (!s) continue; s.chRevenue = (s.chRevenue || 0) + (r.revenue || 0); for (const [c, v] of Object.entries(r.ch || {})) { const inc = v.ordIncomeAmt != null ? v.ordIncomeAmt : (v.bizAmt || 0); if (v.ordIncomeAmt != null) s.chHasInc = true; s.ch[c] = (s.ch[c] || 0) + inc; s.chGross[c] = (s.chGross[c] || 0) + (v.bizAmt || 0); s.chOrders[c] = (s.chOrders[c] || 0) + (v.orderCnt || 0); } }
    for (const r of raw.dish || []) { const s = get(r.store); if (!s) continue; for (const [n, q, a, t] of r.top || []) { const k = String(n).replace(/[.。\s]+$/, ''); const o = s.dishes[k] = s.dishes[k] || { name: k, qty: 0, amt: 0, type: t || '' }; o.qty += q || 0; o.amt += a || 0; } }
    for (const r of raw.hourly || []) { const s = get(r.store); if (!s) continue; for (const [hh, t, p, a] of r.h || []) { const o = s.hourly[hh] = s.hourly[hh] || [0, 0, 0]; o[0] += t || 0; o[1] += p || 0; o[2] += a || 0; } }
    for (const r of raw.refund || []) { const s = get(r.store); if (!s) continue; const z = s.refund = s.refund || { amt: 0, cnt: 0, orders: 0, top: {} }; z.amt += r.amt || 0; z.cnt += r.cnt || 0; z.orders += r.orders || 0; for (const [n, c, a] of r.top || []) { const q = z.top[n] = z.top[n] || [n, 0, 0]; q[1] += c || 0; q[2] += a || 0; } }
    for (const r of raw.gift || []) { const s = get(r.store); if (!s) continue; const z = s.gift = s.gift || { manual: 0, promo: 0, types: {} }; z.manual += r.manual || 0; z.promo += r.promo || 0; for (const [n, a] of r.types || []) z.types[n] = (z.types[n] || 0) + (a || 0); }
    const hasGift = Array.isArray(raw.gift);
    const hasRefund = Array.isArray(raw.refund);
    for (const s of Object.values(S)) {
      if (Object.keys(s.ch).length) { s.dine = Object.entries(s.ch).filter(([c]) => !TAKEOUT.test(c)).reduce((t, [, v]) => t + v, 0); s.takeout = Object.entries(s.ch).filter(([c]) => TAKEOUT.test(c)).reduce((t, [, v]) => t + v, 0); s.dineOrders = Object.entries(s.chOrders).filter(([c]) => !TAKEOUT.test(c)).reduce((t, [, v]) => t + v, 0); }
      // 营业额一律按「实收」（美团管家的营业收入 ordIncomeAmt = 应收 − 优惠），林总 2026-11-15 定；gross 留着应收备查
      const chInc = Object.values(s.ch).reduce((t, v) => t + v, 0);
      s.gross = s.chRevenue || s.revenue;
      s.total = (s.chHasInc && chInc) || s.income || s.gross; s.basis = (s.chHasInc && chInc) || s.income ? '实收' : '应收';
      if (!s.chHasInc && s.income && s.gross && s.dine != null) { const k = s.income / s.gross; s.dine *= k; s.takeout *= k; } // 渠道表没有实收：按比例折算
      const dineRev = s.dine != null ? s.dine : (s.income || s.revenue);
      s.tableAvg = s.tables ? dineRev / s.tables : null; s.perCap = s.guests ? dineRev / s.guests : null;
      const b = s._big || {}; s.seats = seatsOf(s.store); s.flipPos = b.flip ?? null; s.flip = s.seats && s.tables ? s.tables / s.seats : (b.flip ?? null); s.openRate = b.openRate ?? null; s.seatRate = b.seatRate ?? null; s.mealMin = b.mealMin ?? null;
      // 开台率也按实际桌数：管家的开台率和翻台率用的是同一个（点单机）桌数，所以 新开台率 = 管家开台率 × 新翻台率 ÷ 管家翻台率
      s.openRatePos = s.openRate; if (s.seats && s.openRate != null && s.flipPos) s.openRate = Math.min(1, s.openRate * s.flip / s.flipPos);
      if (s.refund) s.refund.top = Object.values(s.refund.top).sort((p, q) => q[2] - p[2]).slice(0, 8).map(([name, cnt, amt]) => ({ name, cnt, amt })); else if (hasRefund) s.refund = { amt: 0, cnt: 0, orders: 0, top: [] };
      if (s.gift) { s.gift.total = s.gift.manual + s.gift.promo; s.gift.types = Object.entries(s.gift.types).sort((p, q) => q[1] - p[1]).slice(0, 5).map(([name, amt]) => ({ name, amt })); } else if (hasGift) s.gift = { manual: 0, promo: 0, total: 0, types: [] };
      s.top = Object.values(s.dishes).sort((p, q) => q.qty - p.qty);
      const hrs = Object.entries(s.hourly).map(([hh, v]) => ({ hh, tables: v[0], people: v[1], amt: v[2] })).sort((p, q) => hk(p.hh) - hk(q.hh)); s.hours = hrs;
      if (s.seats) hrs.forEach(h => { h.flip = h.tables / s.seats; });
      // 分市：午市 6:00–15:59、晚市 16:00–21:59、宵夜 22:00–次日 5:59（按结账时间）；饭市 = 午市 + 晚市。金额按堂食实收折算
      const hAmt = hrs.reduce((t, h) => t + (h.amt || 0), 0), k = hAmt && s.dine ? s.dine / hAmt : 1;
      const segOf = hh => { const x = hk(hh); return x < 16 ? 'lunch' : x < 22 ? 'dinner' : 'night'; };
      s.seg = {}; for (const key of ['lunch', 'dinner', 'night', 'meal']) s.seg[key] = { tables: 0, people: 0, amt: 0 };
      for (const h of hrs) { const g = segOf(h.hh); for (const key of g === 'night' ? ['night'] : [g, 'meal']) { const z = s.seg[key]; z.tables += h.tables || 0; z.people += h.people || 0; z.amt += (h.amt || 0) * k; } }
      for (const z of Object.values(s.seg)) z.flip = s.seats ? z.tables / s.seats : null;
      if (!hrs.length) s.seg = null;
      const peak = hrs.filter(h => +h.hh.slice(0, 2) >= 16 || +h.hh.slice(0, 2) < 3).sort((p, q) => q.tables - p.tables)[0]; s.peak = peak || null;
      delete s._big; delete s.dishes; delete s.hourly; delete s.chHasInc;
    }
    return { date: d, at: raw.at, stores: S };
  }
  // 一段日期的合计（周报、月报用）
  function range(from, to) {
    const S = {}; let days = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const x = day(d); if (!x) continue; days++;
      for (const s of Object.values(x.stores)) {
        const o = S[s.store] = S[s.store] || { store: s.store, total: 0, dine: 0, takeout: 0, tables: 0, guests: 0, orders: 0, discount: 0, days: 0, dishes: {} };
        o.total += s.total || 0; o.dine += s.dine != null ? s.dine : (s.income || s.revenue || 0); o.gross = (o.gross || 0) + (s.gross || 0); o.takeout += s.takeout || 0; o.tables += s.tables || 0; o.guests += s.guests || 0; o.orders += s.orders || 0; o.discount += s.discount || 0; o.days++;
        for (const t of s.top || []) { const k = t.name; const q = o.dishes[k] = o.dishes[k] || { name: k, qty: 0, amt: 0 }; q.qty += t.qty; q.amt += t.amt; }
      }
    }
    for (const o of Object.values(S)) { o.tableAvg = o.tables ? o.dine / o.tables : null; o.perCap = o.guests ? o.dine / o.guests : null; o.top = Object.values(o.dishes).sort((p, q) => q.qty - p.qty).slice(0, 10); delete o.dishes; }
    return { from, to, days, stores: S };
  }

  // ---------- 美团经营宝（插件早上 7 点后查）：各店昨天流量 + 商圈同行店均、差评原文；上周新老客 ----------
  const JDIR = path.join(dataDir, 'jyb'); try { fs.mkdirSync(JDIR, { recursive: true }); } catch (e) { }
  const jfile = d => path.join(JDIR, d + '.json');
  const jHas = d => fs.existsSync(jfile(d));
  const STORE_RULES = [[/华强北/, '深圳华强北燕南店'], [/江南西/, '广州江南西店'], [/玖洲/, '珠海玖洲道店'], [/水东/, '惠州水东街店'], [/HOP|前海/i, '深圳前海HOP店'], [/白石洲/, '深圳白石洲店'], [/千灯湖|西街|保利/, '佛山保利西街店'], [/创意产业园/, '佛山创意产业园店'], [/33小镇|东城/, '东莞东城33小镇店'], [/花园城|蛇口|粤迹/, '深圳蛇口招商花园城店']];
  const jName = n => { if (CLOSED.test(n)) return null; const r = STORE_RULES.find(([re]) => re.test(n)); return r ? r[1] : null; };
  const lastWeek = () => { const y = addDays(ymd(Date.now()), -1); const wd = new Date(y + 'T00:00:00Z').getUTCDay(); const sun = addDays(y, -wd); const mon = addDays(sun, -6); return [mon, sun]; };
  function jybNeed(force) {
    const now = Date.now(), bj = new Date(now + 8 * 3600e3), y = addDays(ymd(now), -1);
    if (!force && bj.getUTCHours() * 60 + bj.getUTCMinutes() < 7 * 60) return { ok: true, need: false, why: '早上 7 点以后再查' };
    if (!force && st.jFailAt && now - st.jFailAt < 25 * 60e3) return { ok: true, need: false, why: '上次没查到，过一会再试' };
    if (jHas(y) && !force) { // 昨天的拿到了：慢慢补历史（上周同日、去年同日、近 35 天、去年同期 35 天），每次 3 天，只查核心指标
      const jt = st.jTried || {}; const want = [addDays(y, -7), addDays(y, -364)]; for (let k = 2; k <= 35; k++) want.push(addDays(y, -k)); for (let k = 1; k <= 35; k++) want.push(addDays(y, -364 - k));
      const bf = []; for (const d of want) { if (bf.length >= 3) break; if (bf.includes(d) || jHas(d) || (jt[d] || 0) >= 2) continue; bf.push(d); }
      if (st.jBfAt && now - st.jBfAt < 4 * 60e3) return { ok: true, need: false };
      return bf.length ? { ok: true, need: true, day: y, week: '', backfill: bf } : { ok: true, need: false }; }
    const [mon, sun] = lastWeek(); const wk = mon.replace(/-/g, '/') + '-' + sun.replace(/-/g, '/');
    return { ok: true, need: true, day: y, week: st.jWeek === wk && !force ? '' : wk };
  }
  function jybIngest(j) {
    if (j.err) { st.jFailAt = Date.now(); st.jErr = String(j.err).slice(0, 200); save(); log('[经营宝] 插件没查到：' + st.jErr); return { ok: false, login: /登录/.test(j.err) }; }
    if (Array.isArray(j.backfill)) { st.jTried = st.jTried || {}; st.jBfAt = Date.now(); const got = [];
      for (const one of j.backfill) { const d = String(one.day || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue; const stores = {};
        for (const x of one.stores || []) { const k = jName(x.name); if (!k || !x.core || !Object.keys(x.core).length) continue; stores[k] = { name: x.name, poiId: x.poiId, flow: {}, core: x.core, bad: [], cust: null }; }
        if (!Object.keys(stores).length) { st.jTried[d] = (st.jTried[d] || 0) + 1; continue; }
        try { fs.writeFileSync(jfile(d), JSON.stringify({ day: d, at: Date.now(), backfill: true, stores })); got.push(d); } catch (e) { } }
      save(); if (got.length) log(`[经营宝] 补历史 ${got.join('、')}（核心指标）`); return { ok: true, text: `补了 ${got.length} 天历史` }; }
    const d = String(j.day || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false, error: '日期不对' };
    const stores = {};
    for (const x of j.stores || []) { const k = jName(x.name); if (!k) continue; stores[k] = { name: x.name, poiId: x.poiId, flow: x.flow || {}, core: x.core || {}, bad: (x.bad || []).slice(0, 30), cust: x.cust || null }; }
    const active = Object.values(stores).filter(x => (x.flow.view || 0) > 0).length;
    if (!active) { st.jFailAt = Date.now(); st.jErr = '经营宝昨天的数据还没出来'; save(); log('[经营宝] 昨天的数据还没出来，过会再查'); return { ok: false, notReady: true }; }
    try { fs.writeFileSync(jfile(d), JSON.stringify({ day: d, at: Date.now(), stores, errors: (j.errors || []).slice(0, 20) })); } catch (e) { log('[经营宝] 存文件失败：' + e.message); }
    const custN = Object.values(stores).filter(x => x.cust).length; if (j.week && custN) { st.jWeek = j.week; try { fs.writeFileSync(path.join(JDIR, 'week-' + j.week.replace(/\//g, '').replace('-', '_') + '.json'), JSON.stringify(Object.fromEntries(Object.entries(stores).filter(([, x]) => x.cust).map(([k, x]) => [k, x.cust])))); } catch (e) { } }
    st.jFailAt = 0; st.jErr = (j.errors || []).length ? j.errors.slice(0, 3).join('；') : ''; st.jOk = Date.now(); save();
    const bad = Object.values(stores).reduce((t, x) => t + x.bad.length, 0);
    log(`[经营宝] 入库 ${d}：${Object.keys(stores).length} 家店，差评原文 ${bad} 条${custN ? '，新老客 ' + custN + ' 家' : ''}`);
    return { ok: true, text: `${Object.keys(stores).length} 家店，差评 ${bad} 条` };
  }
  function jybDay(d) { try { return JSON.parse(fs.readFileSync(jfile(d), 'utf8')); } catch (e) { return null; } }
  function custWeek() { // 最近一份周新老客
    try { const f = fs.readdirSync(JDIR).filter(x => /^week-/.test(x)).sort().pop(); if (!f) return null; const m = f.match(/week-(\d{8})_(\d{8})/); return { from: m && m[1], to: m && m[2], stores: JSON.parse(fs.readFileSync(path.join(JDIR, f), 'utf8')) }; } catch (e) { return null; }
  }
  function status() { const files = fs.readdirSync(DIR).filter(f => /\.json$/.test(f)).sort(); return { days: files.length, first: (files[0] || '').slice(0, 10), last: (files[files.length - 1] || '').slice(0, 10), lastOk: st.lastOk || 0, lastErr: st.lastErr || '', failAt: st.failAt || 0, jOk: st.jOk || 0, jErr: st.jErr || '' }; }
  return { need, ingest, day, range, status, has, norm, addDays, ymd, jybNeed, jybIngest, jybDay, custWeek };
}
module.exports = { createGj, norm, addDays, ymd };
