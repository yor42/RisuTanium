# Upstream harvest 2026-11-02 (kwaroran/Risuai issues and unmerged PRs)

Status: lane A draft, NOT independently verified (no doc-verifier pass). Part 1 was committed in `15bee8b96`; the part 2 edits are uncommitted. Updated 2026-11-02 with part 2: sections 1 to 7 record part 1 (#703-#1712, fork state read at `main` `031bfddf1`); section 8 records part 2 (#1-#702, fork state read at `52987bd95`). Sections 4 to 6 are updated for both parts. "Harvest batch U1/U2/U3/U3b" names the batches of this harvest only; they are not the older project record names. Every per-item verdict below is an investigator's report from static source reading and is "reported", unless section 3 says lane A confirmed it directly. Working files live under `%TEMP%\risu-b715\b35\` (`upstream\`, `u1-plan\`); they are scratch, not records.

## 1. Purpose and method

Upstream holds old issues and never-merged PRs with sound ideas. Many PRs were AI-made or did not fit upstream's vision, so the question asked per item is whether the defect or idea still applies to the fork, not whether upstream merged it.

Funnel stages:

1. Fetch: raw GitHub issues API pages for kwaroran/Risuai (the endpoint returns issues and PRs together).
2. Set merged PRs aside (assumed to be in the fork already; not checked, see section 5).
3. Triage the unmerged items with Haiku (class, area, value, reachability, one-line summary). Triage read only the first 700 characters of each body.
4. Shortlist, rule given by lane A: triaged value `high`, OR triaged class `data-loss` or `security`. This is why #1058 (class security, value med) and #1582 (class data-loss, value low) joined the 45 `high` items.
5. Per-cluster investigation (clusters A to E): does the defect still exist in the fork, and is it reachable in normal use. Static source reading only.
6. Harvest batch U1: a plan for the two defects lane A confirmed (shipped, see section 4).

MVP rule, maintainer direction 2026-11-02: reachable data loss in normal use gates the MVP refresh; nothing else does. Everything outside U1 is therefore non-gating backlog.

## 2. Funnel numbers

Recomputed from the files on 2026-11-02 (PowerShell over `upstream\raw\issues-0*.json`, `merged-prs.csv`, `tri-out-0..2.csv`).

| Stage | Count | Note |
|---|---|---|
| Raw API items fetched | 1000 | 10 pages (`issues-001..010.json`), 1000 unique numbers, lowest #703, highest #1712 |
| Numbers in the range not seen | 10 | 1010 numbers span #703-#1712. Absent: #878, #1043, #1406, #1467, #1541, #1580, #1585, #1605, #1624, #1631. Cause not established. Likely but UNCONFIRMED: GitHub's issues API omits deleted items, and transferred items come back as moves |
| Of the raw items: issues | 162 | 62 open, 100 closed |
| Of the raw items: PRs | 838 | 571 merged, 151 closed unmerged, 116 open |
| Merged PRs set aside | 571 | `merged-prs.csv` has 571 data rows; matches the raw merged count |
| Unmerged items triaged | 429 | 162 issues + 267 PRs; three triage files of 143 rows each, row counts equal input line counts, no number repeated |
| Triaged `high` value | 45 | 25 `bug`, 19 `data-loss`, 1 `perf` |
| Shortlist: `high` OR class `data-loss`/`security` | 47 | the 45 `high` items plus #1058 (security, value med) and #1582 (data-loss, value low); 20 `data-loss` items in total, 19 of them `high`, and the 1 `security` item is #1058 |
| Investigated | 47 | the whole shortlist |

Unmerged items by kind (triage rows):

| Kind | Count |
|---|---|
| issue, open | 62 |
| issue, closed | 100 |
| PR, open | 116 |
| PR, closed (unmerged) | 151 |
| Total | 429 |

Triage class (Haiku, unverified):

| Class | Count | | Class | Count |
|---|---|---|---|---|
| feature | 137 | | question | 12 |
| bug | 130 | | retired | 10 |
| ui | 41 | | i18n | 6 |
| other | 40 | | docs | 5 |
| perf | 22 | | spam | 5 |
| data-loss | 20 | | security | 1 |

Triage value: high 45, med 73, low 259, none 52 (total 429).

## 3. Results per cluster

Verdict words: present, fixed, moot, unclear (the investigators' vocabulary). Uncertainty labels (UNCERTAIN, edge, unclear) are the investigators' own. "Data loss" and "reach" are the investigator's report. File:line citations are the investigators' at `031bfddf1` and were not re-read by the writer unless marked.

### Cluster A: chat data (report: `inv-A\result.md`)

| Upstream | One line | Verdict | Data loss / reach | Fix route |
|---|---|---|---|---|
| [#1564](https://github.com/kwaroran/Risuai/issues/1564) and [#1611](https://github.com/kwaroran/Risuai/pull/1611) | Lua `setFullChat` strips message metadata | present | yes (metadata), edge: only Lua trigger users who call `setFullChat` | U1b (section 4). Lane A confirmed by direct source reading that `setFullChatMain` rebuilds messages as `{role,data}`; the full list of lost fields and consequences is the investigator's report |
| [#1352](https://github.com/kwaroran/Risuai/pull/1352) | `indexOf` can return -1, `splice` removes the wrong chat | fixed | no; not reachable. Residual: `SideChatList.svelte` still uses `indexOf` for display, reported unreachable | none |
| [#1424](https://github.com/kwaroran/Risuai/pull/1424), [#1519](https://github.com/kwaroran/Risuai/issues/1519), [#1563](https://github.com/kwaroran/Risuai/pull/1563) | Reroll variants not persisted | fixed (superseded by the persisted `chat.alt` tree) | no; not reachable | none; do not port upstream's design. UNCERTAIN: whether the fork has upstream 1424's delete-reroll button and sibling count (outside the data-loss question) |
| [#1353](https://github.com/kwaroran/Risuai/pull/1353) | Missing `alternateGreetings` crashes character switching | fixed | no; not reachable. Residual (UNCERTAIN, low): two unguarded `.alternateGreetings.length` reads in `DefaultChatScreen.svelte`, safe only because selection normalizes the character | none; optional guard |
| [#994](https://github.com/kwaroran/Risuai/pull/994) | Nullish guard for `chatFolders` on old bots | fixed | no; not reachable. Residual (UNCERTAIN, low): export writes `folders: undefined` for such a character; not a crash | none |

Investigator's headline said "7 of 8 items fixed or superseded"; the table has 8 numbers with 6 fixed and 2 present (see section 7).

### Cluster B: lorebook, loadout, Lua lore (report: `inv-B\result.md`)

| Upstream | One line | Verdict | Data loss / reach | Fix route |
|---|---|---|---|---|
| [#1667](https://github.com/kwaroran/Risuai/pull/1667) | Deleting a nested lorebook folder leaves grandchildren | present (nested case only; top-level handled) | no loss of wanted data: orphans stay hidden but still stored and exported; edge (nested folders, folder containing a folder). Triage had rated it normal-use | small: take upstream's `getLoreBookSubtree` helper (worklist with cycle guard), use it in the three `onRemove`s in `LoreBookList.svelte`; skip upstream's large DOM tests |
| [#1351](https://github.com/kwaroran/Risuai/issues/1351) and [#1387](https://github.com/kwaroran/Risuai/pull/1387) | Loadout with a deleted preset | fixed for the reported scenario; residual edge | no; no/edge. Residuals: `saveCurrentPreset` guards only `=== -1`; `applyLoadout` can push `undefined` into `characterIds` | tiny: 1387's guard on `botPresetsId` plus an `if(chaId)` guard. Issue body for #1351 was judged from title and diffs, not parsed |
| [#1041](https://github.com/kwaroran/Risuai/issues/1041) and [#1042](https://github.com/kwaroran/Risuai/pull/1042) | Lua `upsertLocalLoreBook` lost in `onStart`/`onOutput` | fixed | no; not reachable | none |
| [#1530](https://github.com/kwaroran/Risuai/issues/1530) | Regex lorebook keys mutated during scan | fixed | no (activation misses only); not reachable | none |

### Cluster C: import, backup, assets (report: `inv-C\result.md`; no item present)

| Upstream | One line | Verdict | Data loss / reach | Fix route |
|---|---|---|---|---|
| [#706](https://github.com/kwaroran/Risuai/issues/706) | Importing bots with assets fails (CORS, DB server errors) | moot / unclear | no; unclear. Screenshot-only Korean report from the hub/realm server path; not probed (third-party service) | would need the failing URL or a synthetic repro |
| [#1315](https://github.com/kwaroran/Risuai/issues/1315) | One site's PNG cards fail import; export omits emotion images | unclear (import half), fixed (export half) | no evidence; unclear | needs a failing card or the upstream fix commit |
| [#1701](https://github.com/kwaroran/Risuai/pull/1701) | Broken service-worker cache entries keep images broken | fixed (partly by a different route) | no; not reachable. Not carried over: activate-time cache delete and a "Clear Image Cache" button | optional manual clear button only if a symptom recurs (tiny) |
| [#804](https://github.com/kwaroran/Risuai/issues/804) | Charx over 400 MB fails to import | fixed (UNCERTAIN at real 400 MB scale; tests use small fixtures) | no; edge (very large cards) | none |
| [#1628](https://github.com/kwaroran/Risuai/issues/1628) | macOS/Linux desktop sanitizer strips `src` on asset images | fixed (code reading only; no jsdom sanitizer run, MC-239) | no; not reachable | none |
| [#1217](https://github.com/kwaroran/Risuai/pull/1217) | CharX import fails when data contains ZIP signature bytes | fixed (fork's own writer frames entries without data descriptors) | no; not reachable | none |
| [#1702](https://github.com/kwaroran/Risuai/pull/1702) | Skip resolved `/sw/img/` paths in chat image repair | fixed | no; not reachable | none |
| [#1582](https://github.com/kwaroran/Risuai/pull/1582) | Include non-png assets in local backup | fixed | no; not reachable | none |
| [#757](https://github.com/kwaroran/Risuai/issues/757) | webp corrupted by text-mode backup/restore | fixed / moot (Drive part retired); no webp-specific case confirmed | no; not reachable | none |
| [#1013](https://github.com/kwaroran/Risuai/issues/1013) | Save Backup Locally dies on null `byteLength` | fixed | no; not reachable | none |

### Cluster D: streaming, providers, translation (report: `inv-D\result.md`)

| Upstream | One line | Verdict | Data loss / reach | Fix route |
|---|---|---|---|---|
| [#1647](https://github.com/kwaroran/Risuai/issues/1647) and [#1658](https://github.com/kwaroran/Risuai/pull/1658) | Anthropic stream decodes chunks separately; a split multibyte character becomes U+FFFD and is saved | present (lane A confirmed by direct source reading: `anthropic.ts` decodes without `{stream:true}`) | yes (text saved corrupted, not recoverable); normal use (any non-ASCII reply over a chunk boundary) | U1a (section 4) |
| Gemini twin (found while checking #1647; the issue says "may be") | `google.ts` builds a new `TextDecoder` per chunk | present (lane A confirmed by direct source reading: `google.ts` creates a TextDecoder per chunk) | yes, same mechanism; the investigator reports the U+FFFD stays in a never-trimmed buffer and re-parses each chunk | U1a |
| [#1426](https://github.com/kwaroran/Risuai/issues/1426) and [#1495](https://github.com/kwaroran/Risuai/pull/1495) | Auto-translate hides streaming text until the stream ends | present (static trace; no runtime repro) | no (display only); normal use with auto-translate on and a streaming reply | small: #1495's approach is sound (skip translation while the tail is streaming, translate once at the end). Touches the `ChatBody` render-cache logic, so run through the gates |
| [#1327](https://github.com/kwaroran/Risuai/issues/1327) | Greedy `<Thoughts>` regex strips earlier MCP history | present per investigator; resting on the regex plus append logic, multi-iteration message shape not verified at runtime. Treat as unverified | no (stored message untouched; only the outgoing prompt copy); edge (MCP tools with remembered usage, thinking on, 2+ loop iterations) | tiny: non-greedy match at the one site (and a second site in the prompt-template parser); check the `thoughts.push` consumers |
| [#1642](https://github.com/kwaroran/Risuai/issues/1642) | Tauri streamed replies type slowly | fixed for the named cause (the per-chunk sleep loop); residual render cost unclear | no; n/a | would need the issue's fake-server harness on a Tauri build |
| [#1689](https://github.com/kwaroran/Risuai/issues/1689) and [#1694](https://github.com/kwaroran/Risuai/pull/1694) | Tauri timeout argument name | fixed (JS side and tests; Rust signature not re-read) | no | none |
| [#1362](https://github.com/kwaroran/Risuai/pull/1362) | Ollama streaming shows last token only | fixed | no | none |
| [#1189](https://github.com/kwaroran/Risuai/pull/1189) | Translation button reactivity | fixed (render-cache rewrite supersedes) | no | none |
| [#1051](https://github.com/kwaroran/Risuai/issues/1051) | HypaV3 `SystemMessageOrderError` | fixed (system message hoisted before the web-llm call) | no | none |

### Cluster E: misc (report: `inv-E\result.md`)

| Upstream | One line | Verdict | Data loss / reach | Fix route |
|---|---|---|---|---|
| [#718](https://github.com/kwaroran/Risuai/issues/718) | Page reload after an error erased chats and settings (Docker, v145.0.1) | unclear | reported by upstream: yes; reach in the fork unclear. Not claimed present | investigator task (small to medium): trace Node boot when the main-file read fails or returns empty, and whether the fork can then save an empty default over the stored database |
| [#843](https://github.com/kwaroran/Risuai/issues/843) | Chat export on Firefox iOS says saved but no file appears | present (by source similarity; not tested on iOS) | no (export only); edge (iOS is not a target platform) | small; needs a maintainer call (prefer `navigator.share`, or reword to "download started") |
| [#969](https://github.com/kwaroran/Risuai/pull/969) | Hub proxy drops body on 303 | fixed (different mechanism). Edge observation: the redirect re-fetch resends the original method for 303 | no; not reachable for the reported symptom | tiny, optional: mirror the existing 301/302/303 method rewrite |
| [#1586](https://github.com/kwaroran/Risuai/issues/1586) | `effect_update_depth_exceeded` opening Other Bots | moot (cause absent; UNCERTAIN without a mount test) | no | settle with a vitest mount of `OtherBotSettings` |
| [#849](https://github.com/kwaroran/Risuai/issues/849) | Chats not shown; IntersectionObserver error | moot | no | none |
| [#1018](https://github.com/kwaroran/Risuai/issues/1018) | Auto-save not saving after a downgrade | moot (upstream-only test path; fork storage rewritten; MC-350 covers downgrade safety) | n/a | none |
| [#1058](https://github.com/kwaroran/Risuai/pull/1058) | Plugin import warning for dynamically created iframes | moot (fork has no such regex warning; V2.1 retired) | no | a V3 import-time warning would be a product decision |
| [#1306](https://github.com/kwaroran/Risuai/issues/1306) | Chat buttons stop responding after new messages | fixed (tests exist; not executed by the investigator) | no | none |
| [#1365](https://github.com/kwaroran/Risuai/issues/1365) | Reverse proxy: `writeFileSync` crash, missing trust proxy | fixed (trust proxy is opt-in via `TRUST_PROXY`; configuration, not a bug) | no | none |
| [#1366](https://github.com/kwaroran/Risuai/issues/1366) | `writeFileSync` not a function on login | fixed (same cause as #1365; UNCERTAIN only if a build step transforms `server.cjs`) | no | none |
| [#1273](https://github.com/kwaroran/Risuai/pull/1273) | V3 `addProvider` callback: AbortSignal not cloneable | fixed | no | none |
| [#1279](https://github.com/kwaroran/Risuai/issues/1279) | `registerBodyIntercepter` results discarded | fixed (Google path not read in detail) | no | none |

### Tally of the 47 investigated items

Counting upstream numbers (an issue and its PR are counted as separate numbers; #1351/#1387 counted as fixed with residual):

- present: #1564, #1611, #1667, #1647, #1658, #1426, #1495, #1327, #843 (9 numbers), plus the Gemini twin, which has no upstream number of its own.
- unclear: #706, #1315, #718. #706 is "moot / unclear".
- fixed or moot: the remaining 35 numbers. Residual edges are noted in the tables above.

This tally is the writer's count from the tables, not an investigator's figure.

## 4. Actions

Shipped on main (hashes from `git show --stat`; commit messages read, tests named there; this document does not re-run them):

- Harvest batch U1, `52987bd95` (2026-11-02): U1a, Anthropic and Gemini streams keep multibyte text whole (one `TextDecoder` per stream, `{stream:true}`, flushed at stream end; the Anthropic overload retry starts a fresh decoder; upstream #1647, #1658). U1b, `setFullChat` keeps every field on a message with the same index, role and data (upstream #1564, #1611). Its commit message names new `streamMultibyte` tests through the real Anthropic and Gemini parse paths, and a `setFullChat` identity round-trip test with guards for edited messages and role changes.
- Harvest batch U2, `f8f5007f1` (2026-11-02): Lua `getFullChat`, `getChat` and `getRecentChats` expose a read-only `chatId`; `setFullChat` matches by id first, then by index, role and data. This answers the maintainer question recorded under the old "Maintainer question" heading below: the plan's recommendation to defer was not followed and the API addition shipped. Fork-only; upstream PR #1611 proposes the same idea and is unmerged (per the commit message).
- Documentation for both: the Lua API reference and the "Changes from upstream" wiki page (maintainer standing OK 2026-11-02 for wiki pages documenting lane A's own shipped changes).

The original U1 plan text follows, kept as history. These were the only items the MVP rule gates:

- U1a, multibyte stream decoding. Anthropic (`anthropic.ts`) and Gemini (`google.ts`) readers. Plan: one `TextDecoder` per byte stream, `{stream:true}` on each chunk, plus an end flush. The plan's survey of other readers found no other chat-reply reader with the defect; its own coverage label is PARTIAL (`Buffer#toString` decoding was checked only in one file). The end flush and fresh retry decoder are described by the plan as hygiene with no observable test.
- U1b, `setFullChat` metadata. Plan: in `setFullChatMain`, a message with the same index, role and data starts from a shallow copy of the previous message, so all fields survive. An edited message still carries nothing (index alone cannot tell an edit from a shift, so carrying fields by index could attach them to the wrong message). Edited messages keep losing metadata until a real identity exists.
- The plan's tests (two reproducers and two guards for U1a, one reproducer and two guards for U1b, plus mutants) are DESIGNED, NOT DEMONSTRATED. The plan's gate route skips Gate 1 and sends Gate 2 to opus-reviewer, on the condition that the review brief includes the edited-message decision and the shared reactive-proxy point.

Also shipped on main (hashes and commit messages read with `git show`; the tests named there were not re-run by this writer; Gate 2 verdict files in the lane A scratch folder were read for the residuals below):

- Harvest batch U3, `5e574e1dc` (2026-11-02): #1667 (a folder delete removes its whole subtree; drag is enabled only while no entry is open; stale or unselected rows never write), #1387 residuals (an out-of-range preset id keeps the working settings as "New Preset"; applying a loadout never adds an empty entry), #843 (web-only "download started" notices), #1327 (non-greedy `<Thoughts>` pattern where messages are assembled and in the chatML parser; the previously skipped multi-block parser test runs again), #1426/#1495 (with auto-translate on, the streaming reply shows raw text and is translated once when the stream ends; only the chat list decides this), and the local Ollama multibyte item (the local fetch is wrapped so the SDK's per-chunk decode never splits a character; the cloud path is unchanged).
- #1327 was proven by its diagnostic: the stage 4 coder's diagnostic test D4.1 showed the Gemini tool-loop producer writes two `<Thoughts>` blocks with text and a tool call between them, and the reproducer failed on the base (`expected 'END' to contain 'MIDDLE'`) before the non-greedy fix (`u3-impl\s4-result.md`). The diagnostic is kept as a guard.
- Harvest batch U3b, `6bff60aad` (2026-11-02): #340 (full-word keys match next to punctuation, quotes, line breaks and full-width punctuation; an empty key never matches; new per-lorebook option "SillyTavern-style Word Boundaries", off by default, stored as `loreSettings.fullWordAsciiBoundary`, carried in `.bin` and written to a card as the `risu_fullWordAsciiBoundary` extension only when on; module entries follow the character option), #200 (auto speech translates the whole reply in one translator request per spoken run; the speaker button speaks the shown translation; a failed translation speaks the original), #209 (CheckInput uses a visually hidden native input named by its label and shows a ring for keyboard focus only), #662 (`typeof` checks for CompressionStream, DecompressionStream and TextDecoder, so the fallback is taken).
- Full checks on each final snapshot (lane A, scratch `u3b-final2\` and `u3-final\` exits and logs): U3b `pnpm check` 0 errors, `pnpm test` 1300 files and 29,065 tests passed, build exit 0; U3 `pnpm check` 0 errors, `pnpm test` 1309 files and 29,153 tests passed, build exit 0. U3's first full run failed because lane A's locale insert landed inside a two-line value; it was fixed and re-run before Gate 2 closed.

Accepted residuals of U3 and U3b (from the Gate 2 verdicts and coder reports; none was independently re-verified here):

- The reworded translation-JSON notice is English only; the other new strings are translated in all locales (commit message of `5e574e1dc`).
- The Ollama cloud path has no test. A mutant that gave the cloud path the local wrapper survived; Gate 2 called this editorial and recommended an optional follow-up guard (`u3-impl\s6-result.md`, `u3-g2\result.md` G2-E2).
- Two paths can still leave a stale `risu_fullWordAsciiBoundary` in a card's stored extensions (`loreExt`): switching a lorebook to global settings and back, and importing a card without the scan fields. The toggle path is closed. An upstream card export writes `loreExt`, so the stale value would travel there; fork card exports and `.bin` are described in `u3b-g2\result.md` N1 and `u3b-g2r2\result.md` A1. Traced, not executed; Gate 2 round 2 rated it low severity and not needed for acceptance.
- The live checks D200 (one translator request per reply with real speech) and D-S5 (the toggle UI) were not run. Gate 2 stated that mocked tests do not prove them.

Decisions with no code change:

- Maintainer decision, static web build: provider requests go through upstream's `sv.risuai.xyz/proxy2`, so API keys pass through upstream's server. Decision: note it, no change. Tauri (including Android) goes direct; the Node self-host uses its own `/proxy2`. Lane A confirmed the proxy URL selection in `globalApi.svelte.ts` (the part 2 investigator cites `:3208`, `:3403`, `:3580`, `:3355`; those lines were not re-read by this writer).

Earlier backlog list (kept as history; now folded into U3):

- #1667: nested lorebook folder delete (small).
- #1387 residual guards: `saveCurrentPreset` out-of-range id, `applyLoadout` pushing `undefined` (tiny).
- #1426 / #1495: auto-translate versus streaming (small; render-cache logic, needs the gates).
- #1327: greedy Thoughts regex. Unverified at runtime; verify before fixing (tiny fix).
- #843: Firefox iOS export notice. Needs a maintainer call because iOS is not a target.
- Open question rather than backlog: #718 (empty-database-on-boot trace), because upstream reported data loss; reach in the fork is unclear.

Leads, not verified:

- The Anthropic overload retry resets `parserData` but not the line index (`i`), so the new response's first lines may be skipped. The plan calls this probably harmless preamble and unverified. Plan cites `anthropic.ts` lines 1014-1040 at `031bfddf1`.

Maintainer question (non-blocking), now answered by shipping harvest batch U2 (`f8f5007f1`):

- Should Lua `getFullChat` expose `chatId`, so `setFullChat` can match by identity and keep metadata on edited messages (upstream #1611's approach)? It is a Lua API addition. The plan recommended deferring it. The maintainer chose "add chatId now" on 2026-11-02, then ruled that chatId is read-only in getFullChat, getChat and getRecentChats, and that an unknown or duplicate id is judged like an id-less entry. These answers will be recorded as an MC entry in records batch 35. Shipped as harvest batch U2.

## 5. Limits

- Triage read only the first 700 characters of each body. It is Haiku output and unverified.
- The investigations were static source reading only. No runtime probe, device run or test was executed for any verdict here. Several investigators flag specific unrun checks (jsdom sanitizer for #1628, 400 MB scale for #804, iOS for #843, a mount test for #1586).
- Issues and PRs #1-#1712 are now covered: part 1 holds 1000 items (#703-#1712, 10 numbers in that range absent) and part 2 holds 697 items (#1-#702, 5 numbers absent: #14, #197, #262, #561, #562). The cause of the 15 absent numbers is unconfirmed (see section 2 for the guess).
- Part 2 triage, like part 1, read only the first 700 characters of each body (`tri-in-3.jsonl` and `tri-in-4.jsonl`: 110 and 109 lines, longest body 700 characters) and is unverified model output. The part 2 investigators ran about 5 minutes per item, source only, and cluster G is a shallow pass: items marked "shallow" were not traced end to end.
- The 571 merged PRs were assumed to be already in the fork. That was not checked.
- Cluster A to E investigators read upstream items from the GitHub web pages or the local raw dump; the #1351 body was not parsed.
- This document is to be updated when the remaining pages are fetched and triaged.

## 6. Open items

- Done in section 8: fetch, triage and investigation of #1-#702.
- Done: harvest batches U3 and U3b shipped (section 4); their residuals are listed there.
- Pending: independent verification of this document, and of the shipped batches' own review and verification results beyond what the commit messages state; record them separately once they exist.
- Unconfirmed: why 10 numbers in #703-#1712 and 5 in #1-#702 are absent (see sections 2 and 8).
- Open (part 2): #662's Safari support floor was not checked; #553/#584 need a macOS Safari or Tauri run; #596 needs one Android device run; #230 and #681 are unclear.

## 7. Citation and consistency notes

- Cluster A's headline says "7 of 8 items fixed or superseded"; its own sections give 6 of 8 numbers fixed (#1352, #1424, #1519, #1563, #1353, #994) and 2 present (#1564, #1611).
- Cluster B's headline says "Four of six are fixed"; its sections give three plainly fixed (#1041, #1042, #1530), one present (#1667), and #1351/#1387 as fixed with residual edges.
- Triage rated #1667 `normal-use`; the cluster B investigator reports `edge`. The investigator's reading is used above.
- Triage rated #706 `normal-use` and #1582 `unclear`; the cluster C investigator reports #706 moot/unclear and #1582 fixed.
- Cluster D reports #1327 as present but only from the regex and the append logic; it did not verify the stored-message shape at runtime.

## 8. Part 2: upstream #1-#702

### 8.1 Method change

Part 1 fetched `sort=created&direction=desc` pages 1-10. GitHub refuses page-number pagination past page 10 (maintainer-lane statement in the brief; the 11-18 desc fetch script `fetchrest-b35.ps1` is in the scratch folder, and no desc page file beyond 010 exists). Part 2 therefore fetched `direction=asc`, 7 pages of 100 (`upstream\raw\issues-asc-001..007.json`), from the oldest item. The 700 items returned cover #1 to #702 (5 absent) plus 3 items numbered above #702, which are left out because part 1 covers that range. Everything else follows part 1: merged PRs set aside, Haiku triage, same shortlist rule (value `high`, or class `data-loss` or `security`), then investigation per cluster. Fork state for part 2 was read at `main` `52987bd95` (the investigators' stated HEAD).

### 8.2 Funnel numbers

Recomputed on 2026-11-02 by a PowerShell script over `issues-asc-*.json`, `merged-prs-old.csv`, `tri-out-3.csv` and `tri-out-4.csv` (script `wiki\count-docs2.ps1` in the scratch folder). Issue versus PR comes from the raw `pull_request` field.

| Stage | Count | Note |
|---|---|---|
| Raw items fetched | 700 | 7 files of 100, 700 unique numbers |
| Items numbered below 703 | 697 | lowest #1, highest #702 |
| Numbers in #1-#702 not seen | 5 | #14, #197, #262, #561, #562. Cause not established (see section 2 for the part 1 guess; same UNCONFIRMED status) |
| Of the 697: issues | 189 | 12 open, 177 closed |
| Of the 697: PRs | 508 | 478 merged, 30 closed unmerged, 0 open |
| Merged PRs set aside | 478 | `merged-prs-old.csv` has 478 data rows; the numbers equal the raw merged set (0 differences each way). Not checked against the fork, as in part 1 |
| Unmerged items triaged | 219 | 189 issues + 30 PRs; `tri-out-3.csv` 110 rows + `tri-out-4.csv` 109 rows, 219 unique numbers, every unmerged raw number present |
| Triaged `high` value | 25 | 20 `bug`, 4 `data-loss`, 1 `security` |
| Shortlist: `high` OR class `data-loss`/`security` | 27 | the 25 `high` items plus #662 (data-loss, value med) and #698 (security, value med) |
| Investigated | 27 | the whole shortlist: cluster F 11 items, cluster G 16 items |

Triage kind (rows): issue-closed 170, issue-open 12, pr-closed 30, wontfix 7 (these 7 are issues; their labels are the triage's own). Total 219.

Triage class (Haiku, unverified): bug 99, feature 58, question 21, other 12, ui 9, data-loss 5, docs 4, retired 4, perf 3, i18n 2, security 2 (total 219). The 5 `data-loss` items are #191, #248, #475, #658 (all `high`) and #662 (med); the 2 `security` items are #185 (high) and #698 (med).

Triage value: high 25, med 51, low 105, none 38 (total 219).

Upstream link kinds: all 27 shortlisted numbers have no `pull_request` field in the raw JSON, so every link below is `/issues/`.

### 8.3 Results per cluster

Same conventions as section 3. Citations are the investigators' at `52987bd95`, were not re-read by the writer, and the investigators' own hedges are kept. Upstream issue bodies were read from public github.com issue pages (no RisuAI or Realm service contacted).

#### Cluster F: backup, network, save, misc (report: `inv-F\result.md`; 11 items, source only)

| Upstream | One line | Verdict | Data loss / reach | Fix route |
|---|---|---|---|---|
| [#248](https://github.com/kwaroran/Risuai/issues/248) | Trigger scripts omitted from an exported bot card | fixed (`characterCards.ts` writes `triggerscript` on export at the two export sites and reads it on import) | no | none |
| [#475](https://github.com/kwaroran/Risuai/issues/475) | Local backup load decodes then re-stores wrongly | fixed / moot (the upstream code path is gone; the fork's restore was rewritten). Observation only from reading the decode site; no restore was run | no | none |
| [#553](https://github.com/kwaroran/Risuai/issues/553) | macOS Tauri "Load Backup Locally" shows no picker | unclear. The picker uses a detached input clicked after two awaited confirm dialogs; WebKit may no longer count that as a user gesture. Not the display:none cause of #584 | no; edge for this fork (Safari/macOS not a target) | small. Settle by running restore on macOS Tauri or Safari. Idea: click synchronously from the last confirm handler, or use the Tauri dialog plugin on desktop |
| [#584](https://github.com/kwaroran/Risuai/issues/584) | Import character / load backup picker on Safari/Tauri macOS | unclear. Import uses `selectFileByDom` (appends the input, clicks, then hides it), which differs from upstream; restore uses the #553 path | no; edge | small; same settling run as #553 |
| [#698](https://github.com/kwaroran/Risuai/issues/698) | Backup data sent to the hub for a validity check | fixed (premise refuted): the backup code makes no network calls (no fetch/hub/risuai match in `backuplocal.ts`; the only fetch under `src/ts/drive/` is in a test). Fork network destinations listed from source; no backup bytes go to any of them | no | none |
| [#185](https://github.com/kwaroran/Risuai/issues/185) | Main API key sent to the secondary-model proxy | fixed (premise refuted): keys are per provider. Network note: on the hosted web build (not Tauri, not node), `globalFetch` routes non-localhost API calls through `${hubURL}/proxy2` (sv.risuai.xyz), with the Authorization header in the `risu-header`, unless `db.usePlainFetch`/`plainFetchForce`. The investigator found no `usePlainFetch` toggle under `src/lib` (UNCERTAIN, to settle by grepping settings labels) | no | none; maintainer decision 2026-11-02: note it, no change (section 4) |
| [#191](https://github.com/kwaroran/Risuai/issues/191) | Characters and chats missing after login | moot (account sync retired; cause was browser storage eviction; the fork requests persistent storage). Not reproducible from source | historically yes; not reproducible | none |
| [#658](https://github.com/kwaroran/Risuai/issues/658) | DBSaveError "body stream already read" | fixed (no such string in `src`; `nodeStorage.ts` reads each response body once per branch) | no | none |
| [#662](https://github.com/kwaroran/Risuai/issues/662) | iPhone Safari "save file corrupted" | present (edge). `checkCompressionStreams` tests `!CompressionStream` on bare identifiers, which throws a ReferenceError on Safari older than 16.4 before the polyfill import; every call site calls it first. Reachable only on iOS 16.3 and older; outcome is save/load failing, no silent corruption seen. Whether the fork's build target supports such Safari: UNCERTAIN, not checked | no silent loss seen; edge | tiny: `typeof CompressionStream === 'undefined'`. Shipped in harvest batch U3b (6bff60aad) |
| [#184](https://github.com/kwaroran/Risuai/issues/184) | Deleting preset index 0 | fixed (`botpreset.svelte` reloads without saving over the shifted preset; id bounds guarded) | no | none |
| [#205](https://github.com/kwaroran/Risuai/issues/205) | Global regex null flag `trim` TypeError | fixed (`script.flag || 'g'` before `.trim()`). Residual not checked: null `script.in`/`out` | no | none |

#### Cluster G: lorebook, TTS, accessibility, misc (report: `inv-G\result.md`; 16 items, shallow pass per its brief)

The investigator marks several verdicts "shallow" (the subsystem was replaced; the old path was not traced end to end). Those are weaker than a traced fixed.

| Upstream | One line | Verdict | Data loss / reach | Fix route |
|---|---|---|---|---|
| [#340](https://github.com/kwaroran/Risuai/issues/340) | Lorebook word-unit matching misses a keyword | present (narrow). `lorebook.svelte.ts` splits the message on a single space and tests token equality, so a keyword followed by punctuation, a newline or markup such as `*Alice*` is missed | no; normal use for entries with Full Word Matching on | small: split on non-letter/number boundaries (Unicode-aware) or per-key regex with lookarounds, keep multi-word keys working. Needs a maintainer call on languages without spaces. Shipped in harvest batch U3b (6bff60aad) |
| [#200](https://github.com/kwaroran/Risuai/issues/200) | TTS reads the original text, not the translation | present (feature gap, not a defect). Auto speech speaks the stored reply after CBS parse; translation is a display-layer cache never consulted | no; only auto-translate plus TTS users | small to medium; product decision needed. Shipped in harvest batch U3b (6bff60aad) |
| [#209](https://github.com/kwaroran/Risuai/issues/209) | Toggle checkboxes inaccessible to screen readers | present. `CheckInput.svelte`: the real input has `class="hidden"` (display:none), the visible box is aria-hidden, and `aria-labelledby` names ids that do not exist | no; edge (screen-reader users) | tiny to small: one component, wide visual blast radius; test in jsdom. Shipped in harvest batch U3b (6bff60aad) |
| [#230](https://github.com/kwaroran/Risuai/issues/230) | iPhone VoiceOver cannot focus chat text fields | unclear / likely moot (iOS is not shipped). Settle with TalkBack on the chat textarea; not investigated further | no | none |
| [#190](https://github.com/kwaroran/Risuai/issues/190) | Group chat `{{char}}` resolves to the room name | fixed (shallow): `cbs.ts` skips group-type cards and falls back to the speaking character. Assumed callers pass `chara` in group sends | no | none |
| [#175](https://github.com/kwaroran/Risuai/issues/175) | Kobold omits `max_length` | fixed (`request.ts` sends `max_length`, `max_context_length`, `n` and mapped samplers) | no | none |
| [#587](https://github.com/kwaroran/Risuai/issues/587) | Ollama stream shows only the last chunk | moot (shallow): the Ollama path was rewritten on the `ollama` SDK. Not run against a live Ollama | no | none |
| [#208](https://github.com/kwaroran/Risuai/issues/208) | Create-bot-from-AI rejects prompts containing "risu" | moot: grep finds no such keyword check or feature in `src` | no | none |
| [#121](https://github.com/kwaroran/Risuai/issues/121) | Linux AppImage rejects image imports (fs scope) | moot (shallow): imports use the web view's DOM chooser. The fs scope list is `$APPDATA` only, so a direct arbitrary-path read would fail, but no picker path does | no | none |
| [#390](https://github.com/kwaroran/Risuai/issues/390) | Character card import from disk broken on macOS 1.95.0 | moot (shallow): import was reworked; no macOS build in the fork's target set | no | none |
| [#122](https://github.com/kwaroran/Risuai/issues/122) | New group chat needs a refresh (web) | fixed / moot (shallow, untraced). Settle by creating a group in `pnpm dev` once | no | none |
| [#259](https://github.com/kwaroran/Risuai/issues/259) | Switching character cards gives a null map parse error | fixed / moot (shallow, untraced). The exact old `.map` of null could not be mapped; UNCLEAR on the line, low risk | no | none |
| [#384](https://github.com/kwaroran/Risuai/issues/384) | First-run blank screen, `chaId` TypeError | fixed / moot (shallow, untraced). Settle by a fresh-profile boot | no | none |
| [#681](https://github.com/kwaroran/Risuai/issues/681) | "Cannot read properties of undefined (reading 'data')" on every send | unclear. Cause never identified upstream; the fork send path uses `.data` 24 times and the investigator could not isolate which. Needs a stack trace; not actionable | no | none |
| [#596](https://github.com/kwaroran/Risuai/issues/596) | Android chats hang with SupaMemory/HypaV2/Hanurai | unclear (likely moot): the memory pipeline was reworked, but the reported cause (local embedding model download/WASM on Android) was not re-tested | no; normal use on Android if present | one Note 9 run with HypaV2 on a synthetic chat (a spare device exists, per the investigator) |
| [#51](https://github.com/kwaroran/Risuai/issues/51) | Create Character button unresponsive | moot (shallow): 2023 UI, creation flow rewritten, no repro path found; not traced | no | none |

### 8.4 Tally of the 27 investigated items

The writer's count from the tables above (not an investigator's figure):

- present: #662, #340, #200, #209 (4).
- unclear: #553, #584, #230, #681, #596 (5).
- fixed, moot or premise refuted: the other 18 (#248, #475, #698, #185, #191, #658, #184, #205, #190, #175, #587, #208, #121, #390, #122, #259, #384, #51). Of these, the investigators mark #190, #587, #121, #390, #122, #259, #384 and #51 as shallow or untraced.
- Data loss: none of the 27 was reported present as silent data loss. The MVP rule therefore gates nothing from part 2.

### 8.5 Part 2 notes

- Cluster F's summary calls #698 and #185 refuted premises and #662 the only live defect, with #553/#584 unclear. Its table and the tally above agree.
- The investigators' headline ranking put #596 first (needs a device run), then #340, #200, #209. The maintainer then planned #340, #200, #209 and #662 as harvest batch U3b, which shipped in 6bff60aad; the evidence for this update does not list #596 among the planned items.
- By the investigators' static reading, part 2 found no reachable silent data loss in the fork, so nothing from it meets part 1's MVP gating rule. This is a reported result, not a tested one.
