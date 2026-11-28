# Import reuse of identical data (#224, NEW-import-dedup) and re-import asset resend (#278, CHORE-102): sizing and plan

Status: **plan, revision 2** (2026-11-28, from `origin/main` 5968b7485; maintainer answers to Q1 to Q4 folded in, section 7). Ticket yor42/RisuTanium#224 (`Refs #224`), related #278. Planning only: no application code, no persisted-format decision taken here. Items marked **Q** are maintainer questions for lane A, each with a recommendation. Gate tier: **2** if any code is added (persisted read/write/GC and asset lifecycle); the measurement stage is Tier 0 (docs only). Decisions respected: MC-175, MC-223, MC-350, MC-774, MC-011, MC-2131 (parked #278), and the #224 issue text ("no format, .bin or migration change (maintainer decision)").

## 0. The headline: the build part of #224 is already merged

The brief assumed dedup still had to be designed. It has not: PR #116 (`bd2477ea6`, 2026-11-20, "Reuse stored units by content when importing a .bin") is on main, and the issue body (re-scoped 2026-11-21) says "code merged; remaining: stage 4 measurement only, no code". This plan therefore (1) records what exists so the claims below can be checked, (2) plans the measurement that remains, and (3) sizes the separate asset-resend problem (#278), which #116 does **not** touch.

## 1. What identity exists today (read from source)

| Layer | Identity | Where |
|---|---|---|
| Store2 unit (every persisted block of the profile: cores, chunks, presets, lists, module buckets, plugin values) | A random key (`newUnitKey`) plus a Ref `[key, bytes, crc]` held by the referrer; a **digest** of the framed bytes: first 128 bits of SHA-256 (`unitDigest`) | `store2/format`, `store2/codec/reuse.ts` |
| Reuse inside the codec | `isSameUnit`: same type, framed length, CRC, digest (and byte for byte when the previous bytes are kept). Used by every save (previous encoding) and now by an import (base content index) | `reuse.ts` |
| Assets (`assets/<name>`) | Named after the SHA-256 of their bytes, 64 lowercase hex plus extension, on every platform (`assetHash.ts` header). Entries of an old or foreign `.bin` need not be hash-named | `assetHash.ts`, `drive/backuplocal.ts` |

So **units already have a content hash and assets are content-addressed by name**. Keys are never written twice, so a digest stays true for its key.

## 2. How #224 works now (built, merged)

1. `readBaseContentIndex(backend, read)` (`store2/baseContent.ts`) walks the manifest the commit key's `current` names, plus its parents (shards, module index and buckets, plugin-storage buckets), reads each unit in batches (256 keys or about 8 MiB), checks length and CRC against the referrer's Ref, and maps `digest -> candidate units`. Not indexed: manifest, shards, `order` (it holds entity ids) and legacy lists/keep. Only `current` is walked, not retained or pinned manifests.
2. The import encode (`planScopedEncode`, whole; `importStream.ts` P1b and P2, streamed) takes a candidate key when the freshly encoded unit has the same digest, type, length and CRC. Ids stay fresh (maintainer decision), so only units that hold no entity id match.
3. The commit carries `{ from, units }` (`importCarry`) naming the base manifest the reused units belong to, so the commit's carry judge protects them; with nothing reused it passes `IMPORT_REPLACES_BASE`.
4. Any problem only removes candidates (absent, damaged, mismatched or malformed unit, backend failure): the import never refuses or waits on the index.

**No format change, no migration, `.bin` untouched.** An import over an existing profile now produces a manifest that names some existing keys instead of fresh equal ones. Upstream `.bin` read and write are the same code as before.

### GC and the refcount risk

There is **no reference count**. GC is a mark-sweep over reachability (`store2/gc/mark.ts`): the live set is every manifest the commit key names (`current`, `retained`, `pins`) plus every unit they and their shards, module index and plugin buckets name. A unit named by two referrers or two manifests is live while any one is named, so "a shared block deleted while still referenced" cannot occur unless the **carried manifest is not named by the commit**. That is the one invariant to protect, and the code does:

- reused units come only from the `current` manifest the index was read from, and the commit carries exactly that manifest (`importCarry`); retained or pinned manifests are not indexed because the commit does not name them (a unit only they name could be freed while the carried manifest stays named);
- the commit refuses with `base-unnamed` when the commit key no longer names the manifest the build was planned over, so a stale index cannot commit;
- `gcImportDedup.test.ts` pins that after the earlier manifest is dropped the pass keeps every shared unit the current tree names.

Residual risks to keep under test: a GC pass deleting a candidate between the index read and the commit (to be re-verified at Gate 1 against `gc/unitAge.ts` if any further change touches the carry), and the streamed path's known limitation (streamed rewrites parent units a whole import reuses).

## 3. Measured benefit and cost (existing evidence, PC; Note 9 not run)

Source: `Agents/Findings-2026-11-28-device-rows-note9.md`, section "#224 stage 4 on the PC (F1-224)" (memory backend, synthetic fixtures; whole = `stream:false`, streamed = `stream:{}`):

| Fixture | Re-import fresh keys | Reused of indexed | Duplicates | Whole vs streamed |
|---|---|---|---|---|
| `library(80)` | 18 (16 shard, 1 order, 1 manifest) | 818 of 818 | 0 | identical |
| `c301.bin` | 20 (16 shard, 2 moduleBucket, 1 order, 1 manifest) | 92 of 94 | 2 under the ST1 definition, 0 against every prior stored unit | identical |
| `mock.bin` | 18 | 47 | 0 | identical |

Index build, `readBaseContentIndex`, 11 runs, no yields, **i9-13900KF (best-case hardware, a lower bound)**: `library(500)` 4,934 units 312 ms median (302 to 329); `c301` 94 units 45 ms; `home500` 4,769 units 442 ms. Scaling by the project's phone factor of about 2.8 gives roughly 0.9 to 1.2 s on the Note 9 for a 500-character library, against an import measured in minutes. That is a scaling, not a measurement.

Honest reading: the benefit is **disk and write amplification on a re-import** (every non-shard, non-order unit is not rewritten, so the store does not double). The fixed overhead is one read of every indexed unit; unit bytes are held batch by batch (about 8 MiB at most), the map holds digests and refs only. At 32 GiB `.bin` scale the profile's units are a small part (assets dominate and are not indexed here), so the index grows with the base profile, not with the file.

Floors: **Note 9**: the walk yields after each batch and memory is bounded; time is the unmeasured part. **Pi 3**: imports go through the Node store backend with the same batched reads (about 20 batched requests per 5,000 units); unmeasured.

"D2 harness": no file with that name exists (F1-224 grepped `Agents/`, `docs/`, `src/`). The closest are `ST1`, `ST2` (`storeImportStream.svelte.test.ts`) and `IT1` (`importTree.test.ts`), which assert but print no counts; F1 measured with a scratch copy of that rig. See Q2.

## 4. #278 (CHORE-102): re-import resends every asset piece

This is **not** covered by #116 (units, not assets). Mechanism, read from source:

- The `.bin` restore loop in `drive/backuplocal.ts` (the asset copy at the `streamLargeAssets` branch) streams every asset above the batch size through `streamAssetEntry`, and batches smaller ones, with **no check whether the same asset is already stored** (a search of that loop for an existence, size or CRC check found none). A re-import writes the same key again, so every piece is read from the file and sent over IPC before it replaces an identical file. Earlier measurement: a re-import adding nothing took 45.5 s because every piece was sent (Roadmap CHORE-102, `1e71c45c`).
- The `.rtb` restore copy already has the skip: `rtbRestoreCopy.ts` `copyAssets` calls `targetHolds` (stored length and CRC32 equal the entry's) for entries up to `chunkMax` and counts them `equal`. Larger entries are still rewritten.
- Because assets are named by the SHA-256 of their bytes, a stored asset with the same hash-named key and the same size is the same asset; foreign names need not be hashes, so name equality alone is not content equality for them.

### Options (Q3)

| Option | What | Format | Risk |
|---|---|---|---|
| A. Stay parked (MC-2131) | Do nothing; record the measured cost | none | none |
| B. Size and hash-name skip | Skip an entry when its name is a 64-hex hash name and the store reports the same size (the sized listing `listAssetsSized` exists on desktop and Android; one listing per import, no reads) | none | A same-size different-content file under a hash name (only after an interrupted earlier write; whether writes are temp file then rename is to be verified at Gate 1) would be left in place |
| C. Verify skip | Skip only when stored length and checksum equal the entry's (as `targetHolds` does for `.rtb`): reads the stored file locally, no IPC send | none | cost of reading stored bytes, still far below sending them |

Recommendation was A now; the maintainer chose **C now** (section 7). #278 was re-parked after measurement (OPQ6) with "revisit if the measured cost becomes a problem", and C reuses the proven `.rtb` rule instead of trusting a name.

## 5. Stages

| Stage | Content | Tier | Needs maintainer |
|---|---|---|---|
| 1 (this PR) | This plan, `Agents/mc/224.md`, `Refs #224` | docs | no |
| 1b | Measurement record, **no code** (the remaining scope of #224): the PC table in section 3, plus the Note 9 index-time row only if Q2 says so; record in Agents; close #224 if the maintainer agrees | 0 | Q1, Q2 |
| (dropped, Q2) | A committed, test-only helper that prints counts (fresh keys by type, reused, duplicates) over `ST1`/`ST2`/`IT1`-style rigs | 1 | Q2 |
| 2 (decided, Q3 = C) | `.bin` asset copy skips an asset whose stored length and checksum equal the entry's; shared helper with `targetHolds`; whole and streamed `.bin` and Node server store arms | 2 (asset lifecycle) | Q3 |

### Tests and mutants for stage 4 (none needed for stages 2 and 3)

- Regression reproducer (fails on base): import a synthetic `.bin` whose assets already exist; the bytes handed to the writer are zero for equal assets and the full size for a changed one.
- Compatibility guards (pass before and after): a changed asset under the same key is replaced; an absent asset is written; a stored asset with the right length and wrong checksum is replaced; a foreign non-hash name is judged by checksum.
- Existing guards that must stay green: `gcImportDedup.test.ts`, `baseContentIndex.test.ts`, `codecContentReuse.test.ts`, `storeImport*.test.ts`, the `.rtb` restore copy tests, the upstream `.bin` round trip tests.
- Mutants (scratch only, per `docs/workflow/ownership.md`): skip without comparing length; skip comparing only the name; checksum of the wrong slice; skip an asset the same import wrote earlier (a duplicate name in one file, the last entry in file order must win); treat a read failure as equal.
- Device rows: none for stages 1 to 3 beyond the optional Note 9 timing; stage 4 asks the maintainer for a Note 9 re-import time row (synthetic profile, MEASURE build), written by the PR's own session.

## 6. Overlaps with other open sessions (noted, not edited)

- **#301** (large character save, MC-4380): changed the save pass and `codec/scoped.ts`. #116 also touched `scoped.ts`, `split.ts` and `reuse.ts`. Stage 4 lives in `backuplocal.ts`, so no overlap; stages 2 and 3 only read. Any later change to the content-reuse path in `scoped.ts` must rebase on #301.
- **#816** (ChroMemory vectors in the `.rtb`, MC-4390): adds an optional side row to `.rtb` export and restore; stage 4 could share `targetHolds` with `rtbRestoreCopy.ts`, which #816 may also edit. Stage 2 has no overlap now that #816 has merged; or put the helper in a new file and leave `rtbRestoreCopy.ts` alone.
- Studio history-core files: untouched.

## 7. Maintainer decisions (2026-11-28, relayed by lane A)

- **Q1: yes.** The remaining scope of #224 is the recorded measurement only; #224 closes on it (this PR, `Closes #224`).
- **Q2: yes.** The PR #116 rigs (`ST1`, `ST2`, `IT1`) plus the F1-224 PC numbers in section 3 are the measurement. No Note 9 MEASURE build, no printing helper (stage 3 is dropped).
- **Q3: option C now.** A `.bin` asset already held is skipped on length plus checksum, as the `.rtb` copy does (`targetHolds`), as its own stage and PR (`Closes #278`), in `backuplocal.ts` or a new helper file (#816 has merged, so no overlap with `rtbRestoreCopy.ts`). Import write path (asset lifecycle): Gate 1 independent plan review and Gate 2 `opus-reviewer`. Named failure scenarios: a held asset that differs but matches length plus checksum; an asset skipped though unreferenced and later collected; the first import after a partial one. Reproducers fail on the base; mutants in scratch.
- **Q4: yes.** The streamed-versus-whole parent-unit limitation is tracked as its own issue (text in the PR report).
- **Merge order:** this PR first (docs), then the #278 PR.

## 7a. Stages after the decisions

| Stage | Content | PR |
|---|---|---|
| 1 | This plan and the measurement record (section 3) | this PR, `Closes #224` |
| 2 | `.bin` asset copy skips a held asset on length plus checksum (C) | its own PR, `Closes #278` |

## 8. Gate record

Gate 1 for stages 2 and 3: not required (documents and a test-only helper). Gate 1 for stage 4 (if Q3 = C): designer plan, independent plan review, `opus-reviewer` for Gate 2. Contract named: a skipped asset must be byte-identical to what the file entry would write. Failure scenario: a truncated or same-size different asset is skipped, leaving a character with a broken image after a "successful" import.
