# ltm-embed-spike

Measures a transformers.js 3.8.1 embedding model running inside a module Worker in the installed app's WebView page
(origin `http://tauri.localhost`, debug APK, CDP over a forwarded devtools port). The harness never touches app code or
app storage: it evaluates a probe in the page, the page fetches the worker and model files from a local static server.

## Bars

| Bar | Where it is measured |
|---|---|
| No main-thread task over 50 ms caused by embedding | `phases.load` and `phases.index` long tasks versus `phases.idle-baseline` |
| Renderer peak at most 1.5 GB above baseline | not here: sampled separately (for example `dumpsys meminfo` by the runner) |
| No renderer loss | `rendererLost`, `pageSessionStable` |
| Indexing at least 1 message/s | `index.msgsPerSec` |

## Files

- `serve.mjs <root> <port> <logfile>`: static server on 127.0.0.1 with CORS `*`, `Cross-Origin-Resource-Policy: cross-origin`, `no-store`, wasm/mjs/js/json MIME, traversal refusal, 404s logged. `<root>` holds `transformers.js` (the self-contained dist build), the onnxruntime `.wasm`/`.mjs` files, `worker.mjs` and `models/<model id>/...`.
- `worker.mjs`: module worker. Posts only counts, timings and a checksum of the first vector, never vectors.
- `probe.js`: one IIFE expression for `cdp.mjs -f`; installs `window.__s3a` (idempotent) with `start`, `load`, `markPhase`, `runIndex`, `poll`, `snapshot`, `stop`.
- `run-spike.mjs`: Node driver; one `cdp.mjs` child (shell:false) per evaluation.
- `tests/self-test.mjs`: device-free check of the server and the probe (`node tests/self-test.mjs`).

## Run

1. Copy `worker.mjs` into the served root; start `node serve.mjs <root> 8765 <log>`.
2. `adb reverse tcp:8765 tcp:8765` and forward the WebView devtools socket to a local port (the device tooling in `Agents/Tools/device/`).
3. `node run-spike.mjs --port <cdp> --base http://127.0.0.1:8765 --model <id> --pooling mean|cls --count 200 --batch 8 --out <result.json> [--idle-seconds 20]`
4. In parallel, sample renderer memory with the separate tool; compare peak against the idle-baseline reading.

Options: `--dtype` (default `q8`), `--seed`, `--load-timeout-s`, `--index-timeout-s`, `--cdp <cdp.mjs path>`.

## Result fields

- `rendererLost`, `lostReason`: the CDP target vanished, the probe disappeared (reload) or five evaluations in a row failed. The run then exits 1; the file is still written.
- `pageSessionIds`, `pageSessionStable`: random id fixed when the probe installs; a change means the page reloaded.
- `constructError`: set when `new Worker` threw (a CSP block shows here, never hidden) or `worker.mjs` could not be fetched.
- `loadMs`, `dims`: model load time inside the worker and the output dimensions.
- `index`: `done`, `totalMs`, `msgsPerSec`, `callMs` percentiles (`p50`, `p90`, `p99`, `max`, per embed call), `error`.
- `phases.<idle-baseline|load|index>`: `durationMs`; `longtask` (`count`, `totalMs`, `maxMs`, `over50`); `rafMaxGapMs`, `rafGapsOver100`; `intervalMaxLatenessMs`, `intervalOver50` (a 50 ms timer).
- `snapshot`: worst 30 long tasks (`start`, `duration`), `workerAlive`, `workerErrors`, `memory.usedJSHeapSize`, `deviceMemory`, `hardwareConcurrency`, `crossOriginIsolated`, `sharedArrayBuffer`, `userAgent`, `checksums` (first vector sums, for cross-run comparison).
- `bars`: the numbers the bars read, with `rendererPeakWithin1p5GB` left null for the memory tool to fill.
- `errors`: tolerated evaluation failures (timeouts) seen while polling.

## Limits

Note 9 only; results depend on the installed Android System WebView version (long-task support, SharedArrayBuffer and
`crossOriginIsolated` differ by version, and without isolation the wasm runtime stays single-threaded). Timer and rAF
monitors share the main thread they measure, so gaps are lower bounds. Synthetic text only.
