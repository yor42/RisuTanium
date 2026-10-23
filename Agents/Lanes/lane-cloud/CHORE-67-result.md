# CHORE-67 result: which tests trust DOMPurify output under happy-dom

**Status:** proposed CLOSED (`MC-705`); technically accepted at Gate 2 (`[EDITORIAL]` on a stale comment, closed `[APPROVE]` after rewording; ledger row 5011). Commit `b53a67b` on `lane-cloud`. Administrative closeout is the Roadmap owner's (lane A fold-in). Short entry: [CHORE-67 in lane-cloud-records.md](../lane-cloud-records.md); decisions `MC-705`, `MC-706` are in the same file and are not repeated here.

## Question / ticket ask

`Agents/Roadmap.md`, "### CHORE-67" (status 2026-10-02, open, not scheduled), "What the ticket asks (the option text the maintainer selected)": "find which existing tests rely on DOMPurify removals under happy-dom and make them trustworthy." The Roadmap entry's blast-radius line says TODO(evidence): not counted. The entry predates `MC-238` 4 / `MC-239`.

## Environment

Linux container, Node 22.22.0, 4 CPUs, machine loaded by other lanes; repository `/home/user/RisuTanium`, branch `lane-cloud`. Survey base `9a6127354`; the verifier ran at HEAD `f697c20` and found the only `src` difference since the base is the test fake `src/ts/storage/tests/tauriChunkFake.ts` (session scratchpad `c67/verify/result.md`). Timings are indicative only and are not evidence for the Note 9 or Pi targets. All scratchpad paths below are the session scratchpad (`/tmp/claude-0/-home-user-RisuTanium/fdce1fd0-b592-51b6-b636-a27a87425761/scratchpad/`), which is not a repository path and will not persist.

## Findings

Method (RUN, scratch only): `dompurify` aliased to a stub in a scratch vitest config (`c67/vitest.c67.config.ts`, `c67/stub.mjs`), in modes record (real library, records each call), identity (returns input) and empty (returns empty output). The stubs and configs are not in the repository.

1. **No happy-dom test depends on a sanitizer removal. REFUTED premise ("may pass for the wrong reason" for removal assertions).** Identity stub on the 23 happy-dom files that call the sanitizer: 0 files fail, 453/453 tests pass (session scratchpad `c67/result.md`; re-run by the verifier, `c67/verify/result.md` claim 1). RUN.
2. **Calls to the real sanitizer: 40 test files, 23 happy-dom and 17 jsdom.** Whole-suite recording run, 937 files passed, 21,007 tests passed, 29 skipped, 1366 s, excluding `Agents/**`, `**/.claude/**`, and two store2 files (`store2/replay/actors.test.ts`, `store2/saveLoop.test.ts`). "Call" means a `sanitize` call or, for `MainMenu.disclosureCard`, the `createDOMPurify` factory call at import; it does not mean "imports the parser" (verifier correction below). RUN; counts re-verified from the record directory.
3. **Identity stub on all 50 files (the 40, plus jsdom-pragma files, union 50): 676 tests, 28 failed, in 10 files, all 10 carry the jsdom pragma.** 27 files carry `@vitest-environment jsdom`; 17 of them are among the 40, and 10 of the 27 mock the sanitizer or never call it (`c67/result.md`). Per-file lists and the 28 failing test names are in that file. Re-run by the verifier with the same per-file counts. RUN.
4. **Seven jsdom files that call the sanitizer pass under the identity stub** (they assert no removal), e.g. `characters.exportChatNames`, `descriptionMarkdown`, `assetMarkupUrl`, `assetSrcSanitize`, `inlayRender.markup`, `inlayRender.readOnce` (investigator's list is "e.g."; `c67/result.md` table rows with 0 failing tests, class J). Whether they should assert a removal is a test-quality question outside this ticket. UNCERTAIN as to need; the observation itself is RUN.
5. **Two happy-dom tests assert that sanitized text survives** (empty-output stub probe, 2 of 453 fail; the other 21 happy-dom files pass even with an empty sanitizer):
   - `src/lib/Others/GridCatalog.coldStub.svelte.test.ts`, "the list layout still shows the en section when a long text precedes it in the description" (asserts `toBe('English description')`).
   - `src/ts/parser/tests/parserTarget.svelte.test.ts`, "Display: ParseMarkdown reads the selected chat, never a target (guard) ParseMarkdown of a message with {{getvar}} reads the selected chat's variable" (`toContain` `a-value`/`b-value`).
   The verifier confirmed from source that `parserTarget` asserts on `ParseMarkdown`'s returned string, and that the GridCatalog description is rendered through `{@html html}` in `CharacterDescription.svelte`, read through `textContent`. The "empty stub fails exactly 2 of 453" figure was NOT independently re-run by the verifier (source reading supports it). TRACED / RUN as stated.
6. **Under happy-dom DOMPurify reported a removal on every call** (calls equal removals in all 23 happy-dom record files, verifier claim 5; examples 65/65 and 27/27). VERIFIED as an observation from the record JSON. The cause is interpretation and is not established here. (The investigator's own caveat text says "all 20 happy-dom files with calls"; the verifier's check covers all 23. That small difference is unreconciled; the 23 is the verified figure.)
7. **Moving all 23 happy-dom files to jsdom is not viable as is:** scratch copy, 453 tests, 6 failed in 3 files (`AlertComp.focusBox`: 2 inert/focus tests; `charlistAvatarLazy`: 2; `charlistAvatarLookups`: 2). The causes were not diagnosed. UNCERTAIN (cause).
8. **Excluded files, corrected:** the survey first said `actors.test.ts` and `saveLoop.test.ts` "import only store2 modules". That is wrong: both reach `parser.svelte.ts` and `v3.svelte.ts` transitively through static imports. The verifier ran both with the recording stub and the exclusion removed: no record file was written, so zero sanitizer or factory calls (executed, both files with the 10 unrelated failing tests noted in the records file; about 525 s).
9. **Unstubbed copy:** Monaco's vendored `dompurify.js` under `node_modules/monaco-editor` is a separate copy that the alias does not cover and the app's sanitizing does not use. The app imports `dompurify` in exactly 4 non-test files (`parser.svelte.ts`, `hubHtml.ts`, `v3.svelte.ts`, `PluginDefinedIcon.svelte`), all by bare specifier (verifier).

## What changed and evidence

Commit `b53a67b`: `git show --stat` is 3 files, 48 insertions and 7 deletions, which includes the records file (39 lines). Test diff only:

- `src/lib/Others/GridCatalog.coldStub.svelte.test.ts`: pragma `happy-dom` changed to `jsdom` (1 line).
- `src/ts/parser/tests/parserTarget.svelte.test.ts`: `// @vitest-environment jsdom` added; the header comment reworded, because it still said the file ran "under the project's default (happy-dom) environment" (Gate 2 editorial finding). No other line changed.

Evidence:

- Real DOMPurify under jsdom, the two files: 26/26 (implementer twice, `c67/impl/result.md`; Gate 2 reviewer once, `c67/g2/result.md`). Scratch-copy survey figures before the change: GridCatalog.coldStub 18/18, parserTarget 8/8 (`c67/result.md`).
- Empty-output stub under jsdom (jsdom confirmed in the per-file JSON): 2 failed, 24 passed; the failures are `expected '' to be 'English description'` and `expected '' to contain 'a-value'`. Identity stub: 26/26, so an identity sanitizer cannot falsify these preservation tests (MC-239 asks that falsifiability be proven; the empty stub is the falsifier used).
- Per-test outcome, HEAD (happy-dom, `git archive` copy) against the working tree (jsdom): 26/26 same status, 0 differences (Gate 2).
- `pnpm check`: 0 errors, 0 warnings, with an 8192 MiB heap (implementer and Gate 2).
- Gate 2: `[EDITORIAL]` (stale comment); closed `[APPROVE]` by the same reviewer, resumed, after the comment was reworded; the comment-only diff was checked against `trimMarkdownStyle.test.ts` (jsdom, real `../parser.svelte`, plain-object `DBState`) and `cbs/conditionals.test.ts`.
- `GridCatalog.coldStub`'s only happy-dom-specific code is a `clientWidth` override that still applies under jsdom. Provenance: the Gate 2 reviewer's hand-back message and the claim verifier's source reading, not a result file (the `c67/g2/result.md` scratch file has no such line).
- The orchestrator's 8/8 rerun of `parserTarget` after the rewording has no kept log; the claim verifier's rerun after the rewording passed both files 26/26 (records file, row 5012; the verifier's summary is `c67/cv/result.md` in the session scratchpad, saved by the orchestrator from the returned message).

## What was not done / residuals

- The 21 other happy-dom files stay on happy-dom: their assertions do not read sanitized content (empty-stub run).
- Sanitizer assertions in the seven jsdom files that pass under identity are untouched (finding 4).
- The 6 jsdom-only failures of the move-all run are not diagnosed.
- The store2 `actors`/`saveLoop` files were excluded from the recording run; reach was settled by a separate executed check (finding 8), not by the whole-suite run.
- Full `pnpm test` was not run for this change (test-only pragma edits; the lane's full suite was running separately). The final full-suite result on the final Phase 1 snapshot, run by the orchestrator, is in the records file (Phase 1 close).
- The Roadmap entry's status (still "open, not scheduled", 2026-10-02) was not edited; the proposed status is in the records file.
- The commit-claim verification file `c67/cv/result.md` exists in the session scratchpad; it was saved by the orchestrator from the doc-verifier's returned message (the agent returned it as a message only), so it is a summary in substance, not a verbatim transcript.

## Decisions

`MC-705` (move the two preservation tests to jsdom), `MC-706` (commit with the records after Gate 2, without asking again), related `MC-238` 4 and `MC-239` 1. Full text: [lane-cloud-records.md](../lane-cloud-records.md). Ledger rows 5008 to 5012 are there too.

## Corrections from doc-verifier

This section takes precedence over the body above. Seeded from corrections already issued on the underlying evidence.

From the survey verification (session scratchpad `c67/verify/result.md`, ledger row 5009):

1. "Reach" means "calls the sanitizer or the `createDOMPurify` factory", not "imports". The recorder writes only on such a call. (Applied in the body.)
2. Replace the survey's "not exhaustively proven" import statement for the two excluded files: transitive static reach to `parser.svelte.ts` and `v3.svelte.ts` exists; runtime sanitize calls are 0, by execution in a scratch configuration with the exclusion removed. The survey's "import only store2 modules ... not parser" wording was wrong or incomplete. (Applied in finding 8.)
3. Not independently re-run by the verifier: the empty-stub figure of 2 failing tests in 453. Source reading supports it. (Stated in finding 5.)
4. Monaco's vendored `dompurify.js` is a separate unstubbed copy and is not app output. (Finding 9.)

From the commit and records claim verification (session scratchpad `c67/cv/result.md`, saved by the orchestrator from the verifier's returned message; ledger row 5012). 26 claims: 23 VERIFIED, 2 INCOMPLETE, 1 UNVERIFIABLE (token figures), 0 WRONG, 0 STALE. Spot run after the rewording: `GridCatalog.coldStub` and `parserTarget`, 2 files, 26/26 passed (35.5 s). All corrections were applied before commit `b53a67b`:

5. The post-rewording rerun now cites the verifier's own run (both files, 26/26), not an unlogged orchestrator rerun. (Applied above.)
6. The `clientWidth` claim is attributed to the reviewer's hand-back message and the source reading. (Applied above.)
7. INCOMPLETE 1: "`GridCatalog.coldStub`'s only happy-dom-specific code is a `clientWidth` override, which still applies under jsdom" is supported by source (the only happy-dom mention is the comment above `Object.defineProperty(HTMLElement.prototype, 'clientWidth')`), but was attributed to the reviewer while `c67/g2/result.md` does not contain it. Corrected attribution applied above.
8. INCOMPLETE 2: the orchestrator's post-rewording "8 of 8" rerun has no kept log; the verifier's 26/26 run covers the outcome. Applied above.
9. Optional clarification: `MC-239`'s "18 files" and this survey's 40 count different things (MC-239's figure comes from an earlier stub-sanitizer run after `76af9bba`; this survey counts files that call `sanitize` or the factory in a whole-suite recording run on `9a6127354`, both environments). The method and date differ; neither number corrects the other.
