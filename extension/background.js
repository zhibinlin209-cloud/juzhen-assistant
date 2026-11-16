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

// ---------- 后台常驻：定时任务（美团管家 / 经营宝 / 推广通 / 自动补数据）都跑在侧边栏页面里，侧边栏关了就停。
// 这里每 5 分钟看一眼：既没有打开的侧边栏、也没有后台页，就开一个最小化的小窗口跑同一个页面（?auto=1），保证早上 6 点照常抓数据。
const PANEL = chrome.runtime.getURL('sidepanel.html');
async function keepAlive() {
  try {
    if (!chrome.runtime.getContexts) return;
    const ctx = await chrome.runtime.getContexts({});
    const panels = ctx.filter(c => (c.documentUrl || '').startsWith(PANEL));
    const side = panels.filter(c => c.contextType === 'SIDE_PANEL'), bg = panels.filter(c => c.contextType === 'TAB');
    if (side.length && bg.length) { for (const c of bg) { try { await chrome.tabs.remove(c.tabId); } catch (e) { } } return; } // 侧边栏开着：关掉后台页，免得跑两遍
    if (!side.length && bg.length > 1) { for (const c of bg.slice(1)) { try { await chrome.tabs.remove(c.tabId); } catch (e) { } } return; }
    if (!side.length && !bg.length) await chrome.windows.create({ url: PANEL + '?auto=1', state: 'minimized', type: 'normal', focused: false });
  } catch (e) { }
}
chrome.alarms.create('rm-keepalive', { periodInMinutes: 5, delayInMinutes: 1 });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'rm-keepalive') keepAlive(); });
chrome.runtime.onStartup.addListener(() => setTimeout(keepAlive, 20000));
chrome.runtime.onInstalled.addListener(() => setTimeout(keepAlive, 20000));
