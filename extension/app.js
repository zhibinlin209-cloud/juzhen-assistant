/* 矩阵内容助手 · 界面（扩展侧边栏与网页版共用）
 * 依赖：Core、Industries、TemplatesLib、Needs、Insight、AI、XlsxLite、Store、Env；可选 Research（仅扩展）
 */
(function () {
  'use strict';
  const C = window.Core, E = window.Env, Store = window.Store, L = window.TemplatesLib, I = window.Industries;
  const root = document.getElementById('app');

  const PERSONAS = [['owner', '老板/店长'], ['staff', '店员/员工'], ['kol', '探店/测评达人'], ['customer', '真实顾客视角'], ['brand', '品牌官方'], ['expert', '专业顾问/老师']];
  const TONES = [['warm', '亲切自然'], ['lively', '活泼有梗'], ['grass', '种草感强'], ['pro', '专业干货'], ['premium', '高级克制']];
  const STATUSES = [['active', '正常'], ['warming', '养号中'], ['paused', '暂停']];
  const PERSONA = Object.fromEntries(PERSONAS), TONE = Object.fromEntries(TONES), STATUS = Object.fromEntries(STATUSES);
  const PRESET_VARS = ['门店名', '城市', '商圈', '地址', '招牌', '价格', '营业时间'];

  const ui = {
    tab: window.Research ? 'research' : 'compose', confirm: null, banner: '', pendingRender: false,
    // 内容
    src: { kind: 'tpl' }, ind: null, cat: '全部', pf: 'all', sort: 'rec', tplId: null, accIds: null, vary: true,
    results: {}, rounds: {}, done: {}, runs: null, runCache: {}, srcRunId: null, answer: '', extra: '', ai: null,
    // 模板
    tInd: null, tCat: '全部', tSort: 'rec', editTpl: null,
    // 账号
    aGroup: 'all', aPf: 'all', editAcc: null, importMsg: '',
    // 数据
    dView: 'account', recAcc: 'all', refresh: null, snapDraft: null, snapBusy: false
  };

  // ---------- 小工具 ----------
  const h = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = () => Store.state;
  const byId = (arr, id) => (arr || []).find(x => x.id === id);
  const pfTag = p => `<span class="pf ${h(p)}">${h(C.PLATFORM_LABEL[p] || p)}</span>`;
  const fmt = n => C.fmtCount(n);
  const clone = o => JSON.parse(JSON.stringify(o));
  const industry = () => (S().settings && S().settings.industry) || 'general';
  const rules = () => (S().settings && S().settings.rules) || C.DEFAULT_RULES;
  const batchVars = () => (S().settings && S().settings.batchVars) || {};
  const parseTags = s => String(s || '').split(/[#,，\s]+/).map(t => t.trim()).filter(Boolean);
  const compatible = (tpl, acc) => !tpl || tpl.platform === 'both' || tpl.platform === acc.platform;
  let toastTimer;
  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }
  async function copy(text, label) { const ok = await E.copy(text); toast(ok ? `已复制${label ? '：' + label : ''}` : '复制失败，请手动选中复制'); }
  function fmtDate(iso, withTime) {
    if (!iso) return '—'; const d = new Date(iso); if (isNaN(d)) return '—';
    const p = n => String(n).padStart(2, '0'); return `${d.getMonth() + 1}/${d.getDate()}` + (withTime ? ` ${p(d.getHours())}:${p(d.getMinutes())}` : '');
  }
  function toLocalInput(iso) { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
  function weekStart() { const d = new Date(); d.setHours(0, 0, 0, 0); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return d.getTime(); }
  function accStats(acc) {
    const recs = S().records.filter(r => r.accountId === acc.id);
    const ws = weekStart();
    const week = recs.filter(r => new Date(r.publishedAt).getTime() >= ws).length;
    const last = recs.map(r => r.publishedAt).sort().pop();
    const withData = recs.filter(r => r.likes !== null && r.likes !== undefined && r.likes !== '');
    const avg = withData.length ? Math.round(withData.reduce((s, r) => s + C.interactions(r), 0) / withData.length) : null;
    return { total: recs.length, week, last, avg };
  }
  const aiCfg = () => (E.aiConfig ? E.aiConfig() : null);
  const aiReady = () => !!(aiCfg() && aiCfg().key);

  // ---------- 模板 ----------
  function allTpls() { return C.allTemplates(S()); }
  function tplStats() { return C.templateStats(S().records); }
  function sortTpls(list, sort) {
    const stt = tplStats();
    const score = t => { const s = stt[t.id]; return s ? (s.avg || 0) * 1 + s.uses * 5 : 0; };
    if (sort === 'perf') return list.slice().sort((a, b) => ((stt[b.id] || {}).avg ?? -1) - ((stt[a.id] || {}).avg ?? -1));
    if (sort === 'uses') return list.slice().sort((a, b) => ((stt[b.id] || {}).uses || 0) - ((stt[a.id] || {}).uses || 0));
    if (sort === 'name') return list.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    // 推荐：本行业优先，用过且效果好的靠前，爆款转来的靠前
    return list.slice().sort((a, b) => (score(b) + (b.fromHot ? 30 : 0) + (b.ind === industry() ? 20 : 0)) - (score(a) + (a.fromHot ? 30 : 0) + (a.ind === industry() ? 20 : 0)));
  }
  function statBadge(t) {
    const s = tplStats()[t.id];
    return `${t.fromHot ? '<span class="pf hot">爆款</span>' : ''}${!t.builtin ? '<span class="pf both">自建</span>' : ''}${s ? `<span class="m">用${s.uses}次${s.avg !== null ? ` · 均${fmt(s.avg)}` : ''}</span>` : ''}`;
  }

  // ---------- 内容：当前来源对应的"模板" ----------
  function currentRun() { return ui.srcRunId ? ui.runCache[ui.srcRunId] : null; }
  function sourceTemplate() {
    const s = ui.src;
    if (s.kind === 'need') {
      const nt = L.NEED_TEMPLATES[s.need.type] || L.NEED_TEMPLATES.ask;
      return Object.assign({ id: 'need-' + s.need.type, ind: s.industry || industry() }, clone(nt), { platform: 'both' });
    }
    if (s.kind === 'hot') return s.tpl || null;
    const list = allTpls();
    let t = byId(list, ui.tplId);
    if (!t) { t = filteredTpls()[0] || null; ui.tplId = t ? t.id : null; }
    return t;
  }
  function filteredTpls() {
    const ind = ui.ind || industry();
    return sortTpls(allTpls().filter(t => (ind === 'all' || t.ind === ind || t.ind === 'general') && (ui.cat === '全部' || t.category === ui.cat) && (ui.pf === 'all' || t.platform === ui.pf || t.platform === 'both')), ui.sort);
  }
  function selectedAccounts(tpl) {
    const accs = S().accounts.filter(a => a.status !== 'paused' && compatible(tpl, a));
    if (ui.accIds === null) ui.accIds = accs.map(a => a.id);
    return accs.filter(a => ui.accIds.includes(a.id));
  }
  function extraVars() {
    const s = ui.src; const v = Object.assign({}, batchVars());
    if (s.kind === 'need') {
      v['需求'] = s.need.name.replace(/[/（(].*$/, '');
      v['原话'] = String((s.need.quotes || [])[0] || s.need.name).slice(0, 40);
      v['回答'] = ui.answer || '';
    }
    return v;
  }
  function regen(accId) {
    const tpl = sourceTemplate(); if (!tpl) { ui.results = {}; return; }
    const accs = selectedAccounts(tpl);
    const targets = accId ? accs.filter(a => a.id === accId) : accs;
    if (!accId) { const keep = {}; accs.forEach(a => { if (ui.results[a.id]) keep[a.id] = ui.results[a.id]; }); ui.results = keep; }
    targets.forEach(a => {
      ui.results[a.id] = C.generate(tpl, a, { vary: ui.vary, round: ui.rounds[a.id] || 0, rules: rules(), batchVars: extraVars(), pack: tpl.ind || industry() });
      ui.results[a.id].templateId = tpl.id; ui.results[a.id].templateName = tpl.name;
      delete ui.done[a.id];
    });
  }
  function simFor(accId) { const me = ui.results[accId]; if (!me) return 0; let m = 0; Object.keys(ui.results).forEach(k => { if (k !== accId) m = Math.max(m, C.similarity(me.body, ui.results[k].body)); }); return m; }
  function simBadge(accId) {
    if (Object.keys(ui.results).length < 2) return '';
    const s = simFor(accId); const cls = s >= 0.75 ? 'high' : s >= 0.55 ? 'mid' : '';
    return `<span class="sim ${cls}" title="与本批其他账号正文的最高相似度">相似 ${Math.round(s * 100)}%</span>`;
  }

  /** 爆款帖子 → 模板（自动把店名、城市、商圈、人均换成变量） */
  function hotToTemplate(p) {
    const post = p.post; let title = post.title || ''; let body = String(post.desc || '').replace(/#([^#\s\[]+)\[话题\]#?/g, '').replace(/#[^\s#]+/g, '').replace(/\n{3,}/g, '\n\n').trim();
    let tags = (post.tags || []).slice(0, 8);
    const names = (window.Insight ? window.Insight.entities([Object.assign({ id: 'x' }, post)], [], p.industry || industry(), { exclude: [p.city, p.area].filter(Boolean), min: 1 }).map(e => e.name) : []).concat(p.exclude || []).filter(x => x && x !== p.city && x !== p.area);
    const rep = (s) => {
      let o = String(s || '');
      names.sort((a, b) => b.length - a.length).forEach(n => { o = o.split(n).join('{{门店名}}'); });
      if (p.city) o = o.split(p.city).join('{{城市}}');
      if (p.area) o = o.split(p.area).join('{{商圈}}');
      return o.replace(/人均\s*[¥￥]?\s*\d+(\.\d+)?\s*(元|块|r)?/g, '人均{{价格}}');
    };
    title = rep(title); body = rep(body); tags = tags.map(rep);
    const cat = /攻略|合集|清单|指南/.test(post.title) ? '答疑攻略' : /避雷|踩雷|劝退|测评|对比/.test(post.title) ? '避坑测评' : '探店种草';
    return { id: C.uid('tpl'), ind: p.industry || industry(), name: '爆款·' + String(post.title || '未命名').slice(0, 12), category: cat, platform: p.platform === 'douyin' ? 'douyin' : 'xhs', title, body: body || '（原帖正文没抓到，请补充）', tags, script: '', fromHot: { title: post.title, eng: post.eng, url: post.url, topic: p.runTopic } };
  }

  // ---------- AI 按人设写 ----------
  function aiPrompt(src, tpl, accs) {
    const pk = I.get((tpl && tpl.ind) || src.industry || industry());
    const R = rules();
    let material = '';
    if (src.kind === 'need') {
      const n = src.need;
      material = `要回应的顾客需求：「${n.name}」（类型：${window.Needs.TYPE_NAME[n.type]}，${n.count} 人提到）\n顾客原话：\n${(n.quotes || []).slice(0, 4).map(q => '- ' + q).join('\n')}\n${n.insight ? `顾客真正要的：${n.insight}\n` : ''}${ui.answer ? `我们的做法/答案（必须写进内容，作为核心）：${ui.answer}\n` : n.action ? `建议做法（可参考）：${n.action}\n` : ''}内容要正面回应这个需求，让有同样疑问/顾虑/期待的人看完就想来。`;
    } else if (src.kind === 'hot') {
      const p = src.post;
      material = `参考爆款（互动 ${p.eng}）：\n标题：${p.title}\n正文：${String(p.desc || '').slice(0, 600)}\n学习它的标题套路、结构、节奏和情绪点，换成我们自己的店和卖点；不能照抄句子。`;
    } else if (tpl) {
      material = `参考模板（保留结构和卖点思路，不要逐字照抄，同义随机写法 {a|b} 表示可选说法）：\n标题：${tpl.title}\n正文：${tpl.body}\n话题：${(tpl.tags || []).join(' ')}`;
    }
    return `你是「${pk.name}」行业的新媒体运营，要为下面每个矩阵账号各写一篇内容。

【素材】
${material}
${ui.extra ? `\n【本次补充要求】\n${ui.extra}\n` : ''}${Object.entries(batchVars()).filter(([, v]) => v).length ? `\n【本次信息】${Object.entries(batchVars()).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('；')}\n` : ''}
【账号】
${accs.map((a, i) => `A${i + 1}｜${a.name}｜平台：${C.PLATFORM_LABEL[a.platform]}｜人设：${PERSONA[a.persona] || '老板/店长'}｜语气：${TONE[a.tone] || '亲切自然'}｜门店信息：${Object.entries(a.vars || {}).filter(([, v]) => String(v || '').trim()).map(([k, v]) => `${k}=${v}`).join('；') || '（未填）'}`).join('\n')}

【规则】
- 每个账号一篇，开头、结构、用词明显不同，读起来像不同的人写的，符合各自人设和语气
- 小红书：标题 ≤ ${R.xhs.titleMax} 字，正文 300–600 字，分段+少量 emoji，话题 5–8 个
- 抖音：标题 ≤ ${R.douyin.titleMax} 字，正文 ≤ 300 字，话题 3–5 个，另外写 script（口播/分镜，按秒数分段）
- 只用门店信息和本次信息里有的事实；价格、地址、活动没给就不要编
- 禁止出现电话、微信、链接、二维码；禁止这些词：${I.banned(pk.key).join('、')}
- 话题不带 # 号

只输出 JSON 数组：[{"id":"A1","title":"","body":"","tags":["",""],"script":""}]`;
  }
  async function runAi() {
    const tpl = sourceTemplate(); const accs = selectedAccounts(tpl);
    if (!accs.length) { toast('先选账号'); return; }
    if (!aiReady()) { ui.ai = { error: '还没设置 AI。去「设置」填一次 API 密钥就能用。' }; render(); return; }
    if (ui.src.kind === 'need' && !ui.answer.trim() && !ui.src.need.action) { toast('先写一句"我们的做法/答案"，AI 会围绕它来写'); document.getElementById('c-answer')?.focus(); return; }
    const ctl = new AbortController(); ui.ai = { running: true, ctl }; render();
    try {
      const out = []; const chunks = []; for (let i = 0; i < accs.length; i += 4) chunks.push(accs.slice(i, i + 4));
      for (const ch of chunks) {
        const arr = await window.AI.json(aiCfg(), aiPrompt(ui.src, tpl, ch), ctl.signal, { temperature: 0.8 });
        (Array.isArray(arr) ? arr : []).forEach(o => { const i = parseInt(String(o.id || '').replace(/\D/g, ''), 10) - 1; if (ch[i]) out.push([ch[i], o]); });
      }
      if (!out.length) throw new Error('AI 没有返回内容，请再试一次');
      const pack = (tpl && tpl.ind) || ui.src.industry || industry();
      out.forEach(([a, o]) => {
        const r = { templateId: tpl ? tpl.id : ui.src.kind, templateName: tpl ? tpl.name : '', accountId: a.id, platform: a.platform, title: String(o.title || ''), body: String(o.body || ''), tags: (Array.isArray(o.tags) ? o.tags : parseTags(o.tags)).map(t => String(t).replace(/^#/, '')).slice(0, a.platform === 'douyin' ? 5 : 10), script: String(o.script || ''), pack, ai: true };
        r.checks = C.check(r, rules(), pack); ui.results[a.id] = r; delete ui.done[a.id];
      });
      ui.ai = null; toast(`AI 写好了 ${out.length} 篇`);
    } catch (e) { ui.ai = ctl.signal.aborted ? null : { error: e.message || 'AI 调用失败' }; }
    render();
  }

  // ---------- 外框 ----------
  function render() {
    if (!S()) return;
    const tabs = [
      ...(window.Research ? [['research', '调研', window.Research.count()]] : []),
      ...(window.Library ? [['library', '爆款', window.Library.count()]] : []),
      ...(window.Feishu ? [['feishu', '飞书']] : []), ['templates', '模板'], ['settings', '设置'] // 内容 / 评论 / 账号 / 数据 已精简掉
    ];
    const mode = Store.mode === 'db' ? '团队共享' : Store.mode === 'ext' ? '本机保存' : '仅本浏览器';
    root.innerHTML = `
      <header class="topbar">
        <div class="brand"><h1>矩阵内容助手</h1><span class="sub">${h(I.get(industry()).name)} · ${window.Research ? "小红书 / 抖音 / 大众点评" : "小红书 / 抖音"}</span><span class="mode ${Store.mode === 'local' ? 'local' : ''}"><span class="dot"></span>${mode}</span></div>
        <nav class="tabs" role="tablist">${tabs.map(([k, l, n]) => `<button role="tab" data-action="tab" data-tab="${k}" aria-selected="${ui.tab === k}">${l}${n ? `<span class="n">${n}</span>` : ''}</button>`).join('')}</nav>
      </header>
      <main id="main">${window.__rmNewVer ? `<div class="banner row"><span class="grow">插件已自动更新到 <b>${h(window.__rmNewVer)}</b>（现在用的是 ${h(chrome.runtime.getManifest().version)}），点右边按钮生效。正在跑的入库/调研会停下，重新打开面板后再点开始，会接着跑。</span><button class="btn primary sm" data-action="ext-reload">重新加载插件</button></div>` : ''}${ui.banner ? `<div class="banner">${h(ui.banner)}</div>` : ''}${view()}</main>`;
  }
  function view() {
    switch (ui.tab) {
      case 'research': return window.Research ? window.Research.view() : '';
      case 'comments': return window.Comments ? window.Comments.view() : '';
      case 'library': return window.Library ? window.Library.view() : '';
      case 'feishu': return window.Feishu ? window.Feishu.view() : '';
      case 'templates': return viewTemplates();
      case 'accounts': return viewAccounts();
      case 'data': return viewData();
      case 'settings': return viewSettings();
      case 'compose': return viewCompose(); // 只在从调研/模板跳过来时用
      default: return window.Library ? window.Library.view() : viewTemplates();
    }
  }

  // ---------- 内容页 ----------
  function viewCompose() {
    const s = ui.src; const tpl = sourceTemplate();
    const accsAll = S().accounts.filter(a => compatible(tpl, a));
    const sel = tpl ? selectedAccounts(tpl) : [];
    if (tpl && !Object.keys(ui.results).length && sel.length && !(s.kind === 'need' && !ui.answer && false)) regen();
    const srcTabs = [['tpl', '模板'], ['need', '调研需求'], ['hot', '爆款仿写']];
    return `<div class="compose">
      <div class="left stack">
        <div class="panel stack">
          <div class="row"><b>① 内容从哪来</b></div>
          <div class="seg" role="group">${srcTabs.map(([k, l]) => `<button data-action="c-src" data-v="${k}" aria-pressed="${s.kind === k}">${l}</button>`).join('')}</div>
          ${s.kind === 'tpl' ? srcTplPanel() : s.kind === 'need' ? srcNeedPanel() : srcHotPanel()}
        </div>
        <div class="panel stack">
          <div class="row"><b>② 发到哪些账号</b><span class="hint grow">已选 ${sel.length}/${accsAll.filter(a => a.status !== 'paused').length}</span>
            ${accsAll.length ? `<button class="btn ghost sm" data-action="c-acc-all">${sel.length && sel.length === accsAll.filter(a => a.status !== 'paused').length ? '全不选' : '全选'}</button>` : ''}</div>
          ${accsAll.length ? accountPicker(accsAll) : `<div class="empty"><b>还没有账号</b><button class="btn sm" data-action="tab" data-tab="accounts">去添加账号</button></div>`}
        </div>
        ${tpl ? varsPanel(tpl, sel) : ''}
      </div>
      <div class="right stack" id="results">${viewResults(tpl, sel)}</div>
    </div>`;
  }
  function srcTplPanel() {
    const list = filteredTpls(); const ind = ui.ind || industry();
    const cats = ['全部', ...L.CATEGORIES];
    return `<div class="row"><select id="c-ind" data-bind="c-ind" style="width:auto">${[['all', '全部行业']].concat(I.list().map(x => [x.key, x.name])).map(([k, l]) => `<option value="${k}" ${ind === k ? 'selected' : ''}>${h(l)}</option>`).join('')}</select>
        <select id="c-sort" data-bind="c-sort" style="width:auto">${[['rec', '推荐'], ['perf', '效果最好'], ['uses', '最常用'], ['name', '名称']].map(([k, l]) => `<option value="${k}" ${ui.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="chips">${cats.map(c => `<button class="chip sm" data-action="c-cat" data-v="${h(c)}" aria-pressed="${ui.cat === c}">${h(c)}</button>`).join('')}</div>
      <div class="chips">${[['all', '全部平台'], ['xhs', '小红书'], ['douyin', '抖音']].map(([k, l]) => `<button class="chip sm" data-action="c-pf" data-v="${k}" aria-pressed="${ui.pf === k}">${l}</button>`).join('')}</div>
      <div class="list" style="max-height:280px;overflow:auto">${list.length ? list.map(t => `
        <div class="item" data-action="c-pick" data-id="${h(t.id)}" aria-selected="${t.id === ui.tplId}">${pfTag(t.platform)}<span class="t">${h(t.name)}</span>${statBadge(t)}</div>`).join('') : '<div class="item"><span class="t hint">这个筛选下没有模板</span></div>'}</div>`;
  }
  function runPicker() {
    if (!window.Research) return '<div class="hint">网页版没有调研功能，请在插件里使用。</div>';
    const runs = window.Research.list();
    if (!runs.length) return `<div class="empty"><b>还没有调研报告</b><button class="btn sm" data-action="tab" data-tab="research">去做调研</button></div>`;
    return `<label class="f"><span>选调研报告</span><select id="c-run" data-bind="c-run"><option value="">请选择…</option>${runs.map(r => `<option value="${h(r.id)}" ${ui.srcRunId === r.id ? 'selected' : ''}>${h(r.topic || r.keyword)} · ${new Date(r.createdAt).toLocaleDateString('zh-CN')}</option>`).join('')}</select></label>`;
  }
  function srcNeedPanel() {
    const s = ui.src; const run = currentRun();
    let list = '';
    if (run) {
      const ND = run.ai || window.Needs.ruleNeeds(run.comments, run.keywords.map(k => k.group || k.kw), run.industry);
      list = `<div class="list" style="max-height:240px;overflow:auto">${ND.needs.map((n, i) => `<div class="item" data-action="c-need" data-i="${i}" aria-selected="${s.need && s.need.name === n.name}"><span class="sim ${({ pain: 'high', wish: 'mid', ask: 'ask', love: '' })[n.type]}">${window.Needs.TYPE_NAME[n.type]}</span><span class="t">${h(n.name)}</span><span class="m">${n.count}人</span></div>`).join('') || '<div class="item"><span class="t hint">这份报告没有需求点</span></div>'}</div>`;
    }
    return `${runPicker()}${list}
      ${s.need ? `<div class="panel tight stack" style="gap:6px"><div class="row"><span class="sim ${({ pain: 'high', wish: 'mid', ask: 'ask', love: '' })[s.need.type]}">${window.Needs.TYPE_NAME[s.need.type]}</span><b class="grow">${h(s.need.name)}</b>${s.need.count ? `<span class="hint">${s.need.count} 人</span>` : ''}</div>
        ${(s.need.quotes || []).slice(0, 2).map(q => `<div class="hint">“${h(q)}”</div>`).join('')}
        ${s.need.insight ? `<div class="hint">顾客真正要的：${h(s.need.insight)}</div>` : ''}</div>` : ''}`;
  }
  function srcHotPanel() {
    const s = ui.src; const run = currentRun();
    let list = '';
    if (run) {
      const top = window.Insight.contentInsight(run.posts.filter(x => x.type !== 'shop')).top;
      list = `<div class="list" style="max-height:240px;overflow:auto">${top.map(p => `<div class="item" data-action="c-hot" data-id="${h(p.id)}" aria-selected="${s.post && s.post.id === p.id}"><span class="t">${h(p.title || '(无标题)')}</span><span class="m">${fmt(p.eng)}</span></div>`).join('')}</div>`;
    }
    return `${runPicker()}${list}
      ${s.post ? `<div class="panel tight stack" style="gap:6px"><b>${h(s.post.title)}</b><span class="hint">互动 ${fmt(s.post.eng)} · <a href="${h(s.post.url)}" target="_blank" rel="noopener">看原帖</a></span>
        <div class="row"><button class="btn sm" data-action="c-hot-save">存成模板</button><span class="hint">已自动把店名、城市换成变量</span></div></div>` : ''}`;
  }
  function accountPicker(accs) {
    const groups = {}; accs.forEach(a => { const g = a.group || '未分组'; (groups[g] = groups[g] || []).push(a); });
    return `<div class="list" style="max-height:260px;overflow:auto">${Object.entries(groups).map(([g, list]) => `
      <div class="item grp" data-action="c-acc-group" data-g="${h(g)}"><b class="t">${h(g)}</b><span class="m">${list.length} 个 · 点选整组</span></div>
      ${list.map(a => `<label class="item ${a.status === 'paused' ? 'dim' : ''}"><input type="checkbox" data-action="c-acc" data-id="${h(a.id)}" ${ui.accIds && ui.accIds.includes(a.id) ? 'checked' : ''} ${a.status === 'paused' ? 'disabled' : ''}>${pfTag(a.platform)}<span class="t">${h(a.name)}</span><span class="m">${h(PERSONA[a.persona] || '')}</span></label>`).join('')}`).join('')}</div>`;
  }
  function varsPanel(tpl, sel) {
    const s = ui.src;
    const vars = C.listVars(tpl).filter(k => !['需求', '原话', '回答'].includes(k));
    const bv = batchVars();
    const need = vars.filter(k => sel.length === 0 || sel.some(a => !a.vars || !String(a.vars[k] || '').trim()));
    return `<div class="panel stack">
      <div class="row"><b>③ 本次信息</b><span class="hint grow">账号里没填的，在这里统一填</span></div>
      ${s.kind === 'need' ? `<label class="f"><span>我们的做法 / 答案（会写进内容，最关键）</span><textarea id="c-answer" data-bind="c-answer" rows="2" placeholder="${h(answerHint(s.need))}">${h(ui.answer)}</textarea></label>` : ''}
      ${need.length ? `<div class="grid2">${need.map(k => `<label class="f"><span>${h(k)}</span><input type="text" id="bv-${h(k)}" data-bind="bv" data-k="${h(k)}" value="${h(bv[k] || '')}" placeholder="${k === '日期' ? '默认今天' : '填写' + h(k)}"></label>`).join('')}</div>` : '<span class="hint">模板用到的信息，所选账号都已填好。</span>'}
      <label class="f"><span>补充要求（给 AI 用，可选）</span><input type="text" id="c-extra" data-bind="c-extra" value="${h(ui.extra)}" placeholder="如：重点推新品；语气更年轻；提到周末免排队"></label>
      <div class="sep"></div>
      <div class="row">
        <button class="btn primary sm" data-action="c-ai" ${ui.ai && ui.ai.running ? 'disabled' : ''}>${ui.ai && ui.ai.running ? 'AI 写作中…' : 'AI 按人设写'}</button>
        ${ui.ai && ui.ai.running ? `<button class="btn sm danger" data-action="c-ai-stop">停止</button>` : ''}
        <button class="btn sm" data-action="c-regen" ${sel.length ? '' : 'disabled'}>模板生成${ui.vary ? '（差异化）' : ''}</button>
        <label class="toggle"><input type="checkbox" data-action="c-vary" ${ui.vary ? 'checked' : ''}>差异化</label>
      </div>
      ${ui.ai && ui.ai.error ? `<div class="banner">${h(ui.ai.error)} ${!aiReady() ? '<button class="btn sm" data-action="tab" data-tab="settings">去设置</button>' : ''}</div>` : ''}
      <span class="hint">${aiReady() ? 'AI 会按每个账号的人设、语气和门店信息分别写，彼此不重复。' : '模板生成不需要 AI；在「设置」填 AI 密钥后，可以按人设写出更自然的内容。'}</span>
    </div>`;
  }
  function answerHint(n) {
    if (!n) return '';
    return { ask: '如：工作日 17 点前基本不用等，周末可以小程序提前取号', pain: '如：我们现在支持线上取号，到号前 10 分钟会提醒', wish: '如：双人套餐已经上线，128 元两个人吃饱', love: '如：每天早上现熬，用的是当天到的新鲜食材' }[n.type] || '';
  }
  function viewResults(tpl, sel) {
    tpl = tpl === undefined ? sourceTemplate() : tpl; sel = sel || (tpl ? selectedAccounts(tpl) : []);
    if (!tpl) return `<div class="empty"><b>${ui.src.kind === 'tpl' ? '选一个模板' : ui.src.kind === 'need' ? '选一份调研报告和一个需求点' : '选一份调研报告和一篇爆款'}</b>右边会按账号生成可直接复制的标题、正文和话题。</div>`;
    if (!sel.length) return `<div class="empty"><b>选一个或几个账号</b>每个账号会生成一份，复制或直接填入发布页。</div>`;
    const head = `<div class="section-h" style="margin-top:0"><h2>${h(tpl.name || '')}</h2>${pfTag(tpl.platform)}<span class="hint">${sel.length} 个账号</span>
      <div class="right"><button class="btn sm" data-action="copy-batch">复制全部账号文案</button></div></div>`;
    return head + `<div class="tickets">${sel.map((a, i) => ticket(a, i)).join('')}</div>`;
  }
  function ticket(a, i) {
    const r = ui.results[a.id]; if (!r) return '';
    const rule = rules()[r.platform] || {}; const ck = r.checks; const done = ui.done[a.id];
    const iss = ck.issues.length ? ck.issues.map(x => `<li class="${x.level}">${h(x.msg)}</li>`).join('') : '<li class="ok">字数、话题、违规词检查通过</li>';
    return `<article class="ticket" id="tk-${h(a.id)}">
      <div class="ticket-h"><span class="no">No.${String(i + 1).padStart(2, '0')}</span>${pfTag(r.platform)}<span class="name">${h(a.name)}</span>${r.ai ? '<span class="pf ai">AI</span>' : ''}<span class="hint">${h(PERSONA[a.persona] || '')}</span><span id="sim-${h(a.id)}">${simBadge(a.id)}</span>
        <button class="btn ghost sm" data-action="reroll" data-id="${h(a.id)}" title="用模板给这个账号换一版">换一版</button></div>
      <hr class="perf">
      <div class="ticket-b">
        <div class="field-h">标题<span class="cnt ${ck.titleLen > (rule.titleMax || 999) ? 'over' : ''}" id="ct-${h(a.id)}">${ck.titleLen}/${rule.titleMax || '—'}</span><button class="btn ghost sm" data-action="copy" data-id="${h(a.id)}" data-what="title">复制</button></div>
        <textarea class="title" rows="1" data-bind="res" data-id="${h(a.id)}" data-f="title" id="r-title-${h(a.id)}">${h(r.title)}</textarea>
        <div class="field-h">正文<span class="cnt ${ck.bodyLen > (rule.bodyMax || 99999) ? 'over' : ''}" id="cb-${h(a.id)}">${ck.bodyLen}/${rule.bodyMax || '—'}</span><button class="btn ghost sm" data-action="copy" data-id="${h(a.id)}" data-what="body">复制</button></div>
        <textarea rows="${Math.min(14, Math.max(5, r.body.split('\n').length + 1))}" data-bind="res" data-id="${h(a.id)}" data-f="body" id="r-body-${h(a.id)}">${h(r.body)}</textarea>
        <div class="field-h">话题<span class="cnt ${ck.tagCount > (rule.tagMax || 99) ? 'over' : ''}" id="cg-${h(a.id)}">${ck.tagCount}/${rule.tagMax || '—'}</span><button class="btn ghost sm" data-action="copy" data-id="${h(a.id)}" data-what="tags">复制</button></div>
        <textarea class="tagline" rows="2" data-bind="res" data-id="${h(a.id)}" data-f="tags" id="r-tags-${h(a.id)}">${h(C.tagsText(r.tags))}</textarea>
        ${r.script ? `<details><summary class="hint link">口播 / 分镜脚本</summary>
          <div class="field-h" style="margin-top:6px"><span class="grow"></span><button class="btn ghost sm" data-action="copy" data-id="${h(a.id)}" data-what="script">复制脚本</button></div>
          <textarea rows="5" data-bind="res" data-id="${h(a.id)}" data-f="script" id="r-script-${h(a.id)}">${h(r.script)}</textarea></details>` : ''}
        <ul class="issues" id="is-${h(a.id)}">${iss}</ul>
      </div>
      <hr class="perf">
      <div class="ticket-f">
        <button class="btn primary sm" data-action="copy" data-id="${h(a.id)}" data-what="all">复制 标题+正文+话题</button>
        ${E.canFill ? `<button class="btn sm" data-action="fill" data-id="${h(a.id)}" title="打开小红书/抖音发布页后点这里">填入发布页</button>` : ''}
        <button class="btn sm ${done ? 'done' : ''}" data-action="mark" data-id="${h(a.id)}">${done ? '已记录 ✓' : '记为已发布'}</button>
      </div>
    </article>`;
  }
  function refreshTicketMeta(accId) {
    const r = ui.results[accId]; if (!r) return;
    r.checks = C.check(r, rules(), r.pack); const rule = rules()[r.platform] || {};
    const set = (id, txt, over) => { const el = document.getElementById(id); if (el) { el.textContent = txt; el.classList.toggle('over', !!over); } };
    set('ct-' + accId, `${r.checks.titleLen}/${rule.titleMax || '—'}`, r.checks.titleLen > (rule.titleMax || 999));
    set('cb-' + accId, `${r.checks.bodyLen}/${rule.bodyMax || '—'}`, r.checks.bodyLen > (rule.bodyMax || 99999));
    set('cg-' + accId, `${r.checks.tagCount}/${rule.tagMax || '—'}`, r.checks.tagCount > (rule.tagMax || 99));
    const is = document.getElementById('is-' + accId);
    if (is) is.innerHTML = r.checks.issues.length ? r.checks.issues.map(x => `<li class="${x.level}">${h(x.msg)}</li>`).join('') : '<li class="ok">字数、话题、违规词检查通过</li>';
    Object.keys(ui.results).forEach(k => { const el = document.getElementById('sim-' + k); if (el) el.innerHTML = simBadge(k); });
  }
  function rerenderResults() { const el = document.getElementById('results'); if (el) el.innerHTML = viewResults(); }

  // ---------- 模板页 ----------
  function viewTemplates() {
    const ind = ui.tInd || industry();
    const list = sortTpls(allTpls().filter(t => (ind === 'all' || t.ind === ind || t.ind === 'general') && (ui.tCat === '全部' || t.category === ui.tCat)), ui.tSort);
    const d = ui.editTpl;
    return `<div class="compose">
      <div class="left stack">
        <div class="row"><select id="t-ind" data-bind="t-ind" style="width:auto">${[['all', '全部行业']].concat(I.list().map(x => [x.key, x.name])).map(([k, l]) => `<option value="${k}" ${ind === k ? 'selected' : ''}>${h(l)}</option>`).join('')}</select>
          <select id="t-sort" data-bind="t-sort" style="width:auto">${[['rec', '推荐'], ['perf', '效果最好'], ['uses', '最常用'], ['name', '名称']].map(([k, l]) => `<option value="${k}" ${ui.tSort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <button class="btn primary sm" data-action="t-new">＋ 新建</button></div>
        <div class="chips">${['全部', ...L.CATEGORIES].map(c => `<button class="chip sm" data-action="t-cat" data-v="${h(c)}" aria-pressed="${ui.tCat === c}">${h(c)}</button>`).join('')}</div>
        <div class="list">${list.length ? list.map(t => `<div class="item" data-action="t-edit" data-id="${h(t.id)}" aria-selected="${d && d.id === t.id}">${pfTag(t.platform)}<span class="t">${h(t.name)}</span>${statBadge(t)}<span class="m">${h(t.category)}</span></div>`).join('') : '<div class="item"><span class="t hint">没有模板</span></div>'}</div>
        <span class="hint">"效果最好"按用这个模板发出的帖子平均互动排序，数据来自「数据」页。</span>
      </div>
      <div class="right">${d ? tplEditor(d) : `<div class="empty"><b>选一个模板查看或编辑</b>模板里用 <code>{{门店名}}</code> 这样的变量，发到不同账号时自动替换；<code>{好吃|绝了}</code> 表示随机说法。</div>`}</div>
    </div>`;
  }
  function tplEditor(d) {
    const isBuiltin = !!d.builtin; const overridden = isBuiltin && byId(S().templates, d.id);
    const isNew = !isBuiltin && !byId(S().templates, d.id);
    const st = tplStats()[d.id];
    return `<div class="panel stack">
      <div class="row"><b class="grow">${isNew ? '新建模板' : isBuiltin ? '内置模板' + (overridden ? '（已修改）' : '') : '我的模板'}</b>
        ${!isNew ? `<button class="btn sm" data-action="t-use" data-id="${h(d.id)}">用它生成</button><button class="btn sm" data-action="t-dup" data-id="${h(d.id)}">复制一份</button>` : ''}
        ${overridden ? `<button class="btn sm" data-action="t-reset" data-id="${h(d.id)}">恢复默认</button>` : ''}
        ${!isBuiltin && !isNew ? (ui.confirm === 'tpl:' + d.id ? `<span class="confirm">确定删除？<button class="btn sm danger" data-action="t-del" data-id="${h(d.id)}">删除</button><button class="btn sm" data-action="cancel">取消</button></span>` : `<button class="btn sm danger" data-action="ask" data-v="tpl:${h(d.id)}">删除</button>`) : ''}
      </div>
      ${st ? `<div class="hint">已用 ${st.uses} 次${st.avg !== null ? `，有数据的 ${st.withData} 篇平均互动 ${fmt(st.avg)}` : '，发布后到「数据」页补互动数据就能看到效果'}</div>` : ''}
      ${d.fromHot ? `<div class="hint">来自爆款：<a href="${h(d.fromHot.url)}" target="_blank" rel="noopener">${h(d.fromHot.title)}</a>（互动 ${fmt(d.fromHot.eng)}）</div>` : ''}
      <div class="grid2">
        <label class="f"><span>名称</span><input type="text" id="tp-name" data-bind="tpl" data-f="name" value="${h(d.name)}"></label>
        <label class="f"><span>行业</span><select id="tp-ind" data-bind="tpl" data-f="ind">${I.list().map(x => `<option value="${x.key}" ${d.ind === x.key ? 'selected' : ''}>${h(x.name)}</option>`).join('')}</select></label>
        <label class="f"><span>场景</span><select id="tp-cat" data-bind="tpl" data-f="category">${L.CATEGORIES.map(c => `<option ${d.category === c ? 'selected' : ''}>${h(c)}</option>`).join('')}</select></label>
        <label class="f"><span>平台</span><select id="tp-pf" data-bind="tpl" data-f="platform">${['xhs', 'douyin', 'both'].map(p => `<option value="${p}" ${d.platform === p ? 'selected' : ''}>${C.PLATFORM_LABEL[p]}</option>`).join('')}</select></label>
      </div>
      <label class="f"><span>标题</span><input type="text" id="tp-title" data-bind="tpl" data-f="title" value="${h(d.title)}"></label>
      <label class="f"><span>正文</span><textarea id="tp-body" rows="10" data-bind="tpl" data-f="body">${h(d.body)}</textarea></label>
      <label class="f"><span>话题（空格分隔，前 3 个在差异化时固定保留）</span><input type="text" id="tp-tags" data-bind="tpl" data-f="tags" value="${h((d.tags || []).join(' '))}"></label>
      <label class="f"><span>口播 / 分镜脚本（可选）</span><textarea id="tp-script" rows="3" data-bind="tpl" data-f="script">${h(d.script || '')}</textarea></label>
      <div class="syntax">通用变量：<code>{{门店名}}</code> <code>{{城市}}</code> <code>{{商圈}}</code> <code>{{地址}}</code> <code>{{招牌}}</code> <code>{{价格}}</code> <code>{{营业时间}}</code> <code>{{新品}}</code> <code>{{活动}}</code> <code>{{团购价}}</code> <code>{{日期}}</code>；随机说法：<code>{太香了|绝了}</code></div>
      <div class="field-h">预览（第一个匹配账号）</div>
      <pre class="small-pre" id="tp-preview">${h(tplPreview(d))}</pre>
      <div class="row"><button class="btn primary" data-action="t-save">保存</button><button class="btn ghost" data-action="t-close">关闭</button><span class="hint" id="tp-vars">用到：${h(C.listVars(d).join('、') || '无')}</span></div>
    </div>`;
  }
  function tplPreview(d) {
    const acc = S().accounts.find(a => compatible(d, a));
    const r = C.generate(d, acc || null, { vary: false, rules: rules(), batchVars: batchVars(), pack: d.ind });
    return [r.title, '', r.body, '', C.tagsText(r.tags)].join('\n');
  }

  // ---------- 账号页 ----------
  function viewAccounts() {
    const accs = S().accounts;
    const groups = [...new Set(accs.map(a => a.group || '未分组'))];
    const shown = accs.filter(a => (ui.aGroup === 'all' || (a.group || '未分组') === ui.aGroup) && (ui.aPf === 'all' || a.platform === ui.aPf));
    const byG = {}; shown.forEach(a => { const g = a.group || '未分组'; (byG[g] = byG[g] || []).push(a); });
    const d = ui.editAcc;
    const ws = accs.filter(a => a.status === 'active');
    const weekDone = ws.reduce((s, a) => s + Math.min(accStats(a).week, a.weeklyTarget || 0), 0), weekTarget = ws.reduce((s, a) => s + (+a.weeklyTarget || 0), 0);
    return `<div class="compose">
      <div class="left stack">
        <div class="row"><button class="btn primary sm" data-action="a-new">＋ 添加账号</button>
          <label class="btn sm" for="a-import">批量导入</label><input type="file" id="a-import" accept=".xlsx,.csv" hidden data-action="a-import">
          <button class="btn ghost sm" data-action="a-tpl">下载导入模板</button></div>
        ${ui.importMsg ? `<div class="banner info">${h(ui.importMsg)}</div>` : ''}
        ${weekTarget ? `<div class="panel tight"><div class="row"><b class="grow">本周发布进度</b><span class="big-num">${weekDone}/${weekTarget}</span></div><div class="meter"><i style="width:${Math.round(weekDone / weekTarget * 100)}%"></i></div></div>` : ''}
        <div class="row"><select id="a-group" data-bind="a-group" style="width:auto"><option value="all">全部分组</option>${groups.map(g => `<option ${ui.aGroup === g ? 'selected' : ''}>${h(g)}</option>`).join('')}</select>
          <select id="a-pf" data-bind="a-pf" style="width:auto">${[['all', '全部平台'], ['xhs', '小红书'], ['douyin', '抖音']].map(([k, l]) => `<option value="${k}" ${ui.aPf === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="list">${Object.keys(byG).length ? Object.entries(byG).map(([g, list]) => `<div class="item grp"><b class="t">${h(g)}</b><span class="m">${list.length} 个</span></div>${list.map(a => { const s = accStats(a); const behind = a.status === 'active' && a.weeklyTarget && s.week < a.weeklyTarget; return `
          <div class="item ${a.status === 'paused' ? 'dim' : ''}" data-action="a-edit" data-id="${h(a.id)}" aria-selected="${d && d.id === a.id}">${pfTag(a.platform)}<span class="t">${h(a.name)}<span class="hint"> · ${h(PERSONA[a.persona] || '')}${a.status !== 'active' ? ' · ' + STATUS[a.status] : ''}</span></span>
            <span class="m ${behind ? 'warn-t' : ''}" title="本周已发/目标">${s.week}/${a.weeklyTarget || 0}</span><span class="m">${s.last ? fmtDate(s.last) : '未发'}</span></div>`; }).join('')}`).join('') : '<div class="item"><span class="t hint">没有账号</span></div>'}</div>
        <span class="hint">每个账号存自己的门店信息、人设和语气。生成内容时自动替换，AI 也会按人设来写。</span>
      </div>
      <div class="right">${d ? accEditor(d) : `<div class="empty"><b>选一个账号编辑，或添加新账号</b>账号多的话，用"批量导入"上传表格，一次导入几十个。</div>`}</div>
    </div>`;
  }
  function accEditor(d) {
    const isNew = !byId(S().accounts, d.id);
    const keys = Array.from(new Set([...PRESET_VARS, ...Object.keys(d.vars || {}).filter(k => !['招牌菜', '人均'].includes(k))]));
    const groups = [...new Set(S().accounts.map(a => a.group).filter(Boolean))];
    const s = isNew ? null : accStats(d);
    return `<div class="panel stack">
      <div class="row"><b class="grow">${isNew ? '添加账号' : '编辑账号'}</b>
        ${!isNew ? (ui.confirm === 'acc:' + d.id ? `<span class="confirm">确定删除？<button class="btn sm danger" data-action="a-del" data-id="${h(d.id)}">删除</button><button class="btn sm" data-action="cancel">取消</button></span>` : `<button class="btn sm danger" data-action="ask" data-v="acc:${h(d.id)}">删除</button>`) : ''}</div>
      ${s ? `<div class="kpis" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px"><div><b>${s.total}</b><span>累计发布</span></div><div><b>${s.week}/${d.weeklyTarget || 0}</b><span>本周</span></div><div><b>${s.avg === null ? '—' : fmt(s.avg)}</b><span>篇均互动</span></div><div><b>${s.last ? fmtDate(s.last) : '—'}</b><span>上次发布</span></div></div>` : ''}
      <div class="grid2">
        <label class="f"><span>账号备注名</span><input type="text" id="ac-name" data-bind="acc" data-f="name" value="${h(d.name)}" placeholder="如：天河店小红书"></label>
        <label class="f"><span>平台</span><select id="ac-pf" data-bind="acc" data-f="platform">${['xhs', 'douyin'].map(p => `<option value="${p}" ${d.platform === p ? 'selected' : ''}>${C.PLATFORM_LABEL[p]}</option>`).join('')}</select></label>
        <label class="f"><span>分组（门店/品牌/城市）</span><input type="text" id="ac-group" list="ac-groups" data-bind="acc" data-f="group" value="${h(d.group || '')}" placeholder="如：天河店"><datalist id="ac-groups">${groups.map(g => `<option value="${h(g)}">`).join('')}</datalist></label>
        <label class="f"><span>状态</span><select id="ac-status" data-bind="acc" data-f="status">${STATUSES.map(([k, l]) => `<option value="${k}" ${d.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f"><span>人设</span><select id="ac-persona" data-bind="acc" data-f="persona">${PERSONAS.map(([k, l]) => `<option value="${k}" ${d.persona === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f"><span>语气</span><select id="ac-tone" data-bind="acc" data-f="tone">${TONES.map(([k, l]) => `<option value="${k}" ${d.tone === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f"><span>每周发布目标（篇）</span><input type="number" min="0" id="ac-target" data-bind="acc" data-f="weeklyTarget" value="${h(d.weeklyTarget ?? 3)}"></label>
        <label class="f"><span>主页链接（可选）</span><input type="url" id="ac-handle" data-bind="acc" data-f="handle" value="${h(d.handle || '')}" placeholder="https://"></label>
      </div>
      <div class="field-h">门店信息（生成内容时自动替换 {{变量}}）</div>
      <div class="stack" style="gap:6px">${keys.map(k => `<div class="kv"><span class="hint">${h(k)}</span><input type="text" id="ac-v-${h(k)}" data-bind="accvar" data-k="${h(k)}" value="${h((d.vars || {})[k] || '')}" placeholder="${k === '招牌' ? '招牌产品/项目' : k === '价格' ? '人均/客单价，如 78 元' : ''}">${PRESET_VARS.includes(k) ? '<span></span>' : `<button class="btn ghost sm" data-action="accvar-del" data-k="${h(k)}" title="删除这个变量">✕</button>`}</div>`).join('')}</div>
      <div class="row"><input type="text" id="ac-newkey" placeholder="新变量名，如 停车" style="max-width:180px"><button class="btn sm" data-action="accvar-add">添加变量</button></div>
      <label class="f"><span>备注</span><input type="text" id="ac-note" data-bind="acc" data-f="note" value="${h(d.note || '')}"></label>
      <div class="row"><button class="btn primary" data-action="a-save">保存账号</button><button class="btn ghost" data-action="a-close">关闭</button></div>
    </div>`;
  }
  const IMPORT_COLS = ['账号名', '平台', '分组', '人设', '语气', '状态', '每周目标', '主页链接', ...PRESET_VARS];
  async function importAccounts(file) {
    try {
      let rows;
      if (/\.xlsx$/i.test(file.name)) { const sh = await window.XlsxLite.read(await file.arrayBuffer()); rows = (sh[0] || {}).rows || []; }
      else { const txt = new TextDecoder('utf-8').decode(await file.arrayBuffer()).replace(/^﻿/, ''); rows = txt.split(/\r?\n/).map(l => l.split(/,|\t/)); }
      const head = (rows[0] || []).map(x => String(x || '').trim());
      const col = n => head.indexOf(n);
      if (col('账号名') < 0) throw new Error('第一行需要有"账号名"列，可以先下载导入模板');
      const pfMap = v => /抖|douyin/i.test(v) ? 'douyin' : 'xhs';
      const findKey = (list, v) => (list.find(([k, l]) => l === v || k === v || (v && l.includes(v))) || [])[0];
      let n = 0;
      for (const r of rows.slice(1)) {
        const name = String(r[col('账号名')] || '').trim(); if (!name) continue;
        const exist = S().accounts.find(a => a.name === name);
        const a = C.migrateAccount(exist ? clone(exist) : { id: C.uid('acc'), name, vars: {} });
        a.platform = col('平台') >= 0 && r[col('平台')] ? pfMap(String(r[col('平台')])) : (a.platform || 'xhs');
        if (col('分组') >= 0 && r[col('分组')]) a.group = String(r[col('分组')]).trim();
        if (col('人设') >= 0 && r[col('人设')]) a.persona = findKey(PERSONAS, String(r[col('人设')]).trim()) || a.persona;
        if (col('语气') >= 0 && r[col('语气')]) a.tone = findKey(TONES, String(r[col('语气')]).trim()) || a.tone;
        if (col('状态') >= 0 && r[col('状态')]) a.status = findKey(STATUSES, String(r[col('状态')]).trim()) || a.status;
        if (col('每周目标') >= 0 && r[col('每周目标')] !== undefined && r[col('每周目标')] !== null && r[col('每周目标')] !== '') a.weeklyTarget = +r[col('每周目标')] || 0;
        if (col('主页链接') >= 0 && r[col('主页链接')]) a.handle = String(r[col('主页链接')]).trim();
        PRESET_VARS.forEach(k => { if (col(k) >= 0 && r[col(k)] !== undefined && r[col(k)] !== null && String(r[col(k)]).trim()) a.vars[k] = String(r[col(k)]).trim(); });
        await Store.put('accounts', a); n++;
      }
      ui.importMsg = `导入完成：${n} 个账号（同名账号会更新）`; ui.accIds = null;
    } catch (e) { ui.importMsg = '导入失败：' + (e.message || '文件格式不对'); }
    render();
  }

  // ---------- 数据页 ----------
  function viewData() {
    const recs = S().records; const accs = S().accounts;
    const ws = weekStart(); const d30 = Date.now() - 30 * 864e5;
    const week = recs.filter(r => new Date(r.publishedAt).getTime() >= ws);
    const m30 = recs.filter(r => new Date(r.publishedAt).getTime() >= d30);
    const withData = m30.filter(r => r.likes !== null && r.likes !== undefined && r.likes !== '');
    const avg30 = withData.length ? Math.round(withData.reduce((s, r) => s + C.interactions(r), 0) / withData.length) : null;
    const target = accs.filter(a => a.status === 'active').reduce((s, a) => s + (+a.weeklyTarget || 0), 0);
    const best = withData.slice().sort((a, b) => C.interactions(b) - C.interactions(a))[0];
    const rf = ui.refresh;
    const views = [['account', '按账号'], ['template', '按模板'], ['persona', '按人设'], ['time', '时段与趋势'], ['records', '发布记录'], ['refs', '参考库']];
    return `${snapPanel()}
      <div class="section-h"><h2>效果概况</h2><div class="right">
        ${window.Research ? `<button class="btn primary sm" data-action="d-refresh" ${rf && rf.running ? 'disabled' : ''}>${rf && rf.running ? `更新中 ${rf.done}/${rf.total}` : '批量更新数据'}</button>` : ''}
        <button class="btn sm" data-action="rec-add">＋ 手动添加</button><button class="btn sm" data-action="export-records" ${recs.length ? '' : 'disabled'}>导出 CSV</button></div></div>
      ${rf && rf.msg ? `<div class="banner ${rf.err ? '' : 'info'}">${h(rf.msg)}</div>` : ''}
      <div class="panel kpis" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
        <div><b>${week.length}${target ? `/${target}` : ''}</b><span>本周发布${target ? '/目标' : ''}</span></div>
        <div><b>${m30.length}</b><span>近 30 天发布</span></div>
        <div><b>${avg30 === null ? '—' : fmt(avg30)}</b><span>近 30 天篇均互动</span></div>
        <div><b>${m30.length ? Math.round(withData.length / m30.length * 100) + '%' : '—'}</b><span>有数据的比例</span></div>
      </div>
      ${best ? `<p class="hint">近 30 天最好的一篇：${best.url ? `<a href="${h(best.url)}" target="_blank" rel="noopener">${h(best.title)}</a>` : h(best.title)}（互动 ${fmt(C.interactions(best))}）</p>` : ''}
      <p class="hint">${window.Research ? '"批量更新数据"会依次打开有链接的发布记录，读回最新的赞、藏、评、转。' : ''}记录要先粘贴帖子链接。</p>
      <nav class="tabs sub" role="tablist">${views.map(([k, l]) => `<button role="tab" data-action="d-view" data-v="${k}" aria-selected="${ui.dView === k}">${l}</button>`).join('')}</nav>
      <div style="margin-top:12px">${({ account: dataByAccount, template: dataByTemplate, persona: dataByPersona, time: dataTime, records: dataRecords, refs: snapList })[ui.dView]()}</div>`;
  }
  function groupAvg(recs, keyFn) {
    const m = {};
    recs.forEach(r => { const k = keyFn(r); if (!k) return; const g = m[k] || (m[k] = { key: k, n: 0, wd: 0, inter: 0, best: null }); g.n++; if (r.likes !== null && r.likes !== undefined && r.likes !== '') { g.wd++; g.inter += C.interactions(r); if (!g.best || C.interactions(r) > C.interactions(g.best)) g.best = r; } });
    return Object.values(m).map(g => Object.assign(g, { avg: g.wd ? Math.round(g.inter / g.wd) : null })).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || b.n - a.n);
  }
  function avgTable(rows, label, nameFn) {
    if (!rows.length) return '<div class="empty"><b>还没有发布记录</b>在「内容」页点"记为已发布"，或手动添加。</div>';
    const max = Math.max(1, ...rows.map(r => r.avg || 0));
    return `<div class="tbl-wrap"><table><thead><tr><th>${label}</th><th class="num">发布</th><th class="num">有数据</th><th class="num">篇均互动</th><th style="width:30%"></th><th>最好的一篇</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><b>${nameFn(r.key)}</b></td><td class="num">${r.n}</td><td class="num">${r.wd}</td><td class="num">${r.avg === null ? '—' : fmt(r.avg)}</td><td><div class="meter"><i style="width:${Math.round((r.avg || 0) / max * 100)}%"></i></div></td><td><span class="ttl">${r.best ? h(r.best.title) : ''}</span></td></tr>`).join('')}
    </tbody></table></div>`;
  }
  function dataByAccount() {
    const accs = S().accounts;
    const rows = groupAvg(S().records, r => r.accountId);
    accs.forEach(a => { if (!rows.find(r => r.key === a.id)) rows.push({ key: a.id, n: 0, wd: 0, avg: null, best: null }); });
    return avgTable(rows, '账号', id => { const a = byId(accs, id); return a ? `${pfTag(a.platform)} ${h(a.name)}` : '已删除的账号'; });
  }
  function dataByTemplate() {
    const all = allTpls();
    return avgTable(groupAvg(S().records, r => r.templateId), '模板', id => { const t = byId(all, id); return t ? h(t.name) : id === 'hot' ? '爆款仿写（AI）' : /^need-/.test(id) ? '需求回应' : h(id); });
  }
  function dataByPersona() {
    const accs = S().accounts;
    return avgTable(groupAvg(S().records, r => (byId(accs, r.accountId) || {}).persona), '人设', k => h(PERSONA[k] || k));
  }
  function dataTime() {
    const hours = C.hourStats(S().records.filter(r => C.interactions(r) > 0));
    const maxAvg = Math.max(1, ...hours.map(x => x.avg));
    const top = hours.slice().sort((a, b) => b.avg - a.avg)[0];
    const weeks = []; const ws = weekStart();
    for (let i = 7; i >= 0; i--) { const a = ws - i * 7 * 864e5, b = a + 7 * 864e5; const rs = S().records.filter(r => { const t = new Date(r.publishedAt).getTime(); return t >= a && t < b; }); const wd = rs.filter(r => r.likes !== null && r.likes !== undefined && r.likes !== ''); weeks.push({ label: `${new Date(a).getMonth() + 1}/${new Date(a).getDate()}`, n: rs.length, avg: wd.length ? Math.round(wd.reduce((s, r) => s + C.interactions(r), 0) / wd.length) : 0 }); }
    const maxN = Math.max(1, ...weeks.map(w => w.n)); const maxW = Math.max(1, ...weeks.map(w => w.avg));
    return `<div class="section-h" style="margin-top:0"><h2>近 8 周</h2><span class="hint">柱高 = 发布数，数字 = 篇均互动</span></div>
      <div class="panel"><div class="bars">${weeks.map(w => `<div class="b" style="height:${Math.round(w.n / maxN * 100)}%" title="${w.label} 周 · ${w.n} 篇 · 篇均 ${w.avg}"></div>`).join('')}</div>
        <div class="bars-x">${weeks.map(w => `<span>${w.label}</span>`).join('')}</div>
        <div class="bars-x">${weeks.map(w => `<span style="color:var(--ink)">${w.avg ? fmt(w.avg) : '·'}</span>`).join('')}</div></div>
      <div class="section-h"><h2>发布时段</h2><span class="hint">用你自己有互动数据的记录算</span></div>
      ${hours.length >= 3 ? `<div class="panel"><div class="bars">${hours.map(x => `<div class="b ${top && x.hour === top.hour ? 'top' : ''}" style="height:${Math.round(x.avg / maxAvg * 100)}%" title="${x.hour}点 · ${x.n} 篇 · 篇均 ${x.avg}"></div>`).join('')}</div>
        <div class="bars-x">${hours.map(x => `<span>${x.hour}</span>`).join('')}</div>
        <p class="hint" style="margin:8px 0 0">${top ? `目前 ${top.hour} 点发布的篇均互动最高（${fmt(top.avg)}，${top.n} 篇）。` : ''}</p></div>`
        : `<div class="empty"><b>数据还不够</b>至少 3 个不同时段有互动数据后，这里会显示哪个时段发效果最好。</div>`}`;
  }
  function dataRecords() {
    const accs = S().accounts;
    const shown = S().records.slice().sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))).filter(r => ui.recAcc === 'all' || r.accountId === ui.recAcc);
    return `<div class="row" style="margin-bottom:8px"><select id="rec-acc" data-bind="rec-acc" style="width:auto"><option value="all">全部账号</option>${accs.map(a => `<option value="${h(a.id)}" ${ui.recAcc === a.id ? 'selected' : ''}>${h(a.name)}</option>`).join('')}</select><span class="hint grow">${shown.length} 条</span></div>
      ${shown.length ? `<div class="tbl-wrap"><table>
        <thead><tr><th>发布时间</th><th>账号</th><th>标题</th><th>链接</th><th class="num">赞</th><th class="num">藏</th><th class="num">评</th><th class="num">转</th><th></th></tr></thead>
        <tbody>${shown.map(r => `<tr>
          <td><input type="datetime-local" id="rd-${h(r.id)}" data-bind="rec" data-id="${h(r.id)}" data-f="publishedAt" value="${h(toLocalInput(r.publishedAt))}" style="width:170px"></td>
          <td>${pfTag(r.platform)} ${h((byId(accs, r.accountId) || {}).name || r.accountName || '')}</td>
          <td><input type="text" id="rt-${h(r.id)}" data-bind="rec" data-id="${h(r.id)}" data-f="title" value="${h(r.title)}" style="width:200px"></td>
          <td><input type="url" id="ru-${h(r.id)}" data-bind="rec" data-id="${h(r.id)}" data-f="url" value="${h(r.url || '')}" placeholder="发布后粘贴链接" style="width:150px"></td>
          ${['likes', 'collects', 'comments', 'shares'].map(f => `<td class="num"><input class="n" type="number" min="0" id="r${f}-${h(r.id)}" data-bind="rec" data-id="${h(r.id)}" data-f="${f}" value="${h(r[f] === null || r[f] === undefined ? '' : r[f])}"></td>`).join('')}
          <td>${r.url ? `<a href="${h(r.url)}" target="_blank" rel="noopener" class="btn ghost sm">打开</a>` : ''}${ui.confirm === 'rec:' + r.id ? `<button class="btn sm danger" data-action="rec-del" data-id="${h(r.id)}">确定删</button><button class="btn ghost sm" data-action="cancel">取消</button>` : `<button class="btn ghost sm" data-action="ask" data-v="rec:${h(r.id)}">删除</button>`}</td>
        </tr>`).join('')}</tbody></table></div>`
        : `<div class="empty"><b>还没有发布记录</b>在「内容」页点"记为已发布"，或点上面的"手动添加"。</div>`}`;
  }
  function snapPanel() {
    const d = ui.snapDraft;
    const head = `<div class="section-h" style="margin-top:0"><h2>读取页面</h2><span class="hint">${E.canRead ? '打开一篇小红书笔记或抖音视频，点"读取当前页面"' : '网页版不能读取平台页面'}</span>
      <div class="right">${E.canRead ? `<button class="btn sm" data-action="snap-read" ${ui.snapBusy ? 'disabled' : ''}>${ui.snapBusy ? '读取中…' : '读取当前页面'}</button>` : ''}<button class="btn ghost sm" data-action="snap-manual">手动录入</button></div></div>`;
    if (!d) return head;
    const recs = S().records.slice().sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))).slice(0, 60);
    return head + `<div class="panel stack">
      ${d.warn ? `<div class="banner">${h(d.warn)}</div>` : ''}
      <div class="grid3">
        <label class="f"><span>平台</span><select id="sd-pf" data-bind="snap" data-f="platform">${['xhs', 'douyin'].map(p => `<option value="${p}" ${d.platform === p ? 'selected' : ''}>${C.PLATFORM_LABEL[p]}</option>`).join('')}</select></label>
        <label class="f"><span>作者</span><input type="text" id="sd-author" data-bind="snap" data-f="author" value="${h(d.author || '')}"></label>
        <label class="f"><span>发布时间</span><input type="text" id="sd-time" data-bind="snap" data-f="publishedText" value="${h(d.publishedText || '')}"></label>
      </div>
      <label class="f"><span>标题</span><input type="text" id="sd-title" data-bind="snap" data-f="title" value="${h(d.title || '')}"></label>
      <label class="f"><span>正文</span><textarea id="sd-desc" rows="4" data-bind="snap" data-f="desc">${h(d.desc || '')}</textarea></label>
      <label class="f"><span>话题</span><input type="text" id="sd-tags" data-bind="snap" data-f="tagsText" value="${h(C.tagsText(d.tags || []))}"></label>
      <div class="grid3" style="grid-template-columns:repeat(4,1fr)">${[['likes', '赞'], ['collects', '收藏'], ['comments', '评论'], ['shares', '转发']].map(([f, l]) => `<label class="f"><span>${l}</span><input type="number" min="0" id="sd-${f}" data-bind="snap" data-f="${f}" value="${h(d[f] === null || d[f] === undefined ? '' : d[f])}"></label>`).join('')}</div>
      <label class="f"><span>链接</span><input type="url" id="sd-url" data-bind="snap" data-f="url" value="${h(d.url || '')}"></label>
      <div class="sep"></div>
      <div class="row">
        <button class="btn primary sm" data-action="snap-save">存为参考</button><button class="btn sm" data-action="snap-to-tpl">转成模板</button><span class="grow"></span>
        <select id="sd-match" data-bind="snap" data-f="matchId" style="width:auto;max-width:220px"><option value="">更新到发布记录…</option>${recs.map(r => `<option value="${h(r.id)}" ${d.matchId === r.id ? 'selected' : ''}>${h(fmtDate(r.publishedAt))} ${h(((byId(S().accounts, r.accountId) || {}).name || '').slice(0, 8))} · ${h(String(r.title || '').slice(0, 14))}</option>`).join('')}</select>
        <button class="btn sm" data-action="snap-update-rec">更新数据</button><button class="btn ghost sm" data-action="snap-close">关闭</button>
      </div>
    </div>`;
  }
  function snapList() {
    const list = S().snapshots.slice().sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    return `<div class="row" style="margin-bottom:8px"><span class="hint grow">同行爆款、自家好内容，存下来随时转模板</span><button class="btn sm" data-action="export-snaps" ${list.length ? '' : 'disabled'}>导出 CSV</button></div>
      ${list.length ? `<div class="tbl-wrap"><table><thead><tr><th>平台</th><th>标题</th><th>作者</th><th class="num">赞</th><th class="num">藏</th><th class="num">评</th><th>存于</th><th></th></tr></thead><tbody>
        ${list.map(s => `<tr><td>${pfTag(s.platform)}</td><td><span class="ttl" title="${h(s.title)}">${s.url ? `<a href="${h(s.url)}" target="_blank" rel="noopener">${h(s.title || '(无标题)')}</a>` : h(s.title || '(无标题)')}</span></td><td>${h(s.author || '')}</td>
          <td class="num">${fmt(s.likes)}</td><td class="num">${fmt(s.collects)}</td><td class="num">${fmt(s.comments)}</td><td>${h(fmtDate(s.savedAt))}</td>
          <td><button class="btn ghost sm" data-action="snap-tpl" data-id="${h(s.id)}">转模板</button>${ui.confirm === 'snap:' + s.id ? `<button class="btn sm danger" data-action="snap-del" data-id="${h(s.id)}">确定删</button>` : `<button class="btn ghost sm" data-action="ask" data-v="snap:${h(s.id)}">删除</button>`}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty"><b>参考库是空的</b>${E.canRead ? '刷到好内容时，读取页面后点"存为参考"。' : ''}</div>`}`;
  }

  // ---------- 设置页 ----------
  function viewSettings() {
    const R = rules(); const a = aiCfg() || { provider: 'deepseek', key: '', model: '' }; const pv = window.AI.PROVIDERS[a.provider] || window.AI.PROVIDERS.deepseek;
    const ind = industry();
    return `<div class="section-h" style="margin-top:0"><h2>默认行业</h2><span class="hint">决定调研的需求维度、默认模板和违规词检查</span></div>
      <div class="panel stack"><select id="s-ind" data-bind="s-ind">${I.list().map(x => `<option value="${x.key}" ${ind === x.key ? 'selected' : ''}>${h(x.name)}</option>`).join('')}</select>
        <span class="hint">本行业模板 ${L.forIndustry(ind).length} 个；违规词 ${I.banned(ind).length} 个。调研和模板页也可以临时切换行业。</span></div>

      <div class="section-h"><h2>AI（可选）</h2><span class="hint">用于"AI 按人设写"和"用 AI 归纳需求"；密钥只保存在这台电脑的浏览器里，不会导出</span></div>
      <div class="panel stack">
        <div class="grid3">
          <label class="f"><span>用哪家 AI</span><select id="ai-pv" data-bind="ai" data-f="provider">${Object.entries(window.AI.PROVIDERS).map(([k, v]) => `<option value="${k}" ${a.provider === k ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label>
          <label class="f" style="grid-column:span 2"><span>API 密钥</span><input type="password" id="ai-key" data-bind="ai" data-f="key" value="${h(a.key || '')}" placeholder="粘贴你自己的 API Key" autocomplete="off"></label>
        </div>
        <label class="f"><span>模型名称${pv.model ? `（默认 ${h(pv.model)}，一般不用改）` : '（豆包需要填你在火山方舟开通的模型 ID）'}</span><input type="text" id="ai-model" data-bind="ai" data-f="model" value="${h(a.model || '')}" placeholder="${h(pv.model || '')}"></label>
        <div class="row"><button class="btn primary sm" data-action="ai-save">保存</button><button class="btn sm" data-action="ai-test">测试连接</button><a class="btn ghost sm" href="${h(pv.site)}" target="_blank" rel="noopener">去申请密钥</a>${a.key ? '<button class="btn ghost sm danger" data-action="ai-clear">清除密钥</button>' : ''}<span class="hint">${aiReady() ? '✓ 已设置' : '未设置'}</span></div>
      </div>

      <div class="section-h"><h2>平台规则</h2><span class="hint">内容页按这里的数字检查字数</span></div>
      <div class="rules">${['xhs', 'douyin'].map(p => { const r = R[p]; return `<div class="panel stack">
        <div class="row">${pfTag(p)}<b>${h(r.name)}</b></div>
        <div class="grid3">
          <label class="f"><span>标题上限</span><input type="number" min="1" id="ru-${p}-t" data-bind="rule" data-p="${p}" data-f="titleMax" value="${h(r.titleMax)}"></label>
          <label class="f"><span>正文上限</span><input type="number" min="1" id="ru-${p}-b" data-bind="rule" data-p="${p}" data-f="bodyMax" value="${h(r.bodyMax)}"></label>
          <label class="f"><span>话题上限</span><input type="number" min="1" id="ru-${p}-g" data-bind="rule" data-p="${p}" data-f="tagMax" value="${h(r.tagMax)}"></label>
        </div>
        <div class="hint">${h(r.media)}</div>
        <ul class="hint" style="margin:0;padding-left:18px">${(r.notes || []).map(x => `<li>${h(x)}</li>`).join('')}</ul>
      </div>`; }).join('')}</div>

      <div class="section-h"><h2>违规词检查</h2><span class="hint">「${h(I.get(ind).name)}」，命中会提示；"第一次""第一时间"这类不算</span></div>
      <div class="panel"><div class="chips">${I.banned(ind).map(w => `<span class="pf both">${h(w)}</span>`).join('')}</div>
        <p class="hint" style="margin:8px 0 0">另外检查手机号、微信、外部链接、二维码等导流字样。</p></div>

      <div class="section-h"><h2>备份与换电脑</h2></div>
      <div class="panel stack">
        <div class="row"><button class="btn primary sm" data-action="export-all">导出全部（JSON）</button>
          <label class="btn sm" for="import-file">导入 JSON</label><input type="file" id="import-file" accept=".json,application/json" hidden data-action="import"></div>
        <span class="hint">包含账号、我的模板、发布记录、参考库和规则；不包含 AI 密钥和调研报告（调研报告可以单独导出 Excel）。导入是合并，同编号覆盖。</span>
      </div>`;
  }

  // ---------- 动作 ----------
  async function act(action, el) {
    const id = el.dataset.id;
    if (action.startsWith('rv-')) return window.Reviews && window.Reviews.act(action, el);
    if (action.startsWith('cm-')) return window.Comments && window.Comments.act(action, el);
    if (action.startsWith('fs-')) return window.Feishu && window.Feishu.act(action, el);
    if (action.startsWith('lb-')) return window.Library && window.Library.act(action, el);
    if (action.startsWith('rs-') || action === 'go-settings') return window.Research && window.Research.act(action, el);
    switch (action) {
      case 'ext-reload': try { chrome.runtime.reload(); } catch (e) { toast('请到 chrome://extensions 点插件的刷新按钮'); } break;
      case 'tab': ui.tab = el.dataset.tab; ui.confirm = null; render(); window.scrollTo(0, 0); break;
      case 'cancel': ui.confirm = null; render(); break;
      case 'ask': ui.confirm = el.dataset.v; render(); break;
      // ----- 内容 -----
      case 'c-src': {
        const k = el.dataset.v; if (ui.src.kind === k) return;
        ui.src = { kind: k }; ui.results = {}; ui.accIds = null; ui.ai = null;
        if (k !== 'tpl' && window.Research && !ui.srcRunId) { const r = window.Research.list()[0]; if (r) await loadRunCache(r.id); }
        render(); break;
      }
      case 'c-cat': ui.cat = el.dataset.v; ui.tplId = null; ui.accIds = null; ui.results = {}; render(); break;
      case 'c-pf': ui.pf = el.dataset.v; ui.tplId = null; ui.accIds = null; ui.results = {}; render(); break;
      case 'c-pick': ui.tplId = id; ui.accIds = null; ui.results = {}; render(); break;
      case 'c-need': {
        const run = currentRun(); if (!run) return;
        const ND = run.ai || window.Needs.ruleNeeds(run.comments, run.keywords.map(k => k.group || k.kw), run.industry);
        const n = ND.needs[+el.dataset.i]; if (!n) return;
        ui.src = { kind: 'need', runId: run.id, industry: run.industry, need: { name: n.name, type: n.type, count: n.count, quotes: n.quotes, insight: n.insight || '', action: n.action || '', angle: n.angle || '' } };
        ui.answer = ''; ui.results = {}; ui.accIds = null; render(); break;
      }
      case 'c-hot': {
        const run = currentRun(); if (!run) return;
        const p = window.Insight.contentInsight(run.posts.filter(x => x.type !== 'shop')).top.find(x => x.id === id); if (!p) return;
        const payload = { kind: 'hot', runId: run.id, runTopic: run.topic, industry: run.industry, platform: p.platform || run.platform, post: p, city: run.city, area: run.area, exclude: run.keywords.map(k => k.group).filter(Boolean) };
        ui.src = Object.assign(payload, { tpl: hotToTemplate(payload) }); ui.results = {}; ui.accIds = null; render(); break;
      }
      case 'c-hot-save': { const t = ui.src.tpl; if (!t) return; await Store.put('templates', Object.assign(clone(t), { updatedAt: new Date().toISOString() })); toast('已存成模板，可以在「模板」里改'); break; }
      case 'c-acc': if (el.checked) { if (!ui.accIds.includes(id)) ui.accIds.push(id); } else ui.accIds = ui.accIds.filter(x => x !== id); if (!ui.ai || !ui.ai.running) { regen(); render(); } break;
      case 'c-acc-all': { const tpl = sourceTemplate(); const accs = S().accounts.filter(a => a.status !== 'paused' && compatible(tpl, a)); ui.accIds = ui.accIds && ui.accIds.length === accs.length ? [] : accs.map(a => a.id); regen(); render(); break; }
      case 'c-acc-group': { const tpl = sourceTemplate(); const g = el.dataset.g; const ids = S().accounts.filter(a => a.status !== 'paused' && compatible(tpl, a) && (a.group || '未分组') === g).map(a => a.id); const allIn = ids.every(x => ui.accIds.includes(x)); ui.accIds = allIn ? ui.accIds.filter(x => !ids.includes(x)) : [...new Set(ui.accIds.concat(ids))]; regen(); render(); break; }
      case 'c-vary': ui.vary = el.checked; regen(); rerenderResults(); break;
      case 'c-regen': Object.keys(ui.results).forEach(k => { ui.rounds[k] = (ui.rounds[k] || 0) + 1; }); regen(); render(); break;
      case 'c-ai': runAi(); break;
      case 'c-ai-stop': if (ui.ai && ui.ai.ctl) ui.ai.ctl.abort(); break;
      case 'reroll': ui.rounds[id] = (ui.rounds[id] || 0) + 1; if (!ui.vary) ui.vary = true; regen(id); rerenderResults(); break;
      case 'copy': {
        const r = ui.results[id]; if (!r) return; const w = el.dataset.what;
        const map = { title: [r.title, '标题'], body: [r.body, '正文'], tags: [C.tagsText(r.tags), '话题'], script: [r.script, '脚本'], all: [C.fullText(r), '标题+正文+话题'] };
        await copy(map[w][0], map[w][1]); break;
      }
      case 'copy-batch': { const tpl = sourceTemplate(); const txt = selectedAccounts(tpl).map(a => ui.results[a.id] ? `【${a.name}】\n${C.fullText(ui.results[a.id])}` : '').filter(Boolean).join('\n\n————————\n\n'); await copy(txt, '全部账号'); break; }
      case 'fill': { const r = ui.results[id]; if (!r) return; const res = await E.fill({ title: r.title, body: r.body + '\n\n' + C.tagsText(r.tags), platform: r.platform }); toast(res && res.msg ? res.msg : '已填入'); break; }
      case 'mark': {
        const r = ui.results[id]; const a = byId(S().accounts, id); if (!r || !a) return;
        if (ui.done[id]) { toast('这条已经记过了'); return; }
        const rec = { id: C.uid('rec'), accountId: a.id, accountName: a.name, platform: r.platform, templateId: r.templateId || '', templateName: r.templateName || '', source: ui.src.kind, ai: !!r.ai, title: r.title, tags: r.tags, url: '', publishedAt: new Date().toISOString(), likes: null, collects: null, comments: null, shares: null };
        await Store.put('records', rec); ui.done[id] = rec.id; rerenderResults(); refreshTabCounts(); toast('已记录，发布后到「数据」页粘贴链接'); break;
      }
      // ----- 模板 -----
      case 't-cat': ui.tCat = el.dataset.v; render(); break;
      case 't-new': ui.editTpl = { id: C.uid('tpl'), ind: ui.tInd && ui.tInd !== 'all' ? ui.tInd : industry(), name: '新模板', category: ui.tCat !== '全部' ? ui.tCat : '探店种草', platform: 'xhs', title: '', body: '', tags: ['{{城市}}'], script: '' }; ui.confirm = null; render(); break;
      case 't-edit': ui.editTpl = clone(byId(allTpls(), id)); ui.confirm = null; render(); break;
      case 't-close': ui.editTpl = null; render(); break;
      case 't-save': { const d = ui.editTpl; if (!d) return; if (!String(d.name).trim()) { toast('给模板起个名字'); return; } d.updatedAt = new Date().toISOString(); await Store.put('templates', clone(d)); ui.results = {}; toast('模板已保存'); render(); break; }
      case 't-dup': { const src = byId(allTpls(), id); if (!src) return; ui.editTpl = Object.assign(clone(src), { id: C.uid('tpl'), name: src.name + '（副本）', builtin: false }); render(); break; }
      case 't-reset': await Store.remove('templates', id); ui.editTpl = clone(byId(allTpls(), id)); toast('已恢复默认'); render(); break;
      case 't-del': await Store.remove('templates', id); ui.editTpl = null; ui.confirm = null; ui.results = {}; toast('已删除'); render(); break;
      case 't-use': ui.src = { kind: 'tpl' }; ui.tplId = id; ui.cat = '全部'; ui.pf = 'all'; ui.ind = 'all'; ui.accIds = null; ui.results = {}; ui.tab = 'compose'; render(); break;
      // ----- 账号 -----
      case 'a-new': ui.editAcc = C.migrateAccount({ id: C.uid('acc'), name: '', platform: 'xhs', vars: {} }); ui.confirm = null; render(); break;
      case 'a-edit': ui.editAcc = C.migrateAccount(clone(byId(S().accounts, id))); ui.confirm = null; render(); break;
      case 'a-close': ui.editAcc = null; render(); break;
      case 'accvar-add': { const inp = document.getElementById('ac-newkey'); const k = (inp && inp.value || '').trim().replace(/[{}]/g, ''); if (!k) { toast('先填变量名'); return; } ui.editAcc.vars[k] = ui.editAcc.vars[k] || ''; render(); break; }
      case 'accvar-del': delete ui.editAcc.vars[el.dataset.k]; render(); break;
      case 'a-save': { const d = ui.editAcc; if (!d) return; if (!String(d.name).trim()) { toast('给账号起个备注名'); return; } d.weeklyTarget = +d.weeklyTarget || 0; await Store.put('accounts', clone(d)); ui.accIds = null; ui.results = {}; toast('账号已保存'); render(); break; }
      case 'a-del': await Store.remove('accounts', id); ui.editAcc = null; ui.confirm = null; ui.accIds = null; ui.results = {}; toast('已删除'); render(); break;
      case 'a-tpl': {
        const sample = ['天河店小红书', '小红书', '天河店', '老板/店长', '亲切自然', '正常', 3, '', '某某店（天河店）', '广州', '天河路', '天河路 1 号', '招牌产品', '78 元', '10:00-22:00'];
        const bytes = window.XlsxLite.build([{ name: '账号导入', widths: IMPORT_COLS.map(c => Math.max(10, c.length * 2 + 4)), rows: [IMPORT_COLS, sample] }]);
        await E.download('账号导入模板.xlsx', bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); break;
      }
      // ----- 数据 -----
      case 'd-view': ui.dView = el.dataset.v; render(); break;
      case 'd-refresh': {
        const recs = S().records.filter(r => r.url);
        if (!recs.length) { ui.refresh = { msg: '还没有带链接的发布记录。在"发布记录"里粘贴帖子链接后再更新。', err: true }; render(); return; }
        ui.refresh = { running: true, done: 0, total: recs.length }; render();
        try {
          const out = await window.Research.refreshRecords(recs, (d, t) => { ui.refresh.done = d; ui.refresh.total = t; render(); });
          for (const o of out) { const r = byId(S().records, o.id); if (!r) continue; const num = v => (v === null || v === undefined || v === '' ? null : typeof v === 'number' ? v : C.parseCount(v)); await Store.put('records', Object.assign({}, r, { likes: num(o.likes) ?? r.likes, collects: num(o.collects) ?? r.collects, comments: num(o.comments) ?? r.comments, shares: num(o.shares) ?? r.shares, dataUpdatedAt: new Date().toISOString() })); }
          ui.refresh = { msg: `已更新 ${out.length} 条记录的互动数据` };
        } catch (e) { ui.refresh = { msg: e.message || '更新失败', err: true }; }
        render(); break;
      }
      case 'rec-add': {
        const a = ui.recAcc !== 'all' ? byId(S().accounts, ui.recAcc) : S().accounts[0]; if (!a) { toast('先添加账号'); return; }
        await Store.put('records', { id: C.uid('rec'), accountId: a.id, accountName: a.name, platform: a.platform, title: '', url: '', publishedAt: new Date().toISOString(), likes: null, collects: null, comments: null, shares: null });
        ui.dView = 'records'; render(); break;
      }
      case 'rec-del': await Store.remove('records', id); ui.confirm = null; render(); break;
      case 'export-records': {
        const accs = S().accounts; const all = allTpls();
        const csv = C.toCSV(S().records, [
          { label: '发布时间', get: r => r.publishedAt ? new Date(r.publishedAt).toLocaleString('zh-CN') : '' }, { label: '平台', get: r => C.PLATFORM_LABEL[r.platform] || r.platform },
          { label: '账号', get: r => (byId(accs, r.accountId) || {}).name || r.accountName }, { label: '分组', get: r => (byId(accs, r.accountId) || {}).group || '' }, { label: '人设', get: r => PERSONA[(byId(accs, r.accountId) || {}).persona] || '' },
          { label: '模板', get: r => (byId(all, r.templateId) || {}).name || r.templateName || '' }, { label: 'AI 写作', get: r => (r.ai ? '是' : '') }, { label: '标题', key: 'title' }, { label: '链接', key: 'url' },
          { label: '赞', key: 'likes' }, { label: '收藏', key: 'collects' }, { label: '评论', key: 'comments' }, { label: '转发', key: 'shares' }, { label: '互动合计', get: r => C.interactions(r) }
        ]);
        await E.download('发布记录.csv', csv, 'text/csv'); break;
      }
      case 'export-snaps': {
        const csv = C.toCSV(S().snapshots, [{ label: '平台', get: r => C.PLATFORM_LABEL[r.platform] || r.platform }, { label: '标题', key: 'title' }, { label: '作者', key: 'author' }, { label: '话题', get: r => C.tagsText(r.tags) }, { label: '赞', key: 'likes' }, { label: '收藏', key: 'collects' }, { label: '评论', key: 'comments' }, { label: '链接', key: 'url' }, { label: '正文', key: 'desc' }]);
        await E.download('参考库.csv', csv, 'text/csv'); break;
      }
      case 'snap-read': {
        ui.snapBusy = true; render();
        try {
          const d = await E.readPage(); ui.snapDraft = Object.assign({ platform: 'xhs', tags: [] }, d);
          ['likes', 'collects', 'comments', 'shares'].forEach(k => { ui.snapDraft[k] = C.parseCount(ui.snapDraft[k]); });
          const key = noteKey(ui.snapDraft.url);
          const m = S().records.find(r => (key && noteKey(r.url) === key) || (r.title && ui.snapDraft.title && r.title.trim() === ui.snapDraft.title.trim()));
          if (m) ui.snapDraft.matchId = m.id;
        } catch (e) { toast(e && e.message ? e.message : '读取失败'); }
        ui.snapBusy = false; render(); break;
      }
      case 'snap-manual': ui.snapDraft = { platform: 'xhs', title: '', desc: '', tags: [], url: '', author: '', likes: null, collects: null, comments: null, shares: null }; render(); break;
      case 'snap-close': ui.snapDraft = null; render(); break;
      case 'snap-save': { const d = ui.snapDraft; if (!d) return; await Store.put('snapshots', { id: C.uid('snap'), platform: d.platform, url: d.url || '', title: d.title || '', desc: d.desc || '', tags: d.tags || [], author: d.author || '', publishedText: d.publishedText || '', likes: d.likes, collects: d.collects, comments: d.comments, shares: d.shares, savedAt: new Date().toISOString() }); ui.snapDraft = null; toast('已存入参考库'); render(); break; }
      case 'snap-update-rec': {
        const d = ui.snapDraft; if (!d) return; const rec = byId(S().records, d.matchId); if (!rec) { toast('先在下拉框里选一条发布记录'); return; }
        await Store.put('records', Object.assign({}, rec, { likes: d.likes, collects: d.collects, comments: d.comments, shares: d.shares, url: rec.url || d.url || '', dataUpdatedAt: new Date().toISOString() }));
        ui.snapDraft = null; toast('已更新这条发布记录的数据'); render(); break;
      }
      case 'snap-to-tpl': case 'snap-tpl': {
        const s = action === 'snap-tpl' ? byId(S().snapshots, id) : ui.snapDraft; if (!s) return;
        ui.editTpl = hotToTemplate({ industry: industry(), platform: s.platform, post: { title: s.title, desc: s.desc, tags: s.tags, url: s.url, eng: C.interactions(s) } });
        ui.tab = 'templates'; render(); toast('已转成模板草稿，确认变量后保存'); break;
      }
      case 'snap-del': await Store.remove('snapshots', id); ui.confirm = null; render(); break;
      // ----- 设置 -----
      case 'ai-save': await E.aiSave(ui.aiDraft || aiCfg()); toast('AI 设置已保存'); render(); break;
      case 'ai-clear': await E.aiSave(Object.assign({}, aiCfg(), { key: '' })); ui.aiDraft = null; toast('已清除密钥'); render(); break;
      case 'ai-test': {
        el.disabled = true; el.textContent = '测试中…';
        try { const cfg = ui.aiDraft || aiCfg(); const t = await window.AI.chat(cfg, '只回复两个字：成功', undefined, { maxTokens: 20 }); await E.aiSave(cfg); toast('连接成功：' + String(t).trim().slice(0, 20)); }
        catch (e) { toast(e.message); }
        render(); break;
      }
      case 'export-all': {
        const data = { app: 'rest-matrix', version: 2, exportedAt: new Date().toISOString(), templates: S().templates, accounts: S().accounts, records: S().records, snapshots: S().snapshots, settings: S().settings };
        await E.download(`矩阵助手备份-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json'); break;
      }
    }
  }
  async function loadRunCache(runId) {
    if (!runId) { ui.srcRunId = null; return; }
    if (!ui.runCache[runId] && window.Research) ui.runCache[runId] = await window.Research.loadRun(runId);
    ui.srcRunId = runId;
  }
  function noteKey(url) { if (!url) return ''; const m = String(url).match(/(?:explore|discovery\/item|item)\/([0-9a-f]{16,})/i) || String(url).match(/(?:video|note)\/(\d{10,})/); return m ? m[1] : ''; }
  function refreshTabCounts() { const counts = { accounts: S().accounts.length, data: S().records.length }; document.querySelectorAll('.tabs button').forEach(b => { const n = b.querySelector('.n'); if (n && counts[b.dataset.tab] !== undefined) n.textContent = counts[b.dataset.tab]; }); }

  // ---------- 输入绑定 ----------
  const timers = {};
  const debounce = (k, fn, ms) => { clearTimeout(timers[k]); timers[k] = setTimeout(fn, ms || 500); };
  function onInput(el) {
    const b = el.dataset.bind; const f = el.dataset.f;
    if (b === 'bv') { const s = S().settings; s.batchVars = Object.assign({}, s.batchVars, { [el.dataset.k]: el.value }); if (!Object.values(ui.results).some(r => r.ai)) { regen(); rerenderResults(); } debounce('settings', () => Store.saveSettings(s), 700); }
    else if (b === 'c-answer') { ui.answer = el.value; if (!Object.values(ui.results).some(r => r.ai)) { regen(); rerenderResults(); } }
    else if (b === 'c-extra') ui.extra = el.value;
    else if (b === 'res') { const r = ui.results[el.dataset.id]; if (!r) return; if (f === 'tags') r.tags = parseTags(el.value); else r[f] = el.value; refreshTicketMeta(el.dataset.id); }
    else if (b === 'tpl') { const d = ui.editTpl; if (!d) return; d[f] = f === 'tags' ? parseTags(el.value) : el.value; const p = document.getElementById('tp-preview'); if (p) p.textContent = tplPreview(d); const v = document.getElementById('tp-vars'); if (v) v.textContent = '用到：' + (C.listVars(d).join('、') || '无'); }
    else if (b === 'acc') { if (ui.editAcc) ui.editAcc[f] = el.value; }
    else if (b === 'accvar') { if (ui.editAcc) ui.editAcc.vars[el.dataset.k] = el.value; }
    else if (b === 'snap') { const d = ui.snapDraft; if (!d) return; if (f === 'tagsText') d.tags = parseTags(el.value); else if (['likes', 'collects', 'comments', 'shares'].includes(f)) d[f] = el.value === '' ? null : Number(el.value); else d[f] = el.value; }
    else if (b === 'rule') { const s = S().settings; const n = parseInt(el.value, 10); if (!isNaN(n) && n > 0) { s.rules[el.dataset.p][f] = n; ui.results = {}; debounce('settings', () => Store.saveSettings(s), 700); } }
    else if (b === 'ai') { ui.aiDraft = Object.assign({}, ui.aiDraft || aiCfg() || { provider: 'deepseek' }, { [f]: el.value.trim() }); }
  }
  async function onChange(el) {
    const b = el.dataset.bind;
    if (b === 'rec') {
      const rec = byId(S().records, el.dataset.id); if (!rec) return; const f = el.dataset.f; const upd = Object.assign({}, rec);
      if (f === 'publishedAt') { const d = new Date(el.value); upd.publishedAt = isNaN(d) ? rec.publishedAt : d.toISOString(); }
      else if (['likes', 'collects', 'comments', 'shares'].includes(f)) upd[f] = el.value === '' ? null : Math.max(0, Number(el.value));
      else upd[f] = el.value;
      await Store.put('records', upd); return;
    }
    if (b === 'c-ind') { ui.ind = el.value; ui.tplId = null; ui.accIds = null; ui.results = {}; render(); }
    else if (b === 'c-sort') { ui.sort = el.value; render(); }
    else if (b === 'c-run') { await loadRunCache(el.value); ui.src = { kind: ui.src.kind }; ui.results = {}; render(); }
    else if (b === 't-ind') { ui.tInd = el.value; render(); }
    else if (b === 't-sort') { ui.tSort = el.value; render(); }
    else if (b === 'a-group') { ui.aGroup = el.value; render(); }
    else if (b === 'a-pf') { ui.aPf = el.value; render(); }
    else if (b === 'rec-acc') { ui.recAcc = el.value; render(); }
    else if (b === 's-ind') { const s = S().settings; s.industry = el.value; await Store.saveSettings(s); ui.ind = null; ui.tInd = null; ui.tplId = null; ui.results = {}; toast('默认行业已切换为：' + I.get(el.value).name); render(); }
    else if (b === 'ai' && el.dataset.f === 'provider') { ui.aiDraft = Object.assign({}, ui.aiDraft || aiCfg() || {}, { provider: el.value, model: '' }); render(); setTimeout(() => { const k = document.getElementById('ai-key'); if (k) k.value = (ui.aiDraft || {}).key || ''; }, 0); }
    else if (b === 'tpl' && el.dataset.f === 'platform') { const p = document.getElementById('tp-preview'); if (p && ui.editTpl) p.textContent = tplPreview(ui.editTpl); }
  }
  function isEditing() { const a = document.activeElement; return a && root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox'; }

  root.addEventListener('click', e => {
    const el = e.target.closest('[data-action]'); if (!el || !root.contains(el)) return;
    const a = el.dataset.action;
    if (['c-acc', 'c-vary', 'import', 'a-import'].includes(a)) return; // 交给 change
    if (el.tagName === 'LABEL' && el.htmlFor) return;
    if (el.tagName === 'A' && el.getAttribute('href')) return;
    e.preventDefault(); act(a, el);
  });
  root.addEventListener('change', e => {
    const el = e.target; const a = el.dataset.action;
    if (a === 'c-acc' || a === 'c-vary') { act(a, el); return; }
    if (a === 'import') { importFile(el); return; }
    if (a === 'a-import') { if (el.files && el.files[0]) importAccounts(el.files[0]); el.value = ''; return; }
    onChange(el);
  });
  root.addEventListener('input', e => { if (e.target.dataset && e.target.dataset.bind) onInput(e.target); });
  root.addEventListener('focusout', () => { setTimeout(() => { if (ui.pendingRender && !isEditing()) { ui.pendingRender = false; render(); } }, 50); });

  function importFile(el) {
    const file = el.files && el.files[0]; if (!file) return;
    const fr = new FileReader();
    fr.onload = async () => {
      try {
        const data = JSON.parse(fr.result);
        if (!data || (!data.templates && !data.accounts && !data.records)) throw new Error('不是本工具导出的备份文件');
        if (data.templates) data.templates = data.templates.map(C.migrateTemplate);
        if (data.accounts) data.accounts = data.accounts.map(C.migrateAccount);
        const n = await Store.importMerge(data); ui.results = {}; ui.accIds = null; toast(`导入完成，共 ${n} 项`); render();
      } catch (err) { toast('导入失败：' + (err.message || '文件格式不对')); }
    };
    fr.readAsText(file, 'utf-8'); el.value = '';
  }

  // ---------- 调研 → 内容 / 模板 的桥 ----------
  window.__rmCompose = async payload => {
    await loadRunCache(payload.runId);
    if (payload.kind === 'hot') payload = Object.assign(payload, { tpl: hotToTemplate(payload) });
    ui.src = payload; ui.answer = ''; ui.extra = ''; ui.results = {}; ui.accIds = null; ui.ai = null; ui.tab = 'compose'; render(); window.scrollTo(0, 0);
    toast(payload.kind === 'need' ? '已带入需求点，写一句"我们的做法"再生成' : '已带入爆款，选账号后生成');
  };
  window.__rmHotToTemplate = payload => { ui.editTpl = hotToTemplate(payload); ui.tab = 'templates'; render(); window.scrollTo(0, 0); toast('已转成模板草稿，检查变量后点保存'); };
  window.__rmGoTab = t => { ui.tab = t; render(); window.scrollTo(0, 0); };

  // ---------- 启动 ----------
  Store.onRemote = () => { if (isEditing()) ui.pendingRender = true; else render(); };
  root.innerHTML = '<main><div class="empty"><b>正在加载…</b></div></main>';
  Promise.resolve(E.aiLoad ? E.aiLoad() : null).then(() => Store.init()).then(() => { if (Store.notice) ui.banner = Store.notice; render(); })
    .catch(err => { root.innerHTML = `<main><div class="empty"><b>加载失败</b>${h(err && err.message)}</div></main>`; });
  // 自动更新：文件夹里的插件被更新脚本换成新版后，这里提示一键重新加载（每 10 分钟看一次本地 manifest）
  async function checkVer() { try { const m = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' }).then(r => r.json()); const nv = m && m.version; const cur = chrome.runtime.getManifest().version; const was = window.__rmNewVer; window.__rmNewVer = nv && nv !== cur ? nv : ''; if (was !== window.__rmNewVer) render(); } catch (e) { } }
  setTimeout(checkVer, 20e3); setInterval(checkVer, 10 * 60e3);
  window.__rmRender = render; window.__rmToast = toast; window.__rmCopy = copy; window.__rmIsEditing = isEditing;
  if (window.Research) window.Research.attach(root);
  if (window.Comments) window.Comments.attach(root);
  if (window.Library) window.Library.attach(root);
  if (window.Feishu) window.Feishu.attach(root);
})();
