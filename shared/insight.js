/* 调研洞察：店铺/品牌榜、竞对对比、爆款拆解
 * posts: [{id,url,title,desc,tags,author,likes,collects,comments,shares,time,poi,type,group,kw}]
 * comments: [{postId,text,likes,ts,group}]
 * 依赖：Industries、Needs、Core(parseCount)
 */
(function (root) {
  'use strict';
  const num = v => (typeof v === 'number' ? v : (root.Core ? root.Core.parseCount(v) : parseFloat(v)) || 0);
  const eng = p => num(p.likes) + num(p.collects) + num(p.comments) + num(p.shares);
  const avg = arr => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
  const median = arr => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  // ---------- 店铺 / 品牌榜 ----------
  const GENERIC = /^(这|那|一|哪|每|某|小|大|老|新|好|网红|宝藏|附近|本地|同城|全国|广州|深圳|北京|上海|杭州|成都|重庆|武汉|长沙|南京|西安|苏州|天津|东莞|佛山|厦门|珠海)?(家|间|个)?$/;
  const FILLER = /^.*(去了|去过|去|在|到了|来到|吃了|喝了|打卡|探店|推荐|安利|种草|这家|那家|一家|哪家|的|和|跟|是|叫做|叫|我们|朋友|附近|楼下|隔壁)/;
  const GEN_WORDS = /探店|推荐|攻略|合集|必吃|必喝|必去|宝藏|好吃|好喝|美食|周末|打卡|测评|避雷|排行|榜单|分享|日常|vlog|Vlog|plog|教程|干货|清单|种草|好物|生活|记录|同城|城市|附近|平价|人均|性价比|网红|团购|优惠|活动|新店|开业|上新/;
  function normName(s) { return String(s || '').replace(/[\s·・]/g, '').replace(/^[“"'「【《『#@]+|[”"'」】》』]+$/g, ''); }
  function splitBranch(name) { const m = name.match(/^(.+?)[（(]([^）)]{1,14})[）)]$/); return m ? { base: m[1], branch: m[2] } : { base: name, branch: '' }; }

  function entities(posts, comments, pack, opts) {
    opts = opts || {};
    const I = root.Industries; const pk = I.get(pack);
    const exclude = new Set([].concat(opts.exclude || []).map(normName).filter(Boolean));
    const catWords = new Set(pk.cats.concat(opts.cats || []));
    const shopRe = new RegExp(`([\\u4e00-\\u9fa5A-Za-z0-9&'’]{1,14}?(?:${I.shopRe(pack)}))(?:[（(]([^）)]{1,14})[）)])?`, 'g');
    const bracketRe = /[「【《『“"]([^」】》』”"]{2,14})[」】》』”"]/g;
    const C = new Map();
    const valid = name => {
      if (!name || name.length < 2 || name.length > 16) return false;
      if (exclude.has(name) || catWords.has(name)) return false;
      if (GEN_WORDS.test(name)) return false;
      const base = name.replace(new RegExp(`(${I.shopRe(pack)})$`), '');
      if (!base || GENERIC.test(base) || catWords.has(base)) return false;
      let rest = base; exclude.forEach(x => { rest = rest.split(x).join(''); }); catWords.forEach(x => { rest = rest.split(x).join(''); });
      if (!rest || GENERIC.test(rest)) return false; // 只是"地名+品类"，不是店名
      if (base.length < 2 && name.length < 3) return false;
      if (/^\d+$/.test(base)) return false;
      if (/(开|分|新|这|那|哪|一|个|家)(店|馆)$/.test(name) || /(什么时候|求|想|快来|来)/.test(name)) return false;
      return true;
    };
    const add = (raw, src, p, isComment) => {
      let name = normName(raw).replace(FILLER, '');
      const sb = splitBranch(name); name = sb.base;
      if (!valid(name)) return;
      if (isComment && !C.has(name)) return; // 评论只给已在帖子里出现的名字加提及数，不新建
      const e = C.get(name) || { name, posts: new Set(), cmts: 0, eng: 0, branches: new Set(), src: new Set(), top: null };
      if (isComment) e.cmts++;
      else if (!e.posts.has(p.id)) { e.posts.add(p.id); e.eng += eng(p); if (!e.top || eng(p) > eng(e.top)) e.top = p; }
      if (sb.branch) e.branches.add(sb.branch);
      e.src.add(src); C.set(name, e);
    };
    const scan = (text, p, isComment) => {
      const t = String(text || '');
      t.split(/[\n，,。！!？?；;~～|｜\s]+/).forEach(seg => {
        let m; shopRe.lastIndex = 0;
        while ((m = shopRe.exec(seg))) add(m[1] + (m[2] ? `（${m[2]}）` : ''), 'text', p, isComment);
      });
      let b; bracketRe.lastIndex = 0;
      while ((b = bracketRe.exec(t))) add(b[1], 'bracket', p, isComment);
    };
    const byId = {}; posts.forEach(p => { byId[p.id] = p; });
    posts.forEach(p => {
      if (p.poi) add(p.poi, 'poi', p, false);
      scan(p.title, p, false); scan(p.desc, p, false);
      (p.tags || []).forEach(t => { if (opts.tagsAsBrands && !GEN_WORDS.test(t) && !catWords.has(t)) add(t, 'tag', p, false); else scan(t, p, false); });
    });
    (comments || []).forEach(c => scan(c.text, byId[c.postId] || { id: 'c' }, true));
    // 第二遍：凡是提到这个名字（或去掉后缀的简称）的帖子/评论都算上
    const sufRe = new RegExp(`(${I.shopRe(pack)})$`);
    C.forEach(e => {
      const short = e.name.replace(sufRe, ''); const forms = [e.name].concat(short.length >= 2 && !GENERIC.test(short) && !catWords.has(short) ? [short] : []);
      posts.forEach(p => { if (e.posts.has(p.id)) return; const t = [p.title, p.desc, (p.tags || []).join(' '), p.poi].join(' '); if (forms.some(f => t.includes(f))) { e.posts.add(p.id); e.eng += eng(p); if (!e.top || eng(p) > eng(e.top)) e.top = p; } });
    });
    // 合并：短名被长名包含时并到出现更多的那个
    let list = [...C.values()].filter(e => e.posts.size + e.cmts >= (opts.min || 2) || e.src.has('poi'));
    list.sort((a, b) => b.posts.size - a.posts.size || b.cmts - a.cmts);
    const merged = [];
    list.forEach(e => {
      const host = merged.find(m => (m.name.includes(e.name) || e.name.includes(m.name)) && Math.min(m.name.length, e.name.length) >= 2);
      if (host) { e.posts.forEach(id => { if (!host.posts.has(id)) { host.posts.add(id); host.eng += eng(byId[id] || {}); } }); host.cmts += e.cmts; e.branches.forEach(b => host.branches.add(b)); e.src.forEach(s => host.src.add(s)); if (e.top && (!host.top || eng(e.top) > eng(host.top))) host.top = e.top; }
      else merged.push(e);
    });
    return merged.map(e => ({ name: e.name, posts: e.posts.size, mentions: e.cmts, eng: e.eng, avgEng: e.posts.size ? Math.round(e.eng / e.posts.size) : 0, branches: [...e.branches].slice(0, 5), viaPoi: e.src.has('poi'), top: e.top ? { title: e.top.title, url: e.top.url, eng: eng(e.top) } : null,
      score: e.posts.size * 3 + e.cmts + Math.log10(e.eng + 1) * 2 + (e.src.has('poi') ? 2 : 0) }))
      .sort((a, b) => b.score - a.score).slice(0, opts.limit || 25);
  }

  // ---------- 竞对对比 ----------
  function compare(posts, comments, pack) {
    const groups = [...new Set(posts.map(p => p.group).filter(Boolean))];
    return groups.map(g => {
      const ps = posts.filter(p => p.group === g); const ids = new Set(ps.map(p => p.id));
      const cs = comments.filter(c => ids.has(c.postId));
      const R = root.Needs.ruleNeeds(cs, [g], pack);
      const top = t => R.needs.filter(n => n.type === t).slice(0, 3).map(n => ({ name: n.name, count: n.count }));
      const totalC = Object.values(R.counts).reduce((s, x) => s + x, 0) || 1;
      return { group: g, posts: ps.length, comments: cs.length, avgEng: Math.round(avg(ps.map(eng))), medLikes: Math.round(median(ps.map(p => num(p.likes)))), totalEng: ps.reduce((s, p) => s + eng(p), 0),
        painRate: R.counts.pain / totalC, loveRate: R.counts.love / totalC, pain: top('pain'), love: top('love'), ask: top('ask'), wish: top('wish'),
        best: ps.slice().sort((a, b) => eng(b) - eng(a))[0] || null };
    }).sort((a, b) => b.totalEng - a.totalEng);
  }

  // ---------- 爆款拆解 ----------
  const PATTERNS = [
    ['数字型', /\d|[一二三四五六七八九十两]+(个|家|款|种|道|条|招|步)/],
    ['疑问型', /[?？]|吗|怎么|为什么|哪家|值不值/],
    ['价格/人均型', /人均|块|元|¥|\d+r|平价|便宜|性价比/],
    ['攻略/合集型', /攻略|合集|清单|指南|大全|盘点|整理/],
    ['避雷/踩雷型', /避雷|踩雷|劝退|别去|千万|后悔|翻车/],
    ['对比/测评型', /对比|测评|vs|VS|PK|横评|实测/],
    ['情绪/夸张型', /绝了|天花板|疯了|哭了|震惊|离谱|爆|yyds|封神|狠狠/],
    ['第一人称体验型', /^(我|终于|第一次|被|今天|周末)|我(的|家|们)/],
    ['地域定位型', /(广州|深圳|北京|上海|杭州|成都|重庆|武汉|长沙|南京|西安|苏州|天津|东莞|佛山|厦门|珠海|本地|同城)/],
    ['新店/上新型', /新店|新开|开业|上新|新品|首发/]
  ];
  function contentInsight(posts) {
    const ps = posts.filter(p => p.title || p.desc);
    const all = ps.map(eng); const base = avg(all) || 1;
    const titleOf = p => String(p.title || String(p.desc || '').split('\n')[0]).slice(0, 60);
    const patterns = PATTERNS.map(([name, re]) => { const hit = ps.filter(p => re.test(titleOf(p))); return { name, share: ps.length ? hit.length / ps.length : 0, n: hit.length, avgEng: Math.round(avg(hit.map(eng))), lift: hit.length ? avg(hit.map(eng)) / base - 1 : 0, ex: hit.sort((a, b) => eng(b) - eng(a)).slice(0, 2).map(titleOf) }; })
      .filter(x => x.n > 0).sort((a, b) => b.lift - a.lift);
    const tagMap = new Map();
    ps.forEach(p => new Set(p.tags || []).forEach(t => { const e = tagMap.get(t) || { tag: t, n: 0, eng: 0 }; e.n++; e.eng += eng(p); tagMap.set(t, e); }));
    const tags = [...tagMap.values()].filter(t => t.n >= 2).map(t => ({ tag: t.tag, n: t.n, avgEng: Math.round(t.eng / t.n) })).sort((a, b) => b.n - a.n || b.avgEng - a.avgEng).slice(0, 20);
    const timed = ps.filter(p => p.time);
    const hours = {}; const days = {};
    timed.forEach(p => { const d = new Date(p.time); const h = d.getHours(); const w = d.getDay(); (hours[h] = hours[h] || []).push(eng(p)); (days[w] = days[w] || []).push(eng(p)); });
    const hourStats = Object.entries(hours).map(([h, a]) => ({ h: +h, n: a.length, avgEng: Math.round(avg(a)) })).sort((a, b) => a.h - b.h);
    const dayStats = Object.entries(days).map(([d, a]) => ({ d: +d, n: a.length, avgEng: Math.round(avg(a)) })).sort((a, b) => a.d - b.d);
    const lenBuckets = [[0, 10, '10 字以内'], [11, 15, '11–15 字'], [16, 20, '16–20 字'], [21, 999, '20 字以上']].map(([a, b, l]) => { const hit = ps.filter(p => { const n = Array.from(titleOf(p)).length; return n >= a && n <= b; }); return { label: l, n: hit.length, avgEng: Math.round(avg(hit.map(eng))) }; }).filter(x => x.n);
    const types = ['video', 'note'].map(t => { const hit = ps.filter(p => (p.type || '') === t); return { type: t, n: hit.length, avgEng: Math.round(avg(hit.map(eng))) }; }).filter(x => x.n);
    const top = ps.slice().sort((a, b) => eng(b) - eng(a)).slice(0, 12).map(p => ({ id: p.id, title: titleOf(p), url: p.url, eng: eng(p), likes: num(p.likes), collects: num(p.collects), comments: num(p.comments), author: p.author, time: p.time, type: p.type, platform: p.platform, tags: p.tags || [], desc: String(p.desc || '').slice(0, 600) }));
    const collectRate = (() => { const a = ps.filter(p => num(p.likes) > 0); return a.length ? avg(a.map(p => num(p.collects) / num(p.likes))) : 0; })();
    return { n: ps.length, avgEng: Math.round(base), medEng: Math.round(median(all)), patterns, tags, hourStats, dayStats, lenBuckets, types, top, collectRate };
  }

  const api = { entities, compare, contentInsight, eng, PATTERNS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Insight = api;
})(typeof window !== 'undefined' ? window : globalThis);
