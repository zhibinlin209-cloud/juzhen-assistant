/* 极简 docx 写出（不依赖第三方包）：标题、正文段落、缩进段落、灰色小字
 * blocks: [{ h: 1|2, text } | { p: text, indent?: 1, small?: true, bold?: true, color?: '888888' }]
 */
'use strict';
const { zip } = require('./xlsxwrite');
const esc = s => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function run(text, o) {
  const rp = [o.bold ? '<w:b/>' : '', o.color ? `<w:color w:val="${o.color}"/>` : '', o.small ? '<w:sz w:val="18"/>' : ''].join('');
  return String(text).split('\n').map((t, i) => (i ? '<w:r><w:br/></w:r>' : '') + `<w:r>${rp ? `<w:rPr>${rp}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`).join('');
}
function para(b) {
  if (b.h) return `<w:p><w:pPr><w:pStyle w:val="Heading${b.h}"/></w:pPr>${run(b.text, {})}</w:p>`;
  const ppr = `<w:pPr><w:spacing w:after="${b.small ? 40 : 80}"/>${b.indent ? `<w:ind w:left="${480 * b.indent}"/>` : ''}</w:pPr>`;
  const runs = Array.isArray(b.runs) ? b.runs.map(r => run(r.text, r)).join('') : run(b.p, b);
  return `<w:p>${ppr}${runs}</w:p>`;
}
function writeDocx(blocks) {
  const body = blocks.map(para).join('');
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1200" w:right="1100" w:bottom="1200" w:left="1100" w:header="600" w:footer="600" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const font = '<w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:cs="Microsoft YaHei"/>';
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr>${font}<w:sz w:val="21"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="34"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="27"/></w:rPr></w:style></w:styles>`;
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const drels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  return zip([{ name: '[Content_Types].xml', data: ct }, { name: '_rels/.rels', data: rels }, { name: 'word/document.xml', data: doc }, { name: 'word/styles.xml', data: styles }, { name: 'word/_rels/document.xml.rels', data: drels }]);
}
module.exports = { writeDocx };
