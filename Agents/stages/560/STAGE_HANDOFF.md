# #560 stage handoff: PR2 done, PR3 next (2026-11-23)

## 1. Completed PR and commit

- PR2: yor42/RisuTanium#693, branch `claude/560-pr2-validator-f33677`. The reviewed head commit is 8ed8ba1dc on origin/main 8804c641d. The PR carries the merge commit.
- Earlier #560 PRs, all merged: PR-A #597, PR-A2 #611, PR-B #622. C-1 was dropped with no PR (MC-3638).
- The issue stays open, and PR3 closes it.

## 2. Architectural decisions

- **MC-3638.** A pack finding blocks only on the five invariants in `docs/workflow/gates.md` "Theme-pack findings". Everything else is a one-line known limitation.
- **MC-3419, MC-3421, MC-3423, MC-3426.** Contrast, readability and the layout floors are notes, and the pack installs.
- **MC-3880** (maintainer, this stage). The size ceilings are layout notes. This covers reach font, letter spacing, line height, spacing and border, token paddings, the BOUNDS upper sides, the lims maximums, the safe-tier padding, margin and size, and the decoration thickness over its maximum. The 64 px shadow/border cap, the place-over ban and the negative-spacing bans still refuse.
- **MC-3639, MC-3642.** Own colours are frozen as best-effort. Notes never enter `warnings`, so no note reaches `triggersOwnColours`. MC-3647 and MC-3648 are cancelled.
- **MC-2370 is removed:** `plainPaintErrors`, `plainPaintWhy` and `holdsOtherBang` are deleted.
- **Orchestrator readings** (`Agents/mc/560.md`):
  - sizes that cannot be bounded, and relative sizes on a safe part, still refuse;
  - width tokens over 64 px are notes, which is a known limitation;
  - the light-base proof in `apply.ts` `baseOf` also requires no `contrast` note.
- **Notes channel shape.**
  - `LintResult.notes` is present only when non-empty. Each item is a `LintError` with `rule: 'contrast' | 'readability' | 'layout'`. Errors never carry `rule`, and `ok` means no errors.
  - `splitFindings` and `pushUnique` live in `failclosed.ts`.
  - `judgeClient.readAreaSheet` fails closed on malformed notes.
  - The install row header is `themePackInstalledWithNotes`.
  - #438 S3c-B inherits this shape.

## 3. Changed files

- **Source:** `src/ts/themePack/`: engine.ts, failclosed.ts, geometry.ts, valueRules.ts, cascade.ts, index.ts, judgeClient.ts, apply.ts, registries/home.ts and registries/studio.ts. Also `src/lib/Setting/Pages/Display/themePackInstallFlow.svelte.ts`, and `src/lang/` en, cn, de, es, ja, ko, vi and zh-Hant.
- **Reference mirror:** `docs/design/chat/checks/th/` packlint.mjs, failclosed.mjs and geometry.mjs; `docs/design/home/registry-home.mjs`; `docs/design/studio/checks/th4/packlint-studio.mjs`.
- **Tests:**
  - new: `src/ts/themePack/notesChannel.test.ts`;
  - re-pinned: hostilePacks, cascadeRules, parity, corpusGolden, goldenPacks, packRules, focusRingCaps, geometryMatrix, judgeApi, validatorLoosen, readerDelegation, engineWarnings, lightBase, judgeClient, apply.svelte, builtins and themePackInstallFlow.svelte;
  - `fixtures/corpus-golden.txt`: verdict columns only;
  - `goldens/README.md`: wording.
- **Records:** `Agents/mc/560.md` (MC-3647, MC-3648 with the MC-3642 supersession, and MC-3880).
- **Unchanged:** golden bytes, `docs/design/**/themes/*.css` and `theme-packs/`.

## 4. Test results

- **Local runs** (Windows, node, vitest 4.1.12):
  - `src/ts/themePack` plus `src/lib/Setting/Pages/Display`: 93 files and 4452 tests green on the merged tree;
  - after the Gate 2 test fixes, `src/ts/themePack`: 4187 green;
  - `src/lang/localeParity.test.ts` green;
  - `pnpm check`: 0 errors.
- **Red before green:**
  - notesChannel N rows: 30 of 49 failed on the base, all assertion failures;
  - stage 2 rows: 14 failed before the transport.
- **Mutants:** every planned mutant is killed, and so is every Gate 2 reviewer mutant: G2, G3, G5, G6, G7, G7b, G11 and G20, plus the G21 control.
- **Corpus** (847 inputs × 4 areas): 330 verdicts flip to accepted, 0 are newly refused, and 0 tagged errors remain. The canonical column is byte-identical.
- **Gates:** Gate 1 [REJECT] then [EDITORIAL]; Gate 2 [REJECT] (a test defect, fixed) then [APPROVE]. All by opus-reviewer.
- **CI:** TODO(evidence), as PR #693 checks are pending at handoff time.
- **Device rows:** none, because the change is in the judge and the row text.

## 5. Unresolved issues

- The known limitations are in the PR body and get no remedy (MC-3638).
- **Pre-existing environment issue:** `src/styles/tests/packBase.svelte.test.ts` cannot load through a `node_modules` junction (`@tailwindcss/oxide`). CI covers it.
- **#438 S3c-B** is paused until lane A's go. Tell lane A and that session that PR2's notes shape is on main once #693 merges.
- **#654** (full theme rework, MC-3871) waits for PR3.

## 6. Instructions for PR3 (the final stage)

- **Start:** after #693 merges and the maintainer says yes. Begin from origin/main in a fresh worktree.
- **Scope:**
  - Effects admissions (MC-3422) shrink to the coarse 64 px resource caps plus the existing code and network bans: `::before` and `::after` with empty `content` only; mask, clip-path and border-image allowed; outer shadows up to 64 px. This removes the E-2 2 px shadow limit (MC-2309). The overlay and spoofing bans stay: z-index, position fixed/sticky, `content` text, direction/unicode-bidi/writing-mode, `all` and offset. The clip-path function allowlist stays as a feature fix. Reviewer findings on stacking, pseudo-element geometry and unitless outsets are known limitations under MC-3638.
  - Decide with evidence whether the DD-243 outline ban becomes a note or an admission.
  - Docs: THEMING.md, theme-packs/README.md, the sheet header comments and `docs/design/theme/checks/run.mjs`.
  - Re-measure judge and apply cost (#325, #363), since more sheets now reach Rule S, SCOPE and E-2.
- **Gates:** Tier 2 (validator refusal boundary): designer plan, Gate 1 and Gate 2 by opus-reviewer. Red-before-green tests for each admission and kept-ban tests for the overlay family. A Note 9 row only if an admission is observable only on the device.
- **Wording:** PR3 carries the closing keyword. Then the closeout: board card, leftovers, and #207 (re-tightening, likely superseded, and closing it needs the maintainer).
- **MC block:** MC-3881..3889 are unused, and MC-3649..3653 are also free.
