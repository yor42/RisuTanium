# Guided persona builder (CHORE-326)

Status: **approved, revision 1** (2026-11-27). The maintainer accepted all six recommendations in §9 (MC-4530 to MC-4535). Ticket: yor42/RisuTanium #252. Decision: MC-2141 (a persona builder design is added to the personas work). Extends [SLICE5A_SPEC.md](SLICE5A_SPEC.md) §3 (the personas page, DS-110, DS-111). No application code changes until this is approved.

## 1. What it is

A short, optional walk-through that helps a person who does not know what to write produce a persona. It ends in the same record the editor writes: `name`, `icon` and `personaPrompt` of one `RisuPersona` entry (`note` only when the advanced persona note is on). It adds no field, no stored draft and no new file format. Everything it makes can be edited afterwards in the ordinary editor, which stays the place for experts and for every later change.

Out of scope: writing the description with a model (it would send the person's text to a provider from a settings page, and needs a connection the person may not have), per-character personas (SLICE5A O-1), and the first-run persona step (STARTUP_AND_ONBOARDING §3), which stays as it is.

## 2. Facts the design rests on

- A persona is `{ name, icon, personaPrompt, id?, note?, largePortrait?, embeddedModule? }` (`RisuPersona`, `database.svelte.ts`). These fields are the upstream shape too, so a builder that writes only `name`, `icon`, `personaPrompt` and `note` keeps `.bin` and PNG-card export lossless (MC-175).
- The description is `personaPrompt`. It reaches the prompt through `risuChatParser` (`process/index.svelte.ts`), so `{{char}}`, `{{user}}` and other CBS tags work in it.
- Today's editor (`SettingsShell/PersonasShellPage.svelte`) writes live through `createPersona` and `editPersona` (`ts/personaList.ts`), which keep the mirror fields (`db.username`, `db.personaPrompt`, `db.userIcon`) in step for the active persona. The builder must use those same calls, so the mirror and dirty tracking behave exactly as today.
- The picture picker `selectUserImg(id)` writes an asset and sets `icon` on an existing persona. It cannot return an image for a persona that does not exist yet.
- A new persona is not made active by creating it; "사용하기" is a separate action (SLICE5A §3.1, §3.2). The builder keeps that.

## 3. Entry points

- The "+ 페르소나" menu on the personas page gets a middle item: **새로 만들기** (blank, as today), **안내받아 만들기** (this builder), **가져오기** (PNG).
- No new top-level page and no new settings-search entry beyond the item name.
- The builder is not offered at first run or inside chats.

## 4. Flow

Three steps and a result. Each step is one screen on a phone, has "다음" and "이전", and every step can be left empty: nothing is required to finish (SLICE5A §3.2 already allows an empty name and description).

| Step | Title (EN) | Sets | Content |
|---|---|---|---|
| 1 | Who are you? | `icon`, `name` | The portrait button (opens the PNG picker, same as the editor), then the name field. The placeholder is the "New persona" default. No "큰 초상화" switch here; it stays in the editor. |
| 2 | Tell characters about you | the description text | Four short optional fields, one line of helper text each (§5). |
| 3 | Check and finish | `personaPrompt`, `note` | The composed text in an editable textarea with the character count. The note field appears only when the advanced persona note is on. "만들기" ends the builder. |

The step rail is "단계 2/3" text plus the step title, as on the onboarding phone layout; it is not a row of dots. The step heading takes focus on each step (the onboarding step contract).

### 4.1 Android first (phone, below 768 px)

- The builder replaces the list, as the editor does when a card is chosen (the drilled view), with the page title "안내받아 만들기" and a sticky footer holding "이전" and "다음" (44 px touch targets, `min-h-11`).
- The system back gesture and the on-screen back go one step back; on step 1 they leave the builder. The page's existing back handler registration is reused (`registerBackHandler`).
- Single-line fields advance on Enter, after the IME composition has ended (the onboarding `createEnterKeyController` rule), so Korean composition is never cut off. Multi-line fields never advance on Enter.
- The soft keyboard must not hide the focused field or the footer: the fields scroll into view above the keyboard.
- Nothing needs a hover or a pointer drag.

### 4.2 Wide screens (1024 px and up)

The list stays on the left; the builder takes the editor's place on the right with the same three steps. Below 1024 px the drilled view applies.

## 5. Step 2 fields and the composed text

Four optional single-purpose fields, each a short text area (about 3 lines) with the example text as a placeholder, not as a value:

| Field label (EN) | Helper |
|---|---|
| Appearance | "What a character would notice first." |
| Personality | "How you act and what you care about." |
| Background | "Where you come from, what you do." |
| Anything else | "How you talk, what you want from the story, things to avoid." |

On "다음" from step 2 the answers are joined into the step 3 text, one line per filled field, in this order, empty fields left out:

```
Appearance: <text>
Personality: <text>
Background: <text>
<text of "Anything else">
```

The labels are the UI language's words (the person writes in that language too); "Anything else" has no label line. The name is not repeated in the text: `{{user}}` and the name field already carry it. The text is an ordinary string the person owns: from step 3 on it is edited directly, and nothing remembers which field a sentence came from. Going back to step 2 and changing a field recomposes the text only if step 3's text has not been hand-edited; if it has, "다음" asks "직접 고친 내용을 바꿀까요?" with "바꾸기" and "그대로 두기".

Why labelled lines and not prose: they stay readable to the person editing later, and the model reads them without a rewrite. Why no generated sentences ("{{user}} is a ..."): it would add words the person never wrote.

## 6. How it ends in the existing record

The persona is created **when the builder opens**, as "새 페르소나" with `createPersona`, and every step writes it live through `editPersona` and `selectUserImg(id)`, exactly like the editor (DS-111, DS-067). Reasons: the picture picker needs an existing persona; no draft, no orphan asset and no asset-lifecycle change is introduced; a killed app leaves a valid, partly filled persona, the same as a person who opened "새로 만들기" and typed half a name.

- Step 1 writes `icon` (via the picker) and `name` as the person types.
- `personaPrompt` is written when the person leaves step 2 ("다음") and then live while editing step 3. Until then it is `''`.
- "만들기" writes nothing more: it closes the builder and opens the finished persona in the editor, not active. A line under the button says "쓰려면 '사용하기'를 누르세요" (see Q3).
- "취소" (or back on step 1) on a persona still untouched is removed through the normal delete path with its undo toast. On a persona the person has already filled in, the builder asks "이 페르소나를 지울까요, 남길까요?" with "지우기" (delete with undo) and "남기기" (keep as it is, open in the editor).
- Undo: the creation is the existing "persona create" list action (the page's undo stack, DS-024); the builder adds no other undo step.

No new persisted field, no migration, no change to export or import (`buildPersonaCard` already carries the fields written).

## 7. Strings, accessibility, theme

- New `en.ts` keys (builder title, step titles, "Step n of 3", the four labels and helpers, the two confirms, "Create", "Back", "Next") ship with the other 7 locales in the building PR (MC-058).
- Every field has a visible label tied to its input; the step heading is an `h2` that takes focus; progress is text, not colour. Buttons and rows use the theme tokens (`darkbutton`, `darkborderc`, `textcolor2`), no new colours.
- Reduced-motion: steps swap without a slide.

## 8. Test plan for the building PR (outline)

- Component test: a full run from the menu produces one persona with the expected `name`, `icon`, `personaPrompt`, and the mirror fields stay consistent when it is the active persona (regression for the live-write path).
- Skipping every step leaves one persona named "새 페르소나" with an empty prompt (compatibility guard).
- Cancel on an untouched persona removes it and offers undo; cancel after typing asks first.
- Hand-edited step 3 text is not overwritten by going back and forward without the confirm.
- Enter during an IME composition does not advance.
- Export of a built persona round-trips through `buildPersonaCard` and `parsePersonaCard` unchanged.
- Device rows (for the building PR, written from its diff): one Note 9 pass for the soft keyboard, back gesture and the Korean IME on steps 1 and 2.

## 9. Open product questions (for the maintainer)

- **Q1: Is the guided version only the three steps above, or does it also offer "starting points"?** Recommendation: only the three steps. Starting points (premade descriptions) are content the fork would have to write and maintain, and "복제" already covers copying a persona.
- **Q2: Fields in step 2.** Recommendation: the four above. Alternatives: fewer (one free text, which is barely guidance) or more (age, pronouns, relationships), which makes the walk longer than the three-step target on a phone.
- **Q3: After "만들기", should the new persona become the one in use?** Recommendation: no, ask nothing; open it in the editor with the "사용하기" button visible, as every other creation does (SLICE5A §3.2).
- **Q4: Labels in the composed text.** Recommendation: the UI language's labels (§5). Alternative: always English labels, so a persona made in Korean reads the same in an English UI; this is easier for models but looks foreign to the person editing.
- **Q5: Create at open (§6, live-save) or only at the end.** Recommendation: at open, because the picture picker needs a persona. Creating only at the end needs a picture step after "만들기" or a new asset hand-off for an unsaved persona (an asset-lifecycle change that should be its own ticket).
- **Q6: Writing with a model.** Recommendation: not in this ticket, and not a design default; it needs its own decision on privacy and on which connection it would use.

Answers: all six recommendations accepted (MC-4530 to MC-4535).
