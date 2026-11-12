/* 素材上传群 → 「小红书内容工坊」多维表格的「原图素材库」
 * 同事在群名带「素材上传」的群里发菜品照片（图片、原图文件、图文混排都认），配一句「门店 菜品」（如「白石洲 奶油虾」）
 * · 说明可以和图一起发（图文混排），也可以 2 分钟内先发或后发一句文字，同一个人的算一组
 * · 没写说明也收：门店=其他，@ 他补一句；10 分钟内补的说明会自动回填到这几张图上
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

function createRawLib({ api, upload, imgBuf, fileBuf, toJpg, reply, senderName, log, dataDir, cfg }) {
  const APP = (cfg && cfg.rawApp) || 'KYhJb5OvqaJnlYsdNEUc9kOMnmg';
  const T = (cfg && cfg.rawTable) || 'tblKTzFWP26rj7e0';
  const F = path.join(dataDir, 'rawlib.json');
  let st = { hash: {}, seq: {} }; try { st = Object.assign(st, JSON.parse(fs.readFileSync(F, 'utf8'))); } catch (e) { }
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
    if (b.ok.length) L.push(`✅ 已入库 ${b.ok.length} 张` + (b.c ? `（${b.c.store}${b.c.dish ? ' · ' + b.c.dish : ''}）` : '') + `：${b.ok.slice(0, 5).join('、')}${b.ok.length > 5 ? ' 等' : ''}`);
    if (b.dup) L.push(`♻️ 重复 ${b.dup} 张，已跳过`);
    if (b.fail.length) L.push(`⚠️ ${b.fail.length} 张没存进去：${b.fail[0]}。请稍后重发，或告诉管理员`);
    if (b.noCap) L.push(`${at(sid)}已收图，请补一句：门店+菜名（如「白石洲 奶油虾」），否则这张图用不上`);
    else if (b.c && !b.c.hit && b.ok.length) L.push(`门店没认出来，先记成「其他」，原话放在备注里；下次写上店名（如 白石洲、华强北、水东街）`);
    if (L.length) reply(b.mid, L.join('\n'));
  }
  function note(sid, mid, k, v, c) {
    let b = batch.get(sid); if (!b) { b = { mid, ok: [], dup: 0, fail: [], noCap: 0, c: null }; batch.set(sid, b); }
    if (k === 'ok') b.ok.push(v); else if (k === 'dup') b.dup++; else if (k === 'fail') b.fail.push(v); else if (k === 'noCap') b.noCap = 1;
    if (c) b.c = c; clearTimeout(b.timer); b.timer = setTimeout(() => flush(sid), 6000);
  }

  async function ingest(buf, name, sid, who, c) {
    const h = crypto.createHash('sha1').update(buf).digest('hex');
    if (st.hash[h]) return { dup: true };
    const store = c ? c.store : '其他', d = day(); const k = store + d; st.seq[k] = (st.seq[k] || 0) + 1;
    const code = `${store}-${d}-${String(st.seq[k]).padStart(2, '0')}`;
    const ext = /png/i.test(name) ? 'png' : /webp/i.test(name) ? 'webp' : 'jpg';
    const tok = await upload(buf, `${code}.${ext}`, 'bitable_image', APP);
    const f = { 素材编号: code, 图片: [{ file_token: tok }], 门店: store, 拍摄人: who || '', 拍摄日期: Date.now(), 用途: '待定', 使用状态: '未使用' };
    if (c && c.dish) f.菜品 = c.dish; if (c && !c.hit) f.备注 = '说明原文：' + c.raw;
    const r = await api.call('POST', `/bitable/v1/apps/${APP}/tables/${T}/records`, { fields: f });
    const rec = (r.record || {}).record_id; st.hash[h] = rec || 1; save();
    log(`[素材库] ${who} ${code}${c ? '' : '（待补说明）'}`);
    return { code, rec };
  }

  // 补说明：把这个人 10 分钟内没说明的图回填上
  async function backfill(sid, mid, c) {
    const list = (bare.get(sid) || []).filter(x => Date.now() - x.at < 10 * 60e3 && x.rec); if (!list.length) return false; bare.delete(sid);
    let n = 0; for (const x of list) { try { const f = { 门店: c.store }; if (x.code && c.store !== '其他') f.素材编号 = x.code.replace(/^其他-/, c.store + '-'); if (c.dish) f.菜品 = c.dish; if (!c.hit) f.备注 = '说明原文：' + c.raw; await api.call('PUT', `/bitable/v1/apps/${APP}/tables/${T}/records/${x.rec}`, { fields: f }); n++; } catch (e) { log('[素材库] 回填说明出错：' + e.message); } }
    if (n) reply(mid, `✅ 已把说明补到刚才的 ${n} 张图上（${c.store}${c.dish ? ' · ' + c.dish : ''}）`);
    return true;
  }

  // 返回 true = 这条消息已处理（素材群里的消息都不再走别的逻辑）
  async function onMsg({ m, text, images, sid }) {
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
        const buf = await x.get(); if (!buf || !buf.length) throw new Error('没下载到原图');
        const r = await ingest(buf, x.name, sid, who, c);
        if (r.dup) { note(sid, m.message_id, 'dup', 1); continue; }
        note(sid, m.message_id, 'ok', r.code, c);
        if (!c) { const l = bare.get(sid) || []; l.push({ rec: r.rec, code: r.code, at: Date.now() }); bare.set(sid, l); note(sid, m.message_id, 'noCap', 1); }
      } catch (e) { log('[素材库] 入库出错：' + e.message); note(sid, m.message_id, 'fail', /91403|403|Forbidden|permission/i.test(e.message) ? '机器人还没有「小红书内容工坊」表格的编辑权限' : e.message.slice(0, 80)); }
    }
    return true;
  }

  async function check() { // 自检：能不能读到表和字段
    const d = await api.call('GET', `/bitable/v1/apps/${APP}/tables/${T}/fields`, null, { page_size: 100 });
    return (d.items || []).map(f => f.field_name + ':' + f.type);
  }
  return { onMsg, check, parseCaption };
}
module.exports = { createRawLib, parseCaption };
