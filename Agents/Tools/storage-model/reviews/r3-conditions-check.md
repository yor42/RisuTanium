# Incremental condition check: plan v3.2 against round 3 conditions C1 to C13 (opus-reviewer, 2026-10-14)

Instance: session b715da7c-9965-4831-b226-4d56438d78ee, agent a1e7bb3f245d95bc2, role opus-reviewer. This is the round 3 reviewer, resumed. It is not a full re-review.

## Inputs and snapshot

- `S\stage13\plan-v3.2.md`, all 550 lines read.
- `S\stage13\maintainer-answers-u.md`, U13 (lines 35 to 37): "Keep it, all exits".
- Source re-opened on `main` at `cd426f6ac`, whose working tree is unchanged since round 3:
  - `src/ts/bootstrap.ts`, lines 1276 to 1311 (and 1310 to 1351 from round 3);
  - `src/ts/globalApi.svelte.ts`, lines 2425 to 2448;
  - `src/ts/draftContentOrphanGate.ts`, lines 105 to 126.
  - Grep: `supersededUnits.ts`, `manualCleanup.ts`, `tauriAtomicWrite.ts`, `appFs.ts`, `plugins.svelte.ts`, plus round 3's repository-wide delete-call grep.
- Nothing was executed this pass, and nothing was written outside this file.

## Verdict

**[APPROVE WITH CONDITIONS]**

- 11 of 13 conditions are CLOSED; 2 are PARTIAL (C11, C13).
- Four new text-level defects come from the changes. None is a new format defect that needs a `fmt` bump, and none is a data-loss path that a text fix cannot close.
- The type 21 body and the `store2-fence` frame and readers are acceptable for the step 1a golden vectors once N2 is written in (the unparsable-fence rule). N1 and N4 touch only the protocol and adapter text.

## A. Conditions

| C | Status | v3.2 evidence | Note |
|---|---|---|---|
| C1 fence survives commit-key damage | **CLOSED** | 3.4c lines 205 to 226 (top-level `store2-fence`, never written by recovery or restore); I1 line 95; V1 line 408; tests lines 431 to 432; mutants line 226 | New issues N1 to N4 below concern the new key, not this condition |
| C2 type 21 body | **CLOSED** | 3.8d lines 305 to 309 (`u`, `h`, `o`, `x`; no silent cap; other-shaped ids kept unless every owner is resident) | N5 is a LOW detail |
| C3 list `v` above known | **CLOSED** | 3.8c line 287; also Tier 2 line 121; vector line 425; mutant line 473 | Recommendation R-a |
| C4 S1 evidence and V4 | **CLOSED** | Section 6 lines 398, 402; V4 line 411; freeze precondition line 541 | — |
| C5 recovery-screen exits | **CLOSED** | 3.4b lines 199 to 203; test line 430 | — |
| C6 `seed` always re-runs | **CLOSED** | rows 9 and 10, lines 195 to 196; vector (12) line 179; test line 428 | — |
| C7 zero count confirmed by list | **CLOSED** | row 1 line 187; R25; test line 428; mutant line 473 | — |
| C8 foreign marker; superset fence | **CLOSED** | lines 203, 218; mutant line 226; test line 440 | — |
| C9 `refsOf` mutants from the table | **CLOSED** | 3.3 line 153; test line 435 | — |
| C10 future-dated sweep record | **CLOSED** | line 294 (more than 10 minutes ahead = absent); test line 459 | — |
| C11 Node 409 handling and cost | **PARTIAL** | Drop-and-retry and the two 409 kinds: line 291, test line 460 (closed). Cost stated: line 297, 8.1(5) | **The 500-candidate cap (line 297) records the rest with `rev = null` "and rely on the age alone".** On Node a `null` rev means an unconditional delete, which re-opens the content-addressed re-save race (R22) that the plan still says Node closes (X13 line 513; residual line 298). See open item O1 |
| C12 prior commit bytes; U13 | **CLOSED** | `priorCommits` lines 214, 218; U13 applied to every exit, line 202 (faithful: U13's text is "Every recovery-screen exit keeps the old damaged data untouched until you press 'discard old data'. Cleanup stays paused") | — |
| C13 deleter scope and census | **PARTIAL** | Scope and exemption at line 312; census at 3.8e lines 314 to 340; guard line 340 | **Row 2 is misclassified**, and the exemption's timing is wrong. See open item O2 |

## B. Census spot-check (3.8e; 8 rows checked against the source)

| Row | Plan disposition | Source | Result |
|---|---|---|---|
| 1 | `bootstrap.ts:1212`, `:1301` asset sweep, rewritten | `:1207-1214` `sweepTauriAssets` with `removeAsset`; `:1293-1304` `sweepForageAssetKey` with `removeAsset` | CORRECT |
| **2** | `bootstrap.ts:1346` "an asset key in the web/Node sweep batch, same as 1" | `:1307` `for (const asset of remoteKeys)`; `:1320` `getRemoteSavePayloadName`; `:1328` `.meta`; `:1333` the 7-day rule; `:1346` `store.delete(asset, 'unconditional')`. The variable is named `asset`, but this is the **web/Node `remotes/` clean-up**, the twin of row 3's Tauri branch | **WRONG**: should be **Disabled**, and the row is missing from the mutant list ("rows 3 to 10, 15") |
| 4 | `globalApi.svelte.ts:2445` backup rotation, Disabled | `:2429-2448`: the delete runs **inside `getDbBackups()`**, a reader that Report 62 4a reuses for snapshots | CORRECT. Add the note that any caller of the reader triggers the delete, so the guard must call `getDbBackups` |
| 5 | `mainFileRename.ts:98`, `:114`, Disabled | read in full in round 3 | CORRECT |
| 6 | `deleteColdStorageUnits`, callers `supersededUnits.ts:345` and `manualCleanup.ts:765` | grep: `supersededUnits.ts:345 loaded.cold.deleteColdStorageUnits([entry.job.oldKey])`; `manualCleanup.ts:765 deleteColdStorageUnits(group)` | CORRECT |
| 12 | `inlayStore.ts:306`, `:311`, `:360`, `:362` | round 3 grep: the same four lines delete `bodyKey`, `replaced.body`, `metaKey` and `record.body` | CORRECT |
| 16 | `tauriAtomicWrite.ts:82`, `:158`; `appFs.ts:73` own temps | grep: `:82 appFsRemove(bareKey(path))`; `:158 appFsRemove(joinPath(directory, entry.name))`; `appFs.ts:73` is the definition | CORRECT for the call sites. `:158` removes directory entries by name; the "own temps only" filter was not re-read (INFERRED) |
| 18 | `plugins.svelte.ts:931` | `:931 removeItem: (key: string) => {` (plugin API) | CORRECT |

Omissions found by round 3's grep: the legacy adapter primitives `src/ts/storage/nodeStorage.ts:238`, `autoStorage.ts:56` and `opfsStorage.ts:67` are not in row 19. They are gated by their callers like the other primitives. Add them so the census is complete within its stated patterns. `draftContentOrphanGate.ts:122` is an in-memory map, correctly absent.

## C. New defects introduced by v3.2

**N1. LOW-MEDIUM (U13 exactness; a race window). A GC batch in flight can delete fenced keys between the fence write and the marker CAS.**
- Line 223 says no per-batch fence re-read is needed because "a fence is only created while the commit key is damaged, null or unreadable (every deleter already refuses ...)".
- That is false for **Node silent damage** (the bytes change, the revision does not, so a batch's check-only `store2-commit == R` still passes) and for row 6 (the key parses; GC aborts only on its own closure read).
- Line 219 says deleters read the fence "before each batch", but that read is not atomic with the batch's delete.
- Window: GC reads "no fence" → the exit writes the fence → the batch passes the commit-key check at R → it deletes a key that was garbage at R and is now in the fence's `keys`.
- Recovery safety holds (S1 reasoning: a pick is either read into memory or fails loudly). U13's "untouched" does not, for keys that were already garbage at the last valid commit key.
- Fix: put the fence into the per-batch atomic check. On Node, check-only the `store2-fence` revision in the same guarded remove; it is free and needs no content read. On IndexedDB, read the fence inside the batch transaction. On Tauri, read it under the mutex. Alternatively, correct line 223 and disclose the window.

**N2. LOW-MEDIUM (a cleanup dead end; an unspecified exit). An unparsable `store2-fence` has no way out.**
- Line 222: an unparsable fence stops every deleter, GC included. Fail-safe and correct.
- Not stated:
  - whether Settings "discard" may CAS-delete an **unparsable** fence (line 224 reads it first). If it may not, GC never runs again and `store2/` grows by every commit's garbage forever;
  - what an exit's "extend" does when the old `keys` cannot be read (line 218: `keys := old keys ∪ listing`).
- Fix, one paragraph in 3.4c:
  - An exit over an unparsable fence writes `keys :=` the listing. This is a superset of every old fenced key, because nothing has been deleted while the fence was unparsable, and fenced keys were never deleted before. It keeps the unparsable fence's bytes verbatim in the record (for example as `priorFences[]`).
  - Discard of an unparsable fence is a CAS delete at its revision or bytes, behind the same confirmation.
  - Boot shows the "cleanup blocked" notice.
  - Add a vector for each, and a mutant "exit over an unparsable fence keeps fewer keys than the listing".

**N3. LOW (cost).** A fence record lists every `store2/` key at the exit (up to hundreds of thousands of tails, megabytes). Re-reading it "before each batch" (line 219) is a full read per batch of 25.
- Fix: per batch, check the fence's **version** (Node check-only, as in N1; IndexedDB and Tauri compare inside the transaction or mutex). Read the body once per pass.
- Note: on Node a HEAD also reads the whole file on the server (`W:server.cjs:1546-1551`), so it is no cheaper.

**N4. LOW-MEDIUM (Tauri durability ordering).**
- 4.5 (line 368) makes `store2-fence` a durable key. But R1 says directory flushes are best-effort.
- The "re-flush on every page load" and "uncertain until flushed" rules are stated for the commit key and units only.
- If the fence write's flush fails and the marker CAS then flushes, a power loss can keep the marker and lose the fence. The exit later completes and GC collects the old data.
- Fix: an exit's marker CAS proceeds only after the fence write reports `flushed` (else re-flush or retry, and show the flush-failure notice). The boot re-flush includes `store2-fence`. Add a mutant: "marker CAS after an unflushed fence write".

**N5. LOW (type 21 comparison).**
- `u` holds **lower-cased** uuids (line 305).
- Today `IdMatcher` matches `UUID_AT` case-insensitively but deletes the exact matched string from a case-sensitive set (`inlayCleanup.ts:213`, `:262-263`).
- If the A-lite cleanup compares a raw upper-case candidate against the lower-cased `u`, a referenced inlay is deleted.
- Fix: one sentence: candidates are lower-cased before the `u` lookup, which is a superset of today's match. Add a test with an upper-case token id.

**No new format defect found** in:
- the fence frame (type 23 in the shared frame; too-new goes to row 3, line 189);
- the version rule;
- the staged-manifest key `g-<stg16>-m<t7><r9>` (43 bytes; line 136 arithmetic checked: 7+2+16+1+1+7+9 = 43);
- the chunk tuple reorder;
- the empty-chat rule.

## D. Open items (the conditions that remain)

- **O1** (C11 remainder). On Node an item recorded with `rev = null` is never deleted. Either limit how many candidates enter the record per pass to the cap, or re-record a `null` item with `at = now` when its revision is first observed. Then X13 and line 298 stay true ("Node closes the re-save race"). If the plan keeps unconditional deletes past the cap, change X13 and the residual to say Node closes the race only for the first 500 candidates per pass.
- **O2** (C13 remainder).
  - Reclassify 3.8e row 2 (`bootstrap.ts:1346`, the web/Node `remotes/` clean-up) as **Disabled** with row 3, and add it to the guard's mutant rows.
  - Correct the exemption's timing: Report 62 resumes an unfinished A2.4a deletion at a normal boot, after the commit key exists (Report 62 line 279). The exemption covers the resumed deletion, under C1's persisted key list.
  - Add the legacy adapter primitives to row 19.
  - Note that the row 4 delete sits inside the reader `getDbBackups`.
- **O3** (N1). Put the fence's version into the per-batch atomic check, or correct line 223 and disclose the window.
- **O4** (N2). Define the unparsable-fence exit and discard rules. This text must be in 3.4c before 1a's fence vectors.
- **O5** (N4). On Tauri, flush the fence before the marker CAS; the boot re-flush includes `store2-fence`.
- **O6** (N3, N5; LOW). Per-batch fence check by version; candidates lower-cased before the `u` lookup.

**Recommendation, not a condition (R-a).** Line 121 makes every derived-list version bump Tier 2, which sends every older build read-only. The version rule at line 287 alone already makes an older build refuse rather than misread, so the Tier 2 clause only costs availability. Keep it only for a bump whose list an older build must not even *write* over.

## Checked versus inferred

- **READ:** every census row in table B; the plan lines cited above; U13.
- **REASONED:** N1 to N5, O1, and the superset argument in N2.
- **INFERRED:** the "own temps only" filter at row 16, `:158`.
- **Not re-checked this pass:** the plan's unchanged sections (Section 0 R1 to R22, 4.3 to 4.5 except the fence lines, 8.x); the remaining census rows 3, 7 to 11, 13 to 15, 17 and 19 to 21 (consistent with round 3's grep, not re-read).
- **Artefacts:** this file only. No processes, and no repository or git writes.
