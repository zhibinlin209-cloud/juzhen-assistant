/* 禧聚营销部 · 飞书群机器人
 * 同事在群里发「小红书/点评/携程/微信」分享 → 自动登记到多维表格「小红书矩阵号-数据」
 * 同事在群里发小红书「数据中心」截图 → 自动更新小眼睛/赞/评（写在「(自动)」列）
 * 用飞书「长连接」收消息：不需要公网服务器，电脑或云服务器开着这个程序就行
 */
'use strict';
const fs = require('fs'); const path = require('path'); const readline = require('readline');
const { createCore, replyForText, replyForImage, replyForDaily, replyForDouyin, replyForChannels } = require('./lib/core');
const { fetchDouyin } = require('./lib/douyin');
const { createBrief, bjDay } = require('./lib/brief');
const { createWeb } = require('./lib/web');
const { createTgt, replyForTgt } = require('./lib/tgt');
const { createDraft, replyForDraft, createDispatch, isInstr, parseInstr } = require('./lib/draft');

const DATA_DIR = process.env.BOT_DATA_DIR || __dirname; // 云端：密钥和日志放在代码目录之外
const CFG_FILE = path.join(DATA_DIR, 'config.json');
const LOG_FILE = path.join(DATA_DIR, 'bot.log');
const API = 'https://open.feishu.cn/open-apis';
// 各 Agent 的动态（驾驶舱显示「上次做了什么」「今天几次」）
const ACT = { ev: {}, day: -1, n: {}, patrols: 0 };
const bjd = () => Math.floor((Date.now() + 8 * 3600e3) / 864e5);
function track(line) {
  const k = /\[日报/.test(line) ? 'biz' : /\[(登记|抖音登记|截图)\]/.test(line) ? 'content' : /\[简报\].*发送/.test(line) ? 'ceo' : /\[推广通\]/.test(line) ? 'ads' : null; if (!k) return;
  if (ACT.day !== bjd()) { ACT.day = bjd(); ACT.n = {}; ACT.patrols = 0; }
  ACT.n[k] = (ACT.n[k] || 0) + 1; ACT.ev[k] = { at: Date.now(), what: line.replace(/^.*?\]\s*/, '').replace(/^\[[^\]]+\]\s*/, '').slice(0, 24) };
}
const activity = () => { if (ACT.day !== bjd()) { ACT.day = bjd(); ACT.n = {}; ACT.patrols = 0; } return { patrols: ACT.patrols, count: k => ACT.n[k] || 0, last: k => ACT.ev[k] || {} }; };
function log(...a) { const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ` + a.join(' '); console.log(line); try { track(a.join(' ')); } catch (e) { } try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) { } }

async function setup() {
  if (fs.existsSync(CFG_FILE)) return JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
  if (!process.stdin.isTTY) { console.log('找不到 ' + CFG_FILE + '（云端运行时请先放好这个文件）'); process.exit(1); }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); const ask = (q, d) => new Promise(r => rl.question(q + (d ? `（直接回车 = ${d}）` : '') + '：', a => r((a || '').trim() || d || '')));
  console.log('\n第一次运行，先填几个信息（只保存在本机 config.json，不会上传）\n');
  const cfg = {
    appId: await ask('飞书 App ID', 'cli_aa628b0fa2badd00'),
    appSecret: await ask('飞书 App Secret（开放平台「凭证与基础信息」里复制）'),
    baseUrl: await ask('多维表格链接', 'https://fcnho4h972nd.feishu.cn/wiki/UqwGw0XTOi2MzgkXyZKcVDO5nkg'),
    xhsTable: await ask('小红书表名', '小红书矩阵号-数据'),
    qwenKey: await ask('通义千问 API Key（识别截图用，不填就不识别截图）'),
    qwenModel: 'qwen-vl-max',
    chats: []
  };
  rl.close(); fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2)); console.log('已保存 config.json\n'); return cfg;
}

(async () => {
  const cfg = await setup();
  // 私密设置（不含密钥）：营业日报写到哪张私密表格
  try { const extra = path.join(DATA_DIR, 'private.json'); if (fs.existsSync(extra)) Object.assign(cfg, JSON.parse(fs.readFileSync(extra, 'utf8'))); } catch (e) { log('private.json 读取失败：', e.message); }
  log(cfg.dailyBaseUrl ? '营业日报 → 私密表格（只写这里）' : '营业日报：还没设置私密表格，收到也不会记录');
  if (!cfg.appSecret) { console.log('没填 App Secret，删掉 config.json 重新运行'); process.exit(1); }

  // ---------- 飞书接口 ----------
  let tok = null;
  async function token() {
    if (tok && tok.exp > Date.now() + 60e3) return tok.v;
    const j = await fetch(API + '/auth/v3/tenant_access_token/internal', { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ app_id: cfg.appId, app_secret: cfg.appSecret }) }).then(r => r.json());
    if (j.code !== 0) throw new Error('飞书凭证不对：' + j.msg); tok = { v: j.tenant_access_token, exp: Date.now() + j.expire * 1000 }; return tok.v;
  }
  async function call(method, p, body, q) {
    for (let i = 0; i < 6; i++) {
      const r = await fetch(API + p + (q ? '?' + new URLSearchParams(q) : ''), { method, headers: { authorization: 'Bearer ' + await token(), 'content-type': 'application/json; charset=utf-8' }, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({ code: r.status, msg: 'HTTP ' + r.status }));
      if (j.code === 0) return j.data || {};
      if ([1254290, 1254607].includes(j.code) || r.status === 429) { await new Promise(s => setTimeout(s, 2500 * (i + 1))); continue; }
      throw new Error(`飞书接口 ${p} 出错（${j.code}：${j.msg}）`);
    }
    throw new Error('飞书接口太忙');
  }
  async function reply(messageId, text) { if (!text) return; try { await call('POST', `/im/v1/messages/${messageId}/reply`, { msg_type: 'text', content: JSON.stringify({ text }) }); } catch (e) { log('回复失败', e.message); } }
  const names = {};
  async function senderName(openId) { if (!openId) return ''; if (names[openId] !== undefined) return names[openId]; try { const d = await call('GET', `/contact/v3/users/${openId}`, null, { user_id_type: 'open_id' }); names[openId] = (d.user && d.user.name) || ''; } catch (e) { names[openId] = ''; log('读不到发消息人的名字：', e.message); } return names[openId]; }
  async function image(messageId, key) {
    const r = await fetch(`${API}/im/v1/messages/${messageId}/resources/${key}?type=image`, { headers: { authorization: 'Bearer ' + await token() } });
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('下载图片失败 HTTP ' + r.status + ' ' + t.slice(0, 200)); }
    const buf = Buffer.from(await r.arrayBuffer()); return `data:${r.headers.get('content-type') || 'image/jpeg'};base64,` + buf.toString('base64');
  }
  async function fileBuf(messageId, key) {
    const r = await fetch(`${API}/im/v1/messages/${messageId}/resources/${key}?type=file`, { headers: { authorization: 'Bearer ' + await token() } });
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('下载文件失败 HTTP ' + r.status + ' ' + t.slice(0, 200)); }
    return Buffer.from(await r.arrayBuffer());
  }
  async function imgBuf(messageId, key) { const r = await fetch(`${API}/im/v1/messages/${messageId}/resources/${key}?type=image`, { headers: { authorization: 'Bearer ' + await token() } }); if (!r.ok) throw new Error('下载图片失败 HTTP ' + r.status); return Buffer.from(await r.arrayBuffer()); }
  async function upload(buf, name, parentType, parentNode) { // 传到多维表格（附件列用）；超过 20MB 分片传
    if (buf.length > 20 * 1024 * 1024) {
      const H = { authorization: 'Bearer ' + await token() };
      const pre = await fetch(`${API}/drive/v1/medias/upload_prepare`, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, H), body: JSON.stringify({ file_name: name, parent_type: parentType, parent_node: parentNode, size: buf.length }) }).then(r => r.json());
      if (pre.code !== 0) throw new Error(`上传素材失败（${pre.code}：${pre.msg}）`);
      const { upload_id, block_size, block_num } = pre.data;
      for (let i = 0; i < block_num; i++) { const part = buf.subarray(i * block_size, Math.min(buf.length, (i + 1) * block_size)); const fd = new FormData(); fd.append('upload_id', upload_id); fd.append('seq', String(i)); fd.append('size', String(part.length)); fd.append('file', new Blob([part]), name); const j = await fetch(`${API}/drive/v1/medias/upload_part`, { method: 'POST', headers: H, body: fd }).then(r => r.json()); if (j.code !== 0) throw new Error(`上传分片失败（${j.code}：${j.msg}）`); }
      const fin = await fetch(`${API}/drive/v1/medias/upload_finish`, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, H), body: JSON.stringify({ upload_id, block_num }) }).then(r => r.json());
      if (fin.code !== 0) throw new Error(`上传素材失败（${fin.code}：${fin.msg}）`); return fin.data.file_token;
    }
    const fd = new FormData(); fd.append('file_name', name); fd.append('parent_type', parentType); fd.append('parent_node', parentNode); fd.append('size', String(buf.length)); fd.append('file', new Blob([buf]), name);
    const j = await fetch(`${API}/drive/v1/medias/upload_all`, { method: 'POST', headers: { authorization: 'Bearer ' + await token() }, body: fd }).then(r => r.json());
    if (j.code !== 0) throw new Error(`上传素材失败（${j.code}：${j.msg}）`); return j.data.file_token;
  }
  async function dl(url) { const r = await fetch(url, { headers: { authorization: 'Bearer ' + await token() } }); if (!r.ok) throw new Error('下载失败 HTTP ' + r.status); return Buffer.from(await r.arrayBuffer()); }
  async function imKey(buf) { const fd = new FormData(); fd.append('image_type', 'message'); fd.append('image', new Blob([buf]), 'a.jpg'); const j = await fetch(`${API}/im/v1/images`, { method: 'POST', headers: { authorization: 'Bearer ' + await token() }, body: fd }).then(r => r.json()); if (j.code !== 0) throw new Error(`传图失败（${j.code}：${j.msg}）`); return j.data.image_key; }
  async function imFile(buf, name) { const fd = new FormData(); fd.append('file_type', 'stream'); fd.append('file_name', name); fd.append('file', new Blob([buf]), name); const j = await fetch(`${API}/im/v1/files`, { method: 'POST', headers: { authorization: 'Bearer ' + await token() }, body: fd }).then(r => r.json()); if (j.code !== 0) throw new Error(`传文件失败（${j.code}：${j.msg}）`); return j.data.file_key; }
  async function fetchXhs(url) { // 打开小红书短链，拿笔记 ID / 作者 / 发布时间
    try {
      const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' }, signal: AbortSignal.timeout(12000) });
      const id = (r.url.match(/(?:explore|discovery\/item|item)\/([0-9a-f]{24})/) || [])[1] || '';
      const html = await r.text(); const i = html.indexOf('noteDetailMap'); const seg = i >= 0 ? html.slice(i, i + 200000) : '';
      return { id, uid: (seg.match(/"userId":"([0-9a-f]{24})"/) || [])[1] || '', nick: (seg.match(/"nickname":"([^"]{1,40})"/) || [])[1] || '', time: +((seg.match(/"time":(1\d{12})/) || [])[1] || 0) || null };
    } catch (e) { return {}; }
  }
  const VL = ['qwen-vl-max', 'qwen3-vl-plus', 'qwen-vl-plus', 'qwen-vl-max-latest', 'qwen2.5-vl-72b-instruct'];
  let vlModel = cfg.qwenModel || 'qwen-vl-max';
  async function vision(prompt, dataUrl) {
    const tried = [];
    while (true) {
      const r = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.qwenKey },
        body: JSON.stringify({ model: vlModel, temperature: 0.1, max_tokens: 3000, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: dataUrl } }, { type: 'text', text: prompt }] }] }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return ((j.choices || [])[0] || {}).message.content || '';
      const msg = (j.error && (j.error.message || j.error.code)) || j.message || ('HTTP ' + r.status);
      if (/model/i.test(msg) && (r.status === 400 || r.status === 404)) { // 模型名这个账号用不了：换下一个
        tried.push(vlModel); const next = VL.find(m => !tried.includes(m));
        if (next) { log(`模型 ${vlModel} 用不了，改用 ${next}`); vlModel = next; continue; }
      }
      throw new Error('通义千问：' + msg);
    }
  }


  async function chat(prompt) { // 通义千问文字模型（写简报）
    const models = [cfg.briefModel || 'qwen-max', 'qwen-plus'];
    let last = '';
    for (const model of models) {
      const r = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.qwenKey }, body: JSON.stringify({ model, temperature: 0.3, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }), signal: AbortSignal.timeout(90000) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return ((j.choices || [])[0] || {}).message.content || '';
      last = (j.error && (j.error.message || j.error.code)) || ('HTTP ' + r.status); log(`[简报] 模型 ${model} 不可用：${last}`);
    }
    throw new Error(last);
  }
  const tgt = createTgt({ cfg, api: { call }, log });
  const core = createCore({ cfg, api: { call, fetchXhs, fetchDouyin, vision: cfg.qwenKey ? vision : null }, log });
  await core.load(true);
  const draft = createDraft({ api: { call }, core, upload, log }); const lastVideo = new Map(), lastInstr = new Map(), draftMsg = new Map();
  const rawIO = { download: dl, imKey, imFile }; const dispatch = createDispatch({ api: { call }, core, raw: rawIO, log });
  for (const n of (cfg.videoTables || ['最新-抖音矩阵号-数据', '抖音素人号-数据'])) { try { await core.loadT(n, true); } catch (e) { log('[表] 读不到 ' + n + '：', e.message); } }

  // 视频号历史数据一次性导入（做过就不再做；按链接去重）
  setTimeout(async () => { const f = path.join(DATA_DIR, 'sph-import.json'); if (fs.existsSync(f)) return; try { const r = await core.sphImport(); fs.writeFileSync(f, JSON.stringify(Object.assign({ at: Date.now() }, r))); log('[视频号导入] ' + JSON.stringify(r)); } catch (e) { log('[视频号导入] 出错 ' + e.message); } }, 20e3);
  setTimeout(async () => { const f = path.join(DATA_DIR, 'sph-format.json'); if (fs.existsSync(f)) return; try { const r = await core.sphFormat(); fs.writeFileSync(f, JSON.stringify(Object.assign({ at: Date.now() }, r))); log('[视频号整理] ' + JSON.stringify(r)); } catch (e) { log('[视频号整理] 出错 ' + e.message); } }, 40e3);
  setTimeout(async () => { const f = path.join(DATA_DIR, 'sph-titles.json'); if (fs.existsSync(f)) return; try { const r = await core.sphTitles(); fs.writeFileSync(f, JSON.stringify(Object.assign({ at: Date.now() }, r))); log('[视频号补标题] ' + JSON.stringify({ imported: r.imported, filled: r.filled, ambiguous: r.ambiguous.length, notFound: r.notFound.length })); } catch (e) { log('[视频号补标题] 出错 ' + e.message); } }, 60e3);
  { let ok = false; const tryPg = () => { if (ok) return; core.ensurePaigao().then(() => { ok = true; log('[派稿] 派稿记录表已就绪'); }).catch(e => log('[派稿] 暂时不能用（' + e.message.replace(/\/bitable\S*/g, '') + '），10 分钟后再试')); }; setTimeout(tryPg, 30e3); setInterval(tryPg, 10 * 60e3); }
  setTimeout(async () => { const f = path.join(DATA_DIR, 'sph-clean.json'); if (fs.existsSync(f)) return; try { const r = await core.sphCleanTitles(); fs.writeFileSync(f, JSON.stringify(r)); log('[视频号] 清掉占位标题 ' + r.length + ' 条：' + r.join('、')); } catch (e) { log('[视频号] 清标题出错 ' + e.message); } }, 50e3);
  // ---------- 收消息 ----------
  const seen = new Set(); let markDaily = null;
  function flatten(type, content) { // 文本 / 富文本 → 文字 + 图片
    let c = {}; try { c = JSON.parse(content || '{}'); } catch (e) { }
    if (type === 'text') return { text: c.text || '', images: [] };
    if (type === 'image') return { text: '', images: [c.image_key] };
    if (type === 'post') {
      const body = c.content ? c : (c.zh_cn || c.en_us || Object.values(c)[0] || {});
      const text = [body.title || '', ...(body.content || []).map(par => par.map(x => x.tag === 'a' ? `${x.text || ''} ${x.href || ''}` : x.tag === 'text' ? x.text : '').join(''))].join('\n');
      const flat = (body.content || []).flat();
      return { text, images: flat.filter(x => x.tag === 'img').map(x => x.image_key), media: flat.filter(x => x.tag === 'media' && x.file_key).map(x => ({ key: x.file_key, name: x.file_name || '' })) };
    }
    return { text: '', images: [] };
  }
  async function onMessage(data) {
    const m = data.message || {}; if (!m.message_id || seen.has(m.message_id)) return; seen.add(m.message_id); if (seen.size > 5000) seen.clear();
    if (m.chat_type !== 'group') return;
    if (cfg.chats && cfg.chats.length && !cfg.chats.includes(m.chat_id)) return;
    const { text, images, media } = flatten(m.message_type, m.content);
    const sid = ((data.sender || {}).sender_id || {}).open_id || '';
    if (m.message_type === 'media' || m.message_type === 'file') {
      let c = {}; try { c = JSON.parse(m.content || '{}'); } catch (e) { }
      if (draft.active(sid) && /\.(mp4|m4v|mov)$/i.test(c.file_name || '')) {
        try { const buf = await fileBuf(m.message_id, c.file_key); const p = await draft.addMedia(sid, [{ buf, name: c.file_name, video: true }]); if (p) await reply(m.message_id, `🎬 视频已归到「${p.code}」（素材共 ${p.n} 个）`); } catch (e) { log('[收稿] 视频处理失败：' + e.message); await reply(m.message_id, '⚠️ 视频没存进稿件库：' + e.message.slice(0, 60)); }
        return;
      }
      if (/\.(mp4|m4v|mov)$/i.test(c.file_name || '')) { lastVideo.set(sid, { mid: m.message_id, key: c.file_key, name: c.file_name, at: Date.now() }); return; }
      if (m.message_type === 'media') return;
      if (/\.xlsx$/i.test(c.file_name || '')) {
        try { const r = await tgt.ingest(await fileBuf(m.message_id, c.file_key)); if (r) { await reply(m.message_id, replyForTgt(r)); if (r.rows) brief.ads().catch(e => log('[投放分析] 出错 ' + e.message)); } } catch (e) { if (e.message === 'NO_PRIVATE_BASE') return; log('[推广通] 处理出错：', e.message); await reply(m.message_id, '⚠️ 推广通报表没处理成功：' + e.message.slice(0, 60)); }
      }
      return;
    }
    if ((data.sender || {}).sender_type === 'user' && m.chat_id === dailyChatNow()) rememberBoss(((data.sender || {}).sender_id || {}).open_id);
    if (text && /^\s*(简报|日报简报|今日简报)\s*$/.test(text) && m.chat_id === dailyChatNow()) { sendBrief({ replyTo: m.message_id, manual: true }); return; }
    // 在发布群里发「派稿」→ 今天待发布的稿件卡片发到这个群，并 @ 对应的人（只认老板发的命令）
    if (text && /^\s*(派稿|发稿|今日派稿)\s*$/.test(text) && m.chat_id !== dailyChatNow()) {
      if (boss && sid !== boss) return;
      try {
        const list = await dispatch.today(); if (!list.length) { await reply(m.message_id, '今天没有「派稿日期 = 今天、状态 = 待发布」的稿件'); return; }
        const members = {}; try { let pt = ''; do { const d = await call('GET', `/im/v1/chats/${m.chat_id}/members`, null, Object.assign({ member_id_type: 'open_id', page_size: 100 }, pt ? { page_token: pt } : {})); (d.items || []).forEach(x => { if (x.name) members[x.name.trim()] = x.member_id; }); pt = d.has_more ? d.page_token : ''; } while (pt); } catch (e) { log('[领稿] 读不到群成员（@ 不了人）：' + e.message); }
        const DF = path.join(DATA_DIR, 'dispatched.json'); let dsp = {}; try { dsp = JSON.parse(fs.readFileSync(DF, 'utf8')); } catch (e) { }
        let n = 0, noAt = []; for (const r of list) { dsp[r.id] = { chat: m.chat_id, day: Math.floor((Date.now() + 8 * 3600e3) / 864e5), at: r.at || '' }; const who = String((r.f['发布人员'] && (r.f['发布人员'].text || r.f['发布人员'])) || '').trim(); r.at = members[who] || ''; if (!r.at && who) noAt.push(who); await dispatch.send(r, { type: 'chat_id', id: m.chat_id }); n++; }
        try { fs.writeFileSync(path.join(DATA_DIR, 'publish-chat.txt'), m.chat_id); fs.writeFileSync(DF, JSON.stringify(dsp)); } catch (e) { }
        log(`[领稿] 派到群 ${n} 张`); if (noAt.length) await reply(m.message_id, `已派 ${n} 张。这些发布人员不在本群或名字对不上，没能 @ 到：${[...new Set(noAt)].join('、')}`);
      } catch (e) { log('[领稿] 派稿出错：' + e.message); await reply(m.message_id, '⚠️ 派稿没发出去：' + e.message.replace(/\/bitable\S*/g, '').slice(-120)); }
      return;
    }
    if (text && /^\s*(进度|派稿进度|发布进度)\s*$/.test(text)) { try { await reply(m.message_id, await progress(m.chat_id, false)); } catch (e) { log('[领稿] 进度出错：' + e.message); } return; }
    if (text && /^\s*(派稿预览|领稿预览)\s*$/.test(text) && m.chat_id === dailyChatNow()) {
      try { const list = await dispatch.today(); if (!list.length) { await reply(m.message_id, '今天没有「派稿日期 = 今天、状态 = 待发布」的稿件'); return; } if (!boss) { await reply(m.message_id, '还不知道你的飞书账号，先在这个群里随便说句话'); return; } for (const r of list) await dispatch.send(r, { type: 'open_id', id: boss }); await reply(m.message_id, `✅ ${list.length} 张领稿卡片已私聊发给你（样卡）`); } catch (e) { log('[领稿] 出错：' + e.message); await reply(m.message_id, '⚠️ 样卡没发出去：' + e.message.replace(/\/bitable\S*/g, '').slice(-120)); }
      return;
    }
    if (text && /^\s*(投放分析|推广通分析)\s*$/.test(text) && m.chat_id === dailyChatNow()) { sendAds({ replyTo: m.message_id }); return; }
    if (text && /^\s*(重新识别日报|重读日报)\s*$/.test(text) && m.chat_id === dailyChatNow()) { rereadDaily(m.message_id); return; }
    if (text && /^\s*驾驶舱\s*$/.test(text) && m.chat_id === dailyChatNow()) { const link = web.loginLink(); if (link && boss) { try { await call('POST', '/im/v1/messages', { receive_id: boss, msg_type: 'text', content: JSON.stringify({ text: `🖥 驾驶舱登录链接（7 天内有效，登录后 30 天免登录，别转发给别人）：\n${link}` }) }, { receive_id_type: 'open_id' }); await reply(m.message_id, '✅ 登录链接已私聊发给你'); } catch (e) { await reply(m.message_id, '⚠️ 私聊发送失败：' + e.message.slice(0, 60)); } } return; }
    // 门店营业日报（华付数科等机器人发的也收）
    if (text && /营业日概况|当天总营业额/.test(text)) {
      if (typeof markDaily === 'function') markDaily(m.message_id, m.chat_id);
      try { const r = await core.handleDaily(text, (data.sender || {}).sender_type === 'app' ? '日报机器人' : '群消息'); if (r && r.length) { log(`[日报] ${r.map(x => x.store + ' ' + x.date).join('、')}`); if (cfg.replyDaily !== false) await reply(m.message_id, replyForDaily(r)); } else { log('[日报] 有一条没读懂（日期或门店读不出）'); await reply(m.message_id, '⚠️ 这条日报没读懂：日期或门店没读出来。格式应为「日期：2026-11-02」「门店：xxx店」，已通知管理员'); } } catch (e) { if (e.message === 'NO_PRIVATE_BASE') { log('收到营业日报，但还没配置私密表格（config.json 的 dailyBaseUrl），没有记录'); await reply(m.message_id, '⚠️ 还没设置营业日报的私密表格，这条先不记录（不会写进营销部共享表）'); } else log('处理日报出错：', e.message); }
      return;
    }
    if ((data.sender || {}).sender_type === 'app') return;
    // 收稿：编号 + 标题 + 正文；之后 15 分钟内同一个人发的图片都算这篇的素材
    // PR 的派发说明（@人 + 平台 + 定位）：先记下，和前后 15 分钟内同一个人发的稿件合在一起
    const names = (m.mentions || []).map(x => String(x.name || '').trim()).filter(Boolean);
    const txt = text ? text.replace(/@_user_\d+/g, '').trim() : '';
    if (txt && isInstr(txt)) {
      const ins = parseInstr(txt, names); lastInstr.set(sid, { ins, at: Date.now() });
      try { const p = await draft.applyInstr(sid, ins); if (p) { await reply(m.message_id, `📌 已把「${p.code}」派给 ${ins.people.join('、') || '?'}（今天）· ${ins.platforms.join(' + ')}${ins.dp ? ' · 点评定位 ' + ins.dp : ''}`); lastInstr.delete(sid); } } catch (e) { log('[收稿] 派发说明出错：' + e.message); }
      return;
    }
    const li = lastInstr.get(sid); const instr = li && Date.now() - li.at < 15 * 60e3 ? li.ins : null;
    const lv = lastVideo.get(sid); let vid = lv && Date.now() - lv.at < 15 * 60e3 ? lv : null;
    if (media && media.length) vid = { mid: m.message_id, key: media[0].key, name: media[0].name, at: Date.now(), inline: true }; // 视频和文字在同一条消息里
    if (text && draft.isDraft(text, vid)) {
      const ph = draft.begin(sid);
      try { const who = await senderName(sid); let video = null; if (vid && !/(^|\n)\s*标题\s*[:：]/.test(text)) { if (!vid.inline) lastVideo.delete(sid); try { video = { buf: await fileBuf(vid.mid, vid.key), name: vid.name || '视频.mp4', named: !!vid.name }; } catch (e) { log('[收稿] 视频下载失败：' + e.message); } } const imgs = []; for (const k of images) { try { imgs.push({ buf: await imgBuf(m.message_id, k), name: k + '.jpg' }); } catch (e) { } } const d = await draft.save(text, who, sid, imgs, video, instr); if (instr) lastInstr.delete(sid); draftMsg.set(m.message_id, { id: d.id, code: d.code, type: d.type, kind: d.kind }); await reply(m.message_id, replyForDraft(d) + (imgs.length ? `\n已存 ${imgs.length} 张图` : '') + (video ? `\n已存视频 ${video.name}` : '')); } catch (e) { if (!ph.id) ph.ok(); log('[收稿] 出错：' + e.message); await reply(m.message_id, '⚠️ 稿件没存进去：' + e.message.replace(/\/bitable\S*/g, '').slice(-100)); }
      return;
    }
    const blank = !text || !text.trim();
    const parentDraft = draftMsg.get(m.parent_id) || draftMsg.get(m.root_id);
    if (blank && images.length && parentDraft) { // 回复在稿件下面发的图 → 归到那篇
      try { const imgs = []; for (const k of images) imgs.push({ buf: await imgBuf(m.message_id, k), name: k + '.jpg' }); const p = await draft.attachTo(parentDraft, imgs); if (p) await reply(m.message_id, `🖼 图片已归到「${p.code}」（素材共 ${p.n} 个）`); } catch (e) { log('[收稿] 图片处理失败：' + e.message); }
      return;
    }
    if (text && /^\s*补图\s*$/.test(text)) { await fixImages(m.chat_id, m.message_id); return; }
    if (blank && images.length && draft.active(sid)) {
      try { const imgs = (async () => { const a = []; for (const k of images) a.push({ buf: await imgBuf(m.message_id, k), name: k + '.jpg' }); return a; })(); const p = await draft.addMedia(sid, imgs); if (p && p.id) { clearTimeout(p.tm); p.tm = setTimeout(() => reply(m.message_id, `🖼 图片已归到「${p.code}」（素材共 ${p.n} 个）`), 4000); } } catch (e) { log('[收稿] 图片处理失败：' + e.message); }
      return;
    }
    try {
      if (text && /xhslink|dpurl|ctrip\.com|xiaohongshu\.com/.test(text)) {
        const who = await senderName(((data.sender || {}).sender_id || {}).open_id);
        const r = await core.handleText(text, who);
        if (r) { log(`[登记] ${who} 新增 ${r.created.length}，重复 ${r.dups.length}`); await reply(m.message_id, replyForText(r)); }
      }
      if (text && /weixin\.qq\.com\/sph\/|channels\.weixin\.qq\.com\//.test(text) && !/xhslink|xiaohongshu\.com|dpurl|v\.douyin\.com/.test(text)) {
        const who = await senderName(((data.sender || {}).sender_id || {}).open_id);
        try { const r = await core.handleChannelsLink(text, who); if (r) { log(`[登记] 视频号 ${who} 新增 ${r.created.length}，重复 ${r.dups.length}`); await reply(m.message_id, replyForChannels(r)); } } catch (e) { if (e.message === 'NO_SPH_TABLE') await reply(m.message_id, '⚠️ 营销部多维表格里还没有「视频号-数据」这张表，请先建一张空表（名字一字不差），机器人会自动补齐列'); else { log('视频号登记出错：', e.message); await reply(m.message_id, '⚠️ 视频号链接没登记成功：' + e.message.replace(/\/bitable\S*/g, '').slice(-120)); } }
      }
      if (text && /v\.douyin\.com|iesdouyin\.com|douyin\.com\/(video|note)/.test(text)) {
        const who = await senderName(((data.sender || {}).sender_id || {}).open_id);
        try { const r = await core.handleDouyin(text, who); if (r) { log(`[抖音登记] ${who} 新增 ${r.created.length}，重复 ${r.dups.length}，没找到账号 ${r.noAcct.length}`); await reply(m.message_id, replyForDouyin(r)); } } catch (e) { log('抖音登记出错：', e.message); await reply(m.message_id, '⚠️ 抖音链接没登记成功：' + e.message.slice(0, 60)); }
      }
      if (images.length) {
        if (!cfg.qwenKey) log('收到截图，但 config.json 没填通义千问 Key，跳过');
        else {
          const lines = [];
          for (const key of images) {
            try {
              const r = await core.handleImage(await image(m.message_id, key), '', await senderName(((data.sender || {}).sender_id || {}).open_id));
              if (r) { log(`[截图] ${r.acc || ''} 更新 ${r.updated ? r.updated.length : 0}`); lines.push(replyForImage(r)); }
              else log('[截图] 不是数据中心截图，没处理');
            } catch (e) { log('处理截图出错：', e.message); lines.push('⚠️ 有一张截图没处理成功：' + e.message.slice(0, 60)); }
          }
          if (lines.length) await reply(m.message_id, (images.length > 1 ? `共 ${images.length} 张截图\n` : '') + lines.join('\n'));
        }
      }
    } catch (e) { log('处理消息出错：', e.message); }
  }

  // ---------- 日报群定时补收 ----------
  // 飞书不会把「自定义机器人」（华付数科）发的消息推给我们，所以每 10 分钟翻一次日报群的聊天记录
  const SEEN_FILE = path.join(DATA_DIR, 'daily-seen.json');
  let dailySeen = {}; try { dailySeen = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')); } catch (e) { }
  const saveSeen = () => { const ks = Object.keys(dailySeen); if (ks.length > 3000) ks.slice(0, ks.length - 2000).forEach(k => delete dailySeen[k]); try { fs.writeFileSync(SEEN_FILE, JSON.stringify(dailySeen)); } catch (e) { log('daily-seen 保存失败', e.message); } };
  const firstRun = !fs.existsSync(SEEN_FILE); // 第一次：群里已有的旧消息只记下、不重复处理
  const CHAT_FILE = path.join(DATA_DIR, 'daily-chat.txt');
  let dailyChat = cfg.dailyChatId || (() => { try { return fs.readFileSync(CHAT_FILE, 'utf8').trim() || null; } catch (e) { return null; } })();
  markDaily = (id, chatId) => { dailySeen[id] = 1; saveSeen(); if (chatId && chatId !== dailyChat) { dailyChat = chatId; try { fs.writeFileSync(CHAT_FILE, chatId); } catch (e) { } log('[日报] 记住日报群，之后定时补收'); } };
  function dailyChatNow() { return dailyChat; }
  async function findDailyChat() {
    if (dailyChat) return dailyChat;
    const name = cfg.dailyChatName || '经营日报'; let pt = '';
    try { do { const d = await call('GET', '/im/v1/chats', null, Object.assign({ page_size: 100 }, pt ? { page_token: pt } : {})); const c = (d.items || []).find(x => x.name === name); if (c) { dailyChat = c.chat_id; log(`[日报] 补收群：${name}`); return dailyChat; } pt = d.has_more ? d.page_token : ''; } while (pt); } catch (e) { if (!findDailyChat.warned) { findDailyChat.warned = 1; log('读不到群列表（等日报群里来一条日报后自动记住）：', e.message); } }
    return null;
  }
  async function pollDaily() {
    activity(); ACT.patrols++;
    try {
      if (!cfg.dailyBaseUrl) return;
      const chat = await findDailyChat(); if (!chat) return;
      const start = Math.floor(Date.now() / 1000) - 2 * 86400; let pt = ''; const found = [];
      do {
        const d = await call('GET', '/im/v1/messages', null, Object.assign({ container_id_type: 'chat', container_id: chat, start_time: String(start), sort_type: 'ByCreateTimeAsc', page_size: 50 }, pt ? { page_token: pt } : {}));
        (d.items || []).forEach(m => { if (!dailySeen[m.message_id] && !seen.has(m.message_id)) found.push(m); });
        pt = d.has_more ? d.page_token : '';
      } while (pt);
      if (firstRun && !pollDaily.done) { found.forEach(m => { dailySeen[m.message_id] = 1; }); pollDaily.done = true; saveSeen(); log(`[日报] 补收已就绪（群里原有 ${found.length} 条消息不重复处理）`); return; }
      pollDaily.done = true;
      for (const m of found) {
        dailySeen[m.message_id] = 1; seen.add(m.message_id);
        const { text } = flatten(m.msg_type, (m.body || {}).content);
        if (!text || !/营业日概况|当天总营业额/.test(text)) continue;
        try { const r = await core.handleDaily(text, (m.sender || {}).sender_type === 'app' ? '日报机器人' : '群消息'); if (r && r.length) { log(`[日报·补收] ${r.map(x => x.store + ' ' + x.date).join('、')}`); if (cfg.replyDaily !== false) await reply(m.message_id, replyForDaily(r)); } } catch (e) { log('补收日报出错：', e.message); }
      }
      if (found.length) saveSeen();
    } catch (e) { log('补收日报失败：', e.message); }
  }
  // 用最新的识别规则，把日报群最近 7 天的日报全部重读一遍（只更新数字，不重复回复）
  async function rereadDaily(replyTo) {
    try {
      const chat = await findDailyChat(); if (!chat) return;
      const start = Math.floor(Date.now() / 1000) - 7 * 86400; let pt = ''; const msgs = [];
      do { const d = await call('GET', '/im/v1/messages', null, Object.assign({ container_id_type: 'chat', container_id: chat, start_time: String(start), sort_type: 'ByCreateTimeAsc', page_size: 50 }, pt ? { page_token: pt } : {})); msgs.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
      const done = [], bad = [];
      for (const x of msgs) {
        const { text } = flatten(x.msg_type, (x.body || {}).content);
        if (!text || !/营业日概况|当天(?:总)?营业额/.test(text)) continue;
        try { const r = await core.handleDaily(text, (x.sender || {}).sender_type === 'app' ? '日报机器人' : '群消息'); (r || []).forEach(y => (y.total == null ? bad : done).push(`${y.store.replace(/^(深圳|广州|佛山|珠海|东莞|惠州)/, '')} ${y.date.slice(5)}`)); } catch (e) { log('重读日报出错：', e.message); }
      }
      log(`[日报] 重读完成：${done.length} 份，营业额仍读不出 ${bad.length} 份`);
      await reply(replyTo, `🔄 已用最新规则重读最近 7 天的日报：${done.length} 份已更新${bad.length ? `\n⚠️ 营业额还是读不出：${[...new Set(bad)].join('、')}（请把原文发给管理员）` : ''}`);
    } catch (e) { log('重读日报失败：', e.message); await reply(replyTo, '⚠️ 重读失败：' + e.message.slice(0, 60)); }
  }
  setTimeout(pollDaily, 15e3); setInterval(pollDaily, 10 * 60e3);

  // ---------- 每日 CEO 简报 ----------
  const BOSS_FILE = path.join(DATA_DIR, 'boss.txt'), BRIEF_FILE = path.join(DATA_DIR, 'brief-state.json');
  let boss = cfg.bossOpenId || (() => { try { return fs.readFileSync(BOSS_FILE, 'utf8').trim(); } catch (e) { return ''; } })();
  function rememberBoss(id) { if (!id || id === boss) return; boss = id; try { fs.writeFileSync(BOSS_FILE, id); } catch (e) { } log('[简报] 记住了老板的飞书账号，以后简报私聊发送'); }
  const brief = createBrief({ cfg, api: { call }, log, llm: cfg.qwenKey ? chat : null });
  async function registerLinks(text, who) { // 领稿页提交的链接 → 和群里贴链接一样登记进数据表
    const out = [];
    if (/xhslink|dpurl|ctrip\.com|xiaohongshu\.com/.test(text)) { const r = await core.handleText(text, who); if (r) out.push(replyForText(r)); }
    if (/v\.douyin\.com|iesdouyin\.com|douyin\.com\/(video|note)/.test(text)) { try { const r = await core.handleDouyin(text, who); if (r) out.push(replyForDouyin(r)); } catch (e) { out.push('⚠️ 抖音没登记上：' + e.message.slice(0, 60)); } }
    if (/weixin\.qq\.com\/sph\/|channels\.weixin\.qq\.com\//.test(text)) { try { const r = await core.handleChannelsLink(text, who); if (r) out.push(replyForChannels(r)); } catch (e) { out.push('⚠️ 视频号没登记上：' + e.message.slice(0, 60)); } }
    return out.filter(Boolean).join('\n');
  }
  const web = createWeb({ cfg, brief, log, activity, bossId: () => boss, dispatch, download: dl, registerLinks });
  rawIO.taskLink = id => web.taskLink(id);
  let briefState = {}; try { briefState = JSON.parse(fs.readFileSync(BRIEF_FILE, 'utf8')); } catch (e) { }
  let briefing = false;
  async function sendBrief(o) {
    o = o || {}; if (briefing) return; briefing = true;
    try {
      const r = await brief.make();
      const link = web.loginLink();
      const content = JSON.stringify({ text: r.text + (link ? `\n\n🖥 打开驾驶舱：${link}` : '') });
      let sent = false;
      if (boss) { try { await call('POST', '/im/v1/messages', { receive_id: boss, msg_type: 'text', content }, { receive_id_type: 'open_id' }); sent = true; } catch (e) { log('[简报] 私聊发送失败，改发日报群：', e.message); } }
      if (!sent && o.replyTo) { await reply(o.replyTo, r.text); sent = true; }
      else if (!sent && dailyChatNow()) { await call('POST', '/im/v1/messages', { receive_id: dailyChatNow(), msg_type: 'text', content }, { receive_id_type: 'chat_id' }); sent = true; }
      if (sent && o.replyTo && boss) await reply(o.replyTo, '✅ 简报已私聊发给你');
      log(`[简报] ${o.manual ? '手动' : '定时'}发送${sent ? '成功' : '失败（没有收件人）'}（${r.by}）`);
      if (!o.manual && sent) { briefState.last = bjDay(Date.now()); try { fs.writeFileSync(BRIEF_FILE, JSON.stringify(briefState)); } catch (e) { } }
    } catch (e) { log('[简报] 生成失败：', e.message); if (o.replyTo) await reply(o.replyTo, '⚠️ 简报生成失败：' + e.message.slice(0, 80)); }
    finally { briefing = false; }
  }
  // 「补图」：翻本群最近 2 小时的聊天记录，把最后一篇稿件后面、同一个人发的图片补进稿件库
  async function fixImages(chat, replyTo) {
    try {
      const start = Math.floor(Date.now() / 1000) - 7200; const msgs = []; let pt = '';
      do { const d = await call('GET', '/im/v1/messages', null, Object.assign({ container_id_type: 'chat', container_id: chat, start_time: String(start), sort_type: 'ByCreateTimeAsc', page_size: 50 }, pt ? { page_token: pt } : {})); msgs.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
      const fl = x => flatten(x.msg_type, (x.body || {}).content);
      let di = -1; msgs.forEach((x, i) => { const f = fl(x); if (f.text && draft.isDraft(f.text)) di = i; });
      if (di < 0) { await reply(replyTo, '最近 2 小时没找到稿件'); return; }
      const dm = msgs[di], who = ((dm.sender || {}).id) || ''; const code = draft.parseDraft(fl(dm).text).code;
      const T = await draft.tbl(); const rs = await call('POST', `/bitable/v1/apps/${T.app}/tables/${T.tid}/records/search`, {}, { page_size: 200 });
      const rec = (rs.items || []).filter(r => String(((r.fields || {})['稿件编号'] || [{}])[0]?.text || (r.fields || {})['稿件编号'] || '') === code || JSON.stringify((r.fields || {})['稿件编号'] || '').includes(code.slice(0, 10))).pop();
      if (!rec) { await reply(replyTo, `稿件库里没找到「${code}」`); return; }
      const old = ((rec.fields || {})['素材'] || []).length; const imgs = [];
      for (const x of msgs.slice(di + 1)) { if (((x.sender || {}).id) !== who) continue; const f = fl(x); if (f.text && f.text.trim() && draft.isDraft(f.text)) break; for (const k of f.images) { try { imgs.push({ buf: await imgBuf(x.message_id, k), name: k + '.jpg' }); } catch (e) { } } }
      if (!imgs.length) { await reply(replyTo, `「${code}」后面没找到同一个人发的图片`); return; }
      if (old) { await reply(replyTo, `「${code}」已经有 ${old} 个素材了，没有重复补`); return; }
      const p = await draft.attachTo({ id: rec.record_id, code }, imgs); await reply(replyTo, `🖼 已给「${code}」补上 ${p ? p.n : imgs.length} 张图`);
    } catch (e) { log('[收稿] 补图出错：' + e.message); await reply(replyTo, '⚠️ 补图没成功：' + e.message.replace(/\/bitable\S*/g, '').slice(-100)); }
  }
  // 派稿进度：今天在这个群派出的稿件，哪些发了、哪些还没发
  async function progress(chatId, remind) {
    const DF = path.join(DATA_DIR, 'dispatched.json'); let dsp = {}; try { dsp = JSON.parse(fs.readFileSync(DF, 'utf8')); } catch (e) { }
    const today = Math.floor((Date.now() + 8 * 3600e3) / 864e5); const ids = Object.keys(dsp).filter(k => dsp[k].day === today && (!chatId || dsp[k].chat === chatId));
    if (!ids.length) return remind ? '' : '今天这个群还没有派过稿（在群里发「派稿」才会记录进度）';
    const rows = []; for (const id of ids) { try { const r = await dispatch.getRec(id); rows.push({ id, v: dispatch.view(r, ''), at: dsp[id].at }); } catch (e) { } }
    const done = rows.filter(x => x.v.status === '已发布'), todo = rows.filter(x => x.v.status !== '已发布');
    if (remind) return todo.length ? '⏰ 今天的稿件还没发的提醒一下，发完在领稿页贴链接就行：\n' + todo.map(x => (x.at ? `<at user_id="${x.at}"></at>` : '@' + (x.v.who || '?')) + ` ${x.v.code}`).join('\n') : '';
    return `📋 今日派稿进度：派出 ${rows.length} 条，已发布 ${done.length} 条，还没发 ${todo.length} 条` + (todo.length ? '\n\n还没发：\n' + todo.map(x => `· ${x.v.who || '?'} · ${x.v.code}`).join('\n') : '\n\n🎉 全部发完了') + (done.length ? '\n\n已发布：\n' + done.map(x => `· ${x.v.who || '?'} · ${x.v.code}`).join('\n') : '');
  }
  const PST = path.join(DATA_DIR, 'publish-state.json'); let pst = {}; try { pst = JSON.parse(fs.readFileSync(PST, 'utf8')); } catch (e) { }
  setInterval(async () => { // 20:00 群里 @ 还没发的人；21:30 群里发当天进度
    const bj = new Date(Date.now() + 8 * 3600e3), hh = bj.getUTCHours(), mm = bj.getUTCMinutes(), day = Math.floor((Date.now() + 8 * 3600e3) / 864e5);
    let chat = ''; try { chat = fs.readFileSync(path.join(DATA_DIR, 'publish-chat.txt'), 'utf8').trim(); } catch (e) { return; } if (!chat) return;
    try {
      if (hh === 20 && pst.remind !== day) { pst.remind = day; fs.writeFileSync(PST, JSON.stringify(pst)); const t = await progress(chat, true); if (t) await call('POST', '/im/v1/messages', { receive_id: chat, msg_type: 'text', content: JSON.stringify({ text: t }) }, { receive_id_type: 'chat_id' }); }
      if (hh === 21 && mm >= 30 && pst.sum !== day) { pst.sum = day; fs.writeFileSync(PST, JSON.stringify(pst)); const t = await progress(chat, false); if (!/还没有派过稿/.test(t)) await call('POST', '/im/v1/messages', { receive_id: chat, msg_type: 'text', content: JSON.stringify({ text: t }) }, { receive_id_type: 'chat_id' }); }
    } catch (e) { log('[领稿] 定时提醒出错：' + e.message); }
  }, 60e3);
  async function sendAds(o) {
    o = o || {};
    try {
      const r = await brief.ads(); if (!r) { if (o.replyTo) await reply(o.replyTo, '还没有推广通数据，先把报表发进来'); return; }
      const link = web.loginLink(); const content = JSON.stringify({ text: r.text + (link ? `\n\n🖥 驾驶舱看明细：${link}` : '') });
      if (boss) { await call('POST', '/im/v1/messages', { receive_id: boss, msg_type: 'text', content }, { receive_id_type: 'open_id' }); if (o.replyTo) await reply(o.replyTo, '✅ 投放分析已私聊发给你'); }
      else if (o.replyTo) await reply(o.replyTo, r.text);
      if (o.weekly) { briefState.ads = bjDay(Date.now()); try { fs.writeFileSync(BRIEF_FILE, JSON.stringify(briefState)); } catch (e) { } }
    } catch (e) { log('[投放分析] 发送失败：' + e.message); if (o.replyTo) await reply(o.replyTo, '⚠️ 投放分析没生成成功：' + e.message.slice(0, 80)); }
  }
  setInterval(() => { // 每周一 09:30 私聊一份投放周分析
    const bj = new Date(Date.now() + 8 * 3600e3); if (bj.getUTCDay() !== 1) return; const hh = bj.getUTCHours(), mm = bj.getUTCMinutes();
    if (((hh === 9 && mm >= 30) || hh === 10 || hh === 11) && briefState.ads !== bjDay(Date.now()) && briefState.last === bjDay(Date.now())) sendAds({ weekly: true });
  }, 60e3);
  setTimeout(async () => { try { if (!(await brief.latestAds())) await brief.ads(); } catch (e) { log('[投放分析] 首次生成出错 ' + e.message); } }, 70e3);
  setInterval(() => {
    if (cfg.briefAuto === false) return;
    const bj = new Date(Date.now() + 8 * 3600e3); const hh = bj.getUTCHours(), mm = bj.getUTCMinutes();
    const [H, M] = String(cfg.briefTime || '09:00').split(':').map(Number);
    if ((hh > H || (hh === H && mm >= M)) && hh < H + 3 && briefState.last !== bjDay(Date.now())) sendBrief({});
  }, 60e3);

  const lark = require('@larksuiteoapi/node-sdk');
  const ws = new lark.WSClient({ appId: cfg.appId, appSecret: cfg.appSecret, loggerLevel: lark.LoggerLevel.warn });
  ws.start({ eventDispatcher: new lark.EventDispatcher({}).register({ 'im.message.receive_v1': data => { onMessage(data); return {}; } }) });
  log('机器人已启动：在群里发分享或数据中心截图试试。这个窗口别关。');
})().catch(e => { log('启动失败：', e.message); process.exitCode = 1; });
