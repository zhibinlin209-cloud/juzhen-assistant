/* 「飞书」（通用版）：评论采集 —— 贴小红书 / 抖音链接，把全部评论（含楼中楼回复）拉出来，
 * 直接写进你自己的飞书多维表格（「评论采集」「评论总结」两张表，没有会自动建），再用你自己的大模型（设置里填的，推荐 DeepSeek）做总结。
 * 飞书应用凭证（App ID / App Secret）和表格链接只保存在本机浏览器，不经过任何第三方服务器。
 */
(function () {
  'use strict';
  const h = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = m => window.__rmToast && window.__rmToast(m);
  const forceRender = () => window.__rmRender && window.__rmRender();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.floor(Math.random() * (b - a));
  const get = k => new Promise(r => chrome.storage.local.get(k, o => r(o[k])));
  const set = (k, v) => new Promise(r => chrome.storage.local.set({ [k]: v }, r));
  const API = 'https://open.feishu.cn/open-apis';
  const KEY = 'rm_cmt_direct';
  const TABLE = '评论采集', STABLE = '评论总结';
  const COLS = [['评论内容', 1], ['平台', 3, ['小红书', '抖音']], ['帖子标题', 1], ['帖子链接', 15], ['帖子作者', 1], ['评论人', 1], ['类型', 3, ['评论', '回复']], ['回复给', 1], ['作者回复', 3, ['是', '否']],
    ['点赞', 2], ['评论时间', 5], ['IP属地', 1], ['评论ID', 1], ['帖子ID', 1], ['采集时间', 5], ['采集批次', 1]];
  const SCOLS = [['帖子标题', 1], ['平台', 3, ['小红书', '抖音']], ['帖子链接', 15], ['帖子作者', 1], ['评论数', 2], ['AI 总结', 1], ['模型', 1], ['总结时间', 5], ['帖子ID', 1]];

  const ST = { cfg: { appId: '', appSecret: '', baseUrl: '' }, links: '', showCfg: false, busy: false, stop: false, log: [], sums: [], app: '', tid: '', sid: '', token: null, win: null };
  async function load() { const o = (await get(KEY)) || {}; Object.assign(ST.cfg, o.cfg || {}); ST.links = o.links || ''; ST.sums = o.sums || []; if (!ST.cfg.appId) ST.showCfg = true; forceRender(); }
  const save = () => set(KEY, { cfg: ST.cfg, links: ST.links, sums: ST.sums.slice(0, 5) });
  const log = t => { ST.log.unshift(new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '  ' + t); ST.log = ST.log.slice(0, 40); forceRender(); };

  // ---------- 飞书接口 ----------
  async function token() {
    if (ST.token && ST.token.exp > Date.now() + 60000) return ST.token.v;
    if (!ST.cfg.appId || !ST.cfg.appSecret) throw new Error('先在下面填飞书应用的 App ID 和 App Secret');
    const r = await fetch(API + '/auth/v3/tenant_access_token/internal', { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ app_id: ST.cfg.appId.trim(), app_secret: ST.cfg.appSecret.trim() }) });
    const j = await r.json();
    if (j.code !== 0) throw new Error('飞书凭证不对：' + (j.msg || j.code) + '（检查 App ID / Secret；应用要先创建版本并发布）');
    ST.token = { v: j.tenant_access_token, exp: Date.now() + (j.expire || 7200) * 1000 }; return ST.token.v;
  }
  const HINT = { 91402: '找不到这个多维表格（检查表格链接）', 1254302: '应用没有这个多维表格的权限：在表格右上角「…→ 更多 → 添加文档应用」把你的飞书应用加进去，权限选「可编辑」', 99991672: '应用缺少权限：到飞书开放平台给应用开通「多维表格」相关权限，再发布一个新版本', 131006: '应用没有这个知识库的权限：把应用加为知识库成员' };
  async function call(method, path, body, q) {
    const t = await token(); const url = API + path + (q ? '?' + new URLSearchParams(q).toString() : '');
    for (let a = 0; a < 6; a++) {
      const r = await fetch(url, { method, headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json; charset=utf-8' }, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({ code: r.status, msg: 'HTTP ' + r.status }));
      if (j.code === 0) return j.data || {};
      if (j.code === 1254290 || j.code === 1254607 || r.status === 429) { await sleep(1500 * (a + 1)); continue; }
      throw new Error((HINT[j.code] || '飞书接口出错') + `（${j.code}：${j.msg || ''}）`);
    }
    throw new Error('飞书接口太忙，稍后再试');
  }
  async function resolveBase() {
    const u = String(ST.cfg.baseUrl || '').trim(); let m;
    if ((m = u.match(/\/base\/([A-Za-z0-9]+)/))) return m[1];
    if ((m = u.match(/\/wiki\/([A-Za-z0-9]+)/))) { const d = await call('GET', '/wiki/v2/spaces/get_node', null, { token: m[1], obj_type: 'wiki' }); const n = d.node || {}; if (n.obj_type !== 'bitable') throw new Error('这个知识库链接指向的不是多维表格'); return n.obj_token; }
    throw new Error('认不出表格链接：复制多维表格浏览器地址栏的完整链接（含 /base/ 或 /wiki/）');
  }
  const fieldOf = ([field_name, type, opts]) => Object.assign({ field_name, type }, opts ? { property: { options: opts.map((name, color) => ({ name, color })) } } : {});
  async function ensureTable(name, cols) {
    const list = []; let pt = ''; do { const d = await call('GET', `/bitable/v1/apps/${ST.app}/tables`, null, Object.assign({ page_size: 100 }, pt ? { page_token: pt } : {})); list.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    const t = list.find(x => x.name === name);
    if (!t) { const d = await call('POST', `/bitable/v1/apps/${ST.app}/tables`, { table: { name, default_view_name: '全部', fields: cols.map(fieldOf) } }); log(`已在你的表格里新建「${name}」表`); return d.table_id; }
    const fd = await call('GET', `/bitable/v1/apps/${ST.app}/tables/${t.table_id}/fields`, null, { page_size: 200 }); const hv = new Set((fd.items || []).map(f => f.field_name));
    for (const c of cols) if (!hv.has(c[0])) await call('POST', `/bitable/v1/apps/${ST.app}/tables/${t.table_id}/fields`, fieldOf(c));
    return t.table_id;
  }
  async function connect() { ST.app = await resolveBase(); ST.tid = await ensureTable(TABLE, COLS); ST.sid = await ensureTable(STABLE, SCOLS); }
  const tableLink = id => String(ST.cfg.baseUrl || '').replace(/[?#].*$/, '') + (id ? '?table=' + id : '');
  async function existing(postId) {
    const m = new Map(); let pt = '';
    do { const d = await call('POST', `/bitable/v1/apps/${ST.app}/tables/${ST.tid}/records/search`, { field_names: ['评论ID'], filter: { conjunction: 'and', conditions: [{ field_name: '帖子ID', operator: 'is', value: [postId] }] } }, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {}));
      for (const r of d.items || []) { const v = r.fields['评论ID']; const k = Array.isArray(v) ? v.map(x => x.text || '').join('') : String(v || ''); if (k) m.set(k, r.record_id); } pt = d.has_more ? d.page_token : ''; } while (pt);
    return m;
  }
  const clean = s => String(s || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 2000);

  // ---------- 写表 + 总结 ----------
  async function save2feishu(url, postId, post, list) {
    const platform = /douyin/.test(url) ? '抖音' : '小红书'; const have = await existing(postId);
    const batch = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' '); const now = Date.now();
    const byCid = new Map(list.map(c => [c.cid, c])); const add = [], upd = [];
    for (const c of list) {
      const cid = String(c.cid || '') || (c.name + '|' + String(c.text || '').slice(0, 30));
      if (have.has(cid)) { if (have.get(cid)) upd.push({ record_id: have.get(cid), fields: { '点赞': +c.likes || 0, '采集时间': now } }); continue; }
      const to = c.to || (c.parent && byCid.get(c.parent) ? byCid.get(c.parent).name : '');
      const f = { '评论内容': clean(c.text), '平台': platform, '帖子标题': clean(post.title || '').slice(0, 200), '帖子链接': { link: url, text: clean(post.title || url).slice(0, 80) || url }, '帖子作者': clean(post.author || ''), '评论人': clean(c.name),
        '类型': c.reply || c.parent ? '回复' : '评论', '回复给': clean(to), '作者回复': c.author ? '是' : '否', '点赞': +c.likes || 0, 'IP属地': clean(c.ip || ''), '评论ID': cid, '帖子ID': postId, '采集时间': now, '采集批次': batch };
      if (c.ts && c.ts > 1e12) f['评论时间'] = c.ts;
      add.push({ fields: f }); have.set(cid, '');
    }
    for (let i = 0; i < add.length; i += 400) { await call('POST', `/bitable/v1/apps/${ST.app}/tables/${ST.tid}/records/batch_create`, { records: add.slice(i, i + 400) }); if (add.length > 400) log(`写入飞书 ${Math.min(i + 400, add.length)}/${add.length}…`); }
    for (let i = 0; i < upd.length; i += 400) await call('POST', `/bitable/v1/apps/${ST.app}/tables/${ST.tid}/records/batch_update`, { records: upd.slice(i, i + 400) });
    return { platform, added: add.length, updated: upd.length };
  }
  async function summarize(platform, post, list) {
    const cfg = window.Env && window.Env.aiConfig ? window.Env.aiConfig() : null;
    if (!cfg || !cfg.key || !window.AI) throw new Error('没填大模型密钥：到「设置」里选 DeepSeek 并填 API Key');
    const top = list.slice().sort((a, b) => (+b.likes || 0) - (+a.likes || 0)); const lines = []; let len = 0;
    for (const c of top) { const l = `${c.reply || c.parent ? '↳' : '·'}${c.author ? '[作者]' : ''}${String(c.name || '').slice(0, 12)}${c.ip ? '(' + c.ip + ')' : ''}${+c.likes ? ' 赞' + c.likes : ''}：${String(c.text || '').replace(/\s+/g, ' ').slice(0, 160)}`; if (len + l.length > 30000) break; lines.push(l); len += l.length; }
    const prompt = `下面是${platform}一条帖子下面的评论（共 ${list.length} 条，按点赞从高到低给你 ${lines.length} 条；↳ 是楼中楼回复，[作者] 是发帖人自己回的）。
帖子：${String(post.title || '').slice(0, 80)}${post.author ? '（作者：' + post.author + '）' : ''}

请用中文、口语化地总结，只根据评论说话，不要编；引用原话时加引号、尽量短。按下面几块写，每块 2–5 条，没有就写「没有」：
1. 一句话结论：大家整体是什么态度（正面/负面/中性大概各占几成）。
2. 夸的点：夸什么，附 1 句原话。
3. 吐槽和差评：具体问题是什么，附原话；哪些需要马上处理。
4. 大家在问什么：高频问题，建议怎么统一回复或置顶。
5. 提到的品牌、店名、竞品或对比。
6. 可以拿来做下一条内容的选题或卖点（2–3 个）。
7. 建议优先回复的评论（2–5 条，写评论人和原话前几个字，说明为什么）。

评论：
${lines.join('\n')}`;
    const text = String(await window.AI.chat(cfg, prompt, undefined, { maxTokens: 3000 }) || '').trim();
    return { text, model: cfg.model || cfg.provider || '' };
  }

  // ---------- 拉评论 ----------
  function parseLinks(text) {
    const out = []; const re = /https?:\/\/[^\s，。、"'<>）)】]+/g; let m;
    while ((m = re.exec(String(text || '')))) { const u = m[0].replace(/[.,;:!?]+$/, ''); if (/xiaohongshu\.com|xhslink\.com|xhslink\.cn|douyin\.com/.test(u) && !out.includes(u)) out.push(u); }
    return out;
  }
  function waitLoad(tabId, ms) { return new Promise(res => { const t0 = Date.now(); (function poll() { chrome.tabs.get(tabId, tab => { if (chrome.runtime.lastError || !tab) return res(false); if (tab.status === 'complete' || Date.now() - t0 > (ms || 25000)) return res(true); setTimeout(poll, 500); }); })(); }); }
  chrome.runtime.onMessage.addListener(m => {
    if (!m || m.type !== 'rm:verify' || !ST.busy) return;
    if (m.on) { log('⚠️ ' + (m.why || '平台要验证') + '：窗口已弹到前面，请点完验证，点完自动接着拉'); toast('平台要验证：请在弹出的窗口里点完，插件会自己接着拉'); if (ST.win) chrome.windows.update(ST.win, { focused: true, state: 'normal' }).catch(() => { }); }
    else log(m.ok ? '✓ 验证通过，接着拉' : '验证等了 20 分钟没点完，先存读到的');
  });
  async function run() {
    if (ST.busy) return; const links = parseLinks(ST.links);
    if (!links.length) { toast('没认出小红书或抖音链接：把分享链接贴进框里（一行一个，带文字也行）'); return; }
    ST.busy = true; ST.stop = false; forceRender(); let cw = null;
    try {
      log('连接你的飞书表格…'); await connect();
      const go = async url => { if (cw) { try { await chrome.tabs.get(cw.tab); } catch (e) { cw = null; } }
        if (!cw) { const w = await chrome.windows.create({ url, focused: false, width: 1200, height: 900, type: 'normal' }); cw = { id: w.id, tab: w.tabs[0].id }; ST.win = w.id; } else await chrome.tabs.update(cw.tab, { url });
        await waitLoad(cw.tab, 30000); await sleep(rand(3500, 5000)); };
      const ask = async (m, timeout) => { const once = () => Promise.race([chrome.tabs.sendMessage(cw.tab, m), sleep(timeout).then(() => ({ ok: false, error: '页面没有响应（超时）' }))]);
        try { return await once(); } catch (e) { try { await chrome.scripting.executeScript({ target: { tabId: cw.tab }, files: ['content.js', 'collector.js'] }); } catch (er) { return { ok: false, error: '窗口被关闭了' }; } await sleep(1000); try { return await once(); } catch (e2) { return { ok: false, error: '页面脚本没装上：' + e2.message }; } } };
      for (let i = 0; i < links.length; i++) {
        if (ST.stop) { log('已停止'); break; }
        const u = links[i]; log(`(${i + 1}/${links.length}) 打开 ${u.slice(0, 60)}…`); await go(u); const t0 = Date.now();
        let r = await ask({ type: 'rm:readPost', maxComments: 30000, all: true }, 45 * 60e3);
        if (r && !r.ok && r.blocked) { log('⚠️ ' + r.blocked + '：请在弹出的窗口里点完验证，点完自动接着拉'); try { await chrome.windows.update(cw.id, { focused: true, state: 'normal' }); } catch (e) { } r = await ask({ type: 'rm:readPost', maxComments: 30000, all: true }, 45 * 60e3); }
        if (!r || !r.ok) { log('✗ ' + ((r && (r.error || r.blocked)) || '没读到') + '，跳过这条'); continue; }
        const p = r.post || {}; const cs = r.comments || []; const id = (r.diag && r.diag.id) || u.slice(-24);
        const tab = await chrome.tabs.get(cw.tab).catch(() => ({})); const url = String(tab.url || u).replace(/[?#].*$/, '') + (/xsec_token=/.test(tab.url || '') ? '?' + (tab.url.split('?')[1] || '') : '');
        log(`读到 ${cs.length} 条（帖子显示 ${p.comments || '?'} 条，用时 ${Math.round((Date.now() - t0) / 1000)} 秒），写进飞书…`);
        if (!cs.length) continue;
        const post = { title: p.title || '', author: p.author || p.nickname || '' };
        const w = await save2feishu(url, id, post, cs); log(`✓ 新增 ${w.added} 条${w.updated ? '，更新 ' + w.updated + ' 条' : ''}`);
        if (cs.length >= 3) {
          log('让大模型总结（要一两分钟）…');
          try { const s = await summarize(w.platform, post, cs);
            await call('POST', `/bitable/v1/apps/${ST.app}/tables/${ST.sid}/records/batch_create`, { records: [{ fields: { '帖子标题': clean(post.title || id).slice(0, 200), '平台': w.platform, '帖子链接': { link: url, text: clean(post.title || url).slice(0, 80) || url }, '帖子作者': clean(post.author), '评论数': cs.length, 'AI 总结': s.text.slice(0, 20000), '模型': s.model, '总结时间': Date.now(), '帖子ID': id } }] });
            ST.sums.unshift({ title: (post.title || id).slice(0, 30), text: s.text }); ST.sums = ST.sums.slice(0, 5); await save(); log('✓ 总结已写进「评论总结」表');
          } catch (e) { log('总结没做成：' + e.message); }
        }
        if (i < links.length - 1) await sleep(rand(8000, 15000));
      }
    } catch (e) { log('✗ ' + e.message); toast(e.message); }
    finally { try { if (cw) await chrome.windows.remove(cw.id); } catch (e) { } ST.win = null; ST.busy = false; forceRender(); }
  }
  async function test() {
    try { ST.token = null; await connect(); toast('连接成功：表格里有「评论采集」「评论总结」两张表了'); log('✓ 飞书连接成功'); ST.showCfg = false; } catch (e) { toast(e.message); log('✗ ' + e.message); }
    forceRender();
  }

  // ---------- 界面 ----------
  function view() {
    const c = ST.cfg; const n = parseLinks(ST.links).length; const ok = c.appId && c.appSecret && c.baseUrl;
    return `<div class="section-h"><h2>评论采集</h2><span class="hint">贴小红书笔记或抖音视频的链接，把下面全部评论连同楼中楼回复拉出来，写进你自己飞书多维表格的「评论采集」表（评论人、内容、点赞、时间、IP 属地、回复给谁），再用你在「设置」里填的大模型做总结，写进「评论总结」表。同一条评论再拉只更新点赞，不会重复。</span></div>
    <div class="panel stack">
      <div class="row"><b class="grow">飞书连接 ${ok ? '<span class="hint">· 已填</span>' : '<span class="hint">· 还没填</span>'}</b><button class="btn sm" data-action="fs-cfg">${ST.showCfg ? '收起' : '设置'}</button></div>
      ${ST.showCfg ? `<div class="stack">
        <div class="grid2"><label class="f"><span>App ID</span><input type="text" data-cd="appId" value="${h(c.appId)}" placeholder="cli_xxxxxxxx"></label>
        <label class="f"><span>App Secret</span><input type="password" data-cd="appSecret" value="${h(c.appSecret)}" placeholder="只存在这台电脑的浏览器里"></label></div>
        <label class="f"><span>多维表格链接</span><input type="text" data-cd="baseUrl" value="${h(c.baseUrl)}" placeholder="https://xxx.feishu.cn/base/…  或  …/wiki/…"></label>
        <div class="row"><span class="hint grow">在飞书开放平台建一个「企业自建应用」，开通多维表格权限并发布；再把这个应用加进表格（表格右上角「…→ 更多 → 添加文档应用」，选可编辑）。详细步骤见插件里的《使用说明》。</span><button class="btn primary sm" data-action="fs-test">保存并测试连接</button></div>
      </div>` : ''}
    </div>
    <div class="panel stack"><label class="f"><span>链接${n ? `（认出 ${n} 条）` : ''}</span><textarea data-cd="links" rows="3" placeholder="https://www.xiaohongshu.com/explore/…  或  https://v.douyin.com/…">${h(ST.links)}</textarea></label>
      <div class="row"><span class="hint grow">评论多的帖子要几分钟（模拟人慢慢往下翻、点开回复），拉的时候弹出的窗口别关、别最小化。碰到验证，窗口会弹到前面，你点完它自己接着拉。用的是这个浏览器里登录的小红书 / 抖音账号。${ST.cfg.baseUrl ? ` <a href="${h(tableLink(ST.tid))}" target="_blank" rel="noopener">打开飞书表格</a>` : ''}</span>
        ${ST.busy ? '<button class="btn sm" data-action="fs-stop">停止</button>' : ''}<button class="btn primary" data-action="fs-run" ${ST.busy ? 'disabled' : ''}>${ST.busy ? '拉取中…' : '拉全部评论'}</button></div>
      ${ST.log.length ? `<pre class="small-pre">${h(ST.log.slice(0, 12).join('\n'))}</pre>` : ''}
      ${ST.sums.map((z, i) => `<details ${i === 0 ? 'open' : ''}><summary><b>AI 总结 · ${h(z.title)}</b></summary><pre class="small-pre" style="white-space:pre-wrap;max-height:420px">${h(z.text)}</pre></details>`).join('')}
    </div>`;
  }
  function act(action) {
    if (action === 'fs-cfg') { ST.showCfg = !ST.showCfg; forceRender(); }
    if (action === 'fs-test') { save().then(test); }
    if (action === 'fs-run') run();
    if (action === 'fs-stop') { ST.stop = true; log('读完这一条就停'); }
  }
  function attach(root) {
    root.addEventListener('input', e => { const k = e.target && e.target.dataset && e.target.dataset.cd; if (!k) return; if (k === 'links') ST.links = e.target.value; else ST.cfg[k] = e.target.value.trim(); if (k !== 'links') ST.token = null; save(); });
  }
  load();
  window.Feishu = { view, act, attach };
})();
