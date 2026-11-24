# #438 stage handoff: W3-1 overlay vocabulary (PopupEditor, listedPersona, HypaV3Progress, SavePopupIcon), device rows pending

Branch `claude/438-w3-1`, PR "Refs #438" (PR 1 of 7 of wrap-up W3; the issue stays open). Tier 2, critical contract (first critical root outside the pattern directory). Plan r1 and Gate 1 r1 [EDITORIAL]: six of seven findings applied, finding 2's M4b replaced by G7 (below), finding 6 only as the W3-7 inventory line. Gate 2 r1 [EDITORIAL], five wording fixes applied. Decisions: MC-4160, MC-4164, MC-4165 (the save-problem buttons are critical, tokens only), MC-4166. Base origin/main e2cd1aefa.

## What changed
- Markup only, literal `data-part` attributes (no class, handler, element, order, aria or focus change):
  - PopupEditor: `modal-popup-editor` (root, reach), `modal-frame`, `modal-header`, `modal-controls`, `modal-field`, `modal-action`, `modal-close`, `modal-body`, `modal-footer` (reach), `modal-title`, `modal-text` (safe).
  - listedPersona: `modal-listed-persona` (root), `modal-frame`, `modal-header`, `modal-close`, `modal-row` (reach), `modal-title` (safe).
  - HypaV3Progress: `memory-progress`, `memory-progress-card`, `memory-progress-pill` (reach); `memory-progress-text`, `-bar`, `-bar-fill`, `-subtext`, `-mini` (safe).
  - SavePopupIcon: `save-status-alert` plus `data-part-critical` on the four save-problem buttons (critical, closure root x4); `save-status-note` and `save-status-saving` (safe).
- Census: `OVERLAY_FILES` in `popupsCriticalClosure.test.ts` (explicit list, extended by each later stage); `registries/popups.ts` regenerated `POPUPS_FILES` (20), `POPUPS_PARTS`, `POPUPS_CRITICAL_CLOSURE` (+`save-status-alert`), `POPUPS_REACH`; holders and shared lists unchanged. A1 roots pin has `save-status-alert` four times.
- Vocabulary rule: `modal-<id>` backdrop root; a critical subtree never uses `modal-*` (a name under a critical root is critical everywhere); progress and save status use identity names.

## Tests (class)
- `overlayVocabulary.test.ts` (node): W1-T4 name table, W1-T5a accepts, the W1-T5b protected-part row and the accepted `display:none` on safe `modal-title` (acceptance, fail on the base). The W1-T5b reach-hiding row (`modal-close{display:none}`) passes on the base (display:none never yields the membership reason): guard on the base, acceptance on head (kills a reach demotion). W1-T6a, T6b, T6c are guards (pass before and after).
- `PopupEditor.parts`, `listedPersona.parts`, `HypaV3Progress.parts`, `SavePopupIcon.parts` render tests (acceptance, fail on the base: elements absent).
- `popupsCriticalClosure.test.ts`: under the plan's base (base components plus base registry) only the A1 roots pin and the A1 file-list pin fail. The A8 parts and reach pins and the A1 closure pin follow the census: they fail with base components against the head registry and pass against the base registry.

## Evidence
- Base failures by in-memory serving of origin/main sources (scratch config under %TEMP%, no tracked file swapped): head tests with base components and head registry: 20 of 68 fail; base components and base registry: 47 of 68 fail.
- Mutants M1-M10 killed in memory (killers in code1-report.md). M4 (modal-frame made critical in listedPersona) is killed by the A1/A8/A10 census pins, not by W1-T6a (constants only). Gate 1 finding 2's M4b was not run; the registry-only mutant G7 replaced it (modal-frame added to `POPUPS_CRITICAL_CLOSURE`): W1-T6a, W1-T4 `modal-frame is reach`, W1-T5a and four A1/A8 rows fail, so the hygiene rule fires.
- `pnpm vitest run src/ts/themePack` plus the four components' tests: 81 files, 4530 tests passed before round 2. Corpus golden unchanged. `pnpm check`: 0 errors, 5 pre-existing warnings.

## Known limitations (MC-3638, MC-3639, MC-3659, no guard)
- `save-status-note` (peer-wait `role="status"`) and `save-status-saving` are safe, so a pack may hide them.
- A pack can paint over the persona row's `bg-selected` highlight: `modal-row` is a reach part and takes colour over the themed chat shell.
- The HypaV3Progress pill (fixed top-4 right-4 z-40) overlaps the save-problem button (absolute top-3 right-3 z-10) while a summary runs: pre-existing, unchanged; positioning stays refused on popups.
- The pill sets inline `opacity` on mouse events, so a pack's opacity on `memory-progress-pill` is overridden. PopupEditor keeps `bg-blue-500`/`bg-red-500`; packs repaint through `modal-action` and `modal-close`.

## Device rows (not run; carried to W5 or lane A)
Test pack: chat.css (text, colour mode), settings.css (one shape rule), popups.css giving `modal-frame` an 18px radius and a magenta border, `modal-title` letter-spacing, `memory-progress-pill` a radius and `save-status-saving` padding.
- DV-W31-1: chat shell, pack on, `longPressToPopupEditor` on, long-press the composer; PopupEditor frame shows radius and border, title spacing shows, X closes, Back closes.
- DV-W31-2: chat shell, triple-tap, Persona; listedPersona shows the pack frame; picking a persona switches it and closes the list.
- DV-W31-3: Settings shell open (settings.css themed; first observe the shape rule, Settings masked under own colours, popups overlay off), triple-tap, Persona; frame radius shows (shape), magenta border colour does not.
- DV-W31-4: Home with a pack that has no home.css, triple-tap, Persona; built-in look (MC-3009).
- DV-W31-5: `showSavingIcon` on, edit a message in the chat shell; the saving icon shows the padding. The icon is transient (opacity-15): record this row test-only (Gate 1 finding 4(d)). The save-failure state is not forced on device (W1-T7d and W1-T5b carry it).
- DV-W31-6: safe start with the pack installed, then open PopupEditor and listedPersona; built-in look. Needs the plain-launch control row in the same run (Gate 1 finding 4(b)).
- DV-W31-7: pack-free launch, then rows 1, 2 and 5; pixel-equal to base apart from timing (screenshots against a base APK, or a visual check).
- HypaV3Progress row follows MC-4165 PQ-5 (plain-fetch mock if it serves summaries, else a recorded not-run row). The PC leg is the test run; Note 9 rows fold into W5 unless lane A says otherwise.

## For W3-2 and later
- Reuse the vocabulary table; add each overlay file to `OVERLAY_FILES`, run `popupsCriticalClosure.test.ts`, paste the printed constants into `registries/popups.ts`, update the A1 roots pin and the `overlayVocabulary.test.ts` name table (it asserts the registry's overlay names equal the table).
- The popups registry and census test are serial across W3-2..W3-6: regenerate, never hand-order (path sort).
- Inventory for W3-7: `PartialEditController.svelte` builds two floating wrappers in TS (document.body.appendChild, position fixed, zIndex 1000), the same census gap as the code-block menu. Excluded: the plugin v3 iframe, the drag ghosts, `DefaultChatScreen` (legacy) and `chatCopy.ts` (off-screen textarea).
