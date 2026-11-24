# #438 stage handoff: wrap-up stages W1 (merged) and W2 (this PR)

The wrap-up stages each add a section; the newest PR is the one under review, the earlier ones are merged. Both sections come from their own PRs and were merged here without dropping either side.

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
- Class: none of the 40 is in `REACH_CHAT` or `SAFE_LEAVES`, so all take the default reach tier like their sidebar neighbours. The reach tier refuses everything off its allowlist (for example `display:none`, positioning, `opacity:0`, `visibility:hidden` and `font-size:0`); recolour and respace are accepted. Adding a name to those lists would need a matching edit of `docs/design/chat/checks/th/packlint.mjs` (parity test); that stays out of this PR.
- Skipped on purpose (no part, none of them a control or user-readable text a pack needs to address): the `role=presentation` windowing spacers (chat list and search results, structural), the sort wrapper div around the sort select (structural), the search icon (decorative), the label spans inside the More menu and footer rows and the sidebar `home`/`settings`/`more` footer labels (the parent buttons carry parts; the label sits inside them), and the RecentStrip avatar ring span (state decoration, not text or control).
- Tests: `src/ts/themePack/sidebarParts.test.ts` (245 cases, node: census/class/disjointness plus the `?raw` source-inventory scans, retitled "source inventory": they do not prove placement) and two rendered files that mount the real components and assert each part sits on the intended element by tag, role, `data-action`, text or position: `src/lib/ChatShell/sidebar/ShellSidebar.parts.svelte.test.ts` (13 cases: ShellSidebar, chat list and folder rows, chat rows, search, row menus) and `SidebarMoreMenu.parts.svelte.test.ts` (3 cases).

### Evidence
- Round 2 run: `pnpm vitest run src/ts/themePack src/lib/ChatShell/sidebar src/lib/ChatShell/chatPartsStable.test.ts`: 91 files, 4961 tests passed (corpus golden unchanged); `pnpm check` result in the PR body.
- Round 1 coder run: `pnpm check` 0 errors; `pnpm vitest run src/lib/ChatShell/sidebar src/lib/SideBars src/lib/ChatShell/chatPartsStable.test.ts src/ts/themePack`: 181 files, 6164 tests passed; after the review's one-space fix, sidebarParts plus the sidebar tests: 17 files, 446 passed. The corpus golden is unchanged.
- Base proof without touching tracked files (an in-memory config serves the seven changed sources at origin/main e2cd1aefa; 261 new cases, 139 fail and 122 pass on that base). Failing on the base: census membership 40, reach tier 40, source-inventory literal 40, rendered placement 16, known-limitation 3. Passing before and after (guards, not reproducers): "named by a rendered test" 40 (test-text inventory), not critical/escape/safe 40, no other area 40, name-list and escape-entry 2. `areaParts.test.ts` (7) passes on the base because it recomputes from the served source. Round 1 had said 148 of 187; the correct base number for that set was 111, and the markup-literal family never was a guard on the base (it fails there).
- Mutants (in-memory transform config, no tracked file touched): M4 (a part moved into an HTML comment: `row-menu-delete`, `more-back`) passes all 245 `sidebarParts.test.ts` cases and fails 3 rendered cases; M5 (`row-menu-delete` and `row-menu-export` swapped) passes all 245 and fails 2 rendered cases. Round 3 (lane A's M9 and M14, parent/child swaps): `chat-sidebar-search-box` with its parent `chat-sidebar-search` swapped, and `chat-sidebar-new-row` with `chat-sidebar-header` swapped, passed all 261 before; the rendered tests now assert the nearest part-carrying ancestor of every nested part (header, new row, new menu, search box and field, chat row lines, folder rows, search result texts, every row-menu item and option, More header, Back and title) and M9 fails 1 case, M14 fails 2. No other undetected swap was found among the nested pairs (siblings differ by tag, text or `data-action`, which the placement tests assert).
- Independent Sonnet review of round 1 (adversarial-reviewer): [EDITORIAL], one missing space in `ShellRowMenu.svelte` (fixed); it confirmed markup-only, unique literals, no collisions, sound classification deviation, and ran targeted vitest (453 passed). Round-2 independent re-review: APPROVE (`%TEMP%/risu-b715/438/w2/review2.md`); its known limitation: the rendered coverage test in `ShellSidebar.parts.svelte.test.ts` depends on file order and fails under `-t` or shuffle.
- Not run: Note 9 rows. The sidebar change is markup only; the sidebar rows fold into the W5 integration run (MC-4162).

### Known limitations (MC-3638, no guard)
- A pack can now recolour and respace sidebar buttons, including the row-menu delete items.
- `row-menu-delete` and `row-menu-folder-delete` are restylable and keep their protected confirm (unchanged). `chat-sidebar-export-all` is restylable and has no confirm: a hijacked tap starts the export. The reach tier refuses everything off its allowlist (`display:none`, positioning, `opacity:0`, `visibility:hidden`, `font-size:0`), but a transparent colour, `clip-path` and `width:0` (installed with notes) and an empty positioned `::after` cover (`inset:-4000px`) still install, as on the existing this-chat-delete part (compatibility test "known limitation" in `sidebarParts.test.ts`).
- The sr-only `sidebar-sort-label` is restylable (it can be made visible or odd-looking; hiding it is refused).
- The minor unmarked items above (label spans, RecentStrip avatar ring, sort wrapper) stay skipped.

### For W5 (device row, Note 9, synthetic data)
With the new chat shell on and the standard chat theme (the sidebar shows with both), install a pack with rules on `chat-sidebar-new-chat`, `more-back` and `row-menu-delete` (a distinct background colour on each; use `!important` on `row-menu-delete`, because the scoped row-menu button rule outranks a plain background), open the sidebar, press More for `more-back`, and open a chat row menu for `row-menu-delete`: the three elements show the pack's rule.

### Docs changed in this PR (after the W1 docs merge)
- `docs/design/THEMING.md` "Not covered yet" sidebar bullet, `docs/wiki/Theme-Packs.md` and `Agents/Theme-Packs.md` status now say the chat sidebar parts ship with this PR.
- `docs/design/THEMING.md` DD-149 sentence "any sheet with a danger button is protected by default" is rewritten: a prompt is protected when the census marks it critical, and a menu item that leads to one (the row-menu delete) is an ordinary part with the confirm unchanged. A fresh doc-verifier read these passages on a hashed snapshot (`%TEMP%/risu-b715/438/w2/snap-r2/SHA256.txt`, report `verify-r2.md`): 14 of 16 claims CONFIRMED, 2 minor wording or unverifiable counts, none blocking.

### Open for the next stages / lane A
- W3 (overlay parts) is sized in `%TEMP%/risu-b715/438/w3/plan-r1.md`; W3-7 edits `areaParts.ts` and `engine.ts`, so it starts after this PR merges.
- W1 docs (PR 756) is merged. Reports: `%TEMP%/risu-b715/438/w2/` (brief.md, code-report.md, code-report2.md, review.md, review2.md).

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
