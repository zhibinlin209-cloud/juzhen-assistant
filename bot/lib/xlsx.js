/* 极简 xlsx 读取（不依赖第三方包）：读第一个工作表 → 二维数组 */
'use strict';
const zlib = require('zlib');

function unzip(buf) {
  // 找「中央目录结束」记录
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('不是 xlsx 文件');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const files = {};
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8');
    const lnl = buf.readUInt16LE(off + 26), lxl = buf.readUInt16LE(off + 28); const start = off + 30 + lnl + lxl;
    const data = buf.slice(start, start + csize);
    files[name] = () => method === 8 ? zlib.inflateRawSync(data) : data;
    p += 46 + nl + xl + cl;
  }
  return files;
}
const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
const colIdx = ref => { const m = ref.match(/^([A-Z]+)/); let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

function readXlsx(buf) {
  const f = unzip(buf);
  const ss = f['xl/sharedStrings.xml'] ? (f['xl/sharedStrings.xml']().toString('utf8').match(/<si>[\s\S]*?<\/si>/g) || []).map(si => unesc((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join(''))) : [];
  const sheetName = Object.keys(f).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheetName) throw new Error('xlsx 里没有工作表');
  const xml = f[sheetName]().toString('utf8'); const rows = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] || ''; const r = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1]; const t = (attrs.match(/\bt="(\w+)"/) || [])[1];
      let v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (t === 's') v = ss[+v]; else if (t === 'inlineStr') v = unesc((inner.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || ''); else if (v !== undefined) v = unesc(v);
      row[r ? colIdx(r) : row.length] = v === undefined ? '' : v;
    }
    rows.push(row);
  }
  return rows;
}
module.exports = { readXlsx, unzip };
