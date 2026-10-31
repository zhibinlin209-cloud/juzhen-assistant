/* 网页版环境：优先用团队共享数据库，没有就存在本浏览器 */
(function () {
  'use strict';
  const LS = 'rm_state_v1';
  const COLLS = window.StoreUtil.COLLS;

  function localBackend(notice) {
    const read = () => { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { return null; } };
    const write = st => { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) { /* 无痕模式等 */ } };
    return { mode: 'local', notice, load: async () => read(), putItem: async (c, i, st) => write(st), removeItem: async (c, id, st) => write(st), saveSettings: async (s, st) => write(st) };
  }

  function dbBackend(db) {
    const strip = o => JSON.parse(JSON.stringify(o));
    return {
      mode: 'db',
      async load() {
        const st = {};
        await Promise.all(COLLS.map(async c => { const q = await db.collection(c).get(); st[c] = q.docs.map(d => Object.assign({}, d.data(), { id: d.id })); }));
        const s = await db.doc('settings/main').get();
        st.settings = s.exists ? strip(s.data()) : null;
        return st;
      },
      putItem: (c, item) => db.collection(c).doc(item.id).set(strip(item)),
      removeItem: (c, id) => db.collection(c).doc(id).delete(),
      saveSettings: s => db.doc('settings/main').set(strip(Object.assign({}, s, { id: 'main' }))),
      subscribe(store, changed) {
        let ready = 0;
        COLLS.forEach(c => db.collection(c).onSnapshot(q => {
          store.state[c] = q.docs.map(d => Object.assign({}, strip(d.data()), { id: d.id }));
          if (ready >= COLLS.length) changed(); else ready++;
        }, e => console.error(e)));
        db.doc('settings/main').onSnapshot(d => { if (d.exists && !d.metadata.hasPendingWrites) { store.state.settings = strip(d.data()); changed(); } }, e => console.error(e));
      }
    };
  }

  let downloads = null;
  // Store 先给一个占位，init 时再决定用哪种后端
  const pending = { onRemote: null };
  window.Store = {
    state: null, mode: 'local', notice: '', set onRemote(fn) { pending.onRemote = fn; if (this._s) this._s.onRemote = fn; }, get onRemote() { return pending.onRemote; },
    async init() {
      let db = null;
      try { db = window.claude && window.claude.use ? await window.claude.use('db') : null; } catch (e) { db = null; }
      try { downloads = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { downloads = null; }
      const backend = db ? dbBackend(db) : localBackend('现在是离线模式：数据只存在这个浏览器里。登录 Claude 打开这个页面，就能和团队共用模板和数据。');
      const s = window.makeStore(backend);
      s.onRemote = pending.onRemote; this._s = s;
      await s.init();
      ['put', 'remove', 'saveSettings', 'importMerge'].forEach(k => { this[k] = s[k]; });
      Object.defineProperty(this, 'state', { get: () => s.state, configurable: true });
      this.mode = s.mode; this.notice = s.notice;
      return s.state;
    }
  };

  window.Env = {
    canRead: false,
    canFill: false,
    saveNote: '',
    async copy(text) {
      try { await navigator.clipboard.writeText(text); return true; } catch (e) {
        const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
        let ok = false; try { ok = document.execCommand('copy'); } catch (er) { ok = false; } ta.remove(); return ok;
      }
    },
    async download(name, text, mime) {
      if (downloads) {
        try { await downloads.save({ filename: name, data: new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' }) }); return; } catch (e) { if (e && (e.code === 'declined' || e.code === 'rate_limited')) return; }
      }
      const ok = await this.copy(text);
      const t = document.createElement('div'); t.className = 'toast'; t.textContent = ok ? '这里不能直接下载，内容已复制，粘贴到文本文件里保存' : '这里不能下载，也没能复制'; document.body.appendChild(t); setTimeout(() => t.remove(), 3500);
    }
  };
})();
