/* 群消息解析：把同事发在群里的「小红书 / 点评 / 携程 / 微信」分享文本，拆成一条条笔记
 * 插件（群消息登记）和飞书群机器人共用同一份规则
 */
(function (root) {
  'use strict';
  const URL_RE = /https?:\/\/[^\s<>"'，。！？、；）)】\]]+/g;
  const kindOf = u => /xhslink\.(cn|com)|xiaohongshu\.com\/(explore|discovery)/i.test(u) ? 'xhs'
    : /dpurl\.cn|dianping\.com/i.test(u) ? 'dp'
      : /ctrip\.com|trip\.com/i.test(u) ? 'ctrip'
        : /mp\.weixin\.qq\.com|channels\.weixin|weixin\.qq\.com/i.test(u) ? 'wx' : 'other';

  const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[.…。]+$/, '').replace(/[^\p{L}\p{N}]/gu, '');
  function dice(a, b) {
    if (!a || !b) return 0; if (a === b) return 1;
    if (a.length >= 6 && (b.startsWith(a) || a.startsWith(b))) return 0.95;
    if (a.length >= 6 && (b.includes(a) || a.includes(b))) return 0.9;
    if (a.length < 2 || b.length < 2) return 0;
    const m = new Map(); for (let i = 0; i < a.length - 1; i++) { const g = a.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); }
    let inter = 0; for (let i = 0; i < b.length - 1; i++) { const g = b.slice(i, i + 2); const n = m.get(g); if (n) { inter++; m.set(g, n - 1); } }
    return (2 * inter) / (a.length + b.length - 2);
  }

  // 链接前面那段文字 → 标题
  const PREFIX = /^(?:[-–—\s]*)(?:小红书|点评|大众点评|携程|微信|公众号|视频号|xhs|dp)\s*[:：]?\s*/i;
  function cleanLabel(s) {
    let t = String(s || '').replace(/来自【[^】]*】的分享/g, '').replace(/【([^】]*)】\s*来自【[^】]*】的分享/g, '$1').trim();
    t = t.replace(PREFIX, '').replace(/^[【\[]|[】\]]$/g, '').trim();
    return t;
  }
  function xhsTitle(label) { // 「标题 正文开头...」→ 标题
    let t = cleanLabel(label);
    const m = t.match(/^(.*\S)\s+\S[^\s]*?(?:\.\.\.|…)+\s*$/); if (m && norm(m[1]).length >= 4) t = m[1];
    return t.replace(/(?:\.\.\.|…)+\s*$/, '').trim();
  }

  function parse(text) {
    const src = String(text || '').replace(/\r/g, '');
    const items = [];
    let m; URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(src))) {
      const url = m[0].replace(/[.,;:]+$/, ''); const pos = m.index; const kind = kindOf(url);
      if (kind === 'other') continue;
      const ls = src.lastIndexOf('\n', pos - 1) + 1; let before = src.slice(ls, pos);
      const shareFrom = (before.match(/来自【([^】]+)】的分享/) || src.slice(pos, src.indexOf('\n', pos) < 0 ? src.length : src.indexOf('\n', pos)).match(/来自【([^】]+)】的分享/) || [])[1] || '';
      let label = kind === 'xhs' ? xhsTitle(before) : cleanLabel(before);
      if (norm(label).length < 4) { // 本行没有标题：往上找最近一行文字
        const lines = src.slice(0, ls).split('\n').map(x => x.trim()).filter(Boolean);
        for (let i = lines.length - 1; i >= 0 && i >= lines.length - 2; i--) { const x = lines[i]; if (URL_RE.test(x)) { URL_RE.lastIndex = 0; break; } URL_RE.lastIndex = 0; const c = cleanLabel(x); if (norm(c).length >= 4 && !/^\d+$/.test(c) && c !== '-') { label = c; break; } }
        URL_RE.lastIndex = m.index + m[0].length;
      }
      // 【标题】来自【x】的分享 这种格式：标题在链接后面
      if (norm(label).length < 4) { const after = src.slice(pos + m[0].length, (src.indexOf('\n', pos) + 1 || src.length + 1) - 1); const a2 = after.match(/【([^】]{4,})】/); if (a2) label = a2[1]; }
      items.push({ kind, url, pos, label: label.slice(0, 80), shareFrom });
    }
    const codes = []; const CODE_RE = /(^|[^\d/=&?])(\d{16,20})(?!\d)/g;
    while ((m = CODE_RE.exec(src))) { const p = m.index + m[1].length; if (items.some(it => p >= it.pos && p < it.pos + it.url.length)) continue; codes.push({ code: m[2], pos: p }); }

    // 消息分段：飞书复制多条消息时，中间会有「昨天 12:11」这种时间行
    const seps = []; { const TL = /(^|\n)\s*(?:昨天|今天|前天|星期.|周.|\d{1,2}月\d{1,2}日|\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?)?\s*\d{1,2}:\d{2}\s*(?=\n|$)/g; let t; while ((t = TL.exec(src))) seps.push(t.index); }
    const blockOf = pos => seps.filter(x => x < pos).length;
    // 以小红书链接为主干分条；没有小红书链接的，按标题聚成一条
    const posts = items.filter(it => it.kind === 'xhs').map(it => ({ title: it.label, xhs: it.url, pos: it.pos, links: [] }));
    const rest = items.filter(it => it.kind !== 'xhs');
    for (const it of rest) {
      let best = null, bs = 0; const ln = norm(it.label);
      for (const p of posts) { const s = dice(ln, norm(p.title)); if (s > bs) { bs = s; best = p; } }
      if (!best || bs < 0.6) { // 标题对不上：同标题的其他平台链接自成一条，否则挂到位置最近的那条
        const twin = posts.find(p => !p.xhs && dice(ln, norm(p.title)) >= 0.6);
        if (twin) best = twin;
        else if (ln.length >= 4 && posts.every(p => dice(ln, norm(p.title)) < 0.3) && !posts.some(p => Math.abs(p.pos - it.pos) < 400)) { best = { title: it.label, xhs: '', pos: it.pos, links: [] }; posts.push(best); }
        else {
          const blk = blockOf(it.pos), has = p => p.links.some(l => l.kind === it.kind);
          const pool = [posts.filter(p => blockOf(p.pos) === blk && !has(p)), posts.filter(p => blockOf(p.pos) === blk), posts.filter(p => !has(p)), posts].find(x => x.length);
          best = pool && pool.slice().sort((a, b) => Math.abs(a.pos - it.pos) - Math.abs(b.pos - it.pos))[0];
        }
      }
      if (best) best.links.push(it);
    }
    for (const c of codes) { const p = posts.filter(x => x.xhs && x.pos < c.pos).sort((a, b) => b.pos - a.pos)[0] || posts.slice().sort((a, b) => Math.abs(a.pos - c.pos) - Math.abs(b.pos - c.pos))[0]; if (p && !p.code) p.code = c.code; }

    return posts.sort((a, b) => a.pos - b.pos).map(p => {
      const by = k => (p.links.find(l => l.kind === k) || {});
      const full = [by('ctrip').label, by('dp').label, by('wx').label].find(x => x && norm(x).length >= norm(p.title).length && dice(norm(x), norm(p.title)) >= 0.6);
      const title = (full || p.title || by('ctrip').label || by('dp').label || '').trim();
      const text = [title, ...p.links.map(l => l.label)].join(' ');
      return { title, xhs: p.xhs, code: p.code || '', dp: by('dp').url || '', ctrip: by('ctrip').url || '', wx: by('wx').url || '', dpAccount: by('dp').shareFrom || '', city: cityOf(text), store: storeOf(text), type: typeOf(title) };
    });
  }

  const CITY = [['惠州', /惠州|惠城|水东街|惠阳|博罗/], ['深圳', /深圳|南山|福田|罗湖|宝安|华强北|前海|白石洲|蛇口|花园城/], ['广州', /广州|江南西|陈家祠|天河|越秀|海珠|荔湾/], ['珠海', /珠海|玖洲道|玖州道|香洲|横琴|拱北/], ['佛山', /佛山|南海|千灯湖|顺德|禅城|创产/], ['东莞', /东莞|33小镇/]];
  const STORE = [['水东街', /水东街/], ['华强北', /华强北/], ['前海', /前海|HOP/i], ['白石洲', /白石洲/], ['江南西', /江南西/], ['玖洲道', /玖洲道|玖州道/], ['千灯湖', /千灯湖|灯湖/], ['创产', /创产|创意产业园/], ['33小镇', /33小镇/], ['陈家祠', /陈家祠/], ['花园城', /花园城|蛇口/]];
  const cityOf = t => (CITY.find(([, re]) => re.test(t)) || [''])[0];
  const storeOf = t => (STORE.find(([, re]) => re.test(t)) || [''])[0];
  const typeOf = t => /有无|有没有|求推荐|求问|吗[？?]?$|哪家|推荐一下|请教|赐教/.test(t) ? '询问帖' : /攻略|合集|清单|路线|\d+家|几家|整理|必吃|逛吃|带路|天\d*夜/.test(t) ? '逛吃帖' : '';

  // 在选项里找最接近的（单选字段只写已有选项）
  function optionFor(hint, options) { if (!hint || !options || !options.length) return ''; const h = norm(hint); return options.find(o => norm(o) === h) || options.find(o => norm(o).includes(h) || h.includes(norm(o))) || ''; }
  const xhsKey = u => { const s = String(u || ''); const a = s.match(/xhslink\.(?:cn|com)\/(?:o\/|a\/|m\/)?([A-Za-z0-9]+)/i); if (a) return 'l:' + a[1]; const b = s.match(/(?:explore|discovery\/item|item)\/([0-9a-f]{24})/i); return b ? 'n:' + b[1] : ''; };

  const api = { parse, norm, dice, cityOf, storeOf, typeOf, optionFor, xhsKey, kindOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PostParse = api;
})(typeof window !== 'undefined' ? window : globalThis);
