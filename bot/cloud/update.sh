#!/bin/bash
# 机器人自动更新：每 5 分钟看一次 GitHub 上的 bot/ 有没有新版本
# 有就：语法检查 → 备份 → 替换 → 重启 → 25 秒后检查，失败自动回滚
# 只动 /opt/xiju-bot/app，不碰工作台
set -uo pipefail
R=zhibinlin209-cloud/juzhen-assistant
B=/opt/xiju-bot; A=$B/app; L=$B/data/update.log; S0=$B/data/.deployed-sha
T=$(mktemp -d); trap 'rm -rf $T' EXIT
log() { echo "$(date '+%F %T') $*" >> $L; }
SHA=$(curl -fsS --max-time 15 -H 'Accept: application/vnd.github.sha' https://api.github.com/repos/$R/commits/main 2>/dev/null || true)
if [ -n "$SHA" ] && [ "$SHA" = "$(cat $S0 2>/dev/null)" ]; then exit 0; fi
REF=${SHA:-refs/heads/main}
curl -fsSL --max-time 90 https://codeload.github.com/$R/tar.gz/$REF -o $T/s.tgz || { log "下载失败（$REF），下次再试"; exit 0; }
tar -xzf $T/s.tgz -C $T || exit 0
S=$(ls -d $T/*/bot 2>/dev/null | head -1); [ -n "$S" ] || exit 0
h() { (cd $1 && cat index.js package.json lib/*.js 2>/dev/null | sha256sum | cut -c1-16); }
NEW=$(h $S); OLD=$(h $A)
[ -n "$SHA" ] && echo "$SHA" > $S0
[ "$NEW" = "$OLD" ] && exit 0
for f in $S/index.js $S/lib/*.js; do $B/node/bin/node --check "$f" 2>>$L || { log "新版本 $NEW 语法检查没过，不更新"; exit 0; }; done
rm -rf $B/app.prev && cp -a $A $B/app.prev
cp $S/index.js $S/package.json $A/ && cp $S/lib/*.js $A/lib/
if ! cmp -s $S/package.json $B/app.prev/package.json; then (cd $A && PATH=$B/node/bin:$PATH npm install --omit=dev --no-audit --no-fund --registry=https://registry.npmmirror.com >/dev/null 2>&1) || log "依赖安装出错"; fi
[ -f $S/cloud/update.sh ] && ! cmp -s $S/cloud/update.sh $B/update.sh && install -m 755 $S/cloud/update.sh $B/update.sh
systemctl restart xiju-bot; sleep 25
if systemctl is-active -q xiju-bot && ! tail -5 $B/data/bot.log | grep -q '启动失败'; then log "已更新到 $NEW（${SHA:0:7}）"
else rm -rf $A && mv $B/app.prev $A && systemctl restart xiju-bot; log "更新到 $NEW 启动失败，已回滚到上一版"; fi
