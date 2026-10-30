# Settings & models decision log (parallel lane)

Same format as [../DECISIONS.md](../DECISIONS.md): ID, date, the question, options offered, the maintainer's exact answer, outcome. The main session merges these into DECISIONS.md later; until then, anything not recorded here (or in DECISIONS.md) is OPEN.

## Decided

### DS-001 — Settings & models pain points

- **Date:** 2026-10-26
- **Asked:** "What bothers you most about Settings & models in RisuAI today? (pick all that apply)" options: Hard to find a setting; Model setup is confusing; Parameters are opaque; Presets are hard to manage.
- **Answer:** "preset list can grow extensively, and shortcut only supports up to first 10. and it has no other way to organize the prompt presets.,Hard to find a setting,Model setup is confusing,Parameters are opaque,Presets are hard to manage"
- **Outcome:** all four are in scope, plus the maintainer's own note: preset lists grow long, the preset shortcut reaches only the first 10, and there is no way to organise prompt presets.

### DS-002 — Settings & models scope

- **Date:** 2026-10-26
- **Asked:** "What should the Settings & models redesign cover?" options: Models + settings shell (Recommended); Models only; Everything.
- **Answer:** "Everything"
- **Outcome:** every settings page (display, language, accessibility, hotkeys, personas, plugins, advanced, auxiliary AI, …) plus connections, models, parameters and presets, split into slices. Preset authoring kinds (regex, toggle definitions, advanced prompt text) stay with Studio per DD-094.

### DS-003 — Settings & models starting point

- **Date:** 2026-10-26
- **Asked:** "There are two October mockups (mockups/settings.html N09, mockups/models-and-prompts.html N10). Start from them?" options: Build on them (Recommended); Start fresh.
- **Answer:** "Build on them (Recommended)"
- **Outcome:** reuse their reviewed structure and fixtures; the new slices restyle and extend them in the chat slices' conventions under `settings/`; `mockups/**` itself is not edited.

### DS-004 — First Settings & models slice

- **Date:** 2026-10-26
- **Asked:** after discovery ([research/today-settings.md](research/today-settings.md), [research/october-mockups-inventory.md](research/october-mockups-inventory.md)); "Settings & models in 5 slices: (1) Settings shell + search across every page, return to chat; (2) Presets: library with search, folders/pins, quick-switch beyond Ctrl+1–9 (today only 9, positional, not rebindable), switcher in chat; (3) Connections & model choice: provider connections separate from the model, searchable picker with capabilities, fix-it path when chat fails on a missing key/model, sub/aux models; (4) Parameters: explained, per-preset vs global, unsupported ones shown with a reason; (5) Remaining pages restyled (display, language, accessibility, hotkeys, personas, plugins/modules lists, advanced). Which first?" options: Shell + search (Recommended); Presets; Connections & model.
- **Answer:** "Shell + search (Recommended)"
- **Outcome:** slice 1 = the settings shell (index, page host, phone drill-in, return to chat) and search across every page; slices 2–5 follow in the listed order unless re-ordered.

### DS-005 — What "prompt presets" means

- **Date:** 2026-10-26
- **Asked:** "When you say \"prompt presets\", what do you mean? In the code there is one list (bot presets); the prompt template is a field inside each preset." options: The bot preset list; A separate prompt library.
- **Answer:** "The bot preset list"
- **Outcome:** DS-001's preset organising applies to the bot preset list (`db.botPresets`); no separate prompt library is introduced. Note: the source limit is Ctrl+1–9 (nine presets, `src/ts/hotkey.ts:309-366`), not ten.

### DS-006 — Settings index grouping

- **Date:** 2026-10-26
- **Asked:** Settings shell slice (DS-004), after discovery; "Today Settings has 11 menu entries named after code files (Chat bot, Other bots, Display, Accessibility, Advanced…), so e.g. 'hide API key' is under Display and preset chain under Advanced. How should the new index be grouped?" options: Regroup by task (Recommended); Keep today's entries.
- **Answer:** "Regroup by task (Recommended)"
- **Outcome:** the index is regrouped by task (모델·프리셋, 대화 기능, 화면·읽기, 입력·접근성, 언어, 페르소나, 확장, 데이터·백업, 단축키, 고급 as the starting proposal); misplaced settings move to where people look for them. The exact page map is in settings/SLICE1_SPEC.md and stays open to veto.

### DS-007 — What settings search finds

- **Date:** 2026-10-26
- **Asked:** Settings shell slice (DS-004), after discovery; "What should settings search find?" options: Settings and pages (Recommended); Also named things.
- **Answer:** "Also named things"
- **Outcome:** search covers every setting (label, help, synonyms, KO and EN), every page/section, and named things: presets, models, connections, personas, plugins and modules by name.

### DS-008 — Low-power mode

- **Date:** 2026-10-26
- **Asked:** Settings shell slice (DS-004), after discovery; "The floor devices (Note 9, Pi 3) need a low-power mode; none exists today. How should it work?" options: Manual switch (Recommended); Switch + suggest when slow; Follow reduced motion only.
- **Answer:** "Switch + suggest when slow"
- **Outcome:** a manual low-power switch in 화면·읽기 (blur, shadows, non-essential motion off; separate from reduced motion), and the app offers it once when it detects sustained dropped frames.

### DS-009 — Where Settings opens on wide screens

- **Date:** 2026-10-26
- **Asked:** Settings shell slice (DS-004), after discovery; "On wide screens, where does Settings open?" options: Full page, back to chat (Recommended); Large panel over the chat.
- **Answer:** "Full page, back to chat (Recommended)"
- **Outcome:** Settings replaces the chat as a full page at every width; a back control names the origin and returns there with draft and scroll kept.

### DS-010 — Changed-from-default marker and reset

- **Date:** 2026-10-26
- **Asked:** Settings slice 1 review ([../reviews/2026-10-26-settings-slice1-review.md](../reviews/2026-10-26-settings-slice1-review.md)); "Review of Settings slice 1: which settings should show a 'changed from default' dot and a reset?" options: Only real defaults (Recommended); Every row; None.
- **Answer:** "Only real defaults (Recommended)"
- **Outcome:** the dot and 기본값으로 appear only on rows whose default is known in today's code (e.g. `hideApiKey ??= true`, `database.svelte.ts:565`); other rows have neither. Resolves SLICE1_SPEC O-1.

### DS-011 — Where provider keys live

- **Date:** 2026-10-26
- **Asked:** Settings slice 1 review ([../reviews/2026-10-26-settings-slice1-review.md](../reviews/2026-10-26-settings-slice1-review.md)); "Where should provider keys live? (ElevenLabs, DeepL and WaveSpeed keys sit with their features today; the OpenAI key appears twice)" options: All keys in 연결 (Recommended); LLM keys only in 연결.
- **Answer:** "All keys in 연결 (Recommended)"
- **Outcome:** 연결 holds every service key (LLM, TTS, translation, image); each feature shows the connection it uses with a link to it; no key field is duplicated.

### DS-012 — Device-scoped settings

- **Date:** 2026-10-26
- **Asked:** Settings slice 1 review ([../reviews/2026-10-26-settings-slice1-review.md](../reviews/2026-10-26-settings-slice1-review.md)); "Which settings should be stored per device ('이 기기') rather than in the synced/backed-up database?" options: Only new ones (Recommended); All display settings; No device scope.
- **Answer:** "Only new ones (Recommended)"
- **Outcome:** only new device settings (low-power mode, the slow-screen suggestion state) carry 이 기기; every existing setting keeps today's storage. No storage or backup change for existing data.

### DS-013 — 모델·프리셋 order and landing

- **Date:** 2026-10-26
- **Asked:** Settings slice 1 review ([../reviews/2026-10-26-settings-slice1-review.md](../reviews/2026-10-26-settings-slice1-review.md)); "모델·프리셋 opens on 30 provider rows before the model and parameters. What order and landing?" options: Model first (Recommended); Connections first; Land on the index.
- **Answer:** "Model first (Recommended)"
- **Outcome:** section order 모델 › 파라미터 › 프리셋 › 연결 (› 프롬프트 설정); unconfigured providers collapse into one '다른 서비스' row; Settings still lands on this page on wide screens.

### DS-014 — Service addresses

- **Date:** 2026-10-26
- **Asked:** Settings slice 1 re-review ([../reviews/2026-10-26-settings-slice1-rereview.md](../reviews/2026-10-26-settings-slice1-rereview.md)); "Re-review: DS-011 put every service key in 연결. What about service addresses (VOICEVOX, Fish Speech, WebUI, ComfyUI URLs, DeepLX address)?" options: Addresses in 연결 too (Recommended); Keys only in 연결.
- **Answer:** "Addresses in 연결 too (Recommended)"
- **Outcome:** 연결 holds keys and addresses of every service, local or hosted; features show a reference row. Extends DS-011.

### DS-015 — Multi-word search with no results

- **Date:** 2026-10-26
- **Asked:** Settings slice 1 re-review ([../reviews/2026-10-26-settings-slice1-rereview.md](../reviews/2026-10-26-settings-slice1-rereview.md)); "When a multi-word search finds nothing (e.g. '줄 간격', 'bigger text', 'enter to send'), what should happen?" options: Retry looser (Recommended); Strict: all words.
- **Answer:** "Retry looser (Recommended)"
- **Outcome:** drop filler words, retry with joined/split spacing, then show any-word matches under the caption '일부 단어만 일치'; the no-results screen only when that finds nothing too.

### DS-016 — "모든 프리셋 공통" chip

- **Date:** 2026-10-26
- **Asked:** Settings slice 1 re-review ([../reviews/2026-10-26-settings-slice1-rereview.md](../reviews/2026-10-26-settings-slice1-rereview.md)); "Rows used by every preset (e.g. API keys) carry a '모든 프리셋 공통' chip in the mockup. Keep it?" options: Remove until slice 2 (Recommended); Keep it.
- **Answer:** "Remove until slice 2 (Recommended)"
- **Outcome:** the chip is removed; only preset-scoped sections say they are stored in the preset. Labelling of shared rows is decided with the preset model in slice 2.

### DS-017 — Preset quick switch

- **Date:** 2026-10-26
- **Asked:** Settings & models slice 2 (Presets) start (maintainer request 2026-10-26: "Start Settings & models slice 2 (Presets): ask me about it, then spec, build, review and hand off as in slice 1."); "Quick switching: today Ctrl+1–9 picks the first nine presets by list position (not rebindable). What should replace it?" options: Switcher + pinned slots (Recommended); Searchable switcher only; Keep positional digits.
- **Answer:** "Switcher + pinned slots (Recommended)"
- **Outcome:** a searchable preset switcher (Ctrl+P, recents on top) reaches any preset; Ctrl+1–9 go to nine slots the user assigns, rebindable in 단축키; reordering the list no longer changes them.

### DS-018 — Organising a long preset list

- **Date:** 2026-10-26
- **Asked:** Settings & models slice 2 (Presets) start (maintainer request 2026-10-26: "Start Settings & models slice 2 (Presets): ask me about it, then spec, build, review and hand off as in slice 1."); "How should a long preset list be organised?" options: Folders + favourites (Recommended); Tags + favourites; Favourites + search only.
- **Answer:** "Folders + favourites (Recommended)"
- **Outcome:** one folder per preset (collapsible, reorderable), a ★ favourites group on top, search, sort (manual / recent / name).

### DS-019 — How preset edits save

- **Date:** 2026-10-26
- **Asked:** Settings & models slice 2 (Presets) start (maintainer request 2026-10-26: "Start Settings & models slice 2 (Presets): ask me about it, then spec, build, review and hand off as in slice 1."); "Today edits change live settings and are written into the preset silently only when you switch, copy or export. How should preset edits save?" options: Live with undo (Recommended); Draft + Save; Keep today's.
- **Answer:** "Live with undo (Recommended)"
- **Outcome:** every edit saves into the active preset at once with a visible status, undo and a restore point, matching Studio's live items (DD-095).

### DS-020 — Switching presets inside a chat

- **Date:** 2026-10-26
- **Asked:** Settings & models slice 2 (Presets) start (maintainer request 2026-10-26: "Start Settings & models slice 2 (Presets): ask me about it, then spec, build, review and hand off as in slice 1."); "Where should you switch presets from inside a chat?" (multi-select) options: Chat header chip (Recommended); This chat sheet row; Composer + sheet.
- **Answer:** "Chat header chip (Recommended)"
- **Outcome:** a chip with the preset name (and model) in the chat header opens the switcher; no This chat sheet row or composer item.

### DS-021 — Preset binding to chats or characters

- **Date:** 2026-10-26
- **Asked:** Settings & models slice 2 (Presets) start (maintainer request 2026-10-26: "Start Settings & models slice 2 (Presets): ask me about it, then spec, build, review and hand off as in slice 1."); "Should a preset ever follow a chat or character? (Today there is one active preset app-wide; persona has a per-chat binding, preset does not.)" options: No, one active preset (Recommended); Remember per chat; Default per character.
- **Answer:** "No, one active preset (Recommended)"
- **Outcome:** one app-wide active preset as today; loadouts remain the way to switch several things together.

### DS-022 — Favourites vs Ctrl+1–9 slots

- **Date:** 2026-10-26
- **Asked:** Settings & models slice 2 (Presets) start (maintainer request 2026-10-26: "Start Settings & models slice 2 (Presets): ask me about it, then spec, build, review and hand off as in slice 1."); "Favourites and Ctrl+1–9 slots: one thing or two?" options: Separate (Recommended); First 9 favourites.
- **Answer:** "Separate (Recommended)"
- **Outcome:** ★ marks presets for the list and switcher; slots 1–9 are assigned per preset ('단축키 지정'); a preset can have either or both.

### DS-023 — Shortcut keys in text fields

- **Date:** 2026-10-26
- **Asked:** Settings slice 2 review (reviews/2026-10-26-settings-slice2-review.md); "Should Ctrl+P and the Ctrl+1–9 slot keys work while you're typing in a text box such as the chat input?" options: Work everywhere (Recommended); Ignore in text boxes; Only Ctrl+P in text boxes.
- **Answer:** "Work everywhere (Recommended)"
- **Outcome:** as today: Ctrl+P and slot keys work in text fields except during IME composition and inline rename inputs; supersedes spec §2.1/§7 text-field rule (R-01).

### DS-024 — Recovering deleted presets

- **Date:** 2026-10-26
- **Asked:** Settings slice 2 review (reviews/2026-10-26-settings-slice2-review.md); "How should deleted presets be recovered?" options: Undo stack + 최근 삭제 (Recommended); Keep the single toast; Real trash.
- **Answer:** "Undo stack + 최근 삭제 (Recommended)"
- **Outcome:** stack of destructive library actions, each undoable; '최근 삭제' list in the library keeps deleted presets until restart or 30 days; Ctrl+Z in the library undoes the last library action (R-03/R-04/R-06).

### DS-025 — Keep-on-switch locks under live save

- **Date:** 2026-10-26
- **Asked:** Settings slice 2 review (reviews/2026-10-26-settings-slice2-review.md); "Under live save, what should the three "프리셋을 바꿔도 유지" switches mean?" options: Stored outside preset (Recommended); Retire them; Copy forward.
- **Answer:** "Stored outside preset (Recommended)"
- **Outcome:** while a lock is on, its fields live outside the preset and their rows are marked shared; switching does not change them (R-08).

### DS-026 — Failed live save

- **Date:** 2026-10-26
- **Asked:** Settings slice 2 review (reviews/2026-10-26-settings-slice2-review.md); "When a live save fails, what should happen?" options: Keep, mark, ask (Recommended); Retry in background; Revert the field.
- **Answer:** "Keep, mark, ask (Recommended)"
- **Outcome:** keep the value, show a lasting state on the chip and the row, and ask retry or discard before switching presets or leaving Settings (R-07).

### DS-027 — Secrets in undo and restore points

- **Date:** 2026-10-26
- **Asked:** Settings slice 2 review (reviews/2026-10-26-settings-slice2-review.md); "Should secrets like a preset's proxy key be kept in undo history and restore points?" options: Never stored (Recommended); Stored encrypted; Stored as now.
- **Answer:** "Never stored (Recommended)"
- **Outcome:** undo history and restore points skip secret fields; restoring says the key was left as is (R-09).

### DS-028 — Undo for folder delete and bulk move

- **Date:** 2026-10-26
- **Asked:** Settings slice 2 review (reviews/2026-10-26-settings-slice2-review.md); "Can deleting a folder and moving many presets at once be undone?" options: Yes, same undo (Recommended); Folder delete asks only; No.
- **Answer:** "Yes, same undo (Recommended)"
- **Outcome:** folder delete and bulk move join the DS-024 undo stack.

### DS-029 — Preset for regenerate/continue/swipe after a switch

- **Date:** 2026-10-26
- **Asked:** Settings slice 2 review (reviews/2026-10-26-settings-slice2-review.md); "After the preset changes while a reply is in progress, which preset do regenerate, continue and swipe use?" options: The one it started with (Recommended); The active preset; Ask once per reply.
- **Answer:** "The one it started with (Recommended)"
- **Outcome:** a message keeps the preset it was generated with for regenerate, continue and swipe.

### DS-030 — Chains and loadouts referencing a preset

- **Date:** 2026-10-26
- **Asked:** Settings slice 2 review (reviews/2026-10-26-settings-slice2-review.md); "When a deleted or renamed preset is used in a chain or a loadout, what should happen?" options: Show and drop with undo (Recommended); Block the delete; Leave dangling.
- **Answer:** "Show and drop with undo (Recommended)"
- **Outcome:** delete dialog lists chain and loadout uses; entries are dropped and undo restores them; renames update references.

### DS-031 — Name rules

- **Date:** 2026-10-26
- **Asked:** Settings slice 2 review (reviews/2026-10-26-settings-slice2-review.md); "What rules should preset and folder names follow?" options: 60 chars, warn on dupes (Recommended); Unique names enforced; No rules.
- **Answer:** "60 chars, warn on dupes (Recommended)"
- **Outcome:** 60-character limit on preset and folder names; duplicates warned on create, rename and folders, never blocked.

### DS-032 — Organisation in exports (spec O-1)

- **Date:** 2026-10-26
- **Asked:** Settings slice 2 review (reviews/2026-10-26-settings-slice2-review.md); "Should exports include folders and favourites?" options: Opt-in for bundles (Recommended); Never; Always.
- **Answer:** "Opt-in for bundles (Recommended)"
- **Outcome:** single export never includes folders/★; bundle export has '폴더·즐겨찾기 포함' checkbox, off by default.

### DS-033 — Ctrl+0 (spec O-4)

- **Date:** 2026-10-26
- **Asked:** Settings slice 2 review (reviews/2026-10-26-settings-slice2-review.md); "What should Ctrl+0 do?" options: Nothing (Recommended); Tenth slot; Open the switcher.
- **Answer:** "Nothing (Recommended)"
- **Outcome:** Ctrl+0 stays unassigned.

### DS-034 — How long 최근 삭제 keeps presets

- **Date:** 2026-10-26
- **Asked:** Settings slice 2 re-review (reviews/2026-10-26-settings-slice2-rereview.md); "How long should "최근 삭제" keep a deleted preset? (DS-024 said "until restart or 30 days", which conflict.)" options: 30 days (Recommended); Until restart; Until emptied.
- **Answer:** "30 days (Recommended)"
- **Outcome:** deleted presets stay in 최근 삭제 for 30 days, across restarts; refines DS-024.

### DS-035 — Locked values in single export

- **Date:** 2026-10-26
- **Asked:** Settings slice 2 re-review (reviews/2026-10-26-settings-slice2-rereview.md); "With a "프리셋을 바꿔도 유지" lock on, does exporting a single preset include the locked (shared) values?" options: Include shared values (Recommended); Omit them; Ask in export.
- **Answer:** "Include shared values (Recommended)"
- **Outcome:** single export writes the shared values currently in use for locked fields.

### DS-036 — Undo key for library actions

- **Date:** 2026-10-26
- **Asked:** Settings slice 2 re-review (reviews/2026-10-26-settings-slice2-rereview.md); "Which key undoes library actions (delete, move, rename)?" options: Ctrl+Z + Alt+Z, listed (Recommended); Ctrl+Z everywhere; Drop Alt+Z.
- **Answer:** "Ctrl+Z + Alt+Z, listed (Recommended)"
- **Outcome:** Ctrl+Z in the library, Alt+Z anywhere in Settings; both listed in 단축키 and tooltips; Alt+Z reserved (cannot be a slot key).

### DS-037 — Undo for create, duplicate, import

- **Date:** 2026-10-26
- **Asked:** Settings slice 2 re-review (reviews/2026-10-26-settings-slice2-rereview.md); "Should creating, duplicating and importing presets be undoable too?" options: Yes, all three (Recommended); Leave as is; Bundle imports only.
- **Answer:** "Yes, all three (Recommended)"
- **Outcome:** create, duplicate and import join the library undo stack.

### DS-038 — Particles after Latin-letter names

- **Date:** 2026-10-26
- **Asked:** Settings slice 2 re-review (reviews/2026-10-26-settings-slice2-rereview.md); "Korean particles after names ending in a Latin letter (e.g. "GPT-5으로/로") come out wrong half the time. How should messages handle them?" options: Rephrase, no particle (Recommended); (으)로 style; Keep letter table.
- **Answer:** "Rephrase, no particle (Recommended)"
- **Outcome:** messages that embed a name are worded so no particle follows the name; the helper stays only where the name is fixed copy.

### DS-039 — Slot key clash on capture

- **Date:** 2026-10-26
- **Asked:** Settings slice 2 final fix round (builder open question); "When assigning a Ctrl+1–9 key to a preset and that key already belongs to another preset, what should happen?" options: Swap the two (Recommended); Take it, other loses it; Remove key capture.
- **Answer:** "Swap the two (Recommended)"
- **Outcome:** capture of a taken key asks to swap; on yes the other preset gets this preset's old key (or none); undoable via the library stack.

### DS-040 — Settings slice 3 content

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 scoping; "The plan put "Connections & model choice" as slice 3 and "Parameters" as slice 4. Keep that order?" options: Connections & model (Recommended); Merge with parameters; Parameters first.
- **Answer:** "Connections & model (Recommended)"
- **Outcome:** slice 3 = provider connections, searchable model picker with capabilities, fix-it path for a missing key/model, sub/aux/fallback models; parameters stay in slice 4.

### DS-041 — Connections are named objects

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 scoping; "Today a provider's key and URL are loose fields under the model picker, with no "connection" object. How should connections work?" options: Named connections (Recommended); One per provider; Keep fields inline.
- **Answer:** "Named connections (Recommended)"
- **Outcome:** a connection = provider + key + URL + user-chosen name; several per provider allowed; a model is picked from a connection.

### DS-042 — Where the model can be changed

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 scoping; "Where should you be able to change the model? Today it's only in Settings, and the Ctrl+M hotkey is declared but does nothing." options: Settings + Ctrl+M (Recommended); Also from preset chip; Settings only.
- **Answer:** "Settings + Ctrl+M (Recommended)"
- **Outcome:** the picker lives in Settings and Ctrl+M opens the same picker from anywhere, chat included; changing the model edits the active preset, with undo as in slice 2. Not added to the preset chip menu.

### DS-043 — Fix-it path for failed replies

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 scoping; "When a reply fails because of a missing key, bad key or missing model, what should the fix-it path be?" options: Error card + jump (Recommended); Fix inside chat; Reason only.
- **Answer:** "Error card + jump (Recommended)"
- **Outcome:** the failed reply shows a short reason and a 고치기 button that opens the exact connection or model field, then returns to the chat to retry. Needs a chat-mockup hook (ask the main session).

### DS-044 — One models page

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 scoping; "Today the sub model, four per-task models (memory, translation, emotion, other) and five fallback lists are spread across two pages, and three hidden locks decide whether a preset switch changes them. How should they be shown?" options: One 'models' page (Recommended); Main only, rest advanced; Keep today's split.
- **Answer:** "One 'models' page (Recommended)"
- **Outcome:** main, sub, per-task and fallback models on one page as one list; rows default to 'same as main'; locked rows show '모든 프리셋 공통' like the slice 2 locks.

### DS-045 — Picker shows the whole catalog

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 scoping; "The picker today hides non-recommended models behind a checkbox and asks for confirmation on 'gray' (unconfirmed) models. In the new picker?" options: Show all, tag them (Recommended); Keep the checkbox; Recommended only.
- **Answer:** "Show all, tag them (Recommended)"
- **Outcome:** search covers every model; recommended first; unconfirmed/deprecated rows carry a tag and one-line reason; picking an unconfirmed model still asks once.

### DS-046 — Connection test on demand

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 scoping; "Should a connection have a 'test' button that checks the key and URL work?" options: Test on demand (Recommended); Test on save; No test.
- **Answer:** "Test on demand (Recommended)"
- **Outcome:** a 확인 button sends one tiny simulated request and shows ok / bad key / unreachable; nothing runs automatically.

### DS-047 — Saved keys masked

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 scoping; "How should saved keys be shown once entered?" options: Masked, last 4 (Recommended); Masked with reveal; Follow today's setting.
- **Answer:** "Masked, last 4 (Recommended)"
- **Outcome:** shown as •••• plus the last 4 characters; no reveal; replacing means pasting a new key.

### DS-048 — Custom models under their connection

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 scoping; "Custom models are edited today in Advanced, far from the picker. Where should they go?" options: Under their connection (Recommended); Own page; Keep in Advanced.
- **Answer:** "Under their connection (Recommended)"
- **Outcome:** custom models are added and edited on their connection ('모델 추가') and show in the picker with a '직접 추가' tag.

### DS-049 — Deleting a connection in use

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 scoping; "What happens when you delete a connection that presets still use?" options: List users, undo (Recommended); Block until reassigned; Delete silently.
- **Answer:** "List users, undo (Recommended)"
- **Outcome:** the dialog names the presets that use it; afterwards those presets show a fix-it mark; the delete is undoable like slice 2 deletes, but the key is not kept in undo history (DS-027), so undo asks for the key again.

### DS-050 — Capabilities in the picker

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 scoping; "How should model capabilities (vision, tools, reasoning, context length, etc.) appear in the picker?" options: Icons + filter (Recommended); Details only; Text tags.
- **Answer:** "Icons + filter (Recommended)"
- **Outcome:** rows show lucide icons for key capabilities and the context length; filter chips narrow the list; a details panel lists the rest in plain words.

### DS-051 — Per-task model defaults

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 review (reviews/2026-10-27-settings-slice3-review.md); "Per-task models with nothing set (장기 기억, 번역, 감정 이미지, 기타): which model should they use? Today the sub model handles emotion images and auto suggest." options: Mixed, row names it (Recommended); All use main model; All use sub model.
- **Answer:** "Mixed, row names it (Recommended)"
- **Outcome:** unset 감정 이미지 and 자동 제안 use the sub model (main if the sub model is empty); 장기 기억, 번역, 기타 use the main model; every row names the model that will actually run. Refines DS-044.

### DS-052 — Choosing a model whose connection failed its check

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 review (reviews/2026-10-27-settings-slice3-review.md); "May you choose a model whose connection failed its last 확인 (unreachable or over quota), as opposed to one with no key?" options: Yes, with warning (Recommended); Yes after confirm; No.
- **Answer:** "Yes, with warning (Recommended)"
- **Outcome:** choosable, with the stored check result on the row; only a missing key blocks choosing.

### DS-053 — Models hidden by the connected-only chip

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 review (reviews/2026-10-27-settings-slice3-review.md); "With "연결된 모델만" on by default, models without a connection disappear, and searching for one says "no match". What should happen?" options: Show '{n}개 숨김' + hint (Recommended); Chip off by default; Keep hidden.
- **Answer:** "Show '{n}개 숨김' + hint (Recommended)"
- **Outcome:** a visible '{n}개 숨김' row and a search hint when hidden models match; with no connections (first run) the chip starts off.

### DS-054 — Model binding with several connections per provider

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 review (reviews/2026-10-27-settings-slice3-review.md); "When a provider has several connections (e.g. two OpenAI-compatible servers), how do models belong to them?" options: Each lists all (Recommended); User assigns; Fetched lists only.
- **Answer:** "Each lists all (Recommended)"
- **Outcome:** every connection of a provider lists the whole catalog; a preset stores the (connection, model) pair.

### DS-055 — When the chat return row appears

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 review (reviews/2026-10-27-settings-slice3-review.md); "When should the chat's "설정을 바꿨어요 · 다시 시도할까요?" row (DD-132) appear after coming back from Settings?" options: After a relevant change (Recommended); Only after the fix; Always.
- **Answer:** "After a relevant change (Recommended)"
- **Outcome:** after any Settings change that can affect the failing request (key, address, model, connection); the card's own 다시 시도 is always there.

### DS-056 — 고치기 targets for quota and network

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 review (reviews/2026-10-27-settings-slice3-review.md); "What should 고치기 open for quota errors and for network errors on a self-set address?" options: Detail + address row (Recommended); Key field for both; No 고치기 for either.
- **Answer:** "Detail + address row (Recommended)"
- **Outcome:** quota opens the connection detail with its check result and "다른 모델 고르기"; network errors on address-based providers (호환, Ollama, …) open the 주소 row; hosted providers' network errors get no 고치기.

### DS-057 — Undo of a connection delete does not navigate

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 review (reviews/2026-10-27-settings-slice3-review.md); "After undoing a connection delete, should Settings jump you to that connection's key field?" options: Stay, mark, '키 넣기' (Recommended); Jump to key field.
- **Answer:** "Stay, mark, '키 넣기' (Recommended)"
- **Outcome:** undo leaves you where you are; the card shows 키 다시 입력 필요 and the undo toast gets a "키 넣기" action.

### DS-058 — Environment-reference keys survive undo

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 review (reviews/2026-10-27-settings-slice3-review.md); "If the deleted connection's key was an environment reference like ${NAME} (a name, not a secret), should undo restore it?" options: Restore it (Recommended); Treat as a key.
- **Answer:** "Restore it (Recommended)"
- **Outcome:** undo restores a ${NAME} reference and the delete dialog says so; real keys are still not restored (DS-027).

### DS-059 — Provider routing options live in the connection

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 review (reviews/2026-10-27-settings-slice3-review.md); "OpenRouter and NanoGPT have provider-routing options (provider order, only/ignore, fallbacks). Where should they live?" options: In the connection (Recommended); Parameters (slice 4).
- **Answer:** "In the connection (Recommended)"
- **Outcome:** on that connection's detail page, shown only when such a connection exists. Closes spec O-3.

### DS-060 — Migrating reverse-proxy settings

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 review (reviews/2026-10-27-settings-slice3-review.md); "Existing setups where presets use different reverse-proxy addresses/keys get migrated into connections. How?" options: Merge same address (Recommended); 프록시 1…n.
- **Answer:** "Merge same address (Recommended)"
- **Outcome:** one connection per distinct address + key pair, named after the address host, with a one-time notice listing them for renaming. Closes spec O-2.

### DS-061 — Provider options stored per connection

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 re-review (reviews/2026-10-27-settings-slice3-rereview.md); "OpenRouter, NanoGPT, NovelAI and Ooba option values (routing, etc.) now sit inside the connection, but two OpenRouter connections still share one value. Store them how?" options: Per connection (Recommended); Per provider, labelled.
- **Answer:** "Per connection (Recommended)"
- **Outcome:** each connection keeps its own option values; a second OpenRouter connection can route differently.

### DS-062 — Return language after a change in Settings

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 re-review (reviews/2026-10-27-settings-slice3-rereview.md); "If you change the language in Settings during a 고치기 visit, which language should the chat come back in?" options: Your last choice (Recommended); The incoming one.
- **Answer:** "Your last choice (Recommended)"
- **Outcome:** the return link carries the language the user last chose; the incoming lang applies until then.

### DS-063 — Model and row in the 고치기 link

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 re-review (reviews/2026-10-27-settings-slice3-rereview.md); "For a missing model, Settings can't tell which model failed or which row (main, sub, a per-task row), so it names the current main model. Add that to the chat link?" options: Add model and row (Recommended); Model only; Neither.
- **Answer:** "Add model and row (Recommended)"
- **Outcome:** the 고치기 link gains model=<id> and row=main|sub|mem|trans|emo|suggest|other; Settings names the failed model and opens the picker for that row. Shared link shape: needs the main session's agreement.

### DS-064 — Fix offer when a sibling connection has the model

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 re-review (reviews/2026-10-27-settings-slice3-rereview.md); "A preset's connection was deleted, but the same provider has another connection with the same model. What should its fix offer?" options: Picker, sibling first (Recommended); Offer one-tap rebind; Add connection.
- **Answer:** "Picker, sibling first (Recommended)"
- **Outcome:** 고치기 opens the picker with the same model under the sibling connection at the top; delete still never re-binds by itself (DS-049).

### DS-065 — Naming the connection beside a model

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 re-review (reviews/2026-10-27-settings-slice3-rereview.md); "When the same model appears under two connections, toasts and summaries read "Claude Sonnet 4.5, Claude Sonnet 4.5". Where should the connection be named?" options: Only when ambiguous (Recommended); Always.
- **Answer:** "Only when ambiguous (Recommended)"
- **Outcome:** toasts, undo text and fallback summaries add '· {connection}' only when the same model name appears under more than one connection.

### DS-066 — After 연결 추가하고 쓰기

- **Date:** 2026-10-27
- **Asked:** Settings slice 3 re-review (reviews/2026-10-27-settings-slice3-rereview.md); "After "연결 추가하고 쓰기" (a model with no connection), what should happen once the new connection is saved?" options: Reopen picker (Recommended); Use it at once.
- **Answer:** "Reopen picker (Recommended)"
- **Outcome:** return to the picker with that model focused under the new connection; one more tap chooses it.

### DS-067 — Store-first screens (live multi-tab readiness)

- **Date:** 2026-10-27
- **Asked:** not asked here; a maintainer rule relayed by Lane A [8a3066] ("so that live multi-tab updates stay possible later; multi-session itself is parked").
- **Answer:** "Screens read character, chat, module and settings data from the store by ID or key, and keep no long-lived copies of it. Unsaved input lives in drafts held apart from the live data. Derived values are recomputed from the store, not cached in components."
- **Outcome:** a standing rule for every Settings slice from slice 4 on, and for any later edit to slices 1–3. Mockups keep one synthetic store, look things up by ID or key at render time, and hold edits in a draft object until saved. Preset, connection and model references are already stored by ID (DS-030, DS-054). Slices 1–3 have not been audited against this rule. Integration maps name the store reads.

### DS-068 — Connections and upstream .bin: translate at export

- **Date:** 2026-10-27
- **Asked:** not asked here. A maintainer decision relayed by Lane A as MC-772, answering ENGINE_CHANGES.md item 3-1.
- **Answer:** "Translate at .bin export. The new connections shape lives in our own storage and the fork-only .rtb backup. Upstream .bin export writes the legacy upstream fields derived from connections. Importing an upstream .bin runs the migration into connections. The upstream round trip must keep working both ways, and on Android the migration is an automatic forward migration that never overwrites data a build can't read."
- **Outcome:**
  - The design of connections, DS-041 and DS-054, stands as specified.
  - The migration in DS-060 also runs on every upstream `.bin` import, not only once.
  - No design may depend on a one-way migration.
  - Open for implementation (not a mockup question): when two connections of one provider exist, which one an upstream `.bin` export writes into the single legacy field.

### DS-069 — Keys in exports: sharing exports only

- **Date:** 2026-10-27
- **Asked:** not asked here. A maintainer decision relayed by Lane A as MC-772, answering ENGINE_CHANGES.md item 3-3.
- **Answer:** "Strip keys only from exports meant for sharing (preset bundles, cards, modules), keeping the ${NAME} placeholders. Full backups (.rtb and .bin) keep keys. .rtb gets optional password encryption (MC-698)."
- **Outcome:**
  - DS-027 (undo and restore points) and DS-047 (masked display) are unchanged.
  - Exports meant for sharing strip keys and keep `${NAME}`.
  - Full backups keep keys.
  - The slice 3 `keyLocal` copy ("…실행 취소·복원 지점·내보내기에 들어가지 않아요", "…never in undo, restore points or exports") is now wrong. The theme fix round corrects it in SLICE3_SPEC.md §2 and §9 and in slice3.js: keys are not kept in undo or restore points and are not written into exports meant for sharing, while full backups keep them.

### DS-070 — Fork-only data and upstream .bin

- **Date:** 2026-10-27
- **Asked:** not asked here. A maintainer ruling relayed by Lane A as MC-774, extending DS-068.
- **Answer:** "Where upstream has an equivalent, .bin export translates to upstream's shape. Fork-only data with no upstream equivalent stays in our own storage and the .rtb backup, and is left out of .bin, with an export warning naming what's left out. Importing an upstream .bin always works."
- **Outcome:** this applies to ENGINE_CHANGES.md items:
  - 2-1: preset ids, folders, favourites, slots and lastUsed;
  - 2-3: undo history and restore points;
  - 2-4: 최근 삭제;
  - 2-5: the lock store;
  - 3-5: the recent-models list.

  For locks, INFERRED: export writes the shared values into each preset, as DS-035 already does.

  Chains and loadouts stored by id translate back to upstream's name or position form on export, INFERRED.

  The export warning is a later design item; it belongs with backup and export, not to slices 1–3.

### DS-071 — Contrast gate for packs

- **Date:** 2026-10-27
- **Asked:** Settings theme review (reviews/2026-10-27-settings-theme-review.md, T-01, Q2); "Settings theme review T-01: under Origin Navy, some rendered text fails 4.5:1 (danger text on raised surfaces 3.97–4.11, search highlight 3.95, placeholder 2.40), and the token-pair check missed it. What should the contrast gate for packs be?" Options: Rendered check (Recommended); Extend token pairs; Leave to pack review.
- **Answer:** "Rendered check (Recommended)"
- **Outcome:**
  - The `th` suite gains a rendered check. Across the tour states it measures text in screenshots: 4.5:1 for text and 3:1 for non-text.
  - It adds a `--color-placeholder` token and fixes the Navy values that fail.
  - The chat suite should get the same check, and `--color-placeholder` is a candidate shared name. Both belong to the main session, which has been told.

### DS-072 — Which Settings prompts are protected

- **Date:** 2026-10-27
- **Asked:** Settings theme review (T-03, Q3); "Which Settings prompts should be protected from pack restyling? DD-149 already protects anything with a danger button or that drops data." Options: Data-loss + confirms (Recommended); Only data loss.
- **Answer:** "Data-loss + confirms (Recommended)"
- **Outcome:**
  - These get `data-part-critical` and their own child part names:
    - the save-failed retry;
    - the Undo toast after a delete;
    - the lock-off ask;
    - the key swap;
    - the slot take.
  - Danger rows are protected when their dialog opens.
  - Dialog backdrops are marked too (T-02).

### DS-073 — Baseline flattens transparency

- **Date:** 2026-10-27
- **Asked:** Settings theme review (builder finding 6); "In the default Deep Nexus look, low-power mode keeps the header and surfaces semi-transparent (only the packs flatten them). Should the baseline itself flatten transparency in low-power mode and under 'reduce transparency'?" Options: Flatten in baseline (Recommended); Packs only.
- **Answer:** "Flatten in baseline (Recommended)"
- **Outcome:**
  - In Deep Nexus, low-power mode and `prefers-reduced-transparency` swap glass surfaces for opaque tokens.
  - This is a deliberate change to the default look in those modes only, and the handoff records it.

### DS-074 — Packs may move the Settings index

- **Date:** 2026-10-27
- **Asked:** Settings theme review (builder finding 4); "A pack can't move the Settings index to the other side today: column widths and offsets are fixed in the layout. Should packs be able to?" Options: Yes, via tokens (Recommended); Not now.
- **Answer:** "Yes, via tokens (Recommended)"
- **Outcome:**
  - New role tokens for the index side and column widths, and the `left:` offsets are dropped. A pack can then put the index on the right.
  - DOM and focus order stay the same.
  - The `.idx-li.cur` source-order tie gets a real specificity fix.

**Design defaults taken with this round, not asked:** the review's Q1, Q5 and Q6 are settled by DD-149, DD-153, DD-155 and DD-145–148. Q4 and Q7 are Settings-only, and I took the reviewer's recommendation:
- `data-overlay` is a single value, with priority dialog > picker > switcher. The picker's extra `sw-open` is dropped.
- JS timers follow `transitionend`.
- Breakpoints become custom properties, read once.

### DS-075 — Pack install rule bounds values

- **Date:** 2026-10-27
- **Asked:** Settings theme re-review (reviews/2026-10-27-settings-theme-rereview.md, R-01, R-02, Q1). The question: "Theme re-review R-01/R-02: the pack-install rule checks selectors but not values. A pack can still set dialog padding to 400px (Delete shows, message is 0 px), a 60 s fade (dialog at opacity 0.01), or color:black on Cancel (1.29:1). How strict should the rule be on values?" Options: Bound values (Recommended); Clamp in app CSS; Human review only.
- **Answer:** "Bound values (Recommended)"
- **Outcome:**
  - The install rule now checks values on critical surfaces as well as selectors:
    - It bounds the role tokens they use: padding, widths, gaps, page and column widths, and durations up to about 600 ms.
    - The safe tier gets a short declaration list, with no `position`, no `inset`, no large sizes and no negative margins.
    - It resolves named colours and tests backgrounds against critical text.
    - Part lists become parameters.
  - Settings implements this in its own `packlint-settings.mjs`.
  - Changing chat's shared `packlint.mjs` is the main session's job.

### DS-076 — Origin Navy: upstream's scheme, adjusted for AA

- **Date:** 2026-10-27
- **Asked:** Settings theme re-review (R-05, Q3). The question: "Origin Navy uses upstream's colours (DD-150), but upstream's danger red and field edge fail AA on Navy's surfaces. The fix round changed them (danger #ff6e6e, edge #7482b8). Which way?" Options: Keep AA, amend DD-150 (Recommended); Exact upstream; Lift surfaces.
- **Answer:** "Keep AA, amend DD-150 (Recommended)"
- **Outcome:**
  - The two colour changes stay.
  - DD-150 should read "upstream's scheme, adjusted for AA". That is an amendment for the main session to make.
  - The two Settings alphas are not counted as deviations.

### DS-077 — Deep Nexus meets the contrast it asks of packs

- **Date:** 2026-10-27
- **Asked:** Settings theme re-review (R-09, Q4). The question: "The default Deep Nexus look itself fails the contrast it now asks of packs: off-switch track 1.62:1, field border 1.80:1, placeholder 3.79:1 (applies to chat too). Raise them?" Options: Raise them (Recommended); Leave, record.
- **Answer:** "Raise them (Recommended)"
- **Outcome:**
  - The off track and the field border go to at least 3:1, and the placeholder to at least 4.5:1, on their real surfaces.
  - This is a recorded, visible change on every screen.
  - The shared value lives in theme/nexus-tokens.css, which the main session owns. Settings applies only its own tokens and proposes the shared values.

### DS-078 — Focus rings: inset on full-bleed rows, with a rendered check

- **Date:** 2026-10-27
- **Asked:** Settings theme re-review (R-03, R-04, Q6). The question: "R-03: keyboard focus is invisible on some full-width rows (e.g. 연결 지우기) because the ring is clipped: 18 clipped rings in 6 states, in the default look too. How should it be fixed?" Options: Inset ring + check (Recommended); Unclip rows.
- **Answer:** "Inset ring + check (Recommended)"
- **Outcome:**
  - Full-bleed rows and segmented controls get an inset focus ring.
  - A rendered "ring pixels" check is added.
  - The contrast gate runs at 360 and 1280 and includes `ps-library-select`. The chat suite may adopt it.

**Design defaults taken with these answers, not asked:**
- Re-review Q2: THEMING rule 3 names warnings, so these are marked critical, with part names for `.c3-cwarn` and `.mp-warn` (option A):
  - card warnings;
  - test results (`badkey`, `unreachable`, `quota`);
  - the picker warning;
  - the deeplink banner.
- Re-review Q5: the key line says only what DS-069 says, in both languages (option A).

### DS-079 — Slice 4 scope

- **Date:** 2026-10-27
- **Asked:** Slice 4 scoping (research/today-settings.md §4). The question: "Slice 4 (parameters): what's in scope? Today the Parameters tab has the core controls (temperature, top P/K, penalties, max response/context, reasoning, thinking, verbosity, seed), and the Others tab has bias, additional parameters, custom flags and tools." Options: Core + advanced (Recommended); Core only; Core + provider blocks.
- **Answer:** "Core + advanced (Recommended)"
- **Outcome:** the page holds the core sampling controls and an 고급 section for bias, additional parameters, custom flags and tools. Prompt authoring stays with Studio (DD-094).

### DS-080 — Unsupported parameters

- **Date:** 2026-10-27
- **Asked:** Slice 4 scoping. The question: "When the chosen model doesn't support a parameter, today it silently disappears (its stored value stays). What should the page do?" Options: Dim with reason (Recommended); Collapse into a row; Hide as today.
- **Answer:** "Dim with reason (Recommended)"
- **Outcome:** an unsupported row stays visible but dimmed, with "이 모델은 안 써요 · 값은 그대로" and the model name. The value is kept, and it is used again after switching back.

### DS-081 — Explaining parameters

- **Date:** 2026-10-27
- **Asked:** Slice 4 scoping. The question: "How should parameters be explained?" Options: Plain line + effect (Recommended); Add quick styles; Help on demand.
- **Answer:** "Plain line + effect (Recommended)"
- **Outcome:**
  - Each row shows:
    - one plain sentence;
    - a low/high hint, e.g. "낮을수록 일관되고, 높을수록 다양해요";
    - the default value;
    - an expandable longer help.
  - No quick-style chips.

### DS-082 — Per-task parameters beside the task

- **Date:** 2026-10-27
- **Asked:** Slice 4 scoping. The question: "Per-task parameters (장기 기억, 감정 이미지, 번역, 기타) are today a checkbox plus four accordions on the Parameters tab. Where should they live now that the 모델 page has per-task model rows (DS-044)?" Options: Beside the task (Recommended); Tabs on Parameters.
- **Answer:** "Beside the task (Recommended)"
- **Outcome:** each task row on the 모델 page reads "매개변수: 주 모델과 같음 / 따로". "따로" opens that task's parameters. The global `seperateParametersEnabled` checkbox is retired.

### DS-083 — Service-specific samplers

- **Date:** 2026-10-27
- **Asked:** Slice 4 scoping. The question: "Ooba / textgen, NovelAI and NovelList each have their own hard-coded sampler block today (8, 14 and 7 sliders, raw labels, no help). How should slice 4 treat them?" Options: Same rows, own group (Recommended); Separate sub-page; Restyle only.
- **Answer:** "Same rows, own group (Recommended)"
- **Outcome:** these samplers use the same row style and explanations, in a group "이 서비스 전용". The group shows only when the main model uses that connection.

### DS-084 — Not sending a parameter

- **Date:** 2026-10-27
- **Asked:** Slice 4 scoping. The question: "Some parameters can be 'not sent' (today a hidden -1000 sentinel), letting the provider use its own default. How should that show?" Options: Explicit '보내지 않음' (Recommended); Slider end stop.
- **Answer:** "Explicit '보내지 않음' (Recommended)"
- **Outcome:** each row that can be left out gets a "보내기" switch. Off means "서비스 기본값 사용": the slider dims and keeps its value.

### DS-085 — Values out of a model's range

- **Date:** 2026-10-27
- **Asked:** Slice 4 scoping. The question: "When you switch to a model whose limits a value breaks (e.g. max response 8000 > the new model's 4096), what happens?" Options: Keep, warn, one-tap fix (Recommended); Clamp with toast; Ask on switch.
- **Answer:** "Keep, warn, one-tap fix (Recommended)"
- **Outcome:**
  - The stored value stays.
  - The row says "이 모델은 최대 4096" and offers "4096으로 맞추기".
  - Until the user fixes it, requests use the model's maximum.

### DS-086 — Reset for parameters

- **Date:** 2026-10-27
- **Asked:** Slice 4 scoping. The question: "What should '기본값으로' reset a parameter to? DS-010 limited reset to rows with a known default and left preset-scoped rows to this slice." Options: App default (Recommended); No reset, undo only.
- **Answer:** "App default (Recommended)"
- **Outcome:** parameter rows get the changed dot and 기본값으로. The default is the new-preset default from today's code, and a reset can be undone. This extends DS-010 to preset-scoped parameter rows.

### DS-087 — Which default 기본값으로 resets to

- **Date:** 2026-10-28
- **Asked:** Slice 4 spec (research/slice4-params.md §1). The question: "'기본값으로' (DS-086) resets to the new-preset default, but today's code has three different ones: the + button copies the OAI2 preset (temperature 1.00, context 16000, response 1000), presetTemplate has 0.80 / 4000 / 300, and load fallbacks 0.80 / 4000 / 500. Which should reset use?" Options: What + gives (Recommended); presetTemplate; Service default.
- **Answer:** "What + gives (Recommended)"
- **Outcome:** the reset target is what a preset made with + gets today (`prebuiltPresets.OAI2`). Fields OAI2 leaves out get neutral values: repetition penalty 1, min P 0 and top A 0. This refines DS-086.

### DS-088 — Where a model's output limit comes from

- **Date:** 2026-10-28
- **Asked:** Slice 4 spec (research/slice4-params.md §3). The question: "DS-085 warns when max response is over the model's limit, but the app has no per-model output limit today (max response is capped at 2048 for every model). Where should the limit come from?" Options: Model data if known (Recommended); Keep 2048 cap; Hand-kept table.
- **Answer:** "Model data if known (Recommended)"
- **Outcome:**
  - The limit comes from the downloaded model data (LiteLLM's `max_output_tokens`) where it exists.
  - With no data there is no output warning; the field is bounded only by the context size.
  - The fixed 2048 cap is retired.
  - DS-085's warning and fix apply only when a limit is known.

### DS-089 — What 매개변수: 따로 starts with

- **Date:** 2026-10-28
- **Asked:** Slice 4 spec (research/slice4-params.md §6). The question: "When a task (장기 기억, 감정 이미지, 번역, 기타) is switched to '매개변수: 따로' (DS-082), what should its own values start as?" Options: Copy of main (Recommended); Empty (service).
- **Answer:** "Copy of main (Recommended)"
- **Outcome:** switching a task to 따로 copies the main preset's current values, which are then edited freely. Switching back to 같음 keeps the copy for next time; the task uses the main values while it is 같음.

### DS-090 — Frequency and presence penalty range

- **Date:** 2026-10-28
- **Asked:** Slice 4 review (reviews/slice4-review.md, builder question 1, SLICE4_SPEC O-3). The question: "Slice 4: what range should frequency and presence penalty have? (Today the store is 0..200 shown as 0..2, with no way to save a negative.)" Options: Keep 0..2 (Recommended); Signed per provider; −2..2 for all, with note.
- **Answer:** "Keep 0..2 (Recommended)"
- **Outcome:** both penalties stay 0..2 (stored 0..200 as today, shown as 0.00–2.00 everywhere, per-task sliders included). The builder's −2..2 range is reverted; no store change.

### DS-091 — Output-limit source

- **Date:** 2026-10-28
- **Asked:** Slice 4 review (builder question 2). The question: "Where does a model's output limit come from, beyond the downloaded model data (DS-088)?" Options: Model data only (Recommended); Plus fallback table; Plus user override.
- **Answer:** "Model data only (Recommended)"
- **Outcome:** DS-088 stands with no additions: limits come only from model data; an unknown limit gives no warning, no built-in table and no user override.

### DS-092 — Where the NovelAI and NovelList sampler rows live

- **Date:** 2026-10-28
- **Asked:** Slice 4 review (builder question 3). The question: "Where should the NovelAI and NovelList sampler rows live?" Options: Here, own group (Recommended); Under the connection; Here, collapsed.
- **Answer:** "Here, own group (Recommended)"
- **Outcome:** they stay on the 파라미터 page in the 이 서비스 전용 group, shown only when that service is in use, as specced.

### DS-093 — Seed scope

- **Date:** 2026-10-28
- **Asked:** SLICE4_SPEC O-1. The question: "Seed: should it stay global, or belong to each preset?" Options: Global, with badge (Recommended); Per preset.
- **Answer:** "Global, with badge (Recommended)"
- **Outcome:** the seed stays global as today; its row carries the 모든 프리셋 공통 badge.

### DS-094 — All-unsupported groups

- **Date:** 2026-10-28
- **Asked:** Slice 4 review (builder collapsed groups whose rows are all unsupported). The question: "When every row in a group is unsupported by the current model, should the group collapse? (DS-080 chose dimming over collapsing for single rows.)" Options: Never collapse (Recommended); Collapse the group.
- **Answer:** "Never collapse (Recommended)"
- **Outcome:** groups never collapse for support; every unsupported row is dimmed with its reason, as DS-080. The builder's group collapse is removed.

### DS-095 — Request preview

- **Date:** 2026-10-28
- **Asked:** SLICE4_SPEC O-2 and review R4-14. The question: "Should the request preview become a product feature?" Options: Mockup aid only (Recommended); Product, as estimate.
- **Answer:** "Product, as estimate"
- **Outcome:** a '보낼 값 보기' panel becomes part of the design, clearly labelled an estimate rather than the exact request. It shows only what the page's values would send (not-sent and unsupported values left out, with why); integration notes say it is built from the same send rules, not captured from a real request.

### DS-096 — Editing a not-sent parameter

- **Date:** 2026-10-28
- **Asked:** Slice 4 review R4-3. The question: "What happens when someone drags or types on a parameter whose 보내기 is off?" Options: Explain only (Recommended); Auto-turn 보내기 on.
- **Answer:** "Explain only (Recommended)"
- **Outcome:** the value does not change; a short announced message says to turn 보내기 on first. 보내기 is never switched on by itself.

### DS-097 — Pack power over parameter rows

- **Date:** 2026-10-28
- **Asked:** Slice 4 review R4-2 / R4-11. The question: "Can a theme pack hide the 보내기 switch, the reason line, the global badge and the value field?" Options: Protect them (Recommended); Leave as safe leaves.
- **Answer:** "Protect them (Recommended)"
- **Outcome:** the 보내기 switch, the reason line, the global badge and the value field are protected (critical-style: a pack cannot hide them), and the dim-opacity token is clamped to a visible minimum by the pack rule.

### DS-098 — Pack floors for slice 4 tokens (index of DD-187)

- **Date:** 2026-10-28
- **Asked:** by the main session (recorded there as DD-187 in docs/design/DECISIONS.md), after chat's lintPack gained `minimums` (DD-182). The question was whether `--param-warn-bar` and `--nexus-field-border` should get a floor a pack can't go below.
- **Answer:** "Floor the warn bar only (Recommended)" (as relayed by the main session)
- **Outcome:** `--param-warn-bar` gets a `minimums` floor in checks/th4/registry4.mjs. `--nexus-field-border` gets no floor and keeps only its contrast check. The DS-097 dim-opacity clamp uses the same mechanism.

### DS-099 — How faint a dimmed control may get

- **Date:** 2026-10-28
- **Asked:** Slice 4 re-review (reviews/slice4-rereview.md). The question: "Slice 4: how faint may a dimmed (unsupported or not-sent) control get? Its kept value text is about 3.7:1 contrast at 0.4." Options: 0.4 (Recommended); 0.5.
- **Answer:** "0.4 (Recommended)"
- **Outcome:** the `--param-dim-opacity` floor stays 0.4 (DS-097/DS-098), matching the app's disabled style; dimmed controls rely on the WCAG inactive-control exemption, and the row's label, reason line and value field label stay at full contrast.

### DS-100 — How slice 5 is cut

- **Date:** 2026-10-28
- **Asked:** Slice 5 start (maintainer request: "start next setting item. iirc there was slice 5?"). The question: "Slice 5 is the pages still marked 'later': 대화 기능 (memory, voice, emotion images, image generation, which is today's largest page), 페르소나, 확장 (plugins and modules) and 단축키. How should it be cut?" Options: 5a lists, 5b chat features (Recommended); One slice, everything; Chat features first.
- **Answer:** "5a lists, 5b chat features (Recommended)"
- **Outcome:** slice 5a = 단축키, 페르소나, 확장; slice 5b = 대화 기능 on its own. (DS-105 adds 5c.)

### DS-101 — Refining the pages slice 1 already drew

- **Date:** 2026-10-28
- **Asked:** Slice 5 start. The question: "The pages slice 1 already drew in row style (화면·읽기, 입력·접근성, 언어, 데이터·백업, 고급): touch them in slice 5?" Options: Only known gaps (Recommended); Full refine pass; Leave as is.
- **Answer:** "Full refine pass"
- **Outcome:** each of those pages gets its grouping and copy re-examined, not just gap fixes; scheduled as slice 5c (DS-105).

### DS-102 — How deep 확장 goes

- **Date:** 2026-10-28
- **Asked:** Slice 5 start. The question: "How deep should 확장 (plugins and modules) go?" Options: Library only (Recommended); Library + module editor.
- **Answer:** "Library + module editor"
- **Outcome:** slice 5a covers the plugin and module libraries and a module editor; DS-104 sets what that editor owns.

### DS-103 — 단축키 page

- **Date:** 2026-10-28
- **Asked:** Slice 5 start. The question: "단축키: what should the page do beyond a restyle?" Options: Rebind, conflicts, reset (Recommended); Restyle only.
- **Answer:** "Rebind, conflicts, reset (Recommended)"
- **Outcome:** press-to-record keys, conflict warnings, reset one or all to defaults, the Ctrl+1–9 preset keys listed with the rest; phones get a read-only list (SLICE1_SPEC §3.2).

### DS-104 — What the module editor in 확장 owns

- **Date:** 2026-10-28
- **Asked:** Slice 5 start, follow-up to DS-102. The question: "Studio already edits a module's contents (its lorebook, regex, triggers, scripts and toggles in the owner tree). What should the module editor in 확장 own?" Options: Module info; contents in Studio (Recommended); Full editor in Settings.
- **Answer:** "Module info; contents in Studio (Recommended)"
- **Outcome:** the Settings module editor edits name, description, namespace, assets, MCP and export; an "Open in Studio" button (Studio에서 열기) opens that module in Studio. No second contents editor.
- **Follow-up (2026-10-28, maintainer, unprompted):** "To add on module idea: module info with "Open in studio" button feels like a better approach." The module page in 확장 is a module *info* page with an "Open in Studio" button, not an editor with a contents link.

### DS-105 — Where the refine pass goes

- **Date:** 2026-10-28
- **Asked:** Slice 5 start, follow-up to DS-101. The question: "Where does the full refine pass of the slice 1 pages (화면·읽기, 입력·접근성, 언어, 데이터·백업, 고급) go?" Options: Its own slice 5c (Recommended); Inside 5a.
- **Answer:** "Its own slice 5c (Recommended)"
- **Outcome:** order is 5a (단축키, 페르소나, 확장), 5b (대화 기능), 5c (refine pass).

### DS-106 — How a hotkey is recorded, and conflicts

- **Date:** 2026-10-28
- **Asked:** Slice 5a discovery (research/slice5a-lists.md §7), Q1. The question: "단축키: how is a key recorded, and what happens on a conflict? (Today: Ctrl/Shift/Alt are toggle buttons plus a key box, and duplicates are allowed silently.)" Options: Record chord, warn + swap offer (Recommended); Record chord, block duplicates; Keep toggles, add warning.
- **Answer:** "Record chord, warn + swap offer (Recommended)"
- **Outcome:** pressing the whole combo once records it (replacing the three toggles and key box). A combo already in use shows which action has it, with 바꾸기 (swap) or cancel.

### DS-107 — Ctrl+1–9, Esc and Enter on the 단축키 page

- **Date:** 2026-10-28
- **Asked:** Slice 5a discovery (research/slice5a-lists.md §7), Q2. The question: "The preset keys Ctrl+1–9 (and Esc/Enter) are hard-coded today. How should 단축키 show them?" Options: Rebindable rows (Recommended); Listed read-only; Leave them out.
- **Answer:** "Rebindable rows (Recommended)"
- **Outcome:** the nine preset-slot keys become ordinary rebindable rows (which preset sits in each slot stays per preset, DS-022); Esc and Enter are listed read-only.

### DS-108 — Hotkey actions with no handler

- **Date:** 2026-10-28
- **Asked:** Slice 5a discovery (research/slice5a-lists.md §7), Q3. The question: "Three hotkey actions do nothing today (model select, voice toggle, webcam). What should the page do with them?" Options: Hide them (Recommended); Show as unavailable; Wire them (engine change).
- **Answer:** "Hide them (Recommended)"
- **Outcome:** actions with no handler are not listed until they work. Note: model select (Ctrl+M) gets a handler from slice 3 (ENGINE_CHANGES 3-10), so it is listed once 3-10 lands; voice toggle and webcam stay hidden.

### DS-109 — Mac and per-device hotkeys

- **Date:** 2026-10-28
- **Asked:** Slice 5a discovery (research/slice5a-lists.md §7), Q4. The question: "Mac and per-device keys: hotkeys sync with the database today. What should change?" Options: Ctrl means Cmd on Mac, synced (Recommended); Plus per-device overrides; Leave as is.
- **Answer:** "Ctrl means Cmd on Mac, synced (Recommended)"
- **Outcome:** on Mac, Ctrl in a binding means ⌘ and is shown as ⌘; one synced set of keys for all devices, no per-device overrides.

### DS-110 — Persona list

- **Date:** 2026-10-28
- **Asked:** Slice 5a discovery (research/slice5a-lists.md §7), Q5. The question: "페르소나 list: today it's an icon-only grid with no names. What should it be?" Options: Cards with name (Recommended); Grid with names.
- **Answer:** "Cards with name (Recommended)"
- **Outcome:** cards with icon, name, the note's first line and how many chats use the persona; the active one is marked.

### DS-111 — Persona editing

- **Date:** 2026-10-28
- **Asked:** Slice 5a discovery (research/slice5a-lists.md §7), Q5. The question: "Persona editing: today edits apply live through a working copy. What should the editor do?" Options: Live, with undo (Recommended); Draft, Save/Revert.
- **Answer:** "Live, with undo (Recommended)"
- **Outcome:** edits save live like the rest of Settings; removing a persona gives an undo toast (DS-024 pattern).

### DS-112 — Plugin rows and install

- **Date:** 2026-10-28
- **Asked:** Slice 5a discovery (research/slice5a-lists.md §7), Q7. The question: "Plugins: what should a plugin row show, and how can plugins be installed?" Options: Version + API, file only (Recommended); Add author, file only; Version + API, file or URL.
- **Answer:** "Version + API, file only (Recommended)"
- **Outcome:** rows show version and API version from existing data; install stays file-only; no author field and no install from URL.

### DS-113 — Plugin safety

- **Date:** 2026-10-28
- **Asked:** Slice 5a discovery (research/slice5a-lists.md §7), Q8. The question: "Plugin safety: today there's one generic warning line. What should enabling a plugin show?" Options: Access line + confirm for risky (Recommended); Access line only; Keep the generic line.
- **Answer:** "Access line + confirm for risky (Recommended)"
- **Outcome:** each plugin shows a line saying what it can access; enabling a V2/V2.1 (full-access) plugin asks once.

### DS-114 — Low-level-access modules

- **Date:** 2026-10-28
- **Asked:** Slice 5a discovery (research/slice5a-lists.md §7), Q9. The question: "Modules with low-level access (can run powerful triggers): today the warning shows only at import. What should the module info page do?" Options: Badge + confirm on enable (Recommended); Badge only; As today.
- **Answer:** "Badge + confirm on enable (Recommended)"
- **Outcome:** a '고급 권한' badge on the module card and info page; turning such a module on asks once.

### DS-115 — Where a module is on

- **Date:** 2026-10-28
- **Asked:** Slice 5a discovery (research/slice5a-lists.md §7), Q10. The question: "A module can be on globally, through a preset, for a character, or for one chat. What should the info page show?" Options: All four, read + edit (Recommended); Global only; Global + read-only list.
- **Answer:** "All four, read + edit (Recommended)"
- **Outcome:** the info page has a '어디서 켜져 있나요' list: the global switch, plus the presets, characters and chats using the module, each changeable there or linked to where it is changed.

### DS-116 — Creating a module

- **Date:** 2026-10-28
- **Asked:** Slice 5a discovery (research/slice5a-lists.md §7), Q11. The question: "Creating a module: today an empty module is added at once. How should it work?" Options: Name dialog, then Open in Studio (Recommended); Create in Studio; As today.
- **Answer:** "Name dialog, then Open in Studio (Recommended)"
- **Outcome:** 새 모듈 opens a small name dialog; the module is added only on 만들기, then its info page offers Open in Studio.

### DS-117 — Deleting a module

- **Date:** 2026-10-28
- **Asked:** Slice 5a discovery (research/slice5a-lists.md §7), Q12. The question: "Deleting a module: what protection?" Options: Confirm with usage + undo (Recommended); Confirm with usage; Confirm only.
- **Answer:** "Confirm with usage + undo (Recommended)"
- **Outcome:** the confirm says how many characters and chats use the module, and an undo toast follows. (The option text cited DS-018 for the preset undo; the preset undo decision is DS-024.)

### DS-118 — Shortcuts without a modifier

- **Date:** 2026-10-28
- **Asked:** Slice 5a review (reviews/slice5a-review.md), Q1, R5-3. The question: "단축키: can a key with no modifier be a shortcut?" Options: Need a modifier or F-key (Recommended); Letters ok, not nav keys; Allow any.
- **Answer:** "Need a modifier or F-key (Recommended)"
- **Outcome:** every shortcut needs Ctrl/Alt/Shift plus a key, or an F-key; Space alone stays only for focus input. Bare letters, arrows, Backspace, Delete, Home, PageUp and similar are refused with a reason.

### DS-119 — Defaults Ctrl+L and Ctrl+X

- **Date:** 2026-10-28
- **Asked:** Slice 5a review (reviews/slice5a-review.md), Q2. The question: "Today's defaults Ctrl+L (log) and Ctrl+X clash with browser and editing keys. What should happen?" Options: Keep, note on the row (Recommended); Move to Ctrl+Alt.
- **Answer:** "Keep, note on the row (Recommended)"
- **Outcome:** the defaults stay; those rows carry a note that the browser or text editing may take the key first. Recording such a combo anew is still refused (SLICE5A §2.2).

### DS-120 — The physical Control key on a Mac

- **Date:** 2026-10-28
- **Asked:** Slice 5a review (reviews/slice5a-review.md), Q3, SLICE5A O-2, R5-4. The question: "On a Mac, what about the physical Control key (⌃) in shortcuts?" Options: ⌘ only, refuse ⌃ with hint (Recommended); Accept both; ⌃ as its own modifier.
- **Answer:** "⌘ only, refuse ⌃ with hint (Recommended)"
- **Outcome:** on Mac, Ctrl means ⌘ only (DS-109); a chord recorded with ⌃ is refused with 'Mac에서는 ⌘를 써요'. The Windows/Super key is never recorded as Ctrl.

### DS-121 — Per-character persona binding

- **Date:** 2026-10-28
- **Asked:** Slice 5a review (reviews/slice5a-review.md), Q4, SLICE5A O-1. The question: "Should a persona also bind to a character (today: per chat only)?" Options: Not in 5a (Recommended); Add, chat wins; Never.
- **Answer:** "Not in 5a (Recommended)"
- **Outcome:** persona binding stays per chat; per-character binding is not designed now and may be revisited later.

### DS-122 — What removing a plugin promises

- **Date:** 2026-10-28
- **Asked:** Slice 5a review (reviews/slice5a-review.md), Q5, SLICE5A O-3, R5-8. The question: "Removing a plugin: its own saved data may not come back with undo. What should removal promise?" Options: Undo, says data may not return (Recommended); Confirm only; Keep data until purge.
- **Answer:** "Undo, says data may not return (Recommended)"
- **Outcome:** plugin removal confirms, then gives an undo toast; the confirm says the plugin's own saved data may not come back. Personas and modules keep full undo, bindings and ids included.

### DS-123 — Module assets on the info page

- **Date:** 2026-10-28
- **Asked:** Slice 5a review (reviews/slice5a-review.md), Q6. The question: "A module's assets on its info page (DS-104):" Options: Count + Studio link (Recommended); Manage on info page; No count.
- **Answer:** "Count + Studio link (Recommended)"
- **Outcome:** the info page shows '에셋 n' as a link that opens Studio's 표시와 에셋; assets are not managed on the info page.

### DS-124 — When 'asks once' asks

- **Date:** 2026-10-28
- **Asked:** Slice 5a review (reviews/slice5a-review.md), Q7. The question: "'Asks once' for full-access plugins and low-level modules: when does it ask?" Options: Every off→on (Recommended); Once per version; First time only.
- **Answer:** "Every off→on (Recommended)"
- **Outcome:** the confirm (DS-113, DS-114) shows on every off→on change, on every path that turns the item on (a namespace edit that enables a module through a preset included), and never while it stays on.

### DS-125 — What the persona chat count counts

- **Date:** 2026-10-28
- **Asked:** Slice 5a review (reviews/slice5a-review.md), Q8, R5-12. The question: "Persona cards say '채팅 N개'. What should that count?" Options: Bound chats, labelled (Recommended); Effective use; Drop the count.
- **Answer:** "Bound chats, labelled (Recommended)"
- **Outcome:** cards say '연결된 채팅 N개' and count explicit per-chat bindings only; the active persona says it is used wherever nothing else is bound.

### DS-126 — Plugin update checks

- **Date:** 2026-10-28
- **Asked:** Slice 5a review (reviews/slice5a-review.md), Q9. The question: "Plugin update checks: when should the app look for updates?" Options: Manual + once a day (Recommended); Every page open; Manual only.
- **Answer:** "Manual + once a day (Recommended)"
- **Outcome:** an '업데이트 확인' button, plus at most one automatic check a day when the plugin page opens; results are always shown (never silent).

### DS-127 — Slice 5b scope

- **Date:** 2026-10-28
- **Asked:** Slice 5b start (maintainer request: "Start Settings slice 5b (대화 기능)."). The question: "Slice 5b (대화 기능): which parts are in? Slice 1 lists 장기 기억, 음성 (TTS), 감정 이미지, 이미지 생성 and 번역." Options: All five (Recommended); Four, translation to 5c; Split 5b in two.
- **Answer:** "All five (Recommended)"
- **Outcome:** slice 5b covers 장기 기억, 음성, 감정 이미지, 이미지 생성 and 번역 on the 대화 기능 page, in one slice.

### DS-128 — Service-specific fields for image generation and voice

- **Date:** 2026-10-28
- **Asked:** Slice 5b start (maintainer request: "Start Settings slice 5b (대화 기능)."). The question: "Image generation and voice each support many services today (WebUI, NovelAI, ComfyUI, OpenAI-style, WaveSpeed…; ElevenLabs, VOICEVOX, OpenAI…). How should their service-specific fields be designed?" Options: Pattern + 2–3 worked (Recommended); Every service in full.
- **Answer:** "Pattern + 2–3 worked (Recommended)"
- **Outcome:** the spec designs the shared pattern (pick a service, its fields, a test) and fully mocks 2–3 services for each of image generation and voice; the other services are listed with their field names only.

### DS-129 — Long-term memory depth

- **Date:** 2026-10-28
- **Asked:** Slice 5b start (maintainer request: "Start Settings slice 5b (대화 기능)."). The question: "Long-term memory has several engines (supa, hanurai, HypaV2, HypaV3 with its presets). How deep?" Options: Choose + explain + HypaV3 presets (Recommended); Choose + settings only; Plus memory viewer.
- **Answer:** "Choose + explain + HypaV3 presets (Recommended)"
- **Outcome:** choosing an engine with plain explanations, each engine's settings, and the HypaV3 preset editor. Viewing and editing stored memories is out of scope.

### DS-130 — Where voice is chosen

- **Date:** 2026-10-28
- **Asked:** Slice 5b discovery (research/slice5b-chatfeat.md §9), Q1. The question: "Voice: today the engine and voice are chosen per character (in Studio's character editor); Settings holds only keys, the VOICEVOX address and auto-play. What should 5b do?" Options: Keep split, link both ways (Recommended); Global default + override; Move choice to Settings.
- **Answer:** "Keep split, link both ways (Recommended)"
- **Outcome:** Settings keeps the global voice parts (keys in 연결, the VOICEVOX address, auto-play) and lists characters' voices with links to Studio; Studio links back. No global default engine or voice.

### DS-131 — Image prompt prefix and negative prompt

- **Date:** 2026-10-28
- **Asked:** Slice 5b discovery (research/slice5b-chatfeat.md §9), Q2. The question: "Image prompt prefix and negative prompt are per character today. What about a global one?" Options: Per character, shown here (Recommended); Add a global default; Leave off this page.
- **Answer:** "Per character, shown here (Recommended)"
- **Outcome:** they stay per character in Studio; the 이미지 생성 section shows the active character's values read-only with a link to Studio. No new global field.

### DS-132 — Slice 1's invented 대화 기능 rows

- **Date:** 2026-10-28
- **Asked:** Slice 5b discovery (research/slice5b-chatfeat.md §9), Q3. The question: "Slice 1's mockup invented rows that don't exist in the app (TTS speed/split/skip code, emotion display options, image auto/seed/strength, memory ratio/recent/similarity/auto). What now?" Options: Remove them (Recommended); Keep as marked proposals; Map to nearest real.
- **Answer:** "Remove them (Recommended)"
- **Outcome:** only real settings appear; the slice 1 catalog rows with no source (research/slice5b-chatfeat.md §8) are removed or replaced by the real fields.

### DS-133 — Where translation is designed

- **Date:** 2026-10-28
- **Asked:** Slice 5b discovery (research/slice5b-chatfeat.md §9), Q (translation location). The question: "Translation settings already moved to the 언어 page in slice 1 (today's app has them there too). Where does 5b design them?" Options: On 언어, redesigned in 5b (Recommended); Move to 대화 기능.
- **Answer:** "On 언어, redesigned in 5b (Recommended)"
- **Outcome:** 5b designs the translator section on the 언어 page where it lives; 대화 기능 links to it.

### DS-134 — Emotion image methods and prompt

- **Date:** 2026-10-28
- **Asked:** Slice 5b discovery (research/slice5b-chatfeat.md §9), Q4. The question: "Emotion images have two real methods (the emotion model, and embedding similarity). The emotion prompt sits on the 고급 page today. What should the section show?" Options: Two methods + move prompt here (Recommended); Two methods, prompt stays.
- **Answer:** "Two methods + move prompt here (Recommended)"
- **Outcome:** the section offers the two methods with plain names, says which embedding model it uses (shared, DS-137), and holds the emotion prompt, moved from 고급 (고급 keeps a search synonym).

### DS-135 — Memory engines offered

- **Date:** 2026-10-28
- **Asked:** Slice 5b discovery (research/slice5b-chatfeat.md §9), Q5. The question: "Long-term memory has five engines (Supa, HypaV2, Hanurai, HypaV3, plus none). How should they be offered?" Options: All, older ones marked (Recommended); Hide older unless in use; All equal.
- **Answer:** "All, older ones marked (Recommended)"
- **Outcome:** all five appear with one-line explanations; Supa and HypaV2 carry an '이전 방식' marker.

### DS-136 — HypaV3 preset duplicate

- **Date:** 2026-10-28
- **Asked:** Slice 5b discovery (research/slice5b-chatfeat.md §9), Q6. The question: "HypaV3 presets: add a '복제' (duplicate) action? (Create, rename, delete with confirm, export and import exist.)" Options: Add duplicate (Recommended); Leave as is.
- **Answer:** "Add duplicate (Recommended)"
- **Outcome:** a 복제 action is added; creating a preset asks for a name. No data-format change.

### DS-137 — Where the embedding model is set

- **Date:** 2026-10-28
- **Asked:** Slice 5b discovery (research/slice5b-chatfeat.md §9), Q7. The question: "The embedding model is shared by memory and emotion. Where should it be set?" Options: 모델 page, linked (Recommended); Under 장기 기억; Own 임베딩 row here.
- **Answer:** "모델 page, linked (Recommended)"
- **Outcome:** one '임베딩' row on the 모델 page beside the task models (slice 3); memory and emotion link to it and say it is shared.

### DS-138 — Experimental memory options

- **Date:** 2026-10-28
- **Asked:** Slice 5b discovery (research/slice5b-chatfeat.md §9), Q8. The question: "Experimental HypaV3 options and rate limits only show when experimental features are on today. Keep that?" Options: Keep gated, in a collapsed 고급 (Recommended); Always in collapsed 고급; Leave out of the design.
- **Answer:** "Keep gated, in a collapsed 고급 (Recommended)"
- **Outcome:** they show only while experimental features are on, inside a collapsed 고급 group of the memory section.

### DS-139 — Translation cache tools

- **Date:** 2026-10-28
- **Asked:** Slice 5b discovery (research/slice5b-chatfeat.md §9), Q9. The question: "Translation cache (export, import, clear) only applies to the LLM translator. How should other types handle it?" Options: LLM only, explained (Recommended); Move to 데이터·백업.
- **Answer:** "LLM only, explained (Recommended)"
- **Outcome:** the cache tools show for the LLM translator; other types show a one-line note saying why there is no cache.

### DS-140 — Test buttons

- **Date:** 2026-10-28
- **Asked:** Slice 5b discovery (research/slice5b-chatfeat.md §9), Q10. The question: "There's no way to test voice, image generation or translation today. Should 5b design 'try it' buttons (new app work)?" Options: Yes, one try per service (Recommended); Model fetch only; None.
- **Answer:** "Yes, one try per service (Recommended)"
- **Outcome:** each service gets a '테스트' action: a short voice line, a small test image, a sample translation. Simulated in the mockup and flagged as new app work.

### DS-141 — Warning when the embedding model changes

- **Date:** 2026-10-28
- **Asked:** Slice 5b review (reviews/slice5b-review.md), M-1, SLICE5B O-2. The question: "Changing the embedding model may make stored memory vectors stale (not confirmed in code). What should the 임베딩 row do?" Options: Warn, once confirmed (Recommended); Always warn; No warning.
- **Answer:** "Warn, once confirmed (Recommended)"
- **Outcome:** the 임베딩 row warns on change ('저장된 기억을 다시 만들어야 해요'-style copy); the warning ships only once Lane A confirms that stored vectors go stale. The mockup shows it, marked as pending that confirmation.

### DS-142 — Which switch gates experimental memory options

- **Date:** 2026-10-28
- **Asked:** Slice 5b review (reviews/slice5b-review.md), M-2. The question: "Which switch gates the experimental memory options (DS-138)? Today's code uses the HypaV3 preset's own 'experimental implementation' switch." Options: The preset's switch (Recommended); App-wide experimental.
- **Answer:** "The preset's switch (Recommended)"
- **Outcome:** DS-138's 'experimental' is the HypaV3 preset's own `useExperimentalImpl`, as today and as built.

### DS-143 — Where character voice links go

- **Date:** 2026-10-28
- **Asked:** Slice 5b review (reviews/slice5b-review.md), M-3, R5B-6. The question: "Studio has no voice section yet (deferred). Where should '코릭터 목소리' links go?" Options: Ask Studio for a voice kind (Recommended); Character in Studio; No link yet.
- **Answer:** "Ask Studio for a voice kind (Recommended)"
- **Outcome:** the Studio lane is asked for a voice kind (through the main session); until it exists, the link opens the character in Studio with a note that voice settings are not there yet. (The question text misspelt 캐릭터 목소리.)

### DS-144 — What tests show before running

- **Date:** 2026-10-28
- **Asked:** Slice 5b review (reviews/slice5b-review.md), M-4, R5B-4. The question: "Test buttons for paid services (image, voice, AI translation): what should they show before running?" Options: Name voice, warn if paid (Recommended); Ask to confirm if paid; As built.
- **Answer:** "Name voice, warn if paid (Recommended)"
- **Outcome:** the voice test names whose voice it uses; a test that can cost money shows '요금이 나갈 수 있어요' before it runs, with no confirm dialog.

### DS-145 — A default for memory in new chats

- **Date:** 2026-10-28
- **Asked:** Slice 5b review (reviews/slice5b-review.md), M-5, SLICE5B O-1. The question: "Should Settings have a default for whether long-term memory starts on in new chats? (Today it's per chat; HypaV3 presets have 'always turn on'.)" Options: No new setting (Recommended); Add a global default.
- **Answer:** "No new setting (Recommended)"
- **Outcome:** no new setting; the page explains the per-chat toggle and the HypaV3 preset's 'always turn on'.

### DS-146 — Global emotion prompt and per-character instructions

- **Date:** 2026-10-28
- **Asked:** Slice 5b review (reviews/slice5b-review.md), M-6, SLICE5B O-3. The question: "The global emotion prompt and the per-character emotion instructions: the code reading couldn't tell if both are used. What should 5b do?" Options: Keep as built, Lane A confirms (Recommended); Show both here.
- **Answer:** "Keep as built, Lane A confirms (Recommended)"
- **Outcome:** the global prompt stays on 감정 이미지 with a note that a character may add its own; Lane A checks both paths at integration.

### DS-147 — Cost and download numbers

- **Date:** 2026-10-28
- **Asked:** Slice 5b review (reviews/slice5b-review.md), M-7. The question: "Cost and download-size numbers in the mockup are synthetic. Where should real numbers come from?" Options: Source at integration (Recommended); Drop numbers.
- **Answer:** "Source at integration (Recommended)"
- **Outcome:** Lane A fills real sizes and prices from model data or provider info at integration; where a number is unknown, none is shown.

### DS-148 — Settings entry page for Home links

- **Date:** 2026-10-28
- **Asked:** Home return item (DD-210, DD-203, DD-239). The question: "Home links to settings/slice1.html. That file still shows the old placeholder persona page; the real persona page is in slice5a. Which file should Home's Settings links open?" Options: Stable entry page (Recommended); Link the newest slice; slice1 forwards.
- **Answer:** "Stable entry page (Recommended)"
- **Outcome:** `settings/index.html` forwards to the newest slice and keeps the query. Home changes its Settings base once (a Home-lane edit, asked via the main session), and later slices update only the entry page.

### DS-149 — Going Home and browser history

- **Date:** 2026-10-28
- **Asked:** Home return review (reviews/home-return-review.md), S1. The question: "After Settings' Back sends you to Home, the browser's Back button takes you into Settings again, so you can loop between them. How should going Home handle history?" Options: Unwind, then replace (Recommended); Replace only; Keep as a normal link.
- **Answer:** "Unwind, then replace (Recommended)"
- **Outcome:** Settings steps back out of its own history entries, then replaces the current entry with the Home return URL; browser Back from Home goes to what was before Home.

### DS-150 — Ctrl+S with a Home return

- **Date:** 2026-10-28
- **Asked:** Home return review (reviews/home-return-review.md), nit. The question: "Ctrl+S opens and closes Settings over the mockup's stand-in chat screen. With a valid Home return address, should closing with Ctrl+S also go Home?" Options: No, leave it (Recommended); Yes, go Home.
- **Answer:** "No, leave it (Recommended)"
- **Outcome:** Ctrl+S stays a toggle for the stand-in screen; only Back goes Home.

### DS-151 — A section from another page

- **Date:** 2026-10-28
- **Asked:** Home return review (reviews/home-return-review.md), S2. The question: "A link with a page and a section from another page (e.g. page=display&section=prompts) opens the page silently and ignores the section. What should happen?" Options: Follow the section (Recommended); Show not-found notice; Leave as is.
- **Answer:** "Follow the section (Recommended)"
- **Outcome:** a known section opens its own page and scrolls to it, whatever `page=` says.

### DS-152 — Slice 5c split

- **Date:** 2026-10-28
- **Asked:** Slice 5c scope (before discovery). The question: "Slice 5c refines the remaining pages: 화면·읽기 (~39 rows), 입력·접근성 (~33), 언어 (3; translation was done in 5b), 데이터·백업 (~13) and 고급 (~59). That's about 150 rows. How should it be cut?" Options: Two parts (Recommended); One slice; Page by page.
- **Answer:** "Two parts (Recommended)"
- **Outcome:** 5c-1 = 화면·읽기 and 입력·접근성, plus the DD-250 all-modes-hidden repair state; 5c-2 = 데이터·백업, 고급 and 언어. Each part gets its own review.

### DS-153 — Shared items in 5c

- **Date:** 2026-10-28
- **Asked:** Slice 5c scope (before discovery). The question: "Main has queued shared items that touch these pages. Which should 5c take on?" Options (multi-select): DD-228 .bin and .rtb (Recommended); DD-223 10 s undo (Recommended); Warning/progress pattern (Recommended).
- **Answer:** "DD-228 .bin and .rtb (Recommended), DD-223 10 s undo (Recommended), Warning/progress pattern (Recommended)"
- **Outcome:** all three. DD-223 (one 10 s undo window across Settings, the toast says when undo ends early) goes in 5c-1 because it touches earlier slices; DD-228 and the patterns/ warning and progress adoption (with the inventory fixes) go in 5c-2.

### DS-154 — 5c refine depth

- **Date:** 2026-10-28
- **Asked:** Slice 5c scope (before discovery). The question: "How deep should the refine go on these pages?" Options: Full refine (Recommended); Copy and grouping only.
- **Answer:** "Full refine (Recommended)"
- **Outcome:** as DS-101: regroup, plain labels, real controls, invented rows removed, dead or misleading options fixed, all sourced from the app.

### DS-155 — Mode visibility storage

- **Date:** 2026-10-28
- **Asked:** Slice 5c-1 discovery (research/slice5c1-display-input.md §9). The question: "Home can hide unused modes (RP, Hybrid, Utility), and Settings must offer a repair (DD-250). The app has no stored field for this yet. Where should mode visibility be stored?" Options: Profile-wide (Recommended); This device only.
- **Answer:** "Profile-wide (Recommended)"
- **Outcome:** A new visible-modes set plus a hide-unused flag, saved with the profile (new engine fields).

### DS-156 — A single visible mode

- **Date:** 2026-10-28
- **Asked:** Slice 5c-1 discovery (research/slice5c1-display-input.md §9). The question: "Can any single mode be the only visible one, including Hybrid?" Options: Any one mode (Recommended); Hybrid always shown.
- **Answer:** "Any one mode (Recommended)"
- **Outcome:** Any of RP, Hybrid and Utility may be the only visible mode; the Settings repair always restores the others.

### DS-157 — Low power and reduce motion

- **Date:** 2026-10-28
- **Asked:** Slice 5c-1 discovery (research/slice5c1-display-input.md §9). The question: "The app has no low-power or reduce-motion setting; it has only 'animation speed'. The redesign relies on both. What should the mockup show?" Options: Real new settings (Recommended); Proposals, tagged; Drop them.
- **Answer:** "Real new settings (Recommended)"
- **Outcome:** Low power (on/off) and reduce motion (follow system/on/off) are real stored settings the app adds; listed as engine changes.

### DS-158 — Invented accessibility rows

- **Date:** 2026-10-28
- **Asked:** Slice 5c-1 discovery (research/slice5c1-display-input.md §9). The question: "Six accessibility rows in the mockup have no app source: large targets, reduce transparency, screen-reader hints, focus ring, edge swipe, haptics. What should happen to them?" Options: Keep three, tagged (Recommended); Remove all six; Keep all, tagged.
- **Answer:** "Keep three, tagged (Recommended)"
- **Outcome:** Haptics off, edge swipe and reduce transparency stay as tagged proposals; screen-reader hints and focus ring are removed.

### DS-159 — Dead settings

- **Date:** 2026-10-28
- **Asked:** Slice 5c-1 discovery (research/slice5c1-display-input.md §9). The question: "Three settings do nothing in the app today: the memory-limit line, its thickness, and 'move instead of copy' on conversion. What should Settings do with them?" Options: Hide them (Recommended); Show as not working; Revive the memory line.
- **Answer:** "Hide them (Recommended)"
- **Outcome:** Not shown and not searchable; stored values untouched.

### DS-160 — Chat themes

- **Date:** 2026-10-28
- **Asked:** Slice 5c-1 discovery (research/slice5c1-display-input.md §9). The question: "The app has five chat themes: Standard, Waifu, Mobile Chat, CardBoard and Custom HTML. How should they appear?" Options: All five, plainly named (Recommended); Three behind 고급; Standard + Custom HTML.
- **Answer:** "All five, plainly named (Recommended)"
- **Outcome:** All five with plain Korean names and a small preview thumbnail.

### DS-161 — Colour schemes

- **Date:** 2026-10-28
- **Asked:** Slice 5c-1 discovery (research/slice5c1-display-input.md §9). The question: "The app has 16 colour schemes plus a custom one; the mockup shows 3 invented names. How should they appear?" Options: All 16 as swatches (Recommended); Grouped light/dark.
- **Answer:** "All 16 as swatches (Recommended)"
- **Outcome:** A swatch grid of the real 16 plus custom.

### DS-162 — Animation speed

- **Date:** 2026-10-28
- **Asked:** Slice 5c-1 discovery (research/slice5c1-display-input.md §9). The question: "'Animation speed' is stored as a duration from 0 to 1 second, so a bigger number means slower. How should it be shown?" Options: 느림–빠름 slider (Recommended); Raw seconds; On / reduced / off.
- **Answer:** "느림–빠름 slider (Recommended)"
- **Outcome:** A slow-to-fast slider with the stored duration reversed behind it; presentation only.

### DS-163 — Misplaced settings

- **Date:** 2026-10-28
- **Asked:** Slice 5c-1 discovery (research/slice5c1-display-input.md §9). The question: "Some settings on these pages belong elsewhere: prompt comparison, additional-asset preview, lorebook and bulk-enable options, apply-params-to-all, go-to-character-on-import, request info in chat. Where should they go?" Options: Move to their owning page (Recommended); Keep under '그 밖에'; Remove.
- **Answer:** "Move to their owning page (Recommended)"
- **Outcome:** Each moves to its owning Settings page or Studio area; search still finds it.

### DS-164 — Hide API keys

- **Date:** 2026-10-28
- **Asked:** Slice 5c-1 discovery (research/slice5c1-display-input.md §9). The question: "The mockup retired 'Hide API keys' (keys are always hidden), but the app still lets users reveal keys. Which way?" Options: Retire, reveal per field (Recommended); Keep the switch.
- **Answer:** "Retire, reveal per field (Recommended)"
- **Outcome:** Keys are always masked with a per-field reveal; the global switch goes (confirms data3.js's note).

### DS-165 — Notifications

- **Date:** 2026-10-28
- **Asked:** Slice 5c-1 discovery (research/slice5c1-display-input.md §9). The question: "Notifications in the app are one on/off switch that asks the browser for permission. The mockup invented three states (off, background, always). Which should it show?" Options: On/off + status line (Recommended); Three states, as new work.
- **Answer:** "On/off + status line (Recommended)"
- **Outcome:** One switch plus a permission status line (allowed, blocked, not supported on this device).

### DS-166 — Undo toast wording

- **Date:** 2026-10-28
- **Asked:** Slice 5c-1 discovery (research/slice5c1-display-input.md §9). The question: "Undo in Settings lasts 10 s (DD-223). Most deletes can also be undone later, until you leave the page. What should the toast say?" Options: Say when it ends (Recommended); Always end at 10 s.
- **Answer:** "Say when it ends (Recommended)"
- **Outcome:** Every undo toast states how long undo lasts, and says so whenever undo ends earlier or later than 10 s.

### DS-167 — Custom quote boxes

- **Date:** 2026-10-28
- **Asked:** Slice 5c-1 discovery (research/slice5c1-display-input.md §9). The question: "Custom quotes: in the app the four quote boxes show only when custom quotes is on, while the mockup always shows them. Which?" Options: App behaviour + preview (Recommended); Always visible.
- **Answer:** "App behaviour + preview (Recommended)"
- **Outcome:** The boxes appear when custom quotes is on, with a live preview line.

### DS-168 — Legacy GUI

- **Date:** 2026-10-28
- **Asked:** Slice 5c-1 discovery (research/slice5c1-display-input.md §9). The question: "'Use legacy GUI' only changes the old Settings layout, which the redesign replaces. What should happen to it?" Options: Drop it (Recommended); Hidden compatibility.
- **Answer:** "Drop it (Recommended)"
- **Outcome:** Not shown; the redesigned Settings has one layout.

### DS-169 — Delete range setting (instantRemove)

- **Date:** 2026-10-28
- **Asked:** Slice 5c-1 review (reviews/slice5c1-review.md), B-1, Q-2. The question: "The app setting the mockup called '뒤 메시지도 지우기' doesn't delete anything by itself. It adds a question when you delete a message: 'this message only' or 'this and everything after'. How should it be named?" Options: 지울 때 범위 묻기 (Recommended); Make it auto-delete.
- **Answer:** "지울 때 범위 묻기 (Recommended)"
- **Outcome:** `instantRemove` is named for what it does: deleting a message asks for the range. No caution line; nothing auto-deletes.

### DS-170 — Hide-unused switch and mode boxes

- **Date:** 2026-10-28
- **Asked:** Slice 5c-1 review (reviews/slice5c1-review.md), S-11, Q-1. The question: "How should '쓰지 않는 모드 숨기기' relate to the three mode checkboxes?" Options: Switch off = all shown (Recommended); As built; Drop the switch.
- **Answer:** "Switch off = all shown (Recommended)"
- **Outcome:** With the switch off, the boxes are checked and disabled ('숨기기가 꺼져 있어요'); turning it on brings back the remembered set.

### DS-171 — Undo key named in toasts

- **Date:** 2026-10-28
- **Asked:** Slice 5c-1 review (reviews/slice5c1-review.md), S-2, Q-3. The question: "Undo toasts name a key. In Settings, Alt+Z runs the undo of deletes, while Ctrl+Z / ⌘Z runs a different undo (preset parameters). Which key should toasts name?" Options: Alt+Z everywhere (Recommended); Make ⌘Z work too.
- **Answer:** "Alt+Z everywhere (Recommended)"
- **Outcome:** Toasts name Alt+Z (⌥Z on Mac). Refines DS-166's wording; DS-109 (⌘ for Ctrl) does not apply to this key.

### DS-172 — Sidebar default

- **Date:** 2026-10-28
- **Asked:** Slice 5c-1 review (reviews/slice5c1-review.md), S-5, Q-4. The question: "The mockup shows '사이드바 보이기' on by default, but the app's stored default is off (unset). Which?" Options: Mirror the app (Recommended); Propose on.
- **Answer:** "Mirror the app (Recommended)"
- **Outcome:** `menuSideBar` defaults off, as stored in the app.

### DS-173 — Pro Tools row

- **Date:** 2026-10-28
- **Asked:** Slice 5c-1 review (reviews/slice5c1-review.md), S-6, Q-5. The question: "'고급 도구 보이기' (Pro Tools) appears twice, on 입력·접근성 and on 고급. Where should the one real row live?" Options: 입력·접근성 (Recommended); 고급.
- **Answer:** "입력·접근성 (Recommended)"
- **Outcome:** One row on 입력·접근성; 고급 has a jump link.

### DS-174 — Colour scheme export and import

- **Date:** 2026-10-28
- **Asked:** Slice 5c-1 review (reviews/slice5c1-review.md), S-8, Q-6. The question: "The app can export and import a custom colour scheme. The mockup has neither. Where should they go?" Options: In the colour editor (Recommended); In 데이터·백업 (5c-2).
- **Answer:** "In the colour editor (Recommended)"
- **Outcome:** Export and import buttons in the custom colour editor (simulated).

### DS-175 — 모드 group placement

- **Date:** 2026-10-28
- **Asked:** Slice 5c-1 review (reviews/slice5c1-review.md), builder note, Q-7. The question: "The 모드 group is built as the first group on 화면·읽기, always shown, with the warning banner only when modes are hidden. Keep that?" Options: Always shown (Recommended); Only when repairing.
- **Answer:** "Always shown (Recommended)"
- **Outcome:** The 모드 group stays first and always shown; the banner appears only when modes are hidden.

### DS-176 — Restore Cancel

- **Date:** 2026-10-28
- **Asked:** Slice 5c-2 discovery (research/slice5c2-data-adv-lang.md §9). The question: "Restoring from a file starts writing images and stored data right away; only the final database swap comes later. The shared pattern allows Cancel only before the first write. Where should Cancel end for restore?" Options: Before the first write (Recommended); Stage, then swap.
- **Answer:** "Before the first write (Recommended)"
- **Outcome:** Cancel is offered only while the file and tabs are checked and disappears once writing starts (the first asset write, not the database swap).

### DS-177 — .rtb and backup format

- **Date:** 2026-10-28
- **Asked:** Slice 5c-2 discovery (research/slice5c2-data-adv-lang.md §9). The question: "The fork-only .rtb backup doesn't exist in the code yet; it's design-only. How should backup be offered?" Options: One action, format choice (Recommended); Two buttons; Hide .rtb for now.
- **Answer:** "One action, format choice (Recommended)"
- **Outcome:** One backup action with a format choice: .rtb default (keys included), .bin the RisuAI-compatible option with the DD-227 caution sheet. Restore uses the same steps for both. .rtb is a new engine format.

### DS-178 — Settings file export and import

- **Date:** 2026-10-28
- **Asked:** Slice 5c-2 discovery (research/slice5c2-data-adv-lang.md §9). The question: "The mockup's 'export settings' and 'import settings' rows don't exist in the app; it only has a bug-report export. What should happen?" Options: Drop; bug report to 고급 (Recommended); Keep as a new feature.
- **Answer:** "Keep as a new feature"
- **Outcome:** A settings-only file export and import is proposed as a new feature (contents in DS-187).

### DS-179 — Persist storage row

- **Date:** 2026-10-28
- **Asked:** Slice 5c-2 discovery (research/slice5c2-data-adv-lang.md §9). The question: "The 'keep storage' (persist) row has no setting in the app; the browser storage is persisted automatically. What should happen?" Options: Remove it (Recommended); Read-only status.
- **Answer:** "Remove it (Recommended)"
- **Outcome:** No row.

### DS-180 — Cold storage switch

- **Date:** 2026-10-28
- **Asked:** Slice 5c-2 discovery (research/slice5c2-data-adv-lang.md §9). The question: "The cold-storage switch (moves old data out of memory, default on) is on 고급 in the app. Where should it live?" Options: 데이터·백업 › 저장 공간 (Recommended); Stay on 고급.
- **Answer:** "데이터·백업 › 저장 공간 (Recommended)"
- **Outcome:** Moves to 데이터·백업 › 저장 공간, default on.

### DS-181 — Snapshot list

- **Date:** 2026-10-28
- **Asked:** Slice 5c-2 discovery (research/slice5c2-data-adv-lang.md §9). The question: "The app keeps numbered automatic snapshots. What should the restore sheet show for them?" Options: Date, size, character count (Recommended); Date only; Hide them.
- **Answer:** "Date, size, character count (Recommended)"
- **Outcome:** A list with date, size and character count; the engine returns size and count.

### DS-182 — Safety copy for file restore

- **Date:** 2026-10-28
- **Asked:** Slice 5c-2 discovery (research/slice5c2-data-adv-lang.md §9). The question: "Restoring from a snapshot keeps a safety copy of the current data first, but restoring from a file doesn't. What should file restore do?" Options: Engine writes one first (Recommended); No copy, acknowledge.
- **Answer:** "Engine writes one first (Recommended)"
- **Outcome:** The engine keeps a snapshot of the current data before a file restore, as the snapshot path does; the sheet says so.

### DS-183 — Realm go-to-character row

- **Date:** 2026-10-28
- **Asked:** Slice 5c-2 discovery (research/slice5c2-data-adv-lang.md §9). The question: "'Go to the character after a Realm import' moved to 데이터·백업 in 5c-1. Keep it there?" Options: Keep, under imports (Recommended); Library import settings.
- **Answer:** "Keep, under imports (Recommended)"
- **Outcome:** Stays on 데이터·백업 under imports, with a Realm-only description.

### DS-184 — Retired and legacy 고급 rows

- **Date:** 2026-10-28
- **Asked:** Slice 5c-2 discovery (research/slice5c2-data-adv-lang.md §9). The question: "Some 고급 rows are retired or likely dead: streaming optimisation (retired by DD-071), the old trigger v1 display and legacy media findings. What should happen to them?" Options: Remove streaming; others under 권장하지 않음 (Recommended); Hide all three.
- **Answer:** "Remove streaming; others under 권장하지 않음 (Recommended)"
- **Outcome:** Streaming optimisation is removed; `showDeprecatedTriggerV1` and `legacyMediaFindings` sit in a collapsed 권장하지 않음 group until main confirms whether they are dead.

### DS-185 — Experimental gate

- **Date:** 2026-10-28
- **Asked:** Slice 5c-2 discovery (research/slice5c2-data-adv-lang.md §9). The question: "The app gates hidden rows behind two switches: experimental features and 'show unrecommended'. How should the gate work?" Options: Keep two switches (Recommended); One 개발자 모드; Always show, tagged.
- **Answer:** "Keep two switches (Recommended)"
- **Outcome:** `useExperimental` and `showUnrecommended` each reveal their own hidden section.

### DS-186 — Diagnostics

- **Date:** 2026-10-28
- **Asked:** Slice 5c-2 discovery (research/slice5c2-data-adv-lang.md §9). The question: "Request logs, statistics and the bug-report export are diagnostics. Where should they go?" Options: 고급 › 문제 해결 (Recommended); 데이터·백업 › 내보내기.
- **Answer:** "고급 › 문제 해결 (Recommended)"
- **Outcome:** One 문제 해결 group on 고급.

### DS-187 — Settings file contents

- **Date:** 2026-10-28
- **Asked:** Slice 5c-2 discovery (research/slice5c2-data-adv-lang.md §9). The question: "You chose to keep settings export and import as a new feature. What should the settings file contain?" Options: Settings only, no keys (Recommended); Settings with keys.
- **Answer:** "Settings only, no keys (Recommended)"
- **Outcome:** App settings and preset choices, never API keys or chats; import shows what will change and has Undo.

### DS-188 — translang row

- **Date:** 2026-10-28
- **Asked:** Slice 5c-2 discovery (research/slice5c2-data-adv-lang.md §9). The question: "언어 has a 'download community translation' row (translang). Keep it?" Options: Keep as '번역 파일 받기' (Recommended); Drop it.
- **Answer:** "Keep as '번역 파일 받기' (Recommended)"
- **Outcome:** Kept with the plain name 번역 파일 받기.

### DS-189 — Language change

- **Date:** 2026-10-28
- **Asked:** Slice 5c-2 discovery (research/slice5c2-data-adv-lang.md §9). The question: "In the app, changing the language needs a close and reopen; the mockup switches instantly. Which should the design show?" Options: App behaviour + calm line (Recommended); Switch instantly.
- **Answer:** "App behaviour + calm line (Recommended)"
- **Outcome:** An inline line says the language applies after reopening, with a reopen button.

### DS-190 — After a restore

- **Date:** 2026-10-28
- **Asked:** Slice 5c-2 discovery (research/slice5c2-data-adv-lang.md §9). The question: "After a restore the app reloads. What should the person see?" Options: Result card, then 다시 시작 (Recommended); Reload automatically.
- **Answer:** "Result card, then 다시 시작 (Recommended)"
- **Outcome:** The result card shows what was restored; the app reloads on 다시 시작.

### DS-191 — Leave-out list label

- **Date:** 2026-10-28
- **Asked:** Slice 5c-2 discovery (research/slice5c2-data-adv-lang.md §9). The question: "What .bin leaves out (shown in its caution sheet) is mock data until Lane A supplies the real list. How should the mockup show it?" Options: Visible mock label (Recommended); No label.
- **Answer:** "Visible mock label (Recommended)"
- **Outcome:** The list carries a visible mock label until Lane A supplies it; an empty list shows no sheet.

## Open

(none yet)
