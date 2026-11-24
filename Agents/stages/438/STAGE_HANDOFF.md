# #438 stage handoff: wrap-up W3-2 (this PR), the merged W3-1 and the merged stage W1

Each wrap-up stage adds a section; the section under review is first, the merged stages follow. The sections come from their own PRs and were merged here without dropping any.

## #438 stage handoff: W3-2 overlay vocabulary (BookmarkList, EasyPanel, LoadoutModal, CustomSidebarConfig), device rows pending

Branch `claude/438-w3-2`, PR "Refs #438" (PR 2 of 7 of wrap-up W3; the issue stays open). Tier 2, no new critical root. Plan r1 (designer) and Gate 1 r1 [EDITORIAL]: all seven findings F1..F7 applied (below). Decisions: MC-4160, MC-4164, MC-4165, MC-4166, MC-4167 (AllSeperateParameters and ClaudeThinkingSeparateParams get no parts: deliberate skips, they also render inline on the Bot Settings page). Base origin/main 45664d42f (W3-1 merged).

### What changed
- Markup only, literal `data-part` attributes on the overlays' own regular elements (no class, handler, element, order, aria or focus change; none on a component tag or inside a shared component):
  - BookmarkList: `modal-bookmark-list` (root), `modal-frame`, `modal-header`, `modal-controls` (x2), `modal-action` (expand-all, Go-to, Rename, Remove), `modal-close`, `modal-list`, `modal-row` (the role=button row), reach; `modal-title`, `modal-text` (heading, empty state, row label), safe.
  - EasyPanel: `modal-easy-panel` (root), `modal-frame`, `modal-header` (the h2: it holds the X, so not `modal-title`), `modal-close`, `modal-body` (models grid, parameters container), `modal-controls` (6 model cells), reach; `modal-text` (beta badge, requirements note, 6 cell labels), safe.
  - LoadoutModal: `modal-loadout` (root), `modal-frame`, `modal-header`, `modal-close`, `modal-controls` (load bar), `modal-action` (4 toggles, Pick, Star, Remove, Save), `modal-body`, `modal-list` (x4), `modal-row` (card), `modal-footer`, `modal-field`, reach; `modal-title`, `modal-text` (Load label, 4 headings, name, meta line, empty state), safe.
  - CustomSidebarConfig: `modal-custom-sidebar-config` (root), `modal-frame`, `modal-list`, `modal-row`, `modal-action` (Delete), `modal-body` (settings submenu), reach; `modal-text` (item label, empty state), safe.
- Census: `OVERLAY_FILES` gains the four paths. `registries/popups.ts` regenerated from the printed values: `POPUPS_FILES` 20 to 24, `POPUPS_PARTS` 178 to 183, `POPUPS_REACH` 43 to 48. New names, all reach: `modal-list`, `modal-bookmark-list`, `modal-easy-panel`, `modal-loadout`, `modal-custom-sidebar-config`. `POPUPS_CRITICAL_CLOSURE` (97), the A1 roots pin, `POPUPS_HOLDERS` and `POPUPS_SHARED_TOKENS_ONLY` are unchanged (no critical marker, no new critical name).
- Criticality (MC-2947): none of the four contains a confirm. Remove (bookmark, loadout), Pick, Delete (with the Undo toast, already critical) and Run are direct buttons in pickers or tool panels: reach, so a pack may restyle but never hide them.
- Settings, Home and chat census: unchanged. The four files are imported only by `App.svelte`. `settingsOrigin.ts` reads `data-part` (opener capture, `restoreOpenerFocus` fallback): it matches any name generically, so no new name changes it; the effect (focus lands on another element with the opener's part when the opener was unmounted) is the same as for the W3-1 names.

### Tests (class, true counts)
- New render tests mount the real components, find each element by tag, text, aria-label, placeholder or structure (never by its part), and assert the part, the parent and a whole-tree outline of the part nesting: `BookmarkList.parts` (7), `EasyPanel.parts` (7), `LoadoutModal.parts` (9, four sections rendered), `CustomSidebarConfig.parts` (7). `acceptance:` tests fail on the base by absence; `guard:` tests (behaviour, no part on shared Buttons and unclaimed elements) pass before and after.
- `overlayVocabulary.test.ts` (51 tests): 5 new name rows and the table row (reproducers, fail on the base registry), 5 new W1-T5a accept rows (reproducers), 5 new `display:none` reach rows (guards on the base, acceptance on head: they kill a reach demotion), the W1-T6 rules (guards).
- `popupsCriticalClosure.test.ts` (18): the file-list pin fails against the base registry; the A8 parts and reach pins follow the census (fail with base components against the head registry, pass against the base registry). True base counts of the 6 files (99 tests): base components + head registry 24 fail, 75 pass; base components + base registry 34 fail, 65 pass. Head 99 of 99.

### Evidence and limits
- Base and mutants served in memory from a scratch vitest config under %TEMP% (no tracked file swapped). 28 mutants (the plan's 11, corrected, plus comment, sibling-swap, parent-swap, drop and rename variants) all killed; killers per mutant are in the coder report `w32-code-report.md`. Corrections to the plan: M5 is killed by the A1 closure rows, A8 holders and A10 (W1-T6a reads constants, not markup); M11 by W1-T4, the new `modal-easy-panel` hiding row and the A8 reach pins, not the plan's W2-T4b.
- `pnpm vitest run src/ts/themePack` plus the 20 compatibility test files that mount the four components: 92 files, 4671 tests passed. `pnpm check`: 0 errors, 5 warnings (none in these files).
- jsdom proves structure, not looks: no device run, no real pack applied.

### Known limitations (MC-3638, MC-3639, MC-3659, no guard)
- Unclaimed, so no pack hook: BookmarkList item container, expanded preview container and the embedded Chat; EasyPanel title text, both SegmentedControls, ModelList triggers, the Run Button, CustomModelsSettings, CheckInput, the by-model branch and all AllSeperateParameters and ClaudeThinkingSeparateParams content (MC-4167); LoadoutModal `<section>` elements and the nested meta spans; CustomSidebarConfig `display: contents` Add wrapper, every `Button` and the TextInput.
- A pack may restyle Remove and Delete so they look harmless, paint over the star's `text-yellow-400`, the toggles' selected classes and the row's `hover:bg-selected`, and cover content inside its own frame.
- EasyPanel's root is a full-screen `pointer-events-none` layer (only the frame takes pointer events). With `modal-easy-panel` on it, a popups pack over the colour-mode chat shell can paint the root opaque and hide the page beneath while taps still land on it; `pointer-events` is refused on reach parts, so a pack cannot make it modal. Covering under MC-3638, no guard.
- EasyPanel's `backdrop-blur-sm` and translucent `bg-bgcolor/80` stay built-in (#751).

### Device rows (not run; fold into W5)
Test pack: chat.css (text, colour mode), settings.css (one shape rule), popups.css giving `modal-frame` an 18px radius and a magenta border, `modal-list` an 8px gap, `modal-row` a radius, and each of the four identity roots a distinct `modal-title` or `modal-header` letter-spacing. Synthetic data only. Pro tools must be on for rows 2 and 3 (Settings, Input, Menu, Pro tools).
- DV-W32-1 BookmarkList, chat shell: a synthetic character with two messages (a seeded synthetic profile or chat import, or two user sends with no provider; the failure card is fine, no reply needed), both bookmarked from the message menu; sidebar More menu, Bookmarks. Read frame radius and border, list gap, row radius; expand a row; X and Back close.
- DV-W32-2 EasyPanel, chat shell: Pro tools on; Plus sheet, Easy panel. A fresh profile shows the requirements note and Run. Read frame, header spacing, badge, X. Do not press Run.
- DV-W32-3 EasyPanel, Settings shell: Pro tools on; Settings, Advanced page, Easy panel link (shown only on Advanced and only with Pro tools on). Frame radius shows, the magenta border colour does not (shape only).
- DV-W32-4 LoadoutModal, chat shell: put three fingers down together within 300 ms (the hotkey counts touchstarts and resets on every touchend, so three sequential taps never open it; CDP multi-touch can, adb `input tap` cannot); quick menu, Loadout. Type `L1`, Save (appends one loadout); read row, Pick, Star, Remove, footer field. Do not Pick.
- DV-W32-5 CustomSidebarConfig, Settings shell: Settings, Input page, Menu group, Custom sidebar row. Add item, Model; read list and row (shape only). Delete shows the Undo toast (tokens only, unchanged).
- DV-W32-6 Home with a pack that has no home.css: three-finger touch, Loadout. Built-in look (MC-3009).
- DV-W32-7 safe start with the pack installed, then BookmarkList and LoadoutModal: built-in look; run the plain-launch control row in the same run.
- DV-W32-8 pack-free launch, rows 1, 2, 4 and 5: pixel-equal to base apart from timing.

### For W3-3 and later
- The popups registry and census test are serial (W3-2 to W3-6): regenerate from the printed constants, never hand-order (path sort puts `Others/ProTools/EasyPanel.svelte` after `PresetBundlePrompt.svelte`).
- `modal-list` now exists (reach); reuse it for item lists. `modal-title` and `modal-text` stay safe only while they sit on elements with no interactive descendant: one interactive use turns the name reach for every modal. Test with `outline`-style nesting assertions, not a part-first lookup.
- W3-5 adds parts inside `ModelList.svelte`'s own modal subtree; EasyPanel renders ModelList, so those names will appear inside EasyPanel.

## #438 stage handoff: W3-1 overlay vocabulary (PopupEditor, listedPersona, HypaV3Progress, SavePopupIcon), device rows pending

Branch `claude/438-w3-1`, PR "Refs #438" (PR 1 of 7 of wrap-up W3; the issue stays open). Tier 2, critical contract (first critical root outside the pattern directory). Plan r1 and Gate 1 r1 [EDITORIAL]: six of seven findings applied, finding 2's M4b replaced by G7 (below), finding 6 only as the W3-7 inventory line. Gate 2 r1 [EDITORIAL], five wording fixes applied. Decisions: MC-4160, MC-4164, MC-4165 (the save-problem buttons are critical, tokens only), MC-4166. Base origin/main e2cd1aefa.

### What changed
- Markup only, literal `data-part` attributes (no class, handler, element, order, aria or focus change):
  - PopupEditor: `modal-popup-editor` (root, reach), `modal-frame`, `modal-header`, `modal-controls`, `modal-field`, `modal-action`, `modal-close`, `modal-body`, `modal-footer` (reach), `modal-title`, `modal-text` (safe).
  - listedPersona: `modal-listed-persona` (root), `modal-frame`, `modal-header`, `modal-close`, `modal-row` (reach), `modal-title` (safe).
  - HypaV3Progress: `memory-progress`, `memory-progress-card`, `memory-progress-pill` (reach); `memory-progress-text`, `-bar`, `-bar-fill`, `-subtext`, `-mini` (safe).
  - SavePopupIcon: `save-status-alert` plus `data-part-critical` on the four save-problem buttons (critical, closure root x4); `save-status-note` and `save-status-saving` (safe).
- Census: `OVERLAY_FILES` in `popupsCriticalClosure.test.ts` (explicit list, extended by each later stage); `registries/popups.ts` regenerated `POPUPS_FILES` (20), `POPUPS_PARTS`, `POPUPS_CRITICAL_CLOSURE` (+`save-status-alert`), `POPUPS_REACH`; holders and shared lists unchanged. A1 roots pin has `save-status-alert` four times.
- Vocabulary rule: `modal-<id>` backdrop root; a critical subtree never uses `modal-*` (a name under a critical root is critical everywhere); progress and save status use identity names.

### Tests (class)
- `overlayVocabulary.test.ts` (node): W1-T4 name table, W1-T5a accepts, the W1-T5b protected-part row and the accepted `display:none` on safe `modal-title` (acceptance, fail on the base). The W1-T5b reach-hiding row (`modal-close{display:none}`) passes on the base (display:none never yields the membership reason): guard on the base, acceptance on head (kills a reach demotion). W1-T6a, T6b, T6c are guards (pass before and after).
- `PopupEditor.parts`, `listedPersona.parts`, `HypaV3Progress.parts`, `SavePopupIcon.parts` render tests (acceptance, fail on the base: elements absent).
- `popupsCriticalClosure.test.ts`: under the plan's base (base components plus base registry) only the A1 roots pin and the A1 file-list pin fail. The A8 parts and reach pins and the A1 closure pin follow the census: they fail with base components against the head registry and pass against the base registry.

### Evidence
- Base failures by in-memory serving of origin/main sources (scratch config under %TEMP%, no tracked file swapped): head tests with base components and head registry: 20 of 68 fail; base components and base registry: 47 of 68 fail.
- Mutants M1-M10 killed in memory (killers in code1-report.md). M4 (modal-frame made critical in listedPersona) is killed by the A1/A8/A10 census pins, not by W1-T6a (constants only). Gate 1 finding 2's M4b was not run; the registry-only mutant G7 replaced it (modal-frame added to `POPUPS_CRITICAL_CLOSURE`): W1-T6a, W1-T4 `modal-frame is reach`, W1-T5a and four A1/A8 rows fail, so the hygiene rule fires.
- `pnpm vitest run src/ts/themePack` plus the four components' tests: 81 files, 4530 tests passed before round 2. Corpus golden unchanged. `pnpm check`: 0 errors, 5 pre-existing warnings.

### Known limitations (MC-3638, MC-3639, MC-3659, no guard)
- `save-status-note` (peer-wait `role="status"`) and `save-status-saving` are safe, so a pack may hide them.
- A pack can paint over the persona row's `bg-selected` highlight: `modal-row` is a reach part and takes colour over the themed chat shell.
- The HypaV3Progress pill (fixed top-4 right-4 z-40) overlaps the save-problem button (absolute top-3 right-3 z-10) while a summary runs: pre-existing, unchanged; positioning stays refused on popups.
- The pill sets inline `opacity` on mouse events, so a pack's opacity on `memory-progress-pill` is overridden. PopupEditor keeps `bg-blue-500`/`bg-red-500`; packs repaint through `modal-action` and `modal-close`.

### Device rows (not run; carried to W5 or lane A)
Test pack: chat.css (text, colour mode), settings.css (one shape rule), popups.css giving `modal-frame` an 18px radius and a magenta border, `modal-title` letter-spacing, `memory-progress-pill` a radius and `save-status-saving` padding.
- DV-W31-1: chat shell, pack on, `longPressToPopupEditor` on, long-press the composer; PopupEditor frame shows radius and border, title spacing shows, X closes, Back closes.
- DV-W31-2: chat shell, triple-tap, Persona; listedPersona shows the pack frame; picking a persona switches it and closes the list.
- DV-W31-3: Settings shell open (settings.css themed; first observe the shape rule, Settings masked under own colours, popups overlay off), triple-tap, Persona; frame radius shows (shape), magenta border colour does not.
- DV-W31-4: Home with a pack that has no home.css, triple-tap, Persona; built-in look (MC-3009).
- DV-W31-5: `showSavingIcon` on, edit a message in the chat shell; the saving icon shows the padding. The icon is transient (opacity-15): record this row test-only (Gate 1 finding 4(d)). The save-failure state is not forced on device (W1-T7d and W1-T5b carry it).
- DV-W31-6: safe start with the pack installed, then open PopupEditor and listedPersona; built-in look. Needs the plain-launch control row in the same run (Gate 1 finding 4(b)).
- DV-W31-7: pack-free launch, then rows 1, 2 and 5; pixel-equal to base apart from timing (screenshots against a base APK, or a visual check).
- HypaV3Progress row follows MC-4165 PQ-5 (plain-fetch mock if it serves summaries, else a recorded not-run row). The PC leg is the test run; Note 9 rows fold into W5 unless lane A says otherwise.

### For W3-2 and later
- Reuse the vocabulary table; add each overlay file to `OVERLAY_FILES`, run `popupsCriticalClosure.test.ts`, paste the printed constants into `registries/popups.ts`, update the A1 roots pin and the `overlayVocabulary.test.ts` name table (it asserts the registry's overlay names equal the table).
- The popups registry and census test are serial across W3-2..W3-6: regenerate, never hand-order (path sort).
- Inventory for W3-7: `PartialEditController.svelte` builds two floating wrappers in TS (document.body.appendChild, position fixed, zIndex 1000), the same census gap as the code-block menu. Excluded: the plugin v3 iframe, the drag ghosts, `DefaultChatScreen` (legacy) and `chatCopy.ts` (off-screen textarea).

## #438 stage handoff: W1 docs done (wrap-up stage 1 of 4)

Branch `claude/438-w1-docs`, PR "Refs #438" (the issue stays open; only W5 closes it). Docs and one help string; no validator or markup change. The previous stages are merged: S3c-B popups (PR 743), Home (PR 748).

### Why this wrap-up exists
The maintainer chose "audit first, then ask" (MC-4148). The W0 audit (and W0b) found gaps against the acceptance sentence of #438; the maintainer answered them (MC-4149, MC-4160..4164, `Agents/mc/438-wrapup.md`):
- Effects (MC-2942) move to ticket #751, which must land before #654's Terran Eclipse, Aqua Halo and Elemental Ivory; #438 closes without them (MC-4149).
- W2: the missing chat-sidebar parts; the sidebar is part of chat, `sidebar.css` stays a skipped sheet, no refusal is built (MC-4161).
- W3: theme parts for the 11 App-level overlays plus six groups found below App level, the code-block menu and SavePopupIcon (MC-4160, MC-4164), sized by an Opus designer into several PRs.
- Acceptance reads "when the new screens are on"; built-in packs stay chat-only until #654; docs now; one closeout Note 9 run, W5, whose PR closes #438 (MC-4162, MC-4163).

### What changed in W1
- `docs/design/THEMING.md`: new section "What a pack covers today" (the five applied areas, held colours, popups overlays, when a pack shows, safe start, installing, author limits, what is planned); stale walls corrected or deleted against `engine.ts`, the install rule rewritten as refused versus notes (`failclosed.ts`, MC-3421), the calibration file name fixed, the stale absolute path replaced.
- `Agents/Theme-Packs.md`: status section 2026-11-24; the blur fallback line says no mechanism exists yet (#751); Motion and Blur columns marked not available yet.
- `docs/wiki/Theme-Packs.md` (new, plain user page) and a link line in `docs/wiki/_Sidebar.md`.
- `src/ts/themePack/goldens/README.md`: one sentence that popups.css and sidebar.css are not part of the frozen goldens (MC-4161).
- `themePackRowHelp` (en.ts and the 7 locales): restyles chat, Studio, Settings and Home and the popups over them; the preview switches; Home needs no switch; colours on chat only.
- Records: `Agents/mc/438-wrapup.md` (MC-4149, MC-4160..4164) and MC-4148 in `Agents/mc/438-home.md`.

### Evidence
- Docs written by a Sonnet doc-writer from the W0 audit (`%TEMP%/risu-b715/438/w0/`) and checked by a fresh doc-verifier (`%TEMP%/risu-b715/438/w1/verify.md`): the new section, the wiki page, the status section and `themePackRowHelp` were CONFIRMED against source; the verifier's amendments to THEMING.md (walls, contract list, file name) were applied in a second round, and the orchestrator re-read the engine lines it cites (engine.ts:468, 470, 562-564).
- Round 3 (after lane A's independent check of head 5b1a5e31a: the size-floor item, the overlay lists, editorial items and the records wording) was read by a third, fresh doc-verifier on a hashed snapshot (`%TEMP%/risu-b715/438/w1/snap3b/SHA256.txt`, report `verify3.md`): all changed passages CONFIRMED against source except one records wording (MC-4161 named MC-2944 wrongly; fixed). The MC-4161 disposition of the PR 743 leftover is marked as a session disposition, and the lane A instruction lines in MC-4164/4165 are separated from what the maintainer chose.
- Line endings of the locale files: the translator reports CRLF kept. Locale parity and the ThemePackRow tests: 57 passed (translator's run).
- Two claims of the writing brief were wrong and the docs state source instead: the `:root` core-token rule governs the default scheme colours only; the em refusal applies only to size tokens with a floor or ceiling.

### Open for the next stages / lane A
- W2 (sidebar parts, Tier 1) runs in its own worktree `438-w2-sidebar`; W3 (overlay parts, Tier 2) is being sized by an Opus designer; W5 (closeout run) last.
- Studio hooks stay held. #751 (effects) and the release-switch ticket are outside #438.
- Plans, audits and reports: `%TEMP%/risu-b715/438/` (`w0/`, `w1/`, `w2/`, `w3/`, `wrapup-proposal.md`).
