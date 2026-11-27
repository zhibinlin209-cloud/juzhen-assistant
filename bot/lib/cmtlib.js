/* 评论采集：插件里贴小红书 / 抖音链接，把帖子下面的全部评论（含楼中楼回复）拉出来，
 * 写进营销部多维表格的「评论采集」表，一条评论一行；同一条评论再拉一次只更新点赞数，不重复加。
 */
'use strict';
const COLS = [['评论内容', 1], ['平台', 3, ['小红书', '抖音']], ['帖子标题', 1], ['帖子链接', 15], ['帖子作者', 1], ['评论人', 1], ['类型', 3, ['评论', '回复']], ['回复给', 1], ['作者回复', 3, ['是', '否']],
  ['点赞', 2], ['评论时间', 5], ['IP属地', 1], ['评论ID', 1], ['帖子ID', 1], ['采集时间', 5], ['采集批次', 1]];
const TABLE = '评论采集', STABLE = '评论总结';
const SCOLS = [['帖子标题', 1], ['平台', 3, ['小红书', '抖音']], ['帖子链接', 15], ['帖子作者', 1], ['评论数', 2], ['AI 总结', 1], ['模型', 1], ['总结时间', 5], ['帖子ID', 1]];

const { writeDocx } = require('./docxwrite');
function createCmtLib({ cfg, api, core, log, notify, sendFile }) {
  // DeepSeek：有 DeepSeek 官方 key 先用官方接口，否则用阿里百炼上的 DeepSeek 模型（和投放周报同一套）
  async function deepseek(prompt) {
    const tries = [];
    if (cfg.deepseekKey) for (const m of ['deepseek-chat']) tries.push(['https://api.deepseek.com/chat/completions', cfg.deepseekKey, m]);
    if (cfg.qwenKey) for (const m of cfg.analystModels || ['deepseek-v4-pro', 'deepseek-v4.1-flash']) if (/deepseek/i.test(m)) tries.push(['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', cfg.qwenKey, m]);
    let last = '没有配置 DeepSeek';
    for (const [u, k, model] of tries) {
      try { const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + k }, signal: AbortSignal.timeout(240000), body: JSON.stringify({ model, temperature: 0.3, max_tokens: 3000, messages: [{ role: 'user', content: prompt }] }) });
        const j = await r.json().catch(() => ({})); if (r.ok) { const t = (((j.choices || [])[0] || {}).message || {}).content || ''; if (t) return { text: t.trim(), model }; }
        last = (j.error && (j.error.message || j.error.code)) || ('HTTP ' + r.status); log(`[评论采集] 模型 ${model} 不可用：${last}`);
      } catch (e) { last = e.message; log(`[评论采集] 模型 ${model} 出错：${e.message}`); }
    }
    throw new Error(last);
  }
  async function summarize(platform, post, list) {
    const top = list.slice().sort((a, b) => (+b.likes || 0) - (+a.likes || 0));
    const lines = []; let len = 0;
    for (const c of top) { const l = `${c.reply || c.parent ? '↳' : '·'}${c.author ? '[作者]' : ''}${String(c.name || '').slice(0, 12)}${c.ip ? '(' + c.ip + ')' : ''}${+c.likes ? ' 赞' + c.likes : ''}：${String(c.text || '').replace(/\s+/g, ' ').slice(0, 160)}`; if (len + l.length > 36000) break; lines.push(l); len += l.length; }
    const prompt = `你是连锁餐饮（海鲜大排档「YES也是大排档」、粤菜「粤迹」）的内容运营助手。下面是${platform}一条帖子下面的评论（共 ${list.length} 条，按点赞从高到低给你 ${lines.length} 条；↳ 是楼中楼回复，[作者] 是发帖人自己回的）。
帖子：${String(post.title || '').slice(0, 80)}${post.author ? '（作者：' + post.author + '）' : ''}${post.desc ? '\n正文开头：' + String(post.desc).slice(0, 150) : ''}

请用中文、口语化地总结，只根据评论说话，不要编；引用原话时加引号、尽量短。按下面几块写，每块 2–5 条，没有就写「没有」：
1. 一句话结论：大家整体是什么态度（正面/负面/中性大概各占几成）。
2. 夸的点：夸哪些菜、哪方面（味道/分量/环境/服务/价格），附 1 句原话。
3. 吐槽和差评：具体问题是什么，附原话；哪些是需要门店马上处理的。
4. 大家在问什么：高频问题（价格、地址、排队、怎么点、营业时间等），建议怎么统一回复或置顶。
5. 提到的店名、竞品或对比。
6. 可以拿来做下一条内容的选题或卖点（2–3 个）。
7. 建议优先回复的评论（2–5 条，写评论人和原话前几个字，说明为什么）。

评论：
${lines.join('\n')}`;
    return deepseek(prompt);
  }
  let T = null; // { app, id, keys: Map(评论ID -> record_id), at }
  async function table() {
    const app = await core.appToken();
    if (T && T.app === app && Date.now() - T.at < 30 * 60e3) return T;
    const fieldOf = ([field_name, type, opts]) => Object.assign({ field_name, type }, opts ? { property: { options: opts.map((name, color) => ({ name, color })) } } : {});
    const list = []; let pt = ''; do { const d = await api.call('GET', `/bitable/v1/apps/${app}/tables`, null, Object.assign({ page_size: 100 }, pt ? { page_token: pt } : {})); list.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    let id = (list.find(x => x.name === TABLE) || {}).table_id;
    if (!id) { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables`, { table: { name: TABLE, default_view_name: '全部评论', fields: COLS.map(fieldOf) } }); id = d.table_id; log('[评论采集] 新建表「评论采集」'); }
    else { const fd = await api.call('GET', `/bitable/v1/apps/${app}/tables/${id}/fields`, null, { page_size: 200 }); const hv = new Set((fd.items || []).map(f => f.field_name)); for (const c of COLS) if (!hv.has(c[0])) await api.call('POST', `/bitable/v1/apps/${app}/tables/${id}/fields`, fieldOf(c)); }
    T = { app, id, keys: null, at: Date.now() }; return T;
  }
  let ST = null;
  async function stable(app) {
    if (ST && ST.app === app) return ST.id;
    const fieldOf = ([field_name, type, opts]) => Object.assign({ field_name, type }, opts ? { property: { options: opts.map((name, color) => ({ name, color })) } } : {});
    const list = []; let pt = ''; do { const d = await api.call('GET', `/bitable/v1/apps/${app}/tables`, null, Object.assign({ page_size: 100 }, pt ? { page_token: pt } : {})); list.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    let id = (list.find(x => x.name === STABLE) || {}).table_id;
    if (!id) { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables`, { table: { name: STABLE, default_view_name: '全部', fields: SCOLS.map(fieldOf) } }); id = d.table_id; log('[评论采集] 新建表「评论总结」'); }
    ST = { app, id }; return id;
  }
  async function keysOf(t, postId) { // 这个帖子已经存过的评论 ID
    const m = new Map(); let pt = '';
    do { const d = await api.call('POST', `/bitable/v1/apps/${t.app}/tables/${t.id}/records/search`, { field_names: ['评论ID', '点赞'], filter: { conjunction: 'and', conditions: [{ field_name: '帖子ID', operator: 'is', value: [postId] }] } }, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {}));
      for (const r of d.items || []) { const v = r.fields['评论ID']; const k = Array.isArray(v) ? v.map(x => x.text || '').join('') : String(v || ''); if (k) m.set(k, r.record_id); } pt = d.has_more ? d.page_token : ''; } while (pt);
    return m;
  }
  const clean = s => String(s || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 2000);
  async function ingest(j) {
    const url = String(j.url || ''); const platform = /douyin/.test(url) ? '抖音' : '小红书';
    const post = j.post || {}; const postId = String(j.postId || post.id || '').slice(0, 64) || url.slice(-40);
    const list = Array.isArray(j.comments) ? j.comments.slice(0, 30000) : [];
    if (!list.length) return { ok: true, added: 0, updated: 0, total: 0, table: TABLE };
    const t = await table(); const have = await keysOf(t, postId);
    const batch = j.batch || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
    const byCid = new Map(list.map(c => [c.cid, c]));
    const add = [], upd = []; const now = Date.now();
    for (const c of list) {
      const cid = String(c.cid || '') || (c.name + '|' + String(c.text || '').slice(0, 30));
      if (have.has(cid)) { upd.push({ record_id: have.get(cid), fields: { '点赞': +c.likes || 0, '采集时间': now } }); continue; }
      const to = c.to || (c.parent && byCid.get(c.parent) ? byCid.get(c.parent).name : '');
      const f = { '评论内容': clean(c.text), '平台': platform, '帖子标题': clean(post.title || post.desc || '').slice(0, 200), '帖子链接': { link: url, text: clean(post.title || url).slice(0, 80) || url }, '帖子作者': clean(post.author || post.nickname || ''), '评论人': clean(c.name),
        '类型': c.reply || c.parent ? '回复' : '评论', '回复给': clean(to), '作者回复': c.author ? '是' : '否', '点赞': +c.likes || 0, 'IP属地': clean(c.ip || ''), '评论ID': cid, '帖子ID': postId, '采集时间': now, '采集批次': batch };
      if (c.ts && c.ts > 1e12) f['评论时间'] = c.ts;
      add.push({ fields: f }); have.set(cid, '');
    }
    for (let i = 0; i < add.length; i += 400) await api.call('POST', `/bitable/v1/apps/${t.app}/tables/${t.id}/records/batch_create`, { records: add.slice(i, i + 400) });
    for (let i = 0; i < upd.length; i += 400) await api.call('POST', `/bitable/v1/apps/${t.app}/tables/${t.id}/records/batch_update`, { records: upd.slice(i, i + 400) });
    const link = (cfg.baseUrl || '').replace(/\?.*$/, '') + (cfg.baseUrl ? `?table=${t.id}` : '');
    let summary = '', model = '', sumErr = '', sumLink = '';
    if (j.summarize !== false && list.length >= 3) {
      try { const r = await summarize(platform, post, list); summary = r.text; model = r.model;
        const st = await stable(t.app); const f = { '帖子标题': clean(post.title || postId).slice(0, 200), '平台': platform, '帖子链接': { link: url, text: clean(post.title || url).slice(0, 80) || url }, '帖子作者': clean(post.author || ''), '评论数': list.length, 'AI 总结': clean(summary).slice(0, 20000) || summary.slice(0, 20000), '模型': model, '总结时间': Date.now(), '帖子ID': postId };
        await api.call('POST', `/bitable/v1/apps/${t.app}/tables/${st}/records/batch_create`, { records: [{ fields: f }] });
        sumLink = (cfg.baseUrl || '').replace(/\?.*$/, '') + (cfg.baseUrl ? `?table=${st}` : '');
        await tell(platform, post.title || postId, list.length, summary, sumLink, url);
      } catch (e) { sumErr = e.message.slice(0, 120); log('[评论采集] 总结失败：' + e.message); }
    }
    log(`[评论采集] ${platform}「${String(post.title || postId).slice(0, 20)}」${list.length} 条，新增 ${add.length}、更新 ${upd.length}`);
    return { ok: true, added: add.length, updated: upd.length, total: list.length, table: TABLE, link, summary, model, sumErr, sumLink };
  }
  // 总结做完私聊老板一份（飞书表格单元格里长文字不好读）
  async function tell(platform, title, n, text, link, url) {
    if (!notify) return; try { await notify(`📝 评论总结 · ${platform}「${String(title).slice(0, 40)}」（${n} 条评论）\n${url}\n\n${String(text).slice(0, 12000)}${link ? '\n\n全部总结在营销部表格「评论总结」表：' + link : ''}`); } catch (e) { log('[评论采集] 私聊总结失败：' + e.message); }
  }
  async function sendLatest() { // 把「评论总结」表最新一条私聊老板
    const app = await core.appToken(); const st = await stable(app);
    const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${st}/records/search`, { sort: [{ field_name: '总结时间', desc: true }] }, { page_size: 1 });
    const r = (d.items || [])[0]; if (!r) return { ok: false, error: '还没有总结' }; const f = r.fields; const t = v => Array.isArray(v) ? v.map(x => x.text || '').join('') : (v && typeof v === 'object') ? (v.link || v.text || '') : String(v || '');
    const link = (cfg.baseUrl || '').replace(/\?.*$/, '') + `?table=${st}`;
    await tell(t(f['平台']), t(f['帖子标题']), f['评论数'] || 0, t(f['AI 总结']), link, t(f['帖子链接'])); return { ok: true, link };
  }
  // 导出 Word：某个帖子（默认最近总结的那条）的总结 + 全部评论原文（楼中楼缩进在主评论下面，主评论按点赞从高到低）
  async function exportWord(postId) {
    const app = await core.appToken(); const t = await table(); const st = await stable(app);
    const tx = v => Array.isArray(v) ? v.map(x => x.text || '').join('') : (v && typeof v === 'object') ? (v.text || v.link || '') : String(v ?? '');
    let sumRow = null;
    { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${st}/records/search`, Object.assign({ sort: [{ field_name: '总结时间', desc: true }] }, postId ? { filter: { conjunction: 'and', conditions: [{ field_name: '帖子ID', operator: 'is', value: [postId] }] } } : {}), { page_size: 1 }); sumRow = ((d.items || [])[0] || {}).fields || null; }
    if (!postId) postId = sumRow ? tx(sumRow['帖子ID']) : ''; if (!postId) throw new Error('还没有拉过评论');
    const rows = []; let pt = '';
    do { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.id}/records/search`, { filter: { conjunction: 'and', conditions: [{ field_name: '帖子ID', operator: 'is', value: [postId] }] } }, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); rows.push(...(d.items || []).map(r => r.fields)); pt = d.has_more ? d.page_token : ''; } while (pt);
    if (!rows.length) throw new Error('这个帖子在「评论采集」表里没有评论');
    const C = rows.map(f => ({ id: tx(f['评论ID']), name: tx(f['评论人']), text: tx(f['评论内容']), likes: +f['点赞'] || 0, ts: +f['评论时间'] || 0, ip: tx(f['IP属地']), reply: tx(f['类型']) === '回复', to: tx(f['回复给']), author: tx(f['作者回复']) === '是' }));
    const f0 = rows[0]; const title = tx(f0['帖子标题']) || postId, platform = tx(f0['平台']), link = (f0['帖子链接'] || {}).link || tx(f0['帖子链接']), author = tx(f0['帖子作者']);
    const day = ms => { if (!ms) return ''; const d = new Date(ms + 8 * 3600e3); return d.toISOString().slice(0, 16).replace('T', ' '); };
    // 楼中楼：按「回复给」挂到同名主评论下面（接口没给父评论 ID 时的近似做法：挂到这个人最近的一条主评论）；挂不上的单独列在最后
    const top = C.filter(c => !c.reply).sort((a, b) => b.likes - a.likes || a.ts - b.ts); const kids = new Map(top.map(c => [c, []]));
    const byName = new Map(); for (const c of top) { if (!byName.has(c.name)) byName.set(c.name, []); byName.get(c.name).push(c); }
    const orphan = []; for (const r of C.filter(c => c.reply)) { const L = byName.get(r.to); if (L && L.length) { const p = L.filter(x => x.ts <= (r.ts || Infinity)).sort((a, b) => b.ts - a.ts)[0] || L[0]; kids.get(p).push(r); } else orphan.push(r); }
    const B = [{ h: 1, text: `${platform}评论原文 · ${title}` }, { p: `帖子：${link}`, small: true, color: '666666' }, { p: `作者：${author || '—'}　评论共 ${C.length} 条（主评论 ${top.length}、回复 ${C.length - top.length}）　导出时间：${day(Date.now())}`, small: true, color: '666666' }];
    if (sumRow) { B.push({ h: 2, text: 'AI 总结（DeepSeek）' }); for (const line of tx(sumRow['AI 总结']).split('\n')) if (line.trim()) B.push({ p: line.replace(/\*\*/g, '') }); }
    B.push({ h: 2, text: '全部评论（主评论按点赞从高到低，回复缩进在下面）' });
    let i = 0; for (const c of top) { i++;
      B.push({ runs: [{ text: `${i}. `, color: '999999' }, { text: c.name || '（无名）', bold: true }, { text: c.author ? '【作者】' : '', color: 'C0392B' }, { text: '：' + c.text }] });
      B.push({ p: [c.likes ? `赞 ${c.likes}` : '', day(c.ts), c.ip].filter(Boolean).join(' · '), small: true, color: '999999' });
      for (const r of kids.get(c).sort((a, b) => a.ts - b.ts)) B.push({ indent: 1, runs: [{ text: '↳ ' + (r.name || ''), bold: true }, { text: r.author ? '【作者】' : '', color: 'C0392B' }, { text: (r.to && r.to !== c.name ? ` 回复 ${r.to}` : '') + '：' + r.text }, { text: `　${[r.likes ? '赞 ' + r.likes : '', day(r.ts), r.ip].filter(Boolean).join(' · ')}`, small: true, color: '999999' }] }); }
    if (orphan.length) { B.push({ h: 2, text: '其他回复（没对上主评论）' }); for (const r of orphan) B.push({ runs: [{ text: r.name, bold: true }, { text: (r.to ? ` 回复 ${r.to}` : '') + '：' + r.text }, { text: `　${[r.likes ? '赞 ' + r.likes : '', day(r.ts), r.ip].filter(Boolean).join(' · ')}`, small: true, color: '999999' }] }); }
    const buf = writeDocx(B); const name = `评论原文-${platform}-${title.replace(/[\\/:*?"<>|#\s]+/g, '').slice(0, 24)}.docx`;
    if (sendFile) await sendFile(buf, name);
    log(`[评论采集] 导出 Word「${title.slice(0, 20)}」${C.length} 条，${Math.round(buf.length / 1024)} KB`);
    return { ok: true, name, comments: C.length, kb: Math.round(buf.length / 1024) };
  }
  return { ingest, sendLatest, exportWord };
}
module.exports = { createCmtLib };
