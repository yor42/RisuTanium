# Findings 2026-11-28: Stage 0 hidden-page measurements (#949)

Measurement only. No product code changed, no product decision made (MC-5170..5176 in `Agents/mc/949.md`). Refs #949; nothing is closed by this document. Study: `Findings-2026-11-28-backend-separation-study.md` (its section 5 UNKNOWNs are answered or narrowed below where stated).

## Method and build identity

- One Note 9 (phone 1, serial 29f3cde9193f7ece, SM-N960N, Android 10 SDK 29, Android System WebView 156.0.8078.47, taken from the lane brief and not re-read through the guard). Synthetic data only. The orchestrator judged from result files; one device-runner subagent per run (four runs under one phone lease), no inline device driving.
- Build: MEASURE **release** (unsigned APK of origin/main 67d306263 built in an isolated worktree, SHA-256 250798FDE52AC55F79D33AF98BA4F8D59B5CB2C8DB3145EBF2D665F6E9C2AFA4; re-signed with the persistent TEST key by sign-install.ps1, device base.apk SHA-256 1ea189acf1024798476a3a7cf27b510746c767ff78f469c45698dba7fba67366, debuggable=False). The earlier CHORE-202 runs were a debug build on WebView 155; these are the first Stage 0 data on a release build and WebView 156.
- Power: USB-connected at 100 percent, battery 28.2 to 30.2 C in every run. **Not unplugged: Doze was not exercised** (row h). The CPU thermal zone is unreadable (no root); only the battery half was recorded, and no timing comparison was made, so no thermal gate applied.
- The app's dataSync foreground service (KeepAliveService) was running during every reply run (logcat "Start accepted" ... "Instance gone"). No run isolates its effect (row c not run).
- Page probe injected over CDP: 1 s heartbeat, visibility/freeze/resume listeners, and a count of Tauri callbacks executed. It wraps `__TAURI_INTERNALS__.callbacks.get` because `runCallback` and `transformCallback` are non-writable, so the count includes every Tauri callback, not only reply events (about 28 to 103 per 10 s before the freeze, depending on the run).
- Stub: `Agents/Tools/device/mock-openai.mjs` (a logging copy), own ports 6270 (stub) and 6272 (CDP), `adb reverse`. Ownership (MC-1451, `streamed_fetch` and `reply_store` in Rust) was read only in the foreground eligibility proof of run a2 (a 600-byte stub with 100 ms chunks: a live `native_reply_list` entry during the stream, not the owner event). The long A1 and A2 runs and every run-b sub-run were not read for ownership; their ownership is inferred from the same setup.
- Setup inputs set over CDP on DBState.db (disclosed): aiModel=reverse_proxy, customAPIFormat=0 (OpenAICompatible), customProxyRequestModel=stub-model, one connection to the stub, proxyConnectionId, useStreaming (true or false per sub-run), requestRetrys=0, character names SynthA and SynthB. Everything else went through the app's own UI.
- Raw files: `%TEMP%\risu-949\run-a2`, `run-b`, `run-d`, `run-d2` (not in the repository). The first dispatch (`run-a`) stopped before measuring because the brief lacked guard forms; it holds install facts only.

## Row status

| Row | Status | One line |
|---|---|---|
| (a) owned streamed reply, screen off, 5 to 10 min | run (three runs, one with CDP polls) | 458 s and 306 s replies completed in full; process alive; no early socket close |
| (e) Rust-to-page events while frozen; does page JS run | run | callbacks executed live while timers were frozen; also with no CDP attached (run b) |
| (b) over-60 s non-stream, owned and group | run (150 s stub wait; longer not run) | both completed; 2999 of 3000 chars |
| (d) hidden export at 60 s and 5 min, partial-file state | run, **edge not crossed** | 81 MB and 340 MB exports finished in about 18 s and 32 s, before the freeze; partial file after a force-stop observed |
| (c) wake-lock A/B | not run | no diagnostic build made |
| (f) content-URI descriptor survival | not run | source reading only (below) |
| (g) native SAF write rate | partly observed | export loop wrote about 13 MB/s; no native-only entry point exists |
| (h) unplugged screen-off 3 to 5 min | not run | the cable has to come out, which ends adb |
| (i) Android 15 dataSync onTimeout | not run | no Android 15 device or emulator available |

## (a) and (e): owned streamed reply with the screen off

Host UTC ms unless marked device. The device clock was 3.8 to 4.4 s behind the host.

**Run a2 (a CDP client attached, polling every 30 s during the hold).** Stub 6000 bytes in 20-byte chunks, 1500 ms apart, 302 events.
- A1: request at 1795875915167; `KEYCODE_SLEEP` returned 19.6 s later; stub response end 1795876373070 (457.9 s after the request), socket closed 18 ms later, no client-error. The hold ended about 172 s after the stub end (the brief asked for 120 s; the runner's HOLD-DONE log line is 172.2 s after the stub end); wake at 1795876555268.
- Page: hidden at device 1795875930718, `freeze` 70.5 s after hidden, one heartbeat gap of 561 s (timers stopped 55.4 s after hidden), `resume` and visible at the wake. No pagehide or pageshow.
- Callbacks: 38 to 64 per 10 s before the freeze; 6 to 7 per 10 s (the stub chunk rate) from the freeze through the stream end; none after that until the wake (12 in the first bucket).
- Result: DBState character message 6000 of 6000 chars after the wake; after one page reload the chat still showed it (8 messages). App pid 30874 unchanged at every poll. logcat lines mentioning the package: freeze, Freecess, deviceidle, am_proc_died, lowmemorykiller, ANR: 0 in the window.
- A2 (screen on, HOME 13.7 s after the request, return after 150 s): freeze 60.0 s after hidden; 6 to 7 callbacks per 10 s while frozen; reply 6000 of 6000 chars.

**Run b, B1 (no CDP client while the screen was off; the forward was removed before sleep).** Stub 1000 ms chunks, 305.9 s. Same pattern: hidden at once, `freeze` 79.1 s after hidden, the heartbeat stopped about 60 s after hidden and did not run until resume, 216 callbacks executed between freeze and resume at about one per chunk, none queued for the resume (12 in the first 15 s after it), reply 6000 of 6000, pid unchanged. Disclosed: the first hold loop ended early (the runner's end detector matched a `/__ping` response) and was resumed after a gap of about 25 s with no input and no CDP.

**Reading of (e):** with the page frozen, Rust-to-page `evaluateJavascript` callbacks were executed as they arrived in run a2 and run b, while `setInterval` timers were not. This is an observation on this device, WebView and power state. It does not say whether other page JS (promise chains, timers set by the app) runs while frozen; the export rows are the only other evidence on page-driven work.

## (b): over-60 s non-stream replies and the group chat

Stub 3000 bytes, `--delay-ms 150000` (150 s wait, then one JSON body); screen off 11 to 13.6 s after the request; hold to the stub end plus 47 to 64 s.
- B2, single-character chat, non-stream: stub response end 150.0 s after the request; `freeze` 79.1 s after hidden; 20 callbacks within about 0.3 s of the response end, while frozen; none from the freeze (device bucket 8) until that burst, after 3 to 6 page callbacks per 10 s before the freeze; message in DBState 2999 chars (stub 3000).
- B3, **group chat, streamed** (not native-owned according to the study's source reading; not checked on the device): same pattern as B1: freeze 60.0 s after hidden, 235 callbacks during the freeze at the chunk rate, reply 6000 chars. The group chat's message list held only the character reply when read (no user message; not investigated).
- B4, group chat, non-stream: the first Send click did nothing (the second sent it), sleep at 13.6 s; the hold ended 46.7 s after the stub end instead of 60 s (same detector problem); 20 callbacks at the response end; reply 2999 chars.
- All four: process alive at every poll, no client-error or early close at the stub. The 150 s wait is the longest non-stream wait tested. The 2999 against 3000 chars difference was not examined.

## (d): hidden export

Route: Settings > Backup & Files > Save Backup Locally. This build showed one app confirm, a short in-app collect phase (3 to 55 s), then the Samsung save picker (default name `local-<date>.bin`, accepted with the guard `pick --id android:id/button1`), then the writes. Earlier findings had expected three confirms.

| Run | Fixture | Foreground write | Hidden run |
|---|---|---|---|
| run-d | home-1000-shelf.bin, 45.7 MB, 965 characters (import about 215 to 245 s) | 81,178,795 B in 9 to 13 s | screen off 0.85 s after the picker Save: 81,178,809 B at +18 s, unchanged through the 300 s hold, "Backup saved" at wake |
| run-d2 | small.bin, 335 MB, 52 characters, 1979 assets (import under 3 min) | 340,058,305 B in about 26 s (about 13 MB/s) | screen off 5.7 s after the Save: 340,058,318 B by about +32 s, unchanged through 302 s, "Backup saved" at wake |

- **The 60 s freeze edge was not crossed in either run** (run d2: freeze 60.0 s after hidden, the write finished about 34 to 42 s before it). Hidden export beyond 60 s and the 5-minute write: **not tested**. At 13 MB/s a 60 s write needs roughly 800 MB or more.
- File sizes grew between samples taken 4 to 9 s apart (about 60 MB per 4.2 s sample at the fastest) with the screen off. The probe could not tell which export callbacks ran, so this does not show which part of the loop depends on timers.
- Hidden exports differed from the foreground ones by 13 to 14 bytes and in SHA-256 (bytes not read; a timestamp or id is likely, not verified).
- D2 (partial file): screen off 9 s after the confirm, `am force-stop` at +19.8 s while the file was 265.8 MB and growing: the file stayed at 272,277,504 B (80.1 percent of 340,058,305) for 60 s. After relaunch (new pid) Home showed 50 characters and **no incomplete-export notice or dialog was visible** (one observation). No ranged-hash guard form exists, so whether the partial is a prefix of the full file was not read.
- Disclosed incident (run-d attempt 1, superseded): a script bug stopped the run before the sleep, and the runner then deleted the exported file with `rm -f` while the export was still writing; the app later reported "Backup saved" with the file absent. Not a valid D1.

## (f), (g): source only, not measured

- (f) `export_append_b64` opens the content URI on every call (truncate on the first chunk, append after), so no descriptor is held across calls (`src-tauri/src/export_append.rs`, read again by the documentation check; `src/ts/exportWriters.ts` and the rest by the design investigation). A held-descriptor test needs a native command that holds one; none exists. Not run.
- (g) There is no native-only SAF write entry point. The 13 MB/s above is the page-driven loop's rate on these fixtures, not a native rate.

## Further disclosures

- Guard spelling: `--own-ports` had to be a comma list (for example `6270,6271,6272`); the range `6270-6309` gave exit 97 on the first `reverse` call (run a2), then the same call passed once respelled. Run b used `6270,6272`. The screencap form with `--out` after `--` is refused by the device (exit 0 with usage text); the guard's own `--out` flag before `--` worked.
- Run a2: a stray CDP click on the chat input "Menu" button (no message sent, closed again); earlier probe versions stayed in the page with a second heartbeat interval (writing to a discarded object); a second stub on 6271 served the eligibility proof; the wake and return screenshots and first post-wake reads came at about +8 to 10 s, not +1 s; A2's HOME came 13.7 s after the request, not 20 s; one logcat line matching "freez" belonged to another process; "Instance gone" for the keep-alive service appeared about 10 s after the wake.
- Run b: the run-a2 probe was reused, so its rings held older entries; B3 group setup used `input tap` after a stale screen frame, four late taps added SynthA twice and one tap opened the soft keyboard (Back closed it), the duplicate was removed in the group UI, and the first chat's message count read 1 then 14 transiently; B3/B4 wake reads came at +4.1 s and +1.6 s.
- Run d: `fixture-push.ps1 -Remove` also deleted a pre-existing `/sdcard/Download/home-1000-shelf.bin` of the same name (it was a fixture from an earlier run, replaced by the push and then removed). Attempt 1 additionally tapped (540,1992) on the in-progress export dialog and hashed the partial file before the `rm -f`.
- Run d2: one `shell df /sdcard` call outside the brief's form list (guard allowed it; 102,038,328 KB available); the picker proposed the stale name `local-20261129.bin` and saved with no overwrite prompt although `ls` said that file did not exist.
- Build: after the build the build worktree showed `AndroidManifest.xml` and `gradlew` modified at line-ending level (not inspected; the APK is the one hashed above).
- Setup edits over CDP also include the repeated `useStreaming` changes and the character names; CDP was otherwise used in the export runs to locate buttons (read only).
- The first dispatch (`run-a`) stopped before measuring; its result file holds device facts, the install (re-signed APK SHA-256 1EA189AC...7366, test key SHA-256 69c387cd...aaf) and the census only.

## Open gaps (stated as gaps, not recommendations)

- Unplugged screen-off (Doze), Android 14 to 16, other vendors, other WebView versions, a WebView 155 debug comparison on the same phone: not covered.
- Replies longer than about 460 s streamed or 150 s non-stream; frontier-model providers (the stub speaks the OpenAI-compatible format only); tools, continue and preview paths, which are never owned: not covered.
- Whether the dataSync service or the USB connection keeps the process and the Rust socket alive: the service ran and USB power was constant in every run, so neither was varied.
- A hidden import: imports ran in the foreground with the screen on as setup only.
- A hidden export that lasts over 60 s: the fixtures finished in 18 to 32 s; at about 13 MB/s a 60 s write needs roughly 800 MB or more.
- The wake-lock A/B (row c) and the Android 15 timeout (row i) were not attempted.
