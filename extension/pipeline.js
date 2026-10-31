/* 评价调研：数据读入 → Claude 建分类 → 逐条打标 → 统计 → Claude 写结论
 * 纯逻辑，不碰页面。window.Pipeline
 */
(function (root) {
  'use strict';

  // ---------- 固定的客流/场景维度（来自你们的模板） ----------
  const SEGMENTS = [
    { id: 'S1', name: '朋友/好友/同事聚餐', hint: '朋友、好友、同事、三五好友、聚餐、小聚、局' },
    { id: 'S2', name: '家庭/亲子', hint: '家人、全家、孩子、带娃、父母、长辈' },
    { id: 'S3', name: '双人消费', hint: '两个人、双人套餐、两位' },
    { id: 'S4', name: '情侣/约会', hint: '情侣、对象、男/女朋友、约会、老公老婆' },
    { id: 'S5', name: '晚上/夜宵', hint: '晚上、夜宵、宵夜、深夜、凌晨' },
    { id: 'S6', name: '外地游客/旅行客', hint: '来XX玩、旅游、游客、出差、住酒店、来都来了' },
    { id: 'S7', name: '团购/套餐驱动', hint: '团购、套餐、券、优惠、囤了' },
    { id: 'S8', name: '慕名/推荐/种草/打卡', hint: '网红、推荐、小红书、抖音、收藏、打卡、慕名、排名' },
    { id: 'S9', name: '排队/等位高峰', hint: '排队、等位、取号、人多' },
    { id: 'S10', name: '售罄/卖完', hint: '卖完、售罄、没有了、沽清' },
    { id: 'S11', name: '回头客/复购', hint: '二刷、又来、经常来、老顾客、第N次' }
  ];

  // ---------- 读入 ----------
  const clean = s => String(s === null || s === undefined ? '' : s).replace(/\[[^\]]{1,8}\]/g, '').replace(/\s+/g, ' ').trim();
  const num = v => { if (typeof v === 'number') return v; const s = String(v || '').replace(/,/g, '').trim(); const m = s.match(/([\d.]+)\s*(万|w|W|千|k|K)?/); if (!m) return 0; let n = parseFloat(m[1]); if (/万|w/i.test(m[2] || '')) n *= 1e4; else if (/千|k/i.test(m[2] || '')) n *= 1e3; return Math.round(n) || 0; };

  /** 扩展导出的调研数据 → 条目 */
  function fromExtension(data) {
    const items = [];
    const titles = {};
    (data.posts || []).forEach(p => {
      titles[p.id] = p.title || '';
      const t = clean([p.title, p.desc].filter(Boolean).join('。'));
      if (t.length >= 6) items.push({ t, l: num(p.likes), d: p.publishedText || '', src: '笔记', post: p.title || '' });
    });
    (data.comments || []).forEach(c => {
      const t = clean(c.text);
      if (t) items.push({ t, l: num(c.likes), d: c.date || '', src: '评论', post: titles[c.postId] || '' });
    });
    return { items, label: `${data.platform === 'douyin' ? '抖音' : '小红书'}「${data.keyword || ''}」${(data.posts || []).length} 篇帖子`, brand: data.keyword || '' };
  }

  /** 表格（二维数组）→ 自动识别列 */
  function guessColumns(rows) {
    let hr = 0;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const r = rows[i] || []; const strs = r.filter(v => typeof v === 'string' && v.trim() && v.length < 30);
      if (strs.length >= 2) { hr = i; break; }
    }
    const header = (rows[hr] || []).map(v => String(v === null || v === undefined ? '' : v).trim());
    const body = rows.slice(hr + 1).filter(r => r && r.some(v => v !== null && v !== undefined && String(v).trim()));
    const n = Math.max(header.length, ...body.slice(0, 50).map(r => r.length));
    const avgLen = c => { const s = body.slice(0, 200).map(r => String(r[c] === null || r[c] === undefined ? '' : r[c])); return s.reduce((a, x) => a + x.length, 0) / (s.length || 1); };
    const find = re => { for (let c = 0; c < n; c++) if (re.test(header[c] || '')) return c; return -1; };
    const NOT_TEXT = /时间|日期|星|分|编号|id|人|用户|昵称|回复|状态|类型|来源|门店|图片|链接/i;
    let text = find(/评价内容|评论内容|点评内容|评价正文|评论正文|内容|review|comment|text/i);
    if (text < 0) { for (let c = 0; c < n; c++) if (/评价|评论|点评/.test(header[c] || '') && !NOT_TEXT.test(header[c] || '')) { text = c; break; } }
    if (text < 0 || avgLen(text) < 8) { let best = -1, bl = 0; for (let c = 0; c < n; c++) { const l = avgLen(c); if (l > bl) { bl = l; best = c; } } text = best; }
    return {
      headerRow: hr, header: Array.from({ length: n }, (_, c) => header[c] || `第${c + 1}列`), count: body.length,
      text, date: find(/时间|日期|date|time/i), star: find(/星级|评分|分数|口味分|总分|star|rating/i), likes: find(/点赞|赞|有用|like/i), tag: find(/回头客|标签|tag/i)
    };
  }
  function fromTable(rows, map) {
    const body = rows.slice(map.headerRow + 1);
    const items = [];
    body.forEach(r => {
      if (!r) return;
      const t = clean(r[map.text]); if (!t) return;
      const it = { t, l: map.likes >= 0 ? num(r[map.likes]) : 0, d: map.date >= 0 ? excelDate(r[map.date]) : '', src: '评价', post: '' };
      if (map.star >= 0 && r[map.star] !== null && r[map.star] !== undefined) it.star = String(r[map.star]);
      if (map.tag >= 0 && r[map.tag]) it.tag = String(r[map.tag]);
      items.push(it);
    });
    return items;
  }
  function excelDate(v) {
    if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 10); }
    return String(v === null || v === undefined ? '' : v).trim();
  }
  function parseCSV(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',' || ch === '\t') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  function decodeText(buf) {
    const u = new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '');
    if ((u.match(/\uFFFD/g) || []).length > 3) { try { return new TextDecoder('gb18030').decode(buf); } catch (e) { return u; } }
    return u;
  }
  function fromPlain(text) {
    const parts = text.includes('\n\n') ? text.split(/\n\s*\n/) : text.split('\n');
    return parts.map(clean).filter(t => t.length >= 2).map(t => ({ t, l: 0, d: '', src: '评价', post: '' }));
  }

  /** 去重、去掉太短的；按价值排序后截取 */
  function prepare(items, cap) {
    const seen = new Set(); const out = [];
    items.forEach(it => {
      const k = it.t.replace(/[\s，。！？!?,.~～…]/g, '');
      if (k.length < 4 || seen.has(k)) return; seen.add(k); out.push(it);
    });
    const total = out.length;
    let picked = out;
    if (cap && out.length > cap) {
      const score = it => Math.log2(1 + it.l) * 3 + Math.min(it.t.length, 150) / 15;
      picked = out.slice().sort((a, b) => score(b) - score(a)).slice(0, cap);
    }
    picked.forEach((it, i) => { it.i = i + 1; });
    return { items: picked, total };
  }
  function dateRange(items) {
    const ds = items.map(it => it.d).map(d => { const m = String(d).match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null; }).filter(Boolean).sort();
    return ds.length ? { from: ds[0], to: ds[ds.length - 1] } : null;
  }

  // ---------- 提示词 ----------
  const cut = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
  function taxonomyPrompt(brand, menuHint, items) {
    const sample = items.slice().sort((a, b) => b.t.length - a.t.length).slice(0, 360).sort((a, b) => a.i - b.i);
    let body = ''; for (const it of sample) { const line = `${it.i}. ${cut(it.t, 160)}\n`; if (body.length + line.length > 60000) break; body += line; }
    return `你是餐饮品牌的顾客评价分析师。下面是「${brand}」的顾客评价/评论样本（共 ${items.length} 条，这里给出其中信息量最大的一部分）。${menuHint ? `\n门店招牌菜/菜单参考：${menuHint}` : ''}

请为后续"逐条打标签"建立一套分类：
1. products：顾客明确提到的具体菜品/产品。同一道菜的不同叫法合并（写进 alias）。最多 25 个，按提及多少从多到少。不要把"海鲜""菜品"这种大类当成菜。
2. praise：顾客反复描述的"具体好评点"，要具体到可以拍成视频的体验，例如"海鲜新鲜、鲜甜""爆膏/虾膏多""大只/饱满/肥美""锅气/现炒""酥脆/Q弹/嫩等口感""烟火气/热闹氛围""服务热情/上菜快"。不要"好吃""不错"这类空话。8–14 个。
3. complaints：顾客反复描述的"具体吐槽点"，例如"排队/等位""偏腻/重口""偏咸""价格偏贵/性价比一般""海鲜清洁/鲜度波动""售罄/卖完""环境热/通风""停车/交通""份量/菜量"。8–14 个。
每个 praise/complaints 给一句 hint 写判断标准。只根据下面评价里真实出现的内容来建，不要编。

只输出 JSON，格式：
{"products":[{"name":"爆膏奶油虾","alias":["奶油虾","爆膏虾"]}],"praise":[{"name":"海鲜新鲜、鲜甜","hint":"明确说海鲜/虾/蚝新鲜、鲜甜、鲜活"}],"complaints":[{"name":"排队/等位","hint":"提到排队、等位、等太久"}]}

评价：
${body}`;
  }
  function taxText(tax) {
    return [
      '产品：', ...tax.products.map(p => `${p.id} ${p.name}${p.alias && p.alias.length ? `（也叫：${p.alias.join('、')}）` : ''}`),
      '好评点：', ...tax.praise.map(p => `${p.id} ${p.name}${p.hint ? `：${p.hint}` : ''}`),
      '吐槽点：', ...tax.complaints.map(p => `${p.id} ${p.name}${p.hint ? `：${p.hint}` : ''}`),
      '客流/场景：', ...SEGMENTS.map(s => `${s.id} ${s.name}：${s.hint}`)
    ].join('\n');
  }
  function tagPrompt(brand, tax, batch) {
    return `你在给「${brand}」的顾客评价逐条打标签，结果会用来统计"多少条评价提到了某个点"，所以要准，宁缺毋滥。

可用编号：
${taxText(tax)}

每条输出一个对象：
- i：评价编号
- r：这条是否在评价这家店/这次消费体验。与店无关的闲聊、问账号、广告、纯表情、只有@人，记 0；否则记 1
- p：提到的产品，每项 [编号, 方向, 细节]。方向："+" 夸，"-" 批评，"0" 只提到没有评价。细节写顾客原意的具体点，≤12 字（如"虾膏多""底汁太咸""壳脆肉弹"）。列表里没有但顾客明确点名的菜，编号写 "新:菜名"
- g：命中的好评点编号；b：命中的吐槽点编号；s：命中的客流/场景编号
评价末尾如果有（喜欢的菜：…），那是顾客自己勾选的推荐菜，算作对这些菜的 "+"（细节可留空）。
只标顾客明确表达的内容，不要推测；同一条可以命中多个。r 为 0 时其他字段省略。空数组省略。

只输出 JSON 数组，例如：
[{"i":12,"r":1,"p":[["P1","+","虾膏多"],["P3","-","有沙"]],"g":["G2"],"b":["B5"],"s":["S1","S5"]},{"i":13,"r":0}]

评价：
${batch.map(it => `[${it.i}] ${cut(it.t, 300)}`).join('\n')}`;
  }

  // ---------- 统计 ----------
  const score = it => Math.log2(1 + (it.l || 0)) * 2 + Math.min(it.t.length, 120) / 20 + (it.t.length < 10 ? -3 : 0);
  function topQuotes(list, n) {
    const seen = new Set(); const out = [];
    list.slice().sort((a, b) => score(b) - score(a)).forEach(it => { const k = it.t.slice(0, 20); if (out.length < n && !seen.has(k)) { seen.add(k); out.push(cut(it.t, 110)); } });
    return out;
  }
  function freq(arr, n) { const m = {}; arr.forEach(x => { if (x) m[x] = (m[x] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n); }

  function aggregate(items, tags, tax) {
    const byI = {}; items.forEach(it => { byI[it.i] = it; });
    const tagged = items.filter(it => tags[it.i]);
    const rel = tagged.filter(it => tags[it.i].r !== 0);
    // 新菜名合并：和已有别名重合的并入
    const prodByKey = {}; const prods = tax.products.map(p => ({ id: p.id, name: p.name, alias: p.alias || [], pos: [], neg: [], men: [], posD: [], negD: [] }));
    prods.forEach(p => { [p.name, ...p.alias].forEach(a => { prodByKey[a] = p; }); prodByKey[p.id] = p; });
    const g = {}, b = {}, s = {};
    tax.praise.forEach(x => { g[x.id] = []; }); tax.complaints.forEach(x => { b[x.id] = []; }); SEGMENTS.forEach(x => { s[x.id] = []; });
    rel.forEach(it => {
      const tg = tags[it.i];
      const seenP = new Set();
      (tg.p || []).forEach(arr => {
        if (!Array.isArray(arr)) return;
        let [pid, dir, det] = arr; pid = String(pid || '');
        let p = prodByKey[pid];
        if (!p && /^新[:：]/.test(pid)) {
          const nm = pid.replace(/^新[:：]/, '').trim(); if (!nm) return;
          p = prodByKey[nm] || prods.find(x => x.name.includes(nm) || nm.includes(x.name));
          if (!p) { p = { id: 'N' + (prods.length + 1), name: nm, alias: [], pos: [], neg: [], men: [], posD: [], negD: [], isNew: true }; prods.push(p); prodByKey[nm] = p; }
        }
        if (!p) return;
        const key = p.id + dir;
        if (seenP.has(key)) return; seenP.add(key);
        if (!p.men.includes(it)) p.men.push(it);
        if (dir === '+') { p.pos.push(it); p.posD.push(det); } else if (dir === '-') { p.neg.push(it); p.negD.push(det); }
      });
      (tg.g || []).forEach(id => { if (g[id] && !g[id].includes(it)) g[id].push(it); });
      (tg.b || []).forEach(id => { if (b[id] && !b[id].includes(it)) b[id].push(it); });
      (tg.s || []).forEach(id => { if (s[id] && !s[id].includes(it)) s[id].push(it); });
      if (it.tag && /回头客/.test(it.tag) && !s.S11.includes(it)) s.S11.push(it);
    });
    const P = prods.map(p => ({ id: p.id, name: p.name, isNew: !!p.isNew, pos: p.pos.length, neg: p.neg.length, mention: p.men.length,
      posD: freq(p.posD, 8), negD: freq(p.negD, 6), posQ: topQuotes(p.pos, 5), negQ: topQuotes(p.neg, 4) }))
      .filter(p => p.mention > 0 && (!p.isNew || p.mention >= 3));
    const bucket = (defs, map) => defs.map(x => ({ id: x.id, name: x.name, count: map[x.id].length, q: topQuotes(map[x.id], 5) })).filter(x => x.count > 0).sort((a, b) => b.count - a.count);
    return {
      products: P,
      praise: bucket(tax.praise, g),
      complaints: bucket(tax.complaints, b),
      segments: SEGMENTS.map(x => ({ id: x.id, name: x.name, count: s[x.id].length, q: topQuotes(s[x.id], 4) })),
      totals: { analyzed: items.length, tagged: tagged.length, relevant: rel.length }
    };
  }
  function goodProducts(A) { return A.products.filter(p => p.pos >= 2).sort((a, b) => b.pos - a.pos).slice(0, 8); }
  function badProducts(A) { return A.products.filter(p => p.neg >= 2).sort((a, b) => b.neg - a.neg).slice(0, 6); }

  function writePrompt(brand, A, meta) {
    const G = goodProducts(A), B = badProducts(A);
    const qs = arr => arr.map(q => `「${q}」`).join(' ');
    const D = arr => arr.map(([d, n]) => `${d}×${n}`).join('、');
    return `你是餐饮品牌的营销与运营顾问。下面是「${brand}」${meta.relevant} 条有效顾客评价的统计结果（已逐条打标，数字是"命中评价数"，各类可交叉）。请按我们的《顾客评价调研模块》模板写结论。

要求：
- 只根据给出的数字、细节词和原话下结论，不编造没出现的事实；数字直接引用给出的。
- 写得具体、能落地：卖点要能拍，整改要能执行。语言简洁，像给老板和拍摄团队看的内部报告。
- evidence（代表性原话）只能从给出的原话里挑 1–3 句原样引用，用 “” 包起来，多句用 " / " 分隔。
- level（影响级别）只能是：严重、中度、轻中度、轻度。

【好评产品】（产品｜正向命中｜正向细节词｜原话）
${G.map(p => `${p.id} ${p.name}｜${p.pos}｜${D(p.posD)}｜${qs(p.posQ)}`).join('\n') || '无'}

【差评产品】（产品｜负向命中｜负向细节词｜原话）
${B.map(p => `${p.id} ${p.name}｜${p.neg}｜${D(p.negD)}｜${qs(p.negQ)}`).join('\n') || '无'}

【好评点】（编号 名称｜命中｜原话）
${A.praise.map(x => `${x.id} ${x.name}｜${x.count}｜${qs(x.q)}`).join('\n') || '无'}

【吐槽点】
${A.complaints.map(x => `${x.id} ${x.name}｜${x.count}｜${qs(x.q)}`).join('\n') || '无'}

【客流/场景】
${A.segments.map(x => `${x.id} ${x.name}｜${x.count}｜${qs(x.q)}`).join('\n')}

只输出 JSON，字段如下（数组按给出的顺序，用 id 对应）：
{
 "goodProducts":[{"id":"P1","praise":"顾客真正夸的点","evidence":"代表性原话","sell":"可提炼卖点（短语用 + 连接）","shoot":"拍摄重点（镜头顺序用 → 连接）"}],
 "badProducts":[{"id":"P1","issue":"具体问题","evidence":"代表性原话","essence":"问题本质","fix":"整改重点"}],
 "praise":[{"id":"G1","say":"顾客具体怎么说","judge":"需求判断","express":"内容表达（一句可直接用的内容角度）","shots":"必须拍到的证据镜头"}],
 "complaints":[{"id":"B1","show":"具体表现","cause":"归因","action":"整改动作","level":"严重"}],
 "content":[{"point":"核心卖点","evidence":"评价证据（带数字）","theme":"内容母题","shots":"建议镜头","fit":"适合菜品/场景"}],
 "segments":[{"id":"S1","feature":"评价里能明确看到的特征","evidence":"代表性证据","judge":"经营判断","insight":"内容/投放启示"}],
 "final":{"conclusion":"客流特征最终结论","support":"由哪些数字支持","model":"核心客流模型（用 → 串起来）","priority":"内容优先级与运营必须同步解决的问题"}
}
content 给 6 条，按重要性排序。segments 只写命中数 ≥ 3 的。`;
  }

  function validTax(t) {
    if (!t || !Array.isArray(t.products) || !Array.isArray(t.praise) || !Array.isArray(t.complaints)) return null;
    const pick = (arr, pre, max) => arr.filter(x => x && x.name).slice(0, max).map((x, i) => ({ id: pre + (i + 1), name: String(x.name).trim(), alias: Array.isArray(x.alias) ? x.alias.map(String).filter(Boolean).slice(0, 6) : [], hint: x.hint ? String(x.hint) : '' }));
    return { products: pick(t.products, 'P', 30), praise: pick(t.praise, 'G', 16), complaints: pick(t.complaints, 'B', 16) };
  }
  function validTags(arr, batch) {
    const ok = {}; const ids = new Set(batch.map(it => it.i));
    (Array.isArray(arr) ? arr : []).forEach(o => {
      if (!o || !ids.has(+o.i)) return;
      ok[+o.i] = { r: o.r === 0 ? 0 : 1, p: Array.isArray(o.p) ? o.p : [], g: Array.isArray(o.g) ? o.g : [], b: Array.isArray(o.b) ? o.b : [], s: Array.isArray(o.s) ? o.s : [] };
    });
    return ok;
  }

  const api = { SEGMENTS, fromExtension, guessColumns, fromTable, parseCSV, decodeText, fromPlain, prepare, dateRange, taxonomyPrompt, tagPrompt, aggregate, goodProducts, badProducts, writePrompt, validTax, validTags };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Pipeline = api;
})(typeof window !== 'undefined' ? window : globalThis);
