# 餐饮矩阵助手 · 自动更新
# 每 30 分钟由 Windows 计划任务运行一次：从禧聚机器人取最新插件代码，版本变了就覆盖到本文件夹（ingest-key.js 入库口令不动）
# 第一次用：双击同文件夹里的「安装自动更新.bat」
param([switch]$Install)
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$log = Join-Path $dir 'update.log'
function Log($t) { Add-Content -Path $log -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $t) -Encoding UTF8 }

if ($Install) {
  $ps = Join-Path $dir 'update.ps1'
  $act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"{0}`"" -f $ps)
  $trg = New-ScheduledTaskTrigger -Daily -At '00:05'
  $trg.Repetition = (New-ScheduledTaskTrigger -Once -At '00:05' -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Hours 23 -Minutes 50)).Repetition
  $set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
  Register-ScheduledTask -TaskName 'XijuPluginAutoUpdate' -Action $act -Trigger $trg -Settings $set -Description '餐饮矩阵助手插件自动更新（每 30 分钟）' -Force | Out-Null
  Write-Host '已设置好：这台电脑每 30 分钟自动检查一次插件新版本。' -ForegroundColor Green
  Log '已安装自动更新'
}

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $kf = Get-Content -Path (Join-Path $dir 'ingest-key.js') -Raw -Encoding UTF8
  $key = [regex]::Match($kf, 'key\s*:\s*[''"]([^''"]+)').Groups[1].Value
  $url = [regex]::Match($kf, 'url\s*:\s*[''"]([^''"]+)').Groups[1].Value.TrimEnd('/')
  if (-not $key -or -not $url) { throw '插件文件夹里没有入库口令（ingest-key.js）' }
  $tmp = Join-Path $env:TEMP 'xiju-plugin-update'
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $zip = Join-Path $tmp 'src.zip'
  Invoke-WebRequest -UseBasicParsing -Uri ($url + '/lib/ext/zip') -Headers @{ 'x-rm-key' = $key } -OutFile $zip -TimeoutSec 180
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $src = Get-ChildItem -Path $tmp -Directory | ForEach-Object { Join-Path $_.FullName 'extension' } | Where-Object { Test-Path (Join-Path $_ 'manifest.json') } | Select-Object -First 1
  if (-not $src) { throw '下载的包里没有插件' }
  $nv = (Get-Content (Join-Path $src 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
  $ov = (Get-Content (Join-Path $dir 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
  if ($nv -ne $ov) {
    Get-ChildItem -Path $src | Where-Object { $_.Name -ne 'ingest-key.js' } | ForEach-Object { Copy-Item -Path $_.FullName -Destination $dir -Recurse -Force }
    Log ("已更新：{0} → {1}（在插件面板顶上点「重新加载」生效）" -f $ov, $nv)
    if ($Install) { Write-Host ("插件已更新到 {0}" -f $nv) -ForegroundColor Green }
  } elseif ($Install) { Write-Host ("插件已经是最新版 {0}" -f $nv) }
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
} catch {
  Log ('出错：' + $_.Exception.Message)
  if ($Install) { Write-Host ('检查更新出错：' + $_.Exception.Message) -ForegroundColor Yellow }
}
