/* 投放/代发链接追踪：一批小红书链接（如「白石洲攻略千粉代发 100 条 + 素人代发 50 条」）
 * → 私密表格里新建一张表登记 → 服务器直接打开链接读公开数据（标题、作者、发布时间、赞藏评分享、正文话题、封面）
 * → 每天自动重读一次更新数字；服务器读不到的（被拦/要登录）标「待插件读取」
 */
'use strict';
const COLS = [['序号', 2], ['类型', 1], ['昵称', 1], ['链接', 15], ['主页链接', 15], ['合作码', 1], ['笔记状态', 1], ['标题', 1], ['作者', 1], ['发布时间', 5], ['笔记形式', 1], ['图片数', 2], ['点赞', 2], ['收藏', 2], ['评论', 2], ['分享', 2], ['互动合计', 2], ['正文', 1], ['话题', 1], ['封面', 17], ['笔记ID', 1], ['首次读取', 5], ['最近读取', 5]];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const val = v => Array.isArray(v) ? v.map(x => (x && typeof x === 'object') ? (x.text || x.link || '') : String(x)).join('') : (v && typeof v === 'object') ? (v.text || v.link || '') : (v ?? '');
const num = v => { const m = String(v ?? '').replace(/,/g, '').match(/([\d.]+)\s*(万|w)?/i); return m ? parseFloat(m[1]) * (m[2] ? 1e4 : 1) : null; };

// 服务器直接读小红书页面里自带的笔记数据
async function readXhs(url) {
  const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9' }, signal: AbortSignal.timeout(15000) });
  const final = r.url || ''; const html = await r.text();
  const id = (final.match(/(?:explore|discovery\/item|item)\/([0-9a-f]{24})/) || [])[1] || '';
  if (/website-login|captcha|verify/i.test(final)) return { blocked: '被拦（要登录或验证）', id };
  const i = html.indexOf('window.__INITIAL_STATE__='); if (i < 0) return { blocked: '页面里没有笔记数据', id };
  let js = html.slice(i + 'window.__INITIAL_STATE__='.length); js = js.slice(0, js.indexOf('</script>')).replace(/;\s*$/, '');
  let st; try { st = JSON.parse(js.replace(/:\s*undefined/g, ':null').replace(/\bundefined\b/g, 'null')); } catch (e) { return { blocked: '数据解析失败', id }; }
  const map = (st.note && st.note.noteDetailMap) || {}; const e = map[id] || map[Object.keys(map)[0]]; const n = e && e.note;
  if (!n || !(n.noteId || n.title || n.desc)) { const gone = /笔记不存在|已被删除|无法浏览|违规/.test(html); return gone ? { gone: true, id } : { blocked: '读不到笔记内容', id }; }
  const ii = n.interactInfo || {}; const pic = x => x.urlDefault || x.url || ((x.infoList || [])[0] || {}).url || '';
  return { id: n.noteId || id, title: n.title || '', desc: (n.desc || '').replace(/#([^#\[]+)\[话题\]#/g, '#$1'), tags: (n.tagList || []).map(t => t.name).filter(Boolean), type: n.type === 'video' ? '视频' : '图文',
    images: (n.imageList || []).map(pic).filter(Boolean), likes: num(ii.likedCount), collects: num(ii.collectedCount), comments: num(ii.commentCount), shares: num(ii.shareCount), author: (n.user || {}).nickname || '', time: n.time || null };
}

function createCampaign({ cfg, api, upload, log }) {
  const priv = () => { const m = String(cfg.dailyBaseUrl || '').match(/\/base\/([A-Za-z0-9]+)/); if (!m) throw new Error('NO_PRIVATE_BASE'); return m[1]; };
  let homes = {}; const home = name => homes[name] || priv(); // 每张追踪表放在哪个多维表格（默认私密表格；挪到营销部后记在这里）
  async function tables(A) { A = A || priv(); return ((await api.call('GET', `/bitable/v1/apps/${A}/tables`, null, { page_size: 100 })).items || []); }
  async function recs(tid, A) { A = A || priv(); const out = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${A}/tables/${tid}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); out.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt); return out; }

  // 新建追踪表并登记链接（rows: [{序号, 类型, 昵称, 链接, 合作码}]）
  async function create(name, rows) {
    name = String(name || '').trim().slice(0, 60); if (!name) throw new Error('缺表名'); const A = priv();
    let t = (await tables()).find(x => x.name === name); let tid;
    if (t) tid = t.table_id; else { const d = await api.call('POST', `/bitable/v1/apps/${A}/tables`, { table: { name, default_view_name: '全部', fields: COLS.map(([field_name, type]) => ({ field_name, type })) } }); tid = d.table_id; log('[链接追踪] 新建表：' + name); }
    const have = new Set((await recs(tid)).map(r => val(r.fields['链接']).trim()));
    const add = rows.filter(r => /^https?:\/\//.test(r.链接 || '') && !have.has(r.链接.trim())).map(r => ({ fields: Object.assign({ 链接: { link: r.链接.trim(), text: r.链接.trim() }, 笔记状态: '待读取' }, r.序号 != null ? { 序号: +r.序号 } : {}, r.类型 ? { 类型: String(r.类型) } : {}, r.昵称 ? { 昵称: String(r.昵称) } : {}, r.合作码 ? { 合作码: String(r.合作码) } : {}) }));
    for (let i = 0; i < add.length; i += 400) await api.call('POST', `/bitable/v1/apps/${A}/tables/${tid}/records/batch_create`, { records: add.slice(i, i + 400) });
    return { table: name, added: add.length, existed: rows.length - add.length };
  }

  async function fieldsOf(r, d, A, stat) {
    stat = stat || { reasons: {} }; stat.reasons = stat.reasons || {};
        const f = { 最近读取: Date.now() }; if (!r.fields['首次读取']) f.首次读取 = Date.now();
        if (d.gone) { f.笔记状态 = '已删除/不可见'; stat.gone = (stat.gone || 0) + 1; }
        else if (d.blocked) { f.笔记状态 = '待插件读取'; stat.blocked = (stat.blocked || 0) + 1; stat.reasons[d.blocked] = (stat.reasons[d.blocked] || 0) + 1; }
        else {
          Object.assign(f, { 笔记状态: '正常', 标题: d.title.slice(0, 200), 作者: d.author, 笔记形式: d.type, 图片数: d.images.length, 正文: d.desc.slice(0, 3000), 话题: d.tags.map(x => '#' + x).join(' '), 笔记ID: d.id });
          ['likes:点赞', 'collects:收藏', 'comments:评论', 'shares:分享'].forEach(p => { const [k, c] = p.split(':'); if (d[k] != null) f[c] = d[k]; });
          f.互动合计 = (d.likes || 0) + (d.collects || 0) + (d.comments || 0); if (d.time) f.发布时间 = d.time;
          if (!r.fields['封面'] && d.images[0] && upload) { try { const ir = await fetch(d.images[0], { headers: { 'user-agent': UA, referer: 'https://www.xiaohongshu.com/' }, signal: AbortSignal.timeout(15000) }); if (ir.ok) f.封面 = [{ file_token: await upload(Buffer.from(await ir.arrayBuffer()), (d.id || 'cover') + '.jpg', 'bitable_image', A) }]; } catch (e) { } }
          stat.ok = (stat.ok || 0) + 1;
        }
    return f;
  }
  // 插件读回来的笔记写进表（note 字段同 readXhs 的返回；error 表示读不到）
  async function writeNote(name, rec, note, err) {
    const A = home(name); const t = (await tables(A)).find(x => x.name === name); if (!t) throw new Error('没有这张表');
    const r = (await api.call('GET', `/bitable/v1/apps/${A}/tables/${t.table_id}/records/${rec}`)).record;
    const d = err ? (/删除|不可见|不存在/.test(err) ? { gone: true } : { blocked: err }) : { id: note.id, title: note.title || '', desc: String(note.desc || ''), tags: note.tags || [], type: note.type === 'video' ? '视频' : '图文', images: note.images || [], likes: num(note.likes), collects: num(note.collects), comments: num(note.comments), shares: num(note.shares), author: note.author || '', time: note.time || null };
    const f = await fieldsOf(r, d, A); if (d.blocked) f.笔记状态 = '读取失败：' + String(err).slice(0, 20);
    await api.call('PUT', `/bitable/v1/apps/${A}/tables/${t.table_id}/records/${rec}`, { fields: f }); return { ok: true };
  }
  // 读一张表里的全部链接（或只读还没读过的），写回数据
  const running = new Set();
  async function crawl(name, opt) {
    opt = opt || {}; if (running.has(name)) return { busy: true }; running.add(name);
    const A = home(name); const t = (await tables(A)).find(x => x.name === name); if (!t) { running.delete(name); throw new Error('没有这张表：' + name); }
    const stat = { ok: 0, gone: 0, blocked: 0, total: 0, reasons: {} };
    try {
      const list = (await recs(t.table_id, A)).filter(r => !opt.onlyNew || !r.fields['最近读取']);
      for (const r of list) {
        const link = val(r.fields['链接']).trim(); if (!link) continue; stat.total++;
        let d; try { d = await readXhs(link); } catch (e) { d = { blocked: '打不开：' + e.message.slice(0, 30) }; }
        const f = await fieldsOf(r, d, A, stat);
        await api.call('PUT', `/bitable/v1/apps/${A}/tables/${t.table_id}/records/${r.record_id}`, { fields: f });
        await new Promise(s => setTimeout(s, 2500 + Math.random() * 3500)); // 慢一点，像正常打开
        if (stat.blocked >= 8 && stat.ok === 0) { stat.stopped = '服务器连续被拦，剩下的交给插件读'; break; }
      }
    } finally { running.delete(name); }
    log(`[链接追踪] ${name}：读了 ${stat.total}，正常 ${stat.ok}，删除/不可见 ${stat.gone}，被拦 ${stat.blocked} ${JSON.stringify(stat.reasons)}${stat.stopped ? '，' + stat.stopped : ''}`);
    return stat;
  }
  // 插件读取用：被拦的链接清单 / 写回
  async function pending(name, all) { const A = home(name); const t = (await tables(A)).find(x => x.name === name); if (!t) return []; try { const fd = await api.call('GET', `/bitable/v1/apps/${A}/tables/${t.table_id}/fields`, null, { page_size: 200 }); if (!(fd.items || []).some(f => f.field_name === '主页链接')) await api.call('POST', `/bitable/v1/apps/${A}/tables/${t.table_id}/fields`, { field_name: '主页链接', type: 15 }); } catch (e) { } return (await recs(t.table_id, A)).filter(r => all ? !/删除/.test(val(r.fields['笔记状态'])) : /待|失败/.test(val(r.fields['笔记状态']))).map(r => ({ rec: r.record_id, link: val(r.fields['链接']).trim(), home: (val(r.fields['主页链接']).match(/https?:\/\/[^\s]*user\/profile\/[0-9a-f]{24}[^\s]*/) || [''])[0] })); }
  async function list() { return (await tables()).map(x => x.name); }
  // 把一张追踪表复制到另一个多维表格（如营销部），之后读写都改到那边；原表不删（由林总自己删）
  async function move(name, toApp, dl) {
    const from = home(name); if (from === toApp) return { already: true };
    const src = (await tables(from)).find(x => x.name === name); if (!src) throw new Error('没有这张表：' + name);
    let dst = (await tables(toApp)).find(x => x.name === name); let tid;
    if (dst) tid = dst.table_id; else { try { tid = (await api.call('POST', `/bitable/v1/apps/${toApp}/tables`, { table: { name, default_view_name: '全部', fields: COLS.map(([field_name, type]) => ({ field_name, type })) } })).table_id; } catch (e) { throw new Error('NEED_TABLE：' + e.message); } }
    const fd = await api.call('GET', `/bitable/v1/apps/${toApp}/tables/${tid}/fields`, null, { page_size: 200 }); const hv = new Set((fd.items || []).map(f => f.field_name));
    for (const [field_name, type] of COLS) if (!hv.has(field_name)) await api.call('POST', `/bitable/v1/apps/${toApp}/tables/${tid}/fields`, { field_name, type });
    const exist = new Set((await recs(tid, toApp)).map(r => val(r.fields['链接']).trim()));
    const R = (await recs(src.table_id, from)).filter(r => !exist.has(val(r.fields['链接']).trim())); let n = 0;
    for (const r of R) {
      const f = {}; COLS.forEach(([k]) => { if (r.fields[k] !== undefined && r.fields[k] !== null && r.fields[k] !== '') f[k] = r.fields[k]; });
      if (f.链接) { const l = val(f.链接).trim(); f.链接 = { link: l, text: l }; }
      ['类型', '昵称', '合作码', '笔记状态', '标题', '作者', '笔记形式', '正文', '话题', '笔记ID'].forEach(k => { if (f[k] !== undefined) f[k] = val(f[k]); });
      if (Array.isArray(f.封面) && f.封面[0] && dl && upload) { try { const buf = await dl(f.封面[0].url || f.封面[0].tmp_url); f.封面 = [{ file_token: await upload(buf, f.封面[0].name || 'cover.jpg', 'bitable_image', toApp) }]; } catch (e) { delete f.封面; } } else delete f.封面;
      await api.call('POST', `/bitable/v1/apps/${toApp}/tables/${tid}/records`, { fields: f }); n++;
    }
    homes[name] = toApp; if (onHome) onHome(homes);
    log(`[链接追踪] 「${name}」复制到营销部：${n} 条`); return { copied: n, existed: exist.size };
  }
  let onHome = null; function setHomes(h, cb) { homes = h || {}; onHome = cb; }
  async function status(name) { const A = home(name); const t = (await tables(A)).find(x => x.name === name); if (!t) return null; const R = await recs(t.table_id, A); const by = {}; R.forEach(r => { const k = val(r.fields['笔记状态']) || '（空）'; by[k] = (by[k] || 0) + 1; }); const ok = R.filter(r => val(r.fields['笔记状态']) === '正常'); const sum = k => ok.reduce((a, r) => a + (+r.fields[k] || 0), 0);
    return { name, total: R.length, by, running: running.has(name), 点赞: sum('点赞'), 收藏: sum('收藏'), 评论: sum('评论'), top: ok.sort((a, b) => (+b.fields['互动合计'] || 0) - (+a.fields['互动合计'] || 0)).slice(0, 5).map(r => [val(r.fields['昵称']) || val(r.fields['作者']), val(r.fields['标题']).slice(0, 30), +r.fields['互动合计'] || 0]) }; }
  return { create, crawl, pending, list, status, writeNote, move, setHomes, readXhs };
}
module.exports = { createCampaign, readXhs };
