# 大众点评 App 评价采集（数据线连接的安卓手机）
# 做的事：像人一样在评价列表里往下滑，遇到"全文"点开，读取 日期/星级/标签/人均/正文/推荐菜，存成表格。
# 不登录、不改手机设置；遇到验证会停下来等你手动处理。
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$tmp = Join-Path $env:TEMP 'rmcollect'; New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$resDir = Join-Path $here '采集结果'; New-Item -ItemType Directory -Force -Path $resDir | Out-Null
$global:logFile = $null
function Say($t, $c) { if ($c) { Write-Host $t -ForegroundColor $c } else { Write-Host $t }; if ($global:logFile) { Add-Content -Path $global:logFile -Value ((Get-Date -Format 'HH:mm:ss') + '  ' + $t) -Encoding UTF8 } }

# ---------- 连接手机 ----------
$cands = @()
foreach ($p in @($here, "$env:USERPROFILE\Desktop", "$env:USERPROFILE\Downloads", 'F:\点评App测试')) {
  if (Test-Path $p) { $cands += @(Get-ChildItem -Path $p -Recurse -Filter 'adb.exe' -ErrorAction SilentlyContinue -Depth 3 | Where-Object { $_.FullName -match 'platform-tools' } | ForEach-Object { $_.FullName }) }
}
$cands = @($cands | Select-Object -Unique)
if (-not $cands.Count) { Say '没找到 adb。请把 platform-tools 文件夹复制到本文件夹里。' Red; Read-Host '按回车退出'; exit 1 }
$adb = $cands[0]
Get-Process adb -ErrorAction SilentlyContinue | Where-Object { $_.Path -ne $adb } | Stop-Process -Force -ErrorAction SilentlyContinue
& $adb start-server 2>&1 | Out-Null
$dev = $null
for ($t = 0; $t -lt 25 -and -not $dev; $t += 2) {
  $l = @((& $adb devices) | Select-Object -Skip 1 | Where-Object { $_ -match "`tdevice$" -and $_ -notmatch '^(127\.0\.0\.1|emulator-)' })
  if ($l.Count) { $dev = ($l[0] -split "`t")[0] } else { Start-Sleep -Seconds 2 }
}
if (-not $dev) { Say '连不上手机：请确认数据线插好、USB 调试已打开、荣耀手机助手等软件已完全退出。' Red; Read-Host '按回车退出'; exit 1 }
Say "已连接手机：$dev" Green
$size = (& $adb -s $dev shell wm size) -join ''
$W = 1080; $H = 2340; if ($size -match '(\d+)x(\d+)') { $W = [int]$matches[1]; $H = [int]$matches[2] }

function Sh { param([Parameter(ValueFromRemainingArguments = $true)] $a) & $adb -s $dev shell @a 2>&1 }
function TopActivity { ((Sh dumpsys activity activities) | Select-String -Pattern 'topResumedActivity' | Select-Object -First 1) -join '' }
function Tap($x, $y) { Sh input tap ([int]$x) ([int]$y) | Out-Null }
function Back { Sh input keyevent 4 | Out-Null }
function Pause-Rand($a, $b) { Start-Sleep -Milliseconds (Get-Random -Minimum $a -Maximum $b) }

# ---------- 读屏 ----------
function Screen([switch]$shot) {
  $xp = Join-Path $tmp 'ui.xml'; Remove-Item $xp -ErrorAction SilentlyContinue
  for ($i = 0; $i -lt 3; $i++) {
    Sh uiautomator dump /data/local/tmp/rm_ui.xml | Out-Null
    & $adb -s $dev pull /data/local/tmp/rm_ui.xml $xp 2>&1 | Out-Null
    if ((Test-Path $xp) -and (Get-Item $xp).Length -gt 200) { break }
    Start-Sleep -Seconds 1
  }
  if (-not (Test-Path $xp)) { return $null }
  [xml]$x = Get-Content -Path $xp -Encoding UTF8 -Raw
  $nodes = New-Object System.Collections.ArrayList
  foreach ($n in $x.SelectNodes('//node')) {
    $b = $n.GetAttribute('bounds')
    if ($b -match '\[(\d+),(\d+)\]\[(\d+),(\d+)\]') {
      [void]$nodes.Add([pscustomobject]@{ t = $n.GetAttribute('text'); d = $n.GetAttribute('content-desc'); c = $n.GetAttribute('class'); x1 = [int]$matches[1]; y1 = [int]$matches[2]; x2 = [int]$matches[3]; y2 = [int]$matches[4]; pkg = $n.GetAttribute('package') })
    }
  }
  $bmp = $null
  if ($shot) {
    $pp = Join-Path $tmp 'shot.png'; Remove-Item $pp -ErrorAction SilentlyContinue
    Sh screencap -p /data/local/tmp/rm_shot.png | Out-Null
    & $adb -s $dev pull /data/local/tmp/rm_shot.png $pp 2>&1 | Out-Null
    if (Test-Path $pp) { try { $fs = [System.IO.File]::OpenRead($pp); $bmp = New-Object System.Drawing.Bitmap($fs); $fs.Close() } catch { $bmp = $null } }
  }
  return [pscustomobject]@{ nodes = $nodes; bmp = $bmp; all = (($nodes | ForEach-Object { $_.t + ' ' + $_.d }) -join ' ') }
}

# ---------- 解析一屏里的评价 ----------
$TIME_RE = '^(\d+\s*(分钟|小时|天)前|刚刚|昨天|前天|\d{1,2}-\d{1,2}|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}月\d{1,2}日|\d{4}年\d{1,2}月\d{1,2}日)'
$LABELS = @{ '超预期' = 5; '很棒' = 4.5; '满意' = 4; '还不错' = 4; '一般' = 3; '还行' = 3; '不太满意' = 2; '不佳' = 2; '很差' = 1; '失望' = 1 }
function StarsFromPixels($bmp, $stars) {
  # 点评的星星是"橙色方块里一颗白星"，空星是灰色方块；半星是左橙右灰。只看橙色和灰色像素的比例。
  if (-not $bmp -or $stars.Count -lt 5) { return $null }
  $sum = 0.0
  foreach ($s in $stars | Select-Object -First 5) {
    $on = 0; $off = 0
    foreach ($fy in @(0.3, 0.5, 0.7)) {
      $y = [int]($s.y1 + ($s.y2 - $s.y1) * $fy); if ($y -ge $bmp.Height) { continue }
      for ($x = $s.x1 + 1; $x -lt $s.x2 - 1; $x++) {
        if ($x -ge $bmp.Width) { continue }
        $p = $bmp.GetPixel($x, $y)
        if ($p.R -gt 200 -and $p.G -lt 175 -and $p.B -lt 130) { $on++ }
        elseif ([Math]::Abs($p.R - $p.G) -lt 22 -and [Math]::Abs($p.G - $p.B) -lt 22 -and $p.R -lt 238 -and $p.R -gt 110) { $off++ }
      }
    }
    $need = [Math]::Max(6, [int](($s.x2 - $s.x1) * 3 * 0.25))
    if ($on + $off -lt $need) { return $null }  # 这颗星被挡住或没画出来，整条不信
    $r = $on / ($on + $off); if ($r -gt 0.72) { $sum += 1 } elseif ($r -gt 0.22) { $sum += 0.5 }
  }
  return $sum
}
function ParseReviews($scr) {
  $list = New-Object System.Collections.ArrayList; $cur = $null
  foreach ($n in $scr.nodes) {
    if ($n.d -like '用户昵称*') { $cur = [pscustomobject]@{ name = $n.t; time = ''; label = ''; price = ''; body = ''; bodyNode = $null; full = $null; dishes = ''; reply = ''; starNodes = (New-Object System.Collections.ArrayList); y = $n.y1 }; [void]$list.Add($cur); continue }
    if (-not $cur) { continue }
    $t = $n.t
    if ($t -and -not $cur.time -and $t -match $TIME_RE -and $t.Length -lt 20) { $cur.time = $t; continue }
    if ($t -and $LABELS.ContainsKey($t) -and -not $cur.label) { $cur.label = $t; continue }
    if ($t -match '^¥\s*\d+(\.\d+)?\s*/人' -and -not $cur.price) { $cur.price = ($t -replace '[^\d.]', ''); continue }
    if ($n.c -eq 'android.widget.ImageView' -and $cur.time -and -not $cur.body -and -not $cur.price -and $cur.starNodes.Count -lt 5 -and ($n.x2 - $n.x1) -ge 20 -and ($n.x2 - $n.x1) -le 60 -and ($n.y2 - $n.y1) -ge 20 -and ($n.y2 - $n.y1) -le 60) { [void]$cur.starNodes.Add($n); continue }
    if ($t -eq '全文' -or $t -eq '展开') { $cur.full = $n; continue }
    if ($t -like '推荐：*' -or $t -like '推荐:*') { $cur.dishes = (($t -replace '^推荐[：:]', '').Trim() -split '\s{1,}' | Where-Object { $_ }) -join '、'; continue }
    if ($t -match '^.{1,30}[（(]商家[）)]\s*[:：]') { if (-not $cur.reply) { $cur.reply = ($t -replace '^.{1,30}[（(]商家[）)]\s*[:：]\s*', '') }; continue }
    if ($t -and $n.c -eq 'android.widget.TextView' -and $t.Length -ge 8 -and $t.Length -gt $cur.body.Length -and $t -notlike '发布过*' -and $t -notmatch '^(说点什么|搜索)') { $cur.body = $t; $cur.bodyNode = $n; continue }
  }
  $tabBottom = 0; $tb = $scr.nodes | Where-Object { $_.t -eq '筛选' -or $_.t -eq '最新' } | Select-Object -First 1; if ($tb) { $tabBottom = $tb.y2 + 40 }
  foreach ($r in $list) {
    $st = $null
    if ($r.starNodes.Count -ge 5 -and $r.starNodes[0].y1 -gt $tabBottom -and $r.starNodes[0].y2 -lt ($H - 220)) { $st = StarsFromPixels $scr.bmp $r.starNodes }
    if ($st -ne $null -and $LABELS.ContainsKey($r.label) -and [Math]::Abs($st - $LABELS[$r.label]) -ge 1.5) { $st = $null }  # 和标签差太多，说明被遮挡，不信
    if ($st -ne $null -and $st -le 0) { $st = $null }
    $r | Add-Member -NotePropertyName stars -NotePropertyValue $st -Force
  }
  return $list
}
function ToDate($s) {
  $now = Get-Date
  if ($s -match '(\d+)\s*分钟前' -or $s -match '刚刚') { return $now }
  if ($s -match '(\d+)\s*小时前') { return $now.AddHours(-[int]$matches[1]) }
  if ($s -match '(\d+)\s*天前') { return $now.AddDays(-[int]$matches[1]) }
  if ($s -match '昨天') { return $now.AddDays(-1) }
  if ($s -match '前天') { return $now.AddDays(-2) }
  if ($s -match '(\d{4})[-年](\d{1,2})[-月](\d{1,2})') { return Get-Date -Year ([int]$matches[1]) -Month ([int]$matches[2]) -Day ([int]$matches[3]) }
  if ($s -match '^(\d{1,2})[-月](\d{1,2})') { $d = Get-Date -Month ([int]$matches[1]) -Day ([int]$matches[2]); if ($d -gt $now.AddDays(2)) { $d = $d.AddYears(-1) }; return $d }
  return $null
}
$truncRe = '(…|\.\.\.)\s*$'
function IsCut($s) { return ($s -match $truncRe) }
function Key($r) { return ($r.name + '|' + (($r.body -replace '\s', '') + '          ').Substring(0, 12)) }
function CheckVerify($scr) {
  $act = TopActivity
  if (($scr -and $scr.all -match '(安全验证|滑动验证|拖动滑块|请完成验证|验证码|人脸验证|访问异常)') -or $act -match '(?i)(yoda|verify|captcha)') {
    [Console]::Beep(800, 400); Say '【暂停】出现了验证。请在手机上手动完成验证，回到评价列表后，在这里按回车继续。' Yellow
    Read-Host | Out-Null; return $true
  }
  return $false
}

# ---------- 开始 ----------
Say ''
Say '准备：在手机上打开大众点评 → 进入要采集的门店 → 点"评价"进入评价列表页。' Cyan
$store = Read-Host '门店名称（用来命名结果文件，如：大鸽饭福田店）'
if (-not $store) { $store = '门店' }
Say '采集哪一类？ 1 = 最新评价（按时间往前，读到时间范围就停）  2 = 差评（全部差评）'
$mode = Read-Host '输入 1 或 2（直接回车 = 1）'; if ($mode -ne '2') { $mode = '1' }
$days = 365; $max = 1000
if ($mode -eq '1') {
  $d = Read-Host '采集近多少天的评价（直接回车 = 365）'; if ($d -match '^\d+$') { $days = [int]$d }
}
$m = Read-Host '最多采集多少条（直接回车 = 1000）'; if ($m -match '^\d+$') { $max = [int]$m }
$cutoff = (Get-Date).AddDays(-$days)
$safe = ($store -replace '[\\/:*?"<>|]', '_')
$csv = Join-Path $resDir ("{0}_{1}_{2}.csv" -f $safe, $(if ($mode -eq '2') { '差评' } else { '最新' }), (Get-Date -Format 'yyyyMMdd_HHmm'))
$global:logFile = $csv -replace '\.csv$', '_日志.txt'
$dbgDir = Join-Path $resDir '调试'; $dbgN = 0
$enc = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($csv, "日期,星级,评价标签,人均,评价内容,推荐菜,用户,原始时间,是否完整,商家回复`r`n", $enc)
function Q($v) { '"' + ([string]$v -replace '"', '""') + '"' }
$saved = @{}; $pending = @{}; $count = 0
function SaveRow($r, $complete) {
  $k = Key $r; if ($saved.ContainsKey($k)) { return }
  $dt = ToDate $r.time; $ds = if ($dt) { $dt.ToString('yyyy-MM-dd') } else { '' }
  $star = if ($r.stars -ne $null -and $r.stars -gt 0) { $r.stars } elseif ($LABELS.ContainsKey($r.label)) { $LABELS[$r.label] } else { '' }
  $line = (@($ds, $star, $r.label, $r.price, ($r.body -replace '[\r\n]+', ' ' -replace '\uFFFC', ''), $r.dishes, $r.name, $r.time, $(if ($complete) { '是' } else { '否' }), ($r.reply -replace '[\r\n]+', ' ')) | ForEach-Object { Q $_ }) -join ','
  [System.IO.File]::AppendAllText($csv, $line + "`r`n", $enc)
  $saved[$k] = $true; $pending.Remove($k); $script:count++
}

$scr = Screen
if (-not $scr -or $scr.all -notmatch '(全部|最新)') { Say '没识别到评价列表页。请确认手机停在门店的评价列表（能看到"全部 最新 差评"那一排），再运行一次。' Red; Read-Host '按回车退出'; exit 1 }
$listAct = TopActivity
$tabName = if ($mode -eq '2') { '差评' } else { '最新' }
$tab = $scr.nodes | Where-Object { $_.t -eq $tabName } | Select-Object -First 1
if ($tab) { Say "切换到「$tabName」…"; Tap (($tab.x1 + $tab.x2) / 2) (($tab.y1 + $tab.y2) / 2); Start-Sleep -Seconds 3 }
Say ''
Say "开始采集「$store」：$(if ($mode -eq '2') { '差评' } else { "近 $days 天的最新评价" })，最多 $max 条。按 P 暂停 / 继续，按 Q 停止（已采集的会保存）。" Green
Say "结果文件：$csv"

$noNew = 0; $old = 0; $rounds = 0; $expandFail = @{}
while ($count -lt $max) {
  if ([Console]::KeyAvailable) {
    $k = [Console]::ReadKey($true)
    if ($k.Key -eq 'Q') { Say '手动停止。' Yellow; break }
    if ($k.Key -eq 'P') { Say '已暂停。可以用手机，用完请回到评价列表原来的位置，再按 P 继续（按 Q 停止）。' Yellow; $quit = $false; while ($true) { $k2 = [Console]::ReadKey($true); if ($k2.Key -eq 'P') { break }; if ($k2.Key -eq 'Q') { $quit = $true; break } }; if ($quit) { Say '手动停止。' Yellow; break }; Say '继续采集…' Green; $listAct = TopActivity; continue }
  }
  $rounds++
  $scr = Screen -shot
  if (-not $scr) { Say '读屏失败，重试…' Yellow; Start-Sleep -Seconds 2; continue }
  if (CheckVerify $scr) { continue }
  $act = TopActivity
  if ($listAct -and $act -ne $listAct) { Say '不在评价列表页了，返回…' Yellow; Back; Start-Sleep -Seconds 2; continue }
  $revs = ParseReviews $scr
  if ($dbgN -lt 3 -and ($revs | Where-Object { $_.time -and $_.body -and $_.starNodes.Count -lt 5 -and $_.y -gt 400 })) {
    New-Item -ItemType Directory -Force -Path $dbgDir | Out-Null; $dbgN++
    Copy-Item (Join-Path $tmp 'ui.xml') (Join-Path $dbgDir "无星级_$dbgN.xml") -Force -ErrorAction SilentlyContinue
    Copy-Item (Join-Path $tmp 'shot.png') (Join-Path $dbgDir "无星级_$dbgN.png") -Force -ErrorAction SilentlyContinue
  }
  $bottom = $H - 120
  # 1) 先把这一屏被折叠、"全文"按钮看得见的点开
  $expanded = $false
  foreach ($r in $revs) {
    if (-not $r.body) { continue }
    $k = Key $r
    if ($saved.ContainsKey($k) -or $expandFail.ContainsKey($k)) { continue }
    if ((IsCut $r.body) -and $r.full -and $r.full.y2 -lt $bottom -and $r.full.y1 -gt 380) {
      Tap (($r.full.x1 + $r.full.x2) / 2) (($r.full.y1 + $r.full.y2) / 2)
      Pause-Rand 900 1600
      $a2 = TopActivity
      if ($a2 -ne $listAct) {
        # 跳到了详情页：读最长的一段正文再返回
        $s2 = Screen
        if ($s2) { $longest = ($s2.nodes | Where-Object { $_.t -and $_.t.Length -gt $r.body.Length - 5 } | Sort-Object { $_.t.Length } -Descending | Select-Object -First 1); if ($longest) { $r.body = $longest.t } }
        Back; Pause-Rand 1200 2000
        if (-not (IsCut $r.body)) { SaveRow $r $true } else { $expandFail[$k] = $true }
      } else { $expandFail[$k] = $true; $expanded = $true }  # 原地展开：下一轮重新读这一屏
      break
    }
  }
  if ($expanded) { continue }
  # 2) 记录这一屏完整的评价
  $before = $count
  foreach ($r in $revs) {
    if (-not $r.body -or -not $r.time) { continue }
    $k = Key $r; if ($saved.ContainsKey($k)) { continue }
    $dt = ToDate $r.time
    if ($mode -eq '1' -and $dt -and $dt -lt $cutoff) { $old++; continue } else { if ($dt) { $old = 0 } }
    if (-not (IsCut $r.body)) { SaveRow $r $true }
    elseif ($r.bodyNode -and $r.bodyNode.y2 -lt $bottom -and (-not $r.full -or $expandFail.ContainsKey($k))) { $pending[$k] = $r }
  }
  # 已经滑出屏幕、点不开全文的，按不完整保存
  foreach ($k in @($pending.Keys)) { if (-not ($revs | Where-Object { (Key $_) -eq $k })) { SaveRow $pending[$k] $false } }
  if ($count -gt $before) { $noNew = 0; Say ("已采集 {0} 条  最近一条：{1}  {2}" -f $count, $revs[-1].time, ($revs[-1].body -replace '\s', '').Substring(0, [Math]::Min(18, ($revs[-1].body -replace '\s', '').Length))) } else { $noNew++ }
  if ($mode -eq '1' -and $old -ge 6) { Say "已经读到 $days 天以前的评价，停止。" Green; break }
  if ($scr.nodes | Where-Object { $_.t -and $_.t.Length -le 16 -and $_.t -match '(没有更多|已经到底|到底了|暂无更多)' }) { Say '列表已经到底，停止。' Green; break }
  if ($noNew -ge 3 -and $noNew -lt 10) { Say '这几屏没有新评价，等一下加载…' ; Pause-Rand 3000 6000; if ($noNew -eq 5) { Sh input swipe ([int]($W/2)) ([int]($H*0.4)) ([int]($W/2)) ([int]($H*0.6)) 400 | Out-Null; Pause-Rand 1500 2500 } }
  if ($noNew -ge 10) { Say '连续 10 屏没有新评价，判断已到底（或 App 不再加载），停止。' Green; break }
  if ($scr.bmp) { $scr.bmp.Dispose() }
  # 3) 往下滑（像人一样：距离和速度略有变化）
  $x = [int]($W / 2 + (Get-Random -Minimum -60 -Maximum 60))
  $y1 = [int]($H * (Get-Random -Minimum 70 -Maximum 76) / 100); $y2 = [int]($H * (Get-Random -Minimum 32 -Maximum 38) / 100)
  Sh input swipe $x $y1 $x $y2 (Get-Random -Minimum 450 -Maximum 750) | Out-Null
  Pause-Rand 1600 3200
  if ($rounds % 40 -eq 0) { Say '休息一下（模拟正常浏览节奏）…'; Pause-Rand 8000 15000 }
}
foreach ($k in @($pending.Keys)) { SaveRow $pending[$k] $false }
Say ''
Say "完成：共 $count 条（运行 $rounds 屏），已保存到：" Green
Say $csv
Say '下一步：插件 → 调研 → 门店评价调研 → 导入评价表格，选这个文件。'
Read-Host '按回车关闭'
