/* 推广通小时监测（开关 27 tgtLive）
 * 插件每小时在老板已登录的推广通后台（midas.dianping.com 推广列表页）读一次「今日」各计划的实时数据（平台 5 分钟更新）：
 *   花费、点击、曝光、点击均价、商户浏览量、团购订单 + 日预算、点评/美团出价、状态、投放时段、人群溢价；账户今日花费/预算
 * 余额：每次都看可用天数（余额 ÷ 近 7 天日均花费），≤7 天、≤3 天、不够今天用 三档，每档一天最多提醒一次，私聊林总
 * 服务器：存快照 data/tgtlive/日期.json（每小时的数据先只存不发，林总 2026-11-26 定：试几天看有没有用）
 *        只私聊林总两件事：① 每天第一次快照和昨天最后一次比，计划设置有变化才发；② 17 点后第一次快照：晚市前预算快花完（≥70%）的计划
 *        当日小结只在 /lib/tgt/live 里看，不主动发
 * 基准：每个计划最近 7 天收盘（当天最后一次快照）的点击均价；没攒够天数时用当天全账户均价，并说明「基准还在积累」
 */
'use strict';
const fs = require('fs'); const path = require('path');

function createTgtLive({ dataDir, log, on, send }) {
  const DIR = path.join(dataDir, 'tgtlive'); try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) { }
  const ST_F = path.join(dataDir, 'tgtlive-state.json');
  let st = {}; try { st = JSON.parse(fs.readFileSync(ST_F, 'utf8')); } catch (e) { }
  const save = () => { try { fs.writeFileSync(ST_F, JSON.stringify(st)); } catch (e) { } };
  const bj = () => new Date(Date.now() + 8 * 3600e3);
  const dayOf = d => d.toISOString().slice(0, 10);
  const rd = day => { try { return JSON.parse(fs.readFileSync(path.join(DIR, day + '.json'), 'utf8')); } catch (e) { return { day, snaps: [] }; } };
  const wr = (day, o) => fs.writeFileSync(path.join(DIR, day + '.json'), JSON.stringify(o));
  const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };
  const money = v => (Math.round(v * 100) / 100).toFixed(2);

  // 插件来问：现在要不要拉（北京时间 9:00–23:59，每 55 分钟一次）
  function need() {
    const h = bj().getUTCHours();
    const due = on('tgtLive') && h >= 9 && Date.now() - (st.lastAt || 0) > 55 * 60e3 && Date.now() - (st.tryAt || 0) > 20 * 60e3;
    return { need: !!due };
  }

  // 统一成扁平的一行
  function norm(r) {
    const m = r.m || {};
    const g = (...ks) => { for (const k of ks) if (m[k] !== undefined) return num(m[k]); return 0; };
    return {
      id: String(r.launchId || r.id || ''), plan: String(r.planId || ''), shop: r.shop || '', name: r.launch || r.name || '', status: r.st,
      budget: num(r.budget), dp: num(r.dp), mt: num(r.mt), slot: r.slot || '', crowd: !!r.crowd, period: !!r.period,
      charge: g('花费'), click: g('点击'), imp: g('曝光'), pv: g('商户浏览量'), tg: g('团购订单量', '团购订单'), cpc: g('点击均价'),
    };
  }

  // 7 天基准：每个计划每天收盘的花费/点击
  function baseline(id) {
    let c = 0, k = 0, days = 0; const t = bj();
    for (let i = 1; i <= 7; i++) {
      const d = dayOf(new Date(t.getTime() - i * 864e5)); const o = rd(d); const s = o.snaps[o.snaps.length - 1]; if (!s) continue;
      const r = s.rows.find(x => x.id === id); if (!r || r.click < 5) continue; c += r.charge; k += r.click; days++;
    }
    return days >= 3 && k >= 30 ? { cpc: c / k, days } : null;
  }

  async function ingest(j) {
    st.tryAt = Date.now(); save();
    if (j.err) { log('[推广通小时] ' + j.err); if (/登录/.test(j.err) && st.loginWarn !== dayOf(bj())) { st.loginWarn = dayOf(bj()); save(); await send('boss', '⚠️ 推广通小时监测读不到数据：推广通后台掉线了。请在装了「餐饮矩阵助手」的 Chrome 里打开 e.dianping.com 重新登录。'); } return { ok: false }; }
    const now = bj(); const day = dayOf(now); const hh = now.getUTCHours();
    const rows = (j.rows || []).map(norm).filter(r => r.id);
    if (!rows.length) return { ok: false, error: '没读到计划' };
    const snap = { t: Date.now(), hh, ov: { charge: num((j.overview || {}).todayCharge), budget: num((j.overview || {}).todayBudget) }, rows };
    const o = rd(day); const prev = o.snaps[o.snaps.length - 1] || null; o.snaps.push(snap); wr(day, o);
    st.lastAt = Date.now(); save();
    const msgs = [];

    // 每天第一次：计划设置变化（和昨天最后一次比）
    if (!prev) {
      const y = rd(dayOf(new Date(now.getTime() - 864e5))); const ys = y.snaps[y.snaps.length - 1];
      if (ys) {
        const ch = [];
        for (const r of rows) {
          const a = ys.rows.find(x => x.id === r.id); if (!a) { ch.push(`新增：${r.shop} · ${r.name}`); continue; }
          const d = [];
          if (a.budget !== r.budget) d.push(`日预算 ${a.budget}→${r.budget}`);
          if ((a.dp || a.mt || r.dp || r.mt) && (a.dp !== r.dp || a.mt !== r.mt)) d.push(`出价 点评${a.dp}/美团${a.mt}→点评${r.dp}/美团${r.mt}`);
          if (a.status !== r.status) d.push(`状态 ${a.status}→${r.status}`);
          if (a.slot !== r.slot) d.push('投放时段变了');
          if (d.length) ch.push(`${r.shop} · ${r.name}：${d.join('，')}`);
        }
        if (ch.length) msgs.push('📝 推广通计划昨天到今天有变化：\n' + ch.slice(0, 15).join('\n'));
      }
    }

    // 余额提醒（林总 2026-11-26：差不多没钱了一定要提前说）：可用天数 = 余额 ÷ 近 7 天日均花费
    const fin = j.fin || {}; const bal = num(fin.balance);
    if (fin.balance !== undefined) {
      snap.fin = { bal, voucher: num(fin.voucher), y: num(fin.yesterdayConsume), today: num(fin.todayConsume) };
      const burns = []; for (let i = 1; i <= 7; i++) { const o2 = rd(dayOf(new Date(now.getTime() - i * 864e5))); const s2 = o2.snaps[o2.snaps.length - 1]; if (s2) burns.push(s2.fin && s2.fin.today ? s2.fin.today : s2.rows.reduce((x, r) => x + r.charge, 0)); }
      const avg = burns.length ? burns.reduce((a, b) => a + b, 0) / burns.length : (snap.fin.y || snap.ov.budget || 0);
      const runway = avg > 0 ? bal / avg : 99; const left = Math.max(0, snap.ov.budget - (snap.fin.today || snap.ov.charge));
      st.bal = st.bal && st.bal.day === day ? st.bal : { day, lv: 0 };
      const lv = bal < left ? 3 : runway <= 3 ? 2 : runway <= 7 ? 1 : 0;
      if (lv > st.bal.lv) {
        st.bal.lv = lv;
        msgs.push((lv === 3 ? '🔴🔴 推广通余额不够今天用了！' : lv === 2 ? '🔴 推广通余额只够 3 天以内！' : '🟠 推广通余额只够一周左右了') + `\n余额 ${money(bal)} 元${snap.fin.voucher ? `（另有抵用券 ${money(snap.fin.voucher)}）` : ''}，近 ${burns.length || 1} 天日均花 ${money(avg)} 元，大约还能投 ${runway.toFixed(1)} 天${lv === 3 ? `；今天剩下的预算还要 ${money(left)} 元，余额不够，计划会被停` : ''}。\n请安排充值（充值≠消耗，月上限按实际花费算）。`);
      }
    }
    // 17 点后第一次：晚市前预算快花完的计划（只私聊林总，一天一次）
    let alerts = [];
    if (hh >= 17 && st.eve !== day) {
      st.eve = day;
      alerts = rows.filter(r => r.status === 1 && r.budget && r.charge / r.budget >= 0.7).map(r => `• ${r.shop.replace('YES也是大排档', '').replace(/[()（）]/g, '')} · ${r.name}：已花 ${money(r.charge)} / 日预算 ${r.budget}（${Math.round(r.charge / r.budget * 100)}%），点击 ${r.click}，均价 ${money(r.cpc)}`);
      if (alerts.length) msgs.push(`🌆 推广通晚市前检查（${hh} 点）：这些计划今天的预算快花完了，晚市/宵夜可能没得投：\n${alerts.join('\n')}\n要不要加预算你定（注意各店月上限）。`);
    }
    save();
    for (const t of msgs) await send('boss', t);
    log(`[推广通小时] ${day} ${hh} 点：${rows.length} 个计划，今日花费 ${money(snap.ov.charge || tc)}，晚市前提醒 ${alerts.length} 条`);
    return { ok: true, plans: rows.length, alerts: alerts.length };
  }

  // 当天小结（22:30）
  function digest(day) {
    const o = rd(day || dayOf(bj())); const s = o.snaps[o.snaps.length - 1]; if (!s) return '';
    const by = {}; for (const r of s.rows) { const k = r.shop.replace(/^YES也是大排档|^YES/, '').replace(/[()（）]/g, '') || r.shop; const a = by[k] || (by[k] = { c: 0, k: 0, tg: 0, pv: 0, n: 0 }); a.c += r.charge; a.k += r.click; a.tg += r.tg; a.pv += r.pv; if (r.status === 1) a.n++; }
    // 每小时花费（全账户）
    const hours = []; for (let i = 1; i < o.snaps.length; i++) { const a = o.snaps[i - 1], b = o.snaps[i]; const ca = a.rows.reduce((x, r) => x + r.charge, 0), cb = b.rows.reduce((x, r) => x + r.charge, 0); hours.push([b.hh, cb - ca]); }
    const top = hours.filter(h => h[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(h => `${h[0] - 1}–${h[0]}点 ${money(h[1])}元`).join('、');
    const lines = Object.entries(by).filter(([, a]) => a.c > 0).sort((a, b) => b[1].c - a[1].c).map(([k, a]) => `• ${k}：花 ${money(a.c)}，点击 ${a.k}，均价 ${a.k ? money(a.c / a.k) : '-'}，浏览 ${a.pv}，团购 ${a.tg}`);
    return `📊 推广通今日小结（${o.day}，${o.snaps.length} 次快照）\n${lines.join('\n') || '今天没有花费'}${top ? `\n花钱最多的时段：${top}` : ''}\n团购订单有延迟，明早的日报表会更准。`;
  }
  // 22:30 小结先不主动发（林总 2026-11-26：先攒几天看有没有用），需要时看 /lib/tgt/live

  function today() { const o = rd(dayOf(bj())); return { day: o.day, snaps: o.snaps.map(s => ({ t: s.t, hh: s.hh, ov: s.ov, n: s.rows.length })), last: (o.snaps[o.snaps.length - 1] || {}).rows || [] }; }
  return { need, ingest, digest, today };
}

module.exports = { createTgtLive };
