# Live UI checks

Use Claude Desktop's Code-tab preview first for local web UI acceptance (MC-243). Anthropic documents DOM inspection, clicks, forms, screenshots and server logs in its preview. The maintainer's `.claude/launch.json` is preserved; do not overwrite it to enable this procedure. Check actual browser tools in the controlling session before promising a check. [Desktop previews](https://code.claude.com/docs/en/desktop#preview-your-app).

The orchestrator owns the live check or names one controller with the tools actually available. Custom agent profiles do not acquire browser capabilities from a written brief. Read-only reviewers can inspect saved artifacts and source; an implementer's auto-verification does not replace the independent gate. [Gates](gates.md), [ownership](ownership.md).

## Evidence procedure

1. Name the acceptance scenario, expected visible behavior and any underlying invariant before interaction. Identify the applicable code/dirty snapshot, dependencies, launch command/configuration, browser surface, operating system and viewport. Use synthetic profiles and local fixtures; never probe external community services.
2. Start or reuse the authorized local preview, checking ownership before stopping or replacing a server. Record readiness or startup failure. Test the specified actions and relevant boundary states, including errors when they belong to the requirement. Do not widen the product scope from an unrelated preview finding.
3. Capture the relevant DOM/interaction result, screenshot and logs or errors. Record observed behavior against the expectation and name retained artifacts. A screenshot alone cannot prove persistence, native behavior or invisible data integrity; add the applicable save/reload checks and source/runtime evidence.
4. Give the independent reviewer the scenario, observed snapshot, results and relevant artifacts. Failed or unavailable checks remain explicit. Keep final reproducible evidence under the item's [curated evidence policy](records.md); do not delete the only raw copy.
5. Stop only processes created for the check and leave pre-existing sessions/configuration intact. State what remains unverified, especially phone hardware, native Tauri/Android behavior or a different browser.

For responsive checks, record both the desktop and the actual narrow viewport used; viewport emulation does not establish phone performance or native system-bar behavior. For persistence, DOM success and a mocked backend are insufficient. Use the applicable storage gates and compatibility fixtures.

## Chrome fallback

Use Claude in Chrome when the specific acceptance scenario requires Chrome behavior, an already authorized browser profile or capabilities unavailable in the Desktop preview. Record that reason and the actual extension/tool connection. Desktop preview has its own browser profile; the Chrome extension uses the Chrome profile's state. Prefer a synthetic Chrome profile for campaign checks. No additional browser plugin is required for the Desktop preview; Chrome-extension installation is conditional on needing that fallback. [Surface comparison](https://code.claude.com/docs/en/desktop#choose-between-the-browser-and-the-chrome-extension), [Chrome integration](https://code.claude.com/docs/en/chrome).

Availability is checked in the active session, not inferred from the CLI version or configuration alone. If neither surface can execute the named scenario, retain it as pending live verification and continue independent work that does not rely on its result.

## Device and PC checklist

Every PC-row or device brief carries these rules in its own text; a pointer to this page is not enough, because runners have broken rules that were only referenced. Each rule exists because a run broke it.

**Where a row runs (MC-2394).** On the PC (browser or desktop build, synthetic data) unless the behaviour is Android-specific: WebView or TalkBack, SAF and file pickers, share intents, native reply and notifications, Android lifecycle (background, kill, relaunch), low-spec phone performance. Split a mixed row into a PC leg for the logic and a phone leg for the Android part.

**Device policy.**

| Device | Use | Limits |
|---|---|---|
| Note 9 phone 1 (`29f3cde9193f7ece`) and phone 2 (`2ac80128013f7ece`) | Playground with synthetic data only (MC-1666; adbg Note 9 profile r3): full screenshots, free input, dumpsys, logcat, UI dumps, `pm clear` and app-storage edits, within the guard's danger zones | All adb still through adbg; synthetic data and throwaway keys. Wi-Fi off, read back with `net-status` (`wifi_enabled=off associated=no`) at start and end; a Wi-Fi window needs a maintainer ruling for that run (asked in lane B, MC-2713); network otherwise only through `adb reverse` to own ports |
| Galaxy Tab S9 Ultra | The maintainer's personal tablet; every run is asked (MC-2776): test builds with synthetic data for tablet layouts, within its adbg restricted scope (wider classes only through a maintainer-approved scope file) | No dumpsys, unfiltered logcat, bugreport or accessibility dumps; screencaps with Do Not Disturb on, cropped before viewing, originals deleted after the crop; never capture other apps; stays out of perf batches |
| Galaxy Z Fold 7 | The maintainer's daily phone with the release MVP and live data (MC-350) | Observation only: no adb, no test builds, no test data; the maintainer answers yes/no; any screenshot the maintainer supplies hides their characters, chats and replies, and never ask for one that shows them |

Identify a device by serial and model before any command; never run a command against an unidentified serial.

**adb and tools (every device).**

- Every adb call goes through `node C:\Projects\RisuAI\Agents\Tools\device-guard\adbg.mjs --serial <S> --log <run>\adb-commands.log --own-ports <P> --own-package io.github.yor42.risutanium -- <args>` (see its README). Direct `adb.exe` is a breach. The only exception is a repository tool the brief names explicitly that calls adb itself (for example `Agents/Tools/device/sign-install.ps1`).
- `Agents/Tools/device/fixture-push.ps1` runs its adb calls through adbg and needs an explicit `-Serial`; name the briefed phone's serial, and the verifier checks `result.json` `device.serial` against it.
- No coordinate calibration taps on the home or landing page (the Discord card); check the element under a point before any exploratory tap. Measure the WebView offset before `locate-css` taps (one element's pixel row against its CSS rect times DPR) and save the note.
- **STOP rule.** If adbg reports PICK-LOCK or the picker is in an unexpected state: press Back once, confirm the app is in front, then stop the whole run and hand back. Never tap the picker by coordinates. On restricted serials and `emulator-5580` a failed locate sets an input lock (exit 92) that only a later successful locate clears. The Note 9 profile keeps no lock (`input` needs no locate), so a Note 9 brief makes the same stop itself: after a failed locate, send no input until a fresh locate or screenshot identifies the target.
- Put destructive rows (`pm clear`, deletes) in their own dispatch after a clean run.
- The guard cannot drive the Android system save or open dialog (SAF picker). A leg that needs it is NOT RUN unless the maintainer rules a route for that run; the CDP file-chooser intercept and an in-page `File` over CDP were each ruled per run, not standing policy. Rows do not promise those legs.
- TalkBack runs record `tts_default_synth`, `enabled_accessibility_services` and `accessibility_enabled` before and restore them after. Never run `uiautomator dump` with TalkBack on, with the notification shade open or while a system picker is open.
- `dumpsys` and `cmd` always name a service (`dumpsys` of our package where a package applies); never a bare call.
- `wm density reset` leaves an override of 560 on both Note 9s; restore the start state with `wm density 420`.

**Note 9 profile (r3) STOP rules.** The guard cannot enforce these, so every Note 9 brief carries them (device-guard README, Note 9 profile):

- Exit 89 means stop that line of work and report it; never retry a variant (another quoting, a variable, a glob, a script or a binary that does the same).
- Exit 97 for a globbed command name means spell the name out once. Verbs outside the r3 set (for example `devices`) and `monkey` or other `app_process` tools are not used.
- Never tap the Wi-Fi, data or Bluetooth tiles (the phone has a saved test network and would join it), open Settings > Accounts, Security, Reset, Wi-Fi, Developer options, Connections or the lock screen, place a call or send a message.
- Record `reverse --list` at the start; list every reversed port and what serves it; report any reverse the run did not create and never use it. A reversed port never serves a relaying or proxying server unless the brief declares it.
- At the end: `reverse --remove tcp:<p>` for every own port, then `reverse --list` and `net-status` again. If `net-status` ever shows Wi-Fi on or associated, run `svc wifi disable`, stop and report.

**Tab S9 and other restricted serials.** Taps only on elements located and identified in the same read (`locate-css` through the CDP DOM, then a scope-file `tap`); a refused verb (exit 95) stops that route, never a reason to improvise another. Never list a folder; touch exact file names only.

**State and data.**

- Name the expected installed build and profile; say whether `pm clear` is allowed, and if so list what it destroys and whether the next queued run on that phone must recreate state.
- Confirm, arm-delay and delete checks run on a disposable target created for the test, checked by name in the same read as the tap; never "last button" selectors.
- Synthetic profiles and throwaway keys only (save-gen fixtures). Never print or log a settings field or key-like field (the general rule is in [gates](gates.md#evidence-discipline)); write only allowlisted fields to output files.
- Call a guessed export of a production bundle once and check the result before looping. Never delete raw run files, scratch ones included; mark a bad attempt as superseded.
- Never list `/sdcard` or `/sdcard/Download` outside the Note 9 playground; touch exact file names only, through a helper that prints match or no-match.
- Use the smallest data tier that answers the question; large imports and exports run on the PC. A PC number never proves Android memory or storage limits.
- Restore and report at the end: reinstall the stock APK and read the device `base.apk` hash back; restore the original of every setting changed; read Wi-Fi and mobile data back separately at start and end; remove forwards and reverses; remove pushed files by exact name.

**Builds.** Lane B makes APK and web builds for device rows in slot A from an isolated worktree (detached HEAD, `node_modules` junction, no `pnpm install` and no builds in the shared tree or another session's worktree). A PR session requests a build with its PR number and head SHA. Every PC result states whether it ran on the dev server or a production `dist`.

**Ports and processes.**

- PR sessions name no ports; lane B assigns them, one phone agent per phone at a time, with distinct ranges for two phone agents and a range per job for PC rows.
- Each agent uses only its own port range, with a free-port check and an endpoint identity check (user agent) before connecting; report at once if a foreign endpoint was touched.
- Before relaunching device work, check that the earlier agent is really finished and has no live driver PIDs; if it is alive, message it instead.
- Record each PID in a pids file at spawn and kill only those; never kill by image name or by a shared tool name in the command line.
- Shell safety for helpers is in [ownership](ownership.md#shell-and-guard-pitfalls) (unique serial variables, absolute paths, alias-checked helper names).

**PC browser and desktop rows.**

- Drive the page only through CDP inside the agent's own spawned Chrome. File pickers go through `Page.setInterceptFileChooserDialog` or `DOM.setFileInputFiles`. No OS keyboard or mouse input (it lands on the maintainer's desktop); if a row cannot be done that way, mark it NOT RUN. OS input only with the maintainer's explicit "I'm away" for that run.
- Launch Chrome only through Node `child_process.spawn(chrome, args, {shell:false})` or `Agents/Tools/chatshell-cdp/launch-chrome.mjs`, never `Start-Process` or a command string; `about:blank` as the only start URL; read the command line back before the first navigation. The same applies to any helper: no `Start-Process` with argument arrays, working directory set to the leg folder, absolute output paths only.
- Network: `--host-resolver-rules` maps `*.risuai.xyz`, RisuRealm, `discord.com`, `*.discord.com` and `discord.gg` to `~NOTFOUND`, and maps the mock host (for example `MAP mock.test 127.0.0.1`; the web build refuses `localhost`, `127.0.0.1` and `0.0.0.0` as endpoints). Add the fail-closed belt `--proxy-server=http://127.0.0.1:9 --proxy-bypass-list=<-loopback>;mock.test;localhost;127.0.0.1`. Route the app's first-run fetches to `openrouter.ai` and `raw.githubusercontent.com` to the mock or block them.
- On a web build with a mock endpoint, turn on 직접 요청 보내기 (usePlainFetch) before any send; on Tauri and Android leave it off.
- Privacy: set Chrome's download directory to scratch before any download; never list user folders (Downloads, Documents, Desktop) and check one exact path with `Test-Path`; on desktop builds read only named UIA elements (the filename box, Save, Cancel with AutomationId 2), never a tree dump. Verifier briefs carry the same rule.

**Network blocks.** Confirm the interceptor is attached by a read-back first. Prove a block only against non-existent synthetic hosts that match the pattern (for example `x.risuai.xyz.invalid`) or with Wi-Fi off. An unconfirmed interceptor is a stop. Never fetch a real forbidden host. A block set on the page session does not cover iframes or workers, which make their own requests: attach to every target (`Target.setAutoAttach` with `flatten`) and set the block on each attached session, then read it back on the iframe target before a step that can reach a forbidden host. A flow that embeds a forbidden site (the Realm share) runs against a `*.invalid` host where the build allows it. The fail-closed resolver and the closed proxy port stay on as a second layer, never the only one (DV-S6b-4, 2026-11-20: a page-only block missed the Realm iframe's upload; only the resolver stopped it).

**Timing and thermal A/B (MC-2308 method note).** Before every window of a thermal A/B run on a phone: screen off (KEYCODE_SLEEP) in 30 s steps; wait until the battery is at or below a fixed cap (34.0 °C was used) and the `dumpsys thermalservice` CPU zone is at or below its own fixed cap (for example 36.0 °C); wake, settle 10 s, read back the arm, run. Record host load and wait when it is more than 15 points above the median. Never keep the screen awake while cooling. A performance number names its hardware class; PC numbers are best case.

**Personal devices.** Shade crops locate our card before any image is opened; app-window frames only once the app is in front. Keep a redacted copy of an evidence frame and delete the unredacted original unviewed; never delete an evidence frame without keeping a redacted copy. Keep no other-app content. No PASS without retained evidence (else UNVERIFIED).

## Device-row template

The PR's own session writes its device rows from the actual diff and checks them against code (MC-2713). Copy this block per row:

```
Row ID:            DV-<ticket>-<n>
Gating:            gates merge | post-merge, non-gating
Platform:          PC (browser|desktop) | Note 9 phone <1|2> | Tab S9   (PC unless Android-specific, MC-2394)
Why this platform: <the Android-specific behaviour, or "logic only">
Build:             <commit>, <debug|release>, artifact hash if a phone; PC: dev server | production dist
Profile and data:  <synthetic profile name, data tier>; pm clear allowed? <no | yes: destroys ...>
Steps:             <numbered steps naming the exact control and the code path it exercises>
Expected:          <observable result per step>
Pass/fail exit:    <what ends the row as PASS, FAIL or NOT RUN>
Ceiling and time:  <data-size ceiling>, <time limit>
Rules:             live-checks.md device checklist (copy the sections this row needs into the brief)
Evidence:          <kept artifacts: screenshots, logs, adb-commands.log>
```
