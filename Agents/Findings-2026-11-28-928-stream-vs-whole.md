# #928 Streamed versus whole `.bin` import: fresh keys over an existing store (2026-11-28)

Verdict: **accepted-unreproducible.** One bounded scratch attempt over 18 fixture recipes, each with the base made by the whole arm and by the streamed arm (36 runs), found no case where the streamed arm writes more fresh units than the whole arm. Fresh keys by type were identical in every run. "Unreproduced here, not refuted in general" (MC-5002 wording) still applies; the reasoning below says why a separation is not expected from the current layout.

## Method

- Rig: the `run`, `arms`-style helpers of `src/ts/drive/tests/storeImportStream.svelte.test.ts` (ST1/ST2 rig: real committer, memory backend, real `commitStore2Import`), as a scratch test kept out of the repository (`%TEMP%\risu-928\scratch928.svelte.test.ts`, not committed).
- Per recipe: import the base file twice into two identical stores (same seed, same clock), then re-import the file over each store, once with `stream:false` (whole) and once with `stream:{}` (streamed, verdict `stream` in every row). Fresh keys are the keys the second store holds that the first did not, counted by unit type. A duplicate is a fresh non-always-new unit whose digest the store held before the re-import (counted against the pre-import store, not the post-import index).
- Library: `buildLibrary({ seed: 7, characters, chatsPerCharacter: 2, messagesPerChat: 2, modules, archiveCharacters: false, nonChatScale: 0.02 })`. Every owner (character or module) has its own asset list and inlay list unit; with no assets they are equal-content leaves shared by all characters and all modules.

## Recipes and raw counts

Fresh keys per arm (whole = streamed in every row; `sh` shards, `ord` order, `man` manifest, `mb` moduleBucket, `mi` moduleIndex). First import by whole and by streamed gave the same counts.

| Recipe (file over base) | Fresh keys, both arms |
|---|---|
| c80 m0 over itself | 18 (16 sh, 1 ord, 1 man) |
| c80 m1, m2, m3, m12 over itself | 19 (adds 1 mb) |
| c80 m200 over itself | 34 (adds 16 mb: every bucket) |
| c80 m3 / m12 / m200 with a shared asset path on every character and module | 19 / 19 / 34, same shape |
| c80 m12 / m200 with two alternating shared paths (characters and modules crossed) | 19 / 34 |
| c80 m12 with per-owner distinct asset paths | 18 (no mb) |
| file c80 m12 over base c80 m12 with the module order reversed | 20 (adds 1 mb, 1 mi) |
| file c80 m12 over base c40 m12 | 418 total, same by type (1 mb) |
| file c80 m12 over base c80 m3 | 47 total, same by type (9 module, 9 inlayList, 9 assetList, 1 mb, 1 mi) |
| file c80 m12 shared-asset over base c60 m3 shared-asset | 256 total, same by type |
| file c80 m12 shared-asset over base c80 m12 plain | 203 total, same by type |
| file c80 m12 plain over base c80 m12 shared-asset | 203 total, same by type |

"Duplicates" in the three file-over-different-base rows (9, 31, 92 by the pre-import definition) are equal in both arms and expected: when a file holds more equal-content units than the store holds copies of that content, each stored key is handed out once (`UnitSink` one key per encode) and the rest get fresh keys.

## Why the arms can differ in principle, and why they did not here

- Claim order differs. The whole encode runs front, modules, then characters (`scoped.ts`, whole encode); the streamed encode runs each character as it arrives and the front and modules in `finish`. Equal-content leaves claim the first unclaimed stored candidate, so which stored key goes to which owner depends on that order.
- Candidate order is the base walk's, breadth first from the manifest (`baseContent.ts`), not either arm's encode order. Neither arm reproduces it exactly.
- Only a parent that is not always-new (shard, order, manifest are) and whose children are equal-content leaves claimed across the two domains can change. In the current layout that is the moduleBucket (and the moduleIndex above it). Character parents are shards, always new. Plugin-storage buckets hold per-plugin values.
- Observed: the moduleBucket is rewritten under both orders, identically (1 per bucket; all 16 buckets at 200 modules), so the order difference changes which stored key a module list takes but not whether the bucket is rewritten.

## The c301 oddity (2 moduleBucket units in both arms against IT1's at most one): a separate effect

The recipes above give the same signature without any `.bin` input from c301: with modules present the moduleBucket (one per bucket) is written again on a re-import of the same file, in both arms, because module asset and inlay lists are equal-content leaves that compete with the characters' lists for stored keys. It is arm-independent, so it is not #928. IT1's "at most one" holds for a golden with one bucket; a library whose modules fall in 2 buckets writes 2, and the m200 rows write all 16. It is a real, small cost (one bucket plus the moduleIndex when the order changes) with no format or `.bin` impact; if it is worth fixing, the rule belongs in `UnitSink` (module lists claim their own previous keys first), as its own ticket. c301.bin itself was not available in this worktree, so this is inferred from the synthetic reproduction, not measured on c301.

## Permanent guard

`ST6` in `storeImportStream.svelte.test.ts` (compatibility guard, passes before and after): the same re-import whole and streamed over a library with modules writes the same fresh keys by type. Mutant (content index dropped from both streamed passes in `importStream.ts`, so P1b and P2 agree but reuse nothing): ST6 fails (streamed 19 types of fresh keys against whole's `{2:1, 3:16, 16:1, 27:1}`); reverted, main source unchanged.

## Comment text to close #928

> Closing as accepted. One bounded scratch attempt (Agents/Findings-2026-11-28-928-stream-vs-whole.md) imported 18 synthetic library recipes (modules 0 to 200, shared and distinct asset paths, reordered modules, smaller and larger bases, base built whole or streamed) whole and streamed over an existing store: fresh keys by type were identical in all 36 runs. The two arms claim stored keys in a different order, but the only parent that can be affected is the module bucket, and it is rewritten identically in both arms. Not refuted in general; the paired guard ST6 now fails if the arms diverge. The module-bucket rewrite on re-import (seen as c301's 2 buckets) is arm-independent and is a separate, small effect, not part of this ticket.
