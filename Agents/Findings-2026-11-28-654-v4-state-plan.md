STATUS: PLAN READY, OPEN PRODUCT QUESTIONS

## Summary
- #654 V-4 is a markup gap: the engine accepts any `[data-x]`/`[data-x="v"]` and tiers by `data-part` (engine.ts:296, :343, :349-358; scope.ts:177-182). **Engine, scope and registries unchanged.**
- Names follow meaning, on a closed list of part and attribute pairs:
  - `data-current` marks the one item the user is in: chat-row, settings-index-entry, home-drawer-item, studio-tg-preview-row.
  - `data-selected` marks the chosen item inside a control: home-task-tab, studio-segment.
- Value rule for every listed attribute: absent when the state does not hold, `"true"` when it holds, never empty, never `"false"`. `data-on` and `data-open` are reserved and not yet listed.
- The list is an exported constant in `src/ts/themePack/stateAttributes.ts`, following the areaParts.ts precedent. T7 recomputes it from the Svelte AST and a TS scan.
- THEMING.md: only listed pairs are stable; every other accepted `data-*` is internal.
- Size S: 6 markup lines, ~20-line constant, ~350 test lines, ~30 doc lines. Tier 2. The name allowlist is Q3.

## Requirements and scope
- R1 (maintainer ruling 2026-11-28): packs style selection state through `data-*` on the part, before K4.
- R2: a closed, documented list; booleans only, two names; no content, ids or counts.
- R3: no change to behaviour, focus, ARIA or app styling; no change to engine, scope or registries; goldens stay byte-frozen.
- R4: one THEMING.md block, plus a test that keeps the list closed. The constant lives outside the test.
- Out of scope:
  - `[aria-*]` and `[tabindex]` stay refused.
  - Listing `data-on` or `data-open`, and aligning the legacy `''` sites.
  - Q3, F-1 and F-2.

## Approach and stages
| Part | Site | Condition copied from | New attribute |
|---|---|---|---|
| home-task-tab | HomeTasks.svelte:251-254 | `aria-selected={tab === id}` | `data-selected={tab === id ? 'true' : undefined}` |
| chat-row | ShellChatRow.svelte:186-197 | `aria-current={open ? "page" : undefined}` | `data-current={open ? 'true' : undefined}` |
| settings-index-entry | SettingsShellIndex.svelte:89-91 | `aria-current={selected === page.id ? 'page' : undefined}` | `data-current={selected === page.id ? 'true' : undefined}` |
| home-drawer-item | HomeDrawer.svelte:144-145 | `aria-current={item.current ? 'page' : undefined}` | `data-current={item.current ? 'true' : undefined}` |
| studio-segment | StudioDisplayForm.svelte:179-182 | `aria-selected={segment === id}` | `data-selected={segment === id ? 'true' : undefined}` |
| studio-tg-preview-row | StudioTogglePreviewRow.svelte:49 | `data-current={current ? '' : undefined}` | value `'true'`, same condition |

- `settings-index-display` and `home-drawer-settings` (both `data-part-critical`) get nothing (I4).
- **`data-on` on studio-tg-preview-row (`:48`, `''`) is documented, not aligned.** The app has three `data-on` sites (ToggleRow:88, FindBar:131 and this one), all `''`. Aligning just one would mix values within an unlisted name. Whichever slice lists `data-on` aligns all three.
- The constant has no runtime consumer. It holds `STATE_ATTRIBUTE_NAMES = ['data-current','data-selected'] as const`, `STATE_ATTRIBUTES: readonly {part; attribute}[]` (six pairs), and an areaParts-style header naming it the stable pack surface that its test recomputes.
- THEMING.md block `## State attributes a pack may select` covers:
  - the two meanings and the value rule;
  - write `[data-current]`; `="true"` also matches;
  - booleans only, so a later enum such as the Home mockup `data-current="rp|hybrid|utility"` (home.css:211-213) takes another name;
  - `data-on` and `data-open` are reserved;
  - **only the listed pairs are a stable surface; every other `data-*` the validator accepts is internal and may change or disappear;**
  - this list supersedes the mockup audits for the live parts;
  - the chat-row rename gap;
  - a table of part, attribute and meaning.
- Placement (F4): between `## Rules for every mockup` and `## Acceptance re-skins` (THEMING.md:14/15). This keeps clear of K1's regions (about :37-66, :98-106 and :118-121; join-plan-r3.md:50-55, :116-119). Confirm against K1's actual diff.
- Stages:
  - A: the constant and the tests, red on 1eaa6b200 plus the constant.
  - B: the markup.
  - C: THEMING.md, and THEME_AUDIT.md:47 drops only `|false`.

Slice 2 is a follow-up that lane A orders. Its inventory is PARTIAL: only lines with a literal `data-part` were classified. The aria-selected, aria-current and aria-pressed lists carry over from r0. Additions:
- **aria-checked** (21 raw hits in 11 files, CSS included). Radios:
  - toggle-select-option (ToggleRow:105, :123)
  - toggles-picker-option (TogglesPanel:616)
  - chat-sheet-item (PersonaSheet:97-99, PlusSheet:264)
  - row-menu-no-folder, -folder-option and -colour-option (ShellRowMenu:74, :76, :96)
  - studio-tg-preview-option (StudioTogglePreviewRow:68)

  Switches go to `data-on`.
- **aria-expanded** (75 raw hits in 56 files) goes to `data-open`. Not classified.
- **Skipped:** Home `library-views` (aria-pressed, HomeLibrary:47) has no part on its line.
- chat-sheet-item has both aria-checked and aria-pressed, so names follow meaning.

## Expected files
- **Markup, one line each:** the six files in the table.
- **New:** src/ts/themePack/stateAttributes.ts and stateAttributes.test.ts (T7); src/lib/ChatShell/sidebar/ShellChatRow.stateAttr.svelte.test.ts (T2, jsdom).
- **Extended:** HomeTopBar.tasks.background.svelte.test.ts (T1, reusing `tabsOf` and `key`), SettingsShell.nav, HomeDrawer, StudioDisplayForm and StudioTogglePreview tests, hostilePacks.test.ts.
- **Docs:** THEMING.md; home/THEME_AUDIT.md:47, where `"true|false"` becomes `"true"` (the "never an empty attribute" text stays).
- **K1:**
  - Only THEMING.md is shared.
  - K1 J2 edits scope, index and the registries, so re-run T8 after rebasing.
  - T3 and T4 mount harnesses that K1 edits, so re-run them after either merge.
  - Not touched here: K1's other files, including install.svelte.test.ts.
  - Check K1's branch for hostilePacks.
- **Unchanged:**
  - goldens/**, bundled/*.risutheme, theme-packs/*.risutheme, fixtures/packs/**, corpus-golden.txt, docs/design/**/themes/*.css, home.css.
  - The chat and settings THEME_AUDIT files ("present" still holds).

## Invariants and compatibility
- **I1 (no behaviour change).** Grep `data-(current|selected)|dataset\.(current|selected)` over src finds:
  - one markup site;
  - seven test reads, all `hasAttribute`, including StudioToggleCombined:228;
  - two engine inputs (cascadeRules.test.ts:82, themingContract.test.ts:73).

  No app code, app CSS or Tailwind variant reads them.
- **I2 (ARIA unchanged).** ARIA, tabindex, role and class expressions stay byte-identical. The tests assert the ARIA.
- **I3 (same state).** Each condition is copied from the source named in the table. M2 and M8 check this.
- **I4 (an example guard, not the protection).** No element carrying `data-part-critical` or a `CRITICAL_PARTS` part (engine.ts:110) carries a listed attribute. Protection itself already comes from two refusals:
  - critical parts are refused by name (engine.ts:349-352);
  - a part-less subject is refused by Rule SCOPE in every judged area (scope.ts:189, :239, `NO_PART_WHY`, MC-1586). DD-242 only adds a reason for backgrounds.
- **I5 (narrowing).** `[data-part=P][data-current]` matches a subset of P, judged by P's tier (engine.ts:356-358). No part moves, so escapeWalk and areaParts.test are unaffected.
- **I6.** Values are `"true"` or absent. Under MC-3638 inference is a known limitation. No network, write, code or intake path.
- **Goldens frozen:** no corpus entries; judge cases go in hostilePacks.
- **Install verdicts unchanged:**
  - No archive names a slice-1 part with a state attribute (G1 E2).
  - `''` to `'true'` breaks only an exact `[data-current=""]`, and no sheet uses one (G1 d).
- **MC-175/223/350/697:** no persisted data, no format change, no rewrite.

## Acceptance scenarios
- A1: the active Home task tab carries `data-selected="true"`; the other tabs carry none. This holds after a click and after ArrowLeft/ArrowRight. aria-selected and tabindex are unchanged.
- A2: the open chat-row carries `data-current="true"`; other rows carry none. No row carries `data-selected`. aria-selected and aria-current are unchanged.
- A3: the selected settings-index-entry carries `data-current="true"`; the selected settings-index-display carries neither attribute.
- A4: the current home-drawer-item carries `data-current="true"`; home-drawer-settings carries none.
- A5: the active studio-segment carries `data-selected="true"`; studio-tg-preview-row carries `data-current="true"` (was `''`).
- A6: these are accepted and match only the selected or current element:
  - home `[data-part="home-task-tab"][data-selected="true"]{box-shadow:inset 0 3px 0 #4da6ff}`
  - chat `[data-part="chat-row"][data-current]{border-color:#4da6ff}`

  `[tabindex="0"]` and `[aria-current="page"]` stay refused.
- A7: the markup sites equal `STATE_ATTRIBUTES` and every value has the rule's shape. No TS sets a listed attribute, and the THEMING.md table equals the constant.

## Required tests
| id | scenario | class | pre-fix base and expected failure | fixture |
|---|---|---|---|---|
| T1 | A1, A6 | regression reproducer, DESIGNED, NOT DEMONSTRATED | 1eaa6b200: the selected tab's `getAttribute('data-selected')` is null and `matches(home A6)` is false. Unselected tabs: no attribute, no match (passes on base). ARIA passes on base. | HomeTopBar.tasks.background harness (jsdom, real HomeTasks, click, arrows) |
| T2 | A2, A6 | reproducer, DESIGNED, NOT DEMONSTRATED | 1eaa6b200: the open row's `getAttribute('data-current')` is null and `matches(chat A6)` is false. The closed-row checks, "no `data-selected`" and ARIA pass on base. | New jsdom file; mount like the existing ShellChatRow tests, open true and false |
| T3 | A3 | reproducer for the entry, DESIGNED, NOT DEMONSTRATED; the display half is a guard (passes before and after) | base: the entry lacks `data-current` | SettingsShell.nav harness: select a page, then Display |
| T4 | A4 | reproducer, DESIGNED, NOT DEMONSTRATED; the settings-button half is a guard | base: the current item lacks `data-current` | HomeDrawer harness |
| T5 | A5 | reproducer, DESIGNED, NOT DEMONSTRATED | base: the active segment lacks `data-selected` | StudioDisplayForm `tab()` |
| T6 | A5 | reproducer, DESIGNED, NOT DEMONSTRATED | base: `getAttribute('data-current')` is `''`, not `'true'`. The existing `hasAttribute` tests stay as guards. | StudioTogglePreview rows |
| T7 | A7, I4 | reproducer for the closed list, DESIGNED, NOT DEMONSTRATED | Base: 1eaa6b200 plus stateAttributes.ts only. On bare base the failure is the import itself, which does not count. Expected: the recomputed set is {studio-tg-preview-row/data-current}, not the 6 pairs; (b) flags `''`; (e) finds no block. (c) and (d) pass on base (guards). | (a) `svelte/compiler` `parse(...,{modern:true})` over non-test `src/**/*.svelte`, walking elements as homeParts.test.ts does (`svelteFilesUnder` and `readFromDisk` from fixtures/criticalClosure.ts). Record {static `data-part`, attribute} for each name in `STATE_ATTRIBUTE_NAMES`. A listed attribute without a static part is a problem, and so is a spread on a listed part. The set must equal the constant, with no duplicates. (b) Each value is a `ConditionalExpression` with `'true'` and `undefined`. (c) No recorded element is `data-part-critical` or in `CRITICAL_PARTS`, and no constant entry is either. (d) Non-test `src/**/*.ts` and the `.svelte` script text (excluding the constant file) contain no quoted name, `dataset.<name>` or `(set\|toggle\|remove)Attribute(` with a name. (e) The THEMING.md table equals the constant, and the block contains the value-rule and stable-surface sentences. |
| T8 | A6, I4 | compatibility guard (passes before and after; engine unchanged) | not a reproducer | hostilePacks.test.ts `lint(area, css, name)`. Accepted: both A6 selectors. Refused: `[tabindex="0"]` and `[aria-current="page"]` on those parts ("not allowed in a pack selector"); `[data-part="settings-index-display"][data-current]{border-color:#fff}` (protected part); chat `[data-selected]{color:#000}`, expecting `SCOPE_NO_PART` (MC-1586), the reason G1 E1 actually observed |

Component tests use jsdom and the real components; T7 alone scans source. MC-329: no persisted format.

## Mutants to kill
- M1: HomeTasks always renders `'true'`. T1 fails.
- M2: the condition becomes `tab !== id`. T1 fails.
- M3: the chat-row attribute is omitted. T2 and T7 fail.
- M4: chat-row uses `data-selected` (the F1 rule). T2 and T7 fail.
- M5: value `''` at any site. T1, T2 or T6 fails, and T7(b) fails.
- M6: `String(cond)` renders `"false"`. T1 and T2 fail (absent check), and T7(b) fails.
- M7: settings-index-display gets `data-current`. T3, T7(a) and T7(c) fail.
- M8: aria-current is replaced on the entry. T3 fails.
- M9: an unlisted Svelte site (studio-row). T7(a) fails.
- M10: a TS-built site (`toggleAttribute('data-selected', on)` or `dataset.current = 'true'`). T7(d) fails.
- M11: a THEMING.md row is dropped or names the wrong attribute. T7(e) fails.
- M12: the stable-surface sentence is removed. T7(e) fails.
- M13: COMPOUND admits `[tabindex]`. T8 fails (guard mutant).
- M14: the scope `NO_PART_WHY` branch is removed. T8 fails (guard mutant).

## Risks and trade-offs
- Encoding the state as `"true"` or absent drops `"false"` from home THEME_AUDIT:47, and no selector uses `="false"`.
  - `''` would break the Home `="true"` selectors.
  - `"true"`/`"false"` would let the bare form match unselected elements, as StudioLoreTester's `data-active` already does.
- Naming by meaning follows the chat (:121-122) and settings (:83, :85) vocabularies. There is no warning for no-ops until Q3 is answered.
- Legacy `''` sites match only the bare form. They are internal, and slice 2 aligns each site it lists.
- THEMING.md is shared with K1. The placement keeps the edits apart, and lane A sequences the merges.
- T7 flags spreads only on listed parts. No state attribute travels through a spread today.
## Finding dispositions
- F1 SUBSTANTIVE: ADDRESSED with remedy (a). chat-row now takes `data-current`. A2, A6, T2, T8 and M3-M6 follow, M4 pins the change, and Q1 is reworded.
- F2: ADDRESSED. I4 now names Rule SCOPE, and T8 expects `SCOPE_NO_PART`.
- F3: ADDRESSED. T7 checks (a)-(d), and the constant has moved out of the test.
- F4: ADDRESSED with the new placement.
- F5: ADDRESSED. install.svelte.test.ts is named, and T3, T4 and T8 are re-run after the K1 merges.
- F6: ADDRESSED in O-4. `chat-list-row` is in CHAT_PART_NAMES (areaParts.ts:32); src/lib has 0 hits.
- F7: ADDRESSED, aria-expanded added as well.
- F8: ADDRESSED. All five points are applied.
- Advisor: M-1, M-2, M-3 and M-5 ADDRESSED. M-4 became Q3. Strategy points 1-8 adopted.

## Premises
- REOPENED:
  - engine.ts:110, :296, :343, :349-358 and scope.ts:177-182, :189, :239.
  - The six sites.
  - THEME_AUDIT: chat :81, :121-122; settings :83, :85; home :47.
  - The I1 Grep and the `data-on` readers.
  - hostilePacks :307.
  - The precedents: homeParts.test.ts:105-149, criticalClosure.ts:57, areaParts.ts:1-6.
  - THEMING.md headings and join-plan-r3.md:50-55, :116-119.
- INHERITED:
  - From G1 E1 (executed): the verdicts. The chat `[data-current]` verdict is inferred from the grammar.
  - From G1 E2: the archive scan.
  - From the advisor: the legacy value shapes and the 314 names.
  - From precedent: Svelte drops an `undefined` attribute.
  - From the brief: the K4 needs. No sizing packet was given.
## Open items
Lane-A questions for the maintainer:
- **Q1 (names, was O-2).** Recommended: two names by meaning. `data-current` goes on the item the user is in, `data-selected` on the chosen or picked item in a control, and chat-row takes `data-current`. Alternatives: names by ARIA source, as in r0; or one `data-selected` everywhere, which collides with pick states.
- **Q2 (value rule, was O-1).** Recommended: every listed state attribute, including `data-on` and `data-open` once they are listed, is absent when the state is not held and `"true"` when it is held. Never empty, never `"false"`.
- **Q3 (new: allowlist ticket).** Recommended: a separate ticket that restricts selectable `data-*` names to the documented list while every pack is still in the repository. It would decide between refusing and an install note, rule on identity attributes (F-1), and move golden digests. Alternatives:
  - keep the open grammar, with this PR's "accepted is not stable" sentence;
  - decide later, which breaks installed packs.

Further open items:
- **O-3 (slice 2):** choices among options take the two names. `data-on` and `data-open` are listed when a pack needs them, with every site aligned at that point.
- **O-4 (K4):**
  - Retarget `settings-index-item` and `settings-index-link` to `settings-index-entry`, `home-rail-item` to `home-drawer-item`, `studio-side-tab` to `studio-segment` (studio-row after slice 2), and `chat-list-row*` to `chat-row[data-current]`.
  - The Display entry stays unstyled because it is critical.
  - The Home mockup's enum `data-current` must not ship.
- **O-5 (routing):** round 2 goes to a fresh native reviewer; no critical contract changes.
- **F-1 (out of scope):** user-data `data-*` attributes can be matched exactly. This feeds Q3.
- **F-2 (out of scope):** `data-active={entry.activated}` (StudioLoreTester:123) renders `"false"`.
- **Artifacts:** this file only.

## Changes from r0
- chat-row now takes `data-current`; names follow meaning.
- A single value rule; `data-on` and `data-open` are reserved.
- A sentence separating stable names from internal ones.
- The constant now lives outside the test, and T7 checks the AST and TS.
- Rule SCOPE is cited.
- The placement moved.
- The inventory and K4 lists are complete.
- New mutants M4, M10, M12 and M14.
- New open question Q3.
## Addenda after Gate 1 round 2 (APPROVED; five editorial corrections, binding on implementation)
Gate 1 round 2 (opus-reviewer, fresh): no substantive finding. Dispositions:
- N1: `data-on` has FOUR sites: three render `''` (ToggleRow:88, FindBar:131, StudioTogglePreviewRow:48) and PlusSheet.svelte:276 renders `"true"`/`"false"` and is read by app CSS (PlusSheet.svelte:344, `[data-on="true"]`). `data-on` stays unlisted and unaligned in slice 1; a slice that lists it aligns all four and re-runs that CSS reader's test.
- N2: slice 1 agrees with all four audits (chat, settings, home, studio). Divergences for slice 2, to be put to the maintainer with Q1: settings picker row / switcher option and home picker/switcher use `data-current` (in-use option); studio-tree-row uses `data-selected` for the open item (settings/THEME_AUDIT.md:83,179; home:47; studio:55). THEMING.md block says: options and pickers are classed when slice 2 lists them; for LISTED parts the list supersedes the audits.
- N3: home/THEME_AUDIT.md:47 is NOT edited to drop `|false` (the mockup app.js:53,505,506,546,551 does render "false"). Annotate instead: the mockup writes "true|false"; the live app renders "true" or nothing (THEMING.md).
- N4: Q2 must name Studio DD-200 `data-open="true|false"` (studio/THEME_AUDIT.md:118, slice1.js:619, st4.css:101, mockup only). THEMING.md says only that `data-on` and `data-open` are reserved, with no value shape committed until slice 2.
- N5: T7(c) critical set = union of CRITICAL_PARTS and every registry's critical list (engine.ts:194); T7(d) also scans bracket form dataset['current'] / dataset["selected"]; I4 wording: Rule SCOPE gives NO_PART in chat and studio, PART_VALUE for a valued part-less selector elsewhere; K1 J1 also edits registries/settings.ts, registries/studio.ts, SettingsShell.svelte (re-run T3, T8 after rebase).
