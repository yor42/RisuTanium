# Roadmap archive: closed, superseded and moot entries (moved 2026-10-24)

Moved unchanged from `Agents/Roadmap.md` at `ec069c5ad` by the lane A Roadmap cleanup (`MC-479`). Entries keep their text, apart from one dated closing status line added to each of the ten tickets the closeout check passed (ledger rows 2260 and 2261). A `##` heading repeated here only gives context for the entries below it; its own text stays where it was. A reopened ticket moves back to the Roadmap with a dated status line.

## Current work order (MC-345, 2026-10-22)

Goal: a personal Android MVP (not a release), usable before the major UI overhaul. Full text, the audit list and the conditions: [MC-345](Maintainer-Context.md). It amends MC-321 1.

| Phase | Owner | Content |
|---|---|---|
| A0 | lane A | Records: MC-345, this block, Live-State, ledger rows 2136 to 2143 |
| A1 | lane A, phone 1 | Real-library feasibility run on a release-profile APK: partial `.bin` first, then full; measure; keep the profile as the soak profile |
| with A1 | lane E | Trimmed store2 supersession audit (superseded / still present / not applicable on Android) |
| with A1 | lane C, lane A | CHORE-182 free-space check; then E1 on phone 2 (`onResume()` on the WebView during a transfer, repeat R2) |
| with A1 | lane D | Merge S4-5 (needs approval), then clear |
| A2 | lane B | Stage 5a: automatic GC, no UI; `senior-advisor` challenge, `opus-reviewer` Gates 1 and 2; Note 9 "mark under 1 s" check on A1's profile |
| A3 | lane B, lane E | Fixes the audit confirms: storage fixes (B, after 5a); CHORE-174, CHORE-181 plus the debounce test, CHORE-187 (E) |
| A4 | by A1's result | Only if A1 says so: lane C's role-play-first design and CHORE-103; stages 6+7; CHORE-154 to CHORE-157 |
| A5 | lane A | MVP checkpoint: full `pnpm test` and `pnpm check`, Android build of `main`; the maintainer installs the release-signed APK and imports |

**Constraint:** the MVP APK uses the final package id and the maintainer's real signing key (the package-id and signing part of CHORE-60), so later APKs install over it without data loss. The pre-cutover upstream-readable `.bin` stays on the PC as the only restore until 5a and the A3 fixes land.

**Status (2026-10-22, lane A fold-in): store2 stage 5a (A2) merged in `9dd028b3b` (no-ff of lane B's `67273e799`; `MC-366`, `MC-368`, `MC-369`). Full checks on `9dd028b3b`: `pnpm test` 20,962 passed; `checkReleaseDist` OK on 244 files; `cargo test --lib` 202 passed; `pnpm check` 0/0; build passed. A9 was dispatched on phone 1 as a MEASURE build of `771ec2b30` (it contains 5a), installed as an in-place update with the fixed test key; the restore path is a re-import of `Backup_partial.bin`; the result is pending. The daily APK must not be built from `main` until A9 passes (`MC-368` 1, `MC-457` 2).**

**Status (2026-10-23, lane A records batch 4): the `MC-368` 1 daily-APK block stays.** Lane B rules that the stage 5a mark result blocks the lift under the criterion "GC mark under 1 s, with the pass ending inside the ~60 s window". Phone part 4 gave 3 of 5 launches under 1 s; part 5 gave 3 of 7 (values in its section 8.5; the verdict is lane B's). A bounded re-arm or batch cap does not address the mark. Holding the idle net during the GC pass is considered only if the mark stays at 1 s or more after stage C (`MC-372` 2).

**Status (2026-10-24, lane A records batch 5): MVP export proof and carry-forward; daily-APK holds released.** The export and re-import route (`MC-470`) has its proof on phone 2 with mid-scale synthetic data with generated assets (`MC-471`; about 500 characters and 40k assets). Checks a, c and d are green, and lane A re-ran c and d. Check b is red: the only difference is `useStreaming` on the PC list, and the investigator traced it to a PC-side UI write, not phone data loss (`phone2-synth\usestreaming-verify\result.md`, links 1 to 3 confirmed). The tooling is committed as `ee23c1bd9` (generator and verifier) and `e41513308` (the first-setup fix). Phone 2 holds the release build of `e41513308` with the synthetic profile. The MVP is not installed yet. The MC-350 carry-forward baseline is recorded when the maintainer announces the install. Device checks now use synthetic data and throwaway keys (`MC-472`); a session-ready synthetic profile is a proposal, not a ticket. The daily-APK holds from the stage 2 and 2c runs are released; no daily APK is current.

**Parked until after A5:** stage 5b (clean-up UI, quota path, C3/Q3, Q9), CHORE-128, CHORE-115, the Node items (CHORE-49, 62, 46, 0b, the CHORE-129 web/Node residual), list windowing, S4-6, CHORE-147, the old Step 3 re-measure, WF-6 and WF-10, the old Step 4 UI-overhaul checkpoint, and the release (R).

The "Queue after the 2026-10-09 batch" section and the Sequencing Summary below are superseded by this block.


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

### CHORE-09 — Scripting, regex and lorebook bugs found during the wiki rewrite (none lose data)

**Status (2026-10-24, lane A records batch 5): fixed; item 7 closed with an accepted residual.** Items 4, 9, 10 and 11 are fixed on `lane-cloud` (`MC-710`, `MC-716` 5 to 7, `MC-718` 1 to 3; commit `e34be1c`) and merged in `19625c694`. Item 7 has a guard in the small batch (`9fe98db90`; `MC-352` 3): the legacy `@@inject` write happens only when its target is the selected character's current chat and the message index exists. The residual is accepted (`MC-353`): a selection change while a script pass is in flight can still write message N of the newly selected chat; that is pre-existing upstream behaviour.

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

**Status (2026-10-24, lane A records batch 5): all 21 items fixed; merged in `19625c694`.** Fixed on `lane-cloud` in batch B `10a4adf` and stages A1 `cc25005`, A2 `ffc5fc2`, A3 `5c88496`, C1 `d6994c7`, C3 `ad4ac00`, C2 `048cb24` and C4 `36de3a6`, under `MC-711` to `MC-724`. Each stage was technically accepted at Gate 2. Residuals, per lane Cloud's records: SHARED-1 and V2-5 are untested; Hanurai split mode is untested; the experimental V3 path is not tested for similar-memory retrieval; the SUPA-3 repoint must cover every delete path; `MC-715` has no pinning test; and the reported residuals F4 (pre-reset summaries kept and injected), Proxy in-place empty, oversized SupaMemory entries and `MC-723` (bounded greeting re-summary). Follow-ups: CHORE-500, 501 and 502 are parked post-MVP; CHORE-503 is closed (entries above).

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

**Status (2026-10-20, stage 4b close): SUPERSEDED.** The store2 inlay round-trip compatibility guard (`c25482c16`, stage 4b S3) covers inlays on store2 pages; see the stage 4b section. The earlier status follows.

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

**Status (2026-10-20, stage 4b close): SUPERSEDED** by the store2 layout, which has no main file (the stage 4b disposition in the Step 1 handoff's next actions). The earlier status follows.

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

### CHORE-67 — Existing tests that run DOMPurify under happy-dom may pass for the wrong reason (test reliability; RUN under happy-dom 20.1.0; the cause TRACED)

**Status (2026-10-24, lane A records batch 5): CLOSED.** Lane Cloud moved the two residual tests to jsdom on `lane-cloud` (`MC-705`; Gate 2 row 5011), merged in `19625c694`. The 2026-10-02 "open, not scheduled" status below is stale.

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
    desktop process and the Node or Hono self-hosted server can (as of `1b881d0c` `server/node/server.cjs` reads `PORT`, `TRUST_PROXY`, `RISU_ALLOWED_ENV` and `RISU_REVISION_LOG_COMPACT_AT`, documented in `server/node/readme.md`, and also reads `process.env[name]` for the names `/api/env-secret` resolves (`RISU_<NAME>_KEY`, `RISU_<NAME>_TOKEN` and the names listed in `RISU_ALLOWED_ENV`);
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

**Update (2026-10-12, folded in from the unload-2 records; settled by item 5): moot.** The idle reload was removed in `b33e485ae` (`MC-268` item 3; ledger rows 2035 to 2039), so there is nothing to turn on. This is not a won't-do on the ticket's merits. The five notes above (separate file-medium instances, rate-limit history in `localStorage`, the AppData-root temp file, the untested Tauri `keepInline` call site, no mobile exclusion) went with the deleted code.

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

### CHORE-122 — `.bin` restore was quadratic in entry size and slept after every entry, export wrote four times per entry, and web exports depended on a third-party download helper (MEASURED on an i9, synthetic data)

**Status (2026-10-05): filed and DONE in `b6d8e963`** (pushed with `main`; ledger rows 1182 to 1196; `MC-197` 1 to 5; Report 60 section 2). Type: performance, plus a dependency and failure-mode fix. Opened by the maintainer's request to speed up `.bin` import and export while Stage 1c was planned.

- **What was measured (row 1182):** the restore's buffer concatenation was quadratic (a 155 MB entry took 29.1 s at 64 KB chunks and 1.9 s at 1 MB); a fixed `sleep(10)` per restored entry cost about ten times the disk work; on Tauri four appends per entry took 22.65 s against 0.28 s coalesced per 20,000 x 32 KiB. Removing account sync and Drive had bought no speed. The web, Node and PWA exports went through a helper page on `jimmywarting.github.io` with no timeout (offline hang INFERRED, not run).
- **What changed:** each restore entry is read once with `slice()` and the sleep is a yield about every 50 ms; Node restore assets over the body limit are listed and skipped after a confirm; the Node byte store retries a 429; `TauriWriter` coalesces writes into 4 MiB buffers; streamsaver 2.0.6 is vendored and its helper is served from `/streamsaver/` with a 10 s ready timeout and an in-memory fallback. The `.bin` container is unchanged (`MC-175`). 64 files.
- **Gates:** plan Gate 1 `[REJECT]`, `[REJECT]`, `[EDITORIAL]`; Gate 2 `[EDITORIAL]` (18 of 18 mutants killed). Checks: 478 files, 9327 passed, 4 skipped; `pnpm check` 0/0; build OK.
- **Live (a scratch Node server):** an export through the self-hosted helper, a restore of that file, and the helper-blocked fallback. The plain-HTTP popup path has no recorded live run.
- **Residuals:** a marker in a sub-header-length entry shows the changed-file wording and still stops; `writeModuleCard` calls `successExport` after `alertError` (pre-existing); progress is static during one huge entry. `pnpm install` to prune `streamsaver` from the main checkout's `node_modules` was deferred (TODO(evidence): not recorded as done).

### CHORE-123 — Desktop `.bin` restore and export made one plugin call per file step (36 GB: restore 86 to 93 min, export 66 to 74 min; MEASURED on an i9)

**Status (2026-10-06): filed and DONE in `b5a41e3d`** (pushed with `main`; ledger rows 1248, 1249, 1254 and 1256 to 1265; `MC-197` 8 to 10; Report 60 sections 3 to 5). Type: performance. Opened at the maintainer's "yes. do it." after the 36 GB measurement.

- **What was measured:** 91% of the restore and 99% of the export wall time was sequential `plugin:fs` IPC at about 4 ms per call (about 3 ms of it Rust kernel time); not disk, not JS.
- **What changed:** four Rust commands (`put_assets_batch`, `put_asset_single`, `get_assets_batch`, `list_assets_sized`) and a JS pipeline (`assetBatchPipeline.ts`) with batches of about 4 MiB, at most 4 calls in flight and 16 MiB in flight; each restored file is written to a temp file, `sync_all`ed and renamed (the maintainer's per-file fsync decision, `MC-197` 9); availability is fail-closed to Tauri on Windows, Linux and macOS. No command takes a filesystem path.
- **Live (A11, Windows, i9):** a 31,069-asset slice restored in 66 s (461 s before) and exported in 55 s (184 s before); a 38.7 GB `.bin` restored in 16.1 min and exported in 10.3 min; every asset SHA-256 identical.
- **Gates:** plan `[REJECT]` then `[EDITORIAL]`; Gate 2 `[REJECT]` (tests only) then `[APPROVE]` (21 of 21 JS mutants killed; 4 Rust mutants on error and limit branches survive). Checks: 9886 passed, 6 skipped; `cargo test` 74.
- **Limits:** Linux and macOS have unit coverage only; the not-raw fallback could not be forced live. `put_asset_single` was later removed by CHORE-124.
- **Related:** CHORE-124, CHORE-110.

### CHORE-124 — A `.bin` entry of 512 MiB or more killed the desktop page on restore and export, and an asset of about 1 GiB killed the app (MEASURED on an i9, WebView2 154)

**Status (2026-10-06): filed and DONE in `bc631526`** (pushed with `main`; ledger rows 1266 and 1268 to 1281; `MC-197` 11 and 12; Report 60 section 7). Type: bug (found by the live check of CHORE-123, present on the build before it). Opened at the maintainer's "fix the 512MB crash next".

- **Cause:** WebView2 allocates one buffer per IPC call, 4 times the request and 2 times the response, and refuses one above `0x7FE00000`, so a request tops out near 511.5 MiB and a response near 1,023 MiB.
- **What changed:** every desktop IPC call that moves file payload is at most 4 MiB: a streamed restore of large assets (`write_chunk_raw`), a 4 MiB response limit in `get_assets_batch`, ranged export reads, 4 MiB reads and writes of user files outside the app folder. A failed export now ends with a message and deletes its incomplete file; an asset that changes during an export stops it (the maintainer accepted this, `MC-197` 12). An asset of 4 GiB or more fails the export with `backupFailedAssetTooLarge`; CHORE-129 replaces that.
- **Live (a 5.1 GB `.bin`, a 41.4 GB `.bin`):** the 5.1 GB file restored in 69 s with every asset equal and no call above 4 MiB (the old build died at 5 s); the 41.4 GB file restored in 800 s and exported in 636.8 s. The asset phase is flat at about +110 MiB, but the whole restore peaks +1,211 MiB, in the tail that decodes the legacy database: the under-1-GB target was met for the asset phase only (CHORE-103).
- **Gates:** plan `[REJECT]`, `[EDITORIAL]`; Gate 2 `[REJECT]` (two untested data guards), `[EDITORIAL]`. Checks: 507 files, 10255 passed, 6 skipped; `cargo test` 118.
- **Not covered:** Linux, macOS, Android, WebKitGTK and WKWebView ceilings; a single import file above about 2,046 MiB (fixed for `.risum` and PNG by CHORE-125).

### CHORE-125 — Importing a large `.risum` module or PNG card read the whole file into memory (a module with 1 to 2 GB of assets could not be imported)

**Status (2026-10-06): filed and DONE in `64436cbd`** (pushed with `main`; ledger rows 1283 to 1292; `MC-225` 1 and 2; Report 60 section 8). Type: bug (memory). Queued at the maintainer's "yes, queue the streaming importer next".

- **What changed:** `.risum` and PNG cards are imported in two passes (a structure check that saves nothing, then one asset at a time); every refusal happens before any save; the per-asset limit is 200 MiB (100 MiB on Node) and the file as a whole may be any size; desktop open-with reads through plugin-fs handles in at most 4 MiB calls (new `fs:allow-seek` and `fs:allow-fstat`, handle-only); a changed file stops with a message. `.json`, `.risup` and presets are still read whole.
- **Behaviour changes:** a module whose record count differs from its asset list is refused; an old Tavern PNG no longer saves its unreferenced asset chunks; a PNG asset of exactly 200 MiB is refused.
- **Live (MEASURED, n=1):** a 2.32 GiB `.risum` imports with +571 to +661 MiB (the old build fails on every route); a 2.9 GB PNG card +1,354 against +3,258 MiB; Chrome web +728 MiB; Node refuses a 120 MiB asset; a 626 MB `.risum` imports on the Note 9.
- **Gates:** plan `[REJECT]`, `[EDITORIAL]`; Gate 2 `[EDITORIAL]`, `[EDITORIAL]`. Checks: 513 files, 10423 passed, 6 skipped.
- **Related:** CHORE-101 (orphan assets), CHORE-126.

### CHORE-126 — Importing a large asset held several whole copies of it: the file bytes, the decoded asset, the hash copy and a write copy

**Status (2026-10-06): filed and DONE in `1e71c45c`** for desktop and Android (pushed with `main`; ledger rows 1299 to 1309; `MC-225` 5; Report 60 section 9). Type: performance (memory). The web stage is CHORE-108. Queued at the maintainer's "yes." (`MC-225` 3).

- **What changed:** on the Tauri desktop and Android app an asset of 16 MiB or more is read at most 4 MiB at a time and each piece is hashed and written once, with a Rust final key on the last chunk (renamed into place, or discarded if the key exists). An incremental SHA-256 of our own replaces `@aws-crypto/sha256-js`, which gives a wrong digest at 512 MiB and above. Plain-HTTP hosts now save under the content-hash key instead of a random key. Node keeps its 100 MiB limit.
- **Live (MEASURED, single foreground runs):** a 1.91 GB `.risum` renderer peak 244 against 1,227 MiB (67.3 against 61.5 s); a 2.79 GB PNG card 222 against 1,570 MiB (46.6 against 38.7 s); a Note 9 630 MB `.risum` 287 against 1,008 MiB RSS (126 against 208 s). Keys equal the old build's.
- **Gates:** plan `[REJECT]`, `[EDITORIAL]`; Gate 2 accepted. Checks: 517 files, 10533 passed, 6 skipped; `cargo test --lib` 133.
- **Related:** CHORE-102, CHORE-106, CHORE-107, CHORE-108.

### CHORE-127 — Android build, window-call gating and a chunked byte transport (Phase 4 work, built alongside the performance work; release gated)

**Status (2026-10-06): the build and the transport are DONE and merged as `30d3e594`** (`0c2267f5`, `397c6fc5`, `257c5a2d`; pushed with `main`; ledger rows 1197 to 1209, 1270 and 1271; `MC-198`; Report 60 section 6). Type: feature. **Shipping an Android build stays gated** until the memory and performance work makes it safe on low-RAM phones (`MC-198` 8).

- **What exists:** the app body in `lib.rs` with a mobile entry point; Android-only `rustls`; desktop-only window calls gated on `isTauriDesktop`; `updater:default` and `deep-link:default` moved to `desktop.json` (which now names the `main` window); the tracked `src-tauri/gen/android` project; base64 chunk writes (`write_chunk`, `abort_chunked`) and ranged reads (`read_range`) through the Android store. On Android the boot archive pass is off.
- **Measured (the Android 15 emulator, debug Rust; emulator ratios, not phone figures):** 50 MB writes 22 to 24 MB/s with a main-process RSS rise of at most 14.5 MB, against 3.7 MB/s and +57 MB per MB for the old array path; reads 155 to 217 MB/s. A Note 9 debug run (A1, A2, A8) passed.
- **Gates:** transport plan `[REJECT]`, `[EDITORIAL]`; Gate 2 `[REJECT]` (a desktop permission regression), `[APPROVE]`; merge review `[APPROVE]`.
- **Roadmap Phase 4 corrections from the scope investigation:** the two blockers it lacked (`openssl-sys` through reqwest, and the capability validation) are fixed; item 1 (`tauri android init` and icons) was probably false; item 7 (an `isDesktop` flag) is partly stale (the fork's `isTauriDesktop` is the flag in use).
- **Open:** CHORE-112.

### CHORE-110 — Whole-file export bytes differ from run to run

**Status (2026-10-20): CLOSED** by `96b9d10f1` (the `.bin` database entry is written with a zero gzip time), with the device confirmation: the post-fix D5r run exported twice with identical SHA-256 and gzip MTIME 0, verified from the files (small profile; the large export was not repeated). The earlier status follows.

**Status (2026-10-06): open, candidate investigation.** In the live check of `b5a41e3d` two exports of the same data differ byte for byte on both the old and the new build: the `database` entry's bytes vary, and the decoded database is equal (assets identical). Not diagnosed.

### CHORE-116 — Unsaved edits made in the boot window

**Status (2026-10-08): done in `a5a3095d`, pushed (`12876031..a5a3095d`) on the maintainer's "Commit and push (Recommended)".** Gate 1: two `[REJECT]` rounds, then `[EDITORIAL]`; Gate 2: `[EDITORIAL]`, then `[APPROVE]`; the commit-message check was `[EDITORIAL]` and its corrections were applied (ledger rows 1433 to 1441). 16 reproducers were red at the parent (2 lost-edit, 14 reloaded; one is harness-only). The boot-prompt behaviour is the maintainer's choice in `MC-246` (relates `MC-041`). The item was queued after CHORE-114 (`MC-231` 4: "queue the chore 116 after chore 114"). The earlier TODO(evidence) on the mechanism is answered by the commit and its message; this entry does not restate them.

- **Disclosed residuals (Orchestrator handoff, 2026-10-08 section 2):** plugin custom-storage writes in the boot window with no input or panel are still lost on a peer save; a failed import after its mark leaves the tab dirty; sticky front when nothing is selected at registration (O-2); real-browser `isTrusted` was not live-tested (an optional Note 9 check is in the queue); the boot window length on phones is unmeasured.

### CHORE-119 — /hub-proxy forwards every client request header to the Realm hub

**Status (2026-10-07): done in `1b881d0c`.** `/hub-proxy` now sends the hub only `accept`, `accept-language`, `content-type`, `user-agent` and `x-risuai-info`, plus the hub origin, on the first request and on a followed redirect. It no longer copies hub `Set-Cookie` headers to the client, and after a followed redirect the client sees only the headers of the response whose body it receives. `x-forwarded-for`, `referer`, `range` and conditional headers are no longer forwarded (no Realm call sets them explicitly; the browser-supplied ones, `referer` and possibly conditional headers on `<img>` loads and navigations, are now dropped, INFERRED; the commit message of `1b881d0c` and the hub-proxy packet, Q1 rows 5 and 6). Evidence: unit tests of the filters, and a run of `server.cjs` against a local stub hub (`step2/impl/prefix-run.txt` and `post-run.txt`); the `hubProxyFunc` wiring has no committed test (ledger row 1413, O2). The TODO(evidence) below on `risu-auth` is answered: TRACED, no client code attaches `risu-auth` or a cookie to a `/hub-proxy` call (ledger row 1410). The rest of this entry is the filing record as of `08aea278`. Type: security hygiene. Filed from the CHORE-89 fix (`bc495e3f`, which pinned `/hub-proxy` to the hub origin) and the maintainer's "Commit; ticket both". The hosted build is private-network only (`MC-191`), so the risk is which of the user's own credentials leave the server, not an exposed attack surface.

- **TRACED:** `hubProxyFunc` (`server/node/server.cjs:1126`) copies `{ ...req.headers }` and deletes only `host`, `connection`, `content-length` and `x-risu-node-path` (`server.cjs:1136-1140`), then sets `origin` to the hub origin (`server.cjs:1142-1143`). Every other client header goes on the upstream `fetch` (`server.cjs:1145-1151`), and the redirect follow reuses the same set (`server.cjs:1168-1175`). `server/node/hubProxy.cjs` only builds the target URL and checks redirect targets (`hubTargetURL`, `hubRedirectTarget`); it copies no headers.
- **So** `risu-auth`, `cookie` and `authorization` reach `sv.risuai.xyz` whenever the browser sends them. TODO(evidence): whether the web client attaches `risu-auth` or a cookie to same-origin `/hub-proxy` requests; not traced.
- **Direction (non-normative):** an allow-list (`accept`, `content-type`, `x-risuai-info`, `user-agent`), or stripping `risu-auth`, `cookie` and `authorization`.

### CHORE-130 — Suspected, not reproduced: a Realm report sent through /hub-proxy on Node hosting might reach the hub as `[object Object]`; the only caller's text/plain body points against it

**Status (2026-10-07): done in `1b881d0c`.** Reproduced against a local stub hub before the fix: an `application/json` POST reached the hub as the 15-byte `[object Object]` and a `text/plain` body arrived intact (ledger row 1410); a form POST and a POST without a body also arrived as the 15-byte `[object Object]` (`step2/impl/prefix-run.txt`, ledger row 1412). The only caller sends `text/plain`, so the defect was latent, not live. The route now captures the raw bytes before the global parsers, under the same `NODE_BODY_LIMIT_BYTES` limit, and forwards them unchanged for ordinary bodies; a request with a `Content-Encoding` (for example gzip) is inflated by the parser and forwarded inflated with `content-encoding` dropped; a request without a body forwards none. The rest of this entry is the filing record. Type: possible bug. No probe of the Realm service was made (the rule is no probes of upstream services).

- **TRACED:** the only caller found is `RealmPopUp.svelte:116`, `fetch(hubURL + '/hub/report', { method: "POST", body: JSON.stringify({ id, report }) })` with no headers. On Node hosting `hubURL` is `/hub-proxy` (`src/ts/characterCards.ts:33-34`). The server registers `express.json`, `express.raw` (octet-stream only) and `express.text` before the routes (`server.cjs:19-21`), and `hubProxyFunc` forwards `req.body` as the `fetch` body (`server.cjs:1148`).
- **INFERRED (not run):** a browser gives a string body the content type `text/plain;charset=UTF-8`, so `express.json` skips it, `express.text` parses it into a string, and the string is forwarded intact. On that path no `[object Object]` arises. It would arise only if a request arrived as `application/json`: `express.json` would set `req.body` to an object, and `fetch` would stringify that object as `[object Object]`. No client code found sends JSON to `/hub-proxy` this way. TRACED: `RealmPopUp.svelte.test.ts:162-168` asserts the call `fetch` receives (`https://hub.test/hub/report`, method POST, body `JSON.stringify({ id: 'reported-chara', report: 'a report' })`); it mocks `fetch` and does not exercise the server.
- **Not traced:** whether the hub accepts `text/plain` for `/hub/report`; what the original report was that suggested the symptom; any run on a Node server. TODO(evidence): one run against a local stub hub, not the real service.

### CHORE-131 — The HTML chat export writes the character name, speaker names and persona name into the page unescaped

**Status (2026-10-07): done in `1b881d0c`.** The character name, speaker names and persona name are HTML-escaped (`&`, `<`, `>`, `"`, `'`) in the HTML file mode and in the clipboard table mode. Message bodies are unchanged. The line numbers below describe the code before the fix. Type: security hygiene. Filed from the alert-45 review (`1f056247`, which sanitised translated message bodies) and the maintainer's "Commit both, ticket names". The exported file is opened locally by the user, and a card's name is untrusted content because cards are shared.

- **TRACED (`exportChat`, `src/ts/characters.ts`):** `htmlChatParse` (line 270) covers message bodies only (`parseMarkdownSafe`, plus `sanitizeMarkdownSafe` after translation). It does not touch names. In the HTML file mode, `name` (line 311: `findCharacterbyId(v.saying).name`, `char.name` or `getUserName()`) is interpolated into `<h2>${name}</h2>` (line 313). `${char.name}` is interpolated into `<title>` (line 322) and the first-message `<h2>` (line 359). Only the embedded chat JSON is escaped (`<` and `>`, line 367).
- **Same pattern in the table mode** (copied to the clipboard as `text/html`, not written to a file): `${name}` in `<td>` (lines 382-384) and `${char.name}` in `<td>` (line 396).
- **TRACED:** the file name is stripped of `<>:"/\|?*.,` (line 373), which is unrelated to the page body.
- **INFERRED:** a name such as `</title><script>...` would be written as markup; not run.

### CHORE-132 — The Node server crashes at startup when TRUST_PROXY is the string `true`

**Status (2026-10-07): done in `1b881d0c`.** `TRUST_PROXY` `true` and `false` (any case, trimmed) are now booleans, a whole number is a hop count, a blank value is unset, and anything else goes to Express as the trimmed string; the server starts with `TRUST_PROXY=true`. `server/node/readme.md` now documents the environment variables and the proxy's header rules. The rest of this entry is the filing record. Type: bug, plus a docs gap. It predates the batch-2 dependency update and is unrelated to express-rate-limit.

- **MEASURED in the batch-2 review gate's scratch run (2026-10-07; ledger row 1406):** running `server/node/server.cjs` with `TRUST_PROXY=true` exits with `invalid IP address: true`. It is not in the message of `dd8f269d`, and the crash predates that commit. I did not re-run it.
- **TRACED cause:** `server.cjs:3-5` does `app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY)`. `Number('true')` is `NaN`, so the string `'true'` is passed. Express 4.22.3 `compileTrust` (`express/lib/utils.js:215-235`) accepts only the boolean `true`; a string is split on commas and handed to `proxyaddr.compile`, so `'true'` is treated as an IP or subnet. TRACED by the fact-check: `proxyaddr.compile(['true'])` on proxy-addr 2.0.8 (express 4.22.3 depends on `~2.0.7`) throws `invalid IP address: true` at `proxy-addr/index.js:163`. A number such as `1` works because it becomes a hop count.
- **MEASURED in the batch-2 review gate's scratch run (2026-10-07; ledger row 1406; the log-noise sentence is also in the message of `dd8f269d`):** since express-rate-limit 8.6, which landed in `dd8f269d`, a server behind a reverse proxy without `TRUST_PROXY` logs an `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` validation error for each limited request that carries `X-Forwarded-For`. Responses and limits are unaffected.
- **Docs (TRACED):** `server/node/readme.md` does not mention `TRUST_PROXY` (no match for the name, "proxy" or "PORT"). It appears only as a commented-out example with the value 1 in `server.sh:39` (`# export TRUST_PROXY="${TRUST_PROXY:-1}"`) and `server.bat:40` (`REM if not defined TRUST_PROXY set "TRUST_PROXY=1"`). `server.cjs` reads `TRUST_PROXY` (line 3), `RISU_REVISION_LOG_COMPACT_AT` (line 70), `RISU_ALLOWED_ENV` (line 501) and `PORT` (line 1947), so the earlier "reads only `PORT` and `TRUST_PROXY`" in the Roadmap (near line 5730) is stale.
- **Direction (non-normative):** map the strings `true` and `false` to booleans before `app.set('trust proxy')`, and document `TRUST_PROXY` in the readme.

### CHORE-133 — Translator `combineTranslation` single-sentence case sets `node.innerHTML`

**Status (2026-10-24, lane A records batch 5): fixed** on `lane-cloud` (`MC-718` 4; commit `18a2c7a`; merged in `19625c694`). The one-sentence branch writes the flattened source text with `textContent`. The edit-display sibling is CHORE-500 (parked).

**Status (2026-10-08): open; gated, not now (`MC-245` 1: "File a ticket (Recommended)").** Type: security hygiene. Filed from finding F4 of the security triage (ledger row 1408), which `MC-238` left undecided.

- **Task (the maintainer's answer):** trace where the markup that reaches that `node.innerHTML` assignment can come from, then insert it as text or sanitize it. TODO(evidence): the file and line of the assignment are not in the sources given for this entry (only ledger row 1408 and `MC-238` name the case); take them from row 1408 before planning.
- **Gate:** the change touches rendered content, so it needs a plan review and a post-implementation review; sanitizer-output tests require jsdom and identity-sanitizer falsification (`MC-239`).

### CHORE-134 — Android release build: controls sit under the status and navigation bars

**Status (2026-10-09): CLOSED by the sidebar and Android batch (`7921b287`, `MC-253` 3, 7 and 9; ledger rows 1493 to 1505).** The page is padded clear of the status bar, navigation bar, cutout and soft keyboard app-wide (one content-frame padding), measured at page level (inner size, rail, chat) on the debug build as `MC-245` 3 asked; device passes 1 and 2 measured it on the Note 9 (API 29) and the API 35 emulator (3-button and gesture, portrait and landscape). **Closed with the note, by the maintainer's answer "Close with the note (Recommended)" (`MC-253` 9):** the release build was checked only for the keep rules (R8 keeps both JavaScript bridge methods, checked in a scratch copy on the pre-amendment Kotlin; the bridge classes and `proguard-rules.pro` are unchanged in the commit), not by a release run; a full release-build device check happens anyway before the first release. **Earlier status (2026-10-08): open; queued (`MC-245` 3: "Ticket a fix (Recommended)").** Type: bug, Android layout.

- **Task (the maintainer's answer):** apply safe-area insets on Android, and check the result against the debug build in the Note 9 session (handoff queue item 5; installing the debug build needs the maintainer's approval to uninstall the release build). TODO(evidence): the symptom's screens, the build it was seen on and the mechanism are not in the sources given beyond the one-line description.

### CHORE-136 — Sidebar backdrop fade names keyframes that do not exist

**Status (2026-10-09): CLOSED by the sidebar and Android batch (`7921b287`, `MC-253`).** The two `animation-name` references now point at the existing keyframes and `!important` is removed from the four keyframe declarations (the plan's reading of the CSS Animations rule is that `!important` inside a keyframe is ignored; the fade packet marked this as inferred from the spec, not executed). Note 9 (pass 1) and emulator (pass 2) samplers saw the background interpolate 0 to 0.5 on open (about 340 to 365 ms) and back to 0 on close (about 370 to 480 ms). **Earlier status (2026-10-08): open; found during Stage 4, deliberately not fixed there.** Type: bug (suspected cosmetic).

- **TRACED at `main` `8f4a5be6` (this entry's writer, `src/lib/SideBars/Sidebar.svelte`):** `.sidebar-dark-animation` sets `animation-name: sidebar-dark-transition` and the closing class sets `sidebar-dark-closing-transition`, but the file defines `@keyframes sidebar-dark-animation` and `@keyframes sidebar-dark-closing-animation`; no `@keyframes` carries the names the rules use. The Stage 4 packet reports the backdrop as a static `rgba(0,0,0,.5)`. The visible effect (no fade) was not observed by this entry's writer.
- **Dependency:** the finger-following backdrop (CHORE-135) must be built new.

### CHORE-137 — Android cold start sometimes hangs on "Loading..." / "Checking Files"

**Status (2026-10-09): fix in `5bc929da` (pushed; `MC-258`); cause established from source and ANR traces; on the API 35 emulator 0 of 10 cold starts hung against 4 of 10 (plus one extra probe) on `HEAD`; the Note 9 never reproduced the hang, so there is no phone-side confirmation (see the "Evidence the hang is gone" bullet).** **Earlier status (2026-10-08): open; cause unknown; needs observation without a debugger.** Type: bug, Android, pre-existing.

- **Observations (Orchestrator's facts file: earlier cold-start runs, per the session facts, and the Stage 5 amendment 2 pass, session scratch):** build A hung 3 of 16 starts and build B 1 of 16; seen again 3 times in the amendment 2 pass: on the first launch after install, while CDP polled during boot, and one reload stuck for 14 minutes. Whether the debugger or polling causes it is not established.
- **Needed:** an observation that does not attach a debugger or poll during boot.
- **Update 2026-10-09 (device pass 2, `batch\device2\report.md` section 5; evidence `emu-base-anr2.txt`, `emu-new2-anr.txt` in session scratch):** the hang was seen again with no CDP attached during boot: BASELINE 4 of 5 emulator boots, the amendment build 2 of 7 emulator boots; Note 9 0 of 3 cold starts. ANR traces (taken with adb root on the userdebug emulator) show the main thread in the native `Rust.onPageLoaded` called from `RustWebViewClient.onPageFinished` (`RustWebViewClient.kt:79`), in both builds. So the hang does not need a debugger or polling, and it also occurs on the pre-batch build. What blocks inside `onPageLoaded` is not established. Interacts with the "Android boot time" queue item below.
- **Cause and fix (2026-10-09; investigator report `chore137.md` and its independent verification `chore137-verify.md`, both session scratch `androidboot\`; ledger rows 1517 and 1518; verification verdict "HOLDS WITH CORRECTIONS"; resolved crates tauri 2.12.1, wry 0.57.0, tauri-plugin-fs 2.6.0 from the local `Cargo.lock`, which is gitignored).** A lock-order cycle between two threads. The UI thread runs `onPageFinished`, then `Rust.onPageLoaded`, then tauri's page-load closure, which takes `AppManager::plugins` (taken even though no plugin hooks page load). The single `JavaBridge` thread carries every invoke on Android (postMessage IPC); a synchronous (plain `fn`) plugin command runs entirely inside that same `plugins` lock. The fs commands `exists`, `mkdir`, `remove`, `rename` and `stat`, and `plugin:path|resolve_directory`, resolve `BaseDirectory.AppData` through a mobile call that posts a job to the UI thread and blocks on a receiver. The UI thread never returns to its looper to run the job, so neither side proceeds. The verifier added that the first fs call also resolves the global fs scope (about 20 `$APPDATA`/`$APPCONFIG`-style entries, each a UI round trip, under the same lock), which widens the boot window (the investigator's explanation of the emulator's high hang rate, slow arm64 translation, is incomplete without it); a three-party variant with an async command is possible while that cache is cold. The same bug is upstream tauri-apps/tauri#14694 (open; the investigator found no released fix in tauri 2.12.1, the newest stable, checked 2026-10-09; the verifier spot-checked the issue state only). Mechanism: confident (every link read in source, both ANR traces consistent). Not established: which command was in flight at hang time (native frames in the traces are untranslated; an x86_64 Rust build would symbolize them).
- **Fix (`5bc929da`, `MC-258` 1, 5):** boot, save and the asset sweep reach the app data directory only through new async Rust commands (`app_fs_exists`, `app_fs_mkdir_all`, `app_fs_remove`, `app_data_dir_path` in `src-tauri/src/app_fs.rs`, over `chunked_io::resolve_addressable`, called through `src/ts/storage/appFs.ts`); async commands do not hold the `plugins` lock. The only plugin commands left on those paths are `read_dir` (async) and the pure `join`. The same code path serves desktop and Android. Recorded differences from the plugin: the JS key check accepts `\` where the Rust check refuses `\` and `:` on Windows (store keys never contain them); a symlinked parent directory is followed, as `read_range` and `write_chunk` already do; a file where a boot directory should be now fails `create_dir_all`. Test `tauriAndroidNoSyncPlugin` and the boot wire test `bootstrap.androidBoot` pin the commands the page sends; they do not prove the shell no longer hangs.
- **Evidence the hang is gone (device pass 1, session scratch `androidboot\device\emu\report.md` and `device\note9\report.md`; ledger rows 1532 and 1533):** emulator (detector: root `kill -3` after the start settles and again at 90 s, main thread in `Rust.onPageLoaded`) build A (`890f5f20`) 4 of 10 cold starts hung (plus one extra probe), build B (the fix) 0 of 10, build C (the fix plus the archive pass, archived profile) 0 of 10. Note 9 (no root; the detector was an input key event at 90 s plus a logcat `ANR in`, with no positive control) A 0 of 15, B 0 of 10, C none in about 27 boots: the Note 9 never reproduced the hang, so it adds no A-against-B evidence. The round 2 logcat checks (device pass 2; F6 in `device\note9-2\report.md` and `device\emu-2\report.md` and the equivalent lines of the round 1 reports) report no ANR; hangs were not counted again. Emulator timing is arm64 under translation, not a phone figure.
- **Accepted residuals (Gate 2 round 1, `gate2\round1.md`):** the underlying tauri defect remains, so any future synchronous plugin command that does a UI round trip on a boot or page-load path would form the same cycle. Remaining synchronous plugin call sites that were found and accepted: `util.ts` dialog branch (dead behind `domSelect`), the desktop-only branches of `util.ts`, `backuplocal.ts` `remove` after a failed export, and `models/local.ts` path calls (unreachable off Windows). The verifier named two latent hazards not reached today: `path|basename`/`extname` on `content://` URIs and fs `open` of a `content://` URL.

### CHORE-138 — The triple-touch counter has no `touchcancel`

**Status (2026-10-24, lane A records batch 5): fixed** (`MC-717` 1; commit `bae8761`; merged in `19625c694`). A `touchcancel` listener resets the count; regression test `src/ts/hotkey.touchcancel.test.ts`. Real Android WebView cancel behaviour is untested.

**Status (2026-10-08): open; pre-existing.** Type: bug, low. `src/ts/hotkey.ts` counts touches for the triple-touch gesture and has no `touchcancel` handling (`MC-250` accepted limitation; Stage 4 Gate 2). Checked at `8f4a5be6`: the triple-touch block in `hotkey.ts` (about lines 399-419 at that commit) registers only `touchstart` and `touchend`; a `touchcancel` listener elsewhere in the same file (about line 550) sits in a separate block whose purpose was not traced.

### CHORE-139 — `removeChar` leaves a just-emptied folder in place

**Status (2026-10-24, lane A records batch 5): fixed** (`MC-717` 2; commit `299ca20`; merged in `19625c694`). `checkCharOrder` drops a folder it has just emptied, in one pass, and the double-call workarounds are removed.

**Status (2026-10-08): open; latent.** Type: bug, latent. Stage 5's `trashFolderMembers` calls `checkCharOrder` twice to avoid the effect (Orchestrator's facts file; Stage 5 implementation report, session scratch). TODO(evidence): the `removeChar` trace and a reproducer outside that workaround.

### CHORE-142 — `Agents/Tools/generate-and-verify.harness.ts` is broken

**Status (2026-10-24, lane A records batch 5): fixed**, in the harness file only, with the same `appStore` mock (Gate 2 `[APPROVE]`, row 5001); merged in `19625c694`. The lane Cloud records correct the path: the file is under `Agents/Tools/save-gen/`.

**Status (2026-10-08): open.** Type: tooling. Listed in the Orchestrator's facts file without details. TODO(evidence): the failure and the commands that show it.

### CHORE-143 — A ResizeObserver-loop event makes `bootstrap.ts`'s global error handler throw before `alertError`

**Status (2026-10-24, lane A records batch 5): CLOSED, already fixed on the fork** (`MC-717` 3). `handleWindowError` warns only for events without an error object (`windowErrorGuard.test.ts`). Upstream still has the defect.

**Status (2026-10-08): open.** Type: bug, low. Per the Orchestrator's facts file: the handler in `src/ts/bootstrap.ts` reads `event.error.target` when `event.error` is null, so it throws before `alertError` runs; the user sees no alert. TODO(evidence): the trace and the reproduction (not re-traced for this entry).

### CHORE-144 — Test-suite fragilities seen during the sidebar closeout

**Status (2026-10-24, lane A records batch 5): CLOSED as observed, no code change** (`MC-702` 2). Item 2 did not reproduce on current main; items 1 and 3 are UNCERTAIN and did not reproduce; item 4 is confirmed as a Node 24 test-environment issue only (msgpackr). Reopen with a recorded seed or the failing message.

**Status (2026-10-08): open.** Type: tests. Per the Orchestrator's facts file (investigation `sidebar-s5\final2\flake.md`, session scratch):
- `backuplocalCharacterIdsExport` "(G) ... byte for byte" (SavePartialLocalBackup) failed once on the Stage 5 snapshot run (1 failed / 12087 passed); not reproduced; Stage 5 is not on its path (the test mocks `src/ts/characters`).
- `backuplocalEncryptedRefusal` fails under `--sequence.shuffle`.
- `nodeHttpStore` failed once with ENOBUFS under load (full suite on the real tree: 4 of 5 clean, 12088 passed in a clean run).
- `msgpackr` 1.10.1 `utf8Write` threw `ERR_BUFFER_OUT_OF_BOUNDS` on Node 24 in a standalone script; not checked inside vitest or the app.

### CHORE-145 — Android edge-to-edge: the rail's Plus button at the list end is partly under the 3-button navigation bar

**Status (2026-10-09): CLOSED by the sidebar and Android batch (`7921b287`, `MC-253` 3).** Device pass 1 and 2: the rail's Plus button bottom matched the page bottom (773.6 against 773.7 css px on the Note 9 in 3-button mode). **Earlier status (2026-10-08): open.** Type: bug, Android layout. Related to CHORE-134 (safe-area insets). Source: the Orchestrator's facts file; TODO(evidence): the screenshot or measurement.

### CHORE-152 — Slow and flaky test: `src/ts/storage/tests/assetPieceSave.test.ts`

**Status (2026-10-24, lane A records batch 5): fixed, test-only** (`MC-702` 1; `src/ts/storage/tests/tauriChunkFake.ts`; Gate 2 `[APPROVE]`, row 5006); merged in `19625c694`. The file takes 23 of 23 in about 10 s, against 35.7 s before (a loaded Linux machine; timings indicative only).

**Status (2026-10-09): open.** Type: tests. Related to CHORE-144.

- On the upstream-merge snapshot (`merge\test.txt`, session scratch) the full `pnpm test` run failed once: the test "reproducer: a plain-HTTP page gets the content-hash key, the same key crypto.subtle gives" timed out at 5,000 ms (593 files, 12,139 passed, 1 failed, 6 skipped; duration 132 s). The Orchestrator reports all 23 tests in the file pass when it is run alone and that the file takes about 61 s. The earlier batch run (`batch\final\test.txt`, 12,140 passed) did not fail. Cause not investigated.

### CHORE-176 — Android launch splash with the RisuTanium mark, and no white or black frame before the page's loading screen

**Status (2026-10-10): COMPLETE after the closeout of ledger row 1639 (technically accepted, committed `0053287e` (10 paths, 64 insertions) and pushed; `MC-272`; ledger rows 1633 to 1638); the records are verified by `doc-verifier` (row 1640), fixes applied.** Type: feature (Android).

- **Decisions (`MC-272`):** logo `docs/branding/RisuTanium_Gradient.svg`; light background the primary blue #3B82F6, system night the default theme background #282A36; built alongside the M5 measurement; the previews approved; dark bar icons on the light splash; the white or black flash removed with a colour fill (#101828, the loading-screen colour) rather than by holding the splash; the remaining #282A36 gap accepted.
- **Shipped (commit message of `0053287e`, `splash\coder-report.md`):** `MainActivity` starts on `Theme.risuai.Starting` and calls `installSplashScreen()` before `super.onCreate`, which hands over to `Theme.risuai`; the library is `androidx.core:core-splashscreen` 1.2.0 (coder report). The icon is a 288 dp vector of the gradient mark inside the circular mask API 31+ applies. Bar icons are dark on the blue splash and light on the night splash. `Theme.risuai`'s window background, in the default and the night variant, is #101828, and the WebView's background is the same colour until the page paints.
- **Gates:** Gate 2 static `adversarial-reviewer` `APPROVE` (row 1634); Gate 1 on the dropped hold plan `[PASS WITH FIXES]` (row 1637); Gate 2 on the full change, 9 paths, `[PASS WITH FIXES]` (row 1638): F1, the night `Theme.risuai` lacked a window background; the Orchestrator fixed it (the tenth path) and the v4 device round confirmed it. No `pnpm test` or `pnpm check` run is recorded for this item in the sources given; the commit has no TypeScript path.
- **Device (Note 9, API 29, debug build; row 1635):** cold starts show 0 white or black frames (light 98, dark 105 frames; one cross-fade frame in light) against a baseline of 5 white and 6 black; warm start and rotation fine; the release R8 minify task succeeds. The Rust release library and the release APK were not built.
- **Accepted limitation:** a short interval shows the content-frame colour #282A36 before the loading colour #101828 (the maintainer's "Keep it, then review").
- **Not verified:** API 31 and 32 and the API 31+ platform-splash behaviour (no device or image).
- **Dropped:** the plan to hold the splash until the page paints (row 1636, Gate 1 row 1637); not implemented.
- **Observation, not a bug, unticketed (the Orchestrator's brief; not re-checked here; the Roadmap tracks no such item):** the auto-generated VIEW intent filter has no scheme or host, so launching from a file could not be tested.

### CHORE-181 — Back with a dialog or alert open quits the Android app with no toast and does not close the dialog

**Status (2026-10-24, lane A Roadmap cleanup): COMPLETE.** Merged in `c4dc06dbc`; Gate 2 round 2 `[APPROVE]`; phone 2 check done; decisions `MC-346`, `MC-455`, `MC-458`; spin-offs are CHORE-350 to CHORE-354; nothing owed (closeout check, ledger row 2261).

**Status update (2026-10-22, lane A, fifth): merged in `c4dc06dbc` (no-ff of `00ae53c77`; `MC-346`, `MC-455`, `MC-458`); technically accepted (lane E rows 3551 to 3561). The phone 2 check is done (ledger row 2176; the report `%TEMP%\risu-b715\c181-phone\report.md` is verified with corrections): cells 1 to 3 and 6 pass; cell 4 persisted 4 of 4. Full checks on `c4dc06dbc`: `pnpm test` 20,915 passed; two `regexEarlyReject` tests timed out in the full run and passed alone (21 of 21), and lane D's 60 s describe timeout (`e63a3eea8`) fixes them (rows 2171 and 2172). The large-profile Back delay (the second Back quits only through the host's 1 s timeout, and no hide event fires on that quit) is CHORE-354, low priority; it is not a loss and is not shown to be a regression of this item.**

**Status update (2026-10-22, lane A, fourth): answers relayed, MC-455 pending in lane E records.**

**Status update (2026-10-22, lane A, third): the Back-guard flush deferred by CHORE-153 is recorded here (lane E).** The CHORE-153 commit (`c5c6897f5`) leaves the Back-guard flush open, and it is tracked under this item. Not scheduled. Lane E's plan puts this item after CHORE-117 stage 2, with normal gates; S4-5 is merged in `3a0f2cf0c`.

**Status update (2026-10-22, lane A): behaviour decided (`MC-346` 2), amending `MC-279` 8 for the dialog case; not yet planned or implemented.** With a dialog open, Back closes or cancels that dialog; a second Back then follows the normal 2 s quit guard. Lane E's audit (rows 2144 and 2145; source reading, not executed) finds the ticket STILL PRESENT: with a dialog open `dispatchBack` returns false and the Activity runs the default Back at once, so the 2 s guard does not apply. Lane E owns the fix, with the debounce test, after S4-5 (now merged, `3a0f2cf0c`; `GridCatalog.svelte` overlaps) (`MC-345` A3).

**Status (2026-10-12): open; not planned; the maintainer chose to keep the rule for now and open a ticket (`MC-279` 8: "Keep, open a ticket (Recommended)").** Type: limitation (Android Back); the app-wide scope is INFERRED (see Cause).

- **Observed (MEASURED, `charlist\note9-s4-3.md` check 5; Note 9 API 29, debug build of `d6717f66` plus the uncommitted S4-3 tree):** with the Grid hold menu (an `alertSelect` prompt) open, Back exited the app at once (the process was gone and the launcher resumed); the menu did not close, edit mode did not exit and no toast showed. The order was unchanged after a relaunch. A second Back could not be tried because the app was gone. The S4-2b pass had already seen it with a dialog open (`note9-s4-2b.md`, as summarised in the S4-2 section below: "with a dialog open Back quits at once").
- **Cause (INFERRED from source reading, not executed here):** the S4-2b plan rule "an open dialog keeps Back quitting" (`MC-278`, Orchestrator plan rules). While `pageCovered()` is true the edit-mode Back handler declines (read by the S4-3 Gate 2 in `GridCatalog.svelte`), and the app's older Back behaviour, which quits, runs. The rule is app-wide, so any `alertStore` prompt is affected; only the Grid hold menu and one dialog were observed.
- **Not decided:** whether Back should close the open prompt; the mechanism (the plan's reason for the rule was that a toast would replace or flicker the dialog); what a second Back should do. Related: CHORE-179 and CHORE-180.

### CHORE-182 — A large `.bin` import on Android does not check free storage first; the time warning only states the space needed

**Status (2026-10-24, lane A Roadmap cleanup): COMPLETE.** Merged in `f8d5ec5f3`; Gate 1 `[APPROVE WITH AMENDMENTS]`, Gate 2 `[APPROVE]`; phone 2 check done and doc-verified (low-space branch proven on the PC only); decisions `MC-431`, `MC-432`, `MC-434`, `MC-347`; nothing owed (closeout check, ledger row 2261).

**Status (2026-10-22, lane A): merged in `f8d5ec5f3` (the no-ff merge of lane C's `worktree-Lane-C` at `4e2f44154`, on top of `14d713594`); technically accepted; the phone check report is doc-verified with corrections (row 2152: Check 1's raw CDP output was not archived, so its exact match is unverified; the build, Check 2 and the picker diagnostic are confirmed).** Gate 1 `[APPROVE WITH AMENDMENTS]` and Gate 2 `[APPROVE]` (rows 3309 and 3311); decisions `MC-431` 1, `MC-432` (warn and ask to continue when short; fall back to today's text when the read fails; every Android import; Android only), `MC-434` (commit on the lane branch) and `MC-347` (merge plus fold-in); lane C ledger rows 3307 to 3318. Behaviour as committed: every Android `.bin` import reads the free space of the app data directory before anything is written (`statvfs`, `f_bavail` × `f_frsize`, through the new Rust command `app_data_free_bytes`) and compares it with the existing need (1.1 × assets + 512 MiB). Above 1 GiB of assets the time notice states the free figure; at or below it, a short import gets one new prompt; enough or unknown behave as before; a failed read falls back to the old "cannot check" text; nothing is refused for size (`MC-319` 5); other platforms are unchanged (source: the commit message of `4e2f44154`). Full checks on `f8d5ec5f3` (lane A; output under `%TEMP%\risu-b715\records-lanec182\`, wall time 495 s): `pnpm test` 916 files passed, 1 skipped (917), 20,711 tests passed, 23 skipped (20,734); `pnpm check` 0 errors and 0 warnings; `pnpm build` passed (built in 35.91 s); `cargo test --lib` 189 passed, 0 failed; `pnpm hono:build` was not run. Phone 2 device check (`perf-analyzer`; report `C:\Users\yor42\AppData\Local\Temp\risu-b715\c182-phone\report.md`; row 2151; single device, one run): the build PASSED, and it is the first Android compile of `free_space.rs`; Check 1 and Check 2 PASS; the file picker does not copy the `.bin`. The low-space branch is proven on the PC only, not on the phone. The report is doc-verified with corrections (row 2152).

**Status (2026-10-20) (superseded by the status above): open; not planned; filed from the maintainer's B6g answer (`MC-320` 4: "state it for now, make it a ticket for later.").** Type: improvement (a check the current warning leaves out).

- **Today (on the unmerged `feat/alite-s4`, commit `bd4aa9e19`; ledger rows 1946 to 1952):** the Android time warning before a `.bin` with assets over 1 GiB states the free space the import needs (1.1 x assets + 512 MiB, in decimal GB) and says "The app cannot check how much is free." It does not check. Nothing is refused (`MC-319` 5).
- **Proposed (the ticket the maintainer asked for, per the decisions file's summary):** a small Rust command that reads free storage, so the warning can compare the need with what is free before the import starts. Its shape is not decided.
- **Why the number matters (device evidence, single runs on the Note 9):** D6c measured that the import adds about 1.05x to 1.08x the `.bin`'s size to the device beyond the file itself (2.05x only when the file must first be copied onto the device); the out-of-storage test was skipped (ledger row 1943). B6g Gate 1 C6: assets are content-named additions and the commit key flips last, so an import that runs out of space leaves the old commit key current ("not changed until the import has finished" holds by construction but is untested); a full phone can still stop the old profile from saving later edits.
- **Not decided:** what the app does when free space is below the need (warn only, or refuse; `MC-319` 5 says nothing is refused for size); which platforms get the check (the warning is Android-app only, `MC-320` 3).
- **Related:** `MC-320`, `MC-319`, `MC-130` 4; B6g.

### CHORE-187 — `writeModuleCard` and `shareRealmCardData` hide errors raised inside `writeCharacterCard`'s try (pre-existing)

**Status (2026-10-24, lane A Roadmap cleanup): COMPLETE.** Merged in `b87e457f9`; Gate 2 `[ACCEPT WITH NITS]`; decision `MC-454`; a truncated file after a failed module export is an accepted limit; nothing owed (closeout check, ledger row 2261).

**Status update (2026-10-22, lane A, fourth): fixed and merged in `b87e457f9` (no-ff of `dcbf1ad0f`, lane E; `MC-454`); technically accepted; lane E's rows 3543 to 3550 are folded into the ledger.** Full checks on `b87e457f9` (`%TEMP%\risu-b715\records-e187\`): `pnpm test` 919 files passed, 1 skipped; 20,836 tests passed, 23 skipped; `pnpm check` 0/0; `pnpm build` passed. A failed export now reports failure: a module export with a failing asset shows no success alert, a cancelled Tauri save dialog is silent, and a Realm share posts nothing and closes the frame. Not changed: a failed module export leaves the truncated file the person chose (`LocalWriter` has no abort).

**Status (2026-10-21, upstream `61d0eb79a` merge close): open, not scheduled.** Source: N1 in the U0 Gate 2 round 2 and 3 verdicts (`upstream-e773240\u0\g2r2-verdict.md`, `g2r3-verdict.md`). Not caused by the merge; the same masking existed on `main`.

- **Problem:** callers that pass a writer hide every failure raised inside `writeCharacterCard`'s try (v3 asset `readImage`, `compressImage`, the writer's `write` and `end`, and others). The verdict says a module export of a module with a failing asset reports success over a truncated file and a Realm share posts a partial buffer; the closeout notes say an empty file and an empty buffer. Only the image read before the try rejects (to the global handler); these in-try errors were hidden on `main` too.
- **Decided at implementation (lane E; the orchestrator chose a boolean result, Gate 1 agreed; the maintainer approved the commit under `MC-454`):** `exportCharacterCard` and `writeCharacterCard` return a boolean, and `shareRealmCardData` returns `null` on a failed export. Rethrowing after `alertError` when `arg.writer` is supplied is rejected: the unawaited `exportModule` call would reach the global rejection handler and alert twice.
- **Related:** the card export image fallback in the merge (`76a36fac5` reads the card image before the try, so that one error rejects).

### CHORE-192 — The `addTTSPreprocessor` JSDoc example in `risuai.d.ts` closes the comment early

**Status (2026-10-24, lane A Roadmap cleanup): COMPLETE.** Merged in `fa5111580`; Gate 2 `[EDITORIAL]` then `[APPROVE]`; nothing owed (closeout check, ledger row 2261).

**Status (2026-10-22, lane D): fixed and merged in `fa5111580` (lane D; fix commit `b26a245b0`); technically accepted.** Ledger rows 2501 to 2505. The earlier status and the body below stand, except as corrected here. Mechanism (executed by lane D): the TypeScript parser reports 110 syntactic diagnostics from 1941:56 to the end of the file; `pnpm check` never reported them because `skipLibCheck: true` skips `.d.ts` files. Fix: the example reads `/\*(.*?)[*]/g`, which matches the same text (the reviewer compared both on five inputs). New parser-based test `src/ts/plugins/apiV3/tests/v3DeclarationDocs.test.ts`: both tests fail on a copy with the original line and pass on the fixed file (regression reproducer). Gate 2 `[EDITORIAL]` (row 2502), then `[APPROVE]` on the delta (row 2503). Full checks on lane D's tree (row 2504): `pnpm check` 0 errors and 0 warnings; `pnpm test` 899 files passed, 1 skipped (20,189 tests passed, 23 skipped); `pnpm build` exit 0.

**Status (2026-10-21, upstream `61d0eb79a` merge close): open, not scheduled.** Pre-existing on `main` and in upstream. The example regex `/\*(.*?)\*/g` contains `*/`, which ends the JSDoc block early (`src/ts/plugins/apiV3/risuai.d.ts`, the `addTTSPreprocessor` example, opened 2026-10-21). Source: U0 closeout notes.

### CHORE-193 — Load-sensitive tests: `assetPieceSave` "without crypto.subtle" times out at 5 s under full-suite and `pnpm check` load; `firstLife` and `storeImportBoot` flakes

**Status (2026-10-24, lane A Roadmap cleanup): COMPLETE.** Merged in `bdba81fd6` and `344b715bd`; Gate 2 recorded per step; decisions `MC-450`, `MC-451`; stated fixture limits accepted; nothing owed (closeout check, ledger row 2261).

**Status (2026-10-22, lane E steps 4 and 5, `MC-451`): the leftovers are fixed and merged in `344b715bd` (lane E); technically accepted; this supersedes the earlier status's "`storeImportBoot` has no change" and its remaining fixture limits.** The maintainer approved the commit of both steps on `worktree-Lane-E` (2026-10-22). Committed as `675f01191`. The merge was approved in `MC-342` 2. Ledger rows 3508 to 3515. Step 4 (rows 3508, 3510, 3512, 3513; technically accepted): `nodeServerFixture.ts` checks after the ready line that `/api/test_auth` answers as `server.cjs` does (5 s bound; otherwise the launch counts as "address in use" and the first launch takes a new port), which closes the Windows `127.0.0.1`-only squatter at launch; a restart retries the same port up to 5 times, 150 ms apart, only when the port is in use; a test-only `portSource` option lets the new `nodeServerFixture.test.ts` keep the port-retry proof in the repository (6 tests; the squatter and restart cases fail with only the seam and pass with the fixes). Step 5 (rows 3509, 3511, 3514, 3515; technically accepted): `storeImportBoot` was not load-only after all. The alert mock is shared across tests, and under a 200 ms delay on every file read the base failed 3 of 12 (the two "notice, awaited" tests and then the cancelled-import guard, which saw an earlier test's notice); the two tests now wait for the notice (10 s bound) instead of a fixed 300 ms and always release and await their flow. The original `storeImportBoot` failure text was never recorded, so its link to this mechanism is inferred. Limits that stay: a socket that takes the port after the identity check, or one that answers the same JSON; the MaxListeners warning from one exit hook per fixture (not a regression). Full `pnpm test`, `pnpm check` and build on the merged main snapshot: lane A, passed at the fold-in: 911 files passed, 1 skipped (20,553 tests passed, 23 skipped); svelte-check 0 errors, 0 warnings; pnpm build OK.

**Status (2026-10-22, lane E steps 1 to 3): triage done and verified with corrections; steps 2 and 3 implemented and merged in `bdba81fd6` (lane E); technically accepted.** Ledger rows 3500 to 3507. Per file (rows 3500 and 3501): `saveLoop` is a race in the test, not load (the retry can run before the test's revert); `blockStore.node` is load with a possible cascade into the next test (seen once by the investigator, not by the verifier in three runs); `risuSave.msgpackRelease`, `assetPieceSave`, `tauriFilesStore.desktop` and `memorySummarizerSubject` are load-only; `firstLife` is most likely the probe-then-spawn port gap in the shared fixture `nodeServerFixture.ts` (inferred: the original EADDRINUSE log was not kept); `storeImportBoot` has no failure in the logs and gets no change (superseded by the status above). Step 2: the saveLoop race and per-test time bounds in the five slow files; technically accepted (Gate 2 row 3504); the maintainer approved its commit on `worktree-Lane-E` (2026-10-22). Committed as `4cf1cce22`. Step 3: the fixture port retry (`MC-450`); technically accepted (Gate 1 row 3505, Gate 2 row 3507); the maintainer approved its commit on `worktree-Lane-E` (2026-10-22). Committed as `eb7fa1366`. Remaining after both steps (superseded by the status above, which fixes `storeImportBoot`, the squatter and the restart gap): `storeImportBoot` has no change (no failure evidence); a Windows `127.0.0.1`-only port squatter and a restart's rebind gap remain in the fixture; neither step has a full-suite run in lane E (lane A runs the full checks at merge). The merge was approved in `MC-339` 2. Full `pnpm test`, `pnpm check` and build on the merged main snapshot: lane A, passed at the fold-in: 903 files passed, 1 skipped (20,318 tests passed, 23 skipped); svelte-check 0 errors, 0 warnings; pnpm build OK.

**Status (2026-10-21, upstream `61d0eb79a` merge close): open, not scheduled.** Test-only. Sibling of CHORE-185.

**Status (2026-10-22): open; triage planned.** New load failures were seen in the full runs on merged lane B stage 3 beyond `assetPieceSave`, `firstLife` and `storeImportBoot`: `risuSave.msgpackRelease` (5000 ms test timeouts), `tauriFilesStore.desktop` (a 5000 ms test timeout), `memorySummarizerSubject` (a 10000 ms hook timeout), `blockStore.node` (a 5000 ms test timeout) and one `saveLoop` test (an assertion failure, not a timeout; cause not traced). The logs are `%TEMP%\risu-b715\merge-b3\test*.txt` (scratch); see ledger row 2121. The stage 3 cascade in `backuplocalAssetBatch.test.ts` was a separate isolation defect, fixed in `92f7d900a`. **Next** (the maintainer's plan of 2026-10-22, as relayed by the orchestrator): a bounded investigation classifies each file as load-only or as an isolation or cascade defect and proposes fixes per file. It goes to a new lane E, or to lane B between stages (`Agents/Lanes/lane-E-brief.md`).

- **`assetPieceSave.test.ts`, "saveAsset without crypto.subtle > reproducer":** "Test timed out in 5000ms" in the final full run at `cd49e8271` (`b64\full\pnpm-test.txt`: 20108 passed, 1 failed; the file took about 51 s). The file passed 23/23 three times alone (orchestrator). The same timeout was seen in the U3 notes on a branch without the base64 change (under `pnpm check` load) and by the base64 coder in a full storage-folder run, so it is a load flake and not caused by the base64 encoder. The cause of the slowness is not traced; the test calls `loadWorld()` per case (test source).
- **`firstLife.test.ts`:** `EADDRINUSE` once under a directory run during the U3 stages; passed alone.
- **`storeImportBoot`:** judged a flake in U4a Gate 2 round 3 (3 of 3 passes alone).
- **Not decided:** raise the timeout, split the world load, or serialise the file.

### CHORE-194 — The import size and time warning is keyed on the database entry, which comes out low for stub-form files

**Status (2026-10-22, lane B stage 1): fixed and merged as `953f63241` (lane B stage 1); COMPLETE with this records pass; the Note 9 calibration is open under CHORE-220 (`MC-355` 2).** Ledger rows 2300 to 2306.

- **What changed:** `ColdEntryIndex.estimatedUnitBytes` (`src/ts/storage/store2/legacy/binReader.ts`) sums the `dataLength` of the entry the reader tries first per id (the last noted place): a name-only estimate that over-counts orphan units and rejected bodies, and under-counts units served from the page or the old profile and units served by an earlier entry. `confirmImportScale` (`src/ts/drive/storeImport.ts`) takes it as a fourth argument from its one call in `backuplocal.ts`; the 16 MiB size sentence and the long-tail key use the database entry plus that estimate. The 1 GiB Android trigger, the copy time and the free-space figure still use the file size less the database entry, so the units stay in them. The numbered-backup restore (`storeRestore.ts`, `confirmDatabaseSize`) is unchanged and keeps the database bytes. The sentence reads "The saved data in this backup, not counting images and other files, is about N MB" in English and six locales (`MC-356`).
- **Unchanged case:** a file without unit entries gets the same prompts and figures as before. A fork inline export with plugin-storage units or an upstream file with cold-chat units now counts them.
- **Not done:** the upstream `.bin` round trip was not run, because no read or write path changed (reasoning by the plan and both gates, not execution). The Note 9 figure (`MC-355` 2) and the mixed byte basis (CHORE-220) remain.
- **Related:** `MC-355`, `MC-356`, `MC-318` 6; CHORE-220.

### CHORE-195 — Hono server follow-ups after the hono 4.13.11 bump: the deprecated `hono/bun` import and the Node static server's double-decode fix

**Status (2026-10-24, lane A Roadmap cleanup): COMPLETE.** Merged in `fa5111580`; Gate 2 `[APPROVE]`; decision `MC-381`; Bun path not run (Bun not installed), accepted; nothing owed (closeout check, ledger row 2261).

**Status (2026-10-22, lane D): both follow-ups fixed and merged in `fa5111580` (lane D; change commit `e49013fd4`); technically accepted (Gate 2 `[APPROVE]`, row 2528).** Decision `MC-381`; ledger rows 2524, 2525, 2527 and 2528. The earlier status and the body below stand, except as corrected here. `server/hono/package.json` sets `@hono/node-server` `^2.1.5` (from 1.x) and adds `@hono/bun` 1.0.1; `server/hono/pnpm-lock.yaml` is regenerated with `corepack pnpm` 10.34.1 (`hono` stays 4.13.11); `server/hono/src/bun.ts` imports `serveStatic` from `@hono/bun`; `node.ts` is unchanged. Corrections to the body: GHSA-5r4p-p66f-jhc7 is the `hono` advisory (fixed by the 4.13.11 bump); the `@hono/node-server` advisory is GHSA-rmxm-3fg6-px4f (affected from 1.19.10, fixed only in 2.1.3 or newer; row 2525). Security note: GHSA-rmxm-3fg6-px4f in `@hono/node-server` 1.x (fixed only in 2.1.3+) was reproduced only with an old `hono` whose router matches the encoded path (`hono` 4.0.0 per row 2528 and 4.3.0 per the Gate 2 verdict: 200 on node-server 1.19.15 and 2.1.2, 404 on 2.1.3 and 2.1.5). A 165,600-path fuzz on 1.19.15 with `hono` 4.13.11 and the versions tried (4.6, 4.9, 4.11 and 4.12.0) found no bypass, so with our `hono` 4.13.11 the 2.x bump is hardening and exposure was nil (Gate 2; row 2524 judged it low to nil before the reproducer). Behaviour change: 2.x refuses static paths containing a literal `%` unless `allowPercentInPath: true`; no tracked or built file name under `public`, `static` or `dist` contains `%`; Node 20 or newer is required (root engines and CI Node 24 satisfy it). Checks: frozen install and `tsc --noEmit` exit 0 (the CI `hono-server` job's commands); the repo's own `src/node.ts` starts on 2.1.5 and serves `/` and static files. Not run: Bun (not installed), and the root application tests do not cover `server/hono`.

**Status (2026-10-21, filed at the maintainer's request after fork PR #9 was merged as `74b28ddd1`): open, not scheduled.** Server-only; no save-format or storage change.

- **Bump:** fork PR #9 (Dependabot) moved `hono` from 4.13.7 to 4.13.11 in `server/hono` (`package.json` and `pnpm-lock.yaml` only; the fork's three CI checks passed). 4.13.11 fixes `serveStatic` decoding the request path twice, so a crafted request could skip middleware mounted on a static prefix (GHSA-5r4p-p66f-jhc7, per the hono release notes quoted in the PR).
- **Follow-up 1:** `server/hono/src/bun.ts` imports `serveStatic` from `hono/bun`, which hono 4.13.10 deprecates in favour of `@hono/bun` and removes in v5. It still works in v4.
- **Follow-up 2:** `server/hono/src/node.ts` uses `serveStatic` from `@hono/node-server/serve-static`, locked at 1.19.15. The release notes say the same fix ships in `@hono/node-server` 2.1.3, a major bump that has not been assessed. Whether 1.19.15 is affected is not checked.
- **Not decided:** when to take either follow-up; whether a 2.x `@hono/node-server` needs other server changes.

### CHORE-204 — Device-script follow-ups (lane A)

**Device profile (2026-10-24, lane A records batch 6; not a CHORE item, placed here as the closest device-tooling entry; `MC-474` holds the maintainer's answers):** a synthetic device profile is being built so phone runs use synthetic data and throwaway keys (`MC-472`). Answers: a local OpenAI-compatible mock endpoint on the PC via `adb reverse` (fallback: a throwaway real key entered in the UI), at the maintainer's real shape with small assets. Stage A (the mock, its test, `mock-reverse.ps1`, Test-Runner and README) is committed as `26f92322f`, after Gate 2 `[APPROVE]` in round 2. The A2 PC smoke passed (non-stream JSON and SSE, against the real app). Stages B to E remain; stage B (phone 2) waits for the maintainer's go-ahead.

**Status (2026-10-22, fixed): items (a) to (e) are implemented, plus an added item (f), the `-WarnPattern` default; Gate 2 `[APPROVE]` in round 2; committed with the records (`MC-344`).** Ledger rows 2132 to 2135.

- **Implemented:** (a) the port defaults are 6330 to 6399 (inside lane A's range, clear of phone 1 and phone 2; two runs that both rely on the default still share it, which the README says). (b) Notices are dismissed at launch, on each import-watch poll and in the boot wait; the click needs one button whose label is OK in any case or the Korean OK label, no input, and text that does not match `-WarnPattern`; the dismissed text goes to `import.noticesDismissed`. (c) Fixed, not just documented: a waiter takes a stale lock by moving it to a tombstone named after the stale holder. (d) `restore-snapshot.ps1` uses `tar --no-same-owner -xf`. (e) `build-apk.ps1` fails early and names the missing generated Android files (`TauriActivity.kt`, `proguard-tauri.pro`); it copies nothing. (f) The default `-WarnPattern` now matches the English and Korean time and size warnings (`store2ImportTimeWarning`, `store2ImportSizeWarning`); the old Korean alternative matched neither, which is why phone 1 needed a manual Yes tap (rows 2130 and 2131).
- **Tests:** the fake-adb runner has 330 PASS and 0 FAIL (296 before the batch). Items (a) to (e) each have a mutant that turns a test red (row 2132). The (c) remediation and (f) have red tests instead: the "lock window" test is red on a seam-only copy of the old move-then-stamp order, and the warn-pattern test is red against the unmodified `import-bin.ps1` (row 2134); round 2 also ran the old-order and no-stamp variants, which failed (row 2135). No phone was used for the tests.
- **Gate 2:** round 1 `[REJECT]` on (c): the tombstone kept the stale lock's old mtime until a re-stamp after the move, so another waiter's 10-minute cleanup could delete it in that window (rare, a millisecond window; executed by emulation). The remediation stamps the lock before the move, through a `Move-LockFile` seam so the test can interleave waiters; round 2 `[APPROVE]` (rows 2133 to 2135).
- **Field use before the commit:** (b) ran on phone 1 in the CHORE-222 check (row 2130), from a scratch copy of the scripts; that copy's restore step is not shown to carry (d). The notice auto-dismiss dismissed one notice ("To keep memory use low, ..."), after the reload via the boot-wait path, and never clicked a two-button dialog; `c222-pre` was restored with `restore-snapshot.ps1` and verified against the manifest. This is one run on one phone; the app uid was the same before and after (10322), so the changed-uid case that (d) fixes was not exercised in that run, and the Korean OK label click is not shown by it. The size dialog there was the (f) miss.
- **Remaining limits** (README "Accepted limits" and the round verdicts): a tombstone stays until the next replacement removes ones untouched for 10 minutes; a stale holder identity cannot be claimed twice within 10 minutes (only a test could); a waiter stalled for more than 10 minutes between judging and moving is not covered; a failed timestamp update makes the waiter give up that attempt and look again. A single-button `error` alert is dismissed as a notice too (its text is recorded). The preflight checks only the two files that were seen to break the build. The dismissal costs one extra CDP call per poll during the import watch (not measured). The notice that the gap sweep hit is INFERRED from source, not observed.
- **Minor, non-blocking (round 2):** (A) `Remove-StaleLock` can write a non-terminating `Get-Item` error to stderr when another waiter has already moved the lock; the result is still false. (B) The old Korean `-WarnPattern` alternative is kept and matches neither warning (dead, harmless).

**Status (2026-10-22, earlier; superseded by the status above): open, in progress (both phone agents have finished; items (d) and (e) were added after their runs).** The work goes through one gated batch: a `sonnet-coder` in a scratch copy, a fresh `adversarial-reviewer`, one Copy-Item pass, then a byte-compare. Source: the maintainer's instruction of 2026-10-22, as relayed by the orchestrator.

- **(a)** The defaults `-PortMin 9500 -PortMax 9599` in `cold-start.ps1` and `import-bin.ps1` are outside every reservation in `Agents/Lanes/README.md` (lane A 6000 to 6399, B 6400 to 6419, D 6420 to 6439, C 6440 to 6459, E 6460 to 6479); the final Gate 2 found no collision (ledger row 2114).
- **(b)** `import-bin.ps1` does not dismiss the first-run startup notice that appears after the import commit. The gap sweep hit the 900 s cap on it, and the agent tapped OK by hand (ledger row 2117).
- **(c)** The stale-lock replace race from the final Gate 2 (two waiters that both judge a lock stale can each remove it and create their own, so the second deletes the first's fresh lock; narrow, low, no executed repro): fix it, or keep it as a documented limit (ledger row 2114).
- **(d)** `restore-snapshot.ps1` fails after an uninstall and reinstall (a debug/release swap), because the app uid changes and `tar` cannot chown to the old uid. A `tar --no-same-owner -xf` scratch copy of the script restored correctly on phone 1; phone 2 was restored by hand the same way. Hit on both phones on 2026-10-22 (rows 2122 and 2124).
- **(e)** `build-apk.ps1 -RepoRoot` on a `git archive` tree: the generated, gitignored `src-tauri/gen/android/.../TauriActivity.kt` and `proguard-tauri.pro` are missing, and a release build failed with `Unresolved reference: TauriActivity` (row 2124). Fix with a clear preflight failure, or a documented copy step.
- **Related:** `MC-330` 7, rows 2114, 2117, 2122 and 2124.

### CHORE-220 — The import size warning sums compressed database bytes with uncompressed unit bytes, so a stub-form file warns earlier and shows a larger number

**Status (2026-10-24, lane A Roadmap cleanup): COMPLETE.** Merged in `888c20283`; Gate 2 `[APPROVE]`; Note 9 calibration done; decision `MC-360`; nothing owed (closeout check, ledger row 2261).

**Status (2026-10-22, `MC-360`): fixed; merged in `888c20283` (lane B); technically accepted, Gate 2 `[APPROVE]`.** Ledger rows 2336, 2341 and 2342.
- **The Note 9 check** (lane A's release run, verified):
  - a stub file showed "about 78 MB" and the same content inline "about 30 MB";
  - the import memory peaks were 723 and 642 MiB;
  - the import took 207 s against 140 s;
  - "78" was MiB labelled MB.
- **What changed:**
  - `importSavedDataSizeBytes` (`src/ts/drive/storeImport.ts`) counts the unit entries at `UNIT_SIZE_WEIGHT` (0.25) for the 16 MiB trigger, the shown number and the time notice's database sentence.
  - `estimateImportSeconds` keeps the full unit bytes.
  - The shown figure is decimal MB (`Math.ceil(bytes / 1_000_000)`), in both warnings and the numbered-backup restore.
  - No string changed.
- **Effect:** the Note 9 stub file now shows 28 or 29, and still warns.

**Status (2026-10-21): open, scheduled with the stage 1 Note 9 check (`MC-355` 2).** Source: the lane B stage 1 plan (`%TEMP%\risu-lane-b\s1\plan.md`, change 3, an orchestrator ruling); raised again by a side agent's note, and the maintainer asked on 2026-10-21 that it be recorded so it is not lost.

- **Problem:** the CHORE-194 fix counts the `coldstorage_<uuid>.json` unit entries as database-class bytes for the 16 MiB size warning and the long-tail rule. It sums raw on-disk bytes: the database entry is compressed and the units are uncompressed JSON. For the same content a stub-form file's sum is larger than the inline file's database entry. Example (stubflip PC fixture, 500 characters, synthetic, one fixture): inline 30.6 MB against stub 10.4 MB database plus about 71 MB of units, about 81 MB, about 2.7 times. So stub-form files cross 16 MiB with smaller libraries, and the sentence "reading it needs several times that much memory" probably overstates the memory for the unit part (inferred, unmeasured).
- **Direction:** errs toward warning, never toward a missing warning. No correction factor was set, because the only ratio comes from one synthetic fixture.
- **What settles it:** the Note 9 import of a stub-form file (`MC-355` 2), measuring the memory peak during the resolve against the shown number, and the import time against the estimate. Then recalibrate the threshold or the shown number, or both. If the wording changes again, it needs a translator pass (`MC-058`).
- **Alternative named to the maintainer, not chosen now:** keep the 16 MiB trigger and show the database and unit sizes separately in the sentence (a further string change).
- **Related:** CHORE-194, `MC-355`, `MC-318` 6.

### CHORE-500 — Translator edit-display replacement writes translator output with `innerHTML` (proposed by lane Cloud)

**Status (2026-10-24, lane A Roadmap cleanup): COMPLETE; supersedes the batch 5 "open, parked" line.** Merged in `a83c7901b`; Gate 2 `[APPROVE WITH AMENDMENTS]`, amendment applied; decision `MC-435` 1; nothing owed (closeout check, ledger row 2261).

**Status (2026-10-24, lane A records batch 5): open, parked post-MVP** (`MC-352` 4). No data risk. In `src/ts/translator/translator.ts`, `translateNodeText`'s edit-display branch writes the processed translation with `innerHTML`; card authors may rely on that. Downstream consumers sanitize. Found at the CHORE-133 Gate 1 (`Agents/Lanes/lane-cloud-records.md`).

**Status (2026-10-24, lane C cloud): fixed on `lane-c-cloud` in `e6d8875`; Gate 2 `[APPROVE WITH AMENDMENTS]`, amendment applied and checked (rows 3321 to 3324).** Decision: `MC-435` 1. Tiny-task carve-out for Gate 1: the change is a few lines at one site, and the product choice was settled first.

**Status (2026-10-24, lane A records batch 8): merged in `a83c7901b` (no-ff merge of `33e225258`); merge review [APPROVE] (ledger row 2258); full checks on `a83c7901b` green (row 2259). Technically accepted. No phone check is named by lane C's records.**

**Plugin note (lane A merge review, 2026-10-24):** V2 `editdisplay` plugin hooks, Lua edit triggers and the `display` trigger now receive translated text with `&` and `<` escaped, as `MC-435` decided. A plugin that matches a literal `<` there sees `&lt;`.

### CHORE-330 — The translator's markdown pass re-parses literal text as markup

**Status (2026-10-24, lane A Roadmap cleanup): COMPLETE.** Merged in `a83c7901b`; Gate 2 `[APPROVE]`, merge review `[APPROVE]`; decision `MC-436`; residuals accepted; nothing owed (closeout check, ledger row 2261).

**Status (2026-10-24, lane C cloud): fixed on `lane-c-cloud` in `c505275`; Gate 1 two rounds `[APPROVE WITH AMENDMENTS]` (rows 3325, 3329), Gate 2 `[APPROVE]` (row 3332).** Filed and scheduled in this lane by `MC-435` 2; decision `MC-436`.

**Status (2026-10-24, lane A records batch 8): merged in `a83c7901b`; merge review [APPROVE] (ledger row 2258); full checks on `a83c7901b` green (row 2259). Technically accepted. No phone check is named by lane C's records.**

- **Defect (investigator, EXECUTED, row 3320; independent check at Gate 1):** `applyMarkdownToNode` (`src/ts/parser/parser.svelte.ts`) renders each translated text node with markdown-it (`html: true`) and writes the result with `innerHTML`. The text is decoded, so `a &amp;amp; b` shows as `a & b`, which undoes CHORE-133's ampersand fix in the app (that test mocks the pass as a no-op), and inline tags in literal text become elements. Its only production caller is the translator's Combine translation path.
- **What changed (`src/ts/parser/parser.svelte.ts`):** `applyMarkdownToNode` renders through a third markdown-it instance, `mdLiteral`, with `html: false` and the `code` and `entity` rules off. So markdown-it escapes `<` and keeps `&name;` as text under its own rules for code spans, fences and backslash escapes. The KaTeX output of `$$…$$` is replaced by private-use placeholders (U+E9C0 index U+E9C1) and restored after rendering. In text it is restored as MathML; inside a tag attribute, or when KaTeX throws, it is restored as the escaped raw match. U+E9C0 and U+E9C1 are stripped from the input first. `renderMarkdown` gains a trailing `literalText = false`. Its false path runs the same statements in the same order, so chat and highlight output is unchanged (byte-compared at Gate 2). This mechanism replaced the planned pre-scanner after Gate 1 round 1 (row 3326). Against `MC-436`'s option text, `<https://…>` autolinks and `[l](<a b>)` keep working.
- **Tests:** new `src/ts/parser/applyMarkdownLiteralText.test.ts` (16 tests; jsdom; a file-level KaTeX spy) and `src/ts/translator/translateLiteralMarkdown.test.ts` (end-to-end `translateHTML` with the real markdown pass). On the pre-fix parser 9 fail: 6 reproducers, 2 characterisations and the end-to-end case; 8 guards pass. `MC-239`: with `md` in place of `mdLiteral` the reproducers fail.
- **Residuals:** `$$a$$_x_` stays plain, because the placeholder's last character counts as a word character for emphasis flanking (`*` forms work). `$$` inside a fence renders MathML inside the code block; HEAD showed MathML source text. `[a]($$a$$)` gives an inert placeholder href. `customQuotesData` holding `<` or `>` is inserted raw, as at HEAD. Translator-returned inline HTML now shows as literal tags (`MC-436`).
- **Related:** `MC-436`, `MC-435` 2, `MC-239`; CHORE-133, CHORE-500.

### CHORE-501 — HypaV3 modal "next summarisation" preview uses the last summary's last memo (proposed by lane Cloud)

**Status (2026-10-24, lane A Roadmap cleanup): COMPLETE; supersedes the batch 5 "open, parked" line.** Merged in `a83c7901b`; Gate 2 `[APPROVE]`; decision `MC-437`; display only; nothing owed (closeout check, ledger row 2261).

**Status (2026-10-24, lane A records batch 5): open, parked post-MVP** (`MC-352` 4). Display-only: `getNextSummarizationTarget` in `src/lib/Others/HypaV3Modal/modal-footer.svelte` can disagree with the real resume point after CHORE-10 stage A3. No data effect.

**Status (2026-10-24, lane C cloud): fixed on `lane-c-cloud` in `a9f15b1`; v1 Gate 2 `[APPROVE WITH AMENDMENTS]` (row 3327); the maintainer chose to fix the greeting case first (`MC-437`); v2 Gate 1 `[APPROVE WITH AMENDMENTS]` (row 3331), Gate 2 `[APPROVE]` (row 3335).** Display only.

**Status (2026-10-24, lane A records batch 8): merged in `a83c7901b`; merge review [APPROVE] (ledger row 2258); full checks on `a83c7901b` green (row 2259). Technically accepted. No phone check is named by lane C's records.**

### CHORE-503 — SupaMemory covered-ID field can be read as valid after an upstream re-summary (proposed by lane Cloud)

**Status (2026-10-24, lane A records batch 5): CLOSED as accepted** (`MC-352` 4; `MC-724`). The field is valid while it equals the first line of `supaMemoryData`, so an upstream re-summary that reproduces that line can make the covered message read as covered in the fork. Accepted per `MC-724`.

### CHORE-201 — A runtime re-archive must not archive a character that is due for the startup purge, and must not be confused with the purge (done in stage 2)

**Status (2026-10-12): done in stage 2 (`bd02c04d4` and `9d03b2ba1`, merged in `2e065403a`; ledger rows 2019, 2024, 2026 to 2034).**

- **Problem as filed (found while planning trash archiving, row 2019, Q3):** stage 2 re-archives loaded characters during the session, and trashed ones are now eligible. Its final check before writing should skip a character due for the startup purge, as the boot pass does (`isTrashPurgeDue`). When stage 2 deletes a character's old unit (`MC-305`), that must not be confused with the purge, which leaves units for the manual cleanup (`MC-304`).
- **What was done (rows 2024 and 2025, plan; the resolution wording is the cloud session's):** the re-archive pre-gate and final check apply the purge eligibility with the current time; stage 2b deletes only a re-archived character's superseded unit and never touches units the purge leaves for the manual cleanup.
- **Related:** `MC-304`, `MC-305`; CHORE-200.

### Keep-alive (2026-10-09 to 2026-10-10): plans, gates, checks, device passes, accepted limits

Summary status is in the "Keep-alive" bullet near the top. Everything below is from the session scratch reports named in the ledger rows 1553 to 1574 (`keepalive\`); "session scratch" paths below are relative to it. Decisions: `MC-260`, `MC-261`.

**Investigations and their verification.**
- `refresh.md` (`investigator`, read-only at `ecf06db4`) refreshed the earlier `packet.md`; verified by `doc-verifier`, PASS with optional notes (the bypass count of 79 is an upper bound over 25 files; `beginBusy` has 26 call sites against the 28 counted; the save loop polls every 500 ms, so about 1 s in the worst case after the last chunk). It refuted two premises of the packet (the upstream tone file `keepAliveAudio.ts` exists here now; the manifest and `MainActivity.kt` edits are committed), found no central counter for network work, and showed that `isBusy` is a write-protection registry that counts no request, TTS or image job. `packet.md` stays an investigator packet **not independently verified**, superseded where `refresh.md` disagrees.
- Hidden-stream lag: `lag\report.md` (`perf-analyzer`; Note 9, API 29, instrumented release build, one device, WebView version not recorded). H1 held (the `fetchNative` Tauri pump, `sleep(10)` and one chunk per tick, is the limiter; hidden-page timers ran at about 1 s per tick, then 9 to 15 s gaps, and in the 200 s run not at all for 281.6 s until the app came back); H4 held (the 2 s linger became 12.9 s in the 8 s run and 42 s in the prototype run); H2 refuted (reading and writing follow each pump tick within 3 to 10 ms); H3 refuted (native events arrive on time while hidden, so the pump, not delivery, is late). Independently recomputed from the logcat files by the Stage 3b Gate 1 reviewer (`gate1-3b.md` Part 1): H1, H3, H4 and the prototype result CORRECT, with corrections that are not decision-critical (the 200 s run has about 9 s of 1 s ticks, not 18 s; the 100 s run has 22 unique hidden pump ticks, not 30; the write means are 7.1, 10.5, 38.9 and 58.4 ms, not "about 6 ms flat"; the prototype's pump closed 3 ms after the end event, the "about 1 s" being clock skew). Accepted with these corrections (`plan-3b-amend.md`).

**Plans.** `plan.md`, `plan-v2.md` and `plan-v3.md` with `plan-v3-amend.md` (binding together), then `plan-3b.md` with `plan-3b-amend.md` (binding together). Stage 1: remove `'pip'`, tone off and setting hidden on the Android app. Stage 2: the in-flight work registry and its hooks, no persistence. Stage 3: the Android foreground service, bridge and manifest. Stage 3b: the hidden-app lag fix (`MC-261` 3). Stage 4: save the partial reply on hide and the `interrupted` flag (persistence, `opus-reviewer`). The mapping of Gate 1 rounds 1 and 2 to `plan.md` and `plan-v2.md` is not stated in the files beyond `plan-v3.md`'s history line.

**Gate 1 (Stages 1 to 3, then Stage 4).**
- Round 1: `adversarial-reviewer` `[REJECT]` (`gate1-adv.md`; scheme "APPROVE WITH CHANGES", token `[REJECT]`: substantive plan defects, all fixable in plan text; for example that `busyActions.ts` has no subscription mechanism and that mirroring its choke points would raise a "Working…" notification for routine housekeeping writes). `opus-reviewer`: `[APPROVE WITH CHANGES]` on Stage 4 and the persistence parts (verdict from `answers.md`; its findings R1 to R7 are cited in `plan-v3.md`; the review text is not among the files available to this record). TODO(evidence): the round 1 `opus-reviewer` text. Maintainer answers 8 and 9 followed (`MC-260`).
- Round 2: `adversarial-reviewer` `[REJECT]`, the second consecutive substantive rejection (`gate1-adv-r2.md`: R1 the abort relay is gone once `fetchNative` returns; R2 erroring the stream on abort breaks the logging tee and would raise an error alert on every Stop; R3 bookkeeping growth after an abort; R4 event-ended tokens need a backstop; R5 service and bridge contract gaps). `opus-reviewer` `[APPROVE WITH CHANGES]` with C1 to C6, called substantive in `answers.md` (`gate1-opus-r2.md`: for example that the note rule failed in the default `'off'` display mode, and that a scheduler wake must be a one-shot latch).
- **Mechanism reconsidered at the second rejection (gates rule):** `plan-v3.md` dropped the request tokens inside `fetchNative` and every change to its stream pump, and dropped the hide-time flush of the coalesced buffer. This is a gate fact, not a maintainer decision.
- Round 3: `adversarial-reviewer` `[APPROVE WITH CHANGES]` of `[EDITORIAL]` class plus one small decision (`gate1-adv-r3.md`: C1 the claim that Stop is prompt without a pump change was overstated before the first byte; C2 a device case for Stop while hidden; C3 a guarded `startForeground`). `opus-reviewer` `[APPROVE WITH CHANGES]` with `[EDITORIAL]` (`gate1-opus-r3.md`: a premise correction, the default display mode is `'off'`, and the wording of the hide bound). Both are folded into `plan-v3-amend.md` (A1 to A5, B1 to B7), whose header records "Gate 1 PASSED". Two consecutive substantive rejections occurred (rounds 1 and 2 of the Stages 1 to 3 plan); no third, so no advisor escalation applied.
- Stage 3b Gate 1 (`adversarial-reviewer`, `gate1-3b.md`): `[APPROVE WITH CHANGES]` of `[EDITORIAL]` class, no substantive defect in the A and B design; its clarifications are `plan-3b-amend.md` (the Capacitor branch is dead code and stays untouched; the wake must not be lost; `stopAfter` must do its work inside the posted runnable; a refused start must not drop a pending stop; tests must not use `vi.waitFor` under frozen timers).

**Implementation and Gate 2.**
- Stages 1 and 2 (`sonnet-coder`; `92bc96e4`; `stage12-report.md`): `database.svelte.ts` keeps only `'off' | 'sound'` through an exported normaliser called in `setDatabase`; `App.svelte` drops `case 'pip'` and skips the tone on the Android app; `advancedSettingsData.ts` hides the setting there; a leaf registry `inFlightWork.ts` with hooks in `sendChat` (one 'chat' token), `globalFetch` ('request'), TTS (`sayTTS`, each clip, each Web Speech utterance, the VITS decode), image generation, translation, embeddings and local summaries, and a 'busy' mirror of every `beginBusy` entry (choke points not mirrored); `fetchNative`'s Tauri header wait also leaves on abort so Stop works before the first byte (A1). Deviations the coder disclosed: one 'busy' token per busy entry instead of a single shared token; tracked units are thin wrappers over renamed bodies; `runVITS` got its own short decode token. Red-before-green: with `beginInFlight` made a no-op and the A1 condition reverted, 37 of 62 tests failed across five hook files; the leak mutation (removing the end call in the `sendChat` and `globalFetch` finally blocks) turned 12 of 16 tests red; the Stage 1 normaliser is red by absence. Gate 2 (`adversarial-reviewer`, `gate2-s12.md`): `[APPROVE]`; mutation checks A1 and four others caught; nits: the VITS decode token (30 s) can lapse on a very slow decode, the Web Speech queued-utterance age counts from creation, and an aborted Tauri request is not cancelled on the Rust side (CHORE-164).
- Stage 3 (`sonnet-coder`; `265c78b6`; `stage3-report.md`): `KeepAliveService.kt` and `KeepAliveBridge.kt`, `MainActivity.kt`, the manifest (three permissions and the service element, the LF `tauri-file-associations` block untouched), a proguard keep rule, the page consumer `src/ts/android/keepAliveService.ts`, three new strings in `en.ts` and the six translated locales (translator `ac9e9e2be7f596445`; ko "답변 생성 중…", "작업 중…", "중지"). Hooks are named `__risuTaniumKeepAlive*` (approved in the report). Gate 2 (`adversarial-reviewer`, `gate2-s3.md`): `[APPROVE]` after reading source and running `pnpm check` and the full tests; the device-tested snapshot's files were byte-identical to the tree.
- Stage 3b (`sonnet-coder`; `61abe7e5`; `stage3b-report.md`): in `globalApi.svelte.ts` the stream pump and the header wait are woken by native events instead of a 10 ms poll, and the per-fetch queue is released when the stream closes; `KeepAliveBridge.stopAfter(ms)` schedules the stop on the main handler. Red before green: 9 of the 16 tests in the `globalApi` in-flight suite and 3 of the 26 consumer tests failed before the change; an `await` inserted before arming the wake made the two race tests fail. Kotlin was not compiled by the coder (read for syntax); the release APKs built for the device re-check are the compile proof. Gate 2 (`adversarial-reviewer`, `gate2-3b.md`): `[APPROVE]`, two editorial notes (a test label that is red against the old pump and so is not a compatibility guard, fixed by the Orchestrator per `stage3b\usage.md`; the abort-listener removal and map deletion on close are read-verified only).
- Stage 4 (`sonnet-coder`; `dfc5062e`; `stage4-report.md`): `interrupted?: true` on the pushed reply and on a continued message, removed in the inner `finally` through `resolveReply()`; a leaf registry of active streams; `saveScheduler.ts` (the save loop's pre-loop, idle and after-step waits can be woken once by `requestSaveNow()`); `saveOnHide.ts` (on `visibilitychange` to hidden or `pagehide`, only while a 'chat' token is in flight: mark each active stream's `chaId` and `memberChaId`, then request an immediate save; no flush of the coalesced buffer); the note in `Chat.svelte`/`Chats.svelte` (shown when the flag is set and the reply is not an active stream; part of the mount hash); the flag removed by `edit()`, the original-target partial-edit save and `stepCandidates`; one new string in `en.ts` and the six translated locales (translator `aff4585791d841e89`). Gate 2 (`opus-reviewer`, `gate2-4.md`): `[REJECT]` for test-only remediation, with the production code accepted as written (F1 the idle-wait wake was not exercised by any loop test, shown by a surviving mutation; F2 no test caught an `await` between the push and the registry add; F3 the partial-edit save was untested; F4 to F9 smaller findings, one an informational point on an ambiguous `continueMessageId`, one the unrun device check). Remediation r1 (`stage4-report.md`) added the three missing tests (F1 to F3), each shown to fail on a mutant, and guarded the finally's `resolveReply()` with `streamsIntoReply` (F8); F7 (the device and browser check) was then run (below). The same reviewer instance reviewed the remediation again: `[ACCEPT with notes]`, gate token `[APPROVE]` (`gate2-4-r1.md`, saved by the Orchestrator from the reviewer's hand-back because its append to `gate2-4.md` did not land): F1 to F6 and F8 resolved with the mutants re-run, F4 with an optional wording note; F7 (the device and browser check) open until the device pass, which later ran (`device4\report.md`); F9 a named limitation; N1 information only (a surviving mutant that cannot affect the note); the six locale lines checked. Process disclosure from the coder (`stage4-report.md`): some test files were first written through PowerShell file copies outside the write guard, and four production files were swapped to `HEAD` content for a red run and restored from scratch copies; line endings were re-verified byte by byte, and the later red runs used a scratch tree. The Gate 2 reviewer compared the tree's `index.svelte.ts` by SHA-256 with the coder's scratch copy and found only Stage 4 hunks.

**Full checks (provenance).** Stages 1 and 2, the coder's final snapshot and the Gate 2 reviewer's run: `pnpm check` 0 errors, 0 warnings; `pnpm test` 616 files, 12,309 passed, 6 skipped (`pnpm build` not run). Stage 3, the Gate 2 reviewer on the tree with the translator's locale edits (`g2s3-check.txt`, `g2s3-fulltest.txt`): `pnpm check` 0 and 0; `pnpm test` 617 files, 12,331 passed, 6 skipped (the coder's own run before the translator pass had only the six `localeParity` failures that the missing keys cause). Stage 3b, by the Orchestrator per `stage3b\usage.md`: `pnpm test` 617 files, 12,344 passed, 6 skipped; `pnpm check` 0/0; the coder's full run came before a final test-only type annotation, which was followed by a re-run of that file (16 of 16). Stage 4, the coder's final tree after remediation r1 (`stage4-report.md`, `fulltest2.txt`): `pnpm check` 0 and 0; `pnpm test` 626 files, 12,422 passed, 6 skipped; `pnpm build` succeeded (built in 12.74 s). Whether that tree is byte for byte the committed `dfc5062e` is not recorded, and the Gate 2 reviewer ran only targeted suites (145 files in the globalApi and storage folders, plus the nine Stage 4 files) and no full run, build or `pnpm check`. TODO(evidence): a full run on the committed tree.

**Device passes.** Note 9 (SM-N960N, API 29) and the AVD `Pixel_6a_LowRam_35` (API 35, arm64 APKs under translation) with release builds signed with the debug key, a mock streaming server reached through `adb reverse`, and the app pointed at it through Settings. The device agents' own writes were refused, so the Orchestrator saved their hand-backs as the reports.
- **Stage 3 (`device\report.md`, 2026-10-09; investigator `afab15d71506e8cee`):** the permission prompt once, the denied path (the service still runs, `isForeground=true` with type `0x1`), the notification appearing within 0.6 s and leaving 2.1 to 2.2 s after the end, notification Stop mid-stream (gone within about 3 s), Stop before the first byte, Stop while hidden, Back-exit and recents swipe (service gone), the forced API 35 `dataSync` timeout (the service stopped after 15 s, no crash, the reply continued), a hung request cleared by Stop, and 10 rapid send-and-Stop cycles: PASS on both devices, with no FATAL, ANR or `RemoteServiceException` in the logs. Findings: Stop does not close the HTTP connection (CHORE-164); a hidden stream lags and the service does not prevent it (checks 7 and 10: on the Note 9 a 200 s hidden stream was still in flight about two minutes after the mock's end and the notification left about 24 s after the app came back; the foreground controls ended 2.1 to 2.2 s after the end) which led to Stage 3b; no Stop button during the 2 s linger on the emulator (by design); a hidden abort shows no dialog (CHORE-167). The first check's permission grant used `adb shell pm grant`, not the Settings UI.
- **Stage 3b (`device3b\report.md`, 2026-10-10; investigator `a0beb495c15914b0e`):** hidden 100 s and 200 s streams finished at the mock's end with every chunk (w377, w755 on the Note 9; w377, w754 on the emulator) and the notification left 2.1 to 2.4 s later while still hidden (before: only on return, 13 s to 141 s or more late); the header wait completed hidden; a second piece of work begun inside the linger (foreground, then hidden 0.7 s later) caused no foreground-service exception; the foreground control, Stop mid-stream, before the first byte and while hidden, and rapid send-and-Stop: PASS on both. The Orchestrator's spot-check matched the mock log and the Note 9 poll file, and a case-sensitive search of all logcat files for FATAL, "ANR in", `RemoteServiceException`, `ForegroundServiceStartNotAllowed` and "did not call startForeground" found 0 matches. The pure "begin while hidden" variant is untested (sending while hidden is not possible from the UI). Caveats listed in the report: one unproven sampling glitch on the emulator, no notification samples between Stop and the final poll in case 7, and not re-run: Stop during the linger and Stop on an expired notification.
- **Stage 4 (`device4\report.md`, 2026-10-10; investigator `acda69b69e617534c`, two rounds; the mock streams one word per about 260 ms):** against the Stage 3b baseline build a kill after the hide lost the streamed text (baseline: only "w1", or no reply at all, because the 500 ms trailing debounce never fires during a stream). With Stage 4: **Note 9 app** A1 (Home, kill 3 s later) hide at about word 36, kill at about word 48, saved w36 with the note; A2 (kill 0.5 s later) hide at about 35, kill at about 38, saved w35 with the note; B (hide, return after the stream ended) the full w113 and no note; C1 (edit and save unchanged) cleared the note. **Note 9 Chrome, hosted build** (round 2): hide at about word 45, Chrome force-stopped, kill at about 58, saved w47 with the note (in Korean, "중단됨 — 답변이 완전하지 않을 수 있습니다"). **Emulator API 35** (round 2): A1 saved w35 against a kill at about 47, A2 w35 against a kill at about 37, B the full w113 with no note. The Orchestrator's spot-check recomputed the hide index from the mock log and timing files (about 35.8 for A1) and checked the screenshots. Logcat on every run: 0 matches for FATAL, "ANR in", `RemoteServiceException`, `ForegroundServiceStartNotAllowed` and "did not call startForeground". D (a foreground kill with no hide) kept only "w1 w2" (below). C2 could not be run as intended (CHORE-168). The Note 9 was left on `keepalive4-aarch64`, Chrome's data on the Note 9 was cleared, and the emulator, mocks and servers were stopped by process id.

**Accepted limitations and named consequences (not tickets).**
- A foreground kill with no hide keeps only the first-byte save (`device4\report.md` case D, "w1 w2" saved, note shown): the hide trigger does not run. This follows from "Save as of hide" (`MC-260` 9) and is the rule's named consequence, not a defect.
- The API 26 to 28 branch of the service (the plain `startForeground` overload) was not exercised on a device; API 29 and 35 were (`gate2-s3.md` minor observation 5).
- The "begin while hidden" variant of the linger is untested on a device (`stage3b\usage.md`, `device3b\report.md`).
- "The note is hidden while a continued reply streams" is covered by unit tests only, because the composer's Continue Response on a device does not extend the reply (`device4\report.md`; CHORE-168).
- The Android notification channel name (`keepalive_channel_name`, "Background work") is an English-only Android resource (`stage3-report.md` deviation 4; `gate2-s3.md` minor observation 4). Judged a limitation, not a defect: the notification title and the Stop label are localized strings passed from the page, the channel name appears only in Android's system notification settings, and the app has no localized Android resource folders at all (`strings.xml` is the only `values` file; there is no `values-ko`, read for this record). Not ticketed; a different judgement is the maintainer's.
- If the system refuses `startForeground` inside `onStartCommand`, the service stops itself while the bridge and the page still believe it is running until a gap of more than 2 s; the failure mode is only "no keep-alive" (`gate2-s3.md` minor observation 1). A Stop with only non-stoppable work is unreachable from the UI (observation 2).
- Stage 2 gaps the coder named for the maintainer (`stage12-report.md`): `fetchNative` calls outside tracked units (the settings model-list refresh, MCP connect and OAuth from settings, Lua `fetch` outside a chat), tokenizer downloads, plugin calls that bypass `globalFetch`, `plugins.svelte.ts`' use of `fetchNative`, stalled local model downloads in `runEmbedding` and bergamot (no timeout; held until the `dataSync` cap or `onTimeout`), `runTransformers` (reached from a chat unit), Gemini's non-streaming summaries (covered by 'chat' or 'hypaBulk', not 'request'), Stop before the first byte fixed only on the Tauri `fetchNative` branch, and an upstream `'pip'` reading as `'off'` (and staying `'off'` on an upstream, fork, upstream round trip).
- Stage 4 limitations named in `plan-v3.md` and `plan-v3-amend.md`: the saved text is what was displayed at the hide (in balanced mode the not-yet-displayed tail is about 125 ms plus one frame plus one post-processing pass, and unbounded if rendering stopped before the hide; the saved state is consistent); text arriving after the hide is written to memory when the page is visible again or the stream ends (balanced and strong) or at once (off), and is saved by the ordinary debounce after the stream ends or by a later hide; a hide before the real scheduler exists saves at the ordinary debounce; a page that dies before the first chunk leaves an empty reply with the note; fork to upstream and back after upstream continued the reply shows a stale note (upstream ignores the field, `MC-175` holds); a peer tab that loads mid-stream shows the note until the streaming tab's final save; a chat copied or branched mid-stream keeps the flag on the copy, and the copy's note stays hidden until its view next re-runs (`gate2-4.md` F9); an ambiguous duplicate id leaves the flag; every desktop tab switch during a stream saves at once (it re-encodes the origin character); the first-work notification dialog hides the page once and causes one hide save (B4); triggers and `@@` script writes do not clear the flag.
- Waits the save wake does not shorten (held, lock timeout, conversion damaged, lost characters, missing layout, error paths): up to 1 s, or 5 s on the quota path (`plan-v3-amend.md` B3).

**Open maintainer questions.** None recorded for keep-alive. The Orchestrator choices listed in `MC-260` (Stop only while a reply or TTS runs; the 2 s linger; the Stop-before-first-byte check; a hide with a 'chat' token and no active stream still saves) were reported to the maintainer, and no answer to them is recorded.

**Records closeout.** Drafted by `doc-writer` from the reports above and the Orchestrator's brief (ledger row 1575). Independent verification by `doc-verifier` has not been recorded when this was drafted; this item is COMPLETE only after it. Records committed in `043bae5a` (verified by `doc-verifier`, PASS WITH FIXES, fixes applied; ledger row 1575).

### Runtime unload (archive-default follow-up, 2026-10-10): investigation, audit, increment 1 plan

Summary status is in the "Runtime unload" bullet near the top. Decisions: `MC-268`, `MC-270`. Evidence: `archdefault\`, `m5-web\` and `m5-note9\` (ledger rows 1595 to 1597, 1599, 1601, 1603 to 1605, 1609 to 1632).

**Feasibility (`report.md`, `verify.md`).** Already built: a stub-plus-unit format that upstream also reads, restore-on-open for every consumer found, the boot pass and the web-only idle reload. Not built: any in-session release of opened characters on Tauri, and a safe answer to "who still holds this character". Premises refuted: importing straight to the archive does not replace the boot pass (migration, retry, enrichment, re-archive stay); an opened character stays in `DBState.db.characters` until a reload, and the idle reload is off wherever `canBootArchive()` is false; the shipped decoder holds the whole `database.risudat`, so a `.bin` cannot be decoded one character at a time without new code; the stub lacks tags and creator. The verifier confirmed all ten claims with corrections (ledger row 1596).

**Writer and holder audit (`s0.md`, `s0-verify.md`, `HOLDS WITH CORRECTIONS`).** "No pending mark, no in-flight encode, no work" does not mean clean: the tracker is trimmed at each snapshot and `markCharacterForSave` only appends. A stub swapped back is not recorded by the identity tracker, so an explicit mark at the swap is mandatory. `selectCharImg` and `addCharEmotion` hold a numeric index across a picker and an `await`, and `makeGroupImage` and `AssetInput` have a related hazard; under put-back these become silent-loss paths (stage 1a). The keep-set must use `isWriting` and the busy registry, not only `hasWorkIn`. Not established (PARTIAL): `CharConfig`, the sidebar and the rail were not read line by line; how often a plain open leaves a character byte-clean is unmeasured (U1).

**Increment 1 plan (`plan-unload-1.md`, v2 and section E).** Retain the replaced stub with a fingerprint of the unit as read; swap it back from `afterNextSaveCommit` when unchanged, with an explicit mark; at most one put-back swap per fire and at most 3 fingerprints or about 8 ms before the rest re-arm; the strong registry holds only `{stub, unitKey, fp}`; `restoredBytes` is cleared on put-back; the manual-cleanup keep-set includes retained units; dev-only counters by reason, never persisted (`MC-175`). Decisions D1 to D4 are the Orchestrator's, D5 and D6 the maintainer's (`MC-270`). Gate 1: see the status bullet.

**Stage 1a (committed `56625ea7`; the coder's first-pass description from `stage1a-report.md`, base `e31b4f2f`).** `selectCharImg` and `addCharEmotion` capture their target at entry and re-resolve it by identity after the picker, before each PNG chunk write and after `saveImage`, aborting quietly with a `console.warn` when the target changed or became a stub; `makeGroupImage` writes through the group and its `onerror` resolves; `AssetInput` captures the target at the click, checks it before and after `saveAsset`, and no longer writes `?? []` before the cancel check; `applyStubStateOnRestore` carries a newer numeric stub `lastInteraction`. `CharConfig.svelte` is untouched (CHORE-174). Tests: `characters.imageWriters` 13 (10 red on the base), `AssetInput.picker` 5 (4 red), 4 contract tests in `coldCharacter` (2 red; the others are red-first contracts or guards, as labelled). Gate 2: `[REJECT]`, then PASS after remediation (ledger rows 1611 to 1613). The commit message of `56625ea7` names the fixes: an asset written to a character no longer selected was not marked for save, and a blank group image when every member load failed.

**Stage 1b-0 (`b88c326a`; ledger rows 1615 to 1619).** The pre-1b investigation (`pre1b.md`) was verified CORRECTED: after a commit, `cleanupAfterCommit` kept a deleted key's acknowledged bytes when the delete did not report 'removed' (and on a generic throw); if the delete had landed (the Node store reports 'unknown' when it may have), a later save of equal bytes was skipped and the next load reported the block as damaged. Reproduced 8 of 8 variants in scratch. Rule now (plan section G): 'unchanged' keeps the acknowledgement; 'conflict' drops the bytes and keeps the version; 'unknown', 'failed' or a throw makes a versioned store forget the key and other stores drop the bytes. Reachability on the base: rare and practically Node only, on the same session (plan G2). A forgotten key whose delete did not land stays on disk until that character is restored again or the generation is replaced (plan G1). Tests: 14 regression reproducers fail on `42cdffc3`, 8 guards pass before and after. Gate 1 covered amendment F only.

**Stage 1b (`6de7931c`; ledger rows 1620 to 1622).** A restore records the stub it replaced, the unit it came from and a fingerprint of the character as read (`coldRetained.ts`); after a later save commit, `characterPutBack.ts` swaps back each restored character that has left the keep-set and still matches the fingerprint, with an explicit mark for save. Anything else leaves it loaded. Cleanup keeps every unit a retained record names and a V3 plugin may not overwrite such a unit. Each pass checks at most three characters within about 8 ms. All from the commit message of `6de7931c`.

**Stage 1c (`83e111e2`; ledger rows 1624 to 1627).** From the commit message and `plan-1c.md`. `measureFlag.ts` exports `MEASURE`, true in development and in a build made with `VITE_RISU_MEASURE=1`; it is a module-level constant in a module with no imports, so a normal build folds every measurement branch away and has no `__risuPutBackMeasure` global. Under `MEASURE`, `risu-measure-putback=off` (a `localStorage` switch) turns the put-back off at the source for an A/B comparison and `risu-measure-tripwire=on` enables the tripwire, which is off by default. `putBackMeasure.ts` records counters by reason, fire durations by outcome, fingerprint cost and size by source, how long each candidate waits and why it left, the differing keys of dirty verdicts and the restored bytes outside the keep-set, read through `globalThis.__risuPutBackMeasure.snapshot()`; nothing measured is saved. The tripwire watches each replaced character for three save commits after the swap and logs any field written late; weak references to the Svelte proxy and to the raw restored object plus a `FinalizationRegistry` report whether either stays in memory. Gate 1 `adversarial-reviewer` `[PASS WITH FIXES]` (B1 to B12 adopted); Gate 2 `opus-reviewer` `[PASS WITH FIXES]` (L1 raw-target `WeakRef`, L2 fire-keyhash timing, L3 reset generation, E1 and E2 editorial; the coder fixed L1 to L3 and E1 on resume and did not do E2); remediation review EDITORIAL only (a test label; a Low informational note on a dead `armTripwire` chain in the measurement-off build). Checks on the final tree (the Orchestrator's account): `pnpm test` 655 files, 12,904 passed; `pnpm check` 0 and 0; `pnpm build` OK; a grep of `dist` for `__risuPutBackMeasure` finds 0 files in a normal build and 1 with `VITE_RISU_MEASURE=1`. **Release requirement:** the release build check must include a grep confirming that `__risuPutBackMeasure` is absent from `dist`. The commit message names `opus-reviewer` for Gate 1; `usage.txt` and the plan name `adversarial-reviewer` (ledger row 1624). The plan says the measurement code is to be "removed or folded down after measurement except what the maintainer keeps"; whether it is kept is not decided. TODO(evidence).

**M5 measurement (2026-10-10; `plan-1c.md` section M5; ledger rows 1628 to 1632).** Accepted with the caveats below. All figures are MiB unless stated. Arm A is the put-back switched off, arm B on, in the same build.
- **Web:** Edge (version not recorded in the M5 sources) against the Node server on one i9 (best-case hardware; nothing is measured on a Pi or a mid-range phone). Source: `m5-web\d2\analysis.md`; independent verification `m5-web\verify\verdict.md` (C1 to C6 CONFIRMED, C7 CONFIRMED with corrections, C8 PLAUSIBLE, not run-proven). Heap delta after 20 characters: A about 81.3 to 81.5, B about 5.3 to 5.5; after 50: A about 194 to 199, B 6.77 (12.26 in the run with one dirty character). Tripwire run: 23 swaps, 23 collected, 0 pinned, 0 late writes. B writes about +0.84 MiB per switch (A 3.18, B 4.02 MiB, 180 switches per arm; +26.5%): the root and stub blocks are written about 1.8 to 1.94 times per switch against 1.0, the character block about 1.0. Fire p95 per run 10.0 to 63.7 ms (nearest-rank; the largest fire 92.0 ms). Click-to-chat latency: the Orchestrator accepted "no difference beyond noise"; `analysis.md` pools A p50 130 ms against B p50 244 ms with per-run medians A 109 to 238 and B 121 to 308 ms, and `verdict.md` does not examine latency, so this reading is not verifier-confirmed. No idle reload occurred in any run. The analysis has 14 run files; `usage.txt` and `verdict.md` say 13 (not resolved).
- **Note 9:** spare device, API 29, debug APK with an unminified frontend. Source: `m5-note9\verify\verdict.md` (D1 to D9 CONFIRMED; the figures are MiB, not MB). Heap delta A about +67 to 69 against B +5.5 at 20 characters; A50 +166.5 against B50 +7.7. Summed PSS delta A50 +322.6 against B50 +46.3 (renderer A50 138.3 to 440.8, B50 137.9 to 156.3). Fire p95 57.8 ms (n=110, p50 32.4, max 61.4). Tripwire 20 of 20 collected, 0 pinned, 0 late writes. Latency A p50 502 ms against B p50 499 ms: no difference; B is not faster.
- **Candidate wait (the 1b closeout requirement; read by the records pass from `analysis.md` and the Note 9 run JSON `snapshot.candidateWait`, unit assumed ms because it is unlabelled; not verifier-covered):** web, formatted B runs, p50 853 to 978, p95 1,081 to 1,266, max 1,085 to 1,348, no candidate pending at the end; Note 9, B1, B2, B50 and T20b, p50 944 to 1,030, p95 1,186 to 1,249, max 1,287, every exit a swap.
- **Decisions on the plan's rules:** B10 (fire p95 on the Note 9 near about 150 ms moves the fingerprint to switch time) is not triggered; the fingerprint stays at fire. B11 (near-zero clean put-backs on browse-only switches stops the work) is not triggered, judged on second browses as plan F2 says: web B-20 runs 22 to 23 clean of 22 to 23 fingerprinted, B-50 runs 52 of 53 and 52 of 52 (the Orchestrator's brief says "22/23"; the data shows the first B-20 run fired 22 times, all clean), Note 9 110 of 110. Lua state release is not indicated: 0 pinned.
- **First-open dirty effect (source-traced by the web verifier, C7):** `coldCharacterRestore` calls `retainOnRestore`, which fingerprints the decoded object before `changeChar` runs `characterFormatUpdate`, and the boot archive pass applies only `applyCharacterDefaults`. A character archived without the fields the format step fills is therefore dirty on its first open and stays loaded: web pristine run 0 of 53 clean (11 differing keys), Note 9 fresh runs 57 of 57 dirty (the same 11 keys). The 11 keys come from what the synthetic generator omits (nine omitted fields, plus chats from the missing fmIndex and globalLore from the missing bookVersion), not every field the format step fills; per the verifier a fully populated modern character is byte-identical (only `lastInteraction`, which the fingerprint excludes, changes), except for a non-empty legacy `postHistoryInstructions`, `ttsMode` 'none', lore `bookVersion` below 2, an invalid `chatPage` or a chat without a message. By plan F2 this is by design and stage 2 re-archives. Consequence: until stage 2, real-library gains appear only after a character has been opened once (real profiles benefit only to the degree their units were archived after a formatting open); this was not measured on real data. Alternatives noted but not decided: fingerprint after the format step, or normalize at archive. Answered 2026-10-10: leave it to stage 2 (`MC-273`); the alternative of fixing it before stage 2 was not chosen.
- **Caveats:** Note 9 runs were not interleaved (order B1, B2, A2, A1, B50, A50); A50 and B50 are a single pair; the failed first A1 file is absent and was not used; the aborted T20 file is excluded from pooled figures; i9 figures are best-case hardware. The Tauri desktop app was not measured for bytes (plan-1c M5 scope). The Note 9 was left with `m5-debug.apk` installed and the switches cleared.

### Queue after the 2026-10-09 batch (maintainer's order, `MC-256`)

**Superseded by MC-345 (2026-10-22); see "Current work order" at the top.**

These are scope items, not defects, so they carry no CHORE number yet. Order: Android boot time (done), then keep-alive (done: pushed 2026-10-10, records verified), then the character list rework (in progress: Stages 1 to 3, S4-1 to S4-3 pushed by 2026-10-12, S4-4a to S4-4c merged in `fa5111580` on 2026-10-22, S4-5 at Gate 1, S4-6 later), then windowing of other lists, then the chat-screen render tickets CHORE-154 to CHORE-157.

1. **Android boot time.** The maintainer asked whether the boot-time problem is already fixed (`MC-255` 1). The investigator's survey `keepalive\boot.md` (**not independently verified**) answers: partly. The memory work and the block store shrank the main file and heap and made later boots a block-store read on desktop and web (0.5 s to the loaded store on the i9, plus 3.7 s for the page-load listing at 350,350 asset keys, CHORE-84; first boot after upgrade 13.2 s on the i9), but the boot archive pass does not run on Android or iOS (`isTauriDesktop()` gate, `src/ts/storage/bootArchiveHost.ts`), so Android decodes every character eagerly; nothing is measured on a phone or Pi, and no record gives a before and after boot time for the same profile and method. Suggested measurement (boot.md section 5, not an approved plan): the Note 9 before and after (release build, no debugger or CDP polling, the synthetic profiles, cold start to loaded store and to first interactive, first boot and later boot). Interacts with CHORE-137 (the cold-start hang, whose ANR trace is in `Rust.onPageLoaded`). Not planned or gated yet.
   **Update 2026-10-09 (Android boot batch, `MC-258`, `MC-259`; COMPLETE, records verified by `doc-verifier` 2026-10-09, ledger row 1551; records committed in `ecf06db4`): done in code and pushed.** The fix for the CHORE-137 hang is in (`5bc929da`; 0 of 10 emulator cold starts hung against 4 of 10 before, and the Note 9 never reproduced it), the archive pass runs on Android (`573b7994`), and the first measurements on a phone exist: Note 9, 1000-character tier C, first boot with the pass about 144.5 s once per profile, later boots to home about 1.9 s against 8.2 s unarchived, renderer HWM about 1,268 MB down to about 219 MB (section "Android boot batch (2026-10-09)" above). A measurement of the kind suggested above was run in that batch (release builds, synthetic profiles, first boot and later boots; the plan, gates and device passes are recorded in the section above). Still open: the first-boot cost judgement (Q-A), durable strikes (Q-B), and the baseline follow-ups CHORE-161 and CHORE-162. The 350k-asset listing and real modules were not in the fixtures.
2. **Keep-alive (DEFERRED until Android boot time is fixed; `MC-256` 1).** Per `MC-255`: on Android an in-flight-only foreground service (only while a request, TTS or image job is in flight); on mobile web upstream's tone (the merge `6f9c0b98` already carries it), save the partial reply on hide, and remove the empty PiP mode. Open and not decided: the foreground-service type and wording, the notification persistence, the permission prompt timing, resume semantics for an interrupted reply. The save-partial-reply part touches the save path (storage review rule). The Android manifest has uncommitted edits that are not this campaign's to touch (see Live-State). The evidence is `keepalive\packet.md` (investigator packet, **not independently verified**). **Update 2026-10-09:** the condition for starting this item, a fixed Android boot time, is met in code by the Android boot batch (item 1 above, records verified 2026-10-09, ledger row 1551); the manifest's uncommitted edits mentioned here are now line-ending edits only (`MC-259` 6, Live-State). Nothing is planned or started on this item. **Update 2026-10-10 (keep-alive; `MC-260`, `MC-261`; technically accepted and pushed in `92bc96e4`, `265c78b6`, `61abe7e5` and `dfc5062e`; records verified 2026-10-10, ledger row 1575): done.** The points listed above as open and not decided (the foreground-service type and wording, the notification persistence, the permission prompt timing, resume semantics for an interrupted reply) were answered in `MC-260`. Gates, checks, device figures, accepted limitations and the new tickets CHORE-164 to CHORE-168: the "Keep-alive" bullet near the top and the section "Keep-alive (2026-10-09 to 2026-10-10)" above.
3. **Character list rework.** A faster and improved search algorithm on top of windowing. Nice to have: drag-to-rearrange like rearranging apps on a smartphone, and folder management in grid view (the maintainer's words, `MC-256` 2). Not planned. Next in the queue after keep-alive (2026-10-10). **Update 2026-10-10 (`MC-262`, `MC-263`): in progress.** The maintainer answered the product questions (`MC-262`); Stage 1 (search and the mobile trash view) is technically accepted and pushed in `62d55ab6` and `6833d0ac`. Stage 2 (windowing) is in planning, Stages 3 and 4 are not started; the phone check of the trash view is deferred to Stage 2 (`MC-263` 2). Details: the "Character list rework" bullet near the top and the section "Character list rework (2026-10-10)" above. **Update 2026-10-10 (`MC-265`, `MC-266`, `MC-269`, `MC-271`): Stages 1c, 2a and 2b are technically accepted and pushed (`9c1b8a39`, `ac2db1fb`, `e31b4f2f`); S3 (stable row keys, then the grid on `characterOrder` with folder tiles) and S4 (drag and folder management) remain.** Section "Character list rework (2026-10-10): Stages 1c, 2a and 2b" above. **Update 2026-10-11 (`MC-273` to `MC-278`): Stage 3 (3a, 3b-1 to 3b-4, 3c), S4-1 and S4-2 (with S4-2b and S4-2c) are technically accepted and pushed (`6035dd56`, `08b88870`, `8f10f04b`, `f4d2205f`, `c8a99472`, `49c10864`, `ff5bd37e`, `e75b1249`); S4-3 to S4-6 remain.** Section "Character list rework (2026-10-10 to 2026-10-11): Stage 3, S4-1 and S4-2" above. Next in this queue (the Orchestrator's brief, `MC-273`): S4-3, then S4-4 to S4-6, then windowing of the plugin, module and preset lists, the chat-screen render tickets CHORE-154 to CHORE-157, the keep-alive follow-ups CHORE-164 to CHORE-168, the tickets CHORE-169 to CHORE-175 and CHORE-177 to CHORE-180, and the unload items that follow increment 1 (stub v3, card import to archive, trash archiving, stage 2, idle-reload removal; `MC-268`, `MC-270`). Whether stub v3, card import and trash archiving also come after S4 is not stated in the sources given. TODO(evidence). **Update 2026-10-12 (`MC-279`): S4-3 is technically accepted and pushed (`c186bbd7`); S4-4 to S4-6 remain.** Section "Character list rework (2026-10-12): S4-3" above. The CHORE-177 to CHORE-180 list in the queue now also includes CHORE-181.
3a. **Runtime unload (archive-default follow-up; `MC-268`, `MC-270`).** Started 2026-10-10 from the maintainer's idle-reload feedback. Increment 1: Gate 1 passed; stages 1a, 1b-0, 1b and 1c are COMPLETE and pushed (`56625ea7`, `b88c326a`, `6de7931c`, `83e111e2`) and the M5 measurement is accepted with caveats; the first-open dirty effect is left to stage 2 (`MC-273`, section above). Then, in the maintainer's order: stub v3 (tags and creator), card import to archive, trash archiving, and removal of the idle reload after stage 2. The maintainer's numbered queue (`MC-256`) is unchanged; where this item sits relative to S3 and S4: the Orchestrator's note (`MC-273`) puts the character list S3 and S4 first, as its reading of the maintainer's "then move on to the character list rework"; the maintainer's exact words are not in the sources given. TODO(evidence). Section "Runtime unload (archive-default follow-up, 2026-10-10)" above.
4. **Windowing of the other scrolls** such as the plugin, module and prompt preset lists (`MC-256` 2). Not planned. Related earlier scope: Phase 2 item 3 (virtual scrolling) and the sidebar status above.
5. **Chat-screen render tickets** CHORE-154 to CHORE-157 (`MC-256` 4, `MC-257`).

## Sequencing Summary

**Superseded by MC-345 (2026-10-22); see "Current work order" at the top.**

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

## Moved 2026-10-24 (lane A records batch 10)

Closed, completed and superseded entries moved unchanged from `Agents/Roadmap.md` at `df408f8de` by lane A records batch 10 (`MC-501`, `MC-504`), each with one dated status line added at the top. Closing statuses are bounded by the evidence they cite; a line that says "not run" or "unverified" means exactly that. A reopened ticket moves back to the Roadmap with a dated status line.

### CHORE-118 — Gemini audio orphan

**Status (2026-10-24, lane A records batch 10):** CLOSED (`MC-501`, group D). No symptom, mechanism or repro was ever recorded (the entry's own TODO(evidence)). It can be reopened with a dated status line if a symptom is observed.

**Status (2026-10-07): open; queued, not filed in detail.** The records items name this ticket only as "a Gemini audio orphan". TODO(evidence): the symptom, the mechanism, a repro and `file:line` are not in the sources given. The number is assigned by the hold note's order (see CHORE-117).

### CHORE-146 — Possible Vietnamese wording tweak for "Ungroup" ("Bỏ nhóm")

**Status (2026-10-24, lane A records batch 10):** CLOSED by maintainer approval (`MC-501`, group D), no wording change. The entry recorded no decision on the wording; the translator owns non-English locales (`MC-058`).

**Status (2026-10-08): open; maintainer or translator call.** Type: translation. Not a decision. Translator owns non-English locales (`MC-058`).

### CHORE-07 — A transient cold-storage read failure permanently orphans a chat (DATA LOSS, reproduced)

**Status (2026-10-24, lane A records batch 10):** COMPLETE. All four stages are on `main` (7a `c66c9f4b`, 7b `3e17c8a3`, 7c-1 `be3633bd`, 7c-2 `4a4dfae1`; Report 13; gates in ledger rows 29 to 46). No stage remains, so the "Next step" sentence below is stale. Per the lane E audit (source reading, doc-verifier-checked with corrections, not run), the store2 page also no longer reaches the cleanup path, so the mechanism text below applies to legacy pages only.

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

### CHORE-33 — RisuAccount removal: drop the hub credential, keep Realm and Drive

**Status (2026-10-24, lane A records batch 10):** COMPLETE. 28A, 28B and 28C are on `main`; the refusal of an account-sync-encrypted `.bin` stands with its corrected premise (`MC-477`). Upstream issue kwaroran/Risuai#1681 is watched externally and owes no repo work.

**Status (2026-10-24, lane A records batch 6; encrypted backups, `MC-477`): the refusal stands, but its premise is corrected.** The `MC-081` premise (encryption only for account sync) no longer holds. Upstream `dae3f6509` (2026-10-14) made every full export from risuai.xyz encrypted, so every hosted full `.bin` carries encryption (MEASURED from `git show`). Desktop and self-hosted upstream cannot decrypt those backups either (kwaroran/Risuai#1681, open since 2026-10-22). So no full-data route off risuai.xyz exists today. The refusal text now names only the Partial Backup route (`4f9947cc7` first text, corrected in `03816728c`; the wiki pages, first written in `561a8a595`, were corrected in the same commit). Watch kwaroran/Risuai#1681.

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

### CHORE-50 — The first run of a new self-hosted Node server fails until a reload

**Status (2026-10-24, lane A records batch 10):** CLOSED (`MC-501`, group A). Fixed in code by `a29335f76`: `nodeStorage.ts` calls `login` right after `/api/set_password`. Not re-run on a live server.

**Status (2026-10-21 record update):** fixed in code by `a29335f76` (2026-10-03), per its commit message and `nodeStorage.ts`, where the `unset` branch of `checkAuth` now calls `login(digest)` after `/api/set_password`. Not re-run against a live server for this record.

**Status (2026-10-01; superseded by the line above):** filed from ledger row 501. Present upstream since its `61996dd2`
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

### CHORE-85 — A browser crash within seconds of a committing boot pass can leave the pass breaker at 'one' and keep the idle reload off (LOW priority)

**Status (2026-10-24, lane A records batch 10):** CLOSED as moot (`MC-501`, group D). The consequence it named (the idle reload staying off) went with `b33e485ae` (`MC-268` item 3), and the residual (the archive-pass strike) acts only on legacy pages: a store2 page never opens an archive session (`archiveMayRun()` returns `'unavailable'`; source reading). Low priority at `MC-193` item 11. Not reproduced beyond a harness artifact.

**Status (2026-10-04):** open, **LOW priority**, not scheduled. The maintainer asked for it: "yep. file it as low priority
ticket." (`MC-193` 11). Filed from the step 6b live check (finding 1; ledger row 1027).

- **What was seen:** in the live check, a profile copied right after Chrome was killed had not flushed the removal of the
  `archivePassStrikes` key (`src/ts/storage/bootArchiveMemo.ts`). The next boot read the D18 breaker as 'one' and the idle
  reload stayed blocked. With a graceful close after a 10 s wait the key stayed absent. It was a harness artifact; it was
  not reproduced beyond that kill.
- **Consequence if it can happen for real:** the idle reload stays off for that profile until the next committing pass. It costs
  one missed release and never loses data. SUSPECTED, not pursued.
- **Related:** ledger row 1027; `MC-193`; `MC-158`.

**Update (2026-10-12, folded in from the unload-2 records; settled by item 5): moot for its stated consequence.** The idle reload was removed in `b33e485ae` (`MC-268` item 3; ledger rows 2035 to 2039), so the consequence named above, the idle reload staying off, no longer exists. Residual, recorded and not fixed: a stale `'one'` makes the next boot pass that fails, or crashes after its start record, pause the device one failure sooner and post the archive-paused notice; while paused, re-archive also refuses (`'device-paused'`). A missed archive, no data cost. `archiveMayRun` and card import do not read the breaker. Never reproduced beyond a harness artifact.

### CHORE-89 — On the Node server, `/hub-proxy` forwards a request to any URL named in the `x-risu-node-path` header, with no authentication check (TRACED)

**Status (2026-10-24, lane A records batch 10):** CLOSED (`MC-501`, group A). Fixed in code by `bc495e3f5` and `1b881d0cd` (2026-10-07): `server/node/hubProxy.cjs` builds the target from the hub origin plus the request path and query, no request header takes part, redirects stay on the hub origin and request headers are allow-listed; `x-risu-node-path` has no hit in `server/`; the Hono server has no hub-proxy route (git grep). Forwarded headers and the request body were ticketed as CHORE-119 and CHORE-130; the header allow-list and raw body are in `hubProxy.cjs` and the server readme. Source reading, not run; the "not scheduled" and "whether Hono has the same route" text below is stale.

**Status (2026-10-04):** open, **not scheduled**; fixes are to be proposed after Stage 0 of the save-layer track. Severity: not assessed. Filed at the maintainer's "File both, extend our range (Recommended)" (`MC-194` 14). Reported by the side session's CHORE-80 investigation; verified in source by the Orchestrator, and its route code re-read for this entry at the time of writing.

- **What was traced:** `hubProxyFunc` in `server/node/server.cjs` (the `/hub-proxy/*` routes, GET and POST) uses the value of the `x-risu-node-path` request header, decoded with `decodeURIComponent`, as the URL to fetch when the header is present, and otherwise the hub URL plus the request path. It forwards the client's headers (except `host`, `connection`, `content-length` and the path header, with `origin` set to the hub's origin) and the body, follows a redirect by a second fetch, and returns the response. The function makes no `checkAuth` or `checkProxyAuth` call, unlike the `/proxy` family's handlers. The routes carry `authenticatedRouteLimiter`, which is a rate limiter (`rateLimit`), not an authentication check. The only `app.use` calls in the file are the static files and the body parsers, so no global middleware authenticates it either. Upstream origin: `0a5bae66`, 2025-11-24 (re-checked with `git log -S` at the records fact-check, ledger row 1070).
- **Consequence:** anyone who can reach the server can make it fetch an arbitrary URL and read the response. This is the shape of a server-side request forgery; whether it matters depends on who can reach the server. The hosted build is meant for private networks only (`MC-191`), so this is framed as an integrity and exposure gap on that network, not as a public-internet vulnerability. SUSPECTED, not run.
- **Not known:** whether the Hono server has the same route (TODO(evidence)); which of the app's flows send the header (TODO(evidence)).
- **Related:** `MC-194` 14; `MC-191`; CHORE-120; CHORE-80 (the side session's investigation found it).

### CHORE-203 — The Note 9 debug-build copy rate is 3.6 to 3.9 MiB/s; separate the debug cost

**Status (2026-10-24, lane A records batch 10):** CLOSED (`MC-501`, group D). Measured on the release build: 216 s mean (ledger rows 2122 and 2123, the second with corrections). The debug MEASURE build is never the daily APK (`MC-345` 5), so the optional same-commit debug/release pair named under Next is dropped, not done. CHORE-222 owns the defaults.

**Status (2026-10-22): open, not scheduled.** Source: `measure2\report.md` and `measure2\verify.md` (scratch).

- **Verified:** the asset copy took 316.0 s (3.85 MiB/s, run a1) and 334.6 s (3.64 MiB/s, a2) for 1,216.7 MiB, on a debug MEASURE build with debug Rust, on one Note 9 with a sampler adding load.
- **MEASURED during the copy window:** the flash was 10 to 12% utilised and the busiest thread about 25% (renderer main thread 25.3 to 25.5%).
- **Next (done 2026-10-22, see the status below):** the same imports on a release MEASURE build, batched with lane B's Note 9 request (`%TEMP%\risu-lane-b\device-requests\2026-10-22-stage1-stub-import-calibration.md`, scratch; CHORE-220).
- **Status (2026-10-22, later): measured on release, not settled.** On phone 2 the release build copied the m2-mix18k assets in 216 s (mean of 212.2 and 219.4 s) against debug's 325 s, 1.51x. The two runs differ in commit (`74b28ddd1` against `42993e408`, and the copy path changed between them: `assetBatchPipeline.ts`, `backuplocal.ts`, `storeImport.ts`), in start state (debug from `base1`, release from `pm clear` plus the wizard) and in collectors (the debug runs were heavier), so the build-type share is not isolated. INFERRED: one parallel lift (the lane B stage 3 knob at 4 streams, 4 flights, 70.9 s) fits a latency-bound chain, but no CPU or disk counters were taken. Next: a same-commit debug/release pair, if it still matters after lane B picks its CHORE-222 defaults. Ledger rows 2122 and 2123.
- **Related:** `MC-336`, `MC-330`; CHORE-202, CHORE-220.

### CHORE-222 — Parallel large-entry streams: pick the defaults on the Note 9, then raise them

**Status (2026-10-24, lane A records batch 10):** COMPLETE. Accepted by the maintainer (`MC-342` 1) after the Note 9 debug integrity check. Limits recorded with the acceptance in `MC-342` 1: the "import committed" mark was not observed (inferred from store2 growth), and the "Finishing copying files..." message was not seen (inconclusive, 0 of 275 polls). Three optional message-condition tests (m9b, g5, g6) were named by Gate 2 and not added; the consequence is a brief wrong message before an error, with nothing installed. Accepted as is.

**Status (2026-10-22, fixed): the Note 9 debug integrity check passed on phone 1 (rows 2130 and 2131); the maintainer accepted it (`MC-342` 1).** All 18,000 assets byte-exact (names, sha256 and sizes), 0 missing or extra, 0 risu-write or .tmp files in assets/. Limits: commit inferred, not observed; the finishing message not seen (inconclusive); the default rests on the copy knob reading null before the import (no saved artifact).

**Status (2026-10-22, implemented; merged in `af735c916` (lane B); `MC-361`, `MC-341` 1): technically accepted on the PC, pending the Note 9 debug-build check (superseded by the status above: the check passed).** Gate 1 `[REJECT]` and then `[APPROVE]` in round 2; Gate 2 `[EDITORIAL]`, E1 and E2 applied. Ledger rows 2344 to 2348. `MC-361`'s condition holds: the default does not ship before that check (main is not a release).
- **The defaults** (`src/ts/drive/backuplocal.ts`): `ANDROID_ASSET_MAX_STREAMS` 2 and Android `maxFlights` 4. The desktop keeps `ASSET_MAX_STREAMS` 1 and the literal `streamAlone` path. The MEASURE knob still overrides both.
- **The finishing message:** "Finishing copying files..." shows immediately before the drain, only when nothing stopped or failed, the source is unchanged, and the pipeline has work outstanding (`RestoreAssetPipeline.outstanding`).
  - On the tail without store2, `Loading backup...` replaces it before the commit.
  - Web and Node pages without store2 now show `Loading backup...` during the decode instead of the last percentage. This is cosmetic.
- **The PC prerequisites are met:**
  - a phone-like 60-entry mix restores byte-exact at 2,4, at 4,4 and at the default;
  - a refused name above 1 stream is reported (the stage 3 survivors r3 and r7 are now killed).
- **Note 9 debug integrity check** (lane B's device request): chosen for phone 1 (`MC-341` 2) and dispatched on 2026-10-22; the result is pending (superseded by the status above: passed).
- **Open, optional:** removing `!sourceChanged` (m9b), `stopMessage === null` (g5) or `passFailure === null` (g6) from the message condition leaves every test passing. The consequence is a "Finishing copying files..." flash before the correct error, with nothing installed. Tests for these were named by Gate 2 and are not added.

**Status (2026-10-22, later, `MC-361`): in progress; superseded by the status above.** The Note 9 run is done (row 2336), and the maintainer chose:
- 2 streams with 4 flights on Android;
- the desktop stays at 1;
- a finishing message during the drain;
- the literal path is kept.

The plan is `%TEMP%\risu-lane-b\c222\plan.md`, at Gate 1 (opus-reviewer); the implementation is in progress, uncommitted, in lane B's worktree (dated history: implemented and merged since, see the status above). The default does not ship before the PC completion test, the refused-name test above 1 stream, and a Note 9 debug-build check of the restored assets.

**Status (2026-10-22): open.** The lane B stage 3 code is merged as `42993e408`. Both defaults are 1 (today's behaviour). Source: `MC-358` 1, the stage 3 gates (`%TEMP%\risu-lane-b\s3\gate1-r1.md`, `gate2-r1.md`).

- **What exists:**
  - `RestoreAssetPipeline` (`src/ts/drive/assetBatchPipeline.ts`) takes `maxStreams` and `streamSliceBytes`.
  - At `maxStreams` 1, the copy runs today's literal path (`streamAlone`).
  - Above 1, large entries stream beside each other and beside batches:
    - the last entry in file order wins for keys that fold equal;
    - a sink, batch or source failure stops the other streams before their next chunk (`MC-358` 2);
    - Android streams read one writer chunk (1 MiB) per slice.
  - **The knob.** A MEASURE-only knob, `localStorage['risu-measure-copy'] = "<streams>[,<flights>[,<sliceKiB>]]"`, is read in `backuplocal.ts` `copyMeasureLimits` on every import. `risu-measure-copy` is in `util/checkReleaseDist.mjs` `FORBIDDEN_MARKERS`.
- **Next:**
  1. A Note 9 run: a `VITE_RISU_MEASURE=1` release build, a large `.bin` such as `m2-mix18k.bin` (34.4% of its bytes in entries above 1 MiB). Streams x flights in {1,2,4} x {2,4}, and the slice size where it matters. Record the copy rate (`__risuImportPhases`) and the renderer and app PSS peak. A device request goes to lane A once this stage is committed.
  2. Before raising a default above 1:
     - (a) a test at more than 1 stream that a refused stream name is reported in the import's skipped list (Gate 2 mutant r7 survived; today it is reachable only through the knob);
     - (b) the maintainer settles the progress text during a long drain (the percentage counts bytes read and can sit at 100% while streams finish);
     - (c) decide whether the literal `maxStreams` 1 path is deleted (the new path at 1 is not identical: batches would overlap the stream).
  3. A one-line change sets `ANDROID_ASSET_MAX_STREAMS`, the desktop `ASSET_MAX_STREAMS` and, if measured, the Android flight count.
- **Known, accepted:** when the loop throws, the caller skips `stopStreams` (Gate 2 mutant r3 survived). The only effect is a delay before the error shows.
- **Related:** `MC-358`, `MC-328` 2, `MC-197` 9.

### CHORE-226 — Why the `shard:13` unit is rewritten on every select commit

**Status (2026-10-24, lane A records batch 10):** CLOSED with no codec change (`MC-348`). The shard rewrite on select was not shown to be unnecessary and costs about 10 ms of CPU on desktop; the stage 0 timers decide whether commit cost ever matters.

**Status (2026-10-23): sized (lane B row 2437, doc-verifier PASS); closed with no codec change.** Title and facts are from lane B's records (row 2437); this heading was added by lane A's batch 4. The maintainer: "A: no codec change (Recommended)" (`MC-348`).
- Finding: not shown to be an unnecessary rewrite. A shard unit holds the index rows of about 30 characters (`SHARD_COUNT` 16); `changeChar` sets `lastInteraction` on every select and a chat-row tap sets `chatPage`, so each select was expected to rewrite a whole shard twice (about 76 KB per select, including a 33,141 B shard; INFERRED in lane B's sizing, not seen on the phone: part 5 saw one `shard:13` commit of about 38 KB with only `lastInteraction` changed, on the already-open chat; a warm re-select and `chatPage` were not tested, and the units log was not reset before the tap). The serialization is canonical.
- Phone part 5 field diff: one shard:13 commit, with `lastInteraction` the only change in one entry. `chatPage` and a warm re-select were not tested, and commit attribution is limited (the units log was not reset before the tap). Part 4 saw the same-size shard rewritten under a new key on each commit; its cause was not traced.
- About 10 ms of CPU on the desktop, so it does not explain the 2-3 s ticks. Stage 0 timers decide whether commit cost matters.

### Character list rework (2026-10-10): Stage 1 plans, gates, checks, accepted limits

**Status (2026-10-24, lane A records batch 10):** stage records COMPLETE. Every stage in this section is on `main` (`62d55ab6`, `6833d0ac`) with its gates; its records were verified (ledger row 1584, PASS WITH FIXES). The item's open work is the Character list rework row of the open-tickets table in the Roadmap. Accepted device limits stated below are not resolved by this line.

Summary status is in the "Character list rework" bullet near the top. Everything below is from the session scratch reports named in the ledger rows 1576 to 1583 (`charlist\`); "session scratch" paths are relative to it. Decisions: `MC-262`, `MC-263`. Stages 2 to 4 are not recorded here: the Stage 2 plan drafter running when this was written is not part of this closeout.

**Investigation and its verification.** `survey.md` (`investigator`, source-read at `dfc5062e`) was checked by `doc-verifier` (`verify.md`): CONFIRMED that avatar gating mounts all DOM and two observer registrations per card and falls open with no observer, that grid, list and trash follow `db.characters` order while the simple list follows `lastInteraction` descending, and that only the sidebar rail uses `characterOrder`; PARTLY on the scan count (at most 2 scans per keystroke, not 3), on the stub (no tags or creator; its `creatorNotes` is the shown description, cut to 500) and on the harnesses (`charlist-avatar-count` fakes an all-visible observer, so it cannot show gating). Omissions it found: A. the mobile list shows trashed characters and has no trash tab; B. each avatar is wrapped in `{#await}`, which re-creates its button on resolve; C. the scroll root differs per tab; D. the stub rule above; E. the row keys follow `db.characters` order, so re-keying by id is a prerequisite for Stage 3. Raw usage: survey 159,734 tokens, verifier 69,444.

**Plan.** `plan-s1.md` (a draft; the maintainer's round 2 answers followed it). Two slips in the plan were corrected before Gate 1: `describeForSearch` should read `stubDescription`, and R5 counts `isHiddenSystemCharacter` calls per debounced keystroke (at most one index rebuild, no per-keystroke `db.characters` scan; base 2N and more). Stage cut: 1a search and header; 1b the mobile trash view.

**Gate 1 (`adversarial-reviewer`, `gate1-s1.md`): `[APPROVE WITH CHANGES]`, seven required changes, none changing the design or the cut.** R1 a combined matched set so `hideTrash:false` still lists trashed rows; R2 the cache holds normalised strings only and flags, id and position are read fresh; R3 the header shows the open tab's count (answer 7) and the "Trash (n)" count choice is stated and tested; R4 hide the add button while the trash view is open; R5 the shared result is an object of getters read lazily, with an embedded-reactivity test; R6 the default flip of `hideTrash` moves to 1b; R7 the test list additions. Recommended: R8 to R10; R11 (low) notes that a loaded character's words past character 500 are not findable, which is the maintainer's rule.

**Stage 1a (`62d55ab6`).** Implemented by `sonnet-coder` (`stage1a-report.md`). Red before green: on the base, 41 failed and 108 passed over `MobileCharacters.search`, `GridCatalog.search` and the four edited test files (`red-1a.txt`); the two `src/ts/gui/tests` files cannot load on the base (specification tests, not reproducers). After: `npx vitest run src/lib/Mobile src/lib/Others/GridCatalog src/lib/Others/charlistAvatar src/ts/gui src/ts/process/tests/coldCharacter` 19 files, 384 passed, 0 failed; `pnpm check` 0/0 (`after-1a-r1.txt` repeats these figures after the remediation dispatch described below; the committed `characterSearch.ts` writes the zero-width characters as `\u` escapes). Harness (`Agents/Tools/save-gen/charlist-search-count.svelte.harness.ts`, happy-dom, all-visible observer fake, counts only; `baseline-1a.txt`, `after-1a.txt`): `isHiddenSystemCharacter` calls for a three-keystroke burst fall from 1,500 (simple) and 3,000 (grid) at 500 characters, and 3,000 and 6,000 at 1,000, to 0; element additions and removals, observe and unobserve counts and final DOM size are identical to the base. **Gate 2 (`adversarial-reviewer`, `gate2-1a.md`): `[APPROVE WITH CHANGES]`, `[EDITORIAL]` class, no substantive defect.** It re-ran the targeted tests (19 files, 384 passed) and `pnpm check` (0/0), re-ran the base on a scratch copy (41 failed, 34 passed of 75 in the two search files, same count as the coder), and ran its own mutations M1, M2, M3, M5, M6, M8, M9 and M10, which the tests caught; M4 and M7 (dropping the `{#if c}` and `{#if char}` guards) left every test green. Findings: F1 (low, test strength) those guards are unexercised defensive code; F2 (editorial) literal invisible characters in the regex classes, now `\u` escapes in the committed source; F3 (editorial) the new test files are LF while some working-copy sibling tests show CRLF (autocrlf only; the index is LF throughout; no repository harm); F4 and F5 information (the unused `search` prop on the embedded list, dropped in 1b; the 500-character limit). The remediation dispatch applied the editorial fixes (per the coordinator's follow-up message of 2026-10-10, not a saved report): F2, the literal invisible characters replaced by `\u` escapes in three files; F1, the guards could not be made red, so a comment marks them as defence in depth.

**Stage 1b (`6833d0ac`).** Implemented by `sonnet-coder` (`stage1b-report.md`). Red before green: 14 failed and 141 passed over the runnable files on the base (`red-1b.txt`); the `CharacterTrashList` test cannot load on the base. After: `npx vitest run src/lib/Mobile src/lib/Others/GridCatalog src/lib/Others/CharacterTrashList src/lib/Others/charlistAvatar src/ts/gui src/ts/process/tests/coldCharacter` 22 files, 408 passed; `pnpm check` 0/0 (`after-1b.txt`). No new language keys. **Gate 2 (`adversarial-reviewer`, `gate2-1b.md`): `[ACCEPT with notes]`, gate token `[APPROVE]`, no required changes.** It re-ran 15 files, 212 passed, and `pnpm check` 0/0, and read the red run; it did not re-run the red on a scratch copy and ran no mutations. Optional notes: no guard test that the embedded simple tab shows no Trash row and no trashed characters (true by construction); an unindented `{:else}` block (cosmetic). Behaviour: `trashOpen` is local state, so a swipe leaves the screen and resets it; the add button is hidden while the view is open; the "Trash (n)" row counts the whole trash, excluding hidden system characters and ignoring the query, while the open view applies the search (the Orchestrator's choice, `MC-263` 3).

**Full checks by the Orchestrator on the final trees** (the coders and reviewers ran targeted tests only). 1a: `full-1a.txt` `pnpm test` 630 files passed, 12,543 passed, 6 skipped (12,549), 109.69 s; `check-1a.txt` `pnpm check` 0 errors and 0 warnings; `build-1a.txt` ends "built in 20.51s". 1b: `full-1b.txt` 633 files passed, 12,567 passed, 6 skipped (12,573), exit 0, 114.89 s; `check-1b.txt` 0 errors and 0 warnings, exit 0; `build-1b.txt` ends "built in 12.98s", exit 0. The test logs show the same iframe `NotSupportedError` and Svelte class-declaration warning output in both runs; the runs passed. Commits: `git show --stat` 14 files, 2,599 insertions and 161 deletions for `62d55ab6`; 7 files, 1,203 insertions and 51 deletions for `6833d0ac`.

**Accepted limitations and what is not verified.**
- The harness figures are counts in happy-dom with an all-visible `IntersectionObserver` fake, not timings, and they show no change in DOM or observer counts until windowing (Stage 2). Nothing was run in a browser or on a device; no frame-budget or phone claim follows from these figures.
- The mobile trash view has not been tried on a phone; the check is deferred to Stage 2 (`MC-263` 2). Not checked there: scroll, swipe inside the trash view, the add button.
- Words past character 500 of a loaded character's notes are not searchable, and tags and creator are searched for loaded characters only; both follow `MC-262` 3 and are tested.
- The mobile placeholder "unnamed" is no longer searchable; this was an intended change, stated in the plan and tested.
- Both search box routes (desktop and the mobile header) are now debounced in the consumer, so the header count and the rows follow the landed query.
- The defaults taken without asking (`MC-262`) are not confirmed by the maintainer.

**Remaining work (item stays IN PROGRESS).** Stage 1c, added before Stage 2 on the maintainer's round 3 answers (`MC-264`): a click anywhere on a Grid or List entry (except its delete button) opens the character and closes the screen, as Simple does; trash rows no longer open on click (restore and delete only); List descriptions get a "Show more" / "Show less" button, shown only when the text is cut off, which needs two new English keys (the translator adds the other languages). The Orchestrator's finding behind it: the grid and list tabs and the trash avatar call `changeChar` without `endGrid`; only the simple tab closes the screen, and no show-more key exists. Not yet planned or gated when this was drafted. Stage 2, windowing of the character lists, with the phone check of the trash view folded in. Stage 3, the grid reads `characterOrder` read-only and shows folder tiles. Stage 4, drag and folder management in the grid (`opus-reviewer` gate). Records for Stages 2 to 4 are to follow.

**Records closeout for Stage 1.** Drafted by `doc-writer` from the Orchestrator's brief and the saved reports (ledger row 1584). Independent verification by `doc-verifier` has not been recorded when this was drafted. Records not yet committed. (Update 2026-10-10: `doc-verifier` PASS WITH FIXES, fixes applied, per ledger row 1584; the records were committed in `25eeca6e`.)

### Character list rework (2026-10-10): Stages 1c, 2a and 2b

**Status (2026-10-24, lane A records batch 10):** stage records COMPLETE. Every stage in this section is on `main` (`9c1b8a39`, `ac2db1fb`, `e31b4f2f`) with its gates; its records were verified (ledger row 1614). The item's open work is the Character list rework row of the open-tickets table in the Roadmap. Accepted device limits stated below are not resolved by this line.

Summary status is in the second "Character list rework" bullet near the top. Everything below is from the session scratch reports named in ledger rows 1585 to 1608 (`charlist\`, `backupname\`); "session scratch" paths are relative to it. Decisions: `MC-265`, `MC-266`, `MC-269`, `MC-271` (and `MC-267` for the backup name, which is not part of the rework). The reports are the coders' and perf-analyzers' own; the device reports were not independently verified (no verifier row).

**Stage 1c (`9c1b8a39`; `stage1c-report.md`).** Red on the unmodified components: 20 failed, 38 passed. Decisions: `MC-264` items 8 to 10 and `MC-265` items 11 and 12. Behaviour: a click anywhere on a Grid or List entry (except delete, "Show more" and links, and not a drag that selects text) opens the character and closes the screen; trash rows keep restore and delete only; List and Trash descriptions render through `ParseMarkdown` without a character, then `stripMedia` removes images, media, SVG, style blocks, image-fetching or escaped inline styles, app-control attributes (`risu-*`, `x-hl-*`), forms and non-web link targets, and the List clamps at three lines by height (`max-h-18`). Gate 2: `[REJECT]` (B1, B2), then `[PASS WITH FIXES]` by a second fresh reviewer (F1 forms); the coder's r1 and r2 applied the fixes; the review of r2 is not recorded. Full run 638 files, 12,630 passed, 6 skipped; `pnpm check` 0 and 0; build exit 0. Accepted and not verified at commit time: the visual result (Tailwind clamp, prose styles) had not been seen in a browser; the markdown cache is bounded by entries (200 texts), not bytes; the clamp has no ellipsis and can cut the last line (CHORE-171); the parse of a description is skipped for rows far from the viewport.

**Stage 2a (`ac2db1fb`; `stage2a-report.md`, `gate1-s2.md`, `plan-s2-v4.md`, `gate2-2a.md`, `note9-2a.md`).** New `CharacterWindow.svelte`, `charListRows.ts`, `CharListAvatar.svelte`, `windowErrorGuard.ts`; the rail's `computeLayout` is reused through a heights map (`railLayout.ts` untouched). Reproducers fail on the base on assertion errors (for example "expected 200 to be less than 40"); feature tests and guards are labelled in the report. Harness counts (happy-dom): List 12 rows and Simple 22 at every N from 500 to 2000, against N rows on the base. Final tree: `pnpm test` 648 files, 12,736 passed, 6 skipped; `pnpm check` 0 and 0; `pnpm build` exit 0. Note 9 (SM-N960N, API 29, 1000 synthetic characters, 875 live and 125 trashed): List 8 to 14 rows mounted of 875, Simple 16 to 25, mobile list 17 to 26, Trash 7 to 12 of 125; List 5.27% janky over 7,415 frames (p99 21 ms), Simple 5.03%, mobile list 3.93%, Trash tab 17.05% and 13.05% over 475 and 590 frames; the Q8 immediate correction did not cut a fling (229 programmatic writes; gross travel equal within 0.3%); Back from the mobile trash returned to the same row and offset; 0 `ResizeObserver loop` events. Not observed: raster blanks (DOM and four screenshots only), a 1000-row trash on the phone, Tab on the phone, the link tap on the base, Pi 3 or mid-range phones.

**Stage 2b (`e31b4f2f`; `plan-s2b.md` v2, `stage2b-report.md` r1 to r4, `note9-2b.md`).** `CharacterWindow` gains a grid layout (rows of tiles; the column count is `floor((width + gap) / (tile + gap))` from a rendered 1 rem probe, so Android font scaling cannot over- or under-count); `scrollbar-gutter: stable`; a partial last row stays centred; each tile is a list item with `aria-setsize` and `aria-posinset`. A column change runs in the next animation frame, outside the observer delivery, and keeps the first visible tile (a sticky anchor repeats the same tile across changes). `CharListAvatar` caches resolved styles (300 entries, 32 KB per entry cap, no failed or empty-URL results). Red on the base copy: 38 failed, 177 passed of 215 in nine files. Gate 1 `[PASS WITH FIXES]`; Gate 2 as in the status bullet. Final tree: `pnpm test` 648 files, 12,784 passed, 6 skipped; `pnpm check` 0 and 0; build exit 0. Device: first pass found D1 (Android font scale: 6 columns and a clipped sixth tile at 0.85) and D2 (`ResizeObserver loop` events on column-narrowing; benign, no alert); after r3 the recheck showed 5 columns with no overflow at 0.85, 1.1 and 1.3, 0 loop events on the phone (4 rotations) and the desktop (8 resizes), the same tile after rotation round trips; 2.57% janky over 5,952 frames, one run at 15.0%. In the first desktop pass (before r3) the heap stayed flat over four full sweeps (35.59 to 35.74 MB), with about 300 distinct style strings in a heap snapshot. **Accepted and not observed:** r4's anchor edge cases are unit-tested only (the device builds preceded them); the Tauri desktop app, real browser zoom, raster blanks, a tap during momentum, a 1000-row trash on the phone, Pi 3 and mid-range phones were not run; the cause of the 13 to 15% bimodal jank runs is unattributed; after browsing more than 300 distinct avatars, returning to the top re-creates tiles that show grey first (the designed cache bound); an unexplained selection of Card 0064 while the Edge window was minimized is treated as a harness artefact until reproduced; the 2a link-tap alert was not retested; a one-frame interval of old rows after a column change was not looked for.

**Remaining work (item stays IN PROGRESS).** S3: row keys by character id (the 2a keys are `String(match.index)`, so a permanent delete shifts them and the focus pin can follow an index onto another character once), then the grid reads `characterOrder` read-only with folder tiles. S4: drag and folder management in the Grid (`opus-reviewer` gate), arrow keys, the per-row centring offset for the drag hit test (`gridRowInset` was not added in 2b). Windowing of the plugin, module and preset lists follows the rework. Tickets: CHORE-169 to CHORE-174 below.

**Records closeout for Stages 1c, 2a and 2b.** Drafted by `doc-writer` from the saved reports, `answers.md` and `git show --stat` (ledger row 1610). Independent verification by `doc-verifier` has not been recorded when this was drafted. Records not yet committed.

### Character list rework (2026-10-10 to 2026-10-11): Stage 3, S4-1 and S4-2

**Status (2026-10-24, lane A records batch 10):** stage records COMPLETE. Every stage in this section is on `main` (`6035dd56`, `08b88870`, `8f10f04b`, `f4d2205f`, `49c10864`, `ff5bd37e`, `e75b1249`) with its gates; its records were verified (ledger row 1696). The item's open work is the Character list rework row of the open-tickets table in the Roadmap. Accepted device limits stated below (the name-sort long press for the next Grid device pass, the "Moved N items" key not added, the S4-2 test remediation without a re-review) are not resolved by this line.

Summary status is in the third "Character list rework" bullet near the top. Everything below is from the session scratch reports named in ledger rows 1641 to 1694 (`charlist\`, with the answers record `charlist\records-s34\maintainer-answers.txt`, the handbacks in `charlist\records-s34\handbacks\` and the usage figures in `charlist\usage.txt` and `charlist\records-s34\usage-session.txt`); "session scratch" paths are relative to `charlist\`. Decisions: `MC-273` to `MC-278`. The reports are the coders', reviewers' and device agents' own. The device reports and the F2 trace (`f2-trace.md`) were not independently verified (no verifier row); `avatar-cache-investigation.md` was spot-checked by the Orchestrator only (its core claims: the `avatarThumb` memo holds up to 1000 entries or 16M characters, thumbnails are `data:webp` URLs, blob URLs are revoked).

**Stage 3 plan and Gate 1.** `plan-s3.md` (`investigator`, base `8c6146ed`) cut the work into 3a stable keys, 3b the Grid on `characterOrder` (3b-1 the order and folder tiles, 3b-2 sections) and 3c the sort selector. Gate 1 (`adversarial-reviewer`, `gate1-s3.md`) `[PASS WITH FIXES]`, 12 findings, all accepted into `plan-s3.md` "Gate 1 amendments": 1 HIGH (3b: duplicate order entries would give duplicate card keys, so each order occurrence takes the next unused live holder of its id and unused holders are appended); findings 2 to 7 MEDIUM (focus survival across a folder toggle specified on a mechanism that cannot work; the reproducer R7 not true as stated; `MobileCharacters` has no source for the occurrence number; R5 not a regression reproducer; the "Grid never writes `characterOrder`" guard too weak; the shared open-folder key needs two explicit conditions); finding 9 LOW (copy before sorting). Findings 8 and 10 to 12 are not summarised here.

**Stage 3a (`6035dd56`, 10 files, +836/-37; `stage3a-report.md`, `gate2-3a.md`).** List and Grid cards, Trash rows and the mobile Simple list are keyed by slot (the character id plus how many earlier non-hidden slots share that id; trashed slots count), through one `slotKeys` helper in `characterSearch.ts`; a key that is gone resolves to nothing, never to a neighbour. Red on the base: 7 tests, 5 failed on assertions (for example focus moved from D to E after deleting B; "expected 'Character 20' to be 'Character 19'" after leaving the mobile trash view), 2 guards passed. Final tree (the coder's run): `pnpm test` 657 files, 12,919 passed, 6 skipped; `pnpm check` 0 and 0. Gate 2 `[PASS]` (the reviewer re-ran the reproducers on the base: 5 of 7 failed).

**Stage 3b-1 (`08b88870`, 4 files, +1,048/-18; `stage3b1-report.md`, `gate2-3b1.md`).** New `charListOrder.ts` (`buildGridEntries`): the Grid shows the saved order read only, a folder is one tile, hidden, trashed and dangling ids are skipped, characters the order does not list are appended in database order, a search is flat with a folder badge, and open folders are shared with the rail through its `localStorage` key (`risutanium.rail.openFolders`). The Grid never writes the database and never calls `checkCharOrder`. Red on the base: 13 failed, 2 passed (assertion failures and feature-absent failures; the 2 are guards). Final tree: `pnpm test` 659 files, 12,944 passed, 6 skipped (`full-3b1.txt`); `pnpm check` 0 and 0; build ok. Gate 2 `[PASS WITH FIXES]` (no substantive defect): the reviewer's mutations showed the focus test could not fail in 3b-1 and a reassignment of `characterOrder` in the toggle went undetected; the Orchestrator applied the `characterOrder` reference check and a test title (`pending-records.txt`; the commit message says two test fixes).

**Stage 3b-2 (`8f10f04b`, 6 files, +949/-15; `stage3b2-report.md`, `stage3b2-fix-report.md`, `gate2-3b2.md`, `gate2-3b2-fix.md`).** An open folder's tile and members form a section of whole rows in the folder's tint (`gridSectionRows` in `charListRows.ts`, `folderSectionClass` in `charListOrder.ts`, a class and `data-charlist-folder` on the window's grid row); a folder tile looks up its own picture and shows the sidebar's face (the name with Show Folder Name, else the icon) when the picture is empty, missing or failed, or when hide-all-images is on. Red on the base: 11 failed, 4 passed. Gate 2 `[PASS WITH FIXES]`: finding 1, the picture lookup repeated and blanked on every toggle (fixed with a per-Grid lookup cache keyed by picture and hide-all-images, red 1 failed and 16 passed before); finding 2, with hide-all-images the Grid shows the face where the rail shows its placeholder image (kept, `MC-275` 2); delta review `[PASS]`. Final tree after the fix: `pnpm test` 660 files, 12,969 passed, 6 skipped; `pnpm check` 0 and 0; build exit 0.

**Stage 3b-3 (`f4d2205f`, 2 files, +47/-14; `stage3b3-report.md`).** Device defects from the first pass (below): closing a folder whose tile was partly scrolled off the top made the list jump because the refocus scrolled the tile into view, so focus is restored with `preventScroll` (F1); a folder with a missing picture showed an empty dark tile, so the face is always drawn over the picture layer (F3). The focus reproducer is mock-level (it spies on `focus`); the scroll effect itself is a device check. Final tree: `pnpm test` 660 files, 12,970 passed; `pnpm check` 0 and 0; build exit 0. Gate 2 `[PASS]` with no fixes (the report came in the reviewer's hand-back and is not saved as a file).

**Stage 3b-4 (`c8a99472`, 2 files, +123/-26; `gate2-3b4.md`).** `CharListAvatar`'s style cache is bounded by 16 MiB of style text (the shared thumbnail memo's budget) and 4,000 entries, least recently used first, instead of 300 entries; the 32K-character per-entry cap, the skip of failed pictures and the hide-all-images key are unchanged. Reproducers: a pass over 625 thumbnails keeps them all, the budget fills to 16 MiB, 4,000 tiny styles fit; a guard checks the running total. The commit message gives `pnpm test` 660 files, 12,973 passed, `pnpm check` 0 and a good build; no saved run file for these figures. Gate 2 `opus-reviewer` `[APPROVE]` with no fixes (the new tests fail on the old cache: 3 of the 4; each bookkeeping mutation turned a test red). Memory cost, by the reviewer's reasoning and the maintainer's acceptance (`MC-275` 6): thumbnail bytes are held in both caches; style strings are ASCII, so about 16 MiB of one-byte data, with a pathological two-byte ceiling of 32 MiB (reasoning, not measured).

**Stage 3c (`49c10864`, 14 files, +503/-21; `stage3c-report.md`, `gate2-3c.md`).** A Sort selector on its own line below the tabs, Grid tab only: My order (the sidebar order with folders), Recent (last interaction, newest first, the comparator shared with the Simple tab) and Name (the displayed name, ties by key). Recent and Name are flat like search, with a folder badge on members. The choice is kept in `localStorage` (`risutanium.grid.sort`, `gridMemory.ts`), never in the database or backups; a sort change scrolls to the top, a folder toggle does not; open folders are kept for when My order returns. Folder icons and names get a dark shadow (F5). New keys `othersUi.sortLabel` and `othersUi.sortMyOrder` in every locale. Red on a copy of `c8a99472` with the new tests: 17 failed (8 in `charListOrder`, 9 in `GridCatalog`); two of the guards fail there only because the export and the selector do not exist. The coder's run had 6 `localeParity` failures until the translator ran. Final tree per the commit message: `pnpm test` 661 files, 12,998 passed; `pnpm check` 0 errors; build ok (no saved run file for this final run). Gate 2 `[APPROVE]`; its notes: a doc comment's wording, no test for the unnamed placeholder or for duplicate, hidden or trashed ids in the flat modes, a missing trailing newline in a test file, and the 360 px layout reasoned from markup only.

**Device passes for Stage 3 (not independently verified).** `note9-3b.md` (build at `8f10f04b`): Note 9 SM-N960N, API 29, WebView Chrome 153, 411 x 773 CSS px, font scale 1.1, 1000 synthetic characters (875 live, 125 trashed, 50 folders; the closed Grid is 325 tiles, 281 of them characters, 44 folders), plus Edge against the Node server on Windows (not the Tauri app). Windowing with folders 90 to 140 tiles mounted closed and 95 to 145 with the 150-member folder open, 0 blank frames at row level; rotation with an open section stable; the 3a phone check passed (delete a trashed character, Back: top row and scroll offset unchanged); open state shared with the rail both ways; keyboard focus stays on a folder tile across toggles. Findings: F1 closing a folder whose tile is partly above the viewport jumped the scroll (-369 px on the phone), mechanism measured to be the refocus `focus()` call; F2 fling jank with every folder open (CHORE-177); F3 a folder whose picture file is missing showed an empty tile; F4 (minor) with Show Folder Name on, a folder with an empty name shows a blank tile (the report did not compare the rail; reading `SidebarRail.svelte` at `e75b1249`, the rail also renders the name with no fallback). `note9-3b34.md` (build at `c8a99472`): F1 passes (2 of 2 partly visible, 1 fully visible), F3 passes (all 5 pictured folders show the face over the picture), the avatar cache shows 0 late style writes (652 to 904 before), the CSS image requests persist (CHORE-177), F2 re-measured at 10.04% all open. F5 (minor, the pass-3b recheck's label): a white folder name over a bright noise picture is hard to read (fixed in 3c; in the S4-2 pass the icon was readable and the name "readable but weak" over the same fixture picture, `note9-s4-2.md` check 9, a marginal pass with the same fixture caveat). Not observed: the Tauri app, raster blanks (DOM level only), a tap during momentum scrolling, the fling pass under Android font scaling or in landscape, a Pi 3 or a mid-range phone.

**Stage 4 plan.** `plan-s4.md` (`investigator`, base `49c10864`) drafted a Grid edit mode as 4a (shell, selection), 4b (drag, writes `characterOrder`) and 4c (new folder, bulk delete, folder menu); it refuted the premise that folder management can simply be reused (the menu is closures local to `SidebarRail.svelte`). The `senior-advisor` (`advisor-s4.md`) advised generalising `RailDrag` behind a geometry resolver in its own commit, keeping `gridTarget.ts` as the two-dimensional resolver, two order operations only, and listed what not to do (overlays inside measured rows, a ghost positioned by `top`/`left`, iterating the selection per tile, the default `touch-action`). Gate 1 (`opus-reviewer`, `gate1-s4.md`) `[APPROVE WITH AMENDMENTS]`, A4-1 to A4-17 binding the coder briefs; it settled that a trash-only change needs no `requiresFullEncoderReload` (a trashed character stays in `db.characters`; `markCharacterForSave` per id suffices). The Orchestrator's stage list (`answers.md`; the stage numbers S4-1 to S4-6 are not in `plan-s4.md`, which uses 4a to 4d): S4-1 rail generalisation, S4-2 edit shell, selection, chevron and bulk trash, S4-3 group into a new folder, S4-4 drag (hit test, moves, append, dwell merge, Alt+Left/Right, the "Moved N" announcement), S4-5 folder-menu extraction and the Grid menu (own commit, touching `SidebarRail.svelte`), S4-6 arrow-key focus. The answers are `MC-277`.

**S4-1 (`ff5bd37e`, 5 files, +262/-9; `stage4-1-report.md`, `gate2-s4-1.md`).** `railResolver.ts` (`RailGeometry`: `sourceAt`, `hasKey`, `zoneCandidateAt`, `resolveTarget`, with a default that delegates to the old functions) and an optional third constructor argument on `RailDrag`; `bindRail` takes a `RailMachine` type so another machine with the same methods can be bound. No existing test was edited. Red: one reproducer ("geometry decides source, target and source-gone check") fails on `49c10864` with the new files copied in; the other new tests are guards. Rail suites: 41 files, 677 tests pass. Final tree: `pnpm test` 663 files, 13,002 passed, 6 skipped; `pnpm check` 0 and 0; build ok. Gate 2 `opus-reviewer` `[APPROVE]` with one optional editorial note (a positional assertion): four geometry sites in the base all route through the resolver; in-memory mutations of each call site turned the reproducer red.

**S4-2 (`e75b1249`, 26 files, +3,259/-62), with S4-2b and S4-2c folded in.** *Edit mode.* `GridCatalog.svelte` (edit mode, picks, chevron, floating Edit/Done button), `charListEdit.ts` (a pick remembers the character object or folder entry it stood for, so an action acts only on picks that still resolve to the same object), `gridTarget.ts` (the pure hit test over the window's rows), `CharacterWindow.svelte` (`attach` and `getGeometry()`); the long press reuses `RailDrag` through `bindRail` with a Grid geometry whose zone and target are empty, so there is no drag and no write; a mouse never long-presses. Escape, Done, a tab switch and closing the screen leave edit mode and clear the selection. Under Recent or Name the Edit button and the long press switch to My order first. *Bulk trash.* `trashCharacters()` in `characters.ts` (+78): one confirmation naming the count (plus the busy line), an identity re-check after the dialog, `stopWorkIn`, `trashTime`, a picked folder replaced in place by its non-trashed members, `checkCharOrder` twice, `markCharacterForSave` per character, `requiresFullEncoderReload` untouched. *Back and the quit toast (S4-2b Change 1).* `backHandlers.ts` turns `window.__risuTaniumBack` into a registry (newest first, the first handler to return true ends the press); the phone overlay sidebar moved onto it and the Grid registers while editing; when none takes the press the guard in `main.ts` shows "Press Back again to quit" and a second Back within 2 s (`QUIT_WINDOW_MS`) quits; the arm is dropped when the page goes hidden; while a dialog or alert covers the page (`pageCovered()`) Back quits at once with no toast; `MainActivity.kt` has comment updates only. *The hold (S4-2b Change 2).* `railDrag` hosts may return false from an optional `edgeScroll()` (the Grid does; the sidebar keeps its edge scroll); `enterEdit` scrolls once, after a sort switch, to the held tile (selected) or, for a member of a closed folder, to its folder tile (nothing selected). *The count row (S4-2c, D9).* In edit mode the Sort row (one fixed `h-8` row) shows the count and "Move to trash"; the old in-flow bar is gone. *Keys.* `alerts.pressBackAgainToQuit` and `othersUi.editMode`, `editDone`, `editMoveToTrash`, `editSelectedCount`, `editFolderToggle`, `editTrashConfirm` in English and six locales; the translator rated the Vietnamese and Spanish toast phrasing and the German quotation marks as medium confidence.

*Red, mutants and gates.* S4-2: the coder's mutants M1 to M15 and T1 to T9 were caught except M12 (equivalent through a disabled button); Gate 2 `opus-reviewer` `[EDITORIAL]` ran its own mutants (X3, X5, X6 caught; X1, X2, X4, X11 and X12 survived), found a test title that overstated a sort switch the test never made, and found no save-safety, ordering or write-path defect; the coder's tests-only remediation caught X1, X2, X4 and X11 (X12 stays unit-level), and no re-review is recorded. The reviewer's finding 5, that the six locale `editTrashConfirm` strings drop a sentence, was refuted by the Orchestrator (the English string has none). S4-2b plan: Gate 1 `[REJECT]` at round 1 (the mechanism was sound; five points needed plan changes, findings 1, 2, 3, 4 and 7), `[REJECT]` at round 2 (the folder-tile key derivation, the edge auto-scroll that survives the scroll, reproducers red for the wrong reason), `[REJECT]` at round 3 (a release-time scroll under My order that nothing authorized; the closed-folder path ends at the switch, not at release), then the `senior-advisor` escalation traced the scroll problem to the rail machine's edge auto-scroll, which the Grid cannot use; the plan was split into Change 1 and Change 2 and round 4 on Change 2 was `[EDITORIAL]`. Change 1 red: "Back while editing exits edit mode" (`expected undefined to be true`) and "open overlay with a toast up: still consumed" (`expected false to be true`); Gate 2 `[APPROVE]` with two editorials. Change 2 red: 3 of 41 Grid tests failed (for example `expected +0 to be 224`) and the declining-host `railDrag` test; Gate 2 `[REJECT]` for tests only (four surviving mutants), after which each mutant a to d fails exactly one test (`mutant-a.txt` to `mutant-d.txt`); the Orchestrator accepted this on those outputs with no reviewer re-run. S4-2c: Gate 1 on revision 1 `[REJECT]`, revision 2 had no recorded Gate 1; red 5 failed, 40 passed; green 45 of 45; Gate 2 `[APPROVE]`. A class-only hardening of the edit row (`shrink-0 whitespace-nowrap` on the button, `min-w-0 truncate` on the count) got a fresh review `[APPROVE]`; only the 45 Grid edit tests and `pnpm check` were re-run after it. *Checks.* Final S4-2c tree: `pnpm test` 669 files, 13,111 passed, 6 skipped (exit 0); `pnpm check` 0 errors, 0 warnings; build exit 0.

*Device (Note 9, debug builds, same fixture; not independently verified).* `note9-s4-2.md` (before Back handling): a long press enters edit mode and selects the held tile (no native menu seen; a haptic observed, inferred to be the app's vibrate call); taps toggle, the chevron opens and closes folders; Back in edit mode closed the app (no handler yet); edge auto-scroll ran during a held press and could scroll the held tile away; changing the sort while editing left edit mode; bulk trash of 2 characters and a folder with one member removed exactly 4 tiles and, after Restore, the three characters returned at the end of My order outside any folder and the folder did not come back (the dialog says "A restored character returns outside any folder"; existing restore behaviour). Fling jank was informational only: all open, edit mode off, 14.22% pooled (5 of 10 runs over 10%); edit mode on 33.06% with 4 of 10 runs in device slow mode and half the frames per run, unexplained and confounded by run order and heat; closed 24.07% pooled, 2.77% over the 6 runs outside slow mode. `note9-s4-2b.md` (HEAD `5b0fa42b` plus the uncommitted tree): Back in edit mode leaves it with no toast; the next Back toasts and a Back within 0.8 s quits, one after 3.2 s toasts again; the toast also works in Settings and the chat screen; the phone overlay sidebar closes on Back with no toast; with a dialog open Back quits at once; holds in the edge bands did not scroll; a Recent long press switched to My order with the tile centred and selected; a closed-folder member gave edit mode with 0 selected and the folder tile visible; the label reads "Move to trash". Deviations: the Beta Mobile GUI "Menu" page (CHORE-180), a held bottom tile showed only a 9 CSS px sliver after the count bar appeared, and a top hold selected the count text (both addressed by S4-2c). The corrected interleaved jank pass read edit off 25.16% against on 15.42% pooled (informational; the first pass was a protocol artefact). `note9-s4-2c.md`: all 6 checks pass: the header row is 32 px in both modes and no tile moved; a bottom-band hold left the tile in place; a top-band hold left no text selection; German fits on one line at 411 dp and the count is cut short at an emulated 360 dp; a Recent long press and Back, then the toast, were rechecked. Not checked: the desktop pointer and keyboard path (Escape, mouse) on any device, the Tauri app, whether the `contextmenu` event was default-prevented, whether the vibration came from the app, landscape after S4-2c, the true end of a long list under the floating button, and a third Back.

**Accepted limitations and what is not verified.**
- The device reports, the F2 trace and the Note 9 figures are single-device, debug-build, synthetic-input measurements; the desktop passes were Edge against the Node server on best-case hardware, not the Tauri app, a Pi 3 or a mid-range phone.
- F2 is not fixed (CHORE-177). The sort and the open folders are remembered per device and are not in backups, by decision (`MC-274`).
- The quit toast and the edit-mode Back work only where the Android app asks the page what Back should do; phone-browser Back is CHORE-179; screens with their own back stack are CHORE-180; accepted limitation R5 (`s4-2b-change1-report.md`): where a history entry exists, a second Back may go back in history.
- The S4-2b Change 2 Gate 2 remediation was accepted on the coder's mutant outputs without a reviewer re-run; the post-S4-2c class-only hardening had a fresh review and targeted tests only, not a repeat of the full run.
- After a bulk trash, restoring puts characters at the end of the order outside any folder and an emptied folder is not recreated (existing restore behaviour, stated in the dialog).
- The non-English strings are the translator's (`MC-058`); the translator rated the Vietnamese and Spanish quit toast and the German quotation marks as medium confidence (`MC-278`).

**Carry-forward notes (not tickets).**
- S4-4 must restore source-gone cancellation during a real tile drag (`plan-s4-2b.md` Revision 4: the gate becomes "entered edit mode by this long press and no tile drag"), bring edge scroll back in the Grid only while dragging tiles (D8, the Orchestrator's plan for that stage), and check `entry.ref` rather than the placeholder ref given to tiles with no order ref (`stage4-2-report.md`).
- A Name-sort long press on a plain far-down tile was not device-checked (the chosen card was a closed-folder member); include it in the next Grid device pass.
- Optional cleanup, verified by reading the code at `e75b1249`: the `exitEdit` branch in `chooseSort` can no longer end edit mode from the UI, because the select that calls it is rendered only when not editing and `enterEdit` passes 'order'; and the test titled "the count bar shows the count, and Trash is disabled at zero" in `GridCatalog.edit.svelte.test.ts` (and the file's header comment) still say "count bar" although the count now sits in the Sort row.
- F4: an empty folder name with Show Folder Name on shows a blank tile in the Grid and, by reading `SidebarRail.svelte`, in the rail (minor, not ticketed).
- Planned keys not yet added: `othersUi.editGroup` and the screen-reader "Moved N items" key (`MC-277` 15). Update 2026-10-12: `othersUi.editGroup` was added in S4-3 (`c186bbd7`); the "Moved N items" key is still not added.

**Remaining work (item stays IN PROGRESS; as of 2026-10-11; S4-3 is done, see the section "Character list rework (2026-10-12): S4-3").** S4-3 (group the selection into a new folder; the planner's default allows one selected character), S4-4 (drag: hit test, moves, append to a folder, dwell merge onto a character, Alt+Left/Right, the "Moved N items" announcement; the plan names `opus-reviewer` for the stages that write `characterOrder`), S4-5 (folder-menu extraction and the Grid menu, its own commit touching the sidebar), S4-6 (arrow-key focus). Then windowing of the plugin, module and preset lists and the rest of the queue. Device checks owed: the next Grid pass (Name-sort long press; landscape after S4-2c).

**Records closeout for this section.** Drafted by `doc-writer` from the saved reports, `maintainer-answers.txt`, the usage files, `git show --stat` of the commits and the Orchestrator's brief (ledger row 1695). Independently verified by `doc-verifier` (row 1696, PASS WITH FIXES, fixes applied).

### Upstream merge `979dbc9d` and the logo PR #8 (2026-10-11)

**Status (2026-10-24, lane A records batch 10):** COMPLETE. Merge `1f455c0b` (regex lorebook keys; follow-up CHORE-178) and logo merge `5b0fa42b` are on `main` with their gates (Gate 2 `[APPROVE]` for both; record check `[EDITORIAL]`). Not a record: lane A suggests checking the logo font's provenance and Reserved Font Name in the CHORE-60 release-identity check; no record says it was checked or assigned.

Decisions: `MC-277` 18 to 21. Ledger rows 1668 to 1671 and 1678.

**Upstream merge `1f455c0b` (3 files, +265/-21; pushed).** Brings in upstream PR #1532 (`4fa72fb5`; the range `2a511a31..979dbc9d` has one non-merge commit and two upstream merge commits). The staged change is only the regex branch of `searchMatch` in `src/ts/process/lorebook.svelte.ts`: a flagged regex key such as `/dragon/i` was rewritten to `/dragon` and effectively never activated, and a flagless key was skipped; now each key is parsed as `/pattern/flags` with flags limited to `dgimsuvy`, and a key that cannot be parsed or is not a valid regular expression makes that key list not match. Fork-side test `src/ts/process/tests/lorebookRegexKeys.svelte.test.ts`: 10 tests driving the real `loadLoreBookV3Prompt`, 5 reproducers that fail on the pre-merge code and 5 compatibility guards (`upstream-1532-test-report.md`). Gate 2 `adversarial-reviewer` `[APPROVE]` (with the pre-merge source injected in memory, 5 fail and 5 pass). Full checks on the merged tree with the uncommitted S4-2 work present: `pnpm test` 667 of 668 files, 13,064 passed, 6 skipped, the 6 failures all `localeParity` for English keys awaiting translation; `pnpm check` 0 errors; build ok (`fullcheck-1532-*.txt`). The merge's own record is `Agents/Upstream-Merges.md`, committed with the merge and not rewritten here; its follow-up is CHORE-178. The record was drafted by `doc-writer` and checked by `doc-verifier` (`[EDITORIAL]`).

**Logo PR #8 (merge `5b0fa42b`, 4 files, +93/-3).** From the cloud session: `0ed32570` bundles the unmodified NanumSquare Neo Heavy woff2 (NAVER, SIL OFL 1.1) with its licence and a README credit and applies it to the home-screen title; `9babc1b1` adds the brand gradient to "Risu" and a Hangul Day variant (October 9, Korean UI: 리스타늄). Merged on the maintainer's "merge the logo PR once checks pass". Gate 2 `adversarial-reviewer` `[APPROVE]` by reading only (no build or test run by the reviewer); notes: no `forced-colors` fallback for the transparent gradient text, the holiday variants also pick up the new font (the PR body says they keep their own styling), no automated test for the October 9 / `ko` branch, and the 361 KB font is fetched when the home screen first renders. The commit message reports `pnpm check` 0 errors, a good build (font emitted to `dist/assets`) and `pnpm test` 664 files, 13,012 passed, 6 skipped on the PR tree; who ran them is not recorded, and whether the PR's CI checks were read before the merge is not recorded. TODO(evidence). Not verified: the font file's provenance (the reviewer reports the PR says it came from the npm package `typeface-nanum-square-neo@0.0.6` and was not byte-compared with NAVER's download) and whether the font declares a Reserved Font Name.

### Character list rework (2026-10-12): S4-3, group the Grid edit-mode selection into a new folder

**Status (2026-10-24, lane A records batch 10):** stage records COMPLETE. S4-3 is on `main` (`c186bbd7`) with its gates; its records were verified (ledger row 1720). The item's open work is the Character list rework row of the open-tickets table in the Roadmap.

Decisions: `MC-279`. Ledger rows 1697 to 1706, 1709, 1710 and 1713. Ticket: CHORE-181. Everything below is from the session scratch reports named in those rows (`charlist\`, with the answers record `charlist\records-s34\maintainer-answers.txt` and the usage figures in `charlist\usage.txt` and `charlist\records-s34\usage-session.txt`); "session scratch" paths are relative to `charlist\`. The device reports are the Note 9 agent's own and were not independently verified (no verifier row). The coder's report `stage4-3-report.md` contains two claims that the Gate 2 reviewer refuted (below); they are not repeated here.

**Plan and Gate 1.** `plan-s4-3.md` (`investigator`, base `d6717f66`) designs `groupIntoFolder` as a pure order operation beside `dropOnItem`, a release hook in `RailDrag`, a `groupPlan` seam, the Grid menu and an edit-row button, and put six product questions to the maintainer (Q1 to Q6, all answered "(Recommended)", `MC-279`). Gate 1 (`opus-reviewer`, `gate1-s4-3.md`) `[APPROVE WITH AMENDMENTS]`, B1 to B12 binding on the coder brief: B1 the operation moves every string member of a picked folder, hidden ones included (the plan's "visible, untrashed" gloss was wrong); B2 a folder plus one of its own members counts as a lone folder; B3 the menu choice is mapped through the action list built when the menu opened (otherwise a Group that became available meanwhile could run on a "Move to trash" tap); B4 a design for the Q4 scroll; B5 the planned mutant G4 (drop before insert) is equivalent for this operation (scratch experiment `g1s43-g4.mjs`: 200,000 random orders, `dropFirstDiffers` 0, `noShiftDiffers` 119,356, `multisetFailures` 0); B6 the Grid's `contextmenu` listener must be bubble phase; B7 right-click and the keyboard menu select an unselected tile first, as the hold does; B8 a hold on a selected tile keeps it selected; B9 the rewritten `GridCatalog.edit` test must not leak a pending prompt; B10 more Grid tests; B11 the condition of property P3; B12 the dissolved folder ids are removed from the open-folder list explicitly (the plan's "automatic prune" was overstated). Not verified at Gate 1: the Android timing of the native `contextmenu` against the release, the 360 dp row, and the exact Q1 option text (TODO(evidence)).

**S4-3 (`c186bbd7`, 17 files, +2,475/-32; `stage4-3-report.md`, `commit-s4-3.md`).** `groupIntoFolder` (`sidebarOrder.ts`, +99) resolves every ref on the input (any unresolved ref returns the input unchanged), builds one new closed folder with the default folder name at the slot of the first pick in list order (a folder member's slot is its folder's slot), moves the picks in list order, drops folders the move emptied, and inserts before dropping. `railDrag.ts` (+9) gains an optional `onTouchHold` host hook for a touch hold released in place on a non-folder source, called after the session ends; the sidebar defines no hook. `charListEdit.ts` gains `groupPlan` (decides what a Group acts on; drops a member pick whose own folder tile is picked; no Group for a lone folder) and `chooseRowForms`. `GridCatalog.svelte` gains the menu through `alertSelect` on the whole selection, a bubble-phase `contextmenu` listener sharing `openTileMenu`, the icon button (`h-8 w-8 shrink-0`, `FolderPlusIcon`, `aria-label` and `title` = `othersUi.editGroup`, disabled when there is nothing to group), one write path (a `characterOrder` assignment, then `checkCharOrder()`, the rail's pattern), the Q4 scroll guarded by a generation counter, and the row forms. One new key, `othersUi.editGroup` "Group into new folder", in `en.ts` and the six other locales (translator, parity 6 of 6). After a Group the selection clears and edit mode stays. *Count and row (from the device findings, `MC-279` 8 to 10):* the count shows only the number when the full "N selected" does not fit beside Group and a labelled "Move to trash"; if even the number does not fit, "Move to trash" becomes a trash icon (32 x 32, same accessible name, tooltip and confirmation); the choice comes from hidden measuring probes of the full text, the number and the label, and the shown forms are never measured, so it cannot loop; one polite live region always holds the full count text.

**Red, mutants and gates.** No test of the feature can fail by assertion on the base alone (new function, new export), so the evidence is mutation proof: in-memory mutants through `vitest.mutate3.config.ts` and `run-mutant3.ps1`, with the SHA-256 of each source file recorded before and after (identical; no mutant ever sat in a repo file). Operation mutants G1 to G18 were all killed except where the report says otherwise: G4 is equivalent (G4' replaces it) and G14 is the same defect as G7 (`mutants-s4-3-op.txt`). The Grid and rail mutants were killed except R5 (it survived the original tests and was killed only after Gate 2, below), in three cases after a first run survived and the tests were strengthened (GM6, B4a, GM4; `mutants-s4-3-ui.txt`, `-ui2.txt`); GM14, a defence-in-depth guard for a missing saved order, survives with no reachable failing case. Count mutants C1 to C7 (`mutants-s4-3-count.txt`) and row mutants R1 to R8 (`mutants-s4-3-row.txt`; these R names are distinct from the rail-hook mutant R5) were all killed. The `GridCatalog.edit` test that pinned "a hold does not select" was rewritten on purpose (B9). Gate 2 `opus-reviewer` `[EDITORIAL]` (`gate2-s4-3.md`): no defect in the code, the save path or the tests' logic; it re-ran 13 coder mutants (the Gate 2 report's own table itemises 11: nine killed, GM14 and R5 survived) and ran 17 of its own (12 killed; V12, V13 and V15 survived; V14 and V16 argued equivalent). Corrections to the coder's report: (E1) R5, "the hook also fires after a real drop", is NOT equivalent: a key scroll or an edge scroll re-evaluates the target with no finger travel, and the reviewer's scratch test (touch lift, `PageDown`, release at the press point) fails on the mutant; the product cannot show it today (the Grid resolver has no drop targets), and it becomes observable in S4-4; (E2) the lone-folder menu case is reachable (an open folder picked, then a menu on one of its own members gives [Move to trash, Cancel]); the code is right in both cases. The coder then added tests for E1, E2 and N1 (subsumption with duplicate folder ids) without product changes (`mutants-s4-3-g2fix.txt`: R5 killed by the new rail test, V12 by the new `charListEdit` test); no reviewer re-run of those tests is recorded. Non-blocking observations left open: N2 (the `!editing` check in `openTileMenu` has no test; V13 survives), N3 (`openTileMenu` toggles the selection before `menuOpen` is checked; judged unreachable in production because a covering prompt blocks both paths; reasoning, not executed), V15 (nothing pins `preventDefault` when keys are blocked). The count change (`gate2-s4-3-count.md`) and the row cascade (`gate2-s4-3-row.md`) each got a fresh `adversarial-reviewer` `[APPROVE]` by reading plus running the three Grid test files and `pnpm check`; non-blocking: no unit test at the icon form's full-text and number boundary (200 and 201 at the test's base widths) and the count wrapper carries both `flex-1` and `flex-none` (cosmetic); the count review's reasoned surviving mutant (`void countFull` dropped) is covered later by the coder's row test "(F) a changed count is measured again without a resize" (the coder's report, not re-run by a reviewer). Checks: after the first coder run `pnpm test` failed only `localeParity` for `editGroup` in the six locales (669 files passed, 1 failed; 13,192 tests passed, 6 failed, 6 skipped); on the final tree (`full-s4-3-row-test.txt`, `-check.txt`, `-build.txt`) `pnpm test` 670 files, 13,211 passed, 6 skipped; `pnpm check` 0 errors, 0 warnings; build exit 0 (confirmed by the Orchestrator, "build exit 0" in the task output; the saved file ends "built in 24.19s" with no exit line).

**Device (Note 9 SM-N960N, API 29, 411 x 773 CSS px, dpr 2.625, font scale 1.1, 875 live characters and 507 Grid entries; debug APKs built from `git archive d6717f66` plus the working-tree files; not independently verified).** `note9-s4-3.md` (before the count change), PASS: one menu on a 0.7 s and a 1.5 s hold with no native menu (one `contextmenu` event, no second menu); a hold on an unselected tile joining the selection; Cancel leaving the order unchanged (three times); Group through the menu of a member of an open folder, a top-level character and a closed 32-member folder (one closed "New Folder" at the member's folder slot holding 34 characters, 875 unique characters before and after, none missing or doubled); Group through the icon (the Grid scrolled from 1907 to 0 within 300 ms); the icon disabled with nothing selected and with a lone folder; a lone folder plus one of its own members offering [Move to trash, Cancel]; the new folder in the sidebar at the same slot with Rename working and the Grid showing the new name; persistence across a force-stop (the all-open tile list identical); the English row at 411 dp (32 px row, 32 x 32 Group button 8 dp from "Move to trash"); a Name-sort long press on a far-down tile (it switched to My order with the tile centred and selected, no click event); and "Move to trash" after a Group trashing only the selection (875 to 874, then restored from the Trash). FAIL: German at 411 dp (count cut to "1 aus...") and at an emulated 360 dp (count invisible). DEVIATION: with the menu open Back quit the app at once, with no toast, and the menu did not close (CHORE-181). `note9-s4-3b.md` (number only if cramped): English 411 dp PASS; German 411 dp shows the number ("1 ausgewählt" needs 91.3 px of a 59.8 px box); German emulated 360 dp with 1 selected shows "1" in a box of 8.35 px for a text 8.65 px wide; FAIL: at 360 dp a two-digit count read "1" while 14 were selected. `note9-s4-3c.md` (the row cascade), all 6 checks PASS: English unchanged; German 411 dp the number beside the labelled button; German emulated 360 dp (window override 945 x 1943) the trash icon with the full "N ausgewählt" unclipped for 0, 1, 14 and 111 selected; tapping the icon opened the same confirmation (cancelled, nothing changed); resizing back returned the labelled button with the selection kept; the live region held the full localized text in every case.

**Accepted limitations and what is not verified.**
- Group has no confirmation and no undo; the Gate 1 reviewer and the coder brief call this risk maintainer-accepted, but no maintainer message saying so is in the sources given (TODO(evidence)) (an ungroup in the sidebar restores membership only, not a dropped folder's name, colour and picture). The Group button is 32 dp and sits 8 dp from the destructive button (measured); no tap-error trial was run.
- Back with a prompt open quits the app (CHORE-181). No test drives Back with the real prompt open (the group suite's menu is a spy).
- The number-only form beside the icon (a count wider than about 200 px) was not reached on the device; the coder's arithmetic puts it at more than about five digits (inferred).
- 360 dp was emulated with a window-size override at the same pixel density, not a true 360 dp device; only English and German were measured; TalkBack was not run (DOM read only); font scales other than 1.1 were not run; the loop-holds-saving branch of `checkCharOrder` is not covered after a Group (the result needs no prune).
- The device passes did not cover Group with search active, Group under Recent or Name (the menu is My order only by code), a folder tile's own menu, or a second Back after the menu Back. The Gate 2 reviewers ran no browser or device render; the count and row layouts are reasoned from markup and stubbed widths.

**Carry-forward notes (not tickets).**
- The device test fixture's order was only partly restored after the S4-3 pass: the rebuilt "Folder 03 (32)" has a new folder id (`5bb2874c...` instead of `cce6d877...`) and stands at Grid slot 14 instead of 30, and Card 0161 is at slot 2 instead of 226. Every position between them shifted, so later passes see a changed fixture, and any check that depends on those ids or slots needs the new values.
- After a Group the sidebar rail shows entries the Grid hides: the fixture holds duplicate occurrences (an id listed twice, or in two folders; inferred to pre-exist, from `note9-3b.md` and one first-pass screenshot, because the rail was not scanned before). Group moves one occurrence and the other stays (no loss measured). Fixture duplicates pre-date the pass; not a design item (no recovery for corrupted fork-local state, AGENTS.md).
- R5 (Gate 2 E1): a key scroll can carry a lifted tile onto a drop target without finger travel; covered by a rail test, and relevant again in S4-4.
- S4-4 must restore source-gone cancellation during a real tile drag and bring Grid edge scroll back only while dragging tiles (the notes in the S4-2 section stay).
- Optional cleanup: the boundary test at the icon form, the duplicated class on the count wrapper, and N2, N3 and V15 above, besides the optional items in the S4-2 section.
- Renaming the new folder works only in the sidebar until S4-5 (Q3). The Name-sort long press that the S4-2 notes listed as unchecked was checked in this pass (check 9, PASS).

**Remaining work (item stays IN PROGRESS).** S4-4 (drag: hit test, moves, append to a folder, dwell merge onto a character, Alt+Left/Right, the "Moved N items" announcement; `groupIntoFolder` is the base of the dwell merge, and extending it with a placement argument must re-run the property tests and the G mutants), S4-5 (folder-menu extraction and the Grid menu, its own commit touching the sidebar), S4-6 (arrow-key focus). Then windowing of the plugin, module and preset lists and the rest of the queue. Device checks owed: the next Grid pass on the changed fixture, and landscape after S4-2c (only the count switch was seen in landscape, `note9-s4-3b.md` check 4).

**Records closeout for this section.** Drafted by `doc-writer` from the saved reports, `maintainer-answers.txt`, the usage files, `git show --stat c186bbd7` and the Orchestrator's brief (ledger row 1719). Independently verified by `doc-verifier` (row 1720, PASS WITH FIXES, fixes applied).

### Stage 4b, store2 import and export close (2026-10-20): commits, gates, checks, devices, carries

**Status (2026-10-24, lane A records batch 10):** COMPLETE. Merged as `ea49d579d` (`MC-325`); the D10 and merge records were verified in ledger row 2073 (ACCEPT WITH FIXES, fixes applied). The "stays inline" decision was reversed by `b781b1f35` (`MC-334` 1, `MC-333` 3); the L4 leg was replaced by the U5 round trip against upstream `61d0eb79a` (ledger rows 2091 and 2093). This line does not resolve the section's "Notes, not tickets" or its device limits (D5 A2 not run, D8 partly evidenced, store key totals growing slightly per boot (untraced), the CHORE-74 / `MC-176` warning text possibly stale (unverified)).

**State (2026-10-21): merged into `main` as `ea49d579d` and pushed (`MC-325`); COMPLETE once these records are verified.** D10 ran on 2026-10-20 and 2026-10-21 (ledger rows 2069 to 2071), and the merge is row 2072. Next: the upstream compatibility work, then `MC-323`. Earlier state (2026-10-20): technically accepted on the unmerged branch; the A4 round trip and the merge decision were owed.

**D10, A4 upstream round trip (`s4b\d10\d10-results.md`, verified with fixes; synthetic fixtures, one i9 PC, single runs):** upstream at `979dbc9d` (the last upstream commit merged into the fork) in `C:\Projects\RisuAI-upstream`; fork `19afc6829`. An upstream-written `.bin` with all four pointer kinds goes into the fork, out (inline, and stub form from a scratch build), and back into upstream with every character, chat, message, plugin key and asset present; the only difference is `isStreaming: false`, which the fork never stores and upstream resets on load. The fork's "chat 3: missing" import notice is expected (that upstream-written input lacks the unit). The 101 MiB Node restore skips the asset after a named warning and a confirmation, as decided in `MC-318` 10; the literal "skips nothing" check is deferred to the chunked-upload item. The 99 MiB control restores byte-identical. Stub form: upstream imports the unloaded (B) export without dialogs and every chat and message is present when decoded; the loaded (A) export was not re-imported and one character's open check is inconclusive, so `EXPORT_UNLOADED_CHARACTERS` stays `'inline'` until the maintainer decides. Not run: L4 against upstream `e773240bf` (informative). Open: a "reading 'map'" error when opening some test characters also appears in upstream-only runs; likely the hand-built fixture's shape (no `triggerscript`, `personas` empty), uncertain, not a fork defect. The fork filled a placeholder chat from a unit present in the hand-built golden (adds data, loses none).

**Commits on `feat/alite-s4`, in order:** `775602a2b` S1; `ea7669b96` S2a (boot import skip notices, one boot notice across the service-worker reload; `MC-322` 5); `1b27483f6` S2b (import, restore and export shells return their end and facts); `c25482c16` S3 (inlay round-trip compatibility guard on store2 pages); `96b9d10f1` CHORE-110 (deterministic gzip header in `.bin` exports); `19afc6829` S4 (release the import's decoded tree and msgpackr's retained buffers). S4 has a latent coupling: the release relies on the Buffer polyfill loading before msgpackr, and a change of load order fails loudly.

**Gates (ledger rows 1975 to 2000 and 2040 to 2062):** Gate 1 plan `[REJECT]`, then `[APPROVE WITH CONDITIONS]`. S1 Gate 2 `[APPROVE WITH CONDITIONS]`, then `[APPROVE]` after one targeted round. S2a Gate 2 `[APPROVE WITH CONDITIONS]`, then `[APPROVE]`. S2b Gate 2 `[REJECT]`, `[REJECT]`, `[APPROVE]` (three rounds). S3 `[APPROVE]`. CHORE-110 `[APPROVE]`. S4 Gate 1 `[APPROVE WITH AMENDMENTS]`; S4 Gate 2 `[REJECT]` (`packr.useBuffer(Uint8Array)` broke `composedRoundTrip` 8 of 15 under Node), then `[EDITORIAL]` after the round 2 re-review (ED1, ED2 applied).

**Checks (the final snapshot `19afc6829`; the figures are from the check logs as recorded):** `checks-bef339121`: 19,596 passed. `checks-c25482c16`: 19,708 passed. `checks-96b9d10f1`: 19,711 passed, 23 skipped; check, build and release-dist PASS. `checks-19afc6829`: `pnpm test` had 1 failure, `Chat.draftCaptureScenarios` "success-then-fail", under APK-build load (passed 3 of 3 alone), now CHORE-185. `checks-19afc6829-r2` on a quiet PC: 19,724 passed, 23 skipped, 0 failed; check, build and release-dist PASS. Replay and live 429 re-run at `96b9d10f1` (orchestrator, 2026-10-20): 3 files, 40 passed, 0 skipped.
**Devices (one Note 9, SM-N960N, Android 10, WebView 154, single runs unless stated; each verified by `doc-verifier` with the corrections listed):**
- D1: PASS. Step 3 partial: the natural race was not timed; injected stale writes were refused.
- D2 to D4: PASS with corrections (`d2d4-acceptance.md`). Probe gap: the dev servers were not shipped. D4 found the `botPresets` lenient-convert crash (`MC-322` 6; CHORE-183). D2's double boot notice was fixed in S2a.
- D7: PASS. The CHORE-110 cause is the gzip MTIME.
- D5 and D8 (device build `c25482c16`, before the CHORE-110 fix): D8 PASS, partly evidenced (screenshots; no focus log). D5 1,000-entry fixture: cold start median 6.65 s against 13.40 s baseline. A2 NOT-RUN (no API key). A1 shape only; the meter JSON was not saved. Baseline is the main frontend on the `c25482c16` Rust shell. The old fixture `m-10k-real.bin` is defective (no globalLore). The verifier withdrew the VmHWM and app-memory claims.
- D5 re-run and post-fix export (the build with the S4 fix, `19afc6829`, on the device; single run): CHORE-110 closed on a small (5-character) profile, one device; two exports are identical (SHA-256 `875D4B5A...`, gzip MTIME 0; verified from the files). Import 637.5 s on the 1,000-entry file; plateau about 0.65 to 0.72 GB total; peak 1.07 GB in the commit; renderer fresh. Comparison figures for the import (new build about 1.4 to 1.49 GB sustained; baseline about 0.4 GB, spiking to about 1.1 GB at the finish) are the d5d8 verifier's recomputation from the raw samples `new-fix-import` and `base-fix-import`, not text in `d5d8-results.md`. The single run cannot separate the S4 fix from the fresh renderer; the baseline was not re-run. The cited lmkd line (18:34) is outside the import.
- D11a: PASS. The real upstream partial backup (345,832,259 B; 500 characters, 771 chats, 164 modules, 14 plugins, 2 presets, 68 personas, 517 assets) round-trips identically on the PC; heap peak 252 MiB. Four broken images are keys absent from the partial `.bin` and referenced in `characters[].additionalAssets` or `emotionImages`: expected (`asset-failures.md`). Corrections: export about 23 s click-to-begin; the 5,228 key count is unsupported; "Success" shows before the download completes.
- D11b: PASS. F1 90 MB (1,200 characters, 150 modules, 99.6k messages): import 38.6 s, heap 181 MiB. F2 3 GiB (40k assets): import 141.1 s, heap 83 MiB. Both round-trip identically on the PC. Store2 import resolves cold-storage pointers, so exports carry chats inline; export size grows, and fork to upstream loses the cold-storage savings (MC-175 holds).

**D11 split and tiered data (`MC-324` 1 and 2):** real shapes come from the maintainer's upstream partial backup; scale comes from synthetic fixtures on the PC; a full 32 GiB real import is not required. Large data runs stay on the PC unless the check is Android-specific or a pre-release run.

**Memory (S4):** the reachable-set checks pass for the legacy and block formats; PC 1k renderer working set (MiB, headless Chrome, i9 best-case hardware, synthetic fixture, single run each): peak 1217 to 1004; commit-window median 894 to 709. The asset-window slope target was missed and is reported only. Raw `databaseBytes` is still held (deferred option C).

**Upstream `e773240bf` (separate item; LANDED on `main` as `2862940fe` on 2026-10-21, merged up to upstream `61d0eb79a`, pushed; `MC-331`; details and per-stage gates in `Upstream-Merges.md`, ledger rows 2074 to 2094; CHORE-186 fixed, residuals CHORE-187 to CHORE-193; the paragraph below is the pre-implementation plan):** the triage (`upstream-e773240\triage.md`, verified with corrections) names a 37-file conflict set; the plugin storage index layout is live upstream since `68b5d032c` (2026-10-13). The maintainer's answers are `MC-324` items 1 to 11 (plugin storage reads both layouts; SaveKV passes through verbatim; onboarding data only; the welcome redesign is skipped; Node write errors are taken, adapted). Compatibility inputs for Gate 1: `sizing-compat.md` (verified 8 of 8), `advisor-g1g2.md` (`senior-advisor` challenge), `exp\exp-results.md` (verified with corrections), `savekv-intent.md`. Order after the `feat/alite-s4` merge: G6, then G3, then G2 (S1 to S3), then G1, as one merge. E5 is the pre-release blocker CHORE-186.

**Notes, not tickets:** fixture-shape crashes (a character without `globalLore` throws on open; `personas []` throws on chat open; a missing `didFirstSetup` shows the first-run wizard). No notice appears after a partial import that about 156k referenced additional assets are missing (for the backup-screen rework, N12). Store key totals grow slightly per boot (untraced). The CHORE-74 and `MC-176` warning text may be stale against upstream `e773240bf` (unverified). The S4 latent coupling to the Buffer polyfill load order.

### Session 2026-10-21 (resume): plugin-index change, stub-export flip, device scripts

**Status (2026-10-24, lane A records batch 10):** COMPLETE. The plugin-index change (`4a4ddf050`) and the stub-export flip (`b781b1f35`) are on `main`; the device-check scripts are tracked after their final Gate 2 (`[APPROVE WITH AMENDMENTS]`, non-blocking, ledger row 2114). The Note 9 export figure is held under CHORE-223; this line does not assert it is the figure batched here. The unexercised upstream mobile trash list moves to the Runtime unload residuals below; the D10 "reading 'map'" error is probably the CHORE-224 `globalLore` case (inferred, not run).

State at `b781b1f35` on `main`, pushed. Decisions: `MC-333` and `MC-334`. Evidence is session scratch (`%TEMP%\risu-b715\`), outside the repository.

**Plugin index (`4a4ddf050`, `MC-333` 1, scope corrected in `MC-334` 3 to A4 and A5):** an index that only a numbered backup or retained snapshot points at, and whose read reports it absent, contributes only its own key, so old-data deletion and manual cleanup can run. Unreadable or damaged reads, the main file, committed blocks, older confirmed copies and live data still stop. Gates: Gate 1 `opus-reviewer` `[APPROVE WITH AMENDMENTS]`; Gate 2 `opus-reviewer` `[EDITORIAL]` (two wording fixes applied). Seven reproducers fail on the pre-change base; mutants killed except one shown equivalent. Checks on that tree (commit message): `pnpm test` 20127 passed, 23 skipped; `pnpm check` 0/0; build and `checkReleaseDist` pass.

**Stub-export flip (`b781b1f35`, `MC-326` 7, `MC-334` 1, 4 and 5):** `EXPORT_UNLOADED_CHARACTERS` is `'stub'`. Trashed characters and characters whose chats name a cold-storage root stay inline (the root guard is a technical fail-safe, `MC-334` notes). Gates: Gate 1 `opus-reviewer` `[REJECT]`, then `[APPROVE]` with seven amendments; Gate 2 `opus-reviewer` `[REJECT]` (one owed legacy-page import guard), then `[EDITORIAL]`. Checks (commit message): `pnpm test` 20187 passed, 23 skipped; `pnpm check` 0/0; build and `checkReleaseDist` pass.
- **S2 upstream compatibility leg (`s2\results.md` plus `s2\verify.md`, PASS WITH FIXES, corrections applied; synthetic fixture of 4 characters, one i9 PC, headless Chrome, single run):** upstream `61d0eb79a` imports and opens a stub-form export without dialogs or error text and re-exports it; the fork re-imports both files. 4 characters, 4 chats and 4 messages in every file; the trashed character stays trashed. Not covered: the trashed character was not opened in upstream, the upstream mobile trash list was not exercised, the group had one whole and one stub member, and page-stub evidence is a heap query (INFERRED).
- **PC measurement (`pc\results.md` plus `pc\verify.md`, PASS WITH FIXES; i9-13900KF best-case hardware, headless Chrome, static IndexedDB web build, synthetic 500-character fixture, n=3 per form, medians; n=1 for the 5% trashed variant):** peak JS heap during export 202 -> 145 MiB (the rise above the pre-click level 84 -> 9 MiB, on different bases, and 500 ms sampling makes peaks lower bounds); click-to-saved 16.0 -> 13.5 s (includes about 1 s script latency; n=3, one machine; the first inline run was slow and unexplained); file 43,081,603 -> 93,853,848 bytes (2.18 times); database entry 30.6 -> 10.4 MB; 500 uncompressed unit entries. Whole-browser memory shows no separable difference. No phone or frame-budget claim. The file-size growth goes on the list for the faster or native export work (`MC-326` 6, `MC-334` 5).
- **Open:** the Note 9 export figure, batched for the next device session (`MC-334` 1); the upstream mobile trash list, not exercised; the D10 "reading 'map'" error, not reproduced on the S2 fixture in either form, cause unknown; CHORE-194 (filed this pass).

**Device-check scripts (`MC-330` 7, `MC-333` 4):** Stage 1 is accepted: Gate 2 round 1 `[REJECT]` (cleanup-safety defects in the process tracker), round 2 `[APPROVE]` (`devscripts\g2\`, `g2r2\`). The scripts are untracked under `Agents/Tools/device/` and stay uncommitted until Stage 5. Stages 2 to 5 remain.

## Moved 2026-10-25 (lane A records batch 11)

Batch T entries moved unchanged from `Agents/Roadmap.md` at `d9c68b0fe` by lane A records batch 11 (`MC-502`), each with one dated COMPLETE status line added at the top. The commits are `a51321952` (T1), `9d16b3350` (T2) and `d9c68b0fe` (T3); the ledger rows are 2270 to 2275. Full checks on `d9c68b0fe` (ledger row 2273): `pnpm test` 3 failed, 22,064 passed, 23 skipped (`Chat.supaResume` (c) and (d) and `formatHexStemFast` "200 000 seeded random stems"; lane A reran the two files alone, 35/35 passed; the `formatHexStemFast` timeout is treated as a load flake, while (d) failed an assertion, "expected 3 to be 5", whose cause is INFERRED: CHORE-209, ledger row 2276); `pnpm check` 0 errors and 0 warnings; `pnpm build` and `checkReleaseDist` OK; `cargo test --lib` 216 passed. Device evidence is stage D on phone 2 (a release build of `d9c68b0fe`, the synthetic device profile and a local mock endpoint; ledger row 2274), MEASURED in that report and spot-checked by the batch 11 doc-verifier: APK sha256s, the 8 mock-log sends, the T-a and T-c TCP poll timings, the network counts, one T-b screenshot, lane B result figures; not re-derived: the T-b 155 ms figure (no retained raw log, a sampler first-seen time) and lane B's raw CSVs. A reopened ticket moves back to the Roadmap with a dated status line.

### CHORE-149 — `streamed_fetch` in `src-tauri/src/lib.rs` uses `.unwrap()` where a failure can panic the task

**Status (2026-10-25, lane A records batch 11):** COMPLETE (`MC-502`). Commit `a51321952` (batch T stage T1); Gate 2 `adversarial-reviewer` `[APPROVE]` (ledger row 2270). `streamed_fetch` now lives in `src-tauri/src/streamed_fetch.rs` with no `unwrap` or `expect` outside tests: a bad base64 body or header returns an error result and a failed emit returns a failure result. Evidence: 14 Rust tests (`cargo test --lib streamed_fetch`, reviewer reran: 14 passed) and 9 scratch mutants (coder's results, not re-run by the reviewer). Full checks on `d9c68b0fe`: `cargo test --lib` 216 passed; the other checks are in the section note above. Device: stage D on phone 2 ran the streamed path with the new Rust code (T-a to T-c, MEASURED); it did not exercise an invalid body or a failed emit, and a panic's survival is not testable in a unit test. Residuals: a stale tombstone after a page reload within 10 s (per plan); an Android target build of the T1 tree alone and a real tauri `emit` outside the device run were not run by the coder or the reviewer; "Request timed out" has no language key (CHORE-208).

**Status (2026-10-24, lane A records batch 10):** open; in batch T, run by lane A (`MC-502`).

**Status (2026-10-09): open; observed in source, panic behaviour not run.** Type: bug, latent, Tauri (all platforms).

- **First noted by** the keep-alive investigator (`keepalive\packet.md`, not independently verified); **re-read by this entry's writer in the working tree at `6f9c0b98`:** `streamed_fetch` (`lib.rs:706-837`) decodes the request body with `general_purpose::STANDARD.decode(...).unwrap()` for POST, PUT and DELETE (`lib.rs:743`, `759`, `769`), so an invalid base64 body panics; and it calls `app.emit(...).unwrap()` for the headers event (`lib.rs:800`) and the end event (`lib.rs:832`), so a failed emit (for example after the webview is gone) panics. The chunk emit in the loop returns an error string instead (`lib.rs:818-823`), and `chunk.unwrap()` at `lib.rs:808` follows an `is_none()` check.
- **Not established:** whether a panic in the async command kills the app or only that command, and whether Activity destruction on Android reaches the emit paths. TODO(evidence): a reproduction.

### CHORE-164 — Stop ends the reply on screen but does not close the native `streamed_fetch` request on Tauri; the provider keeps generating

**Status (2026-10-25, lane A records batch 11):** COMPLETE (`MC-502`). A native `cancel_streamed_fetch` command (T1, `a51321952`) and a Stop listener in `fetchNative` that sends it once (T2, `9d16b3350`); Gate 2 `adversarial-reviewer` `[APPROVE]` for each (ledger rows 2270 and 2271). T2 also made a pre-headers timeout send one cancel and throw "Request timed out". Full checks on `d9c68b0fe`: see the section note above. Device (stage D, phone 2, release `d9c68b0fe`, MEASURED, ledger row 2274): T-a, a Stop mid-stream: the mock's connection was gone within 0.64 s of the tap (poll resolution about 0.42 s), the partial text stayed and no dialog showed; T-c, a Stop before the first byte: no dialog and the connection closed within about 0.54 s. The mock does not log chunk writes, so "stopped writing" is inferred from the connection closing. Residuals: T-d, the timeout, was not device-checked because the setting is not exposed in the UI (a source grep only; the Settings pages were not all walked); "Request timed out" is hard-coded English with no `language` key (CHORE-208).

**Status (2026-10-24, lane A records batch 10):** open; in batch T, run by lane A (`MC-502`).

**Status (2026-10-10): open; ticketed on the maintainer's answer "Ticket it, fix later" (`MC-261` 2); not planned.** Type: defect (resource use and provider cost), Tauri; found during keep-alive.

- **Observed (Stage 3 device pass, `keepalive\device\report.md` finding 1; Note 9 API 29 and the API 35 emulator):** after the notification Stop or the in-app Stop, the mock server's requests ran to the full chunk count (mock REQ#5 and #6 on the Note 9, #34 to #36 on the emulator); requests stopped before the first byte still got their first byte 60 s later and streamed; the mock logged `ABORT (client closed)` only when the process died. The visible behaviour is correct (the text stops and the notification leaves). Observed again after Stage 3b (`keepalive\device3b\report.md` finding 2; the Orchestrator's spot-check: stopped requests logged `END` with full chunk counts and no `ABORT`).
- **Pre-existing or not:** from source reading, pre-existing: the pump of an aborted Tauri stream keeps reading until Rust ends (`plan-v3.md`; `gate2-s12.md` nit: "aborted Tauri request is not cancelled on the Rust side (pre-existing, plan-accepted)"). Not proven on a device: no base APK was run (`device\report.md` finding 1). The Rust request has a total timeout, default 240 s, so the `invoke` settles by then at the latest (`gate1-adv-r2.md`, read in source there); the mock runs observed above were shorter than that.
- **Scope in the maintainer's answer (`MC-261` 2):** a native request cancel for `streamed_fetch` on Tauri, desktop too; the device evidence is Android only. No fix beyond that is proposed here.

### CHORE-165 — A `streamed_fetch` that fails after the body was handed over closes the stream normally, so an error-truncated reply looks complete

**Status (2026-10-25, lane A records batch 11):** COMPLETE (`MC-502`). A failure after the headers (an `error` event, `success:false` or an invoke rejection) now errors the stream after the partial text instead of closing it normally (T1 `a51321952` for the Rust `error` event, T2 `9d16b3350` for the JS; Gate 2 `adversarial-reviewer` `[APPROVE]` for each, ledger rows 2270 and 2271). This reverses `MC-260` 8 for the native path (`MC-502`): the existing test in `globalApi.inFlight.svelte.test.ts` that asserted the old close was changed on purpose (rename, read 'partial', then reject 'reset'). Full checks on `d9c68b0fe`: see the section note above. Device (stage D, phone 2, MEASURED, ledger row 2274): T-b, the mock killed mid-reply: exactly one error dialog, first seen 155 ms after the kill (sampler output not retained), whose text has no URL; the partial text stayed and the app stayed responsive. Lane A traced the non-200 `textifyReadableStream` path that Gate 2 left untraced: every call is awaited inside the request functions, and the Anthropic one is inside the loop A2 fixed, so a late failure there is one request error (lane A source reading, not executed, not independently reviewed). Gate 2 non-blocking notes: the fetch-log response is `''` after a pre-headers failure; unread tail chunks are dropped on an error. Not examined: whether the stored `interrupted` note appears after such an error (the entry's own inference below was not tested). Residuals: "Request timed out" is hard-coded English with no `language` key (CHORE-208); the T-d timeout was not device-checked (setting not exposed).

**Status (2026-10-24, lane A records batch 10):** open; in batch T, run by lane A (`MC-502`).

**Status (2026-10-10): open; not reproduced on a device; not planned.** Type: suspected defect (silent truncation), Tauri; found during keep-alive.

- **Observed (source reading, not executed):** when `invoke('streamed_fetch')` resolves with `success:false` (or its result fails to parse) after the response headers and some body were delivered, `fetchNative`'s stream closes without an error, as it did before the keep-alive work; the reader sees a normal end, so a reply cut short by the failure is shown as complete. Sources: `keepalive\plan-v3.md` ("Out of scope, recorded as a candidate ticket"), `keepalive\plan-3b.md` and `keepalive\gate1-3b.md` (Part 2, A item 5: "after headers the stream closes without erroring (today's behaviour)").
- **Pre-existing:** yes, per those sources (Stage 3b kept this behaviour on purpose: "success:false and parse-error after headers end the stream as today (close)", `plan-3b.md`).
- **Relation to keep-alive:** the stored `interrupted` flag (`MC-260` 7 and 8) is cleared by any end the page saw, including this close, so such a reply is expected to carry no note (an inference from the rule, not tested; `MC-260` 8 chose "Only if the page died", and "Also on errors, best effort" was the unchosen alternative).
- **Not established:** how often Rust reports `success:false` after the headers in practice. TODO(evidence).

### CHORE-167 — A reply aborted while the app is hidden shows no "aborted" dialog on return, while a foreground abort shows "Error: aborted"

**Status (2026-10-25, lane A records batch 11):** COMPLETE (`MC-502`) for the Stop-before-the-first-byte case. Commit `d9c68b0fe` (batch T stage T3): in `requestChatData`, a throw while the caller's abort signal is aborted returns the silent `Aborted` result, as a later Stop does; otherwise it rethrows. Gate 2 `adversarial-reviewer` `[APPROVE]` (ledger row 2272): 18 call sites, 4 pass a signal, all four end silent. The new test mocks the provider layer, so it is mocked evidence only. Full checks on `d9c68b0fe`: see the section note above. Device (stage D, phone 2, MEASURED, ledger row 2274): T-c, a Stop before the first byte: no dialog; T-a, a Stop mid-stream: no dialog. Residuals: the hidden-app case this entry was filed for was not run in stage D (TODO(evidence)); the entry's own question, whether the foreground dialog is intended feedback, was not settled by this batch; T-d, the timeout, was not device-checked (setting not exposed); "Request timed out" is hard-coded English with no `language` key (CHORE-208).

**Status (2026-10-24, lane A records batch 10):** open; in batch T, run by lane A (`MC-502`).

**Status (2026-10-10): open; observation; not diagnosed.** Type: observation (inconsistent feedback), Android; found during keep-alive.

- **Observed:** Stage 3 device pass, `keepalive\device\report.md` finding 4: a reply aborted while hidden shows no "aborted" dialog on resume, while a foreground abort shows "Error: aborted". Stage 3b re-check, `keepalive\device3b\report.md` finding 3: a foreground in-app Stop shows the "Error: aborted" dialog (emulator, 10 sends in a loop), which it says matches the Stage 3 finding. That second report does not test the hidden case.
- **Not established:** whether the dialog is the intended feedback for a user Stop in the foreground at all, and why the hidden case differs. TODO(evidence).

## Moved 2026-10-25 (lane A records batch 13)

Entries moved unchanged from `Agents/Roadmap.md` at `31b050a63` by lane A records batch 13, each with dated status lines added at the top. CHORE-29, 31, 32, 55 and 61 are closed by the maintainer's answers in `MC-546` (lane G's closure audit of batch 2, a records-only audit; folded in from lane G's records, merge `efcf63634`). CHORE-183 and CHORE-209 are COMPLETE (lane G batch 2: `8c1abc67a` and `1fb45bf9a`, merged in `efcf63634`; `MC-544`, `MC-545`, `MC-547`). CHORE-185 and CHORE-240 are COMPLETE (lane C batch Q: `ab52cb8` and `413f600`, merged in `4fb1e3cbb`; `MC-438`). Full checks on the merged snapshots are in ledger rows 2285 (lane C merge plus Back stage A: `pnpm test` run 1 had 2 `manualCleanup` timeouts and run 2 was green at 22,155 passed; `pnpm check`, `pnpm build` and the dist check OK) and 2288 (lane G batch 2 and lane B merges plus Back stage B: `pnpm test` run 1 green at 22,330 passed; run 2 had one failure, `saveLoopNetBackstop` B7, a lane B CHORE-205 test that passed alone 3 of 3; `pnpm check`, `pnpm build` and the dist check OK). A reopened ticket moves back to the Roadmap with a dated status line.

### CHORE-29 — Filling a missing `chaId` brings back a stale copy of the character

**Status (2026-10-25, lane A records batch 13): COMPLETE (closed as moot, `MC-546` 1).** Records-only closure from lane G's batch 2 (folded in from lane G's records, merge `efcf63634`). Evidence: the audit packet and its independent check by `opus-reviewer`, which rejected the packet's wording for CHORE-29, 32 and 70; the maintainer's questions were written from the corrected verdict (`MC-546`). Lane G's closing lines:
- In store2 the manifest is rebuilt from the live list on each pass (`scoped.ts`), and ids are minted (`split.ts`), so nothing brings back a stale copy.
- Scratch tests S3 and S4 (`%TEMP%\risu-lane-g\audit\review\`, real store2 save loop on a memory backend) reload exactly the live list after filling an empty `chaId` and after replacing a slot five times.
- Unused units are cleaned up automatically, once per launch, on Tauri only (`67273e799`, `autoGc.ts`); on web and Node they stay on disk.
- An upstream `.bin` that already holds a stale character block imports it, as upstream does; that is not a fork defect.

**Status (2026-10-24, lane A records batch 10):** Per the lane E audit (source reading, doc-verifier-checked with corrections, not run): SUPERSEDED on store2 (the fill code remains, the harm is gone: shard entries are rebuilt from the live list and ids are minted); not run through a reload. Candidate to close; closing is the maintainer's (`MC-479`).

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

### CHORE-31 — Cold storage may turn an idle group into a plain character

**Status (2026-10-25, lane A records batch 13): COMPLETE (closed as moot, `MC-546` 1).** Records-only closure from lane G's batch 2 (folded in from lane G's records, merge `efcf63634`; evidence as for CHORE-29). Lane G's closing lines:
- `33545c2c6` (2026-10-01, the 10-day archiving stopped) deleted `makeColdDataForCharacter`.
- `buildColdStub` (`coldCharacter.ts`) and `stubFromEntry` (`stub.ts`) keep the group type and members.
- On conversion and import, `resolveLegacyTree` (`resolve.ts`) brings back the unit's real group.

**Status (2026-10-24, lane A records batch 10):** Per the lane E audit (source reading, doc-verifier-checked with corrections, not run): SUPERSEDED. `buildColdStub` and `stubFromEntry` keep the group type, and the archive engine is blocked on store2. Candidate to close; closing is the maintainer's (`MC-479`).

**Status (2026-09-24):** found in passing by the W0 investigation (ledger row 164). **Untraced for
impact.** Upstream has the same placeholder literal.

- `makeColdDataForCharacter` does not skip groups, and its placeholder hard-codes
  `type: 'character'` with no member list. A group idle long enough goes cold.
- It is unknown whether anything reads `type` or the member list on a cold, unopened group before
  `changeChar` restores it. That is the question to answer first.

### CHORE-32 — A swap can drop a character's pending edit for one save

**Status (2026-10-25, lane A records batch 13): COMPLETE (closed as moot, `MC-546` 1).** Records-only closure from lane G's batch 2 (folded in from lane G's records, merge `efcf63634`; evidence as for CHORE-29). Lane G's closing lines:
- In store2, the pass that drops the absent character's mark (`saveLoop.ts`, `marksOf`) also saves without that character. When it returns it counts as unheld and is saved at the next idle-net check, about every 2 s (scratch test S1; control S2).
- A narrow window remains in `planOf`'s stub-load retry, where only the 30 s backstop catches the edit (traced, not run; existing test B3 covers the backstop).
- That window is a short not-yet-saved delay (CHORE-153 class), not a permanent drop.
- No repository test covers the absent-character case; the scratch tests are diagnostics.

**Status (2026-10-24, lane A records batch 10):** Per the lane E audit (source reading, doc-verifier-checked with corrections, not run): SUPERSEDED. The only caller is inside the legacy loop. The audit's clause that the edit is "re-encoded via `unheldChaIds`" is INFERRED, but the audit's doc-verifier correction 5 found `unheldChaIds` is live store2 code (benign). Candidate to close; closing is the maintainer's (`MC-479`).

**Status (2026-09-24):** found by the W0 follow-up checks (ledger row 169, check 2). Traced, not
run. Narrow.

- `prepareSaveIteration`'s no-reload branch drops save marks for `chaId`s that are absent from
  `characters` and does not re-fold them, although the reload branch does.
- If a character already had a pending edit when a plugin swap briefly removed it from the array,
  that edit misses that save. It is saved with the next mark.

### CHORE-55 — Tauri main-file writes are not atomic (a failed write can leave a partial `database/database.bin`)

**Status (2026-10-25, lane A records batch 13): COMPLETE (closed as fixed, `MC-546` 2).** Records-only closure from lane G's batch 2 (folded in from lane G's records, merge `efcf63634`; evidence as for CHORE-29). Lane G's closing lines:
- `d0decfb61` and the store contract write every Tauri store file through a temp file, a rename and a sync (`tauriAtomicWrite.ts`, `tauriFilesStore.ts`, `durable_write.rs`, `chunked_io.rs`).
- The remaining stages are CHORE-392.

**Status (2026-10-24, lane A records batch 10):** Per the lane E audit (source reading, doc-verifier-checked with corrections, not run): SUPERSEDED. Store2 Tauri writes use a temp file, `sync_all`, rename and a directory sync, and no legacy main file is written on a store2 page.

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

### CHORE-61 — The save encoder silently loses presets, modules or a character when a character's `chaId` equals a fixed block name, and cannot write a `chaId` over 255 bytes (observed at encoder level only)

**Status (2026-10-25, lane A records batch 13): COMPLETE (closed as fixed, `MC-546` 3).** Records-only closure from lane G's batch 2 (folded in from lane G's records, merge `efcf63634`; evidence as for CHORE-29). Lane G's closing lines:
- `0d4efeb12` (2026-10-08, CHORE-117) added the reserved-name and 255-byte checks (`characterIds.ts`, `risuSave.ts`) and a prototype-free block map.
- `exportCopyOf` re-ids reserved, over-long and missing ids before `writeRisuSaveV0` names character blocks by `chaId`.
- The remaining `kv:` edge is CHORE-393.

**Status (2026-10-24, lane A records batch 10):** Per the lane E audit (source reading, doc-verifier-checked with corrections, not run): SUPERSEDED, and lane A's premise is refuted: the legacy and V0 encoders do not key blocks in one plain object. The reachable edge is a `kv:<namespace>` `chaId` (doc-verifier correction 3: an export failure, very rare). Candidate to retitle or park.

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

### CHORE-183 — A `botPresets` list that is missing or not a list makes "Convert without these parts" stop on the unexpected-error screen

**Status (2026-10-25, lane A records batch 13): COMPLETE.** Fixed on `worktree-Lane-G` in `8c1abc67a` (committed under `MC-547`) and merged to `main` in `efcf63634`. The full checks on the merged snapshot are ledger row 2288. Decisions: `MC-544` and `MC-545` (`MC-545` corrects the premise of `MC-544`). Lane G's closing lines below are folded in from its records (merge `efcf63634`) and were written before the merge ("merge pending" then); the residual is CHORE-391:
- What changed (`MC-544`, `MC-545`):
  - A missing or null `botPresets` in a converted older-format save gets the Default preset, shared with `completeRestoredTree` through `makeDefaultPreset` in `treeToBlockSet.ts`.
  - A present non-list `botPresets` makes the strict read (`readStrictSource`) treat that file as not decoded, so a good backup is offered. Otherwise the lenient read names "Presets" and the conversion then defaults it.
  - Only a tree with a `characters` list is defaulted. The source file is never written.
- Tests: new `src/ts/storage/tests/store2/legacyConvertPresets.test.ts` and two cases in `legacyLenient.test.ts`. 18 reproducers fail on `8003b3c4c` for the defect (Gate 2 rerun, `%TEMP%\risu-lane-g\chore183\gate2\red-base.log`).
- Gates (all `opus-reviewer`): Gate 1 round 1 REJECT (wrong premise, corrected in `MC-545`), round 2 APPROVE with amendments B1 to B6; Gate 2 APPROVE; commit message and comments EDITORIAL (reported in session, not saved), corrected and closed.
- Full checks: run on the tree holding both changes, before three comment-only edits (see the batch 2 handoff).
- Residual: CHORE-391.

**Status (2026-10-20, stage 4b close): open, not scheduled.** Source: device check D4 (`d2d4-results.md`), `MC-322` 6. The conversion writes nothing. Proposed: a missing or non-list `botPresets` becomes a named omitted part.

### CHORE-185 — The `Chat.draftCaptureScenarios` "success-then-fail" test is load-sensitive

**Status (2026-10-25, lane A records batch 13): COMPLETE.** Fixed on `lane-c-cloud-q` in `ab52cb8` and merged to `main` in `4fb1e3cbb`. Test-only. Gate 1 `[APPROVE]` for this row (row 3344) and Gate 2 `[APPROVE]` (row 3347). The full checks on the merged snapshot are ledger row 2285. Lane C's lines below are folded in from its records (merge `4fb1e3cbb`):

**Status (2026-10-24, lane C cloud batch Q): fixed on `lane-c-cloud-q` in `ab52cb8`; Gate 1 `[APPROVE]` for this row (row 3344); Gate 2 `[APPROVE]` (row 3347).** Test-only.

- **Cause (TRACED and EXECUTED; rows 3343 and 3344):**
  - `updateTranslationCache` in `src/lib/ChatScreens/Chat.svelte` chains writes through `translationWriteChain`. So the second save's mocked timer starts only after the first save settles.
  - The two generated "overlapping saves" tests, "fail-then-success" and "success-then-fail" alike, waited a fixed `sleepMs(50)`. An event-loop stall over about 35 ms let that sleep expire while the editor was still open.
  - Not a product race: in the stalled run the writes stayed in order (`T1`, `T2`) and `alertError` fired once.
- **What changed:** in `src/lib/ChatScreens/Chat.draftCaptureScenarios.svelte.test.ts` the fixed sleep is replaced with `vi.waitFor` on the editor closing, the idiom the file already uses elsewhere. One source site generates both tests. The wait stays inside `expectNoUnhandledRejections`, which still sees a late rejection (Gate 1 mutant M4).
- **Evidence:**
  - Diagnostic stall reproducer (60 ms busy-wait after the second click, scratch copy only): old test 2 failed, 11 passed; fixed test 13 passed; fixed without the stall 13 passed (row 3345).
  - Gate 1 scratch mutants of `Chat.svelte` against the fixed test: no record delete → 2 fail; editor never closes → 2 fail; `.catch(alertError)` removed → 2 fail; write chain bypassed → "success-then-fail" fails, while "fail-then-success" passes, a property of the existing test.
  - Repeated runs: 10 under CPU load and 3 alone, all 13 of 13 (row 3346).
- **Residual:** `Chat.translationSaveInFlight.svelte.test.ts` was audited (by grep and reading, Gate 1). Its fixed sleeps follow deferred promises that the test releases by hand, not chained mock timers, so it is out of scope.
- **Related:** `MC-438`.

**Status (2026-10-24, lane A records batch 10):** open; in batch Q with CHORE-240 and CHORE-353, run by lane C (cloud).

**Status (2026-10-20, stage 4b close): open, not scheduled.** It failed once in the full run `checks-19afc6829` under APK-build load; it passed 3 of 3 alone, and the quiet-PC run `checks-19afc6829-r2` passed. Test-only.

### CHORE-209 — `Chat.supaResume` "branch" tests can fail under full-suite load: a timed-out (c) may keep running into (d)

**Status (2026-10-25, lane A records batch 13): COMPLETE.** Fixed on `worktree-Lane-G` in `1fb45bf9a` and merged to `main` in `efcf63634`. Test-only. The full checks on the merged snapshot are ledger row 2288. Lane G's closing lines below are folded in from its records (merge `efcf63634`) and were written before the merge ("merge pending" then):
- Test (c) of `src/lib/ChatScreens/Chat.supaResume.svelte.test.ts` imported its memory modules dynamically inside the timed body. They are now imported at the top of the file. `afterEach` also restores the empty mocked database, but that reset alone does not fix the race: a Gate 2 mutant with only the reset still failed.
- Evidence: under a scratch config that delays the cold import with a 300 ms timeout, the `8003b3c4c` file fails (c) by timeout and (d) with "expected 3 to be 5", and the fixed file passes 21 of 21. Both the implementer and the Gate 2 reviewer ran this; the reviewer used the final harness on a scratch copy of the base file (`%TEMP%\risu-lane-g\chore209\gate2\red.log`).
- Limit: the forced delay models the cold import, not real full-suite timing.
- Gates: no plan gate (test-only, small); Gate 2 EDITORIAL, with the comment reworded and rechecked (`%TEMP%\risu-lane-g\chore209\gate2\verdict.md`). Commit claims checked by `doc-verifier` in session (not saved).

**Status (2026-10-25, lane A records batch 11): open, low priority, not scheduled; owner lane A.** Type: test isolation (a flake under load), not a product defect.

- **Observed:** in the batch T full run on `d9c68b0fe`, (c) "a send over the branched chat" timed out at 5000 ms and (d) "the parent chat is untouched" failed "expected 3 to be 5" (ledger row 2273). Both passed alone and under synthetic CPU load in later runs (ledger row 2276).
- **Likely mechanism (INFERRED, not reproduced):** (c) begins with a cold dynamic import of the memory modules; vitest does not cancel a timed-out test body, and the `afterEach` does not reset `DBState.db`, so a late (c) can change the chat that (d) reads.
- **Not attributed to batch T:** the file mocks `globalApi.svelte` and `request/request`, which T2 and T3 changed; the provider files T2 changed are reached only through the mocked `request.ts`, and T2's `mcplib.ts` change is confined to `MCPClient`'s SSE reader, which this test file never references (lane A, source read; not traced at runtime).
- **Candidate fix:** move the two dynamic imports to the top level or a `beforeAll`, and reset `DBState.db` in `afterEach`; prove it with a test that forces (c) to time out after a cold import.

### CHORE-240 — A full `pnpm test` rewrites `modules.test.ts.snap` with LF line endings

**Status (2026-10-25, lane A records batch 13): COMPLETE.** Fixed on `lane-c-cloud-q` in `413f600` and merged to `main` in `4fb1e3cbb`. Test tooling only. Gate 1 `[APPROVE WITH AMENDMENTS]` (row 3344) and Gate 2 `[APPROVE]` (row 3347). Lane A's Windows acceptance, which lane C left to lane A, ran inside the full run on the merged snapshot (ledger row 2285; scratch `backA\stageA-full\snap.txt`): across two consecutive full `pnpm test` runs the snapshot's sha256 stayed unchanged (prefix `A4214076`, before and after each run), `git ls-files --eol` read `i/lf w/lf attr/text eol=lf` before and after each run, and `git status` was unchanged. The working file was already LF before the first run, so the CRLF-checkout rewrite described below was not exercised on this checkout. Lane C's lines below are folded in from its records (merge `4fb1e3cbb`):

**Status (2026-10-24, lane C cloud batch Q): fixed on `lane-c-cloud-q` in `413f600`; Gate 1 `[APPROVE WITH AMENDMENTS]` (row 3344); Gate 2 `[APPROVE]` (row 3347).** Test tooling only. The Windows check is lane A's.

- **Cause (TRACED in `@vitest/snapshot` 4.1.11; EXECUTED in scratch clones; rows 3343 and 3344):**
  - Outside CI the default `updateSnapshot` is `"new"`.
  - `getSnapshotData` then marks every non-empty snapshot file dirty.
  - `saveSnapshotFile` skips the write only when the file text is byte-identical to its LF serialisation; `readSnapshotFile` does no line-ending normalisation.
  - So a CRLF working copy, as on a `core.autocrlf=true` checkout, is rewritten as LF on every local run. No obsolete or reordered key is involved.
  - Reproduced in a `core.autocrlf=true` clone: `i/lf w/crlf` before, ` M` after one run.
- **What changed:** `.gitattributes` gains `*.snap text eol=lf` with a one-line comment, so every checkout writes the snapshot as LF, matching the blob and what Vitest writes. Exactly one `.snap` file is tracked, `src/ts/process/mcp/risuaccess/tests/__snapshots__/modules.test.ts.snap`, with an LF blob. The two `i/crlf` blobs are archive files marked `-text` and are unaffected. Committing the rule causes no renormalisation diff.
- **Linux evidence (Gate 1, row 3344):** a fresh `core.autocrlf=true` clone with the rule checks the snapshot out `w/lf attr/text eol=lf`, and the other files are unchanged. Two consecutive test runs leave `git status --short` empty.
- **For lane A on Windows:**
  - An existing CRLF checkout keeps the file CRLF after `git checkout -- <snap>`, because Git sees it as clean. Either delete the file and then run `git checkout -- <snap>`, or let the first test run rewrite it to LF, after which the tree is clean.
  - Acceptance: two consecutive full `pnpm test` runs, then `git status --porcelain`, `git diff --stat` and `git ls-files --eol <snap>`. A lone ` M` with an empty `git diff` is a stale index stat; `git add <snap>` clears it.
- **Related:** `MC-438`.

**Status (2026-10-24, lane A records batch 10):** open; in batch Q with CHORE-185 and CHORE-353, run by lane C (cloud).

**Status (2026-10-22, lane D): open, not scheduled.** Test-only. Source: ledger row 2515 (first filed there); first seen in the `git status` of the S4-4 Gate 1 round 1 report after the CHORE-192 full run (row 2504).

- **Problem:** after a full `pnpm test`, `src/ts/process/mcp/risuaccess/tests/__snapshots__/modules.test.ts.snap` shows as modified. `git diff --ignore-cr-at-eol` showed no content change, so the difference was line endings only. The committed blob is LF and the checkout is CRLF (`core.autocrlf=true`; `git ls-files --eol` shows i/lf w/crlf). Captured after the S4-4b full run (row 2521): the working file was LF only (73 LF, 0 CR; `i/lf w/lf`), so Vitest rewrites the CRLF checkout as LF and Git sees the line-ending change. Why Vitest rewrites a snapshot whose content matches is not established (inferred: it compares the serialized LF text with the CRLF file). Seen after 6 full runs in lane D, each time restored from the index or to CRLF: the CHORE-192, S4-4a, S4-4b and S4-4c trees (rows 2504, 2515, 2521, 2536) and both completed runs on the `MC-382` tree (row 2543).
- **Not established:** why Vitest rewrites this snapshot (an obsolete or reordered entry would also trigger a write), and whether other snapshot files are affected on other runs. Only one `.snap` file is tracked, and `.gitattributes` holds only `-text` entries for archive snapshots (row 2523).
- **Smallest coherent correction (draft):** find what makes Vitest write the file; a `.gitattributes` rule `*.snap text eol=lf` so the checkout is LF like the blob and what Vitest writes; check which other `.snap` files exist and whether any is committed CRLF before adding it. Acceptance: two consecutive full runs leave the tree clean.
