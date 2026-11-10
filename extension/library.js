/* 「爆款」：小红书/抖音餐饮爆款库
 * 采集设置（勾选+填写）→ 关键词组合与轮换 → 搜索采集 → 规则粗筛 → AI 分类（内容类型/场景/品类）
 * → 按类型打分 → 排名靠前的读正文和评论 → AI 拆解卡片 → 被推荐榜 / 新词建议 / 校准标注
 */
(function () {
  'use strict';
  const C = window.Core, I = window.Industries;
  const h = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => Math.round(a + Math.random() * (b - a));
  const toast = m => window.__rmToast && window.__rmToast(m);
  const render = () => { if (window.__rmIsEditing && window.__rmIsEditing()) return; window.__rmRender && window.__rmRender(); };
  const forceRender = () => window.__rmRender && window.__rmRender();
  const fmt = n => C.fmtCount(n);
  const n0 = v => (typeof v === 'number' ? v : C.parseCount(v)) || 0;
  const KEY = 'rm_lib_v1';
  const get = k => new Promise(r => chrome.storage.local.get(k, o => r(o[k])));
  const set = (k, v) => new Promise(r => chrome.storage.local.set({ [k]: v }, r));
  const pfName = p => (p === 'douyin' ? '抖音' : '小红书');

  // ---------- 选项 ----------
  const AREAS = {
    深圳: ['福田', '南山', '罗湖', '宝安', '龙华', '龙岗', '前海', '蛇口', '华强北', '车公庙'],
    广州: ['天河', '越秀', '海珠', '荔湾', '番禺', '白云', '珠江新城', '北京路'],
    上海: ['静安', '徐汇', '黄浦', '浦东', '长宁', '虹口'],
    北京: ['朝阳', '海淀', '东城', '西城', '三里屯', '国贸'],
    杭州: ['西湖', '上城', '拱墅', '滨江'], 成都: ['锦江', '武侯', '青羊', '高新']
  };
  const CATS = ['海鲜大排档', '粤菜', '潮汕菜', '湘菜', '川菜', '火锅', '烧烤', '西餐', '日料', '茶餐厅', '早茶', '江浙菜', '东北菜', '小吃', '咖啡', '茶饮', '烘焙甜品'];
  const SCENES = [
    ['朋友聚会', '朋友聚餐'], ['夜宵', '夜宵'], ['生日', '生日 餐厅'], ['带外地朋友', '带外地朋友 吃什么'], ['约会', '约会 餐厅'], ['带娃', '带娃 吃饭'],
    ['商务请客', '请客 餐厅'], ['一个人吃', '一个人 吃饭'], ['下班', '下班 吃什么'], ['节日', '节日 聚餐'], ['家庭聚餐', '家庭聚餐'], ['游客', '旅游 必吃']
  ];
  const TYPES = [
    { key: 'ask', name: '询问/求推荐', words: ['推荐', '求推荐', '有没有', '哪家好'], main: 'comments', on: true },
    { key: 'guide', name: '攻略合集', words: ['攻略', '必吃', '合集', '地图'], main: 'collects', on: true },
    { key: 'share', name: '素人分享', words: ['和朋友', '周末', '下班', '聚餐'], main: 'eng', on: true },
    { key: 'visit', name: '探店测评', words: ['探店', '测评', '实测'], main: 'eng', on: false },
    { key: 'warn', name: '避雷对比', words: ['避雷', '踩雷', '值不值'], main: 'comments', on: false },
    { key: 'mood', name: '情绪氛围', words: ['氛围感', '小酒', '治愈'], main: 'eng', on: false },
    { key: 'brand', name: '品宣/品牌故事', words: [], main: 'eng', on: false, auto: true },
    { key: 'promo', name: '新品/活动/团购', words: ['新品', '团购', '活动'], main: 'eng', on: false },
    { key: 'scene', name: '后厨/老板/门店现场', words: [], main: 'eng', on: false, auto: true },
    { key: 'other', name: '其他', words: [], main: 'eng', on: false, auto: true }
  ];
  const TYPE = Object.fromEntries(TYPES.map(t => [t.key, t]));
  const INTENT_RE = /(在哪|地址|哪里|位置|人均|多少钱|怎么去|地铁|排队|要等|几点|营业|求店名|店名|叫什么|定位|求链接|哪家|蹲|想去|马住|收藏了|周末去|下次去|已种草)/;

  const defaultCfg = () => ({
    platforms: ['xhs'], cities: ['深圳'], areas: [], areasCustom: [], cats: ['海鲜大排档'], catsCustom: [], scenes: ['朋友聚会', '夜宵', '生日', '带外地朋友'], scenesCustom: [],
    types: Object.fromEntries(TYPES.map(t => [t.key, { on: t.on, words: t.words.slice() }])), brands: [], ourBrand: '',
    perRun: 20, perKw: 30, range: 90, deepMax: 40, removed: [], added: [], accepted: [], rejected: [], accounts: [], monitorOnRun: true
  });
  const ST = { d: null, view: 'lib', job: null, f: { type: 'all', scene: 'all', cat: 'all', pf: 'all', sort: 'score', hot: false, done: false, when: 'all', acct: 'all' }, open: null, addKw: '', addAcct: '', studio: null, stBusy: null };
  async function load() {
    const raw = (await get(KEY)) || {};
    const cfg = Object.assign(defaultCfg(), raw.cfg || {});
    cfg.types = Object.assign(defaultCfg().types, cfg.types || {});
    ST.d = Object.assign({ cfg, posts: {}, kw: {}, lastRun: null }, raw, { cfg });
  }
  const save = () => set(KEY, ST.d);

  // ---------- 关键词组合 ----------
  function scenePhrase(s) { const x = SCENES.find(a => a[0] === s); return x ? x[1] : s; }
  function keywords() {
    const c = ST.d.cfg; const out = new Map();
    const add = (kw, type, pri, src) => { kw = kw.replace(/\s+/g, ' ').trim(); if (!kw || c.removed.includes(kw)) return; const o = out.get(kw); if (!o || o.pri < pri) out.set(kw, { kw, type, pri, src }); };
    c.added.forEach(k => add(k, 'manual', 100, '手动'));
    c.accepted.forEach(k => add(k, 'new', 90, '新词'));
    const locs = [].concat(c.cities.map(x => [x, 1]), c.areas.concat(c.areasCustom).map(x => [x, 0.7]));
    const subjects = [].concat(c.cats.concat(c.catsCustom).map((x, i) => [x, 'cat', 1 - i * 0.05]), c.scenes.concat(c.scenesCustom).map((x, i) => [scenePhrase(x), 'scene', 0.9 - i * 0.04]));
    TYPES.forEach((t, ti) => {
      const tc = c.types[t.key]; if (!tc || !tc.on || !(tc.words || []).length) return;
      const tw = 1 - ti * 0.04;
      locs.forEach(([loc, lw]) => subjects.forEach(([sub, sk, sw]) => tc.words.forEach((w, wi) => {
        if (t.key === 'share' && sk === 'scene' && wi > 0) return; // 素人分享词和场景词意思重叠，只用第一个
        add(`${loc} ${sub} ${w}`, t.key, Math.round(60 * tw * lw * sw * (wi === 0 ? 1 : 0.8 - wi * 0.05)), t.name);
      })));
    });
    c.brands.forEach(b => { add(b, 'brand', 80, '竞品'); add(`${b} 避雷`, 'warn', 55, '竞品'); });
    return [...out.values()].sort((a, b) => b.pri - a.pri).slice(0, 400);
  }
  function nextBatch() {
    const all = keywords(); const k = ST.d.kw;
    const score = x => { const s = k[x.kw]; if (!s) return 1000 + x.pri; const days = (Date.now() - s.last) / 864e5; return x.pri * 0.3 + Math.min(days, 30) * 3 + (s.runs ? (s.hot / s.runs) * 40 - (s.junk / Math.max(1, s.found)) * 30 : 0); };
    return all.map(x => Object.assign({ s: score(x) }, x)).sort((a, b) => b.s - a.s).slice(0, ST.d.cfg.perRun);
  }

  // ---------- 浏览器窗口 ----------
  function waitLoad(tabId, ms) { return new Promise(resolve => { const t0 = Date.now(); (function poll() { chrome.tabs.get(tabId, tab => { if (chrome.runtime.lastError || !tab) return resolve(false); if (tab.status === 'complete' || Date.now() - t0 > (ms || 25000)) return resolve(true); setTimeout(poll, 500); }); })(); }); }
  async function send(tabId, m, timeout) {
    const go = () => Promise.race([chrome.tabs.sendMessage(tabId, m), sleep(timeout || 120000).then(() => ({ ok: false, error: '页面没有响应' }))]);
    try { return await go(); } catch (e) {
      try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js', 'collector.js'] }); } catch (er) { throw new Error('采集窗口被关闭或页面打不开'); }
      await sleep(800); return await go();
    }
  }
  async function nav(url) {
    const j = ST.job;
    if (!j.win) { const w = await chrome.windows.create({ url, focused: false, width: 1200, height: 860, type: 'normal' }); j.win = { id: w.id, tab: w.tabs[0].id }; await waitLoad(j.win.tab); await sleep(rand(2500, 4000)); return; }
    await chrome.tabs.update(j.win.tab, { url }); await waitLoad(j.win.tab); await sleep(rand(2000, 3500));
  }
  function searchUrl(pf, kw, range) {
    return pf === 'douyin' ? `https://www.douyin.com/search/${encodeURIComponent(kw)}?type=video${range && range <= 180 ? '&publish_time=180' : ''}`
      : `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(kw)}&source=web_search_result_notes`;
  }
  function log(t) { if (!ST.job) return; ST.job.log.unshift(new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '  ' + t); ST.job.log = ST.job.log.slice(0, 60); render(); }
  async function waitPause() { while (ST.job && ST.job.paused && !ST.job.stop) await sleep(500); }
  async function blockedPause(reason) {
    ST.job.paused = true; ST.job.blocked = reason; log('暂停：' + reason + '。在采集窗口处理后点"继续"');
    try { await chrome.windows.update(ST.job.win.id, { focused: true }); } catch (e) { /* 已关 */ }
    render(); await waitPause(); ST.job.blocked = null;
  }

  // ---------- 采集 ----------
  async function run(opts) {
    opts = opts || {};
    const c = ST.d.cfg; const batch = opts.onlyAccounts ? [] : nextBatch();
    const accts = (opts.onlyAccounts || c.monitorOnRun) ? c.accounts : [];
    if (!batch.length && !accts.length) { toast(opts.onlyAccounts ? '先在「采集设置」里添加对标账号' : '先在「采集设置」里勾选品类/场景/内容类型'); ST.view = 'cfg'; render(); return; }
    if (ST.job && ST.job.running) return;
    ST.job = { running: true, paused: false, stop: false, log: [], phase: accts.length ? '对标账号' : '搜索', i: 0, n: batch.length * c.platforms.length + accts.length, found: 0, fresh: 0, deep: 0, win: null };
    render();
    const cutoff = Date.now() - c.range * 864e5; const touched = new Set();
    try {
      await monitorAccounts(accts, touched);
      ST.job.phase = '搜索';
      for (const pf of (batch.length ? c.platforms : [])) {
        for (const k of batch) {
          if (ST.job.stop) break; await waitPause();
          ST.job.i++; ST.job.cur = `${pfName(pf)}：${k.kw}`; render();
          await nav(searchUrl(pf, k.kw, c.range));
          let res;
          for (let t = 0; t < 3; t++) { res = await send(ST.job.win.tab, { type: 'rm:collectList', limit: c.perKw }, 240000); if (res && res.blocked && !(res.list || []).length) { await blockedPause(res.blocked); if (ST.job.stop) break; continue; } break; }
          const list = ((res && res.list) || []).filter(x => !x.time || x.time >= cutoff);
          const st = ST.d.kw[k.kw] || (ST.d.kw[k.kw] = { runs: 0, found: 0, hot: 0, junk: 0, last: 0 });
          st.runs++; st.last = Date.now(); st.found += list.length;
          let fresh = 0;
          list.forEach(x => {
            const id = (pf === 'douyin' ? 'dy' : 'xs') + x.id; let p = ST.d.posts[id];
            if (!p) { p = ST.d.posts[id] = { id, raw: x.id, platform: pf, url: x.url, firstSeen: Date.now(), kws: [], kwTypes: [] }; fresh++; }
            Object.assign(p, { title: x.title || p.title || '', author: x.author || p.author || '', authorId: x.authorId || p.authorId || '', cover: x.cover || p.cover || '', time: x.time || p.time || null, lastSeen: Date.now(), url: x.url || p.url });
            ['likes', 'collects', 'comments', 'shares', 'fans'].forEach(f => { if (x[f] !== null && x[f] !== undefined && x[f] !== '') p[f] = n0(x[f]); });
            if (!p.kws.includes(k.kw)) { p.kws.push(k.kw); p.kwTypes.push(k.type); }
            touched.add(id);
          });
          ST.job.found += list.length; ST.job.fresh += fresh;
          log(`${pfName(pf)}「${k.kw}」${list.length} 篇（新 ${fresh}）`);
          await save();
          await sleep(rand(2500, 5000));
        }
      }
      // 规则粗筛 + AI 分类
      const pool = [...touched].map(id => ST.d.posts[id]);
      pool.forEach(p => { if (!p.rule) p.rule = ruleFilter(p); });
      ST.job.phase = '分类'; render();
      await classify(pool.filter(p => p.rule === 'ok' && !p.type));
      // 选候选读正文和评论
      score();
      const cands = pool.filter(p => p.rule === 'ok' && p.relevant !== false && !p.detailAt).sort((a, b) => ((b.outlier ? 60 : 0) + (b.pre || 0)) - ((a.outlier ? 60 : 0) + (a.pre || 0))).slice(0, c.deepMax);
      ST.job.phase = '读正文和评论'; render();
      for (const p of cands) {
        if (ST.job.stop) break; await waitPause();
        ST.job.cur = p.title; render();
        try {
          await nav(p.url);
          let r = await send(ST.job.win.tab, { type: 'rm:readPost', maxComments: 30 }, 120000);
          if (r && !r.ok && r.blocked) { await blockedPause(r.blocked); if (ST.job.stop) break; r = await send(ST.job.win.tab, { type: 'rm:readPost', maxComments: 30 }, 120000); }
          if (!r || !r.ok) { log('跳过：' + ((r && r.error) || '读取失败')); continue; }
          const q = r.post || {};
          Object.assign(p, { desc: q.desc || p.desc || '', tags: q.tags || [], poi: q.poi || '', images: q.images || [], cover: p.cover || q.cover || (q.images || [])[0] || '', ptype: q.type || p.ptype || '', duration: q.duration || null, detailAt: Date.now(),
            comments_list: (r.comments || []).filter(x => !x.reply).slice(0, 30).map(x => ({ n: x.name, t: String(x.text).slice(0, 160), l: x.likes || 0 })) });
          if (q.title) p.title = q.title;
          ['likes', 'collects', 'comments', 'shares', 'fans'].forEach(f => { if (q[f] !== null && q[f] !== undefined && q[f] !== '') p[f] = n0(q[f]); });
          if (q.time) p.time = q.time;
          ST.job.deep++;
          log(`读完：${(p.title || '').slice(0, 18)}（评论 ${p.comments_list.length}）`);
          await save();
        } catch (e) { if (/关闭/.test(e.message)) throw e; log('出错：' + e.message); }
        await sleep(rand(3000, 6000));
      }
      try { if (ST.job.win) await chrome.windows.remove(ST.job.win.id); } catch (e) { /* 已关 */ } ST.job.win = null;
      // 读过正文的再分类一次（更准），然后拆解
      const read = cands.filter(p => p.detailAt);
      await classify(read, true);
      score();
      ST.job.phase = 'AI 拆解'; render();
      await breakdown(read.filter(p => p.relevant !== false).sort((a, b) => (b.score || 0) - (a.score || 0)));
      score();
      // 关键词效果
      batch.forEach(k => { const st = ST.d.kw[k.kw]; if (!st) return; const ps = Object.values(ST.d.posts).filter(p => p.kws.includes(k.kw)); st.hot = ps.filter(p => (p.score || 0) >= 75).length; st.junk = ps.filter(p => p.rule !== 'ok' || p.relevant === false).length; });
      ST.d.lastRun = Date.now();
      log('完成');
    } catch (e) { log('出错：' + e.message); toast(e.message); }
    try { if (ST.job.win) await chrome.windows.remove(ST.job.win.id); } catch (e) { /* 已关 */ }
    ST.job.running = false; await save(); render();
  }
  // ---------- 对标账号 ----------
  function parseAcct(u) {
    u = String(u || '').trim(); let m;
    if ((m = u.match(/xiaohongshu\.com\/user\/profile\/([0-9a-f]{24})/i))) return { platform: 'xhs', key: 'xs' + m[1], url: `https://www.xiaohongshu.com/user/profile/${m[1]}` };
    if ((m = u.match(/douyin\.com\/user\/([A-Za-z0-9_\-]{10,})/))) return { platform: 'douyin', key: 'dy' + m[1], url: `https://www.douyin.com/user/${m[1]}` };
    return null;
  }
  function acctPosts(key) { return Object.values(ST.d.posts).filter(p => p.acct === key); }
  function median(a) { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; }
  function markOutliers(key) {
    const ps = acctPosts(key).filter(p => !p.sticky); const base = median(ps.map(p => metrics(p).eng));
    ps.forEach(p => { p.ratio = base > 0 ? Math.round(metrics(p).eng / base * 10) / 10 : null; p.outlier = ps.length >= 5 && p.ratio >= 3; });
    return base;
  }
  async function monitorAccounts(accts, touched) {
    for (const a of accts) {
      if (ST.job.stop) break; await waitPause();
      ST.job.i++; ST.job.cur = `对标账号：${a.name || a.url}`; render();
      await nav(a.url);
      let r;
      for (let t = 0; t < 3; t++) { r = await send(ST.job.win.tab, { type: 'rm:collectProfile', limit: 30 }, 240000); if (r && !r.ok && r.blocked) { await blockedPause(r.blocked); if (ST.job.stop) break; continue; } break; }
      if (!r || !r.ok) { log(`跳过账号：${(r && (r.error || r.blocked)) || '读取失败'}`); continue; }
      if (r.profile) { if (r.profile.name) a.name = r.profile.name; if (r.profile.fans !== null && r.profile.fans !== undefined) a.fans = r.profile.fans; }
      let fresh = 0;
      (r.list || []).forEach(x => {
        const id = (a.platform === 'douyin' ? 'dy' : 'xs') + x.id; let p = ST.d.posts[id];
        if (!p) { p = ST.d.posts[id] = { id, raw: x.id, platform: a.platform, url: x.url, firstSeen: Date.now(), kws: [], kwTypes: [] }; fresh++; }
        Object.assign(p, { acct: a.key, author: a.name || x.author || p.author || '', title: x.title || p.title || '', cover: x.cover || p.cover || '', time: x.time || p.time || null, sticky: !!x.sticky, lastSeen: Date.now(), url: x.url || p.url, fans: a.fans || p.fans || null });
        ['likes', 'collects', 'comments', 'shares'].forEach(f => { if (x[f] !== null && x[f] !== undefined && x[f] !== '') p[f] = n0(x[f]); });
        p.rule = p.rule || ruleFilter(p); touched.add(id);
      });
      const base = markOutliers(a.key);
      a.lastCheck = Date.now(); a.newCount = fresh;
      ST.job.found += (r.list || []).length; ST.job.fresh += fresh;
      log(`账号「${a.name || a.key}」${(r.list || []).length} 篇（新 ${fresh}，平时互动中位数 ${fmt(Math.round(base))}，爆文 ${acctPosts(a.key).filter(p => p.outlier).length}）`);
      await save();
      await sleep(rand(3000, 6000));
    }
  }

  function ruleFilter(p) {
    const t = (p.title || '') + ' ' + (p.desc || '');
    if (/(抽奖|转发.{0,4}抽|免费送|招聘|求职|兼职|代购|二手|出租|转让)/.test(t)) return '无关';
    if (!p.acct && n0(p.likes) + n0(p.comments) + n0(p.collects) < 10) return '互动太低';
    return 'ok';
  }

  // ---------- AI 分类 ----------
  function classifyPrompt(batch) {
    const c = ST.d.cfg;
    return `你在整理小红书/抖音上的餐饮内容。为每条判断：
- type：内容类型，只能选：ask 询问/求推荐，guide 攻略合集/清单/榜单，share 素人日常分享，visit 探店测评（明显是达人/博主探店），warn 避雷/吐槽/对比，mood 情绪氛围/生活方式，brand 品宣/品牌故事（店家或品牌官方发的），promo 新品/活动/团购，scene 后厨/老板/员工/门店现场，other 其他
- scenes：涉及的场景（可多选，没有就空）：${SCENES.map(s => s[0]).join('、')}
- cat：餐饮品类（如 ${CATS.slice(0, 8).join('、')}，或其他具体品类；看不出写"不明"）
- price：价格带 low（人均<60）/ mid（60–150）/ high（>150）/ 不明
- official：是不是店家/品牌官方账号发的（true/false）
- relevant：和"${[c.cities.join('/'), c.cats.concat(c.catsCustom).join('/')].join(' 的 ')}餐饮获客"有没有参考价值（true/false；和吃饭无关的、纯做饭教程、外卖零食测评、非本行业的写 false）

只输出 JSON 数组：[{"i":1,"type":"ask","scenes":["生日"],"cat":"粤菜","price":"mid","official":false,"relevant":true}]

内容：
${batch.map((p, i) => `${i + 1}. 【${pfName(p.platform)}】${(p.title || '').slice(0, 60)}${p.desc ? ' ｜ ' + p.desc.replace(/\s+/g, ' ').slice(0, 160) : ''}${p.author ? ' ｜ 作者：' + p.author : ''}`).join('\n')}`;
  }
  function ruleType(p) {
    const t = (p.title || '') + ' ' + (p.desc || '').slice(0, 200);
    if (/[?？]|求推荐|有没有|哪家|推荐一下|去哪吃|吃什么好/.test(p.title || '')) return 'ask';
    if (/(攻略|合集|必吃|清单|榜|\d+家|地图|指南)/.test(t)) return 'guide';
    if (/(避雷|踩雷|劝退|别去|值不值|对比|翻车)/.test(t)) return 'warn';
    if (/(探店|测评|实测|打卡了)/.test(t)) return 'visit';
    if (/(新品|上新|团购|活动|限时|优惠|会员日)/.test(t)) return 'promo';
    if (/(氛围|治愈|小酒|emo|浪漫|仪式感)/.test(t)) return 'mood';
    return (p.kwTypes || []).find(k => TYPE[k] && !TYPE[k].auto) || 'share';
  }
  async function classify(list, force) {
    list = list.filter(p => force || !p.type); if (!list.length) return;
    const cfg = window.Env && Env.aiConfig ? Env.aiConfig() : null;
    if (!cfg || !cfg.key) { list.forEach(p => { p.type = ruleType(p); p.cls = 'rule'; }); return; }
    for (let i = 0; i < list.length; i += 25) {
      if (ST.job && ST.job.stop) break;
      const b = list.slice(i, i + 25);
      try {
        const out = await window.AI.json(cfg, classifyPrompt(b), null, { temperature: 0.1 });
        b.forEach((p, j) => { const o = (Array.isArray(out) ? out : []).find(x => +x.i === j + 1); if (!o) { p.type = p.type || ruleType(p); return; } p.type = TYPE[o.type] ? o.type : ruleType(p); p.scenes = Array.isArray(o.scenes) ? o.scenes.slice(0, 4) : []; p.cat = o.cat || ''; p.price = o.price || ''; p.official = !!o.official; p.relevant = o.relevant !== false; p.cls = 'ai'; if (p.official && !['brand', 'promo', 'scene'].includes(p.type) && /品牌|故事|创始|匠心|溯源/.test(p.title || '')) p.type = 'brand'; });
      } catch (e) { b.forEach(p => { p.type = p.type || ruleType(p); }); if (/密钥|余额/.test(e.message)) throw e; }
      if (ST.job) { log(`分类 ${Math.min(i + 25, list.length)}/${list.length}`); }
      await save();
    }
  }

  // ---------- 打分（同类型内比较） ----------
  function metrics(p) {
    const likes = n0(p.likes), col = n0(p.collects), cm = n0(p.comments), sh = n0(p.shares);
    const eng = likes + col * 1.2 + cm * 2 + sh * 1.5;
    const age = Math.max(1, (Date.now() - (p.time || p.firstSeen)) / 864e5);
    const cl = p.comments_list || [];
    const intent = cl.length ? cl.filter(c => INTENT_RE.test(c.t)).length / cl.length : null;
    const fansX = p.fans ? eng / Math.max(100, p.fans) : null;
    return { eng, velocity: eng / Math.pow(age, 0.7), colRate: likes ? col / likes : 0, intent, fansX, cm, col, age };
  }
  function pctRank(vals, v) { if (v === null || v === undefined) return 0.5; const arr = vals.filter(x => x !== null && x !== undefined); if (arr.length < 2) return 0.5; return arr.filter(x => x < v).length / (arr.length - 1 || 1); }
  function score() {
    const posts = Object.values(ST.d.posts).filter(p => p.rule === 'ok' && p.relevant !== false);
    const by = {}; posts.forEach(p => { const t = p.type || ruleType(p); (by[t] = by[t] || []).push(p); });
    const all = posts.map(metrics);
    Object.entries(by).forEach(([t, list]) => {
      const pool = list.length >= 8 ? list : posts; // 同类型太少就和全部比
      const M = pool.map(metrics); const main = TYPE[t] ? TYPE[t].main : 'eng';
      const pick = m => (main === 'comments' ? m.cm : main === 'collects' ? m.col : (m.fansX !== null ? m.fansX * 1000 : m.eng));
      list.forEach(p => {
        const m = metrics(p);
        const s = 0.42 * pctRank(M.map(pick), pick(m)) + 0.25 * pctRank(M.map(x => x.velocity), m.velocity) + 0.13 * pctRank(all.map(x => x.colRate), m.colRate) + 0.2 * (m.intent === null ? 0.5 : Math.min(1, m.intent / 0.35));
        p.score = Math.round(s * 100); if (p.ratio) p.score = Math.round(0.5 * p.score + 50 * Math.min(1, p.ratio / 4)); p.pre = p.pre || Math.round((0.6 * pctRank(all.map(x => x.eng), m.eng) + 0.4 * pctRank(all.map(x => x.velocity), m.velocity)) * 100);
        p.m = { velocity: Math.round(m.velocity), colRate: Math.round(m.colRate * 100), intent: m.intent === null ? null : Math.round(m.intent * 100), fansX: m.fansX === null ? null : Math.round(m.fansX * 10) / 10, age: Math.round(m.age) };
      });
    });
    Object.values(ST.d.posts).filter(p => !(p.rule === 'ok' && p.relevant !== false)).forEach(p => { p.score = 0; });
    posts.forEach(p => { if (p.pre === undefined) p.pre = p.score; });
  }

  // ---------- AI 拆解 ----------
  function breakdownPrompt(batch) {
    const c = ST.d.cfg;
    return `你是餐饮品牌的小红书/抖音内容策略顾问。下面是 ${batch.length} 篇${c.cities.join('/')}餐饮相关的高互动内容（含正文和部分评论）。逐篇拆解"它为什么火、我们能学什么"，给${c.cats.concat(c.catsCustom).join('/') || '餐饮'}门店做参考。只根据给出的内容判断，不编造。

每篇输出：
- i：编号
- why：一句话说清为什么火（≤40字，具体到用了什么钩子/打中什么人群）
- title_formula：标题公式类型（数字清单/价格锚点/人群点名/反差/避雷/提问/情绪/地点+品类/其他）+ 一句说明
- keywords：标题和正文里的搜索关键词（3–6个，适合拿去搜索的词）
- hook：开头怎么抓人
- structure：正文结构，按顺序 3–6 步，每步 ≤12 字
- info：给了哪些实用信息（价格/地址/菜名/排队/营业时间/人数/预约…）
- selling：主打的菜或卖点，以及用了哪些描述词（如"爆汁""锅气"）
- comments：评论区大家在问什么、夸什么、吐槽什么（≤50字；没有评论写"无"）
- intent：评论里有没有明显的到店意图（high/mid/low）
- replicable：1–5 分，可复制程度；depends：依赖什么条件（如 江景、达人出镜、明档、特定菜、大空间；没有写"无"）
- compliance：合规提醒（绝对化用语、导流、医疗功效等；没有写"无"）
- recommended：仅询问帖和攻略合集填写——正文或评论里被推荐的店，[{"shop":"店名","reason":"推荐理由≤15字","n":提到次数}]，最多 8 家；其他类型给 []
- template：照它的结构写一个可复用模板 {"title":"…","body":"…"}，用变量 {{门店名}} {{城市}} {{商圈}} {{招牌菜}} {{价格}}，正文 120–250 字，保留它的结构和语气，不照抄原句

只输出 JSON 数组。

${batch.map((p, i) => `【${i + 1}】${pfName(p.platform)}｜${TYPE[p.type] ? TYPE[p.type].name : ''}｜赞${n0(p.likes)} 藏${n0(p.collects)} 评${n0(p.comments)}
标题：${p.title || ''}
正文：${String(p.desc || '').replace(/\s+/g, ' ').slice(0, 900)}
话题：${(p.tags || []).slice(0, 10).join('、')}
评论：${(p.comments_list || []).slice(0, 25).map(c => c.t).join(' / ').slice(0, 1200) || '无'}`).join('\n\n')}`;
  }
  async function breakdown(list) {
    list = list.filter(p => !p.bd); if (!list.length) return;
    const cfg = window.Env && Env.aiConfig ? Env.aiConfig() : null;
    if (!cfg || !cfg.key) { log('没设置 AI，跳过拆解（在「设置」填 AI 密钥后可以补拆）'); return; }
    for (let i = 0; i < list.length; i += 3) {
      if (ST.job && ST.job.stop) break;
      const b = list.slice(i, i + 3);
      try {
        const out = await window.AI.json(cfg, breakdownPrompt(b), null, { temperature: 0.4, maxTokens: 6000 });
        b.forEach((p, j) => { const o = (Array.isArray(out) ? out : []).find(x => +x.i === j + 1); if (o) { delete o.i; p.bd = o; p.bdAt = Date.now(); } });
      } catch (e) { if (/密钥|余额/.test(e.message)) throw e; }
      if (ST.job) log(`拆解 ${Math.min(i + 3, list.length)}/${list.length}`);
      await save(); render();
    }
  }

  // ---------- 被推荐榜 / 新词 ----------
  const normShop = s => String(s || '').replace(/[（(][^）)]*[)）]/g, '').replace(/[\s·・]/g, '').replace(/(店|餐厅|酒楼)$/, '').trim();
  function board() {
    const m = new Map(); const c = ST.d.cfg; const ours = normShop(c.ourBrand); const comp = c.brands.map(normShop);
    Object.values(ST.d.posts).forEach(p => ((p.bd && p.bd.recommended) || []).forEach(r => {
      const k = normShop(r.shop); if (!k || k.length < 2 || k.length > 16) return;
      const o = m.get(k) || { name: r.shop, n: 0, posts: [], reasons: [] };
      o.n += Math.max(1, +r.n || 1); if (!o.posts.some(x => x.id === p.id)) o.posts.push({ id: p.id, title: p.title, url: p.url, type: p.type }); if (r.reason) o.reasons.push(r.reason);
      m.set(k, o);
    }));
    return [...m.entries()].map(([k, o]) => Object.assign(o, { key: k, ours: !!ours && (k.includes(ours) || ours.includes(k)), comp: comp.some(x => x && (k.includes(x) || x.includes(k))), reasons: [...new Set(o.reasons)].slice(0, 5) })).sort((a, b) => b.posts.length - a.posts.length || b.n - a.n);
  }
  function suggestions() {
    const have = new Set(keywords().map(k => k.kw).concat(ST.d.cfg.rejected, ST.d.cfg.accepted));
    const cnt = {}; const c = ST.d.cfg; const city = c.cities[0] || '';
    Object.values(ST.d.posts).filter(p => (p.score || 0) >= 60).forEach(p => {
      const words = [].concat((p.bd && p.bd.keywords) || [], (p.tags || []).slice(0, 6));
      new Set(words.map(w => String(w).replace(/^#/, '').trim()).filter(w => w.length >= 2 && w.length <= 14)).forEach(w => { cnt[w] = (cnt[w] || 0) + 1; });
    });
    return Object.entries(cnt).filter(([w]) => !/^(美食|好吃|探店|推荐|餐厅|小红书|抖音)$/.test(w)).map(([w, n]) => ({ kw: w.includes(city) || !city ? w : `${city} ${w}`, n, w })).filter(x => !have.has(x.kw)).sort((a, b) => b.n - a.n).slice(0, 15);
  }

  // ---------- 视图 ----------
  function view() {
    if (!ST.d) return '<div class="empty">加载中…</div>';
    const j = ST.job; const n = Object.values(ST.d.posts).filter(p => p.rule === 'ok' && p.relevant !== false).length;
    const tabs = [['lib', '爆款库', null], ['acct', '对标账号', ST.d.cfg.accounts.length || null], ['board', '被推荐榜', null], ...(ST.studio ? [['studio', '二创工作台', null]] : []), ['cfg', '采集设置', null]];
    // 「爆款库」格子暂时换成「同类爆款调研」（结果存进营销部飞书「同类爆款库」）；其他格子仍是原来的爆款采集
    const asRs = ST.view === 'lib' && window.OwnLib && window.OwnLib.researchView;
    if (asRs) return `<nav class="tabs sub" role="tablist" style="margin-top:0">${tabs.map(([k, l, c]) => `<button role="tab" data-action="lb-view" data-v="${k}" aria-selected="${ST.view === k}">${l}${c ? ` <span class="n">${c}</span>` : ''}</button>`).join('')}</nav>
    <div style="margin-top:4px">${window.OwnLib.researchView()}</div>`;
    return `<div class="section-h" style="margin-top:0"><h2>爆款库</h2><span class="hint">按内容类型 × 场景 × 品类收集小红书/抖音餐饮爆款，自动拆解成可学的卡片</span></div>
    <div class="row" style="margin-bottom:10px">
      ${j && j.running ? (j.paused ? `<button class="btn primary sm" data-action="lb-resume">继续</button>` : `<button class="btn sm" data-action="lb-pause">暂停</button>`) + `<button class="btn sm danger" data-action="lb-stop">停止</button>` : `<button class="btn primary" data-action="lb-run">立即更新</button>${ST.d.cfg.accounts.length ? '<button class="btn sm" data-action="lb-run-acct">只查对标账号</button>' : ''}`}
      <span class="hint grow">本次会搜 ${Math.min(ST.d.cfg.perRun, keywords().length)} 个关键词 × ${ST.d.cfg.platforms.map(pfName).join('+')}${ST.d.lastRun ? ` · 上次更新 ${new Date(ST.d.lastRun).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}</span>
    </div>
    ${j ? jobView() : ''}
    <nav class="tabs sub" role="tablist">${tabs.map(([k, l, c]) => `<button role="tab" data-action="lb-view" data-v="${k}" aria-selected="${ST.view === k}">${l}${c ? ` <span class="n">${c}</span>` : ''}</button>`).join('')}</nav>
    <div style="margin-top:12px">${ST.view === 'cfg' ? cfgView() : ST.view === 'board' ? boardView() : ST.view === 'acct' ? acctView() : ST.view === 'studio' && ST.studio ? studioView() : libView()}</div>`;
  }
  function jobView() {
    const j = ST.job;
    return `<div class="panel stack" style="margin-bottom:10px">
      ${j.blocked ? `<div class="banner">${h(j.blocked)}。请切到采集窗口完成验证或登录，然后点"继续"。</div>` : ''}
      <div class="row"><b>${j.running ? h(j.phase) : '更新结束'}</b><span class="hint grow">搜索 ${j.i}/${j.n} · 找到 ${j.found} 篇（新 ${j.fresh}）· 读正文 ${j.deep}</span>${!j.running ? '<button class="btn ghost sm" data-action="lb-clear">关闭</button>' : ''}</div>
      ${j.running ? `<span class="hint">${h(String(j.cur || '').slice(0, 40))}</span>` : ''}
      <pre class="small-pre">${h(j.log.join('\n'))}</pre></div>`;
  }
  function libView() {
    const f = ST.f; const c = ST.d.cfg;
    let list = Object.values(ST.d.posts).filter(p => p.rule === 'ok' && p.relevant !== false);
    if (!list.length) return `<div class="empty"><b>爆款库还是空的</b>先在「采集设置」里勾选城市、品类、场景和内容类型，再点"立即更新"。<br><button class="btn sm" data-action="lb-view" data-v="cfg" style="margin-top:8px">去设置</button></div>`;
    const typeCnt = {}; list.forEach(p => { typeCnt[p.type || 'other'] = (typeCnt[p.type || 'other'] || 0) + 1; });
    const scenesAll = [...new Set(list.flatMap(p => p.scenes || []))]; const catsAll = [...new Set(list.map(p => p.cat).filter(x => x && x !== '不明'))];
    if (f.type !== 'all') list = list.filter(p => (p.type || 'other') === f.type);
    if (f.scene !== 'all') list = list.filter(p => (p.scenes || []).includes(f.scene));
    if (f.cat !== 'all') list = list.filter(p => p.cat === f.cat);
    if (f.pf !== 'all') list = list.filter(p => p.platform === f.pf);
    if (f.hot) list = list.filter(p => (p.score || 0) >= 75);
    if (f.done) list = list.filter(p => p.bd);
    if (f.when !== 'all') list = list.filter(p => inWhen(p, f.when));
    const key = { score: p => p.score || 0, new: p => p.time || 0, velocity: p => (p.m || {}).velocity || 0, collects: p => n0(p.collects), comments: p => n0(p.comments) }[f.sort] || (p => p.score || 0);
    list.sort((a, b) => key(b) - key(a));
    const total = list.length; list = list.slice(0, 60);
    const sel = (id, k, opts) => `<select data-lbf="${k}" style="width:auto">${opts.map(([v, l]) => `<option value="${h(v)}" ${f[k] === v ? 'selected' : ''}>${h(l)}</option>`).join('')}</select>`;
    const labelN = Object.values(ST.d.posts).filter(p => p.label).length;
    return `<div class="chips" style="margin-bottom:8px">${[['all', '全部', Object.values(typeCnt).reduce((a, b) => a + b, 0)]].concat(TYPES.filter(t => typeCnt[t.key]).map(t => [t.key, t.name, typeCnt[t.key]])).map(([k, l, n]) => `<button class="chip" data-action="lb-type" data-v="${k}" aria-pressed="${f.type === k}">${h(l)} ${n}</button>`).join('')}</div>
      <div class="row" style="gap:6px;margin-bottom:10px">
        ${sel('s', 'scene', [['all', '全部场景']].concat(scenesAll.map(s => [s, s])))}
        ${sel('c', 'cat', [['all', '全部品类']].concat(catsAll.map(s => [s, s])))}
        ${c.platforms.length > 1 ? sel('p', 'pf', [['all', '全部平台'], ['xhs', '小红书'], ['douyin', '抖音']]) : ''}
        ${sel('o', 'sort', [['score', '按值得学指数'], ['velocity', '按涨速'], ['collects', '按收藏'], ['comments', '按评论'], ['new', '按发布时间']])}
        <label class="toggle"><input type="checkbox" data-lbf="hot" ${f.hot ? 'checked' : ''}>只看爆款(≥75)</label>
        ${sel('w', 'when', [['all', '全部时间'], ['1d', '昨天以来'], ['7d', '近 7 天'], ['old', '更早']])}
        <label class="toggle"><input type="checkbox" data-lbf="done" ${f.done ? 'checked' : ''}>只看已拆解</label>
        <span class="hint grow" style="text-align:right">${total} 篇${labelN ? ` · 已标注 ${labelN}` : ''}</span>
      </div>
      ${Object.values(ST.d.posts).some(p => p.detailAt && !p.bd && p.relevant !== false) && !(ST.job && ST.job.running) ? `<div class="banner info">有 ${Object.values(ST.d.posts).filter(p => p.detailAt && !p.bd && p.relevant !== false).length} 篇读过正文还没拆解。<button class="btn sm" data-action="lb-bd" style="margin-left:6px">补拆</button></div>` : ''}
      <div class="lib-grid">${list.map(card).join('')}</div>
      ${total > 60 ? `<p class="hint">只显示前 60 篇，用上面的筛选缩小范围</p>` : ''}`;
  }
  function card(p) {
    const t = TYPE[p.type] || TYPE.other; const m = p.m || {}; const bd = p.bd; const open = ST.open === p.id;
    const hot = (p.score || 0) >= 75;
    return `<div class="lib-card ${open ? 'open' : ''}">
      <div class="lib-top">
        <div class="lib-cover-w">${p.cover ? `<img class="lib-cover" src="${h(p.cover)}" referrerpolicy="no-referrer" loading="lazy" alt="">` : ''}<span>${h((TYPE[p.type] || TYPE.other).name.slice(0, 2))}</span></div>
        <div class="lib-main">
          <div class="row" style="gap:4px"><span class="pf ${p.platform}">${pfName(p.platform)}</span><span class="chip sm">${h(t.name)}</span>${(p.scenes || []).slice(0, 2).map(s => `<span class="chip sm g">${h(s)}</span>`).join('')}${p.cat && p.cat !== '不明' ? `<span class="chip sm">${h(p.cat)}</span>` : ''}${p.official ? '<span class="chip sm">官方号</span>' : ''}${p.outlier ? `<span class="chip sm r" title="互动是这个号平时的 ${p.ratio} 倍">本号爆文 ×${p.ratio}</span>` : ''}</div>
          <a class="lib-title" href="${h(p.url)}" target="_blank" rel="noopener">${h(p.title || '(无标题)')}</a>
          <div class="hint">${h(p.author || '')}${p.fans ? ` · ${fmt(p.fans)}粉` : ''} · ${m.age !== undefined ? `${m.age}天前` : ''}</div>
          <div class="lib-nums"><span>赞 <b>${fmt(n0(p.likes))}</b></span><span>藏 <b>${fmt(n0(p.collects))}</b></span><span>评 <b>${fmt(n0(p.comments))}</b></span>${m.intent !== null && m.intent !== undefined ? `<span title="评论里问地址/人均/排队/想去的比例">到店意图 <b>${m.intent}%</b></span>` : ''}${m.fansX ? `<span title="互动 ÷ 粉丝">粉丝倍数 <b>${m.fansX}</b></span>` : ''}</div>
        </div>
        <div class="lib-score ${hot ? 'hot' : ''}" title="值得学指数：同类型内比较">${p.score || 0}</div>
      </div>
      ${bd ? `<div class="lib-why">${h(bd.why || '')}</div>` : p.detailAt ? '<div class="hint">已读正文，待拆解</div>' : ''}
      <div class="row" style="gap:4px">
        ${bd ? `<button class="btn ghost sm" data-action="lb-open" data-id="${h(p.id)}">${open ? '收起拆解' : '看拆解'}</button>` : ''}
        <button class="btn sm" data-action="lb-tpl" data-id="${h(p.id)}">转模板</button>
        <button class="btn sm" data-action="lb-compose" data-id="${h(p.id)}">仿写</button>
        <button class="btn sm primary" data-action="lb-studio" data-id="${h(p.id)}">二创</button>
        <span class="grow"></span>
        <button class="btn ghost sm ${p.label === 'good' ? 'on' : ''}" data-action="lb-label" data-v="good" data-id="${h(p.id)}" title="值得学">👍</button>
        <button class="btn ghost sm ${p.label === 'bad' ? 'on' : ''}" data-action="lb-label" data-v="bad" data-id="${h(p.id)}" title="不值得学">👎</button>
      </div>
      ${open && bd ? bdView(p) : ''}
    </div>`;
  }
  function bdView(p) {
    const b = p.bd; const row = (k, v) => v && (Array.isArray(v) ? v.length : String(v).trim()) ? `<div class="kv2"><span class="hint">${k}</span><div>${Array.isArray(v) ? v.map(h).join(' → ') : h(v)}</div></div>` : '';
    return `<div class="lib-bd stack" style="gap:6px">
      ${row('标题公式', b.title_formula)}${row('开头钩子', b.hook)}${row('正文结构', b.structure)}${row('实用信息', Array.isArray(b.info) ? b.info.join('、') : b.info)}${row('卖点', b.selling)}
      ${row('评论区', b.comments)}${row('到店意图', ({ high: '高', mid: '中', low: '低' })[b.intent] || b.intent)}${row('可复制', b.replicable ? `${b.replicable}/5${b.depends && b.depends !== '无' ? `（依赖：${b.depends}）` : ''}` : '')}${row('合规提醒', b.compliance && b.compliance !== '无' ? b.compliance : '')}
      ${row('关键词', (b.keywords || []).join('、'))}
      ${(b.recommended || []).length ? `<div class="kv2"><span class="hint">被推荐的店</span><div class="chips">${b.recommended.map(r => `<span class="chip sm">${h(r.shop)}${r.n > 1 ? ` ×${r.n}` : ''}</span>`).join('')}</div></div>` : ''}
      ${b.template ? `<details><summary class="hint link">可复用模板</summary><div class="panel tight" style="white-space:pre-wrap;font-size:13px"><b>${h(b.template.title || '')}</b>\n${h(b.template.body || '')}</div></details>` : ''}
      ${(p.comments_list || []).length ? `<details><summary class="hint link">评论原话（${p.comments_list.length}）</summary><ul class="hint quotes">${p.comments_list.slice(0, 12).map(c => `<li>${h(c.t)}${c.l ? ` <span>赞${c.l}</span>` : ''}</li>`).join('')}</ul></details>` : ''}
    </div>`;
  }
  function boardView() {
    const B = board(); const c = ST.d.cfg;
    if (!B.length) return `<div class="empty"><b>还没有数据</b>被推荐榜来自"询问/求推荐"和"攻略合集"类帖子的拆解：正文和评论里大家推荐了哪些店。勾上这两种内容类型，更新并拆解后就会出现。</div>`;
    const oursRank = B.findIndex(x => x.ours);
    return `<p class="hint" style="margin-top:0">统计 ${Object.values(ST.d.posts).filter(p => p.bd && (p.bd.recommended || []).length).length} 篇询问帖和攻略里被推荐的店：出现在几篇帖子里、被提到几次、大家为什么推荐它。${c.ourBrand ? (oursRank >= 0 ? `<b>「${h(c.ourBrand)}」排第 ${oursRank + 1}。</b>` : `<b>「${h(c.ourBrand)}」还没出现在这些帖子里。</b>`) : '在「采集设置」填"我们的品牌"，可以看到自己排第几。'}</p>
    <div class="list">${B.slice(0, 40).map((x, i) => `<div class="item need ${x.ours ? 'our-card' : ''}" style="cursor:default">
      <div class="row" style="gap:8px"><span class="rank">${i + 1}</span><b class="grow">${h(x.name)}${x.ours ? ' <span class="pf ai">我们</span>' : x.comp ? ' <span class="chip sm">竞品</span>' : ''}</b><span class="hint">${x.posts.length} 篇帖子 · 提到 ${x.n} 次</span></div>
      ${x.reasons.length ? `<div class="chips">${x.reasons.map(r => `<span class="chip sm g">${h(r)}</span>`).join('')}</div>` : ''}
      <details><summary class="hint link">出自哪些帖子</summary><ul class="hint quotes">${x.posts.map(q => `<li><a href="${h(q.url)}" target="_blank" rel="noopener">${h((q.title || '').slice(0, 40))}</a> · ${h((TYPE[q.type] || TYPE.other).name)}</li>`).join('')}</ul></details>
    </div>`).join('')}</div>`;
  }
  function chipSet(field, opts, custom) {
    const c = ST.d.cfg; const sel = c[field];
    return `<div class="chips">${opts.map(o => `<button class="chip" data-action="lb-toggle" data-f="${field}" data-v="${h(o)}" aria-pressed="${sel.includes(o)}">${h(o)}</button>`).join('')}
      ${(c[custom] || []).map(o => `<button class="chip" aria-pressed="true" data-action="lb-rmcustom" data-f="${custom}" data-v="${h(o)}" title="点击移除">${h(o)} ✕</button>`).join('')}
      <input type="text" class="chip-in" data-lbadd="${custom}" placeholder="+ 自己填，回车"></div>`;
  }
  function cfgView() {
    const c = ST.d.cfg; const kws = keywords(); const batch = nextBatch(); const sug = suggestions();
    const areaOpts = [...new Set(c.cities.flatMap(x => AREAS[x] || []))];
    return `<div class="stack">
      <div class="panel stack">
        <b>① 平台和地点</b>
        <div class="chips">${[['xhs', '小红书'], ['douyin', '抖音']].map(([k, l]) => `<button class="chip" data-action="lb-toggle" data-f="platforms" data-v="${k}" aria-pressed="${c.platforms.includes(k)}">${l}</button>`).join('')}</div>
        <div class="kv2"><span class="hint">城市</span><div class="chips">${c.cities.map(x => `<button class="chip" aria-pressed="true" data-action="lb-rmcustom" data-f="cities" data-v="${h(x)}" title="点击移除">${h(x)} ✕</button>`).join('')}<input type="text" class="chip-in" data-lbadd="cities" placeholder="+ 城市，回车"></div></div>
        <div class="kv2"><span class="hint">商圈</span>${chipSet('areas', areaOpts, 'areasCustom')}</div>
      </div>
      <div class="panel stack"><b>② 品类</b>${chipSet('cats', CATS, 'catsCustom')}</div>
      <div class="panel stack"><b>③ 场景</b>${chipSet('scenes', SCENES.map(s => s[0]), 'scenesCustom')}</div>
      <div class="panel stack"><b>④ 内容类型</b><span class="hint">每种类型自带一组"类型词"，和地点、品类/场景组合成关键词。品宣、后厨现场这类很少能搜到，等下一版的"对标账号监控"。</span>
        ${TYPES.filter(t => !t.auto).map(t => { const tc = c.types[t.key] || { on: false, words: [] }; return `<div class="row" style="gap:6px;flex-wrap:nowrap"><label class="toggle" style="min-width:120px"><input type="checkbox" data-lbtype="${t.key}" ${tc.on ? 'checked' : ''}>${h(t.name)}</label><input type="text" data-lbwords="${t.key}" value="${h((tc.words || []).join('、'))}" placeholder="类型词，用顿号隔开"></div>`; }).join('')}
      </div>
      <div class="panel stack"><b>⑤ 竞品和我们</b>
        <div class="kv2"><span class="hint">竞品/对标品牌</span><div class="chips">${c.brands.map(x => `<button class="chip" aria-pressed="true" data-action="lb-rmcustom" data-f="brands" data-v="${h(x)}" title="点击移除">${h(x)} ✕</button>`).join('')}<input type="text" class="chip-in" data-lbadd="brands" placeholder="+ 品牌名，回车"></div></div>
        <label class="f"><span>我们的品牌（被推荐榜里标出来）</span><input type="text" data-lbcfg="ourBrand" value="${h(c.ourBrand)}" placeholder="如：YES"></label>
      </div>
      <div class="panel stack"><b>⑥ 采集量</b>
        <div class="grid3">
          <label class="f"><span>每次搜几个关键词</span><select data-lbnum="perRun">${[10, 15, 20, 30, 40].map(n => `<option ${c.perRun === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="f"><span>每个关键词抓</span><select data-lbnum="perKw">${[20, 30, 50].map(n => `<option value="${n}" ${c.perKw === n ? 'selected' : ''}>${n} 篇</option>`).join('')}</select></label>
          <label class="f"><span>发布时间</span><select data-lbnum="range">${[[30, '近 1 个月'], [90, '近 3 个月'], [180, '近半年']].map(([v, l]) => `<option value="${v}" ${c.range === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        <label class="f"><span>每次最多深读和拆解</span><select data-lbnum="deepMax">${[20, 40, 60, 100].map(n => `<option value="${n}" ${c.deepMax === n ? 'selected' : ''}>${n} 篇（排名最靠前的）</option>`).join('')}</select></label>
        <span class="hint">预计每次 ${Math.round((Math.min(c.perRun, kws.length) * c.platforms.length * 18 + c.deepMax * 14) / 60)} 分钟左右。同一账号一天别跑太多次。</span>
      </div>
      <div class="panel stack"><div class="row"><b>将搜索的关键词</b><span class="hint grow">共 ${kws.length} 个，每次按优先级轮换 ${c.perRun} 个；没搜过的和爆款多的优先</span></div>
        <div class="kwlist">${kws.slice(0, 80).map(k => { const s = ST.d.kw[k.kw]; const inBatch = batch.some(b => b.kw === k.kw); return `<div class="row kwrow ${inBatch ? 'next' : ''}"><span class="grow">${h(k.kw)}</span><span class="hint">${h(k.src)}${s ? ` · 搜过${s.runs}次 · 爆款${s.hot}` : ''}</span>${inBatch ? '<span class="chip sm g">下一批</span>' : ''}<button class="btn ghost sm" data-action="lb-kwdel" data-v="${h(k.kw)}" title="删除">✕</button></div>`; }).join('')}
        ${kws.length > 80 ? `<div class="hint">…还有 ${kws.length - 80} 个</div>` : ''}</div>
        <div class="row" style="gap:6px"><input type="text" id="lb-addkw" data-lbstate="addKw" value="${h(ST.addKw)}" placeholder="自己加一个关键词，如：深圳 港人北上 吃什么"><button class="btn sm" data-action="lb-kwadd">添加</button></div>
        ${c.removed.length ? `<details><summary class="hint link">已删除的关键词（${c.removed.length}）</summary><div class="chips">${c.removed.map(k => `<button class="chip sm" data-action="lb-kwback" data-v="${h(k)}" title="恢复">${h(k)} ↺</button>`).join('')}</div></details>` : ''}
      </div>
      ${sug.length ? `<div class="panel stack"><b>系统建议的新词</b><span class="hint">来自爆款的话题和标题关键词，点"要"会加入轮换</span>
        ${sug.map(s => `<div class="row kwrow"><span class="grow">${h(s.kw)}</span><span class="hint">${s.n} 篇爆款用过</span><button class="btn sm" data-action="lb-sug" data-v="${h(s.kw)}" data-ok="1">要</button><button class="btn ghost sm" data-action="lb-sug" data-v="${h(s.kw)}" data-ok="0">不要</button></div>`).join('')}</div>` : ''}
      <div class="panel stack"><b>⑦ 对标账号</b><span class="hint">粘贴博主主页链接（小红书 xiaohongshu.com/user/profile/…，抖音 douyin.com/user/…），一行一个。每次更新会看他们的新作品，标出比这个号平时好很多的爆文。品牌号、本地美食号、做得好的商家号、优秀素人号都可以加。</span>
        <textarea rows="3" data-lbstate="addAcct" placeholder="https://www.xiaohongshu.com/user/profile/…&#10;https://www.douyin.com/user/…">${h(ST.addAcct)}</textarea>
        <div class="row"><button class="btn sm" data-action="lb-acct-add">添加</button><label class="toggle"><input type="checkbox" data-lbcheck="monitorOnRun" ${c.monitorOnRun ? 'checked' : ''}>"立即更新"时也检查对标账号</label></div>
        ${c.accounts.length ? `<div class="list">${c.accounts.map(a => `<div class="item" style="cursor:default"><span class="pf ${a.platform}">${pfName(a.platform)}</span><a class="t" href="${h(a.url)}" target="_blank" rel="noopener">${h(a.name || a.url)}</a><span class="m">${a.fans ? fmt(a.fans) + '粉 · ' : ''}${a.lastCheck ? '已检查' : '未检查'}</span><button class="btn ghost sm" data-action="lb-acct-del" data-v="${h(a.key)}">✕</button></div>`).join('')}</div>` : ''}
      </div>
      <div class="row"><button class="btn ghost sm" data-action="lb-reset">恢复默认设置</button><span class="hint">设置改动会自动保存</span></div>
    </div>`;
  }

  function inWhen(p, w) {
    const t = p.time || p.firstSeen; const age = (Date.now() - t) / 864e5;
    return w === '1d' ? age <= 2 : w === '7d' ? age <= 7 : w === 'old' ? age > 7 : true;
  }
  function acctView() {
    const c = ST.d.cfg;
    if (!c.accounts.length) return `<div class="empty"><b>还没有对标账号</b>在「采集设置 → ⑦ 对标账号」粘贴博主主页链接，插件会定期看他们的新作品，标出本号爆文。<br><button class="btn sm" data-action="lb-view" data-v="cfg" style="margin-top:8px">去添加</button></div>`;
    const sel = ST.f.acct;
    let posts = Object.values(ST.d.posts).filter(p => p.acct && (sel === 'all' || p.acct === sel)).sort((a, b) => (b.time || 0) - (a.time || 0));
    const groups = [['昨天以来', p => inWhen(p, '1d')], ['近 7 天', p => !inWhen(p, '1d') && inWhen(p, '7d')], ['更早', p => inWhen(p, 'old')]];
    return `<div class="list" style="margin-bottom:10px">${c.accounts.map(a => { const ps = acctPosts(a.key); const out = ps.filter(p => p.outlier).length; const wk = ps.filter(p => inWhen(p, '7d')).length;
        return `<div class="item" data-action="lb-acct-f" data-v="${h(sel === a.key ? 'all' : a.key)}" aria-selected="${sel === a.key}"><span class="pf ${a.platform}">${pfName(a.platform)}</span><span class="t">${h(a.name || a.url)}</span><span class="m">${a.fans ? fmt(a.fans) + '粉 · ' : ''}${ps.length} 篇 · 近 7 天 ${wk} · 爆文 ${out}${a.newCount ? ` · <b>新 ${a.newCount}</b>` : ''}</span></div>`; }).join('')}</div>
      ${!posts.length ? '<div class="empty"><b>还没抓到作品</b>点上面的"只查对标账号"。</div>' : groups.map(([name, fn]) => { const ps = posts.filter(fn); return ps.length ? `<div class="section-h"><h2>${name}</h2><span class="hint">${ps.length} 篇${ps.filter(p => p.outlier).length ? ` · 爆文 ${ps.filter(p => p.outlier).length}` : ''}</span></div><div class="lib-grid">${ps.slice(0, 30).map(card).join('')}</div>` : ''; }).join('')}`;
  }

  // ---------- 二创工作台 ----------
  const PERSONA_N = { owner: '老板/店长', chef: '厨师', staff: '店员', foodie: '美食博主', local: '本地生活号', customer: '顾客视角' };
  function draftOf() { const d = (ST.d.drafts = ST.d.drafts || {}); return d[ST.studio] || (d[ST.studio] = { format: ST.d.posts[ST.studio] && ST.d.posts[ST.studio].ptype === 'video' ? 'script' : 'note', accountId: '', focus: '', extra: '', titles: [], title: '', lines: [], tags: [], cover: '' }); }
  function accounts() { return ((window.Store && Store.state && Store.state.accounts) || []).filter(a => a.status !== 'paused'); }
  function fullText(d) {
    if (d.format === 'script') return `${d.title}\n\n${d.lines.map((l, i) => `${i + 1}. 【${l.role}】${l.text}${l.shot ? `\n   镜头：${l.shot}` : ''}`).join('\n')}${d.tags.length ? '\n\n' + d.tags.map(t => '#' + t).join(' ') : ''}`;
    return `${d.title}\n\n${d.lines.map(l => l.text).join('\n')}${d.tags.length ? '\n\n' + d.tags.map(t => '#' + t).join(' ') : ''}`;
  }
  function brandText(d) {
    const a = accounts().find(x => x.id === d.accountId);
    const prof = (window.Comments && window.Comments._st && window.Comments._st.data && window.Comments._st.data.profile) || {};
    const facts = Object.assign({}, a ? a.vars || {} : {}, { 门店地址: prof.address, 营业时间: prof.hours, 人均: prof.price, 招牌菜: prof.signature, 排队: prof.queue });
    return [a ? `账号：${a.name}（${pfName(a.platform)}），人设：${PERSONA_N[a.persona] || a.persona || '店长'}，语气：${a.tone || '亲切自然'}` : '账号：门店官方号，人设：店长',
      `门店信息：${Object.entries(facts).filter(([, v]) => String(v || '').trim()).map(([k, v]) => `${k}=${v}`).join('；') || '（没填）'}`].join('\n');
  }
  function studioPrompt(p, d) {
    const b = p.bd || {}; const isScript = d.format === 'script';
    return `你是餐饮品牌的${isScript ? '短视频编导' : '小红书内容编辑'}。下面是一篇爆款${p.ptype === 'video' ? '视频' : '笔记'}，请照它"火的结构和节奏"，给我们的账号二创一版${isScript ? '口播脚本' : '图文笔记'}。

【原爆款】
标题：${p.title || ''}
正文/文案：${String(p.desc || '').slice(0, 1500) || '（只有标题）'}
${b.why ? `为什么火：${b.why}\n` : ''}${(b.structure || []).length ? `原结构：${b.structure.join(' → ')}\n` : ''}${b.hook ? `开头钩子：${b.hook}\n` : ''}评论区：${b.comments || (p.comments_list || []).slice(0, 10).map(c => c.t).join(' / ').slice(0, 400) || '无'}

【我们】
${brandText(d)}
这次主推：${d.focus || '（没指定，从招牌菜里选最合适的）'}
${d.extra ? `补充要求：${d.extra}\n` : ''}
要求：
- 保留原爆款的结构顺序、节奏和情绪，但每一句都要重写，不照抄原句
- 只用"我们"给出的事实（菜名、价格、地址、营业时间），没给的不要编；不写"最""第一""全网"等绝对化用语；不留联系方式、不引导私信
- ${isScript ? '口播脚本：8–14 句，每句一行，口语化、短句，第一句 3 秒内抓人；每句给一个镜头建议（拍什么）' : '图文笔记：正文 6–12 段/句，小红书语气，适当分段和表情，末尾一句引导互动'}
- 每一句标出作用 role（钩子/痛点/铺垫/卖点/证据/转折/价格/场景/引导互动/结尾），orig 写它对应原爆款里的哪一句或哪一步（≤20字）

只输出 JSON：{"titles":["标题1","标题2","标题3"],"lines":[{"role":"钩子","orig":"…","text":"…","shot":"${isScript ? '…' : ''}"}],"tags":["话题1","话题2"],"cover":"封面建议（一句话：拍什么、封面写什么字）"}`;
  }
  async function genStudio() {
    const p = ST.d.posts[ST.studio]; const d = draftOf(); if (!p) return;
    const cfg = window.Env && Env.aiConfig ? Env.aiConfig() : null;
    if (!cfg || !cfg.key) { toast('二创需要 AI：先在「设置」里填 API 密钥'); return; }
    readStudioFields(d);
    ST.stBusy = 'all'; render();
    try {
      const o = await window.AI.json(cfg, studioPrompt(p, d), null, { temperature: 0.8, maxTokens: 4000 });
      d.titles = (o.titles || []).map(String).slice(0, 3); d.title = d.titles[0] || d.title;
      d.lines = (o.lines || []).filter(l => l && l.text).map(l => ({ role: String(l.role || ''), orig: String(l.orig || ''), text: String(l.text), shot: String(l.shot || '') }));
      d.tags = (o.tags || []).map(t => String(t).replace(/^#/, '')).slice(0, 10); d.cover = String(o.cover || ''); d.at = Date.now();
      await save(); toast('二创写好了，每一句都可以改');
    } catch (e) { toast('AI 调用失败：' + e.message); }
    ST.stBusy = null; render();
  }
  async function rewriteLine(i) {
    const p = ST.d.posts[ST.studio]; const d = draftOf(); const l = d.lines[i]; if (!l) return;
    const cfg = window.Env && Env.aiConfig ? Env.aiConfig() : null;
    if (!cfg || !cfg.key) { toast('需要先在「设置」里填 AI 密钥'); return; }
    readStudioFields(d);
    const hint = ((document.getElementById('lb-st-hint-' + i) || {}).value || '').trim();
    ST.stBusy = i; render();
    try {
      const o = await window.AI.json(cfg, `下面是一篇${d.format === 'script' ? '口播脚本' : '小红书笔记'}，请只重写第 ${i + 1} 句（作用：${l.role}），让它更抓人、更自然，和前后句衔接顺畅。${hint ? `要求：${hint}。` : ''}只用已有的事实，不写绝对化用语。
${brandText(d)}
全文：
${d.lines.map((x, k) => `${k + 1}. 【${x.role}】${x.text}`).join('\n')}
只输出 JSON：{"text":"新的第 ${i + 1} 句","shot":"${d.format === 'script' ? '镜头建议' : ''}"}`, null, { temperature: 0.9, maxTokens: 600 });
      if (o && o.text) { l.text = String(o.text); if (o.shot) l.shot = String(o.shot); await save(); }
    } catch (e) { toast('AI 调用失败：' + e.message); }
    ST.stBusy = null; render();
  }
  function readStudioFields(d) {
    const v = id => (document.getElementById(id) || {}).value;
    if (v('lb-st-focus') !== undefined) d.focus = v('lb-st-focus');
    if (v('lb-st-extra') !== undefined) d.extra = v('lb-st-extra');
    if (v('lb-st-titlein') !== undefined) d.title = v('lb-st-titlein');
    d.lines.forEach((l, i) => { const t = v('lb-st-l-' + i); if (t !== undefined) l.text = t; const s = v('lb-st-s-' + i); if (s !== undefined) l.shot = s; });
  }
  function studioView() {
    const p = ST.d.posts[ST.studio]; if (!p) return '<div class="empty">这篇已经不在库里了</div>';
    const d = draftOf(); const busy = ST.stBusy; const acs = accounts(); const isScript = d.format === 'script';
    return `<div class="row" style="margin-bottom:8px"><button class="btn ghost sm" data-action="lb-st-close">← 返回爆款库</button><span class="hint grow">照爆款的结构和节奏，给我们的账号重写一版；每一句都能改，也能单独让 AI 重写</span></div>
    <div class="studio">
      <div class="panel stack studio-src">
        <b>原爆款</b>
        <a href="${h(p.url)}" target="_blank" rel="noopener" style="font-weight:600">${h(p.title || '(无标题)')}</a>
        <div class="hint">${pfName(p.platform)} · ${h(p.author || '')} · 赞 ${fmt(n0(p.likes))} 藏 ${fmt(n0(p.collects))} 评 ${fmt(n0(p.comments))}</div>
        ${p.bd && p.bd.why ? `<div class="lib-why">${h(p.bd.why)}</div>` : ''}
        ${p.bd && (p.bd.structure || []).length ? `<div class="kv2"><span class="hint">结构</span><div>${p.bd.structure.map(h).join(' → ')}</div></div>` : ''}
        <details ${p.desc ? '' : 'open'}><summary class="hint link">原文</summary><div class="hint" style="white-space:pre-wrap">${h(p.desc || '（还没读正文：在爆款库里更新一次，排名靠前的会自动读）')}</div></details>
        ${p.ptype === 'video' ? '<span class="hint">视频的口播逐字稿还没接入（下一步做），现在按标题、文案、评论和拆解来二创。</span>' : ''}
      </div>
      <div class="panel stack">
        <div class="grid2">
          <label class="f"><span>写成</span><select data-lbst="format"><option value="note" ${!isScript ? 'selected' : ''}>图文笔记</option><option value="script" ${isScript ? 'selected' : ''}>口播脚本（带镜头）</option></select></label>
          <label class="f"><span>发在哪个账号（用它的人设和门店信息）</span><select data-lbst="accountId"><option value="">门店官方号</option>${acs.map(a => `<option value="${h(a.id)}" ${d.accountId === a.id ? 'selected' : ''}>${h(a.name)} · ${pfName(a.platform)}</option>`).join('')}</select></label>
        </div>
        <label class="f"><span>这次主推（菜品/卖点/活动）</span><input type="text" id="lb-st-focus" value="${h(d.focus)}" placeholder="如：爆膏奶油虾，人均 100 左右"></label>
        <label class="f"><span>补充要求（可选）</span><input type="text" id="lb-st-extra" value="${h(d.extra)}" placeholder="如：偏素人口吻、突出夜宵场景、不要提价格"></label>
        <div class="row"><button class="btn primary" data-action="lb-st-gen" ${busy !== null ? 'disabled' : ''}>${busy === 'all' ? 'AI 正在写…' : d.lines.length ? '重新生成' : '生成二创'}</button><span class="hint">门店信息取自账号库和「评论 → 门店资料」</span></div>
      </div>
      ${d.lines.length ? `<div class="panel stack">
        <b>标题</b>
        <input type="text" id="lb-st-titlein" value="${h(d.title)}">
        ${d.titles.length > 1 ? `<div class="chips">${d.titles.map((t, i) => `<button class="chip sm" data-action="lb-st-title" data-i="${i}" aria-pressed="${t === d.title}">${h(t)}</button>`).join('')}</div>` : ''}
        <b style="margin-top:6px">${isScript ? '口播脚本' : '正文'}</b>
        <div class="st-lines">${d.lines.map((l, i) => `<div class="st-line">
          <div class="row" style="gap:6px;flex-wrap:nowrap"><span class="rank">${i + 1}</span><span class="chip sm">${h(l.role || '—')}</span>${l.orig ? `<span class="hint st-orig" title="对应原爆款">↔ ${h(l.orig)}</span>` : ''}<span class="grow"></span>
            <button class="btn ghost sm" data-action="lb-st-up" data-i="${i}" title="上移">↑</button><button class="btn ghost sm" data-action="lb-st-add" data-i="${i}" title="在下面加一句">＋</button><button class="btn ghost sm" data-action="lb-st-del" data-i="${i}" title="删除">✕</button></div>
          <textarea id="lb-st-l-${i}" data-lbstl="${i}" rows="2">${h(l.text)}</textarea>
          ${isScript ? `<input type="text" id="lb-st-s-${i}" data-lbsts="${i}" value="${h(l.shot)}" placeholder="镜头：拍什么">` : ''}
          <div class="row" style="gap:6px"><input type="text" id="lb-st-hint-${i}" placeholder="想怎么改（可选），如：更口语、加价格" style="flex:1"><button class="btn sm" data-action="lb-st-line" data-i="${i}" ${busy !== null ? 'disabled' : ''}>${busy === i ? '重写中…' : 'AI 重写这句'}</button></div>
        </div>`).join('')}</div>
        ${d.tags.length ? `<div class="kv2"><span class="hint">话题</span><div>${d.tags.map(t => '#' + h(t)).join(' ')}</div></div>` : ''}
        ${d.cover ? `<div class="kv2"><span class="hint">封面建议</span><div>${h(d.cover)}</div></div>` : ''}
        <div class="row"><button class="btn primary sm" data-action="lb-st-copy">复制全文</button><button class="btn sm" data-action="lb-st-tpl">存为模板</button><span class="hint">改动自动保存，下次打开还在</span></div>
      </div>` : ''}
    </div>`;
  }

  // ---------- 动作 ----------
  async function act(action, el) {
    const c = ST.d.cfg; const v = el.dataset.v; const p = el.dataset.id ? ST.d.posts[el.dataset.id] : null;
    switch (action) {
      case 'lb-run': run(); break;
      case 'lb-run-acct': run({ onlyAccounts: true }); break;
      case 'lb-acct-add': {
        const got = ST.addAcct.split(/\s+/).map(parseAcct).filter(Boolean); const bad = ST.addAcct.split(/\s+/).filter(x => /^https?:/.test(x) && !parseAcct(x)).length;
        got.forEach(a => { if (!c.accounts.some(x => x.key === a.key)) c.accounts.push(Object.assign(a, { name: '', fans: null, addedAt: Date.now() })); });
        ST.addAcct = ''; await save(); toast(got.length ? `已添加 ${got.length} 个账号${bad ? `，${bad} 个链接认不出（要用主页完整链接，不是短链接）` : ''}` : '没认出主页链接：请在电脑浏览器打开博主主页，复制地址栏里的完整链接'); forceRender(); break;
      }
      case 'lb-acct-del': c.accounts = c.accounts.filter(a => a.key !== v); await save(); render(); break;
      case 'lb-acct-f': ST.f.acct = v; render(); break;
      case 'lb-studio': if (p) { ST.studio = p.id; ST.view = 'studio'; ST.d.drafts = ST.d.drafts || {}; render(); window.scrollTo(0, 0); } break;
      case 'lb-st-gen': genStudio(); break;
      case 'lb-st-line': rewriteLine(+el.dataset.i); break;
      case 'lb-st-del': { const d = draftOf(); d.lines.splice(+el.dataset.i, 1); await save(); render(); break; }
      case 'lb-st-up': { const d = draftOf(); const i = +el.dataset.i; if (i > 0) { [d.lines[i - 1], d.lines[i]] = [d.lines[i], d.lines[i - 1]]; await save(); render(); } break; }
      case 'lb-st-add': { const d = draftOf(); d.lines.splice(+el.dataset.i + 1, 0, { role: '补充', orig: '', text: '', shot: '' }); await save(); render(); break; }
      case 'lb-st-title': { const d = draftOf(); d.title = d.titles[+el.dataset.i] || d.title; await save(); render(); break; }
      case 'lb-st-copy': { const d = draftOf(); await window.__rmCopy(fullText(d), d.format === 'script' ? '口播脚本' : '笔记'); break; }
      case 'lb-st-tpl': { const d = draftOf(); const q = ST.d.posts[ST.studio]; window.__rmHotToTemplate && window.__rmHotToTemplate({ kind: 'hot', runId: 'library', runTopic: '二创', industry: (window.Store && Store.state.settings.industry) || 'food', platform: q.platform, post: { id: q.id, title: d.title, desc: d.lines.map(l => l.text).join('\n'), tags: d.tags || [], url: q.url }, city: c.cities[0] || '', exclude: [] }); break; }
      case 'lb-st-close': ST.studio = null; ST.view = 'lib'; render(); break;
      case 'lb-pause': if (ST.job) { ST.job.paused = true; log('已暂停'); } break;
      case 'lb-resume': if (ST.job) { ST.job.paused = false; ST.job.blocked = null; log('继续'); } break;
      case 'lb-stop': if (ST.job) { ST.job.stop = true; ST.job.paused = false; log('正在停止…'); } break;
      case 'lb-clear': ST.job = null; render(); break;
      case 'lb-view': ST.view = v; render(); break;
      case 'lb-type': ST.f.type = v; render(); break;
      case 'lb-open': ST.open = ST.open === el.dataset.id ? null : el.dataset.id; render(); break;
      case 'lb-label': if (p) { p.label = p.label === v ? null : v; await save(); render(); } break;
      case 'lb-bd': { ST.job = { running: true, log: [], phase: 'AI 拆解', i: 0, n: 0, found: 0, fresh: 0, deep: 0 }; render(); const list = Object.values(ST.d.posts).filter(x => x.detailAt && !x.bd && x.relevant !== false).sort((a, b) => (b.score || 0) - (a.score || 0)); try { await breakdown(list); } catch (e) { log('出错：' + e.message); } score(); ST.job.running = false; await save(); render(); break; }
      case 'lb-tpl': case 'lb-compose': {
        if (!p) return;
        const post = { id: p.id, title: (p.bd && p.bd.template && action === 'lb-tpl' ? p.title : p.title), desc: p.desc || '', tags: p.tags || [], url: p.url, eng: Math.round(metrics(p).eng), type: p.ptype, poi: p.poi || '' };
        const payload = { kind: 'hot', runId: 'library', runTopic: '爆款库', industry: (window.Store && Store.state.settings.industry) || 'food', platform: p.platform, post, city: c.cities[0] || '', area: '', exclude: c.brands.concat(c.cities) };
        if (action === 'lb-tpl' && p.bd && p.bd.template && window.__rmHotToTemplate) {
          // 已有 AI 模板：直接用拆解出来的模板（变量已替换）
          payload.post = Object.assign({}, post, { title: p.bd.template.title || p.title, desc: p.bd.template.body || p.desc });
        }
        if (action === 'lb-tpl') window.__rmHotToTemplate && window.__rmHotToTemplate(payload); else window.__rmCompose && window.__rmCompose(payload);
        break;
      }
      case 'lb-toggle': { const arr = c[el.dataset.f]; const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); if (el.dataset.f === 'platforms' && !arr.length) arr.push(v); await save(); render(); break; }
      case 'lb-rmcustom': { const arr = c[el.dataset.f]; const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); await save(); render(); break; }
      case 'lb-kwdel': if (c.added.includes(v)) c.added = c.added.filter(x => x !== v); else if (c.accepted.includes(v)) c.accepted = c.accepted.filter(x => x !== v); else c.removed.push(v); await save(); render(); break;
      case 'lb-kwback': c.removed = c.removed.filter(x => x !== v); await save(); render(); break;
      case 'lb-kwadd': { const k = ST.addKw.trim(); if (!k) return; if (!c.added.includes(k)) c.added.unshift(k); c.removed = c.removed.filter(x => x !== k); ST.addKw = ''; await save(); render(); break; }
      case 'lb-sug': if (el.dataset.ok === '1') { if (!c.accepted.includes(v)) c.accepted.push(v); } else c.rejected.push(v); await save(); render(); break;
      case 'lb-reset': ST.d.cfg = Object.assign(defaultCfg(), { added: c.added, accepted: c.accepted, rejected: c.rejected, accounts: c.accounts }); await save(); toast('已恢复默认（手动加的关键词保留）'); render(); break;
    }
  }
  function attach(root) {
    const onField = async e => {
      const t = e.target; if (!ST.d) return; const c = ST.d.cfg;
      if (t.dataset.lbf) { ST.f[t.dataset.lbf] = t.type === 'checkbox' ? t.checked : t.value; if (e.type === 'change') forceRender(); return; }
      if (t.dataset.lbstate) { ST[t.dataset.lbstate] = t.value; return; }
      if (t.dataset.lbcheck && e.type === 'change') { c[t.dataset.lbcheck] = t.checked; await save(); return; }
      if (t.dataset.lbst && e.type === 'change') { const d = draftOf(); readStudioFields(d); d[t.dataset.lbst] = t.value; await save(); forceRender(); return; }
      if ((t.dataset.lbstl !== undefined || t.dataset.lbsts !== undefined || /^lb-st-(focus|extra|titlein)$/.test(t.id)) && e.type === 'change') { readStudioFields(draftOf()); save(); return; }
      if (t.dataset.lbcfg) { c[t.dataset.lbcfg] = t.value; save(); return; }
      if (t.dataset.lbnum && e.type === 'change') { c[t.dataset.lbnum] = +t.value; await save(); forceRender(); return; }
      if (t.dataset.lbtype && e.type === 'change') { c.types[t.dataset.lbtype] = Object.assign(c.types[t.dataset.lbtype] || { words: [] }, { on: t.checked }); await save(); forceRender(); return; }
      if (t.dataset.lbwords && e.type === 'change') { c.types[t.dataset.lbwords] = Object.assign(c.types[t.dataset.lbwords] || { on: true }, { words: t.value.split(/[、,，\s]+/).map(x => x.trim()).filter(Boolean) }); await save(); forceRender(); return; }
    };
    root.addEventListener('input', onField); root.addEventListener('change', onField);
    root.addEventListener('load', e => { const t = e.target; if (t && t.classList && t.classList.contains('lib-cover')) t.classList.add('ok'); }, true);
    root.addEventListener('keydown', async e => {
      const t = e.target; if (e.key !== 'Enter' || !ST.d) return;
      if (t.dataset && t.dataset.lbadd) { e.preventDefault(); const v = t.value.trim(); if (!v) return; const arr = ST.d.cfg[t.dataset.lbadd]; if (!arr.includes(v)) arr.push(v); t.value = ''; await save(); t.blur(); render(); setTimeout(() => { const x = document.querySelector(`[data-lbadd="${t.dataset.lbadd}"]`); if (x) x.focus(); }, 30); }
      if (t.id === 'lb-addkw') { e.preventDefault(); ST.addKw = t.value; t.blur(); act('lb-kwadd', t); }
    });
    load().then(render);
  }
  window.Library = { view, act, attach, count: () => (ST.d ? Object.values(ST.d.posts).filter(p => (p.score || 0) >= 75).length : 0), _st: ST, _score: score };
})();
