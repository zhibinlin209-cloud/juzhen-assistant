/* 「禧聚 AI 内容工作台」：单独的多维表格，放 AI 写的稿件、素材图库（不放营销部表格、也不放私密表格）
 * AI稿件：创作 Agent 写进来，状态 AI待审 → PR 改成「通过」后，机器人自动推到营销部「派稿记录」（状态待发布），走正常派稿
 */
'use strict';
const fs = require('fs'); const path = require('path');
const DRAFT_COLS = [['稿件编号', 1], ['状态', 3, ['AI待审', '通过', '退回', '已推送']], ['门店', 1], ['标题', 1], ['文案正文', 1], ['话题标签', 1], ['封面方案', 1], ['图片清单', 1], ['依据', 1], ['素材', 17], ['分发类别', 1], ['内容类型', 1], ['发布平台', 1], ['定位', 1], ['点评定位', 1], ['写手', 1], ['审核意见', 1], ['生成时间', 5], ['推送时间', 5]];
const LIB_COLS = [['素材编号', 1], ['图片', 17], ['门店', 1], ['菜品', 1], ['类型', 1], ['来源', 1], ['来源笔记', 1], ['标签', 1], ['使用次数', 2], ['最近使用', 5], ['入库时间', 5], ['可用', 3, ['可用', '不可用']], ['主体', 1], ['有字', 3, ['无', '少', '多']], ['封面分', 2], ['AI识别', 1]];
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
  // 素材图库：把私密表格「自家内容库」里的笔记图片搬进来（每轮最多 n 张，记住搬过的）
  let importing = false;
  async function importLib(n) {
    if (importing) return { busy: true }; importing = true; let added = 0;
    try {
      await ensure(); S.libDone = S.libDone || {};
      const m = String(cfg.dailyBaseUrl || '').match(/\/base\/([A-Za-z0-9]+)/); if (!m) return { error: 'no private base' }; const P = m[1];
      const t = ((await api.call('GET', `/bitable/v1/apps/${P}/tables`, null, { page_size: 100 })).items || []).find(x => x.name === '自家内容库'); if (!t) return { error: '没有自家内容库' };
      const rows = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${P}/tables/${t.table_id}/records/search`, {}, Object.assign({ page_size: 200 }, pt ? { page_token: pt } : {})); rows.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
      const batch = [];
      for (const r of rows) {
        if (added >= (n || 150)) break; const f = r.fields || {}; const imgs = [].concat(Array.isArray(f['封面']) ? f['封面'].map(x => [x, '封面']) : [], Array.isArray(f['图片']) ? f['图片'].map(x => [x, '内页']) : []);
        let cover = {}; try { cover = JSON.parse(val(f['封面分析']) || '{}'); } catch (e) { }
        for (let i = 0; i < imgs.length && added < (n || 150); i++) {
          const [x, kind] = imgs[i]; if (!x || !x.file_token || S.libDone[x.file_token]) continue;
          try { const tok = await upload(await download(x.url || x.tmp_url), x.name || 'img.jpg', 'bitable_image', S.app);
            batch.push({ 素材编号: `${val(f['门店']) || '未标'}-${val(f['笔记ID']).slice(-6)}-${i + 1}`, 图片: [{ file_token: tok }], 门店: val(f['门店']), 类型: kind === '封面' ? (cover.封面形式 ? '封面·' + cover.封面形式 : '封面') : '', 来源: '自家笔记 · ' + val(f['账号']), 来源笔记: val(f['标题']), 标签: kind === '封面' ? [cover.主体, cover.色调].filter(Boolean).join('、') : '', 使用次数: 0, 入库时间: Date.now() });
            S.libDone[x.file_token] = 1; added++;
          } catch (e) { }
          if (batch.length >= 50) { await api.call('POST', `/bitable/v1/apps/${S.app}/tables/${S.libT}/records/batch_create`, { records: batch.splice(0).map(fields => ({ fields })) }); save(); }
        }
      }
      if (batch.length) await api.call('POST', `/bitable/v1/apps/${S.app}/tables/${S.libT}/records/batch_create`, { records: batch.map(fields => ({ fields })) });
      save(); if (added) log(`[AI工作台] 素材图库新增 ${added} 张（累计 ${Object.keys(S.libDone).length}）`);
      return { added, total: Object.keys(S.libDone).length };
    } finally { importing = false; }
  }
  // 素材逐张看图打标（通义千问 VL）：能不能用、主体、菜名、有没有后期大字、是不是别家店、适合当封面几分
  let tagging = false; const VLS = [...new Set([cfg.qwenModel, 'qwen3-vl-plus', 'qwen-vl-max-latest', 'qwen-vl-max', 'qwen-vl-plus'].filter(Boolean))];
  async function small(buf) { try { const c = require('@napi-rs/canvas'); const im = await c.loadImage(buf); const r = Math.min(1, 640 / Math.max(im.width, im.height)); const cv = c.createCanvas(Math.round(im.width * r), Math.round(im.height * r)); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); return cv.encode('jpeg', 80); } catch (e) { return buf.length < 1.5e6 ? buf : null; } }
  async function vl(bufs) {
    const prompt = `这 ${bufs.length} 张照片候选给粤式大排档（YES也是大排档 / 粤迹·岭南家宴）的小红书笔记当配图。逐张判断，只输出 JSON 数组，每张一个对象：{"i":序号从1开始,"主体":"菜品|门头|店内环境|街景|风景|人物|海报截图|其他","菜品":"看得出的菜名，看不出就空","有字":"无|少|多"（指后期加上去的大字、贴纸、截图文字；招牌、菜单上的原有字不算）,"别家店":true或false（能看出是别家店的招牌，或明显不是大排档/粤菜馆）,"封面分":0到10（清晰度、色彩、食欲感，适不适合当封面主图）,"可用":true或false（真实拍的菜品/门头/店内，没有大面积后期文字，不是别家店，不是纯风景）}`;
    for (const model of VLS) {
      try {
        const r = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.qwenKey }, signal: AbortSignal.timeout(90000),
          body: JSON.stringify({ model, temperature: 0.1, max_tokens: 900, messages: [{ role: 'user', content: bufs.map(b => ({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b.toString('base64') } })).concat([{ type: 'text', text: prompt }]) }] }) });
        const j = await r.json(); if (!r.ok) { if (/not exist|not found|access/i.test(JSON.stringify(j))) continue; throw new Error(JSON.stringify(j).slice(0, 200)); }
        const t = (j.choices?.[0]?.message?.content || '').replace(/```json|```/g, ''); const a = JSON.parse(t.slice(t.indexOf('['), t.lastIndexOf(']') + 1)); return a;
      } catch (e) { if (model === VLS[VLS.length - 1]) throw e; }
    }
    return null;
  }
  async function tagLib(n, store) {
    if (tagging || !cfg.qwenKey) return { busy: tagging }; tagging = true; let done = 0, ok = 0;
    try {
      await ensure(); const rows = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${S.app}/tables/${S.libT}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); rows.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
      let todo = rows.filter(r => !val(r.fields['AI识别']) && (r.fields['图片'] || [])[0]);
      if (store) todo = todo.filter(r => val(r.fields['门店']).includes(store)).concat(todo.filter(r => !val(r.fields['门店']).includes(store)));
      todo = todo.slice(0, n || 60);
      for (let i = 0; i < todo.length; i += 6) {
        const grp = todo.slice(i, i + 6), bufs = [], keep = [];
        for (const r of grp) { try { const x = r.fields['图片'][0]; const b = await small(await download(x.url || x.tmp_url)); if (b) { bufs.push(b); keep.push(r); } } catch (e) { } }
        if (!bufs.length) continue; let a = null; try { a = await vl(bufs); } catch (e) { log('[AI工作台] 看图打标出错：' + e.message); break; }
        if (!Array.isArray(a)) continue;
        const recs = keep.map((r, k) => { const o = a.find(x => +x.i === k + 1) || a[k] || {}; const use = o.可用 === true && o.别家店 !== true && o.有字 !== '多'; if (use) ok++; return { record_id: r.record_id, fields: { 可用: use ? '可用' : '不可用', 主体: String(o.主体 || ''), 菜品: String(o.菜品 || val(r.fields['菜品']) || ''), 有字: ['无', '少', '多'].includes(o.有字) ? o.有字 : null, 封面分: +o.封面分 || 0, AI识别: JSON.stringify(o).slice(0, 300) } }; });
        await api.call('POST', `/bitable/v1/apps/${S.app}/tables/${S.libT}/records/batch_update`, { records: recs }); done += recs.length;
      }
      if (done) log(`[AI工作台] 素材看图打标 ${done} 张，可用 ${ok} 张`);
      return { done, ok, left: rows.filter(r => !val(r.fields['AI识别'])).length - done };
    } finally { tagging = false; }
  }
  async function dishes(store) {
    if (!S.app || !S.libT) return []; const key = String(store || '').replace(/^(深圳|广州|惠州|珠海|佛山|东莞)/, '').replace(/店$/, ''); const alias = { 保利西街: '千灯湖', 蛇口招商花园城: '花园城', 东城33小镇: '33小镇', 华强北燕南: '华强北', 前海HOP: '前海' }; const want = alias[key] || key;
    const rows = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${S.app}/tables/${S.libT}/records/search`, { filter: { conjunction: 'and', conditions: [{ field_name: '可用', operator: 'is', value: ['可用'] }] } }, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); rows.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    const c = {}; rows.filter(r => { const s = val(r.fields['门店']); return s && (s.includes(want) || want.includes(s)); }).forEach(r => { const d = val(r.fields['菜品']).trim(); if (d) c[d] = (c[d] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  }
  // 给稿件自动配图：同门店、用得少、来自不同笔记的图优先，最多 9 张；用过的计数 +1
  async function pickImages(store, k) {
    if (!S.app || !S.libT) return [];
    const key = String(store || '').replace(/^(深圳|广州|惠州|珠海|佛山|东莞)/, '').replace(/店$/, '');
    const rows = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${S.app}/tables/${S.libT}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); rows.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    const alias = { 保利西街: '千灯湖', 蛇口招商花园城: '花园城', 东城33小镇: '33小镇', 华强北燕南: '华强北', 前海HOP: '前海', '粤迹·岭南家宴': '花园城' };
    const want = alias[key] || key;
    const all = rows.filter(r => { const s = val(r.fields['门店']); return s && (s.includes(want) || want.includes(s)); }).filter(r => !r.fields['最近使用'] || r.fields['最近使用'] < Date.now() - 30 * 864e5).filter(r => val(r.fields['可用']) !== '不可用');
    const good = all.filter(r => val(r.fields['可用']) === '可用');
    const sc = r => (+r.fields['封面分'] || 0) - 3 * (+r.fields['使用次数'] || 0) + Math.random();
    const cand = (good.length >= Math.min(k || 9, 4) ? good : all).sort((a, b) => sc(b) - sc(a));
    const out = [], usedNote = new Set();
    for (const r of cand) { if (out.length >= (k || 9)) break; const note = val(r.fields['来源笔记']); if (usedNote.has(note) && cand.length > (k || 9) * 2) continue; usedNote.add(note); const img = (r.fields['图片'] || [])[0]; if (img) out.push({ r, img }); }
    for (const x of out) await api.call('PUT', `/bitable/v1/apps/${S.app}/tables/${S.libT}/records/${x.r.record_id}`, { fields: { 使用次数: (+x.r.fields['使用次数'] || 0) + 1, 最近使用: Date.now() } });
    return out.map(x => ({ file_token: x.img.file_token, url: x.img.url || x.img.tmp_url, kind: val(x.r.fields['类型']), dish: val(x.r.fields['菜品']), score: +x.r.fields['封面分'] || 0 }));
  }
  // 封面：从配好的图里挑（优先内页图，旧封面上有字），拼图 + 大字，上传成附件，返回 file_token
  async function makeCover(store, imgs, plan, seed) {
    const cover = require('./cover'); if (!cover.ok()) { log('[AI工作台] 封面组件没装好：' + cover.error()); return null; }
    const order = imgs.filter(x => !/封面/.test(x.kind || '')).sort((a, b) => (b.score || 0) - (a.score || 0)).concat(imgs.filter(x => /封面/.test(x.kind || '')));
    const bufs = []; for (const x of order.slice(0, 6)) { try { if (x.url) bufs.push(await download(x.url)); } catch (e) { } }
    const m = String(plan || '').match(/^(.*?)「(.*)」/); const form = m ? m[1] : '', text = m ? m[2] : String(plan || '').slice(0, 14);
    const jpg = await cover.render(bufs, { text: text || store, form, tag: String(store || '').replace(/^(深圳|广州|惠州|珠海|佛山|东莞)/, ''), seed });
    if (!jpg) return null; return upload(jpg, '封面.jpg', 'bitable_image', S.app);
  }
  // 给还没封面的 AI待审 稿补封面（补图 + 生成封面）
  async function coverize(limit) {
    await ensure(); const rows = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${S.app}/tables/${S.draftT}/records/search`, {}, Object.assign({ page_size: 200 }, pt ? { page_token: pt } : {})); rows.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    const out = []; let i = 0;
    for (const r of rows) {
      const f = r.fields || {}; if (val(f['状态']) !== 'AI待审' || /封面已生成/.test(val(f['审核意见']))) continue; if (out.length >= (limit || 10)) break;
      let imgs = (f['素材'] || []).map(x => ({ file_token: x.file_token, url: x.url || x.tmp_url, kind: '' }));
      if (imgs.length < 3) imgs = imgs.concat(await pickImages(val(f['门店']), 9 - imgs.length));
      const tok = await makeCover(val(f['门店']), imgs, val(f['封面方案']), i++);
      const fields = { 素材: (tok ? [{ file_token: tok }] : []).concat(imgs.map(x => ({ file_token: x.file_token }))), 审核意见: (tok ? `封面已生成（第 1 张）；` : '封面没生成；') + `配图 ${imgs.length} 张来自素材图库，请按图片清单核对` };
      await api.call('PUT', `/bitable/v1/apps/${S.app}/tables/${S.draftT}/records/${r.record_id}`, { fields }); out.push({ code: val(f['稿件编号']), store: val(f['门店']), imgs: imgs.length, cover: !!tok });
    }
    return out;
  }
  async function coverTest(store, plan) { const imgs = await pickImagesDry(store, 6); const cover = require('./cover'); const bufs = []; for (const x of imgs) { try { bufs.push(await download(x.url)); } catch (e) { } } const m = String(plan || '').match(/^(.*?)「(.*)」/); return cover.render(bufs, { text: m ? m[2] : plan, form: m ? m[1] : '', tag: store, seed: Date.now() % 5 }); }
  async function pickImagesDry(store, k) {
    const rows = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${S.app}/tables/${S.libT}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); rows.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    return rows.filter(r => val(r.fields['门店']).includes(store) && val(r.fields['可用']) === '可用').sort((a, b) => (+b.fields['封面分'] || 0) - (+a.fields['封面分'] || 0) + Math.random() * 3 - 1.5).slice(0, k).map(r => { const x = (r.fields['图片'] || [])[0] || {}; return { url: x.url || x.tmp_url }; });
  }
  // 同标题的重复稿：留最早一条，其余标「退回 · 重复」（不删，由人删）
  async function markDups() {
    await ensure(); const out = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${S.app}/tables/${S.draftT}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); out.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    const seen = new Set(); let n = 0; out.sort((a, b) => (a.created_time || 0) - (b.created_time || 0));
    for (const r of out) { const k = val(r.fields['标题']).trim(); if (!k) continue; if (seen.has(k)) { if (val(r.fields['状态']) !== '退回') { await api.call('PUT', `/bitable/v1/apps/${S.app}/tables/${S.draftT}/records/${r.record_id}`, { fields: { 状态: '退回', 审核意见: '重复稿（系统搬迁时重复写入），可直接删除' } }); n++; } } else seen.add(k); }
    return { total: out.length, unique: seen.size, marked: n };
  }
  return { ensure, info, addDrafts, pushApproved, migrateOld, markDups, importLib, pickImages, makeCover, coverize, coverTest, tagLib, dishes };
}
module.exports = { createStudio };
