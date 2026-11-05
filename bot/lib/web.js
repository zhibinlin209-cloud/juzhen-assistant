/* 驾驶舱网页服务：只监听本机 127.0.0.1，由网站 work.yesyueji.com/cockpit/ 转发进来
 * 登录：简报私聊里附带一次性链接 → 写入 30 天的登录 Cookie（只有老板的飞书账号能生成）
 */
'use strict';
const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DAY = 864e5;

function createWeb({ cfg, brief, log, activity, bossId, port, dispatch, download, registerLinks, ownlib, official, exporter, dailyCheck, annualFacts, drafts, campaign, creator, creatorLast, studioSetup, studioDedupe, studio, rows, tgtIngest }) {
  const key = crypto.createHash('sha256').update('xiju-cockpit:' + (cfg.appSecret || '') + ':' + (cfg.cockpitSalt || '')).digest();
  const b64 = b => Buffer.from(b).toString('base64url');
  const sign = (who, exp, kind) => { const body = `${kind}.${who}.${exp}`; return b64(body) + '.' + crypto.createHmac('sha256', key).update(body).digest('base64url'); };
  const verify = (tok, kind) => { try { const [b, sig] = String(tok || '').split('.'); const body = Buffer.from(b, 'base64url').toString(); const good = crypto.createHmac('sha256', key).update(body).digest('base64url'); if (!sig || sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null; const [k, who, exp] = body.split('.'); if (k !== kind || Date.now() > +exp) return null; if (who !== bossId()) return null; return who; } catch (e) { return null; } };
  const base = (cfg.cockpitUrl || 'https://work.yesyueji.com/cockpit/').replace(/\/?$/, '/');
  // 领稿页：每条稿件一个签名链接（30 天有效），发布人不用登录
  const tsign = (id, exp) => { const body = `T.${id}.${exp}`; return b64(body) + '.' + crypto.createHmac('sha256', key).update(body).digest('base64url'); };
  const tverify = tok => { try { const [b, sig] = String(tok || '').split('.'); const body = Buffer.from(b, 'base64url').toString(); const good = crypto.createHmac('sha256', key).update(body).digest('base64url'); if (!sig || sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null; const [k, id, exp] = body.split('.'); if (k !== 'T' || Date.now() > +exp || !/^rec[A-Za-z0-9]+$/.test(id)) return null; return id; } catch (e) { return null; } };
  function taskLink(id) { return `${base}t/${tsign(id, Date.now() + 30 * DAY)}`; }
  const mcache = new Map(); let msize = 0;
  async function media(tokn, url) { if (mcache.has(tokn)) return mcache.get(tokn); const buf = await download(url); mcache.set(tokn, buf); msize += buf.length; while (msize > 150e6 && mcache.size > 1) { const [k, v] = mcache.entries().next().value; mcache.delete(k); msize -= v.length; } return buf; }
  async function task(req, res, p) {
    const m = p.match(/^\/t\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)(\/.*)?$/); const id = m && tverify(m[1]); if (!id || !dispatch) return send(res, 403, '{"error":"链接失效"}');
    const sub = m[2] || '/'; const mb = `${base}t/${m[1]}`;
    if (sub === '/' ) { const h = page('task.html'); return h ? send(res, 200, h, 'text/html; charset=utf-8') : send(res, 503, '页面更新中'); }
    let r; try { r = await dispatch.getRec(id); } catch (e) { if (/RecordIdNotFound|1254043/.test(e.message)) return send(res, 404, '{"error":"这条稿件已被删除"}'); throw e; }
    if (sub === '/data') return send(res, 200, JSON.stringify(dispatch.view(r, mb)));
    const mm = sub.match(/^\/m\/(\d+)$/);
    if (mm && req.method === 'GET') {
      const x = (r.f['素材'] || [])[+mm[1]]; if (!x) return send(res, 404, '{}');
      const buf = await media(x.file_token, x.url); const type = x.type || (/\.(mp4|m4v)$/i.test(x.name || '') ? 'video/mp4' : 'image/jpeg');
      const extra = { 'cache-control': 'private, max-age=3600', 'accept-ranges': 'bytes' }; const u = new URL(req.url, 'http://x');
      if (u.searchParams.get('dl')) extra['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(x.name || 'file')}`;
      const rg = String(req.headers.range || '').match(/bytes=(\d*)-(\d*)/);
      if (rg) { const a = rg[1] ? +rg[1] : 0, b = rg[2] ? Math.min(+rg[2], buf.length - 1) : buf.length - 1; res.writeHead(206, Object.assign({ 'content-type': type, 'content-range': `bytes ${a}-${b}/${buf.length}`, 'content-length': b - a + 1 }, extra)); return res.end(buf.subarray(a, b + 1)); }
      res.writeHead(200, Object.assign({ 'content-type': type, 'content-length': buf.length }, extra)); return res.end(buf);
    }
    if (sub === '/links' && req.method === 'POST') {
      let b = ''; for await (const c of req) { b += c; if (b.length > 8000) break; }
      const text = String((JSON.parse(b || '{}')).text || '').slice(0, 4000); if (!/https?:\/\//.test(text)) return send(res, 200, JSON.stringify({ ok: false, text: '没看到链接，请粘贴各平台的分享链接' }));
      const who = String(dispatch.view(r, mb).who || '');
      let msg = ''; try { msg = await registerLinks(text, who); } catch (e) { msg = '⚠️ 数据表登记出错：' + e.message.slice(0, 80); }
      const done = await dispatch.markDone(id, text); log(`[领稿] ${who} 提交链接${done ? '，已改为已发布' : ''}`);
      return send(res, 200, JSON.stringify({ ok: true, text: (msg || '已收到链接') + (done ? '\n✅ 派稿状态已改成「已发布」' : '') }));
    }
    return send(res, 404, '{}');
  }
  function loginLink() { const b = bossId(); return b ? `${base}login?t=${sign(b, Date.now() + 7 * DAY, 'L')}` : ''; }

  const cookie = req => { const m = String(req.headers.cookie || '').match(/(?:^|;\s*)xck=([^;]+)/); return m ? m[1] : ''; };
  const send = (res, code, body, type, extra) => { res.writeHead(code, Object.assign({ 'content-type': type || 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }, extra || {})); res.end(body); };
  const page = p => { try { return fs.readFileSync(path.join(__dirname, '..', 'cockpit', p)); } catch (e) { return null; } };

  let cache = null;
  async function state() {
    if (cache && Date.now() - cache.at < 3 * 60e3) return cache.v;
    const [F, todos, last, adsA, pipe, deepA] = await Promise.all([brief.facts(), brief.listTodos().catch(() => []), brief.latest().catch(() => null), brief.latestAds ? brief.latestAds().catch(() => null) : null, dispatch && dispatch.pipeline ? dispatch.pipeline().catch(() => null) : null, brief.latestKind ? brief.latestKind('内容分析').catch(() => null) : null]);
    const A = activity();
    const fmt = n => n == null ? '—' : Math.round(n).toLocaleString('en-US');
    const pct = x => x == null ? '—' : (x > 0 ? '+' : '') + Math.round(x * 1000) / 10 + '%';
    const hm = t => t ? new Date(t + 8 * 3600e3).toISOString().slice(11, 16) : '—';
    const open = todos.filter(t => t.status === '待定');
    const reported = F.stores.length, known = reported + F.missing.length;
    const bad = F.stores.reduce((s, r) => s + r.dpBad + r.mtBad + (r.wmBad || 0) + (r.dyBad || 0), 0);
    const C = F.content || {}; const cy = Object.values(C).reduce((s, v) => s + v.yesterday, 0), c7 = Object.values(C).reduce((s, v) => s + v.last7, 0);
    const v = {
      sample: false, boss: cfg.bossName || '林智斌', briefTime: cfg.briefTime || '09:00', date: F.date, weekday: F.weekday, now: Date.now(),
      ceo: { patrols: A.patrols, reports: A.count('ceo'), say: (F.alerts[0] ? F.alerts.slice(0, 2).join('；') : (reported ? `昨天 ${reported} 家店营业额合计 ${fmt(F.total)}${F.totalWow != null ? '，比上周同日 ' + pct(F.totalWow) : ''}` : '昨天还没有收到门店日报')) + (F.suggest.length ? `；${F.suggest.length} 条内容值得投放还没投` : '') + '。', last: hm(A.last('ceo').at) },
      agents: [
        { key: 'biz', name: '经营 Agent', hue: 'amber', status: 'ok', big: reported ? fmt(F.total) : '—', unit: '元 · 昨天合计', last: `${hm(A.last('biz').at)} ${A.last('biz').what || '等日报'}`, next: '每 10 分钟', up: `日报 ${hm(A.last('biz').at)}`, down: '补收 每10分钟',
          sub: [['日报已收', known ? `${reported} / ${known} 家` : '—'], ['比上周同日', pct(F.totalWow)], ['近7天同比去年', pct(F.totalYoy7)], ['未收到', F.missing.slice(0, 3).join('、') || '无']],
          kids: F.stores.slice(0, 6).map(r => ({ name: r.store.replace(/^(深圳|广州|佛山|珠海|东莞|惠州)/, ''), note: r.wow != null ? '比上周 ' + pct(r.wow) : '无上周数据', val: fmt(r.revenue), tone: r.wow != null && r.wow < -0.15 ? 'bad' : 'ok' })) },
        { key: 'content', name: '内容 Agent', hue: 'cyan', status: 'ok', big: String(cy), unit: '条 · 昨天发布', last: `${hm(A.last('content').at)} ${A.last('content').what || '—'}`, next: '随群消息', up: `登记 今天 ${A.count('content')} 次`, down: '截图/分享 随到随办',
          sub: [['近 7 天', `${c7} 条`], ['今日派稿', pipe ? `${pipe.done} / ${pipe.today} 已发` : '—'], ['稿件库待派', pipe ? `${pipe.unassigned} 篇` : '—']],
          kids: Object.entries(C).map(([p, x]) => ({ name: p, note: `近7天 ${x.last7} 条`, val: `${x.yesterday}`, tone: x.yesterday ? 'ok' : 'warn' })) },
        { key: 'ads', name: '投放 Agent', hue: 'green', status: F.suggest.length ? 'wait' : 'ok', big: String(F.suggest.length), unit: '条 · 建议投放', last: `${hm(A.last('ceo').at)} 筛选`, next: `明天 ${cfg.briefTime || '09:00'}`, up: `建议 ${F.suggest.length} 条`, down: '按档案标准筛选',
          sub: [['推广通 近7天', F.tgt ? `${fmt(F.tgt.spend7)} 元 / ${F.tgt.orders7} 单（${F.tgt.dOrders}）` : '等报表接入'], ['推广通建议', F.tgt ? (['可加投', '要调整', '检查'].map(k => [k, F.tgt.stores.filter(o => o.verdict === k).length]).filter(x => x[1]).map(x => x[0] + ' ' + x[1]).join(' · ') || '都维持') : '—'], ['聚光', '接口待申请'], ['本地推', '接口待申请']],
          kids: F.suggest.concat(F.hot.filter(h => !F.suggest.includes(h) && !h.boosted)).slice(0, 5).map(h => ({ name: `${h.acc}`, note: `${h.plat} · ${F.suggest.includes(h) ? '建议投' : (h.why || '')}`, val: fmt(h.views), tone: F.suggest.includes(h) ? 'ok' : 'warn' })) },
        { key: 'rep', name: '口碑 Agent', hue: 'rose', status: bad ? 'wait' : 'ok', big: String(bad), unit: '条 · 昨天差评', last: `${hm(A.last('biz').at)} 读日报`, next: '每 10 分钟', up: `差评 ${bad} 条`, down: '评分随日报更新',
          sub: [['评分下降', `${F.alerts.filter(a => /评分/.test(a)).length} 家`], ['外卖评分', F.stores.some(r => r.wmScore != null) ? '已接入' : '日报待加'], ['抖音评分', F.stores.some(r => r.dyScore != null) ? '已接入' : '日报待加']],
          kids: F.stores.filter(r => r.dpScore != null || r.mtScore != null).slice(0, 6).map(r => { const b = r.dpBad + r.mtBad + (r.wmBad || 0) + (r.dyBad || 0); return { name: r.store.replace(/^(深圳|广州|佛山|珠海|东莞|惠州)/, ''), note: `点评 ${r.dpScore ?? '—'} · 美团 ${r.mtScore ?? '—'}`, val: b ? `差评 ${b}` : '0', tone: b ? 'bad' : 'ok' }; }) }
      ],
      todos: todos.filter(t => t.status === '待定' || Date.now() - t.last < 3 * DAY).slice(0, 20),
      stores: F.stores.map(r => ({ store: r.store, revenue: r.revenue, wow: r.wow, yoy: r.yoy ?? null, yoy7: r.yoy7 ?? null, bad: r.dpBad + r.mtBad + (r.wmBad || 0) + (r.dyBad || 0), dp: r.dpScore, mt: r.mtScore, wm: r.wmScore ?? null, dy: r.dyScore ?? null, dpBad: r.dpBad, mtBad: r.mtBad, wmBad: r.wmBad || 0, dyBad: r.dyBad || 0, dpPrev: r.dpScorePrev, mtPrev: r.mtScorePrev })),
      rules: { scoreMin: 4.5, minBy: Object.assign({ dp: null, mt: 4.5, wm: 4.5, dy: 4.5 }, cfg.scoreMinBy || {}), engXhs: 5, engDy: 3, minXhs: 1000, minDy: 3000, hotTimes: 2 },
      content: F.content, top7: F.top7 || [], hot: F.hot, tgt: F.tgt || null, ads: adsA ? { text: adsA.text, at: adsA.at, by: adsA.by } : null, deep: deepA ? { text: deepA.text, at: deepA.at, by: deepA.by } : null, pipe: pipe || null,
      missing: F.missing, brief: last ? last.text : '', briefAt: last ? last.at : 0,
      suggest: F.suggest, near: F.hot.filter(h => !F.suggest.includes(h) && !h.boosted).slice(0, 6), spend: [], notes: F.notes
    };
    cache = { at: Date.now(), v }; return v;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x'); let p = u.pathname.replace(/^\/cockpit/, '') || '/';
      if (p.startsWith('/t/')) return await task(req, res, p);
      if (p.startsWith('/lib/') && ownlib) { // 插件「自家内容入库」/ 官方号同步（凭口令，允许从创作者后台页面直接提交）
        const cors = { 'access-control-allow-origin': req.headers.origin && /^https:\/\/(creator\.douyin\.com|channels\.weixin\.qq\.com)$/.test(req.headers.origin) ? req.headers.origin : 'null', 'access-control-allow-headers': 'content-type, x-rm-key', 'access-control-allow-methods': 'GET, POST' };
        if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain', cors);
        const sendc = (r, c, b, t, e) => send(r, c, b, t, Object.assign({}, cors, e || {}));
        if (!ownlib.okKey(req.headers['x-rm-key'])) return sendc(res, 403, JSON.stringify({ ok: false, error: '入库口令不对' }));
        if (p === '/lib/todo' && req.method === 'GET') return sendc(res, 200, JSON.stringify(Object.assign({ ok: true }, await ownlib.todo(u.searchParams.get('limit')), { stats: ownlib.stats() })));
        if (p === '/lib/note' && req.method === 'POST') { let b = ''; for await (const c of req) { b += c; if (b.length > 600000) return sendc(res, 413, '{"ok":false,"error":"太大"}'); } try { return sendc(res, 200, JSON.stringify(await ownlib.ingest(JSON.parse(b || '{}')))); } catch (e) { log('[内容库] 入库失败：' + e.message); return sendc(res, 200, JSON.stringify({ ok: false, error: e.message.slice(0, 120) })); } }
        if (p === '/lib/market' && req.method === 'POST') { let b = ''; for await (const c of req) { b += c; if (b.length > 600000) return sendc(res, 413, '{"ok":false}'); } try { return sendc(res, 200, JSON.stringify(await ownlib.market(JSON.parse(b || '{}')))); } catch (e) { log('[同类爆款] 入库失败：' + e.message); return sendc(res, 200, JSON.stringify({ ok: false, error: e.message.slice(0, 120) })); } }
        if (p === '/lib/market-seen' && req.method === 'GET') return sendc(res, 200, JSON.stringify({ ok: true, ids: ownlib.marketSeen() }));
        if (p === '/lib/latest' && req.method === 'GET') return sendc(res, 200, JSON.stringify(await brief.latestKind(String(u.searchParams.get('kind') || '经营复盘'))));
        if (p === '/lib/camp/create' && req.method === 'POST' && campaign) { let b = ''; for await (const c of req) { b += c; if (b.length > 500000) break; } const j = JSON.parse(b || '{}'); const r = await campaign.create(j.name, j.rows || []); campaign.crawl(r.table).catch(e => log('[链接追踪] 读取出错：' + e.message)); if (campaign.remember) campaign.remember(r.table); return sendc(res, 200, JSON.stringify(Object.assign({ ok: true }, r))); }
        if (p === '/lib/camp/status' && req.method === 'GET' && campaign) return sendc(res, 200, JSON.stringify(await campaign.status(String(u.searchParams.get('name') || ''))));
        if (p === '/lib/camp/list' && req.method === 'GET' && campaign) return sendc(res, 200, JSON.stringify({ ok: true, names: campaign.names ? campaign.names() : [] }));
        if (p === '/lib/camp/pending' && req.method === 'GET' && campaign) return sendc(res, 200, JSON.stringify({ ok: true, items: await campaign.pending(String(u.searchParams.get('name') || ''), u.searchParams.get('all') === '1') }));
        if (p === '/lib/camp/note' && req.method === 'POST' && campaign) { let b = ''; for await (const c of req) { b += c; if (b.length > 300000) break; } const j = JSON.parse(b || '{}'); try { return sendc(res, 200, JSON.stringify(await campaign.writeNote(String(j.name || ''), String(j.rec || ''), j.note, j.error))); } catch (e) { return sendc(res, 200, JSON.stringify({ ok: false, error: e.message.slice(0, 100) })); } }
        if (p === '/lib/log' && req.method === 'GET') { const q = String(u.searchParams.get('q') || ''); let t = ''; try { const fs2 = require('fs'), pth = require('path'); const f = pth.join(process.env.BOT_DATA_DIR || pth.join(__dirname, '..'), 'bot.log'); const st = fs2.statSync(f); const fd = fs2.openSync(f, 'r'); const len = Math.min(st.size, 400000); const b = Buffer.alloc(len); fs2.readSync(fd, b, 0, len, st.size - len); fs2.closeSync(fd); t = b.toString('utf8'); } catch (e) { t = 'ERR ' + e.message; } const lines = t.split('\n').filter(l => !q || l.includes(q)).slice(-40).map(l => l.slice(0, 300)); return sendc(res, 200, JSON.stringify({ lines })); }
        if (p === '/lib/camp/move' && req.method === 'POST' && campaign) { try { return sendc(res, 200, JSON.stringify(Object.assign({ ok: true }, await campaign.moveToMarketing(String(u.searchParams.get('name') || ''))))); } catch (e) { return sendc(res, 200, JSON.stringify({ ok: false, error: e.message.slice(0, 200) })); } }
        if (p === '/lib/camp/crawl' && req.method === 'POST' && campaign) { const n = String(u.searchParams.get('name') || ''); campaign.crawl(n).catch(e => log('[链接追踪] 读取出错：' + e.message)); return sendc(res, 200, '{"ok":true}'); }
        if (p === '/lib/studio/covertest' && req.method === 'GET' && studio) { try { const b = await studio().coverTest(String(u.searchParams.get('store') || ''), String(u.searchParams.get('plan') || '')); return b ? sendc(res, 200, b, 'image/jpeg') : sendc(res, 200, JSON.stringify({ ok: false, error: require('./cover').error() || '没图' })); } catch (e) { return sendc(res, 200, JSON.stringify({ ok: false, error: e.message.slice(0, 300) })); } }
        if (p === '/lib/studio/coverize' && req.method === 'POST' && studio) { try { return sendc(res, 200, JSON.stringify(await studio().coverize(+u.searchParams.get('n') || 10))); } catch (e) { return sendc(res, 200, JSON.stringify({ ok: false, error: e.message.slice(0, 300) })); } }
        if (p === '/lib/studio/tag' && req.method === 'POST' && studio) { try { return sendc(res, 200, JSON.stringify(await studio().tagLib(+u.searchParams.get('n') || 60, String(u.searchParams.get('store') || '')))); } catch (e) { return sendc(res, 200, JSON.stringify({ ok: false, error: e.message.slice(0, 300) })); } }
        if (p === '/lib/studio/libstats' && req.method === 'GET' && studio) { try { return sendc(res, 200, JSON.stringify(await studio().libStats())); } catch (e) { return sendc(res, 200, JSON.stringify({ ok: false, error: e.message.slice(0, 300) })); } }
        if (p === '/lib/studio/rejudge' && req.method === 'POST' && studio) { try { return sendc(res, 200, JSON.stringify(await studio().rejudge())); } catch (e) { return sendc(res, 200, JSON.stringify({ ok: false, error: e.message.slice(0, 300) })); } }
        if (p === '/lib/studio/importpai' && req.method === 'POST' && studio) { try { return sendc(res, 200, JSON.stringify(await studio().importPai(+u.searchParams.get('n') || 300))); } catch (e) { return sendc(res, 200, JSON.stringify({ ok: false, error: e.message.slice(0, 300) })); } }
        if (p === '/lib/studio/import' && req.method === 'POST' && studio) { try { return sendc(res, 200, JSON.stringify(await studio().importLib(+u.searchParams.get('n') || 200))); } catch (e) { return sendc(res, 200, JSON.stringify({ ok: false, error: e.message.slice(0, 300) })); } }
        if (p === '/lib/studio/dedupe' && req.method === 'POST' && studioDedupe) return sendc(res, 200, JSON.stringify(await studioDedupe()));
        if (p === '/lib/studio/setup' && req.method === 'POST' && studioSetup) { try { return sendc(res, 200, JSON.stringify(await studioSetup())); } catch (e) { return sendc(res, 200, JSON.stringify({ ok: false, error: e.message.slice(0, 300) })); } }
        if (p === '/lib/create/last' && req.method === 'GET' && creatorLast) return sendc(res, 200, JSON.stringify(creatorLast()));
        if (p === '/lib/create' && req.method === 'POST' && creator) { try { return sendc(res, 200, JSON.stringify(await creator({ n: +u.searchParams.get('n') || 2, store: u.searchParams.get('store') || '' }))); } catch (e) { return sendc(res, 200, JSON.stringify({ ok: false, error: e.message.slice(0, 200) })); } }
        if (p === '/lib/draft' && req.method === 'GET' && drafts) { const k = u.searchParams.get('kind'); const r = await (k === 'deep' ? drafts.deep() : drafts.annual()); return sendc(res, 200, JSON.stringify({ text: r.text, by: r.by, raw: r.raw, bad: r.bad })); }
        if (p === '/lib/annualfacts' && req.method === 'GET' && annualFacts) return sendc(res, 200, JSON.stringify(await annualFacts()));
        if (p === '/lib/rows' && req.method === 'GET' && rows) { try { return sendc(res, 200, JSON.stringify(await rows(String(u.searchParams.get('table') || ''), +u.searchParams.get('days') || 45))); } catch (e) { return sendc(res, 200, JSON.stringify({ ok: false, error: e.message.slice(0, 300) })); } }
        if (p === '/lib/tgt/ingest' && req.method === 'POST' && tgtIngest) { let b = ''; for await (const c of req) { b += c; if (b.length > 8e6) break; } try { const j = JSON.parse(b); return sendc(res, 200, JSON.stringify(await tgtIngest(Buffer.from(j.b64, 'base64')))); } catch (e) { return sendc(res, 200, JSON.stringify({ ok: false, error: e.message.slice(0, 300) })); } }
        if (p === '/lib/dailycheck' && req.method === 'GET' && dailyCheck) return sendc(res, 200, JSON.stringify(await dailyCheck()));
        if (p === '/lib/export' && req.method === 'GET' && exporter) return sendc(res, 200, JSON.stringify(await exporter()));
        if (p === '/lib/official' && req.method === 'POST' && official) { let b = ''; for await (const c of req) { b += c; if (b.length > 4e6) return sendc(res, 413, '{"ok":false,"error":"太大"}'); } try { return sendc(res, 200, JSON.stringify(await official.sync(JSON.parse(b || '{}')))); } catch (e) { log('[官方号] 同步失败：' + e.message); return sendc(res, 200, JSON.stringify({ ok: false, error: e.message.slice(0, 120) })); } }
        return sendc(res, 404, '{}');
      }
      if (p === '/login') { const who = verify(u.searchParams.get('t'), 'L'); if (!who) return send(res, 403, '<meta charset="utf-8"><p style="font:16px sans-serif;padding:24px">登录链接无效或已过期。请在飞书里给机器人的「经营日报」群发「驾驶舱」，拿一个新链接。</p>', 'text/html; charset=utf-8'); log('[驾驶舱] 老板登录'); return send(res, 302, '', 'text/plain', { location: base, 'set-cookie': `xck=${sign(who, Date.now() + 30 * DAY, 'S')}; Path=/cockpit/; Max-Age=${30 * 86400}; HttpOnly; Secure; SameSite=Lax` }); }
      const who = verify(cookie(req), 'S');
      if (p === '/' || p === '/index.html') { const h = page('index.html'); if (!h) return send(res, 503, '驾驶舱页面还在更新，请 5 分钟后再刷新', 'text/plain; charset=utf-8'); if (!who) return send(res, 401, '<meta charset="utf-8"><meta name="viewport" content="width=device-width"><p style="font:16px sans-serif;padding:24px;line-height:1.7">这是禧聚的经营驾驶舱，需要登录。<br>请在飞书「经营日报」群里发「<b>驾驶舱</b>」，机器人会私聊你一个登录链接。</p>', 'text/html; charset=utf-8'); return send(res, 200, '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="robots" content="noindex"><style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}</style></head><body>' + h + '</body></html>', 'text/html; charset=utf-8'); }
      if (!who) return send(res, 401, JSON.stringify({ error: '需要登录' }));
      if (p === '/api/state' && req.method === 'GET') return send(res, 200, JSON.stringify(await state()));
      if (p === '/api/todo' && req.method === 'POST') { let b = ''; for await (const c of req) { b += c; if (b.length > 4096) break; } const j = JSON.parse(b || '{}'); await brief.setTodo(String(j.id || ''), String(j.status || '')); cache = null; log(`[驾驶舱] 待办 ${j.id} → ${j.status}`); return send(res, 200, '{"ok":true}'); }
      return send(res, 404, '{"error":"没有这个页面"}');
    } catch (e) { log('[驾驶舱] 出错：' + e.message); send(res, 500, JSON.stringify({ error: '服务器出错，稍后再试' })); }
  });
  server.on('error', e => log('[驾驶舱] 网页服务启动失败：' + e.message));
  server.listen(port || cfg.cockpitPort || 18900, '127.0.0.1', () => log(`[驾驶舱] 网页服务已就绪（本机 ${port || cfg.cockpitPort || 18900} 端口）`));
  return { loginLink, taskLink, state, server };
}

module.exports = { createWeb };
