### MC-4149 — #438 Effects move to a separate ticket before #654; #438 closes without them, 2026-11-24

- Tag: decisions (maintainer, lane A AskUserQuestion, "Separate ticket before #654 (Recommended)"). Date: 2026-11-24. Exact times: UNKNOWN. Sweep ref: none. Related: `#438`, `#654`, `#751`, `MC-2942`, `MC-3010`, `MC-3422`, `MC-3871`, `MC-4148`.

**What the maintainer chose.** The pack effects of MC-2942 (transitions, transforms, animations and @keyframes, filters and blur, layering, with the MC-3010 reduced-motion and reduced-transparency fallbacks) are not built in #438. Lane A filed #751 for them, and #751 must land before #654's Terran Eclipse, Aqua Halo and Elemental Ivory packs. #438 closes without effects. The W0 audit's finding that MC-2942 "layering" conflicts with MC-3422 and MC-3881 (z-index and fixed/sticky stay banned) is left for #751 to settle. Not chosen: building effects in #438, and dropping MC-2942.

### MC-4160 — #438 All 12 overlays from the W0 audit get theme parts, 2026-11-24

- Tag: decisions (maintainer, lane A AskUserQuestion, "Parts for all 12"; this is not the session's recommendation, which was token-only). Date: 2026-11-24. Exact times: UNKNOWN. Sweep ref: none. Related: `#438`, `MC-2941`, `MC-3007`, `MC-4148`.

**What the maintainer chose.** The 12 App-level overlays that have no `data-part` (BookmarkList, MemoryModalHost and MemoryModal, HypaV3Progress, PopupList, EasyPanel, PopupEditor, LoadoutModal, IrisModal, CustomSidebarConfig, botpreset, listedPersona, RealmPopUp and RealmFrame) get literal `data-part` values and census entries in stage W3 (Tier 2, Opus designer, sizing first). The read-only second audit W0b runs first to find overlays below App level; if it finds more, lane A tells the maintainer before W3 is planned, so the maintainer can say whether they join W3. SavePopupIcon, a corner save-status icon rather than a modal, is raised separately in the sizing. Studio hooks stay held.

### MC-4161 — #438 The sidebar gets its missing parts; sidebar.css stays a skipped sheet and no refusal is built, 2026-11-24

- Tag: decisions (maintainer, lane A AskUserQuestion, "Add parts, amend records (Recommended)"). Date: 2026-11-24. Exact times: UNKNOWN. Sweep ref: none. Related: `#438`, `MC-3007`, `MC-3124`, `MC-2941`.

**What the maintainer chose.** The unmarked elements of the chat-shell sidebar (heading, "New chat" button and menu, sort label, the More menu header and items, the row-menu buttons) get literal chat parts and census entries in stage W2 (Tier 1). The records are amended: the sidebar is part of chat, `sidebar.css` stays a skipped sheet like any unknown area sheet, and the "sidebar.css without chat.css is refused" rule of MC-3124 is never built; this supersedes MC-3124's refusal.

### MC-4162 — #438 Acceptance reads "when the new screens are on"; built-in packs stay with #654; docs now; one closeout device run, 2026-11-24

- Tag: decisions (maintainer, lane A AskUserQuestion). Date: 2026-11-24. Exact times: UNKNOWN. Sweep ref: none. Related: `#438`, `#654`, `MC-3871`, `MC-1608`, `MC-2941`, `MC-4148`.

**What the maintainer chose.** (1) #438's acceptance is "theme packs cover the shape and design of all new screens and popups when the new screens are on"; the chat, Settings and Studio preview switches default to off, and making the new shells the default belongs to the release-switch ticket, not #438. (2) The four built-in packs stay chat-only; their rebuild is #654's (MC-3871). (3) The docs are updated now (stage W1: THEMING.md, Agents/Theme-Packs.md, a wiki page, the goldens README and `themePackRowHelp` with its locales). (4) One integration Note 9 run closes the work (stage W5): one pack with all five sheets through every screen, plus the safe start and the pack-free launch.

### MC-4163 — #438 Wrap-up stages each get their own PR; only W5 closes #438, 2026-11-24

- Tag: decisions (lane A with the maintainer's answers). Date: 2026-11-24. Exact times: UNKNOWN. Sweep ref: none. Related: `#438`, `MC-4149`, `MC-4160`, `MC-4161`, `MC-4162`.

**What was decided.** Order: W0b (read-only audit below App level), then W1 (docs) in parallel with W2 (sidebar parts), then W3 (overlay parts, Tier 2 with an Opus designer, sized first), then W5 (closeout run). Each stage is one PR "Refs #438" with its `Agents/stages/438/STAGE_HANDOFF.md`; only W5 says "Closes #438". One app-code writer per checkout, so parallel stages use separate worktrees. Overlay and sidebar parts are literal `data-part` values with the census updated. Studio hooks stay held until lane A says the Studio forms merged.

### MC-4164 — #438 W3 covers 11 App-level overlays plus six groups found below App level, the code-block menu and SavePopupIcon, 2026-11-24

- Tag: decisions (maintainer, lane A AskUserQuestion on the W0b extras). Date: 2026-11-24. Exact times: UNKNOWN. Sweep ref: none. Related: `#438`, `MC-4160`, `MC-4161`, `MC-3226`.

**What the maintainer chose.** All overlays the W0b second audit found below App level join stage W3: PartialEditController (4 modals), ModelList and OpenrouterProviderList, RealmBlockedCreators, and the HypaV3 sub-modals. The code-block context menu built in `observer.svelte.ts` gets a part and theme colours instead of its hard-coded gray. SavePopupIcon, the corner save-status icon, gets a part. The PopupList exemption is accepted (it is reachable only from the legacy chat), so the base list is the 11 App-level overlays of MC-4160 and W3 covers those 11 plus these six groups. The W0b scan was marker-based and can miss overlays; before the list is frozen the W3 designer notes that limit and runs one grep pass for fixed or absolutely positioned roots with `role=dialog` or a z-index. The designer sizes W3 into several PRs.
