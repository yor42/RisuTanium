# CHORE-09 result (Phase 2): items 4, 9, 10, 11 reproduced, item 7 traced

**Status:** proposed status for lane A to apply: items 4, 9, 10 and 11 REPRODUCED with `test.fails` reproducers and maintainer decisions (`MC-710`); item 7 TRACED with a decision, reproducer deferred to the fix. No application code changed. Items 1, 3, 5 and 6 were done on 2026-10-03, item 2 was already fixed on the fork and item 8 is moot after CHORE-14; none of these is covered here. The reproducers are in two new test files. Short entry: [lane-cloud-records.md](../lane-cloud-records.md) (`MC-708`, `MC-709`, `MC-710`).

## Question / ticket ask

`Agents/Roadmap.md`, "### CHORE-09". Phase 2 (`MC-708`) covers the open items 4, 7, 9, 10 and 11. For each: trace, reproduce or refute; compare with upstream (`MC-069`); put product questions to the maintainer; change no application code.

## Environment

- Fork: `/home/user/RisuTanium`, branch `lane-cloud`, HEAD `9ded0aa`. Only dirty path at the start and end of the investigation: `Agents/Lanes/lane-cloud-records.md` (not part of this work). The two reproducer files are untracked.
- Upstream: read-only shallow clone of `kwaroran/risuai` at `f50b5942` (2026-10-23), outside the repository.
- Linux container, Vitest 4.1.11, happy-dom. Mocks: CBS parser is an identity stand-in, the tokenizer is a character count. These show the matching and merge logic only.
- Scratch is outside the repository (session scratchpad `p2/c09/`). It is not a repository path.
- Sources: investigation `p2/c09/result.md`; independent verification `p2/c09/verify/result.md`; test-warrior `p2/c09/tw/result.md` and `tw/mut.log`; Gate 2 `p2/c09/g2/result.md`, verdict [EDITORIAL].

## Findings

Summary table (verdicts as reported by the investigation and confirmed by the verifier unless stated):

| Item | Verdict | Fork location | Upstream (MC-069) | Reproducer |
|---|---|---|---|---|
| 4 | REPRODUCED | `src/ts/process/triggers.ts:2174-2227` | UPSTREAM-SAME (upstream `triggers.ts:1979-2035`; fork adds `markWrite`) | 3 `test.fails` |
| 7 | TRACED | `src/ts/process/scripts.ts:374-391` | UPSTREAM-DIFFERENT | none (deferred) |
| 9 | REPRODUCED | `src/ts/process/lorebook.svelte.ts:244-293` | UPSTREAM-SAME | 2 `test.fails` |
| 10 | REPRODUCED (reframed) | `src/ts/process/lorebook.svelte.ts:684-729` | UPSTREAM-SAME (upstream `:612-645`) | 1 `test.fails` |
| 11 | REPRODUCED | `src/ts/process/lorebook.svelte.ts:210-227` | UPSTREAM-SAME (upstream `:145-160`) | 3 `test.fails` |

### Item 4: five deprecated V2 lorebook effects (REPRODUCED)

- **Verified fork location:** `triggers.ts:2182,2192,2207,2224` use `char.globalLore.findIndex((v) => v[0] === target)` and `[index][1]` / `[index][2] = value`. `globalLore` holds `loreBook` objects (type at `src/ts/storage/database.svelte.ts:1368`), so `v[0]` is `undefined` and the index is always -1. The activation case calls `markWrite()` at `triggers.ts:2217-2218`.
- **Observed (executed, real `runTrigger`, two entries):** `v2GetLorebook` by comment or key gives `'null'`; `v2GetLorebookEntry` index 0 gives `'null'`; `v2GetLorebookIndexViaName` gives -1; `v2ModifyLorebook` changes nothing; `v2GetLorebookCount` gives 2 and works. `v2SetLorebookActivation` in range sets an own property `"2": true` on the lore entry. Out of range it throws `TypeError: Cannot set properties of undefined (setting '2')`.
- **Added by the verifier:** a non-numeric index (NaN) also throws.
- **Upstream:** the same `v[0]` and `[index][2] = value` code, without `markWrite` (verified).
- **What a card author sees today:** the five effects do nothing or answer `null` / -1, so existing cards already cope. The activation effect never changes activation. INFERRED: nothing reads `[2]` (the verifier did not find a reader but did not check exhaustively).
- **Decided behaviour, `MC-710` 1:** "Inert, no junk write". Keep returning null / -1 as today; stop the stray `"2"` write and the throw.
- **Reproducers**, in `src/ts/process/tests/triggerLegacyLorebook.test.ts` (2 guards, 3 `test.fails`):
  - `guard: the lookups answer null / -1, the modify changes nothing and the count works`
  - `guard: the activation effect leaves the entry content and always-active flag unchanged`
  - `regression reproducer: the activation effect writes no stray key onto a lore entry`
  - `regression reproducer: the activation effect does not throw for an out-of-range index`
  - `regression reproducer: the activation effect does not throw for a non-numeric index`
- **Residuals:**
  - PERSISTENCE-RISK (minor), for lane A: the stray numeric key `"2"` is probably saved into the character's `globalLore`. INFERRED from `markWrite`; not executed.
  - `src/lib/.../TriggerV2List.svelte` still offers these effects in the trigger editor (verifier cites lines 141, 145, 792, 827). Observation only. No decision was taken on hiding them (the chosen option keeps them inert).

### Item 7: `@@inject` with no subject (TRACED)

- **Verified fork location:** `scripts.ts:374-391`; the else-branch at `:386-390` does `db.characters[get(selectedCharID)].chats[chatPage].message[chatID].data = data`. `refPass` is defined at `:246`. The branch has no bounds check and no `subject.mark()`; only the `refPass` branch marks (verifier, VERIFIED).
- **Callers, non-test (10 sites, verified by grep):**
  - Fallback reachable: `src/ts/parser/parser.svelte.ts:772` (`editdisplay`, main live path), `src/ts/translator/translator.ts:433`, `src/lib/Others/HypaV3Modal/utils.ts:104`, and `src/ts/plugins/apiV3/v3.svelte.ts:1099`.
  - Correction applied (verifier): the v3 caller uses the selected character and bounds-checks `messageIndex` against that chat, so it stays within the selection. The packet's "may differ from the selected one" was wrong for this caller.
  - Subject passed but no `messageRef`, `chatID` -1, so inject is inactive: `src/ts/process/index.svelte.ts:1313`, `sendCharacterMessage.ts:42`.
  - Subject plus reference (owner-resolving path): `index.svelte.ts:1361`, `:2187`, `:2371`, `:2377`.
- **Upstream: UPSTREAM-DIFFERENT.** Upstream has only the selected-character branch (`scripts.ts:207-208`). The fork added the subject/reference branch, so the fallback is the upstream behaviour for callers that were never plumbed.
- **What a card author sees today:** an `@@inject` script run in display or translation mode writes the script-processed text (before the match is stripped) into the stored message of the selected character's current chat page. When the viewed chat is not the selected chat (another character, a group member), it writes to the wrong place or throws a TypeError.
- **Decided behaviour, `MC-710` 2:** "Plumb the owner". Pass the owning character and message through the display parser, the translator and the HypaV3 modal utils so `@@inject` always hits the right chat. Larger change; touches the parser.
- **Reproducer: none.** Not executed in the investigation. Gate 2 judged the omission justified: a test needs the decided owner-plumbing API (callers and signature), which does not exist yet, so any test now would pin an invented interface. The reproducer is deferred to the fix. Investigation sketch (not run, UNVERIFIABLE per verifier): run `processScriptFull` on a character whose custom script is `{in:'x', out:'@@inject', type:'editdisplay'}` with `selectedCharID` pointing at another character, and assert the other character's message is untouched.
- **Residuals:** which of the three callers named in the decision (plus the plugin v3 caller, which stays within the selection) need a signature change is TODO(evidence), to settle in the fix plan. Cards that rely on display-mode inject writing to the selected chat will change behaviour.

### Item 9: `risu_case_sensitive` (REPRODUCED)

- **Verified fork location:** plain keys and the message are both lowercased in `lorebook.svelte.ts:244-293`; regex flags come only from the `/pattern/flags` text at `:213-221`. The typed field is `extentions?: { risu_case_sensitive: boolean }` on `loreBook` (`database.svelte.ts:1377-1379`). The flag is only written and read for round-tripping in `src/ts/characterCards.ts`.
- **Correction applied (verifier, required 1):** the packet's `characterCards.ts:1207,1628,1177` were upstream line numbers. Fork lines: write at 1576, reads at 1606 and 2037 (type at 1598 and 2029).
- **Observed (executed):** key `Dragon`, message `a DRAGON here`: activated 1 with the flag false and 1 with it true. A regex `/Dragon/` without an `i` flag activates 0 in both cases.
- **Fork UI:** there is no "Case Sensitive" control (verified: grep of `src` svelte files and `en.ts` finds none). The existing wiki page `docs/wiki/Lorebook.md` line 37 lists one; see Wiki hand-off.
- **Upstream: UPSTREAM-SAME.** No matcher reader in upstream; only the import/export in `characterCards.ts` (upstream `:1177,1207,1628`).
- **What a card author sees today:** all plain keys are case-insensitive; the flag changes nothing. After a fix, entries imported with `case_sensitive: true` stop firing on text of a different case. Only explicitly flagged entries change.
- **Decided behaviour, `MC-710` 3:** "Honour it + UI toggle". Plain keys match case-sensitively when the flag is true; regex keys keep their own flags; add a per-entry toggle in the lorebook editor (new UI, translator work).
- **Reproducers**, in `src/ts/process/tests/lorebookKeyMatching.svelte.test.ts` (tests set `extentions.risu_case_sensitive`, which is what card import produces):
  - `guard: without the flag a plain key matches regardless of case`
  - `guard: with the flag a plain key still matches text in the same case`
  - `guard: a regex key keeps its own flags whatever the flag says`
  - `regression reproducer: with the flag a plain key does not match text in another case`
  - `regression reproducer: with the flag a lower-case plain key does not match capitalised text`
- **Residuals:** interaction of case-sensitive plain matching with the whitespace-stripping substring match (`:276-279`) is untested. Gate 2 limit: only the typed `extentions` field was checked; UI and other writers were not.

### Item 10: `@@inject_lore` and the token budget (REPRODUCED, reframed)

- **Premise corrected:** "merges run after the budget cut" is true in order, but the budget is not overshot. The injector entry is charged its own tokens before the cut. Only the joining space is uncounted.
- **Verified fork location:** the cut is at `lorebook.svelte.ts:684-690` (`usedTokens + act.tokens <= loreToken`, tokens measured at `:646`); injectors are separated at `:697-703` and merged by `source` at `:709-728` without recounting tokens.
- **Observed (executed, tokenizer = string length, injector and target 10 characters each):** budget 100 and 25: merged. Budget 15: injector cut, merge silently lost, target alone. With the injector ranked above the target: budget 25 gives target merged (the other entry cut); budget 15 gives an empty result, the injector kept and the target cut, so 10 tokens are spent for nothing.
- **Upstream: UPSTREAM-SAME** (identical block, verified).
- **What a card author sees today:** injection happens only if both injector and target survive their separate cuts. An injector can take budget and produce no visible text when its target was cut.
- **Decided behaviour, `MC-710` 4:** "Refund when target cut". Keep the current order; when the target was cut, give the injector's tokens back so other entries can use them; a cut injector still loses its merge.
- **Reproducers**, in `lorebookKeyMatching.svelte.test.ts`:
  - `guard: an injector and its target that both fit are merged into the target`
  - `guard: an injector that is cut itself does not merge into its target`
  - `regression reproducer: the injector's tokens are given back when its target was cut` (asserts only `['OTHER']`; see residuals)
- **Residuals:**
  - Whether the refund should let the target itself back in is undecided. The reproducer cannot require it: the target (30) exceeds the budget (25) even with a full refund.
  - The merged entry's reported `tokens` understates its text. Consumers of `actives[].tokens` were not traced (UNVERIFIABLE; INFERRED concern only).
  - The investigation sketch for this item was an either/or assertion; the verifier required one assertion per option (applied: the reproducer pins the refund option only).

### Item 11: regex mode and non-`/pattern/` keys (REPRODUCED)

- **Verified fork location:** in `lorebook.svelte.ts:210-227`, with Use Regex on, every comma-split, trimmed key must match `^\/([\s\S]*)\/([dgimsuvy]*)$`; one failure (`:215`) or one invalid pattern (`:226`) returns false for the whole entry. Keys are split on commas at `:593` (second keys at `:599`).
- **Observed (executed, message `a dragon here`, regex on):** `/dragon/` 1; `/dragon/,wolf` 0; `wolf,/dragon/` 0; `/dragon/, /wolf/` 1; `/dragon{1,2}/` 0 (split into `/dragon{1` and `2}/`); `/(wo|dra)gon/` 1; plain `dragon` 0.
- **Upstream: UPSTREAM-SAME** (upstream `:145-160`).
- **What a card author sees today:** with Use Regex on, one bare word in the list, or a comma inside a regex, stops the entry from ever activating, with no warning.
- **Decided behaviour, `MC-710` 5:** "Plain-substring fallback". Non-slash keys in regex mode match as ordinary case-insensitive substrings; regex keys stay regex.
- **Reproducers**, in `lorebookKeyMatching.svelte.test.ts`:
  - `guard: a key written as /pattern/ matches as a regex`
  - `guard: a list of regex keys with no match does not activate`
  - `guard: a bare key is a substring, not a regex`
  - `regression reproducer: a bare key in a list with a regex key matches as a substring`
  - `regression reproducer: a bare key matches as a case-insensitive substring`
  - `regression reproducer: a bare key before a regex key does not stop the regex key matching`
  - Correction applied (verifier, required 3): these pin the substring-fallback option (`MC-710` 5), not the skip-bad-key option the investigation sketch encoded.
- **Residuals:**
  - Comma inside a regex (`/dragon{1,2}/`) is UNDECIDED: `MC-710` states it was described but not answered. It is not tested.
  - The existing guard `G: a regex-mode key that is not written as /pattern/ does not activate` in `src/ts/process/tests/lorebookRegexKeys.svelte.test.ts` contradicts `MC-710` 5 and must change with the fix. It was left untouched; the mutation run confirmed it fails when the substring fallback is applied (Gate 2 mutant B).

## What changed and evidence

- **No application code changed.** Two new untracked test files, authored by test-warrior:
  - `src/ts/process/tests/triggerLegacyLorebook.test.ts`: 2 guards, 3 `test.fails` (item 4).
  - `src/ts/process/tests/lorebookKeyMatching.svelte.test.ts`: 8 guards, 6 `test.fails` by title listing (items 9, 10, 11). See Citation mismatch below.
- Run (test-warrior): both files with `lorebookRegexKeys` and `triggerNestingLimit`: 4 files passed, 26 passed and 9 expected-fail. `pnpm check` (heap 8192): 0 errors, 0 warnings. Gate 2 reproduced both.
- Falsification: scratch copies with `test.fails` changed to `test`: 9 failed, 10 passed, each on the intended assertion (extra `"2"` key; TypeError for out-of-range and `abc`; "length 0 but got 1" twice for item 9; "length 1 but got 0" three times for item 11; `[]` versus `['OTHER']` for item 10). Log `tw/mut.log`.
- Gate 2 mutants: fixes for items 9, 11, 10 and 4 each flipped only their own tests (so the reproducers are fixable and independent). Guard mutants E (regex always `/i`), F (injectors exempt from the cut) and G (case sensitivity always on) each broke the intended guard. Verdict [EDITORIAL].
- The independent verification re-ran the investigation's scratch reproducers: 6 tests, outputs matched for items 4, 9, 10, 11.

## What was not done / residuals

- Item 7 has no reproducer and was not executed (TRACED only).
- Not traced: consumers of `actives[].tokens` (item 10); persistence of the item 4 stray key through the save pipeline (INFERRED from `markWrite`; lane A territory).
- Undecided: comma-in-regex splitting (item 11); whether the target may re-enter after a refund (item 10); whether the item 4 effects should be hidden in the editor.
- No performance claims. Mocks mean results show matching and merge logic only, not full-app behaviour.
- The Roadmap and Live-State were not edited; lane A applies the proposed status.

## Decisions

`MC-710` 1 to 5 (answers quoted exactly as recorded in [lane-cloud-records.md](../lane-cloud-records.md)):

1. Item 4: **"Inert, no junk write"**. Keep returning null/-1 as today (existing cards already cope), but stop the stray "2" write and the throw.
2. Item 7: **"Plumb the owner"**. Pass the owning character and message through those three callers so `@@inject` always hits the right chat; larger change, touches the parser.
3. Item 9: **"Honour it + UI toggle"**. Plain keys match case-sensitively when the flag is true (regex keys keep their own flags), and add a per-entry toggle in the lorebook editor (new UI, translator work).
4. Item 10: **"Refund when target cut"**. Keep the current order; when the target was cut, give the injector's tokens back so other entries can use them; a cut injector still loses its merge.
5. Item 11: **"Plain-substring fallback"**. Non-slash keys in regex mode match as ordinary case-insensitive substrings; regex keys stay regex. The comma-splitting of regex keys was described in the question but not answered separately.

Related: `MC-708` ("go ahead with Phase 2"), `MC-709` (commit per ticket without re-asking), `MC-069` (upstream comparison). Items 9 and 11 change what upstream cards do; item 9 adds UI and translation work; item 7 touches the parser and is upstream-different.

## Wiki hand-off (the wiki is not edited here)

Pages confirmed by read-only grep of `docs/wiki`:

- `docs/wiki/Lorebook.md`: line 37 says Case Sensitive is round-tripped only and has no effect (item 9); line 53 says one non-`/pattern/` key fails the whole entry (item 11); line 72 and line 96 describe `@@inject_lore` applied after the budget cut with the injection lost and the budget exceeded (item 10; the claim about exceeding the budget conflicts with the investigation's finding that the budget is not overshot, see Citation mismatches).
- `docs/wiki/Trigger-Script.md`: lines 248 to 252 describe the five legacy lore effects as never matching and `v2SetLorebookActivation` as writing a non-existent field (item 4). Line 243 was a long line truncated in the grep output; read it before editing.
- `docs/wiki/Regex-Script.md` line 106 and `docs/wiki/@-Syntaxes.md` line 49 (section `### @@inject`, content not read): `@@inject` targeting the selected character (item 7). `Regex-Script.md:106` says it has no effect for group members or preview characters; that would change with the owner plumbing.

## Citation mismatches

- The test-warrior summary says `lorebookKeyMatching.svelte.test.ts` has "9 guards, 6 test.fails". A title grep lists 8 guards and 6 `test.fails` (14 tests), and the combined default run "10 passed" equals 2 trigger guards plus 8. This report uses 8. Resolved by the orchestrator: `grep -cE "^\s*(test|it)\("` gives 8 plain tests and `grep -c 'test\.fails('` gives 6 in that file (2 and 3 in the trigger file), so 10 guards and 9 reproducers in total; the test-warrior's "11 guards" was wrong.
- `docs/wiki/Lorebook.md:72` says the item 10 merge "can make the actual token count exceed the configured budget". The investigation observed no budget overshoot (injector charged separately; only the joining space is uncounted). Not independently re-run against the wiki wording; reported, not resolved.
- Investigation scratch test `lore.test.ts:67` labels the comma case "/a,b/" but runs `/dragon{1,2}/` (verifier note). The result table is correct; no effect on this report.

## Corrections from doc-verifier

This section takes precedence over the body above. Seeded from the independent verification of the investigation (`p2/c09/verify/result.md`) and Gate 2 (`p2/c09/g2/result.md`). The independent doc-verifier pass on this report itself is the Orchestrator's to dispatch; none has been claimed.

1. Item 9 citation: fork `characterCards.ts` lines are 1576 (write), 1606 and 2037 (reads); 1177, 1207 and 1628 are upstream lines. Applied in item 9.
2. Item 7: the v3 caller `v3.svelte.ts:1099` uses the selected character and a bounds-checked `messageIndex`, so it stays within the selection. Applied in item 7.
3. Items 10 and 11 reproducer sketches must state one assertion per product option. Applied: item 10 pins the refund option, item 11 pins the substring-fallback option.
4. Item 4: the NaN (non-numeric) index also throws; "nothing reads `[2]`" is not grep-evidenced and is marked INFERRED. Applied in item 4.
5. Item 7 reproducer sketch is UNVERIFIABLE (not executed). Applied: stated in item 7.
6. Item 10 `tokens` understatement: consumers not traced, UNVERIFIABLE. Applied in item 10 residuals.
7. Gate 2 finding E1 (editorial): the header comment of `triggerLegacyLorebook.test.ts` says `it.fails` and "flip them to `it`", but the file uses `test.fails` and `test`. Applied by the orchestrator before the commit: the header and the three per-test comments now say `test.fails` and `test`; both files rerun 10 passed, 9 expected fail.
8. Gate 2 limit: item 9 field name `extentions` matches the typed `loreBook` field and card import; UI and other writers were not checked. Kept as a residual in item 9.
