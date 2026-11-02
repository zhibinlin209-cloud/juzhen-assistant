/* 「飞书」：连接营销部的飞书多维表格（唯一的数据中心）
 * 读：内容台账（小红书/抖音矩阵、素人号、达人…）→ 统一门店/模板/类型口径 → 分析
 * 写回飞书：AI-复投候选 / AI-模板与类型排行 / AI-门店内容健康 / AI-账号表现 / AI-周报摘要（手机电脑打开飞书随时看）
 * 凭证（App ID / App Secret）只保存在本机浏览器
 */
(function () {
  'use strict';
  const C = window.Core;
  const h = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = m => window.__rmToast && window.__rmToast(m);
  const render = () => { if (window.__rmIsEditing && window.__rmIsEditing()) return; window.__rmRender && window.__rmRender(); };
  const forceRender = () => window.__rmRender && window.__rmRender();
  const fmt = n => C.fmtCount(n);
  const get = k => new Promise(r => chrome.storage.local.get(k, o => r(o[k])));
  const set = (k, v) => new Promise(r => chrome.storage.local.set({ [k]: v }, r));
  const API = 'https://open.feishu.cn/open-apis';
  const KEY = 'rm_feishu';

  const ST = { cfg: { appId: '', appSecret: '', baseUrl: '' }, appToken: '', tables: null, token: null, job: null, result: null, tab: 'cand', showCfg: false };
  async function load() { const o = (await get(KEY)) || {}; Object.assign(ST.cfg, o.cfg || {}); ST.appToken = o.appToken || ''; ST.result = o.result || null; ST.tables = o.tables || null; }
  const save = () => set(KEY, { cfg: ST.cfg, appToken: ST.appToken, result: ST.result, tables: ST.tables });

  // ---------- 飞书接口 ----------
  async function token() {
    if (ST.token && ST.token.exp > Date.now() + 60000) return ST.token.v;
    if (!ST.cfg.appId || !ST.cfg.appSecret) throw new Error('先填 App ID 和 App Secret');
    const r = await fetch(API + '/auth/v3/tenant_access_token/internal', { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ app_id: ST.cfg.appId.trim(), app_secret: ST.cfg.appSecret.trim() }) });
    const j = await r.json();
    if (j.code !== 0) throw new Error('飞书凭证不对：' + (j.msg || j.code) + '（检查 App ID / Secret，应用要先发布）');
    ST.token = { v: j.tenant_access_token, exp: Date.now() + (j.expire || 7200) * 1000 };
    return ST.token.v;
  }
  const HINT = { 91402: '找不到这个多维表格', 1254302: '应用没有这个多维表格的权限：在表格右上角「⋯ → 更多 → 添加文档应用」把"禧聚 AI 助手"加进去，给可编辑', 99991672: '应用缺少权限：到飞书开放平台「权限管理」开通 bitable:app / wiki:wiki:readonly，并重新发布版本', 99991663: '凭证过期，请重试', 131006: '应用没有这个知识库节点的权限：把应用加进表格（添加文档应用），并开通 wiki:wiki:readonly' };
  async function call(method, path, body, q) {
    const t = await token();
    const url = API + path + (q ? '?' + new URLSearchParams(q).toString() : '');
    for (let attempt = 0; attempt < 6; attempt++) {
      const r = await fetch(url, { method, headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json; charset=utf-8' }, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({ code: r.status, msg: 'HTTP ' + r.status }));
      if (j.code === 0) return j.data || {};
      if (j.code === 1254290 || j.code === 1254607 || r.status === 429) { await new Promise(res => setTimeout(res, (j.code === 1254607 ? 3000 : 1200) * (attempt + 1))); continue; } // 频率限制 / 数据还在计算
      throw new Error((HINT[j.code] || '飞书接口出错') + `（${j.code}：${j.msg || ''}）`);
    }
    throw new Error('飞书接口太忙，稍后再试');
  }
  async function resolveBase() {
    const u = ST.cfg.baseUrl.trim(); let m;
    if ((m = u.match(/\/base\/([A-Za-z0-9]+)/))) return m[1];
    if ((m = u.match(/\/wiki\/([A-Za-z0-9]+)/))) {
      const d = await call('GET', '/wiki/v2/spaces/get_node', null, { token: m[1], obj_type: 'wiki' });
      const node = d.node || {}; if (node.obj_type !== 'bitable') throw new Error('这个知识库链接指向的不是多维表格（是 ' + node.obj_type + '）');
      return node.obj_token;
    }
    throw new Error('认不出表格链接：请复制多维表格浏览器地址栏的完整链接（/base/… 或 /wiki/…）');
  }
  async function listTables() {
    let out = [], pt = '';
    do { const d = await call('GET', `/bitable/v1/apps/${ST.appToken}/tables`, null, Object.assign({ page_size: 100 }, pt ? { page_token: pt } : {})); out = out.concat(d.items || []); pt = d.has_more ? d.page_token : ''; } while (pt);
    return out.map(t => ({ id: t.table_id, name: t.name }));
  }
  async function listFields(tid) {
    const d = await call('GET', `/bitable/v1/apps/${ST.appToken}/tables/${tid}/fields`, null, { page_size: 200 });
    return (d.items || []).map(f => ({ id: f.field_id, name: f.field_name, type: f.type }));
  }
  async function listRecords(tid, onPage) {
    // 用新版「查询记录」接口：链接解析 / 查找引用 / 公式这类自动计算的列也会完整返回；失败再退回旧接口
    let out = [], pt = '';
    try {
      do {
        const d = await call('POST', `/bitable/v1/apps/${ST.appToken}/tables/${tid}/records/search`, { automatic_fields: false }, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {}));
        out = out.concat(d.items || []); pt = d.has_more ? d.page_token : ''; onPage && onPage(out.length, d.total);
      } while (pt);
      return out;
    } catch (e) { if (out.length) throw e; }
    pt = '';
    do {
      const d = await call('GET', `/bitable/v1/apps/${ST.appToken}/tables/${tid}/records`, null, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {}));
      out = out.concat(d.items || []); pt = d.has_more ? d.page_token : ''; onPage && onPage(out.length, d.total);
    } while (pt);
    return out;
  }
  async function ensureTable(name, fields) {
    const tables = await listTables(); let t = tables.find(x => x.name === name);
    if (!t) {
      const d = await call('POST', `/bitable/v1/apps/${ST.appToken}/tables`, { table: { name, default_view_name: '全部', fields: fields.map(f => Object.assign({ field_name: f[0], type: f[1] }, f[2] ? { property: f[2] } : {})) } });
      return { id: d.table_id, name, fresh: true };
    }
    // 补上缺的列
    const have = new Set((await listFields(t.id)).map(f => f.name));
    for (const f of fields) if (!have.has(f[0])) await call('POST', `/bitable/v1/apps/${ST.appToken}/tables/${t.id}/fields`, Object.assign({ field_name: f[0], type: f[1] }, f[2] ? { property: f[2] } : {}));
    return t;
  }
  async function batchCreate(tid, rows) { for (let i = 0; i < rows.length; i += 400) await call('POST', `/bitable/v1/apps/${ST.appToken}/tables/${tid}/records/batch_create`, { records: rows.slice(i, i + 400).map(f => ({ fields: f })) }); }
  async function batchDelete(tid, ids) { for (let i = 0; i < ids.length; i += 400) await call('POST', `/bitable/v1/apps/${ST.appToken}/tables/${tid}/records/batch_delete`, { records: ids.slice(i, i + 400) }); }

  // ---------- 字段值统一 ----------
  function val(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map(x => (x && typeof x === 'object' ? (x.text || x.name || x.link || x.full_name || x.en_name || '') : String(x))).join('');
    if (typeof v === 'object') { if (v.link) return v.link; if (v.text) return v.text; if (v.value !== undefined) return val(v.value); if (v.name) return v.name; }
    return String(v);
  }
  const num = v => { const x = val(v); if (typeof x === 'number') return x; const s = String(x).replace(/,/g, '').trim(); if (!s || s === '-') return null; const m = s.match(/([\d.]+)\s*(万|w)?/i); if (!m) return null; return Math.round(parseFloat(m[1]) * (m[2] ? 1e4 : 1)); };
  const dateOf = v => { const x = val(v); if (typeof x === 'number') return x > 1e11 ? x : x * 1000; const m = String(x).match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null; };
  const pick = (f, names) => { for (const n of names) { const k = Object.keys(f).find(x => x === n); if (k !== undefined && val(f[k]) !== '') return f[k]; } for (const n of names) { const k = Object.keys(f).find(x => x.replace(/^\.+/, '') === n.replace(/^\.+/, '')); if (k !== undefined && val(f[k]) !== '') return f[k]; } return undefined; };

  // 「标题」列常见格式：「## 标题\n真正的标题\n\n## 正文 …」，前面可能有空行/空格/加粗符号；也可能就是纯标题
  function titleOf(v) {
    const t = String(val(v) || '').replace(/\r/g, '').trim(); if (!t) return '';
    let m = t.match(/(?:^|\n)[#*\s]*标题[*\s]*[:：]?[ \t]*\n*[ \t]*([^\n#]+)/); if (m && m[1].trim()) return m[1].trim().replace(/\*+$/, '').trim();
    const line = t.split('\n').map(x => x.replace(/^[#*\s]+/, '').trim()).find(x => x && !/^(标题|正文)[:：]?$/.test(x)); return (line || '').slice(0, 100);
  }
  const STORES = [['惠州水东街', /水东街/], ['深圳华强北', /华强北/], ['深圳前海HOP', /前海|HOP/i], ['深圳白石洲', /白石洲/], ['广州江南西', /江南西/], ['珠海玖洲道', /玖洲道|玖州道/], ['佛山千灯湖', /千灯湖|灯湖/], ['佛山创产', /创产|创意产业园/], ['东莞33小镇', /33小镇/], ['广州陈家祠', /陈家祠/], ['粤迹花园城', /花园城|蛇口|粤迹|岭南家宴/]];
  function normStore(s, city) { s = String(s || ''); for (const [n, re] of STORES) if (re.test(s)) return n; const c = String(city || s || '').match(/深圳|广州|惠州|珠海|佛山|东莞/); return c ? c[0] + '（未指定门店）' : '未标门店'; }
  function normTpl(s) { s = String(s || '').trim(); if (!s) return '未标类型'; const m = s.match(/^[A-Z]?\s*模[板版]\s*\d+\s*[-－—]\s*(.+)$/); return m ? '模板·' + m[1].trim() : s; }
  function platformOf(tableName, link) { if (/小红书/.test(tableName)) return '小红书'; if (/抖音/.test(tableName)) return '抖音'; if (/xiaohongshu|xhslink/.test(link)) return '小红书'; if (/douyin/.test(link)) return '抖音'; return '其他'; }

  function toContent(t, rec) {
    const f = rec.fields || {};
    const views = Math.max(num(f['小眼睛(自动)']) || 0, num(pick(f, ['小眼睛', '播放(供AI读取)', '播放数_数值', '..播放数', '..播放数 2', '播放数', '抖音.播放数'])) || 0) || null; // 截图同步的数和手填的取大（播放只会涨）
    const link = String(val(pick(f, ['小红书链接', '抖音链接', '发布链接', '红薯链接', '链接'])) || '');
    const date = dateOf(pick(f, ['发布日期', '发布时间', '抖音.发布时间']));
    if (!date && views === null) return null;
    const title = titleOf(pick(f, ['标题(供AI读取)', '标题', '..标题', '抖音.标题'])).slice(0, 80);
    const typeRaw = val(pick(f, ['笔记类型', '发布内容', '内容类型', '账号类型']));
    return {
      table: t.name, platform: platformOf(t.name, link), date, link, title,
      account: String(val(pick(f, ['账号昵称', '账号名称', '抖音昵称', '昵称'])) || '').trim(),
      person: String(val(pick(f, ['人员', '发布人员', '发布人'])) || '').trim(),
      type: normTpl(typeRaw), typeRaw: String(typeRaw || ''),
      store: normStore(val(pick(f, ['笔记门店', '区域定位', '门店', '定位'])), val(pick(f, ['笔记城市', '城市']))),
      ads: /已投/.test(String(val(pick(f, ['投流状态', '本地推', '本地推/聚光'])) || '')),
      views: views || 0, likes: Math.max(num(f['点赞(自动)']) || 0, num(pick(f, ['点赞(供AI读取)', '点赞数', '..点赞数', '抖音.点赞数'])) || 0), comments: Math.max(num(f['评论(自动)']) || 0, num(pick(f, ['评论(供AI读取)', '评论数', '..评论数', '抖音.评论数'])) || 0),
      collects: num(pick(f, ['收藏(供AI读取)', '收藏数', '..收藏数', '抖音.收藏数'])) || 0, shares: num(pick(f, ['分享(供AI读取)', '分享数', '..分享数', '抖音.分享数'])) || 0
    };
  }

  // ---------- 分析 ----------
  const median = a => { const s = a.filter(x => x > 0).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const pctl = (a, p) => { const s = a.filter(x => x > 0).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };
  const DAY = 864e5;
  function analyze(items) {
    const now = Date.now(); const by = (arr, k) => arr.reduce((m, x) => { (m[x[k]] = m[x[k]] || []).push(x); return m; }, {});
    const recent90 = items.filter(x => x.date && now - x.date <= 90 * DAY);
    const top = {}; const medT = {};
    Object.entries(by(recent90, 'platform')).forEach(([p, arr]) => { top[p] = pctl(arr.map(x => x.views), 0.9); });
    Object.entries(by(recent90, 'platform')).forEach(([p, arr]) => Object.entries(by(arr, 'type')).forEach(([t, a2]) => { medT[p + '|' + t] = median(a2.map(x => x.views)); }));
    const isTop = x => x.views > 0 && x.views >= (top[x.platform] || Infinity);
    // 复投候选：近 30 天、没投过、头部或同类 3 倍以上
    const cands = items.filter(x => x.date && now - x.date <= 30 * DAY && !x.ads && x.views > 0).map(x => {
      const m = medT[x.platform + '|' + x.type] || 0; const ratio = m ? x.views / m : 0;
      const eng = x.likes + x.collects * 1.2 + x.comments * 2 + x.shares * 1.5; const engRate = x.views ? eng / x.views : 0;
      return Object.assign({}, x, { ratio: Math.round(ratio * 10) / 10, engRate, top: isTop(x) });
    }).filter(x => x.top || x.ratio >= 3).sort((a, b) => (b.top - a.top) || (b.ratio - a.ratio)).slice(0, 40)
      .map(x => Object.assign(x, { why: [x.top ? `${x.platform}近 90 天前 10%` : '', x.ratio >= 3 ? `同类型中位数的 ${x.ratio} 倍` : '', x.engRate >= 0.05 ? `互动率 ${(x.engRate * 100).toFixed(1)}%` : '', x.collects >= x.likes * 0.5 && x.collects > 20 ? '收藏多（攻略价值高）' : ''].filter(Boolean).join('；') }));
    // 模板/类型排行（近 30 天）
    const r30 = items.filter(x => x.date && now - x.date <= 30 * DAY);
    const r30prev = items.filter(x => x.date && now - x.date > 30 * DAY && now - x.date <= 60 * DAY);
    const tpl = []; Object.entries(by(r30, 'platform')).forEach(([p, arr]) => Object.entries(by(arr, 'type')).forEach(([t, a2]) => {
      const med = median(a2.map(x => x.views)); const topN = a2.filter(isTop).length; const best = a2.slice().sort((a, b) => b.views - a.views)[0];
      const prev = r30prev.filter(x => x.platform === p && x.type === t); const prevMed = median(prev.map(x => x.views));
      const all = median(arr.map(x => x.views)); const rate = a2.length ? topN / a2.length : 0;
      const advice = a2.length < 5 ? '样本少，继续观察' : rate >= 0.15 || med >= all * 1.5 ? '加量' : rate === 0 && med < all * 0.6 ? '减少或改版' : '保持';
      tpl.push({ platform: p, type: t, n: a2.length, med, topN, rate, max: best ? best.views : 0, bestLink: best ? best.link : '', bestTitle: best ? best.title : '', prevMed, advice });
    }));
    tpl.sort((a, b) => b.med - a.med);
    // 门店内容健康
    const stores = Object.entries(by(items.filter(x => x.date), 'store')).map(([s, arr]) => {
      const w7 = arr.filter(x => now - x.date <= 7 * DAY), w30 = arr.filter(x => now - x.date <= 30 * DAY), w30p = arr.filter(x => now - x.date > 30 * DAY && now - x.date <= 60 * DAY);
      const last = Math.max(...arr.map(x => x.date)); const gap = Math.floor((now - last) / DAY);
      return { store: s, w7: w7.length, w30: w30.length, w30p: w30p.length, med: median(w30.map(x => x.views)), topN: w30.filter(isTop).length, last, gap, xhs: w30.filter(x => x.platform === '小红书').length, dy: w30.filter(x => x.platform === '抖音').length,
        status: gap > 14 ? '断更' : w30.length < Math.max(3, w30p.length * 0.5) ? '偏少' : '正常' };
    }).filter(x => !/陈家祠/.test(x.store)).sort((a, b) => b.w30 - a.w30);
    // 账号表现（近 30 天）
    const accts = Object.entries(by(r30.filter(x => x.account), 'account')).map(([a, arr]) => ({ account: a, platform: arr[0].platform, person: [...new Set(arr.map(x => x.person).filter(Boolean))].join('、'), n: arr.length, med: median(arr.map(x => x.views)), topN: arr.filter(isTop).length, last: Math.max(...arr.map(x => x.date)) }))
      .sort((a, b) => b.topN - a.topN || b.med - a.med);
    const summary = { total: items.length, r30: r30.length, r30p: r30prev.length, w7: items.filter(x => x.date && now - x.date <= 7 * DAY).length, top, adsRate: items.length ? items.filter(x => x.ads).length / items.length : 0, cands: cands.length,
      med30: Object.fromEntries(Object.entries(by(r30, 'platform')).map(([p, a]) => [p, median(a.map(x => x.views))])) };
    return { at: Date.now(), summary, cands, tpl, stores, accts: accts.slice(0, 80) };
  }

  // ---------- 写回飞书 ----------
  const T_TEXT = 1, T_NUM = 2, T_SELECT = 3, T_DATE = 5, T_URL = 15;
  const DECISION = { options: [{ name: '投' }, { name: '不投' }, { name: '待定' }] };
  async function writeBack(R, prog) {
    const stamp = new Date(R.at).toLocaleString('zh-CN', { hour12: false });
    // 复投候选：保留已经做了决定的行
    prog('写入「AI-复投候选」');
    const tc = await ensureTable('AI-复投候选', [['标题', T_TEXT], ['平台', T_SELECT], ['链接', T_URL], ['门店', T_TEXT], ['类型/模板', T_TEXT], ['账号', T_TEXT], ['发布人', T_TEXT], ['发布日期', T_DATE], ['播放/小眼睛', T_NUM], ['点赞', T_NUM], ['收藏', T_NUM], ['评论', T_NUM], ['同类倍数', T_NUM], ['推荐理由', T_TEXT], ['决定', T_SELECT, DECISION], ['备注', T_TEXT], ['生成时间', T_TEXT]]);
    const old = await listRecords(tc.id);
    const keep = new Set(old.filter(r => val((r.fields || {})['决定'])).map(r => { const l = (r.fields || {})['链接']; return typeof l === 'object' && l ? l.link || l.text : String(l || ''); }));
    await batchDelete(tc.id, old.filter(r => !val((r.fields || {})['决定'])).map(r => r.record_id));
    await batchCreate(tc.id, R.cands.filter(x => !keep.has(x.link)).map(x => ({ 标题: x.title || '(无标题)', 平台: x.platform, 链接: x.link ? { link: x.link, text: '打开' } : null, 门店: x.store, '类型/模板': x.type, 账号: x.account, 发布人: x.person, 发布日期: x.date, '播放/小眼睛': x.views, 点赞: x.likes, 收藏: x.collects, 评论: x.comments, 同类倍数: x.ratio, 推荐理由: x.why, 生成时间: stamp })).map(clean));
    prog('写入「AI-模板与类型排行」');
    const tt = await ensureTable('AI-模板与类型排行', [['类型/模板', T_TEXT], ['平台', T_SELECT], ['近30天篇数', T_NUM], ['播放中位数', T_NUM], ['上月中位数', T_NUM], ['头部篇数', T_NUM], ['头部率', T_NUM], ['最高播放', T_NUM], ['最佳例子', T_URL], ['建议', T_SELECT, { options: [{ name: '加量' }, { name: '保持' }, { name: '减少或改版' }, { name: '样本少，继续观察' }] }], ['生成时间', T_TEXT]]);
    await batchDelete(tt.id, (await listRecords(tt.id)).map(r => r.record_id));
    await batchCreate(tt.id, R.tpl.map(x => ({ '类型/模板': x.type, 平台: x.platform, 近30天篇数: x.n, 播放中位数: x.med, 上月中位数: x.prevMed, 头部篇数: x.topN, 头部率: Math.round(x.rate * 1000) / 10, 最高播放: x.max, 最佳例子: x.bestLink ? { link: x.bestLink, text: (x.bestTitle || '打开').slice(0, 30) } : null, 建议: x.advice, 生成时间: stamp })).map(clean));
    prog('写入「AI-门店内容健康」');
    const ts = await ensureTable('AI-门店内容健康', [['门店', T_TEXT], ['状态', T_SELECT, { options: [{ name: '正常' }, { name: '偏少' }, { name: '断更' }] }], ['近7天篇数', T_NUM], ['近30天篇数', T_NUM], ['上月篇数', T_NUM], ['小红书(30天)', T_NUM], ['抖音(30天)', T_NUM], ['播放中位数', T_NUM], ['头部篇数', T_NUM], ['最近发布', T_DATE], ['断更天数', T_NUM], ['生成时间', T_TEXT]]);
    await batchDelete(ts.id, (await listRecords(ts.id)).map(r => r.record_id));
    await batchCreate(ts.id, R.stores.map(x => ({ 门店: x.store, 状态: x.status, 近7天篇数: x.w7, 近30天篇数: x.w30, 上月篇数: x.w30p, '小红书(30天)': x.xhs, '抖音(30天)': x.dy, 播放中位数: x.med, 头部篇数: x.topN, 最近发布: x.last, 断更天数: x.gap, 生成时间: stamp })).map(clean));
    prog('写入「AI-账号表现」');
    const ta = await ensureTable('AI-账号表现', [['账号', T_TEXT], ['平台', T_SELECT], ['发布人', T_TEXT], ['近30天篇数', T_NUM], ['播放中位数', T_NUM], ['头部篇数', T_NUM], ['最近发布', T_DATE], ['生成时间', T_TEXT]]);
    await batchDelete(ta.id, (await listRecords(ta.id)).map(r => r.record_id));
    await batchCreate(ta.id, R.accts.map(x => ({ 账号: x.account, 平台: x.platform, 发布人: x.person, 近30天篇数: x.n, 播放中位数: x.med, 头部篇数: x.topN, 最近发布: x.last, 生成时间: stamp })).map(clean));
    prog('写入「AI-周报摘要」');
    const tw = await ensureTable('AI-周报摘要', [['生成时间', T_TEXT], ['近7天发布', T_NUM], ['近30天发布', T_NUM], ['上月发布', T_NUM], ['小红书中位数(30天)', T_NUM], ['抖音中位数(30天)', T_NUM], ['复投候选', T_NUM], ['已投流占比%', T_NUM], ['要点', T_TEXT]]);
    await batchCreate(tw.id, [clean({ 生成时间: stamp, 近7天发布: R.summary.w7, 近30天发布: R.summary.r30, 上月发布: R.summary.r30p, '小红书中位数(30天)': R.summary.med30['小红书'] || 0, '抖音中位数(30天)': R.summary.med30['抖音'] || 0, 复投候选: R.summary.cands, '已投流占比%': Math.round(R.summary.adsRate * 1000) / 10, 要点: R.brief || points(R).join('\n') })]);
  }
  function clean(o) { Object.keys(o).forEach(k => { if (o[k] === null || o[k] === undefined || o[k] === '' || (typeof o[k] === 'number' && !isFinite(o[k]))) delete o[k]; }); return o; }
  function points(R) {
    const S = R.summary; const out = [];
    out.push(`近 30 天发布 ${S.r30} 篇（上月 ${S.r30p} 篇），近 7 天 ${S.w7} 篇。`);
    out.push(`已投流的内容只占 ${(S.adsRate * 100).toFixed(1)}%；本期筛出 ${S.cands} 条复投候选，请在「AI-复投候选」标"投/不投"。`);
    const up = R.tpl.filter(x => x.advice === '加量').slice(0, 3).map(x => `${x.platform}·${x.type}`); if (up.length) out.push('建议加量：' + up.join('、') + '。');
    const down = R.tpl.filter(x => x.advice === '减少或改版').slice(0, 3).map(x => `${x.platform}·${x.type}`); if (down.length) out.push('建议减少或改版：' + down.join('、') + '。');
    const bad = R.stores.filter(x => x.status !== '正常').map(x => `${x.store}（${x.status}）`); if (bad.length) out.push('门店内容需要关注：' + bad.join('、') + '。');
    return out;
  }

  // ---------- 主流程 ----------
  function prog(t) { if (ST.job) { ST.job.phase = t; ST.job.log.unshift(new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '  ' + t); render(); } }
  async function connect() {
    ST.job = { running: true, phase: '连接飞书', log: [] }; render();
    try {
      ST.token = null; await token(); prog('凭证正确');
      ST.appToken = await resolveBase(); prog('找到多维表格');
      const tables = await listTables();
      ST.tables = tables.map(t => ({ id: t.id, name: t.name })); await save();
      prog(`连接成功：${tables.length} 张数据表`); toast('飞书连接成功');
    } catch (e) { prog('失败：' + e.message); toast(e.message); }
    ST.job.running = false; render();
  }
  async function runReport(writeFs) {
    if (!ST.appToken) { await connect(); if (!ST.appToken) return; }
    ST.job = { running: true, phase: '读取台账', log: [] }; render();
    try {
      const tables = (await listTables()).filter(t => !/^AI-/.test(t.name)); ST.tables = tables;
      const items = []; const used = [];
      for (const t of tables) {
        // 含账号密码的表一律不读（不进插件、不进 AI）
        if (/密码|登录信息|账号登录/.test(t.name)) { prog(`跳过「${t.name}」（含登录信息）`); continue; }
        try { const fl = await listFields(t.id); if (fl.some(f => /密码|password/i.test(f.name || ''))) { prog(`跳过「${t.name}」（含密码列）`); continue; } } catch (e) { }
        const recs = await listRecords(t.id, (n, tot) => { ST.job.phase = `读取「${t.name}」${n}${tot ? '/' + tot : ''} 行`; render(); });
        const rows = recs.map(r => toContent(t, r)).filter(Boolean);
        const valid = rows.filter(r => r.date && (r.views || r.likes));
        if (valid.length >= 5 && valid.length >= recs.length * 0.3) { items.push(...valid); used.push(`${t.name}（${valid.length}）`); }
      }
      prog(`内容台账：${used.join('、') || '没认出内容表'}`);
      if (!items.length) throw new Error('没在表格里认出内容数据（需要有发布日期 + 播放/小眼睛/点赞这类列）');
      const R = analyze(items); R.used = used;
      // AI 要点（可选）
      const cfg = window.Env && Env.aiConfig ? Env.aiConfig() : null;
      if (cfg && cfg.key) {
        try {
          prog('AI 写周报要点');
          R.brief = String(await window.AI.chat(cfg, `你是禧聚餐饮营销部的数据助理，给老板林智斌和增长负责人洛琳写本周内容周报要点（6–8 条，每条一句话，先结论后数字，口语、具体、能直接行动；不要套话；只用下面的数据，没有的不要编；播放量不等于到店，不要下经营结论）。
数据：
${points(R).join('\n')}
模板/类型 Top：${R.tpl.slice(0, 8).map(x => `${x.platform}·${x.type} ${x.n}篇 中位数${x.med} 头部${x.topN}`).join('；')}
门店：${R.stores.map(x => `${x.store} 近30天${x.w30}篇 中位数${x.med} ${x.status}`).join('；')}
复投候选前5：${R.cands.slice(0, 5).map(x => `${x.store} ${x.type} ${x.views}播放 ${x.why}`).join('；')}`, null, { temperature: 0.3, maxTokens: 900 })).trim();
        } catch (e) { prog('AI 要点没写成（不影响报表）：' + e.message); }
      }
      ST.result = R; await save();
      if (writeFs) { await writeBack(R, prog); prog('已写回飞书：打开多维表格就能看到 5 张「AI-」开头的表'); toast('报表已写回飞书'); }
    } catch (e) { prog('失败：' + e.message); toast(e.message); }
    ST.job.running = false; render();
  }

  // ---------- 视图 ----------
  function view() {
    const c = ST.cfg; const j = ST.job; const R = ST.result; const ok = !!ST.appToken;
    return `<div class="section-h" style="margin-top:0"><h2>飞书数据中心</h2><span class="hint">读营销部多维表格的内容台账，生成复投候选、模板排行、门店健康，写回飞书随时看</span></div>
    <div class="panel stack">
      <div class="row"><span class="pf ${ok ? 'ai' : ''}">${ok ? '已连接' : '未连接'}</span><span class="hint grow">${ok ? `${(ST.tables || []).length} 张数据表` : '先填下面的连接信息'}</span><button class="btn ghost sm" data-action="fs-cfg">${ST.showCfg || !ok ? '收起设置' : '连接设置'}</button></div>
      ${ST.showCfg || !ok ? `<div class="stack" style="gap:8px">
        <div class="grid2"><label class="f"><span>App ID</span><input type="text" data-fs="appId" value="${h(c.appId)}" placeholder="cli_xxxxxxxx"></label>
        <label class="f"><span>App Secret（只存在本机浏览器）</span><input type="password" data-fs="appSecret" value="${h(c.appSecret)}" placeholder="在飞书开放平台「凭证与基础信息」里复制"></label></div>
        <label class="f"><span>多维表格链接</span><input type="text" data-fs="baseUrl" value="${h(c.baseUrl)}" placeholder="https://xxx.feishu.cn/wiki/… 或 /base/…"></label>
        <div class="row"><button class="btn primary sm" data-action="fs-connect" ${j && j.running ? 'disabled' : ''}>测试连接</button><span class="hint">应用要先发布，并在表格「⋯ → 更多 → 添加文档应用」里加进来</span></div>
      </div>` : ''}
      ${ok ? `<div class="row"><button class="btn primary" data-action="fs-run" ${j && j.running ? 'disabled' : ''}>生成报表并写回飞书</button><button class="btn sm" data-action="fs-preview" ${j && j.running ? 'disabled' : ''}>只在这里预览</button><span class="hint">读全部内容台账（约几千行，1–2 分钟）</span></div>` : ''}
      ${j ? `<div class="hint"><b>${h(j.phase)}</b></div><pre class="small-pre">${h(j.log.join('\n'))}</pre>` : ''}
    </div>
    ${ok && window.XhsShot ? window.XhsShot.view() : ''}
    ${R ? report(R) : ''}`;
  }
  function report(R) {
    const S = R.summary; const tabs = [['cand', `复投候选 ${R.cands.length}`], ['tpl', '模板与类型'], ['store', '门店健康'], ['acct', '账号']];
    const tbl = (head, rows) => `<div class="tbl-wrap"><table><thead><tr>${head.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="hint">没有数据</td></tr>`}</tbody></table></div>`;
    const d = t => (t ? new Date(t).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '');
    const body = {
      cand: () => tbl(['#', '内容', '门店', '类型', '播放', '赞/藏/评', '倍数', '理由'], R.cands.map((x, i) => `<tr><td class="num">${i + 1}</td><td style="white-space:normal;min-width:160px">${x.link ? `<a href="${h(x.link)}" target="_blank" rel="noopener">${h(x.title || '打开')}</a>` : h(x.title)}<div class="hint">${h(x.platform)} · ${h(x.account)} · ${d(x.date)}</div></td><td>${h(x.store)}</td><td>${h(x.type)}</td><td class="num">${fmt(x.views)}</td><td class="num">${fmt(x.likes)}/${fmt(x.collects)}/${fmt(x.comments)}</td><td class="num">${x.ratio || ''}</td><td style="white-space:normal;min-width:140px" class="hint">${h(x.why)}</td></tr>`)),
      tpl: () => tbl(['平台', '类型/模板', '30天篇数', '中位数', '上月', '头部', '最高', '建议'], R.tpl.map(x => `<tr><td>${h(x.platform)}</td><td>${x.bestLink ? `<a href="${h(x.bestLink)}" target="_blank" rel="noopener" title="最佳例子">${h(x.type)}</a>` : h(x.type)}</td><td class="num">${x.n}</td><td class="num">${fmt(x.med)}</td><td class="num">${fmt(x.prevMed)}</td><td class="num">${x.topN}</td><td class="num">${fmt(x.max)}</td><td><span class="chip sm ${x.advice === '加量' ? 'g' : x.advice === '减少或改版' ? 'r' : ''}">${h(x.advice)}</span></td></tr>`)),
      store: () => tbl(['门店', '状态', '近7天', '近30天', '上月', '小红书/抖音', '中位数', '头部', '最近发布'], R.stores.map(x => `<tr><td><b>${h(x.store)}</b></td><td><span class="chip sm ${x.status === '正常' ? 'g' : 'r'}">${h(x.status)}</span></td><td class="num">${x.w7}</td><td class="num">${x.w30}</td><td class="num">${x.w30p}</td><td class="num">${x.xhs}/${x.dy}</td><td class="num">${fmt(x.med)}</td><td class="num">${x.topN}</td><td>${d(x.last)}${x.gap > 3 ? `<span class="hint">（${x.gap}天前）</span>` : ''}</td></tr>`)),
      acct: () => tbl(['账号', '平台', '发布人', '30天篇数', '中位数', '头部', '最近发布'], R.accts.map(x => `<tr><td>${h(x.account)}</td><td>${h(x.platform)}</td><td>${h(x.person)}</td><td class="num">${x.n}</td><td class="num">${fmt(x.med)}</td><td class="num">${x.topN}</td><td>${d(x.last)}</td></tr>`))
    }[ST.tab]();
    return `<div class="section-h"><h2>本期报表</h2><span class="hint">${new Date(R.at).toLocaleString('zh-CN', { hour12: false })} · 来自 ${h((R.used || []).join('、'))}</span></div>
    <div class="kpis panel" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
      <div><b>${S.w7}</b><span>近 7 天发布</span></div><div><b>${S.r30}</b><span>近 30 天（上月 ${S.r30p}）</span></div>
      <div><b>${Object.entries(S.med30).map(([p, v]) => `${p.slice(0, 1)}${fmt(v)}`).join(' ')}</b><span>30 天播放中位数</span></div><div><b class="${S.adsRate < 0.02 ? 'neg' : ''}">${(S.adsRate * 100).toFixed(1)}%</b><span>已投流占比</span></div>
    </div>
    <div class="panel" style="border-left:3px solid var(--accent);margin:10px 0;white-space:pre-wrap"><b>要点</b>\n${h(R.brief || points(R).join('\n'))}</div>
    <p class="hint">播放/小眼睛只说明内容有没有人看，不等于到店；"头部"= 该平台近 90 天前 10%。复投要不要投，在飞书「AI-复投候选」的"决定"列标，下次生成会保留你标过的。</p>
    <nav class="tabs sub" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-action="fs-tab" data-v="${k}" aria-selected="${ST.tab === k}">${l}</button>`).join('')}</nav>
    <div style="margin-top:10px">${body}</div>`;
  }

  async function act(action, el) {
    if (action.startsWith('fs-shot')) return window.XhsShot && window.XhsShot.act(action, el);
    switch (action) {
      case 'fs-cfg': ST.showCfg = !ST.showCfg; forceRender(); break;
      case 'fs-connect': connect(); break;
      case 'fs-run': runReport(true); break;
      case 'fs-preview': runReport(false); break;
      case 'fs-tab': ST.tab = el.dataset.v; render(); break;
    }
  }
  function attach(root) {
    const on = e => { const t = e.target; if (t.dataset && t.dataset.fs) { ST.cfg[t.dataset.fs] = t.value.trim(); if (t.dataset.fs !== 'appSecret' || e.type === 'change') save(); if (t.dataset.fs === 'baseUrl') ST.appToken = ''; } };
    root.addEventListener('input', on); root.addEventListener('change', on);
    if (window.XhsShot) window.XhsShot.attach(root);
    load().then(render);
  }
  window.Feishu = { _api: { ST, titleOf, call, listTables, listFields, listRecords, val, num, pick, dateOf }, view, act, attach, connected: () => !!ST.appToken, _analyze: analyze, _toContent: toContent, _st: ST };
})();
