# store2 replay tools: mutants and long PCT runs

Portable copies of the stage 2 mutant runner and the long PCT (seeded schedule) runner. Nothing here writes to the repository:
mutants are applied in memory while a module loads, and every output goes to a scratch directory.

## Paths

| Variable | Meaning | Default |
|---|---|---|
| `RISU_ROOT` | repository root | found relative to the file (four levels up from this directory) |
| `RISU_SCRATCH` | output and Vite cache directory | `risu-replay-tools` under the OS temp directory |

The PowerShell drivers take the same two values as `-Root` and `-OutDir`.

Vitest must run with the **repository root as its working directory**, or `/vitest.setup.ts` is not found. The PowerShell
drivers and `pct-driver.mjs` change into the root themselves; a hand-run `vitest` must be started from the root.

## Files

| File | Role |
|---|---|
| `mutants.mjs` | Every mutant definition, flattened from the stage 2 chain and deduplicated by name; a comment names each source file. `neverLoaded` is a harness probe, not a mutant. Server-copy mutants are not here: they live in `server-mutants.ps1`. |
| `mutant.config.mjs` | Vitest config. Applies the mutant named by `l7_MUTANT` (default `none`) while its modules load. Prints `l7-LOAD <mutant> <file>` per applied file; a mutant whose files never loaded prints `l7-NOT-LOADED` and exits 97; a `from` text that does not match exactly once throws. |
| `mutant-table.ps1` | Runs a list of mutants over a test path and appends one block per mutant (exit code, load count, failed tests, corpus violations, repository files changed) to `<OutDir>\mutant-table.md`. |
| `server-mutants.ps1` | Runs the server tests against patched copies of `server/node` (through `RISU_NODE_SERVER_SCRIPT`) and appends to `<OutDir>\mutant-table-server.md`. |
| `pct.config.mjs` | Vitest config of one PCT worker. Adds an in-memory observation hook to `regions.ts` (fingerprint and step trace); behaviour is unchanged. |
| `pct-worker.test.mjs` | One worker: walks a stride of seeds of one region/backend through `runRegion`. Skipped when `L7_REGION` is unset, so an ordinary `vitest run` does not execute it. |
| `pct-driver.mjs` | Starts the workers per region/backend pair, restarts crashed or hung ones, aggregates the reports. |
| `queue.json` | The 78 region/backend pairs of the long run, in run order. |

## Run one mutant over the store2 tests

```powershell
$env:l7_MUTANT = 'c4'
node node_modules\vitest\vitest.mjs run src/ts/storage/tests/store2 --config Agents/Tools/storage-model/replay-tools/mutant.config.mjs --reporter=verbose
```

(cwd = repository root). `none` must be green; a killed mutant is red, and the output holds `l7-LOAD c4 <file>`. Set
`REPLAY_REPORT=1` to print the checker's `REPLAY-REPORT` lines. Run the cases one at a time or as a list through the table driver.

## Mutant table

```powershell
pwsh -NoProfile -File Agents/Tools/storage-model/replay-tools/mutant-table.ps1 -Mutants none,c4,markIgnoresPins -OutDir <scratch>
```

Optional: `-Test <path>`, `-Seconds <n>` (sets `RISU_LIVE_SECONDS` for the live-server tests), `-Filter <test name>`, `-Table <file>`.
Each run is retried up to three times when the log shows `ERR_MODULE_NOT_FOUND` or `Cannot find module`. The per-mutant log is
`<OutDir>\mut-<mutant>.log`.

Server mutants: `pwsh -NoProfile -File Agents/Tools/storage-model/replay-tools/server-mutants.ps1 -OutDir <scratch>`.

## One PCT region and backend (smoke)

```powershell
$env:RISU_SCRATCH = '<scratch>'
node Agents/Tools/storage-model/replay-tools/pct-driver.mjs pair R1 node --workers 4 --min-runs 200
```

Prints one JSON line: `{"runs":200,"steps":...,"distinct":...,"exact":null,"kinds":{"complete":200},"violations":0,"nonRed":0,"elapsedMs":...}`.
Options: `--workers N`, `--min-runs N`, `--min-ms N`, `--full` (every run kept, exact fingerprint set), `--out DIR`, `--report FILE`.
Results land in `<scratch>/pct-out/<region>-<backend>.json` and `.log`; per-worker data in `pct-out/runs/<pair>/`; worker logs in
`pct-logs/`; violations in `pct-violations/`; non-red findings (stalled, max-steps, threw, hang) in `pct-nonred/`.
A partial report: `node pct-driver.mjs aggregate <pairDir> <region> <backend> [<outFile>]`.

## The long queue

```powershell
$env:RISU_SCRATCH = '<scratch>'
node Agents/Tools/storage-model/replay-tools/pct-driver.mjs run Agents/Tools/storage-model/replay-tools/queue.json
```

Per pair: 8 workers, stride seeding, until at least 20,000 runs (`L7_QMIN_RUNS`) and at least 1 h 1 min (`L7_QMIN_MS`) have passed.
Two pairs run at a time. While it runs: `<scratch>/pct-concurrency.txt` (pairs at a time) and `<scratch>/pct-workers.txt` (workers
per pair) are re-read at each pair start; creating `<scratch>/pct-out/STOP` starts no new pair; `<scratch>/pct-out/progress.json` is
rewritten every 30 s. A restarted driver skips pairs that already have a `done` report. Kill only the driver's own process tree.

## Live-server run

The live report needs the verbose reporter with output not silenced:

```powershell
$env:RISU_LIVE_SECONDS = '3600'; $env:RISU_LIVE_SEED = '1'
node node_modules\vitest\vitest.mjs run src/ts/storage/tests/nodeLiveServer.test.ts -t "a live run" --reporter=verbose --silent=false
```

The `LIVE-REPORT {...}` line is printed only with `--reporter=verbose --silent=false`.

## Notes

- Mutant results at the merged stage 2 code can differ in test counts from the original scratch tables, because the merge added tests.
- Mutants dropped at the flattening: `g5rLabelPicked`, `g5rR14PickPlanted` (diagnostic edits that no longer match), the old forms of
  `g5sNoInstCheck` and `noRestartExemption` (replaced by the re-targeted `g5sNoInstCheck` and `restartExemptionReadded`);
  `g5sSkippedNoCheck` is re-composed from the re-targeted `g5sNoInstCheck`.

## SHA-256 of the other files in this directory

(`README.md` cannot list its own hash.)

```
mutant-table.ps1     aee646425417f7d1e12b0d9df32962d642e9338f2a744961daf6eaebab2eeef9
mutant.config.mjs    1ef5e2daeed47aa1c57dc0deaa52b03d151ae00a44f8c64ca0305ecb70ef2e8e
mutants.mjs          f64b9493c9453d35f374660da4c1750ba203de7951b7d8723d4be400100862d5
pct-driver.mjs       af1b9093c462aa6d91b134cb48659c2077438ad526611479f1b013e4c33e4e5b
pct-worker.test.mjs  1c552d08a9a7eb5fbd71eccdd576f66e7767c0a1c4dbc04d7f045f5ebbcb2c2b
pct.config.mjs       084932318389e37ac593c63b72e5f9602fea0885858ca27b7a798032ce15fc2f
queue.json           c34aed2c6abfccd33a8bb4706fe67dfc3ae9cf7224f90b29393bd69ebd9830f4
server-mutants.ps1   036007b39c9822ddeb1336c9e524ee8f8d4ea57b416430a92512bfc002d5aaff
```
