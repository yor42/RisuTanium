# dumptest.ps1 - measures what one UiAutomation connection (uiautomator dump) does to a running TalkBack session.
# Two baseline `next` swipes, one dump, then `next` at about +0, +2, +5 and +10 s after the dump returned; prints the
# event timeline (device uptime) with the unbind/rebind and the speech. Needs a session from session.ps1 -Action on,
# with the subject app in front. Usage: pwsh -File dumptest.ps1 -Label settings
param([Parameter(Mandatory)][string]$Label, [string]$DumpPath = '/data/local/tmp/tbx.xml')
$tbg = Join-Path $PSScriptRoot 'tbg.ps1'; $tb = Join-Path $PSScriptRoot 'tb.mjs'
function Get-TbLast { (node $tb ping | ConvertFrom-Json).last }
function Invoke-TbStep($tag) {
  $t0 = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  $j = node $tb next | ConvertFrom-Json
  $dt = [DateTimeOffset]::Now.ToUnixTimeMilliseconds() - $t0
  "[$Label $tag +${dt}ms] gestureEv=$($j.gestureEvents -join ',') now=$($j.nowFocused.cls)|$($j.nowFocused.text)|$($j.nowFocused.desc) speech=$($j.speech -join ' / ')"
}
function Wait-TbUntil([long]$from, [int]$ms) { Start-Sleep -Milliseconds ([Math]::Max(0, $ms - ([DateTimeOffset]::Now.ToUnixTimeMilliseconds() - $from))) }
Invoke-TbStep 'base1'; Invoke-TbStep 'base2'
$b = Get-TbLast
$h0 = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
& $tbg shell "uiautomator dump $DumpPath" | Out-Null
$h1 = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
"[$Label] dump call took $($h1 - $h0) ms (host)"
Invoke-TbStep 'after+0'
Wait-TbUntil $h1 2000; Invoke-TbStep 'after+2s'
Wait-TbUntil $h1 5000; Invoke-TbStep 'after+5s'
Wait-TbUntil $h1 10000; Invoke-TbStep 'after+10s'
$all = (node $tb raw "/events?since=$b" | ConvertFrom-Json).items
$first = $all[0].t
"[$Label] timeline (device uptime ms relative to the first event after the baseline):"
$all | Where-Object { $_.kind -in 'svc', 'tts', 'speech', 'gesture' -or $_.type -match 'GESTURE_DETECTION_START|WINDOWS_CHANGED|ACCESSIBILITY_FOCUSED$' } |
  ForEach-Object { "  +$($_.t - $first) $($_.kind) $($_.type) $($_.msg) $($_.text) $($_.result)" }
& $tbg shell "rm -f $DumpPath" | Out-Null
