/* 功能开关：老板在「经营日报」群发「功能开关」查看，发「关闭 7」「开启 简报」切换；存在 data/features.json，即时生效 */
'use strict';
const fs = require('fs'), path = require('path');
const LIST = [
  // 群里收消息
  ['regXhs', '登记·小红书/点评/携程链接', '发布群贴链接 → 登记到「小红书矩阵号-数据」', '群消息'],
  ['regDouyin', '登记·抖音链接', '抖音链接（含电脑端链接）→ 抖音矩阵号/素人号表；带视频号链接同步视频号表', '群消息'],
  ['regSph', '登记·视频号链接', '视频号链接 → 视频号表；回复抖音消息补视频号链接', '群消息'],
  ['rewrite', '@机器人 重写', '回复链接消息 @机器人 说「重写」覆盖原行', '群消息'],
  ['screenshot', '数据中心截图识别', '发小红书/抖音/视频号数据截图 → 通义识别后更新数据', '群消息'],
  ['draft', '收稿', '稿件存放群：编号+标题+正文，之后的图片/视频/Live 图归到这篇', '群消息'],
  ['paigao', '派稿指令', '发布群发「派稿」→ 派当天的稿', '群消息'],
  ['feedback', '@机器人 提需求', '@机器人 说需求/问题 → 记下并私聊转给老板', '群消息'],
  ['daily', '经营日报入库', '经营日报群的门店营业日报 → 私密表格 + 数据库', '群消息'],
  ['tgtFile', '推广通报表入库', '投放数据群发推广通 xlsx → 入库 + 投放分析', '群消息'],
  // 定时任务
  ['brief', '每日简报', '每天 09:00 私聊老板经营简报', '定时'],
  ['tgtRemind', '推广通提醒', '每天 9:00/10:00 @刘泽荣 发推广通报表；周一提醒导 30 天', '定时'],
  ['tgtAuto', '推广通自动拉取', '插件每天 8:00 后自动从推广通后台拉近 30 天报表入库', '定时'],
  ['adsWeekly', '投放周报', '周一收到 30 天报表或 14:00 出投放周报（DeepSeek）私聊老板', '定时'],
  ['officialAuto', '官方号自动同步', '插件每天 8:00 后同步抖音蓝 V、视频号作品数据', '定时'],
  ['pluginFill', '插件自动补账号/数据', '群里登记的链接，插件自动补账号、发布人员、地点、赞评转', '定时'],
  ['drafts', '每日 AI 写稿', '每天 08:20 AI 写一批稿件进 AI 工作台', '定时'],
  ['creatorWeekly', '周一 AI 写稿', '每周一 10:40 再写一批', '定时'],
  ['deep', '周一深度分析', '每周一 10:00 后出内容深度分析报告', '定时'],
  ['progress', '发布进度提醒', '每天 20:00 群里 @ 还没发的人；21:30 发当天进度', '定时'],
  ['settle', '月度结算草稿', '每月 1 号 10:30 算上月结算草稿私聊老板', '定时'],
  ['campaign', '链接追踪重读', '每天 11:00 重读链接追踪表，更新赞藏评', '定时'],
  ['studio', 'AI 工作台素材', '素材图库导入、打标签、推送审核通过的稿件', '定时'],
  ['snapshot', '每日数据快照', '每天 03:30 存一份笔记数据快照（投放实验用）', '定时'],
];
function createFeatures({ dataDir, log }) {
  const F = path.join(dataDir, 'features.json'); let off = {}; try { off = JSON.parse(fs.readFileSync(F, 'utf8')); } catch (e) { }
  const on = k => !off[k];
  const find = q => { q = String(q || '').trim(); if (/^\d+$/.test(q)) return LIST[+q - 1]; return LIST.find(x => x[0] === q) || LIST.find(x => x[1] === q) || LIST.find(x => x[1].includes(q)); };
  function set(q, val) { const it = find(q); if (!it) return null; if (val) delete off[it[0]]; else off[it[0]] = Date.now(); try { fs.writeFileSync(F, JSON.stringify(off)); } catch (e) { } log(`[功能开关] ${it[1]} → ${val ? '开' : '关'}`); return it; }
  function text() {
    const L = ['⚙️ 机器人功能开关（发「关闭 编号」或「开启 编号」，也可以写名称，比如「关闭 简报」）'];
    let cat = ''; LIST.forEach((x, i) => { if (x[3] !== cat) { cat = x[3]; L.push('', cat === '群消息' ? '【群里收到消息时】' : '【定时自动】'); } L.push(`${i + 1}. ${on(x[0]) ? '🟢' : '⚪️'} ${x[1]} —— ${x[2]}`); });
    L.push('', '始终开启、不能关的：老板私聊、领稿页、驾驶舱、插件入库接口、数据库备份。'); return L.join('\n');
  }
  return { on, set, text, list: () => LIST.map(x => ({ key: x[0], name: x[1], desc: x[2], cat: x[3], on: on(x[0]) })) };
}
module.exports = { createFeatures };
