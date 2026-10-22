# CHORE-202 rerun plan: why the Note 9 import copy stalls with the screen off

Lane C, 2026-10-22. This is a plan, not a run and not code. Lane A runs it on a phone. Status: checked by doc-verifier 2026-10-22, PASS WITH CORRECTIONS; corrections applied; re-check PASS. The data-ceiling exception is approved (`MC-430`, lane C records).

Evidence labels: VERIFIED = read in the cited file. INFERRED = reasoning. [X] = Android or Chromium behaviour not in the repository or the crate registry (unverified). The two evidence packets (`tooling.md`, `mechanism.md`) are AI-authored and not independently verified. This plan does not raise their confidence.

## 1. Question and what is already known

**Question:** why does the asset copy of a `.bin` import stop making progress after the screen turns off, and what separates the candidate causes?

Known (run b1, one run; b2 repeated the stall but has no power or disk data):

- The stall is not "screen off, so immediately slow". The copy started at 20:57:37 (first disk writes; "database decoded" 11:57:36Z). `KEYCODE_SLEEP` came at 20:57:42. The copy ran at full disk rate for about 61 s after it. At 5 s resolution the writes fell at 20:58:41 to 47, about 66 s after the copy started (tooling.md Q3, VERIFIED by its execution of `ths.log`).
- Then everything went idle. Almost all threads were in state S and none in D. App CPU was 3% and renderer CPU 2%. Disk wrote 0.03 to 0.04 MiB/s. Nothing was runnable or blocked on I/O.
- The Tauri `getDataDir` bridge calls in logcat (one per command) stopped at 20:58:43.1 and returned only after the wake at 21:07:44 (tooling.md Q3).
- The page answered every CDP poll while hidden (latency 2 to 309 ms, `verify.md`). So the renderer main thread was alive and not frozen as a whole. Full speed returned within 3 s of the wake.
- Timer throttling as the mechanism is withdrawn: the loop yields through `yieldToEventLoop` (`scheduler.yield()`, then `MessageChannel`, `setTimeout(0)` last; `saveYield.ts`). Source: `report.md` "Corrections from doc-verifier", item 1.
- Android path of one asset batch (mechanism.md Q2, VERIFIED by reading tauri 2.12.1, wry 0.57.0, tao 0.37.1 from the registry):
  - The page calls `invoke('put_assets_batch_b64')`, or `write_chunk` (and `write_chunk_raw`) for each 1 MiB of a large asset. The app's commands never use the custom-protocol request path on Android (`ipc-protocol.js` still allows it for `fetch_channel_data`), so each call goes through `window.ipc.postMessage` (a `JavascriptInterface`).
  - Every Rust command first resolves `app_data_dir()`. On Android that is uncached: `run_mobile_plugin`, then `PathPlugin.getDataDir` on the UI thread, with a blocking `rx.recv()` without timeout.
  - The reply (under 8 KiB of JSON) is delivered by `webview.eval`, then `evaluateJavascript` posted on the UI thread.
  - The pipe to the UI thread (`MainPipe`) is a bounded channel of 8.
- `WryActivity.onPause` calls `WebView.onPause()` when the screen goes off (VERIFIED, wry source). `KeepAliveService` is a `dataSync` foreground service and holds no wake lock (VERIFIED, mechanism.md Q3). The manifest has no `WAKE_LOCK` permission.
- b1's power polls are empty from the 2nd poll (20:57:25, before sleep): blocks 2 to 24 (23 blocks) are empty, screen on or off. Two of them follow the wake, at +18 s (21:08:01) and +48 s (21:08:31). Only block 1 has content, so the polls say nothing about the device's power state. The cause of the fault is unexplained: the first poll worked from the same ad-hoc process, which was started by hand, and the errors were swallowed. (tooling.md Q2 ranks possible causes; none is tested.) The on-device sampler loops (`sampler.sh`, `thsamp.sh`) did survive screen-off in b1, so the new poller runs on the device the same way.
- State in b1 (VERIFIED, run-log): USB charging, battery 100%, `stay_on_while_plugged_in` 0, app not on the deviceidle whitelist. Logcat shows a display doze (Samsung AOD, `DOZE_SUSPEND`) at screen-off but no deviceidle line.
- Both runs had a CDP session attached to the renderer the whole time and b1 still stalled, so CDP attachment does not prevent the stall. It may still change timing (observer effect).

## 2. Candidate mechanisms, grouped by where the JS chain waits

mechanism.md names C1 to C9. Groups, with the observable that separates them:

| Group | Where the JS chain waits | Mechanisms | What would show it |
|---|---|---|---|
| (a) | An invoke was sent but Rust never received it | `postMessage` / JavaBridge path not delivering (C1 request side) | Invoke has a start and no settle. No `getDataDir` line for it in logcat. File count does not grow. |
| (b) | Rust received and wrote, the reply was not delivered | Eval hop through the tao thread and UI thread stuck (C1, C5, C7 reply side) | Invoke has no settle, but the file count grew or logcat shows the command. |
| (c) | JS waits inside `scheduler.yield()` | Yield continuation not run in a hidden page (C4) | An open yield in the ring and no open invoke. |
| (d) | JS waits in a Blob or content-URI read | `file.slice().arrayBuffer()` stalled for a background app (C3) | An open Blob read in the ring. Open: see section 3a. |
| (e) | Renderer task queues paused or frozen | Hidden-page scheduling, Page Lifecycle freeze (C2, C9) | Heartbeat or timer behaviour that changes at the edge, or a `freeze` event. Weakened by b1, where CDP still answered. |
| (f) | Android power policy starves the app | Doze, app standby, procstate or cgroup change, CPU policy (C6) | A change in deviceidle, procstate, oom_adj or cgroup at the edge. |
| (g) | Rust blocked on the UI-thread path | Path resolve `rx.recv()` with no timeout, or `MainPipe` backpressure (C7) | The invoke is open, Rust threads sit in `wchan` waits, the UI thread does not run its looper. |
| (h) | A vendor process freezer on Samsung | Untested hypothesis: the app process or renderer is frozen by a vendor policy after a delay. Logcat lines mentioning Freecess or freeze would show it. A fixed delay of about 60 s fits the observed edge, but no source here says so. | Freeze lines in logcat at the edge, a frozen cgroup, or all threads stopped. |

C8 (disk slowed by screen-off) is already weak: threads were idle and the disk had no queue. It stays covered by the file-count and `/proc/<pid>/io` samples. Group (h) is not in the packets. It comes from the orchestrator's brief.

One unexplained fact the run must resolve: why the copy ran about 61 s after screen-off and then stopped abruptly. The run's first task is to time-stamp that edge (tooling.md "Unexplained").

## 3. What to record, and how (no special build)

**Observer effect.** CDP is attached in every run, as in b1. Install the page-side ring and wrappers with `Runtime.evaluate` after the cold launch and before the file is picked. They persist in the page; do not reload afterwards (a reload clears them). `Page.addScriptToEvaluateOnNewDocument` is not used.

**Harness.** `Agents/Tools/device/cdp.mjs` runs one expression per call. `import-bin.ps1` drives the whole flow and can neither sleep the device nor inject. So lane A extends b1's ad-hoc harness (measure2 `tools\runimp.ps1` and `poll.mjs`) with a pre-pick inject step and a ring drain in its 2 s poll. Lane A chooses the exact form.

### 3a. Page side (injected over CDP, drained by the 2 s poll)

All of it goes into one ring buffer, for example `globalThis.__risuStall`. Names are proposals.

- Wrap `window.__TAURI_INTERNALS__.invoke`: record command name, id, start, settle (resolve or reject) and the byte size of the argument. Forward all three arguments (`cmd`, `args`, `options`); `write_chunk_raw` uses `options`. VERIFIED: `@tauri-apps/api` `core.js` calls `window.__TAURI_INTERNALS__.invoke` at call time, and the app imports `invoke` from there. R0 still confirms the wrapper sees the app's calls.
- Wrap `Blob.prototype.arrayBuffer` and `Blob.prototype.slice`: record start and settle of each read. Open: lane A or R0 confirms whether the Android asset loop reads through `file.slice().arrayBuffer()` (`backuplocal.ts`) or another path (`openAssetStream`). Group (d) is not relied on before that.
- Wrap `globalThis.scheduler.yield`: record start and settle, so the time spent inside the yield is known. `yieldToEventLoop` reads `globalThis.scheduler` on every call (VERIFIED, `saveYield.ts`), so a later override takes effect.
- A `setInterval` heartbeat every 1 s that records its drift. A `requestAnimationFrame` counter. In a hidden page rAF stops by design and timers may be throttled [X], so neither is a finding on its own (see section 5, row e).
- Events with timestamps: `visibilitychange` (with `document.visibilityState`), `freeze`, `resume`, `pagehide`, `pageshow`.
- The existing phase ring (`__risuImportPhases`, marks every 5000 entries) stays. It is too coarse to see this stall alone.
- Sizing: the 50 ms yield budget allows up to about 20 yields per second, 2 entries each (start, settle), plus 2 to 7 invokes per second. The ring holds about 4000 entries. The 2 s poll drains it to the PC each time. Open entries (a start without a settle) are kept by id until they settle, so an open call is never overwritten.

### 3b. Device side (replaces the ad-hoc PC-side power poller)

All untested on this ROM unless marked. Lane A writes the scripts and keeps them in its scratch.

- **Power sampler:** an on-device `sh` loop, started with `nohup`. Every 10 s it writes to `/data/local/tmp`:
  - a canary line (`echo ok $(date +%s)`) and, for each command, its exit status;
  - raw (not grepped) `dumpsys power`, `dumpsys deviceidle`, and `dumpsys activity processes` for the app and renderer pids (procstate, oom_adj, capability);
  - `/proc/<pid>/cgroup` for the app and renderer, cpufreq (`scaling_cur_freq`), and `dumpsys battery`.
  - A canary missing for a sample, or a nonzero status, is the signal that the poller itself failed.
- **Full dumps** at fixed points: before sleep, +30 s, +70 s (after the edge) and +5 min after sleep. Include `dumpsys activity services io.github.yor42.risutanium`, `dumpsys deviceidle whitelist`, `dumpsys usagestats` and `dumpsys alarm`. Read-only commands only. `dumpsys deviceidle step` and `dumpsys batterystats --reset` mutate state and are not used.
- **Thread sampler:** keep the `ths.log`-style per-thread sampler and `/proc/<pid>/io` (run-as) from `sampler.sh`. Its true interval was about 1.5 s, not 1 s (tooling.md). Keep `mem.sh` off (each `dumpsys meminfo` forces a GC, a measured observer effect).
- **Logcat:** save the `main` and `events` buffers whole (b1 left `events` out), with threadtime. The `getDataDir` lines give the Rust-side arrival time of every command. Afterwards grep for `deviceidle`, `freecess`, `freeze`, `DOZE` and `am_proc`. Never `logcat -c`.
- **File count:** every 5 s, count the files in the destination asset directory by `run-as`. File count growing while the page's invokes have not settled means the reply path stalled (group b). Both flat means group (a), (c), (d), (e), (f) or (h). TODO(evidence): the directory path is not in the packets. Lane A fills it from its own scripts before the first run.
- **wchan:** at fixed points (before sleep, +30 s, +70 s, +5 min) read `/proc/<tid>/wchan` through `run-as` for the app's main thread, JavaBridge, tokio workers, and the renderer `CrRendererMain`. Shows what idle threads sleep on.

### 3c. Screen control

Send `KEYCODE_SLEEP` and `KEYCODE_WAKEUP` from the harness, like b1. Phone 2's CDP forward range is 6310 to 6329 (measure2 `tools\h.ps1`). The `device-prep.ps1 -ScreenOff` mode only skips stay-awake and WAKEUP; it still whitelists the app. It does not turn the screen off. Log the harness's own CDP poll interval (2 s).

## 4. Runs, limits and exits (MC-330)

Common rules: one Note 9, debug MEASURE build as in b1, USB charging, test-only profile. Restore the app data from a verified snapshot before each run and after the last. Kill only own processes. Whole session: 75 min hard, including restore and fixture push. Per run: 15 min hard. Abort on a crash or renderer loss and record the log tail.

**Data ceiling.** Reuse the measure2 fixture `m2-mix18k.bin`: 1,331,537,701 B (1.24 GiB), assets 1,216.7 MiB in 18,000 files (report.md). Cap: 1.25 GiB. **This is above MC-330 1's 200 to 500 MB guidance. The maintainer approved it as an exception on 2026-10-22 (`MC-430`, in `lane-C-records.md`).**

Why the guidance does not fit: this is not a rate check. The stall began about 61 s after sleep, about 66 s into the copy, at 4 to 8 MiB/s of disk writes, so a 200 to 500 MB set could finish before the edge. Two rules were checked:

- "The copy would still run 180 s after screen-off at 8 MiB/s" needs about 1,440 MiB of assets. That is above the cap, so 1,216.7 MiB does not meet it.
- The debug build copies at 3.64 to 3.85 MiB/s on screen-on (316 to 335 s for the set, report.md). Sleep comes about 5 s after the copy starts. The copy then has about 310 s to run, which is more than 120 s after screen-off and about 5 times the 61 s edge.

So the rule used is: **the copy must still be running 120 s after screen-off**. At the screen-on rate the fixture meets it. A smaller fixture is acceptable only if lane A shows it keeps the copy running 120 s after screen-off.

**Fixture push.** `fixture-push.ps1` has a 600 MiB default ceiling. It also has `-AllowLarge` (needs a non-blank `-AllowLargeReason`) and `-MaxSeconds` up to 1800 (`Agents/Tools/device/README.md`). Lane A uses these. TODO(evidence): restore and push time for this fixture is not measured; lane A records it and budgets it into the 75 min. If four runs do not fit, R4 is dropped first.

**PC first (MC-330 3).** R0 on PC headless Chrome (lane C ports 6440 to 6459 if lane C hosts it; otherwise lane A's own):

- The injector installs the ring, the wrappers catch the app's `invoke` (or show that they miss it), the Blob wrappers record, and a ring dump reads back over the 2 s poll.
- Overriding `window.scheduler` with `Object.defineProperty` to remove `scheduler.yield` makes `yieldToEventLoop` take the `MessageChannel` path. Making it resolve as a microtask changes the yield time in the ring. Both are visible in the wrapper's output.
- Lane A dry-runs the on-device poller script syntax (`sh -n` and a fake-adb run), including the canary and the exit-status lines.
- Pass: all three. Fail: fix and repeat once, then stop and report. Time limit 30 min on the PC.

**Device runs.**

| Run | Setup | Exit |
|---|---|---|
| R1 baseline | As b1: no prep, stay_on 0, no whitelist. `KEYCODE_SLEEP` about 5 s after the copy starts. | See exit rules below. |
| R2 backgrounded, screen on | Read the original `stay_on_while_plugged_in` first, then `settings put global stay_on_while_plugged_in 7` directly, so the screen stays on. About 5 s after the copy starts, `input keyevent KEYCODE_HOME`. Restore the original value after and read it back. Do not use `device-prep.ps1` here: it also whitelists the app, which would confound R2 with R3. Separates a hidden WebView (`onPause`) from display and device power. | Same. |
| R3 screen off, whitelisted | `device-prep.ps1 -ScreenOff` whitelists the app (`dumpsys deviceidle whitelist +<pkg>`) without stay-awake; then as R1. Separates Android power policy. Revert the whitelist after and read it back. | Same. |
| R4 screen off, yield override | As R1, plus the injected override of `scheduler.yield` before the copy. Only if R1 shows an open yield. Before R4, an on-device `Runtime.evaluate` check that `scheduler.yield` can be removed or overridden on WebView 155; R0 on the PC does not prove it for the phone. | Same. |

R2 to R4 are conditional on R1 (section 5). Order: R1, then R2, then R3. If R1 does not reproduce, stop (see the table).

**Exit rules for every device run** (MC-330 pass/fail):

- **PASS (reproduced):** no growth of the destination file count for 180 s with the screen off. Then take the full snapshot set (dumps, wchan, ring dump, thread sample). Hold 60 s. Wake. Record whether the copy resumes within 30 s. Stop. For R2 read "with the screen off" as "with the app backgrounded".
- **PASS (not reproduced):** the copy completes while the screen is off (or the app is backgrounded).
- **INVALID:** the poller canary is missing from more than 10% of samples, or the ring cannot be read over CDP. Fix once, rerun once, then stop the session.
- **ABORT:** crash or renderer loss.

Time plan from b1 (excluding restore, push and launch): the file tap, then "database decoded" about 42 s later; sleep about 5 s after that; then the edge at about 61 s; then 180 s without growth, a 60 s hold and 30 s after wake. That is about 6 to 7 min of run time.

## 5. What each outcome means

Read the ring first, then the device files. Report every matching row. If rows from different groups match, say so and treat the run as pointing to all of them.

| Observation | Mechanism group | What lane C's later design would need (no design here) |
|---|---|---|
| Invoke started, no Rust arrival (no `getDataDir` line), file count flat | (a) request path | Copy not driven by page-to-Rust invokes with the screen off. |
| Rust arrival, file count grows, invoke never settles | (b) reply path | A reply path that does not depend on the UI thread, or a native task that needs no reply per batch. |
| Open yield, no open invoke | (c) | A copy loop with no yield on Android, or a native task. |
| Open Blob read (only if the loop was confirmed to read through Blob) | (d) | Reads must not rely on a page Blob with the screen off (the thin native task would read the file). |
| Heartbeat or timer behaviour changes at the edge compared with R1's own hidden window before the edge (screen off, copy still running, about 61 s), or a `freeze` event | (e) | The copy must not need the page to run while hidden; native task. A stopped rAF or throttled timers alone are not a finding: they are expected in a hidden page. |
| Change in deviceidle, procstate, oom_adj or cgroup at the edge | (f) | Wake lock, battery-optimisation exemption or the foreground-service type may be the fix. A native task alone may not escape it. |
| Freeze lines (Freecess or similar) in logcat, or frozen cgroup, at the edge | (h) | Samsung-specific; the design must name this limit or the exemption needed. |
| Rust threads in UI-path waits and the UI thread not running | (g) | Remove the per-command path resolve (cache the data directory) and avoid UI-thread hops. |
| R2 (backgrounded, screen on) stalls too | The hidden WebView, not display or device power, is enough: (e), (c), (a) or (b). | Hidden-page behaviour is the target, so even a screen-on background import is affected. |
| R2 does not stall, R1 does | Device or display power state: (f) or (h). | Power policy is the target. |
| R3 (whitelisted) does not stall | (f) Android power policy, only if R1 stalled in the same session | Exemption in setup or a wake lock; check MC-326 4 and the battery-exemption wording. |
| R3 stalls like R1 | Not deviceidle policy (display doze, standby or a vendor freezer are still open) | Do not rely on whitelisting. |
| R1 does not reproduce | Inconclusive for the mechanism. The b1/b2 stall is not stable. | Record the new fact; ask the maintainer whether to repeat R1 once. |
| Edge cannot be located, or no row matches | Inconclusive | Next step is a separate gated stage: a MEASURE-gated marks build (or a no-yield build). That is a code change and needs its own maintainer decision and a Gate 1-style challenge before it goes to lane A (lane C brief, Gates). |

Repeat rule: if time remains in the session, repeat a non-stalling run once. A non-stalling R3 counts toward (f) only if R1 stalled in the same session.

Also compare the observed edge time with the logcat events (`events` buffer, power and procstate lines) to decide whether the edge is a timed policy (a fixed delay after screen-off) or load-dependent.

Nothing here changes MC-326 4. Until a row is hit, how much of "the import keeps running with the screen off" holds on this phone stays open.

## 6. Hand-off to lane A

Lane A returns, to a folder named for the run in its scratch (`%TEMP%\risu-b715\`):

- the raw files of every run: poller output, full dumps, `ths.log`, wchan samples, logcat `main` and `events`, the file-count series, `heartbeat`, `run-log` with timestamps of sleep, edge and wake, and the per-run `result.json`;
- the ring dump as JSON, read at the end and, if possible, at the edge;
- the decision-table row hit for each run, and the INVALID or ABORT reason if any;
- the R0 results and any script changed after R0.

Cleanup after the session (lane A):

- Restore the app data from the snapshot; remove the fixture, scripts and sampler output from `/data/local/tmp` and the phone storage.
- Kill the on-device sampler and poller loops by their own recorded pids.
- Revert `stay_on_while_plugged_in` (R2) and the deviceidle whitelist (R3), and read both back.
- Remove only forwards and processes lane A started.

Lane A uses its own ports and scratch (phone 2: 6310 to 6329, `%TEMP%\risu-b715\`). Lane C holds no phone access. The results come back to lane C through the maintainer. Records for the run (a CHORE-202 status) are folded in by lane A. Lane C starts no design work before the results arrive.

## 7. Deviations and contradictions found

- CHORE-202 and report.md say the copy ran about 90 s at normal speed. tooling.md measures the full-speed copy as about 61 s after sleep and about 66 s after the copy started (20:57:37 to 20:58:43). This plan uses the tooling.md numbers. The 90 s figure may count from the file tap.
- tooling.md R3 and verify.md disagree on the size of `power.txt`; the plan does not cite it. The plan counts 23 empty blocks (2 to 24), two of them after the wake.
- The brief calls the poller fault a "poller fault, not device behaviour". The plan states only what is shown: empty from the 2nd poll, before sleep, cause unexplained.
- The brief proposed `Page.addScriptToEvaluateOnNewDocument`; the verifier's correction replaced it with a pre-pick `Runtime.evaluate`.
- `fixture-push.ps1` has a 600 MiB default ceiling; the fixture is 1.24 GiB. Covered by `-AllowLarge`; the push time is TODO(evidence).
- The 180 s at 8 MiB/s fixture rule gives about 1.4 GiB, above the cap; the plan uses the "still running 120 s after screen-off" rule. The 1.25 GiB ceiling is above MC-330 1's guidance and needs the maintainer's approval.
- The destination asset directory path is not in the packets: TODO(evidence) for lane A.
- Group (h) (vendor freezer) comes from the brief and has no source in the packets.
- Whether the Android asset loop reads through `file.slice().arrayBuffer()` is open (group d).
- Tauri version: the lock that sets the version is in the main checkout (tauri 2.12.1); whether the device APK linked that is UNCERTAIN (mechanism.md R4). Conclusions were checked equal for 2.12.1 and 2.12.5.

## Sources

- `Agents/Lanes/lane-C-brief.md` and `Agents/Lanes/README.md` (lane rules; lane C ports 6440 to 6459). Phone 2's range 6310 to 6329: measure2 `tools\h.ps1`.
- `Agents/Roadmap.md`, CHORE-202 and CHORE-203. `Agents/Maintainer-Context.md`, MC-326 item 4 and MC-330 items 1 to 4. `docs/workflow/gates.md`, "Device checks". `Agents/Tools/device/README.md` (`fixture-push.ps1` flags).
- `src/ts/storage/saveYield.ts` (`yieldToEventLoop`, `createYieldBudget`).
- `%TEMP%\risu-lane-c\evidence\tooling.md` and `mechanism.md` (AI-authored, not independently verified).
- `%TEMP%\risu-b715\measure2\report.md` (only "Corrections from doc-verifier" and the statements it leaves standing) and `verify.md`.
- doc-verifier result for this plan, 2026-10-22: PASS WITH CORRECTIONS (relayed by the coordinator; corrections applied).
