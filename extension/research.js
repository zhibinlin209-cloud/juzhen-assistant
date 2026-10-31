/* 「调研」：选行业 + 调研方式 → 自动组关键词 → 逐个关键词搜索、按热度抓帖子和评论 → 洞察报告
 * 报告：需求点 / 竞对对比 / 店铺·品牌榜 / 爆款拆解 / 帖子 / 评论，并能一键把需求点或爆款交给「内容」生成
 */
(function () {
  'use strict';
  const C = window.Core, I = window.Industries, N = window.Needs, S = window.Insight;
  const h = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => Math.round(a + Math.random() * (b - a));
  const fmt = n => C.fmtCount(n);
  const pctTxt = x => (x >= 0 ? '+' : '') + Math.round(x * 100) + '%';
  const IDX = 'rm_runs_index', RUN = id => 'rm_run_' + id;
  const get = k => new Promise(r => chrome.storage.local.get(k, o => r(o[k])));
  const set = (k, v) => new Promise(r => chrome.storage.local.set({ [k]: v }, r));
  const del = k => new Promise(r => chrome.storage.local.remove(k, r));
  const toast = m => window.__rmToast && window.__rmToast(m);
  const render = () => { if (window.__rmIsEditing && window.__rmIsEditing() && isResearchTab()) return; window.__rmRender && window.__rmRender(); };
  const isResearchTab = () => !!document.querySelector('.tabs [data-tab="research"][aria-selected="true"]');
  const MODES = [['brand', '品牌/竞对对比'], ['city', '同城热门店'], ['national', '全国对标'], ['custom', '自定义关键词']];
  const MODE_NAME = Object.fromEntries(MODES);
  const rangeName = d => ({ 90: '近 3 个月', 180: '近半年', 365: '近一年' })[d] || (d ? `近 ${d} 天` : '不限时间');
  const PFN = { xhs: '小红书', douyin: '抖音', dianping: '大众点评' };
  const pfName = p => (Array.isArray(p) ? p.map(x => PFN[x] || x).join('+') : PFN[p] || '小红书');
  const runPf = r => pfName(r.platforms || r.platform);
  const pfClass = p => (p === 'multi' ? 'both' : p === 'dianping' ? 'dp' : p);
  // 大众点评城市编号（不在表里的城市，用你在点评网站上当前选择的城市）
  const DP_CITY = { 上海: 1, 北京: 2, 杭州: 3, 广州: 4, 南京: 5, 苏州: 6, 深圳: 7, 成都: 8, 重庆: 9, 天津: 10, 宁波: 11, 无锡: 13, 福州: 14, 厦门: 15, 武汉: 16, 西安: 17, 沈阳: 18, 大连: 19, 青岛: 21, 济南: 22, 郑州: 160, 长沙: 344, 佛山: 208, 东莞: 219, 珠海: 206, 合肥: 110, 昆明: 267 };
  const DP_STRIP = /探店|测评|评测|避雷|踩雷|推荐|攻略|合集|种草|必吃|必点|值得吗|值不值|怎么样|好吃吗|好不好|排队|打卡|vlog|新店|分店|哪家好|哪家|排行榜?|宝藏|人均/gi;
  function dpKeywords(kws, run) {
    const out = []; const seen = new Set();
    kws.forEach(K => {
      let q = (K.group || K.kw).replace(DP_STRIP, ' ');
      if (run.city) q = q.replace(new RegExp(run.city, 'g'), ' ');
      q = q.replace(/\s+/g, ' ').trim(); if (!q || seen.has(q)) return; seen.add(q);
      out.push(Object.assign({}, K, { kw: q, orig: K.kw }));
    });
    return out;
  }

  const st = {
    index: [], openId: null, openRun: null, analysis: null, tab: 'needs',
    form: { mode: 'brand', industry: '', platform: 'xhs', platforms: null, brands: '', city: '', area: '', cat: '', pos: '', custom: '', must: '', perKw: 10, perPost: 30, range: 365, order: 'hot', strict: true },
    kwEdit: null, job: null, needType: 'all', needGroup: 'all', cmtType: 'all', postSort: 'eng', aiJob: null, confirmDel: false, ruleCache: null, useRule: false,
    deepJob: null, deepBrand: 'all', deepOur: '', deepProdSort: 'n',
    section: (window.Reviews && window.Reviews.hashWants && window.Reviews.hashWants()) ? 'stores' : 'content'
  };
  const industry = () => st.form.industry || (window.Store && Store.state && Store.state.settings.industry) || 'general';

  async function load() {
    st.index = (await get(IDX)) || [];
    const f = await get('rm_research_form2'); if (f) Object.assign(st.form, f);
    render();
  }
  async function saveRun(run) {
    await set(RUN(run.id), run);
    const meta = { id: run.id, topic: run.topic, mode: run.mode, industry: run.industry, platform: run.platform, platforms: run.platforms, createdAt: run.createdAt, posts: run.posts.length, comments: run.comments.length, status: run.status };
    const i = st.index.findIndex(x => x.id === run.id); if (i >= 0) st.index[i] = meta; else st.index.unshift(meta);
    await set(IDX, st.index);
  }
  function upgradeRun(run) { // 兼容旧版报告
    if (!run) return run;
    if (!run.topic) run.topic = run.keyword || '';
    if (!run.mode) run.mode = 'custom';
    if (!run.industry) run.industry = 'food';
    if (!run.keywords) run.keywords = [{ kw: run.keyword || run.topic, must: [], group: '' }];
    return run;
  }
  async function openRun(id) {
    st.openId = id; st.openRun = upgradeRun(await get(RUN(id))); st.analysis = null; st.ruleCache = null;
    st.tab = 'deep'; st.needType = 'all'; st.needGroup = 'all'; st.cmtType = 'all'; st.useRule = false; st.aiJob = null; st.confirmDel = false; st.deepJob = null; st.deepBrand = 'all'; st.deepOur = '';
    render(); window.scrollTo(0, 0);
  }
  async function loadRun(id) { return upgradeRun(await get(RUN(id))); }

  // ---------- 关键词 ----------
  function plannedKeywords() {
    if (st.kwEdit) return st.kwEdit;
    return I.buildKeywords(st.form.mode, st.form, industry());
  }
  function searchUrl(pf, kw, range, cityId) {
    if (pf === 'dianping') return `https://www.dianping.com/search/keyword/${cityId || 1}/0_${encodeURIComponent(kw)}`;
    return pf === 'douyin' ? `https://www.douyin.com/search/${encodeURIComponent(kw)}?type=video${range && range <= 180 ? '&publish_time=180' : ''}`
      : `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(kw)}&source=web_search_result_notes`;
  }
  const norm = x => String(x || '').toLowerCase().replace(/[\s#@·・,，。!！?？:：、~～\-_|｜"“”'‘’()（）【】\[\]]/g, '');
  function passMust(must, text) { const t = norm(text); return (must || []).every(g => g.some(w => t.includes(norm(w)))); }

  // ---------- 浏览器窗口 ----------
  function waitLoad(tabId, ms) {
    return new Promise(resolve => {
      const t0 = Date.now();
      (function poll() { chrome.tabs.get(tabId, tab => { if (chrome.runtime.lastError || !tab) return resolve(false); if (tab.status === 'complete' || Date.now() - t0 > (ms || 25000)) return resolve(true); setTimeout(poll, 500); }); })();
    });
  }
  async function msg(tabId, m, timeout) {
    let files = ['content.js', 'collector.js'];
    try { const t = await chrome.tabs.get(tabId); if (/dianping\.com/.test(t.url || '')) files = ['dianping.js']; } catch (e) { /* 忽略 */ }
    const send = () => Promise.race([chrome.tabs.sendMessage(tabId, m), sleep(timeout || 120000).then(() => ({ ok: false, error: '页面没有响应' }))]);
    try { return await send(); } catch (e) {
      try { await chrome.scripting.executeScript({ target: { tabId }, files }); } catch (er) { throw new Error('采集窗口被关闭或页面打不开'); }
      await sleep(800); return await send();
    }
  }
  async function openWindow(url) { const win = await chrome.windows.create({ url, focused: true, width: 1200, height: 860, type: 'normal' }); return { windowId: win.id, tabId: win.tabs[0].id }; }
  async function go(tabId, url) { await chrome.tabs.update(tabId, { url }); await waitLoad(tabId); await sleep(rand(2000, 3500)); }

  // ---------- 采集任务 ----------
  function log(text) { const j = st.job; if (!j) return; j.log.unshift(new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '  ' + text); j.log = j.log.slice(0, 60); render(); }
  async function waitIfPaused() { while (st.job && st.job.paused && !st.job.stop) await sleep(500); }
  async function handleBlocked(reason) {
    const j = st.job; j.paused = true; j.blocked = reason;
    log('暂停：' + reason + '。请在采集窗口里处理后点"继续"');
    try { await chrome.windows.update(j.windowId, { focused: true }); } catch (e) { /* 窗口可能已关 */ }
    render(); await waitIfPaused(); j.blocked = null;
  }
  const n0 = v => (typeof v === 'number' ? v : C.parseCount(v)) || 0;
  function sortList(list, order) {
    if (order === 'hot') return list.slice().sort((a, b) => (n0(b.likes) + n0(b.collects) + n0(b.comments) * 3) - (n0(a.likes) + n0(a.collects) + n0(a.comments) * 3));
    if (order === 'comments') return list.slice().sort((a, b) => (n0(b.comments) * 1000 + n0(b.likes)) - (n0(a.comments) * 1000 + n0(a.likes)));
    if (order === 'new') return list.slice().sort((a, b) => (b.time || 0) - (a.time || 0));
    return list;
  }

  function formPlatforms() { const f = st.form; const a = Array.isArray(f.platforms) && f.platforms.length ? f.platforms : [f.platform || 'xhs']; const r = ['xhs', 'douyin'].filter(x => a.includes(x)); return r.length ? r : ['xhs']; }
  async function start() {
    const f = st.form; const kws = plannedKeywords().filter(k => k.kw);
    if (!kws.length) { toast(st.form.mode === 'city' ? '请填城市（或商圈）和品类' : st.form.mode === 'national' ? '请填品类' : '请先填品牌或关键词'); return; }
    if (st.job && st.job.running) { toast('已经有一个调研在进行'); return; }
    const pfs = formPlatforms();
    if (!pfs.length) { toast('至少选一个平台'); return; }
    await set('rm_research_form2', f);
    const pack = industry();
    const topic = f.mode === 'brand' ? kws.map(k => k.group || k.kw).join(' vs ') : f.mode === 'city' ? `${f.area || f.city}${f.cat}` : f.mode === 'national' ? `全国${f.pos || ''}${f.cat}` : kws.map(k => k.kw).join('、');
    const run = { id: C.uid('run'), mode: f.mode, industry: pack, platform: pfs.length === 1 ? pfs[0] : 'multi', platforms: pfs, topic, keywords: kws, perKw: +f.perKw, perPost: +f.perPost, range: +f.range || 0, order: f.order, strict: !!f.strict,
      city: f.city, area: f.area, cat: f.cat, createdAt: new Date().toISOString(), status: 'running', posts: [], comments: [], diag: [], skipped: 0, oldSkipped: 0 };
    const plan = pfs.map(pf => ({ pf, kws: pf === 'dianping' ? dpKeywords(kws, run) : kws }));
    const total = plan.reduce((s, x) => s + x.kws.length * run.perKw, 0);
    st.job = { running: true, paused: false, stop: false, phase: '准备', i: 0, n: total, log: [], run, windowId: null, tabId: null, blocked: null };
    render();
    const cutoff = run.range ? Date.now() - run.range * 864e5 : 0;
    const seen = new Set();
    const nav = async url => {
      if (!st.job.windowId) { const w = await openWindow(url); st.job.windowId = w.windowId; st.job.tabId = w.tabId; await waitLoad(w.tabId); await sleep(rand(2500, 4000)); }
      else await go(st.job.tabId, url);
    };
    try {
      for (const P of plan) {
        if (st.job.stop) break;
        const pf = P.pf; let cityId = null;
        if (pf === 'dianping') {
          cityId = DP_CITY[(run.city || '').replace(/市$/, '')] || null;
          if (!cityId) {
            await nav('https://www.dianping.com/');
            const r = await msg(st.job.tabId, { type: 'rm:status' }, 20000).catch(() => null);
            if (r && r.blocked) await handleBlocked(r.blocked);
            cityId = (r && r.cityId) || null;
            log(run.city ? `大众点评：没认出「${run.city}」，用点评网站当前选择的城市` : '大众点评：没填城市，用点评网站当前选择的城市');
          }
        }
        for (let k = 0; k < P.kws.length; k++) {
          if (st.job.stop) break;
          const K = P.kws[k];
          st.job.phase = `${pfName(pf)} · 关键词 ${k + 1}/${P.kws.length}：${K.kw}`; render();
          await nav(searchUrl(pf, K.kw, run.range, cityId));
          log(`${pfName(pf)} 搜索「${K.kw}」`);
          let res;
          for (let tries = 0; tries < 3; tries++) {
            res = await msg(st.job.tabId, { type: 'rm:collectList', limit: pf === 'dianping' ? Math.min(60, run.perKw * 3) : Math.min(150, run.perKw * (run.range ? 5 : 3)) }, 300000);
            if (res && res.blocked && (!res.list || !res.list.length)) { await handleBlocked(res.blocked); if (st.job.stop) break; continue; }
            break;
          }
          let list = ((res && res.list) || []).filter(x => !seen.has(pf + x.id));
          const found = list.length;
          if (cutoff) list = list.filter(x => !x.time || x.time >= cutoff);
          if (pf === 'dianping' && run.strict && K.group) { const g = norm(K.group); list = list.filter(x => norm(x.title).includes(g) || norm(x.title).includes(g.slice(0, Math.max(2, g.length - 1)))); }
          list = pf === 'dianping' ? list : sortList(list, run.order);
          const unit = pf === 'dianping' ? '家店' : '篇';
          log(`「${K.kw}」找到 ${found} ${unit}${list.length !== found ? `，符合条件 ${list.length} ${unit}` : ''}`);
          let kept = 0;
          for (let i = 0; i < list.length && kept < run.perKw; i++) {
            await waitIfPaused(); if (st.job.stop) break;
            const item = list[i]; seen.add(pf + item.id);
            st.job.current = item.title || item.id; render();
            try {
              await go(st.job.tabId, item.url);
              let r = await msg(st.job.tabId, { type: 'rm:readPost', maxComments: run.perPost }, 120000);
              if (r && !r.ok && r.blocked) { await handleBlocked(r.blocked); if (st.job.stop) break; r = await msg(st.job.tabId, { type: 'rm:readPost', maxComments: run.perPost }, 120000); }
              if (!r || !r.ok) { log(`跳过：${(r && (r.error || r.blocked)) || '读取失败'}`); continue; }
              const p = r.post || {};
              const pid = pf === 'dianping' ? 'dp' + item.id : item.id;
              const time = p.time || item.time || null;
              if (cutoff && time && time < cutoff) { run.oldSkipped++; log(`跳过：发布于 ${new Date(time).toLocaleDateString('zh-CN')}，超出${rangeName(run.range)}`); await sleep(rand(1200, 2500)); continue; }
              const text = [p.title, item.title, p.desc, (p.tags || []).join(' '), p.poi, item.poi].join(' ');
              if (pf !== 'dianping' && run.strict && K.must && K.must.length && !passMust(K.must, text)) { run.skipped++; log(`跳过：没提到「${I.mustText(K.must)}」`); await sleep(rand(1200, 2500)); continue; }
              const post = { id: pid, platform: pf, url: item.url, kw: K.kw, group: K.group || '', title: (pf === 'dianping' ? item.title || p.title : p.title || item.title) || '', author: p.author || item.author || '', likes: p.likes ?? item.likes ?? '', collects: p.collects ?? item.collects ?? '', comments: p.comments ?? item.comments ?? '', shares: p.shares ?? item.shares ?? '',
                desc: p.desc || '', tags: p.tags || [], poi: p.poi || item.poi || '', type: p.type || item.type || '', time, publishedText: p.publishedText || (time ? new Date(time).toLocaleDateString('zh-CN') : ''), got: 0 };
              if (pf === 'dianping') {
                Object.assign(post, { price: item.price || null, cat: item.cat || '', dishes: item.dishes || [], shopStars: item.stars || null });
                post.desc = [item.price ? `人均￥${item.price}` : '', item.cat, item.poi, (item.dishes || []).length ? '推荐菜：' + item.dishes.join('、') : ''].filter(Boolean).join(' · ');
              }
              let got = 0; const seenC = new Set();
              const take = arr => (arr || []).forEach(c => { const ck = c.id || c.cid || ((c.name || '') + '|' + c.text); if (got >= run.perPost || seenC.has(ck)) return; seenC.add(ck); if (!(cutoff && c.ts && c.ts < cutoff)) { run.comments.push(Object.assign({ postId: pid, group: post.group, platform: pf }, c)); got++; } });
              take(r.comments);
              // 大众点评：评价分页，继续翻
              let pages = 1, oldOnly = false;
              while (pf === 'dianping' && r.next && got < run.perPost && pages < 8 && !st.job.stop) {
                if (cutoff && (r.comments || []).length && r.comments.every(c => c.ts && c.ts < cutoff)) { oldOnly = true; break; }
                await sleep(rand(2500, 4500)); await go(st.job.tabId, r.next); pages++;
                r = await msg(st.job.tabId, { type: 'rm:readPost', maxComments: run.perPost }, 120000);
                if (r && !r.ok && r.blocked) { await handleBlocked(r.blocked); if (st.job.stop) break; r = await msg(st.job.tabId, { type: 'rm:readPost', maxComments: run.perPost }, 120000); }
                if (!r || !r.ok) break;
                take(r.comments);
              }
              post.got = got; run.posts.push(post); kept++; st.job.i = run.posts.length;
              const dg = (r && r.diag) || {}; if (!got && run.diag.length < 6) run.diag.push(dg);
              log(`第 ${run.posts.length} ${pf === 'dianping' ? '家' : '篇'}：${(post.title || '').slice(0, 16)}…  ${pf === 'dianping' ? '评价' : '评论'} ${got} 条${got ? '' : `（页面显示 ${dg.shown ?? '?'} 条）`}${oldOnly ? '，后面都是更早的评价' : ''}${dg.decoder && dg.decoder.miss ? `（${dg.decoder.miss} 个加密字没还原）` : ''}`);
              if (r && r.blocked) await handleBlocked(r.blocked);
              if (run.posts.length % 3 === 0) await saveRun(run);
            } catch (e) {
              if (/关闭|No tab|cannot be edited/i.test(e.message)) throw new Error('采集窗口被关闭了');
              log('出错：' + e.message);
            }
            await sleep(rand(3000, 6500)); // 正常浏览节奏，降低被平台限制的概率
          }
          if (kept < run.perKw) log(`「${K.kw}」符合条件的只有 ${kept} ${pf === 'dianping' ? '家' : '篇'}`);
        }
      }
      run.status = st.job.stop ? 'stopped' : 'done';
      log(run.status === 'done' ? '采集完成，正在生成报告' : '已停止，已保存采集到的部分');
    } catch (e) {
      run.status = run.posts.length ? 'partial' : 'failed';
      log('出错：' + e.message); toast(e.message);
    }
    if (run.posts.length) await saveRun(run);
    try { if (st.job.windowId) await chrome.windows.remove(st.job.windowId); } catch (e) { /* 已关 */ }
    st.job.running = false;
    if (run.posts.length) { await openRun(run.id); st.job = null; render(); toast(`完成：${run.posts.length} 篇帖子/店铺，${run.comments.length} 条评论/评价`); }
    else render();
  }

  /** 数据页用：批量打开已发布的帖子，读回最新互动数 */
  async function refreshRecords(records, onProgress) {
    const list = records.filter(r => /^https?:\/\/(www\.)?(xiaohongshu|douyin)\.com\//.test(r.url || ''));
    if (!list.length) throw new Error('没有带链接的发布记录。先在记录里粘贴帖子链接');
    let w = null; const out = [];
    try {
      for (let i = 0; i < list.length; i++) {
        const r = list[i]; onProgress && onProgress(i, list.length);
        if (!w) { w = await openWindow(r.url); await waitLoad(w.tabId); await sleep(rand(2500, 3500)); } else await go(w.tabId, r.url);
        const res = await msg(w.tabId, { type: 'rm:readPost', maxComments: 0 }, 60000);
        if (res && res.ok && res.post) out.push({ id: r.id, likes: res.post.likes, collects: res.post.collects, comments: res.post.comments, shares: res.post.shares, time: res.post.time, title: res.post.title });
        else if (res && res.blocked) throw new Error(res.blocked + '，已更新 ' + out.length + ' 条');
        await sleep(rand(2500, 5000));
      }
    } finally { try { if (w) await chrome.windows.remove(w.windowId); } catch (e) { /* 已关 */ } }
    onProgress && onProgress(list.length, list.length);
    return out;
  }

  // ---------- 分析（懒计算） ----------
  function A() {
    const run = st.openRun; if (!run) return null;
    if (st.analysis && st.analysis.id === run.id) return st.analysis;
    const pack = run.industry || 'general';
    const exclude = [run.city, run.area, run.cat].concat(run.keywords.map(k => k.kw)).filter(Boolean);
    const groups = [...new Set(run.posts.map(p => p.group).filter(Boolean))];
    st.analysis = {
      id: run.id, pack,
      content: S.contentInsight(run.posts.filter(p => p.type !== 'shop')),
      shops: run.posts.filter(p => p.type === 'shop'),
      board: run.mode === 'brand' && groups.length || !run.posts.some(p => p.type !== 'shop') ? null : S.entities(run.posts.filter(p => p.type !== 'shop'), run.comments, pack, { exclude, cats: [run.cat].filter(Boolean), tagsAsBrands: run.mode === 'national', min: run.posts.length < 15 ? 1 : 2 }),
      compare: groups.length > 1 ? S.compare(run.posts, run.comments, pack) : null,
      groups
    };
    return st.analysis;
  }
  function needsData() {
    const run = st.openRun;
    if (run.ai && !st.useRule && st.needGroup === 'all') return run.ai;
    const key = run.id + '|' + st.needGroup;
    if (!st.ruleCache || st.ruleCache.key !== key) {
      const cs = st.needGroup === 'all' ? run.comments : run.comments.filter(c => c.group === st.needGroup);
      st.ruleCache = { key, data: N.ruleNeeds(cs, run.keywords.map(k => k.group || k.kw), run.industry) };
    }
    return st.ruleCache.data;
  }

  // ---------- 视图 ----------
  function view() {
    if (st.openRun) return report();
    const sw = `<div class="seg-top" role="tablist">${[['content', '平台内容调研', '小红书 / 抖音：竞对、同城、爆款、顾客需求'], ['stores', '门店评价调研', '大众点评：指定门店近一年评价，按模板归纳']].map(([k, l, d]) => `<button role="tab" data-action="rs-section" data-v="${k}" aria-selected="${st.section === k}"><b>${l}</b><span>${d}</span></button>`).join('')}</div>`;
    if (st.section === 'stores' && window.Reviews) return sw + window.Reviews.view();
    return sw + form() + progress() + history();
  }
  function form() {
    const f = st.form; const busy = st.job && st.job.running; const pack = industry(); const pk = I.get(pack);
    const kws = plannedKeywords();
    const dis = busy ? 'disabled' : '';
    const modeFields = {
      brand: `<label class="f"><span>要调研的品牌（一行一个，最多 6 个；填 2 个以上会做对比）</span><textarea id="rs-brands" data-rs="brands" rows="3" placeholder="如：\n炳胜品味\n陶陶居\n点都德" ${dis}>${h(f.brands)}</textarea></label>
        <label class="f"><span>限定城市（可选）</span><input type="text" id="rs-city" data-rs="city" value="${h(f.city)}" placeholder="如：广州（全国连锁品牌想看某个城市时填）" ${dis}></label>`,
      city: `<div class="grid3"><label class="f"><span>城市</span><input type="text" id="rs-city" data-rs="city" value="${h(f.city)}" placeholder="如：广州" ${dis}></label>
        <label class="f"><span>商圈（可选）</span><input type="text" id="rs-area" data-rs="area" value="${h(f.area)}" placeholder="如：天河" ${dis}></label>
        <label class="f"><span>品类</span><input type="text" id="rs-cat" data-rs="cat" list="rs-cats" value="${h(f.cat)}" placeholder="如：${h(pk.cats[0] || '火锅')}" ${dis}></label></div>`,
      national: `<div class="grid2"><label class="f"><span>品类</span><input type="text" id="rs-cat" data-rs="cat" list="rs-cats" value="${h(f.cat)}" placeholder="如：${h(pk.cats[0] || '咖啡')}" ${dis}></label>
        <label class="f"><span>定位（可选）</span><input type="text" id="rs-pos" data-rs="pos" value="${h(f.pos)}" placeholder="如：高端、平价、社区" ${dis}></label></div>`,
      custom: `<label class="f"><span>关键词（一行一个，最多 8 个）</span><textarea id="rs-custom" data-rs="custom" rows="3" placeholder="如：\n广州 早茶 推荐\n广州 早茶 避雷" ${dis}>${h(f.custom)}</textarea></label>
        <label class="f"><span>帖子必须包含（可选；+ 表示都要有，/ 表示有一个就行）</span><input type="text" id="rs-must" data-rs="must" value="${h(f.must)}" placeholder="如：广州/天河 + 早茶" ${dis}></label>`
    };
    return `<div class="section-h" style="margin-top:0"><h2>调研</h2><span class="hint">找竞对、同城热门店、全国对标，挖顾客需求和爆款规律</span></div>
    <div class="panel stack">
      <div class="grid2">
        <label class="f"><span>行业</span><select id="rs-ind" data-rs="industry" ${dis}>${I.list().map(x => `<option value="${x.key}" ${pack === x.key ? 'selected' : ''}>${h(x.name)}</option>`).join('')}</select></label>
        <div class="f"><span>平台（可多选，按顺序一次跑完）</span><div class="chips" role="group" aria-label="平台">${[['xhs', '小红书'], ['douyin', '抖音']].map(([k, l]) => `<button class="chip" data-action="rs-pf" data-v="${k}" aria-pressed="${formPlatforms().includes(k)}" ${dis}>${l}</button>`).join('')}</div></div>
      </div>
      <div class="chips" role="group" aria-label="调研方式">${MODES.map(([k, l]) => `<button class="chip" data-action="rs-mode" data-v="${k}" aria-pressed="${f.mode === k}" ${dis}>${l}</button>`).join('')}</div>
      <datalist id="rs-cats">${pk.cats.map(c => `<option value="${h(c)}">`).join('')}</datalist>
      ${modeFields[f.mode]}
      <div class="stack" style="gap:6px" id="rs-kwbox">${kwBox(kws, dis)}</div>
      <div class="grid3">
        <label class="f"><span>每个关键词帖子数</span><select id="rs-perkw" data-rs="perKw" ${dis}>${[5, 10, 15, 20, 30].map(n => `<option value="${n}" ${+f.perKw === n ? 'selected' : ''}>${n} 篇</option>`).join('')}</select></label>
        <label class="f"><span>每篇评论</span><select id="rs-per" data-rs="perPost" ${dis}>${[20, 30, 50, 100].map(n => `<option value="${n}" ${+f.perPost === n ? 'selected' : ''}>${n} 条</option>`).join('')}</select></label>
        <label class="f"><span>发布时间</span><select id="rs-range" data-rs="range" ${dis}>${[[90, '近 3 个月'], [180, '近半年'], [365, '近一年'], [0, '不限']].map(([k, l]) => `<option value="${k}" ${+f.range === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <label class="f"><span>抓取顺序</span><select id="rs-order" data-rs="order" ${dis}>${[['hot', '互动最多的先抓（点赞+收藏+评论）'], ['comments', '评论最多的先抓（需求更集中）'], ['new', '最新发布的先抓'], ['default', '按平台搜索默认顺序']].map(([k, l]) => `<option value="${k}" ${f.order === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="toggle"><input type="checkbox" id="rs-strict" data-rs="strict" ${f.strict ? 'checked' : ''} ${dis}>只要提到关键对象的帖子（过滤搜索带出来的无关内容）</label>
      <div class="row"><button class="btn primary" data-action="rs-start" ${dis}>开始调研</button><span class="hint" id="rs-est">${estText(kws)}</span></div>
      <span class="hint">大众点评按门店抓评价，在上面的「门店评价调研」里做。</span>
      <span class="hint">开始前请先在这个浏览器里登录${pfName(formPlatforms())}。平台弹出验证时会自动暂停，完成后点"继续"。同一账号一天别跑太多，避免被限制。</span>
    </div>`;
  }
  function estText(kws) { const f = st.form; return `预计 ${Math.max(1, Math.round(formPlatforms().length * kws.length * f.perKw * (14 + f.perPost / 6) / 60))} 分钟，会打开一个新窗口自动浏览`; }
  function kwBox(kws, dis) {
    const f = st.form;
    return `<div class="row"><b style="font-size:13px">将搜索的关键词</b><span class="hint grow">${kws.length ? `${kws.length} 个，每个抓 ${f.perKw} 篇` : '填好上面的信息后自动生成'}</span>${st.kwEdit ? `<button class="btn ghost sm" data-action="rs-kw-reset" ${dis}>恢复自动</button>` : ''}</div>
        ${kws.map((k, i) => `<div class="row" style="gap:6px;flex-wrap:nowrap"><input type="text" id="rs-kw-${i}" data-kwi="${i}" value="${h(k.kw)}" ${dis}><span class="hint" style="white-space:nowrap;max-width:45%;overflow:hidden;text-overflow:ellipsis" title="帖子必须包含：${h(I.mustText(k.must))}">${k.must && k.must.length ? '须含：' + h(I.mustText(k.must)) : ''}</span><button class="btn ghost sm" data-action="rs-kw-del" data-i="${i}" title="删除这个关键词" ${dis}>✕</button></div>`).join('')}
        ${kws.length && kws.length < 8 ? `<div><button class="btn ghost sm" data-action="rs-kw-add" ${dis}>＋ 加一个关键词</button></div>` : ''}`;
  }
  function refreshKwBox() { const b = document.getElementById('rs-kwbox'); if (b) b.innerHTML = kwBox(plannedKeywords(), ''); const e = document.getElementById('rs-est'); if (e) e.textContent = estText(plannedKeywords()); }
  function progress() {
    const j = st.job; if (!j) return '';
    const pct = j.n ? Math.min(100, Math.round(j.i / j.n * 100)) : 0;
    return `<div class="section-h"><h2>${j.running ? '正在调研' : '调研结束'}：${h(j.run.topic)}</h2></div>
    <div class="panel stack">
      ${j.blocked ? `<div class="banner">${h(j.blocked)}。请切到采集窗口完成验证或登录，然后点"继续"。</div>` : ''}
      <div class="row"><b>${h(j.phase)}</b><span class="hint grow">${j.i}/${j.n} 篇 · 评论 ${j.run.comments.length} 条</span>
        ${j.running ? (j.paused ? `<button class="btn primary sm" data-action="rs-resume">继续</button>` : `<button class="btn sm" data-action="rs-pause">暂停</button>`) + `<button class="btn sm danger" data-action="rs-stop">停止并出报告</button>` : ''}</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      ${j.current ? `<span class="hint">当前：${h(String(j.current).slice(0, 40))}</span>` : ''}
      <pre class="small-pre">${h(j.log.join('\n'))}</pre>
      ${!j.running ? `<button class="btn sm" data-action="rs-clear-job">关闭</button>` : ''}
    </div>`;
  }
  function history() {
    if (!st.index.length) return `<div class="section-h"><h2>历史报告</h2></div><div class="empty"><b>还没有调研报告</b>选好行业和调研方式，点"开始调研"。</div>`;
    return `<div class="section-h"><h2>历史报告</h2><span class="hint">${st.index.length} 份</span></div>
    <div class="list">${st.index.map(r => `<div class="item" data-action="rs-open" data-id="${h(r.id)}"><span class="pf ${pfClass(r.platform)}">${runPf(r)}</span><span class="t">${h(r.topic || r.keyword)}</span><span class="m">${h(MODE_NAME[r.mode] || '自定义')} · ${r.posts} 篇 · ${r.comments} 评 · ${new Date(r.createdAt).toLocaleDateString('zh-CN')}</span></div>`).join('')}</div>`;
  }

  // ---------- 报告 ----------
  const TYPE_STYLE = { pain: 'sim high', wish: 'sim mid', ask: 'sim ask', love: 'sim' };
  const typePill = t => `<span class="${TYPE_STYLE[t]}">${N.TYPE_NAME[t]}</span>`;
  const ttl = p => h(p.title || String(p.desc || '').slice(0, 30) || '(无标题)');
  function report() {
    const run = st.openRun, an = A(); const T = { posts: run.posts.length, comments: run.comments.length };
    const tabs = [['deep', '深度洞察'], ['needs', '需求点'], ...(an.compare ? [['compare', '竞对对比']] : []), ...(an.board ? [['board', run.mode === 'national' ? '品牌榜' : '店铺榜']] : []), ...(an.shops.length ? [['shops', '点评店铺']] : []), ...(an.content.n ? [['content', '爆款拆解']] : []), ['posts', an.shops.length === run.posts.length ? '店铺' : '帖子'], ['comments', '评论']];
    if (!tabs.some(t => t[0] === st.tab)) st.tab = 'needs';
    const body = { shops: viewShops, deep: viewDeep, needs: viewNeeds, compare: viewCompare, board: viewBoard, content: viewContent, posts: viewPosts, comments: viewComments }[st.tab]();
    return `<div class="section-h" style="margin-top:0"><button class="btn ghost sm" data-action="rs-back">← 返回</button><h2>${h(run.topic)}</h2>
      <span class="hint">${h(MODE_NAME[run.mode] || '')} · ${runPf(run)} · ${h(I.get(run.industry).name)} · ${rangeName(run.range)} · ${T.posts} 篇 · ${T.comments} 评</span>
      <div class="right"><button class="btn primary sm" data-action="rs-xlsx">导出 Excel</button>
      ${st.confirmDel ? `<button class="btn sm danger" data-action="rs-del">确定删除</button><button class="btn ghost sm" data-action="rs-nodel">取消</button>` : `<button class="btn ghost sm" data-action="rs-askdel">删除</button>`}</div></div>
    ${!T.comments ? `<div class="banner">这次一条评论都没读到。请点"复制诊断信息"发给 Claude 修复。<button class="btn sm" data-action="rs-diag" style="margin-left:6px">复制诊断信息</button></div>` : ''}
    <nav class="tabs sub" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-action="rs-tab" data-v="${k}" aria-selected="${st.tab === k}">${l}</button>`).join('')}</nav>
    <div style="margin-top:12px">${body}</div>`;
  }

  function viewNeeds() {
    const run = st.openRun, an = A(); const ND = needsData();
    const list = ND.needs.filter(n => st.needType === 'all' || n.type === st.needType);
    const maxC = Math.max(1, ...ND.needs.map(n => n.count));
    const nCount = t => ND.needs.filter(n => n.type === t).length;
    const aj = st.aiJob;
    const aiOk = window.Env && Env.aiReady && Env.aiReady();
    const mx = ND.mode === 'ai' && window.Deep ? Deep.needMatrix(ND.needs, run.comments) : null;
    return `<div class="row" style="margin-bottom:8px">
        ${an.groups.length > 1 ? `<select id="rs-ng" data-rs="needGroup" style="width:auto"><option value="all">全部品牌</option>${an.groups.map(g => `<option value="${h(g)}" ${st.needGroup === g ? 'selected' : ''}>${h(g)}</option>`).join('')}</select>` : ''}
        <span class="hint grow">${ND.mode === 'ai' ? `AI 归纳 · ${new Date(ND.at).toLocaleDateString('zh-CN')}` : `按「${h(I.get(run.industry).name)}」需求维度自动归类`} · 来自 ${ND.clauses} 句有信息量的评论 · 数字 = 提到的评论数</span>
        ${run.ai && st.needGroup === 'all' ? `<button class="btn ghost sm" data-action="rs-toggle-rule">${st.useRule ? '看 AI 归纳' : '看自动归类'}</button>` : ''}
        ${aj && aj.running ? `<button class="btn sm danger" data-action="rs-ai-stop">停止</button>` : `<button class="btn ${run.ai ? '' : 'primary'} sm" data-action="rs-ai-run">${run.ai ? '重新用 AI 归纳' : '用 AI 归纳'}</button>`}
      </div>
      ${aj && aj.running ? `<div class="banner info">AI 正在归纳… ${aj.done}/${aj.total} 步</div>` : ''}
      ${aj && aj.error ? `<div class="banner">${h(aj.error)}${!aiOk ? ' <button class="btn sm" data-action="go-settings">去设置</button>' : ''}</div>` : ''}
      ${mx ? `<p class="hint" style="margin:0 0 8px">每个需求点下的品牌条：这个需求在该品牌评论里出现的比例（已按各品牌评论量折算，可直接横向比）。</p>` : ''}
      ${ND.mode === 'ai' && ND.summary ? `<div class="panel" style="border-left:3px solid var(--accent);margin-bottom:8px"><b>一句话结论</b><p style="margin:4px 0 0">${h(ND.summary)}</p></div>` : ''}
      <div class="chips" style="margin-bottom:8px">${[['all', '全部', ND.needs.length], ...N.TYPES.map(t => [t.key, t.short, nCount(t.key)])].map(([k, l, n]) => `<button class="chip" data-action="rs-ntype" data-v="${k}" aria-pressed="${st.needType === k}">${l} ${n}</button>`).join('')}</div>
      ${list.length ? `<div class="list">${list.map(n => `
        <div class="item need">
          <div class="row" style="gap:8px;flex-wrap:nowrap">${typePill(n.type)}<b class="grow" style="min-width:0">${h(n.name)}</b><span class="big-num">${n.count}</span><span class="hint">人提到</span></div>
          <div class="meter"><i style="width:${Math.round(n.count / maxC * 100)}%"></i></div>
          ${n.insight ? `<div class="kv2"><span class="hint">顾客真正要的</span>${h(n.insight)}</div>` : ''}
          ${n.action ? `<div class="kv2"><span class="hint">建议做法</span>${h(n.action)}</div>` : ''}
          ${n.angle ? `<div class="kv2"><span class="hint">选题</span>${h(n.angle)}</div>` : ''}
          ${mx && mx[ND.needs.indexOf(n)] ? matrixRow(mx[ND.needs.indexOf(n)]) : ''}
          ${n.quotes[0] ? `<div class="hint">“${h(n.quotes[0])}”</div>` : ''}
          <div class="row">${n.quotes.length > 1 ? `<details class="grow"><summary class="hint link">更多原话（${n.quotes.length}）</summary><ul class="hint quotes">${n.quotes.slice(1).map(q => `<li>${h(q)}</li>`).join('')}</ul></details>` : '<span class="grow"></span>'}
            <button class="btn sm" data-action="rs-to-compose" data-i="${ND.needs.indexOf(n)}">写成内容</button></div>
        </div>`).join('')}</div>` : `<div class="empty"><b>${ND.needs.length ? '这一类没有' : '评论里没找到明确的需求'}</b>${ND.needs.length ? '' : '评论太少或都是闲聊。可以多抓几篇，或换个更具体的关键词。'}</div>`}
      ${ND.other && ND.other.length && st.needType === 'all' ? `<details class="panel" style="margin-top:10px"><summary style="cursor:pointer"><b>其他有信息量的原话</b> <span class="hint">${ND.other.length} 条，没归到上面的维度，可能藏着新需求</span></summary>
        <ul style="margin:8px 0 0;padding-left:18px">${ND.other.map(o => `<li>${typePill(o.type)} ${h(o.text)}${o.likes ? ` <span class="hint">赞${fmt(o.likes)}</span>` : ''}</li>`).join('')}</ul></details>` : ''}`;
  }

  function viewCompare() {
    const rows = A().compare || [];
    const maxE = Math.max(1, ...rows.map(r => r.avgEng));
    const chips = arr => arr.length ? arr.map(x => `<span class="chip sm">${h(x.name)} <b>${x.count}</b></span>`).join(' ') : '<span class="hint">—</span>';
    return `<p class="hint" style="margin-top:0">按每个品牌自己的帖子和评论分别统计。"差评占比"= 不满类评论 ÷ 有信息量的评论。</p>
    <div class="stack">${rows.map((r, i) => `<div class="panel stack" style="gap:8px">
      <div class="row"><span class="rank">${i + 1}</span><b class="grow" style="font-size:15px">${h(r.group)}</b><span class="hint">${r.posts} 篇 · ${r.comments} 评</span></div>
      <div class="grid3 kpis">
        <div><b>${fmt(r.avgEng)}</b><span>篇均互动</span><div class="meter"><i style="width:${Math.round(r.avgEng / maxE * 100)}%"></i></div></div>
        <div><b>${fmt(r.medLikes)}</b><span>点赞中位数</span></div>
        <div><b class="${r.painRate > 0.4 ? 'neg' : ''}">${Math.round(r.painRate * 100)}%</b><span>差评占比</span></div>
      </div>
      <div class="kv2"><span class="hint">主要不满</span><div class="chips">${chips(r.pain)}</div></div>
      <div class="kv2"><span class="hint">主要吸引</span><div class="chips">${chips(r.love)}</div></div>
      <div class="kv2"><span class="hint">常见疑问</span><div class="chips">${chips(r.ask)}</div></div>
      ${r.wish.length ? `<div class="kv2"><span class="hint">顾客想要</span><div class="chips">${chips(r.wish)}</div></div>` : ''}
      ${r.best ? `<div class="kv2"><span class="hint">最热帖子</span><a href="${h(r.best.url)}" target="_blank" rel="noopener">${ttl(r.best)}</a> <span class="hint">互动 ${fmt(S.eng(r.best))}</span></div>` : ''}
    </div>`).join('')}</div>`;
  }

  function viewShops() {
    const run = st.openRun; const shops = A().shops.slice();
    const byShop = {}; run.comments.forEach(c => { if (c.platform === 'dianping') (byShop[c.postId] = byShop[c.postId] || []).push(c); });
    const avg = arr => { const v = arr.filter(x => typeof x === 'number'); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const rows = shops.map(p => { const cs = byShop[p.id] || []; const sc = {}; cs.forEach(c => Object.entries(c.scores || {}).forEach(([k, v]) => { (sc[k] = sc[k] || []).push(v); }));
      const dish = {}; cs.forEach(c => (c.dishes || []).forEach(d => { dish[d] = (dish[d] || 0) + 1; }));
      const low = cs.filter(c => c.stars && c.stars <= 3).length;
      return { p, n: cs.length, stars: avg(cs.map(c => c.stars)), scores: Object.entries(sc).map(([k, v]) => [k, avg(v)]), dishes: Object.entries(dish).sort((a, b) => b[1] - a[1]).slice(0, 6), low }; })
      .sort((a, b) => (n0(b.p.likes) || 0) - (n0(a.p.likes) || 0));
    return `<p class="hint" style="margin-top:0">大众点评上找到并读了评价的店。星级和分项分是这次读到的评价的平均；"差评"= 3 星及以下。</p>
    <div class="list">${rows.map((r, i) => `<div class="item prod-i">
      <div class="row" style="gap:8px;flex-wrap:nowrap"><span class="rank">${i + 1}</span><a class="grow" style="min-width:0;font-weight:600" href="${h(r.p.url)}" target="_blank" rel="noopener">${h(r.p.title)}</a>${r.p.group ? `<span class="chip sm">${h(r.p.group)}</span>` : ''}</div>
      <div class="row hint" style="gap:10px">${r.p.price ? `<span>人均 ￥${r.p.price}</span>` : ''}${r.p.cat ? `<span>${h(r.p.cat)}</span>` : ''}${r.p.poi ? `<span>${h(r.p.poi)}</span>` : ''}${n0(r.p.likes) ? `<span>${fmt(n0(r.p.likes))} 条评价</span>` : ''}</div>
      <div class="row" style="gap:12px">${r.stars ? `<span><span class="stars">${'★'.repeat(Math.round(r.stars))}</span> <b>${r.stars.toFixed(1)}</b></span>` : ''}${r.scores.map(([k, v]) => `<span class="hint">${h(k)} <b style="color:var(--ink)">${v.toFixed(1)}</b></span>`).join('')}<span class="hint">读了 ${r.n} 条${r.n ? `，差评 ${Math.round(r.low / r.n * 100)}%` : ''}</span></div>
      ${r.dishes.length || (r.p.dishes || []).length ? `<div class="kv2"><span class="hint">喜欢的菜</span><div class="chips">${(r.dishes.length ? r.dishes.map(([d, n]) => `<span class="chip sm g">${h(d)} ${n}</span>`) : r.p.dishes.map(d => `<span class="chip sm g">${h(d)}</span>`)).join('')}</div></div>` : ''}
    </div>`).join('')}</div>`;
  }
  function viewBoard() {
    const run = st.openRun; const rows = A().board || [];
    const label = run.mode === 'national' ? '品牌' : '店铺';
    if (!rows.length) return `<div class="empty"><b>没识别出${label}名</b>帖子里很少直接写${label}名。可以多抓一些帖子，或用"品牌/竞对对比"直接填名字。</div>`;
    return `<p class="hint" style="margin-top:0">从帖子标题、正文、话题、定位和评论里识别${label}名，按被提到的帖子数和互动排序。自动识别可能夹杂少量非${label}名，以原帖为准。</p>
    <div class="tbl-wrap"><table><thead><tr><th class="num">#</th><th>${label}</th><th class="num">提到的帖子</th><th class="num">评论提及</th><th class="num">总互动</th><th class="num">篇均</th><th>最热帖子</th></tr></thead><tbody>
      ${rows.map((e, i) => `<tr><td class="num">${i + 1}</td><td><b>${h(e.name)}</b>${e.viaPoi ? ' <span class="pf both" title="有帖子带了门店定位">定位</span>' : ''}${e.branches.length ? `<div class="hint">${h(e.branches.join('、'))}</div>` : ''}</td><td class="num">${e.posts}</td><td class="num">${e.mentions}</td><td class="num">${fmt(e.eng)}</td><td class="num">${fmt(e.avgEng)}</td><td>${e.top ? `<a class="ttl" href="${h(e.top.url)}" target="_blank" rel="noopener" title="${h(e.top.title)}">${h(e.top.title || '打开')}</a>` : ''}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="row" style="margin-top:10px"><button class="btn sm" data-action="rs-board-compare">把前 3 名做竞对对比</button><span class="hint">会切换到"品牌/竞对对比"并填好名字</span></div>`;
  }

  function viewContent() {
    const c = A().content;
    if (!c.n) return '<div class="empty"><b>没有帖子</b></div>';
    const maxH = Math.max(1, ...c.hourStats.map(x => x.avgEng));
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const bestH = c.hourStats.filter(x => x.n >= 2).sort((a, b) => b.avgEng - a.avgEng)[0];
    return `<div class="kpis panel" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
        <div><b>${c.n}</b><span>帖子</span></div><div><b>${fmt(c.avgEng)}</b><span>篇均互动</span></div><div><b>${fmt(c.medEng)}</b><span>互动中位数</span></div><div><b>${Math.round(c.collectRate * 100)}%</b><span>收藏/点赞</span></div>
      </div>
      <p class="hint">收藏/点赞越高，说明内容越"有用"（攻略、清单类）；越低说明更偏情绪和颜值。</p>
      <div class="section-h"><h2>哪种标题更容易火</h2><span class="hint">和本次帖子的平均互动比</span></div>
      <div class="tbl-wrap"><table><thead><tr><th>标题套路</th><th class="num">占比</th><th class="num">篇均互动</th><th class="num">比平均</th><th>例子</th></tr></thead><tbody>
        ${c.patterns.map(p => `<tr><td><b>${h(p.name)}</b></td><td class="num">${Math.round(p.share * 100)}%</td><td class="num">${fmt(p.avgEng)}</td><td class="num ${p.lift >= 0 ? 'pos' : 'neg'}">${pctTxt(p.lift)}</td><td class="hint" style="white-space:normal;min-width:180px">${p.ex.map(h).join('<br>')}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="rules" style="margin-top:12px">
        <div class="panel"><b>标题长度</b>${c.lenBuckets.map(b => `<div class="row"><span class="grow">${b.label}</span><span class="hint">${b.n} 篇</span><b style="font-family:var(--f-mono);min-width:56px;text-align:right">${fmt(b.avgEng)}</b></div>`).join('')}
          ${c.types.length > 1 ? `<div class="sep"></div><b>图文 vs 视频</b>${c.types.map(t => `<div class="row"><span class="grow">${t.type === 'video' ? '视频' : '图文'}</span><span class="hint">${t.n} 篇</span><b style="font-family:var(--f-mono);min-width:56px;text-align:right">${fmt(t.avgEng)}</b></div>`).join('')}` : ''}</div>
        <div class="panel"><b>高频话题</b><div class="chips" style="margin-top:6px">${c.tags.length ? c.tags.map(t => `<span class="chip sm" title="篇均互动 ${t.avgEng}">#${h(t.tag)} <b>${t.n}</b></span>`).join('') : '<span class="hint">话题太分散</span>'}</div></div>
      </div>
      ${c.hourStats.length >= 3 ? `<div class="section-h"><h2>发布时段</h2><span class="hint">${bestH ? `${bestH.h} 点发布的篇均互动最高` : '样本还少，仅供参考'}</span></div>
        <div class="panel"><div class="bars">${c.hourStats.map(x => `<div class="b ${bestH && x.h === bestH.h ? 'top' : ''}" style="height:${Math.round(x.avgEng / maxH * 100)}%" title="${x.h}点 · ${x.n} 篇 · 篇均 ${x.avgEng}"></div>`).join('')}</div>
        <div class="bars-x">${c.hourStats.map(x => `<span>${x.h}</span>`).join('')}</div>
        ${c.dayStats.length >= 3 ? `<div class="chips" style="margin-top:8px">${c.dayStats.map(d => `<span class="chip sm">${days[d.d]} <b>${fmt(d.avgEng)}</b></span>`).join('')}</div>` : ''}</div>` : ''}
      <div class="section-h"><h2>爆款 Top ${c.top.length}</h2><span class="hint">可以直接仿写到你的账号，或转成模板反复用</span></div>
      <div class="list">${c.top.map((p, i) => `<div class="item" style="cursor:default;gap:8px"><span class="rank">${i + 1}</span><a class="t" href="${h(p.url)}" target="_blank" rel="noopener" title="${h(p.title)}">${h(p.title || '(无标题)')}</a>
        <span class="m">${fmt(p.eng)} 互动${p.type ? ` · ${p.type === 'video' ? '视频' : '图文'}` : ''}</span>
        <button class="btn sm" data-action="rs-hot-compose" data-id="${h(p.id)}">仿写</button><button class="btn ghost sm" data-action="rs-hot-tpl" data-id="${h(p.id)}">转模板</button></div>`).join('')}</div>`;
  }

  function viewPosts() {
    const run = st.openRun;
    const key = { eng: S.eng, likes: p => n0(p.likes), collects: p => n0(p.collects), comments: p => n0(p.comments), time: p => p.time || 0 }[st.postSort] || S.eng;
    const posts = run.posts.slice().sort((a, b) => key(b) - key(a));
    const multi = new Set(run.posts.map(p => p.group || p.kw)).size > 1 || (run.platforms || []).length > 1;
    return `<div class="row" style="margin-bottom:8px"><span class="hint grow">点标题打开原帖</span><select id="rs-sort" data-rs="postSort" style="width:auto">${[['eng', '按互动'], ['likes', '按点赞'], ['collects', '按收藏'], ['comments', '按评论'], ['time', '按发布时间']].map(([k, l]) => `<option value="${k}" ${st.postSort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="tbl-wrap"><table><thead><tr><th class="num">#</th><th>标题</th>${multi ? '<th>来源</th>' : ''}<th>作者</th><th class="num">赞</th><th class="num">藏</th><th class="num">评</th><th>发布</th><th class="num">采到评论</th></tr></thead><tbody>
      ${posts.map((p, i) => `<tr><td class="num">${i + 1}</td><td><a class="ttl" href="${h(p.url)}" target="_blank" rel="noopener" title="${h(p.title)}">${ttl(p)}</a>${p.poi ? `<div class="hint">📍${h(p.poi)}</div>` : ''}</td>${multi ? `<td class="hint">${(run.platforms || []).length > 1 ? `<span class="pf ${pfClass(p.platform || run.platform)}">${pfName(p.platform || run.platform)}</span> ` : ''}${h(p.group || p.kw)}</td>` : ''}<td>${h(p.author)}</td><td class="num">${fmt(n0(p.likes))}</td><td class="num">${fmt(n0(p.collects))}</td><td class="num">${fmt(n0(p.comments))}</td><td>${p.time ? new Date(p.time).toLocaleDateString('zh-CN') : h(String(p.publishedText || '').slice(0, 10))}</td><td class="num">${p.got || 0}</td></tr>`).join('')}
    </tbody></table></div>`;
  }
  function viewComments() {
    const run = st.openRun; const byId = {}; run.posts.forEach(p => { byId[p.id] = p; });
    let cm = run.comments.map(c => Object.assign({ type: N.classify(c.text, run.industry) }, c)).filter(c => st.cmtType === 'all' || (st.cmtType === 'none' ? !c.type : c.type === st.cmtType)).sort((a, b) => n0(b.likes) - n0(a.likes));
    const total = cm.length; cm = cm.slice(0, 200);
    return `<div class="row" style="margin-bottom:8px"><span class="hint grow">${total} 条${total > 200 ? '，显示点赞最多的 200 条，全部在 Excel 里' : ''}</span>
      <select id="rs-ct" data-rs="cmtType" style="width:auto">${[['all', '全部'], ...N.TYPES.map(t => [t.key, t.short]), ['none', '闲聊/无信息']].map(([k, l]) => `<option value="${k}" ${st.cmtType === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="tbl-wrap"><table><thead><tr><th>评论</th><th class="num">赞</th><th>类型</th><th>来自帖子</th></tr></thead><tbody>
      ${cm.map(c => `<tr><td style="white-space:normal;min-width:220px">${c.stars ? `<span class="stars">${'★'.repeat(Math.round(c.stars))}</span> ` : ''}${h(c.text)}${(c.dishes || []).length ? `<div class="hint">喜欢的菜：${h(c.dishes.join('、'))}</div>` : ''}</td><td class="num">${n0(c.likes) ? fmt(n0(c.likes)) : ''}</td><td>${c.type ? typePill(c.type) : '<span class="hint">—</span>'}</td><td><span class="ttl" style="max-width:140px">${byId[c.postId] ? ttl(byId[c.postId]) : ''}</span></td></tr>`).join('') || '<tr><td colspan="4" class="hint">没有符合条件的评论</td></tr>'}
    </tbody></table></div>`;
  }

  // ---------- 深度洞察 ----------
  const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
  function matrixRow(m) {
    const max = Math.max(0.0001, ...m.cells.map(c => c.rate));
    return `<div class="mx">${m.cells.map(c => `<span class="mx-c ${c.rate === max && c.n ? 'top' : ''}" title="${h(c.g)}：${c.n} 条，占该品牌评论 ${(c.rate * 100).toFixed(1)}%"><em>${h(c.g)}</em><i style="width:${Math.round(c.rate / max * 100)}%"></i><b>${(c.rate * 100).toFixed(1)}%</b></span>`).join('')}</div>`;
  }
  function deepEstimate(run) { const n = Math.min(2400, run.posts.length + run.comments.length); return { n, calls: Math.ceil(n / 90) + 2 }; }
  function deepScope(dp) {
    const g = st.deepBrand; const A = dp.agg;
    if (g === 'all' || !A.brands.some(b => b.name === g)) return { g: 'all', total: A.total, brand: null };
    return { g, total: A.brands.find(b => b.name === g).total, brand: A.brands.find(b => b.name === g) };
  }
  function dimList(list, sc, color) {
    const rows = list.map(x => ({ name: x.name, n: sc.g === 'all' ? x.n : (x.byBrand[sc.g] || 0), q: x.q })).filter(x => x.n).sort((a, b) => b.n - a.n);
    if (!rows.length) return '<span class="hint">没有明确提到</span>';
    const max = Math.max(...rows.map(r => r.n));
    return rows.map(r => `<details class="dim-row"><summary><span class="grow">${h(r.name)}</span><span class="dbar ${color}"><i style="width:${Math.round(r.n / max * 100)}%"></i></span><b>${r.n}</b><span class="hint" style="min-width:34px;text-align:right">${pct(r.n, sc.total)}%</span></summary>
      ${sc.g === 'all' && r.q.length ? `<ul class="hint quotes">${r.q.map(q => `<li>${h(q)}</li>`).join('')}</ul>` : sc.g !== 'all' ? '<div class="hint" style="padding:4px 0 6px">原话见「全部品牌」视图</div>' : ''}</details>`).join('');
  }
  function viewDeep() {
    const run = st.openRun, an = A(); const dp = run.deep; const j = st.deepJob;
    const aiOk = window.Env && Env.aiReady && Env.aiReady();
    const est = deepEstimate(run);
    const item = (I.get(run.industry).item || '产品');
    const ourSel = `<label class="f" style="max-width:260px"><span>我们的品牌（可选）</span><select id="rs-our" data-rs="deepOur"><option value="">不选：当市场调研看</option>${an.groups.map(g => `<option value="${h(g)}" ${(st.deepOur || (dp && dp.ourBrand)) === g ? 'selected' : ''}>${h(g)}</option>`).join('')}</select></label>`;
    const jobBox = j && j.running ? `<div class="banner info">AI 正在逐条阅读… ${j.done}/${j.total} 步 <button class="btn sm danger" data-action="rs-deep-stop" style="margin-left:6px">停止</button></div><div class="bar"><i style="width:${pct(j.done, j.total)}%"></i></div>`
      : j && j.error ? `<div class="banner">${h(j.error)}${!aiOk ? ' <button class="btn sm" data-action="go-settings">去设置</button>' : ''}</div>` : '';
    if (!dp) {
      return `<div class="panel stack">
        <b style="font-size:15px">让 AI 逐条读完帖子和评论，回答 5 个问题</b>
        <div class="deep-q"><span>🍽</span><div><b>顾客喜欢点什么${h(item)}</b><div class="hint">每个${h(item)}被提到多少次、好评率、被夸的具体点（如"皮爽肉滑"）和被吐槽的点</div></div></div>
        <div class="deep-q"><span>🧲</span><div><b>什么吸引他们来</b><div class="hint">招牌、口碑推荐、种草打卡、团购、环境、老字号……各占多少</div></div></div>
        <div class="deep-q"><span>👥</span><div><b>谁在来、什么场景</b><div class="hint">本地人还是游客，家庭、情侣还是朋友聚会</div></div></div>
        <div class="deep-q"><span>🚧</span><div><b>什么让他们不来 / 不再来</b><div class="hint">排队、贵、名不副实、服务……</div></div></div>
        <div class="deep-q"><span>🎯</span><div><b>机会点 + 10 个选题</b><div class="hint">${an.groups.length > 1 ? '分品牌画像对照，' : ''}选了"我们的品牌"会站在你的角度找机会</div></div></div>
        ${an.groups.length > 1 ? ourSel : ''}
        <div class="row">${j && j.running ? '' : `<button class="btn primary" data-action="rs-deep-run">开始深度洞察</button>`}<span class="hint">读 ${est.n} 条，约 ${est.calls} 次 AI 调用${est.n >= 2400 ? '（超过的按点赞和信息量取前 2400 条）' : ''}，DeepSeek 大约几毛钱，2–6 分钟</span></div>
        ${jobBox}
      </div>`;
    }
    const sy = dp.synth || {}; const Ag = dp.agg; const sc = deepScope(dp);
    const multi = Ag.brands.length > 1;
    const our = dp.ourBrand;
    // 产品榜
    let prods = Ag.products.map(p => { const b = sc.g === 'all' ? p : (p.byBrand[sc.g] || { n: 0, pos: 0, neg: 0 }); return Object.assign({}, p, { sn: b.n, spos: b.pos, sneg: b.neg }); }).filter(p => p.sn > 0);
    prods.sort(st.deepProdSort === 'neg' ? (a, b) => b.sneg - a.sneg || b.sn - a.sn : st.deepProdSort === 'pos' ? (a, b) => b.spos - a.spos || b.sn - a.sn : (a, b) => b.sn - a.sn);
    prods = prods.slice(0, 25);
    const maxP = Math.max(1, ...prods.map(p => p.sn));
    const rateCell = p => { const t = p.spos + p.sneg; if (!t) return '<span class="hint">—</span>'; const r = p.spos / t; return `<span class="rate"><i class="pos" style="width:${Math.round(r * 100)}%"></i><i class="neg" style="width:${100 - Math.round(r * 100)}%"></i></span><b class="${r < 0.6 ? 'neg' : r >= 0.85 ? 'pos' : ''}">${Math.round(r * 100)}%</b>`; };
    const brandOf = p => Object.entries(p.byBrand).sort((a, b) => b[1].n - a[1].n).slice(0, 3).map(([b, v]) => `<span class="chip sm ${b === our ? 'our' : ''}">${h(b)} ${v.n}</span>`).join('');
    const prodTable = prods.length ? `<div class="list prod">${prods.map((p, i) => `<div class="item prod-i">
        <div class="row" style="gap:8px;flex-wrap:nowrap"><span class="rank">${i + 1}</span><b class="grow" style="min-width:0;font-size:14px">${h(p.name)}</b>
          <span class="dbar"><i style="width:${Math.round(p.sn / maxP * 100)}%"></i></span><b class="big-num" style="font-size:16px">${p.sn}</b><span class="hint">次</span>
          <span style="white-space:nowrap;min-width:96px;text-align:right">${rateCell(p)}</span></div>
        ${p.posD.length ? `<div class="kv2"><span class="hint">被夸</span><div class="chips">${p.posD.map(([d, n]) => `<span class="chip sm g">${h(d)}${n > 1 ? ` ${n}` : ''}</span>`).join('')}</div></div>` : ''}
        ${p.negD.length ? `<div class="kv2"><span class="hint">被吐槽</span><div class="chips">${p.negD.map(([d, n]) => `<span class="chip sm r">${h(d)}${n > 1 ? ` ${n}` : ''}</span>`).join('')}</div></div>` : ''}
        ${multi && sc.g === 'all' ? `<div class="kv2"><span class="hint">来自</span><div class="chips">${brandOf(p)}</div></div>` : ''}
        <details><summary class="hint link">看原话</summary><ul class="hint quotes">${(p.posQ.length || p.negQ.length ? p.posQ.slice(0, 2).map(q => `<li>👍 ${h(q)}</li>`).concat(p.negQ.slice(0, 2).map(q => `<li>👎 ${h(q)}</li>`)) : p.anyQ.map(q => `<li>${h(q)}</li>`)).join('')}</ul></details>
      </div>`).join('')}</div>` : `<div class="empty"><b>没识别出具体的${h(item)}</b>评论里很少提到具体${h(item)}名。</div>`;
    const profiles = multi && sc.g === 'all' ? `<div class="section-h"><h2>品牌画像对照</h2><span class="hint">顾客眼中每个品牌是什么</span></div>
      <div class="rules">${Ag.brands.map(b => { const sp = (sy.brands || []).find(x => x && (x.name === b.name || String(x.name || '').includes(b.name) || b.name.includes(x.name || '@@'))) || {}; return `<div class="panel stack ${b.name === our ? 'our-card' : ''}" style="gap:6px">
        <div class="row"><b class="grow" style="font-size:15px">${h(b.name)}${b.name === our ? ' <span class="pf ai">我们</span>' : ''}</b>${(() => { const v = run.comments.filter(c => c.group === b.name && c.stars).map(c => c.stars); return v.length ? `<span class="hint">点评 <span class="stars">★</span><b style="color:var(--ink)">${(v.reduce((x, y) => x + y, 0) / v.length).toFixed(1)}</b>（${v.length}）</span>` : ''; })()}<span class="hint">${b.total} 条</span></div>
        ${sp.positioning ? `<div>${h(sp.positioning)}</div>` : ''}
        ${(sp.signature || []).length ? `<div class="kv2"><span class="hint">公认招牌</span><div class="chips">${[].concat(sp.signature).map(x => `<span class="chip sm g">${h(x)}</span>`).join('')}</div></div>` : ''}
        <div class="kv2"><span class="hint">被夸的${h(item)}</span><div class="chips">${b.topPos.map(x => `<span class="chip sm g">${h(x.name)} ${x.n}</span>`).join('') || '<span class="hint">—</span>'}</div></div>
        <div class="kv2"><span class="hint">被吐槽的</span><div class="chips">${b.topNeg.map(x => `<span class="chip sm r">${h(x.name)} ${x.n}</span>`).join('') || '<span class="hint">—</span>'}</div></div>
        <div class="kv2"><span class="hint">为什么来</span><div class="chips">${b.motives.slice(0, 3).map(x => `<span class="chip sm">${h(x.name)} ${pct(x.n, b.total)}%</span>`).join('') || '<span class="hint">—</span>'}</div></div>
        <div class="kv2"><span class="hint">为什么犹豫</span><div class="chips">${b.barriers.slice(0, 3).map(x => `<span class="chip sm r">${h(x.name)} ${pct(x.n, b.total)}%</span>`).join('') || '<span class="hint">—</span>'}</div></div>
        ${(sp.strengths || []).length ? `<div class="kv2"><span class="hint">强项</span><ul class="tight">${[].concat(sp.strengths).map(x => `<li>${h(x)}</li>`).join('')}</ul></div>` : ''}
        ${(sp.weaknesses || []).length ? `<div class="kv2"><span class="hint">短板</span><ul class="tight">${[].concat(sp.weaknesses).map(x => `<li>${h(x)}</li>`).join('')}</ul></div>` : ''}
      </div>`; }).join('')}</div>` : '';
    const opps = (sy.opportunities || []).filter(Boolean);
    const topics = (sy.topics || []).filter(Boolean);
    return `<div class="row" style="margin-bottom:8px"><span class="hint grow">AI 读了 ${Ag.total} 条（${Ag.tagged} 条有具体信息）· ${new Date(dp.at).toLocaleDateString('zh-CN')}${our ? ` · 我们的品牌：${h(our)}` : ''} · 数字 = 提到的条数</span>
        ${an.groups.length > 1 ? `<select id="rs-our" data-rs="deepOur" style="width:auto" title="换了「我们的品牌」后点重新分析"><option value="">不指定我们的品牌</option>${an.groups.map(g => `<option value="${h(g)}" ${(st.deepOur || our) === g ? 'selected' : ''}>我们是：${h(g)}</option>`).join('')}</select>` : ''}
        ${j && j.running ? '' : `<button class="btn ghost sm" data-action="rs-deep-run">重新分析</button>`}</div>
      ${jobBox}
      ${dp.failedBatches ? `<div class="banner">有 ${dp.failedBatches}/${dp.batches} 批 AI 没读成功，数字会偏少，可以重新分析。</div>` : ''}
      ${sy.summary ? `<div class="panel" style="border-left:3px solid var(--accent);margin-bottom:10px"><b>核心结论</b><p style="margin:4px 0 0">${h(sy.summary)}</p></div>` : (!dp.synth ? '<div class="banner">结论和选题没生成成功（统计数据正常），可以点"重新分析"。</div>' : '')}
      ${opps.length ? `<div class="section-h"><h2>机会点</h2>${our ? `<span class="hint">站在「${h(our)}」的角度</span>` : ''}</div>
        <div class="list">${opps.map((o, i) => `<div class="item need" style="cursor:default"><div class="row" style="gap:8px"><span class="rank">${i + 1}</span><b class="grow">${h(o.title)}</b></div>
          ${o.evidence ? `<div class="kv2"><span class="hint">依据</span>${h(o.evidence)}</div>` : ''}${o.action ? `<div class="kv2"><span class="hint">怎么做</span>${h(o.action)}</div>` : ''}</div>`).join('')}</div>` : ''}
      ${multi ? `<div class="chips" style="margin:14px 0 4px" role="group" aria-label="品牌筛选">${['all'].concat(Ag.brands.map(b => b.name)).map(g => `<button class="chip" data-action="rs-deep-brand" data-v="${h(g)}" aria-pressed="${sc.g === g}">${g === 'all' ? '全部品牌' : h(g)}${g === our ? ' · 我们' : ''}</button>`).join('')}</div>` : ''}
      <div class="section-h"><h2>顾客喜欢点什么${h(item)}</h2>
        <div class="right"><select id="rs-psort" data-rs="deepProdSort" style="width:auto">${[['n', '按提到次数'], ['pos', '按好评数'], ['neg', '按差评数']].map(([k, l]) => `<option value="${k}" ${st.deepProdSort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <p class="hint" style="margin-top:0">好评率 = 夸 ÷（夸 + 批评），只提到不算。</p>
      ${prodTable}
      <div class="rules" style="margin-top:14px">
        <div class="panel"><b>什么吸引他们来</b><div class="hint" style="margin-bottom:6px">占${sc.g === 'all' ? '全部' : h(sc.g)}样本的比例</div>${dimList(Ag.motives, sc, 'g')}</div>
        <div class="panel"><b>什么让他们不来 / 不再来</b><div class="hint" style="margin-bottom:6px">顾客的顾虑和劝退点</div>${dimList(Ag.barriers, sc, 'r')}</div>
        <div class="panel"><b>谁在来</b>${dimList(Ag.personas, sc, '')}</div>
        <div class="panel"><b>什么场景来</b>${dimList(Ag.scenes, sc, '')}</div>
      </div>
      ${profiles}
      ${topics.length ? `<div class="section-h"><h2>选题清单</h2><span class="hint">都有数据依据，点"写成内容"直接给矩阵号生成</span></div>
        <div class="list">${topics.map((t, i) => `<div class="item" style="cursor:default;gap:8px;align-items:flex-start"><span class="rank">${i + 1}</span><div class="grow" style="min-width:0"><b>${h(t.title)}</b>${t.format ? ` <span class="chip sm">${h(t.format)}</span>` : ''}
          ${t.angle ? `<div class="hint">${h(t.angle)}</div>` : ''}${t.basis ? `<div class="hint">依据：${h(t.basis)}</div>` : ''}</div>
          <button class="btn sm" data-action="rs-deep-compose" data-i="${i}">写成内容</button></div>`).join('')}</div>` : ''}`;
  }
  async function runDeep() {
    const run = st.openRun; if (!run) return;
    const cfg = window.Env && Env.aiConfig ? Env.aiConfig() : null;
    if (!cfg || !cfg.key) { st.deepJob = { error: '还没设置 AI。在「设置」里填一次 API 密钥（推荐 DeepSeek）。' }; render(); return; }
    const ctl = new AbortController();
    st.deepJob = { running: true, done: 0, total: 1, ctl }; render();
    const our = st.deepOur || (run.deep && run.deep.ourBrand) || '';
    const needsText = run.ai ? run.ai.needs.slice(0, 12).map(n => `${N.TYPE_NAME[n.type]}·${n.name} ${n.count}`).join('；') : '';
    try {
      const res = await window.Deep.run(cfg, { run, pack: run.industry, platform: runPf(run), topic: run.topic, ourBrand: our, needsText, signal: ctl.signal,
        onProgress: (d, t) => { if (st.deepJob) { st.deepJob.done = d; st.deepJob.total = t; render(); } } });
      run.deep = res; st.deepBrand = 'all'; await saveRun(run);
      st.deepJob = null; toast(`识别出 ${res.agg.products.length} 个${res.item}、${res.agg.motives.length} 类吸引因素`);
    } catch (e) { st.deepJob = ctl.signal.aborted ? null : { error: e.message || 'AI 调用失败' }; }
    render();
  }
  function deepSheets(run) {
    const dp = run.deep; if (!dp) return [];
    const Ag = dp.agg, sy = dp.synth || {}, item = dp.item; const brands = Ag.brands.map(b => b.name);
    const out = [];
    out.push({ name: item + '榜', widths: [6, 18, 8, 8, 8, 10, 36, 30].concat(brands.map(() => 12)).concat([60]), rows: [['#', item, '提到', '好评', '差评', '好评率', '被夸的点', '被吐槽的点'].concat(brands).concat(['原话'])].concat(Ag.products.map((p, i) => [i + 1, p.name, p.n, p.pos, p.neg, p.pos + p.neg ? Math.round(p.pos / (p.pos + p.neg) * 100) + '%' : '', p.posD.map(x => `${x[0]}(${x[1]})`).join('、'), p.negD.map(x => `${x[0]}(${x[1]})`).join('、')].concat(brands.map(b => p.byBrand[b] ? `${p.byBrand[b].n}（+${p.byBrand[b].pos}/-${p.byBrand[b].neg}）` : '')).concat([p.posQ.concat(p.negQ).slice(0, 3).join(' / ')]))) });
    const dimSheet = (name, lists) => { const rows = []; lists.forEach(([title, list]) => { rows.push([title, '提到', '占比'].concat(brands.map(b => b + '占比')).concat(['原话'])); list.forEach(x => rows.push([x.name, x.n, pct(x.n, Ag.total) + '%'].concat(Ag.brands.map(b => pct(x.byBrand[b.name] || 0, b.total) + '%')).concat([x.q.join(' / ')]))); rows.push([]); }); return { name, widths: [20, 8, 8].concat(brands.map(() => 12)).concat([70]), rows }; };
    out.push(dimSheet('吸引因素', [['吸引因素', Ag.motives]]));
    out.push(dimSheet('场景客群', [['场景', Ag.scenes], ['客群', Ag.personas]]));
    out.push(dimSheet('阻碍', [['阻碍', Ag.barriers]]));
    if ((sy.brands || []).length) out.push({ name: '品牌画像', widths: [16, 40, 24, 50, 50], rows: [['品牌', '定位', '公认招牌', '强项', '短板']].concat(sy.brands.filter(Boolean).map(b => [b.name, b.positioning || '', [].concat(b.signature || []).join('、'), [].concat(b.strengths || []).join('\n'), [].concat(b.weaknesses || []).join('\n')])) });
    if (sy.summary || (sy.opportunities || []).length) out.push({ name: '机会点', widths: [30, 50, 60], rows: [['核心结论', sy.summary || ''], [], ['机会点', '依据', '怎么做']].concat((sy.opportunities || []).filter(Boolean).map(o => [o.title, o.evidence || '', o.action || ''])) });
    if ((sy.topics || []).length) out.push({ name: '选题', widths: [6, 30, 50, 10, 40], rows: [['#', '选题', '拍什么/写什么', '形式', '依据']].concat(sy.topics.filter(Boolean).map((t, i) => [i + 1, t.title, t.angle || '', t.format || '', t.basis || ''])) });
    return out;
  }

  // ---------- AI 归纳 ----------
  async function runAi() {
    const run = st.openRun; if (!run) return;
    const cfg = window.Env && Env.aiConfig ? Env.aiConfig() : null;
    if (!cfg || !cfg.key) { st.aiJob = { error: '还没设置 AI。在「设置」里填一次 API 密钥（推荐 DeepSeek，几块钱能用很久）。' }; render(); return; }
    const ctl = new AbortController();
    st.aiJob = { running: true, done: 0, total: 1, ctl }; render();
    try {
      const res = await N.aiNeeds(cfg, { comments: run.comments, keywords: run.keywords.map(k => k.group || k.kw), pack: run.industry, platform: runPf(run), topic: run.topic, signal: ctl.signal,
        onProgress: (d, t) => { if (st.aiJob) { st.aiJob.done = d; st.aiJob.total = t; render(); } } });
      run.ai = res; st.useRule = false; st.needGroup = 'all'; await saveRun(run);
      st.aiJob = res.failedBatches ? { error: `有 ${res.failedBatches} 批没归类成功，人数可能偏少。可以点"重新用 AI 归纳"。` } : null;
      toast(`AI 归纳出 ${res.needs.length} 个需求点`);
    } catch (e) { st.aiJob = ctl.signal.aborted ? null : { error: e.message || 'AI 调用失败' }; }
    render();
  }

  // ---------- 导出 ----------
  function exportXlsx() {
    const run = st.openRun, an = A(); const ND = needsData();
    const byId = {}; run.posts.forEach(p => { byId[p.id] = p; });
    const sheets = deepSheets(run).concat([
      { name: '顾客需求点', widths: [8, 26, 10, 40, 40, 30, 50, 50, 50], rows: [['类型', '需求点', '提到人数', '顾客真正要的', '建议做法', '选题', '原话1', '原话2', '原话3']].concat(ND.needs.map(n => [N.TYPE_NAME[n.type], n.name, n.count, n.insight || '', n.action || '', n.angle || '', n.quotes[0] || '', n.quotes[1] || '', n.quotes[2] || ''])) }
    ]);
    const needSheet = sheets.find(x => x.name === '顾客需求点');
    if (ND.summary) needSheet.rows.push([], ['结论', ND.summary]);
    const mx = ND.mode === 'ai' && window.Deep ? Deep.needMatrix(ND.needs, run.comments) : null;
    if (mx) { needSheet.rows[0] = needSheet.rows[0].concat(mx[0].cells.map(c => c.g + '占比')); mx.forEach((m, i) => { if (needSheet.rows[i + 1]) needSheet.rows[i + 1] = needSheet.rows[i + 1].concat(m.cells.map(c => (c.rate * 100).toFixed(1) + '%')); }); }
    if (an.compare) sheets.push({ name: '竞对对比', widths: [18, 8, 8, 10, 10, 10, 36, 36, 36, 40], rows: [['品牌', '帖子', '评论', '篇均互动', '点赞中位数', '差评占比', '主要不满', '主要吸引', '常见疑问', '最热帖子']].concat(an.compare.map(r => [r.group, r.posts, r.comments, r.avgEng, r.medLikes, Math.round(r.painRate * 100) + '%', r.pain.map(x => `${x.name}(${x.count})`).join('、'), r.love.map(x => `${x.name}(${x.count})`).join('、'), r.ask.map(x => `${x.name}(${x.count})`).join('、'), r.best ? r.best.title : ''])) });
    if (an.board) sheets.push({ name: run.mode === 'national' ? '品牌榜' : '店铺榜', widths: [6, 24, 10, 10, 12, 10, 30, 40], rows: [['排名', '名称', '提到的帖子', '评论提及', '总互动', '篇均互动', '分店', '最热帖子']].concat(an.board.map((e, i) => [i + 1, e.name, e.posts, e.mentions, e.eng, e.avgEng, e.branches.join('、'), e.top ? e.top.title : ''])) });
    const c = an.content;
    sheets.push({ name: '爆款拆解', widths: [18, 10, 12, 10, 60], rows: [['标题套路', '占比', '篇均互动', '比平均', '例子']].concat(c.patterns.map(p => [p.name, Math.round(p.share * 100) + '%', p.avgEng, pctTxt(p.lift), p.ex.join(' / ')])).concat([[], ['高频话题', '出现次数', '篇均互动']], c.tags.map(t => ['#' + t.tag, t.n, t.avgEng])).concat([[], ['发布时段', '帖子数', '篇均互动']], c.hourStats.map(x => [x.h + '点', x.n, x.avgEng])) });
    sheets.push({ name: '帖子', widths: [6, 40, 16, 16, 10, 10, 10, 12, 8, 20, 50, 60], rows: [['排名', '标题', '来源关键词', '作者', '点赞', '收藏', '评论', '发布时间', '类型', '定位', '链接', '正文']].concat(run.posts.slice().sort((a, b) => S.eng(b) - S.eng(a)).map((p, i) => [i + 1, p.title, ((run.platforms || []).length > 1 ? pfName(p.platform || run.platform) + ' · ' : '') + (p.group || p.kw), p.author, n0(p.likes), n0(p.collects), n0(p.comments), p.time ? new Date(p.time).toLocaleDateString('zh-CN') : p.publishedText, p.type === 'video' ? '视频' : p.type ? '图文' : '', p.poi || '', p.url, p.desc])) });
    sheets.push({ name: '评论明细', widths: [36, 14, 60, 10, 16, 8, 10, 6, 22, 30], rows: [['来自帖子/店铺', '用户', '评论', '点赞', '时间/地区', '类型', '平台', '星级', '分项分', '喜欢的菜']].concat(run.comments.slice().sort((a, b) => n0(b.likes) - n0(a.likes)).map(cm => { const t = N.classify(cm.text, run.industry); return [byId[cm.postId] ? byId[cm.postId].title : '', cm.name, cm.text, n0(cm.likes), cm.date, t ? N.TYPE_NAME[t] : '', pfName(cm.platform || run.platform), cm.stars || '', Object.entries(cm.scores || {}).map(([k, v]) => k + v).join(' '), (cm.dishes || []).join('、')]; })) });
    const bytes = window.XlsxLite.build(sheets);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = `${run.topic}-${runPf(run)}调研-${run.createdAt.slice(0, 10)}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast('Excel 已下载');
  }

  // ---------- 动作 ----------
  async function act(action, el) {
    const f = st.form;
    switch (action) {
      case 'rs-section': st.section = el.dataset.v; render(); break;
      case 'rs-pf': { const a = formPlatforms(); const v = el.dataset.v; f.platforms = a.includes(v) ? a.filter(x => x !== v) : a.concat(v); if (!f.platforms.length) f.platforms = [v]; f.platform = f.platforms[0]; render(); break; }
      case 'rs-mode': f.mode = el.dataset.v; st.kwEdit = null; render(); break;
      case 'rs-kw-reset': st.kwEdit = null; render(); break;
      case 'rs-kw-del': { const k = plannedKeywords().slice(); k.splice(+el.dataset.i, 1); st.kwEdit = k; render(); break; }
      case 'rs-kw-add': { const k = plannedKeywords().slice(); k.push({ kw: '', must: k[0] ? k[0].must : [], group: '' }); st.kwEdit = k; render(); setTimeout(() => { const x = document.getElementById('rs-kw-' + (k.length - 1)); if (x) x.focus(); }, 30); break; }
      case 'rs-start': start(); break;
      case 'rs-pause': if (st.job) { st.job.paused = true; log('已暂停'); } break;
      case 'rs-resume': if (st.job) { st.job.paused = false; st.job.blocked = null; log('继续'); } break;
      case 'rs-stop': if (st.job) { st.job.stop = true; st.job.paused = false; log('正在停止…'); } break;
      case 'rs-clear-job': st.job = null; render(); break;
      case 'rs-open': await openRun(el.dataset.id); break;
      case 'rs-back': st.openId = null; st.openRun = null; st.analysis = null; st.confirmDel = false; st.aiJob = null; render(); break;
      case 'rs-tab': st.tab = el.dataset.v; render(); break;
      case 'rs-ntype': st.needType = el.dataset.v; render(); break;
      case 'rs-toggle-rule': st.useRule = !st.useRule; render(); break;
      case 'rs-ai-run': runAi(); break;
      case 'rs-deep-run': runDeep(); break;
      case 'rs-deep-stop': if (st.deepJob && st.deepJob.ctl) st.deepJob.ctl.abort(); break;
      case 'rs-deep-brand': st.deepBrand = el.dataset.v; render(); break;
      case 'rs-deep-compose': {
        const t = ((st.openRun.deep || {}).synth || {}).topics; const x = t && t[+el.dataset.i]; if (!x) return;
        window.__rmCompose && window.__rmCompose({ kind: 'need', runId: st.openRun.id, runTopic: st.openRun.topic, industry: st.openRun.industry, need: { name: x.title, type: 'love', count: 0, quotes: [], insight: x.basis || '', action: '', angle: [x.angle, x.format].filter(Boolean).join('（') + (x.format ? '）' : '') } });
        break;
      }
      case 'rs-ai-stop': if (st.aiJob && st.aiJob.ctl) st.aiJob.ctl.abort(); break;
      case 'rs-xlsx': exportXlsx(); break;
      case 'rs-to-compose': {
        const n = needsData().needs[+el.dataset.i]; if (!n) return;
        window.__rmCompose && window.__rmCompose({ kind: 'need', runId: st.openRun.id, runTopic: st.openRun.topic, industry: st.openRun.industry, need: { name: n.name, type: n.type, count: n.count, quotes: n.quotes, insight: n.insight || '', action: n.action || '', angle: n.angle || '' } });
        break;
      }
      case 'rs-hot-compose': case 'rs-hot-tpl': {
        const p = A().content.top.find(x => x.id === el.dataset.id); if (!p) return;
        const payload = { kind: 'hot', runId: st.openRun.id, runTopic: st.openRun.topic, industry: st.openRun.industry, platform: p.platform || st.openRun.platform, post: p, city: st.openRun.city, area: st.openRun.area, exclude: [st.openRun.city, st.openRun.area].concat(st.openRun.keywords.map(k => k.group)).filter(Boolean) };
        if (action === 'rs-hot-tpl') window.__rmHotToTemplate && window.__rmHotToTemplate(payload); else window.__rmCompose && window.__rmCompose(payload);
        break;
      }
      case 'rs-board-compare': {
        const top = (A().board || []).slice(0, 3).map(e => e.name); if (!top.length) return;
        Object.assign(f, { mode: 'brand', brands: top.join('\n'), industry: st.openRun.industry, platform: st.openRun.platform, city: st.openRun.city || '' }); st.kwEdit = null;
        st.openRun = null; st.openId = null; st.analysis = null; render(); window.scrollTo(0, 0); toast('已填好前 3 名，确认后点"开始调研"'); break;
      }
      case 'rs-diag': {
        const run = st.openRun;
        const info = { v: chrome.runtime.getManifest().version, platform: run.platform, topic: run.topic, posts: run.posts.length, comments: run.comments.length, ua: navigator.userAgent.slice(0, 120), diag: run.diag || [] };
        await window.__rmCopy('【矩阵助手诊断】' + JSON.stringify(info), '诊断信息，粘贴发给 Claude'); break;
      }
      case 'rs-askdel': st.confirmDel = true; render(); break;
      case 'rs-nodel': st.confirmDel = false; render(); break;
      case 'rs-del': {
        const id = st.openId; await del(RUN(id)); st.index = st.index.filter(x => x.id !== id); await set(IDX, st.index);
        st.openId = null; st.openRun = null; st.analysis = null; st.confirmDel = false; toast('已删除'); render(); break;
      }
      case 'go-settings': window.__rmGoTab && window.__rmGoTab('settings'); break;
    }
  }
  function attach(root) {
    const onField = e => {
      const t = e.target;
      if (t.dataset && t.dataset.kwi !== undefined) { const k = plannedKeywords().map(x => Object.assign({}, x)); k[+t.dataset.kwi].kw = t.value; st.kwEdit = k; return; }
      const k = t.dataset && t.dataset.rs; if (!k) return;
      const FORM = ['industry', 'platform', 'brands', 'city', 'area', 'cat', 'pos', 'custom', 'must', 'perKw', 'perPost', 'range', 'order', 'strict'];
      if (FORM.includes(k)) {
        st.form[k] = k === 'strict' ? t.checked : ['perKw', 'perPost', 'range'].includes(k) ? +t.value : t.value;
        const TEXT = ['brands', 'city', 'area', 'cat', 'pos', 'custom', 'must'];
        if (TEXT.includes(k) || k === 'industry') st.kwEdit = null;
        if (TEXT.includes(k)) refreshKwBox(); // 文本框不整页重绘，避免打字时丢焦点
        else if (e.type === 'change') render();
      } else if (e.type === 'change') { st[k] = t.value; if (k === 'needGroup') st.ruleCache = null; render(); }
    };
    root.addEventListener('input', onField);
    root.addEventListener('change', onField);
    root.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset && e.target.dataset.kwi !== undefined) { e.preventDefault(); e.target.blur(); } });
    load();
    if (window.Reviews) window.Reviews.attach(root);
  }

  window.Research = { view, act, attach, count: () => st.index.length, list: () => st.index, loadRun, refreshRecords };
})();
