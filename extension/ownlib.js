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
    if (S.busy) return; S.busy = true; S.stop = false; S.ok = 0; S.fail = 0; S.i = 0; forceRender();
    try {
      const t = await srv('/lib/todo?limit=' + S.batch); S.info = t; S.n = t.items.length;
      if (!S.n) { log('都读完了，没有新的笔记'); return; }
      log(`开始读取 ${S.n} 条（全部 ${t.total}，已读 ${t.done}）。后台窗口别关，可以最小化`);
      // 旧笔记的分享链接会过期（打开显示「暂时无法浏览」）：改用标题去搜，在搜索结果里点开（不再走作者主页）
      const fresh = {}; const homesDone = new Set();
      const noteIdOf = async link => { const m0 = link.match(/(?:explore|item)\/([0-9a-f]{24})/); if (m0) return m0[1]; try { const r = await fetch(link, { credentials: 'include' }); const u = decodeURIComponent(r.url || ''); const m = u.match(/(?:explore|item)\/([0-9a-f]{24})/); return m ? m[1] : ''; } catch (e) { return ''; } };
      async function loadHome(home) { if (!home || homesDone.has(home)) return; homesDone.add(home); await nav(home); let st = await msg({ type: 'rm:status' }, 8000); if (st && st.blocked) { if (!(await waitUnblock(st.blocked))) return; await nav(home); }
        const res = await msg({ type: 'rm:collectProfile', limit: 120 }, 300000); ((res && res.list) || []).forEach(x => { if (x.id && x.url && /xsec_token=/.test(x.url)) fresh[x.id] = x.url; }); log(`主页「${(res && res.profile && res.profile.name) || ''}」拿到 ${Object.keys(fresh).length} 条笔记地址`); await sleep(rand(3000, 6000)); }
      // 用标题搜：在搜索结果里找同一篇（笔记 ID 一样，或标题对得上且作者一样），拿到带新口令的地址
      async function byTitle(it, nid) {
        const q = String(it.title || '').replace(/[\u{1F000}-\u{1FFFF}\u2600-\u27BF#️⃣]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 24); if (q.length < 4) return '';
        const u = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(q)}&source=web_search_result_notes`;
        await nav(u); let st = await msg({ type: 'rm:status' }, 8000); if (st && st.blocked) { if (!(await waitUnblock(st.blocked))) return ''; await nav(u); }
        const res = await msg({ type: 'rm:collectList', limit: 20 }, 120000); const list = (res && res.list) || [];
        const norm = x => String(x || '').replace(/[\s\p{P}\p{S}]/gu, '');
        const hit = list.find(x => nid && x.id === nid) || list.find(x => norm(x.title) && (norm(x.title).includes(norm(q).slice(0, 10)) || norm(q).includes(norm(x.title).slice(0, 10))) && (!it.acc || !x.author || norm(x.author) === norm(it.acc)));
        log(hit ? `🔎 用标题搜到《${q.slice(0, 14)}》` : `🔎 标题没搜到《${q.slice(0, 14)}》`); await sleep(rand(2000, 4000));
        return hit && hit.url ? hit.url : '';
      }
      for (const it of t.items) {
        if (S.stop) break; S.i++; S.cur = it.acc; forceRender();
        const nid = await noteIdOf(it.link);
        let r = null;
        // 链接以前读过、已过期：直接用标题搜，不再打开老链接
        if (!it.expired) { r = await readOne(it); if (r.again) r = await readOne(it); }
        if (!r || (r.err && r.retry)) { const f = await byTitle(it, nid); if (f) { r = await readOne(Object.assign({}, it, { link: f })); if (r.again) r = await readOne(Object.assign({}, it, { link: f })); } else if (it.title) r = { err: '链接过期，标题也没搜到', retry: false }; else if (!r) r = { err: '链接过期', retry: true }; }
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

  // ---------- 自动补账号：群里登记的小红书链接，服务器读不到作者的，插件每 15 分钟在后台打开读一次（每次最多 5 条） ----------
  const A = { busy: false, last: 0, n: 0, log: [] };
  async function autoAcct() {
    if (A.busy || S.busy || (typeof R !== 'undefined' && R.busy) || (typeof T !== 'undefined' && T.busy)) return; A.busy = true;
    try {
      const j = await srv('/lib/xhs/noacct?limit=5'); const items = j.items || []; if (!items.length) return;
      for (const it of items) {
        const r = await readOne({ link: it.link }); if (r.stop) break; const nt = r.note || {};
        if (nt.author) { try { const k = await srv('/lib/xhs/acct', { rec: it.rec, author: nt.author, uid: nt.uid || '', time: nt.time || null }); A.n++; A.log.unshift(`${new Date().toLocaleTimeString('zh-CN', { hour12: false })} 《${(it.title || '').slice(0, 14)}》→ ${k.account || nt.author}`); A.log = A.log.slice(0, 10); } catch (e) { } }
        await sleep(rand(8000, 15000));
      }
    } catch (e) { } finally { try { if (win && !S.busy) { await chrome.windows.remove(win.id); win = null; } } catch (e) { } A.busy = false; A.last = Date.now(); forceRender(); }
  }
  setTimeout(() => autoAcct(), 60e3); setInterval(() => autoAcct(), 15 * 60e3);

  // ---------- 同类爆款调研：在小红书搜同类关键词，读回近期高赞笔记 ----------
  // 关键词：门店商圈 → 城市攻略 → 品类 → 场景 → 爆款句式（前面带 * 的不限地区，门槛翻倍）
  const KW0 = '水东街美食\n水东街宵夜\n惠州水东街\n惠州老街美食\n惠州西湖附近美食\n华强北美食\n华强北宵夜\n华强北附近吃什么\n福田宵夜\n白石洲美食\n白石洲宵夜\n深圳湾附近美食\n南山宵夜\n前海美食\n前海宵夜\n前海附近吃什么\n宝安中心美食\n蛇口美食\n蛇口花园城美食\n南山粤菜\n深圳粤菜家宴\n江南西美食\n江南西宵夜\n海珠美食\n广州海珠宵夜\n珠海美食\n珠海宵夜\n香洲美食\n珠海本地人推荐\n千灯湖美食\n千灯湖宵夜\n南海美食\n佛山宵夜\n佛山创意产业园美食\n禅城美食\n禅城宵夜\n东城33小镇美食\n东莞东城美食\n东莞宵夜\n惠州美食攻略\n惠州本地人小店\n深圳美食攻略\n深圳本地人推荐\n广州美食攻略\n广州本地人推荐\n珠海美食攻略\n佛山美食攻略\n东莞美食攻略\n海鲜大排档\n粤式大排档\n广式大排档\n潮汕大排档\n生腌\n干炒牛河\n砂锅粥\n粤菜家宴\n粤菜馆推荐\n宵夜大排档\n深圳宵夜\n广州宵夜\n朋友聚餐推荐\n家庭聚餐粤菜\n请客吃饭粤菜\n凌晨还开的店\n一个人宵夜\n*本地人私藏大排档\n*大排档避雷\n*大排档必点\n*人均50宵夜\n*宵夜清单\n*本地人才知道的店';
  const R = { busy: false, stop: false, kw: KW0, per: 8, minLike: 200, days: 0, log: [], n: 0, ok: 0 }; // days=0：自动 30→60→90 天逐级放宽
  const rlog = t => { R.log.unshift(new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '  ' + t); R.log = R.log.slice(0, 30); forceRender(); };
  const num0 = v => { const m = String(v ?? '').replace(/,/g, '').match(/([\d.]+)\s*(万|w)?/i); return m ? parseFloat(m[1]) * (m[2] ? 1e4 : 1) : 0; };
  async function research() {
    if (R.busy || S.busy) return toast(S.busy ? '先等自家内容入库这一轮跑完' : '正在调研');
    R.busy = true; R.stop = false; R.ok = 0; R.n = 0; forceRender();
    try {
      const seen = new Set((await srv('/lib/market-seen')).ids || []);
      const kws = R.kw.split(/\n+/).map(x => x.trim()).filter(Boolean); const since = Date.now() - R.days * 864e5;
      rlog(`开始调研 ${kws.length} 个关键词，每个读 ${R.per} 篇` + (R.days ? `（近 ${R.days} 天、赞 ≥${R.minLike}）` : `（近 30 天优先，不够自动扩到 60、90 天）`));
      for (const rawKw of kws) {
        if (R.stop) break; const kw = rawKw.replace(/^\*/, '');
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
      rlog(`调研完成：入库 ${R.ok} 篇同类爆款`); toast(`同类爆款调研完成：${R.ok} 篇`);
    } catch (e) { rlog('出错：' + e.message); toast(e.message); }
    finally { try { if (win) await chrome.windows.remove(win.id); } catch (e) { } win = null; R.busy = false; forceRender(); }
  }

  // ---------- 链接追踪：代发/投放的一批小红书链接，插件逐条读赞藏评写回飞书 ----------
  const T = { names: null, cur: '', busy: false, stop: false, log: [], i: 0, n: 0 };
  const tlog = t => { T.log.unshift(new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '  ' + t); T.log = T.log.slice(0, 20); forceRender(); };
  async function campLoad() { try { T.names = (await srv('/lib/camp/list')).names || []; if (!T.cur) T.cur = T.names[T.names.length - 1] || ''; } catch (e) { T.names = []; } forceRender(); }
  async function campRun(all) {
    if (T.busy || S.busy || R.busy) return toast('先等其他读取任务跑完'); if (!T.cur) return toast('还没有链接追踪表');
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
        if (nid && !fresh[nid] && it.home && !homesDone.has(it.home)) { homesDone.add(it.home); await nav(it.home); const res = await msg({ type: 'rm:collectProfile', limit: 120 }, 300000); ((res && res.list) || []).forEach(x => { if (x.id && x.url && /xsec_token=/.test(x.url)) fresh[x.id] = x.url; }); await sleep(rand(3000, 6000)); }
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
      <div class="hint">${I ? (I.error ? `连接机器人失败：${h(I.error)}` : `飞书里共 <b>${I.total}</b> 条小红书笔记，已入库 <b>${I.done}</b> 条，还剩 <b>${I.left}</b> 条。`) : '正在读取进度…'}
        用的是这个浏览器里当前登录的小红书账号，建议用普通个人号。</div>
      <div class="row"><label class="f" style="flex:0 0 auto"><span>这次读</span><select data-own="batch">${[30, 100, 200, 300].map(n => `<option ${n === S.batch ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <span class="hint grow">约 10–15 秒一条，每 25 条歇 1 分钟；读过的不会重复。</span>
        ${S.busy ? '<button class="btn sm" data-action="fs-own-stop">停止</button>' : ''}
        <button class="btn primary" data-action="fs-own-run" ${S.busy || !has ? 'disabled' : ''}>${S.busy ? '读取中…' : '开始入库'}</button></div>
      ${S.busy ? `<div class="hint"><b>${S.paused ? '⏸ 等你在小红书窗口里完成验证…' : `进行中 ${S.i}/${S.n}：${h(S.cur)}`}</b> · 成功 ${S.ok} · 失败 ${S.fail}</div>` : ''}
      ${S.log.length ? `<pre class="small-pre">${h(S.log.slice(0, 12).join('\n'))}</pre>` : ''}
    </div>
    <div class="section-h"><h2>链接追踪</h2><span class="hint">代发、达人投放的一批小红书链接：逐条读标题、作者、发布时间、赞藏评，写回飞书私密表格里对应的表（重读可更新数字）</span></div>
    <div class="panel stack"><div class="row">
      <label class="f grow"><span>追踪表</span><select data-own="camp">${(T.names || []).map(n => `<option ${n === T.cur ? 'selected' : ''}>${h(n)}</option>`).join('') || '<option value="">（还没有，发表格给 Claude 登记）</option>'}</select></label>
      ${T.busy ? '<button class="btn sm" data-action="fs-own-tstop">停止</button>' : ''}
      <button class="btn primary sm" data-action="fs-own-tnew" ${T.busy || !has ? 'disabled' : ''}>${T.busy ? `读取中 ${T.i}/${T.n}…` : '读未读的'}</button>
      <button class="btn sm" data-action="fs-own-tall" ${T.busy || !has ? 'disabled' : ''}>全部重读（更新数字）</button></div>
      ${T.log.length ? `<pre class="small-pre">${h(T.log.slice(0, 8).join('\n'))}</pre>` : ''}
    </div>
    <div class="section-h"><h2>同类爆款调研</h2><span class="hint">在小红书搜和我们同类的关键词，读回近期高赞图文（标题、正文、前 6 张图、赞藏评、热门评论），存进「同类爆款库」，和自家内容对比</span></div>
    <div class="panel stack">
      <label class="f"><span>关键词（一行一个）</span><textarea data-own="kw" rows="4">${h(R.kw)}</textarea></label>
      <div class="row"><label class="f" style="flex:0 0 auto"><span>每词读</span><select data-own="per">${[5, 8, 12].map(n => `<option ${n === R.per ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="f" style="flex:0 0 auto"><span>最低点赞</span><select data-own="minLike">${[100, 200, 300, 1000].map(n => `<option ${n === R.minLike ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="f" style="flex:0 0 auto"><span>时间</span><select data-own="days">${[0, 30, 90, 180].map(n => `<option value="${n}" ${n === R.days ? 'selected' : ''}>${n ? '近 ' + n + ' 天' : '自动 30→60→90'}</option>`).join('')}</select></label>
        <span class="hint grow">约 70 个词、2–3 小时；碰到验证码会停下等你处理，处理完自动接着跑；和自家入库不要同时跑。</span>
        ${R.busy ? '<button class="btn sm" data-action="fs-own-rstop">停止</button>' : ''}
        <button class="btn primary" data-action="fs-own-rs" ${R.busy || S.busy || !has ? 'disabled' : ''}>${R.busy ? `调研中 ${R.ok}/${R.n}…` : '开始调研'}</button></div>
      ${R.log.length ? `<pre class="small-pre">${h(R.log.slice(0, 10).join('\n'))}</pre>` : ''}
    </div>
    <div class="section-h"><h2>官方号数据</h2><span class="hint">读抖音蓝 V（YES 也是大排档、粤迹）的创作者后台和视频号助手：每条作品的播放、完播率、2 秒跳出、涨粉、主页访问，写进私密表格「官方号作品数据」</span></div>
    <div class="panel stack">
      <div class="row"><span class="hint grow">读的是这个浏览器里 creator.douyin.com <b>当前登录</b>的账号。两个蓝 V：同步完一个，在创作者中心右上角头像「切换账号」换另一个，再点一次。约 1 分钟。</span>
        <button class="btn primary" data-action="fs-own-dy" ${O.busy || !has ? 'disabled' : ''}>${O.busy ? '同步中…' : '同步抖音蓝 V'}</button>
        <button class="btn primary" data-action="fs-own-sph" ${O.busy || !has ? 'disabled' : ''}>同步视频号</button></div>
      ${O.log.length ? `<pre class="small-pre">${h(O.log.slice(0, 8).join('\n'))}</pre>` : ''}
    </div>`;
  }
  async function act(action) { if (action === 'fs-own-dy') syncDouyin(); if (action === 'fs-own-tnew') campRun(false); if (action === 'fs-own-tall') campRun(true); if (action === 'fs-own-tstop') { T.stop = true; tlog('读完这一条就停'); } if (action === 'fs-own-rs') research(); if (action === 'fs-own-rstop') { R.stop = true; rlog('读完这一篇就停'); } if (action === 'fs-own-sph') syncChannels(); if (action === 'fs-own-run') run(); if (action === 'fs-own-stop') { S.stop = true; log('收到，读完这一条就停'); } }
  function attach(root) {
    if (!S.info && CFG().key) refresh();
    if (!T.names && CFG().key) campLoad();
    root.addEventListener('change', e => { const t = e.target; const k = t.dataset && t.dataset.own; if (k === 'batch') S.batch = +t.value || 100; if (k === 'per' || k === 'minLike' || k === 'days') R[k] = +t.value; if (k === 'camp') T.cur = t.value; });
    root.addEventListener('input', e => { const t = e.target; if (t.dataset && t.dataset.own === 'kw') R.kw = t.value; });
  }
  window.OwnLib = { view, act, attach, _s: S };
})();
