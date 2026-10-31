/* 顾客需求点挖掘（按行业）
 * 1) 不用 AI：评论拆短句 → 分成 不满/想要/疑问/吸引 → 按"通用 + 行业"需求主题归类 → 按提到人数排序
 * 2) 可选 AI：AI 先归纳需求点（含"顾客真正要什么、建议怎么做"），再逐句归类计数
 * 依赖：Industries、AI（可选）
 */
(function (root) {
  'use strict';
  const I = () => root.Industries;

  const TYPES = [
    { key: 'pain', name: '不满/痛点', short: '不满' },
    { key: 'wish', name: '想要/期待', short: '想要' },
    { key: 'ask', name: '疑问/顾虑', short: '疑问' },
    { key: 'love', name: '吸引点', short: '吸引' }
  ];
  const TYPE_NAME = { pain: '不满', wish: '想要', ask: '疑问', love: '吸引' };

  const WISH = /希望|要是|如果能|如果有|建议|能不能|能否|可不可以|可以.{0,8}吗|想要|好想|求开|求出|求个|什么时候(开|出|上|有|来)|快来|来.{0,4}开(个|家|店)|开(个|家)分店|开到|出个|再多|多点|多一点|加点|加个|改进|改善|最好(能|有|是)/;
  const PAIN = /难吃|难喝|一般般|很一般|不好(吃|喝|用|玩)|不新鲜|太贵|小贵|偏贵|贵了|不值|性价比(低|不高|一般)|太咸|太辣|太油|油腻|太腻|太甜|太淡|没味|太慢|好慢|很慢|等了|等太|排了|排队|太久|好久|人太多|太挤|很吵|太吵|脏|卫生|苍蝇|头发|蟑螂|态度(差|不好|很差|一般)|服务(差|不好|一般)|量少|缩水|变味|没以前|不如以前|失望|踩雷|踩坑|坑|劝退|后悔|再也不|不会再|差评|卖完|售罄|停车(难|贵|不方便)|不好停|太远|难找|找不到|太热|没空调|难约|订不到|不推荐|翻车|拉胯|拉垮|一言难尽|可惜|缺点|美中不足|推销|办卡|套路|没效果|效果(差|一般|不明显)|疼|隔音|起球|色差|掉色|剪坏|做坏|拖延|增项|加价|照骗/;
  const PAIN_TURN = /^(但是|但|不过|可惜|就是|唯一|只是|美中不足|缺点)/;
  const ASK = /[?？]|吗$|吗[，。!！ ~]|在哪|哪里|哪儿|哪家|哪个店|地址|怎么去|怎么走|多少钱|人均多少|贵吗|几点|营业到|开到几点|要排队|排队吗|要等|能预约|可以预约|能订|有没有|是不是|求问|请问|求推荐|求店名/;
  const LOVE = /不贵|好吃|好喝|好玩|好看|好用|好香|新鲜|入味|嫩|酥脆|分量足|量大|实惠|划算|性价比高|便宜|干净|热情|上菜快|氛围|烟火气|热闹|出片|好拍|回购|二刷|三刷|必点|必吃|必去|推荐|绝了|yyds|宝藏|惊艳|满足|值得|巴适|靠谱|正宗|专业|耐心|舒服|满意|效果好|技术好|手艺好|喜欢|沉浸|过瘾/;
  const QUESTION = /[?？]|吗|几点|要不要|有没有|是不是|多少|怎么|哪里|在哪|哪个|哪位|哪款|哪家|能不能.{0,6}(去|吃|带|做|用)/;
  const STRONG_PAIN = /难吃|太贵|太咸|太油|太辣|太慢|太久|太吵|太挤|太热|脏|失望|踩雷|劝退|后悔|再也不|不会再|拉肚子|态度差|推销|没效果/;

  const clean = s => String(s || '').replace(/\[[^\]]{1,8}\]/g, '').replace(/@\S+/g, '').replace(/#[^#\s]+/g, '').replace(/\s+/g, ' ').trim();
  const num = v => (typeof v === 'number' ? v : (root.Core ? root.Core.parseCount(v) : parseFloat(v)) || 0);

  function themeTypes(text, pack) {
    const t = new Set(); I().themes(pack).forEach(([type, , re, notRe]) => { if (re.test(text) && !(notRe && notRe.test(text))) t.add(type); }); return t;
  }
  function classify(text, pack) {
    if (WISH.test(text) && !/^(能不能|可不可以|可以).{0,8}(去|吃|带|停|做)/.test(text)) return 'wish';
    if (QUESTION.test(text) && !STRONG_PAIN.test(text)) return 'ask';
    const tt = themeTypes(text, pack || 'general');
    const painText = text.replace(/(不|没有|没|无|从不|一点都不|完全不)(推销|套路|办卡|贵|坑|踩雷|失望|脏|吵|疼|腻|咸)/g, '');
    if (/(不|没有|没|无|从不)(推销|套路|强推)/.test(text) && !PAIN.test(painText)) return 'love';
    if (PAIN.test(painText) || tt.has('pain') || (PAIN_TURN.test(text) && !LOVE.test(text))) return 'pain';
    if (ASK.test(text)) return 'ask';
    if (LOVE.test(text) || tt.has('love')) return 'love';
    return null;
  }
  /** 评论 → 有信息量的短句；keywords 里的品牌名替换成"这家"，避免干扰 */
  function clauses(comments, keywords, pack) {
    const kwParts = [].concat(keywords || []).join(' ').split(/\s+/).filter(x => x && x.length >= 2);
    const out = [];
    comments.forEach((c, ci) => {
      let text = clean(c.text);
      kwParts.forEach(k => { text = text.split(k).join('这家'); });
      if (text.length < 3) return;
      const parts = text.replace(/([？?！!。；;~～…\n])/g, '$1|').split(/[|，,、]/).map(s => s.trim()).filter(Boolean);
      parts.forEach(p => {
        const tx = p.replace(/^[\s\-—:：]+/, '');
        if (tx.replace(/[^一-龥a-zA-Z0-9]/g, '').length < 3) return;
        const type = classify(tx, pack);
        if (type) out.push({ ci, text: tx, type, likes: num(c.likes), full: clean(c.text), g: c.group || '' });
      });
    });
    return out;
  }

  // 餐饮：菜名 + 问题（如"奶油虾太咸"）
  const DISH_RE = /[一-龥]{0,4}(奶油虾|皮皮虾|濑尿虾|小龙虾|生蚝|花甲|扇贝|鲍鱼|螃蟹|膏蟹|肉蟹|鱿鱼|鱼|虾|蟹|蚝|螺|鸡|鸭|鹅|牛肉|牛河|炒饭|炒粉|米粉|河粉|面|粥|煲|锅|烧烤|串)/;
  const DISH_ISSUE = [['太咸', /咸/], ['太油腻', /油|腻/], ['太辣', /辣/], ['没膏/膏少', /没.{0,2}膏|膏少|没有膏/], ['有沙', /沙/], ['不新鲜', /不新鲜|臭|腥/], ['个头小', /小|不大/], ['凉了', /凉|冷/], ['不入味', /不入味|没味|淡/], ['一般/失望', /一般|失望|难吃|不好吃/]];
  const DISH_STOP = /^(这|那|一|很|太|的|了|吃|好|真|都|就|也|还|去|来|点|是|有|在|我|你|他|她|们|家|店|又|再|最|超|巨|挺|蛮|个|份)+/;
  function dishOf(text) { const m = text.match(DISH_RE); if (!m) return ''; return m[0].replace(DISH_STOP, ''); }

  function labelsOf(x, pack) {
    const out = [];
    if (pack === 'food') {
      const d = dishOf(x.text);
      if (d && x.type === 'pain') { const iss = DISH_ISSUE.find(([, re]) => re.test(x.text)); if (iss) out.push(`${d}${iss[0]}`); }
      if (d && x.type === 'love' && d.length >= 2) out.push(`${d}好评`);
    }
    I().themes(pack).forEach(([type, name, re, notRe]) => {
      if (type === x.type && re.test(x.text) && !(notRe && notRe.test(x.text)) && !out.includes(name)) out.push(name);
    });
    return out;
  }
  const quoteOf = x => (x.full.length > 90 ? x.full.slice(0, 90) + '…' : x.full);
  function topQuotes(ex, n) { const s = ex.slice().sort((a, b) => b.likes - a.likes || b.text.length - a.text.length); const u = []; s.forEach(x => { if (u.length < n && !u.some(v => v.full === x.full)) u.push(x); }); return u.map(quoteOf); }

  function group(cl, pack) {
    const groups = new Map(); const other = [];
    cl.forEach(x => {
      const labels = labelsOf(x, pack);
      if (!labels.length) { other.push(x); return; }
      labels.forEach(name => {
        const k = x.type + '|' + name; const g = groups.get(k) || { type: x.type, name, set: new Set(), ex: [] };
        g.set.add(x.ci); g.ex.push(x); groups.set(k, g);
      });
    });
    const needs = [...groups.values()].filter(g => g.set.size >= 2 || cl.length < 60)
      .map(g => ({ name: g.name, type: g.type, count: g.set.size, likes: g.ex.reduce((s, x) => s + x.likes, 0), quotes: topQuotes(g.ex, 5), ci: [...g.set] }))
      .sort((a, b) => b.count - a.count || b.likes - a.likes);
    const matched = new Set(); groups.forEach(g => g.set.forEach(ci => matched.add(ci)));
    const seen = new Set();
    const otherQ = other.filter(x => { const k = x.full.replace(/[。！~!？?]+$/, ''); if (matched.has(x.ci) || seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => b.likes - a.likes).slice(0, 40).map(x => ({ type: x.type, text: quoteOf(x), likes: x.likes }));
    return { needs, other: otherQ };
  }

  function ruleNeeds(comments, keywords, pack) {
    const cl = clauses(comments, keywords, pack);
    const g = group(cl, pack);
    const counts = {}; TYPES.forEach(t => { counts[t.key] = new Set(cl.filter(x => x.type === t.key).map(x => x.ci)).size; });
    return { mode: 'rule', pack, clauses: cl.length, comments: comments.length, counts, needs: g.needs, other: g.other };
  }

  // ---------- AI ----------
  function definePrompt(o, cl) {
    const pick = cl.slice().sort((a, b) => b.likes - a.likes || b.text.length - a.text.length).slice(0, 450);
    return `下面是在${o.platform}上调研「${o.topic}」（行业：${o.industry}）时，从帖子评论里拆出来的有信息量的短句（已分好类：不满/想要/疑问/吸引，括号里是点赞数）。
请归纳出顾客真正的需求点，最多 15 个，按重要性排序。要求：
- 需求点要具体、能直接指导营销或运营，例如"想提前知道要等多久""担心被推销办卡""想知道新手能不能跟上""希望有一个人也能点的小份"，不要"服务""价格"这种空泛大类。
- 不满、想要、疑问、吸引四类都要覆盖到（有的话）。
- insight 写顾客说这句话背后真正想要的东西；action 写我们具体可以怎么做（内容怎么拍/文案怎么写/运营怎么改），一句话；angle 写一个可以直接用的小红书/抖音选题标题（≤20 字）。
- summary 用 2–3 句话总结这批顾客最核心的需求。
只输出 JSON：{"summary":"...","needs":[{"name":"需求点","type":"不满|想要|疑问|吸引","insight":"...","action":"...","angle":"..."}]}

短句：
${pick.map((x, i) => `${i + 1}. [${TYPE_NAME[x.type]}] ${x.text.slice(0, 80)}${x.likes ? `（${x.likes}）` : ''}`).join('\n')}`;
  }
  function assignPrompt(needs, batch) {
    const tn = { pain: '不满', wish: '想要', ask: '疑问', love: '吸引' };
    return `判断每个短句表达了下面哪个需求点。结果用来统计人数，必须严格：
- 只有短句明确表达了这个需求点才算；只是话题相关、要靠推测的不算
- 注意类型要对得上：抱怨（如"XX很难吃""太贵了"）只能归到不满类，不能归到疑问类；真的在提问才归疑问类；夸奖归吸引类
- 一句话最多归 2 个需求点；哪个都不符合就不要输出这一句（大部分闲聊都应该跳过）
需求点：
${needs.map(n => `${n.id} [${tn[n.type] || ''}] ${n.name}`).join('\n')}

只输出 JSON 数组，例如 [{"i":3,"n":["N1"]},{"i":7,"n":["N2","N4"]}]

短句：
${batch.map(x => `[${x.i}] ${x.text.slice(0, 100)}`).join('\n')}`;
  }
  /** o: { comments, keywords, pack, platform:'小红书'|'抖音', topic, onProgress, signal } */
  async function aiNeeds(cfg, o) {
    const pack = o.pack || 'general';
    const cl = clauses(o.comments, o.keywords, pack).slice(0, 2500);
    if (cl.length < 5) throw new Error('有信息量的评论太少，AI 也归纳不出来');
    cl.forEach((x, i) => { x.i = i + 1; });
    const batches = []; for (let i = 0; i < cl.length; i += 200) batches.push(cl.slice(i, i + 200));
    const total = batches.length + 1; let done = 0; const prog = () => o.onProgress && o.onProgress(done, total);
    prog();
    const def = await root.AI.json(cfg, definePrompt({ platform: o.platform, topic: o.topic, industry: I().get(pack).name }, cl), o.signal);
    const needs = (def.needs || []).filter(n => n && n.name).slice(0, 15).map((n, i) => ({ id: 'N' + (i + 1), name: String(n.name), type: ({ 不满: 'pain', 想要: 'wish', 疑问: 'ask', 吸引: 'love' })[n.type] || 'pain', insight: n.insight || '', action: n.action || '', angle: n.angle || '', ci: new Set(), cl: [] }));
    if (!needs.length) throw new Error('AI 没有归纳出需求点，请再试一次');
    done++; prog();
    const byId = {}; needs.forEach(n => { byId[n.id] = n; });
    let failed = 0; const work = batches.slice();
    const worker = async () => {
      while (work.length) {
        const b = work.shift();
        try {
          const arr = await root.AI.json(cfg, assignPrompt(needs, b), o.signal, { temperature: 0.1 });
          const map = {}; b.forEach(x => { map[x.i] = x; });
          (Array.isArray(arr) ? arr : []).forEach(r => { const x = map[+r.i]; if (!x) return; (r.n || []).slice(0, 2).forEach(id => { const n = byId[id]; if (n && !n.ci.has(x.ci)) { n.ci.add(x.ci); n.cl.push(x); } }); });
        } catch (e) { if (o.signal && o.signal.aborted) throw e; if (/密钥|余额/.test(e.message)) throw e; failed++; }
        done++; prog();
      }
    };
    await Promise.all([worker(), worker()]);
    const out = needs.map(n => ({ name: n.name, type: n.type, count: n.ci.size, likes: n.cl.reduce((s, x) => s + x.likes, 0), insight: n.insight, action: n.action, angle: n.angle, quotes: topQuotes(n.cl, 5), ci: [...n.ci] }))
      .filter(n => n.count > 0).sort((a, b) => b.count - a.count);
    return { mode: 'ai', pack, provider: cfg.provider, summary: def.summary || '', clauses: cl.length, comments: o.comments.length, failedBatches: failed, needs: out, at: new Date().toISOString() };
  }

  const api = { TYPES, TYPE_NAME, classify, clauses, ruleNeeds, aiNeeds, dishOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Needs = api;
})(typeof window !== 'undefined' ? window : globalThis);
