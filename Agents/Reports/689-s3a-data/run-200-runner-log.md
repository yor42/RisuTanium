# S3a device run 1 (ticket #689, S3a worker embedding spike), phone 29f3cde9193f7ece

Request s3a-689-r8. Synthetic data only. Token not printed or written anywhere.
Run folder: C:\Users\yor42\AppData\Local\Temp\s3a-run1
Brief: the s3a-device-7 brief (scratchpad), including the revisions after runs 3, 4 and 5.

## Summary

- Rows run: 6b e5-b8, 6b e5-b1, 6c multi-b8, 6d mini-b8 (count 200 each). All four drivers exited 0 with constructError null, rendererLost false, pageSessionStable true, workerErrors empty, errors empty.
- Row not run: 6a mini-smoke (skipped by the revision after run 5, which says mini-smoke already passed).
- Not done by design: install (skipped by the revision after run 3, APK already installed), screenshot (skipped by the same revision), any reset, uninstall, pm clear.
- Lease: granted, reset acknowledged with census-start.md (resetRequired false afterwards), heartbeat every ~45 s, released with --clean census-end.md (status released, needsReset false).
- Incidents: none that stopped a row. Notes listed in section 6.

## 1. Lease and census

- lease-renew --request s3a-689-r8: status granted (expiresAt 2026-11-23T09:53:47Z at first renew).
- lease-status (before renew, read-only): the note9 pool showed device:29f3cde9193f7ece busy, holder "689-orchestrator", ticket 689, needsReset true, reason released-unchecked. lease-renew with the grant token still returned granted. Recorded as observed, not interpreted.
- Census start (census-start.md): `adbg --serial 29f3cde9193f7ece ... -- shell pm list packages -3`, exit 0, raw 22, listed 22, COMPLETE. All 22 in standingPackages (20 of them also in strandedPackages; io.github.yor42.tbdriver and io.github.yor42.risutanium standing only). No dev.risu.* package. Action: none.
- `reverse --list` at start: exit 0, empty output.
- lease-reset-done --evidence census-start.md: resetRequired false.

## 2. Pre-run setup

- `adbg net-status --serial 29f3cde9193f7ece --log ...\adb-commands.log`: exit 0, output `wifi_enabled=off associated=no validated=no`.
- `adbg ... -- shell cmd package resolve-activity --brief io.github.yor42.risutanium`: exit 0, output `priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false` and `io.github.yor42.risutanium/.MainActivity`.
- `adbg ... -- shell am start -n io.github.yor42.risutanium/.MainActivity`: exit 0, output `Starting: Intent { cmp=io.github.yor42.risutanium/.MainActivity }`. Waited 25 s.
- `adbg ... -- shell ps -A | grep io.github.yor42.risutanium` (sent as the arguments shell, ps, -A, |, grep, package): exit 0, output one line, app pid 12697 (user u0_a460).
- Server: `serve.mjs C:\Users\yor42\AppData\Local\Temp\s3a-serve 6272 C:\Users\yor42\AppData\Local\Temp\s3a-run1\serve.log` as a background job. Listener on 6272 owned by PID 63176 (node), recorded in pids.txt. Before the first phone fetch: HEAD http://127.0.0.1:6272/transformers.js = 200; GET /probe.js = 200 and contains `s3a-2`.
- `adbg ... -- reverse tcp:6272 tcp:6272`: exit 0, output 6272.
- `adbg ... -- forward tcp:6271 localabstract:webview_devtools_remote_12697`: exit 0, output 6271.
- CDP check: `node C:\Projects\RisuAI\Agents\Tools\device\cdp.mjs 6271 -e "location.href + ' ' + document.readyState + ' ' + document.visibilityState"`, exit 0, output `"http://tauri.localhost/ complete visible"`. One page result returned. Visibility check passed without the screen-wake sequence.
- Thermal: `adbg ... -- shell dumpsys battery`, exit 0 (allowed through by the guard). Temperature 314 (31.4 C), below 400. Read once before run e5-b1. No wait needed.

## 3. Runs (driver: run-spike.mjs --port 6271 --base http://127.0.0.1:6272 --pooling mean --count 200 --idle-seconds 20 --out ...)

Memory: renderer = sandbox process column of pss-sampler (KiB, converted to MiB, 1024 base). Baseline = median of samples before driver startedAt; peak = max of samples between startedAt and finishedAt; difference = peak minus baseline. Sampler: `pwsh -NoProfile -File pss-sampler.ps1 -Serial 29f3cde9193f7ece -LogPath ...\pss-<tag>.log -GuardLog ...\adb-commands.log -SleepMs 1000 -MaxSeconds 1800`. Zero dropped sandbox rows in any run.

### 3.1 e5-b8: Xenova/multilingual-e5-small, batch 8, count 200
- Command: `node ...\Agents\Tools\ltm-embed-spike\run-spike.mjs --port 6271 --base http://127.0.0.1:6272 --model Xenova/multilingual-e5-small --pooling mean --count 200 --batch 8 --out C:\Users\yor42\AppData\Local\Temp\s3a-run1\e5-b8.json --idle-seconds 20`
- Driver exit 0. Result file: s3a-run1\e5-b8.json. startedAt 2026-11-23T09:26:39.804Z, finishedAt 2026-11-23T09:29:11.179Z.
- constructError null; rendererLost false; pageSessionStable true (one session id); loadMs 9777; dims [1,384].
- index: requested 200, done 200, batchSize 8, totalMs 118873, msgsPerSec 1.68, error null; callMs n 25, p50 4799, p90 5358.9, p99 5969.1, max 5969.1.
- phases: idle-baseline longtask count 1, totalMs 291, maxMs 291, over50 1; rafMaxGapMs 51.3; intervalMaxLatenessMs 6.7. load longtask 0; rafMaxGapMs 40.4; intervalMaxLatenessMs 4.2. index longtask 0; rafMaxGapMs 43.7; intervalMaxLatenessMs 10.3.
- workerAlive true; workerErrors []; errors [].
- Renderer: baseline 112.6 MiB (median 115343 KiB, 18 samples); peak 970.0 MiB (993239 KiB, 93 samples); difference 857.3 MiB.
- meminfo end (e5-b8-end): app totalPssKb 194752; sandbox totalPssKb 124947.

### 3.2 e5-b1: Xenova/multilingual-e5-small, batch 1, count 200
- Command: as 3.1 with `--batch 1 --out ...\e5-b1.json`.
- Driver exit 0. Result file: s3a-run1\e5-b1.json. startedAt 2026-11-23T09:30:29.306Z, finishedAt 2026-11-23T09:32:35.397Z.
- constructError null; rendererLost false; pageSessionStable true; loadMs 9598; dims [1,384].
- index: requested 200, done 200, batchSize 1, totalMs 92960, msgsPerSec 2.15, error null; callMs n 200, p50 445.8, p90 639.7, p99 807.1, max 841.
- phases: idle-baseline longtask count 1, totalMs 291, maxMs 291, over50 1; rafMaxGapMs 48.1; intervalMaxLatenessMs 14.6. load longtask 0; rafMaxGapMs 40.4; intervalMaxLatenessMs 3.9. index longtask 0; rafMaxGapMs 43.3; intervalMaxLatenessMs 16.9.
- workerErrors []; errors [].
- Renderer: baseline 111.9 MiB (median 114567 KiB, 21 samples); peak 974.6 MiB (998039 KiB, 77 samples); difference 862.8 MiB.
- meminfo end (e5-b1-end): app totalPssKb 193904; sandbox totalPssKb 116867.

### 3.3 multi-b8: Xenova/paraphrase-multilingual-MiniLM-L12-v2, batch 8, count 200
- Command: as 3.1 with `--model Xenova/paraphrase-multilingual-MiniLM-L12-v2 --batch 8 --out ...\multi-b8.json`.
- Driver exit 0. Result file: s3a-run1\multi-b8.json. startedAt 2026-11-23T09:33:39.834Z, finishedAt 2026-11-23T09:36:12.994Z.
- constructError null; rendererLost false; pageSessionStable true; loadMs 9549; dims [1,384].
- index: requested 200, done 200, batchSize 8, totalMs 120352, msgsPerSec 1.66, error null; callMs n 25, p50 4950.8, p90 5241.7, p99 5932.8, max 5932.8.
- phases: idle-baseline longtask count 1, totalMs 291, maxMs 291, over50 1; rafMaxGapMs 50.8; intervalMaxLatenessMs 9.8. load longtask 0; rafMaxGapMs 64.9; intervalMaxLatenessMs 4.6. index longtask 0; rafMaxGapMs 43.9; intervalMaxLatenessMs 15.1.
- workerErrors []; errors [].
- Renderer: baseline 113.3 MiB (median 116003 KiB, 19 samples); peak 949.4 MiB (972203 KiB, 93 samples); difference 836.1 MiB.
- meminfo end (multi-b8-end): app totalPssKb 194715; sandbox totalPssKb 117270.

### 3.4 mini-b8: Xenova/all-MiniLM-L6-v2, batch 8, count 200
- Command: as 3.1 with `--model Xenova/all-MiniLM-L6-v2 --batch 8 --out ...\mini-b8.json`.
- Driver exit 0. Result file: s3a-run1\mini-b8.json. startedAt 2026-11-23T09:37:12.895Z, finishedAt 2026-11-23T09:40:11.411Z.
- constructError null; rendererLost false; pageSessionStable true; loadMs 4503; dims [1,384].
- index: requested 200, done 200, batchSize 8, totalMs 151050, msgsPerSec 1.32, error null; callMs n 25, p50 6433.9, p90 7084.8, p99 7394.5, max 7394.5.
- phases: idle-baseline longtask count 1, totalMs 291, maxMs 291, over50 1; rafMaxGapMs 48.6; intervalMaxLatenessMs 6.4. load longtask 0; rafMaxGapMs 36.3; intervalMaxLatenessMs 4.6. index longtask 0; rafMaxGapMs 76.8; intervalMaxLatenessMs 37.2.
- workerErrors []; errors [].
- Renderer: baseline 113.6 MiB (median 116358 KiB, 18 samples); peak 569.2 MiB (582882 KiB, 109 samples); difference 455.6 MiB.
- meminfo end (mini-b8-end): app totalPssKb 197448; sandbox totalPssKb 117235.

## 4. Teardown

- Sampler stopped by stop file after each run (pss-e5-b8.log, pss-e5-b1.log, pss-multi-b8.log, pss-mini-b8.log); all exited 0.
- Server PID 63176 stopped by Stop-Process on that recorded PID (the background job reports exit 255 for that reason). Listener on 6272 gone afterwards.
- `adbg ... -- forward --remove tcp:6271`: exit 0.
- `adbg ... -- reverse --remove tcp:6272`: exit 0.
- `adbg ... -- reverse --list`: exit 0, empty.
- `adbg net-status`: exit 0, `wifi_enabled=off associated=no validated=no`.
- End census (census-end.md): `shell pm list packages -3`, exit 0, raw 22, listed 22, COMPLETE, same set as start, all standing. Clean.
- `adbg ... -- shell am force-stop io.github.yor42.risutanium`: exit 0.
- `adbg ... -- shell svc power stayon false`: exit 0 (the brief expected a possible refusal; none occurred). `shell svc power stayon true` was not sent by this run (the brief said it was already set).
- Lease released with --clean census-end.md: status released, needsReset false.
- No pm clear, no uninstall, no install, no tap, no URL opened on the phone, no logcat, no dumpsys wifi.

## 5. Not run

- 6a mini-smoke: not run, skipped by the revision after run 5 (already passed in an earlier run).
- install: not run, skipped by the revision after run 3 (pinned APK already installed). Signer not re-read this run.
- screenshot: not taken, skipped by the revision after run 3.

## 6. Notes and deviations (observations)

1. One guard call with no `--` arguments was sent by mistake (`adbg --serial ... --log ... --own-ports ... --own-package ... --` with nothing after). The guard refused it: log line `REFUSED/ERROR exit=2: "missing -- <adb args>"` at 2026-11-23T09:25:23.898Z. No adb call was sent for it.
2. The memory sampler was first started as a hidden Start-Process. I stopped it at once with its stop file, removed its own log and pid file, and restarted it as a background job. It collected no data that was used.
3. The sampler and meminfo-snapshot tools make their own guard calls, which the brief's section 2 list does not name: `shell dumpsys meminfo -s <pid>` (489 each for the two pids sampled), `shell dumpsys meminfo --package io.github.yor42.risutanium` (56), `shell pgrep -f sandboxed_process` (52), `shell pidof io.github.yor42.risutanium` (56), `shell dumpsys activity processes` (4). The guard log tags these as PLAYGROUND allow=extended and it allowed all of them; none was refused. Their forms are recorded in the guard log at C:\Users\yor42\AppData\Local\Temp\s3a-run1\adb-commands.log. The PR session should decide whether these tool forms are covered by the row list.
4. Guard log also shows `shell dumpsys connectivity` and `shell settings get global wifi_on` (net-status; output reduced on the host) and `start-server` entries (guard adb start). Not sent by me directly.
5. Sampler pid for the app's sandbox changed between runs (12697 app pid; sandbox pids 12755 and 12697 seen in the log). Recorded as seen.
6. Lease: lease-status before renewal showed the device busy with holder 689-orchestrator; the renew with the grant token returned granted. Recorded as observed.
7. Renderer peak for mini-b8 (569.2 MiB) is well below the three e5/multi runs (949 to 975 MiB). Recorded as observed; not interpreted.
8. Battery temperature was read once (314, 31.4 C) before e5-b1 only.
9. The 1.5 GB bar in the driver output (rendererPeakWithin1p5GB) is null in every run; no value to report.
