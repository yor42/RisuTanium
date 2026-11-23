---
name: ui-audit
description: Runs a read-only, screenshot-based UI audit against a fixed rubric (WCAG 2.2 AA, a Nielsen-derived usability subset, project rules) and returns one finding row per defect for the restyle backlog.
---

Audit the requested screens: $ARGUMENTS

This is the check half of UI-S7 (MC-1699). It records defects; it changes no code. A finding becomes a backlog item or ticket that goes through the normal gates. Under the follow-up policy (MC-2745) the run's ticket candidates are batched into one issue per audit, at most 2 new issues in all, after checking open issues for duplicates; you never file issues yourself, the owning session does. Restyle work from reference images is a separate, gated stage.

## Hard limits

- **Read-only.**
  - Edit nothing under `src/`, `src-tauri/`, `docs/` or `.claude/`.
  - Everything you write goes under `%TEMP%\risu-b715\ui-audit\<run-id>\`, never in the checkout: reports, captures, the Chrome profile and harness output.
  - Never name a file REPORT*, SUMMARY* or FINDINGS*.
- **Synthetic profile only.**
  - No real cards, chats, personas or keys on screen.
  - Never capture a settings page that shows a key field, even masked.
- **PC Chrome.**
  - Use only the harness. Run it as a background job:
    `node Agents/Tools/chatshell-cdp/launch-chrome.mjs --port <cdp> --proxy-port <proxy> --profile %TEMP%\risu-b715\ui-audit\<run-id>\profile --out %TEMP%\risu-b715\ui-audit\<run-id>\harness`
  - Pick ports no other session uses. Then read `chrome.pid` and `proxy.port` from `--out`.
  - Exit codes 2 to 7 mean stop. Code 6 or 7 means the fail-closed proxy is not confirmed, so capture nothing.
  - The proxy forwards only localhost, 127.0.0.1, [::1] and mock.test, so serve `pnpm dev` on localhost. Refused hosts are listed in `proxy-refusals.jsonl`.
  - Kill only the PIDs the launcher wrote, and check the process name is chrome before you stop `chrome.pid`.
- **Devices: screenshots only.**
  - All adb goes through `Agents/Tools/device-guard/adbg.mjs`.
  - Do not run pm clear, install anything or change app data or settings. Input is limited to located taps, swipes and keyevents needed to reach a screen.
  - Wi-Fi off, synthetic data, located crops, a whole-run STOP rule. PICK-LOCK means stop.
  - **Note 9:** hold a `note9` lease for that phone first (`lease-acquire --pool note9`, see [live-checks](../../../docs/workflow/live-checks.md#device-leases)), and until the lease is live ask lane B for a window; either way confirm no other agent is driving that phone.
  - **Tab S9:** take the lane A lock `%TEMP%\risu-b715\device-tabs9.lock` (mkdir plus owner.txt). If it exists, wait; remove it when done. Stay inside your adbg scope file. Never touch other apps.
  - **Fold 7:** no adb.
- **Run slots.**
  - A `pnpm dev` server needs no slot.
  - A production build for captures takes slot B: create the directory `%TEMP%\risu-b715\fullrun-slot-b` plus `owner.txt` naming you and the time. If the directory exists, wait. Remove it when done. Prefer `pnpm dev` unless the brief needs prod.
- **Protected files.**
  - Never edit `Legal.svelte`, the ToS, the Privacy Policy or `docs/branding/**`.
  - Screens that render them may be captured for accessibility findings only, with no restyle proposals. Mark those rows "protected file: maintainer".
- **Tools.** No LSP tool. Do not read `colorscheme.ts`, because this is not theme implementation work.

## Capture matrix

Capture each requested screen in every cell that applies, and name each file `<screen>_<device>_<width>_<theme>_<state>.png`.

| Device | Viewport | Use |
|---|---|---|
| PC Chrome | 1280x800 and 1920x1080, zoom 100% | main desktop cells |
| PC Chrome | 1280x800 at 200% zoom | A6a |
| PC Chrome | 320 CSS px wide (`Emulation.setDeviceMetricsOverride`, mobile false) | A5 reflow; equals 400% zoom at 1280 |
| PC Chrome | 360x800 mobile emulation (mobile true, touch on) | CDP-measurable mobile checks: A3, A7, P2 |
| Note 9 | portrait, about 360 dp | release WebView, no CDP: located crops |
| Tab S9 | portrait and landscape | located crops |

For device crops, record the screen density (`wm density` through adbg) so pixels convert to dp. If your adbg scope refuses that call, say so, and derive the scale from the screenshot width and the device's published dp width.
On devices, mark A3, A5, A6, A7 and P1 as either "estimated from crop" or "not checked". Never report them as measured.

- **Themes:** the default theme, plus one dark and one light theme pack if installed.
- **Locales:** en and ko. Add ja when a screen has long labels.
- **States:**
  - empty;
  - typical (synthetic data);
  - long content (long names and messages);
  - busy or loading;
  - error;
  - keyboard focus (Tab through the screen on the PC).

Use a smaller matrix only when the brief names one, and list every cell you skipped.

## Rubric

Every finding cites exactly one rule ID.

**A: Accessibility (WCAG 2.2 AA)**
- **A1, text contrast (1.4.3).**
  - Minimum 4.5:1. Large text needs 3:1: 24 CSS px and up, or 18.66 px and up when bold.
  - Exempt: disabled controls, decorative text and logotypes.
  - Measure the rendered color. Composite alpha and opacity modifiers over the effective background. Sample screenshot pixels when gradients, images or translucency sit behind the text, and say they are sampled.
- **A2, non-text contrast (1.4.11).**
  - 3:1 for icons, focus indicators, and the boundaries or states needed to identify a control.
  - Exempt: disabled components, and borders that are not needed to identify the control.
- **A3, target size (2.5.8).**
  - At least 24x24 CSS px.
  - Exceptions: spacing (a 24 px circle centered on the target overlaps no other target), inline text links, browser-native controls, and cases where the size is essential.
  - Note under 44 px (2.5.5 AAA; Android guidance 48 dp) on phones as polish, not as an AA failure.
- **A4, focus.**
  - Focus is visible (2.4.7).
  - It follows a sensible order (2.4.3).
  - It is not entirely hidden by sticky bars or overlays (2.4.11). Partly hidden passes AA.
- **A5, reflow (1.4.10).** At 320 CSS px wide there is no horizontal scroll and no clipped controls. Exempt: content that needs a 2D layout (wide tables, canvases).
- **A6a, resize text (1.4.4).** Content and function survive 200% zoom.
- **A6b, text spacing (1.4.12).**
  - Inject this style over CDP: line-height 1.5, paragraph spacing 2em, letter-spacing 0.12em, word-spacing 0.16em.
  - Check that no content is clipped or overlapped.
- **A7, names (4.1.2, 1.1.1).** Every icon-only control and meaningful image has an accessible name and role. Check with CDP `Accessibility.getFullAXTree` on the PC.
- **A8, use of color (1.4.1).** State is not shown by color alone.
- **A9, dragging (2.5.7).** Every drag action, such as list reorder or drag-to-folder, has a single-pointer alternative.
- **A10, hover and focus content (1.4.13).** Tooltips and popovers can be dismissed, can be hovered, and stay put until dismissed.
- **A11, page language (3.1.1).** `<html lang>` matches the UI locale. Check over CDP.

**H: Usability (a subset derived from Nielsen's heuristics)**
- **H1, visible system state:** saving, busy, offline and progress are shown.
- **H2, match with the user's words:** UI strings say "first message", not "greeting".
- **H3, user control:** destructive actions have undo or cancel, or a confirm that names the target.
- **H4, consistency:** the same control looks and behaves the same across screens.
- **H5, errors:** errors say what happened and what to do next.
- **H6, touch discoverability:** nothing is hover-only. This is project-specific, not one of Nielsen's ten.
- **H7, minimalist design and hierarchy:** the primary action is clear, and there is no clutter.
- **H8, recognition rather than recall:** options are visible, and users need not remember values across screens.
- **H9, efficiency:** frequent actions are short. Note missing keyboard shortcuts on the PC as polish.

**P: Project rules**
- **P1, theme colors.**
  - Colors come only from the theme tokens in `src/styles.css`: `textcolor`, `textcolor2`, `bgcolor`, `darkbg`, `darkbutton`, `selected`, `borderc`, `darkborderc`, `draculared`, and the primary, secondary and danger scales. Opacity modifiers on tokens are fine.
  - A Tailwind default color (gray-*, white, black) or a hard-coded color that ignores a theme pack is a finding.
  - Use the CDP computed styles to trace where a color comes from.
- **P2, locale fit:** ko and ja labels are not truncated or overlapped, and do not push a button onto two lines.
- **P3, mobile first:** Android is the main platform (MVP), so its layout comes first.
- **P4, recorded restyle decisions are followed.**
  - Open the UI-S7 backlog `%TEMP%\risu-b715\lanec\restyle-backlog.md` read-only; lane C owns it, so never edit it.
  - If the backlog is missing, use the Roadmap UI-S7 row and MC-1698/MC-1699 only, and say so under "Not checked".
- **P5, theme pack fidelity:** a pack's tokens apply everywhere, with no default-theme leftovers.

## Severity

- **blocker:** the task cannot be done, text cannot be read, or a control cannot be reached.
- **major:** the task can be done but is error-prone or slow, or there is an AA failure on a primary screen.
- **minor:** an AA failure on a secondary screen, or a noticeable inconsistency.
- **polish:** visual nits and AAA or platform guidance.

## Optional automated pass

axe-core is not a repo dependency. Run it only if the brief allows it:
- Inject it over CDP into the harness page from a scratch copy under the run directory. Never add it to `package.json`, and never run pnpm in a scratch copy.
- Report each result as a rule A row, with the axe rule id in the note.
- Its output is input, not proof. Confirm each result on the screenshot.

## Output

Write `%TEMP%\risu-b715\ui-audit\<run-id>\audit-<run-id>.md` with these sections:

1. **Scope and build:** the commit, dev or prod, the matrix cells run and skipped, themes, locales, and the device densities.
2. **Findings:** one row per defect.

| ID | Screen | Cells | Rule | Severity | What is wrong | Evidence (crop path, measured or estimated value) | Suggested fix | Backlog/ticket candidate |
|---|---|---|---|---|---|---|---|---|

3. **Not checked:** the rules or cells you could not evaluate, and why.
4. **Duplicates:** findings already in the backlog or an open ticket, with its ID.
5. **Ideas (optional):** taste preferences with no rule ID. These are not findings.

How to write the rows:
- Merge the same defect across cells into one row and list the cells.
- Give at most a one-line fix direction; propose no code edits.

Hand back three lines: the report path, COMPLETE or PARTIAL, and blockers.
