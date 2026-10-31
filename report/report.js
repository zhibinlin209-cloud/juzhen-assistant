/* 评价调研报告：页面、Claude 调用、团队共享、Excel 导出 */
(function () {
  'use strict';
  const P = window.Pipeline, X = window.XlsxLite;
  const app = document.getElementById('app');
  const h = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const br = s => h(s).replace(/\n/g, '<br>');
  const uid = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const S = {
    db: null, sample: null, downloads: null, user: null, ready: false, sampleOk: true,
    reports: [], loadedList: false, view: 'home', openId: null, items: null,
    form: { brand: '', menu: '', cap: 800, mode: 'file' },
    src: null, // { kind, label, items, table:{rows, map}, raw }
    job: null, msg: null, confirm: null
  };
  try { const f = JSON.parse(localStorage.getItem('rv_form') || 'null'); if (f) Object.assign(S.form, f, { mode: f.mode || 'file' }); } catch (e) { /* 无痕模式 */ }
  const saveForm = () => { try { localStorage.setItem('rv_form', JSON.stringify({ brand: S.form.brand, menu: S.form.menu, cap: S.form.cap })); } catch (e) { /* ignore */ } };

  let toastT;
  function toast(m) { let el = document.querySelector('.toast'); if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); } el.textContent = m; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2400); }

  // ---------- 报告表格（页面和 Excel 共用） ----------
  const HEADS = {
    s1: ['产品', '正向细节命中', '顾客真正夸的点', '代表性原话/证据', '可提炼卖点', '拍摄重点'],
    s2: ['产品', '负向细节命中', '具体问题', '代表性原话/证据', '问题本质', '整改重点'],
    s3: ['顾客需求/口碑点', '命中评价数', '顾客具体怎么说', '需求判断', '内容表达', '必须拍到的证据镜头'],
    s4: ['吐槽点', '命中评价数', '具体表现', '归因', '整改动作', '影响级别'],
    s5: ['排序', '核心卖点', '评价证据', '内容母题', '建议镜头', '适合菜品/场景'],
    s6: ['客流维度', '评价命中量', '评价里能明确看到的特征', '代表性证据', '经营判断', '内容/投放启示']
  };
  const TITLES = {
    s1: '一、顾客明确提及的好评产品', s2: '二、顾客明确提及的差评产品', s3: '三、顾客反复描述的“具体口碑点”——真正可以变成拍摄卖点',
    s4: '四、顾客反复描述的“具体吐槽点”——需要优先整改', s5: brand => `五、${brand}评价调研后的“内容拍摄结论”`, s6: n => `六、客流特征分析（基于${n}条评价文本）`
  };
  const quoteJoin = arr => (arr || []).slice(0, 2).map(q => `“${q}”`).join(' / ');
  const dJoin = arr => (arr || []).slice(0, 4).map(x => x[0]).filter(Boolean).join('；');

  function buildTable(brand, A, W, meta) {
    W = W || {};
    const by = (arr, id) => (arr || []).find(x => x && x.id === id) || {};
    const rows = (list, fn) => list.map(fn);
    const G = P.goodProducts(A), B = P.badProducts(A);
    const range = meta.range ? `｜区间：${meta.range.from} 至 ${meta.range.to}` : '';
    const segs = A.segments.filter(s => s.count >= 3);
    const fin = W.final || {};
    return {
      title: `${brand}｜顾客评价调研模块`,
      note: `评价样本：${meta.relevant}条有效（共读取 ${meta.analyzed} 条${meta.total > meta.analyzed ? `，原始去重后 ${meta.total} 条` : ''}）${range}｜来源：${meta.source}｜口径：逐条提取顾客明确描述的产品、具体体验与客流场景；各类命中可交叉，不可直接相加为人数。`,
      s1: rows(G, p => { const w = by(W.goodProducts, p.id); return { c: [p.name, p.pos, w.praise || dJoin(p.posD), w.evidence || quoteJoin(p.posQ), w.sell || '', w.shoot || ''], q: p.posQ }; }),
      s2: rows(B, p => { const w = by(W.badProducts, p.id); return { c: [p.name, p.neg, w.issue || dJoin(p.negD), w.evidence || quoteJoin(p.negQ), w.essence || '', w.fix || ''], q: p.negQ }; }),
      s3: rows(A.praise, x => { const w = by(W.praise, x.id); return { c: [x.name, x.count, w.say || '', w.judge || '', w.express || '', w.shots || ''], q: x.q }; }),
      s4: rows(A.complaints, x => { const w = by(W.complaints, x.id); return { c: [x.name, x.count, w.show || quoteJoin(x.q), w.cause || '', w.action || '', w.level || ''], q: x.q }; }),
      s5: (W.content || []).slice(0, 6).map((c, i) => ({ c: [i + 1, c.point || '', c.evidence || '', c.theme || '', c.shots || '', c.fit || ''] })),
      s6: rows(segs, x => { const w = by(W.segments, x.id); return { c: [x.name, x.count, w.feature || '', w.evidence || quoteJoin(x.q), w.judge || '', w.insight || ''], q: x.q }; }),
      final: [fin.conclusion || '', fin.support || '', fin.model || '', fin.priority || ''],
      sampleN: meta.relevant
    };
  }

  // ---------- 渲染 ----------
  function render() {
    const rep = S.view === 'report' ? S.reports.find(r => r.id === S.openId) : null;
    app.innerHTML = `
      <header class="top">
        <h1>评价调研报告</h1><span class="sub">顾客评价 → 好评产品 · 差评产品 · 口碑点 · 吐槽点 · 拍摄结论 · 客流</span>
        <div class="right">${rep ? `
          <button class="btn ghost sm" data-a="home">← 全部报告</button>
          <button class="btn primary sm" data-a="xlsx">导出 Excel</button>
          ${rep.example ? '' : (S.confirm === 'del' ? `<span class="confirm">删除后团队都看不到了<button class="btn sm danger" data-a="del">确定删除</button><button class="btn sm" data-a="nodel">取消</button></span>` : `<button class="btn ghost sm" data-a="askdel">删除</button>`)}` : ''}
        </div>
      </header>
      ${S.msg ? `<div class="banner ${S.msg.k || ''}" style="margin-top:12px">${h(S.msg.t)}</div>` : ''}
      ${rep ? viewReport(rep) : viewHome()}`;
  }

  function viewHome() {
    return `<div class="grid two">
      <section class="card stack" aria-labelledby="new-h">
        <div><h2 id="new-h">新建调研</h2><span class="hint">Claude 会逐条读评价，按你们的模板统计命中数并写出结论。</span></div>
        ${S.job ? viewJob() : viewForm()}
      </section>
      <section class="stack" aria-labelledby="hist-h">
        <h2 id="hist-h" style="margin:0;font:600 16px/1.3 var(--f-display)">全部报告</h2>
        ${viewHistory()}
      </section>
    </div>`;
  }
  function viewForm() {
    const f = S.form; const src = S.src;
    const canRun = S.sample && S.sampleOk;
    return `
      <div class="cols2">
        <label class="f"><span>门店 / 品牌名</span><input type="text" id="f-brand" data-f="brand" value="${h(f.brand)}" placeholder="如：珠海玖洲道店"></label>
        <label class="f"><span>招牌菜（可选，帮助认菜名）</span><input type="text" id="f-menu" data-f="menu" value="${h(f.menu)}" placeholder="如：爆膏奶油虾、捞汁花甲、蒜蓉生蚝"></label>
      </div>
      <div class="row"><span class="hint">评价来源</span>
        <div class="seg" role="group"><button data-a="mode" data-v="file" aria-pressed="${f.mode === 'file'}">上传文件</button><button data-a="mode" data-v="paste" aria-pressed="${f.mode === 'paste'}">粘贴</button></div></div>
      ${f.mode === 'file' ? `
        <label class="drop" id="drop" for="file"><b>点击选择或拖进文件</b>点评/美团后台导出的评价 Excel、CSV，或扩展「调研」导出的数据文件（.json）</label>
        <input type="file" id="file" accept=".xlsx,.csv,.txt,.json" hidden>`
        : `<label class="f"><span>粘贴扩展「调研」复制的数据，或一行一条评价</span><textarea id="paste" rows="6" placeholder="在扩展的调研报告里点「生成深度报告」，再粘贴到这里"></textarea></label>
        <div class="row"><button class="btn sm" data-a="readpaste">读取</button></div>`}
      ${src ? viewSource(src) : ''}
      ${src ? `<div class="row">
        <label class="f" style="width:auto"><span>分析条数</span><select id="f-cap" data-f="cap">${[[300, '300 条（快速试跑）'], [800, '800 条'], [1500, '1500 条'], [3000, '全部（最多 3000）']].map(([v, l]) => `<option value="${v}" ${+f.cap === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <span class="hint grow">${estimate(src)}</span></div>
        ${canRun ? `<div class="row"><button class="btn primary" data-a="run">开始分析</button><span class="hint">会用你自己的 Claude 用量；第一次会弹窗请你允许。</span></div>`
          : `<div class="banner">${S.sample ? '你拒绝了使用 Claude，刷新页面后可以重新允许。' : '这个页面只能在 Claude 里打开时调用 Claude 分析。'}报告仍可查看和导出。</div>`}` : ''}`;
  }
  function estimate(src) {
    const n = Math.min(src.items.length, +S.form.cap || 800);
    const calls = Math.ceil(n / 80) + 2;
    const min = Math.max(2, Math.round(calls * 40 / 2 / 60));
    return `将分析 ${n} 条，约 ${calls} 次 Claude 调用，预计 ${min}–${min * 2} 分钟`;
  }
  function viewSource(src) {
    const t = src.table;
    const rng = P.dateRange(src.items);
    return `<div class="stack" style="gap:10px">
      <div class="loaded">
        <div class="kpi"><b>${src.items.length}</b><span>条评价（已去重）</span></div>
        <div class="kpi"><b style="font-size:14px;font-family:var(--f-body)">${h(src.label)}</b><span>来源</span></div>
        ${rng ? `<div class="kpi"><b style="font-size:13px">${rng.from}<br>${rng.to}</b><span>日期区间</span></div>` : ''}
      </div>
      ${t ? `<div class="cols4">${[['text', '评价内容列'], ['date', '日期列'], ['likes', '点赞/有用列'], ['tag', '标签列（如回头客）']].map(([k, l]) => `
        <label class="f"><span>${l}</span><select id="map-${k}" data-map="${k}">${k === 'text' ? '' : '<option value="-1">无</option>'}${t.map.header.map((hd, i) => `<option value="${i}" ${t.map[k] === i ? 'selected' : ''}>${h(hd)}</option>`).join('')}</select></label>`).join('')}</div>` : ''}
      <pre class="preview">${h(src.items.slice(0, 6).map((it, i) => `${i + 1}. ${it.t.slice(0, 90)}`).join('\n'))}</pre>
    </div>`;
  }
  function viewJob() {
    const j = S.job;
    const nb = j.batches.length, ok = j.batches.filter(b => b.status === 'ok').length, fail = j.batches.filter(b => b.status === 'fail').length;
    const st = (k) => j.stage === k ? 'doing' : (j.done[k] ? 'done' : (j.failed === k ? 'fail' : ''));
    const pct = nb ? Math.round((ok + fail) / nb * 100) : 0;
    return `<div class="stack">
      <div class="row"><b>${h(j.brand)}</b><span class="hint grow">${j.items.length} 条</span>
        ${j.running ? `<button class="btn sm danger" data-a="stop">停止</button>` : ''}</div>
      <ol class="steps">
        <li class="${st('tax')}"><span class="dot">${j.done.tax ? '✓' : '1'}</span><span>通读样本，建立菜品 / 好评点 / 吐槽点分类</span><span class="hint">${j.tax ? `${j.tax.products.length} 菜 · ${j.tax.praise.length} 好评点 · ${j.tax.complaints.length} 吐槽点` : ''}</span></li>
        <li class="${st('tag')}"><span class="dot">${j.done.tag ? '✓' : '2'}</span><span>逐条打标签</span><span class="hint">${nb ? `${ok}/${nb} 批${fail ? ` · ${fail} 批失败` : ''}` : ''}</span></li>
        <li class="${st('write')}"><span class="dot">${j.done.write ? '✓' : '3'}</span><span>统计命中数，写结论</span><span class="hint"></span></li>
      </ol>
      ${j.stage === 'tag' || j.done.tax ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}
      ${j.note ? `<div class="banner ${j.noteKind || ''}">${h(j.note)}</div>` : ''}
      ${!j.running ? `<div class="row">
        ${j.paused ? `<button class="btn primary sm" data-a="resume">继续</button>` : ''}
        ${fail && j.done.tax && !j.done.write ? `<button class="btn sm" data-a="retry">重试失败的 ${fail} 批</button><button class="btn sm" data-a="skipfail">跳过，直接出报告</button>` : ''}
        ${j.failed === 'tax' || j.failed === 'write' ? `<button class="btn primary sm" data-a="resume">重试</button>` : ''}
        <button class="btn ghost sm" data-a="canceljob">放弃这次分析</button></div>` : ''}
    </div>`;
  }
  function viewHistory() {
    if (!S.loadedList) return `<div class="empty"><b>正在读取团队的报告…</b></div>`;
    if (!S.reports.length) return `<div class="empty"><b>还没有报告</b>上传评价文件开始第一份调研，完成后报告会保存在这里，团队成员打开这个页面都能看到。</div>`;
    return `<div class="hist">${S.reports.map(r => `<button class="it" data-a="open" data-id="${h(r.id)}"><b>${h(r.brand)} ${r.example ? '<span class="tag ex">示例</span>' : ''}</b><span>${r.sample ? r.sample.relevant + ' 条' : ''}</span>
      <span>${h(r.source || '')}</span><span>${r.createdAt ? new Date(r.createdAt).toLocaleDateString('zh-CN') : ''}</span></button>`).join('')}</div>`;
  }

  function viewReport(r) {
    const T = r.table;
    const sec = (key, title, rows, opts) => {
      opts = opts || {};
      const max = Math.max(1, ...rows.map(x => typeof x.c[1] === 'number' ? x.c[1] : 0));
      return `<section class="sec"><h3>${h(title)}</h3><div class="tw"><table class="t">
        <colgroup><col style="width:13%"><col style="width:${key === 's5' ? 6 : 8}%"><col style="width:20%"><col style="width:24%"><col style="width:17%"><col style="width:18%"></colgroup>
        <thead><tr>${HEADS[key].map(x => `<th scope="col">${h(x)}</th>`).join('')}</tr></thead><tbody>
        ${rows.length ? rows.map(x => `<tr>${x.c.map((v, i) => {
          if (i === 1 && typeof v === 'number' && key !== 's5') return `<td class="n">${v}<span class="mini"><i style="width:${Math.round(v / max * 100)}%"></i></span></td>`;
          if (key === 's5' && i === 0) return `<td class="n">${h(v)}</td>`;
          if (key === 's4' && i === 5) return `<td><span class="lvl ${/严重/.test(v) ? 'hi' : /中/.test(v) ? 'mid' : 'lo'}">${h(v)}</span></td>`;
          const evCol = { s1: 3, s2: 3, s6: 3, s3: 2, s4: 2 }[key];
          const more = i === evCol && x.q && x.q.length > 1 ? `<details class="more"><summary>更多原话（${x.q.length}）</summary><ul>${x.q.map(q => `<li>${h(q)}</li>`).join('')}</ul></details>` : '';
          return `<td class="${i === 0 ? 'name' : ''}">${br(v)}${more}</td>`;
        }).join('')}</tr>`).join('') : `<tr><td colspan="6" class="hint" style="text-align:center">没有足够的评价支撑这一部分</td></tr>`}
        ${opts.final ? `<tr class="final"><td>客流特征最终结论</td><td></td>${opts.final.map(v => `<td>${br(v)}</td>`).join('')}</tr>` : ''}
        </tbody></table></div></section>`;
    };
    return `<div class="rep">
      <div class="rep-title">${h(T.title)}</div>
      <div class="rep-note">${h(T.note)}</div>
      ${sec('s1', TITLES.s1, T.s1)}
      ${sec('s2', TITLES.s2, T.s2)}
      ${sec('s3', TITLES.s3, T.s3)}
      ${sec('s4', TITLES.s4, T.s4)}
      ${sec('s5', TITLES.s5(r.brand), T.s5)}
      ${sec('s6', TITLES.s6(T.sampleN), T.s6, { final: T.final && T.final.some(Boolean) ? T.final : null })}
      <p class="hint">命中数由 Claude 逐条阅读评价后统计，结论只引用评价里出现过的内容。${r.example ? '这份是根据你们上传的模板录入的示例，没有逐条明细。' : '导出的 Excel 里附有每条评价的打标明细，方便抽查。'}</p>
    </div>`;
  }

  // ---------- 读入数据 ----------
  async function loadFile(file) {
    S.msg = null;
    try {
      const name = file.name.toLowerCase(); const buf = await file.arrayBuffer();
      if (name.endsWith('.json')) return useText(P.decodeText(buf));
      if (name.endsWith('.xlsx')) {
        const sheets = await X.read(buf);
        const sh = sheets.slice().sort((a, b) => b.rows.length - a.rows.length)[0];
        if (!sh || sh.rows.length < 2) throw new Error('表格里没有数据');
        return useTable(sh.rows, `${file.name}`);
      }
      const text = P.decodeText(buf);
      if (name.endsWith('.csv')) return useTable(P.parseCSV(text), file.name);
      return useText(text, file.name);
    } catch (e) { S.msg = { k: 'err', t: '读取失败：' + (e.message || '文件格式不对') + '。支持 .xlsx（不支持老的 .xls，可另存为 .xlsx）、.csv、.json、.txt' }; render(); }
  }
  function useTable(rows, label) {
    const map = P.guessColumns(rows);
    if (map.text < 0) throw new Error('没找到评价内容列');
    S.src = { kind: 'table', label: `${label}`, table: { rows, map }, items: P.prepare(P.fromTable(rows, map)).items };
    if (!S.form.brand) S.form.brand = label.replace(/\.(xlsx|csv)$/i, '').replace(/[-_ ]?(评价|评论|导出|数据).*$/, '');
    render();
  }
  function useText(text, label) {
    text = String(text || '').trim();
    if (!text) { S.msg = { k: 'err', t: '没有内容' }; render(); return; }
    let data = null;
    if (/^[{[]/.test(text)) { try { data = JSON.parse(text); } catch (e) { data = null; } }
    if (data && (data.comments || data.posts)) {
      const r = P.fromExtension(data);
      S.src = { kind: 'ext', label: r.label, items: P.prepare(r.items).items };
      if (!S.form.brand) S.form.brand = r.brand;
    } else {
      S.src = { kind: 'text', label: label || '粘贴的评价', items: P.prepare(P.fromPlain(text)).items };
    }
    if (!S.src.items.length) { S.msg = { k: 'err', t: '没读到有效评价（每条至少 4 个字）' }; S.src = null; }
    render();
  }

  // ---------- 分析任务 ----------
  async function startJob() {
    const brand = S.form.brand.trim(); if (!brand) { toast('先填门店/品牌名'); document.getElementById('f-brand')?.focus(); return; }
    saveForm();
    const raw = S.src.kind === 'table' ? P.fromTable(S.src.table.rows, S.src.table.map) : S.src.items;
    const prep = P.prepare(raw.map(x => Object.assign({}, x)), +S.form.cap || 800);
    S.job = { id: uid('rep'), brand, menu: S.form.menu.trim(), items: prep.items, total: prep.total, source: S.src.label, tax: null, tags: {}, batches: [], stage: 'tax', done: {}, running: false, paused: false, note: '', failed: null, ctl: null };
    render(); run();
  }
  function errNote(e) {
    const c = e && e.code;
    if (c === 'not_granted') return ['你没有允许这个页面使用 Claude，分析已停止。刷新页面后可以重新允许。', 'stop'];
    if (c === 'rate_limited' || c === 'queue_overflow') return ['Claude 用量暂时到上限了。等几分钟后点"继续"，已完成的部分不会丢。', 'pause'];
    if (c === 'sampling_disabled' || c === 'capability_disabled' || c === 'capability_removed') return ['当前账号不能在页面里使用 Claude。', 'stop'];
    if (c === 'session_expired') return ['登录已过期，请刷新页面后点"继续"。', 'pause'];
    if (c === 'prompt_too_large') return ['一次发送的内容太多，请把分析条数调小。', 'stop'];
    if (c === 'cancelled') return ['已停止。', 'pause'];
    return [`这一步没成功（${c || '网络问题'}）。可以点"重试"。`, 'fail'];
  }
  async function run() {
    const j = S.job; if (!j || j.running) return;
    j.running = true; j.paused = false; j.note = ''; j.failed = null; render();
    try {
      // 1. 分类
      if (!j.tax) {
        j.stage = 'tax'; render();
        j.ctl = new AbortController();
        const raw = await S.sample.json(P.taxonomyPrompt(j.brand, j.menu, j.items), { modelTier: 'complex', signal: j.ctl.signal });
        const tax = P.validTax(raw); if (!tax || !tax.products.length) throw { code: 'invalid_json' };
        j.tax = tax; j.done.tax = true;
        for (let i = 0; i < j.items.length; i += 80) j.batches.push({ items: j.items.slice(i, i + 80), status: 'wait' });
      }
      // 2. 打标（同时跑 2 批）
      if (!j.done.tag) {
        j.stage = 'tag'; render();
        let stopReason = null;
        const worker = async () => {
          while (!stopReason) {
            const b = j.batches.find(x => x.status === 'wait'); if (!b) return;
            b.status = 'run';
            const ctl = new AbortController(); b.ctl = ctl; j.ctls = (j.ctls || []).concat(ctl);
            try {
              const out = await S.sample.json(P.tagPrompt(j.brand, j.tax, b.items), { modelTier: 'default', signal: ctl.signal });
              const tags = P.validTags(out, b.items);
              if (Object.keys(tags).length < b.items.length * 0.6) throw { code: 'invalid_json' };
              Object.assign(j.tags, tags); b.status = 'ok';
            } catch (e) {
              const [note, kind] = errNote(e);
              if (kind === 'fail') { b.status = 'fail'; b.err = e && e.code; }
              else { b.status = 'wait'; stopReason = stopReason || { note, kind }; }
            }
            render();
          }
        };
        await Promise.all([worker(), worker()]);
        if (stopReason) { j.note = stopReason.note; j.noteKind = stopReason.kind === 'stop' ? 'err' : ''; j.paused = stopReason.kind === 'pause'; j.running = false; render(); return; }
        const fails = j.batches.filter(b => b.status === 'fail');
        if (fails.length && !j.skipFail) {
          j.note = `${fails.length} 批（${fails.reduce((s, b) => s + b.items.length, 0)} 条）没有成功。可以重试，或者跳过直接出报告。`;
          j.running = false; render(); return;
        }
        j.done.tag = true;
      }
      // 3. 统计 + 写结论
      j.stage = 'write'; render();
      const A = P.aggregate(j.items, j.tags, j.tax);
      const meta = { relevant: A.totals.relevant, analyzed: A.totals.tagged, total: j.total, range: P.dateRange(j.items), source: j.source };
      j.ctl = new AbortController();
      const W = await S.sample.json(P.writePrompt(j.brand, A, meta), { modelTier: 'complex', signal: j.ctl.signal });
      j.done.write = true;
      await saveReport(j, A, W, meta);
    } catch (e) {
      const [note, kind] = errNote(e);
      j.note = note; j.noteKind = kind === 'stop' ? 'err' : '';
      if (kind === 'fail') j.failed = j.stage; else j.paused = kind === 'pause';
      j.running = false; render(); return;
    }
    j.running = false;
  }

  // ---------- 保存（团队共享） ----------
  function itemRows(j, tax) {
    const name = {}; tax.products.forEach(p => { name[p.id] = p.name; }); tax.praise.forEach(p => { name[p.id] = p.name; }); tax.complaints.forEach(p => { name[p.id] = p.name; }); P.SEGMENTS.forEach(s => { name[s.id] = s.name; });
    const nm = id => name[id] || String(id).replace(/^新[:：]/, '');
    return j.items.map(it => {
      const t = j.tags[it.i];
      return { i: it.i, t: it.t, l: it.l || 0, d: it.d || '', src: it.src || '', rel: t ? (t.r === 0 ? '无关' : '有效') : '未分析',
        p: t ? (t.p || []).filter(Array.isArray).map(([id, dir, det]) => `${nm(id)}(${dir === '+' ? '好' : dir === '-' ? '差' : '提及'}${det ? '：' + det : ''})`).join('；') : '',
        g: t ? (t.g || []).map(nm).join('、') : '', b: t ? (t.b || []).map(nm).join('、') : '', s: t ? (t.s || []).map(nm).join('、') : '' };
    });
  }
  async function saveReport(j, A, W, meta) {
    const table = buildTable(j.brand, A, W, meta);
    const doc = { id: j.id, brand: j.brand, createdAt: new Date().toISOString(), source: j.source,
      sample: { relevant: meta.relevant, analyzed: meta.analyzed, total: meta.total, from: meta.range ? meta.range.from : '', to: meta.range ? meta.range.to : '' },
      table, tax: { products: j.tax.products.map(p => p.name), praise: j.tax.praise.map(p => p.name), complaints: j.tax.complaints.map(p => p.name) }, chunks: 0 };
    const rows = itemRows(j, j.tax);
    S.items = { id: j.id, rows };
    try {
      if (S.user) { try { doc.by = await S.user.id(); } catch (e) { /* 匿名 */ } }
      const chunks = []; for (let i = 0; i < rows.length; i += 120) chunks.push(rows.slice(i, i + 120));
      doc.chunks = chunks.length;
      if (S.db) {
        await S.db.collection('reports').doc(j.id).set(doc);
        for (let k = 0; k < chunks.length; k++) await S.db.collection('reportItems').doc(`${j.id}_${k}`).set({ reportId: j.id, k, rows: chunks[k] });
      }
    } catch (e) {
      S.msg = { k: 'err', t: e && e.code === 'quota_exceeded' ? '团队库存满了，报告只在本次打开期间可见。请先导出 Excel 保存。' : '报告没能保存到团队（' + ((e && e.code) || '网络问题') + '），请先导出 Excel 保存。' };
    }
    if (!S.reports.find(r => r.id === doc.id)) S.reports.unshift(doc);
    S.job = null; S.src = null; S.view = 'report'; S.openId = doc.id; render(); window.scrollTo(0, 0);
    toast('报告已生成');
  }
  async function loadItems(rep) {
    if (S.items && S.items.id === rep.id) return S.items.rows;
    if (!S.db || !rep.chunks) return [];
    const rows = [];
    for (let k = 0; k < rep.chunks; k++) { const d = await S.db.collection('reportItems').doc(`${rep.id}_${k}`).get(); if (d.exists) rows.push(...(d.data().rows || [])); }
    S.items = { id: rep.id, rows }; return rows;
  }

  // ---------- Excel ----------
  async function exportXlsx(rep) {
    const T = rep.table;
    const rows = [], merges = [], heights = {};
    const add = (cells, ht) => { rows.push(cells); if (ht) heights[rows.length - 1] = ht; return rows.length; };
    const full = (v, s, ht) => { const r = add([{ v, s }, { v: '', s }, { v: '', s }, { v: '', s }, { v: '', s }, { v: '', s }], ht); merges.push(`A${r}:F${r}`); };
    full(T.title, 'title', 30);
    full(T.note, 'note', 40);
    const section = (key, title, list, final) => {
      add([]);
      full(title, 'section', 24);
      add(HEADS[key].map(v => ({ v, s: 'head' })), 32);
      list.forEach(x => add(x.c.map((v, i) => ({ v, s: (i === 1 && typeof v === 'number') || (key === 's5' && i === 0) ? 'num' : (key === 's4' && i === 5 && /严重/.test(v) ? 'warn' : 'cell') })), 72));
      if (final) add([{ v: '客流特征最终结论', s: 'final' }, { v: '', s: 'final' }, ...final.map(v => ({ v, s: 'final' }))], 90);
    };
    section('s1', TITLES.s1, T.s1); section('s2', TITLES.s2, T.s2); section('s3', TITLES.s3, T.s3); section('s4', TITLES.s4, T.s4);
    section('s5', TITLES.s5(rep.brand), T.s5); section('s6', TITLES.s6(T.sampleN), T.s6, T.final && T.final.some(Boolean) ? T.final : null);
    const sheets = [{ name: `${rep.brand}-评价调研`.slice(0, 31), styled: true, widths: [22, 14, 36, 48, 32, 36], rows, merges, heights }];
    if (!rep.example) {
      const items = await loadItems(rep).catch(() => []);
      if (items.length) sheets.push({ name: '评价明细（打标）', widths: [6, 60, 8, 12, 8, 8, 40, 28, 28, 28], rows: [['序号', '评价', '点赞', '日期', '来源', '是否有效', '提到的产品', '好评点', '吐槽点', '客流/场景'], ...items.map(r => [r.i, r.t, r.l, r.d, r.src, r.rel, r.p, r.g, r.b, r.s])] });
    }
    const bytes = X.build(sheets);
    const name = `${rep.brand}-顾客评价调研.xlsx`;
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (S.downloads) {
      try { await S.downloads.save({ filename: name, data: blob }); return; }
      catch (e) { if (e && e.code === 'declined') return; if (e && e.code !== 'unavailable' && e.code !== 'not_granted') { toast('导出失败：' + (e.code || '')); return; } }
    }
    toast('这里不能下载文件，请在 Claude 里打开这个页面再导出');
  }

  // ---------- 事件 ----------
  app.addEventListener('click', async e => {
    const el = e.target.closest('[data-a]'); if (!el) return;
    const a = el.dataset.a;
    switch (a) {
      case 'mode': S.form.mode = el.dataset.v; render(); break;
      case 'readpaste': useText(document.getElementById('paste').value); break;
      case 'run': startJob(); break;
      case 'stop': if (S.job) { (S.job.ctls || []).forEach(c => c.abort()); if (S.job.ctl) S.job.ctl.abort(); } break;
      case 'resume': run(); break;
      case 'retry': S.job.batches.forEach(b => { if (b.status === 'fail') b.status = 'wait'; }); run(); break;
      case 'skipfail': S.job.skipFail = true; run(); break;
      case 'canceljob': if (S.job) { (S.job.ctls || []).forEach(c => c.abort()); if (S.job.ctl) S.job.ctl.abort(); } S.job = null; render(); break;
      case 'open': S.view = 'report'; S.openId = el.dataset.id; S.confirm = null; S.msg = null; render(); window.scrollTo(0, 0); break;
      case 'home': S.view = 'home'; S.openId = null; S.confirm = null; render(); break;
      case 'xlsx': { const r = S.reports.find(x => x.id === S.openId); if (r) { el.disabled = true; await exportXlsx(r); el.disabled = false; } break; }
      case 'askdel': S.confirm = 'del'; render(); break;
      case 'nodel': S.confirm = null; render(); break;
      case 'del': {
        const r = S.reports.find(x => x.id === S.openId); if (!r) return;
        try { if (S.db) { await S.db.collection('reports').doc(r.id).delete(); for (let k = 0; k < (r.chunks || 0); k++) await S.db.collection('reportItems').doc(`${r.id}_${k}`).delete(); } }
        catch (err) { toast('删除失败：' + (err.code || '没有权限')); return; }
        S.reports = S.reports.filter(x => x.id !== r.id); S.view = 'home'; S.confirm = null; toast('已删除'); render(); break;
      }
    }
  });
  app.addEventListener('input', e => { const k = e.target.dataset && e.target.dataset.f; if (k === 'brand' || k === 'menu') S.form[k] = e.target.value; });
  app.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'file' && t.files && t.files[0]) { loadFile(t.files[0]); return; }
    if (t.dataset.f === 'cap') { S.form.cap = +t.value; render(); return; }
    if (t.dataset.map && S.src && S.src.table) {
      S.src.table.map[t.dataset.map] = +t.value;
      S.src.items = P.prepare(P.fromTable(S.src.table.rows, S.src.table.map)).items; render();
    }
  });
  app.addEventListener('dragover', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
  app.addEventListener('dragleave', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) d.classList.remove('over'); });
  app.addEventListener('drop', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) loadFile(f); } });
  window.addEventListener('beforeunload', e => { if (S.job && S.job.running) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- 启动 ----------
  render();
  (async () => {
    const use = n => (window.claude && window.claude.use ? window.claude.use(n).catch(() => null) : Promise.resolve(null));
    const [db, sample, downloads, user] = await Promise.all([use('db'), use('sample'), use('downloads'), use('user')]);
    Object.assign(S, { db, sample, downloads, user });
    if (db) {
      db.collection('reports').orderBy('createdAt', 'desc').limit(60).onSnapshot(snap => {
        const local = S.reports.filter(r => !snap.docs.some(d => d.id === r.id) && !r._remote && S.job === null && r.id === S.openId);
        S.reports = snap.docs.map(d => Object.assign({ _remote: true }, d.data(), { id: d.id })).concat(local);
        S.loadedList = true;
        const a = document.activeElement; if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
        render();
      }, () => { S.loadedList = true; render(); });
    } else { S.loadedList = true; }
    render();
  })();
  window.__rv = S;
})();
