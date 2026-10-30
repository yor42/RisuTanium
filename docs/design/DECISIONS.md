# Design decision log

One entry per maintainer decision for the UI overhaul. Lane A turns accepted entries into campaign `MC-` records when the overhaul is implemented; this file does not edit campaign records.

Format: ID, date, the maintainer's exact words (or the exact option labels they picked), the options offered, the outcome. Anything not recorded here as decided is OPEN. Proposals waiting for a decision are listed under "Open" with the task that raised them.

## Decided

### DD-001 — Priority order for the redesign work

- **Date:** 2026-10-25
- **Asked:** "Which screens or problems bother you most today?" and "Which DEFERRED_TBD / OPEN groups should we settle first?"
- **Options offered:** Chat / conversation; Character library; Settings & models; Studio / script editor. Open groups: Studio save & documents; Home first-run & tasks; Onboarding policies; 3-mode storage & Hybrid.
- **Maintainer's answer (exact labels):** screens "Chat / conversation, Settings & models, Studio / script editor"; open groups "Studio save & documents, Home first-run & tasks, Onboarding policies, 3-mode storage & Hybrid".
- **Outcome:** after the Android system-surfaces item, work proceeds Chat / conversation → Settings & models → Studio. All four open groups are wanted; they are taken up inside the screen tasks they touch (Studio save with Studio, 3-mode/Hybrid with Chat, Home first-run and Onboarding policies as their own small tasks). Character library was not picked and is not scheduled yet.

### DD-002 — Start the Android system surfaces now

- **Date:** 2026-10-25
- **Asked:** "Start the Android system-surfaces item (notification, launcher icon, splash, Back toast) now, in parallel with your ranking?"
- **Options offered:** "Yes, start now (Recommended)"; "Wait for my ranking".
- **Maintainer's answer:** "Yes, start now (Recommended)".
- **Outcome:** task [2026-10-25-android-system-surfaces](tasks/2026-10-25-android-system-surfaces.md) opened.

### DD-003 — Character identity in the generation notification

- **Date:** 2026-10-25
- **Asked:** "D-1/D-2/D-3: which character details should the generation notification show (never on the lock screen's public version)? Pick any; none = today's neutral notification."
- **Options offered:** "Avatar + name (Recommended)"; "Chat name"; "Reply preview" (multi-select; none = neutral).
- **Maintainer's answer:** "Avatar + name (Recommended)".
- **Outcome:** D-1 on (avatar as large icon, character name as title, state on the text line, reply states only); D-2 chat name off; D-3 reply preview off. Public version stays identity-free. SPEC §6.

### DD-004 — Live state while generating

- **Date:** 2026-10-25
- **Asked:** "D-4/D-5: what live state should the 'generating' notification carry?"
- **Options offered:** "Elapsed time only (Recommended)"; "Elapsed + progress bar"; "Elapsed + token numbers".
- **Maintainer's answer:** "Elapsed + token numbers" (not the recommended option).
- **Outcome:** system chronometer plus live numbers ("312 tokens · 24 tok/s" / "312토큰 · 초당 24토큰"; characters instead of tokens when usage is not streamed), at most one update per second, off in low-power mode, never in the Android 16 chip; no indeterminate bar (D-5 off). SPEC §3.1–3.2.

### DD-005 — Stop on the lock screen

- **Date:** 2026-10-25
- **Asked:** "D-13: should Stop work from the lock screen?"
- **Options offered:** "Unlock on 12+, keep on 10 (Recommended)"; "Keep everywhere"; "Remove from lock screen".
- **Maintainer's answer:** "Unlock on 12+, keep on 10 (Recommended)".
- **Outcome:** Stop on the public version uses `setAuthenticationRequired(true)` on Android 12+; Android 10 keeps a plain Stop. SPEC §4.

### DD-006 — Splash colour

- **Date:** 2026-10-25
- **Asked:** "D-10: splash colour, today light #3B82F6 / night #282A36 then #101828 loading. Proposed: #00011C (DEEP NEXUS canvas) from launch to boot screen, for all schemes."
- **Options offered:** "Dark for all (Recommended)"; "Follow system theme".
- **Maintainer's answer:** "Dark for all (Recommended)".
- **Outcome:** `splash_background` and `loading_background` `#00011C` in day and night; light bar icons off. SPEC §8.

### DD-007 — Notification tap target

- **Date:** 2026-10-25
- **Asked:** "D-6: when you tap the generating notification, where should it open?"
- **Options offered:** "The generating chat (Recommended)"; "Just the app (today)".
- **Maintainer's answer:** "The generating chat (Recommended)".
- **Outcome:** tap deep-links to the chat that is replying; if that chat was closed, the app opens normally. SPEC §2, §6.

### DD-008 — Korean Back/quit toast copy

- **Date:** 2026-10-25
- **Asked:** "D-11: Korean Back/quit toast copy?"
- **Options offered:** "뒤로 가기를 한 번 더 하면 종료됩니다 (Recommended)"; "Keep today's copy".
- **Maintainer's answer (own wording, via Other):** "종료하려면 뒤로 가기를 한번 더 누르세요"
- **Outcome:** ko `alerts.pressBackAgainToQuit` → "종료하려면 뒤로 가기를 한번 더 누르세요"; en unchanged. Note for the translator: standard spacing would be "한 번"; kept as written unless the maintainer changes it. Toast timing/position fix (SPEC §9) applies either way.

### DD-009 — Notice when notifications are denied

- **Date:** 2026-10-25
- **Asked:** "D-9: if notifications are denied, how should the app tell you the shade Stop is gone?"
- **Options offered:** "Once in chat + Settings (Recommended)"; "Settings line only"; "Nothing".
- **Maintainer's answer:** "Once in chat + Settings (Recommended)".
- **Outcome:** one inline notice in chat the first time work starts after a denial, plus a Settings › Android line reading the live permission state; never a dialog. SPEC §5.2.

### DD-010 — Defer Live Updates and reply-ready

- **Date:** 2026-10-25
- **Asked:** "D-12 and D-8, both later items: what should happen to Android 16 Live Updates and a persistent 'reply ready' notification for now?"
- **Options offered:** "Defer both (Recommended)"; "Plan Live Updates now"; "Plan reply-ready now".
- **Maintainer's answer:** "Defer both (Recommended)".
- **Outcome:** D-12 Live Updates stays off until the Tab S9 Ultra check and a policy call; D-8 reply-ready is decided after the base notification ships. Both remain listed below as deferred.

### DD-011 — Chat pain points

- **Date:** 2026-10-25
- **Asked:** "What bothers you most in the chat screen today (the real app)?" and "And these?"
- **Options offered:** Phone reading space; Message actions; Long chats & speed; Composer; Switching chats; Streaming display; Side panels & settings; Group chats (multi-select, plus Other).
- **Maintainer's answer (exact):** "Overall lack of animation feedback and gesture based controls - such as swipe reroll not having visual feedback at all, and non-touch reactive sidebar.,Phone reading space,Message actions,Long chats & speed,Composer" and "Nit: Streaming display shows CoT, image or CSS in plain text before generation completes the syntax or trigger scripts.,Switching chats,Side panels & settings,Group chats"
- **Outcome:** all eight areas are in scope; the maintainer's own first item (animation feedback and touch gestures: swipe reroll feedback, a sidebar that follows the finger) leads. Streaming raw-syntax leak is recorded as a nit.

### DD-012 — Chat starting point

- **Date:** 2026-10-25
- **Asked:** "The draft package already has a conversation mockup ... How should I start?"
- **Options offered:** "Rework from today's app (Recommended)"; "Fix the existing mockup".
- **Maintainer's answer:** "Rework from today's app (Recommended)".
- **Outcome:** new RP chat work starts from the current app's behaviour; `mockups/conversation.html` is reused only where its ideas hold up.

### DD-013 — Chat slicing

- **Date:** 2026-10-25
- **Asked:** "How should the Chat work be sliced? Slice 1 would be the phone chat shell + gesture/motion system: reroll that follows your finger, sidebar that tracks your finger, message action sheet, docked Korean-safe composer, streaming placeholders."
- **Options offered:** "Slice 1 as proposed (Recommended)"; "Switching & panels first"; "Long chats & speed first".
- **Maintainer's answer:** "Slice 1 as proposed (Recommended)".
- **Outcome:** Slice 1 = phone chat shell + gesture/motion system; then chat switching + one "This chat" settings sheet; then group chats; then long-chat performance.

### DD-014 — Swipe reroll behaviour

- **Date:** 2026-10-25
- **Asked:** "Swipe reroll: today it's arrow buttons, and the right arrow silently starts a new (paid) generation after the stored alternatives run out. What should swiping a reply do?"
- **Options offered:** "Browse; long pull = new (Recommended)"; "Browse only; button = new"; "Keep arrows, add motion".
- **Maintainer's answer:** "Browse; long pull = new (Recommended)".
- **Outcome:** the reply follows the finger through alternatives with "n / N"; past the last one a longer pull arms "Release to generate a new reply" with distinct feedback; a short swipe never starts a generation.

### DD-015 — Unfinished blocks while streaming

- **Date:** 2026-10-25
- **Asked:** "While streaming, unfinished blocks show as raw text ... What should an unfinished block look like?"
- **Options offered:** "Placeholder until closed (Recommended)"; "Dimmed raw text"; "Hide the reply until done".
- **Maintainer's answer:** "Placeholder until closed (Recommended)".
- **Outcome:** a placeholder chip stands in for an unfinished thinking block, image syntax or style block until it closes; partial CSS never applies early.

### DD-016 — Where the CSS leak is seen

- **Date:** 2026-10-25
- **Asked:** "You mentioned CSS showing as plain text mid-stream. Where do you see it?"
- **Options offered:** "Not sure; check on Tab S9"; "Inside code/markdown".
- **Maintainer's answer:** "Inside code/markdown".
- **Outcome:** the leak is CSS written without `<style>` tags or inside a code fence (e.g. from a card's display script); the streaming placeholder design must also cover an unfinished code fence and tag-less CSS that a display script would later wrap. Fact, not a product choice; recorded for traceability.

### DD-017 — Multiplatform input is a design constraint

- **Date:** 2026-10-25
- **Asked:** not asked; the maintainer stated it.
- **Maintainer's words:** "I think it is worths to mention that while we are focusing on android right now, this app is meant to me multiplatform, which should support both touchscreen, mouse, and keyboard as it currently supports both window, web host, linux(both x86 and ARM), android, and Windows on ARM planned for later. so UI needs to take those into consideration."
- **Outcome:** [PLATFORMS.md](PLATFORMS.md) — behaviour follows the input used, layout follows the space; every action has touch, pointer and keyboard paths; mixed devices; platform-only features degrade silently; Chromium and WebKit checks. Applies to all tasks, including the Android surfaces (Android-only by nature) and Chat slice 1 (revised).

### DD-018 — No chat bubbles

- **Date:** 2026-10-25
- **Asked:** not asked; the maintainer stated it after seeing the slice 1 mockup.
- **Maintainer's words:** "I think it would work better without the text bubble - some of users uses it to generate novels. so it could look odd for those users, as it is technically not specific character speaking."
- **Outcome:** messages render as full-width prose blocks for both sides, no bubble backgrounds or left/right alignment; turns are separated by spacing and a slim meta row (avatar + name), with user turns marked quietly (see SLICE1_SPEC §1.1).

### DD-019 — Customizable message action buttons

- **Date:** 2026-10-25
- **Asked:** not asked; the maintainer stated it while slice 1 was in review.
- **Maintainer's words:** "another feedback that we can fold into later revision after decisions - I think user should be able to customize button layout outside of dots menu, with edit and delete located out of dot menu by default. potential future expansion would be letting plugin to add their own button to it."
- **Outcome (to apply in the slice 1 revision, after the C-decisions):** the message meta row shows user-chosen action buttons outside `⋯`; defaults are Edit and Delete; everything else stays in `⋯` unless the user moves it. Plugin-added buttons are a future extension: design the slot model so a plugin action can join the same list, but no plugin API is specified now.

### DD-020 — Where "New reply" lives

- **Date:** 2026-10-25
- **Asked:** slice 1 review P1-3 (the pager `›` became the paid "New reply" in the same spot, so a double-tap generated). Options: own button, never in `›`'s spot (recommended); keep it at `›` with a dwell.
- **Answer:** "Own button, never in ›'s spot (Recommended)"
- **Outcome:** the pager `‹ n/N ›` only browses and `›` disables at N/N. A separate labelled "새 답변" button sits apart in the row; the `⋯` sheet item and the armed pull also start a new reply.

### DD-021 — How the pull arms a new reply

- **Date:** 2026-10-25
- **Asked:** slice 1 review P1-4 (a fast flick armed generation at 55% width with no dwell). Options: distance + hold, no fling (recommended); distance only.
- **Answer:** "Distance + hold, no fling (Recommended)"
- **Outcome:** arming needs the finger held beyond a fixed ~160 dp past the last alternative for 300 ms; a fling never arms; the distance is the same on phone and tablet.

### DD-022 — Deleting a message that is generating

- **Date:** 2026-10-25
- **Asked:** slice 1 review P1-2 (deleting a generating message left the composer stuck). Options: stop, then delete (recommended); block delete while generating.
- **Answer:** "Stop, then delete (Recommended)"
- **Outcome:** the confirmation reads "Stop and delete" ("중지하고 삭제"); the reply is stopped first, then removed, and the composer returns to idle.

### DD-023 — Protection against mistaken deletes

- **Date:** 2026-10-25
- **Asked:** slice 1 review P2 (delete confirm focused the destructive button and did not say which message). Options: undo for one, confirm for many (recommended); confirm always.
- **Answer:** "Undo for one, confirm for many (Recommended)"
- **Outcome:** deleting one message happens at once with a 6 s "실행 취소" (Undo) snackbar; "this and the N after it" still asks first, naming the message and the count, with focus on Cancel.

### DD-024 — Slice 1 defaults C-1, C-3, C-5, C-6

- **Date:** 2026-10-25
- **Asked:** multi-select of four proposed defaults; unpicked ones would be off.
- **Answer:** "Haptic ticks (C-1),Header hides when reading (C-3),Hide-names option (C-6),Render-when-complete option (C-5)"
- **Outcome:** all four adopted. C-1: 10 ms tick at swipe commit and at the arm point, Android touch only, with an off switch. C-3: the slim header hides while reading older messages and returns on scroll down or when a reply finishes; narrow layout only. C-5: per-character "render when complete" option. C-6: per-chat "hide names and avatars" reading mode, default off.

### DD-025 — Tag-less CSS while streaming

- **Date:** 2026-10-25
- **Asked:** follow-up to DD-016; tag-less CSS cannot be recognised for certain mid-stream. Options: heuristic chip + C-5 (recommended); C-5 only.
- **Answer:** "Heuristic chip + C-5 (Recommended)"
- **Outcome:** lines that look like CSS rules (`selector {` …) are held behind a "스타일 작성 중…" chip until their `}` closes; cards where the heuristic fails use render-when-complete (C-5).

### DD-026 — Enter on a hardware keyboard

- **Date:** 2026-10-25
- **Asked:** C-4; a touch tablet with a keyboard cover has no fine pointer. Options: detect typing + setting (recommended); setting only.
- **Answer:** "Detect typing + setting (Recommended)"
- **Outcome:** once trusted hardware key presses are seen (non-229 keydowns), Enter sends and Shift+Enter adds a line; with the on-screen keyboard Enter adds a line. A visible per-device setting overrides the detection.

### DD-027 — Users with swipe regeneration off

- **Date:** 2026-10-25
- **Asked:** users who turned today's "Use Swipe for Regeneration" off. Options: pager anyway, no gesture (recommended); single New reply button as today.
- **Answer:** "Pager anyway, no gesture (Recommended)"
- **Outcome:** they get the `‹ n/N ›` pager and the separate New reply button; only the swipe gesture is off.

### DD-028 — No custom notification layout for now

- **Date:** 2026-10-25
- **Asked:** the maintainer asked whether the notification's live numbers could use Lucide icons (quill for length, gauge for tok/s). Standard templates drop inline images; icons need a custom `RemoteViews` layout (collapsed ≈48 dp, expanded ≈256 dp), which costs per-OEM theming, TalkBack labels, native upkeep, and cannot be promoted to an Android 16 Live Update.
- **Maintainer's words:** "yeah, let's leave remote view idea out of the scope for now."
- **Outcome:** the generation notification stays on standard templates with text-only live numbers (DD-004). Lucide icons for those metrics are used inside the app only. A custom expanded layout may be revisited later.

### DD-029 — Where single-delete undo lives

- **Date:** 2026-10-25
- **Asked:** slice 1 re-review P2-N1 (the floating snackbar covered "Generate reply"/"New reply" for 6 s). Options: inline in the gap (recommended); snackbar with space reserved.
- **Answer:** "Inline in the gap (Recommended)"
- **Outcome:** a deleted message leaves a slim row in its place, "메시지를 삭제했어요 · 실행 취소", for 6 s; no overlay; Ctrl+Z still works. Refines DD-023.

### DD-030 — Widening the tag-less CSS heuristic

- **Date:** 2026-10-25
- **Asked:** re-review P3-N1 (misses one-line/inline rules; false positives on `interface Button {`). Options: widen, need a CSS property (recommended); keep narrow, rely on C-5.
- **Answer:** "Widen, need a CSS property (Recommended)"
- **Outcome:** one-liners and inline openers are caught too, but only when a known CSS property follows the `{`. Refines DD-025.

### DD-031 — A new generation commits a pending undo

- **Date:** 2026-10-25
- **Asked:** re-review P3-N3 (undo after a new generation left two character turns in a row). Options: Send/New reply commits it (recommended); undo stays available.
- **Answer:** "Send/New reply commits it (Recommended)"
- **Outcome:** starting a generation (Send, New reply, the armed pull, Ctrl+Alt+R) closes the pending undo.

### DD-032 — Keys that count as a hardware keyboard

- **Date:** 2026-10-25
- **Asked:** re-review P2-N2 (Backspace from an on-screen keyboard set the flag, so Enter sent the draft). Options: navigation + shortcuts (recommended); any key but Backspace/Enter.
- **Answer:** "Navigation + shortcuts (Recommended)"
- **Outcome:** only arrows, Home/End, Page keys, Tab, Esc and Ctrl/Alt shortcuts set the flag; Backspace, Delete, digits and letters never do. Lane A checks it on device. Refines DD-026.

### DD-033 — Regenerate gesture: pull, hold, let go

- **Date:** 2026-10-25
- **Asked:** not asked; the maintainer stated it, then chose the direction. Options for direction: sideways, past the last (recommended); upward at the bottom.
- **Maintainer's words:** "I think we can adopt UX that is mostly similar to Character AI swipe, but with 'pull while holding, then let go' on regeneration gesture how twitter or other mobile sns handle refresh, with animation that fills up as user pulls and holds, then instructs user to let go to regenerate. if user slides back down, message does not regenerate. if user let go of the slide, message springs back to the cente, regenerating." Direction: "Sideways, past the last (Recommended)".
- **Outcome:** swipe browses replies as in Character AI; at N/N a sideways pull shows a fill meter that fills with distance (to 160 dp) and then with the 300 ms hold (DD-021); full = "놓으면 새 답변 생성"; sliding back drains and cancels; letting go while armed springs the message back to the centre and the new reply streams in it. SLICE1_SPEC §3.2.

### DD-034 — UI font and chat-reading font

- **Date:** 2026-10-25
- **Asked:** not asked as a question; after the specimen (fonts/specimen.html) and research (fonts/RESEARCH.md) the design session suggested a split, Neo for the UI and possibly Gothic for chat reading.
- **Maintainer's words:** "Neo for the UI and Gothic for chat reading indeed seems to be the best fit."
- **Outcome:** NanumSquare Neo is the UI face; Nanum Gothic is the default chat-reading face; both bundled locally with the NAVER Nanum licence (OFL 1.1, Reserved Font Names include NanumSquareNeo and NanumGothic), system fallback for kana, Hanja beyond Gothic, accented Latin and emoji. The existing user font setting stays. This replaces DESIGN_PHILOSOPHY's "DEEP NEXUS adds no web font" rule. File set, formats (woff2 vs official OTF/TTF) and the reserved-name handling follow from the licence research (task 2026-10-25-ui-font).

### DD-038 — Switching inside a chat

- **Date:** 2026-10-25
- **Asked:** Chat slice 2. Options: sidebar with chats + characters (recommended); global switcher palette; today's rail + panel, polished.
- **Answer:** "Sidebar: chats + characters (Recommended)"
- **Outcome:** the in-chat sidebar shows a recent-characters strip, this character's chats with last line, date and count, and one search field that finds both; Ctrl+K opens it focused on search.

### DD-039 — Switching while a reply generates

- **Date:** 2026-10-25
- **Asked:** options: ask to stop and switch, or stay (recommended); keep generating in background.
- **Answer:** "Keep generating in background"
- **Outcome:** switching happens at once; the reply finishes in its own chat, shown by a status on its row (and the Android notification, DD-007). Depends on lane A confirming the engine can generate for a chat that is not on screen; the spec names a fallback if it cannot.

### DD-040 — Back from a chat

- **Date:** 2026-10-25
- **Asked:** options: Home (main menu) (recommended); open the sidebar first.
- **Answer:** "Home (main menu) (Recommended)"
- **Outcome:** with nothing open, Back (Android Back, Esc, mouse back) leaves the chat for Home; open layers (sheet, menu, sidebar) close first.

### DD-035 — Font weights to ship

- **Date:** 2026-10-25
- **Asked:** options: Neo 400/700 + Gothic 400/700, ~3.5 MB (recommended); add ExtraBold to both, ~5.3 MB; Neo 400/700 + Gothic 400 only.
- **Answer:** "Add ExtraBold to both"
- **Outcome:** NanumSquare Neo 400/700/800 and Nanum Gothic 400/700/800 (from `NanumGothic.otf`, `NanumGothicBold.otf`, `NanumGothicExtraBold.otf`, weights set in `@font-face`). About 5.3 MB as woff2, estimated at the time; the independent check puts it at about 5.5 MB (RESEARCH §12).

### DD-036 — When the chat font loads

- **Date:** 2026-10-25
- **Asked:** options: on opening a chat (recommended); all at startup.
- **Answer:** "On opening a chat (Recommended)"
- **Outcome:** Neo loads with the app; Gothic Regular loads when a chat first opens, and Gothic Bold/ExtraBold when such text first appears. Home and Settings never load Gothic. Chat text shows in the fallback until Gothic arrives (`font-display: swap`, metric-matched fallback).

### DD-037 — Who builds the woff2 files

- **Date:** 2026-10-25
- **Asked:** options: lane A at integration (recommended); here, in docs/design.
- **Answer:** "Lane A at integration (Recommended)"
- **Outcome:** the handoff names the official source files, the tool (Google `woff2`, or fontTools), and the FAQ 2.2.1 acceptance check (byte-for-byte round trip, no metadata block). Nothing is installed or built here. Whether `head.flags` bit 11 counts as "WOFF compression" stays for lane A and the maintainer at that check.

### DD-041 — Where the generation strip lives

- **Date:** 2026-10-25
- **Asked:** after the slice 2 review ([review](reviews/2026-10-25-chat-slice2-review.md) B1/B2); options: pinned 44 dp row outside the hiding header, Stop away from the ⋮ column (recommended); pinned, keep 32 dp; keep inside header.
- **Answer:** "Pinned, 44 dp (Recommended)"
- **Outcome:** the strip is its own 44 dp row under the header that never hides while a reply runs in another chat; its Stop sits clear of the header ⋮ column.

### DD-042 — Chat name in the header

- **Date:** 2026-10-25
- **Asked:** after the slice 2 review ([review](reviews/2026-10-25-chat-slice2-review.md) A1); options: chat name as a subtitle under the character name, switch announced and page title updated (recommended); character only.
- **Answer:** "Chat name subtitle (Recommended)"
- **Outcome:** the header shows the chat name as a second line; a switch updates it, the document title and a polite announcement.

### DD-043 — Scope tags in the "This chat" sheet

- **Date:** 2026-10-25
- **Asked:** after the slice 2 review ([review](reviews/2026-10-25-chat-slice2-review.md) C1/C2); options: drop the redundant chip on 이 채팅 and give 이 캐릭터 / 모든 채팅 an icon + colour tag (recommended); keep equal chips; rename the sheet.
- **Answer:** "Stronger wider-scope tags (Recommended)"
- **Outcome:** no chip on the 이 채팅 group; wider-scope groups carry a distinct icon and colour tag.

### DD-044 — Row menu on touch

- **Date:** 2026-10-25
- **Asked:** after the slice 2 review ([review](reviews/2026-10-25-chat-slice2-review.md) S1); options: visible ⋯ on every row on touch, long-press kept (recommended); long-press only with a one-time hint.
- **Answer:** "Visible ⋯ on touch (Recommended)"
- **Outcome:** chat rows show ⋯ on touch devices too; long-press still opens the same menu.

### DD-045 — "This chat only" toggles

- **Date:** 2026-10-25
- **Asked:** after the slice 2 review ([review](reviews/2026-10-25-chat-slice2-review.md) C4); asked after a source check (today the chat keeps its own values in `GLGlobalVariables` after the switch is turned off, `getGlobalChatVar` still reads them first, and turning it on again reuses them; `src/ts/parser/chatVar.svelte.ts:90-126`). Options: start from shared values, discard on off after a short undo (recommended); keep and reuse as today.
- **Answer:** "Start from shared values (Recommended)"
- **Outcome:** turning 이 채팅에만 적용 on copies the current shared toggle values into the chat; turning it off discards the chat's own values, with a short undo. This changes today's engine behaviour; lane A owns the change.

### DD-046 — Pending undo when switching chats

- **Date:** 2026-10-25
- **Asked:** after the slice 2 review ([review](reviews/2026-10-25-chat-slice2-review.md) B11); options: switching commits it, like Send (DD-031) (recommended); keep it if you return within its time.
- **Answer:** "Commit on switch (Recommended)"
- **Outcome:** switching chats makes a pending single-message delete final.

### DD-047 — Switch-chat shortcut

- **Date:** 2026-10-25
- **Asked:** after the slice 2 review ([review](reviews/2026-10-25-chat-slice2-review.md) K1); options: Alt+↑/↓, ignored while a sheet is open or a text field has focus (recommended); Ctrl+Shift+↑/↓ with the same guards; no shortcut.
- **Answer:** "Alt+↑/↓, guarded (Recommended)"
- **Outcome:** Alt+↑/↓ steps through visible chat rows; ignored in sheets, menus and text fields. Replaces the slice 2 draft's Ctrl+Shift+↑/↓.

### DD-048 — Esc in the message box

- **Date:** 2026-10-25
- **Asked:** after the slice 2 review ([review](reviews/2026-10-25-chat-slice2-review.md) D7); options: first Esc leaves the box, second goes Home (recommended); Home at once.
- **Answer:** "Leave box, then Home (Recommended)"
- **Outcome:** Esc in the message box blurs it and keeps the draft; the next Esc follows DD-040.

### DD-049 — Group chat pain points

- **Date:** 2026-10-25
- **Asked:** "What bothers you most about group chats today?" (multi-select): can't see who's speaking; no say in who speaks next; auto mode hard to control; setup buried in settings.
- **Answer:** "No say in who speaks next,Auto mode hard to control,Setup buried in settings"
- **Outcome:** slice 3 centres on next-speaker control, auto mode control and feedback, and bringing group setup to the chat. "Can't see who's speaking" was not picked; speaker identity is still checked against source (research/slice3-group-chats.md) but is not a stated pain point.

### DD-050 — Slice 3 scope

- **Date:** 2026-10-25
- **Asked:** options: in-chat + member panel, creation stays (recommended); in-chat only; everything incl. creation.
- **Answer:** "Everything incl. creation"
- **Outcome:** slice 3 covers in-chat group controls, member setup, and how a group is created and set up.

### DD-051 — Choosing the next speaker

- **Date:** 2026-10-25
- **Asked:** options: member strip above the message box, tap to make a member speak next (once), per-member menu for mute and talkativeness (recommended); @mention in the box; both.
- **Answer:** "Member strip (Recommended)"
- **Outcome:** a member strip sits above the composer in group chats; tapping a member queues them as the next speaker for one round; each member has a menu for mute and talkativeness. With no pick, today's order rules apply.

### DD-052 — Speaker on each group reply

- **Date:** 2026-10-25
- **Asked:** source check: replies show the group name and picture; `saying` exists but is never displayed (research/slice3-group-chats.md §1). Options: show the speaking member (recommended); keep the group.
- **Answer:** "Show member (Recommended)"
- **Outcome:** each group reply shows the speaking member's name and avatar; the header keeps the group.

### DD-053 — Regenerate in a group

- **Date:** 2026-10-25
- **Asked:** options: redo only that member's message, same speaker, plus a separate "redo round" action (recommended); whole round as today.
- **Answer:** "Just that reply (Recommended)"
- **Outcome:** regenerate (gesture, New reply, Ctrl+Alt+R) redoes only that message with the same speaker; "이 라운드 다시" keeps today's whole-round behaviour as a separate action. Lane A: today's alternatives are whole-round slices; per-message alternatives in groups are an engine change.

### DD-054 — Stop in a group round

- **Date:** 2026-10-25
- **Asked:** options: stop the round as today, the strip shows who was skipped with a resume action (recommended); skip only the current speaker.
- **Answer:** "Stop the round (Recommended)"
- **Outcome:** Stop ends the current reply and cancels the rest of the round; the strip names the skipped members and offers to let them speak.

### DD-055 — Auto mode

- **Date:** 2026-10-25
- **Asked:** options: visible run with round count, who is up, Pause and Stop, runs until stopped/error/quiet and says why it stopped (recommended); a set number of rounds; ask every N rounds.
- **Answer:** "Visible run + pause (Recommended)"
- **Outcome:** auto mode is a switch in the member strip; while on, a bar shows the round count and who speaks next, with Pause and Stop, and a stop reason when it ends.

### DD-056 — Creating a group

- **Date:** 2026-10-25
- **Asked:** options: one sheet with member picker (names, search), name prefilled, order mode, Create needs at least 2 members (recommended); step-by-step; members only.
- **Answer:** "One sheet (Recommended)"
- **Outcome:** group creation is one sheet: pick members, name prefilled from them (editable), order mode; Create is enabled with 2 or more members; the rest is set later.

### DD-057 — First messages in a new group chat

- **Date:** 2026-10-25
- **Asked:** options: choose per chat, all ticked, untick or pick an alternate per member (recommended); all as today; empty.
- **Answer:** "Choose per chat (Recommended)"
- **Outcome:** New chat in a group shows each member's first message, all ticked, with an alternate picker per member; the user unticks or picks, then starts.

### DD-058 — Deleted members in a group

- **Date:** 2026-10-25
- **Asked:** options: mark as missing, never speaks, one-tap Remove, past messages keep their stored name (recommended); remove automatically on delete.
- **Answer:** "Mark and offer removal (Recommended)"
- **Outcome:** a deleted member shows as missing in the strip and member panel, never speaks, and offers Remove. Note: messages store only the speaker id (`saying`), so "keep their stored name" needs lane A to keep a name for it (a snapshot on the message or a tombstone); until then past messages show "삭제된 캐릭터".

### DD-059 — Who speaks after a tap in the strip

- **Date:** 2026-10-25
- **Asked:** after the slice 3 review ([review](reviews/2026-10-25-chat-slice3-review.md)); options: only the tapped members, in tap order, with a hint in the message box and a one-time tip (recommended); tapped first, then the usual rules.
- **Answer:** "Only them, with a hint (Recommended)"
- **Outcome:** the next round is only the queued members in tap order (clarifies DD-051); the composer placeholder says who will answer and a one-time tip explains it.

### DD-060 — Auto mode when going Home

- **Date:** 2026-10-25
- **Asked:** after the slice 3 review ([review](reviews/2026-10-25-chat-slice3-review.md)); options: end it, like switching chats, with a "moved away" reason (recommended); keep running on Home.
- **Answer:** "Yes, end it (Recommended)"
- **Outcome:** leaving the chat for Home ends auto mode after the current reply, reason "다른 화면으로 이동".

### DD-061 — Stop in the auto-mode bar

- **Date:** 2026-10-25
- **Asked:** after the slice 3 review ([review](reviews/2026-10-25-chat-slice3-review.md)); options: end auto mode and cut the current reply, with the standard skipped notice and resume action (recommended); end after the current reply.
- **Answer:** "Stop now + notice (Recommended)"
- **Outcome:** the bar's Stop behaves like the composer's Stop (DD-054) and also ends auto mode.

### DD-062 — Muted members in the first-message panel

- **Date:** 2026-10-25
- **Asked:** after the slice 3 review ([review](reviews/2026-10-25-chat-slice3-review.md)); options: listed unticked with a "쉬는 중" tag (recommended); hidden; ticked like others.
- **Answer:** "Unticked, tagged (Recommended)"
- **Outcome:** muted members appear unticked with a "쉬는 중" tag and can be ticked.

### DD-063 — Where skipped members show

- **Date:** 2026-10-25
- **Asked:** after the slice 3 review ([review](reviews/2026-10-25-chat-slice3-review.md)); options: both the chat note and a mark in the member strip until the next round (recommended); strip only; chat note only.
- **Answer:** "Both (Recommended)"
- **Outcome:** the transcript notice with its resume action stays, and skipped members are marked in the strip until the next round (completes DD-054).

### DD-064 — Member name colours

- **Date:** 2026-10-25
- **Asked:** after the slice 3 review ([review](reviews/2026-10-25-chat-slice3-review.md)); options: fixed per member from when it joined (recommended); by current order.
- **Answer:** "Fixed per member (Recommended)"
- **Outcome:** each member keeps a colour slot assigned at join; reordering never recolours messages.

### DD-065 — Fewest members in a group

- **Date:** 2026-10-25
- **Asked:** after the slice 3 review ([review](reviews/2026-10-25-chat-slice3-review.md)); options: down to one, the last removal refused with a reason (recommended); at least two.
- **Answer:** "Keep at least one (Recommended)"
- **Outcome:** the member panel allows removing down to one member and refuses removing the last.

### DD-066 — Long-chat pain points

- **Date:** 2026-10-26
- **Asked:** "What goes wrong for you in long chats today?" (multi-select): opening is slow; scrolling back is janky; typing/streaming lags; hard to find old messages.
- **Answer:** "Opening a long chat is slow,Scrolling back is janky,Typing/streaming lags,Hard to find old messages"
- **Outcome:** slice 4 covers all four: open time, scroll-back stability, input/streaming responsiveness as chats grow, and finding old messages.

### DD-067 — Devices slice 4 is judged on

- **Date:** 2026-10-26
- **Asked:** options: the floor devices, Galaxy Note 9 (Android 10 WebView) and Raspberry Pi 3, measured by lane A (recommended); mid-range phones first.
- **Answer:** "The floor devices (Recommended)"
- **Outcome:** slice 4 acceptance targets are set for the Note 9 and the Pi 3; mockup numbers in desktop Chrome are indicative only.

### DD-068 — Message list strategy

- **Date:** 2026-10-26
- **Asked:** after the long-chat trace (chat/research/slice4-long-chats.md): today the window grows without limit and jumps mount everything newer. Options: bounded window, only messages near the viewport mounted, jumps load around the target, lane A makes edit drafts durable first (recommended); keep growing but make each message cheaper.
- **Answer:** "Bounded window (Recommended)"
- **Outcome:** the transcript mounts only messages near the viewport (about 100 at most) with measured-height placeholders for the rest; jumps load around the target. Durable edit drafts are a prerequisite for lane A (Report 19 sequencing).

### DD-069 — Ways to get around old messages

- **Date:** 2026-10-26
- **Asked:** "Which ways to find and get around old messages should slice 4 add?" (multi-select): jump to latest; search in this chat; position scrubber; jump to start / date.
- **Answer:** "Jump to latest,Search in this chat,Position scrubber,Jump to start / date"
- **Outcome:** slice 4 designs all four.

### DD-070 — Save cost in slice 4

- **Date:** 2026-10-26
- **Asked:** options: UI-only design plus a lane A recommendation (save per chat) with floor-device targets (recommended); out of scope.
- **Answer:** "Lane A note with targets (Recommended)"
- **Outcome:** the spec carries a lane A section recommending chat-granular saves and other history-wide costs, with targets on the Note 9 and Pi 3; no storage design here.

### DD-071 — Streaming display default

- **Date:** 2026-10-26
- **Asked:** options: slice 1 append-only with adaptive pace replaces the off/balanced/strong modes (recommended); keep "balanced" (MC-257) and the setting.
- **Answer:** "Slice 1 append-only (Recommended)"
- **Outcome:** append-only streaming (SLICE1_SPEC §6) is the only mode; the streamingDisplayOptimizationMode setting goes away. Supersedes MC-257/CHORE-156's "balanced" default for the redesign (main session to reconcile).

### DD-072 — Long-chat line

- **Date:** 2026-10-26
- **Asked:** after the slice 4 review ([review](reviews/2026-10-26-chat-slice4-review.md)); F-06; options: a brief one-line hint that goes away on first scroll or after about 8 s (recommended); a slim pinned band with icon-only buttons; drop it.
- **Answer:** "Brief hint (Recommended)"
- **Outcome:** the long-chat line is a transient one-line hint; it never pins and takes no reading space after the first scroll or about 8 s. Search and jump stay in the header ⋮.

### DD-073 — Esc after reading around a search hit

- **Date:** 2026-10-26
- **Asked:** after the slice 4 review ([review](reviews/2026-10-26-chat-slice4-review.md)); F-14; options: stay where the reader is and offer "돌아가기" to the pre-search position (recommended); always return to the pre-search position.
- **Answer:** "Stay + offer back (Recommended)"
- **Outcome:** closing search keeps the current reading position and shows the "돌아가기" chip for the pre-search position.

### DD-074 — What in-chat search matches

- **Date:** 2026-10-26
- **Asked:** after the slice 4 review ([review](reviews/2026-10-26-chat-slice4-review.md)); F-10; options: stored text with markup removed the same way for query and text, no macro or regex-script expansion (recommended); also expand {{user}}/{{char}}; fully rendered text.
- **Answer:** "Stored text, cleaned (Recommended)"
- **Outcome:** search matches the stored message text, normalised identically for query and text (markup stripped, whitespace/newlines collapsed); macros and regex scripts are not expanded.

### DD-075 — A reply arriving near the bottom

- **Date:** 2026-10-26
- **Asked:** after the slice 4 review ([review](reviews/2026-10-26-chat-slice4-review.md)); F-28; options: show the jump-to-latest button with a count as soon as a reply arrives and the reader is not at the bottom (recommended); auto-scroll within a third of a screen; keep the one-screen rule.
- **Answer:** "Show button + count (Recommended)"
- **Outcome:** any reply that arrives while the reader is not at the bottom shows the jump-to-latest button with its count.

### DD-076 — Ctrl+F in the message box

- **Date:** 2026-10-26
- **Asked:** after the slice 4 review ([review](reviews/2026-10-26-chat-slice4-review.md)); options: open in-chat search from the message box too, other text fields keep the browser's find (recommended); browser find in every text field.
- **Answer:** "Chat search there too (Recommended)"
- **Outcome:** Ctrl+F opens in-chat search when focus is in the chat or the message box; other text fields keep the browser's find.

### DD-077 — Where toggles live

- **Date:** 2026-10-26
- **Asked:** toggle list redesign (maintainer request 2026-10-26: "enabling few modules or prompt that has custom toggle quickly grows the size of the toggle list - which makes user to have to scroll through the tiny window below the chat list to find each entry"); options: own full-height panel opened from a summary row in the This chat sheet and from the + menu, right-side panel on wide (recommended); inline in the sheet; always-visible side panel.
- **Answer:** "Own full-height panel (Recommended)"
- **Outcome:** the This chat sheet's 토글 group becomes one summary row ("토글 23개 · 5개 켜짐") opening a full-height toggles panel (right panel on wide); also reachable from the composer + sheet. Refines SLICE2_SPEC §3 item 3.

### DD-078 — How a long toggle list is organised

- **Date:** 2026-10-26
- **Asked:** toggle list redesign (maintainer request 2026-10-26: "enabling few modules or prompt that has custom toggle quickly grows the size of the toggle list - which makes user to have to scroll through the tiny window below the chat list to find each entry"); options: by source — 프롬프트, each module by name, 캐릭터 — with author groups as sub-sections, collapsible, with on/changed counts (recommended); one list in author order.
- **Answer:** "By source (Recommended)"
- **Outcome:** sections per source with collapsible author groups and counts. Lane A must keep each toggle's source (today `getModuleToggles` concatenates module text and loses it).

### DD-079 — Finding a toggle

- **Date:** 2026-10-26
- **Asked:** toggle list redesign (maintainer request 2026-10-26: "enabling few modules or prompt that has custom toggle quickly grows the size of the toggle list - which makes user to have to scroll through the tiny window below the chat list to find each entry"); "What should help find a toggle fast?" (multi-select): search box; "changed only" filter; favourites on top; quick chips in the + menu.
- **Answer:** "Search box,"Changed only" filter,Favourites on top,Quick chips in + menu"
- **Outcome:** all four: name search, a changed-only filter, starred toggles pinned in a top section, and starred toggles as chips in the composer + sheet.

### DD-080 — Typical toggle count

- **Date:** 2026-10-26
- **Asked:** toggle list redesign (maintainer request 2026-10-26: "enabling few modules or prompt that has custom toggle quickly grows the size of the toggle list - which makes user to have to scroll through the tiny window below the chat list to find each entry"); "Roughly how many toggles do you have with your usual modules and prompt?" options: 10–20; 20–50; 50+.
- **Answer:** "20–50"
- **Outcome:** the design is sized for 20–50 toggles (synthetic data uses ~40) and must stay usable at 100+.

### DD-081 — Chat-only cue in the toggles panel

- **Date:** 2026-10-26
- **Asked:** toggles review ([reviews/2026-10-26-chat-toggles-review.md](reviews/2026-10-26-chat-toggles-review.md)) D-1; "When 'this chat only' is on, how should the toggles panel show it?" options: Pill in title (Recommended); Row tags only.
- **Answer:** "Pill in title (Recommended)"
- **Outcome:** a persistent "이 채팅" pill beside the panel title while the scope switch is on (the switch row scrolls with the list); per-row tags stay.

### DD-082 — Jailbreak and memory toggles become chat-scoped

- **Date:** 2026-10-26
- **Asked:** toggles review ([reviews/2026-10-26-chat-toggles-review.md](reviews/2026-10-26-chat-toggles-review.md)) D-2 (F-02: `DBState.db.jailbreakToggle` is a global setting and `chara.supaMemory` is per character, not chat variables; `src/lib/SideBars/Toggles.svelte:187,194`); "Jailbreak and memory are not chat variables (global setting / per character). How should they sit in the panel?" options: Outside scope (Recommended); Make chat-scoped.
- **Answer:** "Make chat-scoped"
- **Outcome:** the scope switch covers jailbreak and memory like any toggle (chat-only value, "이 채팅" tag, revert). Lane A request: chat-scoped fields for both, falling back to today's global / per-character value. Slice 2's separate "모든 채팅" jailbreak switch and memory row must agree with the panel (one value per scope).

### DD-083 — "Changed" means "on" until a default syntax exists

- **Date:** 2026-10-26
- **Asked:** toggles review ([reviews/2026-10-26-chat-toggles-review.md](reviews/2026-10-26-chat-toggles-review.md)) D-3 (F-03: no default-value syntax); "There is no default-value syntax, so 'changed' really means 'on'. What should the filter and dot say?" options: Say 'on' for now (Recommended); Keep '바꾼 것만'; Wait for default syntax.
- **Answer:** "Say 'on' for now (Recommended)"
- **Outcome:** filter "켜진 것만" / "On only", marker reads 켜짐; "기본값으로" becomes "끄기"/reset wording that matches; spec O-1 (author default syntax) stays open for lane A.

### DD-084 — Which toggle sections start open

- **Date:** 2026-10-26
- **Asked:** toggles review ([reviews/2026-10-26-chat-toggles-review.md](reviews/2026-10-26-chat-toggles-review.md)) D-4 (F-01: with 40 toggles every section started open); "With 40 toggles every section starts open today. Which should start open?" options: By total count (Recommended); Per-section rule; All folded.
- **Answer:** "By total count (Recommended)"
- **Outcome:** above a total threshold, only the first section and sections with on values start open; the rest start folded; the user's own open/closed state is remembered as before.

### DD-085 — Cap on sections that start open

- **Date:** 2026-10-26
- **Asked:** toggles re-review ([reviews/2026-10-26-chat-toggles-rereview.md](reviews/2026-10-26-chat-toggles-rereview.md)) D-5 (N-02: DD-084 opens every section once each source has an on value); "When most sections have toggles switched on, how many should start open?" options: Cap at ~25 rows (Recommended); Keep current rule; First section only.
- **Answer:** "Cap at ~25 rows (Recommended)"
- **Outcome:** above 20 toggles, open the first section, then sections with on values in order until about 25 rows show; the rest start folded. The user's remembered state still wins.

### DD-086 — Jailbreak and memory rows under chat-only

- **Date:** 2026-10-26
- **Asked:** toggles re-review ([reviews/2026-10-26-chat-toggles-rereview.md](reviews/2026-10-26-chat-toggles-rereview.md)) D-6 (N-01: under chat-only, slice 2's memory row sat under the character heading and jailbreak under "모든 채팅"); "With 'this chat only' on, where should jailbreak and memory sit in the This chat sheet?" options: Move to 이 채팅 group (Recommended); Keep place, add tag.
- **Answer:** "Move to 이 채팅 group (Recommended)"
- **Outcome:** while chat-only is on, the jailbreak and memory rows move into the "이 채팅" group of the This chat sheet; they return to their usual headings when it is off. Memory shows its real type, not "없음".

### DD-087 — Search hit that can't be pinpointed

- **Date:** 2026-10-26
- **Asked:** slice 4 re-review ([reviews/2026-10-26-chat-slice4-rereview.md](reviews/2026-10-26-chat-slice4-rereview.md)) D1 (N-01: hits in line breaks, entities, markdown emphasis or tag text are counted but not highlighted); "When a search hit can't be pinpointed in the shown text (line breaks, markdown, tags), what should the chat show?" options: Outline message + note (Recommended); Leave unmarked.
- **Answer:** "Outline message + note (Recommended)"
- **Outcome:** when the match cannot be located in the rendered text, the whole message is outlined and a short notice says the match is inside it.

### DD-088 — How near the bottom counts as "at the bottom"

- **Date:** 2026-10-26
- **Asked:** slice 4 re-review ([reviews/2026-10-26-chat-slice4-rereview.md](reviews/2026-10-26-chat-slice4-rereview.md)) D2 (N-08: tolerance undocumented); "How close to the bottom counts as 'at the bottom' (new replies auto-follow instead of showing the jump button)?" options: About 100 px (Recommended); 24 px; A third of a screen.
- **Answer:** "About 100 px (Recommended)"
- **Outcome:** within about 100 px of the bottom, new replies auto-follow; further up, jump-to-latest with a count (DD-075). Stated in the spec.

### DD-089 — Studio pain points

- **Date:** 2026-10-26
- **Asked:** Studio redesign start (maintainer request 2026-10-26: "Start the Studio redesign. also, small note: current implementation gives user a text box for toggle definition. I think it needs GUI menu for easier toggle managements."); "What bothers you most about authoring in RisuAI today? (pick all that apply)" options: Cramped text boxes; Hard to find scripts; No test or debug; Saving is unclear.
- **Answer:** "Cramped text boxes,Hard to find scripts,No test or debug,Saving is unclear"
- **Outcome:** all four are in scope; the Studio save open group (DD-001) is taken up here.

### DD-090 — Studio scope

- **Date:** 2026-10-26
- **Asked:** Studio redesign start (maintainer request 2026-10-26: "Start the Studio redesign. also, small note: current implementation gives user a text box for toggle definition. I think it needs GUI menu for easier toggle managements."); "What should the Studio redesign cover?" options: Editor + structured forms (Recommended); Script editor only; Full authoring.
- **Answer:** "Full authoring"
- **Outcome:** the script editor, structured forms (toggles, regex, triggers, lorebook) and the character editor (description, first messages, assets, display settings). Too large for one pass: split into slices.

### DD-091 — Toggle definition GUI

- **Date:** 2026-10-26
- **Asked:** Studio redesign start (maintainer request 2026-10-26: "Start the Studio redesign. also, small note: current implementation gives user a text box for toggle definition. I think it needs GUI menu for easier toggle managements."); "For the toggle definitions you mentioned, which GUI shape?" options: List builder + text view (Recommended); GUI only; Text + helper.
- **Answer:** "List builder + text view (Recommended)"
- **Outcome:** a row list builder (type picker, label, key, options; groups; reorder) with a live preview of the toggles panel (TOGGLES_SPEC), plus a text tab showing the raw `key=label[=type[=options]]` syntax for power users and paste.

### DD-092 — Studio starting point

- **Date:** 2026-10-26
- **Asked:** Studio redesign start (maintainer request 2026-10-26: "Start the Studio redesign. also, small note: current implementation gives user a text box for toggle definition. I think it needs GUI menu for easier toggle managements."); "Start from the existing Studio mockup (mockups/studio.html, the CBS/Lua/plugin linter from the October audit)?" options: Build on it (Recommended); Start fresh.
- **Answer:** "Build on it (Recommended)"
- **Outcome:** keep its corrected lint rules and editor work; redesign the shell, navigation and new forms around it.

### DD-093 — First Studio slice

- **Date:** 2026-10-26
- **Asked:** Studio slicing, after discovery ([studio/research/today-authoring.md](studio/research/today-authoring.md)); "Which Studio slice should come first?" options: Shell, owner map, saving (Recommended); Toggle list builder; Long-text editor.
- **Answer:** "Shell, owner map, saving (Recommended)"
- **Outcome:** Studio slice 1 = one Studio screen with an owner tree (character, its modules, the preset; scripts, regex, triggers, lorebook, toggles) and the save/undo model later slices reuse.

### DD-094 — Where authoring forms live

- **Date:** 2026-10-26
- **Asked:** Studio slicing, after discovery ([studio/research/today-authoring.md](studio/research/today-authoring.md)) (conflict with completion-plan 02 `:130`, which kept regex/trigger/lorebook forms in Library); "The older plan kept regex, triggers and lorebook forms in the Library and sent only code to Studio. Where should they live now?" options: All in Studio (Recommended); Keep split.
- **Answer:** "All in Studio (Recommended)"
- **Outcome:** Studio hosts every authoring form; Library and chat menus deep-link into the right place in Studio. Supersedes completion-plan 02's split.

### DD-095 — Studio save model

- **Date:** 2026-10-26
- **Asked:** Studio slicing, after discovery ([studio/research/today-authoring.md](studio/research/today-authoring.md)) (today fields bind straight to the DB with no undo, `globalApi.svelte.ts:1531-1613`); "Today every edit saves instantly with no undo. How should Studio save?" options: Hybrid (Recommended); Drafts + Save everywhere; Live everywhere + undo.
- **Answer:** "Hybrid (Recommended)"
- **Outcome:** forms and text save live with a visible status, undo and a restore point; Lua and plugin code stays a draft until Check and Apply, so half-written code never runs in a chat. Resolves DEFERRED_TBD ST-03 direction.

### DD-096 — Combined view order

- **Date:** 2026-10-26
- **Asked:** Studio slice 1 review ([reviews/2026-10-26-studio-slice1-review.md](reviews/2026-10-26-studio-slice1-review.md)) D-1 (F-01: one order claimed for all kinds; source: regex preset → character → modules `scripts.ts:264`, lorebook character → chat → modules `lorebook.svelte.ts:139`); "The combined view ('합쳐서 보기') claimed one engine order for every kind, but regex, lorebook and toggles each merge in a different order. What should it show?" options: Per-kind order + scripts (Recommended); Group by owner only.
- **Answer:** "Per-kind order + scripts (Recommended)"
- **Outcome:** each kind lists items in its own source-verified engine order; a scripts group (triggers and Lua across owners) is added; ordinals only where the order is verified.

### DD-097 — Triggers and Lua as one script list

- **Date:** 2026-10-26
- **Asked:** Studio slice 1 review ([reviews/2026-10-26-studio-slice1-review.md](reviews/2026-10-26-studio-slice1-review.md)) D-4 (F-03); "In the app, triggers and Lua share one list per owner, and V1, V2 and Lua are mutually exclusive. The mockup shows them as two kinds. How should Studio model them?" options: One script list + safe switch (Recommended); Two kinds as mocked.
- **Answer:** "One script list + safe switch (Recommended)"
- **Outcome:** one 'scripts' kind per owner showing its mode (V2 rules / Lua / V1); switching mode keeps the previous list recoverable instead of wiping it (today `TriggerList.svelte:33-39` wipes).

### DD-098 — Phone Back from a deep entry

- **Date:** 2026-10-26
- **Asked:** Studio slice 1 review ([reviews/2026-10-26-studio-slice1-review.md](reviews/2026-10-26-studio-slice1-review.md)) D-2 (F-16); "On phones, when Studio was opened straight at an item (e.g. from the chat), where should Back go?" options: Straight to origin (Recommended); Tree first.
- **Answer:** "Straight to origin (Recommended)"
- **Outcome:** Back returns to the screen that opened Studio; the tree stays one tap away inside Studio.

### DD-099 — Where drafts and history live

- **Date:** 2026-10-26
- **Asked:** Studio slice 1 review ([reviews/2026-10-26-studio-slice1-review.md](reviews/2026-10-26-studio-slice1-review.md)) D-3 (F-09); "Where should drafts, undo history and the replaced live versions be stored?" options: Device-only (Recommended); With the owner.
- **Answer:** "Device-only (Recommended)"
- **Outcome:** kept on this device only, never in export, character cards or sync; Studio says so where drafts are shown.

### DD-100 — Deleting live code

- **Date:** 2026-10-26
- **Asked:** Studio slice 1 review ([reviews/2026-10-26-studio-slice1-review.md](reviews/2026-10-26-studio-slice1-review.md)) D-5 (F-14); "Deleting live Lua or plugin code currently has no confirm, only an undo toast. Keep that?" options: No confirm, durable undo (Recommended); Confirm for code.
- **Answer:** "No confirm, durable undo (Recommended)"
- **Outcome:** one-tap delete stays; the undo survives later edits and stays in History until Studio closes.

### DD-101 — Studio search default scope

- **Date:** 2026-10-26
- **Asked:** Studio slice 1 review ([reviews/2026-10-26-studio-slice1-review.md](reviews/2026-10-26-studio-slice1-review.md)) D-6 (F-05, F-06); "What should search cover by default?" options: Include inactive, tagged (Recommended); Active only + offer.
- **Answer:** "Include inactive, tagged (Recommended)"
- **Outcome:** default search also covers inactive modules and other presets, tagged '꺼짐'; the wide switch is only for other characters.

### DD-102 — Live item changed elsewhere

- **Date:** 2026-10-26
- **Asked:** Studio slice 1 review ([reviews/2026-10-26-studio-slice1-review.md](reviews/2026-10-26-studio-slice1-review.md)) D-7 (F-07); "If a live item is changed somewhere else (another tab or device) while open in Studio, what should happen?" options: Notice + choose (Recommended); Last write wins.
- **Answer:** "Notice + choose (Recommended)"
- **Outcome:** the status chip shows 'changed elsewhere' with Reload or Keep mine; a restore point never silently undoes the other change.

### DD-103 — Script mode memory

- **Date:** 2026-10-26
- **Asked:** Studio slice 1 re-review ([reviews/2026-10-26-studio-slice1-rereview.md](reviews/2026-10-26-studio-slice1-rereview.md)) ND-1 (N-02: one prior slot loses text on Lua → V2 → Lua); "When switching a script list between Lua and V2 rules and back, what should Studio remember?" options: One list per mode (Recommended); One prior slot.
- **Answer:** "One list per mode (Recommended)"
- **Outcome:** each mode keeps its own last list (device-only, DD-099); switching back restores it.

### DD-104 — Multi-word search in Studio

- **Date:** 2026-10-26
- **Asked:** Studio slice 1 re-review ([reviews/2026-10-26-studio-slice1-rereview.md](reviews/2026-10-26-studio-slice1-rereview.md)) ND-2 (N-01: whole query matched as one string); "How should Studio search treat a query with several words, like '숲 규칙'?" options: All words, any order (Recommended); Exact phrase.
- **Answer:** "All words, any order (Recommended)"
- **Outcome:** an item matches when it contains every word in any order; 초성 applies per word; same rule as the Settings lane (DS-015).

### DD-105 — Characters the toggle format can't hold

- **Date:** 2026-10-26
- **Asked:** Studio slice 2 (toggle list builder) start; parser `parseToggleSyntax` (`src/ts/util.ts:788-828`) splits on `=` and `,` with no escaping. "The toggle text format cannot hold '=' in a label or ',' in a select option (no escaping; the engine just cuts them). What should the builder do when someone types one?" options: Block with inline note (Recommended); Swap for look-alikes; New escape syntax.
- **Answer:** "Block with inline note (Recommended)"
- **Outcome:** the field shows a short inline error and the row is not written until fixed; no engine change.

### DD-106 — Renaming keys and reordering select options

- **Date:** 2026-10-26
- **Asked:** Studio slice 2 start; values live in global chat variables `toggle_<key>` with per-chat pinned copies (`Toggles.svelte:106-174, :217-221`), and select values are stored by position. "Renaming a key or reordering select options silently detaches existing chats. What should the builder do?" options: Warn and offer to carry over (Recommended); Warn only; Lock after first use.
- **Answer:** "Warn and offer to carry over (Recommended)"
- **Outcome:** a warning names what changes; the author may carry existing values to the new key or new positions (global value and every pinned chat copy). The carry-over is an app-side migration for lane A; the mockup simulates it.

### DD-107 — How toggle keys are made

- **Date:** 2026-10-26
- **Asked:** Studio slice 2 start; "How should a toggle's key be made?" options: Auto from label, editable (Recommended); Always typed.
- **Answer:** "Auto from label, editable (Recommended)"
- **Outcome:** the builder suggests an ASCII key from the label (t1, t2… when the label has no ASCII letters); an advanced field lets authors change it and shows the CBS snippet.

### DD-108 — Lines the engine can't read

- **Date:** 2026-10-26
- **Asked:** Studio slice 2 start; such lines are dropped silently today (`util.ts:798-820`). "When the text view is switched to the list, what happens to them?" options: Keep as 'unreadable' rows (Recommended); Drop with a notice.
- **Answer:** "Keep as 'unreadable' rows (Recommended)"
- **Outcome:** flagged rows hold the raw text verbatim until fixed or deleted.

### DD-109 — Empty toggle groups

- **Date:** 2026-10-26
- **Asked:** Studio slice 2 builder O2-3 (source: an empty group falls through to an on/off switch, `Toggles.svelte:117-177`); "In the redesigned chat toggles panel, what should an empty group do?" options: Hide it in the panel (Recommended); Keep today's switch.
- **Answer:** "Hide it in the panel (Recommended)"
- **Outcome:** the chat toggles panel skips empty groups (small panel change for lane A); Studio's list flags an empty group row so authors can fill or delete it.

### DD-110 — Repeated renames and the carry-over notice

- **Date:** 2026-10-26
- **Asked:** Studio slice 2 builder O2-4; "When the same key is renamed twice in one visit (combat → battle → fight), should the carry-over warning appear again?" options: Ask again each time (Recommended); Only once per restore point.
- **Answer:** "Ask again each time (Recommended)"
- **Outcome:** the notice compares with the last answered state, so every rename or reorder that would detach values asks.

### DD-111 — Deleting a toggle group

- **Date:** 2026-10-26
- **Asked:** Studio slice 2 builder O2-5; "Deleting a group row in the builder should…" options: Delete the group and its toggles (Recommended); Remove only the group; Ask each time.
- **Answer:** "Delete the group and its toggles (Recommended)"
- **Outcome:** one step with the durable undo toast (DD-100).

### DD-112 — Unique fallback toggle keys

- **Date:** 2026-10-26
- **Asked:** Studio slice 2 review ([reviews/2026-10-26-studio-slice2-review.md](reviews/2026-10-26-studio-slice2-review.md)) M-1 / Q-1; parent verified values are app-wide (`db.globalChatVariables`, per-chat only when pinned: `src/ts/parser/chatVar.svelte.ts:107-125`). "How should keys for non-ASCII labels be made?" options: Unique fallback (Recommended); Ask for a key on first add.
- **Answer:** "Unique fallback (Recommended)"
- **Outcome:** the fallback includes the owner (e.g. `seraphina_t1`, `narr_style_t1`) and is checked against every owner in the app; still editable. Refines DD-107.

### DD-113 — CBS references after a key rename

- **Date:** 2026-10-26
- **Asked:** Studio slice 2 review Q-2; "When a key is renamed, prompts, lorebook and scripts that read {{getglobalvar::toggle_old}} keep reading the old variable. What should the builder offer?" options: Show them and offer to update (Recommended); Warn only.
- **Answer:** "Show them and offer to update (Recommended)"
- **Outcome:** list where the old key is used (Studio search) with an "update all" that rewrites them as one undoable step.

### DD-114 — Carry-over as its own step

- **Date:** 2026-10-26
- **Asked:** Studio slice 2 review M-2 / Q-3; "Carrying saved values over after a rename is an app-side migration that may not be reversible later. How should it be offered?" options: Separate step, its own undo (Recommended); No undo for the carry.
- **Answer:** "Separate step, its own undo (Recommended)"
- **Outcome:** the rename is one undo step; carrying values is a second explicit step with its own undo while in the item. Wording names the global value and pinned chats, with no invented count. Refines DD-106.

### DD-115 — Unanswered carry question across visits

- **Date:** 2026-10-26
- **Asked:** Studio slice 2 builder O2-6; "If you rename a key and close Studio without answering 'carry values over?', should that question still be waiting next time you open the item?" options: Yes, kept on this device (Recommended); No, drop it.
- **Answer:** "Yes, kept on this device (Recommended)"
- **Outcome:** the pending question is stored with the device-only drafts and history (DD-099) and shown as a banner when the item reopens.

### DD-116 — Undoing "update all" across owners

- **Date:** 2026-10-26
- **Asked:** Studio slice 2 builder O2-7; "'Update all' rewrites CBS uses of the old key across several owners (character, modules, preset). How should it undo?" options: One step across owners (Recommended); Per owner + one toast.
- **Answer:** "One step across owners (Recommended)"
- **Outcome:** a single history entry undoes every owner's change together; the Studio shell gains a small cross-owner step.

### DD-117 — "Update all" and sources that still define the old key

- **Date:** 2026-10-26
- **Asked:** Studio slice 2 re-review ([reviews/2026-10-26-studio-slice2-rereview.md](reviews/2026-10-26-studio-slice2-rereview.md)) N-1 / Q-1; "When you rename a key that another source (say a module) still defines too, CBS uses of the old key inside that module still mean the module's own toggle. Should 'update all' rewrite them?" options: Skip them, opt in per source (Recommended); Rewrite everything.
- **Answer:** "Skip them, opt in per source (Recommended)"
- **Outcome:** by default only uses in sources that don't define the old key are rewritten; skipped sources are listed with a per-source "also update" choice. Refines DD-113.

### DD-118 — Studio's long-text editor

- **Date:** 2026-10-26
- **Asked:** Studio slice 3 start, after discovery ([studio/research/long-text.md](studio/research/long-text.md); parent verified highlight is off app-wide, `stores.svelte.ts:125` `disableHighlight = writable(true)`, and `registerCBSMonaco` is empty, `cbsMonaco.ts:22-24`). "What editor should Studio use for long text?" options: One light editor everywhere (Recommended); Light field + Monaco on demand.
- **Answer:** "One light editor everywhere (Recommended)"
- **Outcome:** a textarea that grows with content plus a light CBS highlight overlay, `{{` autocomplete, find, and a full-screen focus mode; no Monaco for text.

### DD-119 — Token counts on long fields

- **Date:** 2026-10-26
- **Asked:** Studio slice 3 start; "Which count should Studio show on every long field?" options: Active preset's model (Recommended); Rough estimate only.
- **Answer:** "active preset's model, but with rough estimate fallback when tokenizer isn't available, such as offline+proprietary online only tokenizers."
- **Outcome:** count for the active preset's model after CBS is filled in, the label naming the model; when that tokenizer is unavailable (offline, or a provider whose tokenizer is online-only) a rough estimate labelled as such.

### DD-120 — Example messages and alternate first messages

- **Date:** 2026-10-26
- **Asked:** Studio slice 3 start; "Should Studio edit them as structured lists?" options: Lists + text view (Recommended); Keep one text box.
- **Answer:** "Lists + text view (Recommended)"
- **Outcome:** one card per example (`<START>` block) or alternate first message, with add, reorder and delete with undo, plus a raw text view for paste and import, like the toggle builder.

### DD-121 — Values used by the CBS preview

- **Date:** 2026-10-26
- **Asked:** Studio slice 3 start; "The CBS preview fills in macros. Which values should it use?" options: Sandbox, can copy this chat's (Recommended); Live chat values.
- **Answer:** "Sandbox, can copy this chat's (Recommended)"
- **Outcome:** the preview starts from safe sample values; a button copies the current chat's variables and toggles into the sandbox; nothing is written back.

### DD-122 — Alternate first messages: no persistent text view

- **Date:** 2026-10-27
- **Asked:** Studio slice 3 review ([reviews/2026-10-26-studio-slice3-review.md](reviews/2026-10-26-studio-slice3-review.md)) Q-1 / spec O3-3; "Alternate first messages are separate entries in the app, so a single text view needs a made-up separator (the mockup uses a '<<<NEXT>>>' line, which breaks if a message contains it). What should Studio offer?" options: Cards + 'paste many' split (Recommended); Keep a text view with separator.
- **Answer:** "Cards + 'paste many' split (Recommended)"
- **Outcome:** alternate first messages are cards only, with a one-time "paste several" action that splits pasted text into cards; example messages keep their real text view. Narrows DD-120 for alternate first messages.

### DD-123 — Example message marker rule

- **Date:** 2026-10-27
- **Asked:** Studio slice 3 review F-10 / Q-2 (engine: a line that is exactly `<start>` after trim and lower-casing, `src/ts/process/exampleMessages.ts:59`); "How should the cards follow it?" options: Match the engine (Recommended); Stricter rule + warning.
- **Answer:** "Match the engine (Recommended)"
- **Outcome:** cards use the engine's marker rule; text before the first marker is a normal opening card, not a warning.

### DD-124 — A <START> line typed inside an example card

- **Date:** 2026-10-27
- **Asked:** Studio slice 3 review F-01 / Q-3; "If someone types or pastes a <START> line inside an example card, what should happen?" options: Split into a new card (Recommended); Refuse the marker line.
- **Answer:** "Split into a new card (Recommended)"
- **Outcome:** when typing pauses, the card splits at the marker into two cards as one undo step.

### DD-125 — Stray "}}" in the CBS checker

- **Date:** 2026-10-27
- **Asked:** Studio slice 3 review F-05 / Q-4 (engine treats a stray `}}` as text); "How should the CBS checker treat it?" options: Ignore in HTML, info elsewhere (Recommended); Warning everywhere.
- **Answer:** "Ignore in HTML, info elsewhere (Recommended)"
- **Outcome:** no problem in html+cbs fields, a quiet info note in prose fields; an unbalanced `{{` stays an error.

### DD-126 — Marking the mockup token count

- **Date:** 2026-10-27
- **Asked:** Studio slice 3 re-review ([reviews/2026-10-26-studio-slice3-rereview.md](reviews/2026-10-26-studio-slice3-rereview.md)) Q-1; "The 'exact' token count in the mockup is a made-up rule, but the chip reads '토큰 200 · GPT-4o' with the 'mockup' note hidden in a tooltip. How should it be marked?" options: Visible '목업' tag (Recommended); Tooltip note is enough.
- **Answer:** "Visible '목업' tag (Recommended)"
- **Outcome:** a small dashed "목업" tag on the chip and the demo option renamed "목업 계산"; removed when a real tokenizer is wired in.

### DD-127 — Colouring while typing in very long fields

- **Date:** 2026-10-27
- **Asked:** Studio slice 3 re-review Q-2; "In fields over 20,000 characters, colouring hides while you type and comes back when you pause (to stay fast). Is that OK?" options: Yes, plain while typing (Recommended); Keep colours always.
- **Answer:** "Yes, plain while typing (Recommended)"
- **Outcome:** accepted and stated in the spec; under 20,000 characters colours stay on while typing.

### DD-128 — When a typed <START> line splits a card

- **Date:** 2026-10-27
- **Asked:** Studio slice 3 re-review N-R1 / Q-3; "When should it split?" options: When you leave the line (Recommended); At the first pause.
- **Answer:** "When you leave the line (Recommended)"
- **Outcome:** split when the caret leaves the marker line or on Enter; deleting the marker before then never splits. Refines DD-124.

### DD-129 — "Paste several" split rule

- **Date:** 2026-10-27
- **Asked:** Studio slice 3 re-review O3-6 / Q-4; "'Paste several' splits on two or more blank lines, which cuts poems, scene breaks or code blocks that contain blank lines. What should it offer?" options: Blank lines + '---' option (Recommended); Blank lines only.
- **Answer:** "Blank lines + '---' option (Recommended)"
- **Outcome:** blank-line rule by default, a "split on --- lines" choice in the same sheet, and never a split inside an unclosed ``` block.

### DD-130 — Preset/model switch confirmation is an inline row, not a toast

- **Date:** 2026-10-27
- **Asked:** chat hooks 1 review F-1 / Q-3; "the undo toast floats over the failed-reply card … What should replace it?" options: Inline status row (Recommended); Keep toast, lift it; Keep as is.
- **Answer:** "Inline status row (Recommended)"
- **Outcome:** the switch, empty-slot and model confirmations become an inline status row above the input bar (as with the return-from-Settings row, slice 1 DD-029); nothing floats over the transcript.

### DD-131 — Undo of a preset switch by keyboard

- **Date:** 2026-10-27
- **Asked:** chat hooks 1 review F-2 / Q-2; "Undo … can only be reached by tabbing about 16 times within 10 s. Settings DS-036 says Alt+Z undoes a switch." options: Alt+Z + reachable (Recommended); Alt+Z only; Ctrl+Z too.
- **Answer:** "Alt+Z + reachable (Recommended)"
- **Outcome:** Alt+Z undoes the switch in chat (Ctrl+Z stays with text fields), and the undo button is reachable without a long tab trip.

### DD-132 — Return-from-Settings row has no retry button of its own

- **Date:** 2026-10-27
- **Asked:** chat hooks 1 review Q-1; "the row under the card has its own '다시 시도' button, right below the card's own '다시 시도'. Keep both?" options: Drop row's button (Recommended); Keep both.
- **Answer:** "Drop row's button (Recommended)"
- **Outcome:** the row only reads "설정을 바꿨어요 · 다시 시도할까요?"; focus lands on the card's 다시 시도. Settings lane to align its SLICE3 §6 wording.

### DD-133 — One failed-reply card for open and background chats

- **Date:** 2026-10-27
- **Asked:** chat hooks 1 review F-4 / Q-4; "A reply that fails in a chat you've left either shows slice 2's old note … or nothing at all. Should those failures use the same card?" options: Same card everywhere (Recommended); Keep old note.
- **Answer:** "Same card everywhere (Recommended)"
- **Outcome:** `failReply` takes a chat id; the card waits in that chat and replaces slice 2's background note.

### DD-134 — Preset hotkeys respect the failed-save guard

- **Date:** 2026-10-27
- **Asked:** chat hooks 1 review F-5 / Q-6; "Ctrl+1–9 switches presets even while the chip shows 'the last preset save failed' … Should the shortcuts respect it?" options: Guard hotkeys too (Recommended); Hotkeys skip guard.
- **Answer:** "Guard hotkeys too (Recommended)"
- **Outcome:** Ctrl+1–9 and Ctrl+P go through the same DS-026 failed-save guard as the chip.

### DD-135 — A failed reply offers only delete in its menu

- **Date:** 2026-10-27
- **Asked:** chat hooks 1 review F-3 / Q-7; "A failed reply still shows copy, translate, read aloud and edit … Which actions should it keep?" options: Delete only (Recommended); Delete + copy error.
- **Answer:** "Delete only (Recommended)"
- **Outcome:** the card's 고치기 and 다시 시도, plus delete; copy, translate, read aloud and edit are hidden.

### DD-136 — No way back to earlier alternatives behind a failed reply, for now

- **Date:** 2026-10-27
- **Asked:** chat hooks 1 review Q-8; "A failed new reply hides the earlier alternative replies behind it. Add a way back to them?" options: Not yet (Recommended); Add 'show previous'.
- **Answer:** "Not yet (Recommended)"
- **Outcome:** the card keeps covering the pager; revisit only if people lose good replies.

### DD-137 — The sample character is 세라핀

- **Date:** 2026-10-27
- **Asked:** chat hooks 1 review Q-9; "spelled '세라핀' in slices 2–4, toggles and Settings, but '세라피나' in slice 1. Which spelling?" options: 세라핀 everywhere (Recommended); 세라피나 everywhere.
- **Answer:** "세라핀 everywhere (Recommended)"
- **Outcome:** slice 1's data changes to 세라핀.

### DD-138 — Settings owns connection and model ids

- **Date:** 2026-10-27
- **Asked:** chat hooks 1 re-review F-R1 / Q-10; "Chat's demo failures use connection ids Settings doesn't know, so '고치기' on a key error opens 'add connection' instead of the existing one. Which ids win?" options: Settings' ids (Recommended); Settings falls back.
- **Answer:** "Settings' ids (Recommended)"
- **Outcome:** chat's synthetic failures (and the app's typed failure) carry Settings' real connection id; one id vocabulary across lanes.

### DD-139 — Language travels across the Settings round trip

- **Date:** 2026-10-27
- **Asked:** chat hooks 1 re-review F-R3 / Q-11; "Starting in Korean, going to Settings by '고치기' and coming back lands the chat in English. Carry the language across?" options: Yes, both ways (Recommended); No.
- **Answer:** "Yes, both ways (Recommended)"
- **Outcome:** both the 고치기 link and the return link carry `lang`, defaulting to the app language. Closes the old open question O-1.

### DD-140 — Ctrl+P and Ctrl+M do nothing during IME composition

- **Date:** 2026-10-27
- **Asked:** chat hooks 1 re-review F-R2 / Q-12; "Pressing Ctrl+P while composing Korean (IME) currently lets the browser's print dialog open. Block it?" options: Block print/mute (Recommended); Open switcher anyway; Leave as is.
- **Answer:** "Block print/mute (Recommended)"
- **Outcome:** while composing, Ctrl+P and Ctrl+M open nothing and the browser default is prevented; Ctrl+1–9 and typing are untouched. Refines DS-023's "left alone" rule for chat.

### DD-141 — A failed reply keeps "이 메시지와 이후 메시지 삭제"

- **Date:** 2026-10-27
- **Asked:** chat hooks 1 re-review N-4 / Q-13; "A failed reply's menu has 삭제 and also '이 메시지와 이후 메시지 삭제'. Keep the second under 'delete only'?" options: Keep it (Recommended); Only 삭제.
- **Answer:** "Keep it (Recommended)"
- **Outcome:** both delete items stay; clarifies DD-135.

### DD-142 — Theme-ready mockups: tokens, part names and two acceptance re-skins

- **Date:** 2026-10-27
- **Asked:** Lane A relayed the maintainer's theme-pack direction (MC-689, MC-691, MC-692, MC-695; reference `C:\Projects\RisuAI\Agents\Theme-Packs.md`). Question: "Lane A relayed: build every mockup on named tokens and stable part names, and re-skin each finished screen with 'Origin Navy' (tokens only) and 'Banana Cocoa' (chat as a messenger layout). Is that your direction, and how should we apply it?" Options: Yes: rule + audit (Recommended); Yes, new work only; Not now.
- **Answer:** "Yes: rule + audit (Recommended)"
- **Outcome:** a standing rule from Studio slice 4 on, recorded in [THEMING.md](THEMING.md). The finished chat, Settings and Studio screens get a token and part-name audit. Chat goes first, with rough Origin Navy and Banana Cocoa re-skins. Finished packs, fonts, images, pack loading and the picker are out of scope.

### DD-143 — Geometry values are tokens too

- **Date:** 2026-10-27
- **Asked:** chat theme pass. "THEMING.md allows only 0, 1px and layout percentages as fixed values. The builder also kept box sizes, offsets, transforms and 44/48 px touch targets fixed (about 380 values). Allow those?" Options: Allow geometry (Recommended); Tokenize them too.
- **Answer:** "Tokenize them too"
- **Outcome:** box sizes, offsets, transforms, touch targets and gradient stops also come from named tokens. Only 0, 1px hairlines and layout percentages stay literal. THEMING.md updated.

### DD-144 — Message and view state exposed as data attributes

- **Date:** 2026-10-27
- **Asked:** chat theme pass, Banana Cocoa finding 1. "Message state like 'first in a run' or 'names hidden' lives in CSS classes, so Banana Cocoa puts a bubble tail on every bubble and needed awkward selectors. Expose that state as data-* attributes packs can target?" Options: Expose as data-* (Recommended); Keep classes.
- **Answer:** "Expose as data-* (Recommended)"
- **Outcome:** state a pack may style is mirrored as `data-*` on the part or root (e.g. `data-run=first|middle|last|single`, `data-meta`, `data-names`, `data-input=touch|hover`) and listed in the screen's parts list.

### DD-145 — One meaning per shared theme token

- **Date:** 2026-10-27
- **Asked:** Settings theme pass, finding 1. "Chat and Settings each defined theme values, and 8 names (e.g. --font, --color-warning, --radius-sheet) are shared but have different default values on each screen. How should packs see them?" Options: Unify defaults (Recommended); Rename Settings' ones; Document the difference.
- **Answer:** "Unify defaults (Recommended)"
- **Outcome:** each shared token name has one meaning and one Deep Nexus default app-wide. Where a screen's value differs, it either adopts the shared value (a small visible change, recorded) or gets its own distinctly named token.

### DD-146 — Shared colour channel tokens for tints

- **Date:** 2026-10-27
- **Asked:** Settings theme pass, finding 2. "Each re-skin has to restate tinted versions of the accent and danger colours (~22 in Settings, 9 in chat), because the Android 10 floor can't mix colours in CSS. Add shared channel values (e.g. --nexus-accent-rgb) so a pack sets the colour once?" Options: Add channel values (Recommended); Keep restating.
- **Answer:** "Add channel values (Recommended)"
- **Outcome:** theme/nexus-tokens.css gains R G B channel tokens for the tinted colours. Tints become `rgb(var(--nexus-accent-rgb) / <alpha>)`. Both lanes switch over.

### DD-147 — One shared layout and input attribute set

- **Date:** 2026-10-27
- **Asked:** Settings theme pass, finding 3. "Settings marks layout as body[data-lay=wide|mid|phone]; chat uses html[data-layout=wide|narrow], and touch/hover input is worked out differently. Align them?" Options: One shared set (Recommended); Settings follows chat.
- **Answer:** "One shared set (Recommended)"
- **Outcome:** both lanes use `html[data-layout=wide|mid|phone]` and one `data-input=touch|hover` rule. Chat gains `mid` where it has a middle width.

### DD-148 — Role tokens on top of the internal ladder

- **Date:** 2026-10-27
- **Asked:** chat theme review M4 / Q1. "44% of chat's theme values are a numbered ladder ranked by size (--space-3, --size-12…); a pack author can't tell what each is for. What should the contract expose?" Options: Add role names (Recommended); Ladder is the contract.
- **Answer:** "Add role names (Recommended)"
- **Outcome:** about 25 role tokens (message gap and padding, row height, header and composer height, sheet padding, control padding, icon size and stroke, focus-ring offset…) form the pack contract and default to the ladder. The ranked ladder is internal and may change.

### DD-149 — Protected surfaces enforced at pack install

- **Date:** 2026-10-27
- **Asked:** chat theme review M2/M3 / Q2–Q3. "A pack can still hide the delete-confirm choices or the failed card using only part selectors. How should protected surfaces be enforced?" Options: Install-time rule (Recommended); Review rule only.
- **Answer:** "Install-time rule (Recommended)"
- **Outcome:** pack install rejects selectors that can reach inside a `data-part-critical` surface. Protected children get their own part names. Any sheet with a danger button or that drops data is protected by default, which marks the slice 4 discard-draft prompt, slice 3 "regenerate an earlier reply" and "remove a missing member".

### DD-150 — Origin Navy follows upstream's default scheme

- **Date:** 2026-10-27
- **Asked:** chat theme review m3 / Q4. "'Origin Navy' currently copies upstream's default charcoal-slate (#21222c). Upstream's actual navy is its 'galaxy' scheme (#0f172a). Which did you mean?" Options: Galaxy navy (Recommended); Default scheme.
- **Answer:** "Default scheme"
- **Outcome:** Origin Navy keeps upstream's current default colours (charcoal-slate); no change.
- **Amended 2026-10-27 (Settings DS-076):** Origin Navy uses upstream's default scheme, adjusted to pass AA. The two colours it changes stay changed.

### DD-151 — Packs may set smaller touch targets and text

- **Date:** 2026-10-27
- **Asked:** chat theme review Q7. "Should themes be allowed to shrink touch targets below 44 dp or lower the minimum text size?" Options: No, app enforces (Recommended); Yes, pack's choice.
- **Answer:** "Yes, pack's choice"
- **Outcome:** there is no app-side floor; touch-target and text-size tokens are fully pack-settable. Deep Nexus and the acceptance packs keep 44/48 dp.

### DD-152 — Own-message actions beside the bubble on mouse, above on touch

- **Date:** 2026-10-27
- **Asked:** chat theme review Q5. "Banana Cocoa puts your message's edit/delete buttons on a line above your bubble. They could sit beside the bubble instead (no structure change). Which?" Options: Beside on mouse, above on touch (Recommended); Always above; Always beside.
- **Answer:** "Beside on mouse, above on touch (Recommended)"
- **Outcome:** Banana Cocoa places own-message actions beside the bubble under `data-input=hover` (`display: contents` on the name row) and above it on touch. Documented as a pack technique; no contract change.

### DD-153 — Extend the state and part contract now

- **Date:** 2026-10-27
- **Asked:** chat theme review M5 / Q6. "Themes can't yet target streaming, selected, hidden-from-AI, bookmarked or current-row states, or buttons/fields/composer innards. Extend the contract before Settings and Studio copy the pattern?" Options: Extend now (Recommended); Later.
- **Answer:** "Extend now (Recommended)"
- **Outcome:** a second chat contract pass adds those states as `data-*`, plus parts for buttons, fields, composer innards, the header title, sidebar row innards and sheet header/handle, and hooks for selection, scrollbar, caret and icons. Settings and Studio follow the extended list.

### DD-154 — Commit the chat theme work now, then run fix round 3

- **Date:** 2026-10-27
- **Asked:** the chat theme re-review (reviews/2026-10-27-chat-theme-rereview.md) found 0 blocker and 2 major issues. N1: packlint accepts rules that break a critical sheet. N2: Settings and Studio still redefine the shared names. Options: Commit now, then fix (Recommended); Fix first, then commit.
- **Answer:** "Commit now, then fix (Recommended)"
- **Outcome:** the verified round 2 state is committed without scratch files. Fix round 3 takes N1 and the scanner gaps. N2 goes to the Settings lane, and to Studio when it next touches its tokens.

### DD-155 — Protection reaches by ancestry, with a declaration allowlist

- **Date:** 2026-10-27
- **Asked:** re-review Q1 (N1). The question was whether the install rule should treat any rule that could reach a critical element, including through an ancestor, as reaching it and accept only declarations on an allowlist. The alternative kept two part lists. Options: Reach + allowlist (Recommended); Keep part lists.
- **Answer:** "Reach + allowlist (Recommended)"
- **Outcome:** a pack rule whose subject may be a critical element, an ancestor of one or one of its children is judged against an allowlist of declarations. Escapes are normalised first. Layout-breaking padding, margin, animation and flex changes are rejected. As a stopgap, the sheet title, header and handle join the protected parts. packlint and THEMING.md rule 5 follow.

### DD-156 — Keep the accent-tint text selection

- **Date:** 2026-10-27
- **Asked:** re-review Q2 (N5). Deep Nexus selection now uses an accent tint instead of the browser's blue. This is the one change to the default look. Options: Keep accent tint (Recommended); Browser default.
- **Answer:** "Keep accent tint (Recommended)"
- **Outcome:** `--selection-bg`/`--selection-text` keep the accent tint by default. The handoff records it as the one deliberate change to the default look.

### DD-157 — Store-backed screens

- **Date:** 2026-10-27
- **Asked:** Lane A relayed this rule from the maintainer, to keep later live multi-tab updates cheap: screens read character, chat and module data from the store by ID and keep no long-lived copies; unsaved input lives in drafts held apart from live data; derived values are recomputed from the store, not cached in components. Options: Yes, record DD-154 (Recommended); Not mine / hold. The number in the question changed because DD-154..156 were recorded first in the same batch.
- **Answer:** "Yes, record DD-154 (Recommended)"
- **Outcome:** a design rule for every screen and mockup. Mockups model data as a store keyed by ID with separate draft holders, and specs say where each screen's draft lives. Multi-session itself is parked.

### DD-158 — Derive solid colours from their channels

- **Date:** 2026-10-27
- **Asked:** re-review Q3. `--nexus-accent` and `--nexus-danger` are each stored twice in the shared file, as hex and as a channel. The question was whether to derive the solids from the channels, with Settings' ss1 check moving to a computed-colour compare. Options: Derive from channel (Recommended); Keep hex + channel.
- **Answer:** "Derive from channel (Recommended)"
- **Outcome:** in order: Settings first adopts the 8 shared values (DD-145). Then `theme/nexus-tokens.css` sets `--nexus-accent: rgb(var(--nexus-accent-rgb))`, and the same for danger, and Settings' ss1/console.mjs compares the computed colour. A pack then sets each colour once.

### DD-159 — Packs may set tokens under root attributes

- **Date:** 2026-10-27
- **Asked:** re-review Q4 (N7). Should a pack be able to set tokens under `html[data-input]` and `html[data-layout]`? Options: Root attributes only (Recommended); No.
- **Answer:** "Root attributes only (Recommended)"
- **Outcome:** token declarations are allowed in `:root`, `html[data-input=…]` and `html[data-layout=…]` and in their combinations. These selectors can't reach a part. packlint and THEMING.md follow.

### DD-160 — A field-only border token for DS-077

- **Date:** 2026-10-27
- **Asked:** Settings DS-077, about default-look contrast. "For DS-077, field borders need more contrast in the default look. Raising the shared `--nexus-edge-strong` from 16% to 34% white gives 3.41:1, but it also brightens every other bordered control, in chat too. Which should it be?" Options: Field-only token (Recommended); Raise edge-strong.
- **Answer:** "Field-only token (Recommended)"
- **Outcome:** `theme/nexus-tokens.css` gets a new shared field-border token at 34% white, used by text inputs in chat and Settings. `--nexus-edge-strong` keeps 16%, so other bordered controls keep their look. The switch-off track (36%) and placeholder (`#888aaa`) values from DS-077 go in with it. The main session applies the change, with a chat pixel and contrast run.

### DD-161 — Only named leaves may be positioned

- **Date:** 2026-10-28
- **Asked:** while the DS-075 value-space rule was being added to chat's packlint. "In chat's theme lint, may packs position safe parts (absolute or relative, within ±64 px) only on named leaves (avatar, message actions, alternatives arrows) or on any safe part?" Options: Named leaves only (Recommended); Any safe part; Strict, like Settings.
- **Answer:** "Named leaves only (Recommended)"
- **Outcome:** Chat's packlint lets packs set `position: absolute|relative` and offsets (±64 px or `auto`) only on the avatar, message-action and alternatives parts. Any other safe part is held to Settings' strict ban (no position, no inset, no negative margin). Banana Cocoa must still pass. Settings keeps `strictSafe: true`. Install-time rule: ENGINE_CHANGES #23.

### DD-162 — Studio slice 4 covers Basic, Advanced and Display

- **Date:** 2026-10-28
- **Asked:** "Which character forms should Studio slice 4 cover? Today's character editor has Basic, Display (images and assets), Advanced (~25 fields), Voice/TTS and Share tabs." Options: Basic, Advanced, Display (Recommended); Basic and Advanced only; All five tabs.
- **Answer:** "Basic, Advanced, Display (Recommended)"
- **Outcome:** Slice 4 replaces the placeholder forms with real Basic, Advanced and Display forms (Display covers portrait, emotion images, image-generation prompts and additional assets), using the slice 3 long-text editor. Voice/TTS and Share go to a later slice.

### DD-163 — Advanced fields are grouped, and empty ones are folded away

- **Date:** 2026-10-28
- **Asked:** "How should the ~25 Advanced fields be laid out?" Options: Grouped, empty ones folded (Recommended); Grouped, all shown; Common first, rest behind 더보기.
- **Answer:** "Grouped, empty ones folded (Recommended)"
- **Outcome:** Advanced fields sit in named groups. A field with a value is always shown. Empty fields are listed under "add a field" in each group, and owner-tree search finds every field, empty or not.

### DD-164 — The group editor is in Studio slice 4

- **Date:** 2026-10-28
- **Asked:** "Should group chats' editor (members, order, group author note) be in slice 4?" Options: Yes, include it (Recommended); Later slice.
- **Answer:** "Yes, include it (Recommended)"
- **Outcome:** A group is a Studio owner with its own form: members, order, talkativeness and the group author note. It reuses the chat slice 3 member vocabulary (DD-053..064) and keeps the character-only tabs hidden, as today.

### DD-165 — Risky character flags get their own protected section

- **Date:** 2026-10-28
- **Asked:** "Where should the low-level access switches and other risky character flags live?" Options: Own 고급 section, protected (Recommended); Inline with the other fields.
- **Answer:** "Own 고급 section, protected (Recommended)"
- **Outcome:** Low-level access and other risky flags sit in a separate section at the bottom with a warning line. Turning one on asks once. The section is marked `data-part-critical`, so packs can't restyle its structure (DD-149).

### DD-166..178 — Studio slice 4 form details

All dated 2026-10-28 and asked from [studio/SLICE4_SPEC.md](studio/SLICE4_SPEC.md) §17. Each entry gives the question as asked, the options (recommended first) and the exact answer.

- **DD-166 (Q4-1), Advanced groups.** Asked: "How should the Advanced fields be grouped (DD-163)?" Options: Seven groups (Recommended); Fewer, larger groups; Today's order. **Answer: "Seven groups (Recommended)"**. Outcome: 프롬프트, 대화, 작품 정보, 변수와 번역, 생성 조정, 기억 and 모듈, then the protected section.
- **DD-167 (Q4-2), alternate first messages.** Asked: "Where should alternate first messages live? Today they're in Advanced (CharConfig.svelte:1153)." Options: Move to Basic (Recommended); Stay in Advanced; Count row in Basic. **Answer: "Move to Basic (Recommended)"**. Outcome: they sit in Basic under the first message, as slice 3's card list.
- **DD-168 (Q4-3), token chips.** Asked: "Which long-text fields show a token count chip?" Options: Every prompt field (Recommended); Today's four only; On focus, plus a total. **Answer: "Every prompt field (Recommended)"**. Outcome: every long-text field that reaches the prompt gets a chip. Which fields are always sent is unverified, and the spec marks it.
- **DD-169 (Q4-6), risky flags.** Asked: "Which character flags go in the protected risky section (DD-165)?" Options: Three risky; icon to Display (Recommended); Only low-level access; All four. **Answer: "Three risky; icon to Display (Recommended)"**. Outcome: low-level access, utility bot and escape output are protected; hideChatIcon moves to Display › 사진. The escape-output explanation stays a placeholder until Lane A traces it.
- **DD-170 (Q4-4), emotion images.** Asked: "How are emotion images added and ordered?" Options: Add several, reorder (Recommended); Add several, no reorder; One at a time. **Answer: "Add several, reorder (Recommended)"**. Outcome: several files at once, named from their file names, and reorderable. Lane A confirms whether the engine uses the order.
- **DD-171 (Q4-5), new portrait.** Asked: "When the author adds a new portrait photo, what happens to the current main one?" Options: New becomes main (Recommended); Joins alternates; Ask each time. **Answer: "New becomes main (Recommended)"**. Outcome: as today, and the old main moves to the alternates.
- **DD-172 (Q4-7), author note.** Asked: "The author note belongs to the open chat, not the character. How should Basic show it?" Options: Only with a context chat (Recommended); Only under 이 채팅 owner; Chat picker in form. **Answer: "Only with a context chat (Recommended)"**. Outcome: shown only with a context chat and tagged "이 채팅"; otherwise a one-line pointer. The memory text follows the same rule.
- **DD-173 (Q4-8), asset rename.** Asked: "When an asset is renamed, what happens to text that uses the old name?" Options: Warn and list uses (Recommended); Offer to rewrite; Nothing. **Answer: "Warn and list uses (Recommended)"**. Outcome: a warning lists the fields that use the old name, and nothing is rewritten.
- **DD-174 (Q4-9), cleared fields.** Asked: "If the author clears an Advanced field, when does it fold away (DD-163)?" Options: Stays for this visit (Recommended); Folds at once; Never folds. **Answer: "Stays for this visit (Recommended)"**. Outcome: the field folds after the author leaves the item.
- **DD-175 (Q4-10), depth prompt.** Asked: "How should the depth prompt's text be edited?" Options: Compact LT, depth beside (Recommended); Single line. **Answer: "Compact LT, depth beside (Recommended)"**.
- **DD-176 (Q4-11), module actions.** Asked: "Where do "Apply module" and "Convert to module" go?" Options: Keep both in 모듈 (Recommended); Tree ⋯ menu; Keep convert only. **Answer: "Keep both in 모듈 (Recommended)"**. Outcome: both stay in Advanced › 모듈, worded as copies, not links.
- **DD-177 (Q4-12), display mode switch.** Asked: "Switching the display mode today overwrites the image-generation text fields with defaults. What should Studio do?" Options: Fill and say so (Recommended); Ask first; Never fill. **Answer: "Fill and say so (Recommended)"**. Outcome: filled fields get a "기본값" tag and a reset, and the switch is one undo step (engine change #29).
- **DD-178 (Q4-13), asset previews.** Asked: "How should assets preview in the Display form?" Options: Thumbs; tap for A/V (Recommended); Follow preview setting; No previews. **Answer: "Thumbs; tap for A/V (Recommended)"**. Outcome: image thumbnails always show; audio and video load on tap.

### DD-179..186 — Studio slice 4 builder gaps

All dated 2026-10-28 and asked from the slice 4 builder report (`studio/checks/builder-checks-s4.md`). Each entry gives the question, the options (recommended first) and the exact answer.

- **DD-179, 바꾸기 on the main portrait.** Asked: "The main portrait tile has a 바꾸기 (replace) action. What should it do?" Options: Same as add (Recommended); Replace and drop; Remove the action. **Answer: "Same as add (Recommended)"**. Outcome: the new photo becomes main and the old one moves to the alternates (DD-171).
- **DD-180, the default tag after an edit.** Asked: "After a display-mode switch fills a field with its default, what happens when the author edits that field?" Options: Tag goes, reset stays (Recommended); Both go; Tag tracks the text. **Answer: "Tag goes, reset stays (Recommended)"**.
- **DD-181, new member talkativeness.** Asked: "What talkativeness does a newly added group member start with?" Options: 3, the middle (Recommended); 1, the lowest; Ask the author. **Answer: "3, the middle (Recommended)"**.
- **DD-182, critical token minimums.** Asked: "A pack can set the risky section's edge and tint tokens to 0, stripping its danger colour. The heading, icon, warning and switches remain. What should happen?" Options: Add token minimums (Recommended); Accept it; Make them constants. **Answer: "Add token minimums (Recommended)"**. Outcome: the shared lint registry (`chat/checks/th/packlint.mjs`) gains a critical-token-minimums field. Studio sets floors for the risky edge width and tint alpha. Install-time enforcement goes to Lane A (ENGINE_CHANGES #23).
- **DD-183, an empty 기억 group.** Asked: "When the 기억 (memory) group has nothing (no chat memory text, no Hypa setting), should it still show?" Options: Hide it (Recommended); Always show header. **Answer: "Hide it (Recommended)"**.
- **DD-184, sticky group headers.** Asked: "Should group headers in Advanced stay pinned while scrolling?" Options: Wide and mid only (Recommended); Phones too; Never. **Answer: "Wide and mid only (Recommended)"**.
- **DD-185, groups in search.** Asked: "Should Studio's "other characters" search also find groups?" Options: Include groups (Recommended); Characters only. **Answer: "Include groups (Recommended)"**. Outcome: `searchOwners` lists groups alongside characters.
- **DD-186, reordering on touch.** Asked: "Emotion images, alternates and members reorder by a handle with a mouse, Alt+arrows or the menu. Should touch drag be added?" Options: Menu on touch (Recommended); Add touch drag. **Answer: "Menu on touch (Recommended)"**. Outcome: no touch drag; on touch, reorder through the row menu, as in slice 3.

### DD-187 — Settings floors the over-limit warning edge only

- **Date:** 2026-10-28
- **Asked:** a follow-up to DD-182, relayed from the Settings lane. "Settings has two more tokens a theme pack could zero out: --param-warn-bar (the edge of the over-limit warning) and the field-border alpha on row glass (now checked only by a contrast ≥ 2 rule). Should they get minimums too?" Options: Floor the warn bar only (Recommended); Floor both; Neither.
- **Answer:** "Floor the warn bar only (Recommended)"
- **Outcome:** Settings' registry adds a `minimums` floor for `--param-warn-bar`. The field border keeps its contrast check only. The DS-097 dim-opacity floor is separate.

### DD-188..193 — Studio slice 4 review decisions

All dated 2026-10-28 and asked from [reviews/2026-10-28-studio-slice4-review.md](reviews/2026-10-28-studio-slice4-review.md).

- **DD-188, private-license content.** Asked: "Today's app refuses to show a private-license character's content. Studio slice 4 shows it read-only. What should Studio do?" Options: Match today: hide content (Recommended); Show read-only; Hide from Studio. **Answer (Other): "How about we make this toggle - hide by default, toggle with caution to make it read only? I'm suggesting this because I've seen developers manually bypassing this rule because they lost original, non-hidden card."**
  - Follow-up: "For your private-license toggle (hidden by default, read-only when revealed), how should revealing work?" Options: Per character, asks once (Recommended); One Settings switch; Per character, remembered. **Answer: "Per character, asks once (Recommended)"**.
  - Outcome: content is hidden by default. A "내용 보기" button on the character's notice opens a protected caution question. Revealed text is read-only and selectable, and it hides again when Studio closes. Export stays blocked. Content search doesn't reach hidden text.
- **DD-189, header Undo with chat-scoped fields.** Asked: "When a chat-scoped field (author note, memory) has focus, which owner should the header Undo act on?" Options: The focused field's owner (Recommended); Always the character. **Answer: "The focused field's owner (Recommended)"**. Outcome: Undo follows focus, and its label names the owner ("이 채팅 되돌리기").
- **DD-190, asset "used in" scan.** Asked: "The asset "used in" check scans only the character's own text, so it can wrongly say an asset is unused. What should it do?" Options: Scan everything (Recommended); Scope the wording. **Answer: "Scan everything (Recommended)"**. Outcome: the scan also covers the character's lorebook, regex and scripts.
- **DD-191, leaving during an import.** Asked: "If the author leaves the item while images are still importing, what should happen?" Options: Keep importing (Recommended); Ask before leaving; Cancel with a message. **Answer: "Keep importing (Recommended)"**. Outcome: the import continues, and a toast reports the result with a link back to the item.
- **DD-192, floors for the risky section.** Asked: "The protected risky section reads text, spacing and touch-size tokens that a pack can currently set to 1px or 0. Which minimums should apply (extending DD-182)?" Options: Match chat's critical rules (Recommended); Edge and tint only; Lock them as constants. **Answer: "Match chat's critical rules (Recommended)"**. Outcome: Studio's registry `minimums` sets text ≥ 11 px, buttons and switches ≥ 32 px, padding and gaps ≥ 4 px, alpha ≥ the Deep Nexus value × 0.5, plus the edge and tint floors.
- **DD-193, escape-output confirm text.** Asked: "What should the turn-on confirm for 출력 이스케이프 (escape output) say until Lane A traces its effect?" Options: Honest placeholder (Recommended); Today's help text. **Answer: "Honest placeholder (Recommended)"**. Outcome: "답장을 표시하는 방식이 바뀌어요. 정확한 효과는 아직 확인 중이에요", marked as a mockup note to replace (O4-1).

### DD-194..196 — Studio slice 4 re-review decisions

All dated 2026-10-28 and asked from [reviews/2026-10-28-studio-slice4-rereview.md](reviews/2026-10-28-studio-slice4-rereview.md).

- **DD-194, what DD-188 hides.** Asked: "DD-188 hides a private-license character's content. Does that include its lorebook, regex, scripts, toggles and background HTML, not just the form fields?" Options: Yes, everything (Recommended); Form fields only. **Answer: "Yes, everything (Recommended)"**. Outcome: a shell-level guard covers every item kind. Item names show as the kind name only, nothing can be added, search returns nothing, opening an item shows the notice, and the reveal covers all of it read-only.
- **DD-195, ceilings for the risky section.** Asked: "Theme packs can also push the risky section the other way: a 300 px font or padding hides its buttons off screen, and a full-strength tint hides the heading. Should the floors get ceilings too?" Options: Ceilings plus contrast (Recommended); Floors only. **Answer: "Ceilings plus contrast (Recommended)"**. Outcome: caps for font, padding, gap, edge width and tint alpha; a line-height floor; the heading checked for contrast against the tinted surface; relative units (vw, vh, %, em, ch) rejected on floored tokens; every layout and @media branch resolved, with the worst case judged. The shared lint gains ceilings next to `minimums`.
- **DD-196, import result after Studio closes.** Asked: "If Studio is closed before an import finishes, where should its result show?" Options: App-wide toast (Recommended); Next time in Studio; Cancel on close. **Answer: "App-wide toast (Recommended)"**. Outcome: the result toast shows wherever the author is, with "Studio에서 보기".

### DD-197 — Studio layout sizes get floors

- **Date:** 2026-10-28
- **Asked:** from the focused re-check ([reviews/2026-10-28-studio-slice4-recheck.md](reviews/2026-10-28-studio-slice4-recheck.md) R-2). "Beyond the risky section, a theme can set Studio layout sizes, such as the form width, thumbnails, portraits and talk segments, to 1px and collapse the form. Should those get floors too?" Options: Floor layout sizes (Recommended); Risky section only.
- **Answer:** "Floor layout sizes (Recommended)"
- **Outcome:** Studio's registry adds `minimums` for form max width, fold rows, talk segments, thumbnails, portraits, depth and the disabled alpha. Packs may still shrink them within the floors.
- **Values (asked 2026-10-28):** "DD-197 gave no numbers, so the builder chose these layout floors: form width 280 px, fold rows and talk segments 32 px, thumbnails 40 px, portrait 96 px (alternates 56 px), member avatar 24 px, depth field 56 px, disabled alpha 0.3. Keep them?" Options: Keep these (Recommended); Looser floors ("Halve the size floors (e.g. portrait 48, thumbnails 20), giving packs more room to go compact."). **Answer: "Looser floors"**. Values: form width 140 px, fold rows and talk segments 16 px, thumbnails 20 px, portrait 48 px (alternates 28 px), member avatar 12 px, depth field 28 px. The disabled alpha is not a size and stays at 0.3. This matches DD-151 (no size floor for packs); Deep Nexus keeps its 44/48 dp.

### DD-198..201 — Review and theme readiness for the remaining mockups

All dated 2026-10-28. The user raised the question: "shouldn't we also review the other mockups in /mockups such as main menu, and make them also support theme packs?" Task: [tasks/2026-10-28-mockups-theme-pass.md](tasks/2026-10-28-mockups-theme-pass.md).

- **DD-198, which pages.** Asked: "Which /mockups pages should get a review and theme-pack support? Six of them (conversation, settings, models-and-prompts, studio, character-editor, extensions-and-tools) are already replaced by the newer chat, Settings and Studio slices." Options: Pages with no newer slice (Recommended); Home and first-run only; All 18 pages. **Answer: "Pages with no newer slice (Recommended)"**. Outcome: in scope are home, startup, onboarding, run-status, status-marks, realm, data-and-backups, playground, system-surfaces, task-detail, context-editor and identity-and-loadouts. The six superseded pages stay as references.
- **DD-199, depth.** Asked: "How deep should the pass go?" Options: Review, then theme retrofit (Recommended); Theme retrofit only; Full redesign as slices. **Answer: "Review, then theme retrofit (Recommended)"**. Outcome: an independent UX review of each page against current decisions, then a THEMING retrofit: tokens only, `data-part` names, protected surfaces, Origin Navy and Banana Cocoa re-skins, and a shared-packlint registry. Layout and behaviour change only where the review finds a defect, and product questions come to the user.
- **DD-200, Studio slices 1–3.** Asked: "Studio slices 1-3 also predate the theme rules (spec §12 lists what they need). Include them in this pass?" Options: Yes, include them (Recommended); Later. **Answer: "Yes, include them (Recommended)"**.
- **DD-201, order.** Asked: "Which page goes first?" Options: Home (main menu) (Recommended); Startup and onboarding. **Answer: "Home (main menu) (Recommended)"**. Outcome: home first, then the rest in batches of two or three.

### DD-202..214 — Home review decisions

All dated 2026-10-28 and asked from [reviews/2026-10-28-home-review.md](reviews/2026-10-28-home-review.md) §5. Each entry gives the question, its options (recommended first) and the exact answer.

- **DD-202, language and font.** Asked: "Home has no Korean today. How should language and font work on Home?" Options: Korean first, like chat (Recommended); English first; Follow OS locale. **Answer: "Korean first, like chat (Recommended)"**. Outcome: Korean by default, `?lang=ko|en`, a strings table, and the NanumSquare Neo UI face (DD-034).
- **DD-203, persona.** Asked: "Home's persona picker silently changes the active persona for every unbound chat, unlike Settings 5a. What should Home show?" Options: Read-only chip (Recommended); Picker, clearly worded; Remove it. **Answer: "Read-only chip (Recommended)"**. Outcome: a chip shows the active persona and links to 설정 › 페르소나, with "지정 없는 채팅에 써요".
- **DD-204, runs.** Asked: "Each Home mode allows one active run. What happens when the author sends while one is running?" Options: One per mode, say so (Recommended); Queue it; Parallel runs. **Answer: "Parallel runs"**.
  - Follow-up: "You chose parallel runs per mode. How many can run at once, and how are they shown?" Options: Up to 3, each a row (Recommended); No limit; Limit set in Settings. **Answer: "Up to 3, each a row (Recommended)"**.
  - Outcome: up to 3 runs per mode at once, each with its own row and Stop in Tasks. A 4th send waits and says so.
- **DD-205, background replies.** Asked: "Should Roleplay background replies (DD-039) show on Home?" Options: Badges plus Tasks rows (Recommended); Badges only; Nothing on Home. **Answer: "Badges plus Tasks rows (Recommended)"**.
- **DD-206, RisuRealm before agreement.** Asked: "In Hybrid and the empty library, "Browse RisuRealm" skips the agreement that Roleplay requires. What should happen before the user agrees?" Options: Same gate everywhere (Recommended); Hide the link; Ask on first load. **Answer: "Same gate everywhere (Recommended)"**.
- **DD-207, Back for Home's layers.** Asked: "How should Esc and Back work for Home's layers (hub, Trash, drawer, pickers)?" Options: Pop the top layer (Recommended); Esc only; Separate routes. **Answer: "Pop the top layer (Recommended)"**. Outcome: the hub and Trash push history entries, and Back at the root uses the DD-008 toast.
- **DD-208, Roleplay navigation on phones.** Asked: "On phones, Roleplay's drawer is a 76 px icon-only rail. How should Roleplay navigation work?" Options: Labelled drawer (Recommended); Rail, long-press labels; Bottom tab bar. **Answer: "Labelled drawer (Recommended)"**.
- **DD-209, top bar.** Asked: "The mode switcher jumps when you change mode at 1280. How should the top bar lay out?" Options: One layout per width (Recommended); Always centred; Own row. **Answer: "One layout per width (Recommended)"**. Outcome: one layout per `data-layout` band, the same in every mode.
- **DD-210, return contract.** Asked: "When Home opens Settings or Studio, how should they come back to Home?" Options: Full return contract (Recommended); Add home to Studio only; Library origin. **Answer: "Full return contract (Recommended)"**. Outcome: Home sends `from=home&lang=&mode=&return=`. Settings and Studio read `lang` and `return`, and coming back restores Home with its drafts and scroll.
- **DD-211, status mark.** Asked: "Low power and reduced motion: what should the animated run status mark do?" Options: Animate in low power (Recommended); Stop in both; Text status. **Answer: "Animate in low power (Recommended)"**.
- **DD-212, wave.** Asked: "The background wave fires on every press, including scrolls, control clicks and behind dialogs. What should it do?" Options: Background taps only (Recommended); Keep as is; Off on touch. **Answer: "Background taps only (Recommended)"**. Outcome: the loop also pauses behind dialogs.
- **DD-213, touch floor.** Asked: "Most phone controls on Home are under 44 dp. What touch floor should Home use?" Options: 44 touch, 40 hover (Recommended); 44 everywhere; Leave to packs. **Answer: "44 touch, 40 hover (Recommended)"**.
- **DD-214, Trash.** Asked: "How should Home's Trash for characters work? Settings uses 최근 삭제 with a retention rule (DS-034)." Options: Align with 최근 삭제 (Recommended); Separate Trash; Delete with confirm. **Answer: "Align with 최근 삭제 (Recommended)"**. Outcome: Trash uses the same name and fixed retention as Settings. A trashed character's chats are hidden with it and come back on restore.

### DD-215..218 — Studio slices 1–3 theme retrofit

All dated 2026-10-28 and asked from the retrofit builder's report (`studio/THEME_AUDIT.md`).

- **DD-215, delete and revert in menus.** Asked: "In the Studio 1-3 theme retrofit, delete in item and card menus and revert in the focus-mode menu are ordinary (pack-stylable) menu items; the Undo toast that follows is protected. Should those menu items be protected too?" Options: Leave them ordinary (Recommended); Protect those items. **Answer: "Leave them ordinary (Recommended)"**.
- **DD-216, protected long-text actions.** Asked: "In the long-text editor, only revert and replace-all are protected. Protect more actions?" Options: Keep these two (Recommended); Add fix and replace-one. **Answer: "Keep these two (Recommended)"**.
- **DD-217, shared warning channel.** Asked: "--color-warning has no channel token in the shared file, so Studio defines its own --studio-warning-rgb and a pack must set both. Add a shared --nexus-warning-rgb?" Options: Add it to shared (Recommended); Keep Studio-only. **Answer: "Add it to shared (Recommended)"**. Outcome: `theme/nexus-tokens.css` gains `--nexus-warning-rgb`, with `--color-warning` derived from it (DD-158). Studio, chat and Settings point at it, with a pixel check in each.
- **DD-218, review.** Asked: "Independent review of the Studio 1-3 theme retrofit?" Options: Focused review (Recommended); No review. **Answer: "Focused review (Recommended)"**.


### DD-219..222 — Visual warnings and task progress

All dated 2026-10-28. The user suggested: "currently export/import screen or many warnings only shows wall of text on the popup. I think these can use better visuals, including animations and progress bar similar to startup mockup."

- **DD-219, surfaces.** Asked: "Which screens should get the visual treatment first?" (multi-select). Options: Export and import (Recommended); Restore and recovery; Warning and danger dialogs; Long tasks elsewhere. **Answer: all four: "Export and import (Recommended), Restore and recovery, Warning and danger dialogs, Long tasks elsewhere"**.
- **DD-220, warning form.** Asked: "What should replace the wall of text in a warning?" Options: Icon, headline, 2-3 bullets (Recommended); Illustrated cards; Diagram of the data. **Answer: "Icon, headline, 2-3 bullets (Recommended)"**. Outcome: a status mark or icon, a one-line headline, a short list of concrete consequences (counts, sizes, names), and the detail behind a disclosure, keeping the DD-149 protected-surface rules.
- **DD-221, progress.** Asked: "How should export and import show progress?" Options: Startup-style steps + bar (Recommended); Bar only; Steps only. **Answer: "Startup-style steps + bar (Recommended)"**. Outcome: named steps, a determinate bar with counts, the Nexus status mark, Cancel where it's safe, and a result card that lists what was skipped.
- **DD-222, motion.** Asked: "How much motion?" Options: Purposeful, floor-safe (Recommended); Rich; Minimal. **Answer: "Purposeful, floor-safe (Recommended)"**. Outcome: motion only shows progress and state changes, within the Note 9 / Pi 3 budget. Reduced motion shows the same states without movement, and low power keeps the status mark (DD-211).

### DD-223..234 — Warning and progress pattern details

All dated 2026-10-28. The questions came from [patterns/WARNINGS_AND_PROGRESS.md](patterns/WARNINGS_AND_PROGRESS.md) §0 and [patterns/MOTION_CONTRACT.md](patterns/MOTION_CONTRACT.md).

- **DD-223, undo window.** Asked: "Undo windows differ today: 6 s in chat and Studio, 10 s in Settings, and closing Studio silently drops delete-undo. Should they match?" Options: 10 s everywhere (Recommended); 6 s everywhere; Keep per lane. **Answer: "10 s everywhere (Recommended)"**. Outcome: one 10 s window. Where undo ends early, the toast says so (for example "until Studio closes"). Chat and Studio change from 6 s.
- **DD-224, cancel.** Asked: "The app's backup writer can't stop partway through. When should backup and restore offer Cancel?" Options: Before first write (Recommended); Add engine cancel; Never during tasks. **Answer: "Before first write (Recommended)"**. Outcome: Cancel while files are gathered or before restore replaces data. After that it is hidden, with a line saying why.
- **DD-225, import.** Asked: "Does importing ask first, and can a whole import be undone in one step?" Options: Ask on replace, 1 Undo (Recommended); Always preview; Report only. **Answer: "Ask on replace, 1 Undo (Recommended)"**. Outcome: adding never asks; replacing or duplicating asks. The result card lists skipped items and offers one grouped "Undo import" (feasibility not verified in the app).
- **DD-226, token home.** Asked: "The pattern needs ~50 new tokens, 7 of them shared motion basics like ease-out and exit duration. Where should they live?" Options: New shared file (Recommended); All in nexus-tokens; Per lane. **Answer: "New shared file (Recommended)"**. Outcome: `theme/pattern-tokens.css`, aliased by each lane. The 7 shared motion tokens go into `theme/nexus-tokens.css`. One registry fragment adds floors and ceilings in every lane.
- **DD-227, leave-out list.** Asked: "The export warning must name what's left out of the upstream .bin file, but the app has no list of fork-only data. Who supplies it?" Options: Lane A list, present only (Recommended); Fixed list in design. **Answer: "Lane A list, present only (Recommended)"**. Outcome: Lane A's engine returns the fork-only kinds present, with counts; design owns the copy. Mockups use a synthetic list marked mock.
- **DD-228, extension.** Asked: "The data mockup and Settings say .risub, but the app and onboarding say .bin. Which should the mockups show?" Options: .bin, plus .rtb (Recommended); Keep .risub. **Answer: ".bin, plus .rtb (Recommended)"**. Outcome: `.risub` was a placeholder; mockups show `.bin` and the fork-only `.rtb` backup.
- **DD-229, confirms.** Asked: "Some actions ask twice (removing a character, partial backup), and Settings 5a purges with no confirm at all. How should destructive confirms work?" Options: One confirm with counts (Recommended); Plus type-to-confirm; Keep two-step asks. **Answer: "One confirm with counts (Recommended)"**. Outcome: one confirm naming the consequences. Permanent purges always confirm, with the item count and total size.
- **DD-230, placement.** Asked: "When should a warning be an inline banner and when a sheet, and when does 'Paused' show?" Options: Banner caution, sheet danger (Recommended); Always a sheet. **Answer: "Banner caution, sheet danger (Recommended)"**. Outcome: caution is an inline banner; confirm and danger use a sheet. "Paused" shows only when a condition blocks the task (offline, another tab, app in background); a question the person must answer is a confirm step.
- **DD-231, failure shake.** Asked: "The brand's 'error' status mark shakes. Should it shake when a task fails here?" Options: Off in this pattern (Recommended); Remove everywhere; Keep the shake. **Answer: "Off in this pattern (Recommended)"**.
- **DD-232, skips.** Asked: "How should 'done, but some items were skipped' look?" Options: Done + warning badge (Recommended); New 'partial' status; Text only. **Answer: "Done + warning badge (Recommended)"**. Outcome: no new mark status.
- **DD-233, danger cue.** Asked: "Danger warnings: any motion cue, and a guard against the tap that opened the warning confirming it by accident?" Options: One ring + 250 ms guard (Recommended); Static + guard; Hold to confirm. **Answer: "One ring + 250 ms guard (Recommended)"**. Outcome: one faint ring on open, danger only, off in reduced motion and low power. Confirm ignores input for 250 ms after opening.
- **DD-234, toasts.** Asked: "Background tasks finish in a toast. How long does it stay, and how are several shown?" Options: Smart hide, 2 + chip (Recommended); One combined toast; Always stays. **Answer: "Smart hide, 2 + chip (Recommended)"**. Outcome: a clean finish hides after 6 s, paused while hovered or focused; skips or failure stay. Two show at once, then "+N". Only the newest mark animates.

### DD-235..241 — Home retrofit follow-ups

All dated 2026-10-28, from the Home builder's open questions (`home/HANDOFF.md`).

- **DD-235, shared roles.** Asked: "Chat, Settings and Home each define the same roles (warm, success, touch size, focus ring) with different values. Promote shared ones?" Options: Promote and align (Recommended); Keep per-area copies; Leave to packs. **Answer: "Promote and align (Recommended)"**. Outcome: `--nexus-warm-rgb`, `--nexus-success-rgb`, one touch size and one focus-ring pair join `theme/nexus-tokens.css`; chat, Settings and Home align in their next rounds.
- **DD-236, field border.** Asked: "The shared field border measures 2.92:1 on the canvas, short of DD-160's 3:1. Fix it?" Options: Raise to 36% (Recommended); Accept 34%; Darken the canvas. **Answer: "Raise to 36% (Recommended)"**. Outcome: `--nexus-field-border` goes to 36% in `theme/nexus-tokens.css`, with each lane's pixel checks re-run.
- **DD-237, run cap.** Asked: "Background Roleplay replies and the cap of 3 parallel runs: do replies count toward it?" Options: Share the cap of 3 (Recommended); Separate cap; No cap for replies. **Answer: "Share the cap of 3 (Recommended)"**.
- **DD-238, switcher.** Asked: "The mode switcher stays at the same height in every mode, but shifts sideways up to 72 px because the rail width differs per mode. OK?" Options: Accept the shift (Recommended); One rail width; Overlay the rail. **Answer: "Accept the shift (Recommended)"**. Superseded by DD-247.
- **DD-239, prompts link.** Asked: "Home links to a 'prompts' section in Settings › Models, which doesn't exist yet. What should the link do?" Options: Settings adds it (Recommended); Link to page only. **Answer: "Settings adds it (Recommended)"**. Outcome: Settings adds `section=prompts`; until then the link opens the Models page.
- **DD-240, pack layout limits.** Asked: "The shared lint stops a pack from building a bottom tab bar, unread dots, transitions, or re-laying reach-tier parts. Loosen it?" Options: Accept the limits (Recommended); Allow rail layout; Name more leaves. **Answer: "Name more leaves"**. Outcome: Home names more positionable leaves (DD-161) so packs can re-lay rows. Protected surfaces stay where they are.
- **DD-241, composer.** Asked: "The composer field and Send are ordinary parts, so a theme pack may hide them. Protect them?" Options: Protect them (Recommended); Leave to chat's rule. **Answer: "Protect them (Recommended)"**. Outcome: the Home composer field and Send move to the reach tier.

### DD-242..249 — Theme lint holes and review follow-ups

All dated 2026-10-28, from [reviews/2026-10-28-studio-theme-review.md](reviews/2026-10-28-studio-theme-review.md) and [reviews/2026-10-28-home-rereview.md](reviews/2026-10-28-home-rereview.md).

- **DD-242, install strictness.** Asked: "Both reviews found the shared theme lint accepts packs it shouldn't: a protected sheet set to transparent, colours it can't resolve (color-mix, oklch, light-dark) and ~54 unbounded tokens that protected parts read. How strict should installing a pack be?" Options: Fail closed (Recommended); Bound tokens one by one. **Answer: "Fail closed (Recommended)"**. Outcome: packs may set only listed role tokens. Unresolvable colours are rejected. Protected surfaces must stay opaque and meet contrast. Internal ladders (sizes, spacing, scales) are not pack-settable. Applies to the shared `chat/checks/th/packlint.mjs` and every area's registry.
- **DD-243, safe tier.** Asked: "Ordinary (safe) parts may use display, visibility, opacity and pointer-events, so packs can hide Apply, Undo/Redo, Stop, the Tasks button, navigation or focus rings. Restrict?" Options: Protect key controls (Recommended); Ban hiding everywhere; Keep as is. **Answer: "Protect key controls (Recommended)"**. Outcome: navigation, Tasks, Stop, composer and Send, Apply, Undo/Redo and the failed-save chip move to the reach tier, and packs can't change outlines. Other safe parts keep DD-155's freedom.
- **DD-244, toast under sheet.** Asked: "At 360 px the Undo toast sits on top of protected sheets' Cancel and Restore buttons. Fix?" Options: Hide toast under sheet (Recommended); Sheet above toast. **Answer: "Hide toast under sheet (Recommended)"**. Outcome: the toast hides while a protected sheet is open and returns after, with its timer paused.
- **DD-245, first focus.** Asked: "Destructive protected sheets (Restore, Apply) focus the confirm button first. Which should get initial focus?" Options: Cancel, everywhere (Recommended); Keep confirm first. **Answer: "Cancel, everywhere (Recommended)"**.
- **DD-246, module apply.** Asked: "Studio's module Apply is a single tap with no confirm or Undo. Add one?" Options: Add Undo, no confirm (Recommended); Confirm and Undo; Keep single tap. **Answer: "Add Undo, no confirm (Recommended)"**. Outcome: Apply runs at once and offers the 10 s Undo (DD-223).
- **DD-247, switcher.** Asked: "Home's mode switcher still shifts sideways per mode, so a fast double click can flip back. You accepted the shift (DD-238); the reviewer suggests centring it. Change?" Options: Centre on viewport (Recommended); Keep DD-238. **Answer: "Centre on viewport (Recommended)"**. Supersedes DD-238.
- **DD-248, queue cap.** Asked: "Home's waiting queue is unbounded (12 sends gave 9 queued). Cap it?" Options: Cap at 5 per mode (Recommended); No cap. **Answer: "Cap at 5 per mode (Recommended)"**. Outcome: beyond 5 waiting, Send says the queue is full; queued items show "waiting", not "running".
- **DD-249, trash and drafts.** Asked: "Trashing a character that has a running reply, and parked Home drafts older than 10 minutes: what should happen?" Options: Stop reply; keep drafts (Recommended); Ask before trashing. **Answer: "Stop reply; keep drafts (Recommended)"**. Outcome: the reply stops and is listed as cancelled, and the character's chats leave recent threads. Parked drafts last the tab session, with a note if one is dropped.
- **DD-250, repair link.** Asked: "Home's 'repair hidden modes' link expects a repair state that only exists in the old mockups/settings.html; the new Settings has no such state yet. Where should it point?" Options: New Settings, repair in 5c (Recommended); Old mockup for now. **Answer: "New Settings, repair in 5c (Recommended)"**. Outcome: Home links through `settings/index.html` (DS-148), and Settings adds the all-modes-hidden repair state in slice 5c.

### DD-251..254 — Warning and progress pattern, wave 0 follow-ups

All dated 2026-10-28, from the wave 0 builder's open decisions (`patterns/README.md`).

- **DD-251, .bin warning.** Asked: "The .bin export warning asks you to choose (Cancel / full .rtb backup / export .bin anyway). Should it show as a caution sheet, not a banner?" Options: Caution sheet (Recommended); Danger sheet. **Answer: "Caution sheet (Recommended)"**.
- **DD-252, restore in background.** Asked: "Restore can't be cancelled once it starts writing. Should it offer 'keep going in the background' like export and import?" Options: No, stay in view (Recommended); Allow background. **Answer: "No, stay in view (Recommended)"**.
- **DD-253, undo start.** Asked: "When does the grouped 'Undo import' 10 s window start?" Options: When the result shows (Recommended); While the card is open. **Answer: "When the result shows (Recommended)"**. Outcome: 10 s from the result card appearing, paused while it is hovered or focused.
- **DD-254, pattern floors.** Asked: "The builder set floors for theme packs: caution and danger edges must differ by at least 60 RGB distance, and a set of geometry floors and ceilings (focus ring, bullets, shadows up to 64 px). Accept as proposed?" Options: Accept proposals (Recommended); Looser, like DD-197. **Answer: "Accept proposals (Recommended)"**.
- **DD-255, focus when Cancel hides.** Asked: "When Cancel hides at the first write, focus currently drops to the page body. Where should it go?" Options: Dialog shell (Recommended); Progress status line. **Answer: "Dialog shell (Recommended)"**. From [reviews/2026-10-28-pattern-review.md](reviews/2026-10-28-pattern-review.md).
- **DD-256, pack size bound.** Asked: "A legal theme pack with every size at its ceiling pushes a sheet's buttons 1000+ px below the screen. How to bound it?" Options: Height rule + scroll (Recommended); Lower ceilings only. **Answer: "Height rule + scroll (Recommended)"**. Outcome: the lint rejects packs whose worst-case sheet height exceeds a phone screen, and the focused action always scrolls into view.
- **DD-257, headline length.** Asked: "Headlines wrap to two lines at 360 px. What's the rule?" Options: Target 36/60, allow 2 lines (Recommended); Strict one line. **Answer: "Target 36/60, allow 2 lines (Recommended)"**.

### DD-258..260 — Fail-closed lint follow-ups

All dated 2026-10-28, from the lint builder's report (`theme/checks/`, THEMING.md install rules).

- **DD-258, private variables.** Asked: "The fail-closed lint rejects each Banana Cocoa pack because it uses its own private helper variables (--bc-*, --banana-*, --msg-*). Allow a pack-private prefix?" Options: Allow one prefix (Recommended); No private variables. **Answer: "Allow one prefix (Recommended)"**. Outcome: packs may define helpers under one private prefix that only the pack reads. The lint still judges the values they produce, and packs rename their helpers to it.
- **DD-259, transparent.** Asked: "'Transparent' is rejected only where a token draws something; decorative blooms and glows the packs switch off are exempt. Keep that reading?" Options: Keep the exemption list (Recommended); Strict, no exemptions. **Answer: "Keep the exemption list (Recommended)"**.
- **DD-260, residual gaps.** Asked: "Gaps the lint still leaves open: other ordinary parts can be hidden, safe-tier padding and some role tokens (e.g. header height) are unbounded, ancestor padding isn't summed, and fonts are free. Close more?" Options: Bound sizes, keep freedoms (Recommended); Leave as is; Also protect banners. **Answer: "Bound sizes, keep freedoms (Recommended)"**. Outcome: ceilings for unbounded size tokens and safe-tier padding, and ancestor padding summed. Hiding ordinary parts and fonts stay a pack's freedom (DD-155).

### DD-261..267 — Home second re-review and Studio re-check

All dated 2026-10-28, from [reviews/2026-10-28-home-rereview2.md](reviews/2026-10-28-home-rereview2.md).

- **DD-261, Utility recents.** Asked: "Home's Utility recent rows still open the old task-detail mockup, which drops your draft and language. Fix?" Options: Stay on Home (Recommended); Legacy page honours return; Leave as a stub. **Answer: "Stay on Home (Recommended)"**. Outcome: rail recents and thread rows become buttons that open the task card on Home.
- **DD-262, status badges.** Asked: "A theme pack can still hide the reply/run status badges and the Tasks count, which are the only signal that something is running. Protect them?" Options: Protect the 3 badges (Recommended); Keep as decided. **Answer: "Protect the 3 badges (Recommended)"**. Outcome: `home-bg-badge`, `home-run-status` and the Tasks `home-badge` move to the reach tier.
- **DD-263, switcher clamp.** Asked: "Between 768 and 900 px the centred switcher overlaps the Hybrid/Utility rail. Fix?" Options: Clamp to the rail (Recommended); Raise the mid band; Accept. **Answer: "Clamp to the rail (Recommended)"**. Outcome: centred, but never left of the rail's right edge (refines DD-247).
- **DD-264, Back toast.** Asked: "Coming back from Settings with the browser's Back shows Home's 'press Back again to quit' toast. Suppress it?" Options: Suppress once (Recommended); Accept. **Answer: "Suppress once (Recommended)"**.
- **DD-265, attribute-only selectors.** From [reviews/2026-10-28-studio-theme-rereview.md](reviews/2026-10-28-studio-theme-rereview.md). Asked: "A pack can still pad or resize protected banners and sheets through attribute-only selectors like [data-kind=restore] that name no part, squeezing them at 360 px. Close it?" Options: Reject sizes on them (Recommended); Accept. **Answer: "Reject sizes on them (Recommended)"**. Outcome: in every area, selectors that name no part may not set padding, border width, font size or width.
- **DD-266, Studio tree width.** Asked: "Studio writes the user's tree-column width on load, so a pack's default width never applies. Fix?" Options: Only after a drag (Recommended); Drop the role token. **Answer: "Only after a drag (Recommended)"**.
- **DD-267, informational cues.** Asked: "Packs can still hide the draft banner, toggle banners and the long-text problems list (ordinary parts under DD-260). Protect any?" Options: Leave hideable (Recommended); Protect draft banner. **Answer: "Leave hideable (Recommended)"**.
- **DD-268, Studio raster exemption.** Asked: "One Studio state (tg-paste-sheet at 1280) shows a 17-pixel text-raster difference behind the sheet's scrim, only when another state loaded first; the cause wasn't found. The builder pinned it as a narrow, logged exemption. Accept?" Options: Accept the exemption (Recommended); Drop the state; Find the cause. **Answer: "Accept the exemption (Recommended)"**. Outcome: the 3-pixel-strip exemption stays, marked unresolved in `studio/THEME_AUDIT.md`.


### Settings & models lane: DS-001 to DS-078

Recorded by the parallel Settings & models session (2026-10-26) in [settings/DECISIONS-settings.md](settings/DECISIONS-settings.md), with each question and the exact answer text. They keep their DS numbers so the Settings spec and reviews stay valid; this index is the merge into the main log.

- DS-001 — Settings & models pain points
- DS-002 — Settings & models scope
- DS-003 — Settings & models starting point
- DS-004 — First Settings & models slice
- DS-005 — What "prompt presets" means
- DS-006 — Settings index grouping
- DS-007 — What settings search finds
- DS-008 — Low-power mode
- DS-009 — Where Settings opens on wide screens
- DS-010 — Changed-from-default marker and reset
- DS-011 — Where provider keys live
- DS-012 — Device-scoped settings
- DS-013 — 모델·프리셋 order and landing
- DS-014 — Service addresses
- DS-015 — Multi-word search with no results
- DS-016 — "모든 프리셋 공통" chip
- DS-017 — Preset quick switch
- DS-018 — Organising a long preset list
- DS-019 — How preset edits save
- DS-020 — Switching presets inside a chat
- DS-021 — Preset binding to chats or characters
- DS-022 — Favourites vs Ctrl+1–9 slots
- DS-023 — Shortcut keys in text fields
- DS-024 — Recovering deleted presets
- DS-025 — Keep-on-switch locks under live save
- DS-026 — Failed live save
- DS-027 — Secrets in undo and restore points
- DS-028 — Undo for folder delete and bulk move
- DS-029 — Preset for regenerate/continue/swipe after a switch
- DS-030 — Chains and loadouts referencing a preset
- DS-031 — Name rules
- DS-032 — Organisation in exports (spec O-1)
- DS-033 — Ctrl+0 (spec O-4)
- DS-034 — How long 최근 삭제 keeps presets
- DS-035 — Locked values in single export
- DS-036 — Undo key for library actions
- DS-037 — Undo for create, duplicate, import
- DS-038 — Particles after Latin-letter names
- DS-039 — Slot key clash on capture
- DS-040 — Settings slice 3 content
- DS-041 — Connections are named objects
- DS-042 — Where the model can be changed
- DS-043 — Fix-it path for failed replies
- DS-044 — One models page
- DS-045 — Picker shows the whole catalog
- DS-046 — Connection test on demand
- DS-047 — Saved keys masked
- DS-048 — Custom models under their connection
- DS-049 — Deleting a connection in use
- DS-050 — Capabilities in the picker
- DS-051 — Per-task model defaults
- DS-052 — Choosing a model whose connection failed its check
- DS-053 — Models hidden by the connected-only chip
- DS-054 — Model binding with several connections per provider
- DS-055 — When the chat return row appears
- DS-056 — 고치기 targets for quota and network
- DS-057 — Undo of a connection delete does not navigate
- DS-058 — Environment-reference keys survive undo
- DS-059 — Provider routing options live in the connection
- DS-060 — Migrating reverse-proxy settings
- DS-061 — Provider options stored per connection
- DS-062 — Return language after a change in Settings
- DS-063 — Model and row in the 고치기 link
- DS-064 — Fix offer when a sibling connection has the model
- DS-065 — Naming the connection beside a model
- DS-066 — After 연결 추가하고 쓰기
- DS-067 — Store-first screens (live multi-tab readiness)
- DS-068 — Connections and upstream .bin: translate at export
- DS-069 — Keys in exports: sharing exports only
- DS-070 — Fork-only data and upstream .bin
- DS-071 — Contrast gate for packs
- DS-072 — Which Settings prompts are protected
- DS-073 — Baseline flattens transparency
- DS-074 — Packs may move the Settings index
- DS-075 — Pack install rule bounds values
- DS-076 — Origin Navy: upstream's scheme, adjusted for AA
- DS-077 — Deep Nexus meets the contrast it asks of packs
- DS-078 — Focus rings: inset on full-bleed rows, with a rendered check

## Open

Raised by [2026-10-25-android-system-surfaces](tasks/2026-10-25-android-system-surfaces.md); details in [the spec](system-surfaces/android/SPEC.md#open-decisions). Recommended option first.

| ID | Question | Recommended |
|---|---|---|
| D-7 | Make image generation stoppable | Out of scope here |
| D-8 | Persistent "reply ready" notification | Deferred (DD-010) |
| D-12 | Android 16 Live Updates | Deferred (DD-010) |

