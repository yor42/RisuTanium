# Agents/Tools — campaign tooling

Apparatus for the stabilization campaign. **Not application code and not part of any
build.** Nothing in `src/` imports from here.

## `save-gen/` — synthetic save-data generator and snapshot benchmarks

Generates deterministic RisuAI save data at four sizes and measures the cost of
`$state.snapshot()` over it. Built for Phase 2 (RAM / rendering performance).

- **Seed 1337.** Fixtures are reproducible; a run today matches a run from the session
  that first produced these numbers.
- **Tiers:** `light`, `chat-heavy`, `module-heavy`, `both-heavy`.
- Reuses the repo's real `encodeRisuSaveLegacy` / `decodeRisuSave` via the same
  `vi.mock` pattern as `src/ts/storage/tests/risuSave.test.ts`, so generated `.bin`
  files are real save files rather than approximations.
- **Importable fixtures without vitest.** `make-c04-fixture.mjs` (chat-body rendering) and `make-chat-scene-fixture.mjs` (CHORE-664:
  five characters with 30, 300 and 600-message chats, a prose chat and a script profile, pointed at the device mock) are plain Node
  generators whose `.bin` output imports through the app's load-backup UI. `make-chat-scene-fixture.accept.mjs` is its plain-node
  acceptance test (`node Agents/Tools/save-gen/make-chat-scene-fixture.accept.mjs`; `CHAT_SCENE_GENERATOR` points at a mutant copy).
  It is not collected by `pnpm test`. Its matching reply source is `device/mock-openai.mjs --reply-bytes`.

### Running it

```
npx vitest run --config Agents/Tools/vitest.harness.config.ts
```

Runs from the repo root. The config derives the repo root from its own location, so
there are no absolute paths to update if the repo moves.

### The `.harness.ts` suffix is load-bearing — do not rename

The repo's `vitest.config.ts` declares **no `include`**, so `pnpm test` falls back to
vitest's default glob `**/*.{test,spec}.?(c|m)[jt]s?(x)`. These files were
`*.spec.ts` while they lived outside the repo, where that did not matter. Inside the
repo it does: under the old names `pnpm test` would discover and run them, breaking a
verified baseline of **31 files / 331 passed / 3 skipped** and adding minutes of
benchmark time to every suite run.

`*.harness.ts` does not match that glob. **Do not rename these back to `*.spec.ts`,
and do not add `*.test.ts` / `*.spec.ts` files in this directory.** If you ever need
that, add an explicit `exclude` to the repo's `vitest.config.ts` first and verify the
baseline afterwards.

Baselines were re-confirmed after this directory was added: `pnpm test` 31 files /
331 passed / 3 skipped, `pnpm check` 0 errors / 0 warnings.

### Generated output

`generate-and-verify.harness.ts` writes real fixture `.bin` files to
`Agents/Tools/output/` (~12 MB for a full run). That directory is gitignored. It is
safe to delete at any time; a rerun regenerates it identically from seed 1337.

### Known flake

The `both-heavy` snapshot benchmark can exceed vitest's default 5000 ms per-test
timeout on a loaded machine — it does real `$state.snapshot()` work over ~10 MB of
proxied data. Observed once under the verbose reporter, passing on clean runs before
and after. It is a timing flake, not a defect. Rerun, or raise the timeout for that
case if it becomes persistent.

### Harnesses that mock the app's rune modules: keep them in ONE file

Learned while building `save-gen/trash-restore-repro.svelte.harness.ts` (2026-09-21). The
`<name>.harness.ts` + `<name>.svelte.ts` split used by the benches works when the rune module only
defines test-local state. It **breaks** when the `vi.mock(...)` factory for an app module is split
across files via a dynamic `import()`: the real, unmocked `src/ts/stores.svelte.ts` and
`src/ts/parser/parser.svelte.ts` then load and fire their own top-level `$effect.root` blocks against
the thin mocks, producing unhandled exceptions. A single self-contained file avoids it.

Name such a file `<name>.svelte.harness.ts`. It still ends in `.harness.ts`, so `pnpm test`'s
default glob never matches it, and it carries the `.svelte.` infix that vite-plugin-svelte needs to
compile runes — the same mechanism that lets `src/ts/storage/tests/dbChangeEffects.svelte.test.ts`
use `$state`.

Also note these harnesses measure on whatever machine runs them. Campaign measurements to date were
taken on an i9-13900K; see the Stage B plan (`Agents/Reports/11-...`, section 1.1) before quoting
any absolute millisecond figure as a user-facing claim.

## Reference measurements (2026-09-21, this machine)

Module-heavy tier, 52 modules / 7.27 MB, 3 warmup discarded + 15 measured, three
independent process runs, medians reported with floor alongside:

| Condition | Per `$state.snapshot(modules)` | Floor | Per keystroke (2 calls) |
|---|---|---|---|
| Dev (`DEV === true`) | 34.46 ms | 33.04 ms | 68.92 ms |
| Production (`DEV === false`) | 29.15 ms | 28.65 ms | 58.29 ms |

Frame budget is 16.7 ms. Production was forced by resolving `esm-env` to its
`production` condition and **verified behaviourally** — `snapshot()` only calls
`state_snapshot_uncloneable()` inside the `DEV` branch, so a `console.warn` spy on a
deliberately uncloneable value fired under dev and not under production.

Dev overstates by **1.18x**, not by a multiple. A hypothesis that DEV instrumentation
inflated the headline figure was tested and **disproven**; do not revive it.

**Caveat carried from the measuring session:** these run against a standalone
`$state({db:...})` container, not the real `DBState` wired into the effect graph. They
are raw snapshot cost only and exclude the effects' downstream work.

**CORRECTION (2026-09-21):** this caveat originally said the real per-keystroke figure is
"this **or higher**, never lower". Measured in the live app, that is **wrong on engine speed**:
Chromium ran the same seed-1337 fixture **~2.6x faster** than this Node harness (whole-array
snapshot 11.3 ms in-browser vs 29.8 ms here), while the downstream effect work it warns about
turned out to be only ~0.2 ms. The **ratios** between conditions held (~8x whole-array vs
single-module on both), so these harnesses remain valid for comparing designs — just not for
absolute frame-budget claims. Full measurement: `Agents/Reports/10-...`, section 10.5f.

## Stage A after-measurement (2026-09-21, same machine)

`track-module-deps-bench.harness.ts` measures `trackModuleUpdateDeps()`
(`src/ts/process/moduleUpdateDeps.ts`) against `$state.snapshot(modules)` over the same
seed-1337 module-heavy fixture, in the same process, so the two sides are comparable.
Both sides are measured fresh on each run rather than compared against a number in this
file. Production is forced with `NODE_ENV=production` in front of the command — a
`resolve.conditions` override does **not** work, because Vite injects its own
`development`/`production` condition ahead of custom ones based on `NODE_ENV`.

```
NODE_ENV=production npx vitest run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/track-module-deps-bench.harness.ts --reporter=verbose
```

| Condition | `$state.snapshot(modules)` | `trackModuleUpdateDeps()` | Per keystroke before | Per keystroke after |
|---|---|---|---|---|
| Dev | 33.87 ms | 0.045 ms | 67.74 ms | 33.92 ms |
| Production | 29.18 ms | 0.031 ms | 58.35 ms | 29.21 ms |

**Read the per-keystroke columns carefully.** Stage A replaced **one** of the two
per-keystroke snapshot calls. The other, `dbChangeEffects.svelte.ts:34`, is deliberately
untouched because it gates whether modules are re-encoded to disk. So "after" is
`snapshot + trackModuleUpdateDeps`, not `trackModuleUpdateDeps` alone.

**The frame budget is still missed.** 29.2 ms production is 175% of 16.7 ms, and 33.9 ms
dev is 203%. The surviving `dbChangeEffects` snapshot exceeds the whole budget on its
own. The 2.00x and the ~29 ms saved per keystroke are real; the frame-budget problem is
not solved and Stage A never claimed it would be.

Two deviations from the older measurements above, both deliberate:
- The fixture is enriched with `namespace` / `hideIcon` / `backgroundEmbedding`, which
  `build.ts` leaves unset, so the narrowed read is not timed against absent properties.
  Same shape, size and module count; the freshly measured production snapshot median
  landed within 0.1% of the 29.15 ms published above, which is the cross-check.
- `trackModuleUpdateDeps()` is batched 500 calls per sample and divided out. At ~0.03 ms
  a single call is close enough to timer resolution that an unbatched number would not be
  defensible.

Same standalone-container caveat as above: raw call cost, real figure is this or higher.

## Stage B after-measurement (2026-09-21) — the per-keystroke cost, resolved

Stage A left the frame-budget problem unsolved, as the section above says. **Stage B solved it**, by
partitioning the surviving `dbChangeEffects.svelte.ts` modules effect into an outer effect over
array shape plus one child effect per module — preserving the dependency closure exactly, not
narrowing it. Plan and gate records: `Agents/Reports/11-stage-b-module-effect-partition-plan.md`.

Measured in the **live app**, not this harness: module editor open, real `input` events, timed to
forced layout, identical protocol before and after, i9-13900K, dev build.

| Modules | Before | After | Speedup |
|---|---|---|---|
| 52 | 13.2 ms | 1.9 ms | 6.9x |
| 104 | 25.1 ms | 1.8 ms | 13.9x |
| scaling 52 -> 104 | 1.9x (O(modules)) | **0.95x (flat)** | — |

The flat scaling is the point: cost no longer depends on module count. The ratio and the flatness
are hardware-independent; the absolute figures are high-end-desktop numbers and are **not** a
frame-budget claim for Raspberry Pi or mobile.

Benches added for the Stage B decision, all `.harness.ts`:
- `module-partition-bench` — whole-array vs single-module vs per-element-sum snapshot cost.
- `module-scaling-bench` (+ `module-scaling-fixture.ts`) — asset-heavy module shapes and 52-vs-104
  scaling. **Key result: snapshot cost tracks node count, not bytes** — a 1.03 MB asset-shaped
  module costs ~8x a 1.65 MB cjs-heavy one. The 104 point duplicates the 52-module fixture.
- `module-effect-overhead-bench` — `$effect` scheduling/teardown overhead of N children vs 1
  (below measurement noise). Note: it creates children directly in `$effect.root`, not inside a
  *re-running* parent effect; the real nested path is covered by the app test suite instead.
- `trash-restore-repro.svelte.harness.ts` — **not a benchmark**: an end-to-end reproduction of
  the restore-from-trash data-loss bug (Roadmap CHORE-01 / CHORE-03).

## Measuring in the live app (browser pane) — protocol and traps

The harnesses above run in Node. The Stage B before/after numbers came from the **live app**, which
is the measurement that should back any user-facing latency claim. What worked, and three traps that
each produced a plausible-looking wrong number first:

**Setup.** `.claude/launch.json` defines `risuai-web` on port 5174, but the app needs
`VITE_RISU_LEGAL_CONFIGURED=TRUE`, which `launch.json` does not set. Pass it **inline for the one
run** (`VITE_RISU_LEGAL_CONFIGURED=TRUE pnpm dev`). Do **not** bake it into `launch.json` or a
`.env`: `src/lib/Others/Legal.svelte:6-8` says in capitals not to set it automatically. If a ToS
dialog appears, the **user** accepts it; never click it. The Claude browser pane has its own
storage, which held the seed-1337 **fixture** (52 modules, names like `Module 2 (giant)`) — not
the maintainer's personal data. Check which you are looking at before mutating anything.

**Getting the app's own state.** `await import('/src/ts/stores.svelte.ts')` from the page returns
the live `DBState` and stores. Drive the UI through those stores rather than hunting icons:
`settingsOpen.set(true); SettingsMenuIndex.set(14)` opens Settings -> Modules.

**Trap 1 — after editing a source file, a bare import gives you an EMPTY copy.** Vite then serves
changed modules with a `?t=` cache-busting query, so `import('/src/ts/stores.svelte.ts')` no longer
matches the app's instance and yields a **separate module with its own empty `DBState`**. Symptom:
`Object.keys(DBState.db).length === 0` while the console shows the save decoded fine. Fix: restart
the dev server, then reload.

**Trap 2 — importing `svelte` from the page loads a SECOND runtime.** Its `flushSync` drives a
different scheduler from the app's, and a timed mutation measured **0 ms**. Do not use it. Drain
microtasks instead: Svelte flushes on `queueMicrotask`, so awaiting three nested microtasks after a
mutation is enough.

**Trap 3 — `requestAnimationFrame` never fires while the pane is hidden.** A script awaiting rAF
hangs until the tool times out, possibly **mid-mutation, leaving data dirty**. Time to a forced
synchronous layout instead: drain microtasks, then read `document.documentElement.offsetHeight`.
That captures effect + DOM + layout; it excludes paint, which is small and off the main thread.

**Protocol used for Stage B.** Open the module editor on the largest module, dispatch **real**
`input` events into the name field (native value setter + `new Event('input', {bubbles:true})`),
3 warm-up + 8-10 measured iterations, median/min/max, to forced layout. For module-count scaling,
push deep-copied duplicates with fresh ids (`JSON.parse(JSON.stringify(m))`, new `id`, `DUP ` name
prefix), measure, then `splice` them back off.

**Always restore, and verify you did.** Wrap every mutation in `try/finally` that restores the
original value, then check: module count unchanged, no `DUP ` entries, no stray suffixes on names,
settings UI closed. Trap 3 left a real `Module 2 (giant)w` behind once; it was only caught because
restoration was checked, not assumed.

**Report the hardware.** These figures came from an i9-13900K and are a lower bound on latency.

## `device/` - device-check scripts

PowerShell scripts that run one capped phone check and write `result.json`: see [device/README.md](device/README.md).

## `chatshell-cdp/` - chat-shell CDP harness

Desktop Chrome scenarios (phone emulation, CDP) for the chat shell: see [chatshell-cdp/README.md](chatshell-cdp/README.md). `harness.mjs` injects a logger and is DIAGNOSTIC only; acceptance numbers come from the observer-free reads (`nolog.mjs`). Outputs go under the OS temp dir and never into the checkout. Its accept tests are `node chatshell-cdp/tests/lib.accept.mjs` and `node chatshell-cdp/tests/device-kit.accept.mjs` (plain node, not collected by `pnpm test`).

## `external/` - bounded external workers

The parent uses these tools directly under [subscription-first execution](../../docs/workflow/subscription-first.md), `.claude/workflow-policy.json` and `Agents/Workflow-State.json`. Do not start a Claude relay or comparison investigation. Configuration and synthetic tests do not establish provider authentication, live execution or savings.

- `Export-ExtSnapshot.ps1 -Dest <empty outside-repo directory> [-RepoRoot <root>] [-Extra @('relative/untracked.md')] [-ManifestFile <host file>]` exports current tracked working bytes, including intended dirty files and deletions, plus only named untracked inputs at their relative paths. Only `-Ref HEAD` is supported. Secrets, protected community directories, reparse points and ambient worker configuration are excluded before payload reading. The host manifest defaults to `<Dest>.manifest.json`, outside the worker directory.
- `Invoke-ExtModel.ps1 -DispatchFile <registered-dispatch.json> [-Mode scout|implement|review] [-DryRun]` verifies registered dispatch identity/scope and uses approved models/timeouts. Dispatch fields include `workdir`, `promptFile`, `outFile`, `manifestFile`, `readScope` and `allowedWrites` alongside controller identity. Codex writes only in isolated implementation mode; scouting/review are read-only. Antigravity remains read-only scouting and is unavailable until its actual isolation prerequisites are evidenced; use the next permitted route rather than treating plan mode as a sandbox.
- `node Agents/Tools/external/workspace.mjs inspect --manifest <file> --writes '["src/a.ts"]' --reads '["src/helper.ts"]'` enumerates actual host-checked deltas and rechecks declared input/dependency scope. Metadata supplied by the model is not authority. Reject unexpected paths/types and unauthorized deletions.
- `node Agents/Tools/external/workspace.mjs prepare --manifest <file> --journal <outside-journal.json> --writes <JSON-array> --reads <JSON-array> --dispatch <id>` retains approved payload/preimage evidence before mutation. `apply --journal <file>` checks each preimage and journals progress. `recover --journal <file>` inspects without writing. Interrupted application needs `apply --journal <file> --recover true --disposition <host-recovery-reason>` after explicit host classification. `reconcile --journal <file> --receipt <acceptance-receipt>` records closure after the independent accepting gate; application alone is not acceptance.

  Prepare requires a finished registered implementation dispatch; the manifest hash and read/write scope must match its host registration. The state index binds the immutable operation plan and changing journal receipt. If a crash leaves a phase-updated journal ahead of its indexed hash, inspect `recover`, then use `rebind --journal <file> --disposition <observed-recovery-reason>` only for the unchanged registered operation plan and matching actual pre/postimages. Rebinding verifies retained payloads, changes no application file and grants no acceptance; a reconciled journal whose receipt was lost returns to applied-without-acceptance. Conflicts or changed operation plans stop recovery. A prepare orphan with no index has made no application mutation; preserve it and explicitly replace that preparation rather than manufacturing an acceptance receipt.

Use `node .claude/scripts/workflow-control.mjs --help`, `status`, and `route --job <logical-id> --mode scout|implement|review` before registration. Register exact scope with `register --file <dispatch.json>`, record observed failures with `failure --id <id> --reason quota|unavailable|failed [--reset <ISO>]`, and finish with `finish --id <id> --status completed|partial|failed`. State changes use `state --file <patch.json> --generation <expected-generation>`. Explicit `refresh --provider codex|agy|openrouter|claude` invalidates a cached unavailable route; it is not permission to probe exhausted providers per ticket.

Workers receive no dependency junction or copied `node_modules`. They must not install dependencies or run install lifecycle scripts. The named host check owner runs applicable targeted checks with the real dependencies and records their snapshot. This isolation trades worker-side execution for host-owned verification; do not claim a worker test pass when it could not run.

Keep full prompts/logs/results in the registered ignored scratch dispatch directory. Partial/quota-stopped work retains its logical job, input identity, host-verified progress and one-correction allowance. A provider/context change never resets the cap or accepted batch evidence. OpenRouter is an optional guarded fallback, not a CLI subscription route; paid execution remains disabled when its verified pricing/request bounds/key/accounting prerequisites are missing. Cheap Agent remains inactive in this project.

Only the process tree the runner starts may be terminated. Integrate through the prepared journal, not by trusting worker status or blindly copying a workspace over the host. Independent combined-batch review remains mandatory. The old 2026-10-29 model timings are historical measurements, not cost/speed promises for this workflow.
## `run-mutants.mjs` - mutant runner

`node Agents/Tools/run-mutants.mjs --spec <spec.json> [--repo <root>] [--out <dir>] [--timeout-s N]` breaks one source file in memory, once per mutant, and runs only the named vitest files against it. Spec: `{ "source", "tests": [explicit test files], "mutants": [{ "id", "find", "replace", "occurrence"?, "note"? }] }`. The full contract is in the script's header comment.

- Nothing in the repository is written, renamed or copied. A scratch vitest config under `--out` (default `%TEMP%\risu-mutants\<timestamp>`; a dir inside the repo is refused) extends the repo's `vitest.config.ts` and adds a Vite plugin whose `load()` returns the mutated text for the source path. `include` is pinned to the named files, so a folder or glob is refused.
- A baseline run with no mutant goes first; a red baseline, one with zero passed tests, or one that never loads the source stops the tool (exit 2). Mutants then run one at a time.
- `find` must match exactly once in the text as read from disk (use `occurrence`, 0-based, to pick among repeats); otherwise the mutant is INVALID and not run. A CRLF file needs `\r\n` inside a multi-line `find`.
- KILLED means a test failed (vitest JSON reporter, failed tests > 0). A collection, import or transform error leaves no failed test and is ERROR, as is a run with zero passed tests (none ran, or all skipped). Failed tests whose every failure message is a transform, syntax, parse or module-load error ("Transform failed", "SyntaxError", "Failed to load url", "Cannot find module"...) are also ERROR; any other message (an assertion, "x is not a function", a fast-check "Property failed" wrapper) stays KILLED. The plugin records whether the source module was requested: a baseline that never loads it stops with exit 2 ("source not loaded by the named tests"), and a mutant run that did not load it is NOT-LOADED. Every row and `results.json` carry passed/failed/skipped counts (`p/f/s`). TIMEOUT kills only the process tree the tool started. SURVIVED means at least one test passed, none failed and the source was loaded.
- Exit 0 only when every mutant is KILLED; 1 otherwise; 2 on baseline failure or usage error. `--repo` points at a worktree (default: git toplevel of the cwd).

## `run-full-tests.mjs` - full-suite runner (CHORE-662)

`node Agents/Tools/run-full-tests.mjs [--repo <root>] [--out <dir>] [--max-workers N] [--max-wait-min M] [--timeout-min T] [--flake-list <file>] [--lock-dir <dir>] [--vitest-bin <file>]` runs the whole vitest suite under a machine-wide lock with a worker cap, reruns each failed file alone once, classifies the result and writes a scratch record. Windows only. Per MC-694 one named owner runs the full checks; the tool does not enforce or relax who that is (see `docs/workflow/gates.md`, which also defines the run-alone rule it implements).

- **Lock.** Cooperative: only suites started through this helper are serialised, so direct `vitest`, `pnpm test`, builds, mutant runs and device harnesses still load the machine; the record carries the `node.exe` count to make that visible. The lock file lives in `%LOCALAPPDATA%\Temp\risu-fullrun` (override `--lock-dir`, recorded as non-default). A waiter polls and gives up after `--max-wait-min` (default 30) with BLOCKED, naming the holder pid and start time. A lock is reclaimed only when the holder process is gone (dead, or alive with a different OS start time) and its recorded vitest child is gone too; an unknown probe result means held. An unreadable lock is held while under a minute old. A guard file older than a minute is never removed automatically: BLOCKED names it and a person removes it. No process is signalled except the helper's own vitest child tree.
- **Run.** `node <vitest-bin> run --maxWorkers=N` (default 8, `DEFAULT_MAX_WORKERS` in the script) with one added reporter, `Agents/Tools/full-run/fullrun-reporter.mjs`, which writes `first/summary.json` (path passed in `RISU_FULLRUN_SUMMARY`; any summary already at that path is removed before the run). The environment is otherwise unchanged and there is no vitest `retry`.
- **Exit codes.** 0 PASS, 1 FAIL or FAIL-ERROR, 2 usage/setup or unsupported platform, 3 PASS-RECOVERED, 4 BLOCKED. The last stdout line is `FULLRUN <verdict> exit=<code> record=<path>`. PASS-RECOVERED never exits 0 and is never printed as PASS.
- **Verdicts.** A failed file is RECOVERED-ALONE only when every error message in it (module, suite and test level) is a vitest timeout (`Test timed out in Nms.` or `Hook timed out in Nms.`), the file is on `Agents/Tools/full-run/flake-list.json` by exact repo-relative path, and its single rerun alone (`run <path> --maxWorkers=1`) passes with exactly that one module and at least one passed test. Every failed file is rerun once. PASS-RECOVERED needs every failed file recovered. Anything else, including a file with an assertion failure next to a timeout, is FAIL. FAIL-ERROR (no reruns): missing, unparseable or wrong-schema summary, own-timeout kill, an interrupted run, any unhandled error, a collect error, an exit code that disagrees with the failed modules, or more than 10 failed modules.
- **Record.** `fullrun-record.json` and `fullrun-record.md` (verdict on line 1) in `--out` (default `%TEMP%\risu-fullrun\<timestamp>`; a dir inside the repo is refused): git snapshot (`--no-optional-locks`, no index writes), runtime, lock outcome and any reclaim, first-run result, per-file verdicts. Scratch only; cite it by path. The first-run failure stays in the record.
- **Flake list.** `{ "files": [{ "path", "reason", "evidence", "added" }] }`. Changes only through a reviewed edit that cites a helper record showing a timeout-only failure that passed alone. The tool's own tests (`Agents/Tools/full-run/*.test.mjs`) never go on the list.
- **Classifier fixtures.** `Agents/Tools/full-run/fixtures/` holds summaries captured from real vitest runs of synthetic specs (`node Agents/Tools/full-run/capture-fixtures.mjs <outDir>`; it refuses a git checkout other than the fixtures directory itself). A vitest upgrade requires running it again: the classifier depends on the reporter summary shape and on vitest's message text, and `classify.test.mjs` fails while `fixtures/meta.json` names a different vitest version than the installed one.
- **Measured numbers.** The 4 and 8 worker wall times and the default decision belong to the lane A runs (TODO(evidence): stage 3).
