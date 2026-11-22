# #603 stage handoff (single and final stage)

## 1. Completed PR and commit

- PR: yor42/RisuTanium#639, `claude/603-fs-scope-e7dcab` into `main`.
- Reviewed head commit: `965e1601c7491ed3d044520f4fc6d26597648bfe`, on base `ab535a18c584d62e5fcb08501ce4effe175cfa38`. A later commit that changes only this file needs no new review.
- Size tier 2. Opus Gate 1 rejected plans r2 and r3, then returned EDITORIAL on plan r4. Opus Gate 2 round 1 returned EDITORIAL; the six wording findings are corrected, and a doc-verifier accepted the closure.

## 2. Architectural decisions

- MC-3724: every page route into Android private storage closes in this one PR. Page code reaches only the app's store folders.
- MC-3725: `file:` links and the app's own content provider are refused. Other apps' content links keep working.
- MC-3726, MC-3728, MC-3730, MC-3731: a raw path, `file:` or `content:` string in an image field is not read on Android. Each caller keeps its existing error handling, and the PR lists the quiet spots.
- MC-3727, MC-3729: the key rule holds on every target. Desktop drops `/data/**` and the cache grants, and keeps AppData.
- MC-3732: one native check on every picker answer delivered through `onActivityResult`. A refused answer acts as a cancel.
- MC-3733: the paste and drop route of WebView before 152 is a known limit. The maintainer confirmed it on 2026-11-23 for the corrected finding.
- Kept unchanged: MC-3609..3611 (the six update-folder denies, the seal, the secret name). No stored key, format, migration, manifest or init-script change. Key-to-path is unchanged.

Mechanism:
- Per-platform capabilities: `android.json` (read-only fs) and `desktop.json`. `migrated.json` no longer grants fs or dialog open.
- An Android asset scope in `tauri.android.conf.json`.
- An fs command gate in `src-tauri/src/fs_guard.rs`, around the fs plugin and registered only in `app_plugins`.
- The closed key set in `src-tauri/src/store_keys.rs`, applied in both key resolvers.
- The same URI rule in `export_append_b64` and in `PickerResultPolicy.kt`.
- `allowContentAccess = false` on the WebView.

## 3. Changed files

- New:
  - `src-tauri/capabilities/android.json`, `src-tauri/tauri.android.conf.json`
  - `src-tauri/src/fs_guard.rs`, `store_keys.rs`, `fs_boundary_tests.rs`
  - `src-tauri/tests/fixtures/android-boundary.json`
  - `PickerResultPolicy.kt` and its JVM test and fixture under `src-tauri/gen/android/app/src/`
  - `src/ts/android/androidBoundary.producers.test.ts`, `src/ts/refusedImageRead.test.ts`, `src/ts/refusedImageCallers.svelte.test.ts`
  - `Agents/mc/603.md`
- Changed:
  - `src-tauri/`: `capabilities/{desktop,migrated}.json`, `gen/schemas/capabilities.json`, `tauri.conf.json`, `Cargo.toml` (tauri `test` dev feature)
  - `src-tauri/src/`: `lib.rs`, `durable_write.rs`, `chunked_io.rs`, `export_append.rs`, `app_fs.rs`; `store2_gate.rs` (header only)
  - Kotlin: `MainActivity.kt`; `AppUpdateFlow.kt` (comment only)
  - `src/ts/drive/importBench.ts` (scratch key under `modeldata/`)
  - Test files and the wire fake under `src/ts/`

## 4. Test results

- `cargo test --lib --offline`: 526 passed, 0 failed, 3 ignored. Without the fix: 491 passed, 21 failed.
- Vitest: the 88 suites that read a changed file, 2544 passed, 0 failed. Without the fix, the changed suites had 37 failures by assertion.
- Kotlin `:app:testUniversalDebugUnitTest` (local JVM only, not CI): 488 passed. `PickerResultPolicyTest` had 19 of 24 failing without the fix.
- `pnpm check`: 0 errors.
- Mutants: 83 of 83 killed (Rust 46, TypeScript 13, Kotlin 24).
- Gate 2 ran `cargo check` for `aarch64-linux-android` (passed) and probed the real Android permission set through IPC.
- PR CI: running when this file was written. The cfg(unix) tests run there for the first time. TODO(evidence): CI result.
- Note 9 rows DV-603-0..12, #541's DV-15 probe included: assigned to lane B, synthetic data. TODO(evidence): results. They gate the merge.

## 5. Unresolved issues

- Merge gates: green PR CI and the Note 9 rows. DV-603-2, 6 and 10 carry three pieces of wiring that no automatic test covers: the OS string in `run()`, the `onActivityResult` override and `allowContentAccess`.
- Maintainer action before the next MVP update: check that the phone's Android System WebView is 152 or later. Record the release build's resolved `Cargo.lock` and merged providers and repeat the version check on them. No agent touches the phone.
- Leftovers, not fixed here (each is one line in the PR):
  - The boot temp sweep omits `store2`, `inlays` and `consent`, and the comment in `tauriAtomicWrite.ts` says otherwise.
  - The untracked `Cargo.lock` lets security premises drift between builds.
  - The Playground image button stays in its generating state after any rejection.
  - `getPersonaImageMain` logs `getCharacterImageMain`'s label.
- Known limits are listed in the PR body.

## 6. Next stage

None remains: this PR closes #603. After the merge, the closeout is the issue link, the board card, the leftover dispositions and removal of this session's own worktree. MC block 3724..3733 is fully used.
