# Note 9 run 2026-11-28d: phone rows observed

Date 2026-11-28. Observations only; acceptance is for the owning sessions and lane A. Refs #883, #882, #886, #685, #822. Records: MC-4940 to MC-4944 in `Agents/mc/note9-run-d.md`. This note closes nothing.

## Setup

- Phone 1 (`29f3cde9193f7ece`), the only device session. Leases: `note9d-build` (android-build, released) and `note9d-phone` (note9, ports 6270-6309). Released clean: the end census equalled the start baseline (`workflow-device-reset.mjs end`, `needsReset false`). `net-status` after the run: `wifi_enabled=off associated=no validated=no`. `reverse --list` and `forward --list` empty.
- Source: origin/main `fdc636f59288d36d53af44c155703d33aaa69f02` (merge of PR #917). Release APK built in a detached scratch worktree (`node_modules` junction, only the gitignored generated Android files copied in). Unsigned SHA-256 `71da1fa4c93bc5835162af48e1a430f7f74989bc84dc7af75e4b1152c1f2e3ce`. Re-signed with the persistent test key (certificate SHA-256 `69c387cd...29aaf`), SHA-256 `785f3acdfbbcb5d15cc9b0ee24732d241f588146b2c48fa1f905aa30ff5ac46a`; install verdict pass, `debuggable=False`. `git status` of the build worktree listed only `AndroidManifest.xml` and `gradlew` (line endings); `git diff --ignore-cr-at-eol` was empty.
- Library: regenerated with the current generator (`Agents/Tools/save-gen/c806-library.mjs`, background filler wrapped in `<div hidden>`), seed 4940, 3 characters, 1 chat each, 6 messages. Renamed to `ProseHold` (assistant message with prose around two fences, user message with prose and a fence), `LongMsgs` (generator long mixed-script messages), `Assets3000` (3000 `additionalAssets`). `rd-rund.bin` 185,968 bytes. Pushed with `fixture-push.ps1` (device SHA-256 verified). Restored through Welcome > Restore a backup > two confirms > the system chooser, file tapped by screenshot coordinates; 3 characters imported.
- The first launch showed leftover synthetic data (one character) instead of Welcome; I ran `pm clear` (playground reset) before the restore.
- Preview switches (Settings > Accessibility, per device): "New chat screen (preview)" and "Studio (preview)" ON for the shell and Studio rows; "New chat screen" turned OFF again for the classic-chat rows. "Studio (preview)" was left ON at the end. WebView DPR 2.625, viewport 411x773, `data-layout=phone`, `data-input=touch`.
- CDP via `adbg` forward to `webview_devtools_remote_<pid>`; taps and holds via `input tap` and `input swipe x y x y 700`.
- Pushed files `rd-rund.bin`, `rd-loreA.json`, `rd-loreB.json` and the app-written `lorebook_export.json` were removed by exact name afterwards. Raw outputs: `%TEMP%\risu-note9-run-d\` (not in the repository).

## Rows

| Row | Result | Observation |
|---|---|---|
| #883 / PR #895, real hold on prose | OBSERVED | New chat shell. A 700 ms hold on assistant prose ("Prose between the blocks.") selected the word "between" with the system toolbar; no message sheet. CDP: selection `between`, `[data-hold-select]` count 0, no dialog. After a relaunch, a hold on user prose selected "Second" with the toolbar and no sheet. A hold on the fenced block with a language showed only the Copy and Download menu. One extra hold, made while an earlier selection toolbar was still showing, opened the message sheet (Copy, Copy as card, Select text, Edit, Branch from here, Bookmark, Disable Message, Cut Messages for AI, Customize buttons, Remove, Delete from here); that was an unclean state and is not the clean-hold result. |
| #882 / PR #893, long messages | OBSERVED, no overlap seen | LongMsgs and Assets3000 chats in the shell show one text layer in screenshots. Article heights 703, 2057, 1717, 1837, 1317, 857, 773 css px, each `scrollWidth` equal to `clientWidth` (405 or 406). `[data-risu-card-background]` rect 0,0,411,774, z-index auto. `elementsFromPoint` at the Back centre (30, 23): SVG, `BUTTON aria-label=Back`, `HEADER`; at (380, 23): SVG, `BUTTON This chat`. Header rect 0,0,411,48. |
| #886 / PR #896, Studio asset list | OBSERVED, rows present | Studio > Assets3000 > Display and assets > Assets 3000 tab, first open after the fresh import: 13 `[data-window-key]` rows at about +1.5 s, +3 s and +4.5 s with no input; the screenshot shows asset-0 to asset-4 with the png placeholder. The first sample came more than 1 s after the tap, so the +60 ms and +1 s marks were not captured. |
| #685 / PR #890, Import | OBSERVED | Studio > Assets3000 > Lorebook, Import opened the system chooser; a long press on `rd-loreA.json` and a tap on `rd-loreB.json` gave "2 selected"; Select returned. Toast "Imported 3 entries", form status "Saved"; entries `loreA-0`, `loreA-1`, `loreB-0` appended after `g2-c0` to `g2-c2` (DOM and screenshot). |
| #685 / PR #890, Export | OBSERVED | Export opened the system save picker with the name `lorebook_export.json` (Downloads); Save gave the toast "Successfully exported and saved to the location you chose." The file was 6303 bytes, SHA-256 `d9fbf445d884f4eaa6a9cb7a696671e43f21571fe0a948a3c1542ca8d16e3937`; parsed: `type risu`, `ver 1`, 6 entries (`g2-c0`, `g2-c1`, `g2-c2`, `loreA-0`, `loreA-1`, `loreB-0`). |
| #822 / PR #903, D-1 TalkBack | OBSERVED, partly | tbdriver session (TalkBack plus capture TTS), classic chat. Settings before: `tts_default_synth` null, `enabled_accessibility_services` null, `accessibility_enabled` 0; after `session.ps1 -Action off` the read-back was the same. Swipe-next order: WebView ("RisuTanium"), "Skip to message box" button, "Skip to messages" button, Sidebar, "Assets3000", "Message" label, composer EditText, Send. Activating "Skip to message box" focused the composer EditText (keyboard shown). Activating "Skip to messages" focused a View spanning the message region (speech "지역"; keyboard hidden); the next swipe reached "Synthetic User", then Edit, then More actions; swipe-back returned along the same path. The oldest message was not reached. |
| #822, D-3 composer with keyboard | OBSERVED, one setting | Classic chat, `fixedChatTextarea` off (default), single-line composer. Keyboard up: `innerHeight` 485, `visualViewport.height` 485.3, composer rect y 433, height 44, bottom 477, so it sat fully above the keyboard. The composer menu (Continue Response, Screenshot, Post File, Auto Suggest, Modules) opened above the composer, not clipped. |
| #822, D-4 phone half, tap sizes | OBSERVED | Classic chat in touch mode, by CDP rects (css px): Sidebar toggle 44x44; Message 286x44; Send 48x44; Menu 49x44. Chat sidebar open: Menu 56x32, Close sidebar 18x18, Chat Options, Edit, Export chat, Delete chat, Export all chats, Import chat, Edit, Branches, Bookmarks and New folder each 18x18 (their parent row, 267x40, was not measured as a hit area). |
| #822, D-2 phone header | OBSERVED, partly | Classic chat header shows the sidebar toggle (44x44, arrow icon) and the character name "Assets3000", no floating arrow seen in the screenshots. |

## Not run

- #883: double-tap on a word, "Select text" from the sheet in a clean state, a hold on a plain fence, the More actions route.
- #886: sampling at +60 ms and +1 s after the tap.
- #822 D-2: long-name truncation, top-bar pill below the header, rotate to mid width and back, waifu theme (a long-name character would need an edit of app state, which the brief forbids). D-3: `fixedChatTextarea` on, `heightMode` variants, gesture-nav inset, a multi-line composer. D-4: tap sizes of other screens. D-1: the oldest message in the swipe order.
- Later groups (Home group, packs and apply cost, #816, #885, #303, D-LOCK and the preset sheet) belong to their own sessions.

## Deviations and incidents

- The release build was started with a hidden `Start-Process`, against maintainer rule 5; a background waiter task notified on completion, so the finish was not missed.
- `pm clear` was run once after the first launch showed leftover synthetic data (see Setup).
- The stale-selection hold above, and the sampling-time gap for #886.
- Two Studio taps (Settings menu entries) landed on the wrong row once because I computed screen y from css y without the status-bar offset; no state changed beyond opening the Language page, which was closed.
- "Studio (preview)" was left ON on the device.
