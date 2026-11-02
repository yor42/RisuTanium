# What changed from upstream RisuAI

> **This page is maintained from the project's own records** (commit history, the roadmap and the upstream-merge log), not from a fresh test of every item. Most changes below are checked by automated tests and review; many have not been tried on a real phone or in a long real-world session. "Reported" means a record says so but it has not been confirmed independently. Where the records disagree or are thin, the item is left out.

RisuTanium is a fork of RisuAI. It stays compatible with upstream: a `.bin` backup moves both ways, and upstream characters, modules, presets and plugins keep working. This page is current to **2026-11-02**. It has merged upstream RisuAI **v2026.10.292** (upstream commit `ea61945f9`, 2026-10-30); a fetch on 2026-11-02 showed no newer upstream `main` commit.

RisuTanium has **not had a public release**. This page describes what the code on the fork's main branch does. A release-signed Android build exists only on the maintainer's own phone. Items marked "on main" are in the code but not all are called finished in the project's records.

## What is the same

- **Backups work both ways.** A `.bin` from upstream always imports here. A `.bin` made here imports into upstream. If something in your library is too large for upstream to hold, or has no upstream equivalent, the export warns you first, names it, and waits for your confirmation before it starts. Cancelling writes nothing.
- **Your upstream content keeps working:** characters, modules, presets, plugins (see the V2.1 note below) and the integrations upstream supports.
- **One exception:** full backups saved on `risuai.xyz` are encrypted by upstream, and only that site can read them. RisuTanium refuses them and imports nothing. See [[Migrating from upstream]] for this, for the routes out, and for the services that were removed.
- **Names:** the product is shown as "RisuTanium". Upstream is "RisuAI".

## Where your API key goes on a web build

On a static web build of RisuTanium (not the desktop app, not Android, and not the Node server), requests to AI providers (other than localhost addresses, which a web build refuses anyway) go through upstream RisuAI's proxy at `sv.risuai.xyz` (`/proxy2`), the same as upstream's own hosted build. Your API key travels with the request, so it passes through upstream's server. The desktop app and Android send requests directly from the device. The Node server uses its own `/proxy2`. The maintainer decided on 2026-11-02 to document this and change nothing. The code has a plain-fetch setting that skips the proxy; no toggle for it was found in the settings screens (not fully checked).

## Rewritten systems

### Saving and storage

Upstream keeps your library as one large saved database. RisuTanium writes it as many small pieces (characters, chats, modules, assets) and keeps most characters as lightweight placeholders until you open them. This matters for big libraries, where one huge file used to be slow, memory-hungry and risky.

What you see:

- A recovery screen at startup if a save is damaged, and a list of earlier saved versions to restore from ("Load Internal Backup").
- A visible indicator when a browser tab has stopped saving, and a message naming exactly which items could not be saved, instead of silent loss.
- Older saves convert automatically. A malformed older save is refused, or offered without the broken parts, rather than crashing.
- Web, desktop and Node server all share one storage contract. The OPFS switch is gone; an OPFS profile is copied back into the browser's IndexedDB at startup. Desktop save files are replaced through a temporary file, so a crash mid-save does not leave a half-written file.
- The Node server checks revisions before writing, so two clients cannot silently overwrite each other.
- Saving yields to the interface during long saves, and on Android a hidden page keeps saving.

Limits: a tab that stops saving is still "parked" until you act on it; the records say the multi-tab design is still under review. [[Settings Backup and Files]] covers the backup screens.

### Backups and large files

- `.bin` export streams instead of building one giant file in memory. Restore and CharX import also stream. Browser assets can be as large as 1 GiB where the store streams.
- A cut-short backup is refused before anything is written. A restore is refused while another import, export or save is running, or while other tabs are open.
- Backups carry every piece they reference, all plugin storage and inlays. Local backup files are named with the export date.
- Export can be cancelled on web, and large CharX exports are cancellable.
- A faster fork-to-fork backup format is a design only and is not shipped.

### Chat alternatives (rerolls and candidate replies)

Alternatives are kept as sibling branches in a tree, with a counter and previous/next buttons on the chat screen. Each branch keeps its own memory and script state. SillyTavern swipes import into the tree. A `.bin` made for upstream leaves the alternatives out after naming them. Records list this as on main with some device checks still owed.

### Chats stay separate

A send, its scripts, Lua triggers, lorebook, prompt, persona, summaries, tools and `/` commands now read and write the chat they started in, not whichever chat you switched to meanwhile. One generation runs at a time per send, and the composer remembers each chat's unsent text.

### Modules

Modules that no character uses load as lightweight stubs and are read only when a chat, export or screen needs them. With 100+ modules this lowers memory use and speeds boot. Features that need modules (translator, suggestions, HypaV3, subtitles) wait for the chat's modules. A synthetic 169-module test on a phone passed on a small number of runs; it is not called complete.

### Plugins

- V2.1 plugin execution is retired. Existing V2.1 plugin entries stay untouched in your database and `.bin`; V3 plugins are unaffected.
- V3 permission choices are scoped to script and permission. A plugin needs the `db` permission for character, chat and database APIs and cannot read another plugin's saved arguments. Plugin network requests go through a destination policy.
- New: export a plugin's script as `.js`, and import several plugin or module files at once.
- Merged from upstream: V3 plugins are now all unloaded on reload (before, about half stayed running with stale scripts).

### Speed and rendering

- The character list and Grid view show only what is near the screen; avatars load as they come into view.
- Returning from Settings no longer rebuilds the chat twice. A 100 ms page poll was replaced by event handling. Rerolls copy only new messages. Context trimming counts tokens only as far as needed.
- Toggling a module that changes nothing visible no longer rebuilds the chat.

These are descriptive measurements on specific machines, not a promise of a frame rate on every device.

### Security

- The Node server needs a password, with rules for tokens and request sizes. Desktop and Android check native network destinations, trim permissions, and ask before installing Python or starting a module's stdio command.
- Imported presets cannot redirect stored API keys. Several unsafe HTML sinks were closed.

### Android

The fork has an Android build: a foreground service keeps work alive and shows a "Generating a reply..." notification with Stop. A reply finished while the app is hidden is saved. Other apps can open cards, modules, presets and `.bin` files in it. Only the maintainer's own phone has a signed build; there is no public Android release.

## New features

- **Import:** Backyard `.byaf` characters, YAML cards, and chats from SillyTavern `.jsonl`, Chub, Ooba, Agnai, Kobold Lite and Character.AI (tested on synthetic files only). SillyTavern lorebooks keep secondary keys, disabled entries, probability, position and depth. SillyTavern presets import in Settings and Playground.
- **Characters and lists:** Grid follows the sidebar order, with folders, bulk edit, drag and merge, sorting, and search over descriptions, tags and creator. "Empty trash" button. "Copy as card" in the message menu.
- **Keys and models:** `${NAME}` environment-variable references for keys (see [[API Keys from Environment Variables]]); refresh-model-data button, context and pricing from OpenRouter, deprecated models tagged; Claude 5 Opus with adaptive thinking.
- **Languages:** Spanish and Japanese (the Japanese is machine-drafted, with no native review).
- **Utility mode:** a first slice (task presets and a run screen), shown on desktop only. It is early.

## Removed or changed features

Details and routes are on [[Migrating from upstream]].

| Gone | Notes |
|---|---|
| RisuAccount sign-in, sync, hub and Kei | RisuRealm stays; local `.bin` is the only restore |
| Google Drive backup | Local `.bin` only |
| Multiuser chat | `Message.name` is kept |
| V2.1 plugin execution | Data kept, nothing runs |
| Global Lorebook and Global Regex settings pages | Pages retired |
| Picture-in-picture keep-alive | A stored `pip` setting reads as `off` |
| OPFS storage switch | See Saving and storage |
| Desktop auto-updater | Off until the fork has its own releases |

## Bugs fixed

Upstream links appear only where the records name one. Fixes are on main; most are verified by tests, not on a device.

### Saving and data safety

- Edits to a character you had not selected were not saved.
- Two characters sharing one id could lose a saved block. Both are now kept, and the app says so.
- An unloadable character list could be written. Saving now pauses and names what cannot be saved.
- Edits made while the first save was still encoding are kept.
- A save with an oversize body, or a full disk, now stops with a clear message instead of retrying forever (follows upstream's Node write-error change).
- Pages hiding or closing now save pending edits; finished replies save while hidden.
- Auto-reload between tabs no longer destroys local drafts, and a cancelled reload no longer stops saving.
- Preset renames and images were silently discarded; fixed. A corruption prompt could wipe a lorebook; fixed.
- Saving or switching with an out-of-range preset id no longer throws: the working settings are kept as a new "New Preset". Applying a loadout no longer adds an empty entry ([upstream #1387](https://github.com/kwaroran/Risuai/pull/1387), the remaining small gaps after the reported scenario was fixed). Checked by tests.
- A read failure in older archive storage never overwrites or deletes data.
- A stuck module no longer blocks character and chat saves.
- The Node server's password is now saved before it is accepted.
- On Android, a card opened during a restore could be lost and a second `.bin` dropped; fixed.
- An empty or missing persona selection is repaired at load. The record calls this "upstream-latent".

### Backup, import and export

- A restore no longer runs while other work is writing or other tabs are open.
- A local backup now includes assets that are not `.png` ([upstream #1582](https://github.com/kwaroran/Risuai/pull/1582), reported fixed).
- CharX files with zip signature bytes inside assets import whole ([upstream #1217](https://github.com/kwaroran/Risuai/pull/1217), reported fixed).
- "Save Backup Locally" no longer fails on a null `byteLength` ([upstream #1013](https://github.com/kwaroran/Risuai/issues/1013), reported fixed).
- A failed module export or Realm share no longer reports success or posts a partial card.
- Cut-short or damaged CharX and PNG files are refused before anything is saved.
- A multi-file import tries every file and lists failures.
- Malformed or nameless cards are refused with a message before saving.
- Chat import now works for characters saved before chat folders ([upstream #994](https://github.com/kwaroran/Risuai/pull/994), reported fixed).
- A character whose id collides with an upstream data block gets a new id.
- On the web build, the notices after an export, a backup, the bug-report settings export and the translation cache export say the download started, not that it was saved, because the browser may still ask whether to keep the file ([upstream #843](https://github.com/kwaroran/Risuai/issues/843), reported on Firefox on iOS; iOS was not tried here). The desktop and Android apps keep the "saved" wording. Checked by tests; the wording of the translation-JSON notice is English only.

### Chat

- Delete removed the wrong message in some cases; it now removes the one clicked, with "only this one" or "this and everything after".
- Switching chats kept the previous chat's messages; fixed. Each chat keeps its own reroll history.
- A chat could splice into the wrong chat at index -1 ([upstream #1352](https://github.com/kwaroran/Risuai/pull/1352), reported fixed).
- A chat whose alternate first message no longer exists uses the default instead of failing; the same applies to a missing list of alternate first messages ([upstream #1353](https://github.com/kwaroran/Risuai/pull/1353), reported fixed with two low-risk unguarded reads remaining).
- A message that fails to display shows its text and keeps Edit.
- Stop before the first byte is silent, and Stop cancels a native stream.
- Back closes dialogs, settings and panels on mobile.
- Prompt-template runs now send trigger start and history-end text.

### Lua, triggers and lorebook

- Lua loads from the app instead of `unpkg.com`, so Lua works offline.
- Each trigger write applies to its own chat. Nested trigger runs are capped.
- Regex lorebook keys such as `/dragon/i` now activate ([upstream #1532](https://github.com/kwaroran/Risuai/pull/1532), merged from upstream). Invalid regex keys match nothing.
- Lorebook scan depth beyond the chat length scans every message (the record notes upstream has this too).
- A Lua-written lorebook entry no longer disappears in onStart/onOutput ([upstream #1041](https://github.com/kwaroran/Risuai/issues/1041), [#1042](https://github.com/kwaroran/Risuai/pull/1042), reported fixed).
- Full Word Matching missed a key that was followed or preceded by punctuation, quotes, a line break, full-width punctuation or markup such as `*Alice*` ([upstream #340](https://github.com/kwaroran/Risuai/issues/340)). A key now matches in those cases, and a key with spaces matches as a whole phrase. Korean, Japanese and Chinese letters still count as word letters, so matching inside a word of those scripts is unchanged. An empty key never matches in this mode. Checked by tests.
- **New, RisuTanium only: "SillyTavern-style Word Boundaries"**, a per-lorebook option next to Full Word Matching. It is off by default. When it is on, only English letters, digits and `_` count as word letters, so a key can match inside a longer word in another language (for example a key inside a Korean word). Module lorebook entries follow the character option; modules have no setting of their own. The option is saved in `.bin` backups. It is written into a character card (as the `risu_fullWordAsciiBoundary` extension) only when it is on, and a card that has it turns the option on when imported. Upstream has no such option. Two paths can still leave a stale copy of the extension in a card's stored extensions, which an upstream card export would then write: switching a lorebook to global settings and back, and importing a card that lacks the scan fields. This was traced in the code, not run.
- Deleting a lorebook folder now removes everything inside it, nested folders included; before, the contents stayed stored and were exported ([upstream #1667](https://github.com/kwaroran/Risuai/pull/1667)). Drag and drop is available only while no entry is open in that list. Deleting a folder in a list that is not the character's own is not written back. Checked by tests.

- Lua `setFullChat` dropped message details (generation info, prompt info, speaker, name, the disabled and comment flags) even on messages the script had not changed. Upstream: [issue #1564](https://github.com/kwaroran/Risuai/issues/1564), [PR #1611](https://github.com/kwaroran/Risuai/pull/1611). A message with the same position, role and text now keeps every field. On main since 2026-11-02, checked by tests.
- **New, RisuTanium only:** Lua `getFullChat`, `getChat` and `getRecentChats` now return each message's read-only `chatId` (present only when the message has one), and `setFullChat` matches your entries to existing messages by that id first. A message the script edited, moved or gave a new role therefore keeps its fields and its alternatives. A script cannot create ids, and scripts that never send ids behave as before. Upstream RisuAI does not have this. See [[Lua API Reference]].

### Plugins

- A plugin write to the plugin list could delete plugins; updates now keep saved settings.
- A plugin unloaded during a permission prompt no longer registers hooks afterwards.
- A V3 `addProvider` AbortSignal failed to clone ([upstream #1273](https://github.com/kwaroran/Risuai/pull/1273), reported fixed).

### Providers, streaming and memory

- Ollama showed only the last token ([upstream #1362](https://github.com/kwaroran/Risuai/pull/1362), reported fixed).
- Gemini no longer sends `role: 'function'`.
- HypaV3 re-roll Apply is re-enabled after an edit, and a HypaV3 `SystemMessageOrderError` was fixed ([upstream #1051](https://github.com/kwaroran/Risuai/issues/1051), reported fixed).
- SupaMemory, HypaV2 and HypaV3 resume points, retries and hidden-message summaries were corrected. Reset SupaMemory data now asks first.
- Hugging Face speech was repaired, and Stop now covers all text-to-speech voices.
- With auto-translate on, text-to-speech now speaks the language you see instead of the original ([upstream #200](https://github.com/kwaroran/Risuai/issues/200)). Auto speech translates the whole reply in one translator request per spoken run (each continue part pays one request), then speaks it. The speaker button speaks the translation already shown in the bubble and makes no request. If the translation fails, the original text is spoken; translator error replies and AI-translator request failures show an alert as the translator does elsewhere. Stopping the reply, deleting the chat or deleting the reply ends the wait without speaking. Checked by tests with a mocked translator; the live check of one request per reply was not run.
- With auto-translate on, the reply that is still streaming shows its raw text and is translated once when the stream ends, instead of being translated again and again while it streams ([upstream #1426](https://github.com/kwaroran/Risuai/issues/1426), [#1495](https://github.com/kwaroran/Risuai/pull/1495)). Only the chat list decides this; messages shown elsewhere (bookmarks and other views) behave as before. With auto-translate off nothing changes. Checked by tests.
- A reply with several `<Thoughts>` blocks, as the Gemini streaming tool loop writes, kept only the text after the last block. The pattern is no longer greedy where messages are assembled and in the chat parser (which also feeds the translator and memory summaries) ([upstream #1327](https://github.com/kwaroran/Risuai/issues/1327)). A diagnostic test reproduced the loss with the real tool-loop output before the fix; it is kept as a guard.
- Streamed Anthropic and Gemini replies could save broken text. A character split across two network chunks, such as Korean text or an emoji, turned into a replacement character (`�`) and stayed in the saved chat. Each stream is now decoded as one continuous stream. Upstream: [issue #1647](https://github.com/kwaroran/Risuai/issues/1647), [PR #1658](https://github.com/kwaroran/Risuai/pull/1658); Gemini had the same problem with no upstream number. On main since 2026-11-02, checked by tests that split a 3-byte character and an emoji across chunks; not tried against a live provider here.
- Local Ollama replies had the same split-character problem, inside the Ollama library's own stream reader. The local request is now wrapped so a Korean character or an emoji is never cut between chunks. The Ollama cloud path is unchanged and has no test of its own. On main since 2026-11-02, checked by tests; not tried against a live Ollama server here.
- Tauri timeouts: reported fixed for [upstream #1689](https://github.com/kwaroran/Risuai/issues/1689) and [#1694](https://github.com/kwaroran/Risuai/pull/1694); the Rust side was not re-read.

### Found fixed in the review of old upstream issues (#1 to #702)

A review of upstream issues and unmerged pull requests numbered #1 to #702 checked whether each reported problem still applies here. These came back as already fixed, by reading the code only (nothing was run):

- Trigger scripts were left out of an exported character card ([upstream #248](https://github.com/kwaroran/Risuai/issues/248), reported fixed).
- Loading a local backup decoded and re-stored data wrongly ([upstream #475](https://github.com/kwaroran/Risuai/issues/475), reported fixed because the restore code was rewritten).
- A save error "body stream already read" ([upstream #658](https://github.com/kwaroran/Risuai/issues/658), reported fixed).
- Deleting the first preset overwrote the shifted one ([upstream #184](https://github.com/kwaroran/Risuai/issues/184), reported fixed).
- A regex script with a missing flag threw an error ([upstream #205](https://github.com/kwaroran/Risuai/issues/205), reported fixed; a missing input or output pattern was not checked).
- In group chats, `{{char}}` showed the room name ([upstream #190](https://github.com/kwaroran/Risuai/issues/190), reported fixed; callers were assumed to pass the speaking character).
- Kobold requests left out `max_length` ([upstream #175](https://github.com/kwaroran/Risuai/issues/175), reported fixed).

Two reports did not hold in this fork: that backup data is sent to the upstream hub for a validity check ([#698](https://github.com/kwaroran/Risuai/issues/698); the backup code makes no network calls), and that one API key is sent to another model's proxy ([#185](https://github.com/kwaroran/Risuai/issues/185); keys are kept per provider). See "Where your API key goes on a web build" above for the web-build proxy.

### Android and desktop

- A boot hang on Android is fixed, and file pickers settle on cancel.
- A reply finishing while the app is hidden is received, and its notification clears.
- Android exports and previews read assets in bounded pieces rather than whole files.
- Tauri `install_python` no longer panics on failure and reports pip errors honestly.

### Interface

- Dialogs no longer let keys or focus reach the page behind them.
- Optional checkboxes missing from a settings page no longer write `false` on mount.
- Card background and CSS no longer flicker while modules load the first time.
- On/off toggles are now real native checkboxes named by their label, so screen readers and the keyboard can reach them, and a focus ring shows for keyboard focus only ([upstream #209](https://github.com/kwaroran/Risuai/issues/209)). Mouse and touch rendering is meant to be unchanged. Checked by tests in a simulated browser; not tried with a real screen reader.
- On browsers without the compression streams (Safari older than 16.4 was reported), saving checked for them in a way that threw before the fallback could load. The checks now use a type test, so those browsers take the fallback ([upstream #662](https://github.com/kwaroran/Risuai/issues/662)). Checked by tests that remove the browser features; not tried on an old iPhone.
- Many hard-coded alerts were moved into language files. Much of the interface is still English-only in other locales.

## Planned, not shipped

No fix planned from the upstream-issue reviews is still waiting. Also planned, not shipped: the new interface design (a hidden colour preset is all that exists), a new long-term memory engine (research only), and a fork-to-fork backup format.

## Appendix: area to ticket IDs

For people following the project's records. IDs are the fork's own.

| Area | Tickets |
|---|---|
| Save engine, storage | CHORE-01, 46, 87, 116, 117, 153, 166, 205 |
| Backup, import, export | CHORE-82, 114, 187, 188, 194, 372, 375, 393, 394, 395, 396, 397, 398, 470, 472, 473, 474, 475, 479 |
| Chat alternatives | CHORE-478 |
| Chat fixes | CHORE-41, 149, 164, 165, 167, 224, 376, 456 |
| Lua, triggers, lorebook | CHORE-09, 138, 178, 184 |
| Plugins | CHORE-17, 30, 65, 190, 206, 550, 552, 590 |
| Security | CHORE-551, 552, 554, 589 |
| Memory | CHORE-10, 501, 591 |
| Rendering, performance | CHORE-04, 45, 215, 483, 624 |
| Android, desktop | CHORE-137, 180, 181, 182, 218, 352 |
| UI, languages, naming | CHORE-05, 556, 603, 609, 616, 622, 623 |
| Upstream merges | CHORE-589, 590 |
