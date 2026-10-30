# Settings & models: engine changes the redesign needs

Written 2026-10-27 for Lane A [8a3066]. Sources: the integration maps in [SLICE1_SPEC.md §10](SLICE1_SPEC.md), [SLICE2_SPEC.md §9](SLICE2_SPEC.md) and [SLICE3_SPEC.md §8](SLICE3_SPEC.md), their review sections, and [DECISIONS-settings.md](DECISIONS-settings.md). Slices 4 (parameters), 5a (단축키, 페르소나, 확장), 5b (대화 기능, 번역), 5c-1 (화면·읽기, 입력·접근성) and 5c-2 (데이터·백업, 고급, 언어; built, not independently reviewed) were added on 2026-10-28.

**Blocking:** every mockup runs on a synthetic store, so **none of these blocks a mockup**. They block implementation only.

**Sizes:** the S/M/L sizes are all INFERRED. Nobody has read the code deeply enough to estimate them.

**Save format:**
- "db" below means the main database object saved to `database.bin`. These rows are INFERRED; nobody has checked against upstream:
  - Upstream RisuAI ignores fields it doesn't know.
  - Moving or renaming a field that upstream reads breaks a round trip through upstream.
- Plain "changes data" means existing data is touched in place.
- MC-350 isn't in this clone's maintainer context, so I haven't mapped it. Lane A please map it.
- Storage background is in [ticket-impact/STORAGE_CONTRACT.md](../ticket-impact/STORAGE_CONTRACT.md): the store2 backup is new and owned by CHORE-128, while `.bin` projections are still a draft.

**Rule:** DS-067, store-first screens, applies to every item.

**Decided 2026-10-27:** DS-068, DS-069 and DS-070 (MC-772, MC-774) settle the `.bin` questions. Upstream equivalents are translated at export. Fork-only data (items 2-1, 2-3, 2-4, 2-5 and 3-5) stays in our storage and `.rtb`, is left out of `.bin` with a warning, and upstream `.bin` import always works.

## Slice 1: shell and search

| # | Engine change | Screen / element | Data and save format | Size | Refs |
|---|---|---|---|---|---|
| 1-1 | Schema records gain a locator (`page`, `section`), `default` and synonyms. The hand-written pages (model, prompt, persona, plugin, module, backup, hotkeys) get schema records too, with at least a label, a locator and a value getter. | Search; the changed dot and 기본값으로 | Code only, no stored data. Defaults come from `database.svelte.ts`. | M–L | DS-010, R-19 |
| 1-2 | Global search over items, pages and named things: presets, models, connections, personas, plugins, modules and Language. | Search (Ctrl+K, `/`) | Code only; reads the store. | M | DS-007 |
| 1-3 | `condition(ctx)` also returns a reason code (`dependency`, …). | Dimmed search results and jump-to-switch | Code only | S | R-09 |
| 1-4 | A page host that keeps section state across switches instead of remounting through `{#key}`. Back knows where you came from. `SettingsMenuIndex` becomes a page id. | Index, Back order, phone drill-in | UI state only, not saved | M | CHORE-179/180/181 (Back package), INFERRED overlap |
| 1-5 | Moves misplaced items: hide API key, preset chain, aux placement, Pro tools, TTS OpenAI key. | Pages | Changes stored data only if keys are renamed. Moving a row needs no data change, INFERRED. | S | SLICE1 §10 |
| 1-6 | Low-power mode as a new device setting, plus a slow-frame sampler and its re-offer state. | 고급 › 저전력·움직임, and the suggestion in chat | New stored field. It should be device-local, not in db or `.bin`, INFERRED. | S–M | DS-012 |
| 1-7 | Plugin entries become rows under 확장 that open the plugin's callback. Real in-shell pages would need a plugin API change; slice 1 O-2 is still open. | 확장 | Code only for rows | S (rows), L (pages) | SLICE1 O-2 |
| 1-8 | Remembers the last page. | Opening Settings | UI or device state | S | SLICE1 O-3 (design default) |

## Slice 2: presets

| # | Engine change | Screen / element | Data and save format | Size | Refs |
|---|---|---|---|---|---|
| 2-1 | A stable `id` per preset. Adds `folderId`, `favorite`, `slot` and `lastUsed` (or a `presetMeta` map) and `db.presetFolders`. Chains and loadouts refer to presets by id, not by name or position. | Library, switcher, chain editor, loadouts | **Changes data and db format.** Chain and loadout references change meaning; INFERRED that upstream can't read id-based chains. | M | DS-017, DS-018, DS-030 |
| 2-2 | Live write-through: edits go straight into `botPresets[active]`, and save-on-switch is retired. | Every preset-scoped row | **Changes persistence behaviour**: more frequent writes. Save cost on floor devices needs a check, INFERRED. | M–L | DS-019 |
| 2-3 | An undo stack plus restore points per preset (10 each). Secrets are never written into either. | Preset card, Alt+Z, 복원 지점 | **New stored data.** Volume is a concern: 300 presets × 10 points (SLICE2 O-2, cap not decided). INFERRED it belongs in store2, not `.bin`. | M–L | DS-019, DS-027 |
| 2-4 | A library undo stack, plus 최근 삭제 kept 30 days across restarts. Create, duplicate and import join the stack. | Library | **New stored data** (soft-deleted presets) | M | DS-024, DS-028, DS-034, DS-037 |
| 2-5 | Locks keep their fields in a shared store outside the preset. Export writes the shared values. | Rows marked 모든 프리셋 공통 | **Changes data and db format**: those fields move out of presets while locked. | M | DS-025, DS-035 |
| 2-6 | Slot hotkeys `presetSlot1..9` that can be rebound and swapped, plus a one-time migration from today's order. | 단축키, slot assign | **Changes stored hotkey config.** Needs a migration. | S–M | DS-017, DS-022, DS-033, DS-039 |
| 2-7 | Import gets a preview, name-clash handling, a target folder and partial-bundle handling. Export gains bundles, with an option to include folders and favourites. | Import / export | **New export format** (bundle). Single preset export stays as today, INFERRED. | M | DS-032, R-17 |
| 2-8 | A new switcher component replaces the preset overlay, plus the chat header chip. | Switcher, chat header | UI only | M | DS-020 (chat lane owns the chip) |

## Slice 3: connections and model choice

| # | Engine change | Screen / element | Data and save format | Size | Refs |
|---|---|---|---|---|---|
| 3-1 | New `db.connections` (`id, name, provider, key, url?, options…, lastTest?`). Presets and every model row store a `(connectionId, modelId)` pair. One-time migration merges connections by address and key and names them after the host. | Connections, picker, models page | **Changes data and db format.** Keys, proxy URLs and model ids move out of loose fields. INFERRED: upstream `.bin` compatibility breaks unless the legacy fields keep being written, or the migration is declared one-way. Needs a compatibility decision. | L | DS-041, DS-054, DS-060, **DS-068** (MC-772: translate at `.bin` export, migrate on `.bin` import, round trip both ways; decided) |
| 3-2 | Request code reads the key, URL and provider options from the connection, with options stored per connection. | Every request | Reads 3-1 | L | DS-061, DS-059 |
| 3-3 | Keys stay out of undo, restore points and every export. An `${NAME}` environment reference is kept as a name. | Key field, delete with undo | **Changes export content.** Today only some fields are blanked in `downloadPreset`. INFERRED that `${NAME}` resolution needs checking against today's code. | S–M | DS-027, DS-047, DS-058, **DS-069** (MC-772: strip keys only from exports for sharing; `.rtb` and `.bin` backups keep keys; decided) |
| 3-4 | Custom models move under their connection. | Connection detail | **Changes data**: moves custom models | M | DS-048 |
| 3-5 | The model catalog gains capability and status fields (추천, 지원 종료, capabilities). Adds a recent-models list and a filter-chip state per device. | Picker | Catalog is code. Recents are new stored data. Chip state is device-local, INFERRED. | M | DS-045, DS-050, DS-053 |
| 3-6 | A new picker component replaces `ModelList.svelte` everywhere. | Every model choice | UI only | M | DS-042 |
| 3-7 | The models page holds main, sub, per-task and fallback rows. The mixed defaults: unset 감정 이미지 and 자동 제안 use the sub model; 장기 기억, 번역 and 기타 use the main model. Retires `seperateModelsForAxModels`, `auxModelUnderModelSettings` and `hideApiKey`. | 모델 page | **Changes data.** Retired flags need migration or must be ignored. | M | DS-044, DS-051 |
| 3-8 | A connection test (확인), run only when pressed, that stores `lastTest`. | Connection card and detail | New stored field (part of 3-1) | S–M | DS-046, DS-052 |
| 3-9 | A check before sending for key and model, and typed failure reasons (`key`, `model`, `quota`, `network`, `server`) with a fix target, for chat's error card and the 고치기 link. | Chat error card ↔ Settings | Code only | M | DS-043, DS-056, DS-057, DS-063; chat DD-132 |
| 3-10 | A `modelSelect` hotkey (Ctrl+M) that skips IME composition, rename and `{{`. | Anywhere | Hotkey config entry | S | DS-042 |

## Slice 4: parameters

Added 2026-10-28 from [SLICE4_SPEC.md §9](SLICE4_SPEC.md), the [review](reviews/slice4-review.md) and [re-review](reviews/slice4-rereview.md), and DS-079..DS-099. File anchors come from [research/slice4-params.md](research/slice4-params.md).

| # | Engine change | Screen / element | Data and save format | Size | Refs |
|---|---|---|---|---|---|
| 4-1 | A parameter schema with `group`, `default` (OAI2 plus neutral fills), `displayScale`, `hintKey`/`helpKey` and `sendable`. The 2048 max-response cap is retired; max response is capped by context. | Every parameter row, reset | Code only (`botSettingsParamsData.ts`, `types.ts`) | M | DS-081, DS-086, DS-087, DS-088 |
| 4-2 | "Not sent" keeps the value. The −1000 sentinel becomes a per-parameter off flag that the request check reads. Editing an off or unsupported value only explains (no auto-on). | 보내기 switch | **Changes data and preset format.** Migration: stored −1000 → off plus the DS-087 default. INFERRED: upstream `.bin` round trip needs −1000 written back at export (DS-068 pattern). | M | DS-084, DS-096 |
| 4-3 | Per-model output limit from model data only (LiteLLM `max_output_tokens`); no fallback table or override. Request clamps to the known limit while the stored value is over it. | Over-limit warning and 맞추기 | Code only | S–M | DS-085, DS-088, DS-091 |
| 4-4 | Per-task mode `same`/`own`; `own` starts as a copy and survives a switch back. Retires `seperateParametersEnabled`. Per-task penalties display ×0.01 (0..2, DS-090), and their sliders are gated by the task's model. | 모델 page lines, task sub-page | **Changes data.** Migration: flag on → each task with a non-empty block becomes `own`. INFERRED upstream impact as 4-2. | M | DS-082, DS-089, DS-090 |
| 4-5 | Service samplers (NovelAI, textgen, NovelList) become schema rows with label keys and help, in 이 서비스 전용. Unsupported rows dim with a reason; groups never collapse. Seed stays global with a badge. | Service groups, dimming | Code only | M | DS-080, DS-083, DS-092, DS-093, DS-094 |
| 4-6 | 고급: bias import preview, typed additional parameters, custom flags grouped and translated. Bias dims on models without bias support. | 고급 | Code only | M | SLICE4_SPEC §5, DS-080 (bias dimming) |
| 4-7 | A '보낼 값 보기' estimate panel built from the same send rules as the request (not captured from it), listing left-out values with reasons. | Parameters page | Code only | S–M | DS-095 |
| 4-8 | Theme packs: the protected parts and `minimums` floors (`--param-dim-opacity` ≥ 0.4, `--param-warn-bar` ≥ 2px) join the Settings registry in `packlint-settings.mjs`; today they live in `checks/th4/registry4.mjs`. | Pack install | Code only | S | DS-097..DS-099, DD-182, DD-187 |
| 4-9 | Strings: about 120 keys (labels, hints, help, reasons); `help.tempature` renamed with an alias. | All | Locale files | S | — |

Integration item, not measured: a custom-flag toggle repaints the whole page in the mockup (R4-10); measure on Note 9 and Pi 3.

## Slice 5a: 단축키, 페르소나, 확장

Added 2026-10-28 from [SLICE5A_SPEC.md §8 and Build notes](SLICE5A_SPEC.md), the [review](reviews/slice5a-review.md) and [re-review](reviews/slice5a-rereview.md), and DS-100..DS-126. Anchors are in [research/slice5a-lists.md](research/slice5a-lists.md). The builder's list had 15 items; 5a-14 and 5a-15 here regroup its last item and the strings.

| # | Engine change | Screen / element | Data and save format | Size | Refs |
|---|---|---|---|---|---|
| 5a-1 | A chord recorder: key and modifiers from one event, IME and Tab rules, a reserved list. Every shortcut needs a modifier or is an F-key; recording ends on a click, focus move or window blur. Conflict warning with swap. | 단축키 | Code only (`HotkeySettings.svelte`, `hotkey.ts`) | M | DS-103, DS-106, DS-118, DS-119 |
| 5a-2 | `metaKey` matching on Mac, the Control key refused, the Windows/Super key never recorded as Ctrl, AltGr refused. | 단축키 | Code only | S | DS-109, DS-120 |
| 5a-3 | Ctrl+1–9 as table rows (`presetSlot1..9`), with stored rows migrated in. Dead actions are hidden; model select is listed once 3-10 lands. Reset one or all, and unbind. | 단축키 | **Changes data:** new rows in `db.hotkeys`; migration appends them with today's keys. INFERRED: upstream ignores unknown actions. | S–M | DS-107, DS-108 |
| 5a-4 | Persona: no working copy, the id kept on an image change, `largePortrait` in the export, delete with undo, the last-persona guard, binding cleanup, cards with '연결된 채팅 N개'. | 페르소나 | **Changes export content** (`largePortrait`). Binding cleanup touches chats. | M | DS-110, DS-111, DS-121, DS-125 |
| 5a-5 | A per-plugin access line from the API version and `allowedIPC`, and a confirm on every off→on for V2/V2.1. | 플러그인 | Code only | S | DS-112, DS-113, DS-124 |
| 5a-6 | Visible update-check results (failures included), a check-now button, a stored last-check time and at most one automatic check a day. | 플러그인 | New device-local or db field for the last check (INFERRED either works) | S | DS-126 |
| 5a-7 | The args panel: real labels on `string[]` selects, commit on blur or Enter, validation, defaults. | 플러그인 설정 | Code only | S | DS-010 |
| 5a-8 | The starter template download is actually clicked. | 플러그인 | Code only | S | — |
| 5a-9 | The module info page, a name dialog that adds only on 만들기, and delete with usage counts, undo and id cleanup in characters and chats. | 모듈 | **Changes data** on delete (stale ids cleaned). | M | DS-104, DS-115, DS-116, DS-117, DS-123 |
| 5a-10 | The low-level confirm on every enable path (global, character, a preset namespace edit) and on every off→on. | 모듈 | Code only | S | DS-114, DS-124 |
| 5a-11 | The MCP URL stored as readable data; the convert-to-character mode retired into a menu action. | 모듈 | **Changes data:** MCP modules gain a readable URL field. | S | DS-104 |
| 5a-12 | The shortcut list is read-only by input capability (fine pointer, a keyboard seen), not by width alone. | 단축키 | Code only | S | DS-103 |
| 5a-13 | Plugin removal says saved data may not come back; settings-file import is one undo step. | 플러그인 | Code only | S | DS-122 |
| 5a-14 | Namespace rules for modules: no comma or space, a preset layer that follows edits, and the low-level confirm when an edit would enable a module through a preset. Slice 4's 모듈 연동 field needs the same rule. | 모듈, 파라미터 고급 | Code only | S | DS-114, DS-124 |
| 5a-15 | Strings: about 280 keys (SLICE5A_SPEC §9). | All | Locale files | S | — |

Integration notes, not engine items:
- Enable switches are not undo steps.
- The theme registry has no "restyle but not hide" leaf tier, so the plugin and module switches are critical.
- Studio's Back should return to the module info page when Studio is opened with `view=module&id=` (SLICE5A_SPEC §5.2); that is Studio's side.
- The th5a registry (`checks/th5a/registry5a.mjs`) merges into `packlint-settings.mjs` with registry4 (see the slice 4 hand-off).

## Slice 5b: 대화 기능 and 언어 › 번역

Added 2026-10-28 from [SLICE5B_SPEC.md](SLICE5B_SPEC.md) (§8, "Integration notes" and "Engine items"), the [review](reviews/slice5b-review.md) and [re-review](reviews/slice5b-rereview.md), and DS-127..DS-147. Anchors are in [research/slice5b-chatfeat.md](research/slice5b-chatfeat.md). The spec's Build notes list 15 builder items; they are regrouped here into 13 (the spec's 5b-11/12 fold into 5b-7, and 5b-14/15 into 5b-6/5b-5).

| # | Engine change | Screen / element | Data and save format | Size | Refs |
|---|---|---|---|---|---|
| 5b-1 | The memory engine becomes one stored choice standing for the five fields (`hypaV3`, `hypav2`, `supaModelType`, `hanuraiEnable`, `memoryAlgorithmType`), written together; one undo restores it. | 장기 기억 | **Changes data.** Existing chats and exports migrate both ways. | M | DS-129, DS-135 |
| 5b-2 | HypaV3 presets addressed by id; new asks a name; 복제; last-preset guard; import refuses foreign or broken files with a message; ratios clamped live (0 included). | 장기 기억 › 프리셋 | **Changes data:** index → id. | M | DS-136, DS-142 |
| 5b-3 | The embedding model (`hypaModel`) becomes a shared row on 모델, linked from memory and emotion. A change warns that memories may need rebuilding, **only once Lane A confirms** vectors go stale. | 모델 › 임베딩 | Code only (warning pending confirmation) | S | DS-137, DS-141 |
| 5b-4 | Voice, image and translation services refer to connections (new providers: Fish, Hugging Face, Stability, Fal, Voyage). `supaMemoryKey` and `voyageApiKey` become references. | 음성, 이미지 생성, 번역 | **Changes data:** keys migrate into connections (with slice 3 item 3-1). | M–L | DS-011, DS-013 |
| 5b-5 | The emotion prompt moves from 고급 to 감정 이미지; dimmed with explain-only under the embedding method. Lane A checks whether `emotionPrompt2` and `newGenData.emotionInstructions` are both live. | 감정 이미지 | Code only | S | DS-134, DS-146 |
| 5b-6 | Image generation from one schema per service: WebUI sampler list with 직접 입력, the WaveSpeed searchable listbox, LoRA and Hires as real fields, legacy ComfyUI only when selected. Defaults come from `database.svelte.ts`, never the mockup. | 이미지 생성 | Code only | M | DS-128, DS-131 |
| 5b-7 | Test actions (new): per voice service, image service and translation method, with typed failures (nokey, noaddr, unreachable, badkey, timeout, warming, nomodel), cancel, a status line, the voice named and a paid notice before running. | 음성, 이미지 생성, 번역 | Code only | M | DS-140, DS-144 |
| 5b-8 | Translator: plain labels, type-gated fields with reasons, cache tools for the AI method only (clear with confirm and undo), preset 복제 and naming. | 언어 › 번역 | Code only | S–M | DS-133, DS-139 |
| 5b-9 | Studio needs a voice kind for character voices (requested from the Studio lane); until then voice links carry no kind. Emotion images and the image prompt use `display`. | Studio links | Studio lane | S | DS-130, DS-143 |
| 5b-10 | Catalog removals: the rows slice 1 invented are deleted from the real catalog and search index. | 대화 기능, search | Design catalog only | S | DS-132 |
| 5b-11 | Cost and download numbers come from model data or provider info; unknown means no number. | All services | Code only | S | DS-147 |
| 5b-12 | Number fields keep only source bounds (mostly a minimum); no invented maximums. | 장기 기억 | Code only | S | DS-132 |
| 5b-13 | Strings: about 200 keys (SLICE5B_SPEC §9). | All | Locale files | S | — |

Integration notes, not engine items (SLICE5B_SPEC "Integration notes"): the DS-141 warning ships only after Lane A confirms; the demo-only "목업 표시" label is not product; R5B-10 (the last-preset guard shows in every default install), R5B-13 (a possible double announcement, unverified without a screen reader), R5B-14 (the embedding line becomes one string), the Hugging Face 503 running state, and the open DD-195 ceilings for `--p5b-*` tokens. The th5b registry (`checks/th5b/registry5b.mjs`) merges into `packlint-settings.mjs` with registry4 and registry5a.

## Home return item (DD-210, DD-203, DD-239, DD-229)

Added 2026-10-28 from [HOME_RETURN_SPEC.md](HOME_RETURN_SPEC.md), the [review](reviews/home-return-review.md) and [re-review](reviews/home-return-rereview.md), and DS-148..DS-151.

| # | Engine change | Screen / element | Data and save format | Size | Refs |
|---|---|---|---|---|---|
| hr-1 | Settings accepts `from=home&lang=&mode=&return=` and, at the top level, Back goes to `return`. Accept only a same-origin relative Home URL (the app's Home route; the mockup allows `../home/home.html` and `../mockups/home.html`); anything else behaves as absent. Never read or clear Home's handoff state. | Settings Back (button, Esc, mouse back, system back) | Code only | S | DD-210, DS-149 |
| hr-2 | Going Home first unwinds Settings' own history entries, then replaces the current entry with Home, so system Back from Home does not re-enter Settings. On Android the equivalent is finishing the Settings route, not pushing Home. | Navigation | Code only | S | DS-149 |
| hr-3 | Deep links: a known section opens its own page whatever `page=` says; `section=prompts` is an alias of 모델 › 프롬프트 설정; lookups are own-property only. | Deep links | Code only | S | DD-239, DS-151 |
| hr-4 | 최근 삭제 › 영구 삭제 asks once, naming the item, the count and the size (an estimate is marked as one). | 페르소나, 확장 › 최근 삭제 | Code only (size from the stored item) | S | DD-229 |
| hr-5 | The mockup's `settings/index.html` is a design-package entry only; the app has one Settings route and needs no equivalent. | — | — | — | DS-148 |

## Slice 5c-1: 화면·읽기 and 입력·접근성

Added 2026-10-28 from [SLICE5C1_SPEC.md](SLICE5C1_SPEC.md) ("Engine items", full text there), the [review](reviews/slice5c1-review.md) and [re-review](reviews/slice5c1-rereview.md), and DS-152..DS-175. Anchors are in [research/slice5c1-display-input.md](research/slice5c1-display-input.md).

| # | Engine change | Screen / element | Data and save format | Size | Refs |
|---|---|---|---|---|---|
| 5c1-0 | `instantRemove` gets its true name, 지울 때 범위 묻기: deleting asks this message only or this and what follows; nothing deletes by itself. | 입력·접근성 › 삭제와 확인 | Code only | S | DS-169 |
| 5c1-1 | New profile-wide `visibleModes` (rp, hybrid, utility; default all) and `hideUnusedModes` (default false). With hiding off all modes show; the repair state restores both. Any single mode may be the only one. | 화면·읽기 › 모드, Home | **Changes data:** two new fields, migrated to all modes and false. | M | DD-250, DS-155, DS-156, DS-170, DS-175 |
| 5c1-2 | New `lowPower` (bool) and `reducedMotion` (system/on/off); reduce motion supersedes the two components that read the media query today; both override `animationSpeed`. Scope (device or profile) is the main session's call. | 화면·읽기 › 움직임과 성능 | **Changes data:** two new fields. | M | DS-157 |
| 5c1-3 | Tagged proposals with no field today: haptics off (touch only), edge-swipe sidebar (default on, the gesture exists), reduce transparency. | 화면·읽기, 입력·접근성 | **Changes data** if adopted: three new fields. | S–M | DS-158 |
| 5c1-4 | Inverse presentation only: `unformatQuotes` shown as 따옴표 꾸미기; `animationSpeed` as a 느림–빠름 slider (0 = 즉시). | 화면·읽기 | Code only | S | DS-162 |
| 5c1-5 | `customFont` gets a label; the custom-quote boxes fall back to the stored curly default. | 화면·읽기 | Code only | S | DS-167 |
| 5c1-6 | `newMessageButtonStyle` shown only with auto-scroll on and always-scroll off, as a six-position picker; `assetWidth` as unlimited / hidden / slider. | 입력·접근성 › 스크롤; 화면·읽기 | Code only | S | — |
| 5c1-7 | Moved rows: prompt comparison to 프리셋; go-to-character-on-import to 데이터·백업; request info to 고급; asset preview and the two lorebook options are Studio settings with search-only entries in Settings. | Several pages, Studio | Code only | S | DS-163 |
| 5c1-8 | `hideApiKey` retired (field kept, ignored); every key field has its own show button, masked again on close or save. | 모델 › 연결 | Code only | S | DS-164 |
| 5c1-9 | Dead fields hidden from page and search, values kept: `showMemoryLimit`, `memoryLimitThickness`, `moveInsteadOfCopyOnCMPConvert`; the dead `theme: 'custom'` is not offered. | — | Code only | S | DS-159 |
| 5c1-10 | `useLegacyGUI` dropped (BotSettings and OtherBotSettings lose the flag in the same change). | — | Code only | S | DS-168 |
| 5c1-11 | `customSidebarItems` removal gets a 10 s Undo instead of an instant delete. | 입력·접근성 › 메뉴와 사이드바 | Code only | S | DD-223 |
| 5c1-12 | Notifications: guard `Notification.requestPermission`, ask on first use (today it only asks after a denial), show a status line, switch off on refusal. | 화면·읽기 › 소리와 알림 | Code only | S | DS-165 |
| 5c1-13 | One undo-toast helper with an until-line (page, 10 s, purge, previous preset, connection, restore point); toasts name Alt+Z / ⌥Z only. | All Settings toasts | Code only | S | DD-223, DS-166, DS-171 |
| 5c1-14 | Step names and the 17 scheme names move to the locale files (Korean in KO). | 화면·읽기 | Locale files | S | — |
| 5c1-15 | Pro Tools is one row on 입력·접근성; custom colour scheme export and import in the editor; `lite` listed as a preset. | 입력·접근성, 화면·읽기 | Code only | S | DS-161, DS-173, DS-174 |
| 5c1-16 | `blockquoteStyling` only applies while quote styling is on (row dimmed otherwise); the Alt+Z stack lives for the app session (50 entries). | 화면·읽기 › 채팅 표시 | Code only | S | DS-171 |

The th5c1 registry (`checks/th5c1/registry5c1.mjs`) extends REG5B and merges into `packlint-settings.mjs` with the earlier registries.

## Slice 5c-2: 데이터·백업, 고급 and 언어 (built, not independently reviewed)

Added 2026-10-28 from [SLICE5C2_SPEC.md](SLICE5C2_SPEC.md); the full text of items 5c2-1..5c2-19 is in its "Engine items". Decisions DS-176..DS-191; anchors in [research/slice5c2-data-adv-lang.md](research/slice5c2-data-adv-lang.md). The slice was parked before an independent review, so treat these as reviewed by the builder only.

| # | Engine change | Data and save format | Refs |
|---|---|---|---|
| 5c2-1 | New `.rtb` backup format: the whole profile with connection keys and fork-only data, restored by the same path as `.bin`. | **New file format.** | DS-177, DD-228 |
| 5c2-2 | Lane A supplies the `.bin` leave-out list (kinds and counts of fork-only data); the mockup's list is labelled mock. | Code only | DD-227, DD-251, DS-191 |
| 5c2-3 | An abort signal for the restore's index walk and tab-lock wait; Cancel ends before the first asset write. | Code only | DS-176 |
| 5c2-4 | A file restore writes a safety snapshot of the current state first. | **Writes a snapshot.** | DS-182 |
| 5c2-5 | Decode the database and find damaged blocks before the first asset write, so the salvage question comes while Cancel is still possible. | Code only | O-6 |
| 5c2-6 | The snapshot list returns time, size and character count. | Code only | DS-181 |
| 5c2-7 | The restore returns its result and waits for 다시 시작 before reloading. | Code only | DS-190 |
| 5c2-8 | Settings-file export and import (new): app settings and preset choices, never keys or chats; import lists changes and has a grouped Undo. | **New file format.** | DS-178, DS-187 |
| 5c2-9 | Progress events replace the hard-coded English wait text of backup and restore. | Code only | — |
| 5c2-10 | `archiveCharacters` moves to 데이터·백업 › 저장 공간, default on. | Code only | DS-180 |
| 5c2-11 | No `persist` setting (the app persists storage itself). | — | DS-179 |
| 5c2-12 | 고급 regrouped and relabelled (§3 of the spec). | Code only | DS-185, DS-186 |
| 5c2-13 | Streaming optimisation not shown; its migration stays. | Code only | DS-184 |
| 5c2-14 | `showDeprecatedTriggerV1` and `legacyMediaFindings` in a collapsed 권장하지 않음 group until main confirms whether they are dead. | Code only | DS-184 |
| 5c2-15 | Custom models stay under 연결 (slice 3); reorder is designed nowhere (O-2). | Code only | DS-048, DS-049 |
| 5c2-16 | A language change applies after reopening; the line and button say so. `translang` stays as 번역 파일 받기. | Code only | DS-188, DS-189 |
| 5c2-17 | Pattern adoption: the pattern's stylesheets and scripts, `RisuPattern.addStrings`, the registry merge, and `--nexus-warning-rgb` (plus `--pattern-on-accent`, `--pattern-on-danger`) in packs. | Code only | DS-153 |
| 5c2-18 | Diagnostics in 고급 › 문제 해결: request logs, statistics, bug-report export. | Code only | DS-186 |
| 5c2-19 | Number bounds as in the app; out-of-range typed values clamp and announce (O-7: confirm the app's behaviour). | Code only | — |

Pattern findings for the patterns/ owner (spec §10): a secondary answer in `openTaskFlow` closes the sheet so the card vanishes (O-4); the result card has no slot for an adopter action such as 다시 시작 (O-3); import copy is fixed to "added" (O-5). The th5c2 registry (`checks/th5c2/registry5c2.mjs`) merges the pattern fragment; `packlint-settings.mjs` now allows the pattern's token names.

## Cross-cutting

- **Theme readiness.** This needs no engine change in Settings. Pack loading and install-time enforcement of `data-part-critical` (DD-149) belong to Lane A's theme work.
- **Strings.** New keys go into `src/lang/en.ts` and `ko.ts`, and the locale-parity test keeps the other locales in step. Size S per slice.

## The biggest save-format risks

These are INFERRED:

1. **Item 3-1, connections and the migration.** This is the only change that rewrites how existing users' configuration is stored. The compatibility question is now settled by DS-068 (MC-772): translate at export.
2. **Items 2-1 and 2-5, preset ids, folders and locks.** These change the meaning of chains and loadouts and move fields out of presets.
3. **Items 2-3 and 2-4, restore points and 최근 삭제.** These add stored volume that floor devices must hold. The cap is open (SLICE2 O-2).
