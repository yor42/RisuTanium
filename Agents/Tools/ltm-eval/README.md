# ltm-eval

Tooling for the ChroMemory (long-term memory) work. No application code is touched. It has three parts; the S0 harness (3) reads the generator's builder (`gen/build.mjs`) and shares nothing else with the other two.

1. **Generator and BM25 eval.** A deterministic synthetic roleplay dataset (`gen/`) and a port of the BM25 half of the M2 retrieval analysis (`bm25.mjs`, `eval-bm25.mjs`). The tokenisers are the M2 versions, unchanged (lowercase without NFKC, Hangul as code-point bigrams or whole words, Latin stemmed). They are not the spec 5.3 tokeniser.
2. **`.bin` analyzer** (`analyzer/`). It reads a `.bin` through the application's own import reader and writes numbers only.
3. **S0 harness** (`s0/`). The spec 5.3 tokeniser and BM25 scorer, corpora, turn-shaped queries, the engine simulation and the go/no-go gate of spec 5.7. See "S0 harness" below.

## Commands

Run from the repository root, naming one harness file at a time (never a folder):

```powershell
node node_modules/vitest/vitest.mjs run --config Agents/Tools/ltm-eval/vitest.ltm.config.ts Agents/Tools/ltm-eval/eval.harness.ts
node node_modules/vitest/vitest.mjs run --config Agents/Tools/ltm-eval/vitest.ltm.config.ts Agents/Tools/ltm-eval/bin-analyzer.harness.ts
node node_modules/vitest/vitest.mjs run --config Agents/Tools/ltm-eval/vitest.ltm.config.ts Agents/Tools/ltm-eval/s0/s0.harness.ts
```

`*.harness.ts` files are never collected by `pnpm test`.

Command-line tools:

```powershell
node Agents/Tools/ltm-eval/gen/gen.mjs <dir under the temp folder>
node Agents/Tools/ltm-eval/eval-bm25.mjs <datasetDir> <outDir>
```

`golden/` holds the sha256 of the four dataset files, the 32 BM25 aggregate keys and the 29 BM25/T9 table rows of M2. They were extracted from M2's original outputs, never from this port. The dataset is regenerated, not committed.

## Real `.bin` run

Only with the maintainer's explicit OK, and only through the launcher. The launcher and the seal are the only supported privacy mechanism. A run directly through `pnpm vitest` or `node ... vitest.mjs` skips the real-run suite on purpose.

```powershell
$env:LTM_ROOT='<run folder, outside the repository>'; $env:LTM_BIN='<the .bin, under LTM_ROOT>'; $env:LTM_OUT='<out folder, under LTM_ROOT>'
$env:LTM_HEAP_MIB='<MiB>'   # optional
node Agents/Tools/ltm-eval/run-real.mjs
```

- The launcher runs vitest as a child process with all stdio discarded and prints one line, `ltm-eval real run: exit <code>`. It reads no output file.
- The launcher resolves `LTM_ROOT`, `LTM_BIN` and `LTM_OUT` to absolute paths once (against its own working directory), checks them, removes any stale `ltm-status.json` and `ltm-aggregates.json` from `LTM_OUT`, and passes the same absolute paths to the child. A refused layout therefore spawns nothing and writes nothing.
- Exit codes are the launcher's own; the child's status is mapped, never passed through:

  | code | meaning |
  |---|---|
  | 0 | the analysis completed |
  | 1 | the test failed or the worker crashed; `ltm-status.json` says how far it got |
  | 2 | a required variable is missing |
  | 3 | the path guard refused the layout; nothing was spawned or written |
  | 4 | launcher-side failure: a signal on POSIX, a spawn failure or timeout, or an exception in the launcher (for example a stale status file that cannot be removed). On Windows a killed child reports status 1, not a signal, so a killed run reads as exit 1 (with a marker if it got that far) |
  | 5 | the child ended with any status other than 0, 1 or 134; it can come with no status file (for example `LTM_HEAP_MIB` too small for the child to start) |
  | 134 | the child's main process aborted, typically out of memory |

- Reading a failure: with a passed launcher guard, exit 1, 5 or 134 and **no** `ltm-status.json` means the child died before it wrote its marker (vitest or application module load, an out-of-memory during import, or the child's own path guard). A marker means the run reached the analysis: `phase` is the last step reached (-1 before the file is opened, then 0 index, 1 scan, 2 readDatabase, 3 decode, 4 resolve, 5 aggregate, 6 stream), `started 1, completed 0` is a run that did not finish, and `failedStep`/`errorClass` are set only when a step failed cleanly. `phase` and the peaks are the last written values; inside a long phase they are lower bounds. Because the launcher removes stale outputs, "no file" is reliable only through the launcher.
- Status fields beyond the original ones: `started`, `phase`, `streamed` (-1 not decided, 0 whole-tree path, 1 streamed path), `declineReason` (index into `DECLINE_REASONS` in `analyzer/status.ts`, -1 when the stream did not decline), `peakHeapMiB` (largest sampled used heap, a lower bound), `maxRssMiB`, `heapLimitMiB`. The status file's `schemaVersion` is 2; the aggregates file stays at 1.
- Two paths read the database entry. The streamed path (`streamBinDatabase`, the application's own reader) resolves and aggregates one character at a time and never holds the character list. When the reader declines a layout it cannot reproduce (remote or root-component blocks, a second root, zlib, and so on), the analyzer discards everything the attempt collected and runs the whole-tree path from a fresh state; `declineReason` then names why. Both paths produce the same aggregates and counts for every file the whole path can read.
- Heap: the default heap (about 4 GB) was enough on every synthetic shape measured, including a 30 GiB file; the streamed path needed 160-224 MiB of old space on the heaviest one, the whole-tree path 768-1024 MiB. These figures are from synthetic files; the real `.bin` was never measured. Leave `LTM_HEAP_MIB` unset. If a run crashes with `declineReason >= 0` (the whole-tree path ran), set `LTM_HEAP_MIB=2048`; never 24576.
- The tests do not prove a memory bound: `H1` shows only that the analyzer keeps no owner list while the streamed path runs. The bound is shown by running the launcher at a small `LTM_HEAP_MIB` on a large synthetic file.
- Inside the child, `withSealedOutput` replaces every console method, `process.stdout.write`, `process.stderr.write` and `process.emitWarning` with counting no-ops while the analysis runs. The application logs block names and error messages on the import path; the seal works on channels, so it does not depend on listing those log sites.
- Output is two files in `LTM_OUT`, each written only after a shape check: `ltm-aggregates.json` (numbers and arrays of numbers; no string value anywhere; every label is a key of the fixed shape) and `ltm-status.json` (numbers only: progress and peak figures, step index, error-class index, call counts, `degraded`).
- Errors leave a step only as a fixed message plus two indices. The analyzer reads only `omitted.size` of the reader's omitted-block map, because its values carry block names and error messages.
- A failed run leaves only the status file (a stale aggregates file is removed by the launcher). To debug, reproduce with a synthetic file.
- The `.bin`, the out folder and the run root must lie outside the repository, and the `.bin` and the out folder under the run root.
- `degraded: 1` means a cold unit could not be read or a block was left out of the database. The reader then puts one placeholder message into each incomplete chat unit, so the message histograms overcount by one placeholder per incomplete unit; such an output is not a usable profile without a re-export.
- Decorator counts come from the real `CCardLib.decorator.parse` with a callback that mirrors the return values of the application's lorebook callback in `src/ts/process/lorebook.svelte.ts` (the `false` returns decide whether a `@@@` fallback line runs). That callback is the source of the table in `analyzer/decorators.ts`; when it changes, the table must follow.

Environment variables: `LTM_ROOT`, `LTM_BIN`, `LTM_OUT` (real run), `LTM_HEAP_MIB` (launcher), `LTM_SEALED` (set only by the launcher), `LTM_REPO_ROOT` (launcher), `LTM_CANARY` (the end-to-end launcher test only), `LTM_IMPL_DIR` and `LTM_EVAL_DIR` (scratch mutant runs; the launcher deletes `LTM_IMPL_DIR`).

## Output fields

`H` is `{edges, counts, n, p50, p90, p99, max}`: `counts[i]` holds `edges[i] <= v < edges[i+1]`, the last bucket is `>= last edge`, quantiles are nearest-rank (`sorted[ceil(q*n)-1]`), and everything is 0 when `n` is 0.

- `totals`: `characters` (entries that are not groups), `groups`, `chats`, `messages` (active path), `messagesUser`, `messagesChar`, `nonStringMessageData`, `hiddenMessages`, `hiddenByFlag`, `hiddenByReset`, `altMessages`, `modules`, `enabledModules`, `loreEntriesCharacter`, `loreEntriesGroup`, `loreEntriesChat`, `loreEntriesModule` (folder entries excluded), `regexScriptsGroup`, `incompleteUnits`, `omittedBlocks`.
- Hidden messages use the application's rule (`isHiddenAt`): `disabled === true`, or at or before the latest `allBefore` flag. "By reset" means at or before that flag.
- `hiddenShare`, `hangulBandEdges`.
- `messageLength`: `edges`, `byRole.{user,char}`, `byHangulBand.{none,low,mixed,high}`, `byRoleAndHangulBand.{user,char}.{none,low,mixed,high}`: all `H`, in code points. A band is the share of Hangul code points among letter code points: `[0,0.1)` none, `[0.1,0.5)` low, `[0.5,0.9)` mixed, `>= 0.9` high; a text without letters has share 0.
- `messagesPerChat`, `loreEntriesPerCharacter`, `loreEntriesPerChat`, `loreEntriesPerModule`, `loreContentLength` (code points of the body the decorator parser returns), `regexScriptsPerCharacter` (non-group owners), `regexScriptsPerModule`: `H`.
- `lore`: `selective`, `useRegex`, `alwaysActive`, `withDecorators` (entries with at least one callback), `decoratorLines` (callback invocations), `decoratorThrows` (entries where the application's callback would throw), `decorators.<33 names + other>`, `mode.<normal, constant, multiple, child, folder, other>`.

## Dataset schema (generator output)

Four fully synthetic roleplay chats (2 English, 2 Korean) with planted facts, plus 40 questions per chat in LongMemEval-style categories. Nothing comes from real user data. `gen/gen.mjs` is seeded, so a second run gives byte-identical files.

```
meta      { id, language ("en"|"ko"), seed, setting, message_count, user_name, char_name,
            length_unit ("words"|"characters"), mean_length, min_length, max_length,
            decoy_messages, question_count, generator }
messages  [ { id: 0..N-1, role: "user"|"char", text } ]       // id == array index; even ids are user turns
questions [ { id: "en1-q01",
              category: "single_fact" | "knowledge_update" | "temporal" | "multi_message" | "invented_name" | "abstention",
              key: template key,
              question: the main wording (shares vocabulary with the planted sentence),
              question_paraphrase: a reworded variant with the same answer and less shared vocabulary (entity names kept),
              answer: gold answer string (null for abstention),
              gold_ids: message ids that contain the evidence (empty for abstention; both ids for multi_message and for temporal-order questions),
              stale_ids: knowledge_update only, the earlier message holding the outdated value,
              stale_answer: knowledge_update only,
              term: invented_name only, the invented word,
              context_ids: [i, i+1], two consecutive filler messages from the last 48 messages of the chat,
              answer_in_other_messages: number of non-gold, non-stale messages whose text contains the answer string } ]
facts     [ { type: SF|KU|TR|TO|MM|IN|IN_MENTION|AB|DECOY, key, ids (message ids), answer, ... } ]
```

Chats: `en1` (820 messages), `en2` (640), `ko1` (740), `ko2` (900). Intended use: index messages (or windows of 3), query with `question` (optionally prefixed with the `context_ids` messages), and score whether any or all `gold_ids` rank high. For `knowledge_update`, the `gold_ids` message must rank above the `stale_ids` message. Abstention has no gold.

Known limits: template-generated, so sentence structure repeats; question wording reuses words from the evidence sentence by default (`question_paraphrase` reduces that; entity names are kept); answers are short strings; decoy values can coincide with real answers on purpose.

## Mocks

The analyzer imports the application's storage modules, which reach stores, alerts and platform code. `bin-analyzer.harness.ts` mocks those in that one file (the same set as the CHORE-807 census harness). Keep all mocks in that file.

## S0 harness

S0 decides whether ChroMemory proceeds (spec 5.7). It produces outputs for S1 only through a tune run and one gate attempt per builder; both run outside the test suite and write only to a folder under the temp directory.

Files (`s0/`): `lexical.ts` (tokeniser, BM25, RRF, top-IDF terms, admission; no imports, erasable TypeScript, so S1 can move it into `src`), `counter.mjs` (llama3 app counter, o200k sensitivity, stub), `profile.mjs`, `corpus.mjs` (M4 and the named-filler corpora, seeds), `turns*.mjs` (turn-shaped queries, overlap), `sim.mjs` (trim, units, rank, pack, baselines, make-room, recall), `stats.mjs` (cluster bootstrap, cluster-t, stop rule, verdict), `controls.mjs` (validity controls), `select.mjs` (output selection), `attempts.mjs` (the ledger and the INVALID procedure), `tune.mjs`, `gate.mjs`, `report.mjs`. `gen/build.mjs` holds the chat builder; `gen/gen.mjs` is its CLI and its output is byte-identical to the original generator (the `eval.harness.ts` sha256 test pins that).

Decisions it carries: gate cells M4 and NF-real, each in EN and KO, all four must pass (MC-2627); gate context 32768 tokens of chat history, with 16384, 65536 and 131072 reported (MC-2628); the baseline is the engine's split units newest-first, with whole messages reported (MC-2629); a budget above 1200 up to the 15% cap is allowed and its per-send cost reported (MC-2630); INCONCLUSIVE is not a pass (MC-2631); the query tail stays at 500 characters with the loss by cue position reported (MC-2632); real-derived numbers stay in the temp folder (MC-2633); the pass rule applies to ask turns and allude turns separately in every cell (MC-2642, fixed in code).

Seeds: TUNE 510001, GATE 610001, GATE-R 620001 (full-text noise rerun), FALLBACK 710001, FALLBACK-R 720001 (IDF noise rerun). The chat seed is `(drawSeed * 1009 + corpusIdx * 101 + langIdx * 17 + i)`. `tune.mjs` accepts only TUNE. `gate.mjs` accepts a builder's own GATE or FALLBACK family, refuses settings whose `tuneDrawSeed` is not TUNE and settings whose sha256 does not match their content. The full-text builder runs first; the IDF builder runs only after a recorded GATE FAIL.

Commands (run from the repository root; the aggregates and every output path must lie outside both checkouts, and real quantiles are never printed):

```powershell
node Agents/Tools/ltm-eval/s0/tune.mjs --real-agg <aggregates.json> <outDir>
node Agents/Tools/ltm-eval/s0/gate.mjs record-settings --builder fulltext --settings <outDir>/settings-fulltext.json
node Agents/Tools/ltm-eval/s0/gate.mjs record-settings --builder idf --settings <outDir>/settings-idf.json
node Agents/Tools/ltm-eval/s0/gate.mjs --draw 610001 --settings <outDir>/settings-fulltext.json --real-agg <aggregates.json> <outDir>
node Agents/Tools/ltm-eval/s0/gate.mjs verdict --builder fulltext
```

Read the D1 lines `tune.mjs` prints (`D1 <builder> <cell>: PASS` or `INVALID (<style> <control> FAIL-CONFIRMED)`, then one `D1 <builder>:` line; the same data is `diagnostics.<builder>.d1` in `tune-report.json`) before spending a gate seed. If a builder's line says INVALID, the gate would be INVALID on the same structure: do not run it, ask the maintainer.

The ledger is `--ledger <file>`, else one fixed file, `<temp dir>/ltm-s0/gate-attempts.json`, never a path derived from the out dir; use the same ledger for every command of a run (a different file has no recorded settings and refuses every attempt). The maintainer's larger run after an INCONCLUSIVE stop (or a MAINTAINER REPORT stop) is two commands: `gate.mjs record-override --builder <b> --settings <new settings file> --draw <fresh seed> --cap <chats above 48> --ref <MC id>` records a new epoch (the new settings must be a new tune output with a new sha256, the seed must not be a protected seed), then `gate.mjs --kind OVERRIDE --draw <that seed> --settings <new settings file> --real-agg <aggregates.json> <outDir>` runs it with the recorded cap.

After a VALID verdict is issued and its ledger entry saved, the gate also reports NF-specLong and NF-specShort (EN and KO, 12 chats each, no stop rule) under their own heading; they are reported only (MC-2627) and never affect the verdict, the controls or the ledger. An INVALID attempt reports none.

Validity and the attempt ledger: after every cell has stopped, three controls (ORACLE-RANK and ORACLE-QUERY must reach 0.9, NULL must not exceed max(baseline, RANDOM) by more than 0.05) are tested on each cell's final sample, per style, by a one-sided Bonferroni interval over the attempt's control tests (alpha = 0.05 / (cells x styles x 3)). A control fails only when the chat-cluster bootstrap bound and the cluster-t bound both exclude its threshold. A confirmed failure makes the attempt an INVALID EXPERIMENT: the verdict is not computed and no engine-arm statistic is written, printed or recorded. The ledger (`gate-attempts.json`, append-only) refuses a rerun unless it follows the pre-registered procedure: a DEFECT rerun on the same seed family needs a recorded defect (a reproducer test and a Gate 2 verdict path) and unchanged settings; without a defect the failure counts as noise and gets one rerun on the fresh R seed with the same settings hash; at most two DEFECT reruns, one NOISE rerun and three attempts per builder; the first valid attempt is final. A stop ends in MAINTAINER REPORT. INCONCLUSIVE is a valid, final attempt; a larger run the maintainer authorises is an override entry with a new settings hash, a fresh seed and a larger cap (`record-override`), not a NOISE rerun.

Estimates: the false-INVALID bound (about 0.05 familywise) and the power figures (a control detects an oracle below about 0.76 or a NULL delta above about 0.15 at 12 chats) are reasoning estimates. The D2 diagnostic in `tune.mjs` measures only the per-test false-INVALID rate.

KO overlap rule (pre-stated): an allude cue may share at most one unit with its plant span. For Korean the unit is a whitespace word; a word counts 1 if at least one of its bigrams is in the span, not in the cast or entity names and not a function bigram (a bigram found in at least 5% of the chat's messages). A word that starts with a cast name or an entity counts 0. The English unit is the spec token (words; the spec tokeniser does not stem).

Tokeniser corner cases (kept; S1 states which reading it keeps): a mixed Han plus Hangul or Han plus Kana run forms bigrams across the script boundary; a combining mark after a Hangul syllable becomes its own token; NFKC maps compatibility jamo and half-width kana before the split.

Tests: `s0/s0.harness.ts` runs the guards (tokeniser, scorer, generator options, merge, turns, overlap, trim, pack, make-room, recall, counter, statistics, controls, ledger, selection, a tiny tune and gate). It never runs `tune.mjs` or `gate.mjs` on the TUNE, GATE, GATE-R, FALLBACK or FALLBACK-R seeds. Scratch mutants run against a copy of this folder named by `LTM_S0_DIR` (the S0 modules) and `LTM_EVAL_DIR` (the generator).
