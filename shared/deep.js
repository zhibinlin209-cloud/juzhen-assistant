/* 深度洞察（AI）：逐条提取 产品/菜品 · 吸引因素 · 场景 · 客群 · 阻碍 → 按品牌汇总 → 品牌画像 / 机会点 / 选题清单
 * 依赖：AI、Industries、Core(parseCount)
 */
(function (root) {
  'use strict';
  const num = v => (typeof v === 'number' ? v : (root.Core ? root.Core.parseCount(v) : parseFloat(v)) || 0);
  const clean = s => String(s || '').replace(/\[[^\]]{1,8}\]/g, '').replace(/@\S+/g, '').replace(/\s+/g, ' ').trim();

  // ---------- 维度（可按行业覆盖） ----------
  const BASE = {
    motives: ['招牌/特色产品', '口碑/朋友推荐', '网上种草/打卡', '价格/团购划算', '环境氛围/颜值', '正宗/地道/老字号', '服务好', '位置方便', '新店/新品尝鲜', '性价比高'],
    scenes: ['朋友聚会', '家庭/带娃', '情侣约会', '一个人', '商务/请客', '节日/生日', '旅游打卡', '下班/周末放松'],
    personas: ['本地人/老顾客', '外地游客', '学生', '上班族', '宝妈/家庭', '情侣', '中老年', '网红打卡族'],
    barriers: ['排队/等太久', '价格贵', '名不副实/失望', '服务差', '品质差/不新鲜', '环境差', '太远/难找', '卫生问题', '推销/套路']
  };
  const OVERRIDE = {
    food: { scenes: ['朋友聚餐', '家庭聚餐/带娃', '情侣约会', '一个人吃', '商务宴请', '夜宵', '早茶/下午茶', '旅游打卡', '生日/节日', '工作日简餐'], motives: ['招牌菜/特色菜', '口碑/朋友推荐', '网上种草/打卡', '价格/团购划算', '环境氛围', '正宗/地道/老字号', '新鲜/现做/锅气', '服务好', '位置方便', '性价比高'] },
    drink: { scenes: ['上班提神', '下午茶', '逛街顺路', '办公/学习', '朋友小聚', '约会', '打卡拍照'] },
    bakery: { scenes: ['早餐', '下午茶', '生日/纪念日', '送礼', '囤货', '打卡拍照'] },
    beauty: { motives: ['技术/作品好', '口碑/朋友推荐', '网上种草', '价格/团购划算', '不推销', '环境舒适', '离家近', '新款/新项目'], scenes: ['日常保养', '约会/拍照前', '节日/婚礼前', '换季/换造型'] },
    medical: { motives: ['医生专业', '口碑推荐', '价格透明', '效果自然', '机构正规', '服务细致'], scenes: ['日常护理', '重要场合前', '问题修复'] },
    fitness: { motives: ['教练专业', '器械/场地好', '价格/次卡灵活', '离家/公司近', '氛围好', '不推销', '课程丰富'], scenes: ['减脂', '增肌', '塑形', '康复', '社交运动'] },
    edu: { motives: ['老师专业耐心', '口碑推荐', '孩子喜欢', '效果/进步', '离家近', '价格合理', '小班'], personas: ['宝妈', '宝爸', '老人接送', '学生本人'], scenes: ['兴趣培养', '升学提分', '假期班', '托管'] },
    hotel: { scenes: ['周末度假', '旅游住宿', '亲子出游', '情侣/纪念日', '出差', '团建'], motives: ['景观/位置好', '干净舒适', '设计/拍照好看', '价格划算', '服务好', '亲子/宠物友好'] },
    leisure: { scenes: ['朋友聚会', '团建', '约会', '生日', '下班放松'], motives: ['好玩/沉浸', 'DM/技师好', '口碑推荐', '价格/团购', '环境好', '新本/新项目'] }
  };
  function dims(pack) { const o = OVERRIDE[pack] || {}; return { motives: o.motives || BASE.motives, scenes: o.scenes || BASE.scenes, personas: o.personas || BASE.personas, barriers: o.barriers || BASE.barriers }; }
  const PREFIX = { motives: 'M', scenes: 'S', personas: 'P', barriers: 'B' };

  // ---------- 条目 ----------
  function items(run, cap) {
    const byId = {}; run.posts.forEach(p => { byId[p.id] = p; });
    const out = [];
    run.posts.forEach(p => { const t = clean([p.title, p.desc].filter(Boolean).join('。')); if (t.length >= 8) out.push({ t: t.slice(0, 400), g: p.group || '', l: num(p.likes), src: '帖子', post: p.id }); });
    run.comments.forEach(c => { let t = clean(c.text); if (t.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').length < 4) return; t = t.slice(0, 220); if (c.stars) t += `（${c.stars}星）`; if ((c.dishes || []).length) t += `（喜欢的菜：${c.dishes.slice(0, 6).join('、')}）`; out.push({ t, g: c.group || (byId[c.postId] || {}).group || '', l: num(c.likes), src: c.platform === 'dianping' ? '点评' : '评论', post: c.postId }); });
    const seen = new Set(); let list = out.filter(x => { const k = x.g + "|" + x.t.slice(0, 40); if (seen.has(k)) return false; seen.add(k); return true; });
    if (cap && list.length > cap) list = list.sort((a, b) => (b.src === '帖子') - (a.src === '帖子') || Math.log2(1 + b.l) + Math.min(b.t.length, 80) / 20 - Math.log2(1 + a.l) - Math.min(a.t.length, 80) / 20).slice(0, cap);
    list.forEach((x, i) => { x.i = i + 1; });
    return list;
  }

  // ---------- 提示词 ----------
  function codeList(D) { return Object.entries(PREFIX).map(([k, p]) => `${({ motives: '吸引因素（为什么来/为什么选这家）', scenes: '消费场景', personas: '客群（谁在来）', barriers: '阻碍（不想来/不再来的原因）' })[k]}：${D[k].map((n, i) => `${p}${i + 1} ${n}`).join('；')}`).join('\n'); }
  function tagPrompt(o, D, batch) {
    return `你在分析「${o.topic}」（行业：${o.industry}）在${o.platform}上的帖子和评论，逐条提取信息。结果用来统计人数，宁缺毋滥，只标明确表达出来的，不要推测。

编号：
${codeList(D)}

每条输出一个对象（没有任何可提取内容的条目不要输出）：
- i：条目编号
- p：提到的具体${o.item}，每项 [名称, 方向, 细节]。名称用大家最常用的叫法（如"白切鸡""脆皮乳鸽"），不要"菜""海鲜""饮品"这类大类；方向 "+" 夸、"-" 批评、"0" 只提到；细节写顾客原意的具体点，≤10 字（如"皮爽肉滑""偏咸""分量小"）
- m / s / w / b：命中的吸引因素 / 场景 / 客群 / 阻碍编号
只输出 JSON 数组，例如：
[{"i":3,"p":[["白切鸡","+","皮爽肉滑"],["乳鸽","-","偏干"]],"m":["M1"],"s":["S1"]},{"i":5,"w":["P2"],"b":["B1"]}]

来自大众点评的条目末尾带（N星）和（喜欢的菜：…）：喜欢的菜是顾客自己勾选的推荐，算 "+"；1–2 星的评价通常有阻碍或批评，注意提取。

条目：
${batch.map(x => `[${x.i}] ${x.t}`).join('\n')}`;
  }
  function mergePrompt(names, item) {
    return `下面是顾客提到的${item}名称和次数。把指同一个${item}的不同叫法合并成一个标准名（用最常见、最完整的叫法）；不是具体${item}的（如"菜""东西""套餐"）标成 "删除"。
只输出 JSON 对象：{"原名":"标准名", ...}，每个原名都要出现。

${names.map(([n, c]) => `${n}（${c}）`).join('、')}`;
  }
  function synthPrompt(o, A) {
    const top = (arr, n) => arr.slice(0, n);
    const brands = A.brands;
    const fmtCnt = arr => arr.map(x => `${x.name}${x.n}`).join('、');
    return `你是${o.industry}行业的品牌营销顾问。下面是「${o.topic}」在${o.platform}上 ${A.total} 条帖子/评论/评价的结构化统计（数字是提到的条数）。${o.ourBrand ? `\n我们的品牌是「${o.ourBrand}」，其余是竞品。` : '\n这些都是竞品/市场样本，我们要找进入或做内容的机会。'}

【${o.item}榜】（名称｜提及｜好评｜差评｜被夸的点｜被吐槽的点｜主要来自）
${top(A.products, 25).map(p => `${p.name}｜${p.n}｜${p.pos}｜${p.neg}｜${p.posD.map(x => x[0]).join('、')}｜${p.negD.map(x => x[0]).join('、')}｜${Object.entries(p.byBrand).sort((a, b) => b[1].n - a[1].n).slice(0, 3).map(([b, v]) => `${b}${v.n}`).join(' ')}`).join('\n')}

【吸引因素】${fmtCnt(A.motives)}
【场景】${fmtCnt(A.scenes)}
【客群】${fmtCnt(A.personas)}
【阻碍】${fmtCnt(A.barriers)}
${brands.length > 1 ? `\n【分品牌】\n${brands.map(b => `${b.name}（${b.total} 条）：吸引=${fmtCnt(b.motives.slice(0, 4))}；阻碍=${fmtCnt(b.barriers.slice(0, 4))}；被夸最多的${o.item}=${b.topPos.map(x => x.name).join('、')}；被吐槽最多的${o.item}=${b.topNeg.map(x => x.name).join('、')}`).join('\n')}` : ''}
${o.needs ? `\n【顾客需求点】\n${o.needs}` : ''}

请输出：
1. summary：3 句话以内的核心结论（顾客为什么来、来了点什么、什么让他们犹豫）
2. brands：每个品牌一条（只有一个品牌也写），{name, positioning（一句话定位，顾客眼中它是什么）, signature（顾客公认的招牌，1–3 个）, strengths（2–3 条，带数字）, weaknesses（2–3 条，带数字）}
3. opportunities：4–6 个机会点 {title, evidence（引用上面的数字）, action（具体怎么做：产品/运营/内容）}${o.ourBrand ? `，站在「${o.ourBrand}」的角度：竞品被吐槽而我们可以做好的、我们的强项没被讲出来的、市场没人满足的需求` : '，找竞品共同的弱点和没被满足的需求'}
4. topics：10 个小红书/抖音选题 {title（≤20 字，能直接用）, angle（拍什么/写什么，一句话）, format（图文/视频）, basis（依据哪个数据）}
只根据给出的数据下结论，不编造。只输出 JSON：{"summary":"","brands":[],"opportunities":[],"topics":[]}`;
  }

  // ---------- 汇总 ----------
  function freq(arr, n) { const m = {}; arr.forEach(x => { if (x) m[x] = (m[x] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n); }
  const normName = s => String(s || '').replace(/[\s"“”'‘’「」【】]/g, '').replace(/^(他家的?|这家的?|那家的?|店里的?|招牌|必点的?)/, '').replace(/(们|啊|呀|哦)$/, '').trim();
  function quotesOf(list, n) { const s = list.slice().sort((a, b) => b.l - a.l || b.t.length - a.t.length); const u = []; s.forEach(x => { if (u.length < n && !u.some(v => v === x.t)) u.push(x.t.length > 90 ? x.t.slice(0, 90) + '…' : x.t); }); return u; }

  function aggregate(list, tags, D, alias) {
    alias = alias || {};
    const byI = {}; list.forEach(x => { byI[x.i] = x; });
    const P = new Map();
    const dimBuckets = {}; Object.keys(PREFIX).forEach(k => { dimBuckets[k] = D[k].map(name => ({ name, n: 0, items: [], byBrand: {} })); });
    const brandsSet = new Set(list.map(x => x.g).filter(Boolean));
    Object.entries(tags).forEach(([i, tg]) => {
      const x = byI[i]; if (!x) return;
      const seenP = new Set();
      (tg.p || []).forEach(arr => {
        if (!Array.isArray(arr)) return;
        let [name, dir, det] = arr; name = normName(name); if (!name || name.length < 2 || name.length > 14) return;
        if (alias[name] === '删除') return; name = alias[name] || name;
        const key = name + dir; if (seenP.has(key)) return; seenP.add(key);
        const p = P.get(name) || { name, n: 0, pos: 0, neg: 0, posD: [], negD: [], posQ: [], negQ: [], allQ: [], byBrand: {}, items: new Set() };
        if (!p.items.has(x.i)) { p.items.add(x.i); p.n++; p.allQ.push(x); const b = p.byBrand[x.g || '其他'] || (p.byBrand[x.g || '其他'] = { n: 0, pos: 0, neg: 0 }); b.n++; }
        const b = p.byBrand[x.g || '其他'];
        if (dir === '+') { p.pos++; b.pos++; if (det) p.posD.push(det); p.posQ.push(x); } else if (dir === '-') { p.neg++; b.neg++; if (det) p.negD.push(det); p.negQ.push(x); }
        P.set(name, p);
      });
      Object.entries(PREFIX).forEach(([k, pre]) => {
        const field = { motives: 'm', scenes: 's', personas: 'w', barriers: 'b' }[k];
        new Set(tg[field] || []).forEach(code => {
          const idx = parseInt(String(code).replace(pre, ''), 10) - 1; const bk = dimBuckets[k][idx]; if (!bk) return;
          bk.n++; bk.items.push(x); const g = x.g || '其他'; bk.byBrand[g] = (bk.byBrand[g] || 0) + 1;
        });
      });
    });
    // 名称包含关系的二次合并（如"乳鸽"并入"脆皮乳鸽"只在后者更常见时）
    let prods = [...P.values()].sort((a, b) => b.n - a.n);
    const merged = [];
    prods.forEach(p => {
      const host = merged.find(m => (m.name.includes(p.name) || p.name.includes(m.name)) && m.n >= p.n * 1.5 && Math.min(m.name.length, p.name.length) >= 2);
      if (host) { host.n += p.n; host.pos += p.pos; host.neg += p.neg; host.posD.push(...p.posD); host.negD.push(...p.negD); host.posQ.push(...p.posQ); host.negQ.push(...p.negQ); host.allQ.push(...p.allQ); Object.entries(p.byBrand).forEach(([g, v]) => { const hb = host.byBrand[g] || (host.byBrand[g] = { n: 0, pos: 0, neg: 0 }); hb.n += v.n; hb.pos += v.pos; hb.neg += v.neg; }); }
      else merged.push(p);
    });
    const products = merged.filter(p => p.n >= 2).map(p => ({ name: p.name, n: p.n, pos: p.pos, neg: p.neg, rate: p.pos + p.neg ? p.pos / (p.pos + p.neg) : null, posD: freq(p.posD, 5), negD: freq(p.negD, 4), posQ: quotesOf(p.posQ, 3), negQ: quotesOf(p.negQ, 3), anyQ: quotesOf(p.allQ, 2), byBrand: p.byBrand }))
      .sort((a, b) => b.n - a.n).slice(0, 40);
    const finish = k => dimBuckets[k].map(b => ({ name: b.name, n: b.n, byBrand: b.byBrand, q: quotesOf(b.items, 3) })).filter(b => b.n > 0).sort((a, b) => b.n - a.n);
    const A = { total: list.length, tagged: Object.keys(tags).length, products, motives: finish('motives'), scenes: finish('scenes'), personas: finish('personas'), barriers: finish('barriers') };
    // 分品牌
    const brandTotals = {}; list.forEach(x => { if (x.g) brandTotals[x.g] = (brandTotals[x.g] || 0) + 1; });
    A.brands = [...brandsSet].map(g => {
      const pick = arr => arr.map(b => ({ name: b.name, n: b.byBrand[g] || 0 })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
      const ps = products.filter(p => p.byBrand[g]);
      return { name: g, total: brandTotals[g] || 0, motives: pick(A.motives), barriers: pick(A.barriers), scenes: pick(A.scenes), personas: pick(A.personas),
        topPos: ps.filter(p => p.byBrand[g].pos > 0).sort((a, b) => b.byBrand[g].pos - a.byBrand[g].pos).slice(0, 5).map(p => ({ name: p.name, n: p.byBrand[g].pos })),
        topNeg: ps.filter(p => p.byBrand[g].neg > 0).sort((a, b) => b.byBrand[g].neg - a.byBrand[g].neg).slice(0, 5).map(p => ({ name: p.name, n: p.byBrand[g].neg })) };
    }).sort((a, b) => b.total - a.total);
    return A;
  }

  function validTags(arr, batch) {
    const ids = new Set(batch.map(x => x.i)); const out = {};
    (Array.isArray(arr) ? arr : []).forEach(o => { if (o && ids.has(+o.i)) out[+o.i] = { p: Array.isArray(o.p) ? o.p : [], m: o.m || [], s: o.s || [], w: o.w || [], b: o.b || [] }; });
    return out;
  }

  /** o: { run, pack, platform, topic, ourBrand, needsText, cap, onProgress, signal } */
  async function run(cfg, o) {
    const I = root.Industries; const pk = I.get(o.pack);
    const D = dims(o.pack);
    const list = items(o.run, o.cap || 2400);
    if (list.length < 10) throw new Error('帖子和评论太少，先多抓一些再做深度洞察');
    const batches = []; for (let i = 0; i < list.length; i += 90) batches.push(list.slice(i, i + 90));
    const total = batches.length + 2; let done = 0; const prog = () => o.onProgress && o.onProgress(done, total);
    const meta = { topic: o.topic, industry: pk.name, platform: o.platform, item: pk.item || '产品' };
    const tags = {}; let failed = 0; const work = batches.slice();
    prog();
    const worker = async () => {
      while (work.length) {
        const b = work.shift();
        try { Object.assign(tags, validTags(await root.AI.json(cfg, tagPrompt(meta, D, b), o.signal, { temperature: 0.1 }), b)); }
        catch (e) { if (o.signal && o.signal.aborted) throw e; if (/密钥|余额/.test(e.message)) throw e; failed++; }
        done++; prog();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    // 菜名合并
    const raw = {}; Object.values(tags).forEach(t => (t.p || []).forEach(a => { if (Array.isArray(a)) { const n = normName(a[0]); if (n) raw[n] = (raw[n] || 0) + 1; } }));
    const names = Object.entries(raw).sort((a, b) => b[1] - a[1]).slice(0, 120);
    let alias = {};
    if (names.length > 8) { try { alias = await root.AI.json(cfg, mergePrompt(names, meta.item), o.signal, { temperature: 0 }); if (!alias || typeof alias !== 'object' || Array.isArray(alias)) alias = {}; } catch (e) { if (o.signal && o.signal.aborted) throw e; alias = {}; } }
    done++; prog();
    const A = aggregate(list, tags, D, alias);
    let synth = null;
    try { synth = await root.AI.json(cfg, synthPrompt(Object.assign({}, meta, { ourBrand: o.ourBrand, needs: o.needsText }), A), o.signal, { temperature: 0.3 }); }
    catch (e) { if (o.signal && o.signal.aborted) throw e; synth = null; }
    done++; prog();
    return { at: new Date().toISOString(), ourBrand: o.ourBrand || '', item: meta.item, dims: D, agg: A, synth, failedBatches: failed, batches: batches.length };
  }

  /** AI 需求点 × 品牌：每个需求点里各品牌占比（按该品牌的评论量归一） */
  function needMatrix(needs, comments) {
    const totals = {}; comments.forEach(c => { if (c.group) totals[c.group] = (totals[c.group] || 0) + 1; });
    const groups = Object.keys(totals);
    if (groups.length < 2) return null;
    return needs.map(n => {
      const by = {}; (n.ci || []).forEach(ci => { const g = (comments[ci] || {}).group; if (g) by[g] = (by[g] || 0) + 1; });
      return { name: n.name, type: n.type, cells: groups.map(g => ({ g, n: by[g] || 0, rate: totals[g] ? (by[g] || 0) / totals[g] : 0 })) };
    });
  }

  const api = { dims, items, aggregate, run, needMatrix, tagPrompt, synthPrompt, BASE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Deep = api;
})(typeof window !== 'undefined' ? window : globalThis);
