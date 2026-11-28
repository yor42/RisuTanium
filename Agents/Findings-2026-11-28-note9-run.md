# Note 9 device rows, 2026-11-28, second run (observations only)

This file records what the runners observed. It does not judge acceptance; lane A and the owning sessions do that. It complements `Agents/Findings-2026-11-28-device-rows-note9.md` (merged in #880) and does not repeat it. The runners were native `sonnet-coder` subagents (G1..G5 phone, H1 PC), each report is model output naming its evidence files; numbers below are quoted from those reports. The orchestrator opened the screenshots behind the defect issues (#882, #883, #884) itself. Hardware class for every phone number: Samsung SM-N960N (Note 9), Android 10, WebView Chrome 156, not PC best case. Rows marked NOT RUN or UNVERIFIED say why. All data synthetic.

## Setup

- Phone: phone 1 `29f3cde9193f7ece` (ports 6270-6273), leased as `devrows3-n9b-1128` then `devrows3-n9c-1128` (the build slot was taken first, lock order `android-build` before `note9`). No Fold 7, no Tab S9. The first orchestrator held both phones at the start; this run queued behind it (maintainer answer) and ran only the rows #880 did not cover.
- Reset: `workflow-device-reset.mjs start` ran at lease grant; the last grant needed no reset acknowledgement (`resetRequired` false after the earlier clean release), the install still ran. `workflow-device-reset.mjs end` ended with `released`, `needsReset: false`, `removedHelpers: []`. Evidence `%TEMP%\risu-dev-2026-11-28b\reset3\` (`census-start.txt`, `census-end.txt`, `reset-end-evidence.md`); earlier cycles in `reset\`, `reset2\`.
- Build: origin/main `00a54be74`, detached scratch worktree with a `node_modules` junction and only the gitignored generated Android files (`...\generated` Kotlin dir, `proguard-tauri.pro`) copied in; `git status` showed only the known manifest/gradlew line-ending churn and `git diff --ignore-cr-at-eol` was empty before install (`build\wt-status.txt`). Release APK signed sha256 `E5727972...D1E3` (`install\signed.apk`); MEASURE APK (VITE_RISU_MEASURE=1) signed sha256 `E8FC3F1A...490D` (`install-measure\signed.apk`), used only for #224. Test key sha256 `69c387cd7c3fbc161f5551228da6049d91ef044e347c972e1a84a38b69a29aaf`. The first build attempt failed on the missing generated files; the copy above fixed it.
- Run folder: `C:\Users\yor42\AppData\Local\Temp\risu-dev-2026-11-28b\` (`G1..G5`, `H1`, each with `result.md`, `adb-commands.log`, `shots\`).
- Dispatches: G1-252, G2-861/686, G3-224, G4-816, G5-826 (phone 1), H1-819 (PC). All finished.
- Skipped by order or already covered by #880: #768, #688; #301, #479, #721, #751, #834, #681, #591, #616/#811, #598, #221, #816 N1/N2/N7 and #150 (D3 in #880 holds the save-cost numbers).

## #252 persona builder, Korean IME (G1): OBSERVED

- Real Gboard Korean 2-set keyboard reached with the globe key; Hangul typed by on-screen taps; CDP only logged key and composition events.
- Prerequisite not in the brief: Settings opens the legacy screen unless the per-device "new Settings screen (preview)" switch is on. The header person icon opens the legacy persona popup, not the builder.
- Enter handling: single-line name field, action key during composition (`isComposing=true`) did not advance (1/3, value kept); after composition ended it advanced 1/3 to 2/3. In the four multi-line textareas and the step 3 textarea, one action-key tap during composition produced composition-end plus a newline in the same gesture and never advanced.
- Layout (CSS px, DPR 2.625, viewport 411): footer buttons 60x44, header buttons 44x44; sticky footer sits above the keyboard; focused fields stay above the keyboard; `scrollWidth` 411 = `innerWidth`; no clipped text on step 2.
- Composed step 3 text: one labelled line per answer ("외모: 키 / 성격: 성 / 배경: 배 / 그"), no label for "그 밖의 내용", name not repeated, "19자". Going Back and forward with unchanged answers kept the hand-edited step 3 text and showed no replace prompt.
- Cancel: after typing, the keep/delete dialog; keep opened the persona in the editor with name and text intact; delete removed only the builder draft. Cancel untouched: no dialog, toast with undo, undo restored the persona.
- NOT RUN: the hand-edited-text prompt, the system Back key during the builder, delete through the editor's own delete button.
- Left on the profile: synthetic personas "민" and "새 페르소나"; the per-device Settings preview switch was turned back off.

## #861 long press on a code block (G2): OBSERVED, one deviation filed (#883)

Release APK of `00a54be74` (PR #866 included), user message and assistant message, same results on both.

| Hold | Result |
|---|---|
| real hold (`input swipe` 700 ms) on a fence with a language | code menu (Copy, Download); tapping Copy closed it, no sheet |
| real hold on prose | WebView native selection toolbar with the word selected; NO message sheet (3 runs on a user message, 1 on an assistant message) |
| CDP touch hold on prose | message sheet opened (CDP generates no `contextmenu` event) |
| More actions button | message sheet opened |
| real hold on a fence without a language | message sheet opened, no code menu |
| CDP touch hold on a language fence | nothing opened (plain click on the PRE) |

The behavior before #866 was not checked (no older build in the run), so the prose result may predate the PR. Filed as #883 (Refs #861). Clipboard content after Copy was not read.

## #686 and #613 phone layout, single-character chat (G2): OBSERVED

New chat screen and Studio (preview) on, character StreamCard.
- Sidebar route: sidebar bottom row Home / Settings / More; More lists Character settings, Open in Studio, Playground, Bookmarks, Branches; Open in Studio opened Studio titled "StreamCard / Character" (read-only note "Edit it in the classic editor").
- This chat sheet: Rename, Go to, Search in chat, Choose persona, Author's Note, Modules, Open in Studio, Hide names and avatars, Toggles, All settings, Export chat, Delete chat; Open in Studio opened Studio on the character.
- No separate More menu in the header (header has only Back and This chat); the "More" route is the sidebar More page.
- Group: created via Home > Add Character > Create Group Chat; it opens on the classic screen, whose sidebar Character tab has an "Open in Studio" row that opened Studio with "Group", name, members RedrawCard / StreamCard (Active), "Talk by Order". The group gap stands: no This chat / More screen was reachable, so the "no Studio entry there" half was NOT observed. Home lists the group as "Unnamed".
- Defect: the StreamCard and RedrawCard chats render their long first messages as two overlapping text layers (article heights 1357 and 3413 css px) and the chat header sometimes sat under the text; filed as #882 (Refs #438), evidence `E6\shots\a03-char4.png` and `G2\shots\f3.png`.
- Side effects: the restored `mock.bin` backup switched the UI language from Korean (browser default) to English; Settings previews turned off again at the end.

## #819 Connections check, PC (H1): OBSERVED, one defect filed (#884)

Vite dev server in Node-server dev mode (a bare Vite page refuses to boot), origin/main `00a54be74`, desktop viewport 1280x800 (not phone emulation), CDP only, host block verified.
- Add flow: Settings > Connections > Add connection > Custom endpoint; form has Name, URL, Key, Save (no model field; models are added in the detail via "Add model"). Card appeared at once.
- Shared editor: fields Model name, Model ID, Tokenizer, Format, Additional Parameters, Flags. "Picker tag" is a read-only badge "Custom" plus connection name (real picker row verified). Advanced Settings > Custom Models opens the same editor; edits made there show in the Connections detail and survive reload.
- Defect: the Advanced editor's Key/Password input shows the connection key in clear text (Connections detail shows only a last-four chip); filed as #884 (Refs #819).
- Test: GET `<url>/models` with bearer key. 200 path "Working · 1 models found · 36 ms", list card shows the result for the page session only; after a reload "Not tested". Replace key resets the status to "Not tested". Unreachable mock: "Can't reach it" in the detail and on the card; recovered after restart. 401 and 429 not exercised (mock has no such path): NOT RUN.
- Observations: closing the shell header X from a detail closes all of Settings; the connection name wraps to a second line in the narrow picker; only expected `Model data refresh failed` console errors under the host block; one "Failed to save data, retrying..." toast right after a server restart, not reproduced.
- Deviations: Node-server dev mode on port 6413 (outside the brief's 6410-6412), scratch preload `dnsmap.cjs` mapping `mock.test` to loopback (the first "Can't reach it" was a harness cause: `ENOTFOUND mock.test`), `usePlainFetch` is declared but nothing reads it so the brief's toggle did not apply, the throwaway synthetic key `sk-test-synthetic` was printed once in the runner's own output (no real secret). Not run: phone layout, Android path (plain-fetch refusal for http), production dist.

## #224 stage 4 base-content index time on the Note 9 (G3): MEASURED

MEASURE release build; the streamed import path ran in every attempt (no whole-path phases), ring read over CDP every 500 ms before the reload. Index time is `base indexed` minus `base index start`.

| Run | units indexed | bytes | index time |
|---|---|---|---|
| c301 first import (empty store) | 24 | 22,226 | 51 ms |
| c301 re-import (n=3) | 94 | 4,249,097 | 332, 270, 284 ms (median 284) |
| home500 first import (store held c301) | 94 | 4,249,097 | 244 ms |
| home500 re-import (store held 485 characters) | 4,769 | 62,302,015 | 4,598 ms (n=1) |

Stream-prepared unit counts: c301 first 94, c301 re-import 25 (all three), home500 first 4,763, home500 re-import 55. The build prints no "already present" count; the drop is consistent with dedup but not labelled. Index share of the home500 re-import phases up to commit start: 4,598 of 28,549 ms; commit and reload were not in the ring; wall time from commit start to the home screen was about 40 s on the first home500 import (approximate). `heapMiB` read 26 at every record. Battery 30.6-31.6 C, CPU zone 32-34 C at start, all within the gate. No whole-path run and n=1 for home500.
- Incident: while the first home500 import was committing, the runner's prep script sent taps at Menu/Settings/Backup/YES coordinates over the "Restoring a backup" overlay. The screenshot afterwards showed only the progress sheet and the import completed with 485 characters; no effect judged, not provable. Later runs were done on the idle home screen.
- The 485 characters remain on the phone; the measure flag was removed.

## #816 export, restore and size rows (G4): MEASURED

Picker used as ruled (screenshot viewed before each tap, no `invoke` patch, no PICK-LOCK bypass, no real keys). Profile: one character, chats of 5,000 messages (40% Korean), vectors written by the app's own hybrid index against a localhost stub; 8-chat state = 88 vector keys in 8 folders. Single runs, no thermal gating.
- N6 export half: fresh install, `list('derived/')` = `[]`; `.rtb` export 15,983 bytes with entries iris, google-search, hypa-vector, plugin-safe, plugin-safe-ls, plugin-permissions, mcp-tool-calls, ui-prefs; no `chromemory-vectors` side row, no `unreadable` string, no omission notice.
- N3 (unsealed `.rtb`, 8 chats): about 85.6 s from tap to the "backup saved" dialog; 246,883,603 bytes (235.4 MiB), sha256 `8717633ecfe1337e153353f9b803db5f2a2c38924fdc061f69e1112ac30bb989`, vectors side row present. PSS window maxima app 301,186 KiB, sandbox 1,055,112 KiB (per-sample sum 1,333,885 KiB).
- N4 (sealed with a password): about 86.8 s; 246,887,579 bytes (+3,976); starts `RTBX`; no plain entry name. PSS maxima app 290,630, sandbox 1,100,851 KiB. Sealed file not restored.
- N5 (restore the unsealed file): reload at about 184.6 s, app UI at about 187.7 s, restored chat at about 189.8 s; phases "Save current data first", "Check contents", "Copy files", "Load backup", "Restore remaining settings" (about 154 s). Read back: 1 character, 8 chats, 88 vector keys in 8 folders (same shape as before); PSS maxima app 247,086, sandbox 975,262 KiB.
- L4 `.rtb` size for one 5,000-message chat (4,802 indexed units): 601,047 bytes without vectors; 30,830,579 with 1536 dims; 60,554,771 with 3072 dims. Vector delta 6,295 B and 12,486 B per unit (raw f32 6,144 and 12,288). The no-vector size was measured once and applies to both dims; zip did not compress the vectors.
- Observations, not row results: DocumentsUI kept stale rows after removals and a same-name save landed as `local-20261128.rtb (1)`; after one deliberate picker Back the app screen stayed blank in two screenshots although CDP showed the page rendered, repainted by `am start` (not investigated, not filed); Korean keyboard turned `input text` letters into jamo; the chat send showed "Invalid URL" as in the first run (reverse-proxy settings, not investigated); a later `pm clear` wiped the Settings preview switch and the 8-chat profile.
- NOT RUN: sealed restore, second runs, thermal gating, 3072-dim export without vectors.

## #826 plugin-load share of Home boot (G5): OBSERVED, not a single number

Cold-start A/B on the release APK of `00a54be74`, fixture `lib721-noret.bin` (sha256 `82F364275F75A5C298531938B33ECBE651F461F0E195EC91583B0637E2E03B2A`), two V3 plugins (`dv721`, `ob721`). `cold-start.ps1 -Runs 5` per arm; ready = body has rendered text. Battery 32.2-32.8 C, CPU zone 33.8-35.2 C (within gates). Toggles through the app's own power buttons, read back and persisted across a restart. Plugins were left enabled as imported.

| arm | `am start -W` TotalTime median (range) ms | ready median (range) ms | settled PSS median KiB |
|---|---|---|---|
| A plugins on, first | 283 (270-298) | 3,354 (2,836-16,210) | 336,072 |
| B plugins off | 275 (231-284) | 2,975 (2,766-3,361) | 331,235 |
| A2 plugins on, repeat | 276 (250-324) | 9,308 (4,064-10,200) | 374,164 |

- Ready with plugins on is bimodal (about 2.8-5 s versus 9-16 s) and PSS rises about 40 MB in the slow runs; with plugins off it never exceeded 3.4 s. A and A2 exceeded 4 s in 7 of 10 runs; A-minus-B differs by +0.38 s (A), +6.33 s (A2), +4.16 s pooled, so the cost is a distribution on this fixture. TotalTime does not differ. Order effects (A, B, A2) and first-run state are not separated; the cause was not established; no per-plugin timing was taken (no instrumented build).
- #827 boot gain: NOT RUN (needs a throwaway instrumented build, a code change).

## #150 save cost

Not repeated; D3 in #880 holds the numbers.

## Deviations and incidents

- Lease: the build slot cannot be taken while a phone lease is held, so the first phone grant was released before the build (device untouched) and re-taken afterwards. The renewer background job hit its 30-minute limit once and the lease was renewed by hand before expiry; renewers were restarted with a longer limit.
- G3 stray taps (above). G2: UI language of the restored backup changed Korean to English. G4: picker stale index, blank frame after Back. H1: harness deviations (above).
- The first dispatch of the PC row failed registration ("Device track requires its explicit device resource"); it ran as `mode scout`, `workClass code`, no resources, as F1 did in #880.
- No input landed in another app, nothing real was touched, no key was entered, no state was hand-edited, no code was changed.

## Issues filed

- #882: long synthetic messages render as overlapping text layers (Refs #438).
- #883: a real long press on message prose opens native selection, not the message sheet (Refs #861).
- #884: the Advanced custom-model editor shows the connection key in clear text (Refs #819).
- Not filed (observations above only): the blank frame after a picker Back, "Invalid URL" on sends, the bimodal #826 ready time.
