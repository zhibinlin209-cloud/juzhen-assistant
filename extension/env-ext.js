/* 扩展环境：chrome.storage 保存，读取/填入当前标签页 */
(function () {
  'use strict';
  const KEY = 'rm_state_v1';
  let timer = null, waiting = [];
  function persist(state) {
    clearTimeout(timer);
    return new Promise(res => {
      waiting.push(res);
      timer = setTimeout(() => { const done = waiting; waiting = []; chrome.storage.local.set({ [KEY]: state }, () => done.forEach(f => f())); }, 150);
    });
  }
  window.Store = window.makeStore({
    mode: 'ext',
    load: () => new Promise(res => chrome.storage.local.get(KEY, o => res(o[KEY] || null))),
    putItem: (c, item, st) => persist(st),
    removeItem: (c, id, st) => persist(st),
    saveSettings: (s, st) => persist(st)
  });

  const HOSTS = /(^|\.)(xiaohongshu\.com|douyin\.com)$/;
  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab;
  }
  async function send(msg) {
    const tab = await activeTab();
    if (!tab || !tab.url) throw new Error('没有找到当前标签页');
    let host = '';
    try { host = new URL(tab.url).hostname; } catch (e) { /* ignore */ }
    if (!HOSTS.test(host)) throw new Error('请先切到小红书或抖音的页面');
    try {
      return await chrome.tabs.sendMessage(tab.id, msg);
    } catch (e) {
      // 页面在装扩展之前就打开了：补注入一次再试
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      return await chrome.tabs.sendMessage(tab.id, msg);
    }
  }

  let aiCfg = null;
  window.Env = {
    aiLoad: () => new Promise(r => chrome.storage.local.get('rm_ai', o => { aiCfg = Object.assign({ provider: 'deepseek', key: '', model: '' }, o.rm_ai || {}); r(aiCfg); })),
    aiConfig: () => aiCfg,
    aiReady: () => !!(aiCfg && aiCfg.key),
    aiSave: cfg => new Promise(r => { aiCfg = Object.assign({ provider: 'deepseek', key: '', model: '' }, cfg || {}); chrome.storage.local.set({ rm_ai: aiCfg }, r); }),
    canRead: true,
    canFill: true,
    saveNote: '扩展的数据保存在这台电脑的浏览器里。要和同事共用，导出后在网页版导入。',
    async copy(text) {
      try { await navigator.clipboard.writeText(text); return true; } catch (e) {
        const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy'); ta.remove(); return ok;
      }
    },
    async readPage() {
      const r = await send({ type: 'rm:read' });
      if (!r || !r.ok) throw new Error((r && r.error) || '没读到内容，等页面加载完再试');
      return r.data;
    },
    async fill(payload) {
      try {
        const r = await send({ type: 'rm:fill', payload });
        if (r && r.ok) return { msg: r.msg };
        await this.copy(payload.title + '\n\n' + payload.body);
        return { msg: (r && r.msg ? r.msg + '，' : '') + '已复制全文，请在发布框里粘贴' };
      } catch (e) {
        await this.copy(payload.title + '\n\n' + payload.body);
        return { msg: e.message + '（已复制全文）' };
      }
    },
    async download(name, text, mime) {
      const url = URL.createObjectURL(new Blob([text], { type: typeof text === 'string' ? (mime || 'text/plain') + ';charset=utf-8' : (mime || 'application/octet-stream') }));
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  };
})();
