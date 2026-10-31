/* 运行在小红书/抖音页面自己的环境里（MAIN world，页面加载最开始）
 * 页面向平台服务器要评论、搜索结果、帖子详情时，把返回的数据复制一份交给插件。
 * 不发起任何额外请求，只读取页面本来就会拿到的数据。
 */
(function () {
  'use strict';
  if (window.__rmHook) return;
  window.__rmHook = true;
  const WANT = /\/api\/sns\/web\/v\d+\/(comment\/page|comment\/sub\/page|search\/notes|feed)|\/aweme\/v\d+\/web\/(comment\/list|general\/search|search\/item|aweme\/detail)/;
  // 先存一份：插件脚本晚于页面请求启动时，可以要求重放
  const buf = [];
  const post = m => { try { window.postMessage(m, location.origin); } catch (e) { /* 忽略 */ } };
  const send = (url, body) => {
    if (!body || body.length > 4e6) return;
    const m = { __rmData: true, url: String(url), body };
    buf.push(m); if (buf.length > 300) buf.shift();
    post(m);
  };
  window.addEventListener('message', e => { if (e.source === window && e.data && e.data.__rmReplay) buf.forEach(post); });
  const nativeStr = name => `function ${name}() { [native code] }`;

  const ofetch = window.fetch;
  if (ofetch) {
    const f = function () {
      const p = ofetch.apply(this, arguments);
      try {
        const a = arguments[0]; const url = typeof a === 'string' ? a : (a && a.url) || String(a);
        if (WANT.test(url)) p.then(r => { try { r.clone().text().then(t => send(url, t)).catch(() => {}); } catch (e) { /* 忽略 */ } }).catch(() => {});
      } catch (e) { /* 忽略 */ }
      return p;
    };
    Object.defineProperty(f, 'toString', { value: () => nativeStr('fetch') });
    Object.defineProperty(f, 'name', { value: 'fetch' });
    window.fetch = f;
  }

  const XP = XMLHttpRequest.prototype; const oopen = XP.open, osend = XP.send;
  XP.open = function (m, u) { try { this.__rmUrl = String(u); } catch (e) { /* 忽略 */ } return oopen.apply(this, arguments); };
  XP.send = function () {
    try {
      if (this.__rmUrl && WANT.test(this.__rmUrl)) {
        this.addEventListener('load', () => {
          try {
            const rt = this.responseType;
            const t = rt === '' || rt === 'text' ? this.responseText : rt === 'json' ? JSON.stringify(this.response) : null;
            if (t) send(this.responseURL || this.__rmUrl, t);
          } catch (e) { /* 忽略 */ }
        });
      }
    } catch (e) { /* 忽略 */ }
    return osend.apply(this, arguments);
  };
  Object.defineProperty(XP.open, 'toString', { value: () => nativeStr('open') });
  Object.defineProperty(XP.send, 'toString', { value: () => nativeStr('send') });
})();
