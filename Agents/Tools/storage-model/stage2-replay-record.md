# Stage 2 replay record (step 2f-7b part 2), perf-analyzer, 2026-10-17

**Accepted copy, written into the repository at the stage 2 records pass (2026-10-17).** It is the stage 4a+4b Gate 1 input named by the stage 2 replay plan. Provenance: the original is `C:\Users\yor42\AppData\Local\Temp\risu-b715\s2\replay-record.md` (57,090 bytes, SHA-256 `A27B9799B0F0A19B570650226B2D604B6A2180F014758E57244035A781A6D8D4`; a `.txt` copy of the same size sits in the same folder). Sections 0 to 10 are that record with only these edits: line endings normalised to LF (the original mixed 212 CRLF and 233 LF), this note, the reworded introduction to the SHA-256 list in section 8, and dated "Update 2026-10-17" notes where a later step changed a statement (the original sentence is kept next to each note). Sections 11 to 16 are new and are drawn from the later step reports and verdicts named in them. Scratch paths (`l7-*`, `f7*`, `g7*`, `risu-b715\...`) are provenance and do not exist in the repository. **The runner tools are now in `Agents/Tools/storage-model/replay-tools/`** (copied at records time by another agent, per the final Gate 2 finding 1; the mapping from the scratch file names used below to the file names there, the drops and the files not carried are in section 8.1). The application code and tests under test are in `src/ts/storage/store2/` and `src/ts/storage/tests/store2/` on `main` (`b7bbd2521`; tree identical to `25e57bb57`).

Labels: MEASURED = a number read from a result file, log or an executed command; OBSERVED = seen directly in a log or trace; INFERRED = reading, not shown. Nothing in the repository was written by this step; all new files are `s2\l7r-*` plus this record, under `C:\Users\yor42\AppData\Local\Temp\risu-b715\s2\`.

## 0. Scope and code under test

- Worktree `C:\Projects\RisuAI\.claude\worktrees\alite-s2`, branch `feat/alite-s2`.
- Long PCT runs (78 pairs), library, server and live mutants, the 1 h live run, the E1-1 follow-up: HEAD `f0895733a`, clean under `src/ts/storage` and `server` (every pair's result JSON `code` field: `head f0895733a`, `dirty []`; MEASURED, all 78).
- The R17g/Tauri checker fix: HEAD `816eec012` (`f0895733a` plus `checker.ts` and `checker.test.ts` only; `git diff --stat f0895733a 816eec012`: 2 files, 60 insertions, 1 deletion; MEASURED). The long R17g/Tauri run itself was NOT repeated under `816eec012`; the 5,178 flagged seeds were re-run under it (section 2).
- Host: i9-13900KF, 32 logical processors, 64 GB, Windows 11, node v24.19.0, vitest 4.1.11 (from the l7 part 1 report; node version re-checked now).
- Not evidence and excluded: the 13 `smoke*.json` files in `l7-out` (200 to 2,000 seeds; determinism and profiling probes, not part of the 78); `l7-mutant-table-aborted-*.md` and `l7-mutant-table-server-cwd-scratch.md` (runs with the process cwd outside the worktree, which lose test files to `Cannot find module '/vitest.setup.ts'`); the first live attempt (PID 42704, killed after 1 min). The cwd error touched only the vitest mutant runs. No PCT result predates it or is affected: PCT workers are started by the driver with `cwd` = worktree. So NO PCT run was excluded.

## 1. Region table: 78 region/backend pairs (MEASURED, from `l7-out\<region>-<backend>.json`)

Criterion (plan 2f-7): at least 20,000 runs AND at least 1 h elapsed with at least 8 workers. Result: **78 of 78 pairs met it** (script `l7r-sum.mjs`: `pairs 78 met 78`). Every pair: 8 workers, 8 incarnations (so no worker restart, no watchdog kill, no hang), elapsed 3,660 s (3,661 and 3,662 s for R8/node and R17f/node), 0 non-red failures (no `stalled`, `max-steps`, `threw`, `hang`, `driver-threw`; `l7-nonred` is empty). The 20,000-run floor was reached in a few minutes in every pair; the 1 h floor bound. Slowest pair: R18a2/indexeddb 183,915 runs; fastest: R17a/node 3,669,156.

Totals (MEASURED): 58,750,381 runs; 3,731,387,739 steps; 5,178 violations (all R17g/Tauri, section 2); 0 non-red. Per backend: node 29 pairs, 22,739,404 runs; tauri 31 pairs, 19,968,453 runs; indexeddb 18 pairs, 16,042,524 runs. Run kinds over all pairs: complete 46,852,936; crashed (a crash the fault plan injected: a normal outcome) 11,809,002; not-exercised 83,265 (R14/tauri 10,916 = 2.45 %, R18b/tauri 5,651 = 2.02 %, R18d/tauri 66,698 = 11.74 %; a normal declared outcome, counted; the reason for the R18d share was not investigated); violation 5,178. Worker CPU total 2,279,083,101 ms (about 633 h). Largest single run 835 ms (`maxRunMs`).

Seeds: each pair ran the stride seeds w+1, w+1+8, ... for worker w = 0..7, so the seed set is the contiguous prefix `1..N` (column "contiguous from 1") plus a short ragged tail up to the highest seed (the workers stop at slightly different points). "Distinct fp" is a HyperLogLog (2^16 registers) estimate of distinct canonical state fingerprints (2f-2a). It was validated on one case only: R1/node, 2,000 seeds, exact 290,444 vs estimate 291,268 (+0.28 %). Distinct fingerprints are 82 % of the steps on that 2,000-seed case; over the 78 full pairs the ratio of the distinct estimate to steps runs from about 0 % (R18i, single actor, tiny state space, millions of near-identical runs) through a median of 6.8 % to 58 % (R1/node), e.g. R1/indexeddb 5.86 M of 65.6 M steps and R17g/tauri 2.77 M of 40.9 M, so it is not a uniform coverage ratio; read it as an estimate of novelty per pair, not a coverage claim (MEASURED ratios). Fingerprints are not comparable across pairs (different rigs and raw-state shapes).

Concurrency (MEASURED, `l7-driver.log`): 2 pairs at a time (16 workers) from 12:12:48Z on 2026-10-15; raised to 3 pairs (24 workers) from 15:07:40Z (the R2/indexeddb start, `slot=2`). Queue ended 2026-10-16T15:41:10Z. Wall time of the queue: 27 h 28 min.


| pair | runs | seeds (contiguous from 1 / highest) | elapsed s | workers | steps | distinct fp (HLL est.) | violations | non-red | crashed / complete / not-exercised | met 20k runs AND 1 h AND 8 workers |
|---|---|---|---|---|---|---|---|---|---|---|
| R1/indexeddb | 599,380 | 596,911 / 602,854 | 3660 | 8 | 65,645,304 | 5,863,128 | 0 | 0 | 0 / 599,380 / 0 | yes |
| R1/node | 353,488 | 347,555 / 356,342 | 3660 | 8 | 62,585,802 | 36,305,907 | 0 | 0 | 0 / 353,488 / 0 | yes |
| R1/tauri | 323,628 | 318,092 / 327,209 | 3660 | 8 | 77,014,292 | 36,800,634 | 0 | 0 | 0 / 323,628 / 0 | yes |
| R2/indexeddb | 427,163 | 421,142 / 431,990 | 3660 | 8 | 48,321,458 | 2,173,188 | 0 | 0 | 214,444 / 212,719 / 0 | yes |
| R2/node | 400,311 | 396,787 / 404,264 | 3660 | 8 | 57,447,248 | 10,265,287 | 0 | 0 | 271,446 / 128,865 / 0 | yes |
| R2/tauri | 407,515 | 405,170 / 410,268 | 3660 | 8 | 69,042,832 | 7,650,102 | 0 | 0 | 243,183 / 164,332 / 0 | yes |
| R3/indexeddb | 370,669 | 369,016 / 374,370 | 3660 | 8 | 42,559,394 | 3,559,331 | 0 | 0 | 127,513 / 243,156 / 0 | yes |
| R3/node | 392,667 | 388,308 / 397,104 | 3660 | 8 | 57,420,271 | 26,602,434 | 0 | 0 | 253,952 / 138,715 / 0 | yes |
| R3/tauri | 382,565 | 376,085 / 385,911 | 3660 | 8 | 66,763,392 | 16,075,471 | 0 | 0 | 232,311 / 150,254 / 0 | yes |
| R4/node | 569,623 | 565,267 / 573,634 | 3660 | 8 | 64,823,953 | 10,112,564 | 0 | 0 | 0 / 569,623 / 0 | yes |
| R4/tauri | 469,019 | 465,078 / 474,707 | 3660 | 8 | 73,313,867 | 6,258,784 | 0 | 0 | 0 / 469,019 / 0 | yes |
| R5/node | 653,106 | 646,766 / 657,129 | 3660 | 8 | 65,803,430 | 15,832,390 | 0 | 0 | 426,771 / 226,335 / 0 | yes |
| R5/tauri | 657,126 | 650,186 / 663,490 | 3660 | 8 | 71,808,907 | 5,744,362 | 0 | 0 | 409,463 / 247,663 / 0 | yes |
| R6/node | 355,187 | 351,181 / 361,971 | 3660 | 8 | 46,286,726 | 11,369,187 | 0 | 0 | 215,638 / 139,549 / 0 | yes |
| R6/tauri | 322,619 | 319,959 / 323,982 | 3660 | 8 | 56,659,855 | 8,187,367 | 0 | 0 | 183,350 / 139,269 / 0 | yes |
| R7/node | 383,803 | 378,788 / 387,503 | 3660 | 8 | 40,877,335 | 3,529,868 | 0 | 0 | 100,516 / 283,287 / 0 | yes |
| R7/tauri | 370,887 | 368,284 / 374,454 | 3660 | 8 | 43,236,532 | 1,437,253 | 0 | 0 | 87,649 / 283,238 / 0 | yes |
| R8/node | 392,391 | 389,922 / 394,097 | 3661 | 8 | 48,995,303 | 17,110,520 | 0 | 0 | 304,872 / 87,519 / 0 | yes |
| R8/tauri | 367,211 | 365,026 / 369,110 | 3660 | 8 | 50,341,127 | 10,504,044 | 0 | 0 | 282,881 / 84,330 / 0 | yes |
| R9/node | 379,871 | 378,593 / 382,639 | 3660 | 8 | 46,520,976 | 4,051,886 | 0 | 0 | 0 / 379,871 / 0 | yes |
| R9/tauri | 298,269 | 297,191 / 300,468 | 3660 | 8 | 47,589,061 | 3,868,216 | 0 | 0 | 0 / 298,269 / 0 | yes |
| R10/node | 395,792 | 393,672 / 398,870 | 3660 | 8 | 40,221,187 | 3,056,677 | 0 | 0 | 0 / 395,792 / 0 | yes |
| R10/tauri | 347,135 | 345,257 / 349,648 | 3660 | 8 | 42,959,042 | 1,569,433 | 0 | 0 | 0 / 347,135 / 0 | yes |
| R11/indexeddb | 680,589 | 674,490 / 685,744 | 3660 | 8 | 37,424,377 | 41,048 | 0 | 0 | 0 / 680,589 / 0 | yes |
| R12/node | 846,212 | 839,016 / 854,030 | 3660 | 8 | 79,488,672 | 16,000,249 | 0 | 0 | 0 / 846,212 / 0 | yes |
| R12/tauri | 774,017 | 768,133 / 778,976 | 3660 | 8 | 80,623,948 | 14,815,790 | 0 | 0 | 0 / 774,017 / 0 | yes |
| R13/node | 661,218 | 658,830 / 664,403 | 3660 | 8 | 38,825,913 | 134,635 | 0 | 0 | 0 / 661,218 / 0 | yes |
| R13/tauri | 560,927 | 553,883 / 564,499 | 3660 | 8 | 40,256,080 | 24,950 | 0 | 0 | 0 / 560,927 / 0 | yes |
| R14/node | 480,774 | 477,538 / 482,773 | 3660 | 8 | 48,414,990 | 8,347,705 | 0 | 0 | 144,427 / 336,347 / 0 | yes |
| R14/tauri | 445,703 | 443,371 / 449,038 | 3660 | 8 | 47,779,654 | 5,386,724 | 0 | 0 | 97,428 / 337,359 / 10,916 | yes |
| R15/node | 903,555 | 899,843 / 908,503 | 3660 | 8 | 70,135,831 | 6,875,635 | 0 | 0 | 216,487 / 687,068 / 0 | yes |
| R15/tauri | 866,250 | 861,725 / 870,196 | 3660 | 8 | 79,127,270 | 8,170,819 | 0 | 0 | 194,472 / 671,778 / 0 | yes |
| R16/node | 333,403 | 330,295 / 336,374 | 3660 | 8 | 59,914,859 | 23,197,347 | 0 | 0 | 168,309 / 165,094 / 0 | yes |
| R17a/indexeddb | 3,107,730 | 3,092,384 / 3,123,639 | 3660 | 8 | 45,601,266 | 2,495 | 0 | 0 | 742,795 / 2,364,935 / 0 | yes |
| R17a/node | 3,669,156 | 3,660,407 / 3,678,826 | 3660 | 8 | 57,324,348 | 2,868 | 0 | 0 | 876,762 / 2,792,394 / 0 | yes |
| R17a/tauri | 2,635,678 | 2,631,350 / 2,643,977 | 3660 | 8 | 59,004,738 | 4,143 | 0 | 0 | 959,716 / 1,675,962 / 0 | yes |
| R17b/indexeddb | 2,351,636 | 2,338,322 / 2,367,583 | 3660 | 8 | 34,924,361 | 3,041 | 0 | 0 | 410,328 / 1,941,308 / 0 | yes |
| R17b/node | 2,773,531 | 2,727,025 / 2,795,040 | 3660 | 8 | 44,100,516 | 3,457 | 0 | 0 | 484,096 / 2,289,435 / 0 | yes |
| R17b/tauri | 2,162,726 | 2,135,360 / 2,173,247 | 3660 | 8 | 48,778,700 | 3,301 | 0 | 0 | 518,074 / 1,644,652 / 0 | yes |
| R17c/indexeddb | 603,466 | 600,406 / 606,525 | 3660 | 8 | 33,446,502 | 127,145 | 0 | 0 | 173,559 / 429,907 / 0 | yes |
| R17c/node | 688,288 | 683,051 / 691,920 | 3660 | 8 | 39,593,061 | 140,936 | 0 | 0 | 198,073 / 490,215 / 0 | yes |
| R17c/tauri | 554,987 | 551,572 / 558,692 | 3660 | 8 | 41,024,979 | 210,983 | 0 | 0 | 166,335 / 388,652 / 0 | yes |
| R17d/indexeddb | 682,287 | 678,597 / 683,965 | 3660 | 8 | 37,493,879 | 76,555 | 0 | 0 | 100,833 / 581,454 / 0 | yes |
| R17d/node | 580,611 | 573,851 / 583,323 | 3660 | 8 | 42,078,080 | 1,561,110 | 0 | 0 | 179,762 / 400,849 / 0 | yes |
| R17d/tauri | 440,898 | 437,472 / 442,646 | 3660 | 8 | 44,770,460 | 573,637 | 0 | 0 | 133,852 / 307,046 / 0 | yes |
| R17e/indexeddb | 361,370 | 359,555 / 362,400 | 3660 | 8 | 34,680,554 | 1,341,732 | 0 | 0 | 85,218 / 276,152 / 0 | yes |
| R17e/node | 374,572 | 371,611 / 377,608 | 3660 | 8 | 40,055,876 | 3,964,662 | 0 | 0 | 117,030 / 257,542 / 0 | yes |
| R17e/tauri | 364,924 | 363,625 / 366,351 | 3660 | 8 | 43,001,155 | 1,619,260 | 0 | 0 | 101,451 / 263,473 / 0 | yes |
| R17f/indexeddb | 1,066,602 | 1,057,790 / 1,074,273 | 3660 | 8 | 53,282,243 | 1,761,826 | 0 | 0 | 84,643 / 981,959 / 0 | yes |
| R17f/node | 1,169,076 | 1,157,600 / 1,175,542 | 3662 | 8 | 67,577,309 | 2,347,058 | 0 | 0 | 266,487 / 902,589 / 0 | yes |
| R17f/tauri | 1,039,472 | 1,033,797 / 1,045,779 | 3660 | 8 | 69,631,932 | 2,072,664 | 0 | 0 | 208,367 / 831,105 / 0 | yes |
| R17g/indexeddb | 328,264 | 326,469 / 330,427 | 3660 | 8 | 36,761,385 | 4,214,101 | 0 | 0 | 118,786 / 209,478 / 0 | yes |
| R17g/node | 355,660 | 352,725 / 359,092 | 3660 | 8 | 42,036,858 | 7,476,017 | 0 | 0 | 169,976 / 185,684 / 0 | yes |
| R17g/tauri | 357,877 | 355,235 / 360,919 | 3660 | 8 | 40,918,315 | 2,772,841 | 5178 | 0 | 148,311 / 204,388 / 0 | yes |
| R18a/indexeddb | 421,130 | 419,356 / 422,878 | 3660 | 8 | 35,970,542 | 634,993 | 0 | 0 | 38,611 / 382,519 / 0 | yes |
| R18a/node | 401,735 | 398,483 / 404,440 | 3660 | 8 | 40,750,268 | 9,193,049 | 0 | 0 | 145,843 / 255,892 / 0 | yes |
| R18a/tauri | 415,946 | 414,683 / 418,207 | 3660 | 8 | 41,735,968 | 3,011,476 | 0 | 0 | 141,285 / 274,661 / 0 | yes |
| R18a2/indexeddb | 183,915 | 183,507 / 184,518 | 3660 | 8 | 8,342,113 | 2,238,973 | 0 | 0 | 0 / 183,915 / 0 | yes |
| R18a2/node | 191,934 | 190,327 / 193,171 | 3660 | 8 | 9,086,555 | 2,306,037 | 0 | 0 | 0 / 191,934 / 0 | yes |
| R18a2/tauri | 185,508 | 184,478 / 186,966 | 3660 | 8 | 13,976,277 | 7,777,769 | 0 | 0 | 0 / 185,508 / 0 | yes |
| R18b/indexeddb | 349,408 | 348,293 / 350,231 | 3660 | 8 | 34,308,280 | 1,210,885 | 0 | 0 | 69,735 / 279,673 / 0 | yes |
| R18b/node | 319,967 | 318,622 / 322,128 | 3660 | 8 | 37,832,517 | 5,956,869 | 0 | 0 | 105,626 / 214,341 / 0 | yes |
| R18b/tauri | 280,401 | 279,340 / 282,542 | 3660 | 8 | 40,913,575 | 3,679,750 | 0 | 0 | 81,625 / 193,125 / 5,651 | yes |
| R18c/tauri | 358,201 | 354,094 / 359,450 | 3660 | 8 | 82,902,188 | 20,583,015 | 0 | 0 | 149,079 / 209,122 / 0 | yes |
| R18d/tauri | 568,116 | 564,396 / 571,591 | 3660 | 8 | 58,827,805 | 3,079,301 | 0 | 0 | 501,418 / 0 / 66,698 | yes |
| R18e/tauri | 445,499 | 443,402 / 448,215 | 3660 | 8 | 56,051,803 | 2,433,045 | 0 | 0 | 156,214 / 289,285 / 0 | yes |
| R18f/indexeddb | 775,500 | 772,558 / 777,572 | 3660 | 8 | 33,346,500 | 43 | 0 | 0 | 0 / 775,500 / 0 | yes |
| R18f/node | 663,376 | 657,326 / 666,280 | 3660 | 8 | 35,822,304 | 2,018 | 0 | 0 | 0 / 663,376 / 0 | yes |
| R18f/tauri | 457,725 | 454,481 / 460,351 | 3660 | 8 | 38,906,625 | 633 | 0 | 0 | 0 / 457,725 / 0 | yes |
| R18g/indexeddb | 774,832 | 772,582 / 778,213 | 3660 | 8 | 33,317,776 | 43 | 0 | 0 | 0 / 774,832 / 0 | yes |
| R18g/node | 667,229 | 659,164 / 672,529 | 3660 | 8 | 36,030,366 | 2,018 | 0 | 0 | 0 / 667,229 / 0 | yes |
| R18g/tauri | 459,928 | 457,477 / 463,685 | 3660 | 8 | 39,093,880 | 633 | 0 | 0 | 0 / 459,928 / 0 | yes |
| R18h/indexeddb | 771,777 | 769,982 / 775,233 | 3660 | 8 | 33,186,411 | 43 | 0 | 0 | 0 / 771,777 / 0 | yes |
| R18h/node | 667,461 | 665,014 / 669,643 | 3660 | 8 | 36,042,894 | 2,018 | 0 | 0 | 0 / 667,461 / 0 | yes |
| R18h/tauri | 457,860 | 455,311 / 459,179 | 3660 | 8 | 38,918,100 | 633 | 0 | 0 | 0 / 457,860 / 0 | yes |
| R18i/indexeddb | 2,186,806 | 2,179,464 / 2,196,518 | 3660 | 8 | 32,802,090 | 15 | 0 | 0 | 0 / 2,186,806 / 0 | yes |
| R18i/node | 2,715,407 | 2,708,153 / 2,720,431 | 3660 | 8 | 40,731,105 | 15 | 0 | 0 | 0 / 2,715,407 / 0 | yes |
| R18i/tauri | 2,189,836 | 2,173,748 / 2,199,986 | 3660 | 8 | 48,176,392 | 22 | 0 | 0 | 0 / 2,189,836 / 0 | yes |



## 2. R17g/Tauri: 5,178 G1 records (MEASURED unless marked)

- Finding: `l7-out\R17g-tauri.json`: 357,877 runs, **5,178 violations** (1.45 %), all the same text, "G1: the fence key was written by a (writeTop, read), which is not a fence exit", all actor `a`, seeds 286 to 360,247; one trace file per violation in `l7-violations\R17g-tauri-s<seed>.json` (5,178 files, none for any other pair). R17g/node and R17g/indexeddb: 0 violations in 355,660 and 328,264 runs. The run kinds of the pair are crashed 148,311, complete 204,388, violation 5,178 (the 5,178 are counted as `violation` and are not in the other two kinds).
- Cause (investigator `r17g\report.md`, confirmed by the Gate 2 verdict `g7c-verdict.md`, both EXECUTED on seeds 286 and 100090 and a 222-seed sample): not a library defect. It is a checker modelling gap. The flagged write is the Tauri boot re-flush of `store2-fence` in `open` (read, compare under the in-process mutex, unconditional native `writeTop`), which writes back the byte-identical fence it had just read. R17g's unconditional `damage-fence` environment step lands between the compare and the native write, so the re-flush puts the read bytes back over the damage (seed 286: step 7 plants 16 B, step 8 writes the 2,274 B read at step 6). The old G1 rule saw a fence write by a non-exit. No legitimate writer can land in that window (one mutex per store; the page-generation gate refuses a stale page), and the plan accepts damage after a read (plan v3.4 3.4c). I1 and G10 held in all 5,178 runs. Node and IndexedDB have no re-flush at open.
- Checker fix `816eec012` (test code only; library unchanged): G1 excuses a write under the `read` context only when it puts back the actor's own last fence read, the bytes it replaced differ from that read, and no call has changed the fence since that read. Four clause-pinning tests (checker.test.ts 93 passing at the f7c step; the commit message gives 6,208 passed, 17 skipped over the storage tests, `pnpm check` 0 errors).
- Re-run under the fix: all 5,178 recorded seeds, in-tree `runRegion` R17g/tauri through `f7c-seeds.test.mjs`: **0 violating** (complete 3,262, crashed 1,916; `f7c-seeds-result.json`, `f7c-report.md`, EXECUTED by the test-warrior). The opus-reviewer independently re-ran a random 222-seed sample (plus seeds 286 and 100090): 0 violating under the fix, 222 of 222 violating with the allowance removed in memory. A control with the allowance removed over the full 5,178 list was not run (f7c-report), only the 222-seed sample. The mutant `restoreRewritesFence` (restore also rewrites the fence) is red (7 tests in 3 files), so library fence writes stay reported.
- NOT done: the 1 h R17g/Tauri PCT pair was not repeated under `816eec012`. The statement "the fix hides no violation" rests on the re-run of the 5,178 flagged seeds, the sample control, the mutant and the unit tests, not on a fresh long run.
- Disclosure A (coverage, Gate 2 finding 6). The checker only observes; a run is never stopped at a violation (`runRegion` collects `rig.checker.violations` at the end; read in source). So in the 5,178 runs, and in every run with the same shape, the re-flush healed the planted damage at step 8, and later actors saw a healed fence, not a damaged one. This is a property of those runs, not of the checker change: rig behaviour is identical before and after the fix (the 222-seed sample has the same complete/crashed split before and after).
- Disclosure B (GC over a damaged fence). Executed diagnostic by the opus-reviewer (`g7c-exposure.json`, seeds 1 to 600, new checker, 0 violating): 531 of 600 runs had a call read a damaged (16 B) fence; by context fence-exit 529, read 358, recovery-begin 132, **gc 12** (a run can count in several contexts). So GC read a damaged fence in 12 of 600 seeds (2 %; MEASURED on 600 seeds), about 7,000 of the 357,877 long runs (INFERRED by scaling, not counted in the long run). The thin share is pre-existing and comes from scheduling; a Tauri `after` on `damage-fence` would remove the window under test, which the plan accepts, so the Gate 2 verdict chose disclosure.
- Amendment 6 candidate (carry notes): record the Tauri re-flush window (damage between the compare and the native write is healed, accepted per 3.4c).

## 3. Rare keys and fault kinds the smoke cut dropped (2f-7a finding 3)

Source of the list: `g7a-coverage.log` (31 pairs, 45 reached keys, 3 fault kinds lost from the smoke) and `g7a-coverage2.log` (Node `discardFence:failed` gone from the smoke entirely). Checked against the long-run `reachedKeyRuns` and `faultKindRuns` (`l7r-rare.mjs`, output `l7r-rare.txt`).

**Result: all 45 keys, all 3 fault kinds and Node `discardFence:failed` were reached in the long runs; none was never reached.** Lowest key share: R14/node `commit:failed` 0.45 % of runs (2,163); lowest absolute count R8/tauri `bulk:conflict` 1,887 runs.

Named items from the brief (MEASURED):
- R18a/idb lost-request: 37,447 runs, 39,063 injections (of 421,130 runs).
- R18b/idb lost-response: 66,463 runs, 73,935 injections (of 349,408).
- R3/tauri partial-removal: 7,191 runs, 7,252 injections (of 382,565, 1.9 % of runs).
- Node `discardFence:failed`: R17f/node 38,388 runs (3.28 %), R18a/node 13,052 runs (3.25 %); no other Node pair reaches it.

All fault kinds of the three backends were reached: node and indexeddb crash-after-write, lost-request, lost-response; tauri additionally flush-fault (343,041 runs, summed over the 31 tauri pairs) and partial-removal (205,740 runs, same sum).

Every key from the 31-pair list:


| pair | key / fault kind | runs reaching it | of runs | share | label |
|---|---|---|---|---|---|
| R1/tauri | restore:no-target | 10,424 | 323,628 | 3.221% | MEASURED |
| R10/node | commit:refused | 47,816 | 395,792 | 12.081% | MEASURED |
| R10/node | gc:refused | 49,178 | 395,792 | 12.425% | MEASURED |
| R13/node | gc:done | 43,245 | 661,218 | 6.540% | MEASURED |
| R14/node | commit:failed | 2,163 | 480,774 | 0.450% | MEASURED |
| R14/node | gc:done:unknown-outcome | 16,517 | 480,774 | 3.436% | MEASURED |
| R16/node | admit:failed | 2,111 | 333,403 | 0.633% | MEASURED |
| R16/node | gc:done:unknown-outcome | 17,749 | 333,403 | 5.324% | MEASURED |
| R17b/node | exit:fence | 250,318 | 2,773,531 | 9.025% | MEASURED |
| R17c/node | recover:abandoned | 81,271 | 688,288 | 11.808% | MEASURED |
| R17c/tauri | recover:abandoned | 52,053 | 554,987 | 9.379% | MEASURED |
| R17d/tauri | admit:refused | 8,798 | 440,898 | 1.995% | MEASURED |
| R17d/tauri | commit:refused | 8,798 | 440,898 | 1.995% | MEASURED |
| R17d/tauri | recover:exit | 8,760 | 440,898 | 1.987% | MEASURED |
| R17e/tauri | gc:done | 32,669 | 364,924 | 8.952% | MEASURED |
| R17f/node | commit:failed | 62,371 | 1,169,076 | 5.335% | MEASURED |
| R17f/node | discardFence:failed | 38,388 | 1,169,076 | 3.284% | MEASURED |
| R17f/node | gc:done:unknown-outcome | 69,163 | 1,169,076 | 5.916% | MEASURED |
| R17f/tauri | commit:conflict | 9,579 | 1,039,472 | 0.922% | MEASURED |
| R17f/tauri | gc:multi-batch | 269,388 | 1,039,472 | 25.916% | MEASURED |
| R18a/indexeddb | gc:done:unknown-outcome | 11,878 | 421,130 | 2.821% | MEASURED |
| R18a/indexeddb | fault kind lost-request | 37,447 (total injections 39,063) | | | MEASURED |
| R18a/node | discardFence:failed | 13,052 | 401,735 | 3.249% | MEASURED |
| R18a/node | gc:multi-batch | 28,043 | 401,735 | 6.980% | MEASURED |
| R18a/tauri | commit:conflict | 7,019 | 415,946 | 1.687% | MEASURED |
| R18a/tauri | fenceExit:failed | 21,350 | 415,946 | 5.133% | MEASURED |
| R18a/tauri | gc:refused | 11,156 | 415,946 | 2.682% | MEASURED |
| R18a2/node | fenceExit:failed | 5,585 | 191,934 | 2.910% | MEASURED |
| R18b/indexeddb | fault kind lost-response | 66,463 (total injections 73,935) | | | MEASURED |
| R18b/tauri | commit:conflict | 4,389 | 280,401 | 1.565% | MEASURED |
| R18b/tauri | gc:done:backend-failure | 7,177 | 280,401 | 2.560% | MEASURED |
| R18c/tauri | admit:failed | 45,722 | 358,201 | 12.764% | MEASURED |
| R18c/tauri | gc:done:unknown-outcome | 15,125 | 358,201 | 4.222% | MEASURED |
| R18e/tauri | commit:refused | 18,951 | 445,499 | 4.254% | MEASURED |
| R2/indexeddb | commit:conflict | 8,293 | 427,163 | 1.941% | MEASURED |
| R2/node | commit:conflict | 68,361 | 400,311 | 17.077% | MEASURED |
| R3/indexeddb | bulk:conflict | 10,574 | 370,669 | 2.853% | MEASURED |
| R3/node | bulk:committed | 50,809 | 392,667 | 12.939% | MEASURED |
| R3/node | gc:done:unknown-outcome | 28,282 | 392,667 | 7.203% | MEASURED |
| R3/tauri | bulk:conflict | 12,242 | 382,565 | 3.200% | MEASURED |
| R3/tauri | fault kind partial-removal | 7,191 (total injections 7,252) | | | MEASURED |
| R6/tauri | bulk:refused | 6,053 | 322,619 | 1.876% | MEASURED |
| R6/tauri | gc:refused | 3,622 | 322,619 | 1.123% | MEASURED |
| R7/node | commit:refused | 11,549 | 383,803 | 3.009% | MEASURED |
| R7/tauri | commit:refused | 6,145 | 370,887 | 1.657% | MEASURED |
| R8/node | recover:exit | 56,619 | 392,391 | 14.429% | MEASURED |
| R8/tauri | bulk:conflict | 1,887 | 367,211 | 0.514% | MEASURED |
| R9/node | recover:exit | 11,897 | 379,871 | 3.132% | MEASURED |



## 4. R14 `recover:invalid:missing` rate and a floor proposal (proposal only, no tree change)

**Update 2026-10-17: the proposal's 40-seed option was applied in step 2f-7d (`cafcba9e6`), see section 11.1.** The text below is the record as written, before that step.

Note on names: the long runs record the reached key `recover:invalid` and the outcome label `recover:invalid:missing` (identical counts: the label occurs once per reaching run). R14 declares no floor for it. The label is the declared outcome of R18i; in R14 it arises when actor `a2`'s picked candidate's tree lacks a unit.

| pair | runs | runs reaching `recover:invalid:missing` | rate | smoke seeds 1..20 reaching it |
|---|---|---|---|---|
| R14/node | 480,774 | 70,535 | 14.67 % | 2 (seeds 6 and 19) |
| R14/tauri | 445,703 | 47,920 | 10.75 % | 2 (seeds 6 and 19) |

MEASURED: rates from `R14-node.json` and `R14-tauri.json`; smoke seeds from `l7-smoke-pctSmoke.log` (PCT-RUN lines at f0895733a) and confirmed by my own re-run (EXECUTED, `L7_FULL=1`, seeds 1 to 80 per backend, in-tree `runRegion`, files in `l7r-r14-<backend>\`): reaching seeds node 6, 19, 25, 26, 27, 28, 40, 42, 44, 55, 57, 61, 68, 79; tauri 6, 19, 25, 28, 39, 45, 61, 63, 68, 75. Counts in the first 20 / 40 / 60 / 80 seeds: node 2 / 7 / 11 / 14; tauri 2 / 5 / 6 / 10.

Proposal (INFERRED from those rates):
- 60 % to 75 % of the long-run rate is 8.8 % to 11.0 % on node and 6.5 % to 8.1 % on Tauri. At 20 seeds that is 1.8 to 2.2 seeds and 1.3 to 1.6 seeds. Because the smoke reaches the label on exactly 2 of 20 seeds on both backends, the only integer floor that passes is 1 seed (0.05): margin 1 seed. A margin of 2 seeds is unattainable at 20 seeds. If a floor is added at the current seed count, use `recover:invalid: 0.05` (both backends) and record that its margin is 1 seed.
- To get a margin of at least 2 seeds, raise R14's smoke to 40 seeds (seeds 1..40 are a prefix of the same deterministic sequence, so the extra 20 do not change seeds 1..20). Then floor node `recover:invalid: 0.10` (4 seeds needed, 7 reached, margin 3, 68 % of the long-run rate) and Tauri `recover:invalid: 0.075` (3 seeds needed, 5 reached, margin 2, 70 % of the long-run rate; in `tauriFloors`). Cost: my 80-seed run took about 2.0 to 2.4 s per backend in one process. Doubling R14's seeds changes the margins of R14's other floors (bulk, clearMarker:clear, commit:committed, recover:installed, recover:installed:planted, minFaulted), which must be re-measured at 40 seeds before the change (not done).

## 5. IndexedDB fault density against Node and Tauri (MEASURED from the long runs)

Aggregate over all pairs of a backend (pair sets differ, so read it with the matched table): indexeddb 18 pairs, 42.5 steps/run, 0.460 faults/run, 0.01084 faults/step, 36.1 % of runs faulted; node 29 pairs, 61.4 steps/run, 0.817 faults/run, 0.01329 faults/step, 49.0 %; tauri 31 pairs, 82.8 steps/run, 0.877 faults/run, 0.01060 faults/step, 57.1 %. (Faults = injected fault kinds summed from `faultKindTotals`, including crash-after-write; Tauri also counts flush-fault and partial-removal.)

Matched regions (same region on all three backends; faults/run, faults/step, share of runs faulted; MEASURED):


| region | IDB faults/run | node | tauri | IDB faults/step | node | tauri | IDB faulted share | node | tauri |
|---|---|---|---|---|---|---|---|---|---|
| R1 | 0.675 | 4.873 | 4.256 | 0.00616 | 0.02752 | 0.01789 | 0.497 | 0.995 | 0.992 |
| R2 | 0.524 | 0.819 | 0.597 | 0.00464 | 0.00571 | 0.00352 | 0.502 | 0.678 | 0.597 |
| R3 | 1.081 | 2.260 | 1.744 | 0.00941 | 0.01545 | 0.00999 | 0.875 | 0.976 | 0.967 |
| R17a | 0.783 | 0.783 | 1.092 | 0.05338 | 0.05013 | 0.04878 | 0.549 | 0.549 | 0.842 |
| R17b | 0.535 | 0.535 | 0.718 | 0.03600 | 0.03364 | 0.03184 | 0.454 | 0.454 | 0.608 |
| R17c | 0.870 | 0.871 | 0.898 | 0.01570 | 0.01514 | 0.01215 | 0.665 | 0.665 | 0.681 |
| R17d | 0.443 | 0.929 | 0.909 | 0.00807 | 0.01282 | 0.00895 | 0.385 | 0.687 | 0.686 |
| R17e | 0.762 | 1.017 | 0.832 | 0.00794 | 0.00951 | 0.00706 | 0.553 | 0.682 | 0.633 |
| R17f | 0.241 | 0.701 | 0.624 | 0.00481 | 0.01213 | 0.00932 | 0.222 | 0.558 | 0.539 |
| R17g | 0.987 | 1.236 | 0.978 | 0.00881 | 0.01045 | 0.00856 | 0.655 | 0.765 | 0.728 |
| R18a | 0.281 | 1.150 | 1.031 | 0.00329 | 0.01133 | 0.01027 | 0.251 | 0.759 | 0.754 |
| R18a2 | 0.243 | 0.237 | 0.415 | 0.00535 | 0.00501 | 0.00550 | 0.191 | 0.186 | 0.314 |
| R18b | 0.636 | 1.081 | 0.960 | 0.00647 | 0.00914 | 0.00658 | 0.486 | 0.707 | 0.645 |



Reading (INTERPRETATION):
- IndexedDB is under-faulted in 7 of the 13 matched fault regions, by faults per run: R1 (0.675 vs 4.87 node and 4.26 Tauri; share of runs faulted 0.50 vs 0.995 and 0.99), R18a (0.28 vs 1.15 and 1.03), R17f (0.24 vs 0.70 and 0.62), R17d (0.44 vs 0.93 and 0.91), R3 (1.08 vs 2.26 and 1.74), R18b (0.64 vs 1.08 and 0.96), R2 (0.52 vs 0.82 and 0.60). Per step the gap has the same direction (R1 0.0062 vs 0.0275 and 0.0179; R18a 0.0033 vs 0.0113 and 0.0103; R17f 0.0048 vs 0.0121 and 0.0093). IDB equals Node in R17a, R17b, R17c and R18a2, and is within about 25 % in R17e and R17g.
- Part of the gap is run length (IDB runs have fewer steps: 42.5 vs 61.4 and 82.8 on average); the per-step density is also lower in the seven regions above, so shorter runs are not the whole reason. The fault plan (`faults(probability, lostPerActor, crashPerActor, startAfterSteps)`) is shared by the backends, so the mechanism is INFERRED to be the number and shape of backend calls per operation on the IDB rig, not a different plan; I did not trace it.
- In absolute count IDB is not starved: for example R18a2/indexeddb about 44,700 injections in 183,915 runs (0.243 per run), R18a/indexeddb lost-request 39,063, lost-response 39,483, crash-after-write 39,882 injections. About 7.4 million IDB injections over the 18 pairs. The long runs therefore make up for the thin smoke density by count (carry note C5), with the caveat that a combination that needs two faults in one run is rarer on IDB (R17f/idb 22 % of runs faulted, R18a2/idb 19 %).
- The three IDB fault kinds are the same three as Node; IDB has no flush-fault or partial-removal by construction.

## 6. Live GC contention (`l7-live3600.log`, MEASURED)

Run: `vitest run src/ts/storage/tests/nodeLiveServer.test.ts -t "a live run"` with `RISU_LIVE_SECONDS=3600 RISU_LIVE_SEED=1`, 3 committers, restart at 0.5, started 12:14:24Z on 2026-10-15 (PID 25192, the second attempt), passed: 1 passed (10 skipped), test 4,017.4 s (`elapsedMs` 4,017,053; no extension phase, `extensions 0`), HEAD `f0895733a`. `violations []`, `unexpected []`, end state stable: listing 289 = wanted 289, `missing []`, `damaged []`, retained 20, `snapshot stable`.

Load it ran under (OBSERVED from `l7-pids.txt`, `l7-driver.log`): **the whole run (12:14:25Z to about 13:21:22Z) overlapped the PCT queue at 2 pairs, i.e. 16 workers, on a 32-thread host** (the rise to 24 workers came at 15:07:40Z, after the live run ended) and the library and server mutant batches (65 library mutants at about 4 min each, plus patched-server copies). There is no unloaded baseline on this host; the contention figures below are for that load.

GC (main-run counts equal total counts, `phaseCounts {}`):
- GC passes classified: 918 = `gc:done` 1 + `gc:done:commit-conflict` 453 + `gc:done:unknown-outcome` 455 + `gc:refused:capability-missing` 9. Conflict or unknown-outcome: 908 of 918 passes (98.9 %). The 2f-6 carry note recorded "about 90 %" for earlier live runs; this 1 h run is higher.
- Applied removal batches `gc:batches-applied` 10; keys deleted 247 (the `> 0` assertions hold; thin margin: 10 batches in 3,600 s of main run).
- Writers: `commit:committed` 1,328 against `commit:conflict` 6,448 (83 % conflict), `restore:committed` 1,696 / conflict 1,532, `pin:committed` 1,188, `unpin:committed` 1,188, `bulk:abandoned:upload-failed` 512, `bulk:refused:marker-present` 130; client-thrown `Store2BackendFailureError`: commits 13 + 19 + 16, pins 8 + 1 + 4, restores 7.
- Observer: ok 15,738, moved 5,358, inconclusive 50, unavailable 95 (all inside the 2.9 s restart window), walks during retire 4,878. Retire: 1,820 batches, no-partial-seen 1,813, partial-seen 7, `partialRetireRounds 0`.
- Requests seen: read 301,015; commit-write 11,301; unit-write 115,625; list-prefix 5,040; remove-checked 1,820. Dropped replies: unit-write 4,334, commit-write 1,565, remove-checked 455.

Live-test mutants at 5 s (`l7-mutant-table-live.md`, EXECUTED, cwd = worktree): `gcMainUnseen`, `gcMainNoCount`, `gcLateStart` each red on the live test; the unmutated control green. The server mutants are in section 7b.

Not established: whether a quiet host would show materially fewer conflicts (the share was not measured without load), and no GC-progress metric other than the 10 applied batches exists for this run.

**Update 2026-10-17: a 600 s idle baseline was run afterwards; see section 11.3** (99.4% conflict or unknown outcome, 357 of 359 passes, so the share is a property of the workload, not of the host load).

## 7. Mutant table, merged (MEASURED, EXECUTED)

Method: in-memory Vite `load` edits (exactly one match per edit, load counter, NOT-LOADED exit 97, own cache dir per mutant); the whole `src/ts/storage/tests/store2` directory per mutant with `REPLAY_REPORT=1`; process cwd = the worktree; worktree hashes of `store2`, `store`, `tests`, `server` compared before and after every run (all `changed 0`). Red = a failed test that names the property or behaviour; a throw, refusal, timeout or load failure is not red. Control: unmutated run, exit 0, 2,529 passed, 15 skipped, 60/60 files. An unmutated control once showed one failure in a run under PCT load, `backendIndexedDb.test.ts > the hazard is real here: a macrotask await inside a transaction leaves it inactive` (timing sensitive); a red there is not evidence.

### 7a. Library mutants (65 rows of `l7-mutant-table.md`, plus c1)

Tally: 65 rows = 59 red with every edit applied, 1 harness probe (`neverLoaded`, deliberately a patch that never loads, to prove the NOT-LOADED gate fires), 4 stale (never loaded, section 7c) and 1 composite with a stale half (`g5sSkippedNoCheck` = `g5rFinalCasSkipped` + `g5sNoInstCheck`: its loaded half is red; its stale half is covered by the re-targeted `g5sNoInstCheck`). Counted the way the carry notes count them, 61 of 65 are red and 4 never loaded (that count treats the probe and the composite as red). Plus `c1`: RED (33 failed in 7 files; corpus `c1:I1` x2 and `c409_14_gc_remove_moved:I1` x4), from `l7-mutant-table-probe.md` (valid cwd, 2,544 tests ran). The "caught by" column: corpus+tests = at least one replay corpus schedule reports a property violation; replay-dir tests = a test file under `replay/` (pctSmoke, actors, replay, checker, scheduler, ghost) is red; unit tests only = no corpus schedule and no `replay/` test is red. Rows marked NOT LOADED are explained in 7a above and 7c.


| mutant | result | failed tests | red in (test file, count) | corpus schedules red | caught by |
|---|---|---|---|---|---|
| c2 | RED | 23 | backendNode.test.ts (2), replay/nodeSemanticStore.test.ts, replay/pctSmoke.test.ts (5) | 3 schedules (I1) | corpus+tests |
| c4 | RED | 27 | gcPass.test.ts (3), replay/pctSmoke.test.ts (5) | 2 schedules (h/I1) | corpus+tests |
| c5 | RED | 28 | backendNode.test.ts (3), replay/nodeSemanticStore.test.ts (2), commit.test.ts (2), replay/actors.test.ts | 6 schedules (h/h2/I3) | corpus+tests |
| offNodeNoMutex | RED | 26 | backendTauri.test.ts (5), backendTauriAndroid.test.ts, recoveryPick.test.ts, replay/actors.test.ts | 1 schedules (I1) | corpus+tests |
| gcFenceAtStartOnly | RED | 17 | backendNode.test.ts (5), replay/nodeSemanticStore.test.ts (3) | 1 schedules (G1) | corpus+tests |
| listBeforeFenceRead | RED | 54 | fence.test.ts (8) | 4 schedules (G10) | corpus+tests |
| markerFreshToken | RED | 113 | recoveryExit.test.ts (7), recoveryIntegration.test.ts | 9 schedules (I3) | corpus+tests |
| gateIgnoresBlockedFence | RED | 49 | deleterGate.test.ts (7), gcPass.test.ts | 2 schedules (G1) | corpus+tests |
| decideClearOnNo | RED | 39 | backendNode.test.ts (2), commit.test.ts (2), commitBulk.test.ts (4) | 3 schedules (h/h2) | corpus+tests |
| neverLoaded | NOT LOADED (loads 0) | 1 | recoveryPick.test.ts | none | unit tests only |
| exitSeqZero | RED | 5 | backendNode.test.ts, commit.test.ts, gcPass.test.ts, recoveryExit.test.ts, recoveryPick.test.ts | none | unit tests only |
| commitRetryOnPeerIndex | RED | 68 | commit.test.ts (8) | 14 schedules (h/h2/I3/I1) | corpus+tests |
| commitReusesUnitKeys | RED | 79 | commit.test.ts (8) | 2 schedules (I2) | corpus+tests |
| abandonClearStaleBase | RED | 12 | commitBulk.test.ts (3), replay/pctSmoke.test.ts (5) | 2 schedules (i/I3) | corpus+tests |
| gcRetryNoReread | RED | 74 | gcPass.test.ts (8) | 4 schedules (I1) | corpus+tests |
| restoreRetryAtPeerIndex | RED | 11 | deleterGate.test.ts, recoveryPick.test.ts, tree.test.ts, replay/pctSmoke.test.ts (4), replay/replay.test.ts | 3 schedules (h/h2/I3) | corpus+tests |
| pickIgnoresGoneUnit | RED | 111 | recoveryPick.test.ts (8) | none | unit tests only |
| bulkFinalNoForcePush | RED | 8 | commitBulk.test.ts (3), recoveryPick.test.ts, replay/replay.test.ts (4) | none | replay-dir tests |
| gcMissingManifestAsEmpty | RED | 9 | deleterGate.test.ts, gcMark.test.ts (2), gcPass.test.ts (3), replay/replay.test.ts (2) | 1 schedules (I1) | corpus+tests |
| gcMarkMissingOnly | RED | 8 | gcMark.test.ts (2), gcPass.test.ts (3), replay/replay.test.ts (3) | none | replay-dir tests |
| parkedNoFifo | RED | 1 | replay/ghost.test.ts | none | replay-dir tests |
| parkedNotLive | RED | 1 | replay/ghost.test.ts | none | replay-dir tests |
| parkedKeepsGrantStep | RED | 1 | replay/ghost.test.ts | none | replay-dir tests |
| conflictReadNotReported | RED | 1 | replay/scheduler.test.ts | none | replay-dir tests |
| conflictReadIgnored | RED | 1 | replay/checker.test.ts | none | replay-dir tests |
| envExemptsAnyRemoval | RED | 11 | replay/checker.test.ts (8) | none | replay-dir tests |
| envExemptionNone | RED | 8 | replay/checker.test.ts (5), replay/replay.test.ts (3) | 1 schedules (I1) | corpus+tests |
| recoveryFreshRead | RED | 35 | replay/actors.test.ts (8) | none | replay-dir tests |
| finalFreshToken | RED | 35 | recoveryIntegration.test.ts (2), recoveryPick.test.ts (6) | 1 schedules (I3) | corpus+tests |
| screenNoRerun | RED | 12 | recoveryExit.test.ts, replay/actors.test.ts (2), replay/pctSmoke.test.ts (5) | none | replay-dir tests |
| lostTreeNone | RED | 1 | replay/checker.test.ts | none | replay-dir tests |
| lostTreeForever | RED | 1 | replay/checker.test.ts | none | replay-dir tests |
| g5rPickNeverInstalls | RED | 170 | recoveryIntegration.test.ts (8) | none | unit tests only |
| g5rFinalCasSkipped | RED | 158 | recoveryIntegration.test.ts (8) | 12 schedules (INST) | corpus+tests |
| g5rLabelPicked | NOT LOADED (loads 0) | 0 |  | none | unit tests only |
| g5rR14PickPlanted | NOT LOADED (loads 0) | 0 |  | none | unit tests only |
| g5rGcMissingNoLostTree | RED | 10 | deleterGate.test.ts, gcMark.test.ts (2), gcPass.test.ts (3), replay/checker.test.ts, replay/replay.test.ts | none | replay-dir tests |
| g5sNoInstCheck | NOT LOADED (loads 0) | 0 |  | none | unit tests only |
| g5sR14NoCandidate | RED | 2 | replay/pctSmoke.test.ts (2) | none | replay-dir tests |
| g5sSkippedNoCheck | NOT LOADED (loads 1) | 36 | recoveryIntegration.test.ts (8) | none | unit tests only |
| instBytesOnly | RED | 11 | replay/checker.test.ts (3), replay/replay.test.ts (5) | 2 schedules (INST) | corpus+tests |
| g5tUnknownAsInstalled | RED | 13 | recoveryPick.test.ts (6), replay/pctSmoke.test.ts (2) | 1 schedules (INST) | corpus+tests |
| gcIgnoresUnconfirmedFlush | RED | 12 | gcPass.test.ts (6), replay/replay.test.ts (2) | 1 schedules (I1) | corpus+tests |
| topFlushMissingAsFlushed | RED | 20 | backendTauri.test.ts (2), session.test.ts (6) | 1 schedules (I1) | corpus+tests |
| restartKeepsOldStore | RED | 3 | replay/actors.test.ts, replay/tauriSemanticStore.test.ts (2) | none | replay-dir tests |
| skipStartupClear | RED | 15 | boot.test.ts, deleterGate.test.ts, session.test.ts, replay/actors.test.ts (4), replay/pctSmoke.test.ts | none | replay-dir tests |
| restartDropsNothing | RED | 16 | replay/actors.test.ts (2), replay/pctSmoke.test.ts, replay/replay.test.ts (5) | none | replay-dir tests |
| restartKeepsPeers | RED | 3 | replay/actors.test.ts (2), replay/scheduler.test.ts | none | replay-dir tests |
| noRestartExemption | NOT LOADED (loads 0) | 0 |  | none | unit tests only |
| bothIgnoreUnflushedUnit | RED | 11 | commitBulk.test.ts (3), recoveryPick.test.ts (3), replay/actors.test.ts, replay/pctSmoke.test.ts | 1 schedules (I1) | corpus+tests |
| bulkIgnoresUnflushedUnit | RED | 4 | commitBulk.test.ts (3), replay/actors.test.ts | none | replay-dir tests |
| installIgnoresUnflushedUnit | RED | 7 | recoveryPick.test.ts (3), replay/pctSmoke.test.ts, replay/replay.test.ts (3) | 1 schedules (I1) | corpus+tests |
| tauriUnitUndefinedAsFlushed | RED | 2 | backendTauri.test.ts (2) | none | unit tests only |
| idbGcCheckOutside | RED | 1 | backendIndexedDb.test.ts | none | unit tests only |
| idbCommitNoCompare | RED | 16 | backendIndexedDb.test.ts (4), commit.test.ts (2), replay/idbRig.test.ts (2) | 2 schedules (I3) | corpus+tests |
| idbRemoveNoCommitCompare | RED | 18 | backendIndexedDb.test.ts, deleterGate.test.ts, gcPass.test.ts (3), replay/idbRig.test.ts, replay/pctSmoke.test.ts (2) | 1 schedules (I1) | corpus+tests |
| idbRemoveNoFenceCompare | RED | 7 | backendIndexedDb.test.ts (3), deleterGate.test.ts, fence.test.ts, gcPass.test.ts, replay/pctSmoke.test.ts | none | replay-dir tests |
| idbCasNoCompare | RED | 68 | backendIndexedDb.test.ts (8) | 4 schedules (I3) | corpus+tests |
| rigSplitCollapsed | RED | 5 | replay/idbRig.test.ts (2), replay/replay.test.ts, replay/scheduler.test.ts (2) | none | replay-dir tests |
| rigShuffleIdentity | RED | 4 | replay/idbRig.test.ts, replay/scheduler.test.ts (3) | none | replay-dir tests |
| rigLostResponseIsSuccess | RED | 21 | replay/idbRig.test.ts, replay/replay.test.ts (7) | none | replay-dir tests |
| instSupersededWrite | RED | 1 | replay/checker.test.ts | none | replay-dir tests |
| nodeRigNoShuffle | RED | 1 | replay/scheduler.test.ts | none | replay-dir tests |
| tauriRigNoShuffle | RED | 2 | backendNode.test.ts, replay/scheduler.test.ts | none | replay-dir tests |
| seqOnlyCompare | RED | 4 | commit.test.ts (2), deleterGate.test.ts (2) | none | unit tests only |



### 7b. Server mutants (E10; patched copies of `server/node` under `l7-servers\`, in-tree server tests via `RISU_NODE_SERVER_SCRIPT`; `l7-mutant-table-server.md`)

| mutant | result | red test |
|---|---|---|
| srvNone (unpatched copy, control) | exit 0, 296 passed, override announced 9 times, real server dir unchanged | none (green, as required) |
| srvRetireOutsidePrefix | exit 1, 1 failed / 295 passed | `nodeRetire.test.ts > retire > keys outside the A-lite prefix are refused whole, and nothing is removed, bumped or logged` |
| srvUnsortedLocks | exit 1, 1 failed / 295 passed | `nodeGuardedRoutes.test.ts > ... 120 concurrent requests with overlapping check-only sets in opposite order all finish` (a completion test: the deadlock shows as that test failing; the plan's separate stuck-request detector in the live test was NOT added) |
| srvReplayV1 (delete records ignored by the replay parser) | exit 1, 6 failed / 290 passed | `nodeRetire.test.ts` (6 tests: restart reads 0 after retire, batch of two, hand-built delete-record replays) |

`nodeLiveServer.test.ts` (the 10 s test) stayed green against all three, so it is not what catches them.

### 7c. The 4 stale library mutants and the E1-1 follow-up (`l7m-table.md`, same method; 9 E1-1 mutants, 10 runs)

The 4 library mutants that never loaded (loads 0, NOT LOADED; the earlier table's "exit 1, shown tests passed" is the load failure, not a green run): root cause for all four is a stale match text against an in-tree replay file that changed after the mutant was written (log line `l7-mutant: <file> has 0 matches of a mutation site of <name>`).

| stale mutant | resolution | result |
|---|---|---|
| g5sNoInstCheck | re-targeted at the same behaviour (`checker.installed(id, result.manifestKey, result.bytes)` -> `void result.manifestKey`) | RED, 2 failed: `actors.test.ts` node and tauri, "an install whose final compare-and-write is skipped while it still reports installed is a finding"; no corpus violation |
| noRestartExemption | the in-tree checker already has the rule; run as written it is a no-op, so re-targeted to its inverse `restartExemptionReadded` | RED, 1 failed: `checker.test.ts` "an environment restart excuses no dropped unit ..."; no corpus violation |
| g5rLabelPicked | a diagnostic (label change) now built into the tree; no defect to inject | not re-run, n/a |
| g5rR14PickPlanted | both halves now in-tree (label and planting); the opposite mutant `g5sR14NoCandidate` is a loadable mutant of the set (RED, 2 failed) | not re-run, n/a |

The 9 E1-1 mutants with no previous library mutant (all red on in-tree tests, so no long PCT worker was run for them):

| # | mutant | red in |
|---|---|---|
| 1 | abandonNoIdPrefixCheck | 12 failed: `commitBulk.test.ts` x6, `actors.test.ts` x4, `pctSmoke.test.ts` x2 |
| 2 | abandonUnknownAsCleared | 3 failed: `commitBulk.test.ts` "a clear lost before it applied is judged on a fresh read and made again" (3 backends). One unit test only |
| 3 | restoreDropsStaging | 8 failed: `commit.test.ts` x3, `replay.test.ts` x4, `pctSmoke.test.ts` x1; corpus `surprise_s2_bulk_park_marker_standing:h/h2` |
| 4a | restoreNoForcePush | 3 failed: `commit.test.ts` restore "pushes the previous current ..." (3 backends). Unit only. (4b, "never pushes", not run: a superset of 4a, which is already red) |
| 5a | saveMineDropsStaging | 2 failed: `commit.test.ts` save-mine test (memory, indexedDb; Node refuses save-mine). Unit only |
| 5b | saveMineDropsPins | the same single test, same two backends. Unit only |
| 6 | markIgnoresPins | 13 failed, all `gcMark.test.ts`. Unit only |
| 7 | gcNoStagingSkip | 27 failed: `gcPass.test.ts` x3, `pctSmoke.test.ts` x22, `replay.test.ts` x2; corpus `c4:h`, `c4:I1` |
| 8 | exitNoFence | 117 failed: `recoveryExit.test.ts` x48, `replay.test.ts` x49, `actors.test.ts` x5, `pctSmoke.test.ts` x6, `recoveryIntegration.test.ts` x6, `recoveryPick.test.ts` x3. The reading of "marker fence" (the store2-fence written before the marker) is the agent's, not the plan's |
| 9 | idbCommitSplit | 2 failed, both `backendIndexedDb.test.ts` (one strict readwrite transaction for compare, units and commit key; "a unit key that already exists fails the step"). Unit only |

Also: `restoreRewritesFence` (step 2f-7c, `f7c-report.md`, re-executed by the Gate 2 reviewer): RED, 3 files and 7 tests failed (`commit.test.ts` x3 restore "never touches the fence", `actors.test.ts` x2, `pctSmoke.test.ts` R8 x2 on node and tauri); corpus text "G1: the fence key was written by a (writeChecked, restore)" and G10. It shows library fence writes are still reported; it says nothing about the allowance's `read` branch, which only the unit tests cover.

Not authored: no E1-1 item was skipped for lack of a faithful form; 4b alone was not run.

### 7d. Coverage note (disclosure)

E1-1 #2, #4a, #5a, #5b, #6 and #9 are caught by one or two targeted unit tests and by no replay property, no corpus schedule and no PCT run. Library mutants with the same property (`unit tests only` in 7a): `exitSeqZero`, `pickIgnoresGoneUnit`, `g5rPickNeverInstalls`, `tauriUnitUndefinedAsFlushed`, `idbGcCheckOutside` (amendment C6: the replay schedules whole calls and cannot reach the check-outside-transaction window; one backendIndexedDb unit test pins the structure; the desktop `dmut` device run also produced no red), `seqOnlyCompare`. If those unit tests were weakened, nothing else in `src/ts/storage/tests/store2` would fail for those mutants. Mutants 1, 3, 7 and 8 are also caught by replay or PCT-smoke tests.

**Update 2026-10-17:** one consequence the original did not state, found by the final Gate 2 (finding 2): `markIgnoresPins` (E1-1 #6) was red only in `gcMark.test.ts`, so no replay run reached a pin that is the only referrer of a tree while GC runs; I1 for pinned saves rested on that one unit test plus the E1-1 model. Step 2f-7e (`25e57bb57`) added a `gcPass.test.ts` case for it; `markIgnoresPins` is now also caught by `gcPass` (section 11.2). The other mutants in this list are unchanged.

## 8. Reproducibility

Hosts and tools: i9-13900KF (32 logical processors), 64 GB, Windows 11, node v24.19.0, vitest 4.1.11; the worktree's `node_modules`.

Worktree HEAD per phase:
- `f0895733a` (tree clean under `src/ts/storage` and `server`): the 78 PCT pairs, determinism check, library, server and live mutants, the 1 h live run, the E1-1 follow-up, and the R14 re-measurement in section 4 (re-run today against the worktree at `816eec012`, which differs from `f0895733a` only in `checker.ts` and `checker.test.ts`; the R14 rig and library are the same, and the checker can change only the violation list).
- `816eec012` (= `f0895733a` + the G1 allowance): the re-run of the 5,178 flagged seeds (`f7c-seeds.test.mjs`) and the Gate 2 checks (`g7c-*`).

**Update 2026-10-17: where the tools are.** The runner, driver, worker, configs, queue and mutant definitions named below are the scratch files of the long runs. Copies for stage 4 are in `Agents/Tools/storage-model/replay-tools/` (final Gate 2 finding 1: the scratch configs hardcoded the worktree path `C:/Projects/RisuAI/.claude/worktrees/alite-s2` and the scratch path, the mutant definitions are a 14-file import chain (`l7-mutants` to `f7a` to `f5g` and `g6b` to `f5c` to `g5b` to `f5b` to `f5t` to `f5s` to `g5r` to `f5r` to `f5a`, plus `l7m` and `f7c`) of which this record hashed only 3, and scratch files have vanished before). The commands below name the scratch files and the worktree as they were and will not run as written; see section 8.1 for the scratch-name to repository-file mapping and that directory's README for usage.

Commands (process cwd = the worktree; no `cd`):
- PCT: `node l7-driver.mjs run l7-queue.json` (driver PID 18112, started 2026-10-15T12:12:48Z), which spawns per pair 8 workers: `node <wt>\node_modules\vitest\vitest.mjs run --config <s2>\l7-pct.config.mjs` with env `L7_REGION L7_BACKEND L7_WORKER L7_WORKERS=8 L7_FIRST_SEED=w+1 L7_QUOTA_RUNS L7_MIN_MS L7_OUT L7_VIOL_DIR L7_NONRED_DIR` (stride seeds `w+1+8k`). End rule: every worker done with its share of at least 20,000 runs AND the pair at least 61 min old. Aggregation: `node l7-driver.mjs aggregate <runs dir> <region> <backend> <out>`.
- Determinism check (EXECUTED, part 1): `pctSmoke.test.ts` run unchanged with `PCT_REPORT=1` (81 passed, 1,310 PCT-RUN lines) against the l7 runner with `L7_FULL=1`: 52 records (R1/node seeds 1-18, R18c/tauri 1-20, R1/indexeddb 1-14) identical as JSON.
- Live: `vitest run src/ts/storage/tests/nodeLiveServer.test.ts -t "a live run"` with `RISU_LIVE_SECONDS=3600 RISU_LIVE_SEED=1`.
- Mutants: `l7-mutant-batch.ps1` calling `l7-mutant-table.ps1 -Mutants '<list>'` (library), `l7-server-mutants.ps1` (server), `l7m-mutant-table.ps1` (E1-1 follow-up); config `l7-mutant.config.mjs` / `l7m-mutant.config.mjs`; definitions `l7-mutants.mjs` / `l7m-mutants.mjs`.
- 5,178-seed re-run: `f7c.config.mjs` + `f7c-seeds.test.mjs` over `f7c-seeds.json`; restoreRewritesFence: `f7c-mutant.config.mjs` + `f7c-mutants.mjs`.
- This record's figures: `l7r-sum.mjs`, `l7r-table.mjs`, `l7r-rare.mjs`, `l7r-agg.mjs`, `l7r-mut3.mjs`; R14 re-measurement: `L7_REGION=R14 L7_BACKEND=<b> L7_WORKERS=1 L7_FIRST_SEED=1 L7_QUOTA_RUNS=80 L7_MIN_MS=0 L7_FULL=1 node <wt>\node_modules\vitest\vitest.mjs run --config l7-pct.config.mjs` (cwd worktree).

Seeds: PCT seeds are the stride `w+1+8k` per worker, i.e. the integers 1..N for every pair (contiguous prefix in the region table). Live seed 1 (the live run fixes operation choice by seed, not timing, so it is not replayable). Corpus seeds are the corpus files'. The fixture is synthetic (no community-service probes).

SHA-256 of the scratch runner files at record time (`l7r-hashes.txt`; provenance, 20 entries; of the mutant import chain named above only its three entry files `l7-mutants.mjs`, `l7m-mutants.mjs` and `f7c-mutants.mjs` are hashed):

```
ccef2789f1910b264dfa3119e9b73189467c3f70f025dfd4e13b05dcfee2966f  l7-driver.mjs
6f5b851db89df0c9188b24ecbf021feea0837faf9b189270fa5436240603c392  l7-worker.test.mjs
adf998dbafce853e53782536329f6125f669709746920bf0760bbc05abb5949d  l7-pct.config.mjs
f8e60ec84fcbcedd2a65de498649a910130e1abab0b25105f91973457d34a2b2  l7-queue.json
1106123387caeb1a425d921033e681a79607be6f2a53296ef1f3eef78b661099  l7-mutant.config.mjs
81ec906b9ab23c014e2e03e9f4f70a2cdca7add0c17078379ddf014a74ffa40b  l7-mutants.mjs
2d00096389f0d2e4ee1fe64750036ce630b1fd3130f767f443615b7cfccd419b  l7-listmut.mjs
db42b00242ae6661ac8a7661bde897f6b0c2bb10311253da5020b31df0a0e146  l7-mutant-table.ps1
102da7fccaa1300da8b0047cc7f4704bb51d1ad5d2baec0b7c2dfabf26489579  l7-mutant-batch.ps1
6ada81826da0600693a119c8e13f55adcb246275e34c14c07286c47182002b61  l7-server-mutants.ps1
cf2b58341392f32959436d75d5aa480c541be1dd69ffd0568af0f1af5df6d4ec  l7m-mutant.config.mjs
c46b2b9c012f4be81930ad40a8a982536becb515b5fa2eecf91cdc2835c8a64c  l7m-mutants.mjs
e52c6ef1681ba77b93bb28eb6b6542f8f9bdfcd9a5c646a7e1121f8321bfa19a  l7m-mutant-table.ps1
24ba1e99dc06b19351323aae0d7370243d586475a634b7f6ff7927fbc72cfaed  l7-concurrency.txt   (value now 3)
e0c18a6a8d48da87994c100bbb324c758d413e95f0fa5135bd0738a692b4d56f  l7-workers.txt       (value 8)
cdd4431249bd50df457824ee98acfb5dde5e4a83282cdf265f8a03457216864e  f7c-mutants.mjs
45f9dbf3d909620bc45b13b48edb7f54156ff3b4a552e296737676489eed9347  f7c-mutant.config.mjs
2cfd173b3275c334efce9bc42d3f8e5558866b161227a0a19d83e91a859fc715  f7c.config.mjs
1fff71b663e92a701a94f048f9664e78da0970d845efc05dfe8b4b6d267fa34c  f7c-seeds.test.mjs
a1134c3bdb9997b3d060a31f289ac00d818b6d620c027b6483966139d3a016a8  l7-live3600.log
```

Host observation (OBSERVED, part 1, mechanism NOT established): a PCT worker's per-run time rises about 4x after roughly 3 s of CPU-bound work (R1/node 12-25 ms/run at the start, 50-120 ms/run after 100-200 runs), with or without the fingerprint hook; heap flat (72 MB, 180 MB RSS); a CPU profile of runs 600-640 against runs 0-40 shows the same functions uniformly 2.8x slower, with no function growing; the worker stays at 100 % of one core. So it is not a leak and not algorithmic growth in the library. Candidates (INFERRED, untested): hybrid-core placement or power throttling of a long-running hidden process; V8 tier changes. Observation needed: a pinned-core run. Consequence: run counts and wall-clock figures here are for this host only, and the 1 h floor, not the 20,000 floor, binds. All of it ran on a best-case i9-13900KF; no frame-budget or device-speed claim is made from it.

### 8.1 Scratch name to repository file (added at records closeout, 2026-10-17)

Source: the E7 report (scratch `s2\e7-report.md`, "Design"), checked by the doc-verifier pass against the nine files in `Agents/Tools/storage-model/replay-tools/` (94 mutant keys counted by importing `mutants.mjs`; `queue.json` holds 78 pairs; the SHA-256 list in the directory's README re-computed and equal).

```
Scratch runner name (this record)              Repository file (Agents/Tools/storage-model/replay-tools/)
l7-driver.mjs                                  pct-driver.mjs (outputs renamed l7-* to pct-*: pct-out, pct-logs, pct-violations, pct-nonred, pct-driver.log, pct-pids.txt, pct-concurrency.txt, pct-workers.txt)
l7-worker.test.mjs                             pct-worker.test.mjs (now `test.skipIf(L7_REGION undefined)`, so a default `vitest run` reports it skipped)
l7-pct.config.mjs                              pct.config.mjs
l7-queue.json                                  queue.json (78 pairs)
l7-mutant.config.mjs, l7m-mutant.config.mjs    mutant.config.mjs (env names l7_MUTANT, L7_TAG and the worker L7_* names unchanged; root from RISU_ROOT, scratch from RISU_SCRATCH)
l7-mutants.mjs chain (l7-mutants, f7a, f5g, g6b, f5c, g5b, f5b, f5t, f5s, g5r, f5r, f5a) + l7m-mutants.mjs + f7c-mutants.mjs   mutants.mjs (94 mutants, deduplicated by name, one `// source:` comment each; includes the g6b live-server mutants, and `restoreRewritesFence`, `markIgnoresPins`, the 9 E1-1 mutants)
l7-mutant-table.ps1, l7m-mutant-table.ps1      mutant-table.ps1 (-Root -OutDir -Test -Table -Seconds -Filter)
l7-server-mutants.ps1                          server-mutants.ps1 (server-copy mutants stay inline)
```

- Dropped at flattening: `g5rLabelPicked`, `g5rR14PickPlanted` (diagnostic edits now in-tree), `noRestartExemption` (g5b form; replaced by `restartExemptionReadded`), the old f5s and f5t forms of `g5sNoInstCheck`, the f5a form of `recoveryFreshRead`.
- Changed: `g5sSkippedNoCheck` is recomposed from `g5rFinalCasSkipped` plus the re-targeted `g5sNoInstCheck` (the f5t form's edit text is not preserved), so its result at HEAD can differ from the table row "NOT LOADED (loads 1), 36 failed" in 7a.
- Not copied (scratch only; hashed in the list above where listed): `l7-listmut.mjs`, `l7-mutant-batch.ps1` (a name list, recoverable from the 7a table), `f7c.config.mjs` + `f7c-seeds.test.mjs` + `f7c-seeds.json` (the one-off 5,178-seed re-run), `l7r-*.mjs` (this record's figure scripts), `l7-live3600.log` (hashed). The 5,178-seed re-run is therefore NOT repeatable from the repository.
- Smoke runs with the repository form (EXECUTED by E7 at HEAD `b7bbd2521` over `src/ts/storage/tests/store2`, per the E7 report and the verifier's re-read of its logs, not re-run by this pass): `none` 2,537 passed and 15 skipped; `c4` 3 failed over `gcPass.test.ts`; `markIgnoresPins` 17 failed (13 in `gcMark.test.ts` and 4 in `gcPass.test.ts`), which matches section 11.2 and the commit message of `25e57bb57`.
- `pct-worker.test.mjs` matches the default Vitest include: `pnpm test` reports it as one skipped file, so the next full-run baseline reads one more file and one more skipped test than the 776 files and 21 skipped of the earlier baseline (E7 saw "1 skipped" with a default-config run; not re-run by the verifier).

## 9. Device results (summary of `dev\results.md`, HEAD `f0895733a`, run under the l7 load)

- I1 violations: 0 in every run (MEASURED): desktop Chrome 155.0.8059.79, two visible windows, localhost and LAN plain HTTP, three 180 s runs, 1.62 M, 1.65 M and 1.67 M key lookups (`dlocal`, `dlan`, `dmut`); Note 9 (SM-N960N, Android 10, Chrome 155.0.8059.41) alternated 20 s segments (`pl`, `pn`, `ps`: 166, 201 and 111 I1 checks), 0 violations, 0 errors.
- GC `removeBatch` of 25 keys (strict readwrite) holds the store: Note 9 p50 94 / 408 / 410 ms at 1 / 4 / 16 MiB units (p95 up to 603 ms); desktop (i9 under l7 load) 14 / 23 / 66 ms; an unrelated read waits for essentially the whole batch (hold within 0-2 ms of the batch time). One ascending pass per platform; no size curve claimed.
- Mutant C (`m_gcCheckOutside`) run once on desktop localhost: no red in 2,936 checks, so the harness workload cannot reach the window; amendment C6 stands (a backendIndexedDb unit test pins it). Informational only.
- **Hidden-tab stall (Note 9)**: a tab that is hidden or backgrounded runs slower for about 45 to 75 s, then stops posting entirely (no progress, no timer tick), onset 45 to 60 s after hiding in the runs that were left hidden (`hid1`, `hid2`, `phid2`; `hid3` also went silent); it resumes on foreground and I1 holds after. In chain mode (one long awaited readonly walk per check) the visible peer stalled up to 62 s and ended in `Store2UnknownOutcomeError` (orphan write) and GC `gc:done:unknown-outcome` once each (30 s watchdog); in batch mode (`hid3`, 3-4 callback rounds) the peer did 432 ops in 85 s with no watchdog and a longest gap of 1.8 s. Mechanism INFERRED: Chrome freezes the hidden page; a frozen page holding an open transaction blocks a peer's write on the same store until it resumes or the peer's watchdog fires. The in-page transaction was not traced. The library's own transactions are one to two callback rounds, so the exposure is smaller than the harness's chain walk but not zero. Safety held; the liveness exposure remains; the replay cannot reach it. For the final Gate 2 disclosure.
- A force-stopped bulk left a staging marker; later bulks refused `marker-present`, ordinary commits proceeded (expected until session-start recovery, which the harness does not run).
- Not done: concurrent two-tab on the phone (alternated segments only; Chrome on the phone has no split view); a hidden tab on desktop Chrome; LAN repeats (each LAN run once); a mutant run on the phone; transaction tracing inside the hidden tab; the Tauri ghost check (not in this device brief: confirm in final Gate 2 whether the stage 1b devA-E coverage includes it); raw per-sample arrays (only p50 / p95 / max kept); `hid2-A` and `hid3-A` produced no result JSON (their numbers come from `progress.log`).

## 10. Criteria not met, never-reached items and open observations

Criteria not met or only partly met:
1. R14 floor margin: a margin of at least 2 seeds for `recover:invalid:missing` cannot be met at 20 seeds (section 4); met only by raising R14 to 40 seeds with the re-measurement named there. No tree change was made.
2. R17g/Tauri: the long pair was not re-run under `816eec012` (section 2). All 5,178 flagged seeds were re-run clean under it; a no-allowance control over the full list was not run (222-seed sample only).
3. Server mutant `srvUnsortedLocks`: no separate stuck-request detector was added to the live test (plan 2f-7 asked for one); the in-tree completion test catches the mutant (section 7b).
4. Mutant coverage by unit tests only (section 7d): 6 E1-1 or library mutants have no replay, corpus or PCT detection.
5. Stale mutants: 4 never loaded as written; 2 re-targeted and red, 2 diagnostics not re-run (section 7c). `g5sSkippedNoCheck` ran as a composite with a stale half (section 7a). The mutant table therefore has 59 fully applied red rows, not 61.
6. Live GC under contention: 98.9 % of passes ended in conflict or unknown outcome, 10 applied batches in the 1 h main run, under PCT and mutant load; no unloaded baseline.
7. Throughput caveats: the 4x per-run slowdown after about 3 s has an unestablished cause; run counts are host-specific.
8. Device: the not-done list in section 9; the hidden-tab stall is disclosed, not corrected.
9. IDB is under-faulted in 7 of 13 matched fault regions by faults per run (section 5); not traced to a rig or plan cause.

Rare keys or fault kinds never reached in the long runs: **none**. All 45 keys of the 31 pairs, R18a/idb lost-request, R18b/idb lost-response, R3/tauri partial-removal and Node `discardFence:failed` were reached (section 3).

Violations: 5,178, all R17g/Tauri, one cause (checker re-flush artefact), fixed in the checker at `816eec012`, no data at risk (section 2). Non-red failures: 0.

**Update 2026-10-17, status of this list after the later steps (sections 11 and 12):** item 1 (R14 floor margin) is resolved by step 2f-7d; item 6 now has an idle baseline (99.4%, 357 of 359 passes; a workload property); item 4's `markIgnoresPins` is now also caught by `gcPass` (2f-7e); items 2, 3, 5, 7, 8 and 9 stand as written. The final Gate 2 approved the stage with these disclosures (section 12).

## 11. Steps after this record (added 2026-10-17; sources: `f7d-report.md`, `f7e-report.md`, `g7e-verdict.md`, `gF-verdict.md`, the commit messages)

Labels as in the preface: EXECUTED here means a command run by the named agent and read from its report; the records pass re-ran nothing.

### 11.1 Step 2f-7d, commit `cafcba9e6` (test code only, `src/ts/storage/tests/store2/replay/regions.ts`)

Class: compatibility guard (smoke floors); the bite check is a diagnostic. `git diff -- src/ts/storage/store2` was empty. Change in R14: seeds 20 to 40 (a prefix extension: `seedsOf` is 1..seeds, and R14 has no IndexedDB variant), a new floor on the reached key `recover:invalid` (the key behind the outcome label `recover:invalid:missing`; the label itself is not a reached key), and Node `commit:committed` raised from 0.15 to 0.20. No floor was lowered. Floors at 40 exercised runs (needed = ceil(floor x 40), margin = reached minus needed; EXECUTED, `f7d-r14-40.log`):

| backend | key | floor (old) | reached / 40 | needed | margin |
|---|---|---|---|---|---|
| node | `recover:invalid` | 0.10 (none) | 7 | 4 | 3 (68% of the long-run rate 14.67%) |
| tauri | `recover:invalid` | 0.075 (none) | 5 | 3 | 2 (70% of the long-run rate 10.75%) |
| node | `commit:committed` | 0.20 (0.15) | 12 | 8 | 4 (0.15 would be 50% of the 30% rate) |
| node | `bulk`, `clearMarker:clear`, `recover:installed`, `recover:installed:planted` | unchanged (0.6, 0.6, 0.3, 0.3) | 35, 34, 17, 17 | 24, 24, 12, 12 | 11, 10, 5, 5 |
| tauri | `bulk`, `clearMarker:clear`, `recover:installed`, `recover:installed:planted` | unchanged (0.6, 0.45, 0.3, 0.3) | 35, 27, 18, 18 | 24, 18, 12, 12 | 11, 9, 6, 6 |
| both | `minFaulted` (default 0.5, not edited) | 0.5 | node 28, tauri 22 | 20 | node 8, tauri 2 |

Exceptions the report names: the Node `recover:invalid` floor 0.10 is 57% of its 40-seed smoke rate (about 60% was the target); 0.125 would leave a margin of 2, so 0.10 was kept for margin 3. Tauri has no `commit:committed` floor (6 of 40, `commit:failed` 16), unchanged. Evidence (EXECUTED): full `pctSmoke` 81 passed before (27.8 s) and after (40.2 s) with the 1 h live run running concurrently, so the timings are noisy (R14 itself costs about 0.4 s per backend at 40 seeds); the counts agree with section 4 (Node 7, Tauri 5 in 40); the bite run (floors raised one step to Node 0.2 and Tauri 0.15, scratch edit restored byte-identical by hash) fails R14 with "was reached in 7 of 40 exercised runs" and "5 of 40" (2 failed); `pnpm check` 0 errors. Limits: floors are deterministic-seed guards (they catch a change in which seeds reach a key, not the long-run rate) and the Tauri `recover:invalid` margin is exactly 2. The final Gate 2 judged the change correct (attack 5) and executed the full storage tests with it applied: 195 files, 6,208 passed, 17 skipped.

### 11.2 Step 2f-7e, commit `25e57bb57` (test code only, `src/ts/storage/tests/store2/gcPass.test.ts`)

Class: a mutation-killing guard, green on the current source by design (no pre-fix defect exists; `store2` unchanged). The mutant `markIgnoresPins` (GC marks from the commit key with its `pins` dropped) was caught only by `gcMark.test.ts` (section 7c, row 6; final Gate 2 finding 2). New case "a tree reached only by a pin keeps every unit and its manifest while unrelated dead units are deleted" on memory, Node, IndexedDB and the Tauri stand-in (4 cases): a second complete tree is stored whose manifest is only pinned (commit key with `retained` empty and `pins` naming that manifest, `current` the seed tree), a full pass runs, every pinned unit and the manifest remain and the two dead units are deleted (`deleted 2`, one batch). EXECUTED by the coder and by the Gate 2 reviewer: unmutated, the single file 99 passed; under `markIgnoresPins` (in-memory edit through the `l7m` mutant config, load confirmed) exactly the 4 new cases fail, each with `deleted: 15` (13 pinned keys plus 2 orphans, so the whole pinned tree was collected); storage tests 195 files, 6,212 passed, 17 skipped; `pnpm check` 0 errors; `gcPass.test.ts` bytes CRLF 691, LF-only 0, lone CR 0, no BOM. Limits: the Tauri case uses desktop stand-ins, not Rust commands; only this one mutant was re-run. Gate 2 (`g7e-verdict.md`): `[EDITORIAL]`, no substantive finding; one unrelated test had been renamed by accident (a space after a comma lost) and was reverted before commit. The pin-only tree is now caught by `gcPass` as well as `gcMark`, which removes the disclosure of section 7d for this mutant.

### 11.3 Idle live baseline (MEASURED, `l7-live600-idle.log`, 2026-10-17)

A 600 s live-server run named an idle (unloaded) baseline in the carry notes; no PCT queue was running during it (the queue ended 2026-10-16T15:41:10Z, section 1; the run is timestamped 2026-10-17 02:16:47 to 02:27:47, and no f7d or f7e scratch log has a modification time inside that window), other host load was not recorded, and the section 6 run overlapped the PCT queue. Result: 0 violations; GC 14 batches applied, 325 keys deleted; 177 `commit-conflict` plus 180 `unknown-outcome` = 357 of 359 passes (99.4%; 359 = `gc:done` 2 + 177 + 180, equal to the capability-probe request count of 359, and the carry notes' "373" added the 14 applied batches, which are not passes), against 98.9% in the loaded 1 h run of section 6. The final Gate 2 read the log: the 180 unknown outcomes equal the fixture's 180 dropped `remove-checked` replies, and the end state listing 299 equals the wanted 299, so GC kept up. Reading (the run's author, INTERPRETATION): the contention is a property of the workload (3 committers committing back to back plus deliberate dropped replies), not of host load. A 1 h idle run also ran and passed, but its live report was not captured (the default reporter hides `console.info`; the next run needs `--reporter=verbose --silent=false`), so no 1 h idle figures exist.

## 12. Final stage 2 Gate 2 (`opus-reviewer`, `gF-verdict.md`, 2026-10-17): `[APPROVE]`

Snapshot reviewed: worktree `alite-s2` at HEAD `816eec012` (base `3db5140c6`) plus the then-uncommitted 2f-7d edit to `regions.ts` (later committed as `cafcba9e6`; 2f-7e came after the review and has its own Gate 2, section 11.2). EXECUTED by the reviewer: `vitest run src/ts/storage/tests --maxWorkers=8` 195 files, 6,208 passed, 17 skipped, exit 0, 210.65 s; `pnpm check` 0 errors 0 warnings; a byte scan of all 102 branch files plus `regions.ts` (working tree all CRLF, committed blobs all LF, no lone CR, no BOM, none mixed); `git diff --stat 3db5140c6..HEAD` 102 files, +19,158 / -145, equal under `--ignore-cr-at-eol`; store2 still unwired (no import outside `src/ts/storage/store2` and the tests); only `430aa8a0d` touches `src-tauri` and `Cargo.lock` is unchanged. Attack results in brief: completeness (2f-1 to 2f-7 committed or run, 78 of 78 pairs met 20,000 runs and 1 h and 8 workers, device check done with disclosed gaps, deviations A to J and the carry-note items recorded); the library across steps found no I1 defect (the two `putUnit` sites are the only ones and both stop on `flushed === false`; Tauri `putUnit` and the pooled units report `=== true`; every Tauri decisive write and removal is gated and a stale page fails definite); test integrity (the `816eec012` allowance only adds a conjunct that can remove G1 reports, so every run clean at `f0895733a` stays clean); disclosures honest, none blocking for merging an unwired library. **A Tauri ghost device check is not owed by stage 2** (Report 62 and the plan's device section name IndexedDB only; no stage 1b or 2 device result contains a ghost, generation or registration check).

Findings (all non-blocking) and what happened to each:

| # | Finding (kind) | Disposition |
|---|---|---|
| 1 | E7 not ready to copy: the runner configs hardcode the worktree and scratch paths, the mutant definitions are a 14-file import chain of which the record hashed 3 (carry, before records closeout) | Done at records time: nine files in `replay-tools/` (flattened mutant chain in `mutants.mjs`, roots from `RISU_ROOT` and `RISU_SCRATCH`, README with SHA-256 of the other eight files, which the verification pass re-computed and found equal; no absolute path, user name, `worktrees` or scratch path in any of them). Not copied: `l7-listmut.mjs`, `l7-mutant-batch.ps1`, the `f7c` re-run files and the `l7r-*` scripts (section 8.1). |
| 2 | `markIgnoresPins` detected only by `gcMark.test.ts`, so a pinned-only tree had one detector | Closed by step 2f-7e (section 11.2): `gcPass` now catches it on four backends. |
| 3 | `MC-297` wording: the carry-note summary of `modelD-results.md` section 7 item 1 left out "lost on the restorer together with lost on the other actors" (records, editorial) | `MC-297` cites section 7 items 1 to 5 in full, including that combination. |
| 4 | The final check list has no Rust step (carry, records) | Section 13: the Rust evidence is reused from `430aa8a0d`. |
| 5 | The native gate has never run on a device (carry for stage 4a; not owed by stage 2) | Carried: section 14, first item. |
| 6 | Pacing: the plan's "pacing against Node's 20,000 requests per minute" is only an optional `pace` hook between removal batches with no default; the mark's per-key Node reads (`node.ts` `readUnits`) are unpaced; a 429 makes the mark refuse (safe), not lose data | Carried to stage 4 (section 14) and named in plan v3.4 amendment 6. |
| 7 | The uncommitted 2f-7d edit (process) | Committed as `cafcba9e6` with the report's figures (section 11.1) before the merge. |

## 13. Rust evidence (reused, not re-run)

The final stage 2 snapshot has no Rust step of its own. The applicable Rust evidence is that of `430aa8a0d` (the page-generation gate): `cargo test --lib` 176 passed (28 new), tauri 2.12.1 per `main`'s `Cargo.lock`, Gate 2 `[APPROVE]` with 13 reviewer mutants killed (commit message). Only `430aa8a0d` touches `src-tauri` between `3db5140c6` and `b7bbd2521` (`git log` per the final Gate 2; `git diff --stat 3db5140c6 b7bbd2521 -- src-tauri` lists 6 files, 1,140 insertions and 4 deletions, read by the records pass), and `Cargo.lock` is unchanged (final Gate 2). The final Gate 2 says to re-run `cargo test --lib` with `CARGO_TARGET_DIR` outside the tree only if `main` moves under `src-tauri` before the merge; the merge's first parent is `3db5140c6`, the unchanged `main` (section 16), so no re-run was owed. `chunked_io`'s trailer test is flaky on Windows at the base too (a mtime-only identity); it was not changed.

## 14. Carry items for stage 4 and later (not done in stage 2)

1. **The native gate's first device run, on a Note 9 Tauri build** (final Gate 2 finding 5): registration, a gated commit write and fence write (including the chunked Android path), a reload in the middle of a write, and removal. The gate is covered by Rust unit tests, fakes and the replay only; the chunked Android `writeTop`, a reload during a gated write and the IPC re-send of a non-idempotent registration have no device evidence.
2. **Pacing** (finding 6): stage 4 sets the policy for Node's 20,000 requests per minute and the 429 injection; today the `pace` hook is optional between removal batches, the mark's per-key reads are unpaced, and a 429 makes the mark refuse.
3. **Wiring** (carry notes): pass `session.backend` (never a spread or proxy of `Store2Session`) and `session.commitRead` to recovery, recovery pick and the fence calls; re-run the recovery screen from the carried `current` after a `conflict`; the `Store2Session.open` capability probe; wire the backend's stale state into `Store2Session.idleReason` before the ungated `store2-sweep` write or the asset-sweep removals are connected.
4. **Ghost mechanism on ungated writes:** the `store2-sweep` plain write and any Tauri asset-sweep removals (compare-then-delete across IPC) have the same ghost mechanism as the fixed commit-key path (decide at 4a); the owner-id write is ungated and a ghost id can at worst make the device's own marker look foreign (never I1).
5. **Result versus message:** no property ties a `committed` or `installed` result with `flushed: false` to what the user is told (in the `c409_12` schedule, after the flush-fault drop, the second commit is silently gone), and the replay's INST judges that a write was applied, not that it is durable.
6. **Replay inputs for the 4a re-run:** the replay is the regression guard to re-run against the wired save step; the live-server test's main-run "GC batches applied > 0" assertion may fail on a slower host or a short `RISU_LIVE_SECONDS` (add capped extensions first); ask for `--reporter=verbose --silent=false` when counts are wanted. The smoke takes about 57 to 69 s after 2f-7a (target near 60 s).
7. **Not reached by the replay** (disclosed, section 9): the Android hidden-tab stall (the visible peer's operation stalled up to 62 s in the harness's chain walk (OBSERVED) and a transaction wait ended at the 30 s watchdog as an unknown outcome; safety held; mechanism INFERRED), the two-tab serialisation of a real browser's removal transaction (mutant C), and a concurrent two-tab run on a phone.
8. **Later stages:** `store2/` temp files are not swept (`store2` is not in `WRITE_TEMP_DIRECTORIES`, stage 5); the flush tracker's idle message wording ("this page load") and the N2 limit (an unflushed fence write followed by a discard leaves GC idle until reload) are stage 5 items; the release items of the freeze (devtools feature, unsigned release APK) and the Pi-class host check for `SWEEP_AUTO_LIMIT` are still open. The Android `not-raw` refusal of raw-body invokes is by design (Tauri 2.12.1 `ipc-protocol.js` has no custom-protocol IPC on Android; the orchestrator's reading from the carry notes, not reopened here).

## 15. Final checks on `25e57bb57`

The merge `b7bbd2521` has the same tree as `25e57bb57`, so these checks cover the merged tree. Source: the merge commit message and the records brief, run by the orchestrator's owner of the final snapshot (the records pass re-ran nothing): full `pnpm test` 776 test files, 16,882 passed, 21 skipped; `pnpm check` 0 errors; `pnpm build` OK (the brief's word; the message says it ran). Storage tests alone at the same snapshot: 195 files, 6,212 passed, 17 skipped (`g7e-tests.log`, `f7e-tests.log`). Rust: section 13.

## 16. The merge, stated accurately

`b7bbd2521` (2026-10-17T07:14:42+09:00, "Merge feat/alite-s2: A-lite stage 2 (GC library, Report 62 A3 replay)") is a `--no-ff` merge. Checked by the records pass with read-only git: parents `3db5140c6` (unchanged `main`) and `25e57bb57`; the merge's tree (`6aad7994c`) equals the tree of `25e57bb57`; the diff against `3db5140c6` is 102 files, 19,221 insertions, 145 deletions, with no file under `src/ts/storage/store2/format` or `src/ts/storage/tests/store2/format`. The merge message says it "fast-forwards over" `main`; that wording is inexact (a fast-forward creates no merge commit), and the form above is the accurate one. The merge message records the maintainer's go-ahead of 2026-10-17 (the maintainer's own words are not recorded). The local `origin/main` ref equalled `b7bbd2521` when the records pass checked it (no fetch).

