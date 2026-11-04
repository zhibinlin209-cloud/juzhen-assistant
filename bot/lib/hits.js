/* 爆款公式：从自家已发布的内容里找「爆款长什么样」
 * 程序先算：每条内容按「同账号常态（中位数）」和「全平台前 10%」判爆款，再按选题、门店、模板、标题特征、发布星期等维度算爆款率
 * AI 再写：拿统计结果 + 爆款/普通标题样本，总结成可执行的公式（数字只能用程序算好的）
 */
'use strict';
const DAY = 864e5;
function val(v) { if (v == null) return ''; if (typeof v !== 'object') return v; if (Array.isArray(v)) return v.map(x => (x && typeof x === 'object') ? (x.text || x.name || x.link || '') : String(x)).join(''); if (v.value !== undefined) return val(v.value); return v.text || v.name || v.link || ''; }
const num = v => { const x = val(v); if (typeof x === 'number') return x; const m = String(x).replace(/,/g, '').match(/(-?[\d.]+)\s*(万|w)?/i); return m ? parseFloat(m[1]) * (m[2] ? 1e4 : 1) : null; };
const maxOf = (...xs) => { const v = xs.map(num).filter(x => x !== null && isFinite(x)); return v.length ? Math.max(...v) : null; };
const titleOf = v => { const t = String(val(v) || '').replace(/\r/g, '').trim(); const m = t.match(/(?:^|\n)[#*\s]*标题[*\s]*[:：]?[ \t]*\n*[ \t]*([^\n#]+)/); return ((m && m[1].trim()) || (t.split('\n').map(x => x.replace(/^[#*\s]+/, '').trim()).find(Boolean) || '')).slice(0, 60); };
const median = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : 0;

// 标题特征：只看能从文字判断的
const FEATS = [
  ['带数字（如 9家、3日）', t => /\d/.test(t)],
  ['合集/清单类（家、个、条、篇、合集、清单）', t => /\d+\s*(家|个|条|篇|款|道|处)|合集|清单|攻略|路线/.test(t)],
  ['带地名（城市/区/商圈）', t => /深圳|广州|佛山|惠州|珠海|东莞|福田|南山|宝安|海珠|华强北|白石洲|蛇口|江南西|水东街|千灯湖|前海|顺德|番禺/.test(t)],
  ['带感叹号/强情绪', t => /[!！]|绝了|太好吃|好吃到|哭了|救命|天花板|爱了|上头/.test(t)],
  ['带本地人/土著视角', t => /本地人|土著|老广|街坊|带路/.test(t)],
  ['提问句（？）', t => /[?？]/.test(t)],
  ['带价格/人均', t => /人均|元|块|¥|￥|性价比|便宜/.test(t)],
  ['带夜宵/宵夜', t => /宵夜|夜宵|深夜|凌晨/.test(t)],
  ['带 emoji', t => /\p{Extended_Pictographic}/u.test(t)],
  ['标题 ≤ 15 字', t => t.replace(/\s/g, '').length <= 15],
  ['标题 ≥ 20 字', t => t.replace(/\s/g, '').length >= 20]
];

function createHits({ api, core, llm, log }) {
  async function rows(name) {
    const app = await core.appToken(); const all = []; let pt = '';
    do { const d = await api.call('GET', `/bitable/v1/apps/${app}/tables`, null, Object.assign({ page_size: 100 }, pt ? { page_token: pt } : {})); all.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    const t = all.find(x => x.name === name); if (!t) return [];
    const out = []; pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); out.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    return out.map(r => r.fields || {});
  }
  const SRC = [
    { plat: '小红书', name: '小红书矩阵号-数据', acc: f => val(f['账号昵称']), store: f => val(f['笔记门店']), kind: f => val(f['内容类型']) || val(f['笔记类型']), views: f => maxOf(f['小眼睛(自动)'], f['小眼睛']), eng: f => (maxOf(f['点赞(自动)'], f['点赞(供AI读取)'], f['点赞数']) || 0) + (maxOf(f['收藏(自动)'], f['收藏(供AI读取)'], f['收藏数']) || 0) + (maxOf(f['评论(自动)'], f['评论(供AI读取)'], f['评论数']) || 0), min: 1000 },
    { plat: '抖音矩阵号', name: '抖音-矩阵号-数据', acc: f => val(f['账号名称']), store: f => val(f['区域定位']), kind: f => val(f['发布内容']), views: f => maxOf(f['播放(供AI读取)'], f['抖音播放(自动)']), eng: f => (maxOf(f['点赞(供AI读取)']) || 0) + (maxOf(f['收藏(供AI读取)']) || 0) + (maxOf(f['评论(供AI读取)']) || 0), min: 3000 },
    { plat: '抖音素人号', name: '抖音-素人号-数据', acc: f => val(f['账号名称']), store: f => val(f['区域定位']), kind: f => val(f['发布内容']), views: f => maxOf(f['播放(供AI读取)'], f['播放数_数值']), eng: f => (maxOf(f['点赞(供AI读取)']) || 0) + (maxOf(f['收藏(供AI读取)']) || 0) + (maxOf(f['评论(供AI读取)']) || 0), min: 3000 }
  ];
  // 只看发布满 7 天（数据基本稳定）、近 180 天的内容
  async function facts() {
    const now = Date.now(); const F = { 统计范围: '近 180 天、发布满 7 天的内容', 判定标准: '播放/小眼睛 ≥ 同账号中位数 2 倍，且 ≥ 平台门槛（小红书 1000、抖音 3000）；或进入本平台前 10%', 平台: {} };
    for (const S of SRC) {
      const items = (await rows(S.name)).map(f => ({ title: titleOf(f['标题(供AI读取)'] || f['..标题'] || f['标题']), acc: String(S.acc(f) || '').trim(), store: String(S.store(f) || '').trim(), kind: String(S.kind(f) || '').trim(), views: S.views(f), eng: S.eng(f), d: typeof f['发布日期'] === 'number' ? f['发布日期'] : null }))
        .filter(x => x.title && x.views != null && x.d && x.d < now - 7 * DAY && x.d > now - 180 * DAY);
      if (!items.length) continue;
      const accMed = {}; [...new Set(items.map(x => x.acc))].forEach(a => { accMed[a] = median(items.filter(x => x.acc === a).map(x => x.views)); });
      const sorted = items.map(x => x.views).sort((a, b) => b - a); const p90 = sorted[Math.max(0, Math.floor(sorted.length * 0.1) - 1)];
      items.forEach(x => { x.hit = (x.views >= S.min && accMed[x.acc] && x.views >= accMed[x.acc] * 2) || x.views >= p90; x.er = x.views ? x.eng / x.views : 0; });
      const hits = items.filter(x => x.hit), base = pct(hits.length, items.length);
      const by = (key, minN = 5) => { const g = {}; items.forEach(x => { const k = key(x) || '（未填）'; (g[k] = g[k] || { n: 0, h: 0, v: [] }); g[k].n++; if (x.hit) g[k].h++; g[k].v.push(x.views); }); return Object.entries(g).filter(([, o]) => o.n >= minN).map(([k, o]) => ({ 分组: k, 条数: o.n, 爆款数: o.h, 爆款率: pct(o.h, o.n), 中位播放: Math.round(median(o.v)) })).sort((a, b) => b.爆款率 - a.爆款率).slice(0, 12); };
      const feat = FEATS.map(([n, fn]) => { const a = items.filter(x => fn(x.title)), b = items.filter(x => !fn(x.title)); return { 特征: n, 有此特征条数: a.length, 有此特征爆款率: pct(a.filter(x => x.hit).length, a.length), 无此特征爆款率: pct(b.filter(x => x.hit).length, b.length) }; }).filter(o => o.有此特征条数 >= 5);
      const wd = by(x => '周' + '日一二三四五六'[new Date(x.d + 8 * 3600e3).getUTCDay()], 3);
      const sample = (arr, n) => arr.sort((a, b) => b.views - a.views).slice(0, n).map(x => ({ 标题: x.title, 播放: Math.round(x.views), 互动率: Math.round(x.er * 1000) / 10, 门店: x.store, 内容: x.kind, 账号: x.acc }));
      F.平台[S.plat] = { 总条数: items.length, 爆款数: hits.length, 整体爆款率: base, 中位播放: Math.round(median(items.map(x => x.views))), 按门店: by(x => x.store), 按内容模板或类型: by(x => x.kind), 按账号: by(x => x.acc, 4).slice(0, 8), 按发布星期: wd, 标题特征: feat, 爆款样本: sample(hits.slice(), 25), 普通样本: sample(items.filter(x => !x.hit && x.views < (accMed[x.acc] || 0)).slice(), 15) };
    }
    return F;
  }
  function plain(F) {
    return Object.entries(F.平台).map(([p, o]) => `【${p}】${o.总条数} 条，爆款 ${o.爆款数} 条（${o.整体爆款率}%），中位播放 ${o.中位播放}\n爆款率最高的门店：${o.按门店.slice(0, 3).map(x => `${x.分组} ${x.爆款率}%`).join('、')}\n爆款率最高的内容：${o.按内容模板或类型.slice(0, 3).map(x => `${x.分组} ${x.爆款率}%`).join('、')}\n标题特征：${o.标题特征.filter(x => x.有此特征爆款率 > x.无此特征爆款率).map(x => `${x.特征}（${x.有此特征爆款率}% vs ${x.无此特征爆款率}%）`).join('、') || '无明显差异'}`).join('\n\n');
  }
  async function report() {
    const F = await facts(); if (!Object.keys(F.平台).length) return { text: '数据表里还没有足够的已发布内容', F, by: '无' };
    if (!llm) return { text: plain(F), F, by: '纯数字（没配 AI）' };
    const prompt = `你是禧聚餐饮（也是大排档 / 粤迹岭南家宴）的内容策略分析师。下面是程序从我们自己矩阵号已发布内容里算好的数据：哪些算爆款、各维度的爆款率、标题特征对比，以及爆款和普通内容的标题样本。
请写一份「我们自家的爆款公式」给老板林智斌，用来指导后续选题和 AI 产出图文。
要求：
1. 数字只能用数据里出现的（爆款率、条数、播放等），不许自己算新数字或编造；样本少（<10 条）的结论要说「样本少，仅供参考」。
2. 结论要具体可执行：什么选题、什么标题句式（可以从爆款样本里归纳 3–5 个句式模板，用「XX」占位）、哪些门店/内容模板最容易爆、哪些特征没用甚至拖后腿、发什么星期更好。
3. 小红书、抖音分开写；最后给「下周可以直接用的 5 个选题」（结合爆款样本和门店，标题写完整）。
4. 飞书纯文本，不要 # 和 **，不要表格，用 emoji 小标题分块，1000 字以内。
【数据】
${JSON.stringify(F)}`;
    try {
      const text = (await llm(prompt)).trim();
      const ok = new Set(); const walk = o => { if (o == null) return; if (typeof o === 'number') { [o, Math.round(o), Math.round(o * 10) / 10].forEach(v => ok.add(v)); } else if (typeof o === 'string') (o.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []).forEach(n => ok.add(+n)); else if (Array.isArray(o)) o.forEach(walk); else Object.values(o).forEach(walk); };
      walk(F); for (let i = 0; i <= 31; i++) ok.add(i); [100, 1000, 3000].forEach(v => ok.add(v));
      const bad = (text.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []).map(Number).filter(n => !ok.has(n));
      if (bad.length > 3) { log('[爆款公式] AI 数字对不上：' + bad.slice(0, 8).join(',')); return { text: plain(F) + '\n\n（AI 分析里有数字对不上，这次先给纯数字版）', F, by: '纯数字（AI 核对没过）' }; }
      return { text, F, by: 'AI' };
    } catch (e) { log('[爆款公式] AI 出错：' + e.message); return { text: plain(F), F, by: '纯数字（AI 出错）' }; }
  }
  return { facts, report, plain };
}
module.exports = { createHits };
