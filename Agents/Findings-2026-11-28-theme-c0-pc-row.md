# C0 optional PC row, observed during stage H (2026-11-28)

Diagnostic, desktop Chrome via CDP, production dist of claude/theme-h-home (origin/main 43bc1499e plus stage H CSS-only edits), synthetic empty profile. Raw captures stayed in scratch (%TEMP%isu-theme-h\pcrow\out). Run by a delegated agent; the observation below is its report, not independently re-run.

**Result against the expectation (MC-4882): not met.** With builtin:banana-cocoa on, 148 custom properties differ on Home, and data-theme-pack-area and data-theme-pack-base are absent in both states (Home is shown, the pack is colour-ready only for chat). The differences are the pack scheme: the root inline --risu-theme-* block is rewritten to the pack palette and every derived property follows (--color-*, --nexus-*, --pattern-*, --home-*, --FontColor*). So Home already takes the pack palette through the scheme today; stage H aliases its roles to the scheme, so this is unchanged by H.

## Summary
- Pack ON changes many custom properties on Home: 148 differ out of 1467 (off) / 1470 (on). The brief's expectation (only shape tokens differ) is NOT what was seen.
- The root attributes data-theme-pack-area and data-theme-pack-base are absent in BOTH states on Home. Only the inline `style` attribute differs.
- The differing values are the pack's colour tokens (banana-cocoa palette) arriving through the existing theme mechanism: root inline `--risu-theme-*` values changed, and every property derived from them changed with it. The only pack-own properties are `--pack-msg-avatar`, `--pack-msg-gap` and `--pack-msg-gutter`: undefined off, empty string on.
- Only the 'chat' pack sheet (`style[data-theme-pack="chat"]`) was present in the ON state. No 'home' sheet.
- No judgement is made on whether this is correct (as asked).

## Setup (what ran)
- Build: C:\Projects\RisuAI\.claude\worktrees\theme-h-home\dist, served through a scratch junction `pcrow\dist`. dist contains the string data-theme-pack-area (surfaceGate chunk), so it is the build that has the attribute code.
- Server: `node ...\theme-h-home\server\node\server.cjs`, cwd scratch, PORT=6293 HOST=127.0.0.1, PID 43496. GET / returned 200.
- Chrome: `Agents/Tools/chatshell-cdp/launch-chrome.mjs --port 9470 --profile pcrow\profile --out pcrow\out`, launcher PID 48496, Chrome PID 55544, about:blank start. launch-readback.json: proxyServerPresent true, hostResolverRulesPresent true (command line read back via CIM before the first navigation).
- Ports 6293 and 9470 were free before start; no other chrome.exe was running.
- Fresh empty profile. The first-open prompt "Set your password" got a throwaway password `scratch-pw-1` typed through DOM events. The Welcome step was skipped through its skip button (`설정 건너뛰기`). No data, no .bin restore. All input was CDP Runtime.evaluate script clicks; no OS input and no Input.* events.
- OFF capture taken on Home (the page text contained the Home sections), pack "none".
- Pack ON: menu, then settings (aria-label 설정), then 소리 및 디스플레이, then the theme pack radio `builtin:banana-cocoa` (script `.click()`). The radio read checked, `activeThemePack` applied, and a `style[data-theme-pack="chat"]` element appeared. Settings closed through the 닫기 button. Home was visible again; ON captured.
- Capture method (cap.mjs): union of every `--*` name found in all document.styleSheets rules (15 sheets off / 16 on, 0 cross-origin blocked) plus the root inline style names, then `getComputedStyle(documentElement).getPropertyValue(name)`. A custom property that no stylesheet or inline style declares cannot appear in this list. Root attributes read from `documentElement.attributes`.

## Root attributes
OFF: lang=ko, data-layout=wide, data-input=hover, style=(inline --risu-theme-* block, bgcolor #151836 ...)
ON: lang=ko, data-layout=wide, data-input=hover, style=(same property names, bgcolor #b2c7da ...)
data-theme-pack-area: absent OFF and ON. data-theme-pack-base: absent OFF and ON.
Inline style property NAMES are identical OFF and ON; only values differ (the `--risu-theme-*` rows below). Full strings are in out\diff.txt.

## Custom property differences (148; name | off | on)
Complete list: C:\Users\yor42\AppData\Local\Temp\risu-theme-h\pcrow\out\diff.txt. Raw captures: out\cap-off.json, out\cap-on.json.
Property families, with counts, all of them differing:
- `--risu-theme-*` inline (bgcolor, darkbg, borderc, selected, draculared, textcolor, textcolor2, darkborderc, darkbutton, and role-*): 26
- `--color-*` (bgcolor, textcolor, accent tints, danger edges, nexus-*, surface-*, scheme, ...): 45
- `--nexus-*`: 19
- `--pattern-*`: 29
- `--home-*`: 16
- `--FontColor*`: 6
- other: `--alpha-switch-off`, `--danger`, `--s4-sk`, `--selection-bg`
- `--pack-msg-avatar`, `--pack-msg-gap`, `--pack-msg-gutter`: off=undefined (name not declared), on="" (declared, empty)
Representative rows:
- --risu-theme-bgcolor | #151836 | #b2c7da
- --risu-theme-textcolor | #eef0ff | #191919
- --risu-theme-role-color-scheme | dark | light
- --color-scheme | dark | light
- --home-canvas | #151836 | #b2c7da
- --home-surface | #0f112a | #dce6ee
- --home-fg | #eef0ff | #191919
- --home-accent-solid | #6f7fc8 | #6b3f18
- --nexus-canvas | #151836 | #b2c7da
- --FontColorStandard | #f8f8f2 | #0f172a
- --pack-msg-gap | undefined | ""
(Family counts are an exact by-prefix tally of diff.txt: 26+45+19+29+16+6+4+3 = 148.)

## Notes and open items
- The colour differences exist on Home although COLOUR_READY_AREAS is {chat}, because the inline `--risu-theme-*` block on the root is rewritten by the app's theme path when the pack is selected, and the derived properties follow. Source of that rewrite was not traced here (TODO(evidence)).
- Home screen state: fresh empty profile with no characters, so the Home shown is the empty-library variant.
- Not covered: shape-only tokens (none were seen differing other than the three `--pack-msg-*`); a pack whose Home sheet is ready (none, by COLOUR_READY_AREAS); computed non-custom properties.
- Proxy refusals during the run were only Chrome's own Google traffic plus openrouter.ai and raw.githubusercontent.com; no risuai.xyz, Realm or discord host appeared (out\proxy-refusals.jsonl).

## Teardown
Stopped my own PIDs only, after checking process names: Chrome 55544 (chrome), launcher 48496 (node), server 43496 (node). Afterwards all three were not running, port 6293 free, and 9470 showed only TIME_WAIT entries. No repository files written; scratch only under C:\Users\yor42\AppData\Local\Temp\risu-theme-h\pcrow (a junction `dist` remains there, pointing at the worktree dist; not removed).
