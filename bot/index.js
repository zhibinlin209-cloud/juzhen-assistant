/* 禧聚营销部 · 飞书群机器人
 * 同事在群里发「小红书/点评/携程/微信」分享 → 自动登记到多维表格「小红书矩阵号-数据」
 * 同事在群里发小红书「数据中心」截图 → 自动更新小眼睛/赞/评（写在「(自动)」列）
 * 用飞书「长连接」收消息：不需要公网服务器，电脑或云服务器开着这个程序就行
 */
'use strict';
// Node 22.5~22.12 的内置 SQLite 要加 --experimental-sqlite 才能用：先试一下，能用就带上开关重启自己（子进程），不能用就照常跑（只走飞书）
{ const [ma, mi] = process.versions.node.split('.').map(Number);
  if (ma === 22 && mi >= 5 && mi < 13 && !process.execArgv.includes('--experimental-sqlite') && !process.env.XJ_SQLITE_CHILD) {
    const cp = require('child_process'); let okFlag = false;
    try { okFlag = cp.spawnSync(process.execPath, ['--experimental-sqlite', '--no-warnings', '-e', 'require("node:sqlite")'], { timeout: 15000 }).status === 0; } catch (e) { }
    if (okFlag) {
      const child = cp.spawn(process.execPath, ['--experimental-sqlite', '--no-warnings', ...process.execArgv, ...process.argv.slice(1)], { stdio: 'inherit', env: Object.assign({}, process.env, { XJ_SQLITE_CHILD: '1' }) });
      ['SIGTERM', 'SIGINT', 'SIGHUP'].forEach(sg => process.on(sg, () => { try { child.kill(sg); } catch (e) { } }));
      child.on('exit', (code, sig) => process.exit(code === null ? 1 : code));
      return; // eslint-disable-line
    }
  } }
const fs = require('fs'); const path = require('path'); const readline = require('readline');
const { createCore, replyForText, replyForImage, replyForDaily, replyForDouyin, replyForChannels } = require('./lib/core');
const { fetchDouyin, isDouyinLink } = require('./lib/douyin');
const { createBrief, bjDay } = require('./lib/brief');
const { createWeb } = require('./lib/web');
const { createTgt, replyForTgt } = require('./lib/tgt');
const { createDraft, replyForDraft, createDispatch, isInstr, parseInstr, createAccounts } = require('./lib/draft');
const { createPeople } = require('./lib/people');
const { createSettle, replyForSettle } = require('./lib/settle');
const { createHits } = require('./lib/hits');
const { createOwnLib } = require('./lib/ownlib');
const { createOfficial } = require('./lib/official');
const HIST = require('./lib/dailyimport');
const { createAnnual } = require('./lib/annual');
const { createCampaign } = require('./lib/campaign');
const { createCreator } = require('./lib/creator');
const { createStudio } = require('./lib/aistudio');
const { readXlsx } = require('./lib/xlsx');
const { createDeep } = require('./lib/deep');
const { createStore, dbOn } = require('./lib/store');
const { createDbMigrate } = require('./lib/dbmigrate');
const { createDbBackup } = require('./lib/dbbackup');

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
  // 本地数据库：日报、推广通的主库（data/xiju.db）。打不开就自动退回只走飞书，机器人照样跑
  const store = createStore({ dataDir: DATA_DIR, log });
  if (!dbOn(cfg)) log('[数据库] cfg.useDb 关着，读写都走飞书表格');
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
  let lastUnknownXlsx = null;
  const chatNames = new Map(); async function chatName(id) { if (chatNames.has(id)) return chatNames.get(id); let n = ''; try { n = (await call('GET', `/im/v1/chats/${id}`, null, {})).name || ''; } catch (e) { } chatNames.set(id, n); setTimeout(() => chatNames.delete(id), 3600e3); return n; }
  // 发布群按群名分流：群名带「抖音」只派分发类别带「抖音」的稿；带「小红书」只派带「小红书」的；都不带 = 全部
  const groupFilter = name => { const k = r => String(val0(r.f['分发类别'])); const mx = /矩阵/.test(name), sr = /素人/.test(name);
    if (/抖音/.test(name) && !/小红书/.test(name)) return r => /抖音/.test(k(r)) && (mx ? /矩阵/.test(k(r)) : sr ? /素人/.test(k(r)) : true);
    if (/小红书/.test(name) && !/抖音/.test(name)) return r => /小红书/.test(k(r));
    if (sr) return r => /素人/.test(k(r));
    return () => true; };
  const val0 = x => Array.isArray(x) ? x.map(y => (y && y.text) || y).join('') : (x && x.text) || x || '';
  const PCHATS = () => { let a = []; try { a = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'publish-chats.json'), 'utf8')); } catch (e) { } try { const o = fs.readFileSync(path.join(DATA_DIR, 'publish-chat.txt'), 'utf8').trim(); if (o && !a.includes(o)) a.push(o); } catch (e) { } return a; };
  const addPChat = id => { const a = PCHATS(); if (!a.includes(id)) { a.push(id); try { fs.writeFileSync(path.join(DATA_DIR, 'publish-chats.json'), JSON.stringify(a)); } catch (e) { } } };
  async function findXlsx(re) { // 机器人所在群里最近一份 xlsx（可按文件名找；重启后也能找回）
    const chats = [tgtState && tgtState.chat, dailyChat].filter(Boolean); try { const d = await call('GET', '/im/v1/chats', null, { page_size: 100 }); (d.items || []).forEach(c => { if (!chats.includes(c.chat_id)) chats.push(c.chat_id); }); } catch (e) { }
    re = re || /\.xlsx$/i;
    for (const ch of chats) { try { const d = await call('GET', '/im/v1/messages', null, { container_id_type: 'chat', container_id: ch, sort_type: 'ByCreateTimeDesc', page_size: 30 }); for (const it of d.items || []) { if (it.msg_type !== 'file') continue; let c = {}; try { c = JSON.parse((it.body || {}).content || '{}'); } catch (e) { } if (/\.xlsx$/i.test(c.file_name || '') && re.test(c.file_name || '')) return { mid: it.message_id, key: c.file_key, name: c.file_name, chat: ch }; } } catch (e) { log('[表格文件] 翻群消息出错：' + e.message); } }
    return null;
  }
  async function fileBuf(messageId, key) {
    const r = await fetch(`${API}/im/v1/messages/${messageId}/resources/${key}?type=file`, { headers: { authorization: 'Bearer ' + await token() } });
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('下载文件失败 HTTP ' + r.status + ' ' + t.slice(0, 200)); }
    return Buffer.from(await r.arrayBuffer());
  }
  async function imgBuf(messageId, key) { const r = await fetch(`${API}/im/v1/messages/${messageId}/resources/${key}?type=image`, { headers: { authorization: 'Bearer ' + await token() } }); if (!r.ok) throw new Error('下载图片失败 HTTP ' + r.status); const b = Buffer.from(await r.arrayBuffer());
    // iPhone 的 Live 图 / 原图常是 HEIC：通义和小红书都不认，统一转成 JPG
    const brand = b.slice(4, 12).toString('latin1'); if (/^ftyp(heic|heix|hevc|mif1|msf1|heim|heis)/.test(brand)) { try { const conv = require('heic-convert'); const out = Buffer.from(await conv({ buffer: b, format: 'JPEG', quality: 0.9 })); log('[图片] HEIC 已转 JPG'); return out; } catch (e) { log('[图片] HEIC 转 JPG 失败：' + e.message); } }
    return b; }
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
      if (/model.*(not exist|not found|not support|access)|(not exist|not found|access denied).*model|InvalidModel|Model\.AccessDenied/i.test(msg) && !/image|图片|format/i.test(msg) && (r.status === 400 || r.status === 404 || r.status === 403)) { // 模型名这个账号用不了：换下一个
        tried.push(vlModel); const next = VL.find(m => !tried.includes(m));
        if (next) { log(`模型 ${vlModel} 用不了，改用 ${next}`); vlModel = next; continue; }
      }
      log('[看图] 通义报错：' + String(msg).slice(0, 160)); throw new Error('通义千问：' + msg);
    }
  }


  async function chat(prompt, maxTokens) { // 通义千问文字模型（写简报）
    const models = [cfg.briefModel || 'qwen-max', 'qwen-plus'];
    let last = '';
    for (const model of models) {
      const r = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.qwenKey }, body: JSON.stringify({ model, temperature: 0.3, max_tokens: maxTokens || 1500, messages: [{ role: 'user', content: prompt }] }), signal: AbortSignal.timeout(90000) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return ((j.choices || [])[0] || {}).message.content || '';
      last = (j.error && (j.error.message || j.error.code)) || ('HTTP ' + r.status); log(`[简报] 模型 ${model} 不可用：${last}`);
    }
    throw new Error(last);
  }
  const feat = require('./lib/features').createFeatures({ dataDir: DATA_DIR, log }); const on = k => feat.on(k);
  const feedback = require('./lib/feedback').createFeedback({ dataDir: DATA_DIR, chat, log, notify: async t => { if (!boss) throw new Error('还不知道老板是谁'); await call('POST', '/im/v1/messages', { receive_id: boss, msg_type: 'text', content: JSON.stringify({ text: t }) }, { receive_id_type: 'open_id' }); } });
  const tgt = createTgt({ cfg, api: { call }, log, store });
  const core = createCore({ cfg, api: { call, fetchXhs, fetchDouyin, vision: cfg.qwenKey ? vision : null }, log, store });
  await core.load(true);
  const people = createPeople({ cfg, api: { call }, log });
  const resolver = async (name, kind) => { const p = await people.resolve(name, kind).catch(() => null); if (!p) return null; return { who: p['真实姓名'], acc: /小红书/.test(kind) ? p['小红书账号'] : p['抖音账号'] }; };
  const draft = createDraft({ api: { call }, core, upload, log, resolver }); const lastVideo = new Map(), lastInstr = new Map(), draftMsg = new Map();
  const accounts = createAccounts({ api: { call }, core, log, people });
  const settle = createSettle({ cfg, api: { call }, core, people, log });
  const ownlib = createOwnLib({ cfg, api: { call }, core, upload, download: dl, log, dataDir: DATA_DIR });
  // 把私密表格里的「自家内容库」「同类爆款库」复制到营销部表格；复制完就把读写切过去，再补一遍复制期间新进的
  // 抖音开放平台（网站应用「禧聚内容数据助手」）：账号扫码授权 → 用授权码换令牌存起来；密钥由老板在经营日报群发「抖音密钥 xxx」自己录入
  const DYA_F = path.join(DATA_DIR, 'dy-app.json'), DYT_F = path.join(DATA_DIR, 'dy-tokens.json');
  const dyApp = () => { let a = {}; try { a = JSON.parse(fs.readFileSync(DYA_F, 'utf8')); } catch (e) { } return { key: cfg.dyClientKey || a.key || 'awx00tmy7fkxzil7', secret: cfg.dyClientSecret || a.secret || '' }; };
  const dyTok = () => { try { return JSON.parse(fs.readFileSync(DYT_F, 'utf8')); } catch (e) { return {}; } };
  async function onDyAuth({ code, scopes }) {
    const A = dyApp(); if (!A.secret) { log('[抖音授权] 收到授权码，但还没录入应用密钥'); if (boss) await call('POST', '/im/v1/messages', { receive_id: boss, msg_type: 'text', content: JSON.stringify({ text: '⚠️ 有抖音号扫码授权了，但机器人还没有「禧聚内容数据助手」的应用密钥，换不了令牌。请在抖音开放平台 → 该应用 → 设置 里复制 Client Secret，在「经营日报」群发：抖音密钥 你的密钥。录好后让对方再扫一次授权码。' }) }, { receive_id_type: 'open_id' }); return; }
    const r = await fetch('https://open.douyin.com/oauth/access_token/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_key: A.key, client_secret: A.secret, code, grant_type: 'authorization_code' }), signal: AbortSignal.timeout(20000) }).then(x => x.json());
    const d = r.data || {}; if (!d.access_token) throw new Error('换令牌失败：' + JSON.stringify(r).slice(0, 160));
    let nick = ''; try { const ui = await fetch('https://open.douyin.com/oauth/userinfo/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `access_token=${encodeURIComponent(d.access_token)}&open_id=${encodeURIComponent(d.open_id)}`, signal: AbortSignal.timeout(15000) }).then(x => x.json()); nick = (ui.data || {}).nickname || ''; } catch (e) { }
    const T = dyTok(); T[d.open_id] = { nick, open_id: d.open_id, access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + (d.expires_in || 0) * 1000, refresh_expires_at: Date.now() + (d.refresh_expires_in || 0) * 1000, scope: d.scope || scopes, at: Date.now() };
    fs.writeFileSync(DYT_F, JSON.stringify(T)); log(`[抖音授权] 「${nick || d.open_id}」授权成功，权限 ${d.scope || scopes}`);
    if (boss) await call('POST', '/im/v1/messages', { receive_id: boss, msg_type: 'text', content: JSON.stringify({ text: `✅ 抖音号「${nick || d.open_id.slice(0, 8)}」已授权给「禧聚内容数据助手」，机器人会开始用官方接口同步它的作品数据。` }) }, { receive_id_type: 'open_id' });
  }
  // 把营销部表格的一张表导成 Excel，私聊发给老板（附件列只写文件名，图片本身留在飞书里）
  // 每天 03:30 给小红书/抖音笔记存一次数据快照（近 120 天发布的），以后能按「发布第 N 天」比较；GET /lib/mkt/snap?date=YYYY-MM-DD
  const SNAP_DIR = path.join(DATA_DIR, 'snap'); try { fs.mkdirSync(SNAP_DIR, { recursive: true }); } catch (e) { }
  const nnum = v => { if (typeof v === 'number') return v; const m = String(v ?? '').replace(/,/g, '').match(/([\d.]+)\s*(万|w)?/i); return m ? parseFloat(m[1]) * (m[2] ? 1e4 : 1) : null; };
  const pick = (o, ks) => { for (const k of ks) { const v = nnum(o[k]); if (v !== null) return v; } return null; };
  async function takeSnap() {
    const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); const F = path.join(SNAP_DIR, day + '.json'); if (fs.existsSync(F)) return { ok: true, day, skipped: true };
    const out = { day, at: Date.now(), rows: [] };
    for (const [name, plat] of [['小红书矩阵号-数据', '小红书'], ['抖音-矩阵号-数据', '抖音'], ['抖音-素人号-数据', '抖音素人']]) {
      try { const r = await core.mktRows(name, 120); r.rows.forEach(o => out.rows.push({ t: name, p: plat, id: o._id, d: typeof o['发布日期'] === 'number' ? o['发布日期'] : null,
        exp: plat === '小红书' ? pick(o, ['小眼睛', '小眼睛(自动)']) : pick(o, ['播放(供AI读取)', '播放量', '播放数_数值']),
        like: pick(o, ['点赞数', '点赞(自动)', '点赞(供AI读取)', '点赞量']), col: pick(o, ['收藏数', '收藏(自动)', '收藏(供AI读取)', '收藏量']),
        cmt: pick(o, ['评论数', '评论(自动)', '评论(供AI读取)', '评论量']), sh: pick(o, ['分享数', '分享(自动)', '分享(供AI读取)', '转发量']) })); } catch (e) { log('[快照] ' + name + ' 出错：' + e.message); }
    }
    fs.writeFileSync(F, JSON.stringify(out)); log(`[快照] ${day} 存了 ${out.rows.length} 条`); return { ok: true, day, n: out.rows.length };
  }
  async function mktSnap(date) {
    if (!date) { let l = []; try { l = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json')).map(f => f.slice(0, 10)).sort(); } catch (e) { } return { ok: true, dates: l }; }
    if (date === 'now') return takeSnap();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式 YYYY-MM-DD'); return JSON.parse(fs.readFileSync(path.join(SNAP_DIR, date + '.json'), 'utf8'));
  }
  { let snapDay = ''; setInterval(() => { const bj = new Date(Date.now() + 8 * 3600e3); const d = bj.toISOString().slice(0, 10); if (on('snapshot') && bj.getUTCHours() === 3 && bj.getUTCMinutes() >= 30 && snapDay !== d) { snapDay = d; takeSnap().catch(e => log('[快照] 出错：' + e.message)); } }, 5 * 60e3); }
  async function exportTable(name) {
    const r = await core.mktRows(name, 0); const { writeXlsx } = require('./lib/xlsxwrite');
    const cols = r.fields.map(f => f.name); const dt = new Set(r.fields.filter(f => f.type === 5).map(f => f.name));
    const fmt = v => new Date(v + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
    const rows = [cols].concat(r.rows.map(o => cols.map(c => { const v = o[c]; if (v === undefined || v === null) return ''; if (dt.has(c) && typeof v === 'number') return fmt(v); return typeof v === 'number' ? v : String(v).slice(0, 32000); })));
    const buf = writeXlsx([{ name, rows }]); const fname = `${name}-${new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)}.xlsx`;
    const key = await imFile(buf, fname); if (!boss) throw new Error('还不知道老板是谁');
    await call('POST', '/im/v1/messages', { receive_id: boss, msg_type: 'file', content: JSON.stringify({ file_key: key }) }, { receive_id_type: 'open_id' });
    log(`[导出] ${name} ${r.n} 行 → 已私聊发给老板`); return { ok: true, rows: r.n, cols: cols.length, file: fname, bytes: buf.length };
  }
  const mover = require('./lib/movebase').createMover({ api: { call }, upload, dl, log, dataDir: DATA_DIR });
  async function moveLibs() {
    const m = String(cfg.dailyBaseUrl || '').match(/\/base\/([A-Za-z0-9]+)/); if (!m) throw new Error('NO_PRIVATE_BASE'); const from = m[1], to = await core.appToken();
    const LBF = path.join(DATA_DIR, 'libbase.json');
    const out = {};
    for (const name of ['同类爆款库', '自家内容库']) out[name] = mover.move(name, from, to, async () => {
      let lb = {}; try { lb = JSON.parse(fs.readFileSync(LBF, 'utf8')); } catch (e) { } if (!lb[name]) { lb[name] = Date.now(); fs.writeFileSync(LBF, JSON.stringify(lb)); ownlib.reset(); log(`[搬表] 「${name}」以后读写都在营销部表格`); }
      setTimeout(() => mover.move(name, from, to, null), 90e3); // 补搬切换前一刻新进的
    });
    return out;
  }
  setTimeout(() => ownlib.backfill().catch(() => { }), 90e3); setInterval(() => ownlib.backfill(200).catch(() => { }), 30 * 60e3);
  const official0 = createOfficial({ cfg, api: { call }, log });
  // 官方号每天自动同步（插件早上 8 点后来问）：按「平台|账号」记今天同步过没有；没登录时私聊提醒一次
  const OF_FILE = path.join(DATA_DIR, 'official-state.json'); let ofs = {}; try { ofs = JSON.parse(fs.readFileSync(OF_FILE, 'utf8')); } catch (e) { }
  const saveOF = () => { try { fs.writeFileSync(OF_FILE, JSON.stringify(ofs)); } catch (e) { } };
  const bjToday = () => Math.floor((Date.now() + 8 * 3600e3) / 864e5);
  const official = Object.assign({}, official0, {
    async sync(b) {
      const plat = b.platform === 'channels' ? '视频号' : '抖音';
      if (b.err) { log(`[官方号·插件] ${plat}没同步：${String(b.err).slice(0, 100)}`); const k = 'warn|' + plat;
        if (/登录/.test(b.err) && ofs[k] !== bjToday()) { ofs[k] = bjToday(); saveOF(); const site = plat === '抖音' ? 'creator.douyin.com（抖音创作者中心，扫码登录蓝 V）' : 'channels.weixin.qq.com（视频号助手，微信扫码）';
          try { if (boss) await call('POST', '/im/v1/messages', { receive_id: boss, msg_type: 'text', content: JSON.stringify({ text: `⚠️ 插件今天没法自动同步${plat}官方号数据：${plat === '抖音' ? '创作者中心' : '视频号助手'}掉线了。请在装了「餐饮矩阵助手」的 Chrome 打开 ${site}，登录后插件会自己补上。` }) }, { receive_id_type: 'open_id' }); } catch (e) { } }
        return { ok: false }; }
      const r = await official0.sync(b); if (r && r.ok) { ofs[plat + '|' + String(b.account || '').trim()] = bjToday(); saveOF(); } return r;
    },
    need(plat, acc) { const p = plat === 'channels' ? '视频号' : '抖音'; const bj = new Date(Date.now() + 8 * 3600e3);
      return { ok: true, need: on('officialAuto') && bj.getUTCHours() >= 8 && (!acc || ofs[p + '|' + acc] !== bjToday()) }; }
  });
  const histImport = HIST.createDailyImport({ cfg, api: { call }, core, log, store });
  const dbMigrate = createDbMigrate({ cfg, api: { call }, core, store, log });
  const campaign = createCampaign({ cfg, api: { call }, upload, log });
  { const CF = path.join(DATA_DIR, 'campaigns.json'); let C = []; try { C = JSON.parse(fs.readFileSync(CF, 'utf8')); } catch (e) { }
    campaign.names = () => C.slice();
    const HF = path.join(DATA_DIR, 'campaign-homes.json'); let H0 = {}; try { H0 = JSON.parse(fs.readFileSync(HF, 'utf8')); } catch (e) { }
    campaign.setHomes(H0, h => { try { fs.writeFileSync(HF, JSON.stringify(h)); } catch (e) { } });
    campaign.moveToMarketing = async n => campaign.move(n, await core.appToken(), dl);
    campaign.remember = n => { if (!C.includes(n)) { C.push(n); fs.writeFileSync(CF, JSON.stringify(C)); } };
    // 每天 11 点把登记过的链接追踪表重读一遍，更新赞藏评
    let lastDay = -1; setInterval(async () => { const b = new Date(Date.now() + 8 * 3600e3); const d = Math.floor((Date.now() + 8 * 3600e3) / 864e5); if (!on('campaign') || b.getUTCHours() !== 11 || lastDay === d) return; lastDay = d; for (const n of C) { try { await campaign.crawl(n); } catch (e) { log('[链接追踪] 每日重读失败：' + e.message); } } }, 10 * 60e3); }
  const studio = createStudio({ cfg, api: { call }, core, upload, download: dl, log, dataDir: DATA_DIR, bossId: () => boss });
  setInterval(() => on('studio') && studio.pushApproved().catch(() => { }), 5 * 60e3);
  setInterval(() => on('studio') && studio.importLib(400).catch(e => log('[AI工作台] 素材导入出错：' + e.message)), 10 * 60e3); setTimeout(() => studio.importLib(200).catch(() => { }), 120e3); setInterval(() => studio.tagLib(300).catch(e => log('[AI工作台] 打标出错：' + e.message)), 10 * 60e3);
  const creator = createCreator({ cfg, api: { call }, core, deep: () => deep, brief: () => brief, studio: () => studio, log, dataDir: DATA_DIR }); // 后面才定义的模块用函数取，避免启动时还没初始化
  async function sendCreate(o, replyTo) {
    const r = await creator.run(o || {}); const text = `✍️ 创作 Agent 写了 ${r.list.length} 篇小红书稿（${r.model}），已放进「禧聚 AI 内容工作台」的「AI稿件」，状态「AI待审」：\n` + r.list.map(x => `· ${x.code} ${x.store}《${x.title}》`).join('\n') + `\n\nPR 审改、配真实照片后，把状态改成「通过」，机器人会自动推到营销部「派稿记录」（待发布），再按原流程派稿。` + (studio.info().url ? `\n工作台：${studio.info().url}` : '') + ``;
    if (boss) await call('POST', '/im/v1/messages', { receive_id: boss, msg_type: 'text', content: JSON.stringify({ text }) }, { receive_id_type: 'open_id' });
    if (replyTo) await reply(replyTo, boss ? '✅ 已写好，详情私聊你了' : text); return r;
  }
  // 每天 8:20 自动写一批（门店按素材图库里干净照片多少排），9 点前私聊老板；全在服务器跑，用 DeepSeek/通义
  { const CF3 = path.join(DATA_DIR, 'daily-create.json'); let ds = {}; try { ds = JSON.parse(fs.readFileSync(CF3, 'utf8')); } catch (e) { }
    setInterval(async () => { if (cfg.dailyDrafts === 0 || !on('drafts')) return; const b = new Date(Date.now() + 8 * 3600e3); const d = Math.floor((Date.now() + 8 * 3600e3) / 864e5); if (b.getUTCHours() !== 8 || b.getUTCMinutes() < 20 || ds.day === d) return; ds.day = d; try { fs.writeFileSync(CF3, JSON.stringify(ds)); } catch (e) { }
      try { let stores = ''; try { const st = await studio.libStats(); stores = Object.entries(st.by || {}).filter(([k]) => k !== '未标').sort((a, b) => (b[1]['可用'] || 0) - (a[1]['可用'] || 0)).slice(0, cfg.dailyDrafts || 5).map(x => x[0]).join(','); } catch (e) { }
        await sendCreate({ n: cfg.dailyDrafts || 5, store: stores }); } catch (e) { log('[创作] 每日写稿失败：' + e.message); } }, 3 * 60e3);
    // 11/4 晚上补一批（重启打断了），只跑一次
    setTimeout(async () => { const b = new Date(Date.now() + 8 * 3600e3); if (b.toISOString().slice(0, 10) !== '2026-11-04' || b.getUTCHours() >= 23 || ds.eve) return; ds.eve = 1; try { fs.writeFileSync(CF3, JSON.stringify(ds)); } catch (e) { } try { await sendCreate({ n: 5, store: '江南西,玖洲道,千灯湖,前海,白石洲' }); } catch (e) { log('[创作] 晚间写稿失败：' + e.message); } }, 90e3); }
  // 每周一 10:40（内容分析 10:00 之后）自动写一批
  { const CF2 = path.join(DATA_DIR, 'create-state.json'); let cs = {}; try { cs = JSON.parse(fs.readFileSync(CF2, 'utf8')); } catch (e) { }
    setInterval(async () => { const b = new Date(Date.now() + 8 * 3600e3); const d = Math.floor((Date.now() + 8 * 3600e3) / 864e5); if (!on('creatorWeekly') || b.getUTCDay() !== 1 || b.getUTCHours() !== 10 || b.getUTCMinutes() < 40 || cs.week === d) return; cs.week = d; try { fs.writeFileSync(CF2, JSON.stringify(cs)); } catch (e) { } try { await sendCreate({ n: cfg.weeklyDrafts || 8 }); } catch (e) { log('[创作] 每周写稿失败：' + e.message); } }, 5 * 60e3); }
  const annual = createAnnual({ cfg, api: { call }, core, llm: cfg.qwenKey ? (p => chat(p, 3500)) : null, log, store });
  async function sendAnnual(replyTo) {
    const r = await annual.report(); await brief.saveKind('经营复盘', { text: r.text, by: r.by }, r.F); log('[经营复盘] 已生成（' + r.by + '）');
    const text = `📊 经营复盘（数据截至 ${r.F.截至}）\n\n` + r.text.replace(/^📊[^\n]*\n+/, '');
    if (boss) { await call('POST', '/im/v1/messages', { receive_id: boss, msg_type: 'text', content: JSON.stringify({ text }) }, { receive_id_type: 'open_id' }); if (replyTo) await reply(replyTo, '✅ 经营复盘已私聊发给你'); } else if (replyTo) await reply(replyTo, text);
  }
  const hits = createHits({ api: { call }, core, llm: cfg.qwenKey ? chat : null, log });
  const DAY0 = 864e5;
  const deep = createDeep({ cfg, api: { call }, core, llm: cfg.qwenKey ? (p => chat(p, 3000)) : null, log, dataDir: DATA_DIR });
  async function sendDeep(replyTo) {
    const r = await deep.report(); try { fs.writeFileSync(path.join(DATA_DIR, 'deep-latest.json'), JSON.stringify({ at: Date.now(), text: r.text, by: r.by, F: r.F })); } catch (e) { }
    log('[深度分析] 已生成（' + r.by + '）\n' + deep.plain(r.F || {}));
    await brief.saveKind('内容分析', { text: r.text, by: r.by }, r.F);
    const text = `🔬 爆款公式 · 内容分析（${new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 10).replace('-', '/')} · 小红书内容库 + 抖音蓝V/视频号）\n\n` + r.text;
    if (boss) { await call('POST', '/im/v1/messages', { receive_id: boss, msg_type: 'text', content: JSON.stringify({ text }) }, { receive_id_type: 'open_id' }); if (replyTo) await reply(replyTo, '✅ 爆款公式 2.0 已私聊发给你'); } else if (replyTo) await reply(replyTo, text);
  }
  // 爆款公式（内容分析）：通义千问每周一 10:00 自动写一份，存档 + 私聊 + 驾驶舱；内容库第一次读完时也出一次
  const DEEP_F = path.join(DATA_DIR, 'deep-state.json'); let deepState = {}; try { deepState = JSON.parse(fs.readFileSync(DEEP_F, 'utf8')); } catch (e) { }
  setInterval(async () => {
    try {
      const b = new Date(Date.now() + 8 * 3600e3); const day = Math.floor((Date.now() + 8 * 3600e3) / DAY0);
      let why = '';
      if (b.getUTCDay() === 1 && b.getUTCHours() >= 10 && b.getUTCHours() < 12 && deepState.week !== day) why = 'week';
      else if (!deepState.first) { const t = await ownlib.todo(1); if (t.total && t.left <= 5 && t.done >= 300) { if (!deepState.ownDone) { deepState.ownDone = Date.now(); fs.writeFileSync(DEEP_F, JSON.stringify(deepState)); } let mk = 0; try { mk = fs.readdirSync(path.join(DATA_DIR, 'market')).length; } catch (e) { } if (mk >= 80 || Date.now() - deepState.ownDone > 4 * 3600e3) why = 'first'; } } // 等同类爆款调研也跑完（或自家读完 4 小时后）再出第一份
      if (!why || !on('deep')) return;
      if (why === 'week') deepState.week = day; else deepState.first = Date.now();
      fs.writeFileSync(DEEP_F, JSON.stringify(deepState)); await sendDeep();
    } catch (e) { log('[深度分析] 自动出报告失败：' + e.message); }
  }, 10 * 60e3);
  async function sendHits(replyTo) {
    const r = await hits.report(); try { fs.writeFileSync(path.join(DATA_DIR, 'hits-latest.json'), JSON.stringify({ at: Date.now(), text: r.text, by: r.by })); } catch (e) { }
    log('[爆款公式] 已生成（' + r.by + '）\n' + hits.plain(r.F || { 平台: {} }));
    const text = `🔥 自家爆款公式（${new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 10).replace('-', '/')} · 近 180 天已发布内容）\n\n` + r.text;
    if (boss) { await call('POST', '/im/v1/messages', { receive_id: boss, msg_type: 'text', content: JSON.stringify({ text }) }, { receive_id_type: 'open_id' }); if (replyTo) await reply(replyTo, '✅ 爆款公式已私聊发给你'); } else if (replyTo) await reply(replyTo, text);
  }
  async function runSettle(month) { const res = await settle.compute(month); const w = await settle.save(res); log('[结算明细] ' + JSON.stringify(res.rows.filter(r => r.合计条数).map(r => [r.真实姓名, r.抖音账号, r.小红书账号, r.抖音, r.视频号, r.小红书, r.大众点评, r.携程, r.微信贴图, r.合计条数]))); if (res.orphan.length) log('[结算] 对照表里没有的账号：' + res.orphan.join('、')); return replyForSettle(res, w); }
  const lastMonth = () => { const d = new Date(Date.now() + 8 * 3600e3); const y = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear(), m = d.getUTCMonth() === 0 ? 12 : d.getUTCMonth(); return `${y}-${String(m).padStart(2, '0')}`; };
  async function fillAccounts() { // 派稿记录里有发布人员、没账号名称的 → 按分发类别补上账号
    const T = await draft.tbl(); const rows = []; let pt = '';
    do { const d = await call('POST', `/bitable/v1/apps/${T.app}/tables/${T.tid}/records/search`, {}, Object.assign({ page_size: 200 }, pt ? { page_token: pt } : {})); rows.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    const v = x => Array.isArray(x) ? x.map(y => y.text || y).join('') : (x && x.text) || x || '';
    const upd = []; for (const r of rows) { const f = r.fields || {}; const who = String(v(f['发布人员'])).trim(); if (!who || String(v(f['账号名称'])).trim()) continue; const p = await accounts.pick(who, String(v(f['分发类别']))); if (p.acc) upd.push({ record_id: r.record_id, fields: { 账号名称: p.acc } }); }
    if (upd.length) { await call('POST', `/bitable/v1/apps/${T.app}/tables/${T.tid}/records/batch_update`, { records: upd }); log(`[账号] 派稿记录补上账号名称 ${upd.length} 条`); }
    return upd.length;
  }
  setTimeout(async () => { try { const m = await accounts.map(true); const out = {}; Object.entries(m).forEach(([w, o]) => { out[w] = {}; ['xhs', 'dy', 'sr'].forEach(k => { const b = accounts.best(o[k]); if (b.length) out[w][k] = b.slice(0, 3).map(x => x[0] + '×' + x[1]).join(' / '); }); }); log('[账号对照] ' + JSON.stringify(out)); await fillAccounts(); } catch (e) { log('[账号] 出错 ' + e.message); } }, 45e3);
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
  // Live 图拆成：静态图（转成 jpg）+ 动态短视频（mov）
  async function toJpg(buf, name) { if (!/\.(heic|heif)$/i.test(name)) return { buf, name }; try { const conv = require('heic-convert'); const out = await conv({ buffer: buf, format: 'JPEG', quality: 0.9 }); return { buf: Buffer.from(out), name: name.replace(/\.(heic|heif)$/i, '.jpg') }; } catch (e) { log('[收稿] HEIC 转 JPG 失败（' + e.message + '），按原图存'); return { buf, name }; } }
  async function liveFiles(buf, name, isMedia) {
    if (/\.livp$/i.test(name)) { const { unzip } = require('./lib/xlsx'); const z = unzip(buf); const out = [];
      for (const [n, get] of Object.entries(z)) { if (/\.(heic|heif|jpe?g|png)$/i.test(n)) { const j = await toJpg(get(), n.split('/').pop()); out.push(j); } else if (/\.mov$/i.test(n)) out.push({ buf: get(), name: n.split('/').pop(), video: true, live: true }); }
      return out.sort((a, b) => (a.video ? 1 : 0) - (b.video ? 1 : 0)); }
    if (isMedia || /\.mov$/i.test(name)) return [{ buf, name: /\.\w+$/.test(name) ? name : name + '.mov', video: true, live: true }];
    return [await toJpg(buf, name)];
  }
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
    if (cfg.chats && cfg.chats.length && !cfg.chats.includes(m.chat_id) && !/发布群|派稿|存放群|稿件|回收/.test(await chatName(m.chat_id))) return;
    let { text, images, media } = flatten(m.message_type, m.content);
    const sid = ((data.sender || {}).sender_id || {}).open_id || '';
    if (m.message_type === 'media' || m.message_type === 'file') {
      let c = {}; try { c = JSON.parse(m.content || '{}'); } catch (e) { }
      log(`[消息] ${m.message_type} ${c.file_name || '(无文件名)'}${c.duration ? ' 时长' + c.duration + 'ms' : ''}${draft.active(sid) ? ' · 收稿中' : ''}`);
      // 实况照片（Live 图）：iPhone 会发成 .livp 压缩包、.heic 图，或 3 秒左右的 .mov；都当图文素材收，不把稿子改成视频
      const live = /\.(livp|heic|heif)$/i.test(c.file_name || '') || (m.message_type === 'media' && +c.duration > 0 && +c.duration <= 3600);
      const isImgFile = /\.(jpe?g|png|webp|heic|heif|livp)$/i.test(c.file_name || '');
      if (draft.active(sid) && (live || isImgFile)) {
        try {
          const buf = await fileBuf(m.message_id, c.file_key); const files = await liveFiles(buf, c.file_name || 'live.mov', m.message_type === 'media');
          const p = await draft.addMedia(sid, files); if (p) await reply(m.message_id, `🖼 ${live ? '实况照片（Live 图）' : '图片'}已归到「${p.code}」（素材共 ${p.n} 个）` + (files.some(f => f.live) ? '，动态部分存成了短视频，发布时可选「实况」' : ''));
        } catch (e) { log('[收稿] Live 图处理出错：' + e.message); await reply(m.message_id, '⚠️ 这张 Live 图没存进去：' + e.message.slice(0, 80)); }
        return;
      }
      if (draft.active(sid) && /\.(mp4|m4v|mov)$/i.test(c.file_name || '')) {
        try { const buf = await fileBuf(m.message_id, c.file_key); const p = await draft.addMedia(sid, [{ buf, name: c.file_name, video: true }]); if (p) await reply(m.message_id, `🎬 视频已归到「${p.code}」（素材共 ${p.n} 个）`); } catch (e) { log('[收稿] 视频处理失败：' + e.message); await reply(m.message_id, '⚠️ 视频没存进稿件库：' + e.message.slice(0, 60)); }
        return;
      }
      if (/\.(mp4|m4v|mov)$/i.test(c.file_name || '')) { lastVideo.set(sid, { mid: m.message_id, key: c.file_key, name: c.file_name, at: Date.now() }); return; }
      if (m.message_type === 'media') return;
      if (/\.xlsx$/i.test(c.file_name || '')) {
        try { const buf = await fileBuf(m.message_id, c.file_key);
          let rows0 = null; try { rows0 = readXlsx(buf); } catch (e) { }
          if (rows0 && HIST.isHistory(rows0)) { // 华付导出的历史营业日报：只认经营日报群（营业数据是私密的）
            if (m.chat_id !== dailyChatNow()) { await reply(m.message_id, '⚠️ 营业日报属于私密数据，请发到「经营日报」群'); return; }
            const p = HIST.parse(rows0); const w = await histImport.run(p.good); const st = (p.good[0] || {}).store || c.file_name;
            const ds = p.good.map(x => x.ts).sort((a, b) => a - b); const fmtD = t => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
            const span = ds.length ? Math.round((ds[ds.length - 1] - ds[0]) / 864e5) + 1 : 0;
            await reply(m.message_id, `📒 ${st} 历史日报：${ds.length ? fmtD(ds[0]) + ' ~ ' + fmtD(ds[ds.length - 1]) : ''}，可用 ${p.good.length} 天（期间缺 ${span - p.good.length} 天）\n新增 ${w.added} 条，表里已有 ${w.existed} 条（不覆盖）\n去掉重复/补录 ${p.dups} 条（同一天保留最后录入的），按「数据关联」纠正日期 ${p.fixed} 条${p.skipped ? `，营业额为空跳过 ${p.skipped} 条` : ''}` +
              (p.outliers.length ? `\n⚠️ 疑似录错没导入：${p.outliers.map(x => fmtD(x.ts) + ' 营业额 ' + x.f.总营业额).join('；')}` : '') + (p.badDate.length ? `\n⚠️ 日期认不出：${p.badDate.slice(0, 5).join('；')}` : '') + (w.diff.length ? `\n⚠️ 和表里已有数字不一致：${w.diff.slice(0, 5).join('；')}` : ''));
            return;
          }
          const r = on('tgtFile') ? await tgt.ingest(buf) : null; if (r) { await reply(m.message_id, replyForTgt(r));
            if (r.rows) { tgtState.chat = m.chat_id; await afterTgt(r, t => reply(m.message_id, t)); } }
          else { const pr = await people.importSettle(buf); if (pr) { let n = 0; try { n = await people.linkAliases(await accounts.map(true)); } catch (e) { log('[人员] 补叫法出错 ' + e.message); } const ps = await people.list(true); await reply(m.message_id, `👥 人员账号对照已更新：${pr.rows} 人（新增 ${pr.added}、更新 ${pr.updated}），自动认出数据表里的叫法 ${n} 人\n` + ps.slice(0, 60).map(p => `· ${p['真实姓名']}（微信 ${p['微信名'] || '—'}）抖音 ${p['抖音账号'] || '—'} · 小红书 ${p['小红书账号'] || '—'}${p['数据表叫法'] ? ' · 表里叫 ' + p['数据表叫法'] : ''}`).join('\n') + '\n存在你的私密表格「人员账号对照」，可以直接改。'); try { await fillAccounts(); } catch (e) { } }
            else { // 没认出的表格：记下表头，回复一句，方便补规则
              let hd = ''; try { const rr = readXlsx(buf); const hi = rr.findIndex(r => r.filter(x => String(x || '').trim()).length >= 4); hd = (rr[hi] || []).filter(Boolean).slice(0, 30).join('|'); } catch (e) { }
              log(`[表格文件] 没认出格式：${c.file_name} 表头 ${hd.slice(0, 600)}`); lastUnknownXlsx = { mid: m.message_id, key: c.file_key, name: c.file_name, chat: m.chat_id, at: Date.now() };
              await reply(m.message_id, `⚠️ 这份表格（${c.file_name}）机器人还不认识格式，没入库。已记下表头，会尽快补上。`); } } } catch (e) { if (e.message === 'NO_PRIVATE_BASE') return; log('[表格文件] 处理出错：', e.message); await reply(m.message_id, '⚠️ 这个表格没处理成功：' + e.message.replace(/\/bitable\S*/g, '').slice(-100)); }
      }
      return;
    }
    if ((data.sender || {}).sender_type === 'user' && m.chat_id === dailyChatNow()) rememberBoss(((data.sender || {}).sender_id || {}).open_id);
    if (text && /^\s*(简报|日报简报|今日简报)\s*$/.test(text) && m.chat_id === dailyChatNow()) { sendBrief({ replyTo: m.message_id, manual: true }); return; }
    // 在发布群里发「派稿」→ 今天待发布的稿件卡片发到这个群，并 @ 对应的人（群里谁发都行；同一天已经派过的不重复派）
    if (text && on('paigao') && /^\s*(派稿|发稿|今日派稿)\s*$/.test(text) && m.chat_id !== dailyChatNow()) {
      if ((data.sender || {}).sender_type !== 'user') return;
      try {
        try { await fillAccounts(); } catch (e) { log('[账号] 补账号出错 ' + e.message); }
        const gname = await chatName(m.chat_id); const gf = groupFilter(gname); const scope = /抖音/.test(gname) && !/小红书/.test(gname) ? (/矩阵/.test(gname) ? '抖音矩阵号' : '抖音类') : /小红书/.test(gname) && !/抖音/.test(gname) ? '小红书类' : /素人/.test(gname) ? '素人号' : '';
        const dsp1 = (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'dispatched.json'), 'utf8')); } catch (e) { return {}; } })(); const td1 = Math.floor((Date.now() + 8 * 3600e3) / 864e5);
        const all0 = (await dispatch.today()).filter(gf).filter(r => !(dsp1[r.id] && dsp1[r.id].day === td1 && dsp1[r.id].chat !== m.chat_id)); // 别的群派过的不再派
        if (!all0.length) { await reply(m.message_id, `今天没有「派稿日期 = 今天、状态 = 待发布」的${scope ? scope : ''}稿件` + (scope ? `（本群只派分发类别带「${scope.replace('类', '')}」的稿）` : '')); return; }
        const today0 = Math.floor((Date.now() + 8 * 3600e3) / 864e5); let dsp0 = {}; try { dsp0 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'dispatched.json'), 'utf8')); } catch (e) { }
        const list = all0.filter(r => !(dsp0[r.id] && dsp0[r.id].day === today0 && dsp0[r.id].chat === m.chat_id));
        if (!list.length) { await reply(m.message_id, `今天的 ${all0.length} 张稿件已经派过了，没有新的待发布稿件。发「进度」看谁还没发。`); return; }
        log(`[领稿] ${sid === boss ? '老板' : '群成员'}发起派稿：新 ${list.length} 张（今天共 ${all0.length} 张）`);
        const members = {}; try { let pt = ''; do { const d = await call('GET', `/im/v1/chats/${m.chat_id}/members`, null, Object.assign({ member_id_type: 'open_id', page_size: 100 }, pt ? { page_token: pt } : {})); (d.items || []).forEach(x => { if (x.name) members[x.name.trim()] = x.member_id; }); pt = d.has_more ? d.page_token : ''; } while (pt); } catch (e) { log('[领稿] 读不到群成员（@ 不了人）：' + e.message); }
        const DF = path.join(DATA_DIR, 'dispatched.json'); let dsp = {}; try { dsp = JSON.parse(fs.readFileSync(DF, 'utf8')); } catch (e) { }
        let n = 0, noAt = []; for (const r of list) { dsp[r.id] = { chat: m.chat_id, day: Math.floor((Date.now() + 8 * 3600e3) / 864e5), at: r.at || '' }; const vv = x => Array.isArray(x) ? x.map(y => y.text || y).join('') : (x && x.text) || x || ''; const who = String(vv(r.f['发布人员'])).trim(), acc = String(vv(r.f['账号名称'])).trim(); r.at = members[acc] || members[who] || ''; if (!r.at && who) noAt.push(who); await dispatch.send(r, { type: 'chat_id', id: m.chat_id }); n++; }
        try { addPChat(m.chat_id); fs.writeFileSync(DF, JSON.stringify(dsp)); } catch (e) { }
        log(`[领稿] 派到群 ${n} 张`); if (noAt.length) await reply(m.message_id, `已派 ${n} 张。这些发布人员不在本群或名字对不上，没能 @ 到：${[...new Set(noAt)].join('、')}`);
      } catch (e) { log('[领稿] 派稿出错：' + e.message); await reply(m.message_id, '⚠️ 派稿没发出去：' + e.message.replace(/\/bitable\S*/g, '').slice(-120)); }
      return;
    }
    if (text && /^\s*(进度|派稿进度|发布进度)\s*$/.test(text)) { try { await reply(m.message_id, await progress(m.chat_id, false)); } catch (e) { log('[领稿] 进度出错：' + e.message); } return; }
    if (text && /^\s*(派稿预览|领稿预览)\s*$/.test(text) && m.chat_id === dailyChatNow()) {
      try { try { await fillAccounts(); } catch (e) { } const list = await dispatch.today(); if (!list.length) { await reply(m.message_id, '今天没有「派稿日期 = 今天、状态 = 待发布」的稿件'); return; } if (!boss) { await reply(m.message_id, '还不知道你的飞书账号，先在这个群里随便说句话'); return; } for (const r of list) await dispatch.send(r, { type: 'open_id', id: boss }); await reply(m.message_id, `✅ ${list.length} 张领稿卡片已私聊发给你（样卡）`); } catch (e) { log('[领稿] 出错：' + e.message); await reply(m.message_id, '⚠️ 样卡没发出去：' + e.message.replace(/\/bitable\S*/g, '').slice(-120)); }
      return;
    }
    { const sm = text && text.trim().match(/^结算(?:\s*(\d{4})?[-年./]?\s*(\d{1,2})\s*月?)?$/); if (sm && m.chat_id === dailyChatNow()) { const y = sm[1] || String(new Date(Date.now() + 8 * 3600e3).getUTCFullYear()); const mon = sm[2] ? `${y}-${String(sm[2]).padStart(2, '0')}` : lastMonth(); try { await reply(m.message_id, '⏳ 正在算 ' + mon + ' 的结算…'); await reply(m.message_id, await runSettle(mon)); } catch (e) { log('[结算] 出错：' + e.message); await reply(m.message_id, '⚠️ 结算没算出来：' + e.message.replace(/\/bitable\S*/g, '').slice(-100)); } return; } }
    { const mm = text && text.match(/^\s*(?:AI写稿|AI 写稿|写稿)\s*(\d+)?\s*(\S+)?\s*$/i); if (mm && m.chat_id === dailyChatNow()) { try { await reply(m.message_id, `⏳ 创作 Agent 正在写 ${mm[1] || 6} 篇${mm[2] ? '（' + mm[2] + '）' : ''}，大概 1–3 分钟…`); await sendCreate({ n: +mm[1] || 6, store: mm[2] || '' }, m.message_id); } catch (e) { log('[创作] 出错：' + e.message); await reply(m.message_id, '⚠️ 写稿没成功：' + e.message.slice(0, 80)); } return; } }
    if (text && /^\s*(经营复盘|全年复盘|同比分析)\s*$/.test(text) && m.chat_id === dailyChatNow()) { try { await reply(m.message_id, '⏳ 正在做经营复盘（全部历史日报），大概 1–2 分钟…'); await sendAnnual(m.message_id); } catch (e) { log('[经营复盘] 出错：' + e.message); await reply(m.message_id, '⚠️ 经营复盘没跑出来：' + e.message.slice(0, 80)); } return; }
    if (text && /^\s*(深度分析|爆款公式\s*2(\.0)?|内容库分析)\s*$/.test(text) && m.chat_id === dailyChatNow()) { try { await reply(m.message_id, '⏳ 正在做深度分析（小红书内容库 + 官方号），大概 1–2 分钟…'); await sendDeep(m.message_id); } catch (e) { log('[深度分析] 出错：' + e.message); await reply(m.message_id, '⚠️ 深度分析没跑出来：' + e.message.slice(0, 80)); } return; }
    if (text && /^\s*(爆款分析|爆款公式)\s*$/.test(text) && m.chat_id === dailyChatNow()) { try { await reply(m.message_id, '⏳ 正在分析自家内容，大概 1 分钟…'); await sendHits(m.message_id); } catch (e) { log('[爆款公式] 出错：' + e.message); await reply(m.message_id, '⚠️ 爆款分析没跑出来：' + e.message.slice(0, 80)); } return; }
    if (text && /^\s*(投放分析|推广通分析)\s*$/.test(text) && m.chat_id === dailyChatNow()) { sendAds({ replyTo: m.message_id }); return; }
    if (text && /^\s*(投放周报|推广通周报)\s*$/.test(text) && (m.chat_id === dailyChatNow() || m.chat_id === tgtState.chat)) { await reply(m.message_id, '⏳ 正在做投放周报（和之前所有周对比 + 三套方案），大概 2–4 分钟…'); sendAdsWeekly({ replyTo: m.message_id }); return; }
    if (text && /^\s*抖音密钥\s+\S{16,}\s*$/.test(text) && m.chat_id === dailyChatNow()) { // 老板自己录入抖音开放平台应用密钥（只存在服务器）
      const sec = text.trim().split(/\s+/)[1]; let a0 = {}; try { a0 = JSON.parse(fs.readFileSync(DYA_F, 'utf8')); } catch (e) { } a0.secret = sec; fs.writeFileSync(DYA_F, JSON.stringify(a0)); try { fs.chmodSync(DYA_F, 0o600); } catch (e) { }
      log('[抖音授权] 应用密钥已录入'); await reply(m.message_id, '✅ 抖音应用密钥已存好（只存在服务器上）。建议把这条消息撤回。'); return; }
    if (text && /^\s*(功能开关|功能列表|机器人功能)\s*$/.test(text) && m.chat_id === dailyChatNow()) { await reply(m.message_id, feat.text()); return; }
    if (text && /^\s*(关闭|开启|打开)\s*\S+/.test(text) && m.chat_id === dailyChatNow()) { const mm2 = text.trim().match(/^(关闭|开启|打开)\s*(.+)$/); const it = feat.set(mm2[2], mm2[1] !== '关闭'); await reply(m.message_id, it ? `${mm2[1] === '关闭' ? '⚪️ 已关闭' : '🟢 已开启'}：${it[1]}` : '没找到这个功能，发「功能开关」看编号'); return; }
    if (text && /^\s*(需求汇总|需求清单|反馈汇总)\s*$/.test(text) && m.chat_id === dailyChatNow()) { try { await reply(m.message_id, (await feedback.summary({ all: true, days: 7 })) || '最近 7 天群里没有人 @机器人 提需求。'); } catch (e) { await reply(m.message_id, '⚠️ 汇总出错：' + e.message.slice(0, 60)); } return; }
    if (text && /^\s*(重新识别日报|重读日报)\s*$/.test(text) && m.chat_id === dailyChatNow()) { rereadDaily(m.message_id); return; }
    if (text && /^\s*驾驶舱\s*$/.test(text) && m.chat_id === dailyChatNow()) { const link = web.loginLink(); if (link && boss) { try { await call('POST', '/im/v1/messages', { receive_id: boss, msg_type: 'text', content: JSON.stringify({ text: `🖥 驾驶舱登录链接（7 天内有效，登录后 30 天免登录，别转发给别人）：\n${link}` }) }, { receive_id_type: 'open_id' }); await reply(m.message_id, '✅ 登录链接已私聊发给你'); } catch (e) { await reply(m.message_id, '⚠️ 私聊发送失败：' + e.message.slice(0, 60)); } } return; }
    // 门店营业日报（华付数科等机器人发的也收）
    if (text && on('daily') && /营业日概况|当天总营业额/.test(text)) {
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
    if (text && on('draft') && draft.isDraft(text, vid)) {
      const ph = draft.begin(sid);
      try { const who = await senderName(sid); let video = null; if (vid && !/(^|\n)\s*标题\s*[:：]/.test(text)) { if (!vid.inline) lastVideo.delete(sid); try { video = { buf: await fileBuf(vid.mid, vid.key), name: vid.name || '视频.mp4', named: !!vid.name }; } catch (e) { log('[收稿] 视频下载失败：' + e.message); } } const imgs = []; for (const k of images) { try { imgs.push({ buf: await imgBuf(m.message_id, k), name: k + '.jpg' }); } catch (e) { } } const gn = await chatName(m.chat_id); const hint = /类别\s*[:：]/.test(text) ? '' : /素人/.test(gn) ? '抖音素人号' : /视频|抖音/.test(gn) ? '抖音矩阵号' : /攻略|小红书/.test(gn) ? '小红书矩阵号' : ''; const d = await draft.save(hint ? text + `\n类别：${hint}` : text, who, sid, imgs, video, instr); if (instr) lastInstr.delete(sid); draftMsg.set(m.message_id, { id: d.id, code: d.code, type: d.type, kind: d.kind }); await reply(m.message_id, replyForDraft(d) + (imgs.length ? `\n已存 ${imgs.length} 张图` : '') + (video ? `\n已存视频 ${video.name}` : '')); } catch (e) { if (!ph.id) ph.ok(); log('[收稿] 出错：' + e.message); await reply(m.message_id, '⚠️ 稿件没存进去：' + e.message.replace(/\/bitable\S*/g, '').slice(-100)); }
      return;
    }
    const blank = !text || !text.trim();
    const parentDraft = draftMsg.get(m.parent_id) || draftMsg.get(m.root_id);
    if (blank && images.length && parentDraft) { // 回复在稿件下面发的图 → 归到那篇
      try { const imgs = []; for (const k of images) imgs.push({ buf: await imgBuf(m.message_id, k), name: k + '.jpg' }); const p = await draft.attachTo(parentDraft, imgs); if (p) await reply(m.message_id, `🖼 图片已归到「${p.code}」（素材共 ${p.n} 个）`); } catch (e) { log('[收稿] 图片处理失败：' + e.message); }
      return;
    }
    if (text && /^\s*补图\s*$/.test(text)) { await fixImages(m.chat_id, m.message_id); return; }
    if (images.length) log(`[消息] 图片 ${images.length} 张（${m.message_type}${blank ? '' : '，带文字'}）发送人 ${(await senderName(sid).catch(() => '')) || sid.slice(-6)}${draft.active(sid) ? ' · 收稿中' : ' · 不在收稿中'}`);
    if (blank && images.length && draft.active(sid)) {
      try { const imgs = (async () => { const a = []; for (const k of images) a.push({ buf: await imgBuf(m.message_id, k), name: k + '.jpg' }); return a; })(); const p = await draft.addMedia(sid, imgs); if (p && p.id) { clearTimeout(p.tm); p.tm = setTimeout(() => reply(m.message_id, `🖼 图片已归到「${p.code}」（素材共 ${p.n} 个）`), 4000); } } catch (e) { log('[收稿] 图片处理失败：' + e.message); }
      return;
    }
    // @机器人 + 「重写」：用这条（或被回复的那条）消息里的链接，覆盖表里已有的那一行，不判重复
    const rewrite = !!(text && on('rewrite') && /重写|重新登记|覆盖/.test(text) && (m.mentions || []).some(x => /禧聚|助手|机器人|AI/i.test(String(x.name || ''))));
    let ltext = text;
    if (rewrite && m.parent_id) { try { const pm = await call('GET', `/im/v1/messages/${m.parent_id}`); const it = (pm.items || [])[0]; if (it) { const f2 = flatten(it.msg_type, (it.body || {}).content); ltext = (f2.text || '') + '\n' + (text || ''); } } catch (e) { log('[重写] 读被回复的消息出错：' + e.message); } }
    if (rewrite && !/xhslink|dpurl|ctrip\.com|xiaohongshu\.com/.test(ltext || '') && !isDouyinLink(ltext)) { await reply(m.message_id, '要重写哪条？请「回复」那条链接消息，再 @我 说「重写」；或者把链接和「@我 重写」发在同一条消息里。'); return; }
    if (rewrite) text = ltext;
    // @机器人 说需求 / 问题 / 疑问（不带链接）→ 记下来，马上私聊转给老板
    { const atBot = (m.mentions || []).some(x => /禧聚|助手|机器人|AI/i.test(String(x.name || ''))); const fb = text ? text.replace(/@_user_\d+/g, '').trim() : '';
      if (atBot && on('feedback') && !rewrite && fb.length >= 2 && !/https?:\/\//.test(text)) {
        try { let parent = ''; if (m.parent_id) { try { const pm = await call('GET', `/im/v1/messages/${m.parent_id}`); const it = (pm.items || [])[0]; if (it) parent = flatten(it.msg_type, (it.body || {}).content).text || ''; } catch (e) { } }
          const r = await feedback.add({ text: fb, who: await senderName(sid).catch(() => ''), group: await chatName(m.chat_id), parent }); if (r) await reply(m.message_id, r);
        } catch (e) { log('[需求] 记录出错：' + e.message); }
        return; } }
    try {
      if (text && on('regXhs') && /xhslink|dpurl|ctrip\.com|xiaohongshu\.com/.test(text)) {
        const who = await senderName(((data.sender || {}).sender_id || {}).open_id);
        const r = await core.handleText(text, who, { rewrite });
        if (r) { log(`[登记] ${who} 新增 ${r.created.length}，重复 ${r.dups.length}`); await reply(m.message_id, replyForText(r)); }
      }
      // 回复抖音链接的消息、只发视频号链接 → 补进那条抖音作品的同一行
      if (text && on('regSph') && /weixin\.qq\.com\/sph\/|channels\.weixin\.qq\.com\//.test(text) && !isDouyinLink(text) && m.parent_id) {
        try { const pm = await call('GET', `/im/v1/messages/${m.parent_id}`); const it = (pm.items || [])[0]; const pt = it ? (flatten(it.msg_type, (it.body || {}).content).text || '') : '';
          if (isDouyinLink(pt)) { const d = await core.attachSph(pt, text); if (d && d.length) { await reply(m.message_id, `✅ 视频号链接已补进「${d[0].table}」里那条抖音作品的同一行` + (d.length > 1 ? `（共 ${d.length} 条）` : '')); return; } }
        } catch (e) { log('[视频号] 补进抖音行出错：' + e.message); }
      }
      if (text && on('regSph') && /weixin\.qq\.com\/sph\/|channels\.weixin\.qq\.com\//.test(text) && !/xhslink|xiaohongshu\.com|dpurl/.test(text) && !isDouyinLink(text)) {
        const who = await senderName(((data.sender || {}).sender_id || {}).open_id);
        try { const r = await core.handleChannelsLink(text, who); if (r) { log(`[登记] 视频号 ${who} 新增 ${r.created.length}，重复 ${r.dups.length}`); await reply(m.message_id, replyForChannels(r)); } } catch (e) { if (e.message === 'NO_SPH_TABLE') await reply(m.message_id, '⚠️ 营销部多维表格里还没有「视频号-数据」这张表，请先建一张空表（名字一字不差），机器人会自动补齐列'); else { log('视频号登记出错：', e.message); await reply(m.message_id, '⚠️ 视频号链接没登记成功：' + e.message.replace(/\/bitable\S*/g, '').slice(-120)); } }
      }
      if (text && on('regDouyin') && isDouyinLink(text)) {
        const who = await senderName(((data.sender || {}).sender_id || {}).open_id);
        try { const gn2 = await chatName(m.chat_id); const r = await core.handleDouyin(text, who, /素人/.test(gn2) ? '素人' : /矩阵|视频稿件/.test(gn2) && /抖音|视频/.test(gn2) ? '矩阵' : '', { rewrite }); if (r) { log(`[抖音登记] ${who} 新增 ${r.created.length}，重复 ${r.dups.length}，没找到账号 ${r.noAcct.length}`); await reply(m.message_id, replyForDouyin(r)); } } catch (e) { log('抖音登记出错：', e.message); await reply(m.message_id, '⚠️ 抖音链接没登记成功：' + e.message.slice(0, 60)); }
      }
      if (images.length && on('screenshot')) {
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
      if (!replyTo) return { ok: true, done, bad }; await reply(replyTo, `🔄 已用最新规则重读最近 7 天的日报：${done.length} 份已更新${bad.length ? `\n⚠️ 营业额还是读不出：${[...new Set(bad)].join('、')}（请把原文发给管理员）` : ''}`);
    } catch (e) { log('重读日报失败：', e.message); await reply(replyTo, '⚠️ 重读失败：' + e.message.slice(0, 60)); }
  }
  setTimeout(pollDaily, 15e3); setInterval(pollDaily, 10 * 60e3);

  // ---------- 本地库：一次性迁移 + 每周备份 ----------
  // 迁移必须放在启动 90 秒后跑：云端更新脚本只等 25 秒，占着启动就会被判失败整版回滚
  if (store.ok) {
    setTimeout(() => {
      if (!dbOn(cfg)) return;
      dbMigrate.migrate().then(r => { if (r.skipped) log('[数据库] 迁移跳过：' + r.skipped); }).catch(e => log('[数据库] 迁移失败（下次启动再试）：' + e.message));
    }, 90e3);
    setInterval(() => dbBackup.tick(), 5 * 60e3);
    // 每天 04:10 把飞书两张表重新同步进库（有人在飞书里手动改过数字也能跟上；只更新不删除），同步完再核对一次
    let resyncDay = 0; setInterval(() => { const bj = new Date(Date.now() + 8 * 3600e3); const d = Math.floor((Date.now() + 8 * 3600e3) / 864e5); if (!dbOn(cfg) || bj.getUTCHours() !== 4 || bj.getUTCMinutes() < 10 || resyncDay === d) return; resyncDay = d; dbMigrate.migrate({ force: true }).catch(e => log('[数据库] 每日同步失败：' + e.message)); }, 5 * 60e3);
  }

  // ---------- 每日 CEO 简报 ----------
  const BOSS_FILE = path.join(DATA_DIR, 'boss.txt'), BRIEF_FILE = path.join(DATA_DIR, 'brief-state.json');
  let boss = cfg.bossOpenId || (() => { try { return fs.readFileSync(BOSS_FILE, 'utf8').trim(); } catch (e) { return ''; } })();
  function rememberBoss(id) { if (!id || id === boss) return; boss = id; try { fs.writeFileSync(BOSS_FILE, id); } catch (e) { } log('[简报] 记住了老板的飞书账号，以后简报私聊发送'); }
  const brief = createBrief({ cfg, api: { call }, log, llm: cfg.qwenKey ? chat : null, store });
  // 推广通投放周报（30 日归因 + 和之前所有周对比 + 三套方案，DeepSeek 写，存飞书云文档）
  const adsWeekly = require('./lib/adsweekly').createAdsWeekly({ cfg, api: { call }, core, log, canon: require('./lib/tgt').canon, bossId: () => boss, saveKind: (k, r, d) => brief.saveKind(k, r, d), store });
  const TS_FILE = path.join(DATA_DIR, 'tgt-state.json'); let tgtState = {}; try { tgtState = JSON.parse(fs.readFileSync(TS_FILE, 'utf8')); } catch (e) { }
  const saveTS = () => { try { fs.writeFileSync(TS_FILE, JSON.stringify(tgtState)); } catch (e) { } };
  // 推广通入库之后（群里的文件 / 插件自动拉的）：记最新日期；周一且是 30 天的报表 → 出周报，否则做日常投放分析
  async function afterTgt(r, say) {
    if (r.lastDay) tgtState.lastDay = Math.max(tgtState.lastDay || 0, r.lastDay); saveTS();
    const wk = on('adsWeekly') && new Date(Date.now() + 8 * 3600e3).getUTCDay() === 1 && (r.days || 0) >= 20 && tgtState.weekly !== bjDay(Date.now());
    if (wk) { if (say) await say('📅 收到近 30 天报表，正在出本周投放周报（按 30 日归因算每单成本），几分钟后私聊林总'); sendAdsWeekly({ weekly: true }); }
    else brief.ads().catch(e => log('[投放分析] 出错 ' + e.message));
  }
  // 插件自动拉推广通报表：每天 8 点后拉一次「近 30 天、按门店按日」（顺带更新 15/30 日归因）；昨天的还没进来就每小时再试
  const fmtYmd = t => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
  function tgtNeed() {
    const bj = new Date(Date.now() + 8 * 3600e3), today = bjDay(Date.now());
    const need = on('tgtAuto') && bj.getUTCHours() >= 8 && (tgtState.autoDay !== today || (tgtState.lastDay || 0) < today - 1) && Date.now() - (tgtState.autoTry || 0) > 55 * 60e3;
    return { ok: true, need, begin: fmtYmd(Date.now() - 30 * 864e5), end: fmtYmd(Date.now() - 864e5) };
  }
  async function tgtAuto(j) {
    tgtState.autoTry = Date.now(); saveTS();
    if (j.err) { log('[推广通·插件] 没拉到：' + String(j.err).slice(0, 120));
      if (/登录/.test(j.err) && boss && tgtState.loginWarn !== bjDay(Date.now())) { tgtState.loginWarn = bjDay(Date.now()); saveTS(); try { await call('POST', '/im/v1/messages', { receive_id: boss, msg_type: 'text', content: JSON.stringify({ text: '⚠️ 插件没法自动拉推广通报表：推广通后台掉线了。请在装了「餐饮矩阵助手」的 Chrome 里打开 e.dianping.com 重新登录（输验证码），登录后插件会自己补拉。' }) }, { receive_id_type: 'open_id' }); } catch (e) { } }
      return { ok: false }; }
    const u = String(j.url || ''); if (!/^https:\/\/s3plus\.sankuai\.com\//.test(u)) throw new Error('下载地址不对');
    const rs = await fetch(u, { signal: AbortSignal.timeout(60000) }); if (!rs.ok) throw new Error('下载报表 HTTP ' + rs.status);
    const buf = Buffer.from(await rs.arrayBuffer()); const r = await tgt.ingest(buf); if (!r) throw new Error('报表格式没认出来');
    log(`[推广通·插件] 自动入库 ${r.rows} 行（${j.begin || ''}~${j.end || ''}）`);
    if (r.rows) { tgtState.autoDay = bjDay(Date.now()); saveTS();
      if (tgtState.chat) { try { await call('POST', '/im/v1/messages', { receive_id: tgtState.chat, msg_type: 'text', content: JSON.stringify({ text: '🤖 插件已自动拉取推广通门店报表（近 30 天，按门店按日）\n' + replyForTgt(r) + '\n今天不用再手动导出发群了。' }) }, { receive_id_type: 'chat_id' }); } catch (e) { } }
      await afterTgt(r, null); }
    return Object.assign({ ok: true }, r);
  }
  async function sendAdsWeekly(o) {
    o = o || {}; try {
      const r = await adsWeekly.report(); if (!r) { if (o.replyTo) await reply(o.replyTo, '还没有推广通数据'); return; }
      const head = `📈 ${r.title}（${r.by}）\n` + (r.doc ? `完整分析和三套方案已存到云文档：${r.doc}\n请看文档最后的「请你确认」，回我同意哪套方案。\n\n` : '') ;
      const body = r.doc ? r.text.split('\n').filter(l => /^【(一句话结论|我推荐)】/.test(l) || false).join('\n') + '\n' + (r.text.match(/【一句话结论】([\s\S]*?)【/) || ['', ''])[1].trim().slice(0, 300) + '\n\n' + ((r.text.match(/【我推荐】([\s\S]*?)(【|$)/) || ['', ''])[1].trim().slice(0, 500)) : r.text;
      if (boss) await call('POST', '/im/v1/messages', { receive_id: boss, msg_type: 'text', content: JSON.stringify({ text: head + body }) }, { receive_id_type: 'open_id' });
      if (o.replyTo) await reply(o.replyTo, boss ? '✅ 投放周报已私聊发给你' : head + body);
      if (o.weekly) { tgtState.weekly = bjDay(Date.now()); saveTS(); }
      return r;
    } catch (e) { log('[投放周报] 失败：' + e.message); if (o.replyTo) await reply(o.replyTo, '⚠️ 投放周报没生成：' + e.message.slice(0, 80)); }
  }
  // 投放数据群提醒：每天 9 点（前一天的推广通日报还没进来才提醒），每周一 9 点提醒导出近 30 天报表
  setInterval(async () => {
    const bj = new Date(Date.now() + 8 * 3600e3); const hh = bj.getUTCHours(), mm = bj.getUTCMinutes(), today = bjDay(Date.now());
    if (!on('tgtRemind') || !tgtState.chat || !(hh === 9 || hh === 10) || mm > 5 || tgtState.remind === today * 100 + hh) return; tgtState.remind = today * 100 + hh; saveTS();
    if (hh === 10 && (tgtState.lastDay || 0) >= today - 1 && bj.getUTCDay() !== 1) return; // 10 点：日报已经到了就不再提醒
    if (hh === 10 && bj.getUTCDay() === 1 && (tgtState.lastDay || 0) >= today - 1 && tgtState.weekly === today) return;
    let who = tgtState.reporterId || ''; const name = cfg.tgtReporter || '刘泽荣';
    if (!who) { try { let pt = ''; do { const d = await call('GET', `/im/v1/chats/${tgtState.chat}/members`, null, Object.assign({ member_id_type: 'open_id', page_size: 100 }, pt ? { page_token: pt } : {})); const f = (d.items || []).find(x => String(x.name || '').trim() === name); if (f) who = f.member_id; pt = d.has_more && !who ? d.page_token : ''; } while (pt); if (who) { tgtState.reporterId = who; saveTS(); } } catch (e) { log('[推广通提醒] 找不到 ' + name + '：' + e.message); } }
    const at = who ? `<at user_id="${who}"></at> ` : `@${name} `;
    try {
      const L = [];
      if ((tgtState.lastDay || 0) < today - 1) L.push(hh === 9 ? '⏰ 早上好，请把昨天的「推广通门店报表」导出发到群里（机器人自动入库、查余额和计划有没有停）。' : '⏰ 再提醒一次：昨天的「推广通门店报表」还没收到，麻烦尽快发群里。');
      if (bj.getUTCDay() === 1 && tgtState.weekly !== today) L.push('📅 今天周一：请再导出一份「近 30 天」的推广通门店报表发群里（日期选 30 天前到昨天）。30 日归因的订单要用它更新，今天的投放周报按这份来算每单成本。');
      if (L.length) await call('POST', '/im/v1/messages', { receive_id: tgtState.chat, msg_type: 'text', content: JSON.stringify({ text: at + L.join('\n') }) }, { receive_id_type: 'chat_id' });
    } catch (e) { log('[推广通提醒] 发送失败：' + e.message); }
  }, 60e3);
  // 周一：收到 30 天报表就出周报；14:00 还没收到就用现有数据出
  setInterval(() => { const bj = new Date(Date.now() + 8 * 3600e3); if (!on('adsWeekly') || bj.getUTCDay() !== 1 || tgtState.weekly === bjDay(Date.now())) return; if (bj.getUTCHours() >= 14) sendAdsWeekly({ weekly: true }); }, 5 * 60e3);
  async function registerLinks(text, who) { // 领稿页提交的链接 → 和群里贴链接一样登记进数据表
    const out = [];
    if (/xhslink|dpurl|ctrip\.com|xiaohongshu\.com/.test(text)) { const r = await core.handleText(text, who); if (r) out.push(replyForText(r)); }
    if (isDouyinLink(text)) { try { const r = await core.handleDouyin(text, who); if (r) out.push(replyForDouyin(r)); } catch (e) { out.push('⚠️ 抖音没登记上：' + e.message.slice(0, 60)); } }
    if (/weixin\.qq\.com\/sph\/|channels\.weixin\.qq\.com\//.test(text)) { try { const r = await core.handleChannelsLink(text, who); if (r) out.push(replyForChannels(r)); } catch (e) { out.push('⚠️ 视频号没登记上：' + e.message.slice(0, 60)); } }
    return out.filter(Boolean).join('\n');
  }
  const web = createWeb({ feat, cfg, brief, log, activity, bossId: () => boss, dispatch, download: dl, registerLinks, ownlib, official, exporter: () => deep.exportAll(), dailyCheck: () => histImport.check(), annualFacts: () => annual.facts(), drafts: { annual: () => annual.report(), deep: () => deep.report() }, campaign, creator: o => creator.run(o), creatorLast: () => creator.last(), studioSetup: async () => { const r = await studio.ensure(); r.migrated = await studio.migrateOld(); return r; }, studioDedupe: () => studio.markDups(), tgtIngest: buf => tgt.ingest(buf), tgtAuto: j => tgtAuto(j), tgtNeed: () => tgtNeed(), tableMeta: async (name) => { const app = await core.appToken(); const t = ((await call('GET', `/bitable/v1/apps/${app}/tables`, null, { page_size: 100 })).items || []).find(x => x.name === name); if (!t) return { error: '没这张表' }; const fd = await call('GET', `/bitable/v1/apps/${app}/tables/${t.table_id}/fields`, null, { page_size: 200 }); const rs = await call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/records/search`, { sort: [{ field_name: '发布日期', desc: true }] }, { page_size: 8 }).catch(e => ({ items: [], err: e.message })); return { fields: (fd.items || []).map(f => ({ n: f.field_name, t: f.type, ui: f.ui_type, p: f.property ? JSON.stringify(f.property).slice(0, 4000) : '' })), rows: (rs.items || []).map(r => r.fields), err: rs.err }; }, core, chats: async () => { const d = await call('GET', '/im/v1/chats', null, { page_size: 100 }); return (d.items || []).map(c => ({ name: c.name, id: c.chat_id.slice(-6), 收稿默认: /素人/.test(c.name) ? '抖音素人号' : /视频|抖音/.test(c.name) ? '抖音矩阵号' : /攻略|小红书/.test(c.name) ? '小红书矩阵号' : '按内容判断', 派稿范围: /抖音/.test(c.name) && !/小红书/.test(c.name) ? (/矩阵/.test(c.name) ? '只派抖音矩阵号' : '只派抖音类') : /小红书/.test(c.name) && !/抖音/.test(c.name) ? '只派小红书类' : /素人/.test(c.name) ? '只派素人号' : '全部', 放行: !(cfg.chats && cfg.chats.length) || cfg.chats.includes(c.chat_id) || /发布群|派稿|存放群|稿件|回收/.test(c.name) })); }, rereadDaily: () => rereadDaily(null), exportTable: n => exportTable(n), mktSnap: d => mktSnap(d), onDyAuth: x => onDyAuth(x), feedbackList: () => feedback.list(), moveLibs: () => moveLibs(), moveStatus: () => mover.status(), chatMsgs: async (q, n, cn) => { const out = []; let pt = ''; let k = 0; let cid = dailyChat; if (cn) { const cl = await call('GET', '/im/v1/chats', null, { page_size: 100 }); const c = (cl.items || []).find(x => (x.name || '').includes(cn)); if (!c) return []; cid = c.chat_id; } do { const d = await call('GET', '/im/v1/messages', null, Object.assign({ container_id_type: 'chat', container_id: cid, sort_type: 'ByCreateTimeDesc', page_size: 50 }, pt ? { page_token: pt } : {})); for (const it of d.items || []) { const c = (it.body || {}).content || ''; if (!q || c.includes(q)) out.push({ t: new Date(+it.create_time + 8 * 3600e3).toISOString().slice(5, 16), type: it.msg_type, sender: (it.sender || {}).sender_type, c: c.slice(0, 1500) }); } pt = d.has_more ? d.page_token : ''; k++; } while (pt && k < (n || 4)); return out; }, lastXlsx: async (q) => { if (q) lastUnknownXlsx = await findXlsx(new RegExp(q)); else if (!lastUnknownXlsx) lastUnknownXlsx = await findXlsx(); if (!lastUnknownXlsx) return null; const b = await fileBuf(lastUnknownXlsx.mid, lastUnknownXlsx.key); const rr = readXlsx(b); return { name: lastUnknownXlsx.name, rows: rr.length, head: rr.slice(0, 8) }; }, reingestLast: async (q) => { if (q) lastUnknownXlsx = await findXlsx(new RegExp(q)); else if (!lastUnknownXlsx) lastUnknownXlsx = await findXlsx(); if (!lastUnknownXlsx) return null; const b = await fileBuf(lastUnknownXlsx.mid, lastUnknownXlsx.key); return tgt.ingest(b); }, adsWeekly: async () => { const r = await adsWeekly.report(); return r ? { title: r.title, by: r.by, doc: r.doc, docError: r.docError, text: r.text } : null; }, dbCheck: () => dbMigrate.check(), archivable: d => dbMigrate.archivable(d), studio: () => studio, rows: async (name, days) => { // 私密表格只读：经营日报 / 推广通，最近 N 天（钥匙保护）
    const ok = [cfg.dailyTable || '经营日报数据', '推广通数据']; if (!ok.includes(name)) throw new Error('只能读：' + ok.join('、'));
    // 开关开着且库可用：直接读本地库（不受飞书行数限制）
    if (store.ok && store.ready() && dbOn(cfg)) {
      const from = Date.now() - Math.min(days || 45, 400) * 864e5;
      const out = name === (cfg.dailyTable || '经营日报数据') ? store.queryDaily({ from }) : store.queryTgt({ from });
      return { ok: true, n: out.length, rows: out, src: 'db' };
    }
    const app = await core.dailyAppToken(); const t = ((await call('GET', `/bitable/v1/apps/${app}/tables`, null, { page_size: 100 })).items || []).find(x => x.name === name); if (!t) throw new Error('没这张表');
    const since = Date.now() - Math.min(days || 45, 400) * 864e5; const out = []; let pt = '';
    do { const d = await call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/records/search`, { filter: { conjunction: 'and', conditions: [{ field_name: '日期', operator: 'isGreater', value: ['ExactDate', String(since)] }] } }, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); out.push(...(d.items || []).map(r => r.fields)); pt = d.has_more ? d.page_token : ''; } while (pt);
    return { ok: true, n: out.length, rows: out }; } });
  rawIO.taskLink = id => web.taskLink(id);
  // 每周一 03:00 把库导成 xlsx + .db 两份存到飞书云空间私密文件夹（只给老板，留最近 8 份）
  const dbBackup = createDbBackup({ cfg, api: { call }, log, store, upload, bossId: () => boss, dataDir: DATA_DIR });
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
    const live = rows.filter(x => x.v.status !== '取消'); const done = live.filter(x => x.v.status === '已发布'), todo = live.filter(x => x.v.status !== '已发布');
    if (remind) return todo.length ? '⏰ 今天的稿件还没发的提醒一下，发完在领稿页贴链接就行：\n' + todo.map(x => (x.at ? `<at user_id="${x.at}"></at>` : '@' + (x.v.who || '?')) + ` ${x.v.code}`).join('\n') : '';
    return `📋 今日派稿进度：派出 ${live.length} 条，已发布 ${done.length} 条，还没发 ${todo.length} 条` + (todo.length ? '\n\n还没发：\n' + todo.map(x => `· ${x.v.who || '?'} · ${x.v.code}`).join('\n') : '\n\n🎉 全部发完了') + (done.length ? '\n\n已发布：\n' + done.map(x => `· ${x.v.who || '?'} · ${x.v.code}`).join('\n') : '');
  }
  const PST = path.join(DATA_DIR, 'publish-state.json'); let pst = {}; try { pst = JSON.parse(fs.readFileSync(PST, 'utf8')); } catch (e) { }
  setInterval(async () => { // 20:00 群里 @ 还没发的人；21:30 群里发当天进度
    const bj = new Date(Date.now() + 8 * 3600e3), hh = bj.getUTCHours(), mm = bj.getUTCMinutes(), day = Math.floor((Date.now() + 8 * 3600e3) / 864e5);
    const chats = PCHATS(); if (!chats.length) return; const doRemind = on('progress') && hh === 20 && pst.remind !== day, doSum = on('progress') && hh === 21 && mm >= 30 && pst.sum !== day; if (doRemind) pst.remind = day; if (doSum) pst.sum = day; if (doRemind || doSum) fs.writeFileSync(PST, JSON.stringify(pst));
    for (const chat of chats) try {
      if (doRemind) { const t = await progress(chat, true); if (t) await call('POST', '/im/v1/messages', { receive_id: chat, msg_type: 'text', content: JSON.stringify({ text: t }) }, { receive_id_type: 'chat_id' }); }
      if (doSum) { const t = await progress(chat, false); if (!/还没有派过稿/.test(t)) await call('POST', '/im/v1/messages', { receive_id: chat, msg_type: 'text', content: JSON.stringify({ text: t }) }, { receive_id_type: 'chat_id' }); }
    } catch (e) { log('[领稿] 定时提醒出错：' + e.message); }
  }, 60e3);
  setTimeout(async () => { // 自检：经营日报群昨晚到现在的消息（谁发的、是不是日报）和群成员
    try { const chat = dailyChatNow(); if (!chat) return; const start = Math.floor(Date.now() / 1000) - 16 * 3600; const ms = []; let pt = '';
      do { const d = await call('GET', '/im/v1/messages', null, Object.assign({ container_id_type: 'chat', container_id: chat, start_time: String(start), sort_type: 'ByCreateTimeAsc', page_size: 50 }, pt ? { page_token: pt } : {})); ms.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
      log(`[自检·日报群] 近 16 小时 ${ms.length} 条消息：` + ms.map(x => { const f = flatten(x.msg_type, (x.body || {}).content); return `${new Date(+x.create_time + 8 * 3600e3).toISOString().slice(5, 16)} ${(x.sender || {}).sender_type}/${String((x.sender || {}).id || '').slice(-6)} ${x.msg_type} ${(f.text || '').replace(/\s+/g, ' ').slice(0, 40)}`; }).join(' | '));
      ms.filter(x => (x.sender || {}).sender_type === 'app' && !String((x.sender || {}).id || '').endsWith('badd00')).slice(-2).forEach(x => log('[自检·日报群] 其他机器人原始消息：' + String((x.body || {}).content || '').slice(0, 900)));
      const mm = await call('GET', `/im/v1/chats/${chat}/members`, null, { member_id_type: 'open_id', page_size: 100 }); log(`[自检·日报群] 成员：${(mm.items || []).map(x => x.name).join('、')}`);
      const ci = await call('GET', `/im/v1/chats/${chat}`, null, {}); log(`[自检·日报群] 群信息：人数 ${ci.user_count}，机器人数 ${ci.bot_count}，外部群 ${ci.external}`);
    } catch (e) { log('[自检·日报群] 出错：' + e.message.slice(0, 160)); }
  }, 35e3);
  setTimeout(async () => { // 自检：能不能读发布群成员、读到人名（决定卡片能不能真 @ 到人）
    try { const chat = fs.readFileSync(path.join(DATA_DIR, 'publish-chat.txt'), 'utf8').trim(); const d = await call('GET', `/im/v1/chats/${chat}/members`, null, { member_id_type: 'open_id', page_size: 100 }); const ns = (d.items || []).map(x => x.name); log(`[自检] 发布群成员 ${ns.length} 人：${ns.slice(0, 20).join('、')}`); if (d.items && d.items[0]) { const n = await senderName(d.items[0].member_id); log('[自检] 读人名：' + (n || '读不到')); } } catch (e) { log('[自检] 读群成员失败：' + e.message.slice(0, 160)); }
  }, 25e3);
  setTimeout(async () => { const f = path.join(DATA_DIR, 'alias-seed.json'); if (fs.existsSync(f)) return; try { // 一次性：账号改过名的，补上旧名（按数据表推断）
      const ps = await people.list(true); const A = String(cfg.dailyBaseUrl).match(/\/base\/([A-Za-z0-9]+)/)[1]; const tabs = await call('GET', `/bitable/v1/apps/${A}/tables`, null, { page_size: 100 }); const t = (tabs.items || []).find(x => x.name === '人员账号对照');
      const seed = [[p => p['小红书账号'] === '饭桌C位Jack', 'c位Noli、饭桌c位fury'], [p => p['小红书账号'] === '七七八八八', '77888']]; const upd = [];
      for (const [fn, al] of seed) { const p = ps.find(fn); if (p && !p['账号别名']) upd.push({ record_id: p.id, fields: { 账号别名: al } }); }
      if (t && upd.length) await call('POST', `/bitable/v1/apps/${A}/tables/${t.table_id}/records/batch_update`, { records: upd }); fs.writeFileSync(f, JSON.stringify({ n: upd.length })); log('[人员] 补账号别名 ' + upd.length);
    } catch (e) { log('[人员] 补别名出错 ' + e.message); } }, 60e3);
  setTimeout(async () => { const f = path.join(DATA_DIR, 'hits-first.json'); if (fs.existsSync(f)) return; try { fs.writeFileSync(f, String(Date.now())); await sendHits(); } catch (e) { log('[爆款公式] 首次生成出错：' + e.message); } }, 100e3);
  setTimeout(async () => { const f = path.join(DATA_DIR, 'settle-2026-10b.json'); if (fs.existsSync(f)) return; try { const t = await runSettle('2026-10'); fs.writeFileSync(f, JSON.stringify({ at: Date.now() })); log('[结算] 10 月试算完成'); } catch (e) { log('[结算] 10 月试算出错：' + e.message); } }, 80e3); // 一次性：用 10 月数据和腾讯文档对账
  setInterval(async () => { // 每月 1 号 10:30：算上个月结算草稿，私聊老板
    const bj = new Date(Date.now() + 8 * 3600e3); if (!on('settle') || bj.getUTCDate() !== 1 || bj.getUTCHours() !== 10 || bj.getUTCMinutes() < 30) return; const mon = lastMonth(); if (pst.settle === mon || !boss) return; pst.settle = mon; try { fs.writeFileSync(PST, JSON.stringify(pst)); } catch (e) { }
    try { const t = await runSettle(mon); await call('POST', '/im/v1/messages', { receive_id: boss, msg_type: 'text', content: JSON.stringify({ text: t }) }, { receive_id_type: 'open_id' }); } catch (e) { log('[结算] 自动结算出错：' + e.message); }
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
    if (false && ((hh === 9 && mm >= 30) || hh === 10 || hh === 11) && briefState.ads !== bjDay(Date.now()) && briefState.last === bjDay(Date.now())) sendAds({ weekly: true }); // 已由「投放周报」替代
  }, 60e3);
  setTimeout(async () => { try { if (!(await brief.latestAds())) await brief.ads(); } catch (e) { log('[投放分析] 首次生成出错 ' + e.message); } }, 70e3);
  setInterval(() => {
    if (cfg.briefAuto === false || !on('brief')) return;
    const bj = new Date(Date.now() + 8 * 3600e3); const hh = bj.getUTCHours(), mm = bj.getUTCMinutes();
    const [H, M] = String(cfg.briefTime || '09:00').split(':').map(Number);
    if ((hh > H || (hh === H && mm >= M)) && hh < H + 3 && briefState.last !== bjDay(Date.now())) sendBrief({});
  }, 60e3);

  const lark = require('@larksuiteoapi/node-sdk');
  const ws = new lark.WSClient({ appId: cfg.appId, appSecret: cfg.appSecret, loggerLevel: lark.LoggerLevel.warn });
  ws.start({ eventDispatcher: new lark.EventDispatcher({}).register({ 'im.message.receive_v1': data => { onMessage(data); return {}; } }) });
  log('机器人已启动：在群里发分享或数据中心截图试试。这个窗口别关。');
})().catch(e => { log('启动失败：', e.message); process.exitCode = 1; });
