/* 禧聚营销部 · 飞书群机器人
 * 同事在群里发「小红书/点评/携程/微信」分享 → 自动登记到多维表格「小红书矩阵号-数据」
 * 同事在群里发小红书「数据中心」截图 → 自动更新小眼睛/赞/评（写在「(自动)」列）
 * 用飞书「长连接」收消息：不需要公网服务器，电脑或云服务器开着这个程序就行
 */
'use strict';
const fs = require('fs'); const path = require('path'); const readline = require('readline');
const { createCore, replyForText, replyForImage, replyForDaily } = require('./lib/core');

const CFG_FILE = path.join(__dirname, 'config.json');
const LOG_FILE = path.join(__dirname, 'bot.log');
const API = 'https://open.feishu.cn/open-apis';
function log(...a) { const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ` + a.join(' '); console.log(line); try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) { } }

async function setup() {
  if (fs.existsSync(CFG_FILE)) return JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
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
  try { const extra = path.join(__dirname, 'private.json'); if (fs.existsSync(extra)) Object.assign(cfg, JSON.parse(fs.readFileSync(extra, 'utf8'))); } catch (e) { log('private.json 读取失败：', e.message); }
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


  const core = createCore({ cfg, api: { call, fetchXhs, vision: cfg.qwenKey ? vision : null }, log });
  await core.load(true);

  // ---------- 收消息 ----------
  const seen = new Set();
  function flatten(type, content) { // 文本 / 富文本 → 文字 + 图片
    let c = {}; try { c = JSON.parse(content || '{}'); } catch (e) { }
    if (type === 'text') return { text: c.text || '', images: [] };
    if (type === 'image') return { text: '', images: [c.image_key] };
    if (type === 'post') {
      const body = c.content ? c : (c.zh_cn || c.en_us || Object.values(c)[0] || {});
      const text = [body.title || '', ...(body.content || []).map(par => par.map(x => x.tag === 'a' ? `${x.text || ''} ${x.href || ''}` : x.tag === 'text' ? x.text : '').join(''))].join('\n');
      return { text, images: (body.content || []).flat().filter(x => x.tag === 'img').map(x => x.image_key) };
    }
    return { text: '', images: [] };
  }
  async function onMessage(data) {
    const m = data.message || {}; if (!m.message_id || seen.has(m.message_id)) return; seen.add(m.message_id); if (seen.size > 5000) seen.clear();
    if (m.chat_type !== 'group') return;
    if (cfg.chats && cfg.chats.length && !cfg.chats.includes(m.chat_id)) return;
    const { text, images } = flatten(m.message_type, m.content);
    // 门店营业日报（华付数科等机器人发的也收）
    if (text && /营业日概况|当天总营业额/.test(text)) {
      try { const r = await core.handleDaily(text, (data.sender || {}).sender_type === 'app' ? '日报机器人' : '群消息'); if (r && r.length) { log(`[日报] ${r.map(x => x.store + ' ' + x.date).join('、')}`); if (cfg.replyDaily !== false) await reply(m.message_id, replyForDaily(r)); } } catch (e) { if (e.message === 'NO_PRIVATE_BASE') { log('收到营业日报，但还没配置私密表格（config.json 的 dailyBaseUrl），没有记录'); await reply(m.message_id, '⚠️ 还没设置营业日报的私密表格，这条先不记录（不会写进营销部共享表）'); } else log('处理日报出错：', e.message); }
      return;
    }
    if ((data.sender || {}).sender_type === 'app') return;
    try {
      if (text && /xhslink|dpurl|ctrip\.com|xiaohongshu\.com/.test(text)) {
        const who = await senderName(((data.sender || {}).sender_id || {}).open_id);
        const r = await core.handleText(text, who);
        if (r) { log(`[登记] ${who} 新增 ${r.created.length}，重复 ${r.dups.length}`); await reply(m.message_id, replyForText(r)); }
      }
      if (images.length) {
        if (!cfg.qwenKey) log('收到截图，但 config.json 没填通义千问 Key，跳过');
        else {
          const lines = [];
          for (const key of images) {
            try {
              const r = await core.handleImage(await image(m.message_id, key));
              if (r) { log(`[截图] ${r.acc || ''} 更新 ${r.updated ? r.updated.length : 0}`); lines.push(replyForImage(r)); }
              else log('[截图] 不是数据中心截图，没处理');
            } catch (e) { log('处理截图出错：', e.message); lines.push('⚠️ 有一张截图没处理成功：' + e.message.slice(0, 60)); }
          }
          if (lines.length) await reply(m.message_id, (images.length > 1 ? `共 ${images.length} 张截图\n` : '') + lines.join('\n'));
        }
      }
    } catch (e) { log('处理消息出错：', e.message); }
  }

  const lark = require('@larksuiteoapi/node-sdk');
  const ws = new lark.WSClient({ appId: cfg.appId, appSecret: cfg.appSecret, loggerLevel: lark.LoggerLevel.warn });
  ws.start({ eventDispatcher: new lark.EventDispatcher({}).register({ 'im.message.receive_v1': data => { onMessage(data); return {}; } }) });
  log('机器人已启动：在群里发分享或数据中心截图试试。这个窗口别关。');
})().catch(e => { log('启动失败：', e.message); process.exitCode = 1; });
