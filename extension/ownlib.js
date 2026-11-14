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
  // 几个读取任务共用一个后台窗口：开始前等「自动补账号」读完，避免两个任务抢同一个窗口（会跳到自家笔记）
  const busyA = () => typeof A !== 'undefined' && A.busy;
  async function waitA(log) { if (!busyA()) return true; log && log('等后台「自动补账号」读完这一轮再开始…'); for (let i = 0; i < 60 && busyA(); i++) await sleep(3000); return !busyA(); }
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
            images: (n.imageList || []).map(pic).filter(Boolean), likes: ii.likedCount, collects: ii.collectedCount, comments: ii.commentCount, shares: ii.shareCount, author: (n.user || {}).nickname || '', uid: (n.user || {}).userId || (n.user || {}).user_id || '', time: n.time || null, ip: n.ipLocation || '' }));
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
      const t = (note && note.text) || ''; const gone = /不存在|已删除|违规|仅自己可见|私密/.test(t) && !/暂时无法浏览/.test(t) || (rp && /删除|无法查看/.test(rp.error || ''));
      return { err: gone ? '笔记已删除或不可见' : '没读到内容', retry: !gone };
    }
    return { note, comments };
  }

  async function run() {
    if (S.busy) return; if ((typeof R !== 'undefined' && R.busy) || (typeof T !== 'undefined' && T.busy)) return toast('先等其他读取任务跑完'); if (!(await waitA())) return toast('后台自动补账号还在跑，稍后再点'); if (S.busy) return; S.busy = true; S.stop = false; S.ok = 0; S.fail = 0; S.i = 0; forceRender();
    try {
      const t = await srv('/lib/todo?limit=' + S.batch); S.info = t; S.n = t.items.length;
      if (!S.n) { log('都读完了，没有新的笔记'); return; }
      log(`开始读取 ${S.n} 条（全部 ${t.total}，已读 ${t.done}）。后台窗口别关，可以最小化`);
      // 只按登记的链接读，不走主页、不用标题去搜；读不了就记「读不了」，面板里列出来
      for (const it of t.items) {
        if (S.stop) break; S.i++; S.cur = it.acc; forceRender();
        let r = await readOne(it); if (r.again) r = await readOne(it);
        if (r.err && r.retry) r = { err: '链接读不了（分享链接过期或笔记不可见）', retry: false };
        if (r.stop) { log('验证超时，先停下。处理好后再点开始'); break; }
        try {
          if (r.err) { await srv('/lib/note', { rec: it.rec, link: it.link, error: r.err, retry: false }); S.fail++; log(`✗ 读不了 ${it.acc}《${String(it.title || '').slice(0, 16)}》：${r.err}`); }
          else { const j = await srv('/lib/note', { rec: it.rec, link: it.link, note: r.note, comments: r.comments }); S.ok++; log(`✓ ${it.acc}《${(r.note.title || '').slice(0, 18)}》${r.note.images.length} 张图，入库 ${j.images ?? 0} 张`); }
        } catch (e) { S.fail++; log(`✗ 交给机器人失败：${e.message}`); if (/口令/.test(e.message)) break; }
        forceRender();
        await sleep(rand(15000, 30000)); // 放慢：模仿正常浏览
        if (S.i % 20 === 0 && S.i < S.n && !S.stop) { // 防风控：每读 20 条关窗歇 1 小时左右（±10 分钟）再接着读
          try { if (win) await chrome.windows.remove(win.id); } catch (e) { } win = null;
          const ms = (60 + (Math.random() * 20 - 10)) * 60e3; S.restUntil = Date.now() + ms;
          log(`已读 ${S.i} 条，歇 ${Math.round(ms / 60e3)} 分钟防风控，${new Date(S.restUntil).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })} 自动接着读`); forceRender();
          while (Date.now() < S.restUntil && !S.stop) await sleep(10000);
          S.restUntil = 0; forceRender(); if (S.stop) break; log('歇好了，继续');
        }
      }
      log(`本轮完成：成功 ${S.ok}，读不了 ${S.fail}`); toast(`入库完成：成功 ${S.ok} 条` + (S.fail ? `，${S.fail} 条读不了` : '')); S.bad = null;
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
  async function syncDouyin(auto) {
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
      olog(`✓ 「${d.nick}」已同步：新增 ${j.added}，更新 ${j.updated}`); if (!auto) toast(`${d.nick} 同步完成`); lsSet('rm-of-douyin', d.nick);
    } catch (e) { olog('✗ ' + e.message); if (!auto) toast(e.message); else if (auto !== 'quiet') { try { await srv('/lib/official', { platform: 'douyin', err: e.message }); } catch (er) { } } }
    finally { try { if (bt && bt.own) await chrome.windows.remove(bt.win); } catch (e) { } O.busy = false; forceRender(); }
  }

  async function syncChannels(auto) {
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
      olog(`✓ 视频号「${d.nick}」已同步：新增 ${j.added}，更新 ${j.updated}`); if (!auto) toast(`视频号 ${d.nick} 同步完成`); lsSet('rm-of-channels', d.nick);
    } catch (e) { olog('✗ ' + e.message); if (!auto) toast(e.message); else if (auto !== 'quiet') { try { await srv('/lib/official', { platform: 'channels', err: e.message }); } catch (er) { } } }
    finally { try { if (bt && bt.own) await chrome.windows.remove(bt.win); } catch (e) { } O.busy = false; forceRender(); }
  }

  // ---------- 自动补账号：群里登记的小红书链接，服务器读不到作者的，插件每 15 分钟在后台打开读一次（每次最多 5 条） ----------
  const A = { busy: false, last: 0, n: 0, log: [] };
  async function autoAcct() {
    if (A.busy || S.busy || (typeof R !== 'undefined' && R.busy) || (typeof T !== 'undefined' && T.busy)) return; A.busy = true;
    try {
      const j = await srv('/lib/xhs/noacct?limit=5'); const items = j.items || [];
      for (const it of items) {
        const r = await readOne({ link: it.link }); if (r.stop) break; const nt = r.note || {};
        if (!nt.author) { try { await srv('/lib/xhs/acct', { rec: it.rec, author: '', err: r.err || (r.note ? '页面里没有作者' : '没读到笔记') }); } catch (e) { } }
        if (nt.author) { try { const k = await srv('/lib/xhs/acct', { rec: it.rec, author: nt.author, uid: nt.uid || '', time: nt.time || null, title: nt.title || '', desc: String(nt.desc || '').slice(0, 1500), tags: nt.tags || [] }); A.n++; A.log.unshift(`${new Date().toLocaleTimeString('zh-CN', { hour12: false })} 《${(it.title || '').slice(0, 14)}》→ ${k.account || nt.author}`); A.log = A.log.slice(0, 10); } catch (e) { } }
        await sleep(rand(8000, 15000));
      }
      // 抖音：补账号 + 点赞/评论/转发（服务器读不到抖音）
      try { const d = await srv('/lib/dy/pending?limit=5'); for (const it of d.items || []) {
        await nav(it.link); let st = await msg({ type: 'rm:status' }, 8000); if (st && st.blocked) { if (!(await waitUnblock(st.blocked))) break; await nav(it.link); }
        const rp = await msg({ type: 'rm:readPost', maxComments: 0 }, 45000); const pp = (rp && rp.post) || {};
        if (!(pp.author || pp.likes !== undefined)) { try { await srv('/lib/dy/fill', { table: it.table, rec: it.rec, err: (rp && (rp.error || (rp.blocked ? '被拦：' + rp.blocked : ''))) || '没读到作品' }); } catch (e) { } }
        if (pp.author || pp.likes !== undefined) { try { await srv('/lib/dy/fill', { table: it.table, rec: it.rec, needAcc: !!it.needAcc, author: pp.author || '', likes: pp.likes, comments: pp.comments, shares: pp.shares, collects: pp.collects, title: pp.title || '', desc: String(pp.desc || '').slice(0, 1500), poi: pp.poi || '', tags: pp.tags || [] }); A.n++; } catch (e) { } }
        await sleep(rand(8000, 15000)); } } catch (e) { }
    } catch (e) { } finally { try { if (win && !S.busy && !(typeof R !== 'undefined' && R.busy) && !(typeof T !== 'undefined' && T.busy)) { await chrome.windows.remove(win.id); win = null; } } catch (e) { } A.busy = false; A.last = Date.now(); forceRender(); }
  }
  setTimeout(() => autoAcct(), 60e3); setInterval(() => autoAcct(), 15 * 60e3);
  // 群里刚发的链接：每分钟问一次服务器，有待补的就马上读（1–2 分钟内补上）
  setInterval(async () => { if (A.busy) return; try { const h = await srv('/lib/hot'); if ((h.xhs || 0) + (h.dy || 0) > 0) autoAcct(); } catch (e) { } }, 60e3);

  // ---------- 官方号每天自动同步：手动同步成功过一次的平台（记住账号），之后每天北京时间早上 8 点后自动同步这个浏览器当前登录的号 ----------
  const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) { } };
  async function autoOfficial() {
    for (const [plat, run] of [['douyin', syncDouyin], ['channels', syncChannels]]) {
      if (O.busy || TG.busy) return; const nick = lsGet('rm-of-' + plat); // 没同步成功过：一天只悄悄试一次，没登录也不报警
      if (Date.now() - (+lsGet('rm-of-try-' + plat) || 0) < (nick ? 55 : 24 * 60) * 60e3) continue;
      let need; try { need = await srv(`/lib/official/need?platform=${plat}&account=${encodeURIComponent(nick)}`); } catch (e) { return; }
      if (!need.need) continue; lsSet('rm-of-try-' + plat, Date.now());
      olog(`⏰ 每日自动同步${plat === 'douyin' ? '抖音' : '视频号'}「${nick || '当前登录的号'}」…`); await run(nick ? true : 'quiet');
    }
  }
  setTimeout(() => autoOfficial(), 6 * 60e3); setInterval(() => autoOfficial(), 5 * 60e3);

  // ---------- 推广通报表：每天自动在推广通后台生成「近 30 天、按门店按日」报表，交给机器人入库（不用再手动导出发群） ----------
  const TG = { busy: false, log: [] };
  const tglog = t => { TG.log.unshift(new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '  ' + t); TG.log = TG.log.slice(0, 12); forceRender(); };
  async function autoTgt(force) {
    if (TG.busy) return; let need; try { need = await srv('/lib/tgt/need'); } catch (e) { if (force) tglog('✗ ' + e.message); return; }
    if (!need.need && !force) return; TG.busy = true; forceRender(); let bt = null;
    try {
      tglog(`打开推广通后台，生成 ${need.begin} ~ ${need.end} 的门店报表…`);
      bt = await bgTab('https://midas.dianping.com/shopdiy/account/pcCpcEntry?continueUrl=/app/peon-data-promo-report/html/main.html', 'midas.dianping.com');
      await sleep(2500); const tb = await chrome.tabs.get(bt.tab).catch(() => ({}));
      if (!/^https:\/\/midas\.dianping\.com\//.test(tb.url || '')) { const er = '没登录推广通后台（页面跳到了登录页）：请在这个浏览器打开 e.dianping.com 登录'; tglog('✗ ' + er); try { await srv('/lib/tgt/ingest', { err: er }); } catch (e) { } return; }
      const [r] = await chrome.scripting.executeScript({ target: { tabId: bt.tab }, world: 'MAIN', args: [need.begin, need.end], func: async (begin, end) => {
        if (location.host !== 'midas.dianping.com') return { error: '没登录推广通后台（请在这个浏览器打开 e.dianping.com 登录）' };
        const xhr = (m, u, b) => new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open(m, u); x.withCredentials = true; if (b) x.setRequestHeader('content-type', 'application/x-www-form-urlencoded'); x.onload = () => { try { res(JSON.parse(x.responseText)); } catch (e) { rej(new Error('返回的不是数据（可能没登录）：HTTP ' + x.status)); } }; x.onerror = () => rej(new Error('网络错误')); x.send(b || null); });
        const M = 'dd_1_charge,dd_1_imp,dd_1_click,dd_1_cpc,dd_1_viewPhoto,dd_1_viewReview,dd_1_viewTg,dd_1_viewAddress,dd_1_callCnt,dd_1_viewDish,dd_1_addFavor,dd_1_share,dd_1_orderPromo,dd_1_orderTg,dd_1_sh_cnt,dd_1_pv,dd_1_100001,dd_1_100002,dd_1_cash,dd_1_payOrderCnt7day,dd_1_payOrderCnt15day,dd_1_payOrderCnt30day,dd_1_tgOrderCnt7day,dd_1_tgOrderCnt15day,dd_1_tgOrderCnt30day';
        const body = 'beginDate=' + begin + '&endDate=' + end + '&dateType=-1&groupBy=shop&metricFilters=' + encodeURIComponent(JSON.stringify([{ productValue: 'cpcShop', metrics: M }]));
        let s; try { s = await xhr('POST', '/addata/report/data/v1/ddDataCenter/download/task/submit', body); } catch (e) { return { error: e.message }; }
        if (s.code !== 200 || !s.data) return { error: (/登录|login|401/i.test(JSON.stringify(s)) ? '没登录推广通后台：' : '提交报表任务失败：') + JSON.stringify(s).slice(0, 120) };
        for (let i = 0; i < 36; i++) {
          await new Promise(r => setTimeout(r, 5000));
          let l; try { l = await xhr('GET', '/addata/report/data/v1/ddDataCenter/download/task/list?beginDate=&endDate=&pageNum=1&pageSize=10'); } catch (e) { continue; }
          const t = ((l.data || {}).data || []).find(x => x.id && String(x.id.value) === String(s.data)); if (!t) continue;
          let u = []; try { u = JSON.parse((t.downloadUrl || {}).value || '[]'); } catch (e) { }
          if (u[0]) return { url: u[0] }; if (/失败/.test((t.taskStatus || {}).value || '')) return { error: '推广通报表生成失败：' + t.taskStatus.value };
        }
        return { error: '等了 3 分钟报表还没生成，下个小时再试' };
      } });
      const d = (r && r.result) || { error: '页面没响应' };
      if (d.error) { tglog('✗ ' + d.error); try { await srv('/lib/tgt/ingest', { err: d.error }); } catch (e) { } return; }
      tglog('报表已生成，交给机器人入库…');
      const j = await srv('/lib/tgt/ingest', { url: d.url, begin: need.begin, end: need.end });
      tglog(`✓ 已入库 ${j.rows || 0} 行（新增 ${j.added || 0}、更新 ${j.updated || 0}），最新一天 ${j.last || '—'}`); if (force) toast('推广通报表已入库');
    } catch (e) { tglog('✗ ' + e.message); }
    finally { try { if (bt && bt.own) await chrome.windows.remove(bt.win); } catch (e) { } TG.busy = false; forceRender(); }
  }
  setTimeout(() => autoTgt(), 3 * 60e3); setInterval(() => autoTgt(), 5 * 60e3); // 服务器按北京时间早上 8 点起放行

  // ---------- 美团管家每日数据：早上 6:30 后在已登录的美团管家页面里查昨天（及漏掉的日子）的营业指标、渠道、菜品、时段开台，交给机器人 ----------
  // 查询用页面自己的请求通道（带美团安全签名），查询模板存在 pos.meituan.com 本机存储里，服务器有备份
  const GJ = { busy: false, log: [], last: '' };
  const gjlog = t => { GJ.log.unshift(new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '  ' + t); GJ.log = GJ.log.slice(0, 12); forceRender(); };
  async function autoGj(force) {
    if (GJ.busy || TG.busy) return; let need; try { need = await srv('/lib/gj/need' + (force ? '?force=1' : '')); } catch (e) { if (force) gjlog('✗ ' + e.message); return; }
    if (!need.need || !(need.days || []).length) { if (force) gjlog('今天的数据已经拿过了'); return; }
    GJ.busy = true; forceRender(); let bt = null;
    try {
      gjlog(`打开美团管家，查 ${need.days.join('、')} 的营业数据…`);
      bt = await bgTab('https://pos.meituan.com/web/report/businessIndex#/rms-report/businessIndex', 'pos.meituan.com');
      await sleep(3000); const tb = await chrome.tabs.get(bt.tab).catch(() => ({}));
      if (!/^https:\/\/pos\.meituan\.com\/web\//.test(tb.url || '')) { const er = '没登录美团管家（页面跳到了登录页）：请在这个浏览器打开 pos.meituan.com 登录'; gjlog('✗ ' + er); try { await srv('/lib/gj/ingest', { err: er }); } catch (e) { } return; }
      await chrome.scripting.executeScript({ target: { tabId: bt.tab }, world: 'MAIN', files: ['gjrun.js'] });
      const [r] = await chrome.scripting.executeScript({ target: { tabId: bt.tab }, world: 'MAIN', args: [need.days, need.tpl || null], func: async (days, tpl) => { try { return await window.__rmGjRun(days, tpl); } catch (e) { return { error: String(e && e.message || e) }; } } });
      const d = (r && r.result) || { error: '页面没响应' };
      if (d.error) { gjlog('✗ ' + d.error); try { await srv('/lib/gj/ingest', { err: d.error }); } catch (e) { } return; }
      const j = await srv('/lib/gj/ingest', { days: d.days, errors: d.errors, missing: d.missing, tpl: need.wantTpl ? d.tpl : undefined });
      GJ.last = need.days[need.days.length - 1]; gjlog(`✓ 已交给机器人：${j.text || (d.days.length + ' 天')}${d.errors.length ? '；有 ' + d.errors.length + ' 项没查到：' + d.errors.slice(0, 2).join('；') : ''}`); if (force) toast('美团管家数据已入库');
    } catch (e) { gjlog('✗ ' + e.message); }
    finally { try { if (bt && bt.own) await chrome.windows.remove(bt.win); } catch (e) { } GJ.busy = false; forceRender(); }
  }
  setTimeout(() => autoGj(), 2 * 60e3); setInterval(() => autoGj(), 5 * 60e3); // 服务器按北京时间早上 6:30 起放行

  // ---------- 同类爆款调研：在小红书搜同类关键词，读回近期高赞笔记 ----------
  // 关键词：门店商圈 → 城市攻略 → 品类 → 场景 → 爆款句式（前面带 * 的不限地区，门槛翻倍）
  const KW0 = '水东街美食\n水东街宵夜\n惠州水东街\n惠州老街美食\n惠州西湖附近美食\n华强北美食\n华强北宵夜\n华强北附近吃什么\n福田宵夜\n白石洲美食\n白石洲宵夜\n深圳湾附近美食\n南山宵夜\n前海美食\n前海宵夜\n前海附近吃什么\n宝安中心美食\n蛇口美食\n蛇口花园城美食\n南山粤菜\n深圳粤菜家宴\n江南西美食\n江南西宵夜\n海珠美食\n广州海珠宵夜\n珠海美食\n珠海宵夜\n香洲美食\n珠海本地人推荐\n千灯湖美食\n千灯湖宵夜\n南海美食\n佛山宵夜\n佛山创意产业园美食\n禅城美食\n禅城宵夜\n东城33小镇美食\n东莞东城美食\n东莞宵夜\n惠州美食攻略\n惠州本地人小店\n深圳美食攻略\n深圳本地人推荐\n广州美食攻略\n广州本地人推荐\n珠海美食攻略\n佛山美食攻略\n东莞美食攻略\n海鲜大排档\n粤式大排档\n广式大排档\n潮汕大排档\n生腌\n干炒牛河\n砂锅粥\n粤菜家宴\n粤菜馆推荐\n宵夜大排档\n深圳宵夜\n广州宵夜\n朋友聚餐推荐\n家庭聚餐粤菜\n请客吃饭粤菜\n凌晨还开的店\n一个人宵夜\n*本地人私藏大排档\n*大排档避雷\n*大排档必点\n*人均50宵夜\n*宵夜清单\n*本地人才知道的店';
  const R = { busy: false, stop: false, kw: KW0, per: 8, minLike: 200, days: 0, log: [], n: 0, ok: 0 }; // days=0：自动 30→60→90 天逐级放宽
  // 防风控节奏：每轮最多 work 分钟或 maxKw 个词，歇 rest 分钟（±10 分钟随机）再接着跑；跑到第几个词记在本机，关了插件下次接着跑
  const RS = (() => { try { return JSON.parse(localStorage.getItem('rm-rs-pace') || '{}'); } catch (e) { return {}; } })();
  Object.assign(R, { work: RS.work || 60, rest: RS.rest || 60, maxKw: 20, pos: RS.pos || 0, total: 0, roundKw: 0, restUntil: 0, sig: RS.sig || '' });
  const saveRS = () => { try { localStorage.setItem('rm-rs-pace', JSON.stringify({ work: R.work, rest: R.rest, pos: R.pos, sig: R.sig })); } catch (e) { } };
  const rlog = t => { R.log.unshift(new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '  ' + t); R.log = R.log.slice(0, 30); forceRender(); };
  const num0 = v => { const m = String(v ?? '').replace(/,/g, '').match(/([\d.]+)\s*(万|w)?/i); return m ? parseFloat(m[1]) * (m[2] ? 1e4 : 1) : 0; };
  async function research() {
    if (R.busy || S.busy) return toast(S.busy ? '先等自家内容入库这一轮跑完' : '正在调研');
    if (typeof T !== 'undefined' && T.busy) return toast('先等链接追踪这一轮跑完');
    R.busy = true; forceRender(); if (!(await waitA(rlog))) { R.busy = false; forceRender(); return toast('后台自动补账号还在跑，稍后再点'); }
    try { if (win) await chrome.windows.remove(win.id); } catch (e) { } win = null;
    R.busy = true; R.stop = false; R.ok = 0; R.n = 0; forceRender();
    try {
      const seen = new Set((await srv('/lib/market-seen')).ids || []);
      const kws = R.kw.split(/\n+/).map(x => x.trim()).filter(Boolean); const since = Date.now() - R.days * 864e5;
      const sig = kws.join('|'); if (sig !== R.sig) { R.sig = sig; R.pos = 0; } if (R.pos >= kws.length) R.pos = 0; R.total = kws.length; saveRS();
      rlog(`开始调研 ${kws.length} 个关键词` + (R.pos ? `，从第 ${R.pos + 1} 个接着跑` : '') + `，每个读 ${R.per} 篇` + (R.days ? `（近 ${R.days} 天、赞 ≥${R.minLike}）` : `（近 30 天优先，不够自动扩到 60、90 天）`) + `；每轮 ${R.work} 分钟或 ${R.maxKw} 个词，歇 ${R.rest} 分钟`);
      let roundAt = Date.now(); R.roundKw = 0;
      for (; R.pos < kws.length; R.pos++, saveRS()) {
        if (R.stop) break; const rawKw = kws[R.pos]; const kw = rawKw.replace(/^\*/, '');
        if (R.roundKw >= R.maxKw || Date.now() - roundAt > R.work * 60e3) { // 这一轮够了：关掉小红书窗口，歇一会
          try { if (win) await chrome.windows.remove(win.id); } catch (e) { } win = null;
          const ms = (R.rest + (Math.random() * 20 - 10)) * 60e3; R.restUntil = Date.now() + ms;
          rlog(`本轮跑了 ${R.roundKw} 个词，歇 ${Math.round(ms / 60e3)} 分钟（防风控），之后从「${kw}」接着跑`); forceRender();
          while (Date.now() < R.restUntil && !R.stop) await sleep(10000);
          R.restUntil = 0; forceRender(); if (R.stop) break; roundAt = Date.now(); R.roundKw = 0; rlog('歇好了，继续');
        }
        R.roundKw++;
        await nav(`https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(kw)}&source=web_search_result_notes`);
        let st = await msg({ type: 'rm:status' }, 8000); if (st && st.blocked) { if (!(await waitUnblock(st.blocked))) break; await nav(`https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(kw)}&source=web_search_result_notes`); }
        const res = await msg({ type: 'rm:collectList', limit: 90 }, 300000);
        const all = ((res && res.list) || []).filter(x => x.id && x.kind !== 'video' && x.type !== 'video');
        const star = /^\*/.test(rawKw), mul = star ? 2 : 1, now = Date.now();
        const age = x => x.time ? (now - x.time) / 864e5 : 999;
        // 时间窗口逐级放宽：30 天够 per 篇就不扩；不够扩到 60、再到 90；门槛 30 天 200 / 60 天 300 / 90 天 500（按「最低点赞」等比例调，* 词翻倍）
        const tiers = R.days ? [[R.days, R.minLike]] : [[30, R.minLike], [60, R.minLike * 1.5], [90, R.minLike * 2.5]];
        const list = []; const cnt = {}; let used = 0;
        for (let ti = 0; ti < tiers.length && list.length < R.per; ti++) {
          const [d, ml] = tiers[ti], prev = ti ? tiers[ti - 1][0] : -1; used = d;
          const pool = all.filter(x => !seen.has(x.id) && age(x) <= d && age(x) > prev && num0(x.likes) >= ml * mul).sort((a, b) => num0(b.likes) - num0(a.likes));
          cnt[d] = pool.length; list.push(...pool.slice(0, R.per - list.length));
        }
        // 小词兜底：90 天内、同一个词里点赞排前 20% 的也算（至少 100 赞），补到 per 篇
        if (list.length < R.per && !R.days) { const pool90 = all.filter(x => !seen.has(x.id) && age(x) <= 90 && !list.includes(x)).sort((a, b) => num0(b.likes) - num0(a.likes)); const top = pool90.slice(0, Math.ceil(all.filter(x => age(x) <= 90).length * 0.2)).filter(x => num0(x.likes) >= 100); cnt['前20%'] = top.length; list.push(...top.slice(0, R.per - list.length)); }
        const old = all.filter(x => age(x) > (R.days || 90)).length;
        rlog(`「${kw}」搜到 ${all.length} 篇图文，剔除 ${R.days || 90} 天前老帖 ${old} 篇；` + Object.entries(cnt).map(([d, n]) => `${d}天内达标 ${n}`).join('、') + `；用到近 ${used} 天，读 ${list.length} 篇` + (list.length < R.per && !R.days ? '（词偏冷，可换更大的词）' : ''));
        for (const x of list) {
          if (R.stop) break; R.n++; forceRender();
          const r = await readOne({ link: x.url }); if (r.stop) { R.stop = true; break; } if (r.err) { rlog(`✗ ${x.title || x.id}：${r.err}`); continue; }
          try { await srv('/lib/market', { kw, note: r.note, comments: r.comments, window: age(x) <= 30 ? 30 : age(x) <= 60 ? 60 : 90 }); seen.add(x.id); R.ok++; rlog(`✓ 「${kw}」《${(r.note.title || '').slice(0, 18)}》赞 ${r.note.likes}`); } catch (e) { rlog('✗ 交给机器人失败：' + e.message); }
          await sleep(rand(3000, 6000));
        }
        await sleep(rand(5000, 10000));
      }
      if (R.pos >= R.total) { R.pos = 0; saveRS(); rlog(`调研完成：全部 ${R.total} 个词跑完，这次入库 ${R.ok} 篇同类爆款`); toast(`同类爆款调研完成：${R.ok} 篇`); } else rlog(`已停在第 ${R.pos + 1}/${R.total} 个词「${(kws[R.pos] || '').replace(/^\*/, '')}」，下次点「开始调研」接着跑；这次入库 ${R.ok} 篇`);
    } catch (e) { rlog('出错：' + e.message); toast(e.message); }
    finally { try { if (win) await chrome.windows.remove(win.id); } catch (e) { } win = null; R.busy = false; R.restUntil = 0; saveRS(); forceRender(); }
  }

  // ---------- 链接追踪：代发/投放的一批小红书链接，插件逐条读赞藏评写回飞书 ----------
  const T = { names: null, cur: '', busy: false, stop: false, log: [], i: 0, n: 0 };
  const tlog = t => { T.log.unshift(new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '  ' + t); T.log = T.log.slice(0, 20); forceRender(); };
  async function campLoad() { try { T.names = (await srv('/lib/camp/list')).names || []; if (!T.cur) T.cur = T.names[T.names.length - 1] || ''; } catch (e) { T.names = []; } forceRender(); }
  async function campRun(all) {
    if (T.busy || S.busy || R.busy) return toast('先等其他读取任务跑完'); if (!T.cur) return toast('还没有链接追踪表');
    if (!(await waitA())) return toast('后台自动补账号还在跑，稍后再点'); if (T.busy || S.busy || R.busy) return;
    T.busy = true; T.stop = false; T.i = 0; forceRender();
    try {
      const items = (await srv('/lib/camp/pending?name=' + encodeURIComponent(T.cur) + (all ? '&all=1' : ''))).items || []; T.n = items.length;
      tlog(`「${T.cur}」要读 ${items.length} 条`);
      // 代发笔记大多是几个月前的分享链接，已过期：有「主页链接」的先去作者主页拿新地址；没有的跳过、留待补主页
      const fresh = {}, homesDone = new Set();
      const noteIdOf = async link => { const m0 = link.match(/(?:explore|item)\/([0-9a-f]{24})/); if (m0) return m0[1]; try { const r = await fetch(link, { credentials: 'include' }); const u = decodeURIComponent(r.url || ''); const m = u.match(/(?:explore|item)\/([0-9a-f]{24})/); return m ? m[1] : ''; } catch (e) { return ''; } };
      let skipped = 0;
      for (const it of items) {
        if (T.stop) break; T.i++; forceRender();
        const nid = await noteIdOf(it.link); const linkOld = /apptime=|xhslink/.test(it.link);
        if (false /* 不再进作者主页 */ && nid && !fresh[nid] && it.home && !homesDone.has(it.home)) { homesDone.add(it.home); await nav(it.home); const res = await msg({ type: 'rm:collectProfile', limit: 120 }, 300000); ((res && res.list) || []).forEach(x => { if (x.id && x.url && /xsec_token=/.test(x.url)) fresh[x.id] = x.url; }); await sleep(rand(3000, 6000)); }
        if (!(nid && fresh[nid]) && !it.home && T.tried && T.tried[it.rec]) { skipped++; continue; }
        T.tried = T.tried || {}; T.tried[it.rec] = 1;
        const r = await readOne({ link: nid && fresh[nid] ? fresh[nid] : it.link }); if (r.stop) break;
        if (r.err && /没读到/.test(r.err) && !it.home) { await srv('/lib/camp/note', { name: T.cur, rec: it.rec, error: '链接过期，需补主页链接' }); tlog(`✗ 第 ${T.i} 条：链接过期，表里补「主页链接」后再读`); await sleep(rand(1500, 3000)); continue; }
        await srv('/lib/camp/note', r.err ? { name: T.cur, rec: it.rec, error: r.err } : { name: T.cur, rec: it.rec, note: r.note });
        tlog(r.err ? `✗ 第 ${T.i} 条：${r.err}` : `✓ 第 ${T.i} 条《${(r.note.title || '').slice(0, 16)}》赞 ${r.note.likes} 藏 ${r.note.collects}`);
        await sleep(rand(6000, 11000)); if (T.i % 25 === 0) await sleep(rand(40000, 60000));
      }
      tlog('完成'); toast('链接追踪读取完成');
    } catch (e) { tlog('出错：' + e.message); }
    finally { try { if (win) await chrome.windows.remove(win.id); } catch (e) { } win = null; T.busy = false; forceRender(); }
  }

  function view() {
    const I = S.info; const has = CFG().key;
    return `<div class="section-h"><h2>自家内容入库</h2><span class="hint">把我们自己发过的小红书笔记一条条读进「自家内容库」（标题、正文、话题、全部图片、赞藏评、热门评论），机器人再用通义千问分析封面和图片，升级爆款公式</span></div>
    <div class="panel stack" id="fs-own">
      ${!has ? '<div class="hint" style="color:#c52b1b">这个插件版本没有入库口令，请换用机器人发来的最新插件文件。</div>' : ''}
      <div class="hint">${I ? (I.error ? `连接机器人失败：${h(I.error)}` : `飞书里共 <b>${I.total}</b> 条小红书笔记，已入库 <b>${I.done}</b> 条，还没读 <b>${I.left}</b> 条` + (I.unreadable ? `，<b style="color:#c52b1b">读不了 ${I.unreadable} 条</b> <button class="btn ghost sm" data-action="fs-own-bad">${S.bad ? '收起' : '看是哪些'}</button>` : '') + '。') : '正在读取进度…'}
        只按登记的链接读（不进主页、不用标题搜）；链接过期或笔记不可见的记为「读不了」。用的是这个浏览器里当前登录的小红书账号，建议用普通个人号。</div>
      ${S.bad ? `<div class="tbl-wrap"><table><thead><tr><th>账号</th><th>标题</th><th>原因</th></tr></thead><tbody>${S.bad.map(x => `<tr><td>${h(x.acc)}</td><td style="white-space:normal">${x.link ? `<a href="${h(x.link)}" target="_blank" rel="noopener">${h(x.title || '打开')}</a>` : h(x.title)}</td><td>${h(x.why)}</td></tr>`).join('') || '<tr><td colspan="3" class="hint">没有</td></tr>'}</tbody></table></div>` : ''}
      <div class="row"><label class="f" style="flex:0 0 auto"><span>这次读</span><select data-own="batch">${[20, 60, 100, 200, 300].map(n => `<option ${n === S.batch ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <span class="hint grow">防风控：每条间隔 15–30 秒，每读 20 条关窗歇 1 小时左右再自动接着读（每小时约 20 条），可以挂着慢慢跑；读过的、读不了的都不会重复读。<b>建议用手机热点、普通小号跑，别走办公室 Wi‑Fi。</b></span>
        ${S.busy ? '<button class="btn sm" data-action="fs-own-stop">停止</button>' : ''}
        <button class="btn primary" data-action="fs-own-run" ${S.busy || !has ? 'disabled' : ''}>${S.busy ? '读取中…' : '开始入库'}</button></div>
      ${S.busy ? `<div class="hint"><b>${S.paused ? '⏸ 等你在小红书窗口里完成验证…' : S.restUntil ? `⏸ 歇一会，约 ${new Date(S.restUntil).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })} 接着读第 ${S.i + 1}/${S.n} 条` : `进行中 ${S.i}/${S.n}：${h(S.cur)}`}</b> · 成功 ${S.ok} · 读不了 ${S.fail}</div>` : ''}
      ${S.log.length ? `<pre class="small-pre">${h(S.log.slice(0, 12).join('\n'))}</pre>` : ''}
    </div>
    <div class="section-h"><h2>美团管家每日数据</h2><span class="hint">每天早上 6:30 后自动查昨天各店的营业额、堂食/外卖、开台数、人数、桌均、人均、菜品销量、时段开台，交给机器人做运营日报。要求这个浏览器登录着美团管家。</span></div>
    <div class="panel stack"><div class="row"><span class="hint grow">${GJ.busy ? '查询中…' : GJ.last ? '最近一次：' + h(GJ.last) : '等早上自动跑'}</span><button class="btn" data-action="fs-own-gj" ${GJ.busy || !has ? 'disabled' : ''}>现在查一次</button></div>
      ${GJ.log.length ? `<pre class="small-pre">${h(GJ.log.join('\n'))}</pre>` : ''}</div>
    `;
  }
  // 同类爆款调研面板：放在「爆款」页的「爆款库」格子里
  function researchView() {
    const has = CFG().key; const rest = R.restUntil && R.restUntil > Date.now();
    return `    <div class="section-h"><h2>同类爆款调研</h2><span class="hint">在小红书搜和我们同类的关键词，读回近期高赞图文（标题、正文、前 6 张图、赞藏评、热门评论），存进「同类爆款库」，和自家内容对比</span></div>
    <div class="panel stack">
      <label class="f"><span>关键词（一行一个）</span><textarea data-own="kw" rows="4">${h(R.kw)}</textarea></label>
      <div class="row"><label class="f" style="flex:0 0 auto"><span>每词读</span><select data-own="per">${[5, 8, 12].map(n => `<option ${n === R.per ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="f" style="flex:0 0 auto"><span>最低点赞</span><select data-own="minLike">${[100, 200, 300, 1000].map(n => `<option ${n === R.minLike ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="f" style="flex:0 0 auto"><span>时间</span><select data-own="days">${[0, 30, 90, 180].map(n => `<option value="${n}" ${n === R.days ? 'selected' : ''}>${n ? '近 ' + n + ' 天' : '自动 30→60→90'}</option>`).join('')}</select></label>
        <label class="f" style="flex:0 0 auto"><span>每轮跑</span><select data-own="work">${[30, 45, 60].map(n => `<option value="${n}" ${n === R.work ? 'selected' : ''}>${n} 分钟</option>`).join('')}</select></label>
        <label class="f" style="flex:0 0 auto"><span>然后歇</span><select data-own="rest">${[30, 60, 90, 120].map(n => `<option value="${n}" ${n === R.rest ? 'selected' : ''}>${n} 分钟</option>`).join('')}</select></label>
        <span class="hint grow">防风控：每轮最多 ${R.work} 分钟或 ${R.maxKw} 个词（先到为准），歇 ${R.rest} 分钟左右再自动接着跑，直到词跑完；关掉插件下次从停下的词接着跑。碰到验证码会停下等你处理。和自家入库不要同时跑。</span>
        ${R.busy ? '<button class="btn sm" data-action="fs-own-rstop">停止</button>' : ''}
        <button class="btn primary" data-action="fs-own-rs" ${R.busy || S.busy || !has ? 'disabled' : ''}>${R.busy ? `调研中 ${R.ok}/${R.n}…` : '开始调研'}</button></div>
      ${rest ? `<div class="hint"><b>⏸ 歇一会，约 ${new Date(R.restUntil).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })} 接着跑第 ${R.pos + 1}/${R.total} 个词</b></div>` : R.busy && R.total ? `<div class="hint"><b>第 ${R.pos + 1}/${R.total} 个词 · 本轮 ${R.roundKw}/${R.maxKw}</b></div>` : (!R.busy && R.pos > 0 && R.total ? `<div class="hint">上次跑到第 ${R.pos}/${R.total} 个词，点「开始调研」接着跑</div>` : '')}
      ${R.log.length ? `<pre class="small-pre">${h(R.log.slice(0, 10).join('\n'))}</pre>` : ''}
    </div>
`;
  }
  async function act(action) { if (action === 'fs-own-tgt') autoTgt(true); if (action === 'fs-own-gj') autoGj(true); if (action === 'fs-own-dy') syncDouyin(false); if (action === 'fs-own-tnew') campRun(false); if (action === 'fs-own-tall') campRun(true); if (action === 'fs-own-tstop') { T.stop = true; tlog('读完这一条就停'); } if (action === 'fs-own-rs') research(); if (action === 'fs-own-rstop') { R.stop = true; rlog('读完这一篇就停'); } if (action === 'fs-own-sph') syncChannels(); if (action === 'fs-own-run') run(); if (action === 'fs-own-bad') { if (S.bad) { S.bad = null; forceRender(); } else { try { S.bad = (await srv('/lib/unreadable')).items || []; } catch (e) { toast(e.message); } forceRender(); } } if (action === 'fs-own-stop') { S.stop = true; log('收到，读完这一条就停'); } }
  function attach(root) {
    if (!S.info && CFG().key) refresh();
    root.addEventListener('change', e => { const t = e.target; const k = t.dataset && t.dataset.own; if (k === 'batch') S.batch = +t.value || 100; if (k === 'per' || k === 'minLike' || k === 'days') R[k] = +t.value; if (k === 'work' || k === 'rest') { R[k] = +t.value; saveRS(); forceRender(); } if (k === 'camp') T.cur = t.value; });
    root.addEventListener('input', e => { const t = e.target; if (t.dataset && t.dataset.own === 'kw') R.kw = t.value; });
  }
  window.OwnLib = { view, researchView, act, attach, _s: S };
})();
