/* 把一张多维表格（含附件）复制到另一个多维表格：同名同字段建表 → 逐条复制 → 附件下载后重新上传
 * 断了可以接着跑：data/movebase-<表名>.json 记着「原记录 → 新记录」，跑过的不再复制
 * 复制完成后由 libbase 把机器人对这张表的读写切到新位置；旧表不删（由人工确认后自己删）
 */
'use strict';
const fs = require('fs'), path = require('path');
const SIMPLE = new Set([1, 2, 3, 4, 5, 7, 13, 15, 17]); // 文本 数字 单选 多选 日期 复选 电话 链接 附件

function createMover({ api, upload, dl, log, dataDir }) {
  const run = {};
  async function tables(app) { const all = []; let pt = ''; do { const d = await api.call('GET', `/bitable/v1/apps/${app}/tables`, null, Object.assign({ page_size: 100 }, pt ? { page_token: pt } : {})); all.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt); return all; }
  async function fields(app, tid) { return ((await api.call('GET', `/bitable/v1/apps/${app}/tables/${tid}/fields`, null, { page_size: 200 })).items || []); }

  async function move(name, from, to, onDone) {
    if (run[name] && run[name].busy) return run[name];
    const F = path.join(dataDir, 'movebase-' + name.replace(/[^\p{L}\p{N}]/gu, '') + '.json');
    let st = { map: {} }; try { st = Object.assign(st, JSON.parse(fs.readFileSync(F, 'utf8'))); } catch (e) { }
    const save = () => { try { fs.writeFileSync(F, JSON.stringify(st)); } catch (e) { } };
    const R = run[name] = { busy: true, name, total: 0, done: Object.keys(st.map).length, files: 0, fail: 0, error: '' };
    (async () => {
      try {
        const src = (await tables(from)).find(x => x.name === name); if (!src) throw new Error('原表格里没有「' + name + '」');
        const sf = (await fields(from, src.table_id)).filter(f => SIMPLE.has(f.type));
        let dst = (await tables(to)).find(x => x.name === name);
        if (!dst) {
          const first = sf.find(f => f.is_primary) || sf[0];
          const d = await api.call('POST', `/bitable/v1/apps/${to}/tables`, { table: { name, default_view_name: '全部', fields: [first].map(f => ({ field_name: f.field_name, type: f.type })) } });
          dst = { table_id: d.table_id }; log(`[搬表] 营销部表格里新建「${name}」`);
        }
        const have = new Set((await fields(to, dst.table_id)).map(f => f.field_name));
        for (const f of sf) if (!have.has(f.field_name)) { const body = { field_name: f.field_name, type: f.type }; if (f.property && [2, 3, 4, 5].includes(f.type)) body.property = f.property; try { await api.call('POST', `/bitable/v1/apps/${to}/tables/${dst.table_id}/fields`, body); } catch (e) { await api.call('POST', `/bitable/v1/apps/${to}/tables/${dst.table_id}/fields`, { field_name: f.field_name, type: f.type }); } }
        const types = Object.fromEntries(sf.map(f => [f.field_name, f.type]));
        const recs = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${from}/tables/${src.table_id}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); recs.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
        R.total = recs.length; log(`[搬表] 「${name}」共 ${recs.length} 条，已搬 ${R.done} 条，开始复制…`);
        const todo = recs.filter(r => !st.map[r.record_id]);
        for (let i = 0; i < todo.length; i += 20) {
          const part = todo.slice(i, i + 20), out = [];
          for (const r of part) {
            const f0 = r.fields || {}, f = {};
            for (const [k, v] of Object.entries(f0)) {
              const t = types[k]; if (!t || v === null || v === undefined || v === '') continue;
              if (t === 17) { const toks = []; for (const a of (Array.isArray(v) ? v : [])) { try { const buf = await dl(a.url || `https://open.feishu.cn/open-apis/drive/v1/medias/${a.file_token}/download`); toks.push({ file_token: await upload(buf, a.name || 'img.jpg', 'bitable_image', to) }); R.files++; } catch (e) { R.fail++; } } if (toks.length) f[k] = toks; }
              else if (t === 1) f[k] = Array.isArray(v) ? v.map(x => (x && typeof x === 'object') ? (x.text || x.link || '') : String(x)).join('') : String(v);
              else if (t === 15) f[k] = (v && typeof v === 'object') ? { link: v.link || '', text: v.text || v.link || '' } : { link: String(v), text: String(v) };
              else f[k] = v;
            }
            out.push({ src: r.record_id, fields: f });
          }
          const d = await api.call('POST', `/bitable/v1/apps/${to}/tables/${dst.table_id}/records/batch_create`, { records: out.map(x => ({ fields: x.fields })) });
          (d.records || []).forEach((x, j) => { if (out[j]) st.map[out[j].src] = x.record_id; }); save(); R.done = Object.keys(st.map).length;
          if ((i / 20) % 10 === 0) log(`[搬表] 「${name}」${R.done}/${R.total}，附件 ${R.files}${R.fail ? '，附件失败 ' + R.fail : ''}`);
        }
        R.dst = dst.table_id; log(`[搬表] 「${name}」复制完成：${R.done}/${R.total} 条，附件 ${R.files} 个${R.fail ? '（' + R.fail + ' 个没搬成）' : ''}`);
        if (onDone) await onDone(R);
      } catch (e) { R.error = e.message; log(`[搬表] 「${name}」出错：${e.message}`); }
      finally { R.busy = false; }
    })();
    return R;
  }
  return { move, status: () => run };
}
module.exports = { createMover };
