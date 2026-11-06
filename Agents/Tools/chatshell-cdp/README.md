# chatshell-cdp - chat-shell CDP harness

Scripts that drive a desktop Chrome through the DevTools protocol (CDP) with phone emulation (360x740 CSS px, DPR 2.8125, touch) and check the chat shell's scroll behaviour. The observer-free device kit is in [device/README.md](device/README.md).

Every result from this folder is labelled "desktop-emulated, diagnostic" unless it comes from an observer-free read on a real device. Desktop Chrome with emulation is not Android WebView.

## Two classes of script

- `harness.mjs` is DIAGNOSTIC. It injects `inject.js`, a logger with a rAF chain, a ResizeObserver, listeners and accessor hooks. The hooks change what they measure: with the r20d hooks installed a load-older step read -395 px, and the observer-free read of the same step gave +272 px (MC-1091). Use it to find and describe a problem, never as acceptance.
- Acceptance uses observer-free reads: `nolog.mjs` on the PC and `device/obsfree.mjs` on a device. They issue single `Runtime.evaluate` reads (right after the write, +500 ms, +1000 ms) and, on the device, a screencast. They install no listener, no rAF chain, no ResizeObserver, no accessor hook and no wrapped API.

## Files

| File | Purpose |
|---|---|
| `lib.mjs` | CDP connection, phone/desktop emulation, input helpers, `outDir()`, `hostRules()`, `chromeArgs()`. Importing it does nothing. |
| `launch-chrome.mjs` | Starts Chrome with the host-blocking flags and writes `<out>/chrome.pid`. |
| `harness.mjs` | Diagnostic scenarios (table below). |
| `inject.js` | The in-page logger `harness.mjs` injects (`window.__h`). |
| `nolog.mjs` | Observer-free cross-check of one load-older write: `node nolog.mjs <version> <target> <label>`. |
| `netlog.mjs` | Long-running: logs every request host of the page to `<out>/hosts.log`. |
| `build.mjs`, `altfill.mjs`, `uiprobe.mjs`, `sidebarx.mjs` | Profile preparation and probes. `altfill.mjs` fills the alternate first messages and can misfill if the editor layout differs: read its printed result. |
| `mock-altmark.mjs` | `device/mock-openai.mjs` plus the ALTMARK replies (three rerolls of the marked prompt return a short, a very long and a medium-long reply). |
| `tests/lib.accept.mjs` | Accept test of the rules in this README. |
| `tests/device-kit.accept.mjs` | Accept test of the observer-free device kit in `device/` (adb and node are stand-ins). |

## Safety rules

- Start Chrome only through `launch-chrome.mjs`. It passes `--host-resolver-rules` from `lib.mjs` as one argument element: `mock.test` maps to 127.0.0.1; `*.risuai.xyz`, `risuai.xyz`, `*.risuai.net`, `risuai.net`, `discord.com`, `*.discord.com`, `discord.gg` and `*.discordapp.com` map to `~NOTFOUND`. It prints the arguments it used.
- Plain fetch (the setting 직접 요청 보내기) must be ON before any send, with the custom API at `http://mock.test:9471/v1/chat/completions`. Use throwaway keys only.
- Never tap unscripted elements on the home page (MC-1092): a stray tap once opened the community links.
- Diagnostic runs keep `netlog.mjs` attached for the whole session. Report any host other than 127.0.0.1, `mock.test` or `fonts.googleapis.com`.
- Observer-free acceptance reads (`nolog.mjs`) run netlog only in a preflight on the same Chrome: open the app, send one mocked message, check `hosts.log`, stop netlog. The read itself then runs without netlog, and host blocking rests on the launch flags. Whether `Network.enable` perturbs a measurement is TODO(evidence).
- Never copy a profile into a repository. A run needs a prepared throwaway profile, passed with `--profile`: a copy of an existing one placed outside the repo, or one built by the recipe below. The empty default profile (`%TEMP%\chatshell-cdp\profile`) cannot run the scenarios.
- Outputs never go into the checkout: `outDir()` refuses an out dir, and `chromeArgs()` a profile, inside the checkout or this folder. The refusal compares paths as text, so a junction or an 8.3 short name that leads into the checkout is not seen: do not create one.
- Use distinct ports: PC CDP 9470, app 6293, mock 9471. The device kit uses 9460-9469, clear of the `device/` tools' 6330-6399. Do a free-port check and an identity check before use, and stop only your own PIDs.
- Teardown is a rule, not a script: read the PID from `<out>/chrome.pid`, check that the process name is `chrome`, and stop only that PID (`Stop-Process -Id <pid>`). Never run `taskkill /IM chrome.exe`; that kills browsers that are not yours.

## launch-chrome.mjs

`node launch-chrome.mjs [--port 9470] [--profile <dir>] [--out <dir>]`. Chrome is `CHROME_PATH` or an installed Chrome.

| Exit | Meaning |
|---|---|
| 0 | Started; the spawned child is alive and its `/json/version` answers; `chrome.pid` written |
| 2 | Bad argument, or the out dir or profile is inside the checkout |
| 3 | The port is already in use (it answers `/json/version`, or cannot be bound) |
| 4 | No Chrome found; a `CHROME_PATH` that does not exist never falls back |
| 5 | The spawned child exited or never answered within 15 s: the port is not ours |

## Setup

- Export the app with `git archive` into a folder outside the repository. Do not run `pnpm install` and do not write `.vite` through a `node_modules` junction.
- Serve the export with vite using a harness-local `cacheDir` through a small `--config` file that merges the project config with `cacheDir` under the OS temp dir. The exact recipe is TODO(evidence): it has not been rebuilt from scratch.
- Serve the app on 6293 and the mock on 9471, then `launch-chrome.mjs`, then `netlog.mjs` for diagnostic runs.
- Fixture profile (TODO(evidence), not rebuilt from scratch): a profile with the chat shell enabled, a default character whose chat has the expected mounted rows (row 49 has three alternatives; the ALTMARK prompt builds them), and the character `H15 Alt Greetings` with a first message plus three alternates. Build it with `build.mjs`, `altfill.mjs` and `mock-altmark.mjs`; the expected rows are 49 and 9.
- Coordinates in `openChat` (taps at 22,34 / 40,275 / 40,slot / 350,300) and the Korean labels are fixture-profile bound. The UI must be Korean.

## Running

```
node harness.mjs --scenario H7 --out <dir>
node nolog.mjs <version> <target> <label>
```

One loop over scenarios (run it from this folder; the out dir defaults to a folder under the OS temp dir):

```
foreach ($s in 'H7','H13') { node harness.mjs --scenario $s }
```

`harness.mjs` exits 2 before connecting on an unknown scenario or an out dir inside the checkout; exit 1 means an assertion failed or the run errored.

Environment variables: `HARNESS_OUT` (out dir), `HARNESS_CDP` (CDP port, default 9470), `HARNESS_APP` (app URL, default `http://127.0.0.1:6293/`), `HARNESS_BASE` (label of the build under test), `HARNESS_ROW` (stepped row, default 49), `HARNESS_MIDROW` (H15b, default 13), `HARNESS_SWIPE` (`left` or `right`), `HARNESS_ALTFIRST=next`, `HARNESS_H2HIDE` (H2 hides the header first), `CHROME_PATH`. `CHATSHELL_CDP_DIR` and `CHATSHELL_REPO_ROOT` point the tool and its tests at another copy of the tool folder or another checkout.

## Scenarios

| Id | What it asserts |
|---|---|
| H1 | Load older with the header hidden: the header stays hidden, the anchor row moves <= 2 px, the transcript top is constant |
| H2 | Pager step at the bottom with the header hidden: scrollTop equals max +-2 at every frame, no JS scroll write by the follower, the newest row stays above the composer |
| H3 | Pager step on row `HARNESS_ROW` mid-chat: its top moves <= 2 px, no older row mounts |
| H8 | The same step by horizontal swipe |
| H7 | A header toggle leaves the transcript rect unchanged |
| H12 | Rapid double pager tap (80 ms and 250 ms gaps) mid-chat: the row top moves <= 2 px |
| H13 | Hit testing of the hidden overlay header, at rest and during the hide transition; a drag starting in the header strip moves the transcript |
| H14 | ScrollToMessage lands below a shown header and at the top when hidden |
| H15 | First-message pager step with the first message partly above the viewport (character `H15 Alt Greetings`) |
| H15b | Fully loaded short chat: mid-chat step to a shorter sibling and back, then a first-message step; the first message stays the same node |
| H16 | Fling triggers a load older; desktop-emulated diagnostic of a Note 9 scenario (baseline and `overflow-anchor:none`) |
| RESET | Puts row `HARNESS_ROW` and the first message back on their first alternative; no assertions |
| T-A1 | Records raw input event sequences to `<out>/fixtures` (desktop-emulated, not Android WebView); asserts only that each recording holds events |

`--all` runs H1 H2 H3 H7 H8 H12 H13 H14. Which of these were red reproducers of a defect and which are guards is recorded in the dated r22 reports, not here (TODO(evidence)); none of them is acceptance.

## Known limits

- Desktop Chrome 156 emulation is not Android WebView; fixtures and recordings are desktop-emulated.
- `Input.synthesizeScrollGesture` produced no scroll in this headful setup; `harness.mjs` flings with a quick touch drag released with velocity.
- Coordinates, labels and row numbers are fixture-profile bound.

## Naming

Never name a file in this folder `*.test.*` or `*.spec.*`: the root `pnpm test` glob would collect it. Accept tests are `*.accept.mjs`, run with `node`:

```
node Agents/Tools/chatshell-cdp/tests/lib.accept.mjs
node Agents/Tools/chatshell-cdp/tests/device-kit.accept.mjs
```
