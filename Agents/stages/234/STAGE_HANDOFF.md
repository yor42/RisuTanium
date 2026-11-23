# #234 stage handoff: S6a (Home Tasks and bar fallback) to S6b (top-bar polish)

Written 2026-11-22 under MC-3621 and MC-3622, updated for amendment 1 (MC-3673). The next orchestrator starts from this file, the repository at origin/main and the PR. It needs no transcript and no scratch file.

## 1. Completed PR and commit

- PR: 627 (https://github.com/yor42/RisuTanium/pull/627), branch `claude/234-s6`.
- Reviewed changes: dabcf5ecd (S6a) and a1d5e8c17 (amendment 1). Head before this file's update: a14068a92, which merges origin/main ab535a18c. The PR carries the merge commit.
- Earlier stages on main include S5 and S7 (PR 618).

## 2. Architectural decisions

- MC-2825, MC-2936, MC-2937: Tasks is always shown, lists AI replies only, and finished rows vanish at once.
- MC-3669 (amends MC-2935): a row's Stop is `stopWorkIn` on its exact (chaId, chatId). It ends that chat's other work too and never reaches another chat.
- MC-3670 (amends MC-1436): the wide bar uses the mid two-row layout when one row does not fit. Built in PR 627 under MC-3673.
- MC-3671: on phones the persona chip is an icon on the brand row. S6b builds it.
- MC-3672: a native reply still running after an app restart is not listed in Tasks. Accepted.
- MC-3673: the two-row fallback moved from S6b into PR 627, and nothing else did.
- Band versus layout in `HomeTopBar`: `band` picks the nodes (both phone conditionals) and is what the landing, HomeShell and lattice read. `layout` picks the bar's `data-layout` and its six class maps. They differ only for a wide band narrower than `WIDE_BAR_MIN` (in `homeLayout.ts`, a header width), shown as mid. New bar classes key on `layout`, new node conditions on `band`.
- The width observer runs only in the wide band and watches the header's parent. Observing the header itself raises a ResizeObserver loop error, because the switch changes the header's height.
- Tasks and the chip keep a 44 px floor in mid and wide (`*:min-w-11` on the chip wrapper).
- MC-091 amendment: the lattice pauses behind every modal layer, not only Tasks.
- HomeTasks owns focus return and gives PatternDialog no `trigger`, so a cover close does not take focus back.
- `tasksOpen` lives in HomeTopBar so the dialog survives a band change. A layout change keeps the same nodes.
- `replyTargets()` is read-only. An idle Home never reads the characters.
- Deviations from the plans, accepted at Gate 2: focus recovery by a focusin record plus a post effect; cover stores subscribed only while open; two generated `sharedTokenConsumers` entries; test T-S6-12b (with an async T-S6-14 and an exported `taskKey`); in the amendment, test classes and one split test (details in the PR).

## 3. Changed files

- `src/lib/UI/Home/`: new `HomeTasks.svelte`, `homeTasks.ts`, `homeLayer.ts`; edited `HomeTopBar.svelte`, `HomeShell.svelte`, `HomeDrawer.svelte`, `homeLayout.ts`.
- `src/ts/process/chatOrigin.ts`: `replyTargets()`.
- `src/ts/themePack/sharedTokenConsumers.ts`: two entries.
- `src/lang/`: five `homeTasks*` keys in en and the 7 locales.
- Tests: `HomeTopBar.tasks`, `homeTasks`, `HomeShell.lattice`, `HomeShell.layout`, `chatOrigin.registry`.
- `Agents/mc/234-s6.md` and this file.

## 4. Test results

- Merged tree (a14068a92): `pnpm vitest run` over locales, theme packs, styles, Home, Nexus, SettingsShell, native reply, chatOrigin, the escape, census, own-scheme and focus-ring suites, and the suites PR 636 touched for active units: 240 files, 6860 tests, exit 0.
- `pnpm check`: exit 0, 0 errors, 5 existing warnings.
- S6a on base 3c7f81848: the new tests gave 25 failures; the coder caught all 35 planned mutants; Gate 2 r1 EDITORIAL, r2 APPROVE.
- Amendment 1 on base eb2ec8db5: 11 new test cases failed at the intended assertions; the coder caught all 20 mutant variants; Gate 1 EDITORIAL, Gate 2 r1 EDITORIAL, r2 APPROVE.
- PC rows D-A1..D-A6 passed on eb2ec8db5 and carry over. D-A10 failed there (overlap). On a production dist of 1c441fe36 (the reviewed diff merged with main a4a339191): D-A10 passed in all 96 states, judged by element boxes, and its detector control failed as required; D-A9 and D-A12 passed; D-B3 steps 2 and 3 passed (at a 1248 px header ja and vi fit one row with no intersection; no wide frame on reload at 1280 with the sidebar open).
- D-B3 step 1: the plan's formula gave 1296 (vi; ja 1272), above the 1280 header with the sidebar closed, because it measured the persona chip with its hint on one line. The maintainer kept `WIDE_BAR_MIN` at 1248 (AskUserQuestion, 2026-11-23): between 1248 and about 1296 the vi and ja persona hint wraps to two lines inside the chip.
- At 768 the wordmark shows "Risu" only; its cell clips it, and nothing overlaps it. S6b's phone work does not change the mid band.
- D-A7, D-A8 and D-A11 (Note 9) are post-merge and run under the `note9` lease (MC-3774). The PR body and comments hold the results.
- Run vitest here as `pnpm vitest`: under plain `node` the packBase suite cannot resolve `@tailwindcss/oxide`.
- CI: the PR's checks are the record.

## 5. Unresolved issues

Known limitations:
- AL-1 (MC-3672): native replies after a restart are not listed, except during the short apply of a recovered reply.
- AL-2: "Stopping…" stays until the row vanishes, even if the registered stop does nothing. A band change resets that label; a repeat press is harmless.
- AL-3: send admission still refuses while any reply runs (kept by issue 596 stage 1, PR 636), so several rows show in practice only through recovered applies until that ticket opens the gate.
- AL-4: a theme pack selecting the bar by `data-layout="wide"` sees `mid` on a narrow wide bar (MC-3638: no block).
- AL-5: T-S6-60 proves the floor's classes only; D-A10 proves the geometry.

Leftovers:
- L-S6-1, other background work in Tasks, and L-S6-6, the dialog title once it lists more: issue 613.
- L-S6-2 (Community rows `items-start`), L-S6-8 (mid DOM order differs from visual order, now also on a narrow wide bar) and L-S6-9 (empty mid switcher row gap): Home polish, issue 234, reconsidered at S6b closeout.
- L-S6-3: remove `settingsShellModesHomeNote` from en and the 7 locales at the next locale cleanup, after S6b removes its use.
- L-S6-4: an Open action on rows. Dropped unless the maintainer asks (MC-2825 gives Stop only).
- L-S6-5: lifting AL-1. Since the 514 S3 merge, `src/ts/nativeReply/runningReplies.svelte.ts` can list those replies, but has no Stop route. Trigger: native reply ownership (MC-1451, issue 514).
- Sidebar collapse on Home: issue 595.

## 6. Next stage: S6b

Start only after PR 627 merges and the maintainer says yes through lane A (MC-3622). Use a fresh session, worktree and branch from origin/main. The S6b pre-fix base is PR 627's merge commit.

Recommended orchestrator model (MC-3765): Sonnet, the default. No Opus trigger was identified: the design is settled, no critical contract changes and it is one stage in one subsystem. If a premise below fails and leaves open design, that is the Opus trigger.

Gates: #234 S6 is Tier 2. Gate 1 r2 passed the S6b plan summarized below, against base 3c7f81848; amendment 1 then removed its fallback item. Recheck the two premises, then one coder and a fresh Gate 2. Reopen Gate 1 only if a premise fails.

Premises to recheck, both changed by PR 626 (Settings is now a live pack area):
- The plan picked `ColorSchemeTypeStore` for the logo on the premise that packs gate only chat and studio. `surfaceGate.svelte.ts` now gates settings too. Confirm `packBaseTone` is still null whenever Home is uncovered.
- The plan drops `settings-mode-visibility-home-note` from `areaParts.ts`. Settings part names are now applied. Confirm what an installed pack naming a dropped part does (it must not break that pack), and which pack goldens change.

Exactly what remains (HomeTopBar is shared, so nothing else edits it in parallel):
1. S6b-1, phone band (under 768 px, not a media query): `HomePersonaChip` gets a `compact` prop (44 px icon, `sr-only` label and hint, accessible name unchanged) and moves into the menu row after Tasks. Render the phone switcher wrapper only when `switcherEntries(...)` is non-empty. DOM order is menu, brand, Tasks, chip, switcher. Mid and wide keep their wrappers. The wordmark gets `max-[349.98px]:sr-only` in the phone class (a viewport variant, never `@max-`).
2. S6b-3, Light logo: `data-tone="light"` on the Home brand svg only while the scheme type is light. No CSS change; dark schemes stay identical.
3. S6b-4: delete the stale Home note in `ModeVisibilityGroup.svelte`, its `areaParts.ts` name and its `settingsParts.test.ts` entry. Keep the locale key (L-S6-3).
4. Guard that hidden modes stay out of the bar switcher (CHORE-584, MC-1151, MC-1152).

S6b-2 (the fallback) is done in PR 627. Do not rebuild it.

Required tests, in `HomeShell.layout.svelte.test.ts` unless named:

| ID | Asserts | Class | Mutants it must catch |
|---|---|---|---|
| T-S6-40 | At 360 and 700: row order, compact classes, label still in text, header children | reproducer | M27 chip stays in its wrapper; M27b no sr-only; M27c media query instead of band |
| T-S6-41 | One header child with one mode, two with several | reproducer | M28 wrapper always rendered |
| T-S6-42 | Wordmark has the viewport class | reproducer | M29 container query |
| T-S6-46 | Hidden modes absent, following a live change | guard | none |
| T-S6-47 | Rewrite the 360 cases of T-A2c and T-H3; T-G2, T-H3b and T-F6 unchanged | guard | none |
| T-S6-50 | Light sets the tone, dark sets none, live switch, boot mark unaffected | reproducer | M35 always set; M36 never set or on the wrong element |
| T-S6-52 | The note is absent (`ModeVisibilityGroup.svelte.test.ts`) | reproducer | M37 note kept |

Gate 1 editorial item to carry: E-4, cite or test that Lite is a dark scheme type. (E-3 is covered by T-S6-43, T-S6-44 and T-S6-62.)

Guards: all Home suites (the fallback and floor tests T-S6-43..45, 60..62 stay green), `escapeRoute`, `escapeCensus`, `escapeWalk.home`, `areaParts`, `settingsParts`, the theme-pack suites, `homeTokens`, ModeVisibilityGroup, `localeParity`, and `pnpm check`.

Device rows for lane B:
- D-B1, PC 360 and 320, en and ko: one row (menu, brand, Tasks, icon chip), switcher row only with entries, no overflow. Judge by element boxes and the screenshot, not by document scrollWidth.
- D-B2, PC 340: wordmark visually hidden, present in the accessibility tree.
- D-B4, PC: Light shows frame and centre at 3:1 or better; every dark preset is pixel-identical to the base.
- D-B5, Note 9 at 360: one row, targets 44 px or larger.

Records: MC-3669..3673 are all used, so none of this block is left; ask lane A for S6b's IDs. S6b's closeout decides whether #234 has a further stage, and only the final stage closes the ticket.
