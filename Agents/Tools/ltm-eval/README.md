# ltm-eval

Tooling for the ChroMemory (long-term memory) work. No application code is touched. It has two parts that share no files.

1. **Generator and BM25 eval.** A deterministic synthetic roleplay dataset (`gen/`) and a port of the BM25 half of the M2 retrieval analysis (`bm25.mjs`, `eval-bm25.mjs`). The tokenisers are the M2 versions, unchanged (lowercase without NFKC, Hangul as code-point bigrams or whole words, Latin stemmed). They are not the spec 5.3 tokeniser.
2. **`.bin` analyzer** (`analyzer/`). It reads a `.bin` through the application's own import reader and writes numbers only.

## Commands

Run from the repository root, naming one harness file at a time (never a folder):

```powershell
node node_modules/vitest/vitest.mjs run --config Agents/Tools/ltm-eval/vitest.ltm.config.ts Agents/Tools/ltm-eval/eval.harness.ts
node node_modules/vitest/vitest.mjs run --config Agents/Tools/ltm-eval/vitest.ltm.config.ts Agents/Tools/ltm-eval/bin-analyzer.harness.ts
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
- Inside the child, `withSealedOutput` replaces every console method, `process.stdout.write`, `process.stderr.write` and `process.emitWarning` with counting no-ops while the analysis runs. The application logs block names and error messages on the import path; the seal works on channels, so it does not depend on listing those log sites.
- Output is two files in `LTM_OUT`, each written only after a shape check: `ltm-aggregates.json` (numbers and arrays of numbers; no string value anywhere; every label is a key of the fixed shape) and `ltm-status.json` (numbers only: step index, error-class index, call counts, `degraded`).
- Errors leave a step only as a fixed message plus two indices. The analyzer reads only `omitted.size` of the reader's omitted-block map, because its values carry block names and error messages.
- A failed run leaves only the status file. To debug, reproduce with a synthetic file.
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
