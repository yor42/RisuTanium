# #438 stage handoffs: W5 integration run and closeout (this PR) and the merged stages W3-7, W3-6b, W3-6a, W3-5, W3-4, W3-3, W3-2, W2, W3-1 and W1

Each wrap-up stage adds a section; the one under review is first, the merged ones follow. The sections come from their own PRs and were merged here without dropping any.

## #438 stage handoff: W5 integration run and closeout

Branch `claude/438-w5`, PR "Closes #438" (the last #438 stage). Tier 1, records and docs plus the packlint mirror; no application code. Base `B` = c5dd8bc7a (main after PR 857). Decisions MC-4570 to MC-4575 (`Agents/mc/438-w5.md`); also MC-4147, MC-4160, MC-4164, MC-4165, MC-4166, MC-4169, MC-4183, MC-4210, MC-4211, MC-4214, MC-3009, MC-3638, MC-3874, MC-1666. Plan r1 (designer): `%TEMP%/risu-b715/438/w5/w5-plan-r1.md`. Scratch run folders under `%TEMP%/risu-b715/438/w5/`: `pack/` (D1), `pc/` (PC leg), `run/` (Note 9 leg: n0- to n4-result.md, screenshots by row id, `adb-commands.log`, censuses, `signers.txt`), `side-findings.md`.

### What changed
- `docs/design/chat/checks/th/packlint.mjs`: the mirror catches up with W3-7 (MC-4571): `CRITICAL_PARTS` gains `chat-partial-delete`, `REACH_CHAT` gains `chat-partial-buttons`, `chat-partial-start-edit`, `chat-partial-start-delete`, `chat-code-menu`, `chat-code-menu-copy`, `chat-code-menu-download`.
- `src/ts/themePack/escapeRoute.test.ts` (TA-2): the mirror holds every engine `CRITICAL_PARTS` and `REACH_CHAT` name (subset, not equality). Regression reproducer: on the base mirror it fails naming `chat-partial-delete`; mutant M2 (drop `chat-code-menu-download` from the mirror's `REACH_CHAT`) fails it too, run through temporary untracked copies. `vitest run src/ts/themePack`: 77 files, 5080 tests pass.
- `docs/design/THEMING.md`: the overlay bullet leaves "Not covered yet"; a new **Overlays** paragraph states the W3 coverage. `docs/wiki/Theme-Packs.md`: the effects line now says what #751 built (OS reduce-motion and reduce-transparency fallback only; no layering) and the popups line names what is still unparted. `Agents/Theme-Packs.md`: the overlay clause says overlays carry parts.
- `Agents/mc/438-w5.md`: MC-4570 to MC-4575.

### Build and devices
- Debug APK of `B` built in the detached worktree `438-w5-apk` (no source copies; the gitignored generated Android files copied in; status and diff empty before the build; after it only the CRLF rewrite of `AndroidManifest.xml` and `gradlew`), SHA-256 `0cf20eb745e5a47d929fc91f16b4fad9364b4fbe3cae375c1f52984e7a22f04a`, pinned as `w5/apk/dv438w5-c5dd8bc-debug.apk`.
- Note 9 phone 2 (`2ac80128013f7ece`), lease `t438-w5-phone`, synthetic profile seeded through the app UI only, Wi-Fi off throughout, CDP network block read back before any step. The installed build had a throwaway `CN=risu-test` signer; the MC-3874 uninstall and install were used and both digests recorded. Released `--clean`: the end census equals the start census.
- PC leg: the production dist of `B` (from the same build) on a scratch Node server, Chrome through `launch-chrome.mjs` with the host blocks and the closed proxy, `mock-openai.mjs`. The proxy refused the app's own model-data refresh to `openrouter.ai` and `raw.githubusercontent.com` (8 requests); nothing reached a RisuAI, Realm or Discord host.
- Test packs (scratch, `zipPack` plus the real intake, D1): `DV438W5` main and no-Home accepted with notes, the critical pack refused for naming `chat-partial-delete`. A v2 main pack corrected the settings rule (W5-23).

### Results
Verdicts are the session's, from the runners' result files and the screenshots it opened.

| Row | Source rows | Platform | Verdict | Evidence |
|---|---|---|---|---|
| PC0 control | live-checks control | PC | PASS | pc-result.md, pc0.png |
| PC1 to PC3 | DV-W37-1 to -3 | PC | PASS | pc1.png, pc2-before/after.png, pc3.png |
| PC4 | DV-W37-4 (`{{char}}` failed modal) | PC | PASS | pc4.png |
| PC5 | DV-W37-5 | PC | PASS: delete confirm built-in while siblings are magenta; No keeps, Yes removes the range | pc5-confirm.png, pc5-after.png |
| PC6 | DV-W37-6 | PC | PASS: refused, "names the protected part chat-partial-delete" | pc6.png |
| PC7 | DV-W37-7 PC half | PC | PASS (the shell's message sheet opens over the menu: #861) | pc7-main.png, pc7-main-esc.png, pc7-none.png |
| PC8 | DV-W37-9 | PC | PASS: legacy and `?nothemepack` built-in; control repeat magenta | pc8-*.png |
| W5-0 | DV-P method (MC-4147) | Note 9 | PASS: real DocumentsUI pick; held line names settings.css | n0-result.md, p1.png to p3.png, w5-0-outcome.txt |
| W5-1 | control | Note 9 | PASS | w5-1.png |
| W5-2 | W2 sidebar | Note 9 | PASS | w5-2a/b.png |
| W5-3 to W5-5 | DV-W31-1, DV-W31-2, DV-W32-1 | Note 9 | PASS | w5-3*.png, w5-4.png, w5-5*.png |
| W5-6 | DV-W32-2, DV-W35-1 | Note 9 | PASS (one Back closes the list and the panel together) | w5-6a to c.png |
| W5-7 to W5-12 | DV-W32-4, DV-W34-1, DV-W34-2, DV-W36a-1 to -4 | Note 9 | PASS | n1-result.md, w5-7a to w5-12.png |
| W5-13 to W5-15 | DV-W36b-1 to -3 | Note 9 | PASS | n2-result.md |
| W5-16 | DV-W36b-4 | Note 9 | PASS after setting the auxiliary model to the mock | w5-16a to e.png |
| W5-17 | DV-W36b-5 | Note 9 | PASS: title, empty text, four Index groups; Rebuild and the toggles are present by design (W3-6b), none pressed | w5-17a/b.png |
| W5-18 | DV-W36b-6 | Note 9 | PASS: trace tiles, rows 10px | w5-18.png |
| W5-19 | W3-1 HypaV3Progress | Note 9 | PASS on rerun: pill 4px with HypaV3's experimental implementation (the only path that opens the pill); observer capture, the screenshots missed it | n3-result.md |
| W5-20 | DV-W31-5 | Note 9 | PASS: padding 6px in the chat shell (8px over classic Settings, where no pack applies) | w5-20a.png |
| W5-21 | DV-W37-7 phone half | Note 9 | PASS: magenta with the pack, theme colours with None; the message sheet covers the menu (#861) | w5-21a to e.png |
| W5-22 | DV-W37-8 | Note 9 | PASS | w5-22.png |
| W5-23 | DV-W31-3 | Note 9 | PASS on rerun with v2 (`settings-section-heading` 3px, colour held); the first run's rule named `settings-section-title`, which no element carries (#862) | n4-result.md, w5-23v2a.png |
| W5-24 to W5-27 | DV-W32-3, DV-W32-5, DV-W35-2, DV-W35-3 | Note 9 | PASS (SHAPE reads with the New Settings preview on) | n3-result.md |
| W5-28 | DV-W35-4 | Note 9 | `studio-title` PASS; the preset, Advanced, model-field leg NOT RUN: its only route, the Studio link on the Prompt settings page, did not render on the phone (the link's target resolved to none; cause not traced), so the W3-5 rendered tests stand (MC-4570, by its 'state the device cannot hold' clause) | w5-28a.png |
| W5-29 | DV-W33-1 | Note 9 | PASS: empty state, SHAPE read, title 8px, focus returns | n3-result.md |
| W5-30 | DV-W34-3 | Note 9 | PASS | w5-30.png |
| W5-31 | DV-W31-4, DV-W32-6, DV-W33-2 | Note 9 | PASS: built-in over Home without home.css | n3-result.md |
| W5-32 | control | Note 9 | PASS | n4-result.md |
| W5-33 | all stage safe-start rows | Note 9 | PASS: 0 pack style elements, banner shown, still 0 after None | w5-33*.png |
| W5-34 | all stage pack-free rows | Note 9 | PASS: every recorded value equals W5-33 | w5-34*.png |

Not run: DV-W34-6 IrisModal (nothing opens it, MC-4210); DV-W33-6 RealmFrame (MC-4169, MC-4183); DV-W33-5 RealmPopUp (needs a Realm reply, MC-4570); W5-28's Studio preset leg (above; the route exists in source but its link did not render).

Method deviation: the W3-1 and W3-2 rows said "pixel-equal to base". W5 compared built-in computed values between the safe-start and pack-free legs instead (every stage proved its markup-only diff by strip-equality to the base blobs); no pre-W3 APK was built.

Input routes, recorded per row in the result files: CDP DOM clicks and `Input.dispatchTouchEvent` on the playground (MC-1666); long presses through the guard's `input swipe` (CDP touch does not raise `contextmenu`); the quick menu over Settings by a synthetic Ctrl+E, because the three-finger touch does nothing there; the W5-33 and W5-34 code menus by a synthetic `contextmenu` event.

Guard log (`run/adb-commands.log`): no policy refusal (no exit 89, 93, 95 or 97); 8 usage errors (exit 2, a call completed once without its `--`) and 15 locate misses (exit 6, element out of view, retried after scrolling). One runner saw the lease token in its own tool output because a dispatch file held it; it was written nowhere else, the dispatch files were redacted, and the lease ran to a clean release.

PC-leg deviations (`pc/pc-result.md`): the web build shows no usePlainFetch toggle and the requests reached the mock directly; the provider URL was the full loopback path; the app language was switched to English; Send needed a `chat-send` click.

Phone end state: the pinned APK, the synthetic profile, pack None, the three preview switches off, colour scheme Default, the run's toggles off. Not restored: the auxiliary model (the original Google model is no longer selectable; it reads Custom API), the chat persona (P2) and the five Easy Panel settings that "Run" sets.

### Leftovers

| Leftover | Source | Disposition |
|---|---|---|
| packlint mirror behind W3-7 | W3-7 | fixed here (MC-4571) |
| Effects wiki line stale | #751 | fixed here (MC-4571) |
| Stale overlay "planned" doc lines | W1 docs | fixed here |
| Rendered coverage test depends on file order | W2 review | #860 (MC-4572) |
| Code-block menu covered by the shell's message sheet | W5 PC7, W5-21 | #861 (MC-4573) |
| `SETTINGS_SAFE` names `settings-section-title` | W5-23 | #862 (MC-4574) |
| Iris Reset has no confirm | W3-4 | accepted, no ticket (MC-4211) |
| Category Delete, tag Remove, bulk Apply had no confirm | W3-6a, W3-6b | discharged by #818 (PR 829) |
| Per-card reroll Apply has no confirm | W3-6a | known limitation, no ticket |
| Progress pill covers the save-problem button | W3-1 | fixed by #764 (PR 776, 19ddfcfad); the W3-1 limitation lines are superseded |
| One Back closes ModelList and EasyPanel together | W5-6 | observation, merged behaviour; no ticket |
| Two partial-edit button wrappers after repeated hovers | PC5 | observation, unverified; no ticket |
| Settings focus-return fallback | W3-6a | known limitation, benign |
| `438-w5-apk` worktree | W5 | listed for removal (destructive cleanup, asked; delete its jniLibs link first) |

## #438 stage handoff: W3-7 PartialEditController modals, TS-built partial-edit buttons and code-block menu, device rows pending

Branch `claude/438-w3-7`, PR "Refs #438" (last stage of wrap-up W3; the issue stays open). Tier 2, **changes the chat critical list**. Decisions MC-4148 to MC-4169 (MC-4164, MC-4166 order the code-menu theme classes), MC-4210 to MC-4215, MC-2947, MC-2941, MC-3009, MC-3638, MC-3639, MC-3659, MC-3660; no new MC entries (the stage-3 ruling follows MC-4164 and MC-4166). Gates (reports under `%TEMP%/risu-b715/438/w3/`): plan r1 `w37-plan-r1.md`; Gate 1 r1 [EDITORIAL] `w37-g1-r1.md` (F1 to F8 applied by the coder); Gate 2 r1 [EDITORIAL] by a fresh opus-reviewer `w37-g2-r1.md` (E1 to E3 applied). Base c811768da (W3-6b merged).

### What changed
- `PartialEditController.svelte`: 39 literal `data-part` attributes on the four modals (selection, failed, delete confirm, edit) plus 3 `setAttribute('data-part', ...)` calls in `createButton` for the TS-built wrapper and its two buttons (the block and drag wrappers share them). With every attribute and those 3 lines removed (line endings normalised) the file equals its base blob; still all CRLF.
- `observer.svelte.ts`: 3 `setAttribute('data-part', ...)` lines for the code menu and its Copy and Download options. Stage 3 (MC-4164, MC-4166, ruled in scope by the orchestrator): colour classes only, `bg-gray-800 -> bg-darkbg`, `border-gray-700 -> border-darkborderc`, `text-gray-300 -> text-textcolor`, `hover:bg-gray-700 -> hover:bg-selected`; layout classes unchanged.
- Names by class. Critical root: `chat-partial-delete` (the inline delete confirm, `data-part-critical`); inside it only the existing protected `chat-critical-header`, `-title`, `-body` (x2), `-action` (x2). Default reach (21): `chat-partial-scrim`, `-match`, `-failed`, `-edit`, `-header`, `-title`, `-count`, `-list`, `-option`, `-option-meta`, `-confidence`, `-context`, `-option-text`, `-actions`, `-cancel`, `-dismiss`, `-message`, `-meta`, `-hint`, `-field`, `-save`. Registry-only, `REACH_CHAT` (6, TS-built): `chat-partial-buttons`, `-start-edit`, `-start-delete`, `chat-code-menu`, `-copy`, `-download`. No safe leaf.
- Unclaimed (rendered and asserted unparted): the delete overlay, the delete meta, hint and confidence, the delete button row, every icon and label span, the selection line and method spans, the inline SVGs of the TS buttons, and any element inside the code menu beyond its two options.
- **Critical-list change.** `engine.ts`: `CRITICAL_PARTS` +`chat-partial-delete` (so every area refuses a selector naming it: "names the protected part chat-partial-delete", proved for chat, popups, settings, home and studio); `REACH_CHAT` +6; rule-2 and rule-4 header comments updated. `SAFE_LEAVES` unchanged.
- **Census.** `areaParts.ts`: CHAT_PARTS 355 -> 383 (+28), `SHARED_CHAT_PARTS` 2 -> 26, registry-only names 23 -> 27. Values inserted by hand at their sorted positions (the counts above are from the file; `areaParts.test.ts` equals the recomputation with `missing` and `extra` empty). No other area's census or registry changed.

### Tests (class, true counts)
- New: `partialEditParts.test.ts` (node, 161: reproducers, guards and diagnostic pins), `PartialEditController.parts.svelte.test.ts` (jsdom, 14: R1 to R6 acceptance incl. both TS wrappers, 7 guards), `observer.codeMenu.parts.test.ts` (jsdom, 5: 3 acceptance, 2 guard). 180 new tests plus the 7 of `areaParts.test.ts`: all pass on head.
- True base (head tests against the HEAD sources of the four app files served in memory): 107 fail, 80 pass of 187 (of the new tests 107 fail, 73 pass; the 73 are 70 guards, 2 diagnostic pins (the user row hidden or made invisible, and the user-row transform) and 1 reproducer-labelled shape that passes on base because it names `chat-critical-action`).

### Evidence and limits
- 29 named in-memory mutants, one child process each with its own `MUT` env and applied-id log, scratch config under `%TEMP%`, tracked files untouched: all 29 killed, each run printed its own id. Per-mutant record: `%TEMP%/risu-b715/438/w3/scratch/w37-code/mutant-results.txt` (first sweep) and `results/*.json` plus `sweep2.txt` (final sweep).
- Targeted vitest (`src/ts/themePack`, `src/lib/ChatScreens`, `src/ts/observer*`, `criticalParts`, `observerProducerMarkup`, `ChatShell.layoutStacking`): 186 files, 6302 tests pass; `src/lib/ChatShell` plus `BookmarkList`: 178 files, 1890 pass. `pnpm check`: 0 errors, 5 warnings (none in these files).
- jsdom proves structure, not looks: no device run, no real pack applied.

### Known limitations (MC-3638, MC-3639, MC-3659, no guard)
- User rows: the confirm renders inside every message row, so `[data-part="chat-message"][data-role="user"]{display:none}` or `{opacity:0}` (accepted) hides the row with an open confirm. With `opacity:0` the row stays hit-testable and the body-level buttons stay visible, so the confirm opens invisible: a tap on its invisible Yes deletes the range, any other tap cancels. The confirm itself cannot be named. `[data-role="user"] [data-part="<non-critical partial name>"]` takes the safe tier.
- An effects transform on `[data-part="chat-message"][data-role="user"]` re-anchors every fixed partial-edit overlay to the user row (pre-existing).
- Non-critical names, including the Delete trigger `chat-partial-start-delete`, accept a transparent colour, clip-path, `width:0` and a covering `::after`; the confirm stays refused.
- Inherited text properties from `chat-message` (`font-family`, `font-style`, `font-weight`, `letter-spacing`, `text-transform`) reach the unclaimed text inside the confirm (hint, Yes and No labels); colour and size do not (the scoped rules set them).
- The component's scoped class rules outrank a plain `[data-part]` rule, so a pack needs `!important` for colours; the lint says nothing about it (the plain-paint rule was removed, MC-2370).
- Open BookmarkList over the colour-mode chat shell: chat.css also restyles the partial-edit layers in its expanded legacy rows (restyle only).
- The message actions sheet opens alongside the code menu (context menu not stopped; inferred, DV-W37-7 records it).
- The TS-built elements are named only through `REACH_CHAT` and the DOM tests; a later TS element with no name is unseen.
- `docs/design/chat/checks/th/packlint.mjs` keeps the old `CRITICAL_PARTS` and `REACH_CHAT` (O-2, not edited): no test compares them beyond the escape names.

### Leftovers
- Update the `docs/design` packlint mirror (`CRITICAL_PARTS` +`chat-partial-delete`, `REACH_CHAT` +6) in whichever stage next edits packlint.

### Device rows (fold into W5; synthetic data; every-target network block up; PC leg first, Note 9 only for touch)
Pack fixture: chat.css setting magenta (with `!important`) on `chat-partial-scrim`, `-edit`, `-match`, `-failed`, `-save`, `-cancel`, `-option`, `-buttons`, `-start-edit`, `-start-delete`, `chat-code-menu`, `-copy`, `-download`; chat preview switch on, colour mode. The Settings shell rows are "Hover to edit part of a message" (Input page, Edit group; "Needs a mouse") and "Select text to edit part of it".
- DV-W37-1 PC: turn on "Hover to edit part of a message"; hover a paragraph of a synthetic reply: buttons in pack colours.
- DV-W37-2 PC: Edit on a unique paragraph, Save: edit modal in pack colours, text changes once.
- DV-W37-3 PC: a reply repeating one paragraph; Edit, then Delete: selection list in pack colours.
- DV-W37-4 PC: a reply whose data is `{{char}}` alone; hover, Edit: failed modal in pack colours, else not-run (R6 is the evidence).
- DV-W37-5 PC: Delete on a unique paragraph; No, then Delete and Yes: confirm keeps its built-in look while siblings are magenta; No keeps the text, Yes removes the range.
- DV-W37-6 PC: install a pack with `[data-part="chat-partial-delete"]{border-radius:4px}`: refused at install, "names the protected part chat-partial-delete".
- DV-W37-7 PC, then Note 9: right-click (PC), long-press (Note 9) a code block; with a pack the menu is in pack colours, with none in theme colours. Record whether the message action sheet also opens.
- DV-W37-8 Note 9: turn on "Select text to edit part of it"; select at least 5 characters: drag buttons in pack colours.
- DV-W37-9 PC: the same pack over the legacy chat, then the `?nothemepack` URL flag (the PC safe start; "Start without theme pack" is the Android launcher's): built-in everywhere; DV-W37-1 is the control row in the same run.

### For W5
- Fold DV-W37-1 to -9 with the W3-6 rows; no row needs a provider reply (MC-4165 PQ-5 does not apply). Not run on the Fold 7 or the Tab S9.
- The new `chat-partial-delete` name is refused in every area, so a W5 pack fixture must not name it except in DV-W37-6.

## #438 stage handoff: W3-6b category and tag managers, bulk bar and result, ChroMemoryModal and its tabs, device rows pending

Branch `claude/438-w3-6b`, PR "Refs #438" (PR 7 of 8 of wrap-up W3 after the MC-4215 split; the issue stays open). Tier 2, no new critical root. Decisions MC-4213, MC-4214, MC-4215 (W3-6a records in `Agents/mc/438-w3-6.md`); also MC-2947, MC-3009, MC-3638, MC-3639, MC-3659, MC-3660, MC-4165. Gates (reports under `%TEMP%/risu-b715/438/w3/`): plan r1 `w36b-plan-r1.md`; Gate 1 r1 [EDITORIAL] `w36b-g1-r1.md` (E1 to E5 applied by the coder, E3 included); Gate 2 r1 [EDITORIAL] `w36b-g2-r1.md` (F1 to F5 applied: mutant record, Rebuild wording, unclaimed list, one test header). Base c27c0c8e1 (W3-6a merged).

### What changed
- Markup only: 121 literal `data-part` attributes (17 category manager, 17 tag manager, 10 bulk-edit-actions, 11 bulk-resummary-result, 8 ChroMemoryModal, 27 index tab, 31 last-send tab). With every attribute stripped (line endings normalised) each file equals its base blob; all stay CRLF. No class, handler, element, order, aria, focus or Back change.
  - New identity roots, reach: `modal-chro-memory` (the `fixed inset-0 z-40` scrim), `modal-hypa-v3-category-manager` and `modal-hypa-v3-tag-manager` (each manager's scrim). Existing names elsewhere: `modal-frame`, `modal-header`, `modal-title`, `modal-controls`, `modal-action`, `modal-field`, `modal-list`, `modal-row`, `modal-body`, `modal-footer`, `modal-text` and the other names already in the vocabulary.
  - The bulk bar and result take ordinary reach parts inside the HypaV3 frame (MC-4213), never a critical root. ChroMemoryModal and its tabs carry parts on their own elements, never on `Check` or `Button`.
  - Unclaimed (no pack hook): ChroMemoryModal's wrapper div around the frame, the translation wrapper in the bulk result, every lucide icon and component tag, the token meter and its fill, the six line rows and their spans, the item and lore item header divs, the lore `section`, the Rebuild wrapper div, and the `CheckInput` and `Button` internals. Each is rendered and asserted unparted in the render tests.
- Census: `OVERLAY_FILES` +7; `registries/popups.ts`: `POPUPS_FILES` 36 to 43, `POPUPS_PARTS` 192 to 195, `POPUPS_REACH` 57 to 60. Values inserted by hand at their sorted positions, not pasted; the A1 file pin and A8 parts and reach pins equal the census. Critical closure, roots pin, holders and shared tokens-only are unchanged. `overlayVocabulary.test.ts` gains 3 names, 4 W1-T5a rows and 3 hide names.

### Tests (class, true counts)
- New render tests (jsdom, real components, find each element by tag, text, aria-label, role or structure, assert the part and its DIRECT parent, whole-tree outlines): `managers.parts` (10: 8 acceptance, 2 guard), `bulk.parts` (8: 6 acceptance, 2 guard), `HypaV3Modal.nested.parts` (4: 3 acceptance, 1 guard), `ChroMemoryModal.parts` (8: 7 acceptance, 1 guard).
- Extended: `overlayVocabulary.test.ts` (90), `popupsCriticalClosure.test.ts` (18). Head: 138 of 138 across the 6 files.
- True base counts (head tests against the c27c0c8e1 sources served in memory): base components + base registry 32 fail, 106 pass; base components + head registry 26 fail, 112 pass. The new footer W1-T5a row passes on base and head: a guard.

### Evidence and limits
- 103 named in-memory mutants (dropped, swapped, renamed and misplaced parts, parts on component tags, reach demotion, files dropped from the census). 99 killed; M67 to M70 (a part on a component tag with no rest props) survive as expected: nothing renders. The coder's parallel run shared one `$env:MUT`, so its per-mutant record is not evidence; the valid record is the Gate 2 reviewer's per-process rerun (103 applied, 99 killed, M67 to M70 survive, base 32/26): `results.json` under the Gate 2 scratch `mut` folder named in `%TEMP%/risu-b715/438/w3/w36b-g2-r1.md` (Artifacts). Scratch config under `%TEMP%`, no tracked file touched.
- `vitest run src/ts/themePack src/lib/Others/HypaV3Modal src/lib/Others/MemoryModalHost src/lib/Others/ChroMemoryModal .parts.`: 120 files, 5322 tests pass. `pnpm check`: 0 errors, 5 warnings (none in these files).
- jsdom proves structure, not looks: no device run, no real pack applied.

### Known limitations (MC-3638, MC-3639, MC-3659, no guard)
- A pack may restyle the category Delete, tag Remove and bulk Apply and Cancel (reach buttons); it cannot hide them. Their confirms stay in AlertComp's critical prompt. ChroMemoryModal's Rebuild is the shared `Button` and carries no part: it gets only what its `modal-controls` group passes on, a pack cannot hide that group, and Rebuild has no confirm because it drops only an in-memory index.
- A pack may hide the safe names (titles, labels, counts, empty and notice texts). It cannot hide the frames, headers, bodies, lists, controls or fields.
- The three identity roots sit on fixed full-viewport scrims: over the colour-mode chat shell a pack may recolour them, even opaque, so they cover the chat while open.
- Inherited text properties set on `modal-frame`, `modal-row` or `modal-controls` reach the unclaimed text inside, including lucide icon colour.
- A part on a component tag with no rest props renders nothing and no census sees it (M67 to M70).
- The per-card reroll Apply still has no confirm (see W3-6a leftovers).

### Leftovers
- The MC-4214 leftover (category Delete, tag Remove and bulk re-summary Apply without a confirm) is discharged by #818 (PR 829, MC-4430, issue closed); all three now ask through `alertConfirm` and their parts are unchanged.

### Device rows (fold into W5; synthetic data; Note 9; every-target network block up for the whole run)
Test pack as in the W3-6a rows plus popups.css rules for the three new roots as listed in the plan. Order rows 1 to 4 before row 5 (E2a): switch the engine back to HypaV3 V3 in `OtherBotSettings` before re-running row 1. Read the sticky bulk bar in row 3 (E2c).
- DV-W36b-1 Categories: purple frame, 12px rows; add "Synthetic A", Save; Delete shows the critical confirm, Cancel keeps the row. Never confirm.
- DV-W36b-2 a card's "+ Tag": 8px field; add `alpha`; Remove shows the critical confirm; Cancel keeps the tag.
- DV-W36b-3 Bulk edit: 16px bar corners; tick two cards, Cancel clears.
- DV-W36b-4 Re-summarize needs a provider reply: MC-4165 PQ-5 plain-fetch mock, read the panel, Apply, critical confirm, Cancel; otherwise a not-run ruling.
- DV-W36b-5 engine to ChroMemory, Plus sheet "ChroMemory Modal": title 2px wider, "Last send" empty text, Index tab with four groups. No toggles, no Rebuild.
- DV-W36b-6 trace views after one message with the network block up; tiles only if the engine publishes a trace, else PQ-5 or a not-run ruling.
- DV-W36b-7 safe start with the pack, then rows 1 and 5: built-in look; pack-free launch: no visible difference.

### For W3-7 and W5
- W3-7 starts from the merged 6b values (`POPUPS_FILES` 43, `POPUPS_PARTS` 195, `POPUPS_REACH` 60) and regenerates the same registry and census tests.
- W5 folds DV-W36a and DV-W36b rows into one run; the rows need a provider reply or a ruling for DV-W36b-4 and -6.

## #438 stage handoff: W3-6a HypaV3Modal, modal-header, modal-summary-item and modal-footer, device rows pending

Branch `claude/438-w3-6`, PR "Refs #438" (PR 6 of 8 of wrap-up W3 after the MC-4215 split; the issue stays open). Tier 2, no new critical root. Decisions MC-4213, MC-4214, MC-4215 (record in `Agents/mc/438-w3-6.md`); also MC-4160, MC-4164, MC-4165, MC-4167, MC-4168, MC-2947, MC-3009, MC-3638, MC-3639, MC-3659, MC-3660. Gates (reports under `%TEMP%/risu-b715/438/w3/`): plan r1 `w36-plan-r1.md` (6a part); Gate 1 r1 [EDITORIAL] `w36a-g1-r1.md` (F1 to F7 applied by the coder brief); Gate 2 r1 [REJECT] `w36a-g2-r1.md` (F1: translation wrapper unasserted, fixed in B8, X16 killed; F2 to F4 wording applied), Gate 2 r2 [APPROVE] `w36a-g2-r2.md`. Base f283d0cb8 (W3-5 merged).

### What changed
- Markup only: 72 literal `data-part` attributes (12 on HypaV3Modal, 15 on modal-header, 37 on modal-summary-item, 8 on modal-footer). With every attribute stripped (line endings normalised) each file equals its base blob; all four stay all CRLF. No class, handler, element, order, aria, focus, Back, z-index or transition change.
  - New identity root, reach: `modal-hypa-v3` (the fixed scrim layer). Existing names: reach `modal-frame`, `modal-header`, `modal-body`, `modal-controls`, `modal-action`, `modal-field`, `modal-close`, `modal-list`, `modal-row`, `modal-footer`; safe `modal-title`, `modal-text`.
  - Placed on: layer, frame, header, title, controls, the header and card actions, close, dropdown list, body, conversion card and button, search bar, field, counter and prev/next, the cards (row, checkbox, number, category chip, tag chips, badges, controls, text areas, rerolled controls) and, in the connected messages, the chip list and chips and the labels, text areas and error spans of the expanded message and the two footers with their labels, preview and error spans.
  - Unclaimed (no pack hook): HypaV3Modal's wrapper, conversion inner div, search layout divs, form and sr-only span; the `WindowedSegment` root and item wrappers (a spacer is never rendered under the test geometry; the guard for the shared component is the expected-files list, `git diff --stat`); the header's `div.relative` and dropdown inner div; the card's header row, left group, badge wrapper, every panel wrapper and the count span; every lucide icon and component tag. MemoryModalHost has no regular element: no attribute, not on `OVERLAY_FILES`.
- Census: `OVERLAY_FILES` +4; `registries/popups.ts`: `POPUPS_FILES` 32 to 36, `POPUPS_PARTS` 191 to 192, `POPUPS_REACH` 56 to 57 (only `modal-hypa-v3` and the four files). The values were inserted by hand at their sorted positions, keeping the file's wrapping, not pasted: the A1 file pin and the A8 parts and reach pins equal the census (the three failing pins were run first and printed exactly these additions). Critical closure, A1 roots pin (14), holders (2) and shared tokens-only (9) are unchanged. `overlayVocabulary.test.ts` gains `modal-hypa-v3: 'reach'`, two W1-T5a rows and the W1-T5b hide row.
- No Settings EXEMPT, Home `FOREIGN`, chat or Studio census change: `settingsParts`, `settingsCriticalClosure`, `homeParts`, `areaParts`, `studioCriticalClosure` pass unchanged. The only importer of `MemoryModalHost` is `App.svelte`.
- Criticality (MC-2947): no new critical root. Reset (two confirms), Delete this (one), Delete after (two), Import from and Export to lorebook (one each) go through AlertComp's critical `ask`, unchanged.

### Tests (class, true counts)
- New render tests mount the real modal (real `WindowedSegment`, real windowing geometry hook, real `$state` DB) and the real card, find each element by tag, aria-label, text, placeholder, id or structure (never by its part), assert the part and its DIRECT parent, plus whole-tree outlines: `HypaV3Modal.parts` (15: 11 acceptance, 4 guard) and `modal-summary-item.parts` (14: 11 acceptance, 3 guard). Guards cover unparted elements, Close, frame click, Reset, Convert, Delete this and after, the star, Apply and the tag chip.
- Extended: `overlayVocabulary.test.ts` (80), `popupsCriticalClosure.test.ts` (18).
- True base counts (head tests of these 4 files, 127 tests, against the f283d0cb8 sources served in memory): base components + base registry 27 fail, 100 pass (each render file 11, overlayVocabulary 4, popupsCriticalClosure 1); base components + head registry 24 fail, 103 pass (render 11 and 11, popupsCriticalClosure 2, overlayVocabulary 0). Head 127 of 127.

### Evidence and limits
- 30 named in-memory mutants (swaps, dropped, renamed and misplaced parts, a part on the `WindowedSegment` tag and inside the shared `WindowedSegment.svelte`, reach demotion, critical marker, files dropped from the census). 29 killed; M8 (a part on the `ModalSummaryItem` tag) survives as expected: the component takes no rest props, so nothing renders. The census cannot see `<svelte:element>` or component tags, so only the render tests guard the `WindowedSegment` root and item wrappers (M9 inside `src/lib/UI/Windowed/WindowedSegment.svelte`, M7 on its tag). Scratch config under `%TEMP%`, no tracked file touched. Killers in `%TEMP%/risu-b715/438/w3/w36a-code-report.md`.
- `vitest run src/ts/themePack src/lib/Others/HypaV3Modal src/lib/Others/MemoryModalHost src/lib/Others/ChroMemoryModal .parts.`: 112 files, 5132 tests pass. `pnpm check`: 0 errors, 5 warnings (none in these files).
- jsdom proves structure, not looks: no device run, no real pack applied.

### Known limitations (MC-3638, MC-3639, MC-3659, no guard)
- A pack may restyle Reset, Delete this, Delete after and the rerolled Apply and Cancel (reach) so they look harmless or alike (colours only over the chat shell); it cannot hide them. The five critical confirms stay in AlertComp's tokens-only prompt.
- The per-card reroll Apply overwrites one summary's text in one tap with no confirm and no undo; the original and the rerolled text are shown side by side first, and the source gives it the danger hover. It is an edit in an inline panel, not an MC-2947 popup confirm, so it stays a reach `modal-action` (same treatment as MC-4211, MC-4213).
- A pack may hide the safe names: the title, card number, category chip, metric badges, result counter, convert label, footer labels and the red error spans (not found, load error, no first message). It cannot hide the frame, header, body, cards, controls, fields or footers.
- The identity root sits on the fixed full-viewport scrim: over the colour-mode chat shell a pack may recolour it, even opaque, so it covers the chat while the modal is open.
- Inherited text properties set on `modal-frame`, `modal-row` or `modal-controls` reach the unclaimed text inside, including lucide icon colour.
- A part on a component tag with no rest props (`ModalHeader`, `ModalSummaryItem`, `ModalFooter`) renders nothing and no census sees it (M8).
- Settings focus-return fallback (`settingsOrigin.ts`): after Settings is opened from the header Settings button, closing it may focus another open overlay's `modal-action`. Benign edge.
- The bulk bar, bulk result and the category and tag managers stay built-in beside or inside a frame a pack may recolour until W3-6b (cosmetic). Over legacy or unthemed screens and under safe start nothing applies; over another area's sheet only the shape subset applies (MC-3009).

### Leftovers (MC-4214)
- Category Delete, tag Remove and bulk re-summary Apply ran with no confirm and stay reach buttons. Discharged by #818 (PR 829, MC-4430): all three now ask through `alertConfirm`, AlertComp's critical `ask`; their parts are unchanged. The per-card reroll Apply still has no confirm: same treatment, no new ticket.

### Device rows (fold into W5; synthetic data; Note 9; every-target network block up for the whole run)
Test pack: popups.css `[data-part="modal-frame"]{border-radius:24px;background:#5a1f6b}`, `[data-part="modal-hypa-v3"] [data-part="modal-row"]{border-radius:20px}`, `[data-part="modal-hypa-v3"] [data-part="modal-title"]{letter-spacing:2px}`; chat.css colour mode.
Precondition: a synthetic profile with one character and one chat, chat shell on; memory engine HypaMemory V3 (selector in `OtherBotSettings`, opened by the header Settings button or Settings > Other bot settings), ChroMemory off; the Settings shell Input page toggle "Memory summary menu" on; the chat carries two chat-lorebook entries (legacy chat-lorebook editor, or a restore of a synthetic `.bin` with `chat.localLore`; no hand edit of app state), so cards come from a local import and need no provider reply.
- DV-W36a-1 Plus sheet, item "Hypa V3 Modal": 24px purple frame, title "HypaV3" 2px wider, the empty state; X and Back close. DV-W36a-2 This chat, memory view button: same look.
- DV-W36a-3 More, "Import this chat's lorebook entries as summaries": the confirm shows in its own critical look, not purple; OK; two cards with 20px corners. Then More, Reset: the first confirm is critical; Cancel; no data changed. Never confirm a Delete or Reset.
- DV-W36a-4 Search, type part of a card, Next: counter `1/1` inside the bar. DV-W36a-5 safe start with the pack, then 1: built-in look, plus the plain-launch control. DV-W36a-6 pack-free launch, then 1 and 3: no visible difference.
- If the lorebook route is unavailable, rows 3 and 4 fall to MC-4165 PQ-5 (plain-fetch mock) or a not-run ruling (MC-4210, MC-4211).

### For W3-6b and later
- 6b files: category manager, tag manager, bulk-edit-actions, bulk-resummary-result (ordinary reach parts, MC-4213), ChroMemoryModal and its two tabs. 6b regenerates the same registry and census test: start from the merged 6a values (`POPUPS_FILES` 36, `POPUPS_PARTS` 192, `POPUPS_REACH` 57).
- The managers get their own identity roots (planned `modal-hypa-v3-category-manager`, `modal-hypa-v3-tag-manager`); the bulk result takes ordinary reach parts, never a critical root (MC-4213), which would make the shared `modal-frame` a holder.

## #438 stage handoff: W3-5 ModelList and OpenrouterProviderList overlays (overlay only, never the trigger or notes), device rows pending

Branch `claude/438-w3-5`, PR "Refs #438" (PR 5 of 7 of wrap-up W3; the issue stays open). Tier 2, no new critical root. Decision MC-4212 (record in `Agents/mc/438-w3-5.md`); also MC-4160, MC-4164, MC-4165, MC-4167, MC-4168. Gates (reports under `%TEMP%/risu-b715/438/w3/`): plan r1 `w35-plan-r1.md`; Gate 1 r1 [REJECT] `w35-g1-r1.md` (F1: no killer for a part on the status note, fixed in r2 by guard (9b) and mutant M20); plan r2 `w35-plan-r2.md`; Gate 1 r2 [APPROVE] `w35-g1-r2.md`; Gate 2 r1 [EDITORIAL] `w35-g2-r1.md` (F1 PR body census wording, F2 this limitation split, F3 component-tag limitation line; all applied). Base 4e6b2fb47 (W3-4 merged).

### What changed
- Markup only, literal `data-part` attributes inside the `{#if openOptions}` overlay block: 14 on ModelList, 6 on OpenrouterProviderList. With every attribute stripped (line endings normalised) each file equals its base blob; both stay all CRLF. No class, handler, element, order, aria, focus, Back or z-index change.
  - New identity roots, both reach: `modal-model-list`, `modal-openrouter-provider-list` (the fixed scrim layer). Existing names: reach `modal-frame`, `modal-header`, `modal-close`, `modal-row`, `modal-footer`; safe `modal-title`, `modal-text`.
  - ModelList: layer, panel, header, Back, title, as-is rows, provider rows, Horde auto and model rows with their subtext spans, custom rows, None row, the footer holding the CheckInput. OpenrouterProviderList: layer, panel, header, Back, title, provider rows.
  - Unclaimed (no pack hook): the trigger buttons and both notes (status, source) on every host, the dividers, every Accordion tag and part, the Horde loading button, the CheckInput, the TextInput and its sr-only span, the icons.
- Census: `OVERLAY_FILES` +2; `registries/popups.ts`: `POPUPS_FILES` 30 to 32, `POPUPS_PARTS` 189 to 191, `POPUPS_REACH` 54 to 56 (only the two new names and two files; the closure, A1 roots pin, holders and shared tokens-only are unchanged). `overlayVocabulary.test.ts` gains the two names, two W1-T5a rows and two `display:none` reach rows.
- Settings census: `settingsParts.test.ts` `EXEMPT` gains one group of the 9 names the two pickers render (`modal-close`, `modal-footer`, `modal-frame`, `modal-header`, `modal-model-list`, `modal-openrouter-provider-list`, `modal-row`, `modal-text`, `modal-title`). `SETTINGS_PARTS` is unchanged. The pickers render inside the Settings shell closure (PromptSettings, BotSettings, OpenrouterSettings). No Home `FOREIGN`, chat or Studio census change (homeParts, areaParts, studioCriticalClosure, settingsCriticalClosure pass unchanged).
- Criticality (MC-2947): no new critical root, no tokens-only item. A gray model still asks through the critical `alertConfirm`.

### Tests (class, true counts)
- New render tests mount the real components, find each element by tag, aria-label, text or structure (never by its part), assert the part and its DIRECT parent, plus whole-tree outlines: `ModelList.parts` (11: 7 acceptance, 4 guard: pending Horde, source note, status note, behaviour), `OpenrouterProviderList.parts` (8: 4 acceptance, 4 guard).
- Extended: `overlayVocabulary.test.ts` (76), `popupsCriticalClosure.test.ts` (18; `OVERLAY_FILES` +2), `settingsParts.test.ts` (13; EXEMPT group).
- True base counts (head tests of these 5 files, 126 tests, against the 4e6b2fb47 sources served in memory, the Settings test reading the same served text): base components + base registry 18 fail, 108 pass (ModelList.parts 7, OpenrouterProviderList.parts 4, overlayVocabulary 5, popupsCriticalClosure 1, settingsParts 1); base components + head registry 14 fail, 112 pass (same render counts, popupsCriticalClosure 2, overlayVocabulary 0, settingsParts 1). Head 126 of 126.

### Evidence and limits
- 20 named in-memory mutants (M1 to M20: swaps, dropped and renamed parts, part on a component tag, on the shared CheckInput, on the trigger, the loading row and the status note, reach demotion, critical marker, files dropped from the census) all killed; scratch config under `%TEMP%`, no tracked file touched. Killers in `%TEMP%/risu-b715/438/w3/w35-code-report.md`.
- `vitest run src/lib/UI/ModelList src/lib/UI/OpenrouterProviderList src/ts/themePack`: 79 files, 4812 tests pass. `pnpm check`: 0 errors, 5 warnings (none in these files).
- jsdom proves structure, not looks: no device run, no real pack applied.

### Known limitations (MC-3638, MC-3639, MC-3659, no guard)
- A pack may restyle `modal-row` so one-source (gray) models no longer look gray (colours only over the chat shell); the confirm stays in the critical prompt.
- A pack may hide the safe names (the Model and Provider titles, the Horde performance subtexts); it cannot hide rows, Back, the footer or the identity roots.
- The identity roots sit on the fixed full-viewport scrim: over the colour-mode chat shell a pack may recolour it (even opaque) so it covers the host screen while the picker is open.
- Host-area sheets still pass inherited text properties into the picker, as today. A popups rule that sets inherited text properties (colour, letter-spacing, line-height) on `modal-frame` or `modal-footer` also reaches the unclassed Accordion, CheckInput and TextInput text. An EasyPanel-scoped frame rule also styles a picker opened from EasyPanel. The trigger, the notes, the Accordion, CheckInput and TextInput are not selectable.
- A part on a shared component tag (Accordion, TextInput) is caught by the census only for a name outside the Settings EXEMPT group; it renders nothing while those components take no rest props.
- Over Settings or Studio only the shape subset applies; over legacy screens and under safe start nothing applies (MC-3009).

### Device rows (fold into W5; synthetic data; Note 9; every-target network block up for the whole run)
Test pack: popups.css `[data-part="modal-frame"]{border-radius:24px;background:#5a1f6b}`, `[data-part="modal-model-list"] [data-part="modal-close"]{background:#ffcc00}`, `[data-part="modal-openrouter-provider-list"] [data-part="modal-title"]{letter-spacing:2px}`; chat.css colour mode; settings.css and studio.css one shape rule each. Profile: one character, Pro tools on, chat, Settings and Studio shells on, one preset.
- DV-W35-1 ModelList from EasyPanel (Plus sheet, Easy panel, Run if shown, Models tab, main-model field): 24px corners, purple panel, yellow box behind Back; Back closes; pick no gray model. Record whether EasyPanel's blur confines the picker.
- DV-W35-2 ModelList over the Settings shell (Bot settings, Model field): 24px, no purple, no yellow.
- DV-W35-3 OpenrouterProviderList over the Settings shell: pick "OpenRouter", Parameters tab, OpenRouter Settings, Provider order, +, tap the empty field: 24px, title 2px wider, no purple.
- DV-W35-4 ModelList over Studio (preset, Advanced, model field): 24px, no purple; close with Back.
- DV-W35-5 safe start with the pack, then 1 and 2: square corners, normal title spacing, plus the plain-launch control. DV-W35-6 pack-free, then 1 to 3: no visible difference from the built-in look.

### For W3-6 and later
- The popups registry and census test are serial: regenerate from the printed constants, never hand-order (`…/UI/ModelList` and `…/UI/OpenrouterProviderList` sort between `…/Setting/listedPersona` and `…/UI/Realm/RealmBlockedCreators`).
- Any later popups name that a shared component renders inside the Settings shell closure needs a Settings EXEMPT row (name-level); W1-T6b guards every other file. Both new names are exempt there only because the pickers render inside that closure.
## #438 stage handoff: W3-4 botpreset, IrisModal, PromptDiffModal (frame, header and close only), device rows pending

Branch `claude/438-w3-4`, PR "Refs #438" (PR 4 of 7 of wrap-up W3; the issue stays open). Tier 2, no new critical root. Plan r1 (designer) and Gate 1 r1 [EDITORIAL] by a fresh opus-reviewer (reports `%TEMP%/risu-b715/438/w3/w34-plan-r1.md`, `w34-g1-r1.md`); its four findings applied by the coder brief (F1 IrisModal in scope unconditionally per MC-4210 and the not-run row per MC-4210, MC-4211 cited for Reset; F2 inherited-text wording; F3 M8 split into component-only and component-plus-registry; F4 the strip check normalises line endings). Decisions: MC-4160, MC-4164, MC-4165 (PromptDiffModal parts on frame, header and close only), MC-4210, MC-4211 (records in `Agents/mc/438-w3-4.md`). Gate 2 r1 [EDITORIAL] by a fresh opus-reviewer, F1 to F3 applied (this H1 and two PR body lines; report `%TEMP%/risu-b715/438/w3/w34-g2-r1.md`). Base 7374a3b9a (W3-3 merged) with origin/main merged in.

### What changed
- Markup only, literal `data-part` attributes (23 on botpreset, 19 on IrisModal, 4 on PromptDiffModal); with every attribute stripped (and line endings normalised, the base blobs are LF) each file equals its base blob, and all three stay all CRLF. No class, handler, element, order, aria, focus or Back change.
  - New identity roots, all reach: `modal-botpreset` (layer), `modal-iris` (root), `modal-prompt-diff` (layer). Existing names: reach `modal-frame`, `modal-header`, `modal-close`, `modal-row`, `modal-controls`, `modal-action`, `modal-footer`, `modal-list`, `modal-body`, `modal-field`; safe `modal-title`, `modal-text`.
  - botpreset: title, close, row, name and slot badge, row tools (Compare, Copy, Export, Remove), toolbar and select bar footers, quick-preset hint. IrisModal: the dialogue box and backlog panel frames, Reset, backlog close, log, lines, speaker tag, text, tip, unsupported-model notice, field, Send. PromptDiffModal: layer, dialog, header, close. Unclaimed: botpreset's windowed `ul`/`li`, `TextInput`, drop gaps, select mark, image; IrisModal's sprite, scrim, position wrapper, cursor, waiting row, advance overlay; PromptDiffModal's option row and whole diff view. PromptDiffModal renders beside botpreset's layer, not inside it.
- Census: `OVERLAY_FILES` +3; `registries/popups.ts` regenerated from the printed values: `POPUPS_FILES` 27 to 30, `POPUPS_PARTS` 186 to 189, `POPUPS_REACH` 51 to 54. Only the three new reach names and the three file entries changed; critical closure, A1 roots pin, holders and shared-tokens-only are unchanged. No Settings EXEMPT, Home `FOREIGN`, `areaParts`, chat or Studio change (all three files are App-level; verified by the unchanged `homeParts`, `settingsParts`, `areaParts` passes).
- Criticality (MC-2947): no new critical root. botpreset Remove goes through the critical `alertConfirm`/`alertError`; Export is the tool dialog; Import's bundle prompt is critical. IrisModal's backlog Reset has no confirm and is a direct reach button (MC-4211).

### Tests (class, true counts)
- New render tests mount the real components, find each element by tag, role, aria-label, title, text or structure (never by its part), assert the part and the DIRECT parent, plus whole-tree outlines: `botpreset.parts` (10: 8 acceptance, 2 guard; jsdom, real PromptDiffModal mounted by two Compare picks), `IrisModal.parts` (6: 4 acceptance, 2 guard; happy-dom), `PromptDiffModal.parts` (20: 18 acceptance over the 16 states plus Legacy, 2 guard that the diff body and option row stay unparted).
- Extended: `overlayVocabulary.test.ts` (70; 3 W1-T4 rows, the table row, 4 W1-T5a rows, 3 `display:none` reach rows that are guards on the base), `popupsCriticalClosure.test.ts` (18; `OVERLAY_FILES` +3).
- True base counts (head tests of these 5 files, 124 tests, against the 7374a3b9a sources served in memory): base components + base registry 38 fail, 86 pass (IrisModal.parts 4, botpreset.parts 8, PromptDiffModal.parts 18, overlayVocabulary 7, popupsCriticalClosure 1); base components + head registry 32 fail, 92 pass (same render counts, popupsCriticalClosure 2, overlayVocabulary 0). Head 124 of 124.

### Evidence and limits
- 19 named in-memory mutants (comment, sibling swap, part swapped with its parent, dropped, renamed component-only and with the registry, moved inward and outward, part on the `WindowedSegment` tag, diff view and sprite parted, reach demotion, critical marker, files dropped from the census, diff modal moved inside botpreset) all killed; scratch config under `%TEMP%`, no tracked file touched. Killers in `%TEMP%/risu-b715/438/w3/w34-code-report.md`.
- `vitest run src/ts/themePack src/lib/Setting/botpreset src/lib/Others/IrisModal src/lib/Others/PromptDiffModal src/lib/Others/OverlayBack src/lib/keyListenersUnderAlert src/App`: all pass (94 plus 11 files). `pnpm check`: 0 errors, 5 warnings (none in these files).
- jsdom/happy-dom prove structure, not looks: no device run, no real pack applied. IrisModal has no opener in this build (`irisStore.open` is set to true only by tests; upstream commit 04d8c98f6 removed it), so its tests are its only evidence and its device row is not run (MC-4210).

### Known limitations (MC-3638, MC-3639, MC-3659, no guard)
- A pack may restyle Remove, Export, the select-mode Export and Reset so they look harmless (colours only over the chat shell); it cannot hide them. The Remove confirm stays in the critical AlertComp prompt. IrisModal's Reset wipes the saved Iris conversation with no confirm: a leftover of this PR, no ticket (MC-4211).
- A pack may hide the safe names: botpreset's title, preset names, slot badges and hint; IrisModal's speaker tag, tip, unsupported-model notice and backlog line texts.
- PromptDiffModal: a pack may restyle the frame and header box. It cannot select the diff view or the option controls. Inherited text properties set on the frame or header (colour, letter-spacing, line-height) still reach their unclassed text. The same holds for botpreset's unclaimed `TextInput` and windowed list.
- Over Home, Settings or Studio only the shape subset applies (MC-3009).

### Device rows (fold into W5; synthetic data; Note 9)
Test pack: popups.css `[data-part="modal-frame"]{border-radius:24px;background:#5a1f6b}`, `[data-part="modal-botpreset"] [data-part="modal-title"]{letter-spacing:2px}`, `[data-part="modal-prompt-diff"] [data-part="modal-close"]{background:#ffcc00}`; chat.css colour mode; home.css one shape rule. Profile: two presets, one character, "Show Prompt Comparison" on.
- DV-W34-1 botpreset over the chat shell: Ctrl+P, or the quick menu (three fingers down together within 300 ms, then "Presets"). Read: panel corners 24px (built-in about 6px), purple panel, title letters 2px wider; X and Back close.
- DV-W34-2 PromptDiffModal from DV-W34-1: Compare on P1 then P2. Read: frame 24px and purple, a yellow box behind the X, the built-in diff colours unchanged; Back closes the diff first.
- DV-W34-3 botpreset over Home (quick menu, "Presets"): 24px and 2px spacing but no purple (MC-3009).
- DV-W34-4 safe start with the pack installed, then DV-W34-1: built-in look, plus the plain-launch control. DV-W34-5 pack-free launch, then DV-W34-1 and DV-W34-2: built-in look.
- DV-W34-6 IrisModal: not run, test-only (MC-4210).

### For W3-5 and later
- The popups registry and census test are serial: regenerate from the printed constants, never hand-order (`…/Others/IrisModal` sorts after `HypaV3Progress`, `…/Others/PromptDiffModal` after `ProTools/EasyPanel`, `…/Setting/botpreset` before `listedPersona`).
- All three files are App-level overlays: no Home, Settings or chat census sees them. A later popups name rendered inside the HomeShell closure still fails the `FOREIGN` pin until reviewed.

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
