@echo off
chcp 65001 >nul
cd /d %~dp0
title 禧聚 AI 助手 - 飞书群机器人
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo 这台电脑还没装 Node.js。正在打开下载页，装「LTS 长期支持版」，装完重新双击本文件。
  start https://nodejs.org/zh-cn/download
  pause
  exit /b
)
if not exist node_modules\@larksuiteoapi (
  echo 第一次运行：正在安装飞书 SDK（约 1 分钟）...
  call npm install --no-audit --no-fund --registry=https://registry.npmmirror.com
)
node index.js
echo.
echo 机器人已停止。要重新启动，再双击本文件。
pause
