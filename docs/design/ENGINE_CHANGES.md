# Engine changes needed by the chat and Studio redesigns and the theme contract

Compiled 2026-10-27 for Lane A from the design docs in this workspace, with no app source read. Settings items are in [settings/ENGINE_CHANGES.md](settings/ENGINE_CHANGES.md).

**How to read this:**
- Every mockup simulates its change, so no item blocks a mockup. Each blocks only its implementation.
- MC-350 isn't in this clone, and no chat or Studio doc mentions it, so the persistence mapping is Lane A's to make.
- The design docs make no claim about upstream `.bin` compatibility. Every size below is **INFERRED**. The `.bin` notes in the table are the original guesses; the MC-774 rulings below supersede them.
- Paths are relative to `docs/design/`.

| # | Engine change | Screen or element | Data, and whether stored data or the save format changes | Size | Ref |
|---|---|---|---|---|---|
| 1 | A typed failure on the message (`{reason, fix, conn, detail}`) instead of a ` ```risuerror ` block added to the reply text. History building skips it. A check before sending catches a missing key or model. | Failure card (고치기 / 다시 시도) | New stored `Message` field. Whether it persists across restarts and exports is open (HOOKS1 O-6). `.bin` affected: INFERRED | M | chat/HOOKS1_SPEC.md:193-194, :214 |
| 2 | Generation runs per chat. Remove the three `changeChar` guards, publish which chat is generating, and keep finished and failed flags per chat. | Background generation strip, status on chat rows | Per-chat flags, runtime only (INFERRED) | M | chat/SLICE2_SPEC.md:182-183; DD-039 |
| 3 | A "this chat only" toggle copies the shared values when turned on and drops them when turned off. | Toggle scope switch | How `GLGlobalVariables` is used changes; per-chat variables are stored | S–M | DD-045; HANDOFF.md (toggles) |
| 4 | Jailbreak and memory fields at chat level, falling back to the global or per-character value. | This chat sheet, toggles panel | New stored chat fields. `.bin` affected: INFERRED | M | chat/TOGGLES_SPEC.md:138-139; DD-082, DD-086 |
| 5 | `getModuleToggles` and `parseToggleSyntax` keep each toggle's source. | Toggle sections grouped by source | Runtime only | S | chat/TOGGLES_SPEC.md:135-136 |
| 6 | A favourites store keyed by source + key. | Favourite chips | New stored data | S | chat/TOGGLES_SPEC.md:140 |
| 7 | A default-value syntax for toggle authors (open). | Toggle reset and "changed" state | Toggle definition text, stored | M | TOGGLES O-1 :146; studio/SLICE2_SPEC.md:157 |
| 8 | In group chats, regenerate redoes one message with the same speaker. "이 라운드 다시" keeps today's whole-round behaviour. | Group regenerate | Alternatives change from whole-round slices to per message. Stored; `.bin` affected: INFERRED | L | chat/SLICE3_SPEC.md:72, :213; DD-053 |
| 9 | Rounds that are only queued, plus auto mode with pause and resume, stop reasons, and Send still allowed while it runs. | Member strip, auto-mode run bar | Runtime. `autoMode` stays unused (O-4) | M | chat/SLICE3_SPEC.md:81, :212-214; DD-055, DD-059, DD-060 |
| 10 | Deleted members keep a name, either as a snapshot on the message or as a tombstone on the group. Today messages store only the speaker id. | Display of missing members | New stored field | S | DD-058; SLICE3 O-3 :226 |
| 11 | Each member's colour slot is fixed when they join. | Speaker colours | New stored slot per member (INFERRED) | S | DD-064 |
| 12 | A per-chat setting to hide names and avatars, and a per-character setting to render a reply only when it's complete. | Reading mode, streaming display | New stored fields (INFERRED) | S | chat/SLICE1_SPEC.md:58, :182; DD-024 |
| 13 | "Next alternative" and "generate new" become separate actions. Delete stops generation first and can be undone. | Message actions | Runtime | S–M | chat/SLICE1_SPEC.md:271 |
| 14 | Saves happen per chat instead of per whole character, with save tracking per chat. History is trimmed, with caches, before the prompt is built. | Long chats | Storage layout changes, which is Lane A's call. Save format affected: INFERRED | L | chat/SLICE4_SPEC.md:105-117; DD-070 |
| 15 | Edit drafts that survive, and a per-chat cache of message heights, with the hint dismissal and the anchor to open at. | Bounded message window (about 100 mounted messages) | New stored data. Where it lives is open (SLICE4 O-1) | M | chat/SLICE4_SPEC.md:112-117, :197; DD-068 |
| 16 | Retire the load-pages and streaming-mode settings. | (none) | Settings are removed. Crosses into Settings. Supersedes MC-257 / CHORE-156's "balanced" default, which the main session must reconcile | S | DD-071; chat/SLICE4_SPEC.md:188 |
| 17 | The save loop reports success or failure for each change (`onSaved`, `onFailed`). | Studio save status chip | Runtime | S | studio/SLICE1_SPEC.md:186, :199 |
| 18 | A device-local store for code drafts, history per owner, restore points and earlier script lists. It stays out of the database, exports and sync. | Studio drafts and history | New local store | M–L | studio/SLICE1_SPEC.md:187-188, :200-201; DD-099 |
| 19 | Switching trigger mode keeps the previous list. A module isn't stored until it has a name. | Studio scripts and modules | Changes how stored data behaves | S | studio/SLICE1_SPEC.md:189-190 |
| 20 | Change events from other tabs and devices, a search index across characters, and editing plugin code with hot reload (open). | Studio | Mixed | M–L | studio/SLICE1_SPEC.md:202-206; O-3 :216 |
| 21 | A carry-over migration renames `toggle_<old>` to `toggle_<new>` in global variables and in each chat's pinned set, and remaps select indices. History steps that span owners. | Toggle builder | Migrates stored data | M | studio/SLICE2_SPEC.md:74, :144, :156; DD-106, DD-116 |
| 22 | A sandboxed variable store for `risuChatParser`, a debounced token counter that checks it's available, and a macro list generated from `registerCBS`. | Long-text fields, preview, token chip | Runtime | M | studio/SLICE3_SPEC.md:118-122 |
| 23 | A theme installer that enforces protected surfaces when a pack is installed (judged by ancestry against an approved list), and storage for theme packs. | Theme contract | New pack store (INFERRED) | M | THEMING.md; DD-149, DD-155, DD-159. The install rule also enforces per-area token floors and ceilings judged over the worst case, and rejects unbalanced packs (DD-182, DD-192, DD-195, DD-197; reference validator `chat/checks/th/packlint.mjs`). **DD-242 / DD-243 (2026-10-28), the installer must also fail closed:** accept only role tokens the area's registry lists as pack-settable (no ladders, no `--risu-animation-speed`, no private variables); reject any colour value that does not resolve to concrete sRGB (`color-mix`, `oklch`, `light-dark`, relative colours, `currentcolor`, an unresolved `var()`) and any fully transparent colour outside the listed decorative tokens; require the sheet and toast colours to be opaque and critical text, muted, warning, on-accent and diff colours to keep 4.5:1 on them, judged over every `:root`, root-attribute, `@media` and `var()` alternative; reject a background on a selector that names no part; keep navigation, Tasks, Stop, composer and Send, Apply, Undo/Redo and the failed-save chip in the reach tier (restyle, never hide or move) and reject every `outline` change. The reference validator plus `chat/checks/th/failclosed.mjs` is the executable spec; `theme/checks/run.mjs` is its regression suite. Round 2 (DD-258, DD-260, DD-256): the installer also inlines pack-private `--pack-*` variables before judging (a private variable cannot carry a value past any rule), caps size role tokens and safe-tier padding, sums horizontal padding along a part chain (120 px budget at 360), and rejects a pack whose worst-case protected-sheet height exceeds 640 px (`chat/checks/th/geometry.mjs`) |
| 24 | Screens read data from the store by ID. Unsaved input lives in drafts kept apart from live data. Derived values are recomputed. | All screens | Architecture rule | L | DD-157 |
| 25 | Owner setters for character and group fields (`setField(ownerId, path, value)`), with change events and a history hook. Chat-scoped fields (author note, memory text) are edits to the chat owner. | Studio character and group forms | Runtime; no format change | M | studio/SLICE4_SPEC.md §1; DD-157, DD-189 |
| 26 | One atomic member operation (add, remove, reorder, mute, talk) that keeps `characters`, `characterTalks` and `characterActive` aligned. | Studio group form | None; avoids the load-time reset (`characters.ts:724-737`) | S | studio/SLICE4_SPEC.md §8.1; DD-164 |
| 27 | Image add returns a result per file (stored, wrong type, store failure). Emotion names drop the real extension. Imports are tracked per id and finish after the author leaves. | Portrait, emotion images, assets | Runtime; names of new `.gif` emotions change | S | studio/SLICE4_SPEC.md §5.1, §7; DD-170, DD-191, DD-196 |
| 28 | Deleting an emotion image or asset keeps the stored file until the durable undo ends (DD-100). Whether orphaned files are cleaned up later is not traced. | Emotion and asset delete with undo | Possibly a deferred file cleanup | S–M | studio/SLICE4_SPEC.md §7.2-7.3 |
| 29 | `updateInlayScreen` reports which fields it filled with defaults. Lane A clarifies why deleting an asset or alternate first message sets `fmIndex = -1` (`CharConfig.svelte:644, :1191`). | Display › 화면, assets | Runtime | S | studio/SLICE4_SPEC.md §5.2; DD-177 |
| 30 | One field catalogue (key, label, group, kind, has-value test) shared by the forms, the fold rule and Studio search. | Advanced fold, search | None | S | DD-163, DD-174 |
| 31 | A private-license lock on the owner: every item kind hidden and read only, a per-session reveal, export still blocked, and search and test tools skipping hidden text. | Studio private notice and reveal | Runtime; reveal state per session only | M | DD-188, DD-194 |
| 32 | An app-wide toast host that Studio can post to after it closes. | Import result toast | Runtime | S | DD-196 |

## Main-session rulings relayed by Lane A (2026-10-27)

Lane A recorded these on its side as maintainer rulings. They are listed here as references, and this session has not confirmed them separately.

- **Upstream `.bin` (MC-774):**
  - Where upstream has an equivalent, `.bin` export translates our data to upstream's shape.
  - Data that exists only in this fork stays in our own storage and the fork-only `.rtb` backup. It is left out of `.bin`, and the export warns and names what was left out.
  - Importing an upstream `.bin` must always work.
- **Per item:**
  - **#8:** per-message alternatives export to `.bin` as whole-round slices.
  - **#1, #4, #10, #11, #12, #15, #18, #23:** fork-only data under MC-774. It is kept out of `.bin`, and the export warning names it.
  - **#21:** the toggle rename runs as an automatic forward migration (MC-350: Android data carries forward and is never overwritten).
  - **#14:** overlaps CHORE-412 and will be sized with that ticket.
  - **#16 / DD-071:** recorded as superseding the "Balanced" default in MC-257 item 1. CHORE-156 drops that item and keeps its Lua-engine and superseded-parse items.

## Notes

- **Settings crossover:** #16, plus the Customize-buttons layout, the Enter-key setting and haptics in Settings › Chat (chat/SLICE1_SPEC.md:276). The chat preset chip depends on Settings' switcher, stable preset ids and a preset record on each message.
- **Storage:** ticket-impact/STORAGE_CONTRACT.md, linked from HANDOFF, is the place to check `.bin` impact for #1, #4, #8, #10, #11, #12 and #14. It hasn't been cross-checked against this list.

## Probably UI-only, unconfirmed

- Bookmarks and branches in the This chat sheet. Jumping to a message relies on #15.
- "AI에게서 숨기기" (hide from AI) and the hidden or bookmarked `data-*` states. The hidden flag already exists.
- Chat folders, reordering, the sort choice remembered per device, and chat search. Remembering the sort needs somewhere to store it (INFERRED).
- Plugin action slots. No plugin API is specified yet (DD-019).
- Group talkativeness, mute and order reuse today's data.
- Hiding empty toggle groups (DD-109) changes what the panel renders.
- The display regex in group chats (SLICE3 O-1) may need an engine change; nobody has asked yet.
