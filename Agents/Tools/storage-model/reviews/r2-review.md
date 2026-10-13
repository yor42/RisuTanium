# Gate 1 review, round 2: A-lite stages 1+3 plan v3 (opus-reviewer, 2026-10-13)

Reviewer instance: session b715da7c-9965-4831-b226-4d56438d78ee, agent aa5917071b6276576, role opus-reviewer. This is a fresh instance. It did not see the round 1 reviewer's or the author's reasoning, only the files named below.

## Scope and snapshot

- Under review: `S\stage13\plan-v3.md`, all 491 lines read.
- Round 1 inputs: `S\stage13\review-opus\review.md` (read in full) and `plan-v2.md` (consulted only through the v3 change table).
- Maintainer answers: `S\stage13\maintainer-answers-u.md`, U1 to U3 and U7 to U11, read in full and not reopened.
- Evidence:
  - `e1-1-verify\verify.md`, lines 80 to 189;
  - `e1-1\results-2.md`, lines 25 to 49;
  - `nodelist\results.md`, lines 10 to 49;
  - `remeasure\results.md`, lines 15 to 124;
  - log lines found by grep for the state counts the plan cites.
- `c4\packet.md` was not opened; nothing below depends on it.
- Repository, read only:
  - `Agents/Reports/62-storage-rewrite-gate1-plan.md`, lines 60 to 129 plus grep hits;
  - `Agents/Maintainer-Context.md`, MC-281 to MC-289 (lines 9518 to 9757).
- Code on `main` at `cd426f6ac`:
  - `src/ts/bootstrap.ts`, lines 1110 to 1309;
  - `src/ts/process/files/inlayCleanup.ts`, lines 1 to 60, 230 to 430 and 560 to 690;
  - `src/ts/process/files/inlayKeys.ts`, lines 1 to 40;
  - `src/ts/globalApi.svelte.ts`, lines 540 to 619;
  - `src/ts/storage/headSwap.ts`, lines 10 to 39;
  - `src/ts/storage/manualCleanup.ts`, lines 1 to 80 plus grep;
  - `src-tauri/src/chunked_io.rs`, lines 120 to 182;
  - grep of `src/ts/storage/tauriByteTransport.ts` and of `remotes/`.
- Worktree `C:\Projects\RisuAI\.claude\worktrees\alite` at `ebe3c77a9` (`feat/alite`):
  - `src/ts/storage/store/keyRules.ts`, read in full;
  - `src/ts/storage/store/nodeHttpStore.ts`, lines 505 to 579;
  - `server/node/server.cjs`, lines 1520 to 1568 and 1960 to 2030.
- `git status`: the worktree is dirty only in `src/ts/process/mcp/risuaccess/tests/__snapshots__/modules.test.ts.snap`. Main shows the session-start changes. Nothing was touched.
- Execution: one throwaway Node script in scratch, `keycheck.mjs` (see the artefacts section). Nothing was built, tested or run against repository code, and no model was run. Everything else is READ (source opened) or REASONED/INFERRED, labelled as such.

## Verdict

**[REJECT]**. The rejection is narrow, and the mechanism does not need reconsidering.

v3 really does resolve most of round 1:
- 12 of the 17 findings are closed outright;
- the other 5 are closed in their main point, each with a gap.

The `req` capability fence, `refsOf`, the per-batch sweep fence, the legacy per-file status, the absent-key row and the inlay trace are the right mechanisms.

Four defects remain in the stored format or in its boot semantics. Each is a cheap text fix now. After the declaration each costs a `fmt` bump or a silent-loss path:
1. An unknown `codec` (or reserved, or type) byte is classified as damage, not as too-new. This reopens round 1 finding 2's hazard by a different byte (finding 1 below).
2. The boot table maps only three of the null-current states its own golden vectors and label vocabulary create (finding 2).
3. The `store2-sweep` record has one `at` for the whole set and an undefined update rule. Read one way it deletes young candidates early; read the other way the sweep never deletes for a daily user (finding 3).
4. The `il` semantics are narrower than today's inlay keep rule. Modules and plugin values lose protection once they load lazily, and the scope question is scheduled after the freeze (finding 4).

A v3.1 text amendment that closes findings 1 to 4 and folds in the medium items could be reviewed as a targeted remediation round. That would not be a Gate 1 reopen.

---

## A. Round 1 findings: resolution check

| R1 | Topic | v3 response | Status (checked against the v3 text) |
|---|---|---|---|
| 1 | First life of the commit key and its absence | D8, 3.4, 3.4b, 4.6 | **PARTIAL**: the absent-with-units row, the label vocabulary, the deleter refusal and "zero candidates never seeds" are present. Gaps: the null-current rows for `import` / `restore` / `bulk` / `staging: null`, and the Node first-life revision (findings 2 and 6) |
| 2 | Too-new `fmt` | D6, 3.4b | **PARTIAL**: `fmt` and `req` are handled. An unknown `codec` / reserved / type byte still falls into "Damaged" (finding 1) |
| 3 | Deleter fence and `refsOf` | D2 to D4, 3.1, 3.3 | **RESOLVED**. Notes on Tier 1 staleness and the copy list (finding 9) |
| 4 | Sweep fence: (a) committed after R, (b) not yet committed | D12, 3.8c | (a) **RESOLVED**. (b) **PARTIAL**: the record's update semantics, the clock source and content-addressed re-saves (findings 3 and 7) |
| 5 | Inlay clean-up | D14, R18, 3.8d | **PARTIAL**: the trace, the binding 4a item and U11 are recorded. The `il` derivation is narrower than today's keep rule; module and plugin coverage is deferred past the freeze (finding 4) |
| 6 | `legacyKeep` representation | D13, 3.8b | **RESOLVED**: per-file status, names, `v`, release rule. A coverage note on deleters outside `assets/` is in finding 5 |
| 7 | `ASSET_REF_V` bump | D16 | RESOLVED |
| 8 | Marker before the first asset | D12, 3.8c, 4.6, test 7.2 | RESOLVED |
| 9 | Shared `assetRefKey` | 3.3, test 7.2 | RESOLVED. Lower-casing on case-sensitive stores over-protects, which is the safe direction |
| 10 | Alphabet and lengths | D10 | RESOLVED. EXECUTED `keycheck.mjs`: ordinal order equals numeric order; lengths 35 and 43; a boundary pair `1lkjkgv` < `1lkjkh0`; `t7` reaches about the year 3058 |
| 11 | Caps check | D20, P0a | RESOLVED. READ: `W:nodeHttpStore.ts:523-527` still rejects "not exactly three booleans", so P0a is required as stated |
| 12 | Mark and release failure semantics | 3.8b, 3.8c | RESOLVED |
| 13 | Sweep reads and cost | D15, D26 | RESOLVED |
| 14 | Tauri details (a) to (c) | D17, 4.5 | RESOLVED. READ: `chunked_io.rs:152-158` existing-final-key returns `Ok` with no flush. That path is used only with `finalKey`, which only piecewise asset saves pass (`tauriByteTransport.ts:185-192`, `:321-334`), so `flushed = false` there does not affect `store2/` units |
| 15 | Test labels | D25, 7.1 | RESOLVED |
| 16 | Unknown upstream fields | D23, 5, 7.2 | RESOLVED |
| 17 | Variants before the freeze | D24, 6 | RESOLVED (V3 should add the cases in finding 7) |

The two rebuttals in v3 (no mtime; `configAl` adopted) are sound. READ: `server.cjs` exposes no mtime on any list route. The adoption of the record over mtime is justified.

---

## B. Findings

### 1. HIGH (format, mixed builds, silent loss). An unknown `codec`, reserved or type byte is classified as "Damaged", so an older build can recover over newer data

Evidence (READ, plan-v3):
- D5 (line 21) and 3.3 (line 153) define what `Ref.bytes` and `crc` mean "with `codec != 0`". Line 151 says "No compression in v1". So a later codec inside `fmt = 1` is anticipated.
- No tier in 3.1a (lines 125-128) says what introducing a codec value is.
- Boot table 3.4b (line 192): the too-new test is only "frame `fmt > 1`, or `req` has a token this build does not know".
- Line 193: Damaged = "bad magic / CRC / JSON / schema, with `fmt <= 1` and known `req`".
- Test 7.1 (line 380) covers "`fmt` / `codec` / CRC / length refusal" at frame level only. There is no classification vector.

Consequence (REASONED):
- A newer build writes `store2-commit` or a manifest with `codec = 1` (compression, say) and valid CRCs.
- An older build fails JSON decode and classifies the key as Damaged.
- It shows the recovery screen and lets the user pick an older `m-` manifest.
- Its marker CAS replaces the newer key, and the newer state becomes garbage for every GC.

This is exactly the hazard round 1 finding 2 rejected, reached through byte 6 instead of byte 4. The same applies when the commit key is fine but the `current` manifest has an unknown codec: no boot row covers "commit key ok, current tree undecodable" (see finding 8).

Smallest fix:
- 3.3 and 3.4b: a frame whose header CRC is valid but whose `codec`, `type` (for the position read) or `reserved` byte is outside this build's known set is **too-new**, never damaged. This holds at boot, in a mark, in recovery listing and in a load.
- 3.1a: introducing a codec value is Tier 2 (a `req` token such as `codec1`) or Tier 3. Pick one and freeze it.
- Golden vectors: commit key and manifest with `codec = 1` and valid CRCs, and with `reserved = 1`.
- Mutant: "unknown codec treated as damaged".

### 2. MEDIUM-HIGH (format, first life, dead end). The boot table leaves null-current states unmapped that the plan itself creates

Evidence (READ):
- `StagingLabel` = `convert | seed | import | restore | recovery | bulk` (line 176).
- Golden vector (4) is "`current: null`, `staging: null` (cleared marker)" (line 182).
- 4.6(4): after "any marker clear" the "recovery screen returns" (line 337).
- 3.4b has rows only for null current with label `recovery` (line 194) and with `convert` / `seed` (line 195).
- No row covers:
  - null current with `staging: null`;
  - null current with label `import`. This is reachable from the zero-candidate screen's option (b), "import a `.bin`" (line 199), and from a first-life import;
  - null current with label `restore` or `bulk`.
- The mutant "null current treated as empty profile" (line 383) shows that a default matters.

Further gaps (REASONED):
- The `convert` re-run (line 195) assumes the old files still exist. If the user deleted `database/database.bin` after a crashed conversion, the row has no fallback.
- On Tauri, the start-up clear of the device's own `convert` marker writes back null current with `staging: null`. It therefore pre-empts the `convert` row, so the user lands on a zero-candidate recovery screen instead of a silent re-run. That is UX, not loss; the table should say which happens.
- The zero-candidate screen "with neither ... stays read-only" (line 199) is a permanent dead end for a user who has no `.bin` and no upstream file. In that state no `m-` manifest exists, so nothing is recoverable from `store2/` anyway. Whether to offer an explicit, confirmed "start a new profile" is a product question (MC-091), not a reviewer's call.

Smallest fix:
- 3.4b: add "Parses, `current` null, any other label or `staging: null` → recovery screen". Add "`convert` label and no upstream main file → recovery screen".
- State the order of the Tauri start-up clear against classification.
- Golden vectors for each.
- Ask the maintainer about the zero-candidate dead end, or record it as a disclosed limitation.

### 3. MEDIUM (silent asset loss or a sweep that never deletes; the format of type 23). The `store2-sweep` update rule is undefined, and both obvious readings are wrong

Evidence (READ):
- 3.8c (line 278): the record is `{ v, at, count, h, l }`, with one `at` for the whole set.
- Delete when "(i) in the record, (ii) the record is older than `SWEEP_MIN_AGE`, (iii) still unreferenced ..., (iv) the batch fence passes. Otherwise it is only (re)recorded."

Consequences (REASONED):
- **Reading A** (merge new candidates into a young record and keep its `at`): a name first seen one hour before `at + 24 h` is deleted after one hour. That breaks the age guarantee the residual in 3.8c relies on.
- **Reading B** (rewrite the record with `at = now` on every pass): with boots less than 24 h apart the record never ages. The automatic sweep then never deletes for a daily user, a liveness failure of MC-289 / U9.
- **Clock:** `at` comes from the writing device's clock.
  - On Node, two devices with skewed clocks share one record. A device whose clock is ahead deletes candidates another device recorded minutes earlier.
  - A record dated in the future blocks deletion.
  - On a single device, a forward clock correction (for example NTP after a wrong RTC) has the same effect.

Smallest fix, stated in 3.8c:
- When the record is young, do not write it.
- When it is old: delete (record ∩ fresh candidates), passing the fences. Then replace the record with the current candidates minus those deleted, `at = now`.
- A record with `at > now` counts as young and is rewritten.
- On Node, take `at` from the server's `Date` response header, or record a per-owner record.
- An unreadable or too-new record is treated as absent and rewritten.
- Tests: "young record unchanged", "new candidate never inherits an old `at`", "future `at`".

### 4. MEDIUM (silent inlay loss after stage 7; a format question scheduled after the freeze). `il` is narrower than today's keep rule

Evidence (READ):
- `inlayCleanup.ts:10-15`: candidates are ids from literal inlay tokens. Keep is "its id occurs, as a substring, in no string of the remaining database and of no cold unit".
- The keep matcher removes a uuid candidate on any uuid occurrence (`IdMatcher.scan`, `inlayCleanup.ts:260-279`, `UUID_AT`), not only inside tokens.
- `findUnreferenced` walks the whole in-memory `database` (`:648`). That includes modules, presets, the config root and resident `pluginCustomStorage` values.
- The plan's `il` is "derived by the existing extractor" (D14). That extractor is the token extractor, `collectInlayIds` (`:371-394`), over "core, lore, scripts and all chats" (3.8d, line 292).
- "Modules carry no inlay list" (3.7, line 250; TODO(evidence)). The scope is "owed later ... (4a)" (10.6, line 488), but it is also listed in the counts-only census (8.3, line 447).
- Modules become lazy in stage 7 (MC-283 6). Plugin storage values load on demand (MC-288 2).

Consequences (REASONED):
- After the redirect, an inlay referenced only by an unloaded module, an on-demand plugin value, or a non-token uuid occurrence in a character is no longer protected.
- Today it is protected while resident.
- Adding `ModuleEntry.il` after the declaration is Tier 2. That locks every older build into read-only for a plain coverage fix.
- Smaller point: 3.8d says the inlay list "must equal a full derivation". For a character whose chats are not all resident, only an incremental superset is computable without loading every chat. Also, an append whose message adds an inlay writes `il` as a fifth key. That contradicts test 7.1, "Append key set exactly tail, shard, manifest, commit" (line 399).

Smallest fix:
- Decide before the declaration, not at 4a:
  - (a) the `il` match semantics: token ids only (state the narrowing against today's substring rule and have it accepted), or every uuid-shaped substring, the same set `UnitCollector` already records (`:300-323`);
  - (b) whether `ModuleEntry` and the plugin buckets carry an `il`.
- Allow `il` to be a superset on append. Require exactness only on a full re-derivation.
- Amend the append test to "4 keys, plus `il` when the inlay set changes".
- Move the extractor-scope trace from 10.6 to the declaration preconditions (10.4).

### 5. MEDIUM (U1 "old files stay fully usable"; consumer list incomplete). Deleters outside `assets/` and `inlays/` are not named

Evidence (READ):
- `bootstrap.ts:1217-1273` (Tauri) and `:1280`, `:1307` onward (web/Node): the boot `remotes/` clean-up deletes remote blocks whose chaId is not in `db.characters`, after the `.meta` age. It "runs for every profile that gets past the flag check" (`:1183-1184`).
- `manualCleanup.ts:36-73` deletes cold units (`:431`, `:535-551`) and can delete an "older main file" after a confirmation.
- 3.8c (lines 281-287) names the asset sweep, manual-cleanup asset orphans, GC, the inlay clean-up and the Settings button. It does not name the `remotes/` clean-up or manual cleanup's cold-unit and main-file paths.
- The legacy unit records assets and inlays only (3.8b body, line 264). It records no upstream `coldstorage/` or `remotes/` keys.

Consequence (REASONED):
- On a converted profile, the live stubs derive `coldstorage = u` (3.6, line 244). Upstream cold units and remote blocks named only by old backups are then unreachable from live memory.
- The unchanged legacy deleters remove them, so the old files are no longer "fully usable" (U1). MC-287's scope note says upstream data is never deleted.

Smallest fix:
- Binding 4a item in 3.8c: on an A-lite profile no deleter touches keys outside `store2/`, `assets/` and `inlays/`. The legacy `remotes/` clean-up, manual cleanup's cold-unit and main-file paths, and backup rotation are disabled from 4a until stage 8.
- Add them to the consumer list.
- Confirm (3.8b) that the legacy derivation reads remote-block characters as well as cold chains. This is INFERRED likely, since `risuSave.ts` resolves `remotes/` pointers, but it is not traced.

### 6. MEDIUM-LOW (dead end on Node). A first-life create with a hard-coded `ifVersion: 0` can conflict forever

Evidence (READ, `W:server.cjs:1981-2016`): the revision is bumped and persisted before the content is written. A crash between the two leaves the revision at N > 0 with no file. A read then answers `x-risu-exists: 0` with `x-risu-revision: N` (`:1544-1558`). Plan 3.4 (line 180): "First life: ... Node `ifVersion: 0`".

Consequence (REASONED): after a server crash during the first marker create, or after an operator deletes the file, every create gets 409 and the boot loops or dead-ends.

Fix: the first-life create uses the revision returned with the absence read, which is normally 0. Test this with "absent, revision 1".

### 7. MEDIUM-LOW (disclosure; V3 scope). The age record does not protect a re-save of an existing content-addressed name

Evidence (READ, `globalApi.svelte.ts:568-594`): asset names are `sha256` of the bytes. On Tauri an existing key is not rewritten (`:590-592`). `writtenThisPage` is page-local (`:585`).

Consequence (REASONED):
- An orphan X sits in an old record.
- Tab or device B re-adds the same image: no write on Tauri, an identical overwrite elsewhere.
- Before B commits, A's sweep deletes X: it is in the record, old, unreferenced and the fence passes.
- B then commits a reference to a missing asset.
- The window is B's commit latency, not 24 h.

3.8c's claim (line 279) that "a stalled tab's uncommitted asset survives a day of sweeps" is false for this case. It is the same class as today's race (b) and the accepted Node two-device gap (MC-281 2).

Fix:
- Disclose it as a separate residual next to X13.
- On Node it can be closed by deleting with a check-only revision equal to the revision observed at the recording pass: any re-write bumps the revision. Optional.
- Add it to V3.

### 8. LOW-MEDIUM. Smaller boot and adapter gaps

- (a) **No boot row for "commit key ok, current tree unreadable".** Covers a manifest or shard with bad CRC or missing. State the action: recovery screen with a marker CAS at the parsed key's bytes or revision, and every deleter aborts via the closure rule. Unknown codec falls under finding 1.
- (b) **Count fallback.** The Node `count=1` fail-safe "over the limit" (line 280) is right for U9. For the boot absent-key test (line 191), an unsupported or failed count must fall back to a full list. If the list fails, conversion and seeding are blocked; the answer is never read as zero.
- (c) **Tauri sweep under a failed flush.** 4.5 idles GC on a persistent flush failure. The 3.8c fences do not idle the sweep. Add "the Tauri flush flag is clear" to the sweep fences (Report 62 A1.2 already has it for GC, line 88).
- (d) **Promotion trigger.** "Retried at idle" (line 335) is in-page. Persist the trigger at boot: if `current.key` is a staged key, promote. Otherwise a closed page leaves the gap open until the next ordinary commit.
- (e) **`SWEEP_AUTO_LIMIT` default.** State the value used until measured; recommend 0, which means button only.

### 9. LOW (format evolution wording)

- **Tier 1 copy-through can carry stale values.** An older writer that changes content but copies a newer build's unknown hint, for example a chat-entry `lastDate`, leaves the newer reader a stale hint. Add to 3.1a: "a Tier 1 field must stay correct, or be detectably stale, after any change by an older writer; otherwise it is Tier 2".
- **The copy list** (line 125) should read "every non-derived object at every level", which adds module index entries, the shard top level and `fixed.*`.
- **refsOf mutant list** (line 387): name `manifest.shards[]` and `fixed.pluginStorage.refs[]` (the bucket units) separately from bucket-body value refs.
- **The `cx` reservation** buys nothing that a Tier 2 `req: ['cx']` does not already give, since v1 has no type 22 body schema and cannot read it. Keep the "neither `chunks` nor `cx` = refuse" rule and drop the claim that reserving it is load-bearing, or define the body now.

### 10. LOW (editorial; provenance)

- **Section 6 (line 357)** says "verifier re-ran, identical counts" for the IndexedDB 57,079,650 and Tauri 34,371,907 runs. READ: verify.md section 2 re-ran f1 (94,119,831), refuse, rec, cur and the mutants. The 57 M and 34 M re-runs are the author's `F_*` runs (`results-2.md:39-40`). 9,973,029 (`p_rec0`) was never re-run. Relabel these AUTHOR-ONLY re-runs.
- **3.8c, line 275**, lists `il` in the asset keep-set. `il` serves the inlay clean-up over `inlays/`, not the asset sweep over `assets/`. Say which consumer uses which list.

---

## C. Focus questions

1. **Paths to loss, an empty profile or a dead end.** No direct empty-profile path remains in the modelled protocol: refuse, null current and absent all refuse. Remaining paths:
   - the unknown-codec recovery (finding 1, loss in mixed builds);
   - the unmapped null-current rows and the zero-candidate read-only state (finding 2, dead end);
   - early deletion under one reading of the sweep record (finding 3);
   - lazy-module and plugin inlays (finding 4);
   - legacy deleters outside the fenced prefixes (finding 5);
   - the Node create revision (finding 6, dead end);
   - content-addressed re-save (finding 7, a residual equal to today's).
   The legacy unit with per-file status and the `gone`-only-on-definite-absence rule is sound. The `req` fence is sound for every deleter that re-checks the commit key per batch. The inlay clean-up's fence is a 4a item and is named.
2. **Format evolution.** `req` semantics are sound (monotonic union, unknown token = too-new, CAS forces re-read). The tier of a new codec is missing (finding 1). Nothing seen forces an early `fmt` bump, provided findings 1, 4 and 9 are settled before the declaration. Stage 6 chat-list display fields and the merge spike fit Tier 1 or Tier 2.
3. **Added mechanisms.**
   - `store2-sweep` is justified (no mtime route exists) but needs finding 3's rule.
   - `il` is necessary for U11 under derived stubs.
   - `configAl` is cheap and removes up to 21 config reads.
   - The promotion commit is cheap (2 keys) but needs a boot trigger. **A simpler equivalent exists:** list completed staged manifests (`g-*-m*`) as recovery candidates, verified by the read-only tree read, which already "fails loudly" on a missing unit. Report 62 A1.2 excludes only *standing* staging prefixes (line 105). verify.md D7 modelled staged manifests as candidates, a superset, and it was green. Either is acceptable; pick one.
   - The `cx` reservation is redundant with `req` (finding 9).
4. **Adapters.**
   - The Tauri re-flush on every page load and `flushed = false` on the existing-final path are correct as written. A rewrite of identical bytes could be replaced by a flush-only command (file `sync_all` plus a directory flush) that L1 needs anyway. Optional simplification.
   - IndexedDB count-based bulk is acceptable pending the 1/4/16 MiB hold measurement.
   - The range-scan bound is correct. EXECUTED: the upper bound of `store2/` is `store20`, and `store2-commit` sorts below `store2/`, so it is outside the range.
   - Node caps and the prefix/count routes are correct, with finding 8(b).
   - P0a and P0b are well ordered.
5. **Tests.** The labels are now right (L2 is a genuine reproducer; F1 is new behaviour). Missing tests:
   - codec / reserved classification (1);
   - each unmapped null-current row (2);
   - sweep-record semantics and clock (3);
   - `il` on append and the module/plugin decision (4);
   - legacy deleters disabled (5);
   - Node absent-with-revision create (6);
   - Tauri sweep idle on flush failure (8c).
   V2 is close to tautological as a model, since it checks the flag it encodes. It is still worth running cheaply. V3 should include the content-addressed re-save (7).
6. **Upstream `.bin` compatibility (MC-175, MC-223).** No change to `.bin` import or export. D23 round-trips unknown fields at each level. The upstream-to-fork direction is unaffected. Fork-to-upstream relies on `u` being uuid-shaped by construction (D11). Finding 5 concerns U1 (the old upstream files on disk), not the `.bin` path. No defect found here.
7. **Section 10 item 8, the three limitations:**
   - (a) **A higher `fmt` shows only a notice: ACCEPT.** It is inherent. Record in MC-290 that for an unparseable `fmt` the behaviour equals the U10 option the maintainer did not choose ("Refuse to open"), so the maintainer sees it. Extend the same disclosure to an unknown codec (finding 1).
   - (b) **The sweep age cannot protect a tab stalled beyond it: ACCEPT** as a residual for stalls, but only once finding 3's rule is fixed. **Do not accept** the plan's framing that the record protects uncommitted assets in general: content-addressed re-saves are a separate residual that must be disclosed (finding 7).
   - (c) **Recovery offers only `m-` and relies on promotion: ACCEPT, with a condition**: a persisted boot trigger (8d), or replace promotion with staged-manifest candidates (C3).

## D. Checked versus inferred

- READ and confirmed:
  - plan citations of `bootstrap.ts:1121`, `:1171`, `:1185-1187`, `:1194-1304`;
  - `inlayCleanup.ts:569-577`, `:640-685`;
  - `globalApi.svelte.ts:569-601`;
  - `W:nodeHttpStore.ts:523-527`;
  - `W:keyRules.ts:33-49`;
  - `chunked_io.rs:153-158`, `:176-180`.
- READ for the new findings: `server.cjs` revision ordering and the absent read; `headSwap.ts:18` (in-process mutex, one process); `manualCleanup.ts` header; the `remotes/` clean-up.
- Evidence numbers that match their sources:
  - 94,119,831, 83,978,143, 5,161,140, 1,278,370 and 253,442 (verify.md and logs);
  - 57,079,650, 34,371,907 and 9,973,029 (author logs only);
  - the Node list figures;
  - the Note 9 IndexedDB figures.
- EXECUTED: `keycheck.mjs` only.
- REASONED: every consequence in findings 1 to 9. None was executed against code or a model.
- Not checked:
  - `c4\packet.md`;
  - `assetSweep.ts` lines;
  - `lib.rs:173-181`;
  - `server.cjs:1901-1925` (round 1 checked them);
  - whether `decodeRisuSave` resolves remote blocks during conversion (finding 5, INFERRED).

## Artefacts (outside the repository)

- `S\stage13\review-opus-r2\review.md` (this file).
- `S\stage13\review-opus-r2\keycheck.mjs` (a throwaway key-grammar check; ran once with `node`, exited 0).
- No processes left running. Nothing was written in the repository or the worktrees, and no git or index operations were made.
