### MC-4940 — Note 9 run 2026-11-28d: build, install and library, 2026-11-28

- Tag: run record. Date: 2026-11-28. Exact times: UNKNOWN. Related: `#883`, `#882`, `#886`, `#685`, `#822`, MC-4870.

**Build and install.** Release APK built from origin/main `fdc636f59` (merge of PR #917) in a detached scratch worktree (`node_modules` junction, only the gitignored generated Android files copied in). Unsigned APK SHA-256 `71da1fa4c93bc5835162af48e1a430f7f74989bc84dc7af75e4b1152c1f2e3ce`. `git status` showed `AndroidManifest.xml` and `gradlew` modified by the build; `git diff --ignore-cr-at-eol` was empty, so line endings only. Re-signed with the persistent test key (certificate SHA-256 `69c387cd...29aaf`), signed SHA-256 `785f3acd...5ac46a`, and installed on Note 9 phone 1 (`29f3cde9193f7ece`); the install step verified `debuggable=False`. The build was started with a hidden `Start-Process`, against the background-launch rule; a waiter task notified on completion.

**Library.** Regenerated with `Agents/Tools/save-gen/c806-library.mjs` (filler wrapped in `<div hidden>`), seed 4940, characters renamed `ProseHold`, `LongMsgs`, `Assets3000` (3000 additional assets). Pushed with `fixture-push.ps1`, device hash verified, restored through the Welcome flow in the system chooser. One `pm clear` ran first because the first launch held leftover synthetic data.

### MC-4941 — Note 9 rows observed on the shell and Studio, 2026-11-28

- Tag: run record. Date: 2026-11-28. Exact times: UNKNOWN. Related: MC-4940, `#883`, `#882`, `#886`, `#685`.

Observed on phone 1 with the new chat screen and Studio previews on: clean holds on prose gave native selection without the message sheet; long-message chats showed one text layer with the header buttons uncovered; the Studio asset list had 13 rows on first open without input (+60 ms and +1 s marks not captured); lorebook Import took two files from the system chooser (3 entries, "Imported 3 entries") and Export wrote a 6-entry `lorebook_export.json`. Detail and the not-run legs are in `Agents/Findings-2026-11-28-note9-run-d.md`.

### MC-4942 — #822 phone rows observed, 2026-11-28

- Tag: run record. Date: 2026-11-28. Exact times: UNKNOWN. Related: MC-4941, `#822`.

D-1 ran through tbdriver (skip links announced; "Skip to message box" focused the composer, "Skip to messages" focused the message region and the next swipe reached the newest message); D-3 for one setting (composer 8 px above the keyboard, menu above the composer); D-4 phone tap sizes by CDP rects; D-2 partly. TalkBack and TTS settings read back to null, 0 and null after teardown. Not run: long-name truncation, rotation, waifu theme, `fixedChatTextarea` on, multi-line composer.

### MC-4943 — Disclosures for the run, 2026-11-28

- Tag: disclosure. Date: 2026-11-28. Exact times: UNKNOWN. Related: MC-4940, MC-4941, MC-4942.

A hold made while an earlier selection toolbar was still showing opened the message sheet; it is reported separately from the clean-hold result. The #886 samples started more than 1 s after the tap. A wrong Settings tap opened the Language page once and was closed. "Studio (preview)" stayed ON on the device and "New chat screen (preview)" was turned OFF for the classic-chat rows.

### MC-4944 — Run closed, phone released clean, 2026-11-28

- Tag: handoff. Date: 2026-11-28. Exact times: UNKNOWN. Related: MC-4940.

The pushed files and the app-written `lorebook_export.json` were removed by exact name, the CDP forward was removed, `reverse --list` and `forward --list` were empty, and the reset helper's end census equalled the start census, so the `note9` lease was released with `--clean`. `net-status` read `wifi_enabled=off associated=no validated=no`. The later groups (Home group, packs and apply cost, #816, #885, #303, D-LOCK and the preset sheet) are not started and need their own sessions.
