/* 本地库测试（不连飞书、不连云空间）：mock 掉 api.call，验证迁移 / 双写 / 查询 / 核对 / 可归档
 * 用法：node test-db.js
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { createStore, dbOn } = require('./lib/store');
const { createDbMigrate } = require('./lib/dbmigrate');
const { createCore } = require('./lib/core');
const { createTgt } = require('./lib/tgt');
const { writeXlsx } = require('./lib/xlsxwrite');
const { readXlsx } = require('./lib/xlsx');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiju-db-'));
const log = (...a) => console.log('  ·', a.join(' '));
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('✅ ' + name); } else { fail++; console.log('❌ ' + name + (extra ? '：' + extra : '')); } }

// ---------- 假的飞书 ----------
const FEI = { daily: [], tgt: [] };
const tid = p => p.includes('/tables/tD/') ? 'daily' : p.includes('/tables/tT/') ? 'tgt' : null;
async function call(method, p, body, q) {
  if (method === 'GET' && /\/apps\/[^/]+\/tables$/.test(p)) return { items: [{ name: '经营日报数据', table_id: 'tD' }, { name: '推广通数据', table_id: 'tT' }] };
  if (method === 'GET' && /\/tables\/t[D|T]\/fields$/.test(p)) return { items: [] };
  if (method === 'POST' && /records\/search$/.test(p)) {
    const k = tid(p), all = FEI[k], ps = 500, pt = q && q.page_token ? +q.page_token : 0;
    return { items: all.slice(pt, pt + ps).map(f => ({ record_id: 'r' + pt, fields: f })), has_more: pt + ps < all.length, page_token: String(pt + ps) };
  }
  if (method === 'POST' && /records\/batch_create$/.test(p)) { const k = tid(p); (body.records || []).forEach(r => FEI[k].push(r.fields)); return {}; }
  if (method === 'POST' && /records\/batch_update$/.test(p)) return {};
  if (method === 'POST' && /\/fields$/.test(p)) return {};
  throw new Error('测试里没模拟这个接口：' + method + ' ' + p);
}

const store = createStore({ dataDir: dir, log });
const cfg = { baseUrl: 'https://x.feishu.cn/base/app2', dailyBaseUrl: 'https://x.feishu.cn/base/app1', dailyTable: '经营日报数据' };
const core = createCore({ cfg, api: { call }, log, store });
const tgt = createTgt({ cfg, api: { call }, log, store });
const mig = createDbMigrate({ cfg, api: { call }, core, store, log });

const T = (y, m, d) => new Date(y, m - 1, d).getTime(); // 北京时间 0 点
const day = ts => new Date(ts).toISOString().slice(0, 10);

(async () => {
  console.log('\n【1】数据库基本读写（单独一个空库，不干扰后面的核对）');
  const storeA = createStore({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'xiju-db-a-')), log });
  ok('数据库已就绪（' + storeA.kind + '）', storeA.ok, storeA.error);
  storeA.upsertDaily({ 日期: T(2026, 11, 1), 门店: 'A店', 总营业额: 1000, 午市: 400 });
  storeA.upsertDaily({ 日期: T(2026, 11, 1), 门店: 'A店', 晚市: 600 });
  const one = storeA.queryDaily({});
  ok('同店同日只一行（合并字段）', one.length === 1 && one[0]['午市'] === 400 && one[0]['晚市'] === 600, JSON.stringify(one));
  ok('按日期区间查询', storeA.queryDaily({ from: T(2026, 11, 2) }).length === 0);
  storeA.upsertTgt({ 日期: T(2026, 11, 1), 门店ID: 'S1', 门店: 'A店', 花费: 300 });
  storeA.upsertTgt({ 日期: T(2026, 11, 1), 门店ID: 'S1', 门店: 'A店', 花费: 350 });
  ok('推广通按 日期+门店ID 覆盖', storeA.queryTgt({}).length === 1 && storeA.queryTgt({})[0]['花费'] === 350);
  storeA.close();

  console.log('\n【2】一次性迁移（可重复跑，不产生重复行）');
  FEI.daily.length = 0; FEI.tgt.length = 0;
  FEI.daily.push({ 日期: T(2026, 5, 1), 门店: 'A店', 总营业额: 800, 来源: '群消息' });
  FEI.daily.push({ 日期: T(2026, 5, 2), 门店: 'A店', 总营业额: 900, 来源: '群消息' });
  FEI.daily.push({ 日期: T(2026, 11, 8), 门店: 'B店', 总营业额: 1500, 来源: '群消息' });
  FEI.tgt.push({ 日期: T(2026, 11, 8), 门店ID: 'S2', 门店: 'B店', 花费: 500 });
  // 上一轮的测试数据留着会干扰行数比对，先清库
  store.raw('SELECT 1');
  const before = store.count('daily');
  const r1 = await mig.migrate({ force: true });
  ok('迁移返回 ok', r1.ok === true, JSON.stringify(r1.skipped));
  ok('日报从飞书进了库（新增 ' + (store.count('daily') - before) + ' 行）', store.count('daily') === before + 3);
  const r2 = await mig.migrate({ force: true });
  ok('再跑一次行数不变（幂等）', store.count('daily') === before + 3, '现在 ' + store.count('daily'));
  ok('推广通也迁了', store.count('tgt') >= 1);

  console.log('\n【3】逐店核对 /lib/dbcheck');
  const ck = await mig.check();
  ok('核对通过（飞书 = 数据库）', ck.ok === true, JSON.stringify(ck.daily && Object.entries(ck.daily).filter(([, v]) => !v.一致)));
  ok('核对里有每家店的行数/日期范围/营业额合计', ck.daily['A店'] && ck.daily['A店'].飞书.rows === 2 && ck.daily['A店'].飞书.sum === 1700, JSON.stringify(ck.daily['A店']));
  FEI.daily.push({ 日期: T(2026, 11, 9), 门店: 'C店', 总营业额: 700 });
  const ck2 = await mig.check();
  ok('飞书多一行时核对能报不一致', ck2.ok === false && ck2.daily['C店'].一致 === false);
  FEI.daily.pop();
  ok('核对结论能写成一行日志', typeof mig.plain(ck) === 'string' && mig.plain(ck).includes('一致'), mig.plain(ck));

  console.log('\n【4】可归档统计（只算，不删）');
  const ar = await mig.archivable(120);
  ok('早于 120 天的行被算成可归档', ar.daily.可归档行数 >= 2, JSON.stringify(ar.daily));
  ok('近期的行不算（B 店 11/08 留着）', !Object.keys(ar.daily.门店).includes('B店'), JSON.stringify(Object.keys(ar.daily.门店)));
  ok('明确标了「只统计不删除」', ar.只统计不删除 === true);

  console.log('\n【5】双写：群里收到日报 → 飞书 + 数据库各一份');
  const text = ['以下为营业日概况', '日期：2026-11-09', '门店：深圳华强北燕南店', '当天总营业额：12345.6', '午市营业额：5000', '晚市营业额：7345.6', '顾客到店消费 10000', '外卖下单 2345.6', '采购总金额：3000', '共计上班人数：12 人（楼面：8 人，厨房：4 人）', '大众点评：评分 4.8，好评 120 条，差评 1 条'].join('\n');
  const feiBefore = FEI.daily.length;
  const out = await core.handleDaily(text, '群消息');
  ok('日报解析成功', out && out.length === 1 && out[0].total === 12345.6, JSON.stringify(out && out[0]));
  ok('写进了飞书', FEI.daily.length === feiBefore + 1);
  const row = store.queryDaily({ store: '深圳华强北燕南店' })[0];
  ok('同时写进了数据库', !!row && row['总营业额'] === 12345.6 && row['上班人数'] === 12, JSON.stringify(row));
  ok('数据库里的字段和飞书表一致', !!row['门店'] && !!row['来源'] && !!row['录入时间']);

  console.log('\n【6】双写：推广通报表 → 飞书 + 数据库');
  const buf = writeXlsx([{ name: 'Sheet1', rows: [['日期', '门店名称', '门店ID', '花费', '曝光', '点击', '商户浏览量', '团购订单量'], ['2026-11-09', '也是大排档深圳华强北燕南店', 'S3', 666, 1000, 50, 300, 7]] }]);
  const rt = await tgt.ingest(buf);
  ok('推广通解析出 1 行', rt && rt.rows === 1, JSON.stringify(rt));
  const t1 = store.queryTgt({ storeId: 'S3' })[0];
  ok('推广通进了数据库', !!t1 && t1['花费'] === 666 && t1['门店'] === '深圳华强北燕南店', JSON.stringify(t1));

  console.log('\n【7】开关 cfg.useDb');
  ok('默认开', dbOn({}) === true);
  ok('关掉能退回读飞书', dbOn({ useDb: false }) === false && dbOn({ useDb: 0 }) === false && dbOn({ useDb: '0' }) === false);

  console.log('\n【8】备份用的 xlsx 能读回来');
  const bk = writeXlsx([{ name: '经营日报数据', rows: [['日期', '门店', '总营业额'], [day(T(2026, 11, 9)), '深圳华强北燕南店', 12345.6]] }, { name: '推广通数据', rows: [['日期', '花费'], ['2026-11-09', 666]] }]);
  const back = readXlsx(bk);
  ok('xlsx 写出后能被自己的读取器读回', back[1] && back[1][1] === '深圳华强北燕南店', JSON.stringify(back));
  ok('文件大小合理', bk.length > 1000 && bk.length < 200000, bk.length + ' 字节');

  store.close();
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试崩了：', e); process.exit(1); });
