# Studio slice 4: character and group forms

Status: **built, reviewed three times, revision 1.4** (2026-10-28). Rev 1.4 folds in the focused re-check ([../reviews/2026-10-28-studio-slice4-recheck.md](../reviews/2026-10-28-studio-slice4-recheck.md)) and **DD-197**: layout-size floors, the looser set (7a), the code-check shortcut and item menu guards for a private character (1), one announcement for an import result after Studio closed, and a fixed toast (section 19.3). R-1 (unclosed blocks) is fixed in the shared lint; Studio's repros are in 19.3. Rev 1.3 folds in the re-review ([../reviews/2026-10-28-studio-slice4-rereview.md](../reviews/2026-10-28-studio-slice4-rereview.md): 4 findings partly fixed, 7 majors N-1..N-7, 9 minors, 3 nits) and the decisions **DD-194..196**: the private-licence guard covers every item kind (at shell level), the risky section's tokens get ceilings and a colour check, and an import that finishes after Studio closed shows an app-wide toast. Changed sections: 1 (private licence), 7.1 (imports), 7.3 (the scan and its jump), 12 (7a floors, new 7b ceilings and colours), 13 (new keys), 14, 16 (shell hooks), 17, 19 (second table). Rev 1.2 folds in the builder's gap decisions **DD-179..186** and the independent review's decisions **DD-188..193** (review: [../reviews/2026-10-28-studio-slice4-review.md](../reviews/2026-10-28-studio-slice4-review.md); mapping of every finding to its fix in section 19). Changed sections: 1 (private licence), 3 (header Undo and the note), 4.2 (toggle row, escape output), 5.2 (default wording), 6 (floors, escape text, question helper), 7.1, 7.3, 8.1, 12 (parts, floors), 13, 14, 15, 17, 18, 19. Rev 1.1 folded in DD-166..178; rev 1 was the first draft. Task: [tasks/2026-10-26-studio.md](../tasks/2026-10-26-studio.md). Built and checked in [checks/builder-checks-s4.md](checks/builder-checks-s4.md). Discovery: [research/character-forms.md](research/character-forms.md), [research/today-authoring.md](research/today-authoring.md) §1a, §1b, §5. Builds on [SLICE1_SPEC.md](SLICE1_SPEC.md) rev 2.1, [SLICE2_SPEC.md](SLICE2_SPEC.md) rev 2.1 and [SLICE3_SPEC.md](SLICE3_SPEC.md) rev 2.2. Group vocabulary: [chat SLICE3](../chat/SLICE3_SPEC.md) §6 and DD-053..064. Theme rules: [THEMING.md](../THEMING.md), DD-142..161. Decisions: DD-162..165, DD-166..178, DD-179..186, DD-188..193, DD-194..197; inherited: DD-095..104, DD-157 in [DECISIONS.md](../DECISIONS.md).

Scope: the real **기본 정보**, **표시와 에셋** and **고급** forms for a character, and the group's form (members, order, talkativeness, group author note, group picture and view mode). They replace slice 1's placeholder forms (SLICE1 §8) for the kinds `basic`, `display`, `advanced`. Out of scope: Voice/TTS and Share tabs (a later slice, DD-162), lorebook, regex, scripts, toggle definitions (slices 1-2 and later), background HTML, the module and preset `고급` forms (they keep slice 1's placeholder until their own slice), the real file picker and storage (simulated here).

Marked **(design default)** = chosen here inside the decided intent, open to veto. Marked **requires lane A** = needs app work; section 15 lists it. Section 17 lists the product questions with their decisions (DD-166..178, all decided); only four Lane A facts stay open there.

## 0. Today (source-read; details and line numbers in [research/character-forms.md](research/character-forms.md))

| Fact | Anchor (`src/`) |
|---|---|
| One component with 7 icon-only tabs; slice 4 replaces Basic (0), Display (1) and Advanced (2). A character whose license is `private` renders only "not allowed". | `lib/SideBars/CharConfig.svelte:213-241, :245, :330-334` |
| Every field binds straight to the database: no draft, no undo, no save status. | `CharConfig.svelte:246-1283` |
| Basic: name, description, first message (each with a token count line), the author note, desktop-only toggle values. The author note is the **open chat's** note, not the character's. | `:246-252, :311-323` |
| Group Basic: member grid with six unnamed talk bars (`aria-labelledby="loading"`), an active check, removal by tapping the avatar with no confirm, an avatar-only member picker, and "talk by order" which sits in the desktop-only block, so phones cannot set it. | `:256-328`; `process/group.ts:10-66` |
| Display has three sub-tabs. Icon: main image + alternates, a hidden remove mode on a trash icon, a new image **replaces** the main one and files the old one away. Screen: `viewScreen` select, emotion images (name + delete, no reorder), image-generation prompt fields. Assets: name + delete, optional preview. | `:340-676`; `characters.ts:152-273` |
| Changing `viewScreen` or the inlay check rewrites the image-generation text fields with the new mode's defaults. | `process/inlayScreen.ts:81-113` |
| Advanced: about 25 fields in one list, bias table, creator's comment (multi-language), personality and scenario hidden unless long, a single-line depth prompt, alternate first messages as a table of 160 px boxes, four flags with no confirm, memory buttons, "apply module" and "convert to module". | `:1054-1283` |
| Deleting an asset or an alternate first message sets the open chat's `fmIndex` to -1 (reason not explained in source read). | `:644, :1191` |
| Large risk with little warning: low level access has a Help line, no confirm (only import asks). | `:1209-1210`; `characterCards.ts:875` |

## 1. Where it lives, and the data rules

**Private licence (DD-188, DD-194).** The guard is the shell's, not a form's. While hidden, none of the character's content shows anywhere: Basic, Display and Advanced show the name and the notice; the other item kinds (lorebook, regex, scripts, toggles, background HTML) are listed by their kind name, cannot be added to, are not searched, and open the same notice; the Test panel, the Problems list and the combined views say nothing about them. "내용 보기" asks a protected question; after it, everything of the character is read only (every control disabled, text selectable), and it hides again when Studio closes, on a reload simulation, or on "다시 숨기기".

- **Kinds (SLICE1 §3):** `기본 정보` (`kind=basic`), `표시와 에셋` (`kind=display`), `고급` (`kind=advanced`) under a character; a **group** owner shows the same three kinds with the group's own forms (section 8). Tree counts: basic none; display = images + emotions + assets; advanced = filled fields. Character-only kinds stay hidden for groups, as today (`CharConfig.svelte:170`).
- **Deep links:** adds `field=<key>` to SLICE1 §1 (answers SLICE1 O-8 for these kinds), for example `slice4.html?owner=character:sera&kind=advanced&field=systemPrompt`. Keys are in the inventory (section 4). An empty (folded) field opens its group, lists it as added and focuses it. An unknown key gives SLICE1's persistent notice "그 칸은 없어요 · {kind} 맨 위로 열었어요". **A known key that is not shown here** (the chat's memory text without a chat, a Hypa button with its setting off) gives "{칸} 칸은 지금 보이지 않아요 · {이유}" and status `field-missing`. Slice 1's Apply reason link "낮은 수준 접근 설정 열기" now targets `kind=advanced&field=lowLevelAccess` (scrolls to the risky section and focuses the switch; never toggles it).
- **Store-backed (DD-157).** The forms hold only an `ownerId` and read every value from the store by id on each render. They keep no copy of the character, a group, a member list or an image list. Unsaved input lives in a **draft holder** keyed `drafts[ownerId][fieldKey]`, separate from the store: it holds (a) text still inside LT's pause window, (b) a pending risky-flag question, (c) an image-picker selection before "추가", (d) the "add a field" lists the user opened, (e) a name being renamed. A draft is removed on commit or cancel. **Derived values are recomputed from the store** and never cached in a component: token counts, "has a value" and the folded set, tree counts, group "who can speak" counts, "used in {n} places" for an asset name, duplicate emotion names, problem counts.
- **Saving is the hybrid model (DD-095):** every field here is a live item. LT writes after composition ends plus a pause (slice 3 §2); other controls write at once. Each commit is an owner-history step with the owner-named undo (SLICE1 §5); typing coalesces. Status chip, "changed elsewhere" (DD-102, kept per item and per field: a field changed elsewhere shows the banner on that field and the group header carries the marker), restore point and durable delete undo (DD-100) are the shell's and apply unchanged. Nothing in this slice is a code draft.
- **Private license (DD-188, replaces the rev 1.1 default).** Today the editor refuses a character whose license is `private` (`CharConfig.svelte:245, :330`). Studio keeps that by default: **the content is hidden**. The form shows the name (disabled) and a notice with one line "이 캐릭터는 편집할 수 없어요", a sentence that the content is hidden by default and export stays blocked, and a button **내용 보기**. The button opens a **protected question** (`studio-private-confirm`, `data-part-critical`, role `alertdialog`, default focus 취소; Esc, outside tap and Back mean 취소) that says the content can be read but not edited, hides again when Studio closes, and export stays blocked. Asked **once per character**: after 확인 every form of that character shows its content **read only and selectable** (no editor mounted, no add rows, switches disabled) and the notice offers 다시 숨기기. The answer lives in memory only (not remembered across Studio sessions, not in a draft). Hidden content is never reached by search (only the name is indexed), `?field=` shows the notice "이 캐릭터의 내용은 숨겨져 있어요 · \"내용 보기\"를 누르면 열려요", the tree shows no counts for it, and the Problems and Test panels list nothing from its text. State `?state=f-basic-private`, `f-basic-private-shown`, `f-private-ask`, `f-adv-private`, `f-adv-private-shown`.

## 2. Form frame (shared by all three forms)

- A form is a column of **sections** (`studio-form-section`). A section has a header (button, `aria-expanded`), optional count, and body. Group headers in Advanced and the three Display segments use the same component.
- A **field** (`studio-field`) is: label row (label, optional help button, owner/scope tag where it is not the form's owner, token chip for LT fields that reach the prompt, status marker when changed elsewhere), control, optional note line (error, info). Help text opens an inline disclosure under the label (`aria-expanded`/`aria-controls`, `role="group"`), not a tooltip; text comes from today's Help keys (not re-read here).
- **Long text = LT.** Every long text field uses the slice 3 editor with a declared mode (table in section 4). Single-line values (name, creator, version, nickname, emotion name, asset name, bias token) are plain inputs; the depth prompt's text becomes a compact LT (3 lines) with the depth number beside it, because it reaches the model (DD-175).
- Labels are above the control on every width (no side-by-side label columns). Field spacing, group spacing, thumbnail sizes and talk-segment size are **role tokens** (section 12).
- **Token chips:** on every `cbs`/`html+cbs` LT field that reaches the prompt, exactly as slice 3 §7 (units, estimate fallback, "목업" tag in the mockup). Plain-mode fields and the creator's comment have none. Every long-text field that reaches the prompt gets a chip (DD-168); today only description, first message, author note and lorebook content count. Which fields are always sent in a turn is **unverified**, so the chip never claims it (slice 3 §7 wording: not the per-turn cost).

## 3. 기본 정보 (Basic) form: character

Order: 이름, 설명, 첫 메시지, 다른 첫 메시지 (DD-167: moved here from Advanced), 작가 노트 (DD-172).

| Field | Key | Control | Mode | Notes |
|---|---|---|---|---|
| 이름 | `name` | single line | plain | Required: an emptied name reverts on blur with the note "이름은 비울 수 없어요" (same rule as the group name in chat slice 3 §6; today no validation). |
| 설명 | `desc` | LT | cbs, chip | Today `:248`. |
| 첫 메시지 | `firstMessage` | LT | html+cbs, chip | Today `:251`. |
| 다른 첫 메시지 | `alternateGreetings[]` | slice 3 §6 cards | html+cbs | Directly under the first message (DD-167), as slice 3's card list, per-card chip. With no cards the list shows only its add button and "다른 첫 메시지가 없어요"; it is never folded (it is not an Advanced field). Search and `field=alternateGreetings` open Basic at it. |
| 작가 노트 | `chats[chatPage].note` | LT | cbs, chip | **Chat-scoped.** Shown only with a context chat, tagged "이 채팅" (message-square, DD-043), placeholder = the default note text (`getAuthorNoteDefaultText`, `CharConfig.svelte:317`). Its edits are history steps of the chat owner, not the character. **Header Undo and Redo follow the focus (DD-189):** while focus is in a chat-scoped field (author note, memory text) they address the chat owner and the label names it ("이 채팅: 되돌리기: 작가 노트 고침"); focus anywhere else in the form, or leaving the item, points them back at the character. Without a context chat the row is replaced by the one-line pointer "작가 노트는 채팅마다 따로예요. 채팅을 열면 여기서 고칠 수 있어요" (DD-172; the 슈퍼메모리 text in Advanced › 기억 follows the same rule). |

Not in this form: the toggle **values** panel (`CharConfig.svelte:321-323`) stays in the chat's toggles panel (TOGGLES_SPEC); a row at the end of the form links to it only when there is a context chat ("토글 값은 채팅에서 바꿔요" with a button that returns to the origin). Toggle **definitions** are slice 2.

## 4. 고급 (Advanced) form: groups, folding and the field inventory

### 4.1 Folding rule (DD-163)

- A field **with a value is always shown**, inside its group, in the group's order. "Has a value" is computed from the store: text after trim is not empty; list length > 0; depth prompt has text; the creator's comment has any language entry that is not blank (its stored single space counts as empty); switches are not folded (section 6 and group Memory).
- **Empty fields are folded** into one row at the end of the group: `필드 추가 ({n})`, a disclosure button. Opening it lists the empty fields of that group, each with its name and a one-line description; choosing one shows it in the group and moves focus into its control. A group with no values shows its header collapsed with the row "비어 있어요 · 필드 추가 ({n})".
- **Stable while in use (DD-174):** a field the user emptied, or added and left empty, stays shown until the user leaves this item (a visit-scoped draft, DD-157 (d)). It then folds again. A field that becomes filled elsewhere (DD-102) appears at once.
- **Search finds every field (DD-163):** SLICE1 §4's index gains one entry per field (kind advanced/basic/display, group, label, KO/EN synonyms, "비어 있음" when empty), so searching "시스템" finds the empty system prompt, opens its group and focuses it (`field=`). Content search is unchanged for filled fields.
- Groups are collapsible; collapse state is remembered per owner on this device (device-only, DD-099). The first visit expands groups that have values.
- `personality` and `scenario` carry the tag "권장하지 않음" in the add-a-field list. Today they show only if `db.showUnrecommended` or longer than 3 characters (`CharConfig.svelte:1120, :1124`); here a value of any length shows them, and an empty one is addable with the tag whatever the setting says (design default).

### 4.2 Inventory

The seven groups are decided (DD-166); the protected section follows them. "LT" = slice 3 editor with the mode shown. Source anchors are `CharConfig.svelte`.

| Group | Field (key) | Control / mode | Chip | Today | Notes |
|---|---|---|---|---|---|
| **프롬프트** | 시스템 프롬프트 (`systemPrompt`) | LT cbs | yes | :1112 | |
| | 전역 노트 대체 (`replaceGlobalNote`) | LT cbs | yes | :1115 | Empty means "do not replace" (help text, `lang/en.ts:539`). |
| | 추가 설명 (`additionalText`) | LT cbs | yes | :1118 | Added to the description only when needed. |
| | 성격 (`personality`) | LT cbs | yes | :1121 | 권장하지 않음. |
| | 시나리오 (`scenario`) | LT cbs | yes | :1125 | 권장하지 않음. |
| | 깊이 프롬프트 (`depth_prompt.depth`, `.prompt`) | number + compact LT cbs | yes | :1147-1151 | Number is the depth, beside the text (DD-175); one field, two controls, valued when the text is non-empty. |
| **대화** | 예시 대화 (`exampleMessage`) | slice 3 §6 cards | cbs, chip per card | :1104 | Stored as one string; cards are a view (DD-123). |
| **작품 정보** | 제작자 코멘트 (`creatorNotes`) | LT plain with language tabs | none | :1107 | Tabs per language as `MultiLangInput`; `+` adds a language (KO/EN first). Editing sets `removedQuotes=false` (:1108). |
| | 제작자 (`additionalData.creator`) | single line | | :1139 | |
| | 버전 (`additionalData.character_version`) | single line | | :1142 | |
| | 별명 (`nickname`) | single line | | :1145 | Replaces the name in `{{char}}` and `<char>` (help `en.ts:596`). |
| **변수와 번역** | 기본 변수 (`defaultVariables`) | LT plain, mono, key=value | none | :1130 | No CBS features (slice 3 §1). |
| | 번역가 메모 (`translatorNote`) | LT plain | none | :1133 | |
| | 토글 정의 (`customModuleToggle`) | **link row** | | :1136 | Not a text box here: one row "토글 정의 · {n}개" that opens the slice 2 builder (`kind=toggles`); with no definition it reads "토글 정의 추가" (opening the builder creates the first one). One editor per value. |
| **생성 조정** | 토큰 편향 (`bias[]`) | row list | | :1059-1101 | Row: token text, value -100..100 (clamped, note on clamp), delete. No duplicate check today; here an info note "같은 토큰이 있어요". Phone: each row is a card (two fields stacked). |
| **기억** | 슈퍼메모리 (`chats[chatPage].supaMemoryData`) | LT plain | none | :1249-1252 | **Chat-scoped**, shown only with a context chat and when it already has content, tag "이 채팅". |
| | 하이파 메모리 V2 / V3 | button that opens the existing modal | | :1226-1248 | Shown only under today's conditions (`db.supaModelType`, `db.hypav2`, `db.hypaV3`); it is an action, never folded. |
| **모듈** | 모듈 적용 | action button | | :1254-1259 | Copies a module's lore, regex etc. into the character; asks which module (existing picker) and says it is a copy: "모듈의 내용을 이 캐릭터로 복사해요 · 모듈과 이어지지는 않아요" (DD-176). |
| | 모듈로 변환 | action button | | :1261-1274 | Creates a module from this character; result toast "모듈을 만들었어요" with a link to the new module owner (today a plain alert) (DD-176). |
| **위험한 설정** | see section 6 | protected | | :1207-1224 | Always last, never folded. |

`hideChatIcon` is in Display › 사진 (section 5.1; DD-169) and the alternate first messages are in Basic (section 3; DD-167), so neither is in this inventory. Group (character-less) Advanced is in section 8.

Counts in the tree: `고급 · {filled}/{total}` (design default); groups' headers show `{filled}`.

## 5. 표시와 에셋 (Display) form: character

One page with a three-way segmented control (**사진 / 화면 / 에셋**, a `tablist` with roving focus, counts in the labels: "에셋 4"), as today's three sub-tabs but remembered per owner on this device. Deep links and search reach any segment (`field=`). Segment panels stay in the DOM for AT only when visible (hidden panels are `hidden`).

### 5.1 사진 (portrait)

- **Main portrait** (`studio-portrait-main`): a large tile (square, or 2:3 when `largePortrait` is on) with the label "대표 사진", a `⋯` menu (바꾸기, 삭제) and an empty state with "사진 추가". **Alternates** (`ccAssets`, `studio-portrait-alt`): a wrapping row of small tiles, each with a `⋯` menu (**대표로 쓰기**, 삭제) and a visible name. Selecting "대표로 쓰기" swaps with the main portrait (today's `changeCharImage`, no data lost); "삭제" removes with the durable undo toast (DD-100). **There is no hidden remove mode.** Deleting the main portrait promotes the first alternate, as today (`CharConfig.svelte:380-382`), and the toast says so.
- **사진 추가** opens the simulated picker (section 7). A new image **becomes the main portrait** and the old one is filed among the alternates, as today (`characters.ts:201-207, :214-228`; DD-171), with a line under the button "새 사진이 대표가 되고, 이전 대표는 다른 사진으로 남아요". The add is one undo step.
- Switch **세로 사진** (`largePortrait`, only with a main portrait): changes the tile shape in the form so the effect is seen.
- Switch **채팅에서 사진 숨기기** (`hideChatIcon`; today's "Hide Icon UI", `:1214` in Advanced), placed here under the portrait tiles (DD-169). It is a plain switch, not a risky one.
- PNG text chunks are copied into the character on pick (`characters.ts:168-194`); the mockup shows this once as an info line on a PNG sample ("사진에 들어 있던 설명 글 {n}개를 가져왔어요"), requires lane A to expose it.

### 5.2 화면 (additional character screen)

- **화면 방식** select: 없음 / 감정 이미지 / 이미지 생성 (character); 없음 / 한 캐릭터 / 여러 캐릭터 / 두 캐릭터 강조 (group, section 8).
- **Mode switch fills text (today's behaviour made visible).** Changing the mode rewrites the image-generation text fields with that mode's defaults where they are empty or still a known default (`inlayScreen.ts:81-113`). The form fills and says so (DD-177, DD-180: the tag goes on the author's first edit of a field, "기본값으로 되돌리기" stays; the note and the announcement speak only of fields that are on screen, and a default written into a field that is hidden (감정 지시사항 with 인레이 off) is announced as "감정 지시사항은 채팅 화면에 넣기를 켜면 보여요"): a persistent note under the select "이 방식에 맞는 기본 문구로 채웠어요 · 직접 쓴 문구는 그대로예요", the filled fields carry the tag "기본값", each has "기본값으로 되돌리기", and the mode switch is one undo step. It does not ask first. Which fields were filled needs engine change #29. The KO label for the inlay switch below is still a proposal for the translator pass.
- **감정 이미지 mode:** help line "채팅 분석에 보조 모델을 써요" (today's `emotionWarn`, shown once under the select, not twice). A list of rows (section 7.2), `감정 지시사항` (LT cbs, only when 인레이 on) and the switch **채팅 화면에 넣기** (`inlayViewScreen`, today's "인레이 스크린"; KO label still a proposal for the translator pass, DD-177).
- **이미지 생성 mode:** three LT fields in this order: 프롬프트, 부정 프롬프트, 지시사항 (all cbs; today `:564-569`), then the same inlay switch.
- Turning the inlay switch off with no assets stores nothing for assets, as today (`:550-553`); the form shows no wording about that.

### 5.3 에셋 (additional assets)

- Optional controls shown only when the app setting exists today: **에셋 프롬프트 넣기** (`prebuiltAssetCommand`) and **에셋 스타일** (static / dynamic) with `db.newImageHandlingBeta` (`:579-587`); in the mockup both appear in one state to be drawn.
- The list (section 7.3): thumb or type tile, name field, type + size, "글에서 쓰는 곳 {n}", `⋯` (삭제, 미리보기, 미리보기에서 빼기 / 넣기). Add through the simulated picker. Header line: "글에서 `{{image::이름}}` 처럼 이름으로 불러요" (today's help, `lang/ko.ts:507`), with the macro forms listed in the help disclosure.
- Count and a derived "쓰는 곳" per asset come from scanning, at render (DD-157), the character's description, first and alternate first messages, the Advanced prompt fields, the four Display texts, **its default variables, translator note and creator comments (rev 1.3)** **and its lorebook, regex and scripts** (DD-190; a place names its kind and item, e.g. "로어북 · {이름} · 1번째 줄", and jumps to that item). The help disclosure lists what is scanned; the scan is chunked and cancellable, and shows "세는 중" until done.

## 6. 위험한 설정 (protected section, DD-165)

- The **last** section of 고급, `data-part="studio-risky"` and `data-part-critical` (DD-149). Never folded, never collapsed on first visit, never in the "add a field" lists. Visually separated by the danger role colour on its header edge (token, not colour alone: it also has the `triangle-alert` icon and the heading text).
- Heading "위험한 설정" and a **warning line that is always visible**: "이 설정은 캐릭터가 할 수 있는 일을 바꿔요. 꼭 필요할 때만 켜세요." (`studio-risky-warning`).
- Each flag is a labelled switch with its own explanation line visible under it (not behind Help): `lowLevelAccess` ("낮은 수준 접근": the help text, `lang/en.ts:603-604`), `utilityBot` ("유틸리티 봇": help `en.ts:535`), `escapeOutput` ("출력 이스케이프": **no source help text; the effect is untraced** (`index.svelte.ts:2050`); DD-193: the line and the question say "답장을 표시하는 방식이 바뀌어요. 정확한 효과는 아직 확인 중이에요" with a visible tag "목업 문구 · 확인 뒤 교체" (`data-tag="mockup-note"`) until Lane A traces it, O4-1). Exactly these three flags are in the section (DD-169); `hideChatIcon` is not (Display › 사진, section 5.1).
- **Turning one on asks once.** The switch is controlled by the store; pressing it opens the question sheet (`studio-risky-confirm`, `data-part-critical`, role `alertdialog`) and **the switch stays off** until the user confirms. The sheet shows the flag's name, its explanation, and for low level access the import wording's consequence ("이 캐릭터가 AI 모델과 저장소에 직접 접근할 수 있게 돼요", from `lowLevelAccessConfirm`, `en.ts:1643`). Buttons: **취소** (default focus) and **켜기** (danger). Esc, a tap outside and Back mean 취소. The pending question is a draft (DD-157 (b)) and also survives a reload (device-only, as DD-099 drafts). Confirm writes the flag as one history step and announces "{이름} 켜짐".
- **Turning off never asks.** Undo of "turn on" turns it off, no question. **Redo, or a history or restore-point step that would turn a flag from off to on, asks the same question first** (design default); taking the stored value from another tab (DD-102 Reload) does not, because it is already stored.
- The question appears **per flag**, **once per turn-on**: turning it off and on again asks again.
- Studio never turns this flag on by itself: Check/Apply, imports and "모듈로 변환" read it but never write it (SLICE1 §6 rule stays).
- The question's title uses the Korean particle that fits the flag's name ("낮은 수준 접근을 켤까요?", "출력 이스케이프를 켤까요?"); English keeps "Turn on {name}?".
- **Floors (DD-182, DD-192).** The registry of the install rule floors every token the section and its questions read (section 12): text >= 11 px, buttons and switches >= 32 px, padding and gaps >= 4 px, alpha >= half the Deep Nexus value, the danger edge >= 2 px and the tint >= 0.05.
- Pack rules: the section, its warning line, its switches and the question sheet have part names (section 12); packs may recolour them with tokens but cannot hide, reorder or restyle the structure (DD-149, DD-155).

## 7. Images and assets (simulated)

Everything here is synthetic: **no real file, file picker, storage or network is touched.** Placeholder images are CSS tiles (a gradient from the shared accent channel at six alpha steps plus a number and a name like "샘플 3"), never real pictures and never literal colours (tokens `--form-thumb-tint-1..6`).

### 7.1 The simulated picker

A sheet "샘플 이미지 고르기" (`studio-image-picker`, not critical) standing in for the OS picker: a list of about 8 fixture files with name, type, size ("가상 12 KB") and a checkbox (multi-select where the real picker is multi-select: emotion images and assets; single for the portrait). Fixtures include: a normal PNG, a WebP, a GIF, a very long file name, a duplicate of an existing name, an unsupported type (`.bmp`), a file that "fails to store", and for assets an MP3, an MP4 and a font. Footer: **추가** (n) and **닫기**. Allowed types follow today's pickers: portrait png webp gif jpg jpeg (`characters.ts:154`); emotion png webp gif (`:245`); assets the 15 extensions (`CharConfig.svelte:596`). A rejected file is listed after the add with its reason ("지원하지 않는 형식이에요: .bmp"), the other files are added, and the result is announced once ("3개 추가, 1개 못 가져왔어요"). A store failure marks the row "저장하지 못했어요" with 다시 시도 / 빼기; nothing half-added stays in the list.

**Leaving the item does not cancel an import (DD-191, DD-196):** every import is kept by id with its own timer and rows, so a second one started meanwhile is never lost (N-4). It finishes against the owner by id; out of the owner's Display form it writes the history step and updates the tree only, never redrawing a form the author is typing in (N-3), and in the form it gives the caret back to its field. If Studio itself has closed, the result is an app-wide toast on the host screen with "Studio에서 보기" (DD-196; the mockup draws it outside `#studio`), and a toast reports "{n}개 추가, {m}개 못 가져왔어요" with a button "보기" that opens the item at the right tab; rejected and failed files wait in the list for the author's return. While "adding" (a synthetic 400 ms per file), rows show a text state "가져오는 중" (spinner replaced by static text under reduced motion and low power).

### 7.2 Emotion images

- Row (`studio-emotion-row`): drag handle (a button), thumbnail (64 role token), **감정 이름** field, file type, `⋯` (이름 바꾸기 in place is the field itself; 위로, 아래로, 삭제). Several files are added at once and the rows can be reordered (DD-170); whether the engine uses the order is for Lane A to confirm (open, section 17), so the form does not imply that order matters. Names are derived from the file name **without its real extension** (a `.gif` loses `.gif`; today only `.png`/`.webp` are cut, `characters.ts:258`; requires lane A, section 15).
- Duplicate names get an info note on both rows ("같은 이름이 있어요"); not an error (the engine's tie rule is unverified).
- Deleting a row: durable undo (DD-100), same as slice 1.
- An image that fails to load shows the `image-off` tile with the text "불러오지 못했어요" and keeps its name field usable.
- Empty list: "아직 이미지가 없어요" with the add button, and the line that nothing shows until at least one is added.

### 7.3 Additional assets

- Row (`studio-asset-row`): thumbnail for png/webp/jpeg/jpg/gif/svg/avif; a **type tile** (icon + extension) for mp3, mp4, webm, fonts and css; name field; "{ext} · {size}"; "글에서 쓰는 곳 {n}" (a button that lists the places: field + line, each jumps there, into the field that holds the text and to the place, not to the item's name field); `⋯`.
- **Audio and video are not auto-previewed**; a "미리보기" button on demand shows a play control with no autoplay and no loop (today's audio loops with controls when `db.useAdditionalAssetsPreview` is on, `:633`). **Image thumbnails always show** (DD-178); the existing preview setting (`db.useAdditionalAssetsPreview`) no longer gates them in this form, and audio and video load only on tap. Whether that setting is retired or kept for the player is Lane A's call (not decided).
- **Rename** is the name field. When the old name is used in text (`{{image::old}}` and the other forms, section 5.3), an inline note "글에서 {n}곳이 예전 이름을 써요" with "보기" appears; the note lists the fields that use the old name, each with a jump, and text is never rewritten (DD-173).
- Include/exclude from the prompt asset list (`prebuiltAssetExclude`) is `⋯` › "미리보기에서 빼기 / 넣기", shown only when the preview setting is on (today :652-668).
- Delete: durable undo. The open chat's `fmIndex` is reset to -1 by today's code (`CharConfig.svelte:644`); the form says nothing about it and the question is listed for Lane A (section 16, engine change #29).

## 8. Group form

A group is a Studio owner (DD-164) with the kinds `기본 정보`, `표시와 에셋` and `고급`; the character-only tabs are hidden, as today (`CharConfig.svelte:170`). The member vocabulary is chat slice 3's (DD-053..064): "말 수 n/6", "쉬는 중 / 참여", "말 수에 따라 / 순서대로", "그룹에서 빼기", "멤버 추가". The chat sheet's member panel and this form show **the same store data**; both write through the same owner setters.

### 8.1 기본 정보 (group)

Order: 이름, 멤버, 말하는 순서, 작가 노트.

- **이름** (`name`): single line; an emptied name reverts on blur (chat slice 3 §6).
- **멤버** (`studio-member-list`), members first after the name. Row (`studio-member-row`): drag handle (button; **Alt+↑/↓ while it has focus**), avatar + name, one line "말 수 5/6" (hidden in order mode), the **말 수** control (six segments as a `radiogroup` with the name "{name}: 말 수", each segment labelled "{n}/6"; today's six bars are unnamed), a switch with visible text **참여 / 쉬는 중** named "{name}: 참여", and `⋯` (캐릭터 열기 = open that member as a Studio owner, 위로, 아래로, 그룹에서 빼기). A sitting-out member carries the tag "쉬는 중" inline after the name.
- A **missing member** (deleted character) shows "삭제됨" with the action "빼기" (DD-058); it is skipped in counts (the tag reads "{말하는}/{살아 있는}명"; with nobody able to speak the form says "말할 수 있는 멤버가 없어요").
- **멤버 추가** opens the chat slice 3 member picker (names + avatars + search, §7.1 there). "첫 메시지도 넣기" appears in the picker footer **only when there is a context chat for this group** (it pushes the member's first message into that chat, `process/group.ts:20-52`). An already-added member is disabled in the picker with the reason "이미 그룹에 있어요" (today an error alert).
- **Remove** gives the undo toast (DD-100/DD-065 pattern); the group can go down to **one live member** (a deleted character's row can always be removed); removing the last live member is refused with the visible line "그룹에는 멤버가 한 명 이상 있어야 해요" under the item (chat slice 3 §6). An empty group (as created today) shows "아직 멤버가 없어요" and the add button.
- The three parallel arrays (`characters`, `characterTalks`, `characterActive`) are one `members[]` record in the form's model; the owner setter writes all three together so the load-time reset (`characters.ts:724-737`) never triggers (requires lane A, section 15).
- **말하는 순서** (`orderByOrder`): segmented "말 수에 따라 / 순서대로" with the help line from chat slice 3. Unlike today it is available on every width.
- **작가 노트** (group's chat note): LT cbs with chip, as the character's (section 3), shown with the same "이 채팅" tag and the same no-context-chat line.

### 8.2 표시와 에셋 (group)

Two blocks, no emotion images or assets (today's group display exposes only the icon and the mode, `CharConfig.svelte:359-363, :479-486`):
- **그룹 사진:** current picture tile; actions **멤버 사진으로 만들기** (today's composite, `makeGroupImage`) and **사진 고르기** (simulated picker, single). The note "멤버 사진으로 만들어져요 · 나중에 바꿀 수 있어요" as in chat slice 3.
- **화면 방식** select: 없음 / 한 캐릭터 / 여러 캐릭터 / 두 캐릭터 강조 (`viewScreen`).
- `채팅에서 사진 숨기기` is available to groups in the data model (`database.svelte.ts:1599`) but today's group form does not show it; omitted here (DD-169 moved the character's switch to Display › 사진 and says nothing about groups; adding it for groups would be a new decision).

### 8.3 고급 (group)

Only what today's group branch shows (`CharConfig.svelte:1275-1285`): the chat-scoped 슈퍼메모리 text when it has content, and the risky section with **낮은 수준 접근** only (utility bot and escape output are character-only in the data model). The same confirm applies.

## 9. Layout

All widths use SLICE1 §2 (tree / editor / side panel; drawer; list-to-detail). Inside the editor area:

| Width | Behaviour |
|---|---|
| 1280 (editor column ≈ 640 px with the side panel open, ≈ 1000 closed) | One column, max reading width `--form-max-width` (role token, ≈ 720 px), centred in the editor. Group headers are sticky below the item head while their body scrolls. Display segments sit in a row; portrait tiles wrap; emotion/asset rows are one line (thumb, name, type, actions). Group members: one row per member, talk segments inline. |
| 768 | Same column; the side panel is the bottom sheet (SLICE1 §2). |
| 412 and 360 | Full-screen item, one column, edge padding from the sheet-padding role token. Row lists become **cards**: emotion/asset rows stack thumb + name on the first line and type/actions on the second; the add-a-field row and `⋯` buttons are 44 dp; member rows show the talk control on its own line under the name; bias rows are two stacked fields. The Display segmented control scrolls horizontally only if the labels do not fit (they should fit at 360 in KO and EN, checked). Nothing scrolls horizontally on the page. |

Long KO or EN labels wrap; no label is truncated without a tooltip-free full text elsewhere (the field's help or the accessible name carries it).

## 10. Keyboard, focus, accessibility

- Tab order is DOM order (visual reordering by packs keeps DOM order, THEMING rule 5): header → form sections in order. A group header and the `필드 추가` row are buttons (Enter/Space). F6 cycles panes as slice 1.
- Opening an item focuses its first field (SLICE1 §9). From the add-a-field list, choosing a field focuses its control; Esc closes the list and returns focus to the row button. After removing a row (emotion, asset, member, bias, alternate) focus goes to the next row, else the previous, else the add button, never the page.
- **Display segments:** `tablist` / `tab` / `tabpanel`; Left/Right move, Home/End jump, activation follows focus (cheap panels).
- **Rows with handles** (emotion, asset, member, alternates): the handle is a real button; **Alt+↑/↓ only while the handle or `⋯` has focus** (slice 3 rule; inside a text field the keys keep their meaning); each move is announced ("{이름}이 {n}번째가 됐어요").
- **Talk control:** `radiogroup`, arrows move the value, name "{name}: 말 수", value text "6단계 중 {n}". Mute switch: `role="switch"`, text visible.
- **Risky question:** `alertdialog`, focus trap, default focus 취소, Esc cancels, focus returns to the switch (which is still off). The switch has `aria-describedby` to its explanation line and the section warning.
- **Picker sheet:** `dialog`, focus on the list; rows are checkboxes; footer buttons reachable; Esc closes with nothing added.
- Announcements through the shell's live region: add/reject results, move, mode-switch fill ("기본 문구 3개를 채웠어요"), fold changes ("고급 · 프롬프트: 빈 칸 2개 접힘"), changed-elsewhere per field.
- Every icon-only button has an accessible name; thumbnails have `alt` = the file or emotion name, placeholders and decorative tiles `alt=""` with the name in text next to them. Error or info text never relies on colour alone (icon + text).
- Forced colours: tiles keep an outline, the risky header keeps its icon and border, segment selection uses a system colour plus a check mark.

## 11. Motion, reduced motion, low power

- Only `transform` and `opacity` transition, with the shared motion tokens (SLICE1 §9). The disclosure of a group or the add-a-field list does **not** animate height: it appears instantly; the list and the question sheet fade/slide with the sheet tokens.
- **Reduced motion / low power:** fades ≤ 120 ms or instant; no drag-ghost animation (the drop is an instant move); import progress is the text "가져오는 중"; thumbnails decode lazily (visible ones first) and a gif tile shows its first frame with "재생" on demand under low power; no shimmer.
- Reduced-motion pass is a check (section 14); the question sheet has no motion-dependent meaning.

## 12. Theme compliance (THEMING.md, DD-142..161)

How the **new** surfaces comply:

1. **Tokens only (rule 1, DD-143).** New stylesheet `studio/st4.css` uses only named custom properties for colour, font, radius, spacing, shadow, motion and geometry; literals are 0, `1px` hairlines and layout percentages. Colours derive from shared channel tokens: tints as `rgb(var(--nexus-accent-rgb) / <alpha>)`, danger as `rgb(var(--nexus-danger-rgb) / <alpha>)` (DD-146, DD-158). Slice-4-only values get the `--form-` prefix (DD-145: one meaning per name; shared names are never redefined here).
2. **Role tokens (DD-148) for the pack contract:** `--form-field-gap`, `--form-group-gap`, `--form-section-padding`, `--form-max-width`, `--form-label-size`, `--form-row-height` (list rows, 44 dp touch), `--form-thumb-size` (emotion/asset thumb), `--form-portrait-size`, `--form-portrait-alt-size`, `--form-member-avatar-size`, `--form-talk-segment-width`, `--form-talk-segment-height`, `--form-fold-row-height`, `--form-risky-edge-width`, `--form-risky-tint-alpha`, `--form-thumb-tint-1..6` (the mockup's synthetic image stand-ins; a pack may recolour them; a real build removes them). Touch targets and text size are pack-settable (DD-151); Deep Nexus keeps 44/48 dp.
3. **Part names (rule 2).** Stable, role-based:

| Part | Role |
|---|---|
| `studio-form` | the form column of any kind |
| `studio-form-section`, `studio-form-section-header`, `studio-form-section-body` | a section / Advanced group / Display segment panel |
| `studio-field`, `studio-field-label`, `studio-field-help`, `studio-field-control`, `studio-field-note`, `studio-field-chip` | one field and its innards (the LT editor and token chip keep slice 3's parts) |
| `studio-addfield`, `studio-addfield-list`, `studio-addfield-item` | the folded-field row, its list and an entry |
| `studio-segments`, `studio-segment` | the Display switch |
| `studio-portrait-main`, `studio-portrait-alt`, `studio-thumb`, `studio-thumb-placeholder` | portrait tiles and image stand-ins |
| `studio-emotion-row`, `studio-emotion-name`, `studio-asset-row`, `studio-asset-name`, `studio-row-handle`, `studio-row-menu` | image/asset rows |
| `studio-image-picker`, `studio-image-picker-item` | the simulated picker sheet |
| `studio-bias-row` | a token-bias row |
| `studio-member-list`, `studio-member-row`, `studio-member-avatar`, `studio-member-talk`, `studio-member-active`, `studio-order-mode` | group members and order |
| `studio-risky` (**critical**), `studio-risky-header`, `studio-risky-warning`, `studio-risky-flag`, `studio-risky-switch`, `studio-risky-explain` | the protected section and its children (own part names, DD-149) |
| `studio-risky-confirm` (**critical**), `studio-risky-confirm-title`, `studio-risky-confirm-body`, `studio-risky-confirm-cancel`, `studio-risky-confirm-ok` | the question sheet |
| `studio-private-notice`, `studio-private-confirm` (**critical**), `studio-private-confirm-title`, `-body`, `-cancel`, `-ok` | the private-licence notice and the question that opens its content (DD-188) |

4. **State as `data-*` (DD-144, DD-153):** `data-filled="true|false"` and `data-folded` on fields; `data-open` on sections and the add-a-field row; `data-kind="basic|display|advanced"`; `data-scope="character|chat|group"` on chat-scoped fields; `data-field="<key>"`; `data-seg="photo|screen|assets"`; `data-image="ok|loading|failed|placeholder"`; `data-default` on text filled with a mode default; `data-member-active="true|false"`, `data-member-missing`; `data-talk="1..6"`; `data-flag="<key>"` with `data-on="true|false"`; `data-peer="changed"` for changed-elsewhere. Layout and input come from the shared `html[data-layout=wide|mid|phone]` and `html[data-input=touch|hover]` (DD-147); the mockup must not introduce a second attribute set.
5. **Critical surfaces (rule 3, DD-149).** `studio-risky` and `studio-risky-confirm` carry `data-part-critical`; the install-time rule applies by ancestry (DD-155), so the section's ancestors (`studio-form`, `studio-form-section`) are also judged against the declaration allowlist. The delete-with-undo toast is not protected (nothing is lost, undo is durable). The question sheet does not drop data but guards a capability and has a danger button, so it is marked on purpose. Slice 1's restore-point confirm, conflict view and leave-with-failed-save prompt do drop or replace data and fall under DD-149's default rule; they are listed below.
6. **Fallbacks (rule 4).** No blur or transparency is required by any slice 4 surface; the picker and the question sheet use opaque role surfaces. Reduced motion is section 11.
7. **Behaviour is fixed (rule 5).** Focus order, keys and roles do not depend on layout; part CSS may reorder visually, DOM order stays.
7a. **Floors (DD-182, DD-192).** `packlint-studio.mjs` passes `minimums` to chat's validator for `--studio-font-md/-base/-lg/-xl` (11 px), `--studio-size-touch` and `--studio-form-row-height` (32 px), `--studio-space-1..4`, `--studio-form-section-padding`, `--studio-form-field-gap`, `--studio-form-group-gap` (4 px), `--studio-alpha-5` (0.25), `--studio-form-risky-edge-width` (2 px) and `--studio-form-risky-tint-alpha` (0.05). Install-time enforcement in the app is Lane A's (ENGINE_CHANGES #23). Compact targets (32 px) apply only where every pointer is fine (`(any-pointer: fine) and (not (any-pointer: coarse))`). Rev 1.3 adds floors for `--studio-font-xs`/`-sm`/`--studio-form-label-size` (11 px), `--studio-leading-body` and `-tight` (1.2), `--studio-size-hairline` (1 px), `--studio-weight-strong` (500), `--studio-weight-medium` (400) and `--studio-radius-3` (4 px) (re-review N-2, m-9). Rev 1.4 (DD-197, re-check R-2) adds floors for layout sizes a pack may shrink but not collapse: `--studio-form-max-width` (140 px), `--studio-form-fold-row-height`, `--studio-form-talk-segment-width` and `-height` (16 px), `--studio-form-thumb-size` (20 px), `--studio-form-portrait-size` (48 px), `--studio-form-portrait-alt-size` (28 px), `--studio-form-member-avatar-size` (12 px), `--studio-form-depth-width` (28 px) and `--studio-alpha-disabled` (0.3). The page check puts a pack at every floor on six forms at 360 px (no sideways scroll at 360 px; the floors are deliberately loose, the user's choice for DD-197, so compact packs stay possible, DD-151).
7b. **Ceilings and colours (DD-195, rev 1.3).** The registry also passes `maximums`: fonts 24 px (`--studio-font-xl` 28 px), `--studio-size-touch` and `--studio-form-row-height` 72 px, `--studio-space-1..4` 24 px (`-5..7` 32 px, `-8` 40 px), `--studio-form-section-padding` and `--studio-form-field-gap` 32 px, `--studio-form-group-gap` 40 px, `--studio-form-risky-edge-width` 12 px, `--studio-form-risky-tint-alpha` 0.3, leading 2.2, hairline 4 px, weight 900, radii 32 px. The shared lint judges floors and ceilings in the worst case over every declaration (root attributes and `@media` included) and every `var()` chain, and accepts only px, rem, ms, s and plain numbers on limited tokens (vw, vh, %, em and ch fail closed; re-review N-1). Studio adds one colour pass (`riskyColourPass` in `packlint-studio.mjs`): the risky section's tint is `--nexus-danger-rgb` at `--studio-form-risky-tint-alpha` over the canvas, and its heading (`--nexus-danger`), warning (`--nexus-text`) and explanations (`--nexus-text-secondary`) keep 4.5:1 on that tinted surface at the largest tint the pack sets; `--nexus-danger-rgb` must be the colour of `--nexus-danger`, and the danger colour may not be the text colour (a colour cue must stay a cue). The page check puts a pack at every ceiling and at every floor and measures the risky question and section (Cancel and OK stay on a 412 x 800 screen; text 11 px or more with its line room).
8. **Acceptance probes.** Origin Navy (tokens only) and Banana Cocoa (chat only, not applicable) are run for Studio by the later theme audit; slice 4 ships a token-only override probe (`?theme=origin-navy`) in the check plan to prove the forms recolour without edits, and records any missing token (section 14, `theme` shard).

**What the older Studio surfaces would need** (slices 1-3; **not changed here**, DD-154/N2 sends Studio's token work to when it next touches its tokens). Measured by a regex count over `studio/*.css|js|html` on 2026-10-28 (approximate: counts include 1 px hairlines and unused rules, and no browser was run): `data-part` occurs **0 times** in `slice1.html/.js/.css`, `lte*.{js,css}`, `tgb*.{js,css}`; `slice1.css` has about 33 hex colour literals, about 675 `px` literals and 4 `ms` literals; `lte.css` about 16 / 268 / 0; `tgb.css` about 4 / 284 / 0. So they would need: (a) part names for the shell (header, status chip, tree and rows, side panel and tabs, toasts, sheets, test panel), the LT editor (field, chip, popup, focus mode, find bar, cards) and the toggle builder (rows, editor, text view); (b) geometry tokens for the literal sizes, offsets and touch targets (DD-143) and motion tokens for the remaining `ms` values; (c) channel tokens in place of the hex tints (DD-146), and the shared-name check from DD-145 (whether `slice1.css`, `lte.css` or `tgb.css` redefine any of the 8 shared names was **not audited**); (d) `html[data-layout]`/`data-input` instead of whatever attribute set they use now (**not checked**); (e) `data-part-critical` on the restore-point confirm, the code conflict view, the leave-with-failed-save prompt, the Apply confirm and the mode-switch restore list (all drop or replace data), with their own child part names; (f) a role-token list for the shell. None of this is needed for slice 4 to work; it is the cost of bringing slices 1-3 up to DD-142..161.

## 13. Copy (proposed keys, ko / en)

KO first. Terms follow chat slice 3 and Studio slice 3 (say "첫 메시지", never "인사말"). KO strings are proposals; the app's own locale file was not edited.

| Key | KO | EN |
|---|---|---|
| fKindBasic / fKindDisplay / fKindAdvanced | 기본 정보 / 표시와 에셋 / 고급 | Basics / Display and assets / Advanced |
| fAddField | 필드 추가 ({n}) | Add a field ({n}) |
| fGroupEmpty | 비어 있어요 · 필드 추가 ({n}) | Empty · Add a field ({n}) |
| fGroupPrompt / fGroupConv / fGroupInfo / fGroupVars / fGroupGen / fGroupMemory / fGroupModule | 프롬프트 / 대화 / 작품 정보 / 변수와 번역 / 생성 조정 / 기억 / 모듈 | Prompt / Conversation / About the work / Variables and translation / Generation / Memory / Module |
| fNotRecommended | 권장하지 않음 | Not recommended |
| fToggleLink | 토글 정의 · {n}개 | Toggle definitions · {n} |
| fChatScope | 이 채팅 | This chat |
| fNoteNoChat | 작가 노트는 채팅마다 따로예요. 채팅을 열면 여기서 고칠 수 있어요 | The author note belongs to each chat. Open a chat to edit it here |
| fNameEmpty | 이름은 비울 수 없어요 | The name can't be empty |
| fPrivate | 이 캐릭터는 편집할 수 없어요 | This character can't be edited |
| fFieldGone | 그 칸은 없어요 · {kind} 맨 위로 열었어요 | That field doesn't exist · opened {kind} at the top |
| fSegPhoto / fSegScreen / fSegAssets | 사진 / 화면 / 에셋 | Portrait / Screen / Assets |
| fMainPortrait / fMakeMain | 대표 사진 / 대표로 쓰기 | Main portrait / Make main |
| fAddPhoto / fAddPhotoNote | 사진 추가 / 새 사진이 대표가 되고, 이전 대표는 다른 사진으로 남아요 | Add a photo / The new photo becomes the main one; the previous main stays as another photo |
| fTallPhoto / fHidePhoto | 세로 사진 / 채팅에서 사진 숨기기 | Tall portrait / Hide the picture in chat |
| fPromoted | 대표 사진을 지웠어요 · 다음 사진이 대표가 됐어요 | Removed the main portrait · the next photo is now main |
| fScreenMode / fScreenNone / fScreenEmotion / fScreenImgGen | 화면 방식 / 없음 / 감정 이미지 / 이미지 생성 | Screen mode / None / Emotion images / Image generation |
| fScreenFilled / fDefaultTag / fDefaultReset | 이 방식에 맞는 기본 문구로 채웠어요 · 직접 쓴 문구는 그대로예요 / 기본값 / 기본값으로 되돌리기 | Filled in this mode's default wording · your own wording is kept / Default / Reset to default |
| fAuxModel | 채팅 분석에 보조 모델을 써요 | Chat analysis uses an auxiliary model |
| fInlay | 채팅 화면에 넣기 | Show inside the chat |
| fEmotionInstr / fImgPrompt / fImgNeg / fImgInstr | 감정 지시사항 / 프롬프트 / 부정 프롬프트 / 지시사항 | Emotion instructions / Prompt / Negative prompt / Instructions |
| fEmotionName / fEmotionDup / fNoImages | 감정 이름 / 같은 이름이 있어요 / 아직 이미지가 없어요 | Emotion name / Another image has this name / No images yet |
| s4ImportOpenApp / s4BiasZeroed / s4ToastGone | Studio에서 보기 / 비워서 0으로 했어요 / 이미 되돌렸어요 | View in Studio / Left empty, so it is 0 / Already undone |
| fAssetUses / fAssetRenamed | 글에서 쓰는 곳 {n} / 글에서 {n}곳이 예전 이름을 써요 | Used in {n} places / {n} places in the text still use the old name |
| fAssetHelp | 글에서 {{image::이름}}처럼 이름으로 불러요 | Call it by name in text, like {{image::name}} |
| fPreviewOn / fPreviewOff / fPlay | 미리보기에 넣기 / 미리보기에서 빼기 / 재생 | Include in preview / Leave out of preview / Play |
| fPickTitle / fPickAdd / fPickClose | 샘플 이미지 고르기 / 추가 / 닫기 | Pick sample images / Add / Close |
| fPickResult / fPickBadType / fStoreFail / fRetry / fDropRow | {n}개 추가, {m}개 못 가져왔어요 / 지원하지 않는 형식이에요: {ext} / 저장하지 못했어요 / 다시 시도 / 빼기 | Added {n}, {m} couldn't be imported / Unsupported type: {ext} / Couldn't store it / Try again / Remove |
| fImporting / fLoadFail | 가져오는 중 / 불러오지 못했어요 | Importing / Couldn't load it |
| fPngNote | 사진에 들어 있던 설명 글 {n}개를 가져왔어요 | Imported {n} text notes that were inside the picture |
| fBiasValue / fBiasDup / fBiasClamp | 값 (-100~100) / 같은 토큰이 있어요 / 범위 안으로 맞췄어요 | Value (-100 to 100) / This token is already listed / Adjusted to the range |
| fModuleApply / fModuleApplyNote / fModuleConvert / fModuleMade | 모듈 적용 / 모듈의 내용을 이 캐릭터로 복사해요 · 모듈과 이어지지는 않아요 / 모듈로 변환 / 모듈을 만들었어요 | Apply a module / Copies the module's content into this character · it is not linked / Convert to module / Made a module |
| fRiskyTitle / fRiskyWarn | 위험한 설정 / 이 설정은 캐릭터가 할 수 있는 일을 바꿔요. 꼭 필요할 때만 켜세요 | Risky settings / These settings change what the character can do. Turn them on only when you need to |
| fFlagLow / fFlagUtility / fFlagEscape | 낮은 수준 접근 / 유틸리티 봇 / 출력 이스케이프 | Low-level access / Utility bot / Escape output |
| fFlagLowExplain | 높은 컴퓨팅 파워가 필요한 기능과, 트리거를 통한 AI 모델 실행을 허용해요. 꼭 필요할 때만 켜세요 | Allows features that need high computing power and running the AI model through triggers. Turn on only if you need it |
| fFlagUtilityExplain | 메인 프롬프트, jailbreak 등 다른 프롬프트를 무시해요. 역할극이 아닌 유틸리티용이에요 | Ignores the main prompt, jailbreak and other prompts. For utility bots, not role play |
| fFlagEscapeExplain | 답장을 표시하는 방식이 바뀌어요. 정확한 효과는 아직 확인 중이에요 | Changes how replies are shown. The exact effect is still being confirmed |
| s4MockupNote | 목업 문구 · 확인 뒤 교체 | Mockup text · replace once confirmed |
| s4PrivateShow / s4PrivateHide / s4PrivateAskTitle | 내용 보기 / 다시 숨기기 / 내용을 볼까요? | Show content / Hide again / Show the content? |
| s4PrivateHidden / s4PrivateShown | 내용은 기본으로 숨겨져 있어요. 내보내기는 계속 막혀 있어요. / 내용을 보는 중이에요 · 읽기 전용 · 스튜디오를 닫으면 다시 숨겨져요 | The content is hidden by default. Export stays blocked. / Showing the content · read only · it hides again when Studio closes |
| s4NoSpeakers / s4ToggleAdd / s4FillHidden | 말할 수 있는 멤버가 없어요 / 토글 정의 추가 / 감정 지시사항은 채팅 화면에 넣기를 켜면 보여요 | No member can speak / Add a toggle definition / The emotion instructions show once "Show inside the chat" is on |
| fRiskyAsk / fRiskyAskLow / fRiskyCancel / fRiskyOn / fRiskyAnnounce | {이름}을(를) 켤까요? / 이 캐릭터가 AI 모델과 저장소에 직접 접근할 수 있게 돼요 / 취소 / 켜기 / {이름} 켜짐 | Turn on {name}? / This character will be able to reach the AI model and your storage directly / Cancel / Turn on / {name} on |
| fMembers / fMemberTalk / fMemberOn / fMemberOff | 멤버 / 말 수 {n}/6 / 참여 / 쉬는 중 | Members / Talkativeness {n}/6 / Taking part / Sitting out |
| fMemberOpen / fMemberRemove / fMemberMissing | 캐릭터 열기 / 그룹에서 빼기 / 삭제됨 | Open character / Remove from group / Deleted |
| fMemberAlready / fMemberAddFirst | 이미 그룹에 있어요 / 첫 메시지도 넣기 | Already in the group / Also add the first message |
| fLastMember / fNoMembers | 그룹에는 멤버가 한 명 이상 있어야 해요 / 아직 멤버가 없어요 | A group needs at least one member / No members yet |
| fOrderLabel / fOrderRandom / fOrderList / fOrderHelp | 말하는 순서 / 말 수에 따라 / 순서대로 / 메시지에서 이름을 부르면 그 멤버가 먼저 말해요 | Speaking order / By talkativeness / In order / Name a member in a message and they speak first |
| fGroupPic / fGroupPicMake / fGroupPicPick / fGroupView | 그룹 사진 / 멤버 사진으로 만들기 / 사진 고르기 / 화면 방식 | Group picture / Make from member pictures / Choose a picture / Screen mode |
| fViewSingle / fViewMulti / fViewEmp | 한 캐릭터 / 여러 캐릭터 / 두 캐릭터 강조 | One character / Several characters / Two characters, highlighted |

## 14. Check plan: new `st4` suite

Pattern: copy of `studio/checks/run-st3.mjs` in shape, as `studio/checks/run-st4.mjs`, with sections in `studio/checks/st4/<section>.mjs` and a `lib.mjs` of shared helpers; Chrome via `chat/checks/cdp.mjs` (imported, not edited); page `/studio/slice4.html?state=f-…`; **at most 3 workers**, one browser per worker for the whole run, independent shards, no fixed sleeps (`ctx.idle()` waits for the app's short timers and two frames), pinned reduced-motion/forced-colour emulation on every open, a console-error collector (`Z-console`), results written as `results-st4-<tag>[-N].json` and `.timing.json`. Test hook `window.__st4` (store, drafts, folded set, last announcement). Results and logs stay under `studio/checks/`.

**Target:** about 90 s wall time at 3 workers, i.e. about 280 worker-seconds in total. These weights are estimates taken from how slice 3's shards behave; **no st4 run exists yet**, so the target is unmeasured and the first run must record `.timing.json` and rebalance.

| Shard(s) | Count | Worker-s each | What it covers |
|---|---|---|---|
| `states-<w>-<lang>` (w = 360, 412, 768, 1280; lang = ko, en) | 8 | 10 | every state in section 15 at that width/language: no console errors, no horizontal page scroll, reading order, no clipped text, focus visible |
| `unit` | 1 | 4 | folded-set rule (empty, whitespace, `' '`, depth text, lists), field catalogue vs inventory (every key reachable), derived values recomputed after a store write |
| `store` | 1 | 8 | DD-157: form holds only an id; replace the store record and the form follows; drafts live apart (risky pending, add-a-field, LT window) and are removed on commit; changed-elsewhere per field |
| `basic` | 1 | 10 | name revert, LT fields, author note with and without a context chat, alternate first messages placement, private-license read-only |
| `display-1280`, `display-360` | 2 | 12, 10 | segments, portrait swap/promote/delete + undo, tall switch, screen mode fill notice and reset, inlay, image-generation fields |
| `emotion` | 1 | 12 | picker, multi-add, rejects, store failure, duplicates, reorder, delete + undo, load failure tile |
| `assets` | 1 | 10 | rows, previews on demand, rename note and "used in", exclude, delete + undo |
| `advanced` | 1 | 12 | every group, fold/unfold, stay-while-in-use, add a field + focus, personality/scenario tag, creator's comment tabs, bias clamp, toggle link row, actions |
| `search` | 1 | 8 | field catalogue hits (empty and filled), `field=` deep link, unknown key notice, 초성 |
| `risky` | 1 | 10 | confirm per flag, switch stays off until confirm, cancel/Esc/outside, focus return, undo no ask, redo/restore asks, reload keeps the pending question, `data-part-critical` present |
| `group-1280`, `group-360` | 2 | 12, 10 | members, talk radiogroup, mute switch, reorder by Alt+arrows and menu, add picker, remove + undo, last-member refusal, missing member, order mode, group author note, group risky |
| `keyboard-1280`, `keyboard-412` | 2 | 12, 10 | Tab order, group headers, add-a-field list keys, tablist keys, handles, announcements, F6 |
| `motion` | 1 | 6 | reduced motion: no transitions beyond 120 ms, picker/question sheet still usable, low power text states |
| `a11y` | 1 | 8 | names, roles, `aria-expanded/controls`, alert dialog, live announcements, forced colours (emulated), target sizes ≥ 44 on touch |
| `review2` | 1 | 17 | the re-review's regressions and DD-194..196: the shell-level private guard over every item kind, import by id and the quiet finish, the app-wide toast, the jump into the right field, the page at every ceiling and floor |
| `review` | 1 | 16 | the review's regressions and DD-185..193: toast Undo after a history Undo in every list that has a delete toast, the `[data-open]` collision, search tags, private content, header Undo owner, "used in" scope, import away |
| `theme` | 1 | 8 | **floors (every minimum, a hostile pack for each) and tokens/parts audit of `st4.css` and the slice 4 markup**: no colour/size/duration literal outside 0 and `1px`; every part in section 12 present; critical parts marked; `data-*` set; `?theme=origin-navy` token-only override recolours the forms with no markup edit and lists any token that was missing |
| `layout-<w>` (360, 412, 768, 1280) | 4 | 5 | box checks per form (no overlap, rows fit, long KO/EN names wrap) |
| `stills-0..2` | 3 | 6 | screenshots at the four widths for the form pages (observed, not a visual review) |
| `perf` (quiet lane, runs after) | 1 | n/a | 200 emotion rows, 300 assets, 40 members: render and a keystroke stay under budget at 4x CPU throttle (proxy, no real device); excluded from the 90 s target |

Ids are `ST4-<shard>-<n>`. What the suite cannot prove: native picker, real storage, real image decoding, other browsers, screen readers, a real device. Those stay listed as missing checks in the build's handoff.

## 15. States the mockup shows (`?state=f-…`)

Synthetic data: character "세라핀" (every field filled, 4 emotion images, 6 assets, 2 alternate portraits, a context chat "등불의 숲" with a note), character "하루" (almost empty: tests folding), character "봉인된 기록" (private license), group "등불 일행" (3 members, one muted, one missing character), the same group with one member, and an empty group.

`f-basic`, `f-basic-alternates`, `f-basic-alternates-empty`, `f-basic-nochat`, `f-basic-private`, `f-basic-nameempty`; `f-adv-filled`, `f-adv-empty` (all folded), `f-adv-addfield-open`, `f-adv-added-empty` (stays while in use), `f-adv-search-empty-hit`, `f-adv-bias`, `f-adv-toggle-link`, `f-adv-memory`, `f-adv-actions`; `f-risky`, `f-risky-ask-low`, `f-risky-ask-utility`, `f-risky-pending-reload`, `f-risky-on`; `f-disp-photo`, `f-disp-photo-empty`, `f-disp-photo-promote`, `f-disp-screen-none`, `f-disp-screen-emotion`, `f-disp-screen-imggen`, `f-disp-mode-filled`, `f-disp-emotion-dup`, `f-disp-emotion-fail`, `f-disp-assets`, `f-disp-assets-rename`, `f-disp-assets-beta`; `f-picker`, `f-picker-result`, `f-picker-storefail`, `f-picker-importing`; `f-peer-field`; `f-group-basic`, `f-group-orderlist`, `f-group-missing`, `f-group-lastmember`, `f-group-empty`, `f-group-add`, `f-group-nochat`, `f-group-display`, `f-group-adv`. Widths 360x740, 412x915, 768x1024, 1280x800; KO and EN; keyboard only; reduced motion; low power; forced colours.

## 16. Integration map (lane A; nothing here edits these files)

Rev 1.3 shell additions (all additive, in `slice1.js`): the private-licence guard asks `ST.ext.ownerHidden(oid)` and `ST.ext.ownerLocked(oid)` (item names read as the kind name, no add, move, delete or switch on a locked owner, search and combined views skip a hidden one, any item of a hidden owner opens the notice through `ST.ext.renderForm`), `ST.ext.lockHost(host, card, item, owner)` makes the shell's own forms of a revealed owner read only, `ST.appToast(msg, opts)` is the host app's toast for results after Studio closed, and `edit()` refuses a locked owner as a backstop.

| Design piece | Today | Change |
|---|---|---|
| Basic, Display, Advanced forms (character) | `lib/SideBars/CharConfig.svelte:244-676, :1054-1283` | New Studio forms (section 3-7) read by id from the store; `CharConfig` rows become deep links into Studio. |
| Group form | `CharConfig.svelte:254-328, :359-363, :459-487, :1275-1285` | Section 8; share the setters with the chat sheet's member panel (chat slice 3). |
| Field catalogue (key, label, group, kind, hasValue) | none | New UI-side registry used by the forms, the fold rule and Studio search; one source (DD-163). |
| LT | `UI/GUI/TextAreaInput.svelte` | Slice 3 component for every long field; `MultiLangInput.svelte` becomes language tabs over an LT plain field. |
| Member operations | `process/group.ts:10-66`, `characters.ts:724-737` | One atomic `members` setter that keeps `characters`, `characterTalks`, `characterActive` aligned. |
| Images | `characters.ts:152-290`, `CharConfig.svelte:596-608` | Picker returns per-file results; emotion names strip the real extension; delete keeps the stored file until undo ends. |
| Mode switch fill | `process/inlayScreen.ts:81-113` | Return which fields were filled so the form can tag them "기본값". |
| Risky confirm | none (import asks, `characterCards.ts:875`) | UI-only sheet; store write on confirm; same text source as `lowLevelAccessConfirm`. |
| Module actions | `process/modules.ts:839`, `interchangeability.ts:56` | Keep; `convertCharacterToModule` result gets a link to the new module owner. |
| Tree counts, search index, `field=` deep link | slice 1 | Section 1, 4.1. |
| Styles and parts | none for Studio | `st4.css`, parts and tokens of section 12; shared names only from `theme/nexus-tokens.css`. |
| `src/lang/*.ts` | n/a | Keys in section 13. |

**Engine changes slice 4 needs** (format of `ENGINE_CHANGES.md`; not written into that file; numbers continue its list of 24 and are proposals):

| # | Engine change | Screen or element | Data, and whether stored data or the save format changes | Size | Ref |
|---|---|---|---|---|---|
| 25 | Owner setters for character and group fields with change events and a history hook (`setField(ownerId, path, value)`), including chat-scoped fields (author note, memory text) as edits to the chat owner. | All slice 4 forms | Runtime; no format change | M | DD-157, #24, #17-18; this spec §1 |
| 26 | One atomic member operation (add, remove, reorder, mute, talk) keeping `characters`, `characterTalks`, `characterActive` aligned. | Group form | None; avoids the load-time reset of those arrays (`characters.ts:724-737`) | S | this spec §8.1; chat SLICE3 §6 |
| 27 | Image add returns a per-file result (stored, wrong type, store failure) instead of all-or-nothing under one busy flag. Emotion names are built without the real extension (today only `.png`/`.webp`, `characters.ts:258`). Optionally expose the PNG text chunks copied on pick. | Portrait, emotion images, assets | Runtime; emotion names of new gif imports change | S | this spec §5.1, §7 |
| 28 | Deleting an emotion image or asset keeps the stored file until the durable undo ends (DD-100); whether orphaned files are cleaned up later was not traced. | Emotion/asset delete + undo | Possibly a deferred file cleanup | S-M | this spec §7.2-7.3 |
| 29 | `updateInlayScreen` reports which fields it filled with defaults; clarify why deleting an asset or alternate first message sets `fmIndex = -1` (`CharConfig.svelte:644, :1191`) and whether that is still needed. | Display › 화면, assets | Runtime | S | this spec §5.2, §7.3 |
| 30 | A single field catalogue (key, label, group, kind, hasValue test) shared by the forms and Studio search. | Advanced fold, search | None | S | DD-163; this spec §4 |

## 17. Product questions: decided, and what stays open

Rev 1 asked 13 product questions. The maintainer answered every one with the recommended option (a); each is recorded in [DECISIONS.md](../DECISIONS.md) as DD-166..178 with the exact question and answer. The spec is updated to match; the section that carries each answer is given.

| Q | Question | Decision | Answer | Where in this spec |
|---|---|---|---|---|
| Q4-1 | Advanced group names | DD-166 | Seven groups: 프롬프트, 대화, 작품 정보, 변수와 번역, 생성 조정, 기억, 모듈, then the protected section | §4.2 |
| Q4-2 | Where alternate first messages live | DD-167 | Move to Basic, under the first message, as slice 3's card list | §3; removed from the §4.2 inventory |
| Q4-3 | Token chips | DD-168 | A chip on every long-text field that reaches the prompt (which fields are always sent stays unverified) | §2 |
| Q4-4 | Emotion images, adding and ordering | DD-170 | Add several, named from file names, reorderable | §7.2 |
| Q4-5 | Adding a portrait | DD-171 | New photo becomes main; the old main moves to the alternates | §5.1 |
| Q4-6 | Risky flags and `hideChatIcon` | DD-169 | Low-level access, utility bot, escape output are protected; `hideChatIcon` goes to Display › 사진; the escape-output explanation stays a placeholder until Lane A traces it | §5.1, §6 |
| Q4-7 | Author note in Basic | DD-172 | Only with a context chat, tagged "이 채팅", else a one-line pointer; the memory text follows the same rule | §3, §4.2 |
| Q4-8 | Asset rename | DD-173 | Warn and list the fields that use the old name; nothing rewritten | §7.3 |
| Q4-9 | Cleared Advanced fields | DD-174 | Stay shown for this visit, fold after the author leaves the item | §4.1 |
| Q4-10 | Depth prompt text | DD-175 | Compact LT with the depth beside it | §2, §4.2 |
| Q4-11 | Module actions | DD-176 | Both stay in Advanced › 모듈, worded as copies, not links | §4.2 |
| Q4-12 | Display mode switch fills defaults | DD-177 | Fill and say so: "기본값" tag, reset, one undo step (engine change #29) | §5.2 |
| Q4-13 | Asset previews | DD-178 | Image thumbnails always show; audio and video load on tap | §7.3 |

### Decided after the build (DD-179..186, DD-188..196)

| Topic | Decision | Where in this spec |
|---|---|---|
| 바꾸기 on the main portrait | DD-179: same as add | 5.1 |
| Default tag after an edit | DD-180: tag goes, reset stays | 5.2 |
| New member talkativeness | DD-181: 3 | 8.1 |
| Critical token floors | DD-182, DD-192: registry `minimums` (text 11 px, targets 32 px, padding 4 px, alpha half, edge and tint) | 6, 12 |
| Empty 기억 group | DD-183: hidden | 4.2 |
| Sticky group headers | DD-184: wide and mid only | 9 |
| Groups in search | DD-185: listed with characters | 1 (search) |
| Touch reorder | DD-186: the row menu, no touch drag | 10 |
| Private-licence content | DD-188: hidden, shown only after a protected question, read only, hides again | 1 |
| Header Undo and chat fields | DD-189: follows the focused field's owner and names it | 3 |
| "Used in" scan | DD-190: also lorebook, regex, scripts | 7.3 |
| Leaving during an import | DD-191: keeps importing, a toast reports | 7.1 |
| Escape-output question text | DD-193: honest placeholder, marked a mockup note | 6 |
| What the private-licence guard covers | DD-194: every item kind (lorebook, regex, scripts, toggles, background HTML) is hidden, named by its kind, not addable, not searched; the reveal shows all of it read only | 1, 16 |
| Limits on the risky section's tokens | DD-195: ceilings, a line-height floor, the heading's contrast on its tint, relative units rejected | 12 (7b) |
| An import that finishes after Studio closed | DD-196: an app-wide toast with "Studio에서 보기" | 7.1 |

### Still open (facts for Lane A, not product questions)

Each needs a trace in the engine; the spec's behaviour holds either way, and the option shown is what the spec assumes until then.

- **O4-1 What `escapeOutput` does.** It reaches the prompt call as `escape:` (`ts/process/index.svelte.ts:2050`); the effect and any help text are untraced. Until known, its explanation line is a placeholder (§6, §13 `fFlagEscapeExplain`). Options: (a) Lane A traces it and supplies the wording (recommended); (b) the maintainer writes the line; (c) drop the line and show only the name and the warning.
- **O4-2 Does the engine use emotion-image order or duplicate names?** The form allows reorder (DD-170) and only notes duplicates. Options: (a) Lane A confirms; if the engine ignores order, say so in the help line (recommended); (b) if first-match wins, show an order hint and make duplicates a warning; (c) if neither matters, keep as built.
- **O4-3 Why a delete resets the chat's `fmIndex` to -1** (`CharConfig.svelte:644, :1191`). Options: (a) Lane A explains it; keep it only if needed and tell the user in one line (recommended); (b) keep silent as today; (c) drop the reset. Related: engine change #29.
- **O4-4 Are deleted image files cleaned up later?** The durable undo (DD-100) needs the file to stay until the undo ends. Options: (a) Lane A keeps the file until Studio closes (recommended, engine change #28); (b) undo restores the list entry only and a missing file shows the load-failure tile; (c) no undo for images.

## 18. Design defaults to confirm

(Rev 1.2: the private-licence default and the items answered by DD-179..186 are decided, see section 17; the rest below stand.)

These are choices this spec made inside the decided intent and that no DD fixes: Basic field order name, description, first message, alternates, author note; chat-scoped fields shown only with a context chat; private-license characters open read-only; Display as three remembered segments (사진 / 화면 / 에셋); no hidden remove mode, with `⋯` menus and durable undo; duplicate emotion names noted, not blocked; assets never auto-played; the risky question per flag with default focus on Cancel, the switch staying off until confirmed, and redo or a restore step into "on" asking again; groups may go down to one member and members come first; the group order switch exists on every width; `field=` deep links; `필드 추가` rows count the empty fields; the tree shows `고급 · {filled}/{total}`; `personality` and `scenario` are addable with the tag "권장하지 않음".

## 19. Review mapping (rev 1.2)

Source: [../reviews/2026-10-28-studio-slice4-review.md](../reviews/2026-10-28-studio-slice4-review.md) (0 blockers, 7 majors, 12 minors, 5 nits). Checks are in the `review` shard of the `st4` suite (ids `RV-<finding>:...`) unless another section is named. No finding conflicted with a decision.

| Finding | Fix | Check |
|---|---|---|
| **M1** toast Undo after history Undo duplicates the row | one rule for every list: the toast acts only while the delete step is still applied in the owner's history (`S4.undoGuard`), and never inserts an id that is present; the same guard in slice 3's card lists (`lte-lists.js`) | `RV-M1:*` (emotions, assets, members, bias, both portrait kinds, alternate first messages, example messages, the durable path, redo) |
| **M2** pack can shrink the protected text to 1 px | `minimums` floors for every token the risky parts read (section 12, 7a; DD-182, DD-192) | `TH-floor:*`, `TH-floor-hostile:*`, `TH-floor-benign:*` |
| **M3** header Undo reverts the name, not the note | header Undo and Redo follow the focused field's owner and name it (DD-189); new hook `ST.ext.undoOwner` | `RV-DD189:*` |
| **M4** search says "비어 있음" for filled fields and switches | emptiness comes from the catalogue's own test; switches and lists carry a state word ("켜짐/꺼짐", "{n}개") | `RV-M4:*` |
| **M5** private content shown | hidden by default, protected question, read only, hides again (DD-188); search, `field=`, tree counts, Problems and Test panels never reach it | `RV-DD188:*`, `S-f-basic-private*`, `S-f-private-ask`, `S-f-adv-private*` |
| **M6** leaving mid-import drops it | the import finishes; a toast reports with a link back (DD-191) | `EM-rows-keep-importing...`, `EM-toast-reports...` |
| **M7** "쓰지 않아요" scope | the scan also reads lorebook, regex and scripts (DD-190); the help lists what is read | `RV-DD190:*`, `RV-M7:*` |
| **m1** note about a hidden field | note, tag and announcement only for fields on screen; a hidden default is announced as such | `RV-m1:*` |
| **m2** 28 px text buttons on touch | every small text button is 44 x 44 (`.btn-txt`) | `RV-m2:*`, `A1-touch:*` |
| **m3** count includes a deleted character | counts and tag skip it | `RV-m3:*`, `S-f-group-basic-*` |
| **m4** only a deleted member left cannot be removed | the last-member rule counts live members; "말할 수 있는 멤버가 없어요" | `RV-m4:*` |
| **m5** link row creates data | with no definition the row reads "토글 정의 추가" | `RV-m5:*` |
| **m6** link to a field not shown says ok | a notice with the reason, status `field-missing` | `RV-m6:*` |
| **m7** switch name differs from its words | the name is "{이름}: {보이는 말}" | `RV-m7:*` |
| **m8** `aria-describedby` left on the sheet | the shared question helper removes it with the part marks | `RV-m8:*` |
| **m9** placeholder as the consequence | DD-193 wording plus the mockup-note tag | `RV-m9:*`, `S-f-risky-*` |
| **m10** focus lost after history Undo | the form gives focus back to the control that had it | `RV-m10:*` |
| **m11** shell `[data-open]` collision | the shell's handler takes only `[data-open]:not([data-part])` | `RV-m11:*` |
| **m12** compact targets on a touch laptop | compact only where every pointer is fine | `RV-m12:*` |
| **n1** duplicate and range notes overwrite each other | both shown, joined | `RV-n1:*` |
| **n2** emptied bias value | written as 0 with the note | `RV-n2:*` |
| **n3** chevron on an empty group | an empty group is not collapsible; the one with the toggle row is open | `RV-n3:*` |
| **n4** "을(를)" | the Korean particle follows the final syllable | `RV-n4:*` |
| **n5** the tab count changes meaning | no count on 화면 | `RV-n5:*` |
| Review note: pending question stored per tab | `sessionStorage` is per tab, not per device; kept (a draft the page can restore) and recorded in the builder notes | none |

### 19.2 Re-review mapping (rev 1.3)

Source: [../reviews/2026-10-28-studio-slice4-rereview.md](../reviews/2026-10-28-studio-slice4-rereview.md) (0 blockers, 7 majors, 9 minors, 3 nits; M2, M5, M7 and n2 of the first review were only partly fixed). Checks are in the `review2` shard (ids `R2-<finding>:...`) and, for the lint, in `theme` (`TH-ceiling:*`, `TH-reject:*`, `TH-benign:*`). No finding conflicted with a decision.

| Finding | Fix | Check |
|---|---|---|
| **M2 / N-1** floors bypassed by units and by var chains a later rule changes | chat's shared lint now judges floors and ceilings over every declaration and every `var()` source, and fails closed on vw, vh, %, em, ch (chat th 227/227); Studio's three repros are REJECT cases | `TH-reject:N1-*` |
| **N-2** tokens without a floor, a tint without a ceiling | floors for leading, hairline, weight, radius, xs/sm text; `maximums` for font, padding, gap, edge, tint (7b); the danger heading, warning and explanations keep 4.5:1 on the tinted section; `--nexus-danger-rgb` is tied to `--nexus-danger` | `TH-ceiling:*`, `TH-reject:N2-*`, `R2-DD195:*` |
| **m-9** hairline, weight and radius unfloored | floors (7a) | `TH-reject:m9-*` |
| **N-3** an import that finishes redraws the form being typed in | out of the owner's Display form only the step and the tree are written; in it the caret goes back to its field | `R2-N3:*` |
| **N-4** a second import is lost | imports are kept by id (`S4.imports`), each with its own timer and rows | `R2-N4:*` |
| **m-3 / DD-196** no visible result after leaving Studio | `ST.appToast` (shell) shows the result outside `#studio` with "Studio에서 보기", which reopens Studio on the item and segment | `R2-DD196:*` |
| **M5 / N-5 / DD-194** other item kinds of a private character open and can be added | shell-level guard: item names read as the kind name; no `+`, add, move, delete or switch; the combined views skip the owner; search and the Test panel skip it; any item opens the notice; revealed, every control in every kind is read only | `R2-N5:*` |
| **N-6** "다시 숨기기" leaves the text in the Test panel | hiding clears the field target, the last result, the sandbox node and redraws the side panel | `R2-N6:*` |
| **m-4** reload keeps a reveal | `afterReload` clears it and redraws | `R2-m4:*` |
| **m-5** revealed text stays in the hidden DOM | leaving Studio clears the form host, the side panel and the sandbox | `R2-m5:*` |
| **m-8** inert actions in a revealed Advanced form | module and Hypa buttons are disabled when read only | `R2-m8:*` |
| **N-7** content search misses a character's lorebook, regex, scripts | `searchFields` returns `null` for kinds other than basic, advanced and display | `R2-N7:*` |
| **M7 / m-1 / m-2** "used in" misses fields and jumps to the name | the scan also reads default variables, translator note and each creator comment; a hit carries its field and language; the jump lands in that field at the place | `R2-m2:*`, `R2-m1:*` |
| **m-6** a stale toast Undo is silent | it says "이미 되돌렸어요" (visible and announced), in slice 4's lists and slice 3's cards | `R2-m6:*` |
| **m-7** focus on a hidden tab after the import toast | a Display form focuses its selected tab | `R2-DD196:and-focus-*` |
| **n2 / n-1** emptied bias value says "adjusted" | "비워서 0으로 했어요" | `RV-n2:*` |
| **n-2** disabled Undo names the chat | it uses the same "이 채팅" name | `R2-n2:*` |
| **n-3** double announcement of the member switch | a stable name ("이름: 참여"); the state is `aria-checked`, the "쉬는 중" tag sits by the name | `R2-n3:*`, `GR*-mute-switch-*` |

Shell hooks added in rev 1.3 (all additive; section 16): `ST.ext.ownerHidden(oid)`, `ST.ext.ownerLocked(oid)`, `ST.ext.lockHost(host, card, item, owner)`, and `ST.appToast(msg, opts)`. The shell uses them in the tree rows, the header, the item form, search, the Test panel and the combined views.

### 19.3 Re-check mapping (rev 1.4)

Source: [../reviews/2026-10-28-studio-slice4-recheck.md](../reviews/2026-10-28-studio-slice4-recheck.md) (N-2..N-7, DD-194 and DD-196 held; one new major and five small items). Checks are in `review2` (`R2-R*`, `R2-DD197:*`) and `theme` (`TH-floor:*`, `TH-reject:R2-*`).

| Finding | Fix | Check |
|---|---|---|
| **R-1** an unclosed block hides declarations from the lint | the shared lint (chat, th 228/228) rejects any pack with unbalanced braces or parentheses, an unterminated string or comment (`structureErrors`); Studio adds the four repros and three more as rejects | `TH-reject:R1-*`, `TH-reject-reason:R1-*` |
| **R-2 / DD-197** layout sizes have no floor | floors in the registry (7a); packs may shrink them within the floors | `TH-floor:*`, `TH-reject:R2-*`, `R2-DD197:*` |
| **R-3** Ctrl+S on a private character's Lua item throws | `doCheckItem` does nothing for a locked owner | `R2-R3:*` |
| **R-4** a hidden private item's menu offers move and delete | `openItemMenu` returns for a locked owner (the tree row menu already omitted them) | `R2-R4:*` |
| **R-5** the import result is announced twice when Studio is closed | `ST.appToast` no longer announces (its box is `role=status`); the form's own announcement is skipped while Studio is closed | `R2-R5:*` |
| **R-6** the toast's action fails after a scroll | cause: the toast is `position: absolute` inside the overflow-hidden `#studio`, and a `scrollIntoView` scrolls that box and carries the toast away from the pointer; `st4.css` makes `#toast` fixed | `R2-R6:*` |

