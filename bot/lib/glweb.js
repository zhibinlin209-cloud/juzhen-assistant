/* 攻略平台网页：https://work.yesyueji.com/cockpit/gl/（以后切到 gl.yesyueji.com）
 * 独立登录（和驾驶舱账号不通），读不到任何经营数据；角色：boss 老板（全部）/ ops 运营策划 / review 只审稿
 * 页面：bot/cockpit/gl.html（单页），接口都在 /cockpit/gl/api/*
 * 数据：data/gl/users.json、stores.json、briefs.json、batches/<批次>.json；爆款库在 lib/glib.js
 */
'use strict';
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DAY = 864e5;
const LAYOUTS = {
  memo: { name: '存一下（纯文字备忘录）', desc: '黄底大字封面＋备忘录空心圆清单，按类分，最后一页实拍' },
  hand: { name: 'X吃什么（手写批注）', desc: '手机备忘录：吃什么/玩什么分组，编号店名＋紫色手写招牌菜' },
  star: { name: '星级＋短评', desc: '星级图例封面＋备忘录：店名⭐＋一句短评（招牌、人均、位置）' },
  route: { name: '一日游路线表', desc: '路线时间表＋景点小贴士＋吃饭清单＋主店介绍' }
};

function createGlweb({ dataDir, log, cfg, glib, base, bossDm }) {
  const D = path.join(dataDir, 'gl'); const BD = path.join(D, 'batches'); [D, BD].forEach(d => fs.mkdirSync(d, { recursive: true }));
  const rj = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
  const wj = (f, v) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f); };
  const UF = path.join(D, 'users.json'), SF = path.join(D, 'stores.json'), BF = path.join(D, 'briefs.json'), MF = path.join(D, 'meta.json');
  let U = rj(UF, { users: [] }), META = rj(MF, {});
  if (!fs.existsSync(SF) || !fs.existsSync(BF)) { const seed = require('./glseed'); if (!fs.existsSync(SF)) wj(SF, seed.shops); if (!fs.existsSync(BF)) wj(BF, [seed.brief]); log('[攻略平台] 导入初始门店池和白石洲任务书'); }
  const stores = () => rj(SF, []), briefs = () => rj(BF, []);
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
  const ROLE = { boss: '老板', ops: '运营/策划', review: '审稿' };
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
      try { const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + k }, signal: AbortSignal.timeout(240000), body: JSON.stringify({ model, temperature: 0.85, max_tokens: 3500, messages: [{ role: 'user', content: prompt }] }) });
        const j = await r.json().catch(() => ({})); if (r.ok) { const t = (((j.choices || [])[0] || {}).message || {}).content || ''; if (t) return { text: t, model }; }
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
    return `你是小红书本地生活博主，替深圳一家海鲜大排档写一篇「${dir.name}」方向的图文攻略，读起来要像真实游客或本地人自己整理的，不能像广告。
【版式】${L.name}：${L.desc}。你只写文字内容，排版由程序完成。
【读者】${B.audience}
【必须做到】
1. 标题 ≤20 字，必须同时有地点词和需求词（${B.titleRule}），本篇优先往「${dir.words.join('」「')}」这类搜索词靠，不要用感叹号堆砌。
2. 主店是「${B.storeTitle}」，它会由程序固定放在美食清单第 2 位，你在 sections 里不要写它。
3. 美食清单 sections 只能用下面门店池里的店（店名照抄，不要编新店），按 2–3 个分类（如 正餐/夜宵、糖水甜品、粉面小吃、第二天早餐），一共 6–9 家；每家一句话（≤18 字）写招牌菜或特点，不要写具体价格以外编造的信息。
4. 主店介绍 yes：爆膏奶油虾必写，再从这些菜里选 2–3 道：${dishes}；每道一句话（≤22 字，具体到口感/吃法，不夸大，不能写“只只爆膏”）。再写 2 条点菜建议（按人数）、1 句什么时候去、1 句适合什么聚会。
5. 景点必须有世界之窗；可以再选 0–2 个：${B.optSpots.join('、')}。景点只写游玩建议，不写门票价格、开放时间等数字（这些我们没核实）。
6. 正文 body 120–220 字，第一人称，口语化，有具体场景（谁、什么时候、玩了什么、吃了什么），提到主店最多 2 次，不要列店名清单（清单在图里）；结尾一句话自然收尾，不能和下面已经用过的结尾重复，也不要写“图里/码住”之外的套话。
7. 禁用词：${B.banned.join('、')}；不要说“无广”“自费”“不是广告”。
8. 话题 tags 只写 2 个，从这里选：${B.tagsOpt.join(' ')}（另外 3 个固定话题程序会加）。
9. cover 是封面大字，2–3 行，每行 ≤9 字，${layout === 'memo' ? '像「存一下 下周去南山 要吃的东西」这种自存口吻' : layout === 'hand' ? '像「南山吃什么」「逛完世界之窗去哪吃」' : layout === 'star' ? '像「南山美食 个人打分」带一点主观' : '像「南山一日游 不走回头路」'}。
10. 这是同一批的第 ${k} 篇，标题、开头、结尾、选的店和菜都要和前面的不一样。前面用过的：${prev.length ? prev.map(p => `《${p.title}》结尾「${p.ending}」`).join('；') : '无'}
【主店资料（程序会照抄，不用你写）】${B.storeTitle}｜${B.address}｜人均${B.price}｜${B.hours}
【门店池（${B.district}）】
${shopLines}
【景点】${spots.join('、')}
只输出 JSON，不要解释：
{"title":"","cover":["",""],"body":"","ending":"正文最后一句","tags":["#",""],
"sections":[{"h":"分类名","items":[{"shop":"门店池店名","say":"一句话","stars":4}]}],
"route":[{"t":"10:00","place":"世界之窗","do":"≤16字"}],
"spots":[{"place":"世界之窗","tip":"≤24字游玩建议"}],
"yes":{"dishes":[{"name":"爆膏奶油虾","line":""}],"order":["2人：…","4人：…"],"when":"","fit":""}}`;
  }
  function check(n, B, batch) {
    const out = []; const allText = [n.title, n.body, ...(n.cover || []), ...n.sections.flatMap(s => s.items.map(i => i.say)), ...(n.yes.dishes || []).map(d => d.line), ...(n.yes.order || []), n.yes.when, n.yes.fit, ...(n.spots || []).map(s => s.tip)].join('\n');
    B.banned.forEach(w => { if (allText.includes(w)) out.push(['err', `出现禁用词「${w}」`]); });
    if (!/(世界之窗|南山|白石洲|华侨城|深圳|蛇口|南头)/.test(n.title)) out.push(['err', '标题没有地点词']);
    if (!/(吃|美食|夜宵|攻略|一日游|逛|玩|清单|推荐|去哪)/.test(n.title)) out.push(['err', '标题没有需求词']);
    if ([...n.title].length > 22) out.push(['warn', `标题 ${[...n.title].length} 字，偏长`]);
    const flat = n.sections.flatMap(s => s.items); if (!flat[1] || !flat[1].main) out.push(['err', '主店不在清单第 2 位']);
    const dn = (n.yes.dishes || []).map(d => d.name); if (!dn.includes(B.mustDish)) out.push(['err', `主店介绍缺「${B.mustDish}」`]);
    if (dn.length < B.minDishes) out.push(['err', `主店菜品只有 ${dn.length} 道（至少 ${B.minDishes} 道）`]);
    const okD = new Set([B.mustDish, ...Object.values(B.dishes).flat()]); dn.filter(d => !okD.has(d)).forEach(d => out.push(['err', `「${d}」不在主店可写的菜单里`]));
    if (!(n.spots || []).some(s => /世界之窗/.test(s.place)) && !(n.route || []).some(r => /世界之窗/.test(r.place))) out.push(['err', '没写世界之窗']);
    B.tagsMust.forEach(t => { if (!n.tags.includes(t)) out.push(['err', `缺话题 ${t}`]); });
    if (n.tags.filter(t => B.tagsOpt.includes(t)).length !== B.tagsOptN) out.push(['warn', `可选话题应选 ${B.tagsOptN} 个`]);
    (n.dropped || []).forEach(s => out.push(['warn', `「${s}」不在门店池，已去掉`]));
    if (flat.length < 5) out.push(['warn', `清单只有 ${flat.length} 家店`]);
    const bl = [...String(n.body || '')].length; if (bl < 80 || bl > 320) out.push(['warn', `正文 ${bl} 字`]);
    const yesMentions = (String(n.body).match(/YES|也是大排档/g) || []).length; if (yesMentions > 2) out.push(['warn', `正文提主店 ${yesMentions} 次，像广告`]);
    batch.notes.forEach(o => { if (o !== n && o.ending && o.ending === n.ending) out.push(['err', '结尾和本批另一篇重复']); if (o !== n && o.title === n.title) out.push(['err', '标题和本批另一篇重复']); });
    return out;
  }
  function build(j, B, pool, main) {
    const dropped = []; const used = new Set();
    const sections = (j.sections || []).map(s => ({ h: String(s.h || '').slice(0, 10), items: (s.items || []).map(it => { const sh = matchShop(it.shop, pool); if (!sh) { if (it.shop && !/YES|也是大排档/.test(it.shop)) dropped.push(it.shop); return null; } if (used.has(sh.id)) return null; used.add(sh.id); return { id: sh.id, name: sh.name, area: sh.area, price: sh.price, say: String(it.say || '').slice(0, 30), stars: Math.max(3, Math.min(5, +it.stars || 4)) }; }).filter(Boolean) })).filter(s => s.items.length);
    if (!sections.length) sections.push({ h: '吃饭', items: [] });
    const yesItem = { id: main.id, name: main.name, area: main.area, price: B.price, say: `${B.mustDish}、猛火小炒`, stars: 5, main: true };
    // 主店固定放在全篇清单第 2 位
    const s0 = sections[0]; if (s0.items.length >= 1) s0.items.splice(1, 0, yesItem); else { s0.items.push(yesItem); }
    if (sections[0].items.length === 1 && sections[1] && sections[1].items.length) { /* 只有一家时把下一组第一家挪上来，保证主店第 2 */ sections[0].items.unshift(sections[1].items.shift()); }
    const tags = [...B.tagsMust, ...(j.tags || []).map(t => '#' + String(t).replace(/^#/, '')).filter(t => B.tagsOpt.includes(t)).slice(0, B.tagsOptN)];
    for (const t of B.tagsOpt) { if (tags.length >= B.tagsMust.length + B.tagsOptN) break; if (!tags.includes(t)) tags.push(t); }
    const yes = j.yes || {}; const dishes = (yes.dishes || []).map(d => ({ name: String(d.name || '').trim(), line: String(d.line || '').slice(0, 40) })).filter(d => d.name);
    if (!dishes.some(d => d.name === B.mustDish)) dishes.unshift({ name: B.mustDish, line: '奶油香裹着虾膏，趁热先吃' });
    return { title: String(j.title || '').trim(), cover: (j.cover || []).map(String).slice(0, 3), body: String(j.body || '').trim(), ending: String(j.ending || '').trim(), tags, sections, dropped,
      route: (j.route || []).slice(0, 6).map(r => ({ t: String(r.t || ''), place: String(r.place || ''), do: String(r.do || '') })), spots: (j.spots || []).slice(0, 3).map(s => ({ place: String(s.place || ''), tip: String(s.tip || '') })),
      yes: { dishes: dishes.slice(0, 5), order: (yes.order || []).map(String).slice(0, 3), when: String(yes.when || ''), fit: String(yes.fit || '') }, main: { name: B.storeTitle, address: B.address, price: B.price, hours: B.hours } };
  }
  const jobs = new Map();
  async function generate(briefId, layout, n, by) {
    const B = briefs().find(b => b.id === briefId); if (!B) throw new Error('没找到任务书'); if (!LAYOUTS[layout]) throw new Error('没有这个版式');
    const all = stores(); const main = all.find(s => s.id === B.store); if (!main) throw new Error('任务书的主店不在门店池');
    const pool = all.filter(s => s.district === B.district && s.id !== main.id && !(s.planted && /YES/.test(s.name)));
    const id = 'g' + Date.now().toString(36); const batch = { id, brief: B.id, briefName: B.name, layout, layoutName: LAYOUTS[layout].name, by, at: Date.now(), n, status: 'running', notes: [], err: '' };
    const f = path.join(BD, id + '.json'); wj(f, batch); jobs.set(id, true);
    (async () => {
      for (let k = 1; k <= n; k++) {
        const dir = B.directions[(k - 1) % B.directions.length];
        const shuffled = pool.slice().sort(() => Math.random() - 0.5).slice(0, 14);
        const spots = [...B.mustSpots, ...B.optSpots.slice().sort(() => Math.random() - 0.5).slice(0, 2)];
        let got = null, err = '';
        for (let t = 0; t < 2 && !got; t++) {
          try { const r = await llm(promptFor(B, layout, dir, shuffled, spots, batch.notes.map(x => ({ title: x.title, ending: x.ending })), k)); const m = String(r.text).match(/\{[\s\S]*\}/); if (!m) throw new Error('没返回 JSON'); got = build(JSON.parse(m[0]), B, pool, main); got.model = r.model; }
          catch (e) { err = e.message; }
        }
        if (!got) { batch.err = `第 ${k} 篇失败：${err}`; log('[攻略平台] 出稿失败：' + err); continue; }
        got.no = k; got.dir = dir.name; got.status = 'todo'; got.notes = []; batch.notes.push(got); got.check = check(got, B, batch);
        batch.notes.forEach(x => { x.check = check(x, B, batch); }); wj(f, batch);
      }
      batch.status = 'done'; batch.doneAt = Date.now(); wj(f, batch); jobs.delete(id); log(`[攻略平台] 出稿完成：${B.name} ${batch.notes.length}/${n} 篇`);
    })().catch(e => { batch.status = 'error'; batch.err = e.message; wj(f, batch); jobs.delete(id); });
    return batch;
  }
  const batches = () => fs.readdirSync(BD).filter(x => x.endsWith('.json')).map(x => rj(path.join(BD, x), null)).filter(Boolean).sort((a, b) => b.at - a.at);
  const getBatch = id => /^g[0-9a-z]+$/.test(id) ? rj(path.join(BD, id + '.json'), null) : null;
  function mark(id, i, st, note, who) {
    const f = path.join(BD, id + '.json'); const b = getBatch(id); if (!b) throw new Error('没有这个批次'); const n = b.notes.find(x => x.no === +i); if (!n) throw new Error('没有这一篇');
    if (st) n.status = st; if (note) n.notes.push({ t: String(note).slice(0, 500), who, at: Date.now() }); wj(f, b); return n;
  }

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
      if (sub === '/data') return J(res, { ok: true, share: true, batch: b, layouts: LAYOUTS });
      if (sub === '/mark' && req.method === 'POST') { const j = JSON.parse(await body(req, 20000) || '{}'); return J(res, { ok: true, note: mark(bid, j.no, j.status === 'ok' ? 'shop_ok' : j.status === 'fix' ? 'shop_fix' : '', j.note ? '【商家】' + j.note : '', '商家') }); }
      return send(res, 404, '{}');
    }
    const me = userOf(req);
    if (!me) { if (p.startsWith('/api/') || p.startsWith('/img/')) return send(res, 401, '{"ok":false,"error":"请先登录"}'); return send(res, 200, loginPage(''), 'text/html; charset=utf-8'); }
    if (p === '/' || p === '/index.html') { const h = page(); return h ? send(res, 200, h, 'text/html; charset=utf-8') : send(res, 503, '页面更新中'); }
    m = p.match(/^\/img\/([0-9a-f]{24})\/(\d+\.(?:jpg|png|webp))$/);
    if (m) { const f = glib.imgPath(m[1], m[2]); if (!f) return send(res, 404, ''); const buf = fs.readFileSync(f); res.writeHead(200, { 'content-type': /png$/.test(f) ? 'image/png' : /webp$/.test(f) ? 'image/webp' : 'image/jpeg', 'content-length': buf.length, 'cache-control': 'private, max-age=86400' }); return res.end(buf); }
    const isBoss = me.role === 'boss', canWork = me.role === 'boss' || me.role === 'ops';
    try {
      if (p === '/api/me') return J(res, { ok: true, me: { name: me.name, role: me.role, roleName: ROLE[me.role] }, layouts: LAYOUTS });
      if (p === '/api/dash') { const B = batches(); const st = glib.status(); return J(res, { ok: true, lib: { total: st.total, night: st.night, window: st.window, authors: st.authors }, stores: stores().length, briefs: briefs().length, batches: B.length, notes: B.reduce((s, b) => s + b.notes.length, 0), todo: B.reduce((s, b) => s + b.notes.filter(n => n.status === 'todo').length, 0), recent: B.slice(0, 5).map(b => ({ id: b.id, briefName: b.briefName, layoutName: b.layoutName, at: b.at, n: b.notes.length, status: b.status })) }); }
      if (p === '/api/lib') return J(res, glib.query(Object.fromEntries(u.searchParams)));
      m = p.match(/^\/api\/lib\/([0-9a-f]{24})$/); if (m) { const n = glib.get(m[1]); return J(res, n ? { ok: true, note: n } : { ok: false, error: '没有这篇' }); }
      if (p === '/api/night') return J(res, glib.status());
      if (p === '/api/stores' && req.method === 'GET') return J(res, { ok: true, stores: stores() });
      if (p === '/api/stores' && req.method === 'POST' && canWork) { const j = JSON.parse(await body(req)); const L = stores(); const s = j.store || {}; if (!s.name) throw new Error('店名不能空'); const i = L.findIndex(x => x.id === s.id); const clean = { id: s.id || 's' + Date.now().toString(36), name: String(s.name).slice(0, 40), planted: !!s.planted, district: String(s.district || ''), area: String(s.area || ''), cat: String(s.cat || ''), slot: String(s.slot || ''), dishes: String(s.dishes || ''), price: +s.price || null, star: +s.star || null, hours: String(s.hours || ''), addr: String(s.addr || ''), checked: s.checked ? Date.now() : (i >= 0 ? L[i].checked : null) }; if (j.del && i >= 0) L.splice(i, 1); else if (i >= 0) L[i] = Object.assign(L[i], clean); else L.push(clean); wj(SF, L); return J(res, { ok: true }); }
      if (p === '/api/briefs' && req.method === 'GET') return J(res, { ok: true, briefs: briefs() });
      if (p === '/api/briefs' && req.method === 'POST' && canWork) { const j = JSON.parse(await body(req)); const L = briefs(); const b = j.brief || {}; const i = L.findIndex(x => x.id === b.id); if (i >= 0) L[i] = Object.assign(L[i], b); else L.push(Object.assign({}, L[0] || {}, b, { id: 'b' + Date.now().toString(36) })); wj(BF, L); return J(res, { ok: true }); }
      if (p === '/api/gen' && req.method === 'POST' && canWork) { const j = JSON.parse(await body(req)); const n = Math.max(1, Math.min(10, +j.n || 3)); return J(res, { ok: true, batch: await generate(j.brief, j.layout, n, me.name) }); }
      if (p === '/api/batches') return J(res, { ok: true, batches: batches().map(b => ({ id: b.id, briefName: b.briefName, layoutName: b.layoutName, at: b.at, n: b.n, got: b.notes.length, status: b.status, err: b.err, ok: b.notes.filter(x => /ok/.test(x.status)).length, fix: b.notes.filter(x => /fix/.test(x.status)).length, errs: b.notes.filter(x => x.check.some(c => c[0] === 'err')).length })) });
      m = p.match(/^\/api\/batch\/(g[0-9a-z]+)$/); if (m) { const b = getBatch(m[1]); return J(res, b ? { ok: true, batch: b, layouts: LAYOUTS } : { ok: false, error: '没有这个批次' }); }
      m = p.match(/^\/api\/batch\/(g[0-9a-z]+)\/mark$/); if (m && req.method === 'POST') { const j = JSON.parse(await body(req, 20000)); return J(res, { ok: true, note: mark(m[1], j.no, ['ok', 'fix', 'todo'].includes(j.status) ? j.status : '', j.note, me.name) }); }
      m = p.match(/^\/api\/batch\/(g[0-9a-z]+)\/share$/); if (m && req.method === 'POST' && canWork) { if (!getBatch(m[1])) throw new Error('没有这个批次'); return J(res, { ok: true, url: `${base}r/${sign(`R|${m[1]}|${Date.now() + 14 * DAY}`)}` }); }
      if (p === '/api/users' && isBoss) return J(res, { ok: true, users: U.users.map(x => ({ id: x.id, name: x.name, role: x.role, roleName: ROLE[x.role], login: x.login || '', set: !!x.hash, off: !!x.off, last: x.last || null })) });
      if (p === '/api/users' && req.method === 'POST' && isBoss) { const j = JSON.parse(await body(req, 4096)); if (j.off) { const x = U.users.find(z => z.id === j.id && z.role !== 'boss'); if (!x) throw new Error('没有这个人'); x.off = true; saveU(); return J(res, { ok: true }); }
        if (j.reset) { const x = U.users.find(z => z.id === j.id); if (!x) throw new Error('没有这个人'); x.off = false; saveU(); return J(res, { ok: true, link: setupLink(x.id, 24) }); }
        const name = String(j.name || '').trim().slice(0, 20); if (!name) throw new Error('名字不能空'); const role = ['ops', 'review'].includes(j.role) ? j.role : 'ops'; const x = { id: 'u' + crypto.randomBytes(4).toString('hex'), name, role, at: Date.now() }; U.users.push(x); saveU(); return J(res, { ok: true, link: setupLink(x.id, 24) }); }
      return send(res, 404, '{"ok":false,"error":"没有这个接口或没有权限"}');
    } catch (e) { return J(res, { ok: false, error: e.message.slice(0, 200) }); }
  }
  ensureBoss();
  return { handle, generate, LAYOUTS, bossSetupLink: (h) => setupLink(ensureBoss().id, h || 6) };
}
module.exports = { createGlweb };
