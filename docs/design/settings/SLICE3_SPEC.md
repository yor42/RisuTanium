# Settings & models slice 3: connections and model choice

Status: **draft, revision 2.1** (2026-10-27; §13 and §14 override earlier sections where they differ). Task: [tasks/2026-10-26-settings-models.md](../tasks/2026-10-26-settings-models.md). Builds on [SLICE1_SPEC.md](SLICE1_SPEC.md) rev 2.1 (shell, rows, search, Back stack, KO register) and [SLICE2_SPEC.md](SLICE2_SPEC.md) rev 2.1 (presets, live save, undo stack, locks, 최근 삭제). Decisions in [DECISIONS-settings.md](DECISIONS-settings.md):
- DS-001: model setup is confusing; parameters are opaque.
- DS-004: slice 3 = connections and model choice.
- DS-040: keep that order; parameters stay in slice 4.
- DS-041: named connections (provider + key + URL + a name; several per provider).
- DS-042: the picker lives in Settings; Ctrl+M opens it from anywhere; a model change edits the active preset, with undo.
- DS-043: a failed reply shows an error card with 고치기, which jumps to the exact field and returns to the chat.
- DS-044: one models page (main, sub, per-task, fallback); locked rows show '모든 프리셋 공통'.
- DS-045: the picker shows the whole catalog with tags; unconfirmed models still ask once.
- DS-046: a connection test runs only on demand (확인).
- DS-047: saved keys show as •••• plus the last 4 characters, with no reveal.
- DS-048: custom models live under their connection, tagged '직접 추가'.
- DS-049: deleting a connection that is in use lists its users and can be undone; undo asks for the key again (DS-027).
- DS-050: capability icons and filter chips in the picker; a details panel lists the rest.

Earlier decisions that still bind: DS-023 (keys work in text fields, except during IME composition and inline rename), DS-024/036/037 (undo stack: Ctrl+Z in lists, Alt+Z anywhere in Settings), DS-025 (locks store fields outside the preset), DS-027 (secrets never in undo history, restore points or exports), DS-031 (names: 60 chars, duplicates warned), DS-038 (no Korean particle directly after a user-chosen name).

Research: [research/today-settings.md](research/today-settings.md) §3 (model and provider).

Lane split: this lane owns connections, the model picker, the models page and the Settings end of the fix-it path. The chat lane (main session) owns the error card in chat; until its `__chat.failReply` hook lands, this slice draws a stand-in to the agreed API (§6). Studio owns nothing here; Ctrl+M is free in Studio and chat (main session, 2026-10-27).

Marked **(design default)** = chosen here within the decided intent, open to veto.

## 0. Today (source-read)

| Fact | Source |
|---|---|
| There is no connection object. Keys and URLs are loose `db` fields shown under the model picker in whatever order the `{#if}` blocks run: 25+ provider-conditional blocks. | `BotSettings.svelte:168-500`; research §3 |
| Provider keys are global, but the reverse-proxy URL, proxy key and request model travel with each preset. | `database.svelte.ts:1639-1662, 2115-2120, 2239-2243` |
| The picker is a 384 px modal of provider accordions, with no search, no capabilities and no description. Non-recommended models hide behind a checkbox; unconfirmed ("gray") models ask a confirm. | `ModelList.svelte:33-60, 77-158` |
| Model data: 28 capability flags, 24 formats, 17 providers, a parameter list, a tokenizer and a recommended flag per model. | `src/ts/model/types.ts:3-132` |
| Ctrl+M (`modelSelect`) is declared but has no handler. | `defaulthotkeys.ts:74-77`; no match in `hotkey.ts` |
| The sub model, four per-task models and five fallback lists sit on two pages; an Advanced toggle moves one block between them, and three hidden locks decide whether a preset switch changes them. | `AuxModelSelectors.svelte:9-29`, `PromptSettings.svelte:312-356`, `advancedSettingsData.ts:213`, `database.svelte.ts:2303-2333` |
| Custom models and the dynamic model registry live in Advanced. | `advancedSettingsData.ts:166, 244`, `CustomModelsSettings.svelte` |
| Key fields are masked by a Display toggle (`hideApiKey`); the NovelAI token ignores it. | `displaySettingsData.svelte.ts:299`, `BotSettings.svelte:222-225` |
| No pre-send check for a key or model. A missing key surfaces as the provider's error string after retries. | `request.ts:336-362`, `modellist.ts:831-843` |
| Clearing the NanoGPT key silently clears its model, provider and subscription state. | `BotSettings.svelte:54-84` |

## 1. Where things live

The 모델·프리셋 page (slice 1) has the sections 모델, 파라미터, 프리셋, 연결, 프롬프트 설정. This slice fills **연결** and **모델**; 파라미터 keeps its slice 1 placeholder until slice 4.

- **연결** section: the connection list (§2.1) and "연결 추가".
- **Connection detail** is a sub-page, like slice 2's library: breadcrumb 모델·프리셋 › 연결 › {name}; deep link `?page=models&section=models.connections&view=conn&conn=<id>`; Back returns to the list with focus on that card.
- **모델** section: the models page (§4).
- **The picker** (§3) opens from any model row, from Ctrl+M, and from 고치기.
- Search (slice 1 §5) indexes connection names, providers, every model in the catalog (name, id, provider) and custom models. A model result opens the picker for the main model with that model focused; a connection result opens its detail.

Rows retired or moved:
- `models.hideApiKey` (Display/연결): retired, since keys are always masked (DS-047). Searching "API 키 숨기기" lands on a note row: "API 키는 항상 가려져 있어요 · 끝 4자리만 보여요".
- The loose key and URL fields in slice 1's 연결 section: replaced by connections.
- `models.refreshModels`, `models.dynamicRegistry`, `models.customModels`: move into each connection (§2.4–2.5).
- `models.sepModels` (master switch) and `auxModelUnderModelSettings` (Advanced): retired; per-task rows always show and default to "same as main" (§4) **(design default)**.

## 2. Connections (DS-041, DS-046, DS-047, DS-048, DS-049)

### 2.1 The list

- One card per connection, in the user's order (drag handle, Alt+Up/Down, as slice 2 §3.5).
- Card: provider icon (lucide only: `cloud`, `server`, `house` for local, `route` for routers; no brand logos), **name**, provider label, key state (`•••• 7f3a`, "키 없음", or `${NAME}` for an environment reference), last test result ("정상 · 3분 전", "키가 맞지 않아요 · 어제", "확인 안 함"), and "프리셋 {n}개에서 사용".
- A card whose key is missing or whose last test failed gets `circle-alert` and a one-line reason.
- "연결 추가" (`plus`) opens the add flow (§2.2).
- Empty state (fixture `none`): "아직 연결이 없어요. 쓰려는 서비스를 골라 키를 넣으면 돼요." with "연결 추가".

### 2.2 Adding a connection

Name-first, as Studio and slice 2 creation (no blank connection is stored):
1. **Provider**: a searchable list of the 17 providers, grouped 클라우드 / 라우터 / 직접 실행 (local) / 호환 (OpenAI-compatible and other reverse-proxy formats).
2. **Fields for that provider only**: name (prefilled "{provider}", or "{provider} 2" if taken; 60 chars, duplicates warned, DS-031), key (or token), URL where the provider needs one, request format and tokenizer for 호환, region/project/email for Vertex.
3. **저장** stores it. **저장하고 확인** stores it and runs the test (§2.3).

Opening "연결 추가" from the picker's "연결 없음" group prefills the provider **(design default)**.

### 2.3 Test (DS-046)

- **확인** (`plug-zap`) on the detail page and the card menu. It never runs on its own.
- While running: "확인 중…", with 취소; one simulated request.
- Results:
  - **정상**: "정상 · 모델 {n}개를 찾았어요" (with a latency figure in ms);
  - **키가 맞지 않아요** (401/403);
  - **연결할 수 없어요** (unreachable / timeout);
  - **한도를 넘었어요** (429).
- The result and its time are kept on the card. Editing the key or URL clears it to "확인 안 함".

### 2.4 Detail page

Rows, top to bottom:
1. Name (inline rename, F2), provider (read-only; changing provider means a new connection).
2. **Key** (DS-047): shown as `•••• 7f3a`. Actions: **키 바꾸기** (opens an empty field; paste; 저장), **키 지우기** (confirm). No reveal, no copy. An `${NAME}` reference is shown in full with a `variable` icon and the env-var note (slice 1 `models.envNote`). Help (DS-069): "키는 실행 취소·복원 지점·공유용 내보내기에는 들어가지 않아요. 전체 백업에는 들어가요."
3. URL, format, tokenizer, region, etc. for this provider.
4. **확인** and the last result.
5. **모델** group: "모델 목록 새로고침" (`refresh-cw`), "시작할 때 목록 가져오기" (switch; only for providers with a list API; replaces `dynamicRegistry`), and the **custom models** list (§2.5).
6. **사용 중**: the presets, per-task rows and fallback lists that point at this connection, each a link.
7. 연결 지우기 (danger, §2.6).

Key edits never enter the undo stack (DS-027). The key row shows "키는 되돌릴 수 없어요" under 키 바꾸기. Other connection fields (name, URL, format…) are undoable with Alt+Z as slice 2 live save.

Provider-specific side effects are shown before they happen: e.g. clearing a NanoGPT key asks "모델·공급자 선택도 함께 지워져요" instead of clearing silently.

### 2.5 Custom models (DS-048)

- "모델 추가" (`plus`) on a connection: model id (as the provider expects), display name, context length, capabilities (the §3.4 set as switches), format (for 호환 only).
- Listed under the connection; edit and delete from the row menu; undoable.
- In the picker they show the **직접 추가** tag and the connection's name.

### 2.6 Deleting a connection (DS-049)

- Dialog: "‘{name}’ 연결을 지울까요?" then the users: "이 연결을 쓰는 곳" with up to 5 preset names and per-task/fallback rows, then "외 {n}개". Buttons 취소 (focused) / 지우기.
- Unused connection: a plain confirm.
- After deleting: toast "연결 삭제됨: {name} · 실행 취소" (DS-038 wording); the affected presets, model rows and the chat header chip show `circle-alert` with "연결 없음".
- Undo (toast, Alt+Z, Ctrl+Z in the list) restores the connection, its custom models and every reference, **without the key**. The card then reads "키 다시 입력 필요" and its detail opens with the key field focused.
- Connections do not go to 최근 삭제; undo covers the session **(design default)**.

## 3. The model picker (DS-042, DS-045, DS-050)

### 3.1 Openers and target

- Any model row on the models page (§4): title "{row} 고르기" (e.g. "주 모델 고르기").
- **Ctrl+M** anywhere (Settings, chat, Studio): opens the picker for the **main model** of the active preset. Ignored during IME composition, inline rename and the `{{` autocomplete (as DS-023). Pressing Ctrl+M again, or Esc, closes it.
- 고치기 with `fix=model` (§6).
- A fallback list's "추가".

### 3.2 Layout

- ≥768 px: a dialog, 720 px wide, list on the left and the details panel (§3.5) on the right.
- <768 px: a full-height sheet; details open as a second step with Back.
- Top: search field (focused on open), filter chips, then the list.

### 3.3 List

- Groups, in order:
  1. **지금 쓰는 모델** (the current value, one row);
  2. **최근** (5) **(design default)**;
  3. one group per **connection**, in the connection order;
  4. **연결 없음**: catalog models of providers with no connection, at the end, collapsed by default.
- Within a group: recommended first, then by name.
- Row: model name, connection name (in the 최근 and search views), context length ("200K"), capability icons (§3.4), and at most one status tag:
  - **추천**;
  - **확인 안 됨** + one-line reason ("공급자가 알려 준 모델이라 동작을 확인하지 않았어요");
  - **지원 종료** + reason (e.g. "2026년 1월에 종료돼요");
  - **직접 추가**.
- A model under a connection with no key or a failed test is listed but shows "키 필요"; choosing it opens the connection's key field instead of choosing.
- Choosing a **확인 안 됨** model asks once: "확인되지 않은 모델이에요. 그래도 쓸까요?" (쓰기 / 취소); remembered per model.
- Search matches name, id, provider and connection name, KO and EN, with 초성 for Korean names (as slice 2). Results flatten into one list with the connection shown on each row; "모델 {n}개" is announced.
- No match: "‘{q}’에 맞는 모델이 없어요" and, when the query looks like a model id, "‘{q}’ 직접 추가" which opens §2.5 for a chosen connection.

### 3.4 Capabilities (DS-050)

- Row icons (lucide), at most 4, in this order: `eye` 이미지 입력, `wrench` 도구 사용, `brain` 추론, `image` 이미지 생성. The context length is text.
- Filter chips (toggle, AND): 이미지 입력 · 도구 · 추론 · 긴 문맥 (≥128K) · 연결된 모델만 (on by default when at least one connection exists) **(design default)**.
- Chip state persists per device.

### 3.5 Details panel

Name and id (copyable), connection, status and its reason, context length, max output, every capability in plain words (the 28 flags mapped to short phrases; unknown flags listed as "기타: {n}개"), supported parameters as a short list with "파라미터는 슬라이스 4에서" placeholder link, tokenizer, request format. Button **이 모델 쓰기**.

### 3.6 Choosing

- The value is written to the active preset at once (slice 2 live save), and a toast says "주 모델 바꿈: {model} · 실행 취소" (DS-038 form; works for custom names).
- Undo by the toast, Alt+Z in Settings, or the chip's toast in chat.
- A locked row (§4.2) writes to the shared value; its toast adds "· 모든 프리셋 공통".
- A reply that is generating keeps its model (DS-029).

## 4. The models page (DS-044)

### 4.1 Rows

One list, in this order:
1. **주 모델**: "채팅에서 답변을 쓰는 모델이에요."
2. **보조 모델**: "감정 이미지와 자동 제안에 써요. 싸고 빠른 모델을 권해요."
3. Group **기능별 모델**: 장기 기억 · 번역 · 감정 이미지 · 기타.
4. Group **대체 모델**: one row each for 주 모델, 장기 기억, 번역, 감정 이미지, 기타: "{n}개" or "없음". Plus the switch **빈 답변이면 다음 모델로** (`fallbackWhenBlankResponse`) and the row **재시도 횟수** (`requestRetrys`, moved here from Advanced) **(design default)**.

Each model row shows the model name, its connection and capability icons; tap opens the picker for that row. A per-task row with no value of its own reads **"주 모델과 같음 · {resolved name}"** (DS-044), with 되돌리기 to clear an override.

A row whose connection is missing, keyless or failing shows `circle-alert` and the reason; tap opens 고치기 for it (§6.3).

### 4.2 Locks (DS-025)

- The three slice 2 locks (기능별 모델 유지, 대체 모델 유지, 기능별 파라미터 유지) stay in the 프리셋 section.
- On this page a locked group gets a `lock` badge **모든 프리셋 공통** in its header. The badge links to its switch in the 프리셋 section.
- Edits in a locked group change the shared value.

### 4.3 Fallback editor

Sub-page per fallback row: an ordered list with 추가 (opens the picker), reorder (handle, Alt+Up/Down, long-press on touch), remove, all undoable; the note "앞에서부터 차례로 시도해요. 모델마다 {n}번 재시도해요."

## 5. Ctrl+M (DS-042)

- New hotkey entry `modelSelect` in the 단축키 section, rebindable, defaulting to Ctrl+M; listed with the slice 2 slot keys.
- Works in text fields (DS-023), except IME composition, inline rename and `{{` autocomplete.
- In the chat stub, Ctrl+M opens the same picker as an overlay over the chat; choosing closes it and shows the chat toast with undo.
- Firefox maps Ctrl+M to mute tab; the mockup calls `preventDefault` and lists Firefox as not checked.

## 6. Fix-it path (DS-043)

### 6.1 The error card (chat lane API; stand-in here)

Agreed API (main session, 2026-10-27), to be provided by the chat mockup later:

```
window.__chat.failReply(msgId, { reason: 'key'|'model'|'quota'|'network'|'server', fix: 'key'|'model'|null, conn: '<id>', detail?: '<short text>' })
```

- It replaces the streaming reply with an inline card, `role="alert"`, announced once.
- `circle-alert` icon plus a one-line reason (§9 copy).
- **고치기** (`wrench`) when `fix` is set: links to `settings/slice3.html?fix=<fix>&conn=<id>&back=chat&msg=<msgId>&lang=<lang>`; `lang` carries the visit language, as chat's link does (DD-139, R-16).
- **다시 시도** (`rotate-ccw`) regenerates in place.
- Returning: `chat/slice1.html?from=settings&retry=<msgId>` focuses the card and shows the toast "설정을 바꿨어요 · 다시 시도할까요?" (with a 다시 시도 button). No auto-retry.
- The failed reply keeps its place, is not a swipe and is not sent as history.

**Stand-in:** slice 3 ships its own chat stub (`?state=fx-chat-*`) with `window.__ss3ChatStub.failReply(msgId, opts)` of the **same signature and output**, and its return target `slice3.html?state=fx-chat&from=settings&retry=<msgId>`. Swapping to the real hook later is one line: the stub's call site. Nothing under `chat/**` is edited.

Reason → fix mapping:

| reason | fix | 고치기 opens |
|---|---|---|
| key | key | the connection's key field |
| model | model | the picker for the failing row, with the reason line |
| quota | key | the connection detail (key and test) |
| network | null (or key for a 호환 URL) | — (URL row when set) |
| server | null | — |

### 6.2 Arriving in Settings from 고치기

- `fix=key`: the connection detail opens with **키 바꾸기** open and focused; a banner at the top: "채팅에서 왔어요: {reason}" with **채팅으로 돌아가기** (`arrow-left`).
- `fix=model`: the picker opens over the models page for the row that failed, with the reason line above the search ("‘{model}’ 모델을 이 연결에서 찾을 수 없어요").
- After the fix is saved (key saved, or model chosen), the banner turns into **채팅으로 돌아가 다시 시도** as the primary button. It does not test or retry by itself.
- Back (or the banner) returns to the chat target with `from=settings&retry=<msg>`.

### 6.3 Fix marks elsewhere

The same marks (`circle-alert` + reason) appear on: connection cards, model rows, slice 2 library rows of affected presets, and the chat header chip (stub). Tapping any opens §6.2 for that cause.

## 7. Keyboard, motion, accessibility

- **Picker:** combobox + listbox (slice 1 §5.1 pattern), groups `role="group"` with headings; Up/Down, Home/End, PageUp/Down, Enter, Esc; Right (or `i`) opens details on wide screens; chips are toggle buttons with `aria-pressed`. Live region: "모델 {n}개".
- **Connection list:** roving tabindex; F2 rename; Alt+Up/Down; Delete opens the delete dialog; menu key / Shift+F10.
- **Key field:** `autocomplete="off"`, `spellcheck="false"`, type password while typing; never written to the DOM after saving except the last 4.
- **Back stack:** 1 dialog/menu, 2 details step (phone), 3 picker, 4 fallback editor / connection detail, 5 search; then slice 1's order. With `back=chat`, the last step returns to the chat.
- **Motion:** chat tokens; picker dialog and sheet like slice 2's switcher; reduced motion = 120 ms crossfade; low power = instant; only `transform` and `opacity` animate. The test spinner is a `transform` rotate, static in reduced motion and low power.
- **Targets and forced colours:** 44 dp on touch; status tags and fix marks get borders in forced colours; capability icons have text equivalents in the accessible name.

## 8. Integration map (lane A; nothing here edits these files)

| Change | Where |
|---|---|
| New `db.connections: {id, name, provider, key, url?, format?, tokenizer?, region?…, lastTest?}`; per-preset `connectionId` + `modelId` for main/sub/per-task/fallback. One-time migration: each provider key becomes a connection; each distinct reverse-proxy URL+key across presets becomes "프록시 1…n". | `database.svelte.ts:1636-1735, 2094-2339` |
| Request code reads keys and URLs from the connection, not from loose fields. | `request.ts`, provider modules (`anthropic.ts`, `openAI/requests.ts`, …) |
| Keys excluded from undo and restore points, and from exports meant for sharing (preset bundles, cards, modules; `${NAME}` placeholders stay); full backups keep them (DS-069). Already blanked in `downloadPreset` for some fields; extend to all sharing exports. | `database.svelte.ts:2355-2365` |
| New picker component replaces `ModelList.svelte` everywhere it is imported. | `ModelList.svelte`, `BotSettings.svelte`, `AuxModelSelectors.svelte`, `PromptSettings.svelte`, `EasyPanel.svelte`, `CustomSidebar.svelte` |
| `modelSelect` handler for Ctrl+M. | `hotkey.ts`, `defaulthotkeys.ts:74-77` |
| Models page replaces the Model tab's pickers, `AuxModelSelectors` and the Prompt page's fallback block; retire `seperateModelsForAxModels`, `auxModelUnderModelSettings`, `hideApiKey`. | `BotSettings.svelte:168-500`, `PromptSettings.svelte:312-356`, `advancedSettingsData.ts:166,213,244`, `displaySettingsData.svelte.ts:299` |
| Custom models move under connections. | `CustomModelsSettings.svelte` |
| Pre-send check for key/model; typed failure reasons for the error card. | `request.ts:203-371` |
| Chat error card + return toast | chat lane (main session), `__chat.failReply` |
| Strings | `src/lang/en.ts`, `ko.ts` |

## 9. Korean copy (proposed keys, en / ko)

| Key | en | ko |
|---|---|---|
| connections / addConnection | Connections / Add connection | 연결 / 연결 추가 |
| noConnections | No connections yet. Pick a service and add its key. | 아직 연결이 없어요. 쓰려는 서비스를 골라 키를 넣으면 돼요. |
| usedBy | Used by {n} presets | 프리셋 {n}개에서 사용 |
| keyMissing / keyNeeded | No key / Key needed | 키 없음 / 키 필요 |
| keyAgain | Enter the key again | 키 다시 입력 필요 |
| changeKey / clearKey | Replace key / Remove key | 키 바꾸기 / 키 지우기 |
| keyLocal | Keys aren't kept in undo or restore points, and aren't included in exports for sharing. Full backups keep them. | 키는 실행 취소·복원 지점·공유용 내보내기에는 들어가지 않아요. 전체 백업에는 들어가요. |
| keyNoUndo | Key changes can't be undone | 키는 되돌릴 수 없어요 |
| keysAlwaysHidden | API keys are always hidden; only the last 4 characters show | API 키는 항상 가려져 있어요 · 끝 4자리만 보여요 |
| test / testing | Check / Checking… | 확인 / 확인 중… |
| testOk | OK · found {n} models | 정상 · 모델 {n}개를 찾았어요 |
| testBadKey / testUnreachable / testQuota | The key isn't valid / Can't connect / Over the usage limit | 키가 맞지 않아요 / 연결할 수 없어요 / 한도를 넘었어요 |
| notTested | Not checked | 확인 안 함 |
| deleteConnQ | Delete the "{name}" connection? | ‘{name}’ 연결을 지울까요? |
| usedHere / andMore | Used here / and {n} more | 이 연결을 쓰는 곳 / 외 {n}개 |
| connDeleted | Connection deleted: {name} | 연결 삭제됨: {name} |
| noConnection | No connection | 연결 없음 |
| pickModel | Choose {row} | {row} 고르기 |
| currentModel / recent | Current model / Recent | 지금 쓰는 모델 / 최근 |
| tagRecommended / tagUnverified / tagDeprecated / tagCustom | Recommended / Unverified / Retiring / Added by you | 추천 / 확인 안 됨 / 지원 종료 / 직접 추가 |
| unverifiedQ | This model isn't verified. Use it anyway? | 확인되지 않은 모델이에요. 그래도 쓸까요? |
| chipVision / chipTools / chipReasoning / chipLong / chipConnected | Image input / Tools / Reasoning / Long context / Connected only | 이미지 입력 / 도구 / 추론 / 긴 문맥 / 연결된 모델만 |
| modelResults / noModelMatch | {n} models / No models match "{q}" | 모델 {n}개 / ‘{q}’에 맞는 모델이 없어요 |
| addAsCustom | Add "{q}" yourself | ‘{q}’ 직접 추가 |
| useThisModel | Use this model | 이 모델 쓰기 |
| modelChanged | {row} changed: {model} | {row} 바꿈: {model} |
| sharedAll | Shared by all presets | 모든 프리셋 공통 |
| sameAsMain | Same as main model · {name} | 주 모델과 같음 · {name} |
| fallbackNote | Tried in order, {n} retries each | 앞에서부터 차례로 시도해요. 모델마다 {n}번 재시도해요. |
| blankNext | Move to the next model on a blank reply | 빈 답변이면 다음 모델로 |
| retries | Retries | 재시도 횟수 |
| failKey / failModel / failQuota / failNetwork / failServer | The API key is missing or invalid / This connection can't find the model / Over the usage limit / Can't reach the server / The server returned an error | API 키가 없거나 맞지 않아요 / 이 연결에서 모델을 찾을 수 없어요 / 사용 한도를 넘었어요 / 서버에 연결할 수 없어요 / 서버에서 오류가 났어요 |
| fix / retry | Fix / Try again | 고치기 / 다시 시도 |
| fromChat | From chat: {reason} | 채팅에서 왔어요: {reason} |
| backToChat / backAndRetry | Back to chat / Back to chat and try again | 채팅으로 돌아가기 / 채팅으로 돌아가 다시 시도 |
| changedRetryQ | Settings changed · Try again? | 설정을 바꿨어요 · 다시 시도할까요? |

Names (connection, model) never take a particle directly (DS-038); `{row}` labels are fixed words and may.

## 10. The mockup

### 10.1 Files

- `settings/slice3.html`, `slice3.css`, `slice3.js`, `data3.js` (connections, catalog generator, custom models, fixtures). It loads slice 1 and slice 2 (`slice1.*`, `data.js`, `slice2.*`, `data2.js`) and extends them through `window.SS1_EXT` (and a matching slice 2 hook if needed).
- Slice 1 and slice 2 files may get hooks; if they change, **ss1 and ss2 must stay green** (re-run both; record in `checks/builder-checks.md`).
- Synthetic data only: keys like `fake-key-0000-…`, hosts `*.invalid`; the test and every "request" are simulated timers; no network.

### 10.2 Fixtures (`?set=`)

| Set | Contents |
|---|---|
| `demo` | 7 connections: Anthropic (ok), OpenAI (ok), Google (bad key), OpenRouter (ok, large list), 회사 프록시 (호환, ok), 집 서버 (호환, unreachable), Ollama (local, not tested); ~180 catalog models with flags and statuses; 3 custom models; slice 2's 60 presets using them; one per-task override; two fallback lists |
| `stress` | 20 connections, 1,500 catalog models, 40 custom models |
| `none` | no connections (first run) |
| `broken` | the active preset's connection deleted and another keyless: fix marks everywhere |

### 10.3 States (`?state=`)

- **Connections:** `cx-list`, `cx-add-provider`, `cx-add-fields`, `cx-detail`, `cx-key-replace`, `cx-env-key`, `cx-test-running`, `cx-test-ok`, `cx-test-badkey`, `cx-test-unreachable`, `cx-custom-add`, `cx-delete-used`, `cx-delete-undo`, `cx-key-again`, `cx-empty`.
- **Picker:** `mp-open`, `mp-search` (`q=sonnet`), `mp-chosung`, `mp-filter-vision`, `mp-details`, `mp-phone-details`, `mp-unverified-ask`, `mp-key-needed`, `mp-no-match`, `mp-stress`.
- **Models page:** `md-page`, `md-locked`, `md-fallback-editor`, `md-fix-mark`, `md-changed-toast`.
- **Fix path:** `fx-chat` (stub chat), `fx-chat-error-key`, `fx-chat-error-model`, `fx-chat-error-network`, `fx-arrive-key`, `fx-arrive-model`, `fx-fixed-back`, `fx-chat-retry-toast`.
- **Ctrl+M:** `km-chat-picker`, `km-hotkeys`.

Plus slice 1's parameters (`lang`, `w`, `reduced`, `lowpower`, `from`) and the deep-link parameters above. The page sets `window.__ss3Ready` and exposes `window.__ss3`.

### 10.4 Checks

Suite `ss3` in `settings/checks/` (extend `run.mjs`), under COST_ROUTING.md "Mockup checks: parallel first" and `checks/speed-pass.md`:
- about 90 s wall at 3 workers; at most 3 Chrome workers, one per worker for the whole run; own profiles, deleted afterwards; the 6141 server never stopped;
- shard by state, width and language; stills split per width from the start;
- no fixed sleeps except real-time checks (the toast lifetime, the test timer); use `ctx.idle(ms)`; a `.timing.json` per run with `slowest5`;
- KO and EN; widths 360 / 412 / 768 / 1024 / 1280.

| Section | Covers |
|---|---|
| conn | List, add (provider list, per-provider fields, name rules), detail rows, key masking (DOM holds only the last 4 after save), env reference, test results and reset on edit, key not in undo, NanoGPT side-effect warning, reorder with announcements |
| custom | Add/edit/delete custom models, tag in picker, "직접 추가" from no-match |
| delete | Used-by list (5 + 외 n개), marks after delete, undo restores without key, key-again state |
| picker | Openers and titles, groups and order, tags and reasons, unverified ask once, key-needed redirect, search incl. 초성 and id, chips (AND, persisted), details panel and phone step, choose → live save + toast + undo (Alt+Z, toast) |
| pickerperf | 1,500 models: open and keystroke budgets at 4× CPU, the same budgets as slice 2's 300-preset switcher (run in the quiet lane) |
| models | Rows and order, "주 모델과 같음" resolution, 되돌리기, lock badges and shared writes, fallback editor (add, reorder by key/pointer/touch, remove, undo), retries and blank-reply rows |
| fix | Stub failReply API shape (role=alert once, icon, buttons per reason), 고치기 targets per reason, banner and back-and-retry, return toast and focus, no auto-retry, fix marks on cards/rows/library/chip |
| keys | Ctrl+M in Settings, chat stub and text fields; ignored in IME, rename, `{{`; rebind in 단축키; Esc/Ctrl+M close |
| a11y/modes | Roving focus, Back stack order incl. back=chat, reduced motion / low power (transform/opacity only), forced colours, 200 % text |
| koen, stills, console | As slices 1–2 |
| ss1, ss2 regression | Full re-runs if slice 1/2 files changed |

The builder lists the five slowest sections in `checks/builder-checks.md`.

## 11. Open questions

- O-1 **"Same as main" for per-task models:** today the sub model serves emotion images and auto suggest. Should unset per-task rows fall back to the main model (as DS-044 reads) or to the sub model where today's code uses it?
- O-2 **Migration naming:** existing reverse-proxy settings that differ per preset become several connections "프록시 1…n". Is that acceptable, or should identical URLs with different keys merge?
- O-3 **OpenRouter / NanoGPT provider routing:** stays on the Parameters page (slice 4) or moves into the connection?
- O-4 **Horde and plugin providers:** shown as connections with no key, or as their own picker groups?

## 12. Design defaults to confirm

- Retire `hideApiKey`, `seperateModelsForAxModels`, `auxModelUnderModelSettings`.
- Connections don't go to 최근 삭제; undo covers the session.
- Picker recents: 5. "연결된 모델만" chip on by default.
- Row capability icons: vision, tools, reasoning, image output.
- 재시도 횟수 moves from Advanced to the models page.
- Changing provider means a new connection.
- 고치기 opens Settings in place (not a dialog over the chat).

## 13. Review answers (rev 2)

From [reviews/2026-10-27-settings-slice3-review.md](../reviews/2026-10-27-settings-slice3-review.md), decisions DS-051..060, and the chat lane's DD-130..134 (main session, 2026-10-27). Where this table and §1–§12 differ, this table wins.

| Item | Answer |
|---|---|
| R-01, DS-054 | Every connection of a provider lists the whole catalog (plus its own custom and fetched models). Presets and model rows store `(connectionId, modelId)`. The picker shows the same model under each connection; 최근 and search rows name the connection. Check: two 호환/OpenAI connections both list models, and choosing under the second stores the second. |
| R-02, DS-052 | Only a missing key blocks choosing ("키 필요"). A failed or unreachable last check shows its stored result as a warning on the row and in the details panel; choosing is allowed. §3.3 "a failed test" is struck. |
| R-03, DS-053 | With "연결된 모델만" on, the list ends with a visible row "연결 없는 모델 {n}개 숨김 · 보기" that turns the chip off. Search that matches only hidden models says "숨긴 모델 {n}개가 맞아요 · 보기". With no connections the chip starts off. |
| R-04 | The 연결 없음 group (and any capped group) ends with "{n}개 더 보기"; windowing keeps budgets. |
| R-05 | Ctrl+M ignores `ev.repeat`. |
| R-06 | While a dialog sits over the picker (unverified ask), Ctrl+M and Esc act on the dialog first (Back stack). 쓰기 always completes or explains. |
| R-07 | Phone rows: the name gets at least 50 % of the row; the status tag drops to a second line before the name truncates (KO and EN at 360). |
| R-08, DS-051 | Unset 감정 이미지 and 자동 제안 → sub model (main if empty); unset 장기 기억, 번역, 기타 → main model. Rows read "보조 모델과 같음 · {name}" or "주 모델과 같음 · {name}". 자동 제안 is shown as a per-task row. The 보조 모델 description matches. |
| R-09 | A key-needed redirect from the picker returns to the picker (same row, same query) after the key is saved, with the model then choosable. |
| R-10, DS-057 | Undo of a connection delete stays put; the card shows "키 다시 입력 필요"; the undo toast has "키 넣기". |
| DS-058 | Undo restores an `${NAME}` reference. The delete dialog says "환경 변수 참조는 되돌리면 다시 살아나요" only when the key is a reference. |
| R-11 | Any undo (Ctrl+Z, Alt+Z, toast) dismisses a toast whose change it undid, and a toast's 실행 취소 undoes exactly the change it names, or is removed once that change is no longer on top. |
| R-12 | Editing a key or URL cancels a running check; the result never lands on changed credentials. |
| R-13 | 호환 and other address-based providers require an address before 저장. |
| R-14, DS-055 | Settings records a "relevant change" (key, address, model, connection, routing) during a 고치기 visit; the chat return row appears after any such change. |
| R-15, DD-132, DD-133 | With `back=chat`, the return goes to `../chat/slice1.html?from=settings&retry=<msg>` (the real `__chat.failReply` is in chat/slice1.js). The return row in chat reads "설정을 바꿨어요 · 다시 시도할까요?" with **no button of its own**; focus goes to the card's 다시 시도 (DD-132). The slice 3 stub chat is kept only for its own checks and follows the same rule. An optional chat id may be passed (DD-133). |
| R-16, R-17, DS-056 | quota → connection detail with its check result and "다른 모델 고르기"; network on address-based providers → the 주소 row; hosted providers' network errors → no 고치기. Update the §6.1 table. |
| R-18 | The phone info control is outside `role=option` (a sibling button in the row container, or the details step reached by Right / a row menu). |
| R-19 | On phones 키 바꾸기 and 키 지우기 are labelled buttons (icon + text) with at least 8 px gap; 키 지우기 is in the danger style. |
| R-20, DS-059 | OpenRouter and NanoGPT routing options move into that connection's detail page; NovelAI and Ooba option rows likewise under their connection; shown only when such a connection exists. |
| DS-060 | Migration (integration map, notice only in the mockup): one connection per distinct address + key, named after the host; a one-time notice "프록시 설정을 연결 {n}개로 옮겼어요 · 이름 바꾸기". Fixture state `cx-migrated`. |
| R-21 | A model with no connection: the details button reads "연결 추가하고 쓰기" and the row action says the same. |
| R-22 | Budgets stay as set (4× CPU). Record the 6× numbers in builder-checks.md as information, not a gate. |
| R-23 | Fix every listed hollow or wrong-target assertion; add failing-first checks for R-01..R-21 and DS-051..060 (a `review3.mjs`-style R-id coverage check). |
| R-24..R-27, R-29 | Fix as suggested in the review (EN plurals; distinct wording for replace vs. new key; `autocomplete="new-password"`; trim redundancy; mock secrets out of page globals). |
| R-28 | Pre-existing slice 1 copy `‘ctrl’와(과) 일치`: fix in slice 1 data if trivial, re-running ss1. |
| Builder Q: "not found" model | Stays refused; the row shows the reason visibly, not only to the live region. |
| DD-130, DD-131 | In the chat stub, a model switch made with Ctrl+M is confirmed by an inline status row, not a floating toast; Alt+Z in chat undoes it. Settings keeps its toast. |
| DD-134 | Ctrl+M in chat goes through the failed-save guard like Ctrl+P (DS-026). |
| Copy | SLICE2 `switchedPreset` becomes "프리셋을 바꿨어요 · ‘{name}’" (DS-038) wherever slice 2/3 still shows the particle form. |
| O-4 | Horde stays a 라우터 connection with an optional key. Plugin providers are not in this slice. |

## 14. Re-review answers (rev 2.1)

From [reviews/2026-10-27-settings-slice3-rereview.md](../reviews/2026-10-27-settings-slice3-rereview.md) (N-01..N-17) and DS-061..066. Where this table and earlier sections differ, this table wins.

| Item | Answer |
|---|---|
| N-01, R-14, N-13 | Any relevant change during a 고치기 visit (address included) turns the banner into **채팅으로 돌아가 다시 시도** at once; undoing the last such change turns it back and clears `changed`. After the fix the banner reason reads "고쳤어요 · 채팅에서 다시 시도해 보세요". |
| N-02, DS-063 | The 고치기 link may carry `model=<id>` and `row=<main, sub, mem, trans, emo, suggest or other>` (pending the main session's agreement). With them, the reason line names the failed model and the picker opens for that row on `conn`. Without them, open the main row and say "실패한 모델을 알 수 없어요" rather than naming the current model. |
| N-06, DS-054 | Store a real `(connectionId, modelId)` pair everywhere, with no plain-id special case for the first connection; re-binding never depends on connection order. |
| N-07, DS-064 | 고치기 on "연결 없음" when a same-provider sibling has the model: open the picker with that model under the sibling at the top. No automatic re-bind. |
| N-08, DS-065 | Name the connection ("· {connection}") in toasts, undo text and fallback summaries only when the model name is ambiguous. |
| N-09, DS-066 | "연결 추가하고 쓰기" returns to the picker with the model focused under the new connection; one more tap chooses it. |
| N-10, DS-061 | Provider option values are stored per connection. |
| DS-062 | The return link carries the language the user last chose in Settings (the incoming `lang` until then). |
| N-03, N-05, N-14 | Focus: after choosing from a banner, to the changed row; after undoing a delete, to the restored card. On arrival from chat, a polite announcement "채팅에서 왔어요: {reason}", and the focused field is described by the banner. |
| N-04 | The `${NAME}` delete dialog says only that the reference comes back on undo; the restored card's test result resets to "확인 안 함". |
| N-11, N-12 | Forced colours: active and current rows readable (system colours, border). Picker ARIA: no buttons owned by the listbox; group headers are not options. |
| N-15 | Ctrl+M is ignored while a key field has unsaved input. |
| N-16 | Edits re-render only the affected rows; record before/after timing. |
| N-17 | Align the Settings banner reasons with the chat card's wording; one copy form for preset switches. |
| R-18, R-23 | Finish as the re-review's "Checks on the checks" says: failing-first must fail on behaviour, not on missing APIs; no assertion accepts both outcomes; the coverage check maps ids to named behaviours. Add checks for N-01..N-17 and DS-061..066, including at least one round trip that drives the real chat page (key or address). |

## Appendix: Parts (theme readiness, DD-142 to DD-159)

Added by the theme-readiness pass and extended by its fix round; the screen's behaviour is unchanged. Rule: [THEMING.md](../THEMING.md). Tokens: [theme-tokens.css](theme-tokens.css); loader and state mirror: [theme.js](theme.js); the pass: [THEME_AUDIT.md](THEME_AUDIT.md). A part is `data-part="settings-<role>"` on the element the Selector column names (the `th` suite reads this column: every element that carries the part must match it, and every instance of a main element class must carry some part). Names describe a role, not a look, and do not change once published. `data-part-critical` marks a surface a pack gives tokens to and never a rule; the pack-install rule (`checks/th/lint.mjs`) rejects a selector that can reach one. The appendices of slices 1 and 2 list the parts this slice builds on; slice 3's own parts:

| Part | Selector | Notes |
|---|---|---|
| `settings-connection-list` | `ul.c3-cx` | the list of connections on the models page |
| `settings-connection-card` | `li.c3-card` | one connection: icon, name, key status, test; `data-bad` when its key or address has a problem, `data-dragging`, `data-lifted` |
| `settings-connection-card-main` | `.c3-cmain` | its main button |
| `settings-connection-card-name` | `.c3-cname` | its name |
| `settings-connection-card-status` | `.c3-cstat` | its test status line; **critical** while the connection has a problem |
| `settings-connection-warning` | `.c3-cwarn` | the reason a connection card is flagged (no key, key again, bad key, unreachable, quota); **critical** |
| `settings-connection-detail` | `.pg[data-view="conn"]` | a connection's own page (the sub-view of the models page) |
| `settings-connection-model` | `li.c3-cm` | a model in the connection's model list |
| `settings-test-result` | `.c3-tres` | the result of "확인"; `data-result` is `ok`, `badkey`, `unreachable`, `quota`, `none` or `run`; **critical** when it is not `ok` |
| `settings-fallback-editor` | `.pg[data-view="fb"]` | the fallback list editor page |
| `settings-fallback-item` | `li.c3-fbli` | one model in a fallback list |
| `settings-model-group` | `.c3-grp` | a group on the models page: per-task models, fallbacks, other settings, other services |
| `settings-model-row` | `.row.c3-mrow`, `.row.c3-fbrow` | a model row (value, lock badge, fix mark, revert) or a fallback row; `data-bad` while it points at a problem |
| `settings-migration-notice` | `.c3-migrate` | the one-time migration notice of the proxy settings |
| `settings-picker` | `.mp-root` | the model picker layer: dialog (wide) or full-height sheet (phone); `data-mode`, `data-step`, `data-open` |
| `settings-picker-scrim` | `.mp-scrim` | its dim layer |
| `settings-picker-panel` | `.mp-panel` | its panel |
| `settings-picker-search` | `.mp-top` | the search field row |
| `settings-picker-chip` | `.mp-chip` | a filter chip (`aria-pressed`) |
| `settings-picker-row` | `.mp-opt` | one model or a group header or a "show more" line; `data-active` (the cursor), `data-current` (the model in use), `data-needs-connection` |
| `settings-picker-row-name` | `.mp-name` | its name |
| `settings-picker-row-detail` | `.mp-sub` | its second line (connection and context size) |
| `settings-picker-warning` | `.mp-warn`, `.mp-need` | the unverified-connection warning and the key-needed mark on a model row and in the details pane; **critical** |
| `settings-fix-mark` | `.c3-markbtn` | the red "fix" button on a model row or a library row (opens the connection that needs the key); **critical** |
| `settings-picker-row-tags` | `.mp-meta` | its capability icons, tags and marks |
| `settings-picker-details` | `aside.mp-detail` | the details panel (a side pane, or the second step on a phone) |
| `settings-fix-banner` | `.c3-fixbanner` | the 고치기 banner on the page a chat error sends you to; `data-saved`. **Critical** (`data-part-critical`) until the fix is saved, because it carries the error |
| `settings-chat-error-card` | `.c3-err` | the failed-reply card of the chat stub (`role="alert"`). **Critical** |
| `settings-chat-status-row` | `.c3-modelrow` | the inline status row of the chat stub (a model switch, the return from Settings) |

The detail rows of a connection (`settings-row`, slice 1) are used here too.

Critical in this slice: the unverified-model ask, delete a connection and remove a key (and every other dialog with a danger button), the 고치기 banner until its fix is saved, and the chat error card; the Undo toast after `conn-delete` (slice 2's toast).

State attributes added here: `data-bad` (`.bad`, `.c3-bad`), `data-needs-connection` (`.need`), `data-current` (`.cur`, the model in use) and `data-active` (`.act`, the cursor) on picker rows, `data-result` on the test result, `data-open` on the picker; the table is in the slice 1 appendix and in [theme.js](theme.js).
