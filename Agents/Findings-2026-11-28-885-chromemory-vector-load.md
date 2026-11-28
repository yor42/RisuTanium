# #885 ChroMemory vector load: PC measurement (2026-11-28)

Base origin/main 2fe891359 (source), PC synthetic harness, no Note 9 data. Measurement report only; the budget ruling is MC-4761, the entry is MC-4762. The independent consequential-claim check of the numbers below is owed to the consuming decision (a fix ticket, if one is ruled).

STATUS: PARTIAL-COMPLETE. Source trace and PC measurement of the JS stages are done. IPC and file-read cost on the Note 9 is not measured.

# #885 chromemory-vector-load: where the time goes

## Summary
- PC total (JS stages, real functions, in-memory store): about 32 ms median at dim 1536 (4,802 units, 29.7 MB, 8 chunks). That is about 3% of the 1 s hard PC budget. The PC budget is met with a very large margin.
- Premise check: no "index build" stage exists in the load path. `importLoaded` only fills a Map of entries. The measure does not include the follow-up persist or the indexer.
- Premise check: dim 1536 and "about 18 MiB" do not match. 4,802 units x 1536 x 4 B is 29.5 MB (28.1 MiB). About 18 MiB corresponds to dim about 1024 (19.9 MB, 18.99 MiB). Confirm the real dim of the Note 9 run before the fix session.
- PC numbers are best case and are not Note 9 evidence. What dominates on the Note 9 is UNCERTAIN. A ratio argument (below) says the IPC and read path is likely the larger part. A Note 9 trace is needed to settle it.

## Scope and inputs
Worktree C:\Projects\RisuAI\.claude\worktrees\882-overlap, HEAD 3373bf2f9b1e14c2a16f938222bc5992e6a9393a. Dirty tree from the snapshot is not relevant to the files read. No repo file was edited.
Hardware: Intel Core i9-13900KF (24 cores), 63.8 GB RAM, Windows 11, node v24.19.0. Run through vitest 4.1.12 (`node node_modules/vitest/vitest.mjs run --config <scratch config>`, environment node).

## Load path (source trace, observation)
1. `startVectorLoad` in `shadow.ts` runs when a new `DenseStore` is created for a chat. It stamps `performance.now()`, calls `loadVectors(store)`, and on resolution emits `performance.measure('chromemory-vector-load')`.
2. `loadVectors` (`vectorPersist.ts`) awaits, in order:
   - a dynamic `import('src/ts/storage/store/appStore')` and `getAppStore()`. The first call also runs `selectStore()`.
   - `loadPersisted`: one `store.read(head)`, then for each of `head.chunks` one SEQUENTIAL `await store.read(chunkKey)`, followed by `decodeChunk`.
   - `source.importLoaded(...)`.
   In its `finally`, `requestPersist` and `drainRemembered` only enqueue work. They are not awaited, so they are outside the measure.
3. `tauriFilesStore.read` on Android and desktop calls `readRanged(key)` in `tauriByteTransport.ts`. `invoke(read_range)` returns a raw reply (piece plus a fixed trailer). `splitRangeReply` makes a subarray view. `ownBytes` in `guards.ts` then copies the bytes, because the view is over a larger buffer (it includes the trailer).
   - The piece size is 8 MiB on Android and 4 MiB on desktop, so each chunk (under 4 MiB) is a single invoke.
4. Chunk size: `unitsPerChunk(1536)` is 620, so 4,802 units make 8 chunks of about 3.8 MB each. Each chunk is read, copied by `ownBytes`, then copied again by `decodeChunk` (`data.set`). It is then scanned by `isFiniteVector` (every f32), and a `{key, ordinal, textHash, vec}` row is created per unit. `vec` is a subarray view over the copy.
5. Merge in `loadPersisted`: per row a key-string concat, a `{...r, seq}` spread, a `Map.set`, then `[...values()]`. `importLoaded` builds the `entries` Map and `Entry` objects. No vector is copied here.

Data sizes at dim 1536: 8 chunk reads of about 3.8 MB each (29.7 MB in total, 29.5 MB of it f32). There are 9 sequential IPC round trips including the head. The data is copied about 3 times in JS (IPC reply buffer, `ownBytes`, `decodeChunk`) on top of whatever the IPC itself copies.

## Measurements (execution, 15 runs per stage, in-process; "first" is the cold first run)
Dim 1536, 4,802 units, 8 chunks, 29,747,560 bytes (script `bench.test.ts`):

| Stage | median ms | min | max | first |
|---|---|---|---|---|
| (reference) disk read of the 8 chunk files, `readFileSync`, warm cache | 16.8 | 14.9 | 20.3 | 14.9 |
| `ownBytes` copy of the reply view | 7.5 | 5.2 | 12.8 | 6.4 |
| `decodeChunk` x 8 (data copy, finite scan, row objects) | 14.3 | 11.3 | 55.6 | 32.2 |
| of which JSON meta parse | 0.7 | 0.4 | 5.4 | 0.8 |
| Map merge (`byUnit`, spread, array) | 1.35 | 0.8 | 1.8 | 1.8 |
| `importLoaded` into `DenseStore` | 0.8 | 0.5 | 1.5 | 1.5 |
| `loadPersisted` whole (real function; store emulates the trailer view, so it includes `ownBytes`, excludes IPC and disk) | 33.3 | 28.0 | 72.3 | 72.3 |
| loadPersisted + importLoaded end to end | 32.1 | 27.0 | 69.5 | 69.5 |

Dim 1024 (19.9 MB, 6 chunks, closest to the issue's 18 MiB): `loadPersisted` median 24.5 ms (min 17.7, max 55.5). End to end 25.4 ms. `decodeChunk` median 10.6 ms, `ownBytes` 5.2 ms, merge 1.5 ms, import 0.85 ms.

Not measured: the real Tauri/Android IPC (`invoke` raw reply, Rust file read), store selection and dynamic import cost on first use, and main-thread contention with the send that runs at the same time.
Scratch artifacts, all under C:\Users\yor42\AppData\Local\Temp\risu-882-885-886\885\: `bench.test.ts`, `vitest.scratch.config.ts`, `out.json`, `out1024.json`, `chunks\`, `chunks1024\`.

## PC verdict
- Total about 32 ms at dim 1536 (cold first run about 70 ms), against the 1 s hard PC budget. This is under budget by about 30x (about 14x for the cold run). The IPC and disk read on a real desktop is not in these numbers. The file-read reference (about 17 ms) suggests it is of the same order, not 1 s. That is an inference, not a measurement.
- Dominant JS stages, in order: `decodeChunk` (about 14 ms: data copy plus the 7.4 M-element finite scan plus rows), then `ownBytes` (about 7.5 ms). Merge and import are about 2 ms together. No index build exists.

## Scaling argument for the Note 9 (inference, labelled)
- Observed 1,644 ms (run 1) and 1,598 ms (retry). The PC JS stages total about 25-33 ms. If the JS stages alone explained the Note 9 time, the Note 9 would need to be about 50x slower than the i9. Typical single-thread and memcpy-bound ratios between an Exynos 9810 WebView and a 13900KF are in the order of 5x to 15x (an estimate, not measured here). That would put the JS stages at about 0.15 to 0.5 s.
- So the remainder (about 1.1 s or more) most plausibly sits in the stages the PC harness cannot see: 9 sequential `invoke` round trips each moving about 3.8 MB through the Tauri raw reply path on Android, the Rust file read, and first-use store selection and the `appStore` dynamic import, plus main-thread contention with the send. Memory-bound stages (the two copies and the scan) scale with memory bandwidth, which is a worse ratio than compute on this device. The sandbox PSS growth of about 98.6 MiB across the load and send fits several 29 MB-scale copies being live.
- Settle it by logging, in a Note 9 build, `performance.now()` around each `store.read` (IPC), `decodeChunk`, and the merge, plus the time from `startVectorLoad` to the first `read`.

## Candidate levers (names and expected effect only; no recommendation)
- Avoid the `ownBytes` copy by taking the piece without the trailer (a trailer-free reply or a `slice` at the Rust side). Saves one full-size copy (about 7.5 ms on the PC; more on the phone).
- Make `decodeChunk` alias the read buffer when `dataAt` is 4-byte aligned instead of copying (the padding in the format makes it aligned). Saves one full-size copy (a part of the 14 ms) and about 29 MB of transient memory.
- Skip or defer the `isFiniteVector` scan (validate lazily or at write time). Saves one full pass over 7.4 M floats.
- Issue the chunk reads concurrently (`Promise.all`) so the IPC round trips overlap. Expected effect is large only if round-trip latency dominates (unmeasured).
- Load lazily, start before the send needs it, or load in part (newest chunks first). Does not shorten the load; removes it from the critical path.
- Reduce bytes: f16 or int8 storage would halve or quarter the transfer, but it changes the persisted format (a critical contract).

## Open items
- Real Note 9 per-stage timing (the observation named above).
- Confirm the dim and byte size of the Note 9 run (1536 and about 18 MiB cannot both be right).
- Whether the 1,644 ms includes first-use `getAppStore()` selection (depends on whether the store had already been selected when the load started).
