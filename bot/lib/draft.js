/* 收稿：编辑把稿件（编号 + 标题 + 正文 + 话题）发到飞书群，后面跟着发图片/视频
 * → 机器人整篇存进营销部多维表格「派稿记录」的一行，图片视频放进「素材」列
 */
'use strict';

// 门店关键词 → 门店、小红书/携程定位（区）、点评定位
const STORES = [
  [/粤迹/, '粤迹·岭南家宴', '深圳市南山区', '粤迹·岭南家宴'],
  [/水东街|惠州/, '惠州水东街店', '惠州市惠城区', '也是大排档（水东街店）'],
  [/江南西/, '广州江南西店', '广州市海珠区', '也是大排档（江南西店）'],
  [/华强北/, '深圳华强北燕南店', '深圳市福田区', '也是大排档（华强北店）'],
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
  const all = head + '\n' + title + '\n' + body;
  const st = STORES.find(([re]) => re.test(head)) || STORES.find(([re]) => re.test(all));
  return { code, writer, title, body, tags, kind, loc, store: st ? st[1] : '', area: st ? st[2] : '', dp: st ? st[3] : '' };
}

function createDraft({ api, core, upload, log }) {
  let tid = null; const pending = new Map(); // 发稿人 → { id, code, at, n }
  async function tbl() { if (!tid) tid = await core.ensurePaigao(); return { app: await core.appToken(), tid }; }
  async function save(text, sender, senderId, imgs, video) {
    const d = parseDraft(text, video && video.name); const T = await tbl();
    const kind = /抖音素人/.test(d.kind) ? '抖音素人号' : (/抖音矩阵/.test(d.kind) || d.video) ? '抖音矩阵号' : '小红书矩阵号';
    const type = kind === '抖音矩阵号' || d.video ? '视频' : '图文';
    const fields = { 文本: d.code, 稿件编号: d.code, 写手: d.writer, 账号名称: d.account, 分发类别: kind, 内容类型: type, 发布平台: PLATFORMS[`${kind}|${type}`] || [], 标题: d.title, 文案正文: d.body, 话题标签: d.tags, 门店: d.store, 定位: d.loc || d.area, 点评定位: d.dp, 状态: '待发布', 派稿人: sender || '', 备注: '收稿时间 ' + new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ') };
    Object.keys(fields).forEach(k => { if (fields[k] === '' || (Array.isArray(fields[k]) && !fields[k].length)) delete fields[k]; });
    const r = await api.call('POST', `/bitable/v1/apps/${T.app}/tables/${T.tid}/records`, { fields });
    const id = r.record.record_id; pending.set(senderId, { id, code: d.code, at: Date.now(), n: 0, type, kind });
    log(`[收稿] ${d.code}（${d.title.slice(0, 20)}）`);
    if (imgs && imgs.length) await addMedia(senderId, imgs);
    if (video && video.buf) await addMedia(senderId, [{ buf: video.buf, name: video.name, video: true }]);
    return Object.assign(d, { id, kind, type, platforms: fields.发布平台 || [] });
  }
  // 发稿后 15 分钟内，同一个人发的图片/视频都归到这篇
  const active = senderId => { const p = pending.get(senderId); return p && Date.now() - p.at < 15 * 60e3 ? p : null; };
  function addMedia(senderId, files) { // 排队：连发 9 张图时一张张按顺序存，不会互相覆盖
    const p = active(senderId); if (!p) return Promise.resolve(null);
    p.at = Date.now(); p.q = (p.q || Promise.resolve()).then(() => addNow(p, files)).catch(e => { log('[收稿] 素材保存失败：' + e.message); return p; });
    return p.q;
  }
  async function addNow(p, files) {
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
  return { isDraft, save, addMedia, active, parseDraft };
}

function replyForDraft(d) {
  return `📥 已收进稿件库：${d.code}${d.writer ? '（写手 ' + d.writer + '）' : ''}${d.account ? '（账号 ' + d.account + '）' : ''}\n标题：${d.title || '⚠️ 没读到标题'}\n类别：${d.kind} · ${d.type} → ${d.platforms.join(' + ')}\n门店：${d.store || '⚠️ 没认出门店'}${d.area ? ' · 定位 ' + d.area : ''}${d.dp ? ' · 点评定位 ' + d.dp : ''}\n接下来 15 分钟内发的图片/视频会自动归到这篇。`;
}
module.exports = { createDraft, parseDraft, isDraft, replyForDraft, PLATFORMS };
