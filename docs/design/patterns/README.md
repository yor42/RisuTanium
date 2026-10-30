# Warning and task-progress pattern: wave 0

Status: built and checked in this clone (2026-10-28). Design deliverable only: nothing here touches the app. Spec: [WARNINGS_AND_PROGRESS.md](WARNINGS_AND_PROGRESS.md). Motion: [MOTION_CONTRACT.md](MOTION_CONTRACT.md). Decisions: DD-219..234 in [../DECISIONS.md](../DECISIONS.md). Inventory behind the spec: [research/inventory.md](research/inventory.md).

Open [demo.html](demo.html) (serve `docs/design` and open `/patterns/demo.html`). Controls: language (KO first, EN toggle), reduced motion (`html.rm`; the OS media query is also honoured), low power (`html.nexus-low-power`), layout (Auto, a 360 px frame, a 1280 px frame), theme (Deep Nexus, Origin Navy, Banana Cocoa), touch input. Everything on the page is synthetic: the "engine" is a timer mock in `demo.js`; the leave-out list is marked **mock** (DD-227).

## What is in the package

| Path | What |
|---|---|
| `../theme/pattern-tokens.css` | the `--pattern-*` look tokens, the `--warning-*` and `--task-*` motion tokens (DD-226: one shared file) |
| `../theme/nexus-tokens.css` | additive block: the 7 shared motion tokens (`--nexus-ease-out`, `--nexus-ease-in`, `--nexus-duration-exit`, `--nexus-duration-lowpower-cap`, `--nexus-dialog-enter-distance`, `--nexus-sheet-enter-distance`, `--nexus-scrim-duration`). No existing value changed |
| `pattern.css` | layout, colour, type. No animation, no literal (the csslit classifier passes over it) |
| `motion.css` | every transition and animation; the five `--pm-*` mode switches that give full motion, low power and reduced motion without duplicated rules |
| `pattern.js` | `window.RisuPattern`: the task state machine, warning sheet and banner, task card, background toasts, undo toast, strings (KO/EN). Also loads in Node (the state machine is unit-checked there) |
| `demo.html`, `demo.js` | every state of export, import, restore and backup, the five severities, live flows, toasts, mode and theme controls |
| `themes/origin-navy.css`, `themes/banana-cocoa.css` | the two re-skin probes. Origin Navy is tokens only; Banana Cocoa adds reach-tier part rules. Both pass the lint |
| `checks/registry.mjs` | the **registry fragment** (critical parts, floors and ceilings, contrast pairs) and `mergeRegistry` / `lintPattern` |
| `checks/sheet-height.mjs`, `checks/measure-heights.mjs` | the DD-256 worst-case height model and its calibration against the rendered sheets |
| `checks/run.mjs` | the suite: `node checks/run.mjs [node\|a\|b\|c]`. Logs: `checks/results.log`, `checks/results.json`, screenshots in `checks/shots/` |

## How a lane adopts the pattern

1. **Load order.** `theme/nexus-tokens.css`, `theme/pattern-tokens.css`, `brand/nexus-mark.css`, `patterns/pattern.css`, `patterns/motion.css`, then the lane's own CSS. For the script: `mockups/nexusMark.iife.js` (the status mark and the boot step model, reused, not forked), then `patterns/pattern.js`.
2. **Alias, do not copy.** A lane that wants its own names writes `--chat-warn-edge-width: var(--pattern-warn-edge-width)` the way DD-217 aliased the warning channel. It keeps its own frame parts (`settings-dialog`, `studio-critical-sheet`, `chat-critical-*`, `home-confirm`) and puts the pattern's parts inside; the children keep the pattern's names.
3. **Merge the registry fragment** (DD-226) into the lane's registry, and lint the lane's packs with it:
   ```js
   import { mergeRegistry, lintPattern } from '../patterns/checks/registry.mjs';   // path relative to the lane's check
   export const REG = mergeRegistry(MY_LANE_REGISTRY);                           // critical, safe, surfaces, tokens, minimums, maximums
   export const lint = (css, name) => lintPattern(css, name, MY_LANE_REGISTRY);  // chat.lintPack(css, name, REG) + the supplement
   ```
   `mergeRegistry` unions parts and tokens, keeps the stricter of two bounds, and keeps the lane's `strictSafe` and `positionable`. The lane's own tokens win on a shared name. `checks/tests-node.mjs` runs exactly this against the real Chat, Settings (5b), Studio and Home registries and their bundled packs (read-only): the merge breaks none of their own checks and every lane rejects a pack that hides the consequences or breaks a floor.
4. **A pack must state `--nexus-warning-rgb`.** The lane Banana Cocoa packs set `--color-warning` directly and not the channel, so the pattern's caution edge and skipped-list edge fall to 1.4:1 on their white sheet (the merge reports it as an adoption note, not a break). One line per pack: `--nexus-warning-rgb: 138 90 0`.
5. **Drive tasks, do not draw them.**
   ```js
   const task = RisuPattern.createTask({ kind: 'restore', name: 'demo-backup.bin', subtitle: () => '...', background: false,
     steps: [{ id: 'check', label: '파일 확인', mark: 'scanning' }, { id: 'assets', label: '...', mark: 'transfer_in', counted: true, noun: 'key' },
             { id: 'replace', label: '데이터 교체하기', mark: 'transfer_in', cancel: false, write: true }] });
   RisuPattern.openTaskFlow(task, { warning: {...}, trigger: button, container: document.body, background: [appRoot] });   // confirm sheet, then the same dialog turns into the progress card
   task.start(); task.progress(12, 40); task.step('replace'); task.finish({ counts: '...', size: 155189248, skipped: [{ name, reason: 'large'|'invalid'|'notstored', detail }], leftOut: [{ text }] });
   task.block('offline' | 'other-tab' | 'background'); task.unblock(); task.fail({ dataState: 'same' | 'unknown' | 'partial', code }); task.requestCancel(); task.settleCancel({...}); task.retry();
   ```
   Warnings: `RisuPattern.openWarning(def, { trigger, container, background })` returns `{ promise: 'confirm' | 'secondary' | 'cancel' }`; `RisuPattern.banner(def, host)` for caution and notice. Undo: `RisuPattern.showUndo({ label, onUndo, untilText })`; `handle.end(text)` when the condition that ends Undo happens. Background: `RisuPattern.toasts.addTask(task, { reopen })`.
6. **The warning definition object.** `openWarning(def, opts)`, `renderWarning(def)` and `banner(def, host)` take:
   ```js
   { severity: 'notice' | 'caution' | 'confirm' | 'danger' | 'blocked',
     headline: 'one line, verb and object (target 36 KO / 60 EN; two lines are allowed, DD-257)',
     consequences: ['one fact each, with a count, size, name or time', ...],   // 3 are shown; a 4th and later fold into the one disclosure, whose toggle then reads "그 밖에 N개 보기"
     detail: ['optional lines behind the disclosure; never repeat a bullet'],
     leftOut: [...], mock: true,                                              // the .bin leave-out: sets data-has-leftout; `mock` adds the "가상 목록 (mock)" tag (DD-227)
     ack: 'label of the one acknowledgment checkbox (gates the primary)',
     undoLine: 'a line that names a time limit (critical)',
     actions: { cancel: '취소', secondary: '...', primary: '교체하기' } }       // REQUIRED on a sheet: confirm and danger need cancel and primary; any other sheet needs at least one. A banner needs none.
   ```
   A sheet without the actions it needs **throws** (`openWarning` and `renderWarning`): a phone user must be able to answer or dismiss it (review B2). Cancel (or "머무르기", or the only "닫기" of a blocked sheet) takes first focus (DD-245). `opts`: `trigger` (focus returns to it), `container` (default `document.body`; a framed demo passes its frame), `background` (see 8).
7. **Language.** `RisuPattern.t(key, vars)` reads `document.documentElement.lang` on every call: `en...` is English, anything else Korean (KO first). `RisuPattern.setLang('ko' | 'en')` sets that attribute; a lane that already owns `html[lang]` just keeps it current. `RisuPattern.addStrings({ ko: {...}, en: {...} })` adds a lane's own keys. Open views do not re-translate themselves: rebuild them after a language change (the demo closes everything and re-renders). Korean text uses `word-break: keep-all` under `:lang(ko)`.
8. **Layer, inert, z-index.** The dialog layer is `position: fixed` at `z-index: var(--pattern-z-layer)` (60; a pack may move it between 40 and 100) and the toast stack one above. A lane whose own chrome sits higher must lower it or raise the token. `opts.background` is an **array of elements to make `inert`** while the dialog is open (the app root, a sidebar): pass every sibling subtree that holds controls; the demo passes `#stage`. Focus is trapped inside the dialog, a focus that escapes is pulled back, and the inert flags are restored on close. While the dialog is open the toast stack is hidden (DD-244).
9. **Role tokens a pack may set.** The fail-closed lint (DD-242) accepts only settable tokens. The fragment declares them in `checks/registry.mjs`: `PATTERN_SETTABLE` (every `--pattern-*`, `--task-*`, `--warning-*`), `PATTERN_COLOURS`, `PATTERN_OPAQUE` (`--pattern-surface`, `--pattern-surface-toast`) and `PATTERN_PAIRS`; `mergeRegistry` unions them into the lane's `settable`, `colours`, `opaque`, `pairs` and `reach`. Pack-private helpers do not exist in the Banana Cocoa pack any more (its rules use literals), so it needs no private prefix.
10. **Style by state, never by class or text.** `data-pattern-severity`, `data-task-kind`, `data-task-state`, `data-step-state`, `data-has-skips`, `data-has-leftout`, `data-low-power`, `data-compact`, `data-task-retry`, `data-task-cancelled`, `data-task-mode`.

### Parts and tiers (also in `checks/registry.mjs`)

- **Critical** (a pack cannot name them, only set tokens): the dialog shell, scrim and layer; warning root, mark, headline, consequences, each consequence, detail toggle (it is also the "그 밖에 N개 보기" overflow row), actions, Cancel, primary, secondary, undo line, acknowledgment; task root, status, Cancel, Cancel reason, actions, bar, fill, count, result, result headline, summary, skipped list and each skipped row, "more", left-out list, result actions, guidance, Retry, Close, Undo import, and the undo toast's button.
- **Reach** (a pack may recolour, reborder, respace, re-font; it may not hide, move or animate): warning detail body and caret, mock tag, task mark and badge, title, subtitle, steps, step, step icon and count, sweep, ticks, detail, chip, toast, toast stack and their small buttons. Spec 6.3 lists some of these as "not critical"; they are not *safe leaves* either, because `packlint.mjs` rule 4 needs a leaf that never sits inside a protected element, and all of them sit inside `pattern-task-root` or the dialog shell.
- **Safe**: none.

### DD-256: the worst-case sheet height (for the lint rule)

`checks/sheet-height.mjs` (run it: `node patterns/checks/sheet-height.mjs`). Rule: `max(warn, task, result) <= 640` at a 360 px wide phone, where each term is computed from the pack's geometry tokens (each token at its **largest** value anywhere in the pack; the model never gets shorter when a token grows, so that is the worst case). `lines(n, size, w) = ceil(n / floor(w / size))` (a Korean glyph is 1 em; Latin is about half, so English wraps less). `w_text = 360 - 2 - 2P - E - M - P`.

- warning sheet: `warn = 2 + 2P + r1 + r2 + A + A + r5 + 4G`, `r1 = max(M, lines(36, HS, w_text) * HS*HL)`, `r2 = 3 * lines(40, BS, w_text - LI) * BS*BL + 2G`, `r5 = 3A + 2G` (toggle row, acknowledgment row and three stacked actions all present).
- running card: `task = 2 + 2P + head + steps + BH + LM + status + (2A + G) + 5G`, `head = max(TM, lines(30, HS, w_card - TM - P) * HS*HL)`, `steps = 3 * max(SI, BS*BL) + 2 * SG`, `status = max(LM, 2 * BS*BL)`.
- result card: the same head, steps, bar and count line plus the result (headline of 24 chars, one summary line, a skipped box of 3 rows of 30 characters with its heading and "more" button, one undo line, two rows of actions).
- tokens: `P` `--pattern-warn-padding`, `G` `-warn-gap`, `E` `-warn-edge-width`, `M` `-warn-mark-size`, `HS` / `HL` headline size and leading, `BS` / `BL` body size and leading, `A` `-warn-action-height`, `LI` `-list-indent`, `BI` `-bullet-inset`, `SG` `-task-step-gap`, `BH` `-task-bar-height`, `TM` `-task-mark-size`, `SI` `-step-icon-size`, `LM` `-line-min`, `SE` `-skip-edge-width`.
- numbers (px): Deep Nexus defaults warn 466, task 351, result 616 (max 616, 24 spare); Origin Navy 618; Banana Cocoa 620; **every geometry token at its ceiling 2583** (warn 2583, task 1058, result 2163). Calibration against rendered sheets at 360 x 640 touch, Korean (`checks/measure-heights.mjs`): warning with the detail open 464 (model 466), running card 282 (351), import result with skips 541 (616). The model is an upper bound by design.
- `lintPattern` applies it (fixtures: the review's all-ceilings pack and a padding, gap, action and leading pack are rejected; padding 24 / gap 8 passes).

## Decisions as built

| DD | Where it is built | Checked by |
|---|---|---|
| 219-221 anatomy | mark + headline + 2-3 consequences + detail disclosure; steps + determinate bar + count + mark + Cancel + result card with skipped list | A: states of all 4 kinds (47 cards); B: result, skipped list, left-out |
| 222 motion | `motion.css`, tokens | C: runtime property scan, budgets, timelines |
| 223 one 10 s undo | `RisuPattern.UNDO_MS`, undo toast, grouped Undo import line. The line states the **seconds left** ("10초 안에 되돌릴 수 있어요"), not a clock time, because the clock stops (DD-244, DD-253) | B: 10 s of running clock (real time); C: undo toast ends at 10 s |
| 244 toasts under a sheet | while any `pattern-layer` is open the toast stack is `hidden`, every toast clock (undo, clean-finish hold) is paused, and they come back after the close | C: at 360 and 1280, Cancel and confirm are hit-tested, clocks compared |
| 253 grouped Undo window | 10 s from the result card appearing; paused while the Undo button is hovered or focused; seconds left on the line and in the button's label | B: hover, focus, expiry |
| 255 focus when Cancel hides | focus moves to the dialog shell (never the body); the reason becomes the shell's `aria-describedby`; the swap from the warning also parks focus on the shell | B: sampled every 40 ms over a whole restore |
| 256 pack size bound | `checks/sheet-height.mjs` (formula below) is called by `lintPattern`; whatever takes focus in a dialog is scrolled into view | node: fixtures; A: a 480 px screen with a taller sheet |
| 257 headlines | target 36 KO / 60 EN, two lines allowed; the mark stays in its row | A: 360 px |
| 224 Cancel before first write | `step.cancel`, `step.write`; the button is `hidden` and a reason line takes its place | B: per kind, Esc, focus |
| 225 grouped "Undo import" | result card of an import, one step, same 10 s | B |
| 226 token home | `theme/pattern-tokens.css` + 7 nexus tokens + registry fragment | node: lanes merge |
| 227 leave-out list | synthetic, marked mock, in the .bin warning and the export result | A, B |
| 228 `.bin` and `.rtb` | demo copy | A: no `.risub` anywhere |
| 229 one confirm with counts and size | restore, purge and the others carry counts and sizes; one sheet | A: copy rules |
| 230 banner versus sheet; Paused | caution and notice banners; confirm, danger, blocked sheets; `task.block()` throws for any reason but offline, other-tab, background | A, B |
| 231 no error shake | `motion.css` suppresses the brand shake inside the task mark | C: positive control and result |
| 232 done + warning badge | `pattern-task-mark-badge`, mark stays `done` | A, B |
| 233 danger ring and 250 ms guard | one ring (danger only; off in reduced motion and low power); `openWarning` ignores the confirm for `--warning-arm-delay` and any key repeat | B, C |
| 234 toasts | `RisuPattern.toasts` | C |

## Integration map for Lane A (proposal; nothing here was run against the app)

The main session wires this later. The pattern replaces the renderings inside `AlertComp` for the data flows and gives `alertWait` structured progress. Rows cite the spec and inventory ids; none was re-verified against `src/` for this wave.

| App seam (inventory) | Pattern call | Lane A work |
|---|---|---|
| `alertConfirm` call sites of the destructive confirms (A-6, A-38; spec 11 waves 3-7) | `openWarning({ severity, headline, consequences, actions })` | one confirm with counts and size (DD-229); two-step asks collapse |
| `alertWait` text progress of backup (A-3: inlays, cold data, database) | `task.step(id)`, `task.progress(done, total)` | structured progress: step id and counts instead of a string. `alertProgress` does not exist, so a task object is a new type (spec 11) |
| Backup and restore writers (A-1, A-3, A-12) | `step.cancel: false, write: true` on the first write | DD-224 needs no engine cancel; **mid-write cancel stays an engine change** |
| Restore guards: other tab, lock, `backupLoadWorkInProgress` (A-8, A-12) | `task.block('other-tab' \| 'offline' \| 'background')`, `task.unblock()` | report the blocking condition and when it clears |
| Skipped and left-out reports (A-4, A-11, A-15, A-31) | `finish({ skipped: [{ name, reason, detail }] })` | map the engine's categories to `large`, `invalid`, `notstored` |
| `.bin` export leave-out (MC-774, A-41) | `finish({ leftOut: [{ text }] })`, warning `leftOut` | **DD-227: Lane A returns the fork-only kinds present, with counts.** The demo list is synthetic |
| Import (A-33; DD-225) | `task.markWritten(n)`, `task.finish({ added })` | **a grouped undo for a whole import is not verified feasible**; the pattern only owns the button and the 10 s line, `task.undoImport()` is where the engine call goes |
| Failure with unknown state (restore "could not verify save", A-12 endings) | `task.fail({ dataState: 'unknown' })` | the engine must say which of `same`, `unknown`, `partial` it is; `unknown` shows guidance and no Retry |
| Hard-coded English in the backup flow (A-17) | `RisuPattern.addStrings({ ko, en })` | new language keys for these flows |
| Undo windows in Chat, Studio, Settings (6 s, 6 s, 10 s) | `RisuPattern.showUndo` | all become 10 s (DD-223); Studio passes `untilText` and calls `end()` when it closes |

Shell placement of the background toast stack (bottom, above the dock) and the Home Tasks row are proposals of the spec; this wave only provides the stack.

## Checks (what was observed)

`node patterns/checks/run.mjs` (from `docs/design`, with `node seasonal/tools/serve.mjs 6189` serving it). Playwright is not installed under `tools/node_modules` in this clone, so the suite drives Chrome 156 over CDP with a small driver kept in `checks/cdp.mjs` (three Chrome processes at most). One full run is about 50 s wall clock. The final counts and the log path are in the handoff message; `checks/results.log` is the record.

Not verified, and not claimed: any device (Note 9, Pi 3, WebKitGTK, Android WebView); a screen reader (NVDA, TalkBack) or Windows high-contrast (forced colours was emulated through CDP and read as computed style, not looked at); a real touch pointer (hover pause on touch is the `:hover` state a tap leaves); Safari; the app's persistence and alert store; whether the engine can report any of the above. The motion budget of MOTION_CONTRACT section 7 is a design target; the frame times were not measured. The brand mark's own transitions (fill, stroke, a 0.45 s opacity fade in reduced motion) belong to `brand/nexus-mark.css` and are excluded from the "150 ms or less" and "only transform and opacity" scans.

## Where the spec and the contract disagreed, and what was built

1. **Token home.** MOTION_CONTRACT puts `--task-*` and `--warning-*` in `patterns/motion.css`; DD-226 and the brief say one shared file. They are in `theme/pattern-tokens.css`; `motion.css` only reads them. There is no `motion.js`: its jobs (dwell queue, count throttle, arm guard, toast hold, `html.rm` sync) are in `pattern.js`.
2. **State names (spec wins).** `done-with-skips` (not `done-skips`); no `cancelled` state: a settled cancel is `done` (nothing written) or `done-with-skips` with `data-task-cancelled`. `data-step-state` (not `data-at`), `data-task-state` on the bar (not `data-state`), `data-pattern-severity` with five levels (the contract had two).
3. **Cancel unsafe.** The contract disables Cancel in place (`aria-disabled`, 0.55 opacity); DD-224 says hidden with a reason. Built hidden; the reason line takes its slot (same row, no layout shift: checked). During `cancelling` Cancel stays visible and `aria-disabled`, as the contract says.
4. **Paused.** The contract's T3 pauses "on the person" with a question card; DD-230 says a question is a confirm step. `task.block()` accepts only offline, other-tab and background. T3's motion is kept for those.
5. **Alertdialog on the shell.** Spec 8 puts `role="alertdialog"` on `pattern-warn-root`. The confirm turns into the progress card in the same dialog (T1), so a shell outlives both bodies: `pattern-dialog` (new part) carries the role, `aria-modal`, the label and the description; `pattern-warn-root` is the content group inside. After the swap the role becomes `dialog`.
6. **Result "replaces the progress card in place"** (spec 4.5) versus "below the bar" (contract T5). Built as the contract: steps and bar stay as a record (the failed step and the failed share are visible), the live actions go, the result card sits below, the status line becomes screen-reader-only so the sentence is not shown twice.
7. **Spec 3.1's own copy breaks its own rule** ("each consequence has a count, size, name or time"): `warn.backup.partial.c1` and `warn.restore.nosafe` have none. The demo copy adds counts and a size (1 profile, 3 personas, 12 images; 148.0 MB). The keys in `pattern.js` are the spec's; the scenario copy is in `demo.js`.
8. **Live regions.** The contract gives the toast `role="status"`; the spec allows one live region. The toast is a labelled group; a visually hidden `role="status"` inside it announces step and state changes only.
9. **Tiers.** Spec 6.3's "not critical" parts are reach tier, not safe (above).
10. **New parts the spec does not list** (all in the registry fragment): `pattern-layer`, `-scrim`, `-dialog`, `-warn-action-secondary` (the .bin warning has three choices), `-warn-ack`, `-warn-caret`, `pattern-task-cancel-reason`, `-bar-sweep`, `-mark-badge`, `-step-icon`, `-step-count`, `-result-more`, `-result-code`, `-guidance`, `-retry`, `-close`, `-undo-import`, `-background`, `-resume`, `-task-toast(s)`, `-toast-line`, `-toast-open`, `-toast-dismiss`, `-toast-more`, `-toast-undo`, `pattern-mock-tag`.
11. **Severity separability.** Spec 6.5 left the number open. Proposal: caution and danger edges at least 60 apart in RGB (Deep Nexus 105, Origin Navy 74, Banana Cocoa 88). Shape and wording separate the levels as well.
12. **Floors added beyond the spec's table** for the geometry tokens the component rules read (icon, bullet, dot, indent, focus ring, ring width, opacities, shadows 64 px at most). They follow the spec's reasoning; none is a decision.

## Open for the main session

- The fixed numbers above (60 RGB distance; focus width 1-8 px; the new geometry bounds) are proposals.
- Banner for caution means the `.bin` leave-out warning (three choices) is shown as a sheet with caution severity, because it asks a question; a pure notice of the same facts would be a banner. Confirm that reading of DD-230.
- Restore offers no "keep going in the background" (it replaces data and must stay in front). The spec leaves it open.
- The grouped Undo window is settled by DD-253 (10 s from the result card, paused on hover or focus). The undo toast pauses only under a sheet (DD-244), not on hover.
- Touch: the toast hold pauses on `:hover` and `:focus-within`; the contract also names touch. Not verified on a touch device.
