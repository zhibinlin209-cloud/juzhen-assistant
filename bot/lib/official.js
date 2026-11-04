/* 官方号作品数据：两个抖音蓝 V（YES 也是大排档、粤迹·岭南家宴）+ 视频号
 * 插件在老板 Chrome 里打开创作者后台，读「作品管理」的数据（播放、完播率、2 秒跳出、涨粉…只有账号本人看得到的数），
 * 交给这里写进私密表格「官方号作品数据」：按 平台+作品ID 去重，重复同步就更新数字
 */
'use strict';
const NAME = '官方号作品数据';
const COLS = [['平台', 1], ['账号', 1], ['作品ID', 1], ['发布时间', 5], ['标题', 1], ['形式', 1], ['时长秒', 2], ['播放', 2], ['点赞', 2], ['评论', 2], ['分享', 2], ['收藏', 2], ['涨粉', 2], ['主页访问', 2],
  ['完播率%', 2], ['5秒完播率%', 2], ['2秒跳出率%', 2], ['平均播放秒', 2], ['平均播放占比%', 2], ['粉丝观看占比%', 2], ['封面点击率%', 2], ['互动率%', 2], ['封面图', 15], ['同步时间', 5]];
const val = v => Array.isArray(v) ? v.map(x => (x && typeof x === 'object') ? (x.text || x.name || '') : String(x)).join('') : (v ?? '');
const n = v => { const x = parseFloat(v); return isFinite(x) ? x : null; };
const pct = v => { const x = n(v); return x == null ? null : Math.round(x * 10000) / 100; };

function createOfficial({ cfg, api, log }) {
  const priv = () => { const m = String(cfg.dailyBaseUrl || '').match(/\/base\/([A-Za-z0-9]+)/); if (!m) throw new Error('NO_PRIVATE_BASE'); return m[1]; };
  async function recs(app, tid) { const out = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${tid}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); out.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt); return out; }
  let tid = null;
  async function table() {
    if (tid) return tid; const A = priv(); const d0 = await api.call('GET', `/bitable/v1/apps/${A}/tables`, null, { page_size: 100 }); const t = (d0.items || []).find(x => x.name === NAME);
    if (t) { const fd = await api.call('GET', `/bitable/v1/apps/${A}/tables/${t.table_id}/fields`, null, { page_size: 200 }); const hv = new Set((fd.items || []).map(f => f.field_name)); for (const [field_name, type] of COLS) if (!hv.has(field_name)) await api.call('POST', `/bitable/v1/apps/${A}/tables/${t.table_id}/fields`, { field_name, type }); return (tid = t.table_id); }
    const d = await api.call('POST', `/bitable/v1/apps/${A}/tables`, { table: { name: NAME, default_view_name: '全部', fields: COLS.map(([field_name, type]) => ({ field_name, type })) } });
    log('[官方号] 新建表：' + NAME); return (tid = d.table_id);
  }
  // 抖音创作者中心 item/list 的一条 → 表格一行
  function fromDouyin(x, acc) {
    const m = x.metrics || {}; const dur = x.video_info && x.video_info.duration ? Math.round(x.video_info.duration / 1000) : null; const view = n(m.view_count);
    const eng = (n(m.like_count) || 0) + (n(m.comment_count) || 0) + (n(m.share_count) || 0) + (n(m.favorite_count) || 0);
    const cover = ((x.cover || {}).url_list || [])[0] || '';
    return { 平台: '抖音', 账号: acc, 作品ID: String(x.id), 发布时间: x.create_time ? x.create_time * 1000 : null, 标题: String(x.description || '').slice(0, 500), 形式: dur ? '视频' : '图文', 时长秒: dur,
      播放: view, 点赞: n(m.like_count), 评论: n(m.comment_count), 分享: n(m.share_count), 收藏: n(m.favorite_count), 涨粉: n(m.subscribe_count), 主页访问: n(m.homepage_visit_count),
      '完播率%': pct(m.completion_rate), '5秒完播率%': pct(m.completion_rate_5s), '2秒跳出率%': pct(m.bounce_rate_2s), 平均播放秒: n(m.avg_view_second) != null ? Math.round(n(m.avg_view_second) * 10) / 10 : null,
      '平均播放占比%': pct(m.avg_view_proportion), '粉丝观看占比%': pct(m.fan_view_proportion), '封面点击率%': pct(m.cover_click_rate), '互动率%': view ? Math.round(eng / view * 10000) / 100 : null,
      封面图: cover ? { link: cover, text: '封面' } : null };
  }
  // 视频号助手作品列表的一条（字段名以插件整理后的为准）
  function fromChannels(x, acc) {
    const view = n(x.views); const eng = (n(x.likes) || 0) + (n(x.comments) || 0) + (n(x.shares) || 0) + (n(x.favs) || 0);
    return { 平台: '视频号', 账号: acc, 作品ID: String(x.id), 发布时间: x.time || null, 标题: String(x.title || '').slice(0, 500), 形式: x.form || (x.duration ? '视频' : '图文'), 时长秒: n(x.duration),
      播放: view, 点赞: n(x.likes), 评论: n(x.comments), 分享: n(x.shares), 收藏: n(x.favs), 涨粉: n(x.follows), '完播率%': x.completion != null ? n(x.completion) : null, 平均播放秒: n(x.avgSec),
      '互动率%': view ? Math.round(eng / view * 10000) / 100 : null, 封面图: x.cover ? { link: x.cover, text: '封面' } : null };
  }
  let busy = Promise.resolve();
  function sync(b) { const p = busy.then(() => sync1(b)); busy = p.catch(() => { }); return p; }
  async function sync1(b) {
    const plat = b.platform === 'channels' ? '视频号' : '抖音'; const acc = String(b.account || '').trim().slice(0, 60); if (!acc) throw new Error('缺少账号名');
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 3000); if (!items.length) return { ok: true, added: 0, updated: 0 };
    const rows = items.map(x => plat === '抖音' ? fromDouyin(x, acc) : fromChannels(x, acc)).filter(r => r.作品ID && r.作品ID !== 'undefined');
    const A = priv(), T = await table(); const old = await recs(A, T);
    const map = new Map(old.map(r => [val((r.fields || {})['平台']) + '|' + val((r.fields || {})['作品ID']), r.record_id]));
    const now = Date.now(); const add = [], upd = [];
    for (const r of rows) { r.同步时间 = now; Object.keys(r).forEach(k => (r[k] === null || r[k] === undefined || r[k] === '') && delete r[k]); const id = map.get(r.平台 + '|' + r.作品ID); if (id) upd.push({ record_id: id, fields: r }); else add.push({ fields: r }); }
    for (let i = 0; i < add.length; i += 400) await api.call('POST', `/bitable/v1/apps/${A}/tables/${T}/records/batch_create`, { records: add.slice(i, i + 400) });
    for (let i = 0; i < upd.length; i += 400) await api.call('POST', `/bitable/v1/apps/${A}/tables/${T}/records/batch_update`, { records: upd.slice(i, i + 400) });
    log(`[官方号] ${plat}「${acc}」同步 ${rows.length} 条：新增 ${add.length}，更新 ${upd.length}`);
    return { ok: true, added: add.length, updated: upd.length, total: rows.length };
  }
  return { sync, table };
}
module.exports = { createOfficial };
