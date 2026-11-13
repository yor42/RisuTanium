# Fake-adb cases for the adbg typing chain. Usage: pwsh -File typing-chain.test.ps1 -GuardPath <adbg.mjs>
param([Parameter(Mandatory = $true)][string]$GuardPath)
# Scratch files (fake adb, log, state) go to a fresh temp folder, never next to the tracked test.
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('adbg-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$fake = Join-Path $testDir 'fake.mjs'
Set-Content $fake 'process.exit(Number(process.env.FAKE_EXIT || 0))'
$env:ADBG_FAKE_ADB_SCRIPT = $fake
$env:FAKE_EXIT = '0'
$log = Join-Path $testDir ('log-' + [guid]::NewGuid().ToString('N') + '.txt')
$st = Join-Path $testDir ('state-' + [guid]::NewGuid().ToString('N') + '.json')
$script:failures = 0
function Invoke-GuardCase([string]$label, [string]$want, [string[]]$guardArgs) {
    & node $GuardPath @guardArgs 2>$null | Out-Null
    $ok = ([string]$LASTEXITCODE -eq $want)
    if (-not $ok) { $script:failures++ }
    ($(if ($ok) { 'ok  ' } else { 'FAIL' })) + ' ' + $label + ' -> ' + $LASTEXITCODE + ' (want ' + $want + ')'
}
function Set-LocateRecord {
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $o = @{ picks = @(); pickErrors = 0; offset = $null; pickLocked = $false; locates = @(@{ id = 1; time = $now; label = 'css:#field'; bounds = @{ l = 10; t = 10; r = 110; b = 60 }; used = $false; serial = 'emulator-5580' }) }
    ConvertTo-Json $o -Depth 5 | Set-Content $st
}
$c = @('--serial', 'emulator-5580', '--log', $log)
Invoke-GuardCase 'text no state' '99' ($c + @('--', 'shell', 'input text hello'))
Set-LocateRecord
Invoke-GuardCase 'text no grant' '99' ($c + @('--state', $st, '--', 'shell', 'input text hello'))
Invoke-GuardCase 'tap' '0' (@('tap') + $c + @('--state', $st))
Invoke-GuardCase 'text after tap' '0' ($c + @('--state', $st, '--', 'shell', 'input text hello'))
Invoke-GuardCase 'enter after text' '0' ($c + @('--state', $st, '--', 'shell', 'input keyevent 66'))
Invoke-GuardCase 'second text in chain' '99' ($c + @('--state', $st, '--', 'shell', 'input text again'))
Invoke-GuardCase 'home any time' '0' ($c + @('--', 'shell', 'input keyevent KEYCODE_HOME'))
Invoke-GuardCase 'enter after home' '99' ($c + @('--state', $st, '--', 'shell', 'input keyevent 66'))
Invoke-GuardCase 'letter key' '97' ($c + @('--', 'shell', 'input keyevent KEYCODE_A'))
Invoke-GuardCase 'longpress flag' '97' ($c + @('--', 'shell', 'input keyevent --longpress 3'))
Set-LocateRecord
Invoke-GuardCase 'tap2' '0' (@('tap') + $c + @('--state', $st))
Invoke-GuardCase 'date between' '0' ($c + @('--', 'shell', 'date'))
Invoke-GuardCase 'text after date' '99' ($c + @('--state', $st, '--', 'shell', 'input text hi'))
Set-LocateRecord
Invoke-GuardCase 'tap other serial' '99' (@('tap', '--serial', '2ac80128013f7ece', '--log', $log, '--state', $st))
$env:FAKE_EXIT = '1'; Set-LocateRecord
Invoke-GuardCase 'tap fails' '1' (@('tap') + $c + @('--state', $st))
$env:FAKE_EXIT = '0'
Invoke-GuardCase 'text after failed tap' '99' ($c + @('--state', $st, '--', 'shell', 'input text hi'))
Set-LocateRecord
Invoke-GuardCase 'tap5' '0' (@('tap') + $c + @('--state', $st))
# The only other full-access serials are playground serials (MC-1666), which need no typing grant, so the cross-serial grant check cannot be reached with a second full-access serial.
Invoke-GuardCase 'text on a playground serial needs no grant' '0' (@('--serial', '2ac80128013f7ece', '--log', $log, '--state', $st, '--', 'shell', 'input text hi'))
Set-LocateRecord
Invoke-GuardCase 'tap6' '0' (@('tap') + $c + @('--state', $st))
Invoke-GuardCase 'enter direct after tap' '0' ($c + @('--state', $st, '--', 'shell', 'input keyevent KEYCODE_ENTER'))
Invoke-GuardCase 'text after enter (chain)' '0' ($c + @('--state', $st, '--', 'shell', 'input text hi'))
Set-LocateRecord
Invoke-GuardCase 'tap7' '0' (@('tap') + $c + @('--state', $st))
$env:FAKE_EXIT = '1'
Invoke-GuardCase 'text fails' '1' ($c + @('--state', $st, '--', 'shell', 'input text hi'))
$env:FAKE_EXIT = '0'
Invoke-GuardCase 'enter after failed text' '99' ($c + @('--state', $st, '--', 'shell', 'input keyevent 66'))
Invoke-GuardCase 'nav home mixed with enter' '99' ($c + @('--state', $st, '--', 'shell', 'input keyevent 3 66'))
Remove-Item Env:ADBG_FAKE_ADB_SCRIPT; Remove-Item Env:FAKE_EXIT
'failures=' + $script:failures
exit $script:failures
