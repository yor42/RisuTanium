# Gate 1 review, round 3: A-lite stages 1+3 plan v3.1 (opus-reviewer, 2026-10-14)

Reviewer instance: session b715da7c-9965-4831-b226-4d56438d78ee, agent a1e7bb3f245d95bc2, role opus-reviewer. This is a fresh instance. It saw only the files named below, not the author's or earlier reviewers' reasoning transcripts.

## Scope and snapshot

- Under review: `S\stage13\plan-v3.1.md`, all 487 lines read.
- Earlier rounds: `S\stage13\review-opus-r2\review.md` (read in full). Round 1 was consulted only through round 2's resolution table.
- Maintainer answers: `S\stage13\maintainer-answers-u.md`, U1 to U3 and U7 to U12, read in full and not reopened.
- Evidence:
  - `e1-1\results-2.md`, read in full;
  - `e1-1-verify\verify.md`, by grep (D7, D9, the refuse runs, lines 150 to 194);
  - `e1-1\model.mjs`, grep of the candidate set (line 1025);
  - `remeasure\results.md`, lines 84 to 123.
  - `nodelist\results.md` was not reopened. Round 2 checked its figures, and nothing below depends on it.
- Repository, read only:
  - `Agents/Reports/62-storage-rewrite-gate1-plan.md`, lines 55 to 144, 272 to 300 and 474 to 487;
  - `Agents/Maintainer-Context.md`, the MC-281 to MC-308 headings and MC-287 to MC-289 (lines 9688 to 9757).
- Code on `main` at `cd426f6ac`. The working tree is dirty only in `.claude/launch.json` and `docs/branding/RisuTanium_Gradient.svg`, plus the untracked handoff, which was not read. Files read:
  - `src/ts/bootstrap.ts`, lines 1160 to 1229 and 1310 to 1351;
  - `src/ts/globalApi.svelte.ts`, lines 540 to 629 and 2925 to 3036;
  - `src/ts/process/files/inlayCleanup.ts`, lines 1 to 60 and 225 to 324, plus grep;
  - `src/ts/process/files/inlays.ts`, lines 405 to 434, plus grep;
  - `src/ts/util/inlayTokens.ts`;
  - `src/ts/storage/mainFileRename.ts`, read in full;
  - `src/ts/storage/manualCleanup.ts`, lines 1 to 80 and 770 to 799;
  - `src/ts/process/coldstorage.svelte.ts`, lines 420 to 489;
  - `src/ts/process/memory/supersededUnits.ts`, lines 1 to 40;
  - a repository-wide grep of store delete call sites (`delete(`, `deleteMany(`, `removeItem(`).
- Worktree `C:\Projects\RisuAI\.claude\worktrees\alite` at `ebe3c77a9` (`feat/alite`). It is dirty only in `src/ts/process/mcp/risuaccess/tests/__snapshots__/modules.test.ts.snap`, which was not touched. Files read:
  - `src/ts/storage/store/nodeHttpStore.ts`, lines 200 to 529, plus grep of the constants;
  - `src/ts/storage/store/guards.ts`, grep;
  - `server/node/server.cjs`, lines 495 to 528, 1496 to 1568 and 1640 to 2084;
  - the installed `node_modules/express` 4.22.3, `lib/router/route.js`, grep.
- Execution: one throwaway script, `datehead.cjs` (see Artefacts). Nothing was built or tested in the repository, and no model was run. Every other conclusion is READ (source opened) or REASONED/INFERRED, labelled as such.

## Verdict

**[APPROVE WITH CONDITIONS]**

The round 2 defects are resolved in substance.
- The codec, reserved and type classification is closed.
- The boot table now covers every state the plan creates, except one dead-end gap (finding 2).
- The sweep record rule is sound for safety.
- `ModuleEntry.il` and `fixed.il` exist.
- The legacy-deleter rule is stated.
- The Node first-life revision is closed.
- The content-addressed re-save is disclosed, and Node closes it with mechanics I verified in the source.

Both simplifications are sound by reasoning:
- **S1** (staged manifests as candidates; no promotion commit) holds because under "refuse" the recovery holds the chosen tree in memory before its marker CAS and rewrites every unit under fresh keys.
- **S2** (no `cx` reservation) is the right call.

The plan overstates the model evidence for S1 (finding 3).

No finding meets this round's bar for `[REJECT]` (data loss or an unfixable format problem), because each one can be closed by a text change now. Three of them are format-level and must be closed **before step 1a writes its golden vectors**; after the declaration each would cost a `fmt` bump or leave a silent-loss path:
- finding 1: the fence lives only in the commit key;
- finding 4: the scope of the `il` body;
- finding 5: no rule for a list version above the known one.

The other conditions are boot, recovery, test-plan or 4a-binding text. The conditions are listed at the end.

---

## A. Round 2 findings: resolution check

| R2 | Topic | v3.1 response | Status (checked against the v3.1 text and the source) |
|---|---|---|---|
| 1 | Unknown codec, reserved or type byte | E4; 3.1a Tier 2; 3.3 "Classification"; vectors 8 to 10; mutant (7.1) | **RESOLVED**. "Too-new everywhere" includes the recovery listing, so an older build cannot recover over newer data. The disclosure that this equals the non-chosen U10 option is carried into 10.1 |
| 2 | Unmapped null-current rows | E5; 3.4b rows 6 to 11; Tauri order (row 9); U12 | **RESOLVED** as asked. New gaps: the recovery screen offers its exits only at *zero* candidates (finding 2); `seed` with no upstream file lands on the recovery screen (finding 9) |
| 3 | Sweep record rule and clock | E7; 3.8c | **RESOLVED for safety**: a young record is never written, a new candidate never inherits an old `at`, only the intersection is deleted, and the Node time comes from the server. **Liveness gap:** a future `at` is "young, do not write", which differs from round 2's "young and rewritten" (finding 7) |
| 4 | `il` narrower than today's keep rule | E9; 3.5 `fixed.il`; 3.7 `ModuleEntry.il`; 3.8d | **PARTIAL**. Owner coverage is resolved. The match semantics are still narrower: "every uuid-shaped occurrence" misses asset-path ids and other-shaped ids, which `IdMatcher` keeps today (finding 4). A list body with an unknown higher `v` has no rule (finding 5) |
| 5 | Deleters outside `assets/` and `inlays/` | E10; 3.8c binding 4a item; R20 | **PARTIAL**. The rule is right. Its scope ("converted profile") and its named list are incomplete, and it contradicts the A2.4a cutover deletion (finding 6) |
| 6 | Node create with a hard-coded `ifVersion: 0` | E11; 3.4; 4.3 | **RESOLVED**. READ `W:server.cjs:2001-2034` (revision bumped and persisted before the content) and `:1544-1558` (an absent read reports `x-risu-revision`) |
| 7 | Content-addressed re-save | E8; R22; 3.8c residual (ii) | **RESOLVED**. READ: an unconditional `/api/write` bumps the revision on every write (`W:server.cjs:2001-2034`). `saveAsset` writes unconditionally off Tauri (`M:globalApi.svelte.ts:590-593`). The guarded remove carries a per-key `if-match-revision` (`W:nodeHttpStore.ts:487-489`), and the server checks it per key under the locks (`W:server.cjs:1656-1658`, `:1743-1758`). So on Node any re-save after the recording pass makes the delete conflict. Mechanics note in finding 12 |
| 8 | (a) row 6; (b) count fallback; (c) Tauri sweep flag; (d) promotion trigger; (e) limit default | E5, E12, E2 | (a) **RESOLVED**; (b) **RESOLVED** (but see finding 13 on trusting a zero count); (c) **RESOLVED**; (d) **MOOT** under S1; (e) **RESOLVED** as a stated placeholder (50,000). Round 2 recommended 0. The placeholder is acceptable only because 4a cannot wire the sweep before the number is measured; keep it in 10.2 |
| 9 | Tier 1 staleness; copy list; `refsOf` names; `cx` | E12, E3 | **RESOLVED**. The `refsOf` mutant list still misses five positions (finding 14) |
| 10 | Provenance; which consumer uses which list | E12 | **RESOLVED**. A new overclaim was introduced for S1 (finding 3) |

---

## B. Findings

### 1. MEDIUM-HIGH (format; silent deletion of the data U12 keeps; double fault). The fence lives only in the commit key, the object whose damage triggers U12

Evidence (READ, plan-v3.1):
- `fence` is a field of `CommitKey` only (3.4, line 161). The fence list unit is reachable only through `fence.keep` (3.4c, line 202).
- Recovery from an unparsable key writes `{current: null, retained: [], pins: [], staging: {label: 'recovery', ...}}` (4.6 step 3, line 328). It cannot copy a `fence` it cannot read.
- 3.4c claims "Only an explicit user action in Settings ... writes a commit key with `fence: null`" (line 201). Recovery from a damaged key is a second writer of `fence: null`.

Consequence (REASONED):
1. The user takes the U12 fresh start.
2. Later, the new profile's commit key is damaged.
3. The recovery screen lists the new profile's manifests. The user picks one, and recovery completes with `fence: null`.
4. GC then collects every pre-fresh-start `store2/` key, since no new-era manifest names them, and the asset sweep, inlay cleanup and manual cleanup resume over the old-era assets and inlays.

The data U12 promised "stays on disk untouched" is deleted with no prompt. A Tier 1 field added later would not be enough: an older build would drop the fence during its own recovery. The fix must be in the frozen format.

Smallest fix (pick one before 1a):
- **(a) Manifest copy.** Add `fence: null | {at, keep: Ref}` to `Manifest`, copied from the commit key by every commit. Recovery and restore install the chosen manifest's `fence` into the new commit key and manifest. `fence.keep` becomes a manifest Ref position too. Mutant: "recovery drops the chosen manifest's fence".
- **(b) A top-level key.** Hold the fence as a top-level key `store2-fence` outside the prefix, never GC'd, and remove the commit-key field. Presence means fenced, and the body is the fence list. A deleter reads it after reading R. Per-batch re-checks are not needed, because setting the fence happens only while the commit key is null or damaged (every deleter already refuses, and the marker CAS fences older batches), and clearing it is the safe direction. Release deletes it. This also removes the "every writer copies `fence`" obligation and its mutant. An unreadable `store2-fence` means refuse.
- Either way: correct the "only the Settings action clears" sentence, and add to V1 "fresh start, then commit-key damage, then recovery: no pre-fence key deleted".

### 2. MEDIUM (dead end; MC-223 upstream-to-fork import unreachable). The recovery screen offers its exits only when there are zero candidates

Evidence (READ):
- 3.4b, line 190: "With **zero candidates** it offers ... (a) re-run conversion ... (b) import a `.bin` ... (c) start a new empty profile".
- Candidates are listed by key form (3.2, line 126). A candidate that fails the read-only tree read "fails loudly; the user picks another" (Report 62 line 106).

Consequence (REASONED): when one or more candidates exist and **every** one fails the tree read (a missing or CRC-failing unit), the user cannot pick a working candidate. Neither `.bin` import nor the fresh start is offered, so the profile is stuck. That is exactly U12's case ("no earlier copy to recover"). Separately, a user who would rather import a `.bin` than recover cannot do so while any candidate exists. MC-223 says upstream-to-fork must always work.

Smallest fix: (a) and (b) are always offered below the list. (c) is offered, behind its confirmation, whenever no listed candidate has passed the read-only tree read in this session (or always). Tests: "every candidate fails validation leads to (a), (b) and (c) being offered"; "`.bin` import offered with candidates present". State that a too-new candidate makes the screen read-only (row 3), so no fresh start is offered over newer data.

### 3. MEDIUM (evidence overclaim on a load-bearing simplification). S1 is not covered by any finished model run

Evidence:
- Plan E2 (line 18): "The E1-1 model covered this superset (`verify.md` D7)".
- Section 6 (line 357): D7 is "now exactly the plan's candidate set".
- READ `e1-1\model.mjs:1025`: the model's candidates are `m/` keys plus **every** staged `s/…/m`, with no standing-prefix exclusion. That is a superset, not "exactly" the plan's set.
- READ `results-2.md:7`: the refuse fix was exhausted on a reduced set with "no restore/pins/admission/**bulk**". Only a bulk creates staged manifests, so no refuse run had a staged candidate.
- READ `verify.md:180`: "Bulk, restore, pins and admission together with damage/recovery (reduced sets exclude them; `q_bulk`, `N_rec_f1`, `I_nosm_f1` unfinished)". `W_ri_refuse_wide` (bulkA=1) was inconclusive at about 6 % of seeds (`verify.md:129`).
- verify.md D7 is a divergence note, not a coverage result.

My assessment (REASONED, not executed): S1 is sound.
- Recovery under refuse reads the whole chosen tree into memory before its marker CAS (Report 62 lines 106 to 108). It rewrites every unit under fresh keys, so it never depends on the picked staged keys surviving.
- A GC batch built at R before a silent Node damage can delete only keys that were garbage at R. A pick it deletes mid-read fails loudly, and a pick read completely is safe.
- The standing-prefix exclusion only removes options. Removed options matter only through finding 2.

The evidence label is still wrong, and the candidate key form is frozen, so the check belongs before the declaration.

Smallest fix: relabel E2 and Section 6 as "REASONED; the model's set is a superset; no finished run with bulk + damage + recovery under refuse". Add a pre-freeze variant **V4**: refuse, `bulkA=1`, one damage event, one recovery, Node silent damage, reduced set, exhausted. If it is inconclusive at the cap, report the seed coverage, as Section 6 does for the others.

### 4. MEDIUM (inlay loss after the redirect; the type 21 body is format). `il` = "uuid-shaped occurrences" is still narrower than today's keep rule

Evidence (READ):
- Today's candidates are the ids of literal inlay tokens. The token id is `.+?`, any shape (`M:src/ts/util/inlayTokens.ts:3`). `writeInlayImage` accepts a caller-chosen `id` (`M:inlays.ts:107`, `:139`).
- `IdMatcher` (`M:inlayCleanup.ts:229-279`) keeps three id shapes:
  - a uuid, on any uuid occurrence (`:262-267`);
  - an asset-path id `assets/<64 hex>.<ext>`, on its hash (`:269-273`);
  - **any other shape, on a plain substring** (`:274-278`).
- `UnitCollector` (`:300-323`) records uuids **and asset hashes** and gives up past `MAX_UNIT_IDS = 4096` (`:52`, `:319-321`). Then `canUseSummary()` is false and the text is rescanned (`:282-284`).
- Plan 3.8d (line 289) defines `il` as "every uuid-shaped occurrence" and cites `UnitCollector`. The body of unit type 21 is defined nowhere (3.9, line 296, lists it by name only).

Consequence (REASONED): once characters, modules and plugin values are lazy:
- an inlay whose id is asset-shaped, or of any other shape, and is referenced only by an unloaded owner is no longer protected;
- an owner with more than 4096 ids, if `il` copies the collector's cap, is under-listed.

Today the substring scan over the resident database keeps them. The body schema is part of 1a's golden vectors.

Smallest fix:
- Define the type 21 body now: `{ v, u: uuid[], h: assetHash[], o: string[] }`, where `o` holds the literal token ids of other shapes. There is no cap, or an overflow flag that makes the owner "unknown", so the cleanup refuses.
- The A-lite inlay cleanup deletes an other-shaped candidate only when every owner is resident, or never. Over-protection is the safe direction.
- Tests: an asset-shaped id and an other-shaped id, each held only by an unloaded owner, survive; an owner with 5,000 ids survives.

### 5. MEDIUM-LOW (format evolution; mixed builds). No rule for a derived list whose `v` is above the version this build knows

Evidence (READ): 3.8c (line 275) says only "a list with `v` **below** the current `ASSET_REF_V` is derived from its core or the pass reports incomplete". The same applies to `IL_REF_V` (`il`, the legacy `iv`). 3.1a's Tier 2 covers "a new asset- or inlay-bearing field". It does not say that a version bump of a list's derivation is Tier 2.

Consequence (REASONED): a newer build bumps `IL_REF_V` to add body field `o` (finding 4's kind of fix, done later) without a `req` token. An older build reads the list, ignores `o` and treats the list as complete, so its cleanup deletes what the newer build protects.

Smallest fix: one sentence in 3.8c and 3.1a: "a list unit whose `v` (or `iv`) exceeds this build's known version is treated as unreadable: the pass reports incomplete and deletes nothing". Add a vector and a mutant.

### 6. MEDIUM-LOW (binding 4a item: scope and enumeration). Some deleters are missed; the rule is scoped to "converted" profiles and conflicts with A2.4a

Evidence (READ):
- 3.8c (line 285) starts "On a **converted** profile". A U12 fresh start or a `seed` profile can coexist with an upstream `database/database.bin` (the user may pick (c) over (a); row 9 even re-runs `seed` while the old file exists). The fence suspends only the sweeps, not the legacy deleters.
- Deleters outside `store2/`, `assets/` and `inlays/` that the item does not name (from a repository-wide grep of `delete(` and `deleteMany(`):
  - `M:src/ts/storage/mainFileRename.ts:98`, `:114`: deletes `LEGACY_MAIN_FILE_KEY` after copying it, "run at every block-store boot";
  - `M:src/ts/process/memory/supersededUnits.ts` (header `:1-38`), which deletes re-archive K1 cold units through `deleteColdStorageUnits` (`M:coldstorage.svelte.ts:469`);
  - `M:src/ts/storage/blockStore.ts:646`, `:650`, `:1440`, `:1757`.
  The inlay deletes in `inlayStore.ts` are inside `inlays/`. The Playground inlay explorer's delete is an explicit user action.
- Report 62's 4a boot table deletes fork-format `blocks/` data at the cutover (lines 282 to 283, A2.4a; MC-287 scope). As written, "no deleter touches keys outside `store2/`, `assets/` and `inlays/`" forbids that.

Smallest fix:
- Scope the item to "every A-lite profile (a `store2-commit` exists)".
- Exempt the A2.4a cutover deletion explicitly, under its own MC-287 rules.
- State that the 4a Gate 1 derives the disabled list from a call-site census of every store `delete` / `deleteMany` / `removeItem`, and add the four named sources above.
- The guard test enumerates by that census, not by a hand list.

### 7. LOW-MEDIUM (sweep liveness). A future `at` blocks the sweep for as long as the clock stays behind it

Evidence (READ): 3.8c (line 279): "If it is young ... or its `at` is in the future: **do not write it** and delete nothing". Round 2 asked for "counts as young and is rewritten".

Consequence (REASONED): a record written by a device whose clock was years ahead (a dead RTC, a wrong NTP), or by a Node host or proxy with a wrong clock, stays "young" until real time passes it. The automatic sweep and the Settings button delete nothing in that time. This is not loss; it breaks MC-289 and U9 liveness.

Smallest fix: if `at > now + SWEEP_FUTURE_SLACK` (for example one hour), treat the record as absent: write the fresh candidates with `at = now` and delete nothing. A small future skew stays "young". Add a test, "record dated next year is replaced, nothing deleted".

### 8. LOW-MEDIUM (U12 faithfulness). The fresh start overwrites the damaged commit key itself

Evidence (READ): 3.4c step (4) makes the marker CAS **at the damaged key's bytes / revision**, which replaces the damaged `store2-commit`. U12's chosen option says: "The damaged data stays on disk untouched (nothing deleted), so it could still be rescued by hand later."

Consequence (REASONED): the one damaged object, which a hand rescue would start from (it names the lost `current` and `retained` keys), is the one thing the fresh start destroys. It is cheap to keep.

Smallest fix: the fresh start copies the prior commit-key bytes verbatim into the fence list unit (field `priorCommit`, bytes as base64url, absent for row 2) before step (4). Alternatively, disclose in MC-290 that the commit file itself is replaced.

### 9. LOW-MEDIUM (UX dead end on a normal path). A `seed` marker without an upstream file lands on the recovery screen

Evidence (READ):
- Row 9 re-runs `convert` or `seed` only when "the old upstream main file exists". Row 10 sends either label to the recovery screen when the file is gone.
- A first-boot seed (fresh install, or a fork-only `blocks/` profile in Report 62's 4a table, line 282) never had an upstream file.

Consequence (REASONED): a crash during the very first seed shows a brand-new user a zero-candidate recovery screen with a scary "start a new empty profile" confirmation, instead of re-seeding silently. The same applies to a crashed U12 fresh start (`seed` label).

Smallest fix: `seed` always re-runs (it needs no source; it copies `fence`, so a crashed fresh start resumes). Row 10 then applies to `convert` only. Update the golden vectors and the row tests.

### 10. LOW. Replacing a marker from the recovery screen, and a second fresh start

Evidence (READ):
- 4.6(5): a recovery marker never silently replaces another tab's marker. Row 11 (null current, label `import`) can be **another live tab's** first-life import, whose staged manifest is excluded as standing, so this tab sees zero candidates.
- The fresh start's step (4) and option (b) replace that marker with no foreign-clear prompt.
- A second fresh start after a crash writes a new `fence`, which contradicts "every commit-key writer copies `fence` unchanged" (line 200).

Smallest fix:
- The recovery screen's (b) and (c) replace a foreign marker only through the foreign-clear path (Q3).
- A fresh start over an existing fence writes a fence list that is a superset of the old one (or the union).
- Add a mutant: "fence replaced by a smaller list".

### 11. LOW (product question, do not invent; MC-091). The other two zero-candidate exits delete the damaged data

Evidence (REASONED from 3.4b/3.4c): (a) re-conversion and (b) `.bin` import install a new `current` with `fence: null`. GC and the sweeps then delete the old `store2/` data and its assets. (c) keeps them. U12 was asked only about (c).

Fix: record in MC-290 whether the fence also applies to (a) and (b). The same mechanism covers it at no cost. Until the maintainer answers, either apply it to all three by analogy (labelled, like 10.6) or disclose that (a) and (b) discard.

### 12. LOW (Node conditional-delete mechanics and cost)

Evidence:
- READ: `/api/remove-checked` checks every precondition before removing anything and rejects the **whole** request on the first conflict (`W:server.cjs:1724-1766`). Only after every check passes does it bump the revisions and remove the files (`:1778-1815`).
- READ: the client maps the 409 to `StoreVersionConflictError(key)` (`W:nodeHttpStore.ts:504-507`).
- READ: `/api/read` reads the whole file under the per-key lock even for a HEAD (`W:server.cjs:1546-1551`).
- EXECUTED: Express 4.22.3 answers HEAD on an `app.get` route with the custom headers and a `Date` header (see Artefacts).
- INFERRED: behind nginx, `Date` is nginx's own, since nginx does not pass the upstream `Date` by default. It is still one clock for every device.

Consequences:
- 3.8c's "the delete conflicts and is skipped" requires the client to drop the named asset and retry the rest of the batch. A conflict on `store2-commit` (rebuild the keep-set) must be told apart from one on an asset (skip that asset).
- The recording pass's one HEAD per candidate costs a full server-side file read per orphan.

Fix: state the drop-and-retry and the two 409 kinds in 3.8c, with a test that "one re-saved asset in a batch of 25 deletes the other 24". Add the recording-pass cost (requests and server bytes read) to 8.1(5), or cap the candidates recorded per pass.

### 13. LOW-MEDIUM (cheap defence on the one decision that can seed over data). Row 1 trusts a count of zero

Evidence (READ): row 1 decides "no `store2/` key" by a ranged count, falling back to a list only if the count is unsupported or fails (line 178). The Node count is a new stage 1b server route, and a count cannot be re-filtered (4.3, line 312).

Consequence (REASONED): if the commit key is absent and a bug, proxy or stale answer returns `count: 0` while units exist, the boot seeds or converts. The old units then become GC garbage, which is a silent whole-profile loss, the case row 2 exists to prevent.

Fix: a zero count is confirmed by `listStore2()`, which is re-filtered and cheap exactly when it is truly empty. Add a test: "count says 0, the list names keys: no seed, row 2".

### 14. LOW (test plan). `refsOf` mutants still miss positions

Evidence (READ): 7.1 (line 385) names shard, module-index, `shards[]`, `pluginStorage.refs[]`, bucket values, presets, plugins, `configAl`, `fixed.il`, `legacyKeep` and `fence.keep`. The `Manifest` (3.5, lines 213 to 216) also has `fixed.config`, `fixed.statics`, `fixed.order`, `fixed.loadouts` and `fixed.moduleIndex`.

Fix: generate one mutant per row of the schema table. At least add those five, plus `current.key` / `retained[].key` / `pins[].key` as mark roots, and, under finding 1(a), `manifest.fence.keep`.

### 15. LOW (format hygiene; cheap now, Tier 3 later)

- `ChatEntry.chunks` is `[tail, count, bytes, crc]` (line 242). Every other Ref-bearing tuple is a Ref prefix with trailing extras (`al`, `il`, `configAl`). Recommend `[tail, bytes, crc, count]`, so a generic Ref reader can never read `count` as `bytes`.
- Define the empty chat: at least one chunk, possibly with `msgs: []`, so `st` always has a tail to live in. Today `st` lives only in the last chunk, and `chunks: []` is unspecified.
- Staged manifests are ordered "by reading their `createdAt`". Report 62 C2 (line 478) wants candidates "recognisable by key form ... without body reads" and the list newest first (line 479). The key `g-<stg16>-m<t7><r9>` keeps the length at 43 and orders without body reads, at no cost.

### 16. LOW (consumers and the age record)

The age record's applicability is stated for the boot sweep and the Settings button ("same code"). For consumer (2), the manual clean-up asset delete, it is not stated (3.8c, line 284). Report 62 hides that button until stage 5 (line 289), so this is a stage 5 item. Write it down now.

Also: a first press of the Settings sweep only records candidates, and deletes nothing for 24 hours. The button's string must say so (translator list, Section 9 Gates).

### 17. EDITORIAL

- Line 3 says "Not yet reviewed".
- X9 (line 456) says "this is the second consecutive rejection"; this is round 3.
- Section 6 line 357 says "exactly" (see finding 3).
- 3.4c line 201 says "Only an explicit user action ... writes `fence: null`" (see finding 1).

---

## C. Focus questions

1. **Paths to silent loss, an empty profile or a dead end.**
   - Rows 1 to 11: every row's deleters refuse except row 5. GC refuses on absent, unparsable, too-new and null-current keys, so no empty-profile path remains in the modelled protocol (REASONED). The remaining paths are:
     - finding 13: a wrong zero count seeds over data;
     - finding 1: the fence is lost after a second damage event;
     - finding 2: the dead end when every candidate fails;
     - finding 9: the needless screen after a crashed seed.
   - S1 validation by the read-only tree read is sound (finding 3, REASONED).
   - The fence's GC rule is sound while the commit key survives (READ 3.4c). Suspending the sweeps is a **faithful** reading of U12. The app cannot name the old data's assets and inlays without a list of hundreds of thousands of names, and suspension protects a superset, which is the safe direction. Its only cost, lingering orphans, is disclosed (X16). It stays the author's proposal until MC-290 records it (10.6). The "discard the old data" action is correctly gated by its own confirmation.
   - Every deleter's refusal list includes the fence (3.8c, line 276; 4.6, line 325).
   - The sweep record with the server's `Date`: safe, with a liveness issue (finding 7). The `Date` header was EXECUTED (Express 4.22.3, Node v24.19.0).
   - Revision-conditioned deletes: VERIFIED in the source at `W:nodeHttpStore.ts:462-508` and `W:server.cjs:1656` onward (mechanics in finding 12).
   - `il` scope: partial (findings 4 and 5).
   - The 4a deleter item: partial (finding 6).
2. **Format evolution.**
   - The `req` semantics are sound: a monotonic union, an unknown token means too-new, and the commit key's `req` covers every named manifest's.
   - Unknown codec, type or reserved bytes are too-new everywhere: resolved.
   - The golden vectors are adequate. Add vectors for findings 1, 5 and 9 (fence plus `seed` with no upstream file).
   - Fields still missing that would force an early `fmt` bump:
     - the fence's survival (finding 1);
     - the type 21 body (finding 4);
     - the rule for a list `v` above the known version (finding 5).
   - Hygiene items (finding 15) cost a Tier 3 change if left.
   - `convertedFrom` / `convertedAt` are commit-key-only and lost by a recovery from a damaged key. State whether anything load-bearing reads them. If nothing does, they can be Tier 1 later.
3. **Complexity.** Each mechanism maps to a guarantee:
   - `req`, `refsOf`, refuse, the per-batch fences, the legacy per-file status, the age record, `configAl`, the per-owner `il`, and the fence plus its list.
   - Mergeable or removable without losing a guarantee:
     - **(i)** the commit-key `fence` field and its "every writer copies" obligation, replaced by a top-level `store2-fence` key (finding 1(b)). This removes one mutant class and fixes finding 1.
     - **(ii)** the body reads that order staged manifests (finding 15).
   - Do not add the promotion commit back.
   - The age record's per-item `rev` is needed only on Node. It is right as `null` elsewhere.
4. **Test plan.**
   - The labels are correct. L2 is the only reproducer, and that is right for unwired library code. The legacy-deleter guard is correctly a guard with a mutant.
   - V1 to V3 before the freeze are sound in scope. Add:
     - V4 (finding 3);
     - "fresh start → commit-key damage → recovery" to V1 (finding 1).
   - Missing tests are named in findings 2, 4, 7, 9, 12, 13 and 14.
5. **Upstream `.bin` compatibility (MC-175, MC-223).**
   - Stages 1+3 are unwired and change neither `.bin` import nor export. Unknown fields round-trip at each level (5; 7.2). The CHORE-129 warning gap stays pre-existing (Report 62 I6).
   - U1's old upstream files are protected by the legacy unit plus the 4a item, with finding 6's scope fix.
   - The one MC-223-relevant gap is finding 2: upstream-to-fork `.bin` import is unreachable from the recovery screen while any candidate exists.
   - No defect in the `.bin` path itself.

## D. Checked versus inferred

- **READ and confirmed against the source:**
  - plan citations `M:bootstrap.ts:1171`, `:1183-1187`, `:1194-1214`, `:1217-1229`, `:1310-1351`;
  - `M:globalApi.svelte.ts:564-598` and `:2942-3035`;
  - `M:inlayCleanup.ts:1-35`, `:213-216`, `:229-323`;
  - `W:nodeHttpStore.ts:58`, `:68`, `:71`, `:227-238`, `:240-279`, `:448-453`, `:462-508`, `:523-527`;
  - `W:server.cjs:503-508` (20,000 requests per minute), `:1544-1558`, `:1656-1766`, `:1778-1815`, `:1889-1925`, `:2001-2084`;
  - Report 62 lines 105 to 108, 282 to 283, 289 and 476 to 481;
  - MC-287 scope (`Maintainer-Context.md:9703-9707`);
  - `model.mjs:1025`;
  - `results-2.md:7`, `:21-23`;
  - `verify.md:55`, `:129`, `:180`.
- **EXECUTED:** `datehead.cjs`, as described in Artefacts.
- **REASONED (not executed against code or a model):**
  - the soundness of S1 and S2;
  - every consequence in findings 1 to 13;
  - that suspension is faithful to U12.
- **INFERRED:** nginx's `Date` behaviour; finding 6's assumption that `mainFileRename` and `blockStore` would run on an A-lite profile without a 4a change. The 4a census must confirm it.
- **Not checked:**
  - `nodelist\results.md` and `remeasure\results.md` figures outside lines 84 to 123 (round 2 checked them);
  - Rust paths and `assetSweep.ts`;
  - `inlayCleanup.ts:640-690` (round 2 READ);
  - whether the legacy derivation resolves `remotes/` (TODO in the plan).

## E. Conditions (each closes one finding; the targeted remediation round checks only these)

Before step 1a writes its golden vectors (format):
- **C1** (finding 1). Make the fence survive commit-key damage: either (a) a manifest `fence` field installed by recovery and restore, or (b) a top-level `store2-fence` key. Correct the "only the Settings action clears" sentence. Add a V1 case and a mutant.
- **C2** (finding 4). Define the type 21 body with uuids, asset hashes and other-shaped token ids, and no silent cap. Add the conservative rule for other-shaped candidates and the tests.
- **C3** (finding 5). A list `v` or `iv` above this build's known version is treated as unreadable (pass incomplete). Add a vector and a mutant.

Before the freeze declaration:
- **C4** (finding 3). Relabel the S1 evidence as REASONED with a superset model set, and add V4 (refuse + bulk + damage + recovery, reduced set).

Before the stage 1b Gate 2 (library boot and recovery):
- **C5** (finding 2). Recovery-screen exits are offered whenever no candidate has passed validation, and `.bin` import is always offered. Add tests.
- **C6** (finding 9). `seed` always re-runs, so row 10 applies to `convert` only. Add vectors and tests.
- **C7** (finding 13). A zero count is confirmed by a list before seeding or conversion. Add a test.
- **C8** (finding 10). Recovery-screen exits replace a foreign marker only through the foreign-clear path. A second fresh start writes a superset fence list. Add a mutant.
- **C9** (finding 14). Generate the `refsOf` mutants from the schema table, including the five missing positions.

Before the stage 3 Gate 2 (sweep and codec):
- **C10** (finding 7). A future-`at` record beyond the slack is treated as absent.
- **C11** (finding 12). Drop-and-retry on a 409 per asset; tell a commit-key 409 from an asset 409; record the cost of the recording pass.

Records (MC-290, before the declaration):
- **C12** (findings 8 and 11). Either preserve the prior commit-key bytes in the fence list unit or disclose that it is replaced. Ask the maintainer whether the fence applies to the re-conversion and `.bin`-import exits.

Binding for the 4a Gate 1:
- **C13** (finding 6). The deleter item covers every A-lite profile, exempts A2.4a, and derives its list from a call-site census including `mainFileRename.ts`, `supersededUnits.ts` / `deleteColdStorageUnits` and `blockStore.ts`.

Recommended, not conditions: finding 15 (tuple order, the empty chat, `t7` in the staged key), finding 16 (consumer (2) and the button string), finding 17 (editorial).

## Artefacts (outside the repository)

- `S\stage13\review-opus-r3\review.md` (this file).
- `S\stage13\review-opus-r3\datehead.cjs`: a throwaway check of Express HEAD and the `Date` header.
  - Run: `node datehead.cjs C:\Projects\RisuAI\.claude\worktrees\alite\node_modules\express`, exit 0.
  - Output: Node v24.19.0, Express 4.22.3. GET returned 200 with `date` set, `x-risu-revision: 7` and a 5-byte body. HEAD returned 200 with `date` set, `x-risu-revision: 7` and a 0-byte body. A 404 also carried `date`.
  - The server listened on port 0 on 127.0.0.1 and closed itself; no process was left running.
- Nothing was written in the repository or the worktrees, and no git or index operations were made beyond `status`, `log`, `rev-parse` and `worktree list`.
