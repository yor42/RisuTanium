# Self-tests for the device-check runner (lib.ps1, Run-Check.ps1) with scripted children and a fake adb.
# Plain asserts; exit code 0 only if every assert holds. Scratch lives under the user temp dir and is removed at the end.
# -RunnerDir points the tests at another copy of the runner (used to prove that broken variants fail these tests).
param(
    [string]$RunnerDir,
    [string]$ScratchBase,
    [switch]$Fast
)
$ErrorActionPreference = 'Stop'
if (-not $RunnerDir) { $RunnerDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
if (-not $ScratchBase) { $ScratchBase = Join-Path $env:TEMP 'risu-b715\devscripts\s2r\runner-tests' }
$work = Join-Path $ScratchBase ([guid]::NewGuid().ToString('N'))
$childDir = Join-Path $work 'child dir'
New-Item -ItemType Directory -Force -Path $childDir | Out-Null
. (Join-Path $RunnerDir 'lib.ps1')

$script:failures = 0
$script:spawned = @()
function Assert([bool]$Cond, [string]$Msg) {
    if ($Cond) { Write-Output ('PASS ' + $Msg) } else { Write-Output ('FAIL ' + $Msg); $script:failures++ }
}
function New-Cmd([string]$Path, [string[]]$Lines) { Set-Content -LiteralPath $Path -Value $Lines -Encoding ascii }
function Test-Alive([int]$Id) { return [bool](Get-Process -Id $Id -ErrorAction SilentlyContinue) }

# Fake adb: get-state and pidof behaviour follow FAKE_ADB_MODE (device, offline, absent, hang).
$fakeAdb = Join-Path $work 'fakeadb.cmd'
New-Cmd $fakeAdb @(
    '@echo off',
    'if "%FAKE_ADB_MODE%"=="hang" ping -n 40 127.0.0.1 >nul',
    'echo %* | findstr /c:"get-state" >nul',
    'if not errorlevel 1 goto state',
    'echo %* | findstr /c:"pidof" >nul',
    'if not errorlevel 1 goto pidof',
    'exit /b 0',
    ':state',
    'if "%FAKE_ADB_MODE%"=="offline" (echo error: device offline 1>&2 & exit /b 1)',
    'echo device',
    'exit /b 0',
    ':pidof',
    'if "%FAKE_ADB_MODE%"=="absent" exit /b 1',
    'echo 4242',
    'exit /b 0'
)
# Stateful fake adb for the stage 2 tests: node script driven by files in FAKE_ADB_DIR (pid, clock, logcat.txt, forwards.txt,
# settings as s-<name>, whitelist.txt, mode, noapply, nostart, startpid). Logcat honours the -T start time like the real tool.
$fdir = Join-Path $work 'fake-state'
New-Item -ItemType Directory -Force -Path $fdir | Out-Null
$fakeJs = Join-Path $work 'fakeadb.cjs'
New-Cmd $fakeJs @(
    'const fs = require("fs"), path = require("path")',
    'const dir = process.env.FAKE_ADB_DIR',
    'const rd = (n, d) => { try { return fs.readFileSync(path.join(dir, n), "utf8") } catch (e) { return d === undefined ? "" : d } }',
    'const wr = (n, v) => fs.writeFileSync(path.join(dir, n), v)',
    'const out = (s) => process.stdout.write(s + "\n")',
    'let a = process.argv.slice(2)',
    'if (a[0] === "-s") a = a.slice(2)',
    'fs.appendFileSync(path.join(dir, "calls.txt"), a.join(" ") + "\n")',
    'const mode = rd("mode", "device").trim()',
    'const lines = (n) => rd(n).split("\n").filter(Boolean)',
    'const save = (n, l) => wr(n, l.map((x) => x + "\n").join(""))',
    'function main() {',
    '  if (a[0] === "get-state") { if (mode === "offline") { process.stderr.write("error: device offline\n"); process.exit(1) } out("device"); return }',
    '  if (a[0] === "forward") {',
    '    const f = lines("forwards.txt")',
    '    if (a[1] === "--list") { f.forEach((l) => out(l)); return }',
    '    if (a[1] === "--remove") { save("forwards.txt", f.filter((l) => l.split(" ")[1] !== a[2])); return }',
    '    if (a[1] === "--no-rebind") {',
    '      if (rd("fwderr") !== "") { process.stderr.write(rd("fwderr").trim() + "\n"); process.exit(1) }',
    '      if (f.some((l) => l.split(" ")[1] === a[2]) || lines("ghost").includes(a[2])) { process.stderr.write("adb: error: cannot rebind existing socket\n"); process.exit(1) }',
    '      save("forwards.txt", f.concat(["FAKE " + a[2] + " " + a[3]])); return',
    '    }',
    '    save("forwards.txt", f.filter((l) => l.split(" ")[1] !== a[1]).concat(["FAKE " + a[1] + " " + a[2]])); return',
    '  }',
    '  if (a[0] === "reverse") {',
    '    const f = lines("reverses.txt")',
    '    if (a[1] === "--list") { f.forEach((l) => out(l)); return }',
    '    if (a[1] === "--remove") { save("reverses.txt", f.filter((l) => l.split(" ")[1] !== a[2])); return }',
    '    if (rd("reverr") !== "") { process.stderr.write(rd("reverr").trim() + "\n"); process.exit(1) }',
    '    const nr = a[1] === "--no-rebind", dev = a[nr ? 2 : 1], host = a[nr ? 3 : 2]',
    '    if (f.some((l) => l.split(" ")[1] === dev)) {',
    '      if (nr) { process.stderr.write("adb: error: cannot rebind existing socket\n"); process.exit(1) }',
    '      save("reverses.txt", f.filter((l) => l.split(" ")[1] !== dev))',
    '    }',
    '    if (rd("noapply") === "") save("reverses.txt", lines("reverses.txt").concat(["UsbFfs " + dev + " " + host]))',
    '    return',
    '  }',
    '  const dd = path.join(dir, "data"), rr = path.join(dir, "remote")',
    '  const cp = require("child_process")',
    '  const kbOf = (p) => { const s = fs.statSync(p); if (!s.isDirectory()) return Math.ceil(s.size / 4096) * 4; return 4 + fs.readdirSync(p).reduce((t, n) => t + kbOf(path.join(p, n)), 0) }',
    '  const cnt = (p) => { const s = fs.statSync(p); if (!s.isDirectory()) return 1; return fs.readdirSync(p).reduce((t, n) => t + cnt(path.join(p, n)), 0) }',
    '  if (a[0] === "exec-out" && a[1] === "run-as" && a[3] === "tar") {',
    '    const ex = rd("tarexclude").trim(), opt = ex ? ["--exclude=" + ex] : []',
    '    const r = cp.spawnSync("tar", ["-cf", "-", "-C", dd].concat(opt, a.slice(6)), { stdio: ["ignore", "inherit", "inherit"] })',
    '    if (rd("tarextra") !== "") fs.writeSync(1, "x")',
    '    const mt = rd("tarmutate").trim(); if (mt) fs.appendFileSync(path.join(dd, mt), "more")',
    '    process.exit(r.status)',
    '  }',
    '  if (a[0] === "push") {',
    '    fs.mkdirSync(rr, { recursive: true }); const dst = path.join(rr, path.basename(a[2])); fs.copyFileSync(a[1], dst)',
    '    if (rd("corruptpush") !== "") { const b = fs.readFileSync(dst); b[100] = b[100] ^ 1; fs.writeFileSync(dst, b) }',
    '    if (rd("pushrevive") !== "") { wr("pid", "4321"); wr("nostop", "1") }',
    '    out("1 file pushed"); return',
    '  }',
    '  if (a[0] !== "shell") return',
    '  const c = a.slice(1).join(" ")',
    '  let m',
    '  if (/^pidof /.test(c)) { if (mode === "pidoferr") { process.stderr.write("boom\n"); process.exit(2) } const p = rd("pid").trim(); if (!p) process.exit(1); out(p); return }',
    '  if (/^date /.test(c)) { out(rd("clock", "10-21 12:00:00.000").trim()); return }',
    '  if (/^logcat /.test(c)) { m = /-T \x27([^\x27]+)\x27/.exec(c); const since = m ? m[1] : ""; lines("logcat.txt").filter((l) => l.slice(0, 18) >= since).forEach((l) => out(l)); return }',
    '  if ((m = /^settings get global (\w+)/.exec(c))) { out(rd("s-" + m[1], "null").trim()); return }',
    '  if ((m = /^settings put global (\w+) (\S+)/.exec(c))) { if (rd("noapply") === "") wr("s-" + m[1], m[2]); return }',
    '  if ((m = /^settings delete global (\w+)/.exec(c))) { try { fs.unlinkSync(path.join(dir, "s-" + m[1])) } catch (e) {} return }',
    '  if (/^dumpsys deviceidle whitelist/.test(c)) {',
    '    let w = lines("whitelist.txt")',
    '    if ((m = /whitelist \+(\S+)/.exec(c))) { if (rd("noapply") === "") { w.push("user," + m[1] + ",10300"); save("whitelist.txt", w) } out("Added: " + m[1]); return }',
    '    if ((m = /whitelist -(\S+)/.exec(c))) { save("whitelist.txt", w.filter((l) => !l.startsWith("user," + m[1] + ","))); return }',
    '    w.forEach((l) => out(l)); return',
    '  }',
    '  if (/^am force-stop/.test(c)) { if (rd("nostop") === "") wr("pid", ""); return }',
    '  if (/^run-as \S+ ls -A$/.test(c)) { fs.readdirSync(dd).forEach((n) => out(n)); return }',
    '  if ((m = /^run-as \S+ du -sk (.+)$/.exec(c))) { m[1].split(" ").forEach((n) => out(kbOf(path.join(dd, n)) + "\t" + n)); return }',
    '  if ((m = /^run-as \S+ find (.+) -type f -exec stat -c \x27%s %n\x27 \{\} \+$/.exec(c))) {',
    '    const walk = (rel) => { const p = path.join(dd, rel); const s = fs.statSync(p); if (!s.isDirectory()) { out(s.size + " " + rel.replace(/\\/g, "/")); return } fs.readdirSync(p).forEach((n) => walk(path.join(rel, n))) }',
    '    m[1].split(" ").forEach((n) => walk(n)); return',
    '  }',
    '  if ((m = /^run-as \S+ rm -rf (.+)$/.exec(c))) { m[1].split(" ").forEach((n) => fs.rmSync(path.join(dd, n), { recursive: true, force: true })); return }',
    '  if ((m = /^run-as \S+ tar( --no-same-owner)? -xf (\S+)$/.exec(c))) { if (rd("chownfail") !== "" && !m[1]) { process.stderr.write("tar: chown 10320:10320 \x27store2\x27: Operation not permitted\n"); process.exit(1) } const r = cp.spawnSync("tar", ["-xf", path.join(rr, path.basename(m[2])), "-C", dd], { stdio: "inherit" }); const drop = rd("dropfile").trim(); if (drop) fs.rmSync(path.join(dd, drop), { force: true }); const shr = rd("shrinkfile").trim(); if (shr) fs.writeFileSync(path.join(dd, shr), "x"); process.exit(rd("xfail") !== "" ? 3 : r.status) }',
    '  if ((m = /^stat -c %s (\S+)$/.exec(c))) { const f = path.join(rr, path.basename(m[1])); if (!fs.existsSync(f)) process.exit(1); out(String(fs.statSync(f).size)); return }',
    '  if ((m = /^uiautomator dump (\S+)$/.exec(c))) {',
    '    fs.mkdirSync(rr, { recursive: true })',
    '    const auto = "<hierarchy><node text=\"" + (fs.readdirSync(rr).filter((n) => /\.bin$/.test(n))[0] || "") + "\" bounds=\"[10,20][110,60]\" /></hierarchy>"',
    '    fs.writeFileSync(path.join(rr, path.basename(m[1])), rd("uixml", "<hierarchy/>") === "@auto" ? auto : rd("uixml", "<hierarchy/>"))',
    '    if (process.env.FAKE_LOCK_FILE) wr("lockseen", fs.existsSync(process.env.FAKE_LOCK_FILE) ? "1" : "0")',
    '    out("UI hierarchy dumped"); return',
    '  }',
    '  if ((m = /^cat (\S+)$/.exec(c))) { const f = path.join(rr, path.basename(m[1])); if (!fs.existsSync(f)) process.exit(1); out(fs.readFileSync(f, "utf8")); return }',
    '  if (/^run-as \S+ sh -c \x27cat store2\/\*-s\*/.test(c)) { out(rd("chars", "0").trim()); return }',
    '  if (/^run-as \S+ sh -c \x27ls store2 \| wc -l\x27$/.test(c)) { const k = Number(rd("lscalls", "0")) + 1; wr("lscalls", String(k)); if (Number(rd("lsdrop", "0")) === k) { wr("pid", ""); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1300) } out(rd("store2n", "52").trim()); return }',
    '  if ((m = /^sha256sum (\S+)$/.exec(c))) { if (rd("shaerr") !== "") { process.stderr.write("boom\n"); process.exit(2) } const f = path.join(rr, path.basename(m[1])); if (!fs.existsSync(f)) { process.stderr.write("sha256sum: " + m[1] + ": No such file or directory\n"); process.exit(1) } out(require("crypto").createHash("sha256").update(fs.readFileSync(f)).digest("hex") + "  " + m[1]); return }',
    '  if ((m = /^rm -f (\S+)$/.exec(c))) { fs.rmSync(path.join(rr, path.basename(m[1])), { force: true }); return }',
    '  if (/^df /.test(c)) { out("Filesystem 1K-blocks Used Available Use% Mounted on"); out("/dev/x 10000000 1000000 " + rd("dfavail", "9000000").trim() + " 10% /data"); return }',
    '  if (/^pm path/.test(c)) { out("package:/data/app/x/base.apk"); return }',
    '  if (/^am start -W/.test(c)) { if (rd("nostart") !== "") { out("Error type 3"); out("Error: Activity class does not exist."); return } wr("pid", rd("startpid", "5555")); out("Status: ok"); out("TotalTime: 321"); out("WaitTime: 330"); return }',
    '  if (/^echo x \| toybox nc /.test(c)) { out(rd("ncout").trim()); process.exit(Number(rd("ncexit", "0"))) }',
    '  if (/^dumpsys power/.test(c)) { out("mWakefulness=Awake"); return }',
    '  if (/^dumpsys package/.test(c)) { out("versionCode=" + rd("vcode", "1000").trim() + " minSdk=24"); out("versionName=0.1.0"); out("pkgFlags=[ " + (rd("release") === "" ? "DEBUGGABLE " : "") + "HAS_CODE ]"); out("signatures=PackageSignatures{58f04a4 version:2, signatures:[" + rd("sig", "8b25b40d").trim() + "], past signatures:[]}"); return }',
    '  if (/^dumpsys webviewupdate/.test(c)) { out("Current WebView package (name, version): (com.fake.webview, 1.0)"); return }',
    '  if (/^dumpsys meminfo/.test(c)) { out("TOTAL   1000"); return }',
    '  if (/^ps -A/.test(c)) { out("5555 io.github.yor42.risutanium"); out("6000 com.fake.webview:sandboxed_process0:svc:0"); out("6001 com.fake.webview:sandboxed_process0:svc:0"); out("6002 com.fake.webview:webview_service"); out("7000 other.app"); return }',
    '  if (/^dumpsys activity processes/.test(c)) {',
    '    if (rd("noactivity") !== "") return',
    '    out("  *APP* UID 10320 ProcessRecord{17609d1 5555:io.github.yor42.risutanium/u0a320}")',
    '    out("  *APP* UID 99679 ProcessRecord{a22a954 6000:com.fake.webview:sandboxed_process0:svc:0/u0a320i679}")',
    '    out("  *APP* UID 99680 ProcessRecord{51811f2 6001:com.fake.webview:sandboxed_process0:svc:0/u0a159i680}")',
    '    out("  *APP* UID 10159 ProcessRecord{3f4a5b6 6002:com.fake.webview:webview_service/u0a159}")',
    '    return',
    '  }',
    '}',
    'if (mode === "hang") setTimeout(() => {}, 60000); else main()')
$fake2 = Join-Path $work 'fakeadb2.cmd'
New-Cmd $fake2 @('@echo off', ('node "' + $fakeJs + '" %*'), 'exit /b %errorlevel%')
# Fake CDP page for the import tests, driven by files in FAKE_ADB_DIR: ringplan (JSON array of marks; one more mark shows per ring poll,
# a mark may carry fx = forcestop to drop the app pid like a harness-issued am force-stop, fx = chars to raise the chaId token
# count, or fx = restart to restart the page and, unless nogrow is set, to grow the store2 entry count like a landed import),
# noring, warnat (poll number from which the size warning shows until it is confirmed), wizard, notices (one notice text per line; each
# dismiss call removes the first one, and with noticegate = restarted they show only after the page restart), bootblock (the loading
# screen stays up while a notice is pending).
$fakeCdp = Join-Path $work 'fakecdp.cjs'
New-Cmd $fakeCdp @(
    'const fs = require("fs"), path = require("path")',
    'const dir = process.env.FAKE_ADB_DIR',
    'const rd = (n, d) => { try { return fs.readFileSync(path.join(dir, n), "utf8") } catch (e) { return d === undefined ? "" : d } }',
    'const wr = (n, v) => fs.writeFileSync(path.join(dir, n), v)',
    'const expr = process.argv[process.argv.length - 1]',
    'const val = (v) => { console.log(JSON.stringify(v)); process.exit(0) }',
    'if (/localStorage\.setItem/.test(expr)) val("undefined")',
    'if (/snapshot\(\)/.test(expr)) {',
    '  const n = Number(rd("ringcalls", "0")) + 1; wr("ringcalls", String(n))',
    '  const plan = JSON.parse(rd("ringplan", "[]"))',
    '  const shown = plan.slice(0, Math.min(n - 1, plan.length))',
    '  const last = shown[shown.length - 1]',
    '  if (rd("restarted") !== "") val(JSON.stringify({ ring: null, now: 300, epoch: Date.now(), warn: false }))',
    '  if (last && last.fx === "forcestop") wr("pid", "")',
    '  if (last && last.fx === "chars") wr("chars", "485")',
    '  if (last && last.fx === "restart") { wr("restarted", "1"); wr("chars", "485"); if (rd("nogrow") === "") wr("store2n", "6494") }',
    '  const warnAt = Number(rd("warnat", "0"))',
    '  val(JSON.stringify({ ring: rd("noring") !== "" ? null : shown.map((e) => ({ phase: e.phase, t: e.t, heapMiB: e.heapMiB })), now: (last ? last.t : 0) + 500, epoch: Date.now(), warn: warnAt > 0 && n >= warnAt && rd("yes") === "" }))',
    '}',
    'if (/r\("clicked"\)/.test(expr)) { if (rd("yesswallow") !== "" && rd("swallowed") === "") { wr("swallowed", "1"); val("clicked") } wr("yes", "1"); val("clicked") }',
    'if (/r\("ok"\)/.test(expr)) val("none")',
    'const pendingNotices = () => rd("notices").split("\n").filter(Boolean)',
    'if (/dismissed:/.test(expr)) {',
    '  const ns = pendingNotices()',
    '  const gate = rd("noticegate").trim()',
    '  if (ns.length === 0 || (gate === "restarted" && rd("restarted") === "") || (gate === "booting" && rd("bootprobed") === "")) val("none")',
    '  wr("notices", ns.slice(1).join("\n")); val("dismissed:" + ns[0])',
    '}',
    'if (/!\(new RegExp\(/.test(expr)) wr("bootprobed", "1")',
    'if (/!\(new RegExp\(/.test(expr)) val(rd("bootdone", "true").trim() === "true" && !(rd("bootblock") !== "" && pendingNotices().length > 0))',
    'if (/RegExp\(/.test(expr) && /innerText/.test(expr)) val(rd("wizard", "false").trim() === "true")',
    'val(true)')
function Set-Fake([string]$Name, [string]$Value) { [IO.File]::WriteAllText((Join-Path $fdir $Name), $Value) }
function Clear-Fake { Get-ChildItem -LiteralPath $fdir -File | Remove-Item -Force }

New-Cmd (Join-Path $childDir 'done.cmd') @('@echo off', 'echo args=%1', 'exit /b 0')
New-Cmd (Join-Path $childDir 'fail.cmd') @('@echo off', 'echo failing', 'exit /b 7')
New-Cmd (Join-Path $childDir 'sleeper.cmd') @('@echo off', 'start /b ping -n 300 127.0.0.1 > nul', 'ping -n 300 127.0.0.1 > nul')
New-Cmd (Join-Path $childDir 'linger.cmd') @('@echo off', 'echo building', 'start /b ping -n 60 127.0.0.1 > nul', 'echo done-artifact')
New-Cmd (Join-Path $childDir 'short.cmd') @('@echo off', 'ping -n 6 127.0.0.1 > nul', 'exit /b 0')

function Invoke-Runner {
    param([string]$Name, [string]$File, [string[]]$ChildArg, [int]$Cap = 30, [string[]]$Extra = @())
    $out = Join-Path $work $Name
    $a = @('-NoProfile', '-File', (Join-Path $RunnerDir 'Run-Check.ps1'), '-CheckId', $Name, '-OutDir', $out,
        '-MaxSeconds', $Cap, '-FilePath', $File, '-BuildKind', 'none')
    if ($ChildArg) { $a += @('-ArgumentList', $ChildArg) }
    $a += $Extra
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $text = (& pwsh @a | Out-String)
    $code = $LASTEXITCODE
    $sw.Stop()
    $res = $null
    $rp = Join-Path $out 'result.json'
    if (Test-Path -LiteralPath $rp) {
        $res = Get-Content -LiteralPath $rp -Raw | ConvertFrom-Json -AsHashtable
        foreach ($d in @($res.descendantPids) + @($res.lingering | ForEach-Object { $_.pid })) { if ($d) { $script:spawned += $d } }
    }
    return [pscustomobject]@{ Elapsed = $sw.Elapsed.TotalSeconds; Exit = $code; Result = $res; Text = $text; Out = $out }
}

try {
    # static rules over the shipped scripts
    $files = @('lib.ps1', 'Run-Check.ps1', 'build-apk.ps1', 'sign-install.ps1', 'device-prep.ps1', 'cold-start.ps1', 'snapshot.ps1', 'restore-snapshot.ps1', 'import-bin.ps1', 'fixture-push.ps1', 'sign-release.ps1', 'mock-reverse.ps1') | ForEach-Object { Join-Path $RunnerDir $_ }
    $code = ($files | ForEach-Object { (Get-Content -LiteralPath $_) | Where-Object { $_ -notmatch '^\s*#' } }) -join [Environment]::NewLine
    Assert ($code -notmatch '\s-Wait\b') 'no Start-Process -Wait'
    Assert ($code -notmatch 'WaitForExit\(\s*\)') 'no unbounded WaitForExit'
    Assert ($code -notmatch '\*>') 'no *> redirection'
    Assert ($code -notmatch 'cmd(\.exe)?\s+/c') 'no cmd /c strings'
    Assert ($code -notmatch '(?i)taskkill|Stop-Process\s+-Name') 'no kill by image name'
    # The guards also see the array form ('logcat','-c') and the long option; samples prove the patterns themselves.
    $rxLogcatClear = '(?i)logcat[^\r\n]*(?<![\w-])(-c|--clear)(?![\w-])'
    $rxPmClear = '(?i)(?<![\w$-])pm(\s+|[''"]?\s*,\s*[''"]?)clear(?![\w-])'
    foreach ($bad in @('adb shell logcat -c', '@(''shell'', ''logcat'', ''-c'')', '''logcat'',''-c''', '@(''logcat'', ''--clear'')', 'logcat -b all --clear')) {
        Assert ($bad -match $rxLogcatClear) ('guard: logcat clear sample is caught: ' + $bad)
    }
    foreach ($ok in @('logcat -b crash,main -d -v threadtime -T x', '-CdpScript $x -c1 logcat', '''logcat'', ''-d''')) {
        Assert ($ok -notmatch $rxLogcatClear) ('guard: logcat read sample is allowed: ' + $ok)
    }
    foreach ($bad in @('pm clear io.x', '@(''shell'', ''pm'', ''clear'', $p)', '''pm'',''clear''', '"pm", "clear"')) {
        Assert ($bad -match $rxPmClear) ('guard: pm clear sample is caught: ' + $bad)
    }
    Assert ('$pm = [regex]::Match($mem.Out, ''clear'')' -notmatch $rxPmClear) 'guard: a variable named pm is not pm clear'
    Assert ($code -notmatch $rxLogcatClear) 'no logcat -c or --clear'
    Assert ($code -notmatch $rxPmClear) 'no pm clear'
    Assert ($code -notmatch '(?i)(Get-Content|ReadAllText|Select-String)[^\r\n]*(key\.txt|keystore\.properties)') 'no reads of signing material'

    # the default adb forward range of the scripts lies inside lane A's reservation (6000 to 6399) and outside both phone ranges
    # (phone 1 6270 to 6309, phone 2 6310 to 6329), and every script that has -PortMin/-PortMax agrees
    foreach ($ps in @('cold-start.ps1', 'import-bin.ps1')) {
        $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $RunnerDir $ps), [ref]$null, [ref]$null)
        $dflt = @{}
        foreach ($pa in $ast.ParamBlock.Parameters) { $dflt[$pa.Name.VariablePath.UserPath] = $pa.DefaultValue.Value }
        $pmin = [int]$dflt['PortMin']
        $pmax = [int]$dflt['PortMax']
        Assert ($pmin -ge 6000 -and $pmax -le 6399 -and $pmin -le $pmax -and ($pmax -lt 6270 -or $pmin -gt 6329)) ('ports: ' + $ps + ' defaults ' + $pmin + '-' + $pmax + ' are inside lane A and clear of both phone ranges')
    }
    Assert (@(Get-ChildItem -LiteralPath $RunnerDir -Filter '*.ps1' -File | Where-Object { [IO.File]::ReadAllText($_.FullName) -match '\b95\d\d\b' }).Count -eq 0) 'ports: no script mentions the former 95xx default range'
    # the mock endpoint's default port lies inside lane A's reservation and clear of both phone ranges and the script-default range
    $mrAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $RunnerDir 'mock-reverse.ps1'), [ref]$null, [ref]$null)
    $mrPort = [int](($mrAst.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'Port' }).DefaultValue.Value)
    Assert ($mrPort -ge 6000 -and $mrPort -le 6399 -and ($mrPort -lt 6270 -or $mrPort -gt 6399)) ('ports: mock-reverse default port ' + $mrPort + ' is inside lane A and clear of both phone ranges and the 6330-6399 script defaults')

    # sign-install: the persistent test keystore is created once, reused by every later run and never deleted.
    # A small APK is cut from the built release APK (manifest and resources only) and a fake adb accepts the install.
    $siApkSource = Join-Path $PSScriptRoot '..\..\..\..\src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk'
    $siJdk = 'C:\Users\yor42\.gradle\jdks\azul_systems__inc_-21-amd64-windows.2'
    $siBuildTools = if ($env:ANDROID_HOME) { Get-ChildItem (Join-Path $env:ANDROID_HOME 'build-tools') -Directory -ErrorAction SilentlyContinue | Sort-Object { [version]($_.Name -replace '[^\d.].*$', '') } | Select-Object -Last 1 } else { $null }
    if (-not (Test-Path -LiteralPath $siApkSource) -or -not (Test-Path -LiteralPath $siJdk) -or -not $siBuildTools) {
        Write-Output 'SKIP sign-install keystore tests: the built release APK, the JDK or the Android build-tools are missing'
    } else {
        $siDir = Join-Path $work 'sign-install-key'
        New-Item -ItemType Directory -Force -Path $siDir | Out-Null
        $siSmallApk = Join-Path $siDir 'small.apk'
        Add-Type -AssemblyName System.IO.Compression
        $siSrc = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $siApkSource).Path)
        $siDst = [IO.Compression.ZipFile]::Open($siSmallApk, 'Create')
        foreach ($siName in @('AndroidManifest.xml', 'resources.arsc')) {
            $siEntry = $siSrc.GetEntry($siName)
            if ($siEntry) {
                $siNew = $siDst.CreateEntry($siName, 'NoCompression')
                $siIn = $siEntry.Open(); $siOut = $siNew.Open(); $siIn.CopyTo($siOut); $siOut.Dispose(); $siIn.Dispose()
            }
        }
        $siDst.Dispose(); $siSrc.Dispose()
        $siFakeAdb = Join-Path $siDir 'fakeadb.cmd'
        New-Cmd $siFakeAdb @(
            '@echo off',
            'echo %* | findstr /c:"get-state" >nul',
            'if not errorlevel 1 (echo device& exit /b 0)',
            'echo %* | findstr /c:"pm path" >nul',
            'if not errorlevel 1 (echo package:/data/app/x/base.apk& exit /b 0)',
            'echo %* | findstr /c:"run-as" >nul',
            'if not errorlevel 1 (echo uid=10000& exit /b 0)',
            'echo %* | findstr /c:" install " >nul',
            'if not errorlevel 1 (echo Success& exit /b 0)',
            'exit /b 0')
        $siKeystore = Join-Path (Join-Path $siDir ('testks-' + [guid]::NewGuid().ToString('N'))) 'test-release.p12'
        function Invoke-SignInstallForKeyTest([string]$RunName, [string]$Keystore = $siKeystore) {
            $text = (& pwsh -NoProfile -File (Join-Path $RunnerDir 'sign-install.ps1') -OutDir (Join-Path $siDir $RunName) -Kind release -Apk $siSmallApk `
                -AdbExe $siFakeAdb -TestKeystore $Keystore -MaxSeconds 240 | Out-String)
            $digest = if ($text -match 'test-key-sha256=([0-9a-f]{64})') { $Matches[1] } else { $null }
            return [pscustomobject]@{ Exit = $LASTEXITCODE; Text = $text; Digest = $digest; Signed = (Join-Path (Join-Path $siDir $RunName) 'signed.apk') }
        }
        $siRun1 = Invoke-SignInstallForKeyTest 'run1'
        $siHash1 = if (Test-Path -LiteralPath $siKeystore) { (Get-FileHash -LiteralPath $siKeystore -Algorithm SHA256).Hash } else { $null }
        $siRun2 = Invoke-SignInstallForKeyTest 'run2'
        $siHash2 = if (Test-Path -LiteralPath $siKeystore) { (Get-FileHash -LiteralPath $siKeystore -Algorithm SHA256).Hash } else { $null }
        Assert ($siRun1.Exit -eq 0 -and $siRun2.Exit -eq 0 -and $siRun1.Text -match 'verdict=pass' -and $siRun2.Text -match 'verdict=pass') 'sign-install: both signing runs pass'
        Assert ($siRun1.Text -match 'created=True' -and $siRun2.Text -match 'created=False') 'sign-install: the test keystore is created on the first run only'
        Assert ($siRun1.Digest -and $siRun1.Digest -eq $siRun2.Digest) 'sign-install: a second run prints the same test-key certificate SHA-256'
        Assert ($siHash1 -and $siHash1 -eq $siHash2) 'sign-install: the test keystore is not deleted or rewritten by the second run'
        $savedJavaHome = $env:JAVA_HOME
        $env:JAVA_HOME = $siJdk
        $siCerts = (& (Join-Path $siBuildTools.FullName 'apksigner.bat') verify --print-certs $siRun2.Signed | Out-String)
        $env:JAVA_HOME = $savedJavaHome
        Assert ($siRun2.Digest -and $siCerts -match ('(?i)certificate SHA-256 digest: ' + $siRun2.Digest)) 'sign-install: the second run signs the APK with the printed test key'
        Assert ((Test-Path -LiteralPath (Join-Path $siDir 'run2')) -and @(Get-ChildItem -LiteralPath (Join-Path $siDir 'run2') -Directory -Filter 'ks-*').Count -eq 0 -and (Test-Path -LiteralPath $siKeystore)) 'sign-install: no per-run keystore directory is left under the output directory and the test keystore stays'

        # first-run race: a valid keystore appears at the target after keytool finished and before the move; it must survive untouched
        $siKeytoolExe = Join-Path $siJdk 'bin\keytool.exe'
        $siRaceDir = Join-Path $siDir 'race'
        New-Item -ItemType Directory -Force -Path $siRaceDir | Out-Null
        $siRaceSource = Join-Path $siRaceDir 'winner.p12'
        $null = & $siKeytoolExe -genkeypair -keystore $siRaceSource -storetype PKCS12 -storepass 'risu-test-key' -keypass 'risu-test-key' -alias 'risu-test' -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=risu-test' 2>&1
        $siRaceTarget = Join-Path (Join-Path $siRaceDir 'target') 'test-release.p12'
        $siRaceSourceHash = (Get-FileHash -LiteralPath $siRaceSource -Algorithm SHA256).Hash
        $env:RISU_TEST_KEYSTORE_RACE_SOURCE = $siRaceSource
        try { $siRaceRun = Invoke-SignInstallForKeyTest 'race' $siRaceTarget } finally { Remove-Item Env:\RISU_TEST_KEYSTORE_RACE_SOURCE -ErrorAction SilentlyContinue }
        $siRaceHash = if (Test-Path -LiteralPath $siRaceTarget) { (Get-FileHash -LiteralPath $siRaceTarget -Algorithm SHA256).Hash } else { $null }
        Assert ($siRaceRun.Exit -eq 0 -and $siRaceRun.Text -match 'verdict=pass' -and $siRaceRun.Text -match 'created=False') 'sign-install race: the loser passes and reports it did not create the keystore'
        Assert ($siRaceHash -and $siRaceHash -eq $siRaceSourceHash) 'sign-install race: the keystore that appeared first survives with the same digest'
        Assert (@(Get-ChildItem -LiteralPath (Split-Path -Parent $siRaceTarget) -Force | Where-Object { $_.Name -ne 'test-release.p12' }).Count -eq 0) 'sign-install race: the loser leaves no temporary keystore file behind'

        # keytool failure: no keystore and no temporary file remain, and the run fails with the keytool exit
        $siFailTarget = Join-Path (Join-Path $siDir 'keytoolfail-ks') 'test-release.p12'
        $env:JAVA_TOOL_OPTIONS = '-Xbogusoption'
        try { $siFailRun = Invoke-SignInstallForKeyTest 'keytoolfail' $siFailTarget } finally { Remove-Item Env:\JAVA_TOOL_OPTIONS -ErrorAction SilentlyContinue }
        Assert ($siFailRun.Exit -eq 1 -and $siFailRun.Text -match 'verdict=fail' -and $siFailRun.Text -match 'keytool exit') 'sign-install keytool failure: the run fails with the keytool exit'
        Assert (-not (Test-Path -LiteralPath $siFailTarget) -and @(Get-ChildItem -LiteralPath (Split-Path -Parent $siFailTarget) -Force).Count -eq 0) 'sign-install keytool failure: no keystore and no temporary file are left'

        # release key location: a -TestKeystore under %USERPROFILE%\.risu-signing is refused (USERPROFILE points at scratch here)
        $siFakeProfile = Join-Path $siDir 'fakeprofile'
        $siReleaseLike = Join-Path (Join-Path $siFakeProfile '.risu-signing') 'test-release.p12'
        $savedUserProfile = $env:USERPROFILE
        $env:USERPROFILE = $siFakeProfile
        try { $siRefuseRun = Invoke-SignInstallForKeyTest 'refuse' $siReleaseLike } finally { $env:USERPROFILE = $savedUserProfile }
        Assert ($siRefuseRun.Exit -eq 1 -and $siRefuseRun.Text -match 'verdict=fail' -and $siRefuseRun.Text -match 'release key location') 'sign-install: a -TestKeystore under the release key location is refused'
        Assert (-not (Test-Path -LiteralPath (Join-Path $siFakeProfile '.risu-signing'))) 'sign-install: the refused path creates nothing'
    }

    # -Fast skips the sections the stage 4 and lock tests do not depend on; it is for scratch mutant runs only.
    if (-not $Fast) {
    # quoting
    Assert ((ConvertTo-QuotedArg 'a b') -eq '"a b"') 'quote: space'
    Assert ((ConvertTo-QuotedArg 'C:\x y\') -eq '"C:\x y\\"') 'quote: trailing backslash doubled'
    Assert ((ConvertTo-QuotedArg 'plain') -eq 'plain') 'quote: plain unchanged'

    # lock
    $lock = Join-Path $work 'x.lock'
    Assert (Enter-Lock $lock) 'lock: first acquire'
    Assert (-not (Enter-Lock $lock)) 'lock: second acquire refused while held'
    Exit-Lock $lock
    Assert (-not (Test-Path -LiteralPath $lock)) 'lock: released'
    [IO.File]::WriteAllText($lock, '99999999,1')
    Assert (Enter-Lock $lock) 'lock: stale lock of a dead process is replaced'
    Exit-Lock $lock

    # lock: two waiters that both judge the same lock stale must not both take it. Waiter B judges the stale holder, waiter A
    # (a nested Enter-Lock from inside B's judgment) replaces the lock and holds it, then B acts on its earlier judgment.
    $origJudge = ${function:Test-LockTextHeld}
    $raceLock = Join-Path $work 'race.lock'
    $script:raceFirst = $true
    $script:raceLockPath = $raceLock
    $script:raceA = $null
    [IO.File]::WriteAllText($raceLock, '99999991,5')
    function Test-LockTextHeld([string]$Txt) {
        if ($script:raceFirst) {
            $script:raceFirst = $false
            $script:raceA = Enter-Lock $script:raceLockPath
        }
        return (& $script:origJudgeBlock $Txt)
    }
    $script:origJudgeBlock = $origJudge
    $raceB = Enter-Lock $raceLock
    $raceText = ''
    if (Test-Path -LiteralPath $raceLock) { $raceText = [IO.File]::ReadAllText($raceLock) }
    if ($origJudge) { Set-Item -Path function:Test-LockTextHeld -Value $origJudge } else { Remove-Item -Path function:Test-LockTextHeld -ErrorAction SilentlyContinue }
    Assert ($script:raceA -eq $true -and $raceB -eq $false -and $raceText -match ('^' + $PID + ',')) 'lock race: a second waiter that judged the same stale lock does not remove the fresh lock the first waiter created'
    Exit-Lock $raceLock
    Assert (-not (Test-Path -LiteralPath $raceLock)) 'lock race: the winner releases its lock normally'

    # lock: the stale lock is moved to a tombstone named after its holder; an old tombstone is removed at the next replacement
    $tombLock = Join-Path $work 'tomb.lock'
    [IO.File]::WriteAllText($tombLock, '99999992,7')
    $oldTomb = $tombLock + '.stale-99999990-1'
    [IO.File]::WriteAllText($oldTomb, '99999990,1')
    (Get-Item -LiteralPath $oldTomb).LastWriteTimeUtc = (Get-Date).ToUniversalTime().AddMinutes(-30)
    Assert (Enter-Lock $tombLock) 'lock tombstone: a stale lock is replaced'
    Assert ((Test-Path -LiteralPath ($tombLock + '.stale-99999992-7')) -and -not (Test-Path -LiteralPath $oldTomb)) 'lock tombstone: the replaced lock is kept under its holder name and a tombstone older than 10 minutes is removed'
    Exit-Lock $tombLock
    [IO.File]::WriteAllText($tombLock, '99999992,7')
    $reRemoved = $null
    try { $reRemoved = Remove-StaleLock $tombLock '99999992,7' } catch { }
    Assert ($reRemoved -eq $false -and (Test-Path -LiteralPath $tombLock)) 'lock tombstone: a second claim on the same stale holder is refused and leaves the file as it was'
    Remove-Item -LiteralPath $tombLock -Force

    # lock: a waiter that cleans up tombstones right after another waiter's move must not remove the new tombstone. A stale lock
    # older than 10 minutes is moved by A; B (same stale judgment) runs its cleanup before A does anything more; A then takes the
    # lock; C (same stale judgment) must not move A's live lock away.
    $origMove = ${function:Move-LockFile}
    $winLock = Join-Path $work 'win.lock'
    $winText = '99999991,5'
    [IO.File]::WriteAllText($winLock, $winText)
    (Get-Item -LiteralPath $winLock).LastWriteTimeUtc = (Get-Date).ToUniversalTime().AddHours(-2)
    $script:winOrig = $origMove
    $script:winFirst = $true
    $script:winLockPath = $winLock
    $script:winText = $winText
    $script:winB = $null
    function Move-LockFile([string]$From, [string]$To) {
        & $script:winOrig $From $To
        if ($script:winFirst) {
            $script:winFirst = $false
            $script:winB = Remove-StaleLock $script:winLockPath $script:winText
        }
    }
    $winA = Remove-StaleLock $winLock $winText
    $winAHeld = Enter-Lock $winLock
    $winC = Remove-StaleLock $winLock $winText
    $winLive = $false
    if (Test-Path -LiteralPath $winLock) { $winLive = ([IO.File]::ReadAllText($winLock) -match ('^' + $PID + ',')) }
    Set-Item -Path function:Move-LockFile -Value $origMove
    Assert ($winA -eq $true -and $script:winB -eq $false -and $winAHeld -eq $true -and $winC -eq $false -and $winLive) 'lock window: a cleanup between a waiter''s move and its next step neither removes the tombstone nor lets a third waiter move the new lock away'
    Exit-Lock $winLock

    # import-bin default -WarnPattern: it must match the start of both store2 warnings (time and size) in the English and Korean
    # UI; a pattern that misses the time warning leaves the run waiting for a manual tap.
    $ibAst = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $RunnerDir 'import-bin.ps1'), [ref]$null, [ref]$null)
    $ibParam = $ibAst.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'WarnPattern' }
    $ibDefault = [string]$ibParam.DefaultValue.Value
    # The Korean samples are the openings of store2ImportTimeWarning and store2ImportSizeWarning in ko.ts; ~uXXXX is a code point.
    $koTime = '~uC774 ~uBC31~uC5C5~uC5D0~uB294 ~uD30C~uC77C~uC774 18101~uAC1C ~uB4E4~uC5B4 ~uC788~uC2B5~uB2C8~uB2E4.'
    $koSize = '~uC774 ~uBC31~uC5C5~uC5D0 ~uB4E4~uC5B4 ~uC788~uB294 ~uB370~uC774~uD130~uB294 ~uC774~uBBF8~uC9C0~uC640 ~uAE30~uD0C0 ~uD30C~uC77C~uC744 ~uC81C~uC678~uD558~uACE0 ~uC57D 900 MB~uC785~uB2C8~uB2E4.'
    $warnTexts = @(
        'This backup holds 18101 files. From now, importing it on this phone may take about 15 minutes, or longer.',
        'The saved data in this backup, not counting images and other files, is about 900 MB. Continue?',
        [regex]::Replace($koTime, '~u([0-9A-F]{4})', { param($m) [string][char][Convert]::ToInt32($m.Groups[1].Value, 16) }),
        [regex]::Replace($koSize, '~u([0-9A-F]{4})', { param($m) [string][char][Convert]::ToInt32($m.Groups[1].Value, 16) })
    )
    $warnAll = $true
    foreach ($wt in $warnTexts) { if ($wt -notmatch $ibDefault) { $warnAll = $false } }
    Assert ($warnAll -and $warnTexts.Count -eq 4) 'import-bin warn pattern: the default matches the time warning and the size warning in English and Korean'
    Assert ('Keep the app open until it finishes.' -notmatch $ibDefault) 'import-bin warn pattern: the default does not match an ordinary notice'

    # schema
    $s = New-Result -CheckId 't' -BuildKind 'debug' -CapSec 5 -Repo $work -Serial $null
    $s.build.kind = 'bogus'
    Assert ((Test-ResultSchema $s).Count -gt 0) 'schema: bad build kind rejected'
    $s.build.kind = 'debug'
    Assert ((Test-ResultSchema $s).Count -eq 0) 'schema: running result valid'
    $s.Remove('device')
    Assert ((Test-ResultSchema $s).Count -gt 0) 'schema: missing device rejected'
    $s2 = New-Result -CheckId 't' -BuildKind 'debug' -CapSec 5 -Repo $work -Serial $null
    $s2.build.artifactPath = 'x.apk'
    Assert ((Test-ResultSchema $s2).Count -gt 0) 'schema: artifact without apkSha256 rejected'
    $s2.build.apkSha256 = 'AB'
    Assert ((Test-ResultSchema $s2).Count -eq 0) 'schema: artifact with apkSha256 valid'

    # tracker: a reused PID must not pull unrelated children into the tracked set
    $me = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $PID)
    $kid = Start-Process -FilePath 'ping' -ArgumentList '-n 30 127.0.0.1' -RedirectStandardOutput (Join-Path $work 'k1.out') -NoNewWindow -PassThru
    $script:spawned += $kid.Id
    $trk = New-Tracker
    $trk.Known[[int]$PID] = @{ Name = 'reused'; Created = $me.CreationDate.AddMinutes(-30) }
    Update-Tracker $trk
    Assert (-not $trk.Known.ContainsKey([int]$kid.Id)) 'tracker: children of a reused PID are not adopted'
    $trk2 = New-Tracker
    $trk2.Known[[int]$PID] = @{ Name = 'genuine'; Created = $me.CreationDate.AddSeconds(-2) }
    Update-Tracker $trk2
    Assert ($trk2.Known.ContainsKey([int]$kid.Id)) 'tracker: children of the genuine parent are adopted'
    $trk3 = New-Tracker
    $trk3.Known[[int]$kid.Id] = @{ Name = 'old'; Created = $me.CreationDate.AddMinutes(-30) }
    Assert (@(Get-AliveTracked $trk3).Count -eq 0) 'tracker: a live PID with another creation time is not alive-tracked'
    $trk3.Known[[int]$kid.Id] = @{ Name = 'ping'; Created = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $kid.Id)).CreationDate }
    $al = @(Get-AliveTracked $trk3)
    Assert ($al.Count -eq 1 -and $al[0].created -match '^\d{4}-\d\d-\d\dT') 'tracker: alive entry carries an ISO created time'
    Stop-Process -Id $kid.Id -Force -ErrorAction SilentlyContinue

    # an exception in the poll loop stops the tree it started and propagates
    # The ping count is unique to this process id, so a parallel run's children are never matched, adopted or killed.
    $pingN = 100000 + $PID
    New-Cmd (Join-Path $childDir 'tickthrow.cmd') @('@echo off', ('start /b ping -n ' + $pingN + ' 127.0.0.1 > nul'), ('ping -n ' + $pingN + ' 127.0.0.1 > nul'))
    $threw = $null
    try {
        $null = Invoke-TrackedProcess -FilePath (Join-Path $childDir 'tickthrow.cmd') -StdoutPath (Join-Path $work 'tt.out') `
            -StderrPath (Join-Path $work 'tt.err') -StdinPath (Join-Path $work 'tt.in') -MaxSeconds 30 -PollMs 500 -OnTick { throw 'tick boom' }
    } catch { $threw = $_.Exception.Message }
    $leaks = @(Get-CimInstance Win32_Process -Filter 'Name="ping.exe"' | Where-Object { $_.CommandLine -match ('-n ' + $pingN + ' ') })
    foreach ($lk in $leaks) { $script:spawned += [int]$lk.ProcessId }
    Assert ($threw -eq 'tick boom') 'poll loop: OnTick exception propagates'
    Assert ($leaks.Count -eq 0) 'poll loop: OnTick exception leaves no live child'

    # sign-release: every outside effect (vault, build, apksigner, adb) is a scriptblock or mocked function, so no vault, Gradle or phone is touched.
    # The script is dot-sourced inside a child scope: its functions load, its main body does not run and its parameters stay out of this scope.
    & {
        . (Join-Path $RunnerDir 'sign-release.ps1')
        $fakeVals = @{ RisuKeystorePath = $null; RisuKeystorePassword = 'FAKEPW-ks-91d3'; RisuKeyAlias = 'fakealias-77'; RisuKeyPassword = 'FAKEPW-key-4c0e' }
        $srDir = Join-Path $work 'sign-release'
        New-Item -ItemType Directory -Force -Path $srDir | Out-Null
        $srKs = Join-Path $srDir 'fake-ks-file.jks'
        [IO.File]::WriteAllText($srKs, 'not a keystore')
        $fakeVals.RisuKeystorePath = $srKs
        $srApk = Join-Path $srDir 'app-universal-release.apk'
        [IO.File]::WriteAllText($srApk, 'fake apk bytes')
        $srNames = @('RisuKeystorePath', 'RisuKeystorePassword', 'RisuKeyAlias', 'RisuKeyPassword')
        $srDigest = ('ab12' * 16)
        $srEnvNames = @('RISU_ANDROID_KEYSTORE', 'RISU_ANDROID_KEYSTORE_PASSWORD', 'RISU_ANDROID_KEY_ALIAS', 'RISU_ANDROID_KEY_PASSWORD')
        $okReader = { param($v, $n) $fakeVals[$n] }
        $noPre = { $null }
        $okVerify = { param($apk) $srDigest }
        $seen = @{}
        $okBuild = { foreach ($e in $srEnvNames) { $seen[$e] = [Environment]::GetEnvironmentVariable($e) }; [pscustomobject]@{ ExitCode = 0; ApkPath = $srApk; Reason = $null } }
        foreach ($e in $srEnvNames) { Remove-Item -LiteralPath ('Env:\' + $e) -ErrorAction SilentlyContinue }

        # refusals: an agent shell, then a host without interactive input; the agent reason is never masked
        $rf1 = Get-SigningRefusal $true $true
        $rf2 = Get-SigningRefusal $false $false
        $rf3 = Get-SigningRefusal $true $false
        Assert ($rf1 -match 'agent shell' -and $rf2 -match 'no interactive host' -and $rf3 -match 'agent shell' -and $null -eq (Get-SigningRefusal $false $true)) 'sign-release: an agent shell and a non-interactive host are refused, an interactive normal shell is not'
        $savedCc = $env:CLAUDECODE; $savedCe = $env:CLAUDE_CODE_ENTRYPOINT
        foreach ($agentVar in @('CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT')) {
            Remove-Item Env:\CLAUDECODE, Env:\CLAUDE_CODE_ENTRYPOINT -ErrorAction SilentlyContinue
            [Environment]::SetEnvironmentVariable($agentVar, '1')
            $agentText = (& pwsh -NoProfile -File (Join-Path $RunnerDir 'sign-release.ps1') -OutDir (Join-Path $srDir 'agent-out') | Out-String)
            $agentCode = $LASTEXITCODE
            Assert ($agentCode -eq 1 -and $agentText -match 'verdict=FAIL' -and $agentText -match 'agent shell' -and $agentText -notmatch 'secrets|vault RisuSigning') ('sign-release: the script exits 1 in an agent shell (' + $agentVar + ') before it touches the vault')
        }
        Remove-Item Env:\CLAUDECODE, Env:\CLAUDE_CODE_ENTRYPOINT -ErrorAction SilentlyContinue
        if ($savedCc) { $env:CLAUDECODE = $savedCc }
        if ($savedCe) { $env:CLAUDE_CODE_ENTRYPOINT = $savedCe }

        # missing secrets: only the names are reported, the other values never appear, and no build starts
        $built = @{ v = $false }
        $partial = { param($v, $n) if ($n -eq 'RisuKeyPassword') { throw 'secret not found FAKEPW-key-4c0e' }; if ($n -eq 'RisuKeyAlias') { return '' }; $fakeVals[$n] }
        $mr = Invoke-SignRelease -VaultName 'RisuSigning' -SecretNames $srNames -Reader $partial -Preflight $noPre -Builder { $built.v = $true } -Verifier $okVerify
        Assert (-not $mr.Pass -and $mr.Reason -match 'RisuKeyAlias' -and $mr.Reason -match 'RisuKeyPassword' -and $mr.Reason -notmatch 'RisuKeystorePassword|RisuKeystorePath' -and $mr.Reason -notmatch 'FAKEPW|fakealias' -and -not $built.v) 'sign-release: missing or empty secrets are named by secret name only and stop before the build'
        $mr2 = Invoke-SignRelease -VaultName 'RisuSigning' -SecretNames $srNames -Reader { param($v, $n) if ($n -eq 'RisuKeystorePath') { Join-Path $srDir 'no-such.jks' } else { 'x' } } -Preflight $noPre -Builder { $built.v = $true } -Verifier $okVerify
        Assert (-not $mr2.Pass -and $mr2.Reason -match 'RisuKeystorePath' -and $mr2.Reason -notmatch 'no-such' -and -not $built.v) 'sign-release: a keystore path that does not exist fails before the build without echoing the path'
        $readerCalled = @{ v = $false }
        $pr = Invoke-SignRelease -VaultName 'RisuSigning' -SecretNames $srNames -Reader { $readerCalled.v = $true; 'x' } -Preflight { 'generated Android files missing' } -Builder { $built.v = $true } -Verifier $okVerify
        Assert (-not $pr.Pass -and $pr.Reason -match 'generated Android files' -and -not $built.v -and -not $readerCalled.v) 'sign-release: a failed build preflight stops before any secret is read'

        # happy path: the child build sees the four values, nothing else does, and they are gone afterwards
        $outText = (& {
            $script:ok = Invoke-SignRelease -VaultName 'RisuSigning' -SecretNames $srNames -Reader $okReader -Preflight $noPre -Builder $okBuild -Verifier $okVerify
        } *>&1 | Out-String)
        $allText = $outText + ($script:ok | ConvertTo-Json -Depth 4)
        Assert ($script:ok.Pass -and $script:ok.CertSha256 -eq $srDigest -and $script:ok.ApkSha256 -match '^[0-9a-f]{64}$' -and $script:ok.ApkPath -eq $srApk) 'sign-release: a verified build passes with the APK path, APK sha256 and certificate digest'
        Assert ($seen['RISU_ANDROID_KEYSTORE'] -eq $srKs -and $seen['RISU_ANDROID_KEYSTORE_PASSWORD'] -eq 'FAKEPW-ks-91d3' -and $seen['RISU_ANDROID_KEY_ALIAS'] -eq 'fakealias-77' -and $seen['RISU_ANDROID_KEY_PASSWORD'] -eq 'FAKEPW-key-4c0e') 'sign-release: the build child sees all four values as environment variables'
        Assert (@($srEnvNames | Where-Object { $null -ne [Environment]::GetEnvironmentVariable($_) }).Count -eq 0) 'sign-release: the signing environment is cleared after a successful run'
        Assert ($allText -notmatch 'FAKEPW|fakealias' -and $allText -notmatch [regex]::Escape($srKs)) 'sign-release: no secret value appears in any output stream or in the result'
        $seen.Clear()
        $thrown = $null
        try { $null = Invoke-SignRelease -VaultName 'RisuSigning' -SecretNames $srNames -Reader $okReader -Preflight $noPre -Builder { throw 'boom' } -Verifier $okVerify } catch { $thrown = $_.Exception.Message }
        Assert ($thrown -eq 'boom' -and @($srEnvNames | Where-Object { $null -ne [Environment]::GetEnvironmentVariable($_) }).Count -eq 0) 'sign-release: the signing environment is cleared when the build throws'
        $bf = Invoke-SignRelease -VaultName 'RisuSigning' -SecretNames $srNames -Reader $okReader -Preflight $noPre -Builder { [pscustomobject]@{ ExitCode = 3; ApkPath = $srApk; Reason = 'build failed' } } -Verifier $okVerify
        Assert (-not $bf.Pass -and $bf.Reason -eq 'build failed' -and $null -eq $bf.CertSha256 -and @($srEnvNames | Where-Object { $null -ne [Environment]::GetEnvironmentVariable($_) }).Count -eq 0) 'sign-release: a failed build fails the run and also clears the environment'

        # expected certificate fingerprint
        $expFile = Join-Path $srDir 'expected-cert-sha256.txt'
        $colon = ((($srDigest.ToUpperInvariant() -split '(..)') | Where-Object { $_ }) -join ':')
        [IO.File]::WriteAllText($expFile, $colon + "`n")
        $e1 = Invoke-SignRelease -VaultName 'RisuSigning' -SecretNames $srNames -Reader $okReader -Preflight $noPre -Builder $okBuild -Verifier $okVerify -ExpectedFile $expFile
        Assert ($e1.Pass) 'sign-release: a matching expected fingerprint (colon form, upper case) passes'
        [IO.File]::WriteAllText($expFile, (('cd34' * 16) + "`n"))
        $e2 = Invoke-SignRelease -VaultName 'RisuSigning' -SecretNames $srNames -Reader $okReader -Preflight $noPre -Builder $okBuild -Verifier $okVerify -ExpectedFile $expFile
        Assert (-not $e2.Pass -and $e2.Reason -match 'certificate mismatch' -and $e2.CertSha256 -eq $srDigest) 'sign-release: a different certificate than the expected fingerprint fails the run'
        [IO.File]::WriteAllText($expFile, "not a fingerprint`n")
        $e3 = Invoke-SignRelease -VaultName 'RisuSigning' -SecretNames $srNames -Reader $okReader -Preflight $noPre -Builder $okBuild -Verifier $okVerify -ExpectedFile $expFile
        Assert (-not $e3.Pass -and $e3.Reason -match 'does not hold a SHA-256 fingerprint') 'sign-release: an unreadable expected-fingerprint file fails instead of skipping the check'
        $e4 = Invoke-SignRelease -VaultName 'RisuSigning' -SecretNames $srNames -Reader $okReader -Preflight $noPre -Builder $okBuild -Verifier $okVerify -ExpectedFile (Join-Path $srDir 'absent.txt')
        Assert ($e4.Pass -and $e4.FingerprintCheck -eq 'none' -and $e1.FingerprintCheck -eq 'match' -and $e2.FingerprintCheck -eq 'failed') 'sign-release: no expected-fingerprint file is reported as fingerprintCheck none, a match as match and a mismatch as failed'
        $fpOut = (& { Write-FingerprintStatus $e4 'C:\x\expected-cert-sha256.txt' } 3>&1 | Out-String)
        $fpOk = (& { Write-FingerprintStatus $e1 'C:\x\expected-cert-sha256.txt' } 3>&1 | Out-String)
        Assert ($fpOut -match 'fingerprintCheck=none' -and $fpOut -match 'NOT compared' -and $fpOk -match 'fingerprintCheck=match' -and $fpOk -notmatch 'NOT compared') 'sign-release: a missing expected-fingerprint file prints fingerprintCheck=none with a visible warning, a match prints no warning'
        $vf = Invoke-SignRelease -VaultName 'RisuSigning' -SecretNames $srNames -Reader $okReader -Preflight $noPre -Builder $okBuild -Verifier { throw 'apksigner verify failed with exit 1' }
        Assert (-not $vf.Pass -and $vf.Reason -match 'signature verification failed') 'sign-release: an APK that apksigner rejects fails the run'

        # build: the call requests a no-daemon Gradle and lingering-process cleanup; leftovers are stopped on success and on a throw
        $fakeRunCheck = Join-Path $srDir 'fake-run-check.ps1'
        New-Cmd $fakeRunCheck @(
            'param([string]$CheckId, [string]$OutDir, [int]$MaxSeconds, [string]$FilePath, [string[]]$ArgumentList, [string]$WorkingDirectory, [string]$BuildKind, [hashtable]$Environment, [string]$ArtifactPath, [string]$RepoRoot, [switch]$KillLingering)',
            '[IO.File]::WriteAllText((Join-Path $OutDir "rc.json"), (@{ KillLingering = $KillLingering.IsPresent; GradleOpts = [string]$Environment["GRADLE_OPTS"] } | ConvertTo-Json))',
            'exit 0')
        $savedGradleOpts = $env:GRADLE_OPTS
        $env:GRADLE_OPTS = '-Xmx1g -Dorg.gradle.daemon=true'
        $rbOut = Join-Path $srDir 'rb-out'
        $rb = Invoke-ReleaseBuild $srDir $rbOut (Join-Path $srDir 'rb-scratch') (Join-Path $srDir 'rb-cargo') 60 'aarch64' $fakeRunCheck 'C:\fake\pnpm.cmd'
        if ($null -ne $savedGradleOpts) { $env:GRADLE_OPTS = $savedGradleOpts } else { Remove-Item Env:\GRADLE_OPTS -ErrorAction SilentlyContinue }
        $rc = Get-Content -LiteralPath (Join-Path $rbOut 'rc.json') -Raw | ConvertFrom-Json
        Assert ($rb.ExitCode -eq 0 -and $rc.KillLingering -eq $true) 'sign-release: the build call asks Run-Check to stop lingering processes'
        Assert ($rc.GradleOpts -match '-Dorg\.gradle\.daemon=false' -and $rc.GradleOpts -match '-Xmx1g' -and $rc.GradleOpts.LastIndexOf('daemon=false') -gt $rc.GradleOpts.LastIndexOf('daemon=true')) 'sign-release: the build runs Gradle without a daemon, keeps a user GRADLE_OPTS and the no-daemon setting wins'
        $cl = @{ n = 0 }
        $cleanup = { $cl.n++ }
        $null = Invoke-SignRelease -VaultName 'RisuSigning' -SecretNames $srNames -Reader $okReader -Preflight $noPre -Builder $okBuild -Verifier $okVerify -Cleanup $cleanup
        Assert ($cl.n -eq 1) 'sign-release: leftover build processes are stopped after a normal build'
        try { $null = Invoke-SignRelease -VaultName 'RisuSigning' -SecretNames $srNames -Reader $okReader -Preflight $noPre -Builder { throw 'boom' } -Verifier $okVerify -Cleanup $cleanup } catch { }
        Assert ($cl.n -eq 2 -and @($srEnvNames | Where-Object { $null -ne [Environment]::GetEnvironmentVariable($_) }).Count -eq 0) 'sign-release: leftover build processes are stopped when the build throws'
        $glRepo = Join-Path $srDir 'gl-repo'
        $glDir = Join-Path $glRepo 'src-tauri\gen\android'
        New-Item -ItemType Directory -Force -Path $glDir | Out-Null
        New-Cmd (Join-Path $glDir 'gradlew.bat') @('@echo off', 'echo %* > "%~dp0stop-args.txt"', 'exit /b 0')
        Stop-ReleaseBuildLeftovers $glRepo (Join-Path $srDir 'gl-work')
        Assert ((Test-Path -LiteralPath (Join-Path $glDir 'stop-args.txt')) -and ((Get-Content -LiteralPath (Join-Path $glDir 'stop-args.txt') -Raw) -match '--stop')) 'sign-release: the leftover cleanup runs gradlew --stop from the Android project'
        $glSentinelJava = 'C:\sentinel-java-home-before'
        $glSavedJava = $env:JAVA_HOME
        New-Cmd (Join-Path $glDir 'gradlew.bat') @('@echo off', 'echo %JAVA_HOME%> "%~dp0stop-java-home.txt"', 'exit /b 0')
        $env:JAVA_HOME = $glSentinelJava
        Stop-ReleaseBuildLeftovers $glRepo (Join-Path $srDir 'gl-work')
        $glAfterJava = $env:JAVA_HOME
        if ($null -ne $glSavedJava) { $env:JAVA_HOME = $glSavedJava } else { Remove-Item Env:\JAVA_HOME -ErrorAction SilentlyContinue }
        $glSeenJava = (Get-Content -LiteralPath (Join-Path $glDir 'stop-java-home.txt') -Raw).Trim()
        Assert ($glSeenJava -eq $script:SigningJdk -and $glAfterJava -eq $glSentinelJava) 'sign-release: the leftover cleanup stops Gradle with the JDK 21 and restores the caller JAVA_HOME afterwards'
        Assert ($rc.GradleOpts -match '-Dkotlin\.compiler\.execution\.strategy=in-process') 'sign-release: the build runs the Kotlin compiler in-process so no Kotlin daemon keeps the signing values'

        # cleanup ordering, failure and lock refusal
        $cleanupSeen = @{ vars = $null }
        $envCleanup = { $cleanupSeen.vars = @($srEnvNames | Where-Object { $null -ne [Environment]::GetEnvironmentVariable($_) }).Count }
        $null = Invoke-SignRelease -VaultName 'RisuSigning' -SecretNames $srNames -Reader $okReader -Preflight $noPre -Builder $okBuild -Verifier $okVerify -Cleanup $envCleanup
        Assert ($cleanupSeen.vars -eq 0) 'sign-release: the leftover cleanup runs only after the signing environment is cleared'
        $script:cf = $null
        $warnOut = (& { try { $script:cf = Invoke-SignRelease -VaultName 'RisuSigning' -SecretNames $srNames -Reader $okReader -Preflight $noPre -Builder $okBuild -Verifier $okVerify -Cleanup { throw 'cleanup-boom' } } catch { } } 3>&1 | Out-String)
        Assert ($script:cf.Pass -and $warnOut -match 'build cleanup failed' -and $warnOut -match 'cleanup-boom') 'sign-release: a failing cleanup only warns and the build verdict is still returned'
        $lockCleanups = @{ n = 0 }
        $lockCleanup = { $lockCleanups.n++ }
        $lockCargo = Join-Path $srDir 'lock-cargo'
        $lockHeld = Enter-Lock ($lockCargo + '.lock')
        $lockBuild = Invoke-ReleaseBuild $srDir (Join-Path $srDir 'lock-out') (Join-Path $srDir 'lock-scratch') $lockCargo 60 'aarch64' $fakeRunCheck 'C:\fake\pnpm.cmd'
        $lockRun = Invoke-SignRelease -VaultName 'RisuSigning' -SecretNames $srNames -Reader $okReader -Preflight $noPre -Builder { Invoke-ReleaseBuild $srDir (Join-Path $srDir 'lock-out') (Join-Path $srDir 'lock-scratch') $lockCargo 60 'aarch64' $fakeRunCheck 'C:\fake\pnpm.cmd' } -Verifier $okVerify -Cleanup $lockCleanup
        Exit-Lock ($lockCargo + '.lock')
        Assert ($lockHeld -and $lockBuild.Started -eq $false -and $lockBuild.ExitCode -eq 1 -and -not $lockRun.Pass -and $lockRun.Reason -match 'another release build holds' -and $lockCleanups.n -eq 0) 'sign-release: a build refused because another holds the lock runs no cleanup, so another build daemon is not stopped'

        # apksigner output as the real tool prints it
        # (build-tools 37.0.0 output for a v2-signed APK; a v1+v2+v3 APK lists the same certificate once per scheme; older tools print "Signer #1")
        $apksignerOut = "V2 Signer: certificate DN: CN=RisuTanium`r`nV2 Signer: certificate SHA-256 digest: " + $srDigest + "`r`nV2 Signer: certificate SHA-1 digest: 0da2f78ca412b1e537c3b03afd96e89f3c5d2323`r`nV2 Signer: certificate MD5 digest: 0dd6ed6945e6de81909b4b59ad950938`r`n"
        Assert ((Get-CertDigestFromText $apksignerOut) -eq $srDigest) 'sign-release: the signer certificate SHA-256 digest is read from apksigner --print-certs output'
        $multiOut = ('V1 Signer: certificate SHA-256 digest: ' + $srDigest.ToUpperInvariant() + "`nV2 Signer: certificate SHA-256 digest: " + $srDigest + "`nV3 Signer: certificate SHA-256 digest: " + $srDigest + "`n")
        Assert ((Get-CertDigestFromText $multiOut) -eq $srDigest -and (Get-CertDigestFromText ('Signer #1 certificate SHA-256 digest: ' + $srDigest + "`n")) -eq $srDigest) 'sign-release: the same certificate under several schemes, or the older "Signer #1" form, yields one digest'
        Assert ($null -eq (Get-CertDigestFromText ($multiOut + "V3.1 Signer: certificate SHA-256 digest: " + ('ee' * 32) + "`n")) -and $null -eq (Get-CertDigestFromText 'Verifies') -and $null -eq (Get-CertDigestFromText ("V2 Signer: certificate SHA-256 digest: nothex`n"))) 'sign-release: signers with different certificates, no signer or a malformed digest yield no digest'

        # install: a signature mismatch is refused without -AllowClear and nothing is uninstalled
        $adbCalls = [Collections.ArrayList]::new()
        function Initialize-Adb { param($Dir, $AdbExe) $true }
        function Get-DeviceState { param($Serial) 'device' }
        function Invoke-Adb {
            param($AdbArgs, $TimeoutSec, $Serial)
            $null = $adbCalls.Add(($Serial + ' ' + ($AdbArgs -join ' ')))
            if ($AdbArgs[0] -eq 'install' -and -not $script:uninstalled) { return [pscustomobject]@{ ExitCode = 1; TimedOut = $false; Out = ''; Err = 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match]' } }
            if ($AdbArgs[0] -eq 'uninstall') { $script:uninstalled = $true }
            return [pscustomobject]@{ ExitCode = 0; TimedOut = $false; Out = 'Success'; Err = '' }
        }
        $script:uninstalled = $false
        $i1 = Install-SignedApk $srApk 'FAKESERIAL' $false $srDir $null
        Assert ($i1 -match 'signature-mismatch' -and $i1 -match 'AllowClear' -and -not ($adbCalls -match 'uninstall') -and $adbCalls[0] -match '^FAKESERIAL install -r ') 'sign-release: -Install refuses a signature mismatch without -AllowClear, uses -s <serial> and uninstalls nothing'
        $adbCalls.Clear()
        $warnOut = (& { $script:i2 = Install-SignedApk $srApk 'FAKESERIAL' $true $srDir $null } 3>&1 | Out-String)
        Assert ($null -eq $script:i2 -and $warnOut -match 'WIPES' -and ($adbCalls -match 'uninstall io\.github\.yor42\.risutanium')) 'sign-release: -AllowClear warns that the data is wiped, then uninstalls and installs'
        Assert ((Install-SignedApk $srApk '' $false $srDir $null) -match 'explicit -Serial') 'sign-release: -Install without a serial is refused'

        # a vault that is not a SecretStore cannot be checked for a password, so it is refused before any secret is read
        function Get-Module { param($Name, [switch]$ListAvailable) 'fake' }
        function Import-Module { param($Name, $ErrorAction) }
        function Get-SecretVault { param($Name, $ErrorAction) [pscustomobject]@{ ModuleName = 'Some.Other.Vault' } }
        function Get-Secret { param($Vault, $Name, [switch]$AsPlainText, $ErrorAction) $script:secretRead = $true; 'x' }
        $script:VaultChecked = $false
        $script:secretRead = $false
        $nsErr = $null
        try { $null = Read-VaultSecret 'RisuSigning' 'RisuKeyAlias' } catch { $nsErr = $_.Exception.Message }
        Assert ($nsErr -match 'not a SecretStore vault' -and -not $script:secretRead) 'sign-release: a vault that is not a SecretStore is refused before any secret is read'
    }

    # build-apk records a failure when a prerequisite is missing
    $savedNdk = $env:NDK_HOME
    Remove-Item Env:\NDK_HOME -ErrorAction SilentlyContinue
    $bo = Join-Path $work 'build-nondk'
    $btext = (& pwsh -NoProfile -File (Join-Path $RunnerDir 'build-apk.ps1') -OutDir $bo -RepoRoot $work -ScratchRoot $work | Out-String)
    $bcode = $LASTEXITCODE
    if ($savedNdk) { $env:NDK_HOME = $savedNdk }
    $bres = $null
    if (Test-Path -LiteralPath (Join-Path $bo 'result.json')) { $bres = Get-Content -LiteralPath (Join-Path $bo 'result.json') -Raw | ConvertFrom-Json -AsHashtable }
    Assert ($bcode -eq 1 -and $bres -and $bres.verdict -eq 'fail' -and $bres.reason -match 'NDK_HOME|JDK') 'build-apk: missing prerequisite writes a fail result'

    # build-apk: the gitignored generated Android files are checked before the build starts (a git archive tree lacks them)
    $genRepo = Join-Path $work 'gen-repo'
    $genApp = Join-Path $genRepo 'src-tauri\gen\android\app'
    New-Item -ItemType Directory -Force -Path (Join-Path $genApp 'src\main\java\pkg\generated') | Out-Null
    $genMiss0 = @(Get-AndroidGeneratedMissing $genRepo)
    Assert ($genMiss0.Count -eq 2 -and ($genMiss0 -join ' ') -match 'generated/TauriActivity\.kt' -and ($genMiss0 -join ' ') -match 'proguard-tauri\.pro') 'generated files: both are reported when the tree has neither'
    [IO.File]::WriteAllText((Join-Path $genApp 'src\main\java\pkg\TauriActivity.kt'), 'x')
    $genMiss1 = @(Get-AndroidGeneratedMissing $genRepo)
    Assert ($genMiss1.Count -eq 2) 'generated files: a TauriActivity.kt outside a generated directory does not count'
    [IO.File]::WriteAllText((Join-Path $genApp 'src\main\java\pkg\generated\TauriActivity.kt'), 'x')
    $genMiss2 = @(Get-AndroidGeneratedMissing $genRepo)
    Assert ($genMiss2.Count -eq 1 -and $genMiss2[0] -match 'proguard-tauri\.pro') 'generated files: the missing proguard-tauri.pro is reported alone'
    [IO.File]::WriteAllText((Join-Path $genApp 'proguard-tauri.pro'), 'x')
    Assert (@(Get-AndroidGeneratedMissing $genRepo).Count -eq 0) 'generated files: nothing is reported when both exist'
    # through build-apk (needs the pinned JDK, which the missing-prerequisite check looks at first)
    $genJdk = 'C:\Users\yor42\.gradle\jdks\azul_systems__inc_-21-amd64-windows.2\bin\java.exe'
    if (Test-Path -LiteralPath $genJdk) {
        $genBare = Join-Path $work 'gen-bare'
        New-Item -ItemType Directory -Force -Path $genBare | Out-Null
        $savedNdk2 = $env:NDK_HOME
        $env:NDK_HOME = $work
        $go = Join-Path $work 'build-nogen'
        $gtext = (& pwsh -NoProfile -File (Join-Path $RunnerDir 'build-apk.ps1') -OutDir $go -RepoRoot $genBare -ScratchRoot (Join-Path $work 'gen-scratch') -MaxSeconds 20 | Out-String)
        $gcode = $LASTEXITCODE
        if ($savedNdk2) { $env:NDK_HOME = $savedNdk2 } else { Remove-Item Env:\NDK_HOME -ErrorAction SilentlyContinue }
        $gres = $null
        if (Test-Path -LiteralPath (Join-Path $go 'result.json')) { $gres = Get-Content -LiteralPath (Join-Path $go 'result.json') -Raw | ConvertFrom-Json -AsHashtable }
        Assert ($gcode -eq 1 -and $gres -and $gres.verdict -eq 'fail' -and $gres.reason -match 'TauriActivity\.kt' -and $gres.reason -match 'proguard-tauri\.pro' -and $gres.reason -match 'copies nothing' -and -not (Test-Path -LiteralPath (Join-Path $genBare 'src-tauri'))) 'build-apk: a tree without the generated Android files fails early, names the files and how to provide them, and copies nothing'
    } else {
        Write-Output 'SKIP build-apk generated-files preflight: the pinned JDK 21 is not installed here'
    }

    # done, path with spaces, argument with a space
    $d = Invoke-Runner 'done' (Join-Path $childDir 'done.cmd') @('hello world')
    Assert ($d.Exit -eq 0 -and $d.Result.verdict -eq 'pass') 'done: verdict pass'
    Assert ((Get-Content -LiteralPath (Join-Path $d.Out 'child.out.log') -Raw) -match 'hello world') 'done: argument with a space arrived intact'
    Assert ($d.Result.exitCode -eq 0 -and $d.Result.build.kind -eq 'none' -and $d.Result.durationSec -gt 0) 'done: exit code, kind and duration recorded'
    Assert ((Test-ResultSchema $d.Result).Count -eq 0) 'done: result.json passes the schema'

    # fail: exit code propagates
    $f = Invoke-Runner 'fail' (Join-Path $childDir 'fail.cmd') $null
    Assert ($f.Exit -ne 0 -and $f.Result.verdict -eq 'fail' -and $f.Result.exitCode -eq 7) 'fail: child exit code 7 reported as fail'
    Assert ($f.Elapsed -lt 12) 'fail: returns promptly'

    # timeout: cap hit, the whole recorded tree is gone
    $t = Invoke-Runner 'timeout' (Join-Path $childDir 'sleeper.cmd') $null 3
    Assert ($t.Result.verdict -eq 'timeout') 'timeout: verdict timeout'
    Assert ($t.Elapsed -lt 20) 'timeout: returns shortly after the cap'
    $ids = @($t.Result.descendantPids) + @($t.Result.rootPid)
    Assert (@($ids | Where-Object { Test-Alive $_ }).Count -eq 0) 'timeout: no recorded PID survives'
    Assert (@($t.Result.descendantPids).Count -ge 1) 'timeout: grandchild was recorded'

    # lingering grandchild keeps running after the child exits; the runner must not wait for it
    $l = Invoke-Runner 'linger' (Join-Path $childDir 'linger.cmd') $null
    Assert ($l.Result.verdict -eq 'pass') 'linger: verdict pass'
    Assert ($l.Elapsed -lt 15) ('linger: returned in ' + [math]::Round($l.Elapsed, 1) + ' s, not after the grandchild (60 s)')
    Assert (@($l.Result.lingering).Count -ge 1 -and (Test-Alive ([int]$l.Result.lingering[0].pid))) 'linger: survivor recorded and left running on pass'
    $lc = $l.Result.lingering[0].created
    Assert ($lc -is [datetime] -or [string]$lc -match '^\d{4}-\d\d-\d\dT') 'linger: survivor entry records its creation time'

    # a pass whose artifact predates the run keeps the verdict and says so
    $old = Join-Path $work 'old.apk'
    [IO.File]::WriteAllText($old, 'x')
    (Get-Item -LiteralPath $old).LastWriteTime = (Get-Date).AddDays(-1)
    $st = Invoke-Runner 'stale' (Join-Path $childDir 'done.cmd') $null 30 @('-ArtifactPath', $old)
    Assert ($st.Result.verdict -eq 'pass' -and $st.Result.build.artifactFresh -eq $false -and $st.Result.reason -match 'artifact not rewritten') 'stale artifact: pass kept, reason names it'

    # app watch with the fake adb
    $env:FAKE_ADB_MODE = 'device'
    $ok = Invoke-Runner 'app-ok' (Join-Path $childDir 'short.cmd') $null 30 @('-Serial', 'FAKE', '-Package', 'p.q', '-RequireApp', '-AdbExe', $fakeAdb)
    Assert ($ok.Result.verdict -eq 'pass') 'app: running app and clean exit pass'
    $env:FAKE_ADB_MODE = 'absent'
    $cr = Invoke-Runner 'app-crash' (Join-Path $childDir 'sleeper.cmd') $null 60 @('-Serial', 'FAKE', '-Package', 'p.q', '-RequireApp', '-AdbExe', $fakeAdb)
    Assert ($cr.Result.verdict -eq 'crash') 'app: absent on a healthy device is a crash'
    Assert ($cr.Elapsed -lt 40) 'app: crash detected well before the cap'
    $env:FAKE_ADB_MODE = 'offline'
    $off = Invoke-Runner 'app-offline' (Join-Path $childDir 'sleeper.cmd') $null 60 @('-Serial', 'FAKE', '-Package', 'p.q', '-RequireApp', '-AdbExe', $fakeAdb)
    Assert ($off.Result.verdict -eq 'fail' -and $off.Result.reason -eq 'device-offline') 'app: offline device is device-offline, not crash'
    $env:FAKE_ADB_MODE = 'device'

    # adb wrapper is bounded
    $null = Initialize-Adb -Dir (Join-Path $work 'adbwrap') -AdbExe $fakeAdb
    $env:FAKE_ADB_MODE = 'hang'
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $h = Invoke-Adb -AdbArgs @('get-state') -TimeoutSec 2
    $sw.Stop()
    Assert ($h.TimedOut -and $sw.Elapsed.TotalSeconds -lt 10) 'adb wrapper: a hung adb call is cut at its timeout'
    $env:FAKE_ADB_MODE = 'offline'
    Assert ((Get-PackagePid 'FAKE' 'p.q').Status -eq 'offline') 'adb wrapper: offline is never reported as absent'
    $env:FAKE_ADB_MODE = 'absent'
    Assert ((Get-PackagePid 'FAKE' 'p.q').Status -eq 'absent') 'adb wrapper: empty pidof on a device is absent'
    $env:FAKE_ADB_MODE = 'device'
    Assert ((Get-PackagePid 'FAKE' 'p.q').Pid -eq 4242) 'adb wrapper: pid parsed'

    # ---------- stage 2: crash detection, relaunch windows, forwards, CDP bounds, device-prep, cold-start ----------
    $env:FAKE_ADB_DIR = $fdir
    $null = Initialize-Adb -Dir (Join-Path $work 'adbwrap2') -AdbExe $fake2
    $pkg = 'p.q'
    $L = '10-21 12:00:05.000  100  100 '

    # crash patterns on a pure log text
    Assert ($null -ne (Find-CrashInLog -Text ($L + 'E AndroidRuntime: Process: p.q, PID: 100') -Package $pkg) -and (Find-CrashInLog -Text ($L + 'E AndroidRuntime: Process: p.q, PID: 100') -Package $pkg).Kind -eq 'java-crash') 'log: java crash of the package'
    Assert ($null -eq (Find-CrashInLog -Text ($L + 'E AndroidRuntime: Process: p.qq, PID: 100') -Package $pkg)) 'log: java crash of a longer package name is not ours'
    Assert ((Find-CrashInLog -Text ($L + 'F libc: Fatal signal 11 (SIGSEGV), pid 100 (sandboxed_process0)') -Package $pkg).Kind -eq 'native-crash') 'log: native crash of a sandboxed process'
    Assert ((Find-CrashInLog -Text ($L + 'W chromium: Render process gone') -Package $pkg).Kind -eq 'renderer-gone') 'log: Render process gone is renderer-gone'
    Assert ($null -eq (Find-CrashInLog -Text ($L + 'W chromium: Render process gone') -Package $pkg -IgnoreRendererGone)) 'log: renderer-gone is ignored inside a relaunch window'
    Assert ($null -eq (Find-CrashInLog -Text ($L + 'W chromium: Render process gone') -Package $pkg -Pids @(7))) 'log: renderer-gone of another pid is not ours'
    Assert ($null -ne (Find-CrashInLog -Text ($L + 'W chromium: Render process gone') -Package $pkg -Pids @(100))) 'log: renderer-gone of our pid is ours'
    Assert ($null -eq (Find-CrashInLog -Text ($L + 'I ActivityManager: Start proc p.q') -Package $pkg)) 'log: ordinary lines are not crashes'

    # watch: process loss, never running, offline, unreadable adb
    Clear-Fake
    Set-Fake 'clock' '10-21 12:00:00.000'
    Set-Fake 'pid' '111'
    $w = New-AppWatch -Serial 'FAKE' -Package $pkg
    Assert ($null -ne $w -and $w.Since -eq '10-21 12:00:00.000') 'watch: starts from the device clock'
    Assert ($null -eq (Test-AppWatch $w)) 'watch: a running app is healthy'
    Set-Fake 'pid' ''
    Assert ($null -eq (Test-AppWatch $w)) 'watch: one empty poll is not yet a crash'
    $v = Test-AppWatch $w
    Assert ($v -and $v.verdict -eq 'crash' -and $v.reason -match 'process gone') 'watch: loss of a running app is a crash'
    $w = New-AppWatch -Serial 'FAKE' -Package $pkg
    $null = Test-AppWatch $w
    $v = Test-AppWatch $w
    Assert ($v -and $v.verdict -eq 'fail' -and $v.reason -eq 'app-not-running') 'watch: an app never seen running is app-not-running, not crash'
    Set-Fake 'mode' 'offline'
    $v = Test-AppWatch $w
    Assert ($v -and $v.verdict -eq 'fail' -and $v.reason -eq 'device-offline') 'watch: offline is device-offline'
    Set-Fake 'mode' 'pidoferr'
    $w = New-AppWatch -Serial 'FAKE' -Package $pkg
    $a1 = Test-AppWatch $w
    $a2 = Test-AppWatch $w
    $a3 = Test-AppWatch $w
    Assert ($null -eq $a1 -and $null -eq $a2 -and $a3 -and $a3.reason -eq 'adb-unresponsive') 'watch: repeated adb errors fail as adb-unresponsive, not crash'
    Set-Fake 'mode' 'device'

    # watch: relaunch windows
    Clear-Fake
    Set-Fake 'clock' '10-21 12:00:00.000'
    Set-Fake 'pid' '111'
    $w = New-AppWatch -Serial 'FAKE' -Package $pkg
    $null = Test-AppWatch $w
    Open-RelaunchWindow $w 'force-stop' 30
    Set-Fake 'pid' ''
    $res = @(Test-AppWatch $w; Test-AppWatch $w; Test-AppWatch $w)
    Assert (@($res | Where-Object { $_ }).Count -eq 0) 'window: the intended force-stop is not a crash'
    Set-Fake 'pid' '222'
    Assert ($null -eq (Test-AppWatch $w) -and $null -eq $w.Window -and $w.LastPid -eq 222 -and $w.Relaunches.Count -eq 1) 'window: a new pid closes the window and becomes the expected pid'
    Set-Fake 'pid' '333'
    $v = Test-AppWatch $w
    Assert ($v -and $v.verdict -eq 'crash' -and $v.reason -match 'outside an expected relaunch') 'window: a pid change without a window is a crash'
    $w = New-AppWatch -Serial 'FAKE' -Package $pkg
    Set-Fake 'pid' '111'
    $null = Test-AppWatch $w
    Open-RelaunchWindow $w 'reload' 1
    Set-Fake 'pid' ''
    Start-Sleep -Seconds 2
    $v = Test-AppWatch $w
    Assert ($v -and $v.verdict -eq 'fail' -and $v.reason -match 'relaunch window reload exceeded') 'window: a relaunch that never comes back fails when its gap is exceeded'

    # window opened before the first poll (cold-start run 1): the old process still answers pidof at first
    $script:mockSeq = @(@{ Status = 'running'; Pid = 111 }, @{ Status = 'absent' }, @{ Status = 'absent' }, @{ Status = 'absent' }, @{ Status = 'absent' })
    $script:mockI = 0
    $raceResults = & {
        function Get-PackagePid { $x = $script:mockSeq[[math]::Min($script:mockI, $script:mockSeq.Count - 1)]; $script:mockI++; return $x }
        function Get-DeviceClock { return '10-21 10:00:00.000' }
        function Get-LogcatCrash { return $null }
        $rw = @{ Serial = 'x'; Package = 'p'; AbsentPolls = 2; UnknownPolls = 3; StartClock = 'a'; Since = 'a'; Absent = 0; Unknown = 0; LastPid = $null; Pids = @(); SeenRunning = $false; Window = $null; Relaunches = @() }
        Open-RelaunchWindow $rw 'force-stop' 30
        $polls = @(); for ($k = 0; $k -lt 4; $k++) { $polls += , (Test-AppWatch $rw) }
        return @{ Polls = $polls; Open = [bool]$rw.Window }
    }
    Assert (@($raceResults.Polls | Where-Object { $_ }).Count -eq 0 -and $raceResults.Open) 'window: a pidof taken before the window keeps it open while the process is absent (run 1 is not a false crash)'
    $script:mockSeq = @(@{ Status = 'running'; Pid = 111 }, @{ Status = 'running'; Pid = 111 }, @{ Status = 'running'; Pid = 222 })
    $script:mockI = 0
    $raceResults2 = & {
        function Get-PackagePid { $x = $script:mockSeq[[math]::Min($script:mockI, $script:mockSeq.Count - 1)]; $script:mockI++; return $x }
        function Get-DeviceClock { return '10-21 10:00:00.000' }
        function Get-LogcatCrash { return $null }
        $rw = @{ Serial = 'x'; Package = 'p'; AbsentPolls = 2; UnknownPolls = 3; StartClock = 'a'; Since = 'a'; Absent = 0; Unknown = 0; LastPid = $null; Pids = @(); SeenRunning = $false; Window = $null; Relaunches = @() }
        Open-RelaunchWindow $rw 'force-stop' 30
        $first = Test-AppWatch $rw
        $stillOpen = [bool]$rw.Window
        $second = Test-AppWatch $rw
        return @{ First = $first; StillOpen = $stillOpen; Second = $second; LastPid = $rw.LastPid; Closed = (-not $rw.Window) }
    }
    Assert ($null -eq $raceResults2.First -and $raceResults2.StillOpen -and $null -eq $raceResults2.Second -and $raceResults2.Closed -and $raceResults2.LastPid -eq 222) 'window: the old pid seen at first poll does not close the window; the new pid does'

    # an unreadable seed pidof is retried once; if it stays unreadable the window fails as adb-unresponsive, never as a crash
    foreach ($case in @(@{ Name = 'unknown twice'; Seq = @(@{ Status = 'unknown' }, @{ Status = 'unknown' }, @{ Status = 'running'; Pid = 111 }, @{ Status = 'absent' }, @{ Status = 'absent' }) },
            @{ Name = 'unknown once'; Seq = @(@{ Status = 'unknown' }, @{ Status = 'running'; Pid = 111 }, @{ Status = 'absent' }, @{ Status = 'absent' }, @{ Status = 'absent' }) })) {
        $script:mockSeq = $case.Seq
        $script:mockI = 0
        $seedRes = & {
            function Get-PackagePid { $x = $script:mockSeq[[math]::Min($script:mockI, $script:mockSeq.Count - 1)]; $script:mockI++; return $x }
            function Get-DeviceClock { return '10-21 10:00:00.000' }
            function Get-LogcatCrash { return $null }
            $rw = @{ Serial = 'x'; Package = 'p'; AbsentPolls = 2; UnknownPolls = 3; StartClock = 'a'; Since = 'a'; Absent = 0; Unknown = 0; LastPid = $null; Pids = @(); SeenRunning = $false; Window = $null; Relaunches = @() }
            Open-RelaunchWindow $rw 'force-stop' 30
            $polls = @(); for ($k = 0; $k -lt 4; $k++) { $polls += , (Test-AppWatch $rw) }
            return @{ Polls = $polls; LastPid = $rw.LastPid }
        }
        if ($case.Name -eq 'unknown twice') {
            Assert ($seedRes.Polls[0] -and $seedRes.Polls[0].verdict -eq 'fail' -and $seedRes.Polls[0].reason -eq 'adb-unresponsive') 'window: a seed that stays unknown fails as adb-unresponsive, not crash'
        } else {
            Assert (@($seedRes.Polls | Where-Object { $_ }).Count -eq 0 -and $seedRes.LastPid -eq 111) 'window: a seed that is unknown once is retried and seeds the old pid'
        }
    }

    # watch: logcat evidence, filtered by the start time and never cleared
    Clear-Fake
    Set-Fake 'clock' '10-21 12:00:00.000'
    Set-Fake 'pid' '111'
    Set-Fake 'logcat.txt' ("10-21 11:59:00.000  111  111 W chromium: Render process gone`n")
    $w = New-AppWatch -Serial 'FAKE' -Package $pkg
    Assert ($null -eq (Test-AppWatch $w)) 'logcat: a line older than the start time is not read'
    Set-Fake 'logcat.txt' ("10-21 11:59:00.000  111  111 W chromium: Render process gone`n10-21 12:00:05.000  111  111 W chromium: Render process gone`n")
    $v = Test-AppWatch $w
    Assert ($v -and $v.verdict -eq 'crash' -and $v.reason -match '^renderer-gone') 'logcat: a renderer loss while the app process lives is a crash'
    Set-Fake 'logcat.txt' ($L + "E AndroidRuntime: Process: p.q, PID: 100`n")
    $w = New-AppWatch -Serial 'FAKE' -Package $pkg
    $v = Test-AppWatch $w
    Assert ($v -and $v.verdict -eq 'crash' -and $v.reason -match '^java-crash') 'logcat: a java crash line is a crash'
    Set-Fake 'logcat.txt' ("10-21 12:00:05.000  111  111 W chromium: Render process gone`n")
    $w = New-AppWatch -Serial 'FAKE' -Package $pkg
    $null = Test-AppWatch $w
    Open-RelaunchWindow $w 'force-stop' 30
    Set-Fake 'logcat.txt' ("10-21 12:00:05.000  111  111 W chromium: Render process gone`n")
    $w.Since = '10-21 12:00:00.000'
    $inWin = Test-AppWatch $w
    Assert ($null -eq $inWin) 'logcat: renderer teardown inside a relaunch window is ignored'
    Set-Fake 'clock' '10-21 12:00:10.000'
    Set-Fake 'pid' '222'
    $closeTick = Test-AppWatch $w
    $after = Test-AppWatch $w
    Assert ($null -eq $closeTick -and $null -eq $after) 'logcat: closing a window moves the scan start past the teardown lines'
    $calls = [IO.File]::ReadAllText((Join-Path $fdir 'calls.txt'))
    Assert ($calls -notmatch 'logcat\s+-c\b' -and $calls -match 'logcat [^\r\n]*-T ''') 'logcat: filtered by a start time, never cleared'

    # forwards: own port, identity, re-resolve after a relaunch, remove only our own
    Clear-Fake
    Set-Fake 'pid' '111'
    Set-Fake 'forwards.txt' ("FAKE tcp:9770 localabstract:foreign_socket`n")
    $fw = New-CdpForward 'FAKE' $pkg 9770 9789
    $u = Update-CdpForward $fw
    Assert ($u.Ok -and $u.Port -ne 9770 -and $u.Port -ge 9770 -and $u.Port -le 9789) 'forward: a port already forwarded by someone else is skipped'
    $first = $u.Port
    Assert ((Get-Content -LiteralPath (Join-Path $fdir 'forwards.txt') -Raw) -match ('tcp:' + $first + ' localabstract:webview_devtools_remote_111')) 'forward: maps to the current pid devtools socket'
    Set-Fake 'pid' '222'
    $u2 = Update-CdpForward $fw
    $ft = Get-Content -LiteralPath (Join-Path $fdir 'forwards.txt') -Raw
    Assert ($u2.Ok -and $ft -match 'devtools_remote_222' -and $ft -notmatch 'devtools_remote_111') 'forward: re-resolved to the new pid after a relaunch, old mapping removed'
    Set-Fake 'forwards.txt' ("FAKE tcp:9770 localabstract:foreign_socket`nFAKE tcp:" + $u2.Port + " localabstract:other_owner`n")
    Remove-CdpForward $fw
    Assert ([IO.File]::ReadAllText((Join-Path $fdir 'forwards.txt')) -match 'other_owner') 'forward: a port re-used by another owner is not removed'
    $fw3 = New-CdpForward 'FAKE' $pkg 9770 9789
    $fw3.Port = 9775; $fw3.Pids = @(222)
    Set-Fake 'forwards.txt' ("FAKE tcp:9775 localabstract:webview_devtools_remote_999`n")
    Remove-CdpForward $fw3
    Assert ([IO.File]::ReadAllText((Join-Path $fdir 'forwards.txt')) -match 'remote_999') 'forward: a devtools forward to a pid we never forwarded is not removed'
    Set-Fake 'forwards.txt' ("FAKE tcp:9770 localabstract:foreign_socket`n")
    $fw2 = New-CdpForward 'FAKE' $pkg 9770 9789
    $null = Update-CdpForward $fw2
    Remove-CdpForward $fw2
    $ft = Get-Content -LiteralPath (Join-Path $fdir 'forwards.txt') -Raw
    Assert ($ft -match 'foreign_socket' -and $ft -notmatch 'webview_devtools_remote') 'forward: remove takes our forward and leaves the foreign one'

    # a forward another agent creates after our list was read is refused and never overwritten
    Clear-Fake
    Set-Fake 'pid' '111'
    Set-Fake 'ghost' ("tcp:9770`n")
    $fw4 = New-CdpForward 'FAKE' $pkg 9770 9789
    $u4 = Update-CdpForward $fw4
    $callsF = [IO.File]::ReadAllText((Join-Path $fdir 'calls.txt'))
    Assert ($u4.Ok -and $u4.Port -eq 9771) 'forward: a refused port (taken after the list) moves on to the next port'
    Assert ($callsF -match 'forward --no-rebind tcp:9770 ' -and $callsF -notmatch 'forward tcp:') 'forward: every forward is made with --no-rebind'
    Remove-CdpForward $fw4

    # refusal wording: only a taken local port moves on; anything else (adb server errors) fails at once with its text
    Clear-Fake
    Set-Fake 'pid' '111'
    Set-Fake 'fwderr' "adb.exe: error: cannot rebind existing socket`n"
    # The port range depends on this process id so a parallel run probing the shared range cannot take one of these ports.
    $xBase = 40000 + ($PID % 20000)
    $fwX = New-CdpForward 'FAKE' $pkg $xBase ($xBase + 2)
    $uX = Update-CdpForward $fwX
    $nTried = @([IO.File]::ReadAllLines((Join-Path $fdir 'calls.txt')) | Where-Object { $_ -match 'forward --no-rebind' }).Count
    Assert (-not $uX.Ok -and $nTried -eq 3 -and $uX.Reason -match 'no free port in range' -and $uX.Reason -match 'cannot rebind existing socket') 'forward: port exhaustion tries every port and the reason keeps the last adb error'
    Clear-Fake
    Set-Fake 'pid' '111'
    Set-Fake 'fwderr' "adb.exe: error: could not install *smartsocket* listener: cannot bind to 127.0.0.1:5037`n"
    $fwY = New-CdpForward 'FAKE' $pkg 9770 9789
    $uY = Update-CdpForward $fwY
    $nTried = @([IO.File]::ReadAllLines((Join-Path $fdir 'calls.txt')) | Where-Object { $_ -match 'forward --no-rebind' }).Count
    Assert (-not $uY.Ok -and $nTried -eq 1 -and $uY.Reason -match 'adb forward failed' -and $uY.Reason -match 'smartsocket') 'forward: an adb server error fails at once with its own text, no port loop'
    foreach ($taken in @('adb.exe: error: cannot rebind existing socket', 'adb.exe: error: cannot bind listener: cannot bind to 127.0.0.1:9799: Only one usage of each socket address is permitted. (10048)',
            'adb.exe: error: cannot bind listener: cannot bind to 127.0.0.1:9799: Address already in use (98)')) {
        Assert (Test-ForwardPortTaken $taken) ('forward: refusal text is a taken port: ' + $taken)
    }
    foreach ($other in @('adb.exe: error: could not install *smartsocket* listener: cannot bind to 127.0.0.1:5037', 'error: device unauthorized', 'error: more than one device/emulator', '')) {
        Assert (-not (Test-ForwardPortTaken $other)) ('forward: not a taken port: ' + $other)
    }

    # settled memory attribution
    $actText = '  *APP* UID 10320 ProcessRecord{17609d1 31771:io.github.yor42.risutanium/u0a320}' + "`n" +
        '  *APP* UID 99679 ProcessRecord{a22a954 31823:com.google.android.webview:sandboxed_process0:org.chromium.content.app.SandboxedProcessService0:0/u0a320i679}' + "`n" +
        '  *APP* UID 99680 ProcessRecord{51811f2 32077:com.google.android.webview:sandboxed_process0:org.chromium.content.app.SandboxedProcessService0:0/u0a159i680}' + "`n" +
        '    Isolated #0: ProcessRecord{a22a954 31823:com.google.android.webview:sandboxed_process0:org.chromium.content.app.SandboxedProcessService0:0/u0a320i679}' + "`n" +
        '  *APP* UID 10159 ProcessRecord{3f4a5b6 29172:com.google.android.webview:webview_service/u0a159}'
    $ow = Get-OwnedSandboxPids $actText @(31771)
    Assert ($ow.Known -and @($ow.Pids).Count -eq 1 -and $ow.Pids[0] -eq 31823) 'attribution: only the renderer with the app uid tag is owned, not another app renderer or webview_service'
    Assert (-not (Get-OwnedSandboxPids $actText @(999)).Known -and -not (Get-OwnedSandboxPids '' @(31771)).Known) 'attribution: unknown when the app has no process record'

    # CDP: every call is bounded
    New-Cmd (Join-Path $work 'hang.mjs') @('setTimeout(() => {}, 60000)')
    New-Cmd (Join-Path $work 'silent.mjs') @(
        'import http from "node:http"',
        'const port = Number(process.argv[2])',
        'const empty = process.argv[3] === "empty"',
        'const s = http.createServer((q, r) => { r.setHeader("content-type", "application/json"); r.end(JSON.stringify(empty ? [] : [{ type: "page", url: "http://x/", webSocketDebuggerUrl: "ws://127.0.0.1:" + port + "/p" }])) })',
        's.on("upgrade", (q, sock) => { sock.on("error", () => {}) })',
        's.on("connection", (sock) => { sock.on("error", () => {}) })',
        's.listen(port, "127.0.0.1")')
    $tl = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
    $tl.Start(); $cport = $tl.LocalEndpoint.Port; $tl.Stop()
    $srv = Start-Process -FilePath (Get-NodePath) -ArgumentList (Join-ProcessArgs @((Join-Path $work 'silent.mjs'), [string]$cport)) -NoNewWindow -PassThru `
        -RedirectStandardOutput (Join-Path $work 'srv.out') -RedirectStandardError (Join-Path $work 'srv.err')
    $null = $srv.Handle
    $script:spawned += $srv.Id
    Start-Sleep -Seconds 1
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $c1 = Invoke-Cdp -Port $cport -Expression '1' -TimeoutMs 1500
    $sw.Stop()
    Assert ($c1.Kind -eq 'timeout' -and $c1.ExitCode -eq 3 -and -not $c1.Killed -and $sw.Elapsed.TotalSeconds -lt 8) 'cdp: a target that never answers ends by its own timeout, not by the outer kill'
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $c2 = Invoke-Cdp -Port $cport -Expression '1' -TimeoutMs 1000 -CdpScript (Join-Path $work 'hang.mjs') -GraceSec 1
    $sw.Stop()
    Assert ($c2.Kind -eq 'timeout' -and $c2.Killed -and $sw.Elapsed.TotalSeconds -lt 8) 'cdp: a probe that hangs is killed by the outer bound'
    Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue
    $srv2 = Start-Process -FilePath (Get-NodePath) -ArgumentList (Join-ProcessArgs @((Join-Path $work 'silent.mjs'), [string]$cport, 'empty')) -NoNewWindow -PassThru `
        -RedirectStandardOutput (Join-Path $work 'srv2.out') -RedirectStandardError (Join-Path $work 'srv2.err')
    $null = $srv2.Handle
    $script:spawned += $srv2.Id
    Start-Sleep -Seconds 1
    Assert ((Invoke-Cdp -Port $cport -Expression '1' -TimeoutMs 1500).Kind -eq 'no-target') 'cdp: no page target is reported as no-target'
    Stop-Process -Id $srv2.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
    Assert ((Invoke-Cdp -Port $cport -Expression '1' -TimeoutMs 1500).Kind -eq 'error') 'cdp: a closed port is an error'

    # device-prep against the stateful fake
    $prepScript = Join-Path $RunnerDir 'device-prep.ps1'
    $sp = Join-Path $work 'prep-state.json'
    function Invoke-Prep([string]$Name, [string[]]$Extra = @()) {
        $o = Join-Path $work $Name
        $a = @('-NoProfile', '-File', $prepScript, '-OutDir', $o, '-Serial', 'FAKE', '-AllowedSerials', 'FAKE', '-StatePath', $sp, '-AdbExe', $fake2, '-RepoRoot', $work) + $Extra
        $null = (& pwsh @a | Out-String)
        $c = $LASTEXITCODE
        $res = $null
        if (Test-Path -LiteralPath (Join-Path $o 'result.json')) { $res = Get-Content -LiteralPath (Join-Path $o 'result.json') -Raw | ConvertFrom-Json -AsHashtable }
        return [pscustomobject]@{ Exit = $c; Result = $res }
    }
    Clear-Fake
    Remove-Item -LiteralPath $sp -Force -ErrorAction SilentlyContinue
    Set-Fake 's-stay_on_while_plugged_in' '0'
    Set-Fake 'whitelist.txt' ("system,com.android.shell,2000`n")
    $p1 = Invoke-Prep 'prep1'
    $stateNow = Get-Content -LiteralPath $sp -Raw | ConvertFrom-Json -AsHashtable
    Assert ($p1.Exit -eq 0 -and $p1.Result.verdict -eq 'pass' -and (Get-Content (Join-Path $fdir 's-stay_on_while_plugged_in') -Raw).Trim() -eq '7' -and (Get-Content (Join-Path $fdir 'whitelist.txt') -Raw) -match 'user,io.github.yor42.risutanium,') 'prep: stay-awake and whitelist applied'
    Assert ($stateNow.originals.stayOn -eq '0' -and $stateNow.originals.whitelisted -eq $false) 'prep: originals recorded'
    Assert ($p1.Result.prep.readback.stayOn -eq '7' -and $p1.Result.prep.readback.whitelisted -eq $true) 'prep: both settings read back into the result'
    $p2 = Invoke-Prep 'prep2'
    $stateAgain = Get-Content -LiteralPath $sp -Raw | ConvertFrom-Json -AsHashtable
    Assert ($p2.Exit -eq 0 -and $stateAgain.originals.stayOn -eq '0') 'prep: a repeated prep keeps the first recorded originals'
    $p3 = Invoke-Prep 'revert1' @('-Revert')
    Assert ($p3.Exit -eq 0 -and (Get-Content (Join-Path $fdir 's-stay_on_while_plugged_in') -Raw).Trim() -eq '0' -and (Get-Content (Join-Path $fdir 'whitelist.txt') -Raw) -notmatch 'user,io.github') 'prep: revert restores the setting and removes the whitelist entry it added'
    Assert ($p3.Result.prep.readback.stayOn -eq '0' -and $p3.Result.prep.readback.whitelisted -eq $false) 'prep: revert reads the restored values back'
    Assert ((Invoke-Prep 'revert2' @('-Revert')).Exit -ne 0) 'prep: a second revert is refused'
    Remove-Item -LiteralPath $sp -Force
    Remove-Item -LiteralPath (Join-Path $fdir 's-stay_on_while_plugged_in') -Force
    Set-Fake 'whitelist.txt' ("system,com.android.shell,2000`nuser,io.github.yor42.risutanium,10300`n")
    $null = Invoke-Prep 'prep3'
    $p4 = Invoke-Prep 'revert3' @('-Revert')
    Assert ($p4.Exit -eq 0 -and -not (Test-Path (Join-Path $fdir 's-stay_on_while_plugged_in')) -and (Get-Content (Join-Path $fdir 'whitelist.txt') -Raw) -match 'user,io.github.yor42.risutanium,') 'prep: an unset setting is deleted again and an earlier whitelist entry is kept'
    Remove-Item -LiteralPath $sp -Force
    Set-Fake 's-stay_on_while_plugged_in' '0'
    Set-Fake 'whitelist.txt' ''
    $p5 = Invoke-Prep 'prep-screenoff' @('-ScreenOff')
    Assert ($p5.Exit -eq 0 -and (Get-Content (Join-Path $fdir 's-stay_on_while_plugged_in') -Raw).Trim() -eq '0' -and (Get-Content (Join-Path $fdir 'whitelist.txt') -Raw) -match 'user,io.github') 'prep: -ScreenOff leaves stay-awake alone'
    Remove-Item -LiteralPath $sp -Force
    Set-Fake 'noapply' '1'
    $p6 = Invoke-Prep 'prep-noapply'
    Assert ($p6.Exit -ne 0 -and $p6.Result.verdict -eq 'fail') 'prep: a change that does not read back fails'
    Remove-Item -LiteralPath $sp -Force -ErrorAction SilentlyContinue
    Set-Fake 'whitelist.txt' ''
    $p7 = Invoke-Prep 'prep-noapply-wl' @('-ScreenOff')
    Assert ($p7.Exit -ne 0 -and $p7.Result.reason -match 'whitelist') 'prep: a whitelist entry that does not read back fails'
    Remove-Item -LiteralPath $sp -Force -ErrorAction SilentlyContinue

    # cold-start against the fake: force-stop is intended, absence is not
    $coldScript = Join-Path $RunnerDir 'cold-start.ps1'
    New-Cmd (Join-Path $work 'ready.mjs') @('console.log("true")')
    New-Cmd (Join-Path $work 'stall.mjs') @('console.error("timeout"); process.exit(3)')
    function Invoke-Cold([string]$Name, [string]$Cdp, [string[]]$Extra = @()) {
        $o = Join-Path $work $Name
        $a = @('-NoProfile', '-File', $coldScript, '-OutDir', $o, '-Serial', 'FAKE', '-AllowedSerials', 'FAKE', '-AdbExe', $fake2, '-RepoRoot', $work,
            '-CdpScript', $Cdp, '-PortMin', '9770', '-PortMax', '9789', '-PollSeconds', '1', '-PauseSec', '3', '-SettleSec', '1', '-Runs', '2', '-MaxSeconds', '120') + $Extra
        $null = (& pwsh @a | Out-String)
        $c = $LASTEXITCODE
        $res = $null
        if (Test-Path -LiteralPath (Join-Path $o 'result.json')) { $res = Get-Content -LiteralPath (Join-Path $o 'result.json') -Raw | ConvertFrom-Json -AsHashtable }
        return [pscustomobject]@{ Exit = $c; Result = $res }
    }
    Clear-Fake
    Set-Fake 'clock' '10-21 12:00:00.000'
    Set-Fake 'pid' '5555'
    Set-Fake 'startpid' '5555'
    $cs = Invoke-Cold 'cold-ok' (Join-Path $work 'ready.mjs')
    Assert ($cs.Exit -eq 0 -and $cs.Result.verdict -eq 'pass' -and @($cs.Result.phases).Count -eq 2) 'cold: two runs pass; the force-stop between them is not a crash'
    Assert ($cs.Result.phases[0].metrics.amTotalMs -eq 321 -and $cs.Result.phases[0].metrics.settledPssKB -eq 2000 -and $cs.Result.build.kind -eq 'debug') 'cold: TotalTime, summed PSS and build kind recorded'
    Assert ($cs.Result.phases[0].metrics.settledPssScope -eq 'package-attributed' -and $cs.Result.cold.summary.settledPssScope -eq 'package-attributed' -and @($cs.Result.phases[0].metrics.procs).Count -eq 2) 'cold: settled PSS counts only this package (own pid and its renderer), labelled package-attributed'
    Assert ((Test-ResultSchema $cs.Result).Count -eq 0 -and @($cs.Result.cold.relaunches).Count -eq 2) 'cold: result passes the schema and records both relaunch windows'
    Assert (-not ([IO.File]::ReadAllText((Join-Path $fdir 'forwards.txt')) -match 'webview_devtools_remote')) 'cold: the forward it made is removed at the end'
    Clear-Fake
    Set-Fake 'clock' '10-21 12:00:00.000'
    Set-Fake 'pid' '5555'
    Set-Fake 'startpid' '5555'
    Set-Fake 'noactivity' '1'
    $cs2 = Invoke-Cold 'cold-inclusive' (Join-Path $work 'ready.mjs')
    Assert ($cs2.Exit -eq 0 -and $cs2.Result.phases[0].metrics.settledPssScope -eq 'inclusive-webview' -and $cs2.Result.phases[0].metrics.settledPssKB -eq 4000) 'cold: without attribution the figure is the labelled inclusive sum'
    Clear-Fake
    Set-Fake 'clock' '10-21 12:00:00.000'
    Set-Fake 'nostart' '1'
    $nr = Invoke-Cold 'cold-notrunning' (Join-Path $work 'ready.mjs')
    Assert ($nr.Exit -ne 0 -and $nr.Result.verdict -eq 'fail' -and $nr.Result.reason -match 'app-not-running') 'cold: an app that did not start is app-not-running'
    Clear-Fake
    Set-Fake 'clock' '10-21 12:00:00.000'
    Set-Fake 'startpid' '5555'
    $st2 = Invoke-Cold 'cold-stall' (Join-Path $work 'stall.mjs') @('-CdpTimeoutMs', '500')
    Assert ($st2.Exit -ne 0 -and $st2.Result.verdict -eq 'fail' -and $st2.Result.reason -match 'cdp-unresponsive') 'cold: a CDP target that keeps timing out fails as cdp-unresponsive'

    }
    if ($Fast) { $env:FAKE_ADB_DIR = $fdir; $env:FAKE_ADB_MODE = 'device' }
    # ---------- stage 3: snapshot and restore against the stateful fake (real tar, fake device tree) ----------
    $snapScript = Join-Path $RunnerDir 'snapshot.ps1'
    $restScript = Join-Path $RunnerDir 'restore-snapshot.ps1'
    $sroot = Join-Path $work 'snaproot'
    $ddata = Join-Path $fdir 'data'
    function Invoke-Snap([string]$Name, [string[]]$Extra = @(), [string]$Root = $sroot, [string]$UseSerial = 'FAKE') {
        $o = Join-Path $work $Name
        $a = @('-NoProfile', '-File', $snapScript, '-OutDir', $o, '-Serial', $UseSerial, '-AllowedSerials', 'FAKE', '-AdbExe', $fake2, '-RepoRoot', $work, '-SnapshotRoot', $Root) + $Extra
        $null = (& pwsh @a | Out-String)
        $c = $LASTEXITCODE
        $res = $null
        if (Test-Path -LiteralPath (Join-Path $o 'result.json')) { $res = Get-Content -LiteralPath (Join-Path $o 'result.json') -Raw | ConvertFrom-Json -AsHashtable }
        return [pscustomobject]@{ Exit = $c; Result = $res }
    }
    function Invoke-Restore([string]$Name, [string[]]$Extra = @(), [string]$Root = $sroot, [string]$UseSerial = 'FAKE') {
        $o = Join-Path $work $Name
        $a = @('-NoProfile', '-File', $restScript, '-OutDir', $o, '-Serial', $UseSerial, '-AllowedSerials', 'FAKE', '-AdbExe', $fake2, '-RepoRoot', $work, '-SnapshotRoot', $Root) + $Extra
        $null = (& pwsh @a | Out-String)
        $c = $LASTEXITCODE
        $res = $null
        if (Test-Path -LiteralPath (Join-Path $o 'result.json')) { $res = Get-Content -LiteralPath (Join-Path $o 'result.json') -Raw | ConvertFrom-Json -AsHashtable }
        return [pscustomobject]@{ Exit = $c; Result = $res }
    }
    function Get-TreeHashes([string]$Dir, [string[]]$Skip = @('cache', 'code_cache')) {
        $rows = @()
        foreach ($f in @(Get-ChildItem -LiteralPath $Dir -Recurse -File)) {
            $rel = $f.FullName.Substring($Dir.Length).TrimStart('\')
            if ($rel.Split('\')[0] -in $Skip) { continue }
            $rows += ($rel + ':' + (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash)
        }
        return (($rows | Sort-Object) -join '|')
    }
    function New-FakeData {
        Remove-Item -LiteralPath $ddata -Recurse -Force -ErrorAction SilentlyContinue
        foreach ($p in @('files', 'app_webview\Default', 'store2', 'cache', 'code_cache')) { New-Item -ItemType Directory -Force -Path (Join-Path $ddata $p) | Out-Null }
        [IO.File]::WriteAllText((Join-Path $ddata 'files\a.txt'), ('alpha' * 1000))
        $rnd = New-Object byte[] 70000
        (New-Object Random 7).NextBytes($rnd)
        [IO.File]::WriteAllBytes((Join-Path $ddata 'files\b.bin'), $rnd)
        [IO.File]::WriteAllText((Join-Path $ddata 'app_webview\Default\x'), 'webview')
        [IO.File]::WriteAllText((Join-Path $ddata 'store2\u1'), 'unit one')
        [IO.File]::WriteAllText((Join-Path $ddata 'cache\c.tmp'), 'cache junk')
        [IO.File]::WriteAllText((Join-Path $ddata 'code_cache\z'), 'code cache junk')
    }
    function Get-FakeCalls { $cf = Join-Path $fdir 'calls.txt'; if (Test-Path -LiteralPath $cf) { return [IO.File]::ReadAllText($cf) } return '' }

    Clear-Fake
    Set-Fake 'clock' '10-21 12:00:00.000'
    New-FakeData
    $baseHash = Get-TreeHashes $ddata
    $sn = Invoke-Snap 'snap1' @('-Id', 'base1', '-Pin')
    $sdir = Join-Path $sroot 'test\base1'
    $sm = $null
    if (Test-Path -LiteralPath (Join-Path $sdir 'snapshot.json')) { $sm = Get-Content -LiteralPath (Join-Path $sdir 'snapshot.json') -Raw | ConvertFrom-Json -AsHashtable }
    Assert ($sn.Exit -eq 0 -and $sn.Result.verdict -eq 'pass' -and $sm -and $sm.fileCount -eq 4 -and (@($sm.entries) -join ',') -eq 'app_webview,files,store2') 'snapshot: debug build, the three data entries, cache and code_cache left out, 4 files counted'
    Assert ($sm.build.kind -eq 'debug' -and $sm.build.versionCode -eq 1000 -and $sm.build.signing -eq '8b25b40d' -and $sm.pinned -eq $true -and $sm.sha256 -eq (Get-FileHash -LiteralPath (Join-Path $sdir 'snapshot.tar') -Algorithm SHA256).Hash) 'snapshot: manifest carries versionCode, signing digest, pin and the tar SHA-256'
    $tl = @(& tar -tf (Join-Path $sdir 'snapshot.tar'))
    Assert (@($tl | Where-Object { $_ -match '(^|/)(cache|code_cache)/' }).Count -eq 0 -and $sn.Result.transfer.bytes -gt 0 -and (Test-ResultSchema $sn.Result).Count -eq 0) 'snapshot: no cache entries in the tar, transfer recorded, result passes the schema'
    Assert ((Get-FakeCalls) -match 'force-stop') 'snapshot: the app is force-stopped first'

    if (-not $Fast) {
    # mutate, then restore: the whole tree comes back, caches are left alone, the temp tar is gone from the device
    Remove-Item -LiteralPath (Join-Path $ddata 'store2') -Recurse -Force
    [IO.File]::WriteAllText((Join-Path $ddata 'files\a.txt'), 'changed')
    New-Item -ItemType Directory -Force -Path (Join-Path $ddata 'extra_dir') | Out-Null
    [IO.File]::WriteAllText((Join-Path $ddata 'extra_dir\leftover'), 'must go')
    $rs = Invoke-Restore 'rest1' @('-Id', 'base1')
    Assert ($rs.Exit -eq 0 -and $rs.Result.verdict -eq 'pass' -and (Get-TreeHashes $ddata) -eq $baseHash) 'restore: the data tree equals the snapshot after a mutation (no leftover entry, no changed file)'
    Assert ((Test-Path -LiteralPath (Join-Path $ddata 'cache\c.tmp')) -and (Test-Path -LiteralPath (Join-Path $ddata 'code_cache\z'))) 'restore: cache and code_cache are not touched'
    Assert (@(Get-ChildItem -LiteralPath (Join-Path $fdir 'remote') -File -ErrorAction SilentlyContinue).Count -eq 0) 'restore: the pushed temp tar is removed from the device'
    Assert ($rs.Result.verified.files -eq 4 -and $rs.Result.transfer.bytes -eq $sm.tarBytes -and $rs.Result.deviceTouched -eq $true -and (Test-ResultSchema $rs.Result).Count -eq 0) 'restore: verified totals, transfer and touched flag recorded; schema valid'

    # a corrupt tar aborts before any adb call
    $croot = Join-Path $work 'corrupt-root'
    $cdir = Join-Path $croot 'test\base1'
    New-Item -ItemType Directory -Force -Path $cdir | Out-Null
    Copy-Item -Path (Join-Path $sdir '*') -Destination $cdir
    $cb = [IO.File]::ReadAllBytes((Join-Path $cdir 'snapshot.tar'))
    $cb[2000] = $cb[2000] -bxor 1
    [IO.File]::WriteAllBytes((Join-Path $cdir 'snapshot.tar'), $cb)
    Remove-Item -LiteralPath (Join-Path $fdir 'calls.txt') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $ddata 'files\b.bin') -Force
    $rc = Invoke-Restore 'rest-corrupt' @('-Id', 'base1') $croot
    Assert ($rc.Exit -ne 0 -and $rc.Result.verdict -eq 'fail' -and $rc.Result.reason -match 'integrity' -and $rc.Result.deviceTouched -eq $false) 'restore: a flipped byte in the tar fails the integrity check'
    Assert ((Get-FakeCalls) -eq '' -and -not (Test-Path -LiteralPath (Join-Path $work 'rest-corrupt\adb'))) 'restore: a corrupt tar is refused before any adb call'
    Assert (-not (Test-Path -LiteralPath (Join-Path $ddata 'files\b.bin'))) 'restore: a corrupt tar leaves the device data as it was'

    # the build gates: release, versionCode and signing mismatches abort before any device write
    foreach ($case in @(
            @{ Name = 'release'; File = 'release'; Value = '1'; Match = 'release-build' },
            @{ Name = 'versioncode'; File = 'vcode'; Value = '1001'; Match = 'build-mismatch.*versionCode' },
            @{ Name = 'signing'; File = 'sig'; Value = 'deadbeef'; Match = 'build-mismatch.*signing' })) {
        Set-Fake $case.File $case.Value
        Remove-Item -LiteralPath (Join-Path $fdir 'calls.txt') -Force -ErrorAction SilentlyContinue
        $gx = Invoke-Restore ('rest-' + $case.Name) @('-Id', 'base1')
        $cc = Get-FakeCalls
        Assert ($gx.Exit -ne 0 -and $gx.Result.verdict -eq 'fail' -and $gx.Result.reason -match $case.Match -and $gx.Result.deviceTouched -eq $false) ('restore: ' + $case.Name + ' gate refuses with a clear reason')
        Assert ($cc -notmatch 'force-stop' -and $cc -notmatch '(^|\n)push ' -and $cc -notmatch 'rm -rf') ('restore: ' + $case.Name + ' gate aborts before any device write')
        Remove-Item -LiteralPath (Join-Path $fdir $case.File) -Force
    }
    Set-Fake 'release' '1'
    $sr = Invoke-Snap 'snap-release' @('-Id', 'rel1')
    Assert ($sr.Exit -ne 0 -and $sr.Result.reason -match 'release-build' -and -not (Test-Path -LiteralPath (Join-Path $sroot 'test\rel1'))) 'snapshot: a release build is refused and leaves no directory'
    Remove-Item -LiteralPath (Join-Path $fdir 'release') -Force

    # transfer damage after the integrity check on the PC: the device hash catches it before the data is replaced
    New-FakeData
    Set-Fake 'corruptpush' '1'
    $rd2 = Invoke-Restore 'rest-badpush' @('-Id', 'base1')
    Assert ($rd2.Exit -ne 0 -and $rd2.Result.reason -match 'changed in transfer' -and $rd2.Result.deviceTouched -eq $false -and (Get-TreeHashes $ddata) -eq $baseHash) 'restore: a tar damaged in transfer is caught by the device hash before the data is replaced'
    Remove-Item -LiteralPath (Join-Path $fdir 'corruptpush') -Force
    Assert (@(Get-ChildItem -LiteralPath (Join-Path $fdir 'remote') -File -ErrorAction SilentlyContinue).Count -eq 0) 'restore: the damaged temp tar is removed from the device'

    # a restore whose result does not match the manifest fails
    Set-Fake 'dropfile' 'files/a.txt'
    $rv = Invoke-Restore 'rest-verify' @('-Id', 'base1')
    Assert ($rv.Exit -ne 0 -and $rv.Result.verdict -eq 'fail' -and $rv.Result.reason -match 'verify-mismatch') 'restore: totals that differ from the manifest fail as verify-mismatch'
    Remove-Item -LiteralPath (Join-Path $fdir 'dropfile') -Force
    Set-Fake 'shrinkfile' 'files/a.txt'
    $rsh = Invoke-Restore 'rest-shrink' @('-Id', 'base1')
    Assert ($rsh.Exit -ne 0 -and $rsh.Result.reason -match 'verify-mismatch.*bytes files') 'restore: a file with the same count but other bytes fails the exact byte comparison'
    Remove-Item -LiteralPath (Join-Path $fdir 'shrinkfile') -Force
    $wantS = @{ Names = @('a'); Kb = [ordered]@{ a = 8 }; Bytes = [ordered]@{ a = 5000 }; Files = 1 }
    $gotSame = @{ Names = @('a'); Kb = [ordered]@{ a = 12 }; Bytes = [ordered]@{ a = 5000 }; Files = 1 }
    $gotOther = @{ Names = @('a'); Kb = [ordered]@{ a = 8 }; Bytes = [ordered]@{ a = 4999 }; Files = 1 }
    Assert ((Compare-AppDataStats $wantS $gotSame).Count -eq 0 -and (Compare-AppDataStats $wantS $gotOther).Count -eq 1) 'compare: equal bytes with other du blocks match; one byte less is a difference'
    $rok = Invoke-Restore 'rest-again' @('-Id', 'base1')
    Assert ($rok.Exit -eq 0 -and (Get-TreeHashes $ddata) -eq $baseHash) 'restore: a repeated restore of the same snapshot passes and gives the same tree'

    # a running app, id guards, free space and size limits
    Set-Fake 'nostop' '1'
    Set-Fake 'pid' '4321'
    $sx = Invoke-Snap 'snap-running' @('-Id', 'run1')
    Assert ($sx.Exit -ne 0 -and $sx.Result.reason -match 'not stopped' -and -not (Test-Path -LiteralPath (Join-Path $sroot 'test\run1'))) 'snapshot: an app that survives force-stop is refused'
    Remove-Item -LiteralPath (Join-Path $fdir 'nostop'), (Join-Path $fdir 'pid') -Force
    $sbad = Invoke-Snap 'snap-badid' @('-Id', '..\escape')
    Assert ($sbad.Exit -ne 0 -and $sbad.Result.reason -match 'bad snapshot id') 'snapshot: a path-like id is refused'
    $sdup = Invoke-Snap 'snap-dup' @('-Id', 'base1')
    Assert ($sdup.Exit -ne 0 -and $sdup.Result.reason -match 'already exists' -and (Test-Path -LiteralPath (Join-Path $sdir 'snapshot.json'))) 'snapshot: an existing id is never overwritten'
    $sref = Invoke-Snap 'snap-refuse' @('-Id', 'big1', '-RefuseBytes', '1000')
    Assert ($sref.Exit -ne 0 -and $sref.Result.reason -match 'refused' -and -not (Test-Path -LiteralPath (Join-Path $sroot 'test\big1'))) 'snapshot: data above the refuse limit is refused before copying'
    $swarn = Invoke-Snap 'snap-warn' @('-Id', 'warn1', '-WarnBytes', '1000')
    Assert ($swarn.Exit -eq 0 -and @($swarn.Result.warnings).Count -eq 1 -and $swarn.Result.warnings[0] -match 'warning') 'snapshot: data above the warn limit passes with a recorded warning'
    Set-Fake 'dfavail' '10'
    $rdf = Invoke-Restore 'rest-nospace' @('-Id', 'base1')
    Assert ($rdf.Exit -ne 0 -and $rdf.Result.reason -match 'not enough free space' -and $rdf.Result.deviceTouched -eq $false) 'restore: too little device space refuses before any change'
    Remove-Item -LiteralPath (Join-Path $fdir 'dfavail') -Force

    # pruning keeps the newest unpinned snapshots and never removes a pinned one
    foreach ($k in 1..4) { $null = Invoke-Snap ('snap-p' + $k) @('-Id', ('p' + $k), '-Keep', '2'); Start-Sleep -Milliseconds 1100 }
    $left = @(Get-ChildItem -LiteralPath (Join-Path $sroot 'test') -Directory | ForEach-Object Name | Sort-Object)
    Assert (($left -join ',') -eq 'base1,p3,p4') ('prune: keeps the pinned snapshot and the newest two, left: ' + ($left -join ','))

    }
    # ---------- stage 3 guards: refusals that must happen before any adb call, and the checks around the data removal ----------
    function Clear-Calls { Remove-Item -LiteralPath (Join-Path $fdir 'calls.txt') -Force -ErrorAction SilentlyContinue }
    function New-ManRoot([string]$Name, [scriptblock]$Edit) {
        $root = Join-Path $work $Name
        $dir = Join-Path $root 'test\base1'
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        Copy-Item -Path (Join-Path $sdir '*') -Destination $dir
        $mm = Get-Content -LiteralPath (Join-Path $dir 'snapshot.json') -Raw | ConvertFrom-Json -AsHashtable
        & $Edit $mm $dir
        [IO.File]::WriteAllText((Join-Path $dir 'snapshot.json'), ($mm | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
        return $root
    }

    if (-not $Fast) {
    # allowlists: a serial or package outside the list is refused with no adb call at all
    Clear-Calls
    $g = Invoke-Restore 'g-rest-serial' @('-Id', 'base1') $sroot 'ZZZ'
    Assert ($g.Exit -ne 0 -and $g.Result.reason -match 'serial ZZZ is not in the allowed list' -and (Get-FakeCalls) -eq '') 'restore: a serial outside the allowed list is refused before any adb call'
    Clear-Calls
    $g = Invoke-Restore 'g-rest-pkg' @('-Id', 'base1', '-Package', 'com.evil.app')
    Assert ($g.Exit -ne 0 -and $g.Result.reason -match 'package com.evil.app is not in the allowed list' -and (Get-FakeCalls) -eq '') 'restore: a package outside the allowed list is refused before any adb call'
    Clear-Calls
    $g = Invoke-Snap 'g-snap-serial' @('-Id', 'g-ser') $sroot 'ZZZ'
    Assert ($g.Exit -ne 0 -and $g.Result.reason -match 'serial ZZZ is not in the allowed list' -and (Get-FakeCalls) -eq '' -and -not (Test-Path -LiteralPath (Join-Path $sroot 'test\g-ser'))) 'snapshot: a serial outside the allowed list is refused before any adb call'
    Clear-Calls
    $g = Invoke-Snap 'g-snap-pkg' @('-Id', 'g-pkg', '-Package', 'com.evil.app')
    Assert ($g.Exit -ne 0 -and $g.Result.reason -match 'package com.evil.app is not in the allowed list' -and (Get-FakeCalls) -eq '' -and -not (Test-Path -LiteralPath (Join-Path $sroot 'test\g-pkg'))) 'snapshot: a package outside the allowed list is refused before any adb call'

    # manifest checks that run on the PC only
    Clear-Calls
    $mroot = New-ManRoot 'g-man-pkg' { param($mm, $dir) $mm.package = 'com.other.app' }
    $g = Invoke-Restore 'g-rest-manpkg' @('-Id', 'base1') $mroot
    Assert ($g.Exit -ne 0 -and $g.Result.reason -match 'belongs to package com.other.app' -and $g.Result.deviceTouched -eq $false -and (Get-FakeCalls) -eq '') 'restore: a manifest for another package is refused before any adb call'
    $mroot = New-ManRoot 'g-man-size' { param($mm, $dir) $fs = [IO.File]::Open((Join-Path $dir 'snapshot.tar'), 'Append'); $fs.WriteByte(0); $fs.Close() }
    Clear-Calls
    $g = Invoke-Restore 'g-rest-size' @('-Id', 'base1') $mroot
    Assert ($g.Exit -ne 0 -and $g.Result.reason -match 'integrity: tar is \d+ bytes, the manifest says' -and (Get-FakeCalls) -eq '') 'restore: a tar whose size differs from the manifest is refused on the size check before any adb call'
    foreach ($bad in @('..', '-rf', '.hidden', 'cache', 'a/b', 'a b')) {
        $mroot = New-ManRoot 'g-man-entry' { param($mm, $dir) $mm.entries = @('files', $bad) }
        Clear-Calls
        $g = Invoke-Restore 'g-rest-entry' @('-Id', 'base1') $mroot
        Assert ($g.Exit -ne 0 -and $g.Result.reason -match 'unsafe entry' -and (Get-FakeCalls) -eq '') ('restore: a manifest entry named ' + $bad + ' is refused before any adb call')
        Remove-Item -LiteralPath $mroot -Recurse -Force
    }

    # name rules, including the end-of-string anchor
    $nl = [string][char]10
    Assert ((Test-SnapshotName 'abc-1.x') -and -not (Test-SnapshotName ('abc' + $nl)) -and -not (Test-SnapshotName '..') -and -not (Test-SnapshotName '-a')) 'name rules: a snapshot id with a trailing newline, dots only or a leading dash is refused'
    Assert ((Test-AppDataEntryName 'app_webview') -and (Test-AppDataEntryName 'a.b-c') -and -not (Test-AppDataEntryName ('files' + $nl))) 'name rules: an entry name with a trailing newline is refused'
    Assert (-not (Test-AppDataEntryName '.hidden') -and -not (Test-AppDataEntryName '-rf') -and -not (Test-AppDataEntryName '..') -and -not (Test-AppDataEntryName 'a/b') -and -not (Test-AppDataEntryName 'a b') -and -not (Test-AppDataEntryName '')) 'name rules: entry names with a leading dot or dash, a slash, a space or none are refused'

    # restore: the app must be down before the push and again right before the data is removed
    Set-Fake 'nostop' '1'
    Set-Fake 'pid' '4321'
    Clear-Calls
    $g = Invoke-Restore 'g-rest-running' @('-Id', 'base1')
    $cc = Get-FakeCalls
    Assert ($g.Exit -ne 0 -and $g.Result.reason -match 'app is not stopped after force-stop' -and $g.Result.deviceTouched -eq $false -and $cc -notmatch '(^|\n)push ' -and $cc -notmatch 'rm -rf') 'restore: an app that survives force-stop is refused before the push and any removal'
    Remove-Item -LiteralPath (Join-Path $fdir 'nostop'), (Join-Path $fdir 'pid') -Force
    Set-Fake 'pushrevive' '1'
    Clear-Calls
    $g = Invoke-Restore 'g-rest-revive' @('-Id', 'base1')
    $cc = Get-FakeCalls
    Assert ($g.Exit -ne 0 -and $g.Result.reason -match 'running again after the push' -and $g.Result.deviceTouched -eq $false -and $cc -match '(^|\n)push ' -and $cc -notmatch 'rm -rf') 'restore: an app that is running again after the push is refused before the data is removed'
    Assert ((Get-TreeHashes $ddata) -eq $baseHash -and @(Get-ChildItem -LiteralPath (Join-Path $fdir 'remote') -File -ErrorAction SilentlyContinue).Count -eq 0) 'restore: a refusal after the push leaves the data as it was and removes the temp tar'
    Remove-Item -LiteralPath (Join-Path $fdir 'pushrevive'), (Join-Path $fdir 'nostop'), (Join-Path $fdir 'pid') -Force

    # restore: a tar -xf that exits nonzero is a failure even when the tree looks complete
    Set-Fake 'xfail' '1'
    $g = Invoke-Restore 'g-rest-xfail' @('-Id', 'base1')
    Assert ($g.Exit -ne 0 -and $g.Result.verdict -eq 'fail' -and $g.Result.reason -match 'tar extraction failed' -and $g.Result.deviceTouched -eq $true) 'restore: a nonzero tar -xf exit fails the restore'
    Remove-Item -LiteralPath (Join-Path $fdir 'xfail') -Force

    # restore after an uninstall and reinstall: the app uid differs from the one in the archive, so a tar that keeps the archived
    # owner fails on chown; the extraction must not take the owner from the archive
    Set-Fake 'chownfail' '1'
    Clear-Calls
    $g = Invoke-Restore 'g-rest-chown' @('-Id', 'base1')
    $cc = Get-FakeCalls
    Assert ($g.Exit -eq 0 -and $g.Result.verdict -eq 'pass' -and (Get-TreeHashes $ddata) -eq $baseHash -and $cc -match 'run-as \S+ tar --no-same-owner -xf ') 'restore: the extraction keeps the current app uid (tar --no-same-owner), so a restore after a reinstall with a new uid passes'
    Remove-Item -LiteralPath (Join-Path $fdir 'chownfail') -Force

    # snapshot: a damaged, incomplete or unstable archive fails and leaves no directory behind
    foreach ($case in @(
            @{ Name = 'blocks'; File = 'tarextra'; Value = '1'; Match = 'whole number of tar blocks' },
            @{ Name = 'count'; File = 'tarexclude'; Value = 'files/a.txt'; Match = 'archive holds 3 files, the device listed 4' },
            @{ Name = 'stable'; File = 'tarmutate'; Value = 'files/a.txt'; Match = 'app data changed while it was archived' })) {
        Set-Fake $case.File $case.Value
        $g = Invoke-Snap ('g-snap-' + $case.Name) @('-Id', ('g-' + $case.Name))
        Assert ($g.Exit -ne 0 -and $g.Result.verdict -eq 'fail' -and $g.Result.reason -match $case.Match) ('snapshot: ' + $case.Name + ' check fails the run with its own reason')
        Assert (-not (Test-Path -LiteralPath (Join-Path $sroot ('test\g-' + $case.Name)))) ('snapshot: a failed ' + $case.Name + ' run leaves no snapshot directory')
        Remove-Item -LiteralPath (Join-Path $fdir $case.File) -Force
    }
    New-FakeData

    # snapshot: a refused id never removes a directory it did not create (another run may still be writing it)
    $pdir = Join-Path $sroot 'test\inprog1'
    New-Item -ItemType Directory -Force -Path $pdir | Out-Null
    [IO.File]::WriteAllText((Join-Path $pdir 'snapshot.tar.partial'), 'in progress')
    Clear-Calls
    $g = Invoke-Snap 'g-snap-inprog' @('-Id', 'inprog1')
    Assert ($g.Exit -ne 0 -and $g.Result.reason -match 'already exists' -and (Get-FakeCalls) -eq '' -and (Test-Path -LiteralPath (Join-Path $pdir 'snapshot.tar.partial')) -and [IO.File]::ReadAllText((Join-Path $pdir 'snapshot.tar.partial')) -eq 'in progress') 'snapshot: a pre-existing in-progress directory survives a refused run with the same id'

    }
    # ---------- stage 3 round 2: a lock held by a live process refuses snapshot and restore, whatever the id ----------
    $lockFile = Join-Path $sroot 'device-FAKE.lock'
    $liveLock = [string]$PID + ',' + (Get-Process -Id $PID).StartTime.Ticks
    New-FakeData
    Clear-Fake
    Set-Fake 'clock' '10-21 12:00:00.000'
    [IO.File]::WriteAllText($lockFile, $liveLock)
    Clear-Calls
    $g = Invoke-Snap 'g-lock-snap-existing' @('-Id', 'base1')
    Assert ($g.Exit -ne 0 -and $g.Result.verdict -eq 'fail' -and $g.Result.reason -match 'another snapshot or restore holds' -and (Get-FakeCalls) -eq '' -and (Test-Path -LiteralPath (Join-Path $sdir 'snapshot.json'))) 'lock: snapshot with an existing id is refused while a live process holds the lock, with no adb call and the snapshot kept'
    $g = Invoke-Snap 'g-lock-snap-new' @('-Id', 'lock-new')
    Assert ($g.Exit -ne 0 -and $g.Result.reason -match 'another snapshot or restore holds' -and (Get-FakeCalls) -eq '' -and -not (Test-Path -LiteralPath (Join-Path $sroot 'test\lock-new'))) 'lock: snapshot with a new id is refused while a live process holds the lock and creates nothing'
    Remove-Item -LiteralPath (Join-Path $ddata 'files\a.txt') -Force
    $g = Invoke-Restore 'g-lock-rest' @('-Id', 'base1')
    Assert ($g.Exit -ne 0 -and $g.Result.verdict -eq 'fail' -and $g.Result.reason -match 'another snapshot or restore holds' -and $g.Result.deviceTouched -eq $false -and (Get-FakeCalls) -eq '' -and -not (Test-Path -LiteralPath (Join-Path $ddata 'files\a.txt'))) 'lock: restore is refused while a live process holds the lock, with no adb call and the device data untouched'
    Assert ([IO.File]::ReadAllText($lockFile) -eq $liveLock) 'lock: a refused run leaves the holder lock file as it was'
    Remove-Item -LiteralPath $lockFile -Force
    $g = Invoke-Restore 'g-lock-rest-free' @('-Id', 'base1')
    Assert ($g.Exit -eq 0 -and $g.Result.verdict -eq 'pass' -and (Test-Path -LiteralPath (Join-Path $ddata 'files\a.txt')) -and -not (Test-Path -LiteralPath $lockFile)) 'lock: the same restore passes once the lock is free and the lock is released afterwards'

    # ---------- stage 4: fixture ceiling, hash-skipping push, import-bin ----------
    $g1 = Get-FixtureGate 1000 1000
    $g2 = Get-FixtureGate 1001 1000
    $g3 = Get-FixtureGate 1001 1000 -AllowLarge
    $g4 = Get-FixtureGate 1001 1000 -AllowLarge -AllowLargeReason '   '
    $g5 = Get-FixtureGate 1001 1000 -AllowLarge -AllowLargeReason 'size test'
    Assert ($g1.Ok -and -not $g1.Warning) 'gate: a fixture at the ceiling is allowed'
    Assert (-not $g2.Ok -and $g2.Reason -match 'data-ceiling' -and $g2.Reason -match '1001' -and $g2.Reason -match '1000') 'gate: a fixture above the ceiling is refused with both numbers'
    Assert (-not $g3.Ok -and -not $g4.Ok -and $g4.Reason -match 'AllowLargeReason') 'gate: -AllowLarge without a reason, or with a blank one, is refused'
    Assert ($g5.Ok -and $g5.Warning -match 'size test') 'gate: -AllowLarge with a reason is allowed and the reason is kept as a warning'
    $g6 = Get-FixtureGate 1001 1000 -AllowLargeReason 'size test'
    Assert (-not $g6.Ok -and $g6.Reason -match 'AllowLarge') 'gate: -AllowLargeReason without -AllowLarge is refused'
    Assert ((Test-RemoteFixtureName 'a-1.bin') -and -not (Test-RemoteFixtureName '..') -and -not (Test-RemoteFixtureName 'a/b') -and -not (Test-RemoteFixtureName 'a b') -and -not (Test-RemoteFixtureName ('a' + [string][char]10))) 'fixture names: a plain name only'
    Assert ((Test-RemoteFixtureDir '/sdcard/Download') -and (Test-RemoteFixtureDir '/sdcard') -and -not (Test-RemoteFixtureDir '/data/local/tmp') -and -not (Test-RemoteFixtureDir '/sdcard/../data') -and -not (Test-RemoteFixtureDir '/sdcard/Download/') -and -not (Test-RemoteFixtureDir '/sdcard/.x')) 'fixture directories: below /sdcard only, no dot segments'
    $ringTable = @(
        @{ Phase = 'import committed, attempt 1'; Done = $true; Pass = $true },
        @{ Phase = 'import committed, attempt 3'; Done = $true; Pass = $true },
        @{ Phase = 'import repaired, attempt 1'; Done = $false; Pass = $false },
        @{ Phase = 'import commit start, attempt 1'; Done = $false; Pass = $false },
        @{ Phase = 'assets copied'; Done = $false; Pass = $false },
        @{ Phase = 'import failed, attempt 1'; Done = $true; Pass = $false },
        @{ Phase = 'import conflict, attempt 2'; Done = $true; Pass = $false },
        @{ Phase = 'import conflict, attempt 1'; Done = $false; Pass = $false },
        @{ Phase = 'import refused, attempt 1'; Done = $false; Pass = $false },
        @{ Phase = 'import refused, attempt 2'; Done = $true; Pass = $false },
        @{ Phase = 'import declined, attempt 1'; Done = $true; Pass = $false },
        @{ Phase = 'import unknown, attempt 1'; Done = $true; Pass = $false },
        @{ Phase = 'import committed'; Done = $false; Pass = $false })
    $tableOk = $true
    foreach ($row in $ringTable) {
        $o = Get-ImportOutcome @(@{ phase = 'walked, 3 entries'; t = 1 }, @{ phase = $row.Phase; t = 2 })
        if ($o.Done -ne $row.Done -or $o.Pass -ne $row.Pass) { $tableOk = $false; Write-Output ('  outcome table row differs: ' + $row.Phase) }
    }
    Assert $tableOk 'ring outcome: only the committed mark passes, the failure statuses fail, pre-commit marks are not terminal'
    # The app retries a conflict and a marker refusal once: the first attempt's mark is not the end, the last attempt's mark is.
    $oRetryOk = Get-ImportOutcome @(@{ phase = 'import conflict, attempt 1'; t = 1 }, @{ phase = 'decoded, attempt 2'; t = 2 }, @{ phase = 'import committed, attempt 2'; t = 3 })
    $oRetryBad = Get-ImportOutcome @(@{ phase = 'import conflict, attempt 1'; t = 1 }, @{ phase = 'decoded, attempt 2'; t = 2 }, @{ phase = 'import conflict, attempt 2'; t = 3 })
    Assert ($oRetryOk.Done -and $oRetryOk.Pass -and $oRetryOk.Reason -eq 'import committed, attempt 2') 'ring retry: a first-attempt conflict followed by a committed second attempt passes'
    Assert ($oRetryBad.Done -and -not $oRetryBad.Pass -and $oRetryBad.Reason -match 'conflict' -and $oRetryBad.Reason -match 'attempt 2') 'ring retry: a conflict that ends the second attempt too fails with the last attempt'
    $colR = New-RingCollector
    $tR = Get-Date
    $pollR = { param($ring, $now) (ConvertTo-Json (ConvertTo-Json @{ ring = $ring; now = $now; epoch = 1; warn = $false } -Depth 5 -Compress) -Compress) }
    Update-RingCollector $colR (& $pollR @(@{ phase = 'decoded, attempt 1'; t = 1000; heapMiB = 1 }, @{ phase = 'import conflict, attempt 1'; t = 2000; heapMiB = 1 }) 3000) $tR
    $dR1 = Get-ImportDone $colR 120
    Assert (-not $dR1.Done) 'ring retry: the app is still retrying shortly after a first-attempt conflict, so the run keeps watching'
    Update-RingCollector $colR (& $pollR @(@{ phase = 'decoded, attempt 1'; t = 1000; heapMiB = 1 }, @{ phase = 'import conflict, attempt 1'; t = 2000; heapMiB = 1 }) 100000) $tR.AddSeconds(97)
    $dR2 = Get-ImportDone $colR 120
    Assert (-not $dR2.Done) 'ring retry: a first-attempt conflict inside the grace time is still not the end'
    Update-RingCollector $colR (& $pollR @(@{ phase = 'decoded, attempt 1'; t = 1000; heapMiB = 1 }, @{ phase = 'import conflict, attempt 1'; t = 2000; heapMiB = 1 }) 130000) $tR.AddSeconds(127)
    $dR3 = Get-ImportDone $colR 120
    Assert ($dR3.Done -and -not $dR3.Pass -and $dR3.Reason -match 'no further attempt started within 120 s') 'ring retry: a first-attempt conflict with no second attempt after the grace time fails'
    # A restart-based done is flagged so the verdict can require proof from the store; a committed mark is not.
    $okM = Get-ImportOutcome @(@{ phase = 'import committed, attempt 1'; t = 1 })
    Assert ($okM.Pass -and -not $okM.Restart) 'ring done: a committed mark is not a restart-based done'
    # verdict: a restart or a boot still loading passes only when the store grew
    $dRestart = @{ Done = $true; Pass = $true; Restart = $true; Reason = 'page restarted after "import commit start, attempt 1"; the ring ends with the page' }
    $dMark = @{ Done = $true; Pass = $true; Restart = $false; Reason = 'import committed, attempt 1' }
    $v1 = Get-ImportVerdict $dRestart @{ store2Entries = 52 } @{ store2Entries = 52 } 'booted' 400
    $v2 = Get-ImportVerdict $dRestart @{ store2Entries = 52 } @{ store2Entries = 6494 } 'booted' 400
    $v3 = Get-ImportVerdict $dRestart @{ store2Entries = 52 } @{ store2Entries = 6494 } 'still-loading' 400
    $v4 = Get-ImportVerdict $dRestart @{ store2Entries = 52 } @{ store2Entries = $null } 'booted' 400
    $v5 = Get-ImportVerdict $dRestart @{ store2Entries = 52 } @{ store2Entries = 40 } 'wizard' 400
    $v6 = Get-ImportVerdict $dMark @{ store2Entries = 52 } @{ store2Entries = 52 } 'still-loading' 400
    $v7 = Get-ImportVerdict $dMark @{ store2Entries = 52 } @{ store2Entries = 52 } 'booted' 400
    $v8 = Get-ImportVerdict @{ Done = $true; Pass = $false; Restart = $false; Reason = 'import ended with failed (import failed, attempt 1)' } @{ store2Entries = 52 } @{ store2Entries = 6494 } 'booted' 400
    Assert ($v1.Verdict -eq 'fail' -and $v1.Reason -match 'did not grow' -and $v1.Reason -match '52 to 52') 'verdict: a page restart with an unchanged store2 entry count does not pass'
    Assert ($v2.Verdict -eq 'pass' -and $v2.Reason -match 'store2 entries 52 to 6494' -and $v2.Reason -match 'boot: booted') 'verdict: a page restart with a grown store2 entry count passes and the reason names the growth and the boot state'
    Assert ($v3.Verdict -eq 'pass' -and $v3.Reason -match 'boot: still-loading') 'verdict: a boot still loading passes only because the store grew, and says so'
    Assert ($v4.Verdict -eq 'fail' -and $v4.Reason -match 'unreadable' -and $v5.Verdict -eq 'fail') 'verdict: an unreadable or shrunk store census after a restart does not pass'
    Assert ($v6.Verdict -eq 'fail' -and $v6.Reason -match 'still loading' -and $v7.Verdict -eq 'pass') 'verdict: a committed mark with a boot still loading needs growth, a committed mark with a finished boot does not'
    Assert ($v8.Verdict -eq 'fail' -and $v8.Reason -match 'failed') 'verdict: a failed import stays failed whatever the store holds'
    Assert ((Get-BootState $true $true) -eq 'wizard' -and (Get-BootState $true $false) -eq 'booted' -and (Get-BootState $false $null) -eq 'still-loading' -and (Get-BootState $true $null) -eq 'unknown') 'boot state: wizard, booted, still-loading and unknown are told apart'
    $col = New-RingCollector
    $t0 = Get-Date
    $poll = { param($ring, $now) (ConvertTo-Json (ConvertTo-Json @{ ring = $ring; now = $now; epoch = 1; warn = $false } -Depth 5 -Compress) -Compress) }
    Update-RingCollector $col (& $poll @(@{ phase = 'a'; t = 1000; heapMiB = 5 }, @{ phase = 'b'; t = 3000; heapMiB = 6 }) 4000) $t0
    Update-RingCollector $col (& $poll @() 9000) $t0.AddSeconds(5)
    Update-RingCollector $col 'not json' $t0.AddSeconds(6)
    $rows = @(Get-RingPhaseRows $col)
    Assert ($rows.Count -eq 2 -and $rows[0].name -eq 'a' -and $rows[0].ringMs -eq 1000 -and $rows[0].durationSec -eq 2 -and $rows[1].durationSec -eq 0 -and $rows[1].heapMiB -eq 6) 'ring collector: marks keep their page times, the last mark has no duration, an emptied ring does not replace the longest snapshot'
    $wallA = [datetime]::Parse($rows[0].startedAt)
    Assert ([math]::Abs(($wallA - $t0.AddSeconds(-3)).TotalSeconds) -lt 0.01 -and $col.Misses -eq 1) 'ring collector: a mark is placed at poll time minus its age on the page clock; unreadable text is counted as a miss'

    $colA = New-RingCollector
    Update-RingCollector $colA (& $poll @() 500) $t0
    Assert (-not $colA.Restarted) 'ring done: an empty ring before any mark is not a page restart'
    Update-RingCollector $colA (& $poll @(@{ phase = 'import commit start, attempt 1'; t = 900; heapMiB = 1 }) 5000) $t0.AddSeconds(1)
    Assert (-not $colA.Restarted -and -not (Get-ImportDone $colA).Done) 'ring done: the commit start alone does not end the import'
    Update-RingCollector $colA (& $poll @() 800) $t0.AddSeconds(2)
    $dA = Get-ImportDone $colA
    Assert ($colA.Restarted -and $dA.Done -and $dA.Pass -and $dA.Reason -match 'page restarted after "import commit start, attempt 1"' -and @($colA.Best).Count -eq 1) 'ring done: a page restart after the commit start ends the import and keeps the marks seen'
    $colB = New-RingCollector
    Update-RingCollector $colB (& $poll @(@{ phase = 'copy 2 of 3 entries'; t = 900; heapMiB = 1 }) 5000) $t0
    Update-RingCollector $colB (& $poll @(@{ phase = 'walked, 3 entries'; t = 100; heapMiB = 1 }) 800) $t0.AddSeconds(2)
    Assert ($colB.Restarted -and -not (Get-ImportDone $colB).Done) 'ring done: a page restart before the commit start does not end the import'

    function Initialize-ImportFake {
        Clear-Fake
        Set-Fake 'clock' '10-21 12:00:00.000'
        Set-Fake 'pid' '5555'
        Set-Fake 'startpid' '5555'
        Set-Fake 'uixml' '<hierarchy><node text="fx.bin" bounds="[10,20][110,60]" /></hierarchy>'
        New-FakeData
        Remove-Item -LiteralPath (Join-Path $fdir 'remote') -Recurse -Force -ErrorAction SilentlyContinue
    }
    function Set-RingPlan($Marks) { Set-Fake 'ringplan' (ConvertTo-Json -InputObject @($Marks) -Depth 5 -Compress) }
    $fxFile = Join-Path $work 'fx.bin'
    $fxBytes = New-Object byte[] 2048
    (New-Object Random 11).NextBytes($fxBytes)
    [IO.File]::WriteAllBytes($fxFile, $fxBytes)
    $importScript = Join-Path $RunnerDir 'import-bin.ps1'
    $pushScript = Join-Path $RunnerDir 'fixture-push.ps1'
    function Invoke-Import([string]$Name, [string[]]$Extra = @(), [int]$Cap = 90, [switch]$DefaultName, [int]$Settle = 1) {
        $o = Join-Path $work $Name
        $a = @('-NoProfile', '-File', $importScript, '-OutDir', $o, '-Serial', 'FAKE', '-AllowedSerials', 'FAKE', '-AdbExe', $fake2, '-RepoRoot', $work,
            '-CdpScript', $fakeCdp, '-PortMin', '9770', '-PortMax', '9789', '-PollSeconds', '1', '-LaunchSettleSec', '1', '-SettleSec', [string]$Settle, '-PickWaitSec', '1',
            '-TapPauseSec', '0.3', '-ConfirmPauseSec', '0.3', '-SnapshotRoot', $sroot, '-MaxSeconds', [string]$Cap) + $Extra
        # Tests that do not exercise the per-run default name give the fixture the fixed name the fake file picker lists.
        if (-not $DefaultName -and $Extra -notcontains '-RemoteName') { $a += @('-RemoteName', 'fx.bin') }
        $null = (& pwsh @a | Out-String)
        $c = $LASTEXITCODE
        $res = $null
        if (Test-Path -LiteralPath (Join-Path $o 'result.json')) { $res = Get-Content -LiteralPath (Join-Path $o 'result.json') -Raw | ConvertFrom-Json -AsHashtable }
        return [pscustomobject]@{ Exit = $c; Result = $res; Out = $o }
    }
    function Invoke-FixturePush([string]$Name, [string[]]$Extra = @(), [string]$UseSerial = 'FAKE') {
        $o = Join-Path $work $Name
        $a = @('-NoProfile', '-File', $pushScript, '-OutDir', $o, '-Serial', $UseSerial, '-AllowedSerials', 'FAKE', '-AdbExe', $fake2, '-RepoRoot', $work) + $Extra
        $null = (& pwsh @a | Out-String)
        $c = $LASTEXITCODE
        $res = $null
        if (Test-Path -LiteralPath (Join-Path $o 'result.json')) { $res = Get-Content -LiteralPath (Join-Path $o 'result.json') -Raw | ConvertFrom-Json -AsHashtable }
        return [pscustomobject]@{ Exit = $c; Result = $res }
    }
    $okRing = @(
        @{ phase = 'walked, 3 entries'; t = 1000; heapMiB = 90 },
        @{ phase = 'copy 2 of 3 entries'; t = 2500; heapMiB = 91 },
        @{ phase = 'assets copied'; t = 4000; heapMiB = 92 },
        @{ phase = 'import repaired, attempt 1'; t = 4100; heapMiB = 92 },
        @{ phase = 'import committed, attempt 1'; t = 4200; heapMiB = 93; fx = 'chars' })
    $remoteFx = Join-Path $fdir 'remote\fx.bin'

    # fixture-push: hash skip, changed content, damaged copy, unreadable device hash, ceiling, removal, path rules
    Initialize-ImportFake
    $p1 = Invoke-FixturePush 'fp-first' @('-FixturePath', $fxFile)
    Assert ($p1.Exit -eq 0 -and $p1.Result.verdict -eq 'pass' -and $p1.Result.push.skipped -eq $false -and (Test-Path -LiteralPath $remoteFx) -and (Get-FileHash -LiteralPath $remoteFx -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $fxFile -Algorithm SHA256).Hash) 'fixture-push: the first push transfers the file and the device copy has the local SHA-256'
    Assert ((Test-ResultSchema $p1.Result).Count -eq 0 -and $p1.Result.data.ceilingBytes -eq 629145600 -and $p1.Result.data.bytes -eq 2048 -and $p1.Result.data.fixture -eq 'fx.bin') 'fixture-push: the result passes the schema and declares file, size and ceiling'
    Clear-Calls
    $p2 = Invoke-FixturePush 'fp-second' @('-FixturePath', $fxFile)
    $cc = Get-FakeCalls
    Assert ($p2.Exit -eq 0 -and $p2.Result.push.skipped -eq $true -and $cc -notmatch '(^|\n)push ' -and $cc -match 'sha256sum /sdcard/Download/fx.bin') 'fixture-push: an unchanged fixture is not transferred again because the device SHA-256 matches'
    [IO.File]::WriteAllBytes($fxFile, $fxBytes + [byte[]](1, 2, 3))
    Clear-Calls
    $p3 = Invoke-FixturePush 'fp-changed' @('-FixturePath', $fxFile)
    Assert ($p3.Exit -eq 0 -and $p3.Result.push.skipped -eq $false -and (Get-FakeCalls) -match '(^|\n)push ' -and (Get-Item -LiteralPath $remoteFx).Length -eq 2051) 'fixture-push: a changed fixture is transferred again'
    # A rebuilt fixture of the same size is the usual case for a regenerated synthetic bin: only the SHA-256 compare tells it apart.
    [IO.File]::WriteAllBytes($fxFile, $fxBytes)
    $null = Invoke-FixturePush 'fp-back' @('-FixturePath', $fxFile)
    $sameSize = [byte[]]$fxBytes.Clone()
    $sameSize[500] = [byte]($sameSize[500] -bxor 1)
    [IO.File]::WriteAllBytes($fxFile, $sameSize)
    Clear-Calls
    $p3s = Invoke-FixturePush 'fp-samesize' @('-FixturePath', $fxFile)
    Assert ($p3s.Exit -eq 0 -and $p3s.Result.push.skipped -eq $false -and (Get-FakeCalls) -match '(^|\n)push ' -and (Get-Item -LiteralPath $remoteFx).Length -eq 2048 -and (Get-FileHash -LiteralPath $remoteFx -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $fxFile -Algorithm SHA256).Hash) 'fixture-push: a changed fixture of the same size is transferred again because the SHA-256 differs'
    [IO.File]::WriteAllBytes($fxFile, $fxBytes)
    Set-Fake 'corruptpush' '1'
    $p4 = Invoke-FixturePush 'fp-damaged' @('-FixturePath', $fxFile)
    Assert ($p4.Exit -ne 0 -and $p4.Result.verdict -eq 'fail' -and $p4.Result.reason -match 'integrity' -and -not (Test-Path -LiteralPath $remoteFx)) 'fixture-push: a copy damaged in transfer fails and is removed from the device'
    Remove-Item -LiteralPath (Join-Path $fdir 'corruptpush') -Force
    Set-Fake 'shaerr' '1'
    Clear-Calls
    $p5 = Invoke-FixturePush 'fp-hasherr' @('-FixturePath', $fxFile)
    Assert ($p5.Exit -ne 0 -and $p5.Result.reason -match 'device hash unreadable' -and (Get-FakeCalls) -notmatch '(^|\n)push ') 'fixture-push: an unreadable device hash fails instead of pushing blindly'
    Remove-Item -LiteralPath (Join-Path $fdir 'shaerr') -Force
    Clear-Calls
    $p6 = Invoke-FixturePush 'fp-ceiling' @('-FixturePath', $fxFile, '-CeilingBytes', '1000')
    Assert ($p6.Exit -ne 0 -and $p6.Result.reason -match 'data-ceiling' -and $p6.Result.data.ceilingBytes -eq 1000 -and (Get-FakeCalls) -eq '') 'fixture-push: a fixture above the declared ceiling is refused before any adb call'
    $p7 = Invoke-FixturePush 'fp-large-noreason' @('-FixturePath', $fxFile, '-CeilingBytes', '1000', '-AllowLarge')
    Assert ($p7.Exit -ne 0 -and $p7.Result.reason -match 'AllowLargeReason' -and (Get-FakeCalls) -eq '') 'fixture-push: -AllowLarge without a reason is refused before any adb call'
    $p7b = Invoke-FixturePush 'fp-reason-only' @('-FixturePath', $fxFile, '-CeilingBytes', '1000', '-AllowLargeReason', 'size test')
    Assert ($p7b.Exit -ne 0 -and $p7b.Result.reason -match 'data-ceiling' -and (Get-FakeCalls) -eq '') 'fixture-push: -AllowLargeReason without -AllowLarge is refused before any adb call'
    $p8 = Invoke-FixturePush 'fp-large-ok' @('-FixturePath', $fxFile, '-CeilingBytes', '1000', '-AllowLarge', '-AllowLargeReason', 'size test')
    Assert ($p8.Exit -eq 0 -and @($p8.Result.warnings).Count -eq 1 -and $p8.Result.warnings[0] -match 'size test') 'fixture-push: -AllowLarge with a reason pushes and records the warning'
    Clear-Calls
    $p9 = Invoke-FixturePush 'fp-baddir' @('-FixturePath', $fxFile, '-RemoteDir', '/data/local/tmp')
    Assert ($p9.Exit -ne 0 -and $p9.Result.reason -match 'bad fixture directory' -and (Get-FakeCalls) -eq '') 'fixture-push: a directory outside /sdcard is refused before any adb call'
    $p10 = Invoke-FixturePush 'fp-badname' @('-FixturePath', $fxFile, '-RemoteName', 'a b')
    Assert ($p10.Exit -ne 0 -and $p10.Result.reason -match 'bad fixture name' -and (Get-FakeCalls) -eq '') 'fixture-push: a name with a space is refused before any adb call'
    $p11 = Invoke-FixturePush 'fp-remove' @('-FixturePath', $fxFile, '-Remove')
    Assert ($p11.Exit -eq 0 -and $p11.Result.push.removed -eq $true -and -not (Test-Path -LiteralPath $remoteFx)) 'fixture-push: -Remove deletes the fixture from the device and reads back that it is gone'
    Clear-Calls
    $p12 = Invoke-FixturePush 'fp-serial' @('-FixturePath', $fxFile) 'ZZZ'
    Assert ($p12.Exit -ne 0 -and $p12.Result.reason -match 'serial ZZZ is not in the allowed list' -and (Get-FakeCalls) -eq '') 'fixture-push: a serial outside the allowed list is refused before any adb call'

    # import-bin: pass from a restored snapshot, with the fixture pushed and then hash-skipped
    Initialize-ImportFake
    Set-RingPlan $okRing
    Set-Fake 'wizard' 'true'
    $manB = Get-Content -LiteralPath (Join-Path $sdir 'snapshot.json') -Raw | ConvertFrom-Json -AsHashtable
    $i1 = Invoke-Import 'imp-pass' @('-FixturePath', $fxFile, '-SnapshotId', 'base1')
    $rr = $i1.Result
    Assert ($i1.Exit -eq 0 -and $rr.verdict -eq 'pass' -and (Test-ResultSchema $rr).Count -eq 0 -and $rr.build.kind -eq 'debug') 'import: the import passes from a restored snapshot and the result passes the schema'
    Assert (@($rr.phases).Count -eq 5 -and (@($rr.phases | ForEach-Object { $_.name }) -join '|') -eq (($okRing | ForEach-Object { $_.phase }) -join '|') -and (@($rr.phases | ForEach-Object { $_.ringMs }) -join ',') -eq '1000,2500,4000,4100,4200') 'import: phases[] carries the ring marks in order with their page times'
    $raw = Get-Content -LiteralPath (Join-Path $i1.Out 'phases.json') -Raw | ConvertFrom-Json
    Assert (@($raw).Count -eq 5 -and $raw[1].phase -eq 'copy 2 of 3 entries' -and $raw[1].t -eq 2500 -and $raw[4].heapMiB -eq 93 -and $rr.evidence.phasesJson -eq (Join-Path $i1.Out 'phases.json')) 'import: phases.json holds the raw ring in the established collector shape'
    Assert ($rr.phases[0].heapMiB -eq 90 -and $rr.phases[0].durationSec -eq 1.5 -and $rr.phases[4].durationSec -eq 0) 'import: heap and the duration to the next mark are recorded per phase'
    Assert ($rr.start.chaIdTokens -eq 0 -and $rr.atDone.chaIdTokens -eq 485 -and $rr.end.chaIdTokens -eq 485 -and $rr.start.store2Entries -eq 52 -and $rr.import.wizardShown -eq $true -and $rr.import.bootState -eq 'wizard' -and $rr.import.seconds -gt 0) 'import: the read-only census before and after, the wizard observation, the boot state and the import seconds are recorded'
    Assert (-not $rr.start.Contains('characters') -and $rr.start.note -match 'not a character count' -and $rr.reason -notmatch 'characters') 'import: the census does not present a character count, and the pass reason carries none'
    Assert ($rr.startState.snapshotId -eq 'base1' -and $rr.startState.snapshotSha256 -eq $manB.sha256 -and $rr.startState.basis -match 'snapshot') 'import: the same starting state rests on the snapshot hash and the restore verification, and the result says so'
    Assert ($rr.snapshot.id -eq 'base1' -and $rr.snapshot.sha256 -eq $manB.sha256 -and (@($rr.steps | ForEach-Object { $_.name }) -join ',') -eq 'fixture,restore,launch,ui,import,settle') 'import: the snapshot id and hash are recorded and the steps run fixture, restore, launch, ui, import, settle'
    $cc = Get-FakeCalls
    Assert ($cc -match 'input tap 62 157' -and $cc -match 'input tap 264 1210' -and $cc -match 'input tap 60 40' -and $rr.measure.set -eq $true -and $rr.fixture.pushSkipped -eq $false) 'import: the menu taps, the file tap computed from the picker bounds and the measurement flag are used'
    $ci = $cc.IndexOf('risu-restore'); $ca = $cc.IndexOf('am start -W')
    Assert ($ci -ge 0 -and $ca -gt $ci) 'import: the snapshot is restored before the app is launched'
    Assert (-not ([IO.File]::ReadAllText((Join-Path $fdir 'forwards.txt')) -match 'webview_devtools_remote')) 'import: the forward it made is removed at the end'
    Initialize-ImportFake
    Set-RingPlan $okRing
    Clear-Calls
    $i1b = Invoke-Import 'imp-skip' @('-FixturePath', $fxFile, '-NoRestore')
    Assert ($i1b.Exit -eq 0 -and $i1b.Result.verdict -eq 'pass' -and $i1b.Result.fixture.pushSkipped -eq $false) 'import: -NoRestore starts without a snapshot and records none'
    Set-RingPlan $okRing
    Set-Fake 'ringcalls' '0'
    Clear-Calls
    $i1c = Invoke-Import 'imp-skip2' @('-FixturePath', $fxFile, '-NoRestore')
    $cc = Get-FakeCalls
    Assert ($i1c.Exit -eq 0 -and $i1c.Result.fixture.pushSkipped -eq $true -and $cc -notmatch '(^|\n)push ' -and $cc -notmatch 'risu-restore' -and $null -eq $i1c.Result.snapshot) 'import: a fixture already on the device is not pushed again and -NoRestore never calls the restore'

    # the app reloads its page after the commit: the ring ends with the commit start, and the import is done at the restart
    $restartRing = @(@{ phase = 'walked, 3 entries'; t = 1000; heapMiB = 90 }, @{ phase = 'copy 2 of 3 entries'; t = 2500; heapMiB = 91 }, @{ phase = 'import commit start, attempt 1'; t = 4000; heapMiB = 92; fx = 'restart' })
    Initialize-ImportFake
    Set-RingPlan $restartRing
    Set-Fake 'wizard' 'true'
    $r1 = Invoke-Import 'imp-restart' @('-FixturePath', $fxFile, '-SnapshotId', 'base1')
    $rr = $r1.Result
    Assert ($r1.Exit -eq 0 -and $rr.verdict -eq 'pass' -and $rr.import.outcome -match 'page restarted after' -and @($rr.phases).Count -eq 3 -and $rr.phases[2].name -eq 'import commit start, attempt 1') 'import: a page restart after the commit start passes when the store grew, and the phases end with that mark'
    Assert ($rr.reason -match 'store2 entries 52 to 6494' -and $rr.import.restartBased -eq $true -and $rr.end.store2Entries -eq 6494) 'import: the pass reason after a restart names the store growth'
    Assert ($rr.end.chaIdTokens -eq 485 -and $rr.import.bootFinished -eq $true -and $rr.import.wizardShown -eq $true -and $rr.import.bootState -eq 'wizard') 'import: the census after the restart and the wizard observation are recorded once the boot is through'
    Initialize-ImportFake
    Set-RingPlan $restartRing
    Set-Fake 'wizard' 'true'
    Set-Fake 'nogrow' '1'
    $r1n = Invoke-Import 'imp-restart-nogrow' @('-FixturePath', $fxFile, '-SnapshotId', 'base1')
    Assert ($r1n.Exit -ne 0 -and $r1n.Result.verdict -eq 'fail' -and $r1n.Result.reason -match 'store did not grow' -and $r1n.Result.reason -match '52 to 52' -and $r1n.Result.import.bootState -eq 'wizard' -and @($r1n.Result.phases).Count -eq 3) 'import: a page restart after the commit start with an unchanged store2 entry count fails and keeps the marks and the boot state'
    Initialize-ImportFake
    Set-RingPlan $restartRing
    Set-Fake 'wizard' 'true'
    Set-Fake 'bootdone' 'false'
    $r2 = Invoke-Import 'imp-bootwait' @('-FixturePath', $fxFile, '-SnapshotId', 'base1', '-BootWaitSec', '2')
    Assert ($r2.Exit -eq 0 -and $r2.Result.verdict -eq 'pass' -and $r2.Result.import.bootFinished -eq $false -and $null -eq $r2.Result.import.wizardShown -and $r2.Result.import.bootWaitedSec -ge 2 -and $r2.Result.import.bootState -eq 'still-loading') 'import: a boot that does not finish in time leaves the wizard observation empty instead of guessing, passes only because the store grew, and records still-loading'
    Initialize-ImportFake
    Set-RingPlan $restartRing
    Set-Fake 'bootdone' 'false'
    Set-Fake 'nogrow' '1'
    $r2n = Invoke-Import 'imp-bootwait-nogrow' @('-FixturePath', $fxFile, '-SnapshotId', 'base1', '-BootWaitSec', '2')
    Assert ($r2n.Exit -ne 0 -and $r2n.Result.verdict -eq 'fail' -and $r2n.Result.import.bootState -eq 'still-loading' -and $r2n.Result.reason -match 'did not grow') 'import: a boot still loading after a restart without any store growth fails'
    Initialize-ImportFake
    Set-RingPlan @(@{ phase = 'walked, 3 entries'; t = 1000; heapMiB = 90; fx = 'restart' })
    $r3 = Invoke-Import 'imp-restart-early' @('-FixturePath', $fxFile, '-SnapshotId', 'base1') 35
    Assert ($r3.Exit -ne 0 -and $r3.Result.verdict -eq 'timeout') 'import: a page restart before the commit start is not a finished import'
    Initialize-ImportFake
    Set-RingPlan @(@{ phase = 'walked, 3 entries'; t = 1000; heapMiB = 90 }, @{ phase = 'import planned'; t = 2000; heapMiB = 90; fx = 'restart' })
    $r3b = Invoke-Import 'imp-restart-planned' @('-FixturePath', $fxFile, '-SnapshotId', 'base1') 35
    Assert ($r3b.Exit -ne 0 -and $r3b.Result.verdict -eq 'timeout' -and $r3b.Result.verdict -ne 'pass') 'import: a page restart after only pre-commit marks with store2 growth is not a finished import and does not pass'

    # the notice dismissal: only an alert box that offers a single OK button is clicked, never a confirm dialog
    $noticeStub = Join-Path $work 'noticestub.cjs'
    New-Cmd $noticeStub @(
        'const fs = require("fs")',
        'const expr = fs.readFileSync(process.argv[2], "utf8")',
        'const log = []',
        'const koOk = String.fromCharCode(0xD655, 0xC778), koYes = String.fromCharCode(0xC608), koNo = String.fromCharCode(0xC544, 0xB2C8, 0xC694)',
        'const btn = (t, name) => ({ innerText: t, click: () => log.push(name) })',
        'const mk = (text, buttons, inputs) => ({ innerText: text, querySelectorAll: (sel) => sel === "button" ? buttons : /input/.test(sel) ? (inputs || []) : [] })',
        'const warnText = "This backup holds 3 GB of data. Continue?"',
        'const scenes = {',
        '  okEn: [mk("To keep memory use low, this app now stores each character separately.", [btn("OK", "notice-ok")])],',
        '  okKo: [mk("notice", [btn(koOk, "notice-ko")])],',
        '  okLower: [mk("notice", [btn("ok", "notice-lower")])],',
        '  confirm: [mk("Some items are incomplete. Leave them out?", [btn("Yes", "leave-yes"), btn("No", "leave-no")])],',
        '  confirmKo: [mk("notice", [btn(koYes, "ko-yes"), btn(koNo, "ko-no")])],',
        '  warn: [mk(warnText, [btn("No", "warn-no"), btn("Yes", "warn-yes")])],',
        '  warnOkOnly: [mk(warnText, [btn("OK", "warn-ok")])],',
        '  yesOnly: [mk("notice", [btn("Yes", "lone-yes")])],',
        '  okTwice: [mk("notice", [btn("OK", "ok-a"), btn("OK", "ok-b")])],',
        '  okAndInput: [mk("name?", [btn("OK", "input-ok")], [{}])],',
        '  cancelOnly: [mk("working", [btn("Cancel", "cancel")])],',
        '  confirmThenNotice: [mk("Some items are incomplete. Leave them out?", [btn("Yes", "leave-yes"), btn("No", "leave-no")]), mk("notice text", [btn("OK", "notice-ok")])],',
        '  noticeThenConfirm: [mk("notice text", [btn("OK", "notice-ok")]), mk(warnText, [btn("No", "warn-no"), btn("Yes", "warn-yes")])],',
        '  none: []',
        '}',
        'const boxes = scenes[process.argv[3]]',
        'globalThis.document = { querySelectorAll: (sel) => sel === "[data-alert-box]" ? boxes : [] }',
        'Promise.resolve(eval(expr)).then((v) => console.log(JSON.stringify({ v, log })))')
    $noticeExprFile = Join-Path $work 'notice-expr.txt'
    $noticeWarn = 'This backup holds'
    [IO.File]::WriteAllText($noticeExprFile, (Get-NoticeDismissExpression $noticeWarn))
    function Invoke-NoticeStub([string]$Scene) { return ((& node $noticeStub $noticeExprFile $Scene | Out-String).Trim() | ConvertFrom-Json) }
    $ns = @{}
    foreach ($scene in @('okEn', 'okKo', 'okLower', 'confirm', 'confirmKo', 'warn', 'warnOkOnly', 'yesOnly', 'okTwice', 'okAndInput', 'cancelOnly', 'confirmThenNotice', 'noticeThenConfirm', 'none')) { $ns[$scene] = Invoke-NoticeStub $scene }
    Assert ($ns.okEn.v -match '^dismissed:To keep memory use low' -and (@($ns.okEn.log) -join ',') -eq 'notice-ok') 'notice: a box with one OK button is dismissed and its text is returned'
    Assert ((@($ns.okKo.log) -join ',') -eq 'notice-ko' -and $ns.okKo.v -match '^dismissed:') 'notice: the Korean OK label dismisses the notice'
    Assert ((@($ns.okLower.log) -join ',') -eq 'notice-lower') 'notice: the OK label matches in any case'
    foreach ($never in @('confirm', 'confirmKo', 'warn', 'warnOkOnly', 'yesOnly', 'okTwice', 'okAndInput', 'cancelOnly', 'none')) {
        Assert ($ns[$never].v -eq 'none' -and @($ns[$never].log).Count -eq 0) ('notice: nothing is clicked in the scene ' + $never)
    }
    Assert ((@($ns.confirmThenNotice.log) -join ',') -eq 'notice-ok' -and (@($ns.noticeThenConfirm.log) -join ',') -eq 'notice-ok') 'notice: with a confirm dialog and a notice both open only the notice is dismissed, whichever comes first'

    # the post-import notices: the archive-characters notice after the reload holds the boot, and the old launch-only OK click missed it
    $noticeText = 'To keep memory use low, this app now stores each character separately.'
    Initialize-ImportFake
    Set-RingPlan $restartRing
    Set-Fake 'notices' $noticeText
    Set-Fake 'noticegate' 'restarted'
    Set-Fake 'bootblock' '1'
    $nb1 = Invoke-Import 'imp-notice-boot' @('-FixturePath', $fxFile, '-SnapshotId', 'base1', '-BootWaitSec', '15')
    Assert ($nb1.Exit -eq 0 -and $nb1.Result.verdict -eq 'pass' -and $nb1.Result.import.bootFinished -eq $true -and $nb1.Result.import.bootState -eq 'booted' -and @($nb1.Result.import.noticesDismissed).Count -eq 1 -and $nb1.Result.import.noticesDismissed[0] -match '^To keep memory use low') 'import: a notice that holds the boot after the reload is dismissed, the boot finishes and the notice text is recorded'
    Initialize-ImportFake
    Set-RingPlan $restartRing
    Set-Fake 'notices' $noticeText
    Set-Fake 'noticegate' 'booting'
    Set-Fake 'bootblock' '1'
    $nb4 = Invoke-Import 'imp-notice-booting' @('-FixturePath', $fxFile, '-SnapshotId', 'base1', '-BootWaitSec', '15')
    Assert ($nb4.Exit -eq 0 -and $nb4.Result.import.bootFinished -eq $true -and $nb4.Result.import.bootState -eq 'booted' -and @($nb4.Result.import.noticesDismissed).Count -eq 1) 'import: a notice that first shows during the boot wait is dismissed by the boot wait itself'
    Initialize-ImportFake
    Set-RingPlan $restartRing
    Set-Fake 'notices' ($noticeText + "`n" + 'The second notice.')
    $nb2 = Invoke-Import 'imp-notice-launch' @('-FixturePath', $fxFile, '-SnapshotId', 'base1')
    Assert ($nb2.Exit -eq 0 -and $nb2.Result.verdict -eq 'pass' -and @($nb2.Result.import.noticesDismissed).Count -eq 2 -and $nb2.Result.import.noticesDismissed[1] -eq 'The second notice.') 'import: notices shown at launch are dismissed one after the other and recorded'
    Initialize-ImportFake
    Set-RingPlan $restartRing
    $nb3 = Invoke-Import 'imp-notice-none' @('-FixturePath', $fxFile, '-SnapshotId', 'base1')
    Assert ($nb3.Exit -eq 0 -and @($nb3.Result.import.noticesDismissed).Count -eq 0) 'import: no notice is recorded when none showed'

    # crash injected by the harness (the fake drops the app pid like am force-stop), cap, terminal failure
    Initialize-ImportFake
    Set-RingPlan @(@{ phase = 'walked, 3 entries'; t = 1000; heapMiB = 90 }, @{ phase = 'copy 2 of 3 entries'; t = 2500; heapMiB = 91; fx = 'forcestop' }, @{ phase = 'assets copied'; t = 4000; heapMiB = 92 })
    $i2 = Invoke-Import 'imp-crash' @('-FixturePath', $fxFile, '-SnapshotId', 'base1')
    Assert ($i2.Exit -ne 0 -and $i2.Result.verdict -eq 'crash' -and $i2.Result.reason -match 'app process gone' -and @($i2.Result.phases).Count -ge 1) 'import: a loss of the app process during the import returns crash and keeps the phases seen so far'
    # the app is lost during the census at done (start, at done, final): the settle wait then takes one absent poll, so only the
    # stop check after the final census reaches the second consecutive absent poll that makes it a crash
    Initialize-ImportFake
    Set-RingPlan $okRing
    Set-Fake 'lsdrop' '2'
    $i2f = Invoke-Import 'imp-final-census-crash' @('-FixturePath', $fxFile, '-SnapshotId', 'base1')
    Assert ($i2f.Exit -ne 0 -and $i2f.Result.verdict -eq 'crash' -and $i2f.Result.verdict -ne 'pass' -and $i2f.Result.reason -match 'app process gone') 'import: a loss of the app process during the final census returns crash, not pass'
    Initialize-ImportFake
    Set-RingPlan @(@{ phase = 'walked, 3 entries'; t = 1000; heapMiB = 90 })
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $i3 = Invoke-Import 'imp-timeout' @('-FixturePath', $fxFile, '-SnapshotId', 'base1') 35
    $sw.Stop()
    Assert ($i3.Exit -ne 0 -and $i3.Result.verdict -eq 'timeout' -and $i3.Result.reason -match 'cap of 35 s' -and $sw.Elapsed.TotalSeconds -lt 70 -and $i3.Result.capSec -eq 35) 'import: a run past its cap returns timeout'
    Initialize-ImportFake
    Set-RingPlan @(@{ phase = 'walked, 3 entries'; t = 1000; heapMiB = 90 }, @{ phase = 'import failed, attempt 1'; t = 2000; heapMiB = 91 })
    $i4 = Invoke-Import 'imp-failed' @('-FixturePath', $fxFile, '-SnapshotId', 'base1')
    Assert ($i4.Exit -ne 0 -and $i4.Result.verdict -eq 'fail' -and $i4.Result.reason -match 'import ended with failed') 'import: an import that ends with a failure status fails with that status'
    Initialize-ImportFake
    Set-RingPlan $okRing
    Set-Fake 'warnat' '3'
    $i5 = Invoke-Import 'imp-warn' @('-FixturePath', $fxFile, '-SnapshotId', 'base1')
    Assert ($i5.Exit -eq 0 -and $i5.Result.import.warnConfirmed -eq $true -and (Test-Path -LiteralPath (Join-Path $fdir 'yes'))) 'import: the size warning of the app is confirmed through the app UI'
    Initialize-ImportFake
    Set-RingPlan (@(@{ phase = 'walked, 3 entries'; t = 1000; heapMiB = 90 }) * 10 + $okRing)
    Set-Fake 'warnat' '2'
    Set-Fake 'yesswallow' '1'
    $i5b = Invoke-Import 'imp-warn-swallowed' @('-FixturePath', $fxFile, '-SnapshotId', 'base1')
    Assert ($i5b.Exit -eq 0 -and $i5b.Result.import.warnClicks -eq 2 -and (Test-Path -LiteralPath (Join-Path $fdir 'yes'))) 'import: a confirm click that the dialog did not take is repeated while the warning still shows'
    Initialize-ImportFake
    Set-Fake 'uixml' '<hierarchy><node text="other.bin" bounds="[10,20][110,60]" /></hierarchy>'
    $i6 = Invoke-Import 'imp-nopick' @('-FixturePath', $fxFile, '-SnapshotId', 'base1')
    Assert ($i6.Exit -ne 0 -and $i6.Result.reason -match 'file-not-in-picker') 'import: a fixture missing from the file picker fails'

    # the data ceiling, declared per check, and the start-state rule: both abort before launch (and before any adb call)
    Initialize-ImportFake
    Set-RingPlan $okRing
    Clear-Calls
    $c1 = Invoke-Import 'imp-ceiling' @('-FixturePath', $fxFile, '-SnapshotId', 'base1', '-CeilingBytes', '1000')
    Assert ($c1.Exit -ne 0 -and $c1.Result.verdict -eq 'fail' -and $c1.Result.reason -match 'data-ceiling' -and $c1.Result.data.ceilingBytes -eq 1000 -and $c1.Result.data.bytes -eq 2048 -and (Get-FakeCalls) -eq '') 'import: a fixture above the declared ceiling aborts before launch and before any adb call'
    $c2 = Invoke-Import 'imp-ceiling-flag' @('-FixturePath', $fxFile, '-SnapshotId', 'base1', '-CeilingBytes', '1000', '-AllowLarge')
    Assert ($c2.Exit -ne 0 -and $c2.Result.reason -match 'AllowLargeReason' -and (Get-FakeCalls) -eq '') 'import: -AllowLarge without a reason still aborts before any adb call'
    $c2b = Invoke-Import 'imp-ceiling-reason-only' @('-FixturePath', $fxFile, '-SnapshotId', 'base1', '-CeilingBytes', '1000', '-AllowLargeReason', 'size test')
    Assert ($c2b.Exit -ne 0 -and $c2b.Result.reason -match 'data-ceiling' -and (Get-FakeCalls) -eq '') 'import: -AllowLargeReason without -AllowLarge aborts before any adb call'
    $c3 = Invoke-Import 'imp-ceiling-ok' @('-FixturePath', $fxFile, '-SnapshotId', 'base1', '-CeilingBytes', '1000', '-AllowLarge', '-AllowLargeReason', 'size test')
    Assert ($c3.Exit -eq 0 -and $c3.Result.verdict -eq 'pass' -and @($c3.Result.warnings).Count -eq 1 -and $c3.Result.warnings[0] -match 'size test') 'import: -AllowLarge with a reason runs and records the warning'
    Initialize-ImportFake
    Clear-Calls
    $c4 = Invoke-Import 'imp-nostart' @('-FixturePath', $fxFile)
    Assert ($c4.Exit -ne 0 -and $c4.Result.reason -match 'start-state' -and (Get-FakeCalls) -eq '') 'import: neither -SnapshotId nor -NoRestore is refused before any adb call'
    $c5 = Invoke-Import 'imp-bothstart' @('-FixturePath', $fxFile, '-SnapshotId', 'base1', '-NoRestore')
    Assert ($c5.Exit -ne 0 -and $c5.Result.reason -match 'exclude each other' -and (Get-FakeCalls) -eq '') 'import: -SnapshotId together with -NoRestore is refused'
    $c6 = Invoke-Import 'imp-nosnap' @('-FixturePath', $fxFile, '-SnapshotId', 'nope')
    Assert ($c6.Exit -ne 0 -and $c6.Result.reason -match 'restore-snapshot' -and (Get-FakeCalls) -notmatch 'am start') 'import: a restore that fails stops the run before the app is launched'
    Set-Fake 'release' '1'
    Clear-Calls
    $c7 = Invoke-Import 'imp-release' @('-FixturePath', $fxFile, '-SnapshotId', 'base1')
    Assert ($c7.Exit -ne 0 -and $c7.Result.reason -match 'release-build' -and (Get-FakeCalls) -notmatch 'force-stop|(^|\n)push ') 'import: a release build is refused before any device change'
    Remove-Item -LiteralPath (Join-Path $fdir 'release') -Force
    $c8 = Invoke-Import 'imp-baddir' @('-FixturePath', $fxFile, '-SnapshotId', 'base1', '-RemoteDir', '/data/local/tmp')
    Assert ($c8.Exit -ne 0 -and $c8.Result.reason -match 'bad fixture directory') 'import: a fixture directory outside /sdcard is refused'

    # a fixture already on the device is gated by its device size: after read-only calls only, before any write, restore or launch
    Initialize-ImportFake
    Set-RingPlan $okRing
    New-Item -ItemType Directory -Force -Path (Join-Path $fdir 'remote') | Out-Null
    [IO.File]::WriteAllBytes($remoteFx, $fxBytes)
    Clear-Calls
    $dv1 = Invoke-Import 'imp-dev-ceiling' @('-SnapshotId', 'base1', '-CeilingBytes', '1000')
    $dvCalls = @((Get-FakeCalls) -split '\r?\n' | Where-Object { $_ })
    # The calls that precede the gate: server start, device state and identity, battery, free space, WebView, build info, the size read.
    $dvReadOnly = $dvCalls | Where-Object { $_ -notmatch '^(start-server$|get-state$|shell (getprop ro\.product\.model$|getprop ro\.build\.version\.release$|dumpsys battery$|df /data$|dumpsys webviewupdate$|dumpsys package \S+$|stat -c %s \S+$))' }
    Assert ($dv1.Exit -ne 0 -and $dv1.Result.verdict -eq 'fail' -and $dv1.Result.reason -match 'data-ceiling' -and $dv1.Result.data.bytes -eq 2048 -and $dvCalls.Count -gt 0 -and @($dvReadOnly).Count -eq 0) 'import: a device-side fixture above the ceiling aborts after read-only calls only, with no write, restore or launch'
    Assert (@($dvCalls | Where-Object { $_ -match 'stat -c %s' }).Count -eq 1) 'import: the device-side size is read once, by the call that precedes the gate'
    Initialize-ImportFake
    Set-RingPlan $okRing
    New-Item -ItemType Directory -Force -Path (Join-Path $fdir 'remote') | Out-Null
    [IO.File]::WriteAllBytes($remoteFx, $fxBytes)
    Clear-Calls
    $dv2 = Invoke-Import 'imp-dev-ok' @('-SnapshotId', 'base1')
    Assert ($dv2.Exit -eq 0 -and $dv2.Result.verdict -eq 'pass' -and $dv2.Result.data.bytes -eq 2048 -and (Get-FakeCalls) -notmatch 'push [^\n]*/sdcard/Download/fx\.bin' -and (Test-Path -LiteralPath $remoteFx)) 'import: a device-side fixture within the ceiling is used as it is, not pushed and not removed'
    Initialize-ImportFake
    Set-RingPlan $okRing
    New-Item -ItemType Directory -Force -Path (Join-Path $fdir 'remote') | Out-Null
    [IO.File]::WriteAllBytes($remoteFx, $fxBytes)
    $dv3 = Invoke-Import 'imp-dev-reason-only' @('-SnapshotId', 'base1', '-CeilingBytes', '1000', '-AllowLargeReason', 'size test')
    Assert ($dv3.Exit -ne 0 -and $dv3.Result.reason -match 'data-ceiling') 'import: a device-side fixture above the ceiling is not allowed by a reason alone'

    # the app dies during the settle wait after the import was seen done: the run is a crash, not a pass
    Initialize-ImportFake
    Set-RingPlan (@($okRing[0..3]) + @(@{ phase = 'import committed, attempt 1'; t = 4200; heapMiB = 93; fx = 'forcestop' }))
    $st1 = Invoke-Import 'imp-settle-crash' @('-FixturePath', $fxFile, '-SnapshotId', 'base1') -Settle 10
    Assert ($st1.Exit -ne 0 -and $st1.Result.verdict -eq 'crash' -and $st1.Result.reason -match 'app process gone' -and @($st1.Result.phases).Count -eq 5) 'import: a loss of the app process during the settle wait after done returns crash'

    # a retried commit: a first-attempt conflict is not the end while the app rebuilds, the last attempt decides
    Initialize-ImportFake
    Set-RingPlan @(@{ phase = 'decoded, attempt 1'; t = 1000; heapMiB = 90 }, @{ phase = 'import conflict, attempt 1'; t = 2000; heapMiB = 91 }, @{ phase = 'decoded, attempt 2'; t = 3000; heapMiB = 90 }, @{ phase = 'import committed, attempt 2'; t = 4000; heapMiB = 92 })
    $rt1 = Invoke-Import 'imp-retry-ok' @('-FixturePath', $fxFile, '-SnapshotId', 'base1')
    Assert ($rt1.Exit -eq 0 -and $rt1.Result.verdict -eq 'pass' -and $rt1.Result.import.outcome -eq 'import committed, attempt 2' -and @($rt1.Result.phases).Count -eq 4) 'import: a first-attempt conflict followed by a committed second attempt passes'
    Initialize-ImportFake
    Set-RingPlan @(@{ phase = 'decoded, attempt 1'; t = 1000; heapMiB = 90 }, @{ phase = 'import conflict, attempt 1'; t = 2000; heapMiB = 91 }, @{ phase = 'decoded, attempt 2'; t = 3000; heapMiB = 90 }, @{ phase = 'import conflict, attempt 2'; t = 4000; heapMiB = 92 })
    $rt2 = Invoke-Import 'imp-retry-fail' @('-FixturePath', $fxFile, '-SnapshotId', 'base1')
    Assert ($rt2.Exit -ne 0 -and $rt2.Result.verdict -eq 'fail' -and $rt2.Result.reason -match 'conflict' -and $rt2.Result.reason -match 'attempt 2') 'import: a conflict on the second attempt too fails with that attempt'

    # the confirm click: the warning is rechecked in the same page evaluation and only the confirm of that alert box is clicked
    $stubJs = Join-Path $work 'confirmstub.cjs'
    New-Cmd $stubJs @(
        'const fs = require("fs")',
        'const expr = fs.readFileSync(process.argv[2], "utf8")',
        'const log = []',
        'const mk = (text, buttons) => ({ innerText: text, querySelectorAll: () => buttons })',
        'const btn = (t, name) => ({ innerText: t, click: () => log.push(name) })',
        'const warnBox = () => mk("This backup holds 3 GB of data. Continue?", [btn("No", "warn-no"), btn("Yes", "warn-yes")])',
        'const otherBox = () => mk("Some items are incomplete. Leave them out?", [btn("Yes", "other-yes"), btn("No", "other-no")])',
        'const engBox = () => mk("This backup holds 3 GB of data. Continue?", [btn("NO", "eng-no"), btn("YES", "eng-yes")])',
        'const korBox = () => mk("This backup holds 3 GB of data. Continue?", [btn("\uC544\uB2C8\uC694", "kor-no"), btn("\uC608", "kor-yes")])',
        'const scenes = { warn: [warnBox()], replaced: [otherBox()], both: [otherBox(), warnBox()], warnfirst: [warnBox(), otherBox()], english: [engBox()], korean: [korBox()], none: [] }',
        'const boxes = scenes[process.argv[3]]',
        'globalThis.document = { querySelectorAll: (sel) => sel === "[data-alert-box]" ? boxes : sel === "button" ? boxes.flatMap((b) => b.querySelectorAll()) : [] }',
        'Promise.resolve(eval(expr)).then((v) => console.log(JSON.stringify({ v, log })))')
    $exprFile = Join-Path $work 'confirm-expr.txt'
    [IO.File]::WriteAllText($exprFile, (Get-ConfirmClickExpression 'This backup holds|\uC774 \uBC31\uC5C5'))
    function Invoke-ConfirmStub([string]$Scene) { return ((& node $stubJs $exprFile $Scene | Out-String).Trim() | ConvertFrom-Json) }
    $sc1 = Invoke-ConfirmStub 'warn'
    $sc2 = Invoke-ConfirmStub 'replaced'
    $sc3 = Invoke-ConfirmStub 'both'
    $sc4 = Invoke-ConfirmStub 'none'
    $sc5 = Invoke-ConfirmStub 'warnfirst'
    $sc6 = Invoke-ConfirmStub 'english'
    $sc7 = Invoke-ConfirmStub 'korean'
    Assert ($sc5.v -eq 'clicked' -and (@($sc5.log) -join ',') -eq 'warn-yes') 'confirm click: with the warning dialog first and another dialog whose Yes comes last in the document, only the warning dialog is confirmed'
    Assert ($sc6.v -eq 'clicked' -and (@($sc6.log) -join ',') -eq 'eng-yes') 'confirm click: the English UI labels (YES, NO) match, case-insensitively'
    Assert ($sc7.v -eq 'clicked' -and (@($sc7.log) -join ',') -eq 'kor-yes') 'confirm click: the Korean UI label matches'
    Assert ($sc1.v -eq 'clicked' -and (@($sc1.log) -join ',') -eq 'warn-yes') 'confirm click: the Yes of the size-warning dialog is clicked'
    Assert ($sc2.v -eq 'none' -and @($sc2.log).Count -eq 0) 'confirm click: a different dialog that replaced the warning is not confirmed'
    Assert ($sc3.v -eq 'clicked' -and (@($sc3.log) -join ',') -eq 'warn-yes') 'confirm click: with two dialogs open only the confirm of the warning dialog is clicked'
    Assert ($sc4.v -eq 'none' -and @($sc4.log).Count -eq 0) 'confirm click: nothing is clicked when no dialog shows'

    # the device lock is held for the whole run; the fixture name carries the run id unless it is given
    $lockHolder = [string]$PID + ',' + (Get-Process -Id $PID).StartTime.Ticks
    Initialize-ImportFake
    Set-RingPlan $okRing
    [IO.File]::WriteAllText($lockFile, $lockHolder)
    Clear-Calls
    $lk1 = Invoke-Import 'imp-lock-held' @('-FixturePath', $fxFile, '-SnapshotId', 'base1')
    Assert ($lk1.Exit -ne 0 -and $lk1.Result.verdict -eq 'fail' -and $lk1.Result.reason -match 'holds' -and (Get-FakeCalls) -eq '' -and [IO.File]::ReadAllText($lockFile) -eq $lockHolder) 'import lock: a run is refused while a live process holds the device lock, with no adb call and the holder file unchanged'
    Remove-Item -LiteralPath $lockFile -Force
    Initialize-ImportFake
    Set-RingPlan $okRing
    $env:FAKE_LOCK_FILE = $lockFile
    $lk2 = Invoke-Import 'imp-lock-run' @('-FixturePath', $fxFile, '-SnapshotId', 'base1')
    Assert ($lk2.Exit -eq 0 -and $lk2.Result.verdict -eq 'pass' -and (Get-Content -LiteralPath (Join-Path $fdir 'lockseen') -Raw).Trim() -eq '1' -and -not (Test-Path -LiteralPath $lockFile)) 'import lock: the device lock is held while the import drives the app and released when the run ends'
    Initialize-ImportFake
    Set-RingPlan $okRing
    Set-Fake 'uixml' '<hierarchy><node text="other.bin" bounds="[10,20][110,60]" /></hierarchy>'
    $lk3 = Invoke-Import 'imp-lock-fail' @('-FixturePath', $fxFile, '-SnapshotId', 'base1')
    Assert ($lk3.Exit -ne 0 -and $lk3.Result.reason -match 'file-not-in-picker' -and -not (Test-Path -LiteralPath $lockFile)) 'import lock: the device lock is released when the run fails'
    Initialize-ImportFake
    Set-RingPlan $okRing
    $lk4 = Invoke-Import 'imp-lock-nosnap' @('-FixturePath', $fxFile, '-NoRestore')
    Assert ($lk4.Exit -eq 0 -and (Get-Content -LiteralPath (Join-Path $fdir 'lockseen') -Raw).Trim() -eq '1' -and -not (Test-Path -LiteralPath $lockFile)) 'import lock: -NoRestore holds the lock too'
    Remove-Item Env:\FAKE_LOCK_FILE -ErrorAction SilentlyContinue
    Initialize-ImportFake
    Set-RingPlan $okRing
    Set-Fake 'uixml' '@auto'
    $nm1 = Invoke-Import 'imp-defname-1' @('-FixturePath', $fxFile, '-SnapshotId', 'base1') -DefaultName
    Initialize-ImportFake
    Set-RingPlan $okRing
    Set-Fake 'uixml' '@auto'
    $nm2 = Invoke-Import 'imp-defname-2' @('-FixturePath', $fxFile, '-SnapshotId', 'base1') -DefaultName
    Assert ($nm1.Exit -eq 0 -and $nm1.Result.data.fixture -match '^fx-[0-9a-f]{8}\.bin$' -and $nm1.Result.data.fixture -eq ('fx-' + $nm1.Result.runId + '.bin') -and $nm2.Result.data.fixture -ne $nm1.Result.data.fixture) 'import name: the default fixture name carries the run id and differs between runs'
    Assert ($nm2.Exit -eq 0 -and @(Get-ChildItem -LiteralPath (Join-Path $fdir 'remote') -Filter '*.bin' -ErrorAction SilentlyContinue).Count -eq 0) 'import name: a fixture under a name the run made up is removed from the device at the end'
    Initialize-ImportFake
    Set-RingPlan $okRing
    Set-Fake 'uixml' '@auto'
    $nm3 = Invoke-Import 'imp-ownname' @('-FixturePath', $fxFile, '-RemoteName', 'mine-7.bin', '-SnapshotId', 'base1')
    Assert ($nm3.Exit -eq 0 -and $nm3.Result.data.fixture -eq 'mine-7.bin' -and (Test-Path -LiteralPath (Join-Path $fdir 'remote\mine-7.bin'))) 'import name: -RemoteName is used as given and its fixture stays on the device for the hash skip'

    # ---------- mock-reverse against the stateful fake ----------
    # A real listener on a free loopback port stands in for the mock endpoint; the rule list lives in reverses.txt of the fake.
    $env:FAKE_ADB_DIR = $fdir
    $env:FAKE_ADB_MODE = 'device'
    $mockScript = Join-Path $RunnerDir 'mock-reverse.ps1'
    $mockListener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
    $mockListener.Start()
    $mockPort = ([System.Net.IPEndPoint]$mockListener.LocalEndpoint).Port
    $mockSpare = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
    $mockSpare.Start()
    $mockFreePort = ([System.Net.IPEndPoint]$mockSpare.LocalEndpoint).Port
    $mockSpare.Stop()
    $mockRule = 'tcp:' + $mockPort
    $mockNl = [string][char]10
    function Invoke-MockReverse([string]$Name, [string[]]$Extra = @(), [int]$UsePort = $mockPort, [string]$UseSerial = 'FAKE', [string]$UseAdb = $fake2) {
        $o = Join-Path $work $Name
        $a = @('-NoProfile', '-File', $mockScript, '-OutDir', $o, '-Serial', $UseSerial, '-AllowedSerials', 'FAKE', '-Port', [string]$UsePort, '-AdbExe', $UseAdb, '-RepoRoot', $work) + $Extra
        $text = (& pwsh @a | Out-String)
        $c = $LASTEXITCODE
        $res = $null
        if (Test-Path -LiteralPath (Join-Path $o 'result.json')) { $res = Get-Content -LiteralPath (Join-Path $o 'result.json') -Raw | ConvertFrom-Json -AsHashtable }
        return [pscustomobject]@{ Exit = $c; Result = $res; Text = $text }
    }
    function Get-FakeReverses { $rf = Join-Path $fdir 'reverses.txt'; if (Test-Path -LiteralPath $rf) { return , @([IO.File]::ReadAllText($rf) -split '\r?\n' | Where-Object { $_ }) } return , @() }
    try {
        Clear-Fake
        $mr1 = Invoke-MockReverse 'mr-add'
        Assert ($mr1.Exit -eq 0 -and $mr1.Result.verdict -eq 'pass' -and $mr1.Result.mockReverse.action -eq 'added' -and $mr1.Result.mockReverse.listener -eq $true) 'mock-reverse: with a PC listener the rule is added and the run passes'
        Assert ((Get-FakeReverses) -contains ('UsbFfs ' + $mockRule + ' ' + $mockRule) -and (Get-FakeCalls) -match [regex]::Escape('reverse --no-rebind ' + $mockRule + ' ' + $mockRule)) 'mock-reverse: the rule is created with --no-rebind as tcp:P to tcp:P'
        Assert (@($mr1.Result.mockReverse.after) -contains ($mockRule + ' ' + $mockRule) -and (Test-ResultSchema $mr1.Result).Count -eq 0) 'mock-reverse: the result reads the rule back from the list and passes the schema'
        Clear-Calls
        $mr2 = Invoke-MockReverse 'mr-again'
        Assert ($mr2.Exit -eq 0 -and $mr2.Result.mockReverse.action -eq 'kept' -and (Get-FakeReverses).Count -eq 1 -and (Get-FakeCalls) -notmatch 'reverse --no-rebind') 'mock-reverse: an identical existing rule is kept and not added again'

        # a rule for the same device port that points elsewhere is refused and left alone
        Clear-Fake
        Set-Fake 'reverses.txt' ('UsbFfs ' + $mockRule + ' tcp:7777' + $mockNl)
        Clear-Calls
        $mr3 = Invoke-MockReverse 'mr-conflict'
        Assert ($mr3.Exit -ne 0 -and $mr3.Result.verdict -eq 'fail' -and $mr3.Result.reason -match 'another target' -and (Get-FakeReverses).Count -eq 1 -and (Get-FakeReverses)[0] -eq ('UsbFfs ' + $mockRule + ' tcp:7777') -and (Get-FakeCalls) -notmatch 'reverse --(no-rebind|remove)') 'mock-reverse: a conflicting rule is refused and neither replaced nor removed'
        $mr3b = Invoke-MockReverse 'mr-conflict-remove' @('-Remove')
        Assert ($mr3b.Exit -ne 0 -and $mr3b.Result.reason -match 'not ours' -and (Get-FakeReverses).Count -eq 1) 'mock-reverse: -Remove refuses a rule that points at another target'

        # -Remove takes out only tcp:P
        Clear-Fake
        Set-Fake 'reverses.txt' ('UsbFfs tcp:7001 tcp:7001' + $mockNl + 'UsbFfs ' + $mockRule + ' ' + $mockRule + $mockNl)
        Clear-Calls
        $mr4 = Invoke-MockReverse 'mr-remove' @('-Remove')
        Assert ($mr4.Exit -eq 0 -and $mr4.Result.mockReverse.action -eq 'removed' -and (Get-FakeReverses).Count -eq 1 -and (Get-FakeReverses)[0] -eq 'UsbFfs tcp:7001 tcp:7001') 'mock-reverse: -Remove removes tcp:P and leaves another agent''s rule'
        Assert ((Get-FakeCalls) -match [regex]::Escape('reverse --remove ' + $mockRule) -and (Get-FakeCalls) -notmatch 'remove-all') 'mock-reverse: -Remove names the one rule and never --remove-all'
        Clear-Calls
        $mr4b = Invoke-MockReverse 'mr-remove-absent' @('-Remove')
        Assert ($mr4b.Exit -eq 0 -and $mr4b.Result.mockReverse.action -eq 'none' -and (Get-FakeCalls) -notmatch 'reverse --remove') 'mock-reverse: -Remove with no such rule passes without touching adb'
        Clear-Fake
        $mr4c = Invoke-MockReverse 'mr-remove-nolistener' @('-Remove') $mockFreePort
        Assert ($mr4c.Exit -eq 0) 'mock-reverse: -Remove does not need a PC listener'

        # refusals before any rule change
        Clear-Fake
        Clear-Calls
        $mr5 = Invoke-MockReverse 'mr-serial' @() $mockPort 'OTHER'
        Assert ($mr5.Exit -ne 0 -and $mr5.Result.reason -match 'not in the allowed list' -and (Get-FakeCalls) -eq '' -and (Get-FakeReverses).Count -eq 0) 'mock-reverse: a serial outside the allowed list is refused before any adb call'
        $mr6 = Invoke-MockReverse 'mr-nolistener' @() $mockFreePort
        Assert ($mr6.Exit -ne 0 -and $mr6.Result.reason -match 'no listener' -and $mr6.Result.mockReverse.listener -eq $false -and (Get-FakeCalls) -eq '' -and (Get-FakeReverses).Count -eq 0) 'mock-reverse: with no PC listener the rule is refused and adb is not called'
        $mr7 = Invoke-MockReverse 'mr-noadb' @() $mockPort 'FAKE' (Join-Path $work 'no-such-adb.exe')
        Assert ($mr7.Exit -ne 0 -and $mr7.Result.verdict -eq 'fail' -and (Get-FakeReverses).Count -eq 0) 'mock-reverse: an unavailable adb fails cleanly'
        Clear-Calls
        Set-Fake 'mode' 'offline'
        $mr8 = Invoke-MockReverse 'mr-offline'
        Remove-Item -LiteralPath (Join-Path $fdir 'mode') -Force
        Assert ($mr8.Exit -ne 0 -and $mr8.Result.reason -match 'device-offline' -and (Get-FakeCalls) -notmatch 'reverse') 'mock-reverse: an offline device fails with no reverse call'
        Clear-Fake
        Set-Fake 'noapply' '1'
        $mr9 = Invoke-MockReverse 'mr-noreadback'
        Assert ($mr9.Exit -ne 0 -and $mr9.Result.reason -match 'not listed after adding') 'mock-reverse: a rule that does not read back fails'
        Clear-Fake
        Set-Fake 'reverr' 'adb: error: closed'
        $mr10 = Invoke-MockReverse 'mr-adberr'
        Assert ($mr10.Exit -ne 0 -and $mr10.Result.reason -match 'adb reverse failed' -and (Get-FakeReverses).Count -eq 0) 'mock-reverse: an adb error on the add fails the run'

        # the probe: reported, never the verdict, and never combined with -Remove
        Clear-Fake
        Set-Fake 'ncout' 'connection refused'
        Set-Fake 'ncexit' '1'
        $mr11 = Invoke-MockReverse 'mr-probe' @('-Probe')
        Assert ($mr11.Exit -eq 0 -and $mr11.Result.verdict -eq 'pass' -and $mr11.Result.mockReverse.probe.exitCode -eq 1 -and $mr11.Result.mockReverse.probe.out -eq 'connection refused') 'mock-reverse: -Probe reports nc''s output and exit code without letting them decide the verdict'
        Assert ((Get-FakeCalls) -match [regex]::Escape('shell echo x | toybox nc -w 3 127.0.0.1 ' + $mockPort)) 'mock-reverse: -Probe runs the single-string nc command on the phone'
        Assert ($mr11.Result.mockReverse.probeCriterion -match 'client-error' -and $mr11.Result.reason -match 'client-error' -and $mr11.Result.mockReverse.probeCriterion -notmatch 'connect log line' -and $mr11.Result.mockReverse.probe.ranAs -match 'not the app') 'mock-reverse: the result states that a client-error log line is the criterion and that the probe is not the app'
        $mrRaw = Get-Content -LiteralPath (Join-Path $work 'mr-probe\result.json') -Raw
        $mrStamp = [regex]::Match($mrRaw, '"startedUtc":\s*"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)"')
        Assert ($mrStamp.Success -and [Math]::Abs(([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse($mrStamp.Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture)).TotalMinutes) -lt 5) 'mock-reverse: the probe start time is recorded as UTC in the mock log timestamp format'

        # the listener check sends an HTTP ping, so its own footprint is a request line and not the probe's client-error line
        $mrFn = [Management.Automation.Language.Parser]::ParseFile($mockScript, [ref]$null, [ref]$null).Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Test-LocalListener' }, $true)
        . ([scriptblock]::Create($mrFn.Extent.Text))
        $mrPingListener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
        $mrPingListener.Start()
        try {
            $mrAccept = $mrPingListener.AcceptTcpClientAsync()
            $mrSeen = Test-LocalListener ([int]([System.Net.IPEndPoint]$mrPingListener.LocalEndpoint).Port)
            $mrGot = ''
            if ($mrAccept.Wait(3000)) {
                $mrBuf = New-Object byte[] 256
                $mrStream = $mrAccept.Result.GetStream()
                $mrRead = $mrStream.ReadAsync($mrBuf, 0, 256)
                if ($mrRead.Wait(3000)) { $mrGot = [System.Text.Encoding]::ASCII.GetString($mrBuf, 0, $mrRead.Result) }
                $mrAccept.Result.Dispose()
            }
            $mrCrlf = [string][char]13 + [string][char]10
            Assert ($mrSeen -eq $true -and $mrGot -eq ('GET /__ping HTTP/1.0' + $mrCrlf + $mrCrlf)) 'mock-reverse: the listener check sends GET /__ping as HTTP/1.0 and returns true'
        } finally { $mrPingListener.Stop() }
        Assert ((Test-LocalListener $mockFreePort) -eq $false) 'mock-reverse: the listener check returns false when nothing listens'
        Clear-Calls
        $mr12 = Invoke-MockReverse 'mr-probe-remove' @('-Probe', '-Remove')
        Assert ($mr12.Exit -ne 0 -and (Get-FakeCalls) -eq '') 'mock-reverse: -Probe with -Remove is refused before any adb call'
        Clear-Calls
        $mr13 = Invoke-MockReverse 'mr-noprobe'
        Assert ($mr13.Exit -eq 0 -and $null -eq $mr13.Result.mockReverse.probe -and (Get-FakeCalls) -notmatch 'toybox') 'mock-reverse: without -Probe no probe runs'
    } finally {
        $mockListener.Stop()
        Clear-Fake
    }
} finally {
    Remove-Item Env:\FAKE_ADB_MODE -ErrorAction SilentlyContinue
    Remove-Item Env:\FAKE_LOCK_FILE -ErrorAction SilentlyContinue
    foreach ($id in ($script:spawned | Sort-Object -Unique)) {
        $p = Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($p -and $p.ProcessName -in @('ping', 'cmd', 'node')) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
    }
    Start-Sleep -Milliseconds 500
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
if ($script:failures -gt 0) { Write-Output ('FAILED: ' + $script:failures); exit 1 }
Write-Output 'ALL PASSED'
exit 0
