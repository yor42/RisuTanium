# Deferred items — TBD for real implementation

Updated 2026-10-17. Scope: items from the 2026-10-17 UX reviews that the mockups **did not fix, only partly fixed, or deliberately left**. Everything here is **TBD** for the main session's real implementation. Nothing below is an approved product decision or a claim about native-app behavior. The mockups are synthetic; production editor, storage, parser, VM, plugin loader and provider behavior remain separately owned.

Sources: fix logs [Studio](reviews/fixes-2026-10-17-studio.md), [Home](reviews/fixes-2026-10-17-home.md), [Onboarding/Startup](reviews/fixes-2026-10-17-onboarding-startup.md); re-reviews [Studio](reviews/2026-10-17-studio-rereview.md), [Home/Onboarding/Startup](reviews/2026-10-17-home-onboarding-startup-rereview.md); original findings [UX review](reviews/2026-10-17-mockups-ux-review.md) and [other-mockups review](reviews/2026-10-17-other-mockups-ui-ux-review.md). Task state: [tasks/2026-10-17-apply-review-fixes.md](tasks/2026-10-17-apply-review-fixes.md).

Status words: **TBD** = not designed or not built in the mockup; **TBD (partial)** = mockup shows a first slice; **Decision TBD** = needs a maintainer choice before implementation.

## 1. Studio (editor, lifecycle, language services)

| ID | Item | Mockup state | Real-implementation note (TBD) |
|---|---|---|---|
| ST-02 | Relative-indent preservation on paste | Not built | Behavior of paste reindent per language TBD; CBS output-sensitive whitespace must not change silently. |
| ST-02 | Delimiter pairing / matching | Not built | TBD; should share the same lexical state as highlighting and completion. |
| ST-02 | Comment toggle for a selection | Not built | TBD per language (Lua `--`, JS `//`, CBS has no line comment form — confirm). |
| ST-02 | Indent defaults per language (tabs vs spaces, width) | Spaces, 2 | **Decision TBD.** Mockup default is a placeholder. |
| ST-04 | Tab-through of second and later template fields; signature help while typing arguments | Caret goes to first field only | TBD. |
| ST-05 | Replace preview, outline / symbol navigation, definition/reference navigation, cross-file search | Find/Replace, go-to-line and F8 problem navigation only | TBD; cross-file search depends on the document model (see ST-06 below). |
| ST-06 | Multiple named documents with owner/scope (global plugin vs character/module script), independent history, round trip to target | Synthetic scratch documents only | **Decision TBD:** single target vs multiple named documents; user-facing owner/scope wording. |
| ST-07 | Selectable "Review fixes" for Apply all (aggregate patch review, one reversible step) | Per-fix previews and full-diff toggle; Apply all still one undo step | TBD. Permission changes must stay excluded from any fix. |
| ST-10 | Off-main-thread / incremental analysis; supported file-size envelope; p95 key-to-text target | Debounced, IME-aware, stale revisions ignored; main thread | **Decision TBD:** supported script size and device envelope. Mockup timings (headless Chrome, one machine) are not a device or p95 figure. |
| ST-12 | Screen-reader authoring sequence, real forced-colors/high-contrast, text enlargement, announcements policy | Roles, live regions, focus ring, reduced-motion and forced-colors rules in CSS | TBD: verify with assistive technology in the real editor. |
| ST-13 | Real Lua/JS syntax and API-signature diagnostics; simulated thrown error with stack-to-source jump; Stop/timeout and empty-output states; revision-labeled test results | Scoped "not checked / not run" statuses only; Test is a simulated action | TBD. Header validation, language diagnostics and test results must stay separate; legacy `checkCodeSafety` is not a v3 validator (see audit caveat). |
| ST-03 | Reload recovery / durable draft, save/apply/activation semantics, conflicting-save state | Save draft, modified/stale markers, simulated failure + retry, leave prompts; in-memory only | **Decision TBD:** storage format, recovery, "Apply to target / Activate" semantics. Owned by existing persistence/execution owners. |
| — | Live rule scan vs explicit Check stamp | Mockup keeps both: live scan plus Check action | **Decision TBD.** |
| — | Test as an action rather than live preview | Action | **Decision TBD.** |
| — | Fourth phone view "Examples"; Examples pane collapsed at 821–1439 px | As built | **Decision TBD** (layout preference). |
| P3-03 | Replace an unmodified document from an example with one click and no confirmation | Undoable with toast | **Decision TBD** (maintainer call). |
| P3-06 | Typing-burst undo coalescing (edits within ~1 s merge) | By design | **Decision TBD:** coalescing window; likely governed by the real editor's history model. |
| — | JS regex literals and `${}` inside template literals not tokenized | Not built | TBD; use the real language service, not the mockup tokenizer. |

**Integration seam (proposal, unchanged from the UX review):** reuse the established editor path (`src/lib/Others/MonacoEditor.svelte`, `PopupEditor.svelte`; language services `src/ts/gui/codearea/cbsMonaco.ts`, `luaMonaco.ts`; header/API `src/ts/plugins/pluginListMerge.ts`, `apiV3/risuai.d.ts`) instead of porting the textarea overlay. Most of the editor items above are expected to come from that stack; confirm desktop/mobile suitability with acceptance evidence first. Run the real CBS parser, Lua VM and plugin loader in the main session before treating any mockup rule as authority.

## 2. Home

| ID | Item | Mockup state | Real-implementation note (TBD) |
|---|---|---|---|
| UX-01 | Studio return route and target contract | Home links to `studio.html?from=home&mode=..&return=<home url>`; Studio accepts only same-folder relative `home.html…`; draft parked in `sessionStorage` | **Decision TBD:** real route, target (global plugin vs character/module), and draft-preservation mechanism. `?from=home` is a mockup proposal, not an agreed contract. |
| — | First-run Home with no characters, tasks, or model/key | Not built | TBD; Home-owned fixture. |
| — | Header/stacking breakpoints (1040 px header, 860 px stack, 520 px compact list) | Measured against English text only | TBD: re-measure with long localized labels and text enlargement. |
| — | Tasks lists stopped results under "Stopped or finished" | Grouped | **Decision TBD:** retention rules, filters. |
| N-1b | Replace draft cannot be undone | Distinct warning styling only | **Decision TBD:** add undo or confirmation? |
| N-2 | Long persona name ellipsized with tooltip | As built | TBD for localized names and touch (no hover). |
| — | Floating "Mockup controls" button overlaps content on short phone viewports | Old mockup-only overlay | Not part of the product; ignore in integration. |

## 3. Onboarding and Startup

| ID | Item | Mockup state | Real-implementation note (TBD) |
|---|---|---|---|
| — | Whether a restored backup ends first setup (`didFirstSetup`) | Mockup treats restore success as ending setup | **Decision TBD** (STARTUP_AND_ONBOARDING.md decision 4). |
| — | Cancel-and-discard in the Review edit loop | None; choices apply as made, only exit is "Save and return" | **Decision TBD.** |
| N-5 | Keyboard-selected provider stays expanded on phones (long list) | Documented behavior | TBD; revisit if a better accessible pattern is chosen. |
| — | Restore: real file picker, corrupt/incompatible backup parsing, failure/retry | Synthetic outcomes (ok / incompatible / cancel) via a mockup-only control | TBD; real parsing and storage are separately owned. |
| — | Header "restart" mock control can reset mid-restore | Mockup control only | Not part of the product. |
| — | HTML boot fixture vs real boot component | Fixture aligned to `NexusBootScreen.svelte` contract | TBD: verify notice/failure focus and speech in the real component. |
| — | Reduced motion in Onboarding; Startup CSS media rule not emulated (JS branch only) | Partly checked | TBD. |
| V-05 | Memory budget labels (context/reply tokens, "Unlimited (a 100,000-token preset)") | Presentation only | **Decision TBD** on final preset names and values; do not imply permanent recall or verified pricing. |

## 4. Cross-cutting: not verified in any mockup pass

Screen-reader speech, real Korean IME composition (only simulated), real touch and virtual keyboard, forced-colors hardware, text enlargement/zoom above 100%, low-power on Onboarding, contrast measurement, browsers other than Chrome/Chromium, Tauri/WebView, large (5,000-line) paste, persistence durability, provider interoperability, production performance. Fix-pass checks were run by the authoring agents in headless Chrome and re-checked by independent reviewers; the parent re-ran only a single smoke view.

## How to use this list

Before implementing a screen, look up its rows here, resolve each **Decision TBD** with the maintainer, and carry unresolved items into the integration plan in [HANDOFF.md](HANDOFF.md). Remove a row only when the real implementation has been built and verified, not when the mockup changes.
