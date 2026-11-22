# #234 stage handoff: S6a (Home Tasks) to S6b (top-bar polish)

Written 2026-11-22 under MC-3621 and MC-3622. The next orchestrator starts from this file, the repository at origin/main and the PR. It needs no transcript and no scratch file.

## 1. Completed PR and commit

- PR: 627 (https://github.com/yor42/RisuTanium/pull/627), branch `claude/234-s6`.
- Reviewed change: commit dabcf5ecd. PR head before this file: 0b08d2166, which merges origin/main 51dba53a3 with an identical patch-id. The PR carries the merge commit.
- Earlier stages on main include S5 and S7 (PR 618).

## 2. Architectural decisions

- MC-2825, MC-2936, MC-2937: Tasks is always shown, lists AI replies only, and finished rows vanish at once.
- MC-3669 (amends MC-2935): a row's Stop is `stopWorkIn` on its exact (chaId, chatId). It ends that chat's other work too and never reaches another chat.
- MC-3670 (amends MC-1436): the wide bar uses the mid two-row layout when one row does not fit. S6b builds it.
- MC-3671: on phones the persona chip is an icon on the brand row. S6b builds it.
- MC-3672: a native reply still running after an app restart is not listed in Tasks. Accepted.
- MC-091 amendment: the lattice pauses behind every modal layer, not only Tasks.
- HomeTasks owns focus return and gives PatternDialog no `trigger`, so a cover close does not take focus back.
- `tasksOpen` lives in HomeTopBar so the dialog survives a band change.
- `replyTargets()` is read-only. An idle Home never reads the characters.
- Deviations from the plan, accepted at Gate 2: focus recovery by a focusin record plus a post effect; cover stores subscribed only while open; two generated `sharedTokenConsumers` entries; test T-S6-12b (with an async T-S6-14 and an exported `taskKey`).

## 3. Changed files

- `src/lib/UI/Home/`: new `HomeTasks.svelte`, `homeTasks.ts`, `homeLayer.ts`; edited `HomeTopBar.svelte`, `HomeShell.svelte`, `HomeDrawer.svelte`.
- `src/ts/process/chatOrigin.ts`: `replyTargets()`.
- `src/ts/themePack/sharedTokenConsumers.ts`: two entries.
- `src/lang/`: five `homeTasks*` keys in en and the 7 locales.
- Tests: `HomeTopBar.tasks`, `homeTasks`, `HomeShell.lattice`, `chatOrigin.registry`.
- `Agents/mc/234-s6.md` and this file.

## 4. Test results

- Merged tree (0b08d2166): `pnpm vitest run` over `src/lang`, `src/ts/themePack`, `src/styles`, `src/lib/UI/Home`, `src/lib/Nexus`, `src/lib/SettingsShell`, `src/ts/nativeReply`, chatOrigin and the escape, census and own-scheme suites: 238 files, 6787 tests, exit 0.
- `localeParity` and `sharedTokenConsumers` on their own: 12 tests, exit 0.
- `pnpm check`: exit 0, 0 errors, 5 existing warnings.
- Base 3c7f81848: the new tests gave 25 failures.
- Mutants: the coder caught all 35 planned. Gate 2 re-ran M13, M18, M21b, M21d and M25, then X1+X2 combined and X5.
- Gate 2: r1 EDITORIAL, r2 APPROVE.
- CI: pending when this file was written; the PR's checks are the record.
- Device rows D-A1..D-A11 (table in the PR body): with lane B, all open when this file was written. Read their results in the PR comments.

## 5. Unresolved issues

Known limitations:
- AL-1 (MC-3672): native replies after a restart are not listed, except during the short apply of a recovered reply.
- AL-2: "Stopping…" stays until the row vanishes, even if the registered stop does nothing. A band change resets that label; a repeat press is harmless.
- AL-3: on PC `doingChat` is global, so several rows show in practice only through recovered applies.

Leftovers:
- L-S6-1, other background work in Tasks, and L-S6-6, the dialog title once it lists more: issue 613.
- L-S6-2 (Community rows `items-start`), L-S6-8 (mid-band DOM order) and L-S6-9 (empty mid switcher row gap): Home polish, issue 234, reconsidered at S6b closeout.
- L-S6-3: remove `settingsShellModesHomeNote` from en and the 7 locales at the next locale cleanup, after S6b removes its use.
- L-S6-4: an Open action on rows. Dropped unless the maintainer asks (MC-2825 gives Stop only).
- L-S6-5: lifting AL-1. Since the 514 S3 merge, `src/ts/nativeReply/runningReplies.svelte.ts` can list those replies, but has no Stop route. Trigger: native reply ownership (MC-1451, issue 514).
- Sidebar collapse on Home: issue 595.

## 6. Next stage: S6b

Start only after the S6a merge and the maintainer's yes through lane A (MC-3622). Use a fresh session, worktree and branch from origin/main. The S6b pre-fix base is the S6a merge commit.

Gates: #234 S6 is Tier 2. Gate 1 r2 passed the S6b plan summarized below, against base 3c7f81848. Recheck the two premises below, then one coder and a fresh Gate 2. Reopen Gate 1 only if a premise fails.

Premises to recheck, both changed by PR 626 (Settings is now a live pack area):
- The plan picked `ColorSchemeTypeStore` for the logo on the premise that packs gate only chat and studio. `surfaceGate.svelte.ts` now gates settings too. Confirm `packBaseTone` is still null whenever Home is uncovered.
- The plan drops `settings-mode-visibility-home-note` from `areaParts.ts`. Settings part names are now applied. Confirm what an installed pack naming a dropped part does (it must not break that pack), and which pack goldens change.

Scope (HomeTopBar is shared, so nothing else edits it in parallel):
1. Phone band (under 768 px, not a media query): `HomePersonaChip` gets a `compact` prop (44 px icon, `sr-only` label and hint, accessible name unchanged) and moves into the menu row after Tasks. Render the phone switcher wrapper only when `switcherEntries(...)` is non-empty. DOM order is menu, brand, Tasks, chip, switcher. Mid and wide keep their wrappers.
2. Wordmark: `max-[349.98px]:sr-only` in the phone class (a viewport variant, never `@max-`).
3. Wide fallback: export `WIDE_BAR_MIN = 1248` from `homeSwitcher.ts`. HomeTopBar reads `header.clientWidth` synchronously in an effect, then observes with a ResizeObserver guarded by `typeof ResizeObserver`. Do not use `bind:clientWidth`: it throws in jsdom. The effective layout is mid when the band is wide and 0 < width < the minimum. Only the bar follows it; the landing, lattice and phone branch keep the band.
4. Light logo: `data-tone="light"` on the Home brand svg only while the scheme type is light. No CSS change; dark schemes stay identical.
5. Delete the stale Home note in `ModeVisibilityGroup.svelte`, its `areaParts.ts` name and its `settingsParts.test.ts` entry. Keep the locale key (L-S6-3).
6. Guard that hidden modes stay out of the bar switcher (CHORE-584, MC-1151, MC-1152).

Required tests, in `HomeShell.layout.svelte.test.ts` unless named:

| ID | Asserts | Class | Mutants it must catch |
|---|---|---|---|
| T-S6-40 | At 360 and 700: row order, compact classes, label still in text, header children | reproducer | M27 chip stays in its wrapper; M27b no sr-only; M27c media query instead of band |
| T-S6-41 | One header child with one mode, two with several | reproducer | M28 wrapper always rendered |
| T-S6-42 | Wordmark has the viewport class | reproducer | M29 container query |
| T-S6-43 | Width 1200 gives mid; a resize to 1300 gives wide | reproducer | M34 no observer |
| T-S6-44 | Width 0 or at the minimum keeps wide; mounts without ResizeObserver | guard | M30 zero treated as narrow; M31 comparison inverted; M33 unguarded observer |
| T-S6-45 | The landing stays wide while the bar falls back | guard | M32 landing follows the bar |
| T-S6-46 | Hidden modes absent, following a live change | guard | none |
| T-S6-47 | Rewrite the 360 cases of T-A2c and T-H3; T-G2, T-H3b and T-F6 unchanged | guard | none |
| T-S6-50 | Light sets the tone, dark sets none, live switch, boot mark unaffected | reproducer | M35 always set; M36 never set or on the wrong element |
| T-S6-52 | The note is absent (`ModeVisibilityGroup.svelte.test.ts`) | reproducer | M37 note kept |

Gate 1 editorial items to carry:
- E-3: add layout cases at 768 and at 1440 with the sidebar open and closed (1440 open falls back when the header is under the minimum).
- E-4: cite or test that Lite is a dark scheme type.

Guards: all Home suites, `escapeRoute`, `escapeCensus`, `escapeWalk.home`, `areaParts`, `settingsParts`, the theme-pack suites, `homeTokens`, ModeVisibilityGroup, `localeParity`, and `pnpm check`.

Device rows for lane B:
- D-B1, PC 360 and 320, en and ko: one row (menu, brand, Tasks, icon chip), switcher row only with entries, no overflow.
- D-B2, PC 340: wordmark visually hidden, present in the accessibility tree.
- D-B3, PC 1280, en and ja: measure the clip width and fix `WIDE_BAR_MIN`; two rows with the sidebar open, one closed; no wide frame after reload.
- D-B4, PC: Light shows frame and centre at 3:1 or better; every dark preset is pixel-identical to the base.
- D-B5, Note 9 at 360: one row, targets 44 px or larger.

Records: MC-3669..3672 are used. MC-3673 is unused and returned to lane A; ask lane A for S6b's IDs. S6b's closeout decides whether #234 has a further stage, and only the final stage closes the ticket.
