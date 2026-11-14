// adbg.mjs - adb accident guard for agent-driven device runs. Every adb call in a run goes through it.
// It is an ALLOWLIST: anything not listed below is refused. It stops accidental breaches of the device
// rules; it is not a sandbox against an agent that edits its own state or log files (the independent
// check compares the log with the report).
//
// Common options: --serial <s> --log <run>/adb-commands.log [--own-ports 9465,9466,6271] [--own-package <app id>]
// Every call writes an "intent" line before it runs and an "exit" line after; refusals are logged.
//
//   node adbg.mjs <common> -- <adb args...>          plain call, allowed only if it matches the allowlist:
//     shell <one command string>, where the command is one of
//       getprop [key] | date [+fmt] | pidof <pkg> | wm size|density [<n>] | settings get|put|delete <ns> <key> [v]
//       am start ... (no -d/--data or scheme://; -n only for --own-package) | am force-stop|kill <own package>
//       pm clear <own package> | pm path <pkg> | input keyevent <navigation keys> | input text ... (typing chain, below) | svc wifi|data enable|disable expand-notifications|collapse | cat /proc/<pid>/oom_score_adj|cgroup|stat
//       ps -A [-o cols] | grep <literal>   (a device-side filter is required; never a full list)
//       screenrecord [--time-limit 1-30] [--size WxH] [--bit-rate n] <exact .mp4 path below>
//       sha256sum|ls|rm -f /sdcard/Download/<name> or /data/local/tmp/<name> (one file, name not starting with a dot)
//     exec-out screencap -p (with --out <png>, written as binary; with --state it is noted for locate-shot) | logcat --pid <n> [-v <fmt>] [-d] [-T <n>|-t <n>] [-s <Tag>]
//     forward|reverse tcp:<own port> <target> | forward|reverse --remove tcp:<own port>
//     install [-r] [-d] <local apk> | push <local file> /sdcard/Download/<exact name>
//     pull <exact file path as for ls> <local path>
//   Only printable ASCII; control characters (newline, tab), shell metacharacters ; & ` $ ( ) < > \ and quotes
//
//   Typing chain (needs --state): `input text` (once) and the edit/submit keys (TAB, ENTER, DEL, FORWARD_DEL) are
//   allowed only when the previous action line in --log is the successful `tap` that wrote a typing grant, or a
//   successful typing call of the same chain, within 30 s of that tap; anything else in between ends the chain.
//   Other keyevents: navigation keys only (HOME, BACK, POWER, MENU, ESCAPE, APP_SWITCH, WAKEUP, SLEEP, the four
//   DPAD arrows, PAGE_UP/DOWN, MOVE_HOME/END); DPAD_CENTER, SPACE, letters and digits are refused.
//
//   Restricted serials (2026-11-11, lane A): only the serials in FULL_ACCESS_SERIALS (Note 9 phone 1, Note 9
//   phone 2, emulator-5580) get everything above. Any other --serial (a personal device) runs RESTRICTED,
//   fail-closed: allowed are `reverse` and `forward` of an own port (forward only to
//   localabstract:webview_devtools_remote_*) and their --remove, `exec-out screencap -p --out <png>`, `shell pidof|pm path
//   <own package>`, `shell sha256sum` of the own package's installed base.apk, `shell getprop` of a few read-only
//   model/boot keys, and the read-only subcommands locate-css, locate-shot and offset. Everything else (tap, pick,
//   proc-tasks, input, am, pm clear/install, svc, settings, logcat, push, pull, rm, install ...) exits 95 naming the
//   serial. The only way to widen is `--scope-file <json>` = {"serial","approvedBy":"maintainer","date","allow":[...]}
//   with allow from tap|input-text|keyevent|am-start|install, honoured only for that exact serial; every call that
//   reads it logs the file path and its sha256. The widened classes still pass the normal allowlist and typing chain.
//
//   Playground mode (2026-11-13, MC-1666): the two spare Note 9s, 29f3cde9193f7ece and 2ac80128013f7ece, hold only
//   synthetic data. Those two serials, and no other, run in PLAYGROUND mode. Membership is the exact --serial string
//   against the constant PLAYGROUND_SERIALS below: no flag, env var, state file or log content can add a serial or
//   turn it on (emulator-5580 stays a plain full-access serial; a near-miss serial is restricted). The guard stays
//   mandatory as the audit log: every call is logged, a playground-allowed call also gets a `PLAYGROUND serial=...`
//   line, the serial lock stays (an adb call is always sent `-s <--serial>`; `-s`/`-P` inside the adb args is refused),
//   and everything r11 allows still applies. On a playground serial only, in addition:
//     input tap X Y | input swipe X1 Y1 X2 Y2 [ms] | input keyevent [--longpress] <KEYCODE_* or number>... | input text ...
//       with no locate, no typing grant and no failed-locate input lock (exit 92 never applies; no lock is recorded);
//     dumpsys [<service> [args]] (read-only: set, reset, unplug, enable, disable, force-*, unforce, whitelist, step,
//       write, suppress and similar state-changing words are refused), except the exact form
//       `dumpsys gfxinfo io.github.yor42.risutanium reset` when --own-package is that same id (frame counters, CHORE-743);
//     logcat with any filter/format/buffer arguments (no --pid needed) but it must carry -d, -t or -T (also for the
//       r11 `--pid` form); clearing or resizing the buffer (-c, -G, -P) and writing it to a device file (-f, -r, -n)
//       are refused;
//     uiautomator dump [--compressed] [/dev/tty | /sdcard/<name> | /sdcard/Download/<name> | /data/local/tmp/<name>];
//     ls [-alhRdF1] <path under /sdcard> and cat <one file under /sdcard>  (plain path segments, no `..`);
//     pm clear io.github.yor42.risutanium only, and only when --own-package is that same id (else refused, exit 97);
//       screencap as in r11 (full frame, no crop is ever required).
//   Known limits (kept as is): the dumpsys refuse list is best-effort; uiautomator dump may write a file on /sdcard or
//   /data/local/tmp; install follows r11 (any local .apk); verbs not listed here stay refused. r11 still allows
//   `svc wifi|data enable|disable` and `settings get|put|delete` on these serials (parity; the briefs enforce the Wi-Fi rule).
//   Still refused on playground serials exactly as in r11 (the tests keep them refused): `pm clear` of any other package,
//   uninstall, install of anything but a local .apk (r11 rule), reboot, root, remount, disable-verity, su, rm of anything
//   but one file in /sdcard/Download or /data/local/tmp (r11 rule), cmd wifi, forward/reverse to ports outside
//   --own-ports, and push outside /sdcard/Download/<name>.
//
//   node adbg.mjs pick <common> --state <run>/guard-state.json --name <exact-name>
//     MC-1438 picker helper. One device-side command dumps the UI to a device file, greps for the exact
//     text, prints only the bounds, and deletes the dump by its exact name. Output: `match bounds=[l,t][r,b]`
//     or `no-match`. The first no-match (or more than one hit) exits 3, writes a PICK-LOCK line to the log
//     and locks the state; any later pick in a run whose log or state holds the lock is refused (exit 98).
//     A transport or dump error exits 4 and does not lock (at most 2 errors per run, then refused).
//
//   node adbg.mjs offset --state <state> --log <log> --x <px> --y <px>
//     Records the WebView's top-left on screen in device pixels.
//
//   node adbg.mjs locate-css --state <state> --log <log> --own-ports <p> --port <own cdp port> --url-contains <app url text>
//     Read-only CDP read of exactly one element: it must be inside the viewport and be the element (or contain
//     the element) at its own centre per elementFromPoint. Writes a locate record in device pixels and prints
//     only the selector and the bounds (never page text).
//
//   node adbg.mjs locate-shot --state <state> --log <log> --png <newest screencap> --label <control> --box l,t,r,b
//     Records a box the agent found by pixel analysis in the newest screencap this guard wrote with the
//     same --state (at most 10 s old). For surfaces where UI dumps are banned, such as the notification shade.
//
//   node adbg.mjs proc-tasks <common> --own-package <app id> --pid <n>
//     Per-thread tid, comm, utime and stime of one process; the device command first checks that its cmdline is
//     the own package or a WebView sandboxed renderer (exit 96, nothing read, otherwise).
//
//   node adbg.mjs tap <common> --state <state> [--max-age <s, 1-10, default 5>] [--x <px> --y <px>]
//     Taps the newest locate record (or a point strictly inside it). Refused (exit 99) without a record, when
//     it is older than --max-age, or when it was already used. Each record allows exactly one tap.
//
//   node adbg.mjs tap-home <common> --state <state> --delay-ms <integer 0-500> [--max-age <s>] [--x <px> --y <px>]
//     The only chained verb (CHORE-719): one tap exactly as `tap` (full-access serials only, a fresh unused locate
//     that it consumes, same refusal codes), then after the fixed delay `input keyevent KEYCODE_HOME` in the same
//     process. A failed tap sends no HOME. It logs both steps and a `tap-home timing` line with the tap-to-HOME gap.
//     It writes no typing grant, so `input text` after it is refused. Restricted serials refuse it even with a scope.
//
//   node adbg.mjs swipe <common> --own-package <app id> --state <state> --duration-ms <50-5000>
//        (--dx <px> --dy <px> | --to-x <px> --to-y <px>) [--max-age <s>]
//     MC-1539. Starts at the centre of the newest fresh, unused, same-serial locate (the same checks as `tap`, and
//     the locate is consumed). The end is the start plus --dx/--dy (integers, |dx| and |dy| at most the screen
//     size the locate recorded, else 3000) or an explicit --to-x/--to-y inside the screen (0 up to the recorded
//     size, else 3000). Sends exactly `input swipe x1 y1 x2 y2 ms`. Before it sends, a read-only foreground check
//     (`pidof <own package>`, then `cat /proc/<pid>/oom_score_adj` must read 0, the top app) must find our own
//     package in front; otherwise exit 93 and nothing is sent. It writes no typing grant.
//   node adbg.mjs hold <common> --own-package <app id> --state <state> --duration-ms <100-5000> [--max-age <s>]
//     A long press: `input swipe x y x y ms` (zero distance) at the centre of the locate, same rules as `swipe`.
//   Restricted serials always refuse swipe and hold (exit 95), even with a tap scope.
//
//   HARD STOP after a failed locate (MC-1539). When pick, locate-css or locate-shot exits non-zero for a serial, the
//   guard records an input lock for that serial in --state and as an INPUT-LOCK line in --log. While it is set,
//   every input-sending command (tap, tap-home, swipe, hold, `input keyevent` of any key including BACK, HOME,
//   DPAD and PAGE_DOWN, `input text`, the edit keys) is refused with exit 92 and the log line
//   `refused: input after failed locate`. Only a later SUCCESSFUL locate for that serial clears it. Read-only
//   commands (screencap, locate, reads) stay allowed. A restricted-serial refusal of the verb itself (exit 95)
//   attempted no locate and sets no lock. A locate that fails without a valid --serial
//   never reached a device and sets no lock; the lock is strictly per serial. This closes the 2026-11-12 cloud UI run breach (guard log line 409): a failed locate followed by
//   KEYCODE_BACK before any fresh locate. Exit codes added: 92 input lock, 93 own package not in front.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, resolve } from 'node:path'

const argv = process.argv.slice(2)
const sub = ['pick', 'locate-css', 'locate-shot', 'offset', 'tap', 'tap-home', 'swipe', 'hold', 'proc-tasks'].includes(argv[0]) ? argv.shift() : 'adb'
const sep = argv.indexOf('--')
const opts = sep < 0 ? argv : argv.slice(0, sep)
const rest = sep < 0 ? [] : argv.slice(sep + 1)
const opt = (name) => { const i = opts.indexOf(name); return i < 0 ? null : opts[i + 1] ?? null }
const now = () => new Date().toISOString()
const serial = opt('--serial')
const log = opt('--log')
const statePath = opt('--state')
const ownPorts = (opt('--own-ports') ?? '').split(',').filter((p) => /^\d{2,5}$/.test(p))
const logLine = (text) => { if (log) appendFileSync(log, `${now()} ${text}\n`) }
const die = (code, msg) => { logLine(`REFUSED/ERROR exit=${code}: ${JSON.stringify(msg)}`); console.error(`adbg: ${msg}`); process.exit(code) }
if (!log) { console.error('adbg: --log is required'); process.exit(2) }

// Tests may set ADBG_FAKE_ADB_SCRIPT to a Node script that stands in for adb; the allowlist still applies.
const spawnAdb = (args, options) => process.env.ADBG_FAKE_ADB_SCRIPT
  ? spawnSync(process.execPath, [process.env.ADBG_FAKE_ADB_SCRIPT, ...args], options)
  : spawnSync('adb', args, options)
const emptyState = () => ({ picks: [], pickErrors: 0, locates: [], offset: null, pickLocked: false })
const loadState = () => (statePath && existsSync(statePath)) ? JSON.parse(readFileSync(statePath, 'utf8')) : emptyState()
const saveState = (s) => { writeFileSync(statePath + '.tmp', JSON.stringify(s, null, 2)); renameSync(statePath + '.tmp', statePath) }
const runAdb = (args, capture) => {
  logLine(`intent: adb -s ${serial} ${JSON.stringify(args)}`)
  const r = spawnAdb(['-s', serial, ...args], { encoding: 'utf8', windowsHide: true, timeout: 600000, stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'] })
  const code = r.status ?? 1
  logLine(`exit=${r.status ?? (r.error?.code === 'ETIMEDOUT' ? 'timeout' : `signal ${r.signal}`)}: adb -s ${serial} ${JSON.stringify(args)}`)
  return { code, out: capture ? (r.stdout ?? '') : '' }
}
const needSerial = () => { if (!serial || !/^[A-Za-z0-9._:-]+$/.test(serial)) die(2, 'need a valid --serial') }
const needState = () => { if (!statePath) die(2, 'need --state') }
const ownPort = (p) => ownPorts.includes(p)

// ---- hard stop after a failed locate (MC-1539) ----
// A locate verb that exits non-zero locks input for its serial (state and log); only a later successful locate for
// the same serial clears it. The log copy lets an input call without --state see the lock too.
const LOCATE_VERBS = ['pick', 'locate-css', 'locate-shot']
// The lock is strictly per serial. A locate without a valid --serial never reached a device, so it sets no lock.
const validSerial = (ser) => !!ser && /^[A-Za-z0-9._:-]+$/.test(ser)
const lockKey = (ser) => ser
const logLocked = (key) => {
  if (!existsSync(log)) return false
  let v = false
  for (const l of readFileSync(log, 'utf8').split(/\r?\n/)) { const m = l.match(/^\S+ INPUT-(LOCK|UNLOCK) serial=(\S+)/); if (m && m[2] === key) v = m[1] === 'LOCK' }
  return v
}
// Playground serials (MC-1666) have no failed-locate input lock: none is recorded and none is enforced.
const inputLocked = (s) => validSerial(serial) && !playground && [lockKey(serial)].some((k) => (s?.inputLock && s.inputLock[k]) || logLocked(k))
const refuseIfLocked = (s) => { if (inputLocked(s)) die(92, 'refused: input after failed locate (a locate for this serial failed; run a successful locate before any input)') }
if (LOCATE_VERBS.includes(sub)) {
  process.on('exit', (code) => {
    try {
      if (!validSerial(serial) || playground) return
      const key = lockKey(serial)
      const s = loadState()
      // Exit 95 is the restricted-serial refusal of the verb itself: no locate was attempted, so nothing failed.
      if (code === 95) return
      if (code !== 0) {
        s.inputLock = { ...(s.inputLock ?? {}), [key]: { time: now(), verb: sub, exit: code } }
        if (statePath) saveState(s)
        logLine(`INPUT-LOCK serial=${key} verb=${sub} exit=${code}`)
      } else if ((s.inputLock && s.inputLock[key]) || logLocked(key)) {
        if (s.inputLock) delete s.inputLock[key]
        if (statePath) saveState(s)
        logLine(`INPUT-UNLOCK serial=${key} verb=${sub}`)
      }
    } catch { /* the exit code is what the caller sees; a lock write failure must not change it */ }
  })
}

// ---- plain allowlist ----
const META = /[;&`$()<>\\'"]/
// One file directly inside /sdcard/Download or /data/local/tmp; the name cannot start with a dot, so no
// `.`/`..` segment and no directory can be named.
const exactPath = { test: (p) => /^\/(sdcard\/Download|data\/local\/tmp)\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(p) }
const insideRunDir = (p) => {
  // A NEW file directly in the run folder, by an absolute path (adb resolves a relative path against its own
  // working directory). A plain name with an extension and no `~`, `:` or trailing dot rules out 8.3 aliases,
  // alternate data streams and device names; refusing an existing file protects the log, state and evidence.
  if (!p || /^-/.test(p) || !isAbsolute(p)) return false
  const runDir = resolve(dirname(log))
  const target = resolve(p)
  const name = basename(target)
  if (dirname(target).toLowerCase() !== runDir.toLowerCase()) return false
  if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]*\.[A-Za-z0-9]+$/.test(name)) return false
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)) return false
  const reserved = [log, statePath].filter(Boolean).map((f) => basename(resolve(f)).toLowerCase())
  if (reserved.includes(name.toLowerCase())) return false
  return !existsSync(target)
}
// Keys that move between screens or wake the device; they enter no text.
const NAV_KEYS = new Set(['3', '4', '19', '20', '21', '22', '26', '82', '92', '93', '111', '122', '123', '187', '224', '223', 'KEYCODE_DPAD_UP', 'KEYCODE_DPAD_DOWN', 'KEYCODE_DPAD_LEFT', 'KEYCODE_DPAD_RIGHT', 'KEYCODE_PAGE_UP', 'KEYCODE_PAGE_DOWN', 'KEYCODE_MOVE_HOME', 'KEYCODE_MOVE_END', 'KEYCODE_HOME', 'KEYCODE_BACK', 'KEYCODE_POWER', 'KEYCODE_MENU', 'KEYCODE_ESCAPE', 'KEYCODE_APP_SWITCH', 'KEYCODE_WAKEUP', 'KEYCODE_SLEEP'])
// Keys that edit or submit the focused field: allowed only inside the typing chain, like `input text`.
const TEXT_KEYS = new Set(['61', '66', '67', '112', 'KEYCODE_TAB', 'KEYCODE_ENTER', 'KEYCODE_DEL', 'KEYCODE_FORWARD_DEL'])
// Typing chain: `input text` (once) and text keys are allowed only when the previous action line in the log is
// a successful guarded tap on a fresh locate record (or a link of the same chain after it), and the state holds
// the grant that tap wrote. Typing into whatever happens to have focus is how agents typed blind.
const isTypingCall = (a) => a[0] === 'shell' && typeof a[1] === 'string' && (/^input text /.test(a[1].trim().replace(/ +/g, ' '))
  || (/^input keyevent /.test(a[1].trim().replace(/ +/g, ' ')) && a[1].trim().split(/ +/).slice(2).some((k) => TEXT_KEYS.has(k))))
const ACTION_LINE = /^\S+ (intent:|exit=|locate |tap |swipe |hold |offset |REFUSED|PICK-LOCK|match |no-match)/
const lastActionLine = () => {
  if (!existsSync(log)) return ''
  const lines = readFileSync(log, 'utf8').split(/\r?\n/).filter((l) => ACTION_LINE.test(l))
  return lines.length ? lines[lines.length - 1] : ''
}
const ownPackage = opt('--own-package')
const isOwnPackage = (p) => ownPackage !== null && /^[A-Za-z0-9._]+$/.test(ownPackage) && p === ownPackage
function allowedShell(cmd) {
  // Checked on the raw string, before any tokenising: a newline, tab or other control character would let
  // the device shell run a second command.
  if (/[^\x20-\x7e]/.test(cmd)) return false
  const c = cmd.trim().replace(/ +/g, ' ')
  const psm = c.match(/^ps -A( -o [A-Za-z0-9,]+)? \| grep ([A-Za-z0-9._:-]+)$/)
  if (psm) return true
  if (META.test(c) || c.includes('|') || c.includes('*') || c.includes('?')) return false
  const t = c.split(' ')
  const [v, a1, a2] = t
  switch (v) {
    case 'getprop': return t.length <= 2
    case 'date': return t.length <= 2
    case 'pidof': return t.length === 2
    case 'wm': return ['size', 'density'].includes(a1) && t.length <= 3 && (t.length < 3 || /^\d+$/.test(a2))
    case 'settings': return ['get', 'put', 'delete'].includes(a1) && ['system', 'secure', 'global'].includes(a2) && t.length >= 4 && t.length <= 5
    case 'am':
      if (['force-stop', 'kill'].includes(a1)) return t.length === 3 && isOwnPackage(a2)
      if (a1 !== 'start') return false
      // No URL data (-d, or any scheme://): a VIEW intent could open a browser or another service.
      if (t.includes('-d') || t.includes('--data') || c.includes('://')) return false
      for (let n = 0; n < t.length; n++) {
        if (t[n] === '-n' && !(ownPackage !== null && (t[n + 1] ?? '').startsWith(`${ownPackage}/`))) return false
      }
      return true
    case 'pm': return t.length === 3 && (a1 === 'path' || (a1 === 'clear' && isOwnPackage(a2)))
    // keyevent: navigation keys only, or the text-entry keys that the typing chain below gates.
    case 'input': return (a1 === 'text' && t.length >= 3) || (a1 === 'keyevent' && t.length >= 3 && t.slice(2).every((k) => NAV_KEYS.has(k) || TEXT_KEYS.has(k)))
    // data: the emulator's simulated mobile network, turned off for mock-only runs.
    case 'svc': return ['wifi', 'data'].includes(a1) && ['enable', 'disable'].includes(a2) && t.length === 3
    case 'cmd': return a1 === 'statusbar' && ['expand-notifications', 'collapse'].includes(a2) && t.length === 3
    case 'cat': return t.length === 2 && /^\/proc\/\d+\/(oom_score_adj|cgroup|stat)$/.test(a1)
    // The installed APK of the own package only (path as `pm path` prints it), for the install read-back.
    case 'sha256sum': return t.length === 2 && (exactPath.test(a1) || (ownPackage !== null
      && /^\/data\/app\/([A-Za-z0-9._=~-]+\/)?[A-Za-z0-9._=~-]+\/base\.apk$/.test(a1) && a1.includes(`/${ownPackage}-`) && !a1.includes('..')))
    case 'screenrecord': {
      // screenrecord [--time-limit 1-30] [--size WxH] [--bit-rate n] <one exact .mp4 file>
      const out = t[t.length - 1]
      if (t.length < 2 || !exactPath.test(out) || !out.endsWith('.mp4')) return false
      for (let i = 1; i < t.length - 1; i += 2) {
        const f = t[i], val = t[i + 1] ?? ''
        if (f === '--time-limit' && /^\d+$/.test(val) && +val >= 1 && +val <= 30) continue
        if (f === '--size' && /^\d{2,4}x\d{2,4}$/.test(val)) continue
        if (f === '--bit-rate' && /^\d{1,9}$/.test(val)) continue
        return false
      }
      return (t.length - 2) % 2 === 0 && t.includes('--time-limit')
    }
    case 'ls': return t.length === 2 && exactPath.test(a1)
    case 'rm': return t.length === 3 && a1 === '-f' && exactPath.test(a2)
    default: return false
  }
}
function allowedPlain(a) {
  const [v] = a
  if (v === 'shell') return a.length === 2 && allowedShell(a[1])
  if (v === 'exec-out') return a.length === 3 && a[1] === 'screencap' && a[2] === '-p'
  if (v === 'logcat') {
    if (a[1] !== '--pid' || !/^\d+$/.test(a[2] ?? '')) return false
    for (let i = 3; i < a.length; i++) {
      if (a[i] === '-d') continue
      if (['-v', '-T', '-t'].includes(a[i]) && /^[A-Za-z0-9]+$/.test(a[i + 1] ?? '')) { i++; continue }
      if (a[i] === '-s' && /^[A-Za-z0-9_]+$/.test(a[i + 1] ?? '')) { i++; continue }
      return false
    }
    return true
  }
  if (v === 'forward' || v === 'reverse') {
    if (a[1] === '--remove') return a.length === 3 && /^tcp:\d+$/.test(a[2]) && ownPort(a[2].slice(4))
    if (a[1] === '--list') return false
    return a.length === 3 && /^tcp:\d+$/.test(a[1]) && ownPort(a[1].slice(4)) && /^(tcp:\d+|localabstract:[A-Za-z0-9_.-]+)$/.test(a[2])
  }
  if (v === 'install') { const f = a.slice(1).filter((x) => !['-r', '-d'].includes(x)); return f.length === 1 && /\.apk$/i.test(f[0]) }
  // pull: one named file (an extension is required, so a directory is not copied recursively) into the run
  // folder that holds --log.
  if (v === 'pull') return a.length === 3 && exactPath.test(a[1]) && /\.[A-Za-z0-9]+$/.test(a[1]) && insideRunDir(a[2])
  if (v === 'push') return a.length === 3 && /^\/sdcard\/Download\/[A-Za-z0-9._-]+$/.test(a[2])
  return false
}

// ---- playground additions (MC-1666): consulted only when `playground` is true, after allowedPlain refused ----
const PG_INT = /^\d{1,5}$/
const PG_KEY = /^(KEYCODE_[A-Z0-9_]+|\d{1,3})$/
// Plain path segments only: no `..`, no `.` segment, no hidden-name tricks, no globbing or metacharacters.
const PG_SDCARD_DIR = /^\/sdcard(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*\/?$/
const PG_SDCARD_FILE = /^\/sdcard(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)+$/
const PG_DUMP_TARGET = /^(\/dev\/tty|\/sdcard(\/Download)?\/[A-Za-z0-9_-][A-Za-z0-9._-]*|\/data\/local\/tmp\/[A-Za-z0-9_-][A-Za-z0-9._-]*)$/
// dumpsys is read-only except for a few services that take a state-changing word (battery set, deviceidle force-idle ...).
const PG_DUMPSYS_REFUSED = new Set(['set', 'reset', 'unplug', 'enable', 'disable', 'unforce', 'whitelist', 'step', 'write', 'suppress', 'clear', 'remove', 'kill', 'restart', 'stop', 'send', 'delete', 'add', 'override', 'trim', 'crash', 'sleep', 'wake', '--reset', '--clear', '--enable', '--disable', 'suspend_input'])
const pgDumpsysArg = (x) => /^[A-Za-z0-9._:-]+$/.test(x) && !PG_DUMPSYS_REFUSED.has(x.toLowerCase()) && !/^(set-|force-|unforce)/i.test(x)
// logcat: reading only. -c/--clear, -G/--buffer-size, -P/--prune (change the buffer) and -f/--file, -r, -n (write a device file) are refused,
// as is any long option not listed, and a short cluster containing one of those letters.
const PG_LOGCAT_LONG = new Set(['--pid', '--uid', '--dividers', '--last', '--format', '--buffer', '--tail', '--since'])
function playgroundLogcat(args) {
  for (const x of args) {
    if (x.startsWith('--')) { if (!PG_LOGCAT_LONG.has(x)) return false; continue }
    if (/^-[A-Za-z]+$/.test(x)) { if (/[cGPfrn]/.test(x)) return false; continue }
    if (/^(\*|[A-Za-z0-9_.:-]+):[VDIWEFS]$/.test(x) || /^[A-Za-z0-9_.:-]+$/.test(x)) continue
    return false
  }
  return true
}
function playgroundShell(cmd) {
  if (typeof cmd !== 'string' || /[^\x20-\x7e]/.test(cmd)) return false
  const c = cmd.trim().replace(/ +/g, ' ')
  if (META.test(c) || c.includes('|') || c.includes('*') || c.includes('?')) return false
  const t = c.split(' ')
  switch (t[0]) {
    case 'input':
      if (t[1] === 'tap') return t.length === 4 && PG_INT.test(t[2]) && PG_INT.test(t[3])
      if (t[1] === 'swipe') return (t.length === 6 || t.length === 7) && t.slice(2).every((x) => PG_INT.test(x))
      if (t[1] === 'keyevent') { const keys = t[2] === '--longpress' ? t.slice(3) : t.slice(2); return keys.length >= 1 && keys.every((k) => PG_KEY.test(k)) }
      return false
    case 'dumpsys':
      // The one state-changing dumpsys form allowed: resetting the own app's frame counters, so frame stats can be
      // read per measurement window. Exact shape only, and only for the --own-package app.
      if (t.length === 4 && t[1] === 'gfxinfo' && t[3] === 'reset') return t[2] === 'io.github.yor42.risutanium' && isOwnPackage(t[2])
      return t.length <= 8 && t.slice(1).every(pgDumpsysArg)
    case 'uiautomator': {
      if (t[1] !== 'dump') return false
      const r = t.slice(2)
      if (r[0] === '--compressed') r.shift()
      return r.length === 0 || (r.length === 1 && PG_DUMP_TARGET.test(r[0]))
    }
    case 'ls': {
      const r = t.slice(1)
      if (r.length > 0 && /^-[alhRdF1]+$/.test(r[0])) r.shift()
      return r.length === 1 && PG_SDCARD_DIR.test(r[0])
    }
    case 'cat': return t.length === 2 && PG_SDCARD_FILE.test(t[1])
    default: return false
  }
}
function allowedPlayground(a) {
  if (a[0] === 'shell') return a.length === 2 && playgroundShell(a[1])
  if (a[0] === 'logcat') return playgroundLogcat(a.slice(1))
  return false
}
// Playground pins: pm clear only of the hard-coded app id (and only when --own-package names it too), and logcat is
// bounded by -d, -t or -T. These apply on top of the r11 rules, to r11-allowed forms as well.
const PG_PACKAGE = 'io.github.yor42.risutanium'
function playgroundPinned(a) {
  if (a[0] === 'logcat') return a.some((x) => ['-d', '-t', '-T'].includes(x))
  if (a[0] === 'shell' && typeof a[1] === 'string') {
    const t = a[1].trim().replace(/ +/g, ' ').split(' ')
    if (t[0] === 'pm' && t[1] === 'clear') return t.length === 3 && t[2] === PG_PACKAGE && ownPackage === PG_PACKAGE
  }
  return true
}
const logPlayground =(cls, args) => logLine(`PLAYGROUND serial=${serial} allow=${cls} adb ${JSON.stringify(args)}`)

// ---- restricted serials ----
// Every serial not listed here is a personal device and runs in restricted mode (fail-closed).
const FULL_ACCESS_SERIALS = new Set(['29f3cde9193f7ece', '2ac80128013f7ece', 'emulator-5580'])
const restricted = serial !== null && !FULL_ACCESS_SERIALS.has(serial)
// Playground mode (MC-1666): exactly the two spare Note 9s, matched against the --serial string exactly (no prefix,
// case or substring match). This constant is the only source: no flag, env var, state file or log can extend it.
const PLAYGROUND_SERIALS = new Set(['29f3cde9193f7ece', '2ac80128013f7ece'])
const playground = !restricted && serial !== null && PLAYGROUND_SERIALS.has(serial)
const SCOPE_CLASSES = ['tap', 'input-text', 'keyevent', 'am-start', 'install']
// Only a maintainer-approved scope file naming exactly this serial opens extra classes; each call that reads
// it logs its path and sha256 so the independent check can compare it with what the maintainer approved.
function loadScope() {
  const p = opt('--scope-file')
  if (!restricted || p === null) return new Set()
  let text
  try { text = readFileSync(p) } catch (e) { die(2, `cannot read --scope-file: ${e.message}`) }
  logLine(`scope-file ${JSON.stringify(p)} sha256=${createHash('sha256').update(text).digest('hex')}`)
  let j
  try { j = JSON.parse(text.toString('utf8')) } catch (e) { die(2, `--scope-file is not valid JSON: ${e.message}`) }
  const valid = j !== null && typeof j === 'object' && typeof j.serial === 'string' && j.approvedBy === 'maintainer'
    && typeof j.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.date)
    && Array.isArray(j.allow) && j.allow.every((x) => SCOPE_CLASSES.includes(x))
  if (!valid) die(2, `--scope-file must be {"serial","approvedBy":"maintainer","date":"YYYY-MM-DD","allow":[subset of ${SCOPE_CLASSES.join(',')}]}`)
  if (j.serial !== serial) { logLine(`scope-file names ${JSON.stringify(j.serial)}, not ${serial}: nothing widened`); return new Set() }
  return new Set(j.allow)
}
const scopeAllowed = restricted ? loadScope() : new Set()
const scopeAllows = (cls) => scopeAllowed.has(cls)
const refuseRestricted = (what) => die(95, `restricted serial ${serial}: ${what} is refused (personal device; only the maintainer can widen it with --scope-file)`)
// Read-only model/boot keys; no serial number keys.
const RESTRICTED_PROPS = new Set(['ro.product.model', 'ro.product.manufacturer', 'ro.product.brand', 'ro.product.device', 'ro.build.version.release', 'ro.build.version.sdk', 'ro.boot.hardware', 'sys.boot_completed'])
function restrictedShell(cmd) {
  if (typeof cmd !== 'string' || /[^\x20-\x7e]/.test(cmd)) return false
  const t = cmd.trim().replace(/ +/g, ' ').split(' ')
  switch (t[0]) {
    case 'pidof': return t.length === 2 && isOwnPackage(t[1])
    case 'pm': return t.length === 3 && t[1] === 'path' && isOwnPackage(t[2])
    case 'sha256sum': return t.length === 2 && ownPackage !== null && /^\/data\/app\/([A-Za-z0-9._=~-]+\/)?[A-Za-z0-9._=~-]+\/base\.apk$/.test(t[1]) && t[1].includes(`/${ownPackage}-`) && !t[1].includes('..')
    case 'getprop': return t.length === 2 && RESTRICTED_PROPS.has(t[1])
    case 'input': return (t[1] === 'text' && scopeAllows('input-text')) || (t[1] === 'keyevent' && scopeAllows('keyevent'))
    // am-start scope opens only the own package's explicit component: no action, category, data or extras,
    // so CALL/DIAL/VIEW intents stay refused.
    case 'am': return scopeAllows('am-start') && ownPackage !== null && t[1] === 'start'
      && ((t.length === 4 && t[2] === '-n' && /^[A-Za-z0-9._]+\/[A-Za-z0-9._$]+$/.test(t[3]) && t[3].startsWith(`${ownPackage}/`))
        || (t.length === 5 && t[2] === '-W' && t[3] === '-n' && /^[A-Za-z0-9._]+\/[A-Za-z0-9._$]+$/.test(t[4]) && t[4].startsWith(`${ownPackage}/`)))
    default: return false
  }
}
function restrictedAllows(a) {
  const [v] = a
  // Both ends must be own ports: the host end decides which PC service the personal device can reach.
  if (v === 'reverse') return a[1] === '--remove' || (a.length === 3 && /^tcp:\d+$/.test(a[1]) && /^tcp:\d+$/.test(a[2]) && ownPort(a[1].slice(4)) && ownPort(a[2].slice(4)))
  if (v === 'forward') return a[1] === '--remove' || (a.length === 3 && /^localabstract:webview_devtools_remote_[A-Za-z0-9_.-]+$/.test(a[2]))
  if (v === 'exec-out') return a.length === 3 && a[1] === 'screencap' && a[2] === '-p'
  if (v === 'install') return scopeAllows('install')
  if (v === 'shell') return a.length === 2 && restrictedShell(a[1])
  return false
}
if (restricted) {
  if (sub === 'pick' || sub === 'proc-tasks') { needSerial(); refuseRestricted(sub) }
  if (sub === 'tap') { needSerial(); if (!scopeAllows('tap')) refuseRestricted('tap') }
  // The chained tap-home verb is full-access only: no scope class opens it.
  if (sub === 'tap-home') { needSerial(); refuseRestricted('tap-home') }
  // swipe and hold are full-access only as well, even with a tap scope.
  if (sub === 'swipe' || sub === 'hold') { needSerial(); refuseRestricted(sub) }
}

if (sub === 'adb') {
  needSerial()
  if (rest.length === 0) die(2, 'missing -- <adb args>')
  if (restricted && !restrictedAllows(rest)) refuseRestricted(`adb ${JSON.stringify(rest)}`)
  const plainOk = allowedPlain(rest)
  if (!plainOk && !(playground && allowedPlayground(rest))) die(97, `not on the allowlist: adb ${JSON.stringify(rest)}`)
  if (playground && !playgroundPinned(rest)) die(97, `playground: refused (pm clear only of ${PG_PACKAGE} with --own-package ${PG_PACKAGE}; logcat needs -d, -t or -T): adb ${JSON.stringify(rest)}`)
  if (playground) logPlayground(plainOk ? 'r11' : 'extended', rest)
  // Every input-sending call (keyevent of any key, text) stops while a failed locate is unanswered.
  if (rest[0] === 'shell' && /^input /.test(rest[1].trim())) refuseIfLocked(statePath ? loadState() : null)
  // Playground serials need no typing grant: input goes out without a prior locate.
  if (!playground && isTypingCall(rest)) {
    if (!statePath) die(99, 'typing (input text or an edit/submit key) needs --state: it must follow a guarded tap on a located field')
    const s = loadState()
    const g = s.textGrant
    const prev = lastActionLine()
    // The previous action line must be the successful exit of either the granting tap or a typing call of
    // this chain (any other guarded call in between, a refusal included, ends the chain).
    const okPrefix = `exit=0: adb -s ${serial} `
    let prevArgs = null
    if (g && prev.includes(okPrefix)) { try { prevArgs = JSON.parse(prev.slice(prev.indexOf(okPrefix) + okPrefix.length)) } catch { prevArgs = null } }
    const prevIsTap = Array.isArray(prevArgs) && JSON.stringify(prevArgs) === JSON.stringify(['shell', 'input', 'tap', String(g?.x), String(g?.y)])
    const prevOk = g && Array.isArray(prevArgs) && (prevIsTap || (g.chain === true && isTypingCall(prevArgs)))
    if (!g || g.serial !== serial) die(99, 'typing refused: no typing grant; tap a field located in the same step first (`tap` after locate-css or locate-shot)')
    if (!prevOk) die(99, `typing refused: the previous guarded action is not the tap on locate ${g.locate} or its typing chain; locate and tap the field again`)
    const age = (Date.now() - g.time) / 1000
    if (!(age >= 0 && age <= 30)) die(99, `typing refused: the tap on locate ${g.locate} is ${age.toFixed(1)} s old (max 30 s); locate and tap the field again`)
    const isText = /^input text /.test(rest[1].trim().replace(/ +/g, ' '))
    if (isText && g.textUsed) die(99, `typing refused: one input text per tap (locate ${g.locate} already typed into); locate and tap the field again`)
    if (isText) g.textUsed = true
    g.chain = true
    saveState(s)
    const r = runAdb(rest, false)
    if (r.code !== 0) { const s2 = loadState(); s2.textGrant = null; saveState(s2) }
    process.exit(r.code)
  }
  if (rest[0] === 'exec-out') {
    const outFile = opt('--out')
    if (!outFile) die(2, 'exec-out screencap needs --out <png file> (binary output is never piped through the shell)')
    // A capture in progress or failed invalidates the previous one for locate-shot.
    if (statePath) { const s0 = loadState(); s0.lastShot = null; saveState(s0) }
    logLine(`intent: adb -s ${serial} ${JSON.stringify(rest)} > ${JSON.stringify(outFile)}`)
    const r = spawnAdb(['-s', serial, ...rest], { windowsHide: true, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
    let code = r.status ?? 1, note = `${r.stdout?.length ?? 0} bytes`
    const isPng = (b) => b && b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
    if (r.status === 0 && !isPng(r.stdout)) { code = 5; note = `not a PNG (${r.stdout?.length ?? 0} bytes)` }
    else if (r.status === 0) {
      try {
        writeFileSync(outFile, r.stdout)
        if (statePath) { const s = loadState(); s.lastShot = { path: outFile, time: Date.now(), serial }; saveState(s) }
      } catch (e) { code = 5; note = `write failed: ${e.message}` }
    } else if (r.error?.code === 'ETIMEDOUT') note = 'timeout'
    logLine(`exit=${code}: adb -s ${serial} ${JSON.stringify(rest)} (${note})`)
    if (code !== 0) console.error(`adbg: screencap ${note}`)
    process.exit(code)
  }
  process.exit(runAdb(rest, false).code)
}

if (sub === 'pick') {
  needSerial(); needState()
  const name = opt('--name')
  if (!name || !/^[A-Za-z0-9._-]{3,80}$/.test(name)) die(2, 'pick --name must be an exact unique name of 3-80 chars [A-Za-z0-9._-]')
  const s = loadState()
  const logText = existsSync(log) ? readFileSync(log, 'utf8') : ''
  if (s.pickLocked || /^\S+ PICK-LOCK pick /m.test(logText)) die(98, 'an earlier pick in this run had no match; stop and report')
  if ((s.pickErrors ?? 0) >= 2) die(98, 'two pick errors already in this run; stop and report')
  const dump = `/sdcard/adbg-pick-${process.pid}-${Date.now()}.xml`
  const esc = name.replace(/\./g, '\\.')
  const script = `uiautomator dump ${dump} >/dev/null 2>&1; d=$?; `
    + `if [ $d -eq 0 ]; then grep -o 'text="${esc}"[^>]*bounds="\\[[0-9]*,[0-9]*\\]\\[[0-9]*,[0-9]*\\]"' ${dump} 2>/dev/null | head -n 2 | grep -o 'bounds="[^"]*"'; fi; `
    + `rm -f ${dump}; [ -e ${dump} ] && echo ADBG-RM-FAILED; echo ADBG-DUMP=$d`
  logLine(`intent: pick ${JSON.stringify(name)} via one device command (dump, grep, rm ${dump})`)
  const r = spawnAdb(['-s', serial, 'shell', script], { encoding: 'utf8', windowsHide: true, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] })
  const out = r.stdout ?? ''
  const dumpOk = /ADBG-DUMP=0/.test(out)
  const rmFailed = out.includes('ADBG-RM-FAILED')
  // The rm result is known only when the device command ran to its end (it prints ADBG-DUMP last).
  const finished = r.status !== null && /ADBG-DUMP=\d+/.test(out)
  const exitText = r.status ?? (r.error?.code === 'ETIMEDOUT' ? 'timeout' : `signal ${r.signal}`)
  const rmText = !finished ? `unknown (${dump} may remain: tell the parent)` : rmFailed ? 'FAILED: tell the parent' : 'ok'
  logLine(`exit=${exitText}: pick device command; dump=${dumpOk ? 'ok' : 'failed'}; rm=${rmText}`)
  if (r.status !== 0 || !dumpOk || rmFailed) {
    s.pickErrors = (s.pickErrors ?? 0) + 1; saveState(s)
    die(4, `pick error (adb exit ${exitText}, dump ${dumpOk ? 'ok' : 'failed'}, rm ${rmText}); not a no-match`)
  }
  const hits = out.split(/\r?\n/).filter((l) => /^bounds="\[\d+,\d+\]\[\d+,\d+\]"$/.test(l.trim()))
  if (hits.length !== 1) {
    s.pickLocked = true; s.picks.push({ time: now(), name, result: 'no-match' }); saveState(s)
    logLine(`PICK-LOCK pick ${JSON.stringify(name)}: no-match`)
    console.log('no-match')
    process.exit(3)
  }
  const m = hits[0].match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
  const bounds = { l: +m[1], t: +m[2], r: +m[3], b: +m[4] }
  if (bounds.r <= bounds.l || bounds.b <= bounds.t) {
    s.pickErrors = (s.pickErrors ?? 0) + 1; saveState(s)
    die(4, `pick ${JSON.stringify(name)}: zero-area bounds; not a tap target`)
  }
  const id = s.locates.length + 1
  s.picks.push({ time: now(), name, result: 'match', bounds })
  s.locates.push({ id, time: Date.now(), label: `pick:${name}`, bounds, used: false, serial })
  saveState(s)
  logLine(`locate ${id} pick ${JSON.stringify(name)}: match bounds=[${bounds.l},${bounds.t}][${bounds.r},${bounds.b}]`)
  console.log(`match bounds=[${bounds.l},${bounds.t}][${bounds.r},${bounds.b}]`)
  process.exit(0)
}

if (sub === 'proc-tasks') {
  // Per-thread CPU of one process that is ours: the device command itself checks that /proc/<pid>/cmdline is
  // the --own-package process or a WebView sandboxed renderer, then prints only tid, comm, utime and stime.
  needSerial()
  const pid = opt('--pid')
  if (!pid || !/^\d{1,7}$/.test(pid)) die(2, 'proc-tasks needs a numeric --pid')
  if (!ownPackage || !/^[A-Za-z0-9._]+$/.test(ownPackage)) die(2, 'proc-tasks needs --own-package')
  const script = `c=$(tr '\\0' ' ' < /proc/${pid}/cmdline 2>/dev/null); `
    + `case "$c" in "${ownPackage}"|"${ownPackage} "*|com.google.android.webview:sandboxed_process[0-9]*|com.android.webview:sandboxed_process[0-9]*) ;; *) echo ADBG-NOT-OURS; exit 0;; esac; `
    + `echo "ADBG-CMDLINE=$c"; for t in /proc/${pid}/task/[0-9]*; do n=$(cat $t/comm 2>/dev/null); s=$(cat $t/stat 2>/dev/null); s=\${s##*) }; set -- $s; echo "\${t##*/} $n utime=\${12} stime=\${13}"; done; echo ADBG-DONE`
  logLine(`intent: proc-tasks pid ${pid} (own package ${ownPackage} or sandboxed renderer)`)
  const r = spawnAdb(['-s', serial, 'shell', script], { encoding: 'utf8', windowsHide: true, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] })
  const out = r.stdout ?? ''
  const exitText = r.status ?? (r.error?.code === 'ETIMEDOUT' ? 'timeout' : `signal ${r.signal}`)
  if (out.includes('ADBG-NOT-OURS')) { logLine(`exit=${exitText}: proc-tasks pid ${pid}: not ours, nothing read`); die(96, `pid ${pid} is not ${ownPackage} or a WebView sandboxed renderer; nothing was read`) }
  const done = out.includes('ADBG-DONE')
  const lines = out.split(/\r?\n/).filter((l) => /^\d+ .* utime=\d* stime=\d*$/.test(l) || l.startsWith('ADBG-CMDLINE='))
  logLine(`exit=${exitText}: proc-tasks pid ${pid}: ${lines.length} lines${done ? '' : ' (incomplete)'}`)
  console.log(lines.join('\n'))
  const threadLines = lines.filter((l) => !l.startsWith('ADBG-CMDLINE='))
  if (threadLines.length === 0) { console.error('adbg: proc-tasks read no thread line; treat as an error, not as zero CPU'); process.exit(4) }
  process.exit(r.status === 0 && done ? 0 : 4)
}

if (sub === 'offset') {
  needState()
  const x = Number(opt('--x')), y = Number(opt('--y'))
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > 4000 || y > 4000) die(2, 'offset needs integer --x and --y in device pixels')
  const s = loadState(); s.offset = { x, y, time: now() }; saveState(s)
  logLine(`offset x=${x} y=${y}`)
  console.log(`offset x=${x} y=${y}`)
  process.exit(0)
}

if (sub === 'locate-shot') {
  // A box the agent found by pixel analysis of the run's own newest guarded screencap (taken with --state).
  needState()
  const png = opt('--png'), label = opt('--label'), box = opt('--box')
  if (!label || !/^[A-Za-z0-9 ._:-]{1,60}$/.test(label)) die(2, 'locate-shot needs --label naming the control (1-60 chars)')
  const m = (box ?? '').match(/^(\d+),(\d+),(\d+),(\d+)$/)
  if (!m) die(2, 'locate-shot needs --box l,t,r,b in device pixels')
  const s = loadState()
  if (!s.lastShot || s.lastShot.path !== png) die(99, 'locate-shot --png must be the newest screencap this guard wrote with the same --state')
  const age = (Date.now() - s.lastShot.time) / 1000
  if (!(age >= 0 && age <= 10)) die(99, `screencap is ${age.toFixed(1)} s old (max 10 s); capture again`)
  const bounds = { l: +m[1], t: +m[2], r: +m[3], b: +m[4] }
  if (bounds.r <= bounds.l || bounds.b <= bounds.t || bounds.r > 4000 || bounds.b > 4000) die(2, 'locate-shot box has zero area or is off-screen')
  const id = s.locates.length + 1
  // One locate per screencap: a second control needs a fresh capture of the screen after the first tap.
  s.locates.push({ id, time: Date.now(), label: `shot:${label}`, bounds, used: false, serial: s.lastShot.serial })
  s.lastShot = null
  saveState(s)
  logLine(`locate ${id} shot ${JSON.stringify(label)} from ${JSON.stringify(png)} (${age.toFixed(1)} s old): bounds=[${bounds.l},${bounds.t}][${bounds.r},${bounds.b}]`)
  console.log(`shot ${JSON.stringify(label)} bounds=[${bounds.l},${bounds.t}][${bounds.r},${bounds.b}]`)
  process.exit(0)
}

if (sub === 'locate-css') {
  needState()
  const port = opt('--port'), selector = opt('--selector'), text = opt('--text')
  if (!port || !/^\d{2,5}$/.test(port)) die(2, 'locate-css needs a numeric --port')
  if (!ownPort(port)) die(2, `port ${port} is not in --own-ports (locate-css needs --own-ports)`)
  const urlContains = opt('--url-contains')
  if (!urlContains) die(2, 'locate-css needs --url-contains <text of the app page URL> so it cannot read another tab')
  if (!selector) die(2, 'locate-css needs --selector')
  const s = loadState()
  if (s.offset === null) die(2, 'record the WebView screen offset first with `offset`')
  const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))])
  let v
  try {
    const targets = await withTimeout(fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()), 5000, 'CDP target list')
    const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl && String(t.url).includes(urlContains))
    if (pages.length !== 1) die(5, `need exactly one CDP page whose URL contains ${JSON.stringify(urlContains)}, found ${pages.length}`)
    const page = pages[0]
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await withTimeout(new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP socket error')) }), 5000, 'CDP connect')
    const expr = `(() => { const els = [...document.querySelectorAll(${JSON.stringify(selector)})]`
      + `.filter(e => ${text === null ? 'true' : `(e.innerText || e.getAttribute('aria-label') || '').trim() === ${JSON.stringify(text)}`});`
      + ` if (els.length !== 1) return { count: els.length }; const el = els[0]; const r = el.getBoundingClientRect();`
      + ` const cx = r.left + r.width / 2, cy = r.top + r.height / 2;`
      + ` const inView = r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;`
      + ` const hit = document.elementFromPoint(cx, cy); const onTop = hit !== null && (hit === el || el.contains(hit));`
      + ` return { count: 1, x: r.left, y: r.top, w: r.width, h: r.height, dpr: devicePixelRatio, inView, onTop } })()`
    const reply = await withTimeout(new Promise((res) => {
      ws.onmessage = (ev) => { const msg = JSON.parse(ev.data); if (msg.id === 1) res(msg) }
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }))
    }), 5000, 'CDP evaluate')
    ws.close()
    v = reply.result?.result?.value
  } catch (e) { die(5, `locate-css failed: ${e.message}`) }
  if (!v || v.count !== 1) die(6, `locate-css ${JSON.stringify(selector)}: ${v ? v.count : 'no'} matching elements (need exactly 1)`)
  if (!v.inView) die(6, `locate-css ${JSON.stringify(selector)}: element not fully inside the viewport`)
  if (!v.onTop) die(6, `locate-css ${JSON.stringify(selector)}: another element covers its centre`)
  const bounds = { l: Math.round(s.offset.x + v.x * v.dpr), t: Math.round(s.offset.y + v.y * v.dpr), r: Math.round(s.offset.x + (v.x + v.w) * v.dpr), b: Math.round(s.offset.y + (v.y + v.h) * v.dpr) }
  if (bounds.r <= bounds.l || bounds.b <= bounds.t) die(6, `locate-css ${JSON.stringify(selector)}: zero-area bounds`)
  const id = s.locates.length + 1
  s.locates.push({ id, time: Date.now(), label: `css:${selector}${text === null ? '' : ` text=${text}`}`, bounds, used: false, serial: serial ?? undefined })
  saveState(s)
  logLine(`locate ${id} css ${JSON.stringify(selector)}${text === null ? '' : ` text=${JSON.stringify(text)}`}: bounds=[${bounds.l},${bounds.t}][${bounds.r},${bounds.b}]`)
  console.log(`${JSON.stringify(selector)} bounds=[${bounds.l},${bounds.t}][${bounds.r},${bounds.b}]`)
  process.exit(0)
}

if (sub === 'tap' || sub === 'tap-home' || sub === 'swipe' || sub === 'hold') {
  needSerial(); needState()
  const chained = sub === 'tap-home'
  const gesture = sub === 'swipe' || sub === 'hold'
  if (playground) logLine(`PLAYGROUND serial=${serial} allow=r11 verb=${sub}`)
  const s = loadState()
  refuseIfLocked(s)
  const delayRaw = opt('--delay-ms')
  if (chained && !(delayRaw !== null && /^\d{1,3}$/.test(delayRaw) && +delayRaw <= 500)) die(2, 'tap-home needs --delay-ms as an integer from 0 to 500')
  const delayMs = chained ? +delayRaw : 0
  // swipe and hold: the duration is required; the end point of a swipe is one of two exclusive forms.
  const durRaw = opt('--duration-ms')
  const durMin = sub === 'hold' ? 100 : 50
  if (gesture && !(durRaw !== null && /^\d{1,4}$/.test(durRaw) && +durRaw >= durMin && +durRaw <= 5000)) die(2, `${sub} needs --duration-ms as an integer from ${durMin} to 5000`)
  const durationMs = gesture ? +durRaw : 0
  const INT = /^-?\d{1,5}$/
  const offsetForm = opt('--dx') !== null || opt('--dy') !== null
  const toForm = opt('--to-x') !== null || opt('--to-y') !== null
  if (sub === 'swipe') {
    if (offsetForm === toForm) die(2, 'swipe needs either --dx and --dy, or --to-x and --to-y')
    const names = offsetForm ? ['--dx', '--dy'] : ['--to-x', '--to-y']
    if (!names.every((n) => INT.test(opt(n) ?? ''))) die(2, `swipe ${names.join(' and ')} must be integers in pixels`)
  } else if (gesture && (offsetForm || toForm || opt('--x') !== null || opt('--y') !== null)) die(2, 'hold takes no end point or point option; it presses the centre of the locate')
  if (gesture && sub === 'swipe' && (opt('--x') !== null || opt('--y') !== null)) die(2, 'swipe starts at the centre of the locate; --x and --y are not accepted')
  if (gesture && (!ownPackage || !/^[A-Za-z0-9._]+$/.test(ownPackage))) die(2, `${sub} needs --own-package for the foreground check`)
  const maxAgeRaw = opt('--max-age')
  const maxAge = maxAgeRaw === null ? 5 : Number(maxAgeRaw)
  if (!Number.isFinite(maxAge) || maxAge < 1 || maxAge > 10) die(2, '--max-age must be a number from 1 to 10 seconds')
  const loc = s.locates[s.locates.length - 1]
  if (!loc) die(99, 'no locate record; run pick or locate-css first')
  if (loc.used) die(99, `locate record ${loc.id} (${loc.label}) was already used; locate again`)
  if (loc.serial && loc.serial !== serial) die(99, `locate record ${loc.id} was read on ${loc.serial}, not ${serial}`)
  const age = (Date.now() - loc.time) / 1000
  if (!(age >= 0 && age <= maxAge)) die(99, `locate record ${loc.id} is ${age.toFixed(1)} s old (max ${maxAge} s); locate again`)
  const b = loc.bounds
  if (b.r <= b.l || b.b <= b.t) die(99, `locate record ${loc.id} has zero-area bounds`)
  let x = Math.floor((b.l + b.r) / 2), y = Math.floor((b.t + b.b) / 2)
  if (opt('--x') !== null || opt('--y') !== null) {
    x = Number(opt('--x')); y = Number(opt('--y'))
    if (!(Number.isInteger(x) && Number.isInteger(y) && x >= b.l && x < b.r && y >= b.t && y < b.b)) die(99, `point ${x},${y} is not strictly inside locate record ${loc.id}`)
  }
  if (gesture) {
    // The screen size a locate may record bounds the gesture; without one the fixed bound is 3000 px.
    const sw = Number.isInteger(loc.screen?.w) && loc.screen.w > 0 ? loc.screen.w : 3000
    const sh = Number.isInteger(loc.screen?.h) && loc.screen.h > 0 ? loc.screen.h : 3000
    let x2 = x, y2 = y
    if (sub === 'swipe' && offsetForm) {
      const dx = Number(opt('--dx')), dy = Number(opt('--dy'))
      if (Math.abs(dx) > sw || Math.abs(dy) > sh) die(2, `swipe offset ${dx},${dy} is larger than the screen (${sw}x${sh})`)
      x2 = x + dx; y2 = y + dy
    } else if (sub === 'swipe') {
      x2 = Number(opt('--to-x')); y2 = Number(opt('--to-y'))
      if (x2 < 0 || y2 < 0 || x2 > sw || y2 > sh) die(2, `swipe end ${x2},${y2} is outside the screen (${sw}x${sh})`)
    }
    // Read-only foreground check through allowlisted commands: our package must hold the top oom_score_adj (0).
    // It runs before the locate is consumed, so a refusal leaves the locate usable until it ages out.
    const front = () => {
      const ps = runAdb(['shell', `pidof ${ownPackage}`], true)
      const pids = ps.code === 0 ? ps.out.trim().split(/\s+/).filter((p) => /^\d{1,7}$/.test(p)) : []
      return pids.some((p) => { const adj = runAdb(['shell', `cat /proc/${p}/oom_score_adj`], true); return adj.code === 0 && adj.out.trim() === '0' })
    }
    if (!front()) die(93, `${sub} refused: ${ownPackage} is not the foreground package`)
    loc.used = true; s.lastShot = null; s.textGrant = null; saveState(s)
    logLine(sub === 'swipe'
      ? `swipe uses locate ${loc.id} (${JSON.stringify(loc.label)}, ${age.toFixed(1)} s old, max-age ${maxAge}) from ${x},${y} to ${x2},${y2} over ${durationMs} ms`
      : `hold uses locate ${loc.id} (${JSON.stringify(loc.label)}, ${age.toFixed(1)} s old, max-age ${maxAge}) at ${x},${y} for ${durationMs} ms`)
    process.exit(runAdb(['shell', 'input', 'swipe', String(x), String(y), String(x2), String(y2), String(durationMs)], false).code)
  }
  loc.used = true; s.lastShot = null; s.textGrant = null; saveState(s)
  logLine(`tap uses locate ${loc.id} (${JSON.stringify(loc.label)}, ${age.toFixed(1)} s old, max-age ${maxAge}) at ${x},${y}${chained ? ` (tap-home, delay ${delayMs} ms)` : ''}`)
  const tapStart = Date.now()
  const tapCode = runAdb(['shell', 'input', 'tap', String(x), String(y)], false).code
  const tapEnd = Date.now()
  // A successful tap grants one typing chain into the field it hit (see isTypingCall). tap-home never
  // grants one: its tap is followed by HOME, so nothing may type after it.
  if (tapCode === 0 && !chained) { const s2 = loadState(); s2.textGrant = { locate: loc.id, x, y, time: Date.now(), serial, textUsed: false, chain: false }; saveState(s2) }
  if (!chained || tapCode !== 0) process.exit(tapCode)
  // The one fixed chained step: HOME after the given delay. No argument can change the keycode.
  if (delayMs > 0) await new Promise((res) => setTimeout(res, delayMs))
  const homeStart = Date.now()
  const homeCode = runAdb(['shell', 'input', 'keyevent', 'KEYCODE_HOME'], false).code
  const homeEnd = Date.now()
  logLine(`tap-home timing: tap ${tapStart}-${tapEnd} ms, home ${homeStart}-${homeEnd} ms (epoch), tap-to-home gap ${homeStart - tapEnd} ms after tap end, ${homeStart - tapStart} ms after tap start, delay ${delayMs} ms`)
  process.exit(homeCode)
}
