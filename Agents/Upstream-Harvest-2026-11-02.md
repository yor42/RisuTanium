# Upstream harvest 2026-11-02 (kwaroran/Risuai issues and unmerged PRs)

Status: lane A draft, NOT independently verified (no doc-verifier pass). Uncommitted. Partial: upstream #1-#702 are not yet fetched or triaged, so this records the funnel result for #703-#1712 only. Fork state was read at `main` `031bfddf1`. Every per-item verdict below is an investigator's report from static source reading and is "reported", unless section 3 says lane A confirmed it directly. Working files live under `%TEMP%\risu-b715\b35\` (`upstream\`, `u1-plan\`); they are scratch, not records.

## 1. Purpose and method

Upstream holds old issues and never-merged PRs with sound ideas. Many PRs were AI-made or did not fit upstream's vision, so the question asked per item is whether the defect or idea still applies to the fork, not whether upstream merged it.

Funnel stages:

1. Fetch: raw GitHub issues API pages for kwaroran/Risuai (the endpoint returns issues and PRs together).
2. Set merged PRs aside (assumed to be in the fork already; not checked, see section 5).
3. Triage the unmerged items with Haiku (class, area, value, reachability, one-line summary). Triage read only the first 700 characters of each body.
4. Shortlist, rule given by lane A: triaged value `high`, OR triaged class `data-loss` or `security`. This is why #1058 (class security, value med) and #1582 (class data-loss, value low) joined the 45 `high` items.
5. Per-cluster investigation (clusters A to E): does the defect still exist in the fork, and is it reachable in normal use. Static source reading only.
6. Batch U1: a plan for the two defects lane A confirmed, now being implemented.

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

U1, in progress (plan `u1-plan\plan.md`, now being implemented as batch U1; this document does not claim it is merged or tested). These are the only items the MVP rule gates:

- U1a, multibyte stream decoding. Anthropic (`anthropic.ts`) and Gemini (`google.ts`) readers. Plan: one `TextDecoder` per byte stream, `{stream:true}` on each chunk, plus an end flush. The plan's survey of other readers found no other chat-reply reader with the defect; its own coverage label is PARTIAL (`Buffer#toString` decoding was checked only in one file). The end flush and fresh retry decoder are described by the plan as hygiene with no observable test.
- U1b, `setFullChat` metadata. Plan: in `setFullChatMain`, a message with the same index, role and data starts from a shallow copy of the previous message, so all fields survive. An edited message still carries nothing (index alone cannot tell an edit from a shift, so carrying fields by index could attach them to the wrong message). Edited messages keep losing metadata until a real identity exists.
- The plan's tests (two reproducers and two guards for U1a, one reproducer and two guards for U1b, plus mutants) are DESIGNED, NOT DEMONSTRATED. The plan's gate route skips Gate 1 and sends Gate 2 to opus-reviewer, on the condition that the review brief includes the edited-message decision and the shared reactive-proxy point.

Non-gating backlog (not scheduled):

- #1667: nested lorebook folder delete (small).
- #1387 residual guards: `saveCurrentPreset` out-of-range id, `applyLoadout` pushing `undefined` (tiny).
- #1426 / #1495: auto-translate versus streaming (small; render-cache logic, needs the gates).
- #1327: greedy Thoughts regex. Unverified at runtime; verify before fixing (tiny fix).
- #843: Firefox iOS export notice. Needs a maintainer call because iOS is not a target.
- Open question rather than backlog: #718 (empty-database-on-boot trace), because upstream reported data loss; reach in the fork is unclear.

Leads, not verified:

- The Anthropic overload retry resets `parserData` but not the line index (`i`), so the new response's first lines may be skipped. The plan calls this probably harmless preamble and unverified. Plan cites `anthropic.ts` lines 1014-1040 at `031bfddf1`.

Maintainer question (non-blocking):

- Should Lua `getFullChat` expose `chatId`, so `setFullChat` can match by identity and keep metadata on edited messages (upstream #1611's approach)? It is a Lua API addition. The plan recommends deferring it. Not decided.

## 5. Limits

- Triage read only the first 700 characters of each body. It is Haiku output and unverified.
- The investigations were static source reading only. No runtime probe, device run or test was executed for any verdict here. Several investigators flag specific unrun checks (jsdom sanitizer for #1628, 400 MB scale for #804, iOS for #843, a mount test for #1586).
- Issues #1-#702 are not yet triaged; the fetch is pending or partial. This document covers only the 1000 items seen (#703-#1712, 10 numbers in that range absent, cause unconfirmed).
- The 571 merged PRs were assumed to be already in the fork. That was not checked.
- Cluster A to E investigators read upstream items from the GitHub web pages or the local raw dump; the #1351 body was not parsed.
- This document is to be updated when the remaining pages are fetched and triaged.

## 6. Open items

- Pending: fetch and triage of #1-#702; then update this file.
- Pending: U1 implementation, review and verification results; record them separately once they exist.
- Unconfirmed: why 10 numbers in #703-#1712 are absent (see section 2).

## 7. Citation and consistency notes

- Cluster A's headline says "7 of 8 items fixed or superseded"; its own sections give 6 of 8 numbers fixed (#1352, #1424, #1519, #1563, #1353, #994) and 2 present (#1564, #1611).
- Cluster B's headline says "Four of six are fixed"; its sections give three plainly fixed (#1041, #1042, #1530), one present (#1667), and #1351/#1387 as fixed with residual edges.
- Triage rated #1667 `normal-use`; the cluster B investigator reports `edge`. The investigator's reading is used above.
- Triage rated #706 `normal-use` and #1582 `unclear`; the cluster C investigator reports #706 moot/unclear and #1582 fixed.
- Cluster D reports #1327 as present but only from the regex and the append logic; it did not verify the stored-message shape at runtime.
