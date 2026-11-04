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

  let lastOwn = null;
  async function xhs() {
    const dir = path.join(dataDir, 'ownlib'); let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch (e) { }
    if (!files.length) return null;
    const app = await core.appToken(); const t = (await tables(app)).find(x => x.name === '小红书矩阵号-数据'); const live = {};
    if (t) (await recs(app, t.table_id)).forEach(r => { const f = r.fields || {}; live[r.record_id] = { views: maxOf(f['小眼睛(自动)'], f['小眼睛']), boost: String(val(f['投流状态']) || ''), date: typeof f['发布日期'] === 'number' ? f['发布日期'] : null, city: String(val(f['笔记城市']) || '') }; });
    const now = Date.now(); const N = [];
    for (const f of files) {
      let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { continue; }
      const rec = f.replace(/\.json$/, ''); const L = live[rec] || {}; const n = j.note || {}; const s = j.src || {};
      const views = L.views != null ? L.views : s.views; const d = L.date || s.date || n.time; if (views == null || !d || d > now - 7 * DAY) continue;
      if (/投/.test(L.boost) && !/未/.test(L.boost)) continue; // 只看自然流
      let c = {}; try { c = JSON.parse(j.cover || '{}'); } catch (e) { }
      const desc = String(n.desc || ''); const body = desc.replace(/#\S+/g, ''); const lines = body.split('\n').map(x => x.trim()).filter(Boolean);
      N.push({ acc: s.acc || n.author || '', title: String(n.title || ''), views, d, store: s.store || '', city: L.city || '', kind: s.kind || '', imgs: (n.images || []).length, len: body.replace(/\s/g, '').length, ntag: (n.tags || []).length,
        emo: lines.filter(l => /^\p{Extended_Pictographic}/u.test(l)).length, addr: /地址|📍|人均|营业时间|¥|￥|\d+元/.test(desc), c, col: +n.collects || 0, cm: (j.comments || []).filter(x => !x.author).map(x => String(x.text || '')) });
    }
    if (N.length < 30) return { 说明: `已入库、发布满 7 天的自然流笔记只有 ${N.length} 条，太少，等入库多一些再分析` };
    lastOwn = N; const am = markHits(N, 1000); N.forEach(x => { x.ratio = am[x.acc] ? x.views / am[x.acc] : null; x.sr = x.views ? x.col / x.views : 0; });
    const hits = N.filter(x => x.hit);
    // 分组：[名称, 条数, 爆款率%, 中位小眼睛, 同账号倍数中位（扣掉账号大小的影响，>1 说明比这个号平时好）, 收藏率%]
    const G = (key, min = 6) => { const g = {}; N.forEach(x => [].concat(key(x)).filter(k => k != null && k !== '').forEach(k => (g[k] = g[k] || []).push(x))); return Object.entries(g).filter(([, a]) => a.length >= min).map(([k, a]) => [String(k), a.length, pct(a.filter(x => x.hit).length, a.length), Math.round(median(a.map(x => x.views)) || 0), Math.round((median(a.map(x => x.ratio)) || 0) * 10) / 10, Math.round((median(a.map(x => x.sr)) || 0) * 1000) / 10]).sort((x, y) => y[4] - x[4] || y[2] - x[2]).slice(0, 12); };
    const has = (x, k) => x.c && x.c.封面形式 ? (yes(x.c[k]) ? '有' : '无') : null;
    const FE = FEATS.concat([['J人/攻略人设', t => /J人|i人|e人|P人|整理|做的/.test(t)], ['避雷/不踩雷', t => /雷|踩坑|避坑|别去|不踩/.test(t)]]);
    // 标题里爆款明显多用的词（2–4 字片段，至少出现 6 次）
    const gram = {}; N.forEach(x => { const t = x.title.replace(/[\s\p{P}\p{S}\d]/gu, ''); const seen = new Set(); for (let L = 2; L <= 4; L++) for (let i = 0; i + L <= t.length; i++) seen.add(t.slice(i, i + L)); seen.forEach(w => { (gram[w] = gram[w] || [0, 0]); gram[w][0]++; if (x.hit) gram[w][1]++; }); });
    const words = Object.entries(gram).filter(([, v]) => v[0] >= 6).map(([w, v]) => [w, v[0], pct(v[1], v[0])]).filter(v => v[2] >= pct(hits.length, N.length) * 1.5).sort((a, b) => b[2] - a[2] || b[1] - a[1]).filter((v, i, arr) => !arr.slice(0, i).some(u => u[0].includes(v[0]) && u[2] >= v[2])).slice(0, 15);
    // 评论区在问什么
    const Q = [['在哪/地址/怎么去', /在哪|地址|位置|怎么去|哪里|定位|导航/], ['人均/价格', /人均|多少钱|价格|贵|便宜|性价比/], ['排队/要等吗', /排队|等位|等多久|人多/], ['营业时间', /几点|营业|开门|关门|宵夜|夜宵/], ['好不好吃/真假', /好吃吗|真的|踩雷|好吃不|值得|推荐吗|水军|广告/], ['点什么菜', /点什么|推荐什么|必点|招牌|什么好吃/], ['停车/交通', /停车|地铁|开车/]];
    const qs = arr => { const all = arr.flatMap(x => x.cm); return Q.map(([k, re]) => [k, all.filter(t => re.test(t)).length]).filter(v => v[1]).sort((a, b) => b[1] - a[1]); };
    const accN = {}; N.forEach(x => accN[x.acc] = (accN[x.acc] || 0) + 1);
    const accs = Object.keys(accN).filter(a => accN[a] >= 5).map(a => Math.round(am[a] || 0)).sort((a, b) => b - a);
    return {
      样本: `已入库、发布满 7 天、未投流的小红书笔记 ${N.length} 条，${Object.keys(accN).length} 个账号；爆款 ${hits.length} 条，整体爆款率 ${pct(hits.length, N.length)}%，中位小眼睛 ${Math.round(median(N.map(x => x.views)))}`,
      判定: '小眼睛 ≥ 同账号中位数 2 倍且 ≥ 1000，或进入全部前 10%',
      账号差异: { 说明: '各账号小眼睛中位数（发 ≥5 条的号），差距越大说明「账号本身」影响越大，分组时要看同账号倍数', 最高: accs.slice(0, 5), 最低: accs.slice(-5), 中位: accs[Math.floor(accs.length / 2)] },
      列说明: '每组 [名称, 条数, 爆款率%, 中位小眼睛, 同账号倍数中位, 收藏率%]；同账号倍数 = 这条小眼睛 ÷ 本账号中位数，>1 表示比这个号平时好，最能说明内容本身的作用',
      内容类型: G(x => x.kind), 门店: G(x => x.store), 城市: G(x => x.city),
      封面形式: G(x => x.c.封面形式), 封面主体: G(x => x.c.主体), 封面大字: G(x => has(x, '封面有大字')), 封面色调: G(x => x.c.色调), 封面带价格: G(x => has(x, '有价格信息')), 封面带地名: G(x => has(x, '有地名或路名')),
      拼图格数: G(x => bucket(+(x.c && x.c.拼图格数) || null, [1, 4, 6, 9], ['1格', '2-4格', '5-6格', '7-9格', '10格以上'])),
      图片张数: G(x => bucket(x.imgs, [1, 3, 6, 8, 9], ['1张', '2-3张', '4-6张', '7-8张', '9张', '10张以上'])), 正文字数: G(x => bucket(x.len, [100, 250, 450], ['≤100字', '101-250字', '251-450字', '450字以上'])),
      话题数: G(x => bucket(x.ntag, [2, 5, 9], ['0-2个', '3-5个', '6-9个', '10个以上'])), 正文分条清单: G(x => x.emo >= 3 ? '是' : '否'), 正文带地址人均: G(x => x.addr ? '带' : '不带'),
      标题特征: G(x => FE.filter(([, f]) => f(x.title)).map(([k]) => k)), 标题字数: G(x => bucket(x.title.replace(/\s/g, '').length, [12, 16, 19], ['≤12字', '13-16字', '17-19字', '20字以上'])),
      发布星期: G(x => '周' + '日一二三四五六'[new Date(x.d + 8 * 3600e3).getUTCDay()]),
      爆款标题高频词: { 说明: '[词, 出现条数, 含这个词的爆款率%]，只列爆款率明显高于整体的', 列表: words },
      评论区问题: { 爆款笔记: qs(hits), 全部笔记: qs(N) },
      爆款样本: hits.sort((a, b) => (b.ratio || 0) - (a.ratio || 0)).slice(0, 15).map(x => ({ 标题: x.title, 小眼睛: x.views, 同账号倍数: Math.round((x.ratio || 0) * 10) / 10, 类型: x.kind, 封面: x.c.封面形式, 封面文字: String(x.c.封面文字 || '').slice(0, 40), 吸引点: x.c.封面吸引点, 图片张数: x.imgs })),
      爆款热门评论: hits.slice(0, 20).flatMap(x => x.cm.slice(0, 3)).filter(Boolean).map(t => t.slice(0, 50)).slice(0, 40)
    };
  }

  // 同类爆款（别人家近期高赞图文）的特征分布，和自家爆款/普通对比
  function market(own) {
    const dir = path.join(dataDir, 'market'); let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch (e) { }
    if (files.length < 20) return files.length ? { 说明: `同类爆款库只有 ${files.length} 篇，太少` } : null;
    const M = files.map(f => { try { const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); const n = j.note || {}; let c = {}; try { c = JSON.parse(j.cover || '{}'); } catch (e) { } const desc = String(n.desc || ''); const body = desc.replace(/#\S+/g, ''); const lines = body.split('\n').map(x => x.trim()).filter(Boolean);
      return { kw: j.kw, title: String(n.title || ''), likes: +n.likes || 0, collects: +n.collects || 0, imgs: (n.images || []).length, len: body.replace(/\s/g, '').length, ntag: (n.tags || []).length, emo: lines.filter(l => /^\p{Extended_Pictographic}/u.test(l)).length, addr: /地址|📍|人均|营业时间|¥|￥|\d+元/.test(desc), c, cm: (j.comments || []).filter(x => !x.author).map(x => String(x.text || '')) }; } catch (e) { return null; } }).filter(Boolean);
    // 分布：每个分组占比 %（同类爆款 / 自家爆款 / 自家普通）
    const share = (arr, key) => { const g = {}; arr.forEach(x => [].concat(key(x)).filter(k => k != null && k !== '').forEach(k => g[k] = (g[k] || 0) + 1)); return g; };
    const cmp = key => { const a = share(M, key), h = own ? share(own.filter(x => x.hit), key) : {}, r = own ? share(own.filter(x => !x.hit), key) : {}; const na = M.length, nh = own ? own.filter(x => x.hit).length : 0, nr = own ? own.filter(x => !x.hit).length : 0;
      return [...new Set([...Object.keys(a), ...Object.keys(h)])].map(k => [k, pct(a[k] || 0, na), nh ? pct(h[k] || 0, nh) : null, nr ? pct(r[k] || 0, nr) : null]).filter(v => v[1] >= 5 || (v[2] || 0) >= 5).sort((x, y) => y[1] - x[1]).slice(0, 8); };
    const FE = FEATS.concat([['J人/攻略人设', t => /J人|i人|e人|P人|整理|做的/.test(t)], ['避雷/不踩雷', t => /雷|踩坑|避坑|别去|不踩/.test(t)]]);
    const Q = [['在哪/地址', /在哪|地址|位置|怎么去|哪里|定位/], ['人均/价格', /人均|多少钱|价格|贵|便宜/], ['排队', /排队|等位|人多/], ['营业时间', /几点|营业|开门|宵夜|夜宵/], ['真假/踩雷', /真的|踩雷|值得|水军|广告/], ['点什么', /点什么|必点|招牌/]];
    const all = M.flatMap(x => x.cm);
    return { 样本: `同类爆款库 ${M.length} 篇（小红书搜同类关键词、近期高赞图文），中位点赞 ${Math.round(median(M.map(x => x.likes)))}、中位收藏 ${Math.round(median(M.map(x => x.collects)))}`,
      列说明: '每项 [分组, 同类爆款里占比%, 自家爆款里占比%, 自家普通里占比%]；同类爆款和自家爆款都高、自家普通低的，就是该多做的',
      封面形式: cmp(x => x.c.封面形式), 封面主体: cmp(x => x.c.主体), 封面大字: cmp(x => x.c.封面形式 ? (yes(x.c.封面有大字) ? '有大字' : '无大字') : null),
      图片张数: cmp(x => bucket(x.imgs, [1, 3, 6, 8, 9], ['1张', '2-3张', '4-6张', '7-8张', '9张', '10张以上'])), 正文字数: cmp(x => bucket(x.len, [100, 250, 450], ['≤100字', '101-250字', '251-450字', '450字以上'])),
      话题数: cmp(x => bucket(x.ntag, [2, 5, 9], ['0-2个', '3-5个', '6-9个', '10个以上'])), 正文分条清单: cmp(x => x.emo >= 3 ? '是' : '否'), 标题特征: cmp(x => FE.filter(([, f]) => f(x.title)).map(([k]) => k)),
      评论区问题: Q.map(([k, re]) => [k, all.filter(t => re.test(t)).length]).filter(v => v[1]).sort((a, b) => b[1] - a[1]),
      高赞样本: M.sort((a, b) => b.likes - a.likes).slice(0, 15).map(x => ({ 关键词: x.kw, 标题: x.title, 点赞: x.likes, 收藏: x.collects, 封面: x.c.封面形式, 封面文字: String(x.c.封面文字 || '').slice(0, 40), 吸引点: x.c.封面吸引点, 图片张数: x.imgs })) };
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
    if (F.小红书 && F.小红书.样本) { const x = F.小红书; L.push('【小红书 · 自家内容库】' + x.样本); const fm = (nm, a) => a && a.length && L.push(`${nm}（同账号倍数 / 爆款率）：` + a.slice(0, 5).map(o => `${o[0]} ${o[4]}倍/${o[2]}%（${o[1]}条）`).join('、')); fm('内容类型', x.内容类型); fm('封面形式', x.封面形式); fm('图片张数', x.图片张数); fm('正文字数', x.正文字数); fm('话题数', x.话题数); }
    else if (F.小红书 && F.小红书.说明) L.push('【小红书】' + F.小红书.说明);
    Object.entries(F.官方号 || {}).forEach(([k, x]) => { L.push(`\n【${k}】${x.样本}`); const a = x.爆款vs普通平均; L.push(`5 秒完播：爆款 ${a['5秒完播率%'][0] ?? '—'}% vs 普通 ${a['5秒完播率%'][1] ?? '—'}%；2 秒跳出：${a['2秒跳出率%'][0] ?? '—'}% vs ${a['2秒跳出率%'][1] ?? '—'}%；时长：${a['时长秒'][0] ?? '—'} 秒 vs ${a['时长秒'][1] ?? '—'} 秒`); if (x.时长) L.push('时长爆款率：' + x.时长.map(o => `${o.分组} ${o.爆款率}%`).join('、')); });
    return L.join('\n');
  }

  async function report() {
    const F = { 小红书: await xhs().catch(e => ({ 说明: '读取出错：' + e.message })), 官方号: await official().catch(e => { log('[深度分析] 官方号出错：' + e.message); return null; }) }; try { const m = market(lastOwn); if (m) F.同类爆款 = m; } catch (e) { log('[深度分析] 同类爆款出错：' + e.message); }
    if (!F.小红书 && !F.官方号) return { text: '内容库和官方号数据都还没有，先让插件入库/同步', F, by: '无' };
    if (!llm) return { text: plain(F), F, by: '纯数字' };
    const prompt = `你是禧聚餐饮（YES也是大排档 / 粤迹岭南家宴）的内容策略分析师。下面是程序算好的两部分数据：
① 小红书自家内容库：每条笔记的封面看图标签（封面形式/主体/有无大字/色调/价格/地名）、图片张数、正文字数和结构、话题数、标题特征，按「爆款率」做了分组对比；附爆款笔记的封面吸引点和热门评论原文。全部是自然流（没投流）。
②′ 同类爆款（如有）：小红书上同类关键词近期高赞图文的特征分布，和自家爆款、自家普通对比，找出「别人爆款都在做、我们普通笔记没做」的差距。
② 抖音蓝 V 和视频号官方号：爆款和普通作品的 5 秒完播、2 秒跳出、快速划走、完播率、时长、互动率对比，时长分组、标题特征、发布星期，以及爆款样本。
请写「爆款公式」给老板林智斌，直接指导后续出图、写文案、拍视频。
要求：
1. 数字只能用数据里出现的，不许自己算新数字；某组条数 < 10 要标「样本少」。
1.5 账号之间流量差距很大，判断内容好坏优先看「同账号倍数」（扣掉账号大小的影响），爆款率只作参考；先用一段话说明账号差距有多大、这意味着什么（比如换号比换内容影响更大时要直说）。
2. 小红书部分：封面怎么做（形式、主体、要不要大字、写什么字）、放几张图、正文写多长写成什么结构、话题带几个、标题怎么起；从热门评论归纳「用户最关心什么」，建议正文里提前回答。
3. 官方号部分：开头几秒怎么留人（结合 5 秒完播 / 2 秒跳出差异）、视频多长最好、什么人设/选题容易爆。
3.5 有同类爆款数据时，单独写一段「和同类爆款比，我们差在哪」：列 3–5 条最大差距和对应改法。
4. 最后给「下周直接可用」：小红书 3 条（标题 + 封面怎么做 + 第 2–N 张拍什么），蓝 V 视频 2 条（标题 + 开头 3 秒拍什么）。
5. 飞书纯文本，不要 # 和 **，不要表格，用 emoji 小标题分块，1200 字以内。
【数据】
${JSON.stringify(F)}`;
    try {
      const text = (await llm(prompt)).trim().replace(/^#+\s*/gm, '').replace(/\*\*/g, '').replace(/^\s*[-*]\s+/gm, '· ').replace(/\n*(祝好|此致|\[您的名字\]|希望以上分析)[\s\S]*$/, '').trim();
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
