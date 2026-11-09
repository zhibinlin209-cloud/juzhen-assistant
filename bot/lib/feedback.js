/* 群里 @机器人 提的需求 / 问题 / 疑问：记下来，马上私聊转给老板
 * 用通义（chat）分类和整理，不花 Claude 的 token
 */
'use strict';
const fs = require('fs'), path = require('path');

const HELP = `机器人现在会做的事：
- 发布群/回收群：发小红书、抖音（手机短链和电脑网页链接都认）、视频号、大众点评链接 → 自动登记到飞书多维表格（小红书矩阵号-数据、抖音-矩阵号-数据、抖音-素人号-数据、视频号-矩阵号-数据），回复里会写登记到哪张表；账号、发布人员、地点、点赞评论由插件随后补上
- 抖音链接和视频号链接一起发（或回复抖音那条只发视频号链接）→ 两个链接写进同一行，并同步到视频号表
- 回复某条链接消息 @机器人 说「重写」→ 覆盖表里那一行，不判重复
- 稿件存放群：发「编号+标题+正文」再发图片/视频/Live 图 → 收稿；在发布群发「派稿」→ 派当天的稿；「进度」→ 看发布进度
- 经营日报群：门店营业日报自动入库；投放数据群：推广通报表自动入库，每天 9/10 点提醒`;

function createFeedback({ dataDir, chat, log, notify }) {
  const F = path.join(dataDir, 'feedback.json');
  let st = { items: [], sumAt: 0 }; try { st = Object.assign(st, JSON.parse(fs.readFileSync(F, 'utf8'))); } catch (e) { }
  const save = () => { try { fs.writeFileSync(F, JSON.stringify(st)); } catch (e) { } };
  const json = s => { const m = String(s || '').match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch (e) { return null; } };

  // 记一条，返回给群里的回复
  async function add({ text, who, group, parent }) {
    const it = { t: Date.now(), who: who || '', group: group || '', text: String(text).slice(0, 800), parent: parent ? String(parent).slice(0, 400) : '', type: '需求', summary: '' };
    let answer = '';
    try {
      const out = await chat(`你是餐饮公司飞书群里的登记机器人。同事 @ 了你，说了一句话，请判断类型并输出 JSON（只输出 JSON）：
{"type":"需求|问题|疑问|闲聊","summary":"用一句话概括他想要什么或遇到什么问题（20 字内）","answer":"只有 type 是疑问、并且下面的说明里能找到确定答案时，用 1-2 句回答；否则留空"}
- 需求：想让机器人新增或改变某个功能
- 问题：机器人做错了、没反应、登记错了
- 疑问：问怎么用、登记到哪了
- 闲聊：打招呼、谢谢之类

${HELP}

${it.parent ? '他回复的那条消息：' + it.parent + '\n' : ''}他说：${it.text}`, 300);
      const j = json(out) || {};
      if (/需求|问题|疑问|闲聊/.test(j.type || '')) it.type = j.type.match(/需求|问题|疑问|闲聊/)[0];
      it.summary = String(j.summary || '').slice(0, 60); answer = String(j.answer || '').slice(0, 200);
    } catch (e) { log('[需求] 分类出错：' + e.message); }
    if (it.type === '闲聊') return '👋 在的。有需求或问题直接 @我 说，我会记下来汇总给管理员。';
    st.items.push(it); if (st.items.length > 500) st.items = st.items.slice(-500); save();
    log(`[需求] ${it.group} ${it.who}（${it.type}）：${it.text.slice(0, 80)}`);
    const tag = { 需求: '需求', 问题: '问题', 疑问: '疑问' }[it.type] || '需求';
    let sent = false;
    if (notify) { try { await notify(`📮 群里有新${tag}\n群：${it.group}\n谁：${it.who || '未知'}\n原话：${it.text}` + (it.parent ? `\n回复的是：${it.parent.slice(0, 200)}` : '') + (answer ? `\n机器人已先回答：${answer}` : '') + `\n\n要改的话直接告诉 Claude。`); sent = true; } catch (e) { log('[需求] 私聊老板出错：' + e.message); } }
    return (answer ? `💡 ${answer}\n` : '') + `📝 已记下这条${tag}${it.summary ? '：「' + it.summary + '」' : ''}，${sent ? '已转给管理员' : '会转给管理员'}处理。`;
  }

  const pending = () => st.items.filter(x => x.t > (st.sumAt || 0));
  const fmt = t => new Date(t + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ');

  // 整理成给老板看的汇总；mark=true 时标记为已汇总
  async function summary({ all, days, mark } = {}) {
    const list = all ? st.items.filter(x => x.t > Date.now() - (days || 7) * 864e5) : pending();
    if (!list.length) return '';
    const raw = list.map((x, i) => `${i + 1}. [${fmt(x.t)}][${x.group}][${x.who}][${x.type}] ${x.text}${x.parent ? '（回复的是：' + x.parent.slice(0, 120) + '）' : ''}`).join('\n');
    let body = '';
    try {
      body = await chat(`下面是同事们在飞书群里 @ 登记机器人提的需求和问题。请整理成给老板看的汇总，中文，纯文本（不要 Markdown 符号如 # 和 **）：
1. 分三组：「要改的问题」「新需求」「使用疑问」，没有的组不写
2. 意思相同的合并成一条，写明谁提的、哪个群、提了几次
3. 每条一行：先说是什么，再用一句话给出建议怎么改或怎么回复他们
4. 只根据原话整理，不要编造

${raw}`, 1500);
    } catch (e) { log('[需求] 汇总出错：' + e.message); }
    if (!body) body = list.map(x => `· [${x.type}] ${x.group} ${x.who}：${x.text.slice(0, 100)}`).join('\n');
    if (mark) { st.sumAt = Date.now(); save(); }
    return `📮 群里的需求汇总（${list.length} 条）\n\n${body.trim()}\n\n要改哪条，直接告诉 Claude 就行。`;
  }

  return { add, summary, pending, list: () => st.items.slice(-100) };
}
module.exports = { createFeedback };
