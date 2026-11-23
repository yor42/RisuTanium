# ChroMemory S3a: local embedding spike on the Note 9 WebView (#689, CHORE-620 measurement)

Date: 2026-11-23. Verdict: **PASS** for `Xenova/multilingual-e5-small` (q8). Phones get the local fallback (spec section 10; MC-2592, MC-2656). The default model was chosen by the maintainer: MC-4020.

## What was measured

- Device: Galaxy Note 9 phone 1 (SM-N960N, Android 10), WebView Chrome/156.0.8078.47, the installed debug build of the app (origin `http://tauri.localhost`, APK SHA-256 `beab65e1...6b2b5b`, source revision d2ff459b0). Wi-Fi off, USB power, screen kept on, battery 29 to 36 C.
- Method: the harness in `Agents/Tools/ltm-embed-spike/` loads transformers.js 3.8.1 (self-contained dist, q8, mean pooling, normalized) inside a module Worker created from a blob in that page. `crossOriginIsolated` is false, so ONNX runs one wasm thread. Texts are synthetic (40 percent Korean 160 to 200 characters, 60 percent English 50 to 70 words). Main-thread tasks come from a `longtask` PerformanceObserver (entries exist only above 50 ms), cross-checked with rAF and 50 ms timer lateness. Renderer memory is the sandboxed WebView process column of `pss-sampler.ps1` (PSS, 1 s samples) against the median before the driver started.
- Weights: Hugging Face q8 ONNX files already approved for download in MC-2176 (e5-small 118,308,185 bytes; paraphrase-multilingual-MiniLM-L12-v2 118,308,126; all-MiniLM-L6-v2 22,972,370), served from the PC through `adb reverse`.
- Raw results and the two runner logs: `Agents/Reports/689-s3a-data/`.

## Results, 200 messages per run

| Model (batch) | Load ms | Messages/s | Call ms p50 / max | Long tasks over 50 ms (load, index) | Renderer baseline, peak, difference (MiB) |
|---|---|---|---|---|---|
| multilingual-e5-small (1) | 9598 | 2.15 | 446 / 841 | 0, 0 | 111.9, 974.6, +862.8 |
| multilingual-e5-small (8) | 9777 | 1.68 | 4799 / 5969 | 0, 0 | 112.6, 970.0, +857.3 |
| paraphrase-multilingual-MiniLM-L12-v2 (8) | 9549 | 1.66 | 4951 / 5933 | 0, 0 | 113.3, 949.4, +836.1 |
| all-MiniLM-L6-v2 (8) | 4503 | 1.32 | 6434 / 7395 | 0, 0 | 113.6, 569.2, +455.6 |

## Confirmation run, 1000 messages, multilingual-e5-small, batch 1

| Measure | Value | Bar |
|---|---|---|
| Messages indexed | 1000 of 1000 in 486.7 s (2.05 per second; call p50 466 ms, p90 638 ms, max 847 ms) | at least 1 per second: met |
| Long tasks over 50 ms during load and index | 0 and 0 | none from embedding: met |
| Renderer peak above baseline | baseline 111.4 MiB, peak 981.0 MiB at +32.7 s (model load), difference +869.6 MiB | at most 1500 MiB: met |
| Renderer memory over the run | 25 percent 622.9, 50 percent 574.9, 75 percent 578.8, end 581.6 MiB | no growth after load |
| Renderer loss | none: page session id unchanged, no worker error, CDP target stayed | none: met |
| Battery temperature | 33.9 C before, 35.8 C after | |

## Reading

- The peak comes from loading the model (about +870 MiB); once indexing runs the renderer settles near 580 MiB, about +470 MiB over baseline. No growth over 1000 messages.
- Batch 1 is faster than batch 8 on the phone (2.15 against 1.68 messages per second), so the phone path indexes one message per call. This matches the M1 finding for the main-thread path.
- Timer lateness of 77.8 ms and an rAF gap of 112.6 ms appeared once in the 1000-message index phase; the long-task API reported no task over 50 ms. These monitors share the main thread, so a gap can also come from system scheduling or the app's own work; the harness cannot attribute it. One 273 to 291 ms long task appears in the idle baseline of every run, before any embedding starts, so it is app activity.
- Korean quality is not measured on the phone. It comes from the PC synthetic set (`b61\orphan-ltm\c597-measure\result.md`, CHORE-621 quality check): e5-small Korean MRR 0.83 without prefixes, 0.86 with `query: ` and `passage: ` prefixes (within noise); paraphrase-multilingual-MiniLM 0.26; English-only models near zero.

## Limits

- One phone (phone 1), one WebView version, one wasm thread, synthetic text, 1000 messages at most, screen on with USB power. A long chat of many thousand messages, a hot phone or a background-restricted app were not tested.
- The memory figure is the sandboxed WebView process only, not the whole app or the system. Phone 2 was not used: it refused the pinned debug APK with a signer mismatch, and it may hold another ticket's state.
- The harness runs in the app's page but not through the app's own embedding code path (`runEmbedding` in `transformers.ts`). The production wiring (worker, model cache through the app's asset store, wasm paths from the bundle) belongs to S3.

## Follow-ups for S3

- Run local embedding in a worker, one message per call on phones, with e5 prefix handling decided in S3.
- The weights download once (about 113 MiB); S3 owns the source, cache and disk-space check.
