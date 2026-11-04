/* 自家内容入库：把我们自己发过的小红书笔记（飞书「小红书矩阵号-数据」里的链接）在后台窗口一条条打开，
 * 读标题 / 正文 / 话题 / 全部图片 / 赞藏评 / 热门评论 → 交给禧聚机器人存进「自家内容库」，再由通义千问分析封面和图片。
 * 只读页面本来就显示的内容，速度模仿正常浏览（每条 10 秒左右），遇到验证会暂停等你处理。
 */
(function () {
  'use strict';
  const h = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = m => window.__rmToast && window.__rmToast(m);
  const forceRender = () => window.__rmRender && window.__rmRender();
  const sleep = ms => new Promise(r => setTimeout(r, ms)); const rand = (a, b) => a + Math.floor(Math.random() * (b - a));
  const CFG = () => window.__rmIngest || {};
  const S = { busy: false, stop: false, i: 0, n: 0, cur: '', ok: 0, fail: 0, info: null, log: [], batch: 100, paused: '' };
  const log = t => { S.log.unshift(new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '  ' + t); S.log = S.log.slice(0, 40); forceRender(); };

  async function srv(path, body) {
    const c = CFG(); if (!c.url || !c.key) throw new Error('插件里没有入库口令，请用最新的插件文件');
    const r = await fetch(c.url.replace(/\/$/, '') + path, { method: body ? 'POST' : 'GET', headers: Object.assign({ 'x-rm-key': c.key }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({ ok: false, error: 'HTTP ' + r.status })); if (!j.ok && j.error) throw new Error(j.error); return j;
  }
  async function refresh() { try { S.info = await srv('/lib/todo?limit=1'); } catch (e) { S.info = { error: e.message }; } forceRender(); }

  // ---------- 后台窗口 ----------
  let win = null;
  function waitLoad(tabId, ms) { return new Promise(res => { const t0 = Date.now(); (function poll() { chrome.tabs.get(tabId, tab => { if (chrome.runtime.lastError || !tab) return res(false); if (tab.status === 'complete' || Date.now() - t0 > (ms || 25000)) return res(true); setTimeout(poll, 500); }); })(); }); }
  async function nav(url) {
    if (win) { try { await chrome.tabs.get(win.tab); } catch (e) { win = null; } }
    if (!win) { const w = await chrome.windows.create({ url, focused: false, width: 1200, height: 860, type: 'normal' }); win = { id: w.id, tab: w.tabs[0].id }; await waitLoad(win.tab); await sleep(rand(3000, 4500)); return; }
    await chrome.tabs.update(win.tab, { url }); await waitLoad(win.tab); await sleep(rand(2500, 4000));
  }
  async function msg(m, timeout) {
    const go = () => Promise.race([chrome.tabs.sendMessage(win.tab, m), sleep(timeout || 60000).then(() => ({ ok: false, error: '页面没有响应' }))]);
    try { return await go(); } catch (e) { try { await chrome.scripting.executeScript({ target: { tabId: win.tab }, files: ['content.js', 'collector.js'] }); } catch (er) { return { ok: false, error: '窗口被关闭' }; } await sleep(800); try { return await go(); } catch (e2) { return { ok: false, error: e2.message }; } }
  }
  // 直接读页面自带的笔记数据（打开笔记页时页面里就有，不额外请求）
  async function ssr() {
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: win.tab }, world: 'MAIN', func: () => {
        const un = v => (v && typeof v === 'object' && ('_rawValue' in v || '_value' in v)) ? (v._rawValue ?? v._value) : v;
        try {
          const st = window.__INITIAL_STATE__; const map = un(st && st.note && st.note.noteDetailMap) || {};
          const id = (location.pathname.match(/(?:explore|item)\/([0-9a-f]{24})/) || [])[1] || Object.keys(map)[0];
          const e = map[id] || map[Object.keys(map)[0]]; const n = e && un(e.note); if (!n || !(n.noteId || n.title || n.desc)) return { none: true, href: location.href, text: (document.body.innerText || '').slice(0, 300) };
          const ii = n.interactInfo || {}; const pic = x => x.urlDefault || x.url || ((x.infoList || []).find(i => /DFT|WB_DFT/.test(i.imageScene)) || (x.infoList || [])[0] || {}).url || '';
          return JSON.parse(JSON.stringify({ id: n.noteId || id, type: n.type === 'video' ? 'video' : 'note', title: n.title || '', desc: (n.desc || '').replace(/#([^#\[]+)\[话题\]#/g, '#$1'), tags: (n.tagList || []).map(t => t.name).filter(Boolean),
            images: (n.imageList || []).map(pic).filter(Boolean), likes: ii.likedCount, collects: ii.collectedCount, comments: ii.commentCount, shares: ii.shareCount, author: (n.user || {}).nickname || '', time: n.time || null, ip: n.ipLocation || '' }));
        } catch (err) { return { none: true, err: String(err) }; }
      } });
      return r && r.result;
    } catch (e) { return { none: true, err: e.message }; }
  }

  async function waitUnblock(why) {
    S.paused = why; log(`⏸ 小红书要求验证（${why}），已把窗口切到前面：处理完会自动继续`); forceRender();
    try { await chrome.windows.update(win.id, { focused: true, state: 'normal' }); } catch (e) { }
    const t0 = Date.now();
    while (!S.stop && Date.now() - t0 < 15 * 60e3) { await sleep(5000); const st = await msg({ type: 'rm:status' }, 8000); if (st && st.ok && !st.blocked) { S.paused = ''; log('▶ 已解除，继续'); try { await chrome.windows.update(win.id, { state: 'minimized' }); } catch (e) { } return true; } }
    S.paused = ''; return false;
  }

  async function readOne(it) {
    await nav(it.link);
    let st = await msg({ type: 'rm:status' }, 8000);
    if (st && st.blocked) { if (!(await waitUnblock(st.blocked))) return { stop: true }; await nav(it.link); }
    let note = await ssr(); let comments = [];
    const rp = await msg({ type: 'rm:readPost', maxComments: 15 }, 60000);
    if (rp && rp.ok) { comments = (rp.comments || []).map(c => ({ text: c.text, likes: c.likes, author: c.author })); if (note && note.none && rp.post && (rp.post.title || rp.post.desc)) { const p = rp.post; note = { id: (rp.diag || {}).id || '', type: p.type, title: p.title, desc: p.desc, tags: p.tags || [], images: p.images || [], likes: p.likes, collects: p.collects, comments: p.comments, shares: p.shares, author: p.author, time: p.time }; } }
    else if (rp && rp.blocked) { if (!(await waitUnblock(rp.blocked))) return { stop: true }; return { again: true }; }
    if (!note || note.none) {
      const t = (note && note.text) || ''; const gone = /不存在|已删除|无法浏览|违规|仅自己可见|私密/.test(t) || (rp && /删除|无法查看/.test(rp.error || ''));
      return { err: gone ? '笔记已删除或不可见' : '没读到内容', retry: !gone };
    }
    return { note, comments };
  }

  async function run() {
    if (S.busy) return; S.busy = true; S.stop = false; S.ok = 0; S.fail = 0; S.i = 0; forceRender();
    try {
      const t = await srv('/lib/todo?limit=' + S.batch); S.info = t; S.n = t.items.length;
      if (!S.n) { log('都读完了，没有新的笔记'); return; }
      log(`开始读取 ${S.n} 条（全部 ${t.total}，已读 ${t.done}）。后台窗口别关，可以最小化`);
      for (const it of t.items) {
        if (S.stop) break; S.i++; S.cur = it.acc; forceRender();
        let r = await readOne(it); if (r.again) r = await readOne(it);
        if (r.stop) { log('验证超时，先停下。处理好后再点开始'); break; }
        try {
          if (r.err) { await srv('/lib/note', { rec: it.rec, link: it.link, error: r.err, retry: r.retry }); S.fail++; log(`✗ ${it.acc}：${r.err}`); }
          else { const j = await srv('/lib/note', { rec: it.rec, link: it.link, note: r.note, comments: r.comments }); S.ok++; log(`✓ ${it.acc}《${(r.note.title || '').slice(0, 18)}》${r.note.images.length} 张图，入库 ${j.images ?? 0} 张`); }
        } catch (e) { S.fail++; log(`✗ 交给机器人失败：${e.message}`); if (/口令/.test(e.message)) break; }
        forceRender();
        await sleep(rand(6000, 12000)); // 模仿正常浏览
        if (S.i % 25 === 0 && S.i < S.n) { log('歇一会儿（1 分钟）'); await sleep(rand(50000, 75000)); }
      }
      log(`本轮完成：成功 ${S.ok}，失败 ${S.fail}`); toast(`入库完成：成功 ${S.ok} 条`);
    } catch (e) { log('出错：' + e.message); toast(e.message); }
    finally { try { if (win) await chrome.windows.remove(win.id); } catch (e) { } win = null; S.busy = false; S.cur = ''; S.paused = ''; refresh(); }
  }

  // ---------- 官方号数据（抖音蓝 V / 视频号）：读创作者后台作品数据 ----------
  const O = { busy: false, log: [] };
  const olog = t => { O.log.unshift(new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '  ' + t); O.log = O.log.slice(0, 20); forceRender(); };
  async function bgTab(url, host) {
    const tabs = await chrome.tabs.query({ url: `https://${host}/*` }); if (tabs.length) return { tab: tabs[0].id, own: false };
    const w = await chrome.windows.create({ url, focused: false, width: 1200, height: 860, type: 'normal' }); const t = w.tabs[0].id; await waitLoad(t, 30000); await sleep(4000); return { tab: t, own: true, win: w.id };
  }
  async function syncDouyin() {
    if (O.busy) return; O.busy = true; forceRender(); let bt = null;
    try {
      bt = await bgTab('https://creator.douyin.com/creator-micro/content/manage', 'creator.douyin.com');
      olog('读取抖音创作者中心当前登录的账号…');
      const [r] = await chrome.scripting.executeScript({ target: { tabId: bt.tab }, world: 'MAIN', func: async () => {
        const u = await fetch('/web/api/media/user/info/', { credentials: 'include' }).then(r => r.json()).catch(() => ({}));
        const nick = u && u.user && u.user.nickname; if (!nick) return { error: '没登录抖音创作者中心：请在这个浏览器打开 creator.douyin.com 扫码登录蓝 V' };
        const items = []; let cur = '', n = 0;
        do {
          const j = await fetch('/web/api/creator/item/list?count=20&fields=metrics%2Cvideo_info' + (cur ? '&max_cursor=' + cur : ''), { credentials: 'include' }).then(r => r.json());
          (j.items || []).forEach(x => items.push({ id: String(x.id), create_time: x.create_time, description: x.description, video_info: x.video_info ? { duration: x.video_info.duration } : null, metrics: x.metrics, cover: { url_list: (((x.cover || {}).url_list) || []).slice(-1) } }));
          cur = j.has_more ? j.max_cursor : ''; n++; await new Promise(r => setTimeout(r, 700 + Math.random() * 600));
        } while (cur && n < 200);
        return { nick, items };
      } });
      const d = r && r.result; if (!d || d.error) throw new Error((d && d.error) || '读取失败');
      olog(`「${d.nick}」读到 ${d.items.length} 条作品，交给机器人…`);
      const j = await srv('/lib/official', { platform: 'douyin', account: d.nick, items: d.items });
      olog(`✓ 「${d.nick}」已同步：新增 ${j.added}，更新 ${j.updated}`); toast(`${d.nick} 同步完成`);
    } catch (e) { olog('✗ ' + e.message); toast(e.message); }
    finally { try { if (bt && bt.own) await chrome.windows.remove(bt.win); } catch (e) { } O.busy = false; forceRender(); }
  }

  async function syncChannels() {
    if (O.busy) return; O.busy = true; forceRender(); let bt = null;
    try {
      bt = await bgTab('https://channels.weixin.qq.com/platform/post/list', 'channels.weixin.qq.com');
      olog('读取视频号助手当前登录的账号…');
      const [r] = await chrome.scripting.executeScript({ target: { tabId: bt.tab }, world: 'MAIN', func: async () => {
        const post = (p, b) => fetch(p, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ timestamp: String(Date.now()), _log_finder_uin: '', rawKeyBuff: null, pluginSessionId: null, scene: 7, reqScene: 7 }, b)) }).then(r => r.json());
        const a = await post('/cgi-bin/mmfinderassistant-bin/auth/auth_data', { _log_finder_id: '' }).catch(() => ({}));
        const fu = (a.data && a.data.finderUser) || {}; if (!fu.finderUsername) return { error: '没登录视频号助手：请在这个浏览器打开 channels.weixin.qq.com 用微信扫码登录' };
        const items = [];
        for (const type of [11, 13]) {
          for (let page = 1; page <= 60; page++) {
            const l = await post('/micro/content/cgi-bin/mmfinderassistant-bin/post/post_list', { pageSize: 20, currentPage: page, userpageType: type, stickyOrder: true, _log_finder_id: fu.finderUsername }).catch(() => ({}));
            const list = (l.data && l.data.list) || []; if (l.errCode || !list.length) break;
            list.forEach(x => { const d = x.desc || {}; const m = (d.media || [])[0] || {}; items.push({ id: x.exportId || x.objectId, time: x.createTime ? x.createTime * 1000 : null, title: d.description || ((d.shortTitle || [])[0] || {}).shortTitle || '', form: (d.mediaType || m.mediaType) === 4 ? '视频' : '图文', duration: m.videoPlayLen || null,
              views: x.readCount, likes: x.likeCount, comments: x.commentCount, shares: x.forwardCount, favs: x.favCount, follows: x.followCount, completion: x.fullPlayRate != null ? x.fullPlayRate * 100 : null, flip: x.fastFlipRate != null ? x.fastFlipRate * 100 : null, avgSec: x.avgPlayTimeSec != null ? Math.round(x.avgPlayTimeSec * 10) / 10 : null, cover: m.coverUrl || m.thumbUrl || '' }); });
            if (list.length < 20 || (l.data.totalCount && items.length >= l.data.totalCount && type === 11)) break;
            await new Promise(r => setTimeout(r, 800 + Math.random() * 600));
          }
        }
        const seen = new Set(); return { nick: fu.nickname, items: items.filter(x => x.id && !seen.has(x.id) && seen.add(x.id)) };
      } });
      const d = r && r.result; if (!d || d.error) throw new Error((d && d.error) || '读取失败');
      olog(`视频号「${d.nick}」读到 ${d.items.length} 条，交给机器人…`);
      const j = await srv('/lib/official', { platform: 'channels', account: d.nick, items: d.items });
      olog(`✓ 视频号「${d.nick}」已同步：新增 ${j.added}，更新 ${j.updated}`); toast(`视频号 ${d.nick} 同步完成`);
    } catch (e) { olog('✗ ' + e.message); toast(e.message); }
    finally { try { if (bt && bt.own) await chrome.windows.remove(bt.win); } catch (e) { } O.busy = false; forceRender(); }
  }

  function view() {
    const I = S.info; const has = CFG().key;
    return `<div class="section-h"><h2>自家内容入库</h2><span class="hint">把我们自己发过的小红书笔记一条条读进「自家内容库」（标题、正文、话题、全部图片、赞藏评、热门评论），机器人再用通义千问分析封面和图片，升级爆款公式</span></div>
    <div class="panel stack" id="fs-own">
      ${!has ? '<div class="hint" style="color:#c52b1b">这个插件版本没有入库口令，请换用机器人发来的最新插件文件。</div>' : ''}
      <div class="hint">${I ? (I.error ? `连接机器人失败：${h(I.error)}` : `飞书里共 <b>${I.total}</b> 条小红书笔记，已入库 <b>${I.done}</b> 条，还剩 <b>${I.left}</b> 条。`) : '正在读取进度…'}
        用的是这个浏览器里当前登录的小红书账号，建议用普通个人号。</div>
      <div class="row"><label class="f" style="flex:0 0 auto"><span>这次读</span><select data-own="batch">${[30, 100, 200, 300].map(n => `<option ${n === S.batch ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <span class="hint grow">约 10–15 秒一条，每 25 条歇 1 分钟；读过的不会重复。</span>
        ${S.busy ? '<button class="btn sm" data-action="fs-own-stop">停止</button>' : ''}
        <button class="btn primary" data-action="fs-own-run" ${S.busy || !has ? 'disabled' : ''}>${S.busy ? '读取中…' : '开始入库'}</button></div>
      ${S.busy ? `<div class="hint"><b>${S.paused ? '⏸ 等你在小红书窗口里完成验证…' : `进行中 ${S.i}/${S.n}：${h(S.cur)}`}</b> · 成功 ${S.ok} · 失败 ${S.fail}</div>` : ''}
      ${S.log.length ? `<pre class="small-pre">${h(S.log.slice(0, 12).join('\n'))}</pre>` : ''}
    </div>
    <div class="section-h"><h2>官方号数据</h2><span class="hint">读抖音蓝 V（YES 也是大排档、粤迹）的创作者后台和视频号助手：每条作品的播放、完播率、2 秒跳出、涨粉、主页访问，写进私密表格「官方号作品数据」</span></div>
    <div class="panel stack">
      <div class="row"><span class="hint grow">读的是这个浏览器里 creator.douyin.com <b>当前登录</b>的账号。两个蓝 V：同步完一个，在创作者中心右上角头像「切换账号」换另一个，再点一次。约 1 分钟。</span>
        <button class="btn primary" data-action="fs-own-dy" ${O.busy || !has ? 'disabled' : ''}>${O.busy ? '同步中…' : '同步抖音蓝 V'}</button>
        <button class="btn primary" data-action="fs-own-sph" ${O.busy || !has ? 'disabled' : ''}>同步视频号</button></div>
      ${O.log.length ? `<pre class="small-pre">${h(O.log.slice(0, 8).join('\n'))}</pre>` : ''}
    </div>`;
  }
  async function act(action) { if (action === 'fs-own-dy') syncDouyin(); if (action === 'fs-own-sph') syncChannels(); if (action === 'fs-own-run') run(); if (action === 'fs-own-stop') { S.stop = true; log('收到，读完这一条就停'); } }
  function attach(root) {
    if (!S.info && CFG().key) refresh();
    root.addEventListener('change', e => { const t = e.target; if (t.dataset && t.dataset.own === 'batch') S.batch = +t.value || 100; });
  }
  window.OwnLib = { view, act, attach, _s: S };
})();
