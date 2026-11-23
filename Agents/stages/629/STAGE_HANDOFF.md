# #629 stage handoff: ordered safe start, crash-loop start, install warning

Issue: https://github.com/yor42/RisuTanium/issues/629 (MC-3621 handoff). Branch `claude/629-safe-start`. The PR link and commit are in the PR this file belongs to.

## State

- Code complete and reviewed: Gate 1 (four rounds, all EDITORIAL), senior-advisor challenge (PROCEED WITH CHANGES), combined Gate 2 EDITORIAL (one comment fix, applied). Reject streak 0. Tier 2.
- Not done: every Note 9 device row. #560 PR2/PR3 and #438 S3c-B stay blocked until the gating rows below are PASS or waived by the maintainer.

## Decisions

- Maintainer (Agents/mc/629.md): MC-3754 no restart of a frozen app; MC-3755 pack-free until the process ends; MC-3756 warning on all platforms, approved wording; MC-3757 Android 7.x limitation; MC-3758 install in a pack-free session stays off and says so; MC-3759 launchers without shortcuts limitation; MC-3760 a settings-only restore never brings pack colours; MC-3761 own colours, not the old pack's, after a switch in six edge cases.
- Derived, not asked: MC-3762 (MC-2953 clarified for a pending update); bound 2000 ms from the theme step; no host or a refused ask is pack-free at once; the existing notice; NO installs nothing and says nothing; copy follows the launcher label; read-only turn-off unchanged.
- Governing rule: MC-3638 (five invariants; hiding or restyling by a pack is a known limitation, not a finding).

## Changed files

- Kotlin (`src-tauri/gen/android/app/src/{main,test}/java/io/github/yor42/risutanium/`): PackSafeLaunch.kt (process-wide session), PackSafeLaunchActivity.kt, RendererLoss.kt (crash-loop flag in one commit), MainActivity.kt, KeepAliveBridge.kt; tests PackSafeLaunchTest.kt, RendererLossTest.kt.
- Boot: src/ts/android/launchOptions.ts (hold, `settlePackDecision`), src/ts/bootstrap.ts, src/ts/themePack/packSafeFlag.svelte.ts, packSafeMode.svelte.ts.
- Settings and colours: themePackInstallFlow.svelte.ts (risk confirm), ThemePackRow.svelte (pack-free lines, re-select), src/ts/themePack/activePack.svelte.ts and src/ts/gui/colorschemeCore.ts (`dropPackSchemeCopy`, displaced copy), src/ts/drive/rtbSettingsRestore.ts (MC-3760).
- Locales: en.ts plus seven, three keys each.
- Tests: new bootstrap.packSafeOrder.svelte.test.ts, tests/packSafeOrder.test-helpers.svelte.ts, lang/themePackRisk.test.ts, Display/themePackRisk.svelte.test.ts; extended packScheme(.lite), rtbSettingsRestore, launchOptions, packSafeMode, ThemePackRow, themePackInstallFlow, themePackDownloads.

## Test results (local; CI runs the full suite on the PR)

- Kotlin JVM, forced fresh run: PackSafeLaunchTest 11/11, RendererLossTest 35/35.
- Gate 2 run: 12 files, 425 tests passed. Remediation: 58 REPRO red before the fix, 243/243 green after; 93 related files, 4676 tests passed.
- Mutants killed: N1-N13 (Kotlin), P1-P16 (boot), S3 mutants, M1-M20 plus x21, x22, x26 and three restore mutants.
- `pnpm check`: 0 errors, 5 pre-existing warnings.
- Process deviations accepted at Gate 2: S2 wrote production code before recording its reds (reds then run against main's code, 26 of 37); two scratch copies held the worktree's `.git` pointer, with no repository effect.

## Unresolved

- Device rows, all unrun. Gating (PASS or maintainer waiver): DV-1, DV-1b, DV-1c, DV-2, DV-3 (b), DV-4, DV-6b, DV-7a, DV-9. DV-1c is the maintainer's own tap on a Note 9 and cannot end BLOCKED; DV-0's shortcut label is read in the same check. A different label or Korean Force stop label is a copy correction only.
- After an APK build, check AndroidManifest.xml and gradlew for line-ending churn (seen in the #628 handoff).
- Leftover for lane A: the advisor's standing control row ("a plain launch applies the pack") belongs in the live-checks checklist.

## Next stage

1. Lane A grants an APK slot; build a debug APK of the PR head.
2. Lane B runs the device table in the PR body, including DV-3 (c), the DV-4 cycle time, the DV-9 settle timings, the Korean App info and Force stop labels, and DV-8 (c) expecting the user's own scheme between the tap and the pack colours (no pass condition). Synthetic data only, batched per MC-3768.
3. Ask the maintainer for DV-1c and DV-0 on the APK.
4. A FAIL in a gating row returns the work to this ticket's branch. When every gating row is PASS or waived, tell lane A so it can unblock #560 PR2/PR3 and #438 S3c-B.
