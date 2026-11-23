# S3a device run 8 (ticket #689, grant s3a-689-r9), phone 29f3cde9193f7ece (Note 9, synthetic data)

Summary: one driver run only (e5-b1-1000, per the "after run 6" revision) completed with driver exit 0, result file present, no constructError, no errors, no rendererLost, pageSessionStable true, workerErrors empty. Census clean at start and end. Wi-Fi off at start and end. Reverse list empty at start and end. Lease released with --clean (see row L-REL). Token not printed or written anywhere.

Commands are shown with the lease token replaced by <token>. Guard calls are shown as `adbg` + args; the full form is `node C:\Projects\RisuAI\Agents\Tools\device-guard\adbg.mjs --serial 29f3cde9193f7ece --log C:\Users\yor42\AppData\Local\Temp\s3a-run1\adb-commands.log --own-ports 6271,6272 --own-package io.github.yor42.risutanium --`.

## Rows that ran, in order

### L-REN (lease renew, repeated before every step and by a background loop every 45 s)
- Command: `node C:\Projects\RisuAI\.claude\scripts\workflow-control.mjs lease-renew --request s3a-689-r9 --token <token>`
- Output: `status: granted`, expiresAt advanced on each call (first 2026-11-23T10:13:01.834Z, later 10:13:29.335Z).
- Observation: renew never refused during the run.

### L-STAT (lease status, read-only)
- Command: `node ...workflow-control.mjs lease-status --request s3a-689-r9`
- Output: pool view only; device:29f3cde9193f7ece shown busy with holder `689-orchestrator`, needsReset false, reason released-unchecked. The request id is not printed and resetRequired is not shown. Renew output also does not show resetRequired.
- Observation: the status view does not show this request's holder; the renew result said granted for s3a-689-r9. Not interpreted further.

### C-START (census at grant start, section 8)
- Command: `adbg ... -- shell pm list packages -3`
- Exit 0. Raw 23 lines, listed 23, COMPLETE.
- Packages: the 21 standing+stranded packages, io.github.yor42.risutanium, io.github.yor42.tbdriver. No dev.risu.* package. Nothing uninstalled, nothing marked stranded.
- Written to `C:\Users\yor42\AppData\Local\Temp\s3a-run1\census-start.md`.

### L-RST (lease-reset-done)
- Command: `lease-reset-done --request s3a-689-r9 --token <token> --evidence C:\Users\yor42\AppData\Local\Temp\s3a-run1\census-start.md`
- Output: `resetRequired: false`, stranded list returned (21 packages, unchanged).

### N-NET0 (Wi-Fi at start)
- Command: `node ...adbg.mjs net-status --serial 29f3cde9193f7ece --log ...\adb-commands.log`
- Output: `wifi_enabled=off associated=no validated=no`, exit 0.

### R-LIST0 (reverse list at start)
- Command: `adbg ... -- reverse --list`
- Output: empty, exit 0.

### R-RES (resolve launch activity)
- Command: `adbg ... -- shell cmd package resolve-activity --brief io.github.yor42.risutanium`
- Output: `io.github.yor42.risutanium/.MainActivity`, exit 0.

### SP-ON (stay-on power, set before the run)
- Command: `adbg ... -- shell svc power stayon true`, exit 0, no output.

### AM-1 (launch)
- Command: `adbg ... -- shell am start -n io.github.yor42.risutanium/.MainActivity`
- Output: `Starting: Intent { cmp=io.github.yor42.risutanium/.MainActivity }`, exit 0. Then a 25 s background wait.

### SRV (own static server, port 6272)
- Command: `node C:\Projects\RisuAI\.claude\worktrees\689-ltm-embed-spike-0a21d2\Agents\Tools\ltm-embed-spike\serve.mjs C:\Users\yor42\AppData\Local\Temp\s3a-serve 6272 C:\Users\yor42\AppData\Local\Temp\s3a-run1\serve.log` (background).
- Listener on 127.0.0.1:6272 owned by node PID 61256; command line confirmed as this serve.mjs. Recorded in `pids.txt`.
- Check: `Invoke-WebRequest -Method Head http://127.0.0.1:6272/transformers.js` status 200, Content-Length 2253735. GET /probe.js contains `s3a-2`: True.

### R-ADD (reverse for model files)
- Command: `adbg ... -- reverse tcp:6272 tcp:6272`, output `6272`, exit 0.

### PS-APP (app pid)
- Command: `adbg ... -- shell "ps -A | grep io.github.yor42.risutanium"`
- Output: one line, pid 18824 (`u0_a460 18824 729 ... io.github.yor42.risutanium`), exit 0.

### F-CDP (CDP forward and check)
- Command: `adbg ... -- forward tcp:6271 localabstract:webview_devtools_remote_18824`, output `6271`, exit 0.
- Command: `node C:\Projects\RisuAI\Agents\Tools\device\cdp.mjs 6271 -e "location.href + ' ' + document.readyState + ' ' + document.visibilityState"`
- Output: `"http://tauri.localhost/ complete visible"`, exit 0. Visibility visible, so the wake sequence was not needed. One page target reported.

### BAT-0 (battery before the run)
- Command: `adbg ... -- shell dumpsys battery`, exit 0. temperature: 339 (0.1 C), level 100.

### SAMP (memory sampler, background)
- Command: `pwsh -NoProfile -File C:\Projects\RisuAI\Agents\Tools\device\pss-sampler.ps1 -Serial 29f3cde9193f7ece -LogPath C:\Users\yor42\AppData\Local\Temp\s3a-run1\pss-e5-b1-1000.log -GuardLog C:\Users\yor42\AppData\Local\Temp\s3a-run1\adb-commands.log -SleepMs 1000 -MaxSeconds 2700`
- Started about 22 s before the driver. Stopped by the stop file `pss-e5-b1-1000.log.stop`; exit 0. 338 log lines, 0 drop rows.

### RUN e5-b1-1000 (the only driver run)
- Command: `node C:\Projects\RisuAI\.claude\worktrees\689-ltm-embed-spike-0a21d2\Agents\Tools\ltm-embed-spike\run-spike.mjs --port 6271 --base http://127.0.0.1:6272 --model Xenova/multilingual-e5-small --pooling mean --count 1000 --batch 1 --out C:\Users\yor42\AppData\Local\Temp\s3a-run1\e5-b1-1000.json --idle-seconds 20 --index-timeout-s 2400`
- Driver exit 0. Result file: `C:\Users\yor42\AppData\Local\Temp\s3a-run1\e5-b1-1000.json`.
- Driver window: startedAt 2026-11-23T09:45:15.106Z, finishedAt 09:53:55.211Z.
- From the JSON (copied, no interpretation):
  - config: dtype q8, seed 1, count 1000, batch 1, idleSeconds 20, loadTimeoutMs 300000, indexTimeoutMs 2400000.
  - constructError null; errors []; rendererLost false; lostReason null; pageSessionStable true; workerErrors []; cspHint null.
  - loadMs 9812; dims [1, 384].
  - index: requested 1000, done 1000, totalMs 486710, msgsPerSec 2.05, error null; callMs n 1000, p50 466, p90 637.5, p99 759.8, max 847.4.
  - phases:
    - idle-baseline: durationMs 20260; longtask count 1, totalMs 273, maxMs 273, over50 1; rafMaxGapMs 42.8; intervalMaxLatenessMs 5.4; intervalOver50 0.
    - load: durationMs 10768; longtask count 0; rafMaxGapMs 51.1; intervalMaxLatenessMs 6.5; intervalOver50 0.
    - index: durationMs 488752; longtask count 0; rafMaxGapMs 112.6; rafGapsOver100 1; intervalMaxLatenessMs 77.8; intervalOver50 1.
  - bars: longtasksOver50DuringLoadAndIndex 0; longtasksOver50IdleBaseline 1; indexAtLeast1PerSec true; noRendererLoss true; rendererPeakWithin1p5GB null (driver field, not filled).
  - checksums (first three) [-0.0718, -0.0584, -0.097].
- Renderer memory (sampler sandbox KiB column; MiB = KiB / 1024):
  - baseline: median of 16 samples before driver start = 114094 KiB = 111.4 MiB.
  - peak during driver window: 1004540 KiB = 981.0 MiB, at +32.7 s into the window (the index phase starts around +30 s, from the phase durations).
  - difference peak minus baseline: 890446 KiB = 869.6 MiB.
  - sandbox KiB at marks of the driver window (sample nearest to each mark):
    - 25% (+~122 s): 637868 KiB = 622.9 MiB
    - 50% (+~244 s): 588696 KiB = 574.9 MiB
    - 75% (+~366 s): 592664 KiB = 578.8 MiB
    - 100% (end): 595558 KiB = 581.6 MiB
  - minimum sandbox value inside the driver window: 117916 KiB (the window start, before the model was loaded in the sandbox).
  - App process KiB column was also sampled; not separately reported here.
- End meminfo snapshot: `pwsh -NoProfile -File C:\Projects\RisuAI\Agents\Tools\device\meminfo-snapshot.ps1 -Serial 29f3cde9193f7ece -Label e5-b1-1000-end -GuardLog C:\Users\yor42\AppData\Local\Temp\s3a-run1\adb-commands.log -Package io.github.yor42.risutanium`, exit 0, complete true. app totalPssKb 197121; sandbox totalPssKb 117186 (glMtrack rows absent for sandbox, listed in missing).

### BAT-1 (battery after the run)
- Command: `adbg ... -- shell dumpsys battery`, exit 0. temperature 358 (35.8 C), level 100. Below the 400 threshold; no wait was needed.

### Teardown
- Lease renew loop stopped by stop file `renew.stop` (loop exited normally, exit 0).
- Server: `Stop-Process -Id 61256` after a check that the command line is this serve.mjs. The background task reported exit code 255 on kill; that is the kill signal, not a server error.
- `adbg ... -- forward --remove tcp:6271`, exit 0.
- `adbg ... -- reverse --remove tcp:6272`, exit 0.
- `adbg ... -- reverse --list`, exit 0, empty.
- `adbg ... -- shell am force-stop io.github.yor42.risutanium`, exit 0.
- `adbg ... -- shell svc power stayon false`, exit 0. (The brief expected a possible refusal; it was accepted.)
- `net-status` again: `wifi_enabled=off associated=no validated=no`, exit 0.
- End census: `adbg ... -- shell pm list packages -3`, exit 0, raw 23, listed 23, COMPLETE, same set as the start. Written to `C:\Users\yor42\AppData\Local\Temp\s3a-run1\census-end.md`. Clean.
- `pm clear`: not run.

### L-REL (lease release)
- Command: `node ...workflow-control.mjs lease-release --request s3a-689-r9 --token <token> --clean C:\Users\yor42\AppData\Local\Temp\s3a-run1\census-end.md`
- Output: `status: released`, needsReset false, exit 0 (see Release result).

## Rows that did not run, and why
- Install of the pinned APK: not run. The brief's revision after run 3 says the pinned build is already installed and to skip install. No install, no uninstall, no MC-3874 path.
- Screenshot (screencap): not run; the revision after run 3 says to skip it.
- Hash read-back: not run (the brief says the hash read-back forms are not allowed).
- mini-smoke (all-MiniLM-L6-v2, count 40): not run; the revision after run 5 says it already passed.
- e5-b8 (multilingual-e5-small, B=8): not run; only one run in the revision after run 6.
- e5-b1 (count 200): not run; only one run in the revision after run 6.
- multi-b8 (paraphrase-multilingual-MiniLM-L12-v2): not run; same reason.
- mini-b8 (all-MiniLM-L6-v2, count 200): not run; same reason.
- `logcat`, `dumpsys wifi`, `cat /proc/meminfo`: not sent.
- No taps, swipes, URLs opened on the phone, `pm clear`, factory reset or other package touched.

## Observations to note
- Run folder contained two adb temp directories (`adb-14116`, `adb-27712`) created during the run by the sampler/meminfo helper path; not inspected further.
- The `serve.log` file is in the run folder; not read.
- The `renew.stop` and `pss-e5-b1-1000.log.stop` stop files are in the run folder.
- Guard calls: none refused (no exit 89, 92, 93, 95, 97 or 99 seen).

## Release result
- Output: `status: released`, member device:29f3cde9193f7ece, needsReset false, exit 0. Released with --clean census-end.md (clean end census).
