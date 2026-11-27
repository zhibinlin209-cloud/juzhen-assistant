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
  route: { name: '一日游路线表', desc: '路线时间表＋景点小贴士＋吃饭清单＋主店介绍' }
};

function createGlweb({ dataDir, log, cfg, glib, base, bossDm, sucai }) {
  const D = path.join(dataDir, 'gl'); const BD = path.join(D, 'batches'), PD = path.join(D, 'photos'); [D, BD, PD].forEach(d => fs.mkdirSync(d, { recursive: true }));
  const rj = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
  const wj = (f, v) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f); };
  const UF = path.join(D, 'users.json'), SF = path.join(D, 'stores.json'), BF = path.join(D, 'briefs.json'), MF = path.join(D, 'meta.json'), RF = path.join(D, 'refs.json');
  let U = rj(UF, { users: [] }), META = rj(MF, {});
  if (!fs.existsSync(SF) || !fs.existsSync(BF)) { const seed = require('./glseed'); if (!fs.existsSync(SF)) wj(SF, seed.shops); if (!fs.existsSync(BF)) wj(BF, [seed.brief]); log('[攻略平台] 导入初始门店池和白石洲任务书'); }
  { const L = rj(RF, []); const del = (rj(path.join(D, 'meta.json'), {}).refDel || []); const add = (require('./glseed').refs || []).filter(r => !L.some(x => x.id === r.id) && !del.includes(r.id)); if (add.length || !fs.existsSync(RF)) wj(RF, L.concat(add)); } // 新加进初始数据的范文自动补进来
  const stores = () => rj(SF, []), briefs = () => rj(BF, []), refs = () => rj(RF, []);
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
  async function llm(prompt) {
    const tries = [];
    if (cfg.deepseekKey) tries.push(['https://api.deepseek.com/chat/completions', cfg.deepseekKey, 'deepseek-chat']);
    if (cfg.qwenKey) for (const m of cfg.glModels || ['deepseek-v4-pro', 'deepseek-v3.2', 'qwen-plus']) tries.push(['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', cfg.qwenKey, m]);
    let last = '没有配置大模型';
    for (const [u, k, model] of tries) {
      try { const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + k }, signal: AbortSignal.timeout(240000), body: JSON.stringify({ model, temperature: 0.85, max_tokens: 8000, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }) });
        const j = await r.json().catch(() => ({})); if (r.ok) { const t = (((j.choices || [])[0] || {}).message || {}).content || ''; if (t) return { text: t, model }; last = '返回空内容（' + (((j.choices || [])[0] || {}).finish_reason || '') + '）'; log(`[攻略平台] 模型 ${model} ${last}`); continue; }
        last = (j.error && (j.error.message || j.error.code)) || ('HTTP ' + r.status); log(`[攻略平台] 模型 ${model} 不可用：${last}`);
      } catch (e) { last = e.message; }
    }
    throw new Error(last);
  }
  const norm = s => String(s || '').replace(/[（(].*?[)）]/g, '').replace(/[\s·・.]/g, '');
  function matchShop(name, pool) { const n = norm(name); if (!n) return null; return pool.find(s => norm(s.name) === n) || pool.find(s => norm(s.name).includes(n) || n.includes(norm(s.name))) || null; }
  function promptFor(B, layout, dir, pool, spots, prev, k) {
    const dishes = Object.entries(B.dishes).map(([c, l]) => `${c}：${l.join('、')}`).join('；');
    const shopLines = pool.map(s => `- ${s.name}｜${s.area}｜${s.cat}｜人均${s.price}｜${s.hours}｜招牌：${s.dishes}`).join('\n');
    const L = LAYOUTS[layout];
    const refText = refs().slice().sort(() => Math.random() - 0.5).slice(0, 2).map((r, i) => `——范文${i + 1}——\n${String(r.text).slice(0, 1200)}`).join('\n') || '（暂无）';
    return `你是小红书本地生活博主，替深圳一家海鲜大排档写一篇「${dir.name}」方向的图文攻略，读起来要像真实游客或本地人自己整理的，不能像广告。
【版式】${L.name}：${L.desc}。你只写文字内容，排版由程序完成。
【读者】${B.audience}
【必须做到】
1. 标题 ≤20 字，必须同时有地点词和需求词（${B.titleRule}），本篇优先往「${dir.words.join('」「')}」这类搜索词靠，不要用感叹号堆砌。
2. 主店是「${B.storeTitle}」，程序会把它单独放成一个分类「${B.mainCat || '晚饭·海鲜大排档'}」、排在美食清单第 2 家，你在 sections 里不要写它。
3. 美食清单 sections 只能用下面门店池里的店（店名照抄，不要编新店）。第一个分类固定叫「中午垫一口」、只放 1 家（粉面/小吃/茶点类）；后面再分 2–3 个分类（如 糖水甜品、夜宵续摊、第二天早餐），分类名要和店的品类对得上，不要把不同品类混在一起，一共 6–9 家；每家一句话（≤18 字）写招牌菜或特点，不要写具体价格以外编造的信息。
4. 主店介绍 yes：爆膏奶油虾必写，再从这些菜里选 2–3 道：${dishes}；每道一句话（≤22 字，具体到口感/吃法，不夸大，不能写“只只爆膏”）。再写 2 条点菜建议（按人数）、1 句什么时候去、1 句适合什么聚会。
5. 景点必须有世界之窗；可以再选 0–2 个：${B.optSpots.join('、')}。景点只写游玩建议，不写门票价格、开放时间等数字（这些我们没核实）。
6. 正文 body 一般 300–550 字（纯美食清单角度可以短到 150 字），照【参考范文】的写法：先从这几种角度里挑一种（同一批里换着用）——纯美食清单（按小吃/海鲜大排档/糖水等分类列店名，主店单独一类，开头一两句纠结口吻就够，正文可以 150 字左右）、景点红黑榜（闭眼冲／顺路打卡／不建议专程去，敢说缺点才可信）、去 X 的大实话（交通怎么到、哪里别自驾）、导航避坑（别只搜「某某」，导航到哪个门/出口最近）、一天路线怎么走。开头 1–2 句钩子，说清这篇帮读者解决什么问题；景点和出行信息是正文主体，用 emoji 或「1、2、3」分段，每条写具体可用的信息；吃的放在最后一段，用 ✅ 或 📍 列 2–5 家（顺序和 sections 一致，主店是第 2 家，店名后面可以跟一句具体的菜），最后一句提示看图。语气像整理攻略的游客或本地人，不要编造太具体的亲身经历，不要像广告；景点信息只写常识性、不会错的内容，拿不准的（门票价格、开放时间、地铁出口编号）不要写；ending 就是正文最后一句，不能和下面已经用过的重复。
7. 禁用词：${B.banned.join('、')}；不要说“无广”“自费”“不是广告”。
8. 话题 tags 只写 2 个，从这里选：${B.tagsOpt.join(' ')}（另外 3 个固定话题程序会加）。
9. cover 是封面大字，一般只写 2 行（导航避坑版式可以 3–4 行），每行 ≤9 字，像真人随手记的一句话，${layout === 'clean' ? '如「落地深圳」「第1️⃣顿直奔谁家」，可以带 1 个 emoji' : layout === 'green' ? '如「去了南山5次」「我的建议是😪」' : layout === 'nav' ? '写 3–4 行短句，如「（南山）」「可能会遇到的」「一点小麻烦」「自存」'  : layout === 'memo' ? '如「存一下 下周去南山」「要吃的东西」' : layout === 'hand' ? '如「逛完世界之窗」「去哪吃夜宵」' : layout === 'star' ? '如「南山美食」「个人打分」' : '如「南山一日游」「不走回头路」'}。封面和标题里都不要出现任何店名、品牌名，也不要写「大排档」，否则像广告，别人不会点进来。
10. navs 写 3–5 个（只用导航避坑版式时最重要），good 写 3–5 个、skip 写 2–3 个（不建议的要写真实原因，别黑景点本身，写“节假日太挤、门口特产贵”这类）、streets 写 2–3 个，全部在 ${B.district} 或附近；tips 不写门票价格、具体开放时间、地铁出口编号这类拿不准的数字。
12. 每篇要做成 8–10 页图（君游 2026-11-27）：route 写 5–7 站的一天行程（每站带吃什么或注意什么）；tips 当「旅程注意事项」写 6–8 条；stay 写 2–3 个住宿区域建议（只写区域和为什么住这，不写具体酒店名和价格）；traffic 写 3–5 条交通（机场/高铁站怎么过来、景点之间怎么串、夜宵后怎么回，只写你确定的线路站名，不写票价）；sections 里每家店的 say 写成 18–30 字的具体推荐（招牌菜＋口感），会单独排成美食详解页。
11. 这是同一批的第 ${k} 篇，标题、开头、结尾、选的店和菜都要和前面的不一样。前面用过的：${prev.length ? prev.map(p => `《${p.title}》结尾「${p.ending}」`).join('；') : '无'}
【参考范文（我们之前发过的文字攻略，学它的结构、语气、emoji 小标题和信息密度；不要照抄句子，不要照抄它的地名和店）】
${refText}
【主店资料（程序会照抄，不用你写）】${B.storeTitle}｜${B.address}｜人均${B.price}｜${B.hours}
【门店池（${B.district}）】
${shopLines}
【景点】${spots.join('、')}
只输出 JSON，不要解释：
{"title":"","cover":["",""],"body":"","ending":"正文最后一句","tags":["#",""],
"sections":[{"h":"分类名","items":[{"shop":"门店池店名","say":"一句话","stars":4}]}],
"route":[{"t":"10:00","place":"世界之窗","do":"≤16字","tip":"≤24字，这一站吃什么或注意什么"}],
"stay":[{"area":"住宿区域","why":"≤36字为什么住这（离哪近、方便什么）","fit":"≤14字适合谁"}],"traffic":[{"how":"如 从深圳北站过来","detail":"≤45字具体怎么走"}],
"spots":[{"place":"世界之窗","tip":"≤24字游玩建议"}],
"yes":{"dishes":[{"name":"爆膏奶油虾","line":""}],"order":["2人：…","4人：…"],"when":"","fit":"","blurb":"≤70字，一段像朋友安利的话，写 2–3 道菜的具体口感，放在实拍拼图上"},
"coverSub":"≤14字，如「11月要去南山的姐妹们：」","intro":["第一段 60–100 字：这地方好在哪、要注意什么（季节、人多、温差这类常识）","第二段 40–70 字：如果你是第1️⃣次来，存下来能少踩坑"],"tagline":"≤16字，如「保姆级别，不用带脑子都能看懂！」",
"good":[{"place":"值得去的地方","why":"≤26字具体理由"}],"skip":[{"place":"不建议专程去的地方或做法","why":"≤26字真实原因"}],"streets":[{"place":"美食街区","why":"≤22字"}],
"tips":["6–10 条实用建议，每条 ≤40 字，写常识性、不会错的（穿衣、错峰、避坑、怎么串路线）"],
"navs":[{"place":"景点名","why":"只搜名字会被导到哪、会遇到什么麻烦（≤40字）","nav":"导航【更准确的入口/门/方向】，进去后怎么走（≤40字，只写你确定的，拿不准就写到景区正门/游客中心）","tip":"什么时候去更好（≤30字）"}]}`;
  }
  function check(n, B, batch) {
    const out = []; const allText = [n.title, n.body, ...(n.cover || []), ...n.sections.flatMap(s => s.items.map(i => i.say)), ...(n.yes.dishes || []).map(d => d.line), ...(n.yes.order || []), n.yes.when, n.yes.fit, ...(n.spots || []).map(s => s.tip), n.yes.blurb, ...(n.intro || []), n.tagline, ...(n.tips || []), ...(n.navs || []).map(v => v.why + v.nav + v.tip), ...['good', 'skip', 'streets'].flatMap(k => (n[k] || []).map(x => x.place + x.why)), ...(n.route || []).map(r => r.do + (r.tip || '')), ...(n.stay || []).map(x => x.area + x.why + x.fit), ...(n.traffic || []).map(x => x.how + x.detail)].join('\n');
    B.banned.forEach(w => { if (allText.includes(w)) out.push(['err', `出现禁用词「${w}」`]); });
    if (!/(世界之窗|南山|白石洲|华侨城|深圳|蛇口|南头)/.test(n.title)) out.push(['err', '标题没有地点词']);
    if (n.stay !== undefined && (!(n.route || []).length || !(n.traffic || []).length || !(n.stay || []).length)) out.push(['warn', '行程/住宿/交通有缺，图会少几页']);
    if ((n.traffic || []).length || (n.stay || []).length) out.push(['warn', '住宿、交通的线路站名请人工核对一遍']);
    if (!/(吃|美食|夜宵|攻略|一日游|逛|玩|清单|推荐|去哪)/.test(n.title)) out.push(['err', '标题没有需求词']);
    if ([...n.title].length > 22) out.push(['warn', `标题 ${[...n.title].length} 字，偏长`]);
    if ((n.navs || []).length && batch.layout === 'nav') out.push(['warn', '导航入口（门、出口、方向）是 AI 写的，发布前要人工核实']);
    if ((n.cover || []).some(l => /大排档|YES|也是/i.test(l))) out.push(['err', '封面出现店名/大排档，像广告']);
    if (/大排档|YES|也是大/i.test(n.title)) out.push(['warn', '标题出现店名/大排档，像广告']);
    if ((n.sections[1] || {}).items && !(n.sections[1].items.length === 1 && n.sections[1].items[0].main)) out.push(['warn', '主店没有单独成一个分类']);
    const flat = n.sections.flatMap(s => s.items); if (!flat[1] || !flat[1].main) out.push(['err', '主店不在清单第 2 位']);
    const dn = (n.yes.dishes || []).map(d => d.name); if (!dn.includes(B.mustDish)) out.push(['err', `主店介绍缺「${B.mustDish}」`]);
    if (dn.length < B.minDishes) out.push(['err', `主店菜品只有 ${dn.length} 道（至少 ${B.minDishes} 道）`]);
    const okD = new Set([B.mustDish, ...Object.values(B.dishes).flat()]); dn.filter(d => !okD.has(d)).forEach(d => out.push(['err', `「${d}」不在主店可写的菜单里`]));
    if (!(n.spots || []).some(s => /世界之窗/.test(s.place)) && !(n.route || []).some(r => /世界之窗/.test(r.place))) out.push(['err', '没写世界之窗']);
    B.tagsMust.forEach(t => { if (!n.tags.includes(t)) out.push(['err', `缺话题 ${t}`]); });
    if (n.tags.filter(t => B.tagsOpt.includes(t)).length !== B.tagsOptN) out.push(['warn', `可选话题应选 ${B.tagsOptN} 个`]);
    (n.dropped || []).forEach(s => out.push(['warn', `「${s}」不在门店池，已去掉`]));
    if (flat.length < 5) out.push(['warn', `清单只有 ${flat.length} 家店`]);
    const bl = [...String(n.body || '')].length; if (bl < 120 || bl > 750) out.push(['warn', `正文 ${bl} 字`]);
    const yesMentions = (String(n.body).match(/YES|也是大排档/g) || []).length; if (yesMentions > 3) out.push(['warn', `正文提主店 ${yesMentions} 次，像广告`]);
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
  function build(j, B, pool, main) {
    const dropped = []; const used = new Set();
    const sections = (j.sections || []).map(s => ({ h: String(s.h || '').slice(0, 10), items: (s.items || []).map(it => { const sh = matchShop(it.shop, pool); if (!sh) { if (it.shop && !/YES|也是大排档/.test(it.shop)) dropped.push(it.shop); return null; } if (used.has(sh.id)) return null; used.add(sh.id); return { id: sh.id, name: sh.name, area: sh.area, price: sh.price, say: String(it.say || '').slice(0, 40), stars: Math.max(3, Math.min(5, +it.stars || 4)) }; }).filter(Boolean) })).filter(s => s.items.length);
    if (!sections.length) sections.push({ h: '吃饭', items: [] });
    const yesItem = { id: main.id, name: main.name, area: main.area, price: B.price, say: `${B.mustDish}、猛火小炒`, stars: 5, main: true };
    const secs2 = regroup(sections.filter(s => s.items.length), yesItem, B.mainCat || '晚饭·海鲜大排档');
    sections.length = 0; secs2.forEach(x => sections.push(x));
    const tags = [...B.tagsMust, ...(j.tags || []).map(t => '#' + String(t).replace(/^#/, '')).filter(t => B.tagsOpt.includes(t)).slice(0, B.tagsOptN)];
    for (const t of B.tagsOpt) { if (tags.length >= B.tagsMust.length + B.tagsOptN) break; if (!tags.includes(t)) tags.push(t); }
    const yes = j.yes || {}; const dishes = (yes.dishes || []).map(d => ({ name: String(d.name || '').trim(), line: String(d.line || '').slice(0, 40) })).filter(d => d.name);
    if (!dishes.some(d => d.name === B.mustDish)) dishes.unshift({ name: B.mustDish, line: '奶油香裹着虾膏，趁热先吃' });
    return { title: String(j.title || '').trim(), cover: (j.cover || []).map(String).filter(l => !/大排档|YES|也是/i.test(l)).slice(0, 4), body: String(j.body || '').trim(), ending: String(j.ending || '').trim(), tags, sections, dropped,
      route: (j.route || []).slice(0, 8).map(r => ({ t: String(r.t || ''), place: String(r.place || ''), do: String(r.do || ''), tip: String(r.tip || '').slice(0, 40) })), stay: (j.stay || []).slice(0, 4).map(x => ({ area: String(x.area || '').slice(0, 16), why: String(x.why || '').slice(0, 60), fit: String(x.fit || '').slice(0, 20) })).filter(x => x.area), traffic: (j.traffic || []).slice(0, 6).map(x => ({ how: String(x.how || '').slice(0, 20), detail: String(x.detail || '').slice(0, 70) })).filter(x => x.how), spots: (j.spots || []).slice(0, 3).map(s => ({ place: String(s.place || ''), tip: String(s.tip || '') })),
      yes: { dishes: dishes.slice(0, 5), order: (yes.order || []).map(String).slice(0, 3), when: String(yes.when || ''), fit: String(yes.fit || ''), blurb: String(yes.blurb || '').slice(0, 120) },
      coverSub: String(j.coverSub || '').slice(0, 20), intro: (Array.isArray(j.intro) ? j.intro : [j.intro]).filter(Boolean).map(x => String(x).slice(0, 200)).slice(0, 2), tagline: String(j.tagline || '').slice(0, 24),
      good: (j.good || []).slice(0, 6).map(x => ({ place: String(x.place || ''), why: String(x.why || '').slice(0, 40) })).filter(x => x.place), skip: (j.skip || []).slice(0, 4).map(x => ({ place: String(x.place || ''), why: String(x.why || '').slice(0, 40) })).filter(x => x.place),
      streets: (j.streets || []).slice(0, 4).map(x => ({ place: String(x.place || ''), why: String(x.why || '').slice(0, 36) })).filter(x => x.place), tips: (j.tips || []).map(String).map(x => x.slice(0, 60)).slice(0, 12), navs: (j.navs || []).slice(0, 6).map(v => ({ place: String(v.place || '').slice(0, 16), why: String(v.why || '').slice(0, 60), nav: String(v.nav || '').slice(0, 60), tip: String(v.tip || '').slice(0, 40) })).filter(v => v.place), main: { name: B.storeTitle, address: B.address, price: B.price, hours: B.hours } };
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
    const pool = all.filter(s => s.district === B.district && s.id !== main.id && !(s.planted && /YES/.test(s.name)));
    const id = 'g' + Date.now().toString(36); const batch = { id, brief: B.id, briefName: B.name, layout, layoutName: LAYOUTS[layout].name, by, at: Date.now(), n, status: 'running', notes: [], err: '' };
    wj(path.join(BD, id + '.json'), batch); runBatch(batch);
    return batch;
  }
  // 出稿在后台一篇篇跑；服务器重启（更新代码）打断的批次，启动后从断的那篇接着跑
  function runBatch(batch) {
    const B = briefs().find(b => b.id === batch.brief); const all = stores(); const main = B && all.find(s => s.id === B.store);
    const id = batch.id, n = batch.n, layout = batch.layout, f = path.join(BD, id + '.json');
    if (!B || !main) { batch.status = 'error'; batch.err = '任务书或主店不见了'; wj(f, batch); return; }
    const pool = all.filter(s => s.district === B.district && s.id !== main.id && !(s.planted && /YES/.test(s.name)));
    const save = () => { const d = rj(f, null); if (d && d.notes) d.notes.forEach(o => { const x = batch.notes.find(y => y.no === o.no); if (x) { x.status = o.status; x.notes = o.notes; } }); wj(f, batch); }; // 跑的过程中审稿标记不被覆盖
    jobs.set(id, true);
    (async () => {
      for (let k = (batch.k || 0) + 1; k <= n; k++) {
        const dir = B.directions[(k - 1) % B.directions.length];
        const shuffled = pool.slice().sort(() => Math.random() - 0.5).slice(0, 14);
        const spots = [...B.mustSpots, ...B.optSpots.slice().sort(() => Math.random() - 0.5).slice(0, 2)];
        let got = null, err = '';
        for (let t = 0; t < 3 && !got; t++) {
          try { const r = await llm(promptFor(B, layout, dir, shuffled, spots, batch.notes.map(x => ({ title: x.title, ending: x.ending })), k)); got = build(parseJ(r.text), B, pool, main); got.model = r.model; }
          catch (e) { err = e.message; }
        }
        batch.k = k;
        if (!got) { batch.err = `第 ${k} 篇失败：${err}`; log('[攻略平台] 出稿失败：' + err); save(); continue; }
        got.no = k; got.dir = dir.name; got.status = 'todo'; got.notes = []; batch.notes.push(got); got.check = check(got, B, batch);
        batch.notes.forEach(x => { x.check = check(x, B, batch); }); save();
      }
      batch.status = 'done'; batch.doneAt = Date.now(); save(); jobs.delete(id); log(`[攻略平台] 出稿完成：${B.name} ${batch.notes.length}/${n} 篇`);
    })().catch(e => { batch.status = 'error'; batch.err = e.message; save(); jobs.delete(id); });
  }
  setTimeout(() => { for (const b of batches()) { if (b.status !== 'running' || jobs.has(b.id)) continue; const full = rj(path.join(BD, b.id + '.json'), null); if (!full) continue; if (full.k === undefined) full.k = Math.max(0, ...(full.notes || []).map(x => x.no || 0)); log(`[攻略平台] 接着跑被重启打断的批次 ${b.id}（已出 ${full.notes.length}/${full.n}）`); runBatch(full); } }, 15e3);
  const batches = () => fs.readdirSync(BD).filter(x => x.endsWith('.json')).map(x => rj(path.join(BD, x), null)).filter(Boolean).sort((a, b) => b.at - a.at);
  const getBatch = id => /^g[0-9a-z]+$/.test(id) ? rj(path.join(BD, id + '.json'), null) : null;
  function mark(id, i, st, note, who) {
    const f = path.join(BD, id + '.json'); const b = getBatch(id); if (!b) throw new Error('没有这个批次'); const n = b.notes.find(x => x.no === +i); if (!n) throw new Error('没有这一篇');
    if (st) n.status = st; if (note) n.notes.push({ t: String(note).slice(0, 500), who, at: Date.now() }); wj(f, b); return n;
  }


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
    n.edited = { who, at: Date.now() }; n.notes.push({ t: '改了文案', who, at: Date.now() }); wj(f, b); return n; }
  function savePages(bid, no, pages) { const b = getBatch(bid); if (!b) throw new Error('没有这个批次'); const n = b.notes.find(x => x.no === +no); if (!n) throw new Error('没有这一篇');
    const dir = path.join(CDD, `${bid}-${+no}`); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { } fs.mkdirSync(dir, { recursive: true });
    (pages || []).slice(0, 18).forEach((d, i) => fs.writeFileSync(path.join(dir, (i + 1) + '.jpg'), jpg(d))); n.cardPages = Math.min(18, (pages || []).length); n.cardAt = Date.now(); wj(path.join(BD, bid + '.json'), b); return n; }
  const KINDS = ['外部达人', '自己的号', '员工代发'];
  function assign(bid, j, who) { const b = getBatch(bid); if (!b) throw new Error('没有这个批次'); const n = b.notes.find(x => x.no === +j.no); if (!n) throw new Error('没有这一篇');
    if (j.clear) { delete n.assign; wj(path.join(BD, bid + '.json'), b); return { ok: true }; }
    const acct = String(j.acct || '').trim().slice(0, 30); if (!acct) throw new Error('写上发布账号'); const date = /^\d{4}-\d{2}-\d{2}$/.test(j.date) ? j.date : bjDay();
    n.assign = { acct, kind: KINDS.includes(j.kind) ? j.kind : '员工代发', who: String(j.who || '').trim().slice(0, 20), date, by: who, at: Date.now() }; wj(path.join(BD, bid + '.json'), b); return { ok: true, url: cardUrl(bid, n.no) }; }
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
      if (sub === '/mark' && req.method === 'POST') { const j = JSON.parse(await body(req, 20000) || '{}'); return J(res, { ok: true, note: mark(bid, j.no, j.status === 'ok' ? 'shop_ok' : j.status === 'fix' ? 'shop_fix' : '', j.note ? '【商家】' + j.note : '', '商家') }); }
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
    if (me.role === 'writer' && !/^\/(api\/(me|mine|submit|briefs)|up\/)/.test(p)) return send(res, 403, '{"ok":false,"error":"写手账号只能投稿"}');
    m = p.match(/^\/up\/(g[0-9a-z]+)\/(\d+\.jpg)$/); if (m) { if (me.role === 'writer' && (getBatch(m[1]) || {}).byId !== me.id) return send(res, 403, ''); return serveJpg(res, upFile(m[1], m[2])); }
    try {
      if (p === '/api/me') return J(res, { ok: true, me: { name: me.name, role: me.role, roleName: ROLE[me.role] }, layouts: LAYOUTS });
      if (p === '/api/dash') { const B = batches(); const st = glib.status(); return J(res, { ok: true, lib: { total: st.total, night: st.night, day: st.day, pause: st.pause, window: st.window, authors: st.authors, seed: st.seed }, stores: stores().length, briefs: briefs().length, batches: B.length, notes: B.reduce((s, b) => s + b.notes.length, 0), late: pubs().filter(x => x.late).length, due: pubs().filter(x => x.due).length, todo: B.reduce((s, b) => s + b.notes.filter(n => n.status === 'todo').length, 0), recent: B.slice(0, 5).map(b => ({ id: b.id, briefName: b.briefName, layoutName: b.layoutName, at: b.at, n: b.notes.length, status: b.status })) }); }
      if (p === '/api/submit' && req.method === 'POST') { const j = JSON.parse(await body(req, 30e6)); const b = submit(j, me); return J(res, { ok: true, id: b.id }); }
      if (p === '/api/mine') return J(res, { ok: true, mine: batches().filter(b => b.kind === 'manual' && b.byId === me.id).map(b => ({ id: b.id, at: b.at, brief: b.brief, briefName: b.briefName, note: b.notes[0] })) });
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
      if (p === '/api/pubs') return J(res, { ok: true, pubs: pubs(), today: bjDay() });
      if (p === '/api/lib') return J(res, glib.query(Object.fromEntries(u.searchParams)));
      m = p.match(/^\/api\/lib\/([0-9a-f]{24})$/); if (m) { const n = glib.get(m[1]); return J(res, n ? { ok: true, note: n } : { ok: false, error: '没有这篇' }); }
      if (p === '/api/night') return J(res, glib.status());
      m = p.match(/^\/photo\/([A-Za-z0-9_-]+)\/(\d+\.jpg)$/); if (m) { const f = path.join(PD, m[1], m[2]); if (!fs.existsSync(f)) return send(res, 404, ''); const buf = fs.readFileSync(f); res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': buf.length, 'cache-control': 'private, max-age=86400' }); return res.end(buf); }
      m = p.match(/^\/api\/photos\/([A-Za-z0-9_-]+)$/);
      if (m && req.method === 'GET') return J(res, { ok: true, photos: photosOf(m[1]), sucai: sucaiFor(m[1]), sucaiAt: SC.at, sucaiOn: !!sucai });
      if (p === '/api/sucai/sync' && req.method === 'POST') { if (!canWork) return J(res, { ok: false, error: '没有权限' }); syncSucai().catch(e => log('[攻略平台] 素材库同步出错：' + e.message)); return J(res, { ok: true, started: true, total: SC.items.length }); }
      if (m && req.method === 'POST' && canWork) { const j = JSON.parse(await body(req, 8e6)); const dir = path.join(PD, m[1]); fs.mkdirSync(dir, { recursive: true });
        if (j.del) { if (/^\d+\.jpg$/.test(j.del)) try { fs.unlinkSync(path.join(dir, j.del)); } catch (e) { } return J(res, { ok: true, photos: photosOf(m[1]) }); }
        const b64 = String(j.data || '').replace(/^data:image\/jpeg;base64,/, ''); const buf = Buffer.from(b64, 'base64'); if (buf.length < 1000 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('只收 jpg 图片');
        const n = Math.max(0, ...photosOf(m[1]).map(f => parseInt(f))) + 1; fs.writeFileSync(path.join(dir, n + '.jpg'), buf); return J(res, { ok: true, photos: photosOf(m[1]) }); }
      if (p === '/api/stores' && req.method === 'GET') return J(res, { ok: true, stores: stores() });
      if (p === '/api/stores' && req.method === 'POST' && canWork) { const j = JSON.parse(await body(req)); const L = stores(); const s = j.store || {}; if (!s.name) throw new Error('店名不能空'); const i = L.findIndex(x => x.id === s.id); const clean = { id: s.id || 's' + Date.now().toString(36), name: String(s.name).slice(0, 40), planted: !!s.planted, district: String(s.district || ''), area: String(s.area || ''), cat: String(s.cat || ''), slot: String(s.slot || ''), dishes: String(s.dishes || ''), price: +s.price || null, star: +s.star || null, hours: String(s.hours || ''), addr: String(s.addr || ''), checked: s.checked ? Date.now() : (i >= 0 ? L[i].checked : null) }; if (j.del && i >= 0) L.splice(i, 1); else if (i >= 0) L[i] = Object.assign(L[i], clean); else L.push(clean); wj(SF, L); return J(res, { ok: true }); }
      if (p === '/api/refs' && req.method === 'GET') return J(res, { ok: true, refs: refs() });
      if (p === '/api/refs' && req.method === 'POST' && canWork) { const j = JSON.parse(await body(req, 200000)); const L = refs(); if (j.del) { const i = L.findIndex(x => x.id === j.del); if (i >= 0) L.splice(i, 1); META.refDel = (META.refDel || []).concat(j.del); saveMeta(); } else { const t = String(j.text || '').trim(); if (t.length < 50) throw new Error('范文太短'); L.push({ id: 'r' + Date.now().toString(36), name: String(j.name || t.split('\n')[0]).slice(0, 40), text: t.slice(0, 5000), by: me.name, at: Date.now() }); } wj(RF, L); return J(res, { ok: true, n: L.length }); }
      if (p === '/api/briefs' && req.method === 'GET') return J(res, { ok: true, briefs: briefs() });
      if (p === '/api/briefs' && req.method === 'POST' && canWork) { const j = JSON.parse(await body(req)); const L = briefs(); const b = j.brief || {}; const i = L.findIndex(x => x.id === b.id); if (i >= 0) L[i] = Object.assign(L[i], b); else L.push(Object.assign({}, L[0] || {}, b, { id: 'b' + Date.now().toString(36) })); wj(BF, L); return J(res, { ok: true }); }
      if (p === '/api/gen' && req.method === 'POST' && canWork) { const j = JSON.parse(await body(req)); const n = Math.max(1, Math.min(10, +j.n || 3)); return J(res, { ok: true, batch: await generate(j.brief, j.layout, n, me.name) }); }
      if (p === '/api/batches') return J(res, { ok: true, batches: batches().filter(b => u.searchParams.get('kind') === 'manual' ? b.kind === 'manual' : u.searchParams.get('kind') === 'ai' ? b.kind !== 'manual' : true).map(b => ({ id: b.id, briefName: b.briefName, layoutName: b.layoutName, at: b.at, n: b.n, got: b.notes.length, status: b.status, err: b.err, ok: b.notes.filter(x => /ok/.test(x.status)).length, fix: b.notes.filter(x => /fix/.test(x.status)).length, errs: b.notes.filter(x => x.check.some(c => c[0] === 'err')).length })) });
      m = p.match(/^\/api\/batch\/(g[0-9a-z]+)$/); if (m) { const b = getBatch(m[1]); if (b) { const B = briefs().find(x => x.id === b.brief); if (B || b.kind === 'manual') b.notes.forEach(n => { n.check = checkOf(n, B, b); }); } return J(res, b ? { ok: true, batch: b, layouts: LAYOUTS, photos: (sid => photosOf(sid).map(f => `${sid}/${f}`).concat(sucaiFor(sid)))((briefs().find(x => x.id === b.brief) || {}).store) } : { ok: false, error: '没有这个批次' }); } // 按最新任务书重新核对
      m = p.match(/^\/api\/batch\/(g[0-9a-z]+)\/mark$/); if (m && req.method === 'POST') { const j = JSON.parse(await body(req, 20000)); return J(res, { ok: true, note: mark(m[1], j.no, ['ok', 'fix', 'todo'].includes(j.status) ? j.status : '', j.note, me.name) }); }
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
  return { handle, generate, LAYOUTS, syncSucai, sucaiFor, _t: { submit, assign, pubs, pub, edit, getBatch, checkManual }, bossSetupLink: (h) => setupLink(ensureBoss().id, h || 6) };
}
module.exports = { createGlweb };
