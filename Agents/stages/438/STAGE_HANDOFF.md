# #438 stage handoff: W2 chat sidebar parts done (wrap-up stage 2 of 4)

Branch `claude/438-w2-sidebar`, PR "Refs #438" (the issue stays open; only W5 closes it). Tier 1: markup-only parts plus census, no validator change, no new area, no Studio file. The wrap-up decisions are in `Agents/mc/438-wrapup.md` (MC-4149, MC-4160..4164; it arrives with the W1 docs PR 756, not this one). This PR follows MC-4161: the chat-shell sidebar's unmarked elements get literal chat parts; the sidebar is part of chat, `sidebar.css` stays a skipped sheet, and no refusal is built.

## What changed
- 37 literal `data-part` values on the new chat-shell sidebar, all in `CHAT_PART_NAMES` (315 to 352 names, sorted):
  - ShellSidebar: `chat-sidebar-heading`, `chat-sidebar-new-row`, `chat-sidebar-new-chat`, `chat-sidebar-new-menu-toggle`, `chat-sidebar-new-menu`, `chat-sidebar-import`, `chat-sidebar-export-all`, `sidebar-sort-label`, `sidebar-sort-help`.
  - SidebarMoreMenu: `more-header`, `more-back`, `more-title`, `more-character-settings`, `more-playground`, `more-bookmarks`, `more-branches`, `more-dev-tool`, `more-plugin-item`.
  - ShellRowMenu: `row-menu-rename`, `row-menu-move`, `row-menu-no-folder`, `row-menu-folder-option`, `row-menu-new-folder`, `row-menu-duplicate`, `row-menu-export`, `row-menu-delete`, `row-menu-folder-rename`, `row-menu-folder-colour`, `row-menu-colour-option`, `row-menu-folder-delete`.
  - ShellChatRow: `chat-row-name-line`, `chat-row-meta`, `chat-row-actions`.
  - ShellSidebarSearch: `chat-sidebar-search-box`, `chat-search-character-name`, `chat-search-chat-name`, `chat-search-chat-preview`.
- No class, role, aria, ordering, handler or style change. The in-component `[data-part="row-menu"] button` rules still match and still outrank a pack selector on those buttons. `sidebar-settings` and the escape-route and escape-ancestor names are untouched. Structural spacers and the folder-name-edit divs were skipped.
- Class: none of the 37 is in `REACH_CHAT` or `SAFE_LEAVES`, so all take the default reach tier like their sidebar neighbours (recolour and respace accepted, hide and move refused). Adding a name to those lists would need a matching edit of `docs/design/chat/checks/th/packlint.mjs` (parity test); that stays out of this PR.
- New test `src/ts/themePack/sidebarParts.test.ts` (187 cases).

## Evidence
- Coder run: `pnpm check` 0 errors; `pnpm vitest run src/lib/ChatShell/sidebar src/lib/SideBars src/lib/ChatShell/chatPartsStable.test.ts src/ts/themePack`: 181 files, 6164 tests passed; after the review's one-space fix, sidebarParts plus the sidebar tests: 17 files, 446 passed. The corpus golden is unchanged.
- Base proof without touching tracked files: an in-memory base config makes 148 of the 187 new cases fail; the rest are guards (disjointness, markup literal). The existing census test listed exactly the 37 names as missing before the census edit.
- Independent Sonnet review (adversarial-reviewer): [EDITORIAL], one missing space in `ShellRowMenu.svelte` (fixed); it confirmed markup-only, unique literals, no collisions, sound classification deviation, and ran targeted vitest (453 passed).
- Not run: Note 9 rows. The sidebar change is markup only; the sidebar rows fold into the W5 integration run (MC-4162).

## Known limitations (MC-3638, no guard)
A pack can now recolour and respace sidebar buttons, including the row-menu delete item; the delete confirm is a separate prompt and unchanged.

## Open for the next stages / lane A
- W3 (overlay parts) is sized in `%TEMP%/risu-b715/438/w3/plan-r1.md`; W3-7 edits `areaParts.ts` and `engine.ts`, so it starts after this PR merges.
- W1 docs is PR 756. Reports: `%TEMP%/risu-b715/438/w2/` (brief.md, code-report.md, review.md).
