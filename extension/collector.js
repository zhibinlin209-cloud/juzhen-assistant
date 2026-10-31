/* 自动采集：在小红书/抖音的搜索页收集帖子列表，在帖子页读取正文和评论
 * 两种来源一起用：① 页面从平台拿到的数据（hook.js 转交，最可靠）② 页面上显示的内容（备用）
 * 只读取页面已经显示/拿到的内容，按正常浏览速度慢慢滚动。
 */
(function () {
  'use strict';
  if (window.__rmCollectorLoaded) return;
  window.__rmCollectorLoaded = true;

  const $ = (s, sc) => (sc || document).querySelector(s);
  const $$ = (s, sc) => Array.from((sc || document).querySelectorAll(s));
  const txt = (s, sc) => { const el = $(s, sc); return el ? (el.innerText || el.textContent || '').trim() : ''; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const isXhs = () => /xiaohongshu\.com$/.test(location.hostname);
  const visible = el => { if (!el) return false; const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
  const toNum = v => { if (v === null || v === undefined || v === '') return null; if (typeof v === 'number') return v; const s = String(v).replace(/,/g, '').trim(); const m = s.match(/([\d.]+)\s*(万|w|W|千|k|K)?/); if (!m) return /^(赞|收藏|评论|点赞|分享)$/.test(s) ? 0 : null; let n = parseFloat(m[1]); if (/万|w/i.test(m[2] || '')) n *= 1e4; else if (/千|k/i.test(m[2] || '')) n *= 1e3; return Math.round(n); };
  const fmtTime = (t, ip) => { if (!t) return ip || ''; const ms = t > 1e12 ? t : t * 1000; const d = new Date(ms); if (isNaN(d)) return ip || ''; return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}${ip ? ' ' + ip : ''}`; };

  // ---------- 发布时间 ----------
  /** "3天前""昨天""10-25""2024-05-03""2024年5月3日" → 毫秒；认不出返回 null */
  function parseTime(t) {
    if (!t) return null; const s = String(t); const now = Date.now(); const D1 = 864e5;
    let m;
    if (/刚刚/.test(s)) return now;
    if ((m = s.match(/(\d+)\s*分钟前/))) return now - m[1] * 6e4;
    if ((m = s.match(/(\d+)\s*小时前/))) return now - m[1] * 36e5;
    if (/前天/.test(s)) return now - 2 * D1;
    if (/昨天/.test(s)) return now - D1;
    if ((m = s.match(/(\d+)\s*天前/))) return now - m[1] * D1;
    if ((m = s.match(/(\d+)\s*周前/))) return now - m[1] * 7 * D1;
    if ((m = s.match(/(\d+)\s*个?月前/))) return now - m[1] * 30 * D1;
    if ((m = s.match(/(\d+)\s*年前/))) return now - m[1] * 365 * D1;
    if ((m = s.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/))) return new Date(+m[1], m[2] - 1, +m[3]).getTime();
    if ((m = s.match(/(20\d{2})[-/.年](\d{1,2})月?/))) return new Date(+m[1], m[2] - 1, 1).getTime();
    if ((m = s.match(/(?:^|\D)(\d{1,2})[-/月](\d{1,2})日?(?:\D|$)/))) { const y = new Date().getFullYear(); let d = new Date(y, m[1] - 1, +m[2]).getTime(); if (d > now + D1) d = new Date(y - 1, m[1] - 1, +m[2]).getTime(); return d; }
    return null;
  }
  /** 帖子编号里自带的发布时间（小红书编号前 8 位、抖音编号高 32 位都是时间戳） */
  function idTime(id) {
    try {
      let t = null;
      if (/^[0-9a-f]{24}$/.test(id)) t = parseInt(id.slice(0, 8), 16) * 1000;
      else if (/^\d{17,20}$/.test(id)) t = Number(BigInt(id) >> 32n) * 1000;
      return t && t > 1.4e12 && t < Date.now() + 864e5 ? t : null;
    } catch (e) { return null; }
  }
  const ms = t => (!t ? null : t > 1e12 ? t : t * 1000);

  // ---------- 页面数据（来自 hook.js） ----------
  const D = { comments: {}, more: {}, search: new Map(), detail: {}, seenUrls: [] };
  function addComment(id, c) {
    if (!id || !c || !c.text) return;
    const m = D.comments[id] || (D.comments[id] = new Map());
    const k = c.cid || (c.name + '|' + c.text);
    if (!m.has(k)) m.set(k, c);
  }
  function qp(url, k) { try { return new URL(url, location.origin).searchParams.get(k); } catch (e) { return null; } }
  function onData(url, body) {
    let j; try { j = JSON.parse(body); } catch (e) { return; }
    D.seenUrls.push(url.replace(/\?.*$/, '').slice(-60));
    if (D.seenUrls.length > 40) D.seenUrls.shift();
    // 小红书评论
    if (/\/api\/sns\/web\/v\d+\/comment\/(sub\/)?page/.test(url)) {
      const noteId = qp(url, 'note_id'); const data = j.data || {}; const rootId = qp(url, 'root_comment_id');
      (data.comments || []).forEach(c => {
        if (rootId) { addComment(noteId, { cid: c.id, name: (c.user_info || {}).nickname || '', text: c.content || '', likes: toNum(c.like_count) || 0, date: fmtTime(c.create_time, c.ip_location), ts: ms(c.create_time), reply: true, parent: rootId, author: (c.show_tags || []).includes('is_author') }); return; }
        addComment(noteId, { cid: c.id, name: (c.user_info || {}).nickname || '', text: c.content || '', likes: toNum(c.like_count) || 0, date: fmtTime(c.create_time, c.ip_location), ts: ms(c.create_time), author: (c.show_tags || []).includes('is_author') });
        (c.sub_comments || []).forEach(s => addComment(noteId, { cid: s.id, name: (s.user_info || {}).nickname || '', text: s.content || '', likes: toNum(s.like_count) || 0, date: fmtTime(s.create_time, s.ip_location), ts: ms(s.create_time), reply: true, parent: c.id, author: (s.show_tags || []).includes('is_author') }));
      });
      if (!/sub/.test(url)) D.more[noteId] = data.has_more !== false;
      return;
    }
    // 抖音评论
    if (/\/aweme\/v\d+\/web\/comment\/list/.test(url)) {
      const aid = qp(url, 'aweme_id') || qp(url, 'item_id');
      (j.comments || []).forEach(c => {
        addComment(aid, { cid: c.cid, name: (c.user || {}).nickname || '', text: c.text || '', likes: toNum(c.digg_count) || 0, date: fmtTime(c.create_time, c.ip_label), ts: ms(c.create_time), reply: !!(c.reply_id && c.reply_id !== '0'), parent: c.reply_id && c.reply_id !== '0' ? c.reply_id : '', author: /作者/.test(c.label_text || '') });
        (c.reply_comment || []).forEach(s => addComment(aid, { cid: s.cid, name: (s.user || {}).nickname || '', text: s.text || '', likes: toNum(s.digg_count) || 0, date: fmtTime(s.create_time, s.ip_label), ts: ms(s.create_time), reply: true, parent: c.cid, author: /作者/.test(s.label_text || '') }));
      });
      if (!/reply/.test(url)) D.more[aid] = !!j.has_more;
      return;
    }
    // 小红书搜索结果
    if (/\/api\/sns\/web\/v\d+\/search\/notes/.test(url)) {
      ((j.data || {}).items || []).forEach(it => {
        const n = it.note_card || {}; if (!it.id || (it.model_type && it.model_type !== 'note')) return;
        const ii = n.interact_info || {};
        const tag = (n.corner_tag_info || []).find(t => /time/.test(t.type || '')) || {};
        D.search.set(it.id, { id: it.id, type: n.type === 'video' ? 'video' : 'note', time: parseTime(tag.text) || ms(n.time) || null, token: it.xsec_token || '', title: n.display_title || n.title || '', author: (n.user || {}).nickname || (n.user || {}).nick_name || '',
          likes: toNum(ii.liked_count), comments: toNum(ii.comment_count), collects: toNum(ii.collected_count), shares: toNum(ii.shared_count),
          cover: (n.cover || {}).url_default || (n.cover || {}).url || (((n.cover || {}).info_list || [])[0] || {}).url || '', authorId: (n.user || {}).user_id || '' });
      });
      return;
    }
    // 抖音搜索结果
    if (/\/aweme\/v\d+\/web\/(general\/search|search\/item)/.test(url)) {
      const arr = [].concat(j.data || [], j.aweme_list || []);
      arr.forEach(x => {
        const a = x.aweme_info || x; if (!a || !a.aweme_id) return; const s = a.statistics || {};
        const isNote = a.aweme_type === 68 || (a.images && a.images.length);
        D.search.set(String(a.aweme_id), { id: String(a.aweme_id), time: ms(a.create_time), kind: isNote ? 'note' : 'video', type: isNote ? 'note' : 'video', poi: (a.poi_info || {}).poi_name || '', title: (a.desc || '').slice(0, 80), author: (a.author || {}).nickname || '',
          likes: toNum(s.digg_count), comments: toNum(s.comment_count), collects: toNum(s.collect_count), shares: toNum(s.share_count),
          cover: ((((a.video || {}).cover || {}).url_list) || [])[0] || ((((a.images || [])[0] || {}).url_list) || [])[0] || '', authorId: (a.author || {}).sec_uid || '', fans: toNum((a.author || {}).follower_count) });
      });
      return;
    }
    // 小红书帖子详情
    if (/\/api\/sns\/web\/v\d+\/feed/.test(url)) {
      ((j.data || {}).items || []).forEach(it => {
        const n = it.note_card || {}; const ii = n.interact_info || {};
        D.detail[it.id || n.note_id] = { type: n.type === 'video' ? 'video' : 'note', title: n.title || '', desc: (n.desc || '').replace(/#([^#\[]+)\[话题\]#/g, '#$1'), author: (n.user || {}).nickname || '', tags: (n.tag_list || []).map(t => t.name).filter(Boolean),
          likes: toNum(ii.liked_count), collects: toNum(ii.collected_count), comments: toNum(ii.comment_count), shares: toNum(ii.share_count), publishedText: n.time ? fmtTime(n.time, n.ip_location) : '', time: ms(n.time),
          images: (n.image_list || []).slice(0, 9).map(x => x.url_default || x.url || '').filter(Boolean), authorId: (n.user || {}).user_id || '' };
      });
      return;
    }
    // 抖音帖子详情
    if (/\/aweme\/v\d+\/web\/aweme\/detail/.test(url)) {
      const a = j.aweme_detail; if (!a) return; const s = a.statistics || {};
      D.detail[String(a.aweme_id)] = { type: a.aweme_type === 68 || (a.images && a.images.length) ? 'note' : 'video', poi: (a.poi_info || {}).poi_name || '', title: (a.desc || '').split('\n')[0].replace(/#[^\s#]+/g, '').trim().slice(0, 40), desc: a.desc || '', author: (a.author || {}).nickname || '',
        tags: (a.text_extra || []).map(t => t.hashtag_name).filter(Boolean), likes: toNum(s.digg_count), collects: toNum(s.collect_count), comments: toNum(s.comment_count), shares: toNum(s.share_count), publishedText: fmtTime(a.create_time), time: ms(a.create_time),
        fans: toNum((a.author || {}).follower_count), cover: ((((a.video || {}).cover || {}).url_list) || [])[0] || '', images: (a.images || []).slice(0, 9).map(x => (x.url_list || [])[0]).filter(Boolean), duration: a.duration || ((a.video || {}).duration) || null };
    }
  }
  window.addEventListener('message', e => { if (e.source === window && e.data && e.data.__rmData) onData(e.data.url, e.data.body); });
  window.postMessage({ __rmReplay: true }, location.origin); // 取回插件启动前页面已经拿到的数据

  // ---------- 拦截检测：验证码 / 登录 / 频率限制 ----------
  function blocked() {
    const url = location.href;
    const bodyText = (document.body && document.body.innerText || '').slice(0, 3000);
    if (/captcha|verify|website-login\/error/i.test(url)) return '平台要求安全验证';
    const capSel = ['#captcha_container', '.captcha_verify_container', '.captcha-verify-container', '[id^="captcha"]', 'iframe[src*="captcha"]', '.red-captcha', '#red-captcha'];
    if (capSel.some(s => visible($(s)))) return '平台要求安全验证（滑块/点选）';
    if (/请完成下列验证|拖动下方滑块|安全验证|访问频次异常|请求太频繁|操作太频繁|安全限制/.test(bodyText)) return '平台提示访问太频繁或需要验证';
    if (isXhs()) { const login = $('.login-container') || $('.login-modal'); if (visible(login)) return '需要先登录小红书'; }
    else { const login = $('#login-pannel') || $('#login-panel-new') || $('[class*="login-mask"]'); if (visible(login)) return '需要先登录抖音'; }
    return null;
  }

  // ---------- 搜索结果列表 ----------
  function scrollParent(el) {
    let p = el && el.parentElement;
    while (p && p !== document.body) { const st = getComputedStyle(p); if (/(auto|scroll)/.test(st.overflowY) && p.scrollHeight > p.clientHeight + 20) return p; p = p.parentElement; }
    return document.scrollingElement;
  }
  function numLine(lines) { return lines.find(l => /^\d+(\.\d+)?\s*(万|w|W)?\+?$/.test(l.trim())) || ''; }
  function xhsDomItems(seen) {
    $$('section.note-item').forEach(sec => {
      const a = $$('a', sec).find(x => /\/(explore|search_result|discovery\/item)\/[0-9a-f]{24}/.test(x.getAttribute('href') || ''));
      if (!a) return;
      const href = a.getAttribute('href'); const id = href.match(/\/([0-9a-f]{24})/)[1];
      if (seen.has(id)) return;
      const u = new URL(href, location.origin);
      const img = $('img', sec);
      seen.set(id, { id, cover: img ? (img.currentSrc || img.src || '') : '', time: parseTime(txt('.footer .time', sec) || txt('.time', sec) || txt('.date', sec)), token: u.searchParams.get('xsec_token') || '', title: txt('.footer .title', sec) || txt('.title', sec), author: txt('.author .name', sec) || txt('.name', sec), likes: toNum(txt('.like-wrapper .count', sec) || txt('.count', sec)) });
    });
  }
  function douyinDomItems(seen) {
    $$('a[href*="/video/"], a[href*="/note/"]').forEach(a => {
      const m = (a.getAttribute('href') || '').match(/\/(video|note)\/(\d{10,})/); if (!m) return;
      const id = m[2]; if (seen.has(id)) return;
      const card = a.closest('li') || a.closest('[class*="card"]') || a;
      const lines = (card.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
      const title = lines.filter(l => !/^\d+(\.\d+)?(万|w)?$/.test(l) && !/^@/.test(l) && !/^\d{1,2}:\d{2}$/.test(l) && !/(前|\d{4}年|\d+月\d+日)$/.test(l)).sort((x, y) => y.length - x.length)[0] || '';
      const tl = lines.find(l => parseTime(l) && l.length < 16);
      seen.set(id, { id, kind: m[1], time: tl ? parseTime(tl) : null, title: title.slice(0, 80), author: (lines.find(l => /^@/.test(l)) || '').replace(/^@/, ''), likes: toNum(numLine(lines)) });
    });
  }
  function mergeList(seen) {
    // 页面数据里的计数更准，有就覆盖
    D.search.forEach((v, id) => { const o = seen.get(id) || {}; seen.set(id, Object.assign({}, o, Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== undefined && x !== '')))); });
    const xhs = isXhs();
    return Array.from(seen.values()).map(x => Object.assign(x, { time: x.time || idTime(x.id) }, {
      url: xhs ? `https://www.xiaohongshu.com/explore/${x.id}?${new URLSearchParams(Object.assign(x.token ? { xsec_token: x.token } : {}, { xsec_source: 'pc_search' })).toString()}`
        : `https://www.douyin.com/${x.kind === 'note' ? 'note' : 'video'}/${x.id}`
    }));
  }
  async function collectList(want) {
    const xhs = isXhs(); const seen = new Map(); let stall = 0;
    while (stall < 5) {
      const before = seen.size + D.search.size;
      (xhs ? xhsDomItems : douyinDomItems)(seen);
      const total = new Set([...seen.keys(), ...D.search.keys()]).size;
      if (total >= want) break;
      if (seen.size + D.search.size === before) stall++; else stall = 0;
      if (blocked()) break;
      const sl = !xhs && $('[data-e2e="scroll-list"]') ? scrollParent($('[data-e2e="scroll-list"]')) : null;
      if (sl && sl !== document.scrollingElement) sl.scrollBy({ top: innerHeight * rand(0.7, 1.0) }); else window.scrollBy({ top: innerHeight * rand(0.7, 1.0) });
      await sleep(rand(1400, 2600));
    }
    return mergeList(seen).slice(0, want);
  }

  // ---------- 帖子页：正文 + 评论 ----------
  async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(300); } return false; }
  function xhsDomComments() {
    return $$('.comment-item, [class*="comment-item"]').map(it => ({
      name: txt('.author .name', it) || txt('.name', it), text: txt('.content .note-text', it) || txt('.note-text', it) || txt('.content', it),
      likes: toNum(txt('.like .count', it)) || 0, date: txt('.date', it) || txt('.info .date', it), reply: !!it.closest('.reply-container')
    })).filter(c => c.text);
  }
  const DY_SKIP = /^(回复|分享|作者|置顶|展开|收起|赞|举报|\.\.\.|…|作者赞过|朋友)$|^展开\d+条回复|^\d+(分钟|小时|天|周|个月|年)前|^\d{1,2}-\d{1,2}|^\d{4}-\d{1,2}|^(昨天|前天)|·/;
  const DY_JUNK = /大家都在搜|相关搜索|查看更多|点击查看|下载抖音|打开App/;
  function douyinDomComments() {
    return $$('[data-e2e="comment-item"]').map(it => {
      const clone = it.cloneNode(true);
      clone.querySelectorAll('a[href*="/search/"], [data-e2e*="search"]').forEach(n => n.remove());
      const lines = (clone.innerText || it.innerText || '').split('\n').map(s => s.trim()).filter(Boolean).filter(l => !DY_JUNK.test(l));
      const name = lines[0] || '';
      const rest = lines.slice(1).filter(l => !DY_SKIP.test(l) && !/^\d+(\.\d+)?(万|w)?$/.test(l));
      return { name, text: rest.sort((a, b) => b.length - a.length)[0] || '', likes: toNum([...lines].reverse().find(l => /^\d+(\.\d+)?(万|w)?$/.test(l))) || 0, date: lines.find(l => /(前|\d{1,2}-\d{1,2}|\d{4}-)/.test(l) && l.length < 30) || '', reply: false };
    }).filter(c => c.text && c.text !== c.name);
  }
  function postId() {
    const m = location.pathname.match(/\/(?:explore|discovery\/item|item|video|note)\/([0-9a-z]+)/i);
    return m ? m[1] : (new URLSearchParams(location.search).get('modal_id') || '');
  }
  function apiComments(id) { return id && D.comments[id] ? Array.from(D.comments[id].values()) : []; }
  function bothComments(id) { const a = apiComments(id); const d = (isXhs() ? xhsDomComments : douyinDomComments)(); return a.length >= d.length ? { list: a, src: 'api', a: a.length, d: d.length } : { list: d, src: 'dom', a: a.length, d: d.length }; }
  function isScrollable(el) { if (!el || el === document.body) return false; const st = getComputedStyle(el); return /(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 20; }
  /** 找真正装着评论的那个可滚动区域：先按已知结构，再按已读到的评论文字反查 */
  function commentScroller(xhs, id) {
    const known = xhs ? ($('.note-scroller') || $('.interaction-container')) : ($('[data-e2e="comment-list"]') || $('[data-e2e="comment-item"]'));
    if (known) { const s = isScrollable(known) ? known : scrollParent(known); if (s && s !== document.scrollingElement) return s; }
    const sample = apiComments(id).slice(-3).map(c => String(c.text).slice(0, 12)).filter(t => t.length >= 4);
    for (const t of sample) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node; while ((node = walker.nextNode())) {
        if (node.nodeValue && node.nodeValue.includes(t)) { const s = scrollParent(node.parentElement); if (s && s !== document.scrollingElement) return s; break; }
      }
    }
    return document.scrollingElement;
  }
  function classSample() {
    const s = new Set(); $$('[class*="comment"], [data-e2e*="comment"]').slice(0, 200).forEach(el => { (el.getAttribute('data-e2e') ? ['e2e:' + el.getAttribute('data-e2e')] : []).concat(String(el.className || '').split(/\s+/).filter(c => /comment/i.test(c))).forEach(c => s.add(c)); });
    return Array.from(s).slice(0, 30);
  }

  async function readPost(maxComments) {
    const xhs = isXhs();
    await waitFor(() => xhs ? ($('#detail-title') || $('#detail-desc') || $('.note-content') || /无法浏览|不存在|已删除/.test(document.body.innerText)) : ($('[data-e2e="detail-video-info"]') || $('[data-e2e="comment-list"]') || $('#RENDER_DATA') || Object.keys(D.detail).length), 10000);
    const b = blocked(); if (b) return { ok: false, blocked: b };
    if (xhs && /笔记不存在|无法浏览|已被删除|内容已删除/.test((document.body.innerText || '').slice(0, 2000)) && !$('#detail-title')) return { ok: false, error: '笔记已删除或无法查看' };
    const id = postId();
    const base = window.__rmRead ? window.__rmRead() : { ok: false };
    const post = Object.assign({ url: location.href }, base.ok ? base.data : {});
    if (!post.time) post.time = parseTime(post.publishedText) || idTime(id) || null;
    const det = D.detail[id]; if (det) Object.entries(det).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) post[k] = v; });

    if (!maxComments) return { ok: true, post, comments: [], blocked: blocked(), diag: { id } };
    // 等第一页评论；抖音如果没自动展开评论区，点一下评论按钮
    await waitFor(() => bothComments(id).list.length > 0 || D.more[id] === false || /暂无评论|还没有评论|评论区已关闭/.test(document.body.innerText.slice(-3000)), 6000);
    if (!xhs && !bothComments(id).list.length) {
      const btn = $('[data-e2e="feed-comment-icon"]') || $('[data-e2e="video-player-comment"]') || $$('span,div').find(el => /^评论\(?\d*\)?$/.test((el.innerText || '').trim()) && visible(el));
      if (btn) { btn.click(); await waitFor(() => bothComments(id).list.length > 0, 5000); }
    }

    // 滚动评论区，直到够数、没有更多或不再增加
    let stall = 0, last = 0;
    for (let round = 0; round < 45; round++) {
      const n = bothComments(id).list.length;
      if (n >= maxComments || D.more[id] === false) break;
      if (xhs && visible($('.end-container'))) break;
      if (n === last) { stall++; if (stall >= 4) break; } else stall = 0;
      last = n;
      const sc = commentScroller(xhs, id);
      sc.scrollBy({ top: rand(500, 900) });
      if (sc !== document.scrollingElement) window.scrollBy({ top: 200 });
      await sleep(rand(1000, 1800));
      if (blocked()) break;
    }
    const got = bothComments(id);
    const seen = new Set();
    const comments = got.list.filter(c => { const k = c.name + '|' + c.text; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, maxComments)
      .map(c => ({ cid: c.cid || '', parent: c.parent || '', author: !!c.author, name: c.name, text: c.text, likes: c.likes, date: c.date, ts: c.ts || parseTime(c.date) || null, reply: !!c.reply }));
    const diag = { id, src: got.src, api: got.a, dom: got.d, shown: toNum(post.comments), urls: D.seenUrls.slice(-12), classes: comments.length ? [] : classSample(), href: location.href.slice(0, 120) };
    return { ok: true, post, comments, blocked: blocked(), diag };
  }

  // ---------- 评论区维护：找到某条评论，点"回复"，把草稿填进输入框（不会点发送） ----------
  const normT = s => String(s || '').replace(/\[[^\]]{1,8}\]/g, '').replace(/[\s\u00a0]/g, '');
  function findCommentEl(text) {
    const key = normT(text).slice(0, 16); if (!key) return null;
    const cands = $$('.comment-item, .comment-inner-container, .parent-comment, [data-e2e="comment-item"], [class*="comment-item"], [class*="CommentItem"], div, li').filter(el => {
      const t = normT(el.innerText); return t.includes(key) && t.length < key.length + 400 && visible(el);
    });
    cands.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
    // 往上找到包含"回复"按钮的那一层
    for (const el of cands) { let c = el; for (let k = 0; c && k < 6; k++) { const btn = replyBtnIn(c, key); if (btn) return { item: c, btn }; c = c.parentElement; } }
    return cands[0] ? { item: cands[0], btn: null } : null;
  }
  function replyBtnIn(c, key) {
    const btns = $$('span, div, button, a', c).filter(x => /^回复(\s*\d*)?$/.test((x.innerText || '').trim()) && visible(x));
    if (!btns.length) return null;
    // 只取属于这条评论本身的（不是下面别人楼中楼的回复按钮）：离评论文字最近的那个
    const own = btns.find(b => { let p = b.parentElement; for (let k = 0; p && p !== c && k < 5; k++) { if (normT(p.innerText).includes(key)) return true; p = p.parentElement; } return false; });
    return own || btns[0];
  }
  function activeInput() {
    const a = document.activeElement;
    if (a && (a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) return a;
    return [$('#content-textarea'), $('.content-input'), $('[contenteditable="true"].public-DraftEditor-content'), $('.public-DraftEditor-content'), $('[data-e2e="comment-input"] [contenteditable="true"]'), ...$$('[contenteditable="true"]'), ...$$('textarea')].find(x => x && visible(x)) || null;
  }
  async function replyTo(m) {
    const xhs = isXhs();
    await waitFor(() => $$('.comment-item, [data-e2e="comment-item"], [class*="comment"]').length > 0 || blocked(), 10000);
    const b = blocked(); if (b) return { ok: false, error: b };
    if (!xhs && !$('[data-e2e="comment-list"]')) { const btn = $('[data-e2e="feed-comment-icon"]') || $('[data-e2e="video-player-comment"]'); if (btn) { btn.click(); await sleep(1500); } }
    let hit = null;
    for (let i = 0; i < 25 && !(hit = findCommentEl(m.text)); i++) {
      const sc = commentScroller(xhs, postId()); sc.scrollBy({ top: 600 }); if (sc !== document.scrollingElement) window.scrollBy({ top: 150 });
      await sleep(rand(700, 1200));
    }
    if (!hit) return { ok: false, error: '在页面上没找到这条评论（可能被折叠或已删除）。可以复制回复内容，手动回复。' };
    hit.item.scrollIntoView({ block: 'center' }); hit.item.style.outline = '2px solid #e8590c'; hit.item.style.outlineOffset = '2px';
    await sleep(500);
    if (!hit.btn) return { ok: false, error: '找到了评论，但没找到"回复"按钮。评论已用橙框标出，请手动点回复。' };
    hit.btn.click(); await sleep(900);
    const inp = activeInput();
    if (!inp) return { ok: false, error: '点了回复，但没找到输入框。评论已用橙框标出。' };
    inp.focus();
    if (inp.isContentEditable) document.execCommand('insertText', false, m.draft);
    else { const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inp), 'value').set; setter.call(inp, (inp.value || '') + m.draft); inp.dispatchEvent(new Event('input', { bubbles: true })); }
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg.type === 'rm:replyTo') { replyTo(msg).then(reply).catch(e => reply({ ok: false, error: e.message })); return true; }
    if (msg.type === 'rm:status') { reply({ ok: true, blocked: blocked(), url: location.href, ready: document.readyState }); return false; }
    if (msg.type === 'rm:collectList') {
      (async () => {
        await waitFor(() => (isXhs() ? $('section.note-item') : $('a[href*="/video/"], a[href*="/note/"]')) || D.search.size || blocked(), 12000);
        const b = blocked(); if (b) return reply({ ok: false, blocked: b });
        const list = await collectList(msg.limit);
        reply({ ok: true, list, blocked: blocked(), apiItems: D.search.size });
      })().catch(e => reply({ ok: false, error: e.message }));
      return true;
    }
    if (msg.type === 'rm:readPost') {
      readPost(msg.maxComments === 0 ? 0 : (msg.maxComments || 30)).then(reply).catch(e => reply({ ok: false, error: e.message }));
      return true;
    }
    return false;
  });
})();
