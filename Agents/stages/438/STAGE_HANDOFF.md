# #438 stage handoffs: wrap-up W3-3 (this PR) and the merged stages W3-2, W2, W3-1 and W1

Each wrap-up stage adds a section; the one under review is first, the merged ones follow. The sections come from their own PRs and were merged here without dropping any.

## #438 stage handoff: W3-3 Realm family (RealmPopUp, RealmFrame chrome, RealmBlockedCreators), device rows pending

Branch `claude/438-w3-3`, PR "Refs #438" (PR 3 of 7 of wrap-up W3; the issue stays open). Tier 2, no new critical root. Plan r2 (designer), Gate 1 r1 [REJECT] (device rows, fixed in r2) and Gate 1 r2 [EDITORIAL] (reports `%TEMP%/risu-b715/438/w3/w33-g1-r1.md`, `w33-g1-r2.md`); both r2 findings applied (F1: the device pack gets a 2px solid border so the "no magenta" read can fail; F2: MC-4168 and MC-4169 followed). Decisions: MC-4160, MC-4164, MC-4165, MC-4167, MC-4168 (RealmLicense gets no parts and stays out of `OVERLAY_FILES`), MC-4169 (DV-W33-6 not run). Gate 2 r1 [EDITORIAL] by a fresh opus-reviewer, F1 to F3 applied (the RealmPopUp not-run row cites MC-4165 PQ-5, the DV-W33-1 border colour is the default light gray, the Unblock wording; report `%TEMP%/risu-b715/438/w3/w33-g2-r1.md`). Base origin/main c33cfb061 (W3-2 merged).

### What changed
- Markup only, literal `data-part` attributes (23 on RealmPopUp, 4 on RealmFrame, 11 on RealmBlockedCreators), stripped of the attributes each file equals its base blob; no class, handler, element, order, aria, focus or Back change. CRLF kept.
  - New identity roots, all reach: `modal-realm-popup` (backdrop layer), `modal-realm-frame` (full-screen root), `modal-realm-blocked-creators` (backdrop layer).
  - Existing names. Reach: `modal-frame`, `modal-header`, `modal-body`, `modal-footer`, `modal-controls`, `modal-list`, `modal-row`, `modal-action` (forked, Import, Copy, `summary`, Report, Block, Unblock), `modal-close`. Safe: `modal-title`, `modal-text` (author, description heading, tag chips, popularity, three badges, blocked-creator name and id, empty state).
  - RealmFrame's `<iframe>`, its loading container and everything in the iframe document carry no part (no part between iframe and root).
- Census: `OVERLAY_FILES` +3; `registries/popups.ts` regenerated from the printed values: `POPUPS_FILES` 24 to 27, `POPUPS_PARTS` 183 to 186, `POPUPS_REACH` 48 to 51. Only the three new reach names changed; the critical closure, the A1 roots pin, holders and shared-tokens-only are unchanged. Home `FOREIGN` +13 `modal-*` names (RealmPopUp is in the HomeShell closure through RealmMain and brings the names it renders; `modal-realm-blocked-creators` and `modal-row` come from RealmBlockedCreators; `HOME_PARTS` unchanged). No chat, Settings or Studio change.
- Criticality (MC-2947): no new critical root. Block, Report and the agreement go through AlertComp prompts (already critical); Unblock is a direct reversible button, reach.

### Tests (class, true counts)
- New render tests mount the real components, find each element by tag, id, role, aria-label, text or structure (never by its part), assert the part for every name and the DIRECT parent, plus whole-tree outlines: `RealmPopUp.parts` (9: 7 acceptance, 2 guard), `RealmBlockedCreators.parts` (6: 4 acceptance, 2 guard), `RealmFrame.parts` (5, happy-dom: 3 acceptance, 2 guard). Acceptance fail on the base by absence; guards pass before and after.
- `overlayVocabulary.test.ts` (60): 3 new W1-T4 rows plus the table row, 3 new W1-T5a rows (reproducers), 3 new `display:none` reach rows (guards on the base, acceptance on head). `popupsCriticalClosure.test.ts` (18) and `homeParts.test.ts` (8, `FOREIGN` pin: reproducer under both base sets).
- True base counts of the 6 files (106 tests, head tests against base sources served in memory): base components + base registry 23 fail, 83 pass (homeParts 1, overlayVocabulary 7, popupsCriticalClosure 1, RealmPopUp.parts 7, RealmBlockedCreators.parts 4, RealmFrame.parts 3); base components + head registry 17 fail, 89 pass (homeParts 1, popupsCriticalClosure 2, RealmPopUp.parts 7, RealmBlockedCreators.parts 4, RealmFrame.parts 3). Head 106 of 106.

### Evidence and limits
- 20 named in-memory mutants (comment, sibling swap, part swapped with its parent, dropped, renamed, moved inward and outward, part on the iframe, reach demotion, critical marker added, file dropped from the census, a safe name made reach) all killed; scratch config under `%TEMP%`, no tracked file touched. Killers per mutant are in `%TEMP%/risu-b715/438/w3/w33-code-report.md`.
- `pnpm vitest run src/ts/themePack src/lib/UI/Realm src/lib/UI/GUI/MainMenu`: 91 files, 4888 tests passed. `pnpm check`: 0 errors, 5 warnings (none in these files).
- jsdom/happy-dom prove structure, not looks: no device run, no real pack applied. RealmFrame's chrome row (DV-W33-6) is not run (MC-4169): the rendered tests are the evidence.

### Known limitations (MC-3638, MC-3639, MC-3659, no guard)
- A pack may restyle Report, Block and Unblock so they look harmless (colours only over the chat shell) and hide the safe `modal-text` and `modal-title`: author line, tags, badges, a blocked creator's name and id (the row's Unblock button no longer shows which creator it unblocks), and RealmFrame's "Upload to Realm" title.
- A pack may shrink or push RealmFrame's iframe out of view through the root or header box; it cannot overlay it or reach its document (`z-index`, `content`, `transform`, `filter` and fixed or sticky positioning are refused, and every compound needs a part).
- Unclaimed, so no pack hook: RealmPopUp's h1 column, cover image, hidden-image placeholder, details column, description section and container, badge row and `details`; RealmFrame's loading container; RealmBlockedCreators' name column. RealmLicense gets no parts and MultiLangDisplay is shared (MC-4167, MC-4168).
- RealmBlockedCreators is mounted only inside Home: it gets the popups shape subset only (MC-3009).

### Device rows (fold into W5; synthetic data; Note 9; network blocks per live-checks)
Test pack: popups.css `[data-part="modal-frame"]{border-radius:4px;border-width:2px;border-style:solid;border-color:#ff00ff}` and `[data-part="modal-realm-blocked-creators"] [data-part="modal-title"]{letter-spacing:2px}`; home.css one shape rule; chat.css text, colour mode. The built-in panel is `rounded-[18px]` with no border.
- DV-W33-1 RealmBlockedCreators over Home (no Realm traffic): synthetic profile with the upstream agreement NOT accepted, so the Realm view shows its placeholder and sends no request. Trigger: Home's Realm panel title button, then the toolbar "blocked creators" button (shown in every state). Read: empty state, 4px corners, a 2px border in the default border colour (light gray, `--color-gray-200`), NOT magenta, title letters 2px wider. Back and X close, focus returns to the button. A populated list stays test-only (only Block in RealmPopUp fills it, which needs a Realm reply).
- DV-W33-2 same with a pack without home.css: 18px corners, no border, normal title. DV-W33-3 safe start with the pack installed: built-in look, plain-launch control in the same run. DV-W33-4 pack-free launch: pixel-equal to base apart from timing.
- DV-W33-5 RealmPopUp: not run, test-only (MC-4165 PQ-5: `getRealmInfo` and the hub list need a Realm reply). DV-W33-6 RealmFrame: not run, test-only (MC-4169).

### For W3-4 and later
- The popups registry and census test are serial (W3-2 to W3-6): regenerate from the printed constants, never hand-order (`src/lib/UI/Realm/*` sorts after `src/lib/Setting/listedPersona.svelte`).
- Home's `FOREIGN` list in `homeParts.test.ts` now holds 13 `modal-*` names: any later popups name rendered inside the HomeShell closure (RealmPopUp, RealmBlockedCreators) fails that pin until reviewed.
- Lane A fold-ins applied: the `overlayVocabulary.test.ts` header parenthetical now reads "display:none never yields the membership reason", and the W3-2 section below carries its Gate 2 verdict and report paths.

## #438 stage handoff: W3-2 overlay vocabulary (BookmarkList, EasyPanel, LoadoutModal, CustomSidebarConfig), device rows pending

Branch `claude/438-w3-2`, PR "Refs #438" (PR 2 of 7 of wrap-up W3; the issue stays open). Tier 2, no new critical root. Plan r1 (designer) and Gate 1 r1 [EDITORIAL]: all seven findings F1..F7 applied (report `%TEMP%/risu-b715/438/w3/w32-g1-r1.md`). Gate 2 r1 [EDITORIAL] by a fresh opus-reviewer (report `%TEMP%/risu-b715/438/w3/w32-g2-r1.md`): base counts 24/75 and 34/65 reproduced, 20 of 20 mutants killed; four wording or limitation findings applied in commit 21f6868f1 (F1 Run unclaimed, F2 W3-1 trigger note, F3 test title and W3-3 advice, F4 the `modal-text` line). Decisions: MC-4160, MC-4164, MC-4165, MC-4166, MC-4167 (AllSeperateParameters and ClaudeThinkingSeparateParams get no parts: deliberate skips, they also render inline on the Bot Settings page). Base origin/main 45664d42f (W3-1 merged).

### What changed
- Markup only, literal `data-part` attributes on the overlays' own regular elements (no class, handler, element, order, aria or focus change; none on a component tag or inside a shared component):
  - BookmarkList: `modal-bookmark-list` (root), `modal-frame`, `modal-header`, `modal-controls` (x2), `modal-action` (expand-all, Go-to, Rename, Remove), `modal-close`, `modal-list`, `modal-row` (the role=button row), reach; `modal-title`, `modal-text` (heading, empty state, row label), safe.
  - EasyPanel: `modal-easy-panel` (root), `modal-frame`, `modal-header` (the h2: it holds the X, so not `modal-title`), `modal-close`, `modal-body` (models grid, parameters container), `modal-controls` (6 model cells), reach; `modal-text` (beta badge, requirements note, 6 cell labels), safe.
  - LoadoutModal: `modal-loadout` (root), `modal-frame`, `modal-header`, `modal-close`, `modal-controls` (load bar), `modal-action` (4 toggles, Pick, Star, Remove, Save), `modal-body`, `modal-list` (x4), `modal-row` (card), `modal-footer`, `modal-field`, reach; `modal-title`, `modal-text` (Load label, 4 headings, name, meta line, empty state), safe.
  - CustomSidebarConfig: `modal-custom-sidebar-config` (root), `modal-frame`, `modal-list`, `modal-row`, `modal-action` (Delete), `modal-body` (settings submenu), reach; `modal-text` (item label, empty state), safe.
- Census: `OVERLAY_FILES` gains the four paths. `registries/popups.ts` regenerated from the printed values: `POPUPS_FILES` 20 to 24, `POPUPS_PARTS` 178 to 183, `POPUPS_REACH` 43 to 48. New names, all reach: `modal-list`, `modal-bookmark-list`, `modal-easy-panel`, `modal-loadout`, `modal-custom-sidebar-config`. `POPUPS_CRITICAL_CLOSURE` (97), the A1 roots pin, `POPUPS_HOLDERS` and `POPUPS_SHARED_TOKENS_ONLY` are unchanged (no critical marker, no new critical name).
- Criticality (MC-2947): none of the four contains a confirm. Remove (bookmark, loadout), Pick and Delete (with the Undo toast, already critical) are direct buttons in pickers or tool panels: reach, so a pack may restyle but never hide them. Run is the shared Button and carries no part (unclaimed).
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
- A pack may hide the safe `modal-text`, so loadout, bookmark and sidebar-item rows can show no label beside Remove or Delete (MC-3638, no guard).
- Unclaimed, so no pack hook: BookmarkList item container, expanded preview container and the embedded Chat; EasyPanel title text, both SegmentedControls, ModelList triggers, the Run Button, CustomModelsSettings, CheckInput, the by-model branch and all AllSeperateParameters and ClaudeThinkingSeparateParams content (MC-4167); LoadoutModal `<section>` elements and the nested meta spans; CustomSidebarConfig `display: contents` Add wrapper, every `Button` and the TextInput.
- A pack may restyle Remove and Delete so they look harmless, paint over the star's `text-yellow-400`, the toggles' selected classes and the row's `hover:bg-selected`, and cover content inside its own frame.
- EasyPanel's root is a full-screen `pointer-events-none` layer (only the frame takes pointer events). With `modal-easy-panel` on it, a popups pack over the colour-mode chat shell can paint the root opaque and hide the page beneath while taps still land on it; `pointer-events` is refused on reach parts, so a pack cannot make it modal. Covering under MC-3638, no guard.
- EasyPanel's `backdrop-blur-sm` and translucent `bg-bgcolor/80` stay built-in (#751).

### Device rows (not run; fold into W5)
Test pack: chat.css (text, colour mode), settings.css (one shape rule), popups.css giving `modal-frame` an 18px radius and a magenta border, `modal-list` an 8px gap, `modal-row` a radius, and each of the four identity roots a distinct `modal-title` or `modal-header` letter-spacing. Synthetic data only. Pro tools must be on for rows 2 and 3 (Settings, Input, Menu, Pro tools).
- DV-W32-1 BookmarkList, chat shell: a synthetic character with two messages (a seeded synthetic profile or chat import, or two user sends with no provider; the failure card is fine, no reply needed), both bookmarked from the message menu; sidebar More menu, Bookmarks. Read frame radius and border, list gap, row radius; expand a row; X and Back close.
- Trigger note for DV-W31-2..4 (W3-1 section below): "triple-tap" means three fingers down together within 300 ms (`src/ts/hotkey.ts` counts `touchstart` events and resets on every `touchend`), as in DV-W32-4; three sequential taps never open the quick menu.
- DV-W32-2 EasyPanel, chat shell: Pro tools on; Plus sheet, Easy panel. A fresh profile shows the requirements note and Run. Read frame, header spacing, badge, X. Do not press Run.
- DV-W32-3 EasyPanel, Settings shell: Pro tools on; Settings, Advanced page, Easy panel link (shown only on Advanced and only with Pro tools on). Frame radius shows, the magenta border colour does not (shape only).
- DV-W32-4 LoadoutModal, chat shell: put three fingers down together within 300 ms (the hotkey counts touchstarts and resets on every touchend, so three sequential taps never open it; CDP multi-touch can, adb `input tap` cannot); quick menu, Loadout. Type `L1`, Save (appends one loadout); read row, Pick, Star, Remove, footer field. Do not Pick.
- DV-W32-5 CustomSidebarConfig, Settings shell: Settings, Input page, Menu group, Custom sidebar row. Add item, Model; read list and row (shape only). Delete shows the Undo toast (tokens only, unchanged).
- DV-W32-6 Home with a pack that has no home.css: three-finger touch, Loadout. Built-in look (MC-3009).
- DV-W32-7 safe start with the pack installed, then BookmarkList and LoadoutModal: built-in look; run the plain-launch control row in the same run.
- DV-W32-8 pack-free launch, rows 1, 2, 4 and 5: pixel-equal to base apart from timing.

### For W3-3 and later
- The popups registry and census test are serial (W3-2 to W3-6): regenerate from the printed constants, never hand-order (path sort puts `Others/ProTools/EasyPanel.svelte` after `PresetBundlePrompt.svelte`).
- `modal-list` now exists (reach); reuse it for item lists. `modal-title` and `modal-text` stay safe only while they sit on elements with no interactive descendant: one interactive use turns the name reach for every modal. Test with the outline plus each element's direct parent, not a part-first lookup (the outline looks through unparted elements, so a part moved one level onto an unparted parent leaves it unchanged).
- W3-5 adds parts inside `ModelList.svelte`'s own modal subtree; EasyPanel renders ModelList, so those names will appear inside EasyPanel.

## #438 stage handoff: W2 chat sidebar parts done (wrap-up stage 2 of 4)

Branch `claude/438-w2-sidebar`, PR "Refs #438" (the issue stays open; only W5 closes it). Tier 1: markup-only parts plus census, no validator change, no new area, no Studio file. The wrap-up decisions are in `Agents/mc/438-wrapup.md` (MC-4149, MC-4160..4164). This PR follows MC-4161: the chat-shell sidebar's unmarked elements get literal chat parts; the sidebar is part of chat, `sidebar.css` stays a skipped sheet, and no refusal is built.

### What changed
- 40 literal `data-part` values on the new chat-shell sidebar (37 from round 1, 3 folder-row names added in round 2), all in `CHAT_PART_NAMES` (315 to 355 names, sorted):
  - ShellSidebar: `chat-sidebar-heading`, `chat-sidebar-new-row`, `chat-sidebar-new-chat`, `chat-sidebar-new-menu-toggle`, `chat-sidebar-new-menu`, `chat-sidebar-import`, `chat-sidebar-export-all`, `sidebar-sort-label`, `sidebar-sort-help`.
  - SidebarMoreMenu: `more-header`, `more-back`, `more-title`, `more-character-settings`, `more-playground`, `more-bookmarks`, `more-branches`, `more-dev-tool`, `more-plugin-item`.
  - ShellRowMenu: `row-menu-rename`, `row-menu-move`, `row-menu-no-folder`, `row-menu-folder-option`, `row-menu-new-folder`, `row-menu-duplicate`, `row-menu-export`, `row-menu-delete`, `row-menu-folder-rename`, `row-menu-folder-colour`, `row-menu-colour-option`, `row-menu-folder-delete`.
  - ShellChatRow: `chat-row-name-line`, `chat-row-meta`, `chat-row-actions`.
  - ShellSidebarSearch: `chat-sidebar-search-box`, `chat-search-character-name`, `chat-search-chat-name`, `chat-search-chat-preview`.
  - ShellChatList (folder rows, round 2; twins of the chat-row parts): `chat-folder-actions` (move cluster in Edit order, twin `chat-row-actions`), `chat-folder-count` (the chat count), `chat-folder-editing` (rename wrapper, twin `chat-row-editing`).
- No class, role, aria, ordering, handler or style change. The in-component `[data-part="row-menu"] button` rules are untouched; a pack selector does not reliably outrank or lose to them (extra `[data-*]` compounds and `!important` win over them), so nothing in this PR relies on either order. `sidebar-settings` and the escape-route and escape-ancestor names are untouched.
- Class: none of the 40 is in `REACH_CHAT` or `SAFE_LEAVES`, so all take the default reach tier like their sidebar neighbours. The reach tier refuses everything off its allowlist (for example `display:none`, positioning, `opacity:0` and `visibility:hidden`; `font-size:0` is refused by the font-size value check, MC-1549/1555, and `4px` installs with a note); recolour and respace are accepted. Adding a name to those lists would need a matching edit of `docs/design/chat/checks/th/packlint.mjs` (parity test); that stays out of this PR.
- Skipped on purpose (no part, none of them a control or user-readable text a pack needs to address): the `role=presentation` windowing spacers (chat list and search results, structural), the sort wrapper div around the sort select (structural), the search icon (decorative), the label spans inside the More menu and footer rows and the sidebar `home`/`settings`/`more` footer labels (the parent buttons carry parts; the label sits inside them), and the RecentStrip avatar ring span (state decoration, not text or control).
- Tests: `src/ts/themePack/sidebarParts.test.ts` (245 cases, node: census/class/disjointness plus the `?raw` source-inventory scans, retitled "source inventory": they do not prove placement) and two rendered files that mount the real components and assert each part sits on the intended element by tag, role, `data-action`, text or position: `src/lib/ChatShell/sidebar/ShellSidebar.parts.svelte.test.ts` (13 cases: ShellSidebar, chat list and folder rows, chat rows, search, row menus) and `SidebarMoreMenu.parts.svelte.test.ts` (3 cases).

### Evidence
- Round 2 run: `pnpm vitest run src/ts/themePack src/lib/ChatShell/sidebar src/lib/ChatShell/chatPartsStable.test.ts`: 91 files, 4961 tests passed (corpus golden unchanged); `pnpm check` result in the PR body.
- Round 1 coder run: `pnpm check` 0 errors; `pnpm vitest run src/lib/ChatShell/sidebar src/lib/SideBars src/lib/ChatShell/chatPartsStable.test.ts src/ts/themePack`: 181 files, 6164 tests passed; after the review's one-space fix, sidebarParts plus the sidebar tests: 17 files, 446 passed. The corpus golden is unchanged.
- Base proof without touching tracked files (an in-memory config serves the seven changed sources at origin/main e2cd1aefa; 261 new cases, 139 fail and 122 pass on that base). Failing on the base: census membership 40, reach tier 40, source-inventory literal 40, rendered placement 16, known-limitation 3. Passing before and after (guards, not reproducers): "named by a rendered test" 40 (test-text inventory), not critical/escape/safe 40, no other area 40, name-list and escape-entry 2. `areaParts.test.ts` (7) passes on the base because it recomputes from the served source. Round 1 had said 148 of 187; the correct base number for that set was 111, and the markup-literal family never was a guard on the base (it fails there).
- Mutants (in-memory transform config, no tracked file touched): M4 (a part moved into an HTML comment: `row-menu-delete`, `more-back`) passes all 245 `sidebarParts.test.ts` cases and fails 3 rendered cases; M5 (`row-menu-delete` and `row-menu-export` swapped) passes all 245 and fails 2 rendered cases. Round 3 (lane A's M9 and M14, parent/child swaps): `chat-sidebar-search-box` with its parent `chat-sidebar-search` swapped, and `chat-sidebar-new-row` with `chat-sidebar-header` swapped, passed all 261 before; the rendered tests now assert the nearest part-carrying ancestor of every nested part (header, new row, new menu, search box and field, chat row lines, folder rows, search result texts, every row-menu item and option, More header, Back and title) and M9 fails 1 case, M14 fails 2. No other undetected swap was found among the nested pairs (siblings differ by tag, text or `data-action`, which the placement tests assert).
- Independent Sonnet review of round 1 (adversarial-reviewer): [EDITORIAL], one missing space in `ShellRowMenu.svelte` (fixed); it confirmed markup-only, unique literals, no collisions, sound classification deviation, and ran targeted vitest (453 passed). Round-2 independent re-review: APPROVE (`%TEMP%/risu-b715/438/w2/review2.md`); its known limitation: the rendered coverage test in `ShellSidebar.parts.svelte.test.ts` depends on file order: it fails under `-t` and can fail under shuffle.
- Not run: Note 9 rows. The sidebar change is markup only; the sidebar rows fold into the W5 integration run (MC-4162).

### Known limitations (MC-3638, no guard)
- A pack can now recolour and respace sidebar buttons, including the row-menu delete items.
- `row-menu-delete` and `row-menu-folder-delete` are restylable and keep their protected confirm (unchanged). `chat-sidebar-export-all` is restylable and has no confirm: a hijacked tap starts the export. The reach tier refuses everything off its allowlist (`display:none`, positioning, `opacity:0`, `visibility:hidden`; `font-size:0` is refused by the font-size value check, MC-1549/1555, and `4px` installs with a note), but a transparent colour, `clip-path` and `width:0` (installed with notes) and an empty positioned `::after` cover (`inset:-4000px`) still install, as on the existing this-chat-delete part (compatibility test "known limitation" in `sidebarParts.test.ts`).
- The sr-only `sidebar-sort-label` is restylable (it can be made visible or odd-looking; hiding it is refused).
- The minor unmarked items above (label spans, RecentStrip avatar ring, sort wrapper) stay skipped.

### For W5 (device row, Note 9, synthetic data)
With the new chat shell on and the standard chat theme (the sidebar shows with both), install a pack with rules on `chat-sidebar-new-chat`, `more-back` and `row-menu-delete` (a distinct background colour on each; use `!important` on `row-menu-delete`, because the scoped row-menu button rule outranks a plain background), open the sidebar, press More for `more-back`, and open a chat row menu for `row-menu-delete`: the three elements show the pack's rule.

### Docs changed in this PR (after the W1 docs merge)
- `docs/design/THEMING.md` "Chat sidebar." paragraph (formerly a "Not covered yet" bullet), `docs/wiki/Theme-Packs.md` and `Agents/Theme-Packs.md` status now say the chat sidebar parts ship with this PR.
- `docs/design/THEMING.md` DD-149 sentence "any sheet with a danger button is protected by default" is rewritten: a prompt is protected when the census marks it critical, and a menu item that leads to one (the row-menu delete) is an ordinary part with the confirm unchanged. A fresh doc-verifier read these passages on a hashed snapshot (`%TEMP%/risu-b715/438/w2/snap-r2/SHA256.txt`, report `verify-r2.md`): 14 of 16 claims CONFIRMED, 2 minor wording or unverifiable counts, none blocking.

### Open for the next stages / lane A
- W3 (overlay parts) is sized in `%TEMP%/risu-b715/438/w3/plan-r1.md`; W3-7 edits `areaParts.ts` and `engine.ts`, so it starts after this PR merges.
- W1 docs (PR 756) is merged. Reports: `%TEMP%/risu-b715/438/w2/` (brief.md, code-report.md, code-report2.md, review.md, review2.md).

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
- Base failures by in-memory serving of origin/main sources (scratch config under %TEMP%, no tracked file swapped): head tests with base components and head registry: 20 of 68 fail; base components and base registry: 47 of 68 fail in the coder run; lane A's independent run with base markup and base registry gives 46 failed and 5 passed, which supersedes it.
- Mutants M1-M10 killed in memory (killers in code1-report.md). M4 (modal-frame made critical in listedPersona) is killed by the A1/A8/A10 census pins, not by W1-T6a (constants only). Gate 1 finding 2's M4b was not run; the registry-only mutant G7 replaced it (modal-frame added to `POPUPS_CRITICAL_CLOSURE`): W1-T6a, W1-T4 `modal-frame is reach`, W1-T5a and four A1/A8 rows fail, so the hygiene rule fires.
- `pnpm vitest run src/ts/themePack` plus the four components' tests: 81 files, 4530 tests passed before round 2. Corpus golden unchanged. `pnpm check`: 0 errors, 5 pre-existing warnings.

### Known limitations (MC-3638, MC-3639, MC-3659, no guard)
- `save-status-note` (peer-wait `role="status"`) and `save-status-saving` are safe, so a pack may hide them.
- A pack can paint over the persona row's `bg-selected` highlight: `modal-row` is a reach part and takes colour over the themed chat shell.
- The HypaV3Progress pill (fixed top-4 right-4 z-40) overlaps the save-problem button (absolute top-3 right-3 z-10) while a summary runs: pre-existing, unchanged; positioning stays refused on popups.
- The pill sets inline `opacity` on mouse events, so a pack's opacity on `memory-progress-pill` is overridden. PopupEditor keeps `bg-blue-500`/`bg-red-500`; packs repaint through `modal-action` and `modal-close`.

More known limitations found by lane A's check of PR 760 (same class, no guard):
- A chat sheet that sets `--nexus-danger` to the canvas colour paints the save-problem button invisible (existed before; contrast notes only).
- While the HypaV3 progress shows, a popups pack can cover the save-problem button through the `memory-progress*` parts (padding, a positioned `::before`, an opaque overlay).
- The built-in pill covers about 36x36 of the 40x40 save-problem button and takes its taps while a summary runs (pre-existing; a follow-up ticket is filed by lane A).
- A positioned pseudo-element on `modal-*` chrome can cover PopupEditor's close button and the persona rows (the Back handling and the safe start remain).
- A pack can fake an alarm by painting the saving icon red but cannot fake text.
- Unclaimed elements (no part): PopupEditor's preview toggle, language chip, Toggles panel and loading placeholder; HypaV3Progress's spinner ring.
- Weak render rows: a `modal-text`/`modal-footer` swap is caught only by the census pins; `save-status-saving`, `memory-progress-bar`, `modal-field` and `modal-action` are checked by existence, nesting or tag only.

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
