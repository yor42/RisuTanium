# Settings & models slice 4: parameters

Status: **draft, revision 1** (2026-10-28). Task: [tasks/2026-10-26-settings-models.md](../tasks/2026-10-26-settings-models.md). Builds on [SLICE1_SPEC.md](SLICE1_SPEC.md) rev 2.1 (shell, rows, search, changed dot and 기본값으로), [SLICE2_SPEC.md](SLICE2_SPEC.md) rev 2.1 (live save, undo stack, locks) and [SLICE3_SPEC.md](SLICE3_SPEC.md) rev 2.1 (connections, picker, models page). Theme rules from the start: [THEMING.md](../THEMING.md) and DD-142 to DD-160.

Decisions in [DECISIONS-settings.md](DECISIONS-settings.md):
- **DS-079, scope:** the core sampling controls, plus a 고급 section for bias, additional parameters, custom flags and tools. Prompt authoring stays with Studio (DD-094).
- **DS-080, unsupported:** an unsupported row is dimmed with "이 모델은 안 써요 · 값은 그대로" and the model name. Its value is kept.
- **DS-081, explanation:** each row has a plain sentence, a low/high hint, its default and an expandable longer help. There are no quick styles.
- **DS-082, per-task parameters:**
  - Each task row on 모델 reads "매개변수: 주 모델과 같음 / 따로".
  - `seperateParametersEnabled` is retired.
- **DS-083, service samplers:** the Ooba, NovelAI and NovelList samplers use the same rows, in a group "이 서비스 전용". The group shows only for that connection.
- **DS-084, not sending:** a "보내기" switch. Off means "서비스 기본값 사용": the slider dims and keeps its value.
- **DS-085, out of range:** the value is kept, with "이 모델은 최대 {n}" and the fix "{n}으로 맞추기". Until it is fixed, requests use the maximum.
- **DS-086, reset:** 기본값으로 resets to the app default, and undo works. Parameter rows get the changed dot.
- **DS-087, reset target:** the values a preset made with + gets (`prebuiltPresets.OAI2`). Missing fields get neutral values: repetition penalty 1, min P 0, top A 0.
- **DS-088, output limit:**
  - The limit comes from model data (LiteLLM `max_output_tokens`) where it is known. With no data there is no output warning.
  - The 2048 cap is retired.
- **DS-089, 따로:** starts as a copy of the main values. Switching back to 같음 keeps the copy.

Earlier decisions that still bind:
- **Live write-through and undo** (DS-019, DS-024, DS-036, DS-037): live save; Ctrl+Z in lists, Alt+Z anywhere in Settings.
- **Locks** (DS-025): fields stored outside the preset; a "모든 프리셋 공통" badge.
- **Reset scope** (DS-010): reset only where a default is known.
- **Per-task models** (DS-044) and **routing options in the connection** (DS-059, DS-061).
- **Store-first** (DS-067): read the store by key at render time, hold no long-lived copies, keep unsaved text in drafts.
- **Korean register:** slice 1 §8. No particle directly after a user-chosen name (DS-038). Say "첫 메시지", never "greeting".

Research:
- [research/slice4-params.md](research/slice4-params.md): defaults, units, the -1000 sentinel, limits, service blocks, per-task parameters, help text;
- [research/today-settings.md](research/today-settings.md) §4.

Lane split: this lane owns the 파라미터 section, the per-task parameter editor and the parameter rows' search entries. Studio owns prompt templates, regex and module content (DD-094). The chat lane owns nothing here.

Marked **(design default)** = chosen here within the decided intent, open to veto.

## 0. Today (source-read; full anchors in research/slice4-params.md)

| Fact | § |
|---|---|
| Parameters render from a schema with the model as context. An unsupported control simply doesn't render, and its stored value stays. | today-settings §4 |
| Temperature and the frequency and presence penalties are stored as 0–200 and shown ×0.01. Reasoning effort is stored −1…3 and verbosity 0…2. | §1 |
| Three disagreeing "defaults" exist: load fallbacks, `presetTemplate` and OAI2 (what + clones). Settled by DS-087. | §1 |
| "Not sent" is the value −1000. The checkbox shows only on 9 disableable sliders. Re-enabling sets the slider to its minimum, so the old value is lost. | §2 |
| No per-model output limit exists, and max response is capped at 2048 for every model. Max context warns in red when it is over the limit, if that limit is known. | §3 |
| Ooba (8 sliders, 4 checks, stop words), NovelAI (14 sliders, starter, separator) and NovelList (7 sliders) blocks are hand-written with English labels and no help. NovelList has the mislabel "Reputation Penalty". | §4 |
| The Others tab holds bias (per preset), additional parameters (**global**), 24 raw custom-flag buttons (per preset), Search as the only tool (per preset) and module integration (per preset). | §5 |
| Per-task parameters sit behind one global checkbox. A task's own block replaces the main values entirely, and unset fields are left out. The per-task penalty sliders show the raw 0–200 value. | §6 |
| Help exists only for temperature (key `tempature`), bias, additional parameters and module integration. | §7 |

## 1. Where things live

- **모델·프리셋 › 파라미터** (`models.params`, the slice 1 placeholder) becomes the parameter page for the **active preset**. It shows the page header "{preset name}의 파라미터" (no particle after the name: "파라미터 · {preset name}") **(design default)**, with the main model's name and a link "모델 바꾸기" to the picker (slice 3).
- **Per-task parameters** are on the models page, beside each task row (§6). They open a sub-page `?page=models&section=models.models&view=taskparams&task=<memory|emotion|translate|otherAx>` with the breadcrumb 모델·프리셋 › 모델 › {task} 파라미터. Back returns to the task row.
- **고급** is a collapsible group at the end of 파라미터, closed by default. It holds bias, 추가 파라미터, 모델 기능 직접 지정 (custom flags), 도구 and 모듈 연동 (§5).
- **Search** (slice 1 §5) indexes every parameter row: its label, the raw API name (`temperature`, `top_p`, `max_tokens`…), synonyms in both languages, and every service sampler. A result for a dimmed row opens the row dimmed with its reason. A result inside the closed 고급 group opens the group.
- **Rows retired or moved:**
  - `models.sepParams` (the global checkbox): retired (DS-082).
  - `models.keepParamsOnSwitch`: stays in 프리셋 as the lock "기능별 파라미터 유지" (slice 2).
  - `models.bias`, `models.customFlags`, `models.modelTools` and `models.moduleIntegration`: move from the slice 1 placeholder rows into 고급 as real editors.
  - `models.addParams` and `models.applyAddParamsAll`: also move into 고급.

## 2. The 파라미터 page

### 2.1 Groups and order (design default)

1. **길이**: 최대 컨텍스트, 최대 응답.
2. **무작위성**: 온도, Top P, Top K, Min P, Top A.
3. **반복**: 반복 억제, 빈도 패널티, 존재 패널티.
4. **사고**: 추론 수준, 답변 길이 성향 (verbosity), Claude 사고 모드 / 사고 토큰 / 적응형 사고 수준, DeepSeek 사고 / 추론 수준. A row appears only when some catalog model uses it. Supported rows come first and unsupported ones are dimmed (§3.2).
5. **기타**: 시드.
6. **이 서비스 전용 · {service}** (§4): shown only when the main model's connection is textgen/Ooba, NovelAI or NovelList.
7. **고급** (§5), collapsed.

Within each group, rows the model doesn't use sort after the supported ones and are dimmed with the reason (DS-080). A group never collapses, even when nothing in it is supported (DS-094).

### 2.2 A parameter row (DS-081)

```
[label]   [changed dot]               [value field]  [보내기 switch]
plain sentence
낮을수록 …, 높을수록 …            기본값 1.00
[slider ─────●──────]
▸ 자세히   (expands the longer help, inline, not a popover)
```

- **Value:** a slider plus a number field that stay in step. The number field accepts typing, the arrow keys (one step) and PageUp/PageDown (ten steps). Values are shown in display units (temperature 0.00–2.00). The store keeps today's units, and the mockup shows the conversion in `__ss4` for checks.
- **Hint line:** "낮을수록 {low}, 높을수록 {high}" and "기본값 {value}" (the DS-087 value, in display units).
- **Longer help:** two or three sentences: what it does, when to change it, and how the providers differ. Today's temperature help is reused, with the `tempature` key typo fixed in the integration map.
- **Segmented rows** (reasoning, verbosity, thinking mode) have the same sentence, hint and help but no slider.
- **Row states, as `data-*` attributes on `settings-param-row`:**

  | Attribute | Meaning |
  |---|---|
  | `data-changed` | not the default |
  | `data-unsupported` | dimmed, with a reason |
  | `data-not-sent` | 보내기 off |
  | `data-over` | above the model's limit |
  | `data-locked` | under a lock |

### 2.3 Units and ranges (display)

| Row | Range, step | Default (DS-087) | 보내기 switch |
|---|---|---|---|
| 최대 컨텍스트 | 0 to the model's context limit (or 2,000,000 if not known), 1; number field only | 16000 | no |
| 최대 응답 | 0 to the model's output limit, or else to the context size; number field only | 1000 | no |
| 온도 | 0.00–2.00, 0.01 | 1.00 | yes |
| Top P | 0–1, 0.01 | 1 | yes |
| Top K | 0–100, 1 | 0 | yes |
| Min P, Top A | 0–1, 0.01 | 0 | yes |
| 반복 억제 | 0–2, 0.01 | 1 | yes |
| 빈도 / 존재 패널티 | 0.00–2.00, 0.01 (DS-090: stored 0–200 as today; per-task sliders and the NovelAI rows too) | 0 | yes |
| 추론 수준 | segmented, with the options the model's flags allow | 낮음 (today's 0) | no |
| 답변 길이 성향 | 짧게 / 보통 / 길게 | 보통 | no |
| 사고 모드 (Claude) | 끔 / 예산 / 적응형 | 예산 | no |
| 사고 토큰 | 0–64000, 200 | not set: shown as 보내기 off | yes |
| 적응형 사고 수준 | low…max | high | no |
| DeepSeek 사고 / 추론 수준 | 끔/켬 · high/max | 끔 · high | no |
| 시드 | integer; "무작위" when −1 | 무작위 | no; −1 already means unset |

The 보내기 switch appears on exactly the 9 rows that are disableable today (§2 of the research) **(design default)**.

## 3. Row behaviour

### 3.1 보내기 (DS-084)

- The switch is labelled "보내기" and is on by default. Off reads "서비스 기본값 사용" in place of the hint line. The slider and the number field dim but **keep their value**, and the value field is inert (`aria-disabled`, still focusable so its value can be read). **Editing is explained, not allowed (DS-096):** when someone drags the slider, types in the field, uses the arrow, PageUp/PageDown, Home or End keys, or presses a dimmed segmented control or switch on a row whose 보내기 is off (or that the model does not use), the value does not change and a short message is shown and announced: "{label}: 보내기를 켜면 바꿀 수 있어요" / "{label}: turn Send on to change it", or for a dimmed row "{label}: 이 모델은 안 써요 · 값은 그대로 · {model}". 보내기 is never switched on by itself.
- Turning it on again restores the kept value. This differs from today, where the value is reset to the minimum. The integration map notes the storage change (keep the value, add a `sent` flag).
- The change is live, undoable and announced: "온도: 서비스 기본값 사용".
- When a row is reset to its default, 보내기 turns back on.

### 3.2 Not used by this model (DS-080)

- The row stays visible and dimmed, with the line "이 모델은 안 써요 · 값은 그대로", and the model name in the accessible name and as a second line.
- The value field is read-only, and the row can still be focused and searched. Its changed dot still shows.
- Switching to a model that uses the row brings it back with its old value (fixture: `claude-sonnet-45` ↔ `gpt-5`).
- A custom flag that reveals a row (claudeThinking and the like, §5.3) counts as support. The reason line then names the flag: "모델 기능 직접 지정으로 켜짐".

### 3.3 Over the model's limit (DS-085, DS-088)

- **When it applies:** to 최대 컨텍스트 when the context limit is known, and to 최대 응답 when the output limit is known (limits come only from model data, DS-091). With no known output limit, a response longer than the preset's own 최대 컨텍스트 gets the context line instead ("최대 컨텍스트 {n}보다 길어요", fix "{n}으로 맞추기"; R4-5). With neither there is no warning.
- **What the row shows:**
  - "이 모델은 최대 {n}" in the warning colour, with `circle-alert`;
  - the button "{n}으로 맞추기";
  - the note "고칠 때까지 요청에는 {n}이 쓰여요".
  - The stored value stays.
- **The fix button:** applies the value, is undoable, and announces "최대 응답: {n}으로 맞췄어요".
- **The 모델 page:** its main-model row shows a small `circle-alert` "파라미터 확인" mark linking to the row **(design default)**.
- **Theme:** the warning line and its button are critical (`settings-param-warning`), because they affect what is sent.
- **Fixture:** a model with output limit 4096 and context 32768, while the preset has max response 8000.

### 3.4 Changed dot and 기본값으로 (DS-086, DS-087)

- **Changed dot and menu:** slice 1's pattern applies: a dot before the label, "기본값과 다름" in the accessible name, and 기본값으로 in the row's ⋯ menu (also right-click and Shift+F10).
- **Reset:** sets the DS-087 value and turns 보내기 back on. It is undoable, with a toast "기본값으로 되돌렸어요 · 실행 취소".
- **Group reset:** each group header has a ⋯ with "이 묶음 기본값으로", which is one undo step **(design default)**. There is no page-wide reset, because the preset's 복원 지점 (slice 2) covers that.
- **Under a lock:** a reset under a lock (§6.3) resets the shared value.

## 4. 이 서비스 전용 (DS-083)

Same row component, same explanation format. Labels are translated, and "Reputation Penalty" is corrected to 반복 억제 (NovelList). Ranges and defaults are today's (research §4).

- **textgen / Ooba** (when the main model's connection is textgen or a local server):
  - sliders: 반복 억제, 길이 패널티, Top K, Top P, Typical P, Top A, 반복 n-gram 금지 크기;
  - switches: 샘플링 사용 (do_sample), 시작 토큰 넣기 (add BOS), 끝 토큰 막기 (ban EOS), 특수 토큰 건너뛰기;
  - a list editor **멈춤 문자열** (`localStopStrings`). It is global today, so it carries the badge "모든 프리셋 공통" **(design default: keep global)**.
  - The chat format stays in the connection (DS-059).
- **NovelAI:**
  - text rows: 시작 문자열 (starter) and 구분 문자열 (separator);
  - sliders: Top P, Top K, Top A, Tail-free, Typical P, 반복 억제, 반복 억제 범위, 반복 억제 기울기, 빈도 패널티, 존재 패널티, Mirostat 학습률, Mirostat 타우, CFG 배율.
  - Mirostat and CFG have no default today, so they show 보내기 off and "기본값 없음 · 서비스 기본값" **(design default)**.
- **NovelList:** Top P, 반복 억제, 반복 억제 범위, 반복 억제 기울기, Top K, Top A, Typical P.
- **Where the rows sit:** the group header names the service and its connection, e.g. "이 서비스 전용 · NovelAI (내 NovelAI)". If the main model's connection changes, the group changes or disappears. Its values stay in the preset.
- **No 보내기 switch:** service rows don't have one, except the NovelAI rows with no default, because today's request sends them all **(design default)**.

## 5. 고급 (DS-079)

### 5.1 편향 (bias)

- **Table:** rows of text and a number from −101 to 100. −100 means "거의 안 나와요", 100 means "자주 나와요", and −101 means "금지 (일부 모델)".
- **Rows:** add a row, delete a row with undo, and reorder is not needed.
- **Import / export:** JSON. Import shows a preview first ("{n}개 항목으로 바꿀까요?") instead of silently replacing everything.
- **Help:** the help reuses `help.bias` and adds the tokenizer warning.
- **Empty state:** "편향 없음 · 추가".

### 5.2 추가 파라미터

- **Rows:** key/value rows.
- **Value prefixes:** `header::` (as a request header), `json::` (a JSON value) and `{{none}}` (removes the key). The table shows them as a type chip next to the key: 헤더 / JSON / 지우기 / 값, chosen from a select instead of typed prefixes. The stored form is unchanged **(design default)**.
- **Scope:** it is **global** today. The group shows "모든 프리셋 공통", and the switch "모든 모델에 적용" (`applyAddParamsAll`) sits under the table.
- **Validation:** an invalid JSON value is marked inline and is still saved as typed (it is a draft until it parses). Keys that duplicate a core parameter warn: "온도는 위의 '온도' 행으로 바꾸는 게 좋아요".

### 5.3 모델 기능 직접 지정 (custom flags)

- **Master switch:** "모델 기능 직접 지정" (`enableCustomFlags`) with the line "모델이 지원하는 기능을 직접 정해요. 잘못 켜면 요청이 실패할 수 있어요."
- **Flag list:** when the switch is on, the 24 flags appear as switches with translated names and one line each, grouped into 입력 (이미지·오디오·동영상), 출력, 메시지 형식, 사고 and 기타. Each switch shows the raw enum name as a secondary label for experts.
- **Flags that reveal rows:** these show which row they reveal, e.g. "켜면 '사고 모드'가 보여요".
- **Default display:** flags start in the model's own state (read from the catalog) **(design default)**.

### 5.4 도구

- **One switch:** "검색" (`modelTools` includes 'search').
- **Help:** "모델이 웹 검색 도구를 쓸 수 있게 해요. 도구를 지원하는 모델에서만 동작해요."
- **Unsupported models:** dimmed as in DS-080.

### 5.5 모듈 연동

- **Field:** the text field of module namespaces (`moduleIntergration`), with the existing help.
- **Why it's here:** it is per preset and sits beside parameters today. Its content is Studio's, but the field stays here **(design default)**.

## 6. Per-task parameters (DS-082, DS-089)

### 6.1 On the models page

- **Line under each task row:** each of 장기 기억, 번역, 감정 이미지 and 기타 (slice 3 §4.1) gets a second line, "매개변수: 주 모델과 같음" or "매개변수: 따로 · 주 모델과 다른 값 {n}개" ("… 같은 값" when none differs). It is a two-way radiogroup (같음 / 따로; the arrows move the focus, Space or Enter chooses) with a "편집" button when it is 따로. While a task is 같음 its sub-page (deep link included) shows the kept values read-only with the reason and a "따로 정해서 쓰기" button (R4-8).
- **같음 → 따로:** copies the main preset's current values into the task (DS-089), opens the sub-page, and announces "장기 기억 매개변수를 따로 정해요". This is one undo step.
- **따로 → 같음:** keeps the task's copy (hidden) and uses the main values. Switching to 따로 again brings the copy back. The toast reads "주 모델과 같게 바꿨어요 · 따로 정한 값은 남아 있어요".

### 6.2 The task sub-page

- **Rows:** the same rows and groups as §2, restricted to today's per-task fields: 온도, Top P, Top K, Min P, Top A, 반복 억제, 빈도 / 존재 패널티, 추론 수준, 답변 길이 성향 and the 사고 rows. There is no length, seed, service or 고급 group.
- **Model support:** rows are judged by the **task's** model. That is its own model if set, or else the model it inherits as "주 모델과 같음" (slice 3 O-1 resolution). Unsupported rows are dimmed as in DS-080. This fixes today's seven ungated sliders.
- **Units:** the penalties use the same display units as the main page (fixes the raw 0–200 display).
- **Defaults:** the default of a task row is the DS-087 value. Each row also shows "주 모델: {value}" when its value differs from the main one **(design default)**.
- **Page footer:** "주 모델 값으로 맞추기" copies the main values again, with undo.

### 6.3 Locks

- The slice 2 lock "기능별 파라미터 유지" now applies to the per-task choice (같음/따로) and the task values.
- While it is on, the task lines show the "모든 프리셋 공통" badge, and edits change the shared values.

## 7. Store-first (DS-067)

The mockup keeps one synthetic store: `presets[id].params`, `presets[id].taskParams[task] = {mode, values}`, `globals.additionalParams`, `globals.localStopStrings` and `globals.seed`. Rows read by key at render time. Number fields hold typed text in a draft until it parses. Then the store is written and the row re-renders from it. The derived states (unsupported, over the limit, changed) are computed at render time, never cached in the row.

## 8. Keyboard, motion, accessibility

- **Slider:** `role="slider"` (native range), with `aria-valuetext` in display units ("온도 1.00").
- **Number field:**
  - linked by `aria-describedby` to the hint and the warning;
  - the arrow keys, PageUp/PageDown and Home/End work on both the slider and the field;
  - Enter commits typed text;
  - Esc restores the last committed value (it does not close Settings while a draft is open).
- **Switches:** native checkboxes with `role="switch"`. "보내기" includes the row label in its accessible name.
- **Dimmed rows** are announced: "온도, 이 모델은 안 써요, GPT-5, 값 1.00 그대로".
- **Group headers** are `h3`. The collapsed 고급 is a disclosure button with `aria-expanded`.
- **Back stack:** 1 dialog or menu, 2 the bias import preview, 3 the task sub-page, then slice 3's order.
- **Motion:**
  - expand and collapse use height plus opacity at the token durations;
  - reduced motion is a 120 ms crossfade;
  - low power is instant;
  - a slider thumb never animates while it is dragged.
- **Targets:** 44 dp on touch. On phones the slider gets a full-width row under the label, and the number field gets `inputmode="decimal"`.
- **Forced colours:** the changed dot, the not-sent and dimmed states and the warning keep borders and text, not only colour.

## 9. Integration map (Lane A; nothing here edits these files)

| Change | Where |
|---|---|
| A parameter schema gets `group`, `default` (DS-087, OAI2 plus neutral fills), `displayScale`, `hintKey`/`helpKey` and `sendable`. Retire the 2048 max-response cap. | `botSettingsParamsData.ts`, `types.ts:71` |
| "Not sent" keeps the value. The −1000 sentinel becomes a separate flag per parameter (e.g. `paramsOff: Set<string>`), and the request check reads the flag. Migration: a stored −1000 becomes off plus the DS-087 default. | `SliderInput.svelte:13-25`, `shared.ts:338-340`, `prompt.ts:358` |
| A per-model output limit from the LiteLLM data (`max_output_tokens`), plus a request clamp to the known limit while the stored value is over it. | `modelDataService.svelte.ts:148-155`, `litellmData.ts`, `request.ts:503,853,933`, `google.ts:338` |
| Per-task mode `{memory,emotion,translate,otherAx}: 'same' | 'own'`. Retire `seperateParametersEnabled` (migration: on → every task with a non-empty block becomes 'own'). Request: 'same' uses the main values, 'own' uses the block. | `database.svelte.ts:589-597,1337-1354`, `shared.ts:181-195` |
| Per-task penalty units fixed (×0.01 display). Sliders gated by the task's model. | `AllSeperateParameters.svelte:72-98` |
| Service samplers move from hard-coded markup to schema rows with label keys and help. NovelList label fixed. | `BotSettings.svelte:505-620` |
| Bias import preview; additional-parameter type chips; translated custom flags. | `BotSettings.svelte:638-789` |
| Strings: about 120 new keys (labels, hints, help, reasons). `help.tempature` renamed with an alias. | `src/lang/en.ts`, `ko.ts` |
| ENGINE_CHANGES.md gains items 4-1 to 4-6 when this slice closes. | this lane |

## 10. Korean copy (proposed, ko / en)

| Key | ko | en |
|---|---|---|
| paramsTitle | 파라미터 · {preset} | Parameters · {preset} |
| groupLength / Random / Repeat / Think / Other / Service / Advanced | 길이 / 무작위성 / 반복 / 사고 / 기타 / 이 서비스 전용 / 고급 | Length / Randomness / Repetition / Thinking / Other / This service only / Advanced |
| send | 보내기 | Send |
| notSent | 서비스 기본값 사용 | Use the service default |
| unsupported | 이 모델은 안 써요 · 값은 그대로 | This model doesn't use it · value kept |
| overMax | 이 모델은 최대 {n} | This model allows up to {n} |
| fitTo | {n}으로 맞추기 | Set to {n} |
| overNote | 고칠 때까지 요청에는 {n}이 쓰여요 | Until you change it, requests use {n} |
| hintLowHigh | 낮을수록 {low}, 높을수록 {high} | Lower: {low}. Higher: {high} |
| defaultIs | 기본값 {v} | Default {v} |
| more | 자세히 | More |
| taskSame / taskOwn | 매개변수: 주 모델과 같음 / 매개변수: 따로 · 주 모델과 다른 값 {n}개 (0개: 매개변수: 따로 · 주 모델과 같은 값) | Parameters: same as main / Parameters: own · {n} differ from main (0: Parameters: own · same values as main) |
| groupReset | 이 묶음 기본값으로 | Reset this group |
| temperature (sentence / low / high) | 답변이 얼마나 다양할지 정해요 / 일관되고 | 다양해요 | How varied replies are / steadier | more varied |
| topP | 다음 단어를 고를 후보의 폭이에요 / 안전한 단어만 | 폭넓게 | How wide the pool of next words is / safe words only | wider |
| repetition | 같은 말을 되풀이하지 않게 해요 / 덜 막고 | 더 막아요 | Discourages repeating itself / allows more | blocks more |
| maxResponse | 한 번에 쓸 수 있는 답변 길이예요 (토큰) | How long one reply may be (tokens) |
| maxContext | 모델에 보낼 수 있는 전체 길이예요 (토큰) | How much may be sent to the model (tokens) |

The builder writes the rest in the same register: one plain sentence, then "낮을수록 …, 높을수록 …" (or "끄면 …, 켜면 …"). The translator agent reviews the full table before review.

## 11. The mockup

### 11.1 Files

- **New files:** `settings/slice4.html`, `slice4.css`, `slice4.js` and `data4.js`.
- **Loading:** it loads slices 1–3 and extends them through `window.SS1_EXT` and the slice 2/3 hooks.
- **Earlier slices:** slice 1–3 files may get hooks. If they change, **ss1, ss2, ss3 and th stay green**.
- **Data:** synthetic only. The 보낼 값 보기 panel (§11.4) shows an estimate of what would be sent. There is no network.

### 11.2 Fixtures (`?set=`)

| Set | Contents |
|---|---|
| `demo` | slice 3's demo; the active preset on Claude Sonnet 4.5 with temperature 1.20 (changed), top P off (not sent), max response 8000; catalog models with output limits (Claude 64000, GPT-5 128000, `small-4k` 4096, unknown for local); per-task: 장기 기억 따로 (2 changes), 번역 같음 with a kept copy; bias 3 rows; additional params 2 rows (one header); custom flags off |
| `service` | main model on 내 NovelAI; second preset on textgen; third on NovelList |
| `over` | main model `small-4k` with max response 8000 and context 32000 over a 16384 limit |
| `empty` | every parameter at its default, no bias, no additional params |

### 11.3 States (`?state=`)

- **Page:** `pa-page`, `pa-dim-gpt5` (switch to GPT-5: dimmed rows), `pa-not-sent`, `pa-over`, `pa-over-fixed`, `pa-help-open`, `pa-changed-reset`, `pa-group-reset`, `pa-locked`.
- **Service:** `sv-novelai`, `sv-textgen`, `sv-novellist`.
- **고급:** `ad-closed`, `ad-bias`, `ad-bias-import`, `ad-addparams`, `ad-flags`, `ad-tools`.
- **Per-task:** `tk-models-lines`, `tk-own-new` (just switched to 따로), `tk-own-page`, `tk-same-kept`, `tk-locked`.
- **Search:** `se-param` (`q=temperature`), `se-dimmed`, `se-advanced`.
- **Parameters:** slice 1's (`lang`, `w`, `reduced`, `lowpower`, `theme`). The page sets `window.__ss4Ready` and exposes `window.__ss4`.

### 11.4 보낼 값 보기 (a product panel, DS-095)

A "보낼 값 보기" panel (closed by default) at the end of the page lists the body keys a request to the main model would carry, in API units. It is an **estimate**: the first line of the panel says so ("예상이에요 · 실제 요청과 똑같지는 않을 수 있어요" / "An estimate · the real request may differ"), and nothing in it claims to be the exact request. It is built from the same send rules as the page, not captured from a real request (the integration builds it from the app's own send rules). It shows only what the page's values would send:
- not-sent rows are left out of the body, and listed under "보내지 않는 값" as "보내기가 꺼져 있어요";
- unsupported rows (and a bias table or tool the model cannot take) are left out and listed as "이 모델은 안 써요";
- an over-limit value is replaced by the limit (the model limit, or the context size when no output limit is known) and the cut is listed;
- thinking is never "enabled" without a budget (R4-14): with 사고 토큰 not sent, thinking stays off and the list says "사고 토큰을 보내지 않아서 사고를 켜지 않아요";
- additional parameters are merged; one whose JSON does not read is left out and listed ("JSON이 올바르지 않아요"); a random seed is shown as "seed": "random", not dropped.

Parts: `settings-param-preview` (the panel, reach tier), `settings-param-estimate` (the estimate label) and `settings-param-leftout` (the list), both protected so a pack cannot hide them. A bias editor the model cannot take is dimmed, read-only, and explains an attempted edit like any dimmed row (R4-16, DS-096). Provider-specific request shapes are not modelled; that is why it is an estimate.

### 11.5 Checks

Suite `ss4` in `settings/checks/`, extending `run.mjs` under COST_ROUTING.md "Mockup checks: parallel first" and `checks/speed-pass.md`:
- **Budget:** about 90 s wall at 3 workers, at most 3 Chrome workers, one per worker. Own profiles, deleted afterwards. Never stop the server on 6141. Studio's slice 4 runs at the same time, so stay at 3 workers.
- **Sharding:** by state, width and language. No fixed sleeps. Write a `.timing.json` with `slowest5`.
- **Coverage:** KO and EN, at widths 360 / 412 / 768 / 1024 / 1280.

| Section | Covers |
|---|---|
| rows | Order and groups, sentence + hint + default + help per row, slider↔field sync, display units vs the stored value, keys (arrows, PageUp/PageDown, Home/End, Enter, Esc) |
| send | The 9 switchable rows exactly, off keeps the value, on restores it, dimming, announcement, undo, the estimate leaves the key out and lists it, reset turns send back on, the explain-only message on an edit (DS-096) |
| support | DS-080 dimming on a model switch and back, the reason with the model name, a value kept across switches, flag-revealed rows, DS-094 no group ever collapses, dimmed bias (R4-4) |
| limit | DS-085/088/091 warning for known limits only (model data only, no fallback table), the context check for a response longer than the context when no output limit is known (R4-5), the fix button and undo, the estimate uses the limit, no warning for unknown limits, the models-page mark |
| reset | Changed dot on every row, 기본값으로 to the DS-087 values (including the neutral fills), group reset as one undo step, reset under a lock |
| service | The three groups appear only for their connection, translated labels, ranges and defaults, NovelList label fixed, stop strings global badge |
| advanced | Bias (add, delete with undo, import preview, ranges), additional-param chips and validation, flags switch + grouped flags + reveal note, tools, module field |
| task | Same/own lines, the copy on 따로 (DS-089), kept copy on 같음, sub-page rows gated by the task model, penalty units, "주 모델 값으로 맞추기", lock badge |
| store | DS-067: rows re-read the store after an external write (`__ss4.storeWrite`), drafts don't leak into the store until they parse |
| search | Parameter results incl. API names, dimmed results, opening the closed 고급 |
| a11y/modes | Roles and names, Back order, reduced motion / low power, forced colours, 200 % text, 44 dp |
| th | Parts and critical marks for the new parts; extend the th suite's rendered contrast, ring pixels and sweep with the ss4 states (keep th's wall under 150 s) |
| koen, stills, console | As slices 1–3 |
| ss1, ss2, ss3 regression | Full re-runs if their files changed |

The builder lists the five slowest sections in `checks/builder-checks-ss4.md`.

## 12. Open questions

- **O-1, seed scope:** settled by DS-093: the seed stays global, with the "모든 프리셋 공통" badge. No question left.
- **O-2, request preview:** settled by DS-095: the panel is part of the design, "보낼 값 보기", labelled an estimate (§11.4). No question left.
- **O-3, penalty display range:** settled by DS-090: both penalties stay 0–2.00 (stored 0–200), per-task sliders included. No question left.

## 13. Design defaults to confirm

- Group order (§2.1); group reset; no page-wide reset. (Collapsing all-unsupported groups was removed by DS-094.)
- 보내기 only on today's 9 disableable rows; service rows have no 보내기, except NovelAI's undefaulted rows.
- Stop strings and additional params stay global, with a badge.
- Additional-param type chips instead of typed prefixes (stored form unchanged).
- Custom flags start in the model's own state; raw enum names as secondary labels.
- 모듈 연동 stays in 고급.
- Task rows show "주 모델: {value}" when they differ.

## Appendix: Parts (theme readiness, DD-142 to DD-159)

Filled by the builder (2026-10-28), extended in fix round 1 and the final round (26 names now) from `slice4.js`; `checks/th4/parts.mjs` reads this table and fails if the page carries a name that is not listed here or in the slice 1 to 3 appendices, if an element carrying a name does not match the Selector, or if a name is never seen. Slice 4 adds **26 names**; the page also uses `settings-section`, `-rows`, `-row`, `-toggle`, `-segmented`, `-row-description`, `-page-header`, `-button` and the dialog parts of slices 1 to 3. Rows marked **protected** carry `data-part-critical` (DS-097): a pack cannot name them, so cannot hide them.

| Part | Selector | Notes |
|---|---|---|
| `settings-param-page` | `.p4`, `.p4-taskpg` | the body of the 파라미터 section, and the per-task sub-page (`data-view="task"`, `data-task`); `data-svc` names the service of the main model |
| `settings-param-header` | `.p4-top` | "파라미터 · {preset}", the main model and 모델 바꾸기 |
| `settings-param-group` | `.p4-grp[data-group]` | one group (길이, 무작위성, 반복, 사고, 기타); a group never collapses (DS-094) |
| `settings-param-row` | `.p4-row` | one parameter row and each 고급 editor row; `data-changed`, `data-unsupported`, `data-not-sent`, `data-over`, `data-locked`; `data-p4row` is the parameter key |
| `settings-param-label` | `.p4-label` | its label; **protected** (R4-15: the only name a row has) |
| `settings-param-hint` | `.p4-hint` | the low/high line with the default, or "서비스 기본값 사용" when not sent; **safe: a pack may move or restyle it** |
| `settings-param-help` | `.p4-help` | the longer help (inline, hidden until 자세히); **safe** |
| `settings-param-slider` | `.p4-range` | the native range input |
| `settings-param-field` | `.p4-field`, `.p4-text`, `.p4-stopin`, `.p4-bt-text`, `.p4-bt-num`, `.p4-ap-key`, `.p4-ap-val`, `.p4-ap-type`, `.p4-modin` | the number field (role spinbutton) and the text cells of the editors; **protected** (DS-097) |
| `settings-param-send` | `.p4-sendbox` | the 보내기 switch with its word; **protected** (DS-097) |
| `settings-param-warning` | `.p4-warn:not(.flagwarn)` | the over-limit line with its fix and note; **critical** |
| `settings-param-fix` | `.p4-fit` | the "{n}으로 맞추기" button inside the warning: a protected child with a name of its own; **critical** |
| `settings-param-reason` | `.p4-reason` | "이 모델은 안 써요 · 값은 그대로" with the model name, or "모델 기능 직접 지정으로 켜짐"; **protected** (DS-097) |
| `settings-param-badge` | `.p4-shared`, `.p4-lockchip` | the "모든 프리셋 공통" badge of a global row and of a locked task line; **protected** (DS-097) |
| `settings-param-advanced` | `.p4-adv` | the 고급 group (disclosure button in an h3, the five editors); `data-open` / `data-closed` |
| `settings-param-preview` | `.p4-pv` | the 보낼 값 보기 panel (DS-095); `data-open` / `data-closed` |
| `settings-service-group` | `.p4-svc` | "이 서비스 전용 · {service} ({connection})"; `data-svc` is `ooba`, `novelai` or `novellist` |
| `settings-bias-table` | `.p4-bt` | the bias rows (text, number, delete) |
| `settings-addparam-table` | `.p4-apt` | the additional-parameter rows (key, type, value, delete) |
| `settings-flag-list` | `.p4-flags` | the 24 custom flags in five groups; reach tier (R4-15: restyled, not hidden) |
| `settings-task-mode` | `.p4-taskline` | the "매개변수: 주 모델과 같음 / 따로" line under a task row on the models page; `data-task`, `data-mode`; `data-shared` while 기능별 파라미터 유지 is on |
| `settings-param-send-switch` | `.p4-sendbox .sw` | the switch inside the 보내기 box (a part of its own so the box can be protected without a safe leaf inside it); **protected** (DS-097) |
| `settings-param-estimate` | `.p4-estimate` | the first line of the 보낼 값 보기 panel: "예상이에요 · 실제 요청과 똑같지는 않을 수 있어요"; **protected** (DS-095: it must not be hidden) |
| `settings-param-leftout` | `.p4-left` | the "보내지 않는 값" list of the panel (not sent, unsupported, thinking without a budget, a JSON that does not read, cuts); **protected** (R4-15: it carries the DS-095 "with why") |
| `settings-param-models-mark` | `.p4-checkmark` | the 파라미터 확인 mark under the main model on the models page (R4-11); **critical** |
| `settings-param-flags-note` | `.p4-warn.flagwarn` | the always-present "잘못 켜면 요청이 실패할 수 있어요" line of the custom-flags editor (R4-11); **critical** |

Critical in this slice (`data-part-critical`):
- the over-limit warning (`settings-param-warning`) with its fix button (`settings-param-fix`), the 파라미터 확인 mark on the models page (`settings-param-models-mark`) and the custom-flags note (`settings-param-flags-note`);
- the protected parameter parts of DS-097 and R4-15: `settings-param-send` and the switch in it (`settings-param-send-switch`), `settings-param-reason`, `settings-param-badge`, `settings-param-field`, the row label (`settings-param-label`), the estimate label (`settings-param-estimate`) and the left-out list (`settings-param-leftout`). A pack cannot name them; `--param-dim-opacity` and `--param-warn-bar` have floors (below);
- the bias import preview dialog (`settings-dialog`, it replaces data) and every dialog with a danger button.

Safe leaves (never critical, never inside or holding a critical element): `settings-param-header`, `-hint`, `-help`, `-slider`. Why these may be hidden: the number field (protected) always carries the value, the 보내기 switch (protected) the state and the reason line (protected) the explanation; the slider is a second way to set the same value, the hint repeats what those say, and the help is optional long text. `settings-flag-list` is in the reach tier (it holds the switches that change what the service is told the model can do: restyle, not hide). `settings-param-page`, `-group`, `-row`, `-advanced`, `-preview`, `settings-service-group`, `-bias-table`, `-addparam-table` and `-task-mode` hold a critical element, so they are in the reach tier too.

State attributes as in §2.2: `data-changed` is mirrored from `.changed` by theme.js (nothing new there); `data-unsupported`, `data-not-sent`, `data-over` and `data-locked` are written by the row template in `slice4.js` (not in theme.js, so slices 1 to 3 and their `th` suite are untouched; the integration moves them into the one mirror table). `data-open` / `data-closed` on 고급 and the preview are written the same way. `th4` checks that each one is on exactly the rows in that state.

New role tokens (declared at the top of `slice4.css`, read only through `var()`; the main session merges them into `theme-tokens.css`): `--param-dim-opacity` (the controls of an unsupported or unsent row), `--param-field-width` (the number field), `--param-enter-offset` (the slide of an opening panel), `--param-warn-bar` (the bar of an over-limit row and warning), `--param-dim-bar` (the dashed bar of an unsupported row), `--param-pre-max-height` (the preview scrolls after this), `--param-list-gap` and `--param-key-width` (the cells of an editor row). Everything else reads the existing ladder and `--nexus-*` tokens.

The pack registry (`checks/th/packlint-settings.mjs`) is left as it was; `checks/th4/registry4.mjs` adds the new names to its lists (critical: the warning, the fix button and the DS-097 protected parts and estimate; the safe leaves above) and the **floors** (`minimums`, chat DD-182/DD-187): `--param-dim-opacity` 0.4 (the app's own disabled opacity, so the controls of a dimmed row stay visible) and `--param-warn-bar` 2px (the smallest bar at which the over-limit warning still shows an edge). `--nexus-field-border` has no floor, only its contrast check. A pack that sets either token below its floor is rejected with "below the critical minimum". The main session lifts the names and `MINIMUMS4` into `packlint-settings.mjs` when slice 4 is integrated.

## Build notes

Built in `slice4.html/.css/.js`, `data4.js`, checks in `checks/ss4` and `checks/th4`. Notes by the builder, not a review. Fix round 1 (2026-10-28) applied the independent review (`reviews/slice4-review.md`, R4-1..R4-14) and the maintainer's DS-090..DS-097; the mapping of each item to a check id is in `checks/builder-checks-ss4.md` ("Fix round 1").

- Slices 1 to 3 JS/CSS are untouched; slice 4 attaches through the `SS1_EXT` hooks. `checks/run.mjs` gained the `ss4` and `th4` suites and `themes/banana-cocoa.css` gained the slice-4 part rules.
- Additions beyond the decisions: a visible `.p4-lockchip` (slice 3 hides slice 2's chip inside its groups); `settings-param-fix` is its own part so the fix button is not styled as part of the warning; dimming applies to the controls only (the text keeps contrast); hidden state rows (`models.send.*`, `models.task.*`) are kept out of search; the models page "later" banner is removed; deep link `?view=taskparams&task=...` for the per-task sub-page; slider store writes are coalesced to 150 ms in low power. The first-round −2..2 penalty range and the collapsed all-unsupported groups were removed (DS-090, DS-094).
- Fixtures: a `small-4k` model (output 4,096, context 16,384) for the over-limit state, 18 parameters, 33 service rows (Ooba 11, NovelAI 15, NovelList 7), 24 custom flags. The states `ad-bias` and `ad-bias-import` use GPT-4o (it takes a bias table); on the demo's Claude the bias editor is dimmed (R4-4), visible in `ad-addparams`.
- th4 is separate from `th` (th is about 133 s; adding th4 would pass 150 s). The pack registry is extended only in `checks/th4/registry4.mjs` (24 names, 8 critical/protected, the floors `MINIMUMS4`); merge into `packlint-settings.mjs` at integration.
- For the main session to merge: the eight `--param-*` tokens into `theme-tokens.css`, the `data-unsupported/-not-sent/-over/-locked/-open/-closed` attributes into the one mirror table, the 24 parts and the two token floors into the registry, and the estimate rule: the 보낼 값 보기 panel is built from the app's own send rules, not captured from a real request.
- No open product questions remain from slice 4 (DS-090..DS-097 settled them). Not verified: floor devices, screen readers, other engines, full-page repaint cost of a flag switch on the floor (R4-10, unmeasured); see `checks/builder-checks-ss4.md`.
