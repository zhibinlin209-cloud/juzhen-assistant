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
const hk = hh => { const h = +String(hh).slice(0, 2); return h < 6 ? h + 24 : h; }; // 营业日：凌晨的小时排在最后

function createGj({ dataDir, log }) {
  const DIR = path.join(dataDir, 'gj'); try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) { }
  const TPL_F = path.join(dataDir, 'gj-tpl.json'), ST_F = path.join(dataDir, 'gj-state.json');
  let st = {}; try { st = JSON.parse(fs.readFileSync(ST_F, 'utf8')); } catch (e) { }
  const save = () => { try { fs.writeFileSync(ST_F, JSON.stringify(st)); } catch (e) { } };
  const fileOf = d => path.join(DIR, d + '.json');
  const has = d => { try { const j = JSON.parse(fs.readFileSync(fileOf(d), 'utf8')); return (j.index || []).length > 0 || (j.channel || []).length > 0; } catch (e) { return false; } };
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
    let tpl = null; try { tpl = JSON.parse(fs.readFileSync(TPL_F, 'utf8')); } catch (e) { }
    return { ok: true, need: days.length > 0, days, tpl, wantTpl: !tpl || now - (tpl.at || 0) > 7 * DAY };
  }

  function ingest(j) {
    if (j.err) { st.failAt = Date.now(); st.lastErr = String(j.err).slice(0, 200); save(); log('[美团管家] 插件没查到：' + st.lastErr); return { ok: false, login: /登录/.test(j.err) }; }
    if (j.tpl && typeof j.tpl === 'object') { try { fs.writeFileSync(TPL_F, JSON.stringify(Object.assign({}, j.tpl, { at: Date.now() })), { mode: 0o600 }); } catch (e) { } }
    let n = 0; const got = []; st.tried = st.tried || {};
    for (const day of j.days || []) {
      const d = String(day.date || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      const okDay = (day.index || []).length || (day.channel || []).length;
      if (!okDay) { st.tried[d] = (st.tried[d] || 0) + 1; continue; }
      const clean = { date: d, at: Date.now(), index: day.index || [], channel: day.channel || [], dish: day.dish || [], hourly: day.hourly || [] };
      try { fs.writeFileSync(fileOf(d), JSON.stringify(clean)); n++; got.push(d); delete st.tried[d]; } catch (e) { log('[美团管家] 存文件失败：' + e.message); }
    }
    // 只留近 60 天的失败计数
    const cut = addDays(ymd(Date.now()), -800); for (const k of Object.keys(st.tried)) if (k < cut) delete st.tried[k];
    st.failAt = 0; st.lastErr = (j.errors || []).length ? (j.errors || []).slice(0, 3).join('；') : ''; st.lastOk = Date.now(); save();
    if ((j.errors || []).length) log('[美团管家] 部分没查到：' + st.lastErr);
    log(`[美团管家] 入库 ${n} 天：${got.join('、')}`);
    return { ok: true, days: n, text: n ? `入库 ${n} 天（${got[0]}${n > 1 ? ' 等' : ''}）` : '没有新数据' };
  }

  // 某一天每家店的合并数据
  function day(d) {
    const raw = rawOf(d); if (!raw) return null; const S = {};
    const get = name => { const k = norm(name); if (!k || CLOSED.test(k)) return null; return S[k] = S[k] || { store: k, revenue: 0, income: 0, discount: 0, orders: 0, guests: 0, tables: 0, _big: null, dine: null, takeout: null, ch: {}, chOrders: {}, dishes: {}, hourly: {} }; };
    for (const r of raw.index || []) { const s = get(r.store); if (!s) continue; for (const k of ['revenue', 'income', 'discount', 'orders', 'guests', 'tables']) s[k] += r[k] || 0; if (!s._big || (r.tables || 0) > (s._big.tables || 0)) s._big = r; }
    for (const r of raw.channel || []) { const s = get(r.store); if (!s) continue; s.chRevenue = (s.chRevenue || 0) + (r.revenue || 0); for (const [c, v] of Object.entries(r.ch || {})) { s.ch[c] = (s.ch[c] || 0) + (v.bizAmt || 0); s.chOrders[c] = (s.chOrders[c] || 0) + (v.orderCnt || 0); } }
    for (const r of raw.dish || []) { const s = get(r.store); if (!s) continue; for (const [n, q, a, t] of r.top || []) { const k = String(n).replace(/[.。\s]+$/, ''); const o = s.dishes[k] = s.dishes[k] || { name: k, qty: 0, amt: 0, type: t || '' }; o.qty += q || 0; o.amt += a || 0; } }
    for (const r of raw.hourly || []) { const s = get(r.store); if (!s) continue; for (const [hh, t, p, a] of r.h || []) { const o = s.hourly[hh] = s.hourly[hh] || [0, 0, 0]; o[0] += t || 0; o[1] += p || 0; o[2] += a || 0; } }
    for (const s of Object.values(S)) {
      if (Object.keys(s.ch).length) { s.dine = Object.entries(s.ch).filter(([c]) => !TAKEOUT.test(c)).reduce((t, [, v]) => t + v, 0); s.takeout = Object.entries(s.ch).filter(([c]) => TAKEOUT.test(c)).reduce((t, [, v]) => t + v, 0); s.dineOrders = Object.entries(s.chOrders).filter(([c]) => !TAKEOUT.test(c)).reduce((t, [, v]) => t + v, 0); }
      s.total = s.chRevenue || s.revenue; // 渠道表的营业额含外卖，是全口径
      const dineRev = s.dine != null ? s.dine : s.revenue;
      s.tableAvg = s.tables ? dineRev / s.tables : null; s.perCap = s.guests ? dineRev / s.guests : null;
      const b = s._big || {}; s.flip = b.flip ?? null; s.openRate = b.openRate ?? null; s.seatRate = b.seatRate ?? null; s.mealMin = b.mealMin ?? null;
      s.top = Object.values(s.dishes).sort((p, q) => q.qty - p.qty);
      const hrs = Object.entries(s.hourly).map(([hh, v]) => ({ hh, tables: v[0], people: v[1], amt: v[2] })).sort((p, q) => hk(p.hh) - hk(q.hh)); s.hours = hrs;
      const peak = hrs.filter(h => +h.hh.slice(0, 2) >= 16 || +h.hh.slice(0, 2) < 3).sort((p, q) => q.tables - p.tables)[0]; s.peak = peak || null;
      delete s._big; delete s.dishes; delete s.hourly;
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
        o.total += s.total || 0; o.dine += s.dine != null ? s.dine : (s.revenue || 0); o.takeout += s.takeout || 0; o.tables += s.tables || 0; o.guests += s.guests || 0; o.orders += s.orders || 0; o.discount += s.discount || 0; o.days++;
        for (const t of s.top || []) { const k = t.name; const q = o.dishes[k] = o.dishes[k] || { name: k, qty: 0, amt: 0 }; q.qty += t.qty; q.amt += t.amt; }
      }
    }
    for (const o of Object.values(S)) { o.tableAvg = o.tables ? o.dine / o.tables : null; o.perCap = o.guests ? o.dine / o.guests : null; o.top = Object.values(o.dishes).sort((p, q) => q.qty - p.qty).slice(0, 10); delete o.dishes; }
    return { from, to, days, stores: S };
  }
  function status() { const files = fs.readdirSync(DIR).filter(f => /\.json$/.test(f)).sort(); return { days: files.length, first: (files[0] || '').slice(0, 10), last: (files[files.length - 1] || '').slice(0, 10), lastOk: st.lastOk || 0, lastErr: st.lastErr || '', failAt: st.failAt || 0 }; }
  return { need, ingest, day, range, status, has, norm, addDays, ymd };
}
module.exports = { createGj, norm, addDays, ymd };
