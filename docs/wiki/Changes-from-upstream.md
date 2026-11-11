# What changed from upstream RisuAI

> **The authors maintain this page from the records of the project.** The records are the commit history, the roadmap, and the log of upstream merges. The page does not come from a fresh test of every item. Automated tests and reviews check most of the changes below. Many changes were not tried on a real phone or in a long real-world session. "Reported" means that a record says so, but nobody confirmed it independently. Where the records disagree or are thin, the item is left out.

> **How to read the evidence notes.** "Traced in the code" means that someone read the implementation. It does **not** mean that anyone ran the behavior. "Not run" means exactly that. A review approval is not a test run. A test run is not an Android test. An Android test on one phone is not a promise that it works on every device.

RisuTanium is a fork of RisuAI. It stays compatible with upstream. A `.bin` backup moves in both directions. Upstream characters, modules, presets, and plugins keep working. This page is current to **2026-11-02**. The fork merged upstream RisuAI **v2026.10.292** (upstream commit `ea61945f9`, 2026-10-30). A fetch on 2026-11-02 showed no newer commit on upstream `main`.

RisuTanium has **not had a public release**. This page describes what the code on the main branch of the fork does. A release-signed Android build exists only on the own phone of the maintainer. Items marked "on main" are in the code. But the records do not call all of them finished.

To move your data, start with [[Migrating from upstream]].

## What is the same

- **Backups work in both directions.** A `.bin` from upstream always imports here. A `.bin` made here imports into upstream. Something in your library can be too large for upstream to hold, or can have no upstream equivalent. Then the export warns you first, names the item, and waits for your confirmation before it starts. If you cancel, the export writes nothing.
- **Your upstream content keeps working:** characters, modules, presets, plugins (see the V2.1 note below), and the integrations that upstream supports.
- **One exception:** Upstream encrypts full backups that you save on `risuai.xyz`, and only that site can read them. RisuTanium refuses them and imports nothing. See [[Migrating from upstream]] for this, for the routes out, and for the services that the fork removed.
- **Names:** The app shows the product as "RisuTanium". Upstream is "RisuAI". See "Name and version" below for the other differences in naming.

## Name and version

The fork has its own name and its own app-data folder, so it does not overwrite your upstream installation.

- The product name is Risutanium.
- The identifier of the desktop app is `io.github.yor42.risutanium`. The app data folder is new on purpose.
- The version follows SemVer and starts at `0.1.0`. The upstream version that this fork is based on is a suffix. For example, the Version line on the home screen shows `0.1.0-up2026.10.294`.
- The desktop app registers two deep-link schemes: `risutaniumlocal` and `risuailocal`. The second scheme stays so that the open-in-app links from upstream Realm still reach the app.
- The in-app updater is off until the first release.
- The CBS version tags report the version of this fork. `{{version}}` returns `0.1.0` and `{{majorversion}}` returns `0`. An upstream card that compares them with a 2026 version behaves differently.

## Where your API key goes on a web build

This applies to a static web build of RisuTanium. It does not apply to the desktop app, to Android, or to the Node server. On the static web build, requests to AI providers go through the proxy of upstream RisuAI at `sv.risuai.xyz` (`/proxy2`). This is the same as the own hosted build of upstream. Requests to localhost addresses are the exception, which a web build refuses anyway. Your API key travels with the request, so it passes through the server of upstream. The desktop app and Android send requests directly from the device. The Node server uses its own `/proxy2`. On 2026-11-02, the maintainer decided to document this and to change nothing. The code has a plain-fetch setting that skips the proxy. The authors found no toggle for it in the settings screens (they did not check this fully).

## Rewritten systems

### Saving and storage

Upstream keeps your library as one large saved database. RisuTanium writes it as many small pieces (characters, chats, modules, assets). It keeps most characters as lightweight placeholders until you open them. This matters for big libraries. For those, one huge file used to be slow, hungry for memory, and risky.

What you see:

- A recovery screen at startup if a save is damaged, and a list of earlier saved versions to restore from ("Load Internal Backup").
- A visible indicator when a browser tab has stopped saving. A message names exactly which items the app could not save. Before, the loss was silent.
- Older saves convert automatically. The app refuses a malformed older save, or offers it without the broken parts. It does not crash.
- Web, desktop, and Node server all share one storage contract. The OPFS switch is gone. At startup, the app copies an OPFS profile back into the IndexedDB of the browser. The desktop app replaces save files through a temporary file. So a crash in the middle of a save does not leave a half-written file.
- The Node server checks revisions before it writes. So two clients cannot silently overwrite each other.
- Saving yields to the interface during long saves. On Android, a hidden page keeps saving.

Limits: A tab that stops saving is still "parked" until you act on it. The records say that the design for several tabs is still under review. [[Settings Backup and Files]] covers the backup screens.

### Storage format

- The first start of this build converts your existing save to a new storage format.
- If the save is damaged or unreadable, the app shows a recovery screen with choices.
- If you import a `.bin` at startup or from Settings, the app shows notices before it reloads.
- The app deletes the old-format files by itself. This happens at the start after the conversion, after the app is quiet. The app is quiet when it is hidden after a save, or when it gets no input for about 30 seconds. The app shows nothing while it deletes.
- A normal page has no button for manual clean-up. There is no way yet to clear out unused data or assets by hand. The old "Clean Unused Archived Data and Assets" button stays only on pages that fall back to the older storage.
- The authors traced this in the code. They did not run it.

### Saving across tabs and devices

Two tabs that disagree about which save is newest must not settle it by silently deleting your work.

- A self-hosted Node server refuses a save from a stale tab. It does not overwrite newer data.
- If another tab or device saves first, the tab that fell behind stops saving and asks what to do.
- If the tab holds no unsaved edits, it offers Reload or Keep reading. It never reloads by itself.
- If the tab holds unsaved edits, it offers Reload, which loses the edits. Sometimes it also offers Save mine, which replaces the other change with the version of this tab.
- The app does not offer Save mine in three cases: you use the Node server, the profile was replaced, or the tab holds characters that are not loaded yet. In these cases, Reload is the only choice.
- On the Node server, a tab that holds unsaved edits can also choose "Export this tab first, then reload". After you confirm, the app writes a `.bin` of this tab and reloads once. The app does not offer this choice after the profile was replaced.
- The authors traced this in the code. They did not run it against a real server.

### Characters load when you open them

Opening one character should not need the whole collection in memory.

- The app no longer archives characters automatically after 10 days.
- At startup, the app leaves characters as small stubs. It loads a character at the time that you open it. Nothing is deleted.
- Characters with a missing, hidden or duplicated id are the exception. The app loads them at startup.
- After you move to another character, the loaded character goes back to its stub if you did not edit it. A large character waits for a quiet moment. This does not happen while a plugin that needs every character is on.
- This behavior is on by default. The app tells you once when it turns on.
- To turn it off, go to Settings > Advanced Settings > "Archive characters at startup". On the next start, every character loads in full.

### Replies that stream while the app is hidden

- If you hide the app or the page during a reply, the app saves the text so far.
- When the chat reloads in that state, the message shows "Interrupted — the reply may be incomplete".
- A reply that finishes while the app is hidden shows no note.
- The save is best effort. If the system kills the app right away, the save can fail to finish.
- The authors traced the save-on-hide trigger in the code. The device behavior comes from the commit message.

### Backups and large files

- The `.bin` export streams. It does not build one giant file in memory. The restore and the CharX import also stream. Browser assets can be as large as 1 GiB where the store streams.
- The app refuses a cut-short backup before it writes anything. The app refuses a restore while another import, export, or save runs, or while other tabs are open.
- Backups carry every piece that they reference, all plugin storage, and inlays. The names of local backup files include the date of the export.
- You can cancel an export on the web. You can cancel large CharX exports.
- A faster backup format from fork to fork is only a design. It is not shipped.

### Accounts and backup compatibility

Some upstream services are not part of this fork. Read the migration notes before you rely on them.

- This fork has no RisuAccount and no Google Drive backup. The app removed account sign-in, sync and Drive backup. To move data, make a local `.bin` backup.
- RisuRealm still works. The first time that you use it, the app asks you to accept the Terms of Service and the Privacy Policy of upstream.
- This fork cannot read a `.bin` that was made while signed in to RisuAccount on `risuai.xyz`.
- Local backups include every asset, not only `.png` files. The assets include audio, video, WebP, JPEG, font and CSS files.
- Full `.bin` backups also include the inlay images, video and audio in chat messages. Partial backups do not include them.
- `.bin` backups stay compatible with upstream. The authors loaded hand-made upstream backups here, exported them again and loaded them in upstream. After they decoded the files, all characters, chats and messages were there. Only the flag for a reply that is still streaming differs, on purpose.
- That test used single runs on one PC with synthetic files. The authors did not open every character in the interface of upstream.
- The app reads the newer plugin-index format of upstream and converts it. The app keeps the key-value data of upstream. If a backup has this data, the app writes it back in the upstream format. Otherwise it writes nothing. The values keep their content but not their key order. The authors tested this with hand-made files only, because upstream does not write this data yet.
- On the Node server, a restore skips a backup asset of about 101 MiB or more. The app first shows a warning that names the asset and asks you to confirm.

### Restoring a backup

- On the web build, Load Backup Locally and Load Internal Backup refuse to run while another tab of the app is open. If the browser cannot make sure that no other tab is open, the app warns you.
- Both actions also refuse to run while the app writes a reply into a chat.
- Load Internal Backup is a picker of restore points.
- When you load a `.bin` from Settings, the app keeps your earlier data as an earlier saved version.

### Large items in a backup

The file format has limits.

- A backup entry cannot hold an item of 4 GiB or more. The app names each such item before it writes a `.bin`. It then asks if it must create the backup without them. If you cancel, the app writes nothing. The final summary repeats the names.
- The check covers character data. It covers assets only where the app can list file sizes, which is the desktop app. On other platforms, the backup stops with a message when the app reaches an asset that large.
- The authors traced this in the code. They did not run it against a real backup.

### Exports of characters that are not loaded

- A `.bin` made here writes each character that is not loaded as a small stub. The `.bin` also has a separate entry for the chats of that character. The app does not load the character first.
- The app still writes the whole character in two cases: the character is in the trash, or its chats name cold-storage data. Cold-storage data is a pointer, an error-text key or archived chats.
- The authors tested this with 500 synthetic characters on one fast PC, with three runs each. The peak JavaScript heap of the export fell from about 202 MiB to 145 MiB. The file grew from about 43 MB to 94 MB, because the chat entries are not compressed.
- Upstream opened and re-exported a file in stub form in a single run with synthetic files. The authors did not measure anything on a phone.

### Card and module imports

- If a `.charx`, PNG or module (`.risum`) file is cut short, the app refuses it with a message. The app does not import the card or the module, and it saves nothing.
- The check looks at the structure of the file. A file with damage inside can still fail partway. Then the assets that the app already saved stay unused.
- A cut-short `.jpg` card looks the same as a plain image, so the app cannot find it.
- The authors traced this in the code. They did not run it on real files.

### Chat alternatives (rerolls and candidate replies)

The app keeps alternatives as sibling branches in a tree. The chat screen shows a counter and buttons for previous and next. Each branch keeps its own memory and script state. SillyTavern swipes import into the tree. A `.bin` that you make for upstream leaves the alternatives out, after it names them. The records list this as on main, with some device checks still owed.

### Chats stay separate

A send, its scripts, Lua triggers, lorebook, prompt, persona, summaries, tools, and `/` commands now read and write the chat in which they started. They do not use the chat to which you switched in the meantime. One generation runs at a time for each send. The composer remembers the unsent text of each chat.

A message should stay in the chat where it began. An operation should stop when its target gets deleted.

- The app writes a reply into the chat that the message came from. This includes the memory summaries and the variable writes that come with the reply. It does this even if you switch chats, add a branch or reorder chats while the reply generates.
- If you delete a chat while something still writes into it, the app warns you. The app deletes the chat that you confirmed, even if the list changed in the meantime.
- Escape does nothing on a confirm prompt or an input prompt that waits for an answer. Before, Escape answered the prompt with an empty answer. Escape still closes information alerts.

### Modules

Modules that no character uses load as lightweight stubs. The app reads them only when a chat, export, or screen needs them. With 100 or more modules, this lowers memory use and speeds up the boot. Features that need modules wait for the modules of the chat. These features are the translator, suggestions, HypaV3, and subtitles. A synthetic test with 169 modules on a phone passed on a small number of runs. The records do not call it complete.

### Plugins

- The fork retired the execution of V2.1 plugins. Existing V2.1 plugin entries stay untouched in your database and `.bin`. V3 plugins are not affected.
- V3 permission choices have the scope of script and permission. A plugin needs the `db` permission for the APIs of characters, chats, and the database. It cannot read the saved arguments of another plugin. Plugin network requests go through a policy for destinations.
- New: You can export the script of a plugin as `.js`. You can import several plugin or module files at once.
- Merged from upstream: The app now unloads all V3 plugins on a reload. Before, about half stayed running with stale scripts.

### Speed and rendering

- The character list and the Grid view show only what is near the screen. Avatars load as they come into view.
- A return from Settings no longer rebuilds the chat two times. The fork replaced a page poll of 100 ms with event handling. Rerolls copy only new messages. The trimming of context counts tokens only as far as needed.
- If you toggle a module that changes nothing visible, the chat no longer rebuilds.

These are descriptive measurements on specific machines. They are not a promise of a frame rate on every device.

### Security

- The Node server needs a password, with rules for tokens and request sizes. Desktop and Android check native network destinations and trim permissions. They ask before they install Python or start the stdio command of a module.
- Imported presets cannot redirect stored API keys. The fork closed several unsafe HTML sinks.

### Android

The fork has an Android build. A foreground service keeps work alive and shows a "Generating a reply..." notification with Stop. The app saves a reply that finishes while the app is hidden. Other apps can open cards, modules, presets, and `.bin` files in it. Only the own phone of the maintainer has a signed build. There is no public Android release.

## New features

- **Import:** Backyard `.byaf` characters, YAML cards, and chats from SillyTavern `.jsonl`, Chub, Ooba, Agnai, Kobold Lite, and Character.AI (tested on synthetic files only). SillyTavern lorebooks keep secondary keys, disabled entries, probability, position, and depth. SillyTavern presets import in Settings and in the Playground.
- **Characters and lists:** Grid follows the order of the sidebar. It has folders, bulk edit, drag and merge, sorting, and a search over descriptions, tags, and creator. An "Empty trash" button. "Copy as card" in the message menu.
- **Keys and models:** `${NAME}` references to environment variables for keys (see [[API Keys from Environment Variables]]). A button to refresh model data. Context and pricing from OpenRouter. Deprecated models are tagged. Claude 5 Opus with adaptive thinking.
- **Languages:** Spanish and Japanese. A machine drafted the Japanese, and no native speaker reviewed it.
- **Utility mode:** A first slice (task presets and a run screen), shown on desktop only. It is early.

### Model list

Model catalogs change, so the app does not rely on fixed assumptions about them.

- The app downloads model data, for example the context size, from the public LiteLLM dataset and from provider lists. The app caches the data.
- The bot settings show a status line and a "Refresh model data" button.
- The model picker does not offer retired models. A model that you already use gets a tag: "retired", "now uses ..." or "retires" with a date.
- The authors did not run the download here.

### Character list

- Search covers the name, the shown description, the tags and the creator. It also covers characters that are not loaded. Tags and creator work for single characters, not for groups.
- The Grid tab sorts by My order, Recent or Name.
- Under My order, the Grid tab shows folders as tiles. It remembers the open folders on this device.
- Edit mode can move several characters to the trash at once. It can also group them into a new folder.
- The trash keeps a character for 30 days. Upstream keeps it for 3 days. The app deletes it for good on the first start after that time. If you open the same data in upstream or in an older build, that build still deletes it after 3 days.
- Long descriptions have a "Show more" link.
- The authors traced this in the code and in the language strings. They did not run it.

## Removed or changed features

For details and routes, see [[Migrating from upstream]].

| Gone | Notes |
|---|---|
| RisuAccount sign-in, sync, hub, and Kei | RisuRealm stays. Local `.bin` is the only restore. |
| Google Drive backup | Local `.bin` only |
| Multiuser chat | The fork keeps `Message.name`. |
| Execution of V2.1 plugins | The data stays. Nothing runs. |
| The settings pages Global Lorebook and Global Regex | The pages are retired. |
| Picture-in-picture keep-alive | A stored `pip` setting reads as `off`. |
| OPFS storage switch | See Saving and storage. |
| Desktop auto-updater | Off until the fork has its own releases. |

## Bugs fixed

Links to upstream appear only where the records name one. The fixes are on main. Tests verify most of them. Most were not verified on a device.

### Saving and data safety

- Edits to a character that you had not selected were not saved.
- Two characters that shared one id could lose a saved block. The app now keeps both and says so.
- The app could write an unloadable character list. Saving now pauses and names what it cannot save.
- The app keeps edits that you make while the first save is still encoding.
- A save with an oversize body, or a full disk, now stops with a clear message. Before, it retried forever. This follows the change of upstream for Node write errors.
- When a page hides or closes, it now saves pending edits. Finished replies save while the page is hidden.
- An automatic reload between tabs no longer destroys local drafts. A cancelled reload no longer stops saving.
- The app silently discarded the renames and images of presets. This is fixed. A corruption prompt could wipe a lorebook. This is fixed.
- A save or a switch with a preset id that is out of range no longer throws. The app keeps the working settings as a new "New Preset". Applying a loadout no longer adds an empty entry ([upstream #1387](https://github.com/kwaroran/Risuai/pull/1387), the small remaining gaps after the fix of the reported scenario). Tests check this.
- A read failure in older archive storage never overwrites or deletes data.
- A stuck module no longer blocks the saves of characters and chats.
- The Node server now saves its password before it accepts it.
- On Android, a card that you opened during a restore could be lost, and a second `.bin` was dropped. This is fixed.
- The app repairs an empty or missing selection of the persona at load. The record calls this "upstream-latent".

### Backup, import, and export

- A restore no longer runs while other work writes or other tabs are open.
- A local backup now includes assets that are not `.png` ([upstream #1582](https://github.com/kwaroran/Risuai/pull/1582), reported fixed).
- CharX files with bytes of the zip signature inside assets import whole ([upstream #1217](https://github.com/kwaroran/Risuai/pull/1217), reported fixed).
- "Save Backup Locally" no longer fails on a null `byteLength` ([upstream #1013](https://github.com/kwaroran/Risuai/issues/1013), reported fixed).
- A failed module export or Realm share no longer reports success or posts a partial card.
- The app refuses cut-short or damaged CharX and PNG files before it saves anything.
- A multi-file import tries every file and lists the failures.
- The app refuses malformed or nameless cards with a message before it saves.
- The import of chats now works for characters that someone saved before chat folders existed ([upstream #994](https://github.com/kwaroran/Risuai/pull/994), reported fixed).
- A character whose id collides with an upstream data block gets a new id.
- On the web build, the notices after an export, a backup, the export of settings for a bug report, and the export of the translation cache now say that the download started. They no longer say that the file was saved, because the browser can still ask whether to keep the file ([upstream #843](https://github.com/kwaroran/Risuai/issues/843), reported on Firefox on iOS. Nobody tried iOS here). The desktop and Android apps keep the wording "saved". Tests check this. The wording of the notice for the translation JSON is English only.

### Chat

- Delete removed the wrong message in some cases. It now removes the message you clicked, with the choice "only this one" or "this and everything after".
- Switching chats kept the messages of the previous chat. This is fixed. Each chat keeps its own history of rerolls.
- A chat could splice into the wrong chat at index -1 ([upstream #1352](https://github.com/kwaroran/Risuai/pull/1352), reported fixed).
- A chat whose alternate first message no longer exists uses the default instead of failing. The same applies to a missing list of alternate first messages ([upstream #1353](https://github.com/kwaroran/Risuai/pull/1353), reported fixed, with two unguarded reads of low risk remaining).
- A message that fails to display shows its text and keeps Edit.
- A Stop before the first byte is silent. A Stop cancels a native stream.
- Back closes dialogs, settings, and panels on mobile.
- Runs of prompt templates now send the start text and the history-end text of triggers.

### Lua, triggers, and lorebook

- Lua loads from the app instead of `unpkg.com`, so Lua works offline.
- Each trigger write applies to its own chat. Nested trigger runs have a cap.
- Regex lorebook keys such as `/dragon/i` now activate ([upstream #1532](https://github.com/kwaroran/Risuai/pull/1532), merged from upstream). Invalid regex keys match nothing.
- A lorebook scan depth beyond the chat length scans every message. The record notes that upstream does this too.
- A lorebook entry that Lua wrote no longer disappears in onStart or onOutput ([upstream #1041](https://github.com/kwaroran/Risuai/issues/1041), [#1042](https://github.com/kwaroran/Risuai/pull/1042), reported fixed).
- Full Word Matching missed a key that punctuation, quotes, a line break, full-width punctuation, or markup such as `*Alice*` followed or preceded ([upstream #340](https://github.com/kwaroran/Risuai/issues/340)). A key now matches in those cases. A key with spaces matches as a whole phrase. Korean, Japanese, and Chinese letters still count as word letters, so matching inside a word of those scripts is unchanged. An empty key never matches in this mode. Tests check this.
- **New, RisuTanium only: "SillyTavern-style Word Boundaries".** This is an option for each lorebook, next to Full Word Matching. It is off by default. When it is on, only English letters, digits, and `_` count as word letters. So a key can match inside a longer word in another language, for example a key inside a Korean word. Module lorebook entries follow the option of the character. Modules have no setting of their own. The app saves the option in `.bin` backups. The app writes it into a character card (as the `risu_fullWordAsciiBoundary` extension) only when it is on. A card that has it turns the option on when you import the card. Upstream has no such option. Two paths can still leave a stale copy of the extension in the stored extensions of a card. An upstream card export would then write it. The first path is to switch a lorebook to global settings and back. The second path is to import a card that lacks the scan fields. The authors traced this in the code. They did not run it.
- Deleting a lorebook folder now removes everything inside it, including nested folders. Before, the contents stayed stored and were exported ([upstream #1667](https://github.com/kwaroran/Risuai/pull/1667)). Drag and drop is available only while no entry is open in that list. A deletion of a folder in a list that is not the own list of the character is not written back. Tests check this.

- Lua `setFullChat` dropped message details (generation info, prompt info, speaker, name, and the flags for disabled and comment), even on messages that the script had not changed. Upstream: [issue #1564](https://github.com/kwaroran/Risuai/issues/1564), [PR #1611](https://github.com/kwaroran/Risuai/pull/1611). A message with the same position, role, and text now keeps every field. On main since 2026-11-02. Tests check this.
- **New, RisuTanium only:** Lua `getFullChat`, `getChat`, and `getRecentChats` now return the read-only `chatId` of each message (present only when the message has one). `setFullChat` matches your entries to existing messages by that id first. So a message that the script edited, moved, or gave a new role keeps its fields and its alternatives. A script cannot create ids. Scripts that never send ids behave as before. Upstream RisuAI does not have this. See [[Lua API Reference]].

### Plugins

- A plugin write to the plugin list could delete plugins. Updates now keep saved settings.
- A plugin that was unloaded during a permission prompt no longer registers hooks afterward.
- The AbortSignal of a V3 `addProvider` failed to clone ([upstream #1273](https://github.com/kwaroran/Risuai/pull/1273), reported fixed).

### Providers, streaming, and memory

- Ollama showed only the last token ([upstream #1362](https://github.com/kwaroran/Risuai/pull/1362), reported fixed).
- Gemini no longer sends `role: 'function'`.
- The Apply button of the HypaV3 re-roll is enabled again after an edit. A HypaV3 `SystemMessageOrderError` is fixed ([upstream #1051](https://github.com/kwaroran/Risuai/issues/1051), reported fixed).
- The authors corrected the resume points, retries, and summaries of hidden messages in SupaMemory, HypaV2, and HypaV3. Reset SupaMemory data now asks first.
- The authors repaired Hugging Face speech. Stop now covers all text-to-speech voices.
- With auto-translate on, text-to-speech now speaks the language you see instead of the original ([upstream #200](https://github.com/kwaroran/Risuai/issues/200)). Auto speech translates the whole reply in one translator request for each spoken run. (Each continue part pays one request.) Then it speaks the translation. The speaker button speaks the translation that the bubble already shows, and it makes no request. If the translation fails, the app speaks the original text. Translator error replies and failures of AI-translator requests show an alert, as the translator does elsewhere. If you stop the reply, delete the chat, or delete the reply, the wait ends without speech. Tests with a mocked translator check this. Nobody ran the live check of one request for each reply.
- With auto-translate on, a reply that still streams shows its raw text. The app translates it one time when the stream ends. Before, it translated the reply again and again while it streamed ([upstream #1426](https://github.com/kwaroran/Risuai/issues/1426), [#1495](https://github.com/kwaroran/Risuai/pull/1495)). Only the chat list decides this. Messages that other views show (bookmarks and others) behave as before. With auto-translate off, nothing changes. Tests check this.
- A reply with several `<Thoughts>` blocks, as the Gemini streaming tool loop writes it, kept only the text after the last block. The pattern is no longer greedy where the app assembles messages and in the chat parser. The chat parser also feeds the translator and the memory summaries ([upstream #1327](https://github.com/kwaroran/Risuai/issues/1327)). A diagnostic test reproduced the loss with the real output of the tool loop before the fix. The authors kept it as a guard.
- Streamed Anthropic and Gemini replies could save broken text. A character that was split across two network chunks, such as Korean text or an emoji, turned into a replacement character (`�`) and stayed in the saved chat. The app now decodes each stream as one continuous stream. Upstream: [issue #1647](https://github.com/kwaroran/Risuai/issues/1647), [PR #1658](https://github.com/kwaroran/Risuai/pull/1658). Gemini had the same problem, with no upstream number. On main since 2026-11-02. Tests that split a 3-byte character and an emoji across chunks check this. Nobody tried it against a live provider here.
- Local Ollama replies had the same problem with split characters, inside the own stream reader of the Ollama library. The app now wraps the local request. So a Korean character or an emoji is never cut between chunks. The Ollama cloud path is unchanged and has no test of its own. On main since 2026-11-02. Tests check this. Nobody tried it against a live Ollama server here.
- Tauri timeouts: Reported fixed for [upstream #1689](https://github.com/kwaroran/Risuai/issues/1689) and [#1694](https://github.com/kwaroran/Risuai/pull/1694). Nobody read the Rust side again.

### Found fixed in the review of old upstream issues (#1 to #702)

A review of upstream issues and unmerged pull requests with the numbers #1 to #702 checked whether each reported problem still applies here. These came back as already fixed. The authors only read the code. They ran nothing:

- Trigger scripts were left out of an exported character card ([upstream #248](https://github.com/kwaroran/Risuai/issues/248), reported fixed).
- The loading of a local backup decoded and stored data wrongly again ([upstream #475](https://github.com/kwaroran/Risuai/issues/475), reported fixed, because the authors rewrote the restore code).
- A save error "body stream already read" ([upstream #658](https://github.com/kwaroran/Risuai/issues/658), reported fixed).
- Deleting the first preset overwrote the preset that shifted into its place ([upstream #184](https://github.com/kwaroran/Risuai/issues/184), reported fixed).
- A regex script with a missing flag threw an error ([upstream #205](https://github.com/kwaroran/Risuai/issues/205), reported fixed. Nobody checked a missing input pattern or output pattern).
- In group chats, `{{char}}` showed the name of the room ([upstream #190](https://github.com/kwaroran/Risuai/issues/190), reported fixed. The authors assumed that callers pass the character that speaks).
- Kobold requests left out `max_length` ([upstream #175](https://github.com/kwaroran/Risuai/issues/175), reported fixed).

Two reports did not hold in this fork. The first said that the app sends backup data to the upstream hub for a validity check ([#698](https://github.com/kwaroran/Risuai/issues/698)). The backup code makes no network calls. The second said that the app sends one API key to the proxy of another model ([#185](https://github.com/kwaroran/Risuai/issues/185)). The app keeps keys for each provider. For the proxy of the web build, see "Where your API key goes on a web build" above.

### Android and desktop

- A boot hang on Android is fixed. File pickers settle when you cancel.
- The app receives a reply that finishes while the app is hidden, and its notification clears.
- Android exports and previews read assets in bounded pieces. They no longer read whole files.
- Tauri `install_python` no longer panics on failure, and it reports pip errors honestly.

### Interface

- Dialogs no longer let keys or focus reach the page behind them.
- Optional checkboxes that are missing from a settings page no longer write `false` on mount.
- Card background and CSS no longer flicker while modules load the first time.
- On/off toggles are now real native checkboxes with the name of their label. So screen readers and the keyboard can reach them. A focus ring shows only for keyboard focus ([upstream #209](https://github.com/kwaroran/Risuai/issues/209)). The rendering for mouse and touch is meant to be unchanged. Tests in a simulated browser check this. Nobody tried it with a real screen reader.
- Some browsers lack the compression streams (Safari older than 16.4 was reported). On those browsers, the check for them in the saving code threw an error before the fallback could load. The checks now use a type test, so those browsers take the fallback ([upstream #662](https://github.com/kwaroran/Risuai/issues/662)). Tests that remove the browser features check this. Nobody tried it on an old iPhone.
- The authors moved many hard-coded alerts into language files. Much of the interface is still English-only in other locales.

## Planned, not shipped

No fix that the reviews of upstream issues planned is still waiting. These are also planned but not shipped: the new design of the interface (only a hidden color preset exists), a new engine for long-term memory (research only), and a backup format from fork to fork.

## Appendix: area to ticket IDs

This appendix is for people who follow the records of the project. The IDs are the own IDs of the fork.

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
