# Pattern spec: visual warnings and task progress

Status: **proposal for review**, written 2026-10-28 from DD-219..222 ([DECISIONS.md](../DECISIONS.md) lines 1287-1294). Nothing here is built. No mockup was opened or run for this document; every claim about current surfaces comes from source reading and is recorded in [research/inventory.md](research/inventory.md) (202 rows). Motion is specified separately in [MOTION_CONTRACT.md](MOTION_CONTRACT.md) (being written by the motion planner; not present when this was written).

**Decided (user, DD-219..222).** All four surface groups get the treatment: export/import, restore/recovery, warning and danger dialogs, other long tasks. A warning is a mark or icon + one-line headline + short list of concrete consequences + detail behind a disclosure, keeping DD-149 protected-surface rules. Progress is startup-style named steps + a determinate bar with counts + the Nexus status mark, Cancel only where safe, and a result card listing what was skipped. Motion is purposeful and floor-safe; reduced motion shows the same states without movement; low power keeps the status mark (DD-211).

**Proposed here (not decided).** Everything else: severity names, state names, part names, numeric floors and ceilings, copy, rollout order. Each is tagged "proposal" or listed in section 12.

---

## 0. Open questions first (recommendation first; none decided)

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q1 | **MC-774 leave-out list: who builds it?** The source has no list of fork-only data (inventory A-41), yet the `.bin` export warning must name what is left out. | (a) Lane A returns a machine list per export (kind, count). (b) Design hard-codes the kinds from ENGINE_CHANGES. (c) Export only names kinds that exist in this profile. | (a) with (c): the warning names only kinds actually present, with counts. Design writes the copy slots; Lane A confirms the list. Until then the mockup uses a synthetic list marked "mock". |
| Q2 | **Undo window: 6 s or 10 s?** Chat/Studio use 6 s, Settings/toggles/hooks use 10 s; closing Studio silently drops delete-undo (T-7). | 10 s everywhere; 6 s everywhere; keep per lane. | One value, 10 s, with the remaining time exposed to assistive tech and a "kept until ..." line for durable undos (DD-100). Needs a user decision because it changes shipped lane behaviour. |
| Q3 | **Cancel for backup and restore.** The app's backup writer has no cancel (A-1, A-3); restore cancel points are marked OPEN in the data mockup. | Offer Cancel only before the first write; never offer during writes; add engine cancel. | Cancel before the first write only (restore: before "Replacing data"; backup: during file gathering). Mid-write Cancel needs an engine change (new row in ENGINE_CHANGES, size unknown). |
| Q4 | **Does import ask, or only report?** Today `importCharacter` and friends have no preview (A-33). | Ask only when something is replaced; preview always; report only. | Add content never asks; replace/overwrite asks (S-48 pattern: duplicate prompt). Result card always lists skipped items. |
| Q5 | **Import grouped Undo.** After a multi-item import, is there one "Undo import" step? | Yes one step; per-item only; none. | One grouped Undo while the result card is open and for the undo window. Not verified feasible in the app. |
| Q6 | **Where do `--pattern-*` tokens live?** | New `theme/pattern-tokens.css`; extend `theme/nexus-tokens.css`; per-lane aliases. | New shared file, with each lane aliasing it (as DD-217 did for the warning channel). One registry fragment merged into each lane's `minimums`/`maximums`. |
| Q7 | **Danger colour-only risk.** Failed/danger states must not rely on red. | Shape + text always; add a shape glyph to the status mark `error`. | Shape + text always (already required in section 8). Confirm whether `error` mark shape differs enough from `waiting` at 20 px. |
| Q8 | **Which warnings stay inline instead of a sheet?** Many are banners (T-3, T-5, S-43). | Banner = severity caution, sheet = confirm/danger; all sheets. | Banner for caution, sheet for confirm/danger (section 3). |
| Q9 | **Existing "ask twice" cases.** App removes a character with two confirms (A-38); partial backup asks twice (A-6). | Keep two; collapse to one with consequences; one + type-to-confirm for permanent. | One confirm that shows the consequences (counts). Type-to-confirm only for permanent emptying of 최근 삭제 if the user wants it. |
| Q10 | **`.bin` vs `.risub`.** Source names local backups `.bin`; the data mockup and Settings use `.risub`; onboarding says `.bin`. | Show the app's real extension; keep `.risub`; show both. | Fix the mockup to the real `.bin` (MC-774 also names `.bin`), keep `.rtb` as the fork-only backup. Confirm that `.risub` is a placeholder. |
| Q11 | **Home trash empty / permanent purge confirm.** Slice 5a purges without confirm (S-38) but slice 2 confirms (S-14). | Always confirm; never; confirm only if more than one. | Always confirm permanent delete, showing n items and total size. |
| Q12 | **Paused as a user-visible state.** | Show "Paused"; fold into "waiting for you". | Show paused only for blocked-on-condition (other tab, offline, app backgrounded). A prompt the user must answer is `confirm`. |

---

## 1. Scope and terms

- **Warning** = a surface that tells the user a consequence before or after an action. **Task** = work that takes more than about one second or touches many items, with a start and an end.
- **Kinds of task** this spec names: `export`, `import`, `restore`, `backup`. Other long tasks (connection test, model download, search, cold restore, translation) reuse the same anatomy with fewer steps (section 5.7).
- Terms: **export** = write content or data out to a file (card, preset, chat, dataset, bundle). **import** = add content in; nothing existing is replaced unless a duplicate is chosen. **backup** = write the whole profile (full `.bin`, partial, internal snapshot). **restore** = replace the profile or items from a backup or from 최근 삭제. Home's "restore from 최근 삭제" is a restore of one item and uses the same states with one step.
- Ground truth for what exists today: [research/inventory.md](research/inventory.md). The data-and-backups mockup (`mockups/data-and-backups.html`) is the closest existing design of these flows and is the starting point for the rollout (section 11).

---

## 2. Inventory summary (detail in research/inventory.md)

| Group | Rows | Today | Biggest gaps |
|---|---|---|---|
| Mockups (M) | 18 | data-and-backups has restore review, steps, endings, export flow, cleanup; startup has the 7-step bar; onboarding has restore; Home has trash and run rows | none of `mockups/*.html` has `data-part-critical`; restore/export have steps but no counts, no mark, no result card |
| Chat (C) | 36 | 9 asks, ~12 undo-only rows, simulated export/import toasts | export/import are one-line "simulated" toasts (C-15..17); no confirm says "cannot be undone"; 6 s vs 10 s undo |
| Settings (S) | 59 | most thorough: counted usage lines, Undo + 최근 삭제, key guards | stale "되돌릴 수 없어요" copy (S-6, S-7); no key-inclusion line on full backup (S-5) or bundle export (S-19); local model download has no progress (S-55); purge inconsistent (S-38) |
| Studio (T) | 48 | applies/conflicts/leave are critical sheets; DD-100 undo-only deletes; image import is a spinner row | no export/import UI (T-48); no n-of-m or cancel for imports (T-31); asset delete with usages doesn't warn (T-38); closing Studio drops undo silently (T-7) |
| App `src/` (A) | 41 | progress is text in `alertWait`; only one wait is cancellable (A-20); partial backup asks twice with ~400-char bodies (A-6); good existing "left out" and "skipped names" reports (A-4, A-11, A-15, A-31) | `.bin` leave-out list for fork-only data does not exist (A-41); several hard-coded English strings (A-17) |

---

## 3. Warning anatomy (DD-220)

### 3.1 Parts, top to bottom

1. **Mark** (`pattern-warn-mark`): the Nexus status mark for data operations, or a plain icon for non-task warnings. Never colour only: each severity has a distinct shape (Q7). Size 24 px on sheets, 20 px in banners.
2. **Headline** (`pattern-warn-headline`): one line, a verb and the object, no trailing explanation. Target at most 36 KO characters / 60 EN. Example: "백업 파일로 지금 데이터를 바꿔요" / "Replace current data with this backup".
3. **Consequences** (`pattern-warn-consequences` list, 2-3 `pattern-warn-consequence` items). Each is one line, one fact, and contains at least one of: a count, a size, a name, a time. At most 3 visible. A fourth is an overflow row: "그 밖에 {n}개 보기" which opens the detail.
4. **Detail disclosure** (`pattern-warn-detail`, native `details/summary` or a button with `aria-expanded`): technical reason, full lists (all skipped names, all affected chats), file path, error code. Collapsed by default. Never holds the only statement of irreversibility.
5. **Actions** (`pattern-warn-actions`): Cancel (or "머무르기" / "Keep") on the left, the consequence verb on the right; the primary verb names the action ("교체하기", "지우기"), never "확인/OK" (S-2..4). Cancel takes initial focus for `danger`; the safe choice takes it for `confirm`.
6. **Undo line** (`pattern-warn-undo`), only in post-action toasts and rows (section 3.4).

### 3.2 Severity levels (proposal)

| Level | `data-pattern-severity` | Meaning | Surface | Example inventory rows |
|---|---|---|---|---|
| Notice | `notice` | Something happened or is true; nothing to decide | toast, status row | C-26, S-15, T-39 |
| Caution | `caution` | Something may go wrong or is left out; user may continue | inline banner, or sheet with one button | T-3, T-5, S-43, A-27 |
| Confirm | `confirm` | Reversible with cost, or replaces data; ask first | sheet, safe choice focused | S-9, S-17, T-1, T-8 |
| Danger | `danger` | Irreversible, or reaches beyond the item; ask first, danger styling, critical | sheet, Cancel focused | C-2, C-9, S-14, S-28, T-6 |
| Blocked | `blocked` | The action cannot run; says why and what to do | sheet or banner, no destructive button | S-11, S-41, M-7 |

Colour roles: `notice` uses text/accent, `caution` uses `--nexus-warning-rgb` (DD-217), `confirm` uses the accent/primary edge, `danger` and `blocked`-with-error use `--nexus-danger-rgb`. A level changes shape (mark), edge colour and wording; it never changes the part names.

### 3.3 When to ask and when to offer only Undo (aligned with DD-100, DD-149, DD-165)

Proposal, consistent with every shipped decision:

| Condition | Rule | Anchors |
|---|---|---|
| One item removed, restorable for a stated period, no effect outside the item | **Undo only**, no confirm | DD-100 (live code), T-10, T-19, T-21, T-40, C-1, S-29 |
| The undo is shorter than a session or may be dropped silently (chat switch, Studio close) | Say so on the toast: "{time}까지 되돌릴 수 있어요" or "Studio를 닫으면 사라져요" | C-36, T-7 |
| More than one item, a range or a subtree is removed, or references elsewhere are removed | **Ask** (confirm), consequences list shows counts; may also offer Undo | C-2, S-10, S-47, T-21 (group) |
| Irreversible: no undo exists after the step | **Ask**, `danger`, Cancel focused, headline includes "되돌릴 수 없어요" in the consequences | C-9, C-23, S-14, S-28 |
| Replaces data wholesale (restore, replace list, bias list, apply draft over live) | **Ask**, consequences name what is replaced and what is kept; a safety copy statement | S-2, S-33, T-1, T-8 |
| Turns on something that widens the app's authority (risky flags, low-level modules, plugins) | **Ask once** per flag per session with the effect in plain words | DD-165, T-28, S-43, S-49 |
| Sends data or costs money/time (connection test, model download, retry) | Do not ask; show a **cost line** and Cancel in progress | S-32, S-55 |
| Work in progress would be lost (delete while generating) | Ask with the lost-work fact | C-3, C-10, C-11 |
| The only blocked state | **Blocked** warning, no destructive button | S-11, S-41 |

Two protections apply regardless of the rule above (DD-149): any sheet with a danger button or that drops data is `data-part-critical`; protected children get their own part names so a pack's selectors cannot reach inside.

Do not ask for: Stop of a reply (partial kept; say so on the label), toggling a view option, reorder, rename, or any undoable single-item edit. Ask exactly once per action; collapse chained confirms (A-6, C-25 then C-23) into one with the consequences listed (Q9).

### 3.4 Undo line

Post-action row or toast: "삭제했어요: {name} · 되돌리기" + the window. If the undo lasts until a condition (Studio close, next Send), the toast says which. The remaining time is not an on-screen ring by default; it is available to assistive tech. Visual countdown is a motion decision (MOTION_CONTRACT).

### 3.5 Copy rules

- Headline: verb + object, present tense. Consequences: a number or name first, then the fact: "채팅 {n}개와 메시지 {m}개가 함께 지워져요".
- Always state irreversibility as the last consequence when it applies: "되돌릴 수 없어요".
- Never "Are you sure". Never a bare 확인/OK. Cancel says what it keeps: "취소" for a simple dismiss, "머무르기" for leaving a screen.
- Use names for at most 3 items then "외 {n}개".
- Numbers use one unit pair: 개 for items, MB with one decimal for sizes over 1 MB.

---

## 4. Progress anatomy (DD-221)

The anatomy reuses the boot model exactly: [boot/bootProgress.ts](../boot/bootProgress.ts) (steps, state, count, announcement), [boot/nexus-boot.css](../boot/nexus-boot.css) (bar), [mockups/startup.html](../mockups/startup.html) (screen).

### 4.1 Parts, top to bottom

1. **Mark** (`pattern-task-mark`): Nexus status mark, `transfer_out` for export/backup, `transfer_in` for import/restore, `scanning` for checks, `waiting` when blocked on a condition or user, `done` / `error` at the end, `stopped` after cancel ([STATUS_INVENTORY.md](../STATUS_INVENTORY.md) rows 36-38; status-marks.html also has a counted-progress ring variant, `progress` option, at 20/32/48/160 px).
2. **Title and subtitle** (`pattern-task-title`, `pattern-task-subtitle`): the verb and object; the subtitle names the file or the source ("demo-backup.bin · 24 캐릭터 · 180 채팅").
3. **Steps** (`pattern-task-steps`, `pattern-task-step`): named steps in order. The user sees the current step label plus a compact list (all steps on wide, current plus neighbours on narrow). Each step has `data-step-state` = `done | now | next | skipped | failed`. Steps are fixed per task kind so the bar never jumps backwards (boot rule).
4. **Bar** (`pattern-task-bar`, `pattern-task-bar-fill`, optional `pattern-task-bar-ticks`): determinate. Fill = (completed steps + fraction inside current step) / step count, as `bootFraction` does; a step without counts fills nothing until it ends and shows a still "working" marker (the boot sweep, motion per MOTION_CONTRACT). The bar only grows. Step ticks stay.
5. **Count line** (`pattern-task-count`): "{done} / {total}" and the item noun, e.g. "인레이 12 / 40". Bytes only when the engine has real byte totals. No percentage text unless counts are real (the data mockup says so explicitly).
6. **Status line** (`pattern-task-status`, `role=status`): current step label or detail; this is the only live region (section 8).
7. **Actions** (`pattern-task-actions`): Cancel (`pattern-task-cancel`) only where safe (5.4); "백그라운드에서 계속" where background is allowed (6); no destructive button while running.
8. **Detail** (`pattern-task-detail`): disclosure with log lines, technical error code, full lists.

### 4.2 Step lists per kind (proposal; names from the app and the data mockup)

| Kind | Steps |
|---|---|
| Backup (full `.bin`) | 파일 준비 → 이미지·에셋 담기 {n}/{m} → 보관 데이터 담기 {n}/{m} → 데이터베이스 저장 → 파일 확인 (A-3 gives the counted steps: inlays, cold data, database) |
| Backup (partial) | 담을 항목 확인 → 프로필 이미지 담기 {n}/{m} → 데이터베이스 저장 → 파일 확인 |
| Backup (internal snapshot) | 현재 데이터 확인 → 스냅샷 저장 |
| Export (card / preset / module / chat / dataset) | 담을 항목 모으기 {n}/{m} → 파일 만들기 → (저장 위치 고르기) → 완료. Dataset adds "보관소에서 읽기 {n}/{m}" (A-31) |
| Import (cards, presets, modules, chats, images) | 파일 읽기 → 항목 확인 {n}/{m} → 추가하기 {n}/{m} → 정리 (images in Studio: one row per batch, see 5.3) |
| Restore (file or snapshot) | 파일 확인 → 다른 탭 확인 → 안전 복사본 만들기 (if offered) → 데이터 교체하기 → 저장 확인 → (다시 불러오기) (mockup M-2 plus A-12) |
| Restore from 최근 삭제 | 되살리는 중 (one step; Home already shows restoring/failed rows, M-16) |

### 4.3 Background behaviour

- DD-191 (Studio images keep importing when the author leaves the item) and DD-196 (result shows as an app-wide toast with "Studio에서 보기") are the model: **a task is owned by the app, not by the screen that started it.** Tasks keep running when the screen closes or the user navigates, except where unsafe (5.4).
- Running tasks appear as a row in Home's Tasks (DD-204/205 show runs as rows with Stop) and as a persistent compact chip in the shell: mark + title + "{done}/{total}" + open button. Proposal; shell placement belongs to the motion/shell work.
- On completion while elsewhere: an app-wide toast with the result headline and one link ("보기" / "Studio에서 보기"). If the result has skips or failures, the toast says so ("3개 건너뛰었어요") and the link opens the result card.
- Only one backup/restore may run at a time (the source refuses: `backupLoadWorkInProgress`, A-8). Import/export may overlap up to the Home cap of 3 only where the engine allows (open: Q4/Q12 for how queued tasks show).
- App close or reload during a task: restore and backup write steps must warn on leave ("지금 나가면 {step}이 끊겨요"). Not verified against the app's persistence; mockup only.

### 4.4 Failure and partial failure

- **Failed** = nothing usable resulted, or the state is unknown. The result card leads with "known data state" like the data mockup: "지금 데이터는 바뀌지 않았어요" / "교체가 끝났는지 확인하지 못했어요". The mark is `error`; the step that failed shows `data-step-state="failed"`; the bar keeps its fill and the failed share turns to the danger colour (as boot does).
- **Done with skips** = the task completed, some items did not. The mark is `done`, not `error`; a caution-level count banner above the list: "{skipped}개는 건너뛰었어요". Skips are a list inside the result card (4.5), never only a toast.
- **Unknown state** (restore "could not verify save", M-3): no Retry button; guidance steps instead ("다시 시도하기 전에 현재 상태를 내보내 두세요"), as the mockup does.
- **Retry** appears only when the starting state is known and repeating is safe (export, import, backup, restore-before-write). It restarts from step 1 for restore/backup and from the failed items for import ("실패한 {n}개만 다시").

### 4.5 Result card (`pattern-task-result`)

Always the final state of a task; replaces the progress card in place (same focus target):

1. Outcome headline (`pattern-task-result-headline`): "백업을 저장했어요" / "복원하다 멈췄어요".
2. Summary counts (`pattern-task-result-summary`): "캐릭터 24개, 채팅 180개, 프리셋 6개 · 148 MB". Counts by kind, not a single total.
3. **Skipped list** (`pattern-task-result-skipped`, items `pattern-task-result-skip`): every skipped or left-out item with name and reason ("너무 커서: voice-04.wav · 31 MB"). Collapsed after 3 items with "외 {n}개 보기", but the count is never collapsed. Reasons come from the engine's existing categories (A-11, A-15, A-31: too large, invalid, not stored, cold storage unreadable).
4. **Left out of the file** (MC-774) as a separate group in export results: "이 파일에 담기지 않은 것" with kinds and counts (section 5.5).
5. Next actions: primary (열기 / 다시 불러오기 / 닫기), secondary (다시 시도, 내보내기 로그 보기).
6. Detail disclosure.

---

## 5. Per-task behaviour

### 5.1 States (all four task kinds)

`data-task-state` values:

| State | What it shows | Mark | Exits |
|---|---|---|---|
| `idle` | the launch control (button, drop zone); no task card | `idle` | start → `confirm` (or `running` when no confirm needed) |
| `confirm` | warning (section 3) with consequences and file facts | none or `scanning` while preflight runs | confirm → `running`; cancel → `idle` |
| `running` | progress card: steps, bar, count, status | per step (4.1) | success → `done`; skips → `done-with-skips`; error → `failed`; block → `paused`; Cancel → `cancelling` |
| `paused` | same card; status explains what is waited on; a Resume/Check again button when relevant | `waiting` | condition clears → `running`; Cancel (safe) → `cancelling`; ends → `failed` |
| `cancelling` | card stays; status "정리하는 중"; Cancel disabled; no new fill | `stopped` after settling | → `done` (nothing written) or `done-with-skips` (partial result kept) or `failed` |
| `done` | result card, no skips | `done` | close; open |
| `done-with-skips` | result card with skipped list and count banner | `done` | close; open; retry skipped (when safe) |
| `failed` | result card with known data state | `error` | Retry (when safe) / Close / guidance |
| `retry` | a `running` entry created by Retry; `data-task-retry="n"`; previous failure is replaced, not stacked | per step | as running |

### 5.2 Per kind

| Kind | idle → confirm | running | paused when | cancellable | partial / skips look like | failed leaves |
|---|---|---|---|---|---|---|
| **Export** (file) | Picker for format (A-32), then warning only if something is left out or a key/secret concern exists (otherwise go straight to running); consequences: what is included, what is left out (counts), file name and estimated size | steps 4.2; no data changed on the app side | file picker open (`waiting`), disk full (error) | Yes, until the file is finalised; then nothing to cancel | left-out kinds (MC-774) and unreadable items (A-31 skip list) | "파일이 만들어지지 않았어요. 데이터는 그대로예요" |
| **Backup** | Confirm only for partial (what is excluded: A-6) and for an incomplete cold-storage state (A-2); full backup goes straight to running, but the first-run confirm states that keys are included (S-5) | steps 4.2 with counts from A-3 | file picker, other operation busy | Only before the first write (Q3) | assets too large/missing (A-5), inlays left out (A-4) | no file or half file known? say which (A-5 keys: "nothing written" vs "file kept") |
| **Import** | None for additive; confirm for replace/duplicate (S-48) and for risky content (plugin, low-level access: S-43, T-30) | steps 4.2; per-item results accumulate | duplicate needs an answer (`confirm`, not paused) | Yes, between items; cancelling keeps already added items and offers grouped Undo (Q5) | rejected files with reasons (T-32, T-35) | "추가된 {n}개는 그대로 있고, 실패한 {m}개를 …" |
| **Restore** | Always confirm (`danger`): source, contents, destination, replacement scope, safety copy yes/no, other tabs; "no safety copy" needs the acknowledgment checkbox (M-1) | steps 4.2 | busy, other tab open, no lock support (A-12) | Only before "데이터 교체하기"; after that, Cancel is not offered | oversized assets/inlays listed before start (A-11) and after (A-15) | M-3 endings: reload needed / nothing replaced / could not verify save (no retry) |

### 5.3 Studio image import (DD-191, DD-196)

One row per batch (as now, T-31), upgraded to the compact task chip form: mark + "이미지 {done}/{total}" + status; no sheet. Skips and failures appear on the existing rejected-files list (T-35) and in the result toast text "{n}개 추가, {m}개 못 가져왔어요" with names in the detail. Cancel only between files. The toast uses `pattern-task-result` parts at toast size; the existing toast being `data-part-critical` for non-undo "보기" actions (T-33) is a defect to fix, not copy (inventory note).

### 5.4 Where Cancel is safe (rule)

Cancel is shown only when all hold: (1) nothing already written would be left half-applied; (2) the engine can stop within about 2 s; (3) cancelling does not discard the user's own data. Otherwise Cancel is replaced by a one-line reason ("이 단계는 중간에 멈출 수 없어요") and, for long steps, "백그라운드에서 계속" where allowed. Source reality: of the app's many `alertWait` progress dialogs only `internalBackupWaitingForCleanup` is cancellable (A-20). Everything in the table above beyond that needs engine support (list new engine rows for Lane A).

### 5.5 MC-774 export warning (export to upstream `.bin`)

Source: [ENGINE_CHANGES.md](../ENGINE_CHANGES.md) lines 50-56. Rulings relayed by Lane A and **not separately confirmed in this clone**: upstream-equivalent data is translated into upstream's shape; fork-only data stays in our own storage and the fork-only `.rtb` backup, is left out of `.bin`, and "the export warns and names what was left out"; importing an upstream `.bin` must always work.

Warning (level `caution` when anything is left out, otherwise no warning). Shape:

- Mark: caution. Headline: ".bin에는 이 앱에서만 쓰는 데이터가 담기지 않아요"
- Consequences (kinds present, with counts; max 3 shown then overflow):
  - "채팅 {n}개의 채팅별 탈옥·기억 문구는 빠져요" (ENGINE #4)
  - "그룹 메시지 {n}개의 삭제된 멤버 이름은 빠져요" (#10)
  - "실패 기록·편집 초안·읽기 설정은 빠져요" (#1, #15, #12)
  - overflow: "그 밖에 {n}종 보기"
- Actions: "전체 보관용 .rtb로 내보내기" (secondary; keeps everything) and "그래도 .bin으로 내보내기" (primary), Cancel.
- Detail: full list of kinds with counts, plus "알려 드린 것 외에 업스트림이 읽는 데이터는 모두 담겨요" (claim to verify).
- The result card repeats the list under "이 파일에 담기지 않은 것" so it can be checked later. Per-message alternatives export as whole-round slices (#8) is a translation, not a leave-out; a one-line note at most.

Hard rules: the list names kinds **and counts present in this export**; a kind with zero items is not shown; the list is never hidden by a pack (critical, section 6.3).

### 5.6 Examples (illustrative; strings are proposals)

**Restore a backup (danger, replaces data)**

```
[mark] 백업 파일로 지금 데이터를 바꿔요
  • 캐릭터 24개, 채팅 180개가 파일의 내용으로 바뀌어요   (현재 31개 / 214개)
  • 파일에서 빠진 이미지 12개(약 38 MB)는 지금 것을 그대로 둬요
  • 안전 복사본을 먼저 만들어요 (약 148 MB)
  ▸ 자세히
  [취소]                          [교체하기]
```

**Delete chat (danger)**

```
[mark] 채팅 "여름 휴가"를 지워요
  • 메시지 412개, 북마크 3개, 폴더 위치가 함께 지워져요
  • 되돌릴 수 없어요
  [취소]                          [지우기]
```

### 5.7 Other long tasks (DD-219 "long tasks elsewhere")

Same card with fewer parts. Examples and what each needs:

| Task | Rows | Steps | Cancel | Notes |
|---|---|---|---|---|
| Connection test | S-32, S-56 | 요청 보내기 → 응답 기다리기 | Yes (exists) | cost line ("이 확인은 요청 1건을 보내요"), elapsed text |
| Local model download | S-55 | 내려받기 {size done}/{size} → 확인 | Yes, resumable? (engine) | metered-network copy, location |
| Asset integrity scan | A-28, M-9 | 읽기 {n}/{m} → 확인 {n}/{m} | between batches | result = M-9 table |
| Cold storage cleanup | A-29, A-30, M-5 | 확인 → 지우기 {n}/{m} | before first delete only | confirm shows total size |
| Search in long chat | C-31 | 훑는 중 {n}/{m} | Yes | status row only |
| Plugin update check | S-46 | 확인 {n}/{m} | Yes | result list |
| Background reply (chat) | C-19, M-17 | existing run object | Stop (keeps partial) | already a run row; not changed here |
| Startup | M-11 | 7 boot steps | n/a | source model; unchanged |

---

## 6. Theme contract

### 6.1 Part names (proposal)

Shared prefix `pattern-`; a lane may extend with its own ancestor part (for example `settings-dialog` wrapping `pattern-warn-root`) but must not rename children. DD-149 requires protected children to have their own names so selectors cannot reach inside; hence both groups have explicit protected children.

Warning: `pattern-warn-root`, `-mark`, `-headline`, `-consequences`, `-consequence`, `-detail`, `-detail-toggle`, `-actions`, `-action-cancel`, `-action-primary`, `-undo`.
Task: `pattern-task-root`, `-mark`, `-title`, `-subtitle`, `-steps`, `-step`, `-bar`, `-bar-fill`, `-bar-ticks`, `-count`, `-status`, `-actions`, `-cancel`, `-detail`, `-result`, `-result-headline`, `-result-summary`, `-result-skipped`, `-result-skip`, `-result-leftout`, `-result-actions`, `-chip` (compact form).

### 6.2 `data-*` state

| Attribute | Values | On |
|---|---|---|
| `data-pattern-severity` | `notice caution confirm danger blocked` | `pattern-warn-root` |
| `data-task-kind` | `export import restore backup test download scan other` | `pattern-task-root` |
| `data-task-state` | `idle confirm running paused cancelling done done-with-skips failed` | `pattern-task-root`, mirrored on `-bar` and `-mark` |
| `data-step-state` | `done now next skipped failed` | `pattern-task-step` |
| `data-has-skips` | present/absent | `pattern-task-result` |
| `data-has-leftout` | present/absent | `pattern-task-result`, `pattern-warn-root` |
| `data-low-power` | present when low power | `pattern-task-bar` (reuse boot attribute) |
| `data-compact` | present for chip form | `pattern-task-root` |

The state attributes are the contract; a pack styles by them, never by class or text.

### 6.3 `data-part-critical` (proposal)

| Part | Critical | Why |
|---|---|---|
| `pattern-warn-root`, `-headline`, `-consequences`, `-consequence`, `-actions`, `-action-cancel`, `-action-primary`, `-mark` (shape) | **yes** (the whole sheet when severity is `confirm`, `danger` or `blocked`; for `notice`/`caution` banners only `-consequences` and `-actions`) | DD-149: a sheet with a danger button or that drops data; consequences must stay visible |
| `pattern-warn-detail` body | no | can be restyled; the toggle stays critical so it stays reachable |
| `pattern-warn-undo` | yes when it names a time limit | silent expiry is a defect (C-36) |
| `pattern-task-root`, `-status`, `-cancel`, `-result`, `-result-headline`, `-result-summary`, `-result-skipped`, `-result-skip`, `-result-leftout`, `-result-actions` | **yes** | the skipped and left-out facts are the contract of DD-221 and MC-774 |
| `pattern-task-bar`, `-bar-fill`, `-count` | yes for existence and contrast only (see floors); colours and shape styleable | the bar must not disappear or hide counts |
| `pattern-task-mark`, `-title`, `-subtitle`, `-steps`, `-step`, `-detail`, `-chip` | no | decorative or redundant with the live status |

Where a lane already has a protected wrapper (`settings-dialog`, `studio-critical-sheet`, `chat-critical-*`, `home-confirm`), the pattern parts sit inside it and inherit protection; the lane keeps its own part names for the frame.

### 6.4 Role tokens (proposal)

All `--pattern-*`, defined once, aliased by lanes (Q6). Defaults point to Nexus roles.

| Token | Role | Default |
|---|---|---|
| `--pattern-warn-edge` | edge colour by severity | notice: `--nexus-edge`; caution: `rgb(var(--nexus-warning-rgb))`; confirm: `--nexus-accent`; danger/blocked: `rgb(var(--nexus-danger-rgb))` |
| `--pattern-warn-edge-width` | edge thickness | 2px |
| `--pattern-warn-tint-alpha` | tint over the surface (channel from severity) | 0.08 |
| `--pattern-warn-mark-size` | mark box | 24px (20px banner) |
| `--pattern-warn-headline-size`, `-weight`, `-leading` | headline | 15px, 600, 1.3 |
| `--pattern-warn-body-size`, `-leading` | consequences | 13px, 1.4 |
| `--pattern-warn-gap`, `-padding` | spacing | 8px, 16px |
| `--pattern-warn-action-height` | button/touch height | 44px touch, 40px hover (DD-213) |
| `--pattern-task-bar-height` | bar thickness | 6px (as boot) |
| `--pattern-task-bar-track`, `-fill`, `-fail` | bar colours | `rgb(255 255 255/.08)`, accent gradient, danger |
| `--pattern-task-step-gap`, `--pattern-task-mark-size` | steps / mark | 8px, 48px (20 in chip) |
| `--pattern-task-count-size` | count line | 12px |
| `--pattern-skip-edge` | edge of the skipped list | caution colour |
| `--pattern-ease` | alias for `--nexus-ease` | |

### 6.5 Floors and ceilings (for the shared registry; DD-182, DD-192, DD-195)

Registry shape is the existing one (`registry.minimums`, `registry.maximums`, plus the contrast and relative-unit rules, per `chat/checks/th/packlint.mjs` and Studio's registry). Numbers below are **proposals** that reuse Studio's DD-192/DD-195/DD-197 values where they apply; every one needs the same worst-case check over layout and `@media` branches.

| Token | Floor | Ceiling | Source of value |
|---|---|---|---|
| `--pattern-warn-headline-size` | 13px | 24px | Studio text floor 11 raised for a headline; ceiling = studio `font` cap |
| `--pattern-warn-body-size`, `--pattern-task-count-size` | 11px | 24px | DD-192 / DD-195 |
| `--pattern-warn-action-height` | 32px | 72px | DD-192 (Deep Nexus keeps 44/48; Home touch floor 44 per DD-213 stays a lane rule) |
| `--pattern-warn-padding`, `--pattern-warn-gap`, `--pattern-task-step-gap` | 4px | 32px | DD-192 / DD-195 |
| `--pattern-warn-edge-width` | 2px | 12px | DD-182 / DD-195 |
| `--pattern-warn-tint-alpha` | 0.05 | 0.30 | DD-182 / DD-195 |
| line-height tokens | 1.2 | 2.2 | DD-195 |
| `--pattern-task-bar-height` | 4px | 16px | proposal |
| `--pattern-warn-mark-size`, `--pattern-task-mark-size` | 16px | 96px | status-marks.html sizes 20/32/48/96 |
| `--pattern-skip-edge` width | 1px | 8px | proposal |

Additional rules (proposal):
- Relative units (`vw vh % em ch`) rejected on floored tokens, as DD-195.
- **Contrast.** Headline against the tinted surface 4.5:1; bar fill against track 3:1; the failed-state fill against track 3:1 (this is the check the shared lint cannot do per token, like Studio's colour pass, DD-195); severity edge against the surface 3:1.
- **Severity separability.** `caution` and `danger` edge colours must differ by at least a stated amount, otherwise a pack could flatten the levels (proposal; no number chosen; open for the lint owner).
- **Never-empty.** `pattern-warn-consequences` and `pattern-task-result-skipped` may not be `display:none`, `visibility:hidden`, `height:0`, `clip`, `opacity:0`, or moved off-screen; lint rejects (same family as the DD-149 install rule).
- `-mark` shape layers keep a shape that differs by severity under forced colours.
- Reduced motion and forced colours are not pack-stylable off.

---

## 7. Copy (KO first, EN beside)

Strings are proposals. `{}` are interpolations. Counts and names are mandatory where shown.

| Key | KO | EN |
|---|---|---|
| warn.restore.headline | 백업 파일로 지금 데이터를 바꿔요 | Replace current data with this backup |
| warn.restore.c1 | 캐릭터 {n}개, 채팅 {m}개가 파일의 내용으로 바뀌어요 | {n} characters and {m} chats are replaced with the file's |
| warn.restore.c2 | 안전 복사본을 먼저 만들어요 ({size}) | A safety copy is made first ({size}) |
| warn.restore.nosafe | 안전 복사본을 만들 수 없어요. 실패하면 지금 데이터를 되살릴 방법이 없을 수 있어요 | No safety copy can be made. If this fails, the current data may not be recoverable |
| warn.restore.verb | 교체하기 | Replace |
| warn.backup.full.keys | 이 파일에는 연결 키가 들어 있어요. 다른 사람에게 보내지 마세요 | This file includes connection keys. Don't share it |
| warn.backup.partial.headline | 일부만 백업해요 | Back up part of your data |
| warn.backup.partial.c1 | 프로필·페르소나·폴더·프리셋 이미지는 담겨요 | Profile, persona, folder and preset images are included |
| warn.backup.partial.c2 | 감정 이미지, 추가 에셋, VITS 파일, 그 밖의 미디어 {n}개({size})는 빠져요 | Emotion images, extra assets, VITS files and other media ({n}, {size}) are left out |
| warn.export.bin.headline | .bin에는 이 앱에서만 쓰는 데이터가 담기지 않아요 | The .bin leaves out data only this app uses |
| warn.export.bin.item.chatfields | 채팅 {n}개의 채팅별 탈옥·기억 문구는 빠져요 | Per-chat jailbreak and memory text of {n} chats is left out |
| warn.export.bin.item.members | 삭제된 멤버 이름 {n}개는 빠져요 | {n} deleted-member names are left out |
| warn.export.bin.more | 그 밖에 {n}종 보기 | {n} more kinds |
| warn.export.bin.alt | 전체를 담으려면 .rtb로 내보내세요 | To keep everything, export as .rtb |
| warn.delete.chat.headline | 채팅 "{name}"을 지워요 | Delete chat "{name}" |
| warn.delete.chat.c1 | 메시지 {n}개와 북마크 {m}개가 함께 지워져요 | {n} messages and {m} bookmarks go with it |
| warn.irreversible | 되돌릴 수 없어요 | This can't be undone |
| warn.undo.window | {time}까지 되돌릴 수 있어요 | You can undo until {time} |
| warn.undo.until-close | Studio를 닫으면 되돌릴 수 없어요 | Closing Studio ends Undo |
| task.title.export | {name} 내보내는 중 | Exporting {name} |
| task.title.import | {name} 가져오는 중 | Importing {name} |
| task.title.restore | {name}에서 복원하는 중 | Restoring from {name} |
| task.title.backup | 백업 저장하는 중 | Saving backup |
| task.step.gather | 담을 항목 모으기 | Gathering items |
| task.step.files | 이미지·에셋 담기 | Adding images and assets |
| task.step.cold | 보관 데이터 담기 | Adding archived data |
| task.step.db | 데이터베이스 저장 | Saving the database |
| task.step.check | 파일 확인 | Checking the file |
| task.step.tabs | 다른 탭 확인 | Checking other tabs |
| task.step.safety | 안전 복사본 만들기 | Making a safety copy |
| task.step.replace | 데이터 교체하기 | Replacing data |
| task.step.verify | 저장 확인 | Verifying the save |
| task.count | {done} / {total} | {done} / {total} |
| task.cancel | 취소 | Cancel |
| task.cancel.unsafe | 이 단계는 중간에 멈출 수 없어요 | This step can't be stopped midway |
| task.background | 백그라운드에서 계속 | Keep going in the background |
| task.cancelling | 정리하는 중 | Wrapping up |
| task.paused.tab | 다른 탭이 열려 있어요. 닫으면 이어져요 | Another tab is open. Close it to continue |
| task.done.backup | 백업을 저장했어요 · {file} · {size} | Backup saved · {file} · {size} |
| task.done.import | {n}개 추가했어요 | Added {n} |
| task.done.skips | {n}개는 건너뛰었어요 | {n} skipped |
| task.failed.state.same | 지금 데이터는 바뀌지 않았어요 | Your data wasn't changed |
| task.failed.state.unknown | 교체가 끝났는지 확인하지 못했어요. 지금 데이터는 옛것, 복원한 것, 둘이 섞인 것 중 하나예요 | Couldn't confirm the replacement. Your data may be old, restored or mixed |
| task.retry | 다시 시도 | Try again |
| task.retry.failed | 실패한 {n}개만 다시 | Retry the {n} that failed |
| task.skip.reason.large | 너무 커서 건너뛰었어요 | Skipped: too large |
| task.skip.reason.invalid | 읽을 수 없어요 | Couldn't be read |
| task.skip.reason.notstored | 저장되지 않았어요 | Not stored |
| task.skip.more | 외 {n}개 보기 | {n} more |
| task.leftout.title | 이 파일에 담기지 않은 것 | Not in this file |

Hard-coded English in the app (A-17) means KO strings for these flows need new language keys, not reuse.

---

## 8. Accessibility

- **Roles.** Warning sheet: `role="alertdialog"` with `aria-labelledby` the headline and `aria-describedby` the consequences, for `confirm`/`danger`/`blocked`; banners `role="status"` (caution) or `role="alert"` (blocked failure). Task card: `role="group"` named by the title; bar `role="progressbar"` with `aria-valuemin/max/now` and `aria-valuetext` "{done} / {total}", like the boot bar.
- **Focus.** `danger`: Cancel is first focus. `confirm`: the safe choice is first focus. On state change `running` → `done/failed` focus moves to the result headline (`tabindex=-1`), not to a button. On cancel, focus returns to the control that opened the flow. Chip form: focus stays where it is; the result is announced, not focused. Focus stays within an `alertdialog` (trap) and Esc = Cancel when Cancel is safe; while running without Cancel, Esc does nothing and the status says why.
- **Live region.** One polite region `pattern-task-status`. Announce **steps and state, not percentages**: step label changes, `paused`, `cancelling`, `done`, `failed`, and one summary at the end. Counts go in the progressbar value text, which updates without announcing (boot's `bootAnnouncement` rule). Result card summary and the skipped count are announced once ("3개 건너뛰었어요"); individual skipped items are navigable, not read.
- **No colour-only.** Severity and state also change the mark's shape and add text ("건너뜀", "실패").
- **Targets.** 44 touch / 40 hover (DD-213) for actions; the 32px floor is the pack floor, not the default.
- **Keyboard.** Disclosure toggles on Enter/Space; step list is not a tab stop; skipped list items are focusable only when they have an action ("보기").
- **Reduced motion.** The bar fill changes without transition; the "working" sweep becomes a steady tint (the boot rule); the status mark shows its state by shape/tint without moving (DD-211: low power keeps the mark); the result card appears without slide. Same states, same text.
- **Forced colours.** Copy the boot tiering: Highlight fill, CanvasText border, failed state uses a different shape plus `Mark`/`LinkText`.
- **Screen reader order.** Headline → consequences → detail → actions; for tasks: title → status → bar value → actions → result.
- Not verified here: any of the above was specified from the boot and Studio code, not tested with assistive tech.

---

## 9. Motion (placeholder)

Motion belongs to a separate contract: [MOTION_CONTRACT.md](MOTION_CONTRACT.md) (path reserved; planner is writing it; this document links to it and does not duplicate it). DD-222 fixes the bounds: motion only for progress and state changes, within the Note 9 / Pi 3 budget; reduced motion = same states, no movement; low power keeps the status mark (DD-211). Open handoff points for that file: sheet enter/exit, step-to-step transition, bar fill and the "working" sweep, result-card replacement, skipped-count highlight, chip appear/dismiss, cancel settle, undo-countdown visual (Q2), low-power still tint. This spec assumes every animation is transform or opacity (boot rule) and every state has a still equivalent.

---

## 10. Validation expected before acceptance (nothing run yet)

- Mockup: the data-and-backups page rebuilt on this pattern, at desktop and phone widths, in `?lang=ko|en`, with reduced motion and low power; keyboard run through confirm → running → each end state.
- Theme: both bundled packs (Origin Navy, Banana Cocoa) and a hostile pack that zeroes edge, tint, height and font; lint passes with the registry fragment; hostile pack is rejected or clamped.
- Copy: every consequence line carries a count, size or name; no confirm uses "확인/OK".
- Assistive tech: one screen-reader pass (NVDA/TalkBack) and a forced-colours pass. Recorded as observed or marked not run.

---

## 11. Rollout map

Order is by risk and by what already exists. "Owner" is the lane that edits its own files; the pattern owner provides the shared CSS/JS/tokens and the registry fragment. Owners are proposals (lane names as used in the workspace: chat, Settings, Studio, Home/mockups, Lane A = engine, main session = integration).

| Wave | Surface (inventory ids) | Why this order | Owner | Depends on |
|---|---|---|---|---|
| 0 | Shared pattern: tokens, part CSS, JS state helper, registry fragment, pattern test page | everything below consumes it | pattern owner (shared; not any lane) | Q6, this spec accepted, MOTION_CONTRACT |
| 1 | `mockups/data-and-backups.html`: restore review/progress/endings, export, cleanup (M-1..M-8) | richest content, already has states and "known data state" copy; becomes the reference page | mockups owner | wave 0, Q1, Q3, Q10; DD-198 retrofit also lands here |
| 2 | Boot and first-run: startup recovery card (M-10, M-11), onboarding restore (M-12) | reuse of boot model; ties DD-221 to the real source | mockups owner | wave 1 result card |
| 3 | Settings data rows and backups (S-2..S-5), bundle export (S-19), cache clear (S-54), local model download (S-55), connection test (S-32), plugin update (S-46) | the data surfaces users find first; key-inclusion and progress gaps | Settings lane | wave 1; Q4, Q11 |
| 4 | Settings destructive confirms (S-9, S-14, S-17, S-21, S-22, S-26, S-28, S-33, S-42, S-47, S-48, S-50) restyled to warning anatomy; fix S-6/S-7 stale copy and S-37/S-38 inconsistency | many rows share the anatomy; copy fixes are cheap | Settings lane | wave 3 |
| 5 | Home: move/empty/restore from 최근 삭제 (M-14..M-16), runs (M-17/M-18) | small, already critical; adds counts | Home owner | wave 1 |
| 6 | Chat: export/import chat (C-15..C-17, from "simulated" toast to task), deletes (C-2, C-9, C-23), discard (C-20, C-30), failed save (C-33) | chat is the largest surface; confirms already critical | chat lane | wave 3-5; Q2 |
| 7 | Studio: image import task chip (T-31..T-36), apply/leave/restore point (T-1, T-6, T-8), asset-used-in warning (T-38), close-Studio undo warning (T-7), new card/lorebook import-export if added (T-30, T-48) | already has the best protected-surface plumbing; export/import slices are unmocked | Studio lane | wave 3; DD-191/196 |
| 8 | Engine requests to Lane A: leave-out list (Q1), cancel points (Q3), grouped import undo (Q5), unified progress + localised strings (A-17, A-41) | needed for implementation, not for mockups | Lane A / main session | decisions on Q1, Q3, Q5 |

Integration map (for the main session): each wave maps to the app's `alertConfirm` / `alertWait` / `alertNormalWait` / `alertMd` call sites listed in inventory section A. The pattern replaces the `alert*` renderings inside AlertComp (ask, wait, markdown, cardexport) and gives `alertWait` structured progress (step, count, cancel) instead of text; `alertProgress` does not exist, so a task object is a new type. Nothing here was verified against the app's alert store behaviour beyond reading `alert.ts`.

---

## 12. Missing evidence and risks

- Static reading only: no mockup, page or hostile-pack lint was run for this document.
- The `.bin` leave-out list cannot be built from source (inventory A-41); the example items are inferred from design docs.
- Cancel safety, background continuation, and grouped import undo are engine questions, not design facts.
- The proposed floors and ceilings were not run through `packlint.mjs`; they reuse Studio's values only where the token meaning matches.
- Hard-coded English strings in the app's backup flow (A-17) mean the copy table assumes new language keys.
- The MC-774 rulings are relayed by Lane A and, per the design docs, not separately confirmed here.
