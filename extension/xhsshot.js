/* 小红书截图同步：数据中心截图 → 通义千问识别 → 按「标题+日期」对上飞书「小红书矩阵号-数据」→ 写进新增的 (自动) 列
 * 不改同事手填的列；对不上 / 拿不准的放进「待确认」，人确认后才写
 */
(function () {
  'use strict';
  const h = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = m => window.__rmToast && window.__rmToast(m);
  const forceRender = () => window.__rmRender && window.__rmRender();
  const F = () => window.Feishu._api;
  const DAY = 864e5;
  const FIELDS = [['小眼睛(自动)', 2], ['点赞(自动)', 2], ['评论(自动)', 2], ['收藏(自动)', 2], ['分享(自动)', 2], ['数据更新于', 5]];

  const SS = { files: [], rows: null, table: null, running: false, phase: '', log: [], hint: '', done: null };
  let seq = 0;

  // ---------- 文本归一与相似度 ----------
  const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[.…。]+$/, '').replace(/[^\p{L}\p{N}]/gu, '');
  function bigrams(s) { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; }
  function dice(a, b) { if (a.length < 2 || b.length < 2) return a === b ? 1 : 0; const A = bigrams(a), B = bigrams(b); let inter = 0; A.forEach((n, g) => { inter += Math.min(n, B.get(g) || 0); }); return (2 * inter) / (a.length - 1 + b.length - 1); }
  function sim(a, b) {
    if (!a || !b) return 0; if (a === b) return 1;
    if (a.length >= 6 && b.startsWith(a)) return 0.96; // 截图标题被截断
    if (a.length >= 6 && b.includes(a)) return 0.9;
    if (b.length >= 6 && a.includes(b)) return 0.88;
    return dice(a, b);
  }
  function dateHit(md, ts) { // md = "10-20"
    const m = String(md || '').match(/(\d{1,2})\D+(\d{1,2})/); if (!m || !ts) return null;
    const d = new Date(ts); const cand = new Date(d.getFullYear(), +m[1] - 1, +m[2]).getTime();
    return Math.abs(cand - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) <= 1.5 * DAY;
  }

  // ---------- 读飞书小红书表 ----------
  async function loadRows() {
    const api = F(); const want = (api.ST.cfg.xhsTable || '小红书矩阵号-数据').trim();
    const tables = await api.listTables();
    const t = tables.find(x => x.name === want) || tables.find(x => /小红书/.test(x.name) && /数据/.test(x.name) && !/^AI-/.test(x.name));
    if (!t) throw new Error(`飞书里没找到「${want}」这张表（可在下面「目标表」里改名字）`);
    log(`读取「${t.name}」`);
    const recs = await api.listRecords(t.id, n => { SS.phase = `读取「${t.name}」${n} 行`; forceRender(); });
    const { val, pick, dateOf, num } = api;
    SS.table = t;
    SS.rows = recs.map(r => {
      const f = r.fields || {};
      const title = api.titleOf(pick(f, ['标题', '..标题']));
      const link = String(val(pick(f, ['小红书链接', '链接'])) || '');
      return { id: r.record_id, title, n: norm(title), date: dateOf(pick(f, ['发布日期', '发布时间'])), account: String(val(pick(f, ['账号昵称', '账号名称'])) || '').trim(), person: String(val(pick(f, ['人员', '发布人员'])) || '').trim(), link, views: num(pick(f, ['小眼睛'])), auto: num(f['小眼睛(自动)']) };
    });
    const raw = recs.map(r => (r.fields || {})['标题']).find(v => v !== undefined && v !== null);
    const noTitle = SS.rows.filter(r => !r.n).length; SS.rows = SS.rows.filter(r => r.n);
    if (noTitle) log(`有 ${noTitle} 条没读到标题；「标题」列原始格式样例：${JSON.stringify(raw === undefined ? '（这一列没有值）' : raw).slice(0, 120)}`);
    const withDate = SS.rows.filter(r => r.date).map(r => r.date); 
    log(`共 ${SS.rows.length} 条笔记可对${withDate.length ? `（${new Date(Math.min(...withDate)).toLocaleDateString('zh-CN')} – ${new Date(Math.max(...withDate)).toLocaleDateString('zh-CN')}）` : ''}；例：${SS.rows.slice(-2).map(r => r.title.slice(0, 14)).join(' / ')}`);
  }

  // ---------- 图片处理 ----------
  function readFile(file) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); }); }
  function loadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('图片打不开')); im.src = src; }); }
  async function slices(dataUrl) { // 长截图切段（有重叠），每段宽 ≤1080
    const im = await loadImg(dataUrl); const W = Math.min(1080, im.width); const k = W / im.width; const H = Math.round(im.height * k);
    const segH = Math.round(W * 2.4), overlap = Math.round(W * 0.35); const out = [];
    for (let y = 0; y < H; y += segH - overlap) {
      const hh = Math.min(segH, H - y); const cv = document.createElement('canvas'); cv.width = W; cv.height = hh;
      cv.getContext('2d').drawImage(im, 0, y / k, im.width, hh / k, 0, 0, W, hh); out.push(cv.toDataURL('image/jpeg', 0.85));
      if (y + hh >= H) break;
    }
    return out;
  }
  async function addFiles(list) {
    for (const file of list) { if (!/^image\//.test(file.type)) continue; SS.files.push({ id: ++seq, name: file.name || `粘贴的截图 ${seq}`, src: await readFile(file), status: 'wait', notes: [] }); }
    SS.done = null; forceRender();
  }

  // ---------- 识别 ----------
  const PROMPT = `这是小红书 App「数据中心 → 笔记分析」或创作者中心笔记列表的截图。请逐条提取截图里的每一条笔记。
规则：
- title：标题原文，只写看得到的部分，被截断就写到截断处，不要补全，去掉末尾省略号；
- date：封面上的日期，格式 MM-DD；没有就留空；
- views：眼睛图标后面的数字，原样照抄（如 1260、2.6万）；likes：爱心后的数字；comments：气泡后的数字；
- collects / shares：截图里明确有"收藏 / 分享"数字才填，否则 null；
- 只要数字完整可见的笔记；数字被截掉、看不清的那条不要；
- account：截图任何位置如果显示了账号昵称就填，没有就留空。不要编造。
只输出 JSON：{"account":"","notes":[{"title":"","date":"","views":"","likes":"","comments":"","collects":null,"shares":null}]}`;
  async function recognize(fi, vcfg) {
    fi.status = 'reading'; forceRender();
    const parts = await slices(fi.src); const seen = new Set(); fi.notes = []; fi.account = '';
    for (const p of parts) {
      const r = await window.AI.vision(vcfg, PROMPT, [p]); fi.model = r.model;
      const j = window.AI.parseJSON(r.text);
      if (j.account && !fi.account) fi.account = String(j.account).trim();
      for (const n of (j.notes || [])) {
        const t = String(n.title || '').trim(); const key = norm(t) + '|' + (n.date || ''); if (!t || seen.has(key)) continue; seen.add(key);
        const api = F();
        fi.notes.push({ title: t, date: String(n.date || '').trim(), views: api.num(n.views), likes: api.num(n.likes), comments: api.num(n.comments), collects: api.num(n.collects), shares: api.num(n.shares), rough: /万|w/i.test(String(n.views || '')) });
      }
    }
    fi.status = 'done';
  }

  // ---------- 匹配 ----------
  function candidates(n, accHint) {
    const a = norm(n.title); const now = Date.now();
    return SS.rows.filter(r => !r.date || now - r.date < 240 * DAY).map(r => {
      let s = sim(a, r.n); if (s < 0.45) return null;
      const dh = dateHit(n.date, r.date); if (dh === true) s += 0.15; else if (dh === false) s -= 0.25;
      if (accHint && r.account) s += norm(r.account) === norm(accHint) ? 0.1 : -0.15;
      return { r, s: Math.round(s * 100) / 100 };
    }).filter(Boolean).sort((x, y) => y.s - x.s).slice(0, 4);
  }
  function matchFile(fi) {
    const typed = (SS.hint || '').trim(); let acc = typed || fi.account || '';
    // 第一轮：不带账号提示，找出把握大的，推断这张图是哪个号
    if (!acc) {
      const votes = {};
      fi.notes.forEach(n => { const c = candidates(n, ''); if (c[0] && c[0].s >= 0.95 && (!c[1] || c[1].s < c[0].s - 0.1) && c[0].r.account) votes[c[0].r.account] = (votes[c[0].r.account] || 0) + 1; });
      const best = Object.entries(votes).sort((x, y) => y[1] - x[1])[0]; if (best && (best[1] >= 2 || fi.notes.length === 1)) acc = best[0];
    }
    fi.acc = acc;
    fi.notes.forEach(n => {
      n.cands = candidates(n, acc); const c = n.cands;
      n.pick = c[0] ? c[0].r.id : '';
      n.state = !c[0] ? 'none' : c[0].s >= 0.95 && (!c[1] || c[1].s < c[0].s - 0.1) ? 'ok' : c[0].s >= 0.6 ? 'check' : 'none';
      if (n.state === 'none') { n.pick = ''; const near = SS.rows.map(r => ({ r, s: sim(norm(n.title), r.n) })).sort((x, y) => y.s - x.s)[0]; n.near = near && near.s > 0.3 ? `${near.r.account} · ${near.r.title.slice(0, 16)}（${Math.round(near.s * 100)}%）` : ''; }
      n.on = n.state === 'ok';
    });
    // 同一张图两条对到同一行 → 都要人看
    const cnt = {}; fi.notes.forEach(n => { if (n.pick) cnt[n.pick] = (cnt[n.pick] || 0) + 1; });
    fi.notes.forEach(n => { if (n.pick && cnt[n.pick] > 1) { n.state = 'check'; n.on = false; } });
  }

  async function run() {
    const api = F(); const cfg = api.ST.cfg;
    if (!api.ST.appToken) return toast('先在上面连接飞书');
    if (!cfg.qwenKey) return toast('先填通义千问（阿里云百炼）的 API Key');
    if (!SS.files.length) return toast('先选几张数据中心截图');
    SS.running = true; SS.log = []; SS.done = null; forceRender();
    try {
      if (!SS.rows) await loadRows();
      const vcfg = { key: cfg.qwenKey, model: cfg.qwenModel || 'qwen-vl-max' };
      const todo = SS.files.filter(f => f.status !== 'done');
      let i = 0;
      const worker = async () => { while (i < todo.length) { const fi = todo[i++]; SS.phase = `识别截图 ${SS.files.indexOf(fi) + 1}/${SS.files.length}`; forceRender(); try { await recognize(fi, vcfg); matchFile(fi); } catch (e) { fi.status = 'err'; fi.err = e.message; log(`${fi.name}：${e.message}`); } forceRender(); } };
      await Promise.all([worker(), worker()]);
      SS.files.filter(f => f.status === 'done').forEach(matchFile); // 全部识别完再统一匹配一次（账号提示可能变了）
      const all = SS.files.flatMap(f => f.notes || []);
      log(`识别 ${all.length} 条：自动对上 ${all.filter(n => n.state === 'ok').length}，待确认 ${all.filter(n => n.state === 'check').length}，没对上 ${all.filter(n => n.state === 'none').length}`);
    } catch (e) { log('失败：' + e.message); toast(e.message); }
    SS.running = false; SS.phase = ''; forceRender();
  }

  async function write() {
    const api = F(); const items = SS.files.flatMap(f => (f.notes || []).filter(n => n.on && n.pick));
    if (!items.length) return toast('没有勾选要写入的笔记');
    SS.running = true; forceRender();
    try {
      const t = SS.table; const have = new Set((await api.listFields(t.id)).map(f => f.name));
      for (const [name, type] of FIELDS) if (!have.has(name)) { log(`在「${t.name}」新增列「${name}」`); await api.call('POST', `/bitable/v1/apps/${api.ST.appToken}/tables/${t.id}/fields`, Object.assign({ field_name: name, type }, type === 5 ? { property: { date_formatter: 'yyyy/MM/dd HH:mm' } } : {})); }
      const byRow = new Map(); const now = Date.now();
      items.forEach(n => { const o = byRow.get(n.pick); if (!o || (n.views || 0) > (o.views || 0)) byRow.set(n.pick, n); }); // 同一条多张图：取数大的（更新的）
      const recs = [...byRow.entries()].map(([id, n]) => { const f = { '数据更新于': now }; if (n.views !== null) f['小眼睛(自动)'] = n.views; if (n.likes !== null) f['点赞(自动)'] = n.likes; if (n.comments !== null) f['评论(自动)'] = n.comments; if (n.collects !== null) f['收藏(自动)'] = n.collects; if (n.shares !== null) f['分享(自动)'] = n.shares; return { record_id: id, fields: f }; });
      for (let i = 0; i < recs.length; i += 400) await api.call('POST', `/bitable/v1/apps/${api.ST.appToken}/tables/${t.id}/records/batch_update`, { records: recs.slice(i, i + 400) });
      recs.forEach(r => { const row = SS.rows.find(x => x.id === r.record_id); if (row) row.auto = r.fields['小眼睛(自动)']; });
      SS.done = recs.length; log(`已写入飞书 ${recs.length} 条（「${t.name}」的 (自动) 列）`); toast(`已写入 ${recs.length} 条`);
      SS.files = SS.files.filter(f => !(f.notes || []).every(n => !n.state || (n.on && n.pick) || n.state === 'none'));
    } catch (e) { log('写入失败：' + e.message); toast(e.message); }
    SS.running = false; forceRender();
  }
  function log(t) { SS.log.unshift(new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '  ' + t); }

  // ---------- 视图 ----------
  function view() {
    const api = F(); const c = api.ST.cfg; const ok = !!api.ST.appToken;
    const d = t => (t ? new Date(t).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '');
    const fmt = n => (n === null || n === undefined ? '–' : window.Core.fmtCount(n));
    const all = SS.files.flatMap((f, fi) => (f.notes || []).map((n, ni) => ({ f, fi, n, ni })));
    const nOn = all.filter(x => x.n.on && x.n.pick).length;
    const rowOf = id => SS.rows && SS.rows.find(r => r.id === id);
    const stateChip = s => !s ? '<span class="chip sm">等待匹配</span>' : s === 'ok' ? '<span class="chip sm g">已对上</span>' : s === 'check' ? '<span class="chip sm">待确认</span>' : '<span class="chip sm r">没对上</span>';
    return `<div class="section-h"><h2>小红书截图同步</h2><span class="hint">群里的「数据中心」截图 → 小眼睛 / 赞 / 评论自动填进飞书（写在新增的「(自动)」列，不动手填的数）</span></div>
    <div class="panel stack" id="fs-shot">
      ${!ok ? '<p class="hint">先在上面连接飞书。</p>' : ''}
      ${!c.qwenKey || SS.showCfg ? `<div class="grid3">
        <label class="f"><span>通义千问 API Key（阿里云百炼，只存本机）</span><input type="password" data-fs="qwenKey" value="${h(c.qwenKey || '')}" placeholder="sk-…"></label>
        <label class="f"><span>看图模型</span><input type="text" data-fs="qwenModel" value="${h(c.qwenModel || '')}" placeholder="qwen-vl-max"></label>
        <label class="f"><span>目标表</span><input type="text" data-fs="xhsTable" value="${h(c.xhsTable || '')}" placeholder="小红书矩阵号-数据"></label></div>
        <p class="hint">Key 在 <a href="https://bailian.console.aliyun.com/" target="_blank" rel="noopener">阿里云百炼控制台</a> →「API-KEY」里创建；识别一张截图约几分钱。</p>` : ''}
      <div class="row">
        <label class="btn sm" for="fs-shot-file">选择截图（可多选）</label><input type="file" id="fs-shot-file" accept="image/*" multiple hidden>
        <span class="hint">也可以直接 Ctrl+V 粘贴</span>
        <input type="text" data-shot="hint" value="${h(SS.hint)}" placeholder="账号名（可不填，填了更准）" style="max-width:190px">
        <span class="grow"></span>
        ${c.qwenKey ? `<button class="btn ghost sm" data-action="fs-shot-cfg">${SS.showCfg ? '收起' : '识别设置'}</button>` : ''}
        ${SS.files.length ? '<button class="btn ghost sm" data-action="fs-shot-clear">清空</button>' : ''}
        <button class="btn primary sm" data-action="fs-shot-run" ${SS.running || !SS.files.length ? 'disabled' : ''}>识别并匹配</button>
      </div>
      ${SS.files.length ? `<div class="row" style="flex-wrap:wrap;gap:6px">${SS.files.map((f, i) => `<span class="chip sm ${f.status === 'err' ? 'r' : f.status === 'done' ? 'g' : ''}" title="${h(f.err || '')}">#${i + 1} ${h(f.name.slice(0, 18))} · ${{ wait: '待识别', reading: '识别中…', done: `${f.notes.length} 条${f.acc ? ' · ' + h(f.acc) : ''}`, err: '失败' }[f.status]}</span>`).join('')}</div>` : ''}
      ${SS.running && SS.phase ? `<div class="hint"><b>${h(SS.phase)}</b></div>` : ''}
      ${all.length ? `<div class="tbl-wrap"><table><thead><tr><th></th><th>截图里的笔记</th><th>小眼睛/赞/评</th><th>对到飞书哪一条</th><th>状态</th></tr></thead><tbody>
        ${all.map(({ f, fi, n, ni }) => { const r = rowOf(n.pick); return `<tr>
          <td><input type="checkbox" data-shot="on" data-f="${fi}" data-n="${ni}" ${n.on ? 'checked' : ''} ${n.pick ? '' : 'disabled'}></td>
          <td style="white-space:normal;min-width:150px">${h(n.title)}<div class="hint">#${fi + 1} · ${h(n.date || '无日期')}${n.state === 'none' ? (n.near ? ` · 最接近：${h(n.near)}` : ' · 飞书里可能还没登记') : ''}</div></td>
          <td class="num">${fmt(n.views)}${n.rough ? '<span class="hint">≈</span>' : ''} / ${fmt(n.likes)} / ${fmt(n.comments)}${r && (r.auto || r.views) ? `<div class="hint">表里 ${fmt(r.auto || r.views)}</div>` : ''}</td>
          <td style="min-width:200px"><select data-shot="pick" data-f="${fi}" data-n="${ni}"><option value="">— 不写入 —</option>${(n.cands || []).map(c => `<option value="${h(c.r.id)}" ${c.r.id === n.pick ? 'selected' : ''}>${h(c.r.account || '?')} · ${d(c.r.date)} · ${h(c.r.title.slice(0, 22))}（${Math.round(Math.min(1, c.s) * 100)}%）</option>`).join('')}</select>
            ${r && r.link ? `<a class="hint" href="${h(r.link)}" target="_blank" rel="noopener">打开</a>` : ''}</td>
          <td>${stateChip(n.state)}</td></tr>`; }).join('')}
      </tbody></table></div>
      <div class="row"><span class="hint grow">勾选的 ${nOn} 条会写进飞书；「待确认」请先在下拉里核对是哪一条再勾选。≈ 表示截图里是"万"，只精确到千位。</span>
        <button class="btn primary" data-action="fs-shot-write" ${SS.running || !nOn ? 'disabled' : ''}>写入飞书（${nOn} 条）</button></div>` : ''}
      ${SS.log.length ? `<pre class="small-pre">${h(SS.log.slice(0, 12).join('\n'))}</pre>` : ''}
    </div>`;
  }

  async function act(action) {
    switch (action) {
      case 'fs-shot-run': run(); break;
      case 'fs-shot-write': write(); break;
      case 'fs-shot-clear': SS.files = []; SS.done = null; forceRender(); break;
      case 'fs-shot-cfg': SS.showCfg = !SS.showCfg; forceRender(); break;
    }
  }
  function attach(root) {
    root.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'fs-shot-file') { addFiles([...t.files]); t.value = ''; return; }
      const k = t.dataset && t.dataset.shot; if (!k) return;
      if (k === 'hint') { SS.hint = t.value; SS.files.filter(f => f.status === 'done').forEach(matchFile); forceRender(); return; }
      const n = ((SS.files[+t.dataset.f] || {}).notes || [])[+t.dataset.n]; if (!n) return;
      if (k === 'on') n.on = t.checked;
      if (k === 'pick') { n.pick = t.value; n.on = !!t.value; if (t.value && n.state === 'none') n.state = 'check'; }
      forceRender();
    });
    document.addEventListener('paste', e => {
      if (!document.getElementById('fs-shot')) return;
      const imgs = [...(e.clipboardData && e.clipboardData.items || [])].filter(i => i.kind === 'file' && /^image\//.test(i.type)).map(i => i.getAsFile()).filter(Boolean);
      if (imgs.length) { e.preventDefault(); addFiles(imgs); toast(`已加入 ${imgs.length} 张截图`); }
    });
  }
  window.XhsShot = { view, act, attach, _sim: sim, _norm: norm, _dateHit: dateHit, _match: matchFile, _ss: SS };
})();
