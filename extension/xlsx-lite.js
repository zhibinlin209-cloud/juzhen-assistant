/* 极简 Excel (.xlsx) 读写，无需第三方库。
 * 写：XlsxLite.build([{ name, rows, widths, merges, heights, styled, freeze }]) → Uint8Array
 *   rows 里的单元格可以是值，或 { v: 值, s: 样式名 }；样式名见 STYLES
 *   styled=false（默认）时：第一行表头加粗、其余自动换行、冻结首行
 * 读：await XlsxLite.read(ArrayBuffer) → [{ name, rows: [[...]] }]
 */
(function (root) {
  'use strict';
  const enc = new TextEncoder();
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  function zip(files) { // 不压缩的 zip
    const parts = []; const central = []; let offset = 0;
    files.forEach(f => {
      const name = enc.encode(f.name); const data = f.data; const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0)); let pos = 0;
    all.forEach(p => { out.set(p, pos); pos += p.length; });
    return out;
  }

  // ---------- 样式 ----------
  // [字体, 填充, 边框, 对齐]
  const FONT = '<name val="Microsoft YaHei"/><family val="2"/><charset val="134"/>';
  const FONTS = [
    `<font><sz val="11"/>${FONT}</font>`,                                   // 0 普通 11
    `<font><b/><sz val="11"/>${FONT}</font>`,                               // 1 粗 11
    `<font><b/><sz val="16"/><color rgb="FFFFFFFF"/>${FONT}</font>`,        // 2 标题
    `<font><sz val="10"/><color rgb="FF1F1F1F"/>${FONT}</font>`,            // 3 说明
    `<font><b/><sz val="12"/><color rgb="FFFFFFFF"/>${FONT}</font>`,        // 4 章节
    `<font><b/><sz val="10"/><color rgb="FF1F1F1F"/>${FONT}</font>`,        // 5 表头/结论
    `<font><sz val="10"/>${FONT}</font>`                                    // 6 正文 10
  ];
  const fill = rgb => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
  const FILLS = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>',
    fill('FFE2EDF5'), fill('FF1F4E78'), fill('FFD9EAF7'), fill('FF4472C4'), fill('FFD9E2F3'), fill('FFE2F0D9'), fill('FFFCE4D6')];
  const THIN = '<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>';
  const BORDERS = ['<border><left/><right/><top/><bottom/><diagonal/></border>', THIN];
  const STYLES = { // name: [font, fill, border, h, v]
    plain: [0, 0, 0, null, null],
    legacyHead: [1, 2, 0, null, null],
    legacyCell: [0, 0, 0, null, 'top'],
    title: [2, 3, 0, 'center', 'center'],
    note: [3, 4, 0, 'left', 'center'],
    section: [4, 5, 0, 'left', 'center'],
    head: [5, 6, 1, 'center', 'center'],
    cell: [6, 0, 1, null, 'top'],
    num: [6, 0, 1, 'center', 'top'],
    final: [5, 7, 1, null, 'top'],
    warn: [6, 8, 1, null, 'top']
  };
  const STYLE_IDX = {}; Object.keys(STYLES).forEach((k, i) => { STYLE_IDX[k] = i; });
  function stylesXml() {
    const xfs = Object.values(STYLES).map(([f, fi, b, h, v]) => {
      const al = (h || v) ? `<alignment${h ? ` horizontal="${h}"` : ''}${v ? ` vertical="${v}"` : ''} wrapText="1"/>` : '';
      return `<xf numFmtId="0" fontId="${f}" fillId="${fi}" borderId="${b}" xfId="0" applyFont="1" applyFill="1" applyBorder="1"${al ? ' applyAlignment="1">' + al + '</xf>' : '/>'}`;
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="${FONTS.length}">${FONTS.join('')}</fonts><fills count="${FILLS.length}">${FILLS.join('')}</fills><borders count="${BORDERS.length}">${BORDERS.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }

  const esc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function col(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function sheetXml(sh) {
    const rows = sh.rows || [];
    const widths = sh.widths || [];
    const styled = !!sh.styled;
    const freeze = sh.freeze !== undefined ? sh.freeze : !styled;
    const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const body = rows.map((r, ri) => {
      const ht = sh.heights && sh.heights[ri] ? ` ht="${sh.heights[ri]}" customHeight="1"` : '';
      return `<row r="${ri + 1}"${ht}>${(r || []).map((cell, ci) => {
        const ref = col(ci) + (ri + 1);
        let v = cell, sName = null;
        if (cell && typeof cell === 'object' && !Array.isArray(cell)) { v = cell.v; sName = cell.s || null; }
        if (!sName) sName = styled ? 'cell' : (ri === 0 ? 'legacyHead' : 'legacyCell');
        const s = ` s="${STYLE_IDX[sName] !== undefined ? STYLE_IDX[sName] : 0}"`;
        if (v === null || v === undefined || v === '') return `<c r="${ref}"${s}/>`;
        if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
        return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${esc(String(v).slice(0, 32000))}</t></is></c>`;
      }).join('')}</row>`;
    }).join('');
    const merges = (sh.merges || []).length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0">${freeze && rows.length > 1 ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ''}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="16"/>${cols}<sheetData>${body}</sheetData>${merges}<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  }
  function build(sheets) {
    const names = []; sheets.forEach((s, i) => { let n = String(s.name || 'Sheet' + (i + 1)).replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31); while (names.includes(n)) n = n.slice(0, 28) + '_' + i; names.push(n); });
    const files = [
      ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
      ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ['xl/styles.xml', stylesXml()]
    ];
    sheets.forEach((s, i) => files.push([`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]));
    return zip(files.map(([name, xml]) => ({ name, data: enc.encode(xml) })));
  }

  // ---------- 读取 ----------
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(buf) {
    const u8 = new Uint8Array(buf); const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('不是有效的 Excel 文件');
    const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    const out = {}; const dec = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      const lnlen = dv.getUint16(lho + 26, true), lxlen = dv.getUint16(lho + 28, true);
      const data = u8.subarray(lho + 30 + lnlen + lxlen, lho + 30 + lnlen + lxlen + csize);
      out[name] = { method, data };
      p += 46 + nlen + xlen + clen;
    }
    return {
      async text(name) {
        const f = out[name] || out[Object.keys(out).find(k => k.toLowerCase() === name.toLowerCase())]; if (!f) return null;
        const raw = f.method === 0 ? f.data : await inflateRaw(f.data);
        // 去掉 BOM 和标签上的命名空间前缀（如 <x:row>），方便统一解析
        return dec.decode(raw).replace(/^﻿/, '').replace(/<(\/?)[A-Za-z][\w.-]*:(?=[A-Za-z])/g, '<$1');
      },
      names: Object.keys(out)
    };
  }
  const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
  const tText = xml => { const m = xml.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []; return m.map(x => unesc(x.replace(/<t[^>]*>|<\/t>/g, ''))).join(''); };
  function colIdx(ref) { const m = ref.match(/^([A-Z]+)/); let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }
  async function read(buf) {
    const z = await unzip(buf);
    const wb = await z.text('xl/workbook.xml') || '';
    const rels = await z.text('xl/_rels/workbook.xml.rels') || '';
    const relMap = {}; (rels.match(/<Relationship\b[^>]*>/g) || []).forEach(r => { const id = (r.match(/Id="([^"]+)"/) || [])[1]; const t = (r.match(/Target="([^"]+)"/) || [])[1]; if (id && t) relMap[id] = t.replace(/^\/?xl\//, '').replace(/^\//, ''); });
    const ssXml = await z.text('xl/sharedStrings.xml') || '';
    const ss = (ssXml.match(/<si>[\s\S]*?<\/si>/g) || []).map(tText);
    const sheets = [];
    for (const tag of (wb.match(/<sheet\b[^>]*>/g) || [])) {
      const name = unesc((tag.match(/name="([^"]*)"/) || [])[1] || '');
      const rid = (tag.match(/r:id="([^"]+)"/) || [])[1];
      const path = 'xl/' + (relMap[rid] || '');
      const xml = await z.text(path); if (!xml) continue;
      const rows = [];
      (xml.match(/<row\b[\s\S]*?<\/row>|<row\b[^>]*\/>/g) || []).forEach(rx => {
        const rn = +((rx.match(/<row\b[^>]*\br="(\d+)"/) || [])[1] || rows.length + 1) - 1;
        const row = [];
        (rx.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) || []).forEach(cx => {
          const ref = (cx.match(/\br="([A-Z]+\d+)"/) || [])[1];
          const t = (cx.match(/\bt="([^"]+)"/) || [])[1];
          const ci = ref ? colIdx(ref) : row.length;
          let v = null;
          if (t === 's') { const m = cx.match(/<v>([\s\S]*?)<\/v>/); v = m ? ss[+m[1]] : ''; }
          else if (t === 'inlineStr') v = tText(cx);
          else { const m = cx.match(/<v>([\s\S]*?)<\/v>/); if (m) { v = unesc(m[1]); if (t !== 'str' && t !== 'e' && t !== 'b' && /^-?\d+(\.\d+)?(E[-+]?\d+)?$/i.test(v)) v = +v; } }
          row[ci] = v;
        });
        rows[rn] = row;
      });
      for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
      sheets.push({ name, rows });
    }
    return sheets;
  }

  const api = { build, read, STYLES: Object.keys(STYLES) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.XlsxLite = api;
})(typeof window !== 'undefined' ? window : globalThis);
