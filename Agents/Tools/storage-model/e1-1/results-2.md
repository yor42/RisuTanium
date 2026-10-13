# E1-1 follow-up (results-2): F1 recovery window, fix candidates, re-runs on the final files

Scratch only, folder `stage13prep\e1-1\`. Every number is **executed** with its log name in `logs\` unless marked *reasoning*. Process hygiene: no process was killed in this follow-up (all runs ended on their own; `suite3.pid`, `suite4.pid` record the launcher PIDs). Node v24.19.0.

Files changed since results.md: `patch8.cjs` (fix candidates `recFix='rec'|'cur'`, `recNoCheck`), `patch9.cjs` (fix candidate `recFix='refuse'`). All default off. Snapshot of the final patch7 files before the follow-up: `model.patch7-final.mjs`, `presets.patch7-final.mjs`.

Reduced actor set for steps 1, 2, 4 (`presets.mjs`: `r_*`, `ri_*`): A (1 ordinary commit), B as healer (1 ordinary commit), GC (1 pass, any order), R (1 recovery), one damage event, no restore/pins/admission/bulk, `faultCap=1`, property (L) on, merged GC (R2), `orphanAbs`. Node preset = silent damage; IndexedDB preset = bump damage.

## 1. F1 settled: CONFIRMED (log `L1.json`, `bfs2_r_base.json`, `X_ri_base.out`)

Shortest counterexample, 12 steps, 46,115 states explored by BFS (0.7 s), property (L):

1. ENV: commit key damaged (silent). 2-3. R boots, reads it unparsable. 4-5. R picks `m/0`, reads its tree. 6. R marker CAS: `current` unnamed, `staging=[R,prefix]`. 7. GC pass: marks nothing, candidates `m/0`, `u/0`. 8. GC removes `m/0` (check-only passes at the marker's version). 9. R crashes. 10-11. R reboots, sees its own marker (start-up clear). 12. R's start-up clear: the key now parses with no current and no marker, and no manifest with all its units remains.

Same shape on the IndexedDB preset (bump damage), also 12 steps (`X_ri_base`, 4,812 states, 4 violations found by the parallel explorer). Consequence: with the plan-as-written reading (assumption 9) a crash during recovery followed by a start-up clear can lose the whole profile once GC has run in the window. This needs only R's crash plus GC; no second fault.

## 2. Fix candidates (all three exhausted with 0 violations, property (L) and the extended (a) on)

| Candidate | What changes | States | Time | Result | Log |
|---|---|---|---|---|---|
| **rec** (your proposal) | marker carries `rec` = chosen manifest; GC marks `rec` like current; every clear of a marker with `rec` (start-up, foreign, abandon, R's own) writes `current := rec`; the marker write checks that the chosen manifest and its units exist | 90,809,773 | 507 s | PASS | `X_fixRec` |
| **cur** | marker names the chosen manifest as `current`; same existence check in the marker write; nothing else changes | 93,099,449 | 513 s | PASS | `X_fixCur` |
| **refuse** (simpler, new) | GC refuses while the commit key names no current (the existing "refuse unparsable key" rule extended by one clause); boot treats "parses but no current" like an unparsable key (recovery screen again); marker CAS stays `current: null`; no new field | 83,978,143 | 688 s | PASS | `X_fixRefuse` |

IndexedDB reduced set (executed): rec 14,401 states, cur 15,583, refuse 14,922, all PASS (`X_ri_fixRec`, `X_ri_fixCur`, `X_ri_fixRefuse`). Bump damage lets devices park early, so this set is small (see "Limits").

Findings that apply to the candidates:
- **Both rec and cur depend on the existence check inside the marker write.** Without it each fails in 11 steps: GC (which read the old key before the damage) deletes the chosen manifest between R's tree read and the marker CAS, and the marker then names a missing manifest (`bfs2_r_fixRec_nochk.json`, `bfs2_r_fixCur_nochk.json`, violation (a), 11 steps). On Node that is check-only on the manifest plus all its units (the real limit is 60 keys, the model's K=2 was lifted for this write: *reasoning/assumption*, a profile with more than 60 units in the chosen manifest needs a fallback); off Node it is a read inside the same transaction or mutex hold.
- **refuse needs no existence check**, because the marker names nothing and R holds the tree in memory. Its cost: the recovery screen can reappear after any clear of a recovery marker, and GC is idle until recovery completes. *Reasoning:* a user who never finishes recovery gets no GC at all.
- **cur** is the most visible change to other devices: during the window other tabs see a current profile and may commit on it; R's final CAS then conflicts and R abandons (clear leaves the newest current). Model result: PASS. *Reasoning:* the recovered profile may silently be older than what the user last saw.
- I report all three and do not pick one.
- Mutant `m_recDirect` against the fixes (executed, shortest 11 steps for each): `r_fixRefuse_direct` (`X_fixRefuse_direct`, 16 violations), `r_fixRec_direct` and `r_fixCur_direct` (`bfs2_*.json`). Still caught, same trace as before (GC deletes the chosen manifest between tree read and the direct install). None of the fixes masks the mutant. On the IndexedDB preset the same mutant is NOT caught (`X_ri_base_direct`: 2,041 states, 0 violations): bump damage changes the bytes, so the damage itself fences every GC batch built on the old read. That is a model-fidelity point, not a protocol weakness (Node silent damage is the case that exercises it).

## 3. Re-runs on the final files (state counts identical to the earlier run; correct protocol, 0 violations)

| Run | Configuration | States | Time | Earlier | Log |
|---|---|---|---|---|---|
| `F_f1` | Node, restore, pin, admission, abandon, A 1 ord + bulk, B 1 ord + pin, GC any order, `faultCap=1`, no damage | 94,119,831 | 425 s | 94,119,831 (`f1`) | `F_f1` |
| `F_T_all` | Tauri, every fault, full bounds | 34,371,907 | 104 s | 34,371,907 (`T_all`) | `F_T_all` |
| `F_I_nodmg_f1` | IndexedDB, save-mine, `faultCap=1`, no damage/recovery | 57,079,650 | 338 s | 57,079,650 (`I_nodmg_f1`) | `F_I_nodmg_f1` |

These ran on the model after patch7 and patch8 (patch9 was applied while the queue was running; its edits are inactive unless `recFix='refuse'`, and the counts are unchanged). The equal counts are the evidence that the patches do not change the correct protocol.

## 4. IndexedDB damage + recovery on the reduced set

Executed (`X_ri_base`, `X_ri_fixRec`, `X_ri_fixCur`, `X_ri_fixRefuse`): base fails with (L) in 12 steps; the three fixes are exhausted with 0 violations (14.4 K, 15.6 K, 14.9 K states).

Limits: with bump damage every device that reads the damaged key parks and every device CAS conflicts, so this set is small and does not include the heal case or GC batches built before the damage that survive it. The earlier combined IndexedDB damage+recovery run with all features (`I_nosm_f1`) remains unfinished at the 1,800 s cap. The bulk path (A's bulk) and restore/pins are not in the reduced set.

## Exit-bound status against your conditions

- F1 settled: yes (confirmed; three fix candidates exhausted; choice left to you).
- f1 re-run on the final files: yes, identical count, PASS.
- Targeted runs: T_all PASS, I_nodmg_f1 PASS, IndexedDB reduced set PASS with a fix.
- The IndexedDB in-transaction GC check: recorded as **not exercised by the model** (`m_gcCheckOutside` uncaught, reduced-bounds exhausted, see results.md).

## Reproduce

```
cd "C:\Users\yor42\AppData\Local\Temp\claude\C--Projects-RisuAI\7373226a-26bd-41e1-bd9d-31e3becc2524\scratchpad\storage\stage13prep\e1-1"
node bfs.mjs r_base --bits 27                      # step 1, 12-step trace (also ri_base)
bash run.sh X_fixRec 1800 pexplore.mjs r_fixRec --workers 26 --bits 31     # likewise r_fixCur, r_fixRefuse, ri_fixRec, ri_fixCur, ri_fixRefuse
node bfs.mjs r_fixRec_nochk --bits 27              # likewise r_fixCur_nochk (existence check removed)
node bfs.mjs r_fixRefuse_direct --bits 26          # mutant m_recDirect against a fix (likewise r_fixRec_direct, r_fixCur_direct)
bash run.sh F_f1 1800 pexplore.mjs e1_node --workers 26 --bits 31 --set damage=0 --set recoveries=0 --set restores=1 --set pinOps=1 --set admission=true --set abandonClear=true --set faultCap=1
bash run.sh F_T_all 1800 pexplore.mjs e1_tauri --workers 26 --bits 31
bash run.sh F_I_nodmg_f1 1800 pexplore.mjs e1_idb --workers 26 --bits 31 --set faultCap=1 --set damage=0 --set recoveries=0
```
Drivers used: `suite3.sh`, `suite4.sh` (summaries `logs\suite3.summary`, `logs\suite4.summary`). `X_base` (`--all`) died with an out-of-memory exit 134 because the base configuration has many violating states; the BFS trace above is the evidence for step 1.
