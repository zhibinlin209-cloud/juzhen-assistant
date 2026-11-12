/* 素材上传群 → 「小红书内容工坊」多维表格的「原图素材库」
 * 同事在群名带「素材上传」的群里发菜品照片（图片、原图文件、图文混排都认），配一句「门店 菜品」（如「白石洲 奶油虾」）
 * · 说明可以和图一起发（图文混排），也可以 2 分钟内先发或后发一句文字，同一个人的算一组
 * · 说明不是必须的：通义千问看图自动填 菜品 / 用途 / 画面干净度（AI 初判）；门店出品都一样，不写就留空；写了店名或菜名就以写的为准
 * · 按图片内容（SHA1）去重，重复的跳过并提示；写入失败在群里报错，不静默丢图
 * 由功能开关「素材群收图」（rawUpload）控制
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const STORES = ['华强北', '白石洲', '前海', '江南西', '玖洲道', '水东街', '千灯湖', '33小镇', '蛇口', '花园城'];
const ALIAS = [[/HOP|宝安/i, '前海'], [/珠海|拱北/, '玖洲道'], [/惠州/, '水东街'], [/33|东莞/, '33小镇'], [/粤迹/, '蛇口'], [/海珠/, '江南西']];

function parseCaption(raw) {
  const t = String(raw || '').replace(/@\S+/g, ' ').replace(/[，,。;；:：]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  let store = STORES.find(s => t.includes(s)) || '', tok = store;
  if (!store) { const a = ALIAS.find(([re]) => re.test(t)); if (a) { store = a[1]; tok = (t.match(a[0]) || [''])[0]; } }
  let dish = t; if (tok) dish = dish.replace(tok, ' '); dish = dish.replace(/^\s*店/, ' ').replace(/\s+店\s+/, ' ').replace(/\s+/g, ' ').trim();
  return { store: store || '其他', dish: dish.slice(0, 60), raw: t.slice(0, 200), hit: !!store };
}

const AI_PROMPT = `这是粤式海鲜大排档「YES也是大排档」的一张素材照片，准备用作小红书笔记配图。只按看到的内容判断，只输出一行 JSON，不要别的文字：
{"菜品":"画面主角的菜名，尽量具体，如 奶油虾、蒜蓉生蚝、鱿鱼须、干炒牛河、椒盐皮皮虾、炒花甲、炒蟹、海胆炒饭、反沙凤梨、炒米粉、鸡翅、粥；多道菜摆满桌写「满桌」；没有菜写「环境」「门头」「人物」或「其他」","用途":"封面候选|内页|环境门头|人物动作|待定","画面干净度":"干净无字|少字|有字","说明":"20 字内描述画面"}
规则：用途——菜品特写清晰、有食欲、构图适合竖版封面才写「封面候选」；店招、门口、店内环境写「环境门头」；以人和动作为主（夹菜、干杯、剥虾）写「人物动作」；其余菜品图写「内页」；看不清写「待定」。画面干净度——没有任何文字水印写「干净无字」；有小块文字或价签写「少字」；大段文字或拼图写「有字」。`;
async function small(buf) { // 大图先缩到长边 1600，再给通义看（只用于识别，入库的仍是原图）
  try { if (buf.length < 1.5e6) return { b: buf, t: 'image/jpeg' }; const C = require('@napi-rs/canvas'); const im = await C.loadImage(buf); const k = Math.min(1, 1600 / Math.max(im.width, im.height)); const cv = C.createCanvas(Math.round(im.width * k), Math.round(im.height * k)); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); return { b: cv.toBuffer('image/jpeg', 85), t: 'image/jpeg' }; } catch (e) { return { b: buf, t: 'image/jpeg' }; }
}

function createRawLib({ api, upload, imgBuf, fileBuf, toJpg, reply, senderName, log, dataDir, cfg, vision }) {
  const APP = (cfg && cfg.rawApp) || 'KYhJb5OvqaJnlYsdNEUc9kOMnmg';
  const T = (cfg && cfg.rawTable) || 'tblKTzFWP26rj7e0';
  const F = path.join(dataDir, 'rawlib.json');
  let st = { hash: {}, seq: {}, aiFail: {} }; try { st = Object.assign(st, JSON.parse(fs.readFileSync(F, 'utf8'))); } catch (e) { }
  const save = () => { try { fs.writeFileSync(F, JSON.stringify(st)); } catch (e) { } };
  const cap = new Map();      // sid → { c: 解析后的说明, at }
  const bare = new Map();     // sid → [{ rec, at }] 没说明的图，等补
  const batch = new Map();    // sid → { mid, ok:[], dup:0, fail:[], noCap:0, c, timer }
  const bj = () => new Date(Date.now() + 8 * 3600e3);
  const day = () => bj().toISOString().slice(0, 10).replace(/-/g, '');
  const at = sid => sid ? `<at user_id="${sid}"></at> ` : '';

  function flush(sid) {
    const b = batch.get(sid); if (!b) return; batch.delete(sid);
    const L = [];
    if (b.ok.length) L.push(`✅ 已入库 ${b.ok.length} 张` + (b.c && b.c.hit ? `（${b.c.store}${b.c.dish ? ' · ' + b.c.dish : ''}）` : '') + (vision ? '，菜品和用途由 AI 自动识别，稍后填进表里' : ''));
    if (b.dup) L.push(`♻️ 重复 ${b.dup} 张，已跳过`);
    if (b.fail.length) L.push(`⚠️ ${b.fail.length} 张没存进去：${b.fail[0]}。请稍后重发，或告诉管理员`);
    if (L.length) reply(b.mid, L.join('\n'));
  }
  function note(sid, mid, k, v, c) {
    let b = batch.get(sid); if (!b) { b = { mid, ok: [], dup: 0, fail: [], noCap: 0, c: null }; batch.set(sid, b); }
    if (k === 'ok') b.ok.push(v); else if (k === 'dup') b.dup++; else if (k === 'fail') b.fail.push(v); else if (k === 'noCap') b.noCap = 1;
    if (c) b.c = c; clearTimeout(b.timer); b.timer = setTimeout(() => flush(sid), 6000);
  }

  let iq = Promise.resolve(); // 一张一张存，避免一次几十张时撞上飞书频率限制
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function retry(fn) { let e0; for (let i = 0; i < 4; i++) { try { return await fn(); } catch (e) { e0 = e; if (!/99991400|1254290|1254291|frequency|too many|limit|ECONNRESET|timeout|socket|fetch failed|HTTP 5/i.test(e.message)) throw e; await sleep(1500 * (i + 1)); } } throw e0; }
  async function ingest(buf, name, sid, who, c) {
    const h = crypto.createHash('sha1').update(buf).digest('hex');
    if (st.hash[h]) return { dup: true };
    const store = c && c.hit ? c.store : '', d = day(); const pre = store || '素材'; const k = pre + d; st.seq[k] = (st.seq[k] || 0) + 1;
    const code = `${pre}-${d}-${String(st.seq[k]).padStart(2, '0')}`;
    const ext = /png/i.test(name) ? 'png' : /webp/i.test(name) ? 'webp' : 'jpg';
    const tok = await retry(() => upload(buf, `${code}.${ext}`, 'bitable_image', APP));
    const f = { 素材编号: code, 图片: [{ file_token: tok }], 拍摄人: who || '', 拍摄日期: Date.now(), 用途: '待定', 使用状态: '未使用' };
    if (store) f.门店 = store; if (c && c.dish) f.菜品 = c.dish; if (c && !c.hit && c.raw) f.备注 = '说明原文：' + c.raw;
    const r = await retry(() => api.call('POST', `/bitable/v1/apps/${APP}/tables/${T}/records`, { fields: f }));
    const rec = (r.record || {}).record_id; st.hash[h] = rec || 1; save();
    log(`[素材库] ${who} ${code}${c ? '' : '（无说明，交给 AI 识别）'}`);
    if (rec) aiTag(rec, buf, c);
    return { code, rec };
  }
  // 通义看图：菜品 / 用途 / 画面干净度（AI 初判，排队一张张来，不阻塞收图）
  let q = Promise.resolve(); const aiN = { ok: 0, fail: 0 };
  function aiTag(rec, buf, c) {
    if (!vision) return;
    q = q.then(async () => {
      try {
        const s = await small(buf); const out = await vision(AI_PROMPT, `data:${s.t};base64,` + s.b.toString('base64'));
        const m = String(out || '').match(/\{[\s\S]*\}/); const j = m ? JSON.parse(m[0]) : null; if (!j) throw new Error('没看出结果');
        const f = {}; const use = ['封面候选', '内页', '环境门头', '人物动作', '待定'].find(x => String(j['用途'] || '').includes(x)); if (use) f.用途 = use;
        const cl = ['干净无字', '少字', '有字'].find(x => String(j['画面干净度'] || '') === x) || ['干净无字', '少字', '有字'].find(x => String(j['画面干净度'] || '').includes(x)); if (cl) f.画面干净度 = cl;
        if (!(c && c.dish) && j['菜品']) f.菜品 = String(j['菜品']).slice(0, 30);
        f.备注 = ((c && !c.hit && c.raw) ? '说明原文：' + c.raw + '；' : '') + 'AI 初判：' + String(j['说明'] || '').slice(0, 40);
        await api.call('PUT', `/bitable/v1/apps/${APP}/tables/${T}/records/${rec}`, { fields: f }); aiN.ok++;
      } catch (e) { aiN.fail++; st.aiFail = st.aiFail || {}; st.aiFail[rec] = (st.aiFail[rec] || 0) + 1; save(); log('[素材库] AI 识别出错：' + e.message); }
    });
  }

  // 补说明：把这个人 10 分钟内没说明的图回填上
  async function backfill(sid, mid, c) {
    const list = (bare.get(sid) || []).filter(x => Date.now() - x.at < 10 * 60e3 && x.rec); if (!list.length) return false; bare.delete(sid);
    let n = 0; for (const x of list) { try { if (!c.hit && !c.dish) continue; const f = {}; if (c.hit) f.门店 = c.store; if (x.code && c.hit) f.素材编号 = x.code.replace(/^素材-/, c.store + '-'); if (c.dish) f.菜品 = c.dish; if (!c.hit) f.备注 = '说明原文：' + c.raw; await api.call('PUT', `/bitable/v1/apps/${APP}/tables/${T}/records/${x.rec}`, { fields: f }); n++; } catch (e) { log('[素材库] 回填说明出错：' + e.message); } }
    if (n) reply(mid, `✅ 已把「${c.raw}」补到刚才的 ${n} 张图上`);
    return true;
  }

  // 返回 true = 这条消息已处理（素材群里的消息都不再走别的逻辑）
  async function onMsg({ m, text, images, sid, quiet }) {
    if (m.chat_id && st.chat !== m.chat_id) { st.chat = m.chat_id; save(); }
    if (!quiet && /^\s*补漏\s*$/.test(text || '') && !(images || []).length) { reply(m.message_id, '⏳ 开始回头检查今天群里的图，没存进去的补上…'); resync(m.chat_id).then(r => reply(m.message_id, `✅ 补漏完成：检查 ${r.seen} 张，补存 ${r.added} 张` + (r.fail ? `，${r.fail} 张仍失败（会在下次补漏时再试）` : ''))).catch(e => reply(m.message_id, '⚠️ 补漏出错：' + e.message)); return true; }
    const who = await senderName(sid).catch(() => '');
    const files = [];
    try {
      for (const k of images || []) files.push({ get: () => imgBuf(m.message_id, k), name: 'img.jpg' });
      if (m.message_type === 'file') { let c = {}; try { c = JSON.parse(m.content || '{}'); } catch (e) { } if (/\.(jpe?g|png|webp|heic|heif)$/i.test(c.file_name || '')) files.push({ get: async () => { const b = await fileBuf(m.message_id, c.file_key); return toJpg ? ((await toJpg(b, c.file_name)) || {}).buf || b : b; }, name: c.file_name }); }
    } catch (e) { }
    const c0 = parseCaption(text);
    if (!files.length) { // 纯文字：当说明记下；有刚才没说明的图就回填
      if (!c0) return true; cap.set(sid, { c: c0, at: Date.now() });
      await backfill(sid, m.message_id, c0); return true;
    }
    if (c0) cap.set(sid, { c: c0, at: Date.now() });
    let c = c0; if (!c) { const p = cap.get(sid); if (p && Date.now() - p.at < 2 * 60e3) c = p.c; }
    for (const x of files) {
      try {
        const buf = await retry(() => x.get()); if (!buf || !buf.length) throw new Error('没下载到原图');
        const r = await (iq = iq.catch(() => { }).then(() => ingest(buf, x.name, sid, who, c)));
        if (r.dup) { if (quiet) quiet.dup++; else note(sid, m.message_id, 'dup', 1); continue; }
        if (quiet) { quiet.added++; } else note(sid, m.message_id, 'ok', r.code, c);
        if (!c) { const l = bare.get(sid) || []; l.push({ rec: r.rec, code: r.code, at: Date.now() }); bare.set(sid, l); }
      } catch (e) { log('[素材库] 入库出错：' + e.message); if (quiet) { quiet.fail++; continue; } note(sid, m.message_id, 'fail', /91403|403|Forbidden|permission/i.test(e.message) ? '机器人还没有「小红书内容工坊」表格的编辑权限' : e.message.slice(0, 80)); }
    }
    return true;
  }

  // 补识别：表里还没有「AI 初判」的图（含表单上传的、改版前收的），逐张补上；每次最多 max 张
  async function backfillAI(dl, max) {
    if (!vision || !dl) return 0; let pt = '', n = 0;
    do {
      const d = await api.call('POST', `/bitable/v1/apps/${APP}/tables/${T}/records/search`, {}, Object.assign({ page_size: 200 }, pt ? { page_token: pt } : {}));
      for (const r of d.items || []) {
        if (n >= (max || 200)) return n; const f = r.fields || {}; if (/AI 初判/.test(JSON.stringify(f['备注'] || '')) || ((st.aiFail || {})[r.record_id] || 0) >= 2) continue;
        const a = (Array.isArray(f['图片']) ? f['图片'] : [])[0]; if (!a) continue;
        try { const buf = await dl(a.url || `https://open.feishu.cn/open-apis/drive/v1/medias/${a.file_token}/download`); const dish = String((Array.isArray(f['菜品']) ? f['菜品'].map(x => x.text || '').join('') : f['菜品']) || ''); aiTag(r.record_id, buf, dish ? { dish, hit: true } : null); n++; await q; } catch (e) { log('[素材库] 补识别下载出错：' + e.message); }
      }
      pt = d.has_more ? d.page_token : '';
    } while (pt);
    return n;
  }
  // 补漏：翻素材群从 since（默认今天 0 点）起的消息，没存进表的图重新存（按图片内容去重，存过的自动跳过）
  async function resync(chatId, since) {
    chatId = chatId || st.chat; if (!chatId) throw new Error('还不知道素材群是哪个，先在群里发一张图');
    const t0 = since || (Math.floor((Date.now() + 8 * 3600e3) / 864e5) * 864e5 - 8 * 3600e3);
    const r = { seen: 0, added: 0, dup: 0, fail: 0 }; let pt = '';
    do {
      const d = await api.call('GET', '/im/v1/messages', null, Object.assign({ container_id_type: 'chat', container_id: chatId, start_time: String(Math.floor(t0 / 1000)), sort_type: 'ByCreateTimeAsc', page_size: 50 }, pt ? { page_token: pt } : {}));
      for (const it of d.items || []) {
        if ((it.sender || {}).sender_type !== 'user') continue; let c = {}; try { c = JSON.parse((it.body || {}).content || '{}'); } catch (e) { }
        let images = [], text = '';
        if (it.msg_type === 'image') images = [c.image_key];
        else if (it.msg_type === 'post') { const b = c.content ? c : (c.zh_cn || c.en_us || Object.values(c)[0] || {}); const fl = (b.content || []).flat(); images = fl.filter(x => x.tag === 'img').map(x => x.image_key); text = fl.filter(x => x.tag === 'text').map(x => x.text).join(' '); }
        else if (it.msg_type !== 'file') continue;
        const n0 = r.added + r.dup + r.fail;
        await onMsg({ m: { message_id: it.message_id, message_type: it.msg_type, content: (it.body || {}).content, chat_id: chatId }, text, images: images.filter(Boolean), sid: (it.sender || {}).id || '', quiet: r });
        r.seen += r.added + r.dup + r.fail - n0;
      }
      pt = d.has_more ? d.page_token : '';
    } while (pt);
    log(`[素材库] 补漏：检查 ${r.seen} 张，补存 ${r.added} 张，已有 ${r.dup} 张，失败 ${r.fail} 张`); return r;
  }
  async function check() { // 自检：能不能读到表和字段
    const d = await api.call('GET', `/bitable/v1/apps/${APP}/tables/${T}/fields`, null, { page_size: 100 });
    return (d.items || []).map(f => f.field_name + ':' + f.type);
  }
  return { onMsg, check, backfillAI, resync, parseCaption, aiStat: () => aiN };
}
module.exports = { createRawLib, parseCaption };
