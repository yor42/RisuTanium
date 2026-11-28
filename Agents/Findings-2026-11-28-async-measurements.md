# Findings 2026-11-28: async-study measurements and D-301-SAVE on the Note 9 (run F)

Device: Note 9 SM-N960N (phone 2, serial 2ac80128013f7ece), WebView Chrome/156.0.8078.47, 8 cores, deviceMemory 4. Build: MEASURE release APK (VITE_RISU_MEASURE=1), tree cdf3c3824, APK SHA-256 D7B7413D868FFB7182356E856B0577AC371BC14456E1E1CADAA74183CDD2DAD4, test-key signed. Data: synthetic only (fixture `s301-fixture.bin`, an 8-chat hybrid library for the send rows, a local stub for embeddings and chat on 127.0.0.1:6310). Probes were bundled from the app's own sources outside the tree (scratch) and injected over CDP; no application code was written.

Phone state: battery 34.8 C at the start of D-301-SAVE (above the 34.0 C cap), cooled screen-off to 33.4 C before the windows, 33.3 C after. The CPU thermal zones are not readable without root, so the CPU-zone half of the dual gate was not checked (a gap). The note9 lease was held and released; the end census is clean (needsReset false for this phone).

Every result below is one device and the n stated; verdicts are conservative.

## Row 1: #931 measurements

| # | Measurement | Result (raw) | Verdict |
|---|---|---|---|
| 1 | First-save CPU split, 2 MiB buffer, 3 runs | TextEncoder cold 7.3/14.4/9.4 ms, warm median 6.8 ms; crc32 cold 9.8/12.5/10.6, warm 7.1; app JS Sha256 cold 31.1/27.5/27.5, warm 18.2. crypto.subtle.digest SHA-256 wall median 11.6 ms (first 16 ms); secure context true (origin http://tauri.localhost) | Per 2 MiB the JS Sha256 is ~18 ms and TextEncoder+crc32 ~14 ms; none is a 50 ms task alone. SubtleCrypto exists but is not much faster in wall time (11.6 vs 18.2). Drop as a speed candidate; keep only as an off-main-thread candidate |
| 1b | postMessage to a module worker, 2 MiB | spawn + first ping 43.9 ms; structured clone of a buffer median 4.7 ms; transfer 1.2 ms; string 5.7 ms | Cheap; a worker costs ~44 ms once |
| 2 | bytesToBase64 vs invoke | bytesToBase64 per 1 MiB: first 79.7 ms, median 4.0, p95 10.3, max 12.6 (n=30); native `Uint8Array.prototype.toBase64` is present. invoke round trip (missing command): 16 B median 10.0 ms (p95 17.9); 1 MiB (1.40 M base64 chars) median 192.4 ms (p95 212.3, n=15) | The encode is ~2% of the invoke cost; the ~190 ms per MiB is bridge string transport. Drop base64 tuning; payload size is the lever |
| 3 | Cold first send, hybrid | index 277-396 ms, rank 1.6-2.7, pack 32-59, room 0.5-1.0, rebuildCause fresh on all 10 sends (see row 3 below) | DenseStatus.queryMs over ~20 sends: NOT RUN (the phone library held 8 synthetic chats) |
| 4 | Argon2id main vs module worker (hash-wasm, p=1) | 128 MiB, t=3: main 1016/799/845 ms, worker 980/802/852; main-thread gap while hashing on main 0 to 949.7 ms (two runs 949.7 and 833.6, the others read 0 because the timer tick was starved), worker keeps main gaps 10-28 ms. 512 MiB, t=1: worker 1403.6 ms (gap 43), main 1443.4 (gap 1495). 1 GiB, t=1: worker 3902.8 ms (gap 2771), main 2708.3 (gap 2734) | 128 and 512 MiB run in a worker without error and leave the UI unblocked: worth a ticket for a worker KDF. 1 GiB in a worker was slower and still showed a 2.77 s main gap; do not raise defaults above 512 MiB on this device without a separate check |
| 5 | WebView feature probes | OffscreenCanvas and createImageBitmap present; in a module worker OffscreenCanvas function, createImageBitmap ok, WebAssembly ok, crypto.subtle object; crossOriginIsolated false, SharedArrayBuffer undefined. convertToBlob(64x64): webp 34.7 ms, png 4013.8 ms, jpeg 4022.6 ms (same on a second run) | Worker image, wasm and crypto routes are all available. The png/jpeg ~4 s convertToBlob is reproducible; cause not isolated. Worth a measurement ticket before any png/jpeg worker path |

Not run: ExportWriteCall encodeMs/waitMs (needs the SAF save dialog, a person), the sub-step marks in checkNewFormat/previousOfTree (optional, needs a build with extra marks), the png/jpeg cross-check against canvas.toBlob.

## Row 2: D-301-SAVE (#301), staged save pass, n=1

Recipe: `Agents/Findings-2026-11-28-large-save-301.md`, fixture `s301-fixture.bin`, windows E (type `2` in the Mood key, wait 36 s), A (Back to the list), U (Update all), N (Undo all), CDP Tracing, `summ301.mjs`. The driver variant skipped the reload and the viewport override (the phone Studio rendered its tree and detail panes as is); the Studio was reached through Home, Simple list, "Open in Studio". The Studio switch is a device-local feature switch (`localStorage['risuStudio.enabled']='1'`, set over CDP), not saved data.

| Window | Longest task (ms) | First cluster | Painted marker |
|---|---|---|---|
| E (edit) | 130.4 | max 82.5 | typed 135 ms |
| A (Back to list) | 207 | 91.7 | uses painted 468 ms |
| U (Update all) | 192.5 | 192.5 (sum 281) | painted 374 ms |
| N (Undo all) | 207 | 207 (sum 236) | painted 317 ms |

Target below 200 ms per edit and per Undo all: E passes (130 ms); N misses by 7 ms on one run, so it is inconclusive. Caveats: n=1 where the recipe asks for up to 5 cold runs; an aborted earlier launch had already typed `2`, which I reversed through the same key field and saved before this pass; the traces contain follow-up clusters inside the idle wait (up to ~120 ms). Owed: n of 2 to 5 cold launches.

## Row 3: #930 prefetch A/B, n=5 pairs

Hybrid send on a 4 810-unit index with stub embeddings. "late" sends 16.4 s after launch (prefetch finished), "imm" sends 6.4 s after launch while `chromemory-vector-load` (6.0 to 10.2 s long) is still running.

| Arm | risu:chromemory ms (5 sends) | index ms |
|---|---|---|
| late | 689, 743, 2498, 2634, 2294 (median 2294) | 381, 353, 291, 309, 278 |
| imm | 3084, 3230, 3267, 3167, 3215 (median 3215) | 304, 290, 396, 291, 320 |

A send that arrives while the load is in flight pays ~0.9 s more at the median, but late1 and late2 took 0.7 s and late3 to late5 took 2.3 to 2.6 s with the same index timing, so the spread is not explained by the prefetch alone. A true no-prefetch base build was NOT run (both arms used the same APK). Verdict: inconclusive. The #885 IPC/file/JS split of the vector load: NOT RUN.

## Rows owed / not run

Row 4 (#156 off-switch, PR #934), the #193 baseline (cold 1000-character grid long-task trace, worker PSS, plain-HTTP base64 path) and the #508 cells (true cold start, noshelf and 500-cell fixtures, #881 delta, two synthetic V3 plugins) are NOT RUN. The maintainer rule of this day moves device driving to one device-runner subagent per device; these rows go to that dispatch with this file as input.

## Per-candidate verdicts (async study)

- Off-thread hash of saved bytes: keep as a candidate, not a speed win (JS Sha256 ~18 ms per 2 MiB).
- bytesToBase64 optimisation: drop (4 ms per MiB against ~190 ms per MiB of bridge cost).
- Argon2id in a module worker at the 128 MiB default: worth a ticket; above 512 MiB hold.
- png/jpeg convertToBlob: worth a measurement ticket first (4 s anomaly).
- #193: no baseline taken, no verdict. #508: no cells taken, no verdict.

## Incidents

- Pressing Back twice quit the app and two stray taps landed on the launcher's empty home screen; no data impact.
- A tap in the chat sidebar created an empty "New Chat 2" in the synthetic library; no data impact beyond that synthetic chat.
- A first launch of the 301 driver was detached from its shell and left a stale CDP trace session; the app was relaunched.
- The build was started with a hidden process; mitigated by a background waiter.
