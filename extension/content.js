/* 运行在小红书 / 抖音页面里：读取当前笔记或视频的数据、把文案填进发布页 */
(function () {
  'use strict';
  if (window.__rmContentLoaded) return;
  window.__rmContentLoaded = true;

  let lastEditable = null;
  document.addEventListener('focusin', e => {
    const el = e.target;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA)$/.test(el.tagName))) lastEditable = el;
  }, true);

  const $ = (s, scope) => (scope || document).querySelector(s);
  const $$ = (s, scope) => Array.from((scope || document).querySelectorAll(s));
  const txt = (s, scope) => { const el = $(s, scope); return el ? (el.innerText || el.textContent || '').trim() : ''; };
  const firstTxt = (sels, scope) => { for (const s of sels) { const t = txt(s, scope); if (t) return t; } return ''; };
  const tagsFrom = s => Array.from(new Set((String(s || '').match(/#([^\s#\[]+)/g) || []).map(t => t.slice(1))));
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

  // ---------- 小红书 ----------
  function xhsState() {
    try {
      const sc = $$('script').find(s => (s.textContent || '').includes('__INITIAL_STATE__'));
      if (!sc) return null;
      const raw = sc.textContent.slice(sc.textContent.indexOf('=') + 1).trim().replace(/;?\s*$/, '');
      return JSON.parse(raw.replace(/\bundefined\b/g, 'null'));
    } catch (e) { return null; }
  }
  function readXhs() {
    const scope = $('#noteContainer') || $('.note-container') || document;
    let d = {
      platform: 'xhs',
      title: firstTxt(['#detail-title', '.note-content .title'], scope),
      desc: firstTxt(['#detail-desc', '.note-content .desc'], scope),
      author: firstTxt(['.author-wrapper .username', '.author .name', '.author-container .username', '.info .name'], scope),
      publishedText: firstTxt(['.note-content .date', '.bottom-container .date'], scope),
      tags: $$('a.tag, a#hash-tag', scope).map(a => a.innerText.replace(/^#/, '').trim()).filter(Boolean)
    };
    const bar = $('.interact-container', scope) || $('.engage-bar-container', scope) || $('.engage-bar', scope) || scope;
    d.likes = txt('.like-wrapper .count', bar) || null;
    d.collects = txt('.collect-wrapper .count', bar) || null;
    d.comments = txt('.chat-wrapper .count', bar) || null;
    d.shares = txt('.share-wrapper .count', bar) || null;

    // 直接打开的笔记页：页面自带的初始数据更准
    const st = xhsState();
    const map = st && st.note && st.note.noteDetailMap;
    if (map) {
      const idFromUrl = (location.pathname.match(/\/(?:explore|discovery\/item|item)\/([0-9a-f]+)/) || [])[1];
      const entry = (idFromUrl && map[idFromUrl]) || Object.values(map)[0];
      const n = entry && entry.note;
      if (n && (!idFromUrl || n.noteId === idFromUrl || !d.title)) {
        const ii = n.interactInfo || {};
        d.title = d.title || n.title || '';
        d.desc = d.desc || (n.desc || '').replace(/#([^#\[]+)\[话题\]#/g, '#$1');
        d.tags = d.tags.length ? d.tags : (n.tagList || []).map(t => t.name).filter(Boolean);
        d.author = d.author || (n.user && n.user.nickname) || '';
        d.likes = d.likes || ii.likedCount || null;
        d.collects = d.collects || ii.collectedCount || null;
        d.comments = d.comments || ii.commentCount || null;
        d.shares = d.shares || ii.shareCount || null;
        if (!d.publishedText && n.time) d.publishedText = new Date(n.time).toLocaleString('zh-CN');
        d.source = 'ssr';
      }
    }
    // 没数时页面显示"赞""收藏"等字样
    ['likes', 'collects', 'comments', 'shares'].forEach(k => { if (d[k] && !/\d/.test(d[k])) d[k] = '0'; });
    if (!d.tags.length) d.tags = tagsFrom(d.desc);
    return d;
  }

  // ---------- 抖音 ----------
  function findDeep(obj, test, depth) {
    if (!obj || typeof obj !== 'object' || depth > 12) return null;
    if (test(obj)) return obj;
    for (const k of Object.keys(obj)) { const r = findDeep(obj[k], test, (depth || 0) + 1); if (r) return r; }
    return null;
  }
  function readDouyin() {
    const d = { platform: 'douyin', tags: [] };
    const vid = (location.pathname.match(/\/(?:video|note)\/(\d+)/) || [])[1] || new URLSearchParams(location.search).get('modal_id');
    try {
      const rd = document.getElementById('RENDER_DATA');
      if (rd) {
        const j = JSON.parse(decodeURIComponent(rd.textContent));
        const isAweme = o => typeof o.desc === 'string' && (o.stats || o.statistics);
        const aw = (vid && findDeep(j, o => isAweme(o) && String(o.awemeId || o.aweme_id || '') === vid, 0)) || findDeep(j, isAweme, 0);
        if (aw) {
          const s = aw.stats || aw.statistics || {};
          d.desc = aw.desc;
          d.likes = s.diggCount ?? s.digg_count ?? null;
          d.comments = s.commentCount ?? s.comment_count ?? null;
          d.collects = s.collectCount ?? s.collect_count ?? null;
          d.shares = s.shareCount ?? s.share_count ?? null;
          d.views = s.playCount ?? s.play_count ?? null;
          d.author = (aw.authorInfo && aw.authorInfo.nickname) || (aw.author && aw.author.nickname) || '';
          d.tags = (aw.textExtra || aw.text_extra || []).map(t => t.hashtagName || t.hashtag_name).filter(Boolean);
          const ct = aw.createTime || aw.create_time; if (ct) d.publishedText = new Date(ct * 1000).toLocaleString('zh-CN');
          d.source = 'ssr';
        }
      }
    } catch (e) { /* 页面结构变了，走下面的页面读取 */ }

    const scope = $('[data-e2e="feed-active-video"]') || $('[data-e2e="detail-video-info"]')?.closest('div[class]')?.parentElement || document;
    const descDom = firstTxt(['[data-e2e="detail-video-info"] h1', '[data-e2e="video-desc"]', '[data-e2e="note-desc"]', 'h1'], scope);
    if (!d.desc && descDom) d.desc = descDom;
    const num = sel => { const el = $(sel, scope) || $(sel); return el ? (el.innerText || '').trim().split('\n').find(x => /\d/.test(x)) || null : null; };
    d.likes = d.likes ?? num('[data-e2e="video-player-digg"]');
    d.comments = d.comments ?? num('[data-e2e="feed-comment-icon"]');
    d.collects = d.collects ?? num('[data-e2e="video-player-collect"]');
    d.shares = d.shares ?? num('[data-e2e="video-player-share"]');
    d.author = d.author || firstTxt(['[data-e2e="video-author-title"]', '[data-e2e="feed-video-nickname"]', '[data-e2e="user-info"] h1'], scope);
    if (!d.desc) d.desc = (document.title || '').replace(/\s*-\s*抖音\s*$/, '');
    if (!d.tags.length) d.tags = tagsFrom(d.desc);
    d.title = String(d.desc || '').split('\n')[0].replace(/#[^\s#]+/g, '').trim().slice(0, 40);
    return d;
  }

  function read() {
    const host = location.hostname;
    const d = /xiaohongshu\.com$/.test(host) ? readXhs() : /douyin\.com$/.test(host) ? readDouyin() : null;
    if (!d) return { ok: false, error: '这个页面不是小红书或抖音' };
    d.url = location.href;
    if (!d.title && !d.desc) return { ok: false, error: '没找到笔记或视频内容。请打开单篇笔记/视频详情再读取' };
    return { ok: true, data: d };
  }
  window.__rmRead = read; // 给 collector.js（同一个扩展脚本环境）复用

  // ---------- 填入 ----------
  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function setEditable(el, text) {
    el.focus();
    const sel = window.getSelection(); const range = document.createRange();
    range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range);
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok || !(el.innerText || '').trim()) {
      el.innerHTML = '';
      text.split('\n').forEach(line => { const p = document.createElement('p'); p.textContent = line || '​'; el.appendChild(p); });
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    return true;
  }
  function findTitleInput() {
    return $$('input, textarea').filter(visible).find(el => /标题/.test(el.placeholder || '') || /title/i.test(el.className || ''));
  }
  function findBodyEditor(titleEl) {
    const cands = $$('[contenteditable="true"], textarea').filter(el => visible(el) && el !== titleEl);
    const scored = cands.map(el => {
      const ph = (el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || el.getAttribute('aria-placeholder') || '') + ' ' + (el.className || '');
      const r = el.getBoundingClientRect();
      return { el, score: (/正文|描述|简介|作品|desc|editor|ql-editor/i.test(ph) ? 100000 : 0) + r.width * r.height };
    }).sort((a, b) => b.score - a.score);
    return scored[0] && scored[0].el;
  }
  function fill(p) {
    const titleEl = findTitleInput();
    const bodyEl = findBodyEditor(titleEl);
    const done = [];
    if (titleEl) { setNativeValue(titleEl, p.title); done.push('标题'); }
    if (bodyEl) {
      if (bodyEl.tagName === 'TEXTAREA') setNativeValue(bodyEl, p.body); else setEditable(bodyEl, p.body);
      done.push('正文');
    }
    if (!done.length) return { ok: false, msg: '没找到发布页的输入框' };
    return { ok: true, msg: '已填入' + done.join('和') + '。话题是纯文字，需要的话在编辑框里重新选一下' };
  }

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    try {
      if (msg.type === 'rm:read') reply(read());
      else if (msg.type === 'rm:fill') reply(fill(msg.payload));
      else if (msg.type === 'rm:insert') {
        const el = lastEditable && document.contains(lastEditable) ? lastEditable : null;
        if (!el) reply({ ok: false, msg: '先在页面里点一下要填的输入框' });
        else { if (el.isContentEditable) { el.focus(); document.execCommand('insertText', false, msg.text); } else setNativeValue(el, (el.value || '') + msg.text); reply({ ok: true }); }
      }
    } catch (e) { reply({ ok: false, error: e.message }); }
    return false;
  });
})();
