/* 创作 Agent：照「爆款公式」给自家门店写小红书图文稿 → 进「派稿记录」，状态「AI待审」，PR 审改后再派发
 * 写稿用 DeepSeek（走阿里云百炼，同一个 key），不可用时退回通义；程序再做一遍广告法极限词/重复标题检查
 */
'use strict';
const DAY = 864e5;
const val = v => Array.isArray(v) ? v.map(x => (x && typeof x === 'object') ? (x.text || x.name || '') : String(x)).join('') : (v && typeof v === 'object') ? (v.text || v.name || '') : (v ?? '');
// 门店：营业名 / 品牌 / 城市区域 / 点评定位 / 可写的卖点（只写确定的，不编价格和地址）
const STORES = [
  { s: '惠州水东街店', b: 'YES也是大排档', city: '惠州', area: '惠州市惠城区', dp: '也是大排档（水东街店）', key: '水东街' },
  { s: '深圳华强北燕南店', b: 'YES也是大排档', city: '深圳', area: '深圳市福田区', dp: '也是大排档（华强北店）', key: '华强北' },
  { s: '深圳白石洲店', b: 'YES也是大排档', city: '深圳', area: '深圳市南山区', dp: '也是大排档（白石洲店）', key: '白石洲' },
  { s: '深圳前海HOP店', b: 'YES也是大排档', city: '深圳', area: '深圳市宝安区', dp: '也是大排档（前海店）', key: '前海' },
  { s: '广州江南西店', b: 'YES也是大排档', city: '广州', area: '广州市海珠区', dp: '也是大排档（江南西店）', key: '江南西' },
  { s: '珠海玖洲道店', b: 'YES也是大排档', city: '珠海', area: '珠海市香洲区', dp: '也是大排档（玖洲道店）', key: '玖洲道' },
  { s: '佛山保利西街店', b: 'YES也是大排档', city: '佛山', area: '佛山市南海区', dp: '也是大排档（千灯湖店）', key: '千灯湖' },
  { s: '佛山创意产业园店', b: 'YES也是大排档', city: '佛山', area: '佛山市禅城区', dp: '也是大排档（创意产业园店）', key: '创意产业园' },
  { s: '东莞东城33小镇店', b: 'YES也是大排档', city: '东莞', area: '东莞市东城区', dp: '也是大排档（33小镇店）', key: '33小镇' },
  { s: '粤迹·岭南家宴', b: '粤迹·岭南家宴', city: '深圳', area: '深圳市南山区', dp: '粤迹·岭南家宴', key: '花园城' }
];
const BRAND = {
  'YES也是大排档': '海鲜大排档 + 锅气小炒；烟火气、夜宵、明火现炒、热闹；招牌：爆膏奶油虾、海鲜粥、锅气小炒、啫啫煲；营业到凌晨，适合朋友聚餐、宵夜',
  '粤迹·岭南家宴': '家常粤菜、家庭聚餐、明炉现做、岭南味道；招牌方向：窑鸡、白切鸡、叉烧；适合一家人吃饭'
};
// 广告法极限词（违禁 / 易被限流）
const BANNED = /最好吃|最便宜|第一名|全网第一|史上最|顶级|极品|国家级|绝对|100%|百分百|唯一|首选|王牌|销量第一|无敌/g;

function createCreator({ cfg, api, core, deep, brief, log }) {
  async function llm(prompt) {
    const models = cfg.writerModels || ['deepseek-v4-pro', 'deepseek-v3.2', 'deepseek-v3', 'qwen-max'];
    let last = '';
    for (const model of models) {
      try {
        const r = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.qwenKey }, signal: AbortSignal.timeout(180000),
          body: JSON.stringify({ model, temperature: 0.8, max_tokens: 6000, messages: [{ role: 'user', content: prompt }] }) });
        const j = await r.json().catch(() => ({})); if (r.ok) { const t = (((j.choices || [])[0] || {}).message || {}).content || ''; return { text: t, model }; }
        last = (j.error && j.error.message) || ('HTTP ' + r.status); log(`[创作] 模型 ${model} 不可用：${last}`);
      } catch (e) { last = e.message; log(`[创作] 模型 ${model} 出错：${last}`); }
    }
    throw new Error('写稿模型都不可用：' + last);
  }
  async function tableRows(app, name) { const t = ((await api.call('GET', `/bitable/v1/apps/${app}/tables`, null, { page_size: 100 })).items || []).find(x => x.name === name); if (!t) return { t: null, rows: [] }; const out = []; let pt = ''; do { const d = await api.call('POST', `/bitable/v1/apps/${app}/tables/${t.table_id}/records/search`, {}, Object.assign({ page_size: 500 }, pt ? { page_token: pt } : {})); out.push(...(d.items || [])); pt = d.has_more ? d.page_token : ''; } while (pt); return { t, rows: out }; }

  // 选店：近 14 天稿件/发布少的、经营下滑的优先
  function pickStores(n, only, recent, weak) {
    let list = STORES.filter(x => !only || x.s.includes(only) || x.key.includes(only) || x.b.includes(only));
    if (!list.length) list = STORES;
    const score = x => (recent[x.s] || 0) - (weak.includes(x.s) ? 3 : 0);
    const sorted = list.slice().sort((a, b) => score(a) - score(b)); const out = [];
    for (let i = 0; out.length < n; i++) out.push(sorted[i % sorted.length]);
    return out;
  }

  async function run(opt) {
    opt = opt || {}; const n = Math.max(1, Math.min(+opt.n || 6, 12));
    const app = await core.appToken();
    const PG = await tableRows(app, '派稿记录'); if (!PG.t) throw new Error('没找到「派稿记录」表');
    const XHS = await tableRows(app, '小红书矩阵号-数据');
    const since = Date.now() - 60 * DAY;
    const titles = PG.rows.map(r => val(r.fields['标题'])).concat(XHS.rows.filter(r => (r.fields['发布日期'] || 0) > since).map(r => val(r.fields['标题(供AI读取)'] || r.fields['标题']).split('\n')[0])).filter(Boolean).slice(-150);
    const recent = {}; PG.rows.concat(XHS.rows).filter(r => ((r.fields['派稿日期'] || r.fields['发布日期'] || 0) > Date.now() - 14 * DAY)).forEach(r => { const s = val(r.fields['门店'] || r.fields['笔记门店']); STORES.forEach(x => { if (s.includes(x.key) || s === x.s) recent[x.s] = (recent[x.s] || 0) + 1; }); });
    const weak = ['东莞东城33小镇店', '佛山创意产业园店', '广州江南西店', '珠海玖洲道店']; // 经营复盘：到店客流同比下滑
    const stores = pickStores(n, opt.store, recent, weak);
    let F = null; try { F = await deep().xhs(); } catch (e) { }
    const formula = await brief().latestKind('内容分析').catch(() => null);
    const facts = F && F.样本 ? { 爆款判定: F.判定, 内容类型: F.内容类型, 封面形式: F.封面形式, 图片张数: F.图片张数, 正文字数: F.正文字数, 话题数: F.话题数, 标题特征: F.标题特征, 评论区问题: F.评论区问题, 爆款样本: (F.爆款样本 || []).slice(0, 10) } : null;
    const prompt = `你是禧聚餐饮（YES也是大排档 / 粤迹·岭南家宴）的小红书内容编辑，给我们的素人矩阵号写图文笔记稿。写完会交给 PR 审核、配真实照片后发布。
【品牌】${JSON.stringify(BRAND)}
【爆款公式（程序统计，列为 [分组, 条数, 爆款率%, 中位小眼睛, 同账号倍数, 收藏率%]，同账号倍数越高越好）】${facts ? JSON.stringify(facts) : '暂无'}
${formula ? '【上周 AI 内容分析结论】' + formula.text.slice(0, 2500) : ''}
【最近已经写过/发过的标题（不要重复或只改几个字）】${titles.slice(-80).join(' | ')}
【本次要写的门店，按顺序一店一篇，共 ${stores.length} 篇】${JSON.stringify(stores.map(x => ({ 门店: x.s, 品牌: x.b, 城市: x.city, 商圈关键词: x.key })))}
写作要求：
1. 素人口吻，像本地人/攻略党写的真实分享，不要像广告；我们的店要自然放进去（攻略清单里写 1 家我们的店 + 周边 3–8 家不同品类的街坊小店/小吃/糖水，其他店写泛称或你确定存在的老字号，不确定就写品类不写店名）。
2. 标题 ≤20 字，带城市或商圈地名，可用「本地人」「避雷」「J人整理」「X家」这类在公式里倍数高的说法；不要用极限词（最/第一/顶级/绝对/100%/唯一 等）。
3. 正文 250–450 字，用 emoji 开头的分条清单；每家店一两句具体吃什么；写到我们的店时只用品牌里给的招牌菜和卖点，不许编价格、地址、营业时间、优惠。
4. 话题 8–10 个，含城市/商圈/美食/攻略类。
5. 给出封面方案（形式：拼图/攻略长图/大字报，封面大字原文 ≤14 字）和图片清单（第 1–9 张各拍什么，必须是能实拍的：菜品、门头、环境、街景、地图手绘）。
6. 每篇写一句「依据」：用了公式里的哪几条。
只输出 JSON 数组，不要别的文字：[{"门店":"","标题":"","正文":"","话题":["#…"],"封面形式":"","封面大字":"","图片清单":["第1张：…"],"依据":""}]`;
    const { text, model } = await llm(prompt);
    const m = text.match(/\[[\s\S]*\]/); if (!m) throw new Error('写稿模型没按格式输出');
    let drafts; try { drafts = JSON.parse(m[0]); } catch (e) { throw new Error('写稿结果解析失败'); }
    const norm = s => String(s || '').replace(/[\s\p{P}\p{S}]/gu, '');
    const seen = new Set(titles.map(norm)); const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(2, 10).replace(/-/g, '');
    const recs = []; const out = [];
    drafts.slice(0, n).forEach((d, i) => {
      const st = STORES.find(x => x.s === d.门店) || stores[i] || stores[0];
      let title = String(d.标题 || '').replace(BANNED, '').slice(0, 24); let body = String(d.正文 || '').replace(BANNED, ''); const tags = (Array.isArray(d.话题) ? d.话题 : String(d.话题 || '').split(/\s+/)).map(t => '#' + String(t).replace(/^#/, '')).filter(t => t.length > 1).slice(0, 10).join(' ');
      if (!title || seen.has(norm(title))) return; seen.add(norm(title));
      const code = `AI-${day}-${String(i + 1).padStart(2, '0')}`;
      const plan = `【AI稿 · ${model}】封面：${d.封面形式 || ''}「${d.封面大字 || ''}」\n图片清单：\n${(d.图片清单 || []).join('\n')}\n依据：${d.依据 || ''}\n⚠️ 发布前请 PR 核对店名、菜名，配真实照片；AI 辅助创作内容按平台要求标注。`;
      recs.push({ fields: { 文本: code, 标题: title, 稿件编号: code, 写手: 'AI·' + model, 分发类别: '小红书矩阵号', 内容类型: '图文', 发布平台: ['小红书', '大众点评', '携程', '微信贴图'], 门店: st.s, 文案正文: body, 话题标签: tags, 定位: st.area, 点评定位: st.dp, 状态: 'AI待审', 备注: plan, 派稿人: 'AI创作' } });
      out.push({ code, store: st.s, title, body, tags, plan });
    });
    const A = app; for (let i = 0; i < recs.length; i += 100) await api.call('POST', `/bitable/v1/apps/${A}/tables/${PG.t.table_id}/records/batch_create`, { records: recs.slice(i, i + 100) });
    log(`[创作] ${model} 写了 ${out.length} 篇进派稿记录（AI待审）：${out.map(x => x.title).join('｜')}`);
    return { model, list: out };
  }
  return { run, STORES };
}
module.exports = { createCreator };
