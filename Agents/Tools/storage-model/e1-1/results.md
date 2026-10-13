# E1-1 model extension: results (scratch, 2026-10-13; nothing written in the repository)

Folder: `S\..\stage13prep\e1-1\` (S = `...\scratchpad\storage\s0`). Node v24.19.0, i9-13900KF (32 threads), 64 GB. Executed, not reasoned: every number comes from a run whose raw output is in `logs\`.

## Verdict (read this first)

- **The full plan bounds were NOT exhausted. Per the plan this is a finding that blocks the freeze until the Orchestrator rules.**
  The union of all faults (1 crash + 1 lost response for each of A, B, GC, restorer, recovery, plus damage) exceeds the 4 h cap and the 12 bytes/state fingerprint table (~1.8 B states in 26 GB). Measured blow-up is below.
- **Exhaustive, 0 violations (correct protocol):** Node, all features, at most ONE crash-or-lost-response event in total (94.1 M states, 413 s); Tauri variant with every fault enabled, full bounds (34.4 M states, 106 s); IndexedDB without damage/recovery, at most one fault (57.1 M states, 330 s); Node damage+recovery with no bulk/crash/lost/restore/pin (10.0 M states, 45 s, includes the heal-then-409 case, see below). Not complete: see "Not finished".
- **Mutants:** 20 of 21 caught (the original 5 controls included, shown separately). One not caught: `m_gcCheckOutside` (analysis below).
- **Two findings for the Orchestrator** (not invariant violations; details below): (1) recovery marker with `current` unnamed leaves a loss window; (2) the IndexedDB in-transaction GC check is redundant for the modelled actors.
- Process note: I stopped model/probe processes by command-line pattern. Two stops (an `explore.mjs` PID 8156 early on, and a few `bash`/`timeout` wrappers) may have matched processes not started by me. Nothing else on the machine was knowingly touched.

## Files

`model.mjs` (model), `presets.mjs` (all configurations and mutants), `explore.mjs` (single-thread DFS/exact/BFS, original), `pexplore.mjs` (parallel, 96-bit SHA-1 fingerprints), `bfs.mjs` (new: shortest counterexample, replay-based trace), `run.sh`, `mut3.sh`, `mut4.sh`, `suite2.sh`, `probes*.sh` (the drivers), `patch1..7.cjs` (the edits applied to the copied base, in order), `model.base-verified.mjs` (verified S0-5a copy), `model.base-s05a.mjs` (s0-5a copy), `model.pre-merge.mjs`/`presets.pre-merge.mjs` (snapshot before patch5), `logs\`.

Base: the verified copy `verify\v-5a-16\modelv\model.mjs` (keeps the verifier's switches `noG`, `dropMarker`, `noPfxSkip`, `restoreNoIf`) plus correction 7 of `corrections-5a-16.md` (`nd.cm.wr = 1` after the bulk-marker CAS, taken from `s0-5a\model.mjs`). With every E1 feature off the model reproduces `s0-5a\model.mjs`: BFS state counts c1 2,786, c3 10,507, c5 897 are identical to the s0-5a model (the 2,612/9,851/824 in S0-5a results.md come from the pre-fix verified copy).

## Modelling assumptions (for the Orchestrator to rule)

1. **Lost response = the write is applied, the reply never arrives.** A request that is lost before it is applied is not modelled separately: its server effect equals the existing 409/PARK/abandon branches.
2. **Uncertain-outcome remedy (the plan gives it only for the final CAS).** After a lost reply the actor reads the commit key first. Ordinary commit / save-mine: my manifest is `current` -> done; otherwise treated as a commit-key conflict (PARK, RELOAD, SAVE-MINE). Bulk marker: my marker (owner, prefix) stands -> continue, else bulk conflict. Bulk final: my manifest is `current` -> done and nothing is cleared, else bulk conflict (PARK, restart with new marker, or ABANDON). Unit upload: re-upload under a new key (I2). Start-up clear: re-read. Foreign clear: prompt closes, reload. Pin: reload. Restore: read; my target is `current` -> done, else retry/give up. GC remove: pass abandoned and restarted (as for a 409).
3. **Abandon-clear** = read the commit key; only if its `staging` equals this owner id AND prefix, CAS ifVersion = the version just read, value = the read value with `staging:null`; any conflict leaves the marker and parks. Offered after a bulk final conflict and after a retry-bound exhaustion. The device parks afterwards.
4. **Mutant `aclearNoRead` (my construction):** no read after an uncertain final CAS; the owner issues a blind clear built from its base, at the base version, and on a 409 retries at the 409's `currentRevision`.
5. **Pins** are a list in the commit key naming manifest keys. One pin-change op (pin or unpin one manifest of its base) is given to device B. Rotation drops the oldest unpinned entry; if all are pinned retained may exceed `RL` (never reached at these bounds).
6. **Admission:** the previous `current` enters `retained` only by a nondeterministic admit, forced when `retained` is empty. Restore and save-mine always push.
7. **Save-mine (off Node, IndexedDB model):** one atomic step (read the commit key fresh, rewrite every unit "mine" names under fresh keys, new manifest, CAS at the just-read version); keeps `staging` and `pins`; pushes the peer's `current`. Tauri model: save-mine exists in the code but is not enabled in the Tauri preset.
8. **Damage:** one event at any time. `silent` (Node preset): revision unchanged, content unparsable, so a device holding the pre-damage base CAS-succeeds and heals the key. `bump` (IndexedDB preset): bytes differ, no heal possible. Readers that find it unparsable park; GC refuses.
9. **Recovery install (the plan does not say what `current` is during the marker window):** the marker CAS writes `{current:null, retained:[], pins:[], staging:[R,prefix]}`; every unit is re-written under fresh keys; the final CAS names the new manifest, `retained` empty, `pins` empty. This is the reading consistent with "the result never relies on old units surviving". Candidates = every existing manifest key (`m/...` and any `s/.../m*`; the staging prefix is unknown while the key is unparsable). The chosen manifest and its units are read in one atomic step (a missing unit fails loudly, the user picks another).
10. **seq (only for the seq-only mutant):** recovery writes `seq = chosen manifest's seq + 1`. Correct protocol compares full bytes, which the model represents by the ground-truth version.
11. **Owner id** is stable per device by default (Tauri-like, so the start-up clear works). `ownerFresh` (web) exists as a switch but was not run in the suites.
12. **Tauri:** a unit write may land with a failed directory flush (one fault); the writer re-writes under a new key. A commit-key write may have an unconfirmed flush (one fault); GC refuses until a later successful commit-key write. One power loss removes unflushed units, reverts an unconfirmed commit key to its last durable value, and restarts every actor.
13. **`retire outside the prefix` and the S0-13 v1 replay parser** are server-side mutants already killed by the stage 0a tests; in the model they are represented client-side/at restart: `gcOutsidePrefix` (GC candidate list includes the commit key) and `replayV1` (a Node restart replays with a parser that ignores delete records, so a deleted key's old revision passes a check-only again). The model cannot exercise the server's refusal itself.
14. Commit-key location outside `alite/` (C8): the commit key is never in GC's listing unless the `gcOutsidePrefix` mutant is on.

## Reductions used (each is sound for safety; reported as required)

- **R1 `orphanAbs`:** a lost response on a data-unit upload leaves no orphan key. The orphan is never named, never read; deleting it is a stutter step for every other actor, and the GC bookkeeping states it would add are dominated by a not-yet-started pass. (Manifest orphans are kept when recovery is on, because the candidate list can show them.)
- **R2 `merge`:** GC pass = one atomic step (list, read commit key, read manifests, mark). A listing taken at the read has a superset of any earlier listing's keys, so every deletion the real gap allows is also available; manifests are write-once and only GC deletes them, so reading them commutes. The restorer's begin is fused with its read. Merging shortens traces (controls then show 6/6/11/7/7 steps on the E1 Node bounds; unmerged on the S0-5a bounds they are 9/9/11/10/7).
- **Canonical encoding / norm** (S0-5a) unchanged; a fast path and per-object encoding caches were added (pure speed-up; the control state counts above match).
- **Scope bound `faultCap`:** at most this many crash + lost-response events in total, exhaustive inside it. This is a scope bound, NOT a sound reduction; it is the proposal below.

## Per item: what was added (all in `model.mjs`)

- (a) lost responses: `devSucc` (`up`, `cas`/`tx`, `b1`, `b3`, `sc`, `pin`, `sm`, `acCas`, `fcCas` each emit an "applied, response lost" successor), the `unc` step, `gcSucc` `del`, `rsSucc` `cas` + `unc`, `recSucc`; budget `cfg.lost` per actor, `lostSet`.
- (b) save-mine: `devSucc` `sm` step, `ckConflict` (SAVE-MINE branch), `cfg.saveMine`.
- (c) pins/admission/restore: `pushRet`, `retVariants`, `ckWrite` (property (p): pins change only by a pin op), `devSucc` `pin`, `gcSucc` mark (`named` / `ms`), `rsSucc` (always pushes; property (r)).
- (d) abandon-clear: `devSucc` `acRd`/`acCas`/`acBlind`, `bulkConflict` (ABANDON branch), `unc` `bf`; `ckWrite` (h) kind `aclear` checks owner id and prefix.
- (f) IndexedDB: `devSucc` `tx` (units + commit key in one atomic step, no mutex), `gcSucc` `del` (in-transaction check of the commit key), `del2` mutant; Tauri variant: `applyMutex`, flush faults in `up`/`cas`, `envSucc` power loss.
- (g) recovery: `recSucc` (actor R: boot read, candidate list, tree read, marker CAS, uploads, final CAS, C2 re-read, abandon, start-up clear, crash, lost responses), `envSucc` damage, `ckWrite` conflict/heal semantics; mutants `recDirect`, `recRetryBlind`.
- New properties: (g') a CAS never succeeds against a key other than its base, (p) pins, (r) restore pushes, (I4) commit key never removed, optional (L) `lossProp`.

## Runs of the correct protocol

| Run (name in `logs\`) | Configuration | States | Time | Result |
|---|---|---|---|---|
| `f1` | Node, restore, pin, admission, abandon, A 1 ord + bulk, B 1 ord + pin, GC any order; **at most 1 crash-or-lost event in total** (`faultCap=1`); no damage | 94,119,831 (293.3 M transitions) | 413 s | PASS, 0 violations |
| `I_nodmg_f1` | IndexedDB (`e1_idb`), save-mine, `faultCap=1`, no damage/recovery | 57,079,650 | 330 s | PASS |
| `T_all` | Tauri (`e1_tauri`), **all faults** (1 crash, 1 lost per actor, flush failure, commit-key flush failure, power loss), full bounds, no bulk | 34,371,907 | 106 s | PASS |
| `p_rec0` | Node damage (silent) + recovery, A 1 ord, B 1 ord, no bulk/crash/lost/restore/pin/admission (unmerged model) | 9,973,029 | 45 s | PASS; 39,518 edges are "recovery marker CAS found the commit key changed" (the C2 re-read path, includes the heal case); 9,261 edges "GC refuses unparsable commit key" |
| `r_adm`, `l_A`, `l_B`, `l_Q`, `l_G`, `c_A`, `c_B`, `c_G` | single-feature sizing (PARK only, no damage), one actor's lost responses or crashes | 4.1 M, 14.4 M, 20.8 M, 17.0 M, 30.8 M, 16.5 M, 27.8 M, 20.5 M | 18-130 s | PASS (some on the pre-merge model) |

### Not finished (blow-up; where)

| Run | Configuration | Outcome |
|---|---|---|
| `c_all` | Node, crashes for A, B, GC, Q (no lost), pre-merge model | cap 1,502 s: >=330 M states with 23% of seeds claimed; not finished |
| `lost_all`, `r_lost` | Node, lost responses for all actors | >=154 M states at 607 s with ~10% of seeds; stopped |
| `f2` | Node, `faultCap=2` | >=172 M states at 783 s with 16% of seeds; stopped |
| `q_bulk` (pre-merge, pre-orphan) | Node damage+recovery, with A's bulk | >=146 M at 787 s, 12% of seeds; stopped |
| `I_nosm_f1` | IndexedDB, damage(bump)+recovery, `faultCap=1` | cap 1,803 s: >=124 M, no verdict |
| `N_rec_f1` | Node damage+recovery, `faultCap=1`, no restore/pin | cap 1,803 s: >=233 M at 1,566 s (9% of seeds); no verdict |
| `N_rec_nofault` | Node damage+recovery, no faults, all other features | stopped by me at 411 s (>=51 M, 0.7% of seeds) |
| `N_reload0` | Node, reload + redo (both devices commit), no faults | stopped by me at ~1,117 s (>=172 M, 1.2% of seeds) |

Where the space goes: lost responses and crashes multiply each other and GC's any-order subsets (single-actor lost/crash runs are 4-8 times the 4.1 M no-fault base; all four at once is >100 times); the recovery actor with damage at any time plus GC any-order is the next multiplier; `reload`+`redo` (device retries create fresh garbage keys under any-order GC) another. The 96-bit table holds about 1.8 B states.

**Proposal (labelled: opinion, not decided).** (1) Accept "at most k faults in total" as the scope bound: k=1 is exhaustive and green for Node, IndexedDB (no damage) and Tauri-all; k=2 needs about 4-8 times the cap on this machine. (2) A genuinely sound next step is dead-key canonicalisation (keys no actor can ever reference again are replaced by a counter per prefix class, GC's any-order subsets collapse); it needs a proof of the live-set definition and should be gated. (3) Add a non-exhaustive sampling run (random walks of the full-union model) as supplementary evidence only. (4) Run damage+recovery on its own actor set (A, GC, R, one healer) without restore/pins/admission.

## Mutants

Trace length = steps of the **shortest** counterexample (`bfs.mjs`, merged model, full E1 bounds unless noted; log `bs_<name>.out`). "Found at full bounds" = `pexplore.mjs` on the full E1 configuration (log `pm_<name>.out`; its trace is not necessarily shortest).

| Mutant | Switch / preset | Caught | Shortest trace | Found at full bounds | Violation |
|---|---|---|---|---|---|
| orig. control (i) no check-only on GC | `c1_noGcCheck` (S0-5a bounds, unmerged) | yes | 9 | | (a) |
| orig. control (ii) no unit check-only | `c2_noUnitCheck` | yes | 9 | | (a) |
| orig. control (iii) separate retention key | `c3_sepRetention` | yes | 11 | | (a) |
| orig. control (iv) bulk without marker | `c4_bulkNoMarker` | yes | 10 | | (a) |
| orig. control (v) fresh-read CAS | `c5_freshRead` | yes | 7 | | (g) |
| the five controls on the E1 Node bounds (merged) | `e1n_c1..c5` | yes (all) | 6, 6, 11, 7, 7 | | (a),(a),(a),(a),(g) |
| abandon-clear without id-and-prefix check | `m_aclearNoCheck` | yes | 14 (reduced bounds: no crash/lost/restore/pin/ord, BFS at full bounds ran out of memory); 38 found at full bounds | 6.5 M states, 32 s | (h): clears the recovery marker |
| abandon-clear without the read after an uncertain final CAS | `m_aclearNoRead` | yes (assumption 4) | 8 | yes | (g) |
| restore CAS drops `staging` | `m_restoreDropStg` | yes | 8 | yes | (h) |
| restore does not push `current` | `m_restoreNoPush` | yes | 6 | yes | (r) |
| save-mine drops `staging` | `m_smDropStg` | yes | 5 | yes | (h) |
| save-mine drops `pins` | `m_smDropPins` | yes | 5 | yes | (p) |
| mark ignores `pins` | `m_markIgnoresPins` (needs reload+redo) | yes | 16 (reduced bounds: no crash/lost/restore/damage/bulk); 44 at full bounds | 6.1 M states, 30 s | (a) pinned manifest missing |
| GC not skipping a staging prefix | `m_gcNoPfxSkip` | yes | 5 | yes | (h) |
| off-Node reuse of earlier units | `m_reuseUnits_tauri` / `m_reuseUnits_idb` (need reload+redo) | yes / yes | 11 / 7 | yes | (a) |
| IndexedDB commit split in two transactions | `m_idbSplit` | yes | 6 | yes | (a) |
| IndexedDB GC check outside its transaction | `m_gcCheckOutside` | **NO** | | full bounds: no violation in 900 s (344 M states, inconclusive); reduced bounds (no crash/lost/damage/pin/admission): exhausted, 302,566 states, 0 violations | |
| Tauri commit-key write before durable units | `m_ckBeforeUnits` | yes | 2 | yes | (a) |
| Tauri commit names a unit whose flush failed | `m_nameUnflushed` | yes | 5 | yes | (a) after the power loss |
| (extra) Tauri GC ignores the unconfirmed commit-key flag | `m_tauriGcIgnoresCkFlag` | yes | 15 | yes | (a) |
| recovery installs existing units without the marker fence | `m_recDirect` | **yes (so not a mutant-validity finding)** | 11 | 41 steps | (a): GC deletes the chosen manifest's units between the tree read and the direct install |
| (extra) recovery retries its marker CAS blind at the 409's version | `m_recRetryBlind` | yes | 9 | yes | (g) |
| seq-only compare off Node | `m_seqOnly` (needs reload+redo, seqTrack) | yes | 10 | yes | (g): a recovered key reuses a seq a tab holds |
| retire/GC outside the prefix | `m_gcOutsidePrefix` | yes | 2 | yes | (I4); see assumption 13 |
| S0-13 version-1 replay parser | `m_replayV1` | yes | 7 | no (900 s at full bounds, inconclusive; found at reduced bounds) | (a) |

Why `m_gcCheckOutside` is not caught (reasoning, supported by the exhausted reduced run): in the IndexedDB model an ordinary commit writes its units and the commit key in one transaction, so no unit exists before the commit that lists it; bulk units sit under a marker that GC reads or is fenced from; every non-fresh name in a new manifest comes from the base, which is `current` at the CAS. Nothing the modelled actors do makes a key that was garbage at GC's read become referenced afterwards, so the in-transaction check never decides an outcome. Consequence for the freeze: the check is defence in depth at the modelled bounds; the plan's justification (P10: "a bulk marker write changes the commit key so a GC batch built on an earlier read fails its check") is not exercised because the marker is written before the prefix keys exist and GC lists before it reads the commit key. Not a protocol weakness; the Orchestrator may keep the check as cheap insurance or ask for an actor that can make an old candidate live (for example a second GC or a restore of an unmarked manifest).

## Findings (not violations of I1-I3, I7)

- **F1 (UNCERTAIN design hole, needs a ruling).** With `current` unnamed during recovery (assumption 9), GC reading the marker marks nothing and every other manifest and unit becomes a candidate; the model records GC deleting manifests while `current` is null (`OBS` counter). If the recovering device then crashes and the marker is cleared (start-up clear with a stable id, a confirmed foreign clear, or an abandon-clear), the commit key parses with no `current` and no candidate may remain: the profile reads as empty. Property (L) (`lossProp`) is implemented to demonstrate it but was not run to a counterexample. Alternative readings (marker names the chosen manifest as `current`) break I1 in the window before the marker CAS, as `m_recDirect` shows; the plan wording points to the null reading, so this is a disclosed cost of the simpler design that the plan's text does not mention beyond "retained starts empty".
- **F2.** The model never exercises a Node restart (correct parser) or the server-side refusal of out-of-prefix retire; those stay with the stage 0a tests.
- **F3.** Both-devices-commit histories need `reload`+`redo` (PARK alone lets only one device commit, as the S0-5a verifier noted). Those runs exceed the cap at full bounds (`N_reload0`); the mutants that need them were caught with them on.

## Reproduce

```
cd "C:\Users\yor42\AppData\Local\Temp\claude\C--Projects-RisuAI\7373226a-26bd-41e1-bd9d-31e3becc2524\scratchpad\storage\stage13prep\e1-1"
node --version                                   # v24.19.0
# original controls, S0-5a bounds, shortest trace
node bfs.mjs c1_noGcCheck --bits 22              # likewise c2_noUnitCheck c3_sepRetention c4_bulkNoMarker c5_freshRead
# main exhaustive runs (parallel explorer; exit 0 pass, 2 violation, 4 table full, 124 cap)
bash run.sh f1 1800 pexplore.mjs e1_node --workers 26 --bits 30 --set damage=0 --set recoveries=0 --set restores=1 --set pinOps=1 --set admission=true --set abandonClear=true --set faultCap=1
bash run.sh I_nodmg_f1 1800 pexplore.mjs e1_idb --workers 26 --bits 31 --set faultCap=1 --set damage=0 --set recoveries=0
bash run.sh T_all 2400 pexplore.mjs e1_tauri --workers 26 --bits 31
bash run.sh p_rec0 900 pexplore.mjs e1_node --workers 24 --bits 29 --set bulkA=0 --set crashes=0 --set restores=0 --set pinOps=0 --set lost=0 --set admission=false --set merge=false
# mutants: shortest trace / violation search
bash mut4.sh <preset...>       # shortest (bfs.mjs), summary in logs\mut4.summary
bash mut3.sh <preset...>       # full-bounds search (pexplore), summary in logs\mut3.summary
node bfs.mjs m_aclearNoCheck --bits 27 --cap 80000000 --set crashes=0 --set lost=0 --set restores=0 --set pinOps=0 --set admission=false --set ordA=0 --set ordB=0
node bfs.mjs m_markIgnoresPins --bits 27 --cap 80000000 --set crashes=0 --set lost=0 --set restores=0 --set damage=0 --set recoveries=0 --set bulkA=0
node pexplore.mjs m_gcCheckOutside --workers 26 --bits 29 --set crashes=0 --set lost=0 --set damage=0 --set recoveries=0 --set pinOps=0 --set admission=false --set restores=1
```
`--set k=v` overrides any `DEFAULT` field of `model.mjs`; `presets.mjs` lists every configuration. Note: `f1` and the sizing runs were produced by the model as it stood after patch6; patch7 only changes the `replayV1` mutant's tombstone handling and null-guards manifest lookups (no effect on the correct protocol); rerun `f1` on the final files if the verifier wants a single snapshot (about 7 minutes).
