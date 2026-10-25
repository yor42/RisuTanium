<!-- Lane B, CHORE-205 L3 staged plan. Gate 1 accepted 2026-10-25 (round 3 [EDITORIAL], no blocking defect; editorials E1 to E7 at the end are binding; ledger row 3094 in lane-B-records.md). Copied from lane B scratch plan3\plan.md; %TEMP% paths below refer to lane B's machine. -->

# CHORE-205 L3: modules not kept in memory. Staged plan, Gate 1 round 3

Base observed: Lane-B HEAD 991ee825c (`git rev-parse HEAD`). Decisions: MC-496..499, MC-350, MC-175/223, MC-484. Inputs: `plan2\plan.md` (base; "unchanged" below means plan2 section 4 stands), opus round 2 N1-N5 (row 3091, `gate1-opus-r2\result.md`), advisor row 3092 (binding), round 1. Labels: C = source re-opened this session. Test labels: R reproducer (fails on the pre-stage base), M mutant-checked (named scratch mutant goes red), G guard (may pass before and after), D diagnostic. Nothing here authorizes code.

## 0. Proven premises (all C, Lane-B HEAD 991ee825c, no dirty app files)

| # | Premise | Result and evidence | Branch it leaves |
|---|---|---|---|
| P1 | `il === null` semantics | **Not "overflow".** `null` = the owner has no inlay list. The sweep skips the owner: `sweep/keepSet.ts:332-336` (`if (ref !== null) add(...)`), so it adds nothing and is not an unknown owner. Overflow is a different thing: a list with `x:true` (`lists/inlayList.ts:12-14`, produced at `:23`), which the sweep makes an unknown owner (`keepSet.ts:259,278,296-298`). `carriedModuleLists` returns null for an `il:null` entry, so it is **derived, never carried** (`codec/split.ts:415`). **No production producer of a null module `il`**: `derive.ts:33` `moduleInlays` always returns a list. Only the schema allows it (`format/types.ts:128`, `schema.ts:438`). | `stubEligible` accepts `il:null` (advisor) but resident code derives it. A stub would carry `null` where a resident re-derives a list. Unreachable from this build's writers; flagged O12 (one-token alternative: treat null as ineligible). |
| P2 | `maxInlayBodyBytes` mid-session | **Cannot change.** `createListDerivation` computes `defaultCap` once (`lists/derive.ts:23`); its only non-test callers pass no params (`bootDispatch.ts:196`, `drive/storeImport.ts:537`, which reuses `getActiveStore2Save()?.lists`); `saveActive.ts:25` holds the one derivation. No setting feeds it. So `moduleListVersions` is constant for a session (undefined only if a non-default cap were injected, i.e. tests). Versions can differ only between builds, i.e. at boot. | `versions defined` stays in `stubEligible` as a defence; a table row covers it. No mid-session re-evaluation needed beyond B2's carry-time call. |
| P3 | Zero production `Rederive` callers | **CONFIRMED.** Case-insensitive grep `rederive` over `src/ts` non-test: only `sweep/types.ts:48`, `sweep/keepSet.ts` (parameter plumbing, `:188,:262`) and the `sweep/index.ts` re-export. No call site constructs one. So a stale list always ends `list-stale` -> `status:'incomplete'` (`keepSet.ts:189-191, 263-267`). | N2 is a GC outage, not loss (advisor). Mint-time eligibility prevents it. A stub never needs `Rederive`. |
| P4 | Partial export and the V0 branch go through `exportCopyOf` | **CONFIRMED.** `writeLocalBackup` (`drive/backuplocal.ts:627`) calls `encodeDatabaseWithLateColdStorage` at `:820`; `writePartialLocalBackup` (`:929`) at `:1067`. That function calls `exportCopyOf` first (`:73`), then branches `writeRisuSaveV0` (`:84`) or `encodeRisuSaveLegacy` (`:85`) on the **copy**. `exportCopyOf` is already async (`:195`); `plain = {...db}` shares `db.modules`. Other `encodeRisuSaveLegacy` callers: `globalApi.svelte.ts` (legacy save, covered by B2's refusal) and `bootstrap.ts:334` (`{}`). | Materialisation inside `exportCopyOf` reaches full, partial and kv-block exports. A streamed writer (A2) that keeps taking the tree from this function inherits it. |
| P5 | `requestChatData` callers | **19 non-test** (matches the advisor). 1 main send, 2 send-adjacent with subject, 3 memory, 7 other subject-bearing, 6 without subject. Table in section 3. Only `index.svelte.ts:2040` is the main send; `'model'` mode is shared with `scriptings.ts:736`, `triggers.ts:1648/2111`, `aiaccess.ts:63`, both Playground files, so the net cannot key on mode. | Explicit `mainSend: true` on the `requestDataArgument`, set at `index.svelte.ts:2040` only. |
| P6 | `uniqueIdHandles` reusable | **Yes with one edit.** It is module-private (`codec/modules.ts:56`), reads only `entry.id`, and returns the `id#occurrence` handles of unique, non-empty, non-`~` ids (`:55-63`). Used by `carryModuleIndex` (`:79-80`). | B2 exports it and loosens the parameter to `readonly Pick<ModuleEntry,'id'>[]` (no behaviour change). |
| P7 | Persona `$embedded` module never a stub | **CONFIRMED.** The stub index is built from `db.modules` only (`split.ts:489-493`). `$embedded` is `persona.embeddedModule` (`interchangeability.ts:192`), a persona field, not a `db.modules` slot. `getModuleByIds` filters `db.modules` (`process/modules.ts:704-706`), so `getModules` never returns the persona module either; `getModuleById` special-cases it (`:692-697`). | `referencedModuleIds` still lists `'$embedded'` (`modules.ts:747-749`); `matchesModuleRef` over `db.modules` matches it only for a real module with that id. |
| P8 | Reference rule, exactly | `idSet.has(m.id) \|\| (m.namespace && idSet.has(m.namespace))`, then dedupe by id keeping the first (`modules.ts:704-721`). Ids come from `enabledModules`, chat modules, character modules, persona embedded id, and `moduleIntergration.split(',')` trimmed (`:740-753`). An empty segment in `moduleIntergration` gives id `''`, which matches an empty-id module. | The extraction must keep these as they are (behaviour-preserving, guard G tests). Empty-id modules are ineligible anyway (P6). |
| P9 | Archiving predicates | Mint/unload gate = `archiveCharacters !== false` (`characterPutBack.ts:143`; boot `residencyPolicy.ts:14` residents everything on `=== false`; the setting UI treats undefined as on, `advancedSettingsData.ts:168`). `archiveGate.ts:25` uses `!== true`, a different gate: not used. | S4d/S5 mint and unload on `!== false` only. |
| P10 | Composer and send placement | Composer outcome defaults to `'refused'` and `finally` puts the draft back (`composerActions.svelte.ts:263-270, 399`); `sendCharacterMessage` runs at `:343` inside the `char.type==='character'` branch with `controller.signal`. `sendChat` checks `doingChat` at `index.svelte.ts:312`, takes the flag at `:332`, then awaits `sendChatBody` at `:333`; the `finally` releases it. | Composer await goes before `:343`; `sendChat` await goes between `:332` and `:333`, inside the `try`. |

## 1. The two predicates (cited by every stage; no stage restates them)

| Predicate | Home | Contract | Callers |
|---|---|---|---|
| `stubEligible(entry, index, versions)` | exported beside `carriedModuleLists` in `codec/split.ts` (uses `uniqueIdHandles`) | True iff **all**: `entry`'s handle in `uniqueIdHandles(index)`; `versions` defined; `entry.al[3] === versions.asset`; `entry.il === null \|\| entry.il[3] === versions.inlay`. `index` = id-bearing list of the whole current module list (a stub by its entry id, a resident by `moduleEntryFields`), so a duplicate created after boot makes it false. | S4d mint; S5 `stubFor`; B2 stub branch (evaluated again at carry); B3 valve decision |
| `referencedModuleIds(ctx)`, `matchesModuleRef(entry, refs)` | new pure leaf file with no imports (name and folder fixed in B0 task 1), extracted from `getModules`/`getModuleByIds` | Same match as P8: id OR namespace; every holder of a namespace; ids built exactly as `modules.ts:740-753`. `entry` is anything with `id` and optional `namespace` (a `ModuleEntry`, a stub or a module). | `getModules`/`getModuleByIds` themselves; S4d boot read filter (index entries); `ensureModulesFor`; the exit net; S5 keep-set |

B2 stub branch (replaces plan2 I2/I2b, which overlapped): evaluate `stubEligible`; compare the stub to `stubFromModuleEntry(previousEntry)`. **Locator mismatch** (no previous handle, tail or id mismatch) or **ineligible** -> `StubRefusedError('module','uncarriable')` -> the valve. **Any other field differs** -> `edited`, fails loudly naming the module, no valve (the valve would overwrite the edit).

## 2. Invariants (changes from plan2: I2/I2b rewritten, I11-I13 new)

| ID | Invariant |
|---|---|
| I1, I3-I10 | As plan2 section 1. I3 now reads "eligibility is `stubEligible`" and I8 reads "a send never leaves with a module that `matchesModuleRef` names still a stub". |
| I2 | A stub is carried only if `stubEligible` and it deep-equals `stubFromModuleEntry(previousEntry)`; otherwise per section 1 (valve for locator/ineligible, loud `edited` for any other field). |
| I11 | No stub reaches a `.bin` encoder: `exportCopyOf` materialises first; `encodeRisuSaveLegacy`, `writeRisuSaveV0` and A1's parts encoder refuse a stub loudly. |
| I12 | After every committed pass, every unit the module index names (`unit`, `al`, `il`) is in the manifest and survives a store2 sweep over the committed tree. |
| I13 | Stubs stay when archiving is switched off mid-session. Only minting and unloading read `archiveCharacters !== false`; no guard, skip, net or carry depends on the setting. |

## 3. `requestChatData` caller classification (P5; 19 non-test callers, COMPLETE)

| Class | Count | Sites | Net? |
|---|---|---|---|
| Main send (`'model'`, `chatId`, `previewBody`, subject) | 1 | `process/index.svelte.ts:2040` | **yes**, `mainSend: true` |
| Send-adjacent, subject, `'emotion'` | 2 | `index.svelte.ts:2531` (igp), `:2705` | no (run after the main entry gate) |
| Memory, subject | 3 | `memory/hypav2.ts:144`, `hypav3.ts:1758`, `supaMemory.ts:314` | no |
| Script/trigger/tool, subject | 7 | `scriptings.ts:736,783,1128`, `triggers.ts:1648,2111`, `mcp/aiaccess.ts:63`, `stableDiff.ts:57` | no (nested in a run) |
| No subject | 6 | `Suggestion.svelte:103`, `IrisModal.svelte:234`, `PlaygroundImageTrans.svelte:163`, `PlaygroundSubtitle.svelte:108,322`, `translator/translator.ts:605` | no |

Test (S4a): `exit-net-only-main-send` (R): the net fires for a spy-captured `requestChatData` arg from `sendChat`, and a table of the other 18 call shapes with a referenced stub never fires it (G, a behaviour table, not a source-text guard).

## 4. Stages, tracks and counts

Non-test counts are distinct files, INFERRED from plan2 plus the cuts below; each stage's first task confirms them.

| Stage | Track | What (delta from plan2) | Non-test | Test | Reviewer | Advisor |
|---|---|---|---|---|---|---|
| B0 | B | **New.** Extract `referencedModuleIds`/`matchesModuleRef` from `getModules`/`getModuleByIds`, no behaviour change | 2 | 1 | opus | no |
| B1 | B | Unchanged | 4 | 4 | opus | yes |
| B2 | B | Stub type, `stubEligible`, export `uniqueIdHandles`, **`encodeRisuSaveLegacy` and `writeRisuSaveV0` refusals**, seam, manifest/sweep oracle | 8 | 5 | opus | yes |
| B3 | B | Loader by handle (abortable), install, digests, valve, refresh, version signal, `ReloadGUIPointer` bump | 5 | 4 | opus | no |
| S4a | B | Producer skip, exit net (`mainSend`), composer await, in-unit `sendChat` await, load triggers | 13 | 5 | opus | no |
| S4d | B | Boot filter by `matchesModuleRef`, mint by `stubEligible`, edge set | 6 | 4 | opus | yes |
| S5 | B | Unload; keep-set by `matchesModuleRef`; swap deferred while a plan is in flight | 6 | 4 | opus | yes |
| C2 | H | Unchanged (re-verify list in section 6) | 5 | 4 | opus | no |
| C3 | H | Unchanged | 6 | 3 | opus | no |
| C4 | H | Unchanged | 6 | 3 | opus | yes |
| C1 | H (B if late) | Materialisation **inside `exportCopyOf`**, one parametrised reproducer over full, partial and kv-block exports | 3 | 3 | opus | no |
| A1 | G | Parts encoder keeps B2's stub refusal; **prerequisite of S4d** | 1 | 1 | opus | no |
| A2 | G | Streamed compress; **prerequisite of S4d**; re-runs C1's reproducers if it merges after C1 | 2 | 3 | opus | yes |
| J1 | **B** | Streamed writer pulls modules one at a time (memory only; correctness already holds from C1) | 2 | 2 | opus | no |

Totals: 14 stages, 69 non-test, 46 test (stage sums; about 12 files appear in two stages). Plan2: 13 stages, 59/43.

Order rule (E1, updated): the first stub is minted in S4d. **S4d needs B0, B3, S4a, C1, C2, C3, C4, A1 and A2 all merged.** S5 needs S4d. J1 needs A2 and C1 and may follow S5.

## 5. Stage details (changed stages only)

### B0 Reference-rule extraction (track B)
| Field | Content |
|---|---|
| Files | new pure leaf (`referencedModuleIds`, `matchesModuleRef`), `process/modules.ts` (`getModules`, `getModuleByIds` call them). Test `moduleRefs.test.ts`. |
| Tests | Guards (G, no behaviour change; run on base and after): `ids-built-as-before` (table: enabled, chat, character, persona, integration, empty segment, `$embedded`); `id-or-namespace-match`; `every-namespace-holder-matches`; `first-duplicate-id-wins` (dedupe unchanged); `memo-key-unchanged` (`lastModules` join string). Mutant `id-only-match` (red on `id-or-namespace-match`) proves the guard can fail. |
| Phone | none. |

### B2 Stub type, eligibility, save-side contract (track B)
| Field | Content |
|---|---|
| Files | plan2 B2 files, plus: `stubEligible` in `codec/split.ts`; `uniqueIdHandles` exported (P6); `storage/risuSave.ts` `encodeRisuSaveLegacy` and the legacy `toSave.modules` block refuse a stub; `storage/risuSaveV0.ts` `writeRisuSaveV0` refuses a stub. Tests: `codecModuleStub.test.ts`, `moduleResidencyModel.test.ts`, `stubEligible.test.ts`, `binEncoderRefusesStub.test.ts`; updated `codecCarry`, `codecModules`, `formatSchema`. |
| Tests R | plan2 list (`stub-carried-not-written`, `edited-stub-refused-loudly`, `stub-carried-with-undigested-previous`, `stub-carried-under-rewriteAll`, `duplicate-id-stub-refused`, `encodeModules-with-stub-throws`, `legacy-risuSave-stub-parks`), plus `bin-encoder-refuses-stub` (both `encodeRisuSaveLegacy` and `writeRisuSaveV0`); `locator-mismatch-is-uncarriable-not-edited`; `ineligible-stub-refused-uncarriable`. |
| `stubEligible` table (R, one test) | Rows: unique+current -> true; duplicate id; empty id; `~` id; `versions` undefined; `al[3]` stale; `il[3]` stale; `il:null` -> true; `il` current overflow (`x:true`) -> true; duplicate created after boot. Mutant `eligibility-ignores-version` (drops the two version clauses; red on the stale rows). |
| Model test | Oracle after every committed pass: `assembleDatabase(tree)` equals the all-full model **and** I12 (every index-named unit is in the manifest and survives the real mark/sweep closure over the committed tree, `gc/mark.ts`, not a reimplementation). Ops: edit, delete, reorder, import, inject stub, duplicate id, direct field write to a stub, **`rewriteAll`, `whole`, module-scope-off, list-version bump (expects uncarriable refusal)**. 200 runs x 30 steps, fixed seeds. |
| Mutants | plan2's four (`carry-skips-deep-equal`, `no-carried-set`, `no-stub-branch`, `digest-required-carry`); `no-carried-set` must be red on **the model test too** (N5). `eligibility-ignores-version` as above. |
| Phone | none. |

### B3 Loader and install (track B), delta
| Field | Content |
|---|---|
| Added | `loadModuleByHandle(handle, signal)`: the signal aborts the read and the result is discarded (I6). Install and the editor write-back also call `ReloadGUIPointer` (opus: `moduleUpdate` ids do not change on install, so ChatBody would stay stale). Valve: loads every module the pass refused, then plans once more; a second refusal is an invariant breach and fails the pass loudly (no unbounded loop, no failed save per stub on a version bump because eligibility already prevents one). |
| Tests | plan2's list; plus R `chat-body-refreshes-after-load`; R `hung-load-aborted-by-signal`; **no-commit test (M, passes on base)**: previous registered without a digest, `load` a module, then a module-flagged pass through the **real `saveLoop` and `dbChangeEffects`**, asserting `saved` with `wrote:false`, not forced, not saveMine (row 3089's caveat); mutant `no-hydrate` red. Equal-content swap on a `$state` proxy stays a G. |
| Mutants | plan2's four; `no-hydrate`; `valve-loads-first-only` as before. |

### S4a Producer skip, exit net, awaits (track B), delta
| Field | Content |
|---|---|
| Files | plan2 S4a list, plus `process/composerActions.svelte.ts`; `request.ts` net takes `mainSend`; `process/index.svelte.ts` sets `mainSend:true` at the `:2040` call only. |
| Awaits (N4) | Composer: before `sendCharacterMessage`, `await ensureModulesForOrigin(workHandle.origin)` with `controller.signal`; a failure leaves `outcome='refused'`, so `finally` puts the draft back, and the alert names the module. `sendChat`: after `doingChat.set(true)`, inside the `try`, `await ensureModulesForOrigin(entry.context.origin, unit.signal)` before `sendChatBody`; a failure returns `false` through the existing `finally`. The check at `:312` and the take at `:332` stay one synchronous stretch (no await between). |
| Net | Fires only when `arg.mainSend` and `getModules`-equivalent references (via `referencedModuleIds` + `matchesModuleRef` over `db.modules`) include a stub. Uses the same predicate as the boot filter, so a namespace-referenced module (`moduleIntergration`) is loaded by ensure and seen by the net (N1). |
| Tests | R: the six producer-skip and net tests of plan2; `ensure-loads-namespace-reference`; `exit-net-detects-namespace-stub`; `editinput-applies-module-regex-after-load`; `composer-load-failure-puts-draft-back-naming-module`; `hung-load-aborted-by-busy-button`; `exit-net-only-main-send` (section 3). G: plan2 guards (`doingChat-take-stays-synchronous`, `display-pass-never-alerts`, `non-send-run-proceeds-without-failed-module`, `each-reference-adding-write-loads`, `bypass-install-paths-load`, `restore-loads-chat-and-character-refs`). Model test gains the namespace-ref op. |
| Mutants | plan2's four; `await-between-check-and-take` (red `doingChat-take-stays-synchronous`; replaces `await-after-flag`); `id-only-match` (red `ensure-loads-namespace-reference`, `exit-net-detects-namespace-stub`); `net-keyed-on-mode` (red `exit-net-only-main-send`). |

### S4d Boot filter and mint (track B), delta
| Field | Content |
|---|---|
| Rule | Boot read set = units of modules that `matchesModuleRef` the global refs (`enabledModules`, `moduleIntergration`; `config.f`) plus the edge-set character refs, plus every entry that is not `stubEligible`. Everything else is a stub. Mint runs only with `archiveCharacters !== false` (P9). |
| Tests | plan2's list; R `boot-reads-moduleIntergration-by-namespace`; R `stale-list-version-entry-stays-resident` (index at an older `al[3]`/`il[3]`: no stub, the idle pass derives fresh lists, the second boot stubs); R `archiving-off-mid-session-keeps-stubs` (I13: stubs remain, a load still works, no guard reads the setting). |
| Mutants | plan2's three; `stub-without-eligibility` now red on both `duplicate-id...` and the stale-version test; `id-only-match`. Model test gains boot. |
| Phone | P3. |

### S5 Unload (track B), delta
| Field | Content |
|---|---|
| Rule | `stubFor` = `stubEligible` then `stubFromModuleEntry`. Keep-set uses `matchesModuleRef`. Unload predicate `archiveCharacters !== false` (as `characterPutBack`). A swap does not run while a save plan is in flight (the plan yields between modules): it retries after the plan, with the verdict and swap in one synchronous task. |
| Tests | plan2's list; R `swap-defers-while-plan-in-flight` with mutant `swap-during-plan`; R `setting-off-mid-session-never-reloads-stubs`; R `namespace-referenced-never-released`. Mutants: plan2's three; `release-before-write` (re-audit, section 6). |

### C1 Export module source (track H), delta
| Field | Content |
|---|---|
| Files | `drive/backuplocal.ts` `exportCopyOf` gains the module substitution **before** its return, so both branches at `:84-85` get a stub-free copy; `drive/exportModules.ts` (`snapshotModuleList`); `storage/risuSave.ts` only if the source argument needs it. |
| Tests | R **one parametrised test** `export-unpacks-equal-with-stub` over three cases: full writer, partial writer, kv-block (V0) profile; each compares `decodeRisuSave` with an all-full control. Plus R `unreadable-module-stops-before-open`, `module-deleted-after-start-still-exported`, `auto-gc-off-during-export`; G `v0-path-unchanged`, `binGoldens` round trip. Mutants `no-pre-verify`, `no-snapshot`, `no-busy`, `substitute-after-branch` (red on the kv-block and full cases). |

### A1, A2, J1 (delta)
A1: the parts encoder keeps B2's refusal; test `parts-encoder-refuses-stub` (R). A2: Gate 2 includes C1's parametrised test run against the streamed writer (R if A2 merges after C1; otherwise C1's Gate 2 runs it on A2's writer); `peak-holds-pieces-not-whole` stays D. J1: owner is lane B (resolves O3); its reproducer `streamed-export-with-stubs-unpacks-equal` stays R, `peak-holds-one-module` D.

## 6. Tracks, merge order and overlap

| Track | Stages | Starting revision | Rule |
|---|---|---|---|
| B (lane B) | B0, B1, B2, B3, S4a, S4d, S5, J1 | Lane-B worktree at the commit the maintainer names (confirm `git rev-parse HEAD`; now 991ee825c) | one writer, one branch |
| H (cloud) | C2, C3, C4, C1 | the commit at which **B2 is merged** (SHA in the dispatch); rebases onto B3 before C2/C3 final review | seam `acquireModule` + test double until B3 |
| G (local) | A1, A2 | main as the maintainer starts it (verify the worktree HEAD) | no L3 code; **merge before S4d** |

**Merge order:** B0, B1, B2, B3 -> H (C2, C3, C4, C1) and G (A1, A2) in either order -> S4a -> S4d -> S5 -> J1. Whichever of A2/C1 merges second re-runs C1's parametrised export test on the final writers.

| File | Stages (writers) | Note |
|---|---|---|
| `storage/risuSave.ts` | **B2, A1, A2, J1** (four stage writers; C1 only if needed) | order B2, A1, A2, J1; B2's refusal is kept by A1's parts encoder |
| `storage/risuSaveV0.ts` | B2 | refusal only |
| `drive/backuplocal.ts` | C1 (`exportCopyOf`), A2, J1 | C1 before J1; A2 rebases on C1 or the reverse, per merge order |
| `process/modules.ts` | B0, B3, S4a; C3 | B0 first (refs extraction) |
| `codec/split.ts`, `codec/modules.ts` | B1, B2 (`stubEligible`, export) | S4d/S5 only call |
| `process/composerActions.svelte.ts` | S4a | no H overlap |
| `bootstrap.ts`, `plugins/plugins.svelte.ts`, `ModuleSettings.svelte`, `database.svelte.ts`, `ModuleChatMenu.svelte` | as plan2 section 3 | unchanged |

**Lane H rebase re-verification list (at the rebase onto B3, test double removed):**
1. `acquireModule` returns the live installed object (`===` the `db.modules` slot). Mutant `acquire-returns-copy` (red on C2 `plugin-write-persists-full` and C3 write-back).
2. The failure type and module name match B3's real errors.
3. Duplicate-id resident modules: acquire behaves as today's `find` (first match); refuse an ambiguous id only for a stub.
4. At S5 (real pins) re-audit every acquire/release pair; mutant `release-before-write` (red: swap while an edit is pending).
5. Run C2/C3 reproducers on the real loader.

## 7. N items and editorials: resolution

| Item | Resolution |
|---|---|
| N1 reference match | B0 predicates; used by boot filter, ensure, net, S5 keep-set; tests in B0, S4a, S4d; mutant `id-only-match` in B0, S4a, S4d. |
| N2 stale lists | Reframed (P3): GC outage, not loss. `stubEligible` evaluated at mint (S4d, S5) and at carry (B2); stale/absent versions never become stubs; test `stale-list-version-entry-stays-resident`, B2 table, mutant `eligibility-ignores-version`. Valve loads all refused, plans once more. |
| N3 `.bin` guard | Section 1, I11, P4. B2 refusals in both encoders; C1 substitution in `exportCopyOf`; A1 keeps the refusal; A1/A2 prerequisites of S4d; one parametrised C1 reproducer. |
| N4 send placement | Section 5 S4a, P10, P5; renamed mutant; tests `editinput-applies-module-regex-after-load`, `hung-load-aborted-by-busy-button`. |
| N5 oracle | B2 oracle (I12), added ops, `no-carried-set` red on the model test; B3 real `saveLoop` + `dbChangeEffects` test with `no-hydrate`. |
| Editorial I2/I2b | Replaced by the section 1 locator-vs-edited rule. |
| Editorial `risuSave.ts` | Four stage writers, order B2, A1, A2, J1. |
| Row 3089 / opus notes | Producer skip pinned in the six getters; `ReloadGUIPointer` bump in B3; exit-net flag and caller list (section 3); S5 swap during a plan deferred; entries lacking valid `ef`/`su` are read at boot (`mvpDataUpgrade` test), see O12. Superseded by the B1 revision (MC-580): `ef` and `su` are replaced by the tag in the `unit` Ref, see the "B1 revision" section at the end. |

## 8. Phone checks (Note 9, synthetic; unchanged from plan2: P1 after B1, P3 after S4d, P4 after S5, P2 after J1)

## 9. Remaining open items

| ID | Item | Stage |
|---|---|---|
| O1 | Closed by N4 (composer + in-unit awaits). | S4a |
| O2 | S4a is 13 files; split into S4a/S4b only if its plan review asks. | S4a |
| O3 | Closed: J1 owned by lane B. | J1 |
| O4, O5, O8, O10, O11 | As plan2. | H, B3/S5, B2, A2/J1, S5 |
| O6, O7 | Non-blocking (read-only callers tolerate an empty list; modules follow residency, the send await backstops selection paths). | S4a |
| O9 | Closed: stubs stay with archiving off (I13, P9). | S4d, S5 |
| O12 | Approach opinion, for the advisor. (a) `stubEligible`'s `il:null` clause is accepted as bound, but no writer in this build emits a null module `il` (P1), the resident path derives it (`split.ts:415`), and a stub would carry it unchanged; treating null as ineligible is a one-token, zero-cost safer alternative. (b) opus asked that entries without a valid `ef`/`su` be read at boot; that is a sixth eligibility clause, so it should live in `stubEligible`, not be restated in the boot filter. Both need the advisor's call before B2. (b) is superseded by the B1 revision (MC-580): the clause is the tag predicate, not `ef`/`su`. | B2, S4d |
| O13 | Home and name of the pure reference-rule leaf (must have zero imports so `treeBytes` can use it without a cycle). | B0 |

Scratch from this task: this file only.

## Orchestrator resolutions of O12 and O13 (lane B, before Gate 1 round 3)

- **O12 (a):** an entry with `il === null` is NOT stub-eligible. This is the safer one-token clause. No writer in this build emits it, so it costs nothing.
- **O12 (b):** "the entry has a valid `ef` marker and `su` equals its current unit tail" is a clause of `stubEligible` itself. The boot filter, S4d and S5 inherit it by calling the predicate; no stage restates it. (Superseded by the B1 revision (MC-580): the clause is the tag predicate `hasCurrentEntryFields`, not `ef`/`su`.)
- **O13:** B0 names the leaf file. It must have zero imports from store2 or process code, and B0's review checks this (no import cycle with `treeBytes`).

## Gate 1 round 3 editorials (opus `[EDITORIAL]`, `gate1-opus-r3\result.md`), binding on the stages named

- **E1 (B2, before dispatch):** `stubEligible` has six clauses (superseded by the B1 revision (MC-580): five clauses, 5 and 6 become the tag predicate):
  1. `uniqueIdHandles` membership;
  2. `versions` defined;
  3. `al[3]` is current;
  4. `il !== null` and `il[3]` is current;
  5. a valid `ef`;
  6. `su` equals the unit tail.
  
  The B2 table rows are `il:null -> false`, `ef absent -> false` and `su != tail -> false`. Mutant: `eligibility-ignores-su`. This supersedes section 1's four-clause text. Clauses 5 and 6, the table rows `ef absent`/`su != tail` and the mutant `eligibility-ignores-su` are superseded by the B1 revision (MC-580): one tag clause, rows `tag absent -> false` and `tag !== 1 -> false`, mutant `eligibility-ignores-tag`.
- **E2 (C1, before dispatch):** substitute modules before the `characterListNeedsRepair` check, by assigning a new `plain.modules`, so that both `exportCopyOf` returns see it. Add a no-repair case. Mutant: `substitute-on-repair-return-only`.
- **E3:** P4 sub-claim corrected. `globalApi.svelte.ts` only imports `encodeRisuSaveLegacy`; the legacy save uses `RisuSaveEncoder`. `encodeRisuSaveCompressionStream` has test callers only.
- **E4 (B3):** B3 states the argument that no production writer changes a stub's `id` together with another field. The supporting writer list is in the verdict, and C2 guards plugin writes. The valve reads by the stub's own recorded unit, and installs only if the slot deep-equals `stubFromModuleEntry` of that unit's previous entry; anything else fails loudly as `edited`.
- **E5 (B0):** a guard row covering a module with `namespace: ''`, which an empty `moduleIntergration` segment must not match. Mutant: `namespace-without-truthiness`.
- **E6:**
  - B2 also loosens `moduleHandles`.
  - B2 has 7 test files.
  - B3's no-commit test is labelled M (mutant) only, because `load` does not exist on base.
- **E7 (G):** if track G starts before B2 merges, A1 rebases onto B2 before its Gate 2, so that its stub-refusal test exercises B2's real marker.

<!-- B1 revision appended 2026-10-25 (MC-580). Copied from lane B scratch b1-plan\plan.md, revision 4 (Gate 1 accepted after three opus rounds; ledger rows 3096 to 3098 in lane-B-records.md). Where this section and the text above disagree about B1, `ef`, `su` or E1 clauses 5 and 6, this section governs; the text above is left as the Gate 1 record. %TEMP% paths refer to lane B's machine. -->

## B1 revision (delta, Gate 1 accepted 2026-10-25; MC-580)

Base: Lane-B worktree HEAD `a831430cc` (main with B0 merged). The B1 row in section 4 reads "Unchanged"; this section supersedes it. The maintainer chose "Version in the key slot" (`MC-580`).

### Why the plan2 B1 design changed

- plan2 B1 stored `su`, the module unit's key tail, as a plain string beside `ef: 1`.
- Production encodes run under placeholder keys, and the rekey (`codec/scoped.ts` `rewriteValue`) rewrites only Ref-shaped arrays. A string `su` keeps the placeholder tail. Executed by the investigator, with `su` injected by a mock at entry-build time (`su` never existed in production code): after one module edit the tail-derived value held `u-vvvvvvvvvv...`, and the next module-flagged pass rewrote the index again.
- A recovery install (`recoveryPick.ts` `withReplacedRefs`) changes keys without changing content, so a tail tag is wrong there too (traced in source).

### Binding design

| Item | Content |
|---|---|
| Tag | The entry's `unit` Ref gains a 4th element, the entry-fields version: `unit: [tail, bytes, crc, 1]`. No `ef` field and no `su` field. It means: the derived fields on this entry were computed by a build that knows version 1, from the unit this Ref names. |
| Writer | The two entry `unit` construction sites in `codec/split.ts` `encodeModuleAt`: the carried-lists branch (every unchanged module in production) and the derived branch. Every module-flagged pass rebuilds every entry with the tag. `moduleEntryFields` does not write it. |
| Survival | `rewriteValue`, `withReplacedRefs` and `readRefValue` keep the 4th element; `isRefShape` accepts length 3 or 4; reuse and carry compare only the 3-element head. No Ref type change and no parse change. The writer comment states that the tag is the only extra element, because a 5-element `unit` would never be rekeyed. |
| Predicate | `hasCurrentEntryFields(entry)` in `codec/modules.ts`: true iff `entry.unit[3] === 1` (`ENTRY_FIELDS_VERSION`). Any other value, or a missing 4th element, reads as "no tag". B2's `stubEligible` calls it; no stage restates it. |
| Where readers look | The tag is read from the parsed stored index body. `previousOfTree` rebuilds module unit Refs with 3 elements, so it is never a source for the tag. |
| `mcp` | A presence flag on the index entry, written only as `mcp: true` and only when `Module.mcp` is a non-null object; otherwise omitted. Lenient parse: a wrong type reads as absent. `mcp` is added to `KNOWN_FIELDS.moduleEntry`. |
| Known-field invariant | Every field `moduleEntryFields` derives is listed in `KNOWN_FIELDS.moduleEntry`; otherwise `carryModuleIndex` carries a stale previous value under tag 1. A later derived field bumps the version, and a reader accepts only its own version. |
| Older builds | A pre-B1 build (the MVP `f0e397aae` onward; the four format and codec files are byte-identical to `a831430cc`) rebuilds `unit` with exactly 3 elements on every module-flagged pass, so it drops the tag, and it carries unknown sibling fields stale for unique-id handles. The tag, not a sibling field, is the freshness signal. A downgrade is not a supported path (`MC-350` item 2); this is defence in depth. |
| `.bin` (`MC-175`) | No change: `assembleModules` reads the module unit body only, never the entry. |
| Migration (`MC-350`, `MC-496` item 7) | No job. The first debounced save pass after boot is module-flagged (a source trace, not an executed boot), so on the first launch of the new build every profile with modules rewrites its index once with no other edit pending; units are reused. After that, a no-change module-flagged pass is `unchanged`. |

### Editorial on E1 (binding on B2)

- E1's clauses 5 (a valid `ef`) and 6 (`su` equals the unit tail) become one clause: the tag predicate `hasCurrentEntryFields`, read from the parsed stored index body, never from `previousOfTree`'s units map.
- `stubEligible` therefore has **five** clauses: `uniqueIdHandles` membership; `versions` defined; `al[3]` current; `il !== null` and `il[3]` current; the tag predicate.
- The B2 table rows `ef absent -> false` and `su != tail -> false` become `tag absent -> false` and `tag !== 1 -> false`. The mutant `eligibility-ignores-su` becomes `eligibility-ignores-tag`.

### F7 (binding on B2)

A carried stub entry keeps the tag. Rebuilding it through the 3-element `refTuple` would make the stub ineligible on the next pass and send it through the valve every pass (churn, not loss). B2's carry test asserts the tag on a carried stub entry.

### Old-build evidence strategy

In-repo simulations of the old build were dropped (`readModuleEntry` is private and reads module-level `KNOWN_FIELDS`, and `carryModuleIndex` applies a unique-id filter, so a source-level simulation cannot reproduce the old build). The required Gate 2 cross-build run, in scratch outside the repository, uses real `a831430cc` code from `git archive a831430cc` (no index write) and a B1-written store saved as bytes. It shows:
- the older code decodes a B1-written store, and reads the 4-element `unit` and `mcp` verbatim;
- one module-flagged pass with an edit in the older code drops the tag on every entry and carries `mcp` only on unique-id handles;
- B1 reads the result as "no tag" and restamps on its next pass.

The frozen fixture for `entry-rewrite-adds-tag` is written by `a831430cc` code and generated before the first B1 source edit; its README records the commit, `createListDerivation`, the generator and the seeds. B1's pass seeds differ from the generation seeds.

### Phone check P1 (through lane A, phone 1; pending)

1. The MVP APK writes a synthetic profile with at least 3 modules, one with `mcp` and one duplicate id.
2. Upgrade-install the B1 build.
3. Boot. In the first save pass, read from the pass meter: `moduleIndex` is written once and no module, `al:module` or `il:module` unit is written. Any other unit written is named in the report. A read-only CDP read shows every entry's `unit[3]`.
4. 30 s idle.
5. Second boot: the first module-flagged pass writes nothing (`unchanged`); module content hashes are unchanged, with no extra module reads.

### Gate results for B1

- Gate 1: the delta plan, revision 4; rounds `[REJECT]` (reviewer label `[EDITORIAL]`, counted as a rejection by lane B), `[REJECT]`, `[EDITORIAL]`. The design did not change after the second rejection; the old-build evidence moved to real-code runs.
- Gate 2: `[EDITORIAL]` in `b1-review\result.md`, then `[APPROVE]` after the fixes, returned by message and recorded in `b1-review\orchestrator-note.md` (the orchestrator's statement; the reviewer checked only the three edited passages and line endings and reran no tests; it also returned three commit-message corrections, applied before the commit); E1 to E3 are wording and test-header fixes. Its note N1 for B2: `entry.mcp` is set only for a non-null object while the app tests MCP by truthiness, so a rule that relies on `entry.mcp` must be conservative, or the derivation becomes `Boolean(module.mcp)` (a plan decision).
