/* 封面生成：用素材图库的真实照片拼图 + 大字，出 1080×1440（3:4）JPG
 * 依赖 @napi-rs/canvas（预编译包，不用装系统库）；装不上就返回 null，不影响写稿
 */
'use strict';
let C = null, err = '';
function lib() {
  if (C || err) return C;
  try {
    C = require('@napi-rs/canvas');
    C.GlobalFonts.register(Buffer.from(require('./coverfont.js'), 'base64'), 'XJ');
  } catch (e) { err = e.message; C = null; }
  return C;
}
const W = 1080, H = 1440;
const PALETTE = [['#FFE14D', '#1A1A1A'], ['#FF4D4F', '#FFFFFF'], ['#FFFFFF', '#C8102E'], ['#2BD9A0', '#111111'], ['#FF8A00', '#FFFFFF']];

function fit(ctx, img, x, y, w, h) { // 居中裁切填满
  const r = Math.max(w / img.width, h / img.height), sw = w / r, sh = h / r;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}
// 把大字切成 ≤3 行：先按空格/标点切，再按长度切
function lines(text) {
  const t = String(text || '').replace(/[「」"“”]/g, '').trim().slice(0, 18);
  let parts = t.split(/[\s，,！!？?｜|、]+/).filter(Boolean);
  if (parts.length === 1 || parts.length > 3 || parts.some(p => p.length > 8)) {
    const s = parts.join(''), n = s.length <= 7 ? 1 : s.length <= 14 ? 2 : 3, per = Math.ceil(s.length / n);
    parts = []; for (let i = 0; i < s.length; i += per) parts.push(s.slice(i, i + per));
  }
  return parts.slice(0, 3);
}
function bigText(ctx, ls, cy, colors, maxW) {
  const [bg, fg] = colors; const longest = Math.max(...ls.map(l => l.length));
  let size = Math.min(170, Math.floor(maxW / Math.max(longest, 1) / 1.02)); ctx.font = `${size}px XJ`;
  const lh = size * 1.22, total = lh * ls.length; let y = cy - total / 2;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ls.forEach((l, i) => {
    const w = ctx.measureText(l).width, x = W / 2, yy = y + lh * i + lh / 2;
    ctx.save(); ctx.translate(x, yy); ctx.rotate(i % 2 ? 0.012 : -0.018);
    ctx.fillStyle = bg; const pad = size * 0.22; ctx.fillRect(-w / 2 - pad, -lh / 2 + 6, w + pad * 2, lh - 12);
    ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.1; ctx.strokeStyle = bg === '#FFFFFF' ? '#FFFFFF' : '#000000';
    ctx.fillStyle = fg; ctx.fillText(l, 0, 4); ctx.restore();
  });
}
function pill(ctx, text, x, y) {
  ctx.font = '44px XJ'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 64;
  ctx.fillStyle = 'rgba(0,0,0,0.62)'; ctx.beginPath(); ctx.roundRect(x, y, w, 80, 40); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillText(text, x + 32, y + 42);
}

/* bufs：照片 Buffer 数组（第一张当主图）；text：封面大字；form：拼图/大字报/攻略长图；tag：左上角小字（门店） */
async function render(bufs, { text, form, tag, seed, clean: opt_clean } = {}) {
  const c = lib(); if (!c) return null;
  const imgs = []; for (const b of bufs) { try { imgs.push(await c.loadImage(b)); } catch (e) { } if (imgs.length >= 6) break; }
  if (!imgs.length) return null;
  const cv = c.createCanvas(W, H), ctx = cv.getContext('2d'); ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H);
  const colors = PALETTE[(seed || 0) % PALETTE.length], ls = lines(text), g = 8;
  const f = String(form || '');
  const clean = Math.min(imgs.length, +opt_clean || imgs.length);
  if (/大字/.test(f) || imgs.length < 3 || clean < 3) { // 大字报：满版（干净图不够就把背景虚化，原图上的字看不清）+ 压暗 + 正中大字；有干净图就做成两张拍立得
    ctx.save(); if (clean < 3) ctx.filter = 'blur(28px)'; fit(ctx, imgs[0], -40, -40, W + 80, H + 80); ctx.restore();
    if (clean >= 1 && clean < 3) { const pw = 560, ph = 560; [[W / 2 - 300, 170, -0.06, 0], [W / 2 - 220, 870, 0.05, 1]].slice(0, clean).forEach(([x, y, a, i]) => { ctx.save(); ctx.translate(x + pw / 2, y + ph / 2); ctx.rotate(a); ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 30; ctx.fillRect(-pw / 2 - 18, -ph / 2 - 18, pw + 36, ph + 70); ctx.shadowBlur = 0; fit(ctx, imgs[i], -pw / 2, -ph / 2, pw, ph); ctx.restore(); }); }
    const gr = ctx.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(0,0,0,0.15)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0.2)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    bigText(ctx, ls, H * 0.5, colors, W - 140);
  } else if (/攻略|长图/.test(f) && imgs.length >= 4) { // 攻略：上大字区 + 下 2×2
    ctx.fillStyle = colors[0] === '#FFFFFF' ? '#C8102E' : colors[0]; ctx.fillRect(0, 0, W, 520);
    const cw = (W - g) / 2, ch = (H - 520 - g) / 2;
    for (let i = 0; i < 4; i++) fit(ctx, imgs[i], (i % 2) * (cw + g), 520 + g + Math.floor(i / 2) * (ch + g) - g, cw, ch);
    bigText(ctx, ls, 280, ['rgba(0,0,0,0)', colors[0] === '#FFFFFF' ? '#FFFFFF' : '#111111'], W - 120);
  } else { // 拼图：上 1 大 + 下 2 小（≥5 张时下 3 小），大字压在中缝
    const topH = Math.round(H * 0.6); fit(ctx, imgs[0], 0, 0, W, topH);
    const n = imgs.length >= 5 ? 3 : 2, bw = (W - g * (n - 1)) / n;
    for (let i = 0; i < n; i++) fit(ctx, imgs[1 + i], i * (bw + g), topH + g, bw, H - topH - g);
    const gr = ctx.createLinearGradient(0, topH - 380, 0, topH + 120); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = gr; ctx.fillRect(0, topH - 380, W, 500);
    bigText(ctx, ls, topH - 40, colors, W - 120);
  }
  if (tag) pill(ctx, tag, 40, 44);
  return cv.encode('jpeg', 88);
}
module.exports = { render, ok: () => !!lib(), error: () => err };
