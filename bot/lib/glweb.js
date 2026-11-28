/* 攻略平台网页：https://work.yesyueji.com/cockpit/gl/（以后切到 gl.yesyueji.com）
 * 独立登录（和驾驶舱账号不通），读不到任何经营数据；角色：boss 老板（全部）/ ops 运营策划 / review 只审稿
 * 页面：bot/cockpit/gl.html（单页），接口都在 /cockpit/gl/api/*
 * 数据：data/gl/users.json、stores.json、briefs.json、batches/<批次>.json；爆款库在 lib/glib.js
 */
'use strict';
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DAY = 864e5;
const LAYOUTS = {
  clean: { name: '纯文字清单（落地X第1顿）', desc: '米白底大字封面＋大分类标题＋空心圆店名清单（照我们 88 号华强北稿），最后放主店实拍拼图' },
  green: { name: '绿底备忘录攻略（去了X次我的建议是）', desc: '绿底手机备忘录：钩子封面＋值得去/不值得去/美食街区括号图＋建议1…＋美食推荐，最后主店实拍拼图（照我们 81 号华强北稿）' },
  nav: { name: '导航避坑（X旅游规则怪谈）', desc: '粉底大字封面＋白色备忘录：1、某景点：不要只搜「某景点」＋导航建议高亮，后面吃饭清单和主店实拍拼图（照我们 83 号华强北稿）；导航细节发布前要人工核实' },
  memo: { name: '存一下（纯文字备忘录）', desc: '黄底大字封面＋备忘录空心圆清单，按类分，最后一页实拍' },
  hand: { name: 'X吃什么（手写批注）', desc: '手机备忘录：吃什么/玩什么分组，编号店名＋紫色手写招牌菜' },
  star: { name: '星级＋短评', desc: '星级图例封面＋备忘录：店名⭐＋一句短评（招牌、人均、位置）' },
  route: { name: '一日游路线表', desc: '路线时间表＋景点小贴士＋吃饭清单＋主店介绍' },
  // 以下照爆文工厂模板库里的文字类爆款版式做（林总 2026-11-27）：多是纯清单，一般 2–5 页＋最后实拍
  allcheck: { name: '美食超全合集', desc: '白底多页：品类小标题，黄色打勾圆圈＋店名（位置）', list: 1 },
  treat: { name: '招待外地朋友', desc: '备忘录按品类分，店名（一句短评），最后实拍', list: 1 },
  friends: { name: '和朋友一致认为（按区域）', desc: '按商圈分组：店名（招牌菜、招牌菜）', list: 1 },
  icloud: { name: '和朋友一致认为（iCloud 按区）', desc: 'iCloud 备忘录：一、二、三…区域彩色标签，下面列店名', list: 1 },
  chat: { name: '聊天气泡「X最好吃的XX」', desc: '灰底聊天截图：绿色气泡「X最好吃的品类：店名」＋头像，一页 8–9 条', list: 1 },
  helpme: { name: '大家帮我看看这些店可以吃吗', desc: '一页求助口吻：「品类：店（菜）/店（菜）」密排，引评论', list: 1 },
  tier: { name: 'X美食分级表', desc: '一页分级表：夯／顶级／人上人／宝藏四级色块，右边店名', list: 1 },
  kraft: { name: 'X最值得吃的好饭（牛皮纸）', desc: '牛皮纸笔记本手写：一行一家「X最值得吃的品类：店名」', list: 1 },
  table: { name: 'X各区特色美食（表格）', desc: '渐变大标题＋表格「区域｜特色美食（店名）」', list: 1 },
  news: { name: '最近想去吃的（报纸风）', desc: '米黄报纸风：宋体大标题，两栏编号，店名＋品类｜人均＋推荐菜', list: 1 },
  mint: { name: 'X人的嘴真的很会挑（绿底卡片）', desc: '薄荷绿底两列卡片：01 店名，品类｜人均，推荐菜', list: 1 },
  greyblock: { name: '分类编号灰底块', desc: '手机备忘录：一、二、三…品类，灰底块里 1、店名（短评）', list: 1 },
  thumbs: { name: '朋友一致认为👍', desc: '备忘录宋体：按区域每组几家，后面 👍 个数', list: 1 },
  bigarea: { name: '按区 品类＋店名（大字）', desc: '白底大字：区域，下面一行「品类 店名 店名」', list: 1 }
};

function createGlweb({ dataDir, log, cfg, glib, base, bossDm, sucai, vision, roster: rosterSrc }) {
  const D = path.join(dataDir, 'gl'); const BD = path.join(D, 'batches'), PD = path.join(D, 'photos'); [D, BD, PD].forEach(d => fs.mkdirSync(d, { recursive: true }));
  const rj = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
  const wj = (f, v) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f); };
  const UF = path.join(D, 'users.json'), SF = path.join(D, 'stores.json'), BF = path.join(D, 'briefs.json'), MF = path.join(D, 'meta.json'), RF = path.join(D, 'refs.json');
  let U = rj(UF, { users: [] }), META = rj(MF, {});
  if (!fs.existsSync(SF) || !fs.existsSync(BF)) { const seed = require('./glseed'); if (!fs.existsSync(SF)) wj(SF, seed.shops); if (!fs.existsSync(BF)) wj(BF, [seed.brief]); log('[攻略平台] 导入初始门店池和白石洲任务书'); }
  { const L = rj(RF, []); const del = (rj(path.join(D, 'meta.json'), {}).refDel || []); const add = (require('./glseed').refs || []).filter(r => !L.some(x => x.id === r.id) && !del.includes(r.id)); if (add.length || !fs.existsSync(RF)) wj(RF, L.concat(add)); } // 新加进初始数据的范文自动补进来
  const stores = () => rj(SF, []), briefs = () => rj(BF, []), refs = () => rj(RF, []);
  { const L = refs(); if (L.some(r => r.imgDesc && !(r.imgs || []).length)) { L.forEach(r => { if (!(r.imgs || []).length) delete r.imgDesc; }); wj(RF, L); } } // 图删光了，版式说明也去掉
  { const L = briefs(); let ch = false; L.forEach(b => { if (!b.city) { b.city = '深圳'; ch = true; } if (b.id === 'b1' && !b.placeWords) { b.placeWords = ['白石洲', '华侨城', '蛇口', '南头', '深圳湾']; b.storeType = b.storeType || '海鲜大排档'; ch = true; } if (b.id === 'b1' && !b.nearAreas) { b.nearAreas = ['白石洲', '世界之窗', '华侨城', '欢乐谷', '沙河', '深圳湾']; b.facts = b.facts || '店在博耐家居广场一楼，白石洲站 C 口出来步行约 260 米；营业 17:00-次日02:00；爆膏奶油虾用的是罗氏虾（不是龙虾）'; ch = true; } }); if (ch) wj(BF, L); }
  { const L = briefs(); let ch = false; const more = ['#深圳美食攻略', '#深圳旅游攻略', '#南山宵夜', '#海鲜大排档', '#广式大排档', '#深圳本地人推荐', '#华侨城', '#深圳湾公园']; L.forEach(b => { if (!b.tagsTotal) { b.tagsTotal = 9; b.tagsOpt = [...new Set([...(b.tagsOpt || []), ...more])]; if (!(b.tagsMust || []).includes('#YES也是大排档')) b.tagsMust = [...(b.tagsMust || []), '#YES也是大排档']; ch = true; } }); if (ch) wj(BF, L); } // 林总 2026-11-27：话题 8–10 个，必带 #YES也是大排档
  { const L = briefs(); let ch = false; L.forEach(b => { if ((b.banned || []).includes('第一')) { b.banned = b.banned.filter(w => w !== '第一').concat(['全网第一', '深圳第一', '第一名']); ch = true; } }); if (ch) wj(BF, L); } // 「第一」会误伤「第一站」「第一天」
  const key = crypto.createHash('sha256').update('xiju-gl:' + (cfg.appSecret || '') + ':' + (cfg.cockpitSalt || '')).digest();
  const b64 = b => Buffer.from(b).toString('base64url');
  const sign = (body) => b64(body) + '.' + crypto.createHmac('sha256', key).update(body).digest('base64url');
  const verify = (tok, kind) => { try { const [b, s] = String(tok || '').split('.'); const body = Buffer.from(b, 'base64url').toString(); const good = crypto.createHmac('sha256', key).update(body).digest('base64url'); if (!s || s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null; const [k, who, exp] = body.split('|'); if (k !== kind || +exp < Date.now()) return null; return who; } catch (e) { return null; } };
  const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
  const saveU = () => wj(UF, U); const saveMeta = () => wj(MF, META);
  const esc = x => String(x === null || x === undefined ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const send = (res, code, body, type, extra) => { res.writeHead(code, Object.assign({ 'content-type': type || 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' }, extra || {})); res.end(body); };
  const J = (res, v) => send(res, 200, JSON.stringify(v));
  const cookie = req => { const m = String(req.headers.cookie || '').match(/(?:^|;\s*)xgl=([^;]+)/); return m ? m[1] : ''; };
  const ipOf = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  async function body(req, max) { let b = ''; for await (const c of req) { b += c; if (b.length > (max || 2e6)) break; } return b; }
  const ROLE = { boss: '老板', ops: '运营/策划', review: '审稿', writer: '写手' };
  const userOf = req => { const id = verify(cookie(req), 'S'); return id ? U.users.find(x => x.id === id && !x.off) : null; };
  const setupLink = (uid, hours) => `${base}setpass?t=${sign(`P|${uid}|${Date.now() + (hours || 24) * 3600e3}`)}`;
  function ensureBoss() { let b = U.users.find(x => x.role === 'boss'); if (!b) { b = { id: 'u' + crypto.randomBytes(4).toString('hex'), name: cfg.bossName || '林总', role: 'boss', at: Date.now() }; U.users.push(b); saveU(); } return b; }
  // 早上 8 点：老板还没设密码，就私聊一个设置链接（当天 6 小时内有效）
  setInterval(async () => { try { const d = new Date(Date.now() + 8 * 3600e3); const today = d.toISOString().slice(0, 10); const b = ensureBoss(); if (b.hash || META.setupSent === today || d.getUTCHours() < 8) return; META.setupSent = today; saveMeta(); await bossDm(`🧭 攻略平台已经上线，先设置你的账号密码（6 小时内有效、只能用一次，别转发）：\n${setupLink(b.id, 6)}\n\n以后登录网址：${base}\n员工账号在平台「账号」页里开，员工看不到驾驶舱和经营数据。`); log('[攻略平台] 已私聊老板设置链接'); } catch (e) { log('[攻略平台] 发设置链接出错：' + e.message); } }, 60e3);
  const usedTok = new Set(); const fails = new Map();
  const shell = (title, inner) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(1200px 600px at 50% -10%,#12234080,transparent 70%),#070d18;color:#e6edf7;font-family:"Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif}form{background:#0d1626;border:1px solid #1e2c45;border-radius:12px;padding:28px 26px;width:min(340px,90vw)}h1{font-size:18px;margin:0 0 4px}p{color:#8b9bb4;font-size:13px;margin:0 0 18px}input{width:100%;box-sizing:border-box;margin:6px 0 12px;padding:10px 12px;border-radius:8px;border:1px solid #1e2c45;background:#070d18;color:#e6edf7;font:inherit}button{width:100%;padding:10px;border:0;border-radius:8px;background:#4cc9f0;color:#04121c;font-weight:700;font:inherit;cursor:pointer}.e{color:#ff6b6b;font-size:13px;margin-bottom:10px}</style></head><body>${inner}</body></html>`;
  const loginPage = (msg) => shell('攻略平台 · 登录', `<form method="post" action="/cockpit/gl/login"><h1>粤迹 · 攻略平台</h1><p>爆款库 · AI 出稿 · 审稿派单</p>${msg ? `<div class="e">${esc(msg)}</div>` : ''}<label>账号<input name="u" autocomplete="username" required></label><label>密码<input name="p" type="password" autocomplete="current-password" required></label><button>登录</button></form>`);
  const setPage = (t, name, msg) => shell('攻略平台 · 设置账号', `<form method="post" action="/cockpit/gl/setpass"><h1>设置账号密码</h1><p>${esc(name)}，设置你登录攻略平台用的账号和密码</p>${msg ? `<div class="e">${esc(msg)}</div>` : ''}<input type="hidden" name="t" value="${esc(t)}"><label>账号（字母或数字）<input name="u" pattern="[A-Za-z0-9_]{3,20}" required></label><label>密码（至少 8 位）<input name="p" type="password" minlength="8" required></label><button>保存并登录</button></form>`);
  const sess = uid => `xgl=${sign(`S|${uid}|${Date.now() + 7 * DAY}`)}; Path=/cockpit/gl/; Max-Age=${7 * 86400}; HttpOnly; Secure; SameSite=Lax`;
  const page = () => { try { return fs.readFileSync(path.join(__dirname, '..', 'cockpit', 'gl.html')); } catch (e) { return null; } };

  // ---------- AI 出稿 ----------
  // 大模型用量和余额（林总 2026-11-27：要知道 DeepSeek、千问还够不够，不够好去充值）
  // 千问 key 可以在平台上换（林总 2026-11-27：原来那把不知道是哪个阿里云账号开的、看不到余额 → 换成自己能充值的账号的 key）。
  // 新 key 只存在服务器 data/gl/llmkey.json，不进仓库、页面上只显示头尾几位；换了以后整个机器人都用新的，原来那把留作备用（新的被拒时攻略平台自动退回去用）。
  // 11-28：百炼新建的 key 是「业务空间 key」（sk-ws- 开头、中间带点），有的只能在业务空间自己的地址上用、在老地址 dashscope.aliyuncs.com 上用不了。
  // 所以换 key 时先试老地址：通了就整个机器人都换；不通再试业务空间地址（页面上可以贴，或者写在 config 的 glBase），通了就只给攻略平台用，机器人其它功能照旧用原来那把。
  const DASH = 'https://dashscope.aliyuncs.com/compatible-mode/v1'; const KF = path.join(D, 'llmkey.json'); const QWEN_ORIG = cfg.qwenKey || ''; let GLK = null; // GLK = { key, base }：只给攻略平台用的 key
  { const K0 = rj(KF, {}); if (K0.qwenKey) { if (K0.base && K0.base !== DASH) GLK = { key: K0.qwenKey, base: K0.base }; else cfg.qwenKey = K0.qwenKey; } }
  const qwenKeys = () => { const L = []; if (GLK) L.push([GLK.base, GLK.key]); [cfg.qwenKey, QWEN_ORIG].filter(Boolean).forEach(k => { if (!L.some(x => x[1] === k)) L.push([DASH, k]); }); return L; };
  async function testKey(k, model, base) { const r = await fetch((base || DASH) + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + k }, signal: AbortSignal.timeout(40000), body: JSON.stringify({ model: model || 'qwen-plus', max_tokens: 8, messages: [{ role: 'user', content: '回复：好' }] }) }); const j = await r.json().catch(() => ({})); return { ok: r.ok, err: r.ok ? '' : String((j.error && (j.error.message || j.error.code)) || 'HTTP ' + r.status).slice(0, 160) }; }
  async function setQwenKey(k, who, base) { k = String(k || '').trim(); if (/\*{2,}|…/.test(k)) throw new Error('这是打了星号的 key，不完整。要贴刚创建时显示的那一整串（点「复制」按钮复制的）'); if (!/^sk-[A-Za-z0-9._-]{16,}$/.test(k)) throw new Error('这不像百炼的 API Key（应该是 sk- 开头的一长串，中间不能有空格）');
    base = String(base || cfg.glBase || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, ''); if (base && !/^https:\/\/[a-z0-9.-]+\.aliyuncs\.com\/compatible-mode\/v1$/.test(base)) throw new Error('Base URL 不对：要贴控制台「按量付费 Base URL」第一行（https:// 开头、compatible-mode/v1 结尾）');
    const t = await testKey(k);
    if (t.ok) { wj(KF, { qwenKey: k, at: Date.now(), by: who }); cfg.qwenKey = k; GLK = null; log(`[攻略平台] ${who} 换了千问 key（尾号 ${k.slice(-4)}），整个机器人都用它`); return { scope: 'all' }; }
    if (!base) throw new Error('这把 key 在通用地址上用不了（' + t.err + '）。请把控制台 API Key 页上「按量付费 Base URL」的第一行也贴到下面那个框里，再点一次');
    const t2 = await testKey(k, 'qwen-plus', base); if (!t2.ok) throw new Error('这把 key 两个地址都试了，用不了：' + t2.err);
    wj(KF, { qwenKey: k, base, at: Date.now(), by: who }); GLK = { key: k, base }; cfg.qwenKey = QWEN_ORIG; log(`[攻略平台] ${who} 换了千问 key（尾号 ${k.slice(-4)}），只有攻略平台用它（业务空间地址）`); return { scope: 'gl' }; }
  const UGF = path.join(D, 'llmuse.json'); const USE = rj(UGF, {}); const LLMERR = {}; let useT = null;
  function useAdd(model, u) { const d = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); const o = (USE[d] = USE[d] || {}); const m = (o[model] = o[model] || [0, 0, 0]); m[0]++; m[1] += (u && u.prompt_tokens) || 0; m[2] += (u && u.completion_tokens) || 0; if (!useT) useT = setTimeout(() => { useT = null; const ks = Object.keys(USE).sort(); while (ks.length > 60) delete USE[ks.shift()]; wj(UGF, USE); }, 5000); }
  async function llmStat() { const tail = k => k ? String(k).slice(0, 3) + '…' + String(k).slice(-4) : ''; // 只露头 3 位和尾 4 位，方便老板在控制台对上是哪一把
    const out = { deepseek: { has: !!cfg.deepseekKey, tail: tail(cfg.deepseekKey) }, qwen: { has: !!cfg.qwenKey, tail: tail(GLK ? GLK.key : cfg.qwenKey), changed: !!GLK || cfg.qwenKey !== QWEN_ORIG, scope: GLK ? 'gl' : 'all', origTail: tail(QWEN_ORIG), changedAt: (rj(KF, {}).at) || null, models: [] }, use: USE, errs: LLMERR, keyNames: Object.keys(cfg).filter(k => /key|token|secret|deepseek|qwen|dashscope|model/i.test(k)) };
    if (cfg.deepseekKey) { try { const r = await fetch('https://api.deepseek.com/user/balance', { headers: { authorization: 'Bearer ' + cfg.deepseekKey }, signal: AbortSignal.timeout(15000) }); const j = await r.json().catch(() => ({})); out.deepseek.ok = r.ok; out.deepseek.available = j.is_available; out.deepseek.balances = (j.balance_infos || []).map(b => ({ currency: b.currency, total: b.total_balance, granted: b.granted_balance, topped: b.topped_up_balance })); if (!r.ok) out.deepseek.err = (j.error && j.error.message) || 'HTTP ' + r.status; } catch (e) { out.deepseek.err = e.message; } }
    const [pb, pk] = qwenKeys()[0] || []; if (pk) for (const m of [...new Set([...(cfg.glModels || ['deepseek-v4-pro', 'deepseek-v4.1-flash', 'qwen-plus']), ...(cfg.glReviewModels || ['qwen-max'])])].slice(0, 6)) { const t0 = Date.now(); try { const r = await fetch(pb + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + pk }, signal: AbortSignal.timeout(40000), body: JSON.stringify({ model: m, max_tokens: 8, messages: [{ role: 'user', content: '回复：好' }] }) }); const j = await r.json().catch(() => ({})); out.qwen.models.push({ model: m, ok: r.ok, ms: Date.now() - t0, err: r.ok ? '' : String((j.error && (j.error.message || j.error.code)) || 'HTTP ' + r.status).slice(0, 160) }); } catch (e) { out.qwen.models.push({ model: m, ok: false, err: e.message }); } }
    return out; }
  async function llm(prompt, models) {
    const tries = [];
    if (cfg.deepseekKey && !models) tries.push(['https://api.deepseek.com/chat/completions', cfg.deepseekKey, 'deepseek-chat']);
    for (const m of models || cfg.glModels || ['deepseek-v4-pro', 'deepseek-v4.1-flash', 'qwen-plus']) for (const [bu, k] of qwenKeys()) tries.push([bu + '/chat/completions', k, m]); // 同一个模型先用新 key，被拒再用原来那把
    let last = '没有配置大模型';
    for (const [u, k, model, big] of tries) {
      try { const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + k }, signal: AbortSignal.timeout(big ? 360000 : 240000), body: JSON.stringify({ model, temperature: 0.85, max_tokens: big ? 16000 : 8000, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }) });
        const j = await r.json().catch(() => ({})); if (r.ok) { useAdd(model, j.usage); const t = (((j.choices || [])[0] || {}).message || {}).content || ''; if (t) return { text: t, model }; const fr = ((j.choices || [])[0] || {}).finish_reason || ''; last = '返回空内容（' + fr + '）'; log(`[攻略平台] 模型 ${model} ${last}${big ? '（已加大额度）' : ''}`); if (fr === 'length' && !big) tries.splice(tries.indexOf(tries.find(t => t[1] === k && t[2] === model)) + 1, 0, [u, k, model, true]); continue; } // 会思考的模型把字数额度用在思考上、正文一个字没出：同一个模型加大额度再来一次，别直接降级
        last = (j.error && (j.error.message || j.error.code)) || ('HTTP ' + r.status); log(`[攻略平台] 模型 ${model} 不可用：${last}`); LLMERR[model] = { at: Date.now(), msg: String(last).slice(0, 160) }; if (/Arrearage|FreeTierOnly|insufficient|overdue|欠费|余额不足|Quota/i.test(String(last)) && bossDm && Date.now() - (META.llmAlertAt || 0) > 6 * 3600e3) { META.llmAlertAt = Date.now(); saveMeta(); bossDm(`⚠️ 攻略平台的大模型调用被拒了（${model}）：${String(last).slice(0, 120)}\n多半是阿里云百炼欠费或免费额度用完，要去充值，不然出稿和审稿会停。`).catch(() => { }); }
      } catch (e) { last = e.message; }
    }
    throw new Error(last);
  }
  const norm = s => String(s || '').replace(/[（(].*?[)）]/g, '').replace(/[\s·・.]/g, '');
  function matchShop(name, pool) { const n = norm(name); if (!n) return null; return pool.find(s => norm(s.name) === n) || pool.find(s => norm(s.name).includes(n) || n.includes(norm(s.name))) || null; }
  // 任务书通用化（林总 2026-11-27：其他门店也要能建任务书）：地点词、品牌词、城市都从任务书来，没填就按白石洲的老规则
  const reEsc = t => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const placeWordsOf = B => [...new Set([...(B.placeWords || []), B.city || '深圳', B.district, ...(B.mustSpots || []), ...(B.optSpots || [])].filter(Boolean))];
  const brandWordsOf = B => [...new Set([...(B.brandWords && B.brandWords.length ? B.brandWords : /YES|也是大排档/.test(B.brand || B.storeTitle || '') ? ['大排档', 'YES', '也是'] : [String(B.brand || '').slice(0, 6)])].filter(Boolean))];
  const brandRe = B => new RegExp(brandWordsOf(B).map(reEsc).join('|'), 'i');
  // 周边店：任务书「周边商圈」里的店优先；不够 6 家才用同区别的店补，并标「远」，AI 不能把它们写成步行顺路（林总 2026-11-27）
  function poolOf(B, all, main) {
    const ok = s => s.id !== main.id && !(s.planted && brandRe(B).test(s.name)) && !(B.sameCat && B.sameCat.length && sameCatRe(B).test(s.cat + s.name));
    const near = nearOf(B); const isNear = s => near.some(a => (s.area + (s.addr || '') + s.name).includes(a));
    const N = all.filter(s => ok(s) && isNear(s)); if (N.length >= 6 || !near.length) return N.length ? N : all.filter(s => s.district === B.district && ok(s));
    return [...N, ...all.filter(s => s.district === B.district && ok(s) && !isNear(s)).map(s => Object.assign({}, s, { far: true }))];
  }

  // ---------- 爆款模板池（林总 2026-11-27：爆文工厂模板库 + 我们爆款库里的文字类爆款，都当写稿的角度/结构参考）----------
  // 每篇分一个不同的「标题套路」和一篇这个套路下的真实爆款：学它的角度、开头和结构，不抄它的城市、店名和原句
  const TF = path.join(D, 'tpl.json'); let TP = rj(TF, { at: 0, items: [] });
  async function tplFetch() { try { const r = await fetch(cfg.glSeedUrl || 'https://pai.kyrinflow.com/data.json', { signal: AbortSignal.timeout(30000) }); const a = await r.json();
    TP = { at: Date.now(), items: (Array.isArray(a) ? a : []).filter(x => x && (x.text || '').length > 40 && /美食清单|文字页|指南排版|行程排版|手账|大字报|地图|路线/.test(x.type || '')).map(x => ({ id: x.id, title: String(x.title || '').slice(0, 60), sub: x.sub || x.tag || '通用', tag: x.tag || '', type: x.type, kind: x.kind || x.cat || '', text: String(x.text || '').slice(0, 700), daily: +x.daily || 0, fav: +x.fav || 0, src: '爆文工厂' })) }; wj(TF, TP); log(`[攻略平台] 爆款模板池 ${TP.items.length} 篇`); } catch (e) { log('[攻略平台] 拉爆款模板出错：' + e.message); } }
  setTimeout(() => { if (Date.now() - TP.at > 3 * DAY) tplFetch(); }, 40e3);
  function tplPool() { // 爆文工厂的 + 我们自己爆款库里拆解过的文字类（带内页结构）
    const own = glib && glib.query ? (glib.query({ n: 5000, text: '1' }).items || []).filter(x => x.ai && x.ai.trick).map(x => { const g = glib.get(x.id) || {}; return { id: x.id, title: String(g.title || '').slice(0, 60), sub: x.ai.trick, type: x.ai.type, kind: x.ai.cat, text: String(g.desc || '').slice(0, 700), pages: (g.ai && g.ai.pagesText) || '', layout: x.ai.layout, daily: x.daily || 0, src: '爆款库' }; }) : [];
    const byId = new Map(); [...TP.items, ...own].forEach(t => { const o = byId.get(t.id); byId.set(t.id, o ? Object.assign({}, o, t, { text: o.text.length > t.text.length ? o.text : t.text }) : t); }); return [...byId.values()];
  }
  function pickTpls(n, B, layout) { // 一批里每篇不同套路；同一任务书最近用过的套路往后放
    const used = new Map(); batches().filter(b => b.brief === B.id).slice(0, 8).forEach(b => b.notes.forEach(x => x.tpl && used.set(x.tpl.sub, (used.get(x.tpl.sub) || 0) + 1)));
    const P = tplPool().filter(t => !/^(其他|通用|未分类|运营派单表导入|)$/.test(t.sub || '') && !/必比登|米其林|黑珍珠|必吃榜|官方|领导人|APEC|明星同款|总统|总理/.test(t.title + t.text + t.sub) && /美食|吃|旅游|攻略|游/.test((t.kind || '') + t.type + t.sub + t.title) && t.text.length >= 60 && t.text.length <= 1200 && !/第\d+天/.test(t.text.slice(0, 200)));
    const groups = new Map(); P.forEach(t => { if (!groups.has(t.sub)) groups.set(t.sub, []); groups.get(t.sub).push(t); });
    const subs = [...groups.keys()].map(k => ({ k, n: groups.get(k).length, used: used.get(k) || 0, heat: Math.max(...groups.get(k).map(t => t.daily)) })).sort((a, c) => a.used - c.used || c.heat - a.heat).slice(0, Math.max(n * 3, 12)).sort(() => Math.random() - 0.5);
    return subs.slice(0, n).map(s => { const L = groups.get(s.k).sort((a, c) => (c.pages ? 1 : 0) - (a.pages ? 1 : 0) || c.daily - a.daily); return L[Math.floor(Math.random() * Math.min(3, L.length))]; });
  }

  // 林总 2026-11-27 发的 YES 菜单（各店通用；必吃榜是水东街店、宝藏榜是华强北店的，别的店不能说上榜）
  const YES_MENU = { '王牌推荐': [['爆膏奶油虾', 99], ['蒜巴掌大生蚝', 29], ['椒盐玉米', 32], ['秘汁捞花甲', 38], ['XO酱啫花菜煲', 38], ['榨菜蒸鲜吊龙', 49], ['古法酥脆黄花鱼', 58], ['爆炒鱿鱼须', 65], ['黑椒雪花牛肉粒', 68], ['海胆炒饭2.0', 58], ['椒盐皮皮虾', 108]],
    '海鲜粥': [['青虾粥', 88], ['青虾蟹粥', 118]],
    '粤味海鲜': [['蒜蓉粉丝蒸扇贝', 16], ['金不换炒海瓜子', 26], ['金银蒜蓉蒸黄金贝', 48], ['椒盐鱿鱼须', 49], ['白灼火箭鱿鱼筒', 58], ['豉汁炒花甲', 58], ['古法盐焗海螺', 68], ['紫苏豉汁炒圣子王', 78], ['咸蛋黄鸡翅虾', 78], ['秘汁捞花螺', 98], ['港式避风塘炒肉蟹', 178], ['牛油黑椒波龙', 238], ['椒盐九肚鱼', 49], ['秋葵捞鱿筒', 56], ['藤椒蒸鲈鱼', 58], ['吊龙牛肉粥', 68], ['台式胡椒花螺', 98], ['招牌胡椒虾', 98], ['爆膏奶油蟹', 99], ['生猛姜葱炒蟹', 108]],
    '锅气小炒': [['反沙凤梨', 26], ['白切鲜粉肠', 38], ['姜葱爆炒猪肝', 38], ['沙姜猪手', 38], ['避风塘鸡中翅', 48], ['椒盐鸭下巴', 49], ['姜葱爆炒鲜吊龙', 58], ['韭菜爆炒鱿鱼筒', 59], ['爽脆拌鱼皮', 26], ['金不换炒白贝', 28], ['串串香鱿鱼须', 28], ['胜瓜滑蛋浸鲜贝', 36]],
    '啫煲': [['枸杞猪肝瘦肉汤', 33], ['咸蛋黄焗贝贝南瓜', 36], ['猛火啫大肠', 49], ['猛火啫靓鱼扣', 56], ['广式牛杂煲', 58]],
    '蔬菜': [['猪油渣炒菜心', 29], ['瑶柱金蒜蒸胜瓜', 35], ['豆豉鲮鱼炒油麦菜', 35], ['铁板姜汁芥兰吊龙', 42]],
    '主食': [['碎碎蛋爆炒米粉', 26], ['老广干炒牛河', 29]],
    '饮品': [['清甜茅根竹蔗', 15], ['爆打柠檬茶', 19]] };
  { const L = briefs(); let ch = false; L.forEach(b => { if (!b.menu && /YES|也是大排档/.test((b.brand || '') + b.storeTitle)) { b.menu = YES_MENU; b.dishes = { '海鲜': ['秘汁捞花甲', '蒜巴掌大生蚝', '椒盐皮皮虾', '台式胡椒花螺', '金不换炒海瓜子', '咸蛋黄鸡翅虾'], '小炒': ['椒盐玉米', '反沙凤梨', '椒盐鸭下巴', '黑椒雪花牛肉粒', '避风塘鸡中翅', '猛火啫大肠'], '主食': ['海胆炒饭2.0', '碎碎蛋爆炒米粉', '老广干炒牛河', '青虾粥'], '饮品': ['爆打柠檬茶', '清甜茅根竹蔗'] }; b.facts = String(b.facts || '').replace(/；?爆膏奶油虾用的是罗氏虾（不是龙虾）/, '') + '；爆膏奶油虾 99 元，用的是罗氏虾（不能写成龙虾）；这家店没有上必吃榜/宝藏榜（那是水东街店、华强北店的），不能写上榜'; ch = true; } }); if (ch) wj(BF, L); }
  { if (!META.seed5) { try { const S5 = require('./glseed5'); const L = briefs(), ST0 = stores(); let i = 0; const b1 = L.find(x => x.id === 'b1') || {};
      S5.stores.forEach(st => { if (!ST0.some(x => x.id === st.id || x.name === st.name)) ST0.push(Object.assign({ slot: '', star: '', years: '' }, st)); });
      S5.pool.forEach(sh => { if (!ST0.some(x => x.name === sh.name)) ST0.push(Object.assign({ id: 'sp' + Date.now().toString(36) + (i++), planted: false, slot: '', price: '', star: '', years: '', hours: '', addr: '', src: '自家内容库', verify: true }, sh)); });
      S5.briefs.forEach(b => { if (!L.some(x => x.id === b.id || x.store === b.store)) L.push(Object.assign({}, b, { menu: YES_MENU, dishes: b1.dishes || {} })); });
      wj(SF, ST0); wj(BF, L); META.seed5 = Date.now(); saveMeta(); log(`[攻略平台] 新建 ${S5.briefs.length} 份门店任务书，门店池补 ${S5.pool.length} 家周边店（待核对）`); } catch (e) { log('[攻略平台] 建门店任务书出错：' + e.message); } } }
  const menuText = B => B.menu ? Object.entries(B.menu).map(([c, l]) => `${c}：${l.map(([n, pz]) => `${n}${pz}`).join('、')}`).join('；') : '';

  // ---------- AI 复审（林总 2026-11-27）：写完交给另一个模型当审稿员挑错并改一版；改完程序再核一遍，错更少才采用，改前改后都留着给人看 ----------
  // 逐句替换：edits=[{old,new}]，只动字符串，不动店单结构/话题/状态
  function applyEdits(got, edits, nt) { const fixed = JSON.parse(JSON.stringify(got)); let hit = 0;
    const walk = (o, k) => { const v = o[k]; if (typeof v === 'string') { let t = v; edits.forEach(e => { if (t.includes(e.old)) { t = t.split(e.old).join(e.new); hit++; } }); o[k] = t.replace(/[，,]{2,}/g, '，').replace(/^[，,]\s*/, ''); } else if (v && typeof v === 'object') Object.keys(v).forEach(x => walk(v, x)); };
    Object.keys(fixed).filter(k => !['tags', 'id', 'no', 'status', 'aiReview', 'check', 'notes', 'plan', 'tpl', 'revs', 'images'].includes(k)).forEach(k => walk(fixed, k)); if (nt) fixed.title = nt; return { fixed, hit }; }
  // ---------- 审稿员写意见 → AI 按意见改（林总 2026-11-27：员工直接在上面填哪里要改，AI 自动改好返回，不用都经过我）----------
  const revising = new Set();
  // 服务器更新会打断正在改的稿：启动时把卡住的「正在改」清掉，留一句话让人再点一次
  setTimeout(() => { try { batches().forEach(b => { let ch = false; b.notes.forEach(n => { if (n.revising) { delete n.revising; n.notes.push({ t: '🤖 AI 改稿被系统更新打断了，请再点一次「要改」', who: 'AI', at: Date.now() }); ch = true; } }); if (ch) wj(path.join(BD, b.id + '.json'), b); }); } catch (e) { } }, 20e3);
  // 审稿人可以要求「加几条」：只允许往这些列表后面加，形状固定（不让加新店、新菜）
  const ADDF = { tips: null, route: ['t', 'place', 'do', 'tip'], spots: ['place', 'tip'], good: ['place', 'why'], skip: ['place', 'why'], streets: ['place', 'why'], navs: ['place', 'why', 'nav', 'tip'], stay: ['area', 'why', 'fit'], traffic: ['how', 'detail'] };
  function applyAdds(n, adds) { let cnt = 0; (Array.isArray(adds) ? adds : []).slice(0, 4).forEach(a => { const f = String((a && a.field) || ''); if (!(f in ADDF) || !Array.isArray(a.items)) return; const keys = ADDF[f]; const arr = Array.isArray(n[f]) ? n[f] : (n[f] = []);
      a.items.slice(0, 10).forEach(it => { if (arr.length >= 18) return; let v; if (!keys) { v = String(typeof it === 'string' ? it : (it && (it.text || it.tip)) || '').trim().slice(0, 70); if (!v || arr.includes(v)) return; } else { if (!it || typeof it !== 'object') return; v = {}; keys.forEach(k => { v[k] = String(it[k] || '').trim().slice(0, 60); }); if (!v[keys[0]] && !v[keys[1]]) return; } arr.push(v); cnt++; }); }); return cnt; }
  async function aiRevise(bid, no, ask, who, pg) {
    const key = bid + ':' + no; if (revising.has(key)) return; revising.add(key);
    const f = path.join(BD, bid + '.json'); const setN = fn => { const b = getBatch(bid); const n = b && b.notes.find(x => x.no === +no); if (n) { fn(n, b); wj(f, b); } return n; };
    setN(n => { n.revising = { ask, who, at: Date.now() }; });
    try {
      const b0 = getBatch(bid); const n0 = b0.notes.find(x => x.no === +no); const B = briefs().find(x => x.id === b0.brief) || {};
      const pick = n => ({ title: n.title, cover: n.cover, body: n.body, sections: (n.sections || []).map(sc => ({ h: sc.h, items: sc.items.map(i => ({ shop: i.name, say: i.main ? undefined : i.say })) })), route: n.route, stay: n.stay, traffic: n.traffic, spots: n.spots, tips: n.tips, yes: n.yes, good: n.good, skip: n.skip, intro: n.intro, tagline: n.tagline, coverSub: n.coverSub, tags: n.tags });
      const PG = pg && Array.isArray(pg.pages) ? pg.pages.map(t => String(t || '').slice(0, 600)).slice(0, 14) : []; const pno = pg && +pg.page > 0 ? +pg.page : 0;
      const pgTxt = PG.length ? `【每一页图上的字（审稿人说「图5／第5张／第5页」就是下面的第 5 页；一行是图上的一段，长句会被拆成几行）】\n${PG.map((t, i) => `—— 第 ${i + 1} 页 ——\n${t}`).join('\n')}\n` : '';
      const prompt = `你是这篇小红书攻略的作者。审稿同事看完提了修改意见，请按意见改。
【审稿意见（${who}）】${ask}
${pno ? `【审稿人是点开第 ${pno} 页的图提的意见】意见里的「这里／这张图／这一页」都指第 ${pno} 页，只改这一页上的内容。\n` : ''}${pgTxt}【门店事实（以这个为准）】${B.storeTitle || ''}｜${B.address || ''}｜营业${B.hours || ''}｜人均${B.price || ''}｜${B.facts || ''}
【菜单（菜名价格只能用这些）】${B.menu ? menuText(B) : ''}
【规矩】只改意见说到的地方，其他一个字都别动；意见里关于字号、字体、颜色、图片位置的部分不归你管（另有人处理），没有文字要改就 edits 留空、reply 写「文字不用改」。审稿人没让你加内容，就不要自己为了「排满」去加长文字；审稿人明确说要「加几条／多写点／补充／太空了加点内容」，就照他说的条数加（没说条数加 3 条），用 adds 加在那一页对应的列表后面。新加的内容只写稳妥、通用、肯定不会错的（怎么排队、什么时候去、带什么、怎么避坑），不写具体票价、车次线路号、营业时间、电话，不和已有的重复，口吻和长度跟原来那几条一样；不加新店、新菜、新景点、新营业时间；正文里「${B.storeTitle || 'YES也是大排档'}」的全称要保留；封面和标题不能有店名；不用套话（${CLICHE.join('、')}）。意见里要你删的就删（new 写空）。
改的方式：不要重写整篇，只给「把哪句原话换成什么」。old 必须是原稿里一字不差能找到的一段，new 是换掉后的话。意见要改标题才给 title（≤20 字）；意见要改话题才给 tags（完整的新话题列表，8–10 个，要有 #YES也是大排档）。
要加内容时用 adds：field 只能是这几个之一，items 的样子要和原稿里那一项一模一样——tips（每项是一句话）、route（{"t":"时间","place":"","do":"","tip":""}）、spots（{"place":"","tip":""}）、good／skip／streets（{"place":"","why":""}）、navs（{"place":"","why":"","nav":"","tip":""}）、stay（{"area":"","why":"","fit":""}）、traffic（{"how":"","detail":""}）。先看那一页图上的字对应原稿的哪个字段，再往那个字段加。要删掉列表里的某一条：edits 里 old 写那一条的原话、new 写空。
只输出 JSON：{"edits":[{"old":"","new":""}],"adds":[{"field":"tips","items":[]}],"title":"","tags":[],"reply":"一句话告诉审稿同事改了什么（加了几条、改了哪句），≤40字；要是没法改，说清为什么、请他怎么写"}
原稿：
${JSON.stringify(pick(n0)).slice(0, 9000)}`;
      const r = await llm(prompt); const J0 = parseJ(r.text);
      const edits = (Array.isArray(J0.edits) ? J0.edits : []).map(e => ({ old: String((e && e.old) || ''), new: String((e && e.new) || '') })).filter(e => e.old.length >= 2 && e.old !== e.new && !(/YES也是大排档/i.test(e.old) && !/YES也是大排档/i.test(e.new) && !/删|去掉|不要/.test(ask))).slice(0, 20);
      let nt = J0.title && String(J0.title).trim() !== n0.title ? String(J0.title).trim().slice(0, 24) : ''; if (nt && brandRe(B.storeTitle ? B : { storeTitle: 'YES也是大排档', brand: [] }).test(nt)) nt = '';
      const tags = Array.isArray(J0.tags) && J0.tags.length >= 5 ? J0.tags.map(t => '#' + String(t).trim().replace(/^#/, '')).filter(t => t.length > 1).slice(0, 10) : null;
      const { fixed, hit: hit0 } = applyEdits(n0, edits, nt); const added = applyAdds(fixed, J0.adds); const hit = hit0 + added;
      // 删空的那几条从列表里拿掉
      Object.keys(ADDF).forEach(k => { if (Array.isArray(fixed[k])) fixed[k] = fixed[k].filter(v => typeof v === 'string' ? v.trim() : v && Object.values(v).some(x => String(x || '').trim())); });
      setN((n, b) => { const before = { title: n.title, body: n.body, tags: n.tags };
        const changed = hit || nt || tags; if (changed) { ['title', 'cover', 'body', 'sections', 'route', 'stay', 'traffic', 'spots', 'tips', 'yes', 'good', 'skip', 'streets', 'navs', 'intro', 'tagline', 'coverSub', 'ending'].forEach(k => { if (fixed[k] !== undefined) n[k] = fixed[k]; }); if (tags) { if (!tags.includes('#YES也是大排档')) tags.unshift('#YES也是大排档'); n.tags = tags.slice(0, 10); } n.edited = { who: 'AI（按' + who + '的意见）', at: Date.now() }; }
        n.revs = (n.revs || []).concat([{ ask, who, at: Date.now(), ok: !!changed, n: hit + (nt ? 1 : 0) + (tags ? 1 : 0), reply: String(J0.reply || '').slice(0, 80), before }]).slice(-10);
        n.status = changed ? 'todo' : n.status; n.notes.push({ t: changed ? `🤖 AI 已按意见改好（${String(J0.reply || '改了 ' + hit + ' 处').slice(0, 60)}），请再看一眼` : LAYRE.test(ask) ? '🤖 文字不用改（排版方面的意见已转到「提需求」）' : `🤖 AI 这次没改动：${String(J0.reply || '').trim().slice(0, 70) || '没找到意见说的地方'}。可以点上面那一页的图，在图旁边直接写这一页要改什么`, who: 'AI', at: Date.now() });
        if (b.kind !== 'manual' && B.storeTitle) { try { n.check = check(n, B, b); } catch (e) { } } delete n.revising; });
    } catch (e) { setN(n => { delete n.revising; n.notes.push({ t: '🤖 AI 改稿出错：' + e.message.slice(0, 60) + '，请稍后再点一次「要改」', who: 'AI', at: Date.now() }); }); log('[攻略平台] AI 按意见改稿出错：' + e.message); }
    finally { revising.delete(key); }
  }
  async function aiReview(got, B, pool, main, batch, plan) {
    const pick = n => ({ title: n.title, cover: n.cover, body: n.body, ending: n.ending, tags: n.tags, sections: n.sections.map(sc => ({ h: sc.h, items: sc.items.filter(i => !i.main).map(i => ({ shop: i.name, say: i.say })) })), route: n.route, spots: n.spots, yes: n.yes, stay: n.stay, traffic: n.traffic, tips: n.tips, navs: n.navs, good: n.good, skip: n.skip });
    const shops = pool.map(sh => `${sh.name}｜${sh.area}${sh.far ? '｜离主店远（要坐车）' : '｜主店附近'}｜营业${sh.hours || '不详'}`).join('\n');
    const prompt = `你是小红书攻略的审稿编辑，专门挑会被本地人挑错、会被平台判成广告或 AI 文的地方。下面是一篇刚写好的稿子（JSON），请逐项检查，然后指出要改的句子。
【门店事实（以这个为准）】${B.storeTitle}｜${B.address}｜营业${B.hours}｜人均${B.price}｜${B.facts || ''}
【菜单（菜名价格只能用这些）】${menuText(B) || ''}
【可用的周边店（店名、位置、营业时间以这个为准）】
${shops}
【同一批别的篇已经用过的标题】${batch.notes.map(x => x.title).join('；') || '无'}
【程序已经查出来的硬伤（必须改掉）】${check(got, B, batch).filter(c => c[0] === 'err').map(c => c[1]).join('；') || '无'}
【这些不算问题，别改】话题里的 ${B.tagsMust.join(' ')} 是固定话题；正文和清单里写「${B.storeTitle}」全称是对的、必须保留（只是封面和标题不能有），别把它改成「那家排档」；周边店营业时间写「不详」的照常可以写，只是不写具体几点；sections 里没有主店是对的（程序会自己放进去）。
【标题】程序已经查过标题（地点词、需求词、长度、店名、重复）。上面「硬伤」里没提标题，就说明标题合格，不要给 title、也不要把标题列进 problems；口语化、带标点表情的标题是故意学的爆款句式。
【要检查的】
1. 事实：地址、地铁口、营业时间、价格、菜名和上面对不上的；把罗氏虾写成龙虾的；说上了什么榜但事实里没写的。
2. 地理和时间：路线来回折返；「离主店远」的店被写成步行顺路；排的时间不在店的营业时间里；正文和清单里的店对不上。
3. 不像真人：套话（嘬手指、不踩雷、天花板、封神、绝绝子、救命、谁懂啊等）、排比堆砌、每段一个格式、太书面；编造的亲身经历细节（刚好碰上、土著朋友甩来）；正文里提主店超过 2 次或写「见图片」。
4. 规则：标题 ≤20 字要有地点词和需求词；封面和标题不能有店名/大排档；禁用词：${(B.banned || []).join('、')}。
5. 同批重复：标题、开头和别的篇太像。
改的方式：edits 只用来改硬伤——禁用词、上面列的套话词、「见图片」、说上榜、把虾写成龙虾。old 是原稿里一字不差、带着那个词的一小段（≤40 字），new 只把那个词换掉或删掉，其余字不动。口吻、文风、开头结尾、「去了几次」这类说法、你觉得不够好的句子，一律不要改写（这些稿子是故意写得口语、像真人随手记的，润色会让它更像 AI）；这类意见和事实疑点只写进 problems，由人来判断。标题有问题才给 title（≤20 字，必须有地点词，且含 吃/美食/夜宵/攻略/逛/玩/清单/推荐/去哪 其中一个）。problems 只写你有把握的真问题，没问题就写空数组、edits 也空。
只输出 JSON：{"problems":[{"level":"err 或 warn","where":"title/body/route/…","text":"问题，≤40字"}],"title":"新标题，没问题就不写","edits":[{"old":"原稿里的原话","new":"换成的话"}]}
原稿：
${JSON.stringify(pick(got)).slice(0, 9000)}`;
    const r = await llm(prompt, cfg.glReviewModels || ['qwen-max', 'deepseek-v4.1-flash', 'qwen-plus']); const J0 = parseJ(r.text);
    const problems = (J0.problems || []).slice(0, 20).map(x => ({ level: x.level === 'err' ? 'err' : 'warn', where: String(x.where || '').slice(0, 16), text: String(x.text || '').slice(0, 80) })).filter(x => x.text);
    const out = { model: r.model, problems, adopted: false, at: Date.now() };
    // 只按「原话→新话」逐处替换，其余字段（店单、路线、景点、话题）原样保留，改不坏结构
    const allEdits = (Array.isArray(J0.edits) ? J0.edits : []).map(e => ({ old: String((e && e.old) || ''), new: String((e && e.new) || '') })).filter(e => e.old.length >= 2 && e.old !== e.new && !(/YES也是大排档/i.test(e.old) && !/YES也是大排档/i.test(e.new))).slice(0, 12);
    // 11-28 自查：审稿员爱「润色」，把「五点开门就排队，必冲」改成「非常推荐」、把开头的钩子改成「有很多美食，推荐大家试试」，越改越像 AI。
    // 所以只自动改硬伤（禁用词、套话清单里的词、见图片、上榜、龙虾），而且只许小改；别的意见照样列出来给人看，由人决定。
    const hardRe = new RegExp([...(B.banned || []), ...CLICHE, '见图', '看图片', '主店部分', '必吃榜', '宝藏榜', '上榜', '龙虾'].filter(Boolean).map(reEsc).join('|'));
    const edits = allEdits.filter(e => hardRe.test(e.old) && e.old.length <= 60 && e.new.length <= e.old.length + 8); out.skipped = allEdits.length - edits.length; // 正文里的全称要留着（林总：关键词要完整的 YES也是大排档）
    let nt = J0.title && String(J0.title).trim() !== got.title ? String(J0.title).trim().slice(0, 24) : ''; if (nt && (CLICHE.some(w => nt.includes(w)) || brandRe(B).test(nt) || /不踩雷|避雷|闭眼/.test(nt))) nt = '';
    if (nt && !check(got, B, batch).some(c => /标题/.test(c[1]))) { nt = ''; out.titleKept = true; } // 程序没查出标题有毛病就不让审稿员换标题：它爱把学来的爆款句式改成「XX美食推荐清单」这种平的
    if (edits.length || nt) {
      const fixed = JSON.parse(JSON.stringify(got)); let hit = 0;
      const walk = (o, k) => { const v = o[k]; if (typeof v === 'string') { let t = v; edits.forEach(e => { if (t.includes(e.old)) { t = t.split(e.old).join(e.new); hit++; } }); o[k] = t.replace(/[，,]{2,}/g, '，').replace(/^[，,]\s*/, ''); } else if (v && typeof v === 'object') Object.keys(v).forEach(x => walk(v, x)); };
      Object.keys(fixed).filter(k => !['tags', 'id', 'no', 'status', 'aiReview', 'check', 'notes', 'plan', 'tpl'].includes(k)).forEach(k => walk(fixed, k));
      if (nt) fixed.title = nt;
      const bx = Object.assign({}, batch, { notes: batch.notes.filter(o => o !== got && o.no !== got.no) }); // 别拿原稿自己跟改后的比
      const errs = n => check(n, B, bx).filter(c => c[0] === 'err').length, warns = n => check(n, B, bx).filter(c => c[0] === 'warn').length;
      const better = errs(fixed) < errs(got) || (errs(fixed) === errs(got) && warns(fixed) <= warns(got));
      out.edits = edits.length; out.hit = hit;
      if (!hit && !nt) out.why = '审稿员给的原话在稿子里找不到，没改';
      else if ([...String(fixed.body)].length < [...String(got.body)].length * 0.6) out.why = '改后的正文砍得太多，没采用';
      else if (better) { out.adopted = true; out.before = { title: got.title, body: got.body }; return { note: fixed, review: out }; }
      if (!out.why) { out.why = '改完的版本问题没变少，没采用'; out.fixedCheck = check(fixed, B, bx).map(c => c.join(':')).slice(0, 8); out.fixedTitle = fixed.title; }
    } else if (!problems.length) out.why = '没挑出问题';
    return { note: got, review: out };
  }
  // ---------- 每篇的变量由程序分配（林总 2026-11-27：重复率高的根子是输入一样、规则锁死骨架、没人管差异）----------
  const ANGLES = {
    list: ['纯清单', '按品类分组列店名，开头一两句纠结/求助口吻就够，正文短', [150, 230]],
    order: ['点单清单', '按店分段，写几个人去、点了什么、怎么点不浪费，像吃完回来记的账', [260, 380]],
    qa: ['问答式', '用 3–5 个读者真会问的问题当小标题（如「出来几点去不排队？」），每个问题下面直接给答案', [280, 420]],
    rank: ['红黑榜', '分「值得去 / 顺路打卡 / 不建议专程」三档，每档说清楚理由，敢说缺点', [300, 450]],
    nav: ['导航避坑', '列 4–6 个会走错、会白跑的点：只搜名字会导到哪、该导航到哪、几点去', [320, 480]],
    truth: ['大实话', '「去之前希望有人告诉我的几件事」，一条一个真实可用的提醒', [260, 400]],
    route: ['时间轴', '按一天的时间顺序写，几点到哪、做什么、在哪吃，路线不走回头路', [360, 550]]
  };
  const LAYOUT_ANGLE = { allcheck: ['list'], treat: ['list', 'order'], friends: ['list'], icloud: ['list'], chat: ['list'], helpme: ['qa'], tier: ['rank'], kraft: ['list'], table: ['list'], news: ['order'], mint: ['order'], greyblock: ['list'], thumbs: ['list'], bigarea: ['list'], clean: ['list', 'order'], green: ['rank', 'truth'], nav: ['nav'], memo: ['list', 'qa'], hand: ['qa', 'order'], star: ['rank', 'list'], route: ['route'] };
  const CLICHE = ['嘬手指', '舔', '鲜掉眉毛', '不踩雷', '天花板', '封神', '绝绝子', '救命', 'yyds', '闭眼冲', '前胸贴后背', '完美收官', '一绝', '无限回购', '谁懂啊'];
  function makePlans(n, B, layout, pool) {
    const recent = batches().filter(b => b.brief === B.id).slice(0, 6).flatMap(b => b.notes);
    const useOf = f => { const m = new Map(); recent.forEach(x => [].concat(f(x) || []).forEach(v => m.set(v, (m.get(v) || 0) + 1))); return m; };
    const angU = useOf(x => x.plan && x.plan.angle), tagU = useOf(x => x.tags), leadU = useOf(x => x.plan && x.plan.lead), shopU = useOf(x => x.sections && x.sections.flatMap(sc => sc.items.map(i => i.name)));
    const pref = LAYOUT_ANGLE[layout] || []; const angles = [...pref, ...Object.keys(ANGLES).filter(a => !pref.includes(a)).sort((a, c) => (angU.get(a) || 0) - (angU.get(c) || 0) || Math.random() - 0.5)];
    const dishes = [...new Set([B.mustDish, ...Object.entries(B.dishes || {}).filter(([c]) => !/饮|甜品|主食|酒|茶/.test(c)).flatMap(([, l]) => l)])].filter(Boolean).sort((a, c) => (leadU.get(a) || 0) - (leadU.get(c) || 0) || Math.random() - 0.5);
    const opt = (B.tagsOpt || []).filter(t => !(B.tagsMust || []).includes(t)); const nOpt = Math.max(2, Math.min(4, (B.tagsTotal || 9) - (B.tagsMust || []).length - 3));
    const plans = []; const usedTags = new Map();
    for (let k = 0; k < n; k++) {
      const angle = angles[k % angles.length]; const A = ANGLES[angle];
      const tags = opt.slice().sort((a, c) => (usedTags.get(a) || 0) - (usedTags.get(c) || 0) || (tagU.get(a) || 0) - (tagU.get(c) || 0) || Math.random() - 0.5).slice(0, nOpt); tags.forEach(t => usedTags.set(t, (usedTags.get(t) || 0) + 1));
      const near = pool.filter(sh => !sh.far), far = pool.filter(sh => sh.far).sort((a, c) => (shopU.get(a.name) || 0) - (shopU.get(c.name) || 0) || Math.random() - 0.5);
      // 附近的店多了以后（门店池补到 20 多家），每篇只给 15 家、按最近用得少的排、每篇错开 5 家，免得同一批每篇都写同样几家
      const nearS = near.slice().sort((a, c) => (shopU.get(a.name) || 0) - (shopU.get(c.name) || 0)); const nearK = nearS.length > 16 ? [...nearS.slice(k * 5 % nearS.length), ...nearS].filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 15) : nearS;
      const shops = [...nearK, ...far.slice(k * 3 % Math.max(1, far.length)), ...far].filter((v, i, arr) => arr.indexOf(v) === i).slice(0, Math.max(nearK.length, 10));
      plans.push({ angle, angleName: A[0], angleHow: A[1], len: A[2], lead: dishes[k % dishes.length], tags, aiTags: (B.tagsTotal || 9) - (B.tagsMust || []).length - tags.length, nextDay: k === 0 && Math.random() < 0.5, shops: shops.map(sh => sh.name) });
    }
    return plans;
  }
  function promptFor(B, layout, dir, pool, spots, prev, k, tpl, plan) {
    const P = plan || {}; const dishes = Object.entries(B.dishes).map(([c, l]) => `${c}：${l.join('、')}`).join('；');
    const shops = P.shops ? pool.filter(sh => P.shops.includes(sh.name)) : pool;
    const shopLines = shops.map(sh => `- ${sh.name}｜${sh.area}${sh.far ? '｜离主店远（坐地铁才到，只能写成另找时间去，不能写成步行顺路）' : '｜主店附近'}｜${sh.cat}｜人均${sh.price}｜营业${sh.hours}｜招牌：${sh.dishes}`).join('\n');
    const L = LAYOUTS[layout]; const ref = refs().slice().sort(() => Math.random() - 0.5)[0];
    return `你是小红书本地生活博主，写一篇「${dir.name}」方向的图文攻略（顺带推荐${B.city || '深圳'}一家${B.storeType || '海鲜大排档'}），要像真实游客或本地人自己整理的，不能像广告。版式「${L.name}」只决定图怎么排，你只写文字。
【读者】${B.audience}
【这篇的写法（程序已定，必须照做）】
- 角度：${P.angleName || '自选'}——${P.angleHow || ''}；正文 ${P.len ? P.len[0] + '–' + P.len[1] : '300–500'} 字。
${tpl ? `- 学这篇真实爆款的标题句式和开头口吻（套路「${tpl.sub}」）：《${tpl.title}》 ${tpl.text.replace(/\s+/g, ' ').slice(0, 260)}\n  只学句式和口吻，城市、店、原句都不能照搬，不借它的榜单名义和数字。\n` : ''}- 菜名、价格只能用菜单上的（不能编菜名）：${menuText(B) || dishes}
- 主店这篇主推「${P.lead || B.mustDish}」，yes.dishes 第一道写它${P.lead && P.lead !== B.mustDish ? `；「${B.mustDish}」也要写，放后面` : ''}，再从菜单里挑 1–2 道。菜单：${dishes}
- ${P.nextDay ? '可以有 1 个「第二天早餐」分类。' : '不要写「第二天早餐」。'}
${B.facts ? `【固定事实，原样写，不能改】${B.facts}\n` : ''}【规则】
1. 标题 ≤20 字，有地点词＋需求词（${B.titleRule}），往「${dir.words.join('」「')}」靠。封面和标题不能出现店名、品牌名、「大排档」。
2. 主店「${B.storeTitle}」程序会单独放成「${B.mainCat || '晚饭·' + (B.storeType || '海鲜大排档')}」排第 2 家，sections 里不要写它；正文里提它时用一句具体的话（菜＋什么时候去），不能写「见图片」这种话，全文提主店不超过 2 次。
3. sections 只用下面列的店（店名照抄）：第一类叫「中午垫一口」放 1 家粉面/小吃，后面 2–3 类按真实品类分（不同品类别混一起），共 ${L.list ? '8–14' : '6–9'} 家，每家 say 写 18–30 字招牌菜＋口感。正文里提到的店也要写全名。
4. route 7–9 站，时间要在各店营业时间内，按地理顺序走不折返，「离主店远」的店不能进同一天步行路线；spots 必须有 ${(B.mustSpots || []).join('、') || '1 个景点'}，可再加：${B.optSpots.join('、')}。
5. 只写常识性、不会错的信息：不写门票价格、开放时间、具体门/出口编号（固定事实里给的除外），不编亲身经历细节（「刚好碰上」「土著朋友甩来」这类别写）；不写哪家店搬走了、关门了、被清退了、导航会带错到哪里这种你没法确定的事。
6. 不用这些词：${[...B.banned, ...CLICHE].join('、')}；也不说「无广」「自费」「不是广告」。分条内容每段 4–6 条。
7. tags 只写 ${P.aiTags || 3} 个跟这篇内容贴的（地点、景点、菜名、场景，如 #白石洲夜宵 #生腌），不带别家店名品牌名；固定话题 ${[...B.tagsMust, ...(P.tags || [])].join(' ')} 程序会加，你不要重复写。
8. cover 2 行（导航避坑可 3–4 行），每行 ≤9 字，像随手记的一句话。
9. 同一批前面写过的标题和结尾不能再用：${prev.length ? prev.map(p => `《${p.title}》「${p.ending}」`).join('；') : '无'}
${ref ? `【我们以前发过的一篇（只学信息密度和 emoji 小标题，不抄）】\n${String(ref.text).slice(0, 700)}\n` : ''}【主店（程序照抄）】${B.storeTitle}｜${B.address}｜人均${B.price}｜${B.hours}
【可用的店】
${shopLines}
【景点】${spots.join('、')}
只输出 JSON：
{"title":"","cover":["",""],"body":"","ending":"正文最后一句","tags":["#"],
"sections":[{"h":"分类名","items":[{"shop":"店名","say":"","stars":4}]}],
"route":[{"t":"10:00","place":"","do":"≤16字","tip":"≤24字"}],
"stay":[{"area":"住宿区域（不写酒店名和价格），写 2–3 个不同区域","why":"≤36字","fit":"≤14字"}],"traffic":[{"how":"3–4 条：从高铁站/机场/口岸过来、市内怎么走、晚上怎么回，如 从深圳北站过来","detail":"≤45字，只写确定的线路站名，不写票价"}],
"spots":[{"place":"","tip":"≤24字"}],
"yes":{"dishes":[{"name":"","line":"≤22字口感/吃法"}],"order":["2人：…","4人：…"],"when":"","fit":"","blurb":"≤70字，像朋友安利，写 2–3 道菜的口感"},
"coverSub":"≤14字","intro":["60–100字","40–70字"],"tagline":"≤16字",
"good":[{"place":"","why":"≤26字"}],"skip":[{"place":"","why":"≤26字真实原因"}],"streets":[{"place":"","why":"≤22字"}],
"tips":["6–8 条，每条 ≤40 字"],
"navs":[{"place":"","why":"≤40字","nav":"≤40字，拿不准就写到正门/游客中心","tip":"≤30字"}]}`;
  }

  function check(n, B, batch) {
    const out = []; const allText = [n.title, n.body, ...(n.cover || []), ...n.sections.flatMap(s => s.items.map(i => i.say)), ...(n.yes.dishes || []).map(d => d.line), ...(n.yes.order || []), n.yes.when, n.yes.fit, ...(n.spots || []).map(s => s.tip), n.yes.blurb, ...(n.intro || []), n.tagline, ...(n.tips || []), ...(n.navs || []).map(v => v.why + v.nav + v.tip), ...['good', 'skip', 'streets'].flatMap(k => (n[k] || []).map(x => x.place + x.why)), ...(n.route || []).map(r => r.do + (r.tip || '')), ...(n.stay || []).map(x => x.area + x.why + x.fit), ...(n.traffic || []).map(x => x.how + x.detail)].join('\n');
    B.banned.forEach(w => { if (allText.includes(w)) out.push(['err', `出现禁用词「${w}」`]); });
    if (!new RegExp(placeWordsOf(B).map(reEsc).join('|')).test(n.title)) out.push(['err', '标题没有地点词']);
    if (n.stay !== undefined && (!(n.route || []).length || !(n.traffic || []).length || !(n.stay || []).length)) out.push(['warn', '行程/住宿/交通有缺，图会少几页']);
    if ((n.traffic || []).length || (n.stay || []).length) out.push(['warn', '住宿、交通的线路站名请人工核对一遍']);
    if (!/(吃|美食|夜宵|攻略|一日游|逛|玩|清单|推荐|去哪)/.test(n.title)) out.push(['err', '标题没有需求词']);
    if ([...n.title].length > 22) out.push(['warn', `标题 ${[...n.title].length} 字，偏长`]);
    if ((n.navs || []).length && batch.layout === 'nav') out.push(['warn', '导航入口（门、出口、方向）是 AI 写的，发布前要人工核实']);
    if ((n.cover || []).some(l => brandRe(B).test(l))) out.push(['err', '封面出现店名，像广告']);
    if (brandRe(B).test(n.title)) out.push(['warn', '标题出现店名，像广告']);
    if ((n.sections[1] || {}).items && !(n.sections[1].items.length === 1 && n.sections[1].items[0].main)) out.push(['warn', '主店没有单独成一个分类']);
    const flat = n.sections.flatMap(s => s.items); if (!flat[1] || !flat[1].main) out.push(['err', '主店不在清单第 2 位']);
    const dn = (n.yes.dishes || []).map(d => d.name); if (!dn.includes(B.mustDish)) out.push(['err', `主店介绍缺「${B.mustDish}」`]);
    if (dn.length < B.minDishes) out.push(['err', `主店菜品只有 ${dn.length} 道（至少 ${B.minDishes} 道）`]);
    const okD = new Set([B.mustDish, ...Object.values(B.dishes).flat()]); dn.filter(d => !okD.has(d)).forEach(d => out.push(['err', `「${d}」不在主店可写的菜单里`]));
    (B.mustSpots || []).forEach(sp => { if (!(n.spots || []).some(s => String(s.place).includes(sp)) && !(n.route || []).some(r => String(r.place).includes(sp))) out.push(['err', `没写${sp}`]); });
    B.tagsMust.forEach(t => { if (!n.tags.includes(t)) out.push(['err', `缺话题 ${t}`]); });
    if (B.tagsTotal ? n.tags.length < 8 || n.tags.length > 10 : n.tags.filter(t => B.tagsOpt.includes(t)).length !== B.tagsOptN) out.push(['warn', B.tagsTotal ? `话题 ${n.tags.length} 个，应 8–10 个` : `可选话题应选 ${B.tagsOptN} 个`]);
    (n.dropped || []).forEach(s => out.push(['warn', `「${s}」不在门店池，已去掉`]));
    if (flat.length < 5) out.push(['warn', `清单只有 ${flat.length} 家店`]);
    const bl = [...String(n.body || '')].length; if (bl < 120 || bl > 750) out.push(['warn', `正文 ${bl} 字`]);
    const yesMentions = (String(n.body).match(new RegExp(brandWordsOf(B).filter(w => w !== '大排档').map(reEsc).join('|') || 'YES', 'gi')) || []).length; if (yesMentions > 3) out.push(['warn', `正文提主店 ${yesMentions} 次，像广告`]);
    const cl = CLICHE.filter(w => String(n.body).includes(w) || String(n.title).includes(w)); if (cl.length) out.push(['warn', `套话：${cl.join('、')}`]);
    if (/见图|看图片|主店部分/.test(String(n.body).slice(0, -40))) out.push(['err', '正文里写了「见图片」这类话']);
    if (/龙虾[^，。！\n]{0,6}(奶油|爆膏)|(奶油|爆膏)[^，。！\n]{0,6}龙虾/.test(allText)) out.push(['err', '把爆膏奶油虾写成了龙虾（用的是罗氏虾）']);
    if (/必吃榜|宝藏榜|上榜/.test(allText) && B.honors !== true) out.push(['err', '写了上榜（必吃榜/宝藏榜是水东街店、华强北店的，这家店没有）']);
    const fixed = new Set(B.tagsMust); batch.notes.forEach(o => { if (o === n) return; const ov = n.tags.filter(t => !fixed.has(t) && o.tags.includes(t)); if (ov.length > 3) out.push(['warn', `话题和第 ${o.no} 篇重了 ${ov.length} 个`]); });
    if (batch.notes.filter(o => o.sections.some(sc => /第二天/.test(sc.h))).length > 1 && n.sections.some(sc => /第二天/.test(sc.h))) out.push(['warn', '同批不止一篇写了第二天早餐']);
    batch.notes.forEach(o => { if (o !== n && o.ending && o.ending === n.ending) out.push(['err', '结尾和本批另一篇重复']); if (o !== n && o.title === n.title) out.push(['err', '标题和本批另一篇重复']); });
    return out;
  }
  // 主店单独成一个分类、排全篇第 2 家：第一个分类只留 1 家（中午垫一口），主店分类第二，第一类剩下的店按原分类名接在后面
  function regroup(secs, yes, yesH) {
    secs = secs.map(x => ({ h: x.h, items: x.items.filter(i => !i.main) })).filter(x => x.items.length);
    if (!secs.length) return [{ h: yesH, items: [yes] }];
    const f = secs[0]; const rest = f.items.slice(1);
    const out = [{ h: rest.length ? '中午垫一口' : f.h, items: [f.items[0]] }, { h: yesH, items: [yes] }];
    if (rest.length) { const same = secs.slice(1).find(x => x.h === f.h); if (same) same.items.unshift(...rest); else out.push({ h: f.h, items: rest }); }
    return out.concat(secs.slice(1));
  }
  function build(j, B, pool, main, plan) {
    j = Object.assign({}, j); const AR = ['cover', 'tags', 'sections', 'route', 'stay', 'traffic', 'spots', 'intro', 'good', 'skip', 'streets', 'tips', 'navs']; AR.forEach(k => { if (j[k] !== undefined && !Array.isArray(j[k])) j[k] = k === 'intro' || k === 'cover' || k === 'tips' ? [j[k]].filter(Boolean) : []; }); // 模型偶尔把数组写成字符串/对象
    if (j.yes && typeof j.yes === 'object') { j.yes = Object.assign({}, j.yes); ['dishes', 'order'].forEach(k => { if (j.yes[k] !== undefined && !Array.isArray(j.yes[k])) j.yes[k] = k === 'order' ? [String(j.yes[k])] : []; }); } else j.yes = {};
    const dropped = []; const used = new Set();
    const sections = (j.sections || []).map(s => ({ h: String(s.h || '').slice(0, 10), items: (s.items || []).map(it => { const sh = matchShop(it.shop, pool); if (!sh) { if (it.shop && !/YES|也是大排档/.test(it.shop)) dropped.push(it.shop); return null; } if (used.has(sh.id)) return null; used.add(sh.id); return { id: sh.id, name: sh.name, area: sh.area, price: sh.price, kind: sh.cat || '', say: String(it.say || '').slice(0, 40), stars: Math.max(3, Math.min(5, +it.stars || 4)) }; }).filter(Boolean) })).filter(s => s.items.length);
    if (!sections.length) sections.push({ h: '吃饭', items: [] });
    const yesItem = { id: main.id, name: main.name, area: main.area, price: B.price, kind: main.cat || B.storeType || '', say: `${B.mustDish}、猛火小炒`, stars: 5, main: true };
    const secs2 = regroup(sections.filter(s => s.items.length), yesItem, B.mainCat || '晚饭·' + (B.storeType || '海鲜大排档'));
    sections.length = 0; secs2.forEach(x => sections.push(x));
    const TT = B.tagsTotal || (B.tagsMust.length + B.tagsOptN); const shopNames = pool.map(x => x.name.replace(/[（(].*$/, '')).filter(x => x.length >= 2);
    const okTag = t => /^#[\u4e00-\u9fa5A-Za-z0-9]{2,14}$/.test(t) && !B.banned.some(w => t.includes(w)) && !shopNames.some(x => t.includes(x)) && !/广告|无广|自费/.test(t);
    const tags = [...B.tagsMust, ...((plan && plan.tags) || [])]; for (const t of (j.tags || []).map(t => '#' + String(t).trim().replace(/^#/, ''))) { if (tags.length >= TT) break; if (!tags.includes(t) && okTag(t)) tags.push(t); }
    for (const t of B.tagsOpt.slice().sort(() => Math.random() - 0.5)) { if (tags.length >= TT) break; if (!tags.includes(t)) tags.push(t); }
    const yes = j.yes || {}; const dishes = (yes.dishes || []).map(d => ({ name: String(d.name || '').trim(), line: String(d.line || '').slice(0, 40) })).filter(d => d.name);
    if (!dishes.some(d => d.name === B.mustDish)) dishes.unshift({ name: B.mustDish, line: '奶油香裹着虾膏，趁热先吃' });
    if (plan && plan.lead) { const i = dishes.findIndex(d => d.name === plan.lead); if (i > 0) dishes.unshift(dishes.splice(i, 1)[0]); }
    const full = /YES|也是大排档/i.test(B.brand || B.storeTitle || '') ? s0 => String(s0 || '').replace(/(?<!也是)(YES|Yes|yes)\s*!?\s*(也是)?\s*大排档/g, 'YES也是大排档') : s0 => String(s0 || '');
    j.body = full(j.body); j.ending = full(j.ending); if (j.yes && j.yes.blurb) j.yes.blurb = full(j.yes.blurb);
    return { title: String(j.title || '').trim(), cover: (j.cover || []).map(String).filter(l => !brandRe(B).test(l)).slice(0, 4), place: placeWordsOf(B).find(w => String(j.title || '').includes(w) && w !== (B.city || '深圳')) || B.district, city: B.city || '深圳', body: String(j.body || '').trim(), ending: String(j.ending || '').trim(), tags, sections, dropped,
      route: (j.route || []).slice(0, 10).map(r => ({ t: String(r.t || ''), place: String(r.place || ''), do: String(r.do || ''), tip: String(r.tip || '').slice(0, 40) })), stay: (j.stay || []).slice(0, 4).map(x => ({ area: String(x.area || '').slice(0, 16), why: String(x.why || '').slice(0, 60), fit: String(x.fit || '').slice(0, 20) })).filter(x => x.area), traffic: (j.traffic || []).slice(0, 6).map(x => ({ how: String(x.how || '').slice(0, 20), detail: String(x.detail || '').slice(0, 70) })).filter(x => x.how), spots: (j.spots || []).slice(0, 3).map(s => ({ place: String(s.place || ''), tip: String(s.tip || '') })),
      yes: { dishes: dishes.slice(0, 5), order: (yes.order || []).map(String).slice(0, 3), when: String(yes.when || ''), fit: String(yes.fit || ''), blurb: String(yes.blurb || '').slice(0, 120) },
      coverSub: String(j.coverSub || '').slice(0, 20), intro: (Array.isArray(j.intro) ? j.intro : [j.intro]).filter(Boolean).map(x => String(x).slice(0, 200)).slice(0, 2), tagline: String(j.tagline || '').slice(0, 24),
      good: (j.good || []).slice(0, 6).map(x => ({ place: String(x.place || ''), why: String(x.why || '').slice(0, 40) })).filter(x => x.place), skip: (j.skip || []).slice(0, 4).map(x => ({ place: String(x.place || ''), why: String(x.why || '').slice(0, 40) })).filter(x => x.place),
      streets: (j.streets || []).slice(0, 4).map(x => ({ place: String(x.place || ''), why: String(x.why || '').slice(0, 36) })).filter(x => x.place), tips: (j.tips || []).map(String).map(x => x.slice(0, 60)).slice(0, 12), navs: (j.navs || []).slice(0, 7).map(v => ({ place: String(v.place || '').slice(0, 16), why: String(v.why || '').slice(0, 60), nav: String(v.nav || '').slice(0, 60), tip: String(v.tip || '').slice(0, 40) })).filter(v => v.place), main: { name: B.storeTitle, address: B.address, price: B.price, hours: B.hours } };
  }
  function parseJ(t) { // 模型偶尔多一个逗号、少括号、输出被截断：先原样解析，不行就修一下再试
    const raw = String(t || '').replace(/```(json)?/g, ''); const i0 = raw.indexOf('{'); if (i0 < 0) throw new Error('没返回 JSON');
    const i1 = raw.lastIndexOf('}'); let s = i1 > i0 ? raw.slice(i0, i1 + 1) : raw.slice(i0);
    try { return JSON.parse(s); } catch (e) { }
    const fix = x => x.replace(/,\s*([\]}])/g, '$1').replace(/[“”]/g, '"').replace(/\}\s*\{/g, '},{').replace(/\]\s*\[/g, '],[');
    try { return JSON.parse(fix(s)); } catch (e) { }
    // 截断：从头扫一遍，补上没闭合的字符串和括号
    s = raw.slice(i0); let inStr = false, esc = false; const st = [];
    for (const ch of s) { if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; } if (ch === '"') inStr = true; else if (ch === '{' || ch === '[') st.push(ch); else if (ch === '}' || ch === ']') st.pop(); }
    if (inStr) s += '"'; s = s.replace(/[,:]\s*$/, '').replace(/([,{]\s*)"[^"]*"\s*$/, '$1').replace(/,\s*$/, '');
    while (st.length) s += st.pop() === '{' ? '}' : ']';
    return JSON.parse(fix(s));
  }
  // 门店实拍图库：每家店一个文件夹，最后一页实拍拼图从这里挑
  // ---------- 素材库实拍（林总 2026-11-27：最后一页拼图用素材库里的图）：飞书「原图素材库」→ 缩到长边 1440 存 photos/sc/N.jpg ----------
  const SCF = path.join(D, 'sucai.json'); let SC = rj(SCF, { items: [], at: 0 }); const SCD = path.join(PD, 'sc'); fs.mkdirSync(SCD, { recursive: true });
  const SC_OK = x => !/有字/.test(x.clean) && /封面候选|内页|环境门头|待定|^$/.test(x.use) && !/人物动作/.test(x.use);
  let scBusy = null;
  async function syncSucai(max) {
    if (!sucai) throw new Error('素材库没接上'); if (scBusy) return scBusy;
    scBusy = (async () => {
      const L = await sucai.list(); const have = new Map(SC.items.map(x => [x.rec, x])); let add = 0, fail = 0; let n = Math.max(0, ...SC.items.map(x => x.n || 0));
      let C = null; try { C = require('@napi-rs/canvas'); } catch (e) { }
      for (const r of L) {
        const o = have.get(r.rec); if (o) { Object.assign(o, { store: r.store, dish: r.dish, use: r.use, clean: r.clean }); continue; }
        if (!SC_OK(r) || add >= (max || 300)) continue;
        try { let buf = await sucai.dl(r.url); if (C) try { const im = await C.loadImage(buf); const k = Math.min(1, 1440 / Math.max(im.width, im.height)); const c = C.createCanvas(Math.round(im.width * k), Math.round(im.height * k)); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); buf = await c.encode('jpeg', 85); } catch (e) { }
          n++; fs.writeFileSync(path.join(SCD, n + '.jpg'), buf); SC.items.push({ rec: r.rec, n, store: r.store, dish: r.dish, use: r.use, clean: r.clean }); add++; } catch (e) { fail++; }
      }
      const live = new Set(L.map(r => r.rec)); SC.items = SC.items.filter(x => { if (live.has(x.rec)) return true; try { fs.unlinkSync(path.join(SCD, x.n + '.jpg')); } catch (e) { } return false; });
      SC.at = Date.now(); wj(SCF, SC); log(`[攻略平台] 素材库同步：新增 ${add} 张，失败 ${fail}，共 ${SC.items.length} 张`); return { ok: true, add, fail, total: SC.items.length };
    })().finally(() => { scBusy = null; });
    return scBusy;
  }
  if (sucai) { setTimeout(() => syncSucai().catch(e => log('[攻略平台] 素材库同步出错：' + e.message)), 90e3); setInterval(() => syncSucai().catch(e => log('[攻略平台] 素材库同步出错：' + e.message)), 6 * 3600e3); }
  // 某家店能用的素材：素材库里写了这家店的（含门头环境），加上没写门店的菜品图（各店出品一样）；按菜品错开，每篇拼图尽量不同的菜
  function sucaiFor(sid) {
    const st = stores().find(x => x.id === sid) || {}; const nm = String(st.name || '') + String(st.area || '');
    const mine = SC.items.filter(x => SC_OK(x) && (x.store ? (nm.includes(x.store) || x.store.split(/[\s、,，/]+/).some(k => k.length >= 2 && nm.includes(k))) : !/环境门头/.test(x.use)));
    const rnd = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
    const by = new Map(); mine.sort((a, b) => rnd(sid + a.rec) - rnd(sid + b.rec)).forEach(x => { const k = x.dish || ('_' + x.n); if (!by.has(k)) by.set(k, []); by.get(k).push(x); });
    const groups = [...by.values()]; const out = []; for (let i = 0; out.length < mine.length; i++) groups.forEach(g => { if (g[i]) out.push(g[i]); });
    const door = out.filter(x => /环境门头/.test(x.use)), food = out.filter(x => !/环境门头/.test(x.use));
    const res = []; let di = 0; food.forEach((x, i) => { if (i % 7 === 6 && door[di]) res.push(door[di++]); res.push(x); }); // 大约每两篇拼图里有一张门头
    return res.map(x => `sc/${x.n}.jpg`);
  }
  const photosOf = sid => { if (!/^[A-Za-z0-9_-]+$/.test(String(sid || ''))) return []; try { return fs.readdirSync(path.join(PD, sid)).filter(f => /^\d+\.jpg$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b)); } catch (e) { return []; } };
  const jobs = new Map();
  async function generate(briefId, layout, n, by) {
    const B = briefs().find(b => b.id === briefId); if (!B) throw new Error('没找到任务书'); if (!LAYOUTS[layout]) throw new Error('没有这个版式');
    const all = stores(); const main = all.find(s => s.id === B.store); if (!main) throw new Error('任务书的主店不在门店池');
    const pool = poolOf(B, all, main);
    const id = 'g' + Date.now().toString(36); const batch = { id, brief: B.id, briefName: B.name, layout, layoutName: LAYOUTS[layout].name, by, at: Date.now(), n, status: 'running', notes: [], err: '' };
    wj(path.join(BD, id + '.json'), batch); runBatch(batch);
    return batch;
  }
  // 出稿后的硬门槛（林总 2026-11-27：店太少图空空的、照抄范文原句、行程住宿交通空着）：不过就带着原因重写，最多 3 次
  function copiedFrom(tpl, n) { if (!tpl) return ''; const norm = t => String(t || '').replace(/[\s，。！？、～~｜|：:；;“”"'（）()【】\[\]…·\-—]+/g, ''); // 标题句式本来就是要学的（换城市换内容），只拦正文里整句照搬范文的：连着 12 个字一样才算
    const a = norm(String(tpl.title || '') + String(tpl.text || '')); if (a.length < 12) return ''; for (const seg of String(n.body || '').split(/[。！？\n]/)) { const b = norm(seg); for (let i = 0; i + 12 <= b.length; i++) { const w = b.slice(i, i + 12); if (a.includes(w)) return w; } } return ''; }
  function gate(n, tpl, layout, avail) { const bad = []; const others = n.sections.flatMap(sc => sc.items).filter(i => !i.main).length;
    const need = Math.max(3, Math.min((LAYOUTS[layout] || {}).list ? 8 : 5, (avail || 99) - 1)); // 清单类版式店少了一页都排不满；可用的店本来就少的门店不强求
    if (others < need) bad.push(`清单只写了 ${others} 家别的店，至少要 ${need + 1} 家（按品类分好）`);
    const cv = (n.cover || []).find(l => [...String(l)].length > 10); if (cv) bad.push(`封面「${cv}」太长，每行最多 9 个字`);
    if (layout !== 'list' && !(LAYOUTS[layout] || {}).list) { if ((n.route || []).length < 4) bad.push('route 行程至少 5 站'); if (!(n.stay || []).length) bad.push('stay 住宿建议没写'); if (!(n.traffic || []).length) bad.push('traffic 交通没写'); }
    const cp = copiedFrom(tpl, n); if (cp) bad.push(`照抄了范文原句「${cp}」，要用自己的话`);
    if (/搬走|已关门|关门了|倒闭|被清退|早已清退|拆了/.test(String(n.body))) bad.push('写了哪家店搬走/关门/被清退这种拿不准的事');
    return bad; }
  // 出稿在后台一篇篇跑；服务器重启（更新代码）打断的批次，启动后从断的那篇接着跑
  function runBatch(batch) {
    const B = briefs().find(b => b.id === batch.brief); const all = stores(); const main = B && all.find(s => s.id === B.store);
    const id = batch.id, n = batch.n, layout = batch.layout, f = path.join(BD, id + '.json');
    if (!B || !main) { batch.status = 'error'; batch.err = '任务书或主店不见了'; wj(f, batch); return; }
    const pool = poolOf(B, all, main);
    const save = () => { const d = rj(f, null); if (d && d.notes) d.notes.forEach(o => { const x = batch.notes.find(y => y.no === o.no); if (x) { x.status = o.status; x.notes = o.notes; } }); wj(f, batch); }; // 跑的过程中审稿标记不被覆盖
    jobs.set(id, true);
    (async () => {
      for (let k = (batch.k || 0) + 1; k <= n; k++) {
        const dir = B.directions[(k - 1) % B.directions.length];
        if (!batch.tpls) { try { batch.tpls = pickTpls(n, B, layout).map(t => t && { id: t.id, sub: t.sub, title: t.title, text: t.text, pages: t.pages || '', src: t.src }); } catch (e) { batch.tpls = []; } }
        const tpl = (batch.tpls || [])[k - 1];
        if (!batch.plans) { try { batch.plans = makePlans(n, B, layout, pool); } catch (e) { batch.plans = []; log('[攻略平台] 分配变量出错：' + e.message); } }
        const plan = (batch.plans || [])[k - 1];
        const shuffled = pool.slice().sort(() => Math.random() - 0.5);
        const spots = [...B.mustSpots, ...B.optSpots.slice().sort(() => Math.random() - 0.5).slice(0, 2)];
        let got = null, err = '', best = null, bestBad = 99;
        for (let t = 0; t < 3 && !got; t++) {
          try { const r = await llm(promptFor(B, layout, dir, shuffled, spots, batch.notes.map(x => ({ title: x.title, ending: x.ending })), k, tpl, plan) + (err && /^不合格/.test(err) ? `\n【上一次写的不合格，这次一定避开】${err.slice(4)}` : '')); const g = build(parseJ(r.text), B, pool, main, plan); g.model = r.model;
            const bad = gate(g, tpl, layout, plan && plan.shops ? plan.shops.length : pool.length); try { check(g, B, batch).filter(c => c[0] === 'err' && /标题/.test(c[1])).forEach(c => bad.push(c[1] + '（标题要有地点词，并且含 吃/美食/夜宵/攻略/逛/玩/清单/推荐/去哪 其中一个）')); } catch (e) { } if (!bad.length) got = g; else { err = '不合格：' + bad.join('；'); if (bad.length < bestBad) { best = g; bestBad = bad.length; } log(`[攻略平台] 第 ${k} 篇重写：${bad.join('；')}`); } }
          catch (e) { err = e.message; }
        }
        if (!got && best) { got = best; got.gateWarn = err; }
        batch.k = k;
        if (!got) { batch.err = `第 ${k} 篇失败：${err}`; log('[攻略平台] 出稿失败：' + err); save(); continue; }
        if (cfg.glReview !== false && B.aiReview !== false) { try { const rv = await aiReview(got, B, pool, main, batch, plan); const keepModel = got.model; got = rv.note; got.model = keepModel; got.aiReview = rv.review; } catch (e) { got.aiReview = { error: e.message.slice(0, 80), at: Date.now() }; } }
        got.no = k; got.dir = dir.name; if (plan) got.plan = { angle: plan.angle, angleName: plan.angleName, lead: plan.lead }; if (tpl) got.tpl = { sub: tpl.sub, title: tpl.title, id: tpl.id, src: tpl.src }; got.status = 'todo'; got.notes = []; batch.notes.push(got); got.check = check(got, B, batch);
        batch.notes.forEach(x => { x.check = check(x, B, batch); }); save();
      }
      batch.status = 'done'; batch.doneAt = Date.now(); save(); jobs.delete(id); log(`[攻略平台] 出稿完成：${B.name} ${batch.notes.length}/${n} 篇`);
    })().catch(e => { batch.status = 'error'; batch.err = e.message; save(); jobs.delete(id); });
  }
  setTimeout(() => { for (const b of batches()) { if (b.status !== 'running' || jobs.has(b.id)) continue; const full = rj(path.join(BD, b.id + '.json'), null); if (!full) continue; if (full.k === undefined) full.k = Math.max(0, ...(full.notes || []).map(x => x.no || 0)); log(`[攻略平台] 接着跑被重启打断的批次 ${b.id}（已出 ${full.notes.length}/${full.n}）`); runBatch(full); } }, 15e3);
  const batches = () => fs.readdirSync(BD).filter(x => x.endsWith('.json')).map(x => rj(path.join(BD, x), null)).filter(Boolean).sort((a, b) => b.at - a.at);
  const getBatch = id => /^g[0-9a-z]+$/.test(id) ? rj(path.join(BD, id + '.json'), null) : null;
  const LAYRE = /排版|版式|字号|字体|字.{0,4}(太大|太小|大一点|小一点|大小)|文字.{0,6}(大|小)|留白|空白|太空|排满|颜色|配色|背景|居中|对齐|间距|图片.{0,6}(位置|大小|出界|压)|封面图|拼图/;
  function mark(id, i, st, note, who, pg) {
    const f = path.join(BD, id + '.json'); const b = getBatch(id); if (!b) throw new Error('没有这个批次'); const n = b.notes.find(x => x.no === +i); if (!n) throw new Error('没有这一篇');
    if (st) { n.status = st; if (/ok/.test(st) && !n.okAt) n.okAt = Date.now(); } const pno = pg && +pg.page > 0 && +pg.page < 30 ? Math.floor(+pg.page) : 0; if (note) n.notes.push({ t: (pno ? `【第 ${pno} 页】` : '') + String(note).slice(0, 500), who, at: Date.now() }); wj(f, b);
    const revToday = (n.revs || []).filter(r => Date.now() - r.at < 24 * 3600e3).length; if (/fix/.test(st || '') && note && revToday >= 8) { n.notes.push({ t: '🤖 这篇今天已经让 AI 改了 8 次，先不自动改了，请直接点「改文案」手动改', who: 'AI', at: Date.now() }); wj(f, b); }
    // 排版、字号、留白、图片这类意见，AI 改稿管不了（它只会改字，11-28 有人提「第 2 张图不要留白、字小一点」，它去把文字加长了）→ 自动转进需求箱，每小时那一轮按版式改，改好对所有用这个版式的稿生效
    const isPic = /fix/.test(st || '') && note && /换.{0,6}(图|照片)|(图|照片).{0,8}(不全|不完整|不好看|模糊|不清|换|裁)/.test(String(note)); // 换图不用找 AI，自己挑
    if (isPic) { n.notes.push({ t: '🤖 想换图不用写给 AI：点这篇下面的「换配图」，从门店图库里自己挑，也可以直接粘贴图片（美食页 2 张、最后一页拼图 1–9 张），保存后马上重新出图。', who: 'AI', at: Date.now() }); wj(f, b); }
    const wantAdd = /增加|添加|补充|多写|再写|写多|加[上几一两三四五六七八九十多点\d]|补[上几一两点]|删掉|去掉/.test(String(note || '')); // 说了要加/删/改内容，就是文字的事，交给 AI 改
    const isLay = !isPic && !wantAdd && /fix/.test(st || '') && note && LAYRE.test(String(note));
    if (isLay) { try { const A = rj(AF, { items: [] }); const B0 = briefs().find(x => x.id === b.brief) || {}; A.items.push({ id: 'a' + Date.now().toString(36), text: `【审稿时提的排版意见】${B0.name || b.brief || ''} · 版式「${(LAYOUTS[b.layout] || {}).name || b.layout || '手工稿'}」（${b.layout || '-'}）· 第 ${n.no} 篇《${String(n.title).slice(0, 20)}》（批次 ${b.id}）：${String(note).slice(0, 400)}`, page: 'review', by: who, byId: '', role: 'review', at: Date.now(), status: 'todo' }); wj(AF, A);
      n.notes.push({ t: '🤖 这条里有排版/出图方面的意见（字号、留白、图片这些），AI 改稿只能改文字。字的大小、字体、颜色可以自己点这篇下面的「字号」「字体·颜色」马上改；其他排版问题已自动转到「提需求」，改好后所有用这个版式的稿都会跟着变。文字方面的意见照常改。', who: 'AI', at: Date.now() }); wj(f, b); } catch (e) { log('[攻略平台] 排版意见转需求箱出错：' + e.message); } }
    else if (false) { }
    if (/fix/.test(st || '') && note && revToday < 8 && String(note).replace(/【商家】/, '').trim().length >= 3 && cfg.glAutoRevise !== false) { n.revising = { ask: note, who, at: Date.now() }; aiRevise(id, n.no, String(note).replace(/^【商家】/, '').slice(0, 500), who, pg).catch(() => { }); }
    return n;
  }



  // ---------- 范文配图（林总 2026-11-27）：范文可以带原稿图片；通义看图写一句版式说明，AI 出稿时一起参考 ----------
  const RID = path.join(D, 'refimg'); fs.mkdirSync(RID, { recursive: true });
  const refImgFile = (id, f) => /^r[0-9a-z]+$/.test(id) && /^\d+\.jpg$/.test(f) ? path.join(RID, id, f) : null;
  function addRefImgs(r, imgs) { const dir = path.join(RID, r.id); fs.mkdirSync(dir, { recursive: true }); r.imgs = r.imgs || []; let n = Math.max(0, ...r.imgs.map(f => parseInt(f))); for (const d of (imgs || []).slice(0, 18)) { n++; fs.writeFileSync(path.join(dir, n + '.jpg'), jpg(d)); r.imgs.push(n + '.jpg'); } }
  let rq = Promise.resolve();
  function describeRef(id) { if (!vision) return; rq = rq.then(async () => { const L = refs(); const r = L.find(x => x.id === id); if (!r || !(r.imgs || []).length) return; const out = [];
    for (const f of r.imgs.slice(0, 12)) { try { const buf = fs.readFileSync(path.join(RID, id, f)); const t = await vision('这是一篇小红书文字攻略里的一张图。用一句话（≤50字）说清这页的版式：背景颜色/样式、标题怎么写、内容怎么排（清单/分组/编号/高亮/手写批注/拼图等）。只写版式，不写具体店名。', 'data:image/jpeg;base64,' + buf.toString('base64')); out.push(`P${parseInt(f)}：${String(t || '').replace(/\s+/g, ' ').slice(0, 80)}`); } catch (e) { } }
    const L2 = refs(); const r2 = L2.find(x => x.id === id); if (r2) { r2.imgDesc = out.join('\n'); wj(RF, L2); log(`[攻略平台] 范文「${r2.name}」看图写好版式说明 ${out.length} 张`); } }).catch(e => log('[攻略平台] 范文看图出错：' + e.message)); }
  // ---------- 写手投稿 / 派发卡片 / 发布回填（洛琳 2026-11-27） ----------
  const UPD = path.join(D, 'up'), CDD = path.join(D, 'cards'); [UPD, CDD].forEach(d => fs.mkdirSync(d, { recursive: true }));
  const bjDay = (t) => new Date((t || Date.now()) + 8 * 3600e3).toISOString().slice(0, 10);
  const jpg = d => { const buf = Buffer.from(String(d || '').replace(/^data:image\/jpeg;base64,/, ''), 'base64'); if (buf.length < 1000 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('只收 jpg 图片'); return buf; };
  const serveJpg = (res, f) => { if (!f || !fs.existsSync(f)) return send(res, 404, ''); const buf = fs.readFileSync(f); res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': buf.length, 'cache-control': 'private, max-age=86400' }); return res.end(buf); };
  const upFile = (bid, f) => /^g[0-9a-z]+$/.test(bid) && /^\d+\.jpg$/.test(f) ? path.join(UPD, bid, f) : null;
  const cardFile = (bid, no, f) => /^g[0-9a-z]+$/.test(bid) && /^\d+\.jpg$/.test(f) ? path.join(CDD, `${bid}-${+no}`, f) : null;
  function checkManual(n, B) {
    const out = []; const banned = ((B || briefs()[0] || {}).banned) || []; const t = [n.title, n.body, ...(n.tags || [])].join('\n');
    banned.forEach(w => { if (t.includes(w)) out.push(['err', `出现禁用词「${w}」`]); });
    if (!n.title) out.push(['err', '没有标题']); else if ([...n.title].length > 20) out.push(['warn', `标题 ${[...n.title].length} 字，小红书最多 20 字`]);
    const k = (n.images || []).length; if (!k) out.push(['err', '没有图片']); else if (k < 6) out.push(['warn', `只有 ${k} 张图，建议 8–10 张`]);
    if (String(n.body || '').length < 80) out.push(['warn', '正文偏短']); if (/无广|自费|不是广告/.test(t)) out.push(['err', '不要写「无广/自费/不是广告」']);
    return out;
  }
  const checkOf = (n, B, b) => b.kind === 'manual' ? checkManual(n, B) : check(n, B, b);
  const cardUrl = (bid, no) => `${base}c/${sign(`C|${bid}~${no}|${Date.now() + 60 * DAY}`)}`;
  function saveUp(bid, imgs) { const dir = path.join(UPD, bid); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { } fs.mkdirSync(dir, { recursive: true }); return imgs.slice(0, 18).map((d, i) => { fs.writeFileSync(path.join(dir, (i + 1) + '.jpg'), jpg(d)); return (i + 1) + '.jpg'; }); }
  function submit(j, me) {
    const title = String(j.title || '').trim().slice(0, 40), bodyT = String(j.body || '').trim().slice(0, 3000); const tags = String(j.tags || '').split(/[\s,，]+/).filter(Boolean).map(t => '#' + t.replace(/^#/, '')).slice(0, 10);
    if (!title || !bodyT) throw new Error('标题和正文都要写');
    const B = briefs().find(x => x.id === j.brief);
    if (me.role !== 'writer' && j.writer) { const w = U.users.find(z => z.id === j.writer && z.role === 'writer'); if (w) me = { id: w.id, name: w.name, role: 'writer', proxy: true }; } // 运营代写手上传，记在写手名下
    if (j.batch) { // 改了重交
      const b = getBatch(j.batch); if (!b || b.kind !== 'manual') throw new Error('没有这篇稿'); if (me.role === 'writer' && b.byId !== me.id) throw new Error('只能改自己的稿');
      const n = b.notes[0]; Object.assign(n, { title, body: bodyT, tags, status: 'todo' }); if (Array.isArray(j.images) && j.images.length) n.images = saveUp(b.id, j.images);
      n.notes.push({ t: '改好重交了', who: me.name, at: Date.now() }); n.check = checkManual(n, B); b.at = Date.now(); wj(path.join(BD, b.id + '.json'), b); return b;
    }
    if (!Array.isArray(j.images) || !j.images.length) throw new Error('至少传 1 张图');
    const id = 'g' + Date.now().toString(36); const images = saveUp(id, j.images);
    const n = { no: 1, title, body: bodyT, tags, images, status: 'todo', notes: [], dir: me.name, ending: '' }; n.check = checkManual(n, B);
    const b = { id, kind: 'manual', brief: B ? B.id : '', briefName: B ? B.name : '写手投稿', layout: 'manual', layoutName: '写手投稿 · ' + me.name, by: me.name, byId: me.id, at: Date.now(), firstAt: Date.now(), n: 1, status: 'done', notes: [n], err: '' };
    wj(path.join(BD, id + '.json'), b); log(`[攻略平台] ${me.name} 交了一篇稿《${title}》`);
    if (bossDm && me.role === 'writer' && !me.proxy) bossDm(`✍️ 写手 ${me.name} 在攻略平台交了一篇稿《${title}》，去「审稿」看：${base}#review`).catch(() => { });
    return b;
  }
  function edit(bid, j, who) { const f = path.join(BD, bid + '.json'); const b = getBatch(bid); if (!b) throw new Error('没有这个批次'); const n = b.notes.find(x => x.no === +j.no); if (!n) throw new Error('没有这一篇');
    if (j.title !== undefined) n.title = String(j.title).trim().slice(0, 40); if (j.body !== undefined) n.body = String(j.body).trim().slice(0, 3000); if (j.tags !== undefined) n.tags = String(j.tags).split(/[\s,，]+/).filter(Boolean).map(t => '#' + t.replace(/^#/, '')).slice(0, 10);
    n.edited = { who, at: Date.now() }; n.notes.push({ t: '改了文案', who, at: Date.now() }); if (b.kind !== 'manual') { const B = briefs().find(x => x.id === b.brief); if (B) { try { n.check = check(n, B, b); } catch (e) { } } } wj(f, b); return n; } // 手动改完重新核对一遍，提示跟着更新
  function savePages(bid, no, pages) { const b = getBatch(bid); if (!b) throw new Error('没有这个批次'); const n = b.notes.find(x => x.no === +no); if (!n) throw new Error('没有这一篇');
    const dir = path.join(CDD, `${bid}-${+no}`); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { } fs.mkdirSync(dir, { recursive: true });
    (pages || []).slice(0, 18).forEach((d, i) => fs.writeFileSync(path.join(dir, (i + 1) + '.jpg'), jpg(d))); n.cardPages = Math.min(18, (pages || []).length); n.cardAt = Date.now(); wj(path.join(BD, bid + '.json'), b); return n; }
  const KINDS = ['外部达人', '自己的号', '员工代发'];
  function assign(bid, j, who) { const b = getBatch(bid); if (!b) throw new Error('没有这个批次'); const n = b.notes.find(x => x.no === +j.no); if (!n) throw new Error('没有这一篇');
    if (j.clear) { delete n.assign; wj(path.join(BD, bid + '.json'), b); return { ok: true }; }
    const acct = String(j.acct || '').trim().slice(0, 30); if (!acct) throw new Error('写上发布账号'); const date = /^\d{4}-\d{2}-\d{2}$/.test(j.date) ? j.date : bjDay();
    n.assign = { acct, kind: KINDS.includes(j.kind) ? j.kind : '员工代发', who: String(j.who || '').trim().slice(0, 20), fee: Math.max(0, +j.fee || 0), date, by: who, at: Date.now() }; wj(path.join(BD, bid + '.json'), b); return { ok: true, url: cardUrl(bid, n.no) }; }
  function pub(bid, no, url, who) { const b = getBatch(bid); if (!b) throw new Error('没有这个批次'); const n = b.notes.find(x => x.no === +no); if (!n) throw new Error('没有这一篇');
    const m = String(url || '').match(/https?:\/\/[^\s，。]*(xiaohongshu\.com|xhslink\.com)[^\s，。]*/); if (!m) throw new Error('贴小红书笔记链接（App 里点分享→复制链接）');
    n.pub = { url: m[0], at: Date.now(), who }; wj(path.join(BD, bid + '.json'), b); log(`[攻略平台] 第 ${n.no} 篇已发布（${(n.assign || {}).acct || ''}）`); return n.pub; }
  function pubs() { const today = bjDay(); const L = []; for (const b of batches()) for (const n of b.notes) { if (!n.assign) continue; const late = !n.pub && n.assign.date < today ? Math.round((Date.parse(today) - Date.parse(n.assign.date)) / DAY) : 0;
    L.push({ bid: b.id, no: n.no, title: n.title, briefName: b.briefName, src: b.kind === 'manual' ? '写手·' + b.by : 'AI', ...n.assign, pub: n.pub || null, late, due: !n.pub && n.assign.date === today, url: cardUrl(b.id, n.no) }); }
    return L.sort((a, c) => (a.pub ? 1 : 0) - (c.pub ? 1 : 0) || a.date.localeCompare(c.date)); }
  // 自动提醒：每天上午 10 点后，把「排到昨天及以前还没发」的和「今天要发」的私信给老板
  setInterval(() => { try { const h = new Date(Date.now() + 8 * 3600e3).getUTCHours(); const today = bjDay(); if (h < 10 || META.remindDay === today) return; META.remindDay = today; saveMeta();
    const L = pubs(); const late = L.filter(x => x.late), due = L.filter(x => x.due); if (!late.length && !due.length) return;
    const line = x => `· ${x.acct}（${x.kind}${x.who ? '·' + x.who : ''}）《${x.title}》${x.late ? `，排在 ${x.date.slice(5)}，已超 ${x.late} 天` : ''}`;
    const t = `📮 攻略发布提醒\n${late.length ? `还没发（超期）${late.length} 篇：\n${late.slice(0, 20).map(line).join('\n')}\n` : ''}${due.length ? `今天要发 ${due.length} 篇：\n${due.slice(0, 20).map(line).join('\n')}\n` : ''}发完让对方在卡片链接里贴笔记链接，或在攻略平台「派发·发布」里回填：${base}#dispatch`;
    if (bossDm) bossDm(t).catch(e => log('[攻略平台] 发布提醒没发出去：' + e.message)); } catch (e) { log('[攻略平台] 发布提醒出错：' + e.message); } }, 10 * 60e3);

  function cleanBrief(b) { // 网页上改/新建任务书：只收这些字段，列表统一成数组
    const str = (v, n) => String(v === undefined || v === null ? '' : v).trim().slice(0, n || 200); const arr = v => (Array.isArray(v) ? v : String(v || '').split(/[、,，\n]+/)).map(x => String(x).trim()).filter(Boolean).slice(0, 40);
    const tag = v => arr(v).map(t => '#' + t.replace(/^#/, '')); const o = {};
    for (const k of ['id', 'name', 'store', 'brand', 'storeTitle', 'storeType', 'mainCat', 'city', 'district', 'address', 'price', 'hours', 'audience', 'message', 'mustDish', 'titleRule', 'practical', 'note', 'facts']) if (b[k] !== undefined) o[k] = str(b[k], ['message', 'audience', 'facts'].includes(k) ? 300 : 120);
    for (const k of ['mustSpots', 'optSpots', 'banned', 'placeWords', 'brandWords', 'nearAreas', 'sameCat']) if (b[k] !== undefined) o[k] = arr(b[k]);
    for (const k of ['tagsMust', 'tagsOpt']) if (b[k] !== undefined) o[k] = tag(b[k]);
    if (b.minDishes !== undefined) o.minDishes = Math.max(1, Math.min(6, +b.minDishes || 3)); if (b.tagsTotal !== undefined) o.tagsTotal = Math.max(5, Math.min(10, +b.tagsTotal || 9));
    if (b.directions !== undefined) o.directions = (Array.isArray(b.directions) ? b.directions : String(b.directions).split('\n').map(l => { const [n, w] = l.split(/[:：]/); return n && n.trim() ? { name: n.trim(), words: String(w || '').split(/[\/、,，]+/).map(x => x.trim()).filter(Boolean) } : null; }).filter(Boolean)).slice(0, 6);
    if (b.dishes !== undefined) o.dishes = typeof b.dishes === 'object' && !Array.isArray(b.dishes) ? b.dishes : Object.fromEntries(String(b.dishes).split('\n').map(l => { const [c, d] = l.split(/[:：]/); return c && d ? [c.trim(), d.split(/[、,，]+/).map(x => x.trim()).filter(Boolean)] : null; }).filter(Boolean));
    if (o.directions && !o.directions.length) throw new Error('至少写一个方向'); return o;
  }

  // ---------- 发布名单（飞书营销部「小红书-笔记-分发名单」，10 分钟缓存）----------
  let RO = { at: 0, list: [] };
  // 林总 2026-11-27：名单就是营销部这 6 张表里的人和账号（分发名单 + 各平台矩阵号/素人号数据表），合并去重
  const ROSTER_T = [['小红书-笔记-分发名单', '小红书', '分发名单'], ['抖音-视频-分发名单', '抖音', '分发名单'], ['小红书矩阵号-数据', '小红书', '矩阵号'], ['抖音-素人号-数据', '抖音', '素人号'], ['抖音-矩阵号-数据', '抖音', '矩阵号'], ['视频号-矩阵号-数据', '视频号', '矩阵号']];
  const pick = (o, ks) => { for (const k of ks) { const v = String(o[k] === undefined || o[k] === null ? '' : o[k]).trim(); if (v) return v; } return ''; };
  async function roster() {
    if (!rosterSrc) return []; if (Date.now() - RO.at < 10 * 60e3 && RO.list.length) return RO.list;
    const M = new Map(); RO.diag = [];
    for (const [t, plat, kind] of ROSTER_T) {
      let r; try { r = await rosterSrc(t); } catch (e) { RO.diag.push(`${t}：${e.message}`); log(`[攻略平台] 读「${t}」出错：` + e.message); continue; }
      RO.diag.push(`${t}：${(r.rows || []).length} 行，列 ${(r.fields || []).map(f => f.name).slice(0, 12).join('/')}`);
      for (const x of r.rows || []) {
        const name = pick(x, ['发布人员', '人员', '负责人', '运营人员']); const acct = pick(x, [plat + '昵称', '账号昵称', '账号名称', '昵称', '账号']); if (!name && !acct) continue;
        const k = plat + '|' + (acct || name); const o = M.get(k) || { name, acct, plat, kinds: [], home: '', posts: 0 };
        if (!o.name && name) o.name = name; if (!o.kinds.includes(kind)) o.kinds.push(kind); if (!o.home) o.home = pick(x, [plat + '主页链接', '主页链接', '账号主页', '主页']); if (kind !== '分发名单') o.posts++; M.set(k, o);
      }
    }
    RO = { diag: RO.diag, at: M.size ? Date.now() : 0, list: [...M.values()].sort((a, c) => a.plat.localeCompare(c.plat) || (a.name || '').localeCompare(c.name || '')) }; return RO.list;
  }

  // ---------- 结算（林总 2026-11-27）：写手按「通过」篇数，发布按「已发布」篇数；单价在页面上设，外部达人按派发时填的报价 ----------
  const RATE0 = { writer: 0, staff: 0, kol: 0, self: 0, comment: 0 };
  const rates = () => Object.assign({}, RATE0, META.rates || {});
  function settle(mon) {
    const R = rates(); const P = new Map(); const add = (key, o, item, amt) => { if (!P.has(key)) P.set(key, Object.assign({ key, n: 0, amt: 0, items: [] }, o)); const x = P.get(key); x.n++; x.amt += amt; x.items.push(item); };
    for (const b of batches()) for (const n of b.notes) {
      if (b.kind === 'manual' && /ok/.test(n.status) && bjDay(n.okAt || b.firstAt || b.at).slice(0, 7) === mon) add('w:' + b.byId, { role: '写手', name: b.by, unit: R.writer }, { bid: b.id, no: n.no, title: n.title, day: bjDay(n.okAt || b.at) }, R.writer);
      if (n.assign && n.pub && bjDay(n.pub.at).slice(0, 7) === mon) { const a = n.assign; const kind = a.kind || '员工代发'; const unit = kind === '外部达人' ? (+a.fee || R.kol) : kind === '自己的号' ? R.self : R.staff;
        add('p:' + kind + ':' + (a.who || a.acct), { role: kind, name: a.who || a.acct, acct: a.acct, unit: kind === '外部达人' ? null : unit }, { bid: b.id, no: n.no, title: n.title, day: bjDay(n.pub.at), url: n.pub.url, acct: a.acct, fee: unit }, unit); }
    }
    for (const t of tasks()) for (const f of t.floors) if (f.claim && f.done && f.done.ok !== false && bjDay(f.done.at).slice(0, 7) === mon) add('c:' + f.claim.name, { role: '评论', name: f.claim.name, acct: f.claim.acct, unit: R.comment || 0 }, { title: `第${t.no}组 ${f.seat}楼：${f.text}`, day: bjDay(f.done.at), url: t.url, acct: f.claim.acct, fee: R.comment || 0 }, R.comment || 0);
    const paid = (META.paid || {})[mon] || {};
    return [...P.values()].map(x => Object.assign(x, { paid: paid[x.key] || null })).sort((a, c) => a.role.localeCompare(c.role) || c.amt - a.amt);
  }
  // ---------- 评论区维护（林总 2026-11-27，照爆文工厂「爆评库」的打法）：贴笔记链接 → 按打法写评论稿，叠楼按 A/B/C/D… 楼排好 ----------
  const CD2 = path.join(D, 'cmts'); fs.mkdirSync(CD2, { recursive: true });
  const PLAYS = {
    rec: ['直接推荐', '一上来就推荐这家店：开头说区域/地标＋店名（也可以先说品类，最后点店名）；一句真实感受（吃了好几次、这边吃过最正宗的一家）；1–2 道招牌菜，可带一句点单建议（几个人点××就够）；一个去过才知道的细节（怎么找、几点人少、菜量、好停车）；可以带一个不伤口味的小缺点（要排队、有点辣）'],
    list: ['发攻略', '一条评论列 3–5 家店，我们的店放第 2 或第 3 位，不放第 1；排法任选：排名（1.×× 2.×× 3.××，我称之为××三大巨头）、按品类（湘菜（店名）粤菜（店名））、店名＋招牌罗列；别家只写店名＋一道招牌，只用给你的周边店；我们那一项和别家写法、字数一样，不单独多夸'],
    stack: ['叠楼互动', '一楼几个人接力：A 开楼用直接推荐的写法，但店名或位置不说全（××那边有一家××馆），留给后面的人问；B 问，短，像随口一问（在哪／叫什么／多少钱／是不是××那家）；C 答，店名全称＋好找的地标，也可以是 A 自己回；D 说去过：确实/吃过＋一个具体细节（菜量、排队、好停车）；可选 E 发帖人回一句「那我一定要去试试」或再问价格；可选 F、G 再追问一个细节和回答'],
    pic: ['作者带图评论', '只用于我们自己发的笔记：发帖人自己在评论区发一条，点名一道菜（全称），像随口一句（谁能帮我打包一份××／最想再吃的是××／漏写了××），写清配什么图（特写、打包盒、刚上桌）；可以不带店名，留给网友问'],
    qa: ['作者答疑对话', '只用于我们自己发的笔记：A 网友问（这个好吃吗／哪家啊／人均多少）；B 作者答，点 1–2 道具体菜名，不夸张；C 网友追问一个细节（××是烤的吗／要排队吗）；D 作者一两句答（是啊／工作日不用）；E 网友收尾（那我知道了！×× ／收藏了），复述一次店名或菜名']
  };
  const cmtList = () => fs.readdirSync(CD2).filter(f => f.endsWith('.json')).map(f => rj(path.join(CD2, f), null)).filter(Boolean).sort((a, c) => c.at - a.at);
  function noteTextOf(url) { // 链接如果是我们平台发出去的稿，或爆款库里有，就直接拿正文
    const id = (String(url).match(/(?:explore|discovery\/item)\/([0-9a-f]{24})/) || [])[1];
    for (const b of batches()) for (const n of b.notes) if (n.pub && (n.pub.url === url || (id && n.pub.url.includes(id)))) return { from: '我们自己发的', own: true, title: n.title, text: n.body };
    if (id && glib && glib.get) { const g = glib.get(id); if (g && (g.title || g.desc)) return { from: '爆款库', title: g.title, text: g.desc }; }
    return null;
  }
  async function genCmt(j, who) {
    const B = briefs().find(x => x.id === j.brief) || briefs()[0]; if (!B) throw new Error('先建任务书');
    const url = String(j.url || '').trim().slice(0, 500); const known = noteTextOf(url); const own = j.own !== undefined ? !!j.own : !!(known && known.own);
    const noteText = String(j.noteText || '').trim().slice(0, 3000) || (known ? `${known.title}\n${known.text}` : '');
    const plays = (j.plays || ['rec', 'list', 'stack']).filter(k => PLAYS[k] && (own || !['pic', 'qa'].includes(k))); if (!plays.length) throw new Error('至少选一种打法');
    const per = Math.max(2, Math.min(10, +j.per || 5)); const dy = j.platform === 'dy';
    const pool = stores().filter(s => s.district === B.district && s.id !== B.store && !(s.planted && brandRe(B).test(s.name))).sort(() => Math.random() - 0.5).slice(0, 20);
    const dishes = [B.mustDish, ...Object.values(B.dishes || {}).flat()].filter(Boolean).join('、');
    const prompt = `你在帮餐饮店做${dy ? '抖音' : '小红书'}评论区维护：给一条目标笔记写评论稿，让我们的店名在评论区被自然提到、被追问、被搜。评论由我们的员工号/素人号分别去发，要像不同的真人。
【我们的店】${B.storeTitle}｜${B.address}｜人均${B.price}｜${B.hours}｜可写的菜：${dishes}｜卖点：${B.message}${B.facts ? '\n【固定事实，不能改】' + B.facts : ''}
【周边别家店（发攻略时只能用这些，店名照抄）】
${pool.map(s => `- ${s.name}｜${s.cat}｜招牌：${s.dishes}`).join('\n') || '（没有，就写【别家店名】占位）'}
【目标笔记】${url || '（没给链接）'}${noteText ? `\n${noteText.slice(0, 1500)}` : '\n（没拿到原文，按「' + ({ need: '求推荐帖', guide: '攻略／美食清单', single: '单店探店笔记' }[j.noteType] || '本地美食帖') + '」写，内容要能接得上这类帖子）'}
${own ? '【这是我们自己发的笔记，可以用发帖人身份】' : '【这不是我们发的笔记，不能用发帖人身份，不能代替博主说话】'}
【打法】每种写 ${per} 组：
${plays.map(k => `- ${k}｜${PLAYS[k][0]}：${PLAYS[k][1]}`).join('\n')}
【通用规则】
1. 店名每次都用同一个写法「${B.storeTitle.replace(/（.*$/, '')}」${B.storeTitle.includes('（') ? '，需要时带分店名' : ''}，常和招牌菜一起出现（容易被平台做成「大家都在搜」的搜索词）。
2. 每条带一个具体场景（带对象、朋友聚餐、宵夜、带爸妈、逛完××）或一个到店理由（招牌菜、离哪近、几点去不排队），不要只说「好吃」。
3. 口语短句，${dy ? '可以用抖音方括号表情如 [捂脸][舔屏][呲牙][比心]' : '可以用小红书表情如 [哭惹R][赞R][笑哭R][doge]，或少量 emoji'}；一组里最多一两条用网络热词（夯、上人）。
4. 不写禁用词：${(B.banned || []).join('、')}；不写「不是广告／无广／自费」这类此地无银的话；不编造优惠活动；营业时间、人均只能照上面写的（${B.hours}、人均${B.price}），几点人少可以说「六点前」这种模糊说法，不要编具体开门时间和人数价格。
5. 同一组里每楼像不同的人，语气、长短要有差别；问的那楼要短。
6. 每组给一句 tip：建议谁发（员工号/素人号/发帖人）、隔多久发、要不要给哪楼点赞。
只输出 JSON：{"groups":[{"play":"rec","floors":[{"tag":"A","who":"素人号/员工号/发帖人/路人","role":"开楼/问/答/去过/发帖人","text":"评论内容"}],"tip":"≤40字"}]}
单条评论的打法（直接推荐、发攻略、作者带图评论）也放在 floors 里，只有一个 A 楼；叠楼和答疑按 A、B、C、D、E… 依次排。作者带图评论的 text 末尾用【配图：……】写清楚配什么图。`;
    const r = await llm(prompt); const J0 = parseJ(r.text);
    const groups = (J0.groups || []).map(g => ({ play: PLAYS[g.play] ? g.play : 'rec', floors: (g.floors || []).slice(0, 8).map((f, i) => ({ tag: String.fromCharCode(65 + i), who: String(f.who || '').slice(0, 10), role: String(f.role || '').slice(0, 8), text: String(f.text || '').slice(0, 400) })).filter(f => f.text), tip: String(g.tip || '').slice(0, 80) })).filter(g => g.floors.length);
    const bad = groups.flatMap(g => g.floors).filter(f => (B.banned || []).some(w => f.text.includes(w))).length;
    const rec = { id: 'c' + Date.now().toString(36), at: Date.now(), by: who, url, brief: B.id, briefName: B.name, platform: dy ? 'dy' : 'xhs', own, from: known ? known.from : (noteText ? '手动粘贴' : ''), noteText: noteText.slice(0, 400), plays, groups, model: r.model, bad };
    wj(path.join(CD2, rec.id + '.json'), rec); log(`[攻略平台] 评论稿 ${groups.length} 组（${url.slice(0, 60)}）`); return rec;
  }

  // ---------- 周边店候选（林总 2026-11-27：周边店从爆款库里找，放进门店池，不要和主店同品类）----------
  // 1) 按任务书的商圈给采集插件加「本地调研词」；2) 采到的本地笔记让 AI 抽出店名/品类/招牌/地址；3) 候选在「门店池」里一键加入
  const CF = path.join(D, 'cands.json'); let CA = rj(CF, { items: [], done: [] }); const saveC = () => wj(CF, CA);
  const nearOf = B => [...new Set((B.nearAreas && B.nearAreas.length ? B.nearAreas : [...(B.placeWords || []), ...(B.mustSpots || []), ...(B.optSpots || []).slice(0, 2)]).filter(Boolean))];
  const sameCatRe = B => new RegExp((B.sameCat && B.sameCat.length ? B.sameCat : /大排档|海鲜/.test(B.storeType || '') ? ['大排档', '海鲜', '烧烤', '生蚝', '砂锅粥', '小龙虾'] : [B.storeType || '无']).join('|'));
  function syncFocus() { if (!glib || !glib.setFocus) return; const kws = []; briefs().forEach(B => { const N = nearOf(B).slice(0, 4); N.forEach((a, i) => { kws.push((B.city && !a.includes(B.city) && i ? B.city : '') + a + '美食'); if (!i) kws.push(a + '附近吃什么'); }); }); glib.setFocus([...new Set(kws)].slice(0, 36)); }
  setTimeout(syncFocus, 30e3); setInterval(syncFocus, 6 * 3600e3);
  async function extractCands() {
    if (!glib || !glib.focus) return; const F = new Set(glib.focus().map(x => x.kw)); const done = new Set(CA.done); const all = stores();
    const L = (glib.query ? glib.query({ n: 5000, sort: 'in' }) : { items: [] }).items || []; let n = 0;
    for (const it of L) {
      if (done.has(it.id) || !(it.kws || []).some(k => F.has(k))) continue; const g = glib.get(it.id); if (!g) continue; done.add(it.id); CA.done.push(it.id);
      const text = `${g.title}\n${g.desc}\n${(g.ai && g.ai.text) || ''}`.slice(0, 3500); if (text.length < 40) continue;
      try {
        const r = await llm(`下面是一篇小红书本地美食笔记（标题、正文、图片里的字）。把里面提到的、能找得到的具体餐饮店抽出来（必须有店名；连锁店带上分店名）。没有具体店名的不要，景点、商场不要。
只输出 JSON：{"shops":[{"name":"店名（分店）","area":"商圈/街道/地铁站，原文怎么写就怎么写","cat":"品类，如 糖水甜品/粉面/茶餐厅/潮汕牛肉火锅/烘焙/咖啡","dishes":"原文提到的招牌菜，顿号隔开","addr":"原文给的地址，没有就空","price":"人均数字，没有就空","hours":"营业时间，没有就空"}]}
笔记：
${text}`, ['qwen-plus', 'deepseek-v4.1-flash']);
        const J0 = parseJ(r.text);
        for (const x of (J0.shops || []).slice(0, 30)) {
          const name = String(x.name || '').trim().slice(0, 40); if (name.length < 2) continue; const key = name.replace(/[（(].*$/, '').replace(/\s/g, '');
          if (all.some(st => st.name.replace(/[（(].*$/, '').replace(/\s/g, '') === key && (!x.area || st.name.includes(String(x.area).slice(0, 2)) || st.area === x.area))) continue;
          const o = CA.items.find(c => c.name === name) || (CA.items.push({ name, area: '', cat: '', dishes: '', addr: '', price: '', hours: '', notes: [], st: 'new' }), CA.items[CA.items.length - 1]);
          for (const k of ['area', 'cat', 'dishes', 'addr', 'price', 'hours']) if (!o[k] && x[k]) o[k] = String(x[k]).slice(0, 80);
          if (!o.notes.some(z => z.id === it.id)) o.notes.push({ id: it.id, title: String(g.title || '').slice(0, 40), likes: g.likes || 0, collects: g.collects || 0 });
        }
        n++;
      } catch (e) { log('[攻略平台] 抽周边店出错：' + e.message); }
      saveC(); if (n >= 25) break;
    }
    if (n) log(`[攻略平台] 从 ${n} 篇本地笔记里抽周边店，候选共 ${CA.items.length} 家`); saveC();
  }
  // 从「自家内容库」（我们各店发过的逛吃攻略）里抽周边店，近的、不同品类的直接进门店池（林总 2026-11-27：新门店门店池只有 8–9 家，以前的攻略里写过的店要用上）
  const OWN_STORE = [[/白石洲/, 'b1'], [/华强北/, 'b_hqb'], [/前海/, 'b_hop'], [/水东/, 'b_sdj'], [/玖洲|九洲/, 'b_jzd'], [/千灯湖/, 'b_qdh']];
  const shopKey = n => String(n || '').replace(/[（(].*$/, '').replace(/[\s·・.]/g, '');
  let ownRun = null;
  async function ownCands() {
    if (ownRun || !rosterSrc) return; ownRun = { at: Date.now(), total: 0, done: 0 }; CA.ownDone = CA.ownDone || [];
    try {
      const R = await rosterSrc('自家内容库'); const done = new Set(CA.ownDone); const bs = briefs();
      const rows = (R.rows || []).map(o => ({ o, bid: (OWN_STORE.find(([re]) => re.test(String(o['门店'] || ''))) || [])[1] })).filter(x => x.bid && bs.some(b => b.id === x.bid) && !done.has(x.o._id) && String(x.o['正文'] || '').length > 150 && !/品宣/.test(String(x.o['内容类型'] || '')));
      ownRun.total = rows.length; let i = 0;
      const one = async () => { while (i < rows.length) { const { o, bid } = rows[i++]; const text = `${o['标题'] || ''}\n${o['正文'] || ''}`.slice(0, 3500);
        try { const r = await llm(`下面是一篇小红书本地逛吃笔记。把里面提到的、能找得到的具体餐饮店抽出来（必须有店名；连锁店带上分店名）。没有具体店名的不要，景点、商场不要，「YES也是大排档」不要。
只输出 JSON：{"shops":[{"name":"店名（分店）","area":"商圈/街道/地铁站，原文怎么写就怎么写","cat":"品类，如 糖水甜品/粉面/茶餐厅/潮汕牛肉火锅/烘焙/咖啡","dishes":"原文提到的招牌菜，顿号隔开","addr":"原文给的地址，没有就空","price":"人均数字，没有就空","hours":"营业时间，没有就空"}]}
笔记：
${text}`, ['qwen-plus', 'deepseek-v4.1-flash']);
          for (const x of (parseJ(r.text).shops || []).slice(0, 30)) { const name = String(x.name || '').trim().slice(0, 40); if (name.length < 2 || /YES|也是大排档/i.test(name)) continue;
            const c = CA.items.find(z => shopKey(z.name) === shopKey(name)) || (CA.items.push({ name, area: '', cat: '', dishes: '', addr: '', price: '', hours: '', notes: [], st: 'new' }), CA.items[CA.items.length - 1]);
            for (const k of ['area', 'cat', 'dishes', 'addr', 'price', 'hours']) if (!c[k] && x[k]) c[k] = String(x[k]).slice(0, 80);
            c.own = (c.own || 0) + 1; c.for = [...new Set([...(c.for || []), bid])]; if (c.notes.length < 6) c.notes.push({ id: o['笔记ID'] || o._id, title: String(o['标题'] || '').slice(0, 40), own: true }); }
          CA.ownDone.push(o._id);
        } catch (e) { log('[攻略平台] 自家内容库抽店出错：' + e.message); }
        ownRun.done++; if (ownRun.done % 10 === 0) saveC(); } };
      await Promise.all([one(), one(), one()]); saveC();
      const added = ownPick(); CA.ownLog = { at: Date.now(), read: ownRun.done, cands: CA.items.filter(c => c.own).length, added }; saveC(); log(`[攻略平台] 自家内容库抽店完成：读 ${ownRun.done} 篇，进门店池 ${JSON.stringify(added)}`);
    } catch (e) { log('[攻略平台] 自家内容库抽店失败：' + e.message); CA.ownLog = { at: Date.now(), err: e.message.slice(0, 100) }; saveC(); }
    ownRun = null;
  }
  // 挑进门店池：这家店的攻略里写过、在主店附近、不是同品类、池里还没有；同一品类最多 3 家，每家门店池补到 24 家为止；都标「待核对」
  const cleanArea = a => String(a || '').replace(/(美食|附近|片区)$/, '').replace(/^(.{2,6})店$/, '$1').replace(/区$/, m => m).slice(0, 20); // 「华强北美食」「燕南店」这种抽出来的商圈写法收拾一下
  setTimeout(() => { try { const L = stores(); let n = 0; L.forEach(x => { if (x.src === '自家内容库' && x.ownN) { const a = cleanArea(x.area); if (a !== x.area) { x.area = a; n++; } } }); if (n) { wj(SF, L); log(`[攻略平台] 门店池里 ${n} 家店的商圈写法收拾了一下`); } } catch (e) { } }, 15e3);
  function ownPick() { const out = {}; const L = stores(); const catKey = c => String(c || '其他').replace(/[·\/、，,].*$/, '').slice(0, 4);
    briefs().forEach(B => { const main = L.find(x => x.id === B.store); if (!main) return; const near = nearOf(B); const same = sameCatRe(B); const isNear = c => near.some(a => (c.area + (c.addr || '') + c.name).includes(a));
      const pool = L.filter(x => x.id !== main.id && near.some(a => (x.area + (x.addr || '') + x.name).includes(a))); const perCat = {}; pool.forEach(x => { const k = catKey(x.cat); perCat[k] = (perCat[k] || 0) + 1; }); let n = pool.length, add = 0;
      CA.items.filter(c => c.st === 'new' && c.own && (c.for || []).includes(B.id) && isNear(c) && !same.test(c.cat + c.name) && c.cat && !L.some(x => shopKey(x.name) === shopKey(c.name)))
        .sort((a, c) => (c.own - a.own) || ((c.dishes ? 1 : 0) - (a.dishes ? 1 : 0)))
        .forEach(c => { if (n >= 24) return; const k = catKey(c.cat); if ((perCat[k] || 0) >= 3) return; perCat[k] = (perCat[k] || 0) + 1;
          L.push({ id: 's' + Date.now().toString(36) + L.length, name: c.name, planted: false, district: B.district, area: cleanArea(c.area), cat: c.cat, slot: '', dishes: c.dishes, price: c.price, star: '', years: '', hours: c.hours, addr: c.addr, src: '自家内容库', verify: true, ownN: c.own }); c.st = 'added'; n++; add++; });
      out[B.name] = [add, n]; });
    wj(SF, L); return out; }
  setInterval(() => { const hh = new Date(Date.now() + 8 * 3600e3).getUTCHours(); if (hh === 4) ownCands().catch(() => { }); }, 3600e3); // 每天凌晨 4 点看一眼自家内容库有没有新攻略，有就接着抽店、补门店池
  setInterval(() => extractCands().catch(() => { }), 3 * 3600e3); setTimeout(() => extractCands().catch(() => { }), 120e3);
  function candList(bid) { const B = briefs().find(x => x.id === bid) || briefs()[0] || {}; const near = nearOf(B); const same = sameCatRe(B);
    return CA.items.filter(c => c.st === 'new' && (!c.for || c.for.includes(B.id))).map(c => Object.assign({}, c, { near: near.some(a => (c.area + c.addr + c.name).includes(a)), same: same.test(c.cat + c.name) })).sort((a, c) => (c.near - a.near) || (a.same - c.same) || ((c.own || 0) - (a.own || 0)) || c.notes.length - a.notes.length).slice(0, 150); }

  // ---------- 评论任务大厅（林总 2026-11-27）：我们维护自己的评论区。运营生成「一组」评论（首评＋几楼回复），放进大厅；
  // 评论的人打开大厅链接（不用登录）自己领一楼、复制文案、存配图、评论完传截图，自动计进结算。文案照君游现在的写法：短、口语、像朋友聊天。
  const TD = path.join(D, 'ctask'); fs.mkdirSync(TD, { recursive: true }); const SHD = path.join(D, 'cshots'); fs.mkdirSync(SHD, { recursive: true });
  const tasks = () => fs.readdirSync(TD).filter(f => f.endsWith('.json')).map(f => rj(path.join(TD, f), null)).filter(Boolean).sort((a, c) => c.no - a.no);
  const getTask = id => /^t[0-9a-z]+$/.test(id) ? rj(path.join(TD, id + '.json'), null) : null; const saveTask = t => wj(path.join(TD, t.id + '.json'), t);
  // ---------- 需求箱（员工提需求 → 定时任务读 /q/<askKey> → 改代码 → glreplies.js 登记 → 这里写回）----------
  const AF = path.join(D, 'asks.json'); const askKey = () => { if (!META.askKey) { META.askKey = crypto.randomBytes(12).toString('base64url'); saveMeta(); } return META.askKey; };
  function mergeReplies() { let R = []; try { R = require('./glreplies'); } catch (e) { return; } const A = rj(AF, { items: [] }); const done = [];
    (Array.isArray(R) ? R : []).forEach(r => { const it = A.items.find(x => x.id === r.id); if (!it || !r.at || (it.replyAt || 0) >= r.at) return; it.status = ['done', 'no', 'doing'].includes(r.status) ? r.status : 'done'; it.reply = String(r.reply || '').slice(0, 300); it.replyAt = r.at; done.push(it); });
    if (!done.length) return; wj(AF, A); const SN = { done: '已改好', no: '暂不做', doing: '等你点头' };
    if (bossDm) setTimeout(() => bossDm(`📮 攻略平台需求箱处理了 ${done.length} 条：\n` + done.map(x => `· ${x.by}：「${x.text.slice(0, 40)}」→ ${SN[x.status]}${x.reply ? '（' + x.reply.slice(0, 60) + '）' : ''}`).join('\n')).catch(() => { }), 60000); }
  try { mergeReplies(); } catch (e) { log('[攻略平台] 需求箱回复写回出错：' + e.message); }
  const hallKey = () => { if (!META.hallKey) { META.hallKey = crypto.randomBytes(9).toString('base64url'); saveMeta(); } return META.hallKey; };
  const hallUrl = () => `${base}h/${hallKey()}`;
  setTimeout(() => { try { tasks().forEach(t => { let ch = false; t.floors.forEach(f => { if (t.status === 'draft' && f.img && !f.imgBy && !f.wantImg) { f.wantImg = true; f.img = ''; ch = true; } if (t.status !== 'done' && !f.done && /yes\s*大排档/i.test(f.text)) { f.text = f.text.replace(/(yes|YES|Yes)\s*(也是)?\s*大排档/g, 'YES也是大排档'); ch = true; } }); if (ch) saveTask(t); }); } catch (e) { } }, 5e3); // 之前自动配的图改成让领的人自己选
  const CMT_BAD = ['推荐', '种草', '必点', '必吃', '绝绝子', 'yyds', '安利', '强烈', '性价比', '广告', '探店', '宝藏', '天花板', '封神', '回购', '打卡', '上榜'];
  const SAMPLE = `【第50组】A（首评）：你看看人家，你啥时候带我去吃YES也是大排档的暖冬套餐啊@B ／ B回复A：周末给你安排上 ／ C回复A：也太幸福了吧，我也想吃这家YES也是大排档 ／ D回复A：已和闺蜜吃上了老香了哈哈哈（配图） ／ E回复D：想吃这家，看起来食欲绝了
【第51组】A（首评）：终于把朋友骗来吃YES也是大排档了哈哈 ／ B回复A：哇！这家还不错哎，人均怎么样啊 ／ C回复A：感觉这家会很好吃@D ／ D回复C：找个时间带你去吃~ ／ E回复A：你是懂吃的，这家我吃过挺多次了`;
  async function genTasks(j, who) {
    // 不一定要任务书（林总 2026-11-27）：选门店就用这家店的资料；不选就只提品牌，不提分店
    const st = stores().find(x => x.id === j.store && x.planted); const B0 = st ? briefs().find(x => x.store === st.id) : null; const yesLike = n => /YES|也是大排档/i.test(n || '');
    const B = B0 || (st ? { id: '', store: st.id, storeTitle: st.name, brand: st.name.replace(/[（(].*$/, ''), price: st.price || '', banned: (briefs()[0] || {}).banned || [], menu: yesLike(st.name) ? YES_MENU : null, dishes: { 招牌: String(st.dishes || '').split(/[、,，]/).filter(Boolean) } } : { id: '', store: '', storeTitle: 'YES也是大排档', brand: 'YES也是大排档', price: '85-100', banned: (briefs()[0] || {}).banned || [], menu: YES_MENU, dishes: {} });
    const urls = [].concat(j.urls || []).map(u => String(u).trim()).filter(Boolean).slice(0, 10); if (!urls.length) throw new Error('贴至少一条笔记链接');
    const G = Math.max(1, Math.min(8, +j.groups || 2)), F = Math.max(3, Math.min(7, +j.floors || 5)); const dy = j.platform === 'dy' || urls.every(u => /douyin/.test(u));
    const short = /YES|也是大排档/i.test(B.brand || B.storeTitle || '') ? 'YES也是大排档' : String(B.brand || B.storeTitle).replace(/[（(].*$/, ''); const out = []; // 林总 2026-11-27：评论里的关键词用全称「YES也是大排档」
    for (const url of urls) {
      const known = noteTextOf(url); const recent = tasks().slice(0, 12).flatMap(t => t.floors.filter(f => f.seat === 'A').map(f => f.text));
      const prompt = `我们在维护自己店「${st ? B.storeTitle : 'YES也是大排档（不指定哪家分店，评论里不要提分店和地址）'}」发出去的${dy ? '抖音' : '小红书'}笔记评论区。写 ${G} 组评论，每组 ${F} 楼：A 是首评，后面每一楼都回复前面的某一楼（写清回复谁），像几个朋友在评论区随口聊天，让刷到的人觉得这家店有人去、有人想去。
${known ? `笔记内容：${known.title} ${String(known.text || '').slice(0, 300)}\n` : ''}照我们现在的真实写法（这是同事写的，评论区效果好）：
${SAMPLE}
要求：
1. 每楼 4–25 个字，像手机上随手打的，口语，可以用「哈哈」「~」「@某楼」，标点随意，别写成通顺的作文。
2. 店名只写全称「${short}」（一个字都不能少，不能写成 yes大排档、也是大排档、大排档），这是要让人搜到的关键词；一组里出现 1–2 次；有的组首评可以不提店名，让后面的人问「这是哪家」再说。
3. 一组里最多 1 楼提到一道菜，菜名只能用菜单上的：${menuText(B) || Object.values(B.dishes || {}).flat().join('、')}；价格只能说菜单价或人均 ${B.price}，没把握就不说价格。
4. 每组有 1 楼要配图（img 写 "1"，dish 写配哪道菜），那一楼的话要和图对得上（如「已和闺蜜吃上了（配图）」）。
5. 每组换一个场景：约朋友、带对象、带爸妈、下班宵夜、生日、下雨天、加班后、看完球……${G} 组之间首评的说法不能像，也不能和这些已经用过的首评像：${recent.slice(0, 8).join(' ／ ') || '无'}
6. 不能出现：${[...CMT_BAD, ...(B.banned || [])].join('、')}；不写地址导航，不写长句夸菜，不写「不是广告」这类话；不能说上了什么榜。
只输出 JSON：{"groups":[{"scene":"场景","floors":[{"seat":"A","reply":"","text":"","img":"","dish":""},{"seat":"B","reply":"A","text":"","img":"","dish":""}]}]}`;
      const r = await llm(prompt); const J0 = parseJ(r.text);
      for (const g of (J0.groups || []).slice(0, G)) {
        const sc = B.store ? sucaiFor(B.store) : (stores().filter(x => x.planted && yesLike(x.name)).flatMap(x => sucaiFor(x.id))); const floors = (g.floors || []).slice(0, F).map((f, i) => {
          const seat = String.fromCharCode(65 + i); let text = String(f.text || '').replace(/\s+/g, ' ').trim().slice(0, 60); if (short === 'YES也是大排档') text = text.replace(/(?<!也是)(yes|YES|Yes)\s*(也是)?\s*大排档/g, 'YES也是大排档'); let img = '';
          // 配图不替他们选（林总 2026-11-27）：只标「这楼要配图、建议配哪道菜」，领的人自己在素材库里挑
          return { seat, reply: i ? String(f.reply || 'A').slice(0, 1).toUpperCase() : '', text, img, wantImg: !!f.img, dish: String(f.dish || '').slice(0, 20), bad: CMT_BAD.filter(w => text.includes(w)) };
        }).filter(f => f.text);
        if (floors.length < 2) continue;
        const noKw = !floors.some(f => f.text.includes(short));
        META.taskNo = (META.taskNo || 0) + 1; saveMeta();
        const t = { id: 't' + Date.now().toString(36) + out.length, no: META.taskNo, url, brief: B.id, store: B.store, storeName: st ? st.name : '不指定分店', platform: dy ? 'dy' : 'xhs', scene: String(g.scene || '').slice(0, 12), noKw, kw: short, due: /^\d{4}-\d{2}-\d{2}$/.test(j.due || '') ? j.due : bjDay(), floors, status: 'draft', by: who, at: Date.now(), model: r.model };
        saveTask(t); out.push(t);
      }
    }
    log(`[攻略平台] 评论任务 ${out.length} 组（草稿）`); return out;
  }
  // 大厅给评论的人看的：只给开放中的组，不给截图和别人的账号细节
  function hallView(name) {
    const today = bjDay(); const L = tasks().filter(t => t.status === 'open');
    return L.map(t => ({ id: t.id, no: t.no, url: t.url, platform: t.platform, store: t.storeName, scene: t.scene, due: t.due, late: t.due < today,
      floors: t.floors.map(f => ({ seat: f.seat, reply: f.reply, text: f.text, img: f.img, wantImg: !!f.wantImg, dish: f.dish || '', taken: f.claim ? (f.claim.name === name ? 'me' : 'other') : '', by: f.claim && f.claim.name !== name ? f.claim.acct || '已领' : '', done: !!f.done, rejected: !!(f.done && f.done.ok === false) })) }));
  }
  function hallAct(j) {
    const t = getTask(j.id); if (!t || t.status !== 'open') throw new Error('这组已经关了'); const f = t.floors.find(x => x.seat === j.seat); if (!f) throw new Error('没有这一楼');
    const name = String(j.name || '').trim().slice(0, 20), acct = String(j.acct || '').trim().slice(0, 30); if (!name) throw new Error('先填你的名字');
    if (j.act === 'claim') { if (f.claim && f.claim.name !== name) throw new Error('这一楼已经被领了'); if (t.floors.some(x => x !== f && x.claim && x.claim.name === name)) throw new Error('同一组里一个人只能领一楼（不能自己回自己）'); f.claim = { name, acct, at: Date.now() }; }
    else if (j.act === 'drop') { if (!f.claim || f.claim.name !== name || f.done) throw new Error('放不了'); delete f.claim; }
    else if (j.act === 'img') { if (!f.claim || f.claim.name !== name) throw new Error('先领这一楼'); const im = String(j.img || ''); if (im && !(/^(sc|s[0-9a-z]+)\/\d+\.jpg$/.test(im) && fs.existsSync(path.join(PD, im)))) throw new Error('图不对'); f.img = im; f.imgBy = name; }
    else if (j.act === 'text') { if (!f.claim || f.claim.name !== name || (f.done && f.done.ok !== false)) throw new Error('改不了'); const tx = String(j.text || '').replace(/\s+/g, ' ').trim().slice(0, 60); if (!tx) throw new Error('不能空'); const kw = t.kw || 'YES也是大排档'; if (f.text.includes(kw) && !tx.includes(kw)) throw new Error(`这句里的「${kw}」要保留全称，不能删也不能改成简称`); if (!f.orig) f.orig = f.text; f.text = tx; f.bad = CMT_BAD.filter(w => tx.includes(w)); }
    else if (j.act === 'done') { if (!f.claim || f.claim.name !== name) throw new Error('先领这一楼'); if (f.wantImg && !f.img) throw new Error('这一楼要配图，先在素材库里选一张'); const dir = path.join(SHD, t.id); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, f.seat + '.jpg'), jpg(j.shot)); f.done = { at: Date.now(), ok: null }; if (t.floors.every(x => x.done)) t.status = 'done'; }
    else throw new Error('不认识的操作');
    saveTask(t); return { ok: true };
  }
  const imgUse = () => { const m = new Map(); tasks().forEach(t => t.floors.forEach(f => { if (f.img) m.set(f.img, (m.get(f.img) || 0) + 1); })); return m; };
  function hallLib() { const out = []; for (const st of stores().filter(x => x.planted)) { const L = [...photosOf(st.id).map(f => ({ f: `${st.id}/${f}`, dish: '' })), ...sucaiFor(st.id).slice(0, 60).map(f => { const x = (SC.items || []).find(y => `sc/${y.n}.jpg` === f) || {}; return { f, dish: x.dish || '' }; })]; if (L.length) out.push({ id: st.id, store: st.name, photos: L }); } const U = imgUse(); out.forEach(g => g.photos.forEach(p => { p.used = U.get(p.f) || 0; })); return out; }
  // ---------- 路由 ----------
  async function handle(req, res, p, u) {
    if (p === '/login' && req.method === 'POST') {
      const ip = ipOf(req); const fl = fails.get(ip) || { n: 0, at: 0 }; if (fl.n >= 5 && Date.now() - fl.at < 15 * 60e3) return send(res, 429, loginPage('输错太多次，15 分钟后再试'), 'text/html; charset=utf-8');
      const f = Object.fromEntries(new URLSearchParams(await body(req, 4096))); const x = U.users.find(z => z.login === String(f.u || '').trim() && !z.off && z.hash);
      if (!x || hashPw(f.p || '', x.salt) !== x.hash) { fails.set(ip, { n: fl.n + 1, at: Date.now() }); return send(res, 200, loginPage('账号或密码不对'), 'text/html; charset=utf-8'); }
      fails.delete(ip); x.last = Date.now(); saveU(); return send(res, 303, '', 'text/plain', { location: '/cockpit/gl/', 'set-cookie': sess(x.id) });
    }
    if (p === '/logout') return send(res, 303, '', 'text/plain', { location: '/cockpit/gl/', 'set-cookie': 'xgl=; Path=/cockpit/gl/; Max-Age=0; HttpOnly; Secure; SameSite=Lax' });
    if (p === '/setpass') {
      if (req.method === 'GET') { const t = u.searchParams.get('t') || ''; const uid = verify(t, 'P'); const x = uid && U.users.find(z => z.id === uid); if (!x || usedTok.has(t)) return send(res, 200, shell('链接失效', '<form><h1>链接已失效</h1><p>请让老板在攻略平台「账号」页重新生成。</p></form>'), 'text/html; charset=utf-8'); return send(res, 200, setPage(t, x.name), 'text/html; charset=utf-8'); }
      const f = Object.fromEntries(new URLSearchParams(await body(req, 4096))); const uid = verify(f.t, 'P'); const x = uid && U.users.find(z => z.id === uid);
      if (!x || usedTok.has(f.t)) return send(res, 200, shell('链接失效', '<form><h1>链接已失效</h1></form>'), 'text/html; charset=utf-8');
      const login = String(f.u || '').trim(); if (!/^[A-Za-z0-9_]{3,20}$/.test(login)) return send(res, 200, setPage(f.t, x.name, '账号只能用 3–20 位字母、数字'), 'text/html; charset=utf-8');
      if (String(f.p || '').length < 8) return send(res, 200, setPage(f.t, x.name, '密码至少 8 位'), 'text/html; charset=utf-8');
      if (U.users.some(z => z.login === login && z.id !== x.id)) return send(res, 200, setPage(f.t, x.name, '这个账号名已被占用'), 'text/html; charset=utf-8');
      x.login = login; x.salt = crypto.randomBytes(16).toString('hex'); x.hash = hashPw(f.p, x.salt); x.setAt = Date.now(); usedTok.add(f.t); saveU(); log(`[攻略平台] ${x.name} 设置了账号`);
      return send(res, 303, '', 'text/plain', { location: '/cockpit/gl/', 'set-cookie': sess(x.id) });
    }
    // 商家/店长审稿链接（不用登录，只能看这一批、点没问题/要改）
    let m = p.match(/^\/r\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)(\/.*)?$/);
    if (m) {
      const bid = verify(m[1], 'R'); const b = bid && getBatch(bid); if (!b) return send(res, 403, shell('链接失效', '<form><h1>审稿链接已失效</h1></form>'), 'text/html; charset=utf-8');
      const sub = m[2] || '/';
      if (sub === '/') { const h = page(); return h ? send(res, 200, h, 'text/html; charset=utf-8') : send(res, 503, '页面更新中'); }
      if (sub === '/data') { const sid = (briefs().find(x => x.id === b.brief) || {}).store; return J(res, { ok: true, share: true, batch: b, layouts: LAYOUTS, photos: photosOf(sid).map(f => `${sid}/${f}`).concat(sucaiFor(sid)) }); }
      const pm = sub.match(/^\/photo\/([A-Za-z0-9_-]+)\/(\d+\.jpg)$/); if (pm) { const f = path.join(PD, pm[1], pm[2]); if (!fs.existsSync(f)) return send(res, 404, ''); const buf = fs.readFileSync(f); res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': buf.length, 'cache-control': 'private, max-age=86400' }); return res.end(buf); }
      { const um = sub.match(/^\/up\/(\d+\.jpg)$/); if (um) return serveJpg(res, upFile(bid, um[1])); }
      if (sub === '/mark' && req.method === 'POST') { const j = JSON.parse(await body(req, 90000) || '{}'); return J(res, { ok: true, note: mark(bid, j.no, j.status === 'ok' ? 'shop_ok' : j.status === 'fix' ? 'shop_fix' : '', j.note ? '【商家】' + j.note : '', '商家', { page: j.page, pages: j.pages }) }); }
      return send(res, 404, '{}');
    }
    // 需求箱待处理清单（给定时任务读的，凭密钥链接；只有没处理的需求，纯文字）
    m = p.match(/^\/q\/([A-Za-z0-9_-]{12,})$/);
    if (m) { if (m[1] !== META.askKey) return send(res, 403, 'no'); const A = rj(AF, { items: [] }); const pend = A.items.filter(x => x.status === 'todo');
      const esc = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      return send(res, 200, `<!doctype html><meta charset="utf-8"><title>需求箱</title><h1>待处理 ${pend.length} 条</h1>` + pend.map(x => `<article><h2>编号 ${x.id}</h2><p>提的人：${esc(x.by)}（${esc(ROLE[x.role] || x.role)}）｜页面：${esc(x.page || '-')}｜时间：${new Date(x.at + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')}</p><blockquote>${esc(x.text)}</blockquote></article>`).join('') + (pend.length ? '' : '<p>NONE 没有待处理的需求</p>'), 'text/html; charset=utf-8'); }
    // 评论任务大厅（不用登录，凭大厅链接）
    m = p.match(/^\/h\/([A-Za-z0-9_-]{8,})(\/.*)?$/);
    if (m) {
      if (m[1] !== META.hallKey) return send(res, 403, shell('链接失效', '<form><h1>大厅链接已更换</h1><p>找运营要新链接。</p></form>'), 'text/html; charset=utf-8');
      const sub = m[2] || '/';
      if (sub === '/') { const h0 = page(); return h0 ? send(res, 200, h0, 'text/html; charset=utf-8') : send(res, 503, '页面更新中'); }
      if (sub === '/data') { const name = String(u.searchParams.get('name') || '').slice(0, 20); const mine = tasks().filter(t => t.floors.some(f => f.claim && f.claim.name === name)).slice(0, 40).map(t => ({ id: t.id, no: t.no, url: t.url, status: t.status, due: t.due, floors: t.floors.filter(f => f.claim && f.claim.name === name).map(f => ({ seat: f.seat, text: f.text, img: f.img, wantImg: !!f.wantImg, dish: f.dish || '', store: t.store, done: f.done ? { at: f.done.at, ok: f.done.ok } : null })) }));
        const mon = bjDay().slice(0, 7); const doneN = tasks().reduce((a, t) => a + t.floors.filter(f => f.claim && f.claim.name === name && f.done && f.done.ok !== false && bjDay(f.done.at).slice(0, 7) === mon).length, 0);
        return J(res, { ok: true, today: bjDay(), open: hallView(name), mine, doneN }); }
      if (sub === '/lib') return J(res, { ok: true, lib: hallLib() });
      if (sub === '/act' && req.method === 'POST') { try { return J(res, hallAct(JSON.parse(await body(req, 8e6) || '{}'))); } catch (e) { return J(res, { ok: false, error: e.message }); } }
      const pm2 = sub.match(/^\/photo\/([A-Za-z0-9_-]+)\/(\d+\.jpg)$/); if (pm2) return serveJpg(res, path.join(PD, pm2[1], pm2[2]));
      return send(res, 404, '{}');
    }
    // 派发卡片（不用登录，只能看这一篇：存图、复制文案、发完贴链接）
    m = p.match(/^\/c\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)(\/.*)?$/);
    if (m) {
      const w = verify(m[1], 'C'); const [cbid, cno] = String(w || '').split('~'); const cb = w && getBatch(cbid); const cn = cb && cb.notes.find(x => x.no === +cno);
      if (!cn) return send(res, 403, shell('链接失效', '<form><h1>卡片链接已失效</h1><p>找发稿的同事重新发一个。</p></form>'), 'text/html; charset=utf-8');
      const sub = m[2] || '/';
      if (sub === '/') { const h = page(); return h ? send(res, 200, h, 'text/html; charset=utf-8') : send(res, 503, '页面更新中'); }
      if (sub === '/data') return J(res, { ok: true, briefName: cb.briefName, note: { no: cn.no, title: cn.title, body: cn.body, tags: cn.tags, assign: cn.assign || null, pub: cn.pub || null }, today: bjDay(), pages: cn.cardPages ? Array.from({ length: cn.cardPages }, (_, i) => `img/${i + 1}.jpg`) : cb.kind === 'manual' ? (cn.images || []).map(f => 'up/' + f) : [] });
      let im = sub.match(/^\/img\/(\d+\.jpg)$/); if (im) return serveJpg(res, cardFile(cbid, cno, im[1]));
      im = sub.match(/^\/up\/(\d+\.jpg)$/); if (im) return serveJpg(res, upFile(cbid, im[1]));
      if (sub === '/pub' && req.method === 'POST') { const j = JSON.parse(await body(req, 4000) || '{}'); try { const r = pub(cbid, cno, j.url, (cn.assign || {}).acct || '发布人'); if (bossDm) bossDm(`✅ ${(cn.assign || {}).acct || ''} 发布了《${cn.title}》：${r.url}`).catch(() => { }); return J(res, { ok: true, pub: r }); } catch (e) { return J(res, { ok: false, error: e.message }); } }
      return send(res, 404, '{}');
    }
    const me = userOf(req);
    if (!me) { if (p.startsWith('/api/') || p.startsWith('/img/')) return send(res, 401, '{"ok":false,"error":"请先登录"}'); return send(res, 200, loginPage(''), 'text/html; charset=utf-8'); }
    if (p === '/' || p === '/index.html') { const h = page(); return h ? send(res, 200, h, 'text/html; charset=utf-8') : send(res, 503, '页面更新中'); }
    m = p.match(/^\/img\/([0-9a-f]{24})\/(\d+\.(?:jpg|png|webp))$/);
    if (m) { const f = glib.imgPath(m[1], m[2]); if (!f) return send(res, 404, ''); const buf = fs.readFileSync(f); res.writeHead(200, { 'content-type': /png$/.test(f) ? 'image/png' : /webp$/.test(f) ? 'image/webp' : 'image/jpeg', 'content-length': buf.length, 'cache-control': 'private, max-age=86400' }); return res.end(buf); }
    const isBoss = me.role === 'boss', canWork = me.role === 'boss' || me.role === 'ops';
    if (me.role === 'writer' && !/^\/(api\/(me|mine|submit|briefs|asks)|up\/)/.test(p)) return send(res, 403, '{"ok":false,"error":"写手账号只能投稿"}');
    m = p.match(/^\/up\/(g[0-9a-z]+)\/(\d+\.jpg)$/); if (m) { if (me.role === 'writer' && (getBatch(m[1]) || {}).byId !== me.id) return send(res, 403, ''); return serveJpg(res, upFile(m[1], m[2])); }
    try {
      // 需求箱（林总 2026-11-27：员工对软件有什么需求直接提，不用都经过我）：谁都能提；自己看自己的，老板看全部；处理完写回复
      if (p === '/api/asks') { const A = rj(AF, { items: [] });
        if (req.method === 'POST') { const j = JSON.parse(await body(req, 6000)); const text = String(j.text || '').trim().slice(0, 1000); if (text.length < 4) throw new Error('写具体一点：哪个页面、想怎么改');
          if (j.id && isBoss) { const it = A.items.find(x => x.id === j.id); if (!it) throw new Error('没有这条'); it.status = ['todo', 'doing', 'done', 'no'].includes(j.status) ? j.status : it.status; it.reply = text; it.replyAt = Date.now(); wj(AF, A); return J(res, { ok: true }); }
          const it = { id: 'a' + Date.now().toString(36), text, page: String(j.page || '').slice(0, 30), by: me.name, byId: me.id, role: me.role, at: Date.now(), status: 'todo' }; A.items.push(it); wj(AF, A);
          if (bossDm && !isBoss) bossDm(`📮 攻略平台需求箱：${me.name}（${ROLE[me.role] || me.role}）提了一条\n「${text.slice(0, 200)}」\n${it.page ? '页面：' + it.page + '\n' : ''}已记下，处理完会在平台上回复他。`).catch(() => { });
          return J(res, { ok: true, id: it.id }); }
        return J(res, { ok: true, boss: isBoss, feed: isBoss ? `${base}q/${askKey()}` : undefined, items: A.items.filter(x => isBoss || x.byId === me.id).slice(-80).reverse() }); }
      if (p === '/api/me') return J(res, { ok: true, me: { name: me.name, role: me.role, roleName: ROLE[me.role] }, layouts: LAYOUTS });
      if (p === '/api/dash') { const B = batches(); const st = glib.status(); return J(res, { ok: true, lib: { total: st.total, night: st.night, day: st.day, pause: st.pause, window: st.window, authors: st.authors, seed: st.seed }, stores: stores().length, briefs: briefs().length, batches: B.length, notes: B.reduce((s, b) => s + b.notes.length, 0), late: pubs().filter(x => x.late).length, due: pubs().filter(x => x.due).length, todo: B.reduce((s, b) => s + b.notes.filter(n => n.status === 'todo').length, 0), recent: B.slice(0, 5).map(b => ({ id: b.id, briefName: b.briefName, layoutName: b.layoutName, at: b.at, n: b.notes.length, status: b.status })) }); }
      if (p === '/api/submit' && req.method === 'POST') { const j = JSON.parse(await body(req, 30e6)); const b = submit(j, me); return J(res, { ok: true, id: b.id }); }
      if (p === '/api/mine') return J(res, { ok: true, mine: batches().filter(b => b.kind === 'manual' && b.byId === me.id).map(b => ({ id: b.id, at: b.at, brief: b.brief, briefName: b.briefName, note: b.notes[0] })) });
      m = p.match(/^\/api\/batch\/(g[0-9a-z]+)\/rereview$/); if (m && req.method === 'POST' && canWork) { const j = JSON.parse(await body(req, 2000)); const b = getBatch(m[1]); const B = b && briefs().find(x => x.id === b.brief); if (!b || !B || b.kind === 'manual') throw new Error('这篇不能复审'); const i = b.notes.findIndex(x => x.no === +j.no); if (i < 0) throw new Error('没有这一篇');
        const all = stores(); const main = all.find(x => x.id === B.store); const pool = poolOf(B, all, main); const plan = b.plans ? b.plans[i] : null; const old = b.notes[i]; const rv = await aiReview(old, B, pool, main, b, plan);
        const nn = Object.assign({}, rv.note, { no: old.no, dir: old.dir, plan: old.plan, tpl: old.tpl, status: old.status, notes: old.notes, model: old.model, aiReview: rv.review }); b.notes[i] = nn; nn.check = check(nn, B, b); wj(path.join(BD, b.id + '.json'), b); return J(res, { ok: true, review: rv.review }); }
      m = p.match(/^\/api\/batch\/(g[0-9a-z]+)\/pics$/); if (m && req.method === 'POST' && me.role !== 'writer') { const j = JSON.parse(await body(req, 4000)); const f = path.join(BD, m[1] + '.json'); const b = getBatch(m[1]); const n = b && b.notes.find(x => x.no === +j.no); if (!n) throw new Error('没有这一篇'); // 审稿的人自己挑配图：美食页 2 张、最后一页 4 张，存文件名
        const clean = (a, k) => (Array.isArray(a) ? a : []).map(String).filter(x => /^[\w.\-\/]+$/.test(x) && !x.includes('..')).slice(0, k); if (j.sty) { const y = j.sty || {}; const pickv = (x, arr, d) => arr.includes(x) ? x : d; const sty = { fk: pickv(+y.fk, [0.88, 1, 1.14], 0), tk: pickv(+y.tk, [0.88, 1, 1.12], 1), tf: pickv(String(y.tf || ''), ['hei', 'song', 'kai', 'yuan'], ''), bf: pickv(String(y.bf || ''), ['hei', 'song', 'kai', 'yuan'], ''), tc: pickv(String(y.tc || ''), ['black', 'red', 'orange', 'brown', 'green', 'blue', 'purple'], ''), ac: pickv(String(y.ac || ''), ['black', 'red', 'orange', 'brown', 'green', 'blue', 'purple'], '') };
          const plain = !sty.fk && sty.tk === 1 && !sty.tf && !sty.bf && !sty.tc && !sty.ac; (j.all ? b.notes : [n]).forEach(x => { if (plain) { delete x.sty; delete x.fk; } else { x.sty = sty; if (sty.fk) x.fk = sty.fk; else delete x.fk; } }); n.notes.push({ t: (j.all ? '整批' : '') + '改了字体/字号/颜色', who: me.name, at: Date.now() }); wj(f, b); return J(res, { ok: true }); } // 每篇稿的排版选项，只收预设值
        if (j.fk !== undefined) { const v = +j.fk; if ([0.88, 1, 1.14].includes(v)) n.fk = v; else delete n.fk; if (n.sty) n.sty.fk = n.fk || 0; n.notes.push({ t: '字号改成' + ({ 0.88: '小', 1: '中', 1.14: '大' }[n.fk] || '自动'), who: me.name, at: Date.now() }); wj(f, b); return J(res, { ok: true }); } // 这篇稿每页统一字号
        const pics = { food: clean((j.pics || {}).food, 2), last: clean((j.pics || {}).last, 9) }; if (pics.food.length || pics.last.length) n.pics = pics; else delete n.pics; n.notes.push({ t: '换了配图', who: me.name, at: Date.now() }); wj(f, b); return J(res, { ok: true }); }
      m = p.match(/^\/api\/batch\/(g[0-9a-z]+)\/edit$/); if (m && req.method === 'POST' && me.role !== 'writer') return J(res, { ok: true, note: edit(m[1], JSON.parse(await body(req, 50000)), me.name) });
      m = p.match(/^\/api\/batch\/(g[0-9a-z]+)\/pages$/); if (m && req.method === 'POST' && canWork) { const j = JSON.parse(await body(req, 40e6)); savePages(m[1], j.no, j.pages); return J(res, { ok: true }); }
      m = p.match(/^\/api\/batch\/(g[0-9a-z]+)\/assign$/); if (m && req.method === 'POST' && canWork) return J(res, assign(m[1], JSON.parse(await body(req, 4000)), me.name));
      m = p.match(/^\/api\/batch\/(g[0-9a-z]+)\/pub$/); if (m && req.method === 'POST' && canWork) { const j = JSON.parse(await body(req, 4000)); return J(res, { ok: true, pub: j.clear ? (() => { const b = getBatch(m[1]); const n = b && b.notes.find(x => x.no === +j.no); if (n) { delete n.pub; wj(path.join(BD, m[1] + '.json'), b); } return null; })() : pub(m[1], j.no, j.url, me.name) }); }
      if (p === '/api/writers') { // 写手稿：按月统计每个写手交稿/通过/要改/已发布，和这个月的稿
        const mon = /^\d{4}-\d{2}$/.test(u.searchParams.get('month') || '') ? u.searchParams.get('month') : bjDay().slice(0, 7); const who = u.searchParams.get('w') || '';
        const L = batches().filter(b => b.kind === 'manual' && bjDay(b.firstAt || b.at).slice(0, 7) === mon); const W = new Map();
        U.users.filter(x => x.role === 'writer' && !x.off).forEach(x => W.set(x.id, { id: x.id, name: x.name, sub: 0, ok: 0, fix: 0, todo: 0, assigned: 0, pub: 0 }));
        L.forEach(b => { const n = b.notes[0]; const w = W.get(b.byId) || (W.set(b.byId, { id: b.byId, name: b.by, sub: 0, ok: 0, fix: 0, todo: 0, assigned: 0, pub: 0 }), W.get(b.byId)); w.sub++; if (/ok/.test(n.status)) w.ok++; else if (/fix/.test(n.status)) w.fix++; else w.todo++; if (n.assign) w.assigned++; if (n.pub) w.pub++; });
        const list = L.filter(b => !who || b.byId === who).map(b => { const B = briefs().find(x => x.id === b.brief); b.notes.forEach(n => { n.check = checkManual(n, B); }); return b; });
        const months = [...new Set(batches().filter(b => b.kind === 'manual').map(b => bjDay(b.firstAt || b.at).slice(0, 7)))].sort().reverse();
        return J(res, { ok: true, month: mon, months: months.includes(mon) ? months : [mon, ...months], stats: [...W.values()].sort((a, c) => c.sub - a.sub), list, writers: U.users.filter(x => x.role === 'writer' && !x.off).map(x => ({ id: x.id, name: x.name })) });
      }
      if (p === '/api/writerlist') return J(res, { ok: true, writers: me.role === 'writer' ? [] : U.users.filter(x => x.role === 'writer' && !x.off).map(x => ({ id: x.id, name: x.name })) });
      if (p === '/api/cands' && req.method === 'GET') { const B = briefs().find(x => x.id === u.searchParams.get('brief')) || briefs()[0]; return J(res, { ok: true, brief: B && B.id, near: B ? nearOf(B) : [], focus: glib && glib.focus ? glib.focus() : [], items: candList(B && B.id) }); }
      if (p === '/api/cands' && req.method === 'POST' && canWork) { const j = JSON.parse(await body(req, 20000)); const B = briefs().find(x => x.id === j.brief) || briefs()[0];
        if (j.run) { extractCands().catch(() => { }); return J(res, { ok: true }); }
        if (j.own) { ownCands().catch(() => { }); return J(res, { ok: true, running: true }); }
        const names = [].concat(j.names || []); let add = 0;
        for (const nm of names) { const c = CA.items.find(x => x.name === nm); if (!c) continue; if (j.ignore) { c.st = 'ignored'; continue; }
          const L2 = stores(); L2.push({ id: 's' + Date.now().toString(36) + add, name: c.name, planted: false, district: B.district, area: String(j.area || c.area || '').slice(0, 20), cat: c.cat, slot: '', dishes: c.dishes, price: c.price, star: '', years: '', hours: c.hours, addr: c.addr, src: '爆款库', verify: true, refNotes: c.notes.map(z => z.id) }); wj(SF, L2); c.st = 'added'; add++; }
        saveC(); return J(res, { ok: true, add }); }
      if (p === '/api/llmstat' && isBoss) return J(res, Object.assign({ ok: true }, await llmStat()));
      if (p === '/api/llmkey' && isBoss && req.method === 'POST') { const j = JSON.parse(await body(req, 2000)); if (j.reset) { try { fs.unlinkSync(KF); } catch (e) { } cfg.qwenKey = QWEN_ORIG; GLK = null; return J(res, { ok: true, reset: true }); } const r0 = await setQwenKey(j.qwenKey, me.name, j.base); return J(res, { ok: true, scope: r0.scope, tail: String(j.qwenKey).trim().slice(-4) }); }
      if (p === '/api/ownstat') return J(res, { ok: true, run: ownRun, log: CA.ownLog || null, cands: CA.items.filter(c => c.own).length });
      if (p === '/api/mkt' && isBoss && rosterSrc) { const r = await rosterSrc(String(u.searchParams.get('table') || '')); return J(res, { ok: true, fields: r.fields, n: r.n, rows: r.rows.slice(0, +u.searchParams.get('n') || 3000) }); } // 老板读营销部表格（建任务书用，敏感表 core 那边会拒）
      if (p === '/api/roster') { const L = await roster(); return J(res, { ok: true, roster: L, diag: isBoss ? RO.diag : undefined }); }
      if (p === '/api/settle' && req.method === 'GET') { const mon = /^\d{4}-\d{2}$/.test(u.searchParams.get('month') || '') ? u.searchParams.get('month') : bjDay().slice(0, 7); return J(res, { ok: true, month: mon, rates: rates(), rows: settle(mon) }); }
      if (p === '/api/settle' && req.method === 'POST' && isBoss) { const j = JSON.parse(await body(req, 20000));
        if (j.rates) { const R = {}; for (const k of Object.keys(RATE0)) if (j.rates[k] !== undefined) R[k] = Math.max(0, Math.round(+j.rates[k] * 100) / 100 || 0); META.rates = Object.assign(rates(), R); }
        if (j.paid && /^\d{4}-\d{2}$/.test(j.month)) { META.paid = META.paid || {}; const m2 = META.paid[j.month] = META.paid[j.month] || {}; if (j.undo) delete m2[j.paid]; else m2[j.paid] = { at: Date.now(), who: me.name, amt: +j.amt || 0 }; }
        saveMeta(); return J(res, { ok: true }); }
      if (p === '/api/ctask' && req.method === 'GET') { const L = tasks().slice(0, 120).map(t => Object.assign({}, t, { floors: t.floors.map(f => Object.assign({}, f, { shot: f.done ? `${t.id}/${f.seat}.jpg` : '' })) })); return J(res, { ok: true, list: L, hall: canWork ? hallUrl() : '', pubs: pubs().filter(x => x.pub).slice(0, 40).map(x => ({ url: x.pub.url, title: x.title, acct: x.acct })), plays: Object.fromEntries(Object.entries(PLAYS).map(([k, v]) => [k, v[0]])) }); }
      if (p === '/api/ctask' && req.method === 'POST' && me.role !== 'writer') { const j = JSON.parse(await body(req, 200000));
        if (j.gen) return J(res, { ok: true, list: await genTasks(j, me.name) });
        if (j.resetHall && isBoss) { META.hallKey = ''; return J(res, { ok: true, hall: hallUrl() }); }
        const t = getTask(j.id); if (!t) throw new Error('没有这组');
        if (j.del) { fs.unlinkSync(path.join(TD, t.id + '.json')); return J(res, { ok: true }); }
        if (j.floors) t.floors.forEach(f => { const e = j.floors.find(x => x.seat === f.seat); if (e && e.text !== undefined) { f.text = String(e.text).slice(0, 80); f.bad = CMT_BAD.filter(w => f.text.includes(w)); } if (e && e.img !== undefined) f.img = String(e.img).slice(0, 40); });
        if (j.status && ['draft', 'open', 'done'].includes(j.status)) t.status = j.status; if (j.due) t.due = String(j.due).slice(0, 10); if (j.url) t.url = String(j.url).slice(0, 500);
        if (j.review) { const f = t.floors.find(x => x.seat === j.review.seat); if (f && f.done) { f.done.ok = !!j.review.ok; f.done.by = me.name; if (!f.done.ok) t.status = 'open'; } }
        if (j.release) { const f = t.floors.find(x => x.seat === j.release); if (f && !f.done) delete f.claim; }
        saveTask(t); return J(res, { ok: true }); }
      m = p.match(/^\/cshot\/(t[0-9a-z]+)\/([A-Z])\.jpg$/); if (m) return serveJpg(res, path.join(SHD, m[1], m[2] + '.jpg'));
      if (p === '/api/cmt' && req.method === 'GET') return J(res, { ok: true, list: cmtList().slice(0, 60), plays: Object.fromEntries(Object.entries(PLAYS).map(([k, v]) => [k, v[0]])) });
      if (p === '/api/cmt' && req.method === 'POST' && me.role !== 'writer') { const j = JSON.parse(await body(req, 20000)); if (j.del) { try { fs.unlinkSync(path.join(CD2, String(j.del).replace(/[^a-z0-9]/g, '') + '.json')); } catch (e) { } return J(res, { ok: true }); } return J(res, { ok: true, rec: await genCmt(j, me.name) }); }
      if (p === '/api/cmt/peek') return J(res, { ok: true, known: noteTextOf(u.searchParams.get('url') || '') });
      if (p === '/api/pubs') return J(res, { ok: true, pubs: pubs(), today: bjDay() });
      if (p === '/api/lib') return J(res, glib.query(Object.fromEntries(u.searchParams)));
      m = p.match(/^\/api\/lib\/([0-9a-f]{24})$/); if (m) { const n = glib.get(m[1]); return J(res, n ? { ok: true, note: n } : { ok: false, error: '没有这篇' }); }
      if (p === '/api/night') return J(res, glib.status());
      m = p.match(/^\/photo\/([A-Za-z0-9_-]+)\/(\d+\.jpg)$/); if (m) { const f = path.join(PD, m[1], m[2]); if (!fs.existsSync(f)) return send(res, 404, ''); const buf = fs.readFileSync(f); res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': buf.length, 'cache-control': 'private, max-age=86400' }); return res.end(buf); }
      m = p.match(/^\/api\/photos\/([A-Za-z0-9_-]+)$/);
      if (m && req.method === 'GET') return J(res, { ok: true, photos: photosOf(m[1]), sucai: sucaiFor(m[1]), sucaiAt: SC.at, sucaiOn: !!sucai });
      if (p === '/api/sucai/sync' && req.method === 'POST') { if (!canWork) return J(res, { ok: false, error: '没有权限' }); syncSucai().catch(e => log('[攻略平台] 素材库同步出错：' + e.message)); return J(res, { ok: true, started: true, total: SC.items.length }); }
      if (m && req.method === 'POST' && (canWork || me.role === 'review')) { const j = JSON.parse(await body(req, 8e6)); if (j.del && !canWork) throw new Error('删图要运营或老板来'); const dir = path.join(PD, m[1]); fs.mkdirSync(dir, { recursive: true }); // 审稿的人换配图时可以往图库加图，不能删
        if (j.del) { if (/^\d+\.jpg$/.test(j.del)) try { fs.unlinkSync(path.join(dir, j.del)); } catch (e) { } return J(res, { ok: true, photos: photosOf(m[1]) }); }
        const b64 = String(j.data || '').replace(/^data:image\/jpeg;base64,/, ''); const buf = Buffer.from(b64, 'base64'); if (buf.length < 1000 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('只收 jpg 图片');
        const n = Math.max(0, ...photosOf(m[1]).map(f => parseInt(f))) + 1; fs.writeFileSync(path.join(dir, n + '.jpg'), buf); return J(res, { ok: true, photos: photosOf(m[1]) }); }
      if (p === '/api/stores' && req.method === 'GET') return J(res, { ok: true, stores: stores() });
      if (p === '/api/stores' && req.method === 'POST' && canWork) { const j = JSON.parse(await body(req)); const L = stores(); const s = j.store || {}; if (!s.name) throw new Error('店名不能空'); const i = L.findIndex(x => x.id === s.id); const clean = { id: s.id || 's' + Date.now().toString(36), name: String(s.name).slice(0, 40), planted: !!s.planted, district: String(s.district || ''), area: String(s.area || ''), cat: String(s.cat || ''), slot: String(s.slot || ''), dishes: String(s.dishes || ''), price: +s.price || null, star: +s.star || null, hours: String(s.hours || ''), addr: String(s.addr || ''), checked: s.checked ? Date.now() : (i >= 0 ? L[i].checked : null) }; if (j.del && i >= 0) L.splice(i, 1); else if (i >= 0) L[i] = Object.assign(L[i], clean); else L.push(clean); wj(SF, L); return J(res, { ok: true }); }
      if (p === '/api/refs' && req.method === 'GET') return J(res, { ok: true, refs: refs() });
      if (p === '/api/refs' && req.method === 'POST' && canWork) { const j = JSON.parse(await body(req, 40e6)); const L = refs(); let touched = '';
        if (j.del) { const i = L.findIndex(x => x.id === j.del); if (i >= 0) L.splice(i, 1); try { fs.rmSync(path.join(RID, String(j.del).replace(/[^a-z0-9]/g, '')), { recursive: true, force: true }); } catch (e) { } META.refDel = (META.refDel || []).concat(j.del); saveMeta(); }
        else if (j.id) { const r = L.find(x => x.id === j.id); if (!r) throw new Error('没有这篇范文'); if (j.delImg) { r.imgs = (r.imgs || []).filter(f => f !== j.delImg); const f = refImgFile(r.id, j.delImg); if (f) try { fs.unlinkSync(f); } catch (e) { } if (r.imgs.length) touched = r.id; else delete r.imgDesc; } if (j.imgs) addRefImgs(r, j.imgs); touched = r.id; }
        else { const t = String(j.text || '').trim(); if (t.length < 50) throw new Error('范文太短'); const r = { id: 'r' + Date.now().toString(36), name: String(j.name || t.split('\n')[0]).slice(0, 40), text: t.slice(0, 5000), by: me.name, at: Date.now() }; if (j.imgs && j.imgs.length) { addRefImgs(r, j.imgs); touched = r.id; } L.push(r); }
        wj(RF, L); if (touched) describeRef(touched); return J(res, { ok: true, n: L.length }); }
      m = p.match(/^\/refimg\/(r[0-9a-z]+)\/(\d+\.jpg)$/); if (m) return serveJpg(res, refImgFile(m[1], m[2]));
      if (p === '/api/briefs' && req.method === 'GET') return J(res, { ok: true, briefs: briefs() });
      if (p === '/api/briefs' && req.method === 'POST' && canWork) { const j = JSON.parse(await body(req)); const L = briefs();
        if (j.del) { const i = L.findIndex(x => x.id === j.del); if (i >= 0 && L.length > 1) L.splice(i, 1); else throw new Error('至少留一份任务书'); wj(BF, L); return J(res, { ok: true }); }
        const b = cleanBrief(j.brief || {}); const i = L.findIndex(x => x.id === b.id); if (i >= 0) L[i] = Object.assign(L[i], b); else { const nb = Object.assign({}, b, { id: 'b' + Date.now().toString(36) }); for (const k of ['name', 'store', 'storeTitle', 'mustDish']) if (!nb[k]) throw new Error('任务书名字、主店、主店标题、必写菜都要填'); L.push(Object.assign({ yesPos: 2, minDishes: 3, tagsOptN: 2, tagsTotal: 9, directions: [], dishes: {}, mustSpots: [], optSpots: [], tagsMust: [], tagsOpt: [], banned: [] }, nb)); } wj(BF, L); return J(res, { ok: true }); }
      if (p === '/api/gen' && req.method === 'POST' && canWork) { const j = JSON.parse(await body(req)); const n = Math.max(1, Math.min(10, +j.n || 3)); return J(res, { ok: true, batch: await generate(j.brief, j.layout, n, me.name) }); }
      if (p === '/api/batches') return J(res, { ok: true, batches: batches().filter(b => u.searchParams.get('kind') === 'manual' ? b.kind === 'manual' : u.searchParams.get('kind') === 'ai' ? b.kind !== 'manual' : true).map(b => ({ id: b.id, briefName: b.briefName, layoutName: b.layoutName, at: b.at, n: b.n, got: b.notes.length, status: b.status, err: b.err, ok: b.notes.filter(x => /ok/.test(x.status)).length, fix: b.notes.filter(x => /fix/.test(x.status)).length, errs: b.notes.filter(x => x.check.some(c => c[0] === 'err')).length })) });
      m = p.match(/^\/api\/batch\/(g[0-9a-z]+)$/); if (m) { const b = getBatch(m[1]); if (b) { const B = briefs().find(x => x.id === b.brief); if (B && b.kind !== 'manual' && B.tagsTotal && b.notes.some(n => (n.tags || []).length < 8)) { b.notes.forEach(n => { for (const t of [...B.tagsMust, ...B.tagsOpt]) { if (n.tags.length >= B.tagsTotal) break; if (!n.tags.includes(t)) n.tags.push(t); } }); wj(path.join(BD, b.id + '.json'), b); } // 改规则前出的稿：话题补到 8–10 个
        if (B || b.kind === 'manual') b.notes.forEach(n => { n.check = checkOf(n, B, b); }); } return J(res, b ? { ok: true, batch: b, layouts: LAYOUTS, sid: (briefs().find(x => x.id === b.brief) || {}).store || '', photos: (sid => photosOf(sid).map(f => `${sid}/${f}`).concat(sucaiFor(sid)))((briefs().find(x => x.id === b.brief) || {}).store) } : { ok: false, error: '没有这个批次' }); } // 按最新任务书重新核对
      m = p.match(/^\/api\/batch\/(g[0-9a-z]+)\/mark$/); if (m && req.method === 'POST') { const j = JSON.parse(await body(req, 90000)); return J(res, { ok: true, note: mark(m[1], j.no, ['ok', 'fix', 'todo'].includes(j.status) ? j.status : '', j.note, me.name, { page: j.page, pages: j.pages }) }); }
      m = p.match(/^\/api\/batch\/(g[0-9a-z]+)\/share$/); if (m && req.method === 'POST' && canWork) { if (!getBatch(m[1])) throw new Error('没有这个批次'); return J(res, { ok: true, url: `${base}r/${sign(`R|${m[1]}|${Date.now() + 14 * DAY}`)}` }); }
      if (p === '/api/users' && isBoss) return J(res, { ok: true, users: U.users.map(x => ({ id: x.id, name: x.name, role: x.role, roleName: ROLE[x.role], login: x.login || '', set: !!x.hash, off: !!x.off, last: x.last || null })) });
      if (p === '/api/users' && req.method === 'POST' && isBoss) { const j = JSON.parse(await body(req, 4096)); if (j.off) { const x = U.users.find(z => z.id === j.id && z.role !== 'boss'); if (!x) throw new Error('没有这个人'); x.off = true; saveU(); return J(res, { ok: true }); }
        if (j.reset) { const x = U.users.find(z => z.id === j.id); if (!x) throw new Error('没有这个人'); x.off = false; saveU(); return J(res, { ok: true, link: setupLink(x.id, 24) }); }
        const name = String(j.name || '').trim().slice(0, 20); if (!name) throw new Error('名字不能空'); const role = ['ops', 'review', 'writer'].includes(j.role) ? j.role : 'ops'; const x = { id: 'u' + crypto.randomBytes(4).toString('hex'), name, role, at: Date.now() }; U.users.push(x); saveU(); return J(res, { ok: true, link: setupLink(x.id, 24) }); }
      return send(res, 404, '{"ok":false,"error":"没有这个接口或没有权限"}');
    } catch (e) { return J(res, { ok: false, error: e.message.slice(0, 200) }); }
  }
  ensureBoss();
  // 第一次上线：没有任何出稿就自动用白石洲任务书出一批样稿（每个版式 2 篇），老板早上直接验收
  // 第一次出样稿有几篇失败（模型 JSON 不规范，已修）：把没出满的系统样稿重出一次
  setTimeout(() => { try { if (META.sampled2 || !META.sampled) return; META.sampled2 = Date.now(); saveMeta(); let i = 0; for (const b of batches()) { if (b.by !== '系统样稿' || b.status === 'running' || b.notes.length >= b.n) continue; try { fs.unlinkSync(path.join(BD, b.id + '.json')); } catch (e) { } const l = b.layout; setTimeout(() => generate(b.brief, l, 2, '系统样稿').catch(e => log('[攻略平台] 样稿出错：' + e.message)), (i++) * 20e3); } } catch (e) { log('[攻略平台] 补样稿出错：' + e.message); } }, 60e3);
  setTimeout(() => { try { if (batches().length || !(cfg.qwenKey || cfg.deepseekKey) || META.sampled) return; META.sampled = Date.now(); saveMeta(); const b = briefs()[0]; if (!b) return; ['clean', 'green', 'nav', 'memo'].forEach((l, i) => setTimeout(() => generate(b.id, l, 2, '系统样稿').catch(e => log('[攻略平台] 样稿出错：' + e.message)), i * 20e3)); log('[攻略平台] 开始出样稿'); } catch (e) { log('[攻略平台] 样稿出错：' + e.message); } }, 90e3);
  return { genCmt, genTasks, handle, generate, LAYOUTS, syncSucai, sucaiFor, _t: { submit, assign, pubs, pub, edit, getBatch, checkManual, makePlans, promptFor, poolOf, briefs, stores }, bossSetupLink: (h) => setupLink(ensureBoss().id, h || 6) };
}
module.exports = { createGlweb };
