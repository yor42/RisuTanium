# tbg.ps1 - adbg wrapper for tbdriver runs. Every adb call goes through the device guard; nothing here calls adb.exe.
# Parameters come from the environment so a brief can pin them once per run:
#   TB_SERIAL     device serial (required; no default, so a run never lands on the wrong phone)
#   TB_RUN        run folder holding adb-commands.log and adbg-state.json (required)
#   TB_PKG        --own-package for this call (default io.github.yor42.risutanium; set io.github.yor42.tbdriver
#                 or another test package for its own am start / force-stop)
#   TB_OWN_PORTS  --own-ports (default 9561,9562; must include the host port used by tb.mjs)
#   TB_GUARD      path to adbg.mjs (default: the device-guard folder next to this tool)
#   TB_OUT        when set, the call is a screencap written to this PNG path (pass `exec-out screencap -p`)
# Usage: pwsh -File tbg.ps1 shell "settings get global wifi_on"
if (-not $env:TB_SERIAL) { Write-Error 'TB_SERIAL is not set'; exit 2 }
if (-not $env:TB_RUN) { Write-Error 'TB_RUN is not set'; exit 2 }
$guard = if ($env:TB_GUARD) { $env:TB_GUARD } else { Join-Path $PSScriptRoot '..\..\device-guard\adbg.mjs' }
$pkg = if ($env:TB_PKG) { $env:TB_PKG } else { 'io.github.yor42.risutanium' }
$ports = if ($env:TB_OWN_PORTS) { $env:TB_OWN_PORTS } else { '9561,9562' }
$common = @('--serial', $env:TB_SERIAL, '--log', (Join-Path $env:TB_RUN 'adb-commands.log'), '--state', (Join-Path $env:TB_RUN 'adbg-state.json'), '--own-ports', $ports, '--own-package', $pkg)
if ($env:TB_OUT) { $common += @('--out', $env:TB_OUT) }
& node $guard @common -- @args
exit $LASTEXITCODE
