/* 攻略平台 · 爆款库（夜间采集）
 * 插件每 5 分钟问一次 /lib/gl/need：北京时间 22:00–次日 07:00 之间、到了下一轮的时间就给 2–3 个关键词
 * → 插件在小红书搜索页读列表交 /lib/gl/list → 服务器挑出达标、没收过的笔记让插件点进去读 → /lib/gl/ingest 入库（图片全部存服务器）
 * 防风控：每晚分十几小轮，每轮之间随机歇 20–40 分钟；每晚最多 30 个关键词、150 篇详情；碰到验证当晚立刻停（/lib/gl/blocked）
 * 早上 07:50 私聊老板一份汇总
 * 数据：data/gl/notes/<笔记ID>.json、data/gl/img/<笔记ID>/<序号>.<扩展名>、data/gl/night.json、data/gl/kw.json
 */
'use strict';
const fs = require('fs'); const path = require('path');
const DAY = 864e5;
const CITIES = ['深圳', '广州', '上海', '北京', '成都', '重庆', '杭州', '长沙', '西安', '南京', '武汉', '厦门', '苏州', '顺德', '佛山', '青岛', '珠海', '东莞', '天津', '大理', '泉州', '昆明', '三亚', '郑州', '南昌', '合肥', '福州', '济南', '汕头', '潮汕'];
const WORDS = ['美食清单', '必吃', '吃什么', '美食攻略', '一日游', '旅游攻略', '本地人推荐', '自存', '夯到拉', '美食合集', '要买的东西', '带朋友吃', '逛吃', '好吃的店'];
const CAP = { kw: 30, detail: 150, perRound: [2, 3], restMin: [20, 40], perKw: 6 };
const DCAP = { kw: 12, detail: 45, perRound: [1, 2], restMin: [60, 90], perKw: 4 }; // 白天（07:00–22:00）更少更慢，林总 2026-11-27 同意白天也跑
const bj = (t) => new Date((t || Date.now()) + 8 * 3600e3);
const bjHour = t => bj(t).getUTCHours();
const nightKey = t => { const d = bj(t); if (d.getUTCHours() < 12) d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }; // 晚上 22 点开始那一天
const inWindow = t => { const h = bjHour(t); return h >= 22 || h < 7; };
const num = v => { if (v === null || v === undefined || v === '') return 0; if (typeof v === 'number') return v; const m = String(v).replace(/,/g, '').match(/([\d.]+)\s*(万|w|W|千|k)?/); if (!m) return 0; let n = parseFloat(m[1]); if (/万|w/i.test(m[2] || '')) n *= 1e4; else if (/千|k/i.test(m[2] || '')) n *= 1e3; return Math.round(n); };
const idTime = id => { const s = parseInt(String(id).slice(0, 8), 16); return s > 1.4e9 && s < 2.2e9 ? s * 1000 : null; };

function heatOf(n, now) {
  const t = n.time || idTime(n.id) || now; const days = Math.max(1, (now - t) / DAY);
  const cs = num(n.collects) + num(n.shares); const daily = cs / days;
  const fresh = days <= 90 ? 1 : days <= 180 ? 0.8 : days <= 365 ? 0.5 : 0.3;
  return { daily: Math.round(daily * 10) / 10, heat: Math.round(daily * fresh * 10) / 10, days: Math.round(days), hot: days <= 90 && daily >= 20 };
}

function createGlib({ dataDir, log, cfg, vision, chat, notify, platformUrl }) {
  const D = path.join(dataDir, 'gl'); const ND = path.join(D, 'notes'); const ID = path.join(D, 'img');
  [D, ND, ID].forEach(d => { try { fs.mkdirSync(d, { recursive: true }); } catch (e) { } });
  const rj = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
  const wj = (f, v) => { const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(v)); fs.renameSync(tmp, f); };
  const NF = path.join(D, 'night.json'), DF = path.join(D, 'day.json'), KF = path.join(D, 'kw.json'), AF = path.join(D, 'authors.json'), PF = path.join(D, 'pause.json');
  let N = rj(NF, {}); let DY = rj(DF, {}); let K = rj(KF, {}); let AU = rj(AF, {}); let PA = rj(PF, {});
  const SF = path.join(D, 'seed.json'); let SD = rj(SF, { items: [] }); const saveS = () => wj(SF, SD);
  const saveN = () => { wj(NF, N); wj(DF, DY); }, saveK = () => wj(KF, K), saveA = () => wj(AF, AU);
  // 内存索引：所有笔记（不含正文和评论，列表页够用）
  const IDX = new Map();
  function load() { IDX.clear(); for (const f of fs.readdirSync(ND)) { if (!f.endsWith('.json')) continue; const n = rj(path.join(ND, f), null); if (n && n.id) IDX.set(n.id, slim(n)); } }
  function slim(n) { const { desc, comments, ...r } = n; return Object.assign(r, { descLen: String(desc || '').length }); }
  try { load(); } catch (e) { log('[爆款库] 读取出错：' + e.message); }
  const fresh = k => ({ key: k, kw: 0, detail: 0, rounds: 0, found: 0, added: 0, blocked: '', nextAt: 0, log: [], kws: [], sent: false });
  const night = () => { const k = nightKey(); if (N.key !== k) { N = fresh(k); saveN(); } return N; };
  const dayS = () => { const k = 'd' + bj().toISOString().slice(0, 10); if (DY.key !== k) { DY = fresh(k); saveN(); } return DY; };
  const cur = () => inWindow(Date.now()) ? night() : dayS(); const capOf = () => inWindow(Date.now()) ? CAP : DCAP;
  const nlog = t => { const n = cur(); n.log.unshift(bj().toISOString().slice(11, 16) + ' ' + t); n.log = n.log.slice(0, 80); saveN(); };

  // 本地店铺调研词（林总 2026-11-27：周边店从爆款库里找）：优先跑，3 天内不重复；笔记门槛放低（本地小店的笔记没那么爆）
  const FF = path.join(D, 'focus.json'); const focus = () => rj(FF, []);
  function setFocus(L) { const old = new Map(focus().map(x => [x.kw, x])); wj(FF, L.map(kw => old.get(kw) || { kw, at: Date.now() })); return focus(); }
  const isFocus = kw => focus().some(x => x.kw === kw);
  function pickKws(n) {
    const all = []; focus().forEach(x => all.push({ kw: x.kw, pri: 400, focus: 1 })); CITIES.forEach((c, ci) => WORDS.forEach((w, wi) => all.push({ kw: `${c}${w}`, pri: 100 - ci * 2 - wi })));
    // 爆过的笔记反推的「标题骨架 × 城市」排前面（同系列验证）
    (rj(path.join(D, 'skeleton.json'), []) || []).forEach(s => CITIES.slice(0, 10).forEach(c => all.push({ kw: s.replace(/X/g, c), pri: 120 })));
    const score = x => { const s = K[x.kw]; if (x.focus) return s && Date.now() - s.last < 3 * DAY ? -1 : 5000 + x.pri; if (!s) return 1000 + x.pri; const days = (Date.now() - s.last) / DAY; return x.pri * 0.3 + Math.min(days, 30) * 4 + (s.runs ? (s.hot / s.runs) * 30 : 0); };
    const used = new Set([...night().kws, ...dayS().kws]);
    return all.filter(x => !used.has(x.kw) && score(x) >= 0).sort((a, b) => score(b) - score(a)).slice(0, n).map(x => x.kw);
  }


  // ---------- 模板库导入（林总 2026-11-27）：朋友的爆文工厂模板库里文字类爆款的小红书链接，排队让插件慢慢回小红书重新读（图和分类都用我们自己的） ----------
  const SEED_TYPES = new Set(['美食清单', '文字页', '指南排版', '行程排版', '美食手账排版', '求推荐大字报']);
  async function seedFetch(force) {
    if (SD.fetched && !force) return { ok: true, n: SD.items.length };
    const r = await fetch(cfg.glSeedUrl || 'https://pai.kyrinflow.com/data.json', { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error('HTTP ' + r.status);
    const arr = await r.json(); const have = new Set(SD.items.map(x => x.id)); let add = 0;
    for (const x of Array.isArray(arr) ? arr : []) {
      if (!x || !SEED_TYPES.has(x.type)) continue; const m = String(x.url || '').match(/xiaohongshu\.com\/(?:explore|discovery\/item)\/([0-9a-f]{24})[^#]*?[?&]xsec_token=([^&#]+)/); if (!m || have.has(m[1])) continue;
      have.add(m[1]); add++; SD.items.push({ id: m[1], tok: decodeURIComponent(m[2]), title: String(x.title || '').slice(0, 60), type: x.type, sub: x.sub || '', cat: x.cat || '', date: x.date || '', fav: num(x.fav), share: num(x.share), daily: num(x.daily), st: IDX.has(m[1]) ? 1 : 0, tries: 0 });
    }
    SD.items.sort((a, b) => (b.st === 0) - (a.st === 0) || b.daily - a.daily || b.fav - a.fav); SD.fetched = Date.now(); saveS(); log(`[爆款库] 模板库导入队列 +${add}，共 ${SD.items.length}`); return { ok: true, add, n: SD.items.length };
  }
  setTimeout(() => seedFetch().catch(e => log('[爆款库] 模板库拉取出错：' + e.message)), 20e3);
  function seedPick(k) { const L = SD.items.filter(x => x.st === 0 && x.tries < 2 && !IDX.has(x.id)).slice(0, k); L.forEach(x => { x.tries++; x.at = Date.now(); }); if (L.length) saveS(); return L.map(x => ({ id: x.id, url: `https://www.xiaohongshu.com/explore/${x.id}?xsec_token=${encodeURIComponent(x.tok)}&xsec_source=pc_share`, type: x.type, sub: x.sub })); }
  function seedFail(b) { const x = SD.items.find(i => i.id === String(b.id || '')); if (x) { if (x.tries >= 2) x.st = 2; x.why = String(b.why || '').slice(0, 40); saveS(); } return { ok: true }; }
  const seedStat = () => { const c = { q: 0, ok: 0, bad: 0 }; SD.items.forEach(x => { if (x.st === 1 || IDX.has(x.id)) c.ok++; else if (x.st === 2) c.bad++; else c.q++; }); return c; };

  // ---------- 插件接口 ----------
  function need() {
    const now = Date.now(); const n = cur(); const CAP = capOf(); const isNight = inWindow(now);
    if (cfg.glNight === false) return { ok: true, task: 'none', why: '爆款采集已关' };
    if (!isNight && cfg.glDay === false) return { ok: true, task: 'none', why: '白天采集已关' };
    if (PA.until && now < PA.until) return { ok: true, task: 'none', why: '碰到过验证，暂停到 ' + bj(PA.until).toISOString().slice(5, 16) };
    if (n.blocked) return { ok: true, task: 'none', why: '碰到验证，已停：' + n.blocked };
    if (n.kw >= CAP.kw || n.detail >= CAP.detail) return { ok: true, task: 'none', why: (isNight ? '今晚' : '白天') + '额度用完' };
    if (n.nextAt && now < n.nextAt) return { ok: true, task: 'none', why: '休息中，下一轮 ' + bj(n.nextAt).toISOString().slice(11, 16) };
    if (n.running && now - n.running < 40 * 60e3) return { ok: true, task: 'none', why: '上一轮还没跑完' };
    let k = CAP.perRound[0] + Math.floor(Math.random() * (CAP.perRound[1] - CAP.perRound[0] + 1));
    // 模板库导入：每轮夹带几篇（晚上 3 篇、白天 1 篇），同时少搜 1 个词，总动作量不变
    const reads = seedPick(Math.min(isNight ? 5 : 1, Math.max(0, CAP.detail - n.detail - 2))); if (reads.length) k = Math.max(isNight ? 1 : 0, k - 1);
    const kws = k ? pickKws(Math.min(k, CAP.kw - n.kw)) : []; if (!kws.length && !reads.length) return { ok: true, task: 'none', why: '没有可跑的词' };
    n.running = now; n.rounds++; n.kws.push(...kws); n.kw += kws.length; saveN(); nlog(`第 ${n.rounds} 轮：${kws.join('、') || '（不搜词）'}${reads.length ? `；模板库导入 ${reads.length} 篇` : ''}`);
    return { ok: true, task: 'round', kws, reads, perKw: CAP.perKw, detailLeft: CAP.detail - n.detail };
  }
  // 插件交来搜索列表：记关键词效果、挑要点进去读的
  function list(b) {
    const n = cur(); const CAP = capOf(); const kw = String(b.kw || '').slice(0, 40); const L = (Array.isArray(b.list) ? b.list : []).filter(x => x && /^[0-9a-f]{24}$/.test(x.id) && x.type !== 'video' && x.kind !== 'video');
    const now = Date.now(); n.found += L.length;
    const cands = L.map(x => Object.assign({}, x, heatOf({ id: x.id, time: x.time, collects: x.collects, shares: x.shares }, now), { likes: num(x.likes) }))
      .filter(x => !IDX.has(x.id) && (isFocus(kw) ? x.days <= 365 && (num(x.collects) >= 50 || num(x.likes) >= 100) : x.days <= 180 && (x.daily >= 8 || num(x.collects) >= 500 || (x.collects === undefined && x.likes >= 1000))));
    cands.sort((a, c) => (c.heat || c.likes / 100) - (a.heat || a.likes / 100));
    const read = cands.slice(0, Math.min(CAP.perKw, Math.max(0, CAP.detail - n.detail))).map(x => ({ id: x.id, url: x.url }));
    const s = K[kw] || (K[kw] = { runs: 0, found: 0, hot: 0, last: 0 }); s.runs++; s.found += L.length; s.hot += cands.length; s.last = now; saveK(); saveN();
    nlog(`「${kw}」列表 ${L.length} 篇，达标没收过的 ${cands.length} 篇，读 ${read.length} 篇`);
    return { ok: true, read };
  }
  async function getImg(u) {
    const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', referer: 'https://www.xiaohongshu.com/' }, signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error('HTTP ' + r.status); const ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
    return { buf: Buffer.from(await r.arrayBuffer()), ext: /png/.test(ct) ? 'png' : /webp/.test(ct) ? 'webp' : 'jpg' };
  }
  let q = Promise.resolve();
  function ingest(b) { const p = q.then(() => ingest1(b)); q = p.catch(() => { }); return p; }
  async function ingest1(b) {
    const x = b.note || {}; const id = String(x.id || ''); if (!/^[0-9a-f]{24}$/.test(id)) throw new Error('缺少笔记ID');
    const n = b.src === 'night' ? cur() : null; if (n) n.detail++;
    if (x.type === 'video') { if (n) { saveN(); nlog('跳过视频笔记'); } return { ok: true, skip: 'video', images: 0 }; }
    const old = IDX.has(id) ? rj(path.join(ND, id + '.json'), {}) : null;
    const images = (Array.isArray(x.images) ? x.images : []).filter(u => /^https?:\/\/[^/]*(xhscdn|xiaohongshu)\.(com|net)\//.test(u)).slice(0, 30);
    const dir = path.join(ID, id); fs.mkdirSync(dir, { recursive: true }); const files = (old && old.files) || [];
    if (!files.length) for (let i = 0; i < images.length; i++) { try { const g = await getImg(images[i]); const f = `${i + 1}.${g.ext}`; fs.writeFileSync(path.join(dir, f), g.buf); files.push(f); } catch (e) { } }
    if (!files.length && !old) { try { fs.rmdirSync(dir); } catch (e) { } if (n) { saveN(); nlog(`没读到图片，不入库：${String(x.title || id).slice(0, 16)}`); } return { ok: true, skip: 'noimg', images: 0 }; }
    const note = Object.assign(old || { firstAt: Date.now(), kws: [] }, {
      id, platform: 'xhs', url: `https://www.xiaohongshu.com/explore/${id}`, title: String(x.title || '').slice(0, 200), desc: String(x.desc || '').slice(0, 6000), tags: (x.tags || []).map(String).slice(0, 20),
      author: String(x.author || ''), authorId: String(x.uid || x.authorId || ''), time: x.time || idTime(id), ip: x.ip || '', type: x.type === 'video' ? 'video' : 'note',
      likes: num(x.likes), collects: num(x.collects), comments: num(x.comments), shares: num(x.shares), pages: images.length, files, src: b.src || (old && old.src) || 'plugin', at: Date.now(),
      topComments: (Array.isArray(b.comments) ? b.comments : []).filter(c => c && c.text).sort((a, c) => num(c.likes) - num(a.likes)).slice(0, 12).map(c => ({ t: String(c.text).slice(0, 150), l: num(c.likes), a: !!c.author }))
    });
    if (b.kw && !note.kws.includes(b.kw)) note.kws.push(String(b.kw).slice(0, 40));
    { const sx = SD.items.find(i => i.id === id); if (sx) { sx.st = 1; saveS(); note.seed = { from: '模板库', type: sx.type, sub: sx.sub }; } }
    Object.assign(note, heatOf(note, Date.now()));
    wj(path.join(ND, id + '.json'), note); IDX.set(id, slim(note));
    if (n) { n.added++; saveN(); nlog(`入库《${note.title.slice(0, 18)}》藏 ${note.collects} 图 ${files.length}`); }
    // 作者：库里有 2 篇以上爆款 → 自动成为「模板号」
    if (note.authorId) { const a = AU[note.authorId] || (AU[note.authorId] = { name: note.author, notes: [], auto: false, at: Date.now() }); if (!a.notes.includes(id)) a.notes.push(id); a.name = note.author || a.name; if (!a.tpl && a.notes.filter(i => (IDX.get(i) || {}).daily >= 8).length >= 2) { a.tpl = Date.now(); a.why = `库里有 ${a.notes.length} 篇爆款`; if (n) nlog(`新模板号：${a.name}`); } saveA(); }
    classifyLater(id);
    return { ok: true, id, images: files.length };
  }
  function blocked(b) { const n = cur(); n.blocked = String(b.why || '验证').slice(0, 60); n.running = 0; PA = { until: Date.now() + 12 * 3600e3, why: n.blocked, at: Date.now() }; wj(PF, PA); saveN(); nlog('⚠️ 碰到验证，暂停 12 小时：' + n.blocked); if (notify) notify(`⚠️ 爆款采集碰到小红书验证（${n.blocked}），已自动暂停 12 小时，之后减量再跑。你用这个号刷小红书时如果看到验证，手动过一下就好。`).catch(() => { }); return { ok: true }; }
  function roundDone(b) { const n = cur(); n.running = 0; const [a, z] = capOf().restMin; n.nextAt = Date.now() + (a + Math.random() * (z - a)) * 60e3; if (b && b.err) nlog('本轮出错：' + String(b.err).slice(0, 80)); saveN(); return { ok: true, nextAt: n.nextAt }; }

  // ---------- AI 拆解：看封面和前两张，判断类型、标题套路、版式、能不能做成文字版式 ----------
  const CQ = []; let cBusy = false;
  function classifyLater(id) { if (!CQ.includes(id)) CQ.push(id); runC(); }
  async function runC() {
    if (cBusy || !CQ.length || !vision) return; cBusy = true;
    try {
      while (CQ.length) {
        const id = CQ.shift(); const f = path.join(ND, id + '.json'); const n = rj(f, null); if (!n || n.ai) continue;
        try {
          const img = (n.files || [])[0]; if (!img) continue; const buf = fs.readFileSync(path.join(ID, id, img)); const ext = img.split('.').pop();
          const prompt = `这是一篇小红书笔记的封面。标题：「${n.title}」。共 ${n.pages} 张图。正文开头：${String(n.desc || '').slice(0, 200)}
请判断这篇笔记的格式，只输出 JSON：{"大类":"美食攻略|旅游攻略|其他","类型":"美食清单|美食拼图/实拍|手账排版|路线/地图|分级榜单|提问求推荐|探店单店|其他","标题套路":"例如 通用合集/本地人私藏/吃过总结/排名分级夯到拉/和朋友一致认为/要买的东西清单/招待朋友/自存备忘录/求推荐提问/星级评分/土著推荐/其他 中选一个或自拟4-8字","版式":"一句话描述版式（底色、字体、排版、是否手机备忘录截图、有无手写批注、有无实拍图）","骨架":"把标题里的城市/地名换成 X 的标题骨架，例如 存一下下周去X要买的东西；没有地名就照抄","文字版式":true或false（主要靠文字排版、不靠实拍景点图就是 true）,"城市":"标题或封面里的城市，没有填空"}`;
          const t = await vision(prompt, `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${buf.toString('base64')}`);
          const m = String(t).match(/\{[\s\S]*\}/); if (!m) throw new Error('没返回 JSON'); const j = JSON.parse(m[0]);
          n.ai = { cat: j['大类'] || '', type: j['类型'] || '', trick: j['标题套路'] || '', layout: j['版式'] || '', skel: j['骨架'] || '', text: !!j['文字版式'], city: j['城市'] || '', at: Date.now() };
          // 文字类的再看第 2、3 张，记下内页怎么排（写稿时当结构模板参考，林总 2026-11-27）
          if ((n.ai.text || /清单|手账|路线|榜单/.test(n.ai.type)) && (n.files || []).length > 1) { const outs = []; for (const pf of n.files.slice(1, 3)) { try { const b2 = fs.readFileSync(path.join(ID, id, pf)); const e2 = pf.split('.').pop(); const t2 = await vision('这是一篇小红书文字攻略的内页。用 150 字以内写清楚这一页的内容结构：页标题怎么写、分了哪几组（组名原样写）、每组几项、每一项写了哪些信息（店名/招牌菜/价格/地址/一句评价/星级等），举 1–2 项原文做例子。只写结构，不要客套。', `data:image/${e2 === 'jpg' ? 'jpeg' : e2};base64,${b2.toString('base64')}`); outs.push(String(t2 || '').replace(/\s+/g, ' ').slice(0, 260)); } catch (e) { } } if (outs.length) n.ai.pagesText = outs.map((t, i) => `P${i + 2}：${t}`).join('\n'); }
          wj(f, n); IDX.set(id, slim(n));
          if (n.ai.skel && /X/.test(n.ai.skel) && n.daily >= 20) { const sf = path.join(D, 'skeleton.json'); const S = rj(sf, []); if (!S.includes(n.ai.skel)) { S.push(n.ai.skel); wj(sf, S.slice(-40)); } }
        } catch (e) { log('[爆款库] 拆解出错：' + e.message); }
        await new Promise(r => setTimeout(r, 1500));
      }
    } finally { cBusy = false; }
  }
  setTimeout(() => { for (const [id, n] of IDX) if (!n.ai && (n.files || []).length) CQ.push(id); runC(); }, 120e3);

  // ---------- 早上汇总 ----------
  function summary() {
    const n = N; const since = Date.now() - 12 * 3600e3; const fresh = [...IDX.values()].filter(x => x.firstAt >= since).sort((a, b) => b.heat - a.heat);
    const types = {}; fresh.forEach(x => { const k = (x.ai && x.ai.trick) || '未拆解'; types[k] = (types[k] || 0) + 1; });
    const tpl = Object.values(AU).filter(a => a.tpl && a.tpl >= since);
    return `📚 昨晚爆款采集（${n.key || ''}）\n跑了 ${n.rounds || 0} 轮、${n.kw || 0} 个关键词，列表看了 ${n.found || 0} 篇，读详情 ${n.detail || 0} 篇，新入库 ${fresh.length} 篇。` +
      (n.blocked ? `\n⚠️ 碰到小红书验证，已提前停止：${n.blocked}。今晚会自动减量。` : '\n✅ 全程没碰到验证。') +
      (fresh.length ? '\n\n最热的几篇：\n' + fresh.slice(0, 5).map((x, i) => `${i + 1}. 《${x.title.slice(0, 22)}》 日均藏+转 ${x.daily}，收藏 ${x.collects}`).join('\n') : '') +
      (Object.keys(types).length ? '\n\n格式分布：' + Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join('、') : '') +
      (tpl.length ? `\n\n新发现的模板号：${tpl.map(a => a.name).join('、')}` : '') +
      `\n\n库里一共 ${IDX.size} 篇。看全部：${platformUrl}`;
  }
  setInterval(async () => { try { const n = night(); const d = bj(); if (d.getUTCHours() === 7 && d.getUTCMinutes() >= 50 && !n.sent && (n.rounds || n.blocked)) { n.sent = true; saveN(); if (notify) await notify(summary()); log('[爆款库] 早上汇总已发'); } } catch (e) { log('[爆款库] 汇总出错：' + e.message); } }, 60e3);

  // ---------- 给平台页面用 ----------
  function query(f) {
    f = f || {}; let L = [...IDX.values()];
    if (f.cat) L = L.filter(x => x.ai && x.ai.cat === f.cat);
    if (f.type) L = L.filter(x => x.ai && x.ai.type === f.type);
    if (f.trick) L = L.filter(x => x.ai && x.ai.trick === f.trick);
    if (f.text === '1') L = L.filter(x => x.ai && x.ai.text);
    if (f.hot === '1') L = L.filter(x => x.hot);
    if (f.days) L = L.filter(x => x.firstAt >= Date.now() - +f.days * DAY);
    if (f.q) L = L.filter(x => (x.title + ' ' + x.author + ' ' + (x.kws || []).join(' ')).includes(f.q));
    const key = { heat: x => x.heat, collects: x => x.collects, new: x => x.time || 0, in: x => x.firstAt }[f.sort] || (x => x.heat);
    L.sort((a, b) => key(b) - key(a));
    const facet = k => { const m = {}; IDX.forEach(x => { const v = x.ai && x.ai[k]; if (v) m[v] = (m[v] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
    const off = +f.off || 0; return { ok: true, total: L.length, all: IDX.size, items: L.slice(off, off + (+f.n || 60)), facets: { cat: facet('cat'), type: facet('type'), trick: facet('trick') } };
  }
  function get(id) { const n = rj(path.join(ND, id + '.json'), null); if (!n) return null; const a = AU[n.authorId]; return Object.assign(n, { tplAuthor: !!(a && a.tpl), authorNotes: a ? a.notes.length : 0 }); }
  function imgPath(id, f) { if (!/^[0-9a-f]{24}$/.test(id) || !/^\d+\.(jpg|png|webp)$/.test(f)) return null; const p = path.join(ID, id, f); return fs.existsSync(p) ? p : null; }
  function status() { const n = night(), d = dayS(); return { ok: true, night: Object.assign({}, n, { log: n.log.slice(0, 30) }), day: Object.assign({}, d, { log: d.log.slice(0, 20) }), pause: PA.until > Date.now() ? PA : null, window: inWindow(Date.now()), total: IDX.size, seed: seedStat(), authors: Object.values(AU).filter(a => a.tpl).map(a => ({ name: a.name, n: a.notes.length, why: a.why })), caps: CAP }; }
  return { need, list, ingest, blocked, roundDone, seedFetch, seedFail, setFocus, focus, query, get, imgPath, status, summary, reload: load, count: () => IDX.size };
}
module.exports = { createGlib, heatOf };
