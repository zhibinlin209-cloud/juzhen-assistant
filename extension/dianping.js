/* 大众点评采集：搜索页收集店铺（名称、人均、品类商圈、推荐菜），评价页读取评价（星级、口味/环境/服务分、人均、喜欢的菜、时间）
 * 只读页面已经显示的内容；评价里被"加密字体"替换的字，尽量用页面自带的 CSS + SVG 还原，还原不了的字会缺失。
 */
(function () {
  'use strict';
  if (window.__rmDianpingLoaded) return;
  window.__rmDianpingLoaded = true;

  const $ = (s, sc) => (sc || document).querySelector(s);
  const $$ = (s, sc) => Array.from((sc || document).querySelectorAll(s));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const visible = el => { if (!el) return false; const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
  const toNum = v => { const m = String(v || '').replace(/,/g, '').match(/([\d.]+)\s*(万|w)?/i); if (!m) return null; let n = parseFloat(m[1]); if (m[2]) n *= 1e4; return Math.round(n); };
  const cookie = k => { const m = document.cookie.match(new RegExp('(?:^|; )' + k + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; };
  async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(300); } return false; }

  function blocked() {
    const url = location.href; const body = (document.body && document.body.innerText || '').slice(0, 3000);
    if (/verify\.meituan|optimus-mtsi|\/verify|captcha/i.test(url)) return '大众点评要求安全验证';
    if (/account\.dianping\.com|passport|\/login/i.test(url)) return '需要先登录大众点评';
    if (/请完成验证|滑块|访问异常|操作频繁|访问频繁|验证中心/.test(body)) return '大众点评提示需要验证或访问太频繁';
    const lg = $('.login-box') || $('#J_login') || $('.login-container');
    if (visible(lg) && !$('.reviews-items, #shop-all-list')) return '需要先登录大众点评';
    return null;
  }


  // ---------- 网页版"只能去 App 看全部评价"的拦截 ----------
  function appGate() {
    const t = (document.body && document.body.innerText || '');
    if (!/移步至大众点评\s*App|打开大众点评App|下载大众点评App查看|App\s*查看(全部|更多)/i.test(t)) return false;
    return true;
  }

  // ---------- 店铺首页：评价总数 + 评价标签（点评基于全部评价统计的） + 首页显示的评价 ----------
  const TAG_RE = /^([一-龥A-Za-z0-9·、/&+\s]{2,16}?)\s*[（(]?(\d{1,6})[)）]?$/;
  function parseCnDate(s) {
    s = String(s || '').trim();
    let m = s.match(/(20\d{2})[-./年](\d{1,2})[-./月](\d{1,2})/); if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
    m = s.match(/^(\d{1,2})月(\d{1,2})日/); if (m) { const now = new Date(); let d = new Date(now.getFullYear(), +m[1] - 1, +m[2]); if (d - now > 2 * 864e5) d = new Date(now.getFullYear() - 1, +m[1] - 1, +m[2]); return d.getTime(); }
    m = s.match(/(\d+)\s*(分钟|小时)前/); if (m) return Date.now() - (+m[1]) * (m[2] === '分钟' ? 6e4 : 36e5);
    if (/昨天/.test(s)) return Date.now() - 864e5;
    m = s.match(/(\d+)\s*天前/); if (m) return Date.now() - (+m[1]) * 864e5;
    return null;
  }
  function reviewHeading() {
    return $$('h2, h3, h4, div, span, p').find(el => el.childElementCount <= 3 && /^\s*(网友)?(评价|点评)\s*[（(]\s*\d+\s*[)）]/.test((el.textContent || '').trim()) && (el.textContent || '').trim().length < 40);
  }
  function readShopPage() {
    const head = reviewHeading();
    const total = head ? toNum((head.textContent.match(/[（(]\s*(\d+)\s*[)）]/) || [])[1]) : null;
    // 评价区：从标题往上找，直到包含若干标签和评价
    let area = head; for (let k = 0; area && k < 6; k++) { if ((area.innerText || '').length > 400) break; area = area.parentElement; }
    area = area || document.body;
    const tags = []; const seenT = new Set();
    $$('a, span, div, li', area).forEach(el => {
      if (el.childElementCount > 2) return; const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 22 || /评价|点评|分钟前|小时前|查看全部|全部|^\d+$/.test(t)) return;
      const m = t.match(TAG_RE); if (!m) return; const name = m[1].trim(); if (name.length < 2 || seenT.has(name)) return;
      if (el.parentElement && TAG_RE.test((el.parentElement.innerText || '').trim()) && el.parentElement.childElementCount <= 2 && el.parentElement !== area) return; // 只取最外层
      seenT.add(name); tags.push({ name, n: +m[2] });
    });
    // 评价：先试老版结构，再用"日期 + 一段长文字"找
    let reviews = readReviews();
    if (!reviews.length) {
      const dateEls = $$('span, div, p, time', area).filter(el => el.childElementCount === 0 && /^(\d{1,2}月\d{1,2}日|20\d{2}[-./]\d{1,2}[-./]\d{1,2}|\d+\s*(分钟|小时|天)前|昨天)/.test((el.textContent || '').trim()));
      const blocks = new Set();
      dateEls.forEach(d => { let b = d; for (let k = 0; k < 8; k++) { const up = b.parentElement; if (!up || up === area || up === document.body) break; if (dateEls.filter(x => up.contains(x)).length > 1) break; b = up; } if (b && b !== d && (b.innerText || '').length > 15) blocks.add(b); });
      reviews = Array.from(blocks).map((b, k) => {
        const dEl = dateEls.find(d => b.contains(d)); const dateTxt = dEl ? dEl.textContent.trim() : '';
        const texts = $$('div, p, span', b).filter(x => x.childElementCount <= 3).map(x => clean(textOf(x))).filter(x => x.length >= 12 && !/^\d/.test(x)).sort((a, z) => z.length - a.length);
        const text = (texts[0] || '').replace(/(展开|收起)(全文|评价)?$/, '').trim(); if (!text) return null;
        const nameEl = $$('a, span', b).find(x => x.childElementCount === 0 && (x.textContent || '').trim().length >= 2 && (x.textContent || '').trim().length <= 16 && !/月|日|前|赞|回复|Lv/i.test(x.textContent));
        const starEl = $('[class*="star"]', b); const sm = starEl ? String(starEl.className).match(/(\d{2})/) : null;
        const starsOn = $$('[class*="star"] [class*="on"], [class*="star-on"], [class*="full"]', b).length;
        return { id: 'sp' + k + '|' + text.slice(0, 20), name: nameEl ? nameEl.textContent.trim() : '', text: text.slice(0, 1500), likes: 0, date: dateTxt, ts: parseCnDate(dateTxt), stars: sm ? +sm[1] / 10 : (starsOn >= 1 && starsOn <= 5 ? starsOn : null), scores: {}, dishes: [] };
      }).filter(Boolean);
    }
    const name = clean(($('h1, .shop-name, .shopName, [class*="shopName"], [class*="shop-name"]') || {}).textContent || '').slice(0, 40);
    const snippet = reviews.length ? '' : ((head && head.parentElement && head.parentElement.parentElement) || area).outerHTML.replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, '').replace(/\s(src|href|style|data-[\w-]+)="[^"]*"/g, '').slice(0, 6000);
    return { ok: true, name, total, tags: tags.slice(0, 40), reviews, gate: appGate(), diag: { platform: 'dianping-shop', href: location.href.slice(0, 120), total, tags: tags.length, shown: reviews.length, snippet } };
  }

  // ---------- 加密字还原（svgmtsi + CSS 雪碧图） ----------
  let decoder = null;
  const fetchText = url => new Promise(res => { try { chrome.runtime.sendMessage({ type: 'rm:fetchText', url }, r => res(r && r.ok ? r.text : '')); } catch (e) { res(''); } });
  async function buildDecoder() {
    if (decoder) return decoder;
    decoder = { map: {}, ok: false, miss: 0 };
    const link = $$('link[rel="stylesheet"]').map(l => l.href).find(h => /svgtextcss/.test(h));
    if (!link) return decoder;
    const css = await fetchText(link); if (!css) return decoder;
    // 每个前缀对应一张 SVG：svgmtsi[class^="ab"]{width:14px;...background-image:url(//...svg)}
    const sheets = [];
    css.replace(/\[class\^="(\w+)"\][^{]*\{([^}]*)\}/g, (m, pre, body) => { const u = body.match(/url\(([^)]+)\)/); const w = body.match(/width:\s*([\d.]+)px/); if (u) sheets.push({ pre, url: u[1].replace(/["']/g, ''), size: w ? +w[1] : 14 }); return m; });
    const svgCache = {};
    for (const s of sheets) {
      const url = s.url.startsWith('//') ? 'https:' + s.url : s.url;
      if (!svgCache[url]) svgCache[url] = parseSvg(await fetchText(url));
      s.rows = svgCache[url];
    }
    css.replace(/\.(\w+)\s*\{\s*background:\s*-?([\d.]+)px\s+-?([\d.]+)px;?\s*\}/g, (m, cls, x, y) => {
      const s = sheets.filter(k => cls.startsWith(k.pre)).sort((a, b) => b.pre.length - a.pre.length)[0]; if (!s || !s.rows || !s.rows.length) return m;
      const row = s.rows.find(r => r.y >= +y); if (!row) return m;
      const ch = row.text[Math.round(+x / s.size)]; if (ch) decoder.map[cls] = ch; return m;
    });
    decoder.ok = Object.keys(decoder.map).length > 0;
    return decoder;
  }
  function parseSvg(svg) {
    if (!svg) return [];
    const rows = [];
    const paths = {}; svg.replace(/<path[^>]*id="([^"]+)"[^>]*d="M\s*[\d.]+\s+([\d.]+)/g, (m, id, y) => { paths[id] = +y; return m; });
    svg.replace(/<textPath[^>]*href="#([^"]+)"[^>]*>([^<]*)<\/textPath>/g, (m, id, t) => { if (paths[id] !== undefined) rows.push({ y: paths[id], text: t }); return m; });
    if (!rows.length) svg.replace(/<text[^>]*y="([\d.]+)"[^>]*>([^<]*)<\/text>/g, (m, y, t) => { rows.push({ y: +y, text: t }); return m; });
    return rows.sort((a, b) => a.y - b.y);
  }
  function textOf(el) {
    if (!el) return '';
    let out = '';
    el.childNodes.forEach(n => {
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.nodeType === 1) {
        const tag = n.tagName.toLowerCase();
        if (tag === 'svgmtsi') { const ch = decoder && decoder.map[n.className]; if (ch) out += ch; else if (decoder) decoder.miss++; }
        else if (tag === 'br') out += '\n';
        else if (tag === 'img') { const a = n.getAttribute('alt') || ''; if (a && a.length < 8) out += a; }
        else if (!/less-words|fold|unfold|review-truncated-words/.test(n.className || '') && !/^(收起评价|展开评价)$/.test((n.textContent || '').trim())) out += textOf(n);
      }
    });
    // 自定义字体里的私有区字符认不出，去掉
    return out.replace(/[-]/g, () => { if (decoder) decoder.miss++; return ''; });
  }
  const clean = s => String(s || '').replace(/收起评价|展开评价/g, '').replace(/[ \t ]+/g, ' ').replace(/\n{2,}/g, '\n').trim();

  // ---------- 店铺列表 ----------
  function shopIdOf(href) { const m = String(href || '').match(/\/shop\/([A-Za-z0-9]+)/); return m ? m[1] : ''; }
  async function collectList(limit) {
    await buildDecoder();
    const out = new Map();
    const read = () => {
      const anchors = $$('#shop-all-list a[href*="/shop/"], .shop-list a[href*="/shop/"], a[data-shopid]');
      anchors.forEach(a => {
        const id = a.getAttribute('data-shopid') || shopIdOf(a.href); if (!id || out.has(id)) return;
        const li = a.closest('li') || a.parentElement;
        const name = clean(textOf($('h4', a) || $('h4', li) || a)) || a.getAttribute('title') || '';
        if (!name || name.length > 40 || /写点评|团购|优惠|地图/.test(name)) return;
        const tags = $$('.tag-addr .tag, .tag-addr a .tag', li).map(x => clean(textOf(x))).filter(Boolean);
        const dishes = $$('.recommend a, .recommend-click', li).map(x => clean(x.textContent)).filter(Boolean).slice(0, 6);
        const price = toNum(clean(textOf($('.mean-price b', li) || $('.mean-price', li))));
        const reviews = toNum(clean(textOf($('.review-num b', li) || $('.review-num', li))));
        const star = (($('[class*="star_"], [class*="sml-str"], .star', li) || {}).className || '').match(/(?:star_|sml-str)(\d+)/);
        const addr = clean(textOf($('.addr', li)));
        out.set(id, { id, url: `https://www.dianping.com/shop/${id}/review_all`, title: name, author: '', likes: reviews, comments: reviews, collects: null, shares: null, time: null, type: 'shop',
          poi: [tags[1], addr].filter(Boolean).join(' '), area: tags[1] || '', addr, price, cat: tags[0] || '', dishes, stars: star ? +star[1] / 10 : null });
      });
    };
    read();
    // 翻 1–2 页
    for (let p = 0; p < 2 && out.size < limit; p++) {
      const next = $('.page a.next') || $$('.page a, .pages a').find(a => /下一页/.test(a.textContent));
      if (!next) break;
      window.scrollTo(0, document.body.scrollHeight); await sleep(rand(800, 1500));
      const before = out.size; next.click(); await sleep(rand(2500, 4000)); read();
      if (out.size === before) break;
    }
    return Array.from(out.values()).slice(0, limit);
  }

  // ---------- 评价 ----------
  function parseDate(s) { const m = String(s || '').match(/(\d{4})[-./年](\d{1,2})[-./月](\d{1,2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null; }
  function readReviews() {
    const lis = $$('.reviews-items > ul > li');
    const items = lis.length ? lis : $$('.main-review').map(x => x.closest('li') || x);
    return items.map((li, k) => {
      const words = $('.review-words', li) || $('.review-truncated-words', li) || $('.desc', li);
      let text = clean(textOf(words));
      if (!text) return null;
      const starCls = (($('[class*="sml-str"]', li) || $('[class*="star_"]', li) || {}).className || '').match(/(?:sml-str|star_)(\d+)/);
      const scores = {}; let price = null;
      $$('.review-rank .score .item, .score .item', li).forEach(x => { const t = clean(x.textContent); const m = t.match(/^(.{1,4})[:：]\s*([\d.]+)/); if (!m) return; if (/人均/.test(m[1])) price = +m[2]; else scores[m[1]] = +m[2]; });
      const dishes = $$('.review-recommend a, .review-recommend .col-exp', li).map(x => clean(x.textContent)).filter(x => x && x.length < 16);
      const timeTxt = clean(($('.misc-info .time', li) || $('.time', li) || {}).textContent || '');
      const praise = clean(($('.actions .praise', li) || $$('.actions a', li).find(a => /赞/.test(a.textContent)) || {}).textContent || '');
      const name = clean(($('.dper-info .name', li) || $('.name', li) || {}).textContent || '');
      const id = li.getAttribute('data-id') || ($('[data-id]', li) || { getAttribute: () => '' }).getAttribute('data-id') || (name + '|' + text.slice(0, 20) + '|' + k);
      return { id, name, text: text.slice(0, 1500), likes: toNum(praise.replace(/[^\d.]/g, '')) || 0, date: timeTxt.replace(/^更新于/, '').slice(0, 16), ts: parseDate(timeTxt), stars: starCls ? +starCls[1] / 10 : null, scores, price, dishes };
    }).filter(Boolean);
  }
  async function readPost(max) {
    await waitFor(() => $('.reviews-items, .main-review, .review-words') || blocked() || appGate() || $('.no-review, .empty'), 12000);
    const b = blocked(); if (b) return { ok: false, blocked: b };
    if (!$('.reviews-items, .main-review, .review-words') && appGate()) return { ok: true, comments: [], appGate: true, post: {}, diag: { platform: 'dianping', appGate: true, href: location.href.slice(0, 120) } };
    await buildDecoder();
    // 展开所有"展开评价"
    $$('.review-words .fold, a.unfold').forEach(a => { try { a.click(); } catch (e) { /* 忽略 */ } });
    // 像人一样往下看一遍
    for (let y = 0; y < 4; y++) { window.scrollBy(0, 700); await sleep(rand(500, 900)); }
    const reviews = readReviews();
    const shopName = clean(($('.review-shop-wrap .shop-name, h1.shop-name, .shop-name, .shop-title') || {}).textContent || '').replace(/添加分店|写点评.*/g, '').slice(0, 40);
    const avg = clean(($('.rank-info .price, .avgPriceTitle, #avgPriceTitle') || {}).textContent || '');
    const nextA = $('.reviews-pages a.NextPage') || $$('.reviews-pages a, .page a').find(a => /下一页/.test(a.textContent));
    let next = max === 0 ? null : (nextA && nextA.href && !/javascript/.test(nextA.href) ? nextA.href : null);
    const q = location.search;
    if (next && q && !next.includes('?')) next += q; // 翻页时保留"按最新排序"
    const latestA = $$('.reviews-sort a, .sort-selection-list a, .tabs a, a').find(a => /^\s*最新(点评|评价)?\s*$/.test(a.textContent || '') && a.href && !/javascript/.test(a.href));
    const isLatest = /latest|sortType=1|time/i.test(location.search) || !!$('.reviews-sort .cur, .sort-selection-list .cur, .tabs .cur, .active') && /最新/.test(($('.reviews-sort .cur, .sort-selection-list .cur, .tabs .cur, .active') || {}).textContent || '');
    const totalTxt = clean(($('.reviews-title .count, .reviews-header .count, .review-count, .count') || {}).textContent || '');
    const diag = { platform: 'dianping', src: 'dom', shown: reviews.length, decoder: decoder ? { ok: decoder.ok, n: Object.keys(decoder.map).length, miss: decoder.miss } : null, href: location.href.slice(0, 120),
      classes: reviews.length ? [] : Array.from(new Set($$('[class]').slice(0, 400).map(e => String(e.className).split(' ')[0]).filter(c => /review|comment|item|words/i.test(c)))).slice(0, 25) };
    return { ok: true, post: { title: shopName, desc: avg, type: 'shop' }, comments: reviews.slice(0, Math.max(0, max)), next, latest: latestA ? latestA.href : null, isLatest, total: toNum(totalTxt), diag, blocked: blocked() };
  }

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg.type === 'rm:status') { reply({ ok: true, blocked: blocked(), url: location.href, ready: document.readyState, cityId: cookie('cy') || '' }); return false; }
    if (msg.type === 'rm:readShop') {
      (async () => {
        await waitFor(() => reviewHeading() || blocked(), 12000);
        const b = blocked(); if (b) return reply({ ok: false, blocked: b });
        await buildDecoder();
        for (let y = 0; y < 5; y++) { window.scrollBy(0, 600); await sleep(rand(400, 800)); }
        reply(readShopPage());
      })().catch(e => reply({ ok: false, error: e.message }));
      return true;
    }
    if (msg.type === 'rm:collectList') {
      (async () => {
        await waitFor(() => $('#shop-all-list, .shop-list, a[data-shopid]') || blocked() || $('.not-found, .no-result'), 12000);
        const b = blocked(); if (b) return reply({ ok: false, blocked: b });
        reply({ ok: true, list: await collectList(msg.limit || 30), blocked: blocked() });
      })().catch(e => reply({ ok: false, error: e.message }));
      return true;
    }
    if (msg.type === 'rm:readPost') { readPost(msg.maxComments === 0 ? 0 : (msg.maxComments || 30)).then(reply).catch(e => reply({ ok: false, error: e.message })); return true; }
    return false;
  });
})();
