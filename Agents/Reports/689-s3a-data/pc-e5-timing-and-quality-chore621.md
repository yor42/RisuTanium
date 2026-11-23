STATUS: COMPLETE (measurement executed; caveats below)

## Summary
- Per-call time grows roughly linearly with batch size; per-text cost is flat or slightly worse above batch 8 (CPU, 1 thread). Total for 200 texts barely changes with batch size, so batching buys no throughput here, only longer blocked paint gaps.
- On this PC every batch <= 16 stays under 0.5 s per call (max over 3 reps); batch 50 reaches 0.7-1.1 s (Korean max 1.04-1.14 s). Largest batch with max call < 1 s on all cells: 16.
- Note 9 projection: batch 1 about 0.3 s per call (MiniLM-class, 16x ratio); batch 50 is 58-74 s per call measured in M1. No M1 data for e5-small or batches 2-16 (UNKNOWN; see below).
- Prefixes help multilingual-e5-small slightly (MRR +0.03 EN, +0.02 KO). R@5 unchanged EN, 94 to 91 KO (3 questions, noise).

## Method (execution, not reasoning)
- Scripts copied to this folder: time.mjs, quality.mjs (node_modules is a junction to the M2 install, @huggingface/transformers 3.8.1, onnxruntime-node, CPU, dtype q8, pooling mean, normalize). Models: Xenova/multilingual-e5-small (downloaded from huggingface.co) and Xenova/all-MiniLM-L6-v2 (copied from M2 cache). No risuai.xyz or Realm contact.
- Host: i9-13900KF, os.cpus() reports 32 logical cores (M2 result said 24; not reconciled), Windows 11, Node v24. Best-case hardware.
- Texts: 200 EN messages 50-70 words (mean 60.4) and 200 KO messages 160-200 chars (mean 184.5), taken from the M2 synthetic dataset. Warm-up 5 texts per language. Each batch size run 3 times over all 200 texts; "med" = median over the 3 per-rep call medians, "max" = max single call over 3 reps. Two thread configs: default (ORT intra-op threads = all cores) and 1 thread (closest to the phone WebView, which ran 1 wasm thread in M1).
- Raw: timing-*.json, time.log in this folder.

## Timing, 1 thread (ms per call: median / max; total seconds for 200 texts, median of 3)
| Model | Lang | b1 | b2 | b4 | b8 | b10 | b16 | b50 |
|---|---|---|---|---|---|---|---|---|
| e5-small | EN | 18/113; 4.3s | 27/78; 2.8s | 50/120; 2.7s | 95/223; 2.5s | 127/298; 2.9s | 208/314; 2.7s | 687/1075; 2.8s |
| e5-small | KO | 16/56; 3.7s | 24/66; 2.7s | 37/113; 2.0s | 74/144; 1.9s | 114/294; 2.3s | 166/294; 2.4s | 762/808; 3.0s |
| MiniLM | EN | 6/37; 1.5s | 10/53; 1.2s | 19/52; 1.0s | 35/87; 0.9s | 42/97; 0.9s | 70/126; 1.0s | 253/329; 1.0s |
| MiniLM | KO | 16/68; 3.7s | 32/91; 3.3s | 66/139; 3.3s | 152/277; 3.9s | 178/342; 3.7s | 260/427; 3.4s | 868/1135; 3.2s |

## Timing, default threads
| Model | Lang | b1 | b2 | b4 | b8 | b10 | b16 | b50 |
|---|---|---|---|---|---|---|---|---|
| e5-small | EN | 36/224; 8.9s | 71/395; 8.5s | 154/381; 8.2s | 276/537; 6.8s | 117/243; 2.5s | 168/361; 2.2s | 583/786; 2.0s |
| e5-small | KO | 14/48; 3.0s | 20/68; 2.1s | 36/134; 1.9s | 74/201; 2.0s | 78/158; 1.7s | 187/285; 2.5s | 629/1035; 2.4s |
| MiniLM | EN | 6/44; 1.7s | 12/46; 1.3s | 27/87; 1.4s | 48/116; 1.2s | 49/99; 1.1s | 72/197; 0.9s | 272/351; 1.0s |
| MiniLM | KO | 13/58; 3.1s | 25/71; 2.7s | 34/162; 1.9s | 84/178; 2.3s | 128/257; 2.6s | 210/454; 2.8s | 763/932; 3.0s |

Caveats: the e5-small default-thread EN row for b1-b8 (8-9 s totals vs 2-3 s elsewhere) looks like a slow first run (JIT/thread-pool warm-up or host noise; only 5 warm-up texts), not a property of batch size; it was not repeated. Default threads give no consistent gain over 1 thread at these sizes. Total/throughput differences of +-30% between configs are within run noise (no isolation from other host load was enforced, slot B).

## Per-call time and Note 9 projection
- M1 ratio (Note 9 vs PC): M1 measured MiniLM batch 1 median 177 ms per message (mixed 20-400 char text, avg 210 chars; 1 wasm thread); PC 1-thread MiniLM batch 1 median 6 ms EN / 16 ms KO. Ratio about 11-30x, consistent with the 10-30x brief figure. M1 multiMiniLM (same 12-layer 384-dim shape as e5-small, a proxy) batch 1 median 320 ms; PC e5-small b1 16-18 ms, ratio about 18-20x. Texts differ, so the ratio is approximate.
- Projected Note 9 per call: batch 1 about 0.3 s (e5-small, proxy). Batch 2-16: UNKNOWN (not measured on phone); linear scaling would give about 0.6 s (b2) to 5 s (b16), but M1 shows worse than linear at large batches.
- Batch 50 measured on Note 9 in M1: median 58-74 s per call (MiniLM 69 s, multiMiniLM 58 s), rAF max gap 85-192 s; per-text cost 3-4x the batch-1 cost, vs about 1-1.4x on the PC. So the PC ratio at b50 is 80-270x, not 10-30x (memory pressure; renderer RSS 1.6-2.2 GB, swap exhausted on phone 1).
- Batch size under 1 s per call: on the PC, max 16 (max call 0.46 s; 50 is borderline-over, up to 1.14 s). On the Note 9 (about 0.3 s per text at b1, superlinear growth), only batch 1 is expected under 1 s, batch 2-3 maybe; needs a phone measurement of e5-small b1/2/4.
- Yield between calls: required. One transformers.js call is synchronous with respect to the main thread in the WebView, so the longest per-call time equals the longest paint gap (M1: rAF max gap about equals the per-call time at b50; at b1 it was 2-5 s worst frame gaps, which is above the median call because of GC/layout between calls). A yield (macrotask or rAF) between calls is needed even at batch 1 to let the frame paint.

## Quality check (CHORE-621): multilingual-e5-small, synthetic M2 set only
Per-message index, query = original question wording, answerable questions only (n = 68 per language, 2 chats each), exact cosine, dtype q8, mean pooling, normalize, batches of 10. One synthetic set, small n: differences under about 0.1 are noise.
| Language | Setting | MRR | R@1 | R@5 |
|---|---|---:|---:|---:|
| EN | (a) no prefix | 0.839 | 74% | 97% |
| EN | (b) "query: " / "passage: " | 0.869 | 78% | 97% |
| KO | (a) no prefix | 0.832 | 75% | 94% |
| KO | (b) "query: " / "passage: " | 0.855 | 81% | 91% |
Reading: the prefixed variant gains 0.02-0.03 MRR and 4-6 points R@1, within the noise band; R@5 does not improve (KO -3 points = 2 questions). Not evidence of a significant effect. For reference, M2 ranked BM25 0.91/0.90 and bge-m3 0.92/0.80 on the same set (EN/KO MRR); e5-small (no prefix) at 0.84 EN / 0.83 KO is a usable multilingual option, between MiniLM (EN 0.81, KO 0.01) and bge-m3 on Korean.

## Open items
- Phone measurement of e5-small at batch 1, 2, 4 (and a yield between calls) is the missing observation for a safe on-device size.
- Re-run e5-small default-thread EN row if it matters.
- Processes: all my node jobs exited; the node_modules junction in this folder points at the M2 install (remove with rmdir only, not recursive).
