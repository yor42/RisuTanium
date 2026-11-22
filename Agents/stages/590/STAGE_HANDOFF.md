# Stage handoff: #590 Android release job, S1 of 2

## 1. Completed PR and commit
- PR https://github.com/yor42/RisuTanium/pull/642 (`Refs #590`; the issue stays open for S2). Branch
  `claude/590-android-release-job-e1cbae`.
- Reviewed change: commit c0f62a91a. 2d41c7c3a merges origin/main 9960b8fad with no overlap on the S1 files.

## 2. Decisions (Agents/mc/590.md)
- MC-3714: no real certificate fingerprint in any workflow, script, test, document or PR text; the signer is checked
  against the environment variable `ANDROID_RELEASE_CERT_SHA256`. W7's 64-hex constant is a file hash.
- MC-3715..3718: the conflicting-draft refusal (S2), retention 3 and 14 days, deleting the repository-level secret
  copies right after the environment holds them, and the setup details recorded there.
- MC-3719: two PRs; S1 is the reusable workflow plus android-build release mode, artifact only.
- MC-3720: publish never deletes; it refuses and prints the delete commands (S2).
- MC-3721: real-tool tests skip with a visible notice; jobs fail closed.
- MC-3722: simple identity rules K0..K6; crafted-manifest tricks (L2) accepted, covered by the Note 9 and API 35 check.
- MC-3723: fix every known test gap, then freeze the test bar; a later test-only gap is a known limitation.
- Context: MC-3574, MC-3580, MC-3583, MC-3604, MC-3605.

## 3. Changed files
- `.github/workflows/android-release-apk.yml` (new), `.github/workflows/android-build.yml`
- `util/androidRelease.mjs` (new), `util/fixtures/androidReleaseInspect.json` (new)
- `util/androidRelease.test.ts`, `util/androidReleaseWorkflow.test.ts`, `util/androidSigning.test.ts` (new)
- `Agents/Tools/device/SIGNING.md`, `src-tauri/gen/android/app/build.gradle.kts` (one comment), `Agents/mc/590.md`

## 4. Tests and evidence
- After the main merge: the three release test files, 250 passed, 1 skipped (the skip-notice row), Windows, node vitest.
- Frozen mutant sweep at Gate 2 round 2: 102 of 105 red; green only R1-format, g-timeout, tool-limits (known limitations).
- The CLI fail-open through directory links found during implementation has a red-before-green link test.
- Gates: Gate 1 [REJECT], [REJECT], [EDITORIAL]; Gate 2 round 1 [REJECT]; senior-advisor (patch); reopened Gate 1 on the
  test delta [REJECT]; MC-3723; Gate 2 round 2 (opus-reviewer) [APPROVE], no findings. Dispositions in the PR body.
- Real local APKs passed the delivered inspect. Unproved until PR CI or a dispatch: the Linux paths (Ubuntu 26.04, Java
  25, installed apksigner launcher; S-1..S-5), GitHub environment delivery, `required: true` with empty secrets,
  artifact transfer with `permissions: {}`, the real key.
- Device rows: none. S1 changes no app behaviour; the device checks below belong to the first dispatch and S2.

## 5. Unresolved
- Known limitations as listed in the PR body (R1-format, g-timeout, tool-limits, other-group gaps, notice proved on bytes,
  Windows wrapper, W7 noise, SIGNING.md not in CI, GitHub delivery, L2, and the plan's L1..L13). No follow-up issue.
- Environment `android-release` did not exist at the last allowed read.

## 6. What the maintainer still does by hand
No agent did, read or can do any of this.
1. Create environment `android-release` per the setup guide in `Agents/Tools/device/SIGNING.md` (main only, required
   reviewer as the guide says). Enter there, by name only: the keystore secret, its password, the key alias and the key
   password secrets as the guide names them, and the variable `ANDROID_RELEASE_CERT_SHA256`.
2. Delete the repository-level copies of those secrets right after (MC-3717).
3. Judge whether the alias or a password is only short digits or only a-f characters; GitHub masking could then hide
   unrelated log text. Change it if so.
4. Bump the version on main before the first dispatch (release refuses prerelease and parts above 999).
5. Approve the first real dispatch; the session asks through AskUserQuestion. MQ4 is asked then, after setup only.
6. In the first dispatch's logs, read the three script success lines (inputs, signed check, inspect-signed). A green
   step without its line is a failure.
7. Before a real-data install: SIGNING.md item 6 dumpsys checks on the spare Note 9 (API 29) and the API 35 emulator.
8. MQ5 before the first publish (S2): are desktop updates, the Docker image and Android all wanted (MC-089)?

## 7. Instructions for S2
- Separate PR with its own sizing, plan and gates, from merged S1: release-desktop's Android part, the producer and
  `latest-android.json`. Binding: MC-3574, MC-3580, MC-3583, MC-3605, MC-3714..3716, MC-3720..3722, MC-350, MC-175.
- Needed S1 changes: reusable workflow outputs for the signed artifact id and hash, available only after inspect-signed
  succeeds; a signed-retention input (14 and 3); release-desktop as second caller, widening S1's one-caller, retention
  and name tests.
- W3's caller-key allow-list is widened by `needs` for release-desktop's caller only, with its exact value pinned. The
  other keys stay refused.
- Accepted review points: release-check needs `contents: write`, holds no key; environment only on `sign`; no
  `inherit`; no `ref` or `repository` on release-check or publish checkouts; fixed messages, notes by env; publish needs
  the whole reusable workflow's success and checks the signed hash; "draft of this commit" is only
  `target_commitish`; the draft creation race is detected, not prevented; no URL twin; no failure on a null asset
  digest; one mutant per irreversible rule; one Node script with fetch.
- The release-desktop header carries the publish checklist (items 7..13, item 10 per MC-3722: both devices, the
  draft's own APK).
- W7 pins android-release-apk.yml by file hash; any S2 edit to it updates the constant in the same commit.

## 8. MC IDs
- MC-3714..3723 used; none left. S2 needs a new block from lane A.