# Fix &amp; Expansion Roadmap

Derived from [`Summary.md`](Summary.md), the four round-1 reports, four round-2 deep-dive reports, and the standalone multi-instance-conflict report (05) in [`Reports/`](Reports/), each cross-validated by an independent Codex adversarial-review pass (see [`CodexReviews/`](CodexReviews/)). Each item cites its source report for full detail before implementation begins.

Ordering principle: **fix data-loss and correctness first (cheap, high-trust-impact), then the shared architectural root cause (expensive, unlocks everything downstream), then platform breadth.** Android is deliberately the last phase, gated behind Phase 2.

**Status:** Phase 0 (`895c298e`), Phase 0.5, and Phase 1.5 Tier A (`f1cd4184`) are implemented on `investigation/perf-persistence-assets-platform-baseline`. **Phase 1 is complete** — items 1-9 and 11 are done (see the Phase 1 list below for per-item status); item 10 was implemented, found unsafe by Codex review, and deliberately reverted rather than shipped (see that item's note, and Phase 1.5's note for the related conflict-resolution work). **Phase 1.5 Tier B Stage 1 is done** — real optimistic-concurrency conflict detection for the self-hosted Node server (see Phase 1.5 below); it took 9 rounds of Codex review, more than any other single item in this whole effort. **Tier B Stage 2 (client-side account-sync conflict hardening) is also done**, 3 rounds of Codex review. **Stage 3 (blast-radius reduction) went through a full cycle**: an initial attempt (account-sync eligibility + default-flip) was implemented, found unsafe, and reverted (same class of gap as Phase 1 item 10); a follow-up "Stage 3a" attempt (content-addressed naming with automatic GC) was then implemented, had its GC mechanism found unsafe by Codex, sized by a dedicated 6-round scoping report (`Agents/Reports/08-remote-block-gc-transactional-safety.md`) as a large, separately-resourced undertaking not worth building now, and finally shipped **naming-only, GC explicitly skipped** — 2 more rounds of Codex review, one real pre-existing-code bug caught and fixed in the process. See Phase 1.5 below for the full arc. Every shipped fix across all phases was verified by at least one Codex adversarial-review pass and is clean under `svelte-check`; item 11 (a save-format change) also has a dedicated Vitest suite and the full existing suite passing. **Tier B item 3 (BroadcastChannel over-aggressiveness) is now done as well** — the multi-tab force-reload data-loss bug is replaced by a per-backend hybrid auto-reload/prompt; 4 adversarial review rounds, which unlike every other item in this list were run by fresh Sonnet contexts rather than Codex, since the change did not meet the Codex escalation bar (Codex reviewed only the pre-implementation plan).

Phase 1 item 5 (an OPFS storage-backend settings toggle) is the standout example of why this project requires adversarial review: it took **nine rounds** to reach a correct implementation. Rounds 1-2 fixed the batch's other six items and one high-severity bug each in the Drive-restore/autosave race and the inlay-cleanup scope (the latter was ultimately reverted, not fixed further — see below). Rounds 3-9 were spent entirely on item 5's cross-tab correctness: a same-tab-only mutex (round 3) → a notification-only "nudge other tabs to reload" approach, rejected as non-authoritative (round 4) → a timeout-based cross-tab ping/liveness check, rejected because a suspended/backgrounded peer tab could simply fail to respond in time, and because nothing stopped a brand-new tab from opening mid-migration regardless of ping results (round 5) → a real Web Locks (`navigator.locks`)-based cross-tab mutex, which self-deadlocked because the tab's own permanent shared presence lock blocked its own exclusive-mode request (round 6) → fixed, but with a release-before-queue ordering bug that left a window where a tab was briefly invisible to the lock during concurrent migration attempts (round 7) → fixed, but a *queued-but-not-yet-granted* tab was still found to be a fully active writer until it won or lost the race (round 8) → fixed by acquiring the pre-existing in-process `dbWriteLock` as literally the first step of the whole sequence, stopping every attempting tab's own writes immediately regardless of the cross-tab race's outcome (round 9, approved — "Ship"). See `Agents/CodexReviews/phase1/` for all nine rounds.

A fifth, standalone investigation (topic 05, `Reports/05-multi-instance-conflict.md`) was run after Phase 0.5, into multi-tab/multi-device/multi-writer data loss — a distinct problem class from the single-instance save races Phase 0/0.5 already fixed. It found one **confirmed, standalone bug** (account-sync bootstrap silently blanking the remote database on a stale-cache read — fixed as Phase 1.5 Tier A, `f1cd4184`) plus a broader **last-write-wins architecture gap** across every backend, with the account-sync backend's actual severity unverified — and, as of 2026-09-20, confirmed permanently unverifiable, since the remote hub is maintained entirely upstream and its source is not obtainable by this repo. See `Agents/CodexReviews/topic05/05-multi-instance-conflict.codexreview.md` for the Codex review and correction trail. A sixth investigation (topic 06, `Reports/06-conflict-resolution-design-feasibility.md`) assessed which of Report 05's four sketched conflict-resolution designs is most technically feasible and least invasive — recommending revision/ETag-based optimistic concurrency, scoped first to the self-hosted Node server. That recommendation's first concrete increment ("Stage 1") is now implemented — see Phase 1.5 below for the full 9-round review history, which surfaced more genuine, distinct concurrency bugs than any other single change in this entire investigation-and-remediation effort.

Ideas that are **not** part of this campaign — quality-of-life features, nice-to-haves, and things a user asked for that nobody has scoped — live in [`Maybe-Later.md`](Maybe-Later.md). Nothing there is approved or scheduled; it exists so an idea does not die in a chat log. Entries are required to state what already exists before stating what is missing, because more than one "missing" feature in this app has turned out to be built but undiscoverable.

---

## Phase 0 — Quick, low-risk fixes ✅ **DONE** (ship independently, any order, no architectural risk)

These are all small, localized, high-confidence fixes identified across the reports. None depend on each other. Good first-PR candidates.

| Fix | File(s) | Report | Effort |
|---|---|---|---|
| Exclude already-resolved `/sw/img/` sources from `checkImg()`'s re-scan selector | `src/lib/ChatScreens/ChatBody.svelte:185` | 03 | Low |
| Add a distance ceiling to `checkImg()`'s fuzzy fallback (mirror `parser.svelte.ts:619`) | `ChatBody.svelte:226-237` | 03 | Low |
| Reject empty/null bodies in the service-worker register path (stop zero-byte cache poisoning) | `globalApi.svelte.ts:151-155`, `public/sw.js:111-133` | 03 | Low |
| Await `stream.close()` in `OpfsStorage.setItem` (closes a real gap where an async close rejection is silently dropped; currently unreachable via the flag gate) | `src/ts/storage/opfsStorage.ts:12-14` | 02 | Low |
| Give the autosave loop an actual retry path: don't clear `changeTracker`/`changed` until write succeeds; re-arm on failure | `src/ts/globalApi.svelte.ts:409-485` | 02 | Low |
| Surface write failures to the user on first failure, not only once alerts begin at the 5th accumulated failure | `globalApi.svelte.ts:474-482` | 02 | Low |
| Delete orphaned 2024 Capacitor-era assets (`resources/icon-*.png`, `splash*.png`, `capacitor.config.ts`) | `resources/`, repo root | 04 | Low |
| Fix `install_python`'s OS/arch gating (Windows-amd64-only today; on Linux/macOS the failure isn't silent — the frontend proceeds into steps that assume Windows-specific files and can error/panic) and make the frontend actually respect a failed install | `src-tauri/src/main.rs:230-246, 299, 385, 408`, `src/ts/process/models/local.ts:22-54` | 04 | Low |
| **[new, from cross-validation]** Fix the Module "Create" flow's duplicate-insertion bug: `tempModule` gets pushed onto `DBState.db.modules` twice | `src/lib/Setting/Pages/Module/ModuleSettings.svelte:157, 182` | 01 | Low |

**Recommended first PR:** the two `checkImg()` fixes together (asset-corruption items 1-2) — single file, single function, eliminates the most severe corruption mechanism found.

---

## Phase 0.5 — Deep-dive quick fixes (round 2 findings) ✅ **DONE**

A second, open-ended bug-hunting pass (one per Phase-0-era topic, explicitly scoped to find *new* bugs rather than re-verify round 1) surfaced these additional small, independently-scoped fixes. Same "ship independently, any order" character as Phase 0. Full detail in `Reports/*-deepdive.md` and their Codex reviews.

| Fix | File(s) | Report | Effort |
|---|---|---|---|
| **[Android compile blocker — do this first]** Wrap `tauri_plugin_deep_link::init()` and `tauri_plugin_updater::Builder::new().build()` registrations in `#[cfg(desktop)]`, matching the existing pattern already used for `tauri_plugin_single_instance` | `src-tauri/src/main.rs:582, 585, 570-578` | 04-deepdive | Trivial |
| Namespace module assets separately from character assets (or give character assets precedence) so a name+extension collision no longer silently blends an unrelated module's asset in — this is a live bug with no opt-in gate | `src/ts/parser/parser.svelte.ts:410-421, 451-461` | 03-deepdive | Low |
| Fix the `.charx` import size-gate operator-precedence bug: `if((file.originalSize ?? 0) < MAX_ASSET_SIZE_BYTES)` | `src/ts/process/processzip.ts:342` | 03-deepdive | Low |
| Fix `saveDbKei()` to actually `await` and handle its fetch; only advance the rate-limit timestamp on confirmed success | `src/ts/kei/backup.ts:83-104` | 02-deepdive | Low |
| Fix `bgm` playback to react to a changed `risu-ctrl` src instead of gating solely on `!bgmElement` | `src/ts/observer.svelte.ts:60-72` | 03-deepdive | Low |
| Invalidate/re-key `CharEmotion` on emotion edit/removal instead of caching the resolved path by value | `src/ts/characters.ts:183-189` (`rmCharEmotion`), `src/ts/util.ts:336-348`, `src/ts/process/scripts.ts:184-206` | 03-deepdive | Low |
| Wrap plugin-unload callback execution in try/catch and move `host.terminate()` into a `finally`, so a throwing callback can no longer skip cleanup | `src/ts/plugins/apiV3/v3.svelte.ts` (`unloadV3Plugin`, around line 538/550) | 01-deepdive | Low |
| Reset `changeTracker.loadouts`/`.plugins`/`.pluginCustomStorage` after a successful write, mirroring the existing `botPreset`/`modules` handling | `src/ts/globalApi.svelte.ts:435-448` (`mergeUnsavedChanges`), pre-write trim around `:483-486` | 02-deepdive | Low |
| Await the Node-server batch-remove call so its existing `try/catch` can actually catch failures | `src/ts/process/coldstorage.svelte.ts:287` | 02-deepdive | Low |
| Fix the Node-server batch-delete path on both ends: client should hex-encode each key separately (or send a JSON array) instead of one `$$`-joined blob; server should hex-decode the header before splitting on `$$`. Also stop sending `res.send()` per loop iteration — aggregate one response after the loop | `src/ts/storage/nodeStorage.ts:127-142`, `server/node/server.cjs:1215-1245` | 02-deepdive | Low-Medium |
| Cap/evict `fileCache` (the unbounded raw-asset-bytes cache) — an LRU with a byte-size or entry-count ceiling; this is the single most broadly-reproducible new RAM finding in this investigation | `src/ts/globalApi.svelte.ts:99-104, 199-219` | 01-deepdive | Low-Medium |
| Cap/evict the in-memory translation cache | `src/ts/translator.ts:22-25` | 01-deepdive | Low-Medium |

**Resolved during implementation:**
- **Group-chat GC exclusion** (`src/ts/globalApi.svelte.ts`, `getUncleanablesSync`) — investigated before fixing: grepped every UI and character-import write path for `additionalAssets`/`.vits` and found all of them already gated behind `type === 'character'` checks, so nothing currently populates those fields on a real `groupChat` object; they appear to be inert "lazy hack for typechecking" artifacts on the type. Since a defensive fix was cheap and low-risk regardless, applied it anyway: `additionalAssets`/`.vits` collection now runs unconditionally for every character or group-chat entry (only `ccAssets`, which genuinely doesn't exist on `groupChat`, stays inside the `type !== 'group'` narrowing). Closes the risk class entirely, including for any future code path that might populate these fields without remembering to update this allowlist too. ✅ Done, part of Phase 0.5.

---

## Phase 1 — Persistence & asset-integrity hardening (correctness, no architecture change)

Builds on Phase 0's fixes; addresses the remaining, slightly-larger-effort correctness gaps before touching the shared RAM architecture in Phase 2.

**✅ Items 1-9 and 11 are done**, verified by up to nine rounds of Codex adversarial-review (see `Agents/CodexReviews/phase1/`). **Item 10 was implemented, then reverted** — see its entry below.

1. **✅ DONE. Complete the `getUncleanablesSync` allowlist** — add `gptSoVitsConfig.ref_audio_data.assetId` and `NAIImgConfig.*`/`wavespeedImage.reference_image` (`globalApi.svelte.ts:933-1027`). **Note (corrected):** the GPT-SoVITS field is the genuinely urgent one — its deletion is real functional data loss since TTS reads it back directly with no fallback. NAI/Wavespeed fields are lower urgency, since both retain a separate base64 copy used by generation, so their omission mainly risks a stale cached preview, not a broken feature. Do not add `reference_image_multiple` — cross-validation found no current code path that populates it via `saveAsset`. *(Report 03, item 3 — Medium effort.)* Consider a follow-up to derive this list from a schema/registry instead of manual enumeration, since it has already drifted once.
2. **✅ DONE. Add basic storage-quota awareness** — `saveDb()` now checks `navigator.storage.estimate()` before web writes (one-time-per-session non-blocking warning when free space is under 2x the about-to-be-written size) and explicitly catches `QuotaExceededError`/legacy quota error codes with an actionable "free up space" message and a longer backoff, instead of the generic "retrying…" path. *(Report 02, item 4 — Medium effort.)*
3. **✅ DONE. Throttle `database/dbbackup-*.bin` writes** — every autosave cycle used to also write a full extra numbered backup copy; a new backup snapshot is now only written if 5+ minutes have passed since the last one (the primary `database.bin` write is unaffected). *(Report 02, item 5 — Medium effort.)*
4. **✅ DONE. Real mutual exclusion between `loadDrive()`'s restore write and the autosave loop** — implemented as `dbWriteLock`, an in-process async mutex both `saveDb()`'s write step and `loadDrive()`'s restore write must acquire (not a checked-then-acted boolean flag, which Codex round-1 review found still allowed a stale autosave to land after a restore). `loadDrive()` deliberately never releases it on success, since a reload/relaunch follows immediately. *(Report 02, item 6 — Medium effort.)* This same `dbWriteLock` primitive is now reused by item 5's OPFS migration toggle.
5. **✅ DONE. OPFS settings toggle** — decided (user choice) to wire up a real in-app settings path (`src/lib/Setting/Pages/FilesSettings.svelte`, "Local Storage Backend") rather than remove the dead code, now that its atomicity bug is fixed (Phase 0) and it has genuine cross-tab-safe migration in both directions (see the Status section above for the nine-round review history — this ended up being the single hardest-won fix across all phases so far, requiring a real Web Locks (`navigator.locks`)-based cross-tab mutex, not just the in-process `dbWriteLock`). `AGENTS.md`'s storage description updated to match. *(Report 02, item 8.)*
6. **✅ DONE. Cache-freshness signal for service-worker asset entries** (`src/ts/storage/assetIntegrity.ts`, `verifyAssetCacheEntry()`). Investigation while implementing this found that no new persisted marker was actually needed: `saveAsset()` names every asset it creates after the SHA-256 hash of its own content unless called with an explicit custom id, and a repo-wide search confirmed no call site currently does that — so the expected hash is already free to read from any asset's own filename. The new function re-hashes only the cached copy (opening `caches.open('risuCache')` directly from main-thread code, never touching the source-of-truth storage backend) and compares it to that filename-embedded hash — cheaper than fetching a second copy from local storage to compare against, per the item's own goal. Wired into `bootstrap.ts`'s existing boot-time asset-GC sweep as a small, capped, random 3-asset sample per boot (read-only — logs a mismatch, doesn't repair one; full coverage and remediation is item 7's job). Approved by Codex adversarial-review on the first round. *(Report 03, item 5 — Medium effort.)*
7. **✅ DONE. "Asset Cache Integrity" settings section** (`FilesSettings.svelte`, built on item 6's `verifyAssetCacheEntry()`). A "Verify Asset Cache Now" action runs `scanAssetCacheIntegrity()` across every currently-referenced asset (not just item 6's 3-sample boot check), reports a markdown summary (checked/not-cached/not-content-addressed/mismatch counts, listing mismatched basenames), and offers to evict confirmed-corrupted entries via a new `evictAssetCacheEntries()` (safe — only touches the service-worker cache, never source-of-truth storage; `getFileSrc()` already re-registers fresh bytes on the next cache miss, though only on a fresh page load, not for a tab that already resolved that asset this session — the UI says so). The previously-inert `checkCorruption` flag is now a real checkbox controlling whether the item-6 boot-time sample surfaces a toast on a mismatch (silent console-only by default). Gated off entirely for Tauri and for account-sync users (their assets bypass the service-worker cache this feature inspects; `cleanChunks()`'s boot-time path was also hardened to gate on `forageStorage.isAccount` in addition to the pre-existing `db.account?.useSync` check, since Codex review found these two flags can diverge). Took 3 rounds of Codex review: round 1 found a stuck-UI bug (no `try/finally` around the scan) and the missing account-sync gating; round 2 found the `finally` block's unconditional alert-clear was silently erasing the just-set error alert; round 3 approved with no material findings. *(Report 03, item 7 — Medium effort.)*
8. **✅ DONE. Fixed `backuplocal.ts`'s `LoadLocalBackup()`** — aborts immediately on decrypt failure instead of falling through to `decodeRisuSave()` on the still-encrypted bytes; the restore path now calls `setDatabase()` (full shape/default validation, same as bootstrap's own decode path) instead of the unvalidated `setDatabaseLite()` (`DBState.db = data`, no validation at all). *(Report 02-deepdive, Lead 3 — Medium effort.)*
9. **✅ DONE. Write-then-rename atomicity added to `server/node/server.cjs`'s `/api/write`** — writes to a unique temp file in the same directory first, then atomically renames it over the real path, cleaning up the temp file on failure. Closes the same class of gap Phase-0-era work already closed for the OPFS/browser path, for the server backend. *(Report 02-deepdive, Lead 2 — Medium effort.)*
10. **❌ Attempted, then reverted — needs a properly-scoped follow-up, not a quick fix.** Automatic inlay-asset garbage collection (hooking cleanup into character-trash purge) was implemented, but two rounds of Codex review found it unsafe to ship: the exclusion check that was meant to prevent deleting an inlay asset still referenced elsewhere only covered currently-loaded *live* characters, not any other character's *cold-stored* chats — a real risk of permanently deleting a chat attachment a user could still see elsewhere. Properly closing that gap requires either an expensive full cross-character cold-storage scan on every boot-time purge, or a genuine durable pending-cleanup-queue mechanism (to survive interruption between deletion and the character-removal's own eventual persistence) — both disproportionate for what was scoped as a quick fix, and risking exactly the class of "wrongly delete real user data" bug this whole investigation has been trying to eliminate elsewhere. **Decision: do not ship a partial version of this.** The revert is clean (`src/ts/bootstrap.ts` and `src/ts/process/files/inlays.ts` are byte-identical to pre-Phase-1 HEAD) — inlay assets continue to leak (accumulate forever, the pre-existing status quo), which is a real but non-destructive problem, unlike the alternative. *(Report 02-deepdive / 03-deepdive, both flagged this independently — Medium effort turned out to be an underestimate; needs its own properly-scoped design pass, likely alongside Phase 1.5 Tier B's conflict-resolution work since both are about safe, durable, partial-failure-tolerant state cleanup.)*
11. **✅ DONE. Per-block checksums added to the `RisuSave` block format** (`src/ts/storage/risuSave.ts`). Each block now carries two separate CRC32 checksums: a header checksum over `type+compression+nameLen+name+length`, verified before `length` is trusted enough to locate the block's data (a mismatch aborts decoding entirely, since block boundaries can no longer be trusted for any subsequent block either), and a data checksum over the payload alone, verified after (a mismatch safely drops just that one block, matching the pre-existing per-block-failure behavior). The file-level format-version byte now fails closed on any unrecognized value instead of silently guessing "must be legacy." A new post-decode invariant requires that some block actually claimed and successfully parsed as `ROOT` before returning — closing a type-byte-corruption bypass Codex review found in round 1, where a corrupted type byte could redirect the root block into a different type and skip both the checksum and the existing root-specific fatal-parse-failure check. Old (pre-this-change) saves keep decoding exactly as before via an explicit v1/v2 split on that version byte. Two rounds of Codex review: round 1 found the checksum only covered the payload, leaving framing fields and the version byte unprotected (a corrupted length field could desync all subsequent blocks in the file, silently, with no error); round 2 approved after the header/data checksum split and the root-invariant fix, noting the one remaining theoretical gap (a version byte flipped specifically from 1 to 0) is largely self-defeating in practice since reinterpreting a v2 buffer as v1 misaligns the root block's own byte layout, so the root invariant still catches the ordinary case. A new focused test suite (`src/ts/storage/tests/risuSave.test.ts`, 7 tests) covers clean round-trips, payload corruption, framing corruption, root corruption, an unrecognized version byte, and legacy v1 backward compatibility; the full existing Vitest suite (25 files, 237 tests) still passes. *(Report 02-deepdive, Lead 5 — Medium effort.)*

---

## Phase 1.5 — Multi-writer conflict hardening (new, from topic 05)

**Naming note:** "1.5" reflects topical proximity to Phase 1 (persistence hardening), not an ordering dependency — neither tier below depends on anything in Phase 1, and Tier A shipped out of sequence, the same way Phase 0.5's Android compile-blocker fix jumped ahead of its own numbering. Treat both tiers as independently schedulable, same as Phase 0/0.5 items.

Two tiers here: a small, isolated, high-confidence bug fix that can ship independently like Phase 0/0.5 items, and a genuine architectural/product decision that needs to be made deliberately before implementing anything broader.

**Tier A — isolated, quick fix (same risk profile as Phase 0/0.5) ✅ DONE:**

1. **Fixed account-sync bootstrap's `303`/`match:false` null-handling** so a stale-cache signal from the server is never treated as "no database exists." `AccountStorage.getItem` (`src/ts/storage/accountStorage.ts`) now throws a dedicated `AccountSyncCacheMismatchError` on this signal instead of returning `null`; `src/ts/bootstrap.ts` retries up to 3 times (1s apart) on that specific error before finally surfacing a clear, non-destructive error to the user — it no longer falls through to writing an empty database over a real one. `checkNullish()`'s empty-database-creation branch is now only reachable via a genuine 204 "no content" response, the one legitimate "no data" signal. `src/ts/storage/autoStorage.ts`'s `checkAccountSync()` (a second call site for the same read) needed no change — its existing try/catch already aborts safely on any thrown error. Verified by Codex adversarial-review, see `Agents/CodexReviews/topic05-fix/bootstrap-fix.codexreview.md`. *(Report 05, section 7 / scenario 2 — was the single highest-severity confirmed finding in the whole investigation: it required no second writer, no race, no multi-device setup, just one unlucky read.)*

**Tier B — architecture/product decision, now partially implemented:**

The design-feasibility investigation (topic 06, `Reports/06-conflict-resolution-design-feasibility.md`) recommended **Option 1 (revision/ETag-based optimistic concurrency), scoped first to the self-hosted Node server**, with a concrete "Stage 1" increment sketch. That Stage 1 is now:

2. **✅ DONE. Stage 1: real optimistic-concurrency conflict detection for the self-hosted Node server.** `server/node/server.cjs`'s `/api/write`, `/api/read`, and `/api/remove` now track a per-file revision counter (`__revisions.json`) and support an optional `if-match-revision` header — a write/delete whose presented revision doesn't match the server's current one is rejected with `409` instead of silently overwriting, while clients that never send the header (back-compat) get today's unconditional behavior unchanged. `src/ts/storage/nodeStorage.ts` tracks each key's last-known revision and presents it automatically; a `NodeStorageConflictError` distinguishes a real conflict from a generic I/O failure. `src/ts/globalApi.svelte.ts`'s `saveDb()` surfaces a clear one-time toast on conflict ("reload to get the current data") instead of silently retrying into a wall of rejections or escalating to a scary generic error dialog. This was, by a wide margin, the hardest-won fix in the entire investigation-and-remediation effort: **9 rounds of Codex adversarial-review**, each catching a genuine, distinct concurrency bug — see `Agents/CodexReviews/tierb-stage1/` for the full history. In order: (1) the original naive "check-then-write" design had a TOCTOU race allowing two concurrent writers to both pass the revision check (closed with a real per-key async-mutex critical section, verified via a standalone Node concurrency stress test outside the Vitest suite, since `server.cjs` has no existing test infrastructure); (2) content was committed before its revision bump, so a crash in between could leave new content paired with an old, exploitable revision (fixed by reordering: revision-then-content, the safe crash direction); (3) `/api/remove` bypassed the whole mechanism entirely, letting a stale delete silently resurrect newer content a concurrent writer had just saved (brought under the same per-key lock, made conditional, same crash-safe ordering); (4) batch deletes could partially commit before reporting failure, and malformed/misaligned batch headers could silently downgrade to unconditional (fixed with a new `withFileWriteLocks` nested-lock primitive giving true all-or-nothing batch semantics, plus strict header validation — also stress-tested standalone for deadlock-freedom across overlapping key sets); (5) the deleted key's "tombstone" revision was being discarded client-side, making delete-then-recreate unconditional again (fixed by having the client retain and present it); (6) `fs.rm()` wasn't idempotent and a mid-batch I/O failure left the client with no way to reconcile what had actually committed (fixed with `force:true` plus attaching committed revisions to failure responses); (7) the revision-persistence queue itself could let one request's successful save durably commit a *different*, concurrent request's not-yet-confirmed mutation, making that second request's own failure-rollback a lie (fixed with a new global `withRevisionTransaction` queue serializing the full validate→mutate→persist→rollback sequence, layered under the per-key locks — also stress-tested standalone); (8) `/api/read` had no locking at all, letting a reader land in the crash-safe staged-commit window and receive a new revision paired with old content, which it could then use as a false permission slip to overwrite a write it never actually observed (fixed by locking reads too); (9) that same read-lock fix initially held the lock for the full streamed-response duration, creating a new denial-of-service vector where a stalled/non-consuming client could block all writers to a key indefinitely (fixed by snapshotting the file into memory under the lock, then releasing the lock before sending the response — decoupling lock duration from client download speed entirely). Approved on round 9 with no material findings. Also fixed lowercase-hex-path canonicalization across all three handlers (Windows/macOS are case-insensitive filesystems) and duplicate-path rejection for batches; a pre-existing-uppercase-filename migration path was deliberately deferred as a documented, independently-assessed-as-low-risk limitation (every hex-encoding call site in this repo's own client code is provably lowercase-only). Deliberately excludes account-sync and Tauri, matching the report's own scoping (Tauri bypasses shared storage entirely; the account-sync hub is out of this repo's control). *(Report 06, "Sketch of the first concrete increment" — sized as Medium-High effort in the original sketch; actual effort was substantially higher once adversarial review started finding real concurrency bugs, which is exactly the kind of gap this whole review process exists to catch before it reaches production.)*
3. **✅ DONE. BroadcastChannel over-aggressiveness: hybrid auto-reload / prompt, scoped per backend.** `channel.onmessage` (`src/ts/globalApi.svelte.ts`) used to set a one-way `gotChannel` latch on the *first* save broadcast from any other tab and force-reload it — and a separate bail-out at the top of `saveDb()`'s loop meant that tab then never saved again for the rest of its page load. Unsaved edits in the losing tab were discarded with no prompt; the `mergeUnsavedChanges()` call on that path preserved only change-tracker identifiers, never content, so it was dead bookkeeping rather than the safety net it looked like. Now the handler only sets a flag, and the decision is made once per iteration *inside* the save loop — deliberately not in the message handler, where `location.reload()` can tear an in-flight write. A **clean** tab auto-reloads silently (rate-limited, burst-capped, history in `sessionStorage`, and it will not auto-reload at all if that history cannot be persisted and read back, since a tab that cannot record that it reloaded would loop forever); a **dirty** tab is prompted. Neither `changed` (500ms-debounced, cleared at write start) nor `changeTracker` (trimmed to its head element mid-write, so a clean tab reads non-empty) was usable as a dirty signal, so a dedicated `dirtySinceLastSave` flag was added, cleared at the tracker-snapshot point and restored only on the pre-commit failure path. All decision logic lives in a new dependency-free `src/ts/storage/multiTabReload.ts` (mirroring the `remoteSaveCleanup.ts` idiom) with a 46-case Vitest suite across 7 groups — the only part of this feature that can carry executing coverage, for the reason given under Verification below. **The prompt is scoped per backend, because on revision-aware backends "save mine" is impossible:** `NodeStorage.knownRevisions` is per-instance and deliberately never refreshed from a 409 (`src/ts/storage/nodeStorage.ts`), so the peer save that triggers the prompt is precisely what makes this tab's revision stale — a save-mine write would 409 pre-commit on every retry, forever. On Tauri and OPFS/localForage (revision-unaware) the prompt offers save-mine / discard-mine and both genuinely work; on `isNodeServer || forageStorage.isAccount` it offers reload / stay-and-park instead, with copy that says plainly the edits cannot be saved from this tab until it reloads. **Disclosed limitation: on revision-aware backends, a dirty tab whose peer has saved has no path to keep its edits** — reload discards them, stay parks the tab and they are discarded on the eventual reload. That is the Stage 1/2 optimistic-concurrency guard working exactly as designed, and the pre-batch code discarded those edits too, just without asking; genuinely closing it needs the cross-tab conflict resolution deferred behind Phase 2, not a change here. **A pre-existing bug was found and fixed in the process:** `saveDb()`'s `try` spans past the primary commit through the backup writes, `getDbBackups()`, and `saveDbKei()`, and its catch unconditionally re-merged the tracker and set `changed = true` — so a failure in ancillary post-commit work re-committed the already-committed primary payload, able to overwrite a newer peer write that had landed in between. Now gated on a new `primaryCommitted` flag, with a separate `postCommitFailStreak` counter so a persistently failing backup pipeline still escalates to the user instead of degrading to console-only forever. The broadcast also moved from *before* the write to immediately after the primary commit's lock release — not next to `saveDbKei()`, which is a network call with a 15s `AbortSignal.timeout`. **Review history — 4 adversarial rounds, run by fresh Sonnet contexts rather than Codex** (this did not meet the Codex escalation bar; Codex reviewed the pre-implementation plan only, rejecting revisions 1 and 2): the independent plan review also rejected revision 1, on a permanent `reloadDecisionMade` latch that reproduced the very bug being fixed. Post-implementation round 1 rejected on the `primaryCommitted` early-return silently swallowing the existing quota toast and Node/account conflict escalation for every post-commit failure — a working user-facing error path removed as collateral. Round 3 rejected on two confirmed defects: a `finalFlushPending` reload that fired without re-checking dirtiness, destroying edits made during the write window (a *new* intra-tab data-loss path, in the feature whose entire purpose is preventing exactly that), and the conflict branches never being gated on `primaryCommitted`, so an ancillary backup-prune 409 falsely told the user their save had failed and parked the tab permanently — reintroducing, through a different door, the same "one event disables saving forever" failure this item exists to remove. Round 4 returned approve-with-findings, having confirmed the save-mine impossibility above. The post-flush reload was **deleted rather than patched**, on the reasoning that after flushing, this tab already holds the newest committed state — the reload re-read its own write, and its only distinctive effect was destroying concurrent edits. One further defect was caught by the orchestrator reading the final diff rather than by any reviewer: the new revision-aware `stay` option fell through into the normal save loop, and because a dirty tab already has `changed === true` from the debounce, it immediately 409'd and surfaced a second, unexpected conflict alert before parking anyway — `stay` now parks deliberately and quietly, as its label promises. Worth recording for future rounds: two reviewers were pointed at the `finalFlushPending` reload with explicit instructions to attack it hardest, and only one found the data-loss path — a single clean review round is weak evidence of correctness on this kind of change, not proof. **Verification:** `svelte-check` 0 errors / 0 warnings; full Vitest suite 27 files, 287 passed / 3 skipped (pre-item baseline: 26 files, 241 passed / 3 skipped). **No executing test covers the wiring inside `saveDb()` itself, and deliberately so** — happy-dom ships no `BroadcastChannel` at all (verified empirically, not assumed), so such a test would silently no-op rather than fail, which is worse than having none. Two-simultaneously-dirty-tabs last-write-wins persists on revision-unaware backends (Phase 2 work), as does the sub-frame window between `$effect.root` install and its first effect flush. No change to the `.bin` save format, block layout, pointer versions, or any plugin-facing contract. *(Report 05, section 1.)*
4. **✅ DONE. Stage 2: client-side account-sync conflict hardening.** `src/ts/storage/accountStorage.ts`'s `AccountStorage.setItem` no longer writes the just-sent value into its local `cachedForage` read-cache until the server response is actually confirmed successful (2xx, or 304 meaning "already matches") — previously it cached unconditionally right after the `fetch` resolved, before the status check, so a rejected write would still leave the local cache holding the now-stale content, which a later `getItem`'s 303/match:true fast path could serve back as if it had been accepted. A new `AccountSyncConflictError` (thrown on `409`/`412`) lets `saveDb()` (`src/ts/globalApi.svelte.ts`) react the same way it already does to `NodeStorageConflictError`: a one-time toast, then the loop genuinely stops retrying (see item below — this surfaced a real bug in the *already-shipped* Stage 1 toast handling too). Whether the account-sync hub actually sends `409`/`412` today is unverified (its source isn't in this repo) — this change is a pure "stop actively defeating whatever protection the hub might already have" client-side improvement, not a guarantee of hub-side enforcement, exactly as Report 06 scoped it. Took 3 rounds of Codex review: round 1 found that enabling Stage 3 (below) alongside this introduced a real split-write corruption path, and that both this branch's and the *pre-existing, already-9-round-approved* `NodeStorageConflictError` branch's "stop retrying" claims were false — both just slept 2s and silently resumed retrying via the outer save loop; round 2 approved the Stage 3 revert and the retry-loop fix's intent, but caught that the retry-loop fix's `sleep(100000000)` was itself broken (milliseconds, not an arbitrary "forever" unit — only ~27.8 hours, not ~3170 years) and would silently resume retrying after that window on a long-lived session; round 3 approved after a genuinely non-resolving `sleepForever()` helper (`src/ts/util.ts`) replaced it in both conflict branches, plus the identical pre-existing bug at its original source (`accountStorage.ts`'s `reloadSession` handling, which had the same `sleep(100000000) // wait forever` mistake). See `Agents/CodexReviews/tierb-stage2-4/` for the full 3-round history. *(Report 06, "Incremental adoption path," stage 2.)*
5. **❌ Attempted, then reverted — Stage 3 (blast-radius reduction) needs a properly-scoped follow-up, not a quick change.** Extending the existing per-character `remote: 'prefer'` block-splitting mechanism's eligibility to account-sync, and flipping `db.enableRemoteSaving`'s default from opt-in to opt-out (the latter an explicit, informed product decision made in-session, not something implemented unilaterally), were both implemented, then reverted after round 1 of Codex review on item 4's work found a real, high-severity data-integrity gap: `encodeRemoteBlock` persists a character's `remotes/<chaId>.local.bin` block as a separate, non-transactional write during `encoder.set()`, *before* `saveDb()` attempts the root `database.bin` write those blocks are referenced from. Remote blocks aren't versioned or content-addressed, so a stale client can successfully overwrite a character's remote block, then correctly have its root write rejected by the revision check — but the newer, already-accepted root (written by a different, non-stale client) already references that same stable filename, so a later read can return the stale client's character payload even though the write that produced it was rejected. Enabling this mechanism more broadly (opt-out by default, plus newly eligible for account-sync, which is exactly where Stage 1/2's conflict detection is supposed to matter most) would have actively undermined the protection Stage 1/2 just built, at precisely the boundary it was extended to. This is the same class of gap, and the same "properly closing it requires real design work, not a quick fix" conclusion, as Phase 1 item 10's inlay-GC revert: the actual fix needs content-addressed/versioned remote blocks with an atomically-committed root reference (publish blocks under unique names first, then atomically/conditionally commit the root referencing the exact version, garbage-collecting unreferenced blocks later) — a real format/protocol change, not a default flip. The revert is clean: `src/ts/storage/risuSave.ts` and `src/ts/setting/advancedSettingsData.ts` are byte-identical to pre-this-session HEAD. The pre-existing, smaller-blast-radius version of the same gap (for Tauri/Node-server users who already explicitly opted in via the settings checkbox) is unchanged status quo, not newly introduced. **A dedicated design-feasibility investigation for the actual fix is done** — see `Agents/Reports/07-remote-block-versioning-design.md` (6 rounds of Codex review, `Agents/CodexReviews/topic07/`; more rounds than any single report in this effort so far, reflecting how many rounds it took to stop the report itself from silently re-introducing a version of the same "assumed safe, actually isn't" pattern this whole investigation exists to catch). Verified findings: `saveDb()`'s existing write ordering already does "publish leaf blocks, then commit the gated root" — no new transaction primitive is needed there, only a naming change (content-addressed `remotes/<chaId>.<hash>.bin`, recommended over a revision-counter scheme, which would also be permanently unbuildable for account-sync). Migration is free via a pointer version-discriminator. **The actual hard part, left honestly unresolved by the report rather than papered over: reclaiming superseded remote-block versions has a genuine, unsolved concurrency race** (GC's existing read-then-decide-then-later-delete structure can execute a stale deletion decision after a legitimate republish; a grace period alone does not close it) that needs the same interleaving analysis and stress-testing Tier B Stage 1 needed, not a quick fix — and **account-sync reclamation specifically is blocked outright**, independent of that: `AccountStorage` has no key-enumeration or deletion capability at all, so there is nothing to build a sweep on top of without hub cooperation (confirmed unobtainable, see `Agents/Summary.md` §5). Net effect: a future Stage 3a (naming fix + a properly designed-and-verified GC concurrency protocol, Tauri/Node-server only) is well-scoped and re-attemptable; Stage 3b/3c (account-sync eligibility) remains a genuine open blocker, not merely deferred work.

**Stage 3a was then attempted** (content-addressed naming, `hashRemoteBlockContent()`, `v:2` pointers, version-aware `isRemoteSaveFileLive()`/GC liveness logic, `decodeRemotePointers()` — all still sitting uncommitted in the working tree) but its GC concurrency protocol was found unsafe on both backends by Codex review (`Agents/CodexReviews/tierb-stage3a/`): GC's liveness decision, made from a stale snapshot, wasn't validated against whether the root was about to start referencing a candidate for the first time. **A dedicated follow-up scoping report sized exactly what a real fix would require**: `Agents/Reports/08-remote-block-gc-transactional-safety.md` — this took **6 rounds of Codex review**, the most of any single report in this whole effort, each round finding a new, genuinely deeper gap in the report's own proposed fix (not cosmetic issues — a structural TOCTOU that survives naive precondition-checking, a precondition set that needs a third key, and a step-ordering requirement that no precondition list alone can substitute for). Final, confirmed-sound design if GC is ever built: for the Node server, a three-way revision precondition (candidate key, root, and the candidate's own `.meta` liveness file, all captured from one shared decision-time snapshot) on an extended `/api/remove`, plus reordering `encodeRemoteBlock()` so `.meta` refresh is the first, awaited step of publishing — this closes 2 of 3 known race orderings outright and makes the grace period actually bound the third (previously it didn't, since nothing refreshed `.meta` on republish). For Tauri, widening `withRemoteBlockGcLock` (a single global, not per-key, mutex) to span the writer's entire publish-through-commit sequence, with GC's own decision moved inside that same lock, closes its analogous race completely — a stronger guarantee than Node-server can cheaply achieve, since Tauri doesn't need to scale. **Report 08's own recommendation: do not build this.** GC is confirmed non-load-bearing for correctness (Report 07); the real fix is realistically comparable in review cost to Tier B Stage 1's nine rounds — this report's own 6 rounds sizing it, not even implementing it, are direct evidence of that. **✅ DONE. Shipped naming-only, per Report 08's own recommendation — automatic GC explicitly skipped as not worth the cost.** All GC-only machinery (`withRemoteBlockGcLock`, `RisuSaveDecoder`'s `remotePointers`/`skipRemoteFetch`, `decodeRemotePointers()`) was removed from `src/ts/storage/risuSave.ts`; `src/ts/bootstrap.ts` and `src/ts/storage/remoteSaveCleanup.ts`/its test suite were reverted byte-for-byte to their pre-this-effort state via `git checkout HEAD --`, so the pre-existing (already-safe, never found unsafe by any review in this chain) GC sweep is untouched — it only recognizes the legacy bare-name (`.local.bin`) shape and silently leaves every new hash-named (`v:2`) file unmanaged. **One real bug was caught in this final stripping pass, not a pre-existing issue this session introduced**: `cleanChunks()`'s non-Tauri branch derived a candidate's character id via a hard-coded `getBasename(asset).slice(0, -10)` (removing exactly the length of the literal ".local.bin"), a safe shortcut back when that was the only possible suffix — fed a hash-named file, it silently produced a bogus, never-matching id, making a *live* character's remote block look orphaned and deletable after the grace period. Fixed by switching to the same already-tested `getRemoteSavePayloadName()` helper the Tauri branch already used correctly, closing the one remaining gap between the two branches' recognition rules. 2 rounds of Codex review, see `Agents/CodexReviews/tierb-stage3a-naming-only/`. `svelte-check` 0 errors, full Vitest suite passing (26 files, 241 tests, 3 pre-existing skipped). Superseded remote-block versions now accumulate unreclaimed — an accepted, explicit, quantifiable-only-in-disk-space tradeoff, not data loss — until/unless a future, separately-resourced effort revisits Report 08's sized fix. *(Report 06, "Incremental adoption path," stage 3 / Report 05, section 5 / Report 07 / Report 08.)*
6. **Not attempted — Stage 4 (report's own numbering), and now confirmed permanently unreachable rather than merely blocked pending investigation.** Revisiting whether account-sync can get real server-enforced revision checking depends on either obtaining the hub's (RisuAccount) source or running live multi-session tests against it; Report 06 originally flagged this as *unverified* (no hub source present in this repo, inferred from the absence of `/api/account/*` routes in `server/node/server.cjs`). **Update (2026-09-20):** the project owner directly confirmed the hub is maintained entirely upstream and cannot be modified from this repo at all — this is a confirmed hard constraint, not an open question that more investigation could resolve. Stage 4 is therefore not "not yet scheduled" but genuinely out of scope for this repo, permanently; any future account-sync hardening is limited to what Stage 2's client-side-only approach already represents (see item 4 above). See `Agents/Summary.md` §5 for the same correction. *(Report 06, "Incremental adoption path," stage 4.)*
7. **Deliberately deferred behind Phase 2 (explicit product decision).** Option 3 (CRDT/op-log merge) and Option 4 (hard lock + takeover UI) — both viable later additions layered on Stage 1/2's revision infrastructure, but neither should start before Phase 2's per-character DB decomposition (Phase 2 item 5) exists, since that's the same kind of granular-slice thinking a per-chat conflict design would reuse, and before a product owner decides whether detect-and-refuse is an acceptable long-term UX. *(Report 06, "Incremental adoption path," stage 5.)*

**Round 3 (2026-09-21, Opus): three further live persistence bugs found and fixed.** An audit
of the save loop turned up three data-loss paths that all nine prior Codex rounds had missed,
each shipped with its own fresh-context adversarial review:

8. **✅ DONE — a cancelled reload parked the save loop forever** (`a5dd6566`). Declining the
   multi-tab reload prompt left the tab permanently unable to autosave, with no indication.
   Fixed by suppression rather than detection, after the first plan was rejected for
   introducing two NEW loss paths of its own.
9. **✅ DONE — the multi-tab auto-reload destroyed in-progress drafts** (`ae167294`). A reload
   triggered by another tab discarded unsent composer text, in-flight message edits, and
   translation edits. Adds a draft registry (`src/ts/localDrafts.ts`) consulted by
   `getMultiTabAction`, with five draft holders registered via `$effect` on state.
10. **✅ DONE — preset renames and images were never written to disk** (`339d5ed1` +
    `8bc0f426`). The `botPresets` change-tracking effect read only `botPresetsId` and
    `.length`, so in-place mutations were never flagged, and that flag gates whether the
    preset block is re-encoded at all. The fix is a one-line deep snapshot; the preceding
    commit extracts the six change-tracking effects out of `saveDb()` into
    `registerDbChangeEffects` so they could be tested against production code rather than a
    re-implementation. Measured snapshot cost 0.24/1.76/7.33 ms at 3/15/50 presets, paid on
    preset-array mutations only.

Process notes worth keeping. Item 10 went through two REJECTs: the first (plan gate) corrected
a premise about which mutation paths were actually lossy; the second (post-implementation)
caught a **false scenario in the commit message itself** — an unverified reviewer claim from
the earlier gate that was propagated without being re-checked. Both reviews were fresh Opus
contexts, not Codex, per the standing escalation rule. The tests were deliberately written
against the unfixed code and verified red before the fix, and the one path that could not be
traced end-to-end was turned into a test rather than asserted in prose.

**The alertStore hijack: investigated 2026-09-21, scoped, and deliberately NOT attempted.**
Worth reading before anyone tries it, because the obvious fix is wrong and the reason is
not obvious.

*Mechanism (confirmed).* All modals share one global slot (`alertStore`, `stores.svelte.ts`
~55). Every promise-returning alert in `src/ts/alert.ts` does `set(...)` then `await
waitAlert()` (polls for `type === 'none'`) then `return get(alertStore).msg`. If a second
alert is requested while one is pending, it overwrites the slot; when the user answers,
BOTH pending waiters break and BOTH read the same answer. A chat rename can receive `'yes'`
from an unrelated confirm dialog. There are 13 promise-returning alert functions.

*Why a mutex in `alert.ts` does not fix it.* Ownership cannot be enforced from `alert.ts`,
because `alert.ts` ~25 re-exports a set-only `alertStore` wrapper. Counted: **83** direct
`alertStore.set` writers, **16** `alertClear()` calls and **45** `alertWait()` calls outside
that module, plus the Enter-key handler (`hotkey.ts` ~250) which resolves any pending
`ask`/`normal`/`error` with `'yes'`. A mutex would serialize requests while leaving every one
of those able to resolve a slot-owning alert with a foreign value -- false ownership, which is
worse than none.

*The load-bearing surprise.* Escape-to-close is implemented AS a clobber: `hotkey.ts` ~243
calls `alertToast('Alert Closed')` to dismiss a modal. So toasts cannot be serialized
(Escape would deadlock against the modal it is cancelling) and cannot be left alone (Escape
is the most frequent wrong-value path in the app). Toasts need their own store slot, which
in turn means Escape needs a real cancel protocol to replace the clobber.

*Two alerts have no user-reachable exit at all,* which a queue would convert from a local
annoyance into a permanent global wedge: `alertLogin` (no cancel control; called in a retry
loop at `accountStorage.ts` ~170) and `alertErrorWait`/`'wait2'` (matches no button branch in
`AlertComp.svelte`). A wedged chain means the save loop's conflict prompt never appears and
the tab stops persisting silently -- without even setting `savingStoppedReason`.

*A live data-loss instance, independent of multi-tab:* `bootstrap.ts` ~403-448 maps corrupted
modules through `Promise.all`, so with two corrupted modules one callback's `alertError`
destroys the other's `alertConfirm(resetLorebookQuestion)` mid-flight; Enter then resolves it
`'yes'` and `v.lorebook = []` wipes a lorebook for a question the user never saw.

*Shape of a real fix,* per the plan gate that rejected the mutex-only design: separate toast
store; an explicit `alertCancel()` sentinel mapped inside `alert.ts` to each function's
existing cancel value (near-zero call-site churn -- `''` already means cancelled today, which
is why the sentinel approach is cheaper than it looks); cancel controls added to the `login`
and `wait2` branches; `alertWait`/`alertClear` routed through the slot owner or documented as
owner-only; and `nodeStorage.checkAuth` deduped, since serialization turns its concurrent
callers into N sequential password prompts with conflicting `/api/set_password` writes.
That is a multi-stage project, not a patch.

**Still open, identified but not fixed:** the `alertStore` modal hijack (a spontaneous
multi-tab prompt can resolve a pending `alertInput`, e.g. renaming a chat to `"0"`); the
absence of any "this tab has stopped saving" indicator on the three intentional park paths;
and the pre-existing last-writer-wins whole-DB overwrite, which remains architectural.

---

## Phase 2 — RAM/architecture rework (the shared root cause; highest leverage, highest effort)

This phase is the load-bearing one: it's what Phase 4 (Android) is gated behind, and it's the most consequential thing found in any of the four investigations. Sequence sub-items by risk — start with the isolated component-level fix, end with the DB-wide architectural change.

**Status (2026-09-30) — Phase 2 is in progress; it has not landed.** Work on it has run since 2026-09-21, and the notes under the items below are the record. Per item, as those notes state it:
- **Item 1 (module-editor keystroke cost): done on the i9-13900K, best case.** Stage A `f4867e63` and Stage B (2026-09-21) are both marked done. Asset-heavy modules still exceed the frame budget while being edited, and Pi and mobile are unmeasured.
- **Item 2 (`saveDb()` change-tracking effects): partly done.** The selected-character effect is partitioned (CHORE-01 Stage 2, `fbf799a7`). The top-level part of the effect family (`characterOrder` and the other non-character keys) was not repartitioned by Stage 2.
- **Item 3 (virtual scrolling): partly done.** The avatar track AV-1 to AV-4 is committed (`64777a34`, `97c3f53a`, `d6ee89db`, `41977ac0`), and so is the chat-list Stage A (`96311c4a`). Real windowing of the chat list, virtual scrolling of the character lists and the sidebar rework are still open.
- **Item 8 (resident chat data for characters that are not open): in progress.** The memory-footprint work (`MC-119`, `MC-130`, Report 49) addresses the problem this item measures, at the character grain; see the 2026-09-30 note under item 8 (`Reports/49-memory-stage-1-plan.md`). Stage 1 as a whole is not done: step 1 is committed as `2b3dd636` (Report 50, Gate 2 approved at round 3), step 2 as `db49aeeb` (Report 51; Gate 2: round 1 [REJECT], round 2 [APPROVE], round 3 [EDITORIAL]), step 3a (plugin and MCP reads and writes of archived characters) as `bd57aa19` (Report 52; Gate 2: rounds 1 and 2 [REJECT], round 3 [APPROVE]), and step 3b (groups, the Playground's restore, the dataset export, the asset-integrity check and the plugin documentation) as `1b38b5d5` (Report 53; Gate 2: round 1 [REJECT], rounds 2 and 3 [APPROVE]). **Step 4 (the backup: units closed under "refers to", error-text keys, plugin storage of any shape, `value` retention dropped; D13, `MC-147`) is done**, committed as `a6719e35` (Report 55; Gate 2 by `opus-reviewer`: round 1 [REJECT], round 2 [EDITORIAL]). Steps 5, 6 and 7 are done (see the note under item 8's stage 1 below, 2026-10-04). D20's heap projection was not met: 344 MB after boot against 70-76 MB, with modules about 305 MB of it.
- **Item 4 (size-based compaction): open.** Stage 1 touches it only at the character grain; see the 2026-09-30 note under item 4.
- **Items 5, 6, 7: no work recorded in this file** (item 7's characters list was folded into item 3 on 2026-09-21). **Item 9 (per-chat save blocks): not started** (its own text says so).
- **Exit criterion: not recorded as met** (last paragraph of this phase). Phase 4's gate is unchanged.

1. **Module-editor per-keystroke cost.** Split into two independent stages after investigation; see [`Reports/09-stage-a-module-effect-narrowing-plan.md`](Reports/09-stage-a-module-effect-narrowing-plan.md). *(Report 01, recommendation 1.)*

   - **Stage A — narrow the GUI-side dependency tracking. ✅ DONE (`f4867e63`, 2026-09-21).** The `$effect` driving `moduleUpdate()` (`stores.svelte.ts:197`) deep-cloned the whole modules array on every keystroke via `$state.snapshot()` purely to register dependencies. Replaced with `trackModuleUpdateDeps()` (`src/ts/process/moduleUpdateDeps.ts`), reading only the four fields `moduleUpdate()` consumes. Measured 58.35 ms → 29.21 ms per keystroke (2.00x) on the 52-module fixture. Red-before-green tests plus a live-app verification that `hideIcon`/`backgroundEmbedding` still re-run the effect and `name` no longer does.

   - **Stage B — partition the persistence-side dirty-tracking effect. ✅ DONE (2026-09-21).** Plan and all gate records: [`Reports/11-stage-b-module-effect-partition-plan.md`](Reports/11-stage-b-module-effect-partition-plan.md). `dbChangeEffects.svelte.ts`'s modules effect deep-read the **entire** modules array on every keystroke; it is now an outer effect over array shape plus one child effect per module, so a leaf edit re-reads only that module. **A partition, not a narrowing**: the dependency closure is set-identical, `tracker.modules` stays one boolean, and save behaviour, the save format and upstream compatibility are unchanged. Measured in the live app (module editor open, real input events, i9-13900K, dev build): **52 modules 13.2 → 1.9 ms, 104 modules 25.1 → 1.8 ms, and scaling 52→104 went from 1.9x to 0.95x — cost is now flat in module count.**

     *Originally planned as a local draft copy of the module being edited. That design was rejected at two `opus-reviewer` gates and retired after a `senior-advisor` escalation: moving edits out of `db.modules` created a durability gap that needed four compensating layers (debounced commit, teardown flushes, an awaitable save, a Tauri close hook), and its final revision did not even optimise — committing a `$state` proxy into `db.modules` re-aliases it after the first debounce. The retired plan and its gate records are kept as evidence in [`Reports/10-stage-b-module-draft-copy-plan.md`](Reports/10-stage-b-module-draft-copy-plan.md).*

   **Sequencing note — Stages A and B are complementary, and both are load-bearing.** Stage A removed the whole-array snapshot from the *GUI-side* effect (`stores.svelte.ts:197`); Stage B partitioned the *persistence-side* one (`dbChangeEffects.svelte.ts`). The partition still mutates `db.modules` on every keystroke, so Stage A's narrowed effect still runs and still matters: **the measured 1.9 ms depends on both.** *Correction:* an earlier version of this note said Stage B would largely subsume Stage A's win. That was true only of the retired draft-copy design, which would have stopped mutating `db.modules` altogether; it is not true of the partition that shipped.

   **Frame budget — met on a high-end desktop, not claimed elsewhere.** After both stages a keystroke costs ~1.9 ms at 52 or 104 modules on an i9-13900K (about 11% of the 16.7 ms budget), and it no longer grows with module count. The speedup ratio and the flat scaling are hardware-independent, because they come from doing less work. The absolute figures are not: **Raspberry Pi and mobile are unmeasured and no budget claim is made for them.** Asset-heavy modules (5,000+ asset references) still exceed the budget by themselves *while that module is being edited* — snapshot cost tracks node count, not bytes — though they no longer tax keystrokes in every other module. `dbChangeEffects.svelte.ts` must still never be *narrowed*: `tracker.modules` gates whether the modules block is encoded at all (`risuSave.ts:328`), so a missed mutation is never written to disk.
2. **Narrow the `saveDb()` change-tracking effects** (`globalApi.svelte.ts:350-403`) so they stop `$state.snapshot()`-ing broad subtrees just to detect "something changed." Replace deep-clone-based dirty detection with explicit dirty-marking at actual mutation call sites, or watch only shallow identity/length/timestamp signals. **Note (corrected):** this specific effect already excludes `modules`/`botPresets`/`loadouts`/`plugins`/`pluginCustomStorage` — it's the hot path for *character-field and chat-message* edits specifically, item 1 above is the hot path for module edits. Both need fixing; they're independent, not the same effect. *(Report 01, recommendation 2 — Medium-High effort.)*

   **⚠ Caution added 2026-09-21 — do not implement the "shallow identity/length/timestamp" option above as written.** That is *narrowing*, and Stage B established that narrowing this effect family loses writes: `tracker` flags gate whether a block is encoded at all, so a missed mutation is never written rather than written late (the `:19-24` presets comment in `dbChangeEffects.svelte.ts` records a real data-loss bug from exactly this, `8bc0f426`). The technique that worked for modules is **partitioning** — same dependency closure, sliced across per-element effects — and it is the natural candidate here too. Note this is also the effect containing CHORE-01's non-selected-character gap, so the two should be planned together.

   **Status (2026-09-22) — done for the selected-character effect, not the item as a whole.** The
   selected-character half of this effect family (`dbChangeEffects.svelte.ts`, the effect covering
   `characters[selIdState]` and its `chats`) is now split into a partition, following the caution
   above: a **partition, not a narrowing** — the union of the new effects' dependencies equals the
   old effect's closure, and the save format and the save loop are unchanged. Implemented, gated
   (Gate 3, three rounds) and live-checked as CHORE-01 Stage 2, committed as `fbf799a7`
   (`Reports/17-chore01-item2-plan.md`; ledger rows 72-77).
   - **Measured (Node, i9-13900K, 10k / 50k messages over 10 chats; best case, no claim for a Pi or
     a phone), before → after:** keystroke 74 / 385 → 0.67 / 3.2 ms; streamed token 74 / 385 →
     0.66 / 3.4 ms; chatPage switch 74 / 385 → 0.67 / 3.4 ms (89 / 515 ms before a fix for a
     `for…in`/proxy entanglement found during implementation); message push 74 / 385 → 8.2 / 45 ms.
   - **Live-checked in the browser** (dev server, pane visible; frame times were not usable there
     because the pane throttled `requestAnimationFrame`, so edits were timed with the app's own
     `flushSync`): keystroke 1.1 ms median, 1.3 ms after a chatPage switch — still an i9-13900K, so
     best case, not a Pi/phone claim. The old merged effect's `snapshot(chats)` on the same
     10k-message character took 204 ms in the same page.
   - **Retained heap after mount:** the new effects add about 9 / 43 MB at 10k / 50k messages
     (23.7 / 119 MB total after mount, against about 15.1 / 75.7 MB on the old source).
   - **Open follow-up, not implemented:** the residual per-keystroke/per-token cost scales with
     Svelte's flush traversal walking every live effect (~0.06 µs each). If that proves too costly
     on a Raspberry Pi or a phone, the recorded option is fewer effects per message — chunked
     message children (one per K messages) or active-chat-only children.
   - **Not settled by Stage 2:** the top-level part of this effect family (`characterOrder` and the
     other non-character keys, handled by an unchanged loop) was not repartitioned here, so this
     status covers the selected-character effect only, not every effect this item's heading names.
3. **Status 2026-09-21 — character-list half, in progress:** AV-1 committed `64777a34` (each avatar resolved once per character), AV-2 committed `97c3f53a` (avatars resolved only near the viewport, far ones released; live-checked, ledger 38). AV-3 committed `d6ee89db` (plain HTTP encodes each asset once, under a 64 MiB cache budget; the chat parser no longer pins its own permanent copy; Report 15 rev 2; gates ledger 48/50; red ledger 49; live check ledger 51). AV-4 (list thumbnails, 168 px short side, WebP with PNG fallback, own local store) committed `41977ac0` (Report 16 rev 2; plan gate ledger 54; gates ledger 57/58; red and mutation ledger 56/59; live check ledger 60). Thumbnailed list avatars bypass `getFileSrc`, so the lists no longer use the AV-3 cache for them; animated, small and account-hub avatars still take the full-size path. Chat-list half, started 2026-09-23: measured and planned in Report 19; Stage A (reset the mounted window on a chat switch when no message editor is open) committed `96311c4a`, live-checked. Real windowing (unmounting off-screen messages) still waits on drafts that survive unmounting.

   **Added 2026-09-22 (maintainer): the avatar track did not virtualize the character lists or the
   sidebar.** Every character still mounts. At 1000 characters that measured 2,019 elements for the
   grid, 10,022 for the simple layout and 15,017 for the list (ledger row 17, before AV-2 to AV-4).
   Both of the following are worth investigating, after the chat list:
   - **Character lists: virtual scrolling.** The grid can load very many avatars. The list and
     trash views print each character's full creator notes. Measure the mount and re-render cost
     at 500 and 1000 characters now that the avatar costs are fixed, then decide.
   - **Sidebar: a rework, not just virtual scrolling.** The community already reports its
     drag-and-drop and folders as janky. Virtual scrolling alone is complicated by the sidebar's
     native HTML5 drag-and-drop, which needs the DOM nodes it drags between (Report 12 kept the
     sidebar unkeyed for this reason). Investigate drag-and-drop, folders and windowing together.
     **Reported symptoms (`MC-071`, 2026-09-24):** a changed order sometimes does not persist; long
     tap and drag sometimes do nothing; dragging to the viewport edge does not reliably scroll the
     sidebar; dragging into and out of folders is inconsistent. The first is a possible persistence
     defect and is triaged before the rest. Deferred by the maintainer until the composer stage and
     `updateInlayScreen` are fixed.
   - **The custom sidebar's settings picker ignores platform conditions** (ledger row 428; deferred
     by the maintainer to a sidebar rework). `CustomSidebarConfig.svelte` and `CustomSidebar.svelte`
     list settings through `getFullSettingsData` (`src/ts/setting/utils.ts`), which does not apply an
     item's `condition`. So an item can be added on a platform its condition excludes and renders
     as an empty slot: Fullscreen outside Tauri, or the `!isNodeServer && !isTauri` item in
     `advancedSettingsData.ts` on Node and Tauri. No crash.
   - Related bug: CHORE-18 (creator notes overflow in the list view).
   **Add real virtual scrolling to the chat message list** (`DefaultChatScreen.svelte`), keeping the existing incremental-load-on-scroll-up behavior for fetching history but unmounting off-screen messages so peak DOM/component count is bounded. This is the most Android-relevant fix in the whole roadmap. *(Report 01, recommendation 4 — Medium-High effort.)*

   **Premise re-measured 2026-09-21 (ledger row 13) — corrected and widened. Scope now includes the character lists at the maintainer's request.**
   - **The chat list is already windowed, but the window only ever grows.** `Chats.svelte` mounts and unmounts messages imperatively with `mount()`/`unmount()` (not an `{#each}`), capped at `loadPages`: 30 initially, +15 per scroll-up (`chatLoadPages.ts`). The cap never shrinks on scroll, and a screenshot sets it to `Infinity` (`DefaultChatScreen.svelte:469`). The mounted count is therefore bounded by scroll-back depth, not by chat length. "Unbounded, append-only" above overstates it.
   - **Character lists are fully unbounded — all three layouts, not only the grid.** Grid, list/trash (`GridCatalog.svelte:93,111,134`) and simple (`MobileCharacters.svelte:74`) mount every matching character. Each resolves avatars inline with `getCharImage(...,'css')`, so every re-render (e.g. a search keystroke) re-resolves every avatar. The sidebar (`Sidebar.svelte:563`) is unkeyed and fully mounted, and its `<img>` has no `loading="lazy"`. Real profiles: maintainer 500+ characters, extreme users 1000+.
   - **Worst avatar path: plain-HTTP web (no service worker, no account — LAN/Pi).** `getFileSrc` re-encodes the full file to a base64 `data:` string on every call, even on a cache hit (`globalApi.svelte.ts:285`), and `fileSrcCache` holds those full strings unbounded. Tauri returns short `asset://` URLs.
   - **Avatar lookups measured on 2026-09-21 (ledger row 17).** Harness `Agents/Tools/save-gen/charlist-avatar-count.svelte.harness.ts` mounts the real `GridCatalog` / `MobileCharacters` / `BarIcon` and the real `getCharImage`, with `getFileSrc` replaced by a counting spy.
     - **Opening any layout** does one lookup per listed character: at 1000 characters, 1000 lookups. DOM elements mounted: grid 2,019, simple 10,022, list 15,017.
     - **Grid and list** re-look-up every visible avatar on each search keystroke: 1000 for a keystroke that still matches everyone, 100 for one narrowing to 10%. They also re-look-up all of them when any visible character's `name` or `image` changes.
     - **Simple layout** does **0** lookups on a search keystroke, because it filters with an `{#if}` inside the loop (`MobileCharacters.svelte:74-75`). It still re-looks-up every avatar when any character's name, image, `lastInteraction` or chat count changes, since `sortChar` reads them.
     - **Chat messages:** pushing a message caused 0 lookups in every layout.
   - **Cost of one lookup on the plain-HTTP branch** (`globalApi.svelte.ts:285`, i9-13900K best case): about 8.75 ms of CPU and a 1.33 MB base64 string per MB of avatar — exactly 4/3 (100 KB: 0.8 ms; 3 MB: 26 ms).
     - Maintainer: most avatars are PNGs **under ~10 MB**; 10 MB is the upper bound.
     - Derived by arithmetic, not measured: opening the grid at 1000 characters with 1 MB avatars means ~1000 encodes, **~8.8 s of CPU and ~1.4 GB of strings** on this CPU. It scales linearly with avatar size, and a grid search keystroke repeats it.
     - Tauri (`asset://`) and service-worker builds skip the encode. On those builds the full-size image fetch and decode per 56 px icon is **unmeasured**.
   - **Virtualization hazards — each must be dispositioned in the plan:**
     - Plugin API v3 `getRootDocument()` wraps the real `document.documentElement` (`v3.svelte.ts:360-364`), a documented way to query live chat DOM. This is a compatibility risk.
     - `scrollToMessage` depends on `data-chat-index` and on raising `loadPages`.
     - The reroll-arrow CSS `.chat-message-container:first-of-type` (`styles.css:513`) assumes the newest message is the first DOM child.
     - The list uses nested `flex-col-reverse` containers, and auto-scroll depends on the newest message being `firstElementChild`.
     - The sidebar calls `scrollIntoView` by `data-char-id`.
     - There is no shared parse cache, so every remount re-runs `ParseMarkdown`, including character display scripts.
4. **Extend cold storage to size-based (not just idle-time-based) compaction**, so very long *active* chats also get relief, reducing the size of whatever remains to be cloned/stringified by items 1-2. **Note (corrected):** cold storage already offloads old, stale chats belonging to an active character today (until step 5 of memory stage 1 retires that path) — this item specifically targets the gap that remains: a chat that's long but still *recent* (not idle 10+ days), which today gets no relief regardless of size. *(Report 01, recommendation 5 — Low-Medium effort.)*

   **Status note (2026-09-30) — still open; stage 1 of the memory-footprint work does not cover it.** Stage 1 archives whole characters at boot (see item 8) and retires the 10-day idle paths, both the chat path and the character path in `makeColdData` (Report 49 D21, plan section 3.3). Until step 5 lands, the 10-day path still archives profiles that have the flag on (Report 49 section 3.4). Per-chat archiving inside a loaded character, which is the long-but-recent chat this item targets, is out of stage 1's scope (Report 49 section 3.7). `MC-136` 1 puts it later, after the long-chat display work, and says the about-16 KB threshold of `MC-134` 4 applies to that later step. The maintainer's position (`MC-135` 3, `stated`): "long chats that goes up to size of megabytes are common among the community. so archiving chats should still be considered, not taken off the table entirely." This file records no design or schedule for it.
5. **(Architectural, largest item — stage last, after 1-4 prove the pattern) Split `DBState.db.characters` into per-character reactive slices** so only the active character is a "hot" proxy and editing one character cannot force reactivity traversal touching others. Large surface area — every read/write site of `DBState.db.characters[i]` across `src/ts` and `src/lib` — should be scoped deliberately and probably split into its own sub-project once items 1-4 are proven. *(Report 01, recommendation 3 — High effort.)*
6. **[from round 2] Apply the same "give it a real draft copy" fix to the LoreBook entry editor and the Regex/Script editor**, which round 2 confirmed have the same live-`DBState`-binding pattern as the Module editor (item 1 above). Whether they carry the same *clone-cost* severity as the Module editor wasn't established — round 2 found direct binding is actually widespread (Persona/CharConfig too) — so profile each before assuming it needs the same fix; fix the ones that demonstrably clone something expensive on every keystroke. *(Report 01-deepdive, Lead 1 — Medium effort, sequence after item 1 proves the pattern.)*
7. **[from round 2] Add real virtual scrolling (or at minimum a cap) to the other uncapped `{#each}` lists found**: LoreBook/WorldInfo entries, scripts, triggers, characters, personas, modules. Round 2 found these lack any windowing but could not establish real-world cardinality/impact — treat as lower priority than the chat list (item 3) unless a specific list is reported as a problem in practice. *(Report 01-deepdive, Lead 3 — Low-Medium effort, investigate-before-implementing.)* **Update 2026-09-21:** the *characters* list is now reported as a problem in practice (500+/1000+ characters) and has been folded into item 3.
8. **[added 2026-09-21, ledger row 14] Resident chat data for characters that are not open.** This is a separate item from item 3: item 3 is about the DOM, this item is about the JS heap.
   - **Residency is confirmed.** Every non-cold character and every one of its chats is decoded eagerly at boot and stays resident for the session (`risuSave.ts:695-700` into `DBState.db`). Only cold-storage stubs are lazy.
   - **Why it gets expensive.** Svelte 5 proxies lazily, but boot's `saveDb()` runs `encoder.init(getDatabase())` (`globalApi.svelte.ts:587`). That calls `JSON.stringify(character)` through the proxy for every character (`risuSave.ts:250-253`), which forces full proxy materialisation.
   - **Measured in Node** (`svelte@5.55.1`, production conditions, seed-1337 generator; i9-13900K; pointer compression **off**, so the multipliers are upper bounds):
     - Chats are 97-99% of the plain heap when characters carry no large fields.
     - Proxy overhead is ~1.9-2.4 KB per message, independent of text length.
     - 1000 characters × 150 messages each: 100.8 MB plain, plus 277.6 MB of proxy overhead.
     - Multiplier ≈ 3.7x for ASCII and 2.4x for Hangul. Per-message cost is the portable figure.
   - **Re-measured in real Chromium on 2026-09-21 (ledger row 16):** headless Chrome 154, `--expose-gc`, production-conditioned Svelte 5.55.1 bundle, pointer compression on. 3 fresh-isolate repeats were bit-identical, and the CDP `Runtime.getHeapUsage` cross-check agreed within 1.3%. Pointer compression roughly halves the proxy overhead:

     | Profile | Plain | Proxy overhead | Multiplier | Proxy bytes per message | Chat share of plain |
     |---|---|---|---|---|---|
     | 1000 characters, 150k messages | 95.5 MB | +140.0 MB | 2.47x | 979 | 98.8% |
     | 500 characters, 75k messages, Hangul | 91.9 MB | +70.1 MB | 1.76x | 979 | 99.3% |

     **These Chromium figures supersede the Node multipliers above for any user-facing claim.** Proxy overhead is structural, about 1 KB per message whatever the text length, so real roleplay messages (longer than the fixture's ~730 B) have a lower multiplier but the same absolute overhead. All data is resident for the session.
   - **What the measurement narrowed.** Asset and inlay bytes are **not** in chat data or in the database: inlays are in the separate `inlay` store, and assets are stored as paths. CSS and HTML weight sits on characters and modules, not chats. With a 200 KB background per character, chats fall to 34% of the heap.
   - **Related Tauri-slowdown candidates, measured or verified.**
     - `dbChangeEffects.svelte.ts:109` snapshots all of the **active** character's chats on every tracked change, including every streaming chunk, since `streamingDisplayOptimizationMode` defaults to `'off'`. That costs ~5.3 µs/message (10k messages ≈ 53 ms). This belongs to item 2 and must be **partitioned**, never narrowed. **Resolved by item 2 / CHORE-01 Stage 2 (`fbf799a7`).**
     - V2 `pluginStorage.getItem` deep-clones the whole database on every call (`plugins.svelte.ts:717`).
     - V3 `getDatabase()` defaults to snapshotting every character.
     - How often these plugin paths fire is unmeasured.
   - **2026-09-22 (CHORE-01 measurement; Node, pointer compression off, so upper bounds):** at
     1000 characters / ~148k messages the boot `encoder.init` walk alone retains 524 MB against
     117 MB plain; today's app (walk plus the selected-character effect) retains 537 MB. Reading
     raw data instead of the proxy in that walk is the main lever for this item, and it only pays
     off if nothing else permanently deep-reads every character. That is one reason CHORE-01
     chose selection-scoped partitioning plus explicit marks (option B) over watching every
     character (option A: about +170 MB, and it would lock the materialisation in). Raw data:
     `Agents/Tools/output/chore01-item2-measure.md` (gitignored); harnesses
     `Agents/Tools/save-gen/dbchange-*.svelte.harness.ts`.
   - **Cold storage covers little of this.** It is on by default only for installs that had no plugins at first load (`database.svelte.ts:713`), runs once per boot after the full decode (`bootstrap.ts:284`), and evicts only data idle for 10+ days. It does nothing for peak memory at boot.
   - **Relationship to other items.** Items 4 (size-based compaction) and 5 (per-character slices) are candidate mechanisms. This item states the measured problem; plan it after a live-app heap measurement confirms the proxy multiplier with pointer compression on. **Android caveat:** no Android build exists in the repo (`src-tauri/gen` has no `android/`, `[lib]` is commented out at `Cargo.toml:47`), so the OOM premise cannot be observed from this codebase.
   - **Status 2026-09-30 — in progress.** The memory-footprint work (`MC-119`, `MC-130`, Report 49) addresses the problem this item measures, at the character grain. This placement follows the maintainer's 2026-09-30 observation that the campaign is running Phase 2, and `MC-035`'s description (quoting Report 17) of the boot proxy materialisation as "Phase 2 item 8's main lever"; no decision entry names item 8. Decisions: `MC-119` (the work comes after W2e) and `MC-130` to `MC-145` (some amended by later entries). The accepted stage 1 plan and its gate record are in [`Reports/49-memory-stage-1-plan.md`](Reports/49-memory-stage-1-plan.md) (Gate 1 accepted at round 5 as [EDITORIAL]; the editorial corrections were applied by the Orchestrator and are not yet re-verified).
     - **Stage 1 (Report 49 section 1):** each eligible character that is not open (not trashed, not `§`/Playground, not when a V2/V2.1 plugin is enabled, not when the opt-out is off) is archived by a boot pass that runs on the raw save tree under exclusive access, from before the main file is read until the pass's own commit resolves. A character stays loaded once opened. When the characters opened since the last load add up past a threshold and the user is idle and nothing is in progress, the app saves and reloads itself, and the re-run boot pass releases them (`MC-140`, `MC-141`). There is **no runtime archive engine**. The 10-day archiving paths are to be retired in step 5 (see the note under item 4).
     - **Steps 1-7 are listed in Report 49 section 3.4.** Steps 1-6 each get their own implementation and Gate 2; step 7 (measurement, D20) has no Gate 2. As of 2026-10-01, step 1 (the exclusive manual clean-up, D11 and D12) is committed as `2b3dd636` ([`Reports/50-memory-stage-1-step-1-clean-up.md`](Reports/50-memory-stage-1-step-1-clean-up.md); Gate 2 approved at round 3), and step 2 (the v2 stub and the shared restore, D6, D7 and D9 restore side) as `db49aeeb` ([`Reports/51-memory-stage-1-step-2-stub-and-restore.md`](Reports/51-memory-stage-1-step-2-stub-and-restore.md); Gate 2: round 1 [REJECT], round 2 [APPROVE], round 3 [EDITORIAL]), step 3a (plugins and MCP) as `bd57aa19` ([`Reports/52-memory-stage-1-step-3a-plugins-and-mcp.md`](Reports/52-memory-stage-1-step-3a-plugins-and-mcp.md)), step 3b (groups, the Playground and exports) as `1b38b5d5` ([`Reports/53-memory-stage-1-step-3b-groups-playground-exports.md`](Reports/53-memory-stage-1-step-3b-groups-playground-exports.md)), and step 4 (the backup, D13) as `a6719e35` ([`Reports/55-memory-stage-1-step-4-backup-closure.md`](Reports/55-memory-stage-1-step-4-backup-closure.md)); Report 49's STATUS line records them. Step 5 is done (see the Live-State work order). **Steps 6 and 7 are done (2026-10-04):** step 6a is `cd26764d` (the busy registry, the save-clean signal and the restored-bytes counter) and step 6b is `cdf700f3` (the idle reload; web on, desktop off, CHORE-86); step 7 is Part A (the D20 measurements at `c9c57c9e`), the AVD retry at `cd26764d`, and Part B in the 6b live check (ledger rows 1018 to 1030; `MC-193`). Report 49's STATUS line still says steps 5-7 are not started, so it is stale for step 5 as well as steps 6 and 7.
     - **Projections, not measurements:** Report 49 estimates the maintainer's 155.8 MB main file at about 41-46 MB after stage 1 and the heap after boot at about 70-76 MB (against 258.6 MB of parsed heap today, raw parsed objects in Node, a lower bound). The measurement that replaces the estimates is D20 (step 7). The app measurements so far ran on an i9-13900K and say nothing about a Pi or a phone.
     - **D20 measured (2026-10-04; step 7, ledger rows 1023, 1024 and 1027; an i9 and a 2 GB emulator, not a phone).** Report 49 section 1's projection is replaced by these measurements for characters only. The main file after the boot pass is 43.2 MB (the projection held). The heap after boot is 344 MB against the 70-76 MB projection (modules about 305 MB of it; 39 MB with modules emptied). On the 2 GB emulator (Chrome 109, V8 limit about 503.6 MiB), in-tab reloads of the full profile hit the V8 heap limit in 6 of 7 reloads in a live renderer and in 0 of 5 first loads in a fresh renderer; with modules emptied, 0 of 6. The retry attributes the heap to the module tree. 6b's own idle reload was run on the emulator only with the modules-emptied profile (no crash).
     - **Already committed: `ccf45c53`, "switching chats no longer keeps the previous chat's messages in memory"** (Report 49 section 6). After a chat switch about 28 of 46.6 MB stayed until another character was selected; with the fix the heap is +0.9 MB above baseline against +28.0 MB without it (one machine, i9-13900K, headless Chrome, synthetic data). Not fixed: a switch to a cold-storage pointer chat whose unit is missing still keeps the array (Report 49 section 5, item 1).
     - **Not in stage 1 (Report 49 section 3.7):** per-chat archiving inside a loaded character (item 4), modules, streamed or inline backup, and the Node streamed write (CHORE-46), and the other exclusions in section 3.7 (the long-chat display window, unit reuse, inlays in backups CHORE-48, the missing-unit retainer, the Android D1 review).
     - **Order after stage 1 (`MC-145`, amended by `MC-193` 5, 2026-10-04):** archiving of modules that are not enabled first (the maintainer's "Modules first (Recommended)"), then the upstream-compatible "inline everything" backup, then the rest of stage 2. `MC-145` had the backup first. **Update 2026-10-04 (`MC-194` 5): module archiving is shelved**, so this order has no scheduled first step; the inline backup and the rest of stage 2 are not re-ordered (see the bullets below).
     - **Open after stage 1 (updated 2026-10-04):** CHORE-86 (the desktop idle reload ships off) and CHORE-83 to CHORE-85 (found in steps 6 and 7). CHORE-81 and CHORE-82 are closed (`04484500`, `148924b0`). Also open: the gated in-session unload, and the "Release at ~80%" change (both below).
     - **In-session unloading of archived characters (2026-10-04; ledger row 1031; `MC-194` 1).** The investigation that `MC-193` 10 asked for found that `MC-140` rejected a runtime unload for safety (a writer holding a character across a wait), not because in-place release does not free memory. In a scratch build on one i9 (best-case hardware), replacing 99 opened characters with stubs in place took the heap from 584.0 to 360.1 MB, and the main file after 100 characters was 118.5 MB without unloading and 41.7 MB with it. Modules do not shrink with it. UNCERTAIN and the real constraint: whether every awaiting writer to a non-selected character is registered as busy (not audited). Maintainer: "Yes, after module archiving (Recommended)". The order in that option: module archiving, then a writer audit, then a byte-budget least-recently-used unload, with the idle reload kept as a backstop. `MC-140`'s two rejected alternatives are reopened for a bounded, gated unload. Not designed, planned or gated. Module archiving is shelved (below), so this order has no scheduled start; whether the unload moves up is the maintainer's to place.
     - **The Node 100 MiB request limit: CHORE-87 is closed (`517f0cdb`); "Release at ~80%" is not built (ledger rows 1040 to 1047; `MC-194` 2).** The maintainer chose "Size guard now (Recommended)", "Release at ~80% (Recommended)" and "Size guard first (Recommended)". The release at about 80% would release archived characters before a session's main file reaches the limit; it comes later as its own change. Remote Saving is not made the default.
     - **Module archiving: shelved (2026-10-04; ledger rows 1033, 1038, 1041, 1048; `MC-194` 5).** The maintainer answered the design questions (Q-A to Q-D, all the recommended options), the plan failed Gate 1 three rounds running (`[REJECT]` each time), and `senior-advisor` (AGENTS 1.2) found that most of the module heap is Svelte's wrapping of the asset lists, which a smaller change removes. The maintainer chose "Stage A now, decide archiving later (Recommended)". The plan's third revision and the three rejections stay as the record (session scratchpad `moduleArchive/`). The `MC-193` 5 order (modules first, then the upstream-compatible inline backup, then the rest of stage 2) therefore has no scheduled first step; this entry does not re-order the inline backup or the rest of stage 2.
     - **Save-layer track (2026-10-04; ledger rows 1049 to 1067; `MC-194` 6, 10, 11, 12).** The maintainer asked whether transaction-style saving should move up and had the PocketRisu projects studied (their gains are server-only). Platform answer: "Tauri and Node. data in the browser is the one that is least utilized."; SQLite: "Yes, on Node". Direction adopted: "Adopt it, Stage 0 first (Recommended)", which is the `senior-advisor`'s: a stable-keyed block store, the root written last, a whole-file snapshot only on the 5-minute backup cadence, through the existing byte-store contract on all three adapters, per-key `ifVersion` on Node, `risuSaveCache` retired; not content addressing, a journal, SQLite blobs in stage 1, or Remote Saving as the default. Every measurement here is from an i9 (best-case hardware), not a phone or a Pi.
       - **Stage A, done: `b1d2804b`.** Each module's `assets` is held as an `AssetList` (an Array subclass) once the database is installed, so Svelte 5.56.8 does not wrap the list and its tuples; writes replace the whole list. Later-boot heap 344.2 to 110.9 MiB and the `saveDb` init peak 750.0 to 313.1 MiB (n=9). Memory only: the modules block is byte-identical and the `.bin` round trip is unaffected (`MC-175`). Nothing is wrapped while an enabled V2.1 plugin is present. The first-boot pass (the 163 MB decode) is not helped, and modules added after the install stay plain arrays until the next install. Gates: Gate 1 `[REJECT]` then `[EDITORIAL]`; Gate 2 `[EDITORIAL]` twice (rows 1052, 1056 to 1058).
       - **Stage 0 (ii), done: `2aa55398`.** On the Node server, revision bumps are appended to `save/__revisions.log` instead of rewriting the whole revision map per write; the map is written as a snapshot only at compaction (at startup and every 20000 records). At 350,350 keys the p50 per request fell from 192.6 to 15.5 ms and 8 writers of 25 writes each from 38.9 s to 0.22 s. A server that cannot read an existing log refuses to start. Moving a data directory back to a build from before this change is unsupported (`MC-011`). Power-loss behaviour is not claimed (process crash only). Gates: Gate 1 `[REJECT]` then `[EDITORIAL]`; Gate 2 `[REJECT]`, `[APPROVE]`, `[EDITORIAL]` (rows 1054, 1055, 1059 to 1061).
       - **Stage 0 (i)+(iii), done: `f04068f1`.** The save loop skips a main-file write when the bytes are provably equal to what storage holds, and a skipped save still keeps a numbered backup fresh: a fork-only record (`database/backupfingerprint`, never in a `.bin`) names the newest backup's bytes, so a boot that skips takes a backup only when the record does not name the main file (`MC-194` 12). A new module, `mainFileOutcome.ts`, reports every main-file write attempt (a scope amendment under `MC-091`). Residuals are listed in the commit message; among them, a no-op save from a stale Node device no longer gets an early 409, and pruning or clock skew can remove the recorded backup. The cost of the record write on weak hardware is not measured. It partly addresses CHORE-83 (below). Gates: Gate 1 `[REJECT]`, `[REJECT]`, `[EDITORIAL]`; Gate 2 `[REJECT]`, `[EDITORIAL]`, `[EDITORIAL]` (rows 1063 to 1067).
       - **CHORE-121, done: `71100280`** (2026-10-05; local, not pushed; its own entry below; ledger rows 1076 to 1078). Concurrent Node store requests no longer share Chrome's same-URL cache lock, the proxy responses carry `Cache-Control: no-store`, and the four storage routes have their own 20000-per-minute limit. It was fixed alongside Stage 1 at the maintainer's word (`MC-195` 1).
       - **Stage 1: the plan is accepted (2026-10-05; Report 57; ledger rows 1073 to 1086; `MC-195`). Nothing is implemented yet.** Stage 1 is the stable-keyed block store, by the advisor's staging (`MC-194` 11); the maintainer approved forcing a Tauri directory write to disk, "Yes, in Stage 1", which needs a Rust command, and a partial commit across two Node devices, "Acceptable (Recommended)".
         - **Pre-measurement, done (row 1073).** The boot read cost with N keys was measured on an i9-13900KF and an x86_64 Android emulator on the same host (best-case hardware, `MC-003`, `MC-010`; not a phone or a Pi). Reading one key per entity (506 keys) passes desktop IndexedDB (55 ms against a 156 ms decode), fails the emulator marginally (398 to 448 ms against 327; low to moderate confidence) and fails Node at loopback (592 to 634 ms against 156). Packing the archived stubs into one value passes on every platform measured. So the plan packs archived characters into one `stubs` value and gives each loaded character one key (the Orchestrator's reading of "start stage 1 plan now", `MC-195` 1; the maintainer's answer does not name the packing). The Tauri figure is a Node `fs` stand-in, not a Tauri build, and is not established.
         - **Gate 1 closed at round 5 `[EDITORIAL]`, after rounds 1 to 4 `[REJECT]` and a `senior-advisor` escalation after round 3** (rows 1079 to 1086). The advisor's root cause was that the head record conflated a pointer with a work queue and a liveness list, written by six actors. The accepted design makes the head a pointer written only by a whole-state replace's compare-and-swap. Two more measurements fed it: an IndexedDB compare-and-swap across tabs on a non-secure origin (Chrome 154, Edge 154 and Firefox 157; Safari and Android Chrome not run; row 1083) and a fingerprint of the main-file bytes a conversion read (row 1084).
         - **The accepted plan is Report 57** (`Reports/57-save-layer-stage1-plan.md`; revision 5 of the working plan). Maintainer choices that shape it are in `MC-195` 3 to 6: a damaged save at startup gives "Backup or stop", the old main file is renamed after conversion, a Node snapshot over the body limit is skipped with a notice, and a damaged save that was kept can be deleted from manual clean-up after a dated confirmation.
         - **Implementation stages:** 1a the durable Tauri write (a Rust command); 1b the core with no callers; 1c everything wired, as one stage. Per `MC-195` 8, 1a and 1b run in parallel after the records batch. Each stage gets its own Gate 2, with `opus-reviewer`.
       - **Stage 2: per-module blocks.**
     - **Merges into this branch (2026-10-04):** `feat/ui-batch` batch 5e as `3472e63a` (ledger row 1039); `feat/side-batch` at `aeedbe4d` as `32fa1184` (row 1062) and at `0023f16f` as `ddd47655` (row 1068), which brought in CHORE-80, CHORE-81 and CHORE-88 (their status lines are in their own entries). Nothing is pushed.

9. **[added 2026-09-22, CHORE-17 measurement] Per-chat save blocks: every save re-encodes the whole selected character.**
   - Each character, with all of its chats, is one save block (`RisuSaveType.CHARACTER_WITH_CHAT` in `risuSave.ts`), and the selected character is re-encoded on every save it's marked for — it's the tracker's sticky front. So during an ordinary chat, each save re-encodes every chat that character has, not only the one that changed.
   - **Evidence:** CHORE-01 Stage 2 live check (ledger row 77) — with a 10k-message character, without `flushSync` the save loop's re-encode of that character dominated at 280/470 ms. CHORE-17 measurement — a single large character's re-encode is one uninterrupted 16-44 ms slice (i9, best case). This matters more day to day than plugin saves.
   - The encoder already carries an unused per-chat hook: `toSave.chat` is dead plumbing (CHORE-02).
   - A per-chat block split is a **save-format change**: it needs the maintainer's explicit approval plus the impact/migration/fallback analysis the compatibility invariant requires (upstream builds, backup `.bin` files and legacy saves must all keep loading). Not started; measure and plan before anything else.
   - **Relationship:** item 8 (resident chat data) and CHORE-02.

**Exit criterion for this phase** (relevant to Phase 4/Android gating): a long chat session with a large module set no longer shows the reported keystroke stutter, and peak memory for an active long conversation is bounded rather than growing monotonically with scroll-back depth.

---

## Phase 3 — ARM desktop platform expansion (independent of Phase 2; can run in parallel with Phase 1/2)

Desktop ARM targets are **not** gated behind the RAM work — they're a CI/packaging problem, not a low-RAM-device problem. Can be scheduled independently.

1. **✅ DONE. ARM Linux (`aarch64-unknown-linux-gnu`)**: added to the release build matrix (`.github/workflows/github-actions-builder.yml`) via a native `ubuntu-24.04-arm` GitHub-hosted runner (free for public repos), not QEMU/buildx cross-compilation — Tauri's own guidance favors a native runner for a Rust+WebKit build like this, since cross-compiling under emulation is slower and more prone to native-dependency build failures than the Docker server image's simpler buildx case. No `Cargo.toml`/`tauri.conf.json` changes were needed, matching the original estimate. One real fix beyond the matrix entry itself: the existing "install dependencies (ubuntu only)" step's condition (`matrix.settings.platform == 'ubuntu-latest'`) would have silently skipped installing `libwebkit2gtk-4.1-dev`/`libappindicator3-dev`/`librsvg2-dev`/`patchelf` on the new `ubuntu-24.04-arm` runner, since that's a different platform string — changed to `startsWith(matrix.settings.platform, 'ubuntu')` so both Ubuntu runners get the same system dependencies. Not yet verified by an actual CI run (this only triggers on push to `production` or manual dispatch) — first real run should be watched for `install_python`'s known amd64-only gating (Phase 0, already fixed) and for any ARM-specific native-dependency surprises the YAML change alone can't catch. *(Report 04 — Medium-low effort, confirmed accurate.)*
2. **✅ RESOLVED — decided against.** Windows on ARM (`aarch64-pc-windows-msvc`). Native local inference is now explicitly DISABLED on ARM64 Windows hosts, and no native ARM64 Windows release target is being added. The earlier framing of this item rested on a factual error, corrected here so it is not repeated.
   - **The correction.** The previous "Done" note claimed that making `install_python()` read `std::env::consts::ARCH` prevented an ARM64 build from "silently running the amd64 interpreter under Windows' x64 emulation layer." That scenario cannot occur. `std::env::consts::ARCH` is a **compile-time** constant describing the build *target*, not the host CPU. The only Windows binary this project ships is `x86_64-pc-windows-msvc`, so it reports `"x86_64"` on every machine — including ARM64 hardware under emulation, where downloading the amd64 interpreter is the *correct* behaviour for that process. The `arch == "aarch64"` branch was dead code in every artifact ever produced, and has been removed.
   - **Why disabled rather than shipped.** The spike did establish that `llama.cpp` builds on an ARM64 CI runner — but only after activating the ARM64 Native Tools environment and passing explicit Clang `CMAKE_ARGS`. That answers a CI question, not a product one. A real end user's Windows-on-ARM machine has no Visual Studio or Clang, so the first-run `pip install llama-cpp-python` source build can never succeed there. Shipping a native ARM64 build would not change that; it would relocate the same failure. This is exactly the product-level question the spike's own comments flagged as uninvestigated, and the answer is that the feature is not deliverable to end users on this platform.
   - **What shipped instead.** Runtime host detection via `IsWow64Process2` (`host_is_arm64()` in `src-tauri/src/main.rs`), reading `pNativeMachine` only, which reports the true host architecture regardless of whether the calling process is emulated. A new `local_inference_unsupported_reason()` command lets the frontend refuse before any download begins — including for users who already have a `completed.txt` from a prior install, since that file short-circuits the entire install block. `windows-sys` is pinned to a version already in `Cargo.lock` and scoped to `cfg(windows)`, with a `cfg(not(windows))` arm so macOS and Linux still compile. Known limitation: `windows-link` binds the import via `raw-dylib`, which resolves at load time, so on Windows older than 10.0.10586 the process would fail to start rather than falling back — Tauri v2's floor is Windows 10 1803+, so nothing in the supported matrix is affected.
   - **Spike retired.** `.github/workflows/spike-windows-arm64-llama.yml` has been deleted; its question is moot under this decision. Its findings are preserved in this entry and in git history.
   - **CI matrix unchanged, and was never the problem.** `.github/workflows/github-actions-builder.yml` has no ARM64 Windows entry and never had one, and it installs no Python or pip packages at any point. The pyyaml/uvicorn MSVC bottleneck was never a CI issue — it lives entirely in the end-user first-run path, which is what the gate above short-circuits.
   - **Unplanned but related work.** Investigating this uncovered that every success signal in the bundled-Python install pipeline was fake, and fixing that took four commits ahead of the ARM work itself: `install_pip` judged success by matching `get-pip.py`'s stdout against `"Python "` (a copy-paste of `install_python`'s `python --version` check), so it returned `false` on every *successful* run; `post_py_install` wrote the `completed.txt` gate unconditionally, so a single failed run silently bricked local inference forever, recoverable only by deleting the file by hand; `install_py_dependencies` inspected only stdout and returned `Ok(())` regardless of exit status, so a failed `llama-cpp-python` build was reported as success; and panics inside `async` Tauri commands left their JS promises permanently unsettled (tauri discards the spawned task's `JoinHandle` and installs no `catch_unwind`), so a first run with no network hung the UI forever with no error. All are fixed on this branch, with test coverage. One consequence worth recording: the ARM failure is now visible and accurate *even without* the gate — the gate's remaining value is refusing before a doomed multi-minute build rather than after it.

---

## Phase 4 — Android (explicitly gated behind Phase 2)

**Do not begin implementation work in this phase until Phase 2's exit criterion is met.** Cross-compiling the current architecture to Android as-is causes OOM crashes on low-RAM devices — this is a hard prerequisite, not a preference.

Once Phase 2 has landed:

1. Run `tauri android init` — expected (per Tauri's documented tooling behavior, not yet independently verifiable from this repo since `gen/android` doesn't exist) to automatically pick up the already-staged icons at `src-tauri/icons/android/mipmap-*/` (15 files; Phase 0's cleanup already removed the confusing orphaned Capacitor set, so there's no ambiguity left by this point) — verify this actually happens as the first concrete step of this phase, rather than assuming it.
2. Write the `lib.rs` this project doesn't yet have, and reconcile it with the current (substantial) `main.rs` and the commented-out `[lib]` section in `Cargo.toml` (`name = "alib"`). **Note (corrected):** `mainx.txt` is confirmed to match Tauri's mobile-template shape and was introduced alongside that `[lib]` block in the Tauri V2 migration commit, but it is not a "mostly-ready" scaffold — there is no `lib.rs` today, so this is closer to new work than to finishing an existing attempt.
3. Decide a replacement/removal strategy for the plugins currently `cfg`'d out or excluded on Android: `tauri-plugin-single-instance`, `tauri-plugin-updater` (both excluded), `tauri-plugin-deep-link` (needs Android's App Links wiring — Tauri 2 supports this, just not enabled here yet, and it's load-bearing for the existing OAuth login flow).
4. Author an Android/mobile `capabilities/*.json` file (none exists today — `desktop.json` explicitly lists only `["macOS", "windows", "linux"]`).
5. Make an explicit product decision to **disable, not silently break**, the `src-python`/llama.cpp local-inference feature on Android — there is no realistic path to on-device GGUF inference without a substantial from-source NDK cross-compile of `llama-cpp-python`, which is out of scope unless separately justified.
6. Leverage existing `src/lib/Mobile/` components and the storage layer's existing "Mobile" adapter concept as a starting point for the Android UI/storage story — noted as promising but unverified for Tauri-Android-readiness as-is; needs its own validation pass once this phase actually starts.
7. **[from round 2] Introduce an `isDesktop` (`isTauri && !isMobile`) flag in `src/ts/platform.ts`** and switch the four confirmed `isTauri`-conflated-with-desktop call sites to it: window maximize/fullscreen and the update-checker in `bootstrap.ts`'s startup path, and MCP's stdio transport (arbitrary local-process spawning, fundamentally incompatible with Android's sandbox regardless of gating). Cheap to do now, ahead of when it would otherwise block Android bring-up — could reasonably be pulled forward into Phase 0.5 rather than waiting for this phase, since it doesn't depend on Phase 2. *(Report 04-deepdive, Lead 3 — Low-Medium effort.)* The one-line `#[cfg(desktop)]` compile-blocker fix for the same two plugins at the Rust level is already in Phase 0.5, not repeated here.

---

## Chores — confirmed bugs found during Stage B, NOT yet scheduled

Found while scoping the module-editor partition (2026-09-21). All three were **verified against
source**, none is fixed, and none was absorbed into Stage B. Recorded here so they are not lost.
Evidence and full reasoning: `Agents/Reports/11-stage-b-module-effect-partition-plan.md` section 8.1.

**Ownership note (2026-10-03, `MC-179` 1):** the tickets listed in `MC-179` 1 are delegated to the UI session on
`feat/ui-batch`. CHORE-68 and CHORE-74 move only after CHORE-55 stage 3 is committed and merged into that branch. The
rule applies from `MC-179` on: the UI session owns the status lines of the delegated tickets, and this file's entries for
them are not edited by the Main Campaign. CHORE-74's entry carries the `MC-177` status edit, made in the same uncommitted
batch before the delegation; CHORE-74 moves only after stage 3 is merged.

### CHORE-01 — Mutations to a NON-selected character are never marked for save

**Status (2026-09-22):** Stage 1 implemented and gated; live check passed; committed as `152cc563`.
Stage 2 (partition of the selected-character tracker, Phase 2 item 2) is implemented, gated (Gate 3,
three rounds), live-checked and committed as `fbf799a7`. Both stages of the plan are now complete
(`Reports/17-chore01-item2-plan.md` §9's staging list), so nothing in this plan is outstanding. See
`Reports/17-chore01-item2-plan.md` §10 (Gate 2), "Stage 2 implementation notes (Gate 3)", and ledger rows 64-69, 72-77.

**Real plugin exposure (2026-09-21).** Two community plugins, provided by the maintainer
(`Agents/Evidences of Investigations/`, gitignored, never commit), write the database through the
plugin API:
- **AssetGod v3_alt:** `risuai.setDatabase` ×7.
- **fast-character-import v3 2.0.0:** `setDatabaseLite` and `setCharacterToIndex`.

If they edit non-selected characters, CHORE-01 could lose plugin-made edits. The CHORE-01 plan
must test the plugin API write paths, not only the UI.

**Confirmed bug — EMPIRICALLY REPRODUCED, not just source-traced.** Occasional loss, not
systemic; severity depends on user behaviour. See CHORE-03 for the reproduction.

`dbChangeEffects.svelte.ts:70-86` deep-reads only `DBState.db.characters[selIdState]`, and
`tracker.character` is written in exactly one place (`:77-78`), gated on that same selection.
`risuSave.ts:284-308` re-encodes a character only when its `chaId` is in `toSave.character`;
otherwise the `else if(!this.blocks[character.chaId])` branch reuses the existing block. So a
mutation to a non-selected character that already has an encoded block is silently never written.

**Two mitigations, both accidents of implementation rather than designed guarantees:**
- `requiresFullEncoderReload` re-encodes every character (`globalApi.svelte.ts:777-784` ->
  `risuSave.ts:250-260`). Set at only 4 sites: `characters.ts`, `drive/backuplocal.ts`,
  `kei/backup.ts`, `process/coldstorage.svelte.ts`.
- Selecting the character later re-captures the edit, because the effect re-runs on selection
  change and the edit is still on the live proxy. **So the real failure mode is "never persists
  unless the user reopens that character before reload/crash/close."**

**Blast radius:** 67 raw candidate writes across 24 files; ~60 resolve to the live selection and
are not instances. Real non-selected-index writers:

| Writer | Status |
|---|---|
| `process/coldstorage.svelte.ts:590-622` compaction sweep | self-mitigated (sets `requiresFullEncoderReload` at `:621`) |
| `src/lib/Others/GridCatalog.svelte:142-146` restore-from-trash | **UNMITIGATED, real UI action** — see CHORE-03 |
| `src/ts/plugins/apiV3/v3.svelte.ts:879-885` `setCharacterToIndex` | **UNMITIGATED public plugin API**, zero first-party callers, documented at `plugins/apiV3/risuai.d.ts:1326-1333` |
| `bootstrap.ts:495-503` legacy `!db.formatversion` migration | narrow, one-time legacy path |

**Fix surface: small but not proven exhaustive.** The defect is centralised in one gating
condition and one consumer; the ~60 selection-relative writers need no change. What is missing is
a general "mark this `chaId` dirty" primitive — today the only escape hatch is the blunt
whole-database `requiresFullEncoderReload`. `toSaveType.character` is already `string[]` of
arbitrary ids, so **the save format does not block a fix**; the obstacle is that these writers
have no handle on the tracker instance. Needs its own plan and `opus-reviewer` gate.

**Not settled:** whether real plugins call `setCharacterToIndex` on non-current indices
(unknowable from this repo; the sanctioned API shape is the relevant fact), whether the
`bootstrap.ts` legacy migration is still reachable, and MCP/risuaccess write paths were not
exhaustively swept.

### CHORE-02 — `toSave.chat` is dead plumbing in the encoder

`grep -n "toSave.chat\|RisuSaveType.CHAT" src/ts/storage/risuSave.ts` returns **nothing**. The
field is populated (`dbChangeEffects.svelte.ts:80-85`) and merged back on failed saves
(`globalApi.svelte.ts:620-623`), but the encoder never reads it to decide anything — chats persist
inside the whole-character `CHARACTER_WITH_CHAT` block, gated solely by `toSave.character`.

Consequence: leftover/aspirational plumbing for a per-chat granularity that was never wired up.
**Useful corollary: a CHORE-01 fix needs no parallel per-chat work.** Decide whether to wire it up
or delete it; do not leave it looking load-bearing. Low risk either way, but deleting it touches
`toSaveType`, so treat it as save-adjacent.

### CHORE-03 — Trash: dedicated bug-hunting pass

**Maintainer report: the trash implementation is known to be unstable among the community.** That
is consistent with what fell out of CHORE-01 without anyone looking for it:

`GridCatalog.svelte:142-146` restore does
`DBState.db.characters[restoreIdx].trashTime = undefined` with
`restoreIdx = findCharacterIndexbyId(char.chaId)` — not the selection — then calls
`checkCharOrder()`, which mutates only `db.characterOrder`. That top-level key IS covered by the
generic effect loop, so **a save fires** — but this character's `chaId` never enters
`toSave.character`, so `risuSave.ts:298` reuses the stale block, which still has `trashTime` set.

**Reproduction: restore a character from trash, do not open it, close the app. It is back in the
trash on next load.**

**EMPIRICALLY REPRODUCED (2026-09-21)**, driving the real `registerDbChangeEffects()` and the real
`RisuSaveEncoder` / `decodeRisuSave` end to end and inspecting the decoded bytes — not a
reimplementation of the logic. The agent was briefed that a clean disproof was an acceptable result.
Orchestrator re-ran it independently and got identical values:

| Step | Observed |
|---|---|
| Restore char-B (non-selected) exactly as `GridCatalog.svelte:142-146` does | live `trashTime` -> `undefined`; `markChanged(true)` fires from the `characterOrder` touch |
| **Is `char-B` in `toSave.character`?** | **`false`** (`["char-A"]` only) |
| **Decoded `trashTime` after that save** | **`1700000000000` — still trashed. Bug confirmed.** |
| Then select char-B and save again | decoded `trashTime` -> `undefined` — the mitigation is real |

Reproduce:
```
npx vitest run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/trash-restore-repro.svelte.harness.ts --reporter=verbose
```

The harness lives under `Agents/Tools/` as a `*.harness.ts` precisely so that a reproduction of a bug
we are NOT fixing cannot turn the app suite red. When CHORE-01 is fixed, promote it into a real
regression test and invert the step-7 expectation.

Finding one concrete data-losing bug in the trash path *incidentally*, while investigating
something else entirely, plus independent community reports of instability, is good evidence the
area deserves a hypothesis-free pass of its own rather than one-off fixes. Scope should cover at
minimum: `trashTime` set/clear paths, `removeChar` (`characters.ts:847`, including its
`'permanent'` mode), `GridCatalog.svelte`, `checkCharOrder`, interaction with `characterOrder`,
and what happens to a trashed character's assets and remote blocks.

- **Found during CHORE-01 Stage 1 gate 2, pass 3 (2026-09-22, non-blocking).** A
  `removeChar('permanent')` splice during an in-flight `set()` can skip a character, deleting its
  block for one write. It heals on the next save, which reloads. Pre-existing, but more likely now
  that `toSave` can hold all N characters after a plugin `setDatabase`. Ledger row 68.

- **The concrete held-Enter finding is CHORE-53** (2026-10-01; `MC-150`, ledger row 523).

Relates to the Roadmap's closing "Should there be a Round 3?" question — this is a concrete,
evidence-backed candidate area, which that note said was the missing ingredient.

### CHORE-04 — Module enable/disable causes a freeze too, by a DIFFERENT mechanism

**Maintainer report:** enabling a module from the chat screen (hamburger -> modules) and from
Settings -> Modules both freeze. Deserves its own investigation.

**Important: Stage B's partition does NOT fix this.** Stage B removed the per-keystroke cost of
editing module *content*. Toggling changes `db.enabledModules`, not module content, and the freeze
appears to come from a full GUI reload rather than from dirty-tracking.

**Grounded hypothesis — NOT verified, test it before acting on it:**

- Toggle in Settings (`ModuleSettings.svelte:83-89`) splices/pushes `db.enabledModules` then
  self-assigns it.
- Toggle in the chat menu (`ModuleChatMenu.svelte:98`, `:112`) does the same **and explicitly bumps
  `$ReloadGUIPointer += 1`.**
- Either way the enabled-id string changes, so `getModules()`'s cache key changes
  (`modules.ts:417-419`) and `moduleUpdate()` **also** bumps `ReloadGUIPointer`
  (`modules.ts:579-582`).
- `ReloadGUIPointer` drives `{#key}` blocks in `Chat.svelte` (read into `chatReloadPointer` at
  `:522`, keyed at `:538` — one per mounted message, around its `ChatBody`) and at
  `BackgroundDom.svelte:15`. A `{#key}` change **destroys and recreates the entire subtree** — i.e.
  the whole chat message list re-renders.

So the suspected cost is a full chat re-render, possibly bumped **twice** per toggle (once
explicitly, once from `moduleUpdate`). That would also explain why it is worse with long chats,
which is a different scaling axis from module count.

**What the investigation should establish first:** measure it before theorising further — the
campaign's repeated lesson. Is the cost the `{#key}` teardown/rebuild, the module recomputation, or
both? Is `ReloadGUIPointer` bumped once or twice per toggle? Is a full chat rebuild actually
necessary for a module toggle, or is it a blunt instrument for a narrower need (background HTML and
chat-icon changes)? Note `resetScriptCache()` also hangs off this pointer, so it is load-bearing for
more than rendering — do not assume it can simply be removed.

**Related finding (CHORE-12, 2026-09-22):** `moduleUpdate()`'s dependency tracker
(`src/ts/process/moduleUpdateDeps.ts:11-18`) is deliberately narrowed to `id`, `namespace`,
`hideIcon` and `backgroundEmbedding` — editing a module's lorebook, regex, triggers or assets does
NOT bump `ReloadGUIPointer` at all (saving is unaffected). That is the opposite-direction version of
this same mechanism: this chore is about the pointer firing too often on a toggle; MOD-6 in
`Agents/Reports/99-modules.md` is about it not firing enough on a content edit. Read both before
changing anything on `ReloadGUIPointer`.

### CHORE-05 — Translation coverage: much of the UI is English-only

**Status (2026-10-04): UI-lane work done through batch 5e; open only for the native-speaker review, LOW PRIORITY, owned by
the Main Campaign session (`MC-212`, `MC-218`).** Batch 1 (2026-10-03, UI session): DONE in `39f00517` (ledger rows 878 to 886). Product choices in `MC-209`. The investigator (row 878) refuted the
ticket's key-drift premise, and the stale sections below are marked as superseded; they are kept as written.
- **Key drift is zero.** Before batch 1 all six locales had the same 1668 keys as `en.ts` (1801 after it) (`131fdcd5`, 2026-09-23, filled 510 keys), and the
  seven plugin consent keys are translated. The Orchestrator re-ran the drift script. This supersedes the "Next priority"
  consent table and the "Measured key drift (2026-09-21)" table below (1529 keys, 53 to 99 missing per locale). The
  TTS-4 citation `CharConfig.svelte:792` is stale too: the hint is now `language.ttsElevenLabsKeyHint`.
- **Done in batch 1 (Errors + Playground):** 133 new `en.ts` keys (43 `errors`, 40 in a new top-level `alerts` object, 47
  `playground`, 2 `hypaV3Modal`, `loadingEllipsis`), translated into all six locales (row 882). 50 call-site files route
  hard-coded alert, error and Playground strings through `language`: `ts/process/**` (`local.ts`, `stableDiff.ts`, `mcp/*`,
  `request/*`, `prompt.ts`, `scripts.ts`, `index.svelte.ts`, `modules.ts`, `previewRunner.ts`), `characterCards.ts`,
  `characters.ts`, `persona.ts`, `gui/colorscheme.ts`, `hotkey.ts`, the Realm UI, the Playground pages and others. New keys
  are flat strings with `{name}` placeholders, filled by `fillLang` in the new `src/lang/fill.ts`.
- **MC-207's items:** the Playground Embedding and Prompt Conversion literals (CHORE-16 PG-2 and PG-4) are done in this batch.
  `moduleContent` and `confirmRemoveModuleFeature` (CHORE-12 MOD-4) are still unused; they go to the dead-key batch.
- **Typo fixes in the English text:** "screenShot", "least one preset" (now shared with `TranslatorPresetSettings.svelte` as
  `errors.atLeastOnePreset`), "invaid", "copywrite", "additional Assets", and a double space in "Converting  video".
- **Left English on purpose (the Orchestrator's disposition, `MC-209`):** `Failed to fetch model response after tool execution`
  at five request sites and `Failed to fetch WaveSpeed models`, because `alertError` adds a network hint to messages that
  include `Failed to fetch` and `globalFetch` returns `ok: false` on real network failures too.
- **Deferred:** thrown error messages; the five `alertToast` strings in `globalApi.svelte.ts` (out of bounds, `MC-200` 4);
  the `/?` slash-command help in `command.ts`; the drag-and-drop debugging dump in `LoreBookList.svelte`.
- **New guard:** `src/lang/localeParity.test.ts` fails when a locale's key set, a value's kind or a string's `{placeholder}`
  set differs from `en.ts`. Merge note: it fails any lane, the Main Campaign's included, that adds an English key without
  all six translations. Other new tests: `fill.test.ts`, `fetchModelsFailed.test.ts`, `persona.i18n.test.ts`,
  `colorscheme.i18n.test.ts`, `PlaygroundEmbedding.i18n.svelte.test.ts`, `RealmFrame.i18n.svelte.test.ts` (at HEAD, 6 of the
  11 i18n tests fail and the 5 English guards pass; row 883).
- **Checks:** `pnpm check` 0/0; `pnpm test` 352 files, 7092 passed, 4 skipped; build ok (row 884). Gate 2 approved (row 885).
  Not run in a browser or on a device.
- **Merge note (`MC-179`):** the Main Campaign changed `request/*`, `local.ts`, `stableDiff.ts`, `index.svelte.ts` and
  `characterCards.ts` heavily; the edits here are string expressions and imports only.
- **Remaining batches, in the lane (the maintainer chooses the order; as of batch 1, the current list is in the batch 2
  block below):**
  1. **Settings pages**, about 480 hard-coded rows (row 878). `MC-209`'s rule: provider and model names, API, URL, JSON and
     parameter names such as Top P stay English; the rest is translated.
  2. **SideBars, Others and the common UI chrome** (about 167 and 114 rows by the same heuristic).
  3. **Dead-key removal** (done in batch 4; see the batch 4 block), in its own batch after a second check. The investigator found 118 likely-dead keys, with
     dynamically accessed groups (`help`, `setup`, `triggerDesc`, `hotkeyDesc` and others) excluded. Skip the keys that may
     belong to a planned feature: persistent storage (`persistentStorage`, `persistentStorageRecommended`,
     `persistentStorageDesc`), license (`license`, `licenseDesc`) and Claude caching (`claudeCachingExperimental`,
     `claudeCachingRetrivalDesc`), by the names in the investigator's list. Include `moduleContent` and
     `confirmRemoveModuleFeature`.
  4. **Optional native-speaker review** of the 203 strings identical to English (`de` 65) and of the translator's
     low-confidence items (row 882). The Playground Embedding label "Custom (OpenAI-compatible)" is for the Settings batch.
- **Disclosure (`MC-209`, not answered by the maintainer):** in the six non-English locales the `Failed to fetch models:
  {error}` network hint appears only when the raw error text contains `Failed to fetch` or Firefox's `NetworkError when
  attempting to fetch resource.` (a text match in `alertError`, not a network test); in English it appears on every error of
  that message.

**Status (2026-10-03, UI session, translation batch 2: the Settings pages): DONE in `694a4c89`;
the ticket stays open for the later batches** (ledger rows 887 to 894). Product choices in `MC-210` (the order) and `MC-209`
(names stay English); the rest of `MC-210` is the Orchestrator's dispositions, not the maintainer's. Batch 1's mechanism is
reused unchanged: flat string keys, `{name}` placeholders filled by `fillLang`, no function-valued keys.
- **Done in batch 2:** 167 new `en.ts` keys (38 top-level and 129 in a new `settingsPage` object; the Orchestrator's count
  from the working-tree diff), translated into all six locales (row 890). 20 Svelte files under `src/lib` (Settings pages,
  `botpreset.svelte`, `SettingRenderer.svelte`, `SettingSelect.svelte`, `CustomSidebarConfig.svelte`) and 7 files under
  `src/ts/setting` now route visible text through `language`. 66 registry entries gained a `labelKey` (advanced 12, bot
  parameters 19, chat format 1, display 3, language 25, accessibility 6); the English `label` or `fallbackLabel` stays as the
  fallback, because the registry objects are module-level and `getLabel` resolves the key lazily. Mixed strings use a
  `{name}` placeholder key (for example `settingsPage.nameApiKey`, "{name} API Key") with the provider name kept English. The
  Settings embedding dropdown's "Custom (OpenAI-compatible)" now uses `settingsPage.customOpenAiCompatible`; the Playground
  copy in `PlaygroundEmbedding.svelte` (listed for this batch in batch 1) is still hard-coded and goes to batch 3.
- **Behaviour changes, disclosed (`MC-210`, not answered by the maintainer):** (a) `CustomSidebarConfig.svelte` shows and
  stores `getLabel(type) || type.id`, so a newly added custom sidebar item stores its label (the language value if it has a
  `labelKey`, otherwise its English `fallbackLabel`) instead of an id such as `adv.visionQual`; only an item with neither
  keeps its id; stored items are untouched. (b) `Upload<br />Image`, `Upload<br />Vibe` and `Uploading<br />Image..` are
  single strings with a space: the English `textContent` gains a space and the forced line break is gone, so the text wraps
  naturally in the 80px box and may fit on one line. (c) In the NovelAI reference area "Image Reference", "Vibe Trasfer", "Character Reference" and
  "Upload Vibe" are translated while sibling NovelAI labels stay English (Gate 2 SHOULD 3, left; a later native or maintainer
  call). Also: settings search now matches `fallbackLabel`; an item with only a `labelKey` stays searchable only in the
  current language, as before.
- **Left English on purpose (the Orchestrator's dispositions, `MC-210`):** parameter names (Top P, Top K, Min P, Top A,
  Repetition penalty, Reasoning Effort, Verbosity, Thinking Mode, Jinja Template); sampler and scheduler names; Stability
  style presets; resolutions and ratios; the UI mode names; tokenizer and `LLMFormat` names; Ooba snake_case names and
  modes; NovelAI feature names; the role labels User, System and assistant in `PromptSettings.svelte`; colour-scheme preset
  names; keyboard key names. Stored defaults (`New Persona`, `New Preset`, `New Lore`, `New Folder`, `New Event`) are not
  translated. Translator target-language names are translated (endonyms kept). English typos kept byte-identical: "Vibe
  Trasfer", "Text Spliting", "Seperator", "Malaysian", "Ukranian".
- **Two fixes folded in:** the six new-message-button option labels in `accessibilitySettingsData.ts` were `language.x` at
  module level (frozen at import); they are now `labelKey` plus an English `label`. `acc.longPressToPopupEditor` had a
  `labelKey` with no `en.ts` key (upstream commit `e03c3897` renamed the item without adding one), so its checkbox had no
  label; it has a fork-only key, "Long Press to Open Popup Editor", and a `fallbackLabel`.
- **Deferred:** the registry `options.placeholder` strings ("Leave it blank to use default", "Leave it blank to not use" in
  `advancedSettingsData.ts`) need a `placeholderKey` mechanism; `CustomSidebarConfig.svelte`'s other strings ("No custom
  sidebar items configured", "Delete", "Add Item", "Close", "Back to List"), `LoreBookSetting.svelte` and the Playground
  Embedding "Custom (OpenAI-compatible)" option go to the next batch.
- **New tests (20, four files):** `src/ts/setting/settingLabelKeys.test.ts` (3 guards: every `labelKey` names an existing
  `en.ts` key), `SettingWrappers.i18n.svelte.test.ts` (11), `CustomSidebarConfig.i18n.svelte.test.ts` (4) and
  `OtherBotSettings.i18n.svelte.test.ts` (2). Against HEAD's production files (scratch config), 8 of the 20 fail for the
  intended defects; with `en.ts` at HEAD too, 13 fail (row 891; re-run on the final tree by the Orchestrator, same counts,
  row 892). The `fallbackLabel` search match has no failing-at-HEAD test
  (guard only). Merge note: the parity guard and the `labelKey` guard fail any lane that adds an `en.ts` key without all six
  translations, or a `labelKey` that names no `en.ts` key.
- **Checks:** `pnpm check` 0/0; `pnpm test` 356 files, 7112 passed, 4 skipped; build ok (row 892). Gate 2 approved (row 893).
  Not run in a browser or on a device.
- **Remaining batches, in the lane (the maintainer chooses the order):**
  1. **SideBars, Others and the common UI chrome** (about 167 and 114 rows by the row 878 heuristic), including the rest of
     `CustomSidebarConfig.svelte`'s strings and `LoreBookSetting.svelte`. The registry `options.placeholder` strings wait
     for a `placeholderKey` mechanism. Batch 3 is done (see the batch 3 block below).
  2. **Dead-key removal** (done in batch 4; see the batch 4 block), in its own batch after a second check; the exclusions and the list are in the batch 1 block above.
  3. **Optional native-speaker review** of the strings identical to English and of the translators' low-confidence items:
     batch 1 (row 882) and batch 2 (row 890: `optViaSound`, `optAxModel`, `nameThinking`, `hotBadge`, `starter`, `bias`, and the
     de and vi wording of `visionQuality`). Also a review note from Gate 2 (row 893): five pairs of keys hold the same English
     (`settingsPage.iconAlt` and `icon`, `helpTab` and `helpBlock`, `deleteButton` and `playground.delete`, `searchModels` and
     `openRouterSearchModel`, `imagenImageSize` and `imageSize`) and can drift apart; and ko 유저 against 사용자.

**Status (2026-10-03, UI session, translation batch 3: SideBars, Others and the common UI): DONE in `40a64aaf`; the ticket stays open for the later batches** (ledger rows 895 to 899). Product choices in `MC-211` (dev panels,
Easter eggs, the Iris dialog, one batch; the maintainer's four answers) and `MC-209` (names stay English); the dispositions and
disclosures in `MC-211` are the Orchestrator's, not the maintainer's. The mechanism of batches 1 and 2 is reused: flat string
keys, `{name}` placeholders filled by `fillLang`.
- **Done in batch 3:** 205 new leaf keys in `en.ts` (8 new objects: `devTool` 24, `sidebarUi` 61, `alertComp` 15, `loadoutModal` 13,
  `promptDiff` 38, `iris` 11, `othersUi` 9, `uiCommon` 24 = 195; plus 10 in `hypaV3Modal`), translated into all six locales
  (row 897). 39 Svelte files (ChatScreens 3, Others 14, Playground 1, SideBars 13, UI 8) and the new
  `src/lib/SideBars/folderColors.ts` route visible text through `language`. An existing key is reused only when its English
  value is byte-identical to the old literal and the key is generic (top-level, or the generic `settingsPage.back`,
  `settingsPage.unnamed` and `settingsPage.customOpenAiCompatible`); other domain-group keys are not reused. English
  rendering is checked by a 307-row manifest: the 296 rows with a key all give `fillLang(en[key])` equal to the old literal
  (0 bad); the 11 rows without a key (the `GridCatalog` data field, the Iris dictionary text and scaffolding, the colour-array
  plumbing) are covered by the ko and zh-Hant byte-identity checks and the tests (row 897).
  - **Iris dialog:** the intro and unsupported-model text moved into the language files, so all seven languages have them; the
    ko text and the zh-Hant intro and tip are byte-identical to the old component text. A saved dialogue loads unchanged; the
    'Iris' and 'You' speaker values are unchanged.
  - **Folder colours:** the Sidebar and `SideChatList` folder colour select shows translated names from one list of value and
    label pairs in `folderColors.ts`; the stored value is the English lower-case name as before.
- **Behaviour changes, disclosed (`MC-211`; the maintainer approved them before the commit):** (a) a non-index answer to the folder colour
  select now writes nothing; at HEAD Sidebar threw an unhandled TypeError (`colors[sel].toLocaleLowerCase()` on undefined) and
  `SideChatList` stored undefined as the colour. (b) The Iris intro line is sent to the model as the first assistant turn, so
  cn, vi, de and es users now send it in their language (English before); ko and zh-Hant are unchanged. (c) The zh-Hant Iris
  unsupported-model line was in Simplified characters at HEAD and is now Traditional. (d) A `GridCatalog` entry without creator
  notes has `desc` `''` instead of 'No description'; the display is the same in English.
- **Left English on purpose (the Orchestrator's dispositions, `MC-211`):** the `CharConfig` TTS engine parameter labels (the
  `MC-209` reading; the maintainer may revisit); the `AlertComp` technical labels (ID, GenID, Bytes, URL, Request Body,
  Request Header, Response, Chunks, the OK/ERR badge, export format names, the bug-report block); stored defaults; the Easter
  eggs (the maintainer's answer); Realm NSFW/SFW; "Choose your language"; "XHigh"; the "Performace" typo; typos in general.
- **Deferred:** `MobileCharacters.svelte` "Unnamed"; the `HypaV3Modal` conversion errors have no component test; the registry
  `options.placeholder` strings (need a `placeholderKey`); thrown errors; `globalApi` toasts (out of bounds, `MC-200` 4); the
  `/?` help; the `LoreBookList` drag debug dump; UI text produced in `src/ts/**` (for example `devToolActions` output);
  `Legal.svelte` (never edited). `src/lib/Setting/**` and `App.svelte` have no edit; `src/lib/Setting/**` was not
  independently audited (its roughly 325 literals are nearly all KEEP-ENGLISH by the inventory).
- **New tests (9 new files):** `AlertComp.i18n`, `GridCatalog.i18n`, `IrisModal.i18n`, `LoadoutModal.i18n`,
  `PromptDiffModal.i18n`, `RegexData.i18n`, `Sidebar.folderColor.i18n` and `SideChatList.folderColor.i18n`
  (`*.svelte.test.ts`) and `folderColors.i18n.test.ts`; `CustomSidebarConfig.i18n.svelte.test.ts` gains one reproducer. Against
  HEAD's 9 mounted Svelte files (the scratch config `head.vitest.config.mts` in the Orchestrator's scratchpad, with those
  files in `HEAD_FILES` and the language files at the working tree), 22 of 78 i18n tests fail, all 22
  labelled "regression reproducer:"; the others are guards and batch 1 and 2 tests (row 898). The `HypaV3Modal` conversion
  errors have no test. Merge note (`MC-179`): the parity guard fails any lane that adds an `en.ts` key without all six
  translations, which is intended.
- **Checks:** `pnpm check` 0/0; `pnpm test` 365 files, 7162 passed, 4 skipped; build ok (row 898). Gate 1 took two rounds
  (`[REJECT]`, then `[EDITORIAL]`; row 896) and Gate 2 approved (row 898). Not run in a browser or on a device.
- **Merge note (`MC-179`):** ChatScreens (3), Others (14), Playground (1), SideBars (13) and UI (8) Svelte files, the new
  `folderColors.ts`, and the seven `src/lang` files. Three are on the Main Campaign's return list: `CharConfig.svelte`
  (strings only, 21 lines changed), `PlaygroundEmbedding.svelte` (one line) and `Chat.svelte` (one line, the User/Assistant
  label; not the copy code). `.claude/launch.json` is modified in the working tree and stays out of the commits. No file on the UI session's out-of-bounds list, `src/App.svelte` or
  `docs/` is in the diff (the Orchestrator's path check over the modified and untracked files; Gate 2 confirmed the same).
- **Remaining batches, in the lane (the maintainer chooses the order):**
  1. **Dead-key removal** is done (see the batch 4 block below).
  2. **Optional native-speaker review** of the strings identical to English and of the translators' low-confidence items:
     batch 1 (row 882), batch 2 (row 890) and batch 3 (row 897: the regex flag names, the prompt-diff view names Unified, Split,
     Intraline and Legacy, Autopilot, Instruct, Join, Forked, the vi CHAR/CHAT badge length, the informal du and tú in the de and
     es Iris text, and the mainland wording of the zh-Hant intro and tip). Deferred by the maintainer in batch 4 (`MC-212`).

**Status (2026-10-04, UI session, translation batch 4: dead-key removal): DONE in `e2602d4d`; the ticket stays open for the follow-ups below** (ledger rows 900 to 904). The request is the maintainer's (`MC-212`); the dispositions in `MC-212` are the Orchestrator's, not the maintainer's.
- **Done in batch 4:** 131 unused `en.ts` keys deleted from all seven language files (107 top-level, 20 `triggerInputLabels`, 4
  `errors`). `en.ts` leaves go from 2162 to 2031. Each file lost 132 lines (`coldStorageCleanupAborted` spans two lines) and gained
  none; the survivors are equal in value and order, and no deleted line is a comment (row 902). `moduleContent` and
  `confirmRemoveModuleFeature` (`MC-207`) are among the deleted keys. The second check found the old 118-key list wrong: it held
  three live keys (`nanoGPTSelectFromList`, `nanoGPTManualInput`, `nanoGPTManualModelSelect`, read as `(language as any)` in
  `BotSettings.svelte`) and missed 25 dead ones (row 900).
- **Kept on purpose:** the seven planned-feature keys the maintainer excluded earlier (the batch 1 block above), and
  `globalLoreBook` and `globalRegexScript` until after the merge (the Orchestrator's disposition, `MC-212`): the Main Campaign
  branch still reads them in `GlobalLoreBookSettings.svelte` and `GlobalRegex.svelte`; they were retired on this branch in
  `408c32dd`.
- **Not touched:** 35 possibly-dead names inside computed groups (`help` 11, `setup` 18, `triggerDesc` 6). Ten groups were
  treated as wholly live because they are read by computed access (row 900).
- **No new test (the Orchestrator's disposition, `MC-212`):** there is no defect to reproduce; a guard that every key is
  referenced was rejected because computed groups make it unsound, or it needs a hand-kept allowlist.
- **Checks:** `pnpm check` 0/0; `pnpm test` 365 files, 7162 passed, 4 skipped; build ok (row 902). Gate 1 and Gate 2 both
  approved (rows 901 and 903). Not run in a browser.
- **Merge note (`MC-179`):** the parity guard and the `satisfies DeepPartial<...>` on each locale mean a key deleted from
  `en.ts` has to go from all seven files together. All 131 keys are also unused on the Main Campaign branch tip `0df2e266`
  (row 900). After the merge, a Main Campaign use of a deleted key through a static chain fails `pnpm check`, but a computed
  access would not. Expect textual conflicts in the seven locale files (row 903).
- **Native-speaker review: deferred by the maintainer (`MC-212`).** The maintainer said the Korean and English translations look good
  (the Orchestrator reads that as batches 1 to 3) and will report issues; cn, zh-Hant, vi, de and es remain unreviewed by a native speaker.
- **Remaining follow-ups:** delete `globalLoreBook` and `globalRegexScript` after the merge if those pages go; decide the 35
  computed-group names (decided in batch 5a: 29 deleted, 6 kept); the deferred items in the batch 3 block above.

**Status (2026-10-04, UI session, translation batch 5a: small deferrals and 29 dead computed-group names): DONE in `fb454bc0`; the ticket stays open for the follow-ups below** (ledger rows 905 to 910). The request and the split into three batches are the maintainer's (`MC-213`); the dispositions in `MC-213` are the Orchestrator's, not the maintainer's.
- **Done in batch 5a:**
  - 29 dead computed-group names deleted from all seven language files (`help` 11, `setup` 18). They are unused on HEAD and on the
    Main Campaign tip `b2406e0e` (row 905). Each file's survivors are equal in value and order, and no comment line was removed (row 908).
  - 5 new `en.ts` keys, translated into the six other locales: `unnamedPreset`, `emotionPromptPlaceholder`,
    `presetChainPlaceholder`, `settingsPage.otherAx` and `slashCommandHelp`. Leaves go from 2031 to 2007 (2002 survivors plus 5).
  - `placeholderKey` on `SettingOptions` and a `getPlaceholder` helper (`src/ts/setting/types.ts`, `utils.ts`), read by
    `SettingText.svelte` and `SettingTextarea.svelte`. It is resolved lazily like `labelKey`, and the English `placeholder`
    stays as the fallback. The two registry placeholders (`adv.emoPrompt`, `adv.presetChain`) now use it.
  - The three `nanoGPT` keys in `BotSettings.svelte` are static `language.x` chains, without `as any` and without the dead
    `"Manual Model Select"` fallback. No text change; the keys are now type-checked.
  - The four `"Loading..."` assignments in `modal-summary-item.svelte` use `language.loadingEllipsis`.
  - `MobileCharacters.svelte` "Unnamed" uses `settingsPage.unnamed`; the `botpreset.svelte` drag label uses `unnamedPreset`.
  - `OtherAx` (the `AuxModelSelectors.svelte` label and the `PromptSettings.svelte` accordion name) is translated, because its
    siblings in the same accordion are (Gate 1 N1, confirmed by the Orchestrator).
  - The `/?` slash-command help (`command.ts`) is one key, `slashCommandHelp`. The English text is byte-identical to HEAD's
    template literal (1788 characters; Gate 2 re-ran the comparison). Command names, argument syntax and example commands stay
    English in every locale; descriptions and the "Example:" label are translated (ko uses "예시:"; cn and zh-Hant use a full-width colon).
- **Behaviour fix, disclosed (found by Gate 1, M1; the Orchestrator confirmed it by reading the component):** at HEAD the
  Apply button in the `HypaV3Modal` re-roll box could write the `"Loading..."` placeholder, or the failure message, into
  `summary.text`. Apply is now disabled unless a result exists, the re-roll is not pending and it has not failed
  (`canApplyRerolled`; `rerollFailed` is set in the catch and cleared when a re-roll starts), and `applyRerolled` returns early. Pre-fix
  failure: two reproducers, where the summary text became `'Loading...'` (Apply while pending) and `'Reroll failed'` (Apply
  after a failure). Gate 2's optional item was then done at the maintainer's request (`MC-214`, rows 911 to 913, committed in
  `e61a0f72`): editing the re-roll text after a failure clears `rerollFailed`, so Apply applies the edited text; typing while
  a re-roll is pending changes nothing. 4 tests added to `HypaV3Modal.rerollConvert.svelte.test.ts`, 2 of them regression
  reproducers that fail at `e6c45b3d`.
- **Kept, or not touched:** the five live `triggerDesc` names (`v2GetCharacterDesc`, `v2SetCharacterDesc`, `v2GetPersonaDesc`,
  `v2SetPersonaDesc`, `v2UnsupportedTriggerDesc`) and `v2UnsupportedTrigger`, which is reachable through `triggerDesc[type]`
  from saved effect data (row 905). The `LoreBookList` debug dumps are commented out, so there is nothing to translate and no
  change. The `HypaV3Modal` conversion errors got tests only (guards), no source change. The `globalApi` toasts are not touched:
  `globalApi.svelte.ts` is out of bounds for this session except `openURL` (`MC-200` 4). `Legal.svelte` is never edited.
- **Tests (5 new files, 56 tests; no existing test file edited, apart from the `collect()` extension below):**
  `SettingPlaceholder.i18n.svelte.test.ts` (11), `HypaV3Modal.rerollConvert.svelte.test.ts` (12), `command.help.test.ts` (27),
  `MobileCharacters.unnamed.svelte.test.ts` (3) and `botpreset.unnamedPreset.svelte.test.ts` (3).
  `settingLabelKeys.test.ts` has its `collect()` extended to cover `options.placeholderKey`. Against HEAD's production files
  (the scratch config `tw5a-head.vitest.config.mts`, language files at the working tree), 13 tests fail and 43 pass. Seven
  failures are regression reproducers on their intended assertions (the Korean `adv.emoPrompt` placeholder, the textarea
  placeholder, Apply while pending, Apply after a failure, the Korean `/?` help, `MobileCharacters` Unnamed, `botpreset` Unnamed
  Preset). Six are `getPlaceholder` unit tests that fail only because the export is missing, so they are not counted as
  reproducers. The 43 passes are compatibility guards (row 908).
- **Checks:** `pnpm check` 0/0; `pnpm test` 370 files, 7218 passed, 4 skipped; build ok (row 908). Gate 1 and Gate 2 both
  approved (rows 907 and 909). Not run in a browser.
- **Merge note (`MC-179`):** the seven locale files will conflict textually with the Main Campaign branch. By Gate 1's check, no
  other file of this batch is touched on Main.
- **Translator low-confidence items, for the deferred native-speaker review (`MC-212`):** de "Sonstige Hilfsmodelle" for
  `otherAx`; the terseness of `otherAx` in vi, cn and zh-Hant; the vi term for the trigger; the cn term for the preset; es
  uses Latin American forms.
- **Remaining, as planned (`MC-213`):**
  - **Batch 5b**, user-visible thrown errors and request-failure strings (about 40 keys): `request/*`, the `throwError`
    literals in `index.svelte.ts`, `tts.ts`, `translator/presets.ts` (and its test assertions), `modules.ts`, `interchangeability.ts`.
  - **Batch 5c**, the `devToolActions` and `previewRunner` markdown (about 12 keys) and the `CharConfig` TTS prose labels (about
    15 to 20; parameter and engine names stay English), plus the `CharConfig` "Bias" label.
  - **After the Main Campaign merge:** the `characterCards.ts` wait messages and asset-not-found throws, and the `processzip.ts`
    strings (both sit inside Main Campaign hunks).
  - **Stay English (the Orchestrator's disposition):** plugin API v3 throws (47), MCP throws (22), internal and swallowed
    throws, JSON-dump throws, the `scriptings` `'Error: '` strings returned to Lua, and the `cbs.ts` tag docs.

**Status (2026-10-04, UI session, translation batch 5b: user-visible error and request-failure strings): committed as `edc8c8b6` (code) on the maintainer's word "commit and start 5c"; not pushed; the ticket stays open for the follow-ups below** (ledger rows 914 to 918). The request and the three answers are the maintainer's (`MC-215`); the dispositions in `MC-215` are the Orchestrator's, not the maintainer's.
- **Done in batch 5b:**
  - 36 new `errors.*` keys in `en.ts`, translated into the six other locales (each appended after `vertexAuthIncomplete`), plus
    two reused keys (`errors.unexpectedResponseType`, `errors.vertexAuthIncomplete`). Placeholders sit inside the key text, for
    example `{provider}: {error}` and `{tokens}`.
  - 14 production files: `index.svelte.ts`, `request/request.ts`, `request/google.ts`, `request/anthropic.ts`,
    `request/openAI/requests.ts`, `request/openAI/responses.ts`, `request/shared.ts`, `tts.ts`, `translator/presets.ts`,
    `process/modules.ts`, `src/ts/interchangeability.ts`, `models/local.ts`, `templates/jsonSchema.ts` and
    `plugins/plugins.svelte.ts` (the plugin-update rename error): 14 production files, plus the seven locale files and the
    `requests.responses.test.ts` mock.
  - Request failures (`{type:'fail', result}`), thrown errors shown in alerts, the Horde, Ooba WebSocket and local-model texts,
    the translator preset errors and the module asset save error are translated.
- **Disclosures (`MC-215`):**
  - Translated failure text now reaches Lua `LLM` and `axLLM`, the trigger `runLLM` result, MCP `aiaccess`, the plugin v3
    `runLLMModel` and, with "inlay error response" on, saved chats. A script that matches English words in those results would
    stop matching in a non-English UI. The investigator found none in the repository (row 914).
  - Three English texts were fixed, with the maintainer's answer "Fix them (Recommended)": `websocketConnectFailed` ("WebSocket
    connection to '{url}' failed."), `hordeNotPossible` and `hordeNotPossibleWith` ("Response not possible." and "Response not
    possible: {message}", where HEAD joined the parts with no space) and `localStreamingBlocked`. Every other English value is
    byte-identical to HEAD (Gate 2).
- **Kept English (the Orchestrator's dispositions, `MC-215`):** `chatTemplate.ts` "Template type is not set" (unreachable in
  normal use), the `src/main.ts` preload alert (can fire before the language loads), the five "Failed to fetch model response
  after tool execution" sites, "Aborted", "All models failed", the plugin-blocked text, the preview JSON, tool-call failure
  texts sent to the model, the Anthropic stream retry and error text, `sp.error` from `memory/**`, the `pluginListMerge` header
  errors and the Rust `unsupportedReason`.
- **Tests (6 new files, 20 tests; one existing test file edited, `requests.responses.test.ts`, whose `src/lang` mock now
  carries the English `incompleteResponse` keys):** `presets.i18n.test.ts`, `jsonSchema.i18n.test.ts`,
  `interchangeability.i18n.test.ts`, `request/tests/shared.i18n.test.ts`, `models/tests/local.i18n.test.ts` and
  `process/tests/requestErrors.i18n.svelte.test.ts`. Against production files served at `a5699f55` (a scratch alias config,
  current `src/lang`), 13 reproducers fail on assertions and 7 guards pass (rows 916 and 917). Not tested: Cohere, Claude batch,
  Bedrock, Vertex/Google token, TTS, MultiGen, `moduleAssetsSaveFailed`, `pluginNameChangeBlocked`, `characterNotFound`,
  `requiredTokens`, the Korean `incompleteResponse` and `localSidecarNotStarted`.
- **Checks:** `pnpm check` 0/0; `pnpm vitest run` 376 files, 7242 passed, 4 skipped; `pnpm build` ok (row 916). Gate 1 and Gate 2
  both ended `[EDITORIAL]` (rows 915 and 917), corrections made. Not run in a browser.
- **Merge note (`MC-179`):** the seven locale files will conflict textually with the Main Campaign branch, as in earlier
  batches. On the Main Campaign branch (merge-base `57e7be63`), of this batch's other files only `process/modules.ts` also
  changed: Main's hunks are in `importModule` (about lines 271 to 276), this batch's in `readModule` (line 248), so they do
  not overlap.
- **Translator low-confidence items, for the deferred native-speaker review (`MC-212`):** listed in `MC-215` ("sidecar",
  access token versus Token, vi plugin and `requiredTokens`, de "Charakter", "Voreinstellung" and "Assets", es tú and
  "Reverificando tokens", ko `hordeNoGenerations`).
- **Remaining:**
  - **Batch 5c**: the `devToolActions` and `previewRunner` text, the `CharConfig` TTS prose labels and the `CharConfig` "Bias" label.
  - **After the Main Campaign merge:** the `characterCards.ts` and `processzip.ts` strings, including the `processzip.ts`
    "Failed to save N assets" text.
  - **Known leftover out of bounds:** `hanuraiMemory.ts` "Required Tokens" (`process/memory`).
  - **Native-speaker review:** deferred by the maintainer (`MC-212`); cn, zh-Hant, vi, de and es remain unreviewed by a native speaker.

**Status (2026-10-04, UI session, translation batch 5c: dev-tool preview text, the `CharConfig` TTS labels and Bias): committed as `1ad02c3f` (code) on the maintainer's word "yes, commit 5c."; not pushed; the ticket stays open for the follow-ups below** (ledger rows 919 to 923). The request is the maintainer's ("commit and start 5c", `MC-216`); the dispositions in `MC-216` are the Orchestrator's, not the maintainer's. The three gated batches (5a, 5b, 5c) are done.
- **Done in batch 5c:**
  - 39 new keys in `en.ts` (8 in `devTool`, 31 in `sidebarUi`), translated into the six other locales. Reused keys:
    `language.prompt`, `language.model`, `language.language`, `language.temperature` and the four `languageName*` keys.
  - 3 production files, display text only: `devToolActions.ts`, `previewRunner.ts` and `CharConfig.svelte` (the TTS tab and the
    Bias section), plus the seven locale files.
  - The dev-tool preview text (rendered by `alertMd`, not sent to the model, not saved), the `CharConfig` TTS prose labels and
    the Bias label and "string" placeholder are translated. Option values and stored settings are unchanged.
- **Kept English (`MC-216`):** the role headings (Function, User, System, Assistant), "TTS", the engine names, the VOICEVOX
  Speed, Pitch, Volume and Intonation scale names, Base URL, URL, Response Format and the formats, Top P and Top K, Chunk Length,
  Normalize, v1 and v2, and the example placeholders.
- **Disclosures (`MC-216`):** VOICEVOX "Speed scale" and "Volume scale" stay English beside the translated GPT-SoVITS "Speed"
  and "Volume"; "Temperature" is translated while Top P and Top K stay English; `MC-211`'s kept-English TTS labels are superseded
  for prose by `MC-213` decision 3.
- **Tests (2 new files, 29 tests):** `CharConfig.ttsLabels.svelte.test.ts` (20) and `process/tests/previewText.i18n.test.ts`
  (9). Against the three production files served at `ce33d027` (a scratch config, current locales), 17 reproducers fail on
  assertions and 12 guards pass (row 921). Not covered: VITS mode (no translated label), the other five locales beyond key
  parity, and the English "no undefined" check on the Bias tab.
- **Checks:** `pnpm check` 0/0; `pnpm vitest run` 378 files, 7271 passed, 4 skipped; `pnpm build` ok (row 921). Gate 1 and Gate 2
  both ended `[APPROVE]` (rows 920 and 922). Not run in a browser.
- **Merge note (`MC-179`):** the seven locale files will conflict textually with the Main Campaign branch, as in earlier
  batches. On the Main Campaign branch (merge-base `57e7be63`), `git diff --name-only 57e7be63
  fix/persistence-conflict-platform-hardening` on this batch's files (`devToolActions.ts`, `previewRunner.ts`,
  `CharConfig.svelte` and the two new test files) lists none of them, so only the locale files are expected to conflict.
- **Translator low-confidence items, for the deferred native-speaker review (`MC-212`):** listed in `MC-216` (ko
  `instruction` and `cachePointNote`, cn and zh-Hant 指令 and 参考音频文本 / 參考音訊文本, zh-Hant 快取點 and 音訊, vi
  `instruction`, "cache point", "custom voice seed" and the "Trộn …" labels, de "Eigener Stimm-Seed", "Cache-Punkt" and
  "Nicht-Text-Inhalt(e)", es "Instrucción", "guion" and "cadena").
- **Remaining for CHORE-05:**
  - **The `characterCards.ts` and `processzip.ts` strings, and deleting `globalLoreBook` and `globalRegexScript`:** done in batch 5e (below).
  - **Native-speaker review:** deferred by the maintainer (`MC-212`); now low priority, for the Main Campaign session (`MC-218`).
  - **Known leftovers:** `hanuraiMemory.ts` "Required Tokens" (out of bounds); the `globalApi` toasts and `getRequestLog`
    (out of bounds); the `botpreset.svelte` "string" placeholder; `PlaygroundImageTrans` "fontSize"; `ToolConversion`
    "NOTSUPPORTED"; the ko `noBias` wording ("Bias 없음" beside `bias` "편향").

**Status (2026-10-04, UI session, translation batch 5d: the in-bounds leftovers and Spanish as a selectable UI language): committed as `c81ad3e8` (code), on the maintainer's "commit everything when ready" (the message that also asked for the merge coordination); not pushed; the ticket stays open for the follow-ups below** (ledger rows 924 to 928). The request and the five answers are the maintainer's (`MC-217`); the dispositions in `MC-217` are the Orchestrator's, not the maintainer's. The option text of every question was the Orchestrator's; the maintainer chose the "(Recommended)" option each time.
- **Done in batch 5d:**
  - 4 new keys in `en.ts` (top-level `fontSize`; `playground.notSupported`; `alerts.writingExif`; `alerts.writingPng`), translated into the six other locales.
    Reused keys: `language.name`, `language.loadingEllipsis`, `language.settingsPage.unknown` and `language.alerts.addingAssets`.
  - The leftovers from batch 5c: the preset name placeholder (`botpreset.svelte`), the "Font Size" label
    (`PlaygroundImageTrans.svelte`) and the unsupported badge (`ToolConversion.svelte`, the internal `'NOTSUPPORTED'` value is unchanged).
  - The sweep's four finds: `MobileCharacters.svelte` "Unknown", `characters.ts` `makeGroupImage` "Loading..", the two `persona.ts` wait
    texts and the legacy export in `modules.ts` (identical English).
  - **Four English text changes** (disclosed in `MC-217`): "fontSize" is now "Font Size"; "NOTSUPPORTED" is now "Not supported";
    "Loading.." is now "Loading..."; the preset name placeholder "string" is now "Name".
  - **All six `noBias` values replaced** (upstream's strings): ko 편향 없음 (was "Bias 없음"), cn 无偏置 (was "No Bias"), zh-Hant 無偏置
    (was "未設定 Bias"), vi Không có độ lệch (was "Không thiên vị"), de Kein Bias (was "Keine Voreingenommenheit"), es Sin sesgo (was "Sin Bias").
  - **The `CharConfig` Style label** class `text=neutral-200` (matched no CSS, inherited the parent colour) is now `text-textcolor`, so
    its colour follows the theme.
  - **`es` in the `translang` export list** (appended, so the existing indices are unchanged).
  - **Spanish is selectable as the app language** in the Language setting (`lang.uiLanguage`, "Español" after Tiếng Việt) and on the welcome
    screen (an "• Español" button; `es` in `usableLangs`, so a Spanish browser language auto-selects it on first run; `case 'es'` sets
    `db.translator = 'es'`). `es.ts` has existed since upstream `7944bb3d`; upstream has the same gap, so this is a **fork difference**.
- **Kept English (`MC-217`):** the image-generator parameter names (Steps, Strength, Noise, Upscaler and so on; `MC-209`), the Ooba
  parameter checkboxes, stored defaults, units, Easter eggs, plugin and CBS messages and console text.
- **Tests (9 new files, 29 tests, counting the 3 added to `CharConfig.ttsLabels.svelte.test.ts`):** `botpreset.namePlaceholder`,
  `PlaygroundImageTrans.i18n`, `ToolConversion.i18n`, `languageSettingsData.translangExport` (6), `MobileCharacters.unknownAgo`,
  `characters.makeGroupImageWait`, `persona.waitText`, `modules.legacyExportWait` and `WelcomeRisu.spanish` (4). Against `a5dfc611`,
  18 of the 29 tests fail on assertions, all of them reproducers, and the 11 guards pass: 14 in the first-pass run, the `noBias`
  reproducer (against HEAD's `ko.ts`) and the 3 Spanish reproducers (rows 925 and 927). Not covered: the welcome screen's translator
  `case 'es'` (first-setup translator for Spanish is untested).
- **Checks:** `pnpm check` 0/0; `pnpm vitest run` 387 files, 7300 passed, 4 skipped; `pnpm build` ok (row 927). Gate 1 skipped under the
  `AGENTS.md` carve-out (string swaps and one-line fixes); Gate 2 ended `[APPROVE]`, and the resumed review after the Spanish follow-up ended
  `[APPROVE]` (rows 926 and 927). Not run in a browser.
- **Merge note (`MC-179`):** the seven locale files will conflict textually with the Main Campaign branch, as in earlier batches. The Main
  Campaign tip was `d15149d8` on 2026-10-04 (`b2406e0e` and `ae8636a2` are ancestors). Main now changes `modules.ts` near lines 15, 125 to 132 and 147 to 226
  and in `importModule`; this batch's `modules.ts` hunk is line 104, so there is no overlap. The same overlap command on `botpreset.svelte`,
  `PlaygroundImageTrans.svelte`, `ToolConversion.svelte`, `CharConfig.svelte`, `languageSettingsData.svelte.ts`, `MobileCharacters.svelte`,
  `characters.ts` and `persona.ts` listed none of them, and the same command on `WelcomeRisu.svelte` lists nothing either. Re-check every batch's
  overlap at merge time, because Main keeps moving.
- **Translator low-confidence items, for the deferred native-speaker review (`MC-212`):** vi `noBias` (follows the locale's unusual "Độ lệch"),
  vi `notSupported`, de `writingPng` "(Wird geschrieben)", es `notSupported` "No compatible".
- **Remaining for CHORE-05 (status after 5d):**
  - **The `characterCards.ts` and `processzip.ts` strings, and deleting `globalLoreBook` and `globalRegexScript`:** done in batch 5e (below).
  - **Native-speaker review:** deferred by the maintainer (`MC-212`); now low priority, for the Main Campaign session (`MC-218`).
  - **Out of bounds, not done:** the `globalApi` toasts and `getRequestLog`; `hanuraiMemory.ts` "Required Tokens"; `Legal.svelte`.
  - The batch 5c "known leftovers" (the `botpreset.svelte` placeholder, "fontSize", "NOTSUPPORTED", the ko `noBias` wording) are done in this batch.

**Status (2026-10-04, UI session, translation batch 5e: the import and export texts and the two retired page keys): implemented, Gate 2 `[APPROVE]`; committed on the maintainer's word; code commit `b85ee71d`; not pushed. The UI-lane work on CHORE-05 is done. The ticket stays open for one item: the native-speaker review, LOW PRIORITY, owned by the Main Campaign session (`MC-212`, `MC-218`).** Ledger rows 929 to 931. The three rulings and the review hand-off are the maintainer's (`MC-218`); the option text of each question was the Orchestrator's; the dispositions in `MC-218` are the Orchestrator's.
- **Base:** `feat/ui-batch` was fast-forwarded (`git merge --ff-only`) from `cc30ebc0` to the Main Campaign's tip `7ff0d092` on the maintainer's word (`MC-218`), after the Main Campaign session confirmed that parallel work was fine. Main merged `feat/ui-batch` as `c9c57c9e` and then committed `cd26764d`, `cdf700f3` and `7ff0d092`. Main's 6a and 6b commits touched `characterCards.ts` but not `processzip.ts` or `src/lang`.
- **Done in batch 5e:**
  - 12 new keys in `en.ts`, contiguous at the end of `errors` (`importAssetNotFound`, `noImageInZip`) and `alerts` (`readingCard`, `loadingAssets`, `loadingEmotions`, `loadingVits`, `addingEmotions`, `addingAdditionalAssets`, `addingVits`, `addingCardAssets`, `downloading`, `savingAssets`), translated into the six other locales. Reused keys: `alerts.writingPng` (the card export's "Loading... (Writing)") and `errors.moduleAssetsSaveFailed` (the CharX import's "Failed to save N assets").
  - `characterCards.ts`: 19 sites now use `language.*` or `fillLang`. `processzip.ts`: `noImageInZip`, `savingAssets` and `moduleAssetsSaveFailed` (through `fillLang`).
  - **`globalLoreBook` and `globalRegexScript` deleted** from all seven language files (the pages were retired in `408c32dd`; no reader of either key in `src`, row 929).
  - **Two English text changes** (disclosed in `MC-218`): the export label "CharX Embeded Jpeg" is now "CharX Embedded Jpeg" (this changes the default web download filename of CharX JPEG exports; the `embeded://` scheme is untouched), and the V3 import's last progress text "Loading... (Assets)" is now "Loading... (Loading Assets)", the same key as the PNG import. The other export file-type labels stay English.
- **Kept English (`MC-218`):** stored defaults ("Chat 1", "unknown name", "Imported VITS", "... Module", `asset_N`), the server `res.text()` pass-through, caught errors, console text, and the `processzip.ts` "size" cause (never displayed).
- **Tests (1 new file, 30 tests):** `characterCards.localizedTexts.test.ts`. With `HEAD`'s `characterCards.ts` and `processzip.ts`, 15 reproducers fail on assertions and 15 guards pass (rows 930 and 931). Not covered: `addingEmotions` and `addingAdditionalAssets` (`createBaseV2` never fills emotions or additional assets, so the public export cannot reach them), the non-ko locales, and the native dialog.
- **Checks:** `pnpm check` 0/0; `pnpm vitest run` 419 files, 8257 passed, 4 skipped; `pnpm build` ok (row 930). Gate 1 skipped; Gate 2 ended `[APPROVE]` and judged the skip justified (row 931). Not run in a browser.
- **Merge note:** Main will change the value of `backupLoadWorkInProgress` in all seven locales (CHORE-82); that key is not adjacent to this batch's locale hunks (the Orchestrator checked). Main's next work (module archiving) will add one contiguous key block to `src/lang`, and this batch keeps its keys contiguous for that reason.
- **Translator low-confidence items, for the native-speaker review (`MC-212`):** ko 다운로드하는 중... and "추가 에셋 추가 중"; cn and zh-Hant 导入 / 匯入 phrasing in `importAssetNotFound`; vi "Đang tải xuống..."; de "Medium {key}" and "Medien werden gespeichert"; es "imágenes de emoción".
- **Remaining for CHORE-05 (status after 5e):**
  - **Native-speaker review (`MC-212`): LOW PRIORITY.** The maintainer said to write it down as low priority and do it later in the Main Campaign session; Main agreed. The Roadmap entry stays here; the UI lane does not run it.
  - **Out of bounds, not done:** the `globalApi` toasts and `getRequestLog`; `hanuraiMemory.ts` "Required Tokens"; `Legal.svelte`.
  - Nothing else in the UI lane.

**Status (2026-09-22):** the 9 save-conflict keys below are translated into all six locales
(`0291ea36`; `ko` reviewed by the maintainer, the other five are model translations). The table
below is the pre-fix measurement and is otherwise still current.

**Items added by the UI session (2026-10-03):** from the Playground and modules batch (`MC-207`): the two module language keys
`moduleContent` and `confirmRemoveModuleFeature` have no consumers (CHORE-12 MOD-4); the Playground's Prompt Conversion and
Embedding pages have hard-coded English labels and two hard-coded English error messages (CHORE-16 PG-2 and PG-4). These are
added to this ticket's scope.

**(Superseded 2026-10-03: the consent keys are translated in all six locales; see the status block above.)**
**Next priority — the plugin permission consent prompts (verified 2026-09-22).** The seven V3
consent strings shown by `getPluginPermission` (`src/ts/plugins/apiV3/v3.svelte.ts:614-622`;
keys at `src/lang/en.ts:1622-1628`) are the dialogs where a user decides whether a plugin may read
the whole database, touch the main DOM, send chats and so on. Coverage by locale:

| Key | Missing from |
|---|---|
| `fetchLogConsent`, `getFullDatabaseConsent` | `ko` |
| `mainDomAccessConsent` | `ko`, `es` |
| `replacerPermissionConsent`, `providerPermissionConsent`, `sendChatConsent` | `ko`, `de`, `es`, `vi`, `cn` |
| `inlayPermissionConsent` | all six |

**Korean has none of the seven.** They are part of the pre-existing drift counted in the table,
not this branch's, and were not singled out before. Same shape as the 9 save-conflict keys (a
decision made under risk, rendered in English), so they go next. Related: CHORE-08 (the consent
logic itself has two bugs).

**Maintainer report:** a lot of UI, dialogs and informational text render in English regardless of
the selected language, which dilutes the localised experience.

**Why missing keys are invisible rather than broken.** `src/lang/index.ts` builds every non-English
locale as `merge(safeStructuredClone(languageEnglish), languageKorean)` (and likewise for the
others) — each locale is **deep-merged over English**. A key missing from `ko.ts` therefore does not
throw or render blank; it **silently renders the English string**. That is exactly the "shows
English regardless of language" symptom, and it is why drift accumulates unnoticed: nothing fails.

**(Superseded 2026-10-03: key drift is zero, 1668 keys in every locale before batch 1 and 1801 after; see the status block above. The table is history.)**
**Measured key drift (2026-09-21).** Read-only diff of the flattened exported key sets of
`src/lang/*.ts` against `en.ts`, loaded with Node 24's native type stripping (no build, no source
change). This replaces an earlier line-count estimate.

| Locale | Keys | Missing | Missing % | Missing **and added by this branch** | Present but identical to English |
|---|---|---|---|---|---|
| `en` (reference) | 1529 | — | — | — | — |
| `ko` | 1476 | 53 | 3.5% | 9 | 9 |
| `zh-Hant` | 1464 | 65 | 4.3% | 9 | 17 |
| `cn` | 1431 | 98 | 6.4% | 9 | 19 |
| `de` | 1431 | 98 | 6.4% | 9 | 57 |
| `vi` | 1431 | 98 | 6.4% | 9 | 29 |
| `es` | 1430 | 99 | 6.5% | 9 | 35 |

- **20 keys are missing from all six locales**, so they are English for every non-English user.
- **No locale has orphaned keys** (keys absent from `en.ts`): drift is one-directional.
- "Identical to English" counts strings that exist in the locale but are byte-identical to English
  (filtered to alphabetic strings of 4+ letters). This is an **upper bound** on untranslated
  copy-paste — some are legitimately identical (product names, technical terms). `de` at 57
  stands out.

**This campaign is itself a source of the drift — recorded plainly.** Comparing today's `en.ts`
with `origin/main`'s (`git show origin/main:src/lang/en.ts`) shows **this branch added 9 keys, and
translated none of them into any locale**:

`otherTabSavedTitle`, `otherTabSavedSaveMine`, `otherTabSavedDiscardMine`,
`otherTabSavedConflictTitle`, `otherTabSavedConflictReload`, `otherTabSavedConflictStay`,
`savingStoppedStayMessage`, `savingStoppedNodeConflictMessage`,
`savingStoppedAccountConflictMessage` (introduced in `ee16a995` and `b11ea06a`).

These are the **multi-tab and save-conflict dialogs** — shown precisely when the user's data is at
risk and they must choose correctly between "save mine" and "discard mine". Every non-English user
currently gets that decision in English. They account for 9 of the 20 keys missing everywhere; the
remaining drift (44 `ko` / 56 `zh-Hant` / 89 `cn`,`de`,`vi` / 90 `es`) predates this branch.

**Recommended priority within this chore:** translate those 9 first. It is this campaign's own
debt, it is small and bounded (9 keys x 6 locales = 54 strings), and it sits on a data-safety
path. Everything else can follow.

**Two distinct problems — do not conflate them:**
1. **Key drift** (measured above) — mechanically detectable. A CI check that diffs each locale's
   key set against `en.ts` would stop new drift, including the kind this campaign just added. The
   diff above is a ready-made prototype for it.
2. **Hardcoded English in components** — literals never routed through `language.*` at all.
   **Not measured yet, and invisible to the diff above**, because they never enter any locale
   file. Needs a sweep of `src/lib/**/*.svelte` for user-visible string literals. Likely the larger
   half, and what makes the app feel English-only even where a locale file is complete.
   **Concrete example (CHORE-15, 2026-09-22):** TTS-4's ElevenLabs API-key hint
   (`src/lib/SideBars/CharConfig.svelte:792`) is a hardcoded, unlocalized string — one instance of
   exactly this category.

Note `src/lib/Others/Legal.svelte` deliberately carries multi-language text inline and must not be
"fixed" into a single locale.

### CHORE-06 — `console.log` of whole-save objects may pin them in memory for the session

Found by the memory investigation on 2026-09-21 (ledger row 14). **Source-verified, and measured in
Node; in-browser retention is inferred, not proven.**
- **Call sites** that pass very large objects to the console:
  - `console.log('blocks', this.blocks)` at `risuSave.ts:641`. The array later also receives
    remote-block contents (`:777-782`), so the log holds the whole save as strings.
  - `console.log('Decoded RisuSave data', db)` at `risuSave.ts:824`.
  - `console.log(decoded)` at `bootstrap.ts:171`.
  - `console.log("setting cold storage item", key, value)` at `coldstorage.svelte.ts:151`, where
    `value` is the full character being evicted.
- **Node measurement:** V8 retains `console.log` arguments whenever an inspector exists, even with no
  client attached. A 96 MB object stayed pinned until about 1000 further log lines had been written,
  and was not retained without an inspector.
- **Why the browser case is likely:** Chromium always creates a V8 inspector. That supports the
  inference but does not prove it.
- **Measure first:** in the live app, compare heap size after a forced GC before and after
  `console.clear()`.
- **Now measured in Chromium (2026-09-21, ledger row 16).**
  - **Setup:** headless Chrome 154 with no Runtime, Console or Log domain enabled, which is how a
    tab with DevTools closed looks to Chromium.
  - **Retention:** after a `console.log` of a ~95 MB object graph, **95.5 MB stayed retained**
    after every reference was dropped and three GCs had run. The control without the log retained
    0.06 MB.
  - **Release:** `console.clear()` released it, and so did about 1000 further `console.log` calls.
    That matches Blink's console-message storage cap.
  - **Consequence:** a big object stays pinned until roughly 1000 more lines have been logged.
- **What that means per call site.** Only logs of objects that would otherwise be freed matter:
  - `:824`'s `db` is the live database, which is resident anyway.
  - The decoder's `this.blocks` strings at `:641` and `bootstrap.ts:171`'s `decoded` are extra
    copies of the save.
  - `coldstorage.svelte.ts:151`'s `value` is the character that cold storage is trying to evict.
    Pinning it defeats the eviction.
- **Still open:** how many log lines a typical session produces after boot, which decides how long
  these stay pinned.
- **Fix, if confirmed:** small and low-risk — log sizes and counts, not objects.

### CHORE-07 — A transient cold-storage read failure permanently orphans a chat (DATA LOSS, reproduced)

**Status 2026-09-21:** stage 7a (stop deleting: startup asset sweep and manual cleanup) is **committed `c66c9f4b`** (Report 13 §2; gates ledger 29/33/34). Stage 7b's minimal core (a failed load changes nothing, send guards, a failure notice) is **committed `3e17c8a3`** (gates ledger 39/40). Stage 7c-1 (telling missing data from read errors, the firm missing-data notice, plugin storage rejecting on failure, the plugin `sendChat` guard, and the character-switch restore race) is **committed `be3633bd`** (gates ledger 41/42; live check ledger 43). Stage 7c-2 (a Retry for chats that already show the pre-7b error text, with a hypa-aware side-field merge, and no longer re-cold-storing such chats) is **committed `4a4dfae1`** (Report 13 §5.3 rev 7; gates ledger 44/45; live check ledger 46).

**A second loss path, reproduced 2026-09-21 (ledger 22), which deletes ASSET FILES.** Startup
`cleanChunks` (`bootstrap.ts:292` → `:576-589` Tauri, `:645-654` web) deletes every asset that
`getUncleanables` does not list. For a cold-stored character, `getUncleanables` needs a
successful cold read to see its emotion images and additional assets. After one failed read,
those files are **deleted**, while the blob stays intact.
- **Affected:** anyone with cold-stored characters and the cold-storage **setting** off.
- **Likely explains** some "images going missing" reports.
- **Fix plan:** `Agents/Reports/13-chore07-cold-read-failure-plan.md` §3.4.

**Seen in the wild (maintainer, 2026-09-21):** old user reports exist of this exact
`[Cold storage data could not be loaded...]` text. Cold storage defaults to on only for installs
that had no plugins at first load, so the affected population is mostly plugin-free users.

Found by the memory investigation on 2026-09-21 (ledger row 14). **Reproduced end to end the same
day (ledger row 15)** by `Agents/Tools/save-gen/cold-storage-orphan-repro.svelte.harness.ts`, which
drives the real `coldstorage.svelte.ts`, `registerDbChangeEffects()` and the RisuSave encoder/decoder.
- **Setup:** one read throws; the blob is still present.
- **What was observed, in order:**
  - `getColdStorageItem` returns `null`, and a retry right after returns the real payload.
  - `preLoadChat` overwrites the chat with the error message.
  - `markChanged` fires.
  - The decoded save holds the error string.
  - A later `preLoadChat` is a no-op, because the pointer header is gone.
  - `cleanColdStorage()` then **deletes the still-intact blob**.
- **Control:** a genuinely missing blob produces the same error message, so the user cannot tell
  the two cases apart.
- **Branches:** the reproduction exercised the web (OPFS) branch. Source shows the same
  catch-everything-and-return-`null` in the Node-server (`:61-73`) and Tauri (`:74-84`) branches.
- **Account branch (source-inferred, not reproduced):** any non-200 hub response falls back to
  local, and returns `null` if the data isn't local. This path depends on selection, like CHORE-01
  and CHORE-03: the overwrite persists only while that character is selected.
- **Corrected ranges:** `getColdStorageItem` spans `:40-105`; `cleanColdStorage` spans `:244-262`;
  the referenced-key logic lives in `coldstorageData.ts:64-97`.

The rest of this entry is the original source trace, kept for its line references:
- **What happens on a failed read:** `getColdStorageItem` swallows every error and returns `null`
  (`coldstorage.svelte.ts:74-104`). `preLoadChat` then treats `null` as "missing or corrupted" and
  overwrites the chat's messages with an error message (`:650-661`).
- **Why the loss persists:** that overwrite is an ordinary mutation of the selected character, so it
  is saved and the cold pointer is gone from the live data. The key survives only as text inside the
  error message.
- **How the blob would then be deleted (inferred):** a later manual `cleanColdStorage`
  (`:244-257`, triggered from `UserSettings.svelte:95`) deletes blobs that no pointer references. It
  would then delete the still-intact blob.
- **Scope:** whole-character restore is safe (`characters.ts:893-901` alerts and keeps the stub).
- **Next step:** reproduce the failure against unfixed code first, as with CHORE-03, then separate
  "not found" from "read failed".
- **Relevance:** this campaign targets exactly the "sudden data loss" that 1000+-character users
  report.

### CHORE-08 — Plugin permission consent: session cache ignores the permission kind, and the provider prompt is not enforced

Found while rewriting the plugin wiki pages (2026-09-22); both verified by the Orchestrator in
source. Present upstream too (not fork-introduced). The hosted build is private, so frame this as
consent that does not do what it says, not as a security hole.

1. **The in-session cache is keyed by plugin name only.** `getPluginPermission`
   (`src/ts/plugins/apiV3/v3.svelte.ts:581-638`) returns early from `permissionGivenPlugins` /
   `permissionDeniedPlugins` (`:568-569`, checked at `:582-587`), which hold plugin **names**. Once
   the user grants any one permission, every other kind that plugin asks for later in the session
   is granted without a prompt, and the `reconfirm` / `'periodically'` (3-day) re-confirmation is
   skipped. One denial likewise denies every later kind. The persistent `localforage` record is
   correctly per kind (`pluginHash + '_' + permissionDesc`); only the session cache is wrong.
2. **The provider consent result is discarded.** `addProvider`'s wrapper
   (`v3.svelte.ts:701-706`) awaits `getPluginPermission(plugin.name, 'provider', 'periodically')`
   but never checks the boolean, so the provider runs even when the user declines.

**Compatibility note:** fixing either makes prompts appear where users now get silent approval.
Decide the UX (key the cache by name + kind; on a declined provider, fail the request with a
visible error) with the maintainer before implementing. Translations of the prompts: CHORE-05.

### CHORE-09 — Scripting, regex and lorebook bugs found during the wiki rewrite (none lose data)

**Status (2026-10-03, UI session): items 1, 3, 5 and 6 DONE 2026-10-03 in `e10cbbbd`** (ledger
rows 869 to 877). Product choices in `MC-208`. The investigator (row 870) refuted the premise below: `scriptings.ts` and
`triggers.ts` are no longer identical to upstream. The Orchestrator verified items 2, 5 and 6 in source.
- **Item 1 (`runAxLLM`), done and fork-only.** `triggers.ts` handles `runAxLLM` in the same `case` as `runLLM`, and it calls
  the model with the mode `'otherAx'` (the Lua `axLLM`'s default mode; "Other auxiliary", `MC-208`). Upstream has the effect's type and
  editor entry only (commit `fb941148`) and no runtime (row 871). It still does nothing without `lowLevelAccess`.
- **Item 3 (nesting cap), done.** The new `src/ts/process/triggerLimits.ts` holds `NORMAL_NESTED_TRIGGER_LIMIT` = 10 and
  `LOW_LEVEL_NESTED_TRIGGER_LIMIT` = 50. `runtrigger` and `v2RunTrigger` in `triggers.ts` and `/trigger` in `command.ts` use
  them; `/trigger` was a third uncapped site (row 871), and `command.ts`'s own `NESTED_TRIGGER_LIMIT` is removed. A nested run
  beyond the limit is skipped and the run that asked for it continues. Measurement (Node and Vitest, cap removed, synchronous
  self-call; row 874): `RangeError` at about 367 levels for `runtrigger` and `v2RunTrigger` and about 289 for `/trigger`.
  The value follows the Orchestrator's rule (1000 if at most a quarter of the smallest measured depth, else the largest round
  number at most a quarter, here a quarter of 289 is about 72, so 50). A `RangeError` inside `runTrigger` is not caught.
  **Consequences, disclosed in `MC-208` and not answered separately by the maintainer:** (a) the counter is per run and cumulative
  over sequential calls, so a low-level run that starts more than 50 nested runs in sequence has the later ones skipped (at
  HEAD low-level runs were unlimited; normal runs already had the cumulative cap of 10); (c) two self-calls per level are
  bounded in depth, not in total work; (d) 50 was measured on Node and Vitest stacks, and browser and mobile stacks may be smaller.
- **Items 5 and 6 (move scripts), done.** `scripts.ts` and `translator.ts` no longer strip `g` for `@@move_top`,
  `@@move_bottom` and the `<move_top>` and `<move_bottom>` flags. Every match moves; `move_top` ends with the last match on
  top and `move_bottom` keeps source order. `scripts.ts` resets `reg.lastIndex` before collecting the matches, because the
  earlier `reg.test` advances it on a global regex (keeping `g` alone would have lost the first match; row 871). The outputs
  are collected and joined once. `$<name>` in the move output now resolves: a participating group (an empty one too) gives its
  text, a regex with named groups where this one did not participate gives `''`, and a regex with no named groups leaves it
  literal, as `String.replace` does. The script with the flag box off defaults to `g` and now moves every match; this was put to
  the maintainer before the choice ("Yes, honour g", `MC-208`). **(b)** In the translator (edittrans) engine, a flag text made
  only of tags (`<cbs>`, `<order 1>`, `<move_top>`) with the flag box on is now `g` instead of `'u'`, as in `scripts.ts`; this
  affects plain replace scripts too (one existing test's flag changed from `<cbs>` to `z<cbs>` to keep testing the `'u'` fallback).
- **Item 2, already fixed on the fork:** `setDescription` checks `desc` (row 870). **Item 7:** what remains is the no-subject
  fallback (the selected character), which belongs to the Main Campaign's origin plumbing; the subject path already resolves
  the owner. **Item 8:** moot after CHORE-14 (the Global Regex page is retired). **Items 4, 9, 10 and 11:** left; fixing them would
  change what upstream cards do (Orchestrator's disposition, not the maintainer's).
- **Tests:** `src/ts/process/tests/scriptsMove.test.ts` (new: 10 "regression reproducer:" and 3 "guard:" tests),
  `src/ts/process/tests/triggerNestingLimit.test.ts` (new: 3 reproducers, 3 guards, one pair per flavour: `runtrigger`,
  `v2RunTrigger`, `/trigger`), `src/ts/translator/edittransRegex.test.ts` (extended; 24 tests after the change), and
  `src/ts/process/tests/requestOrigin.svelte.test.ts` (extended: three `runAxLLM` reproducers and one guard). Against HEAD's
  sources, through scratch `load()` configs: `scriptsMove` 10 of 13 fail; `triggerNestingLimit` 3 of 6 ("expected 150 to be
  51"); `edittransRegex` 7 of 24; `requestOrigin` 3 of 108; removing only `reg.lastIndex = 0` makes 9 of 13 `scriptsMove`
  tests fail with the first match lost (row 874). Gate 2 re-ran them (row 876). Checks are those in CHORE-13's entry (row 875).
- **Merge note (`MC-179`):** `triggers.ts`, `command.ts`, `scripts.ts` and `translator.ts` were heavily changed by the Main
  Campaign, so **merge conflicts are likely in all four.**
- **Wiki hand-offs (for the Wiki session; `docs/wiki` was not edited):** `docs/wiki/Trigger-Script.md` line 87 says `runAxLLM`
  "does nothing" (it now calls the other auxiliary model with low-level access) and line 95 contrasts the V2 effects with "V1's
  `runAxLLM`"; line 46 says there is "no depth cap" with low-level access (now 50, counted per run and cumulative, and `/trigger`
  is capped the same way), and lines 76 and 123 refer back to that note. `docs/wiki/Regex-Script.md` line 107 and line 112 say
  only the first match moves (every match moves now); line 95 says `$<name>` does not work in move output; line 106 says
  `@@inject` "always targets the currently selected character" (stale where a subject is passed; item 7); line 20 is the stale
  Global Regex note (CHORE-14). `docs/wiki/@-Syntaxes.md` line 46 says `g` is dropped for the move directives, and line 61 that
  `$<name>` does not work. Line numbers were read from the wiki files on 2026-10-03.

Found by the documentation agents on 2026-09-22. All are upstream behaviour (`scriptings.ts` and
`triggers.ts` are identical to upstream). Items marked **verified** were checked by the
Orchestrator in source; the rest are the agents' traces, to be confirmed before fixing. The wiki
documents current behaviour, so a fix must also update the matching wiki page.

| # | Area | Bug | Evidence | Status |
|---|---|---|---|---|
| 1 | Triggers | The V1 `runAxLLM` effect is offered by the editor (`TriggerV1Data.svelte`) but the interpreter has no `case` for it, so it silently does nothing. | `src/ts/process/triggers.ts:164-168` | verified |
| 2 | Lua | `setDescription(id, desc)` type-checks `data` (the outer `runScripted` argument) instead of `desc`. | `src/ts/process/scriptings.ts:687` | verified |
| 3 | Triggers | With `lowLevelAccess`, nested run-trigger calls have no depth cap (normally 10), so a self-calling trigger can hang the tab. | `triggers.ts:1406` | verified |
| 4 | Triggers | The deprecated V2 lorebook effects (`v2ModifyLorebook`, `v2GetLorebook`, `v2GetLorebookEntry`, `v2SetLorebookActivation`, `v2GetLorebookIndexViaName`) index `globalLore` entries as tuples (`v[0]`, `entry[1]`), but entries are `loreBook` objects, so they never match. Only `v2GetLorebookCount` works. | `triggers.ts` (agent trace) | unverified |
| 5 | Regex | `$<name>` named-group references inside `@@move_top` / `@@move_bottom` output are never substituted (`parseInt()` on the group name). Same in the translation regex path. | `src/ts/process/scripts.ts:231-237`; `src/ts/translator/translator.ts:736-742` | unverified |
| 6 | Regex | `@@move_top` / `@@move_bottom` strip the `g` flag (a comment calls it a "temporary fix"), so only the first match moves. | `scripts.ts` (agent trace) | unverified |
| 7 | Regex | Regex `@@inject` always writes to the currently selected character, whichever character or group the script belongs to. | `scripts.ts` (agent trace) | unverified |
| 8 | Regex | Settings → "Global Regex" (`db.globalscript`) is never read by the script engine; it is only an import/export staging list. The effective global list is the preset's (`db.presetRegex`). Possibly intended; confirm with the maintainer before calling it a bug. | agent trace | unverified |
| 9 | Lorebook | "Case Sensitive" is stored and round-tripped but has no runtime effect; matching is always lowercased. | `src/ts/process/lorebook.svelte.ts` (agent trace) | unverified |
| 10 | Lorebook | `@@inject_lore` merges run after the token-budget cut, so a merge into a dropped entry is lost and the merge is not counted against the budget (a source comment acknowledges the count). | `lorebook.svelte.ts` (agent trace) | unverified |
| 11 | Lorebook | Regex-key mode is all-or-nothing: one key that is not `/regex/flags` makes the whole entry fail to match. | `lorebook.svelte.ts` (agent trace) | unverified |

Not bugs, recorded so nobody "fixes" them: a whole-script Lua trigger ignores its `type` field and
runs on every pass, and for manual runs its entry-point name is the trigger's name (documented on
the wiki). `{{declare::name}}` sets a flag nothing reads (the wiki marks it unverified). The
Pyodide `type: 'py'` path in `runScripted` has no caller.

**Priority:** below CHORE-01/03/07. Items 1 and 3 are the cheapest; item 7 is the only one that
writes to the wrong character.

### CHORE-10 — Long-term memory (HypaMemory v1/V2/V3, SupaMemory, Hanurai): 21 suspected bugs

Found by the wiki session while documenting the memory systems (2026-09-22). Full hand-off, with
per-bug evidence, status and suggested investigation: **`Agents/Reports/99-long-term-memory.md`**.
Every entry is a code-reading claim; none has been reproduced. Whether each is upstream behaviour
has not been checked.

**Why it matters to this campaign:** several entries corrupt data that is **saved** (the memory
store persists with the chat), so they are silent, permanent loss of the kind this fork targets,
not just prompt quality.

| Group | IDs | Status in Report 99 |
|---|---|---|
| **Persistent loss or corruption of saved memory** | V2-1 (a failed summary batch is skipped, and a later success persists a permanent gap), V3-4 (hidden messages may make summaries look orphaned, so they are deleted), V3-2 (a non-contiguous merge can move V3's resume point back and duplicate memory) | V2-1 reviewer-confirmed; V3-4 and V3-2 need repro |
| **Wrong prompt content every request** | HAN-1 (the "still in prompt" skip never matches: `substring(16)` against a 17-character prefix, so retrieval duplicates context), V2-2 (index-0 skip assumes the NewChat marker; example turns are summarised as story, or the first message is dropped), V2-3 (the summary section keeps the oldest summaries and drops the newest) | reviewer-confirmed |
| **Unrecoverable errors** | SUPA-3 (deleting the resume message breaks SupaMemory permanently), V3-1 (the rate limiter throws for concurrency > RPM, which the UI allows), SUPA-5 (legacy davinci/curie values call retired models) | unverified |
| **Budget and accounting** | SUPA-1, HAN-2, V2-4, TOK-1 | mixed |
| **Low / cosmetic / dead code** | V2-5, SUPA-2, SUPA-4, V3-3, V3-5, SHARED-1, SHARED-2, UI-1 | mostly unverified |

- **Orchestrator spot check (2026-09-22):** HAN-1 confirmed in source
  (`src/ts/process/memory/hanuraiMemory.ts:33,37` build `` `search_document: ${…}` ``, 17
  characters; `:76,83,90` use `.substring(16)`). V2-1's failure branch
  (`src/ts/process/memory/hypav2.ts:495-508`) `continue`s with no rollback, as described.
- **Priority:** the persistent-loss group (V2-1, V3-4, V3-2) ranks with CHORE-03/07, after
  CHORE-01. Start with a repro of V3-4 (it may delete saved summaries on an ordinary action:
  hiding a message) and a red test for V2-1 (a summarizer that fails once, then succeeds). HAN-1 is
  a one-line fix with a clear test. The rest can follow in one batch.
- **Wiki coupling:** the wiki's Long Term Memory page documents current behaviour; a fix must update
  it too.

### CHORE-11 — Character display (emotion images, image generation): 5 suspected bugs

**Status (2026-10-03, UI session):** CD-4 was already fixed on 2026-09-24 as `910b07de` (ledger row 163; `MC-076`,
`MC-077`); this entry had not been updated. CD-3 is fixed and committed in `e9a80ec5` on 2026-10-03 (new label key `emotionInstructions`;
Gate 2 [APPROVE], ledger row 801). CD-1, CD-2 and CD-5 remain open, deferred to
the small-items batch (ledger row 800; CD-5's field is declared in `src/ts/storage/database.svelte.ts`, outside the UI
lane under `MC-179`).

**Status (2026-10-03, UI session, small-items batch): CD-1 and CD-2 DONE 2026-10-03 in `e10cbbbd`;
CD-5 closed without code** (ledger rows 869 to 877). The paragraph above is kept as written; this one supersedes its "remain open".
- **CD-1, done.** No code produces `special.emotion` (row 869). The block that read it in `index.svelte.ts` and the three
  `special?: { emotion?: string }` fields of `requestDataResponse` in `request/request.ts` are removed.
- **CD-2, done.** The `waifuMobile` branch and the `.per33` CSS in `ChatScreen.svelte` are removed. The theme cannot be selected
  from the UI, but an old upstream save can still hold `'waifuMobile'` (row 869); with the branch gone, such a save falls to
  the final `{:else}` layout of `ChatScreen.svelte` (read from the diff; not run).
- **CD-5, closed without code.** The field is not dead: boot and backup code write and read `groupChat.emotionImages`
  (`characterDefaults.ts`, `bootstrap.ts`, `globalApi.svelte.ts`, `drive/backuplocal.ts`; the Orchestrator's disposition,
  with `characterDefaults`' line spot-checked, row 869). The field is declared at `database.svelte.ts:1533`, outside the UI lane.
  It is part of the saved data, so it stays for the round trip (`MC-175`).
- **Merge note (`MC-179`):** `ChatScreen.svelte`, `index.svelte.ts` and `request/request.ts` are on neither lane list, as for
  the TTS batch; `index.svelte.ts` was also edited by the TTS batch. Stale citation from the original entry: CD-1's block in
  `index.svelte.ts` was at lines 2550-2574 at HEAD, not where the report put it (row 869).

Found by the wiki session while rewriting the [[Additional Character Screen]] wiki page
(2026-09-22). Full hand-off, with per-bug evidence, status and suggested investigation:
**`Agents/Reports/99-character-display.md`**. Every entry is a code-reading claim; none has been
reproduced.

**Why it matters to this campaign:** CD-4 can silently overwrite a character's saved emotion/
image-gen prompts (`newGenData`) with mode defaults whenever the mode or Inlay Screen toggle
changes, discarding hand-edited text with no warning and no way back — a real, if narrow, path to
losing saved character data. The other four (CD-1, CD-2, CD-3, CD-5) are dead code, an unreachable
UI branch, or a cosmetic label; none touch saved data.

| Group | IDs (gist) | Status per Report 99 |
|---|---|---|
| Silent loss of saved prompt data | CD-4 — toggling the emotion/image-gen mode or Inlay Screen overwrites hand-edited prompts with mode defaults | Reported |
| Dead or unreachable code | CD-1 — the `special.emotion` response path nothing ever sets; CD-2 — the `waifuMobile` theme branch can't be selected; CD-5 — `groupChat.emotionImages` may never be read | CD-1, CD-2 Orchestrator-confirmed; CD-5 Reported (not searched exhaustively) |
| Cosmetic UI mismatch | CD-3 — the emotion Inlay Screen box is labelled "Image Generation Instructions" | Orchestrator-confirmed |

- **Spot check (doc-writer, 2026-09-22):** CD-4 confirmed in source. `updateInlayScreen()`
  (`src/ts/process/inlayScreen.ts:52-96`) unconditionally replaces `char.newGenData` with a fixed
  literal for the current `viewScreen`/`inlayViewScreen` combination; it never checks whether the
  existing fields already hold custom text. It is called directly on
  `DBState.db.characters[$selectedCharID]` from `src/lib/SideBars/CharConfig.svelte:476,558,575`
  (the mode/Inlay Screen controls) and from `src/ts/characters.ts:622`, so the overwrite lands on
  the saved character. Matches the report.
- **Priority:** low relative to CHORE-01/03/07/10's persistent-loss groups — this needs a user to
  actively change the mode or Inlay Screen setting, not an ordinary save/reload path. Cheap once
  picked up: only fill a default when the field is empty, per the report's own suggestion.
- **Wiki coupling:** per the report, the wiki page already documents both quirks — it warns users
  about CD-4's prompt reset and mentions CD-3's shared label. If either is fixed, update the page to
  match the new behaviour.

### CHORE-12 — Modules: 6 suspected bugs (none lose data)

**Status (2026-10-03, UI session): MOD-2 and MOD-6 DONE 2026-10-03 in `0d41f06a`** (ledger rows
861 to 868; the same commit as CHORE-16 PG-2 to PG-4). Product choices in `MC-207`. MOD-1 is **not done**, by the maintainer's
decision. MOD-3 is left, MOD-4 goes to CHORE-05 and MOD-5 stays open. The investigator (row 861, the Orchestrator's summary)
found: MOD-1 is upstream behaviour (upstream `0055f0cb`; the same code at upstream/main `f9728b14`) and neither app has a
UI or in-repo code path that creates the embedded module (a plugin's database write or a `.bin` restore can still bring it
in, not traced); MOD-6 was partly refuted (`RegexData` bumps `ReloadGUIPointer` on name, type and OUT edits;
the IN field and lorebook, trigger and asset edits do not); MOD-2 holds, and order matters for regex, triggers and toggles.
- **MOD-1, not done.** Gate 1 round 1 (row 863, B1) found that applying the persona's embedded module would also connect
  its MCP (`internal:fs`, `internal:risuai`, `plugin:`, and `stdio:`, which launches a local process on desktop) and stamp its
  own `lowLevelAccess` on its Lua triggers, with no consent step (ordinary module imports ask through `lowLevelAccessConfirm`).
  The maintainer chose "Back out: leave it inert" and asked for it to be parked as QOL-10 in `Agents/Maybe-Later.md`
  (`MC-207`). `modules.ts` is unchanged; the module's data is still kept.
- **MOD-2:** the Modules settings list (`ModuleSettings.svelte`) and the chat's module picker (`ModuleChatMenu.svelte`) show
  `db.modules` in array order; the name sorts are removed and the search still filters. `db.modules` is never reordered. The
  order modules apply in is the storage order, and it is **not user-controllable**: a new module appends and there is no
  reorder UI. The lists now match it.
- **MOD-6:** closing the module editor refreshes the open chat once. The editor is `ModuleSettings` mode 1 (create) or 2
  (edit). Both buttons now close through one function that sets the mode to 0 and bumps `ReloadGUIPointer` once; destroying
  the component while an editor is open (leaving Settings) bumps once; destroying it with no editor open does not. There is
  no per-keystroke bump, and `trackModuleUpdateDeps`, `moduleUpdate` and the `stores.svelte.ts` effect are unchanged.
- **MOD-3:** left. `RisuModule.cjs` is declared and carried as data (the investigator's finding), so it is left; this is the
  Orchestrator's disposition, not a maintainer decision.
- **MOD-4:** the keys `moduleContent` and `confirmRemoveModuleFeature` are unused in 7 files. They are left for CHORE-05.
- **MOD-5:** open. An icon editor is a new feature.
- **Tests:** two new files and one updated. `ModuleSettings.order.svelte.test.ts` (6 reproducers: the list order, and the
  create and edit button closes, each destroy while open, and button-then-destroy giving one bump in total; 3 guards) and
  `ModuleChatMenu.order.svelte.test.ts` (2 reproducers, 2 guards). `ModuleSettings.deleteTarget.svelte.test.ts` gains a
  `ReloadGUIPointer` mock, and its fixture comment now says the list shows array order; Gate 2 noted that one test had stopped
  inserting above its target, and the Orchestrator restored that (row 867). At HEAD, in Gate 2's scratch run, exactly the 8
  "regression reproducer:" tests of the two new files fail and every guard and the `deleteTarget` suite pass. The MOD-6 tests
  use a plain `writable`, so the `onDestroy` teardown's safety rests on reasoning, not a test. Checks are those in the
  CHORE-16 entry (row 866). Not live-checked.
- **Merge note (`MC-179`):** `ModuleSettings.svelte` and `ModuleChatMenu.svelte` are on neither lane list (`MC-179` 1 names
  `ModuleMenu.svelte` only, which is untouched). **Flag for the merge:** MOD-6 adds one `ReloadGUIPointer` bump per editor
  close, and that pointer is CHORE-04's mechanism, which stays with the Main Campaign; check the two together.
- **Wiki hand-off (for the Wiki session; `docs/wiki` was not edited):** `docs/wiki/Modules.md`'s "Order" section (line 63)
  says the Modules settings list "sorts by name", which is no longer true: both lists show the stored order, which is also the
  order active modules apply in. Line 143 documents MOD-1 (the embedded module is not applied to chats); that stays true.

Found by the wiki session while writing the [[Modules]] wiki page (2026-09-22). Full hand-off, with
per-bug evidence, status and suggested investigation: **`Agents/Reports/99-modules.md`**. MOD-1 and
MOD-2 also had a doc-verifier pass on the wiki page itself; the rest are the agent's own trace.

**Why it matters to this campaign:** none of the six lose or corrupt saved data. MOD-1's persona-
embedded module has no effect on chats, but the report confirms its assets are still protected from
cleanup, so the data itself survives — it is inert, not lost. The rest are dead code, a display-order
mismatch, a missing editor control, or a GUI-refresh lag; none touch what's saved.

| Group | IDs (gist) | Status |
|---|---|---|
| Feature silently inert (no data loss) | MOD-1 — a persona's embedded module (lorebook, regex, triggers, assets) is never applied to chats, though its data is kept | Reviewer- and Orchestrator-confirmed |
| Design/UX gap | MOD-2 — modules merge in storage order, but the settings list displays them sorted by name; MOD-5 — `RisuModule.icon` has no editing UI | MOD-2 Reviewer- and Orchestrator-confirmed; MOD-5 Reported |
| Dead code / unused fields | MOD-3 — `RisuModule.cjs` is declared but never read; MOD-4 — two module strings in `src/lang` have no consumers | Orchestrator-confirmed |
| GUI doesn't refresh after edit (saving unaffected) | MOD-6 — editing a module's lorebook, regex, triggers or assets doesn't bump `ReloadGUIPointer`, so an open chat may keep showing stale rendering | Reported; the narrowing is intentional per a source comment |

- **Spot check (doc-writer, 2026-09-22):** MOD-1 confirmed in source. `getModules()`
  (`src/ts/process/modules.ts:398-427`) appends `persona.embeddedModule.id` (normally `'$embedded'`)
  to `ids`, then calls `getModuleByIds(ids)` (`:374-381`), which only filters `db.modules` — the
  persona's embedded module never lives there. `getModuleById()` (`:357-372`) is the only function
  that special-cases the `'$embedded'` id back to `persona.embeddedModule`, and `getModules()` never
  calls it. Matches the report exactly.
- **Priority:** MOD-1 is the only Medium-severity entry here and is worth picking up first among
  these six, but it still ranks behind CHORE-01/03/07/10's data-loss groups since nothing is lost.
  **See CHORE-04** (module enable/disable freeze) for a related but distinct mechanism: that chore
  is about `ReloadGUIPointer` firing too often on a toggle; MOD-6 here is the opposite-direction
  problem, that content edits don't fire it at all. Read both before touching that pointer.
- **Wiki coupling:** the Modules wiki page documents MOD-1 and MOD-2 as current behaviour (per
  Report 99); a fix to either must update the page.

### CHORE-13 — Prompt template: 2 suspected bugs (none lose data)

**Status (2026-10-03, UI session): PT-1 DONE 2026-10-03 in `e10cbbbd`; PT-2 closed without code**
(ledger rows 869 to 877). The Orchestrator's dispositions, not maintainer decisions (`MC-208`).
- **PT-1, done.** `tokenizePreset()` in `prompt.ts` no longer counts `innerFormat` for `lorebook` and `postEverything` items.
  The investigator (row 869) confirmed that the prompt-build side never applies it for those two types and that the editor
  (`PromptDataItem`) shows `innerFormat` only for persona, description, authornote and memory items; PT-1 is upstream
  behaviour. **Not changed, a pre-existing undercount noted at Gate 1:** `postEverything`'s `promptSettings.postEndInnerFormat`
  is not counted either. Test: `src/ts/process/prompt.tokenizePreset.test.ts` (new; one test each for the lorebook and postEverything counts
  and one for the four kept types). It is covered by the small-fixes red check, in which 9 of 14 tests fail at HEAD (row 874; the 14 are `prompt.tokenizePreset.test.ts` 3, `globalApi.openURL.svelte.test.ts` 3 and `characters.importChat.test.ts` 8). Stale citations: the
  build-side lines in `index.svelte.ts` are now 1155-1168 and 1789-1802, not `782-795` (row 869).
- **PT-2, closed without code.** `promptSettings.assistantPrefill` is inert and identical to upstream; it round-trips with
  upstream presets, and removing it needs edits in the storage lane (out of bounds, `MC-179`).
- **Checks on the working tree for the whole batch (row 875):** `pnpm check` 0 errors 0 warnings; `pnpm test` 345 files, 7059
  passed, 4 skipped; `pnpm build` ok. Gate 2 ended `[EDITORIAL]` and its title corrections are done (row 876).
- **Wiki hand-off:** none needed. `docs/wiki/Prompt-Template.md:51-53` already lists only persona, description, author's note and memory for Custom Inner Format, and the wiki never mentions `assistantPrefill` (row 869); this answers the coupling `TODO(evidence)` below.

Found by the wiki session while rewriting the [[Prompt Template]] wiki page (2026-09-22). Full
hand-off: **`Agents/Reports/99-prompt-template.md`**. Every entry is a code-reading claim; none has
been reproduced.

**Why it matters to this campaign:** neither loses or corrupts saved data. PT-1 only inflates a
token-count estimate; PT-2 is an inert setting field with a default and a translated label but no
reader.

| Group | IDs (gist) | Status |
|---|---|---|
| Wrong token estimate (no data effect) | PT-1 — `tokenizePreset()` counts `innerFormat` tokens for `lorebook` and `postEverything` items, but the prompt-build switch never applies `innerFormat`/`role2` for those two types, so the estimate is inflated for imported/hand-edited presets | Orchestrator-confirmed (token-count side); build side Reported |
| Inert setting | PT-2 — `promptSettings.assistantPrefill` has a type, default and translated label, but no UI binding and no reader | Orchestrator-confirmed |

- **Spot check (doc-writer, 2026-09-22):** PT-1 confirmed in source on both sides. Token side:
  `tokenizePreset()`'s `case 'lorebook': case 'postEverything':` branch
  (`src/ts/process/prompt.ts:77-87`) counts `prompt.innerFormat` when present. Build side:
  `src/ts/process/index.svelte.ts:782-795` shows `case 'lorebook'` tokenizing `unformated.lorebook`
  directly and `case 'postEverything'` tokenizing `unformated.postEverything` directly (plus the
  separate `promptSettings.postEndInnerFormat` setting, which is not the item's own `innerFormat`)
  — neither case reads the item's `innerFormat` or `role2`. Matches the report.
- **Priority:** low; both are cosmetic/dead-code issues, not correctness or data-safety bugs. Could
  be folded into the same batch as CHORE-09 — both are small, wiki-coupled findings from the same
  documentation pass. TODO(evidence): whether PT-1/PT-2 are upstream behaviour was not checked by
  the report.
- **Wiki coupling:** unlike the other four reports from this session, this one has no explicit
  wiki-coupling note. TODO(evidence): check whether the Prompt Template wiki page documents PT-1 or
  PT-2's behaviour before fixing either.

### CHORE-14 — Settings and main UI: 2 suspected bugs (none lose data)

**Status (2026-10-03, UI session): UI-1 and UI-2 DONE 2026-10-03 in `408c32dd`** (ledger rows
854 to 859). Product choices in `MC-206`. The investigator found that the Global Lorebook and Global Regex pages are a
deliberate upstream deprecation (`8ed4555b`, with the migration into modules later disabled), and that the chat runtime reads
neither field. The pages were already unreachable: upstream removed their menu entries in `8ed4555b`, and nothing sets index
8 or 9. The Global Lorebook page's code was also broken: it listed no entries, add went to the chat's local lore, and the
`'sglobal'` import and export indexed `chats[-1]`. The investigator also found that the Communities and Files parts of UI-1 were
already resolved (`MC-093`, `MC-088`), and that the sidebar's X was commented out in upstream `5e9683a5` (2023-07-26),
which left an empty full-width close button (row 854). Gate 2 ended `[EDITORIAL]`; the two Sidebar guard test titles were
corrected (row 858). Resolutions:
- **UI-1:** the Global Lorebook and Global Regex settings pages are retired. Deleted: `GlobalLoreBookSettings.svelte`,
  `GlobalRegex.svelte`, `lorepreset.svelte` and its `deleteTarget` test. `Settings.svelte` loses the three imports (the two
  pages and `Lorepreset`), the `openLoreList` state, the render cases for indices 8 and 9, and the `Lorepreset` overlay block. The `globalMode` prop is gone from `LoreBookList.svelte` and
  `LoreBookSetting.svelte`, and `importLoreBook` and `exportLoreBook` in `lorebook.svelte.ts` take only `'global'|'local'`
  (the `'sglobal'` mode is gone).
- **The data stays:** `db.loreBook`, `db.loreBookPage` and `db.globalscript` are untouched, so a backup moves to and from
  upstream with nothing lost (`MC-175`, `MC-206`). Old entries stay invisible, as before. The `exportRegex` default of
  `db.globalscript` in `scripts.ts` (`const script = s ?? db.globalscript`) is left as it is.
- **UI-2:** the character sidebar's close strip shows an X (`XIcon`, size 18) again, with the accessible name and tooltip from
  a new language key, `closeSidebar` ("Close sidebar"; six other locales translated). The click handler is unchanged.
- **Language keys left without callers:** `globalLoreBook` and `globalRegexScript` have no caller in `src` after this change
  (a search of non-test files finds only the seven `src/lang` definitions). They are left for CHORE-05.

**Tests:** two new test files, five tests: one regression reproducer (`Sidebar.closeButton.svelte.test.ts`: the close button is
found by its accessible name and contains an `svg`) and four guards. The reproducer fails at HEAD at `expect(btn).toBeDefined()`;
the two Sidebar guards also fail at HEAD, because they find the button by its new name. The Gate 2 reviewer's scratch mutant
that removes the `if($sideBarClosing) return` guard survived: the second-click guard cannot fail, since a svelte writable does
not notify on an equal value; its title now says only that `sideBarClosing` stays true. Not done (non-blocking): tests for the
narrowed `importLoreBook` and `exportLoreBook` modes. Checks: `pnpm check` 0 errors 0 warnings; `pnpm test` 336 files, 6982
passed, 4 skipped; `pnpm build` ok (ledger row 857).

**Merge note (`MC-179`):** `Settings.svelte` is on the UI lane's list (the files the Main Campaign keeps out of); this batch
removes its three imports, the `openLoreList` state, the two render cases and the `Lorepreset` overlay block. `LoreBookList.svelte`,
`LoreBookSetting.svelte`, `Sidebar.svelte`, `lorebook.svelte.ts` (two signatures narrowed) and the seven `src/lang` files (one
key) are on neither lane's list in `MC-179` 1. No file on the UI session's out-of-bounds list is touched.

**Wiki hand-off (for the Wiki session; `docs/wiki` was not edited):**
- `docs/wiki/Lorebook.md` (line 18) says the Global Lorebook settings page can't be opened. It should say the page is retired,
  and that its data is kept in the save file but unused.
- `docs/wiki/Settings.md` (lines 79 and 80) describes the "Global Lorebook" and "Global Regex" editors as existing.
- `docs/wiki/Regex-Script.md` (line 20) has a note about the separate "Global Regex" page.
- `docs/wiki/Settings-Chat-Bot.md` (line 257) refers to "the separate, unreachable Global Regex page described on [[Settings]]".
- These pages should say the two pages are retired and their data is kept but unused (`MC-206`).
- The character sidebar has a visible X in its close strip; any page that describes closing the sidebar by clicking an empty
  area or the backdrop should mention it.

Found by the wiki session while rewriting the [[RisuAI Basics]] and [[Creating a Basic Bot]] wiki
pages (2026-09-22). Full hand-off: **`Agents/Reports/99-settings-ui.md`**. Every entry is a
code-reading claim; none has been reproduced.

**Why it matters to this campaign:** neither loses or corrupts saved data. UI-1's stranded data
(Global Lorebook entries, `db.globalscript`) was already unused by the runtime before this finding —
it just becomes unviewable and unexportable too. The more consequential half of UI-1 is that the
unreachable Files page holds the fork's own Phase 1 item 5 and item 7 asset-integrity controls
(the `checkCorruption` startup-warning toggle, the asset-cache-verify action, and the OPFS
enable/disable buttons) — those Phase 1 entries assumed the page was reachable through the UI. This
brief is scoped to this file's chore section only, so Phase 1's item text is unchanged here; flagged
for the Orchestrator to decide whether it needs its own note.

| Group | IDs (gist) | Status |
|---|---|---|
| Unreachable settings pages | UI-1 — Files, Communities, Global Lorebook and Global Regex have render cases (`SettingsMenuIndex` 5/7/8/9) but no menu button ever sets those indices; Files holds the Phase 1 item 5/7 integrity controls, Global Lorebook/Global Regex hold data the runtime already doesn't read | Orchestrator-confirmed |
| Missing/hidden control | UI-2 — the character sidebar's close (X) button is commented out; the sidebar still closes via an empty-area click or the backdrop | Reported |

- **Spot check (doc-writer, 2026-09-22):** UI-1 confirmed in source. `src/lib/Setting/Settings.svelte:36-192`'s
  menu buttons set `$SettingsMenuIndex` to 0, 1, 2, 3, 4, 6, 10, 11, 12, 14, 15 and 77 (index 16
  opens `easyPanelStore` instead of setting the index); none sets it to 5, 7, 8 or 9. The render
  switch at `:208-217` has `=== 5` → `FilesSettings`, `=== 7` → `Communities`, `=== 8` →
  `GlobalLoreBookSettings`, `=== 9` → `GlobalRegex`. A repo-wide search for
  `SettingsMenuIndex\s*=\s*(5|7|8|9)` found no other writer anywhere in `src/`. Matches the report
  exactly.
- **Priority:** Medium for the Files page specifically, since it strands the fork's own Phase 1
  integrity work — the cheapest fix is one new menu button, or folding Files into Account & Files
  (`UserSettings.svelte`). Global Lorebook/Global Regex are lower priority since their data was
  already inert; decide whether to expose or retire them. UI-2 is Low.
- **Wiki coupling:** the Lorebook wiki page already says the Global Lorebook settings page can't be
  opened (per the report); a fix to UI-1 must update that page.
- **Update (2026-09-26):** the Files part of UI-1 is resolved by CHORE-33's 28B (`87b974e5`,
  `MC-088`; see Report 28 section 10). The Files page's controls (the asset-cache-integrity panel
  and the OPFS switch) moved into the tab renamed "Backup & Files", hosted by `UserSettings.svelte`
  through a child component, `StorageMaintenanceSettings.svelte`; `Settings.svelte`'s unreachable
  `SettingsMenuIndex === 5` case is gone (verified at HEAD). Communities, Global Lorebook and
  Global Regex (indices 7/8/9) are unchanged: their render cases are still there and still have no
  menu button setting those indices (verified at HEAD).

### CHORE-15 — TTS: 7 suspected bugs (none lose data)

**Status (2026-10-03, UI session): TTS-1 to TTS-7 DONE 2026-10-03 in `2c4b7fae`** (ledger rows 834
to 853). TTS batch (`MC-200` 1); product choices in `MC-204`. The investigator confirmed TTS-1, TTS-2, TTS-4, TTS-5 and
TTS-7, found TTS-3 understated, and refuted a premise: auto-TTS also spoke raw text, not only the speaker button (row 834).
Gate 1 took five rounds, with a `senior-advisor` escalation after the third rejection; Gate 2 approved (rows 837 to 851).
Resolutions:
- **TTS-1:** the Huggingface voice mode translates the reply from English into `hfTTS.language`
  (`runTranslator(text, true, 'en', lang)`, as `jaTrans` does). The language is trimmed and lower-cased; an empty value or
  `en` is not translated.
- **TTS-2:** the reply is translated once, before any request. A 503 with a JSON content type is retried only when its
  `estimated_time` is a finite positive number that fits the remaining wait budget (30 s in total), and while fewer than 5
  requests have been made. Any other failure ends with one alert (a 503 without `estimated_time` used to return with no
  message); only a Stop, or text that is empty after trimming, ends without one. The request also moved
  from `api-inference.huggingface.co` to `https://router.huggingface.co/hf-inference/models/${model}` (`MC-204` 1; ledger row
  835). Browser CORS for the router is unverified (CHORE-97).
- **TTS-3:** the Stop TTS entry is shown for every voice mode, and for a group chat when at least one member has a voice
  mode. Stop silences every clip still playing, including VITS and overlapping clips, aborts requests in flight where the
  transport accepts a signal, and shows no error alert for a cancelled call. `speechSynthesis` is guarded with `typeof`
  checks (`MC-204` 3).
- **TTS-4:** the ElevenLabs hint reads its text from a new language string (`ttsElevenLabsKeyHint`: "Set the ElevenLabs API key
  in Settings → Other Bots → TTS → ElevenLabs API key.") and names the real path. The "TTS" accordion and "ElevenLabs API
  key" labels are hard-coded English in `OtherBotSettings.svelte`, so the translations keep them in English (CHORE-05).
- **TTS-5:** `FixNAITTS` is deleted (a search of `src` finds no remaining reference).
- **TTS-6:** the speaker button, auto-TTS and `/speak` speak CBS-parsed text with closed `<Thoughts>` sections removed
  (`MC-204` 2). The button speaks exactly what the plain Copy button writes.
- **TTS-7:** the speaker button shows when `ttsMode` is set and is neither `'none'` nor `'normal'` (`'normal'` is what card
  import writes for "no TTS"). Plugin-defined modes keep their button. No saved data is rewritten.

**Behaviour changes to know about:**
- Auto-TTS is one call per run, after the output trigger and the output listeners, speaking the stored reply. It speaks a
  fresh reply whole and a continuation (auto-continue or the Continue button) only its addition. When a script or trigger
  changed earlier text, it speaks from the first differing point (`MC-204` 4 and 5).
- Multiline alternates are no longer spoken; only the stored message is.
- An aborted non-streaming run speaks nothing.
- A reply that cannot be located speaks nothing. One existing `sendChatOrigin` test changed to say so.
- Non-streaming speech now starts after the output trigger and the listeners, not before.
- Plugin TTS preprocessors receive only a continuation's addition on the automatic path. On the automatic path they are not
  run when there is nothing to speak (the `addTTSPreprocessor` comment in `risuai.d.ts` says so); the button path with Read
  Only Quoted can still run them with empty text (CHORE-98).

**Tests:** 180 new tests in 11 files: 75 regression reproducers that fail at HEAD for behavioural reasons, 47 guards and 58
new-behaviour tests. Final checks: `pnpm check` 0 errors 0 warnings; `pnpm test` 6986 passed, 4 skipped; `pnpm build` ok
(ledger row 852).

**Merge note (`MC-179`):** `index.svelte.ts` (the two auto-TTS calls inside the streaming and non-streaming branches are
replaced by one call after them, plus a `ttsBefore` capture at two sites) and `command.ts` (one import and the `/speak` call)
are on neither lane's list in `MC-179` 1; `transformers.ts`, `risuai.d.ts`, `DefaultChatScreen.svelte` and the seven
`src/lang` files (one key) are on neither list either. They are listed here so the merge is expected. `tts.ts` and
`CharConfig.svelte` are on the UI lane list; `Chat.svelte` is listed only for its copy code, which this batch touches (the
display-parse options for the copy text and the speaker button) along with the speaker button's visibility.

**Wiki hand-off (for the Wiki session; `docs/wiki` was not edited):**
- `docs/wiki/TTS.md`: the speaker button reads the stored message as displayed (CBS parsed, thinking removed), not the raw
  text; Stop TTS is no longer only for Web Speech and ElevenLabs; the Huggingface retry wording (retry cap, wait budget, one
  alert); the translation-direction note (English into the chosen language).
- `docs/wiki/RisuAI-Basics.md`: the Stop TTS visibility line.
- New behaviour to document: a continuation speaks only its addition; Stop is shown for all modes and in group chats with a
  voiced member; the Huggingface request goes to the router endpoint.

**New tickets from this batch:** CHORE-93 to CHORE-99 (below). **Recorded, not ticketed:** TTS translations enter the shared
translation cache, as `jaTrans` already does; the default Google engine uses `translatorInputLanguage` as the source
language.

**Original report (2026-09-22):**

Found by the wiki session while rewriting the [[TTS]] wiki page (2026-09-22). Full hand-off, with
per-bug evidence, status and suggested investigation: **`Agents/Reports/99-tts.md`**. Every entry is
a code-reading claim; none has been reproduced.

**Why it matters to this campaign:** none of the seven lose or corrupt saved data — TTS operates on
generated/spoken text, not stored character or chat state. TTS-1 and TTS-2 are Medium because they
break the feature outright (wrong output language; an uncapped retry loop), not because anything is
lost.

| Group | IDs (gist) | Status |
|---|---|---|
| Feature broken outright | TTS-1 — Huggingface "Language" translates the reply *into* English instead of *from* it, so a non-English model receives English text; TTS-2 — the Huggingface 503 retry loop has no cap and re-translates the text on every retry, feeding the previous translation back in | Orchestrator-confirmed |
| UI/label mismatch | TTS-3 — "Stop TTS" is hidden for every provider except Web Speech and ElevenLabs, though it works for all; TTS-4 — the ElevenLabs hint text points to a settings path that doesn't exist and is hardcoded, unlocalized text (a concrete instance of CHORE-05's "hardcoded English in components" category) | Orchestrator-confirmed |
| Dead code | TTS-5 — `FixNAITTS` has no callers, and its hardcoded voice disagrees with the UI's default; TTS-7 — a dead `ttsMode !== 'none'` comparison (disabled is `''`, not `'none'`) | Orchestrator-confirmed (TTS-5's default-mismatch half is Reported) |
| CBS spoken literally | TTS-6 — the per-message play button reads the raw stored message, not the CBS-parsed display text, so tags like `{{user}}` are spoken literally | Reported |

- **Spot check (doc-writer, 2026-09-22):** TTS-1 confirmed in source. The call
  (`src/ts/process/tts.ts:255`) is `runTranslator(text, false, 'en', character.hfTTS.language)`.
  `runTranslator(text, reverse, from, target)` (`src/ts/translator/translator.ts:61-67`) builds
  `arg.from = reverse ? from : target` and `arg.to = reverse ? target : from`. With `reverse=false`,
  `arg.from` resolves to `target` (`hfTTS.language`) and `arg.to` resolves to `from` (`'en'`) — the
  call translates the reply *from* the target language *into* English, the opposite of what a
  non-English Huggingface TTS model needs. Matches the report exactly. The same read also confirmed
  TTS-2: the translation step and the `while(true)` retry loop are both inside `tts.ts:252-288`, so
  a retry re-translates the already-translated text.
- **Priority:** below every data-loss chore. Within this chore, TTS-1 and TTS-2 are worth doing
  first and together — both touch the same `while(true)` block at `tts.ts:252-288`: move the
  translation above the loop, add a retry cap, and swap the translate direction. The rest are small,
  independent, low-risk fixes.
- **Wiki coupling:** the report says the TTS wiki page documents current behaviour, including TTS-1
  and TTS-3; fixing either must update the page.

### CHORE-16 — Playground: 4 suspected bugs

Found by the wiki session while writing the [[Playground]] wiki page (2026-09-22). Full hand-off,
with per-bug evidence, status and suggested investigation: **`Agents/Reports/99-playground.md`**.
Every entry is a code-reading claim; none has been reproduced.

**Why it matters to this campaign:** PG-1 is the only entry that can lose saved data. The
Playground chat is a normal saved character (`chaId: '§playground'`); it is hidden from the
sidebar but not from `GridCatalog`'s character grid, so a user who doesn't recognize the stray
"assistant" entry can delete it and lose the Playground chat history (a new one is created
automatically the next time Chat is opened, so the character itself always comes back, but its
history does not). The other three (PG-2, PG-3, PG-4) don't touch saved data: a dead Delete
button, dead code, and a settings field shared with live long-term-memory settings.

| Group | IDs (gist) | Status per Report 99 |
|---|---|---|
| Stray grid entry can lose saved chat history | PG-1 — the Playground character is excluded from the sidebar's `characterOrder` but not from the character grid, where it can be searched, opened and deleted | Orchestrator-confirmed; **fixed 2026-10-01** (commit `08e43e65`, Report 54) |
| Dead / non-functional UI | PG-2 — Prompt Convertion's per-file Delete button has no `onclick`; PG-3 — a dead `PlaygroundStore === 2` branch and an empty `PlaygroundRegex.svelte` | PG-2 Orchestrator-confirmed; PG-3 Reported |
| Shared live setting | PG-4 — the Embedding tool's OpenAI/Custom options bind directly to the same `supaMemoryKey`/`hypaCustomSettings` fields that long-term memory uses, so a change made while testing there silently changes chat memory too; may be intended, and the wiki page tells users | Orchestrator-confirmed |

- **Spot check (doc-writer, 2026-09-22):** PG-1 confirmed in source, with one citation to correct.
  `GridCatalog.svelte`'s `formatChars()` (`src/lib/Others/GridCatalog.svelte:35-65`) loops over
  `db.characters` and only skips entries on `trashTime` (`:47-52`); it never checks `chaId`, so
  `'§playground'` is not filtered out. `checkCharOrder()` does skip it, but not at the report's
  cited `src/ts/globalApi.svelte.ts:2109` — that line falls inside `addUncleanable`'s asset-cleanup
  pass and is unrelated. The actual exclusion is `src/ts/globalApi.svelte.ts:2237`, inside
  `checkCharOrder()` (`:2213-2241`): `if (charId !== '§temp' && charId !== '§playground' &&
  !char.trashTime) { DBState.db.characterOrder.push(charId) }`. The claim holds; only the line
  citation is wrong. The `chaId`/name assignment also checks out:
  `src/lib/Playground/PlaygroundMenu.svelte:44` sets `character.chaId = '§playground'`, `:34` sets
  `char.name = 'assistant'`, `:33` sets `char.utilityBot = true`.
- **Priority:** low relative to CHORE-01/03/07/10 — PG-1 needs a user to notice and delete a
  look-alike grid entry, not an ordinary save/reload path. The report's own fix is cheap: skip
  `'§playground'`/`'§temp'` in `formatChars()` the same way `checkCharOrder()` does. Per the report,
  `GridCatalog.svelte` had uncommitted changes in the working tree from another session at the time
  of writing; coordinate before editing it.
- **Overlap:** PG-4 touches the same settings fields as CHORE-10's long-term-memory findings
  (`supaMemoryKey`, `hypaCustomSettings`), but it is a UI-sharing issue, not one of CHORE-10's
  cataloged memory-computation bugs — read both before touching those settings. No overlap found
  with CHORE-05, CHORE-09 or CHORE-14.
- **Wiki coupling:** the Playground wiki page (`docs/wiki/Playground.md`; the folder moved from `wiki/` on 2026-10-01) documents PG-1 (the Playground
  chat appears in the character grid) and PG-4 (the Embedding tool shares memory settings) as
  current behaviour; a fix to either must update the page. PG-1's part is done: the Wiki session
  committed the update as `6ad13bac`. PG-4's part is open (the hand-off is in the PG-2, PG-3 and PG-4 bullet below).
- **Scheduling (2026-10-01):** PG-1 is scheduled as its own small fix between memory stage 1 step 3b and
  step 4, by the maintainer's approval of 2026-10-01 (`Agents/Live-State.md`, work order at the time).
- **PG-1 fixed (2026-10-01; commit `08e43e65`; Report 54):** the grid (grid, list and trash tabs), the
  mobile list, the group-member picker and the previous/next character hotkeys now skip `§playground` and
  `§temp` through one shared rule (`isHiddenSystemCharacter`, `src/ts/hiddenCharacters.ts`), which
  `checkCharOrder` also uses; its result is unchanged. Neither character is deleted, renamed or migrated
  (`MC-083` decision 3 leaves a stray `§temp` alone; hiding it from lists is this change's reading of that).
  Two parts went beyond "hide from the lists", as `MC-091` amendments, approved by the maintainer in chat
  on 2026-10-01: the picker and the hotkeys also skip trashed characters, and opening the
  Playground clears its `trashTime` and marks the character for save (defence in depth; Gate 2 round 2
  executed a tracker test showing that the normal flow already tracks and marks it). Gate 2 was `[EDITORIAL]` in both
  rounds (corrections applied). Not live-checked. Residue: a `§playground` trashed before the fix and
  never opened still reaches the boot purge, and a stray `§temp` copy has no UI path now (Report 54 section
  7). The Wiki session updated the Playground page (then `wiki/Playground.md`, now `docs/wiki/Playground.md`) in `6ad13bac`.
- **PG-2, PG-3 and PG-4 DONE 2026-10-03, in `0d41f06a`** (ledger rows 860 to 868). Product choice
  for PG-4 in `MC-207`. The investigator (row 860, the Orchestrator's summary) confirmed PG-2 and PG-4 and found more: on Tauri,
  cancelling the file picker (`selectMultipleFile` returns null) threw a TypeError; Run with no usable files created an empty
  "Converted from JSON" preset; and an Embedding run that threw left the spinner on. It partly refuted PG-3: `PlaygroundRegex.svelte`
  was empty and unimported, but `PlaygroundStore` value 2 is live (`openPlaygroundChat` writes it, and two `playgroundChat` test files
  assert it: `playgroundChat.coldStub.svelte.test.ts` and `playgroundChat.trashTime.svelte.test.ts`). The mobile back arrow, the home hotkey and character delete leave it at 2, which gave a blank page with only a back
  arrow (traced from source, not run). Gate 1 took two rounds (`[REJECT]` then `[APPROVE]`; the round-1 findings were mostly
  about CHORE-12's MOD-1, below) and Gate 2 approved at once (rows 863, 864, 867). Resolutions:
  - **PG-2 (`ToolConversion.svelte`):** each row's Delete removes that row. Cancelling the picker adds nothing and throws
    nothing. Run is disabled until a listed file is of a supported type. Run's handler catches an exception from
    `promptConvertion` and shows it with `alertError`, so the page stays usable (a PARAMETERS file without samplers can throw,
    per Gate 1). The stray `console.log` and the self-assignment of `files` in `addFile` are gone. In `en.ts`,
    `promptConvertion` is now "Prompt Conversion" and `convertionStep1` "Select all related files for the prompt (Context,
    Instruct and Sampler JSON is supported)"; keys unchanged. The page's hard-coded English ("Delete", "Add", "Run") is left
    for CHORE-05.
  - **PG-3 (`PlaygroundMenu.svelte`):** the tool grid renders for `PlaygroundStore` values 1 and 2, and the dead
    `=== 2` block is removed, so value 2 no longer shows a blank page. `PlaygroundRegex.svelte` is deleted. The store value 2,
    `MobileHeader`, `hotkey.ts` and `characters.ts` are unchanged.
  - **PG-4 (`PlaygroundEmbedding.svelte`):** the OpenAI key and the custom URL are the page's own copies, seeded from
    `supaMemoryKey` and `hypaCustomSettings.url` when the page mounts; editing them never writes the settings, and Run passes
    them to `HypaProcesser`. The custom key and request model still bind the live memory settings, because `HypaProcesser` reads
    those from `getDatabase()` with no override and changing that would need `hypamemory.ts` (out of bounds); a new note under
    them says so (new key `playground.embeddingSharedSettingsNote`, translated into the six other locales; the vi and de
    wording is low-confidence). `HypaProcesser` falls back to the saved value when given a blank one, so Run stops with an
    error alert when the custom model's URL or an OpenAI model's key is blank or whitespace-only. A run that throws clears the
    spinner and shows the error. The dead `customEmbeddingUrl` state is now the URL's copy. The two error messages are
    hard-coded English, left for CHORE-05. A change made in Settings while the page is open shows only after the page remounts
    (by design).
  - **Tests:** three new test files: `ToolConversion.svelte.test.ts` (5 reproducers, 2 guards),
    `PlaygroundEmbedding.svelte.test.ts` (8 reproducers, 3 guards) and `PlaygroundMenu.svelte.test.ts` (1 reproducer, 2 guards).
    At HEAD, in Gate 2's scratch run (row 867), exactly the 14 "regression reproducer:" tests of these files fail (5, 8 and 1) and
    every guard passes. Checks on the working tree: `pnpm check` 0 errors 0 warnings; `pnpm test` 341 files, 7016 passed, 4
    skipped; `pnpm build` ok (row 866). Not live-checked in a browser or on a device.
  - **Merge note (`MC-179`):** `ToolConversion.svelte`, `PlaygroundMenu.svelte`, `PlaygroundEmbedding.svelte` and the deleted
    `PlaygroundRegex.svelte` are in the Playground, which is on the UI lane's list. The seven `src/lang` files (one new key, and
    two `en.ts` values) are on neither list. No file on the UI session's out-of-bounds list is touched
    (`git diff --stat -- src/ts` is empty, row 867).
  - **Wiki hand-off (for the Wiki session; `docs/wiki` was not edited):** `docs/wiki/Playground.md` (line 64) says the
    Embedding tool's OpenAI key, URL, key and model fields "are the same settings long-term memory uses, so changing them here
    changes them for memory too". After this change that holds only for the custom key and the request model; the OpenAI key
    and the URL are local to the page. The page's Prompt Convertion section (the table row at line 35 and the heading at line 147; the UI label is now
    "Prompt Conversion") could mention that Delete removes a row and Run needs a supported file. The page has no mention of
    PG-3's blank page or the empty regex page.

### CHORE-17 — Plugin `setDatabase` re-encodes every character (a cost, not data loss)

**Status (2026-09-22):** Sequenced after CHORE-01 Stage 2, by the maintainer's decision. Stage 2 is
now implemented, gated and committed as `fbf799a7`, so CHORE-17 was unblocked and measured in real
Chromium (see "Measured" below). Based on that measurement, the maintainer chose to build **layer 2
only** (the encoder's exact-bytes skip) plus a **remote content-hash write dedupe**, now. **Layer 1
(the setter boundary reconcile) is ON HOLD** — see "Why layer 1 is on hold" below.

**Layer 2 status (2026-09-22):** implemented, gated, live-checked and committed as `dfabaa15`.
- Plan: `Reports/18-chore17-skip-unchanged-writes-plan.md` rev 2. Gate 1 approved it with
  findings; Gate 2 took three rounds.
- Ledger: rows 78-87.
- Result (headless Chrome, i9, best case), for an all-N `set()` with every character unchanged:
  1155 → ~710-746 ms. The IndexedDB writes go from 418 ms to 0, and the byte compare costs
  13.5 ms in total.
- The longest slice is unchanged on the same fixture: 43.9 → 45.0 ms.
- Live: a plugin `setDatabase` that changes one character writes one block, where it previously
  wrote all of them. A preset edit no longer rewrites the selected character.
- Also fixed on the way: `checkedRemoteExistence` recorded a remote file before the write that
  could still fail.
- Remaining cost: stringify and encoding still run for every re-encoded character, and one
  large character's re-encode is still one uninterrupted slice. See Phase 2 item 9.

**Problem:** since Stage 1 (`152cc563`), the shared plugin setters `setDatabase`/`setDatabaseLite`
(`src/ts/plugins/plugins.svelte.ts`, about 777-814) mark every character whenever the payload has a
`characters` array. That is the maintainer's F3 decision, for safety: V2 edits in place and can't
be seen; V3 hands back fresh copies. The next save re-encodes all N.

- **Measured** in Node on an i9 (Report 17 §6): `set()` about 1.18 s and about 117 MB transient at
  1000 characters and 150k messages.
- **This is a FLOOR:** the harness mocked localforage, but each re-encoded block is also written to
  IndexedDB (`risuSaveCacheForage.setItem`, `src/ts/storage/risuSave.ts` about 510-514). That's
  unmeasured.
- Cold storage defaults to off for users with plugins (`src/ts/storage/database.svelte.ts:713`), so
  exactly these users have full chats in memory.
- The full `database.bin` is written on every save anyway (`risuSave.ts` `encode()`, about 413-435).
- Remote block saving is opt-in (`risuSave.ts` 24-31). When it's enabled, `set()` never passes
  `skipRemoteSaving`, so unchanged characters are rewritten even though `encodeRemoteBlock` already
  computes the hash (about 532-568).

**Real plugin evidence (investigator; ledger row 70):**
- **AssetGod** (`AssetGod v3_alt.js`) calls `setDatabase` 7 times, never the narrow APIs. Four calls
  (lines 778, 1186, 1477, 1921) pass the entire cached `characters` array with exactly one character
  changed. All are user-triggered: rename, delete, folder move, dedupe, thumbnail, paste. It also
  calls `getDatabase()` with no `includeOnly` on panel open (3322, 3353), which is a full deep
  snapshot.
- **Fast Character Import** (`fast-character-import-v3_2.0.0.js`) appends via
  `setCharacterToIndex` (177, cheap today; the identity tracker marks just that one), and falls back
  to `setDatabaseLite` with the full array only when the list is empty (127-134). Its own comment
  calls the fallback slow and able to conflict with an in-progress chat.
- **Neither plugin calls a setter per chat turn, on a timer, or at load.** So this is a quality
  item, not per-turn stabilisation.
- **Plugin-side risk** (not fixable host-side, recorded for awareness): AssetGod caches the database
  at panel open and writes that copy back on later saves, so an edit made elsewhere in between is
  overwritten. The recommended fix neither worsens nor fixes that.

**Recommended strategy (senior-advisor; ledger row 71).** The maintainer's goal "re-encode only
what changed" is endorsed, but at the setter layer, not the encoder:

- **Layer 1, boundary reconcile (on hold, see below)** in the shared setter, `characters` key only. For each incoming
  element vs the live element at the same index:
  - the **same object (`===`)** is marked (the V2 in-place case, as today);
  - a **different object** is deep-compared to the live element with JSON semantics, including
    chats. If equal, keep the live element (identity preserved, not marked). If different, install
    the new object (the identity tracker marks it).
  - **Any shape difference** (length, or chaId at any index) falls back to today's wholesale assign
    plus mark-all.
  - Soundness notes: Svelte `proxy()` returns an existing proxy unchanged
    (`node_modules/svelte/src/internal/client/proxy.js:40-42`); the identity tracker reads every
    index (`src/ts/storage/dbChangeEffects.svelte.ts` about 166-189); comparing against LIVE is
    correct because live-vs-saved divergence is already in the tracker.
  - The only under-mark risk is a compare that reports "equal" for different content, which is
    testable with random deep mutations.
  - Side benefit: the character grid stops re-rendering every card after a V3 plugin call.
- **Layer 2, encoder exact-bytes skip:** if a re-encoded block's payload length and CRC32 match the
  cached block AND a full byte compare confirms it, reuse the cached block and skip the IndexedDB
  write and the remote write. No collision risk and no new memory. It helps every all-N path
  (backup loads, reload `init`), and complements layer 1 rather than replacing it.
  **Correction (2026-09-22, investigator, verified by the Orchestrator):** it does NOT help backup
  loads, reloads or boot. Each of those constructs a fresh `RisuSaveEncoder` with empty
  `this.blocks`, so there is nothing to compare against. It helps only `set()` on a live encoder:
  the plugin mark-all save, and the selected character re-encoded unchanged. See
  `Reports/18-chore17-skip-unchanged-writes-plan.md` §1.
- **Not now:** a worker, or frame-yielding.

**DO NOT (from the advisor):**
- don't use `lastInteraction`/`lastDate` as a change signal (the chat path only; that would be
  silent loss);
- don't keep the last JSON per character (duplicates the database in memory);
- don't skip on a non-cryptographic hash alone;
- never treat a `===` element as unchanged;
- always verify chaId at every index, and compare deep, including chats;
- don't snapshot V2 `getDatabase()` to diff later (V2 stays mark-all);
- don't branch on API version (the setter function object is shared);
- no worker (a `$state` proxy can't be posted, memory doubles, it's a rewrite);
- no frame-yielding as the fix (it lengthens the save window);
- don't revisit "reload instead of mark" (F3: a stale plugin snapshot becomes a
  permanent-deletion path).

**Measure first, in the browser** with the 1000-character / 150k-message fixture:
- (A) a per-character phase breakdown of one all-N `set()` (stringify; TextEncoder + CRC + copies;
  the IndexedDB `setItem`), plus the cost and transient heap of one layer-1 deep-compare walk;
- (B) plugin setter call frequency (a counter: plugin, setter, whether `characters` is present, and
  later how many elements differed);
- (C) how often V3 setters carry `characters` at all.

**Measured (2026-09-22, headless Chrome 154, real IndexedDB, i9-13900K; best case, no Pi/phone
claim), 1000 characters / ~150k messages:**
- One all-N `set()`: 1155 ms median (1113-1163 ms). Phases: `JSON.stringify` through the `$state`
  proxy 351 ms (30%); `TextEncoder` + CRC32 + buffer assembly 372 ms (32%); the real IndexedDB write
  (`risuSaveCacheForage.setItem`) 418 ms (36%); other 5 ms. A raw-object `JSON.stringify` of the same
  data took 69 ms, so the proxy makes stringify about 5.1x slower. The Node "about 1.18 s" figure
  above (mocked storage, slower JS) matched this only by coincidence — cite 1155 ms with this
  composition instead.
- The encoder retains every encoded block in `this.blocks` for the session: about 109 MB at this
  size — a standing cost, not transient.
- Today's save yields at each character's IndexedDB await: 1002 slices in this run; the longest
  44 ms median (43-63 ms); 10 slices over 16 ms per run, which are the fixture's 10 large characters
  (1% of characters, 70% of messages).
- Today's synchronous cost of the plugin call itself: V3-style `setDatabase` with a fresh
  `characters` array took 119 ms synchronous (the host `setDatabase`'s per-chat loop over every
  character, not the identity-tracker marks) plus a 2.6 ms effect flush; V2 in-place plus
  `setDatabaseLite` took 1.6 ms. Character-grid rendering was not measured.
- **Layer 1 compare** (JSON semantics, verified against a stringify oracle on 1000 characters plus
  10 edge cases): 267 ms synchronous for a full pass, equal or one-different alike; chunked every
  100 characters, 83 ms wall with a 5 ms longest slice; interleaved per character inside the save
  loop, about 18 ms compute (measured after warm-up, so optimistic).
- Harnesses: `Agents/Tools/save-gen/chore17-*` (drivers `chore17-run.mjs` and
  `chore17-followup-run.mjs`; need a throwaway `playwright-core` install, not in `package.json`; the
  plugin wrapper is a documented replica of the `getV2PluginAPIs` setters over the real
  `database.svelte.ts` setters). Raw logs under `Agents/Tools/output/` (gitignored).

**Why layer 1 is on hold.** The reconcile has to run inside the plugin call itself, before the new
objects are installed, so it can't be chunked there: doing so would take the V3 call from about
119 ms to about 386 ms of one uninterrupted block. Deferring the compare into the save loop is cheap
(about 18 ms), but it needs the replaced objects kept around until the save runs, and a write into a
replaced object in the meantime could make a changed character compare equal and never get written.
Not worth that risk for a user-triggered plugin save. Revisit only if plugin saves still feel slow
after layer 2 ships.

**Layer 2 scope, as decided.** After a character block is encoded in `set()`, skip the IndexedDB
cache write if its bytes equal the previous `this.blocks` entry; with remote saving on, also skip
rewriting a content-addressed `remotes/<name>.<hash>.bin` that was already written this session.
This removes about a third of an all-N `set()` (the IndexedDB share) — stringify and encode still
run. No new memory; nothing plugin-visible. Plan and gate are pending; a new report will follow.

**Staging (when scheduled):** measure -> plan -> gate 1 -> layer 1 and layer 2 as separate stages ->
live check.

### CHORE-18 — Character list view: long creator notes overflow and hide the buttons

**Status (2026-09-22):** reported by the maintainer; fixed in `GridCatalog.svelte` (list and trash rows: `min-w-0`, `line-clamp-3 wrap-break-word`, one `parseMultilangString` call); live-checked (a long test note: text 3,616 px wide in a 715 px row without the fix, contained and clamped with it; delete button visible); committed as `2ee8a2a9`.

**Symptom.** In the character list's list view (and the trash view, which shares the markup), a
long creator note can escape its box and spread into a wall of text. That hides the delete button.

**Cause (source, `src/lib/Others/GridCatalog.svelte`, the list and trash `{#each}` rows).**
- Each row prints the whole `creatorNotes` in a plain `<span>`, with no line clamp or height limit.
- The text column is `flex-1 flex flex-col` without `min-w-0`, and the span has no `break-words`.
  A long unbroken string, such as a URL, therefore widens the row past its container.
- A long note pushes the button row far down.

**Fix, as committed:** `min-w-0` on the text column, `wrap-break-word`, and a three-line clamp on
the note, so the select and delete buttons stay visible. Each row also called
`parseMultilangString(char.desc)` twice; that is now one call.

### Upstream issues found in passing (standing policy, `MC-069`)

This is a GPL-3 community project with a small userbase, so upstream defects are common. When a
stage's work, live check or review runs into one that is outside its scope, it is recorded here as
a chore rather than fixed inline or left in a conversation. Each entry says how it was found and
how far the cause was traced, since several were seen in passing and not investigated.

### CHORE-19 — Theme text is unreadable on the always-light `mobilechat` and `cardboard` surfaces

**Status (2026-10-03, UI session): DONE 2026-10-03 in `e9a80ec5`** (ledger rows 806 to 813). Mobile batch (`MC-200` 1);
product choices in `MC-201`; mechanism in ledger row 803. The cardboard editor is already dark text; the cardboard
problem was the rendered reply body. Not covered by the live check: a light colour scheme and a physical device.

**Status (2026-09-24):** observed during the durable-drafts live check in Chrome, with the
`고대비` (high-contrast) text colour scheme. Cause **suspected, not traced**. Not fixed.

**Symptom.**
- In `mobilechat`, the message editor's own text is invisible: the textarea inside the always-light
  `bg-gray-100` bubble renders its text in a light theme colour.
- In `cardboard`, a bot reply's rendered text ("Echo Message") is barely visible on the always-light
  card.
- The user's own messages were readable on both.

**Suspected cause.** Components inside these hardcoded light surfaces use theme tokens
(`text-textcolor` and similar), which follow the user's colour scheme and are light on a dark
scheme. The durable-drafts restore marker met the same problem and uses fixed greys on these two
surfaces (`markerOnLightSurface` in `Chat.svelte`, `MC-068`). That is one possible pattern for a
fix, but the right fix depends on how far upstream intends these themes to follow the colour
scheme. Trace which elements are affected under each colour scheme before choosing.

### CHORE-20 — `mobilechat` on a touchscreen has no way to save or leave the message editor

**Status (2026-10-03, UI session): DONE 2026-10-03 in `e9a80ec5`** (ledger rows 806 to 813). Mobile batch (`MC-200` 1);
product choices in `MC-201`; mechanism in ledger row 803. Wider than filed: mobilechat renders no message buttons at all,
and the editor's only exit discarded. Save and Discard now appear inside the bubble while editing. Not covered by the
live check: a physical device.

**Status (2026-09-24):** found by reasoning from source during durable-drafts Gate 2; **not
reproduced on a device**. Not fixed.

**Why (source).**
- `mobilechat` renders no pencil button. The editor opens only with the accessibility setting
  "클릭해서 수정하기" (click to edit), by clicking the message text.
- The pencil is also the normal save path, so without it the only exits are the textarea's
  long-press or unmounting the chat.
- The long-press action (`longpress` in `src/ts/gui/longtouch.ts`) listens to `mousedown`/`mouseup`
  only. A touch long-press does not produce a held `mousedown`, so on a phone the long-press never
  fires.
- So a `mobilechat` user on a touchscreen who opens the editor apparently cannot save the edit.
  Since durable drafts, their unsaved text comes back with a restore marker when the chat is
  reopened, but it still cannot be committed.

**Check first:** confirm on a real touch device, or with touch emulation, before designing a fix.

### CHORE-21 — Typing during a translation-edit save is lost

**Status (2026-10-03, UI session): DONE 2026-10-03 in `0651493b`** (ledger rows 816 to 832). Chat UI batch (`MC-200` 1);
product choice in `MC-203` 2: if the user typed during a save, the editor stays open and the text is kept as a draft;
only the save that leaves no save from that view pending treats its text as final. Translation cache writes from one
message view now run in click order. Gate 2 approved after three rounds (rows 826 to 830). The `onclick` and long-press
calls to `saveTranslationEdit()` still leave a rejection unhandled (CHORE-91).

**Status (2026-09-24):** found by reasoning during durable-drafts Gate 2 (Report 20 section 11).
Upstream behaviour. Not fixed.

- `saveTranslationEdit` awaits the cache write. `updateTranslationCache` then writes the saved text
  back into the editor (`editTranslationText = data`, from upstream commit `c2a71c29`), and the
  editor closes.
- Anything typed while the write was in flight is overwritten. The deliberate-exit delete also
  removes the draft that held it.
- The window is one IndexedDB write, so it is short. A fix would delete the draft only when it
  equals the saved text.
- Related suspicion, also unreproduced: nothing after the await checks that the same editor
  session is still open (a double-click, then a reopen before the second save settles).

### CHORE-22 — Self-hosted web builds and the dev server have no accidental-close guard

**Status (2026-09-24):** found while investigating the openURL fix (`Agents/Investigation-Ledger.md`
row 142). Traced to source. **Decided 2026-09-24 (`MC-070`): self-hosted builds get the guard. DONE 2026-09-24** (`b6a8f0e6`, ledger rows 151 to 155): `preload.ts` registers the guard on every build that is neither Tauri nor the Vite dev server, and four unmarked app-initiated reloads are now marked. Google Drive sign-in on a self-hosted build now shows the leave-site dialog, as it already did on risuai.xyz.

- `isWeb` in `src/ts/platform.ts` is `!isTauri && !isNodeServer && location.hostname ===
  'risuai.xyz'`.
- `src/preload.ts` registers the accidental-close "Leave site?" `beforeunload` guard only when
  `isWeb` is true.
- So every self-hosted web build (any hostname other than `risuai.xyz`) and the dev server run
  with no accidental-close protection at all — this is upstream design, unchanged by the openURL
  fix.
- The maintainer decided self-hosted builds should get the same guard (`MC-070`).

### CHORE-23 — `mcplib.ts`'s `oauthLogin` does not await or catch `openURL`

**Status (2026-10-03, UI session): DONE 2026-10-03 in `e10cbbbd`** (ledger rows 869 to 877; the
`MC-200` item 4 boundary). The fix is inside `openURL` in `globalApi.svelte.ts`, the only edit to that file: the Tauri branch
catches a rejected `open()` and a synchronous throw from it, and `console.warn`s a fixed string that does not include the
URL (OAuth URLs carry state and PKCE values). The investigator found 11 call sites in 9 files and none uses a return value
(row 869), so `openURL` stays synchronous and `oauthLogin` is unchanged. The fixed warning is the Orchestrator's disposition.
**Limitation:** the user sees no alert, so an MCP OAuth login that cannot open the browser then waits at the code prompt.
Test: `src/ts/globalApi.openURL.svelte.test.ts` (new; a rejected `open()`, a synchronous throw and a resolved call).
**Unverified, left as written below:** the investigator's check of the installed JS package (`tauri-plugin-shell` 2.3.3)
showed no deprecation, against the "2.3.6 ... deprecated" line below; that line was not re-checked. **Flag for the merge
(`MC-179` 1):** `globalApi.svelte.ts` is on the Main Campaign's lane, and `openURL` is the only function touched.

**Status (2026-09-24):** found while investigating the openURL fix (`Agents/Investigation-Ledger.md`
row 142). Traced to source, not reproduced. Minor. Not fixed.

- `oauthLogin` calls `openURL` with an MCP server's `authorization_endpoint` but never awaits or
  catches the call.
- On Tauri, a scheme the shell plugin's open scope refuses rejects `open()`'s promise; since the
  call is neither awaited nor wrapped, that rejection goes unhandled.
- `openURL` itself is synchronous and neither returns nor awaits `open()`'s promise, so awaiting
  or catching at the `oauthLogin` call site alone would not fix this; the fix belongs inside
  `openURL`.
- Related: the Tauri branch uses `open` from `tauri-plugin-shell`, which 2.3.6 marks deprecated
  since 2.1.0 in favour of `tauri-plugin-opener`. A future plugin major could remove it.

### CHORE-24 — `src/lib/Others/GithubStars.svelte` is unused

**Status (2026-10-04, side session): closed.** Already fixed by `2af8d4fe` (chore: remove dead code: LiteMain, GithubStars,
Communities, oauth_login; see CHORE-37's entry, which records `2af8d4fe` as DONE under Report 31), found when the hand-off listed it. No code done in the side session
(`MC-219` 1).

**Status (2026-09-24):** found while investigating the openURL fix (`Agents/Investigation-Ledger.md`
row 142). Traced to source, not fixed. Minor housekeeping only.

- `GithubStars.svelte` is not imported anywhere in `src` — a dead component.
- No functional impact.

### CHORE-25 — A trigger's `setVar` writes chat variables to the chat on screen, not the trigger's chat

**Status (2026-09-28): fixed by W1a, committed in `13ed2e75`.**
- Report 33, `MC-094`; Gate 1 rows 258-260, Gate 2 rows 261-262, live check row 263.
- Every write a trigger run makes goes to its origin by id, and there is no end-of-run commit.
- The same stage also fixes:
  - the manual trigger's commit, which dropped a send or edit made during its wait;
  - the Lua button putting one chat into another's slot after a switch;
  - the Lua writes that followed the selection;
  - the stale Lua engine closures;
  - `lowLevelAccess` being stamped onto trigger definitions.
- **W1b** (Report 34, committed in `22db8dfe`): a trigger's or script's reads (CBS, `#when`,
  the Lua read bindings, the lorebook scan and its flags, module selection, the `editinput`
  script) now take its origin, not the selection.
- **W2a to W2d** (Reports 35, 40, 42-45): the send's own parses, including `{{setvar}}` (which
  writes only with `runVar`, so only in the send), its lorebook call and graph memory take the send's
  origin, not the selection (`MC-095`).

**Original status (2026-09-24):** found by Gate 1 round 1 of the composer-drafts plan
(`Agents/Reports/22-composer-drafts-plan.md` sections 2.2 and 8; ledger row 158), Orchestrator
re-checked in source. Not fixed. **Data-affecting:** the wrong chat's trigger variables are
overwritten and saved. **Sequenced by the maintainer (2026-09-24): the stage right after the composer
stage, before `updateInlayScreen`.**

- In `triggers.ts`, `setVar` writes `scriptstate` to `getCurrentCharacter().chats[chatPage]` and
  `db.characters[get(selectedCharID)].chats[chatPage]`, and the `varChanged` block after the
  trigger runs `getCurrentChat().scriptstate = chat.scriptstate`. Both read the live selection.
- If the user switches chats while a trigger runs, the chat they switched to receives the
  trigger's variables in place of its own. Reachable in two windows. The first is `sendMain`'s
  `input` trigger, before `doingChat` is set. The second is an `output` trigger during generation,
  because `changeChatTo` has no `doingChat` guard.
- Upstream has the same code (per `MC-069`, an upstream bug found in passing).

### CHORE-26 — A group member's trigger can replace the whole group with the member

**Status (2026-09-28): fixed by W1a, committed in `13ed2e75`** (Report 33; live check row
263).
- A member's v2 character and lorebook effects write to the member, and chat data goes to the
  group's chat.
- No whole-slot replace remains.
- **Correction:** seven of the nine effects passed the trigger-start clone. `v2ModifyLorebook` and
  `v2SetAuthorNote` passed the live selected object.

**Original status (2026-09-24):** found by `senior-advisor` (ledger row 161) and traced by the pre-W0
checks (ledger row 162). Orchestrator re-checked in source; upstream `main` has the same code.
Not reproduced at runtime. **Data loss:** the group's record is replaced and saved. Closed by
writer stage W1 (`MC-076`), not fixed separately.

- In group generation, `sendChatBody` sets `currentChar` to the **member** while the chat is the
  **group's**, then runs the member's `start` and `output` triggers on a clone of the member.
- Nine v2 effects end in `setCurrentCharacter(...)`, which assigns
  `DBState.db.characters[get(selectedCharID)]`. The group is selected, so the group's slot
  receives the member's clone. `triggers.ts` has no `chaId` check anywhere.
- The nine effects are `v2SetCharacterDesc`, `v2SetReplaceGlobalNote`, `v2SetLorebookActivation`,
  `v2CreateLorebook`, `v2ModifyLorebook`, `v2ModifyLorebookByIndex`, `v2DeleteLorebookByIndex`,
  `v2SetLorebookAlwaysActive` and `v2SetAuthorNote`.
- `input` triggers are not exposed: `sendMain` runs them only for `type === 'character'`.

### CHORE-27 — The `request` trigger runs on whatever character is selected, on live data

**Status (2026-09-30): fixed by W2d-a, committed as `4c34172c`** (Report 44; ledger rows 404-416).
A request made for a send or a trigger run carries its subject; the `request` trigger runs under
that chat's origin (skipped when it is gone, duplicated or a group's), and the text-completion
names follow it too.

**Status (2026-09-24):** traced by the pre-W0 checks (ledger row 162), Orchestrator re-checked
in source; upstream `main` has the same code. Closed by writer stage W2 (`MC-076`).

- `request.ts` reads `getCurrentCharacter()` and `getCurrentChat()` inside its retry loop, after
  earlier awaits, and runs that character's `request` trigger over the prompt being sent.
- After a character switch mid-send, character B's `request` trigger rewrites character A's
  prompt.
- ~~The call passes `displayMode: true`, so `runTrigger` does not clone. Of the nine v2 effects
  above, only `v2SetAuthorNote` checks `displayMode`, so the others write to B's live data during
  what should be a display-only run.~~
  - **Correction (2026-09-27, ledger row 256):** a `request` run filters its effects through
    `requestAllowList`, which excludes every v1 effect and all nine character and lorebook effects.
  - Its only live write was the `lowLevelAccess` stamping, which W1a removes.
  - The remaining problem is that it reads the selection.
- Group chats never reach this block.

### CHORE-28 — Two characters sharing one `chaId` lose one of them at the next save

**Status (2026-09-25): fixed, committed as `2420d717`** (records `21668b28`). Plan and gate record:
Report 26 (rev 3; ledger rows 178 to 184).
- While a `chaId` has two or more holders, its block is kept as last saved.
- Never-saved duplicates write the first holder once (`MC-082`).
- A full reload reuses the old block only for a key still duplicated.
- Saving resumes on its own, and a persistent indicator names the characters.
- Adjacent fixes folded in:
  - the grid's delete, permanent delete and restore act on the clicked row;
  - the local `.bin` restore repairs ids;
  - cold-storage cleanup refuses while a key is kept.
- Also fixed as a side effect: at HEAD, a character removed during an earlier character's write
  made the save loop skip the next one and delete its block.
- **Residual:** the save loop's calls to the idle check and the indicator are covered by review
  only.

**Original status (2026-09-24):** found by Gate 1 round 4 of the W0 plan (Report 24; ledger row 170). The
reviewer ran it, and the Orchestrator re-checked it in `risuSave.ts`. Upstream `main` has the same
code. **Data loss:** a whole character is lost. **Sequenced by the maintainer (`MC-079`):
straight after W0**, as its own gated change.

- The save file holds one block per `chaId`: `init` and `set` in `risuSave.ts` both write
  `this.blocks[character.chaId]`.
- A full encode of `[orig, copy]` keeps only the copy. An incremental `set` encodes the first
  holder that has a save mark and consumes the mark, so the second holder is never written.
- A duplicate `chaId` reaches runtime through plugin installs (a copy that keeps the id) and,
  until W1 lands, through CHORE-26's member clone.
- **The fix (`MC-079`):** while a `chaId` has two holders, its block is not rewritten, so the
  last good save is kept, and the user sees a visible warning. W0's scenario 20a pins today's
  behaviour; this chore inverts it.
- **W0's duplicate warning cannot cover every route, so this guard must not rely on it.**
  - A v2.1 plugin can make a duplicate `chaId` in place: it pushes a copy through
    `getDatabase()`, then calls `setDatabaseLite(getDatabase())`.
  - W0 never warns about that, because the call receives the live array (Gate 2 round 3 ran it).
  - Only this chore's save-side guard protects that case.

### CHORE-29 — Filling a missing `chaId` brings back a stale copy of the character

**Status (2026-09-24):** found by Gate 1 round 4 of the W0 plan (ledger row 170), which ran it. Not
fixed. Upstream `characterFormatUpdate` fills a missing `chaId` in the same way.

- A character that was saved without a `chaId` has its block saved under an empty name.
- When a `chaId` is filled in later (`characterFormatUpdate`, and from W0 on the install fill and
  `beginWork`), the character is saved under the new id. The old block is never deleted, so a
  stale copy comes back on the next load.
- **Replacing a character also leaves stale blocks, and they accumulate.** When a plugin replaces
  a character with an id-less object, W0 gives it a fresh `chaId`. The replaced character's block
  is not deleted without a full encoder reload, so each such install leaves one more block.
  - Gate 2 round 3 of W0 ran 5 installs into slot 1 of a two-character database. A reload then
    showed 7 characters where 2 were expected: the original, one stale block, and all five
    installs.
  - At HEAD the id-less object reuses a single block key instead, and can lose its newest
    content.
  - Deleting the replaced block when a slot's `chaId` changes fixes both cases.

### CHORE-30 — v2.1 `setChar` writes into whatever is selected when the plugin calls it

**Status (2026-09-24):** found in passing by Gate 1 rounds 3 and 4 of the W0 plan. Traced, not
run. Upstream has the same code. A plugin API contract question (`MC-011`), not part of the
writer rework.

- `setChar` assigns `db.characters[get(selectedCharID)] = char`. A plugin that awaits between
  `getChar` and `setChar` while the user switches overwrites the other character.
- With nothing selected (`selectedCharID` is −1), it writes `characters[-1]`, which is silently
  lost.

### CHORE-31 — Cold storage may turn an idle group into a plain character

**Status (2026-09-24):** found in passing by the W0 investigation (ledger row 164). **Untraced for
impact.** Upstream has the same placeholder literal.

- `makeColdDataForCharacter` does not skip groups, and its placeholder hard-codes
  `type: 'character'` with no member list. A group idle long enough goes cold.
- It is unknown whether anything reads `type` or the member list on a cold, unopened group before
  `changeChar` restores it. That is the question to answer first.

### CHORE-32 — A swap can drop a character's pending edit for one save

**Status (2026-09-24):** found by the W0 follow-up checks (ledger row 169, check 2). Traced, not
run. Narrow.

- `prepareSaveIteration`'s no-reload branch drops save marks for `chaId`s that are absent from
  `characters` and does not re-fold them, although the reload branch does.
- If a character already had a pending edit when a plugin swap briefly removed it from the array,
  that edit misses that save. It is saved with the next mark.

### CHORE-33 — RisuAccount removal: drop the hub credential, keep Realm and Drive

**Status (2026-09-26): ✅ DONE.** Plan: `Agents/Reports/28-risuaccount-removal-plan.md` rev 3.6, in
three sub-stages, each with its own Gate 2 and live check. Gate 1 on the plan: ledger rows 193 to
197 (rounds 1 and 2 rejected on substance; round 3 approved).
- **28A** (`e1dd839c`, 2026-09-25): refuses an account-sync-encrypted `.bin` upfront, before any
  write (`MC-081`). Gate 2: rows 198-199. Live check: row 200.
- **28B** (`87b974e5`, 2026-09-26): removes RisuAccount, Kei and the hub sign-in; merges the
  unreachable Files page into the renamed "Backup & Files" tab (`MC-088`). Gate 2: rows 203-204.
  Live check: row 205.
- **28C** (`d2653123`, 2026-09-26): asks for agreement to upstream's Terms of Service and Privacy
  Policy at first use of Realm or Drive, not at boot (`MC-086`); the old boot ToS prompt
  (`alertTOS`) is gone. Gate 2 took two rounds of substantive rejection on the same class of leak
  (rows 213-214); round 3 (row 215) was interrupted by a process exit before a verdict, though its
  scratch scenarios found two more leaks (E2/E4) in the same placeholder-control load logic. The
  Orchestrator then escalated to `senior-advisor` (row 216) rather than write a fourth revision,
  and landed on an Invariant A/B redesign; a fresh Gate 2 on that redesign returned `[EDITORIAL]`
  (row 220), closed by a same-reviewer re-check (row 222). Live check: row 221 (production Node
  build; nothing reached an upstream host before acceptance; the mobile landing view and the
  accept path were not run live, covered by tests).

See Report 28 for the full record. Six items Report 28 found out of scope for this stage are
filed as CHORE-35 to CHORE-40 below.

**Known limitation (Report 28 section 11.7, O1; not fixed here):** a blocking dialog posted while
the agreement prompt is up — for example `saveDb`'s multi-tab conflict prompt — is hidden behind
the prompt, and that dialog's wait takes the prompt's answer instead of its own. The conflict
prompt falls back to its safe choice, `'stay'`, so this is not a data-loss path. A real fix needs
an alert queue; that is a later fix, not part of 28C.

- **Background:** scope and the migration refusal were maintainer-decided (`MC-080`, `MC-081`);
  see `Agents/Reports/25-risuaccount-removal-strategy.md` for the strategy record (superseded by
  Report 28 where they differ). The maintainer set the timing: after the multiuser removal
  (CHORE-34, `911376cb`) and before W1, the order `senior-advisor` recommended. Later decisions
  (`MC-084` to `MC-089`) refined the design: one shared agreement at first use of Realm or Drive
  instead of a boot ToS screen (`MC-086`), the Files-page merge (`MC-088`), and keeping the OPFS
  switch visible after the merge (`MC-089`). `SavePopupIcon.svelte` was edited, not deleted, since
  it also holds CHORE-28's frozen-save indicator.

- **Removes:** the hub sign-in and everything that uses its token — account sync, account data
  save and load, account backup restore, account cold storage, Kei auto-backup and Kei image
  generation, and in-app edit and remove of the user's own Realm uploads.
- **Keeps:** Realm browse, info, download, report and anonymous upload; Google Drive backup; the
  self-hosted server's `/hub-proxy`.
- **Migration:** a user migrating from upstream keeps their data via a `.bin` local backup
  import (`MC-011`). An account-sync-encrypted `.bin` is refused upfront, before any write, with
  the two upstream alternatives named in the message (`MC-081`).
- **Separate stage from the multiuser removal** (`MC-074`); the two are not folded together.

### CHORE-34 — Multiuser removal

**Status (2026-09-25): ✅ DONE (`911376cb`).** Gate 1 approved plan rev 2 (ledger rows 186
and 187). Gate 2 round 1 rejected the implementation for wording only (row 188), and the fix-up
review approved the corrections. The live smoke check passed on a production build (row 189).
See
`Agents/Reports/27-multiuser-removal-plan.md`, `MC-074`, `MC-083`, and ledger row 185.

- **Removes:** `src/ts/sync/` (multiuser, PeerJS-based) whole, its 7 `src/lang` keys across all
  7 language files, the `peerjs` dependency, and the "Create Multiuser Room" / "Join MultiUser
  Room" UI entry points.
- **Keeps:** `Message.name` and `Message.otherUser` on the `Message` type; `checkCharOrder`'s
  `§temp` exclusion; `saveAsset`'s `customId` parameter; `sendChat`'s double save-mark mechanism
  (only its comment's multiuser mention drops).
- **Migration:** upstream data carrying multiuser fields (a stray `§temp` character, a named
  message) keeps loading (`MC-011`); nothing is stripped or migrated on load (`MC-083`).
- **Separate stage from the RisuAccount removal** (CHORE-33): no shared transport, helper or hub
  route (ledger row 185).

### CHORE-35 — Upstream proxy and CDN infrastructure outside Realm and Drive have no agreement gate

**Status (2026-09-26):** filed out of scope from CHORE-33's plan (Report 28 section 3.5, item 1),
`MC-087` #3b. Traced to source, not fixed.

**Patreon removed (2026-09-27, `a9c29ba7`),** as part of the removal stage (Report 31).

**Decided (`MC-092`, 2026-09-26):** the upstream-infrastructure features below become **opt-in**,
not removed — the maintainer notes `/proxy2` "was there before EULA was introduced," but "making
these features opt-in sounds more solid." The **Patreon list is removed** ("I do not wish to take
a donation, and upstream patreon feels off to be in a fork"), as part of the removal stage
(CHORE-36/37/38), not this opt-in stage. This stage is scheduled after W1.

- `/proxy2` (the default on static web builds; `usePlainFetch` bypasses it), the transformers CDN,
  the Lua docs link, the MCP OAuth helper, `#import=<url>` in `characterURLImport` (fetches any
  URL with no acceptance check; not a Realm feature), and `getProxyStreamJobBaseUrl` (the same
  proxy infrastructure as `/proxy2`) all reach upstream or third-party hosts, and none of them is
  covered by CHORE-33's Realm/Drive agreement gate.
- The maintainer's recollection on `/proxy2`, stated but not verified: it is a plain proxy, there
  for CORS and provider-compatibility reasons. `MC-087` #3b keeps it as a separate ticket.
- **Observation (pre-existing, not Realm/Drive):** the Lua fetch ban-list checks
  `startsWith('https://risuai.xyz')`, so it does not catch `sv.risuai.xyz` or
  `nightly.sv.risuai.xyz`.
- **Found in passing (2026-10-01):** the MCP OAuth sign-in goes through upstream's `account.sionyw.com` host.
  In `oauthLogin` (`src/ts/process/mcp/mcplib.ts`) the redirect URL is `https://account.sionyw.com/oauthhelper`
  (`:669`, with the source comment "Just a placeholder, should be replaced with actual redirect URL"), and
  after the user pastes the authorization code the app POSTs it to `https://account.sionyw.com/oauthhelper/api`
  (`:708`). Both lines re-read at `696ba5de`. The same host serves the upstream Terms of Service and Privacy
  Policy that the agreement popup links (`src/lib/Others/AlertComp.svelte:243-245`). **Not checked:** whether
  the upstream agreement prompt gates the MCP OAuth path. This is the "MCP OAuth helper" item in the list
  above; this note adds the lines, not a new finding.

**Release condition (2026-10-01, `MC-157`):** CHORE-60 lists this ticket as a release condition. The legal flag is
now on by default in every build from the repository, so the prompts this ticket lists are a known remaining gap
against the third requirement of upstream's notice. The maintainer chose to leave the ticket at its place in the work order (item 4).

### CHORE-36 — Remove Google Drive backup

**Status (2026-09-27): ✅ DONE (`237ebba1`).** Report 31; Gate 1 rows 233-236, Gate 2 rows 237-239,
live check row 240. The same commit makes `LoadLocalBackup()` hold `dbWriteLock` (Report 31
item E); the cross-tab case is CHORE-42.

**Decided:** (2026-09-26, `MC-092`). Filed out of scope from CHORE-33's plan
(Report 28 section 3.5, item 2) as a question about a possible restore-over-the-wrong-account bug
(INFERRED, not reproduced — see below); the maintainer then decided to remove Google Drive backup
entirely rather than investigate or fix it further — "let's remove the google drive sync - I do
not wish to take a risk related to it." **This supersedes `MC-080`'s "keep Google Drive backup";**
Realm and `/hub-proxy` stay kept. Placed in the removal stage, after CHORE-39 and before W1.

- Drive's web flow redirects Google's OAuth to `https://risuai.xyz/`, where upstream's page
  exchanges the code and backs up or restores against that origin's own data. A Load started from
  this fork could therefore restore over the user's data on risuai.xyz (INFERRED, not reproduced)
  — this question is now moot once Drive is removed.
- **Scope (Orchestrator's reading of `MC-092`):** remove Google Drive backup entirely, on web and
  Tauri — the Save/Load buttons, the OAuth flow, the `?code=`/`?state=` handling, and their lang
  keys. Realm's upstream-agreement prompt (from 28C) then covers Realm only; its wording follows.
  Migration from upstream is still by local `.bin` backup (`MC-011`).

### CHORE-37 — Dead code left after the RisuAccount removal

**Status (2026-09-27): ✅ DONE (`2af8d4fe`).** Report 31. The commit also removes `GithubStars.svelte`,
its icon, and the Communities page (`MC-093`), all unreachable.

**Filed (2026-09-26):** out of scope from CHORE-33's plan (Report 28 section 3.5, item 3).
Traced to source (confirmed still present at HEAD), not fixed. Housekeeping only. **`MC-092`
(2026-09-26): joins the removal stage**, alongside CHORE-36, CHORE-38 and the Patreon list, after
CHORE-39 and before W1.

- `src/LiteMain.svelte`, `src/etc/docs/docs_text.cbs`, and the Tauri `oauth_login` command
  (`src-tauri/src/main.rs`) with the `oauth2` crate (`src-tauri/Cargo.toml`) are dead code CHORE-33
  did not remove.

### CHORE-38 — Decide what to do with the leftover `risuaiAccountCached` data

**Status (2026-09-27): ✅ DONE (`237ebba1`).** Every ordinary boot drops the whole database and
clears Drive's `risu_lastsaved` and `backup` (`save`/`load` only). Report 31; live check row 240.

**Decided:** (2026-09-26, `MC-092`). Filed out of scope from CHORE-33's plan
(Report 28 section 3.5, item 4) as the maintainer's call to make; decided: clear it, no recovery
— "I think it's safe to clear them." Placed in the removal stage, after CHORE-39 and before W1.

- `risuaiAccountCached`, a leftover from account sync, is left in place by CHORE-33.

### CHORE-39 — OPFS migration has no quota-lockout fallback

**Status (2026-09-26): ✅ DONE (`37898465`).** Gate 2 rows 229-230 (round 1 rejected: the lock
winner did not re-read the flag; round 2 [EDITORIAL]); live check row 231. Report 30.

**Filed:** filed out of scope from CHORE-33's plan (Report 28 section 3.5, item 5),
found at CHORE-33 Gate 1 round 2 (ledger row 194): a possible quota lockout during the OPFS
migration, not reproduced. `MC-089`: the fork does not ship until every current ticket,
this one included, is cleared, so this is not a reason to hide the OPFS switch. **`MC-092`
(2026-09-26): this ticket goes before W1**, ahead of the removal stage (CHORE-36/37/38 and the
Patreon list) — "CHORE-39 goes before W1."

- If the OPFS migration fails, fall back to LocalForage for that boot and say so, or check quota
  before migrating.
- **Plan:** `Agents/Reports/30-chore39-opfs-migration-plan.md` rev 2.1; **Gate 1 passed**
  (ledger rows 223, 226, 227). The investigation and Gate 1 also found: a complete copy whose
  final `migrated` write fails locks out the same way; two tabs can run the boot copy at once;
  cold storage's files in the OPFS root break every re-enable after a disable. All four are fixed.
- **Optional, not taken:** a test for a tab whose exclusive request timed out while the migrator
  failed; without the not-granted path's flag check it would show an untrue "interrupted" notice
  (it still lands on LocalForage).

### CHORE-40 — `Chat.svelte`'s copy button fetches any http(s) URL, unrelated to Realm or Drive

**Status (2026-09-26):** filed out of scope from CHORE-33's plan (Report 28 section 3.5, item 6).
Traced to source, not fixed. The maintainer did not bring this into 28C.

**Status (2026-10-02):** still open. **Fixed in the same change as CHORE-63**, placed right after CHORE-53
(`MC-160` 3). A second investigation traced the same handler for the maintainer's copy-button report (ledger row 600).

**Status (2026-10-02, later): closed by `d013e7cf` (CHORE-63 stage A).** The maintainer split the work (`MC-165` 6: "Split:
text now, card next (Recommended)"), so CHORE-40 is no longer "fixed in the same change" as the whole of CHORE-63: it is
closed by the plain-text stage, which is committed. The copy button requests no host at all: the card code, with its
fetches, is gone from the tap (from the commit message). **Stage B must keep the app from fetching outside hosts**: the
maintainer chose to keep an outside image as a link in the card, so the app downloads nothing (`MC-165` 2). The text
above is the ticket as filed and is unchanged.

- `Chat.svelte`'s copy button fetches every http(s) URL in a rendered message, character icon or
  user icon, including `sv.risuai.xyz`, from a click. It is not a Realm or Drive feature (Report
  28 section 11.6's closing paragraph), so CHORE-33's agreement gate does not cover it.
- **Related:** CHORE-63 (the same function and the same chain of awaits; the copy button's reliability). Fixing only
  the external fetches would leave CHORE-63's problems in place.

### CHORE-41 — Bug: the edit button on earlier messages sometimes opens no editor

**Status (2026-10-04, side session): still open.** The hand-off listed it in Batch B; the maintainer chose not to take it in
the side session ("Skip CHORE-41", `MC-219` 3). Nothing changed. It is still blocked on the console output below.

**Status (2026-09-26):** filed from the maintainer's bug report (`MC-090`) and two follow-up
investigations, ledger rows 201, 202 and 206. Not fixed. Blocked on the maintainer's console
output (below).

- **Mechanism found (TRACED, ledger row 201, RUN on upstream `main` and this fork's HEAD):**
  `Chats.svelte` does not render messages with `{#each}`; it mounts one `Chat` per visible message
  by hand, keyed by a 32-bit hash of the message's `data`, `chatId`, index, portrait flag,
  `disabled` and `ReloadChatPointer[index]`. `editMode` is plain local `$state` in `Chat.svelte`.
  Whenever that hash changes for the message being edited, the instance is unmounted and
  remounted, silently dropping the open editor with no error and a normal-looking button. This is
  present in both upstream and this fork. The maintainer's supplied plugins (ledger row 202) were
  ruled out as the trigger — none indexes messages or bumps the pointer that changes the hash.
- **Still open: why the button stays dead across repeated clicks, not just once.** Ledger row 206
  found a likely cause — a synchronous error thrown while building the `{#if editMode}` branch is
  caught by nothing: there is no `<svelte:boundary>` anywhere in `src/`, upstream or this fork, so
  the throw aborts that message's flush and every retry on a stable trigger replays it. The throw
  site itself is not found. **Needs the maintainer's console output** at the moment of a failed
  click, and whether the pencil icon flashes blue on the failed open.
- **The report's build:** upstream's hosted site, risuai.xyz, on a roughly 36 GB `.bin` save
  (`MC-090`); all data stored locally, no account sync. Whether the same triggers occur at this
  fork's likely scale is unconfirmed.

### CHORE-42 — Another open tab can overwrite a local-backup restore

**Status (2026-09-27): ✅ DONE (`ce6bc594`).** Gate 2: rows 249 and 250. Live check: row 251.

**Before implementation:** decided (`MC-093`); plan passed Gate 1. Plan: Report 32 rev
3.1. It refuses a restore when another tab holds the storage lock, and warns when Web Locks are unavailable
(non-secure static origins, old browsers). A per-origin storage epoch makes a tab that lost a lock race
reload rather than write. It also fixes the restore's cancellable reload in `237ebba1`. Scoping in ledger
row 242; Gate 1 in rows 243, 246 and 247. Filed from the removal stage's Gate 1
(Report 31, item E; ledger row 234).

- `LoadLocalBackup()` writes the restored database, then reloads its own page. Report 31 item E
  serializes that write with **this page's** save loop through `dbWriteLock`.
- Another tab of the same origin runs its own save loop and holds its own copy of the
  pre-restore database. If that tab saves after the restore's write, it overwrites the restore
  (INFERRED from the per-page scope of `dbWriteLock`; not traced through the BroadcastChannel
  reload logic or MC-050's multi-tab reload rules, and not reproduced).
- A likely shape: take the exclusive storage-migration lock (`storageTabLocks.ts`, the one the
  OPFS switch uses), which waits for every other tab to close and refuses after a timeout.
  Refusing a restore while another tab is open is a product trade-off.

### CHORE-43 — Unreroll can write one chat's reply into another chat

**Status (2026-09-28):** filed from Gate 1 rounds 5 and 6 of the composer stage's S1 (Report 22;
ledger rows 276-277; `MC-100` 2). Not fixed. Scheduled on 2026-10-01 (see the amendment below).

- **Mechanism (TRACED by the gate reviewer, not run):**
  - `DefaultChatScreen.svelte` keeps the reroll history (`rerolls`, `rerollid`) as component
    state.
  - It is reset only when `lastCharId`, a `characters` index, differs, or after a send appends.
    `sendChatMain` pushes each generation's new messages into it, including reroll and auto-mode
    ticks.
- **Scenario:** reroll in chat A, switch to chat B of the same character without a remount
  (desktop), then reroll and unreroll. `unReroll` writes A's reply objects over B's last message,
  and that is saved.
- **Scope:** present upstream. **Corrected 2026-10-01 (see the amendment below):** the original
  sentence here, "On mobile, a chat switch remounts the component, which resets the history", holds
  only under the opt-in beta mobile layout or the Lite build.
- **A likely shape:** key the history by owner `chaId` and chat id. Every read **and every write**
  resets it when the chat differs (round 6 found that a read-only reset misses auto-mode writes).

**Amendment (2026-10-01):** from the investigation in ledger row 528 (the `investigator`'s packet, in
the session scratchpad as `rerolledit/packet.md`, at HEAD `756e8210`). The Orchestrator verified the
mechanism below in `src/ts/process/composerActions.svelte.ts`. **Status:** scheduled after
CHORE-53 and after CHORE-63 with CHORE-40, together with CHORE-54 (`MC-151` 3; `MC-160` 3); fixing both in one change is the Orchestrator's recommendation
(CHORE-54). The maintainer's second relayed report
matches this ticket's mechanism (`MC-151` 1): "reroll isn't bount to specific chat - rerolling on one
chat and tapping 'previous message' on another chat loads previous message from previous chat".

- **The mechanism is confirmed (TRACED, and RUN in a scratch Vitest against the real
  `composerActions.svelte.ts`, with the generation stubbed).**
  - `reroll` and `unReroll` write live into
    `DBState.db.characters[selectedCharID].chats[chatPage].message`
    (`composerActions.svelte.ts:461-465`, `:528-532`) and are bound to no chat.
  - The only resets are `lastCharId !== selectedCharID` (`:219-222`, `:445-448`, `:510-513`) and
    the one after a send appends (`:385`). `lastCharId` is a `characters` index.
  - `changeChatTo` (`globalApi.svelte.ts:3478-3514`) writes `chatPage` and bumps `ReloadGUIPointer`.
    It does not touch the composer instance.
- **P1, corrected (TRACED; not run in a browser).** "On mobile, a chat switch remounts the
  component" is only true under `$MobileGUI`, which is set only when
  `db.betaMobileGUI && window.innerWidth <= 800` (opt-in, no default) or in the Lite build
  (`bootstrap.ts:306-309`).
  - Every other phone or narrow window uses the desktop layout: `App.svelte:220-237` mounts
    `<ChatScreen />` there, and `DynamicGUI` (width <= 1024, `stores.svelte.ts:16`) only turns the
    sidebar into an overlay. `Sidebar.svelte:968` and `:994` host `SideChatList`, whose click calls
    `changeChatTo(i)` (`SideChatList.svelte:331`) with no remount.
  - Even under `$MobileGUI`, three in-screen switches never leave `ChatScreen` (it renders when
    `$MobileSideBar` is 0, `MobileBody.svelte:47-48`): the Branch button (`Chat.svelte:1270`,
    `changeChatTo(0)`), the "branched from" link (`Chat.svelte:810-816`), and the menu's "Chat list"
    entry when `showMenuChatList` is on (`DefaultChatScreen.svelte:1001-1008` opens `ChatList`,
    which calls `changeChatTo`, `ChatList.svelte:29` and `:62`). The chat list reached from the
    header menu (`MobileHeader.svelte:25-27` sets `MobileSideBar` to 1) is the one mobile path that
    remounts.
  - So the report-2 scenario is reachable on a phone, in the default layout and in the beta layout.
    "Tapping" does not rule it out.
- **P2, corrected (RUN, scenarios D4, D5 and D4b).** The scenario text above says "then reroll and
  unreroll" in chat B. One `unReroll` in chat B is enough, and no reroll in B is needed.
  - D4: reroll in chat A, so the history is `[[A-R0],[A-R1]]`, id 1; set `chatPage` to chat B (same
    character, so `lastCharId` still matches); one `unReroll()` with the same source. B's last
    message becomes "A-R0" and the cursor moves 1 to 0. Chat A still shows "A-R1".
  - D4b: with a fresh source, which is what a remount gives, the same call does nothing.
  - D5: the target's role is not checked. With chat B ending in a user message, that message is
    replaced by a char message holding "A-R0".
- **Not run (INFERRED):** with a chat that has no messages, the write targets index -1
  (`msgs[len - n + i]`) and would set a stray array property rather than a message.
- **A weakened premise elsewhere.** Report 22 line 83 states "on mobile the remount resets it"; P1
  weakens that statement. Report 22 line 79 ("On mobile a switch remounts the composer...") rests on the
  same premise. Report 22 and `MC-100` 2 ("on desktop") are not edited.
- **Likely shape, unchanged:** the history keyed by owner `chaId` and chat id, reset on every read
  and write. It lives in the same history ownership as CHORE-54, so the Orchestrator recommends fixing the two in one
  change. The
  investigator's non-normative scoping, as Grep counts: the history state and its source accessors
  are in two production files (`DefaultChatScreen.svelte:67-69` and `:353-367`;
  `composerActions.svelte.ts`), and any change to the `ComposerActionsSource` shape touches the 16
  files that declare `lastCharId: {` (the two production files and 14 test fixtures).
- **A load-bearing risk (the investigator's note):** the reset after a send append (`:385`) must
  survive any key-based replacement, or "previous" after a new send would restore a reply from
  before that send.
- **Uncertain:** no browser run. A live check of D4 on the default phone layout (a window of 1024 px
  or less, beta mobile GUI off) would settle P1.

**Status (2026-10-02, latest): closed by `71e75d9d`, together with CHORE-54. Local, not pushed.** The text above is the
filing and investigation record and is unchanged. The empty-chat case, which the text above marks "Not run (INFERRED)",
was RUN later: the design-facts investigation (ledger row 634, finding F3) found a stray `-1` property on the message
array. What the `71e75d9d` commit message says it fixed:
- **The cross-chat write.** The reroll history belonged to a character index, and one history was shared by the composer.
  Rerolling in chat A and then pressing the left arrow in another chat of the same character, or in a chat switched to
  while the reply was still generating, could write a reply from A into that chat. A deleted lower-index character
  handed its history to the character that moved into its index. In an empty chat the arrow left a stray `-1`
  property on the message array.
- **Now:** one left/right history per chat, kept for the 5 most recent chats (the least recently used is dropped first),
  found by the chat itself and never by an index (`MC-169`). Histories survive Settings, the character list and a theme
  change (`MC-168`). They end when you send or continue in that chat, when auto mode generates there, when a new reroll
  starts from a different place, or on reload. They are kept in memory only.
- **Folded in** (each is stated in the commit message): a reroll that is stopped, fails, throws after appending or
  appends nothing still leaves the replaced reply reachable with the left arrow; group chats, where
  the stored pieces have unequal lengths and the left arrow overwrote an earlier speaker's message; a reply with several
  candidates steps through them only in the chat that produced it, and the candidate cursor cannot run past the last
  candidate; a reroll or arrow on a chat still loading from cold storage refuses with the message Send uses (it used to
  throw a `TypeError`); a reroll on a chat with no stopping point does nothing instead of throwing; an inline error
  joins only the reply this call is producing or continuing, and otherwise becomes a message of its own.
- **Nothing new is saved** (commit message). The histories and the candidate map are never written to the database or a
  save file. The only field the change adds to stored data is `Message.chatId`, which upstream already uses; it is
  filled on messages that lack one.
- **Orchestrator calls** (not maintainer decisions; plan invariants I14 and I15, and the limit): Continue ends its chat's
  history (I14; the Orchestrator's call, not asked of the maintainer); an inline error appends only to the reply this
  call is producing or continuing, and otherwise is a message of its own (I15, folded in from Gate 1 round 3's optional
  item 4 instead of a ticket); the limit is 5 chats, least recently used dropped first (`MC-169`). One more
  Orchestrator amendment, A1, came out of the reproducers: an empty shown piece is replaced by the next generation.
- **Evidence (the commit message, unless noted):**
  - Tests: `rerollHistory.svelte.test.ts` and `sendChatInlineError.svelte.test.ts` are new and hold 67 tests. Against the
    unchanged sources 39 fail (36 from the first writing, 3 reproducers added after the code review) and 28 pass (guards).
    Existing test fixtures that set `lastCharId` were moved to the new API.
  - Checks on the final tree: `pnpm test` 293 files, 5805 passed, 4 skipped; `pnpm check` 0 errors, 0 warnings; `pnpm
    build` ok.
  - Gates (`opus-reviewer`): plan Gate 1 round 1 `[REJECT]`, round 2 `[REJECT]`, round 3 `[APPROVE]`, then an amendment
    check for I15 and I16 `[APPROVE]`; code Gate 2 `[APPROVE]` with mutation testing in a scratch Vitest config, its
    survivors folded in as tests D2, D3 and D4 (reproducers) and D7 (a guard), and a remediation re-check `[APPROVE]`; the
    commit message's fact-check was `[EDITORIAL]` with seven corrections, applied before the commit. Ledger rows 637 to 641.
  - Live check (RUN, 2026-10-02; a production build of the final tree, the Echo model, the built-in pane at 486x914, a
    scratch Node server on port 6011 stopped afterwards): an edit survived step back and forward and a Settings open and
    close; a second chat's left arrow changed nothing there while the first chat's history kept working; switching chats
    during a 6-second generation left the second chat unchanged and the first chat stepped back correctly. One console
    error, Chrome's `beforeunload` notice from the preview navigation; no app errors.
  - **Not checked live:** group chats, multi-candidate replies, inline errors, cold chats and auto mode (tests only);
    WebView2, WebKit and Android.
- **Maintainer decisions:** `MC-168`, `MC-169`; the commit was made at "looks good to me. go ahead and commit."
- **Related:** CHORE-54 (closed by the same commit); `MC-100` 2 (superseded for the history's ownership and lifetime);
  `MC-151` 3; ledger rows 634 and 637 to 641.

### CHORE-44 — Auto mode cannot be stopped from a remounted composer

**Status (2026-10-03, UI session): closed.** Re-verified at HEAD `57e7be63` with no code change (`MC-200` 3; ledger row
802).

**Status (2026-09-28):** filed from Gate 2 round 1 of the composer stage's S1 (Report 22; ledger
row 284). **Fixed in `67f17f1a`**, folded into S2 (Report 22 section 7, D11 and D12; an `MC-091`
amendment; live-checked, ledger row 299). Present at `688b13e8` as well.

- **Mechanism (probe run by the gate reviewer):**
  - `autoMode` is per composer instance, and `runAutoMode`'s loop runs in the instance that
    started it.
  - After a remount (the mobile chat list, Settings), the new instance's toggle counts as a
    start, and S1's window refuses it.
  - The new instance's busy button aborts nothing: after the append, `abortChat` aborts the
    clicking instance's own controller, which is `null` in a new instance (Gate 1 round 1 of S2
    ran a probe). The old loop keeps running until the selected character changes. The same
    holds for an ordinary send's generation after a remount.
- **A likely shape:** keep auto mode's running state and the current generation's abort controller
  at module level, beside S1's window, so any instance's toggle or busy button stops it.

### CHORE-45 — The script cache misses every lookup on a repeat send in a long chat

**Status (2026-09-29):** filed from W2c-a's cache measurement (Report 40 section 6; ledger row
361), under `MC-069`. Present upstream. Not fixed and not scheduled.

- **Mechanism (measured by `perf-analyzer`, the eviction inferred from source):**
  - `processScriptCache` in `scripts.ts` holds at most 1,000 entries and evicts the oldest
    inserted; a hit does not refresh an entry.
  - A send inserts one entry per message of the prompt pass, plus the first message and the
    reply. From about 999 messages on, the end of one send evicts the entries the next send's pass
    reads first, and that pass then misses on every message.
  - Display and `editinput` entries share the map, so a real chat reaches the cliff earlier.
- **Cost:** on 998 messages with 8 `editprocess` scripts, a warm pass took about 10-13 ms and a
  cold one about 60 ms on an i9-13900K (dev build, node). Phones and Pi-class hardware are roughly
  10-15x slower.
- **Not a fix on its own:** an LRU refresh does not help a cyclic scan longer than the capacity.
  A likely shape is a capacity that follows the chat's length, or a separate cache per pass.
- **Related:** W2c-c (`MC-113`, Report 43) decides which prompt-pass results may be cached and
  leaves the capacity alone. This chore is decided after the memory-footprint work that follows
  W2e (`MC-119`).

### CHORE-46 — The self-hosted Node server cannot save a database larger than 100 MB

**Status (2026-09-30):** filed from the memory-footprint stage's persistence-side investigation
(ledger row 456), under `MC-069`. Present upstream. Not fixed and not scheduled.

- **Mechanism (source read by the Orchestrator; not run):**
  - `server/node/server.cjs` parses every `application/octet-stream` body with
    `express.raw({ limit: '100mb' })`.
  - `NodeStorage.setItem` (`nodeStorage.ts`) sends `database.bin` whole, as one such body, to
    `/api/write`.
  - A larger body is refused before the handler runs, so the save fails.
- **Seen in practice:** the maintainer's runtime `database.bin` is about 155 MB, and they use the
  Tauri build rather than self-hosting because of this limit (`MC-131` 3-4). They report the limit
  is well known among long-time self-hosters, who are told to export and delete unused characters
  regularly and keep chats and characters elsewhere. Local plain-HTTP hosting is the second most
  common platform.
- **Related:** the memory-footprint stage (`MC-119`, `MC-130`) moves chats out of `database.bin`
  into their own units, which shrinks the main file and may make this moot. Decide there whether
  the stage fixes it, or whether the limit is raised or the write split separately.
  `senior-advisor` (ledger row 459) recommends both: the per-chat stage first, then a streamed
  `/api/write` body into the temp file the handler already renames, rather than a higher limit,
  because `express.raw` buffers the whole body in server memory and a Pi 3 is a target host.

### CHORE-47 — A local backup silently leaves out every asset that is not a `.png` (DATA LOSS)

**Status (2026-09-30):** **fixed** (Report 48, ledger rows 461-467; `MC-133` 3), committed as
`d25a02fb`. Filed from the synthetic generator's format check (ledger row 458), under `MC-069`.
Present upstream (`upstream/main` has the same filter). The mechanism below describes the code
before the fix.

- **Mechanism (source read by the Orchestrator; not run):**
  - `saveAsset` in `globalApi.svelte.ts` names an asset `assets/<id>.<ext>`, taking the extension
    from the file name when one is passed. Four sites pass one: the asset pickers in
    `AssetInput.svelte`, `CharConfig.svelte` and `ModuleMenu.svelte`, and the risuext
    `additionalAssets` import in `characterCards.ts` (hub and legacy V2 cards, extension taken from
    the card unvalidated). An audio, video, WebP, JPEG, font or CSS asset added there keeps its
    extension. `.charx` and module import always save as `.png`, whatever the content, so their
    assets are backed up (ledger row 461).
  - `SaveLocalBackup` in `backuplocal.ts` skips every key that does not end in `.png`, on Tauri
    (the `readDir('assets')` loop) and on web (the `forageStorage.keys()` loop, where the filter
    also keeps out non-asset keys). The partial backup has the same filter.
- **Consequence:** those assets are missing after a restore, with no warning. Migration from and
  to upstream is by this backup (`MC-080`).
- **A likely shape:** include every key under `assets/` whatever its extension. Upstream's restore
  stores any non-database entry as `assets/` plus its name, so the result stays upstream-restorable.
- **Related:** the memory-footprint stage's backup work (stage 2 in `senior-advisor`'s sequence,
  row 459). The restore loop also sleeps 10 ms after every entry (about 300 s at 30,000 entries)
  and re-copies its pending buffer on every stream chunk.

### CHORE-48 — Inlay images are never included in a local backup

**Status (2026-09-30):** filed from CHORE-47's scoping (ledger row 461), under `MC-069`. Present
upstream (its `backuplocal.ts` has no inlay handling either). Not fixed and not scheduled; whether
upstream means this is unknown.

- **Mechanism (source read by the Orchestrator; not run):** inlay images, videos and audio inserted
  into chat messages are stored in their own LocalForage instance (`inlayStorage`, name `inlay`, in
  `src/ts/process/files/inlays.ts`), on every platform. `SaveLocalBackup` reads the asset store,
  the cold-storage payloads and the database, never the inlay store, so a backup restored on
  another device or browser has chats whose inlays are missing.
- **Open question for the maintainer:** should a backup carry inlays, and if so, how does upstream
  read them (its restore would store an unknown entry as `assets/` plus its name)?

### CHORE-49 — The self-hosted Node server does not boot when opened over plain HTTP

**Status (2026-09-30):** filed under `MC-144` from ledger row 485. It is present upstream since
`v2026.3.330`. Not fixed and not scheduled.

- **Observed (scratch production build, headless Chrome 154; ledger row 485):**
  - opening the Node server at a plain-HTTP LAN address stops at "Cannot read properties of undefined
    (reading 'generateKey')" during "Loading Local Save File";
  - no `/api` request is sent;
  - on localhost the app boots to the password prompt (first run and save not run); HTTPS was not
    run.
- **Mechanism (traced):**
  - `AutoStorage` selects `NodeStorage` before any capability test.
  - `NodeStorage` signs every request with a client-generated ES256 key through `crypto.subtle`,
    which a non-secure context lacks.
  - `server.cjs` requires that JWT on `/api/read`, `/api/write`, `/api/remove` and `/api/list`.
  - Upstream `61996dd2` (2026-03-03, "change server.cjs to jwt based approch") introduced this. Before
    it, the client hashed the password through the server, with no client `crypto.subtle`.
- **Who is affected:** users who open the Node server over a LAN IP or VPN without HTTPS. The
  maintainer reports these are most of the "local plain HTTP" group (`MC-143` 1, `MC-002`). From
  source, such deployments should have worked on upstream up to `v2026.2.291` (traced, not run), so
  users migrating from those versions would see the boot error.
- **Constraints for the fix:**
  - it must not weaken authentication on HTTPS or localhost;
  - how much transport security a plain-HTTP deployment may give up is the maintainer's decision;
  - a plain-HTTP origin also lacks Web Locks, OPFS and `crypto.randomUUID`, so any code that the fix
    makes reachable there must not assume them. Memory stage 1's boot pass already archives nothing
    without them (Report 49, D1).
- **Effect on the manual clean-up (Report 50, deferred N4):** without `crypto.subtle`, the clean-up's
  fingerprint of the main file is sampled, so a same-length change in bytes the sample skips goes
  unnoticed. Fixing this ticket makes that residual reachable on the Node server. The Node revision
  gives an exact alternative for that case. The same residual exists today on a static web build
  served over plain HTTP (it boots and saves, ledger row 485), where there is no revision to compare.

### CHORE-50 — The first run of a new self-hosted Node server fails until a reload

**Status (2026-10-01):** filed from ledger row 501. Present upstream since its `61996dd2`
(inferred from source; upstream not run). Not fixed and not scheduled.

- **Observed (Orchestrator, built-in pane, fresh scratch `save/`, production build of `d199b07b`):**
  - the app asks "Set your password to security";
  - after a password is entered, the boot stops with the alert "getItem Error";
  - network: `GET /api/test_auth` 200, `POST /api/crypto` 200, `POST /api/set_password` 200, then
    `GET /api/read` 400 with `{"error":"Unknown Public Key"}`;
  - after a reload the app asks "Input your password..." and the same password boots normally.
- **Mechanism (source read by the Orchestrator; not run beyond the observation above):**
  - Trigger: the server has no password set. `/api/test_auth` answers `unset` whenever the server's
    in-memory password is empty, and `server.cjs` loads it only from `save/__password`. That is the
    case on a first run.
  - `NodeStorage.checkAuth` (`src/ts/storage/nodeStorage.ts`): when `/api/test_auth` answers `unset`,
    it asks for a password, POSTs it to `/api/set_password`, and returns without calling `/api/login`
    and without setting `authChecked`. The `incorrect` branch is the one that sends the tab's public
    key to `/api/login`.
  - The client ignores the `/api/set_password` response: the `fetch` result is not checked.
  - `server/node/server.cjs`: `/api/set_password` only stores the password. `/api/login` is the only
    route that adds the public key's hash to `knownPublicKeysHashes`
    (`save/__known_public_key_hashes.json`). The JWT check on `/api/read` answers 400 "Unknown Public
    Key" for a key not in that list.
  - The private `readItem` (called by `getItem` and `peekItem`) turns the failed read into the thrown
    string "getItem Error", which the boot shows as an alert.
  - Origin: the client's set-password path is upstream `74f76255` (kwaroran, 2023-05-28, "[feat]
    nodejs hosting password"). The public-key list is upstream `61996dd2` (kwaroran, 2026-03-03,
    "change server.cjs to jwt based approch"). So upstream has had the same first-run failure since
    2026-03-03 (inferred from the source; upstream not run).
- **Who is affected:** anyone whose Node server has no password set, which includes anyone starting
  a new self-hosted Node server, once, on first run. Workaround: reload and type the same password.
  - **Empty `save/`:** nothing is lost (observed).
  - **A `save/` that already holds data but has no `__password`** (for example an old upstream save
    from before the 2023 password feature, or a deleted `__password`) takes the same branch. Source
    read by the Orchestrator, not run with a populated save: in `bootstrap.ts` the web and Node
    branch calls `forageStorage.getItem('database/database.bin')` before the decode `try`, so the
    "getItem Error" throw is caught only by the boot's outer catch, which shows the error alert. The
    boot ends before `setDatabase` and before the save loop starts, so nothing is written.
- **Constraint for the fix:** it must not weaken authentication. The password must still be required
  to register a key.
- **Fix direction (non-normative):** after setting the password, log in with the same password so the
  tab's key is registered, or have the server register the key sent with `set_password`.

### CHORE-51 — The manual clean-up deletes a unit that only an error-text chat inside a chat unit names (DATA LOSS)

**Status (2026-10-01):** filed from memory stage 1 step 4's Gate 1 (round 1, N6; ledger row 518; Report 55).
Open. Scheduled after memory stage 1 step 5 and before step 6 (`Agents/Live-State.md` work order,
2026-10-01). It predates step 4, and step 4 does not enlarge it.

- **Mechanism (the step 4 investigation and Gate 1, and the writer's reading of `KeepSet`; not run):**
  - `KeepSet` in `src/ts/storage/manualCleanup.ts` builds the set of units the clean-up must keep. For
    each stub it reads the blob once (`summarizeBlob`) and adds the blob's pointer keys and its legacy
    error-text keys (`listColdDataKeysFromDb` and `listRecoverableErrorKeysFromDb`) to the keep set.
  - It never reads a chat unit, so it follows no reference inside one (pointers included). In practice
    the reference is error text: `makeColdDataForChat` refuses a chat whose `message[0]` is already a
    pointer (and one that already holds the error text), so a chat unit that holds error text would come
    from upstream-archived data (inferred; frequency unknown). A unit named only by the legacy "Cold
    storage data could not be loaded. Key: ..." text inside a chat unit's first message is therefore not
    in the keep set, and the clean-up deletes it.
  - **Consequence:** that chat's Retry then fails, because the unit it points at is gone.
- **Uncertain:** whether real profiles hold such a chat unit. Upstream re-archived chats that held the
  error text (`MC-016`: the text is seen in the wild on upstream), so a chat unit can hold it; the
  frequency is not measured.
- **Related to step 4:** the local backup now follows references inside chat units as well as inside
  character archives (Report 55; `MC-147` 4), so a backup carries such units. The new pure
  `listInnerColdStorageKeys` in `src/ts/process/coldstorageData.ts` lists the pointer and error-text keys
  an archive value holds and is written so the clean-up can reuse it.
- **Cost of the fix:** following chat units means the clean-up reads chat units, where it now reads only
  blobs, so it changes the clean-up's read cost and step 1's gated design (Report 50). It is its own
  change, with its own gates.

**Status (2026-10-02, latest): closed by `59881788`, together with CHORE-52. Local, not pushed.** The text above is the
filing record and is kept; one sentence in it is wrong (see the correction below). What the commit message says it fixed:
- **Before:** the manual clean-up kept the archives that live memory, the saved main file and the snapshots reach, and the
  blob of each archived character. It never opened an archived chat. An archived chat can name another archive in its
  first message, by pointer or by the legacy "could not be loaded" text, so an archive reached only that way was listed as
  unreferenced and deleted.
- **Now:** the clean-up keeps every archive that any chain of archived chats reaches, by first-message pointer or legacy
  error text, from live memory, the saved main file and every retained snapshot, at any depth. Cycles end. Each archive is
  read at most once, one at a time, and every read finishes before the start listing and the first deletion. Only the keys
  a chat names are retained. A plugin's storage content is not searched, unless a chat links that unit too, and then it is
  read like any archived chat.
- **A missing or corrupt archived chat does not stop the run** (`MC-170` 1 and 3). A missing one is skipped: kept by name,
  nothing followed from it. A corrupt one (kind "damaged": the bytes are there but do not decode) is kept the same way. How
  often corrupt archives occur is unknown. Only a read error with no explanation, or a page with no OPFS directory API at
  all (which the load-time listing already rules out in practice), stops the run, before anything is deleted, with a new
  message (`coldStorageCleanupChatUnreadable`, in all seven languages) that names the character the chain was reached from
  and the source. A stub's blob that is missing, unreadable or belongs to another character still stops it, as before.
- **On the desktop app,** a read that fails without a kind counts as missing only when the load-time listing held no unit
  and the folder check reports the units folder absent. Windows reports a read inside a folder that does not exist as "os
  error 3", which was not classified as missing. The skip is safe because no unit was listed at load, not because the
  folder check proves the folder is absent. CHORE-73 records the part this does not cover.
- **Correction to the filing text.** The filing says `makeColdDataForChat` "refuses a chat whose `message[0]` is already a
  pointer (and one that already holds the error text)". Gate 1 found that upstream's `makeColdDataForChat` refuses only a
  chat whose first message is a pointer. It does not refuse one that holds the error text (TRACED in `upstream/main`). So
  upstream could archive a chat whose first message is the error text, and a chat unit holding it could come from upstream
  data. How many real profiles hold one is still unmeasured.
- **Not changed:** the save format and the backup and restore formats.
- **Evidence (the commit message, unless noted):**
  - Tests: `manualCleanup.svelte.test.ts` has 91 new archived-chat tests. With the key rule in place but without the
    clean-up change, 50 of the first 83 failed: 48 deleted a unit the run had to keep, the read-once test read
    `[1,1,0,0,0]`, and the no-storage test showed no notice naming the character (a message, not data loss). Of the 8 added
    after them, 4 are data-loss reproducers that fail the same way without the clean-up change (unit `V` deleted): a chain
    that starts at a main-file chat whose first message is error text, on each platform, and a units folder reported
    absent by `exists()` while units were listed at load. The Tauri missing-folder test passes without the clean-up
    change; it guards that reading archived chats does not block the asset clean-up when the units folder does not exist.
    The rest guard the folder rule.
  - Checks on the final tree (EXECUTED by the Orchestrator): `pnpm test` 295 files, 6230 passed, 4 skipped; `pnpm check` 0
    errors and 0 warnings; `pnpm build` ok with `VITE_RISU_LEGAL_CONFIGURED=TRUE`.
  - Gates (`opus-reviewer`): the plan, Gate 1 round 1 `[REJECT]` on stage B only (stopping on a corrupt chat is permanent
    and protects nothing; it became `MC-170` 3), round 2 `[EDITORIAL]`; stage B code, Gate 2 round 1 `[EDITORIAL]` (its finding 2, that Windows "os error 3" stops every
    run against `MC-170` 1, was marked non-blocking; the Orchestrator chose to fix it, and that fix was rejected in round
    2), round 2 `[REJECT]`, round 3 `[APPROVE]`, with 21 mutants in round 1. Round 2 reproduced that `exists()` is false on any metadata
    error (tauri-plugin-fs 2.5.2, `Path::exists`), so a folder rule built on `exists()` alone could delete silently; the
    fix also requires an empty load-time listing. The brief had specified `exists()` alone. The commit message's check was
    `[EDITORIAL]` with four corrections, applied before the commit. Ledger rows 642, 644, 645, 649 to 654, 655 (the translation of
    `coldStorageCleanupChatUnreadable`), 656 and 657.
  - Live check: none is recorded.
- **Note (not a ticket):** the existing string `coldStorageCleanupSaveUnreadable` still says "do not run cleanup". The gate
  judged that pointless advice for the new string, and it was not changed here. It could be folded into CHORE-73.
- **Maintainer decisions:** `MC-170`; the commit was made at "Commit both (Recommended)".
- **Related:** CHORE-52 (closed by the same commit), CHORE-73; `MC-011`, `MC-016`, `MC-134`, `MC-139`, `MC-141`, `MC-147`,
  `MC-170`; ledger rows 642 to 657.

### CHORE-52 — Cold-storage keys are not shape-checked before they reach a storage path (integrity hardening)

**Status (2026-10-01):** filed from memory stage 1 step 4's Gate 1 (round 1, N4; Report 55 section 7;
ledger row 518) and sized by the investigation in ledger row 521. Open. Scheduled after memory stage 1
step 5 and before step 6 (`Agents/Live-State.md` work order). **Severity: LOW.** This is integrity
hardening, not security: the hosted build is private-only, and the maintainer's framing is that peer
hardening is integrity.

- **What the investigation found (the `investigator`'s packet; counts are Grep counts, no Bash or git
  was available to it):**
  - **The key is spliced into the path with no shape check on all three backends**, not on Tauri only
    (TRACED, `src/ts/process/coldstorage.svelte.ts`: `getColdStorageItem`, `readLocalColdStorageBytes`
    and `setColdStorageItem`). There is no LocalForage cold-storage branch; the backends are the Node
    server, Tauri and OPFS.
  - **No traversal was found on any of them:**
    - Tauri: the fs plugin deserialises every path through `SafeFilePath::from_str`, which rejects a
      `..` component (tauri-plugin-fs 2.5.2, `file_path.rs`, as **read by the investigator** in the cargo
      registry copy; the Orchestrator did not re-open it). A rejected read is classified `error`, not
      `missing`, by `classifyTauriColdRead`, and a rejected write returns `false` (TRACED).
    - Node server: `/api/read`, `/api/write` and `/api/remove` accept only a hex `file-path`, and the
      client hex-encodes the whole key (`nodeStorage.ts`), so the key is a flat file name (TRACED).
    - OPFS: names carry the fixed prefix `coldstorage_` and suffix `.json` in a flat root. That
      `getFileHandle` rejects a name holding `/` is from the File System spec, not from source in this
      repo (INFERRED).
  - **Only reads and writes are reachable from a pointer-supplied key.** Removal (`manualCleanup.ts`)
    and listing take their keys from the directory listing, not from the database (TRACED).
  - **Where the keys come from:**
    - Fork writers make every unit key with `crypto.randomUUID()`, and V3 plugin storage with `v4()`
      (TRACED by the investigator).
    - Upstream does the same: `upstream/main:src/ts/process/coldstorage.svelte.ts` lines 394, 484 and 535
      use `crypto.randomUUID()`, and `upstream/main:src/ts/plugins/apiV3/v3.svelte.ts` line 1291 uses
      `v4()` (the Orchestrator's check, 2026-10-01). So every key that the fork and `upstream/main` write
      today is a UUID; keys written by older upstream versions were not checked.
    - A key that is not a UUID can still arrive: chat import pushes parsed chat objects into `chats`
      unmodified, so `message[0].data` can carry any pointer or legacy error-text key
      (`importChat` in `characters.ts`); the roots of a restored `.bin` are not filtered
      (`backuplocal.ts`); and any plugin that calls `setDatabase` can set `_coldplugin` values
      (`pluginCustomStorage` is in `allowedDbKeys`; the `db` permission gates only `getDatabase`, and V3
      `setDatabase` asks for no permission, `v3.svelte.ts`, checked by `doc-verifier` and the Orchestrator). Card import does not carry `coldstorage` or
      pointers on the V2/V3/charx path (TRACED); the RCC, old-Tavern and `.risum` paths were not read
      line by line.
- **The open question that a shape check does not fix: key aliasing.** A UUID-shaped key is valid, so a
  shape check lets these through (TRACED by the investigator, `pluginColdStorage.ts` and `preLoadChat`):
  - a crafted `_coldplugin` value equal to another unit's uuid makes the next plugin `setItem` overwrite
    that unit with the plugin value (`writePluginStorageValue` reuses an existing mapping value as the
    write target), and the plugin's `getItem` for that key returns the other unit's content
    (`readPluginStorageValue`);
  - a chat pointer equal to another unit's uuid makes `preLoadChat` restore that unit's messages into
    the pointing chat.
  - The mapping case is reachable from a crafted `.bin` or a plugin's `setDatabase`; the pointer case
    from a crafted `.bin`, a chat import or a plugin's `setDatabase`. Any plugin that calls `setDatabase`
    can already overwrite every character, so the plugin case adds damage to an archived
    unit that the database-level checks do not see (the investigator's reading), not a new privilege.
  - This needs ownership or provenance of a key, not shape validation. It is to be scoped when CHORE-52
    is worked, and may become its own ticket. Do not promise that the shape check closes it.
- **Fix direction (non-normative):**
  - one check in the three I/O functions named above, in `coldstorage.svelte.ts`;
  - a lenient "one safe filename segment" rule (non-empty; no `/`, `\` or NUL; not `.` or `..`) rather
    than UUID-only. Test fixtures use non-UUID keys: about 200 keyed lines in four files
    (`coldStorageDeletionGuards.svelte.test.ts`, `manualCleanup.svelte.test.ts`,
    `coldStorageBackupCollect.svelte.test.ts`, `backuplocalUnitClosure.test.ts`; Grep line counts with an
    approximate key pattern, not exact). 69 test files mention the cold-storage functions (Grep count);
    59 of them mock the module whole and are unaffected, and the other 10 are the ones to check;
  - a rejected key must read as `error`, never `missing` (the CHORE-07 contract), and write as `false`,
    so step 4's backup prompt still reports it as unavailable instead of dropping it.
- **Step 5 interaction:** the boot pass writes new units under `crypto.randomUUID()` keys, which pass
  either rule. It also reads existing roots at boot, and that is where the choice of rule matters: under
  a UUID-only rule a non-UUID legacy root would read as `error` (data kept, shown unreadable); under the
  lenient rule it loads as today (the investigator's inference).
- **Uncertain:** whether any real profile holds a non-UUID unit key (no data); OPFS and Windows
  device-name behaviour (a key such as `NUL` or `a:b` on Windows; not traced, integrity-only).

**Status (2026-10-02, latest): closed by `59881788`, together with CHORE-51. Local, not pushed.** The text above is the
filing record and is kept; where the corrections below differ from it, the corrections govern. What the commit message says
it fixed:
- **The key rule** (`src/ts/process/coldStorageKey.ts`). A key may become a storage name only if it is a non-empty string
  of at most 100 UTF-8 bytes, well-formed UTF-16, with none of `/ \ : < > " | ? *` and no character from U+0000 to U+001F
  (`MC-170` 4). A rejected key reads as unreadable ("damaged"), never missing; its write fails; no backend is called. The
  chat notice then hides a Retry that cannot succeed, and a restore shows its damaged-copy text. The listings leave out
  stored names the rule rejects, so they are never deletion candidates, and `removeUnitBatch` counts a rejected key as
  failed. Every key upstream or this fork has written passes: UUIDs and upstream's `<uuid>_accessMeta`.
- **The plugin overwrite guard** (`MC-170` 5). A plugin's `setItem` for a slot whose existing unit is also linked from a
  character's `coldstorage`, a `coldStoragedChats` entry, a chat's first-message pointer or error text, or another plugin
  slot is refused. It throws "Failed to write plugin storage for key: <key>" and leaves the unit and the mapping as they
  were. A slot nothing else links is still updated in place.
  - **The guard reads live memory only.** It does not see a link held only inside an unopened archive (a character's or a
    chat's), or only in the saved main file or a snapshot. This is wider than the option text the maintainer chose, which
    named only "a link that sits only inside an unopened character archive"; the wider gap was reported to the maintainer
    in chat before the commit.
  - **Cost** (measured with `--expose-gc` on best-case hardware, an i9-class machine): about 7 ms per in-place plugin write
    once the proxies exist, at 1000 characters with 4 chats each. The first pass builds Svelte proxies for every chat, which
    stay for the life of the page: about 16 MB at 1000 x 4 chats, about 70 MB at 1000 x 20. With archiving on (the
    default) there is about one chat per stub. Filed as CHORE-71 (`MC-170` 6).
- **Corrections to the filing text** (each from the investigation in ledger row 643 and the gates; the Orchestrator
  re-checked the `_accessMeta` history and the Tauri classifier):
  - **A rejected key did not always read `error`.** On a POSIX desktop, a Tauri read of `a/b` gives os error 2 and `exists()`
    false, so it read `missing` (TRACED; the POSIX errno is INFERRED). On the Node server, a key over about 115 bytes gets an
    empty 200 response and read `missing` (TRACED). The filing's premise that the backends turn a bad key into `error` does
    not hold, so the key check runs before any backend call.
  - **"The three I/O functions" was incomplete.** The key is spliced into a path or file name in three functions in
    `coldstorage.svelte.ts` (`getColdStorageItem`, `readLocalColdStorageBytes`, `setColdStorageItem`) and also in
    `removeUnitBatch` (a splice); the listings turn stored names back into keys, so the rule filters them there.
  - **Where the unit keys come from.** The filing says fork writers make every unit key with `crypto.randomUUID()`. That is
    wrong. The fork writes unit keys with the `uuid` package's v4 (the boot archive pass and V3 plugin storage);
    `crypto.randomUUID()` is upstream's. Source: Gate 2 stage A, which the Orchestrator verified against the code before
    the commit. Every one of these keys passes the rule.
  - **Test fixtures (a correction to the filing's file list).** The filing named `coldStorageBackupCollect` and
    `backuplocalUnitClosure` among its four files with non-UUID keys. Those two use UUID-shaped ids. The non-UUID fixture
    keys are in `coldStorageDeletionGuards` (68), `manualCleanup` (127), `coldReadKinds` (14) and
    `coldReadKindsDecodeStub` (7). The counts are the CHORE-52 investigator's heuristic per-file counts of kebab-case key
    literals, from its packet (not reproduced, and not in ledger row 643).
  - **Upstream's orphan units.** Upstream also wrote unreferenced `<uuid>_accessMeta` units between upstream commits
    `488ca25d` and `2b3b0f2d`; they are absent from tag v2026.4.120 on (the Orchestrator re-ran
    `git log upstream/main -S'_accessMeta'`). The rule accepts them, so the clean-up can still delete them.
- **The aliasing question the filing left open is answered only in part.** The plugin overwrite (a crafted `_coldplugin`
  value equal to another unit's uuid) is guarded as above, within the guard's live-memory limit. The pointer case (aliasing
  case B: a chat pointer equal to another unit's key) is **still open and out of scope**; it is not ticketed. As traced by
  the CHORE-52 investigator, it causes a cross-read only: `preLoadChat` restores the other unit's messages into the
  pointing chat. It cannot overwrite, because the fork has no chat-unit writer. A plugin's `getItem` cross-read is
  likewise unguarded and not ticketed.
- **Also in the commit:** the `setItem` note in `src/ts/plugins/apiV3/risuai.d.ts` now says the call also rejects when the
  slot's archive is linked from elsewhere (`git show --stat 59881788` lists the file, 5 lines changed; the wording was
  not re-read here).
- **Not changed:** the save format and the backup and restore formats.
- **Evidence (the commit message, unless noted):**
  - Tests: `coldReadKinds.test.ts`: the Tauri read of `a/b` (os error 2, `exists()` false) and the Node 116-byte key (empty
    200) failed with "expected 'missing' to be 'error'", and the `preLoadChat` contract failed with "expected 'missing' to
    be 'damaged'". Seen with the key-rule tests in place, before the key-rule production change. The rest of the key-rule
    tests are contract tests and guards, not reproducers. `pluginColdStorage.test.ts`: with the guard removed, 7 tests
    fail with "promise resolved "undefined" instead of rejecting" (the write goes through). `coldStorageKeyRule.test.ts`
    and `bootArchivePass.keyRule.test.ts` cover the rule and the boot archive pass with a rejected key.
  - Checks on the final tree and the gates are in CHORE-51's closure above (the two tickets share one commit). Stage A
    (this ticket) went through Gate 2 `[EDITORIAL]`: two false comments (a `randomUUID` claim, and one that read "missing"
    as "nothing was lost", which the reviewer found inverted); mutants (accept-all, guard off, guard judged on the database) were killed. Ledger rows 643, 646 to 648.
- **Out of scope, accepted and recorded** (not put to the maintainer): a restore writes units before the database commit
  and keeps them if the user cancels (designed); Tauri case folding of keys (NTFS, APFS) is not canonicalised; Windows
  reserved device names (`NUL`, `CON`) pass the rule (reachable by crafted data only); a plugin's `getItem` cross-read is
  not guarded. CHORE-72 records one more path that takes a name from an archive.
- **Maintainer decisions:** `MC-170` 4 to 6.
- **Related:** CHORE-51 (closed by the same commit), CHORE-71, CHORE-72, CHORE-73; `MC-011`, `MC-170`; ledger rows 643 and
  646 to 648.

### CHORE-53 — Delete actions act on a stale target, and Enter clicks the control behind a confirm (DATA LOSS)

**Status (2026-10-02): closed by three commits, not pushed:** `1ba98d45` (stage 53a, the keyboard), `5747a7e1` (53b,
every prompt-then-remove handler) and `07ea1882` (53c, the chat message delete). The maintainer's answers are
`MC-161`; the dispatches are ledger rows 606 to 616. The 2026-10-01 text below is the filing record and the list of
what was open then. **Post-merge checks on HEAD `cfa4dfa0`** (the merge of the rebranding branch, `MC-162`;
EXECUTED by the Orchestrator, logs in the session scratchpad `chore53/postmerge/`): `pnpm check` 0 errors and 0
warnings; `pnpm test` 284 files, 5413 passed, 4 skipped; `pnpm build` ok, with `VITE_RISU_LEGAL_CONFIGURED=TRUE`.

- **What each stage fixed** (from the commit messages):
  - **53a, `1ba98d45`:** while an alert that covers the page is shown (every alert except a toast), the page behind
    it and the dialogs drawn after it take no focus, clicks or keys, and keyboard focus moves to the dialog's box.
    Enter answers a confirm, or closes a notice, only when it is aimed at the dialog or at nothing; with a dialog
    button focused, Enter presses that button, so No means no. Shift, Ctrl, Alt or Meta with Enter, a repeat, or an
    Enter that ends a text composition never answers. A held Enter or Space never repeats a press on a button, link or
    other control anywhere in the app. Keyboard shortcuts do nothing while a prompt waits or a dialog covers the page.
    Enter does not close a notice or an error within 0.4 s of it appearing. The terms prompt and the stale-account
    notice ignore button clicks for 0.4 s. Decisions: `MC-161` 1, 2, 3b and 5. This is the ticket's layer 1.
  - **53b, `5747a7e1`:** each prompt-then-remove handler fixes its target at the click and, after the confirms,
    removes that same object if it is still in the list it was clicked in, or nothing: lorebook entries (three lists),
    regex scripts, V1 triggers, bot presets, lorebook presets, modules, personas, HypaV3 presets, translator presets,
    plugins, chat folders and a HypaV3 summary's "delete this". Also the lorebook folder delete, HypaV3's "delete
    after" and reset, the Playground's inlay delete and the trigger-type switch. `removeChar('permanent')` skips a
    character restored from the trash while its confirms were open. The "last entry cannot be deleted" guard is
    checked again at removal. This is the ticket's layers 2 and 3. The commit message lists these defects in the same
    handlers as fixed as well: a chat lorebook entry delete that also removed the entry below it when the entry carried an id (a defect
    on HEAD, the Gate 1 finding G1); a lorebook folder with a missing or empty key removing every top-level (or every
    empty-folder) entry; a plugin re-import replacing the plugin at a position found before the confirm; and HypaV3's
    bulk re-summary applying to the wrong summaries after one was deleted.
  - **53c, `07ea1882`:** the chat message delete fixes the character, chat and message at the click, and removes
    nothing if any is gone. The second question ("remove just one message?") has three choices: only this message,
    cancel, and this message and every message after it. **Fork-only wording; upstream asks Yes/No** (`MC-161` 3c).
    Every prompt asked through the prompt queue ignores clicks, taps and keys for its first 0.4 s (`MC-161` 5), which
    also stops a double-click answering both of a flow's confirms (measured for the chat message delete, on a stand-in
    and in the built app; traced, not measured, for the character delete's two confirms).
- **What ran, per the commit messages:** tests were written before each change and checked against the previous
  commit's source. 53a: 240 new tests in seven files: 129 fail against the previous source, the 103 guards pass, and the other 6 test the
  new key-event snapshot module on its own; two of the 240 were added after review.
  53b: 189 new tests in 15 files, 120 fail against the previous source of the 21 production files and the 69 guards
  pass. 53c: 26 new tests, 21 fail and 5 pass (guards) against the previous source. Each commit records a full
  suite, `pnpm check` and `pnpm build`: 5398 (53a), 5413 (53b) and 5377 (53c) tests passed (284 files, 4 skipped),
  check 0 errors and 0 warnings, build ok. The 53a and 53c messages say these ran on the working tree with the other
  stage or stages present and not yet committed. The gates: 53a Gate 1 had a
  capture-blocker design rejected three rounds running (`adversarial-reviewer`), was escalated to `senior-advisor`
  and redesigned, then `[REJECT]`, `[REJECT]`, `[EDITORIAL]`; its Gate 2 (`opus-reviewer`) was `[EDITORIAL]`. 53b: Gate 1
  `[REJECT]`, `[EDITORIAL]`; Gate 2 `[EDITORIAL]`, `[EDITORIAL]`. 53c: Gate 1 `[REJECT]`, `[EDITORIAL]`; Gate 2 `[REJECT]`,
  `[EDITORIAL]`.
- **Live check (EXECUTED, the Orchestrator, ledger row 616):** the built app in Chromium, synthetic data, on the tree
  with the three stages uncommitted. A covering dialog held focus; after a mouse click on a lorebook entry's delete,
  five Enter presses removed that entry only and clicked nothing behind the dialog; Enter on No deleted nothing; the
  three-choice question survived a double-click on the first confirm's Yes.
- **Not run:** a real held-key auto-repeat (the pane sends discrete presses); the portalled trigger editor live; the
  bot preset's trash by keyboard; a confirm raised while typing; Shift+Tab out of the dialog; Firefox and WebKit;
  Android; Tauri; IME. The real app for lists other than the lorebook entry delete (the 53b commit message). No
  test loads `App.svelte`, so its two inert scopes are shown by the live run only.
- **Known and left (not defects of this ticket):**
  - Escape, Tab and browser keys (reload, copy, zoom, developer tools) are deliberately not intercepted (the 53a
    commit message), so `MC-161` 1's "no key reaches the page" does not cover them. Escape over Settings with a notice
    showing closes both (`MC-109` behaviour, unchanged); the Gate 2 reviewer (`gate2a-r1.md` finding 2, executed) noted
    this is in tension with `MC-161` 1, called it an optional follow-up and the maintainer's call.
  - Modals at z-index 50 that come after the alert component in drawing order paint over it (separate).
  - `isLocallyActivated` has a display quirk: it matches by id (display only).
  - V3 plugins' own document key listeners keep receiving keys while an alert is up, as on upstream; the partial-edit
    floating buttons stay reachable by mouse (`MC-161` 6).
- **Follow-up candidates, not filed as tickets** (out of scope; Gate 1 finding 12 of 53b, a reviewer's list; the
  first group is non-destructive, and the second is INFERRED from Svelte 5 prop semantics, not run):
  - wrong-target writes after an await: the SideChatList copy and persona bind, export by index, and the Sidebar
    folder rename, colour and image;
  - a folder delete in a module's lorebook assigns a non-bindable prop, so the module keeps the entries;
  - the MCP delete tools take the first name match.
- **Filed from the same gates:** CHORE-64 (a plugin's `setDatabase` can delete every installed plugin; closed
  2026-10-02 by `48f00223`).

**Status (2026-10-01, the filing record):** filed from the community reports in `MC-150` and the investigation in ledger
row 523. Open. Scheduled right after memory stage 1 step 5 and before CHORE-63, CHORE-43, CHORE-54, CHORE-51 and CHORE-52
(`MC-150` 4; `Agents/Live-State.md` work order). It is the concrete held-Enter finding behind CHORE-03.
It is reported on upstream too: the community reports are observations of upstream builds (`MC-011`).

- **The reports:** characters outside the trash were permanently lost when the user deleted from the
  trash with Enter (held down, in report 3), one reporter thinks a few characters inside folders were
  lost too, and lorebook entries below the deleted one were lost the same way. Report 1 says "emptied the
  trash"; no bulk empty-trash action exists, so which path it was is unknown. The reports are quoted in
  `MC-150`; "deleted" means permanently deleted.
- **Already fixed: the character trash case** (ledger row 523; TRACED and EXECUTED on the real
  components, with the keyboard modelled):
  - upstream's `015848cf` ("character deletion reliability in trash (chaId based lookup)",
    2026-07-22) looks the target up by `chaId` after the confirms;
  - the fork's `2420d717` (2026-09-25) looks it up by object reference after the confirms, and
    `c0b323b0` (2026-09-29) serialises prompts, one answer per prompt;
  - on upstream before `015848cf` the symptom reproduced: ten flows each captured index 1, were answered,
    and spliced index 1 in turn, leaving one live character of eight. On `upstream/main` (`f9728b14`) and
    on the fork (HEAD `5f1ecdf9`) the same scenarios removed only the trashed character the user aimed at,
    or nothing. Which upstream release the community had cannot be established from the repo.
- **Open defects, on both trees** (`upstream/main` and the fork; the delete handlers in these files are
  identical to `upstream/main`'s; the files differ elsewhere):
  - **Enter answers a prompt and also clicks the control behind it.** The Enter block in
    `src/ts/hotkey.ts:306-316` sets the alert store to answered and does not call `preventDefault`. The
    dialog never takes focus (`btn` is declared and never bound, `AlertComp.svelte:67,139-140`), so the
    focused delete button behind it keeps focus. EXECUTED in headless Chromium 154 on a minimal stand-in
    page (not RisuAI): each keydown, auto-repeats included, is followed by `keypress` and a button
    `click`, and `preventDefault` on the keydown stops both. WebKit and Firefox are INFERRED only. On the
    fork `!ev.repeat` (`hotkey.ts:306`) stops a repeat from answering, but each repeat still clicks, so a
    held Enter queues copies of the same delete flow.
  - **Per-row deletes that splice a position.** Lists below; the lorebook entry delete is EXECUTED on the
    real components, the others are read from source and **not run**:

    | List | Delete code | Notes (the investigator's) |
    |---|---|---|
    | Lorebook entries, `LoreBookData.svelte:155-190` and `LoreBookList.svelte:372-401`, `:423-452`, `:474-503` | `lore.splice(i, 1)`, `i` the unkeyed `each` position, read after the confirm | EXECUTED: 8 entries, hold on the second; on `upstream/main` and `pre`, one answer after the hold leaves only the first entry; on the fork, held-then-tapped Enter or click-then-tapped Enter leave only the first entry; a held Enter alone, or a hold plus one mouse answer, removes only the second. A folder with children has two confirms |
    | Regex scripts, `RegexData.svelte:98`, `RegexList.svelte:72-77` | `customscript.splice(i, 1)` | one confirm |
    | Trigger V1, `TriggerV1Data.svelte:48`, `TriggerV1List.svelte:87-91` | `triggerscript.splice(i, 1)` | one confirm |
    | Bot presets, `botpreset.svelte:250-254` | `botPresets.splice(i, 1)` | the row's trash is a `div` whose key handler clicks on every Enter keydown, repeats included, so held Enter fires clicks on both trees whatever `!ev.repeat` says; the `length===1` guard is before the await only |
    | Lorebook presets, `lorepreset.svelte:40-44` | `loreBook.splice(ind, 1)` | same `onkeydown` as bot presets |
    | Personas, `PersonaSettings.svelte:149-154` | `personas.splice(DBState.db.selectedPersona, 1)`, selection read after the await | a second flow deletes persona 0, and so on |
    | hypaV3 presets, `OtherBotSettings.svelte:1107-1115`; translator presets, `TranslatorPresetSettings.svelte:93-100` | `presets.splice(id, 1)` | the `id` is read at `:1107` (hypaV3), before the await; one confirm |
    | Chat messages, `Chat.svelte:266` and `:272` (range 257-275) | `msg.splice(idx, 1)` | `idx` is a prop; there is an await only when `askRemoval`, `instantRemove` or the `rec` argument is on; 1-2 confirms; a No on the instant-remove confirm truncates from `idx` onward |
    | Chat folders, `SideChatList.svelte:209-215` | `folders.splice(i, 1)` | one confirm; same `onkeydown` Enter -> `click()` as bot presets (`SideChatList.svelte:203-206`) |
  - **Instant-remove truncation (related).** In the chat-message delete above, a No on the instant-remove
    confirm truncates the chat from `idx` onward. This is a related data-loss path, listed but not traced
    (see Uncertain).
  - **Module delete.** `ModuleSettings.svelte:126-134` reads `rmodule`, an unkeyed-each item that is a
    live binding to whatever the slot holds, after the await, then finds it by id and splices. A repeated
    flow on a non-last row removes the module that moved into the slot. If the old module is no longer in
    the list (INFERRED for a last row whose block was destroyed), `findIndex` returns -1 and
    `modules.splice(-1, 1)` removes the last module. TRACED plus compiled output (svelte 5.56.8), not run.
  - **A pending permanent character delete does not re-check `trashTime`.** `removeChar` in
    `src/ts/characters.ts` resolves its target by reference after the two confirms and, for
    `'permanent'`, splices without checking that the character is still trashed. A character restored
    while its confirms were pending is removed. EXECUTED at store level (T2); the keyboard path to it
    (Shift+Tab to Undo, Enter) is INFERRED, and other ways to un-trash it in that window (a plugin's
    `setDatabase`, a second tab's save) were not swept.
- **Fix direction (non-normative; the investigator's opinion, three layers):**
  1. The Enter that answers a prompt stops the keystroke (`preventDefault`), and held repeats are
     swallowed while a prompt is up. This is the shared cause for every delete list above.
  2. Every delete handler re-resolves its target after the await, by reference or id, and skips when it
     is gone, as `removeChar` does for characters and `removeChatConfirmed` does for chats. Capture the
     target object before the await; do not read an unkeyed-each item or index after it.
  3. `removeChar('permanent')` re-checks `trashTime` after the confirms and returns before `stopWorkIn`,
     so that a skipped delete does not abort work in the character (`MC-103`, `MC-129`: a confirmed delete
     aborts all work in the entry actually removed, and warns when it is busy).
  - A key-ordering change alone is not a substitute for layer 2: the fork's prompt queue still lets a
    user answer several identical dialogs.
  - The 400 ms answer guard and the prompt queue in `alertPrompts.ts` are what turn Enter-spam on the
    fork from one answer resolving every pending flow into one answer per prompt. They must stay.
  - `MC-115` 3 says Enter on the alert itself keeps `MC-109`'s behaviour, and `MC-067` leaves "Enter
    confirming an open alert" unchanged. Layer 1 changes that block, so it needs its own decision.
  - Layer 1 changes every confirm in the app, so it needs its own plan.
- **Uncertain:**
  - WebKit and Firefox key behaviour, and focus on Safari and mobile (INFERRED from the Chromium probe);
    the settling observation is to open the trash with two trashed rows, focus a Trash button by keyboard,
    press Enter once and record whether a second dialog queues on the next Enter, with synthetic data only
    (`MC-131` 1).
  - An Enter on the focused NO button writes `yes` before NO's click runs (INFERRED, not run).
  - Whether the nine other lists besides the lorebook entry delete (eight rows of the table above; the
    module delete is tracked separately) fail as the lorebook does: none of the nine was run.
  - For the hypaV3 and translator presets, the `id` is captured before the await, so a second flow can
    remove a different preset: the same stale-captured-index mechanism the pre-fix character delete had
    (INFERRED, not run).
  - `TODO(evidence)`: the instant-remove truncation path in the chat-message delete is listed, not traced.
  - A replaced character object (a reload that swaps objects, a cold-storage restore at that slot) makes
    the reference lookup in `removeChar` find nothing, so a confirmed delete does nothing: the safe
    direction, but the user sees "I confirmed twice and nothing happened" (INFERRED, not tested).
  - `TODO(evidence)`: which release the community build was.

### CHORE-54 — Rerolling or going back through rerolls overwrites an edited reply with its generation-time copy (DATA LOSS; upstream and fork)

**Status (2026-10-01):** filed from the investigation in ledger row 528 (packet in the session scratchpad,
`rerolledit/packet.md`, at HEAD `756e8210`), after the maintainer relayed two possibly unconfirmed
upstream bug reports (`MC-151` 1). Open. Scheduled after CHORE-53 and after CHORE-63 with CHORE-40, together with CHORE-43 (`MC-151` 3; `MC-160` 3);
fixing both in one change is the Orchestrator's recommendation (below). Present on `upstream/main` `f9728b14` by source read (upstream not run) and on the
fork. The Orchestrator verified the core of the mechanism, F1 and F2 below, in
`src/ts/process/composerActions.svelte.ts`.

- **The report (verbatim, `MC-151` 1):** "Edits made on LLM's output reverts back to original when user
  returns to the message after either switching the chat or rerolls the message."
- **Mechanism (F1; TRACED and RUN):** an edit never updates the reroll history, so the previous and
  next arrows restore a stale copy over the edited reply.
  - Nothing writes `rerolls[...]` except the push of a `safeStructuredClone` of the new messages after
    a generation (`composerActions.svelte.ts:567`), the first-reroll snapshot (`:470`, also cloned) and
    the resets (`:385`, `:220`, `:446`, `:511`).
  - The edit surfaces write only the database: `edit()` (`Chat.svelte:278-293`,
    `message[idx].data = newText` at `:286`) and `handlePartialEditSave` (`Chat.svelte:358-371`).
  - `reroll()` (the "next" branch, `composerActions.svelte.ts:457-467`) and `unReroll()`
    (`:522-533`) assign `msgs[len - n + i] = safeStructuredClone(rerolls[id])`. They overwrite the
    last n messages with the stored copy and never write the on-screen value back to the entry being
    left. The history holds clones, so an edit to the database message cannot reach it.
  - **Saved, not display-only (F6; TRACED to the database write, the save not traced):** these
    assignments go through the same reactive store the pencil's `edit()` writes. The save loop
    observes it (`registerDbChangeEffects`, `globalApi.svelte.ts:1103-1120`, as cited by the
    investigator) and CHORE-43 above states its overwrite "is saved". The investigator did not trace
    the save from this write to the file.
- **Multi-candidate replies (F8; TRACED, not run):** when a response yields more than one candidate,
  `reroll()` and `unReroll()` check `Prereroll`/`PreUnreroll` first
  (`composerActions.svelte.ts:449-456`, `:514-521`) and assign `message.at(-1).data = r`. The map is
  module-level in `src/ts/process/prereroll.ts`, keyed by `generationId`, never updated by an edit,
  and it survives remounts and chat switches. `addRerolls` is called from `index.svelte.ts` (the
  investigator cited `:2398-2400`, which is the `mrerolls.length > 1` call; a second call site at
  `:2269` was not in the packet and was not traced). `prereroll.ts` has no diff against
  `upstream/main` (checked, `git diff upstream/main HEAD --stat`). It needs a multi-candidate
  generation to run, so it was not run. Rare.
- **Scenarios (RUN, scratch Vitest against the real `composerActions.svelte.ts`; the edit is
  simulated as the same database write `edit()` does; the generation is a stub that appends one
  reply, so these show the composer's own history and write behaviour, not the real `sendChat`):**
  - **D1:** `send()` leaves the history `[[R0]]` at id 0, so the generated reply is the stored
    copy. Edit R0 to "R0-EDITED". `reroll()` gives `[[R0],[R1]]` at id 1. `unReroll()` puts "R0" on
    screen. The edit is gone.
  - **D2:** reroll to R1; edit R1 to "R1-EDITED"; `unReroll()` shows R0; `reroll()` ("next") shows
    "R1". The edit is gone and cannot be recovered: it was never stored.
  - **D3 (control; the edit survives):** edit before the first reroll of an empty-history instance.
    The first-reroll snapshot (`:469-472`) captures the edited text, and `unReroll()` returns
    "R0-EDITED".
  - **Rule (the investigator's interpretation):** an edit survives only if the first reroll of that
    history happens after the edit. After a normal send in this component instance the history
    already holds the generation-time reply (`sendMain` resets at `:385`, then `sendChatMain` pushes
    the new reply, `:565-569`), so the snapshot branch is not reached. It fires only for a chat
    loaded from disk, after a character switch, or in a fresh instance.
- **What does not cause it (F3; TRACED):** a chat switch alone does not revert a committed edit.
  `edit()` writes the database message and clears its draft. `changeChatTo`
  (`globalApi.svelte.ts:3478-3514`) writes only `chatPage` and bumps `ReloadGUIPointer`, and
  `Chats.svelte` remounts instances from the database (`message: message.data`,
  `Chats.svelte:111-141`). So "switch chat, return, edit reverted" needs one of the paths below to
  run afterwards. A switch to a different character resets the history (`lastCharId` differs), so
  the history paths need the same character. A same-character path (RUN-consistent with D1 and D2):
  edit the newest reply, switch to another chat of the same character and back, press previous then
  next (or reroll then previous).
- **Other mechanisms that read as the same report (each from the packet):**
  - **F4 (TRACED), an editor that is open but not committed is lost on reroll or on a chat switch.**
    A commit happens only through the pencil, for the inline editor (`toggleOriginalEdit`, then
    `edit()`). On upstream the
    typed text is gone once the instance remounts (Report 20 section 2.1). The fork mitigated this in
    `e250089a` (2026-09-24, "keep unsaved message edits across involuntary unmounts"): the typed text
    is kept as an in-memory draft restored when the user reopens the editor, with an "Unsaved edit
    restored" bar. The message itself is not changed, so the reply on screen shows the saved text.
    No saved data is overwritten.
  - **F5 (TRACED in upstream source; not run in a browser), upstream only.** In upstream's
    `Chat.svelte` the editor's textarea is `bind:value={message}` with
    `handleLongPress={() => { editMode = false }}`; `edit()` is the only write to the database from the
    inline editor (the partial edit has its own `handlePartialEditSave`, upstream `Chat.svelte` L165-177,
    by source read) and runs only from `toggleOriginalEdit`. After the long-press the bubble keeps showing the edited
    local text while the database holds the original, and any remount re-reads the original.
    Display-only; the edit was never saved. The fork's `editBuffer` (`e250089a`) makes the discard
    visible at once, so it does not occur there. The `longpress` action uses mousedown and mouseup
    (`src/ts/gui/longtouch.ts`), so a held mouse button triggers it; that a touch long-press does not
    is INFERRED.
  - **F7 (UNCERTAIN; TRACED code, INFERRED effect; not run):** "Edit translation" (only with
    `translatorType === 'llm'` and translation on) writes only the LLM translation cache, never the
    message. `translated` is per-instance state, so after a remount the bubble shows the untranslated
    text until translation is toggled again, unless auto-translate is on (`ChatBody.svelte:83-102` sets
    `translated` from `db.autoTranslate` after a remount). A possible reading of the report,
    display-only.
- **Upstream versus fork (the investigator's table):**
  - F1 and F8: present on both. The history logic moved from `DefaultChatScreen.svelte` to
    `composerActions.svelte.ts` in `1bc5f288` (2026-09-28); `9213ebc2` narrowed the clone to the new
    messages (mirroring upstream `0e56b763`); the semantics are unchanged. Upstream's lines are
    `DefaultChatScreen.svelte` L222-248, L289-294 and L316-317 (by source read; upstream not run).
  - F4: present upstream, mitigated on the fork (`e250089a`). F5: present upstream, absent on the
    fork (`e250089a`). F7: present on both.
- **Classification (the investigator's):** report 1 after a reroll or previous/next is DATA LOSS (a
  saved overwrite of an edited reply by a stale history copy), on both builds (F1, F8). The database
  overwrite is TRACED; that it reaches the saved file is INFERRED (F6). Report 1 after switching chats has no single mechanism: the same-character F1 path is data loss on both
  builds; F4 and F5 are display-only and upstream-only; F7 is display-only. Report 2 is CHORE-43.
- **A likely shape (non-normative):** before moving the cursor, `reroll` and `unReroll` write the
  current on-screen messages (`rerollData.length` of them) into the history slot being left. One site
  pair in `composerActions.svelte.ts`. It covers the inline edit, the partial edit and trigger edits.
  F8 needs the same capture in `prereroll.ts`. Keep the first-reroll snapshot (`:469-472`): it is the
  only reason an edit made before the first reroll survives today, and an empty history would lose
  the original reply without it.
- **Fix it together with CHORE-43.** Both live in the same history ownership: the reroll history
  that `composerActions.svelte.ts` and `DefaultChatScreen.svelte` hold per composer instance, which
  CHORE-43 proposes to key by owner `chaId` and chat id. Edit surfaces that bypass the history
  today: `edit()`, `handlePartialEditSave`, and any trigger, regex or plugin write to
  `message[i].data`.
- **Uncertain, and what would settle it:**
  - Which edit surface the reporter used (the pencil toggle, a held mouse button in the editor, the
    partial edit, or a translation edit), and whether the reply was generated in the same session.
    Without it F1, F2, F4, F5 and F7 cannot be ranked by likelihood.
  - F5's trigger on a touch device is INFERRED. Settle it with a real-device check: long-press the
    edit textarea in an upstream build and see whether `editMode` closes.
  - No browser run: the hash-driven remount, the long-press and which chat-switch paths remount the
    screen are TRACED, not observed.
  - The save path from the reroll write to the file was inferred (F6).
  - The empty-chat `msgs[-1]` write in CHORE-43 was not run.
  - Hosted multi-device or multi-tab save conflicts could also revert edits; the investigation did
    not look at them.
- **Questions for the reporter (through the maintainer):**
  1. Which way was the reply edited: the pencil, then the same pencil to save; a held press in the
     editor; the partial edit; or the translation edit?
  2. Was the reply generated in that same session, or was the chat loaded from disk?
  3. For "switching the chat": was it another chat of the same character, and was a reroll or the
     previous/next arrow pressed afterwards?
  4. Which build and which layout (the default phone layout, the beta mobile layout, or desktop)?

**Status (2026-10-02, latest): closed by `71e75d9d`, together with CHORE-43. Local, not pushed.** The text above is the
filing and investigation record and is unchanged. What the commit message says it fixed for this ticket:
- **An edit to the shown reply is stored before the cursor moves**, so it is still there after a step back or forward.
  Rerolling or stepping back no longer overwrites an edit, including an edit of a reply with several candidates (F1, F8
  above).
- **The history is checked before it is written.** A step back or forward writes nothing unless the messages on screen
  after the reroll point are the ones the history stored; if they are not, the history ends and the chat is left as it is.
  Before, the history was laid over "the last n messages" without checking, so after the shown reply was deleted, or an
  error message was removed and a message added, the left arrow overwrote the user's own message; in a group chat it
  overwrote an earlier speaker's message; and a message deleted while a reroll was generating left the reply out of the
  history or stored it in part. Messages added or removed further up the chat do not end the history; removing or
  duplicating the message the reroll answers does.
- **Evidence, gates, the live check and what was not checked** are in CHORE-43's closure above; the two tickets share one
  change. The edit-survival path was in the live check (an edit survived step back and forward and a Settings open and
  close).
- **Not addressed by the commit message:** F4, F5 and F7 above (the open-but-uncommitted editor, upstream's long-press
  discard, and the translation edit). They are described above as display-only or upstream-only; nothing in the commit
  message or the live check claims to change them. The save path from the reroll write to the file (F6): the
  design-facts packet lists it as not traced. The follow-up recorded in ledger row 634 says the save path marks the
  whole character block; that follow-up exists only as the investigator's report back to the Orchestrator, not as a file,
  and was not re-verified.
- **Related:** CHORE-43; `MC-168`, `MC-169`; ledger rows 634 and 637 to 641.

### CHORE-55 — Tauri main-file writes are not atomic (a failed write can leave a partial `database/database.bin`)

**Status (2026-10-03, stage 4, latest): stage 4 (cold-storage units, the OPFS switch removal and the copy-back) is done
by `980791fa` (local, not pushed); Gate 2 closed `[EDITORIAL]`.** Stages 0 to 4 are done. The older status blocks below
are kept as they were; where this block differs, this block governs. Ledger rows 718 to 731 are the stage 4 work (the
facts investigation, the phone check, Gate 1 in three rounds, the implementation in two parts, the translations, Gate 2
in two rounds with the remediation, the commit message draft and its check); rows 732 and 733 are these records and their
fact-check; rows 734 and 735 are the `MC-181` records and their fact-check. `MC-180` records the maintainer's answers. The text of this block comes from the commit message (`git log -1
980791fa`, fact-checked by the Gate 2 reviewer before the commit, ledger row 731) and the session's gate and plan files;
the AVD figures are from `avd\result.md` in the session scratch.

- **What stage 4 changed (from the commit message):** archived chats and plugin data (cold-storage units,
  `coldstorage/<key>`) go through the one byte store, and the Backup & Files switch that put a profile on OPFS is removed.
  OPFS receives no new data except from a page whose copy-back could not run.
  - Units (`coldstorage.svelte.ts`, new `coldUnitLocation.ts`): a unit is a value in the page's byte store under
    `coldstorage/<key>`; on Tauri the key keeps the existing `.json` suffix (the files already on disk), on Node the server
    file names are unchanged. The per-platform names are decided in one module.
    - Read: the store first. Only when it holds nothing, and only on the web, the legacy OPFS file
      `coldstorage_<key>.json` is read; a unit in the store is never shadowed by its legacy file. A failed store read is an
      error and never falls through to OPFS. A key the cold-key rule accepts but the store refuses (such as one with a
      leading dot) reads as kind damaged and writes `false`. A store that cannot be opened reads as kind unavailable.
    - Write: the page's store only; a legacy file is never written. On Node a write presents the version this page last
      read or wrote for that unit, so a unit another device changed in between is refused (`false`) as before; a unit never
      read, or deleted by this page, is written unconditionally. On Tauri a unit write is now the adapter's temp file and
      rename, so a failed write leaves no partial unit (before, a plain `writeFile`).
    - Delete (manual clean-up): on the web the legacy OPFS file is removed first, then the store entry; a unit counts as
      deleted only when both succeeded. The clean-up deletes through the store in groups of 20 on Node and one unit per
      call elsewhere; a failed call does not stop the next.
    - Listing (load-time and clean-up start): the store's `coldstorage/` entries (on Tauri only top-level `.json` files),
      united on the web with the legacy `coldstorage_*.json` names. A browser without `navigator.storage.getDirectory`
      lists the store only; a `getDirectory` that rejects fails the whole listing, as before.
    - Tauri boot: leftover temp files in `coldstorage/` are removed before the boot archive pass can write there, when the
      folder exists.
  - The OPFS switch is removed: `enableOpfs`, `disableOpfs` and the OPFS panel in `StorageMaintenanceSettings.svelte` (the
    asset-integrity panel stays). `AutoStorage` no longer selects OPFS, no longer copies LocalForage into it and no longer
    carries `opfsSwitchNotice`. 13 strings are removed and 5 added (the progress text and four fallback notices), in all
    seven languages. The English wording says "browser storage" (`MC-180` 7).
  - Copy-back at startup (new `storage/opfsCopyBack.ts`, run from the web branch of the store selection). A profile with
    `opfs_flag!` set is classified from the flag, the IndexedDB main file and the IndexedDB `migrated` marker:
    - flag unset: not OPFS-main; IndexedDB is used and nothing in OPFS is copied;
    - flag set, IndexedDB holds the main file and no marker: the move to OPFS never completed, so IndexedDB is current;
      the flag is cleared and nothing is copied. The same applies when the browser cannot write OPFS files (no
      `createWritable`), because HEAD served IndexedDB there;
    - flag set otherwise (no IndexedDB main file, or the marker present): OPFS is current and is copied back.
    The inputs are read again under the exclusive storage-migration lock. The copy writes every hex-named OPFS file into
    IndexedDB, compares the main file by SHA-256 against its read-back, and only then sets the clean-up marker, removes
    the flag and removes `migrated` (best effort). The page uses IndexedDB only if the flag removal succeeded. If OPFS
    holds no main file there is nothing to copy: the flag is cleared and IndexedDB is used. Progress shows through the wait
    alert every 25 files.
    - If the copy cannot run or finish (lock not granted, not enough free quota, a changed or failed copy, IndexedDB
      unsupported), the keys written by the attempt are removed from IndexedDB, the flag and OPFS files are left as they
      were, and the page runs from OPFS as at HEAD with a notice (another tab, space, no IndexedDB, or the error). The
      next start tries again. A tab that loses the lock while a reload is pending stops without reading or writing; one
      that finds the flag cleared by the winning tab uses IndexedDB.
    - IndexedDB being supported but failing to open, or a deciding read throwing, fails the boot loudly, as at HEAD.
    - Under the lock, before the space check, IndexedDB entries under the keys OPFS holds are removed, so leftovers of an
      interrupted attempt do not count against the check.
    - A final comparison of the OPFS files' name, size and `lastModified` against the snapshot taken at the start rolls
      the copy back if a fallback tab wrote during it.
  - OPFS leftovers (`MC-180` 6): after a copy-back the OPFS files stay for one start. At a later start that read an
    existing main file from IndexedDB and decoded it (not the start that copied, not one that seeded an empty main file,
    not one that fell back to a backup), the hex-named OPFS files are deleted, each only if IndexedDB holds its key (a raw
    point lookup). `coldstorage_<key>.json` legacy unit files are never touched by this clean-up. The marker is removed
    only when every presence check was answered and every deletion succeeded. It runs after the boot and is not awaited.
  - Archive pass gate (`MC-180` 4): the web boot archive pass runs where the page's store is the IndexedDB store, including
    browsers without OPFS `createWritable`, and not in a page that fell back to OPFS. It was gated on OPFS file writing.
  - IndexedDB store: the point-lookup probe is exposed as `createEntryProbe` and is what the copy-back and the clean-up use
    for presence checks.
- **Behaviour changes (from the commit message):** a Node unit stored as a 0-byte file now reads as damaged (was missing); a
  Tauri unit read that fails with `os error 3` while the file is absent is missing everywhere (it was an error; the manual
  clean-up already skipped that case through its own folder check, which is removed); a browser without `getDirectory`
  reads an absent unit as missing (was kind unavailable); a cold-safe key the store refuses reads damaged and writes
  `false`. Fork-specific: nothing here changes the `.bin` format or its unit entries; export reads units, and restore
  writes them, through the same facade, so a profile with units in the store and units only in legacy OPFS exports both.
- **Tests (from the commit message):** run against a copy of HEAD, 7 tests fail on their own assertions and are the ones
  offered as reproducers or as failures of a new assertion: the Tauri unit write that fails part-way leaves the earlier
  unit readable and no temp, and a successful Tauri write renames a temp over the unit (2); the web archive pass runs for
  the IndexedDB store without `createWritable`, and does not run for a page that fell back to OPFS (2); the Tauri boot
  removes only the temp files of interrupted writes from `coldstorage/` (2, both new-behaviour tests of that sweep);
  `AutoStorage` never selects OPFS (1, new behaviour). Other new tests fail at HEAD only because the module or export
  they use does not exist, or on assertions of new behaviour; they are labelled new-behaviour tests and are not proof of
  a fix. Guards, passing before and after: the Node unit file names for both upstream key shapes (UUID,
  `<uuid>_accessMeta`). Three test files of the removed switch are deleted with it. Everything is fake-backed
  (`fake-indexeddb`, a fake OPFS root, an in-memory Tauri fs and a fake Node server); the `lastModified` comparison is a
  logic test of the fake and says nothing about how a real browser updates it.
- **Phone check (RUN by `perf-analyzer`, not a gate input; `avd\result.md`, ledger row 719):** Android 13 (API 33) x86_64
  emulator on the i9 host, profile `Pixel_6a_LowRam`, 2 GB RAM, Chrome 109. A standalone page measured IndexedDB put and
  get of 1, 2, 5, 20 and 50 MB values with 0 mismatches and 0 errors. `avd\result.md` medians (put / get, ms): 1 MB 17 /
  6; 2 MB 27 / 10; 5 MB 38 / 17; 20 MB 83 / 58; 50 MB 205 / 146. A synthetic 1.9 MB gzip payload read and decoded to 5.27
  MB of JSON in 93 ms cold and about 40 ms warm. It measured the mechanism, not the app; emulator times are not a real
  phone's, and backgrounding was not tested. The page was in the foreground for the whole run (6.5 s).
- **Gate 1 (`opus-reviewer`, plan; ledger rows 720 to 722):** round 1 `[REJECT]`: the losing tab could serve OPFS after
  the winner cleared the flag (BLOCKER), a commit-step failure path, and no progress. Round 2 `[REJECT]`: the round-1 fix
  that skipped keys the IndexedDB store refuses would, with the later clean-up, have deleted an upstream asset with a
  backslash in its name. The Orchestrator replaced the skip with a raw copy of every file and a clean-up that deletes
  only files whose key IndexedDB holds. Round 3 `[EDITORIAL]`; the plan was accepted.
- **Gate 2 (`opus-reviewer`, code; ledger rows 727 to 729):** round 1 `[REJECT]`: a start that created an empty main file
  let the clean-up delete the only OPFS copy (MAJOR); fixed (a boot that seeded an empty main file does not start the
  clean-up). Round 2 `[EDITORIAL]`: one new test was mislabelled as a regression reproducer and was retitled. The commit
  message check (row 731) was also `[EDITORIAL]`; seven corrections were applied by the Orchestrator.
- **Facts packet, refuted premises (ledger row 718):** `disableOpfs` was a button flow, not a boot copy-back; the flag
  decides which store is current, not the `migrated` marker; `listColdStorageItems` has no production caller. Correction
  (Gate 1 round 1, F13): the facts packet called HEAD's no-Web-Locks and lost-race `AutoStorage` branches stale-data
  hazards. That is false: they ran only after the IndexedDB main file was found present and the marker absent, when
  IndexedDB was current.
- **Checks on the final tree (RUN by the Orchestrator, as the commit message states them; before two editorial edits, a
  test retitle and one comment):** `pnpm test` 324 files, 6874 passed, 4 skipped; `pnpm check` 0 errors, 0 warnings;
  `pnpm build` passes. **Not run:** native Tauri, a real `server.cjs`, a real browser's OPFS (including how
  `lastModified` behaves), WebKit, Android Tauri.
- **Open, residual and non-blocking (from the commit message):**
  - A fallback tab's plugin-unit or asset write that lands in OPFS after the copy-back's final comparison is not carried
    into IndexedDB; the page is served from IndexedDB afterwards.
  - A profile whose origin quota cannot hold its data twice stays on OPFS at every start with the space notice; no data is
    lost. A real browser may free deleted IndexedDB space lazily, so the pre-delete may not help there (the test is
    fake-only).
  - OPFS files whose key was deleted from IndexedDB between the copy-back and the clean-up stay in OPFS (quota only).
  - The snapshot comparison walks every OPFS file twice and the clean-up does one IndexedDB count per file; neither is
    measured on a large (350k-asset class) profile.
  - IndexedDB `migrated` is removed best effort, and retried only while the clean-up marker is pending.
  - Upstream's restore drops a fork-exported v3 plugin unit whose value is not chat- or character-shaped. This exists
    before this change (INFERRED, not run); it appears to be the G1 limit in the round-trip note below (`MC-176`); that match
    was not checked.
  - The restart cost of an interrupted copy-back is accepted: it restarts, with no resume (the Orchestrator's call F3,
    `MC-180`).
- **Release blocker status:** stage 0 (the original defect, the non-atomic Tauri main-file write) is done by `d0decfb6`,
  per its block below, and stages 1 to 4 are done. **Decided (`MC-181`, 2026-10-03):** the maintainer said "CHORE-55 is no
  longer a release blocker". That clears CHORE-55 as a release blocker. It does not say the ticket is closed or that its
  later stages are cancelled; they stay as later work (next line).
- **Next for CHORE-55:** stages 0 to 4 are done. Stage 5 or later (inlays with CHORE-48, the search index, CHORE-46's
  streaming) is not scheduled. Per `MC-179` 4, `feat/ui-batch` must be merged here before memory step 6.

**Status (2026-10-03, stage 3, superseded by the stage 4 block above where they differ): stage 3 (assets) is done: Gate 2 approved; code commit
`bf7f2cbf`, then a records commit (local, not pushed).** Stages 4 and 5 or later were open when this block was written. The older status blocks
below are kept as they were; where this block differs, this block governs. Ledger rows 704 to 713 are the stage 3 work
(the facts investigation, Gate 1 in two rounds, the implementation in two parts, the translations, the I8 measurement,
Gate 2 in two rounds with the remediation between them); rows 714 to 717 are the commit message draft and its check, and
these records and their fact-check. `MC-177` 3 started the stage; `MC-178` records the maintainer's restore answer. The
Orchestrator's change summary (`s3-commit-constraints.md`) was spot-checked against `git diff -- src` and the untracked
files (the optional `urlFor`, the extension rule, the sweep batch size, the group size, the notice bounds and the
`assets/` temp sweep were each found in the diff); the rest is the summary's.

- **What stage 3 changed (production):**
  - Store layer: the contract gets an optional `urlFor(key)`, implemented only by the Tauri files store
    (`convertFileSrc(join(appDataDir, key))`, memoised per key; it never reads the file and the string is unchanged). The
    Tauri store lists a symbolic link when `exists()` resolves it and never descends into one; a link whose target is gone
    is not listed. The IndexedDB store's `read` decides that a key is absent with a raw single-key `count(key)` on a
    version-less connection (never creates anything, closes on `versionchange`, reopens once on `InvalidStateError`, any
    other failure falls back to the key list), instead of listing every key.
  - `getFileSrc`: on Tauri, asset keys go through `urlFor`, and a key the store refuses resolves `''`; other locations keep
    the old fallback. On web and Node the bytes come from `store.read`; the service-worker and data-URL paths and the URL
    strings are unchanged.
  - `readImage` and `loadAsset` read through the store. A missing asset still rejects on Tauri, now with an `Error` naming
    the key (before, the plugin's message); on web and Node it still resolves `null`. Off Tauri the result is a
    `Buffer` view over the bytes the store returned (the wrap itself makes no copy), and a key the store refuses reads as
    `null`. A stored entry that is not binary rejects (`StoreNotBinaryError`); before, `getItem` returned whatever
    IndexedDB held.
  - `saveAsset` writes through the store, unconditionally: on Tauri a temp file plus a rename, so a failed write leaves no
    partial file; on Node a save is no longer refused with `NodeStorageConflictError` because another device deleted or
    rewrote the same content-addressed asset after this page read it. The extension is kept when it is 1 to 16 ASCII
    letters or digits, and is `png` otherwise. On Tauri an existing file (the names are content hashes) is not rewritten.
    It accepts an `ArrayBuffer` or a typed-array view and rejects anything else with a `TypeError`, and records each key
    in a page-level "written this page load" set before any I/O.
  - Restore (`LoadLocalBackup`, `MC-178`): asset entries are written through the store, before the database as before. An
    entry whose name the store refuses (`StoreInvalidKeyError`) is skipped. After the database is written, and before the
    success message and the reload, one notice lists the count and the first 20 names, each cut at 100 characters (the
    string `restoreAssetsSkipped`, with ko, cn, zh-Hant, vi, de and es). Any other write error still aborts the restore.
  - Exports: the full export lists and reads `assets/` through the store, never exports a temp file, and on Tauri exports a
    file in a subfolder under its bare name (as the web export already did). A symlink that resolves is exported, as
    before; a link to a directory is listed and reported missing when it cannot be read; a dangling link is dropped (before, it was reported
    missing). The partial export keeps only keys starting `assets/`; on Tauri a referenced asset that is absent, or a
    referenced name that is a directory, is now reported missing (before, skipped silently); on the web a failed read is reported missing (before, it threw).
  - Startup asset sweep (`cleanChunks`, `assetSweep.ts`): lists and deletes through the store on every platform and never
    sees a temp file. A key is deleted only when it is in none of the boot keep set, the set of keys written in this page
    load, and a live reference set re-read from the database once per batch of up to 100 candidates (a candidate is a key
    the keep set does not protect). This closes a race in which an asset saved during the sweep, but not yet referenced,
    was deleted. On Tauri only top-level `assets/<name>` keys are candidates and every comparison ignores case. The MC-139
    rule and the "keep set incomplete, delete nothing" rule are unchanged.
  - Manual clean-up: asset deletes go through the store in groups of 20 with per-key counts, and a failed group never stops
    the next; on Tauri the candidates and the live re-check are top-level only and ignore case. Units still use the old
    Node batch path until stage 4.
  - Load-time listing: the asset part lists through the store (no temps; top-level keys only on Tauri). On Node this is a
    second `/api/list` request at load.
  - Tauri boot: leftover `risu-write-*.tmp` files in `assets/` are removed before anything writes there.
- **What the restore change is, corrected (F4):** a plan note said the store closes a Tauri `..` traversal. That is
  false: the plugin's `SafePathBuf` already refused `..` before stage 3. What changed is that a `..` name is now skipped
  and listed, where the plugin's refusal used to abort the whole restore. On web and Node such a name used to be stored as it was; it is now skipped and listed
  too, on every platform. The same creatable rule refuses any segment that starts with `.`. On every Tauri platform a
  name with `< > : " | ? *` or a segment ending in a dot or space is refused for writing (and on Windows `:` is also
  refused for reading); that the plugin allowed such a name before is INFERRED, not run.
- **I8 measurement (RUN, Orchestrator, `scratchpad\chore55\i8bench\result.md`):** Chrome 152 in the built-in pane on the
  maintainer's i9-13900K, which is best-case hardware; synthetic `assets/<64 hex>.png` keys in a separate database. The
  check for an absent key, median of 9 repetitions: 27.9 ms at 5,000 keys and 446 ms at 50,000 keys with the listing
  (HEAD); 0.3 ms and 0.4 ms with the single-key count (new). It measures the mechanism with the same calls, not the
  adapter module (`indexedDbStore.absence.test.ts` pins the adapter's use of `count`). Phones and a Pi will be slower in
  absolute terms; that is not measured.
- **Tests:** new `src/ts/storage/tests/assetFacade.test.ts`, `indexedDbStore.absence.test.ts`, `assetSweep.test.ts`,
  `src/ts/bootstrap.assetSweep.test.ts` and the helper `tauriPathFake.ts` (models the Windows separator rewrite in
  `join`); the Tauri store, conformance, backuplocal, load-time listing, manual clean-up and bootstrap suites are extended.
  Run against a git-archive extract of HEAD with the final tests copied in, 79 tests in 9 files fail, each on its intended
  assertion: 42 reproducers, 27 new-behaviour tests and 10 tests of the new `urlFor` operation; no guard fails there (the
  Gate 2 reviewer's RUN, ledger row 715). At Gate 2 round 1 the figure was 76, before the remediation tests. Of the four
  remediation tests, all four fail against a copy taken before that change, and three fail at HEAD; the fourth (no walk
  when every key is kept) passes at HEAD, which never walked. No assertion was removed or loosened except those two (the
  dangling-link export guard and the partial-export directory guard), which were changed to the new behaviour (the
  Orchestrator's reading; the verifier did not audit every migrated assertion). Gate 2 round 1 killed 29 of 32 mutants; in round 2 the mutants `bootLiveOnce`
  and `manualCountsPerGroup` and 11 more were killed, and `webIncompleteIgnoredInLoop` is equivalent.
- **Gate 2 (`opus-reviewer`):** round 1 `[REJECT]`, round 2 `[APPROVE]`. F1 (MAJOR, performance, RUN): the web and Node
  sweep rebuilt the live reference set once per 100 listed keys, about 0.37 s at 5,100 references and about 35 s at 50,500
  on the i9 (the Gate 2 reviewer's RUN figure, in its hand-back); fixed by batching over candidates only. F2 (MINOR): the Tauri page-set check was case-sensitive; fixed. F3:
  three false comments; fixed. F4: the plan note above. The Orchestrator verified F1 and F2 at source.
- **Checks on the final tree (RUN by the Orchestrator):** `pnpm test` 6772 passed, 4 skipped; `pnpm check` 0 errors and 0
  warnings; `pnpm build` ok. Fake-backed only: an in-memory Tauri file system, `FakeNodeServer` behind the real Node store,
  and `fake-indexeddb`. The only real-browser run is the I8 measurement. **Not run:** native Tauri, a real `server.cjs`,
  WebKit, Android.
- **Open, residual and non-blocking:**
  - macOS: the fork's own export includes `.DS_Store` from `assets/`, so a fork-to-fork restore shows the notice for it.
  - Windows reserved names such as `CON.png` are not skipped; the restore still aborts, as at HEAD.
  - Empty subfolders in `assets/` are left behind on Tauri.
  - Two nested Tauri keys with the same basename collide as one `.bin` entry, as on the web.
  - A missing asset on Tauri now rejects with an `Error`, not the plugin's string; on Node a failed save rejects with an
    `Error` object, not a string; a 0-byte asset reads as a value, not `null` (D9).
  - `sweepAtomicWriteTemps('assets')` does not recurse into subfolders.
  - The optional per-batch lowercased page-set `Set` is not done.
  - Off Tauri a stored entry that is not binary now rejects instead of returning whatever IndexedDB held.
  - On Tauri `getFileSrc` returns `''` for any failure, not only a refused key; before, a URL was built from a refused
    key, including one whose path led outside `assets/`.
- **Next for CHORE-55 (as of stage 3; the stage 4 block at the top has the current line):** stage 4 (cold-storage units, the OPFS switch removal and the copy-back per `MC-173` 1). Per
  `MC-179` 4, when stage 3 is committed the maintainer is told, and its commits are merged into `feat/ui-batch` so the UI
  session can take CHORE-68 and CHORE-74.

**Status (2026-10-03, stage 2b, superseded by the stage 3 block above where they differ): stage 2 is done: 2a by `a29335f7` and 2b by `cbaeddd6` (local, not pushed). Stages 3
and 4, and stage 5 or later, are open.** The older status blocks below are kept as they were; where this block differs,
this block governs. Ledger rows 691 to 694 are the stage 2b work (the implementation, Gate 2, the commit message draft and
its check); rows 695 and 696 are these records and their fact-check. `MC-174` records the maintainer's commit decision;
`MC-175` the maintainer's correction of the compatibility invariant (a two-way `.bin` round trip), with `AGENTS.md` updated.

- **What stage 2b changed (from the commit message):** the remote character blocks (`remotes/<chaId>.<hash>.bin`) are
  written, skip-checked, read and cleaned up through the byte store.
  - Writing a block (only Tauri and Node builds with remote saving on write blocks) is an unconditional store write; the
    decoder reads through the store on every platform. On Tauri it is the adapter's atomic write (temp
    file and rename), so a write that fails part-way leaves no partial file and keeps the file that was there. On Node a
    peer's identical content-addressed block is no longer refused with `NodeStorageConflictError`.
  - The exists-skip lists `remotes/` once per encoder init pass (on Node, one `/api/list`, not one existence check per
    character). A failed listing fails the encode and nothing is written on a guess.
  - The Tauri boot sweeps leftover `risu-write-*.tmp` files from `remotes/`, only when it exists, before the first remote
    write of the page load.
  - The remote-block clean-up in `bootstrap.ts` (Tauri and web) lists, reads, writes `.meta` and deletes through the
    store. What it deletes is unchanged: v1 `.local.bin` blocks only, after the 7-day `.meta` rule. The Tauri boot no
    longer creates `remotes/` (the first write does). On the web the remote blocks are listed separately through the store,
    after the asset sweep, and a failure of that listing reaches the clean-up's error report.
  - `saveDb` recognises `StoreVersionConflictError` only as the conflict. The post-commit conflict branch is kept, and a
    test now reaches it through an injected conflict (the real server cannot send a 409 there).
  - Not changed: the save format, the file and key names and the bytes written.
  - Checks, as the commit message states them, RUN by the Orchestrator (`scratchpad\chore55\s2bfinal\`): `pnpm test` 315
    files, 6624 passed, 4 skipped; `pnpm check` 0 errors and 0 warnings; `pnpm build` ok. The session log also records the
    build with `VITE_RISU_LEGAL_CONFIGURED=TRUE` and a grep finding no `dist` JS file with `FakeNodeServer`, `appStoreMock`
    or `forageBackedStore` (Orchestrator-run; not in the logs folder).
    Four comment-and-title-only edits by the Orchestrator (comments in `bootstrap.ts`, `risuSave.ts` and
    `bootArchivePass.ts`; one test title in `globalApi.nodeSave.svelte.test.ts`) were not followed by a rerun.
  - Tests: fake-backed (an in-memory Tauri file system and `FakeNodeServer` behind the real `NodeStorage` and Node store;
    the eleven migrated suites run on a forage-backed stand-in store). No native Tauri, real `server.cjs`, browser or
    Android run. The commit message lists the reproducers (red against a git-archive extract of HEAD) and the guards.
- **Facts established in stage 2b (Gate 2 and the commit check):**
  - Upstream's decoder reads only `remotes/<chaId>.local.bin` (v1) and ignores `v` and `hash` (the Orchestrator verified
    `git show upstream/main:src/ts/storage/risuSave.ts`). A profile this fork saved with remote saving on is therefore
    missing those characters on upstream. This comes from the fork's v2 content-addressed blocks and is not changed by 2b.
    Per the maintainer's correction (`MC-175`), the requirement is a way to go back and forth between upstream and the
    fork, and an upstream-compatible `.bin` export/import meets it; compatibility of the profile folder itself is not
    required. Whether a `.bin` exported by this fork restores everything on upstream is under investigation (ledger row
    697).
  - An unreadable `.meta` kept the block at HEAD too (the reviewer RAN it). 2b's only change there: when the `.meta`
    existence check errors, no fresh `.meta` is written (at HEAD a rejecting `exists()` led to one). When the read errors,
    the block is kept and nothing is written, as at HEAD.
  - The store's Tauri listing hides only atomic-write temp names. Foreign files, and v1 blocks truncated by older
    non-atomic writes, are listed.
  - `saveDb`'s post-commit conflict branch is settled: nothing else in its `try` makes a `NodeStorage` read or write
    (traced), and only the conditional main-file write can get a 409 from `server.cjs`.
- **Open, residual and non-blocking:**
  - A remote file left truncated by the old non-atomic write is still accepted by the exists-skip, which checks existence
    only.
  - Android: "absent" is recognised from the "(os error 2|3)" text, which is unproven there. If the text differs, listing
    a `remotes/` that does not exist yet rejects: with remote saving on, the encoder's init fails and saving does not
    start for that page load, and the clean-up reports an error (INFERRED from source, not run; for the Android wrapper
    plan).
  - Remote writes now pass the store's key rules. A `chaId` with a backslash, a control character, a leading dot, or an
    empty or dot-led segment (Node and Tauri), 89 bytes or more (Node; it failed at HEAD too), or any of `<>:"|?*` (Tauri,
    on every platform) fails the save loudly. No app path makes such ids; a plugin or hand-edited data could.
  - A stale marker: `test.skip('a6 SKIPPED: remotes/ cleanup coverage requires bootstrap.ts ...')` in
    `src/ts/process/tests/coldStorageDeletionGuards.svelte.test.ts`. The remote clean-up now has tests
    (`bootstrap.remoteBlockCleanup.test.ts`), so the marker is misleading. Not changed.
  - Still open from 2a: the IPC fallback flip (TRACED, not run); two tabs on a fresh Node server (a suspicion);
    `NodeStorage.peekItem` has no production caller; the stage 0 Windows live check (`MC-171` 2); asset-route staleness
    untested on WebKit and Android; on Android, IPC uses postMessage with JSON (TRACED, not run; for the Android wrapper
    plan). Settled by 2b: the
    `saveDb` post-commit conflict branch (kept, now tested via an injected conflict; `NodeStorageConflictError` is no
    longer recognised there).
- **Next for CHORE-55 (as of stage 2b; the stage 3 block at the top has the current line):** stage 3 (assets), then stage 4
  (cold-storage units, the OPFS switch removal and the copy-back per `MC-173` 1).

**Note (2026-10-03, after stage 2b): the upstream <-> fork `.bin` round trip (`MC-175`) was checked (ledger row 697);
this note supersedes the "under investigation" sentence in the stage 2b block above.** RUN with the real export and import
code of both trees (fork `cbaeddd6`, upstream `f9728b14`) on a mocked web store and synthetic data; the Tauri and Node
paths are TRACED only. None of the findings below was caused by CHORE-55.
- **Fork -> upstream holds, with one gap (G1):** v3 plugin storage units that are not an array or an object with a
  `character` or `message` key are not restored by upstream's import (its confirm calls them items that "could not be
  linked to a character", and the values then read null). Upstream's own exporter omits them too, after an "incomplete
  backup" confirm (RUN: `up.export.report.json`).
- **Upstream -> fork holds.** Upstream's exporter silently drops assets that are not `.png` (B1). It also leaves the G1
  units out of its own backup (B2), after an "incomplete backup" confirm whose text names "unknown characters" and items
  that "could not be linked to a character"; B1, by contrast, is silent. An account-encrypted `.bin` is refused
  (`MC-081`). The fork-added database fields (archive settings, stub metadata) are ignored by upstream without harm.
- **Refuted:** the `.bin` holds no remote pointers (it is the whole database as `encodeRisuSaveLegacy`, identical in both
  trees), so the fork's v2 remote blocks do not affect it. Archived characters and chats round-trip. Device-local stores
  (inlay media, HypaMemory caches, plugin permissions) are in neither exporter (TRACED from source, not run).
- **Decided (`MC-176`):** G1 and B1 are upstream's own limits and do not count against the invariant; they are documented
  in the records now and in the wiki later. The fork's export will warn about G1-type plugin data: CHORE-74.
- **Decided (`MC-177`, 2026-10-03):** documentation (the wiki, later) is enough to clear CHORE-74's blocker, the G1-type
  plugin data loss. The maintainer's words do not name G1 or B1. Applying the same clearance to B1, which `MC-176` 1
  groups with G1 as an upstream limit, is the Orchestrator's reading, not stated. The wiki notes are owed to the Wiki
  session. Whether the release must wait for the wiki page to exist was not stated. CHORE-74 is a later quality-of-life
  item and not a release item (`MC-177` 1 and 2).
- **Untested:** a real Tauri or Node run, upstream's UI for a fork group stub, and entries over 4 GiB.

**Status (2026-10-03, stage 2a): stage 2a done by `a29335f7` (local, not pushed). Stage 2b (remote blocks), stages 3
and 4, and stage 5 or later are open.** The older status blocks below are kept as they were; where this block differs,
this block governs. Ledger rows 679 to 688 are the stage 2a work (the read-route investigation, the facts investigation,
Gate 1, the implementation, the translation, Gate 2 round 1, the remediation, Gate 2 round 2, and the commit message with
its check); rows 689 and 690 are these records and their fact-check. `MC-173` records the maintainer's decisions for this
stage. The `AGENTS.md` change in the records commit is `MC-173` 3.

- **The advisor's named investigation (the asset protocol against `readFile`) is answered (ledger row 679).** RUN in a
  standalone Tauri 2.11.5 probe on Windows with WebView2, not in the app: both routes gave equal bytes in about 0.95 s
  and the same per-process peak commit on a 155 MiB file (host about 10 times the file size on both routes, which comes
  from delivering the whole file in one response; the exact cause inside the host is not isolated), on a 64 GB i9
  desktop, best-case hardware. No staleness after a rename on WebView2. Key encoding is safe on both routes. The IPC
  absence errors match the stage 1 regex. Not run on WebKit (macOS, Linux) or Android. Two hazards, both TRACED and not
  run: a failed large IPC read flips the page to Tauri's JSON postMessage fallback, and ranged asset reads re-open the
  file and are not a snapshot.
- **What stage 2a changed (from the commit message):**
  - The main file, at every site, and the numbered backups (the write, the listing and prune, and the internal-backup
    picker) go through the byte store that `src/ts/storage/store/appStore.ts` selects once per page load. Stage 2b
    (remote blocks), stage 3 (assets) and stage 4 (cold-storage units) are not moved.
  - Selection: Tauri uses the desktop files store; the Node server uses the Node HTTP store, signed in through the one
    `NodeStorage` that `AutoStorage` built; the web uses the IndexedDB store pinned to the IndexedDB driver. A web
    profile whose main store was moved to OPFS uses a transitional store over its `OpfsStorage`
    (`opfsTransitionalStore.ts`) until stage 4 (`MC-173` 1). A browser without IndexedDB stops the boot with the new
    message `browserStorageUnavailable`, in all seven languages (`MC-173` 2).
  - The Node main file's version is one explicit cell, set by `readMainFile` and by a successful `writeMainFile`; a
    conditional write with no version rejects and never falls back to an unconditional write. The numbered-backup writes
    and the prune are unconditional. One Node auth state serves every entry point of the page.
  - The Tauri boot reads the main file and the backups through the file plugin, not the asset protocol.
  - Checks, as the commit message states them, RUN by the Orchestrator on the final tree: `pnpm test` 312 files, 6578
    passed, 4 skipped; `pnpm check` 0 errors and 0 warnings; `pnpm build` ok (`VITE_RISU_LEGAL_CONFIGURED=TRUE`). Two
    later comment-and-title-only edits (the `appStore.ts` header clause and one test title in
    `internalBackupSnapshotLoad.svelte.test.ts`) were re-run in their two files: 71 passed.
  - Tests: the commit message lists the reproducers (each red against a git-archive extract of HEAD with the new tests
    and harness changes copied in), the guards and the new-behaviour tests, and says which tests run over the real
    `server/node/server.cjs` and which over the `FakeNodeServer` stand-in.
- **What a user can see (the commit message's "What a user can see", with its corrected wording):**
  - Node, a main file of 0 bytes: the boot took it for absent and wrote an empty save over it. It now takes the newest
    decodable backup, and with none the boot fails with the error shown. The boot writes no main file and no seed (as
    on any boot it may still delete numbered backups beyond the newest 20); the next save replaces the 0-byte file with
    the data the boot loaded from the backup (a save happens when something changes, so the file stays as it is until
    then; traced in source, no test runs the next save after these fallbacks).
  - Tauri, a main file whose read fails with an error other than "not found" while `exists()` also answers false: the
    boot took it for absent and wrote a seed over it. It now writes no seed or main file at boot and takes the newest
    backup (the prune may still delete numbered backups beyond the newest 20); the next save replaces the file with that
    backup's data (traced, not tested; whether that write succeeds depends on why the read failed). Only a file the read reports as not found, and `exists()` confirms
    absent, is seeded, and the seed now happens after the boot archive session opens.
  - Web on IndexedDB, a main-key entry stored as null: the boot used to seed over it. It now raises
    `StoreNotBinaryError` and takes the backup route.
  - A browser where IndexedDB is missing or cannot be opened: the boot used to continue on LocalForage's fallback driver;
    it now stops with the new message and reads and writes nothing. The outcome stands for the page; a reload is the way
    to try again.
  - Node, a fresh server with no password: the page asked for the password twice (the double prompt was REPRODUCED against
    the real server, ledger row 682); it now asks once.
  - Backups: the prune runs after a numbered-backup write, at every Tauri boot, and when any boot falls back to the
    backups, not after every save. `getDbBackups` only counts names that are exactly `dbbackup-<digits>.bin`, and
    deletes the listed key itself.
  - Not changed: the save format, the file and key names and the bytes written. Two devices on one Node server: a stale
    save is still refused (`MC-159`).
- **Facts that refuted planning text (ledger rows 679 and 680):**
  - Read-through is unsound for an OPFS-main profile, because the copy into OPFS never removes a LocalForage key, so the
    LocalForage copy is stale (the Orchestrator re-read `autoStorage.ts` and `storageMaintenance.ts` `disableOpfs`).
    This qualifies `MC-167` 2 for the stage 2 kinds; it stands for cold units (stage 4).
  - "Snapshots" are the `dbbackup` files on the read side, not a separate kind.
  - The stage 1 note below, that a non-binary entry "stage 2 callers will meet", is false for stage 2 callers: only
    `AutoStorage` reads `migrated` (it writes it, and `storageMaintenance.ts` removes it); no source in this fork reads
    or writes `denied_opfs`, so no stage 2 caller meets a non-binary entry.
  - The boot used the asset protocol at two sites only (the main read and the backup fallback), and three other sites
    already read main-file-size data through IPC `readFile`. Remote blocks are written only on Tauri and Node.
  - `AGENTS.md`'s "tauri pinned at 2.9.5" was wrong (`MC-173` 3; the Orchestrator verified `.gitignore` and a local lock).
  - The Hono server is a static-web deployment: it sets no `__NODE__` and serves no `/api/read`, so it never reaches the
    Node store (Gate 1 and Gate 2, TRACED). A fact for later stages, not a correction.
- **Open, residual and non-blocking:**
  - The IPC fallback flip (above; TRACED, not run).
  - Two tabs on a fresh Node server: the second tab's boot can fail at set-password, and a reload recovers. A suspicion,
    not reproduced.
  - Asset-route staleness is untested on WebKit and Android; the boot no longer uses that route. On Android the stage 1
    absence regex is not proven and IPC uses postMessage with JSON (TRACED in tauri 2.11.5's `ipc-protocol.js`, not
    run; for the Android wrapper plan).
  - `NodeStorage.peekItem` has no production caller left (a Grep of `src/` found one hit, the definition in
    `nodeStorage.ts`).
  - `saveDb`'s post-commit conflict branch is unreachable after 2a; settle it in 2b.
  - The stage 0 Windows live check (`MC-171` 2) is still open.
- **Next for CHORE-55 (as of stage 2a; the stage 2b block above has the current line):** stage 2b, already in the stage 2 plan (D7, D9 and scenarios S15 to S19): the remote-block encode
  write (atomic on Tauri, through the store), the exists-skip, the decode read, the boot GC of v1 blocks and `.meta`, and a
  `remotes/` temp sweep. A residual already known for 2b: a remote file left partial by an older non-atomic write is still
  accepted by the existence check, because the read has no hash check. Then stages 3 and 4.

**Status (2026-10-03, stage 1): stage 1 done by `d95b07da` (local, not pushed). Stages 2 to 4, and stage 5 or later, are open, not yet gated.** The
older status blocks below are kept as they were; where this block differs, this block governs. Ledger rows 666 to 676 are
the stage 1 work (the facts investigation, the three Gate 1 rounds, the implementation, Gate 2 round 1,
the escalation, the remediation, Gate 2 round 2, and the commit message with its check); rows 677 and 678 are these records
and their fact-check. `MC-172` records the maintainer's commit decision.

- **What stage 1 added (from the commit message):**
  - The contract, in `src/ts/storage/store/`: `read`, `write`, `delete`, `deleteMany`, `list(prefix)` and `has`, over whole
    binary values. A zero-length value is a value and is distinct from an absent key. Every write and delete takes an
    explicit condition, `{ ifVersion }` or `'unconditional'`; only the Node adapter enforces `ifVersion`. Creatable keys and
    addressable keys are two rule sets, so a key upstream already stored under an unusual name stays readable, listed and
    deletable but cannot be created again. `deleteMany` is not atomic and rejects with a per-key report. `urlFor` is not in
    this stage.
  - Three adapters: Tauri files (one file per key under AppData, every path passed as `./` + key, writes through
    `writeFileAtomic`); Node HTTP (the server's hex key encoding, with the revisions held by the caller); IndexedDB on
    LocalForage `risuai`/`keyvaluepairs`, with the driver pinned and no object store added and no database version forced.
    OPFS gets no adapter.
  - One conformance module run against all three adapters, and `fake-indexeddb` ^6.2.5 as a devDependency (`MC-167`). **No
    production module imports the new code.**
  - Checks, as the commit message states them, and RUN by the Orchestrator on the final tree: `pnpm test` 302 files, 6482
    passed, 4 skipped; `pnpm check` 0 errors and 0 warnings; `pnpm build` ok (`VITE_RISU_LEGAL_CONFIGURED=TRUE`). A later
    test-title-only rename in `nodeHttpStore.test.ts` was re-run in its file (70 passed), and the Gate 2 reviewer's own full
    `pnpm test` on the tree with the rename gave the same 302 files, 6482 passed, 4 skipped. The tests are conformance and
    compatibility guards for new code, not regression reproducers; no red-before-green run is claimed. The Tauri adapter is
    tested only against the test fake, not on a real Tauri runtime.
- **Scope amendment (`MC-091`, technical prerequisite), in `server/node/server.cjs`:**
  - A1: `/api/read` sends `x-risu-exists: 1|0` beside `x-risu-revision` (`server.cjs:1273`). Without it a stored empty file and
    a missing file give the same empty response.
  - A2: `/api/list` returns only whole, even-length hex names (the filter at `server.cjs:1496`). A2 is the one change a user can
    see: on Node, `/api/list` no longer returns `''` (decoded from the `__` files) or keys decoded from `.tmp-` write temps.
  - A2 also removes a phantom that could make `encodeRemoteBlock`'s `keys().includes` skip a remote block whose write never
    finished. The mechanism is TRACED. The frequency is INFERRED: only a crash in the middle of a write leaves an orphan temp.
- **Facts that refuted planning assumptions (the stage 1 facts packet, ledger row 666):**
  - Node `/api/list` returned `''` and `.tmp-` duplicates (RUN against the real server).
  - A 0-byte value read as missing on Node (RUN; the Orchestrator re-read `readItem` in `nodeStorage.ts`).
  - The Tauri capability has no `stat`, so there is no mtime version (the Orchestrator re-grepped `migrated.json`).
  - The `risuai` store holds non-binary entries: `migrated` (a boolean written by `AutoStorage`) and `denied_opfs` (read by
    upstream code and never written by any source, so only a hand-set value can exist).
  - `risuSaveCache` is a separate LocalForage database of objects, not bytes. It stays a side store (the stage 1 plan's
    scope); the advisor's contract sketch below records it as a load-bearing write-ahead copy that is never cleaned up.
- **Prerequisites and notes for stages 2 to 4** (the Orchestrator's, from the gates):
  - Every stage 2 to 4 caller chooses a condition explicitly. Today `NodeStorage` makes every key it wrote, or read through
    `getItem`, conditional implicitly (`peekItem` does not adopt the revision). A conflict's reported version is diagnostic only and is never the next `ifVersion` for the same bytes.
  - Version 0 on Node means "the server never bumped this key's revision", not "absent". Upstream's server kept no revisions,
    and a corrupt `__revisions.json` resets the counters. A create-if-absent reads first.
  - The IndexedDB driver is pinned: where IndexedDB is missing, every operation rejects (AutoStorage falls back today).
  - Through the IndexedDB adapter, a stored non-binary entry under an app key rejects loudly on read; stage 2 callers will
    meet that.
  - Stage 3: sanitize the asset extension when a new asset is created. The asset key is `assets/<id>.<fileName.split('.').pop()>`
    (`src/ts/globalApi.svelte.ts:490` and `:493`, checked by the writer). Whether existing oddly named assets are renamed is a
    maintainer question for stage 3.
  - Stage 0 temp files will appear in `assets/`, `remotes/` and `coldstorage/` once the Tauri adapter writes there. Their
    readers and the `database/`-only boot sweep must be re-derived then (the stage 0 note below, restated as a stage 2 to 4
    prerequisite).
  - A Node startup sweep of orphan `.tmp-` files. They cost disk only, now that they are unlisted.
  - On Tauri a key cannot also be a directory prefix of another key. Node and IndexedDB allow it. No app key collides.
  - Single auth state in stage 2: the Node adapter takes an injected auth provider, and two `checkAuth` flows must not both
    prompt.
  - Still open from stage 0: the Windows live check (`MC-171` 2), and the advisor's asset-protocol against `readFile`
    investigation before stage 2 (the Tauri adapter reads with `readFile` for now).
  - Not handled (edge cases with no caller): a Windows `list` prefix containing `\`; Windows reserved device names in the
    creatable rule; the duplicated 8000-byte request budget in `nodeHttpStore.ts` and `manualCleanup.ts`.
- **Next for CHORE-55 (as of stage 1; the stage 2b block at the top has the current line):** stage 2 (the main file, numbered backups, snapshots, remote blocks, the boot read, the boot archive
  commit, restore and the internal-backup load). It is not yet planned. The asset-protocol against `readFile` investigation
  comes first.

**Status (2026-10-03, stage 0): stage 0 done by `d0decfb6` (local, not pushed). Stages 1 to 4, and stage 5 or later, are open, not yet gated.** The
older status blocks below are kept as they were; where this block differs, this block governs. Ledger rows 658 to 663 are
the stage 0 work (the facts investigation, both gates, the implementation and the commit message); `MC-171` records the
maintainer's commit decision.

- **What stage 0 changed (from the commit message):**
  - One helper, `writeFileAtomic` in `src/ts/storage/tauriAtomicWrite.ts`, writes the new bytes to a new file in the
    target's own directory (`risu-write-<16 hex>.tmp`, created with createNew) and renames it over the target. The target
    is never opened for writing. A failed write or rename removes its own temp file as best it can and rethrows the
    original error. The helper takes and releases no lock.
  - It is used at the six sites of the table below: the `saveDb` main write (under `dbWriteLock`), the `saveDb`
    numbered-backup write (after the lock is released), `LoadLocalBackup`, `loadInternalBackup`, the Tauri `writeMainFile` of
    the boot archive pass (`createProductionBootArchiveDeps`; the boot's write-back of the pre-pass bytes goes through it
    too) and first launch in `loadData`.
  - A boot sweep, `sweepAtomicWriteTemps('database')`, runs in `loadData`'s "Checking Files" block, after the database
    folder is checked and made, before the first-launch write and before the boot archive session opens. It removes only
    files whose name matches the temp pattern exactly. A failing listing or removal is logged and does not stop the boot.
  - A bounded retry: the rename is retried up to four times, after 50, 100, 200 and 400 ms, when the error text ends in
    "(os error 5)" or "(os error 32)". Any other error fails at once.
  - No fsync (the plugin has none). This protects against a failed or interrupted write, not against power loss.
  - Temp names never start with "." and never contain "dbbackup-", so the backup list, the prune, the internal-backup
    picker and the manual clean-up's snapshot listing never see a temp file as a backup.
  - Tests and checks, as the commit message states them: one reproducer per site; against a stand-in for the unchanged
    behaviour (the helper module swapped for a plain `writeFile` of the target and a sweep that does nothing, over the site
    and existing test files; the helper's own unit tests were not part of that run) all six reproducers failed for the
    intended reason, and 17 tests failed in all; 12 mutants of the helper were all killed. RUN by the
    Orchestrator on the final tree (the content of `d0decfb6`): `pnpm test` 298 files, 6268 passed, 4 skipped; `pnpm check`
    0 errors and 0 warnings; `pnpm build` ok (`VITE_RISU_LEGAL_CONFIGURED=TRUE`).
- **The filing's `TODO(evidence)` items 2 and 3, answered as far as they go:**
  - **Item 2, a rename over an existing file:** RUN in a standalone Rust probe only (rustc 1.98.1, NTFS, Windows 11), not
    in the app. With the target held open by another handle, the rename replaced the target when the holder shared delete
    and failed with "os error 5" when it did not. The success relies on std's rename retrying through `FileRenameInfoEx`
    after `MoveFileExW` returns ACCESS_DENIED (the std source; TRACED). CI builds with an unpinned stable toolchain, so the
    std behind a build is not fixed. On macOS and Linux the rename replacing the target is INFERRED, not run.
  - **Item 3, other Tauri writes:** for `database/`, no other Tauri write exists (a Grep). The other truncating Tauri
    writes (assets, cold units, remote blocks, the meta file and exports) are unchanged by stage 0 and are still assigned to
    no stage's atomic-write work.
- **Open check (`MC-171` 2): not run.** The stage 0 live check on Windows in the real desktop app: save a few times, then
  restore a backup (the option text the maintainer chose). The Orchestrator's addition, not in `MC-171`: also try a
  program that holds the file without delete-share. It can be done whenever the maintainer next runs the desktop app on
  Windows. It is not a gate on stage 1.
- **New loud failure mode (from the commit message; the maintainer was told before the commit approval).** A program that
  holds `database/database.bin` open without delete-share can block the rename. After the retries the write rejects, the old
  file stays intact, and `saveDb` shows "Failed to save data, retrying…" and retries; from the fifth consecutive failed
  attempt on it shows an error alert on each attempt. The save lands once the holder closes. Before stage 0 a holder that
  shared read and write did not block the truncating write. A permanent ACCESS_DENIED (a read-only target, for instance)
  is retried the same bounded number of times before it fails. This is a workflow change, not data loss.
- **Corrections to the earlier text** (checked at HEAD `d0decfb6` by the writer unless noted):
  - `restoreWriteFailed` is `src/lang/en.ts:1692` and `internalBackupWriteFailed` is `en.ts:1695` (the filing said 1672
    and 1675).
  - `src-tauri/Cargo.lock` locks `tauri` at 2.11.5 (`Cargo.toml`'s "2.9.5" is a caret requirement); `tauri-plugin-fs` is
    2.5.2 as filed. The JS `@tauri-apps/plugin-fs` is 2.4.5 (`package.json`).
  - The numbered-backup write runs outside `dbWriteLock` (the packet).
  - The boot write-back in `installMainFileAsItIs` goes through the same `writeMainFile` dependency, so stage 0 covers it
    (the packet).
- **Notes for later stages** (the Orchestrator's, from Gate 1 and Gate 2; non-blocking):
  - The temp naming rule and the boot sweep were derived for `database/` only. When the helper serves `assets/`,
    `coldstorage/` or `remotes/` (the later stages of `MC-167`), both must be re-derived for the readers of those
    directories.
  - `encodeRemoteBlock` (`src/ts/storage/risuSave.ts`), when `skipRemoteSaving` is set, accepts an existing
    content-addressed remote file on an `exists` check, so a remote file left partial by a crash would be accepted as present. This belongs to the remote-blocks stage
    (stage 2).
  - SUSPECTED, not run: temp-then-rename replaces a symlinked `database.bin` with a regular file and, on Unix, gives the
    new file default permissions rather than the old mode. No known user setup does this.
  - The test fake `tauriFsFake.ts` never emits "os error 17", so the Unix branch of the "temp already exists" carve-out is
    untested.
- **Next for CHORE-55 (as of stage 0; the stage 2b block at the top has the current line):** stage 1: the contract, three adapters
  and one conformance suite, with no callers moved (`fake-indexeddb` is approved by `MC-167` 6). The advisor's named
  investigation before stage 2, the Tauri boot read through the asset protocol against `readFile` on a large file, is still
  open.

**Status (2026-10-01):** filed from memory stage 1 step 5b's Gate 2 round 1 (`opus-reviewer`,
non-blocking N2; Gate 2 is ledger row 530). Open. Scheduled with CHORE-51
and CHORE-52, after CHORE-53 and CHORE-43/CHORE-54, before steps 6 and 7 (`MC-151` 3). It predates step 5b,
and 5b adds a third write site with the same shape (the internal-backup load); the reviewer found the same shape in `LoadLocalBackup` and in `saveDb`.

- **Mechanism (the reviewer's trace, not run; the writer re-read the plugin source):**
  - `tauri-plugin-fs` 2.5.2 (the version in `src-tauri/Cargo.lock`) `write_file` opens the target with
    truncate set, then writes the body with `write_all`. For a JS call that does not set `append`,
    `truncate` is `!append`, so true (`commands.rs`, `write_file_inner`, lines 1078-1158 in the cargo
    registry copy; `WriteFileOptions` at `:1059-1072`). There is no temp file and no rename. The file
    is empty between the truncate and the end of the write.
  - Tauri writes the main file through this call in three places: `saveDb`
    (`globalApi.svelte.ts:1359`), `LoadLocalBackup` (`backuplocal.ts:714`) and the internal-backup
    load (`internalBackup.ts:156`, committed with step 5b as `448962f4`; line re-checked at HEAD). A
    fourth call, in `bootstrap.ts:94`, runs only when `database/database.bin` does not exist, to create
    an empty legacy save (the writer's Grep of non-test `src/ts`). `upstream/main` has the same
    `writeFile('database/database.bin', ...)` call in `globalApi.svelte.ts` (line 455) and in
    `backuplocal.ts` (line 562) (checked by the writer, `git show` and a text search).
- **Consequence (INFERRED from the mechanism; not run, and how likely a failed or interrupted write
  is was not measured):** a write that fails or is cut off after the truncate can leave an empty or
  partial `database/database.bin`. The wording "Your current database was not changed."
  (`restoreWriteFailed`, `en.ts:1672`, `LoadLocalBackup`) and "Your current data was not changed."
  (`internalBackupWriteFailed`, `en.ts:1675`, step 5b) would then be untrue.
- **What recovers it today:** at boot, if decoding the main file throws, the Tauri branch tries the
  numbered backups, newest first (`bootstrap.ts:112-139`; `getDbBackups` sorts descending,
  `globalApi.svelte.ts:1566`).
  - `TODO(evidence)`: whether a truncated or partial main file makes `decodeRisuSave` throw (so the
    backup fallback runs) or decode in part. The Gate 1 round 1 reviewer traced that the default
    decode drops a block that fails its data checksum rather than throwing; the truncation case was
    not traced.
- **Existing atomicity work, for comparison:** the Node server's `/api/write` already writes to a
  unique temp file in the same directory and renames it over the real path (Phase 1 item 9,
  Roadmap.md:75). For OPFS, Phase 0 awaited `stream.close()` in `OpfsStorage.setItem` (Phase 0 table,
  `:26`), and Phase 1 item 5 says "its atomicity bug is fixed (Phase 0)" (`:71`). The Tauri main-file
  writes have no equivalent.
- **Fix direction (non-normative; the writer's, not the reviewer's):** the Node precedent is write to
  a temp file in the same directory, then rename. The plugin has a `rename` command (`commands.rs:794`).
  - `TODO(evidence)`: whether this app's Tauri capability allows `rename`, and whether a rename over an
    existing file is atomic on each desktop platform.
  - `TODO(evidence)`: other Tauri writes through the same plugin call (assets, cold-storage units,
    numbered backups) were not surveyed.

**Status (2026-10-02, later): open; the scope is rewritten by `MC-167`. Placed after CHORE-51 and CHORE-52, with stage 0
first.** The text above is the 2026-10-01 filing and is kept; where this block differs, this block governs. The three
`TODO(evidence)` items above are only partly answered below: item 1 (a truncated file) is answered by the decode RUN for
the cuts it tried; item 2: the capability is confirmed (`src-tauri/capabilities/migrated.json`, `fs:allow-rename` with an
`$APPDATA` scope), but whether a rename over an existing file is atomic is only INFERRED; item 3 (other Tauri writes) is
answered only for the numbered backup, see the sites not covered below. CHORE-43 and CHORE-54 are closed (`71e75d9d`).

**New scope (the maintainer's direction, `MC-167` 1, 2, 4, 6 and 7).** One storage interface that every save and load goes
through, with three adapters (Tauri files, Node HTTP and one browser store, which is IndexedDB), and no code that bypasses
it for the persisted kinds. OPFS is not written again: new writes go to IndexedDB only, data missing there is read from
OPFS so upstream's archived chats keep working, there is no migration step, and the OPFS switch in Backup & Files goes
away. `fake-indexeddb` may be added as a devDependency (not yet added). Inlays move under the interface in a later stage,
with CHORE-48. Cross-chat search through the interface is a later feature (`MC-167` 8), not scheduled. **The original
defect, no write-then-rename on the Tauri main file, stays as stage 0.**

**Stages (planning basis, not yet gated).** These are the `senior-advisor`'s recommended strategy (ledger row 635),
accepted by the Orchestrator as the planning basis (`MC-167`, the Orchestrator's calls). They are not a gated plan: no
stage has a plan, a contract or tests yet.
- **Stage 0:** an atomic path write (temp file, rename, remove the temp file on failure, a bounded retry for Windows
  sharing violations) at the six Tauri sites below. About 60 lines plus tests (sizing packet, question 8). Crash
  atomicity only; there is no fsync (see below). This is the Tauri adapter's write primitive later, so it is not
  duplicated.
- **Stage 1:** the contract, the three adapters and one conformance suite, with no callers moved (about 400 to 600 new
  lines, sizing packet question 8). `fake-indexeddb` is approved for this stage.
- **Stage 2:** the main file, numbered backups, snapshots, remote blocks, the boot read, the boot archive commit, restore
  and the internal-backup load.
- **Stage 3:** assets, through a `urlFor` operation (a bytes `get` cannot replace it: sizing packet question 2).
- **Stage 4:** cold units with the read-through to OPFS, the removal of the OPFS main-database switch, and the copy-back
  of a hand-set `opfs_flag!` at boot (`disableOpfs` already does that copy-back, per the advisor).
- **Stage 5 or later:** inlays (CHORE-48), the search index, CHORE-46's streaming.
- **Gating (the advisor's):** never gate stage 2 together with stage 3, or stage 2 with stage 4; `opus-reviewer` gates every
  stage.
- **The advisor's contract sketch:** `read`, `write`, `delete`, `list(prefix)`, `has` and `urlFor`; binary only, whole
  values; no multi-key transaction, no GC, no chunking; a conditional write must never degrade silently, with a capability
  flag. The version is a value: `read` returns the bytes and a version, and `write` and `delete` take `ifVersion`, so
  `peek` disappears. LocalForage `risuai`/`keyvaluepairs` is kept with its driver pinned to IndexedDB, as
  `avatarThumb.ts` does. `risuSaveCache` is registered as a load-bearing write-ahead copy and never cleaned up. The
  non-strict install policy at startup is left alone (CHORE-70).
- **Next investigations the advisor named:** the Tauri boot read through the asset protocol against `readFile` on a
  155 MB file (the advisor's test size, not a limit: `MC-167` 3), before stage 2; a stage 0 live check on Windows, rename against an open handle; before stage 4, the largest
  unit from the synthetic profile and a put/get on a phone.

**The six Tauri write sites (the sizing packet's P2; the writer opened each line at HEAD `71e75d9d`).** The sizing
packet found five `writeFile` calls to `database/database.bin` and a numbered-backup write of the same shape:

| Site | What it writes |
|---|---|
| `src/ts/globalApi.svelte.ts:1359` (`saveDb`) | the main file |
| `src/ts/globalApi.svelte.ts:1384` | the numbered backup `database/dbbackup-<ts>.bin` |
| `src/ts/drive/backuplocal.ts:714` | the main file, in `LoadLocalBackup` |
| `src/ts/drive/internalBackup.ts:156` | the main file, in the internal-backup load (`448962f4`) |
| `src/ts/storage/bootArchiveHost.ts:78` | the main file, in the boot archive commit (`9b312962`); **not in the 2026-10-01 filing** |
| `src/ts/bootstrap.ts:106` | the main file, on first launch (the filing said `:94`) |

The sizing packet counted no `rename`, `copyFile`, `stat` or `truncate` call to the fs plugin in non-test `src` (a RUN
count); the writer did not re-run it. The writer confirmed that `src-tauri/capabilities/migrated.json` lists
`fs:allow-rename` and `fs:allow-remove` with an `$APPDATA` scope. The packet adds that `rename` is `std::fs::rename` in the
plugin (not re-read by the writer). `upstream/main` has the same non-atomic write (filing text above). Boot reads the main
file and the backups through the asset protocol (`fetch(convertFileSrc(...))`), not through fs IPC (sizing packet, P3).

**Tauri `writeFile` sites that stage 0 does not cover, and that no stage yet assigns atomic-write work to** (the writer
opened each line at HEAD `71e75d9d`): `src/ts/globalApi.svelte.ts:492` (assets), `src/ts/drive/backuplocal.ts:647`
(assets), `src/ts/process/coldstorage.svelte.ts:346` (cold units), `src/ts/storage/risuSave.ts:804` (remote blocks) and
`src/ts/bootstrap.ts:845` (a meta file). The stages above move assets (stage 3), remote blocks (stage 2) and cold units
(stage 4) onto the interface, but none of them is stated to make these writes atomic; the stage plans have to say so.

*Dated note (2026-10-03, after stage 3; the list above is kept as written):* of these five sites, only the cold-unit site
in `coldstorage.svelte.ts` (stage 4) is still outside the store. The remote-block and meta sites were moved by stage 2b
and the two asset sites by stage 3. The extension prerequisite in the stage list is met: new assets get a sanitized
extension (1 to 16 ASCII letters or digits, else `png`), and existing asset names are kept as they are. The remote-block
and meta sites were already store calls before stage 3 (moved by 2b). The other `writeFile(` hits in `src` are not the
Tauri plugin: `process/mcp/filesystemclient.ts` (a class method) and `process/pyworker.ts` (`py.FS.writeFile`).

*Dated note (2026-10-03, after stage 4; the list and the note above are kept as written):* the cold-unit site in
`coldstorage.svelte.ts` is now a store call (`980791fa`; on Tauri a unit write is the adapter's temp file and rename). No
Tauri `writeFile` site from the list above remains outside the store. A grep of `writeFile\(` in `src` at `980791fa`,
excluding `*.test.ts`, finds `globalApi.svelte.ts` (line 89, a write into the Download folder; line 2395,
`TauriWriter.write`, a user-chosen export path), the temp write inside `storage/tauriAtomicWrite.ts` (line 98), the
test fake `storage/tests/tauriFsFake.ts` (line 168), and the two non-plugin hits named above.

**Why stage 0 matters: the decode cut RUN (ledger row 636).** A synthetic save (four characters, 686 bytes) was cut at
many points and decoded with `decodeRisuSave`, strictly and not strictly, with an empty and a populated `risuSaveCache`.
- **Throws in both modes, so the backup fallback runs:** a 0-byte file, a cut inside the header, a cut in the middle of
  a block, and a cut before the root block ends. This answers the filing's `TODO(evidence)` about a truncated file, for
  these cuts. The sizing packet's "0-byte file: NOT TRACED" is answered the same way.
- **Does not throw:** with an empty `risuSaveCache`, a non-strict decode of a cut at any of the 10 block boundaries from
  the one right after the root block to the one before the last block, and of the file minus one byte, returns a tree with
  characters missing (for example 0 of 4 characters at the boundary right after the root, 3 of 4 at length minus 1). With a populated `risuSaveCache` the same cuts decode to
  a full tree: the cache silently completes the file (only a cache from the same generation was tested). A strict decode
  throws at every cut except the full length.
- **Boot (TRACED by the writer's read of `src/ts/bootstrap.ts:425-455` at HEAD `71e75d9d`, not run):** `decodeMainFile`
  falls back to a non-strict decode when the strict decode throws, and `resolveArchiveOutcome` installs a non-strict tree
  without the archive pass and without trying a backup. The result is a startup with characters silently missing; that
  the next save keeps the loss is INFERRED, not traced. That startup decision is CHORE-70. The question put to the
  maintainer (the Orchestrator's text) began "Confirmed by test", but only the decode was RUN; the boot path was TRACED.
  It said that after about 100 minutes of saving all 20 backups could be newer than the damage; the basis is the sizing packet's note that a
  backup is written at most every 5 minutes and 20 are kept (20 times 5 is 100; arithmetic, not run).
- **What stage 0 gives:** protection against a write cut off by a crash or a failed write. It does not fsync, so it is not
  power-loss durability (INFERRED, sizing packet question 2). A rename over an existing file on Windows is INFERRED to
  replace it; the stage 0 live check on Windows is named above.
- **The decode is RUN; the boot is TRACED.** The results file records decode outcomes only; the Tauri boot was not run.
  The Orchestrator traced the Tauri boot branch at `71e75d9d`: `src/ts/bootstrap.ts:124-125` passes the main file to
  `decodeMainFile` and then `resolveArchiveOutcome`, and reads the backups (`:145-172`) only when that outcome is not an
  install.

**What the sizing found (ledger row 633; sizing packet `chore55\sizing-packet.md` in the session scratchpad, not a repo
file; the Orchestrator re-verified P1 and P4).**
- **Upstream writes cold-storage units to OPFS on web** (P1; `git show upstream/main:src/ts/process/coldstorage.svelte.ts`,
  the non-Node, non-Tauri branch, `coldstorage_<key>.json`). A same-origin upstream-to-fork user has data there, and a
  pointer whose unit is gone reads as `missing`. That is why OPFS stays readable (`MC-167` 2). Upstream's `opfs_flag!`
  main store is set by hand only, with no UI upstream, and the LocalForage copy is never removed, so a boot that ignored
  the flag would load a stale `database.bin` (`autoStorage.ts:147-152` refuses this today, per the packet).
- **Tauri is not the only bypass** (P3). Cold storage bypasses `AutoStorage` on every backend (a cast to `NodeStorage` on
  Node, direct fs on Tauri, direct OPFS on web). The packet also lists ten other localforage database names, raw
  IndexedDB, the Cache API and 56 `localStorage` lines, which the scope above does not cover. "No bypass" over the persisted
  kinds is about 36 `forageStorage` lines, about 70 Tauri fs lines and 7 OPFS lines in about 17 files (the sizing packet's
  counts; the grep patterns were not recorded).
- **Remote saving is off by default** (P4; only a checkbox sets it), so `database.bin` is one body per save. On Node a body
  is capped at 100 MiB (`bodyLimit.cjs`), and `bootArchivePass.ts:807` refuses a commit over the limit. Nothing chunks.
- **The sized options** were costed before the maintainer chose read-through. Option A (everything to IndexedDB, with a
  migration) was about 700 to 1000 changed lines in about 17 files with a mandatory migration under an exclusive lock;
  option B (main database only) cannot drop OPFS. The read-through the maintainer chose (`MC-167` 2) was not sized
  separately; the advisor proposed it after the sizing, and the CHORE-55 plan has to size it.
- **Load-bearing risks (the packet):** `risuSaveCache` silently completes torn main files in non-strict decode, a hidden
  recovery path outside `AutoStorage` that must be kept; boot installs a non-strict decode without trying a backup
  (CHORE-70); `OpfsStorage.keys()` filters non-hex names, so the key spaces must stay separate; Node `/api/list` returns
  stray keys (`__revisions.json`, `.tmp-` leftovers) that only prefix filters tolerate; cold-unit file naming differs per
  backend, so the key mapping must live in the adapters; the Node revision is adopted only by `getItem` and `setItem`, and a
  generic adopting `get` would bring back the overwrite the 409 prevents.
- **Not measured:** IndexedDB against OPFS latency for 1, 10 and 50 MB units; IndexedDB per-value ceilings on iOS and
  low-end Android (INFERRED, undocumented locally); whether real users have OPFS data (treated as present).

**Cross-file atomicity (the maintainer's question S2; the sizing packet's Q9).** The `saveDb` order is: the encoder's remote
blocks and `risuSaveCache`, then the root block under the write lock, then the BroadcastChannel, then an optional backup,
then the prune.
- The root is atomic on Node and IndexedDB; on OPFS it is INFERRED atomic on close (sizing packet Q2); on Tauri it can
  be torn or empty (this ticket).
- Remote blocks are hash-named since `86f59105` (the Stage 3a naming), so a crash between the blocks and the root leaves
  harmless orphans that are never reclaimed; a stale client's root is rejected by the Node revision check (409). This
  applies with remote saving on, on Tauri and Node only.
- On Tauri a torn newest backup is possible; boot tries the newest first and moves on when decoding throws.
- Orphan collection (GC) is absent (0 hits); Report 08 recommends not building it; no open ticket. The interface needs a
  revision token on `get`, `put` and `delete`, an atomic replace and `has`. Only a GC would need a multi-key
  precondition, and deferring it forces no change to the interface if the revision token and a batch delete are in the base
  contract. If wanted, a GC is about 200 to 300 lines plus tests (not independently sized). Web multi-tab has no write-time
  conflict check on IndexedDB and OPFS (INFERRED).
- **Not decided:** whether a cross-file atomicity mechanism is built (`MC-167` 10).

**Related:** `MC-167`, `MC-171`, `MC-172`, `MC-173`, `MC-174`, `MC-175`, `MC-089` (point 1 superseded), `MC-011`; CHORE-43/54 (closed), CHORE-48
(inlays), CHORE-51 and CHORE-52 (closed by `59881788`), CHORE-59 (the same family), CHORE-70, CHORE-46, Report 08; commits
`d0decfb6` (stage 0), `d95b07da` (stage 1), `a29335f7` (stage 2a) and `cbaeddd6` (stage 2b); ledger rows 633, 635, 636,
658 to 665, 666 to 678, 679 to 690 and 691 to 696.

### CHORE-56 — Under the beta mobile layout, a touch that ends on a button, input, select or textarea throws a TypeError in the swipe handler (suspected; upstream and fork)

**Status (2026-10-03, UI session): DONE 2026-10-03 in `e9a80ec5`** (ledger rows 806 to 813). Confirmed and placed by the
maintainer (`MC-200` 2) in the mobile batch; the fix keeps controls excluded from swipes and only stops the error
(`MC-201` 3). Mechanism re-traced at HEAD, with current line numbers, in ledger row 803.

**Status (2026-10-01):** suspected; TRACED, not run. **Not placed** (the maintainer has not yet confirmed or
placed it). Filed by the Orchestrator: the maintainer was told it would be filed unless they had never
seen such a popup, and has not answered. Present on the fork at HEAD `448962f4`, and the same lines are on
`upstream/main` `f9728b14` by text search of `git show` (upstream not run).

- **Mechanism (TRACED, not run):**
  - `initMobileGesture` (`src/ts/hotkey.ts:436-485`) keeps `pressingPointers`, a map from touch
    identifier to the touch's start point. Its `touchstart` listener (`:439-449`) loops over
    `ev.changedTouches` and **`return`s from the whole listener**, not just that iteration, when a
    touch's `target` has the tag BUTTON, INPUT, SELECT or TEXTAREA (`:442-444`). No entry is stored for
    that touch, nor for any later touch in the same event.
  - Its `touchend` listener (`:450-484`) then does `const d = pressingPointers.get(touch.identifier)`
    (`:452`) and `touch.clientX - d.x` (`:453`). With no entry, `d` is `undefined` and that line throws a
    `TypeError`, before the swipe test at `:457`.
  - `updateErrorHandling` (`src/ts/bootstrap.ts:359-372`) registers a window `error` listener that calls
    `alertError(event.error)` unless `event.error.target instanceof Worker` (`:360-365`). By source, a
    tap that starts on such an element therefore shows an error popup. That an exception thrown inside an
    event listener reaches the window `error` handler in every browser is INFERRED, not tested.
  - On `upstream/main` `f9728b14` the matching lines are `hotkey.ts:362-381` (the tag test at `:368`, the
    `get` at `:378`) and `bootstrap.ts:288-297` (the handler's `instanceof Worker` test and `alertError`
    at `:291-292`).
- **Scope:** the handler is registered only when `(db.betaMobileGUI && window.innerWidth <= 800)` or the
  Lite build is on (`src/ts/bootstrap.ts:306-309`). `betaMobileGUI` is a display-settings checkbox
  (`src/ts/setting/displaySettingsData.svelte.ts:351`) and a search of non-test `src/` finds no default
  for it, so the default phone layout and desktop do not register the handler (the same reading as
  CHORE-43's P1).
- **Uncertain:**
  - How often `touch.target` is the BUTTON element itself rather than a child inside it (an icon, an SVG
    or a span). Only the first case lacks an entry and throws. If most buttons in the layout wrap their
    content, the popup would be rare; if many do not, it would be common.
  - Whether the popup is actually seen. No device run; the maintainer was asked whether they had ever
    seen one.
  - The effect on the swipe itself is TRACED only: the throw happens before the swipe test, so that
    touch cannot step `MobileGUIStack` or `MobileSideBar`.
- **What would settle it:** a real-device tap on a button under the beta mobile layout (the setting on, a
  window of 800 px or less), watching for the error popup or a `TypeError` in the console.
- **A likely shape (non-normative):** in `touchend`, skip a touch that has no stored entry. In
  `touchstart`, do not `return` from the whole listener on an excluded target; skip only that touch, so
  the other touches in the event are still recorded.
- **Related:** Maybe-Later QOL-07 (it reads this same handler for the sideways gestures).

### CHORE-57 — Chat import offers `.txt` but has no `.txt` branch, so a picked `.txt` does nothing and says nothing (suspected; upstream and fork)

**Status (2026-10-03, UI session): DONE 2026-10-03 in `e10cbbbd`** (ledger rows 869 to 877).
The maintainer chose "Drop .txt, alert (Recommended)" over "Parse Risu's TXT export" and "Leave as is" (`MC-208`); the
earlier low-priority note (`MC-151` 7) is below. `importChat` in `characters.ts`:
- The picker offers `json`, `jsonl` and `html`.
- A file that matches no branch shows `alertError(language.errors.noData)`; this covers `.txt` and, with
  `allowAllExtentionFiles` on, any other extension.
- **New finding (row 869):** the extension tests were case-sensitive while the picker lowercases, so `CHAT.JSONL` was silently
  ignored. The tests now compare the lowercased name.
- JSONL blank lines are skipped before the header-line logic, so a file with a trailing newline imports (the Orchestrator's
  disposition). Whether SillyTavern's JSONL exports end in a newline is still unchecked: `TODO(evidence)`.
- The comma-operator condition `presedLine.name && presedLine.is_user, presedLine.mes` is unchanged.
- **Tests:** five new tests in `src/ts/characters.importChat.test.ts` (the picker list, a `.txt` showing the error and adding no
  chat, an upper-case extension, a trailing newline or blank lines, and blank lines before the header). They are in the
  small-fixes red check, in which 9 of 14 tests fail at HEAD on assertions (row 874; the 14 are `prompt.tokenizePreset.test.ts` 3, `globalApi.openURL.svelte.test.ts` 3 and `characters.importChat.test.ts` 8). Checks are those in CHORE-13's entry.
- **Stale line citations below:** the line numbers in the original entry (`characters.ts:424` and onward) are those of
  `448962f4`; this change shifts them.

**Status (2026-10-01):** suspected, from reading; not run. **Low priority**, by the maintainer's decision
(`MC-151` 7: "mark txt import bug as low priority for now. most people uses json anyway."). **Not placed**:
it has no position in the work order. Present on the fork at HEAD `448962f4`. `upstream/main` `f9728b14` is
identical in the parts that matter, by `git show` (upstream not run).

- **Mechanism (TRACED by reading, not run):**
  - `importChat` (`src/ts/characters.ts:424`) opens the picker with
    `selectSingleFile(['json','jsonl','txt','html'])` (`:425`). The picker puts the list in the file
    input's `accept` unless `allowAllExtentionFiles`, iOS or a `*` list switches the filter off
    (`src/ts/util.ts:232-239`), and a picked `.txt` passes the extension filter (`:249-252`).
  - Inside the `try`, the code tests the file name three times: `endsWith('jsonl')` (`:432`),
    `endsWith('json')` (`:473`) and `endsWith('html')` (`:541`). Nothing tests for `txt`, and there is no
    final `else`. A `.txt` file therefore matches no branch, and the function returns with no alert and
    no change to the character's chats.
  - `upstream/main` `src/ts/characters.ts` has the same picker line (`:372`) and the same three tests
    (`:379`, `:420`, `:490`), and the text `txt` appears in `importChat` there only in the picker line
    (checked by `git show` and a line scan of `:371-510`).
- **Related facts:**
  - The same function also ends silently for any other extension when `allowAllExtentionFiles` is on (by
    the same reading).
  - `exportChat` offers "Export as TXT" (`characters.ts:248`) and writes a `.txt` file of `--<name>`
    header lines and messages (`:402-415`), so a TXT export has no import to match.
  - By `git log -S` on this repository's history, the picker line with `'txt'` first appears in
    `507c3e62` (2024-06-19, "add export via htmls"), and no commit adds `endsWith('txt')` to
    `characters.ts` or `characterCards.ts`. Whether a `.txt` import was ever meant to read that export, or
    only the SillyTavern format, is not known. `TODO(evidence)`.
- **Two more suspected defects in the same function's JSONL branch (Orchestrator, by reading at
  `448962f4`; not run; same low priority):**
  - The text is split on `'\n'` and every line goes to `JSON.parse(line)` with no empty-line guard
    (`characters.ts:433`, `:446`). A file that ends in a newline gives a trailing `''`, `JSON.parse('')`
    throws, and the catch reports an error, so the whole import fails. Whether SillyTavern's JSONL files end
    in a newline is not checked. `TODO(evidence)`.
  - The message test `presedLine.name && presedLine.is_user, presedLine.mes` (`:447`) uses the comma
    operator, so only `presedLine.mes` is tested.
- **A likely shape (non-normative):** either remove `'txt'` from the picker list, or add a branch for a
  format to be chosen; in both cases end `importChat` with a message when no branch matched. Which is
  wanted is a product choice and is not decided. Skip empty JSONL lines.
- **What would settle it:** pick a `.txt` file in the chat import dialog in a browser run and watch for
  an alert or a new chat.
- **Related:** Maybe-Later QOL-08 and QOL-09 (both build on `importChat`).

### CHORE-58 — PNG character import copies its read buffer quadratically on large assets (TRACED; replica timings only; upstream and fork)

**Status (2026-10-03, latest): done by `282b2da5` (local, not pushed; `MC-184`, `MC-185`).** Measured first (ledger rows 748 and
749), then planned: Gate 1 (`opus-reviewer`) took two rounds (`[REJECT]`, `[EDITORIAL]`), Gate 2 (`opus-reviewer`) two
(`[EDITORIAL]`, `[EDITORIAL]`). Ledger rows 748 to 756 are the work, rows 757 and 758 are these records and their fact-check.
The older status blocks below are kept as written (their line numbers are from `448962f4`/`5bbc591a` and are stale; the code
they cite has moved); where this block differs, this block governs. The text of this block comes from the commit message (`git
log -1 282b2da5`; Gate 2 round 1 checked it) and the session's measurement, plan and gate files.

- **What changed (from the commit message):** `PngChunk.readGenerator`'s stream branch (a `File` is turned into its `stream()`
  first) now reads through a forward-only window, `StreamWindow` in `src/ts/pngChunk.ts`. It keeps the stream's own reads, copies
  only the requested range on each slice, and at the start of each PNG chunk drops the reads that end before it.
  - **Unchanged:** the `Uint8Array` branch, `AppendableBuffer`, the trimmed-PNG output, the counting prereader and the progress
    display. The exact asset-count percentage is kept (`MC-184`). A card imports into the same character, assets and trimmed
    image as before, so the upstream-card compatibility invariant holds (`MC-175`).
  - **Behaviour kept on the stream branch:** a read that the ended stream cannot fill returns nothing (a tEXt body cut short
    yields an empty key and value, never a partial asset); a failed stream read, such as a dropped download, is thrown, never
    taken as the end of the file; empty reads are skipped; nothing after IEND is parsed.
  - **A move for testability:** `AppendableBuffer`, `VirtualWriter` and `blobToUint8Array` moved unchanged into the new
    `src/ts/byteBuffer.ts`, which imports nothing from the app; `globalApi.svelte.ts` and `util.ts` re-export them by name, so
    every existing import and `instanceof` check sees the same class.
- **Measured (from the commit message; Node v24.19.0, happy-dom, an i9-13900K: best-case hardware, not the Pi 3 or phone floor
  of `MC-003`; synthetic cards; a 64 KB-chunk stream, and a `File` that arrives as one chunk):**
  - bytes produced by `Uint8Array.prototype.slice` per file byte in one pass, before: 100 x 1 MB assets 342x (stream) / 859x
    (`File`), 400 x 250 KB 848x / 3047x. After, counting every copy (slice, set, copying constructors, `ArrayBuffer.slice`):
    about 2.0x at 10 and 40 assets, the same as a card passed in memory;
  - the counting pass plus the main pass at 100 x 1 MB: 16.6 s (stream) / 40 s (`File`) before, about 1.2 to 1.5 s after; at
    200 x 1 MB about 68 s / 150 s before, about 2.9 s after;
  - a whole import with the store mocked, from a 64 KB-chunk stream: 100 x 1 MB 17.1 s before, 1.2 s after; 400 x 250 KB 40.3 s
    before, 1.5 s after, about the same as the same bytes passed in memory.
  - **Not measured:** Chromium's `File.stream()` chunking, real store I/O, a live app, and any hardware slower than the i9.
  - Before this change the shape was quadratic: scaling 25, 50, 100, 200 assets of 1 MB gave 1.8, 5.0, 16.6 and 67.8 s total
    (`measurement.md` in the session scratch).
- **Tests (from the commit message and `pngChunk.readGenerator.test.ts`):** 30 tests in `src/ts/pngChunk.readGenerator.test.ts`.
  - Two reproducers, a 64 KB-chunk stream and a `File`, fail against the pre-change reader on the copy-ratio assertion (42.74 and
    91.83 bytes copied per file byte, limit 5); they also require the ratio not to grow from 10 to 40 assets. The red run
    against `HEAD` before the memory tests were added was 26 tests, 24 pass and 2 fail (`red\head-table.txt` in the session
    scratch).
  - Guards that pass before and after: output identical to the `Uint8Array` branch over many chunkings; nine truncated files
    whose expected output is written down from the pre-change reader; a stream that fails mid-file; the trimmed result's class
    and exact size (G4: an `AppendableBuffer` whose `.buffer` is an exactly-sized fresh `Uint8Array`).
  - Four memory guards (`StreamWindow` does not exist before this change, so they cannot be shown failing there): three tests
    that `release()` drops only the reads that end at or before its offset, and a pass over 8 x 1 MB assets in 64 KB reads
    during which the window holds at most 1,262,144 bytes; without the release it holds 8,000,663.
- **Checks (from the commit message):** `pnpm test` 326 files, 7005 passed, 4 skipped; `pnpm check` 0 errors and 0 warnings;
  `pnpm build` passes.
- **Gate 2 evidence (`opus-reviewer`, round 1; the reviewer's scratch harness, not in the repo):** a differential fuzz of the old
  and new stream branch over 4,500 random cards (truncations, flipped bytes, bad lengths, long keys, trailing bytes, chunkings
  from 1 byte to 70 KB, empty reads): 0 mismatches. A mutation run of 19 mutants: 13 killed, 2 survived (`release_none`,
  `release_one_fewer`: memory only, no test saw the release) and 4 equivalent (the reviewer's label). The remediation added the
  memory guards above, and the two survivors are then killed (the Orchestrator's record; `gate2fix\` in the session scratch holds
  the `release_none` mutant only). The round 1 findings were editorial: the commit message's "1.0x after" counted only
  `Uint8Array.prototype.slice` and missed the window's `set()` copies (the full count is about 2.0x), a test comment implied an
  extra copy, and `MC-184` was cited before it was recorded.
- **Residuals (from the commit message and the plan):**
  - a Realm PNG download is still held in memory in full while the counting pass reads its `tee()` branch (ticket CHORE-77; call structure TRACED, the hold MEASURED in Node streams at +208 MB for a 200 MB card, not measured in a browser);
  - base64 decoding and asset hashing remain linear costs;
  - the `Uint8Array` branch (the Charahub import and Tauri `importFile`) can still save a partial asset from a tEXt body cut short
    (ticket CHORE-76);
  - the counting prereader still decodes every tEXt body to a string a second time (linear, kept so the count keeps the
    reader's exact semantics; the Gate 1 round 2 review expected it to cost several times more on the `MC-003` floor than on the
    i9, unmeasured).
- **Maintainer decisions:** `MC-184` (keep the exact percentage; the fix plan approved) and `MC-185` (commit; CHORE-76 and
  CHORE-77 next).
- **Related:** `MC-182`, `MC-184`, `MC-185`; CHORE-59 (the previous item); CHORE-76; CHORE-77; Maybe-Later QOL-04.

**Earlier status (2026-10-03): placed right after CHORE-59, ahead of memory steps 6 and 7 and CHORE-62 (`MC-182`, the
maintainer's decision); measure first.** The placement below ("last in the current order", `MC-151`) is amended by `MC-182`;
the rest of this entry is unchanged.

**Status (2026-10-01):** TRACED in source (the Orchestrator verified F1's four code points,
`AppendableBuffer.slice`, the `buffer` getter, `deappend` and `readGenerator`'s trim; the writer
re-read the rest); not measured on the real module or the live app. **Scheduled: last in the current
order, after steps 6 and 7 (`MC-151`)** *(amended 2026-10-03 by `MC-182`: now right after CHORE-59)*; the first task is a
measurement on the real module or the live app.
Import performance, not data loss. Present on the fork at HEAD `448962f4`, and on `upstream/main`
`f9728b14`: `src/ts/pngChunk.ts` is identical (`git diff upstream/main HEAD --stat` for it prints
nothing), and the `AppendableBuffer` methods and the prereader are the same by text (`globalApi.svelte.ts`
`:1435-1436`, `:1464` and `:1476`; `characterCards.ts` `:199-215` on upstream; read with `git show`,
upstream not run).

- **Mechanism (TRACED):**
  - `AppendableBuffer.slice` returns `this.buffer.slice(start - deapended, end - deapended)`
    (`src/ts/globalApi.svelte.ts:2593-2595`). The `buffer` getter is `this.#buffer.slice(0, this.#byteLength)`,
    which copies the whole retained buffer on every call (`:2553-2555`). `deappend` copies the remainder of
    the backing array, `this.#buffer.slice(length)` (`:2581-2585`).
  - In `PngChunk.readGenerator` (`src/ts/pngChunk.ts:131`), the stream branch's `slice` appends stream
    chunks until `end` is reached, calls `readableStreamData.slice(start, end)` (`:166`), then drops 50000
    bytes, and only if `start - readableStreamData.deapended > 200000` (`:168-170`). A `tEXt` chunk costs
    three `slice` calls (the length at `:182`, the type at `:184`, the body at `:199`), so at most about
    150 KB drains per chunk.
  - An asset chunk larger than that therefore leaves the retained buffer larger by its size minus about
    150 KB, and every later `slice` copies all of it. The copy cost grows with the square of the number of
    large assets.
  - **The prepass.** `importCharacterProcess` first runs a "prereader" over the same file (or a `tee()` of
    the stream) only to count `chara-ext-asset_` chunks for the progress percentage
    (`src/ts/characterCards.ts:139-163`). It is created without `returnTrimed` (`:151-153`), so it never
    yields the trailing buffer and its `break` (`:156-158`) never fires. It scans the whole file to its
    end, decodes every `tEXt` body, asset chunks included, into a string (`pngChunk.ts:198-209`), and pays
    the same copy on every chunk. The real pass (`characterCards.ts:166-210`) then repeats all of that.
  - **How a `File` came to take this branch (TRACED from the diff, `git show 8541258a -- src/ts/pngChunk.ts`).**
    Before `8541258a`, a `File` input was read by range with `blobToUint8Array(data.slice(start, end))` and a
    known `size`, with no whole-buffer copy. That commit converts a `File` to `data.stream()` at the top of
    `readGenerator`, so it takes the `AppendableBuffer` stream branch, which introduced the quadratic copy for
    local-file import. This does not change "keep streaming" below.
- **Scope:**
  - The PNG path of `importCharacterProcess` (everything after the `png` name check at
    `characterCards.ts:120-123`), for assets whose chunks are over about 150 KB. A `File` or a `ReadableStream` takes the stream branch (`pngChunk.ts:134-141`): the file
    picker (`characterCards.ts:40`), the drop handler (`src/App.svelte:96`) and the Realm PNG download
    (`characterCards.ts:1797-1800`, `res.body`, split by `tee()` at `:142-146`). A `Uint8Array` input
    takes `data.slice` instead (`pngChunk.ts:152-154`), which does not have this copy. Examples: the
    Charahub import (`characterCards.ts:374-377`) and `importFile` (`:509-514`), which pass a `Uint8Array`.
  - `.charx` is **not affected**. It does not call `readGenerator` (no `PngChunk` in
    `src/ts/process/processzip.ts`); it accumulates each entry with `AppendableBuffer.append`, which
    doubles its backing array, and reads `.buffer` once per entry (`processzip.ts:344`, `:355`). The
    `.charx`/`.jpg`/`.jpeg` branch is `characterCards.ts:80-118`.
  - Assets under about 150 KB drain as fast as they arrive, and are not affected (see the replica).
  - Other `readGenerator` callers pass a `Uint8Array`, so they do not take the stream branch:
    `characters.ts:144` (`img`) and `persona.ts:110` (`v.data`). The export at `characterCards.ts:1422`
    passes `rData`, which is declared `let rData:Uint8Array` (`:1316`) and assigned `img` or `await readImage(key)` (`:1319`,
    `:1325`), so it takes the `Uint8Array` branch, which CHORE-58 leaves unchanged (settled 2026-10-03 by the CHORE-58 investigation,
    ledger row 749, and checked in source at `282b2da5`; it is a declared type, not a run-time check). The trimmed
    result of a stream import is a separate value: an `AppendableBuffer` whose `.buffer` is a `Uint8Array` (test G4).
- **Evidence and its label:**
  - The code trace above is TRACED.
  - The timings are a replica, not the real module and not Chromium. The investigator ran a copy of the
    `AppendableBuffer` and `readGenerator` slice logic in a scratch script (Node v24.19.0; 64 KB stream
    chunks the investigator chose; one pass; one machine; the script is not in the repo). Bytes copied per
    file byte were 160x for 50 x 1 MB, 320x for 100 x 1 MB and 641x for 200 x 1 MB, taking 1.2 s, 4.7 s and
    19.2 s; 400 x 250 KB gave 595x and 8.8 s; 50 x 100 KB gave 15x and 25 ms. These are best-case desktop
    figures; the hardware floor is a Raspberry Pi 3 and mid-range phones (`MC-003`).
  - Not known: whether this is the dominant cost of a PNG import in the real app, and Chromium's
    `File.stream()` chunk size (it affects the constant, not the quadratic shape).
- **What would settle it:** a measurement on the real module or the live app, either
  - a Vitest `.harness.ts` that runs the real `readGenerator` (extract `AppendableBuffer` first; the
    existing `save-gen` harness measures `$state.snapshot` only; the pattern and
    `Agents/Tools/vitest.harness.config.ts` fit); or
  - a live-app run on the browser-pane protocol of `Agents/Tools/README.md`: import a synthetic PNG card
    (100 x 1 MB, 400 x 250 KB, 50 x 100 KB), timing the prereader loop, the main loop and the cumulative
    `saveAsset` time separately, on the Node server, OPFS, LocalForage and Tauri.
- **A likely shape (non-normative; the investigator's E1):**
  - Keep streaming. `8541258a` ("Improve performance of PNG card imports", 2025-08-11) introduced the
    `File.stream()` path for large files on mobile, and it is on `upstream/main`.
  - Add a non-copying read to `AppendableBuffer` and use it in `readGenerator`'s `slice`; do not change
    the semantics of `get buffer()` (non-test `src` has 23 occurrences of `AppendableBuffer` in 8 files).
  - Drop the prepass, or replace it with a cheaper count; progress can use bytes read over file size.
  - Invariants: `readGenerator` yields byte-identical `{key, value}` and trimmed-image buffer, including
    across stream-chunk boundaries and for chunks larger than the stream chunk; the export at
    `characterCards.ts:1422`, `persona.ts:110` and `characters.ts:144` keep their behaviour; a faster
    drain changes peak memory, so it needs a peak-memory check on a large file.
  - A test that fails on today's code is proposed: a synthetic PNG with 100 x 1 MB `tEXt` chunks. It was
    not run against the real module.
- **Placement (`MC-151`; amended 2026-10-03 by `MC-182`, which moves CHORE-58 right after CHORE-59, ahead of steps 6 and 7):**
  the Orchestrator recommended, and the maintainer accepted, last in the current
  order, after steps 6 and 7. The Orchestrator's reasons: it is import performance, not data loss, and
  everything ahead of it is data loss or memory stage 1; the fix is small and self-contained, in
  `readGenerator` and `AppendableBuffer`; and a local backup restore does not use `AppendableBuffer` (the
  writer's Grep finds none under `src/ts/drive`), so a backup restored by a user migrating from upstream is
  not affected.
- **Related:** Maybe-Later QOL-04 (the investigation behind this ticket, ledger row 532; the semaphore for
  the PNG save loop is a separate idea there, E2) and QOL-08.

### CHORE-59 — Load Internal Backup refuses a partly damaged snapshot as a whole

**Status (2026-10-03, latest): done by `4801a2f9` (local, not pushed); the maintainer's four answers are `MC-183`.** Gate 1
(`opus-reviewer`) took three rounds (`[REJECT]`, `[REJECT]`, `[EDITORIAL]`); Gate 2 (`opus-reviewer`) two (`[EDITORIAL]`,
`[EDITORIAL]`). Ledger rows 736 to 745 are the work (the investigation, Gate 1, the implementation, the tests, the
translations, Gate 2 with the remediation); rows 746 and 747 are these records and their fact-check. The older status
block below is kept as written (its line numbers are from `57235222` and are stale); where this block differs, this block
governs. The text of this block comes from the commit message (`git log -1 4801a2f9`; its Gate 2 round 2 review checked
a draft of it) and the session's gate and plan files.

- **What is now offered (from the commit message):** a snapshot that fails the strict decode is no longer always refused whole.
  - **Still refused whole**, with the same "damaged or incomplete" message (`internalBackupUnreadable`): root damage,
    framing damage and an unknown format version.
  - **Any other damage** goes through a new salvage decode (`salvageRisuSave` in `src/ts/storage/risuSave.ts`). It never
    reads the block cache, so no cached block newer than the snapshot is mixed in. A v1 `.local.bin` remote file is read
    as it is now, which may be newer than the snapshot. It records each block it leaves out once, by name and kind: a
    character (a damaged block, a missing directory entry, or a remote file that is missing, unreadable or not JSON), a whole
    kind (presets, modules, loadouts, plugins, plugin data), or a part this version cannot read.
  - **Before anything is written, a confirm lists what would be left out.** A character is named from the current data when it
    holds that id, otherwise by its id; presets are noted as replaced by the default preset. Cancel writes nothing. A damaged
    config block, whose content no decoder reads, is not listed and asks nothing.
  - **On Load**, the main file is rebuilt with the same encoder the save uses, writing nothing to the block cache. The rebuilt
    bytes are strictly decoded and compared with the salvaged data (the ordered character ids, each kind's presence and
    size, the root keys). A mismatch refuses the load with a new message and writes no main file and no backup (on Tauri and
    a Node server the encode may already have written content-addressed remote files, which are harmless). The next start
    therefore decodes the main file strictly; it does not take the partial-install path (CHORE-70).
  - **Every load, full or partial,** first writes the current main file, when one exists, as a new numbered internal backup, read
    straight from the store so the Node server's main-file version does not move. A failed copy refuses the load with a new
    message. A snapshot that decodes strictly is still written as its exact bytes. The last busy check still has no await
    before the main-file write.
  - **The encoder** gains an `init` option, `writeBlockCache` (default true); the save loop does not pass it and is unchanged.
    The strict and default decode paths are unchanged. The file format is unchanged, so the `.bin` round trip with upstream is
    unaffected (`MC-175`).
- **Tests and checks (from the commit message):** two new files (`risuSaveSalvage.test.ts`; `risuSaveBlockFile.ts`, block-container
  helpers) and new and changed tests in `internalBackupSnapshotLoad.svelte.test.ts`.
  - Three existing tests change their expectation from a refusal to the new behaviour; each fails on its assertion against
    the pre-change `internalBackup.ts` and `risuSave.ts`: the Node remote block that is not stored (confirms asked 0,
    expected 1); the Tauri remote block file that is absent (the same); the damaged config block, whose content is never read
    (writes to the main file 0, expected 1).
  - The other loader reproducers (a damaged character on web, Node and Tauri; missing remote files; a damaged kind; the
    pre-load copy) also fail on an assertion against the pre-change code. The salvage-decoder tests and the rebuilt-bytes
    tamper tests use functions the pre-change code does not have, so they are new-behaviour tests, not reproducers.
  - Two Tauri tests now filter their write and rename logs to the main file, because the copy is also written.
  - Checks on the final tree: `pnpm test` 325 files, 6975 passed, 4 skipped; `pnpm check` 0 errors and 0 warnings; `pnpm build`
    passes. **Not run:** native Tauri, a real `server.cjs`, a real browser. No live check.
  - Gate 2 mutation run (the reviewer's scratch harness): 17 of 19 mutants killed in round 1; the two survivors (the busy
    check after Yes removed; the byte-loop record in salvage removed) were killed in round 2 by added tests; the rebuild-before-
    confirm mutant was killed only by accident in round 1. The mutation harness is not in the repo.
- **Residuals (from the commit message):**
  - each load adds a numbered backup, so the first save after a load prunes two when 20 exist, and about 100 minutes of saving
    rotates the pre-load copy out;
  - edits not yet saved when the load starts are not in the copy;
  - a cold-storage unit or asset missing for a loaded character is not detected (the Orchestrator's call O1, `MC-183`);
  - a left-out character's remote file stays in storage unreferenced (a v1 `.local.bin` file is deleted by the startup
    clean-up after 7 days);
  - a partly damaged snapshot with two characters sharing an id is refused by the rebuild check (one that decodes strictly still
    loads as its exact bytes);
  - a load refused by the busy check after the copy was written leaves that copy, one more numbered backup, which can push an
    older snapshot out at the next prune;
  - near the storage quota the copy can fail, and then nothing is loaded.
- **Gate 1 note (round 3, paraphrased; `gate1\review-r3.md` in the session scratch):** the rebuild check compares an identity summary (ids in order,
  each kind's presence and size, the root keys), not content; content fidelity comes from the rebuilt file being the
  serialisation of the same objects the save writes. Damage that still parses as the same character passes. The commit message
  states the check as it is.
- **Maintainer decisions:** `MC-183`; the code commit was made at the maintainer's chat word of 2026-10-03: "commit chore-59
  and start chore 58 with measurement".
- **Related:** `MC-152`, `MC-182`, `MC-183`; CHORE-70 (startup installs a partly decoded save without trying a backup; not
  changed by this ticket); the Wiki hand-off about the Load Internal Backup row (Live-State).

**Earlier status (2026-10-01):** open, not started; type: feature / recovery; **no design yet**. Filed from the
maintainer's answer to Live-State open follow-up 7 (`MC-152`: "5b: yes, there should be a option to load
other data that is intact."). Source of the question: memory stage 1 step 5b's Gate 1 round 2, non-blocking
finding N1 (ledger row 527). Present on the fork at HEAD `57235222`; the loader was committed with step 5b
as `448962f4`.

- **Current behaviour (source read at HEAD `57235222`):**
  - `readValidatedSnapshot` in `src/ts/drive/internalBackup.ts` reads the chosen snapshot and calls
    `decodeRisuSave(bytes, { strict: true })` (`:34`) before anything is written. Its doc comment says the
    strict decode exists so that a snapshot the default decode would load only in part (a missing remote
    block, a damaged block) is refused whole instead of being written and then losing that part for good
    (`:16-22`).
  - `loadInternalBackup` calls it at `:147`, before the write (`:154-159`). Any throw before the write
    attempt reaches the `catch`, which shows `language.internalBackupUnreadable` (`:187-188`). `en.ts:1674`
    reads "This backup is damaged or incomplete, so it was not loaded. Your current data was not changed."
  - So a snapshot with one bad block cannot be loaded at all; the user has no way to load the intact data
    in it.
- **Decision:** `MC-152`. The maintainer decided that Load Internal Backup should offer to load the data
  that is intact.
- **Not decided (for the item's own plan and gate):** what counts as "affected" (a character whose block
  or remote file is missing or undecodable is the case the gate raised), how the offer is worded, whether
  the partial load is confirmed by the user, and how the omitted data is reported.
- **Placement (`MC-152`, the Orchestrator's choice, not the maintainer's):** with CHORE-51, CHORE-52 and
  CHORE-55, each its own change with its own gates, before steps 6 and 7. It is backup and main-file
  integrity work like CHORE-55.
- **Related:** `MC-011`, `MC-089`, `MC-149`, `MC-151`; Report 49 section 3.3 D3 (the internal backup load
  writes the snapshot and reloads); CHORE-55.

### CHORE-75 — Load Internal Backup on a profile with no main file says the previous data was kept, when no copy was written (TRACED; wording only, not data loss)

**Status (2026-10-03): open, unplaced.** The maintainer asked for this ticket on 2026-10-03 ("yes, ticket the no-main-file
notice quirk"). It is not placed in the work order; the maintainer places it (`MC-089`: nothing ships until every open
ticket clears). Small. Not a data-loss item: when there is no main file there is nothing to keep, so nothing is lost.
The message is false. Found in CHORE-59's Gate 2 round 1 review (`opus-reviewer`) as optional item N4 and left out of
`4801a2f9` (`MC-183`, CHORE-59 above).

- **What happens (TRACED by the Orchestrator at HEAD `5519745f`, from `src/ts/drive/internalBackup.ts` and `src/lang/en.ts`):**
  - `keepCurrentMainFile` (`internalBackup.ts:169-182`) reads the main file through the store and, when there is none
    (`if (!bytes) { return }`, lines 172-174), returns without writing anything.
  - `loadInternalBackup` calls it (line 314), writes the snapshot as the main file (lines 321-324), and then always shows
    `language.internalBackupLoaded` (line 326).
  - The English text of that key (`src/lang/en.ts:1710`) is "The backup was loaded. Your previous data was kept as the
    newest internal backup. Refreshing your app." On a profile with no main file, the second sentence claims a copy that was
    not written.
  - The same key is in all seven `src/lang` files (en, ko, cn, zh-Hant, vi, de, es).
- **Likely shape (non-normative):** have `keepCurrentMainFile` report whether it wrote a copy, and show a second message
  without the "previous data was kept" sentence when it did not.
  - One new English key, with its call site, to `sonnet-coder`; its six translations to `translator`.
  - A test in `src/ts/drive/tests/internalBackupSnapshotLoad.svelte.test.ts` that fails today: a load with no main file
    shows the "kept" notice. Write it against the unfixed code and confirm it fails first.
- **Open for the maintainer:** where to place it in the order. Gate it as small and low-risk unless it grows (the load path
  is persistence-adjacent; the change is a message choice after the copy step, not a change to what is written).

### CHORE-76 — A PNG card cut short inside a tEXt chunk imports with a partial or missing asset, and the import does not say so (done: Stage A `6173f58a` and Stage B `ff659397`; TRACED; upstream and fork)

**Status (2026-10-03): done. The PNG half (Stage A) is `6173f58a` and the `.charx` half (Stage B) is `ff659397` (both local, not
pushed).** Placed now, ahead of memory steps 6 and 7 (`MC-185`). Found by the CHORE-58 plan
review (Gate 1 round 1, `opus-reviewer`, probe `gate1\probe.out.jsonl` line 7, run against the real reader at `5bbc591a`) and
named as a residual of `282b2da5`. Data-integrity, small. The fork and upstream share `pngChunk.ts` text
(`git diff upstream/main HEAD -- src/ts/pngChunk.ts` printed nothing at `5bbc591a`; not re-run since CHORE-58 changed the
stream branch).

**Stage A is done (2026-10-03; `6173f58a`, local, not pushed; `MC-186`; ledger rows 759 to 770; the PNG half of CHORE-76 and
CHORE-77).** The decisions are `MC-186` 3 ("Refuse if data missing") and 4 ("Check the end", for Stage B); the "Not decided"
bullet below is superseded for PNG by `MC-186` 3 and is kept as the record of the question. From the commit message:
- `importCharacterProcess` walks the PNG's chunk headers once before any asset is saved (`PngChunk.scanCard`, a pre-pass that
  reads only each chunk header and the first bytes of each tEXt key; a `File` is read through 256 KB windows). The pass gives the
  asset count for the progress percentage and decides whether the file is whole.
- The per-kind rule: a tEXt chunk is whole when its body is complete (its CRC may be cut); any other chunk before `IEND` also needs
  its CRC; a file that ends inside `IEND`'s header, or right before `IEND`, is whole; a file with neither a `chara` nor a `ccv3` key
  is refused before any save, with the new message when it was cut or never reached `IEND`, and with `noData` when it is a complete
  PNG that is not a card.
- A cut card is refused with "This card file is incomplete or damaged, so it was not imported." (`cardFileIncomplete`, in all seven
  languages). `readGenerator` no longer yields a partial tEXt value on any input: a body that runs past the end yields an empty key
  and value, as the stream branch already did. The count equals the one the previous counting pass produced, so the percentages are
  the same (`MC-184`).
- Tests: `src/ts/pngChunk.scanCard.test.ts` and `src/ts/characterCards.pngImport.test.ts` (new) and a cut-tEXt block in
  `src/ts/pngChunk.readGenerator.test.ts`; 112 tests in the three files, with the reproducers shown failing against the pre-change
  `pngChunk.ts` and `characterCards.ts`. Checks on the final tree, from the commit message: `pnpm test` 328 files, 7087 passed, 4
  skipped; `pnpm check` 0 errors and 0 warnings; `pnpm build` passes. Gate 1 took three `[REJECT]` rounds on the combined plan and
  then the split (below); Gate 2 was `[EDITORIAL]` twice and then `[APPROVE]` (ledger rows 761 to 763, 769, 770).
- **Residuals:** a card cut exactly at a chunk boundary reads as whole. So does a cut that leaves 1 to 7 bytes at a chunk boundary
  when they are a prefix of `00 00 00 00 49 45 4E 44` (`IEND_HEADER` in `PngChunk.scanCard`, `src/ts/pngChunk.ts`): 1 to 4 bytes,
  all zero, of a header; or 5 to 7 bytes that are `00 00 00 00` followed by `49`, `49 45` or `49 45 4E` (an empty chunk whose type
  begins with "I", "IE" or "IEN"). The commit message's "1 to 3 bytes" understates this bound (checked against `scanCard` in the
  working tree at `6173f58a`). If the cut drops a later asset, the import fails with "asset N not found" after saving the
  earlier assets (left to the startup asset sweep). If the cut drops a later image chunk of a card that stores its character data
  before the image data (not RisuAI's own export order), the character is imported with a truncated image, with no error. A non-PNG
  file named `.png`, or one under 8 bytes, now gets the incomplete message instead of `noData`.
- **The split (`MC-091` scope amendment, recorded at the `senior-advisor` escalation after three Gate 1 `[REJECT]` rounds):** Stage
  A is the PNG half. **Stage B (the `.charx` half) was next and needed its own plan and Gate 1 (done: `ff659397`, see the Stage B block below):** the Realm `.charx` read as a `File`
  from `res.blob()`; the end-of-central-directory check (`MC-186` 4); `CharXImporter` parse failures tagged by origin, input or zip,
  with no inspection of an error's code, message or name; the progress alerts stopped before the final message; and the `.charx`
  branch of `importCharacterProcess` owning the message. Step 0, the charx save backlog, is a Stage B measurement; any backpressure
  fix is a separate Stage C. **CHORE-76's open part was the `.charx` side** (`MC-186` 4; done by `ff659397`).

**Stage B is done by `ff659397` (2026-10-03; local, not pushed; `MC-186` 2 and 4; ledger rows 775 to 780; the `.charx` half of
CHORE-76 and CHORE-77).** From the commit message:
- **End check.** Before parsing, a `.charx` or a jpg/jpeg card must end with a zip end-of-central-directory record: some
  `50 4B 05 06` in the last 65,557 bytes whose record and comment fit inside the file. Without one, a `.charx` is refused with
  `cardFileIncomplete` ("This card file is incomplete or damaged, so it was not imported."), and a `.jpg` or `.jpeg` with `noData`
  (a plain photo has no zip, and a jpg-charx cut short cannot be told from one by its tail). Nothing is saved in either case. A cut
  between two entries, inside a local header, inside a data descriptor or inside the central directory raises no error in the zip
  reader, so this check is what catches it.
- **Three failure origins.** `CharXImporter.parse()` rejects on every failure with a `CharXParseError` naming where it came from:
  input (reading the File, Blob or stream failed), importer (the importer's own code failed while handling an entry, for example
  a buffer could not be allocated) or zip (the zip reader threw from `push()` or reported an entry error to the handler, including
  a throw from its own `start()` call). The importer's handlers catch their own throws, so these never return through the zip
  reader's error argument. The first recorded failure wins. After it, no entry is started, no data is handled, no save is queued
  or started, and progress updates stop, so a save still in flight cannot replace the final message. The `.charx` branch of
  `importCharacterProcess` shows `cardFileIncomplete` for a zip failure and the usual error with its message for an input or
  importer failure, then returns; nothing inspects the underlying error's code, message, name or class to choose. A failed asset
  save still surfaces through `done()`, as before.
- **Realm `.charx`.** A Realm `.charx` download is passed on as `new File([await res.blob()])`, without `arrayBuffer()`. A
  `ReadableStream` `.charx` input, which no caller passes, is buffered into a `File` first. When `importCharacterProcess` returns
  without a character, `importModule` shows `noData` only for a boolean (the low-level-access decline, which shows nothing
  itself), so a refusal message is not followed by a second alert; a throw still reaches `importModule`'s catch as before
  (CHORE-79).
- **Caller outcomes change.** A parse failure is now shown inside `importCharacterProcess`, which then returns, so callers that
  used to receive a throw now see the message: the picker continues with the next file (CHORE-78); a dropped file and a
  `#share_character` link show the message where they had no handler; `#import=` shows it instead of `noData`; the PWA launch
  queue no longer rejects unhandled; the Tauri open-file loop continues. A refused Realm card with `goCharacterOnImport` set
  now opens the last existing character, as the `noData` path and the PNG refusals already do. An input failure is shown by
  `importCharacterProcess` and returns, where before it was thrown to the caller with the same message.
- **Residuals:**
  - A cut that leaves every entry intact (in the last data descriptor, the central directory or the end record) imported the
    complete card before. It is now refused, as `MC-186` 4 chose ("Check the end").
  - A valid archive followed by more than about 64 KB of trailing bytes is refused too; no known writer produces one.
  - A jpg-charx cut short reads as a plain image and gets `noData`, not the incomplete message.
- **Tests and checks.** `src/ts/characterCards.charxImport.test.ts` and `src/ts/process/modules.importCharx.test.ts` (new, 86
  tests), on archives from the real `CharXWriter` (level 0 and 6), from `zipSync` (including a stored entry), a jpg-charx and a
  zip with an archive comment. Against the pre-change `processzip.ts`, `characterCards.ts` and `modules.ts`, the reproducers fail
  on their behavioural assertions: archives cut at 9 positions by 3 makers end in "invalid zip data" or "asset not found" after
  1-2 saves, or import the complete card with no error (cuts in the last data descriptor, the central directory or the end
  record); a damaged entry with an intact end record ends in a `TypeError` from `append(null)`; the Realm `.charx` calls
  `arrayBuffer()`; `importModule` shows a second `noData`. Compatibility guards pass before and after. The red table covered 83
  tests (80 + 3), 69 failing at HEAD and 14 passing (guards, all among the 83); the final suites have 86 (83 + 3), so 3 tests were
  added after the red table. The final mutant tables (`stageB\red\mutant-table.txt` and `mutant-table-subset.txt`) give 22
  mutants, 19 killed and 3 survived: M09 (the data-skip flag), M13 (the `#handleFileComplete` check) and M21 (labelled "both
  save guards removed" but, per the Gate 2 reviewer, removing only the complete-check, like M13). The surviving guards are
  layered, and the Gate 2 reviewer found the `#handleFileComplete` check to be an equivalent mutant (ledger rows 777 and 778). Checks on the final tree, from the commit message: `pnpm test` 330
  files, 7173 passed, 4 skipped; `pnpm check` 0 errors and 0 warnings; `pnpm build` passes. Gate 1 took two rounds (`[REJECT]`,
  `[EDITORIAL]`) and Gate 2 two (`[EDITORIAL]`, `[APPROVE]`); ledger rows 775 to 780.

- **What happens, as found before `6173f58a` (TRACED; line numbers at `5bbc591a`; the stream-branch result is also pinned by
  CHORE-58's tests, the `Uint8Array` result by the Gate 1 probe at `5bbc591a`):**
  - `PngChunk.readGenerator` (`src/ts/pngChunk.ts:184`) reads a tEXt body with `slice(pos+8, pos+8+len)` (`:236`) and takes the
    key from the first NUL within the first 70 bytes (`:239-245`), then yields `{key, value}` (`:246`).
  - **`Uint8Array` branch** (`slice` is `data.slice(start,end)`, `:203-206`): `Uint8Array.prototype.slice` does not fail when
    `end` is past the end of the data, so a body that runs past the end comes back shorter. If the key's NUL is inside the part
    that is present, the yield is a partial value (probe: 21 of 240 characters). A partial asset can be saved. This branch is used
    by every caller that passes bytes to `importCharacterProcess`: the Charahub import (`src/ts/characterCards.ts:374-377`);
    and, through `importFile` (`:509`, which calls `importCharacterProcess` at `:511`), the `#import=` URL path (`:394`), the
    PWA `launchQueue` path (`:471`) and the Tauri open-file caller (`:489`).
  - **Stream branch** (a picked or dropped `File` and the Realm download): `StreamWindow.slice` returns an empty array when the
    stream ends before `end` (`pngChunk.ts:102-107`), so the same cut yields an empty key and an empty value, and that asset is
    dropped. CHORE-58 kept this on purpose (`282b2da5`).
  - **Neither branch reports the truncation to the user.** The caller rejects a card only when neither `chara` nor `ccv3` was
    found (`characterCards.ts:212`), or when there is no trimmed image (`:221`). A card cut inside an asset therefore imports without that asset, or with a partial one, and no message says so.
    A cut after the last tEXt chunk's body but inside its CRC still yields that asset in full on the stream branch (tEXt CRCs are
    never read), and the trimmed image then has no IEND (Gate 1 round 2).
- **Not decided at the time (decided since: `MC-186` 3, refuse; `MC-186` 4 for `.charx`):** what a truncated card should do. Options to put:
  refuse the import with a message, or import what is intact and say what is missing. Whether the two branches should agree is
  part of the same question. `TODO(evidence)`: how many real cards in the wild are truncated; none is known.
- **Next step (done for the PNG half; superseded):** the investigation is done (ledger rows 759 and 760), the maintainer decided
  (`MC-186`), and the plan was split (`MC-091`; Stage A done as `6173f58a`; Stage B, open then, is done as `ff659397`). The original text was: investigation of
  the caller and of every `readGenerator` input source for the cut cases (a cut inside a length
  field, a type, a body, a CRC, missing IEND), then a plan, then the maintainer's decision above, then the usual gates. The change
  is in `pngChunk.ts` and the import caller; the guards of `pngChunk.readGenerator.test.ts` (nine truncation cases written down
  from the pre-CHORE-58 reader) would change with the decision and must be updated deliberately, not to make a test pass.
- **Placement:** `MC-185`, now, ahead of steps 6 and 7. Step 6 still waits for the `feat/ui-batch` merge (`MC-179` 4).
- **Related:** CHORE-58 (`282b2da5`), CHORE-77, `MC-175` (an upstream-exported card must still import), `MC-185`.

### CHORE-77 — A card downloaded from Realm is held in memory in full during import (done for the Realm PNG, `6173f58a`, measured in headless Chrome only, and the Realm `.charx`, `ff659397`; the `.charx` size limits and save backlog (Stage C1) done in `96ffb490`, the share target and the `#import=` and Chub downloads (Stage C2) done in `f8f16c0d`; upstream and fork)

**Status (2026-10-03): done for the Realm PNG download (Stage A, `6173f58a`) and the Realm `.charx` download (Stage B,
`ff659397`); both local, not pushed.** The follow-ups listed in the Stage B block below are not part of this ticket's
acceptance. Placed now, ahead of memory steps 6 and 7 (`MC-185`). Named as a residual of
`282b2da5`: CHORE-58 made the reading linear and left this unchanged.

**Stage A is done (2026-10-03; `6173f58a`; `MC-186` 1 and 2; ledger rows 768 and 770).** The maintainer chose "Browser blob, all"
(`MC-186` 1). The Orchestrator reads "all" as web and Tauri alike: the download is held as a browser `Blob` and read twice, the
first read counting the assets by skipping their bodies, so the exact percentage stays (`MC-184`); no Tauri temporary file. This supersedes the temporary-file
direction below (`MC-185` 3), which is kept as the record. From the commit message: a Realm PNG download is passed on as
`new File([await res.blob()])` and read twice as a `File`, without `tee()`; a failed download still lands in `downloadRisuHub`'s
error; a `ReadableStream` PNG input, which no caller passes any more, is buffered into a `File` first. Measured in headless Chrome
on an i9-13900K (best case; the `MC-003` floor not measured), production builds of the tree before and after, each with one added
line exposing `downloadRisuHub` to the driver, importing a synthetic 300 MB Realm-shaped card through a redirected fetch (no
request reached Realm): renderer private bytes at the end of the counting pass were 453-519 MB before and 93-115 MB after (3 runs
each); the browser process rose by at most 12 MB in either build. Where the Blob's bytes are kept was not established. The counting
pass on a 3,000-asset card took a median of 96 ms before (6 runs) and 78 ms after (5 runs). The browser measurement closes the
"not measured in a browser" `TODO(evidence)` below for Chrome only; Firefox and Safari were not measured. **Open part when Stage A
was written (superseded by `ff659397`): the Realm `.charx`** (`MC-186` 2), which `downloadRisuHub` then still read with
`arrayBuffer()`; it was in Stage B (see CHORE-76 for the split).

**Stage B is done (2026-10-03; `ff659397`; `MC-186` 2; ledger rows 775 to 780; the full block is under CHORE-76).** A Realm
`.charx` download is passed on as `new File([await res.blob()])`, without `arrayBuffer()`; a `ReadableStream` `.charx` input,
which no caller passes, is buffered into a `File` first. No browser memory measurement of the `.charx` download was made
(`TODO(evidence)`); the Stage A figures above are for the PNG only.

**Follow-ups, status 2026-10-04 (investigated 2026-10-03):** investigated (ledger row 783), decided by the maintainer (`MC-187`), and taken up as Stage C1
(the `.charx` save backlog and the size limits) and Stage C2 (the `#share_character` repair, and the `#import=` and Chub
downloads read as a Blob). Stage C1 is done in `96ffb490` (2026-10-04; ledger rows 787 to 791): `card.json` and `module.risum` are limited to 50 MiB and every other entry to 200 MiB; an entry over its limit refuses the card, before anything is saved when the central directory is readable, and from a streaming backstop otherwise; the reader waits while more than 32 MiB of decoded assets are queued or saving. **Mechanism note for the maintainer:** the `MC-187` amendment asked for "200 MB, exact sizing". It was implemented as an exact-length join of the copied chunks, not as preallocation from the central directory's declared size, so saved bytes never depend on a declared size. Measured (Node, i9-13900KF, best case, the `MC-003` floor not measured; one 200 MiB entry in 64 KiB chunks): the buffer holds about 400 MiB right after the join, against 456 MiB after `.buffer` for the buffer it replaces. The measured live peak is 2x (400 MiB for one 200 MiB entry). Under the plan's 3.3x accounting, which counts buffers that are no longer reachable, the shipped design is about 3x (chunks, joined array, store copy), against about 2x for preallocation (Gate 2 round 1, finding 5). The saved array is still copied by the digest and by the store. Stage C2 (the `#share_character` repair, and the `#import=` and Chub downloads read as a Blob) is done in `f8f16c0d`; its block follows the two items below. The step-0 figures and the two follow-up items as first found, before the investigation, stay below:
- (a) **The charx save backlog.** Step 0 (scratch, noisy; ledger row 777): with 4 MB assets and 10 concurrent saves, the peak of
  queued asset buffers stayed 12-20 MB at a 100 ms save delay and grew with the asset count at a 2,000 ms delay: 32, 64, 88 and
  112 MB for 8, 16, 32 and 64 assets. `CharXWriter` archives use data descriptors, so each entry is buffered in full before the
  50 MB per-entry cap is checked. Both are unchanged by `ff659397`.
- (b) **`#share_character`** still reads its `.charx` with `arrayBuffer()`.

**Stage C2 is done (2026-10-04; `f8f16c0d`; `MC-187` Q2 and Q3, `MC-188`, `MC-189`; ledger rows 793 to 799 and 1001; the plan went through Gate 1 in three rounds, `[REJECT]`, `[REJECT]`, `[APPROVE]`; Gate 2 round 1 was `[APPROVE]` and round 2 `[EDITORIAL]`, a stale test count in the commit message, corrected).** What it delivered:
- **Share-target repair.** The service worker now answers the POST to `/receive-files/` itself with a 303 back to the app. Each share is stored under its own id, in a separate `risuShare` cache (not the asset cache). The page claims the share (only one page wins the claim), clears the hash, imports the files in the order sent, then deletes them. Shares more than 24 hours old, imported or not, are removed when a later share arrives. A share that failed, was empty, is not found, or has an unreadable index shows one message and imports nothing.
- **Kinds by suffix.** The kind of a file comes from its name's suffix, compared without regard to case (cards: `.charx` `.png` `.jpg` `.jpeg` `.json`; presets: `.risup` `.risupreset` `.preset`; modules: `.risum`), or, for a name with none of those suffixes, from an `image/png`, `image/jpeg` or `application/json` type (it is then read as that kind). A file still unclassified is not imported and is named in a message. The manifest's character field also accepts `application/octet-stream`, `application/zip` and `application/x-zip-compressed` (`MC-189`). A module's name must now end in ".risum"; a name ending in "risum" alone was accepted before.
- **`#import=` and Chub.** Both read the response as a Blob and pass cards on as a `File`; a response that is not 2xx is refused without reading its body (neither Chub nor `#import=` checked the status before). `#import=` now also accepts `.json` cards and `.preset` presets.
- **Tests and checks:** `pnpm test` 332 files, 7248 passed, 4 skipped; `pnpm check` 0 and 0; `pnpm build` passes. Against the pre-change code, 15 of 21 service worker tests and 19 of 22 page tests fail (the Gate 2 reviewer reproduced 34 failed, 9 passed).
- **Residuals:**
  - There is no `skipWaiting` or `clients.claim`. An older service worker still in control sends the share POST to the server, which answers "Cannot POST /receive-files/" (Express's default 404; the status code was not recorded). This was observed in the live check.
  - The Android share sheet was not exercised. Whether Android lists RisuAI for these files is not established: it rests on Chromium source read by the Gate 1 reviewer, not on a device.
  - The files of a share that was claimed and whose page then crashed stay until a share arrives more than 24 hours later.
  - The "share" noun in the vi, de and es translations needs a native review.
- **Open stages:** none remain in CHORE-77 after C2 (Stages A, B, C1 and C2 are all done). The step-0 figures and the item (a) and (b) texts above are the state as first found and were not rewritten.

- **What happens, as found before `6173f58a` (line numbers at `5bbc591a`; the Realm PNG part no longer applies, the Realm
  `.charx` part still does):**
  - **TRACED:** the Realm PNG download is passed to `importCharacterProcess` as the response body stream
    (`src/ts/characterCards.ts:1797-1800`, `data: res.body`; a Realm `.charx` or zip is read into a `Uint8Array` instead,
    `:1791-1794`). `importCharacterProcess` splits a stream with `tee()` (`:142-146`): one branch is kept for the main pass, the
    other goes to the counting prereader (`:151-162`), which reads it to the end before the main pass reads the first branch
    (`:166` onward).
  - **MEASURED in Node streams, not in a browser (CHORE-76/77 investigation, ledger row 759; scratch `chore76-77\b.probe.ts`):**
    with the real `readGenerator` on a synthetic 200 MB card (100 x 2 MB assets, 64 KB chunks), `process.memoryUsage().arrayBuffers`
    rose by about 208 MB when the counting pass finished with the main `tee()` branch still unread (re-run by the Orchestrator,
    output in `chore76-77\b.probe.out.txt`; a 4 x 50 MB card gave +306 MB). The same card read once without `tee()` showed no
    measurable rise (the probe's peak sampler stayed below its baseline), so it gives no comparable figure. The spec reading (a tee branch nobody reads queues what the other branch pulls) is
    consistent with this. `TODO(evidence)`: a measurement in Chromium (and Firefox and Safari); none was made.
  - **TRACED:** the Realm download is a plain global `fetch` in `downloadRisuHub` (`characterCards.ts:1766` is the function,
    `:1779` the call), on every platform; it is not plugin-http and not the Node server's proxy.
  - **TRACED:** a card exported by RisuAI writes its asset chunks before `chara`/`ccv3` (the asset writes are at
    `characterCards.ts:1254`, `:1271`, `:1288` and `:1331`; the `ccv3` write is at `:1477`, then `writer.end()` at `:1480`), so the
    asset count cannot be read from the start of the file.
  - The `File` inputs (picker, drop) do not tee: the `File` is read twice, as two independent `stream()` calls.
- **Direction proposed by the maintainer (`MC-185` 3), superseded by `MC-186` 1 (a browser Blob, no temporary file):** download the PNG to a temporary file rather
  than holding it in memory. To be investigated per platform before a plan: web (browser), Tauri, and the Node server. What each
  platform allows, and where a temporary file would live and be cleaned up, is not established. `TODO(evidence)`: the
  per-platform investigation.
- **Constraint from `MC-184`:** the exact asset-count percentage stays, so the counting pass stays unless a different way of
  getting the same count is found.
- **Next step (done for the PNG half; superseded):** the investigation is done (ledger rows 759 and 760) and the maintainer
  decided (`MC-186` 1 and 2). The Realm `.charx` was the open part: Stage B needed its own plan and Gate 1 (CHORE-76 has the split; done by `ff659397`, superseded).
  The original text was: investigation per platform, then a plan, then the usual gates.
- **Placement:** `MC-185`, now, ahead of steps 6 and 7. Step 6 still waits for the `feat/ui-batch` merge (`MC-179` 4).
- **Related:** CHORE-58 (`282b2da5`), CHORE-76, `MC-184`, `MC-185`, `MC-186`.

### CHORE-78 — Importing several cards at once can hide an earlier card's failure (TRACED at `ece53227`; UX, no data loss) (done in `bab2af36`, 2026-10-04, stage 2 of 2 of CHORE-78/79)

**Status (2026-10-04): done in `bab2af36`, local, not pushed.** Stage 2 of 2; stage 1 is CHORE-79 (`ae8636a2`). Decision: `MC-192`
D1. Ledger rows 1002 to 1016 (the investigation 1002, the plan gate 1003 and 1004, stage 2 rows 1010 to 1013, the commit message
rows 1014 and 1015; row 1016 is the stage 1 commit message draft). Plan gate: `[REJECT]`, then `[EDITORIAL]`. Stage 2 code gate (`adversarial-reviewer`): `[EDITORIAL]`, then
`[APPROVE]` after the corrections. From the commit message:
- **Outcome.** Every file of a multi-file import is attempted, whatever happened to the files before it (the file picker, files
  shared to the installed web app, files opened from the OS through `launchQueue`, files opened by Tauri, and `#import=`). When
  any file was refused or failed, the action ends with exactly one message, "Files not imported (n of m):", then one
  "name: reason" line per file. Files that imported, and files the user declined, are not listed. A single file keeps its own
  message; a single file that is not a card, preset or module, or that could not be received, gets the summary, with the new
  reasons "This file type cannot be imported." and "The file could not be received.". The outcome of a file is decided by the
  code (imported, declined, refused or failed), never read from alert text.
- **Other behaviour changes in the same commit.** A refused `.risum` shows its reason as text on the `launchQueue`, Tauri
  opened-files, share and `#import=` paths (this closes the interim regression stage 1 disclosed). A declined card (json spec
  card, png rcc card, charx) is not imported, not counted, and shows nothing; a declined json card no longer falls through to
  the off-spec import, and a declined charx returns no index. A password-protected png card whose import throws shows its own
  reason, and a declined one shows nothing; "Wrong Password" remains for a password that does not decrypt. `downloadRisuHub`
  stops after a download that did not import and does not switch characters. `checkCharOrder` also runs after a card imported
  through `launchQueue` or Tauri opened files.
- **MC-091 scope amendment.** The Chub and `#import=` blocks of `characterURLImport` no longer return on a failed response or
  an error. They show "The file is invalid" and go on, so share handling, the `launchQueue` registration, Tauri opened files and
  `onOpenUrl` are always reached. `#import_module=` and `#import_preset=` show a malformed or failed link with `alertError` and go
  on. Reason: at the parent commit those returns ended start-up work before the `launchQueue` and `onOpenUrl` registrations.
- **Strings.** Four keys added to all seven language files (`importFilesNotImported`, `importUnsupportedFile`,
  `importNotCardFile`, `importFileNotReceived`); `shareFilesNotImported` removed from all seven (nothing in `src/ts` used it).
- **Tests and checks.** One new file (`characterCards.picker.test.ts`) and four changed. The Gate 2 reviewer ran five test files
  (224 tests) against the parent commit's `characterCards.ts` through a scratch config: 33 failed, with behavioural failure
  messages. Mutants run by the reviewer: 12, 11 killed; the survivor (a `ModuleRefusal` classified as a failure) is now caught by
  a test that asserts the message is a string. `pnpm test` 336 files, 7319 passed, 4 skipped; `pnpm check` 0 errors and 0
  warnings; `pnpm build` succeeded (all three runs by the Orchestrator on the Stage 2 snapshot; logs in the session scratchpad).
- **Accepted residual (not fixed).** Two import actions running at once (for example a `launchQueue` event during a share) share
  the single alert slot, so one summary can replace the other. The plan accepted it as rare.
- **Not covered by a test.** The rcc decrypt and parse edge cases (a non-password `decryptBuffer` failure and a `JSON.parse`
  failure) are read-verified only.
- **Out of scope, from the plan.** Assets saved before a failure stay unreferenced, as before; the startup asset sweep is their
  cleanup (whether the sweep removes those exact assets was not established). Multi-file drag and drop: the drop handler takes
  only the first file (`files[0]`), so it is not a multi-file entry. `db.statics.imports` does not count refusals (it is
  incremented before any validation).
- **Open follow-up: a native-speaker review of the vi, de and es wording of the four new strings** (and of the reworded summary).
  This is added to the existing native-review item (Live-State, item 1, "A native-speaker check on the new translations."; CHORE-77's Stage C2
  residuals carry the same kind of note), not a new ticket. The translator flagged: es "No se importaron"-style phrasing (the
  first wording, since reworded to "Archivos no importados (n de m)"), de "Charakterkarten-Datei" against the "Kartendatei" used
  in `cardFileIncomplete`, and vi "chưa được nhập", which reads as "not yet imported". These are flags, not known defects. ko, cn
  and zh-Hant were not flagged.
- **Merge note.** `feat/ui-batch`, read at `a5699f55` at plan time, did not touch the picker loop, `consumeShare`, `alert.ts`
  or `processzip.ts`, but had one-line string hunks elsewhere in `characterCards.ts` and in `readModule`. Its tip has since
  moved to `a5dfc611`, where `modules.ts` has 5 changed lines, `characterCards.ts` 9 and `AlertComp.svelte` 60 against
  `89993b28`. Textual conflicts are possible at the merge; the lang files are listed in Live-State as expected conflicts.

**Status as filed (2026-10-03): open, unplaced.** The maintainer approved filing it on 2026-10-03 ("yes, file CHORE-78 and
CHORE-79"). It is not placed in the work order; the maintainer places it (`MC-089`: nothing ships until every open ticket
clears). Found by the Stage B Gate 1 reviewer of CHORE-76/77, not yet investigated. UX only: nothing is lost or written
wrongly; the user can miss that one file was not imported.

- **What happens (TRACED by the Orchestrator's brief at HEAD `ece53227`, from `git show HEAD:src/ts/characterCards.ts`; the
  working tree of that file is being edited by another agent, so these are HEAD lines):**
  - `importCharacter` (`characterCards.ts:32-50`) takes the picked files (`selectFileByDom(["*"], 'multiple')`, line 34) and
    loops (`for(const f of files)`, line 39), awaiting `importCharacterProcess` for each (lines 40-43). Its only `catch` is
    around the whole loop (lines 46-49): `alertError(error)` and return.
  - A refusal in `importCharacterProcess` that shows its alert and then plain `return`s does not throw, so the loop goes on to
    the next file. Examples at `ece53227`: `alertError(language.errors.noData)` then `return` (lines 73-74, 92-93, 150-151,
    202-203 and others), and `alertError(language.cardFileIncomplete)` then `return` (lines 146-147, the PNG cut-short refusal
    from `6173f58a`).
  - The next file then sets its own wait alert (`'Loading... (Reading)'`, lines 82-85 for charx and jpg, 126-129 for png) and
    its own success alert, which replace the earlier file's error. The user can miss that the earlier file was not imported.
  - A charx or jpg whose parse throws is different: `importer.parse(f.data)` (line 89) is not inside a `try` in
    `importCharacterProcess`, so a throw propagates to the `catch` in `importCharacter` (line 46), which shows the error and
    ends the whole loop. Behaviour therefore differs by failure type: a returned refusal continues, a throw stops.
  - There is a second throw source in the charx path: `await importer.done()` (line 111) is also outside any `try` there. A
    rejection from it ends the loop through the same `catch` at line 46, like a parse throw.
  - `CharXImporter.parse` (`src/ts/process/processzip.ts:227-245` at `ece53227`) has no `try`/`catch`. It rejects only from the
    stream read or from `#feedChunk` (the `unzip.push` call; whether fflate throws there was not opened, INFERRED). Asset save
    errors never reject `parse()`: `#processAssetQueue` (`processzip.ts:383-391`) collects them, and only `done()` rejects
    with them (see CHORE-79).
  - The charx Stage B refusal (CHORE-76 Stage B) is not in `ece53227`. Since `ff659397` (from its commit message, not
    re-traced here) the charx branch of `importCharacterProcess` shows its refusal with `alertError` and returns, so CHORE-78's
    caller outcomes include charx refusals, and charx input and importer failures no longer throw out of
    `importCharacterProcess`.
- **Alerts (TRACED at store level, `ece53227`):** `alertStore.set` (`src/ts/alert.ts:28-36`) calls the writable
  `alertStoreImported.set` (`stores.svelte.ts:62`), ignoring type `'none'` while a prompt is showing. `alertError`
  (`alert.ts:75`) and `alertNormal` (`alert.ts:118`) set the same store. Each set replaces the single current alert. Not
  established: whether every UI mode shows only the current alert.
- **Next step:** investigation, then a plan. One possible shape, not decided: collect each file's outcome and show a summary
  at the end. Nothing is decided.
- **Placement (as filed, 2026-10-03):** unplaced; the maintainer places it.
- **Related:** CHORE-76, CHORE-77, `6173f58a`, `MC-185`, `MC-186`.

### CHORE-79 — Importing a module from a .charx can report success after asset saving failed (TRACED at `ece53227`; a false success message, no module added) (done in `ae8636a2`, 2026-10-04, stage 1 of 2 of CHORE-78/79)

**Status (2026-10-04): done in `ae8636a2`, local, not pushed.** Stage 1 of 2; stage 2 is CHORE-78 (`bab2af36`). Decisions: `MC-192`
D2 and D3. Ledger rows 1002 to 1009 and 1016 (the investigation 1002, the plan gate 1003 and 1004, stage 1 rows 1005 to 1009, its commit message draft 1016). Stage 1
code gate (`opus-reviewer`, because the change touches the asset-save queue): `[EDITORIAL]`, then `[APPROVE]` for the
remediation; the commit message check was `[EDITORIAL]` with one required correction, applied. From the commit message:
- **Outcome.** A `.charx` module import shows success only when a module was added. A failure shows its real reason as the last
  message (D2), for example "Failed to save 3 assets"; a declined low-level-access prompt shows nothing. Before: the generic
  "The file is invalid" message and then "Successfuly imported", and a declined prompt showed the "invalid" message.
- **`readModule` (D3).** It throws a `ModuleRefusal` (new, `src/ts/process/moduleRefusal.ts`) for a wrong magic byte, an
  unsupported version, a wrong module type and a bad block mark, instead of alerting and returning `undefined`. It never returns
  without a module and never shows an error itself; any other error (a truncated file, corrupt JSON, a failed asset save) passes
  through as it is. Before: `importModule` and the drop handler pushed the `undefined` onto the module list (the drop handler then
  showed "Successfuly imported"), and the card import and `importClassified` (share, `#import=`, `launchQueue`, Tauri) threw a
  `TypeError` on it. Now a `.risum` that fails one of those checks is refused with one error in `importModule` and the drop
  handler, and a `.charx` card with an unusable embedded module is refused as a card (one error, no character).
- **Drop handler.** Its body moved to `importDroppedFile` (`src/ts/dropImport.ts`) with a try/catch, so a failed preset, module
  or card drop shows an error instead of an unhandled rejection.
- **Quiet exits of a `.charx` card import.** When the import stops after the archive was parsed, `CharXImporter.abandon()` now
  runs in a `finally`: asset saves that have not started do not start, no "Saving Assets" progress message replaces the error,
  the importer's completion promise no longer becomes an unhandled rejection, and saves already in flight are not waited for or
  cancelled. `abandon()` runs only after `done()` has settled on a successful import, so a successful import saves every asset as
  before (the Gate 2 reviewer's mutant that called it earlier was caught by a test).
- **Interim regression, disclosed in the commit message and closed by stage 2.** A malformed `.risum` opened from the OS through
  `launchQueue` or the Tauri opened-files path showed no message after stage 1 (its `ModuleRefusal` was an unhandled rejection;
  those two paths had no catch). Before stage 1 the same file showed the "invalid" message and then an uncaught `TypeError`.
  `bab2af36` adds the catch and tests a refused `.risum` on both paths.
- **Resolved from the filing.** The filing listed as UNVERIFIED whether `importCharacterCardSpec` with `returnCharacter` can
  leave a character behind. The investigation (row 1002) read it and found that no character or other database state is left
  (only the `db.statics.imports` counter moves). TRACED by the `investigator`; not run.
- **Tests and checks.** Three new test files and two changed. Against the parent commit's `modules.ts`, `processzip.ts` and
  `characterCards.ts`, the three files `modules.importRisum`, `charxQuietExit` and `modules.importCharx` give 13 failed and 11
  passed of 24, each for its own reason. The `dropImport.test.ts` red count (4 failed, 3 passed) is the implementer's, against
  the handler body extracted without its try/catch, and was not re-run by the reviewer. `pnpm test` 335 files, 7276 passed, 4
  skipped; `pnpm check` 0 errors and 0 warnings; `pnpm build` succeeded (the Orchestrator re-ran the build after the remediation, exit 0, and did not save the log; the reviewer could not verify the build claim).
- **Not done.** The drop handler was not live-checked in a browser (the Svelte handler is a one-line call to
  `importDroppedFile`).
- **Out of scope, from the plan.** Assets saved before a failure stay unreferenced, as before; the startup asset sweep is their
  cleanup (whether the sweep removes those exact assets was not established).

**Status as filed (2026-10-03): open, unplaced.** The maintainer approved filing it on 2026-10-03 ("yes, file CHORE-78 and
CHORE-79"). It is not placed in the work order; the maintainer places it (`MC-089`). Found by the Stage B Gate 1 reviewer of
CHORE-76/77, not yet investigated.

- **What happens (TRACED by the Orchestrator's brief at HEAD `ece53227`, from `git show HEAD:src/ts/process/modules.ts`):**
  - In `importModule` (`modules.ts:257`), the `.charx` branch (line 263) runs `importCharacterProcess(..., returnCharacter: true)`
    and pushes the converted module inside a `try` (lines 264-276). The `catch` (lines 277-280) logs the error and calls
    `alertError(language.errors.noData)`, with no `return`.
  - Control then reaches `alertNormal(language.successImport)` (line 281) and returns (line 282). So any error thrown in the
    `try` ends with the error alert followed by the success alert.
  - `importCharacterProcess` awaits `importer.done()` (`characterCards.ts:111`) in its charx branch before
    `importCharacterCardSpec` (`:112`). A rejection from `done()`, or any other throw, therefore reaches that `catch`.
  - **TRACED:** an asset that fails to save rejects `done()`. `#processAssetQueue` (`processzip.ts:383-391`) collects each
    save error, and `#checkCompletion` (`processzip.ts:280-292`) rejects with the single error, or with an `AggregateError`
    "Failed to save n assets" when there are several.
  - Contrast: the `!char || typeof char === 'number'` refusal (lines 271-274) does return, but `importCharacterProcess` has
    already shown a `noData` alert on most of its refusals, so on that path the user gets two `noData` alerts (minor). The
    `.risum` branch (lines 284-293) has no success alert after its `catch`.
- **Consequence on the `done()` rejection path (TRACED):** the rejection happens at `characterCards.ts:111`, before
  `importCharacterCardSpec` (`:112`), so no character is returned and the module is never pushed (the push at
  `modules.ts:276` is the last statement of the `try`). The user sees the `noData` error alert and then the success alert.
  No module is added. Assets already saved stay unreferenced, left to the startup asset sweep, which does not run when
  `db.coldstorage` is set, when any character is cold-stored, or when the keep-set is incomplete (`bootstrap.ts:850`,
  `:859`, `:956` at ece53227); whether the sweep removes these exact assets was not opened.
- **UNVERIFIED (not read):** whether `importCharacterCardSpec` with `returnCharacter` true can leave a character behind on
  other failure paths.
- **Next step:** investigation. Likely shape (non-normative): return from the `catch`, as the `.risum` branch effectively does.
  Nothing is decided.
- **Placement (as filed, 2026-10-03):** unplaced; the maintainer places it.
- **Related:** CHORE-76, CHORE-78, `MC-185`.

### CHORE-60 — Release identity: the desktop build still carries upstream's identity

**Status (2026-10-01):** open, **not scheduled**; a release blocker under `MC-089` and `MC-011` (nothing ships
until every open ticket clears). The maintainer decided the updater part (`MC-154` 7: the updater is disabled
until the first release, and a signing key and a release URL of the fork's own are set up before that
release). That part is done and committed as `38583d3b` (below); the CI and Docker rework is `712a76ad`. The
rest of the list has no maintainer decision. The work order is unchanged (step 5c is committed, as `9b312962`, and
5d-1 as `e8cf50de`; 5d-2 is next). Line numbers are those of the tree at `38583d3b` on 2026-10-01; the `tauri.conf.json` numbers
after line 37 are two lower than at `57235222`, because the `endpoints` edit removed two lines. Step 5c moved
`src/ts/bootstrap.ts` lines: the `checkRisuUpdate()` call there is at `:173` at `696ba5de` (Grep, 2026-10-01).

**Release blockers still open on this ticket** (nothing ships until they clear, `MC-089`):
- the maintainer's own Terms of Service and Privacy Policy published, and the legal flag set (`MC-155`, then
  `MC-157`). **Progress (2026-10-01):** the documents are committed (`b84ae444`; the Privacy Policy edited in
  `8918e309`); the fork's own links to them are in Settings (`696ba5de`; `MC-156`); and the flag is on by default
  in every build from the repository (`a6a27df5`; `MC-157`, which supersedes `MC-155`'s "leave it unset"). The
  documents are the maintainer's, who writes and commits them. **The links open GitHub pages, which show
  GitHub's not-found page until these commits are pushed** (`MC-156` 4; not re-checked against GitHub). The
  local remote-tracking ref `origin/fix/persistence-conflict-platform-hardening` was `0a3fb2b0`, an earlier
  commit, when checked on 2026-10-01, so the documents were not on GitHub;
- **CHORE-35 closes (`MC-157` 4).** Upstream's notice has a third condition besides the fork's own documents: an
  agreement prompt wherever the app uses upstream's services. With the flag on by default, a default build no
  longer shows the legal-documents notice, so the prompts CHORE-35 lists are a known remaining gap against the
  third requirement of upstream's notice. Per the
  Orchestrator's statement in the `MC-157` question, Realm has a prompt and these do not: the upstream proxy
  (`/proxy2`), MCP sign-in via `account.sionyw.com`, the transformers CDN and `#import=` URLs. CHORE-35 holds the
  traced list and its own "not checked" notes. The maintainer chose to set the flag now and make this a release
  condition, and chose to leave CHORE-35 where it is in the work order, item 4 (`MC-157` 5);
- the rest of the identity list below, which has no decision yet (*superseded in part on 2026-10-02: the name,
  identifier, version and schemes are decided and merged; see "Identity merged" below*).

**Identity merged (2026-10-02, `cfa4dfa0`; `MC-162`):** the branch `chore/risutanium-identity` was merged after the
CHORE-53 commits (`MC-161` 8). Its commits are `98d13e7f` (the rename and the version), `63860dfe` (keep registering
`risuailocal`) and `c9326b67` (the version in error reports). The decisions were relayed by the Rebranding session
(`MC-162`). The "App identity" list below is the state **before** the merge; what changed, read in the working tree at
`cfa4dfa0` for the first four lines:
- the product name is Risutanium (`productName` and `mainBinaryName`; the window title is `RisuTanium`);
- the `identifier` is `io.github.yor42.risutanium`, a fresh app-data folder on purpose (a save structure rework is
  planned);
- the version is `0.1.0`, with the upstream base as `appSubVer` `up2026.8.250`; `version.json` and the home screen's
  Version line (`MainMenu.svelte`, through `getVersionString`; there is no About screen) show `0.1.0-up2026.8.250`;
- the deep-link schemes are `risutaniumlocal` and `risuailocal`, the second kept so that upstream Realm's open-in-app
  links reach the app;
- FUNDING is not wanted and the file is absent from HEAD; the `stable.risuai.xyz` "(Stable)" label is removed, as
  no `risuai.xyz`-hosted special cases are wanted.
- **Consequences the maintainer accepted:** CBS `{{version}}` returns `0.1.0` and `{{majorversion}}` returns `0`, so
  upstream cards that compare against a 2026 version behave differently; the `x-risuai-info` header sends
  `0.1.0;<platform>` on the Realm search request, to the hub URL (`/hub-proxy` on a Node server,
  `nightly.sv.risuai.xyz` on a nightly build, otherwise `sv.risuai.xyz`).
- **Not changed:** the updater `pubkey` (upstream's; `endpoints` are empty), the tracked `src-tauri/key.txt` (contents
  not opened or quoted) and the functional `risuai.xyz` URLs.
- **`isWeb` (a note; not scheduled):** the maintainer wants it removed and it is left for now at their instruction.
  `isWeb` is defined in `src/ts/platform.ts`; its only consumer is `preLoadCheck` in `src/preload.ts`, which writes a
  `mainpage` localStorage key that nothing in `src` reads (searched, 2026-10-02); `src/preload.beforeUnload.test.ts`
  mocks it.
- **Still open on this ticket (unchanged):** the updater re-enable set at release, `src-tauri/key.txt`, the signing
  secrets and CHORE-35.

**Progress after the merge (2026-10-02; `MC-164`):**
- The Rebranding session's leftovers and logos are merged as `e768ef75` (`82776b3b`: the remaining app-name text, the
  Docker names and the server readmes; `94d7be86`: the Tauri icons, the public logo PNGs and two outlined wordmark
  SVGs). The Cargo crate name stays `risuai` (maintainer decision, relayed).
- The README is done: `e9b70b8d` (the Risutanium title and introduction, the identity entry, the CBS version-tag
  entry, the `<picture>` wordmark logo, the Docker names `risutanium` and `risutanium-save`; upstream's
  `public/logo_typo_small.avif` removed). `doc-verifier`: 15 claims, 0 wrong.
- `docs/branding/` holds the maintainer's Inkscape sources and exports (`33cafe18`, 18 SVGs).
- The repository was renamed by the maintainer to yor42/RisuTanium, and the links were updated: the Terms of Service and
  Privacy Policy links in Settings, the source and issues links on the home screen, two tests and the wiki-sync comment
  (`b745fc29`). The maintainer updated the repository URL inside the Terms of Service and Privacy Policy themselves
  (`4a7ed14d`). The commits through `48f00223` are pushed (`git status` shows the branch in step with its remote-tracking
  ref, 2026-10-02); whether the legal links now resolve on GitHub was not re-checked.
- **One more leftover was relayed to the Rebranding session:** the sidebar shows "Welcome to RisuAI!" with no character
  selected (seen at mobile width in the CHORE-64 live check). Not fixed here.
- `Title.svelte` still links risuai.net; the maintainer has not decided on it (relayed, `MC-164` 6).
- The `isWeb` removal stays pending (`MC-162`).

**Cleared on 2026-10-01:** the 16 inherited upstream pre-releases on the fork's GitHub Releases page
(`164.1.2-20250723-184522` to `166.1.0-20250808-034121`, published 2025-07-23 to 2025-08-08 by
`github-actions[bot]`, 28 assets each) and their tags. The maintainer deleted them ("tags and releases that came
from upstream has been deleted."); afterwards `gh release list --repo yor42/RisuAI` listed none and
`git ls-remote --tags origin` listed no tag. Upstream's tags still exist in local clones that fetched
`upstream`, so a `git push --tags` to `origin` would publish them again, and a `v*` one would fire docker-build.

- **Done and committed as `38583d3b` (updater disabled; Gate 2 `[EDITORIAL]`, ledger row 539):**
  - `UPDATER_ENABLED = false` (`src/ts/update.ts:55`); `checkRisuUpdate` returns at its top (`:58-60`), before
    any plugin call. Its one caller is `src/ts/bootstrap.ts:141` (at `38583d3b`; `:173` at `696ba5de`).
  - `endpoints` is `[]` (`src-tauri/tauri.conf.json:37`) and `createUpdaterArtifacts` is `false` (`:21`). The
    `pubkey` stays (`:36`): in `tauri-plugin-updater` 2.11.0 the plugin's config has no default for it, so the
    reviewer read that the registered plugin would fail to deserialise its config without one (read from the
    cargo registry source; not run). With empty `endpoints` the plugin returns `EmptyEndpoints` before any
    request, whichever caller (the reviewer read the `check` command; not executed). A raw IPC call from the
    webview is covered by this, not by the front-end guard.
  - `updater:default` stays in `src-tauri/capabilities/desktop.json:9` and `migrated.json:38`. With empty
    `endpoints` it is inert (reviewer's reading). Removing it would be optional extra defence and one more thing
    to restore at release (Gate 2 N1); it was left in place.
  - Tests: `src/ts/update.test.ts` (regression reproducer; red against the unfixed `update.ts`) and
    `src/ts/updaterConfig.test.ts` (two reproducers for `endpoints` and `createUpdaterArtifacts`, and a
    `guard:` test that the `pubkey` stays non-empty).
  - **Not run:** no `pnpm tauri build`, no `cargo` test and no app start with empty `endpoints`. A cheap check
    for the maintainer: start the desktop dev build once and confirm the console shows no "Error
    deserializing 'plugins.updater'" and no updater error at boot. The reviewer could not read `tauri-cli`
    here, so "signing variables set while `createUpdaterArtifacts` is false" is reasoned, not verified. The
    release run will print the `tauri-action` warning "Signature not found for the updater JSON. Skipping
    upload..." on every matrix row (reviewer's reading of `tauri-action` v0.6.2); it is expected while the
    updater is off.
- **The updater re-enable set (all together, at release time):**
  1. a new minisign key pair; its public key replaces `plugins.updater.pubkey` (`tauri.conf.json:36`, which is
     byte-equal to the `pubkey` on the local `upstream/main`, `f9728b14`);
  2. `endpoints` (`:37`) set to the fork's release `latest.json`;
  3. `bundle.createUpdaterArtifacts` back to `true` (`:21`);
  4. the signing secrets: the release workflow reads `secrets.TAURI_PRIVATE_KEY` and
     `secrets.TAURI_KEY_PASSWORD` (`.github/workflows/github-actions-builder.yml:63-66`). Both secrets exist in
     the repository (`gh api`, 2026-10-01); whether `TAURI_PRIVATE_KEY` matches the embedded `pubkey` is
     UNKNOWN (a secret cannot be read from source; the maintainer knows);
  5. `UPDATER_ENABLED` set to `true`.

  An upstream `pubkey` with a fork endpoint, or the reverse, rejects every update on signature mismatch (the
  comment on `UPDATER_ENABLED`; the reviewer read `verify_signature` against the config's `pubkey`). Nothing
  enforces the five-way change; the two config reproducers in `updaterConfig.test.ts` go red when
  `endpoints` or `createUpdaterArtifacts` is restored, which is the intended tripwire.
- **App identity (no decision; each value is upstream's, read from the working tree):**
  - **`identifier` `co.aiclient.risu`** (`tauri.conf.json:33`), the same value as on `upstream/main`. A test
    fixture's asset path shows it in the data directory
    (`src/ts/parser/tests/assetSrcSanitize.test.ts:54`: `.../Application%20Support/co.aiclient.risu/assets/...`).
    INFERRED, from that fixture and the packet's reading of the Tauri identifier: a fork build with the same
    identifier shares the app-data directory, the single-instance identity and the installer's upgrade lineage
    with an installed upstream app; changing it later leaves the old data directory behind, so this is a
    **one-way decision**. Which is wanted is the maintainer's call. `MC-087` 1 supports in-place swaps for
    self-hosted installs only; no decision covers the desktop build.
  - **`productName` and `mainBinaryName`** `RisuAI` (`tauri.conf.json:30-31`), the window `title` `Risuai`
    (`:54`), `index.html:15` (`<title>Risuai</title>`) and `:36` ("Loading Risuai..."), and
    `public/manifest.json:2` (`"name": "Risuai"`).
  - **The deep-link scheme `risuailocal`** (`tauri.conf.json:44`), the same as on `upstream/main`. INFERRED:
    an installed upstream app and a fork build would contend for the OS handler of that scheme. No file under
    `src` or `src-tauri/src` contains the string (Grep, 2026-10-01).
  - **The version `2026.8.250`** in three places that must move together: `tauri.conf.json:32`, `version.json:2`
    and `src/ts/storage/database.svelte.ts:25` (`appVer`, marker `<APP_VERSION_POINT>`). It equals
    `version.json` on the local `upstream/main` (`f9728b14`) and the local tag `v2026.8.250`. Readers:
    `src/lib/Others/AlertComp.svelte:35` imports `version.json`; `appVer` reaches `src/ts/cbs.ts:1969`,
    `src/ts/parser/parser.svelte.ts:1095` and the `x-risuai-info` header at `src/ts/characterCards.ts:1733`.
    The release workflow no longer reads `version.json` (its `jq` step was removed). A fork release at this
    number would equal upstream's, and (INFERRED, packet) an upstream install on a newer number would never
    see the fork's build as an update.
  - **A published release creates a `v*` tag, which fires `docker-build`.** The release workflow creates a
    draft release with `tagName: 'v__VERSION__'` and `releaseDraft: true` (`github-actions-builder.yml:71,74`).
    Gate 2 of the CI rework noted that publishing the draft creates the tag `v2026.8.250`, and that a `v*` tag
    triggers `docker-build` (`on: push: tags: 'v*'`), which pushes `:<tag>` and `:latest` images; that is the
    stated intent, and GitHub's tag creation was not exercised.
  - **Cargo and package metadata:** `src-tauri/Cargo.toml:2-5` (`name = "risuai"`, `version = "0.0.0"`,
    `description = "A Tauri App"`, `authors = ["you"]`) and `package.json:2,4` (`risuai`, `1.0.0`). Placeholder
    metadata; not shown to users as far as the survey traced.
  - **The legal flag in the desktop release workflow:** since `a6a27df5` the release step passes no value for
    `VITE_RISU_LEGAL_CONFIGURED`; a comment there says the flag comes from `.env.production`, where it is `TRUE`
    (`MC-157`). Before `a6a27df5` the step read an opt-in repository variable that was empty by default
    (`712a76ad`, `MC-155`), and before `712a76ad` it set `'TRUE'`, as upstream's did. The workflow has not been
    run since the change (the commit message of `a6a27df5`).
  - **No macOS or Windows signing secrets:** the repository's secret list on 2026-10-01 held no `APPLE_*` or
    Windows code-signing entry, so macOS and Windows artifacts would be unsigned and not notarised (INFERRED
    from the list; no release was built).
- **`src-tauri/key.txt` is tracked, and its role is not established.** The file is tracked (`git ls-files`),
  32 bytes by file size, and was added in `a1a38d5a` (2024-01-14, "Add Python server setup and dependencies
  installation"), so its contents have been public since then. **The contents were not opened or quoted.** What
  the source shows:
  - the bundled local model server, `src-tauri/src-python/main.py:14-21`, reads `key.txt` from the folder
    of `sys.executable`, and writes a `uuid.uuid4()` there first when the file does not exist; it rejects a
    request whose `x-risu-auth` header differs from that key (`main.py:107-120`);
  - `src-tauri/src-python/run.py:6-8` writes a new `uuid.uuid4().hex` to `key.txt` in the working directory
    each time it starts;
  - the app fetches `http://localhost:10026/`, which returns the key file's path (`main.py:32-34`), reads that
    file with `readTextFile` and sends its content as `x-risu-auth` (`src/ts/process/models/local.ts:128-131`
    and `:162`);
  - neither script names `src-tauri/key.txt` by its repository path, and `bundle.resources` lists only
    `src-python/*` (`tauri.conf.json:17-19`).

  So a per-install key is generated when the file is absent. Whether the tracked file ever reaches an
  install, and whether it is a key from a developer run of `run.py`, is **UNCERTAIN** (not traced). If it
  does reach an install, that install would use a key that is public. A likely shape, not decided: stop
  tracking the file, and confirm the packaged sidecar generates its own.
- **CI caveat (Gate 2 N1, ledger row 537): a push to the `origin/main` mirror still runs upstream's old
  workflows.** GitHub reads a push-event workflow file from the pushed commit, and `origin/main` (`669b12ce`)
  holds upstream's `docker-build.yml` (push to `main`), `nightly-deploy.yml` and `codeql.yml`. They fired on
  2026-09-16 to 2026-09-18, and `docker-build` published `ghcr.io/yor42/risuai:<sha>` images of upstream's code
  on 2026-09-16 and 2026-09-18 (a 2026-09-17 run was cancelled after about six hours, per Gate 2); the
  maintainer has since deleted those images (`MC-154` 2). The edited workflows apply only to refs that carry
  the new files, so syncing the mirror (`git push origin upstream/main:main`) would publish an image again.
  The fix was a maintainer action, not a code change. **Closed on 2026-10-01:** the maintainer deleted the
  `main` branch on `origin` ("remote/main branch has been deleted, as its identical to upstream."), and a stale
  branch holding an unrelated earlier performance fix; afterwards `git ls-remote --heads origin` listed only
  `fix/persistence-conflict-platform-hardening`, the default branch. Pushing an upstream ref to a new branch
  name on `origin` would bring the old workflow files back. A `v*` tag pushed from upstream's tag set would
  also publish `:latest` of whatever commit it names; `origin` has no tags at all since the maintainer deleted
  the 16 inherited ones (`git ls-remote --tags origin`, 2026-10-01).
- **Placement:** not scheduled. It must close before the first release (`MC-089`). Step 5d and the rest of the
  work order are unchanged.
- **Related:** `MC-011`, `MC-085`, `MC-086`, `MC-087`, `MC-089`, `MC-092`, `MC-153`, `MC-154`, `MC-155`, `MC-156`,
  `MC-157`; CHORE-35; ledger rows 536 to 539 and 552 to 554.

### CHORE-61 — The save encoder silently loses presets, modules or a character when a character's `chaId` equals a fixed block name, and cannot write a `chaId` over 255 bytes (observed at encoder level only)

**Status (2026-10-01):** open, **not scheduled and not placed in the work order**; type: data loss candidate.
Filed from memory stage 1 step 5d-1's Gate 1 round 1 (`opus-reviewer`, ledger row 558). **Observed** by that reviewer
in a scratch run of the real `RisuSaveEncoder`, not in a running app and not through `saveDb`. **Not known:** how a
live character comes to hold such a `chaId`, so the reach of the defect is UNKNOWN. Present at HEAD `e8cf50de`
(`risuSave.ts` was not changed by 5d-1). Whether upstream's encoder behaves the same was not tested; the CHORE-28
entry records that upstream `main` has the same one-block-per-`chaId` code.

- **What exists (read at HEAD `e8cf50de`, 2026-10-01):**
  - The encoder keeps one block per key in a plain object, `private blocks: { [key: string]: Uint8Array } = {}`
    (`src/ts/storage/risuSave.ts:254`).
  - `init` writes the fixed blocks under their own names: `root`, `preset`, `modules`, `loadouts`, `plugins` and
    `pluginStorage` (`:340-374`), and `config` (`:452`). It writes each character's block under `String(chaId)`
    into the same object (`:393-447`; the single-holder write is `this.blocks[key] = ...` at `:439`). `root`
    is written last, after `__directory = Object.keys(this.blocks).filter(key => key !== 'root')`
    (`:646-652`). Nothing in that loop checks the key against the fixed names, so a character whose `String(chaId)`
    is a fixed name and the fixed block write to one key, and the later write wins (INFERRED from the line order
    of the writes in `init`; the scratch run's outcomes below agree with it).
  - The block header stores the name length in one byte (`headerBytes.set([nameBuf.length], 2)`, `:737`), so a
    name of 256 bytes or more cannot be written back as a header the decoder can walk (the reviewer's reading,
    confirmed by the scratch run below).
  - A `chaId` of `__proto__` assigns to `blocks['__proto__']`, which replaces the object's prototype instead of
    adding a key (INFERRED from plain-object semantics). The step 5d investigator's probe, which mirrored the
    object and the `encode()` loops (`:662-674`) rather than running the real encoder, printed a `NaN` total
    length and a `RangeError`; the real encoder's own outcome is the scratch run below.
  - The CHORE-28 duplicate guard (`:376-449`) handles two characters holding the same key; it has no handling for
    a key equal to a fixed block name (read, not run).
  - `repairDatabaseIds` gives a falsy `chaId` a new id and re-ids a `chaId` that equals an earlier `chaId` or an
    earlier chat id (one shared set for both, `src/ts/process/chatIds.ts:151-163`; the function is `:147-184`); it
    does not look at the fixed names, the length or `__proto__`.
- **Observed (the reviewer's scratch run; the record is `gate1-r1.md` and `names.scratch.test.ts` in the session
  scratchpad, not in the repo):**
  - Setup: the real `RisuSaveEncoder` (`init` with compression off, `set` with an empty to-save, then `encode`),
    then `checkCommittedBlocks` and a strict `decodeRisuSave` of the written file. localforage, platform (web, not
    the Node server), `database.svelte` and `globalApi` were mocked as in `bootArchiveCheck.test.ts`. The tree was
    three characters: `plain-a`, one with the candidate `chaId`, and `plain-b`.
  - `chaId` `root` or `config`: the encode succeeded, the block check failed on the block count (2 against 3), and
    the strict decode of the written file succeeded with **2 characters**: one character silently gone.
  - `preset`: the block check reported the preset block missing, and the strict decode succeeded with **the
    presets replaced by the template**: the user's presets gone.
  - `modules`: the strict decode succeeded with **`modules` undefined**.
  - `loadouts` and `plugins`: the block check failed; the strict decode succeeded (what it returned for those two
    was not recorded in the reviewer's table). `pluginStorage`: the block check failed on the block's kind.
  - 256 ASCII bytes and 86 x U+4E00 (258 bytes): the block check failed on the header checksum and the strict
    decode **threw**. 255 bytes (ASCII, and 85 x U+4E00) passed everything. A lone surrogate (`'ab\ud800cd'`): the
    block check failed (the directory names a block the file does not hold) and the strict decode threw.
  - `__proto__`: `encode` threw "offset is out of bounds". The Gate 2 reviewer saw the same throw against HEAD's
    boot pass (the pass as it was before 5d-1) before its block check.
  - The reviewer's table also lists names that did **not** fail: `constructor` and the other `Object.prototype`
    method names, `__directory`, and the ids that sort differently (`'10'`, `'2'`, `'01'`, `'-1'`).
- **Not observed:** `saveDb`'s own flow with real to-save flags (`src/ts/globalApi.svelte.ts:1324-1332` calls
  `encoder.set` and `encoder.encode`); any running app; any real profile.
- **Reach (what is known):**
  - Per the reviewer, `__proto__`, over-255-byte and lone-surrogate names can reach the boot pass only through a
    non-RISUSAVE (msgpack) main file, which the strict decode accepts (`risuSave.ts:1255-1257`, the `raw`
    header branch, decodes with `unpackr`); fixed names and typed collisions (`5` and `"5"`) can arrive in an
    ordinary RISUSAVE file. This is the reviewer's reading; the Orchestrator did not re-run it.
  - The boot pass now refuses such a tree (`refusalReason`, `src/ts/storage/bootArchivePass.ts:345-373`, committed
    as `e8cf50de`): it writes no unit, posts no notice and logs one console warning. **An ordinary save does not
    refuse.** A Grep of non-test `src` for the pass's two constants, `FIXED_BLOCK_NAMES` and `MAX_BLOCK_NAME_BYTES`,
    found them only in `bootArchivePass.ts`, so no other file checks these names under those constants; a check
    under another name was not searched for.
  - **TODO(evidence):** how a live character acquires a `chaId` that equals a fixed name, is over 255 bytes or is
    `__proto__` (a plugin write, a CBS or Lua call, an import, a backup restore). No source was traced for this.
- **Not decided:** the shape of a fix, and whether the fix refuses, re-ids or rejects such a `chaId`. The
  encoder is shared by `saveDb`, the boot pass and the backup paths, and changing it is in the save format's
  neighbourhood, so a plan would need `opus-reviewer` and an upstream-compatibility check (`MC-011`).
- **What would settle it:** (a) a `saveDb`-level run with a fixed-name `chaId` and real to-save flags; (b) a trace of
  how such an id can be set; (c) the same scratch run against upstream's encoder.
- **Related:** CHORE-28 (the duplicate guard), CHORE-52 (cold-storage keys that alias); memory stage 1 step 5d-1
  (`e8cf50de`, ledger rows 558 to 565).

### CHORE-62 — On a Node server, another device's save makes this device stop saving until it reloads, and its edits since its last save are lost (TRACED; not run against a real server)

**Status (2026-10-03 note):** since `MC-182` CHORE-58 comes right after CHORE-59, ahead of steps 6 and 7, so CHORE-62 is now
the last of the four (CHORE-59, CHORE-58, steps 6 and 7, CHORE-62). Its own placement after steps 6 and 7 is unchanged. The
status below is kept as approved on 2026-10-02.

**Status (2026-10-02):** open, **placed in the work order after steps 6 and 7 and before CHORE-58, approved by the
maintainer (`MC-160` 1)**; type: usability and data-loss risk for edits made after the last successful save. The
position was the Orchestrator's; the only placement wording in `MC-159` 1 is in the option text the maintainer selected
("Document + ticket (Recommended)"): "placed later in the work order". Filed from memory stage 1
step 5d-4's investigation (ledger row 588). The README documents the consequence as it is today (see below).

- **What exists (read at the working tree on 2026-10-02, on HEAD `3fca470e`; `globalApi.svelte.ts` has no uncommitted
  change):**
  - In the `saveDb` loop, the `NodeStorageConflictError` branch (`src/ts/globalApi.svelte.ts:1451-1504`) has two arms.
    **Before the commit** (`primaryCommitted` false, `:1483-1503`): one toast ("Your local data conflicts with a newer
    version on the self-hosted server — your latest changes could not be saved. Reload the app to get the current data
    (unsynced local changes will be lost)."), `console.error`, `saving.state = false`,
    `savingStoppedReason.set('node-conflict')` and `await sleepForever()` (`:1500-1502`). `sleepForever` never
    resolves (`src/ts/util.ts:50`), so only a reload ends it, and the code comment says so. **After the commit**
    (`:1476-1482`): a different toast and the loop goes on; the tab is not parked.
  - The red save-stopped icon shows `savingStoppedNodeConflictMessage` for that reason (`SavePopupIcon.svelte:9-10`;
    `en.ts`: "...this tab has permanently stopped trying to save. Changes made from now on will not be kept. Reload the
    app to get the current data — any unsynced local changes will be lost."; line 1220 at `e7d7f093`, `:1208` at
    `3fca470e`, the difference being step 5d-4's eight keys).
  - The tab prompt that `MC-138` 1 called "the existing conflict prompt" is a different mechanism. It rests on
    `BroadcastChannel('risu-db')` (`:1040-1051`; the post at `:1376`), which reaches only tabs of the same browser. A
    second device or browser sends nothing on it (`MC-159` 3).
  - The 409 itself is the Node server's per-file revision check, Phase 1.5 Tier B Stage 1 of this campaign (Phase 1.5
    item 2, above). Whether upstream's Node server has the same check was not looked at for this entry.
- **Trigger:** any save by another device or browser to the same Node key. Startup archiving is the on-by-default
  trigger, because a start can save without an edit: the boot archive pass (5c), and since step 5d-3 the fill-in of
  upstream placeholders, which runs even with archiving off. The README names the first. **INFERRED, not run:** that
  device B's startup commit always makes device A's next save fail (the 5d-4 investigator's open question 3; the
  commit goes through `forageStorage.setItem` in `src/ts/storage/bootArchiveHost.ts:81`, and a comment there says it
  carries the Node revision).
- **What the user sees today:** a toast, the red icon, and a tab that no longer saves. Edits made in that tab after
  its last successful save are lost when the user reloads. Nothing offers to keep them.
- **Not decided:** the shape of the recovery. The option text the maintainer selected gave one example, "reload and
  keep its edits", which is an example and not a design. Open questions: where the unsynced edits would be kept, and
  whether they can be merged or only offered back; and how it relates to the deferred Option 3 (CRDT/op-log merge) and
  Option 4 (hard lock and takeover UI) in Phase 1.5 Tier B item 7, which wait on a product decision about whether
  detect-and-refuse is acceptable as the long-term experience, and until Phase 2's per-character decomposition
  exists. The code comment at `:1463-1464` points to Report 06
  (`06-conflict-resolution-design-feasibility.md`) on why queuing the failed edit and reloading would discard it; that
  report was not re-read for this entry. A fix is in the save path and the conflict protocol, so a plan would need
  `opus-reviewer` and an upstream-compatibility check (`MC-011`).
- **What would settle it:** a run with two browsers (or two devices) on a scratch Node server: open the app on A, start
  and finish a boot on B with archiving on, then edit on A and watch for the toast and the icon; reload A and check
  whether the edit is gone. Not run. `server/node/server.cjs` resolves `dist` and `save` from its working directory,
  so a scratch folder does not touch the repo's `save/`.
- **Placement:** after steps 6 and 7, before CHORE-58 (approved, `MC-160` 1: "I approve the chore-62 placement"; "before
  CHORE-58" is superseded by `MC-182`, which puts CHORE-58 before steps 6 and 7). It
  does not depend on the idle reload; it is placed late because the option text the maintainer selected says "later in
  the work order" and the README now states the behaviour.
- **Related:** `MC-138`, `MC-158` 4, `MC-159`; Phase 1.5 Tier B items 2, 3 and 7 (above); memory stage 1 step 5d-4
  (ledger rows 588 to 596).

### CHORE-63 — Copy button reliability: the message copy button can fail silently or paste its own card (TRACED; desktop timing RUN; Android not run)

**Status (2026-10-02):** open, not fixed. **Placed right after CHORE-53 and before CHORE-43 with CHORE-54, and fixed in
the same change as CHORE-40** (`MC-160` 3). Type: reliability and surprising output; no persisted data is involved.
Filed from the maintainer's report on upstream (`MC-160` 2) and the CHORE-40 second investigation (ledger row 600).
**Later the same day the work was split and stage A was committed as `d013e7cf`; see the second status paragraph at
the end of this entry.** Labels below: TRACED = the code path was read; RUN = executed in the investigation; INFERRED = reasoned, not verified in
source or by execution.

- **The report (`MC-160` 2, an observation of an upstream build, `MC-011`):** Chrome on Android, Galaxy S22 Ultra and Z
  Fold 7, the Samsung keyboard. (a) A long message sometimes fails to copy, with an Android "failed to copy into
  clipboard" toast. (b) Sometimes the persona name is prepended and "From RisuAI" appended. (c) Sometimes the copy works
  but the text does not properly appear on the clipboard. It is random, so the maintainer could not capture output.
- **What exists (TRACED, read at HEAD `7cf6ac27`, tree clean, against `upstream/main` `f9728b14`):** the handler is
  textually identical in the fork and upstream (a diff of the snippet body; fork line N is upstream line N - 335). It is
  about 225 lines inline in a snippet in `src/lib/ChatScreens/Chat.svelte` (fork `:925-1155`). The button renders only
  if `DBState.db.useChatCopy` is on and the message is not blank (`:924`); `useChatCopy` has no default, so with
  "Use Chat Message Copy" off there is no button.
- **"From Risuai" is not a share sheet; it is the footer of the card the button builds (TRACED).** The footer is at
  `Chat.svelte:1126` (upstream `:791`), and the code says "From Risuai", not "From RisuAI". The persona name is the
  card's `<h3>` header (`:1119`; `displayName` set at `:1062`). A user message gets no model badge. The clipboard item
  always carries both `text/plain` (the raw parsed message) and `text/html` (the card), so (b) matches a copied **user**
  message pasted into a target that takes `text/html` (TRACED mechanism; the target dependence is INFERRED). There is no
  `navigator.share`, no `document.execCommand('copy')` and no Tauri or Capacitor clipboard call in the message button
  (grep of `src/` in the fork and in `upstream/main`: 0 hits for `navigator.share`; in the fork `execCommand('copy')` only in
  `AlertComp.svelte`). The only APIs it uses are `navigator.clipboard.write` and `navigator.clipboard.writeText`.
- **The single rich write happens after serial awaits (TRACED).** In order, all awaited before anything is written:
  `alertWait`; `ParseMarkdown` (asset resolution, inlay reads, a lazy `highlight.js` language chunk per code-fence
  language not yet loaded); then, one image at a time, a `fetch`, a re-encode to a data URL and a canvas JPEG at natural
  size for each message `<img>` whose source starts with `http`, `/`, `data:` or `asset.localhost` (`:967-1014`); then
  the **character icon on every press, even for a user message** (`:1019-1059`); then, for a user message, the persona
  icon (`:1068-1113`). Only then `navigator.clipboard.write(...)` (`:1131-1136`). The message-image loop has no
  `onerror` and no timeout (`:1001-1003` waits only for `onload`), so an image that fetches but will not decode leaves
  the handler awaiting forever with the loading alert up and nothing written. The icon loops do have `onerror`.
- **Browser activation can expire before the write (RUN on desktop; Android INFERRED).** Headless Chrome 154.0.8037.59
  on desktop (a scratch test page calling `clipboard.write` in headless Chrome, not the app's handler), a real mouse
  click as the gesture: `clipboard.write` and `writeText` called after a 0 s and a 3 s wait
  succeeded; after 6 s and 12 s both were rejected with `NotAllowedError` (write permission denied) and
  `navigator.userActivation.isActive` was false. Granting `clipboardSanitizedWrite` did not rescue it in headless; that
  is not to be over-read. The run brackets the boundary between 3 s and 6 s, which is consistent with Chrome's documented 5 s transient
  activation (the 5 s figure is not measured here). Android Chrome has the same engine rule
  (INFERRED); its default for writes outside a gesture was not verified. What makes the wait long and different on each
  press (TRACED; the magnitudes are INFERRED): the first press after a load (a cold `highlight.js` chunk, the service
  worker round trips for `getFileSrc`, inlay reads), each external image fetched in turn with no timeout, a full-size
  decode and encode of the character icon and of each image on a phone CPU, message length, and the number of
  code-fence languages.
- **A failure is silent and writes twice (TRACED).** On any failure in the rich path the `catch` block calls
  `alertClear()` and `navigator.clipboard.writeText(copyText)`, logs nothing and has no `.catch`; it also does not
  `return`, so control falls through to a second `writeText` (`:1140-1149`). After an activation-expiry failure both writes run past the activation window and are rejected; after a failure
  with another cause the fallback `writeText` can still succeed inside the window and leave plain text on the
  clipboard. If
  both fail the user sees the loading alert disappear and nothing else: no message, no console line, an unhandled
  rejection. No string in `en.ts` says "failed to copy"; the Android toast is **not produced by the app** (TRACED
  absence). Success shows a modal "Copied" for the rich write and a small "Copied" text beside the message buttons for
  the plain fallback.
- **The payload is unbounded (TRACED structure; the Android limit is INFERRED).** The card embeds the avatar as a base64
  JPEG q0.9 at the avatar's natural pixel size and each fetched message image as a JPEG q0.6 at natural size, plus inline
  `style=` on every paragraph, and the same item carries the text again as `text/plain`. There is no size check. RUN on
  desktop: 1 MB, 20 MB and 100 MB `text/html` blobs were written (100 MB in 833 ms), so size is not the limit there. On
  Android, very large clip data is known to throw `TransactionTooLargeException` around the 1 MB mark through the system's
  inter-process call (INFERRED from general Android knowledge; not checked against Android or One UI source). Whether Chrome Android turns that into a
  rejected promise, a resolved one or an OS toast is **UNCERTAIN**. An expiry failure is silent and an OS refusal gives
  a toast, which is what would tell the two apart; the toast therefore points past Chrome's gate (INFERRED).
- **`blob:` inlay images stay dead links in the copied HTML (TRACED).** The image predicate excludes `blob:`, and
  `parseInlayAssets` in `parser.svelte.ts` calls `URL.createObjectURL` at `:707` and emits `<img src="blob:...">` at
  `:717`. They are copied as `blob:` URLs and do not resolve outside the page. So the ticket text in Report 28 section 11.6, that the button "re-fetches images the
  browser has already loaded", is only half true: it re-fetches `http(s)`, `/`, `data:` and `asset.localhost` sources.
  `getFileSrc`'s `/sw/` URLs are inlined.
- **(c) is not settled.** App-side candidates for a copy that reports success with a poor result (INFERRED): the page
  shows "Copied" as soon as `clipboard.write` resolves and never reads the clipboard back; `blob:` and uninlined external
  images; a plain paste target showing only `text/plain`. On the platform side, the Samsung keyboard's clipboard layer.
  No size or image limit for it is documented here, and the maintainer's first suspicion that (c) is not RisuAI's is
  plausible and not excluded. The code cannot influence it beyond the MIME types it offers.
  - **The maintainer's later hypothesis (`MC-160` 2), not established from source:** the card also explains (c), because
    the Samsung clipboard does not seem to support images, so a copy might only partially work and the clipboard fails
    when the card contains images. "Does not seem to support images" is the maintainer's impression, not an established
    fact; the investigation found no documented limit for the Samsung clipboard (F12 of the packet) and did not test it. It fits the mechanism above:
    the card's `text/html` embeds base64 images (the avatar and each fetched message image), and the same item carries
    the text again as `text/plain`. If it is right, the plain-text default (`MC-160` 3) removes the images from the
    default copy, and so removes this trigger whichever explanation holds; the "copy as card" action would still carry
    them.
- **Also found, not part of the report (TRACED):** the copied text is the parsed original message, never the translated
  text, so copying while a translation is shown copies the untranslated text.
- **Same code in the fork and upstream.** The fork keeps the symptoms by construction; these are observations of an
  upstream build (`MC-011`). The handler is identical; code it calls differs, at minimum `getFileSrc` (a budgeted cache
  with an oversize memo, `globalApi.svelte.ts:288-442`) and `parser.svelte.ts` and `alert.ts`, which differ from
  upstream and were not compared line by line for this ticket.
- **Decided (`MC-160` 3):** a tap copies plain text by default; the card becomes a separate "copy as card" action. Not
  decided: its gesture (long-press or a menu item) and label, and the size caps and timeouts.
- **Fix directions (the investigator's design opinion, not a decided design; they do not depend on which of expiry or
  size is the cause):**
  - Call `navigator.clipboard.write` synchronously inside the tap, before any await, with `Promise`-valued
    `ClipboardItem` entries. RUN on desktop Chrome 154 (a scratch test page, not the app's handler): a synchronous call with promise-valued items survived awaits of
    6 s, 12 s and 20 s, and an 8 s await producing a 5 MB blob, all resolved. Android is INFERRED to behave the same.
    The `text/html` promise must never reject (resolve a minimal fallback on any build error), because a rejection
    rejects the whole write and the fallback `writeText` then runs outside the gesture. With the maintainer's decision
    the default is plain text, and `copyText` is computed before the first await (`:925-929`), so a plain write needs no
    awaited work first (the Orchestrator's reading of the packet, not run); the card path is where the awaited work
    remains.
  - Bound the remaining work in the card path: a timeout per fetch, an `onerror` on the message-image loop, no icon work
    for a user message, a downscale before `toDataURL`, a cap on the total length with a plain-text fallback. Do not
    fetch external hosts (this is CHORE-40's fix, and it falls out of the same change).
  - Say when a copy failed, and remove the second `writeText` (add a `return` or a `catch`).
  - Local-only diagnostics, no telemetry: a `console.warn` in the failure path with the branch, the error name, the time
    since the tap, `navigator.userActivation?.isActive`, `document.hasFocus()` and the sizes, and a one-line failure text
    in the existing small status span beside the message buttons.
- **Sizing (the investigator's estimate):** `Chat.svelte` plus a new module (for example `src/ts/chatCopy.ts`) holding the
  html builder, the image inliner with an injected fetch and timeout, and the function that starts the write on the tap.
  About +150 to 250 lines in the module, about -210 in `Chat.svelte` (a call site of 10 to 20 lines remains), and about
  +30 to 60 lines of tests. One caller (the button). **No persistence code is touched:** no save format and no database
  write path.
- **Tests (needed; none exist today).** The `Chat.*.svelte.test.ts` files mount `Chat.svelte` under happy-dom but set
  `useChatCopy: false`; no test exercises the handler. Needed: a regression test with a mocked `navigator.clipboard.write`
  that records order and fails on the current code because the write comes after awaits (happy-dom has no user
  activation, so real expiry cannot be tested there); the html builder (a user message has no model badge, the footer is
  present); the image inliner (a timeout and an undecodable image do not hang, external URLs are not fetched); and the
  failure path (a message is shown and `writeText` is not called twice). Verify red before green on the old code.
- **Translation:** one new English key for the failure line (for example `copyFailed`), the existing `copied` reused, and
  one more key for the "copy as card" label (`MC-160` 3's option text says "one more translated label"). Seven
  languages: ko, cn, zh-Hant, vi, de, es and en.
- **What would settle the open points (not needed for the fix; Android and One UI cannot be run from here):** on the
  next failure, which result appeared (the modal "Copied", the small "Copied" text beside the buttons, or nothing),
  whether the same message copies on an immediate second press, whether the failing messages have images or code
  fences, and which app received the paste in (b). A copy of an oversized dummy payload on a Samsung device in a tiny
  test page would settle the size limit and whether Chrome resolves before the OS commits.
- **UNCERTAIN, not settled:** who raises the "failed to copy into clipboard" toast and at what size; whether Android
  Chrome resolves `clipboard.write` before the OS commits the clip; whether Android Chrome grants writes outside a
  gesture; a focus or visibility rejection on a foldable's multi-window (INFERRED, low prior, not run).
- **Related:** CHORE-40 (the same function; fixed together), `MC-011`, `MC-160`; Report 28 section 11.6; ledger row 600.

**Status (2026-10-02, later): stage A committed as `d013e7cf`; stages B and C and the live check are open.** The
maintainer split the work (`MC-165` 6), so the sentence above that CHORE-63 is "fixed in the same change as CHORE-40" no
longer holds: CHORE-40 is closed by stage A. `MC-165` 1 decides the gesture that the "Not decided" bullet above leaves
open (a "Copy as card" item in the message's "..." menu). The ticket text above is otherwise unchanged. What the commit
message says stage A does:
- A tap on the copy button (and the copy hotkey, which clicks it) calls `navigator.clipboard.writeText` with the
  message text synchronously in the click, before any await. It writes plain text only, and the text is still the parsed
  original message, not a shown translation. The copy logic is in the new `src/ts/chatCopy.ts`.
- The rich card, with its markdown parse, image and icon fetches and canvas re-encodes, is removed from the tap, so the
  button requests no host at all (CHORE-40).
- When `writeText` is missing, throws or rejects, the text is copied with `document.execCommand('copy')` on a temporary
  off-screen readonly textarea. A failure is shown beside the message buttons as the name of the first failure followed
  by the translated "Copy failed" (the new key `copyFailed`, in all seven languages).
- The blocking "Loading" and "Copied" dialogs are gone. The status text clears itself after 3 s (10 s for a failure).
- The message "..." menu opens on one tap after an item in it was used or it was closed by a click elsewhere; a tap on "..." while it is open still closes it.
- Checks on the final tree, from the commit message: `pnpm test` 289 files, 5626 passed, 4 skipped; `pnpm check` 0 errors,
  0 warnings; `pnpm build` ok. The acceptance tests were written against the unchanged code first: all 12 copy tests and
  the two reopen tests failed there; one reopen test passed there and is kept as a guard.
- **Gate history:** plan Gate 1 rounds 1 to 3 were `[REJECT]`, every finding in the card part and none in the plain-copy
  half (ledger row 624); the loop was escalated to `senior-advisor` (ledger row 625), and the maintainer split the work;
  stage A Gate 2 was `[APPROVE]` with four optional notes, one comment corrected (ledger row 626).

**Open:**
- **Stage B:** the "Copy as card" item in the message's "..." menu, with the card contract the maintainer closed
  (`MC-165` 1, 2, 4 and 5): a menu item, not a long-press; an outside image stays a link and the app fetches nothing;
  app colours only; hidden blocks and collapsed sections, including the thinking section, are dropped, except that
  content hidden by a card's stylesheet rule cannot be detected and would appear. The brand strings in the card become
  "RisuTanium" (`MC-162` 1; the Orchestrator's call, `MC-165`). "Copy as card" is not in the app until this lands.
- **Stage C (optional):** embedding the message's own local images, with a byte budget (`MC-165` 6 mentions it as an
  optional third change). TODO(evidence): the budget figure and the decision to do it are not recorded.
- **The live check**, deferred by the maintainer to after stage B (`MC-165` 8). Not run: a live check in a browser and
  anything on Android (Android cannot be run from here).

**Status (2026-10-02, latest): closed by `7ca8f2a9` (stage B) together with `d013e7cf` (stage A); the live check was run
in a browser.** Both commits are local, not pushed. The "Open" list above is superseded: stage B is committed, stage C is
now its own ticket, CHORE-68 (`MC-166` 4), and the live check is below. Android was not run. The ticket text above is
otherwise unchanged. What the `7ca8f2a9` commit message says stage B does:
- A message's "..." menu has a "Copy as card" item when message copy is on, the message is not blank and the browser
  offers `ClipboardItem` and `clipboard.write` (so not on a plain-http page). Its click calls `clipboard.write`
  synchronously with the plain text and a promise for the card html, so the slow part runs inside the write. "Loading"
  shows beside the buttons while the card builds; a second tap on the same message's item meanwhile starts nothing.
- The card has the avatar, the name and a model badge (none for a user message), the message and a "From RisuTanium"
  footer, in the app's theme colours. The body is rebuilt from the rendered message into a new tree in an inert
  document: only listed elements and attributes are copied, so the message's own styles, classes and stylesheets do
  not carry over. It is not sanitised with DOMPurify (`MC-166`, the Orchestrator's calls 1). Hidden content (the
  `hidden` attribute, inline `display:none` or `visibility:hidden`, a closed `details` or `dialog`, including the
  collapsed thinking section) is left out. A formula appears as its TeX source (`MC-166` 1). Script, style, media,
  select options and similar are dropped with their text.
- Images: an outside web image keeps its address and is never fetched (`MC-165` 2). Every other image in the message
  (the app's own, `data:`, `blob:` and any other same-site address) is left out for now (CHORE-68). No node of the card
  is created by the live document, so the message's images are never loaded. Only the avatar is fetched, decoded and
  drawn, from a local address (`src/ts/chatCardImage.ts`): the persona icon for a user message, the character's image
  otherwise, shrunk to at most 160 px on its longest side and embedded.
- Bounds: the card is built within 3 s (the avatar within 2 s). A slow or failed avatar gives the card without it; a
  slow or failed body gives a simple card of the plain text; a card over 900 KiB together with the plain text gives the
  simple card; a message too large even for that, or a card write that cannot be started, is copied as text. The status
  says "Copied" for a full card, "Copied (simple card)" for the simple card or a card whose avatar could not be made,
  "Copied as text", or "<error name>: Copy failed" (`MC-166` 2).
- A newer copy wins: a plain copy, or a card from another message, made while a card is still being built cancels it,
  so the older card never lands on top. A newer card waits, up to its own 3 s limit, for an older card's write to
  settle. A plain copy made after an older card's html was ready is written again once that card's write settles (model
  tests only; in headless Chrome without a clipboard permission such a re-write works only within the click's
  activation, which ended between 3 s and 6 s, ledger row 629). For
  this the plain Copy button now also tells the card module about each plain copy.
- New lang keys `copyAsCard`, `copiedAsText` and `copiedSimpleCard` in all seven languages. The card logic is in the
  new `src/ts/chatCard.ts`.
- **Stated limits (from the commit message):** content hidden only by a stylesheet rule shows in the card; the item
  needs a selected character (the "..." menu does); a write still pending well after its time limit could land late.

**Evidence for stage B (from the commit message unless noted):**
- Tests: `Chat.copyCard.svelte.test.ts` was written against the unchanged code first, where its tests for the item
  failed because the item did not exist (its absence guards passed); the tests of the menu's wiring to the copy button
  were added after the code review. `chatCard.test.ts` covers the rebuild, the image rules, the bounds, the status kinds
  and the ordering with a stubbed clipboard (model tests), including a guard that the live document creates no card
  node. The avatar encoder is stubbed in all tests. From the Gate 2B packet (ledger row 631): 14 of the 19 Chat-level
  tests were red on HEAD.
- Real-browser evidence (RUN; headless Chrome 154 on Windows, the real `chatCard.ts` bundled, no clipboard permission
  during the writes, read permission granted only for reading back): an outside image in the message made zero requests
  to its host; the escaped hidden forms "DISPLAY : NONE /*c*/" and "display: n\6fne" and a closed `details` were left
  out; a card read back with its footer and escaped name; in twelve runs, ten of them overlapping, the later copy (card
  or plain) was the one on the clipboard. The path where a plain copy is written again after a ready card settles was
  not reached in Chrome; it is covered by the model tests. Chrome returns copied plain text with CRLF line breaks on
  Windows (raw clipboard calls do the same).
- Mutants on the wiring, the cancellation and the status lines: all killed except one judged equivalent (a second
  superseded check that the cancellation already covers). Per the Gate 2B packet (ledger row 632): round 1 ran 27
  mutants; M01, M02, M03, M06, M07 and M24 survived and M08 was judged equivalent; round 2 killed the six and added a
  new one, M29.
- Checks on the final tree (commit message): `pnpm test` 291 files, 5738 passed, 4 skipped; `pnpm check` 0 errors, 0
  warnings; `pnpm build` ok.
- **Gates:** plan Gate 1B round 1 `[REJECT]` (12 findings), round 2 `[EDITORIAL]` (ledger row 630); code Gate 2B round 1
  `[REJECT]` for test defects, round 2 `[APPROVE]` (ledger row 632). The `doc-verifier` checked the commit message: 38
  claims, 4 overstated and 5 incomplete, all corrected before the commit.
- **Not run (commit message):** WebView2, WebKit, Android and pasting into a real target.

**The live check (RUN, 2026-10-02, the maintainer's built-in pane, visible).** A production build of the final tree
(`pnpm build` after the last source change), a Node server from a scratch folder (port 6011, its own PID, stopped
afterwards), the page at phone width (486 px, the narrow layout, where Copy is inside the "..." menu). A test character
with the first message "Live check line one, *emphasis* here.\nSecond line: 복사 테스트." and no name. "Use Chat Message
Copy" was switched on in Settings.
- The "..." menu shows Copy (복사) first and "Copy as card" (카드로 복사) last.
- Copy: the status read "복사됨"; the Windows clipboard (read with `Get-Clipboard`) held exactly the message text with the
  raw `*emphasis*` markers; there was no HTML format on the clipboard.
- The "..." menu opened again on one tap after an item was used (stage A's fix).
- Copy as card: the status read "복사됨" (a full card; the character has no image, so no avatar was expected). The
  clipboard's HTML format held the card: theme colours, "emphasis" in the italic colour, the "AI" badge, the line break,
  the "From RisuTanium" footer and an empty name heading (the test character has no name). The plain text format held the
  exact message text.
- Console: no errors from the app (one `beforeunload` notice, caused by the Orchestrator's page reload).
- The check wrote to the maintainer's real Windows clipboard, which testing copy cannot avoid.
- **Not covered live:** an avatar; a plain copy during a pending card; a failure display; Android.

**Follow-ups filed from stage B:** CHORE-67 (existing tests that run DOMPurify under happy-dom), CHORE-68 (stage C) and
CHORE-69 (what the plain copy should leave out). Ledger rows 627 to 632; `MC-166`.

### CHORE-64 — A plugin's write of the `plugins` list through `setDatabase` deleted every plugin that was not new, confirmed and API 3.0, with its saved arguments and API keys, and gave no prompt about the deletion (DATA LOSS; upstream too; closed by `48f00223`)

**Status (2026-10-02): closed by `48f00223`, pushed.** Found by the Gate 1 round 2 review of CHORE-53 stage 53b (the
reviewer's finding N1, called G3; `opus-reviewer`, ledger row 610). It is **not** a stale-target defect and was not
fixed in CHORE-53. Present on `upstream/main`: the reviewer traced it to upstream's `a6e933ac` ("add confirmation
prompt for plugin installation via another plugin"). The maintainer's answers are `MC-163`; the dispatches are ledger
rows 618 to 622. The text under "Filing record" below is the 2026-10-02 filing text; where the investigation refuted
it, the correction is in the next section. Labels: EXECUTED = run; TRACED = read in source.

**Scope of the closure:** "never deletes plugins" holds for the two setters, `setDatabase` and `setDatabaseLite`. A V2.1
plugin can still delete or replace installed plugins through the live `getDatabase()` proxy with no prompt (the set trap
assigns `plugins` straight through; splice and in-place edits also work). That route is CHORE-65. The `48f00223` commit
title ("a plugin's write to the plugin list never deletes plugins") is broader than its scope. The commit is pushed and
is not amended; these records state the scope.

**Outcome (from the `48f00223` commit message):**
- Both setters (`setDatabase` and `setDatabaseLite`) now merge a written `plugins` list by name, against the
  list as it is when the merge is applied. A plugin left out of the list stays installed. An entry whose script equals
  the installed one changes nothing. An entry with an installed name and a different script is an update only if its
  `//@version` is newer; the same, an older or a missing version is ignored with a console warning. An update or
  install is read from the script's own header (name, display name, version, update URL, arguments, links, allowed
  IPC), must name the entry and must declare API 3.0; a new plugin starts with the header's default values.
- The user is asked once per update or install, in list order. The prompt names the plugin and, for an update, both
  versions. Asking stops at the first decline.
- If a change is declined or refused, or its target changed while the prompt was open, no change to the list is
  applied. The call's other keys are still saved, and the call rejects with an `Error` that names the plugin and the
  reason. A non-array `plugins` value does the same. A plugin that writes its own entry with a different script that the
  host does not see as newer also gets a rejection, so a self-updater cannot report a false success.
- Characters are reconciled against the live list when they are assigned, on both setters. `setDatabaseLite` stays
  synchronous when no plugin change needs asking, and a failing plugin value never makes it throw synchronously.
- Every update path keeps the saved values of the arguments the new version still declares with the same type, and the
  on/off state (an unset state stays off). The paths are a plugin's write, the Update button, `//@update-url` updates
  and re-import. Hot reload keeps the values and switches the plugin on. `installPlugin` returns the accepted installs
  and writes nothing; its prompt names the plugin and the source.
- The install prompt now names the plugin: no locale's text had the `{plugin}` slot before (`MC-163`; ledger row 618,
  Orchestrator spot check R3b). Five prompt strings are new or changed in `en.ts` and the six locales. `plugins.md` and
  `risuai.d.ts` describe the merge as a difference from upstream (fork-specific behaviour).
- The header parsing moved out of `importPlugin` into the pure module `pluginListMerge.ts`; `compareVersions` moved
  there unchanged. A 3000-header seeded parity run against the previous code matched alert texts and resulting entries
  for every input without a BOM. Two small differences: hot-reload error logs name the plugin from its first `//@name`
  line (this differs only for a script with several or blank `//@name` lines), and a leading BOM is now stripped before
  parsing.

**Corrections to the filing record (the investigation, ledger row 618, refuted these):**
- **The rule was broader than the title said.** The filing text says a list holding only installed plugins empties the
  list. The investigator found that setDatabase left in `db.plugins` only the entries that were new or script-changed,
  API 3.0 and confirmed; everything else was deleted, whatever the list held. EXECUTED in its scratch harness (26
  probes: 24 in the first leg and 2 added in the second, s1 and s2; against the real `plugins.svelte.ts` and the real `makeRisuaiAPIV3`, with the store, the alert and the sandbox
  mocked): a self-update through a snapshot round trip deleted every other plugin (a1); updating another plugin deleted
  the caller itself (e1); removing one entry deleted all of them (f1).
- **`setDatabaseLite` and the V2 proxy were prompt-free full writes.** The filing text covered the `setDatabase`
  path only. `setDatabaseLite` (V2 and V3) installed new and `2.1` entries with no prompt (EXECUTED d3), which defeated both
  `a6e933ac` and `839d190b`. A V2 proxy round trip left `[]` with no prompt (EXECUTED c2, c3). The proxy's set trap,
  `push` and in-place edits are also prompt-free writes (CHORE-65).
- **`importPlugin` reset saved values and the on/off state.** The Update button and the `//@update-url` updater reset
  `realArg` (API keys included) to the header defaults and forced `enabled` to true (EXECUTED u1, u2; the Orchestrator
  read `plugins.svelte.ts`). `upstream/main` has the same code. This is not in the filing text.
- **The merge rule was decided.** The filing text says the maintainer had not been asked, and that the reviewer's likely
  shape was "installed kept, confirmed new ones appended". The maintainer chose a different rule (`MC-163` 1:
  "Compare by name (Recommended)") and rejected that shape (the unmerged upstream fix `7221d338`).
- **Whether any published plugin does this** is no longer unsurveyed. The maintainer stated that some plugins use it for
  auto-update (`MC-163` 12). Of the maintainer's two provider-manager plugins, only v1.35.11 updates itself, with the
  whole list through `setDatabaseLite`; v1.16.5 directs the user to the Update button. AssetGod and
  fast-character-import do not write `plugins`. v1.35.11's own entry omitted `allowedIPC` on a self-update, so its IPC
  would have been refused after the update; the host now re-derives `allowedIPC` from the header.

**Evidence for the closure:**
- Tests were written before the change. `pluginListWrites.svelte.test.ts` has 137 tests. Against the previous commit's
  `plugins.svelte.ts`, `v3.svelte.ts` and `en.ts`, loaded through a scratch load hook with no tree edit, 114 fail and the
  23 guards pass (Gate 2's swap gave the same figures). `pluginListMerge.test.ts` has 50 spec tests for the new module.
  EXECUTED.
- Mutants on the destructive paths: all that could lose data were killed. **Two mutants survived, judged by the Gate 2
  reviewer not to lose data:** an `await` inside the apply step, and `setDatabaseLite` writing its other keys before the
  prompts.
- Full suite: 286 files, 5600 passed, 4 skipped. `pnpm check`: 0 errors, 0 warnings. `pnpm build`: ok.
- Gates: Gate 1 (`opus-reviewer`) round 1 `[REJECT]`, round 2 `[REJECT]`, round 3 `[EDITORIAL]`; Gate 2
  (`opus-reviewer`, a fresh reviewer) round 1 `[EDITORIAL]`, round 2 `[APPROVE]`; then the commit message check
  `[EDITORIAL]` (ledger rows 619 and 620).
- **Live, in the built app** (EXECUTED by the Orchestrator; Chromium in the desktop app's pane, synthetic plugins and
  data, UI in Korean; scratch Node server on port 6011): a plugin updating itself from 1.0.0 to 1.1.0 through
  `setDatabaseLite` with the whole list gave one prompt naming it and both versions. Declining left the list unchanged
  and the plugin received a "declined" rejection. Accepting kept its saved value, gave the new argument its default,
  restored its allowed IPC from the header and left the other plugin (off, with a saved value) unchanged. Re-import
  kept a saved value and the off state. A `setDatabase` round trip of the whole list kept both plugins with no prompt.
- **Not run:** a real third-party self-updater in the app; `//@update-url` fetches; hot reload; concurrent calls; a
  plugin updating another plugin; Firefox, WebKit, Android and Tauri.
- **Informational (not a defect):** under invariant I8 of the plan (`plan-64-v2.md`, a session gate record in the
  scratchpad, not a repo file), a `setDatabaseLite` call that asks about plugin changes writes its other keys,
  `characters` included, only after the prompts are answered, as `setDatabase` already did.
- **Left open from this work:** CHORE-65 (plugins reading and changing each other's saved arguments, and V2.1 plugins
  editing the list directly) and CHORE-66 (the wiki's plugin pages describe the previous behaviour).

**Filing record (2026-10-02, before the investigation; superseded where the corrections above say so):**

- **What happens (the plain-list case EXECUTED by the reviewer; everything else TRACED by the Orchestrator and the
  fact-check):**
  - `plugins` is in `allowedDbKeys` (the array starts at `src/ts/plugins/plugins.svelte.ts:558`; `'plugins'` is `:565`).
  - **V3's `getDatabase`** (`src/ts/plugins/apiV3/v3.svelte.ts:877-890`) first asks the `'db'` permission
    (`getPermission('db', 'periodically')`, `:878`; it returns null if refused), then builds a `$state.snapshot` of
    each `allowedDbKeys` key, `plugins` included. V3's `setDatabase` wraps the V2 one (`:865`). **V2's `getDatabase`**
    (`plugins.svelte.ts:769`) is a **live proxy** over the database, not a snapshot, and has no permission gate.
  - In the V2 `setDatabase` (`plugins.svelte.ts:885`), the `plugins` key is replaced by
    `await handlePluginInstallViaPlugin(newDb.plugins)` (`:898`) and then assigned to `db.plugins` (`:909-910`; read at
    HEAD `cfa4dfa0`). A console warning is printed first.
  - `handlePluginInstallViaPlugin` (`:1081`) returns **only** the plugins that are not already installed (same name and
    same script) and that the user confirms. An installed plugin is skipped with a console warning, so it is not in the
    returned list. A new plugin that is not API version 3.0 is skipped too (`:1087-1090`, from the fact-check).
  - So a `plugins` list that holds only installed plugins gives an empty list, and `db.plugins` becomes empty. There is
    no prompt about the deletion, because nothing is new (a permission prompt can still appear for V3's `'db'` read).
  - **EXECUTED (G3), the only part that was run:** in a scratch test on the real `plugins.svelte.ts` V2 API object at
    HEAD `197ed08b` (mocked environment, svelte 5.56.8, happy-dom), a **plain list** `[A (with a saved argument
    {key:'secret'}), B]` given as `setDatabase({ plugins: snapshot }, 'C')` left `plugins` as `[]`. It did not run V2
    `getDatabase()` or V3 end to end.
- **Reach (TRACED, not run):** a V3 plugin that has the `'db'` permission and passes its `getDatabase()` snapshot
  back to `setDatabase` with the `plugins` key in it; a V2 plugin that passes `setDatabase` an object whose `plugins`
  list is the installed list (for example the live proxy `getDatabase()` returned); either way, any caller whose
  `plugins` list holds only installed plugins. It removes every plugin and its saved arguments, API keys included.
  Whether the emptied list then reaches the save file was not run (INFERRED: the function ends by calling the store's
  `setDatabase(db)`, `:916`).
- **Uncertain:** unknown whether any published plugin does this (not surveyed). *Superseded: see the corrections above
  and `MC-163` 12.*
- **Not decided:** the merge rule. The reviewer's likely shape is "installed plugins kept, confirmed new ones
  appended". That is a design call and the maintainer's; **the maintainer has not been asked.** A fix touches the plugin
  API's `setDatabase` contract, so a plan needs an upstream-compatibility check (`MC-011`). *Superseded: the
  maintainer decided the rule on 2026-10-02 (`MC-163` 1).*
- **Related:** CHORE-53 (found in its stage 53b gate); ledger row 610; `MC-163`; CHORE-65; CHORE-66; ledger rows 618 to
  622.

### CHORE-65 — Plugins read and change each other's saved arguments, and V2.1 plugins edit the plugin list directly through the `getDatabase` proxy (DATA LOSS (V2.1 proxy route); no prompt; the unprompted write EXECUTED in a scratch test, the removal TRACED)

**Status (2026-10-02, later): low priority**, at the maintainer's word (`MC-165` 3: "old V2.1 plugins are getting
rare, so I think it can be marked as low priority."). It stays open and not scheduled.

**Status (2026-10-02):** open, **not scheduled**. Filed from CHORE-64 at the maintainer's decision (`MC-163` 4 and 7:
"Separate ticket (Recommended)" for each). Type: unprompted reads and writes of saved plugin settings, API keys included, and **DATA LOSS through the V2.1
proxy route**: V2.1 plugins can still delete or replace installed plugins through the proxy (the set trap, splice and
in-place edits), with no prompt. c1, c4 and c5 EXECUTED the unprompted write; the removal case is TRACED. Labels: EXECUTED = run in the investigator's scratch harness (ledger row 618); TRACED = read in source.

- **Cross-plugin arguments (EXECUTED e3):** `getArg('Other::k')` reads and `setArg('Other::k', v)` writes another
  plugin's saved argument (`realArg`) with no prompt, API keys included. Both are exposed to V3 as `getArg` and
  `setArg`.
- **The V2 proxy (EXECUTED c1, c4, c5):** through the live proxy that the V2 `getDatabase()` returns, the set trap, `push`
  and in-place edits of `plugins` write with no prompt. Only V2.1 plugins reach the proxy, and the importer refuses new
  2.1 installs.
- **Not scheduled:** a fix needs a survey of the plugins that share settings. That survey has not been done.
- **Related:** CHORE-64 (`48f00223` closed the `setDatabase` and `setDatabaseLite` paths); `MC-163` 4 and 7; `MC-011`
  (upstream compatibility); ledger row 618.

### CHORE-66 — The wiki's plugin pages describe the plugin-list behaviour from before CHORE-64

**Status (2026-10-02):** open, **not scheduled**. Documentation. `docs/wiki/**` belongs to the Wiki session, so the
maintainer chose to record this as a ticket. The `48f00223` commit message says the pages are not part of that change.
The line numbers are those the Gate 2 reviewer found on 2026-10-02 (ledger row 620); they were re-verified by
`doc-verifier` on 2026-10-02.

- `docs/wiki/Plugin-Docs.md`, around line 82: describes an install by `setDatabase` as one confirmation per plugin,
  with the old rule.
- The same page, around line 126: says `setDatabase()` and `setDatabaseLite()` "have no consent prompt at all". That is
  still true of permission gating, but it is misleading now that plugin-list changes prompt.
- `docs/wiki/Plugin-API-Reference.md`, around lines 88 to 89: says `setDatabaseLite` merges directly and that
  `setDatabase` confirms each new plugin.
- The same page, around line 178: calls `installPlugin` a thin wrapper of the `setDatabase` flow.
- **What the pages need to say:** the rule is `MC-163` 1 to 10 and the `48f00223` commit message. `plugins.md` and
  `risuai.d.ts` already describe the merge as a difference from upstream.
- **Related:** CHORE-64; `MC-163`; the Wiki session's lane (`docs/wiki/**`).

### CHORE-67 — Existing tests that run DOMPurify under happy-dom may pass for the wrong reason (test reliability; RUN under happy-dom 20.1.0; the cause TRACED)

**Status (2026-10-02):** open, **not scheduled**. Filed from the CHORE-63 stage B investigation at the maintainer's
decision (`MC-166` 6: "File CHORE-67 (Recommended)"). Type: test reliability; no product code is involved. Labels:
RUN = executed in the investigation; TRACED = read in source.

- **What was found (RUN; ledger row 627; `chore63\stageB-inv\q2b.out.txt` in the session scratchpad, not a repo file):**
  under happy-dom 20.1.0, DOMPurify stops sanitising after the first node it removes. The input
  `<p>a</p><script>1</script><img src=x onerror=e()>` came back with `onerror` still on the `img`.
- **The cause (TRACED):** happy-dom's `NodeIterator` has no handling for a node removed during iteration. Real Chrome
  sanitises the same input correctly.
- **Why it matters:** a test of the app's own HTML cleaning that runs under happy-dom and expects a removal may pass
  for the wrong reason.
- **Blast radius:** not enumerated. Most test files that import `parser.svelte` mock it (`vi.mock`) and so never run its
  DOMPurify; the exposed set is the tests that run the real parser or DOMPurify under happy-dom. TODO(evidence): which existing tests depend
  on a DOMPurify removal under happy-dom has not been counted.
- **What the ticket asks (the option text the maintainer selected):** find which existing tests rely on DOMPurify
  removals under happy-dom and make them trustworthy.
- **Related:** CHORE-63 stage B (the card body does not use DOMPurify because of this evidence, `MC-166` call 1); ledger
  rows 627 and 628; `MC-166` 6.

### CHORE-68 — CHORE-63 stage C: embed the app's own images from inside a message into the "Copy as card" card

**Status (2026-10-02):** open, **not scheduled**. Filed at the maintainer's decision (`MC-166` 4: "Ticket it for later
(Recommended)"). Type: feature; no persisted data is involved.

- **What it would do:** the card from CHORE-63 stage B leaves out every image in a message except an outside web image,
  which stays a link (`MC-165` 2). Stage C would embed the app's own images (stickers, inlay images, assets) into the
  card, shrunk and size-capped. The stage B investigation's list of the forms: a local `/sw/img/` address, a Tauri asset
  address, `data:` and `blob:` inlays. They would be downscaled with a byte budget and timeouts; outside images would
  still stay links.
- **Not decided:** the budget figure, the downscale size and the timeouts. TODO(evidence): none is recorded.
- **Constraint from stage B:** the card must never load an image through the live document, and the app fetches no outside
  host (`MC-165` 2). Stage B's tests carry a guard that the live document creates no card node.
- **The card works without it** (the option text the maintainer selected).
- **Related:** CHORE-63 (stage B, `7ca8f2a9`); `MC-165` 2 and 6; `MC-166` 4.

### CHORE-69 — The plain Copy button copies the message's raw text, including the thinking section and hidden blocks as raw markup

**Status (2026-10-03, UI session): DONE 2026-10-03 in `0651493b`** (ledger rows 816 to 832). Decided in `MC-203` 1: the
plain Copy button leaves out closed `<Thoughts>` sections only; markdown, hidden HTML and inlay tags stay. If only thinking
remains, the message is copied unchanged. Copy as card and its `text/plain` companion are unchanged, so the companion
still includes the thinking text (CHORE-92). The rejected-avatar-icon follow-up (the sender icon shows the loading
placeholder when its image rejects) is also done in `0651493b` (ledger rows 817 and 823 to 830); its sibling blocks are
CHORE-90.

**Status (2026-10-02):** open, **not scheduled**. Filed at the maintainer's decision (`MC-166` 5: "File a ticket
(Recommended)"). Type: surprising output; no change now, and no persisted data is involved.

- **What happens (RUN; stage B investigation, question 1; ledger row 627):** the plain copy writes the parsed original
  message. `risuChatParser` called with `visualize: true` returns the thinking section as `<Thoughts>…</Thoughts>` and
  hidden blocks as raw markup, verbatim. So a plain copy of such a message includes them as text.
- **What the ticket asks:** decide what the plain copy should leave out. The card already leaves out hidden and
  collapsed content (`MC-165` 5); the plain copy does not, and the option "It's fine as is" was not chosen.
- **Not decided:** which parts the plain copy leaves out.
- **Related:** CHORE-63 (stage A, `d013e7cf`, wrote the plain copy; `MC-160` 3: a tap copies plain text); `MC-166` 5;
  ledger row 627.

### CHORE-70 — Startup installs a save that only partly decodes, without checking whether a backup is complete (silent missing characters; decode RUN, boot path TRACED)

**Status (2026-10-02):** open, **not scheduled**. Filed at the maintainer's decision (`MC-167` 9: "File a ticket
(Recommended)"). It belongs to the CHORE-59 family (recovering from partly damaged saves). Type: data loss candidate,
silent. Nothing changes now.

- **What happens (the decode RUN, ledger row 636; `chore55\decode\results.md` in the session scratchpad, not a repo
  file):** with an empty `risuSaveCache`, a non-strict decode of a main file cut at a block boundary after the root block,
  or at length minus 1, returns a tree with characters missing and does not throw. With a populated `risuSaveCache`
  (a same-generation cache only was tested) the same cuts decode to a full tree. A strict decode throws for every cut
  except the full file. The cuts that always throw are listed in CHORE-55's block.
- **The boot path (TRACED; the writer read `src/ts/bootstrap.ts:419-455` at HEAD `71e75d9d`):** `decodeMainFile` tries a
  strict decode and falls back to a non-strict decode when it throws; its comment (`:419-424`) says the fallback tree
  "may be missing blocks" and never goes through the archive pass. `resolveArchiveOutcome` returns `install` for a
  non-strict tree (`:452-455`). So the startup uses the partial tree as-is. That the next save then keeps the loss is
  INFERRED, not traced. The question put to the maintainer (the Orchestrator's text) said that this happens "on every
  platform"; the maintainer only answered "File a ticket (Recommended)". The Orchestrator traced both boot branches at `71e75d9d`: the Tauri branch (`src/ts/bootstrap.ts:124-125`) and the
  other branch, which web and Node share through `forageStorage` (`:198-204`), both call `decodeMainFile` and then
  `resolveArchiveOutcome`, and fall back to backups only when the outcome is not an install.
- **After CHORE-55 stage 0:** a write cut off by a crash no longer leaves a partial file, so only disk damage would cause
  this. It would still be silent.
- **What the ticket asks, and does not decide:** what startup should do when a save decodes only in part. The two examples
  the question gave: offer the newest complete backup, or load the partial save and say what is missing. Not decided.
- **Not in scope:** the advisor recommended leaving the non-strict install policy alone inside CHORE-55; it belongs here.
- **Related:** CHORE-55 (stage 0); CHORE-59 (the same family); `MC-167` 9; ledger rows 633 and 636.

### CHORE-71 — The plugin overwrite guard walks every chat in live memory on each in-place plugin `setItem`, and keeps a proxy for each (performance and memory; measured on best-case hardware)

**Status (2026-10-02):** open, **not scheduled**, **LOW priority**. Filed at the maintainer's decision (`MC-170` 6: "Keep it,
file an index ticket (Recommended)"). Type: performance and memory.

- **What happens (measured with `--expose-gc` on best-case hardware, an i9-class machine; the guard added by `59881788`,
  CHORE-52):** a plugin `setItem` that reuses an existing slot walks every chat in live memory to find other
  links to the slot's archive. The first pass creates Svelte proxies for every chat, and they are retained for the life of
  the page. The figures:
  - about 16 MB at 1000 characters with 4 chats each, and about 70 MB at 1000 characters with 20 chats each;
  - about 7 ms per write once warm at 1000 x 4, and about 23 to 58 ms for the first pass.
- **With archiving on (the default),** a stub holds about one chat, and the cost is about 1 to 2 ms. **This is an
  estimate, not a measurement:** the Gate 2 stage A reviewer's figure from the one-chat-per-stub shape.
- **What the ticket asks:** a cheaper way to find links to an archive. Direction (non-normative): a link index that keeps
  the plan's A2.3 behaviour, that the decision reads the database as it is when the write is decided.
- **Best-case hardware only:** every figure above is from one best-case machine; they are not a result for slower devices.
- **Related:** CHORE-52 (the guard); `MC-170` 6; ledger row 647.

### CHORE-72 — A local backup restore writes an entry whose name does not match the cold-storage key pattern to `assets/<name>` (integrity; not traced)

**Status (2026-10-02):** open, **not scheduled**, **LOW priority**. Found while CHORE-52 was investigated and planned. Needs
an investigation before anything is decided.

- **What the CHORE-52 investigator found (not opened by the Orchestrator):** in the restore in `backuplocal.ts`, an entry
  whose name does not match the cold-storage backup key pattern (`getColdStorageBackupKey`, UUID-gated) falls to the
  non-cold-storage branch and is written as `assets/<name>`. It is the only other place an archive-supplied name reaches a
  storage path besides the cold-storage key functions CHORE-52 now guards.
- **Not traced, and the ticket's first question:** what a crafted entry name could write there. The `assets/<name>`
  fallback was left out of CHORE-52. No line number is cited, because the file was not opened for this record.
- **Related:** CHORE-52; `MC-170`.

### CHORE-73 — On a Windows desktop, a chat whose pointer names a unit in a `coldstorage` folder that does not exist reads "unreadable" instead of "missing"

**Status (2026-10-02):** open, **not scheduled**, **LOW priority**. Type: wrong message. Found at CHORE-51's Gate 2 round 1.

- **What happens:** on a Windows desktop, a read of a file inside a folder that does not exist fails with "os error 3",
  while a missing file in an existing folder fails with "os error 2". `classifyTauriColdRead` classifies anything other than
  os error 2 as `error`, so the first reads `error`, not `missing`. So `preLoadChat`, the legacy retry and the backup show
  the "unreadable, try again" text for such a chat instead of "missing".
  - **Confidence:** the two error codes are TRACED (the Gate 2 stage B reviewer compiled and ran Rust's `std::fs::read` on
    Windows). That tauri-plugin-fs passes that text through is INFERRED. That `classifyTauriColdRead` treats anything other
    than os error 2 as `error` is TRACED (its code and doc).
- **What CHORE-51 did and did not do:** the manual clean-up has its own narrow rule (the load-time listing held no unit and
  the folder check reports the units folder absent), so the clean-up is not blocked. It did not change
  `classifyTauriColdRead` or the other consumers.
- **What the ticket asks:** decide whether those consumers should read the missing folder as "missing". Not decided.
- **Related:** CHORE-51; the note under CHORE-51 about `coldStorageCleanupSaveUnreadable` could be folded in; `MC-170` 1.

### CHORE-74 — The `.bin` export warns when the backup holds plugin data that upstream will not restore

**Status (2026-10-03):** open, **not scheduled**; **not a release item**: the maintainer said it should not be a release
blocker, because it is upstream behaviour, and that the warning is a later quality-of-life item (`MC-177` 1). This
replaces the Orchestrator's earlier reading of `MC-089` for this ticket. Type: a small UI change. Filed at the
maintainer's decision (`MC-176` 2: "Accept, warn at export"). Priority: LOW (`MC-176` 3).

- **What happens today:** upstream's `.bin` import restores a cold-storage unit only when it is an array or an object with
  a `character` or `message` key (upstream `isColdStorageBackupData`, the Orchestrator verified it in
  `src/ts/process/coldstorageData.ts` at `upstream/main` `f9728b14`). v3 plugin storage values of any other shape are lost
  there, and upstream's confirm calls them items that "could not be linked to a character". The fork's export carries
  them, so it is the fork -> upstream direction that loses them (ledger row 697; RUN, with the real code of both trees on
  a mocked web store). Upstream's own export shows an "incomplete backup" confirm for these units; the fork's export
  shows nothing for them.
- **Why it matters:** the compatibility invariant is a two-way `.bin` round trip (`MC-175`). The maintainer decided the
  loss is upstream's own limit and does not count against the invariant (`MC-176` 1), so the fork cannot remove it. The
  fork can tell the user.
- **Acceptance (the mechanism is non-normative):** when an export includes v3 plugin storage units that upstream would not
  restore, the user is told before or when the export finishes, in plain words: the plugin data will not come back if this
  file is loaded into upstream RisuAI, and it does in this app. The export bytes do not change. The new English string
  goes in with its call site; the translations go to `translator`. Gated as usual (`AGENTS.md` section 4).
- **Not in scope:** upstream's own export losses (B1, non-`.png` assets; B2), device-local stores, and an encrypted `.bin`
  (`MC-081`).
- **Related:** `MC-175`, `MC-176`, `MC-081`; CHORE-55 (the round-trip note under its stage 2b block); ledger row 697.

### CHORE-80 — Idea (feature / QOL, not a bug): read an API key from an environment variable instead of storing it in the save file (unscheduled; not investigated)

**Status (2026-10-04, side session): DONE in three stages, `7aeabdf9`, `aa6e442a` and `f38b503c`** (ledger rows 1123, 1129, 1132,
1133, 1137, 1141, 1143, 1145 and 1147 to 1176; `MC-220`). The maintainer took it, with the design answers recorded in
`MC-220` 3 and 4. An API-key field whose whole trimmed value is `${NAME}` is a reference to an environment variable on the
machine that runs the Node server or the desktop app. It is resolved at use time, and never written to the
database, a save, a backup or a preset. On the Node server the route accepts the server password or a signed `risu-auth` login, so anyone who can sign in may use it. Only names of the form `RISU_<name>_KEY` or `RISU_<name>_TOKEN`, and names listed in
`RISU_ALLOWED_ENV`, resolve; the server and the Rust command enforce that, not the browser. The pure web build answers "not
supported". Any other value is used exactly as typed. No save format or `.bin` change (`MC-175`).
- **Merged (2026-10-04, Main Campaign):** into `fix/persistence-conflict-platform-hardening` as `ddd47655` (ledger row 1068). Not pushed.
- **Stage 1, `7aeabdf9`:** the resolver, the Node route `/api/env-secret`, the Tauri command `read_env_secret`, a tripwire that
  makes `globalFetch` and `fetchNative` refuse a request carrying a whole reference (they are plugin-reachable, so they never
  substitute), redaction of resolved values in the fetch log, and the chat providers. A plugin that sent a header or URL query
  value that is a whole `${UPPERCASE}` token now gets a refusal instead of the literal (the commit's PLUGIN-VISIBLE CHANGE).
- **Stage 2, `aa6e442a`:** the remaining key readers: TTS, image, speech to text, translator, tokenizer, model lists and the
  memory key reads (the lane grant, `MC-220`). A card's OpenAI TTS base URL that is not `api.openai.com` refuses a referenced
  `db.openAIKey` fallback. `hypav2.ts` returns `retryable:false` for an unresolvable reference (the scope amendment, `MC-220`).
- **Stage 3, `f38b503c`:** `TextInput` shows a whole reference as text and keeps a real key masked; one note on the model tab
  of Bot Settings (`settingsPage.apiKeyEnvRefNote`) says what a key field accepts; `errors.secretRefUnavailable` also names a
  refused request.
- **Gates:** plan `[REJECT]` twice, then `[EDITORIAL]`. Stage 1 code `[REJECT]` (plugin-safety tests that were vacuous,
  test-only), then `[EDITORIAL]`. Stage 2 code `[REJECT]` (the Fish and WaveSpeed model lists were not migrated), then
  `[EDITORIAL]`. Stage 3 code `[REJECT]` (a delegated write-back missed non-bubbling input events), then `[APPROVE]`.
- **Checks:** `pnpm test` 447 files, 8702 passed, 4 skipped before stage 1; 450 files, 8819 passed before stage 2; 452 files,
  8825 passed before stage 3; `pnpm check` 0 and 0 and `pnpm build` ok for each. `cargo test env_secret` 9 passed. The Rust
  command was not run inside a Tauri app.
- **Known and left (each from the commit messages or the wiki packet, none fixed here):**
  - The dynamic Google, Anthropic and OpenAI model lists, and the Google tokenizer, give the user no message for an
    unresolvable reference; a failure is only logged to the console (the tokenizer falls back to the local tokenizer).
  - With `googleClaudeTokenizing` on, a Gemini model and an unresolvable reference, the tokenizer requests the reference again
    on every uncached encode, because failures are not cached.
  - WaveSpeed's result request sends the key to a URL taken from the provider's own response. A plain key already does the
    same.
  - A changed Vertex PEM keeps using the token already minted from it for up to 3500 s, or until the page reloads. The 5-minute cache per name only controls how soon a changed variable is picked up.
    **Correction to the stage 1 commit message (from the Wiki session, checked in source):** a resolved value is held in page memory until the page reloads, because `resolveSecret` registers it for log redaction in a module-level map that only `resetSecretRefState` clears.
  - **V2.1 plugins and allowed variables.** An already-enabled V2.1 plugin runs in the main page and can reach both the route
    and the command, so the exposure is plausible and not prevented: it could read a variable the name rule allows, including
    ones never typed into the app. V2.1 code passes through `checkCodeSafety`'s identifier rewrite, which does not cover `fetch`
    or the Tauri internals (ledger row 1175; V3 plugins cannot). The maintainer chose to document it and make no code change (`MC-220` 7); it is in the wiki
    packet.
  - **The note's name rule is slightly loose.** The committed `f38b503c` message and the shipped note say a name in the middle
    is required. The pattern is `RISU_`, then zero or more of A-Z, 0-9 or `_`, then `_KEY` or `_TOKEN`: `RISU_KEY` itself is not
    read, but `RISU__KEY` is, with an empty middle. Harmless.
  - **Native review is wanted for the new note in ko, cn, zh-Hant, vi and es** (the translator flagged the word for "build" and
    some phrasing).
- **Wiki:** the CHORE-80 wiki packet is handed to the Wiki session (row 1176). This session did not edit `docs/wiki`.

**Superseded by the status above (history):** **Status (2026-10-04):** open, **not scheduled**, **not investigated**. This is a feature idea, not a defect. The maintainer
said it can go in "maybe later section" (`MC-190`). It is not placed in the work order; the maintainer places it.

- **The idea (the maintainer's, `MC-190`):** an API-key field may hold a reference such as `$OPENAI_API_KEY`. The app resolves
  it from an environment variable, so the key itself is not stored in the save file. Quoted from the maintainer, 2026-10-04:
  "I think I have found another potential QOL improvement that can go into maybe later section. environment variable support
  in API keys. Best practice for API key is to store keys in environment variables, under names such as OPENAI_API_KEY. so
  instead of holding whole API key in the save file, we can let this app to load API key through environment variable with
  unique syntax like `$OPENAI_API_KEY`."
- **Open questions for planning** (the Orchestrator's preliminary questions, **unverified against code**; nothing here is
  decided):
  - **(a) Platform scope.** A browser page has no environment variables. The pure web build cannot read them; only the Tauri
    desktop process and the Node or Hono self-hosted server can (the Node server today reads only `PORT` and `TRUST_PROXY`;
    the Hono server reads none). On the hosted build the key would have to be resolved
    server-side. Decide whether the key may ever reach the browser, or whether the server must substitute it into the outgoing
    provider request so it never leaves the server. That depends on whether provider requests on that build go
    browser-direct or through the server: TODO(evidence).
  - **(b) Which fields.** Provider API keys only, or also other secrets (custom endpoint keys, plugin-provided keys, TTS and
    image-generation keys)? TODO(evidence): where each of these is stored and read.
  - **(c) Syntax.** `$NAME` versus an explicit form. What happens when a reference names a variable that is not set (a clear
    error, never sending the literal text)? And can a real key begin with `$`?
  - **(d) Compatibility (`MC-175`).** A `.bin` containing `$NAME` imported into upstream would send the literal text to the
    provider: an authentication failure, but no data lost. Backups and exports would no longer carry the real key, which is
    the point, but a restore on another machine needs the variable set there. (Reasoned, not run.)
  - **(e) Security on the hosted build.** The hosted build is meant for private LAN or VPN use only, with barebones
    security by design (`MC-191`). Should any client that can reach the server be able to make it spend a server-held key?
    Still open. Answered: `MC-220` item 3.
- **Next step:** when it is scheduled, open with an `investigator` pass on where API keys are read and how provider requests
  are routed on each platform (web, Tauri, Node and Hono server). Nothing is decided.
- **Placement:** unplaced; the maintainer places it.
- **Related:** `MC-190`, `MC-191`, `MC-175`, `MC-143`.

### CHORE-81 — Tauri launch inputs are dead code: the desktop app ignores files opened with it and deep links (TRACED, not run)

**Status (2026-10-04, side session): DONE in `04484500`** (ledger rows 1122, 1126, 1127, 1131, 1135, 1136, 1138, 1144, 1146;
`MC-220` 2: the maintainer chose to fix both file opening and deep links and granted `main.rs`). The scoping confirmed the
trace below and found the cause upstream: the Rust half that set `window.tauriOpenedFiles` was removed in `a92545cd`, and
`characterURLImport()` was always in the non-Tauri branch of `loadData` (ledger row 1122). Now a new Rust module
`launch_inputs.rs` classifies the command-line arguments (existing `.risum`, `.risup` and `.charx` files, and
`risutaniumlocal:` and `risuailocal:` links); `main.rs` queues them behind a `take_launch_inputs` command, queues a second
instance's arguments and emits `risu-launch-inputs`, handles macOS `RunEvent::Opened` (untested), and adds each queued file to
the fs scope. `desktopLaunch.ts` listens, drains the queue and imports through the new `importOpenedFiles` in
`characterCards.ts`; Realm links go to `downloadRisuHub`. `bootstrap.ts` calls it once first setup is done. The dead
`tauriOpenedFiles` and `onOpenUrl` blocks are removed; the web and PWA paths are unchanged. A restart does not re-import the
same file (a consumed marker in the environment). No save format or `.bin` change. `importOpenedFiles` lives outside
`characterURLImport`, which the Main Campaign's grant text names.
- **Merged (2026-10-04, Main Campaign):** into `fix/persistence-conflict-platform-hardening` as `ddd47655` (ledger row 1068). Not pushed.

- **Gates:** plan `[REJECT]`, then `[EDITORIAL]`. Code `[EDITORIAL]` (the marker leaked into spawned processes; fixed, plus
  labels), then `[APPROVE]`.
- **Checks:** `cargo check` passed; `cargo test launch_inputs` 10 passed (resolved tauri 2.12.1, tauri-plugin-fs 2.6.0); with
  CHORE-88's commit, `pnpm test` 442 files, 8524 passed, 4 skipped; `pnpm check` 0 and 0; `pnpm build` ok.
- **Not run on a Tauri build:** cold start with a file, a second instance, a relaunch, deep links, macOS `Opened`, and the
  mobile compile. Only the Rust unit tests and the JS tests ran. The "Not known" items below that depend on a desktop run are
  still not observed.
- **Known gaps (from the commit message):** if `request_exit` fails, tauri restarts without running the exit callback, so the
  argv file may import once more; a file opened before first setup completes is not imported in that process; the queue is
  emptied when the page takes it, so an import that fails is reported and not retried.

**Superseded by the status above (history):** **Status (2026-10-04):** open, **not scheduled**. Severity: not assessed. Filed from the step 6 audit (ledger row 1018, R6),
re-checked by the Orchestrator against source.

- **What was traced:** `characterURLImport()` in `src/ts/characterCards.ts` has one caller, inside the web branch of
  `loadData` in `src/ts/bootstrap.ts`. The Tauri code that follows it (`tauriOpenedFiles`, `onOpenUrl`) therefore never
  runs, and `window.tauriOpenedFiles` is never set anywhere. So a file opened with the desktop app, and a deep link, are
  ignored. TRACED in source, not run on a desktop build.
- **Why it came up:** the idle reload's design had assumed these launch inputs would run again after `relaunch()`. They do
  not run at all.
- **Not known:** whether upstream has the same shape: TODO(evidence). Whether the desktop app is meant to handle these
  inputs at all, and what a user sees today: TODO(evidence).
- **Related:** ledger row 1018; `MC-193`.

### CHORE-82 — Backup loads do not wait for an import or an asset add that is still writing (TRACED in review, not run)

**Status (2026-10-04): DONE in `148924b0`** (ledger rows 1032, 1034 to 1037; `MC-194` 7). Both backup loads (`loadInternalBackup` and `LoadLocalBackup`) and the two Settings buttons that start them now refuse while any registered action runs or any choke-point write is in flight, not only while chat work runs: `refuseBackupLoadWhileBusy` in `src/ts/drive/backupWorkGuard.ts` reads the busy registry and the choke-point counters, and a load passes its own registered entry so it does not refuse itself. The covering decision is `MC-129` 4 (a restore while "work is in progress" is refused with a message to wait or stop it first); the commit message takes the wider list of work kinds from it and from the gate record's invariants, not from this entry's "an import or an asset add". The maintainer chose "Widen the existing text (Recommended)" for the refusal message `backupLoadWorkInProgress`, changed in all seven locales (the first clause only). No save format or `.bin` change (`MC-175`).
- **Known limits (from the commit message):** the checks cover work registered before them, so work that starts during the `writeMainFile` await is not refused (chat work already had the same window); a plugin that keeps a long request open would refuse every backup load until the request ends or the page reloads (suspected in review, not reproduced); a load refused after its asset and cold-storage writes from a `.bin` file leaves those assets written.
- **Gates:** plan gate skipped under the small-and-low-risk carve-out (the Gate 2 reviewer judged that justified). Gate 2 (`opus-reviewer`) `[EDITORIAL]` twice (a test mislabelled as a regression test; the commit message). Checks: `pnpm test` 419 files, 8286 passed, 4 skipped; `pnpm check` 0 and 0; `pnpm build` ok. How reachable the case is from the UI was not measured (commit message).

**Superseded by the status above (history):** **Status (2026-10-04):** open, **not scheduled**. Severity: not assessed. Filed from step 6a's Gate 2 (round 1, N3; ledger
row 1021).

- **What was found:** `refuseBackupLoadWhileBusy` (`src/ts/drive/backupWorkGuard.ts`) does not read the step 6a busy
  registry (`src/ts/process/memory/busyActions.ts`). A backup load replaces the whole database under an import or an asset add
  that is still writing. 6a left it unchanged on purpose and the Gate 2 reviewer found that consistent with the plan.
- **Not known:** what a user would lose or see if it happens, and how likely it is to be reachable in practice: TODO(evidence).
- **Related:** `cd26764d`; ledger row 1021.

### CHORE-83 — Every boot writes the main file, a numbered backup and about 507 block-cache entries even when nothing changed (measured on an i9)

**Status (2026-10-04):** open, **not scheduled**; partly addressed by `f04068f1` (the main-file write and the numbered backup; the block-cache puts stay open, see the update below). Priority: LOW to MEDIUM (the Orchestrator's assessment, not the maintainer's); it matters most on phones. Filed from the step 7
measurements (Part A, items 1d and the anomalies list; ledger row 1023).

- **What was measured:** on the real2-shaped synthetic profile, a later boot writes the main file (about 43.4 MB) plus a
  numbered backup (another 43.4 MB) and 507 block-cache entries (about 49 MB), with nothing changed. The same happens with
  archiving off (the "off" run), so it is not caused by the archive pass. Which code path issues these writes was not traced:
  TODO(evidence). On cd26764d the harness's cache-write counter for the encoder's first pass read 0, which is unexplained
  (not a ticket, see ledger row 1024).
- **Not known:** the cost on a phone, and whether upstream does the same: TODO(evidence).
- **Update (2026-10-04, Stage 0 (i)+(iii), `f04068f1`; ledger rows 1054, 1063 to 1067):** the Stage 0 investigation traced the boot main-file write to the first-run `markChanged(false)` (row 1054), which settles the "which code path" question above. `f04068f1` makes the save loop skip a main-file write when the bytes provably equal what storage holds, and makes a boot that skips take a numbered backup only when the backup-fingerprint record does not name the main file. So the main-file write and the numbered backup at an unchanged boot are addressed. The roughly 507 block-cache entries were not part of that change (the investigation recommended leaving the block-cache puts alone). Not re-measured since: TODO(evidence). Skipping is decided by a SHA-256 comparison that needs a secure context; on plain HTTP the boot still writes as before (`MC-143`).
- **Related:** ledger row 1023; `MC-193`.

### CHORE-84 — The page-load listing of stored units and assets is awaited before plugins and costs about 3.7 s at 350,000 asset keys (measured on an i9)

**Status (2026-10-04):** open, **not scheduled**. Severity: not assessed. Filed from the step 7 measurements (Part A, item 6;
ledger row 1023).

- **What was measured:** D11's page-load listing is two full `keys()` listings (units, then assets) and is awaited before
  `loadPlugins`. With one-byte placeholder values and the real2 key count (350,350 keys) it took 3.65 to 3.83 s, so a later
  boot's time to `loadedStore` went from about 0.5 s to about 4.2 s. At 50,000 keys it took 535 ms. The test measured key
  count only, not value reads.
- **Not known:** the cost with the real 36 GB asset store, and on a phone: TODO(evidence).
- **Related:** ledger row 1023; `MC-193`.

### CHORE-85 — A browser crash within seconds of a committing boot pass can leave the pass breaker at 'one' and keep the idle reload off (LOW priority)

**Status (2026-10-04):** open, **LOW priority**, not scheduled. The maintainer asked for it: "yep. file it as low priority
ticket." (`MC-193` 11). Filed from the step 6b live check (finding 1; ledger row 1027).

- **What was seen:** in the live check, a profile copied right after Chrome was killed had not flushed the removal of the
  `archivePassStrikes` key (`src/ts/storage/bootArchiveMemo.ts`). The next boot read the D18 breaker as 'one' and the idle
  reload stayed blocked. With a graceful close after a 10 s wait the key stayed absent. It was a harness artifact; it was
  not reproduced beyond that kill.
- **Consequence if it can happen for real:** the idle reload stays off for that profile until the next committing pass. It costs
  one missed release and never loses data. SUSPECTED, not pursued.
- **Related:** ledger row 1027; `MC-193`; `MC-158`.

### CHORE-86 — Turn on the desktop idle reload after a Windows live check

**Status (2026-10-04):** open, **not scheduled**. The desktop idle reload ships off: `IDLE_RELOAD_DESKTOP_ENABLED = false` in
`src/ts/process/memory/idleReloadHost.ts` (commit `cdf700f3`, step 6b). Tauri neither reads nor writes the record and arms
nothing. Mobile Tauri has no idle-reload path.

- **Condition to turn it on:** a Windows live check that an off-screen composer draft survives an idle relaunch. The
  maintainer observed that `relaunch()` brings the app back (`MC-193` 3); nothing else of the desktop path has been run.
- **Four notes from `cdf700f3`'s message, and a fifth found in review, to carry into that work:**
  1. The boot's file medium and the controller's file medium are two instances with separate queues on one file. Use one, so
     a deferred drafts removal cannot interleave with a new record write.
  2. The desktop's rate-limit history is in `localStorage` and its record in a file. Whether the history survives
     `relaunch()` is unobserved. Losing it costs at most one extra reload inside the interval.
  3. `writeFileAtomic` puts its temp file in the AppData root, which no boot sweep covers, and the fs scope for a root file is
     unverified. Check both in the live check.
  4. The Tauri boot call site of `keepInline` is the same helper as the web one and is not separately tested.
  5. `idleReloadPlatform()` returns 'desktop' for any Tauri page once the flag is on, with no mobile exclusion. Turning the flag
     on must also exclude mobile Tauri.
- **Related:** `cdf700f3`; `MC-193`; CHORE-81 (the Tauri launch inputs are separate dead code).

### CHORE-87 — On a Node server, a main file over the 100 MiB request limit was re-uploaded without end until the tab died (measured on an i9)

**Status (2026-10-04): filed and DONE in `517f0cdb`** (ledger rows 1040 to 1047; `MC-194` 2). Type: bug (data loss risk: edits after the refusal were lost on reload). The maintainer chose "Investigate now (Recommended)", then "Size guard now (Recommended)", "Release at ~80% (Recommended)" and "Size guard first (Recommended)".

- **What was measured (the investigation, row 1040):** the real Node server, a synthetic 163 MB seed profile of 499 characters, characters opened largest-first, headless Chrome on one i9 (best-case hardware), Remote Saving off (the default). The first refusal came at about the 56th character opened. The server answers 413 before any route runs. `saveDb` treated the 413 as a generic failure and retried the full body about every 1.45 s with no cap; from the fifth attempt an error box appeared on every attempt; nothing stated a reason; the idle reload stayed blocked; the tab died in 4 of 5 refusal runs (the two crash dumps read carry Chromium's out-of-memory code); edits made after the refusal were lost on reload.
- **What changed:** when the encoded main file is larger than the limit (`NODE_BODY_LIMIT_BYTES`, 104857600, now in `src/ts/storage/nodeBodyLimit.ts`), `saveDb` throws before the quota estimate and the write lock, so nothing is acquired or sent. A 413 on any Node write before the main file commits (including a Remote Saving character block) takes the same path. It parks: one toast, `savingStoppedReason` set to `'too-large'`, `saving.state` false, and the loop sleeps (the node-conflict pattern). The tab stays unclean (`isSaveClean()` is false) and the changes are merged back into the change tracker. `SavePopupIcon.svelte` shows the message. New key `savingStoppedTooLargeMessage(limitBytes)` in all seven locales. A 413 on the numbered backup after the main file committed keeps its existing branches. No save format or `.bin` change (`MC-175`).
- **What the message does not promise:** a reload restoring saving. The Gate 2 reviewer showed that the boot archive pass archives nothing, or not enough, in reachable profiles (no `navigator.locks` on plain HTTP, `archiveCharacters` off, a V2.1 plugin, `formatversion` below 5, a paused or "too large" memo; or the bulk is outside characters, or one Remote Saving block is over the limit). The text says startup "can" move characters, only when archiving is on and able to run.
- **Not done:** (1) "Release at ~80%" (release archived characters before the limit) is a later, separate change. (2) Other main-file writers have no size check (`bootstrap.ts`, `backuplocal.ts` restore, `internalBackup.ts`); what each does with a 413 was not examined. `bootArchivePass.ts` already checks. (3) A proxy with a lower limit still gets the client's 100 MiB in the message; the text covers it with "or less if a proxy ... sets a lower limit". (4) With Remote Saving on, character blocks are written before the size check; they are content-addressed and harmless if the save then parks.
- **Gates:** plan gate skipped under the small-and-low-risk carve-out; the Gate 2 reviewer judged that borderline, because a plan review would probably have caught the recovery promise in the first message text. Gate 2 `[EDITORIAL]`, `[APPROVE]`, then `[EDITORIAL]` on the commit message. Checks: `pnpm test` 424 files, 8322 passed, 4 skipped; `pnpm check` 0 and 0; `pnpm build` ok. No live run of the final code against the real Node server is recorded.
- **Translations:** vi, de and zh-Hant are low confidence (an optional native check); in vi, "Nếu việc lưu lại dừng" loses "again" (a nit for the native review, with `MC-212`).
- **Related:** `MC-194`; `MC-046` (the Remote Saving default flip that was reverted); CHORE-46 (the Node server's 100 MB body limit, in the work order).

### CHORE-88 — Opening a module's basic-info tab, or a character's, group's or persona's settings, wrote `false` into optional flags the data did not carry

**Status (2026-10-04, side session): filed and DONE in `54b1a819`** (ledger rows 1124, 1125, 1128, 1130, 1134, 1139, 1140,
1142, 1144, 1146; `MC-220`; the Main Campaign held the CHORE-88 number; its CHORE-81 grant message of 2026-10-04 asked the side session to add this entry,
and it lists the ticket as handed to the side session). Type:
bug. Closed.

- **Merged (2026-10-04, Main Campaign):** into `fix/persistence-conflict-platform-hardening` as `ddd47655` (ledger row 1068). Not pushed.

- **What happened:** opening a module's basic-info tab, a character's settings, a group's chat list or a persona's settings
  wrote `false` into optional flags the data did not carry, without the user touching anything. For the module editor the tests
  show this marks the modules block changed, so a save is scheduled and the whole block is written again; the other screens
  write into the character, group or persona through the same reactive proxy.
- **Cause:** when a checkbox mounts with a bound value that is null or undefined, Svelte 5's `bind_checked` (svelte 5.56.8,
  `internal/client/dom/elements/bindings/input.js`, as cited in the commit message) writes the input's `checked` back into that
  value. Binding an optional boolean that the data does not carry therefore wrote `false` into it at mount, through the
  reactive proxy.
- **What changed:** the affected checkboxes use a function binding, `bind:check={() => X ?? false, (v) => X = v}`: the getter
  supplies the display default and nothing is written until the user toggles. Covered: `ModuleMenu` (`hideIcon`,
  `lowLevelAccess`); `CharConfig` (`lowLevelAccess` for a character and a group, `hideChatIcon`, `escapeOutput`,
  `largePortrait`, `orderByOrder`, `inlayViewScreen` in both places, `prebuiltAssetCommand`, `ttsReadOnlyQuoted`);
  `SideChatList` (the group's `orderByOrder`); `PersonaSettings` (the persona's `largePortrait`). Readers of these fields treat
  undefined like false, so leaving the default unwritten changes no behaviour. No save format, block format or `.bin` change
  (`MC-175`).
- **Scope:** the ticket began with `ModuleMenu`. `CharConfig`, `SideChatList` and `PersonaSettings` have the same defect (the
  Gate 2 reviewer's finding, row 1128) and were added to it (the scope amendment, `MC-220`).
- **Left on purpose:**
  - `ModuleMenu`'s tab-click defaults (lorebook and regex `??= []`, the trigger tab seeding two rows, `commitAssets([])` for
    the assets tab): a one-time normalisation that gates rendering.
  - The nested TTS config flags in `CharConfig`.
  - `utilityBot`, which is defaulted at load.
- **Tests:** against the base (the reviewer's re-run, each component swapped in through a scratch config), 14 fail in
  `ModuleMenu.assets.svelte.test.ts` (2 opening reproducers and 12 asset-tab tests), 10 in the new
  `CharConfig.lowLevelAccess.svelte.test.ts`, 1 in the new `SideChatList.orderByOrder.svelte.test.ts` and 1 in the new
  `PersonaSettings.largePortrait.svelte.test.ts`. The new toggle tests are `guard:` tests and pass before and after.
- **Gates:** no plan gate (small and well-contained). Gate 2 (`opus-reviewer`) ended `[EDITORIAL]` three rounds running
  (labels and two test-header sentences); all corrections were applied. Checks with the CHORE-81 commit: `pnpm test` 442 files,
  8524 passed, 4 skipped; `pnpm check` 0 and 0; `pnpm build` ok.
- **Related:** CHORE-81 (committed right before it; the checks ran on both together); `MC-220`.

### CHORE-89 — On the Node server, `/hub-proxy` forwards a request to any URL named in the `x-risu-node-path` header, with no authentication check (TRACED)

**Status (2026-10-04):** open, **not scheduled**; fixes are to be proposed after Stage 0 of the save-layer track. Severity: not assessed. Filed at the maintainer's "File both, extend our range (Recommended)" (`MC-194` 14). Reported by the side session's CHORE-80 investigation; verified in source by the Orchestrator, and its route code re-read for this entry at the time of writing.

- **What was traced:** `hubProxyFunc` in `server/node/server.cjs` (the `/hub-proxy/*` routes, GET and POST) uses the value of the `x-risu-node-path` request header, decoded with `decodeURIComponent`, as the URL to fetch when the header is present, and otherwise the hub URL plus the request path. It forwards the client's headers (except `host`, `connection`, `content-length` and the path header, with `origin` set to the hub's origin) and the body, follows a redirect by a second fetch, and returns the response. The function makes no `checkAuth` or `checkProxyAuth` call, unlike the `/proxy` family's handlers. The routes carry `authenticatedRouteLimiter`, which is a rate limiter (`rateLimit`), not an authentication check. The only `app.use` calls in the file are the static files and the body parsers, so no global middleware authenticates it either. Upstream origin: `0a5bae66`, 2025-11-24 (re-checked with `git log -S` at the records fact-check, ledger row 1070).
- **Consequence:** anyone who can reach the server can make it fetch an arbitrary URL and read the response. This is the shape of a server-side request forgery; whether it matters depends on who can reach the server. The hosted build is meant for private networks only (`MC-191`), so this is framed as an integrity and exposure gap on that network, not as a public-internet vulnerability. SUSPECTED, not run.
- **Not known:** whether the Hono server has the same route (TODO(evidence)); which of the app's flows send the header (TODO(evidence)).
- **Related:** `MC-194` 14; `MC-191`; CHORE-120; CHORE-80 (the side session's investigation found it).

### CHORE-90 — 13 sibling image `{#await}` blocks have no `{:catch}`, so a rejected image raises an unhandled rejection

**Status (2026-10-04, side session): DONE in `3c8a142a`** (Batch B; ledger rows 1102, 1106, 1107, 1114 to 1117, 1119; `MC-219`).
The scoping found that these promises almost never reject, so the change is hardening (row 1102). Every image or media
`{#await}` in `SidebarAvatar`, `BarIcon`, `CharConfig`, `PersonaSettings`, `OtherBotSettings`, `EmotionBox`,
`DefaultChatScreen` (the draft attachment) and `PlaygroundInlayExplorer` now has a `{:catch}`, so a rejected promise raises
no unhandled rejection and the control stays usable (the pending placeholder, or nothing where a block has no pending
branch; the draft attachment shows its stored reference and keeps the remove button). A rejection is logged once with
`console.warn`, not an error box, by the new `src/ts/warnOnReject.ts`, called inside the `{#await}` expression so that it
also runs in production builds. `getCharImage` and the other producers are unchanged.
- **Gates:** plan `[REJECT]` then `[APPROVE]` (rows 1106, 1107). Code review round 1 `[REJECT]`: the first version put the
  warning in a `{@const}` tag, which compiles to an unread derived that only dev mode evaluates (row 1115). After the
  remediation (row 1116), round 2 `[APPROVE]` (row 1117).
- **Not covered:** a production-mode mount that logs the warning (only the reviewer's scratch run showed it) and a real image
  load failure in a browser.
- **Limitation:** a producer that builds a fresh promise on each evaluation warns once per evaluation while it keeps failing.

**Status (2026-10-03, UI session):** open, **not scheduled**. Filed from the chat UI batch's rejected-avatar-icon fix
(ledger row 817). Type: error handling.

- **What happens:** the sender icon's `{#await img}` had no `{:catch}`, and a rejected image gave no icon and an unhandled
  rejection (RUN, ledger row 817). The batch fixed that one block only. Sibling image blocks without `{:catch}` remain
  in `SidebarAvatar`, `BarIcon`, `CharConfig`, `PersonaSettings` and `OtherBotSettings` (count below). Not all are
  avatars: `CharConfig` has an emotion image, `OtherBotSettings` has NAI and WaveSpeed reference images, and `BarIcon`'s
  `additionalStyle` is a style promise rather than an image element.
- **Count at `0651493b` (Orchestrator grep of `{#await` and `{:catch}`):** 18 `{#await` blocks in those five files, 13 of
  them image blocks with no `{:catch}`: `SidebarAvatar.svelte` 2 (`backgroundimg`, `src`), `BarIcon.svelte` 1
  (`additionalStyle`), `CharConfig.svelte` 5 (`getCharImage`), `PersonaSettings.svelte` 2 (`getCharImage`),
  `OtherBotSettings.svelte` 3 (`getCharImage`). The other 5 are voice/model lists and the memory ratio; two of them
  (`getFishSpeechModels`, `getMaxMemoryRatio`) have a `{:catch}`. Whether each image block can actually reject was
  not traced.
- **Related:** the rejected-avatar-icon follow-up (CHORE-69's block); ledger row 817.

### CHORE-91 — The `onclick` and long-press calls to `saveTranslationEdit()` leave a rejection unhandled (same at HEAD)

**Status (2026-10-04, side session): DONE in `3c8a142a`** (Batch B; ledger rows 1102, 1106, 1107, 1114 to 1117, 1119; `MC-219`
5: the maintainer kept the error box). The scoping found that `bootstrap.ts`'s handler already showed an error box for the
unhandled rejection (row 1102). When the translation cache write rejects, the Save button, the long-press save and the
load-for-edit button each now show one error box through `alertError`; the editor stays open with the typed text and the draft
record intact, and a successful retry closes it. `saveTranslationEdit` itself is unchanged. The partial-edit save
(`handlePartialEditSave`) also reports through `alertError`.
- **Gates:** as CHORE-90 (the same batch and rounds).
- **Limitations:** a failed partial-edit translation write is reported, but the partial editor has already closed, so that
  partial edit is lost. Two overlapping Save clicks that both fail give two error boxes; a single failure gives one.
- **Not covered:** a real translation cache failure.

**Status (2026-10-03, UI session):** open, **not scheduled**. Found at the chat UI batch's Gate 2 and left out of the
batch. Type: error handling.

- **What happens:** `Chat.svelte` calls `saveTranslationEdit()` without handling its result from the translation editor's
  save button `onclick` and from the `AutoresizeArea` `handleLongPress`. A rejected save is therefore an unhandled
  rejection. `saveTranslationEdit` rethrows a rejected cache write by design (the editor stays open for a retry), and
  the Gate 2 reviewer reported that its probe of a rejected first save surfaced as a Vitest unhandled error (no log
  retained); in the app the `unhandledrejection` handler in `bootstrap.ts` would show it as an error alert (ledger
  row 817 traced that handler for the avatar case). The same at HEAD.
- **Related:** CHORE-21; ledger rows 826 to 830.

### CHORE-92 — The copy-as-card `text/plain` companion still includes the thinking text

**Status (2026-10-03, UI session):** open, **not scheduled**, and **locked behind CHORE-68** (`MC-179` 4: CHORE-68 and
CHORE-74 move only after CHORE-55 stage 3 is merged into `feat/ui-batch`). CHORE-68 as written covers only embedding the
app's own images into the card, not the companion text, so this is its own ticket rather than a note under CHORE-68.

- **What happens:** copy as card is unchanged by the chat UI batch (`MC-203` 1), so its `text/plain` companion is still
  the text that carries the `<Thoughts>` section. `currentCopyText` is shared with the card's `captureText` (ledger row
  818).
- **What the ticket asks:** decide whether the companion should leave out thinking like the plain Copy button now does.
  Not decided.
- **Related:** CHORE-69; CHORE-68; `MC-203` 1.

### CHORE-93 — There is no speaker button on a character's first message

**Status (2026-10-04, side session): DONE in `af2ebc0b`** (Batch A; ledger rows 1101, 1103 to 1105, 1110, 1112, 1113; `MC-219`).
A character's first message gets the speaker button when the character has a voice mode and the message is not blank. It
speaks the text as displayed (CBS parsed as a first message, so `{{isfirstmsg}}` holds) and follows the alternate first
message page that is showing. Remove stays hidden on the first message. A `Chat` with no `idx` and no first message (the 14
call sites in `WelcomeRisu`) renders as before, with no button and no throw. Messages with `idx >= 0` are unchanged. The
same cause (the first message is index -1) produced CHORE-100, filed and fixed in the same commit.
- **Gates:** plan `[REJECT]` (four MAJOR, one MINOR), then `[APPROVE]`; code review `[APPROVE]` with no findings.
- **Limitations, not changed:** the `mobilechat` theme renders no icon buttons for any message, so its first message has no
  speaker button either; `customHTML` shows the buttons only when the card HTML contains `RISUBUTTONS`.
- **Wiki hand-off:** listed in Live-State's side-session block.

**Status (2026-10-03, UI session):** open, **not scheduled**. Found at the TTS batch's Gate 1 round 1 (ledger row 837).
Type: new feature.

- **What happens:** the per-message speaker button is rendered inside the `idx > -1` block of `Chat.svelte`, and the first
  message is rendered with `idx={-1}` in `DefaultChatScreen.svelte`, so it gets no button. The TTS batch did not add one.
- **What the ticket asks:** add a speaker button to the first message. Not decided.
- **Related:** CHORE-15; `MC-204` 2.

### CHORE-94 — The Playground translator may translate in the opposite direction to its labels

**Status (2026-10-04, side session): DONE in `af2ebc0b`** (Batch A; ledger rows 1101, 1103 to 1105, 1110, 1112, 1113; `MC-219`).
The scoping confirmed the inversion (row 1101). The Playground outputs in the Translator Language, translated from the input;
the single and the bulk run in `PlaygroundTranslation.svelte` called `runTranslator` with `reverse=false`, which swapped the
languages. Both now pass `reverse=true` with `(sourceLang, outputLang)`, as `tts.ts` does. Citation correction: the entry
below cites `src/ts/translator/translator.ts:61-69`; `runTranslator` and its `arg` object are at `:62-72` (checked at
`517f0cdb` and at HEAD).
- **Tests:** against the base, 2 new tests fail (the single and the bulk run pass `reverse=false`).
- **Limitations, not changed:** the default Google translator path takes its source language from the app's
  input-language setting (`translatorInputLanguage`), not from the Playground's source language. The LLM translator's cache
  (`LLMCacheStorage`) is keyed by text only and shared with chat translation, so a Playground LLM result can be served to a
  later chat translation of the same text.

**Status (2026-10-03, UI session):** open, **not scheduled**. Filed from the TTS batch (CHORE-15 TTS-1). Type: suspected bug,
**INFERRED**, not reproduced.

- **What happens (INFERRED):** `PlaygroundTranslation.svelte` calls `runTranslator(text, false, sourceLang, outputLang)`
  (at two call sites). With `reverse` false, `runTranslator` sets `arg.from` to its `target` parameter and `arg.to` to its
  `from` parameter (`src/ts/translator/translator.ts:61-69`), so these calls look inverted: `outputLang` would be the
  language translated from. The Playground call sites are `src/lib/Playground/PlaygroundTranslation.svelte:114` and `:142`.
- **Labels:** the labels are Source Language (above the input) and Translator Language (above the output); so with the
  default Google path `tl` is the source-language selection. Still INFERRED: no translation has been run.
- **Related:** CHORE-15 TTS-1 (the same parameter order); CHORE-16.

### CHORE-95 — Three TTS configs and `hfTTS.model` are used without a guard when the TTS settings page was never opened

**Status (2026-10-04, side session): DONE in `af2ebc0b`** (Batch A; ledger rows 1101, 1103 to 1105, 1110, 1112, 1113; `MC-219`).
The premise was only partly true (row 1101): the configs are defaulted whenever `CharConfig` mounts, so the `TypeError`
needs foreign or null data. `sayTTS` no longer throws when `naittsConfig`, `gptSoVitsConfig`, `fishSpeechConfig`,
`voicevoxConfig` or `hfTTS` is missing or null. NovelAI and Fish Speech fall back to the defaults `CharConfig` sets, and
VOICEVOX to the defaults `characterFormatUpdate` (`characters.ts`) sets, all held in local variables; Fish Speech then gives
its "model not selected" error. GPT-SoVITS (no url or no reference audio asset) and Hugging Face (no model) show "TTS is not
set up for this character" before any request. The defaults live in the new `src/ts/process/ttsDefaults.ts`; the `characters.ts`
defaults are not changed. One new string, `errors.ttsNotSetUp`, in all seven language files.
- **Gates:** as CHORE-93 (the same batch and rounds). The first plan was rejected partly because the GPT-SoVITS and Hugging
  Face defaults would have sent requests (row 1103).
- **Tests:** 26 new tests fail against the base and 4 guards pass. Not covered: a real TTS server (the tests mock the network).

**Status (2026-10-03, UI session):** open, **not scheduled**. Filed from the TTS batch. Type: error handling.

- **What happens:** `sayTTS` reads `naittsConfig` (NovelAI), `gptSoVitsConfig` (GPT-SoVITS), `fishSpeechConfig` (Fish Speech)
  and `hfTTS.model` (Huggingface) without a guard. When the TTS settings page was never opened for a character, the
  field may be missing, so the read throws a `TypeError` that the user sees as "TTS Error". Not reproduced.
- **Related:** CHORE-15.

### CHORE-96 — Auto-continue's `tokenize(result)` and `isLastCharPunctuation(result)` still read the raw `result`, which differs per branch

**Status (2026-10-04, side session): DONE in `3c8a142a`** (Batch B; ledger rows 1102, 1106, 1107, 1108, 1111, 1118, 1119; `MC-219`
4: the maintainer chose the raw model output). The scoping found the ticket understated (row 1102): the non-streaming branch
counted the minimum tokens twice and read the text after the `editoutput` scripts. In both modes the decision now reads the
model's output of this request (for a continue, the addition only), after the `removeIncompleteResponse` trim and before the
`editoutput` scripts and inlay processing. The minimum-token total is the tokens of that text plus `usedContinueTokens`,
counted once. Auto-continue also stops when the request produced no non-whitespace text, in both modes. This edits
`index.svelte.ts`, in the lane for this ticket.
- **Gates:** plan `[REJECT]` then `[APPROVE]` (rows 1106, 1107; the first plan's Option A would have let an empty
  continuation loop paid requests in non-streaming mode). Code review `[EDITORIAL]` (one test title), corrected (row 1111).
- **Tests:** against the base, 8 of the 13 new tests fail; the other 5 are guards.
- **Limitations:** a first reply that is empty, or trims to empty, under the minimum tokens does not auto-continue.
  `autoContinueChat` alone can still chain without end if the model never ends on punctuation, as before. In a multi-message
  (multiline) non-streaming answer the decision reads the last message's text only.

**Status (2026-10-03, UI session):** open, **not scheduled**, and **outside both lanes** (`index.svelte.ts`, `MC-179`). Filed
from the TTS batch. Type: consistency.

- **What happens:** in `index.svelte.ts` the auto-continue check calls `tokenize(result)` and `isLastCharPunctuation(result)`.
  `result` is not the same text in the streaming and non-streaming branches (raw in one, processed in the other). The TTS
  batch moved auto-TTS off `result`; these two uses are unchanged. Whether the difference changes when auto-continue fires
  was not traced.
- **Related:** CHORE-15; the plan's out-of-scope list (scratchpad `tts-batch-plan.md`).

### CHORE-97 — Browser CORS for the Hugging Face router is unverified; a live check with a real Hugging Face TTS model is owed

**Status (2026-10-04, side session): DEFERRED by the maintainer (`MC-221`)**, like the native-speaker review (`MC-212`):
there is no working Hugging Face key. It stays open and unscheduled until one is available.

**Status (2026-10-03, UI session):** open, **not scheduled**. Type: verification.

- **What is unverified:** the new Huggingface request goes to `https://router.huggingface.co/hf-inference/models/${model}`
  from the browser. That `huggingface.js` builds this URL and returns a raw audio Blob is read from its source (ledger row
  835). Whether the router sends CORS headers that allow the call from a browser page, and whether any real model answers
  with audio there, has not been tested. All TTS tests mock the network.
- **What the ticket asks:** a live check by the maintainer with a real Hugging Face TTS model and key.
- **Related:** CHORE-15 TTS-1 and TTS-2; `MC-204` 1.

### CHORE-98 — `sayTTS` with Read Only Quoted and quote-free text still sends a request with empty text

**Status (2026-10-04, side session): DONE in `af2ebc0b`** (Batch A; ledger rows 1101, 1103 to 1105, 1110, 1112, 1113; `MC-219`).
After the filters and the preprocessor hooks, `sayTTS` returns with no request, audio or alert when the text is not a string
or is blank (for example Read Only Quoted on text with no quotes, `'***'`, or a hook that returns `{text: null}`). A hook that
supplies text still speaks.

**Status (2026-10-03, UI session):** open, **not scheduled**. Filed from the TTS batch. Type: wasted request. Pre-existing.

- **What happens:** with `ttsReadOnlyQuoted` set and text that contains no quote, the filter yields an empty string and
  `sayTTS` still goes on to make its request. Auto-TTS avoids this (it speaks only when the filtered addition is non-empty);
  `sayTTS` itself does not check.
- **Related:** CHORE-15.

### CHORE-99 — Auto-TTS parses even for a character with no voice mode, and the user name comes from the selected chat's persona (optional)

**Status (2026-10-04, side session): DONE in `3c8a142a`** (Batch B; ledger rows 1102, 1106 to 1108, 1111, 1118, 1119; `MC-219`
6: the maintainer included it). Auto-speech now runs the parse and `sayTTS` only when the speaker has a voice mode
(`isTTSVoiceMode`). The speaker is the member speaking in a group turn, the owner otherwise. A user-role reply is parsed with
`getUserName` of the chat the send started in, so a chat switch during a send does not give the new chat's user name. A
char-role reply keeps the owner's name (the group's, in a group chat), as the display parse does; the member is used only for
the voice check and the voice. This edits `index.svelte.ts`, outside the hand-off's lane for CHORE-96 only; folded into that
edit on the maintainer's word; the side session messaged the Main Campaign about it on 2026-10-04 (`MC-219`).
- **Tests:** a new group of 7 in `sendChatTts.svelte.test.ts`; 6 fail against the base and the voiced-group-member test is a guard.
- **Limitation:** a plugin TTS preprocess hook does not run for auto-speech when the speaker's mode is unset, `'none'` or
  `'normal'` (no voice).
- **Not covered:** a real TTS server.

**Status (2026-10-03, UI session):** open, **not scheduled**, optional. Filed from the TTS batch. Type: efficiency
and exactness.

- **What happens:** at the auto-TTS call site in `index.svelte.ts` the only conditions are that the run is not aborted and
  `ttsAutoSpeech` is on; the reply is parsed before `sayTTS` runs, whatever the character's `ttsMode`. The site also takes a
  user message's name from `getUserName()` (`src/ts/util.ts:187`), which passes no chat, so `checkPersonaBinded`
  (`src/ts/util.ts:131-145`) reads the selected character's current chat; the call is at `src/ts/process/index.svelte.ts:2439`
  and applies only when the stored reply's role is `'user'`.
- **Related:** CHORE-15; `MC-204` 2.

### CHORE-100 — The first message's popup offered Branch, Disable and Disable-above, which throw on message[-1], and a Bookmark that did nothing

**Status (2026-10-04, side session): filed and DONE in `af2ebc0b`** (Batch A; ledger rows 1101, 1103 to 1105, 1110, 1112, 1113;
`MC-219`, the Orchestrator's scope amendment under `MC-091`). Type: bug. Same cause as CHORE-93: the first message is rendered
with index -1.

- **What happened:** the first message's popup menu offered Branch, Disable and Disable-above, which read or write `message[-1]`
  and throw a `TypeError`, and Bookmark, which did nothing. Found by the Batch A scoping (row 1101).
- **What changed:** the first message's popup offers none of the four, in both width paths (>= 640 and < 640). Its popup
  button shows only when at least one item inside would render (no empty popup for a blank first message, with chat copy off,
  or without `ClipboardItem`). Whether Copy as card is available is one function, used by the item and by the popup guard.
  Messages with `idx >= 0` keep all four actions.
- **Tests:** `Chat.firstMessagePopup.svelte.test.ts` (new): against the base 9 fail and 2 guards pass (idx 0 keeps all four
  items, wide and narrow). The blank-first-message test in `Chat.copyCard.svelte.test.ts` was edited to assert there is no
  menu button.
- **Related:** CHORE-93.

### CHORE-120 — On the Node server, `/api/set_password` accepts any client until a password exists, and the first client wins (TRACED)

**Status (2026-10-04):** open, **not scheduled**; fixes are to be proposed after Stage 0 of the save-layer track. Severity: not assessed. Filed at the maintainer's "File both, extend our range (Recommended)" (`MC-194` 14); the Main Campaign's CHORE range now also holds CHORE-120 to CHORE-129. Reported by the side session's CHORE-80 investigation; verified in source by the Orchestrator, and its route code re-read for this entry at the time of writing.

- **What was traced:** the `POST /api/set_password` handler in `server/node/server.cjs` checks only that the in-memory `password` is the empty string. If it is, it stores the posted value, writes it to the password file and answers success; otherwise it answers 400 "already set". The route has no authentication check and no rate limiter argument. Upstream origin: `74f76255`, 2023-05-28 (re-checked with `git log -S` at the records fact-check, ledger row 1070).
- **Consequence:** on a freshly started server with no password, whoever reaches `/api/set_password` first chooses the password. After that the route refuses. A password set by someone else would lock the owner out (SUSPECTED, not run). The hosted build is meant for private networks only (`MC-191`), which limits who can reach the route.
- **Not known:** whether the app's first-run flow depends on a client calling this route before a password exists (TODO(evidence)); whether the Hono server has the same route (TODO(evidence)).
- **Related:** `MC-194` 14; `MC-191`; CHORE-89; CHORE-80 (the side session's investigation found it).

### CHORE-121 — Concurrent Node store reads were serialised by Chrome's HTTP cache lock, a proxy GET could be answered with another target's cached body, and storage shared the 2000-per-minute limit (MEASURED on an i9, Chrome 154 only)

**Status (2026-10-05): filed and DONE in `71100280`** (local, not pushed; ledger rows 1073 and 1076 to 1078; `MC-195` 1, 2 and 7). Type: bug (speed of every Node-served page, and a cache-correctness hazard on the Node proxy). Opened at the maintainer's "yes to both. 1. start stage 1 plan now 2. open chore 121 so it can be fixed alongsode of stage 1." and committed at "commit chore 121".

- **What was measured (rows 1073 and 1076):** every `nodeHttpStore` request goes to one URL per route, and all reads share `/api/read` with the key in the `file-path` header. Chrome's HTTP cache lets one request per URL through at a time, so concurrent reads ran one after another. In the boot-read measurement, with the app's own store on Node, reads at 8 and 32 workers were almost no faster than at 1, and `cache: 'no-store'` on the read cut loopback at 8 workers from 603 to 227 ms. On a stand-in express server with a 10 ms hold, 120 requests to distinct keys took 10.7 ms each at 6 workers and 10.5 ms at 32 by default, against 1.8 ms with a client `cache: 'no-store'` (6 requests in flight at the server). A server `Cache-Control: no-store`, `no-cache` or `Vary` did not change it. One i9 (best-case hardware, `MC-003`, `MC-010`), Chrome 154 headless=new only; Firefox, Safari and Android WebView were not run.
- **Cache correctness (TRACED and MEASURED, row 1076):** `/api/read` has no stale-after-write and no cross-key hit: it sends no freshness headers, so the browser revalidates every time and the handler runs before any 304 decision; 0 wrong bodies in the distinct-key runs. The hazard is on GET `/proxy` and `/proxy2`. The target is named in the `risu-url` header, so every target shares one URL; the handlers delete the upstream's `Cache-Control` and forward `Last-Modified`, `Expires` and `ETag` (the Orchestrator verified this in source). A stand-in route that added only `Last-Modified` returned the first target's body for a second target. That was measured on the stand-in; the real route was not run against a real upstream (INFERRED). The client reaches the route with a GET only when a caller passes `method: 'GET'` through `globalFetch` or `nativeFetch`; the callers were not enumerated.
- **The limiter:** before `71100280`, `authenticatedRouteLimiter` (2000 requests per 60 s per client address) was shared by `/proxy`, `/proxy2`, `/hub-proxy/*`, `/proxy-stream-jobs`, `/api/env-secret` and the four storage routes (TRACED; the 429 path was not run). The storage routes now have `storageRouteLimiter` (20000 per 60 s). The investigation's first statement, that the fix would newly expose the limit, is superseded by its hand-back: at the serialised rate the request count was already over 2000 per minute (arithmetic, INFERRED).
- **What changed (4 files, 171 insertions, 8 deletions):** `nodeHttpStore.ts`: `send` (read, HEAD read, write, list) and `removeChunk` (delete, deleteMany) pass `cache: 'no-store'`; the URL, the header and the wire format are unchanged. `server/node/server.cjs`: a `storageRouteLimiter` of 20000 requests per 60 s on `/api/read`, `/api/remove`, `/api/list` and `/api/write`, with the other limiters untouched; `Cache-Control: no-store` on the proxy responses in `reverseProxyFunc`, `reverseProxyFunc_get` and `forwardUpstreamResponse` (which has no caller; event-stream responses get `no-store, no-transform`). `/hub-proxy` is untouched (its identity is in the path). The four latent request sites in `nodeStorage.ts` and the two proxy fetch sites in `globalApi.svelte.ts` were not changed.
- **Tests:** in `nodeHttpStore.test.ts` the recording fetch now records `init.cache`, and a new test asserts `no-store` for write, read, HEAD read, list, delete and deleteMany. `nodeServerRoutes.test.ts` (new) runs the real `server.cjs` against a local target: proxy header tests for `/proxy`, `/proxy2`, an event-stream response and a POST, and limiter tests that read the `RateLimit-Limit` and `RateLimit-Remaining` headers. All eight are red on the unfixed code and green after. The browser-level overlap cannot be tested in Vitest (Node's fetch has no HTTP cache); it rests on the Chrome measurement, and no browser run of the final code is recorded.
- **Gate:** Gate 2 only, `adversarial-reviewer` `[APPROVE]` (row 1078). No plan-gate row is recorded for it. Checks (Orchestrator): `pnpm test` 459 files, 8917 passed, 4 skipped; `svelte-check` 0 and 0; `pnpm build` succeeded.
- **Four non-blocking notes from Gate 2, not acted on:** (1) a redundant delete before a set; (2) the limiter-arithmetic tests could flake if the 60 s window rolls over during a run; (3) the proxy's 400 and 504 error bodies carry no `Cache-Control`; (4) the event-stream test checks the header only. The four are from the reviewer's hand-back as the Orchestrator recorded it at the time; the Gate 2 file summarises only the first three, and words the first as dead-code redundancy.
- **Decisions:** `MC-195` 2 (scope: the proxy bug "Into CHORE-121 (Recommended)"; the limiter "Own higher limit for storage (Recommended)") and 7 (the commit word).
- **Related:** Report 57 section 9.2 (the Stage 1 boot-cost figures for Node assume overlapping reads); ledger row 1073.

### Candidate tickets, not yet numbered (2026-10-04)

Recorded so they are not lost. No number is assigned. The next free number in the Main Campaign's range is CHORE-122.

- **A V2.1 plugin that switches itself off through the plugin API's `setDatabase` keeps running with wrapped module asset lists (G2-4; Stage A Gate 2 round 1, ledger row 1057; `b1d2804b`'s message).** SUSPECTED only, not reproduced. The real `setDatabase` would wrap the lists while the plugin's code is still running, and a later in-place push by that plugin would go untracked. No such upstream plugin is known.
- **An unparseable or non-object `__revisions.json` on the Node server (P9; Stage 0 (ii) Gate 1 round 1, ledger row 1055; `2aa55398`'s message).** Deferred. The server still starts as if the snapshot were empty (the log is replayed, and a non-object takes the same path with the error logged), and the next compaction overwrites the file. The log does not worsen this. Possible fixes named in the commit message: rename the bad file aside and seed a high revision floor so stale devices get 409.
- **Already numbered, so not candidates:** the module editor's `hideIcon` write on open is CHORE-88 (closed, `54b1a819`); "every boot writes the main file, a numbered backup and about 507 cache entries" is CHORE-83; "the page-load listing is awaited before plugins" is CHORE-84.

## Sequencing Summary

```
Phase 0 ✅ done ──> Phase 0.5 (round-2 quick fixes, any order) ──┬──> Phase 1 (persistence/integrity hardening)
                                                                  │
                                                                  └──> Phase 3 (ARM Linux ✅ done / Windows ARM ✅ resolved — declined) — independent, parallelizable

Phase 1 ──┬──> Phase 1.5 Tier A ✅ done (bootstrap null-overwrite fix)
          │
          ├──> Phase 1.5 Tier B Stage 1 ✅ done (Node-server optimistic concurrency, 9 review rounds)
          │
          ├──> Phase 1.5 Tier B Stage 2 ✅ done (account-sync conflict hardening, 3 review rounds)
          │
          ├──> Phase 1.5 Tier B Stage 3 ✅ done, naming-only (content-addressed remote blocks shipped; automatic GC deliberately skipped as not worth the cost — see Report 08)
          │
          ├──> Phase 1.5 Tier B item 3 ✅ done (multi-tab BroadcastChannel hybrid reload/prompt, 4 adversarial review rounds)
          │
          └──> Phase 2 (RAM/architecture rework) 🔄 in progress since 2026-09-21, not done (status note under the Phase 2 heading) ──> Phase 4 (Android)

Phase 1.5 Tier B Stage 4 (revisit account-sync hub enforcement) is confirmed permanently out of reach, not merely blocked pending future hub access — the hub is maintained entirely upstream and this repo has no path to its source or behavior. The deferred-behind-Phase-2 items (CRDT/op-log, hard lock + takeover UI — explicit product decision to defer, not a technical blocker) remain not yet scheduled. A properly-scoped automatic-GC retry for Stage 3 (the transactional mechanism Report 08 sized but recommended against building now) is also not yet scheduled — worth revisiting only if real usage data ever shows unreclaimed remote-block storage growth is an actual problem, not a theoretical one.
```

Phase 0.5's Android compile-blocker fix (`#[cfg(desktop)]` on the two plugin registrations) is cheap enough that it has no real ordering dependency on anything — do it whenever convenient. Phase 1.5 Tier A and Tier B Stage 1 were both pulled forward ahead of/parallel to the rest of Phase 1 and Phase 2, same reasoning — isolated, no architecture dependency. Phase 3 (desktop ARM) has no dependency on Phase 2 and can proceed in parallel with Phases 0.5-2 if resourced separately. Phase 4 (Android) must not start before Phase 2's exit criterion is met — this is the one hard ordering constraint in this roadmap. As of 2026-09-30 Phase 2 is in progress (item 1 done; items 2 and 3 partly done; 8 in progress; see the status note under the Phase 2 heading), and its exit criterion is not recorded as met, so the Phase 4 gate stays closed.

**Should there be a Round 3?** Both deep-dive rounds surfaced genuinely new, previously-undocumented bugs — round 2 was not a diminishing-returns exercise. Whether a third open-ended pass is worth running is a judgment call for the project owner: the highest-value remaining unknowns are probably not in these four subsystems anymore (two rounds of hypothesis-free hunting have covered them reasonably thoroughly) but in areas this investigation hasn't touched at all yet (the request/provider-abstraction layer, the memory/summarization systems' correctness beyond RAM footprint, the plugin API v3 sandbox's security boundary, i18n/translation correctness). Recommend deciding this after Phase 0.5 ships and its Codex reviews land, not before.
