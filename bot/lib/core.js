/* 机器人核心逻辑（不依赖飞书 SDK，便于测试）
 * - handleText：群消息里的分享 → 拆分 → 查重 → 新增到「小红书矩阵号-数据」
 * - handleImage：数据中心截图 → 通义千问识别 → 对上笔记 → 写「(自动)」列
 */
'use strict';
const P = require('./postparse');
const DAY = 864e5;

function val(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(x => (x && typeof x === 'object' ? (x.text || x.name || x.link || '') : String(x))).join('');
  if (typeof v === 'object') { if (v.link) return v.link; if (v.text) return v.text; if (v.value !== undefined) return val(v.value); if (v.name) return v.name; }
  return String(v);
}
const num = v => { const x = val(v); if (typeof x === 'number') return x; const m = String(x).replace(/,/g, '').match(/([\d.]+)\s*(万|w)?/i); return m ? Math.round(parseFloat(m[1]) * (m[2] ? 1e4 : 1)) : null; };
function titleOf(v) {
  const t = String(val(v) || '').replace(/\r/g, '').trim(); if (!t) return '';
  const m = t.match(/(?:^|\n)[#*\s]*标题[*\s]*[:：]?[ \t]*\n*[ \t]*([^\n#]+)/); if (m && m[1].trim()) return m[1].trim();
  return (t.split('\n').map(x => x.replace(/^[#*\s]+/, '').trim()).find(Boolean) || '').slice(0, 100);
}
const dayStart = t => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

function createCore({ cfg, api, log }) {
  log = log || console.log;
  const st = { table: null, fields: null, rows: null, accts: null, at: 0, appToken: '' };

  async function appToken() {
    if (st.appToken) return st.appToken;
    const u = cfg.baseUrl || ''; let m;
    if ((m = u.match(/\/base\/([A-Za-z0-9]+)/))) return (st.appToken = m[1]);
    if ((m = u.match(/\/wiki\/([A-Za-z0-9]+)/))) { const d = await api.call('GET', '/wiki/v2/spaces/get_node', null, { token: m[1], obj_type: 'wiki' }); return (st.appToken = d.node.obj_token); }
    throw new Error('config.json 里的 baseUrl 不是多维表格链接');
  }
  // 「(供AI读取)」公式列：飞书接口读不到链接解析出来的列，靠它们复制一份；被删了就自动补回
  const HELP = [['标题(供AI读取)', ['标题', '..标题']], ['播放(供AI读取)', ['..播放数', '..播放数 2']], ['点赞(供AI读取)', ['点赞数', '..点赞数']], ['评论(供AI读取)', ['评论数', '..评论数']], ['收藏(供AI读取)', ['收藏数', '..收藏数']], ['分享(供AI读取)', ['分享数', '..分享数']]];
  async function heal(app, tid, items) {
    const names = new Set(items.map(f => f.field_name)); let made = 0;
    for (const [h, srcs] of HELP) {
      if (names.has(h)) continue; const src = items.find(f => srcs.includes(f.field_name) && f.type === 1); if (!src) continue;
      try { await api.call('POST', `/bitable/v1/apps/${app}/tables/${tid}/fields`, { field_name: h, type: 20, property: { formula_expression: `bitable::$table[${tid}].$field[${src.field_id}]` }, description: { text: '机器人和插件读取数据用（飞书接口读不到链接解析的列）。可以隐藏，请勿删除。' } }); made++; } catch (e) { log('补建列失败', h, e.message); }
    }
    if (made) { log(`[表] 发现 ${made} 列「(供AI读取)」被删了，已自动补回`); await new Promise(r => setTimeout(r, 3000)); }
    return made;
  }
  async function listTables() {
    const app = await appToken(); const out = []; let pt = '';
    do { const d = await api.call('GET', `/bitable/v1/apps/${app}/tables`, null, Object.assign({ page_size: 100 }, pt ? { page_token: pt } : {})); out.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    return out;
  }
  const vt = {}; // 抖音 / 视频号用的表
  const dyKey = u => { const t = String(u || ''); const a = t.match(/v\.douyin\.com\/([A-Za-z0-9_-]+)/); if (a) return 's:' + a[1]; const b = t.match(/(?:video|note)\/(\d{8,})/); return b ? 'i:' + b[1] : ''; };
  async function loadT(name, force) {
    if (vt[name] && !force && Date.now() - vt[name].at < 5 * 60e3) return vt[name];
    const app = await appToken(); const all = await listTables(); const nk = x => String(x).replace(/最新|[-_\s—－·]/g, ''); const t = all.find(x => x.name === name) || all.find(x => nk(x.name) === nk(name)); if (!t) { log('[表] 没找到：' + name); return null; } if (t.name !== name) log(`[表] 「${name}」已改名为「${t.name}」，照常使用`);
    let fd = await api.call('GET', `/bitable/v1/apps/${app}/tables/${t.table_id}/fields`, null, { page_size: 200 });
    if (await heal(app, t.table_id, fd.items || [])) fd = await api.call('GET', `/bitable/v1/apps/${app}/tables/${t.table_id}/fields`, null, { page_size: 200 });
    const recs = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); recs.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    const rows = recs.map(r => { const f = r.fields || {}; const vlink = String(val(f['视频号链接'] || f['视频号']) || ''), tlink = String(val(f['贴图号']) || ''); return { id: r.record_id, table: name, title: titleOf(f['标题(供AI读取)'] || f['..标题'] || f['标题']), date: typeof f['发布日期'] === 'number' ? f['发布日期'] : null, account: String(val(f['账号名称'] || f['账号昵称']) || '').trim(), ch: !!(vlink || tlink), kind: tlink ? '贴图' : vlink ? '视频' : '', cur: { views: num(f['播放量']), likes: num(f['点赞量']), comments: num(f['评论量']), shares: num(f['转发量']) } }; }).filter(r => r.title);
    const meta = (fd.items || []).map(f => ({ name: f.field_name, type: f.type, options: ((f.property || {}).options || []).map(o => o.name) }));
    // 抖音作品链接列：优先名字里带「抖音」的链接列，其次「作品链接 / 视频链接 / 链接」（排除视频号、贴图号、主页）
    const linkCands = meta.filter(f => [1, 15].includes(f.type) && /链接|link/i.test(f.name) && !/视频号|贴图|主页|微信|小红书|点评|携程/.test(f.name));
    const linkCol = (linkCands.find(f => /抖音/.test(f.name)) || linkCands.find(f => /作品|视频/.test(f.name)) || linkCands[0] || {}).name || '';
    const accCol = ['账号名称', '账号昵称', '账号'].find(c => meta.some(f => f.name === c)) || '';
    const links = new Set(), accts = new Set();
    recs.forEach(r => { const f = r.fields || {}; const l = linkCol ? String(val(f[linkCol]) || '') : ''; const k = dyKey(l); if (k) links.add(k); const a = accCol ? String(val(f[accCol]) || '').trim() : ''; if (a) accts.add(a); });
    vt[name] = { id: t.table_id, name, fields: meta.map(f => f.name), meta, linkCol, accCol, links, accts, rows, at: Date.now() };
    log(`[表] ${name}：${rows.length} 条可对，${accts.size} 个账号，链接列「${linkCol || '没找到'}」，账号列「${accCol || '没找到'}」`); return vt[name];
  }
  async function load(force) {
    if (st.rows && !force && Date.now() - st.at < 5 * 60e3) return;
    const app = await appToken();
    const tables = []; let pt = ''; do { const d = await api.call('GET', `/bitable/v1/apps/${app}/tables`, null, Object.assign({ page_size: 100 }, pt ? { page_token: pt } : {})); tables.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    const t = tables.find(x => x.name === (cfg.xhsTable || '小红书矩阵号-数据')); if (!t) throw new Error('没找到表：' + cfg.xhsTable);
    st.table = { id: t.table_id, name: t.name };
    let fd = await api.call('GET', `/bitable/v1/apps/${app}/tables/${t.table_id}/fields`, null, { page_size: 200 });
    if (await heal(app, t.table_id, fd.items || [])) fd = await api.call('GET', `/bitable/v1/apps/${app}/tables/${t.table_id}/fields`, null, { page_size: 200 });
    st.fields = (fd.items || []).map(f => ({ name: f.field_name, type: f.type, options: ((f.property || {}).options || []).map(o => o.name) }));
    const recs = []; pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); recs.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    st.rows = recs.map(r => { const f = r.fields || {}; const xhs = String(val(f['小红书链接']) || ''); const home = String(val(f['主页链接']) || '');
      return { id: r.record_id, title: titleOf(f['标题(供AI读取)'] || f['标题']), xhs, key: P.xhsKey(xhs), code: String(val(f['合作码']) || '').trim(), account: String(val(f['账号昵称']) || '').trim(), person: String(val(f['人员']) || '').trim(), home, uid: (home.match(/user\/profile\/([0-9a-f]{24})/) || [])[1] || '', date: typeof f['发布日期'] === 'number' ? f['发布日期'] : null, views: num(f['小眼睛']), auto: num(f['小眼睛(自动)']), table: '__xhs', chWx: /weixin\.qq\.com\/sph|channels\.weixin/.test(String(val(f['微信贴图']) || '')), cur: { views: num(f['视频号播放(自动)']), likes: num(f['视频号点赞(自动)']), comments: num(f['视频号评论(自动)']), shares: num(f['视频号转发(自动)']) } }; });
    const A = {}; st.rows.slice().sort((a, b) => (a.date || 0) - (b.date || 0)).forEach(r => { if (!r.account) return; const a = A[r.account] = A[r.account] || { name: r.account }; if (r.home) a.home = r.home; if (r.uid) a.uid = r.uid; if (r.person) a.person = r.person; });
    st.accts = Object.values(A); st.at = Date.now();
    log(`[表] ${t.name}：${st.rows.length} 条，${st.accts.length} 个账号`);
  }
  const opts = name => ((st.fields || []).find(f => f.name === name) || {}).options || [];
  const dupOf = p => { const k = P.xhsKey(p.xhs || p.link); const n = P.norm(p.title); return st.rows.find(r => (k && r.key === k) || (p.code && r.code === p.code) || (p.noteId && r.key === 'n:' + p.noteId) || (n.length >= 6 && r.title && P.dice(n, P.norm(r.title)) >= 0.92)); };

  // ---------- 分享 → 新增行 ----------
  async function handleText(text, senderName) {
    const posts = P.parse(text); if (!posts.length) return null;
    await load();
    const out = { created: [], dups: [], noAcct: [] };
    const rows = [];
    for (const p of posts) {
      if (dupOf(p)) { out.dups.push(p); continue; }
      if (p.xhs && api.fetchXhs) { const info = await api.fetchXhs(p.xhs); Object.assign(p, info || {}); if (info && info.id) p.noteId = info.id; if (dupOf(p)) { out.dups.push(p); continue; } }
      const a = (p.uid && st.accts.find(x => x.uid === p.uid)) || (p.nick && st.accts.find(x => x.name === p.nick));
      p.account = a ? a.name : (p.nick || '');
      const person = (senderName && opts('人员').find(o => senderName.includes(o) || o.includes(senderName))) || (a && a.person) || '';
      const f = { '发布日期': dayStart(p.time || Date.now()) };
      if (opts('投流状态').includes('未投流')) f['投流状态'] = '未投流';
      if (p.account) f['账号昵称'] = p.account; if (a && a.home) f['主页链接'] = a.home; if (person && opts('人员').includes(person)) f['人员'] = person;
      if (p.code) f['合作码'] = p.code;
      const c = P.optionFor(p.city, opts('笔记城市')), s = P.optionFor(p.store, opts('笔记门店')), ty = P.optionFor(p.type, opts('笔记类型'));
      if (c) f['笔记城市'] = c; if (s) f['笔记门店'] = s; if (ty) f['笔记类型'] = ty;
      if (p.xhs) f['小红书链接'] = { link: p.xhs, text: p.xhs }; if (p.dp) f['点评链接'] = { link: p.dp, text: p.dp }; if (p.ctrip) f['携程链接'] = p.ctrip; if (p.wx) f['微信贴图'] = { link: p.wx, text: p.wx };
      rows.push(f); out.created.push(Object.assign(p, { person, storeOpt: s }));
      if (!p.account) out.noAcct.push(p);
    }
    if (rows.length) { const app = await appToken(); await api.call('POST', `/bitable/v1/apps/${app}/tables/${st.table.id}/records/batch_create`, { records: rows.map(fields => ({ fields })) }); st.rows = null; }
    return out;
  }

  // ---------- 截图 → 更新数据 ----------
  const sim = (a, b) => { if (!a || !b) return 0; if (a === b) return 1; if (a.length >= 6 && b.startsWith(a)) return 0.96; if (a.length >= 6 && b.includes(a)) return 0.9; return P.dice(a, b); };
  const dateHit = (md, ts, tol) => { if (!ts) return null; const t = String(md || ''); const full = t.match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/); const m = full ? [0, full[2], full[3]] : t.match(/(\d{1,2})\D+(\d{1,2})/); if (!m) return null; const d = new Date(ts); const y = full ? +full[1] : d.getFullYear(); return Math.abs(new Date(y, +m[1] - 1, +m[2]).getTime() - dayStart(ts)) <= (tol || 1.5) * DAY; };
  function match(notes, accHint, rowsIn, o) {
    o = o || {}; const ROWS = rowsIn || st.rows;
    const cand = (n, acc) => ROWS.filter(r => r.title && (!r.date || Date.now() - r.date < 240 * DAY)).map(r => { let s = sim(P.norm(n.title), P.norm(r.title)); if (s < 0.45) return null; const d = dateHit(n.date, r.date, o.tol); if (d === true) s += 0.15; else if (d === false) s -= (o.pen ?? 0.25); if (acc && r.account) s += P.norm(r.account) === P.norm(acc) ? 0.1 : -0.15; return { r, s }; }).filter(Boolean).sort((x, y) => y.s - x.s);
    let acc = accHint || '';
    if (!acc) { const v = {}; notes.forEach(n => { const c = cand(n, ''); if (c[0] && c[0].s >= 0.95 && (!c[1] || c[1].s < c[0].s - 0.1) && c[0].r.account) v[c[0].r.account] = (v[c[0].r.account] || 0) + 1; }); const b = Object.entries(v).sort((x, y) => y[1] - x[1])[0]; if (b && (b[1] >= 2 || notes.length === 1)) acc = b[0]; }
    const used = new Set();
    const uniqTitle = (n, c0) => { if (!c0) return false; const t = P.norm(n.title); if (sim(t, P.norm(c0.r.title)) < 0.95) return false; if (c0.r.date && n.date && dateHit(n.date, c0.r.date, 30) === false) return false; return ROWS.filter(r => r.id !== c0.r.id && sim(t, P.norm(r.title)) >= 0.85 && (!acc || !r.account || P.norm(r.account) === P.norm(acc))).length === 0; };
    return { acc, list: notes.map(n => { const c = cand(n, acc); const ok = c[0] && (c[0].s >= 0.95 && (!c[1] || c[1].s < c[0].s - 0.1) || uniqTitle(n, c[0])) && !used.has(c[0].r.id); if (ok) used.add(c[0].r.id); return { n, row: ok ? c[0].r : null, best: c[0] }; }) };
  }
  const PROMPT = `这是一张内容平台后台的数据截图（小红书「数据中心」、抖音创作者中心/抖音 App 作品数据、或微信视频号助手/视频号「数据中心」）。
先判断 platform：xhs（小红书）、douyin（抖音）、channels（微信视频号）、other（都不是）。区分要点：
- 小红书「数据中心」：左上角是返回箭头「<」，顶部有「账号概览 / 笔记分析 / 粉丝数据」页签，每条下面有绿色「笔记状态正常」，日期是封面上的「10-20」这种，只有 眼睛/爱心/评论 三个数；
- 微信视频号「数据中心」：左上角是「×」，每条下面直接写完整日期时间「2026年10月14日 23:01」，有 眼睛/爱心/评论/转发箭头 四个数，常有「昨日新增X次播放」，标题常带 #话题；
- 抖音：抖音创作者中心或抖音 App 的作品数据页。
再逐条提取每条作品：title 标题原文（只写看得到的，被截断就写到截断处，去掉省略号）、date 发布日期（截图里写的原样，如 10-20 或 2026年10月14日）、views 播放/观看/眼睛图标后的数字原样（如 4376、2.6万）、likes 点赞/爱心、comments 评论/气泡、shares 转发/分享（有才填）、collects 收藏（有才填，没有 null）。
只要数字完整可见的作品；"昨日新增"之类的增量数字不要当成总数。account 截图里若显示账号昵称就填。
另外回答 4 个判断题（只看截图本身，如实回答 true/false）：
- note_status：每条作品下面有没有绿色对勾「笔记状态正常」？
- date_has_year：作品日期是不是带年份的完整日期（如「2026年10月14日 23:01」）？封面角上的「10-20」不算。
- has_share：每条作品是不是有第 4 个数字（转发/分享箭头）？
- close_x：页面左上角是「×」关闭按钮吗？（返回箭头「<」不算）
只输出 JSON：{"platform":"","note_status":false,"date_has_year":false,"has_share":false,"close_x":false,"account":"","notes":[{"title":"","date":"","views":"","likes":"","comments":"","shares":null,"collects":null}]}`;
  async function handleImage(dataUrl, accHint, sender) {
    if (!api.vision) return null;
    const txt = await api.vision(PROMPT, dataUrl);
    let j; try { j = JSON.parse((txt.match(/\{[\s\S]*\}/) || [txt])[0]); } catch (e) { return { error: '识别结果不是 JSON' }; }
    const notes = (j.notes || []).filter(n => n && n.title).map(n => ({ title: String(n.title), date: String(n.date || ''), views: num(n.views), likes: num(n.likes), comments: num(n.comments), collects: num(n.collects), shares: num(n.shares) }));
    if (!notes.length) return null; // 不是数据中心截图
    // 平台由程序判：小红书有「笔记状态正常」、日期不带年份、只有 3 个数；视频号日期带年份、有转发数、左上角是 ×
    const yes = v => v === true || v === 'true';
    const withYear = notes.filter(n => /20\d{2}/.test(n.date)).length, withShare = notes.filter(n => n.shares !== null).length, half = Math.ceil(notes.length / 2);
    let plat;
    if (/douyin|抖音/i.test(j.platform) && !yes(j.note_status)) plat = 'douyin';
    else if (yes(j.note_status)) plat = 'xhs';
    else if (yes(j.date_has_year) || yes(j.close_x) || withYear >= half || (yes(j.has_share) && withShare >= half)) plat = 'channels';
    else plat = /channel|视频号|wechat|weixin/i.test(j.platform) ? 'channels' : 'xhs';
    log(`[截图] 判断为 ${plat}（AI 说 ${j.platform}；笔记状态 ${j.note_status}，带年份 ${j.date_has_year}/${withYear}，转发 ${j.has_share}/${withShare}，× ${j.close_x}）`);
    if (plat !== 'xhs') return handleVideo(plat, notes, accHint || j.account || '', sender);
    await load();
    const M = match(notes, accHint || j.account || '');
    const app = await appToken();
    const have = new Set((st.fields || []).map(f => f.name));
    for (const [name, type] of [['小眼睛(自动)', 2], ['点赞(自动)', 2], ['评论(自动)', 2], ['收藏(自动)', 2], ['分享(自动)', 2], ['数据更新于', 5]]) if (!have.has(name)) await api.call('POST', `/bitable/v1/apps/${app}/tables/${st.table.id}/fields`, { field_name: name, type });
    const now = Date.now();
    const recs = M.list.filter(x => x.row).map(({ n, row }) => { const f = { '数据更新于': now }; if (n.views !== null) f['小眼睛(自动)'] = n.views; if (n.likes !== null) f['点赞(自动)'] = n.likes; if (n.comments !== null) f['评论(自动)'] = n.comments; if (n.collects !== null) f['收藏(自动)'] = n.collects; if (n.shares !== null) f['分享(自动)'] = n.shares; return { record_id: row.id, fields: f }; });
    if (recs.length) { await api.call('POST', `/bitable/v1/apps/${app}/tables/${st.table.id}/records/batch_update`, { records: recs }); st.fields = null; st.rows = null; }
    return { platform: 'xhs', acc: M.acc, updated: M.list.filter(x => x.row), missed: M.list.filter(x => !x.row) };
  }

  // 抖音 / 视频号截图 → 两张抖音表里按标题对上 → 写「视频号…(自动)」或「抖音…(自动)」列
  const VCOL = { channels: ['视频号', '转发'], douyin: ['抖音', '分享'] };
  async function handleVideo(plat, notes, accHint, sender) {
    const names = cfg.videoTables || ['最新-抖音矩阵号-数据', '抖音素人号-数据'];
    const Ts = (await Promise.all(names.map(n => loadT(n)))).filter(Boolean);
    let all = Ts.flatMap(T => T.rows);
    if (plat === 'channels') { await load(); all = all.concat(st.rows.filter(r => r.chWx).map(r => Object.assign({}, r, { ch: true, kind: '贴图' }))); }
    const O = plat === 'channels' ? { tol: 3, pen: 0.1 } : {}; // 视频号常比抖音晚一两天发
    // 视频号：优先在「已填视频号/贴图号链接」的行里找；同一模板标题很多号都发过，先投票认出是哪个号
    // 视频号截图：只在「填了视频号 / 贴图号 / 微信贴图链接」的行里找；没填链接的行不写，只提醒补链接
    const pool = plat === 'channels' ? all.filter(r => r.ch) : all;
    let acc = accHint || '';
    if (!acc) {
      const votes = {};
      for (const n of notes) { const accs = new Set(pool.filter(r => r.account && sim(P.norm(n.title), P.norm(r.title)) >= 0.85 && dateHit(n.date, r.date, O.tol) !== false).map(r => r.account)); accs.forEach(a => { votes[a] = (votes[a] || 0) + 1; }); }
      const top = Object.entries(votes).sort((x, y) => y[1] - x[1]); if (top[0] && top[0][1] >= Math.min(2, notes.length) && (!top[1] || top[0][1] > top[1][1])) acc = top[0][0];
    }
    let M = match(notes, acc, pool, O);
    if (plat === 'channels') { // 没对上的：看看是不是表里有这条、只是没填视频号链接
      const noCh = all.filter(r => !r.ch);
      M.list.forEach(x => { if (x.row) return; const t = P.norm(x.n.title); const hit = noCh.filter(r => sim(t, P.norm(r.title)) >= 0.85).sort((a, b) => (dateHit(x.n.date, b.date, 3) === true) - (dateHit(x.n.date, a.date, 3) === true))[0]; if (hit) x.noLink = hit; });
    }
    M.acc = M.acc || acc;
    const app = await appToken(); const now = Date.now();
    // 小红书表里的视频号贴图：写进小红书表的「视频号…(自动)」列（小红书表没有视频号数据列）
    const xm = M.list.filter(x => x.row && x.row.table === '__xhs');
    if (xm.length) {
      const have = new Set((st.fields || []).map(f => f.name));
      const cols = [['视频号播放(自动)', 'views'], ['视频号点赞(自动)', 'likes'], ['视频号评论(自动)', 'comments'], ['视频号转发(自动)', 'shares']];
      for (const [c] of cols.concat([['视频号更新于']])) if (!have.has(c)) await api.call('POST', `/bitable/v1/apps/${app}/tables/${st.table.id}/fields`, { field_name: c, type: c === '视频号更新于' ? 5 : 2 });
      const recs = xm.map(({ n, row }) => { const f = { '视频号更新于': now }; cols.forEach(([c, k]) => { const v = n[k]; if (v === null || v === undefined) return; const old = row.cur && row.cur[k]; if (old !== null && old !== undefined && old > v) return; f[c] = v; }); return { record_id: row.id, fields: f }; });
      await api.call('POST', `/bitable/v1/apps/${app}/tables/${st.table.id}/records/batch_update`, { records: recs }); st.rows = null; st.fields = null;
    }
    for (const T of Ts) {
      const mine = M.list.filter(x => x.row && x.row.table === T.name); if (!mine.length) continue;
      let recs;
      if (plat === 'channels' && ['播放量', '点赞量', '评论量', '转发量'].every(c => T.fields.includes(c))) {
        // 视频号：直接写进表里原有的「视频号数据」几列；数只会涨，表里已有更大的数就不改小
        const MAP = [['播放量', 'views'], ['点赞量', 'likes'], ['评论量', 'comments'], ['转发量', 'shares']];
        recs = mine.map(({ n, row }) => { const f = {}; MAP.forEach(([c, k]) => { const v = n[k]; if (v === null || v === undefined) return; const old = row.cur && row.cur[k]; if (old !== null && old !== undefined && old > v) return; f[c] = String(v); }); return { record_id: row.id, fields: f }; }).filter(r => Object.keys(r.fields).length);
      } else {
        const [pre, shareWord] = VCOL[plat];
        const cols = [[`${pre}播放(自动)`, 2, 'views'], [`${pre}点赞(自动)`, 2, 'likes'], [`${pre}评论(自动)`, 2, 'comments'], [`${pre}${shareWord}(自动)`, 2, 'shares'], [`${pre}收藏(自动)`, 2, 'collects'], [`${pre}更新于`, 5, null]];
        for (const [name, type] of cols) if (!T.fields.includes(name)) { await api.call('POST', `/bitable/v1/apps/${app}/tables/${T.id}/fields`, { field_name: name, type }); T.fields.push(name); }
        recs = mine.map(({ n, row }) => { const f = {}; cols.forEach(([name, , k]) => { if (!k) f[name] = now; else if (n[k] !== null && n[k] !== undefined) f[name] = n[k]; }); return { record_id: row.id, fields: f }; });
      }
      if (recs.length) await api.call('POST', `/bitable/v1/apps/${app}/tables/${T.id}/records/batch_update`, { records: recs });
      vt[T.name] = null; // 下次重读
    }
    if (plat === 'channels') { try { await sphFill(M.list.filter(x => !x.row && !x.noLink), sender); } catch (e) { log('[视频号] 写入视频号表出错：' + e.message); } }
    return { platform: plat, acc: M.acc, updated: M.list.filter(x => x.row), missed: M.list.filter(x => !x.row) };
  }

  // ---------- 视频号-数据：发链接先登记，一周后发截图补标题和数据 ----------
  const SPH_NAME = cfg.sphTable || '视频号-数据';
  const SPH_COLS = [['标题', 1], ['发布日期', 5], ['发布人员', 1], ['账号名称', 1], ['视频号链接', 15], ['播放', 2], ['点赞', 2], ['评论', 2], ['转发', 2], ['收藏', 2], ['数据更新于', 5], ['登记时间', 5], ['类型', 1], ['来源', 1]];
  const sphKey = u => { const m = String(u || '').match(/(?:sph\/|id=|feed\/|export\/)([A-Za-z0-9_-]{6,})/); return m ? m[1] : String(u || '').trim(); };
  let sphNoAdd = false;
  async function sphTable() {
    const app = await appToken(); const t = (await listTables()).find(x => x.name === SPH_NAME); if (!t) throw new Error('NO_SPH_TABLE');
    const fd = await api.call('GET', `/bitable/v1/apps/${app}/tables/${t.table_id}/fields`, null, { page_size: 200 }); const types = new Map((fd.items || []).map(f => [f.field_name, f.type]));
    const miss = SPH_COLS.filter(([n]) => !types.has(n));
    if (miss.length && !sphNoAdd) for (const [name, type] of miss) { try { await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/fields`, { field_name: name, type }); types.set(name, type); log('[视频号] 补建列：' + name); } catch (e) { sphNoAdd = true; log('[视频号] 没权限补建列（只写已有的列）：' + miss.map(x => x[0]).join('、')); break; } }
    const recs = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); recs.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    const rows = recs.map(r => { const f = r.fields || {}; return { id: r.record_id, title: titleOf(f['标题']), date: typeof f['发布日期'] === 'number' ? f['发布日期'] : null, person: String(val(f['发布人员']) || '').trim(), acc: String(val(f['账号名称']) || '').trim(), kind: String(val(f['账号类型']) || '').trim(), link: String(val(f['视频号链接']) || ''), reg: typeof f['登记时间'] === 'number' ? f['登记时间'] : 0, cur: { views: num(f['播放']), likes: num(f['点赞']), comments: num(f['评论']), shares: num(f['转发']) } }; });
    // 表是人手建的，列类型可能和预设不同（文本/日期/链接/数字/单选/人员），按实际类型转换写入值
    const ymd = t => { const d = new Date(t + 8 * 3600e3); return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`; };
    const fit = f => { const o = {}; for (const [k, v] of Object.entries(f)) { const ty = types.get(k); if (v === null || v === undefined || ty === undefined) continue; const isUrl = v && typeof v === 'object' && v.link; const isDate = /日期|时间|更新于/.test(k) && typeof v === 'number';
      if (ty === 15) o[k] = isUrl ? v : { link: String(v), text: String(v) };
      else if (ty === 5) { if (typeof v === 'number') o[k] = v; }
      else if (ty === 2) { const n = Number(v); if (isFinite(n)) o[k] = n; }
      else if (ty === 1 || ty === 3) o[k] = isUrl ? v.link : isDate ? ymd(v) : String(v);
      else if (ty === 4) o[k] = [isUrl ? v.link : isDate ? ymd(v) : String(v)];
      else if (ty === 11 || ty === 1001 || ty === 1002 || ty === 20 || ty === 19) continue; // 人员/系统/公式列不写
      else o[k] = isUrl ? v.link : v; }
      return o; };
    return { app, id: t.table_id, rows, fit };
  }
  async function handleChannelsLink(text, sender) {
    const links = [...new Set((String(text).match(/https?:\/\/(?:weixin\.qq\.com\/sph\/[A-Za-z0-9_-]+|channels\.weixin\.qq\.com\/[^\s，。)）]+)/g) || []))];
    if (!links.length) return null;
    const T = await sphTable(); const out = { created: [], dups: [] }; const add = []; const now = Date.now();
    for (const u of links) { const ex = T.rows.find(r => sphKey(r.link) === sphKey(u)); if (ex) { out.dups.push(u); (out.dupInfo = out.dupInfo || []).push([ex.kind, ex.person, ex.acc, ex.title ? ex.title.slice(0, 16) : '标题待补', ex.date ? new Date(ex.date + 8 * 3600e3).toISOString().slice(5, 10).replace('-', '/') : ''].filter(Boolean).join(' · ')); continue; } const f = { 视频号链接: { link: u, text: u }, 发布日期: dayStart(now), 登记时间: now }; if (sender) f['发布人员'] = sender; add.push({ fields: T.fit(f) }); out.created.push(u); }
    if (add.length) await api.call('POST', `/bitable/v1/apps/${T.app}/tables/${T.id}/records/batch_create`, { records: add });
    return out;
  }
  // 视频号截图里没在抖音/小红书表对上的：先按标题找视频号表，再找「同一人发、日期对得上、标题还空着」的登记行
  async function sphFill(list, sender) {
    if (!list.length) return; let T; try { T = await sphTable(); } catch (e) { if (e.message === 'NO_SPH_TABLE') return; throw e; }
    const recs = []; const now = Date.now(); const used = new Set();
    if (sender && !T.rows.some(r => r.person === sender && r.title)) sender = '';
    for (const x of list) {
      const t = P.norm(x.n.title); let row = T.rows.filter(r => r.title && !used.has(r.id)).map(r => ({ r, s: sim(t, P.norm(r.title)) })).filter(o => o.s >= 0.85).sort((a, b) => b.s - a.s)[0];
      let fillTitle = false;
      if (!row) {
        const cand = T.rows.filter(r => r.link && !r.title && !used.has(r.id) && (!sender || !r.person || r.person === sender) && (r.date === null || dateHit(x.n.date, r.date, 1) !== false));
        // 链接和截图一起发（15 分钟内同一人登记的空标题行），补登旧内容时日期对不上也认
        const recent = T.rows.filter(r => r.link && !r.title && !used.has(r.id) && r.reg && now - r.reg < 15 * 60e3 && (!sender || !r.person || r.person === sender));
        const pick = cand.length ? cand : recent;
        if (pick.length === 1) { row = { r: pick[0] }; fillTitle = true; } else if (pick.length > 1) { x.sphAmbig = pick.map(c => c.link); continue; } else continue;
      }
      used.add(row.r.id); const f = { 数据更新于: now };
      if (fillTitle) { f['标题'] = x.n.title.replace(/\.{3}$|…$/, ''); const dm = String(x.n.date).match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/); if (dm) f['发布日期'] = new Date(+dm[1], +dm[2] - 1, +dm[3]).getTime(); }
      [['播放', 'views'], ['点赞', 'likes'], ['评论', 'comments'], ['转发', 'shares'], ['收藏', 'collects']].forEach(([c, k]) => { const v = x.n[k]; if (v === null || v === undefined) return; const old = row.r.cur && row.r.cur[k]; if (old !== null && old !== undefined && old > v) return; f[c] = v; });
      recs.push({ record_id: row.r.id, fields: T.fit(f) }); x.row = { table: SPH_NAME, account: row.r.person || '视频号表', date: row.r.date, kind: fillTitle ? '新补标题' : '' };
    }
    if (recs.length) await api.call('POST', `/bitable/v1/apps/${T.app}/tables/${T.id}/records/batch_update`, { records: recs });
  }


  // ---------- 门店营业日报 ----------
  const D = require('./daily');
  let dailyApp = '';
  async function dailyAppToken() {
    if (dailyApp) return dailyApp;
    const u = cfg.dailyBaseUrl || ''; let m;
    if (!u) throw new Error('NO_PRIVATE_BASE');
    if ((m = u.match(/\/base\/([A-Za-z0-9]+)/))) return (dailyApp = m[1]);
    if ((m = u.match(/\/wiki\/([A-Za-z0-9]+)/))) { const d = await api.call('GET', '/wiki/v2/spaces/get_node', null, { token: m[1], obj_type: 'wiki' }); return (dailyApp = d.node.obj_token); }
    throw new Error('config.json 里 dailyBaseUrl 不是多维表格链接');
  }
  async function handleDaily(text, source) {
    const all = D.parseDaily(text); if (!all.length) return null;
    // 像测试数据的不入库：日期在未来、超过 60 天前，或营业额低于 100
    const now = Date.now(); const bad = all.filter(r => r.ts > now + 2 * DAY || r.ts < now - 60 * DAY || (r.total !== null && r.total !== undefined && r.total < 100));
    const list = all.filter(r => !bad.includes(r)); if (bad.length) log('[日报] 疑似测试数据，没入库：' + bad.map(r => `${r.store} ${r.date} 营业额${r.total}`).join('；'));
    if (!list.length) return bad.map(r => Object.assign({}, r, { rejected: true }));
    // 经营数据只写进你自己的私密表格（config.json 的 dailyBaseUrl），绝不写进营销部共享的表
    const app = await dailyAppToken(); if (app === await appToken()) throw new Error('dailyBaseUrl 不能和营销部共享表格是同一个');
    const name = cfg.dailyTable || '门店营业日报';
    const tabs = []; { let pt = ''; do { const d = await api.call('GET', `/bitable/v1/apps/${app}/tables`, null, Object.assign({ page_size: 100 }, pt ? { page_token: pt } : {})); tabs.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt); }
    let t = tabs.find(x => x.name === name);
    if (!t) { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables`, { table: { name, default_view_name: '全部', fields: D.COLS.map(([field_name, type]) => ({ field_name, type })) } }); t = { table_id: d.table_id }; log('[日报] 新建表：' + name); }
    else { const fd = await api.call('GET', `/bitable/v1/apps/${app}/tables/${t.table_id}/fields`, null, { page_size: 200 }); const have = new Set((fd.items || []).map(f => f.field_name)); for (const [c, type] of D.COLS) if (!have.has(c)) await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/fields`, { field_name: c, type }); }
    const recs = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/records/search`, { field_names: ['日期', '门店', '总营业额'] }, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); recs.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    const keyOf = (ts, store) => `${new Date(ts).toDateString()}|${String(store).trim()}`;
    const exist = new Map(recs.map(r => [keyOf(r.fields['日期'], val(r.fields['门店'])), r]));
    const add = [], upd = [], out = [];
    for (const r of list) {
      const f = D.toFields(r, source); const ex = exist.get(keyOf(r.ts, r.store));
      if (ex) upd.push({ record_id: ex.record_id, fields: f }); else add.push({ fields: f });
      const lw = recs.find(x => keyOf(x.fields['日期'], val(x.fields['门店'])) === keyOf(r.ts - 7 * DAY, r.store));
      const lwv = lw ? num(lw.fields['总营业额']) : null;
      out.push(Object.assign({}, r, { updated: !!ex, lastWeek: lwv, wow: lwv ? Math.round((r.total - lwv) / lwv * 1000) / 10 : null }));
    }
    for (let i = 0; i < add.length; i += 400) await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/records/batch_create`, { records: add.slice(i, i + 400) });
    for (let i = 0; i < upd.length; i += 400) await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/records/batch_update`, { records: upd.slice(i, i + 400) });
    log(`[日报] 新增 ${add.length}，更新 ${upd.length}`);
    return out.concat(bad.map(r => Object.assign({}, r, { rejected: true })));
  }


  // ---------- 抖音分享 → 先在矩阵号表找账号，找不到再去素人号表；找到就在那张表登记新作品 ----------
  const DY = require('./douyin');
  async function handleDouyin(text, senderName) {
    const posts = DY.parseDouyin(text); if (!posts.length) return null;
    const names = cfg.videoTables || ['最新-抖音矩阵号-数据', '抖音素人号-数据'];
    const Ts = []; for (const n of names) { const T = await loadT(n, true); if (T) Ts.push(T); }
    const out = { created: [], dups: [], noAcct: [], noCol: [] }; const add = {};
    for (const p of posts) {
      const info = api.fetchDouyin ? await api.fetchDouyin(p.url) : {};
      if (info.title && (p.truncated || info.title.length > p.title.length)) p.title = info.title;
      p.nick = info.nick || p.nick; p.time = info.time || null; p.id = info.id || '';
      const keys = [dyKey(p.url), p.id ? 'i:' + p.id : ''].filter(Boolean);
      const dupT = Ts.find(T => keys.some(k => T.links.has(k)) || (P.norm(p.title).length >= 8 && T.rows.some(r => (!p.nick || !r.account || P.norm(r.account) === P.norm(p.nick)) && sim(P.norm(p.title), P.norm(r.title)) >= 0.95)));
      if (dupT) { out.dups.push(Object.assign(p, { table: dupT.name })); continue; }
      const T = p.nick && Ts.find(T => [...T.accts].some(a => P.norm(a) === P.norm(p.nick)));
      if (!T) { out.noAcct.push(p); continue; }
      if (!T.linkCol) { out.noCol.push(Object.assign(p, { table: T.name })); continue; }
      const lf = T.meta.find(f => f.name === T.linkCol); const f = {};
      f[T.linkCol] = lf.type === 15 ? { link: p.url, text: p.url } : p.url;
      const af = T.meta.find(x => x.name === T.accCol); const acc = [...T.accts].find(a => P.norm(a) === P.norm(p.nick));
      if (af && af.type === 1) f[T.accCol] = acc; else if (af && af.type === 3 && af.options.includes(acc)) f[T.accCol] = acc;
      const df = T.meta.find(x => x.name === '发布日期'); if (df && df.type === 5) f['发布日期'] = dayStart(p.time || Date.now());
      const pf = T.meta.find(x => x.name === '发布人员') || T.meta.find(x => x.name === '人员'); const person = senderName && pf && (pf.options || []).find(o => senderName.includes(o) || o.includes(senderName)); if (person) f['人员'] = pf.type === 4 ? [person] : person;
      (add[T.name] = add[T.name] || { T, recs: [] }).recs.push({ fields: f }); out.created.push(Object.assign(p, { table: T.name, account: acc })); T.links.add(dyKey(p.url));
    }
    const app = await appToken();
    for (const { T, recs } of Object.values(add)) { await api.call('POST', `/bitable/v1/apps/${app}/tables/${T.id}/records/batch_create`, { records: recs }); vt[T.name] = null; }
    return out;
  }

  // 历史导入：从抖音矩阵号 / 视频号矩阵号 / 抖音素人号三张表里把视频号内容复制到「视频号-数据」（只读原表，按链接去重，可重复执行）
  async function sphImport() {
    const app = await appToken(); const all = await listTables(); const T = await sphTable();
    const WX = /https?:\/\/(?:weixin\.qq\.com\/sph\/[A-Za-z0-9_-]+|channels\.weixin\.qq\.com\/[^\s"\\,，。)）]+)/;
    const link = v => { const m = JSON.stringify(v ?? '').match(WX); return m ? m[0] : ''; };
    const read = async name => { const t = all.find(x => x.name === name); if (!t) return []; const recs = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); recs.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt); return recs.map(r => r.fields || {}); };
    const mx = (...a) => { const v = a.map(num).filter(x => x !== null && x !== undefined); return v.length ? Math.max(...v) : null; };
    const items = new Map(); const seen = new Set(T.rows.map(r => sphKey(r.link)).filter(Boolean));
    const put = (u, o) => { const k = sphKey(u); if (!u || seen.has(k)) return; const old = items.get(k); if (!old) { items.set(k, Object.assign({ u }, o)); return; } for (const [a, b] of Object.entries(o)) if ((old[a] === null || old[a] === undefined || old[a] === '') && b !== null && b !== undefined && b !== '') old[a] = b; };
    const base = (f, src, kind) => ({ title: titleOf(f['标题(供AI读取)'] || f['..标题'] || f['标题']), date: typeof f['发布日期'] === 'number' ? f['发布日期'] : null, person: String(val(f['发布人员']) || '').trim(), acc: String(val(f['账号名称']) || '').trim(), src, kind });
    for (const f of await read('抖音-矩阵号-数据')) { const u = link(f['视频号链接']); put(u, Object.assign(base(f, '抖音-矩阵号-数据', '视频'), { views: mx(f['播放量'], f['视频号播放(自动)']), likes: mx(f['点赞量'], f['视频号点赞(自动)']), comments: mx(f['评论量'], f['视频号评论(自动)']), shares: mx(f['转发量'], f['视频号转发(自动)']), collects: mx(f['视频号收藏(自动)']) })); }
    for (const f of await read('视频号-矩阵号-数据')) { const u = link(f['视频号链接']); put(u, Object.assign(base(f, '视频号-矩阵号-数据', '视频'), { views: mx(f['播放量']), likes: mx(f['点赞量']), comments: mx(f['评论量']), shares: mx(f['转发量']) })); }
    for (const f of await read('抖音-素人号-数据')) { const m = { views: mx(f['播放量']), likes: mx(f['点赞量']), comments: mx(f['评论量']), shares: mx(f['转发量']) }; const v = link(f['视频号']), p = link(f['贴图号']); if (v) put(v, Object.assign(base(f, '抖音-素人号-数据', '视频'), m)); if (p) put(p, Object.assign(base(f, '抖音-素人号-数据', '贴图'), m)); }
    const now = Date.now(); const recs = [...items.values()].map(o => ({ fields: T.fit({ 标题: o.title || null, 发布日期: o.date, 发布人员: o.person || null, 账号名称: o.acc || null, 视频号链接: { link: o.u, text: o.u }, 播放: o.views, 点赞: o.likes, 评论: o.comments, 转发: o.shares, 收藏: o.collects, 类型: o.kind, 来源: o.src, 登记时间: now }) }));
    for (let i = 0; i < recs.length; i += 400) await api.call('POST', `/bitable/v1/apps/${T.app}/tables/${T.id}/records/batch_create`, { records: recs.slice(i, i + 400) });
    const by = {}; [...items.values()].forEach(o => { by[o.src] = (by[o.src] || 0) + 1; });
    return { added: recs.length, skipped: T.rows.filter(r => r.link).length, by };
  }
  // 把「视频号-数据」整理成和抖音表一样：发布人员改单选（沿用原表颜色），补 账号类型/账号主页/发布内容/区域定位/投流状态（只读原表）
  async function sphFormat() {
    const app = await appToken(); const all = await listTables(); const T = await sphTable();
    const WX = /https?:\/\/(?:weixin\.qq\.com\/sph\/[A-Za-z0-9_-]+|channels\.weixin\.qq\.com\/[^\s"\\,，。)）]+)/;
    const link = v => { const m = JSON.stringify(v ?? '').match(WX); return m ? m[0] : ''; };
    const SRC = [['抖音-矩阵号-数据', '矩阵号', ['视频号链接']], ['视频号-矩阵号-数据', '矩阵号', ['视频号链接']], ['抖音-素人号-数据', '素人号', ['视频号', '贴图号']]];
    const opts = { 发布人员: new Map(), 发布内容: new Map(), 投流状态: new Map() }; const info = new Map();
    for (const [name, kind, cols] of SRC) {
      const t = all.find(x => x.name === name); if (!t) continue;
      const fd = await api.call('GET', `/bitable/v1/apps/${app}/tables/${t.table_id}/fields`, null, { page_size: 200 });
      for (const f of fd.items || []) if (opts[f.field_name] && f.type === 3) for (const o of (f.property || {}).options || []) if (!opts[f.field_name].has(o.name)) opts[f.field_name].set(o.name, o.color);
      let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {}));
        for (const r of d.items || []) { const f = r.fields || {}; for (const c of cols) { const u = link(f[c]); if (!u) continue; const k = sphKey(u); if (info.has(k)) continue;
          const home = f['账号主页']; info.set(k, { 账号类型: kind, 发布人员: String(val(f['发布人员']) || '').trim(), 账号主页: home && typeof home === 'object' && home.link ? { link: home.link, text: home.text || home.link } : null, 发布内容: String(val(f['发布内容']) || '').trim(), 区域定位: String(val(f['区域定位']) || '').trim(), 投流状态: String(val(f['投流状态']) || '').trim() }); } }
        pt = d.has_more ? d.page_token : ''; } while (pt);
    }
    const fd = await api.call('GET', `/bitable/v1/apps/${T.app}/tables/${T.id}/fields`, null, { page_size: 200 }); const F = new Map((fd.items || []).map(f => [f.field_name, f]));
    const selOpts = (m, extra) => { const o = [...m].map(([name, color]) => ({ name, color })); (extra || []).forEach(n => { if (n && !m.has(n)) o.push({ name: n }); }); return o; };
    const used = n => [...new Set([...info.values()].map(x => x[n]).filter(Boolean))];
    const want = [['账号类型', 3, { options: [{ name: '矩阵号', color: 0 }, { name: '素人号', color: 1 }] }], ['账号主页', 15], ['发布内容', 3, { options: selOpts(opts.发布内容, used('发布内容')) }], ['区域定位', 1], ['投流状态', 3, { options: selOpts(opts.投流状态, used('投流状态')) }]];
    for (const [name, type, property] of want) if (!F.has(name)) { await api.call('POST', `/bitable/v1/apps/${T.app}/tables/${T.id}/fields`, Object.assign({ field_name: name, type }, property ? { property } : {})); log('[视频号整理] 新增列 ' + name); }
    const pf = F.get('发布人员'); const people = selOpts(opts.发布人员, used('发布人员').concat(T.rows.map(r => r.person)));
    if (pf && pf.type !== 3) { await api.call('PUT', `/bitable/v1/apps/${T.app}/tables/${T.id}/fields/${pf.field_id}`, { field_name: '发布人员', type: 3, property: { options: people } }); log('[视频号整理] 发布人员改成单选'); }
    const T2 = await sphTable(); const recs = [];
    for (const r of T2.rows) { const x = info.get(sphKey(r.link)); if (!r.link || !x) continue; const fl = T2.fit(Object.fromEntries(Object.entries(x).filter(([, v]) => v))); if (Object.keys(fl).length) recs.push({ record_id: r.id, fields: fl }); }
    for (let i = 0; i < recs.length; i += 400) await api.call('POST', `/bitable/v1/apps/${T2.app}/tables/${T2.id}/records/batch_update`, { records: recs.slice(i, i + 400) });
    return { filled: recs.length, people: people.length };
  }
  // 补标题 + 补导小红书表「微信贴图」列（只读原表）：
  // 1) 小红书矩阵号表里的微信贴图链接（视频号贴图）导进来，标题直接带上
  // 2) 视频号表里还没标题的行：找同一发布人员、同一天在小红书/抖音表里发的内容，只有一个标题时才填
  async function sphTitles() {
    const app = await appToken(); const all = await listTables(); const T = await sphTable();
    const WX = /https?:\/\/(?:weixin\.qq\.com\/sph\/[A-Za-z0-9_-]+|channels\.weixin\.qq\.com\/[^\s"\\,，。)）]+)/;
    const link = v => { const m = JSON.stringify(v ?? '').match(WX); return m ? m[0] : ''; };
    const read = async name => { const t = all.find(x => x.name === name); if (!t) return []; const recs = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); recs.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt); return recs.map(r => r.fields || {}); };
    const bj = t => Math.floor((t + 8 * 3600e3) / DAY); const mx = (...a) => { const v = a.map(num).filter(x => x !== null && x !== undefined); return v.length ? Math.max(...v) : null; };
    const tt = f => { const x = titleOf(f['标题(供AI读取)'] || f['..标题'] || f['标题']).replace(/\.{3}$|…$/, '').trim(); return /^@/.test(x) || x.length < 4 ? '' : x; };
    const pool = []; // {person, day, title}
    const have = new Set(T.rows.map(r => sphKey(r.link)).filter(Boolean)); const add = []; const now = Date.now();
    for (const f of await read('小红书矩阵号-数据')) {
      const person = String(val(f['人员'] || f['发布人员']) || '').trim(), date = typeof f['发布日期'] === 'number' ? f['发布日期'] : null, title = tt(f);
      if (person && date && title && !link(f['微信贴图'])) pool.push({ person, day: bj(date), title, src: '小红书' });
      const u = link(f['微信贴图']); if (!u || have.has(sphKey(u))) continue; have.add(sphKey(u));
      const home = f['主页链接'];
      add.push({ fields: T.fit({ 标题: title || null, 发布日期: date, 发布人员: person || null, 账号名称: String(val(f['账号昵称']) || '').trim() || null, 视频号链接: { link: u, text: u }, 播放: mx(f['视频号播放(自动)']), 点赞: mx(f['视频号点赞(自动)']), 评论: mx(f['视频号评论(自动)']), 转发: mx(f['视频号转发(自动)']), 收藏: mx(f['视频号收藏(自动)']), 类型: '贴图', 来源: '小红书矩阵号-数据', 账号类型: '矩阵号', 账号主页: home && typeof home === 'object' && home.link ? { link: home.link, text: home.text || home.link } : null, 登记时间: now }) });
    }
    for (const n of ['抖音-矩阵号-数据', '抖音-素人号-数据']) for (const f of await read(n)) { const person = String(val(f['发布人员']) || '').trim(), date = typeof f['发布日期'] === 'number' ? f['发布日期'] : null, title = tt(f); if (person && date && title && !link(f['视频号链接']) && !link(f['视频号']) && !link(f['贴图号'])) pool.push({ person, day: bj(date), title, src: '抖音' }); }
    for (let i = 0; i < add.length; i += 400) await api.call('POST', `/bitable/v1/apps/${T.app}/tables/${T.id}/records/batch_create`, { records: add.slice(i, i + 400) });
    const norm = x => P.norm(x); const upd = [], amb = [], none = [];
    for (const r of T.rows.filter(r => r.link && !r.title)) {
      if (!r.person || !r.date) { none.push(`${r.person || '?'} 无日期`); continue; }
      const c = pool.filter(p => p.person === r.person && p.day === bj(r.date)); const uniq = [];
      for (const p of c) if (!uniq.some(q => sim(norm(q.title), norm(p.title)) >= 0.8)) uniq.push(p);
      if (uniq.length === 1) upd.push({ record_id: r.id, fields: T.fit({ 标题: uniq[0].title }) });
      else if (uniq.length > 1) amb.push(`${r.person} ${new Date(r.date + 8 * 3600e3).toISOString().slice(5, 10)}：${uniq.map(u => u.title.slice(0, 12)).join(' / ')}`);
      else none.push(`${r.person} ${new Date(r.date + 8 * 3600e3).toISOString().slice(5, 10)}`);
    }
    for (let i = 0; i < upd.length; i += 400) await api.call('POST', `/bitable/v1/apps/${T.app}/tables/${T.id}/records/batch_update`, { records: upd.slice(i, i + 400) });
    return { imported: add.length, filled: upd.length, ambiguous: amb, notFound: none };
  }
  // 派稿表：PR 派稿时在这里填一行（图文/视频两种），以后发布链接进来时机器人按它补标题
  const PG_NAME = '派稿记录';
  const PG_COLS = [['标题', 1], ['派稿日期', 5], ['内容类型', 3, { options: [{ name: '图文', color: 0 }, { name: '视频', color: 1 }] }], ['发布平台', 4, { options: ['小红书', '抖音', '视频号', '微信贴图', '大众点评', '携程'].map((name, color) => ({ name, color })) }], ['门店', 3, { options: ['深圳华强北燕南店', '深圳前海HOP店', '深圳白石洲店', '深圳蛇口招商花园城店', '广州江南西店', '珠海玖洲道店', '惠州水东街店', '东莞东城33小镇店', '佛山创意产业园店', '佛山保利西街店', '粤迹·岭南家宴'].map((name, color) => ({ name, color: color % 10 })) }], ['发布人员', 3], ['账号名称', 1], ['稿件编号', 1], ['文案正文', 1], ['话题标签', 1], ['定位', 1], ['点评定位', 1], ['素材', 17], ['状态', 3, { options: [{ name: '待发布', color: 2 }, { name: '已发布', color: 4 }, { name: '取消', color: 7 }] }], ['小红书链接', 15], ['抖音链接', 15], ['视频号链接', 15], ['派稿人', 1], ['备注', 1]];
  async function ensurePaigao() {
    const app = await appToken(); const t = (await listTables()).find(x => x.name === PG_NAME);
    if (!t) { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables`, { table: { name: PG_NAME, default_view_name: '全部', fields: PG_COLS.map(([field_name, type, property]) => Object.assign({ field_name, type }, property ? { property } : {})) } }); log('[派稿] 新建表：' + PG_NAME); return ensurePaigao(); }
    const fd = await api.call('GET', `/bitable/v1/apps/${app}/tables/${t.table_id}/fields`, null, { page_size: 200 }); const have = new Set((fd.items || []).map(f => f.field_name));
    for (const [field_name, type, property] of PG_COLS) if (!have.has(field_name)) { try { await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/fields`, Object.assign({ field_name, type }, property ? { property } : {})); log('[派稿] 补建列 ' + field_name); } catch (e) { log('[派稿] 补建列失败 ' + field_name + '：' + e.message); } }
    // 发布人员下拉：和抖音/小红书表同一套名字和颜色，PR 派稿时直接选人（微信里 @ 的是昵称，对不上）
    try {
      const all = await listTables(); const opts = new Map();
      for (const n of ['抖音-矩阵号-数据', '抖音-素人号-数据', '小红书矩阵号-数据', '视频号-数据']) { const x = all.find(y => y.name === n); if (!x) continue; const f = await api.call('GET', `/bitable/v1/apps/${app}/tables/${x.table_id}/fields`, null, { page_size: 200 }); for (const it of f.items || []) if ((it.field_name === '发布人员' || it.field_name === '人员') && it.type === 3) for (const o of (it.property || {}).options || []) if (o.name && !opts.has(o.name)) opts.set(o.name, o.color); }
      const fd2 = await api.call('GET', `/bitable/v1/apps/${app}/tables/${t.table_id}/fields`, null, { page_size: 200 }); const pf = (fd2.items || []).find(f => f.field_name === '发布人员'); const cur = new Set(((pf && pf.property) || {}).options ? pf.property.options.map(o => o.name) : []);
      const merged = (((pf && pf.property) || {}).options || []).map(o => ({ name: o.name, color: o.color })).concat([...opts].filter(([n]) => !cur.has(n)).map(([name, color]) => ({ name, color })));
      if (pf && merged.length > cur.size) { await api.call('PUT', `/bitable/v1/apps/${app}/tables/${t.table_id}/fields/${pf.field_id}`, { field_name: '发布人员', type: 3, property: { options: merged } }); log(`[派稿] 发布人员下拉同步 ${merged.length} 人`); }
    } catch (e) { log('[派稿] 同步发布人员下拉失败 ' + e.message); }
    return t.table_id;
  }
  // 清掉误填的占位标题（如「@武少」）
  async function sphCleanTitles() {
    const T = await sphTable(); const bad = T.rows.filter(r => r.title && /^@\S{1,12}$/.test(r.title.trim()));
    if (bad.length) await api.call('POST', `/bitable/v1/apps/${T.app}/tables/${T.id}/records/batch_update`, { records: bad.map(r => ({ record_id: r.id, fields: { 标题: '' } })) });
    return bad.map(r => r.title);
  }
  // 只读盘点：哪些表里有视频号内容（不改任何表）
  async function sphSurvey() {
    const app = await appToken(); const all = await listTables(); const out = [];
    for (const t of all.filter(x => /视频号|抖音/.test(x.name))) {
      try {
        const fd = await api.call('GET', `/bitable/v1/apps/${app}/tables/${t.table_id}/fields`, null, { page_size: 200 });
        const recs = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); recs.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
        const wx = recs.filter(r => /weixin\.qq\.com|channels\.weixin/.test(JSON.stringify(r.fields || {})));
        const cols = {}; wx.forEach(r => Object.entries(r.fields || {}).forEach(([k, v]) => { if (/weixin\.qq\.com|channels\.weixin/.test(JSON.stringify(v))) cols[k] = (cols[k] || 0) + 1; }));
        const sample = wx[0] ? Object.fromEntries(Object.entries(wx[0].fields).map(([k, v]) => [k, String(JSON.stringify(v)).slice(0, 80)])) : null;
        out.push({ name: t.name, id: t.table_id, rows: recs.length, wx: wx.length, wxCols: cols, fields: (fd.items || []).map(f => f.field_name + ':' + f.type).join(','), sample });
      } catch (e) { out.push({ name: t.name, err: e.message }); }
    }
    return out;
  }
  return { handleText, handleImage, handleDaily, handleDouyin, handleChannelsLink, sphSurvey, sphImport, sphFormat, sphTitles, ensurePaigao, sphCleanTitles, load, loadT, _st: st, _match: match };
}

// 回复文案
function replyForText(r) {
  if (!r) return '';
  const L = [];
  if (r.created.length) L.push(`✅ 已登记 ${r.created.length} 条：` + r.created.map(p => `\n· ${p.title.slice(0, 20)}｜${p.account || '账号待补'}${p.storeOpt ? '｜' + p.storeOpt : ''}`).join(''));
  if (r.dups.length) L.push(`↩️ ${r.dups.length} 条之前登记过，跳过`);
  if (r.noAcct.length) L.push(`⚠️ ${r.noAcct.length} 条没认出是哪个号，请到飞书表里补「账号昵称」`);
  return L.join('\n');
}
function replyForDaily(list) {
  if (!list || !list.length) return '';
  const rej = list.filter(r => r.rejected); list = list.filter(r => !r.rejected);
  const rj = rej.length ? rej.map(r => `⚠️ ${r.store} ${String(r.date).slice(5)} 营业额 ${r.total ?? '—'}：看着像测试数据，没记录`).join('\n') : '';
  if (!list.length) return rj;
  const w = x => (x === null || x === undefined ? '' : `（较上周同日 ${x >= 0 ? '+' : ''}${x}%）`);
  return list.slice(0, 15).map(r => `📈 ${r.store} ${r.date.slice(5)}：${r.total === null || r.total === undefined ? '⚠️ 营业额没读出来' : '营业额 ' + Math.round(r.total)}${w(r.wow)}${r.dpBad ? `｜点评差评 ${r.dpBad}` : ''}${r.mtBad ? `｜美团差评 ${r.mtBad}` : ''}${r.updated ? '（已覆盖旧记录）' : ''}`).join('\n') + (list.length > 15 ? `\n…共 ${list.length} 份` : '') + '\n已记入你的私密表格（只有你能看）' + (rj ? '\n' + rj : '');
}
function replyForImage(r) {
  if (!r) return '';
  if (r.error) return '⚠️ 截图没识别成功：' + r.error;
  const P = { xhs: ['小红书', '小眼睛'], douyin: ['抖音', '播放'], channels: ['视频号', '播放'] }[r.platform || 'xhs'];
  const md = t => { if (!t) return ''; const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const short = t => String(t || '').replace(/\s*#.*$/, '').slice(0, 14);
  const noLink = r.missed.filter(x => x.noLink), rest = r.missed.filter(x => !x.noLink);
  const unsure = rest.filter(x => !x.sphAmbig && x.best && x.best.s >= 0.8), none = rest.filter(x => !x.sphAmbig && !(x.best && x.best.s >= 0.8));
  const L = [`📊 ${P[0]}截图${r.acc ? ' · ' + r.acc : ''}：已更新 ${r.updated.length} 条`];
  r.updated.slice(0, 12).forEach(({ n, row }) => L.push(`✅ ${short(n.title)} → ${row.account || '?'} · ${md(row.date)}${row.kind ? ' · ' + row.kind : ''} · ${P[1]} ${n.views ?? '–'}`));
  if (noLink.length) { L.push(`🔗 表里有、但没填视频号链接 ${noLink.length} 条（补上链接再发截图就能更新）：`); noLink.slice(0, 8).forEach(x => L.push(`· ${short(x.n.title)} → ${x.noLink.table === '__xhs' ? '小红书表' : x.noLink.table} · ${x.noLink.account || '?'} · ${md(x.noLink.date)}`)); }
  if (unsure.length) { L.push(`❓ 拿不准、没写 ${unsure.length} 条（表里有好几条很像，请人工确认）：`); unsure.slice(0, 8).forEach(x => L.push(`· ${short(x.n.title)}（最像：${x.best.r.account || '?'} · ${md(x.best.r.date)}）`)); }
  const amb = r.missed.filter(x => x.sphAmbig); if (amb.length) { L.push(`❓ 视频号表里同一天有好几条还没标题，分不清是哪条：`); amb.forEach(x => L.push(`· ${short(x.n.title)} → 候选：${x.sphAmbig.slice(0, 4).join('  ')}（请回复是哪个链接）`)); }
  if (none.length) { L.push(`⚠️ 表里没找到 ${none.length} 条（视频号请先发链接登记）：`); none.slice(0, 8).forEach(x => L.push('· ' + short(x.n.title))); }
  return L.join('\n');
}


function replyForChannels(r) {
  if (!r) return ''; const L = [];
  if (r.created.length) L.push(`✅ 视频号已登记 ${r.created.length} 条（标题先空着，一周后发数据截图会自动补上标题和播放）`);
  if (r.dups.length) L.push(`↩️ ${r.dups.length} 条视频号之前登记过了，没重复登记` + (r.dupInfo ? '\n' + r.dupInfo.map(x => '· 在：' + x).join('\n') : ''));
  return L.join('\n');
}
function replyForDouyin(r) {
  const short = t => (t || '').length > 18 ? t.slice(0, 18) + '…' : (t || '（无标题）');
  const L = [];
  r.created.forEach(p => L.push(`✅ 抖音「${short(p.title)}」→ 已登记到「${p.table}」（${p.account}）`));
  r.dups.forEach(p => L.push(`↩️ 抖音「${short(p.title)}」在「${p.table}」里已经有了，没重复登记`));
  r.noAcct.forEach(p => L.push(`❓ 抖音「${short(p.title)}」：账号「${p.nick || '读不出'}」在矩阵号表和素人号表里都没有，没登记。是新账号的话先把账号加进表里再发一次`));
  r.noCol.forEach(p => L.push(`⚠️ 「${p.table}」里找不到放抖音链接的列，没登记`));
  return L.join('\n');
}

module.exports = { createCore, replyForChannels, replyForDouyin, replyForText, replyForImage, replyForDaily, val, num, titleOf };
