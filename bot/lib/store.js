/* 营业数据本地库（SQLite）：日报和推广通全部存在服务器磁盘上
 * · 库文件：data/xiju.db（云端就是 /opt/xiju-bot/data/xiju.db）
 * · Node ≥ 22.13 用内置 node:sqlite，不用装任何东西；老版本退回 better-sqlite3（懒加载）
 * · 装不上 / 打不开都不影响机器人：所有方法变成空操作，读写照旧走飞书（cfg.useDb 关掉也不会崩）
 * · 列名、类型和飞书表一一对应（直接取 lib/daily.js、lib/tgt.js 的 COLS），方便逐店核对
 */
'use strict';
const path = require('path');
const D = require('./daily'); const T = require('./tgt');

const num = v => { if (v === null || v === undefined || v === '') return null; const x = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,¥￥%\s]/g, '')); return isFinite(x) ? x : null; };
const txt = v => { if (v === null || v === undefined) return null; if (Array.isArray(v)) v = v.map(x => (x && x.text) || x || '').join(''); const s = (v && typeof v === 'object') ? (v.text !== undefined ? v.text : (v.name || '')) : String(v); return s === '' ? null : s; };

// COLS 里的 type：1 = 文本，5 = 日期/时间（毫秒时间戳），其余按数字
const sqlType = t => t === 1 ? 'TEXT' : t === 5 ? 'INTEGER' : 'REAL';
const TABLE = {
  daily: { cols: D.COLS, pk: ['门店', '日期'], ts: '日期' },
  tgt: { cols: T.COLS, pk: ['日期', '门店ID'], ts: '日期' }
};

function createStore({ dataDir, file, log }) {
  log = log || console.log;
  const dbFile = file || path.join(dataDir || process.env.BOT_DATA_DIR || path.join(__dirname, '..'), 'xiju.db');
  const v = String(process.versions.node || '0').split('.').map(Number);
  const builtinOk = v[0] > 22 || (v[0] === 22 && (v[1] || 0) >= 13);
  const candidates = builtinOk
    ? [['node:sqlite', () => require('node:sqlite').DatabaseSync], ['better-sqlite3', () => require('better-sqlite3')]]
    : [['better-sqlite3', () => require('better-sqlite3')], ['node:sqlite', () => require('node:sqlite').DatabaseSync]];
  let db = null, kind = 'none', err = null;
  for (const [k, get] of candidates) {
    try { db = new (get())(dbFile); kind = k; break; } catch (e) { err = e; }
  }
  if (!db) { log(`[数据库] 用不了 SQLite（Node ${process.versions.node}）：${err && err.message ? err.message : '没有可用的驱动'}。营业数据继续只走飞书表格，不影响机器人运行。`); return mock(dbFile); }

  const prep = new Map();
  const stmt = sql => { if (prep.has(sql)) return prep.get(sql); const s = db.prepare(sql); prep.set(sql, s); return s; };
  const tx = fn => { db.exec('BEGIN'); try { fn(); db.exec('COMMIT'); } catch (e) { try { db.exec('ROLLBACK'); } catch (e2) { } throw e; } };

  try {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    try { db.exec('PRAGMA busy_timeout = 5000'); } catch (e) { }
    db.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)');
    for (const [name, { cols, pk }] of Object.entries(TABLE)) {
      const body = cols.map(([c, t]) => `"${c}" ${sqlType(t)}`).join(', ');
      db.exec(`CREATE TABLE IF NOT EXISTS ${name} (${body}, updated_at INTEGER, PRIMARY KEY (${pk.map(c => `"${c}"`).join(', ')}))`);
    }
  } catch (e) { log('[数据库] 建表失败，退回只走飞书：' + e.message); return mock(dbFile, e); }

  const colsOf = name => TABLE[name].cols.map(([c]) => c);
  function fieldsOf(name, row) { const o = {}; for (const [c] of TABLE[name].cols) { const x = row[c]; if (x !== null && x !== undefined) o[c] = x; } return o; }

  // 只写传进来的列（其他列保留原值），重复的（门店+日期 / 日期+门店ID）直接更新
  function upsert(name, f) {
    if (!f) return 0;
    const { cols, pk } = TABLE[name];
    const set = {}; for (const [c, t] of cols) { if (f[c] === undefined) continue; const x = t === 1 ? txt(f[c]) : num(f[c]); if (x !== null) set[c] = x; }
    if (Object.keys(set).length === 0) return 0;
    if (pk.some(c => set[c] === null || set[c] === undefined)) return 0; // 没有主键的行不写（和飞书那边一样认不出来）
    const ks = Object.keys(set); const now = Date.now();
    const sql = `INSERT INTO ${name} (${ks.map(c => `"${c}"`).join(', ')}, updated_at) VALUES (${ks.map(() => '?').join(', ')}, ?)`
      + ` ON CONFLICT (${pk.map(c => `"${c}"`).join(', ')}) DO UPDATE SET ${ks.map(c => `"${c}" = excluded."${c}"`).join(', ')}, updated_at = excluded.updated_at`;
    stmt(sql).run(...ks.map(c => set[c]), now);
    return 1;
  }
  function upserts(name, list) {
    const a = (list || []).filter(Boolean); if (!a.length) return 0;
    let n = 0; tx(() => { for (const f of a) n += upsert(name, f); }); return n;
  }
  function query(name, { from, to, store, storeId } = {}) {
    const w = [], p = [];
    if (from) { w.push(`"${TABLE[name].ts}" >= ?`); p.push(from); }
    if (to) { w.push(`"${TABLE[name].ts}" <= ?`); p.push(to); }
    if (store) { w.push('"门店" = ?'); p.push(store); }
    if (storeId) { w.push('"门店ID" = ?'); p.push(storeId); }
    const sql = `SELECT * FROM ${name}` + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ` ORDER BY "${TABLE[name].ts}"`;
    return stmt(sql).all(...p).map(r => fieldsOf(name, r));
  }
  // 逐店统计（核对用）
  function stats(name, by) {
    const k = by || '门店';
    return stmt(`SELECT "${k}" AS k, COUNT(*) AS n, MIN("${TABLE[name].ts}") AS min, MAX("${TABLE[name].ts}") AS max, SUM("总营业额") AS sum FROM ${name} GROUP BY "${k}"`)
      .all().map(r => ({ [k]: r.k, n: r.n, min: r.min, max: r.max, sum: name === 'daily' ? r.sum : null })).map(r => { if (name !== 'daily') delete r.sum; return r; });
  }
  const count = name => (stmt(`SELECT COUNT(*) AS n FROM ${name}`).get() || {}).n || 0;
  const raw = (sql, ...p) => stmt(sql).all(...p);
  function meta(k, v) {
    if (v === undefined) { const r = stmt('SELECT v FROM meta WHERE k = ?').get(k); return r ? r.v : null; }
    stmt('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').run(k, String(v)); return v;
  }
  function close() { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) { } try { db.close(); } catch (e) { } }
  // 导出一份完整副本（备份用）：先落盘 WAL，再 VACUUM INTO；不行就退回复制文件
  function backupTo(dest) {
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) { }
    try { db.exec(`VACUUM INTO '${String(dest).replace(/'/g, "''")}'`); return true; }
    catch (e) { require('fs').copyFileSync(dbFile, dest); return true; }
  }
  log(`[数据库] 已就绪：${dbFile}（${kind}，日报 ${count('daily')} 行、推广通 ${count('tgt')} 行）`);

  return {
    ok: true, kind, file: dbFile,
    upsertDaily: f => { try { return upsert('daily', f); } catch (e) { log('[数据库] 写日报失败：' + e.message); return 0; } },
    upsertDailys: l => { try { return upserts('daily', l); } catch (e) { log('[数据库] 批量写日报失败：' + e.message); return 0; } },
    upsertTgt: f => { try { return upsert('tgt', f); } catch (e) { log('[数据库] 写推广通失败：' + e.message); return 0; } },
    upsertTgts: l => { try { return upserts('tgt', l); } catch (e) { log('[数据库] 批量写推广通失败：' + e.message); return 0; } },
    queryDaily: o => { try { return query('daily', o); } catch (e) { log('[数据库] 读日报失败：' + e.message); return []; } },
    queryTgt: o => { try { return query('tgt', o); } catch (e) { log('[数据库] 读推广通失败：' + e.message); return []; } },
    statsDaily: () => { try { return stats('daily'); } catch (e) { return []; } },
    statsTgt: () => { try { return stats('tgt'); } catch (e) { return []; } },
    count, raw, meta, close, backupTo,
    ready: () => { try { return meta('migrate.ok') === '1'; } catch (e) { return false; } }, // 迁移核对通过才算就绪
    dateRange: name => stmt(`SELECT MIN("${TABLE[name].ts}") AS min, MAX("${TABLE[name].ts}") AS max FROM ${name}`).get()
  };
}

// 没有数据库时：全部方法空转，机器人照常跑（只走飞书）
function mock(file, e) {
  const noop = () => 0;
  return {
    ok: false, kind: 'none', file, error: e ? e.message : '没有可用的 SQLite 驱动',
    upsertDaily: noop, upsertDailys: noop, upsertTgt: noop, upsertTgts: noop,
    queryDaily: () => [], queryTgt: () => [], statsDaily: () => [], statsTgt: () => [],
    count: () => 0, raw: () => [], meta: () => null, ready: () => false, close: () => { }, backupTo: () => { }, dateRange: () => ({ min: null, max: null })
  };
}

module.exports = { createStore, dbOn: cfg => !(cfg && (cfg.useDb === false || cfg.useDb === 0 || cfg.useDb === '0')) };
