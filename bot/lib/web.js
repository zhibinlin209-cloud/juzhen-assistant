/* 驾驶舱网页服务：只监听本机 127.0.0.1，由网站 work.yesyueji.com/cockpit/ 转发进来
 * 登录：简报私聊里附带一次性链接 → 写入 30 天的登录 Cookie（只有老板的飞书账号能生成）
 */
'use strict';
const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DAY = 864e5;

function createWeb({ cfg, brief, log, activity, bossId, port }) {
  const key = crypto.createHash('sha256').update('xiju-cockpit:' + (cfg.appSecret || '') + ':' + (cfg.cockpitSalt || '')).digest();
  const b64 = b => Buffer.from(b).toString('base64url');
  const sign = (who, exp, kind) => { const body = `${kind}.${who}.${exp}`; return b64(body) + '.' + crypto.createHmac('sha256', key).update(body).digest('base64url'); };
  const verify = (tok, kind) => { try { const [b, sig] = String(tok || '').split('.'); const body = Buffer.from(b, 'base64url').toString(); const good = crypto.createHmac('sha256', key).update(body).digest('base64url'); if (!sig || sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null; const [k, who, exp] = body.split('.'); if (k !== kind || Date.now() > +exp) return null; if (who !== bossId()) return null; return who; } catch (e) { return null; } };
  const base = (cfg.cockpitUrl || 'https://work.yesyueji.com/cockpit/').replace(/\/?$/, '/');
  function loginLink() { const b = bossId(); return b ? `${base}login?t=${sign(b, Date.now() + 7 * DAY, 'L')}` : ''; }

  const cookie = req => { const m = String(req.headers.cookie || '').match(/(?:^|;\s*)xck=([^;]+)/); return m ? m[1] : ''; };
  const send = (res, code, body, type, extra) => { res.writeHead(code, Object.assign({ 'content-type': type || 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }, extra || {})); res.end(body); };
  const page = p => { try { return fs.readFileSync(path.join(__dirname, '..', 'cockpit', p)); } catch (e) { return null; } };

  let cache = null;
  async function state() {
    if (cache && Date.now() - cache.at < 3 * 60e3) return cache.v;
    const [F, todos, last] = await Promise.all([brief.facts(), brief.listTodos().catch(() => []), brief.latest().catch(() => null)]);
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
          sub: [['日报已收', known ? `${reported} / ${known} 家` : '—'], ['比上周同日', pct(F.totalWow)], ['未收到', F.missing.slice(0, 3).join('、') || '无']],
          kids: F.stores.slice(0, 6).map(r => ({ name: r.store.replace(/^(深圳|广州|佛山|珠海|东莞|惠州)/, ''), note: r.wow != null ? '比上周 ' + pct(r.wow) : '无上周数据', val: fmt(r.revenue), tone: r.wow != null && r.wow < -0.15 ? 'bad' : 'ok' })) },
        { key: 'content', name: '内容 Agent', hue: 'cyan', status: 'ok', big: String(cy), unit: '条 · 昨天发布', last: `${hm(A.last('content').at)} ${A.last('content').what || '—'}`, next: '随群消息', up: `登记 今天 ${A.count('content')} 次`, down: '截图/分享 随到随办',
          sub: [['近 7 天', `${c7} 条`], ['起量内容', `${F.hot.length} 条`], ['今天处理', `${A.count('content')} 次`]],
          kids: Object.entries(C).map(([p, x]) => ({ name: p, note: `近7天 ${x.last7} 条`, val: `${x.yesterday}`, tone: x.yesterday ? 'ok' : 'warn' })) },
        { key: 'ads', name: '投放 Agent', hue: 'green', status: F.suggest.length ? 'wait' : 'ok', big: String(F.suggest.length), unit: '条 · 建议投放', last: `${hm(A.last('ceo').at)} 筛选`, next: `明天 ${cfg.briefTime || '09:00'}`, up: `建议 ${F.suggest.length} 条`, down: '按档案标准筛选',
          sub: [['推广通', '等报表接入'], ['聚光', '接口待申请'], ['本地推', '接口待申请']],
          kids: F.suggest.concat(F.hot.filter(h => !F.suggest.includes(h) && !h.boosted)).slice(0, 5).map(h => ({ name: `${h.acc}`, note: `${h.plat} · ${F.suggest.includes(h) ? '建议投' : (h.why || '')}`, val: fmt(h.views), tone: F.suggest.includes(h) ? 'ok' : 'warn' })) },
        { key: 'rep', name: '口碑 Agent', hue: 'rose', status: bad ? 'wait' : 'ok', big: String(bad), unit: '条 · 昨天差评', last: `${hm(A.last('biz').at)} 读日报`, next: '每 10 分钟', up: `差评 ${bad} 条`, down: '评分随日报更新',
          sub: [['评分下降', `${F.alerts.filter(a => /评分/.test(a)).length} 家`], ['外卖评分', F.stores.some(r => r.wmScore != null) ? '已接入' : '日报待加'], ['抖音评分', F.stores.some(r => r.dyScore != null) ? '已接入' : '日报待加']],
          kids: F.stores.filter(r => r.dpScore != null || r.mtScore != null).slice(0, 6).map(r => { const b = r.dpBad + r.mtBad + (r.wmBad || 0) + (r.dyBad || 0); return { name: r.store.replace(/^(深圳|广州|佛山|珠海|东莞|惠州)/, ''), note: `点评 ${r.dpScore ?? '—'} · 美团 ${r.mtScore ?? '—'}`, val: b ? `差评 ${b}` : '0', tone: b ? 'bad' : 'ok' }; }) }
      ],
      todos: todos.filter(t => t.status === '待定' || Date.now() - t.last < 3 * DAY).slice(0, 20),
      stores: F.stores.map(r => ({ store: r.store, revenue: r.revenue, wow: r.wow, bad: r.dpBad + r.mtBad + (r.wmBad || 0) + (r.dyBad || 0) })),
      missing: F.missing, brief: last ? last.text : '', briefAt: last ? last.at : 0,
      suggest: F.suggest, near: F.hot.filter(h => !F.suggest.includes(h) && !h.boosted).slice(0, 6), spend: [], notes: F.notes
    };
    cache = { at: Date.now(), v }; return v;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x'); let p = u.pathname.replace(/^\/cockpit/, '') || '/';
      if (p === '/login') { const who = verify(u.searchParams.get('t'), 'L'); if (!who) return send(res, 403, '<meta charset="utf-8"><p style="font:16px sans-serif;padding:24px">登录链接无效或已过期。请在飞书里给机器人的「经营日报」群发「驾驶舱」，拿一个新链接。</p>', 'text/html; charset=utf-8'); log('[驾驶舱] 老板登录'); return send(res, 302, '', 'text/plain', { location: base, 'set-cookie': `xck=${sign(who, Date.now() + 30 * DAY, 'S')}; Path=/cockpit/; Max-Age=${30 * 86400}; HttpOnly; Secure; SameSite=Lax` }); }
      const who = verify(cookie(req), 'S');
      if (p === '/' || p === '/index.html') { const h = page('index.html'); if (!h) return send(res, 503, '驾驶舱页面还在更新，请 5 分钟后再刷新', 'text/plain; charset=utf-8'); if (!who) return send(res, 401, '<meta charset="utf-8"><meta name="viewport" content="width=device-width"><p style="font:16px sans-serif;padding:24px;line-height:1.7">这是禧聚的经营驾驶舱，需要登录。<br>请在飞书「经营日报」群里发「<b>驾驶舱</b>」，机器人会私聊你一个登录链接。</p>', 'text/html; charset=utf-8'); return send(res, 200, h, 'text/html; charset=utf-8'); }
      if (!who) return send(res, 401, JSON.stringify({ error: '需要登录' }));
      if (p === '/api/state' && req.method === 'GET') return send(res, 200, JSON.stringify(await state()));
      if (p === '/api/todo' && req.method === 'POST') { let b = ''; for await (const c of req) { b += c; if (b.length > 4096) break; } const j = JSON.parse(b || '{}'); await brief.setTodo(String(j.id || ''), String(j.status || '')); cache = null; log(`[驾驶舱] 待办 ${j.id} → ${j.status}`); return send(res, 200, '{"ok":true}'); }
      return send(res, 404, '{"error":"没有这个页面"}');
    } catch (e) { log('[驾驶舱] 出错：' + e.message); send(res, 500, JSON.stringify({ error: '服务器出错，稍后再试' })); }
  });
  server.on('error', e => log('[驾驶舱] 网页服务启动失败：' + e.message));
  server.listen(port || cfg.cockpitPort || 18900, '127.0.0.1', () => log(`[驾驶舱] 网页服务已就绪（本机 ${port || cfg.cockpitPort || 18900} 端口）`));
  return { loginLink, state, server };
}

module.exports = { createWeb };
