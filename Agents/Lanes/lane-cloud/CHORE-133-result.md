# CHORE-133 result (Phase 3): translator one-sentence path inserts the source as text

**Status:** proposed status for lane A to apply: FIXED on the fork (fork-only), Gate 2 `[APPROVE]`, pending the independent doc-verifier pass on this report and the commit. The fix closes the single-sentence reparse only. A separate edit-display `innerHTML` site remains and is proposed as a new ticket below (`MC-718` 5). Short entry: [lane-cloud-records.md](../lane-cloud-records.md) (`MC-718` 4, 5).

## Question / ticket ask

`Agents/Roadmap.md`, "### CHORE-133": trace where the markup that reaches the `combineTranslation` single-sentence `node.innerHTML` assignment comes from, then insert it as text or sanitize it (`MC-245` 1 "File a ticket (Recommended)"; finding F4 of the security triage, ledger row 1408, left undecided by `MC-238`). The Roadmap's own TODO(evidence) for the file and line is answered below. Gate per the ticket: plan review and post-implementation review; sanitizer-output tests need jsdom and identity-sanitizer falsification (`MC-239`).

## Environment

- Fork: `/home/user/RisuTanium`, branch `lane-cloud`, HEAD `bae8761`. The investigation and verification ran at HEAD `4455c00` (their packets say so); HEAD changed afterwards. UNVERIFIED whether `translator.ts` differs between the two commits beyond what the diff below shows.
- Dirty tree when written (not part of this report): CHORE-139 (`src/ts/characters.ts`, `src/ts/globalApi.svelte.ts`, untracked `src/ts/characters.removeCharFolderPrune.svelte.test.ts`) and CHORE-09 (lorebook, triggers, `characterCards.ts`, `en.ts`, `LoreBookData.svelte`, related tests, untracked `loreKeys` files). Mine: `src/ts/translator/translator.ts` (modified), untracked `src/ts/translator/translateSingleSentenceText.test.ts`, and this report.
- Upstream: `kwaroran/risuai` at `f50b594`, read-only clone outside the repository (as reported by the investigation and the verifier).
- Linux container; Vitest with jsdom (`// @vitest-environment jsdom` in the new test). Scratch configs used `fs.strict=false` and lived outside the repository.
- Sources (session scratchpad `p3/c133/`, not repository paths): investigation `result.md`; independent verification `vfy/result.md`; plan `plan/plan.md` (Gate 1 editorial folded in: its "Gate 1 [EDITORIAL] folded in" section, confirmed by the doc-verifier); Gate 1 `g1/result.md`; implementation `impl/result.md`; Gate 2 `g2/result.md`.

## Findings

- **Sink located** (investigation, VERIFIED by the verifier): `src/ts/translator/translator.ts:506` before the fix, `node.innerHTML = sentences[0]`, in the `else` ("Single sentence") branch of the `db.combineTranslation` block (:480-510). Upstream has the same line (upstream `translator.ts:466`). This is F4 of ledger row 1408, not alert 45: alert 45 is `applyMarkdownToNode` (`parser.svelte.ts:1895`, already fixed on the fork by creating the span from `node.ownerDocument`). The verifier called the investigation's "REFUTED premise" wording only a F4-versus-alert-45 distinction, not a refutation of the ticket.
- **Source of the markup** (VERIFIED): not the translation API. The text is `getNodetextToSentence(node)` (`util.ts:687-719`) of the input `<p>`: entity-decoded `textContent`, with `del` as `~x~`, `strong`/`b` as `**x**`, `em`/`i` as `*x*`, other tags flattened. So `&lt;img src=x onerror=...&gt;` in a message becomes the literal string `<img src=x onerror=...>`, which `innerHTML` parsed as a live element. Message content can be character, user or LLM text; HypaV3 summaries and export text also pass through.
- **Effect** (EXECUTED, investigation repro A and the Gate 1 probe): `<p>&lt;img src=x onerror=alert(1)&gt;</p>` became `<p><img src="x" onerror="alert(1)" /></p>`, and `<p>a &amp;amp; b</p>` lost an entity level (`a & b` instead of `a &amp; b`).
- **No exploit shown in the app** (TRACED, not exploited): translated HTML is returned as a string and consumers sanitize or use text: `ChatBody.svelte` (then `trimMarkdown` DOMPurify, `parser.svelte.ts:801-812`), `characters.ts:332` (`sanitizeMarkdownSafe`), HypaV3 callers (summary bound as textarea `value=`; the verifier did not re-trace the textarea binding, the ledger marks it INFERRED). Hygiene and data-fidelity issue. The nodes live in an inert DOMParser document; ledger row 1408's Chromium probe did not fire `onerror` (reason INFERRED). Firefox, WebKit and Android WebView untested.
- **Lossless change** (VERIFIED by the verifier from source; EXECUTED by Gate 1 on ten inputs, pre versus post): `translateNodeText` reads only `node.textContent`, and `getNodetextToSentence` already carries formatting as markdown markers. Bold, italic and strike markers, span/a/code flattening, styled span, empty, whitespace-only, nbsp and the multi-sentence path were identical before and after. The only differences were the entity-img and `&amp;amp;` inputs, which are the intended fix.
- **Upstream:** same sink, no fix (investigation; the verifier confirmed upstream `translator.ts:466`). The fix is fork-only. `MC-175`: `translateHTML` returns an HTML string; no storage or `.bin` format involved.
- **Fix** (`git diff -- src/ts/translator/translator.ts`, one line):

```diff
-                        node.innerHTML = sentences[0];
+                        node.textContent = sentences[0];
```

## Scope limit: remaining edit-display `innerHTML` site

The fix closes the single-sentence reparse only. When a card's edit-display output differs from the translation, markup still goes through the edit-display `innerHTML` site (`translateNodeText`, `newNode.innerHTML = processedTranslated`, `translator.ts:452` at investigation time, after `processScriptFull(..., "editdisplay")`). `MC-718` 5 leaves it for a separate ticket.

Gate 1 [EDITORIAL] finding (EXECUTED on a scratch copy): with a `processScriptFull` that appends `<b>shown</b>`, the post-fix output for `<p>&lt;img src=x onerror=alert(1)&gt;</p>` still contained a real `<img onerror>`, because the edit-display branch re-parses the now-literal text as markup. The reproducers for this ticket therefore stub `processScriptFull` as identity so they isolate the single-sentence write.

**CHORE-500 (proposed): translator edit-display replacement writes translator output with innerHTML**

- Site: `src/ts/translator/translator.ts`, `translateNodeText` edit-display branch, `newNode.innerHTML = processedTranslated` (:452 at HEAD `4455c00`; line may have moved).
- Source of markup: translator or LLM output after `processScriptFull(..., "editdisplay")`, i.e. card regex and display scripts, which add markup on purpose (investigation repro B: `hi <img src=x onerror=alert(1)>` became a live `<img onerror>` next to the script's `<b>shown</b>`). Gate 1 showed it also re-injects markup from literal text that the CHORE-133 fix keeps as text, whenever the edit-display output differs from the translation.
- Downstream sanitizing: same consumers as above (`trimMarkdown` DOMPurify in chat, `sanitizeMarkdownSafe` in export). No sanitizer at the site; the document is the inert DOMParser one.
- Fix constraint (investigation opinion, not verified): text insertion cannot be used here because display scripts legitimately add markup; the option is a sanitizer with the chat policy (`trimPurifyConfig`), not `sanitizeMarkdownSafe`, which strips links, style and classes. `MC-239` jsdom plus identity-sanitizer falsification would then apply.
- Decision needed from the maintainer; not filed by this report.

## What changed and evidence

- Changed: `src/ts/translator/translator.ts` (1 line) and the new, untracked `src/ts/translator/translateSingleSentenceText.test.ts` (jsdom, real `translateHTML`, `processScriptFull` identity). `translateHtmlOwnerDocument.test.ts` untouched.
- Test titles (`describe('translateHTML single-sentence paragraph')`):
  - `keeps an escaped tag as literal text instead of creating an element` (regression reproducer)
  - `keeps an escaped ampersand entity as literal text` (regression reproducer)
  - `keeps bold and italic markers in a single-sentence paragraph` (compatibility guard)
  - `still splits a multi-sentence paragraph into spans separated by breaks` (compatibility guard)
- Pre-fix (executed by the implementer on unmodified `translator.ts`): 2 failed, 2 passed; the escaped-tag case failed at the intended assertion (`<img src="x" onerror="alert(1)">` found), the ampersand case received `a & b`, expected `a &amp; b`. Gate 2 reproduced both against pre-fix `translator.ts`.
- Post-fix: `npx vitest run src/ts/translator`: 5 files, 39 tests passed (implementer; Gate 2 reran). `NODE_OPTIONS=--max-old-space-size=8192 pnpm check`: 0 errors, 0 warnings (implementer and Gate 2).
- No sanitizer was added, so no identity-sanitizer falsification applies (`MC-239`); the assertions are structural under jsdom.

## Gates

- Gate 1 (adversarial-reviewer, ledger row 5051): `[EDITORIAL]`: lossless on ten inputs; reproducers must stub `processScriptFull` as identity; scope wording "single-sentence reparse only". Folded into the plan.
- Gate 2 (adversarial-reviewer, ledger row 5055): `[APPROVE]`. One-line diff, edit-display site untouched. Mutants: `innerText` caught (jsdom has no `innerText`, so an incidental catch); multi-sentence-only fix caught (equals pre-fix); `textContent` plus `innerHTML = innerHTML` passes, a semantic no-op round trip rather than a real mutant.
- Ledger rows: 5045 investigation, 5049 verification, 5051 Gate 1, 5054 implementation, 5055 Gate 2; this report 5056.
- Full `pnpm test` was not run; the phase close will run it. UNVERIFIED whether the full suite is affected. No build run.

## Residuals

- Edit-display `innerHTML` site: CHORE-500 (proposed) above.
- Firefox, WebKit and Android WebView behaviour of the original sink untested.
- Visible effect, from the investigation (INFERRED, not run): users who type entity-escaped tags now see them as text after translation, as they do without `combineTranslation`.
- HypaV3 textarea binding not re-traced by the verifier.

## Decisions

`MC-718` 4 and 5 (answers quoted exactly as recorded in [lane-cloud-records.md](../lane-cloud-records.md)):

4. CHORE-133, the one-sentence translator path that writes the source text back with `innerHTML`. Answer: **"Insert as text (Recommended)"**: use `textContent`.
5. CHORE-133, the edit-display replacement that writes translator output back with `innerHTML`. Answer: **"Leave it, separate ticket (Recommended)"**: out of this ticket; to be filed as a new ticket (proposed in the CHORE entries).

Related: `MC-245` 1, `MC-238` (F4), `MC-239`, `MC-175`, `MC-091`.

## Citation mismatches

- The Roadmap says the assignment's file and line were not in the sources; the real site is `translator.ts:506` at investigation time (now one line of the diff above). Reported, not a code defect.
- Ledger row 1408 is cited by ID; the verifier found it at `Investigation-Ledger.md` line 1449 (ID, not line). Row 1408's `applyMarkdownToNode` sink is alert 45, not this ticket's F4 sink.
- The investigation packet duplicates a `vi.mock` of the parser in its scratch repro (harmless, verifier note).

## Corrections from doc-verifier

This section takes precedence over the body above. Independent doc-verifier pass, 2026-10-23 (scratchpad `p3/c133/dv/result.md`, ledger row 5057): 15 of 20 claims VERIFIED; corrections applied by the Orchestrator:

1. Ledger row 5056 (this report) now exists; it did not when the report was drafted. The verification is row 5057.
2. `git diff 4455c00 bae8761 -- src/ts/translator src/ts/util.ts` is empty, so the investigation's citations hold at `bae8761`; the HEAD-drift UNVERIFIED note is resolved.
3. Gate 1 label: the reviewer's hand-back gave `[EDITORIAL]`; its result file calls the test issue "BLOCKING for the plan's test". That issue was a fix to the plan's test (stub `processScriptFull` as identity), folded into the plan before implementation.
4. The Gate 2 pre-fix run (2 failed, 2 passed) and mutant results are as reported by the Gate 2 reviewer; the doc-verifier did not rerun them.
5. The plan was confirmed to contain the folded-in Gate 1 section; the "not re-read" note is superseded.
6. The CHORE-133 entry and the proposed CHORE-500 entry are now in `Agents/Lanes/lane-cloud-records.md`.
