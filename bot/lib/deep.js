/* 内容深度分析（爆款公式 2.0）
 * 小红书：自家内容库（插件读回来的标题/正文/话题/图片数/封面看图标签/热门评论）× 原表最新小眼睛（只算自然流）
 * 抖音蓝 V / 视频号：官方号作品数据（播放、5 秒完播、2 秒跳出、时长…）
 * 程序先算爆款率对比，AI 只负责把算好的数写成可执行的建议（数字核对不过就给纯数字版）
 */
'use strict';
const fs = require('fs'); const path = require('path');
const { FEATS, median, pct, val, maxOf } = require('./hits');
const DAY = 864e5;

function createDeep({ cfg, api, core, llm, log, dataDir }) {
  async function tables(app) { const all = []; let pt = ''; do { const d = await api.call('GET', `/bitable/v1/apps/${app}/tables`, null, Object.assign({ page_size: 100 }, pt ? { page_token: pt } : {})); all.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt); return all; }
  async function recs(app, tid) { const out = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${tid}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); out.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt); return out; }
  const priv = () => { const m = String(cfg.dailyBaseUrl || '').match(/\/base\/([A-Za-z0-9]+)/); return m ? m[1] : null; };

  // 分组对比：每组 条数 / 爆款率 / 中位数
  function by(items, key, minN = 5, metric = 'views') {
    const g = {}; items.forEach(x => { const ks = [].concat(key(x)).filter(k => k !== undefined && k !== null && k !== ''); ks.forEach(k => { (g[k] = g[k] || { n: 0, h: 0, v: [] }); g[k].n++; if (x.hit) g[k].h++; g[k].v.push(x[metric]); }); });
    return Object.entries(g).filter(([, o]) => o.n >= minN).map(([k, o]) => ({ 分组: String(k), 条数: o.n, 爆款率: pct(o.h, o.n), 中位数: Math.round(median(o.v) || 0) })).sort((a, b) => b.爆款率 - a.爆款率).slice(0, 10);
  }
  const yes = v => v === true || v === 'true' || v === '是';
  const bucket = (n, cuts, labels) => { if (n == null) return null; for (let i = 0; i < cuts.length; i++) if (n <= cuts[i]) return labels[i]; return labels[cuts.length]; };
  const markHits = (items, min) => { const accMed = {}; [...new Set(items.map(x => x.acc))].forEach(a => { accMed[a] = median(items.filter(x => x.acc === a).map(x => x.views)); }); const s = items.map(x => x.views).sort((a, b) => b - a); const p90 = s[Math.max(0, Math.floor(s.length * 0.1) - 1)]; items.forEach(x => { x.hit = !!((x.views >= min && accMed[x.acc] && x.views >= accMed[x.acc] * 2) || x.views >= p90); }); return accMed; };

  async function xhs() {
    const dir = path.join(dataDir, 'ownlib'); let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch (e) { }
    if (!files.length) return null;
    // 最新小眼睛 + 投流状态（以原表为准）
    const app = await core.appToken(); const t = (await tables(app)).find(x => x.name === '小红书矩阵号-数据'); const live = {};
    if (t) (await recs(app, t.table_id)).forEach(r => { const f = r.fields || {}; live[r.record_id] = { views: maxOf(f['小眼睛(自动)'], f['小眼睛']), boost: String(val(f['投流状态']) || ''), date: typeof f['发布日期'] === 'number' ? f['发布日期'] : null }; });
    const now = Date.now(); const items = [];
    for (const f of files) {
      let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { continue; }
      const rec = f.replace(/\.json$/, ''); const L = live[rec] || {}; const n = j.note || {}; const s = j.src || {};
      const views = L.views != null ? L.views : s.views; const d = L.date || s.date || n.time; if (views == null || !d || d > now - 7 * DAY) continue;
      if (/投/.test(L.boost) && !/未/.test(L.boost)) continue; // 只看自然流
      let c = {}; try { c = JSON.parse(j.cover || '{}'); } catch (e) { }
      const desc = String(n.desc || ''); const body = desc.replace(/#\S+/g, ''); const lines = body.split('\n').map(x => x.trim()).filter(Boolean);
      items.push({ acc: s.acc || n.author || '', title: String(n.title || ''), views, store: s.store || '', kind: s.kind || '', imgs: (n.images || []).length, len: body.replace(/\s/g, '').length, tags: (n.tags || []).length, lines: lines.length,
        emojiList: lines.filter(l => /^\p{Extended_Pictographic}/u.test(l)).length >= 3, addr: /地址|📍|人均|营业时间|¥|￥|\d+元/.test(desc), c, likes: +n.likes || 0, collects: +n.collects || 0,
        cm: (j.comments || []).slice(0, 8).map(x => String(x.text || '').slice(0, 60)) });
    }
    if (items.length < 20) return { 说明: `已入库且满 7 天的自然流笔记只有 ${items.length} 条，太少，等入库多一些再分析` };
    markHits(items, 1000); const hits = items.filter(x => x.hit);
    const C = k => x => (x.c && x.c[k] !== undefined) ? x.c[k] : undefined;
    const feat = FEATS.map(([nm, fn]) => { const a = items.filter(x => fn(x.title)), b = items.filter(x => !fn(x.title)); return { 特征: nm, 有: a.length, 有爆款率: pct(a.filter(x => x.hit).length, a.length), 无爆款率: pct(b.filter(x => x.hit).length, b.length) }; }).filter(o => o.有 >= 5 && o.有 <= items.length - 5);
    const tagged = items.filter(x => x.c && x.c.封面形式);
    return {
      样本: `自家内容库里已入库、发布满 7 天、未投流的小红书笔记 ${items.length} 条（其中 ${tagged.length} 条有封面看图标签），爆款 ${hits.length} 条，整体爆款率 ${pct(hits.length, items.length)}%`,
      判定: '小眼睛 ≥ 同账号中位数 2 倍且 ≥ 1000，或进入全部前 10%',
      封面形式: by(tagged, C('封面形式'), 4), 封面主体: by(tagged, C('主体'), 4), 封面有大字: by(tagged, x => yes(C('封面有大字')(x)) ? '有大字' : '没大字', 4), 封面色调: by(tagged, C('色调'), 4),
      封面有价格: by(tagged, x => yes(C('有价格信息')(x)) ? '有价格' : '没价格', 4), 封面有地名: by(tagged, x => yes(C('有地名或路名')(x)) ? '有地名' : '没地名', 4),
      图片张数: by(items, x => bucket(x.imgs, [1, 5, 8], ['1 张', '2–5 张', '6–8 张', '9 张及以上'])), 正文字数: by(items, x => bucket(x.len, [150, 400], ['≤150 字', '151–400 字', '400 字以上'])),
      话题数: by(items, x => bucket(x.tags, [3, 8], ['0–3 个', '4–8 个', '9 个以上'])), 正文是表情符号分条清单: by(items, x => x.emojiList ? '是' : '否'), 正文带地址人均等实用信息: by(items, x => x.addr ? '带' : '不带'),
      标题特征: feat, 爆款封面吸引点样本: hits.filter(x => x.c && x.c.封面吸引点).sort((a, b) => b.views - a.views).slice(0, 12).map(x => ({ 标题: x.title, 小眼睛: x.views, 封面: x.c.封面形式, 吸引点: x.c.封面吸引点, 封面文字: x.c.封面文字 })),
      爆款热门评论样本: hits.sort((a, b) => b.views - a.views).slice(0, 15).flatMap(x => x.cm.slice(0, 4)).filter(Boolean).slice(0, 50)
    };
  }

  async function official() {
    const A = priv(); if (!A) return null; const t = (await tables(A)).find(x => x.name === '官方号作品数据'); if (!t) return null;
    const now = Date.now(); const all = (await recs(A, t.table_id)).map(r => r.fields || {}).map(f => ({ plat: val(f['平台']), acc: val(f['账号']), title: String(val(f['标题']) || '').split('\n')[0].replace(/#\S+/g, '').trim(), views: +f['播放'] || 0, d: f['发布时间'], dur: f['时长秒'], c5: f['5秒完播率%'], b2: f['2秒跳出率%'], flip: f['快速划走率%'], full: f['完播率%'], fans: f['涨粉'] || 0, er: f['互动率%'] }))
      .filter(x => x.d && x.d < now - 3 * DAY && x.d > now - 365 * DAY && x.views > 0);
    const out = {};
    for (const [key, plat] of [['抖音蓝V', '抖音'], ['视频号', '视频号']]) {
      const items = all.filter(x => x.plat === plat); if (items.length < 10) continue;
      markHits(items, plat === '抖音' ? 3000 : 1000); const hits = items.filter(x => x.hit), rest = items.filter(x => !x.hit);
      const avg = (arr, k) => { const v = arr.map(x => x[k]).filter(x => typeof x === 'number'); return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length * 10) / 10 : null; };
      const feat = FEATS.concat([['标题带厨师/师傅/00后人设', s => /厨师|师傅|00后|05|03年|小炒王子|厨师长/.test(s)], ['标题是教做法/技巧', s => /做法|教|技巧|怎么|如何|秘诀|火候/.test(s)]]).map(([nm, fn]) => { const a = items.filter(x => fn(x.title)), b = items.filter(x => !fn(x.title)); return { 特征: nm, 有: a.length, 有爆款率: pct(a.filter(x => x.hit).length, a.length), 无爆款率: pct(b.filter(x => x.hit).length, b.length) }; }).filter(o => o.有 >= 5 && o.有 <= items.length - 5);
      out[key] = { 样本: `近一年、发布满 3 天的作品 ${items.length} 条，爆款 ${hits.length} 条（${pct(hits.length, items.length)}%）`, 按账号: by(items, x => x.acc, 5),
        爆款vs普通平均: { '5秒完播率%': [avg(hits, 'c5'), avg(rest, 'c5')], '2秒跳出率%': [avg(hits, 'b2'), avg(rest, 'b2')], '快速划走率%': [avg(hits, 'flip'), avg(rest, 'flip')], '完播率%': [avg(hits, 'full'), avg(rest, 'full')], '时长秒': [avg(hits, 'dur'), avg(rest, 'dur')], '互动率%': [avg(hits, 'er'), avg(rest, 'er')], 说明: '每项 [爆款平均, 普通平均]' },
        时长: by(items, x => bucket(x.dur, [30, 60, 120, 240], ['30 秒内', '31–60 秒', '1–2 分钟', '2–4 分钟', '4 分钟以上'])), 标题特征: feat,
        发布星期: by(items, x => '周' + '日一二三四五六'[new Date(x.d + 8 * 3600e3).getUTCDay()], 4),
        爆款样本: hits.sort((a, b) => b.views - a.views).slice(0, 15).map(x => ({ 账号: x.acc, 标题: x.title.slice(0, 40), 播放: x.views, '5秒完播%': x.c5, 时长秒: x.dur })) };
    }
    return Object.keys(out).length ? out : null;
  }

  function plain(F) {
    const L = [];
    if (F.小红书 && F.小红书.样本) { const x = F.小红书; L.push('【小红书 · 自家内容库】' + x.样本); if (x.封面形式) L.push('封面形式爆款率：' + x.封面形式.map(o => `${o.分组} ${o.爆款率}%（${o.条数}条）`).join('、')); if (x.图片张数) L.push('图片张数：' + x.图片张数.map(o => `${o.分组} ${o.爆款率}%`).join('、')); if (x.正文字数) L.push('正文字数：' + x.正文字数.map(o => `${o.分组} ${o.爆款率}%`).join('、')); }
    else if (F.小红书 && F.小红书.说明) L.push('【小红书】' + F.小红书.说明);
    Object.entries(F.官方号 || {}).forEach(([k, x]) => { L.push(`\n【${k}】${x.样本}`); const a = x.爆款vs普通平均; L.push(`5 秒完播：爆款 ${a['5秒完播率%'][0] ?? '—'}% vs 普通 ${a['5秒完播率%'][1] ?? '—'}%；2 秒跳出：${a['2秒跳出率%'][0] ?? '—'}% vs ${a['2秒跳出率%'][1] ?? '—'}%；时长：${a['时长秒'][0] ?? '—'} 秒 vs ${a['时长秒'][1] ?? '—'} 秒`); if (x.时长) L.push('时长爆款率：' + x.时长.map(o => `${o.分组} ${o.爆款率}%`).join('、')); });
    return L.join('\n');
  }

  async function report() {
    const F = { 小红书: await xhs().catch(e => ({ 说明: '读取出错：' + e.message })), 官方号: await official().catch(e => { log('[深度分析] 官方号出错：' + e.message); return null; }) };
    if (!F.小红书 && !F.官方号) return { text: '内容库和官方号数据都还没有，先让插件入库/同步', F, by: '无' };
    if (!llm) return { text: plain(F), F, by: '纯数字' };
    const prompt = `你是禧聚餐饮（YES也是大排档 / 粤迹岭南家宴）的内容策略分析师。下面是程序算好的两部分数据：
① 小红书自家内容库：每条笔记的封面看图标签（封面形式/主体/有无大字/色调/价格/地名）、图片张数、正文字数和结构、话题数、标题特征，按「爆款率」做了分组对比；附爆款笔记的封面吸引点和热门评论原文。全部是自然流（没投流）。
② 抖音蓝 V 和视频号官方号：爆款和普通作品的 5 秒完播、2 秒跳出、快速划走、完播率、时长、互动率对比，时长分组、标题特征、发布星期，以及爆款样本。
请写「爆款公式 2.0」给老板林智斌，直接指导后续出图、写文案、拍视频。
要求：
1. 数字只能用数据里出现的，不许自己算新数字；某组条数 < 10 要标「样本少」。
2. 小红书部分：封面怎么做（形式、主体、要不要大字、写什么字）、放几张图、正文写多长写成什么结构、话题带几个、标题怎么起；从热门评论归纳「用户最关心什么」，建议正文里提前回答。
3. 官方号部分：开头几秒怎么留人（结合 5 秒完播 / 2 秒跳出差异）、视频多长最好、什么人设/选题容易爆。
4. 最后给「下周直接可用」：小红书 3 条（标题 + 封面怎么做 + 第 2–N 张拍什么），蓝 V 视频 2 条（标题 + 开头 3 秒拍什么）。
5. 飞书纯文本，不要 # 和 **，不要表格，用 emoji 小标题分块，1200 字以内。
【数据】
${JSON.stringify(F)}`;
    try {
      const text = (await llm(prompt)).trim();
      const ok = new Set(); const walk = o => { if (o == null) return; if (typeof o === 'number') { [o, Math.round(o), Math.round(o * 10) / 10].forEach(v => ok.add(v)); } else if (typeof o === 'string') (o.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []).forEach(n => ok.add(+n)); else if (Array.isArray(o)) o.forEach(walk); else Object.values(o).forEach(walk); };
      walk(F); for (let i = 0; i <= 31; i++) ok.add(i); [60, 100, 120, 150, 240, 400, 1000, 3000].forEach(v => ok.add(v));
      const bad = (text.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []).map(Number).filter(n => !ok.has(n));
      if (bad.length > 4) { log('[深度分析] AI 数字对不上：' + bad.slice(0, 8).join(',')); return { text: plain(F) + '\n\n（AI 分析里有数字对不上，这次先给纯数字版）', F, by: '纯数字（AI 核对没过）' }; }
      return { text, F, by: 'AI' };
    } catch (e) { log('[深度分析] AI 出错：' + e.message); return { text: plain(F), F, by: '纯数字（AI 出错）' }; }
  }
  // 给 Claude 做深度分析用：自家内容库全部笔记（精简）+ 原表最新小眼睛/投流 + 官方号全部作品
  async function exportAll() {
    const dir = path.join(dataDir, 'ownlib'); let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch (e) { }
    const app = await core.appToken(); const t = (await tables(app)).find(x => x.name === '小红书矩阵号-数据'); const live = {};
    if (t) (await recs(app, t.table_id)).forEach(r => { const f = r.fields || {}; live[r.record_id] = { views: maxOf(f['小眼睛(自动)'], f['小眼睛']), boost: String(val(f['投流状态']) || ''), date: typeof f['发布日期'] === 'number' ? f['发布日期'] : null, city: String(val(f['笔记城市']) || ''), type: String(val(f['笔记类型']) || '') }; });
    const notes = files.map(f => { try { const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); const rec = f.replace(/\.json$/, ''); const n = j.note || {}; const s = j.src || {}; const L = live[rec] || {};
      return { rec, acc: s.acc, store: s.store, kind: s.kind, city: L.city, ntype: L.type, date: L.date || s.date || n.time, views: L.views != null ? L.views : s.views, boost: L.boost, title: n.title, desc: String(n.desc || '').slice(0, 1500), tags: n.tags, imgs: (n.images || []).length, form: n.type, likes: n.likes, collects: n.collects, comments: n.comments, shares: n.shares, cover: j.cover, cm: (j.comments || []).slice(0, 10).map(c => [String(c.text || '').slice(0, 100), c.likes, c.author ? 1 : 0]) }; } catch (e) { return null; } }).filter(Boolean);
    let off = []; const A = priv(); if (A) { const ot = (await tables(A)).find(x => x.name === '官方号作品数据'); if (ot) off = (await recs(A, ot.table_id)).map(r => { const f = r.fields || {}; delete f['封面图']; return f; }); }
    return { at: Date.now(), notes, official: off };
  }
  return { report, xhs, official, plain, exportAll };
}
module.exports = { createDeep };
