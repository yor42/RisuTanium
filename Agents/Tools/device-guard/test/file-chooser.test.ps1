# Fake-adb and fake-CDP cases for adbg `file-chooser` (maintainer MC-2724 two device roots, MC-2725 adb tap, MC-2726 two counted failures):
# the Note 9 only verb that hands one pushed synthetic file to the app's own <input type=file> over CDP. Every rule gets a refusal row; the
# happy rows check the exact CDP method sequence, the tap order, the one allowlisted file and the bounded content read-back.
# Usage: pwsh -File file-chooser.test.ps1 -GuardPath <adbg.mjs> [-Filter <regex over row ids>]
param([Parameter(Mandatory = $true)][string]$GuardPath, [string]$Filter = '')
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('adbg-fc-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$fakeAdb = Join-Path $testDir 'fake-adb.mjs'
$fakeCdp = Join-Path $testDir 'fake-cdp.mjs'
$calls = Join-Path $testDir 'calls.txt'
$log = Join-Path $testDir 'log.txt'
$st = Join-Path $testDir 'state.json'
$marker = Join-Path $testDir 'tap-marker'
$eventSent = Join-Path $testDir 'event-sent'
$script:procs = @()
# The fake adb records every call as one JSON array and answers from the FAKE_ADB config. The device-file command is modelled on the
# device: the exact guarded string `[ -f p ] && [ ! -h p ] && stat -c %s p` fails for a directory, a link or a missing path, while a bare
# `stat -c %s p` prints a size for a directory or a link (toybox stat without -L) and fails only for a missing path. `input tap` touches the
# marker file the fake CDP watches and, with tapWait, does not return until the fake CDP has written its event (a tap that blocks the guard's loop).
$fakeAdbSource = @'
import { appendFileSync, existsSync, writeFileSync } from "node:fs"
const a = process.argv.slice(2)
appendFileSync(process.env.FAKE_CALLS, JSON.stringify(a) + "\n")
const cfg = JSON.parse(process.env.FAKE_ADB ?? "{}")
const j = a.slice(2).join(" ")
let m
if (j === "forward --list") process.stdout.write((cfg.forwards ?? []).join("\n") + "\n")
else if ((m = j.match(/^shell pidof (\S+)$/))) { const p = (cfg.pids ?? {})[m[1]]; if (p === undefined) process.exit(1); process.stdout.write(String(p)) }
else if ((m = j.match(/^shell cat \/proc\/(\d+)\/oom_score_adj$/))) process.stdout.write(String((cfg.adj ?? {})[m[1]] ?? 900))
else if (/^shell \[ -f (\S+) \] && \[ ! -h \1 \] && stat -c %s \1$/.test(j)) { if (cfg.fileKind !== "file") process.exit(1); process.stdout.write(String(cfg.stat ?? 0) + "\n") }
else if (/^shell stat -c %s (\S+)$/.test(j)) { if (cfg.fileKind === "missing") process.exit(1); process.stdout.write(String(cfg.fileKind === "file" ? cfg.stat : 4096) + "\n") }
else if (/^shell input tap \d+ \d+$/.test(j)) {
  if ((cfg.tapExit ?? 0) !== 0) process.exit(cfg.tapExit)
  writeFileSync(cfg.marker, "tap")
  if (cfg.tapWait) { const end = Date.now() + 8000; while (!existsSync(cfg.eventSent) && Date.now() < end) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20) }
}
process.exit(0)
'@
# The fake CDP is a dependency-free RFC 6455 server (node:http upgrade, unmasked server frames, masked client frames). /json/version
# carries the Chrome field set plus Android-Package; /json builds webSocketDebuggerUrl from the request Host header, as Chrome's devtools HTTP
# handler does. Every method gets a result or, per errorMethods, an error reply; an unknown method gets an error. Page.fileChooserOpened is
# emitted only when Page.enable and then intercept(true) returned results BEFORE the tap marker appeared (Chromium sends Page events only
# to an enabled domain, and only an intercepted chooser yields the event); otherwise nothing (the real picker would open). callFunctionOn
# runs the guard's own functionDeclaration in node:vm against a model of the Blink File surface it uses.
$fakeCdpSource = @'
import http from "node:http"
import crypto from "node:crypto"
import vm from "node:vm"
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
const cfg = JSON.parse(readFileSync(process.env.FAKE_CDP_CONFIG, "utf8"))
const note = (o) => appendFileSync(cfg.log, JSON.stringify(o) + "\n")
const pageId = "PAGE1"
const frame = (text) => {
  const p = Buffer.from(text, "utf8")
  const h = p.length < 126 ? Buffer.from([0x81, p.length]) : p.length < 65536 ? Buffer.from([0x81, 126, p.length >> 8, p.length & 255]) : null
  return Buffer.concat([h, p])
}
const server = http.createServer((req, res) => {
  note({ http: req.url })
  const host = req.headers.host
  if (req.url === "/json/version") {
    if (cfg.redirectTo) { res.writeHead(302, { Location: cfg.redirectTo }); res.end(); return }
    const v = { Browser: "Chrome/124.0.0.0", "Protocol-Version": "1.3", "User-Agent": "Mozilla/5.0 (Linux; Android 10) Chrome/124.0.0.0 Mobile Safari/537.36", "V8-Version": "12.4", "WebKit-Version": "537.36", webSocketDebuggerUrl: "ws://" + host + "/devtools/browser" }
    if (cfg.pkg !== null) v["Android-Package"] = cfg.pkg
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(v)); return
  }
  if (req.url === "/json" || req.url === "/json/list") {
    const wsHost = cfg.wsHostPort ?? host
    const entry = (id, url, wsPath) => ({ description: "{\"attached\":true,\"empty\":false,\"visible\":true,\"screenX\":0,\"screenY\":0}", id, title: "app", type: "page", url, webSocketDebuggerUrl: "ws://" + wsHost + wsPath })
    const list = []
    for (let i = 0; i < (cfg.pages ?? 1); i++) { const id = i === 0 ? pageId : pageId + i; list.push(entry(id, "https://appassets.androidplatform.net/index.html", i === 0 && cfg.wsPath ? cfg.wsPath : "/devtools/page/" + id)) }
    if (cfg.devtoolsPage) list.push(entry("DT1", "devtools://devtools/bundled/inspector.html", "/devtools/page/DT1"))
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(list)); return
  }
  res.writeHead(404); res.end()
})
server.on("upgrade", (req, sock) => {
  note({ ws: req.url })
  const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64")
  sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n")
  serve(sock)
})
const modelFiles = () => {
  const fm = cfg.fileModel
  if (fm.count === 0) return { length: 0 }
  const f = { length: fm.count }
  f[0] = { name: fm.name, size: fm.size, slice(a, b) {
    note({ slice: b - a })
    return { arrayBuffer: () => fm.mode === "reject"
      ? Promise.reject(Object.assign(new Error("The requested file could not be read"), { name: "NotReadableError" }))
      : Promise.resolve(new ArrayBuffer(Math.max(0, fm.mode === "short" ? b - a - 1 : b - a))) }
  } }
  return f
}
function serve(sock) {
  let buf = Buffer.alloc(0)
  const st = { enabled: false, intercepting: false, handled: false }
  const send = (o) => sock.write(frame(typeof o === "string" ? o : JSON.stringify(o)))
  const poll = setInterval(() => {
    if (st.handled || !existsSync(cfg.marker)) return
    st.handled = true
    note({ seq: "TAP" })
    if (st.enabled && st.intercepting && !cfg.suppressEvent) {
      const params = { frameId: "F1", mode: "selectSingle", backendNodeId: 7, ...(cfg.eventParams ?? {}) }
      for (const k of Object.keys(params)) if (params[k] === null) delete params[k]
      send({ method: "Page.fileChooserOpened", params })
      writeFileSync(cfg.eventSent, "sent")
    }
  }, 5)
  const handle = async (text) => {
    const msg = JSON.parse(text)
    note({ method: msg.method, params: msg.params })
    const key = msg.method + (msg.method === "Page.setInterceptFileChooserDialog" ? ":" + msg.params.enabled : "")
    const reply = (result) => send({ id: msg.id, result })
    if ((cfg.errorMethods ?? []).includes(key)) { send({ id: msg.id, error: { code: -32601, message: key + " refused" } }); return }
    switch (msg.method) {
      case "Runtime.evaluate":
        if (cfg.evalError) { send({ id: msg.id, error: { code: -32000, message: "evaluate refused" } }); return }
        if (cfg.evalException) { reply({ result: { type: "object" }, exceptionDetails: { exceptionId: 1, text: "Uncaught", lineNumber: 0, columnNumber: 0 } }); return }
        reply({ result: { type: "object", value: cfg.evalValue } }); return
      case "Page.enable": st.enabled = true; reply({}); return
      case "Page.disable": st.enabled = false; reply({}); return
      case "Page.setInterceptFileChooserDialog":
        st.intercepting = msg.params.enabled === true && st.enabled
        reply({})
        if (cfg.nonJsonFrame && msg.params.enabled === true) { send("not json at all"); send("null"); send("[1,2]") }
        return
      case "DOM.setFileInputFiles": reply({}); return
      case "DOM.resolveNode":
        if (cfg.nodeGone) { send({ id: msg.id, error: { code: -32000, message: "No node with given id found" } }); return }
        reply(cfg.noObject ? {} : { object: { type: "object", subtype: "node", objectId: "OBJ1" } }); return
      case "Runtime.callFunctionOn": {
        if (msg.params.awaitPromise !== true) { reply({ result: { type: "object", subtype: "promise", className: "Promise", objectId: "P1" } }); return }
        try {
          const fn = vm.runInNewContext("(" + msg.params.functionDeclaration + ")")
          const v = await fn.call({ files: modelFiles() })
          reply({ result: { type: "object", value: JSON.parse(JSON.stringify(v)) } })
        } catch (e) {
          const description = e.name + ": " + e.message
          reply({ result: { type: "object", subtype: "error", className: e.name, description }, exceptionDetails: { exceptionId: 2, text: "Uncaught (in promise)", lineNumber: 0, columnNumber: 0, exception: { type: "object", subtype: "error", className: e.name, description } } })
        }
        return
      }
      case "Runtime.releaseObject": reply({}); return
      default: send({ id: msg.id, error: { code: -32601, message: "unknown method" } })
    }
  }
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d])
    for (;;) {
      if (buf.length < 2) return
      let len = buf[1] & 127, off = 2
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4 }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10 }
      const masked = (buf[1] & 128) !== 0
      if (buf.length < off + (masked ? 4 : 0) + len) return
      const mask = masked ? buf.subarray(off, off + 4) : null
      if (masked) off += 4
      const payload = Buffer.from(buf.subarray(off, off + len))
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
      const op = buf[0] & 15
      buf = buf.subarray(off + len)
      if (op === 8) { sock.end(Buffer.from([0x88, 0])); return }
      if (op === 1) handle(payload.toString("utf8"))
    }
  })
  sock.on("close", () => clearInterval(poll))
  sock.on("error", () => {})
}
server.listen(0, "127.0.0.1", () => writeFileSync(cfg.portFile, String(server.address().port)))
'@
Set-Content $fakeAdb $fakeAdbSource
Set-Content $fakeCdp $fakeCdpSource
$env:ADBG_FAKE_ADB_SCRIPT = $fakeAdb
$env:FAKE_CALLS = $calls
# Every guard spawn goes through the stand-in adb; never run a case where it is not in place.
if (-not $env:ADBG_FAKE_ADB_SCRIPT -or -not (Test-Path -LiteralPath $env:ADBG_FAKE_ADB_SCRIPT)) { throw 'ADBG_FAKE_ADB_SCRIPT is not set to an existing fake: refusing to run' }
$script:failures = 0
$script:passes = 0
$pg = @('29f3cde9193f7ece', '2ac80128013f7ece')
$pkg = 'io.github.yor42.risutanium'
$defFile = '/sdcard/Download/t38-encrypted.rtb'
$appFile = '/sdcard/Android/data/io.github.yor42.risutanium/files/t38-encrypted.rtb'
$defSel = 'button[data-testid=restore]'
$defState = '{"picks":[],"pickErrors":0,"locates":[],"offset":{"x":10,"y":20,"time":"2026-11-20T00:00:00.000Z"},"pickLocked":false}'
$mEval = 'Runtime.evaluate'; $mEnable = 'Page.enable'; $mOn = 'Page.setInterceptFileChooserDialog:true'; $mOff = 'Page.setInterceptFileChooserDialog:false'
$mDisable = 'Page.disable'; $mTap = 'TAP'; $mSet = 'DOM.setFileInputFiles'; $mResolve = 'DOM.resolveNode'; $mCall = 'Runtime.callFunctionOn'; $mRel = 'Runtime.releaseObject'
$seqOk = @($mEval, $mEnable, $mOn, $mTap, $mSet, $mResolve, $mCall, $mRel, $mOff, $mDisable)
$seqSetFail = @($mEval, $mEnable, $mOn, $mTap, $mSet, $mOff, $mDisable)
$seqNodeFail = @($mEval, $mEnable, $mOn, $mTap, $mSet, $mResolve, $mOff, $mDisable)
$seqNoEvent = @($mEval, $mEnable, $mOn, $mTap, $mOff, $mDisable)
$seqNoTap = @($mEval, $mEnable, $mOn, $mOff, $mDisable)
$seqEnableFail = @($mEval, $mEnable, $mDisable)
function Test-Result([string]$label, [bool]$pass, [string]$detail) {
    if ($pass) { $script:passes++ } else { $script:failures++ }
    ($(if ($pass) { 'ok  ' } else { 'FAIL' })) + ' ' + $label + ' ' + $detail
}
# A row that throws counts as one failure and the run goes on, so a missing behaviour never hides the rows after it.
function Row([string]$id, [scriptblock]$body) {
    if ($Filter -ne '' -and $id -notmatch $Filter) { return }
    try { & $body } catch { Test-Result ($id + ' row threw') $false $_.Exception.Message }
}
function Get-FreePort { $l = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0); $l.Start(); $p = $l.LocalEndpoint.Port; $l.Stop(); $p }
function Merge-Config([hashtable]$base, [hashtable]$over) { foreach ($k in $over.Keys) { $base[$k] = $over[$k] }; $base }
function Read-Lines([string]$path) { if (Test-Path -LiteralPath $path) { , @(Get-Content -LiteralPath $path) } else { , @() } }
function Get-Errors { if (Test-Path $st) { $s = Get-Content $st -Raw | ConvertFrom-Json; [int]$s.fileChooserErrors } else { 0 } }
function Start-FakeCdp([hashtable]$over, [string]$tag) {
    $cfg = @{
        log = (Join-Path $testDir ('cdp' + $tag + '.jsonl')); portFile = (Join-Path $testDir ('port' + $tag + '.txt')); marker = $marker; eventSent = $eventSent
        pkg = $pkg; pages = 1; devtoolsPage = $false; errorMethods = @(); suppressEvent = $false; evalError = $false; evalException = $false
        evalValue = @{ count = 1; x = 100; y = 200; w = 300; h = 80; dpr = 2; inView = $true; onTop = $true }
        fileModel = @{ count = 1; name = 't38-encrypted.rtb'; size = 18524; mode = 'ok' }
    }
    $cfg = Merge-Config $cfg $over
    $cfgFile = Join-Path $testDir ('cdp-config' + $tag + '.json')
    Remove-Item $cfg.log, $cfg.portFile -ErrorAction SilentlyContinue
    $json = ConvertTo-Json -Depth 8 -Compress -InputObject $cfg
    $json = $json -replace '\{PORT2\}', [string]$script:port2
    Set-Content $cfgFile $json
    $env:FAKE_CDP_CONFIG = $cfgFile
    $p = Start-Process -FilePath node -ArgumentList @($fakeCdp) -PassThru -WindowStyle Hidden
    $script:procs += $p
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ((Test-Path $cfg.portFile) -and ((Get-Content $cfg.portFile -Raw).Trim() -ne '')) { break }
        Start-Sleep -Milliseconds 25
    }
    if (-not (Test-Path $cfg.portFile)) { throw 'fake CDP did not start' }
    [pscustomobject]@{ proc = $p; port = [int](Get-Content $cfg.portFile -Raw).Trim(); log = $cfg.log }
}
function Stop-FakeCdp($srv) { if ($srv) { Stop-Process -Id $srv.proc.Id -Force -ErrorAction SilentlyContinue; $null = $srv.proc.WaitForExit(3000) } }
function Get-Seq([string[]]$lines) {
    foreach ($l in $lines) {
        $o = $l | ConvertFrom-Json
        if ($o.PSObject.Properties['seq']) { 'TAP' }
        elseif ($o.PSObject.Properties['method']) { if ($o.method -eq 'Page.setInterceptFileChooserDialog') { $o.method + ':' + ([string]$o.params.enabled).ToLower() } else { $o.method } }
    }
}
# One guard call of the file-chooser verb against the fakes. -Over replaces default options (a $null value drops the option), -Cdp and -Adb
# replace keys of the fake configs ({PORT}, {PORT2}, {SER} and {OTHER} are replaced in both), -Two starts a second fake CDP first,
# -NoServer starts none (the port is a fixed unused number unless -Port is given), -Keep keeps log and state from the previous call.
function Invoke-Fc {
    param([hashtable]$Over = @{}, [hashtable]$Cdp = @{}, [hashtable]$Adb = @{}, [string]$Ser = $pg[1], [string]$StateText = 'default', [switch]$Keep, [switch]$NoServer, [switch]$Two, [string[]]$Extra = @(), [string]$Port = '9557')
    Remove-Item $calls, $marker, $eventSent, (Join-Path $testDir 'cdp.jsonl'), (Join-Path $testDir 'cdp2.jsonl') -ErrorAction SilentlyContinue
    if (-not $Keep) {
        Remove-Item $log, $st -ErrorAction SilentlyContinue
        if ($StateText -eq 'default') { Set-Content $st $defState } elseif ($StateText -ne 'none') { Set-Content $st $StateText }
    }
    $srv = $null; $srv2 = $null; $script:port2 = 0
    try {
        if ($Two) { $srv2 = Start-FakeCdp @{} '2'; $script:port2 = $srv2.port }
        if (-not $NoServer) { $srv = Start-FakeCdp $Cdp ''; $Port = [string]$srv.port }
        $o = [ordered]@{ '--serial' = $Ser; '--log' = $log; '--state' = $st; '--own-package' = $pkg; '--own-ports' = $Port; '--port' = $Port; '--selector' = $defSel; '--file' = $defFile }
        foreach ($k in $Over.Keys) { if ($null -eq $Over[$k]) { $o.Remove($k) } else { $o[$k] = $Over[$k] } }
        $a = @('file-chooser'); foreach ($k in $o.Keys) { $a += $k; $a += [string]$o[$k] }; $a += $Extra
        $adbCfg = @{
            forwards = @('{SER} tcp:{PORT} localabstract:webview_devtools_remote_4242'); pids = @{ $pkg = '4242' }; adj = @{ '4242' = 0 }
            fileKind = 'file'; stat = 18524; marker = $marker; eventSent = $eventSent; tapExit = 0; tapWait = $false
        }
        $adbCfg = Merge-Config $adbCfg $Adb
        $adbJson = (ConvertTo-Json -Depth 8 -Compress -InputObject $adbCfg) -replace '\{PORT2\}', [string]$script:port2 -replace '\{PORT\}', $Port -replace '\{SER\}', $Ser -replace '\{OTHER\}', $pg[0]
        $env:FAKE_ADB = $adbJson
        $all = (& node $GuardPath @a 2>&1 | ForEach-Object { "$_" }) -join "`n"
        $rc = [string]$LASTEXITCODE
        $cdpLines = if ($srv) { Read-Lines $srv.log } else { , @() }
        $cdpAll = @($cdpLines | ForEach-Object { $_ | ConvertFrom-Json })
        $log2 = if ($srv2) { Read-Lines $srv2.log } else { , @() }
        [pscustomobject]@{
            rc = $rc; text = $all; calls = (Read-Lines $calls); seq = @(Get-Seq $cdpLines); cdpAll = $cdpAll
            cdp = @($cdpAll | Where-Object { $_.PSObject.Properties['method'] }); ws = @($cdpAll | Where-Object { $_.PSObject.Properties['ws'] }).Count
            second = $log2.Count; logText = $(if (Test-Path $log) { Get-Content $log -Raw } else { '' })
        }
    } finally { Stop-FakeCdp $srv; Stop-FakeCdp $srv2 }
}
function Invoke-Raw([string[]]$a) {
    Remove-Item $calls, $log -ErrorAction SilentlyContinue
    $env:FAKE_ADB = '{}'
    $all = (& node $GuardPath @a 2>&1 | ForEach-Object { "$_" }) -join "`n"
    [pscustomobject]@{ rc = [string]$LASTEXITCODE; text = $all; calls = (Read-Lines $calls) }
}
# rc and a reason substring always; seq and error count when given. A reason names the rule, so an exit-code match alone never passes.
function Chk([string]$label, $r, [string]$rc, [string]$reason, $seq = $null, [int]$errors = -1) {
    $pass = ($r.rc -eq $rc) -and ($reason -eq '' -or $r.text.Contains($reason))
    $detail = '-> rc=' + $r.rc
    if ($null -ne $seq) { $okSeq = (($r.seq -join ' ') -eq ($seq -join ' ')); $pass = $pass -and $okSeq; $detail += ' seq=' + ($r.seq -join ',') }
    if ($errors -ge 0) { $e = Get-Errors; $pass = $pass -and ($e -eq $errors); $detail += ' errors=' + $e }
    if (-not $pass) { $detail += ' text=' + $r.text.Substring(0, [Math]::Min(200, $r.text.Length)) }
    Test-Result $label $pass $detail
}
function Test-Quiet($r) { $r.calls.Count -eq 0 -and $r.cdp.Count -eq 0 -and $r.ws -eq 0 }
function Get-Tap($r) { @($r.calls | Where-Object { $_ -match '"input","tap"' }) }
$wrongFiles = @('/sdcard/Download/../x', '/sdcard/Download/sub/x', '/sdcard/Documents/x', '/data/local/tmp/x', '/storage/emulated/0/Download/x', '/sdcard/Download/.h', '/sdcard/Download/', 'x.rtb',
    '/sdcard/Download/a b', '/sdcard/Download/a%2F..', '/sdcard/Download/a;rm', '/sdcard/Download/a\b', ('/sdcard/Download/' + ('a' * 101)), ('/sdcard/Download/' + [char]0xE9 + 'x'),
    '/sdcard/Android/data/com.other/files/x', '/sdcard/download/x', '/sdcard/Android/data/io.github.yor42.risutanium/files/sub/x', '/sdcard/Android/data/io.github.yor42.risutanium/x')

try {
    Row 'FC-1' {
        foreach ($s in $pg) {
            $r = Invoke-Fc -Ser $s
            Chk ('FC-1 happy path on ' + $s) $r '0' 'file-chooser ok name=t38-encrypted.rtb size=18524 head=18524 mode=selectSingle' $seqOk 0
            Test-Result ('FC-1 tap sent once on ' + $s) ((Get-Tap $r).Count -eq 1) ''
        }
        $r = Invoke-Fc -Over @{ '--file' = $appFile }
        Chk 'FC-1 app files root' $r '0' 'file-chooser ok name=t38-encrypted.rtb' $seqOk 0
    }
    Row 'FC-2' {
        $sel = 'button.restore\:btn'
        $txt = [string][char]0xBCF5 + [string][char]0xC6D0
        $r = Invoke-Fc -Over @{ '--selector' = $sel; '--text' = $txt }
        $ev = $r.cdp | Where-Object method -eq $mEval
        $expr = [string]$ev.params.expression
        $selJson = '"' + $sel.Replace('\', '\\') + '"'
        $txtJson = '"' + $txt + '"'
        Test-Result 'FC-2 selector and text reach the page only as JSON strings' ($expr.Contains('querySelectorAll(' + $selJson + ')') -and $expr.Contains('=== ' + $txtJson) -and $ev.params.returnByValue -eq $true) ''
        $set = $r.cdp | Where-Object method -eq $mSet
        Test-Result 'FC-2 setFileInputFiles carries exactly the one validated file and the event node' (@($set.params.files).Count -eq 1 -and @($set.params.files)[0] -eq $defFile -and $set.params.backendNodeId -eq 7) ''
        $res = $r.cdp | Where-Object method -eq $mResolve
        $cf = $r.cdp | Where-Object method -eq $mCall
        Test-Result 'FC-2 read-back uses the resolved object, awaitPromise and returnByValue' ($res.params.backendNodeId -eq 7 -and $cf.params.objectId -eq 'OBJ1' -and $cf.params.awaitPromise -eq $true -and $cf.params.returnByValue -eq $true) ''
        Test-Result 'FC-2 no other method, exact order with the tap after intercept(true)' (($r.seq -join ' ') -eq ($seqOk -join ' ')) ($r.seq -join ',')
        $tapArgs = @(Get-Tap $r)
        Test-Result 'FC-2 tap at offset + centre * dpr' ($tapArgs.Count -eq 1 -and $tapArgs[0] -eq ('["-s","' + $pg[1] + '","shell","input","tap","510","500"]')) ($tapArgs -join ';')
    }
    Row 'FC-3' {
        $r = Invoke-Fc -NoServer -Ser 'emulator-5580'
        Chk 'FC-3 emulator-5580 is 97' $r '97' 'file-chooser runs only on the two Note 9 serials'
        Test-Result 'FC-3 no adb call' (Test-Quiet $r) ''
    }
    Row 'FC-4' {
        $scope = Join-Path $testDir 'scope.json'
        foreach ($s in @('R5CWTABTEST1', 'R58M12345AB', '2AC80128013F7ECE', '2ac80128013f7ecf', '29f3cde9193f7ece1')) {
            $r = Invoke-Fc -NoServer -Ser $s
            Chk ('FC-4 ' + $s + ' is 95') $r '95' 'file-chooser runs only on the two Note 9 serials'
            Test-Result ('FC-4 ' + $s + ' no adb call and no picker probe') ((Test-Quiet $r) -and -not $r.logText.Contains('picker-probe')) ''
            Set-Content $scope ('{"serial":"' + $s + '","approvedBy":"maintainer","date":"2026-11-20","allow":["tap","input-text","keyevent","am-start","install"]}')
            $r = Invoke-Fc -NoServer -Ser $s -Extra @('--scope-file', $scope)
            Chk ('FC-4 ' + $s + ' with an all-classes scope file is 95') $r '95' 'file-chooser runs only on the two Note 9 serials'
            Test-Result ('FC-4 ' + $s + ' scope file: no adb call and no picker probe') ((Test-Quiet $r) -and -not $r.logText.Contains('picker-probe')) ''
        }
        $r = Invoke-Fc -NoServer -Over @{ '--serial' = $null }
        Chk 'FC-4b no --serial is 2' $r '2' 'need a valid --serial'
        Test-Result 'FC-4b no adb call' (Test-Quiet $r) ''
    }
    Row 'FC-5' {
        foreach ($f in $wrongFiles) {
            $r = Invoke-Fc -NoServer -Over @{ '--file' = $f }
            Chk ('FC-5 refuses ' + $f) $r '2' 'file-chooser --file must be exactly'
            Test-Result ('FC-5 no adb call for ' + $f) (Test-Quiet $r) ''
        }
        foreach ($f in @(('/sdcard/Download/' + ('a' * 100)), ('/sdcard/Android/data/io.github.yor42.risutanium/files/' + ('a' * 100)))) {
            $r = Invoke-Fc -NoServer -Over @{ '--file' = $f } -Adb @{ fileKind = 'missing' }
            Chk 'FC-5 a 100-char name passes the file rule and reaches the device file check' $r '4' 'is missing, not a regular file'
            Test-Result 'FC-5 exactly the one device file call' ($r.calls.Count -eq 1) ''
        }
    }
    Row 'FC-6' {
        $r = Invoke-Fc -NoServer -Over @{ '--port' = '9999' }
        Chk 'FC-6 port outside --own-ports' $r '2' 'file-chooser --port must be one of --own-ports'
        $r = Invoke-Fc -NoServer -Over @{ '--own-ports' = $null }
        Chk 'FC-6 --own-ports missing' $r '2' 'file-chooser --port must be one of --own-ports'
        $r = Invoke-Fc -NoServer -Over @{ '--port' = 'abc'; '--own-ports' = 'abc' }
        Chk 'FC-6 non-numeric port' $r '2' 'file-chooser --port must be one of --own-ports'
        Test-Result 'FC-6 no adb call' (Test-Quiet $r) ''
    }
    Row 'FC-7' {
        $r = Invoke-Fc -NoServer -Over @{ '--own-package' = $null }
        Chk 'FC-7 --own-package missing' $r '2' 'file-chooser --own-package must be'
        $r = Invoke-Fc -NoServer -Over @{ '--own-package' = 'com.other.app' }
        Chk 'FC-7 other package' $r '2' 'file-chooser --own-package must be'
        Test-Result 'FC-7 no adb call' (Test-Quiet $r) ''
    }
    Row 'FC-8' {
        $bad = @(
            @{ '--selector' = '' }, @{ '--selector' = ('a' * 201) }, @{ '--selector' = "a`tb" }, @{ '--selector' = "a`nb" }, @{ '--selector' = ('a' + [char]0xE9) }
        )
        foreach ($o in $bad) { $r = Invoke-Fc -NoServer -Over $o; Chk 'FC-8 selector rule' $r '2' 'file-chooser --selector must be'; Test-Result 'FC-8 no adb call' (Test-Quiet $r) '' }
        foreach ($t in @("a`tb", ('a' * 81), '')) {
            $r = Invoke-Fc -NoServer -Over @{ '--text' = $t }; Chk 'FC-8 text rule' $r '2' 'file-chooser --text must be'
        }
        foreach ($t in @('0', '31', '1.5', 'x')) {
            $r = Invoke-Fc -NoServer -Over @{ '--timeout-s' = $t }; Chk ('FC-8 timeout ' + $t) $r '2' 'file-chooser --timeout-s must be'
        }
    }
    Row 'FC-9a' {
        $cases = @(
            @{ Extra = @('--name', 'x') }, @{ Extra = @('--id', 'x') }, @{ Extra = @('--x', '1') }, @{ Extra = @('--file', $defFile) },
            @{ Extra = @('--', 'shell', 'ls') }, @{ Over = @{ '--selector' = '--file' } }, @{ Extra = @('--selector') }
        )
        foreach ($c in $cases) {
            $o = if ($c.Over) { $c.Over } else { @{} }
            $e = if ($c.Extra) { [string[]]$c.Extra } else { [string[]]@() }
            $r = Invoke-Fc -NoServer -Over $o -Extra $e
            Chk ('FC-9a strict walk ' + (($o.Keys + $e) -join ' ')) $r '2' 'file-chooser'
            Test-Result 'FC-9a no adb call' (Test-Quiet $r) ''
        }
    }
    Row 'FC-9b' {
        $r = Invoke-Fc -NoServer -Extra @('--kit')
        Chk 'FC-9b --kit belongs to plain adb calls' $r '2' '--kit belongs to plain adb calls'
    }
    Row 'FC-9c' {
        $r = Invoke-Fc -NoServer -Extra @('--myfiles')
        Chk 'FC-9c --myfiles belongs to pick, tap and hold only' $r '2' '--myfiles belongs to pick, tap and hold only'
    }
    Row 'FC-10' {
        $r = Invoke-Fc -NoServer -Over @{ '--state' = $null }
        Chk 'FC-10 no --state' $r '2' 'need --state'
        foreach ($t in @('{}', '{"offset":null}', '{"offset":{"x":"a","y":1}}', '{"offset":{"x":1}}', '{"offset":{"x":1,"y":4001}}')) {
            $r = Invoke-Fc -NoServer -StateText $t
            Chk ('FC-10 state ' + $t) $r '2' 'file-chooser needs a recorded screen offset'
            Test-Result 'FC-10 no adb call' (Test-Quiet $r) ''
        }
    }
    Row 'FC-11' {
        $r = Invoke-Fc -Adb @{ forwards = @('{OTHER} tcp:{PORT} localabstract:webview_devtools_remote_4242') }
        Chk 'FC-11a forward only on the other serial' $r '5' 'no forward tcp:' $null 1
        $r = Invoke-Fc -Adb @{ forwards = @('X{SER} tcp:{PORT} localabstract:webview_devtools_remote_4242', '{SER} tcp:{PORT}0 localabstract:webview_devtools_remote_4242') }
        Chk 'FC-11b near-miss serial and port lines only' $r '5' 'no forward tcp:' $null 1
        $r = Invoke-Fc -Adb @{ forwards = @('{SER} tcp:{PORT} localabstract:webview_devtools_remote_4242', '{SER} tcp:{PORT} localabstract:webview_devtools_remote_4243') }
        Chk 'FC-11c two lines for this port' $r '96' 'more than one forward'
        Test-Result 'FC-11 no CDP method and no WebSocket' ($r.cdp.Count -eq 0 -and $r.ws -eq 0) ''
    }
    Row 'FC-12' {
        foreach ($remote in @('localabstract:chrome_devtools_remote', 'tcp:9222')) {
            $r = Invoke-Fc -Adb @{ forwards = @('{SER} tcp:{PORT} ' + $remote) }
            Chk ('FC-12 own line to ' + $remote) $r '96' 'does not reach a WebView devtools socket' $null 1
            Test-Result 'FC-12 no CDP method and no WebSocket' ($r.cdp.Count -eq 0 -and $r.ws -eq 0) ''
        }
    }
    Row 'FC-13' {
        $r = Invoke-Fc -Adb @{ pids = @{ $pkg = '5555' } }
        Chk 'FC-13 socket pid not among the app pids' $r '96' 'is not a io.github.yor42.risutanium process' $null 1
        Test-Result 'FC-13 no CDP method and no WebSocket' ($r.cdp.Count -eq 0 -and $r.ws -eq 0) ''
    }
    Row 'FC-14' {
        $r = Invoke-Fc -Cdp @{ pkg = 'com.android.chrome' }
        Chk 'FC-14a other Android-Package' $r '96' 'does not report Android-Package' $null 1
        $r = Invoke-Fc -Cdp @{ pkg = $null }
        Chk 'FC-14a Android-Package missing' $r '96' 'does not report Android-Package' $null 1
        Test-Result 'FC-14a no WebSocket' ($r.ws -eq 0) ''
        $r = Invoke-Fc -Two -Cdp @{ redirectTo = 'http://127.0.0.1:{PORT2}/json/version' }
        Chk 'FC-14b a redirect is refused' $r '5' '/json/version on port' $null 1
        Test-Result 'FC-14b the redirect target got no request' ($r.second -eq 0) ('second=' + $r.second)
    }
    Row 'FC-15' {
        $r = Invoke-Fc -Cdp @{ pages = 2 }
        Chk 'FC-15 two app pages' $r '5' 'need exactly one page target, found 2' $null 1
        Test-Result 'FC-15 no WebSocket' ($r.ws -eq 0) ''
        $r = Invoke-Fc -Cdp @{ devtoolsPage = $true }
        Chk 'FC-15 one page plus a devtools:// page passes' $r '0' 'file-chooser ok' $seqOk 0
    }
    Row 'FC-16' {
        $r = Invoke-Fc -Two -Cdp @{ wsHostPort = '127.0.0.1:{PORT2}' }
        Chk 'FC-16a webSocketDebuggerUrl on another port' $r '96' 'webSocketDebuggerUrl does not point' $null 1
        Test-Result 'FC-16a no WebSocket anywhere' ($r.ws -eq 0 -and $r.second -eq 0) ('ws=' + $r.ws + ' second=' + $r.second)
        $r = Invoke-Fc -Cdp @{ wsPath = '/devtools/page/OTHER' }
        Chk 'FC-16b ws path differs from the page id' $r '96' 'webSocketDebuggerUrl does not point' $null 1
        Test-Result 'FC-16b no WebSocket' ($r.ws -eq 0) ''
    }
    Row 'FC-17' {
        $r = Invoke-Fc -Adb @{ adj = @{ '4242' = 900 } }
        Chk 'FC-17 app not in front' $r '93' 'is not the foreground package' $null 1
        Test-Result 'FC-17 no CDP method and no WebSocket' ($r.cdp.Count -eq 0 -and $r.ws -eq 0) ''
    }
    Row 'FC-18' {
        $ev = @{ count = 1; x = 100; y = 200; w = 300; h = 80; dpr = 2; inView = $true; onTop = $true }
        $variants = @(
            @{ n = 'count 0'; v = @{ count = 0 }; reason = 'matching elements' }, @{ n = 'count 2'; v = @{ count = 2 }; reason = 'matching elements' },
            @{ n = 'not in view'; v = (Merge-Config $ev.Clone() @{ inView = $false }); reason = 'not fully inside the viewport' },
            @{ n = 'covered'; v = (Merge-Config $ev.Clone() @{ onTop = $false }); reason = 'another element covers' },
            @{ n = 'zero size'; v = (Merge-Config $ev.Clone() @{ w = 0; h = 0 }); reason = 'zero-area bounds' }
        )
        foreach ($c in $variants) {
            $r = Invoke-Fc -Cdp @{ evalValue = $c.v }
            Chk ('FC-18 ' + $c.n) $r '6' $c.reason @($mEval) 1
            Test-Result ('FC-18 no tap for ' + $c.n) ((Get-Tap $r).Count -eq 0) ''
        }
        $r = Invoke-Fc -Cdp @{ evalException = $true }
        Chk 'FC-18 evaluate exceptionDetails' $r '6' 'could not run the element probe' @($mEval) 1
        $r = Invoke-Fc -Cdp @{ evalError = $true }
        Chk 'FC-18 evaluate protocol error' $r '5' 'element probe failed' @($mEval) 1
    }
    Row 'FC-19' {
        $r = Invoke-Fc -Cdp @{ suppressEvent = $true } -Over @{ '--timeout-s' = '1' }
        Chk 'FC-19 chooser never opens' $r '7' 'the chooser did not open' $seqNoEvent 1
        Test-Result 'FC-19 tap recorded, no setFileInputFiles' ((Get-Tap $r).Count -eq 1 -and @($r.cdp | Where-Object method -eq $mSet).Count -eq 0) ''
        $r = Invoke-Fc -Cdp @{ suppressEvent = $true } -Over @{ '--timeout-s' = '1' } -Adb @{ pids = @{ $pkg = '4242'; 'com.android.documentsui' = '5151' }; adj = @{ '4242' = 0; '5151' = 0 } }
        Chk 'FC-19 a system picker in front is named, and no key is sent' $r '7' 'press Back once via the guard and stop; never tap it' $seqNoEvent 1
        Test-Result 'FC-19 no keyevent' (@($r.calls | Where-Object { $_ -match 'keyevent' }).Count -eq 0) ''
    }
    Row 'FC-20' {
        $r = Invoke-Fc -Cdp @{ eventParams = @{ backendNodeId = $null } }
        Chk 'FC-20 event without backendNodeId' $r '7' 'malformed Page.fileChooserOpened' $seqNoEvent 1
        $r = Invoke-Fc -Cdp @{ eventParams = @{ mode = 'uploadFolder' } }
        Chk 'FC-20 event with mode uploadFolder' $r '7' 'malformed Page.fileChooserOpened' $seqNoEvent 1
    }
    Row 'FC-21' {
        $r = Invoke-Fc -Cdp @{ errorMethods = @($mSet) }
        Chk 'FC-21 setFileInputFiles error' $r '7' 'DOM.setFileInputFiles failed' $seqSetFail 1
    }
    Row 'FC-22' {
        $r = Invoke-Fc -Cdp @{ fileModel = @{ count = 0; name = 't38-encrypted.rtb'; size = 18524; mode = 'ok' } }
        Chk 'FC-22 no file in the input' $r '7' 'read-back count 0' $seqOk 1
        $r = Invoke-Fc -Cdp @{ fileModel = @{ count = 2; name = 't38-encrypted.rtb'; size = 18524; mode = 'ok' } }
        Chk 'FC-22 two files in the input' $r '7' 'read-back count 2' $seqOk 1
        $r = Invoke-Fc -Cdp @{ fileModel = @{ count = 1; name = 'other.rtb'; size = 18524; mode = 'ok' } }
        Chk 'FC-22 other file name' $r '7' 'read-back name mismatch' $seqOk 1
        $r = Invoke-Fc -Cdp @{ fileModel = @{ count = 1; name = 't38-encrypted.rtb'; size = 0; mode = 'ok' } }
        Chk 'FC-22 page size 0 against the device size' $r '7' 'read-back size mismatch' $seqOk 1
        $r = Invoke-Fc -Adb @{ stat = 200000 } -Cdp @{ fileModel = @{ count = 1; name = 't38-encrypted.rtb'; size = 300000; mode = 'ok' } }
        Chk 'FC-22b page size 300000 against device size 200000 (the head read alone cannot see it)' $r '7' 'read-back size mismatch' $seqOk 1
    }
    Row 'FC-23' {
        $r = Invoke-Fc -Adb @{ fileKind = 'missing' }
        Chk 'FC-23a device file missing' $r '4' 'is missing, not a regular file' @() 1
        Test-Result 'FC-23a only the device file call, no CDP' ($r.calls.Count -eq 1 -and $r.cdp.Count -eq 0 -and $r.ws -eq 0) ''
        $r = Invoke-Fc -Adb @{ stat = 0 }
        Chk 'FC-23b device file empty' $r '4' 'is missing, not a regular file' @() 1
        foreach ($k in @('dir', 'symlink')) {
            $r = Invoke-Fc -Adb @{ fileKind = $k }
            Chk ('FC-23c device path is a ' + $k) $r '4' 'is missing, not a regular file' @() 1
            Test-Result ('FC-23c no CDP for ' + $k) ($r.cdp.Count -eq 0 -and $r.ws -eq 0) ''
        }
    }
    Row 'FC-24' {
        $r = Invoke-Fc -Adb @{ forwards = @('{OTHER} tcp:{PORT} localabstract:webview_devtools_remote_1111', 'R5CWTABTEST1 tcp:6000 localabstract:webview_devtools_remote_2222', '{SER} tcp:{PORT} localabstract:webview_devtools_remote_4242') }
        Chk 'FC-24 happy call with other serials in the forward list' $r '0' 'file-chooser ok' $seqOk 0
        $lg = $r.logText
        Test-Result 'FC-24 no other serial, no raw list line in the log' (-not $lg.Contains('R5CWTABTEST1') -and -not $lg.Contains('remote_1111') -and -not $lg.Contains('remote_2222') -and -not $lg.Contains('tcp:6000') -and $lg.Contains('file-chooser forward tcp:')) ''
        Test-Result 'FC-24 no raw list on stdout or stderr' (-not $r.text.Contains('R5CWTABTEST1') -and -not $r.text.Contains('remote_1111')) ''
        $cdpLogLines = @([regex]::Matches($lg, '(?m)^\S+ cdp: (\S+)\r?$') | ForEach-Object { $_.Groups[1].Value })
        Test-Result 'FC-24 one cdp: line per method sent' (($cdpLogLines -join ' ') -eq (($r.cdp | ForEach-Object { $_.method }) -join ' ')) ($cdpLogLines -join ',')
    }
    Row 'FC-25' {
        $r = Invoke-Fc -Adb @{ fileKind = 'missing' }
        Chk 'FC-25 first counted failure' $r '4' '' $null 1
        $r = Invoke-Fc -Keep -Adb @{ fileKind = 'missing' }
        Chk 'FC-25 second counted failure' $r '4' '' $null 2
        $r = Invoke-Fc -Keep
        Chk 'FC-25 the third call is 98' $r '98' 'two file-chooser errors already' $null 2
        Test-Result 'FC-25 no adb call and no CDP' (Test-Quiet $r) ''
        $r = Invoke-Fc -NoServer -StateText '{"offset":{"x":1,"y":2},"fileChooserErrors":2}'
        Chk 'FC-25 98 from a state file with two errors' $r '98' 'two file-chooser errors already'
        Test-Result 'FC-25 no adb call' (Test-Quiet $r) ''
    }
    Row 'FC-26' {
        $r = Invoke-Raw (@('--serial', $pg[1], '--log', $log, '--', 'pick', '--name', 't38-encrypted.rtb'))
        Chk 'FC-26 plain pick with misplaced --name' $r '2' '--name is an adbg option and goes before --'
        Test-Result 'FC-26 misplaced --name sends no adb call' ($r.calls.Count -eq 0) ''
        $r = Invoke-Raw (@('--serial', $pg[1], '--log', $log, '--', 'file-chooser', '--x'))
        Chk 'FC-26 plain file-chooser with misplaced --x' $r '2' '--x is an adbg option and goes before --'
        Test-Result 'FC-26 misplaced --x sends no adb call' ($r.calls.Count -eq 0) ''
    }
    Row 'FC-28' {
        $r = Invoke-Fc -Cdp @{ errorMethods = @($mOn) }
        Chk 'FC-28a intercept(true) refused: no tap' $r '7' 'file chooser interception refused' $seqNoTap 1
        Test-Result 'FC-28a fake adb recorded no input tap' ((Get-Tap $r).Count -eq 0) ''
        $r = Invoke-Fc -Cdp @{ errorMethods = @($mEnable) }
        Chk 'FC-28b Page.enable refused: no tap' $r '7' 'Page.enable refused' $seqEnableFail 1
        Test-Result 'FC-28b fake adb recorded no input tap' ((Get-Tap $r).Count -eq 0) ''
        $r = Invoke-Fc -Adb @{ tapExit = 1 }
        Chk 'FC-28c the tap itself fails' $r '7' 'the tap failed' $seqNoTap 1
    }
    Row 'FC-29' {
        $r = Invoke-Fc -Cdp @{ fileModel = @{ count = 1; name = 't38-encrypted.rtb'; size = 18524; mode = 'reject' } }
        Chk 'FC-29a the read is rejected' $r '7' 'read-back rejected by the page' $seqOk 1
        $r = Invoke-Fc -Cdp @{ fileModel = @{ count = 1; name = 't38-encrypted.rtb'; size = 18524; mode = 'short' } }
        Chk 'FC-29b the read returns too few bytes' $r '7' 'read-back head mismatch' $seqOk 1
        $r = Invoke-Fc -Adb @{ stat = 200000 } -Cdp @{ fileModel = @{ count = 1; name = 't38-encrypted.rtb'; size = 200000; mode = 'ok' } }
        Chk 'FC-29c large file reads only 64 KiB' $r '0' 'head=65536' $seqOk 0
        $slices = @($r.cdpAll | Where-Object { $_.PSObject.Properties['slice'] } | ForEach-Object { [int]$_.slice })
        Test-Result 'FC-29c largest slice requested is at most 65536' ($slices.Count -ge 1 -and ($slices | Measure-Object -Maximum).Maximum -le 65536) ('slices=' + ($slices -join ','))
        $r = Invoke-Fc -Cdp @{ nodeGone = $true }
        Chk 'FC-29d resolveNode error' $r '7' 'DOM.resolveNode failed' $seqNodeFail 1
        $r = Invoke-Fc -Cdp @{ noObject = $true }
        Chk 'FC-29e resolveNode answers a result without an object' $r '7' 'returned no object' $seqNodeFail 1
    }
    Row 'FC-30' {
        $variants = @(
            @{ n = '4'; code = '4'; a = @{ fileKind = 'missing' }; c = @{}; o = @{} },
            @{ n = '5'; code = '5'; a = @{ forwards = @('{OTHER} tcp:{PORT} localabstract:webview_devtools_remote_4242') }; c = @{}; o = @{} },
            @{ n = '6'; code = '6'; a = @{}; c = @{ evalValue = @{ count = 0 } }; o = @{} },
            @{ n = '7'; code = '7'; a = @{}; c = @{ errorMethods = @($mEnable) }; o = @{} },
            @{ n = '93'; code = '93'; a = @{ adj = @{ '4242' = 900 } }; c = @{}; o = @{} },
            @{ n = '96'; code = '96'; a = @{}; c = @{ pkg = 'com.android.chrome' }; o = @{} }
        )
        foreach ($v in $variants) {
            $r = Invoke-Fc -Adb $v.a -Cdp $v.c -Over $v.o
            Chk ('FC-30 exit ' + $v.n + ' is counted once') $r $v.code '' $null 1
        }
        $r = Invoke-Fc -NoServer -Over @{ '--file' = 'x.rtb' }
        Chk 'FC-30 exit 2 is not counted' $r '2' '' $null 0
        $r = Invoke-Fc -NoServer -Ser 'R5CWTABTEST1'
        Chk 'FC-30 exit 95 is not counted' $r '95' '' $null 0
        $r = Invoke-Fc -NoServer -Ser 'emulator-5580'
        Chk 'FC-30 exit 97 is not counted' $r '97' '' $null 0
        $r = Invoke-Fc -NoServer -StateText '{"offset":{"x":1,"y":2},"fileChooserErrors":2}'
        Chk 'FC-30 exit 98 is not counted again' $r '98' '' $null 2
    }
    Row 'FC-31' {
        $r = Invoke-Fc -Adb @{ tapWait = $true }
        Chk 'FC-31 the chooser event arrives while the tap blocks the guard' $r '0' 'file-chooser ok' $seqOk 0
    }
    Row 'FC-32' {
        $r = Invoke-Fc -Cdp @{ errorMethods = @($mOff) }
        Chk 'FC-32 interception off not acknowledged on a good path' $r '7' 'interception off not acknowledged' $seqOk 1
        $r = Invoke-Fc -Cdp @{ errorMethods = @($mDisable) }
        Chk 'FC-32 Page.disable not acknowledged on a good path' $r '7' 'interception off not acknowledged' $seqOk 1
    }
    Row 'FC-33' {
        $free = [string](Get-FreePort)
        $r = Invoke-Fc -NoServer -Port $free
        Chk 'FC-33 forward listed, nothing listening' $r '5' '/json/version on port' $null 1
    }
    Row 'FC-35' {
        $r = Invoke-Fc -Cdp @{ nonJsonFrame = $true }
        Chk 'FC-35 frames that do not parse, or are not objects, are ignored' $r '0' 'file-chooser ok' $seqOk 0
    }
}
finally {
    foreach ($p in $script:procs) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
}
'ok=' + $script:passes + ' failures=' + $script:failures
exit $script:failures
