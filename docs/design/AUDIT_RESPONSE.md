# Response to the third-party UI audit (2026-10-16)

Audit: [reviews/2026-10-16-third-party-audit.md](reviews/2026-10-16-third-party-audit.md) (verbatim copy of "DEEP NEXUS UI Audit & 3-Mode Architecture Specification", supplied by the maintainer).

This file records what the design package now does about each finding, and keeps the items that need application code as implementation records for the main session. Nothing outside `docs/design/` was changed. The IDE plan (section 5) is a proposal from the audit; the 3-mode architecture (sections 3 and 4) was approved by the maintainer (below).

## Maintainer decisions (2026-10-16)

Given in the design session after the first pass of this response:

1. **`nexus` colour-scheme preset: approved**, as a preset and as the default for new installs. The ready-to-paste object is [theme/nexus-colorscheme.ts](theme/nexus-colorscheme.ts). This replaces the package's earlier rule that `colorscheme.ts` stays unchanged.
2. **3-mode architecture (audit sections 3 and 4): approved.** R-10's storage and behaviour questions remain open for the implementation design.
3. **Click wave from any primary click, including on controls: approved.** Whether reduced motion turns it off was delegated to the design session; decided **off** (see AUD-10 below).
4. **Hover spotlight: kept, smaller and fainter.** The maintainer disagreed with the audit's full removal in AUD-10. The renderer keeps the click wave as the strong signal and adds a 110 px spotlight at 35 % strength for hovering mice and pens.

## Summary

| ID | Finding | Here (design package) | Main session (needs app code) |
|---|---|---|---|
| AUD-01 | Static tokens vs user colour schemes; white mark invisible on light schemes | **Partly fixed.** Light tone for the mark (`tone` prop, `data-tone="light"`, `.nexus-mark-light`). Preset object in `theme/nexus-colorscheme.ts` (approved). | Add the `nexus` preset to `colorscheme.ts` and make it the new-install default; bind `tone` to `ColorSchemeTypeStore`. [R-01](#r-01-theme-bridge-aud-01) |
| AUD-02 | `-z-10` canvas hidden by opaque ancestors | **Fixed in the sample.** Wrapper canvas now `z-0`, stacking contract documented. | Restructure the root in `App.svelte`. [R-02](#r-02-root-stacking-aud-02) |
| AUD-03 | Legacy text class; `done` = `idle` in low-power still | **Fixed.** `text-nexus-text`; `done` has a cyan frame and a larger centre. | None beyond wiring. |
| AUD-04 | No determinate progress | **Fixed.** `progress` prop (0 to 1) draws an outer triangular ring. | Feed counts into it. [R-04](#r-04-progress-sources-aud-04) |
| AUD-05 | API key prefix hard-blocks onboarding | **Fixed in the mockup.** A different prefix is a non-blocking warm advisory. | Carry into the `WelcomeRisu` replacement. [R-05](#r-05-onboarding-key-check-aud-05) |
| AUD-06 | Boot alerts would open the modal over the boot screen | **Seam added.** `NexusBootScreen` takes an inline `notice` (`BootNotice` in `bootProgress.ts`). | Adapter in `App.svelte`. [R-06](#r-06-boot-alerts-aud-06) |
| AUD-07 | `var()` inside SVG keyframes on WebKit | **Fixed.** Per-side keyframes with precomputed offsets. | Device check still owed. [R-07](#r-07-webview-device-check-aud-07) |
| AUD-08 | `FilesSettings.svelte` unreachable | **Not reproducible in this clone** (see corrections). | Verify on the main branch. [R-08](#r-08-unreachable-settings-aud-08) |
| AUD-09 | Monaco/CBS/Lua/plugin IDE gaps | Record only. | [R-09](#r-09-ide-and-code-ergonomics-aud-09-section-5) |
| AUD-10 | Passive hover spotlight on the network | **Fixed, with a maintainer change.** Click/tap radial wave is the main response; a small, faint hover spotlight remains for mouse and pen. No links are drawn when neither is active. Both are off under reduced motion. | None beyond wiring. |
| §3–4 | 3-mode product architecture and three Home screens | Record only. **Approved by the maintainer.** | [R-10](#r-10-three-mode-architecture-sections-34) |

## Changes made in this package

| File | Change |
|---|---|
| `brand/nexus-mark.css` | Per-side keyframes (`nm-assemble-*`, `nm-clamp-*`, `nm-emit-*`, `nm-settle-*`) replace the `--nm-nx/--nm-ny` keyframes. `done` still pose: frame `#7fe9ff`, centre `scale(1.18)`. Progress ring styles. Light-tone rules in `:where()` so they win by source order; the forced-colors block stays last and now covers the `done` tint and the ring. |
| `brand/nexusMark.ts` | Progress group (`.nm-progress`, `pathLength="100"`, outside `.nm-pose`). `markSvg` options `progress` and `tone`. Helpers `progressPercent`, `progressStyle`. |
| `brand/NexusStatusMark.svelte` | `text-nexus-text` (or `text-textcolor` with `tone="light"`). New props `progress` and `tone`. Screen readers hear progress in tens; the visible label is exact. |
| `network/nexusNetwork.ts` | The 170 px hover glow is replaced by a 110 px spotlight at 35 % strength (mouse and pen only; brightens nodes without lifting them; links at most 0.125 alpha). `pointerdown` spawns a wave (360 px/s, 115 px band, 2.6 s, at most 3, or 1 in low power). Nodes lift and brighten on the crest; links are drawn only inside a ring. New `initialWave {x, y, age}` beside `initialPointer {x, y}`; new `still` option draws one deterministic frame. Reduced motion registers no listener: no wave, no spotlight. |
| `network/NexusNetworkBackground.svelte` | `z-0` instead of `-z-10`, with the stacking contract in a comment. |
| `boot/bootProgress.ts`, `boot/NexusBootScreen.svelte` | `BootNotice` type and optional `notice` prop rendering an inline card (`role="alert"` for errors, `status` otherwise). |
| `mockups/onboarding.html` | Key states `empty / standard / unusual`; only empty blocks Continue. `wave=` query parameter; `pointer=` places the spotlight. |
| `mockups/home.html` | `wave=x,y[,age]`, `pointer=x,y` and `still=1` query parameters; note text describes hover and click. Later the same day rebuilt as the 3-mode main menu ([MAIN_MENU.md](MAIN_MENU.md)); the status showcase moved to `mockups/run-status.html`. |
| `theme/nexus-colorscheme.ts` | The approved `nexus` preset, ready to paste, with contrast notes. `darkBorderc` is `#5b6396` instead of the audit's `#23274d`. |
| `mockups/status-marks.html` | Counted-progress demo (slider, simulated import, 160/32/20 px) and a light-scheme panel. |
| `mockups/*.iife.js`, `brand/svg/*` | Rebuilt with `tools/` (see README). |
| `tools/`, `svelte.config.mjs` | Design-local esbuild, TypeScript, Svelte and svelte-check. No root install. |

Documentation updated: README (integration map, rebuild steps, parameters), DESIGN_PHILOSOPHY (network, mark, low power), STATUS_INVENTORY (progress gap closed), STARTUP_AND_ONBOARDING (key check), HANDOFF.

## Network pointer behaviour (AUD-10, as decided)

- **Click wave:** any primary-button mouse click, touch or pen press inside the canvas, including on controls. A ring travels outward at 360 px/s, 115 px half-width, fading over 2.6 s; at most three at once, one in low power.
- **Hover spotlight:** mouse and pen only (touch has no hover). Radius 110 px (the audit's original was 170 px), strength 35 %: links reach at most alpha 0.125, nodes brighten by at most about 0.19 alpha and are not lifted, so it never reads as a wave. Eased position; fades when the pointer leaves the window or the window blurs.
- **Reduced motion turns both off.** Decision and reasons: the user asked for less motion and both effects are animation started by interaction, the case WCAG 2.3.3 covers; the wave is decorative and carries no information, so nothing is lost; the lattice already becomes a still frame under reduced motion, and a wave or glow moving over a frozen field would look like a glitch; and every other DEEP NEXUS motion (mark loops, entry animations, breathe) already stops under the same setting. A reduced-motion user still gets the controls' own focus and pressed states.

## Corrections to the audit

Checked against this clone's source on 2026-10-16.

- **AUD-01.** `colorscheme.ts` has **six** light presets (`light`, `monokai-light`, `sky-light`, `sage-light`, `lavender-light`, `slate-light`), not five. The app sets **no `data-theme` attribute**: `updateColorScheme()` writes `--risu-theme-*` properties on `<html>` and sets `ColorSchemeTypeStore` to `'light' | 'dark'`. The audit's `[data-theme="light"]` selector would never match, so the package uses `data-tone` / `.nexus-mark-light`, driven from that store. The proposed preset also omits the required `draculared` and `type` fields; R-01 has a complete one.
- **AUD-02.** `src/styles.css:160`, `src/App.svelte:65` (`bg-bg`), `MobileBody.svelte:36` and `Sidebar.svelte:277` (`bg-darkbg`) match. `Sidebar.svelte:66` and `:139` also paint `bg-bgcolor`.
- **AUD-08.** No `FilesSettings.svelte` exists under `src/` in this clone, and `Settings.svelte` has no `SettingsMenuIndex === 5` branch. Agents reports 10, 25 and 28 mention it, so it may live on another branch. Not verified here.
- **AUD-09.** Confirmed: `registerCBSMonaco()` has an empty body (`cbsMonaco.ts:22-24`); `<option value="cbs" disabled>` (`PopupEditor.svelte:70`); `createBlankPlugin` is imported at `PluginSettings.svelte:8` and otherwise only mocked in tests; the template anchor is appended at `:315` with no `click()` and is never removed; `SyntaxHighlightedTextarea.svelte` is 0 bytes; `luaMonaco.ts` contains none of `getChatVar`, `simpleLLM`, `alertConfirm`; `TextAreaInput.svelte:247` inserts `{{name:` without closing braces. The popup-editor hotkey (`:73`) and `oncontextmenu` (`:91`) sit before the `contenteditable` branch (`:113`), consistent with the claim, but the branch was not traced in full.
- **Section 5.2.C** says "three live root methods" and then lists four (`alert`, `alertConfirm`, `alertError`, `setChatPanel`).
- **Section 6.2** measures wave distance on screen positions. The package measures on the undisplaced lattice so the ring stays circular while the lattice breathes; the visual result is the same.
- **Proposed `nexus` preset contrast** (computed): text `#ebecff` 17.6:1 and `textcolor2` `#9ca6c9` 8.53:1 on `#00011c`; `borderc` `#38d9ff` 12.28:1; the audit's **`darkborderc` `#23274d` is 1.44:1**. The app uses `border-darkborderc` on buttons, checkboxes and number inputs (`Button.svelte`, `CheckInput.svelte`, `NumberInput.svelte`), so it needs 3:1 (WCAG 1.4.11). The package's preset uses `#5b6396`: 3.59:1 on `bgcolor`, 3.28:1 on `darkbg`, 3.03:1 on `darkbutton`; `textcolor` on it (a checked checkbox) is 4.9:1.

## Main-session implementation records

Each record names app files without editing them. Line numbers are from this clone and may drift.

### R-01 Theme bridge (AUD-01)

**Approved 2026-10-16**: add the preset and make it the default for new installs.

1. Add the object from [theme/nexus-colorscheme.ts](theme/nexus-colorscheme.ts) to `colorShemes` in `src/ts/gui/colorscheme.ts` under the key `"nexus"`. Add a label for it wherever the preset list is rendered and translated.
2. New-install default: set `colorSchemeName = 'nexus'` and `colorScheme` to a clone of the preset when a database is created (or when first-run setup completes). Do **not** change the `??= 'default'` fallback at `src/ts/storage/database.svelte.ts:405` for existing data, and do not edit `defaultColorScheme`: existing users keep their scheme, and `src/ts/gui/systemBars.test.ts` relies on `defaultColorScheme.bgcolor` as the bar fallback. Check that `customColorScheme` (`:406`) is still seeded as intended for a new install.
3. Wherever `NexusStatusMark` is mounted on a view that follows the user's scheme, pass `tone={$ColorSchemeTypeStore === 'light' ? 'light' : 'dark'}`. On always-dark Nexus screens (boot, onboarding) leave the default.
4. Legacy views (`Settings.svelte`, `CharConfig.svelte`, `DefaultChatScreen.svelte`) keep their scheme colours; the preset is what makes them match the Nexus screens.

Acceptance: a new install starts on `nexus`; an existing database keeps its scheme; switch between `nexus`, `default` and each light preset; marks stay visible (the frame is `#0f172a` on light, 17:1 on `#f8fafc`); no view mixes `#00011c` glass with `#282a36` surfaces under the `nexus` preset.

### R-02 Root stacking (AUD-02)

- Put `.nexus-canvas` on `<body>` or the app root only on screens that show the network (Home, onboarding, empty states per DESIGN_PHILOSOPHY section 6). `body` currently paints `var(--risu-theme-bgcolor)` (`src/styles.css:160`); either let `.nexus-canvas` override it on those screens or set the `nexus` preset.
- Mount `<NexusNetworkBackground />` as the first child of the root, then wrap the interactive shell in a sibling `relative z-10` container.
- Remove the stale `bg-bg` class on `<main>` (`App.svelte:65`) and keep the structural ancestors of Home transparent. Opaque `bg-bgcolor` / `bg-darkbg` on `MobileBody.svelte:36`, `Sidebar.svelte:66,139,277` must not cover Home.
- Do not mount the background behind chat or long-form editing.

Acceptance: the lattice is visible on Home at desktop and mobile widths; a click on empty Home background sends a wave; chat screens show no canvas.

### R-04 Progress sources (AUD-04)

Pass `progress={done / total}` to `NexusStatusMark` for counted work. STATUS_INVENTORY lists the existing count sources: `alertWait` / `type: 'progress'` alerts from `characterCards.ts`, `modules.ts`, `drive/backuplocal.ts`, `drive/internalBackup.ts` and the storage callers; `hypaV3ProgressStore`; archive and asset-add counts. Omit `progress` when the total is unknown (0/0), so the mark stays indeterminate. The `role="status"` text announces only tens of percent; keep the exact count in visible text. The ring is drawn only at 40 px and up (`PROGRESS_MIN_SIZE`); smaller marks show the percentage as text beside them (review F-1).

### R-05 Onboarding key check (AUD-05)

Today `src/lib/Others/WelcomeRisu.svelte:54` hard-blocks with `alertError(language.errors.invalidApiKey)` unless the key starts with `sk-`, for every provider on that step; the replacement removes that block. In it, a non-empty trimmed key always allows Continue. A prefix mismatch shows the advisory ("Standard {provider} keys start with {prefix}. Continue anyway if you use a proxy, a custom gateway or a newer key format.") in `--nexus-warm`. Prefixes: `sk-` for Claude, OpenAI and OpenRouter, `AIza` for Gemini (confirm at implementation). Advisory text needs translation keys.

### R-06 Boot alerts (AUD-06)

`App.svelte:190` renders the loading branch while `!$loadedStore`; `App.svelte:233-235` renders `<AlertComp />` whenever `$alertStore.type !== 'none'`, outside that branch. Proposed adapter:

While `!$loadedStore`, map `$alertStore` to a `BootNotice` (type and helper in `boot/bootProgress.ts`) and skip `<AlertComp />` for the mapped types. `onDismiss` sets the store to `{ type: 'none', msg: '' }`; `waitAlert()` resolves on the first `none`, so the awaiting caller resumes as it does from the modal (confirmed by the review).

| `alertStore.type` | Raised by (`src/ts/alert.ts`, boot callers) | `BootNotice` | Shown boot state |
|---|---|---|---|
| `normal` | `alertNormal`, `alertNormalWait`; `bootUi.notify`, boot and archive notices (`bootstrap.ts:390, 605, 765, 848`) | `kind: 'normal'`, `message` = `msg`, `onDismiss` | `waiting` |
| `wait2` | `alertErrorWait` (an awaited error) | `kind: 'error'`, `message` = `msg`, `onDismiss` | `waiting` |
| `error` | `alertError` (`bootstrap.ts:561, 578, 883, 888, 985`) | `kind: 'error'`, `message` = `msg`, `detail` = `submsg`, `stackTrace` = `stackTrace`, `onDismiss` | `waiting`; `failed` when boot reports it (below) |
| `wait` | `alertWait(msg, onCancel)` | `kind: 'wait'`, `message` = `msg`, `onCancel` when present (a Cancel button) | unchanged (`running`) |
| everything else | `select` (`bootUi.choose`), `ask` (`bootUi.confirm`, the data-corruption questions at `bootstrap.ts:989, 1016`), `markdown` (`alertMd`: nightly warning, diagnostic report), `toast` (repair notices), `staleAccountNotice`, `progress`, `input` and the rest | not mapped: stays in `<AlertComp />` | unchanged |

- **State.** `NexusBootScreen` applies `bootStateWithNotice(progress.state, notice)`, so the adapter does not set the state itself: a normal or error notice shows `waiting` (the mark reads "Waiting for you", the bar pulses, the slow hint stays hidden); a wait notice keeps the boot state. `failed` must come from boot: the outer catch in `loadData` (`bootstrap.ts:576-578`) is the failure path, and when structured progress lands (STARTUP_AND_ONBOARDING) it should report `state: 'failed'` before its `alertError`. Then the notice shows on a failed bar.
- **Accessibility.** The card renders inside an `role="alert"` region (errors) or `role="status"` region (others), both always mounted, so it is announced when inserted. Focus moves to the card's OK or Cancel button, matching the modal. The stack trace sits in a collapsed "Technical details" disclosure.
- **Strings.** "OK", "Cancel" and "Technical details" are English fallbacks (`dismissLabel`, `cancelLabel`); pass translated ones.

Acceptance: `mockups/startup.html?scenario=notice` behaviour in the app; no modal over the boot screen for `normal`, `wait2`, `error` or `wait`; the save-damage prompts and other types still appear as the modal; a boot-time network error keeps its help text and stack trace; a cancellable wait can be cancelled.

### R-07 WebView device check (AUD-07)

The per-side keyframes remove `var()` from keyframes. `transform-box: view-box` on SVG children is still unverified on WKWebView, WebKitGTK and older Android System WebView. Open `mockups/status-marks.html` on each and watch preparing, memory, generating and finishing.

### R-08 Unreachable settings (AUD-08)

On the main branch, check whether `FilesSettings.svelte` exists and whether any menu sets `SettingsMenuIndex` to its index. If so, add a "Storage & Files" entry in `Settings.svelte` (or embed it in an existing page). Agents/Reports/99-settings-ui.md is the audit's reference.

### R-09 IDE and code ergonomics (AUD-09, section 5)

App-only work, ordered by size:

1. `PluginSettings.svelte:312-315`: call `a.click()` and remove the anchor; either use `createBlankPlugin` or drop the import (`:8`).
2. `TextAreaInput.svelte`: bind the popup-editor hotkey and context menu on the `contenteditable` branch too; add a visible "Open in editor" corner button when `highlight` is set or `popupLanguage` is not `markdown`.
3. `TextAreaInput.svelte:246-248`: insert `{{name::}}` with the caret after `::` instead of `{{name:`.
4. Autocomplete for `@@` / `@` decorators from `highlight.ts` `decorators`, with signature and one-line doc hints.
5. `cbsMonaco.ts`: implement `registerCBSMonaco()` (language, Monarch tokenizer, completion from `getMacroData()` and decorators, hover docs); enable `<option value="cbs">` in `PopupEditor.svelte:70`.
6. `luaMonaco.ts`: Risu Lua globals from `src/ts/process/scriptings.ts` and `docs/wiki/Lua-API-Reference.md`, with snippets and hover docs; an "Open Lua editor" button next to Help in `TriggerList.svelte`.
7. Plugin Studio: register `risuai.d.ts` with Monaco's TypeScript defaults (`addExtraLib`), header-comment completions, live `parsePluginHeader` / `checkCodeSafety` diagnostics, transpile and hot-reload via `importPlugin`. Patch `risuai.d.ts` with `alert`, `alertConfirm`, `alertError`, `setChatPanel` if they are live.

Design work that could happen in this workspace first: a Plugin Studio / code-editor mockup in DEEP NEXUS styling (editor chrome, completion popover with signature, diagnostics pane). Not started.

### R-10 Three-mode architecture (sections 3–4)

**Approved by the maintainer on 2026-10-16.** The audit proposes `DBState.db.appMode: 'rp' | 'hybrid' | 'utility'` (set from onboarding "use": stories → rp, both → hybrid, tools → utility), a Hybrid "companion character" with its own prompt pipeline and chat isolation (`chat.mode` or `hybridChats[]`), and a Utility workspace that grows out of the hidden `§playground` character (`src/ts/playgroundChat.ts:8`). Source anchors confirmed: `utilityBot` toggle at `CharConfig.svelte:1218`, `PLAYGROUND_CHA_ID = '§playground'`, `gridOpen` at `App.svelte:43,215`. The prompt-pipeline lines (`process/index.svelte.ts:817-846`) were not checked.

Open questions for the implementation design (the direction is approved; these details are not):

- Is mode a persisted top-level switch, or a per-workspace or per-chat property? The onboarding mockup's "hide unused modes and features" checkbox already assumes some mode concept; the two must agree.
- Hybrid chat isolation: a `mode` tag on chats, or a separate list? This is a storage-format change and belongs to the persistence work.
- Does Utility mode replace the Playground menu, or sit beside it?
- RisuRealm in RP only: matches the audit, but the MC-053/054/056/057/060/086 invariants must survive any Home refactor.

Design work: the main menu in all three modes, with the header mode switcher, is now mocked up in `mockups/home.html` and specified in [MAIN_MENU.md](MAIN_MENU.md). It adds five open questions: how hide-unused treats the switcher, whether Hybrid can be the only mode, persona vs nickname in Hybrid, a run in progress across a mode change, and the companion-isolation copy.

## Independent review follow-up

Review: [reviews/2026-10-16-audit-fixes-review.md](reviews/2026-10-16-audit-fixes-review.md), verdict "accept with changes". Fixed on 2026-10-16 at the maintainer's request:

- **F-1 (progress ring at small sizes).** The review's option (b), plus a wider gap. At 20 px a ring with even a 1 px gap would need the frame scaled past the viewBox, so below 40 px (`PROGRESS_MIN_SIZE` in `nexusMark.ts`) the ring is not drawn: `markSvg` omits `data-progress`, and `NexusStatusMark` shows the exact percentage as text beside the mark instead (or in the label with `showLabel`). From 40 px the ring now scales the frame by 1.2 instead of 1.12, which leaves about 4 view units (1.1 px at 40 px) between the frame and the ring. The demo in `status-marks.html` shows 160 and 48 px rings and 32 and 20 px marks with text. N-4 (poses crossing the ring) is accepted and noted in `nexus-mark.css`.
- **F-2 (BootNotice).** `BootNotice` gains `detail`, `stackTrace`, `onCancel` and `cancelLabel` (F-2a, F-2b). `wait2` maps to an error notice (F-2c). The new `bootStateWithNotice` makes the screen show `waiting` under normal and error notices, keeps wait notices running, and lets a boot-reported `failed` win (F-2d). R-06 now has the full type mapping, including the save-damage prompts by type. N-11 is fixed too: the live regions stay mounted and focus moves to the card's button.
- **N-6 (non-finite stills input).** `createNetworkField` drops an `initialWave` or `initialPointer` whose `x` or `y` is not finite, and falls back to the default age for a bad `age`.
- R-05 now names the current hard block it removes (`WelcomeRisu.svelte:54`).

Checks for these fixes: bundles rebuilt; strict `tsc` and `svelte-check` (Svelte 5.56.8) report 0 errors and 0 warnings. `NexusBootScreen` was compiled and server-rendered with Svelte for five cases: no notice (bar `running`, mark `preparing`); normal (bar and mark `waiting`, OK button); error (`waiting`, card inside the `role="alert"` region, detail and "Technical details" present, OK); wait with cancel (`running`, Cancel button); plain wait (`running`, no button). All three live regions (the mark's, alert, status) render in every case. Focus movement was not exercised (server render only). In the browser pane: `home.html?wave=abc&still=1` and `?wave=0.5,abc,2&pointer=x,1` load with no console errors; `status-marks.html?progress=64` draws rings on the 160 and 48 px marks (computed opacity 1), none on 32 and 20 px (opacity 0) with "64%" beside them, and the 48 px ring has a visible gap from the frame.

## Verification of the changes

On 2026-10-16, this machine (Windows 11), Claude desktop browser pane (Chromium), pages served from `docs/design` by a local static server:

- `status-marks.html`: progress ring drawn at 42 % and 52 % (computed `stroke-dashoffset` 48 at 52 %); simulated import ends on `done`; light panel frame computed `rgb(15, 23, 42)`. With low power and still on, `idle` frame `rgb(255,255,255)` and centre `none`, `done` frame `rgb(127,233,255)` and centre `matrix(1.18…)`, glow `display: none`. Generating sides run `nm-emit-top/right/left`. No console errors.
- `home.html`: a click on empty background drew a ring of links at the click point; after 3 s no links remained. `?wave=0.36,0.86,0.8&still=1&t=6` drew a fixed frame.
- Hover spotlight (second pass), measured on isolated 600×400 test canvases by summing pixel alpha in a 60 px square near a synthetic pointer at (300, 200) after 0.9 s: idle 323; mouse `pointermove` 4,284; touch `pointermove` 326 (ignored); a click wave left the centre dark (323) and lit a square 400 px away (10,602 vs about 660 idle); with `reducedMotion` both pointermove and pointerdown changed nothing. `home.html?pointer=0.36,0.86&still=1&t=6` and `onboarding.html?pointer=0.3,0.7` load with no console errors. The pane was too small for a screenshot of the spotlight, so it has not been looked at visually.
- `onboarding.html?step=model&provider=claude`: a non-`sk-` placeholder string gave class `advisory` (computed `rgb(255,179,138)`) and an enabled Continue.
- 375 px width: `status-marks.html`, `home.html` and `onboarding.html?step=model` have no horizontal overflow.
- Strict `tsc` passed for `nexusNetwork.ts` (again after the spotlight), `nexusMark.ts`, `mark-entry.ts`, `bootProgress.ts` and `theme/nexus-colorscheme.ts`. `svelte-check` (Svelte 5.56.8) reported 0 errors and 0 warnings for the three components; a planted type error in `NexusStatusMark.svelte` was reported and then removed.

Not checked: reduced motion and forced colors in a browser (code paths only; the earlier package checks predate this change), WKWebView / WebKitGTK / Android, mobile performance of the wave, screen-reader output. The `mockup-preview.png` still was not regenerated. No independent review of these changes has been run yet.

## Second audit (2026-10-17)

Audit: [reviews/2026-10-17-third-party-audit-v2.md](reviews/2026-10-17-third-party-audit-v2.md) ("DEEP NEXUS UI Audit v2, Seasonal Wordmark Expansion & Studio / 3-Mode Specification", supplied by the maintainer, who asked for its fixes and additions to be implemented). Nothing outside `docs/design/` was changed.

### Findings

| ID | Finding | Status here |
|---|---|---|
| S-01 | Simplified Chinese is stored as `cn`, not `zh` | **Fixed.** Confirmed against `src/lang/index.ts:14` and `languageSettingsData.svelte.ts:40`. The core matches `cn`, `zh` and `zh-Hant` for Mid-Autumn (and the new Chinese occasions); `cn` descriptions are tagged `zh-Hans`. The calendar test now covers `cn`, `vi`, `ja`, `de` and `es` too. `home.html?lang=cn&date=2026-09-25` shows Mid-Autumn (observed). |
| S-02 | The lunar fallback table knew only the 8th month | **Fixed.** `lunar-table.json` v2 stores the Gregorian date of lunar 1/1, 5/5, 7/7 and 8/15 per year 2026–2060 for both calendars, generated by the new `seasonal/tools/gen-lunar-table.mjs`; `lunarFromTable` answers 1/1–1/4 and ±3 days around the other anchors. The v1 Chuseok and Mid-Autumn dates are unchanged (0 mismatches). |
| S-03 | Chuseok's dusk tints a running status mark | **Fixed.** `.rt-cs-night` has the same soft mask hole as Halloween and Mid-Autumn, placed from `ctx.stageOffset()`. Observed in the gallery with status `generating`: the hole centre equals the mark centre (16, 29 px) at full dusk opacity. |
| S-04 | Chuseok "Tan" in `#141414` read as a hollow outline | **Fixed.** 흑 is now 먹색 `#2a2d3d` with a thin 단청 celadon top hairline (static `text-shadow`), keeping the cream outline. This answers seasonal README question 8 (the Mid-Autumn cloud motif part stays open). |
| S-05 | Plugin & Script Studio mockup | See "Studio" below. |

### Studio (S-05, audit section 4, R-09)

`mockups/studio.html` arrived with the audit. Its lint rules were checked against the app source and the page was rewritten where the source disagreed. Verification record: [reviews/2026-10-17-studio-lint-verification.md](reviews/2026-10-17-studio-lint-verification.md) (per-rule claim, `file:line` evidence, verdict, change). Harness and screenshots: `reviews/studio/`; the audit build is kept as `reviews/studio/studio-before-auditor-original.html`.

**Corrections to the audit's section 4** (the parent re-checked the two largest itself):

- **CBS-E07 is wrong for macros:** `{{getvar:hp}}` works. The macro matcher splits on a single `:` when the first colon is not doubled (`parser.svelte.ts:1110-1117`), so it is now an info note. The block-level forms `slot::`, `arg::` and `call::` are matched as exact strings (`parser.svelte.ts` ~1797, 1826, 1838), so `{{slot:item}}`, `{{arg:1}}` and `{{call:f}}` stay literal and remain errors (studio review F-2).
- **CBS-E06 is off by one:** `call::fn::a::b` replaces `{{arg::0}}` with the function name and `{{arg::1}}` with the first argument (`parser.svelte.ts:1831-1838`). The wiki repeats the off-by-one (`CBS-Blocks.md:119,127`).
- **Partly right:**
  - CBS-E01: an unclosed block prints `<` plus its body; it does not leave raw `{{`.
  - CBS-E04: `vis` compares the chat variable named by its left token with a literal; the audit's `>` rewrite would compare NaN.
  - CBS-E05: `{{slot}}` outside `#each` is valid in templates.
  - CBS-E08: a missing argument is a warning, an extra one is info.
- **Confirmed:** CBS-E02 (orphan closer or `:else`) and CBS-E03 (`:else` inside `#if` prints both branches when true, and nothing when false).
- **Lua:**
  - `getEmbedding` does not exist, and `request` and `loadLoreBooks` are low-level.
  - `LLM`, `axLLM` and `loadLoreBooks` already await, so `:await()` on them is wrong.
  - `simpleLLM` returns `{success, result}`.
- **Plugins:**
  - The API header is `//@api 3.0`; `//@version` is the plugin's own version.
  - `parsePluginHeader` is in `plugins/pluginListMerge.ts:56`.
  - `checkCodeSafety` runs only for API 2.1 plugins; v3 plugins run in a sandbox iframe.
- **`highlight.ts` claim confirmed and extended:**
  - Missing: `#when`, `:else`, `#escape`, `#code`, `#puredisplay` and their closers.
  - `'#pure '` has a trailing space, so `{{#pure}}` is not matched.
- **The audit's own "clean" sample is buggy:** `stance::vis::ally::and::{{getvar::hp}}::>::50` is always false, because `and`/`or` read one token to their left. `conditionals.test.ts:274-280` records this as a FIXME. The page now flags it (CBS-W08).

**What the page does now:**

- The scanner mirrors the parser's frame stack, so `{{#each {{getvar::x}} as v}}` is seen.
- Quick fixes edit exact offsets, preview before/after and are undoable (button, toast, Ctrl+Z); Apply-all is one undo step.
- Decorator rules come from `lorebook.svelte.ts:370-584`.
- New rules: LUA-E02 (low-level calls inside `listenEdit`) and PLG-E03.
- The banner says the rules were derived from source on 2026-10-17, and a rule reference table carries the citations.
- Accessibility and layout: diagnostics are buttons that select the flagged range; skip link, roving-tab mode tabs, `aria-live` summary, reduced motion; no horizontal scroll at 375 px.

**Checks run (headless Chrome, 115 checks, 0 failures):**

- A 42-case self-test of the in-page parser port, transcribed from `conditionals.test.ts` and `loop.test.ts`.
- 9 samples give the expected diagnostics.
- 22 quick fixes each clear their diagnostic and undo exactly.
- 59 valid CBS snippets from the wiki, tests and templates give 0 errors and 0 warnings; the audit build flagged 20 of them.
- A 45-stop Tab walk with visible focus; 1280 and 375 px layouts; no console errors.

**Not verified:** the real parser, the wasmoon Lua VM and the plugin loader were never run (no `node_modules` in this clone). Also not checked: whether `:await()` works outside `async()`; ccardlib's decorator parsing (`@@assistant` → `@@role` is labelled unverified); screen readers, touch, WebKit/Firefox and forced colors. The page has no light theme.

**R-09 update for the main session:**

1. Item 1 (`highlight.ts`): also add `#puredisplay`/`/puredisplay`, fix the `'#pure '` trailing space, and sync the decorator list with `lorebook.svelte.ts:370-584`.
2. Item 2 (porting `lintCBS`/`lintLua`/`lintPlugin`): port from the corrected `studio.html`, not from the audit text. First run the 59-snippet corpus (`reviews/studio/valid-cbs.mjs`) and the 42-case table against the real parser under vitest.
3. Doc backlog: the and/or right-to-left trap, and the wiki's `arg::0` numbering.
4. Maintainer decisions (2026-10-17):
   - **The editor never changes `lowLevelAccess`.** LUA-E01 only links to the per-character/module setting; no quick fix or Apply-all grants it.
   - **CBS-W08 (and/or binding) is tied to the parser:** keep it while upstream's precedence FIXME (`conditionals.test.ts:274-280`) describes current behaviour, and remove it when the parser is fixed.
5. Still open: is the deprecated-decorator `@@role` replacement correct? This needs a check against ccardlib, not a choice.

The line in R-09 above ("a Plugin Studio / code-editor mockup … Not started") is superseded by this mockup.

**Independent review and follow-up.** Review: [reviews/2026-10-17-studio-review.md](reviews/2026-10-17-studio-review.md), verdict "accept with changes". All must-fix findings were then fixed by the page's author (details in the verification record's "Review follow-up"):

- **F-1:** fixes no longer hide problems. There are no renames of structural names, the unclosed-tag fix closes after the tag name, and the toast says "N rule matches remain" and never "No issues".
- **F-2:** new error CBS-E10 for `slot:`, `arg:` and `call:`.
- **F-3 (parent decision):** the editor never changes `lowLevelAccess`. LUA-E01 only explains where the per-character/module checkbox lives (`CharConfig.svelte:1209,1282`, `ModuleMenu.svelte:365`), and the toolbar control is a labelled what-if simulation outside the fixes and Apply-all.
- **F-4:** new LUA-W04 for `simpleLLM`/`LLM`/`axLLM` results used as strings.
- **F-5:** a diagnostic jump also scrolls the editor horizontally.

Most notes were also handled:

- New CBS-I09 (`not::X::and::Y`) and CBS-I10 (`#each` without `::keep`).
- The sandbox wording now says it does not limit the `risuai` API.
- Loading a sample over edits is undoable, with per-mode undo.
- At 375 px the editor comes first and touch targets are 40 px.

Re-run: 136 checks, 0 failures, no console messages. The review's open question 3 stands: live `checkCodeSafety` diagnostics (R-09 item 7) only concern API 2.1 plugins. Item 7 should be reworded to v3 header and API diagnostics.

### Seasonal expansion (audit section 3)

All sixteen proposed scenes are built: wave 1 (`valentine`, `stPatricksDay`, `aprilFool`, `easter`, `summerSolstice`, `thanksgiving`), wave 2 (`seollal`, `springFestival`, `krNational`, `dano`) and wave 3 (`sakura`, `childrenDay`, `starFestival`, `obon`, `tsukimi`, `bunkaNoHi`).

- **Where it is documented:**
  - Handoff and open questions: [seasonal/README.md](seasonal/README.md).
  - Calendar, priority and parent adjustments to the storyboards: [seasonal/CONTRACT.md](seasonal/CONTRACT.md) "Calendar" and "Storyboards v2.1".
  - Per-scene as-built notes: [seasonal/MOTION.md](seasonal/MOTION.md).
- **Departures from the audit:**
  - April Fools is option B with no meme names ("pixel shades").
  - Thanksgiving has no feathers; review A found that even a fan can read as a headdress, so the mark is now a wheat sheaf.
  - The national holidays avoid any NAVER likeness, and 3·1절 uses one muted ink ribbon.
  - The Star Festival tanzaku hangs above the "T", because the bounds rule forbids decoration below the word.
  - Thanksgiving is `en` only; St. Patrick's Day and Easter are `en`/`de`/`es`.
- **Reviews:** [A](reviews/2026-10-17-seasonal-v21-review-a.md) and [B](reviews/2026-10-17-seasonal-v21-review-b.md). No rejections. Every must-fix and most minor findings were fixed and re-checked. Review A also found easing drift in the older New Year, Christmas and Halloween scenes, which made the white everyday △ visible mid-flip; that is fixed with final poses unchanged.
- **Main session:** see the integration map in seasonal/README.md. Port `resolveOccasion` with exact `DBState.db.language` matching (`cn`), and port `tools/calendar.test.mjs` to vitest.
