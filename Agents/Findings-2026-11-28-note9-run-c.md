# Note 9 run 2026-11-28c: PC rows observed, Note 9 rows not run

Date 2026-11-28. Observations only; acceptance is for the owning sessions and lane A. Refs #883, #882, #886, #859, #685, #822, #654, #823, #363, #816, #885, #303, #892, #891. Records: MC-4870, MC-4871 in `Agents/mc/note9-run-c.md`.

## Setup (applies to every PC row)

- Source: origin/main `aae85b520`. PC rows ran against the production `dist` of the release APK build from that commit (`dist` junction into the scratch build worktree), served by `server/node/server.cjs` from the main checkout on `127.0.0.1:6293` with a fresh `save` folder. The server file is the main checkout's copy, which was older than `aae85b520`; the page code is the build's.
- Chrome: started through `Agents/Tools/chatshell-cdp/launch-chrome.mjs` (CDP 9470, proxy belt, host rules). `launch-readback.json` showed `proxyServerPresent` and `hostResolverRulesPresent` true. No host block was probed from the page. Only the run's own PIDs were stopped; ports 6293 and 9470 were free afterwards.
- Viewport for phone rows: 360x740, DPR 2.6, mobile and touch emulation; input only through CDP. The desktop rows used a non-touch window (innerWidth 1249). PC numbers are best case and are not Note 9 evidence.
- Data: `c221.bin` (3,000 non-image assets, one character, synthetic) imported through the Welcome restore with the file chooser intercepted. Synthetic server password and a throwaway key only.
- Raw outputs: `%TEMP%\risu-note9-run-c\pc\out\` and `result-pc.md` (not in the repository).

## Rows

| Row | Result | Observation |
|---|---|---|
| #886 / PR #896, PC leg (A8) | OBSERVED, not reproduced | Studio > Display and assets > Assets tab, one CDP session from the tap to the sample: 11 `[data-window-key]` rows at +60 ms, +1 s and +5 s with no input; first spacer 280958 px; segment rect 16,405,323x281992. A swipe and a second open gave the same. |
| #882 / PR #893, header-covered row, PC | OBSERVED, not covered | Chat shell, Back button centre (30, 23.5): `elementsFromPoint[0]` is the SVG inside `chat-header-back`; `chat-header-host` rect 0,0,360,48, z-index 2, absolute; `[data-risu-card-background]` rect 0,0,360,740, z-index auto, absolute. |
| #882 fixture note | OBSERVED | With the old `c221.bin` (made before #893) the background text layer shows under the classic chat messages on the PC (screenshot in scratch). That is the fixture artifact MC-4760 describes; the regenerated generator output hides it. The "long messages no longer overlap" check on the Note 9 therefore needs a regenerated library, not this file. |
| #685 / PR #890, PC leg | OBSERVED | Studio character Lorebook: Import opened a chooser with `mode=selectMultiple`; two synthetic risu-format files (3 entries) added `impA1`, `impA2`, `impB1` after `g0-c31`. Export wrote `lorebook_export.json` (type `risu`, 35 entries) to a scratch download folder. A first attempt with bare-array files imported nothing; that was a wrong fixture shape on my side (`parseLorebookImport` reads `{type:'risu', data:[...]}` or `entries`), not an app observation. The tree row still read "Lorebook 32 items" after the import in one read. |
| #822 / PR #903, D-5 and the desktop half of D-4 | OBSERVED | Classic chat, desktop window: the regenerate button (`button-icon-reroll`, "New reply") computed colour `oklch(0.828 0.189 84.429)` (amber-400) at rest and with `:hover` true; size 40 x 40. |
| #892 / PR #906 (and #891), PC | OBSERVED for one page | Chat Bot > Model, GoogleAI API key field, synthetic key: before, "No key" and one empty password input; after Save, the key is in neither `documentElement.outerHTML` nor any input or textarea value; the page shows the chip `•••• wxyz` with Replace key and Remove key. Other Bots, DeepL, Playground and per-character TTS key fields not checked. |
| #654 stage D / PR #901, PC row | OBSERVED | Settings > Display & Audio: each of origin-navy, banana-cocoa, scratch-white, office-sheet applied one at a time; its radio was checked, no "was not applied" text appeared in the body, and `--nexus-canvas` changed (#21222c, #b2c7da, #fdfdfa, #f3f4f6; none: #151836). The chat shell itself was not screenshotted per pack. |

## Not run

| Row | Why |
|---|---|
| #883 / PR #895 hold on message prose (Note 9) | Needs a library on the phone; no Note 9 row ran. |
| #882 / PR #893 long messages no longer overlap on the Note 9; #886 / PR #896 Studio asset list on the Note 9 ("13 rows") | Same; needs a regenerated synthetic library on the phone. |
| #859 / PR #888 Home group Open in Studio with an archived member and with a failing member | Needs a group fixture with an archived member; none built here. |
| #685 / PR #890 Android multi-file pick and save picker | Note 9 only; no row ran. |
| #822 / PR #903 D-1 (TalkBack), D-2, D-3, D-4 phone half | Note 9 only; no row ran. |
| #654 / PR #901 one Note 9 row per built-in; #823 / PR #904 mobile row (#349) | Note 9 only; no row ran. |
| #363 N9-D2; #325 / PR #910 N9-B325 | Note 9 only; no row ran. |
| #816 N3/N4/N5/L4 and the N6 export half; #885 per-stage trace; #826; #827 | Note 9 only; the per-stage #885 trace and the #826/#827 measurements also need instrumented builds, whose existence on main I did not check. |
| #303 CPU profile | Note 9 only; no row ran. |
| #907 D-LOCK-1, D-LOCK-2; #909 preset sheet layout | Note 9 only; no row ran. D-LOCK-3 waits for #149 stage 3 (skipped on lane A's instruction). |
| #892 other key fields, #859 PC leg | Not checked. |

## Build and device provenance

- Release APK from `aae85b520`: unsigned SHA-256 `565CAC025577A42ACE5A4596026386EAFA7C3DA5869A281B9D4642D56B239D3D`; `git status` listed `AndroidManifest.xml` and `gradlew` modified by the build, and `git diff --ignore-cr-at-eol` was empty (line endings only). Signed with the persistent test key and installed on phone 1 (`29f3cde9193f7ece`), `debuggable=False`. An earlier build from `d8f812901` (SHA `5A186D04E53DA29946695AA7BE36FE0F4A81A511FD6B52163A23E5ADC3C2B626`) was superseded.
- Leases: `android-build` and `note9` taken and released; the second phone grant ended with the `end` helper (end census equal to the start baseline, `needsReset` false). Wi-Fi read `wifi_enabled=off associated=no validated=no` after the install and after the end census. No row ran on the phone, so no input, screenshot or `reverse` was used. The Fold 7 and the Tab S9 were not touched.
- Phone state left: the app installed with no data.
