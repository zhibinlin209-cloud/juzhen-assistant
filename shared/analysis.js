/* 调研分析：把采集到的帖子和评论整理成需求分类、提问、菜品、情感等 */
(function (root) {
  'use strict';

  // 关注点词典：命中任一词就算提到这一类
  const NEEDS = [
    { key: 'taste', name: '口味', words: ['好吃', '难吃', '味道', '口味', '口感', '香', '鲜', '辣', '咸', '淡', '甜', '腻', '入味', '正宗', '嫩', '老了', '酥', '脆', '锅气', '下饭', '一般般'] },
    { key: 'price', name: '价格/性价比', words: ['价格', '贵', '便宜', '性价比', '人均', '划算', '实惠', '团购', '优惠', '套餐', '多少钱', '不值', '值得', '小贵', '买单', '收费', '券'] },
    { key: 'queue', name: '排队/等位', words: ['排队', '等位', '等了', '人多', '订位', '预约', '取号', '排了', '爆满', '没位', '要等'] },
    { key: 'service', name: '服务', words: ['服务', '态度', '服务员', '老板', '上菜', '催菜', '热情', '冷淡', '收拾', '换盘', '加水'] },
    { key: 'env', name: '环境/氛围', words: ['环境', '氛围', '干净', '脏', '吵', '装修', '座位', '露天', '空调', '烟火气', '拍照', '出片', '热闹', '包间', '桌子'] },
    { key: 'portion', name: '分量', words: ['分量', '份量', '量大', '量少', '量很', '吃饱', '够吃', '吃不完', '几个人', '两个人', '三个人', '分量足'] },
    { key: 'location', name: '地址/交通', words: ['在哪', '地址', '哪里', '停车', '地铁', '怎么去', '号线', '附近', '分店', '哪家店', '哪个店', '定位', '导航', '远'] },
    { key: 'hours', name: '营业时间', words: ['几点', '营业', '开门', '关门', '夜宵', '宵夜', '凌晨', '通宵', '早上', '中午'] },
    { key: 'dish', name: '点什么/推荐', words: ['推荐', '必点', '点什么', '什么好吃', '招牌', '点了', '踩雷', '必吃', '求推荐', '菜单'] },
    { key: 'hygiene', name: '卫生/食品安全', words: ['卫生', '拉肚子', '不新鲜', '头发', '虫', '苍蝇', '蟑螂', '变质', '异味', '臭'] },
    { key: 'kids', name: '聚餐/适合人群', words: ['聚餐', '朋友', '家人', '小孩', '带娃', '老人', '约会', '团建', '生日', '一个人'] }
  ];
  const POS = ['好吃', '推荐', '不错', '喜欢', '满意', '好香', '超香', '绝了', '赞', '值得', '划算', '实惠', '干净', '热情', '回购', '二刷', '必点', '惊艳', '爱了', '入味', '新鲜', '正宗', '好评', '宝藏', '下饭', '巴适', '靠谱', '好喝', '性价比高', '量大', '分量足', 'yyds', '好好吃', '烟火气', '好香'];
  const NEG = ['难吃', '太久', '有点贵', '不推荐', '一般', '失望', '踩雷', '一般般', '很一般', '不好吃', '贵了', '太贵', '小贵', '不值', '差评', '态度差', '服务差', '慢', '脏', '不新鲜', '拉肚子', '坑', '咸了', '太咸', '油腻', '排了好久', '等太久', '等了很久', '冷了', '踩坑', '劝退', '后悔', '再也不', '不会再', '割韭菜', '智商税', '量少', '缩水', '变味', '没以前好', '头发', '苍蝇', '虫'];
  const NEGATORS = /(不|没|别|无)$/;

  // 菜名：以常见食材/做法结尾的 2–6 字词
  const DISH_RE = /[一-龥]{1,5}?(鸡|鸭|鹅|鱼|虾|蟹|螺|蚝|花甲|蚬|生蚝|扇贝|鱿鱼|肉|排骨|牛|羊|肠|肚|粥|粉|面|饭|煲|锅|汤|串|饼|包|饺|丸|豆腐|茄子|菜心|蛋|翅|爪|蛙|鳝|骨|腩|鲍|贝|笋|藕|炒饭|炒粉|烧烤)/g;
  const DISH_STOP = /^(这|那|一|个|很|太|的|了|吃|好|真|都|就|也|还|去|来|点|是|有|在|和|跟|给|被|把|我|你|他|她|它|们|家|店|啥|么|吗|呢|吧|啊|哈|呀|嘛|又|再|最|更|超|巨|挺|蛮|多|少|大|小|上|下)+/;

  function clean(s) { return String(s || '').replace(/\[[^\]]{1,8}\]/g, '').replace(/\s+/g, ' ').trim(); }
  function num(v) { if (v === null || v === undefined || v === '') return 0; if (typeof v === 'number') return v; return (root.Core && root.Core.parseCount(v)) || 0; }

  function sentiment(text) {
    let p = 0, n = 0;
    POS.forEach(w => { let i = text.indexOf(w); while (i >= 0) { const before = text.slice(Math.max(0, i - 1), i); if (NEGATORS.test(before)) n++; else p++; i = text.indexOf(w, i + w.length); } });
    NEG.forEach(w => { if (text.includes(w)) n++; });
    return p > n ? 'pos' : n > p ? 'neg' : 'neu';
  }
  function categorize(text) { return NEEDS.filter(c => c.words.some(w => text.includes(w))).map(c => c.key); }
  function isQuestion(text) { return /[?？]|吗$|吗[，。!！ ]|在哪|哪里|哪家|怎么|多少|几点|有没有|是不是|能不能|可以.{0,6}吗|求推荐|求问|请问/.test(text); }

  function dishes(text) {
    const out = [];
    (text.match(DISH_RE) || []).forEach(d => {
      d = d.replace(DISH_STOP, '');
      if (d.length >= 2 && d.length <= 6 && !/(吃饭|干饭|饭店|饭点|面前|见面|锅气|一锅|汤底|肉眼)/.test(d)) out.push(d);
    });
    return out;
  }

  function analyze(run) {
    const posts = (run.posts || []).map(p => Object.assign({}, p, {
      likesN: num(p.likes), collectsN: num(p.collects), commentsN: num(p.comments), sharesN: num(p.shares)
    }));
    posts.forEach(p => { p.inter = p.likesN + p.collectsN + p.commentsN + p.sharesN; });
    const postById = {}; posts.forEach(p => { postById[p.id] = p; });

    const comments = [];
    const seen = new Set();
    (run.comments || []).forEach(c => {
      const text = clean(c.text);
      if (!text || text.length < 2) return;
      const k = c.postId + '|' + text;
      if (seen.has(k)) return; seen.add(k);
      comments.push({ postId: c.postId, name: c.name || '', text, likesN: num(c.likes), date: c.date || '', cats: categorize(text), senti: sentiment(text), q: isQuestion(text) });
    });

    const totals = {
      posts: posts.length,
      likes: posts.reduce((s, p) => s + p.likesN, 0),
      collects: posts.reduce((s, p) => s + p.collectsN, 0),
      commentsOnPosts: posts.reduce((s, p) => s + p.commentsN, 0),
      sample: comments.length,
      pos: comments.filter(c => c.senti === 'pos').length,
      neg: comments.filter(c => c.senti === 'neg').length
    };
    totals.neu = totals.sample - totals.pos - totals.neg;

    const byLikes = (a, b) => b.likesN - a.likesN || b.text.length - a.text.length;
    const needs = NEEDS.map(cat => {
      const list = comments.filter(c => c.cats.includes(cat.key));
      return {
        key: cat.key, name: cat.name, count: list.length,
        share: comments.length ? list.length / comments.length : 0,
        pos: list.filter(c => c.senti === 'pos').length,
        neg: list.filter(c => c.senti === 'neg').length,
        top: list.slice().sort(byLikes).slice(0, 3),
        topNeg: list.filter(c => c.senti === 'neg').sort(byLikes).slice(0, 2)
      };
    }).filter(n => n.count > 0).sort((a, b) => b.count - a.count);

    const uniq = list => { const seen = new Set(); return list.filter(c => { const k = c.text.replace(/[\s，。！？!?,.~～]/g, ''); if (seen.has(k)) return false; seen.add(k); return true; }); };
    const questions = uniq(comments.filter(c => c.q).sort(byLikes));
    const negatives = uniq(comments.filter(c => c.senti === 'neg').sort(byLikes));
    const positives = comments.filter(c => c.senti === 'pos').sort(byLikes);

    const dishCount = {};
    comments.forEach(c => { new Set(dishes(c.text)).forEach(d => { dishCount[d] = (dishCount[d] || 0) + 1; }); });
    posts.forEach(p => { new Set(dishes(clean((p.title || '') + ' ' + (p.desc || '')))).forEach(d => { dishCount[d] = (dishCount[d] || 0) + 1; }); });
    // 去掉被更长菜名完全包含且次数不多的短词
    let dishList = Object.entries(dishCount).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
    dishList = dishList.filter(([d, n]) => !dishList.some(([d2, n2]) => d2 !== d && d2.includes(d) && n2 >= n * 0.8)).slice(0, 20);

    const authors = {};
    posts.forEach(p => { if (p.author) { const a = authors[p.author] || (authors[p.author] = { name: p.author, posts: 0, inter: 0 }); a.posts++; a.inter += p.inter; } });

    return {
      totals, needs, questions, negatives, positives,
      dishes: dishList.map(([name, count]) => ({ name, count })),
      topPosts: posts.slice().sort((a, b) => b.inter - a.inter),
      authors: Object.values(authors).sort((a, b) => b.inter - a.inter),
      comments, postById, NEEDS
    };
  }

  /** 给其他 AI 深度分析用的提示词 */
  function aiPrompt(run, A, maxChars) {
    maxChars = maxChars || 14000;
    const pf = run.platform === 'douyin' ? '抖音' : '小红书';
    const head = `我是餐饮品牌的营销负责人。下面是在${pf}搜索"${run.keyword}"采集到的 ${A.totals.posts} 篇帖子和 ${A.totals.sample} 条评论（按点赞排序）。
请帮我分析并用表格输出：
1. 消费者最在意的需求和痛点（按提及多少排序，附代表性原话）
2. 好评集中在什么、差评集中在什么
3. 评论区大家最常问的问题，我们该怎么在内容里提前回答
4. 被提到最多的菜品，哪些是爆点
5. 给我 5 个小红书/抖音选题建议和对应标题

【热门帖子】
${A.topPosts.slice(0, 15).map((p, i) => `${i + 1}. ${p.title || '(无标题)'}｜赞${p.likesN} 藏${p.collectsN} 评${p.commentsN}`).join('\n')}

【评论】
`;
    let body = '';
    for (const c of A.comments.slice().sort((a, b) => b.likesN - a.likesN)) {
      const line = `- ${c.text}${c.likesN ? `（赞${c.likesN}）` : ''}\n`;
      if (head.length + body.length + line.length > maxChars) break;
      body += line;
    }
    return head + body;
  }

  const api = { NEEDS, analyze, sentiment, categorize, isQuestion, dishes, aiPrompt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Analysis = api;
})(typeof window !== 'undefined' ? window : globalThis);
