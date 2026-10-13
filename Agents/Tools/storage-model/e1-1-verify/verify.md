# E1-1 independent verification (deep-investigator, 2026-10-13)

Scratch only. Nothing in the repository and nothing in `stage13prep\e1-1\` was written. Inputs read: `e1-1\model.mjs`, `presets.mjs`, `bfs.mjs`, `explore.mjs`, `pexplore.mjs`, `run.sh`, `mut3.sh`, `mut4.sh`, `results.md`, `results-2.md`, `logs\*.summary`; `stage13\plan-v1.md` (Sections 0 to 4, 6, 7.3, 9, 10); `Agents\Reports\62-storage-rewrite-gate1-plan.md` A1.2, A1.4, A2 "Stages 1+3", A3, A5.1. Stage 0a worktree grep (`C:\Projects\RisuAI\.claude\worktrees\alite`) for commit-key readers.

Environment: Node v24.19.0, 32 logical CPUs, 64 GB (about 36 GB free at start; another user's long-running node process, PID 33256, was competing for CPU, so times are slower than the author's). All runs on byte-identical copies (`SHA-256` prefix `model.mjs 16C42BA2B67114D7`, `presets.mjs 2A5124B470F6F037`, same as the `e1-1` originals).

Artefacts (all under `stage13prep\e1-1-verify\`):
- `run\` : unmodified copies of model, presets, explorers, `driver.ps1` (sequential runner, 1,800 s cap, records PIDs in `logs\pids.txt`), `logs\` (V_* and bs_* runs).
- `run2\` : copy of the model with two verifier-only switches, both default off and inactive in every run that does not set them: `lossProp2` (property L2, below) and `flagLostOnCrash` (Tauri: a device crash also loses the in-process commit-key flush flag). `driver2.ps1`, `logs\` (W_*, X_*, bfs_* runs).
- Adaptation from the given commands: `--bits` lowered from 30/31 to 28/29 for memory (open-addressing table size only; states and verdicts do not depend on it). Runs were driven by `driver.ps1`/`driver2.ps1` instead of `run.sh`, because `run.sh` writes into its own directory.
- Process hygiene: every node process I launched was recorded (`run\logs\pids.txt`, `run2\logs\pids.txt`); processes stopped: `W_refuse_fclear_L2`, `W_refuse_rec2_L2` and `W_ri_refuse_wide` by the driver's own 1,800 s cap (PIDs recorded); `W_refuse_f2_L2` (PID 51932, recorded at launch) stopped by me with `taskkill /PID 51932 /T` after 420 s, because it was going to be inconclusive. Two foreground BFS commands (`bfs_r_*_L2` loop, `bfs_tauri_flagLost_reload`) died of V8 out-of-memory on their own (exit 134); nothing was killed by name or pattern.

Labels: EXECUTED = I ran it and the number is in my logs. READ = I read it in source. REASONED = inference, not run.

---

## Verdict on the prior investigation

**Holds with corrections.** Every number I re-ran reproduced exactly. The F1 counterexample is real and is a plan defect, and it is broader than results-2 says: it needs no clear and, through a foreign clear, no crash. The "refuse" fix passes everything I ran against it. But it needs two rules outside the model before the freeze: `current` must be nullable in the frozen commit key, and the asset sweep must refuse too. Corrections:

1. F1 does not depend on the start-up clear. The loss happens the moment the recovering page crashes after GC has run: 9 steps, web owner ids, marker still standing. A foreign clear of a live recovery's marker loses the profile with no crash at all, in 11 steps (EXECUTED, below).
2. "The IndexedDB in-transaction GC check never decides an outcome" is true only for the base and refuse protocols. Under `cur` or `rec`, the `m_gcCheckOutside` mutant is caught within the plan bounds (16 steps, EXECUTED).
3. The `rec`/`cur` existence check cannot be a single Node check-only write. A real manifest reaches thousands of units through its shards, module index and buckets, against a 60-key limit. The model's flat manifest (one unit) hides this.
4. The model's Tauri flush flag survives crashes. Plan 4.5 says it is in-process. With the flag lost on an app restart, a Tauri I1 violation appears (27 steps, EXECUTED).
5. results.md's headline "Node, all features, faultCap=1, 0 violations" excludes damage and recovery. The only damage+recovery exhaustive run (`p_rec0`) had crashes=0, which is why F1 was missed there. E1 never enables `foreignClear` or web owner ids.

---

## 1. Fidelity: CONFIRMED with divergences (none hides a violation in the base protocol as modelled; D3, D4, D6, D9 and D12 matter for the fix and the freeze)

Step-by-step check against plan-v1 Section 3, Section 4.3 to 4.6 and Report 62 A1.2 (READ):

| Area | Plan | Model | Match |
|---|---|---|---|
| Commit-key CAS | Node `ifVersion` through `writeChecked`; off Node full bytes with fresh `epoch` (3.4) | `ckWrite`: version equality; off Node a ground-truth version (every write bumps it, so no ABA) | Yes. A power-loss revert gives byte-equal content in reality but a bumped version in the model. That is benign: content decides liveness and every actor restarts (REASONED) |
| Unit check-only (Node), K | check-only on every new unit; at most 59 | `units` list, `K=2` | Yes (bounds) |
| Bulk marker/staging | marker CAS, prefix covers manifest and shards, final CAS | `b1`/`up`/`b3`; prefix `s/<id><seq>.b<n>/`; manifest uploaded last | Yes |
| GC mark | list, read commit key at R, mark current ∪ retained ∪ pins, skip standing prefixes, refuse if unparsable (A1.2) | merged step (R2), `ms` = cur/ret/pins(/rec), `underPrefix` skip, refuse on `dmg` | Yes |
| GC removal | Node: check-only commit key == R; IDB: in-transaction re-read; Tauri: per batch under mutex, re-compare (4.5 last bullet) | Node/IDB: version check before each 1-key delete; **Tauri: whole pass holds the mutex, `gcCheck:false`** | D1 |
| Recovery | candidates by key form incl. staged (plan-v1 3.2); read tree; marker CAS at damaged revision/bytes; rewrite every unit; final CAS; 409 → re-read, abandon if parses | `recSucc`, as stated; `current:null` in the window (assumption 9) | Yes, except the plan is silent on `current` in the window (F1) |
| Abandon-clear | CAS only if staging = my id and prefix; read first after an uncertain final CAS | `acRd`/`acCas`, `unc bf` | Yes |
| Restore | CAS that always pushes `current` | `rsSucc`, choices retained ∪ pins | Yes |
| Admission | previous current enters only if retained empty or 5 min; restore and save-mine always push | nondeterministic admit, forced when empty | Yes |
| Save-mine | rebuild from a fresh read, keep staging/pins/convertedFrom, push the peer's current | one atomic step, every unit rewritten under fresh keys | Sound reduction (read+CAS fused). Stricter than the plan on reuse (D8) |
| IDB commit | one strict transaction, `add` units, compare full bytes | `tx` step | Yes |
| Tauri flush | failed unit flush → re-write under a new key; failed commit-key flush → GC refuses until a later flush; flag in-process | `up`/`cas` faults, `env.ckUnf` global, survives device and GC crashes | D2 |

Divergences:
- **D1 Tauri GC atomic pass** (`presets.mjs` E1_TAURI `gcCheck:false`; `model.mjs` CRIT G covers list..del). The model is stronger than the plan. Plan behaviour is the IDB pattern, which is modelled and passes, but not together with the Tauri faults. Could hide an interleaving bug between mark and batch on Tauri. Low.
- **D2 Tauri flush flag survives crashes.** The plan says "The flag is in-process" (plan-v1 4.5). It hides a violation: see New finding N2.
- **D3 Flat manifest.** The model has manifest → units. Real is manifest → shards/index/buckets → units. Harmless for GC marking, which follows the closure (plan-v1 4.6). It hides the infeasibility of the rec/cur existence check on Node (Q4).
- **D4 Foreign clear and web owners never run in E1.** `foreignClear:false` in every E1 preset; `ownerFresh` is off (assumption 11). Report 62 I3 lists the confirmed foreign clear as one of the four ways a marker is removed. On the web it is the only way after a crash. It hides F1-without-crash (Q3).
- **D5 Recovery identity split.** R has owner `R`, distinct from devices A and B. A device's own start-up-clear code never meets a recovery marker. Under refuse this is irrelevant (Q4).
- **D6 One recovery actor.** Under refuse, every page that boots in the window gets the recovery screen. Concurrent recoveries are unmodelled (REASONED safe, Q4).
- **D7 Candidate set.** plan-v1 3.2 includes staged `g-` manifests; Report 62 A1.2 says "not under a staging prefix". The model follows plan-v1. A document inconsistency to settle; not a safety issue.
- **D8 Save-mine rewrites every unit.** The real reuse rule (which base or fresh-read units may be named without rewriting) is not exercised. There is no mutant for "save-mine reuses units not named by the fresh read". Low.
- **D9 Asset sweep (MC-289) not modelled.** It is decision-critical under refuse (N1).
- **D10 GC batch of 1 vs 25.** Conservative.
- **D11 Node damage only `silent`; IDB only `bump`.** Node damage through a write (bump) is not run on the Node preset. It is the easier case.
- **D12 `current` typed non-null.** plan-v1 3.4 has `current: { key, at }` with no null. The model, F1 and the refuse fix all need `current: null`.
- **D13 Tauri preset** has no bulk, no damage/recovery and no save-mine. "T_all: all faults, full bounds" is overstated: it is full bounds minus bulk, damage and recovery.

The 14 modelling assumptions (results.md lines 22 to 35):

| # | Verdict | Note |
|---|---|---|
| 1 lost = applied | CONFIRMED adequate | lost-before-apply equals the conflict branches |
| 2 uncertain-outcome remedies | CONFIRMED consistent with plan-v1 4.2 ("re-read the commit key before acting") | per-kind choices are the model's |
| 3 abandon-clear | CONFIRMED matches A1.2 | |
| 4 `aclearNoRead` construction | CONFIRMED, with a caveat | a blind clear at the base version alone would just 409 and be harmless. The mutant kills only because it retries at the 409's revision (`model.mjs` `acBlind`). The plan's wording of the mutant must name that retry, or the test can pass vacuously |
| 5 pins | CONFIRMED | |
| 6 admission | CONFIRMED | |
| 7 save-mine atomic | CONFIRMED sound | D8 |
| 8 damage modes | CONFIRMED | D11 |
| 9 `current:null` in the window | plan silent; this is F1 | under refuse it becomes the specified behaviour; requires D12 fixed |
| 10 seq | CONFIRMED (mutant only) | |
| 11 stable owner | **divergence for the web** | I ran `ownerFresh` (Q3, Q4) |
| 12 Tauri | **divergence** | D2, N2 |
| 13 server-side mutants client-side | CONFIRMED as disclosed | the model cannot exercise server refusal |
| 14 commit key outside prefix | CONFIRMED | |

## 2. Re-execution: CONFIRMED (every claimed number reproduced)

| Run | Command (my copy) | Claimed | Mine | Log |
|---|---|---|---|---|
| c1..c5 shortest traces | `node bfs.mjs <c> --bits 22` | 9, 9, 11, 10, 7 steps | 9, 9, 11, 10, 7; exit 2 each | `run\logs\bs_c*.out` |
| c1/c3/c5 state counts | `node explore.mjs <c> --mode bfs` | 2,786 / 10,507 / 897 | 2,786 / 10,507 / 897 | console. (`bfs.mjs` gives 4,465 / 17,134 / 1,070 for the same presets; the claimed counts come from `explore.mjs`, which results.md line 18 does not say) |
| F1 base (L), Node | `node bfs.mjs r_base --bits 27` | 12 steps, 46,115 states | 12 steps, 46,115 states, identical trace | `run\logs\bfs_r_base.json` |
| F1 base (L), IDB | `node bfs.mjs ri_base --bits 27` | 12 steps | 12 steps, 4,812 states | `run\logs\bfs_ri_base.json` |
| fix rec | `pexplore r_fixRec` | 90,809,773, PASS | 90,809,773, 0 violations, 564 s | `run\logs\V_fixRec.out` |
| fix cur | `pexplore r_fixCur` | 93,099,449, PASS | 93,099,449, 0, 567 s | `V_fixCur.out` |
| fix refuse | `pexplore r_fixRefuse` | 83,978,143, PASS | 83,978,143, 0, 731 s | `V_fixRefuse.out` |
| f1 (Node, faultCap=1, no damage) | as results.md line 129 | 94,119,831, PASS | 94,119,831, 0, 473 s | `V_f1.out` |
| m_gcCheckOutside reduced | results.md line 138 | 302,566, 0 | 302,566, 0 | `run2\logs\W_gcOut_reduced.out` |

Small observation: in `V_fixRefuse.out` the counter labelled "GC refuses => unconfirmed commit-key flush" (1,798,359) actually counts null-current refusals. The label is chosen by `v.dmg ? ... : 'unconfirmed commit-key flush'` in `gcSucc`. It is cosmetic, but anyone reading the refuse log will be misled.

## 3. The F1 trace: CONFIRMED real protocol defect, not an artefact of assumption 9 or of the start-up clear

Hand walk against plan-v1 4.6 and Report 62 A1.2 "Damaged commit key". Steps 1 to 6 are plan-literal: the marker CAS at the damaged revision, then "every unit is re-written under fresh keys, so the result never relies on old units surviving". The plan gives the marker no `current`, `retained` or `pins` to keep, because the base is unparsable. Step 7: a GC that reads the marker finds a parsable key (it refuses only "unparsable", A1.2) and marks nothing. Step 8: it deletes `m/0`. Step 9: the recovering page crashes and its in-memory tree is gone. At that point no manifest with all its units exists.

Discriminating runs (EXECUTED, `run2`, property L2 = "R has crashed, `current` is null, no complete candidate manifest", marker standing or not):
- `r_base --set ownerFresh=true --set lossProp=false --set lossProp2=true` (web owner ids, so no start-up clear is possible): **9 steps**, marker still standing (`run2\logs\bfs_r_base_L2.json`). The start-up clear in the 12-step trace only makes the loss visible to property L. It is not a cause.
- `r_base --set ownerFresh=true --set foreignClear=true --set ordB=0` (property L): **11 steps, no crash**. Steps: B opens the Q3 prompt, damage, R marker, B confirms the foreign clear of R's live marker, GC marks nothing and removes `m/0`. R's final CAS can then only 409 (`run2\logs\bfs_r_base_web_fclear.json`).

Is it an artefact of assumption 9? No. The only other reading consistent with the plan's text is that the marker names the chosen manifest as current (`cur`). That reading breaks I1 without an existence check inside the marker write (results-2: `r_fixCur_nochk`, 11 steps; I did not re-run that). The plan's own sentence "never relies on old units surviving" points to the null reading. So plan-v1 as written is defective under both readings: one loses the profile, the other breaks I1.

## 4. Fix candidates

### refuse (the maintainer's choice): CONFIRMED as implemented and safe at every bound I ran, with two required additions (N1, D12) outside the model

Implementation check (READ, `model.mjs`):
- GC refuses when `cfg.recFix === 'refuse' && v.cur === null`, in both the merged (`gcSucc` start) and unmerged (`rdCK`) paths.
- Recovery boot (`recSucc rdCK`) treats "parses, `cur === null`" as the recovery screen. That check runs before the start-up-clear check, so under refuse R never start-up clears.
- The marker stays `current: null` and no field is added.
- Devices that read a null current park (`devSucc rdCK`) rather than showing the recovery screen. Only actor R recovers (D6).
- That matches results-2's description.

Runs (EXECUTED):

| Run | Configuration beyond `r_fixRefuse` (A 1 ord, B 1 ord healer, GC, R, silent damage, faultCap 1, L on) | States | Result |
|---|---|---|---|
| `V_fixRefuse` | none (re-run) | 83,978,143 | PASS |
| `W_refuse_web_L2` | `ownerFresh=true`, L2 on | 83,978,143 | PASS |
| `X_refuse_fclear_small` | `foreignClear=true`, `ordB=0`, `ownerFresh=true`, L2. The same configuration on the base protocol fails in 11 steps (Q3) | 1,278,370 | PASS |
| `W_refuse_fclear_L2` | `foreignClear=true`, L2, `ordB=1` | ≥178 M at the 1,800 s cap, about 30 % of seeds | no violation found, inconclusive |
| `bfs ri_fixRefuse` | IDB, `gcCheckOutside=true`, `ordA=3` | 5,161,140 (exhausted) | PASS |
| `W_refuse_rec2_L2` | `recoveries=2` (a second recovery run after the first ends) | ≥233 M at the 1,800 s cap, about 18 % of seeds | no violation found, inconclusive |
| `W_ri_refuse_wide` | IDB, `ordA=2`, `bulkA=1`, `foreignClear=true`, L2 | ≥174 M at the 1,800 s cap, about 6 % of seeds | no violation found, inconclusive |
| `W_refuse_f2_L2` | `faultCap=2`, L2 | ≥58 M when I stopped it at 420 s (about 14 % of seeds; it was heading for the cap) | no violation found, inconclusive |

Interactions:
- **Multiple tabs / devices (REASONED, not modelled, D6).** Refuse is robust here because its safety predicate lives in the commit-key state ("no current means no GC"), not in who holds a marker. Two recovering tabs: the second marker CAS replaces the first (the model's `(h)` allows `rbegin` over any marker). The first's final CAS 409s and it gives up. Old manifests survive because every GC refuses throughout. Losing a recovery in another tab is a UX cost, not a loss. **The plan must say** whether a recovery marker may replace a foreign recovery marker. If the bulk rule "a foreign marker stands: wait" (`model.mjs b1`) is applied, a crashed web recovery tab blocks every later recovery until a Q3 foreign clear. That is liveness, not safety. A tab still holding a pre-damage base: its CAS before the marker heals (C2 abandon, modelled); after the marker it 409s, re-reads, and sees null current.
- **Start-up clear on another device (REASONED + EXECUTED).** Only the device whose stable id is in the marker can start-up clear. Any clear of a recovery marker (start-up, foreign, abandon) writes `{current:null, staging:null}` (`model.mjs` R `sc`, `fcCas`, `racCas` use `t.rec || t.cur`, which is null). Under refuse that still refuses GC and shows recovery. So the order of "own marker → start-up clear" versus "no current → recovery screen" at boot does not matter for safety. Foreign clear and web ids are covered by the runs above. The model's device actors never start-up clear a recovery marker (D5), so a real device's own clear code path is covered only by this reasoning. Requirement for implementation: no clear may synthesise a `current` from anything but the value it read.
- **Old (stage 0a) clients (READ).** No stage 0a code reads the commit key. Grep of the `alite` worktree `src` for `alite-commit|ALITE_COMMIT|commitKey`: 0 matches. `server\node` mentions only `ALITE_PREFIX` for retire (`aliteKeys.cjs:5`, `server.cjs:459`). No pre-stage-1 client can misread a null current. The fork has never shipped (MC-011), so no stage-1 build without the rule exists. The real "old reader" risk is the frozen format itself: plan-v1 3.4 types `current` as non-null (D12). **For the freeze:** `current: null` must be a valid v1 value meaning "recovery required" (boot shows the recovery screen; GC, the sweep, restore, pin and save-mine refuse), with a golden vector. Otherwise a later relaxation is a re-meaning of a field, which is a `fmt` bump by plan-v1 3.1 rule 2.
- **Node 60-key check-only limit.** Not touched: the refuse marker has no check-only entries. This is refuse's main advantage over rec/cur.
- **Pre-damage GC batches (REASONED).** With silent damage on Node, a GC that marked the healthy key at R0 keeps passing check-only at R0 until the marker bumps the revision. It deletes only keys that were garbage at R0, so R0's current, retained and pins survive for a re-run of recovery. If R picks a manifest that was garbage at R0, the tree read fails loudly or R already holds it in memory. The IDB `gcCheckOutside` run with `ordA=3` exercises the analogous case and passes.
- **Cost (REASONED).** GC and, with N1, the asset sweep are idle until the user completes recovery.

### rec and cur (lighter check): CONFIRMED as implemented and re-run, but NOT viable as described on Node
- They match results-2 (`model.mjs rb`: `val.cur = M` or `val.rec = M`, check-only on M and its units with `force` off Node; `rec` honoured by every R-side and foreign/abandon clear; GC marks `rec`). Re-runs PASS (table in Q2).
- **Node:** the check covers M plus all its units. A real manifest has 37+ direct refs (16 shards, 16 buckets, 5 fixed, presets, plugins), and the closure reaches every core, chat and chunk unit. That is far above K = 60 (plan-v1 P12, 4.3). results-2's "a profile with more than 60 units needs a fallback" understates it: every real profile needs it.
- **IDB:** with `cur`/`rec` the in-transaction GC check becomes load-bearing (N3).
- **`rec` as a later additive field is unsafe:** plan-v1 3.1 rule 1 lets readers ignore unknown fields, so an older writer would drop `rec`. Moot if refuse is chosen.
- **`cur`** makes other devices commit on a possibly older manifest (results-2 notes this).

## 5. Reductions R1, R2 and faultCap: R1 and R2 CONFIRMED sound (with the conditions below); faultCap CONFIRMED correctly labelled as not sound

- **R1 (`orphanAbs`).** Sound. An orphan data unit is never named by any manifest, never a recovery candidate (only `m/` and staged `/m` keys are), and never read. Its deletion changes only itself. A GC crash or lost response after deleting only the orphan yields a state equal to "pass not yet counted" with one fewer fault spent, which the abstraction reaches with a superset of behaviour. Condition (READ, `model.mjs up`): manifest orphans are abstracted only when recovery is off (`j !== cm.nd || !cfg.recoveries`). That is correct, because with recovery a manifest orphan is a candidate.
- **R2 (`merge`).** Sound for safety. Candidates at the merged instant are a superset of candidates from any earlier listing: same marked set from the same R, and keys are removed only by GC itself. Manifests named at R cannot vanish before the real mark reads them. Power loss resets GC and replay ghosts only add keys. The restorer's fused begin/read is a pure read. Caveat: R2 also merges the Tauri GC, where D1 already makes the pass atomic.
- **faultCap.** results.md calls it a scope bound, not a reduction (line 42). That is correct, and the Report 62 bound (1 crash and 1 lost response per actor) is not met. Concrete region it excludes: an uncertain bulk final CAS (lost response) followed by a crash of the owner before its read. That is the only path to a start-up clear of a marker whose final CAS already landed, and it is unreachable at k = 1. Likewise a lost response on R's marker CAS followed by R's crash.
- **The verdict line overstates.** results.md line 9 "Node, all features" omits that f1 has damage = 0 and recoveries = 0. `p_rec0` (damage + recovery) has crashes = 0, the configuration that hid F1.

## 6. Mutant claims: CONFIRMED for the six spot-checked; the gcCheckOutside reasoning is REFUTED as a general statement

| Mutant | Claim | Mine (EXECUTED) |
|---|---|---|
| `m_recDirect` | caught, 11, (a) | 11 steps, 501,353 states. Trace: GC marks at v1, silent damage, R reads the tree of `m/A1.1.g1`, GC removes it (check-only at v1 still passes), direct install. Matches |
| `m_aclearNoRead` | 8, (g) | 8, (g) (caveat: assumption 4) |
| `m_idbSplit` | 6, (a) | 6, (a) |
| `m_smDropPins` | 5, (p) | 5, (p) |
| `m_tauriGcIgnoresCkFlag` | 15, (a) | 15, (a), 2,549,396 states |
| `m_gcCheckOutside` reduced | 302,566, 0 | 302,566, 0 |

Note: (p), (r) and (h) restate the rule the mutant breaks. They prove the model detects the change, not that the change loses data.

**`m_gcCheckOutside`: "never decides an outcome".** It holds for the base protocol and for refuse, because nothing that was garbage at GC's read can become named later: IDB commits are atomic, bulk keys are created after the marker, and recovery rewrites under fresh keys. It is false under `cur`/`rec`, where the marker names an existing old manifest:
- `bfs ri_fixCur --set gcCheckOutside=true --set bulkA=1` (within the plan bounds): **16 steps**, (a) "manifest `s/A1.b0/m.g2` named by the commit key (current) does not exist". Steps: A's bulk with a lost manifest upload leaves an orphan staged manifest, GC checks at R and pends its delete, damage, R picks the orphan, marker names it, GC deletes it (`run\logs\bfs_ri_fixCur_gcOut_bulk.json`).
- With `ordA=3`, `cur` and `rec` both fail in 15 steps; refuse exhausts 5,161,140 states with 0 violations; base fails only with (L) (`run\logs\bfs_ri_*_gcOut_ordA3.json`).

The plan's justification (Report 62 A1.2: "a bulk marker write changes the commit key so a GC batch built on an earlier read fails its in-transaction check") is indeed not what makes the check matter. The check is load-bearing exactly when a recovery marker revives an old key.

## 7. Decision-critical items the model does not cover

- **N1 Asset sweep under a null current (MC-289; plan-v1 3.8).** The keep-set is the union over `{current} ∪ retained ∪ pins`, and the sweep refuses only "while `commit.staging` is non-null". After any clear of a recovery marker the key is `{current:null, retained:[], pins:[], staging:null}`, so the keep-set is empty except for resident refs and `writtenThisPage`. **The sweep would delete every asset.** Refuse must extend to the sweep (and to an unparsable key), with a test. The model has no assets (D9). REASONED from the plan text; decision-critical for the freeze because it fixes the meaning of `current:null`.
- **N2 Tauri in-process flush flag (plan-v1 4.5 "The flag is in-process").** Run `X_tauri_flagLost_reload`: `e1_tauri` plus `flagLostOnCrash=true reload=true redo=true`, 253,442 states, (a) in **27 steps** (`run2\logs\X_tauri_flagLost_reload.out`). Steps: B commits with a failed commit-key flush, the app restarts (flag lost), GC removes `m/0` (dropped by admission), power loss reverts the commit key to the durable value naming `m/0`. Without reload+redo the bounds produce no garbage manifest (`W_tauri_flagLost`: 35,514,387 states, PASS), so that run is not evidence of safety. Real-world premise: TODO(evidence). Whether a renamed file's directory entry can still be lost by power loss after the process exits, once its directory flush failed, on Android ext4/f2fs and Windows NTFS. On Linux a failed fsync may also clear the dirty state ("report once"), which would make it permanent. Consequence: the flag needs persisting, or boot must re-flush or re-write the commit key before GC. That is an adapter rule, not a format change.
- **N3** IDB in-transaction GC check is load-bearing under cur/rec (Q6).
- Concurrent recoveries (D6); a real device's own start-up clear of a recovery marker (D5); foreign clear at full actor sets (inconclusive at the cap); web owner ids outside the reduced set.
- Two-level tree and the real check-only budget (D3); Node restart with the correct parser and the server's out-of-prefix refusal (results.md F2); risk 3b (a proxy stripping `if-match-revision` makes the commit-key CAS unconditional, plan-v1 4.3 / U5): the model assumes every CAS is honoured.
- Bulk, damage/recovery and save-mine on Tauri (D13). Bulk, restore, pins and admission together with damage/recovery (reduced sets exclude them; `q_bulk`, `N_rec_f1`, `I_nosm_f1` unfinished per results.md).

---

## Summary for the format freeze

Can be relied on (re-executed, or soundly argued):
- At faultCap = 1 and the stated bounds, the base protocol is free of I1/I3 violations without damage: Node f1, IDB, and Tauri minus bulk/recovery.
- The five controls and the spot-checked mutants are caught.
- F1 is a real defect of plan-v1 as written.
- Refuse passes every run I made: Node reduced set, web owners, foreign clear (small set), IDB with GC check outside and wider A. Its safety argument does not depend on marker ownership, tabs or clears.
- R1 and R2 are sound.

Cannot be relied on:
- "Plan bounds exhausted": they are not. faultCap is a scope bound; foreign clear and web owners at full actor sets are inconclusive; damage + recovery with bulk/restore/pins is unfinished.
- Tauri safety under the in-process flag rule (N2).
- Anything about rec/cur on Node (the existence check does not fit K).
- The claim that the IDB GC check is redundant: only under base and refuse.

Freeze-blocking items arising here:
1. `current` nullable in the v1 commit-key schema, with the refuse meaning and a golden vector (D12).
2. The refuse clause extended to the MC-289 sweep and every other keep-set consumer (N1).

Not format, but owed before stage 1:
- N2 (Tauri flag persistence or boot re-flush).
- The rule for a recovery marker meeting a foreign recovery marker (D6).
- Settling D7 (staged manifests as candidates).
