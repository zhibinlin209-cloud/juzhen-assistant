/* 经营复盘（全年 / 同比）：程序从私密表「经营日报数据」算数字，通义千问写解读
 * 口径：只用有营业额的天；同比按同月份、同店、两年都有数据的天对比日均；装修/录错缺的天不算
 */
'use strict';
const DAY = 864e5, TZ = 8 * 3600e3;
const v = x => Array.isArray(x) ? x.map(y => (y && y.text) || y).join('') : (x ?? '');
const n = x => { const k = typeof x === 'number' ? x : parseFloat(String(v(x)).replace(/[,¥￥%]/g, '')); return isFinite(k) ? k : null; };
const r0 = x => x == null ? null : Math.round(x), r1 = x => x == null ? null : Math.round(x * 10) / 10;
const pct = (a, b) => (a != null && b) ? r1((a - b) / b * 100) : null;
const avg = a => { const k = a.filter(x => x != null); return k.length ? k.reduce((s, x) => s + x, 0) / k.length : null; };

function createAnnual({ cfg, api, core, llm, log }) {
  async function rows() {
    const app = await core.dailyAppToken(); const name = cfg.dailyTable || '门店营业日报';
    const t = ((await api.call('GET', `/bitable/v1/apps/${app}/tables`, null, { page_size: 100 })).items || []).find(x => x.name === name);
    const out = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); out.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt);
    const seen = new Map();
    out.forEach(r => { const f = r.fields || {}; const s = String(v(f['门店']) || '').trim(); const ts = f['日期']; const tot = n(f['总营业额']); if (!s || typeof ts !== 'number' || !tot || tot < 500) return; const d = new Date(ts + TZ); if (d.getUTCFullYear() < 2025) return;
      seen.set(s + '|' + Math.floor((ts + TZ) / DAY), { s, ts, y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, wd: d.getUTCDay(), tot, din: n(f['到店消费']), del: n(f['外卖']), lunch: n(f['午市']), dinner: n(f['晚市']), pur: n(f['采购总额']), staff: n(f['上班人数']), per: n(f['人均产值']), loss: n(f['报损']), dp: n(f['点评评分']), mt: n(f['美团评分']), dpBad: n(f['点评差评']) || 0, mtBad: n(f['美团差评']) || 0, chk: n(f['收藏打卡']) }); });
    return [...seen.values()];
  }

  async function facts() {
    const R = await rows(); if (!R.length) throw new Error('经营日报数据是空的');
    const stores = [...new Set(R.map(x => x.s))]; const maxTs = Math.max(...R.map(x => x.ts)); const last = new Date(maxTs + TZ);
    const curY = last.getUTCFullYear(), curM = last.getUTCMonth() + 1;
    const ym = x => `${x.y}-${String(x.m).padStart(2, '0')}`;
    // 每店每月：天数、合计、日均
    const M = {}; R.forEach(x => { const k = x.s + '|' + ym(x); const o = M[k] = M[k] || { days: 0, sum: 0 }; o.days++; o.sum += x.tot; });
    const per = {};
    for (const s of stores) {
      const mine = R.filter(x => x.s === s); const months = [...new Set(mine.map(ym))].sort();
      const monthly = months.map(k => { const o = M[s + '|' + k]; return [k, o.days, r0(o.sum), r0(o.sum / o.days)]; });
      // 同比：同月两年都有，比日均
      const yoy = months.filter(k => k.startsWith(String(curY))).map(k => { const lk = (curY - 1) + k.slice(4); const a = M[s + '|' + k], b = M[s + '|' + lk]; return (b && a.days >= 10 && b.days >= 10) ? [k, r0(a.sum / a.days), r0(b.sum / b.days), pct(a.sum / a.days, b.sum / b.days)] : null; }).filter(Boolean); // 当月不足 10 天（月初、装修、开业）不比
      // 今年至今 vs 去年同期（同月份范围、两年都有的月份）
      const ytdMonths = yoy.map(x => x[0].slice(5)); const ytdA = mine.filter(x => x.y === curY && ytdMonths.includes(String(x.m).padStart(2, '0'))), ytdB = mine.filter(x => x.y === curY - 1 && ytdMonths.includes(String(x.m).padStart(2, '0')));
      // 近 90 天 vs 去年同期 90 天（往前 364 天）
      const r90 = mine.filter(x => x.ts > maxTs - 90 * DAY), l90 = mine.filter(x => x.ts > maxTs - 364 * DAY - 90 * DAY && x.ts <= maxTs - 364 * DAY);
      const wd = [0, 1, 2, 3, 4, 5, 6].map(w => r0(avg(mine.filter(x => x.wd === w && x.ts > maxTs - 180 * DAY).map(x => x.tot))));
      const lastMonths = mine.filter(x => x.ts > maxTs - 90 * DAY);
      per[s] = {
        数据范围: `${new Date(Math.min(...mine.map(x => x.ts)) + TZ).toISOString().slice(0, 10)} ~ ${new Date(Math.max(...mine.map(x => x.ts)) + TZ).toISOString().slice(0, 10)}，有效 ${mine.length} 天`,
        月度: monthly, 同月同比日均: yoy,
        今年至今日均: r0(avg(ytdA.map(x => x.tot))), 去年同期日均: r0(avg(ytdB.map(x => x.tot))), 今年至今同比: pct(avg(ytdA.map(x => x.tot)), avg(ytdB.map(x => x.tot))),
        近90天日均: r0(avg(r90.map(x => x.tot))), 去年同期90天日均: l90.length >= 30 ? r0(avg(l90.map(x => x.tot))) : null, 近90天同比: l90.length >= 30 ? pct(avg(r90.map(x => x.tot)), avg(l90.map(x => x.tot))) : null,
        近半年星期日均: { 周日: wd[0], 周一: wd[1], 周二: wd[2], 周三: wd[3], 周四: wd[4], 周五: wd[5], 周六: wd[6] },
        近90天外卖占比: r1(avg(lastMonths.filter(x => x.del != null).map(x => x.del / x.tot * 100))), 近90天午市占比: lastMonths.some(x => x.lunch) ? r1(avg(lastMonths.filter(x => x.lunch != null && x.dinner != null && (x.lunch + x.dinner) > 0).map(x => x.lunch / (x.lunch + x.dinner) * 100))) : null,
        近90天采购占营业额: r1(lastMonths.reduce((a, x) => a + (x.pur || 0), 0) / lastMonths.reduce((a, x) => a + x.tot, 0) * 100), 近90天人均产值: r0(avg(lastMonths.map(x => x.per))), 近90天日均上班人数: r1(avg(lastMonths.map(x => x.staff))),
        点评评分最新: lastMonths.length ? lastMonths.sort((a, b) => b.ts - a.ts)[0].dp : null, 美团评分最新: lastMonths.length ? lastMonths[0].mt : null, 近90天差评: lastMonths.reduce((a, x) => a + x.dpBad + x.mtBad, 0)
      };
    }
    // 全集团月度（同店口径：两年同月都有数据的店）
    const months = [...new Set(R.map(ym))].sort();
    const group = months.map(k => { const xs = R.filter(x => ym(x) === k); return [k, new Set(xs.map(x => x.s)).size, r0(xs.reduce((a, x) => a + x.tot, 0)), new Set(xs.map(x => x.ts)).size]; });
    const rank = stores.map(s => [s, per[s].近90天日均, per[s].近90天同比, per[s].今年至今同比]).sort((a, b) => (b[1] || 0) - (a[1] || 0));
    return { 截至: last.toISOString().slice(0, 10), 口径: '营业额=总营业额；只算有数据的天（春节闭店、水东街装修、录错剔除的天不算）；同比按同月日均、或近 90 天 vs 往前 364 天的同期 90 天', 全集团月度: { 列: '[月份, 有数据的店数, 营业额合计, 有数据的天数]（最后一个月可能只有几天，不能和整月比）', 数据: group }, 门店排行_近90天: { 列: '[门店, 近90天日均, 近90天同比%, 今年至今同比%]', 数据: rank }, 门店: per,
      备注: ['佛山保利西街店 = 千灯湖/灯湖西街', '惠州水东街 2026 年初有一段停业装修', '深圳白石洲 2026-03-05 开业、粤迹花园城数据从 2025-11-25 开始，没有去年同期', '陈家祠已闭店，不在数据里'] };
  }

  function plain(F) {
    return `📊 经营复盘（数据截至 ${F.截至}）\n` + F.门店排行_近90天.数据.map(([s, a, y, ytd]) => `· ${s}：近 90 天日均 ${a?.toLocaleString('en-US') ?? '—'}，同比 ${y == null ? '—' : (y > 0 ? '+' : '') + y + '%'}，今年至今同比 ${ytd == null ? '—' : (ytd > 0 ? '+' : '') + ytd + '%'}`).join('\n');
  }
  async function report() {
    const F = await facts(); if (!llm) return { text: plain(F), F, by: '纯数字' };
    const prompt = `你是禧聚餐饮（YES也是大排档 + 粤迹岭南家宴）的经营分析师。下面是程序从门店营业日报（2025-01 起）算好的数据：每家店每月营业天数/合计/日均、同月同比、今年至今同比、近 90 天同比、近半年星期规律、外卖占比、午市占比、采购占营业额、人均产值、评分和差评，以及集团月度合计和门店排行。
请写一份「经营复盘」给老板林智斌。要求：
1. 数字只能用数据里出现的，不许自己算新数字；样本少或没有去年同期的店要说明。
2. 结构：① 一句话总判断（集团整体是涨是跌、主要靠谁拖累谁）② 门店分三档（增长/持平/下滑），每家一两句：同比多少、哪几个月掉得最多、可能原因方向（只说数据能支持的，比如工作日弱、外卖占比变化、评分下降）③ 季节和星期规律（哪几个月旺/淡，周几最强最弱，对排班和投放的含义）④ 成本效率（采购占比、人均产值哪家异常）⑤ 接下来 30 天最该做的 3–5 件事（落到门店和负责人方向）。
3. 不要编造原因，用「可能」「需要核实」；不要建议降价打折。
4. 飞书纯文本，不要 # 和 **，不要表格，用 emoji 小标题，1500 字以内。
【数据】
${JSON.stringify(F)}`;
    try {
      const text = (await llm(prompt)).trim();
      const ok = new Set(); const walk = o => { if (o == null) return; if (typeof o === 'number') { [o, Math.round(o), r1(o), Math.round(o / 1000), Math.round(o / 10000), r1(o / 10000), Math.round(o / 100) / 100 / 100].forEach(x => ok.add(x)); } else if (typeof o === 'string') (o.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []).forEach(k => ok.add(+k)); else if (Array.isArray(o)) o.forEach(walk); else Object.values(o).forEach(walk); };
      walk(F); for (let i = 0; i <= 31; i++) ok.add(i); [30, 60, 90, 100, 180, 364, 2025, 2026, 2027].forEach(x => ok.add(x));
      const bad = (text.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []).map(Number).filter(k => !ok.has(k));
      if (bad.length > 5) { log('[经营复盘] AI 数字对不上：' + bad.slice(0, 10).join(',')); return { text: plain(F) + '\n\n（AI 解读里有数字对不上，这次先给纯数字版）', F, by: '纯数字（AI 核对没过）' }; }
      return { text, F, by: 'AI' };
    } catch (e) { log('[经营复盘] AI 出错：' + e.message); return { text: plain(F), F, by: '纯数字（AI 出错）' }; }
  }
  return { facts, report, plain };
}
module.exports = { createAnnual };
