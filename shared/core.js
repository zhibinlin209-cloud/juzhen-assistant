/* 矩阵内容助手 · 核心逻辑（扩展与网页版共用）
 * 模板变量：{{门店名}}  同义随机：{好吃|好香|绝了}
 */
(function (root) {
  'use strict';

  // ---------- 平台规则（参考值，可在「规则」页修改） ----------
  const DEFAULT_RULES = {
    xhs: {
      name: '小红书',
      titleMax: 20,
      bodyMax: 1000,
      tagMax: 10,
      media: '图片最多 18 张，建议 3:4 竖图；视频建议 9:16',
      bestTimes: ['11:00–13:00 午休刷手机', '17:00–19:00 下班通勤', '21:00–23:00 睡前种草高峰'],
      notes: [
        '正文不要留电话、微信号、二维码、外部链接，容易被判导流限流',
        '话题超过 10 个会被忽略或影响推荐',
        '团购/外部链接不能直接放，可引导"到店报暗号""搜店名"',
        'AI 生成的图片或内容需要按平台要求声明'
      ]
    },
    douyin: {
      name: '抖音',
      titleMax: 30,
      bodyMax: 1000,
      tagMax: 5,
      media: '视频建议 9:16 竖屏；图文建议 3:4；记得挂门店 POI 和团购',
      bestTimes: ['11:00–13:00 午休', '17:30–20:00 下班高峰', '21:00–23:00 晚间休闲'],
      notes: [
        '团购通过视频挂载门店/团购组件，不要在文案里写链接或电话',
        '话题 3–5 个最常见，太多显得硬广',
        '前 3 秒要出现产品、效果或价格钩子',
        '同城流量看定位，发布时勾选门店 POI'
      ]
    }
  };

  // 广告法极限词（餐饮常见踩雷）
  const ABSOLUTE_WORDS = ['最好吃', '最好', '最佳', '最便宜', '最低价', '最正宗', '最强', '第一', 'NO.1', 'No.1', 'TOP1', '顶级', '唯一', '全网最低', '史上最', '国家级', '绝对', '100%', '首选', '独一无二', '万能', '根治'];
  // 不算极限词的常见搭配
  const ABSOLUTE_SAFE = /第一(时间|次|口|眼|步|天|批|波|个|家|站)|唯一的遗憾|最好(是|早点|提前|错峰)/g;
  const LEAD_PATTERNS = [
    { re: /1[3-9]\d{9}/, msg: '手机号' },
    { re: /0\d{2,3}[-\s]?\d{7,8}/, msg: '座机号' },
    { re: /(微信|v信|vx|VX|wx|WX|薇信|加我)/, msg: '微信/私加字样' },
    { re: /(https?:\/\/|www\.|\.com|\.cn)/i, msg: '外部链接' },
    { re: /(团购链接|点链接|二维码)/, msg: '链接/二维码字样' }
  ];

  const PLATFORM_LABEL = { xhs: '小红书', douyin: '抖音', both: '通用' };
  const CATEGORIES = ['新品上市', '探店种草', '团购套餐', '节日活动', '门店日常', '招牌菜', '招聘'];

  // ---------- 默认模板（餐饮） ----------
  const DEFAULT_TEMPLATES = [
    {
      id: 'tpl-new-xhs', name: '新品上市·种草', category: '新品上市', platform: 'xhs',
      title: '{{城市}}{上新了|新品来了|终于上新}！{{新品}}{太绝了|会回购|值得冲}',
      body: '{家人们|姐妹们|朋友们}，{{门店名}}{这周|最近}上了新品【{{新品}}】，第一时间去试了{😋|🤤|✨}\n\n✅ 口味：{一口下去层次感拉满|入口鲜香，越吃越上头|味道很有记忆点}\n✅ 份量：{分量很实在|两个人吃刚刚好|量足不踩雷}\n✅ 价格：人均{{人均}}元左右\n\n📍{{门店名}}·{{商圈}}\n⏰{{营业时间}}\n\n{新品刚上，建议早点去|上新期间人多，错峰去更舒服|爱吃{{招牌菜}}的一定要试试这个}~',
      tags: ['{{城市}}美食', '{{商圈}}美食', '新品', '探店', '美食分享', '周末吃什么', '{{城市}}探店'],
      script: ''
    },
    {
      id: 'tpl-new-dy', name: '新品上市·口播', category: '新品上市', platform: 'douyin',
      title: '{{门店名}}新品{{新品}}，{终于来了|今天正式上线|先尝为快}',
      body: '{{城市}}的朋友注意了！{{门店名}}新品【{{新品}}】{正式上线|今天开卖}，人均{{人均}}就能吃到{🔥|😋}\n{{活动}}\n点击视频左下角定位，到店直接吃~',
      tags: ['{{城市}}美食', '新品', '{{城市}}探店', '同城美食'],
      script: '【0-3秒】特写{{新品}}出锅/切开，字幕：{{门店名}}新品来了\n【3-10秒】试吃反应 + 口播：这个{{新品}}我必须说一下……\n【10-20秒】展示份量、价格：人均{{人均}}\n【20-25秒】门头 + 地址：{{商圈}}，左下角定位直接去'
    },
    {
      id: 'tpl-visit-xhs', name: '探店种草·宝藏小店', category: '探店种草', platform: 'xhs',
      title: '{藏在|私藏|路过}{{商圈}}的{宝藏|小众|好吃}{小馆|餐厅}{😭|！}',
      body: '{真的不想分享|吃完忍不住来写笔记|朋友带我来的}，{{门店名}}{太香了|也太好吃了吧|是我这个月吃过最满意的一顿}\n\n👉 必点：{{招牌菜}}\n👉 人均：{{人均}}元\n👉 环境：{干净明亮，适合约饭|氛围感很好，拍照出片|朋友聚餐很合适}\n\n{服务也很贴心|上菜速度很快|老板人很好}，下次{还要来|带家人来|继续二刷}！\n\n📍{{地址}}',
      tags: ['{{城市}}美食', '{{商圈}}美食', '宝藏小店', '探店', '{{城市}}探店', '约饭'],
      script: ''
    },
    {
      id: 'tpl-deal-dy', name: '团购套餐·价格钩子', category: '团购套餐', platform: 'douyin',
      title: '{{团购价}}元吃{{门店名}}{双人餐|套餐}，{这也太划算了|值不值看完再说}',
      body: '{{团购价}}元就能吃到{{门店名}}的{双人套餐|招牌套餐}！{{招牌菜}}也在里面{😋|🔥}\n{周末|节假日}通用，{不用排队|到店直接核销}\n点左下角团购直接抢~',
      tags: ['{{城市}}美食', '团购', '{{城市}}探店', '双人餐'],
      script: '【0-3秒】价格大字幕：{{团购价}}元能吃这么多？\n【3-12秒】逐个上菜镜头，口播菜名\n【12-20秒】吃播特写{{招牌菜}}\n【20-25秒】左下角团购，限时'
    },
    {
      id: 'tpl-deal-xhs', name: '团购套餐·攻略型', category: '团购套餐', platform: 'xhs',
      title: '{{门店名}}{这样点最划算|点单攻略|省钱吃法}{💰|！}',
      body: '{来了好几次|吃了N次|帮大家试过了}，{{门店名}}{这样点|按这个点}最划算👇\n\n1️⃣ {{招牌菜}}：必点，没有之一\n2️⃣ 套餐：{{团购价}}元的套餐够两个人吃\n3️⃣ {{活动}}\n\n{到店跟服务员说"小红书看到的"|到店报店名就行}，{有小惊喜|会有小福利}~\n\n📍{{地址}}',
      tags: ['{{城市}}美食', '省钱攻略', '点单攻略', '{{商圈}}美食', '探店'],
      script: ''
    },
    {
      id: 'tpl-festival', name: '节日活动·通用', category: '节日活动', platform: 'both',
      title: '{{活动}}｜{{门店名}}{等你来|约起来}',
      body: '{{日期}}起，{{门店名}}{{活动}}{🎉|🎊|✨}\n\n{和家人|和朋友|和对象}来吃一顿{{招牌菜}}，{仪式感拉满|就是最好的过节方式|热热闹闹过节}\n\n⏰{{营业时间}}\n📍{{商圈}}',
      tags: ['{{城市}}美食', '节日', '约饭', '{{城市}}探店'],
      script: ''
    },
    {
      id: 'tpl-daily-dy', name: '门店日常·后厨', category: '门店日常', platform: 'douyin',
      title: '{凌晨|早上}{6|7}点的{{门店名}}后厨，{你见过吗|都在忙什么}',
      body: '每天{现熬|现做|现切}的{{招牌菜}}，{这就是我们坚持的味道|讲究的就是一个新鲜}{💪|🔥}\n{{城市}}的朋友来尝尝~',
      tags: ['后厨', '{{城市}}美食', '餐饮人', '用心做饭'],
      script: '【0-3秒】后厨开灯/开火\n【3-15秒】备菜、熬汤、切配快剪\n【15-22秒】成品{{招牌菜}}上桌\n【22-25秒】门头 + 营业时间{{营业时间}}'
    },
    {
      id: 'tpl-sig-xhs', name: '招牌菜·深度种草', category: '招牌菜', platform: 'xhs',
      title: '{{城市}}{吃过最|超}{香|好吃}的{{招牌菜}}{在这|就这家}',
      body: '{说真的|不夸张地说|吃过很多家}，{{门店名}}的{{招牌菜}}{我能吃一辈子|让我念念不忘}{🤤|😭}\n\n✅ {火候刚好|入口即化|外酥里嫩}\n✅ {酱汁拌饭绝了|汤底很鲜|香料味很正}\n✅ 人均{{人均}}，{性价比很高|不贵}\n\n{建议两个人点一份尝尝|配米饭真的绝}~\n📍{{门店名}}·{{商圈}}',
      tags: ['{{城市}}美食', '{{招牌菜}}', '必吃榜', '探店', '{{商圈}}美食'],
      script: ''
    },
    {
      id: 'tpl-hire', name: '门店招聘', category: '招聘', platform: 'both',
      title: '{{门店名}}招人啦｜{{商圈}}{附近的看过来|包吃}',
      body: '{{门店名}}（{{商圈}}）{招聘|诚招}：服务员、后厨帮工\n\n✅ 包工作餐\n✅ 排班灵活，{可兼职|全职兼职都可}\n✅ {团队氛围好|老员工带新人}\n\n有意向的{评论区留言|私信"应聘"}，我们{会联系你|第一时间回复}~',
      tags: ['{{城市}}招聘', '餐饮招聘', '兼职'],
      script: ''
    }
  ];

  const DEFAULT_ACCOUNTS = [
    { id: 'acc-1', name: '示例·天河店小红书', platform: 'xhs', handle: '', note: '示例账号，可改成你的', vars: { 门店名: '老街小馆（天河店）', 城市: '广州', 商圈: '天河路', 地址: '天河路 XXX 号 2 楼', 招牌: '砂锅焗鸡', 价格: '78', 营业时间: '10:30–22:00' } },
    { id: 'acc-2', name: '示例·海珠店小红书', platform: 'xhs', handle: '', note: '示例账号，可改成你的', vars: { 门店名: '老街小馆（海珠店）', 城市: '广州', 商圈: '江南西', 地址: '江南西路 XXX 号', 招牌: '砂锅焗鸡', 价格: '72', 营业时间: '11:00–22:30' } },
    { id: 'acc-3', name: '示例·品牌号抖音', platform: 'douyin', handle: '', note: '示例账号，可改成你的', vars: { 门店名: '老街小馆', 城市: '广州', 商圈: '天河/海珠', 地址: '天河路、江南西两店', 招牌: '砂锅焗鸡', 价格: '75', 营业时间: '10:30–22:30' } }
  ];

  // ---------- 工具 ----------
  function uid(p) { return (p || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function len(s) { return Array.from(s || '').length; }
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = seed >>> 0; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function pick(arr, r) { return arr[Math.floor(r() * arr.length)]; }
  function shuffle(arr, r) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function today() { const d = new Date(); return (d.getMonth() + 1) + '月' + d.getDate() + '日'; }

  const VAR_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

  /** 解析同义随机 {a|b|c}，支持嵌套；不碰 {{变量}} */
  function hideVars(text) {
    const saved = [];
    const t = String(text || '').replace(VAR_RE, m => { saved.push(m); return '\u0001' + (saved.length - 1) + '\u0002'; });
    return { t, back: s => s.replace(/\u0001(\d+)\u0002/g, (_, i) => saved[+i]) };
  }
  function spin(text, r) {
    const re = /\{([^{}]*\|[^{}]*)\}/;
    const h = hideVars(text); let out = h.t, guard = 0;
    while (re.test(out) && guard++ < 500) {
      out = out.replace(re, (_, inner) => pick(inner.split('|'), r));
    }
    return h.back(out);
  }
  /** 只保留第一个选项（无差异化时的"标准版"） */
  function spinFirst(text) {
    const re = /\{([^{}]*\|[^{}]*)\}/;
    const h = hideVars(text); let out = h.t, guard = 0;
    while (re.test(out) && guard++ < 500) out = out.replace(re, (_, inner) => inner.split('|')[0]);
    return h.back(out);
  }

  function fillVars(text, vars) {
    return String(text || '').replace(VAR_RE, (m, k) => {
      const v = vars[k];
      return v !== undefined && v !== null && String(v).trim() !== '' ? String(v) : m;
    });
  }
  function listVars(tpl) {
    const set = new Set();
    [tpl.title, tpl.body, tpl.script, ...(tpl.tags || [])].forEach(t => { String(t || '').replace(VAR_RE, (_, k) => { set.add(k); return _; }); });
    return Array.from(set);
  }
  function missingVars(text) {
    const set = new Set(); String(text || '').replace(VAR_RE, (_, k) => { set.add(k); return _; }); return Array.from(set);
  }

  // ---------- 差异化 ----------
  const SYNONYMS = [
    ['好吃', '好香', '太香了', '很绝'],
    ['推荐', '安利', '强推'],
    ['必点', '必吃', '闭眼点'],
    ['回购', '二刷', '再来'],
    ['宝藏', '私藏', '小众'],
    ['氛围感', '氛围', '环境感'],
    ['超级', '巨', '非常'],
    ['真的', '是真的', '确实'],
    ['一定要', '务必', '记得'],
    ['朋友们', '家人们', '宝子们'],
    ['划算', '实惠', '超值']
  ];
  const EMOJI_GROUPS = [
    ['😋', '🤤', '😍', '🥰'],
    ['✨', '🌟', '💫'],
    ['🔥', '💥', '🔥'],
    ['🎉', '🎊', '🥳'],
    ['💰', '💸', '🪙'],
    ['😭', '🥹', '😢']
  ];
  const BULLETS = ['✅', '✔️', '☑️', '🔸', '▪️', '🍴'];

  function protectVars(text, fn) {
    // 只改变量以外的文字
    const parts = String(text).split(/(\{\{[^{}]+\}\})/);
    return parts.map(p => (p.startsWith('{{') ? p : fn(p))).join('');
  }
  function swapSynonyms(text, r, rate) {
    return protectVars(text, seg => {
      SYNONYMS.forEach(group => {
        group.forEach(word => {
          if (!seg.includes(word)) return;
          seg = seg.split(word).map((piece, i, arr) => {
            if (i === arr.length - 1) return piece;
            return piece + (r() < rate ? pick(group, r) : word);
          }).join('');
        });
      });
      return seg;
    });
  }
  function swapEmoji(text, r) {
    let out = text;
    EMOJI_GROUPS.forEach(g => {
      g.forEach(e => {
        if (out.includes(e)) out = out.split(e).map((p, i, a) => i === a.length - 1 ? p : p + pick(g, r)).join('');
      });
    });
    // 列表符号整篇统一换一种
    const bulletNow = BULLETS.find(b => out.includes(b));
    if (bulletNow) { const nb = pick(BULLETS, r); out = out.split(bulletNow).join(nb); }
    return out;
  }
  function firstChar(line) { return Array.from(line || '')[0] || ''; }
  /** 连续 3 行以上、开头符号相同的列表行打乱顺序 */
  function shuffleLists(text, r) {
    const lines = text.split('\n');
    const out = []; let i = 0;
    while (i < lines.length) {
      const fc = firstChar(lines[i]);
      const isBullet = fc && /[^\w一-龥\s0-9]/u.test(fc) && !/^\d/.test(lines[i]);
      if (isBullet) {
        let j = i; while (j < lines.length && lines[j] && Array.from(lines[j])[0] === fc) j++;
        const block = lines.slice(i, j);
        out.push(...(block.length >= 3 ? shuffle(block, r) : block)); i = j;
      } else { out.push(lines[i]); i++; }
    }
    return out.join('\n');
  }
  function pickTags(tags, r, max, vary) {
    const t = (tags || []).filter(Boolean);
    if (!vary) return t.slice(0, max);
    const core = t.slice(0, 3);
    let rest = shuffle(t.slice(3), r);
    const drop = Math.min(rest.length, Math.floor(r() * 3));
    rest = rest.slice(0, rest.length - drop);
    return core.concat(rest).slice(0, max);
  }

  /**
   * 生成一条内容
   * opts: { vary:boolean, round:number, rules, batchVars }
   */
  function generate(tpl, account, opts) {
    opts = opts || {};
    const rules = (opts.rules || DEFAULT_RULES);
    const platform = account && account.platform ? account.platform : (tpl.platform === 'both' ? 'xhs' : tpl.platform);
    const rule = rules[platform] || rules.xhs;
    const vars = Object.assign({ 日期: today() }, opts.batchVars || {});
    Object.entries((account && account.vars) || {}).forEach(([k, v]) => { if (v !== undefined && String(v).trim() !== '') vars[k] = v; });
    const seed = hash([tpl.id, account ? account.id : 'none', opts.round || 0].join('|'));
    const r = rng(seed);
    const vary = !!opts.vary;
    const prep = (s) => {
      let t = vary ? spin(s || '', r) : spinFirst(s || '');
      if (vary) t = swapSynonyms(t, r, 0.5);
      t = fillVars(t, vars);
      if (vary) t = swapEmoji(t, r);
      return t;
    };
    let title = prep(tpl.title);
    let body = prep(tpl.body);
    if (vary) body = shuffleLists(body, r);
    const script = prep(tpl.script || '');
    const tags = pickTags((tpl.tags || []).map(t => fillVars(vary ? spin(t, r) : spinFirst(t), vars).replace(/^#/, '').replace(/\s+/g, '')), r, rule.tagMax || 10, vary);
    const uniqTags = Array.from(new Set(tags));
    const result = { templateId: tpl.id, accountId: account ? account.id : '', platform, title, body, tags: uniqTags, script };
    result.pack = opts.pack || tpl.ind || 'general';
    result.checks = check(result, rules, result.pack);
    return result;
  }

  function bannedFor(pack) { return root.Industries ? root.Industries.banned(pack || 'general') : ABSOLUTE_WORDS; }
  function check(item, rules, pack) {
    rules = rules || DEFAULT_RULES;
    const rule = rules[item.platform] || rules.xhs;
    const issues = [];
    const tl = len(item.title), bl = len(item.body), tg = (item.tags || []).length;
    if (rule.titleMax && tl > rule.titleMax) issues.push({ level: 'error', msg: `标题 ${tl} 字，超出 ${rule.titleMax} 字上限` });
    if (rule.bodyMax && bl > rule.bodyMax) issues.push({ level: 'error', msg: `正文 ${bl} 字，超出 ${rule.bodyMax} 字上限` });
    if (rule.tagMax && tg > rule.tagMax) issues.push({ level: 'warn', msg: `话题 ${tg} 个，建议不超过 ${rule.tagMax} 个` });
    const miss = missingVars([item.title, item.body, item.script, (item.tags || []).join(' ')].join('\n'));
    if (miss.length) issues.push({ level: 'error', msg: '变量没填：' + miss.join('、') });
    const all = item.title + '\n' + item.body;
    const cleaned = all.replace(ABSOLUTE_SAFE, '');
    const abs = bannedFor(pack || item.pack).filter(w => cleaned.includes(w));
    if (abs.length) issues.push({ level: 'warn', msg: '广告法极限词：' + abs.join('、') });
    LEAD_PATTERNS.forEach(p => { if (p.re.test(all)) issues.push({ level: item.platform === 'xhs' ? 'error' : 'warn', msg: `含${p.msg}，有导流限流风险` }); });
    return { titleLen: tl, bodyLen: bl, tagCount: tg, issues };
  }

  /** 字的二元组相似度 0~1 */
  function similarity(a, b) {
    const grams = s => { const arr = Array.from((s || '').replace(/\s+/g, '')); const set = new Set(); for (let i = 0; i < arr.length - 1; i++) set.add(arr[i] + arr[i + 1]); return set; };
    const A = grams(a), B = grams(b);
    if (!A.size || !B.size) return 0;
    let inter = 0; A.forEach(g => { if (B.has(g)) inter++; });
    return inter / (A.size + B.size - inter);
  }

  function tagsText(tags) { return (tags || []).map(t => '#' + t).join(' '); }
  function fullText(item) {
    const parts = [];
    if (item.title) parts.push(item.title);
    if (item.body) parts.push(item.body);
    if (item.tags && item.tags.length) parts.push(tagsText(item.tags));
    return parts.join('\n\n');
  }

  /** "1.2万" "10w+" "3.4k" → 数字 */
  function parseCount(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v;
    const s = String(v).trim().replace(/,/g, '').replace(/\+$/, '');
    if (!s) return null;
    const m = s.match(/([\d.]+)\s*(万|w|W|千|k|K|亿)?/);
    if (!m) return null;
    let n = parseFloat(m[1]);
    const u = m[2];
    if (u === '万' || u === 'w' || u === 'W') n *= 10000;
    else if (u === '千' || u === 'k' || u === 'K') n *= 1000;
    else if (u === '亿') n *= 1e8;
    return Math.round(n);
  }
  function fmtCount(n) {
    if (n === null || n === undefined || n === '') return '—';
    n = Number(n); if (isNaN(n)) return '—';
    if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + '万';
    return String(n);
  }
  function interactions(r) { return (Number(r.likes) || 0) + (Number(r.collects) || 0) + (Number(r.comments) || 0) + (Number(r.shares) || 0); }

  /** 按账号汇总 */
  function summarize(records, accounts) {
    const by = {};
    (accounts || []).forEach(a => { by[a.id] = { account: a, posts: 0, inter: 0, likes: 0, collects: 0, comments: 0, best: null }; });
    (records || []).forEach(r => {
      const s = by[r.accountId] || (by[r.accountId] = { account: { id: r.accountId, name: r.accountName || '未知账号', platform: r.platform }, posts: 0, inter: 0, likes: 0, collects: 0, comments: 0, best: null });
      s.posts++; const it = interactions(r); s.inter += it;
      s.likes += Number(r.likes) || 0; s.collects += Number(r.collects) || 0; s.comments += Number(r.comments) || 0;
      if (!s.best || it > interactions(s.best)) s.best = r;
    });
    return Object.values(by).map(s => Object.assign(s, { avg: s.posts ? Math.round(s.inter / s.posts) : 0 }));
  }
  /** 用自己的记录算各时段平均互动 */
  function hourStats(records) {
    const buckets = {};
    (records || []).forEach(r => {
      if (!r.publishedAt) return;
      const h = new Date(r.publishedAt).getHours(); if (isNaN(h)) return;
      const b = buckets[h] || (buckets[h] = { hour: h, n: 0, sum: 0 }); b.n++; b.sum += interactions(r);
    });
    return Object.values(buckets).map(b => ({ hour: b.hour, n: b.n, avg: Math.round(b.sum / b.n) })).sort((a, b) => a.hour - b.hour);
  }

  function toCSV(rows, cols) {
    const esc = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return '﻿' + [cols.map(c => esc(c.label)).join(','), ...rows.map(r => cols.map(c => esc(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','))].join('\n');
  }

  function defaultState() {
    return {
      templates: [], // 只存用户自建/改过的模板；内置模板来自 TemplatesLib
      accounts: JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS)).map(migrateAccount),
      records: [],
      snapshots: [],
      settings: { id: 'main', industry: 'food', rules: JSON.parse(JSON.stringify(DEFAULT_RULES)), batchVars: { 新品: '', 活动: '', 团购价: '' } }
    };
  }
  const OLD_DEFAULT_IDS = new Set(DEFAULT_TEMPLATES.map(t => t.id));
  const renameVars = s => String(s || '').replace(/\{\{\s*招牌菜\s*\}\}/g, '{{招牌}}').replace(/\{\{\s*人均\s*\}\}/g, '{{价格}}');
  /** 旧版数据升级：变量改名（招牌菜→招牌、人均→价格）、补充行业/分组/人设等字段 */
  function migrateTemplate(t) {
    const o = Object.assign({}, t);
    if (!o.ind) o.ind = 'food';
    ['title', 'body', 'script'].forEach(k => { o[k] = renameVars(o[k]); });
    o.tags = (o.tags || []).map(renameVars);
    return o;
  }
  function migrateAccount(a) {
    const o = Object.assign({ group: '', persona: 'owner', tone: 'warm', status: 'active', weeklyTarget: 3, tags: [] }, a);
    o.vars = Object.assign({}, o.vars || {});
    if (o.vars['招牌菜'] && !o.vars['招牌']) o.vars['招牌'] = o.vars['招牌菜'];
    if (o.vars['人均'] && !o.vars['价格']) o.vars['价格'] = o.vars['人均'];
    if (!o.group) o.group = o.vars['门店名'] || '';
    return o;
  }
  function migrateState(st) {
    st.templates = (st.templates || []).filter(t => !(OLD_DEFAULT_IDS.has(t.id) && !t.updatedAt)).map(migrateTemplate);
    st.accounts = (st.accounts || []).map(migrateAccount);
    st.settings = st.settings || {};
    if (!st.settings.industry) st.settings.industry = 'food';
    return st;
  }
  /** 内置模板 + 用户模板（同 id 时用户版本覆盖） */
  function allTemplates(st) {
    const lib = root.TemplatesLib ? root.TemplatesLib.TEMPLATES : [];
    const mine = st.templates || []; const ids = new Set(mine.map(t => t.id));
    return lib.filter(t => !ids.has(t.id)).concat(mine);
  }
  /** 每个模板的使用次数和平均互动（来自发布记录） */
  function templateStats(records) {
    const m = {};
    (records || []).forEach(r => {
      if (!r.templateId) return; const s = m[r.templateId] || (m[r.templateId] = { uses: 0, withData: 0, inter: 0 });
      s.uses++; const it = interactions(r); if (r.likes !== null && r.likes !== undefined && r.likes !== '') { s.withData++; s.inter += it; }
    });
    Object.values(m).forEach(s => { s.avg = s.withData ? Math.round(s.inter / s.withData) : null; });
    return m;
  }

  const api = {
    DEFAULT_RULES, DEFAULT_TEMPLATES, DEFAULT_ACCOUNTS, CATEGORIES, PLATFORM_LABEL, ABSOLUTE_WORDS,
    uid, len, spin, spinFirst, fillVars, listVars, missingVars, generate, check, similarity, bannedFor,
    migrateState, migrateTemplate, migrateAccount, allTemplates, templateStats,
    tagsText, fullText, parseCount, fmtCount, interactions, summarize, hourStats, toCSV, defaultState, hash, rng
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
