/* 发布登记：
 *  ① 群消息登记：把群里的「小红书/点评/携程/微信」分享粘进来 → 自动拆成一条条 → 查重 → 新增到「小红书矩阵号-数据」
 *  ② 账号巡检：打开各矩阵号主页，找出发了但飞书里没登记的笔记 → 一键补登记
 * 只新增行，不改已有的行；写入前都要人确认
 */
(function () {
  'use strict';
  const h = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = m => window.__rmToast && window.__rmToast(m);
  const forceRender = () => window.__rmRender && window.__rmRender();
  const F = () => window.Feishu._api; const P = () => window.PostParse;
  const sleep = ms => new Promise(r => setTimeout(r, ms)); const rand = (a, b) => a + Math.floor(Math.random() * (b - a));
  const DAY = 864e5; const KEY = 'rm_postsync';
  const dstr = t => { const d = new Date(t || Date.now()); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dms = s => { const m = String(s || '').match(/(\d{4})-(\d{1,2})-(\d{1,2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null; };

  const S = { open: 'paste', text: '', posts: [], busy: false, log: [], table: null, rows: null, fields: null, accts: null, mem: { excl: [], noteAcct: {} }, patrol: null };
  const log = t => { S.log.unshift(new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '  ' + t); S.log = S.log.slice(0, 30); forceRender(); };
  const get = k => new Promise(r => chrome.storage.local.get(k, o => r(o[k])));
  const save = () => new Promise(r => chrome.storage.local.set({ [KEY]: S.mem }, r));

  // ---------- 读飞书表 ----------
  async function loadTable(force) {
    if (S.rows && !force) return;
    const api = F(); const want = (api.ST.cfg.xhsTable || '小红书矩阵号-数据').trim();
    const t = (await api.listTables()).find(x => x.name === want);
    if (!t) throw new Error(`飞书里没找到「${want}」这张表`);
    S.table = t; S.fields = await api.listFields(t.id);
    log(`读取「${t.name}」`);
    const recs = await api.listRecords(t.id);
    const { val, pick, dateOf } = api;
    S.rows = recs.map(r => { const f = r.fields || {}; const xhs = String(val(f['小红书链接']) || ''); const home = String(val(f['主页链接']) || '');
      return { id: r.record_id, title: api.titleOf(pick(f, ['标题(供AI读取)', '标题'])), xhs, key: P().xhsKey(xhs), code: String(val(f['合作码']) || '').trim(), account: String(val(f['账号昵称']) || '').trim(), person: String(val(f['人员']) || '').trim(), home, uid: (home.match(/user\/profile\/([0-9a-f]{24})/) || [])[1] || '', date: dateOf(f['发布日期']) }; });
    // 账号表：账号 → 主页 / 人员 / 最近发布
    const A = {};
    S.rows.slice().sort((a, b) => (a.date || 0) - (b.date || 0)).forEach(r => { if (!r.account) return; const a = A[r.account] = A[r.account] || { name: r.account, titles: [], n: 0 }; a.n++; if (r.home) a.home = r.home; if (r.uid) a.uid = r.uid; if (r.person) a.person = r.person; if (r.date) a.last = r.date; if (r.title) a.titles.push(P().norm(r.title)); });
    S.accts = Object.values(A).sort((a, b) => (b.last || 0) - (a.last || 0));
    log(`共 ${S.rows.length} 条笔记、${S.accts.length} 个账号`);
  }
  const opts = name => ((S.fields || []).find(f => f.name === name) || {}).options || [];
  const acctByUid = uid => S.accts.find(a => a.uid && a.uid === uid);

  // 找重复：链接 / 合作码 / 标题
  function dupOf(p) {
    const k = P().xhsKey(p.xhs); const n = P().norm(p.title);
    return S.rows.find(r => (k && r.key === k) || (p.code && r.code === p.code) || (n.length >= 6 && r.title && P().dice(n, P().norm(r.title)) >= 0.92));
  }

  // 打开小红书短链：拿笔记 ID、作者、发布时间（拿不到就让人选）
  async function resolveXhs(url) {
    try {
      const ctl = new AbortController(); setTimeout(() => ctl.abort(), 12000);
      const r = await fetch(url, { credentials: 'include', signal: ctl.signal }); const final = r.url || '';
      const id = (final.match(/(?:explore|discovery\/item|item)\/([0-9a-f]{24})/) || [])[1] || '';
      const html = await r.text(); const i = html.indexOf('noteDetailMap'); const seg = i >= 0 ? html.slice(i, i + 200000) : '';
      const uid = (seg.match(/"userId":"([0-9a-f]{24})"/) || [])[1] || '';
      const nick = (seg.match(/"nickname":"([^"]{1,40})"/) || [])[1] || '';
      const tm = +((seg.match(/"time":(1\d{12})/) || [])[1] || 0);
      return { id, uid, nick, time: tm || null, link: id ? `https://www.xiaohongshu.com/explore/${id}` : '' };
    } catch (e) { return {}; }
  }

  function fillDefaults(p) {
    const a = (p.uid && acctByUid(p.uid)) || (p.nick && S.accts.find(x => x.name === p.nick)) || (p.noteId && S.mem.noteAcct[p.noteId] && S.accts.find(x => x.name === S.mem.noteAcct[p.noteId]));
    if (a && !p.account) p.account = a.name;
    if (!p.account && p.nick) p.account = p.nick;
    const acc = S.accts.find(x => x.name === p.account);
    if (!p.person) p.person = acc && acc.person ? acc.person : '';
    if (!p.home && acc && acc.home) p.home = acc.home;
    p.cityOpt = p.cityOpt ?? P().optionFor(p.city, opts('笔记城市'));
    p.storeOpt = p.storeOpt ?? P().optionFor(p.store, opts('笔记门店'));
    p.typeOpt = p.typeOpt ?? P().optionFor(p.type, opts('笔记类型'));
    p.date = p.date || dstr(p.time || Date.now());
  }

  // ---------- ① 群消息登记 ----------
  async function parsePaste() {
    const api = F(); if (!api.ST.appToken) return toast('先在上面连接飞书');
    const ta = document.querySelector('textarea[data-ps="text"]'); if (ta) S.text = ta.value;
    const list = P().parse(S.text); if (!list.length) return toast('没认出分享内容：要包含小红书 / 点评 / 携程链接');
    S.busy = true; S.posts = list.map((p, i) => Object.assign({ i, on: false }, p)); forceRender();
    try {
      await loadTable();
      for (const p of S.posts) {
        const d = dupOf(p); if (d) { p.dup = d; continue; }
        if (p.xhs) { log(`打开小红书链接：${p.title.slice(0, 16)}`); Object.assign(p, await resolveXhs(p.xhs)); if (p.id) p.noteId = p.id; await sleep(rand(600, 1400)); }
        const d2 = p.noteId && S.rows.find(r => r.key === 'n:' + p.noteId); if (d2) { p.dup = d2; continue; }
        fillDefaults(p); p.on = !!p.account;
      }
      log(`拆出 ${S.posts.length} 条：新的 ${S.posts.filter(p => !p.dup).length} 条，已登记 ${S.posts.filter(p => p.dup).length} 条`);
    } catch (e) { log('失败：' + e.message); toast(e.message); }
    S.busy = false; forceRender();
  }

  function rowFields(p) {
    const f = { '发布日期': dms(p.date) || Date.now(), '投流状态': opts('投流状态').includes('未投流') ? '未投流' : undefined };
    if (p.account) f['账号昵称'] = p.account; if (p.home) f['主页链接'] = p.home; if (p.person && opts('人员').includes(p.person)) f['人员'] = p.person;
    if (p.code) f['合作码'] = p.code; if (p.cityOpt) f['笔记城市'] = p.cityOpt; if (p.storeOpt) f['笔记门店'] = p.storeOpt; if (p.typeOpt) f['笔记类型'] = p.typeOpt;
    const xl = p.xhs || p.link; if (xl) f['小红书链接'] = { link: xl, text: xl };
    if (p.dp) f['点评链接'] = { link: p.dp, text: p.dp }; if (p.ctrip) f['携程链接'] = p.ctrip; if (p.wx) f['微信贴图'] = { link: p.wx, text: p.wx };
    Object.keys(f).forEach(k => f[k] === undefined && delete f[k]); return f;
  }
  async function writeRows(list, src) {
    const api = F(); const go = list.filter(p => p.on && !p.dup);
    if (!go.length) return toast('没有勾选要登记的');
    if (go.some(p => !p.account)) return toast('有勾选的笔记还没选账号');
    S.busy = true; forceRender();
    try {
      await api.batchCreate(S.table.id, go.map(rowFields));
      go.forEach(p => { p.dup = { account: p.account, title: p.title, fresh: true }; p.on = false; if (p.noteId) S.mem.noteAcct[p.noteId] = p.account; });
      await save(); S.rows = null; // 下次重新读
      log(`已在「${S.table.name}」新增 ${go.length} 行（${src}）`); toast(`已登记 ${go.length} 条`);
    } catch (e) { log('写入失败：' + e.message); toast(e.message); }
    S.busy = false; forceRender();
  }

  // ---------- ② 账号巡检 ----------
  let win = null;
  function waitLoad(tabId, ms) { return new Promise(res => { const t0 = Date.now(); (function poll() { chrome.tabs.get(tabId, tab => { if (chrome.runtime.lastError || !tab) return res(false); if (tab.status === 'complete' || Date.now() - t0 > (ms || 25000)) return res(true); setTimeout(poll, 500); }); })(); }); }
  async function nav(url) {
    if (!win) { const w = await chrome.windows.create({ url, focused: false, width: 1200, height: 860, type: 'normal' }); win = { id: w.id, tab: w.tabs[0].id }; await waitLoad(win.tab); await sleep(rand(2500, 4000)); return; }
    await chrome.tabs.update(win.tab, { url }); await waitLoad(win.tab); await sleep(rand(2000, 3500));
  }
  async function send(m, timeout) {
    const go = () => Promise.race([chrome.tabs.sendMessage(win.tab, m), sleep(timeout || 90000).then(() => ({ ok: false, error: '页面没有响应' }))]);
    try { return await go(); } catch (e) { try { await chrome.scripting.executeScript({ target: { tabId: win.tab }, files: ['content.js', 'collector.js'] }); } catch (er) { throw new Error('巡检窗口被关闭'); } await sleep(800); return await go(); }
  }
  async function patrol() {
    const api = F(); if (!api.ST.appToken) return toast('先在上面连接飞书');
    S.busy = true; S.patrol = { i: 0, n: 0, res: [], stop: false, cur: '' }; forceRender();
    try {
      await loadTable(true);
      const list = S.accts.filter(a => a.home && /xiaohongshu\.com\/user\/profile/.test(a.home) && !S.mem.excl.includes(a.name));
      S.patrol.n = list.length; log(`开始巡检 ${list.length} 个小红书号（后台窗口，别关）`);
      for (const a of list) {
        if (S.patrol.stop) break;
        S.patrol.i++; S.patrol.cur = a.name; forceRender();
        await nav(a.home);
        let r = await send({ type: 'rm:collectProfile', limit: 20 }, 120000);
        if (r && !r.ok && r.blocked) { log(`「${a.name}」被拦（${r.blocked}），在巡检窗口处理后会继续`); try { await chrome.windows.update(win.id, { focused: true }); } catch (e) { } await sleep(20000); r = await send({ type: 'rm:collectProfile', limit: 20 }, 120000); }
        if (!r || !r.ok) { S.patrol.res.push({ a, err: (r && (r.error || r.blocked)) || '读取失败', fresh: [] }); continue; }
        const notes = (r.list || []).filter(x => !x.sticky);
        const fresh = []; let anchored = false;
        for (const x of notes) {
          const n = P().norm(x.title); const known = (S.mem.noteAcct[x.id]) || a.titles.some(t => n.length >= 4 && P().dice(n, t) >= 0.85) || S.rows.some(rw => rw.key === 'n:' + x.id);
          if (known) { anchored = true; break; }
          fresh.push({ title: x.title || '(无标题)', link: x.url || `https://www.xiaohongshu.com/explore/${x.id}`, noteId: x.id, likes: x.likes, account: a.name, person: a.person || '', home: a.home, on: true });
        }
        if (!anchored && notes.length) { S.patrol.res.push({ a, warn: '主页上的笔记和飞书里的都对不上（可能是新号或标题改过），没自动列漏登记', fresh: [], total: notes.length }); }
        else S.patrol.res.push({ a, fresh, total: notes.length });
        if (fresh.length) log(`「${a.name}」有 ${fresh.length} 条没登记`);
        forceRender(); await sleep(rand(3000, 6000));
      }
      // 补齐日期 / 城市门店
      const all = S.patrol.res.flatMap(x => x.fresh);
      for (const p of all) { const info = await resolveXhs(p.link); if (info.time) p.time = info.time; p.city = P().cityOf(p.title); p.store = P().storeOf(p.title); p.type = P().typeOf(p.title); fillDefaults(p); await sleep(rand(500, 1200)); }
      log(`巡检完：${S.patrol.res.length} 个号，漏登记 ${all.length} 条`);
    } catch (e) { log('巡检失败：' + e.message); toast(e.message); }
    try { if (win) await chrome.windows.remove(win.id); } catch (e) { } win = null;
    S.busy = false; S.patrol.cur = ''; forceRender();
  }

  // ---------- 视图 ----------
  function editor(p, k) {
    const sel = (name, field, cur) => { const o = opts(name); return `<select data-ps="${field}" data-k="${k}">${['', ...o].map(x => `<option value="${h(x)}" ${x === cur ? 'selected' : ''}>${h(x || '—')}</option>`).join('')}</select>`; };
    const accs = S.accts || [];
    return `<div class="grid3" style="gap:6px;margin-top:6px">
      <label class="f"><span>账号</span><select data-ps="account" data-k="${k}"><option value="">— 选账号 —</option>${accs.map(a => `<option ${a.name === p.account ? 'selected' : ''}>${h(a.name)}</option>`).join('')}${p.account && !accs.some(a => a.name === p.account) ? `<option selected>${h(p.account)}</option>` : ''}</select></label>
      <label class="f"><span>人员</span>${sel('人员', 'person', p.person)}</label>
      <label class="f"><span>发布日期</span><input type="date" data-ps="date" data-k="${k}" value="${h(p.date || '')}"></label>
      <label class="f"><span>城市</span>${sel('笔记城市', 'cityOpt', p.cityOpt)}</label>
      <label class="f"><span>门店</span>${sel('笔记门店', 'storeOpt', p.storeOpt)}</label>
      <label class="f"><span>笔记类型</span>${sel('笔记类型', 'typeOpt', p.typeOpt)}</label></div>`;
  }
  const badges = p => [['小红书', p.xhs || p.link], ['点评', p.dp], ['携程', p.ctrip], ['微信', p.wx], ['合作码', p.code]].map(([n, v]) => `<span class="chip sm ${v ? 'g' : ''}" style="${v ? '' : 'opacity:.45'}">${n}${v ? '✓' : '—'}</span>`).join(' ');
  function card(p, k) {
    return `<div class="panel" style="padding:10px;margin-top:8px;${p.dup ? 'opacity:.6' : ''}">
      <div class="row" style="align-items:flex-start"><input type="checkbox" data-ps="on" data-k="${k}" ${p.on ? 'checked' : ''} ${p.dup ? 'disabled' : ''} style="margin-top:4px">
        <div class="grow"><b>${h(p.title || '(没认出标题)')}</b><div style="margin-top:4px">${badges(p)}</div>
        ${p.dup ? `<div class="hint">${p.dup.fresh ? '✅ 刚登记' : `已在飞书：${h(p.dup.account || '')} · ${h((p.dup.title || '').slice(0, 20))}`}，跳过</div>` : (p.uid && !acctByUid(p.uid) ? `<div class="hint">作者「${h(p.nick || p.uid)}」不在表里的账号中，请确认</div>` : '')}</div></div>
      ${p.dup ? '' : editor(p, k)}</div>`;
  }
  function view() {
    const tabs = [['paste', '群消息登记'], ['patrol', '账号巡检']];
    const newN = S.posts.filter(p => p.on && !p.dup).length;
    const pr = S.patrol; const prFresh = pr ? pr.res.flatMap(x => x.fresh) : []; const prOn = prFresh.filter(p => p.on && !p.dup).length;
    return `<div class="section-h"><h2>发布登记</h2><span class="hint">发完笔记不用再手抄进飞书：粘贴群消息自动拆，或巡检账号主页自动找漏登记（只新增行，不改旧行）</span></div>
    <div class="panel stack" id="fs-ps">
      <nav class="tabs sub" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-action="fs-ps-tab" data-v="${k}" aria-selected="${S.open === k}">${l}</button>`).join('')}</nav>
      ${S.open === 'paste' ? `
        <textarea data-ps="text" rows="5" placeholder="把群里的分享消息整段复制粘贴进来（可以一次粘一天的，多条一起）&#10;例：被低估的惠城美食！9家… https://xhslink.cn/o/… 0000020340975896988&#10;点评：… http://dpurl.cn/…&#10;携程：… https://m.ctrip.com/…">${h(S.text)}</textarea>
        <div class="row"><span class="hint grow">会自动拆出 标题 / 小红书 / 点评 / 携程 / 微信链接 / 合作码，打开小红书链接认出是哪个号；已登记过的自动跳过。</span>
          <button class="btn primary sm" data-action="fs-ps-parse" ${S.busy ? 'disabled' : ''}>拆分并查重</button></div>
        ${S.posts.map((p, i) => card(p, 'p' + i)).join('')}
        ${S.posts.length ? `<div class="row"><span class="hint grow">勾选的 ${newN} 条会新增到「${h(S.table ? S.table.name : '小红书矩阵号-数据')}」；标题和赞藏评由表里的链接解析自动补。</span><button class="btn primary" data-action="fs-ps-write" ${S.busy || !newN ? 'disabled' : ''}>登记到飞书（${newN} 条）</button></div>` : ''}
      ` : `
        <div class="row"><span class="hint grow">逐个打开表里各小红书号的主页（后台窗口，约 5 秒一个），找出已经发了、但飞书里还没登记的笔记。${S.accts ? `共 ${S.accts.filter(a => a.home).length} 个号有主页链接${S.mem.excl.length ? `，跳过 ${S.mem.excl.length} 个` : ''}。` : ''}</span>
          ${S.busy && pr ? `<button class="btn sm" data-action="fs-ps-stop">停止</button>` : ''}
          <button class="btn primary sm" data-action="fs-ps-patrol" ${S.busy ? 'disabled' : ''}>开始巡检</button></div>
        ${S.accts ? `<details><summary class="hint">不想巡检的号（勾上 = 跳过）</summary><div class="row" style="flex-wrap:wrap;gap:6px;margin-top:6px">${S.accts.filter(a => a.home).map(a => `<label class="chip sm"><input type="checkbox" data-ps="excl" data-v="${h(a.name)}" ${S.mem.excl.includes(a.name) ? 'checked' : ''}> ${h(a.name)}</label>`).join('')}</div></details>` : ''}
        ${pr ? `<div class="hint"><b>${pr.cur ? `巡检中 ${pr.i}/${pr.n}：${h(pr.cur)}` : `已巡检 ${pr.res.length} 个号`}</b></div>
          <div class="tbl-wrap"><table><thead><tr><th>账号</th><th>负责人</th><th>飞书最近登记</th><th>主页最新几条</th><th>漏登记</th></tr></thead><tbody>
          ${pr.res.map(x => `<tr><td>${h(x.a.name)}</td><td>${h(x.a.person || '')}</td><td>${x.a.last ? `${new Date(x.a.last).toLocaleDateString('zh-CN')}<span class="hint">（${Math.floor((Date.now() - x.a.last) / DAY)}天前）</span>` : ''}</td><td class="num">${x.total ?? '–'}</td><td>${x.err ? `<span class="chip sm r">${h(x.err).slice(0, 20)}</span>` : x.warn ? `<span class="chip sm" title="${h(x.warn)}">对不上</span>` : x.fresh.length ? `<span class="chip sm r">${x.fresh.length} 条</span>` : '<span class="chip sm g">齐了</span>'}</td></tr>`).join('')}
          </tbody></table></div>
          ${prFresh.map((p, i) => card(p, 'q' + i)).join('')}
          ${prFresh.length ? `<div class="row"><span class="hint grow">勾选的 ${prOn} 条会补登记；点评 / 携程链接主页上没有，之后从群消息补。</span><button class="btn primary" data-action="fs-ps-write2" ${S.busy || !prOn ? 'disabled' : ''}>补登记（${prOn} 条）</button></div>` : ''}` : ''}
      `}
      ${S.log.length ? `<pre class="small-pre">${h(S.log.slice(0, 10).join('\n'))}</pre>` : ''}
    </div>`;
  }
  const itemOf = k => { if (!k) return null; const i = +k.slice(1); return k[0] === 'p' ? S.posts[i] : (S.patrol ? S.patrol.res.flatMap(x => x.fresh)[i] : null); };

  async function act(action, el) {
    switch (action) {
      case 'fs-ps-tab': S.open = el.dataset.v; if (S.open === 'patrol' && !S.accts && F().ST.appToken) loadTable().then(forceRender).catch(e => toast(e.message)); forceRender(); break;
      case 'fs-ps-parse': parsePaste(); break;
      case 'fs-ps-write': writeRows(S.posts, '群消息'); break;
      case 'fs-ps-write2': writeRows(S.patrol.res.flatMap(x => x.fresh), '账号巡检'); break;
      case 'fs-ps-patrol': patrol(); break;
      case 'fs-ps-stop': if (S.patrol) S.patrol.stop = true; break;
    }
  }
  function attach(root) {
    get(KEY).then(m => { if (m) S.mem = Object.assign({ excl: [], noteAcct: {} }, m); });
    const on = e => {
      const t = e.target; const k = t.dataset && t.dataset.ps; if (!k) return;
      if (k === 'text') { S.text = t.value; return; }
      if (k === 'excl') { const v = t.dataset.v; S.mem.excl = t.checked ? [...new Set([...S.mem.excl, v])] : S.mem.excl.filter(x => x !== v); save(); return; }
      if (e.type !== 'change') return;
      const p = itemOf(t.dataset.k); if (!p) return;
      if (k === 'on') p.on = t.checked; else p[k] = t.value;
      if (k === 'account') { const a = (S.accts || []).find(x => x.name === t.value); if (a) { if (a.person) p.person = a.person; if (a.home) p.home = a.home; } p.on = !!t.value; }
      forceRender();
    };
    root.addEventListener('input', on); root.addEventListener('change', on);
  }
  window.PostSync = { view, act, attach, _s: S };
})();
