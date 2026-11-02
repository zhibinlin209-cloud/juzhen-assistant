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
  async function load(force) {
    if (st.rows && !force && Date.now() - st.at < 5 * 60e3) return;
    const app = await appToken();
    const tables = []; let pt = ''; do { const d = await api.call('GET', `/bitable/v1/apps/${app}/tables`, null, Object.assign({ page_size: 100 }, pt ? { page_token: pt } : {})); tables.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    const t = tables.find(x => x.name === (cfg.xhsTable || '小红书矩阵号-数据')); if (!t) throw new Error('没找到表：' + cfg.xhsTable);
    st.table = { id: t.table_id, name: t.name };
    const fd = await api.call('GET', `/bitable/v1/apps/${app}/tables/${t.table_id}/fields`, null, { page_size: 200 });
    st.fields = (fd.items || []).map(f => ({ name: f.field_name, type: f.type, options: ((f.property || {}).options || []).map(o => o.name) }));
    const recs = []; pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); recs.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    st.rows = recs.map(r => { const f = r.fields || {}; const xhs = String(val(f['小红书链接']) || ''); const home = String(val(f['主页链接']) || '');
      return { id: r.record_id, title: titleOf(f['标题(供AI读取)'] || f['标题']), xhs, key: P.xhsKey(xhs), code: String(val(f['合作码']) || '').trim(), account: String(val(f['账号昵称']) || '').trim(), person: String(val(f['人员']) || '').trim(), home, uid: (home.match(/user\/profile\/([0-9a-f]{24})/) || [])[1] || '', date: typeof f['发布日期'] === 'number' ? f['发布日期'] : null, views: num(f['小眼睛']), auto: num(f['小眼睛(自动)']) }; });
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
  const dateHit = (md, ts) => { const m = String(md || '').match(/(\d{1,2})\D+(\d{1,2})/); if (!m || !ts) return null; const d = new Date(ts); return Math.abs(new Date(d.getFullYear(), +m[1] - 1, +m[2]).getTime() - dayStart(ts)) <= 1.5 * DAY; };
  function match(notes, accHint) {
    const cand = (n, acc) => st.rows.filter(r => r.title && (!r.date || Date.now() - r.date < 240 * DAY)).map(r => { let s = sim(P.norm(n.title), P.norm(r.title)); if (s < 0.45) return null; const d = dateHit(n.date, r.date); if (d === true) s += 0.15; else if (d === false) s -= 0.25; if (acc && r.account) s += P.norm(r.account) === P.norm(acc) ? 0.1 : -0.15; return { r, s }; }).filter(Boolean).sort((x, y) => y.s - x.s);
    let acc = accHint || '';
    if (!acc) { const v = {}; notes.forEach(n => { const c = cand(n, ''); if (c[0] && c[0].s >= 0.95 && (!c[1] || c[1].s < c[0].s - 0.1) && c[0].r.account) v[c[0].r.account] = (v[c[0].r.account] || 0) + 1; }); const b = Object.entries(v).sort((x, y) => y[1] - x[1])[0]; if (b && (b[1] >= 2 || notes.length === 1)) acc = b[0]; }
    const used = new Set();
    return { acc, list: notes.map(n => { const c = cand(n, acc); const ok = c[0] && c[0].s >= 0.95 && (!c[1] || c[1].s < c[0].s - 0.1) && !used.has(c[0].r.id); if (ok) used.add(c[0].r.id); return { n, row: ok ? c[0].r : null, best: c[0] }; }) };
  }
  const PROMPT = `这是小红书 App「数据中心 → 笔记分析」或创作者中心笔记列表的截图。逐条提取每条笔记：title 标题原文（只写看得到的，被截断就写到截断处，去掉省略号）、date 封面日期 MM-DD、views 眼睛图标后的数字原样、likes 爱心后的数字、comments 气泡后的数字、collects/shares 截图里有才填否则 null；只要数字完整可见的；account 截图里若显示账号昵称就填。只输出 JSON：{"account":"","notes":[{"title":"","date":"","views":"","likes":"","comments":"","collects":null,"shares":null}]}`;
  async function handleImage(dataUrl, accHint) {
    if (!api.vision) return null;
    const txt = await api.vision(PROMPT, dataUrl);
    let j; try { j = JSON.parse((txt.match(/\{[\s\S]*\}/) || [txt])[0]); } catch (e) { return { error: '识别结果不是 JSON' }; }
    const notes = (j.notes || []).filter(n => n && n.title).map(n => ({ title: String(n.title), date: String(n.date || ''), views: num(n.views), likes: num(n.likes), comments: num(n.comments), collects: num(n.collects), shares: num(n.shares) }));
    if (!notes.length) return null; // 不是数据中心截图
    await load();
    const M = match(notes, accHint || j.account || '');
    const app = await appToken();
    const have = new Set((st.fields || []).map(f => f.name));
    for (const [name, type] of [['小眼睛(自动)', 2], ['点赞(自动)', 2], ['评论(自动)', 2], ['收藏(自动)', 2], ['分享(自动)', 2], ['数据更新于', 5]]) if (!have.has(name)) await api.call('POST', `/bitable/v1/apps/${app}/tables/${st.table.id}/fields`, { field_name: name, type });
    const now = Date.now();
    const recs = M.list.filter(x => x.row).map(({ n, row }) => { const f = { '数据更新于': now }; if (n.views !== null) f['小眼睛(自动)'] = n.views; if (n.likes !== null) f['点赞(自动)'] = n.likes; if (n.comments !== null) f['评论(自动)'] = n.comments; if (n.collects !== null) f['收藏(自动)'] = n.collects; if (n.shares !== null) f['分享(自动)'] = n.shares; return { record_id: row.id, fields: f }; });
    if (recs.length) { await api.call('POST', `/bitable/v1/apps/${app}/tables/${st.table.id}/records/batch_update`, { records: recs }); st.fields = null; st.rows = null; }
    return { acc: M.acc, updated: M.list.filter(x => x.row), missed: M.list.filter(x => !x.row) };
  }

  return { handleText, handleImage, load, _st: st, _match: match };
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
function replyForImage(r) {
  if (!r) return '';
  if (r.error) return '⚠️ 截图没识别成功：' + r.error;
  const L = [`📊 ${r.acc || '截图'}：更新了 ${r.updated.length} 条笔记的小眼睛`];
  if (r.missed.length) L.push(`⚠️ ${r.missed.length} 条在飞书里没找到：` + r.missed.slice(0, 5).map(x => '\n· ' + x.n.title.slice(0, 20)).join('') + '\n（没登记的话，先把分享发群里登记）');
  return L.join('\n');
}

module.exports = { createCore, replyForText, replyForImage, val, num, titleOf };
