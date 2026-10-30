# Chat slice 3 — group chats

Status: **revision 3** (2026-10-25; revision 2 applied [the independent review](../reviews/2026-10-25-chat-slice3-review.md) and DD-059 to DD-065, section 15; revision 3 applies [the re-review](../reviews/2026-10-25-chat-slice3-rereview.md), section 16). Task: [tasks/2026-10-25-chat-conversation.md](../tasks/2026-10-25-chat-conversation.md). Builds on [SLICE1_SPEC.md](SLICE1_SPEC.md) (prose blocks, alternatives row, regenerate gesture, sheets, motion tokens, undo row, Korean particle helper) and [SLICE2_SPEC.md](SLICE2_SPEC.md) (sidebar, generation strip, "This chat" sheet and scope tags, Back stack, background generation). Decisions: DD-049 (pain points: next speaker, auto mode, setup buried), DD-050 (scope incl. creation), DD-051 to DD-058, and from the review DD-059 (queued members only, with a hint), DD-060 (Home ends auto mode), DD-061 (the bar's Stop), DD-062 (muted members in the first-message panel), DD-063 (skipped members marked), DD-064 (member colours fixed per member), DD-065 (at least one member) in [DECISIONS.md](../DECISIONS.md). Source facts: [research/slice3-group-chats.md](research/slice3-group-chats.md) (cited as R§n).

Scope: speaker identity on group replies, the member strip and next-speaker control, Stop/errors/regenerate in a round, auto mode, the member panel, creating a group, first messages of a new group chat, missing members. Out of scope: long-chat performance (slice 4), the character editor (Studio), what members say (prompting), display scripts for groups (open question O-1).

Marked **(design default)** = chosen here within the decided intent, open to the maintainer's veto.

## 0. Today (source-checked, R§1–9)

| Area | Today |
|---|---|
| Speaker | Every reply shows the group's name and picture; `saying` (member id) is stored but never shown (R§1). |
| Turn | One send = a round: chosen members speak one after another, each its own streamed message. Random mode: members named in the last message first, then each by talkativeness (1/6–6/6); the last speaker is dropped. "Talk by Order": every active member in list order (R§2, R§5.1). Nothing names who is up. |
| Stop / error | Stop ends the current reply and drops the rest of the round; an error ends the round, an alert or an inline error block (R§2). |
| Regenerate | Redoes the whole trailing round; speakers may change; alternatives are whole-round pieces kept in memory (R§3). Two greetings only: does nothing, silently. |
| Continue | In a group it runs another round with no user message (inferred, R§3). |
| Auto mode | Composer menu toggle; loops rounds; stops on Stop, toggle, switch away, error, or 50 quiet ticks; the only sign is a class on the busy button; user can type but not send (R§4). |
| Members | Edited only in character settings: avatar grid (tap = remove, no confirm), six bars, Active check, avatar-only picker; no reorder (R§5). Deleted members linger as "Unknown Character". |
| Creation | Add-character modal → "Create Group Chat" makes a blank group (no name, no members) (R§7). New chat seeds every member's first message without asking; alternates unused. |

## 1. Speaker on each reply (DD-052)

- A group reply's name row (slice 1 §1.1 prose block) shows the **speaking member's** avatar (24 dp) and name, from `saying`. The header keeps the group's avatar and name, with the chat name subtitle (DD-042).
- **Member colour (DD-064):** each member gets one of eight colour slots **when they join** and keeps it: reordering, removing others or undoing never recolours old messages (a new member takes the first free slot). The eight colours are tokens `--chat-speaker-0` to `--chat-speaker-7` (design-local in `slice3.css`; proposed for the shared tokens). Colour is never the only cue (the name is always shown unless C-6 hide-names is on; then the avatar stays, DD-024).
- Hide names and avatars (C-6, per chat, DD-024) hides member names as it does for 1:1; in a group the avatar is kept at **24 dp ringed in the member's colour** because it is the only speaker cue (polish; was 20 dp).
- **A group's own avatar** (header, sidebar, recent strip) is a `users` glyph on the violet disc, never an initial, so a group never looks like its first member (review verdict 8).
- **Missing member** (DD-058): the name row shows "삭제된 캐릭터" with a dashed placeholder avatar. Lane A keeps a name for it (O-3); the mockup shows the stored-name variant and the fallback.
- Accessible name of the block: "{member}의 메시지" (particle helper) / "Message from {member}".
- Bookmarks, export, copy and the sidebar's last line use the member's name (already true for bookmarks/export, R§1).

## 2. Member strip (DD-051)

Shown above the composer in group chats only. One row, 48 dp, horizontally scrollable, never wraps.

```
[ ⟳ 자동 ]  (세)  (주)  (미)̶  (?)   ⋯
```

- **Leading:** the auto-mode switch (§5), lucide `repeat` icon + "자동" label (short label kept because the switch's state must read). **Below 400 dp the switch is icon-only** (44 dp; its name "자동 진행" stays in `aria-label` and the tooltip), so the switch, five members and `⋯` fit a 360 dp row (and 320 dp with the separator and end padding dropped); N1.
- **Members**, in member order (44 dp cells): 32 dp avatar + first name under it (4 characters and an ellipsis in KO, 7 in EN; a missing member reads "삭제됨" / "Deleted", the full name stays in the accessible name; m3), 44 dp hit area. Each button's tooltip and `aria-keyshortcuts` show its **Alt+n** shortcut (m4). States (each with a non-colour cue):
  - default;
  - **next** (queued): accent ring + order badge "1", "2"… ;
  - **speaking**: spinning ring (static ring + "…" in reduced motion / low power);
  - **muted**: 40 % opacity + `volume-x` badge;
  - **missing**: dashed ring + `alert-triangle` badge;
  - **skipped** (DD-063): dotted ring + `skip-forward` badge and "건너뜀" in the name, for members who did not get their turn after a Stop, an error or auto mode ending; cleared when the next round starts;
  - **cold** (archived, restores on its turn): no badge; a failed restore turns it missing for this round only.
- **Trailing `⋯`**: opens the member panel (§6) in the "This chat" sheet. It sits in the row's normal flow with 8 dp of end padding (no overlay; M1): when the row is wider than the screen it scrolls, and nothing is ever covered.
- **Run bar row (DD-055, M1):** while auto mode runs or has just ended, a 48 dp bar row sits **above** the member row (see §5). The member row then drops the Auto switch and keeps its full width, so all five members and `⋯` fit and are tappable at 360.
- **Tap a member** = queue them for the **next round** (once). Tapping more members queues them in tap order; tap a queued member again to unqueue. With anyone queued, the next round is **only the queued members, in that order** (DD-059). The queue clears after that round, on Stop, and on chat switch (m1; it is cleared when the chat is left). **The message box says who will answer (DD-059, M2):** the placeholder becomes "세라핀, 주노만 답해요" / "Only Seraphina, Juno will answer" while someone is queued, and Send's name says it too ("보내기 · {names}만 답해요" with text, "{names} 차례" with an empty box). The first time anyone is queued a one-time tip says "고른 멤버만 다음 라운드에 말해요.". Tapping a **muted** member does not queue: it opens that member's menu (the reason is announced, Rejoin is offered; m2); tapping a missing member gives the reason in a toast.
- **Send** with text runs a round after your message. With an empty box and someone queued, Send's label/aria becomes "{name} 차례" / "Let {name} speak" and runs a round with no user message. With an empty box and nobody queued, Send stays disabled (today's "say nothing" filler is off for groups); "한 라운드 더" in the + sheet runs a normal round with no message (today's Continue, renamed, design default).
- **Member menu** (long-press, right-click, Shift+F10, or the member's row in the panel): "다음에 말하기" (queue), "쉬게 하기 / 다시 참여" (mute = `characterActive`, for this group), talkativeness (§6), "캐릭터 보기", "그룹에서 빼기" (undo row, DD-023 pattern).
- **Keyboard:** the strip is one tab stop **including the run bar's Pause and Stop** (N2: they come first in the arrow order, then the members and `⋯`); ←/→ move between members (roving), Enter/Space queues, Shift+F10 or the menu key opens the member menu. Alt+1…9 queue member n, counting muted and missing members too (they refuse with the reason; stable numbers beat shifting ones); guarded like DD-047 (ignored in text fields, sheets, menus, Home). The shortcut is optional and listed in each tooltip.
- **Narrow layouts:** with the on-screen keyboard open, the member row shrinks to 36 dp (avatars 24 dp, no names) to keep the reading space (slice 1 §1 targets). **The run bar folds into that row** (N3): a repeat icon, the round number, Pause and Stop (36 dp), the full text in its accessible name; no separate bar row, so 360×640 with the slice 2 strip, auto mode and the keyboard keeps at least 190 dp of transcript. While the keyboard is open the slice 2 blocked-Send placeholder is the one-line "다른 채팅 작성 중" / "Writing elsewhere" (the full reason returns without the keyboard).
- **Slice 2 strip coexistence:** the generation strip (DD-041) is at the top; the member strip is at the bottom. Both can show.

## 3. A round on screen

- While a round runs, the member strip carries its progress: the speaking member's avatar spins, members still to speak this round get a small "대기" dot, and finished ones lose it. Screen readers get one polite announcement per speaker change: "{member} 차례" and nothing else for that reply (slice 1's "reply n of N" is silent for group replies; m7). In auto mode the announcement is per round ("자동 진행 · 3라운드 · 다음 …"), not per speaker. A member removed or muted while a round runs is skipped silently (m12).
- Each reply streams into its own block (slice 1 streaming rules, append-only, adaptive cadence).
- **Stop (DD-054, DD-063):** ends the current reply (the partial text stays) and cancels the rest. An inline **round notice** (same component as slice 1's undo row, no timer) appears after the last block: "{A}의 답변을 멈췄어요 · {B}, {C} 건너뜀" with action **"{B}, {C} 차례 이어가기"** (queues them and runs). **The skipped members are also marked in the member row** (dotted ring + badge) until the next round starts. The notice disappears on the next Send or round.
- **Error:** same notice, "{B}의 답변이 실패했어요 · {C} 건너뜀" with **"다시 시도"** (retries B, then C) and "자세히" (the error detail sheet). No alert modal (slice 2 §2.2 rule extended).
- **Missing or failed-restore member** in a round: skipped with a notice line "{name}은 그룹에 없어서 건너뛰었어요" (missing) or "… 불러오지 못해 건너뛰었어요" (restore failed); no modal.

## 4. Regenerate in a group (DD-053)

- The slice 1 gestures (pull, hold, let go; New reply; Ctrl+Alt+R) on the **last reply** redo **only that reply, same speaker**. Its alternatives row ‹ n/N › is per message, as in 1:1.
- **"이 라운드 다시"** (message menu on any reply of the last round, and the + sheet) keeps today's behaviour: the trailing round is removed and a new round runs; speakers may change. It confirms only when it would remove more than one message (DD-023: confirm for many), naming the count.
- An earlier reply of the last round (not the last message) offers **"새 답변"** (the same word as on the last reply; m10) in its menu only; choosing it explains "이 답변을 다시 만들면 뒤쪽 답변 {n}개가 지워져요." (no bare number) and offers "이 라운드 다시" instead; the sheet's buttons are full-width rows so the label never wraps mid-word. With only first messages the New reply button looks disabled (`aria-disabled`, reason in its description) and pressing it shows the reason (m11).
- Two greetings only: New reply / gesture show the refusal reason "첫 메시지만 있어서 다시 만들 답변이 없어요" (slice 2 visible refusals).
- Lane A: per-message alternatives in groups replace the whole-round reroll pieces for this action (R§3). Engine change.

## 5. Auto mode (DD-055)

- **Start:** the strip's "자동" switch. Starting needs a member able to speak; otherwise the switch refuses with a reason ("말할 수 있는 멤버가 없어요").
- **Run bar (M1, DD-061):** while on, a 48 dp bar row above the member row reads "자동 진행 · {n}라운드 · 다음 {member}" (one line, ellipsis) with **Pause** (`pause`) and **Stop** (`square`) icon buttons (44 dp, named) **separated by a gap and a divider** (at least 12 dp; they never touch). The member row below keeps its full width and every member stays tappable: queueing during auto mode decides the next round. The bar enters with a short fade/slide once (fade in reduced motion, none in low power).
- **Pause:** the current reply finishes, then the **rest of the round is held** (the next member keeps its waiting dot); the bar reads "일시정지 · {n}라운드 · 다음 {member}" with Resume (`play`) and Stop. Sending a message while paused plans the held round again from it (mention rule applies) and a status line says "계속을 누르면 이어서 답해요 · 다음 {member}"; Resume continues. Paused auto mode survives nothing else: switching chats or going Home ends it.
- **Stop (DD-061):** the bar's Stop is the composer's Stop: it cuts the current reply now (partial text kept), shows the standard skipped-members notice with the resume action (§3), marks them in the strip, **and** ends auto mode (reason "직접 멈춤"). With no reply running (paused) it ends auto mode and notes who did not get their turn. Focus returns to the Auto switch afterwards (m8).
- **Going Home (DD-060):** leaving the chat for Home ends auto mode after the current reply (reason "다른 화면으로 이동"); the rest of the round is not run and the members who did not get their turn are noted in the chat like after a Stop. Switching chats ends it at once (reason "다른 채팅으로 이동").
- **Sending during auto mode** (engine change): with text in the box Send is a real Send (with an empty box it stays Stop). Your message goes in after the current reply, the rest of the round is planned again from it (the mention rule applies), the loop continues, and a status line says so with a **"되돌리기"** button. If auto mode ends first (Stop, Home, another chat, error) the text **goes back into the message box** and is never inserted into a later round (M4).
- **End and reason:** when it ends the bar shows for 6 s (or until focus leaves it, slice 2 B4 rule): "자동 진행을 멈췄어요 · {reason}" with reasons: 직접 멈춤 / 오류 ({member}) / 말할 차례가 없음 (today's 50 quiet ticks) / 다른 채팅으로 이동 (slice 2 strip text for the background case) / 다른 화면으로 이동 (Home). The ended bar is the same 48 dp row and the Auto switch is already back in the member row. **After Home (N4)** the ended bar waits and is shown for 6 s from the user's first return to the chat, so the reason is never missed.
- Reduced motion / low power: no spinning; counters update in place.
- Not persisted (today's `autoMode` field stays unused; O-4).

## 6. Member panel (This chat sheet, DD-050)

A group's "This chat" sheet (slice 2 §3) gains a **멤버** group under the **이 그룹** scope (the group is the "character" scope; tag `users`, violet, DD-043). The **members come first** in the sheet (the reason people open it): order mode, the member rows, "멤버 추가", and only then the group name and picture (m17). Rows:

- Each member: drag handle (`grip-vertical`; keyboard: Alt+↑/↓ on the handle), avatar + name, **one line "말 수 5/6"** (hidden in "순서대로"), a mute switch with **visible text** ("참여" on / "쉬는 중" off) named "{name}: 참여" (on = takes part; m16), and `⋯`. A sitting-out member also carries the "쉬는 중" tag **inline after the name** (not on its own line).
- **Row menu (`⋯`, M8, WCAG 2.5.7):** 말 수 (the 6-step control with end labels 적게 / 많이, 1/6–6/6, today's data), 캐릭터 보기, **위로 옮기기 / 아래로 옮기기** (44 dp buttons, disabled at the ends; the menu stays open with focus on a move button), 그룹에서 빼기. Dragging stays as an extra. Muting is the separate switch (`characterActive`), so 0 stays unreachable as today.
- **Order mode:** segmented "말 수에 따라 / 순서대로" (`orderByOrder`; the first label says the draw is weighted, not a strict ranking), with help text under the first: "메시지에서 이름을 부르면 그 멤버가 먼저 말해요." (mention rule, R§5.1; the mention rule applies only in this mode). Replaces both of today's "Talk by Order" checks.
- **멤버 추가:** opens the member picker (§7.1) in add mode. Adding offers the member's first message for this chat as today, now as a choice in the picker's footer ("첫 메시지도 넣기", off by default; design default).
- **Remove (DD-065):** undo row in the panel (6 s), not a confirm. The group may go down to **one member**; removing the last member is refused with the reason "그룹에는 멤버가 한 명 이상 있어야 해요" (the item is disabled, **a visible line "그룹에는 멤버가 한 명 이상 있어야 해요" sits under it** (panel row menu and the strip's member menu; N5), the reason is its description, and pressing shows a toast). Creating a group still needs two (§7.1).
- **Missing members** (DD-058): shown first with a dashed avatar, "삭제된 캐릭터", and **"빼기"** as the row's primary action.
- Group name and picture are edited at the end of the group (an emptied name is not accepted and reverts); picture options: 멤버 사진으로 만들기 (today's composite) / 사진 고르기.

## 7. Creating a group (DD-056) and first messages (DD-057)

### 7.1 Create sheet

Entry: wherever "new character" lives (today's add-character modal; Home's create action per MAIN_MENU.md), item "그룹 채팅 만들기".

One sheet (full-height on phones, 560 px panel on wide):

1. **Members:** search (초성, as slice 2), list of characters with avatar **and name**, multi-select checkboxes; selected members appear as chips at the top in selection order (that order = member order). **A chip opens a small menu: 앞으로 옮기기 / 뒤로 옮기기 / 빼기** (a non-drag way to order them, WCAG 2.5.7); Alt+←/→ on a chip does the same.
2. **Name:** prefilled from the members ("세라핀, 주노, 미라", more than three → "세라핀, 주노 외 2명"; one joiner, ", ", everywhere), editable; stays in sync with selection until the user edits it. An emptied name goes back to the automatic one, and Create never makes a nameless group (m14).
3. **Order mode:** the §6 segmented control, default "말 수에 따라".
4. **Picture:** a labelled row "그룹 사진" with a composite preview of the first three chosen members and the note "멤버 사진으로 만들어져요 · 나중에 바꿀 수 있어요" beside it (m15).
- **Layout with the keyboard (M6):** the whole sheet is one scrolling body; **Create and Cancel are a sticky action row** at the bottom (above the keyboard), the disabled reason sits in that row. With the keyboard open at 360x740 and 360x640 at least two character rows stay visible and typing in the search keeps its results on screen.
- **Create** (primary) enabled with ≥ 2 members; disabled state shows the reason "멤버를 두 명 이상 골라 주세요". **Cancel, Back, Esc, a tap outside and drag-down all ask once** ("만들던 그룹을 버릴까요?" with 계속 만들기 / 버리기) when anything is chosen, and close at once when nothing is; Back or Esc on the question means "계속 만들기" (M7). The member picker (add mode) asks the same way when someone is ticked.
- After Create: the group opens and its first chat goes straight to §7.2.

### 7.2 First messages of a new group chat

Shown for "새 채팅" in a group and right after creation: an inline **start panel** in the empty transcript (not a modal):

- One row per member, in member order: checkbox (ticked), avatar + name, the first message's first two lines, and an alternates pager ‹ 1/3 › when the member has alternate first messages.
- **"시작하기"** inserts the ticked messages in order (with `saying`) and focuses the composer. **"비우고 시작"** starts empty.
- Archived members restore when the panel opens (a loading state is not built in the mockup); a failure disables that row with the reason.
- **Muted members (DD-062)** are listed **unticked** with a "쉬는 중" tag and can be ticked. Previews render *emphasis* as italics.
- **The panel is resolved by every way of starting (M9):** a typed Send, a queued "{name} 차례", "한 라운드 더" and Auto first insert the ticked first messages in member order and close the panel, then start; nothing the user ticked is dropped silently.
- If no member has a first message, the panel is skipped.
- The choice is per chat; nothing is remembered (design default).

## 8. Background generation and groups (slice 2)

- A round keeps running when switched away (slice 2 §2.2). The generation strip reads "{group} · {member} 답변 쓰는 중" (row 1 the chat name, row 2 the status, N2 layout).
- Auto mode ends on switch, as today (strip says so), and when the chat is left for Home (DD-060).
- Round notices (§3) wait in the chat; the sidebar row carries the failed mark for an error.
- Cold-restore failures mid-round in the background: notice line in that chat + failed mark, never a modal over another chat.

## 9. Motion

Tokens from slice 1 (120/200/260 ms). Queue badge: scale 0.6→1 + fade, 120 ms. Speaking ring: rotate, 1 s linear loop (static in reduced motion/low power). Run bar expand: transform/opacity only, 200 ms; the member avatars shift with `translateX`, not width. Start panel rows: fade in, 120 ms stagger 30 ms, no stagger in reduced motion.

## 10. Korean copy (proposed keys, en / ko)

| Key | en | ko |
|---|---|---|
| groupMessageFrom | Message from {name} | {name}의 메시지 |
| missingMember | Deleted character | 삭제된 캐릭터 |
| autoSwitch | Auto | 자동 |
| speakNext | Speak next | 다음에 말하기 |
| letSpeak | Let {name} speak | {name} 차례 |
| oneMoreRound | One more round | 한 라운드 더 |
| muteMember / unmuteMember | Sit out / Rejoin | 쉬게 하기 / 다시 참여 |
| viewCharacter | View character | 캐릭터 보기 |
| removeFromGroup | Remove from group | 그룹에서 빼기 |
| turnOf | {name}'s turn | {name} 차례 |
| waiting | Waiting | 대기 |
| roundStopped | Stopped {a}'s reply · skipped {list} | {a}의 답변을 멈췄어요 · {list} 건너뜀 |
| roundResume | Let {list} speak | {list} 차례 이어가기 |
| roundFailed | {a}'s reply failed · skipped {list} | {a}의 답변이 실패했어요 · {list} 건너뜀 |
| memberSkippedMissing | Skipped {name}: not in the group | {name}은 그룹에 없어서 건너뛰었어요 |
| memberSkippedRestore | Skipped {name}: couldn't load | {name}을 불러오지 못해 건너뛰었어요 |
| redoRound | Redo this round | 이 라운드 다시 |
| redoRoundConfirm | Remove {n} replies and redo the round? | 답변 {n}개를 지우고 이 라운드를 다시 할까요? |
| regenOnlyGreetings | Only first messages so far, nothing to redo | 첫 메시지만 있어서 다시 만들 답변이 없어요 |
| autoRunning | Auto · round {n} · next {name} | 자동 진행 · {n}라운드 · 다음 {name} |
| autoPaused | Paused · round {n} | 일시정지 · {n}라운드 |
| autoPause / autoResume / autoStop | Pause / Resume / Stop | 일시정지 / 계속 / 멈추기 |
| autoEnded | Auto mode stopped · {reason} | 자동 진행을 멈췄어요 · {reason} |
| autoReasonUser / Error / Quiet / Switched | by you / error ({name}) / nobody's turn / moved to another chat | 직접 멈춤 / 오류 ({name}) / 말할 차례가 없음 / 다른 채팅으로 이동 |
| autoNoSpeaker | No member can speak | 말할 수 있는 멤버가 없어요 |
| membersGroup | Members | 멤버 |
| scopeGroup | This group | 이 그룹 |
| talkativeness | Talkativeness | 말 수 |
| talkLess / talkMore | Less / More | 적게 / 많이 |
| orderRandom / orderList | By talkativeness / In order | 말 수에 따라 / 순서대로 |
| mentionHelp | Name a member in a message and they speak first. | 메시지에서 이름을 부르면 그 멤버가 먼저 말해요. |
| addMember | Add member | 멤버 추가 |
| addWithFirst | Also add their first message | 첫 메시지도 넣기 |
| createGroup | Create group chat | 그룹 채팅 만들기 |
| createNeedTwo | Pick at least two members | 멤버를 두 명 이상 골라 주세요 |
| groupNameMore | {a}, {b} and {n} more | {a}, {b} 외 {n}명 |
| pictureLater | You can change this later | 나중에 바꿀 수 있어요 |
| startChat / startEmpty | Start / Start empty | 시작하기 / 비우고 시작 |
| restoreFailedRow | Couldn't load this character | 이 캐릭터를 불러오지 못했어요 |

| blockedShort | Writing elsewhere | 다른 채팅 작성 중 |
| queueHint / queueTip / sendOnly | Only {names} will answer / Only the members you tap speak in the next round. / Send · only {names} will answer | {names}만 답해요 / 고른 멤버만 다음 라운드에 말해요. / 보내기 · {names}만 답해요 |
| autoReasonAway / roundEndedSkipped | moved to another screen / Auto mode ended · skipped {list} | 다른 화면으로 이동 / 자동 진행이 끝나서 {list} 건너뜀 |
| autoPausedNext / pausedSendNote | Paused · round {n} · next {name} / Resume and they answer · next {name} | 일시정지 · {n}라운드 · 다음 {name} / 계속을 누르면 이어서 답해요 · 다음 {name} |
| pendingNote / pendingCancel / pendingReturned | Your message goes in after this reply / Take it back / Your message is back in the box | 내 메시지는 이 답변 뒤에 들어가요 / 되돌리기 / 메시지를 입력창으로 되돌렸어요 |
| stSkipped / sittingOutTag | skipped / Sitting out | 건너뜀 / 쉬는 중 |
| lastMemberRefuse | A group needs at least one member | 그룹에는 멤버가 한 명 이상 있어야 해요 |
| moveUp / moveDown / chipEarlier / chipLater / chipRemove | Move up / Move down / Move earlier / Move later / Remove | 위로 옮기기 / 아래로 옮기기 / 앞으로 옮기기 / 뒤로 옮기기 / 빼기 |
| regenOne / regenEarlierN | New reply / Redoing this reply removes {n} later replies of this round. | 새 답변 / 이 답변을 다시 만들면 뒤쪽 답변 {n}개가 지워져요. |
| groupPictureNote / talkValue / missingShort | Made from the member pictures · you can change this later / Talkativeness {n}/6 / Deleted | 멤버 사진으로 만들어져요 · 나중에 바꿀 수 있어요 / 말 수 {n}/6 / 삭제됨 |
| partLabel / shortcutTitle / firstAdded | Takes part / {name} (Alt+{n}) / Added {n} first messages | 참여 / {name} (Alt+{n}) / 첫 메시지 {n}개를 넣었어요 |
| stNext / stSpeaking / stMuted / stMissing / stWaiting | next, number {n} / speaking / sitting out / not in the group / waiting | 다음 순서 {n}번 / 말하는 중 / 쉬는 중 / 그룹에 없음 / 대기 중 |
| mutedCantQueue / missingCantQueue / removedMember / undoRemove | {name} is sitting out / {name} is not in the group / Removed {name} from the group / Undo | {name}은 쉬는 중이에요 / {name}은 그룹에 없어요 / {name}을 그룹에서 뺐어요 / 되돌리기 |
| retryBtn / detailBtn / errorDetailText | Try again / Details / The provider returned an error while this member was writing. Nothing was kept from that reply. | 다시 시도 / 자세히 / 이 멤버가 답변을 쓰는 동안 제공자가 오류를 돌려줬어요. 그 답변은 남기지 않았어요. |
| discardCreate / keepEditing / discardBtn / cancelBtn | Discard this group? / Keep editing / Discard / Cancel | 만들던 그룹을 버릴까요? / 계속 만들기 / 버리기 / 취소 |
| pickerSearch / chosen / chooseChars / noMembersYet / nameAuto | Search characters / Chosen members / Characters / No members yet / Name follows the members until you edit it | 캐릭터 검색 / 고른 멤버 / 캐릭터 / 아직 멤버가 없어요 / 직접 고치기 전까지 이름이 멤버를 따라가요 |
| stripMemberWriting / stripMemberWritingAuto | {name} is writing a reply / {name} is writing | {name} 답변 쓰는 중 / {name} 쓰는 중 |
| membersLabel / moreMembers / autoOn / orderLabel / listNoTalk / reorderLabel / reorderMoved / talkOf / talkEdit | Group members / Members and settings / Auto mode / Speaking order / Talkativeness is not used when members speak in order. / Move {name} / {name} is now number {n} / {n} of 6 / Talkativeness | 그룹 멤버 / 멤버와 설정 / 자동 진행 / 말하는 순서 / 순서대로 말할 때는 말 수를 쓰지 않아요. / {name} 옮기기 / {name}이 {n}번째가 됐어요 / 6단계 중 {n} / 말 수 |
| groupName / groupPicture / picFromMembers / picPick / removeMissing / memberMenu | Group name / Group picture / Make from member pictures / Choose a picture / Remove / Member options | 그룹 이름 / 그룹 사진 / 멤버 사진으로 만들기 / 사진 고르기 / 빼기 / 멤버 옵션 |

Particles (이/가, 은/는, 을/를, 와/과) through slice 1's helper, written `{name}(은)는` (the first form after a final consonant, the second after a vowel); the table shows the 받침-less form.

## 11. States the mockup must show

Group chat with 3 members + 1 missing + 1 muted; replies by different members incl. the missing one (stored name and fallback); strip default / queued (1, 2) / speaking / keyboard-open compact; empty-box Send as "{name} 차례"; round in progress with waiting dots; Stop notice with resume; error notice with retry; skipped-missing notice; regenerate last reply (per-message alternatives); "이 라운드 다시" confirm; earlier-reply regenerate explanation; greetings-only refusal; auto mode off / running / paused / ended with each reason; Send during auto mode; member menu; member panel (talkativeness, mute, reorder, order mode, add with picker, remove undo, missing first); create sheet (0, 1, 3, 5 members; name auto/edited; Cancel ask); start panel (alternates, untick, start empty, restore failure row, no first messages → skipped); background round in the slice 2 strip. Revision 2 adds: skipped members marked in the strip; auto mode ended by Home; the run bar row at 360 and 412; Pause/Stop gap; a message pending during auto mode and its return to the box; Send while paused; panel row menu (talkativeness, move up/down) and the last-member refusal; chip menu; create sheet with the keyboard open (360×740, 360×640) and its discard question from Back/Esc; first-message panel resolved by a typed Send, a queued turn, "한 라운드 더" or Auto; muted member row. Narrow 360×740, 412×915, wide 1280×800; KO and EN; reduced motion; low power; keyboard only; forced colours.

## 12. Integration map (lane A; nothing here edits these files)

| App file | Change |
|---|---|
| `src/lib/ChatScreens/Chats.svelte:129-139`, `Chat.svelte`, theme renderers | Resolve name/avatar per message from `saying` for groups; missing-member fallback |
| `src/ts/process/index.svelte.ts:704-760` (`sendChatBody` group branch), `src/ts/process/group.ts:74-116` | Queued-speaker round (only queued, in order); publish current speaker and remaining order for the strip; per-speaker skip notices instead of `throwError`/alert (`:762-767`, `:628-656`) |
| `src/ts/process/composerActions.svelte.ts:423-525` (reroll), `rerollHistory.ts` | Per-message regenerate in groups (same speaker); "redo round" keeps the piece logic; visible refusal for greetings-only |
| `src/ts/process/composerActions.svelte.ts:24-30, 661-706` (`runAutoMode`) | Pause/resume, round counter, next speaker, stop reason; allow Send during auto mode; expose state for the bar |
| `src/lib/ChatScreens/DefaultChatScreen.svelte:580, 665-681, 953-986` | Member strip; Send label for queued; "한 라운드 더" in the + sheet; remove the Auto Mode menu item |
| `src/lib/SideBars/CharConfig.svelte:254-330`, `SideChatList.svelte:480-486` | Member panel moves to the This chat sheet (reorder, talkativeness, mute, order mode); remove the duplicate checks |
| `src/ts/characters.ts:31-60, 1310-1342`, `lib/Others/AlertComp.svelte:458-482, 698-727` | Create sheet (members with names, name prefill, order mode, ≥ 2); picker shows names |
| New-chat seeding for groups (R§7) | Start panel with per-member choice and alternates |
| `src/ts/util.ts:348-360`, `characters.ts` `removeChar` | Missing-member state; keep a name for deleted members (O-3) |
| `src/lang/*.ts` | Keys in §10 |

## 13. Open questions (not decided; for the maintainer or lane A)

- **O-1** Display regex / additional assets / display trigger do not run for group messages (R§1.2). Should they run with the speaker as the character? Not asked yet; the mockup does not depend on it.
- **O-2** Continue in groups is inferred to run another round (R§3); lane A to confirm before "한 라운드 더" replaces it.
- **O-3** Where to keep a deleted member's name (snapshot on messages vs. a tombstone list on the group).
- **O-4** Whether auto mode should be remembered per group (the unused `autoMode` field).
- **O-5** `customHTML` themes and speaker names (R§1, unverified).

## 14. Design defaults to confirm

Decided since revision 1: queue = only queued members (DD-059), Home ends auto mode (DD-060), the bar's Stop (DD-061), muted members in the first-message panel (DD-062), skipped marks (DD-063), member colours fixed per member (DD-064), fewest members (DD-065). Still defaults: Alt+1…9 to queue (optional); empty Send disabled with nobody queued; "한 라운드 더" naming; compact strip with the keyboard open; Send allowed during auto mode (message returns to the box if auto mode ends first); earlier-reply regenerate offers "redo round" instead; add-member first message off by default; first-message choice not remembered; Pause holds the rest of the round; the run bar replaces the Auto switch (the switch returns in the member row when it ends); random order is weighted (the mockup uses a fixed formula).

## 15. Revision 2 summary (2026-10-25)

Changes by review id (review: [2026-10-25-chat-slice3-review.md](../reviews/2026-10-25-chat-slice3-review.md)); evidence per id in [checks/builder-checks.md](checks/builder-checks.md) "Slice 3 — review fixes".

| Id | Change | Section |
|---|---|---|
| M1 | Run bar is its own 48 dp row; members row full width; no sticky `⋯` (end padding) | 2, 5 |
| M2, DD-059 | Placeholder and Send say who will answer; one-time tip | 2 |
| M3, DD-060 | Home ends auto mode after the current reply, reason "다른 화면으로 이동" | 5, 8 |
| M4 | A message sent during auto mode returns to the box if auto ends; "되돌리기" | 5 |
| M5, DD-061 | Bar Stop = composer Stop + notice + ends auto; Pause/Stop separated | 5 |
| M6 | Create sheet scrolls as one body, sticky Create/Cancel, usable with the keyboard | 7.1 |
| M7 | Back/Esc/backdrop ask like Cancel; Esc on the question keeps editing | 7.1 |
| M8 | Panel row menu: move up/down; chip menu: earlier/later/remove | 6, 7.1 |
| M9 | First-message panel resolved by every round start; typed Send inserts ticked messages first | 7.2 |
| m1 | Queue clears on chat switch | 2 |
| m2 | Tapping a muted member opens the menu with the reason | 2 |
| m3, m4 | Short strip labels ("삭제됨"), Alt+n in tooltips | 2 |
| m6 | Paused bar names the next member; Send while paused plans again; note | 5 |
| m7 | One announcement per speaker; per round in auto mode | 3 |
| m8 | Focus returns to the Auto switch | 5 |
| m9, DD-063 | Skipped members marked in the strip and noted in the chat | 2, 3 |
| m10 | "새 답변" label; "뒤쪽 답변 n개가 지워져요"; buttons never wrap mid-word | 4 |
| m11 | Disabled-looking New reply with the reason | 4 |
| m12, DD-065 | Removed member is skipped in a running round; down to one member, last refused | 3, 6 |
| m13, DD-064 | Colour slot assigned at join; eight tokens | 1 |
| m14, m15 | Empty name falls back; picture row with note; one name joiner | 7.1 |
| m16 | Mute switch named "{name}: 참여" with visible text | 6 |
| m17 | Members first in the sheet; talkativeness one line; "말 수에 따라" | 6 |
| m18, DD-062 | Muted members unticked with "쉬는 중" in the first-message panel | 7.2 |
| polish | Hide-names avatar 24 dp ringed; italics in previews; group glyph avatar | 1, 7.2 |

Not changed: m5 (informational), the double encoding of `aria-pressed` plus the state phrase (kept: the phrase names the number, the attribute names the toggle state), the loading state for archived members and the "failed restore marks the member missing for this round" strip state (still not built), and the Home entry point for creating a group (MAIN_MENU.md).

## 16. Revision 3 summary (re-review, 2026-10-25)

Review: [2026-10-25-chat-slice3-rereview.md](../reviews/2026-10-25-chat-slice3-rereview.md); evidence in [checks/builder-checks.md](checks/builder-checks.md) "Slice 3 — re-review fixes".

| Id | Change | Section |
|---|---|---|
| N1 (major) | Auto switch icon-only below 400 dp, member cells 44 dp, row padding tightened: switch + five members + `⋯` fit at 360 and 320 | 2 |
| N2 | Pause and Stop are part of the same roving toolbar (one tab stop) | 2, 5 |
| N3 | With the keyboard open the run bar folds into the 36 dp member row; one-line blocked-Send placeholder | 2, 5 |
| N4 | The ended bar after Home is shown for 6 s from the first return | 5 |
| N5 | Visible reason line under the disabled removal of the last member | 6 |
| polish | "쉬는 중" tag inline after the name in the panel | 6 |
