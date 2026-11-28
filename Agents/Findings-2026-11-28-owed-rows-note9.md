# Findings 2026-11-28: owed Note 9 rows (#156 UI, #930 A/B, #193 baseline, #508 cells, DenseStatus, ExportWriteCall)

Follow-up to `Findings-2026-11-28-async-measurements.md` (PR #947). Measurement only: no application code changed, no product decision made (MC-5074..5079 in `Agents/mc/owed-rows-note9.md`). Refs #931, #930, #193, #508, #156; nothing is closed by this document.

## Method and build identity

- Two Note 9 (SM-N960N, Android 10, synthetic data only), one device-runner subagent per phone and per attempt, each with a bounded brief; the orchestrator judged nothing inline.
- Build: MEASURE release build of tree cdf3c3824, signed.apk SHA-256 318D3F27EED8453D8C43AE302A194AFE81CD61C29B02829B946902ACCCDC2A34 (arm P). origin/main at the time (39b7f5013) has no Home, boot or grid change over that tree.
- Arm N (no prefetch): the same tree with the single `prefetchChroMemoryVectors(...)` call in the `DefaultChatScreen.svelte` effect replaced by a no-op, built in a scratch worktree and never committed. Unsigned SHA-256 E551496E37592326BC985AB09106AB9D81FFECED661B510A016E9B69A5DFD981; signed with the persistent test key (DDB4778745EB94A3DAE264DDB68BA918532760B5CA20178278C68984DB9196DE) and installed in place, data kept. The edit is a measurement input, disclosed here; it is not a proposal.
- Thermal gate before every timing window: screen off, battery <= 34.0 C. Battery was 30.4 to 32.5 C throughout and no window was skipped. **CPU zone unreadable** (no root), so only the battery half of the gate was checked.
- Raw files: the run folders under `%TEMP%\risu-device-run-5\run-p1d`, `run-p2a`, `run-p2b` (not in the repository).

## #156 off switch (PR #934), phone 2, observation only

Frequency Penalty row (checkbox plus slider 0..200, value x100):

| step | checked | aria-valuenow | caption | slider |
|---|---|---|---|---|
| initial | true | 70 | 0.70 | tabindex 0 |
| toggled OFF | false | 0 | Off | tabindex -1, aria-disabled=true |
| CDP mouse click and CDP touch on the dormant slider | false | 0 (unchanged) | Off | no change |
| toggled ON (same preset) | true | 70 | 0.70 | restored |
| OFF, preset switched to a new preset and back, then ON | true | 0 | 0.00 | the slider minimum |

- The new preset's Parameters tab has no Frequency Penalty row at all (default parameter set); after switching back, the row was still Off.
- Restored to the initial state (checked, 0.70); the extra preset was deleted through the app's own confirm.
- TalkBack not run. Three stray CDP clicks during step 4 landed on the Thinking Tokens or margin area with no visible change.

## DenseStatus.queryMs, 20 sends in one session (hybrid retrieval, ~4,790 units), phone 2

`queryMs` is not shown in the ChroMemory modal (it prints only state and the "vectors of units" text) and is in no performance measure; it was read from the `chroMemoryTrace` store (`trace.dense`) through CDP, read-only.

- queryMs (sorted, ms): 49.2, 55.7, 69.1, 69.4, 77.9, 83.5, 85.8, 91.5, 94.8, 95.9, 96.7, 98.2, 104.5, 105.2, 114.4, 116.6, 118.3, 121.1, 127.8, 145.7. Median about 97 ms; range 49 to 146 ms.
- Dense total (`ms`) 97.8 to 233.5; whole-send trace total 146 to 304 ms. In the `risu:chromemory` measure, index 5.5 to 25 ms, rank 0.2 to 3.6 ms, pack 25.8 to 63.3 ms, room 0.1 to 2.6 ms; items 30 to 38. The dense state alternated ready and partial (4786/4786 vs 4786/4787) as each new message became a unit; every send outcome was `injected`.
- Setup: new empty character created through the UI with a 5,000-message chat (the earlier S3d4 character carries a 1.5M-char description and cannot send: "minimum required token"); the first index build used 4,785 embed inputs in 300 stub calls (about 100 s). No "Invalid URL" first-send quirk appeared. The embeddings stub ran on own port 6312 because an earlier runner's stub still held 6310.

## ExportWriteCall (one export), phone 2

Route: Settings > Backup & Files > Save Backup Locally, three confirms, Samsung save picker, guard `pick --id android:id/button1`, ordinary guarded tap. `risu-measure-import`='on' set over CDP and removed after. Exported file local-20261128.bin, 6,236,988 B, removed by exact name.

- export stub and late payloads done: writeCalls=3 writeVia=b64 writeBytes=5697902 writeSyncMs=80 writeWaitMs=206.7 writeCreates=1 encodeMs=28.3 closeMs=0 writeList=61:0.6:20.9:new,4194304:57.9:123.3,1503537:21.5:62.5
- export database written: writeCalls=0 (no bytes)
- export closed: writeCalls=1 writeVia=b64 writeBytes=539086 writeSyncMs=7.5 writeWaitMs=89.7 closeMs=97.2 appendSynced=true
- Whole export 741414 to 820024 ms phase clock, of which the picker wait is the larger part (writer opened at 818846). n=1: a second export was not run (the route cannot type a fresh file name, the default would collide).

## #930 prefetch A/B on the same source tree (phone 2, n=5 per cell, both arms)

Library: the 4,794-unit hybrid chat above. Sends happen 6 s (imm) and 16 s (late) after the composer textarea is ready, which is about 8.5 s and 18.5 s after process launch (the brief said after launch; the runner timed from textarea-ready, 2.5 to 2.9 s page time). `risu:chromemory` entry duration, ms:

| cell | runs | median |
|---|---|---|
| P imm | 400, 459, 679, 468, 763 | 468 |
| P late | 789, 419, 435, 745, 657 | 657 |
| N imm | 1388, 1450, 1547, 1419, 1412 | 1419 |
| N late | 1434, 1408, 1436, 1446, 1423 | 1434 |

- `chromemory-vector-load` entry, medians: P imm 1046, P late 1074, N imm 1693, N late 1766 ms. In arm P it starts at about 2.0 s page time (before the send); in arm N it starts at the send. Every run in both arms had rebuildCause `fresh`, d0Units 4,794 to 4,798.
- The two arms differ by about 0.8 to 1.0 s at the send, with no overlap between the P and N ranges in either cell (max P 789, min N 1388). Arm P's late cell is not faster than imm; its spread (419 to 789) is wide, and Run F's earlier P-only figures (imm 3215, late 2294 ms) were on a smaller-memory state and are not comparable.
- Memory (meminfo-snapshot, KiB, one run per arm, 20 s after the composer was ready, no send): P app 186,553, sandbox 292,775; N app 191,261, sandbox 208,130. The prefetch's footprint is therefore about +84.6 MiB in the sandbox (WebView renderer) at idle; the app process is not higher. "Early" snapshots were taken 3 to 4 s after launch, before the composer was ready (no Home screen is visible because the app opens the chat directly).
- #930 is therefore no longer inconclusive on this hardware and this library; the earlier inconclusive result was an A/B between identical APKs.

## #193 baseline (phone 1, cell home-1000-shelf, 965 characters), current build, no worker exists

- Import route: the onboarding restore flow with real taps and the system chooser (the guard `file-chooser` verb failed twice with exit 7, so it was not used). Imports took about 7 min (1000 shelf), 5 min (1000 noshelf), 2.5 min (500 shelf), by poll loop.
- A1, 5 cold starts: `am start -W` TotalTime 274 to 297 ms (median 292, activity launch only); ready (Home landing plus library mounted) 3417 to 3450 ms (median 3442); first contentful paint 540 to 616 ms (median 556); settled PSS total 372,772 to 377,971 KiB (about 185 to 190 MiB each in app and sandbox).
- A2, long tasks before 20 s page time, 3 cold starts: longest 402, 414, 412 ms; sum over 50 ms 1373, 1478, 1476. The big tasks fall at 0.7 s (about 350 ms), 1.4 s (about 210 ms), 1.6 to 1.9 s (about 170 to 200 and 402 to 414 ms), 2.4 s (about 145 ms); after about 6.8 s a task of 75 to 85 ms recurs every 2.1 s in all runs and after the flings.
- After 5 touch flings on the library container (scrollTop 0 to about 5,900 px of a 70,442 px list): new long tasks longest 81, 107, 93 ms; sum over 50 ms 174, 226, 214.
- A3 PSS (KiB, app | sandbox): settled about 183,200 to 185,617 | 187,344 to 188,772; after the flings 229,526 to 245,569 | 200,890 to 208,920 (app +45 to +60 MiB). End snapshot was taken on the 500 library after a cold Home: app 183,439, sandbox 183,584 KiB. No worker exists, so there is no worker PSS delta.
- A4: all 17 `<img>` in the document start with `http://asset`; zero `data:` or `blob:`; zero images inside the library section (rows render without images, 12 mounted at rest and 18 to 19 after flings in the default Simple view). The base64 path is not reached on this build. Grid view mode was not exercised.

## #508 Home boot cells (phone 1)

home-bench boot (warm document reload, `--runs 5`, `--pause-ms 8000`, value = max(T_paint, T_tap)):

| cell | values (ms) | median | max | T_paint median | T_lib median |
|---|---|---|---|---|---|
| 1000 shelf (965 chars) | 2647, 1911, 2066, 2080, 2200 | 2080 | 2647 | 2042 | 2267 |
| 1000 noshelf (965) | 2395, 2159, 2063, 2201, 2188 | 2188 | 2395 | 2130 | 2634 |
| 500 shelf (485) | 2103, 1759, 1648, 1871, 1949 | 1871 | 2103 | 1785 | 1962 |

- Tap input-to-frame 38 to 86 ms in all cells except one 200 ms (noshelf run 2).
- True cold starts (`cold-start.ps1` ready ms): 1000 shelf 3354 to 3510 (median 3441); noshelf 3405 to 9469 (4500, 3422, 3405, 3995, 9469; median 3995; the 9469 ms run is an unexplained outlier); 500 shelf 3332 to 3451 (median 3409).
- Plugins (B4), 500 shelf library, two synthetic V3 plugins installed through Settings, enabled, probe buttons never tapped: values 2317, 2090, 2650, 1930, 1957, median 2090, max 2650, against the plugin-free same-library median 1871, max 2103. About +0.2 s at the median, with a spread wider than the difference at n=5. It is not comparable to the 1000 library cells (the library had been replaced).
- Earlier context (`Findings-2026-11-27-508-home-boot-phase1.md`, build A 2345, build B 1931 on the 1000 shelf at about 30 C): this run's 1000-shelf boot median of 2080 lies between them.

## Per-ticket reading (for the maintainer, not a decision)

- #930: median send 468 and 657 ms with the prefetch against 1419 and 1434 ms without, at about +85 MiB sandbox PSS at idle. Keeping the prefetch costs memory and buys about 0.8 to 1.0 s on the first send.
- #193: the baseline above is the evidence for a worker prototype: cold-boot long tasks up to about 410 ms near 1.9 s page time while the grid mounts, post-fling long tasks up to about 107 ms, and the base64 path is not on the Tauri build's path.
- #508: Home boot on the 1000 library is about 2.1 s (warm) and 3.4 s (cold ready) here; the shelf makes no clear difference (noshelf slightly slower, within the spread).

## Not run

#885 split (needs a measurement code change of about 15 lines), #881 delta (two builds), B4 on the 1000 library, a second export for ExportWriteCall, TalkBack for #156, a png or jpeg cross-check, D-301-SAVE with n of 2 to 5, Grid view for #193.

## Incidents

- Lease token for the build slot `dr5b-build2` was generated inline and not saved, so it could not be renewed or released and lapsed by TTL. All other leases were released by the reset helper (status ok, needsReset=false).
- The guard `file-chooser` verb failed on phone 1 (exit 7, a NotReadableError on the pushed file; exit 6 once at locate-css with the button below the fold). The system chooser route worked.
- A stray stub (PID 49760 from an earlier runner) still listens on 6310 on the PC; not touched, not mine.
- Runner deviations: DenseStatus read from the trace store; a new character used because the S3d4 one cannot send; send delays timed from textarea-ready; Row C run once; a guard tap in Row C returned exit 99 once (stale locate) and was repeated per the rule.
- The 500-library meminfo snapshot, not the 1000 one, was taken at the end of the phone 1 run.
- Phone state at the end: phone 1 holds the 500 library plus two synthetic plugins (disposable); phone 2 holds arm P (base.apk 318d3f27...) with the synthetic hybrid library.
