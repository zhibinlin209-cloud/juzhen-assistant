/* 「门店评价调研」：指定门店 → 抓这家店大众点评近一年的评价（或导入商家后台导出的评价表）
 * → 数据概览（星级/分项分/月度/喜欢的菜）→ AI 按《顾客评价调研模块》模板逐条打标、统计、写结论 → 导出同格式 Excel
 * 依赖：Core, Industries, Pipeline(report/pipeline.js), AI, XlsxLite, Env
 */
(function () {
  'use strict';
  const C = window.Core, I = window.Industries, P = window.Pipeline;
  const h = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const br = v => h(v).replace(/\n/g, '<br>');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => Math.round(a + Math.random() * (b - a));
  const get = k => new Promise(r => chrome.storage.local.get(k, o => r(o[k])));
  const set = (k, v) => new Promise(r => chrome.storage.local.set({ [k]: v }, r));
  const del = k => new Promise(r => chrome.storage.local.remove(k, r));
  const toast = m => window.__rmToast && window.__rmToast(m);
  const render = () => { if (window.__rmIsEditing && window.__rmIsEditing()) return; window.__rmRender && window.__rmRender(); };
  const IDX = 'rm_store_index', RUN = id => 'rm_store_' + id;
  const DP_CITY = { 上海: 1, 北京: 2, 杭州: 3, 广州: 4, 南京: 5, 苏州: 6, 深圳: 7, 成都: 8, 重庆: 9, 天津: 10, 宁波: 11, 无锡: 13, 福州: 14, 厦门: 15, 武汉: 16, 西安: 17, 沈阳: 18, 大连: 19, 青岛: 21, 济南: 22, 郑州: 160, 长沙: 344, 佛山: 208, 东莞: 219, 珠海: 206, 合肥: 110, 昆明: 267 };
  const rangeName = d => ({ 90: '近 3 个月', 180: '近半年', 365: '近一年', 730: '近两年' })[d] || (d ? `近 ${d} 天` : '全部');

  const R = {
    index: [], open: null, cur: 0, view: 'home', confirmDel: false,
    form: { src: 'dp', stores: '', city: '', range: 365, max: 1000, menu: '' },
    pick: null, job: null, ai: null, file: null
  };

  async function load() { R.index = (await get(IDX)) || []; const f = await get('rm_store_form'); if (f) Object.assign(R.form, f); }
  async function save(run) {
    await set(RUN(run.id), run);
    const meta = { id: run.id, title: run.title, createdAt: run.createdAt, stores: run.stores.map(s => s.name), reviews: run.stores.reduce((a, s) => a + s.reviews.length, 0), analyzed: run.stores.filter(s => s.analysis).length };
    const i = R.index.findIndex(x => x.id === run.id); if (i >= 0) R.index[i] = meta; else R.index.unshift(meta);
    await set(IDX, R.index);
  }
  async function openRun(id) { R.open = await get(RUN(id)); R.cur = 0; R.view = 'report'; R.confirmDel = false; R.ai = null; render(); window.scrollTo(0, 0); }

  // ---------- 浏览器窗口 ----------
  function waitLoad(tabId, ms) { return new Promise(resolve => { const t0 = Date.now(); (function poll() { chrome.tabs.get(tabId, tab => { if (chrome.runtime.lastError || !tab) return resolve(false); if (tab.status === 'complete' || Date.now() - t0 > (ms || 25000)) return resolve(true); setTimeout(poll, 500); }); })(); }); }
  async function msg(tabId, m, timeout) {
    const send = () => Promise.race([chrome.tabs.sendMessage(tabId, m), sleep(timeout || 120000).then(() => ({ ok: false, error: '页面没有响应' }))]);
    try { return await send(); } catch (e) {
      try { await chrome.scripting.executeScript({ target: { tabId }, files: ['dianping.js'] }); } catch (er) { throw new Error('采集窗口被关闭或页面打不开'); }
      await sleep(800); return await send();
    }
  }
  async function ensureWindow(url) {
    const j = R.job;
    if (j.windowId) { try { await chrome.tabs.update(j.tabId, { url }); await waitLoad(j.tabId); await sleep(rand(2000, 3500)); return; } catch (e) { j.windowId = null; } }
    const win = await chrome.windows.create({ url, focused: true, width: 1200, height: 860, type: 'normal' });
    j.windowId = win.id; j.tabId = win.tabs[0].id; await waitLoad(j.tabId); await sleep(rand(2500, 4000));
  }
  function log(t) { const j = R.job; if (!j) return; j.log.unshift(new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '  ' + t); j.log = j.log.slice(0, 60); render(); }
  async function waitIfPaused() { while (R.job && R.job.paused && !R.job.stop) await sleep(500); }
  async function blockedPause(reason) {
    const j = R.job; j.paused = true; j.blocked = reason; log('暂停：' + reason + '。请在采集窗口里处理后点"继续"');
    try { await chrome.windows.update(j.windowId, { focused: true }); } catch (e) { /* 窗口已关 */ }
    render(); await waitIfPaused(); j.blocked = null;
  }
  async function closeWindow() { try { if (R.job && R.job.windowId) await chrome.windows.remove(R.job.windowId); } catch (e) { /* 已关 */ } }

  // ---------- 第 1 步：查找门店 ----------
  const shopIdOf = s => { const m = String(s || '').match(/dianping\.com\/shop\/([A-Za-z0-9]+)/); return m ? m[1] : ''; };
  function parseLines() { return R.form.stores.split(/\n+/).map(x => x.trim()).filter(Boolean).slice(0, 8); }
  async function cityId() {
    const id = DP_CITY[(R.form.city || '').replace(/市$/, '')];
    if (id) return id;
    await ensureWindow('https://www.dianping.com/');
    const r = await msg(R.job.tabId, { type: 'rm:status' }, 20000).catch(() => null);
    if (r && r.blocked) await blockedPause(r.blocked);
    log(R.form.city ? `没认出「${R.form.city}」，用点评网站当前选择的城市` : '没填城市，用点评网站当前选择的城市');
    return (r && r.cityId) || 1;
  }
  const norm = s => String(s || '').toLowerCase().replace(/[\s·・()（）【】\[\]\-_|｜,，。]/g, '');
  function matchScore(q, c) { const a = norm(q), b = norm(c.title); let s = 0; for (const w of String(q).split(/\s+/)) if (w && b.includes(norm(w))) s += norm(w).length; if (b.includes(a)) s += 5; return s + Math.log10(1 + (c.likes || 0)) * 0.3; }
  async function find() {
    const lines = parseLines(); if (!lines.length) { toast('先填门店：一行一家，可以粘贴大众点评店铺链接，或写"品牌 分店"'); return; }
    await set('rm_store_form', R.form);
    R.job = { kind: 'find', running: true, paused: false, stop: false, log: [], windowId: null, tabId: null, phase: '查找门店' }; render();
    const pick = { lines: [] };
    try {
      let cid = null;
      for (const q of lines) {
        if (R.job.stop) break;
        const id = shopIdOf(q);
        if (id) { pick.lines.push({ q, cands: [{ id, title: '', url: q, fromUrl: true }], sel: [id] }); continue; }
        if (cid === null) cid = await cityId();
        R.job.phase = `查找「${q}」`; log(`搜索「${q}」`);
        await ensureWindow(`https://www.dianping.com/search/keyword/${cid}/0_${encodeURIComponent(q)}`);
        let res;
        for (let t = 0; t < 3; t++) { res = await msg(R.job.tabId, { type: 'rm:collectList', limit: 12 }, 120000); if (res && res.blocked && !(res.list || []).length) { await blockedPause(res.blocked); if (R.job.stop) break; await chrome.tabs.reload(R.job.tabId); await waitLoad(R.job.tabId); await sleep(2500); continue; } break; }
        const cands = ((res && res.list) || []).map(c => Object.assign(c, { score: matchScore(q, c) })).sort((a, b) => b.score - a.score).slice(0, 8);
        pick.lines.push({ q, cands, sel: cands[0] ? [cands[0].id] : [] });
        log(`「${q}」找到 ${cands.length} 家候选`);
        await sleep(rand(2000, 4000));
      }
    } catch (e) { log('出错：' + e.message); toast(e.message); }
    R.job.running = false;
    if (pick.lines.some(l => l.cands.length)) { R.pick = pick; R.view = 'pick'; R.job.keepWindow = true; }
    render();
  }

  // ---------- 第 2 步：抓评价 ----------
  function selectedStores() {
    const out = [];
    (R.pick ? R.pick.lines : []).forEach(l => l.sel.forEach(id => { const c = l.cands.find(x => x.id === id); if (c && !out.some(o => o.shopId === id)) out.push({ shopId: id, name: c.title || '', addr: [c.area, c.addr].filter(Boolean).join(' '), price: c.price || null, cat: c.cat || '', listDishes: c.dishes || [], query: l.q }); }));
    return out;
  }
  async function crawl() {
    const stores = selectedStores(); if (!stores.length) { toast('至少勾选一家门店'); return; }
    const f = R.form; const cutoff = +f.range ? Date.now() - +f.range * 864e5 : 0; const max = +f.max || 1000;
    const run = { id: C.uid('st'), createdAt: new Date().toISOString(), industry: (window.Store && Store.state.settings.industry) || 'food', range: +f.range, max, source: '大众点评', city: f.city,
      title: stores.map(s => s.name || s.query).join(' vs ').slice(0, 60), stores: stores.map(s => Object.assign(s, { url: `https://www.dianping.com/shop/${s.shopId}/review_all`, reviews: [], pages: 0, stopReason: '' })) };
    const keep = R.job && R.job.windowId ? { windowId: R.job.windowId, tabId: R.job.tabId } : {};
    R.job = Object.assign({ kind: 'crawl', running: true, paused: false, stop: false, log: [], phase: '准备', run, i: 0 }, keep);
    R.view = 'home'; R.pick = null; render();
    try {
      for (let si = 0; si < run.stores.length; si++) {
        if (R.job.stop) break;
        const st = run.stores[si]; R.job.i = si;
        R.job.phase = `第 ${si + 1}/${run.stores.length} 家：${st.name || st.query}`;
        const seen = new Set(); let page = 0; let r = null; let triedLatest = false;
        // ① 店铺首页：评价总数、点评的评价标签（基于全部评价）、首页显示的几条评价
        log(`打开「${st.name || st.query}」的店铺页`);
        await ensureWindow(`https://www.dianping.com/shop/${st.shopId}`);
        let sp = await msg(R.job.tabId, { type: 'rm:readShop' }, 90000).catch(() => null);
        if (sp && !sp.ok && sp.blocked) { await blockedPause(sp.blocked); sp = await msg(R.job.tabId, { type: 'rm:readShop' }, 90000).catch(() => null); }
        if (sp && sp.ok) {
          if (!st.name && sp.name) st.name = sp.name;
          if (sp.total) st.total = sp.total;
          st.tags = sp.tags || [];
          (sp.reviews || []).forEach(c => { const k = c.text.slice(0, 40); if (seen.has(k)) return; seen.add(k); if (cutoff && c.ts && c.ts < cutoff) return; st.reviews.push(c); });
          if (!(sp.reviews || []).length) st.shopDiag = sp.diag;
          log(`店铺页：共 ${sp.total || '?'} 条评价，评价标签 ${st.tags.length} 个，首页显示 ${(sp.reviews || []).length} 条`);
        }
        R.job.count = st.reviews.length;
        await sleep(rand(2500, 4500));
        // ② 全部评价页（网页版可能被要求去 App 查看）
        log('打开全部评价页');
        await ensureWindow(st.url);
        while (!R.job.stop) {
          await waitIfPaused(); if (R.job.stop) break;
          r = await msg(R.job.tabId, { type: 'rm:readPost', maxComments: 200 }, 120000);
          if (r && !r.ok && r.blocked) { await blockedPause(r.blocked); if (R.job.stop) break; continue; }
          if (!r || !r.ok) { st.stopReason = (r && r.error) || '读取失败'; log('读取失败：' + st.stopReason); break; }
          if (r.appGate) { st.appGate = true; st.stopReason = `大众点评网页版不开放全部评价（要求去 App 查看），只拿到店铺页的 ${st.reviews.length} 条和评价标签`; log(st.stopReason); break; }
          if (!triedLatest && page === 0 && !r.isLatest && r.latest) { triedLatest = true; log('切换为"最新"排序'); await ensureWindow(r.latest); continue; }
          page++; st.pages = page;
          if (!st.name && r.post && r.post.title) st.name = r.post.title;
          if (r.total && !st.total) st.total = r.total;
          let fresh = 0, old = 0;
          (r.comments || []).forEach(c => { const k = c.id || (c.name + '|' + c.text.slice(0, 30)); const k2 = c.text.slice(0, 40); if (seen.has(k) || seen.has(k2)) return; seen.add(k); seen.add(k2); if (cutoff && c.ts && c.ts < cutoff) { old++; return; } if (st.reviews.length < max) { st.reviews.push(c); fresh++; } });
          R.job.count = st.reviews.length;
          log(`${st.name || st.query} 第 ${page} 页：新增 ${fresh} 条，累计 ${st.reviews.length} 条${old ? `（${old} 条早于${rangeName(run.range)}）` : ''}`);
          if (r.blocked) await blockedPause(r.blocked);
          if (st.reviews.length >= max) { st.stopReason = `达到每家上限 ${max} 条`; break; }
          if (cutoff && (r.comments || []).length && old === r.comments.length && (r.isLatest || triedLatest)) { st.stopReason = `已读完${rangeName(run.range)}的评价`; break; }
          if (!fresh && !old) { st.stopReason = '这一页没有新评价'; break; }
          if (!r.next) { st.stopReason = '没有下一页了'; break; }
          if (page >= 150) { st.stopReason = '已翻 150 页'; break; }
          if (page % 3 === 0) await save(run);
          await sleep(rand(3500, 7000)); // 正常翻页节奏
          await ensureWindow(r.next);
        }
        if (R.job.stop && !st.stopReason) st.stopReason = '手动停止';
        log(`「${st.name || st.query}」完成：${st.reviews.length} 条（${st.stopReason}）`);
        if (!st.reviews.length && r && r.diag) st.diag = r.diag;
        await save(run);
        if (si < run.stores.length - 1) await sleep(rand(4000, 8000));
      }
    } catch (e) { log('出错：' + e.message); toast(e.message); }
    await closeWindow();
    R.job.running = false;
    if (run.stores.some(s => s.reviews.length || (s.tags || []).length)) { await save(run); R.job = null; await openRun(run.id); toast(`完成：${run.stores.reduce((a, s) => a + s.reviews.length, 0)} 条评价`); }
    else { await save(run); render(); }
  }

  // ---------- 导入表格 ----------
  async function loadFile(file) {
    try {
      let rows;
      if (/\.xlsx$/i.test(file.name)) { const sh = await window.XlsxLite.read(await file.arrayBuffer()); rows = (sh[0] || {}).rows || []; }
      else rows = P.parseCSV(P.decodeText(new Uint8Array(await file.arrayBuffer())));
      const map = P.guessColumns(rows);
      const fc = re => map.header.findIndex(x => re.test(x || ''));
      map.dish = fc(/推荐菜|喜欢的菜|推荐/); map.price = fc(/人均/); map.label = fc(/评价标签|标签/); map.user = fc(/用户|昵称/);
      R.file = { name: file.name, rows, map, storeName: R.file && R.file.storeName || file.name.replace(/\.(xlsx|csv|txt)$/i, '').replace(/_(最新|差评)_\d{8}_\d{4}$/, '') };
      render();
    } catch (e) { toast('读取失败：' + (e.message || '格式不支持，请用 .xlsx 或 .csv')); }
  }
  function fileReviews() {
    const F = R.file; if (!F) return [];
    const body = F.rows.slice(F.map.headerRow + 1);
    const cutoff = +R.form.range ? Date.now() - +R.form.range * 864e5 : 0;
    const out = [];
    body.forEach((r, k) => {
      if (!r) return; const t = String(r[F.map.text] === null || r[F.map.text] === undefined ? '' : r[F.map.text]).trim(); if (!t) return;
      const d = F.map.date >= 0 ? excelDate(r[F.map.date]) : ''; const ts = parseDate(d);
      if (cutoff && ts && ts < cutoff) return;
      const sv = F.map.star >= 0 ? parseFloat(String(r[F.map.star] || '').replace(/[^\d.]/g, '')) : NaN;
      const cell = i => (i >= 0 && r[i] !== null && r[i] !== undefined ? String(r[i]).trim() : '');
      out.push({ id: 'f' + k, name: cell(F.map.user), label: cell(F.map.label), price: parseFloat(cell(F.map.price)) || null, text: t, likes: F.map.likes >= 0 ? (C.parseCount(r[F.map.likes]) || 0) : 0, date: d, ts, stars: isNaN(sv) ? null : (sv > 5 ? sv / 10 : sv), scores: {}, dishes: cell(F.map.dish) ? cell(F.map.dish).split(/[、,，\s]+/).filter(Boolean) : [], tag: F.map.tag >= 0 ? String(r[F.map.tag] || '') : '' });
    });
    return out;
  }
  function excelDate(v) { if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10); return String(v === null || v === undefined ? '' : v).trim(); }
  function parseDate(s) { const m = String(s || '').match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null; }
  async function importFile() {
    const rv = fileReviews(); if (!rv.length) { toast('没读到评价内容，检查一下"评价内容"列选得对不对'); return; }
    const name = (R.file.storeName || '我的门店').replace(/_(最新|差评)_\d{8}_\d{4}$/, '').trim();
    const run = { id: C.uid('st'), createdAt: new Date().toISOString(), industry: (window.Store && Store.state.settings.industry) || 'food', range: +R.form.range, max: rv.length, source: /_(最新|差评)_\d{8}/.test(R.file.name) ? '大众点评 App（手机采集）' : '导入表格', title: name,
      stores: [{ shopId: '', name, addr: '', reviews: rv, source: 'file', fileName: R.file.name, stopReason: '导入' }] };
    await save(run); R.file = null; await openRun(run.id); toast(`已导入 ${rv.length} 条评价`);
  }

  // ---------- 数据概览（不用 AI） ----------
  function stats(st) {
    const rv = st.reviews; const n = rv.length;
    const avg = arr => { const v = arr.filter(x => typeof x === 'number' && !isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const starList = rv.map(r => r.stars).filter(x => typeof x === 'number');
    const dist = [5, 4, 3, 2, 1].map(k => ({ k, n: starList.filter(s => Math.round(s) === k).length }));
    const sc = {}; rv.forEach(r => Object.entries(r.scores || {}).forEach(([k, v]) => { (sc[k] = sc[k] || []).push(v); }));
    const scores = Object.entries(sc).map(([k, v]) => ({ k, v: avg(v), n: v.length })).sort((a, b) => b.n - a.n).slice(0, 4);
    const months = {}; rv.forEach(r => { if (!r.ts) return; const d = new Date(r.ts); const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; const m = months[key] || (months[key] = { key, n: 0, stars: [] }); m.n++; if (typeof r.stars === 'number') m.stars.push(r.stars); });
    const mon = Object.values(months).sort((a, b) => a.key.localeCompare(b.key)).slice(-13).map(m => ({ key: m.key, n: m.n, star: avg(m.stars) }));
    const dish = {}; rv.forEach(r => (r.dishes || []).forEach(d => { dish[d] = (dish[d] || 0) + 1; }));
    const ts = rv.map(r => r.ts).filter(Boolean).sort();
    return { n, avgStar: avg(starList), starN: starList.length, dist, scores, price: avg(rv.map(r => r.price)), months: mon, dishes: Object.entries(dish).sort((a, b) => b[1] - a[1]).slice(0, 12), low: starList.filter(s => s <= 3).length,
      from: ts.length ? new Date(ts[0]).toLocaleDateString('zh-CN') : '', to: ts.length ? new Date(ts[ts.length - 1]).toLocaleDateString('zh-CN') : '' };
  }

  // ---------- AI：按模板归纳 ----------
  const HEADS = {
    s1: ['产品', '正向细节命中', '顾客真正夸的点', '代表性原话/证据', '可提炼卖点', '拍摄重点'],
    s2: ['产品', '负向细节命中', '具体问题', '代表性原话/证据', '问题本质', '整改重点'],
    s3: ['顾客需求/口碑点', '命中评价数', '顾客具体怎么说', '需求判断', '内容表达', '必须拍到的证据镜头'],
    s4: ['吐槽点', '命中评价数', '具体表现', '归因', '整改动作', '影响级别'],
    s5: ['排序', '核心卖点', '评价证据', '内容母题', '建议镜头', '适合菜品/场景'],
    s6: ['客流维度', '评价命中量', '评价里能明确看到的特征', '代表性证据', '经营判断', '内容/投放启示']
  };
  const TITLES = { s1: '一、顾客明确提及的好评产品', s2: '二、顾客明确提及的差评产品', s3: '三、顾客反复描述的“具体口碑点”——真正可以变成拍摄卖点', s4: '四、顾客反复描述的“具体吐槽点”——需要优先整改', s5: b => `五、${b}评价调研后的“内容拍摄结论”`, s6: n => `六、客流特征分析（基于${n}条评价文本）` };
  const quoteJoin = arr => (arr || []).slice(0, 2).map(q => `“${q}”`).join(' / ');
  const dJoin = arr => (arr || []).slice(0, 4).map(x => x[0]).filter(Boolean).join('；');
  function buildTable(brand, A, W, meta) {
    W = W || {};
    const by = (arr, id) => (arr || []).find(x => x && x.id === id) || {};
    const G = P.goodProducts(A), B = P.badProducts(A);
    const range = meta.range ? `｜区间：${meta.range.from} 至 ${meta.range.to}` : '';
    const segs = A.segments.filter(s => s.count >= 3); const fin = W.final || {};
    return {
      title: `${brand}｜顾客评价调研模块`,
      note: `评价样本：${meta.relevant}条有效（共读取 ${meta.analyzed} 条${meta.total > meta.analyzed ? `，原始去重后 ${meta.total} 条` : ''}）${range}｜来源：${meta.source}｜口径：逐条提取顾客明确描述的产品、具体体验与客流场景；各类命中可交叉，不可直接相加为人数。`,
      s1: G.map(p => { const w = by(W.goodProducts, p.id); return { c: [p.name, p.pos, w.praise || dJoin(p.posD), w.evidence || quoteJoin(p.posQ), w.sell || '', w.shoot || ''], q: p.posQ }; }),
      s2: B.map(p => { const w = by(W.badProducts, p.id); return { c: [p.name, p.neg, w.issue || dJoin(p.negD), w.evidence || quoteJoin(p.negQ), w.essence || '', w.fix || ''], q: p.negQ }; }),
      s3: A.praise.map(x => { const w = by(W.praise, x.id); return { c: [x.name, x.count, w.say || '', w.judge || '', w.express || '', w.shots || ''], q: x.q }; }),
      s4: A.complaints.map(x => { const w = by(W.complaints, x.id); return { c: [x.name, x.count, w.show || quoteJoin(x.q), w.cause || '', w.action || '', w.level || ''], q: x.q }; }),
      s5: (W.content || []).slice(0, 6).map((c, i) => ({ c: [i + 1, c.point || '', c.evidence || '', c.theme || '', c.shots || '', c.fit || ''] })),
      s6: segs.map(x => { const w = by(W.segments, x.id); return { c: [x.name, x.count, w.feature || '', w.evidence || quoteJoin(x.q), w.judge || '', w.insight || ''], q: x.q }; }),
      final: [fin.conclusion || '', fin.support || '', fin.model || '', fin.priority || ''],
      sampleN: meta.relevant
    };
  }
  function itemRows(items, tags, tax) {
    const name = {}; tax.products.forEach(p => { name[p.id] = p.name; }); tax.praise.forEach(p => { name[p.id] = p.name; }); tax.complaints.forEach(p => { name[p.id] = p.name; }); P.SEGMENTS.forEach(s => { name[s.id] = s.name; });
    const nm = id => name[id] || String(id).replace(/^新[:：]/, '');
    return items.map(it => { const t = tags[it.i];
      return [it.i, it.t, it.l || 0, it.d || '', it.star || '', t ? (t.r === 0 ? '无关' : '有效') : '未分析',
        t ? (t.p || []).filter(Array.isArray).map(([id, dir, det]) => `${nm(id)}(${dir === '+' ? '好' : dir === '-' ? '差' : '提及'}${det ? '：' + det : ''})`).join('；') : '',
        t ? (t.g || []).map(nm).join('、') : '', t ? (t.b || []).map(nm).join('、') : '', t ? (t.s || []).map(nm).join('、') : ''];
    });
  }
  async function analyze() {
    const run = R.open, st = run.stores[R.cur]; if (!st) return;
    const cfg = window.Env && Env.aiConfig ? Env.aiConfig() : null;
    if (!cfg || !cfg.key) { R.ai = { error: '还没设置 AI。在「设置」里填一次 API 密钥（推荐 DeepSeek）。' }; render(); return; }
    const raw = st.reviews.map(r => ({ t: String(r.text || '').replace(/\s+/g, ' ').trim(), l: r.likes || 0, d: r.date || '', src: st.source === 'file' ? '评价' : '点评', star: r.stars ? String(r.stars) : '', tag: r.tag || '' }));
    const prep = P.prepare(raw, 3000); const items = prep.items;
    if (items.length < 20) { if ((st.tags || []).length >= 3) return analyzeTags(cfg, run, st); R.ai = { error: '有效评价太少（少于 20 条），先多抓一些，或用「导入评价表格」' }; render(); return; }
    const batches = []; for (let i = 0; i < items.length; i += 60) batches.push(items.slice(i, i + 60));
    const ctl = new AbortController(); const total = batches.length + 2; let done = 0;
    R.ai = { running: true, done, total, ctl, stage: '建立分类（产品/好评点/吐槽点）', store: R.cur }; render();
    const prog = s => { if (R.ai) { R.ai.done = done; R.ai.stage = s || R.ai.stage; render(); } };
    const brand = st.name || st.query || '门店';
    const s = stats(st);
    const menu = [R.form.menu, s.dishes.slice(0, 10).map(x => x[0]).join('、'), (st.listDishes || []).join('、')].filter(Boolean).join('；');
    try {
      const tax = P.validTax(await window.AI.json(cfg, P.taxonomyPrompt(brand, menu, items), ctl.signal, { temperature: 0.2 }));
      if (!tax || !tax.products.length) throw new Error('AI 没能建立分类，请再试一次');
      done++; prog(`逐条打标 0/${batches.length} 批`);
      const tags = {}; let failed = 0; const work = batches.slice(); let fin = 0;
      const worker = async () => {
        while (work.length) {
          const b = work.shift();
          try { Object.assign(tags, P.validTags(await window.AI.json(cfg, P.tagPrompt(brand, tax, b), ctl.signal, { temperature: 0.1 }), b)); }
          catch (e) { if (ctl.signal.aborted) throw e; if (/密钥|余额/.test(e.message)) throw e; failed++; }
          done++; fin++; prog(`逐条打标 ${fin}/${batches.length} 批`);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      const A = P.aggregate(items, tags, tax);
      const meta = { relevant: A.totals.relevant, analyzed: A.totals.tagged, total: prep.total, range: P.dateRange(items), source: st.source === 'file' ? `导入表格（${st.fileName || ''}）` : '大众点评门店评价' };
      prog('写结论（卖点/整改/拍摄建议）');
      let W = null; try { W = await window.AI.json(cfg, P.writePrompt(brand, A, meta), ctl.signal, { temperature: 0.3, maxTokens: 8000 }); } catch (e) { if (ctl.signal.aborted) throw e; W = null; }
      done++;
      st.analysis = { at: new Date().toISOString(), table: buildTable(brand, A, W, meta), rows: itemRows(items, tags, tax), failed, batches: batches.length, writeOk: !!W,
        tops: { praise: A.praise.slice(0, 3).map(x => [x.name, x.count]), complaints: A.complaints.slice(0, 3).map(x => [x.name, x.count]), good: P.goodProducts(A).slice(0, 4).map(p => [p.name, p.pos]), bad: P.badProducts(A).slice(0, 3).map(p => [p.name, p.neg]), relevant: A.totals.relevant } };
      await save(run);
      R.ai = failed || !W ? { error: `${failed ? `有 ${failed}/${batches.length} 批没打标成功，命中数会偏少。` : ''}${!W ? '结论部分没写成功（统计正常），可以重新归纳。' : ''}` } : null;
      toast('评价归纳完成');
    } catch (e) { R.ai = ctl.signal.aborted ? null : { error: e.message || 'AI 调用失败' }; }
    render();
  }

  function tagsPrompt(brand, st, menu) {
    return `你是餐饮品牌的营销与运营顾问。大众点评网页版不开放「${brand}」的全部评价，但店铺页给出了点评基于全部 ${st.total || '若干'} 条评价统计的「评价标签」（标签｜提到的评价数），以及首页显示的几条评价。${menu ? `\n招牌菜/菜单参考：${menu}` : ''}
请据此按我们的《顾客评价调研模块》模板写结论。数字只能用标签里给出的次数；没有数字支撑的写"—"。只根据给出的内容下结论，不编造。

【评价标签】
${st.tags.map(t => `${t.name}｜${t.n}`).join('\n')}

【首页显示的评价】
${st.reviews.slice(0, 20).map((r, i) => `${i + 1}. ${r.stars ? `（${r.stars}星）` : ''}${String(r.text).slice(0, 200)}`).join('\n') || '无'}

只输出 JSON，每个数组里的每一行都是 6 个字符串/数字：
{
 "s1":[["产品","正向命中（用标签次数）","顾客真正夸的点","代表性证据（标签名或评价原话）","可提炼卖点","拍摄重点"]],
 "s2":[["产品","负向命中","具体问题","代表性证据","问题本质","整改重点"]],
 "s3":[["口碑点","命中评价数","顾客具体怎么说","需求判断","内容表达","必须拍到的证据镜头"]],
 "s4":[["吐槽点","命中评价数","具体表现","归因","整改动作","影响级别：严重/中度/轻中度/轻度"]],
 "s5":[["1","核心卖点","评价证据（带数字）","内容母题","建议镜头","适合菜品/场景"]],
 "s6":[["客流维度","评价命中量","评价里能明确看到的特征","代表性证据","经营判断","内容/投放启示"]],
 "final":["客流特征最终结论","由哪些数字支持","核心客流模型（用 → 串起来）","内容优先级与运营必须同步解决的问题"]
}
s5 给 6 条。点评标签大多是正面的，差评产品和吐槽点只写有依据的（可以没有）。`;
  }
  async function analyzeTags(cfg, run, st) {
    const ctl = new AbortController(); R.ai = { running: true, done: 0, total: 1, ctl, stage: '按评价标签归纳' }; render();
    const brand = st.name || st.query || '门店';
    try {
      const W = await window.AI.json(cfg, tagsPrompt(brand, st, R.form.menu), ctl.signal, { temperature: 0.3, maxTokens: 6000 });
      const toRows = arr => (Array.isArray(arr) ? arr : []).filter(Array.isArray).map(c => { c = c.slice(0, 6); while (c.length < 6) c.push(''); const n = parseInt(String(c[1]).replace(/[^\d]/g, ''), 10); if (!isNaN(n) && /^\D*\d+\D*$/.test(String(c[1]))) c[1] = n; return { c: c.map(v => (typeof v === 'number' ? v : String(v === null || v === undefined ? '' : v))) }; });
      const T = { title: `${brand}｜顾客评价调研模块（评价标签版）`, note: `依据：大众点评店铺页的评价标签（点评基于全部 ${st.total || '?'} 条评价统计）+ 首页显示的 ${st.reviews.length} 条评价。网页版不开放全部评价，命中数为标签次数；要逐条归纳请用「导入评价表格」。`,
        s1: toRows(W.s1), s2: toRows(W.s2), s3: toRows(W.s3), s4: toRows(W.s4), s5: toRows(W.s5).map((r, i) => { r.c[0] = i + 1; return r; }), s6: toRows(W.s6), final: Array.isArray(W.final) ? W.final.slice(0, 4).map(String) : ['', '', '', ''], sampleN: st.total || st.reviews.length };
      st.analysis = { at: new Date().toISOString(), table: T, rows: [], tagMode: true, writeOk: true, tops: { praise: T.s3.slice(0, 3).map(r => [r.c[0], r.c[1]]), complaints: T.s4.slice(0, 3).map(r => [r.c[0], r.c[1]]), good: T.s1.slice(0, 4).map(r => [r.c[0], r.c[1]]), bad: T.s2.slice(0, 3).map(r => [r.c[0], r.c[1]]) } };
      await save(run); R.ai = null; toast('已按评价标签归纳');
    } catch (e) { R.ai = ctl.signal.aborted ? null : { error: e.message || 'AI 调用失败' }; }
    render();
  }

  // ---------- 视图 ----------
  function view() {
    if (R.view === 'report' && R.open) return report();
    if (R.view === 'pick' && R.pick) return pickView();
    return home();
  }
  function home() {
    const f = R.form; const busy = R.job && R.job.running; const dis = busy ? 'disabled' : '';
    const F = R.file;
    return `<div class="section-h" style="margin-top:0"><h2>门店评价调研</h2><span class="hint">指定门店，抓近一年的全部评价，按你们的评价调研模板归纳</span></div>
    <div class="panel stack">
      <div class="chips" role="group" aria-label="评价来源">${[['dp', '抓大众点评门店评价'], ['file', '导入评价表格（商家后台导出）']].map(([k, l]) => `<button class="chip" data-action="rv-src" data-v="${k}" aria-pressed="${f.src === k}" ${dis}>${l}</button>`).join('')}</div>
      ${f.src === 'dp' ? `
        <label class="f"><span>门店（一行一家，最多 8 家）：粘贴大众点评店铺链接最准；也可以写"品牌 分店"，下一步让你确认是哪一家</span><textarea id="rv-stores" data-rv="stores" rows="4" placeholder="如：\nhttps://www.dianping.com/shop/H1aBcD2eF\n小炳胜 天河店\n陶陶居 第十甫店" ${dis}>${h(f.stores)}</textarea></label>
        <div class="grid3">
          <label class="f"><span>城市（写品牌名时用）</span><input type="text" id="rv-city" data-rv="city" value="${h(f.city)}" placeholder="如：广州" ${dis}></label>
          <label class="f"><span>评价时间</span><select id="rv-range" data-rv="range" ${dis}>${[[90, '近 3 个月'], [180, '近半年'], [365, '近一年'], [730, '近两年'], [0, '全部']].map(([k, l]) => `<option value="${k}" ${+f.range === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="f"><span>每家最多</span><select id="rv-max" data-rv="max" ${dis}>${[300, 500, 1000, 2000, 5000].map(n => `<option value="${n}" ${+f.max === n ? 'selected' : ''}>${n} 条</option>`).join('')}</select></label>
        </div>
        <div class="row"><button class="btn primary" data-action="rv-find" ${dis}>下一步：确认门店</button><span class="hint">会按"最新"排序一页页往下翻，读到时间范围之外就停。每页约 3–7 秒，1000 条约 8–15 分钟。</span></div>
        <span class="hint">先在这个浏览器里登录大众点评（不登录看不到全部评价）。遇到验证会自动暂停，完成后点"继续"。一天别抓太多家，避免账号被限制。</span>`
      : `
        <label class="f"><span>评价表格（.xlsx / .csv，如美团/点评商家后台导出的评价）</span><input type="file" id="rv-file" accept=".xlsx,.csv,.txt" ${dis}></label>
        ${F ? `<div class="grid2"><label class="f"><span>门店名称</span><input type="text" id="rv-fname" data-rvf="storeName" value="${h(F.storeName)}"></label>
          <label class="f"><span>评价时间</span><select id="rv-range" data-rv="range">${[[90, '近 3 个月'], [180, '近半年'], [365, '近一年'], [730, '近两年'], [0, '全部']].map(([k, l]) => `<option value="${k}" ${+f.range === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
          <div class="grid3">${[['text', '评价内容列'], ['date', '日期列'], ['star', '星级/评分列']].map(([k, l]) => `<label class="f"><span>${l}</span><select data-rvmap="${k}">${k !== 'text' ? '<option value="-1">（没有）</option>' : ''}${F.map.header.map((x, i) => `<option value="${i}" ${F.map[k] === i ? 'selected' : ''}>${h(x)}</option>`).join('')}</select></label>`).join('')}</div>
          <div class="row"><button class="btn primary" data-action="rv-import">导入 ${fileReviews().length} 条评价</button><span class="hint">${h(F.name)} · 共 ${F.map.count} 行${+f.range ? `，按${rangeName(+f.range)}筛选后` : ''}</span></div>
          <div class="hint">预览：${fileReviews().slice(0, 2).map(r => `“${h(r.text.slice(0, 40))}”`).join(' ')}</div>` : '<span class="hint">自己门店建议用这个：商家后台导出的评价最全、最准。</span>'}`}
      <label class="f"><span>招牌菜/菜单（可选，帮 AI 认准菜名）</span><input type="text" id="rv-menu" data-rv="menu" value="${h(f.menu)}" placeholder="如：爆膏奶油虾、椒盐濑尿虾、生蚝" ${dis}></label>
    </div>
    ${jobView()}
    ${history()}`;
  }
  function jobView() {
    const j = R.job; if (!j) return '';
    const run = j.run;
    return `<div class="section-h"><h2>${j.running ? (j.kind === 'find' ? '正在查找门店' : '正在抓取评价') : '已结束'}</h2></div>
    <div class="panel stack">
      ${j.blocked ? `<div class="banner">${h(j.blocked)}。请切到采集窗口完成验证或登录，然后点"继续"。</div>` : ''}
      <div class="row"><b>${h(j.phase || '')}</b><span class="hint grow">${run ? `第 ${j.i + 1}/${run.stores.length} 家 · 本店 ${j.count || 0} 条` : ''}</span>
        ${j.running ? (j.paused ? `<button class="btn primary sm" data-action="rv-resume">继续</button>` : `<button class="btn sm" data-action="rv-pause">暂停</button>`) + `<button class="btn sm danger" data-action="rv-stop">${j.kind === 'crawl' ? '停止并保存' : '停止'}</button>` : `<button class="btn sm" data-action="rv-clear">关闭</button>`}</div>
      ${run ? `<div class="bar"><i style="width:${Math.min(100, Math.round((j.count || 0) / (run.max || 1000) * 100))}%"></i></div>` : ''}
      <pre class="small-pre">${h(j.log.join('\n'))}</pre>
    </div>`;
  }
  function history() {
    if (!R.index.length) return '';
    return `<div class="section-h"><h2>门店评价报告</h2><span class="hint">${R.index.length} 份</span></div>
    <div class="list">${R.index.map(r => `<div class="item" data-action="rv-open" data-id="${h(r.id)}"><span class="pf dp">点评</span><span class="t">${h(r.title)}</span><span class="m">${r.reviews} 条评价${r.analyzed ? ` · 已归纳 ${r.analyzed} 家` : ''} · ${new Date(r.createdAt).toLocaleDateString('zh-CN')}</span></div>`).join('')}</div>`;
  }
  function pickView() {
    const pk = R.pick;
    return `<div class="section-h" style="margin-top:0"><button class="btn ghost sm" data-action="rv-back">← 返回</button><h2>确认门店</h2><span class="hint">勾选要抓评价的门店（同一行可以勾多家分店）</span></div>
    <div class="stack">${pk.lines.map((l, li) => `<div class="panel stack" style="gap:6px"><b>${h(l.q)}</b>
      ${l.cands.length ? l.cands.map(c => `<label class="item" style="cursor:pointer;gap:8px;align-items:flex-start"><input type="checkbox" data-action="rv-sel" data-li="${li}" data-id="${h(c.id)}" ${l.sel.includes(c.id) ? 'checked' : ''}>
        <div class="grow" style="min-width:0">${c.fromUrl ? `<b>店铺链接</b> <span class="hint">${h(c.id)}</span>` : `<b>${h(c.title)}</b><div class="hint">${[c.cat, c.area, c.addr, c.price ? '人均￥' + c.price : '', c.likes ? c.likes + ' 条评价' : ''].filter(Boolean).map(h).join(' · ')}</div>${(c.dishes || []).length ? `<div class="hint">推荐菜：${h(c.dishes.join('、'))}</div>` : ''}`}</div></label>`).join('') : '<span class="hint">没搜到，换个写法（如只写品牌名）或直接粘贴店铺链接</span>'}
    </div>`).join('')}</div>
    <div class="row" style="margin-top:10px"><button class="btn primary" data-action="rv-crawl">开始抓取 ${selectedStores().length} 家门店的评价</button><span class="hint">${rangeName(+R.form.range)} · 每家最多 ${R.form.max} 条</span></div>`;
  }

  function report() {
    const run = R.open; const st = run.stores[R.cur] || run.stores[0]; const S = stats(st); const an = st.analysis; const aj = R.ai;
    const multi = run.stores.length > 1;
    const maxM = Math.max(1, ...S.months.map(m => m.n)); const maxD = Math.max(1, ...S.dist.map(d => d.n));
    const full = /^#reviews/.test(location.hash);
    return `<div class="section-h" style="margin-top:0"><button class="btn ghost sm" data-action="rv-back">← 返回</button><h2>${h(run.title)}</h2>
      <span class="hint">${h(run.source)} · ${rangeName(run.range)} · ${run.stores.reduce((a, s) => a + s.reviews.length, 0)} 条评价</span>
      <div class="right">${full ? '' : `<button class="btn ghost sm" data-action="rv-full" title="表格比较宽，在新标签页里看更清楚">大屏查看</button>`}<button class="btn primary sm" data-action="rv-xlsx">导出 Excel</button>
      ${R.confirmDel ? `<button class="btn sm danger" data-action="rv-del">确定删除</button><button class="btn ghost sm" data-action="rv-nodel">取消</button>` : `<button class="btn ghost sm" data-action="rv-askdel">删除</button>`}</div></div>
    ${multi ? `<div class="chips" style="margin-bottom:10px" role="group" aria-label="门店">${run.stores.map((s, i) => `<button class="chip" data-action="rv-store" data-i="${i}" aria-pressed="${i === R.cur}">${h(s.name || s.query)} <b>${s.reviews.length}</b>${s.analysis ? ' ✓' : ''}</button>`).join('')}</div>` : ''}
    ${st.appGate ? `<div class="banner info"><b>大众点评网页版只显示部分评价</b>，点"查看全部"会被要求去 App。这家店拿到了：点评的<b>评价标签 ${(st.tags || []).length} 个</b>（基于全部 ${st.total || '?'} 条评价统计）+ 店铺页显示的 <b>${st.reviews.length} 条</b>评价。<br>自己的门店：用「导入评价表格」导入商家后台的评价，可以逐条归纳近一年全部评价。</div>` : ''}
    ${!st.reviews.length && !(st.tags || []).length ? `<div class="banner">这家店一条评价都没读到（${h(st.stopReason || '')}）。请确认已登录大众点评；如果还是不行，点"复制诊断信息"发给 Claude。<button class="btn sm" data-action="rv-diag" style="margin-left:6px">复制诊断信息</button></div>` : ''}
    <div class="panel stack" style="gap:10px">
      <div class="row"><b class="grow" style="font-size:15px">${h(st.name || st.query)}</b>${st.addr ? `<span class="hint">${h(st.addr)}</span>` : ''}${st.shopId ? `<a class="hint" href="https://www.dianping.com/shop/${h(st.shopId)}" target="_blank" rel="noopener">打开点评</a>` : ''}</div>
      <div class="kpis" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
        <div><b>${S.n}</b><span>条评价${st.total ? `（店铺共 ${st.total}）` : ''}</span></div>
        <div><b>${S.avgStar ? S.avgStar.toFixed(2) : '—'}</b><span>平均星级</span></div>
        <div><b class="${S.starN && S.low / S.starN > 0.15 ? 'neg' : ''}">${S.starN ? Math.round(S.low / S.starN * 100) + '%' : '—'}</b><span>3 星及以下</span></div>
        <div><b>${S.price ? '￥' + Math.round(S.price) : '—'}</b><span>评价人均</span></div>
      </div>
      <div class="hint">${S.from ? `时间：${S.from} – ${S.to} · ` : ''}${h(st.stopReason || '')}</div>
      <div class="rules">
        ${S.starN ? `<div><b style="font-size:13px">星级分布</b>${S.dist.map(d => `<div class="row" style="gap:6px"><span style="width:34px" class="stars">${'★'.repeat(d.k)}</span><span class="dbar ${d.k <= 3 ? 'r' : 'g'}" style="flex:1"><i style="width:${Math.round(d.n / maxD * 100)}%"></i></span><b style="min-width:34px;text-align:right;font-family:var(--f-mono)">${d.n}</b></div>`).join('')}</div>` : ''}
        ${S.scores.length ? `<div><b style="font-size:13px">分项评分</b>${S.scores.map(x => `<div class="row"><span class="grow">${h(x.k)}</span><b style="font-family:var(--f-mono)">${x.v.toFixed(2)}</b></div>`).join('')}</div>` : ''}
      </div>
      ${S.months.length >= 2 ? `<div><b style="font-size:13px">每月评价数</b><span class="hint">（柱上数字 = 当月平均星级）</span><div class="bars" style="margin-top:6px">${S.months.map(m => `<div class="b" style="height:${Math.round(m.n / maxM * 100)}%" title="${m.key}：${m.n} 条，平均 ${m.star ? m.star.toFixed(1) : '-'} 星"></div>`).join('')}</div>
        <div class="bars-x">${S.months.map(m => `<span>${m.key.slice(5)}</span>`).join('')}</div><div class="bars-x">${S.months.map(m => `<span style="color:${m.star && m.star < 4 ? 'var(--red,#d6452b)' : 'var(--ink)'}">${m.star ? m.star.toFixed(1) : '·'}</span>`).join('')}</div></div>` : ''}
      ${(st.tags || []).length ? `<div><b style="font-size:13px">点评评价标签</b> <span class="hint">点评基于全部${st.total ? ' ' + st.total + ' 条' : ''}评价统计，数字 = 提到的评价数</span>${(() => { const mx = Math.max(1, ...st.tags.map(t => t.n)); return st.tags.slice().sort((a, b) => b.n - a.n).map(t => `<div class="row" style="gap:6px;flex-wrap:nowrap"><span style="flex:0 0 44%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${h(t.name)}">${h(t.name)}</span><span class="dbar ${/排队|贵|慢|差|咸|腻|脏|小|少|难/.test(t.name) && !/不|免|好|快/.test(t.name) ? 'r' : 'g'}" style="flex:1"><i style="width:${Math.round(t.n / mx * 100)}%"></i></span><b style="min-width:40px;text-align:right;font-family:var(--f-mono)">${t.n}</b></div>`).join(''); })()}</div>` : ''}
      ${S.dishes.length ? `<div class="kv2"><span class="hint">顾客勾选的喜欢的菜</span><div class="chips">${S.dishes.map(([d, n]) => `<span class="chip sm g">${h(d)} ${n}</span>`).join('')}</div></div>` : ''}
    </div>
    <div class="section-h"><h2>评价归纳</h2><span class="hint">按《顾客评价调研模块》模板：好评产品 / 差评产品 / 口碑点 / 吐槽点 / 内容拍摄结论 / 客流特征</span>
      <div class="right">${aj && aj.running ? `<button class="btn sm danger" data-action="rv-ai-stop">停止</button>` : st.reviews.length || (st.tags || []).length ? `<button class="btn ${an ? 'ghost' : 'primary'} sm" data-action="rv-ai">${an ? '重新归纳' : st.reviews.length < 20 && (st.tags || []).length >= 3 ? '按评价标签归纳' : '开始 AI 归纳'}</button>` : ''}</div></div>
    ${aj && aj.running ? `<div class="banner info">${h(aj.stage)} · ${aj.done}/${aj.total}</div><div class="bar"><i style="width:${Math.round(aj.done / aj.total * 100)}%"></i></div>` : ''}
    ${aj && aj.error ? `<div class="banner">${h(aj.error)}${/设置/.test(aj.error) ? ' <button class="btn sm" data-action="go-settings">去设置</button>' : ''}</div>` : ''}
    ${an ? tplView(an.table, st.name || st.query) : !(aj && aj.running) ? st.reviews.length < 20 && (st.tags || []).length >= 3 ? `<div class="empty"><b>还没归纳</b>评价太少，没法逐条统计。可以让 AI 根据点评的评价标签（带次数）和首页评价，按模板出一版结论（1 次调用）。</div>` : `<div class="empty"><b>还没归纳</b>AI 会逐条读完这 ${S.n} 条评价（约 ${Math.ceil(Math.min(3000, S.n) / 60) + 2} 次调用，DeepSeek 大约 1 元以内，3–10 分钟），按你们模板出六部分结论。</div>` : ''}
    ${multi && run.stores.filter(s => s.analysis).length > 1 ? compareView(run) : ''}`;
  }
  function tplView(T, brand) {
    const sec = (key, title, rows, final) => {
      const max = Math.max(1, ...rows.map(x => typeof x.c[1] === 'number' ? x.c[1] : 0));
      return `<section class="tpl-sec"><h3>${h(title)}</h3><div class="tbl-wrap"><table class="tpl">
        <thead><tr>${HEADS[key].map(x => `<th>${h(x)}</th>`).join('')}${key === 's5' ? '<th></th>' : ''}</tr></thead><tbody>
        ${rows.length ? rows.map((x, ri) => `<tr>${x.c.map((v, i) => {
          if (i === 1 && typeof v === 'number' && key !== 's5') return `<td class="n">${v}<span class="dbar" style="width:44px;display:block;margin:4px 0 0"><i style="width:${Math.round(v / max * 100)}%"></i></span></td>`;
          if (key === 's5' && i === 0) return `<td class="n">${h(v)}</td>`;
          if (key === 's4' && i === 5) return `<td><span class="lvl ${/严重/.test(v) ? 'hi' : /中/.test(v) ? 'mid' : 'lo'}">${h(v)}</span></td>`;
          const evCol = { s1: 3, s2: 3, s6: 3, s3: 2, s4: 2 }[key];
          const more = i === evCol && x.q && x.q.length > 1 ? `<details><summary class="hint link">更多原话（${x.q.length}）</summary><ul class="hint quotes">${x.q.map(q => `<li>${h(q)}</li>`).join('')}</ul></details>` : '';
          return `<td class="${i === 0 ? 'name' : ''}">${br(v)}${more}</td>`;
        }).join('')}${key === 's5' ? `<td><button class="btn sm" data-action="rv-compose" data-i="${ri}">写成内容</button></td>` : ''}</tr>`).join('') : `<tr><td colspan="6" class="hint" style="text-align:center">没有足够的评价支撑这一部分</td></tr>`}
        ${final ? `<tr class="final"><td>客流特征最终结论</td><td></td>${final.map(v => `<td>${br(v)}</td>`).join('')}</tr>` : ''}
        </tbody></table></div></section>`;
    };
    return `<div class="tpl-title">${h(T.title)}</div><div class="hint" style="margin-bottom:8px">${h(T.note)}</div>
      ${sec('s1', TITLES.s1, T.s1)}${sec('s2', TITLES.s2, T.s2)}${sec('s3', TITLES.s3, T.s3)}${sec('s4', TITLES.s4, T.s4)}${sec('s5', TITLES.s5(brand), T.s5)}${sec('s6', TITLES.s6(T.sampleN), T.s6, T.final && T.final.some(Boolean) ? T.final : null)}`;
  }
  function compareView(run) {
    const ss = run.stores.filter(s => s.analysis);
    const row = (label, fn) => `<tr><td><b>${label}</b></td>${ss.map(s => `<td style="white-space:normal">${fn(s)}</td>`).join('')}</tr>`;
    const chips = (arr, cls) => (arr || []).map(([n, c]) => `<span class="chip sm ${cls}">${h(n)} ${c}</span>`).join(' ') || '—';
    return `<div class="section-h"><h2>门店对比</h2><span class="hint">已归纳的门店并排看</span></div>
    <div class="tbl-wrap"><table><thead><tr><th></th>${ss.map(s => `<th>${h(s.name || s.query)}</th>`).join('')}</tr></thead><tbody>
      ${row('评价数', s => s.reviews.length)}${row('平均星级', s => { const x = stats(s); return x.avgStar ? x.avgStar.toFixed(2) : '—'; })}${row('3 星及以下', s => { const x = stats(s); return x.starN ? Math.round(x.low / x.starN * 100) + '%' : '—'; })}
      ${row('分项评分', s => stats(s).scores.map(x => `${h(x.k)} ${x.v.toFixed(1)}`).join(' / ') || '—')}
      ${row('好评产品', s => chips(s.analysis.tops.good, 'g'))}${row('差评产品', s => chips(s.analysis.tops.bad, 'r'))}
      ${row('口碑点', s => chips(s.analysis.tops.praise, 'g'))}${row('吐槽点', s => chips(s.analysis.tops.complaints, 'r'))}
    </tbody></table></div>`;
  }

  // ---------- 导出 ----------
  function exportXlsx() {
    const run = R.open; const sheets = [];
    run.stores.forEach(st => {
      const nm = (st.name || st.query || '门店').replace(/[\\/?*[\]:]/g, '').slice(0, 20);
      if (st.analysis) {
        const T = st.analysis.table; const rows = [], merges = [], heights = {};
        const add = (cells, ht) => { rows.push(cells); if (ht) heights[rows.length - 1] = ht; return rows.length; };
        const fullRow = (v, s, ht) => { const r = add([{ v, s }, { v: '', s }, { v: '', s }, { v: '', s }, { v: '', s }, { v: '', s }], ht); merges.push(`A${r}:F${r}`); };
        fullRow(T.title, 'title', 30); fullRow(T.note, 'note', 40);
        const section = (key, title, list, final) => {
          add([]); fullRow(title, 'section', 24); add(HEADS[key].map(v => ({ v, s: 'head' })), 32);
          list.forEach(x => add(x.c.map((v, i) => ({ v, s: (i === 1 && typeof v === 'number') || (key === 's5' && i === 0) ? 'num' : (key === 's4' && i === 5 && /严重/.test(v) ? 'warn' : 'cell') })), 72));
          if (final) add([{ v: '客流特征最终结论', s: 'final' }, { v: '', s: 'final' }, ...final.map(v => ({ v, s: 'final' }))], 90);
        };
        section('s1', TITLES.s1, T.s1); section('s2', TITLES.s2, T.s2); section('s3', TITLES.s3, T.s3); section('s4', TITLES.s4, T.s4);
        section('s5', TITLES.s5(st.name || ''), T.s5); section('s6', TITLES.s6(T.sampleN), T.s6, T.final && T.final.some(Boolean) ? T.final : null);
        sheets.push({ name: `${nm}-评价调研`.slice(0, 31), styled: true, widths: [22, 14, 36, 48, 32, 36], rows, merges, heights });
      }
      const S = stats(st);
      sheets.push({ name: `${nm}-数据概览`.slice(0, 31), widths: [18, 14, 14], rows: [['指标', '数值', ''], ['评价数', S.n, ''], ['时间', `${S.from} – ${S.to}`, ''], ['平均星级', S.avgStar ? +S.avgStar.toFixed(2) : '', ''], ['3 星及以下', S.starN ? Math.round(S.low / S.starN * 100) + '%' : '', ''], ['评价人均', S.price ? Math.round(S.price) : '', '']]
        .concat(S.scores.map(x => [x.k, +x.v.toFixed(2), ''])).concat([[], ['星级', '条数', '']], S.dist.map(d => [d.k + ' 星', d.n, ''])).concat([[], ['月份', '评价数', '平均星级']], S.months.map(m => [m.key, m.n, m.star ? +m.star.toFixed(2) : ''])).concat([[], ['喜欢的菜', '次数', '']], S.dishes.map(([d, n]) => [d, n, ''])).concat((st.tags || []).length ? [[], ['点评评价标签', '提到的评价数', ''], ...st.tags.map(t => [t.name, t.n, ''])] : []) });
      if (st.analysis && !st.analysis.tagMode) sheets.push({ name: `${nm}-评价明细(打标)`.slice(0, 31), widths: [6, 60, 8, 12, 6, 8, 40, 28, 28, 28], rows: [['序号', '评价', '点赞', '日期', '星级', '是否有效', '提到的产品', '好评点', '吐槽点', '客流/场景']].concat(st.analysis.rows) });
      else sheets.push({ name: `${nm}-评价明细`.slice(0, 31), widths: [12, 60, 6, 22, 30, 8, 14], rows: [['日期', '评价', '星级', '分项分', '喜欢的菜', '点赞', '用户']].concat(st.reviews.map(r => [r.date, r.text, r.stars || '', Object.entries(r.scores || {}).map(([k, v]) => k + v).join(' '), (r.dishes || []).join('、'), r.likes || 0, r.name || ''])) });
    });
    const bytes = window.XlsxLite.build(sheets);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = `${run.title}-顾客评价调研-${run.createdAt.slice(0, 10)}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast('Excel 已下载');
  }

  // ---------- 动作 ----------
  async function act(action, el) {
    const f = R.form;
    switch (action) {
      case 'rv-src': f.src = el.dataset.v; render(); break;
      case 'rv-find': find(); break;
      case 'rv-sel': { const l = R.pick.lines[+el.dataset.li]; const id = el.dataset.id; l.sel = el.checked ? l.sel.concat(id) : l.sel.filter(x => x !== id); const b = document.querySelector('[data-action="rv-crawl"]'); if (b) b.textContent = `开始抓取 ${selectedStores().length} 家门店的评价`; break; }
      case 'rv-crawl': crawl(); break;
      case 'rv-pause': if (R.job) { R.job.paused = true; log('已暂停'); } break;
      case 'rv-resume': if (R.job) { R.job.paused = false; R.job.blocked = null; log('继续'); } break;
      case 'rv-stop': if (R.job) { R.job.stop = true; R.job.paused = false; log('正在停止…'); } break;
      case 'rv-clear': await closeWindow(); R.job = null; render(); break;
      case 'rv-back': if (R.view === 'pick') { await closeWindow(); R.job = null; } R.view = 'home'; R.open = null; R.pick = null; R.ai = null; R.confirmDel = false; render(); break;
      case 'rv-open': await openRun(el.dataset.id); break;
      case 'rv-store': R.cur = +el.dataset.i; R.ai = null; render(); break;
      case 'rv-ai': analyze(); break;
      case 'rv-ai-stop': if (R.ai && R.ai.ctl) R.ai.ctl.abort(); break;
      case 'rv-import': importFile(); break;
      case 'rv-xlsx': exportXlsx(); break;
      case 'rv-full': chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html') + '#reviews=' + R.open.id }); break;
      case 'rv-askdel': R.confirmDel = true; render(); break;
      case 'rv-nodel': R.confirmDel = false; render(); break;
      case 'rv-del': { const id = R.open.id; await del(RUN(id)); R.index = R.index.filter(x => x.id !== id); await set(IDX, R.index); R.open = null; R.view = 'home'; R.confirmDel = false; toast('已删除'); render(); break; }
      case 'rv-diag': { const st = R.open.stores[R.cur]; await window.__rmCopy('【矩阵助手诊断·点评】' + JSON.stringify({ v: chrome.runtime.getManifest().version, store: st.name || st.query, shopId: st.shopId, stop: st.stopReason, diag: st.diag || null, shopDiag: st.shopDiag || null }), '诊断信息，粘贴发给 Claude'); break; }
      case 'rv-compose': {
        const st = R.open.stores[R.cur]; const row = st.analysis && st.analysis.table.s5[+el.dataset.i]; if (!row) return;
        const [, point, evidence, theme, shots, fit] = row.c;
        window.__rmCompose && window.__rmCompose({ kind: 'need', runId: R.open.id, runTopic: st.name, industry: R.open.industry, need: { name: point, type: 'love', count: 0, quotes: [], insight: evidence, action: '', angle: [theme, shots ? '镜头：' + shots : '', fit ? '适合：' + fit : ''].filter(Boolean).join('；') } });
        break;
      }
    }
  }
  function attach(root) {
    const onField = e => {
      const t = e.target;
      if (t.id === 'rv-file' && e.type === 'change' && t.files && t.files[0]) { loadFile(t.files[0]); return; }
      if (t.dataset.rv) { R.form[t.dataset.rv] = ['range', 'max'].includes(t.dataset.rv) ? +t.value : t.value; if (e.type === 'change' && ['range', 'max'].includes(t.dataset.rv)) render(); return; }
      if (t.dataset.rvf && R.file) { R.file[t.dataset.rvf] = t.value; return; }
      if (t.dataset.rvmap && R.file && e.type === 'change') { R.file.map[t.dataset.rvmap] = +t.value; render(); }
    };
    root.addEventListener('input', onField); root.addEventListener('change', onField);
    load().then(() => { const m = location.hash.match(/#reviews=(\w+)/); if (m) openRun(m[1]); else render(); });
  }
  window.Reviews = { view, act, attach, busy: () => !!(R.job && R.job.running), hashWants: () => /^#reviews/.test(location.hash) };
})();
