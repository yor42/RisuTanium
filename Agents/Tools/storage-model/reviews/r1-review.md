# Gate 1 review: A-lite stages 1+3 plan v2 (opus-reviewer, 2026-10-13)

Reviewer instance: session b715da7c-9965-4831-b226-4d56438d78ee, agent a0456dbb5f8d8fadd, role opus-reviewer.

## Scope and snapshot

- Plan: `S\stage13\plan-v2.md` (488 lines, read in full).
- Evidence read: `S\stage13\maintainer-answers-u.md` (U1, U2, U3, U7; not reopened), `S\stage13prep\e1-1-verify\verify.md` (full), `S\stage13prep\nodelist\results.md` (full), `S\stage13prep\remeasure\results.md` lines 20-120, `S\stage13prep\e1-1\model.mjs` lines 95-121 (initial state only). `e1-1\results*.md` and `c4\packet.md` were not re-read beyond what verify.md and ledger row 1742 quote.
- Repo authority: `Agents/Reports/62-storage-rewrite-gate1-plan.md` (A1.2, A1.4, A2.4a, T2, boot table, A5.4 note, grep hits), `Agents/Maintainer-Context.md` MC-283 to MC-289 (lines 9595-9757), `Agents/Investigation-Ledger.md` row 1742 (one line), AGENTS.md.
- Code: `main` checkout at `cd426f6ac` (git status at session start: `.claude/launch.json` and one branding SVG modified, handoff files untracked; none touched or read). Worktree `C:\Projects\RisuAI\.claude\worktrees\alite` at `ebe3c77a9` (`feat/alite`), dirty only by `src/ts/process/mcp/risuaccess/tests/__snapshots__/modules.test.ts.snap` (observed with `git status --short`, read-only).
- Nothing was built or tested in the repository. No model run was made. The only execution: one Windows directory-flush probe in scratch (finding 14). Everything else is READ (source opened) or REASONED/INFERRED (labelled).

## Verdict

**[REJECT]**, substantive but small. The protocol core (refuse, epoch/full-bytes CAS, staging, check-only) is sound as far as the verified model reaches, and most of the plan is careful. But several frozen semantics are missing or wrong in ways that are expensive after release and two of them are direct empty-profile paths: the first life of the commit key (absent key, conversion marker) is unspecified and collides with the new "null current means recovery" rule (1); a too-new `fmt` is indistinguishable from damage at boot (2); the evolution rules have no deleter fence, so any later Ref-bearing or asset-bearing field is silently ignored by older builds' deleters (3); and the asset sweep's keep-set has no fence against other writers (4). Findings 1 to 3 and 6 and 10 change the frozen artifact; they are cheap now. Findings 4, 5, 7, 8 are binding carry-forwards whose decision must be recorded before the freeze because two of them may need a format field.

---

## Findings

### 1. HIGH (format, empty profile). The commit key's first life and its absence are unspecified, and the new null-current rule makes the conversion marker ambiguous

Evidence:
- Plan 3.4 (line 155): "`current: null` ... is written only by the recovery marker and by any clear of a recovery marker". Lines 156 and 327: "parses with `current: null`" goes to the recovery screen.
- Report 62 boot table (lines 279-283): rows exist only for "commit key parses", "unparsable", and three "No commit key" rows keyed on `database.bin` / `blocks/`. No row for "no commit key but `store2/` keys exist". Conversion goes "through the bulk path with `convertedFrom`" (line 281); nothing says what the commit key holds before the conversion's final CAS.
- GC refuses only when the key is unparsable (Report 62 lines 88, 104; plan 3.8c line 237 adds null current and staging). Absent is neither.
- The E1-1 model starts with a committed `m/0` (`e1-1\model.mjs:98-105`), so first-life behaviour is not modelled at all.
- Recovery candidates are only `^store2/m-` (plan 3.2 line 118); a conversion or import writes only staged `g-` manifests.

Consequences (REASONED from these texts):
- A conversion, seed or first import has no base tree. Its marker must either carry `current: null` (then a crash mid-conversion boots into the recovery screen, which lists zero `m-` candidates because the conversion's manifest is staged, and the "No commit key" conversion row can never fire again because the key now exists), or carry an empty seeded `current` (then a crash mid-conversion, followed by any clear of the marker, boots normally into an empty profile and conversion is never retried). Either way the user lands on an empty or dead-end profile; the upstream files survive, so this is an empty profile, not deletion of upstream data.
- If `store2-commit` is absent while `store2/` keys exist (first commit-key creation with a failed directory flush plus power loss on Tauri, an operator-restored Node directory), the boot table falls through to "convert again" or "seed an empty profile", and a GC that reads an absent key marks nothing and deletes every `store2/` key, including every recovery candidate.

Smallest fix (all in 3.4, 3.8c, 4.6, 7.1):
- Freeze a `staging.label` vocabulary that boot depends on: at least `convert`, `seed`, `import`, `recovery`, `bulk`. A null-current marker labelled `convert` or `seed` re-runs that operation (it is idempotent: upstream files are untouched); only `recovery` (or no marker) shows the recovery screen.
- Absent commit key plus any `store2/` key (one ranged count on IndexedDB, `list-prefix store2/m-` and `store2/g-` on Node, a directory check on Tauri) goes to the recovery screen, never to conversion or seeding. GC, the sweep and every deleter refuse on an absent key (add "absent" to the 3.8c refuse list and to I1's statement).
- A recovery screen with zero candidates never seeds an empty profile; it offers re-conversion when an upstream main file exists, else stays read-only.
- Golden vectors: a conversion marker (null current, `label: 'convert'`), absent-key-with-units fixture. Tests: crash at each conversion step then reboot; absent key plus units. A model variant with no initial commit key and a conversion bulk is cheap with the existing switches and should run before the freeze (finding 17).

### 2. HIGH (format, mixed builds). A commit key with a higher `fmt` must not be classified as damaged

Evidence: plan 3.1 rule 1 (line 106) "A reader meeting an `fmt` above its own refuses and never writes"; 4.6 (line 327) "Unparsable, or parses with `current: null`, goes to recovery"; golden list 7.1 (line 383) tests `fmt` refusal only at frame level. Nothing says what boot does with a valid frame whose `fmt` is too new.

Consequence (REASONED): an older build (a service-worker-cached hosted tab, an older Tauri install opening a newer data folder, an older device on a shared Node server, `MC-281` 9) that lumps "too new" into "unparsable" shows the recovery screen, lets the user pick an older `m-` manifest that it can parse, and installs it by marker CAS over the newer key. The newer state silently becomes garbage for the newer build's GC.

Fix: a four-way boot classification (ok / null current / damaged / too new). Too new means a read-only "update the app" state: no recovery, no commit, no GC, no sweep, no clear. Recovery listing skips or refuses manifests whose frame `fmt` is too new. Golden vectors: commit key and manifest with `fmt = 2`. Mutant: too-new treated as damaged.

### 3. HIGH (format evolution). No deleter fence: older builds silently ignore safety-relevant additive fields

Evidence: 3.1 rule 1 makes a new optional JSON field, a new unit type and a new key kind additive with `fmt` 1 and has readers ignore unknown fields (line 106). 3.8a (line 227) and X8 (line 459) bump only `ASSET_REF_V` when a ref-bearing field is added. GC marking (4.6 line 329) is described by named fields, not by a generic Ref walk.

Consequences (INFERRED; mixed builds are realistic after release, see finding 2):
- A later Ref-bearing field (stage 6 chat index, an inlay list from finding 5, the C1 deletion snapshot that Report 62 line 313 suggests putting "in the commit key", a module placeholder) is unknown to an older build's GC mark, which then deletes the units it names. That is an I1 violation across builds with no `fmt` bump required by the rules.
- An older build re-encodes an owner and writes a list with its own lower `ASSET_REF_V`; the older build's sweep trusts its own list (only lists below the reader's version are distrusted) and deletes assets referenced only by the newer field.

Fix (now, because adding it later is itself ignored by the builds it must stop):
- A monotonic fence in the commit key, for example `req: { gc: number, assets: number }`: a deleter (GC, asset sweep, inlay clean-up, manual clean-up, the cutover deletion) whose own level is lower refuses to delete; every commit-key writer copies the maximum and never lowers it. Rule 3.1 then reads: an additive change that a deleter must understand raises `req`, not `fmt`.
- One schema-driven `refsOf(type, body)` in `format/` that GC and recovery both use, with a guard test that enumerates every Ref position of every unit type (manifest fixed refs, presets, plugins, bucket values, shard core/lore/scripts/`al`/chat core/chunks, module index `unit`/`al`, `legacyKeep`) and a mutant per position. The current mutant list (7.3) has "mark ignoring pins" but nothing for `al`, `legacyKeep`, bucket values or module-index units.

### 4. HIGH (silent asset loss, binding before stage 2/4a). The asset sweep has no fence against other writers

Evidence:
- Keep-set rule, plan 3.8a (line 227): manifests of `{current} ∪ retained ∪ pins` plus "resident live refs and `writtenThisPage`". Both guards are page-local today (`src/ts/storage/assetSweep.ts:13-21`, `:94-105`, `:152`; `src/ts/bootstrap.ts:1194-1201`, keep-set built once before the listing).
- GC removal re-checks the commit key per batch (plan 4.4 line 311, 4.5 line 322); 3.8c specifies no equivalent for asset deletion.
- No cross-tab lock (4.4 line 313), two devices live on one Node server (`MC-281` 9 via MC-285 line 9662), and a hidden Android tab can stop completing IndexedDB callbacks for an unbounded time (`remeasure\results.md` line 118).
- Today the sweep is off for any profile with a cold-stored character (`bootstrap.ts:1185`); `MC-289` turns it on for every profile.

Two races (REASONED):
- (a) Committed after R: tab B commits a character that names asset X after tab A built its keep-set at commit-key read R. A deletes X; nothing re-checks.
- (b) Not yet committed: B's `saveAsset` writes X (`globalApi.svelte.ts:582-585` notes it only in B's own page), B's save loop has not committed yet (debounce, or a stalled hidden tab). A's keep-set and A's live refs do not contain X; A deletes it; B then commits a reference to a deleted asset.

Race (b) exists today for profiles without cold storage; `MC-289` plus A-lite multi-writer widens it from rare to routine.

Fix: (a) the same per-batch fence GC uses (Node: guarded remove with check-only `store2-commit == R`; IndexedDB: one transaction that re-reads the key; Tauri: mutex), with the keep-set rebuilt when the key changed. (b) Needs a rule, which is a decision for this gate's records even if implemented in stage 2/5: for example a persisted two-phase candidate record (delete only what was a candidate at an older commit key and is still unreferenced after a minimum interval) or a minimum asset age where the store has one. A persisted record is a new unit type (additive under 3.1, safe only with finding 3's fence). Add tests for both races with a second writer.

### 5. HIGH (silent inlay loss, binding for 4a; resolves the plan's TODO). The inlay clean-up does not read the keep-set; under derived stubs it deletes live inlays

Evidence (READ):
- `src/ts/process/files/inlayCleanup.ts:640-685` (`findUnreferenced`): scans the live database, then `walkColdUnits(coldRootsOf(database))`; `coldRootsOf` (`:569-577`) uses `listColdBackupRoots` (`src/ts/process/coldstorageData.ts:652-670`), which turns every `character.coldstorage` into a root (`:571-578`).
- A root whose unit is absent is `settled` and contributes nothing, with the walk still complete (`inlayCleanup.ts:536-539`); an absent store key reads as `missing` (`src/ts/process/coldstorage.svelte.ts:251-259`), which that file documents as the one answer callers treat as final.
- Plan 3.6 (line 200): the stub's `coldstorage` is derived at load as the entity uuid `u`. For a fork-only or seeded profile no `coldstorage/<u>` exists; for a converted profile a stale upstream unit may exist.
- It is already wired: `bootstrap.ts:1121` (`queueInlayCleanupForCharacters(purged)`) and the delete paths named in its header (`inlayCleanup.ts:6-9`).

Consequence (REASONED from the traced code plus plan 3.6): once 4a loads A-lite stubs, deleting any chat or character deletes inlays that only unloaded characters' chats still reference. The clean-up also ignores retained and pinned manifests, so restoring a snapshot can show missing inlays. Plan 3.8c item 4 ("TODO(evidence), to be traced in 4a before it is wired") misframes this: it is wired today, and the hazard starts the moment derived stubs exist.

Fix: replace the TODO with this trace; make "redirect `inlayCleanup` (T2 row `read`/`setColdStorageItem`) before 4a loads derived stubs" a binding 4a item with a guard (an inlay referenced only by an unloaded character survives deletion of another chat; mutant: walk via legacy cold roots). Record now whether retained/pinned snapshots protect inlays. Inlays live under `inlays/` (`src/ts/process/files/inlayKeys.ts:18-20`), not `assets/`, so `MC-289`'s wording does not settle it; if yes, the format needs inlay ids per owner (an `i` field in the list unit or an inlay-list unit, derived from chunks, which changes 3.8a's "derived from the owner core" dirty rule). Same audit for every other consumer that acts on `missing` for a derived stub.

### 6. MEDIUM-HIGH (format). `legacyKeep` cannot represent an unreadable source or name the files it covers

Evidence: 3.5 (line 172) `legacyKeep: null | { main: Ref | null, backups: Ref | null }`; 3.8b (lines 231-234): `main: null` means released; an unreadable file is "absent with `complete=false` semantics ... until a later conversion retry or the user's deletion of that file"; `backups` is a union over up to 20 files with no names recorded. Report 62 boot table (lines 279-283): conversion runs only when no commit key exists, so no retry path exists.

Consequence (REASONED): "unreadable" and "released" share `null`; one unreadable backup has no representation inside a non-null `backups`; the release rule cannot tell which deleted file ends the incompleteness. An implementer either disables the sweep forever or trusts an incomplete union.

Fix: the legacy unit body (or `legacyKeep`) records `files: [{ key, status: 'ok' | 'unreadable' }]` and the `ASSET_REF_V` it was derived with; release and completeness compare file names; an unreadable file keeps the sweep incomplete until that named file is gone or a re-derivation job (finding 7) reads it. Editorial in the same paragraph (line 232): the cold chain must be read for its character bodies (the collector needs `image`, `emotionImages` and so on), so "the key-only walk ... keys only" describes the traversal, not the data read.

### 7. MEDIUM. An `ASSET_REF_V` bump has no migration path

Evidence: 3.8a (line 225) lists are re-derived only "on every encode of the owner"; (line 227) a stale list makes the sweep derive from the core "in that manifest"; legacy lists are derived once at conversion (3.8b).

Consequence (REASONED): after a bump, every boot sweep reads the core of every unedited owner in every distinct retained manifest until each owner happens to be edited (the maintainer's characters alone are 132 MiB, ledger row 1741 per the plan), and legacy lists can never become current, so the sweep is incomplete forever for converted profiles (or trusted if the implementer cuts that corner).

Fix: an idle re-derivation commit that rewrites stale owner lists (bounded batches), and a legacy re-derivation job from the still-present files; the sweep stays incomplete until both finish. Test: bump `ASSET_REF_V` in a fixture, sweep refuses or derives, re-derivation converges.

### 8. MEDIUM. Bulk operations must set their marker before their first asset write

Evidence: 3.8a (line 227): "The sweep also refuses while `commit.staging` is non-null (assets of an in-flight bulk are written before any manifest names them)". The `.bin` restore writes assets in its entry loop (Report 62 P11, `backuplocal.ts` cited there). The plan does not require the marker CAS before the first asset write.

Fix: rule "every bulk (import, restore, conversion, recovery) sets its marker before it writes any asset" plus mutant "restore writes assets before the marker CAS" with a concurrent sweep.

### 9. MEDIUM. List encoding and sweep comparison need one shared normalisation

Evidence: asset extensions may be upper case (`ASSET_EXTENSION = /^[A-Za-z0-9]{1,16}$/`, `globalApi.svelte.ts:601`, used at `:576-582`), and `saveAsset` accepts an arbitrary `customId` (`:569-571`). Plan 3.8a `h` regex is `^[0-9a-f]{64}\.[a-z0-9]{1,16}$` (lower case only), so `<hash>.PNG` goes to `l` as lower case. Today's web/Node sweep compares names exactly (`assetSweep.ts:130-133`, `:152`); only the Tauri sweep lower-cases (`:91-105`).

Consequence (INFERRED): if stage 4a keeps the exact web/Node comparison, a referenced `assets/<hash>.PNG` or an upper-case custom id is deleted.

Fix: one `assetRefKey(name)` in `format/` used by both derivation and every sweep (lower-case, hash stem for any case of hex and extension). Tests on web and Node stores with `.PNG` and an upper-case custom id.

### 10. MEDIUM (format, cheap). The id alphabet does not sort in numeric order

Evidence: 3.2 (line 113) "lowercase base32 `a-z2-7`"; `t7` "orders the recovery list" (line 114); recovery takes "the newest 50" by "time digits with no body read" (line 331). Executed in scratch: the ordinal order of `abcdefghijklmnopqrstuvwxyz234567` is `234567abcdefghijklmnopqrstuvwxyz`, so digit values 26-31 sort before 0. The current time is about 1.8e9 s, so all seven digits vary.

Consequence: any string sort (IndexedDB `getAllKeys` already returns ordinal order) misorders keys and the 50-cap can hide the newest manifest. Not a safety issue (the plan says so), but changing the alphabet after the freeze is a format change.

Fix: use an ordinally ordered alphabet (`0-9a-v`, lower-case base32hex) or freeze "decode before sort". Golden vector with two times on either side of a digit boundary. Editorial: lengths are 35 bytes ordinary and 43 staged, not 36 and 44 (computed in scratch).

### 11. MEDIUM. The Node capability probe must accept unknown flags

Evidence: `W:src/ts/storage/store/nodeHttpStore.ts:523-527` rejects any `/api/caps` answer that is not exactly three booleans. Plan 4.3 (line 299) widens it to "three required plus this optional boolean".

Consequence (REASONED): every future additive server flag makes every older client park with `storageServerNeedsUpdate`; adding `listPrefix` before every client is widened breaks them now. Fail-closed, not loss, but it contradicts "additive".

Fix: require the three booleans and the marker, ignore unknown keys; test with an extra unknown flag. Order the server flag after the client widening (P0/1b).

### 12. MEDIUM. Failure semantics of the mark and of the legacy release are not stated

Evidence: 4.6 (line 329) lists mark reads; nothing says an unreadable or CRC-failing manifest, shard, index or bucket aborts the pass. 3.8b release (line 234) uses `has('database/database.bin')` and `list('database/dbbackup-')`; nothing says a transient error or an empty answer from a fallback path keeps the list.

Fix: GC and sweep abort on any unreadable node of the closure (mutant: unreadable shard treated as empty). Legacy release only on a definite absence; an error keeps protection (mutant: `has` error releases).

### 13. MEDIUM. Sweep reads and cost are not reconciled

Evidence: 3.8a (line 227) includes config-root refs from every manifest in the union; 4.6 (line 329) mark reads omit config units; config unit 619 KiB real (3.9). Legacy pair about 35 MB (3.8b, INFERRED), character lists 7.84 MiB, module lists 10.4 MB (ledger row 1742).

Consequence (INFERRED arithmetic): a sweep may read up to 21 distinct config units (about 13 MB) plus 35 MB of legacy lists plus 18 MB of owner lists and build sets of about 0.4 to 0.8 million strings, at each startup idle on a phone (`MC-130` 4). "Far under every unit limit (largest real unit 4.48 MiB ...)" (line 233) cites an observation, not a limit; the relevant limits are Node's 100 MiB body and the IndexedDB bulk threshold (4 MiB placeholder), so a 17.7 MB legacy unit is always a bulk write and its single-put hold on the Note 9 is unmeasured (8.1 item 1 stops at 16 MiB).

Fix: either a config-level list unit (`fixed.configAl`, additive) or state the config reads; read legacy lists only when candidates remain after the other keep-set; consider storing `h` as one concatenated sorted string so it parses as a single JSON string and is binary-searched (a format choice, cheap now). Add the sweep's memory and time to the 4a Note 9 check.

### 14. LOW-MEDIUM. Tauri adapter details

- (a) 4.5 (line 321) says the re-flush runs "at process start", but the flag is page-scoped and 4.6 (line 327) places it in `Store2Session.open`. It must run on every page load (Android renderer restarts reload the page without a process restart). The re-flush is a non-CAS rewrite; a reloaded page can race a dead page's in-flight `spawn_blocking` write. REASONED: the result is a lost unacknowledged commit, not an I1 violation, because a GC in the dead page cannot have read the in-flight value; state it and test reload with an in-flight write.
- (b) `chunked_io.rs:153-158`: with a final key that already exists, the write returns `Ok` without any directory flush. Define `flushed` for that path (false or not-applicable); the asset path uses it.
- (c) A persistently failing directory flush (FAT/exFAT, network shares) keeps GC idle forever without a signal; add a one-time notice or log.
- Executed: in scratch, `CreateFileW(dir, GENERIC_WRITE, ..., FILE_FLAG_BACKUP_SEMANTICS)` plus `FlushFileBuffers` on an NTFS directory returned success (PowerShell P/Invoke, `S\stage13\review-opus\flushdir`). That matches `durable_write.rs:187-196` and the existing test `the_real_directory_flush_does_not_fail_on_this_platform` (`durable_write.rs:480-485`, not run by me). So the N2 rule does not idle GC on ordinary NTFS.
- Observation outside this plan: assets are not durable writes on Tauri (`tauriDurableWrite.ts:37-46`), so a durable commit can name an asset that power loss removed. Pre-existing; record it for stage 4a.

### 15. LOW. Test labels and coverage

- "Recovery crash ... (the F1 reproduction, red against the v1 design)" (line 388): there is no v1 code. Label it new behaviour with the mutant "GC does not refuse on null current".
- "Rust: flush status ... reproducer on today's Rust" (line 397): a compile failure is not a red run. Assert an observable status on today's code, or label it new behaviour.
- IndexedDB listing reproducer (line 390): "request count" does not discriminate, because localforage `keys()` is one cursor request (`W:indexedDbStore.ts:367-375`; `remeasure\results.md` line 87). Count cursor steps or keys visited, or assert a bounded key range.
- Missing tests: absent key with units, conversion crash (1); `fmt` too new (2); unknown-field preservation through every commit-key and manifest writer, which the plan calls a defect (line 106) but never tests; Ref-position enumeration (3); the two sweep races (4); inlay guard (5); unreadable legacy file by name (6); `ASSET_REF_V` bump (7); marker-before-asset (8); case normalisation (9); key-order vector (10); caps with an unknown flag (11); unreadable closure node and release-on-error (12).
- The `aclearNoRead` retry wording (C16) and the mutant list otherwise match verify.md.

### 16. LOW (MC-175). Upstream unknown fields need an explicit codec guard

Evidence: 3.1's copy rule names only "the commit-key and manifest writers" (line 106); the codec splits `Database`, characters, chats and modules into units (3.6, 3.9, 5).

Fix: state that unknown fields of `Database`, character, chat, message and module go to their unit verbatim, and add a stage 3 guard: upstream `.bin` with unknown fields at each level round-trips fork to upstream byte-equivalently in those fields. Nothing in this plan changes `.bin` import or export; `MC-223`'s warning gap stays CHORE-129 (Report 62 I6). Upstream to fork is unaffected by this format except through findings 1 and 6.

### 17. Question 4: is the `faultCap=1` exit bound enough to freeze?

For the format: yes, provided findings 1 to 3 are fixed. With a deleter fence (3), a safety field found later can be added without a `fmt` bump, which is what makes a partially explored protocol acceptable to freeze. Before release a format change costs a re-import (`MC-011`, `MC-287`); after release it does not.

Model runs (REASONED):
- First life / conversion marker (finding 1): needs a variant before the freeze, because it decides commit-key semantics. The verifier's `run2` copy already has the switches it needs apart from an initial state with no commit key.
- N2 boot re-flush: not before the freeze (an adapter rule). It refines the modelled "flag survives" Tauri behaviour (GC idle until a successful flush of the exact current value; a power loss during the re-flush only yields the older durable value, a state already reachable). Run the `flagLostOnCrash reload redo` variant with the re-flush before stage 1 Gate 2.
- D6: no variant needed; refuse's safety does not depend on marker ownership (verify.md section 4) and the plan's rule is stricter than the model.
- `q_bulk`, `N_rec_f1`, `I_nosm_f1`, `N_reload0` and the inconclusive refuse runs: before stage 2 Gate 2 (protocol, not format).

## Facts re-checked and standing

`bootstrap.ts:1185-1187` gate; collector `globalApi.svelte.ts:2922-3036` (never reads chats, lore, scripts or triggers); `durable_write.rs:269-280`, `chunked_io.rs:130-140`, `:176-180`, `asset_batch.rs:59-73`, `:470-514`, `lib.rs:71-108`; `tauriByteTransport.ts:35`, `:110-113`, `:154-166`, `:236-270`; `tauriDurableWrite.ts:44-46`; the test name at `W:tauriDurableWrite.test.ts:131`; `W:keyRules.ts:30`, `:44-49`; `W:contract.ts:63-66`, `:218-221`; `W:nodeHttpStore.ts:58-71`, `:448-453`, `:525`, `:668-687`; `W:indexedDbStore.ts:367-375`; `manualCleanup.ts:166`, `:905`; `storageMaintenance.ts:20`, `:37`; `assetIntegrity.ts:87`. Plan figures from verify.md (F1 9 and 11 steps, N2 27 steps and 253,442 states, refuse 83,978,143 and 5,161,140 states, `m_recDirect` 11 steps, `gcCheckOutside` 15-16 steps) match verify.md. Node list figures match `nodelist\results.md`; Note 9 IndexedDB figures match `remeasure\results.md`.

## Artefacts (outside the repository)

- `S\stage13\review-opus\review.md` (this file).
- `S\stage13\review-opus\flushdir\` (empty directory, target of the flush probe).
- No processes left running; nothing written in the repository or the worktrees.
