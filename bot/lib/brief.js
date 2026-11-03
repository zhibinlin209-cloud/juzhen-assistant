/* 每日 CEO 简报
 * 1) 程序算数字：各店昨天营业额、对比上周同一天、评分变化、差评、缺报门店；内容发布量、起量内容、值得投放还没投的
 * 2) 通义千问结合「老板档案」写分析（只许用程序给的数字）
 * 3) 程序核对 AI 写的数字，对不上就改发纯数字版
 */
'use strict';
const DAY = 864e5, TZ = 8 * 3600e3; // 北京时间
const bjDay = t => Math.floor((t + TZ) / DAY);                 // 北京时间的「第几天」
const dayStr = d => new Date(d * DAY).toISOString().slice(5, 10).replace('-', '/');
const fmt = n => n === null || n === undefined ? '—' : Math.round(n).toLocaleString('en-US');
const pct = x => (x > 0 ? '+' : '') + (Math.round(x * 1000) / 10) + '%';

function val(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map(x => (x && typeof x === 'object' ? (x.text || x.name || x.link || '') : String(x))).join('');
  if (typeof v === 'object') { if (v.link) return v.link; if (v.text) return v.text; if (v.value !== undefined) return val(v.value); if (v.name) return v.name; }
  return String(v);
}
const num = v => { const x = val(v); if (typeof x === 'number') return x; const m = String(x).replace(/,/g, '').match(/(-?[\d.]+)\s*(万|w)?/i); return m ? parseFloat(m[1]) * (m[2] ? 1e4 : 1) : null; };
const maxOf = (...xs) => { const v = xs.map(num).filter(x => x !== null && isFinite(x)); return v.length ? Math.max(...v) : null; };
const titleOf = v => { const t = String(val(v) || '').replace(/\r/g, '').trim(); const m = t.match(/(?:^|\n)[#*\s]*标题[*\s]*[:：]?[ \t]*\n*[ \t]*([^\n#]+)/); return (m && m[1].trim()) || (t.split('\n').map(x => x.replace(/^[#*\s]+/, '').trim()).find(Boolean) || '').slice(0, 60); };
const median = a => { const s = a.filter(x => x !== null).sort((x, y) => x - y); if (!s.length) return null; const i = s.length >> 1; return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };

// 默认判断标准（和「老板档案」里的草稿一致；以后可改成从档案读）
const RULE = { dropPct: -0.15, badRed: 2, scoreDrop: 0.1, hotDays: 14, hotTimes: 2, minXhs: 1000, minDy: 3000, engXhs: 0.05, engDy: 0.03 };

function createBrief({ cfg, api, log, llm }) {
  log = log || console.log;
  const tokens = {};
  async function appOf(url) {
    if (tokens[url]) return tokens[url]; let m;
    if ((m = url.match(/\/base\/([A-Za-z0-9]+)/))) return (tokens[url] = m[1]);
    if ((m = url.match(/\/wiki\/([A-Za-z0-9]+)/))) { const d = await api.call('GET', '/wiki/v2/spaces/get_node', null, { token: m[1], obj_type: 'wiki' }); return (tokens[url] = d.node.obj_token); }
    throw new Error('不是多维表格链接：' + url);
  }
  async function tables(app) { const out = []; let pt = ''; do { const d = await api.call('GET', `/bitable/v1/apps/${app}/tables`, null, Object.assign({ page_size: 100 }, pt ? { page_token: pt } : {})); out.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt); return out; }
  async function rows(app, tid) { const out = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${tid}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); out.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt); return out.map(r => r.fields || {}); }
  const nk = x => String(x).replace(/最新|[-_\s—－·]/g, '');
  async function table(app, name) { const all = await tables(app); const t = all.find(x => x.name === name) || all.find(x => nk(x.name) === nk(name)); return t ? rows(app, t.table_id) : null; }

  // ---------- 1. 程序算数字 ----------
  async function facts(now) {
    now = now || Date.now();
    const today = bjDay(now), y = today - 1, ly = y - 7;
    const F = { rules: { 营业额跌幅标红: '-15%', 差评标红条数: RULE.badRed, 评分下降提醒: RULE.scoreDrop, 起量统计天数: RULE.hotDays, 起量倍数: RULE.hotTimes, 小红书起量最低小眼睛: RULE.minXhs, 抖音起量最低播放: RULE.minDy, 小红书互动率门槛: '5%', 抖音互动率门槛: '3%' }, date: dayStr(y), weekday: '日一二三四五六'[new Date(y * DAY).getUTCDay()], stores: [], missing: [], alerts: [], content: {}, hot: [], suggest: [], notes: [] };
    // 营业日报（私密表格）
    if (cfg.dailyBaseUrl) {
      const priv = await appOf(cfg.dailyBaseUrl);
      const R = (await table(priv, cfg.dailyTable || '经营日报数据')) || [];
      const by = {}; R.forEach(f => { const s = String(val(f['门店']) || '').trim(); const d = typeof f['日期'] === 'number' ? bjDay(f['日期']) : null; if (s && d !== null) (by[s] = by[s] || {})[d] = f; });
      for (const [s, days] of Object.entries(by)) {
        const recent = Object.keys(days).map(Number).filter(d => d >= today - 14);
        if (!recent.length) continue;
        const a = days[y], b = days[ly];
        if (!a) { F.missing.push(s); continue; }
        const rev = num(a['总营业额']), prev = b ? num(b['总营业额']) : null;
        const prevDay = Object.keys(days).map(Number).filter(d => d < y).sort((p, q) => q - p)[0]; const pd = prevDay !== undefined ? days[prevDay] : null;
        const row = { store: s, revenue: rev, lastWeek: prev, wow: rev !== null && prev ? (rev - prev) / prev : null, dpScore: num(a['点评评分']), mtScore: num(a['美团评分']), dyScore: num(a['抖音评分']), dpBad: num(a['点评差评']) || 0, mtBad: num(a['美团差评']) || 0, wmScore: num(a['外卖评分']), wmBad: num(a['外卖差评']) || 0, dyBad: num(a['抖音差评']) || 0, dpScorePrev: pd ? num(pd['点评评分']) : null, mtScorePrev: pd ? num(pd['美团评分']) : null, wmScorePrev: pd ? num(pd['外卖评分']) : null, dyScorePrev: pd ? num(pd['抖音评分']) : null };
        F.stores.push(row);
        if (row.wow !== null && row.wow <= RULE.dropPct) F.alerts.push(`${s} 营业额 ${fmt(rev)}，比上周同日 ${pct(row.wow)}`);
        const bad = row.dpBad + row.mtBad + row.wmBad + row.dyBad; if (bad >= RULE.badRed) F.alerts.push(`${s} 昨天差评 ${bad} 条（点评 ${row.dpBad}、美团 ${row.mtBad}、外卖 ${row.wmBad}、抖音 ${row.dyBad}）`);
        [['点评', 'dpScore', 'dpScorePrev'], ['美团', 'mtScore', 'mtScorePrev'], ['外卖', 'wmScore', 'wmScorePrev'], ['抖音', 'dyScore', 'dyScorePrev']].forEach(([n, k, kp]) => { if (row[k] !== null && row[kp] !== null && row[kp] - row[k] >= RULE.scoreDrop - 1e-9) F.alerts.push(`${s} ${n}评分 ${row[kp]} → ${row[k]}`); });
      }
      F.stores.sort((p, q) => (q.revenue || 0) - (p.revenue || 0));
      F.total = F.stores.reduce((t, r) => t + (r.revenue || 0), 0);
      const both = F.stores.filter(r => r.lastWeek); if (both.length) { const a = both.reduce((t, r) => t + r.revenue, 0), b = both.reduce((t, r) => t + r.lastWeek, 0); F.totalWow = (a - b) / b; }
    } else F.notes.push('还没设置营业日报私密表格');
    // 内容（营销部共享表格）
    if (cfg.baseUrl) {
      const app = await appOf(cfg.baseUrl);
      const defs = [
        { plat: '小红书', name: cfg.xhsTable || '小红书矩阵号-数据', acc: '账号昵称', person: '人员', store: '笔记门店', views: f => maxOf(f['小眼睛(自动)'], f['小眼睛']), eng: f => (maxOf(f['点赞(自动)'], f['点赞(供AI读取)'], f['点赞数']) || 0) + (maxOf(f['收藏(自动)'], f['收藏(供AI读取)'], f['收藏数']) || 0) + (maxOf(f['评论(自动)'], f['评论(供AI读取)'], f['评论数']) || 0), min: RULE.minXhs, engMin: RULE.engXhs },
        { plat: '抖音矩阵号', name: '抖音-矩阵号-数据', acc: '账号名称', person: '发布人员', store: '区域定位', views: f => maxOf(f['播放(供AI读取)'], f['抖音播放(自动)']), eng: f => (maxOf(f['点赞(供AI读取)']) || 0) + (maxOf(f['收藏(供AI读取)']) || 0) + (maxOf(f['评论(供AI读取)']) || 0), min: RULE.minDy, engMin: RULE.engDy },
        { plat: '抖音素人号', name: '抖音-素人号-数据', acc: '账号名称', person: '发布人员', store: '区域定位', views: f => maxOf(f['播放(供AI读取)'], f['播放数_数值']), eng: f => (maxOf(f['点赞(供AI读取)']) || 0) + (maxOf(f['收藏(供AI读取)']) || 0) + (maxOf(f['评论(供AI读取)']) || 0), min: RULE.minDy, engMin: RULE.engDy }
      ];
      for (const D of defs) {
        let R; try { R = await table(app, D.name); } catch (e) { R = null; }
        if (!R) { F.notes.push(`没读到表「${D.name}」`); continue; }
        const items = R.map(f => ({ d: typeof f['发布日期'] === 'number' ? bjDay(f['发布日期']) : null, acc: String(val(f[D.acc]) || '').trim(), person: String(val(f[D.person]) || '').trim(), store: String(val(f[D.store]) || '').trim(), title: titleOf(f['标题(供AI读取)'] || f['标题']), views: D.views(f), eng: D.eng(f), boosted: String(val(f['投流状态']) || '') === '已投流' })).filter(x => x.d !== null);
        const yItems = items.filter(x => x.d === y);
        const persons = {}; yItems.forEach(x => { const k = x.person || '未填人员'; persons[k] = (persons[k] || 0) + 1; });
        F.content[D.plat] = { yesterday: yItems.length, last7: items.filter(x => x.d > y - 7 && x.d <= y).length, byPerson: persons };
        const med = {}; items.filter(x => x.d > today - 31 && x.views !== null).forEach(x => (med[x.acc] = med[x.acc] || []).push(x.views));
        for (const x of items.filter(x => x.d >= today - RULE.hotDays && x.views !== null)) {
          const m = median(med[x.acc] || []); const er = x.views ? x.eng / x.views : 0;
          if (x.views >= D.min && m && x.views >= m * RULE.hotTimes) {
            const h = { plat: D.plat, acc: x.acc, store: x.store, title: x.title, date: dayStr(x.d), views: x.views, times: Math.round(x.views / m * 10) / 10, engRate: Math.round(er * 1000) / 10, boosted: x.boosted };
            if (x.boosted) h.why = '已投流'; else if (er < D.engMin) h.why = `互动率 ${h.engRate}% 低于门槛 ${Math.round(D.engMin * 100)}%`; F.hot.push(h); if (!x.boosted && er >= D.engMin) F.suggest.push(h);
          }
        }
      }
      F.hot.sort((a, b) => b.times - a.times); F.suggest.sort((a, b) => b.times - a.times);
      F.hot = F.hot.slice(0, 10); F.suggest = F.suggest.slice(0, 8);
    }
    return F;
  }

  // ---------- 老板档案 ----------
  async function profile() {
    if (!cfg.dailyBaseUrl) return '';
    try { const R = (await table(await appOf(cfg.dailyBaseUrl), cfg.profileTable || '老板档案')) || []; return R.filter(f => val(f['内容'])).map(f => `【${val(f['类别'])}·${val(f['项目'])}】${val(f['内容'])}${/待/.test(val(f['状态'])) ? '（' + val(f['状态']) + '）' : ''}`).join('\n'); } catch (e) { return ''; }
  }

  // ---------- 2. 纯数字版（AI 不可用或核对不过时用） ----------
  function plain(F) {
    const L = [`📊 ${F.date}（周${F.weekday}）经营简报`];
    if (F.stores.length) {
      L.push(`\n💰 营业额合计 ${fmt(F.total)}${F.totalWow !== undefined ? '，比上周同日 ' + pct(F.totalWow) : ''}`);
      F.stores.forEach(r => L.push(`· ${r.store} ${fmt(r.revenue)}${r.wow !== null ? '（' + pct(r.wow) + '）' : ''}${r.dpBad + r.mtBad + r.wmBad + r.dyBad ? ' 差评' + (r.dpBad + r.mtBad + r.wmBad + r.dyBad) : ''}`));
    } else L.push('\n💰 昨天还没有收到任何门店的营业日报');
    if (F.missing.length) L.push(`⏳ 未收到日报：${F.missing.join('、')}`);
    if (F.alerts.length) { L.push('\n⚠️ 需要关注'); F.alerts.forEach(a => L.push('· ' + a)); }
    const c = Object.entries(F.content); if (c.length) { L.push('\n📝 内容发布（昨天 / 近7天）'); c.forEach(([p, v]) => L.push(`· ${p} ${v.yesterday} / ${v.last7}`)); }
    if (F.suggest.length) { L.push('\n🚀 值得投放、还没投'); F.suggest.forEach(h => L.push(`· ${h.plat}·${h.acc}「${h.title.slice(0, 16)}」${h.date} ${fmt(h.views)}（账号常态 ${h.times} 倍，互动 ${h.engRate}%）`)); }
    const near = F.hot.filter(h => !h.boosted && !F.suggest.includes(h)).slice(0, 5);
    if (near.length) { L.push('\n👀 数据好但互动不够（暂不建议投）'); near.forEach(h => L.push(`· ${h.plat}·${h.acc}「${h.title.slice(0, 16)}」${fmt(h.views)}（常态 ${h.times} 倍，互动 ${h.engRate}%）`)); }
    if (!F.suggest.length && !near.length) L.push('\n🚀 近 14 天没有达到起量标准的内容');
    if (F.notes.length) L.push('\n' + F.notes.map(n => 'ℹ️ ' + n).join('\n'));
    return L.join('\n');
  }

  // ---------- 3. AI 写分析 + 核对数字 ----------
  function numbersIn(s) { return (String(s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/g) || []).map(Number); }
  function allowed(F) {
    const S = new Set(); const add = x => { if (x === null || x === undefined || !isFinite(x)) return; [x, Math.round(x), Math.round(x * 10) / 10, Math.round(x * 100) / 100, Math.abs(x), Math.round(Math.abs(x))].forEach(v => S.add(v)); if (Math.abs(x) >= 1e4) { S.add(Math.round(x / 1e3) / 10); S.add(Math.round(x / 1e4)); S.add(Math.round(x / 1e4 * 100) / 100); } };
    const walk = o => { if (o === null || o === undefined) return; if (typeof o === 'number') { add(o); if (Math.abs(o) < 5) add(o * 100); add(Math.round(o * 1000) / 10); } else if (typeof o === 'string') numbersIn(o).forEach(add); else if (Array.isArray(o)) o.forEach(walk); else if (typeof o === 'object') Object.values(o).forEach(walk); };
    walk(F); for (let i = 0; i <= 31; i++) S.add(i); [7, 14, 15, 30].forEach(v => S.add(v));
    return S;
  }
  async function write(F, prof) {
    if (!llm) return { text: plain(F), by: '纯数字（没配 AI）' };
    const prompt = `你是林智斌（禧聚餐饮创始人）的经营助理。根据下面「程序算好的数据」和「老板档案」，写一份今早的经营简报，私聊发给他看。
要求：
1. 只能使用数据里出现的数字（包括 rules 里的判断标准），不许自己计算新数字、不许编造；数据里没有的就说「数据缺」。
2. 日期：简报说的是「昨天（${F.date}）」的情况，不要写成今天。
3. 格式：飞书纯文本，不要用 # 标题、不要用 ** 加粗、不要用表格。用 emoji 小标题分块：先 1–2 句结论，再「💰营业」「⭐口碑」「📝内容与投放」「🙋需要你拍板」。手机一屏读完（450 字以内）。
4. 「建议投放」只能从 suggest 列表里选（写账号+标题前几个字+为什么）；suggest 为空就明确说「今天没有完全达标的投放候选」。hot 里没进 suggest 的，原因一律照抄它的 why 字段（不要自己推断），写成「数据好但暂不建议投：原因」。
5. missing 里的门店写「还没收到日报」；不确定的原因用「可能」，给可执行的建议。不要客套话，不要「请审阅」之类的结尾。
【老板档案】
${prof || '（还没有档案）'}
【程序算好的数据（JSON）】
${JSON.stringify(F)}`;
    try {
      const text = (await llm(prompt)).trim();
      const ok = allowed(F); const bad = numbersIn(text).filter(n => !ok.has(n) && !ok.has(Math.abs(n)));
      if (bad.length) { log('[简报] AI 写的数字对不上：' + bad.slice(0, 8).join(',') + '，改发纯数字版'); return { text: plain(F) + '\n\n（AI 分析里有数字和数据对不上，这次先发纯数字版）', by: '纯数字（AI 核对没过）' }; }
      return { text: `📊 ${F.date}（周${F.weekday}）经营简报\n\n` + text.replace(/^\s*(?:📊|📅|🗓)?[^\n]{0,20}简报[^\n]{0,10}\n+/, ''), by: 'AI' };
    } catch (e) { log('[简报] AI 出错：' + e.message); return { text: plain(F) + '\n\n（AI 暂时不可用，这次是纯数字版）', by: '纯数字（AI 出错）' }; }
  }

  async function make(now) { const F = await facts(now); const prof = await profile(); const r = await write(F, prof); return Object.assign(r, { facts: F }); }
  return { facts, profile, plain, write, make, _allowed: allowed };
}

module.exports = { createBrief, bjDay };
