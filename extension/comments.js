/* 「评论」：维护自己发的帖子的评论区
 * 定期读取自家帖子的新评论 → 分类（问价格/地址/排队/点什么、夸奖、差评…）→ 按门店资料生成回复草稿
 * → 你确认后"填入回复框"（插件找到那条评论、点回复、填好文字，由你自己点发送）→ 汇总高频问题做置顶和选题
 */
(function () {
  'use strict';
  const C = window.Core;
  const h = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => Math.round(a + Math.random() * (b - a));
  const toast = m => window.__rmToast && window.__rmToast(m);
  const render = () => { if (window.__rmIsEditing && window.__rmIsEditing()) return; window.__rmRender && window.__rmRender(); };
  const KEY = 'rm_cm_v1';
  const get = k => new Promise(r => chrome.storage.local.get(k, o => r(o[k])));
  const set = (k, v) => new Promise(r => chrome.storage.local.set({ [k]: v }, r));
  const pfOf = url => (/douyin\.com/.test(url) ? 'douyin' : /xiaohongshu\.com|xhslink/.test(url) ? 'xhs' : '');
  const pfName = p => (p === 'douyin' ? '抖音' : '小红书');

  const CATS = {
    complaint: { name: '差评/投诉', prio: 1, cls: 'high' },
    price: { name: '问价格', prio: 2, cls: 'ask' },
    where: { name: '问地址/交通', prio: 2, cls: 'ask' },
    time: { name: '问营业/排队/预约', prio: 2, cls: 'ask' },
    order: { name: '问点什么', prio: 2, cls: 'ask' },
    ask: { name: '其他提问', prio: 2, cls: 'ask' },
    suggest: { name: '建议', prio: 2, cls: 'mid' },
    praise: { name: '夸奖', prio: 3, cls: '' },
    chat: { name: '闲聊/艾特', prio: 4, cls: '' },
    spam: { name: '广告/无关', prio: 5, cls: '' }
  };
  const ASK_CATS = ['price', 'where', 'time', 'order', 'ask'];

  const ST = { data: null, view: 'todo', job: null, ai: null, showProfile: false, addText: '', busyFill: null, faq: null };
  const blank = () => ({ posts: [], comments: {}, profile: { voice: '店长', sign: '', address: '', hours: '', price: '', queue: '', booking: '', signature: '', parking: '', kids: '', extra: '' }, lastRun: null });
  async function load() { ST.data = Object.assign(blank(), (await get(KEY)) || {}); }
  const save = () => set(KEY, ST.data);

  // ---------- 帖子来源：数据页的发布记录（有链接的）+ 手动添加 ----------
  function ourNames() {
    const s = (window.Store && Store.state) || {};
    return new Set([].concat((s.accounts || []).map(a => a.name), (s.records || []).map(r => r.accountName)).filter(Boolean).map(x => String(x).trim()));
  }
  function allPosts() {
    const s = (window.Store && Store.state) || {};
    const map = new Map();
    (s.records || []).filter(r => /^https?:\/\//.test(r.url || '') && pfOf(r.url)).forEach(r => map.set(postKey(r.url), { key: postKey(r.url), url: r.url, platform: pfOf(r.url), title: r.title || '', account: r.accountName || '', from: 'record' }));
    ST.data.posts.forEach(p => { if (!map.has(p.key)) map.set(p.key, Object.assign({ from: 'manual' }, p)); });
    const meta = ST.data.postMeta || {};
    return [...map.values()].map(p => Object.assign(p, meta[p.key] || {}));
  }
  function postKey(url) {
    const m = String(url).match(/(?:explore|discovery\/item|note)\/([0-9a-f]{24})/i) || String(url).match(/(?:video|note)\/(\d{15,})/) || String(url).match(/modal_id=(\d{15,})/);
    return m ? m[1] : String(url).replace(/[?#].*$/, '');
  }

  // ---------- 规则分类（没设 AI 时用；也作为 AI 的兜底） ----------
  function ruleCat(t) {
    if (/(难吃|踩雷|避雷|失望|恶心|拉肚子|不新鲜|头发|异物|服务差|态度差|太慢|等了.{0,6}(小时|分钟).{0,6}(没|才)|再也不|不会再来|坑|骗|贵.{0,4}(离谱|死)|投诉|退钱|差评)/.test(t)) return 'complaint';
    if (/(多少钱|人均|价格|贵不贵|团购|套餐|优惠|划算吗)/.test(t)) return 'price';
    if (/(在哪|地址|位置|怎么去|地铁|停车|哪个商场|几楼|定位)/.test(t)) return 'where';
    if (/(几点|营业|开门|关门|排队|等位|要等|取号|预约|订位|包间|夜宵|开到)/.test(t)) return 'time';
    if (/(点什么|推荐什么|必点|招牌|好吃吗|哪个好吃|几个人|够吃|分量)/.test(t)) return 'order';
    if (/[?？]|吗$|么$|呢$/.test(t)) return 'ask';
    if (/(建议|希望|要是|如果能|可以出)/.test(t)) return 'suggest';
    if (/(好吃|绝了|推荐|喜欢|爱了|赞|不错|好评|想吃|馋|冲)/.test(t)) return 'praise';
    if (/(加微|私信我|代理|兼职|关注我|互关|引流)/.test(t)) return 'spam';
    return 'chat';
  }
  function ruleDraft(cat, c) {
    const p = ST.data.profile; const me = p.voice === '官方号' ? '' : '';
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    switch (cat) {
      case 'price': return p.price ? `人均大概${p.price}左右${p.signature ? `，第一次来推荐${p.signature}` : ''}～` : '';
      case 'where': return p.address ? `在${p.address}${p.parking ? `，${p.parking}` : ''}，欢迎来～` : '';
      case 'time': return [p.hours ? `营业时间${p.hours}` : '', p.queue || '', p.booking || ''].filter(Boolean).join('，') + (p.hours || p.queue || p.booking ? '～' : '');
      case 'order': return p.signature ? `第一次来必点${p.signature}${me}，人少可以先点招牌再加～` : '';
      case 'complaint': return '非常抱歉这次没让你吃好😔 方便的话说下是哪天哪道菜，我们马上核实改进，下次来一定给你一个好的体验。';
      case 'praise': return pick(['谢谢喜欢！下次来记得试试其他招牌～', '被你夸到了哈哈，欢迎常来～', '感谢支持❤️ 下次见～']);
      case 'suggest': return '收到建议啦，已经反馈给店里，谢谢你这么用心～';
      default: return '';
    }
  }

  // ---------- 读取新评论 ----------
  function waitLoad(tabId, ms) { return new Promise(resolve => { const t0 = Date.now(); (function poll() { chrome.tabs.get(tabId, tab => { if (chrome.runtime.lastError || !tab) return resolve(false); if (tab.status === 'complete' || Date.now() - t0 > (ms || 25000)) return resolve(true); setTimeout(poll, 500); }); })(); }); }
  async function send(tabId, m, timeout) {
    const go = () => Promise.race([chrome.tabs.sendMessage(tabId, m), sleep(timeout || 120000).then(() => ({ ok: false, error: '页面没有响应' }))]);
    try { return await go(); } catch (e) {
      try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js', 'collector.js'] }); } catch (er) { throw new Error('窗口被关闭或页面打不开'); }
      await sleep(800); return await go();
    }
  }
  function log(t) { if (!ST.job) return; ST.job.log.unshift(new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '  ' + t); ST.job.log = ST.job.log.slice(0, 40); render(); }
  async function check(onlyKey) {
    const posts = allPosts().filter(p => !onlyKey || p.key === onlyKey);
    if (!posts.length) { toast('还没有帖子：在「数据」的发布记录里填帖子链接，或在这里添加链接'); return; }
    ST.job = { running: true, stop: false, i: 0, n: posts.length, log: [], fresh: 0 }; render();
    const names = ourNames(); let win = null;
    try {
      for (const p of posts) {
        if (ST.job.stop) break;
        ST.job.i++; ST.job.cur = p.title || p.url; render();
        if (!win) { const w = await chrome.windows.create({ url: p.url, focused: false, width: 1200, height: 860, type: 'normal' }); win = { id: w.id, tab: w.tabs[0].id }; }
        else await chrome.tabs.update(win.tab, { url: p.url });
        await waitLoad(win.tab); await sleep(rand(2000, 3500));
        let r = await send(win.tab, { type: 'rm:readPost', maxComments: 150 }, 150000);
        if (r && !r.ok && r.blocked) { log(`暂停：${r.blocked}。请在弹出的窗口里处理后，再点一次"检查新评论"`); try { await chrome.windows.update(win.id, { focused: true }); } catch (e) { /* 已关 */ } ST.job.stop = true; win = null; break; }
        if (!r || !r.ok) { log(`跳过：${(r && r.error) || '读取失败'} · ${(p.title || p.url).slice(0, 20)}`); continue; }
        const n = merge(p, r, names);
        ST.job.fresh += n;
        ST.data.postMeta = ST.data.postMeta || {};
        ST.data.postMeta[p.key] = { title: p.title || (r.post && r.post.title) || '', lastCheck: new Date().toISOString(), total: (r.comments || []).length, platform: p.platform };
        log(`${(p.title || (r.post && r.post.title) || '').slice(0, 16) || p.key}：读到 ${(r.comments || []).length} 条，新增 ${n} 条`);
        await save();
        if (ST.job.i < posts.length) await sleep(rand(3000, 6000));
      }
    } catch (e) { log('出错：' + e.message); }
    try { if (win) await chrome.windows.remove(win.id); } catch (e) { /* 已关 */ }
    ST.data.lastRun = new Date().toISOString(); await save();
    const fresh = ST.job.fresh; ST.job.running = false;
    if (fresh) { toast(`新增 ${fresh} 条评论`); await classify(); }
    render();
  }
  function merge(p, r, names) {
    const list = ST.data.comments[p.key] || (ST.data.comments[p.key] = []);
    const byKey = new Map(list.map(c => [c.k, c]));
    const comments = r.comments || [];
    const mine = c => c.author || names.has(String(c.name || '').trim());
    let fresh = 0;
    comments.forEach(c => {
      const k = c.cid || (c.name + '|' + c.text.slice(0, 30));
      if (byKey.has(k)) return;
      const item = { k, cid: c.cid || '', parent: c.parent || '', name: c.name, text: c.text, likes: c.likes || 0, date: c.date || '', ts: c.ts || null, firstSeen: new Date().toISOString(), status: mine(c) ? 'mine' : 'new', cat: '', draft: '' };
      list.push(item); byKey.set(k, item); if (item.status === 'new') fresh++;
    });
    // 我们已经回复过的，标成已回复
    list.filter(c => c.status === 'mine' && c.parent).forEach(m => { const parent = list.find(x => x.cid === m.parent); if (parent && parent.status === 'new') parent.status = 'replied'; });
    return fresh;
  }

  // ---------- AI 分类 + 回复草稿 ----------
  function profileText() {
    const p = ST.data.profile;
    return [['地址', p.address], ['营业时间', p.hours], ['人均', p.price], ['排队/取号', p.queue], ['预约/包间', p.booking], ['招牌菜', p.signature], ['停车/交通', p.parking], ['亲子设施', p.kids], ['其他', p.extra]].filter(([, v]) => String(v || '').trim()).map(([k, v]) => `${k}：${v}`).join('\n') || '（没填）';
  }
  function draftPrompt(batch) {
    const p = ST.data.profile;
    return `你在帮一家餐厅回复它自己发的小红书/抖音帖子下面的顾客评论。回复用「${p.voice || '店长'}」的身份${p.sign ? `，可以自称"${p.sign}"` : ''}，公开承认是店家，不要假装成顾客。

门店资料（只能用这里有的事实，没写的不要编；问到没写的信息，就说"可以到店问服务员"或"我们确认后补充在置顶评论"）：
${profileText()}

要求：
- 先给每条评论分类 cat：complaint 差评/投诉，price 问价格，where 问地址交通，time 问营业/排队/预约，order 问点什么，ask 其他提问，suggest 建议，praise 夸奖，chat 闲聊/艾特朋友，spam 广告/无关
- need：这条需不需要店家回复（chat、spam 一般不用；艾特朋友的不用）
- reply：回复草稿。口语、像真人店长说话，${'≤'}40 字；每条措辞不一样，不要套话开头；最多一个表情
- 差评：先道歉、具体回应对方说的问题、给出改进或处理方式，语气诚恳，不争辩、不暗示对方说谎
- 不留电话、微信、二维码，不引导私信加好友（平台不允许导流）
- 不承诺门店资料里没有的优惠

只输出 JSON 数组：[{"i":1,"cat":"price","need":true,"reply":"……"}]

评论：
${batch.map((c, i) => `${i + 1}. ${c.parentText ? `（回复「${c.parentText.slice(0, 30)}」）` : ''}${c.text.slice(0, 200)}`).join('\n')}`;
  }
  async function classify(force) {
    const todo = [];
    Object.entries(ST.data.comments).forEach(([pk, list]) => list.forEach(c => { if (c.status === 'new' && (force || !c.cat)) todo.push(Object.assign(c, { _pk: pk, parentText: c.parent ? ((list.find(x => x.cid === c.parent) || {}).text || '') : '' })); }));
    if (!todo.length) return;
    const cfg = window.Env && Env.aiConfig ? Env.aiConfig() : null;
    if (!cfg || !cfg.key) { todo.forEach(c => { c.cat = ruleCat(c.text); c.need = !['chat', 'spam'].includes(c.cat); c.draft = c.draft || ruleDraft(c.cat, c); delete c._pk; delete c.parentText; }); await save(); render(); return; }
    const ctl = new AbortController(); ST.ai = { running: true, done: 0, total: Math.ceil(todo.length / 30), ctl }; render();
    try {
      for (let i = 0; i < todo.length; i += 30) {
        const batch = todo.slice(i, i + 30);
        let out = [];
        try { out = await window.AI.json(cfg, draftPrompt(batch), ctl.signal, { temperature: 0.7 }); } catch (e) { if (ctl.signal.aborted) throw e; if (/密钥|余额/.test(e.message)) throw e; }
        batch.forEach((c, j) => { const o = (Array.isArray(out) ? out : []).find(x => +x.i === j + 1) || {}; c.cat = CATS[o.cat] ? o.cat : ruleCat(c.text); c.need = o.need !== undefined ? !!o.need : !['chat', 'spam'].includes(c.cat); c.draft = String(o.reply || '') || ruleDraft(c.cat, c); });
        ST.ai.done++; render(); await save();
      }
      ST.ai = null;
    } catch (e) { ST.ai = ctl.signal.aborted ? null : { error: e.message || 'AI 调用失败' }; }
    todo.forEach(c => { delete c._pk; delete c.parentText; if (!c.cat) { c.cat = ruleCat(c.text); c.need = !['chat', 'spam'].includes(c.cat); c.draft = c.draft || ruleDraft(c.cat, c); } });
    await save(); render();
  }

  // ---------- 填入回复框 ----------
  async function fill(pk, k) {
    const c = (ST.data.comments[pk] || []).find(x => x.k === k); const post = allPosts().find(p => p.key === pk);
    if (!c || !post) return;
    const draft = (document.getElementById('cm-d-' + cssId(pk, k)) || {}).value || c.draft;
    if (!draft.trim()) { toast('先写回复内容'); return; }
    c.draft = draft; await save();
    ST.busyFill = k; render();
    try {
      const [cur] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      let tab;
      if (cur && cur.url && postKey(cur.url) === pk) tab = cur; else { tab = await chrome.tabs.create({ url: post.url, active: true }); await waitLoad(tab.id); await sleep(2500); }
      const r = await send(tab.id, { type: 'rm:replyTo', text: c.text, name: c.name, draft }, 60000);
      if (r && r.ok) { toast('已填好，请在页面上检查后点"发送"，发完回来点"已回复"'); c.filledAt = new Date().toISOString(); }
      else { await window.__rmCopy(draft, '回复内容'); toast((r && r.error) || '没能自动填入，回复内容已复制'); }
    } catch (e) { await window.__rmCopy(draft, '回复内容'); toast('没能自动填入，回复内容已复制：' + e.message); }
    ST.busyFill = null; await save(); render();
  }
  const cssId = (pk, k) => (pk + '_' + k).replace(/[^\w-]/g, '').slice(-60);

  // ---------- 高频问题（置顶回复 + 选题） ----------
  function faq() {
    const out = {};
    Object.values(ST.data.comments).forEach(list => list.forEach(c => { if (c.status !== 'mine' && ASK_CATS.includes(c.cat)) (out[c.cat] = out[c.cat] || []).push(c); }));
    return Object.entries(out).map(([cat, list]) => ({ cat, n: list.length, ex: list.sort((a, b) => b.likes - a.likes).slice(0, 4).map(c => c.text) })).sort((a, b) => b.n - a.n);
  }
  function pinnedText() {
    const p = ST.data.profile; const f = faq().map(x => x.cat);
    const lines = [];
    const add = (cat, txt) => { if (txt) lines.push(txt); };
    ['where', 'time', 'price', 'order'].sort((a, b) => (f.indexOf(a) < 0 ? 9 : f.indexOf(a)) - (f.indexOf(b) < 0 ? 9 : f.indexOf(b))).forEach(cat => {
      if (cat === 'where') add(cat, p.address && `📍地址：${p.address}${p.parking ? `（${p.parking}）` : ''}`);
      if (cat === 'time') add(cat, (p.hours || p.queue) && `⏰${[p.hours && `营业 ${p.hours}`, p.queue].filter(Boolean).join('，')}`);
      if (cat === 'price') add(cat, p.price && `💰人均 ${p.price}`);
      if (cat === 'order') add(cat, p.signature && `👍第一次来必点：${p.signature}`);
    });
    if (p.booking) lines.push(`📅${p.booking}`);
    return lines.length ? `大家问得最多的统一回复一下～\n${lines.join('\n')}` : '';
  }

  // ---------- 视图 ----------
  function counts() {
    let todo = 0, bad = 0, ask = 0, done = 0;
    Object.values(ST.data.comments).forEach(list => list.forEach(c => { if (c.status === 'new' && c.need !== false) { todo++; if (c.cat === 'complaint') bad++; if (ASK_CATS.includes(c.cat)) ask++; } if (c.status === 'replied') done++; }));
    return { todo, bad, ask, done };
  }
  function view() {
    if (!ST.data) return '<div class="empty">加载中…</div>';
    const posts = allPosts(); const N = counts(); const j = ST.job; const aj = ST.ai; const p = ST.data.profile;
    const profileEmpty = !['address', 'hours', 'price', 'signature'].some(k => String(p[k] || '').trim());
    const items = [];
    Object.entries(ST.data.comments).forEach(([pk, list]) => list.forEach(c => {
      const ok = { todo: c.status === 'new' && c.need !== false, bad: c.status === 'new' && c.cat === 'complaint', ask: c.status === 'new' && ASK_CATS.includes(c.cat), skip: c.status === 'new' && c.need === false, done: c.status === 'replied' || c.status === 'ignored' }[ST.view];
      if (ok) items.push({ pk, c, parent: c.parent ? list.find(x => x.cid === c.parent) : null });
    }));
    items.sort((a, b) => ((CATS[a.c.cat] || {}).prio || 9) - ((CATS[b.c.cat] || {}).prio || 9) || (b.c.ts || 0) - (a.c.ts || 0));
    const shown = items.slice(0, 80);
    const postOf = pk => posts.find(x => x.key === pk) || {};
    const F = faq();
    return `<div class="section-h" style="margin-top:0"><h2>评论区维护</h2><span class="hint">只维护你们自己发的帖子：读新评论 → 分类 → 生成回复草稿 → 你确认后填入、自己点发送</span></div>
    ${profileEmpty ? `<div class="banner info">先填一下「门店资料」（地址、营业时间、人均、招牌菜），回复草稿才能答得准。<button class="btn sm" data-action="cm-profile" style="margin-left:6px">填门店资料</button></div>` : ''}
    <div class="panel stack">
      <div class="row">
        ${j && j.running ? `<button class="btn sm danger" data-action="cm-stop">停止</button>` : `<button class="btn primary" data-action="cm-check" ${posts.length ? '' : 'disabled'}>检查新评论</button>`}
        <button class="btn ghost sm" data-action="cm-profile">${ST.showProfile ? '收起门店资料' : '门店资料'}</button>
        <span class="hint grow">${posts.length} 个帖子${ST.data.lastRun ? ` · 上次检查 ${new Date(ST.data.lastRun).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}</span>
      </div>
      ${j ? `<div class="hint">${j.running ? `正在读第 ${j.i}/${j.n} 个帖子：${h(String(j.cur || '').slice(0, 30))}` : `检查完成，新增 ${j.fresh} 条`}</div>${j.log.length ? `<pre class="small-pre">${h(j.log.join('\n'))}</pre>` : ''}` : ''}
      ${aj && aj.running ? `<div class="banner info">AI 正在分类、写回复草稿… ${aj.done}/${aj.total}</div>` : ''}
      ${aj && aj.error ? `<div class="banner">${h(aj.error)}</div>` : ''}
      ${ST.showProfile ? profileForm() : ''}
      <details ${posts.length ? '' : 'open'}><summary class="hint link">帖子列表（${posts.length}）· 添加帖子链接</summary>
        <div class="stack" style="gap:6px;margin-top:8px">
          <span class="hint">「数据」页发布记录里填了链接的帖子会自动出现在这里；也可以在下面粘贴链接（一行一个）。</span>
          <textarea id="cm-add" data-cm="addText" rows="2" placeholder="https://www.xiaohongshu.com/explore/...\nhttps://www.douyin.com/video/...">${h(ST.addText)}</textarea>
          <div><button class="btn sm" data-action="cm-add">添加</button></div>
          <div class="list">${posts.map(x => `<div class="item" style="cursor:default"><span class="pf ${x.platform}">${pfName(x.platform)}</span><a class="t" href="${h(x.url)}" target="_blank" rel="noopener">${h(x.title || x.url)}</a><span class="m">${x.account ? h(x.account) + ' · ' : ''}${x.total !== undefined ? `${x.total} 条` : '未检查'}</span>
            <button class="btn ghost sm" data-action="cm-check-one" data-pk="${h(x.key)}" title="只检查这一个">查</button>${x.from === 'manual' ? `<button class="btn ghost sm" data-action="cm-del-post" data-pk="${h(x.key)}" title="移除">✕</button>` : ''}</div>`).join('') || '<div class="empty"><b>还没有帖子</b>在上面粘贴你们帖子的链接</div>'}</div>
        </div></details>
    </div>
    <div class="chips" style="margin:12px 0 8px" role="group" aria-label="筛选">${[['todo', '待回复', N.todo], ['bad', '差评', N.bad], ['ask', '提问', N.ask], ['skip', '不用回', null], ['done', '已处理', N.done]].map(([k, l, n]) => `<button class="chip ${k === 'bad' && n ? 'warn-c' : ''}" data-action="cm-view" data-v="${k}" aria-pressed="${ST.view === k}">${l}${n !== null ? ` ${n}` : ''}</button>`).join('')}
      ${N.todo && aj && !aj.running ? '' : ''}<span class="grow"></span>${Object.keys(ST.data.comments).length ? `<button class="btn ghost sm" data-action="cm-redraft">重新生成草稿</button>` : ''}</div>
    ${shown.length ? `<div class="list">${shown.map(({ pk, c, parent }) => { const po = postOf(pk); const cat = CATS[c.cat] || { name: '未分类', cls: '' }; const id = cssId(pk, c.k);
      return `<div class="item need cm-item ${c.cat === 'complaint' ? 'cm-bad' : ''}" style="cursor:default">
        <div class="row" style="gap:6px;flex-wrap:nowrap"><span class="sim ${cat.cls}">${cat.name}</span><b style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(c.name || '匿名')}</b><span class="hint">${h(c.date || '')}${c.likes ? ` · 赞 ${c.likes}` : ''}</span><span class="grow"></span><span class="pf ${po.platform || ''}">${pfName(po.platform)}</span></div>
        ${parent ? `<div class="hint cm-parent">回复「${h(parent.name)}：${h(parent.text.slice(0, 40))}」</div>` : ''}
        <div style="font-size:14px">${h(c.text)}</div>
        <div class="hint">帖子：<a href="${h(po.url || '#')}" target="_blank" rel="noopener">${h((po.title || po.url || '').slice(0, 30))}</a></div>
        ${ST.view === 'done' ? `<div class="hint">${c.status === 'replied' ? '已回复' : '已忽略'}${c.draft ? `：${h(c.draft)}` : ''}</div><div class="row"><button class="btn ghost sm" data-action="cm-undo" data-pk="${h(pk)}" data-k="${h(c.k)}">撤回到待回复</button></div>` : `
        <textarea id="cm-d-${id}" data-cmd="${h(pk)}|${h(c.k)}" rows="2" placeholder="${c.need === false ? '这条一般不用回，需要的话自己写' : '回复内容'}">${h(c.draft || '')}</textarea>
        <div class="row">
          <button class="btn primary sm" data-action="cm-fill" data-pk="${h(pk)}" data-k="${h(c.k)}" ${ST.busyFill === c.k ? 'disabled' : ''}>${ST.busyFill === c.k ? '正在填入…' : '填入回复框'}</button>
          <button class="btn sm" data-action="cm-copy" data-pk="${h(pk)}" data-k="${h(c.k)}">复制</button>
          <button class="btn sm" data-action="cm-done" data-pk="${h(pk)}" data-k="${h(c.k)}">已回复</button>
          <button class="btn ghost sm" data-action="cm-ignore" data-pk="${h(pk)}" data-k="${h(c.k)}">忽略</button>
          ${c.filledAt ? '<span class="hint">已填入，发送后点"已回复"</span>' : ''}
        </div>`}
      </div>`; }).join('')}</div>${items.length > shown.length ? `<p class="hint">还有 ${items.length - shown.length} 条，先处理上面的</p>` : ''}`
      : `<div class="empty"><b>${ST.view === 'todo' ? (Object.keys(ST.data.comments).length ? '没有待回复的评论 🎉' : '还没检查过评论') : '这里没有评论'}</b>${Object.keys(ST.data.comments).length ? '' : '添加帖子后点"检查新评论"。'}</div>`}
    ${F.length ? `<div class="section-h"><h2>顾客最常问</h2><span class="hint">统计所有帖子下的提问，用来做置顶回复和下一篇选题</span></div>
      <div class="list">${F.map(x => `<div class="item need" style="cursor:default"><div class="row"><span class="sim ask">${CATS[x.cat].name}</span><span class="big-num">${x.n}</span><span class="hint grow">条</span><button class="btn sm" data-action="cm-topic" data-cat="${x.cat}">写成内容</button></div>
        <ul class="hint quotes">${x.ex.map(t => `<li>${h(t.slice(0, 60))}</li>`).join('')}</ul></div>`).join('')}</div>
      ${pinnedText() ? `<div class="panel stack" style="margin-top:8px"><b>置顶评论草稿</b><textarea id="cm-pin" rows="5">${h(pinnedText())}</textarea><div class="row"><button class="btn sm" data-action="cm-copy-pin">复制</button><span class="hint">发在每个帖子下并置顶，能少回很多重复问题</span></div></div>` : ''}` : ''}`;
  }
  function profileForm() {
    const p = ST.data.profile;
    const f = (k, l, ph) => `<label class="f"><span>${l}</span><input type="text" data-cmp="${k}" value="${h(p[k] || '')}" placeholder="${h(ph)}"></label>`;
    return `<div class="panel tight stack" style="gap:8px">
      <div class="grid2"><label class="f"><span>回复身份</span><select data-cmp="voice">${['店长', '官方号', '老板', '小编'].map(v => `<option ${p.voice === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>${f('sign', '自称（可选）', '如：阿明店长')}</div>
      ${f('address', '地址', '如：福田 COCO Park 负一楼')}
      <div class="grid2">${f('hours', '营业时间', '如：11:00–次日 2:00')}${f('price', '人均', '如：100 元')}</div>
      ${f('signature', '招牌菜', '如：爆膏奶油虾、椒盐濑尿虾')}
      <div class="grid2">${f('queue', '排队/取号', '如：周末建议 5 点前美团线上取号')}${f('booking', '预约/包间', '如：可订 10 人包间')}</div>
      <div class="grid2">${f('parking', '停车/交通', '如：商场停车 2 小时免费')}${f('kids', '亲子设施', '如：有宝宝椅、儿童餐')}</div>
      ${f('extra', '其他（活动、注意事项）', '如：生日当天送长寿面')}
      <span class="hint">回复只会用这里写的事实，没写的不会编。改完自动保存。</span>
    </div>`;
  }

  // ---------- 动作 ----------
  const find = (pk, k) => (ST.data.comments[pk] || []).find(x => x.k === k);
  function liveDraft(pk, k) { const el = document.getElementById('cm-d-' + cssId(pk, k)); return el ? el.value : null; }
  async function act(action, el) {
    const pk = el.dataset.pk, k = el.dataset.k;
    switch (action) {
      case 'cm-check': check(); break;
      case 'cm-check-one': check(pk); break;
      case 'cm-stop': if (ST.job) ST.job.stop = true; break;
      case 'cm-profile': ST.showProfile = !ST.showProfile; render(); break;
      case 'cm-view': ST.view = el.dataset.v; render(); break;
      case 'cm-add': {
        const urls = (ST.addText.match(/https?:\/\/[^\s，,]+/g) || []).filter(u => pfOf(u));
        if (!urls.length) { toast('没识别到小红书/抖音链接'); return; }
        urls.forEach(u => { const key = postKey(u); if (!ST.data.posts.some(p => p.key === key)) ST.data.posts.push({ key, url: u, platform: pfOf(u), title: '', account: '', addedAt: new Date().toISOString() }); });
        ST.addText = ''; await save(); toast(`已添加 ${urls.length} 个帖子`); render(); break;
      }
      case 'cm-del-post': ST.data.posts = ST.data.posts.filter(p => p.key !== pk); await save(); render(); break;
      case 'cm-fill': fill(pk, k); break;
      case 'cm-copy': { const c = find(pk, k); const d = liveDraft(pk, k) ?? (c && c.draft); if (c) { c.draft = d; await save(); } await window.__rmCopy(d || '', '回复内容'); break; }
      case 'cm-done': case 'cm-ignore': { const c = find(pk, k); if (!c) return; const d = liveDraft(pk, k); if (d !== null) c.draft = d; c.status = action === 'cm-done' ? 'replied' : 'ignored'; c.doneAt = new Date().toISOString(); await save(); render(); break; }
      case 'cm-undo': { const c = find(pk, k); if (c) { c.status = 'new'; await save(); render(); } break; }
      case 'cm-redraft': classify(true); break;
      case 'cm-copy-pin': await window.__rmCopy((document.getElementById('cm-pin') || {}).value || pinnedText(), '置顶评论'); break;
      case 'cm-topic': {
        const x = faq().find(f => f.cat === el.dataset.cat); if (!x) return;
        window.__rmCompose && window.__rmCompose({ kind: 'need', runId: 'comments', runTopic: '评论区高频问题', need: { name: `顾客常问：${CATS[x.cat].name}`, type: 'ask', count: x.n, quotes: x.ex, insight: '', action: '', angle: '' } });
        break;
      }
    }
  }
  function attach(root) {
    const onField = e => {
      const t = e.target;
      if (t.dataset.cm) { ST[t.dataset.cm] = t.value; return; }
      if (t.dataset.cmp) { ST.data.profile[t.dataset.cmp] = t.value; save(); return; }
      if (t.dataset.cmd && e.type === 'change') { const [pk, k] = t.dataset.cmd.split('|'); const c = find(pk, k); if (c) { c.draft = t.value; save(); } }
    };
    root.addEventListener('input', onField); root.addEventListener('change', onField);
    load().then(render);
  }
  window.Comments = { view, act, attach, pending: () => (ST.data ? counts().todo : 0), _classify: classify, _st: ST };
})();
