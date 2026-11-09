/* 每周备份：把本地库导出成 xlsx（每张表一个 sheet）+ .db 原文件，存到飞书云空间私密文件夹
 * · 每周一 03:00（北京时间）跑一次；只给老板 full_access；保留最近 8 份
 * · 云空间权限不够时只在日志里写清楚缺什么，不去开放平台改权限（要改由林总自己改）
 * · 上传失败也会先把两份文件留在服务器 data/backup/ 目录，数据不丢
 */
'use strict';
const fs = require('fs'); const path = require('path');
const D = require('./daily'); const T = require('./tgt'); const { writeXlsx } = require('./xlsxwrite');

const DAY = 864e5, TZ = 8 * 3600e3;
const KEEP = 8;
const PREFIX = '禧聚经营数据备份';
const bj = ms => new Date(ms + TZ).toISOString();
const dayStr = ts => bj(ts).slice(0, 10);
const stamp = ms => bj(ms).slice(0, 10).replace(/-/g, '');
const hm = ts => bj(ts).slice(0, 16).replace('T', ' ');
// 权限不够常见错误码
const NO_PERM = [1061004, 99991672, 99991679, 99991663, 1770001];

function createDbBackup({ cfg, api, log, store, upload, bossId, dataDir }) {
  const STATE = path.join(dataDir, 'backup-state.json');
  const FOLDER_FILE = path.join(dataDir, 'backup-folder.txt');
  const LOCAL = path.join(dataDir, 'backup');
  let st = {}; try { st = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) { }
  const save = () => { try { fs.writeFileSync(STATE, JSON.stringify(st)); } catch (e) { } };

  function sheets() {
    const d = D.COLS.map(c => c[0]);
    const dailyRows = store.queryDaily({}).map(f => D.COLS.map(([c]) => (c === '日期' ? dayStr(+f[c]) : c === '录入时间' ? hm(+f[c]) : (f[c] === undefined ? '' : f[c]))));
    const t = T.COLS.map(c => c[0]);
    const tgtRows = store.queryTgt({}).map(f => T.COLS.map(([c]) => (c === '日期' ? dayStr(+f[c]) : c === '录入时间' ? hm(+f[c]) : (f[c] === undefined ? '' : f[c]))));
    return [{ name: '经营日报数据', rows: [d, ...dailyRows] }, { name: '推广通数据', rows: [t, ...tgtRows] }];
  }

  function keepLocal(name, buf) {
    try {
      fs.mkdirSync(LOCAL, { recursive: true });
      fs.writeFileSync(path.join(LOCAL, name), buf);
      const mine = fs.readdirSync(LOCAL).filter(x => x.startsWith(PREFIX)).sort();
      mine.slice(0, Math.max(0, mine.length - KEEP * 2)).forEach(x => { try { fs.unlinkSync(path.join(LOCAL, x)); } catch (e) { } });
      return true;
    } catch (e) { log('[备份] 本地留档失败：' + e.message); return false; }
  }

  async function folder() {
    if (cfg.backupFolder) return cfg.backupFolder;
    let f = ''; try { f = fs.readFileSync(FOLDER_FILE, 'utf8').trim(); } catch (e) { }
    if (f) return f;
    const d = await api.call('POST', '/drive/v1/files/create_folder', { name: '禧聚机器人备份', folder_token: '' });
    const tok = d.token || (d.data && d.data.token);
    if (!tok) throw new Error('建文件夹没拿到 token');
    try { fs.writeFileSync(FOLDER_FILE, tok); } catch (e) { }
    log('[备份] 已在云空间建好私密文件夹「禧聚机器人备份」');
    return tok;
  }

  async function run(now) {
    now = now || Date.now();
    const out = { ok: false, at: now, errors: [], files: [] };
    if (!store.ok) { out.errors.push('没有可用的数据库'); return out; }
    const tag = `${PREFIX}_${stamp(now)}`;
    const xlsx = writeXlsx(sheets());
    const xlsxName = tag + '.xlsx', dbName = tag + '.db';
    keepLocal(xlsxName, xlsx);
    let dbBuf = null;
    try { const tmp = path.join(LOCAL, dbName); fs.mkdirSync(LOCAL, { recursive: true }); store.backupTo(tmp); dbBuf = fs.readFileSync(tmp); } catch (e) { out.errors.push('数据库文件导出失败：' + e.message); }
    out.rows = { daily: store.count('daily'), tgt: store.count('tgt') };
    out.size = xlsx.length + (dbBuf ? dbBuf.length : 0);

    let tok = '';
    try { tok = await folder(); }
    catch (e) {
      const noPerm = /code|权限|permission|1061004|99991672/i.test(e.message);
      log('[备份] 云空间文件夹用不了：' + e.message + (noPerm ? '（机器人缺云空间权限 drive:drive，需要林总在开放平台给应用加「云空间」的读、写、上传权限，然后重新发布版本）' : ''));
      out.errors.push('云空间文件夹用不了：' + e.message);
      return out;
    }
    for (const [buf, name] of [[xlsx, xlsxName], [dbBuf, dbName]]) {
      if (!buf) continue;
      try {
        const fileToken = await upload(buf, name, 'explorer', tok);
        out.files.push({ name, token: fileToken });
        if (bossId()) { try { await api.call('POST', `/drive/v1/permissions/${fileToken}/members`, { member_type: 'openid', member_id: bossId(), perm: 'full_access', perm_type: 'container' }, { type: 'file' }); } catch (e) { out.errors.push(name + ' 授权给老板失败：' + e.message); log('[备份] 给老板授权失败（文件已上传）：' + e.message); } }
      } catch (e) {
        const noPerm = NO_PERM.some(c => e.message.includes(String(c)));
        log(`[备份] 上传 ${name} 失败：${e.message}` + (noPerm ? '（缺云空间上传权限 drive:drive，需要林总在开放平台补，不要自己改）' : ''));
        out.errors.push('上传 ' + name + ' 失败：' + e.message);
      }
    }
    if (!out.files.length) return out;
    // 只删我们自己传的、超过 8 份的旧文件
    try {
      const list = await api.call('GET', '/drive/v1/files', null, { folder_token: tok, page_size: 200 });
      const mine = (list.files || []).filter(f => String(f.name || '').startsWith(PREFIX)).sort((a, b) => String(b.name).localeCompare(String(a.name)));
      const old = mine.slice(KEEP);
      for (const f of old) { try { await api.call('DELETE', `/drive/v1/files/${f.token}`, null, { type: 'file' }); } catch (e) { log('[备份] 删旧备份失败 ' + f.name + '：' + e.message); } }
      out.pruned = old.map(f => f.name);
    } catch (e) { log('[备份] 列出备份文件夹失败（不影响这次备份）：' + e.message); }
    out.ok = out.files.length === (dbBuf ? 2 : 1);
    return out;
  }

  // 每周一 03:00（北京时间）跑；用状态文件防重复
  function tick() {
    const b = new Date(Date.now() + TZ); const d = Math.floor((Date.now() + TZ) / DAY);
    if (b.getUTCDay() !== 1 || b.getUTCHours() !== 3) return;
    if (st.last === d) return;
    st.last = d; save();
    run().then(r => log(`[备份] ${r.ok ? '完成' : '部分失败'}：日报 ${r.rows ? r.rows.daily : 0} 行、推广通 ${r.rows ? r.rows.tgt : 0} 行，${r.files.length} 个文件${r.pruned && r.pruned.length ? `，清掉旧备份 ${r.pruned.length} 个` : ''}${r.errors.length ? '；' + r.errors.join('；') : ''}`)).catch(e => log('[备份] 出错：' + e.message));
  }
  return { run, tick, sheets };
}

module.exports = { createDbBackup };
