/* 「禧聚 AI 内容工作台」：单独的多维表格，放 AI 写的稿件、素材图库（不放营销部表格、也不放私密表格）
 * AI稿件：创作 Agent 写进来，状态 AI待审 → PR 改成「通过」后，机器人自动推到营销部「派稿记录」（状态待发布），走正常派稿
 */
'use strict';
const fs = require('fs'); const path = require('path');
const DRAFT_COLS = [['稿件编号', 1], ['状态', 3, ['AI待审', '通过', '退回', '已推送']], ['门店', 1], ['标题', 1], ['文案正文', 1], ['话题标签', 1], ['封面方案', 1], ['图片清单', 1], ['依据', 1], ['素材', 17], ['分发类别', 1], ['内容类型', 1], ['发布平台', 1], ['定位', 1], ['点评定位', 1], ['写手', 1], ['审核意见', 1], ['生成时间', 5], ['推送时间', 5]];
const LIB_COLS = [['素材编号', 1], ['图片', 17], ['门店', 1], ['菜品', 1], ['类型', 1], ['来源', 1], ['来源笔记', 1], ['标签', 1], ['使用次数', 2], ['最近使用', 5], ['入库时间', 5]];
const val = v => Array.isArray(v) ? v.map(x => (x && typeof x === 'object') ? (x.text || x.name || '') : String(x)).join('') : (v && typeof v === 'object') ? (v.text || v.name || '') : (v ?? '');

function createStudio({ cfg, api, core, upload, download, log, dataDir, bossId }) {
  const F = path.join(dataDir, 'aistudio.json'); let S = {}; try { S = JSON.parse(fs.readFileSync(F, 'utf8')); } catch (e) { }
  const save = () => { try { fs.writeFileSync(F, JSON.stringify(S)); } catch (e) { } };
  async function ensureTable(app, name, cols) {
    const t = ((await api.call('GET', `/bitable/v1/apps/${app}/tables`, null, { page_size: 100 })).items || []).find(x => x.name === name);
    const fieldOf = ([field_name, type, opts]) => Object.assign({ field_name, type }, opts ? { property: { options: opts.map((name, color) => ({ name, color })) } } : {});
    if (!t) { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables`, { table: { name, default_view_name: '全部', fields: cols.map(fieldOf) } }); return d.table_id; }
    const fd = await api.call('GET', `/bitable/v1/apps/${app}/tables/${t.table_id}/fields`, null, { page_size: 200 }); const hv = new Set((fd.items || []).map(f => f.field_name));
    for (const c of cols) if (!hv.has(c[0])) await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/fields`, fieldOf(c));
    return t.table_id;
  }
  // 建多维表格 + 把老板加成可管理（只加他一个人，不拉别人）
  async function ensure() {
    const out = { steps: [] };
    if (!S.app) {
      const d = await api.call('POST', '/bitable/v1/apps', { name: '禧聚 AI 内容工作台' }); S.app = d.app.app_token; S.url = d.app.url; save(); out.steps.push('新建多维表格');
      log('[AI工作台] 新建多维表格 ' + S.url);
    }
    if (!S.bossAdded && bossId()) {
      try { await api.call('POST', `/drive/v1/permissions/${S.app}/members`, { member_type: 'openid', member_id: bossId(), perm: 'full_access' }, { type: 'bitable', need_notification: true }); S.bossAdded = true; save(); out.steps.push('已把林总加成可管理'); }
      catch (e) { out.permError = e.message; }
    }
    S.draftT = await ensureTable(S.app, 'AI稿件', DRAFT_COLS); S.libT = await ensureTable(S.app, '素材图库', LIB_COLS); save();
    // 删掉新表格自带的空「数据表」
    try { const ts = (await api.call('GET', `/bitable/v1/apps/${S.app}/tables`, null, { page_size: 100 })).items || []; const def = ts.find(x => /^(数据表|Table1|表格1)$/.test(x.name)); if (def && ts.length > 2 && !S.cleaned) { const r = await api.call('POST', `/bitable/v1/apps/${S.app}/tables/${def.table_id}/records/search`, {}, { page_size: 5 }); if (!(r.items || []).some(x => Object.values(x.fields || {}).some(v => v !== null && v !== '' && !(Array.isArray(v) && !v.length)))) { await api.call('DELETE', `/bitable/v1/apps/${S.app}/tables/${def.table_id}`); S.cleaned = true; save(); } } } catch (e) { }
    return Object.assign(out, { app: S.app, url: S.url, bossAdded: !!S.bossAdded });
  }
  const info = () => S;
  async function addDrafts(list) { await ensure(); for (let i = 0; i < list.length; i += 100) await api.call('POST', `/bitable/v1/apps/${S.app}/tables/${S.draftT}/records/batch_create`, { records: list.slice(i, i + 100).map(f => ({ fields: f })) }); }

  // PR 把状态改成「通过」→ 推到营销部「派稿记录」（待发布），素材一起带过去
  let pushing = false;
  async function pushApproved() {
    if (pushing || !S.app || !S.draftT) return 0; pushing = true; let n = 0;
    try {
      const d = await api.call('POST', `/bitable/v1/apps/${S.app}/tables/${S.draftT}/records/search`, { filter: { conjunction: 'and', conditions: [{ field_name: '状态', operator: 'is', value: ['通过'] }] } }, { page_size: 50 });
      const rows = d.items || []; if (!rows.length) return 0;
      const app = await core.appToken(); const pg = ((await api.call('GET', `/bitable/v1/apps/${app}/tables`, null, { page_size: 100 })).items || []).find(x => x.name === '派稿记录'); if (!pg) return 0;
      for (const r of rows) {
        const f = r.fields || {}; const code = val(f['稿件编号']);
        const plats = val(f['发布平台']).split(/[、,，\s]+/).filter(Boolean);
        const out = { 文本: code, 稿件编号: code, 标题: val(f['标题']), 文案正文: val(f['文案正文']), 话题标签: val(f['话题标签']), 门店: val(f['门店']), 分发类别: val(f['分发类别']) || '小红书矩阵号', 内容类型: val(f['内容类型']) || '图文', 发布平台: plats.length ? plats : ['小红书', '大众点评', '携程', '微信贴图'], 定位: val(f['定位']), 点评定位: val(f['点评定位']), 写手: val(f['写手']), 状态: '待发布', 派稿人: 'AI工作台', 备注: [val(f['封面方案']), val(f['审核意见'])].filter(Boolean).join('\n') };
        const files = Array.isArray(f['素材']) ? f['素材'] : []; const toks = [];
        for (const x of files) { try { toks.push({ file_token: await upload(await download(x.url || x.tmp_url), x.name || 'img.jpg', 'bitable_image', app) }); } catch (e) { } }
        if (toks.length) out.素材 = toks; Object.keys(out).forEach(k => (out[k] === '' || out[k] == null) && delete out[k]);
        await api.call('POST', `/bitable/v1/apps/${app}/tables/${pg.table_id}/records`, { fields: out });
        await api.call('PUT', `/bitable/v1/apps/${S.app}/tables/${S.draftT}/records/${r.record_id}`, { fields: { 状态: '已推送', 推送时间: Date.now() } }); n++;
        log(`[AI工作台] ${code}《${out.标题}》已推到派稿记录（素材 ${toks.length}）`);
      }
    } catch (e) { log('[AI工作台] 推送出错：' + e.message); } finally { pushing = false; }
    return n;
  }
  // 把之前写进「派稿记录」的 AI待审 稿搬过来（派稿记录那边改成「取消」并备注，不删）
  let migrating = false;
  async function migrateOld() {
    if (migrating) return 0; migrating = true; try { return await migrate1(); } finally { migrating = false; }
  }
  async function migrate1() {
    await ensure(); const app = await core.appToken(); const pg = ((await api.call('GET', `/bitable/v1/apps/${app}/tables`, null, { page_size: 100 })).items || []).find(x => x.name === '派稿记录'); if (!pg) return 0;
    const out = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${pg.table_id}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); out.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    const ai = out.filter(r => val(r.fields['状态']) === 'AI待审'); const recs = [];
    for (const r of ai) { const f = r.fields; const plan = val(f['备注']); const m = plan.match(/封面：([^\n]*)\n图片清单：\n([\s\S]*?)\n依据：([^\n]*)/) || [];
      recs.push({ 稿件编号: val(f['稿件编号']), 状态: 'AI待审', 门店: val(f['门店']), 标题: val(f['标题']), 文案正文: val(f['文案正文']), 话题标签: val(f['话题标签']), 封面方案: m[1] || '', 图片清单: m[2] || '', 依据: m[3] || '', 分发类别: val(f['分发类别']), 内容类型: val(f['内容类型']), 发布平台: (Array.isArray(f['发布平台']) ? f['发布平台'] : []).join('、'), 定位: val(f['定位']), 点评定位: val(f['点评定位']), 写手: val(f['写手']), 生成时间: r.created_time || Date.now() }); }
    if (recs.length) await addDrafts(recs.map(x => { Object.keys(x).forEach(k => x[k] === '' && delete x[k]); return x; }));
    for (const r of ai) await api.call('PUT', `/bitable/v1/apps/${app}/tables/${pg.table_id}/records/${r.record_id}`, { fields: { 状态: '取消', 备注: '已移到「禧聚 AI 内容工作台」→ AI稿件' } });
    log(`[AI工作台] 从派稿记录搬了 ${recs.length} 篇 AI 稿`); return recs.length;
  }
  // 同标题的重复稿：留最早一条，其余标「退回 · 重复」（不删，由人删）
  async function markDups() {
    await ensure(); const out = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${S.app}/tables/${S.draftT}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); out.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    const seen = new Set(); let n = 0; out.sort((a, b) => (a.created_time || 0) - (b.created_time || 0));
    for (const r of out) { const k = val(r.fields['标题']).trim(); if (!k) continue; if (seen.has(k)) { if (val(r.fields['状态']) !== '退回') { await api.call('PUT', `/bitable/v1/apps/${S.app}/tables/${S.draftT}/records/${r.record_id}`, { fields: { 状态: '退回', 审核意见: '重复稿（系统搬迁时重复写入），可直接删除' } }); n++; } } else seen.add(k); }
    return { total: out.length, unique: seen.size, marked: n };
  }
  return { ensure, info, addDrafts, pushApproved, migrateOld, markDups };
}
module.exports = { createStudio };
