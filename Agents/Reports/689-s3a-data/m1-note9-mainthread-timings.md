STATUS: COMPLETE WITH DEVIATIONS (measurement on 2 devices; 5000-message runs not done, b50 runs stalled for heavy models; see Caveats)

# LTM M1: on-device embedding measurements, Galaxy Note 9 spares (2026-10-30)

## Summary
- Everything ran single-threaded on the WebView main thread (no cross-origin isolation, no SharedArrayBuffer, so ORT-web uses 1 wasm thread; app sets no thread/proxy options). Every inference blocks the UI.
- Single short message (~52 chars): MiniLM 85-91 ms median, multiMiniLM 103-106 ms, bgeSmallEn 165 ms, nomic ~800 ms, bge-m3 / bge-m3-ko ~1.2 s (p95 2.6 s). The two phones agree within ~7% on the shared models.
- Bulk (1000 realistic messages, avg 210 chars, 40% Korean): batch size 1 is 3-4x faster than the app's chunk of 50 for the small models, and batch 50 does not finish at all for nomic and bge-m3 (see below). Best case MiniLM batch 1: 2.6-2.7 msg/s, i.e. 1000 messages in ~6 min; multiMiniLM 2.3-2.4 msg/s (~7 min); bgeSmallEn 1.29 msg/s (~13 min); nomic 0.27 msg/s and bge-m3 / bge-m3-ko 0.18 msg/s (cap hit after 20 min with 215-323 of 1000).
- Batch 50 freezes the UI for 60-190 s per batch (rAF max gap 85-192 s); batch 1 gives ~2.7-5.8 fps with worst frame gaps 2-5 s (heavy models 24-25 s).
- Memory is the limiting factor for batch 50: renderer RSS reached 1.6-2.2 GB with a 2 GB swap exhausted on phone 1 (SwapFree 508 kB, MemAvailable 733 MB captured during the stuck nomic batch), and the nomic and bge-m3 first 50-message batch did not finish in 48-50 min.
- Brute-force cosine search is cheap: 20k x 1024 = ~37 ms, 20k x 384 = ~14 ms (median).

## Setup
- Base: main eedeb4c1a, read-only; no repo writes. Scratch only under C:\Users\yor42\AppData\Local\Temp\risu-b715\ltm\m1\.
- App read: src/ts/process/transformers.ts: pipeline('feature-extraction', model, {dtype:'q8', device:'wasm'}), env.useCustomCache with Cache API, localModelPath, allowLocalModels, extractor(texts, {pooling:'mean', normalize:true}); no numThreads/proxy/wasmPaths set. hypamemory.ts localModels ids as in the brief; the app passes its chunk of 50 per call.
- Package: io.github.yor42.risutanium 0.1.0 (versionCode 1000). Phone 1: debuggable APK already installed (lastUpdate 2026-10-30 15:38). Phone 2 had a RELEASE-signed build 0.1.0 (signature e3e3907b, v3, not debuggable): I uninstalled it (spare, no personal data) and installed app-debug-d2ff459b0.apk (sha256 BEAB65E184DC50D6514238F1702F6DDF107D81FAA3EFBBCA27B1AD246A6B2B5B) so CDP attach works. At cleanup I ran `pm clear` on phone 2 (app data created by me); phone 2 now has the debug build, not the release build.
- Devices: SM-N960N Android 10, Exynos 9810 8 cores, 5.6 GB RAM (about 3 GB free at start, 2 GB swap), WebView com.google.android.webview 156.0.8078.47 (Chrome/156, V8 15.6), both. Origin http://tauri.localhost; crossOriginIsolated=false, SharedArrayBuffer undefined, hardwareConcurrency=8, deviceMemory=4, ORT numThreads default (1 without isolation), proxy=false.
- transformers.js 3.8.1 (installed repo version 3.8.1 matches package ^3.8.1); loaded as the self-contained dist/transformers.js from npm 3.8.1 (bundled ORT 1.22.0-dev.20250409, the same ORT version the repo resolves via transformers' dependency). Deviation: the app uses the transformers.web.js build through Vite with a bundled onnxruntime-web; I used the standalone dist and set env.backends.onnx.wasm.wasmPaths to the local server (the app's wasm path resolution was not verified).
- Models: Hugging Face (huggingface.co only, PC side) q8 files = onnx/model_quantized.onnx + config/tokenizer, served from a local Node server through `adb reverse` (phone 1 port 6271, CDP 6270; phone 2 port 6291, CDP 6290). env.allowRemoteModels=false, localModelPath=local server, custom Cache API cache cleared before each cold load. No RisuAI/RisuRealm server contact. Transfer over USB reverse ran 7-31 MB/s (the 7 MB/s outlier is a single run; unexplained).
- Wi-Fi off on both for the whole run (before: `Wi-Fi is disabled`, wifi_on=0; after: same). Screen kept on (`svc power stayon true`), app focused, visibilityState=visible. Both phones were on USB power at battery level 100 throughout (see caveats).
- Data: synthetic, seeded (mulberry32) mixed English/Korean 20-400 chars, 40% Korean, 20% of those mixed; bench module at srv\bench.js.
- Processes: my servers/runners/forwards were stopped and removed (see Cleanup).

## Results, phone 1 (29f3cde9193f7ece, debug APK from the start)
Times in ms unless stated. Cold load = whole `pipeline()` including transfer; warm = same from Cache API after dispose.

| Model | file MB | transfer (separate) | cold load | warm load | 1-msg latency median / p95 (dim) | 1000 msgs batch 1 | 1000 msgs batch 50 |
|---|---|---|---|---|---|---|---|
| MiniLM | 23.0 | 741 ms | 4,064 | 651 | 91 / 260 (384) | 1000 done in 379 s = 2.64 msg/s; batch median 177 ms, p95 1,229 | capped: 800 done in 1,217 s = 0.66 msg/s; 50-batch median 69 s, p95 111 s |
| multiMiniLM | 118.3 | 16,376 ms | 23,047 | 3,276 | 106 / 213 (384) | 1000 done in 423 s = 2.36 msg/s; median 320, p95 1,022 | 1000 done in 1,240 s = 0.81 msg/s; 50-batch median 58 s, p95 94 s |
| bgeSmallEn | 34.0 | 2,532 ms | 5,067 | 590 | 165 / 447 (384) | 1000 done in 773 s = 1.29 msg/s; median 363, p95 2,853 | capped: 400 done in 1,314 s = 0.30 msg/s; 50-batch median 183 s |
| nomic | 137.3 | 13,928 ms (4,277 on 2nd) | 17,581 (9,497 on 2nd) | 1,107 | 822 / 2,162 (768); 2nd run 788 / 2,197 | capped: 323 of 1000 in 1,206 s = 0.27 msg/s; median 1,877 ms, p95 13,152 | NOT FINISHED: first 50-message batch running after 50 min (done=0); aborted by page reload |

Resource and responsiveness (phone 1; renderer = WebView sandboxed process, /proc VmRSS, VmHWM is process lifetime peak; battery temp in 0.1 C):

| Run | UI during run | JS heap used after (bytes) | renderer RSS before -> after (MB) | temp before -> after |
|---|---|---|---|---|
| MiniLM b50 | rAF 0.02 fps, max gap 110.9 s, timer lateness 155 s | 188 M | 323 -> 1,612 (HWM 1,818) | 28.4 -> 35.8 C |
| MiniLM b1 | 5.64 fps, max gap 2.6 s | 188 M | 1,618 -> 1,729 | 34.7 -> 35.9 |
| multiMiniLM b50 | 0.03 fps, max gap 94 s | 167 M | 666 -> 1,044 | 34.5 -> 37.1 |
| multiMiniLM b1 | 5.05 fps, max gap 1.9 s | 167 M | 1,103 -> 1,009 | 35.8 -> 36.8 |
| bgeSmallEn b50 | 0.01 fps, max gap 191.9 s | 225 M | 1,015 -> 2,175 (HWM 2,369) | 34.7 -> 37.0 |
| bgeSmallEn b1 | 2.74 fps, max gap 5.1 s | 225 M | 2,210 -> 1,511; SwapFree dropped to 29 MB | 35.6 -> 36.7 |
| nomic b1 (2nd run) | 0.56 fps, max gap 24.4 s | 53.5 M | 566 -> 525; HWM 3,248 | 33.2 -> 36.1 |

`dumpsys meminfo` TOTAL PSS lines were not captured (parser matched nothing, raw text saved in the jsonl `rendererMeminfo` fields: Native Heap etc.). VmRSS/VmHWM from /proc are the memory numbers.

## Results, phone 2 (2ac80128013f7ece, debug APK installed by me)

| Model | file MB | transfer | cold load | warm load | 1-msg latency median / p95 (dim) | 1000 msgs batch 1 | 1000 msgs batch 50 |
|---|---|---|---|---|---|---|---|
| MiniLM | 23.0 | 819 ms | 4,491 | 601 | 85 / 261 (384) | 1000 done in 369 s = 2.71 msg/s; median 166, p95 1,222 | capped: 800 done in 1,227 s = 0.65 msg/s; 50-batch median 74 s, p95 105 s |
| multiMiniLM | 118.3 | 3,857 ms | 10,544 | 3,805 | 103 / 222 (384) | 1000 done in 433 s = 2.31 msg/s; median 329, p95 1,068 | 1000 done in 1,229 s = 0.81 msg/s; 50-batch median 61 s, p95 85 s |
| bge-m3 (Xenova) | 569.7 | 17,618 ms | 31,422 (30.7-33.4 s over 3 loads) | 5,793-6,669 | 1,237 / 2,590 (1024); repeats 1,224-1,336 | capped: 215 of 1000 in 1,203 s = 0.18 msg/s; median 4,545 ms, p95 15,086 | NOT FINISHED: first 50-message batch running after 48 min (done=0); aborted by page reload |
| bge-m3-ko (HyperBlaze) | 569.7 | 17,458 ms | 29,378 | 4,706 | 1,238 / 2,572 (1024) | capped: 214 of 1000 in 1,208 s = 0.18 msg/s; median 4,422 ms, p95 12,379 | not run (same stall expected; not tested) |

| Run | UI during run | JS heap used after | renderer RSS (MB) | temp |
|---|---|---|---|---|
| MiniLM b50 | 0.02 fps, max gap 104.9 s | 148 M | 359 -> 1,625 (HWM 1,832) | 28.0 -> 36.1 |
| MiniLM b1 | 5.77 fps, max gap 2.6 s | 148 M | 1,629 -> 1,753 | 34.9 -> 36.4 |
| multiMiniLM b50 | 0.03 fps, max gap 84.9 s | 199 M | 711 -> 1,019 | 34.9 -> 37.6 |
| multiMiniLM b1 | 4.85 fps, max gap 2.1 s | 199 M | 1,052 -> 1,074 | 36.5 -> 37.4 |
| bge-m3 after load | - | 703 M after load | 2,262 (HWM 2,855) after load (first attempt, valid pid) | 36.0 |
| bge-m3 b1 | 0.37 fps, max gap 25.2 s | 139 M | not reliable (see caveats) | 33.7 -> 37.2 |
| bge-m3-ko b1 | 0.38 fps, max gap 23.8 s | 116 M | after load 2,291 (HWM 3,216); after run 1,448 | 35.8 -> 38.0 |

Stuck-batch evidence (phone 1, nomic batch 50, 50 min, logs\p1-nomic-stuck-snapshot.txt): renderer RSS 1.9 GB, SwapFree 508 kB of 2,097,148 kB, MemAvailable 733 MB, app process at 97% CPU, 800% CPU line showed 131% sys. This is consistent with memory pressure and swap exhaustion, but the code-side mechanism (activation size for 50 x up to ~400 tokens) was not isolated; no heap or allocation profile was taken. bge-m3 on phone 2 had MemAvailable 1.4-1.9 GB and swap 0.45-0.67 GB free at its stall, so memory pressure there is less clear-cut and the cause of the stall is UNCERTAIN (it may simply be extreme slowness: 50 messages at the b1 rate of 4.5 s would be ~4 min if linear, so padding or memory behavior is superlinear).

## Brute-force cosine search (same WebView, Float32Array, normalized random vectors, dot product + top-10; median / p95 ms over 24 timed reps after 6 warm-ups; timer resolution 0.1 ms)

| N x dim | phone 1 median / p95 | phone 2 median / p95 |
|---|---|---|
| 1,000 x 384 | 1.7 / 7.9 | 1.7 / 7.9 |
| 5,000 x 384 | 5.6 / 6.8 | 3.8 / 20.3 |
| 20,000 x 384 | 13.8 / 24.7 | 13.5 / 14.2 |
| 1,000 x 1024 | 1.7 / 2.3 | 1.7 / 2.3 |
| 5,000 x 1024 | 9.7 / 16.3 | 9.3 / 9.7 |
| 20,000 x 1024 | 37.6 / 45.3 | 37.3 / 45.4 |

Vector memory for 20k x 1024 float32 is 82 MB. Small-N values are dominated by JIT/timer noise (1,000 x 384 equals 1,000 x 1024 at 1.7 ms).

## Cross-check
MiniLM and multiMiniLM agree between phones within 7% on latency and 2-8% on bulk throughput, so the two spares are comparable. Phone 1 ran hotter and under more swap/memory pressure by the time of bgeSmallEn and nomic.

## Deviations from the brief
1. 5,000-message runs were not completed. MiniLM: the runner's skip rule had a bug that started 5000 b50 (stopped by me, runner killed, no result); other models: rule skipped 5000 because the 1000 run took more than 300 s or aborted at the 20-minute cap. Extrapolation, not measurement: MiniLM b1 5,000 would be ~32 min, multiMiniLM b1 ~36 min; no model would meet 5,000 within the 20-minute cap except none.
2. Batch 50 for nomic (phone 1) and bge-m3 (phone 2) was stopped after ~50 min with no finished batch; bge-m3-ko batch 50 was not attempted. Batch 1 runs for those models were capped at 20 min with partial counts.
3. Standalone transformers.js dist instead of the app's Vite-bundled web build (same version, same bundled ORT version).
4. Battery drain not measurable (USB powered at level 100). `current_now` was not readable (empty). Battery temperature, level and the thermal state (28 C idle -> 36-38 C under load) are recorded in every snapshot. Phone 1 reached 37.0 C during b50 runs.
5. PSS from dumpsys not parsed (raw text saved); VmRSS/VmHWM used instead. After the page was reloaded on phone 2 the process-id lookup (first `sandboxed_process` in `ps`) probably picked a different sandboxed process, so phone 2 RSS values for bge-m3 b1 and some post-reload snapshots (rss ~17-57 MB) are invalid and omitted above.
6. Records on phone 2 with `bulk: 1000_b` / `1_b` (bge-m3) are from a runner parameter bug and carry no data; bge-m3 and nomic loads/latencies were repeated after restarts (both results listed).
7. Page reloads (to abort a stuck batch) happened for phone 1 once (nomic) and phone 2 twice; heavy models were re-measured after fresh reload with cache cleared before each cold load.

## Caveats
- Note 9 is the project's low-end floor, Exynos 9810 with 5.6 GB RAM and Android 10; numbers are this device (and its twin) only, wasm single-thread q8, on main thread, USB-powered, screen on. A Pi or desktop is not represented.
- Thermal throttling is likely in the long runs (temperature up to 38 C battery sensor); I did not measure CPU frequency, so throttling contribution is UNCERTAIN.
- Bulk throughput depends strongly on batch composition: batch 50 pads every sequence to the longest in the batch (up to ~400 chars) and Korean text under English-vocabulary models (MiniLM, bgeSmallEn, nomic) tokenizes into many more tokens than under the multilingual tokenizers. I did not measure token counts; this explanation for multiMiniLM batch 50 being faster than MiniLM is a hypothesis.
- Memory behavior: renderer RSS grows to 1.6-2.4 GB on b50 runs with a MiniLM-class model, HWM 3.3 GB after nomic/bge-m3 on the same process; WebView renderer is subject to Android low-memory kills and was not killed here, but swap was exhausted on phone 1.
- Dim, quality or retrieval accuracy not evaluated. The app's own call path (hypamemory chunk logic, withInFlight wrappers, console.log of every result at transformers.ts runEmbeddingUntracked, which logs the texts and Float32 data per call) was not run; console.log overhead and any devtools attachment effect are included/excluded unknown. CDP was attached to the page during all runs.
- Single run per cell (no repeats except the loads noted); no confidence intervals beyond median/p95 within each run.

## Raw logs (all under C:\Users\yor42\AppData\Local\Temp\risu-b715\ltm\m1\)
- logs\p1.jsonl, logs\p2.jsonl: every record (loads, latencies, bulk results, snapshots with battery/mem/thermal), including notes about restarts.
- logs\summary.txt: parsed summary of the above (this file's tables were built from it).
- logs\p1-search.json, logs\p2-search.json, logs\p2-env.json
- logs\p1-nomic-stuck-snapshot.txt
- logs\srv1.log, logs\srv2.log (server request logs; no 404s)
- logs\p1.out, p1b.out, p1c.out, p2.out, p2b.out, p2c.out, p2d.out (runner console output)
- Tooling: srv\bench.js (benchmark module), server.js, run.ps1, npm\cdp.js; models in srv\models\ (1.5 GB, deletable).

## Cleanup
- Removed `adb forward` 6270/6290 and `adb reverse` 6271/6291; stopped my two Node servers and runner PowerShell processes (PIDs recorded in srv1.pid, srv2.pid, run1.pid, run2.pid); ports 6270-6279 / 6290-6299 show only TIME_WAIT sockets.
- Deleted the m1cache Cache API entry on both phones; `svc power stayon false` set on both; both apps force-stopped; phone 2 `pm clear` (app data created by me); phone 1 app data left (was already a debug install).
- Wi-Fi remained disabled on both (wifi_on 0 before and after). Phone 2 had its release-signed build uninstalled and replaced by the debug APK (recorded above); the maintainer must reinstall the release build if wanted there.
- Not touched: R54WA00L3WH, any other device. No RisuAI/RisuRealm contact. Many unrelated node/pwsh processes appeared on the host during the run; I did not touch them.
