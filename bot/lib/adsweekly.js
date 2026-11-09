/* 推广通投放周报：每周一把每家店本周和「之前所有周」对比，算 30 日归因每单成本、营业额敏感度，
 * 程序给出 3 套预算方案（保守 / 平衡 / 进攻），DeepSeek 写分析和推荐，存成飞书云文档给老板确认。
 * 数字全部程序算好，AI 只能引用（核对不过就用纯数字版）。
 */
'use strict';
const { dbOn } = require('./store');
const DAY = 864e5, TZ = 8 * 3600e3;
const bjDay = t => Math.floor((t + TZ) / DAY);
const dstr = d => new Date(d * DAY).toISOString().slice(5, 10).replace('-', '/');
const val = v => Array.isArray(v) ? v.map(x => (x && typeof x === 'object') ? (x.text || x.name || '') : String(x)).join('') : (v && typeof v === 'object') ? (v.text || v.name || '') : (v ?? '');
const num = v => { const x = parseFloat(String(val(v)).replace(/,/g, '')); return isFinite(x) ? x : 0; };
const r0 = x => x === null || x === undefined || !isFinite(x) ? null : Math.round(x);
const r1 = x => x === null || x === undefined || !isFinite(x) ? null : Math.round(x * 10) / 10;
const pc = (a, b) => (a === null || b === null || !b) ? null : Math.round((a - b) / b * 1000) / 10;
const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const median = a => { const s = a.filter(x => x !== null && isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const INDEX = /花园城|蛇口/; // 粤迹花园城：从不投推广通，当大盘参照

function createAdsWeekly({ cfg, api, core, log, canon, bossId, saveKind, store }) {
  async function rows(name) {
    // 本地库优先（推广通、日报都在库里）；库不可用或开关关掉就退回读飞书
    if (store && store.ok && store.ready() && dbOn(cfg)) {
      if (name === '推广通数据') return store.queryTgt({});
      if (name === (cfg.dailyTable || '经营日报数据')) return store.queryDaily({});
    }
    const app = await core.dailyAppToken(); const t = ((await api.call('GET', `/bitable/v1/apps/${app}/tables`, null, { page_size: 100 })).items || []).find(x => x.name === name); if (!t) return [];
    const out = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); out.push(...(d.items || []).map(r => r.fields || {})); pt = d.has_more ? d.page_token : ''; } while (pt);
    return out;
  }

  async function facts(now) {
    now = now || Date.now();
    const T = (await rows('推广通数据')).map(f => ({ d: bjDay(+f['日期'] || 0), store: canon(val(f['门店'])), spend: num(f['花费']), o30: f['30日团购订单数'] !== undefined && f['30日团购订单数'] !== null ? num(f['30日团购订单数']) : null, o0: num(f['团购订单量']), views: num(f['商户浏览量']) })).filter(r => r.d > 0);
    const Dl = (await rows(cfg.dailyTable || '经营日报数据')).map(f => ({ d: bjDay(+f['日期'] || 0), store: canon(val(f['门店'])), rev: num(f['总营业额']) })).filter(r => r.d > 0 && r.rev > 0);
    // 一天一店只留一行（报表重复时取最后一行）
    const revBy = new Map(); Dl.forEach(r => revBy.set(r.store + '|' + r.d, r.rev));
    const idx = new Map(); Dl.filter(r => INDEX.test(r.store)).forEach(r => idx.set(r.d, r.rev));
    const today = bjDay(now); const dow = (today + 3) % 7; // 0=周一
    const lastSun = today - dow - 1; // 上周日
    const first = Math.min(...T.map(r => r.d)); const weeks = [];
    for (let end = lastSun; end - 6 >= first - 6 && weeks.length < 30; end -= 7) weeks.unshift(end);
    const CLOSED = new RegExp((cfg.adsClosed || ['陈家祠', '百信广场']).join('|'));
    const stores = [...new Set(T.filter(r => r.spend > 0).map(r => r.store))].filter(s => !CLOSED.test(s));
    const has30 = T.filter(r => r.d > lastSun - 28 && r.spend > 0); const share30 = has30.length ? has30.filter(r => r.o30 !== null).length / has30.length : 0;

    const per = stores.map(s => {
      const W = weeks.map(end => {
        const rr = T.filter(r => r.store === s && r.d > end - 7 && r.d <= end);
        const spend = rr.reduce((a, r) => a + r.spend, 0), orders = rr.reduce((a, r) => a + (r.o30 !== null ? r.o30 : r.o0), 0), views = rr.reduce((a, r) => a + r.views, 0);
        const days = []; for (let d = end - 6; d <= end; d++) if (revBy.has(s + '|' + d) && idx.has(d)) days.push(d);
        const rev = days.length ? days.reduce((a, d) => a + revBy.get(s + '|' + d), 0) / days.length : null;
        const rel = days.length >= 4 ? days.reduce((a, d) => a + revBy.get(s + '|' + d), 0) / days.reduce((a, d) => a + idx.get(d), 0) : null;
        return { 周: `${dstr(end - 6)}-${dstr(end)}`, end, 花费: r0(spend), 团购单30日: orders, 每单成本: orders ? r0(spend / orders) : null, 商户浏览: views, 营业额日均: r0(rev), 相对花园城: rel === null ? null : Math.round(rel * 100) / 100, 归因未满30天: end > today - 30 };
      }).filter(w => w.花费 !== null);
      const cur = W[W.length - 1], prev = W[W.length - 2];
      const on = W.filter(w => w.花费 > 0), off = W.filter(w => w.花费 === 0 && w.相对花园城 !== null);
      const mature = on.filter(w => !w.归因未满30天 && w.每单成本 !== null);
      const last4 = on.slice(-5, -1);
      const relOn = avg(on.filter(w => w.相对花园城 !== null).map(w => w.相对花园城)), relOff = off.length >= 2 ? avg(off.map(w => w.相对花园城)) : null;
      // 花费高的周 vs 花费低的周（都在投）：营业额相对大盘差多少
      const sorted = on.filter(w => w.相对花园城 !== null).slice().sort((a, b) => a.花费 - b.花费); const half = Math.floor(sorted.length / 2);
      const lo = half >= 2 ? avg(sorted.slice(0, half).map(w => w.相对花园城)) : null, hi = half >= 2 ? avg(sorted.slice(-half).map(w => w.相对花园城)) : null;
      const best = mature.slice().sort((a, b) => a.每单成本 - b.每单成本)[0], worst = mature.slice().sort((a, b) => b.每单成本 - a.每单成本)[0];
      const histCpo = mature.length ? r0(mature.reduce((a, w) => a + w.花费, 0) / Math.max(1, mature.reduce((a, w) => a + w.团购单30日, 0))) : null;
      // 现在的正常周预算：最近一个「花费 ≥ 这家店投放周中位一半」的周（避开余额不足停掉的周）；最近 3 周都是 0 = 计划停投
      const medOn = median(on.map(w => w.花费)) || 0; const normal = on.slice().reverse().find(w => w.花费 >= medOn * 0.5);
      const stopped = W.slice(-3).every(w => w.花费 === 0); const baseSpend = stopped ? 0 : normal ? normal.花费 : 0;
      return {
        门店: s, 本周: cur, 上周: prev,
        本周对上周: cur && prev ? { 花费: pc(cur.花费, prev.花费), 团购单: pc(cur.团购单30日, prev.团购单30日), 每单成本: pc(cur.每单成本, prev.每单成本), 相对花园城: pc(cur.相对花园城, prev.相对花园城) } : null,
        近4周平均: last4.length ? { 花费: r0(avg(last4.map(w => w.花费))), 团购单: r1(avg(last4.map(w => w.团购单30日))), 每单成本: r0(last4.reduce((a, w) => a + w.花费, 0) / Math.max(1, last4.reduce((a, w) => a + w.团购单30日, 0))), 相对花园城: r1(avg(last4.filter(w => w.相对花园城 !== null).map(w => w.相对花园城)) * 100) / 100 } : null,
        历史: { 投放周数: on.length, 停投周数: off.length, 归因完整周的平均每单成本: histCpo, 最便宜的一周: best ? `${best.周} ${best.每单成本} 元` : null, 最贵的一周: worst ? `${worst.周} ${worst.每单成本} 元` : null },
        营业额敏感度: { 投放周相对花园城: relOn === null ? null : Math.round(relOn * 100) / 100, 停投周相对花园城: relOff === null ? null : Math.round(relOff * 100) / 100, 投比停: pc(relOn, relOff), 高花费周比低花费周: pc(hi, lo) },
        近两周投放周均花费: baseSpend, 状态: stopped ? '计划停投中（近 3 周没花费）' : (cur && cur.花费 < medOn * 0.5 ? '本周花费明显偏低（可能余额不足/计划被停）' : '在投'), 逐周: W.slice(-12).map(({ end, ...w }) => w)
      };
    });
    // 分类：成本（对比各店历史每单成本中位）+ 敏感度
    const med = median(per.map(p => p.历史.归因完整周的平均每单成本));
    per.forEach(p => {
      const c = p.历史.归因完整周的平均每单成本; const sens = p.营业额敏感度.投比停 !== null ? p.营业额敏感度.投比停 : p.营业额敏感度.高花费周比低花费周;
      p.成本档 = c === null || med === null ? '未知' : c <= med * 0.85 ? '便宜' : c >= med * 1.3 ? '贵' : '中等';
      p.敏感档 = sens === null ? '未知' : sens >= 5 ? '敏感' : sens <= -3 ? '不敏感' : Math.abs(sens) < 3 ? '不敏感' : '略敏感';
    });
    const plan = (name, rule) => { const L = per.map(p => { const b = p.近两周投放周均花费 || 0; const k = b ? rule(p) : 0; return { 门店: p.门店, 现在周均: b, 调整: !b ? '停投中（不动）' : k === 0 ? '维持' : (k > 0 ? '+' : '') + Math.round(k * 100) + '%', 建议周预算: Math.round(b * (1 + k) / 10) * 10 }; }); return { 方案: name, 合计周预算: L.reduce((a, x) => a + x.建议周预算, 0), 现在合计: L.reduce((a, x) => a + x.现在周均, 0), 门店: L }; };
    const plans = [
      plan('A 保守（省钱）', p => p.成本档 === '贵' && p.敏感档 !== '敏感' ? -0.3 : p.成本档 === '贵' ? -0.15 : 0),
      plan('B 平衡（推荐候选）', p => p.成本档 === '贵' ? -0.2 : p.成本档 === '便宜' && /敏感/.test(p.敏感档) && p.敏感档 !== '不敏感' ? 0.2 : 0),
      plan('C 进攻（抢客）', p => p.成本档 === '便宜' ? 0.3 : p.成本档 === '中等' && p.敏感档 === '敏感' ? 0.15 : 0),
    ];
    return { 数据截至: dstr(lastSun), 本周: weeks.length ? `${dstr(lastSun - 6)}-${dstr(lastSun)}` : '', 口径: { 每单成本: '花费 ÷ 30 日归因团购单（点广告 30 天内下单都算）；最近 4 周的归因还没满 30 天，会偏少、成本偏高，历史比较用归因完整的周', 营业额: '每家店日均营业额 ÷ 粤迹花园城（从不投推广通）同期日均，叫「相对花园城」，用来扣掉大盘和季节影响', 敏感度: '投放周 vs 停投周的「相对花园城」差多少；没有停投周就看高花费周 vs 低花费周', '30日归因覆盖': Math.round(share30 * 100) + '%', 成本档: `各店历史每单成本中位 ${r0(med)} 元：≤85% 便宜，≥130% 贵` }, 门店: per, 方案: plans };
  }

  async function llm(prompt) {
    const models = cfg.analystModels || ['deepseek-v4-pro', 'deepseek-v3.2', 'qwen-max'];
    for (const model of models) {
      try {
        const r = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.qwenKey }, signal: AbortSignal.timeout(240000),
          body: JSON.stringify({ model, temperature: 0.3, max_tokens: 5000, messages: [{ role: 'user', content: prompt }] }) });
        const j = await r.json().catch(() => ({})); if (r.ok) return { text: (((j.choices || [])[0] || {}).message || {}).content || '', model };
        log(`[投放周报] 模型 ${model} 不可用：${(j.error && j.error.message) || r.status}`);
      } catch (e) { log(`[投放周报] 模型 ${model} 出错：${e.message}`); }
    }
    throw new Error('分析模型都不可用');
  }
  const numbersIn = s => (String(s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  function allowed(F) { const S = new Set(); const add = n => { S.add(n); S.add(Math.abs(n)); S.add(Math.round(n)); S.add(Math.round(n * 10) / 10); }; const walk = o => { if (o === null || o === undefined) return; if (typeof o === 'number') add(o); else if (typeof o === 'string') numbersIn(o).forEach(add); else if (Array.isArray(o)) o.forEach(walk); else if (typeof o === 'object') { Object.keys(o).forEach(k => numbersIn(k).forEach(add)); Object.values(o).forEach(walk); } }; walk(F); for (let i = 0; i <= 31; i++) S.add(i); [100, 2026].forEach(n => S.add(n)); return S; }

  function plain(F) {
    const L = [`本周 ${F.本周}（每单成本按 30 日归因）`];
    F.门店.forEach(p => { const c = p.本周 || {}; const q = p.本周对上周 || {}; L.push(`· ${p.门店}【成本${p.成本档}·营业额${p.敏感档}】花费 ${c.花费} 元（环比 ${q.花费 ?? '—'}%），团购单 ${c.团购单30日}，每单 ${c.每单成本 ?? '—'} 元；历史平均每单 ${p.历史.归因完整周的平均每单成本 ?? '—'} 元；相对花园城 ${c.相对花园城 ?? '—'}`); });
    F.方案.forEach(m => { L.push(`\n${m.方案}：周预算合计 ${m.合计周预算} 元（现在 ${m.现在合计} 元）`); m.门店.filter(x => x.调整 !== '维持').forEach(x => L.push(`  ${x.门店} ${x.调整} → ${x.建议周预算} 元/周`)); });
    return L.join('\n');
  }

  async function report(now) {
    const F = await facts(now); if (!F.门店.length) return null;
    const prompt = `你是禧聚餐饮的投放分析师，给老板林智斌写「大众点评推广通」投放周报。数据全部由程序算好（JSON），你只做解读和推荐，最后由老板拍板。
硬性要求：
1. 只能引用数据里出现的数字，不许自己计算新数字（不许自己加减乘除、不许算百分比），数据里没有的就写「数据缺」。
2. 每单成本一律按 30 日归因（口径里写了）；最近 4 周归因没满 30 天，说成本时要提醒「还在累积」。
3. 判断投放有没有用，同时看两条：平台里的每单成本（成本档），和营业额敏感度（敏感档）。成本便宜但营业额不敏感的店，说明广告带来的单占比小；成本贵但敏感的店，不要轻易砍。
4. 「状态」是计划停投中的店，方案里不给预算，只在诊断里说要不要考虑重启（可以引用它停投前后的相对花园城）；本周花费偏低的店要提醒可能余额不足。
5. 方案只能从「方案」里的 A/B/C 三套选一套推荐，可以说明对哪家店做小调整的理由，但金额只能引用方案里的数字。
6. 结构（纯文本，不要 # 和 **，不要表格；每个小标题单独一行，用【】括起来）：
【一句话结论】
【和之前所有周比】整体和每家店：本周 vs 上周、vs 近 4 周平均、vs 历史（最便宜/最贵的一周、归因完整周的平均每单成本），点出趋势
【每家店诊断】每家一段：成本档 + 敏感档 + 说明 + 建议
【三套方案】每套一两句话说清楚改了哪几家、合计周预算
【我推荐】推荐哪套、为什么、风险是什么
【请你确认】列 3–5 个要老板拍板的决定，每条一句，写成可以回答「同意/不同意」的问题
7. 1800 字以内。每家店诊断控制在 3 句话。
【数据】
${JSON.stringify(F)}`;
    let r;
    try {
      const { text, model } = await llm(prompt); const t = text.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim();
      const ok = allowed(F); const bad = numbersIn(t).filter(n => !ok.has(n));
      if (bad.length > 2) { log('[投放周报] AI 数字对不上：' + bad.slice(0, 10).join(',')); r = { text: plain(F) + '\n\n（AI 分析里有数字对不上，这次先给纯数字版）', by: '纯数字（核对没过）' }; }
      else r = { text: t, by: model };
    } catch (e) { r = { text: plain(F), by: '纯数字（AI 出错）' }; }
    r.title = `推广通投放周报 ${F.本周}`; r.facts = F;
    try { r.doc = await toDoc(r.title, r.text + '\n\n【附：逐周明细】\n' + F.门店.map(p => p.门店 + '\n' + p.逐周.map(w => `  ${w.周}  花费 ${w.花费}  团购单 ${w.团购单30日}  每单 ${w.每单成本 ?? '—'}  浏览 ${w.商户浏览}  营业额日均 ${w.营业额日均 ?? '—'}  相对花园城 ${w.相对花园城 ?? '—'}${w.归因未满30天 ? '（归因未满）' : ''}`).join('\n')).join('\n') + `\n\n（${r.by} 生成；数字由程序计算）`); } catch (e) { log('[投放周报] 写云文档失败：' + e.message); r.docError = e.message; }
    try { await saveKind('投放周报', { text: r.text + (r.doc ? '\n\n文档：' + r.doc : ''), by: r.by }, F); } catch (e) { }
    log(`[投放周报] 已生成（${r.by}）${r.doc ? ' ' + r.doc : ''}`); return r;
  }

  // 写成飞书云文档：【标题】行做小标题，其余是正文段落；只加老板一个人可管理
  async function toDoc(title, text) {
    const d = await api.call('POST', '/docx/v1/documents', Object.assign({ title }, cfg.adsFolder ? { folder_token: cfg.adsFolder } : {}));
    const id = d.document.document_id; const blocks = [];
    for (const line of String(text).split('\n')) {
      const m = line.match(/^\s*【(.+?)】\s*(.*)$/); const el = t => ({ elements: [{ text_run: { content: t } }] });
      if (m) { blocks.push({ block_type: 4, heading2: el(m[1]) }); if (m[2]) blocks.push({ block_type: 2, text: el(m[2]) }); }
      else if (line.trim()) blocks.push({ block_type: 2, text: el(line) });
    }
    for (let i = 0; i < blocks.length; i += 40) await api.call('POST', `/docx/v1/documents/${id}/blocks/${id}/children`, { children: blocks.slice(i, i + 40), index: -1 });
    const boss = bossId(); if (boss) { try { await api.call('POST', `/drive/v1/permissions/${id}/members`, { member_type: 'openid', member_id: boss, perm: 'full_access' }, { type: 'docx', need_notification: false }); } catch (e) { log('[投放周报] 加老板权限失败：' + e.message); } }
    const host = (String(cfg.dailyBaseUrl || '').match(/^https:\/\/[^/]+/) || [''])[0] || 'https://feishu.cn';
    return `${host}/docx/${id}`;
  }
  return { facts, report };
}
module.exports = { createAdsWeekly };
