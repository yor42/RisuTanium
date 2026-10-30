# Character and group forms: discovery note for Studio slice 4

Date 2026-10-28. Source-read only: no app run, no screenshots, no browser. Paths are under `src/` unless stated. "Obs" = read in source; "Unverified" = inferred or not traced to the end. Feeds [../SLICE4_SPEC.md](../SLICE4_SPEC.md) (decisions DD-162..165). Earlier discovery: [today-authoring.md](today-authoring.md) §1a, §1b, §5; [../../chat/research/slice3-group-chats.md](../../chat/research/slice3-group-chats.md) §5-6.

All line numbers are `lib/SideBars/CharConfig.svelte` unless another file is named.

## 1. What the editor is today

One component, three tab ids in scope: 0 Basic (:244-334), 1 Display (:335-676), 2 Advanced (:1054-1286). Tabs 3 (lorebook), 4 (scripts), 5 (voice), 6 (share) are other slices or out of scope (DD-162). Tabs are icon-only, hidden on desktop when `licensed === 'private'` or `$MobileGUI` (:213). A character whose `license` is `private` shows only "not allowed" and forces tab 0 (:245, :330-334); the Basic fields do not render for it.

Every field binds straight to `DBState.db.characters[$selectedCharID]` (no draft layer, no undo; research §2). About 20 long fields are the fixed 160 px `TextAreaInput` (research §5).

## 2. Basic (tab 0)

| Field | Type | Anchor | Notes |
|---|---|---|---|
| name | single line `TextInput` xl | :246 (group :255) | No validation. Group uses a different placeholder. |
| description (`desc`) | `TextAreaInput highlight` | :248 | Token count line under it, :249. Not shown for groups. |
| first message (`firstMessage`) | `TextAreaInput highlight` | :251 | Token count :252. Not shown for groups; the group's `firstMessage` is editable nowhere. |
| author note | `TextAreaInput highlight`, placeholder = default note | :311-318 | **Bound to `chats[chatPage].note`, the open chat's note, not the character.** Shown for characters and groups. Token count :319. Needs a context chat in Studio. |
| toggle values panel | `Toggles` component | :321-323 | Desktop only (`!$MobileGUI`). Values, not definitions; belongs to chat, not to this form. |
| group: member grid | rows of avatar, six talk bars, active checkbox | :256-303 | Remove = tap the avatar (:266, no confirm, `rmCharFromGroup`). The six bar buttons carry `aria-labelledby="loading"` (:285), so they have no usable name. |
| group: add member | `+` icon button, `addGroupChar` | :304-308 | Avatar-only picker; a member already in the group errors (`process/group.ts:10-19`). |
| group: talk by order | checkbox `orderByOrder` | :324-328 | **Inside the `!$MobileGUI` block (:321)**, so phones cannot set it from this tab. |

Tokens: `loadTokenize` runs `tokenizeAccurate` for description, first message and the chat note with no debounce (:60-97).

## 3. Display (tab 1)

A three-way switch at :340-356 (`viewSubMenu`): icon, screen, assets. Not remembered.

**Icon (0)**, :358-464.
- Group: one 96 px tile; click = file picker (`selectCharImg`, :360); "generate group icon" button (:459-463, `makeGroupImage`, `characters.ts:835`).
- Character: main image tile, alternates from `ccAssets[]` (`{type:'icon', name, uri, ext}`), a dashed `+` tile, and a trash icon that toggles a hidden "remove mode" (:444-450). In remove mode a click on a tile deletes it (:372-384 main, :407-415 alternates); outside it a click on an alternate swaps it into the main slot (`changeCharImage`, `characters.ts:230-237`). Deleting the main image promotes the first alternate (:380-382).
- `+` runs `selectCharImg` (`characters.ts:152-212`): accepts png, webp, gif, jpg, jpeg, **replaces** the main image and pushes the old one into `ccAssets` as `iconx` (`dumpCharImage`, :214-228). For PNG it also copies allowed text chunks (parameters, Comment, Title...) into `extentions.pngExif` (:168-194).
- `largePortrait` check, only when a main image exists (:453-457); changes tile shape to 10.66 rem (:438).

**Screen (1)**, :466-576. `viewScreen` select: character none / emotion / imggen; group none / single / multiple / emp (:469-487). For a character, changing it calls `updateInlayScreen` (:470-474), which **rewrites `newGenData.prompt/negative/instructions/emotionInstructions`**: empty or known-default text is replaced by the new mode's default (`ts/process/inlayScreen.ts:81-113`; `resolveGenDataField` not read).
- emotion: help + the line "Auxiliary model is used" (`emotionWarn`, `lang/en.ts:1217`, ko `1088`: analysis uses an auxiliary model). A table image / name / delete (:493-531), add with a `+` icon (:533-541). `addCharEmotion` takes multiple png/webp/gif (`characters.ts:242-273`), names each from the file name with only `.png` and `.webp` removed (`:258`; a `.gif` keeps its extension, and a `.png` inside a name is also removed). **No reorder, no duplicate-name check** (none seen in :507-526; unverified beyond that). Delete = `rmCharEmotion` (`characters.ts:275`), also clears the cached emotion for that character. `emotionInstructions` LT shows only when `inlayViewScreen` is on (:543-546). `inlayViewScreen` check (:548-558): turning it on makes `additionalAssets` `[]`, turning it off with no assets sets it `undefined`, then `updateInlayScreen`.
- imggen: prompt, negative prompt, instructions (:564-569), same inlay check (:571-575).

**Assets (2)**, :577-676.
- With `db.newImageHandlingBeta`: check `prebuiltAssetCommand` (insert asset prompt) and select `prebuiltAssetStyle` static/dynamic (:579-587).
- Table of `additionalAssets: [name, path, ext][]` (`database.svelte.ts:1483`): name `TextInput` (renaming is free text, :638), delete (:642-651), and with `db.useAdditionalAssetsPreview` a video/audio/image preview (:628-637; audio has `loop`, controls) and an include/exclude toggle writing `prebuiltAssetExclude` (:652-668).
- Add: multi-file picker with 15 extensions (png webp mp4 mp3 gif jpeg jpg ttf otf css webm woff woff2 svg avif, :596) via `saveAsset` (:607). **Deleting an asset sets the open chat's `fmIndex = -1`** (:644); the same happens when an alternate first message is deleted (:1191). Why is not explained in source read; field is `fmIndex?: number` (`database.svelte.ts:1887`). Unverified: that -1 means "main first message".
- The asset name is what chat text calls: the ko help lists `{{raw::name}}`, `{{image::name}}`, `{{video::name}}`, `{{audio::name}}` (`lang/ko.ts:507`). Renaming does not touch text that uses it (obs: no carry-over code at :638).

## 4. Advanced (tab 2)

Character branch :1058-1274, group branch :1275-1285 (supermemory text if present, and the low-level access check only).

Order today: bias table (:1059-1101), example message (:1104), creator's comment multi-language (:1107-1109), system prompt (:1112), global note replacement (:1115), additional description (:1118), personality (:1120-1123) and scenario (:1124-1127), each **only if `db.showUnrecommended` or the field has more than 3 characters**; default variables (:1130, no highlight), translator's note (:1133, no highlight), toggle definitions (`customModuleToggle`, :1136, no highlight; slice 2 owns this), creator (:1139), character version (:1142), nickname (:1145), depth prompt = a number and a **single-line** `TextInput` (:1147-1151), alternate first messages (:1153-1205; table of `TextAreaInput highlight`, up / down / delete buttons per row, `+` adds an empty one), then the flags.

Creator's comment: `MultiLangInput` (`lib/UI/GUI/MultiLangInput.svelte`): language tabs, `+` adds a language, an empty English entry is stored as a single space (:28-30), typing sets `removedQuotes = false` (:1108).

Flags, each a `CheckInput` (:1207-1224): low level access with a Help (:1209-1210; help text `lang/en.ts:603-604`: enables features that need high computing power and executing the AI model through triggers; "do not enable unless you really need these"), hide chat icon (:1214), utility bot with Help (:1218; help `en.ts:535`: ignores main prompt, jailbreak and other prompts), escape output (:1223; **no help text**; it reaches the prompt call as `escape:` at `ts/process/index.svelte.ts:2050`, effect not traced). Low level access has a confirm only on import (`characterCards.ts:875`, text `lowLevelAccessConfirm`, `en.ts:1643`); the switch here asks nothing. The booleans use getter/setter bindings on purpose so an absent flag is not written as `false` on mount (comment :1208).

Memory (:1226-1252): buttons for Hypa V2 / V3 modals depending on `db.supaModelType`, `db.hypav2`, `db.hypaV3`; else a plain textarea for the chat's `supaMemoryData` (chat-scoped, like the author note) when it has more than 4 characters or `supaMemory` is set.

Actions (:1254-1274): "apply module" (`applyModule`, `process/modules.ts:839`: pick a module, **copies its lorebook, regex ... into the character**, a copy not a link; group is refused) and "convert to module" (`convertCharacterToModule`, `interchangeability.ts:56`: builds a module from the character's lore, regex, triggers, low-level flag, hide-icon, background HTML, assets, namespace, toggles, icon, and adds the description as a lorebook entry; pushed to `db.modules` with a plain alert).

## 5. Group data (from the chat group research)

`groupChat` has `characters` (member `chaId`s), parallel arrays `characterTalks` and `characterActive`, `orderByOrder?`, `viewScreen`, `image`, `chats`, `lowLevelAccess?`, `hideChatIcon?` (`database.svelte.ts:1562-1628`). On load the two parallel arrays are **reset to 4/6 and true for all members if their length differs** from `characters` (`characters.ts:724-737`, per the chat research), so any member edit must keep three arrays aligned. Remove has no confirm; past messages keep `saying`. The group author note is the group's chat note (`index.svelte.ts:884-895`). Chat slice 3 (§6, DD-053..064) already designs the member panel inside the chat sheet.

## 6. What this means for the form design

1. The author note and the memory text are **chat-scoped**, so a character form that shows them needs a context chat and must say whose it is.
2. `customModuleToggle` is edited by slice 2's builder; duplicating it as a text box would give two editors for one value.
3. A "has a value" rule has to treat `' '` (creator's comment) and the default prompts that `updateInlayScreen` writes as non-empty/empty explicitly.
4. Images today have no failure state, no reorder (emotions), a hidden remove mode, and replace-on-add for the portrait. A form with explicit controls and undo changes those behaviours; each is listed as a proposal in the spec.
5. Hazards found: unnamed talk bars (:285); group order switch missing on phone (:321 block); `.gif` emotion names keep the extension (`characters.ts:258`); `fmIndex` reset on delete (:644, :1191); `updateInlayScreen` overwrites prompt fields on mode change.

## 7. Not read

`Help` text bodies for most keys (only those quoted above); `getCharImage` resolution branches beyond the first lines; `selectSingleFile`/`selectMultipleFile` internals and size limits (none seen); `saveImage` storage and later cleanup of orphaned files; `resolveGenDataField`; tab 3-6 internals; how `escapeOutput` changes output; the engine's use of emotion order and duplicate names; `Toggles.svelte` internals.
