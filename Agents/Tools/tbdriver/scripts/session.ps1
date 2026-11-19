# session.ps1 - turn the TalkBack + tbdriver session on or off through tbg.ps1, reading every setting back.
# Usage: pwsh -File session.ps1 -Action on|off|status [-NoSpeech] [-HostPort <port>]  (default: TB_HOST_PORT, else 9562)
# Needs TB_SERIAL and TB_RUN (see tbg.ps1). `on` assumes tbdriver is already installed (tbg.ps1 install <apk>).
param([ValidateSet('on', 'off', 'status')][string]$Action = 'status', [switch]$NoSpeech,
  [int]$HostPort = $(if ($env:TB_HOST_PORT) { [int]$env:TB_HOST_PORT } else { 9562 }),
  [string]$ScreenReader = 'com.samsung.accessibility/com.samsung.android.app.talkback.TalkBackService')
$ErrorActionPreference = 'Stop'
$tbg = Join-Path $PSScriptRoot 'tbg.ps1'
$driver = 'io.github.yor42.tbdriver/io.github.yor42.tbdriver.DriverService'
function G { $o = & $tbg @args; if ($LASTEXITCODE -ne 0) { throw "guard exit $LASTEXITCODE for $($args -join ' ')" }; $o }
function readback {
  [ordered]@{
    enabled_accessibility_services = "$(G shell 'settings get secure enabled_accessibility_services')".Trim()
    accessibility_enabled = "$(G shell 'settings get secure accessibility_enabled')".Trim()
    tts_default_synth = "$(G shell 'settings get secure tts_default_synth')".Trim()
    wifi_on = "$(G shell 'settings get global wifi_on')".Trim()
    mobile_data = "$(G shell 'settings get global mobile_data')".Trim()
  }
}
switch ($Action) {
  'on' {
    # The capture engine must be the default before the screen reader starts: it picks the engine at startup.
    if (-not $NoSpeech) { G shell 'settings put secure tts_default_synth io.github.yor42.tbdriver' | Out-Null }
    G shell "settings put secure enabled_accessibility_services ${ScreenReader}:$driver" | Out-Null
    G shell 'settings put secure accessibility_enabled 1' | Out-Null
    G forward "tcp:$HostPort" 'tcp:9562' | Out-Null
  }
  'off' {
    G shell 'settings put secure enabled_accessibility_services null' | Out-Null
    G shell 'settings put secure accessibility_enabled 0' | Out-Null
    G shell 'settings delete secure tts_default_synth' | Out-Null
    G forward --remove "tcp:$HostPort" | Out-Null
  }
}
$r = readback
$r | Format-Table -AutoSize | Out-String | Write-Output
if ($Action -eq 'off' -and ($r.enabled_accessibility_services -ne 'null' -or $r.accessibility_enabled -ne '0' -or $r.tts_default_synth -ne 'null')) { Write-Error 'teardown read-back is not clean'; exit 1 }
if ($r.wifi_on -ne '0' -or $r.mobile_data -ne '0') { Write-Warning 'network is ON: device briefs require it off' }
