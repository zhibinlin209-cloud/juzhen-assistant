/* 推广通预算对照（林总 2026-11-26 定的监测节奏）：只私聊林总，只在有事时发
 *   每天（推广通日报表入库后）：各店本月已花 / 按近 7 天速度月底会花到多少 / 月上限；快碰上限、已超、停投店还在花 → 提醒
 *   每周一：各店上周 vs 前一周的花费、归因订单、每单成本；按《推广通预算调整监测机制_2026Q4》：每单成本涨 ≥30% 且两周各 ≥10 单 → 预警，单数不够只观察
 *   每月 1 号：上月各店花费 vs 上限
 * 月上限来自《推广通预算调整监测机制_2026Q4》（2026-10），可用 data/tgt-caps.json 覆盖：{"深圳华强北燕南店":10000,…}
 * 每单成本 = 花费 ÷ 7 日团购订单数（没有就用团购订单量）；只是广告归因，不等于核销成本或真实新客成本
 */
'use strict';
const fs = require('fs'); const path = require('path');
const DAY = 864e5, TZ = 8 * 3600e3;
const bjDay = t => Math.floor((t + TZ) / DAY);
const CAPS0 = { '惠州水东街店': 6000, '深圳华强北燕南店': 10000, '深圳前海HOP店': 5000, '广州江南西店': 6000, '珠海玖洲道店': 8000, '深圳白石洲店': 8000 }; // 其余（创产、千灯湖、陈家祠、33小镇等）= 0 停投

function createTgtBudget({ dataDir, log }) {
  const caps = () => { let o = {}; try { o = JSON.parse(fs.readFileSync(path.join(dataDir, 'tgt-caps.json'), 'utf8')); } catch (e) { } return Object.assign({}, CAPS0, o); };
  const capOf = s => { const c = caps(); return c[s] !== undefined ? c[s] : 0; };
  const r0 = v => Math.round(v).toLocaleString('en-US');
  const ymOf = d => { const t = new Date(d * DAY); return [t.getUTCFullYear(), t.getUTCMonth()]; };
  const ord = o => (o['7日团购订单数'] || o['团购订单量'] || 0);

  // rows: [{ts, store, 花费, 团购订单量, 7日团购订单数 …}]
  function daily(rows) {
    const days = rows.map(o => bjDay(o.ts)); if (!days.length) return '';
    const last = Math.max(...days); const [Y, M] = ymOf(last);
    const first = bjDay(Date.UTC(Y, M, 1) - TZ), next = bjDay(Date.UTC(Y, M + 1, 1) - TZ); const left = next - last - 1, monthDays = next - first;
    const by = {}; for (const o of rows) { const d = bjDay(o.ts); const a = by[o.store] || (by[o.store] = { mtd: 0, l7: 0, y: 0 }); if (d >= first && d <= last) a.mtd += o['花费'] || 0; if (d > last - 7 && d <= last) a.l7 += o['花费'] || 0; if (d === last) a.y += o['花费'] || 0; }
    const warn = [], ok = [];
    for (const [s, a] of Object.entries(by)) {
      const cap = capOf(s); const proj = a.mtd + a.l7 / 7 * left;
      if (cap === 0) { if (a.y > 0) warn.push(`🔴 ${s} 是停投店（上限 0），昨天还花了 ${r0(a.y)} 元，本月已花 ${r0(a.mtd)}。去后台看一眼是不是有计划没停。`); continue; }
      if (a.mtd > cap) warn.push(`🔴 ${s} 本月已花 ${r0(a.mtd)}，超过月上限 ${r0(cap)}。`);
      else if (proj > cap * 0.95) warn.push(`🟠 ${s} 本月已花 ${r0(a.mtd)}，按近 7 天日均 ${r0(a.l7 / 7)} 算，月底会到 ${r0(proj)}，上限 ${r0(cap)}。可以考虑把日预算降到 ${r0(Math.max(0, (cap - a.mtd) / Math.max(1, left)))} 元/天左右。`);
      else if (a.mtd > 0) ok.push(`${s} ${r0(a.mtd)}/${r0(cap)}`);
    }
    if (!warn.length) return '';
    return `💰 推广通预算对照（数据到 ${new Date(last * DAY).toISOString().slice(5, 10)}，本月还剩 ${left} 天）\n${warn.join('\n')}${ok.length ? `\n其他店正常：${ok.join('，')}` : ''}`;
  }

  function weekly(rows) {
    const days = rows.map(o => bjDay(o.ts)); if (!days.length) return '';
    const last = Math.max(...days); const dow = (new Date(last * DAY).getUTCDay() + 6) % 7; const sun = last - dow + (dow === 6 ? 0 : -1); // 最近一个完整周的周日
    const wk = (s, e) => { const by = {}; for (const o of rows) { const d = bjDay(o.ts); if (d < s || d > e) continue; const a = by[o.store] || (by[o.store] = { c: 0, n: 0 }); a.c += o['花费'] || 0; a.n += ord(o); } return by; };
    const A = wk(sun - 6, sun), B = wk(sun - 13, sun - 7); const L = [], W = [];
    for (const s of Object.keys(Object.assign({}, A, B))) {
      const a = A[s] || { c: 0, n: 0 }, b = B[s] || { c: 0, n: 0 }; if (!a.c && !b.c) continue;
      const ca = a.n ? a.c / a.n : null, cb = b.n ? b.c / b.n : null;
      L.push(`• ${s}：花费 ${r0(a.c)}（上周 ${r0(b.c)}），7日团购单 ${a.n}（上周 ${b.n}），每单成本 ${ca ? r0(ca) : '-'}（上周 ${cb ? r0(cb) : '-'}）`);
      if (ca && cb && ca >= cb * 1.3) { if (a.n >= 10 && b.n >= 10) W.push(`🟠 ${s} 每单成本 ${r0(cb)}→${r0(ca)}（+${Math.round((ca / cb - 1) * 100)}%），两周都有 10 单以上，按规则预警。`); else W.push(`⚪️ ${s} 每单成本涨了 ${Math.round((ca / cb - 1) * 100)}%，但单数不够（${b.n}/${a.n}），先观察。`); }
    }
    if (!L.length) return '';
    const f = d => new Date(d * DAY).toISOString().slice(5, 10);
    return `📅 推广通周对比（${f(sun - 6)}~${f(sun)} vs 前一周）\n${L.join('\n')}${W.length ? '\n\n' + W.join('\n') : '\n\n没有触发预警的店。'}\n口径：每单成本 = 花费 ÷ 7 日团购订单（广告归因，不等于真实新客成本）；最近一周的归因还没满 7 天，会偏少。`;
  }

  function monthly(rows) {
    const days = rows.map(o => bjDay(o.ts)); if (!days.length) return '';
    const last = Math.max(...days); const [Y, M] = ymOf(last); const s0 = bjDay(Date.UTC(Y, M - 1, 1) - TZ), e0 = bjDay(Date.UTC(Y, M, 1) - TZ) - 1;
    const by = {}; for (const o of rows) { const d = bjDay(o.ts); if (d < s0 || d > e0) continue; const a = by[o.store] || (by[o.store] = { c: 0, n: 0 }); a.c += o['花费'] || 0; a.n += ord(o); }
    const L = Object.entries(by).filter(([, a]) => a.c > 0).sort((a, b) => b[1].c - a[1].c).map(([s, a]) => { const cap = capOf(s); return `• ${s}：${r0(a.c)} / 上限 ${r0(cap)}${cap ? `（${Math.round(a.c / cap * 100)}%）` : '（停投店）'}，7日团购单 ${a.n}，每单 ${a.n ? r0(a.c / a.n) : '-'}`; });
    const tot = Object.values(by).reduce((x, a) => x + a.c, 0); const capT = Object.values(caps()).reduce((x, v) => x + v, 0);
    const pm = M === 0 ? `${Y - 1}-12` : `${Y}-${String(M).padStart(2, '0')}`;
    return L.length ? `🗓 推广通上月复盘（${pm}）\n合计 ${r0(tot)} / 总上限 ${r0(capT)}\n${L.join('\n')}` : '';
  }
  return { daily, weekly, monthly, caps };
}
module.exports = { createTgtBudget };
