/* 抖音分享消息 → { url, nick, title }
 * 例：1.25 复制打开抖音，看看【苏洛洛的童话的图文作品】J人做的珠海保姆级旅游攻略！去珠海玩直接抄这版！全... https://v.douyin.com/IM94io9qKVk/ I@V.YZ :2pm 03/30 ebN:/
 * 飞书富文本里链接文字常是完整标题：「J人做的珠海…全程窝在香洲 - 抖音」
 */
'use strict';
const URL_RE = /https?:\/\/v\.douyin\.com\/[A-Za-z0-9_-]+\/?|https?:\/\/(?:www\.)?(?:iesdouyin|douyin)\.com\/(?:share\/)?(?:video|note)\/\d+[^\s]*/g;
// 电脑网页端：douyin.com/jingxuan?modal_id=…、/user/…?modal_id=…、/search/…?modal_id=…、?vid=… 都换成 www.douyin.com/video/ID
const PC_RE = /https?:\/\/(?:www\.)?douyin\.com\/[^\s\u4e00-\u9fa5，。]*?[?&#](?:modal_id|vid)=(\d{12,})[^\s\u4e00-\u9fa5，。]*/g;
const ANY_RE = new RegExp(PC_RE.source + '|' + URL_RE.source, 'g');
const isDouyinLink = t => /v\.douyin\.com\/|iesdouyin\.com\/|douyin\.com\/(?:share\/)?(?:video|note)\/\d|douyin\.com\/\S*?[?&#](?:modal_id|vid)=\d{12,}/.test(String(t || ''));
const canon = u => { const m = u.match(/[?&#](?:modal_id|vid)=(\d{12,})/); if (m && !/\/(?:video|note)\/\d/.test(u)) return 'https://www.douyin.com/video/' + m[1]; const v = u.match(/^(https?:\/\/(?:www\.)?(?:iesdouyin|douyin)\.com\/(?:share\/)?(?:video|note)\/\d+)/); return v ? v[1].replace(/iesdouyin\.com\/share\//, 'douyin.com/') : u; };
const clean = s => String(s || '').replace(/\[|\]|\(|\)/g, ' ').replace(/(\.{3}|…)+\s*$/, '').replace(/\s+/g, ' ').trim();

function parseDouyin(text) {
  const src = String(text || '');
  const out = []; const seen = new Set(); let last = 0; let m;
  ANY_RE.lastIndex = 0;
  while ((m = ANY_RE.exec(src))) {
    const url = canon(m[0].replace(/[)\]]+$/, ''));
    const seg = src.slice(last, m.index); last = m.index + m[0].length;
    const key = url.replace(/\/$/, ''); if (seen.has(key)) continue; seen.add(key);
    const nickM = seg.match(/【(.+?)的(?:图文)?作品】/);
    const cands = [];
    const full = seg.match(/([^\n\]【】]{6,}?)\s*-\s*抖音\s*\]?\s*\(?\s*$/); if (full) cands.push(clean(full[1].split(/\.{3}|…/).pop()));
    const after = nickM ? seg.slice(seg.indexOf(nickM[0]) + nickM[0].length) : seg.replace(/^[\d.\s]*复制打开抖音[，,]?\s*看看/, '');
    cands.push(clean(after.split(/\.{3}|…|\s-\s抖音/)[0]));
    const title = (full && cands[0]) || cands.filter(Boolean).sort((a, b) => b.length - a.length)[0] || '';
    out.push({ url, nick: nickM ? nickM[1].trim() : '', title, truncated: !full && /(\.{3}|…)\s*$/.test(after.split(/\s-\s抖音/)[0].trim()) });
  }
  // 同一条作品在消息里出现两次（预览卡片 + 链接）时合并：保留最长标题
  return out;
}

// 打开短链拿作品 ID / 作者 / 标题（服务器上能打开就用，打不开就只用消息里的信息）
async function fetchDouyin(url) {
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(12000) });
    const id = (r.url.match(/(?:video|note)\/(\d{8,})/) || url.match(/(?:video|note)\/(\d{8,})/) || [])[1] || '';
    const html = await r.text();
    const pick = re => { const x = html.match(re); return x ? x[1] : ''; };
    const un = s => { try { return JSON.parse('"' + s + '"'); } catch (e) { return s; } };
    const desc = un(pick(/"desc":"((?:[^"\\]|\\.){2,300})"/));
    const nick = un(pick(/"nickname":"((?:[^"\\]|\\.){1,60})"/));
    const time = +pick(/"create_time":(\d{10})/) * 1000 || null;
    const title = desc || (pick(/<title>([^<]{2,200})<\/title>/) || '').replace(/\s*-\s*抖音\s*$/, '');
    return { id, nick, title, time };
  } catch (e) { return {}; }
}

module.exports = { parseDouyin, fetchDouyin, isDouyinLink };
