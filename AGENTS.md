# 交接说明（给 Codex / 任何接手的 AI 或工程师）

> 这份文件每天晚上 12 点由 Claude 自动更新一次（看当天的代码改动补进来）。
> 接手的人：先从头读完这份文件，再动代码。有冲突以代码为准，并顺手改正这份文件。
> 最后更新：2026-11-10

## 0. 老板和工作方式

- 老板：林智斌（林总），禧聚餐饮。旗下两个品牌：「YES 也是大排档」「粤迹·岭南家宴」，多家门店。
- 和老板交流一律用中文，口语化，少用术语。老板喜欢纯文本的任务书。
- 能自己做的事就自己做完，不要把步骤丢回给老板。只有密码、验证码、付款、提交审核这类事要老板本人来。
- 日常分析尽量用便宜的模型（服务器上的通义千问 / DeepSeek，或老板本机的 Codex）。

## 1. 整体结构

| 部分 | 在哪 | 干什么 |
|---|---|---|
| 飞书机器人 | 本仓库 `bot/`，跑在云服务器 `/opt/xiju-bot/app` | 群消息登记、收稿派稿、经营日报、推广通、简报、各种定时任务、驾驶舱网页和接口 |
| 驾驶舱网页 | `bot/cockpit/` + `bot/lib/web.js`，网址 `https://work.yesyueji.com/cockpit/` | 老板看数据、插件和 Codex 调接口 |
| 桌面插件「餐饮矩阵助手」 | 本仓库 `extension/`，装在老板电脑 `桌面\餐饮矩阵助手`（Chrome/Edge 加载已解压扩展） | 在老板自己登录的浏览器里读小红书/抖音/视频号/推广通数据，回传服务器 |
| 共用代码 | `shared/` → `python build.py` 同步到 `extension/` 和 `web/` | |
| 大众点评采集 | `dianping-collector/` | 安卓手机 + 数据线采集评价 |
| 评价报告 | `report/` | |

### 飞书多维表格（数据都在这）
- **营销部表格**：小红书矩阵号-数据、抖音-矩阵号-数据、抖音-素人号-数据、视频号-矩阵号-数据、自家内容库、同类爆款库、AI-投放候选、投放实验记录 等。
- **私密表格**：经营日报数据、推广通数据、结算相关。营收数据**只给老板看**，不能对外、不能通过 Codex 接口读出来。
- **AI 内容工作台**：AI 写的稿件、素材图库。

### bot/lib 各文件
- `core.js` 群消息登记核心：链接拆分、查重、写表；`explicitOf/pickPerson` 识别消息里手写的「人员/账号」行（手写优先）；`mkt*` 是给 Codex 用的营销表读写。
- `douyin.js` 抖音链接识别（手机短链 + 电脑网页 `modal_id/vid`），统一成 `www.douyin.com/video/ID`。
- `postparse.js` 小红书/点评/携程/微信分享文本拆分。
- `draft.js` 收稿；`creator.js` AI 写稿；`aistudio.js` AI 工作台；`cover.js` 封面。
- `daily.js` / `dailyimport.js` 门店营业日报解析和历史导入；`store.js` 本地 SQLite（`data/xiju.db`）；`dbbackup.js` 每周备份；`dbmigrate.js` 飞书→本地库。
- `tgt.js` 推广通报表入库；`adsweekly.js` 投放周报。
- `brief.js` 每日简报；`annual.js` 经营复盘；`deep.js` 深度分析；`hits.js` 爆款公式。
- `ownlib.js` 自家内容库（插件只按链接读，**不走主页、不按标题搜**，读不了就列出来）。
- `official.js` 两个抖音蓝 V + 视频号官方数据（插件同步）。
- `campaign.js` 投放/代发链接追踪；`settle.js` 月度结算；`people.js` 人员账号对照。
- `feedback.js` 群里 @机器人 提的需求，马上私聊转给老板。
- `features.js` 功能开关（见第 4 节）。
- `movebase.js` 跨多维表格搬表（含附件，可断点续搬）。
- `web.js` 驾驶舱和全部 `/lib/*` 接口。
- `xlsx.js` / `xlsxwrite.js` 极简 xlsx 读写。

## 2. 怎么改、怎么上线

1. 改 `bot/` 里的代码，`node --check` 每个改过的文件。
2. 提交并推到 GitHub `zhibinlin209-cloud/juzhen-assistant` 的 `main`。
3. 服务器每 5 分钟跑 `bot/cloud/update.sh`：发现新版本 → 语法检查 → 备份 → 替换 → 重启 → 25 秒后检查，失败自动回滚。代码没实际变化不会重启。更新日志在服务器 `/opt/xiju-bot/data/update.log`。
4. 插件：改 `extension/`，升 `manifest.json` 版本号。老板电脑装了「XijuPluginAutoUpdate」计划任务（`extension/update.ps1`），每 30 分钟从 `/cockpit/lib/ext/zip` 拉新版覆盖（不覆盖 `ingest-key.js`），插件里会提示重新加载。
5. 上线后验证：在老板电脑浏览器打开 `https://work.yesyueji.com/cockpit/about` 能打开就说明服务在跑；功能是否生效看群里的实际回复。

## 3. 密钥和数据放在哪（**值都不写在这里，也不能写进仓库**）

- 服务器数据目录 `/opt/xiju-bot/data/`：`config.json`（飞书机器人 App ID/Secret、通义/DeepSeek key、老板 open_id、群 ID 等）、`dy-app.json`（抖音开放平台密钥）、`dy-tokens.json`、`features.json`（功能开关）、各种状态 json、`xiju.db`、`snap/`（每日数据快照）。
- 接口钥匙：请求头 `x-rm-key`。钥匙只在服务器和老板本机插件 `extension/ingest-key.js`（已在 .gitignore）。带钥匙的插件压缩包只能内部用。
- 飞书机器人 App ID/Secret 不能给任何外部供应商。
- 抖音开放平台密钥永远不要在输出、日志、聊天里打出来。
- 密码、验证码、密钥都由老板本人输入，AI 不代填。

## 4. 机器人功能清单和开关

老板在「经营日报」群发「功能开关」查看，「关闭 编号」「开启 编号/名称」切换（16 字以内的短句才认），存 `data/features.json`，即时生效。清单定义在 `bot/lib/features.js`，代码里用 `on('key')` 判断。**新增功能时要把它加进清单并加上 `on()` 判断，同时更新本节。**

群消息：1 登记小红书/点评/携程(regXhs) 2 登记抖音(regDouyin) 3 登记视频号(regSph) 4 @机器人重写(rewrite) 5 数据截图识别(screenshot) 6 收稿(draft) 7 派稿(paigao) 8 @机器人提需求(feedback) 9 经营日报入库(daily) 10 推广通报表入库(tgtFile)

定时：11 每日简报 09:00(brief) 12 推广通提醒 9/10 点 @刘泽荣(tgtRemind) 13 推广通插件自动拉取 8 点后(tgtAuto) 14 投放周报 周一(adsWeekly) 15 官方号同步 8 点后(officialAuto) 16 插件自动补账号/数据(pluginFill) 17 每日 AI 写稿 08:20(drafts) 18 周一 AI 写稿 10:40(creatorWeekly) 19 周一深度分析(deep) 20 发布进度提醒 20:00/21:30(progress) 21 月度结算草稿 1 号 10:30(settle) 22 链接追踪重读 11:00(campaign) 23 AI 工作台素材(studio) 24 每日数据快照 03:30(snapshot)

经营日报群里的指令（不受开关控制）：简报、经营复盘、深度分析、爆款分析、投放分析、投放周报、重读日报、驾驶舱、需求汇总、结算 [月份]、功能开关、抖音密钥（老板自己发）。

始终开启：老板私聊、领稿页、驾驶舱、插件入库接口、数据库备份、抖音授权回调。

## 5. 主要接口（都在 `/cockpit/lib/...`，要 `x-rm-key`）

- 给 Codex 的营销数据：`mkt/tables`、`mkt/rows?name=&days=`（行里带 `_files` 图片链接）、`mkt/file?u=`、`mkt/snap?date=`、`mkt/candidates`（写 AI-投放候选）、`mkt/write`（只能写「AI-投放候选」「投放实验记录」，不能写 决定/审批人/追加金额/人工原因 这类审批字段）、`mkt/export?name=`（导 Excel 私聊老板）。私密表、敏感字段（密码、手机、银行、身份证、营收等）被服务器拦截。
- 插件用：`tgt/need`、`tgt/ingest`、`official/need`、`official`、`dy/pending`、`dy/fill`、`xhs/noacct`、`xhs/acct`、`note`、`unreadable`、`ext/zip`。
- 其他：`feedback`、`chatmsgs`、`chats`、`rereaddaily`、`movebase`、`camp/*`、`studio/*`、`dbcheck`、`log`。
- 公开（不要钥匙）：`/about`、`/dy/callback`。
- **有副作用的接口（导出、发消息、写表）不要并发调用**，曾经一次发了 4 份 Excel。

## 6. 红线（必须遵守）

- 不替老板付款、不提交投放、不同意平台条款。投放：Codex 只推荐，**林总一人审批**（不需要洛琳）。在聚光里建计划时停在最后「提交」前，把清单和总金额给老板确认。
- 不永久删除任何飞书记录或表格；旧表由老板自己删。
- 营收数据不出私密表。
- 不用第三方平台账号去批量抓小红书/抖音；插件用个人号或小号，慢速、最好用手机热点。同一 IP 读太快会被限流（隔壁电脑就是这样被限的）。
- 不按「发送人」兜底识别人员（发送人都是机器人）。
- 同事提的需求：马上私聊转给老板，不要攒到晚上。

## 7. 投放实验（进行中）

- 标准：《投放筛选标准 V2.1》https://claude.ai/artifact/TKgHq34qMd5mHPM5co9JD1
- 方案：《投放实验方案 V1.1》https://claude.ai/artifact/MnUkApYP1xTfC9rjL43wbC （老板改过，以文档为准）
- 先投小红书（聚光）。建计划需要笔记的合作码，从「小红书矩阵号-数据」导出。
- 参考分位（180 天）：小红书 906 篇，小眼睛 p50 185 / p75 577 / p90 2181 / p95 4978，互动率 p50 2% / p75 4%；抖音矩阵 245 条，播放 p50 258 / p90 1371。
- Codex 跑候选：先打印给老板看，老板确认后才写进「AI-投放候选」。

## 8. 外部平台进度

- 抖音开放平台：应用「禧聚内容数据助手」，主体 广州粤迹引力传媒有限公司，回调 `https://work.yesyueji.com/cockpit/dy/callback`，网站 ICP 粤ICP备2026162066号-1。基础信息审核中；授权能力已提交；视频数据能力还没出现，审核过后去申请，再给两个蓝 V 生成授权码。
- 小红书聚光 Marketing API：申请 2026-11-04 提交，待审（偏销售推动）。小红书开放平台目前只有 basic_info。

## 9. 待办

- 驾驶舱加「功能开关」页面（和群指令共用 `features.json`）——方案已提，等老板说「做」。
- 老板登录聚光后：先摸清建计划页面（不提交），候选批准后建一个计划当模板。
- 老板要查薯条 / 聚光 / DOU+ 的最低预算，然后更新方案里的预算部分。
- 等 Codex 输出候选，检查是否因为数据缺口导致大量降级。
- 门店目标待老板确认；派稿原稿回填自家内容库（可选）。

## 10. 更新记录

- 2026-11-10：建立本文件；新增功能开关（features.js）。
