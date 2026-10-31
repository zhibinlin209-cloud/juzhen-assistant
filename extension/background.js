// 点击工具栏图标时打开侧边栏
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// 大众点评的"加密字"样式表在 meituan 的静态服务器上，页面脚本跨域读不到，由这里代取（只允许这两个域名）
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== 'rm:fetchText') return false;
  let u; try { u = new URL(msg.url); } catch (e) { reply({ ok: false }); return false; }
  if (u.protocol !== 'https:' || !/(^|\.)(meituan\.net|dianping\.com)$/.test(u.hostname)) { reply({ ok: false }); return false; }
  fetch(u.href, { credentials: 'omit' }).then(r => r.text()).then(text => reply({ ok: true, text: text.slice(0, 2e6) })).catch(() => reply({ ok: false }));
  return true;
});
