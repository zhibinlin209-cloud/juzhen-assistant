/* 门店「营业日概况」（华付数科机器人每天发的那条）→ 结构化
 * 一条消息里有多份日报也能拆（补历史时整段粘贴）
 */
'use strict';
const n = s => { if (s === undefined || s === null) return null; const m = String(s).replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
const r2 = x => (x === null || x === undefined || !isFinite(x) ? null : Math.round(x * 100) / 100);

function parseOne(t) {
  const g = re => { const m = t.match(re); return m ? m[1] : null; };
  const dm = t.match(/日期[:：]\s*(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/); const date = dm ? `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}` : null; const store = (g(/门店[:：]\s*([^\n*]+)/) || '').replace(/\s+/g, '').trim();
  if (!date || !store) return null;
  const d = date.split('-').map(Number);
  const staffM = t.match(/共计上班人数[:：]\s*(\d+)\s*人\s*[（(]\s*楼面[:：]\s*(\d+)\s*人[，,]\s*厨房[:：]\s*(\d+)\s*人/);
  const plat = (name) => { const m = t.match(new RegExp('(?:^|\\n)\\s*' + name + '\\s*[:：]\\s*评分\\s*([\\d.]+)\\s*[，,]\\s*好评\\s*(\\d+)\\s*条\\s*[，,]\\s*差评\\s*(\\d+)\\s*条')); return m ? { score: n(m[1]), good: n(m[2]), bad: n(m[3]) } : {}; };
  const dp = plat('大众点评'), mt = plat('美团'), wm = plat('美团外卖'), dy = plat('抖音');
  const total = n(g(/当天(?:总)?营业额[:：][¥￥\s]*([\d.,]+)/));
  const purchase = n(g(/采购总金额[:：]?[¥￥\s]*([\d.,]+)/));
  const staff = staffM ? n(staffM[1]) : n(g(/共计上班人数[:：]\s*(\d+)/));
  return {
    date, ts: new Date(d[0], d[1] - 1, d[2]).getTime(), store,
    total, lunch: n(g(/午市营业额[:：][¥￥\s]*([\d.,]+)/)), dinner: n(g(/晚市营业额[:：][¥￥\s]*([\d.,]+)/)),
    dineIn: n(g(/顾客到店消费\s*([\d.,]+)/)), delivery: n(g(/外卖下单\s*([\d.,]+)/)), loss: n(g(/报损金额[:：][¥￥\s]*([\d.,]+)/)),
    purchase, purchaseRatio: total && purchase !== null ? r2(purchase / total * 100) : null,
    central: n(g(/总仓订货[:：][¥￥\s]*([\d.,]+)/)), seafood: n(g(/海鲜采购[:：][¥￥\s]*([\d.,]+)/)), meat: n(g(/鲜肉采购[:：][¥￥\s]*([\d.,]+)/)), veg: n(g(/蔬菜采购[:：][¥￥\s]*([\d.,]+)/)), chicken: n(g(/鸡佬采购[:：][¥￥\s]*([\d.,]+)/)), fresh: n(g(/生鲜采购[:：][¥￥\s]*([\d.,]+)/)), misc: n(g(/其它杂项[:：][¥￥\s]*([\d.,]+)/)),
    staff, floor: staffM ? n(staffM[2]) : null, kitchen: staffM ? n(staffM[3]) : null, perCapita: total && staff ? r2(total / staff) : null, leave: n(g(/休假人数[:：]\s*(\d+)/)),
    dpScore: dp.score ?? null, dpGood: dp.good ?? null, dpBad: dp.bad ?? null, mtScore: mt.score ?? null, mtGood: mt.good ?? null, mtBad: mt.bad ?? null, dyScore: dy.score ?? null, dyGood: dy.good ?? null, dyBad: dy.bad ?? null, wmScore: wm.score ?? null, wmGood: wm.good ?? null, wmBad: wm.bad ?? null,
    checkins: n(g(/收藏打卡人数[:：]\s*(\d+)/))
  };
}
function parseDaily(text) {
  const src = String(text || '').replace(/\r/g, '').replace(/\*\*/g, '').replace(/\n\s*\n/g, '\n');
  if (!/营业日概况|当天(?:总)?营业额/.test(src)) return [];
  const parts = src.split(/(?=以下为营业日概况)/).filter(p => /当天(?:总)?营业额/.test(p));
  return (parts.length ? parts : [src]).map(parseOne).filter(Boolean);
}

// 写进多维表格的列
const COLS = [['日期', 5], ['门店', 1], ['总营业额', 2], ['午市', 2], ['晚市', 2], ['到店消费', 2], ['外卖', 2], ['报损', 2], ['采购总额', 2], ['采购占比%', 2], ['总仓订货', 2], ['海鲜采购', 2], ['鲜肉采购', 2], ['蔬菜采购', 2], ['鸡佬采购', 2], ['生鲜采购', 2], ['其它杂项', 2], ['上班人数', 2], ['楼面人数', 2], ['厨房人数', 2], ['人均产值', 2], ['休假人数', 2], ['点评评分', 2], ['点评好评', 2], ['点评差评', 2], ['美团评分', 2], ['美团好评', 2], ['美团差评', 2], ['抖音评分', 2], ['抖音好评', 2], ['抖音差评', 2], ['外卖评分', 2], ['外卖好评', 2], ['外卖差评', 2], ['收藏打卡', 2], ['来源', 1], ['录入时间', 5]];
const KEY = { 日期: 'ts', 门店: 'store', 总营业额: 'total', 午市: 'lunch', 晚市: 'dinner', 到店消费: 'dineIn', 外卖: 'delivery', 报损: 'loss', 采购总额: 'purchase', '采购占比%': 'purchaseRatio', 总仓订货: 'central', 海鲜采购: 'seafood', 鲜肉采购: 'meat', 蔬菜采购: 'veg', 鸡佬采购: 'chicken', 生鲜采购: 'fresh', 其它杂项: 'misc', 上班人数: 'staff', 楼面人数: 'floor', 厨房人数: 'kitchen', 人均产值: 'perCapita', 休假人数: 'leave', 点评评分: 'dpScore', 点评好评: 'dpGood', 点评差评: 'dpBad', 美团评分: 'mtScore', 美团好评: 'mtGood', 美团差评: 'mtBad', 抖音评分: 'dyScore', 抖音好评: 'dyGood', 抖音差评: 'dyBad', 外卖评分: 'wmScore', 外卖好评: 'wmGood', 外卖差评: 'wmBad', 收藏打卡: 'checkins' };
function toFields(r, source) { const f = { 来源: source || '群消息', 录入时间: Date.now() }; Object.entries(KEY).forEach(([c, k]) => { if (r[k] !== null && r[k] !== undefined && r[k] !== '') f[c] = r[k]; }); return f; }

module.exports = { parseDaily, COLS, toFields };
