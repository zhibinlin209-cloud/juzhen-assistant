/* 自家内容库：插件在老板自己的 Chrome 里逐条打开我们发过的小红书笔记，读出标题/正文/话题/图片/互动/热门评论，
 * 交给这里 → 图片下载存进私密表格「自家内容库」（附件，不怕链接失效）→ 通义千问看封面和前几张图打标签
 * 接口只认插件里的入库口令（data/ingest-key.txt），口令不进代码仓库
 */
'use strict';
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const NAME = '自家内容库';
const COLS = [['笔记ID', 1], ['链接', 15], ['账号', 1], ['门店', 1], ['内容类型', 1], ['发布日期', 5], ['标题', 1], ['正文', 1], ['话题', 1], ['笔记形式', 1], ['图片数', 2], ['正文字数', 2],
  ['封面', 17], ['图片', 17], ['小眼睛', 2], ['点赞', 2], ['收藏', 2], ['评论', 2], ['分享', 2], ['热门评论', 1], ['封面分析', 1], ['读取状态', 1], ['读取时间', 5], ['来源记录', 1]];
const val = v => Array.isArray(v) ? v.map(x => (x && typeof x === 'object') ? (x.text || x.name || x.link || '') : String(x)).join('') : (v && typeof v === 'object') ? (v.text || v.name || v.link || '') : (v ?? '');
const linkOf = v => { const m = JSON.stringify(v ?? '').match(/https?:\/\/[^"\s\\]+/); return m ? m[0] : ''; };
const num = v => { if (typeof v === 'number') return v; const s = val(v); const n = parseFloat(String(s).replace(/,/g, '')); return isFinite(n) ? n * (/万|w/i.test(s) ? 1e4 : 1) : null; };
const maxOf = (...a) => { const n = a.map(num).filter(x => x != null); return n.length ? Math.max(...n) : null; };

function createOwnLib({ cfg, api, core, upload, download, log, dataDir }) {
  const VLS = [...new Set([cfg.qwenModel, 'qwen3-vl-plus', 'qwen-vl-max-latest', 'qwen2.5-vl-72b-instruct', 'qwen-vl-max', 'qwen-vl-plus', 'qwen2.5-vl-32b-instruct'].filter(Boolean))]; let vlOk = null; const vlBad = new Set();
  const FILE = path.join(dataDir, 'ownlib.json'); const KEYF = path.join(dataDir, 'ingest-key.txt');
  let S = { done: {} }; try { S = Object.assign(S, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) { }
  const saveS = () => { try { fs.writeFileSync(FILE, JSON.stringify(S)); } catch (e) { } };
  const ingestKey = () => { try { return fs.readFileSync(KEYF, 'utf8').trim(); } catch (e) { return ''; } };
  const okKey = k => { const good = ingestKey(); if (!good || good.length < 20 || !k) return false; const a = Buffer.from(String(k)), b = Buffer.from(good); return a.length === b.length && crypto.timingSafeEqual(a, b); };
  const priv = () => { const m = String(cfg.dailyBaseUrl || '').match(/\/base\/([A-Za-z0-9]+)/); if (!m) throw new Error('NO_PRIVATE_BASE'); return m[1]; };
  // 搬到营销部表格之后（data/libbase.json 记着哪张表搬了），这张表的读写都去营销部
  const LBF = path.join(dataDir, 'libbase.json'); const movedTo = name => { try { return !!JSON.parse(fs.readFileSync(LBF, 'utf8'))[name]; } catch (e) { return false; } };
  const appOf = async name => movedTo(name) ? await core.appToken() : priv();
  async function tables(app) { const all = []; let pt = ''; do { const d = await api.call('GET', `/bitable/v1/apps/${app}/tables`, null, Object.assign({ page_size: 100 }, pt ? { page_token: pt } : {})); all.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt); return all; }
  async function recs(app, tid) { const out = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${tid}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); out.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt); return out; }
  let tid = null;
  async function table() {
    if (tid) return tid; const A = await appOf(NAME); const t = (await tables(A)).find(x => x.name === NAME);
    if (t) { const fd = await api.call('GET', `/bitable/v1/apps/${A}/tables/${t.table_id}/fields`, null, { page_size: 200 }); const hv = new Set((fd.items || []).map(f => f.field_name)); for (const [field_name, type] of COLS) if (!hv.has(field_name)) await api.call('POST', `/bitable/v1/apps/${A}/tables/${t.table_id}/fields`, { field_name, type }); return (tid = t.table_id); }
    const d = await api.call('POST', `/bitable/v1/apps/${A}/tables`, { table: { name: NAME, default_view_name: '全部', fields: COLS.map(([field_name, type]) => ({ field_name, type })) } });
    log('[内容库] 新建表：' + NAME); return (tid = d.table_id);
  }

  // 待读清单：营销部「小红书矩阵号-数据」里有小红书链接、还没读过的（新的在前）
  let src = null;
  async function source(force) {
    if (src && !force && Date.now() - src.at < 10 * 60e3) return src.list;
    const app = await core.appToken(); const t = (await tables(app)).find(x => x.name === '小红书矩阵号-数据'); if (!t) throw new Error('没找到「小红书矩阵号-数据」');
    const list = (await recs(app, t.table_id)).map(r => { const f = r.fields || {}; return { rec: r.record_id, link: linkOf(f['小红书链接']), home: linkOf(f['主页链接']), acc: String(val(f['账号昵称']) || '').trim(), store: String(val(f['笔记门店']) || '').trim(), kind: String(val(f['内容类型']) || val(f['笔记类型']) || '').trim(), date: typeof f['发布日期'] === 'number' ? f['发布日期'] : null, title: String(val(f['标题(供AI读取)']) || val(f['标题']) || '').split('\n')[0].trim().slice(0, 40), views: maxOf(f['小眼睛(自动)'], f['小眼睛']) }; })
      .filter(x => /xiaohongshu\.com|xhslink/.test(x.link)).sort((a, b) => (b.date || 0) - (a.date || 0));
    src = { at: Date.now(), list }; return list;
  }
  async function todo(limit) {
    const list = await source(); const left = list.filter(x => !S.done[x.rec] || /^retry/.test(S.done[x.rec]));
    const hm = {}; list.forEach(x => { if (x.acc && /user\/profile\/[0-9a-f]{24}/.test(x.home)) hm[x.acc] = x.home; }); // 同一个账号别的行登记过主页也能用
    const withHome = x => /user\/profile\/[0-9a-f]{24}/.test(x.home) ? x.home : (hm[x.acc] || '');
    // 分享链接过期的：有标题就让插件用标题去搜（像人一样搜一下再点开），没标题才跳过；能直接读的排前面
    const usable = left.filter(x => !/^retry/.test(S.done[x.rec] || '') || x.title.length >= 4 || withHome(x));
    const rk = x => /^retry/.test(S.done[x.rec] || '') ? 1 : 0; usable.sort((a, b) => rk(a) - rk(b));
    return { total: list.length, done: list.length - left.length, left: left.length, skipped: left.length - usable.length, items: usable.slice(0, Math.min(+limit || 50, 300)).map(x => ({ rec: x.rec, link: x.link, acc: x.acc, home: withHome(x), title: x.title, expired: !!rk(x) })) };
  }

  async function getImg(u) {
    const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', referer: 'https://www.xiaohongshu.com/' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('HTTP ' + r.status); const buf = Buffer.from(await r.arrayBuffer()); const ct = r.headers.get('content-type') || 'image/jpeg';
    return { buf, ct: /image\//.test(ct) ? ct.split(';')[0] : 'image/jpeg' };
  }
  // 通义千问看图：封面 + 前 3 张，输出结构化标签
  async function tag(imgs, title) {
    if (!cfg.qwenKey || !imgs.length) return '';
    let pick = imgs.slice(0, 2); if (pick.reduce((s, x) => s + x.buf.length, 0) > 5e6) pick = imgs.slice(0, 1);
    const prompt = `这是一条小红书餐饮笔记（标题：${title || '无'}）的封面${pick.length > 1 ? `和后面 ${pick.length - 1} 张图` : ''}。只按看到的内容回答，输出一行 JSON，不要别的文字：
{"封面形式":"单图/拼图/大字报/攻略长图/地图路线/菜单价目/前后对比/其他","拼图格数":数字,"封面有大字":true/false,"封面文字":"封面上的大字原文，没有就空","主体":"菜品特写/多菜摆满桌/人物出镜/店面门头/环境装修/地图/文字为主","色调":"暖色/冷色/高饱和/低饱和","有价格信息":true/false,"有地名或路名":true/false,"后续图片内容":"一句话概括第2张起都在拍什么","封面吸引点":"一句话"}`;
    for (const model of (vlOk ? [vlOk] : []).concat(VLS.filter(m => m !== vlOk && !vlBad.has(m)))) {
      try {
        const r = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.qwenKey }, signal: AbortSignal.timeout(90000),
          body: JSON.stringify({ model, temperature: 0.1, max_tokens: 600, messages: [{ role: 'user', content: pick.map(x => ({ type: 'image_url', image_url: { url: `data:${x.ct};base64,` + x.buf.toString('base64') } })).concat([{ type: 'text', text: prompt }]) }] }) });
        const j = await r.json().catch(() => ({})); if (!r.ok) { const em = (j.error && j.error.message) || String(r.status); if (/not exist|not found|model/i.test(em)) vlBad.add(model); log(`[内容库] 看图模型 ${model}：${em}`); continue; }
        if (vlOk !== model) { vlOk = model; log('[内容库] 看图模型用 ' + model); }
        const t = (((j.choices || [])[0] || {}).message || {}).content || ''; const m = t.match(/\{[\s\S]*\}/); if (!m) return t.slice(0, 500);
        try { return JSON.stringify(JSON.parse(m[0])); } catch (e) { return m[0].slice(0, 800); }
      } catch (e) { log('[内容库] 看图出错：' + e.message); }
    }
    return '';
  }

  let busy = Promise.resolve();
  function ingest(b) { const p = busy.then(() => ingest1(b)); busy = p.catch(() => { }); return p; }
  async function ingest1(b) {
    const rec = String(b.rec || ''); if (!/^rec[A-Za-z0-9]+$/.test(rec)) throw new Error('缺少来源记录');
    const s = (await source()).find(x => x.rec === rec) || {};
    if (b.error) { const retry = !!b.retry; S.done[rec] = (retry ? 'retry:' : 'fail:') + String(b.error).slice(0, 60); saveS(); log(`[内容库] ${s.acc || ''} 读不到：${b.error}`); return { ok: true, skipped: true }; }
    const n = b.note || {}; const A = await appOf(NAME), T = await table();
    const images = (Array.isArray(n.images) ? n.images : []).filter(u => /^https?:\/\/[^/]*(xhscdn|xiaohongshu)\.(com|net)\//.test(u)).slice(0, 18);
    const got = []; for (const u of images) { try { got.push(await getImg(u)); } catch (e) { log('[内容库] 图片下载失败：' + e.message); } }
    const toks = []; for (let i = 0; i < got.length; i++) { try { const ext = /png/.test(got[i].ct) ? 'png' : /webp/.test(got[i].ct) ? 'webp' : 'jpg'; toks.push({ file_token: await upload(got[i].buf, `${n.id || rec}-${i + 1}.${ext}`, 'bitable_image', A) }); } catch (e) { log('[内容库] 图片上传失败：' + e.message); } }
    const cover = await tag(got, n.title).catch(() => '');
    const tags = (Array.isArray(n.tags) ? n.tags : []).map(String).filter(Boolean);
    const desc = String(n.desc || '');
    const cm = (Array.isArray(b.comments) ? b.comments : []).filter(c => c && c.text).sort((a, z) => (num(z.likes) || 0) - (num(a.likes) || 0)).slice(0, 15).map(c => `${c.author ? '【作者】' : ''}${String(c.text).slice(0, 120)}${num(c.likes) ? `（${num(c.likes)}赞）` : ''}`).join('\n');
    const f = { 笔记ID: String(n.id || ''), 链接: { link: n.id ? `https://www.xiaohongshu.com/explore/${n.id}` : (s.link || b.link), text: s.link || b.link || '' }, 账号: s.acc || String(n.author || ''), 门店: s.store || '', 内容类型: s.kind || '', 标题: String(n.title || '').slice(0, 200), 正文: desc.slice(0, 5000), 话题: tags.map(t => '#' + t).join(' '),
      笔记形式: n.type === 'video' ? '视频' : '图文', 图片数: images.length, 正文字数: desc.replace(/#\S+/g, '').replace(/\s/g, '').length, 点赞: num(n.likes), 收藏: num(n.collects), 评论: num(n.comments), 分享: num(n.shares), 小眼睛: s.views, 热门评论: cm, 封面分析: cover, 读取状态: '已读取', 读取时间: Date.now(), 来源记录: rec };
    if (s.date || n.time) f.发布日期 = s.date || n.time;
    if (toks.length) { f.封面 = toks.slice(0, 1); f.图片 = toks.slice(1); if (!f.图片.length) delete f.图片; }
    Object.keys(f).forEach(k => (f[k] === null || f[k] === undefined || f[k] === '') && delete f[k]);
    const old = S.rows && S.rows[rec];
    if (old) await api.call('PUT', `/bitable/v1/apps/${A}/tables/${T}/records/${old}`, { fields: f });
    else { const d = await api.call('POST', `/bitable/v1/apps/${A}/tables/${T}/records`, { fields: f }); S.rows = S.rows || {}; S.rows[rec] = d.record.record_id; }
    S.done[rec] = 'ok:' + (n.id || ''); saveS();
    try { const dir = path.join(dataDir, 'ownlib'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, rec + '.json'), JSON.stringify({ src: s, note: Object.assign({}, n, { images }), comments: b.comments || [], cover, at: Date.now() })); } catch (e) { }
    log(`[内容库] 入库 ${f.账号 || ''}《${String(n.title || '').slice(0, 20)}》图 ${toks.length}/${images.length}${cover ? ' · 已看图' : ''}`);
    return { ok: true, images: toks.length };
  }
  // 补看图：表里有封面但没有「封面分析」的，从飞书附件取图重新看
  let filling = false;
  async function backfill(max) {
    if (filling || !cfg.qwenKey || !download) return 0; filling = true; let n = 0;
    try {
      const A = await appOf(NAME), T = await table(); const all = await recs(A, T);
      for (const r of all) {
        if (n >= (max || 2000)) break; const f = r.fields || {}; if (f['封面分析'] || !Array.isArray(f['封面'])) continue;
        const atts = f['封面'].concat(Array.isArray(f['图片']) ? f['图片'] : []).slice(0, 2); const imgs = [];
        for (const a of atts) { try { imgs.push({ buf: await download(a.url || a.tmp_url), ct: a.type || 'image/jpeg' }); } catch (e) { } }
        const c = await tag(imgs, val(f['标题'])); if (!c) { if (!vlOk) break; continue; }
        await api.call('PUT', `/bitable/v1/apps/${A}/tables/${T}/records/${r.record_id}`, { fields: { 封面分析: c } }); n++;
      }
      if (n) log(`[内容库] 补看图 ${n} 条`);
    } catch (e) { log('[内容库] 补看图出错：' + e.message); } finally { filling = false; }
    return n;
  }
  // ---------- 同类爆款库：插件在小红书搜同类关键词，读回别人的高赞笔记 ----------
  const MNAME = '同类爆款库';
  const MCOLS = [['笔记ID', 1], ['链接', 15], ['关键词', 1], ['作者', 1], ['发布时间', 5], ['标题', 1], ['正文', 1], ['话题', 1], ['笔记形式', 1], ['图片数', 2], ['正文字数', 2], ['封面', 17], ['图片', 17], ['点赞', 2], ['收藏', 2], ['评论', 2], ['分享', 2], ['热门评论', 1], ['封面分析', 1], ['读取时间', 5]];
  let mtid = null; const MFILE = path.join(dataDir, 'market.json'); let M = { done: {} }; try { M = Object.assign(M, JSON.parse(fs.readFileSync(MFILE, 'utf8'))); } catch (e) { }
  async function mtable() {
    if (mtid) return mtid; const A = await appOf(MNAME); const t = (await tables(A)).find(x => x.name === MNAME);
    if (t) return (mtid = t.table_id);
    const d = await api.call('POST', `/bitable/v1/apps/${A}/tables`, { table: { name: MNAME, default_view_name: '全部', fields: MCOLS.map(([field_name, type]) => ({ field_name, type })) } }); log('[同类爆款] 新建表：' + MNAME); return (mtid = d.table_id);
  }
  function marketSeen() { return Object.keys(M.done); }
  function market(b) { const p = busy.then(() => market1(b)); busy = p.catch(() => { }); return p; }
  async function market1(b) {
    const n = b.note || {}; const id = String(n.id || ''); if (!/^[0-9a-f]{24}$/.test(id)) throw new Error('缺少笔记ID'); if (M.done[id]) return { ok: true, dup: true };
    const A = await appOf(MNAME), T = await mtable();
    const images = (Array.isArray(n.images) ? n.images : []).filter(u => /^https?:\/\/[^/]*(xhscdn|xiaohongshu)\.(com|net)\//.test(u)).slice(0, 18);
    const got = []; for (const u of images.slice(0, 6)) { try { got.push(await getImg(u)); } catch (e) { } } // 别人的笔记只存前 6 张
    const toks = []; for (let i = 0; i < got.length; i++) { try { toks.push({ file_token: await upload(got[i].buf, `${id}-${i + 1}.jpg`, 'bitable_image', A) }); } catch (e) { } }
    const cover = await tag(got, n.title).catch(() => '');
    const desc = String(n.desc || ''); const tags = (Array.isArray(n.tags) ? n.tags : []).map(String).filter(Boolean);
    const cm = (Array.isArray(b.comments) ? b.comments : []).filter(c => c && c.text).sort((a, z) => (num(z.likes) || 0) - (num(a.likes) || 0)).slice(0, 15).map(c => `${c.author ? '【作者】' : ''}${String(c.text).slice(0, 120)}${num(c.likes) ? `（${num(c.likes)}赞）` : ''}`).join('\n');
    const f = { 笔记ID: id, 链接: { link: `https://www.xiaohongshu.com/explore/${id}`, text: '原帖' }, 关键词: String(b.kw || '').slice(0, 40), 作者: String(n.author || ''), 标题: String(n.title || '').slice(0, 200), 正文: desc.slice(0, 5000), 话题: tags.map(t => '#' + t).join(' '),
      笔记形式: n.type === 'video' ? '视频' : '图文', 图片数: images.length, 正文字数: desc.replace(/#\S+/g, '').replace(/\s/g, '').length, 点赞: num(n.likes), 收藏: num(n.collects), 评论: num(n.comments), 分享: num(n.shares), 热门评论: cm, 封面分析: cover, 读取时间: Date.now() };
    if (n.time) f.发布时间 = n.time; if (toks.length) { f.封面 = toks.slice(0, 1); if (toks.length > 1) f.图片 = toks.slice(1); }
    Object.keys(f).forEach(k => (f[k] === null || f[k] === undefined || f[k] === '') && delete f[k]);
    await api.call('POST', `/bitable/v1/apps/${A}/tables/${T}/records`, { fields: f });
    M.done[id] = Date.now(); try { fs.writeFileSync(MFILE, JSON.stringify(M)); const dir = path.join(dataDir, 'market'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify({ kw: b.kw, note: Object.assign({}, n, { images }), comments: b.comments || [], cover, at: Date.now() })); } catch (e) { }
    log(`[同类爆款] 入库「${b.kw || ''}」${n.author || ''}《${String(n.title || '').slice(0, 20)}》赞 ${n.likes}`);
    return { ok: true, images: toks.length };
  }
  function stats() { const v = Object.values(S.done); return { ok: v.filter(x => /^ok/.test(x)).length, fail: v.filter(x => /^fail/.test(x)).length, retry: v.filter(x => /^retry/.test(x)).length }; }
  const reset = () => { tid = null; mtid = null; };
  return { okKey, todo, ingest, stats, table, backfill, market, marketSeen, reset, NAME, MNAME };
}
module.exports = { createOwnLib };
