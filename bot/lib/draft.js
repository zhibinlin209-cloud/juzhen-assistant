/* 收稿：编辑把稿件（编号 + 标题 + 正文 + 话题）发到飞书群，后面跟着发图片/视频
 * → 机器人整篇存进营销部多维表格「派稿记录」的一行，图片视频放进「素材」列
 */
'use strict';

// 门店关键词 → 门店、小红书/携程定位（区）、点评定位
const STORES = [
  [/粤迹/, '粤迹·岭南家宴', '深圳市南山区', '粤迹·岭南家宴'],
  [/水东街|惠州/, '惠州水东街店', '惠州市惠城区', '也是大排档（水东街店）'],
  [/江南西|海珠/, '广州江南西店', '广州市海珠区', '也是大排档（江南西店）'],
  [/华强北|福田/, '深圳华强北燕南店', '深圳市福田区', '也是大排档（华强北店）'],
  [/白石洲/, '深圳白石洲店', '深圳市南山区', '也是大排档（白石洲店）'],
  [/前海|HOP/i, '深圳前海HOP店', '深圳市宝安区', '也是大排档（前海店）'],
  [/花园城|蛇口/, '深圳蛇口招商花园城店', '深圳市南山区', '也是大排档（花园城店）'],
  [/玖洲道|珠海/, '珠海玖洲道店', '珠海市香洲区', '也是大排档（玖洲道店）'],
  [/33小镇|东莞/, '东莞东城33小镇店', '东莞市东城区', '也是大排档（33小镇店）'],
  [/创意产业园/, '佛山创意产业园店', '佛山市禅城区', '也是大排档（创意产业园店）'],
  [/千灯湖|保利西街|灯湖西街/, '佛山保利西街店', '佛山市南海区', '也是大排档（千灯湖店）']
];
// 分发类别 → 内容类型 → 发布平台（老板定的规则）
const PLATFORMS = {
  '小红书矩阵号|图文': ['小红书', '大众点评', '携程', '微信贴图'],
  '抖音素人号|图文': ['抖音', '微信贴图', '小红书', '大众点评'],
  '抖音素人号|视频': ['抖音', '视频号', '小红书'],
  '抖音矩阵号|视频': ['抖音', '视频号']
};

const isDraft = (t, hasVideo) => { t = String(t || ''); if (t.length > 30 && /(^|\n)\s*标题\s*[:：]/.test(t)) return true; return /(^|\n)\s*定位\s*[:：]/.test(t) && /#\S+/.test(t) && (/^\s*@/.test(t) || !!hasVideo); };

function parseDraft(text, videoName) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  if (!lines.some(l => /^\s*标题\s*[:：]/.test(l))) { // 视频派稿：@账号 / 文案 / #话题 / 定位：xxx，视频文件名当编号
    const L = lines.map(l => l.trim()).filter(Boolean);
    const acc = ((L.find(l => /^@/.test(l)) || '').match(/^@\s*(.+)$/) || [])[1] || '';
    const loc = ((L.find(l => /^定位\s*[:：]/.test(l)) || '').replace(/^定位\s*[:：]\s*/, ''));
    const tagLines = L.filter(l => /^#/.test(l)); const cap = L.filter(l => !/^@|^#|^定位\s*[:：]/.test(l));
    const code = String(videoName || '').replace(/\.[a-z0-9]+$/i, '') || (cap[0] || '').slice(0, 16);
    const st = STORES.find(([re]) => re.test(loc)) || STORES.find(([re]) => re.test(text));
    return { video: true, code, account: acc.trim(), writer: '', title: (cap[0] || '').trim(), body: cap.join('\n'), tags: tagLines.join(' '), kind: '', loc, store: st ? st[1] : '', area: '', dp: '' };
  }
  const first = (lines.find(l => l.trim()) || '').trim();
  const head = first.replace(/^[✅☑️✔️\s]+/u, '').trim();
  // 「yes-水东街逛吃攻略-6篇-芝士很困」：最后一段不是数字/篇号时当作写手
  const segs = head.split('-'); let code = head, writer = '';
  if (/^标题\s*[:：]/.test(head)) { code = head.replace(/^标题\s*[:：]\s*/, '').slice(0, 24); segs.length = 0; }
  if (segs.length >= 3 && !/^\d+$|篇$/.test(segs[segs.length - 1])) { writer = segs.pop().trim(); code = segs.join('-').trim(); }
  const ti = lines.findIndex(l => /^\s*标题\s*[:：]/.test(l));
  const title = ti >= 0 ? lines[ti].replace(/^\s*标题\s*[:：]\s*/, '').trim() : '';
  const rest = lines.slice(ti + 1);
  const pick = re => { const i = rest.findIndex(l => re.test(l)); if (i < 0) return ''; const v = rest[i].replace(re, '').trim(); rest.splice(i, 1); return v; };
  const kind = pick(/^\s*(?:类别|分发类别)\s*[:：]\s*/);
  const loc = pick(/^\s*定位\s*[:：]\s*/);
  const tagLines = rest.filter(l => /^\s*#/.test(l.trim()) && (l.match(/#/g) || []).length >= 2);
  const tags = tagLines.join(' ').trim();
  const body = rest.filter(l => !tagLines.includes(l)).join('\n').replace(/^\s*(?:正文|文案)\s*[:：]\s*/m, '').replace(/^\n+|\n+$/g, '').replace(/\n{3,}/g, '\n\n');
  const all = head + '\n' + title + '\n' + body + '\n' + tags;
  const st = STORES.find(([re]) => re.test(head)) || STORES.find(([re]) => re.test(all));
  return { code, writer, title, body, tags, kind, loc, store: st ? st[1] : '', area: st ? st[2] : '', dp: st ? st[3] : '' };
}

// PR 的派发说明：「@某某 今天发这条，发布到小红书+点评+携程+微信贴图4个平台，小红书+携程定位广州市海珠区，点评定位也是大排档（江南西店）…」
const isInstr = t => /发布到|今天发这条|今日发/.test(String(t || '')) && /定位|平台/.test(String(t || '')) && !/(^|\n)\s*标题\s*[:：]/.test(String(t || ''));
function parseInstr(text, names) {
  const t = String(text || ''); const P = [];
  const seg = (t.match(/发布到([^，,。；;]+)/) || [])[1] || t;
  [['小红书', /小红书/], ['大众点评', /点评/], ['携程', /携程/], ['微信贴图', /贴图/], ['抖音', /抖音/], ['视频号', /视频号/]].forEach(([n, re]) => { if (re.test(seg)) P.push(n); });
  const loc = ((t.match(/(?:小红书|携程|抖音|视频号)[^，,。；;]*?定位(?:在|是|为)?\s*([^，,。；;（(]+)/) || [])[1] || '').trim();
  const dp = ((t.match(/点评定位(?:在|是|为)?\s*(也是大排档[（(][^）)]+[）)]|[^，,。；;]+)/) || [])[1] || '').trim();
  const st = STORES.find(([re]) => re.test(dp)) || STORES.find(([re]) => re.test(loc));
  return { people: (names || []).filter(Boolean), platforms: P, loc, dp, store: st ? st[1] : '' };
}

function createDraft({ api, core, upload, log, resolver }) {
  let tid = null; const pending = new Map(); // 发稿人 → { id, code, at, n }
  async function tbl() { if (!tid) tid = await core.ensurePaigao(); return { app: await core.appToken(), tid }; }
  function begin(senderId) { // 一认出稿件就先占位：紧跟着到的图片排在它后面，等稿件建好再存
    let ok; const ready = new Promise(r => { ok = r; }); const p = { id: null, code: '', at: Date.now(), n: 0, type: '图文', kind: '', q: ready, ok };
    pending.set(senderId, p); return p;
  }
  async function save(text, sender, senderId, imgs, video, instr) {
    const d = parseDraft(text, video && video.named !== false ? video.name : ''); const T = await tbl();
    const kind = /抖音素人/.test(d.kind) ? '抖音素人号' : (/抖音矩阵/.test(d.kind) || d.video) ? '抖音矩阵号' : '小红书矩阵号';
    const type = kind === '抖音矩阵号' || d.video ? '视频' : '图文';
    const fields = { 文本: d.code, 稿件编号: d.code, 写手: d.writer, 账号名称: d.account, 分发类别: kind, 内容类型: type, 发布平台: PLATFORMS[`${kind}|${type}`] || [], 标题: d.title, 文案正文: d.body, 话题标签: d.tags, 门店: d.store, 定位: d.loc || d.area, 点评定位: d.dp, 状态: '待发布', 派稿人: sender || '', 备注: '收稿时间 ' + new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ') };
    if (instr) Object.assign(fields, instrFields(instr));
    if (resolver) { // @ 的是微信名 → 换成真人 + 对应平台账号
      const ref = d.account || (instr && instr.people[0]) || '';
      if (ref) { try { const r = await resolver(ref, kind); if (r) { if (r.who) fields['发布人员'] = r.who; fields['账号名称'] = r.acc || (d.account && !r.who ? d.account : ''); } } catch (e) { } }
    }
    Object.keys(fields).forEach(k => { if (fields[k] === '' || (Array.isArray(fields[k]) && !fields[k].length)) delete fields[k]; });
    const r = await api.call('POST', `/bitable/v1/apps/${T.app}/tables/${T.tid}/records`, { fields });
    const id = r.record.record_id; const ph = pending.get(senderId);
    if (ph && !ph.id) { Object.assign(ph, { id, code: d.code, at: Date.now(), type, kind }); ph.ok(); } else pending.set(senderId, { id, code: d.code, at: Date.now(), n: 0, type, kind });
    log(`[收稿] ${d.code}（${d.title.slice(0, 20)}）`);
    if (imgs && imgs.length) await addMedia(senderId, imgs);
    if (video && video.buf) await addMedia(senderId, [{ buf: video.buf, name: video.name, video: true }]);
    return Object.assign(d, { id, kind, type, platforms: fields.发布平台 || [], who: fields.发布人员 || '', store: fields.门店 || d.store, area: fields.定位 || d.area, dp: fields.点评定位 || d.dp });
  }
  function instrFields(i) { const f = {}; if (i.people.length) f['发布人员'] = i.people[0]; if (i.platforms.length) f['发布平台'] = i.platforms; if (i.loc) f['定位'] = i.loc; if (i.dp) f['点评定位'] = i.dp; if (i.store) f['门店'] = i.store; const d = new Date(Date.now() + 8 * 3600e3); f['派稿日期'] = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 8 * 3600e3; return f; }
  async function applyInstr(senderId, instr) { // 说明比稿件晚发：补到刚收的那篇
    const p = active(senderId); if (!p) return null; const T = await tbl();
    await api.call('PUT', `/bitable/v1/apps/${T.app}/tables/${T.tid}/records/${p.id}`, { fields: instrFields(instr) }); return p;
  }
  // 发稿后 15 分钟内，同一个人发的图片/视频都归到这篇
  const active = senderId => { const p = pending.get(senderId); return p && Date.now() - p.at < 15 * 60e3 ? p : null; };
  function addMedia(senderId, files) { // 排队：连发 9 张图时一张张按顺序存，不会互相覆盖
    const p = active(senderId); if (!p) return Promise.resolve(null);
    p.at = Date.now(); p.q = (p.q || Promise.resolve()).then(() => addNow(p, files)).catch(e => { log('[收稿] 素材保存失败：' + e.message); return p; });
    return p.q;
  }
  function attachTo(rec, files) { // 指定稿件补素材（回复稿件消息发图 / 「补图」命令）
    let p = [...pending.values()].find(x => x.id === rec.id); if (!p) { p = { id: rec.id, code: rec.code, at: Date.now(), n: 0, type: rec.type || '图文', kind: rec.kind || '' }; pending.set('rec:' + rec.id, p); }
    p.q = (p.q || Promise.resolve()).then(() => addNow(p, files)).catch(e => { log('[收稿] 素材保存失败：' + e.message); return p; }); return p.q;
  }
  async function addNow(p, files) {
    files = await files; if (!files || !files.length || !p.id) return p;
    const T = await tbl();
    const toks = []; for (const f of files) { try { toks.push({ file_token: await upload(f.buf, f.name, f.video ? 'bitable_file' : 'bitable_image', T.app) }); if (f.video) p.type = '视频'; } catch (e) { log('[收稿] 素材上传失败：' + e.message); } }
    if (!toks.length) return p;
    const cur = await api.call('GET', `/bitable/v1/apps/${T.app}/tables/${T.tid}/records/${p.id}`);
    const old = ((cur.record || {}).fields || {})['素材'] || [];
    const fields = { 素材: old.map(x => ({ file_token: x.file_token })).concat(toks) };
    if (p.type === '视频' && files.some(f => f.video)) { fields['内容类型'] = '视频'; if (p.kind === '小红书矩阵号') { fields['分发类别'] = '抖音矩阵号'; fields['发布平台'] = PLATFORMS['抖音矩阵号|视频']; } }
    await api.call('PUT', `/bitable/v1/apps/${T.app}/tables/${T.tid}/records/${p.id}`, { fields });
    p.n += toks.length; p.at = Date.now(); return p;
  }
  return { isDraft, save, addMedia, active, parseDraft, applyInstr, attachTo, tbl, begin };
}

function replyForDraft(d) {
  return `📥 已收进稿件库：${d.code}${d.writer ? '（写手 ' + d.writer + '）' : ''}${d.account ? '（账号 ' + d.account + '）' : ''}\n标题：${d.title || '⚠️ 没读到标题'}\n类别：${d.kind} · ${d.type} → ${d.platforms.join(' + ')}\n${d.who ? '派给：' + d.who + '（今天）\n' : ''}门店：${d.store || '⚠️ 没认出门店'}${d.area ? ' · 定位 ' + d.area : ''}${d.dp ? ' · 点评定位 ' + d.dp : ''}\n接下来 15 分钟内发的图片/视频会自动归到这篇。`;
}
module.exports = { createDraft, parseDraft, isDraft, replyForDraft, PLATFORMS, isInstr, parseInstr };

// ---------- 发布人员 → 各平台账号（从小红书/抖音数据表里统计，近 90 天谁用哪个号发得最多） ----------
function createAccounts({ api, core, log, people }) {
  const val = v => Array.isArray(v) ? v.map(x => (x && typeof x === 'object') ? (x.text || x.name || '') : String(x)).join('') : (v && typeof v === 'object') ? (v.text || v.name || '') : (v ?? '');
  let cache = null;
  async function map(force) {
    if (cache && !force && Date.now() - cache.at < 30 * 60e3) return cache.m;
    const app = await core.appToken(); const tabs = []; let pt = '';
    do { const d = await api.call('GET', `/bitable/v1/apps/${app}/tables`, null, Object.assign({ page_size: 100 }, pt ? { page_token: pt } : {})); tabs.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    const SRC = [['xhs', '小红书矩阵号-数据', ['人员', '发布人员'], ['账号昵称', '账号名称']], ['dy', '抖音-矩阵号-数据', ['发布人员'], ['账号名称']], ['sr', '抖音-素人号-数据', ['发布人员'], ['账号名称']]];
    const m = {}; const since = Date.now() - 90 * 864e5;
    for (const [k, name, pf, af] of SRC) {
      const t = tabs.find(x => x.name === name); if (!t) continue; let p2 = '';
      do { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/records/search`, {}, Object.assign({ page_size: 500 }, p2 ? { page_token: p2 } : {}));
        for (const r of d.items || []) { const f = r.fields || {}; const who = String(val(pf.map(x => f[x]).find(Boolean)) || '').trim(); const acc = String(val(af.map(x => f[x]).find(Boolean)) || '').trim(); if (!who || !acc) continue; const recent = typeof f['发布日期'] === 'number' && f['发布日期'] >= since; const o = ((m[who] = m[who] || {})[k] = m[who][k] || {}); o[acc] = (o[acc] || 0) + (recent ? 3 : 1); }
        p2 = d.has_more ? d.page_token : ''; } while (p2);
    }
    cache = { at: Date.now(), m }; return m;
  }
  const best = o => Object.entries(o || {}).sort((a, b) => b[1] - a[1]);
  // 按分发类别挑账号：小红书矩阵号 → 小红书号；抖音矩阵号 → 抖音矩阵号；抖音素人号 → 素人号（没有就退到另一个抖音表）
  async function pick(who, kind) {
    if (people) { try { const p = await people.resolve(who, kind); if (p) { const a = /小红书/.test(kind) ? p['小红书账号'] : p['抖音账号']; if (a) return { acc: a, alts: [], person: p }; } } catch (e) { } }
    const m = await map(); const o = m[String(who || '').trim()]; if (!o) return { acc: '', alts: [] };
    const k = /小红书/.test(kind) ? ['xhs'] : /素人/.test(kind) ? ['sr', 'dy'] : ['dy', 'sr'];
    for (const x of k) { const b = best(o[x]); if (b.length) return { acc: b[0][0], alts: b.slice(1).map(y => y[0]) }; }
    return { acc: '', alts: [] };
  }
  return { map, pick, best };
}
module.exports.createAccounts = createAccounts;

// ---------- 领稿卡片：派稿日期 = 今天、状态 = 待发布 的稿件 → 卡片 + 可复制的文案 + 素材 ----------
function createDispatch({ api, core, raw, log }) {
  const val = v => Array.isArray(v) ? v.map(x => (x && typeof x === 'object') ? (x.text || x.name || '') : String(x)).join('') : (v && typeof v === 'object') ? (v.text || v.name || v.link || '') : (v ?? '');
  const bjDay = t => Math.floor((t + 8 * 3600e3) / 864e5);
  async function today(day) {
    const app = await core.appToken(); const tid = await core.ensurePaigao(); const out = []; let pt = '';
    do { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${tid}/records/search`, {}, Object.assign({ page_size: 200 }, pt ? { page_token: pt } : {})); out.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    const D = day ?? bjDay(Date.now());
    return out.map(r => ({ id: r.record_id, f: r.fields || {} })).filter(r => typeof r.f['派稿日期'] === 'number' && bjDay(r.f['派稿日期']) === D && String(val(r.f['状态']) || '待发布') === '待发布');
  }
  function card(r) {
    const f = r.f, s = k => String(val(f[k]) || '').trim();
    const plats = (Array.isArray(f['发布平台']) ? f['发布平台'] : []).map(String);
    const files = f['素材'] || []; const nImg = files.filter(x => /^image\//.test(x.type || '') || /\.(jpe?g|png|webp|gif)$/i.test(x.name || '')).length; const nVid = files.length - nImg;
    const who = s('发布人员') || '（还没选发布人员）'; const type = s('内容类型') || '图文';
    const loc = [s('定位') && `📍 ${/抖音/.test(plats.join()) && type === '视频' ? '定位' : '小红书/携程定位'}：${s('定位')}`, s('点评定位') && plats.includes('大众点评') && `📍 点评定位：${s('点评定位')}`].filter(Boolean).join('\n');
    const el = [
      ...(r.at ? [{ tag: 'div', text: { tag: 'lark_md', content: `<at id=${r.at}></at> 今天的稿件来啦 👇` } }] : []),
      { tag: 'div', text: { tag: 'lark_md', content: `**要发的平台**\n${plats.map((p, i) => i === 0 ? `**${p}（主发）**` : p).join(' · ') || '—'}` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**标题**\n${s('标题') || '—'}` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**素材**\n${nImg ? `图片 ${nImg} 张（按顺序发）` : ''}${nImg && nVid ? '，' : ''}${nVid ? `视频 ${nVid} 个` : ''}${!files.length ? '⚠️ 还没有素材' : ''}` } }
    ];
    if (loc) el.push({ tag: 'div', text: { tag: 'lark_md', content: loc } });
    if (r.cover) el.push({ tag: 'img', img_key: r.cover, alt: { tag: 'plain_text', content: '素材预览' }, mode: 'fit_horizontal', preview: true });
    if (r.link) el.push({ tag: 'action', layout: 'bisected', actions: [{ tag: 'button', type: 'primary', text: { tag: 'plain_text', content: '📋 打开领稿页（一键复制 · 下载素材）' }, url: r.link }, { tag: 'button', type: 'default', text: { tag: 'plain_text', content: '✅ 我发好了，贴链接' }, url: r.link + '#done' }] });
    el.push({ tag: 'note', elements: [{ tag: 'plain_text', content: `领稿页里可以一键复制标题/正文/话题、下载${type === '视频' ? '视频' : '全部图片'}；发完在页面里贴链接，自动登记。${type === '视频' ? '视频自带声音，不用加配乐。' : ''}` }] });
    return { config: { wide_screen_mode: true }, header: { template: type === '视频' ? 'indigo' : 'blue', title: { tag: 'plain_text', content: `${type === '视频' ? '🎬 今日视频' : '📮 今日稿件'} · @${s('账号名称') || who}` } }, elements: [{ tag: 'div', text: { tag: 'lark_md', content: `${s('稿件编号') || s('文本')}${s('账号名称') && s('发布人员') ? ' · 发布人 ' + s('发布人员') : ''}${s('门店') ? ' · ' + s('门店') : ''}${typeof f['派稿日期'] === 'number' ? ' · ' + new Date(f['派稿日期'] + 8 * 3600e3).toISOString().slice(5, 10).replace('-', '/') : ''}` } }].concat(el) };
  }
  // 发给某人/某群：卡片 → 文案+图片（富文本，长按可复制/保存）→ 视频文件
  async function send(r, receive) {
    const f = r.f, s = k => String(val(f[k]) || '').trim();
    const q = { receive_id_type: receive.type };
    const files = f['素材'] || [];
    const first = files.find(x => !(/^video\//.test(x.type || '') || /\.(mp4|m4v|mov)$/i.test(x.name || '')));
    if (first && !r.cover) { try { r.cover = await raw.imKey(await raw.download(first.url)); } catch (e) { log('[领稿] 封面图失败：' + e.message); } }
    if (raw.taskLink) r.link = raw.taskLink(r.id);
    await api.call('POST', '/im/v1/messages', { receive_id: receive.id, msg_type: 'interactive', content: JSON.stringify(card(r)) }, q);
    log(`[领稿] 已发：${s('稿件编号')} → ${s('发布人员') || '?'}`);
    return { link: r.link };
  }
  async function sendOld(r, receive, sent) {
    const f = r.f, s = k => String(val(f[k]) || '').trim(); const files = f['素材'] || []; const imgs = [], vids = [];
    for (const x of files) { try { const buf = await raw.download(x.url); if (/^video\//.test(x.type || '') || /\.(mp4|m4v|mov)$/i.test(x.name || '')) vids.push({ buf, name: x.name }); else imgs.push(await raw.imKey(buf)); } catch (e) { log('[领稿] 素材下载失败：' + e.message); } }
    const text = [s('标题'), '', s('文案正文'), '', s('话题标签')].join('\n').replace(/\n{3,}/g, '\n\n').trim();
    const content = [[{ tag: 'text', text }]].concat(imgs.map(k => [{ tag: 'img', image_key: k }]));
    await api.call('POST', `/im/v1/messages/${sent.message_id}/reply`, { msg_type: 'post', content: JSON.stringify({ zh_cn: { title: '文案（长按复制）', content } }) });
    for (const v of vids) { try { const key = await raw.imFile(v.buf, v.name); await api.call('POST', `/im/v1/messages/${sent.message_id}/reply`, { msg_type: 'file', content: JSON.stringify({ file_key: key }) }); } catch (e) { log('[领稿] 视频发送失败：' + e.message); } }
    log(`[领稿] 已发：${s('稿件编号')} → ${s('发布人员') || '?'}`);
    return { imgs: imgs.length, vids: vids.length };
  }
  async function getRec(id) {
    const app = await core.appToken(); const tid = await core.ensurePaigao();
    const d = await api.call('GET', `/bitable/v1/apps/${app}/tables/${tid}/records/${id}`); return { id, f: (d.record || {}).fields || {} };
  }
  function view(r, mediaBase) {
    const f = r.f, s = k => String(val(f[k]) || '').trim(); const files = f['素材'] || [];
    const isVid = x => /^video\//.test(x.type || '') || /\.(mp4|m4v|mov)$/i.test(x.name || '');
    return { code: s('稿件编号') || s('文本'), who: s('发布人员'), account: s('账号名称'), store: s('门店'), date: typeof f['派稿日期'] === 'number' ? new Date(f['派稿日期'] + 8 * 3600e3).toISOString().slice(5, 10).replace('-', '/') : '', type: s('内容类型') || '图文', platforms: (Array.isArray(f['发布平台']) ? f['发布平台'] : []).map(String), title: s('标题'), body: s('文案正文'), tags: s('话题标签'), loc: s('定位'), dp: (Array.isArray(f['发布平台']) && f['发布平台'].includes('大众点评')) ? s('点评定位') : '', status: s('状态'),
      images: files.map((x, i) => isVid(x) ? null : `${mediaBase}/m/${i}`).filter(Boolean), videos: files.map((x, i) => isVid(x) ? { url: `${mediaBase}/m/${i}`, name: x.name || '视频.mp4' } : null).filter(Boolean) };
  }
  async function markDone(id, text) {
    const app = await core.appToken(); const tid = await core.ensurePaigao(); const f = {};
    const m = re => (String(text).match(re) || [])[0];
    const x = m(/https?:\/\/(?:xhslink\.com|www\.xiaohongshu\.com)\/\S+/), d = m(/https?:\/\/(?:v\.douyin\.com|www\.douyin\.com|www\.iesdouyin\.com)\/\S+/), v = m(/https?:\/\/(?:weixin\.qq\.com\/sph|channels\.weixin\.qq\.com)\/\S+/);
    if (x) f['小红书链接'] = { link: x, text: x }; if (d) f['抖音链接'] = { link: d, text: d }; if (v) f['视频号链接'] = { link: v, text: v };
    if (x || d || v) f['状态'] = '已发布';
    if (Object.keys(f).length) await api.call('PUT', `/bitable/v1/apps/${app}/tables/${tid}/records/${id}`, { fields: f });
    return !!f['状态'];
  }
  return { today, card, send, getRec, view, markDone };
}
module.exports.createDispatch = createDispatch;
