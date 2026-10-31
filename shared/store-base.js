/* 存储层：内存状态 + 后端（chrome.storage / 团队数据库 / localStorage） */
(function (root) {
  'use strict';
  const COLLS = ['templates', 'accounts', 'records', 'snapshots'];

  function normalize(st) {
    const C = root.Core; const def = C.defaultState();
    COLLS.forEach(c => { if (!Array.isArray(st[c])) st[c] = []; });
    st.settings = st.settings || def.settings;
    st.settings.rules = st.settings.rules || def.settings.rules;
    ['xhs', 'douyin'].forEach(p => { st.settings.rules[p] = Object.assign({}, def.settings.rules[p], st.settings.rules[p] || {}); });
    st.settings.batchVars = st.settings.batchVars || {};
    return st;
  }
  function plain(o) { return JSON.parse(JSON.stringify(o)); }

  root.makeStore = function (backend) {
    const store = {
      state: null, mode: backend.mode, notice: backend.notice || '', onRemote: null,
      async init() {
        let st = await backend.load();
        st = normalize(root.Core.migrateState(st || root.Core.defaultState()));
        store.state = st;
        if (backend.subscribe) backend.subscribe(store, () => { normalize(store.state); store.onRemote && store.onRemote(); });
        return st;
      },
      async put(coll, item) {
        item = plain(item);
        const arr = store.state[coll]; const i = arr.findIndex(x => x.id === item.id);
        if (i >= 0) arr[i] = item; else arr.push(item);
        try { await backend.putItem(coll, item, store.state); } catch (e) { report(e); }
      },
      async remove(coll, id) {
        store.state[coll] = store.state[coll].filter(x => x.id !== id);
        try { await backend.removeItem(coll, id, store.state); } catch (e) { report(e); }
      },
      async saveSettings(s) {
        store.state.settings = plain(s);
        try { await backend.saveSettings(store.state.settings, store.state); } catch (e) { report(e); }
      },
      async importMerge(data) {
        let n = 0;
        for (const c of COLLS) {
          for (const item of (data[c] || [])) { if (item && item.id) { await store.put(c, item); n++; } }
        }
        if (data.settings && data.settings.rules) { await store.saveSettings(Object.assign({}, store.state.settings, { rules: data.settings.rules })); }
        return n;
      }
    };
    function report(e) {
      console.error(e);
      const msg = e && e.code === 'quota_exceeded' ? '团队库已满，请导出备份后删掉旧的参考或记录' : (e && e.code === 'permission_denied' || e && e.code === 'not_granted') ? '你只有查看权限，改动没有保存到团队库' : '保存失败：' + ((e && e.message) || '网络问题，稍后再试');
      const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3500);
    }
    return store;
  };
  root.StoreUtil = { COLLS, normalize, plain };
})(window);
