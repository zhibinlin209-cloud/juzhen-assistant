/* 评论采集：插件里贴小红书 / 抖音链接，把帖子下面的全部评论（含楼中楼回复）拉出来，
 * 写进营销部多维表格的「评论采集」表，一条评论一行；同一条评论再拉一次只更新点赞数，不重复加。
 */
'use strict';
const COLS = [['评论内容', 1], ['平台', 3, ['小红书', '抖音']], ['帖子标题', 1], ['帖子链接', 15], ['帖子作者', 1], ['评论人', 1], ['类型', 3, ['评论', '回复']], ['回复给', 1], ['作者回复', 3, ['是', '否']],
  ['点赞', 2], ['评论时间', 5], ['IP属地', 1], ['评论ID', 1], ['帖子ID', 1], ['采集时间', 5], ['采集批次', 1]];
const TABLE = '评论采集';

function createCmtLib({ cfg, api, core, log }) {
  let T = null; // { app, id, keys: Map(评论ID -> record_id), at }
  async function table() {
    const app = await core.appToken();
    if (T && T.app === app && Date.now() - T.at < 30 * 60e3) return T;
    const fieldOf = ([field_name, type, opts]) => Object.assign({ field_name, type }, opts ? { property: { options: opts.map((name, color) => ({ name, color })) } } : {});
    const list = []; let pt = ''; do { const d = await api.call('GET', `/bitable/v1/apps/${app}/tables`, null, Object.assign({ page_size: 100 }, pt ? { page_token: pt } : {})); list.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    let id = (list.find(x => x.name === TABLE) || {}).table_id;
    if (!id) { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables`, { table: { name: TABLE, default_view_name: '全部评论', fields: COLS.map(fieldOf) } }); id = d.table_id; log('[评论采集] 新建表「评论采集」'); }
    else { const fd = await api.call('GET', `/bitable/v1/apps/${app}/tables/${id}/fields`, null, { page_size: 200 }); const hv = new Set((fd.items || []).map(f => f.field_name)); for (const c of COLS) if (!hv.has(c[0])) await api.call('POST', `/bitable/v1/apps/${app}/tables/${id}/fields`, fieldOf(c)); }
    T = { app, id, keys: null, at: Date.now() }; return T;
  }
  async function keysOf(t, postId) { // 这个帖子已经存过的评论 ID
    const m = new Map(); let pt = '';
    do { const d = await api.call('POST', `/bitable/v1/apps/${t.app}/tables/${t.id}/records/search`, { field_names: ['评论ID', '点赞'], filter: { conjunction: 'and', conditions: [{ field_name: '帖子ID', operator: 'is', value: [postId] }] } }, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {}));
      for (const r of d.items || []) { const v = r.fields['评论ID']; const k = Array.isArray(v) ? v.map(x => x.text || '').join('') : String(v || ''); if (k) m.set(k, r.record_id); } pt = d.has_more ? d.page_token : ''; } while (pt);
    return m;
  }
  const clean = s => String(s || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 2000);
  async function ingest(j) {
    const url = String(j.url || ''); const platform = /douyin/.test(url) ? '抖音' : '小红书';
    const post = j.post || {}; const postId = String(j.postId || post.id || '').slice(0, 64) || url.slice(-40);
    const list = Array.isArray(j.comments) ? j.comments.slice(0, 20000) : [];
    if (!list.length) return { ok: true, added: 0, updated: 0, total: 0, table: TABLE };
    const t = await table(); const have = await keysOf(t, postId);
    const batch = j.batch || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
    const byCid = new Map(list.map(c => [c.cid, c]));
    const add = [], upd = []; const now = Date.now();
    for (const c of list) {
      const cid = String(c.cid || '') || (c.name + '|' + String(c.text || '').slice(0, 30));
      if (have.has(cid)) { upd.push({ record_id: have.get(cid), fields: { '点赞': +c.likes || 0, '采集时间': now } }); continue; }
      const to = c.to || (c.parent && byCid.get(c.parent) ? byCid.get(c.parent).name : '');
      const f = { '评论内容': clean(c.text), '平台': platform, '帖子标题': clean(post.title || post.desc || '').slice(0, 200), '帖子链接': { link: url, text: clean(post.title || url).slice(0, 80) || url }, '帖子作者': clean(post.author || post.nickname || ''), '评论人': clean(c.name),
        '类型': c.reply || c.parent ? '回复' : '评论', '回复给': clean(to), '作者回复': c.author ? '是' : '否', '点赞': +c.likes || 0, 'IP属地': clean(c.ip || ''), '评论ID': cid, '帖子ID': postId, '采集时间': now, '采集批次': batch };
      if (c.ts && c.ts > 1e12) f['评论时间'] = c.ts;
      add.push({ fields: f }); have.set(cid, '');
    }
    for (let i = 0; i < add.length; i += 400) await api.call('POST', `/bitable/v1/apps/${t.app}/tables/${t.id}/records/batch_create`, { records: add.slice(i, i + 400) });
    for (let i = 0; i < upd.length; i += 400) await api.call('POST', `/bitable/v1/apps/${t.app}/tables/${t.id}/records/batch_update`, { records: upd.slice(i, i + 400) });
    const link = (cfg.baseUrl || '').replace(/\?.*$/, '') + (cfg.baseUrl ? `?table=${t.id}` : '');
    log(`[评论采集] ${platform}「${String(post.title || postId).slice(0, 20)}」${list.length} 条，新增 ${add.length}、更新 ${upd.length}`);
    return { ok: true, added: add.length, updated: upd.length, total: list.length, table: TABLE, link };
  }
  return { ingest };
}
module.exports = { createCmtLib };
