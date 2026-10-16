# Agents/Tools/storage-model — A-lite stage 1+3 Gate 1 evidence, plus the stage 2 replay record and tools

Selected scratch evidence behind the A-lite stage 1+3 Gate 1 (passed 2026-10-14; `MC-290`, Report 62 Part D, ledger rows 1743 to 1750). Apparatus and records only; the stage 2 replay record (`stage2-replay-record.md`) and the stage 2 replay tools (`replay-tools/`) were added at the stage 2 closeout (2026-10-17). **Not application code and not part of any build.** Nothing in `src/` imports from here. Raw logs, patch scripts and base copies of the model were not kept; they stay in session scratch (temporary).

**Paths inside the files refer to the original scratch layout.** Files cite `S\stage13\...`, `S\stage13prep\...`, `W:` / `M:` (the stage 0a worktree and `main`), and `logs\`, `patch*.cjs`, `model.base-*.mjs` that are not here. Read those as provenance, not as paths that exist in the repository. `S` = `C:\Users\yor42\AppData\Local\Temp\claude\C--Projects-RisuAI\7373226a-26bd-41e1-bd9d-31e3becc2524\scratchpad\storage\`.

**Hardware.** Every timing in these files was measured on an i9-13900KF with 64 GB (the Note 9 figures in `remeasure/results.md` are from a Chrome page, not the installed app). They are best-case hardware figures; no Pi-class box, mid-range phone or real Tauri/Android app path was run. Do not read any of them as frame-budget or Pi/phone compliance.

**Runtime.** Node v24.19.0 (the version the scratch runs recorded).

## Files

| File | What it is | Author role / label |
|---|---|---|
| `plan-v3.4.md` | The approved stage 1+3 Gate 1 plan (CRLF, as written). Full format, protocol, deleter, boot-table, test and open-item text. Report 62 Part D summarises it. | `investigator` draft; orchestrator applied the v3.4 edits J1, J2 |
| `reviews/r1-review.md` | Gate 1 round 1, `opus-reviewer`, plan v2: `[REJECT]` | independent review |
| `reviews/r2-review.md` | Round 2, plan v3: `[REJECT]` | independent review |
| `reviews/r3-review.md` | Round 3, plan v3.1: `[APPROVE WITH CONDITIONS]` (conditions C1 to C13) | independent review |
| `reviews/r3-conditions-check.md` | Check of plan v3.2 against the round 3 conditions: `[APPROVE WITH CONDITIONS]` (C11, C13 partial; N1 to N5; R-a) | same reviewer, resumed |
| `reviews/r3-conditions-check-2.md` | Check of plan v3.3: `[APPROVE WITH CONDITIONS]` (D1, E1) | same reviewer, resumed |
| `reviews/r3-conditions-check-3.md` | Check of plan v3.4, D1 and E1 only: `[APPROVE]` | same reviewer, resumed |
| `e1-1/model.mjs`, `presets.mjs` | The E1-1 protocol model (an extension of the S0-5a model) and all its configurations and mutants | scratch model, EXECUTED |
| `e1-1/explore.mjs`, `pexplore.mjs`, `bfs.mjs` | Single-thread explorer, parallel explorer (96-bit fingerprints), shortest-counterexample search | drivers |
| `e1-1/run.sh`, `mut3.sh`, `mut4.sh` | Run wrappers (log name, cap, explorer args); mutant suites. They write `logs/` next to themselves | drivers |
| `e1-1/results.md`, `results-2.md` | The author's results: runs, mutants, the F1 finding and three fix candidates. **`e1-1-verify/verify.md` overrides them where they differ.** | author; AUTHOR-ONLY unless the verifier re-ran |
| `e1-1-verify/verify.md` | Independent verification of E1-1 (`deep-investigator`): F1 confirmed and wider, "refuse" fix holds, divergences D1 to D13 | independent; takes precedence |
| `nodelist/results.md`, `bench.cjs` | Node `/api/list` at 387,504 keys (i9) and the scratch prefix-route prototype; the harness | `perf-analyzer`; raw packet, MEASURED |
| `remeasure/results.md` | Independent re-measure of P5 (S0-8 root-write series), P6 (16-shard mark) and P10 (two-tab IndexedDB probe) | `perf-analyzer`; MEASURED, best-case hardware |
| `stage2-replay-record.md` | The accepted stage 2 replay record (2026-10-17): 78 region/backend pairs, the R17g/Tauri finding and fix, mutant tables, device results, the final Gate 2 findings and the carries for stage 4a+4b. Sections 0 to 10 are the original scratch record; sections 11 to 16 were added at closeout. Input to the stage 4a+4b Gate 1. | `perf-analyzer` record, closeout additions by the records pass; MEASURED / OBSERVED / INFERRED labels as in the file |
| `replay-tools/` | Portable copies of the stage 2 mutant runner, long PCT runner and flattened mutant definitions (nine files; its README gives usage, the scratch-name mapping and SHA-256). Run from the repository root; output goes to a scratch directory. | stage 2 closeout copy; smoke-run only (c4, markIgnoresPins, one PCT pair), not the full queue |

The `.mjs`, `.cjs` and `.sh` files in `e1-1/` are not tests (no `*.test.*` name). `replay-tools/pct-worker.test.mjs` matches the default Vitest include and is skipped unless `L7_REGION` is set, so `pnpm test` reports it as one skipped file.

## Reproduce

Everything below needs Node v24.19.0 (`node --version`) and, for the `bash run.sh` lines, a bash (Git Bash on Windows). Run from `Agents/Tools/storage-model/e1-1/`; the `cd` lines in the original files point at the scratch folder and do not apply here. The wrappers write `logs/` into that folder. The full-bounds runs need many GB of memory (the originals used 26 workers and `--bits 30` or `31` on a 64 GB machine); lower `--bits` or `--workers` to fit and expect an inconclusive or table-full result where the original had margin. The commands are copied from `e1-1/results.md` and `e1-1/results-2.md`.

```
node --version                                   # v24.19.0
# original controls, S0-5a bounds, shortest trace (results.md)
node bfs.mjs c1_noGcCheck --bits 22              # likewise c2_noUnitCheck c3_sepRetention c4_bulkNoMarker c5_freshRead
# main exhaustive runs (exit 0 pass, 2 violation, 4 table full, 124 cap)
bash run.sh f1 1800 pexplore.mjs e1_node --workers 26 --bits 30 --set damage=0 --set recoveries=0 --set restores=1 --set pinOps=1 --set admission=true --set abandonClear=true --set faultCap=1
bash run.sh I_nodmg_f1 1800 pexplore.mjs e1_idb --workers 26 --bits 31 --set faultCap=1 --set damage=0 --set recoveries=0
bash run.sh T_all 2400 pexplore.mjs e1_tauri --workers 26 --bits 31
bash run.sh p_rec0 900 pexplore.mjs e1_node --workers 24 --bits 29 --set bulkA=0 --set crashes=0 --set restores=0 --set pinOps=0 --set lost=0 --set admission=false --set merge=false
# mutants
bash mut4.sh <preset...>                         # shortest trace (bfs.mjs)
bash mut3.sh <preset...>                         # full-bounds search (pexplore)
# F1 (results-2.md): 12-step counterexample, then the three fix candidates
node bfs.mjs r_base --bits 27                    # likewise ri_base
bash run.sh X_fixRec 1800 pexplore.mjs r_fixRec --workers 26 --bits 31     # likewise r_fixCur, r_fixRefuse, ri_fixRec, ri_fixCur, ri_fixRefuse
node bfs.mjs r_fixRec_nochk --bits 27            # likewise r_fixCur_nochk
node bfs.mjs r_fixRefuse_direct --bits 26        # likewise r_fixRec_direct, r_fixCur_direct
```

`--set k=v` overrides any `DEFAULT` field of `model.mjs`; `presets.mjs` lists every configuration. `results.md` and `verify.md` give the rest of the run names and the state counts to compare against (for example `f1` 94,119,831 states, `X_fixRefuse` 83,978,143).

The Node list measurement (`nodelist/bench.cjs`) needs a populated fixture folder (`cwd-main/save`, 383,000 `assets/` files, 4,500 `store2/` files and a server copy with a scratch-only `/api/list-prefix` route), none of which is kept here; its usage line is `node bench.cjs <port>`. TODO(evidence): the fixture generator and the patched server copy were not kept. The P5/P6/P10 harness (`lib.mjs`, `page*`, `ctl.mjs`, `p10*`) was not copied either; `remeasure/results.md` names it.

## Limits to carry

- E1-1 exit bound is `faultCap=1`: at most one crash-or-lost-response in total. A scope bound, not a sound reduction; the full Report 62 A2 bounds were not exhausted (see Report 62 Part D, D6, and plan section 6).
- Provenance of counts (verifier re-run vs author-only vs never re-run) is in plan section 6 and `e1-1-verify/verify.md`.
