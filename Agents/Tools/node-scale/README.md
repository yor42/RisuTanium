# node-scale (CHORE-806)

Diagnostic tooling that measures a synthetic store2 library on the repository's own self-hosted Node server, through the real page.
Numbers are best-case desktop figures with synthetic data: not thresholds, and no statement about phones or a Pi. Nothing here
changes app, server or format code; every output goes under `%TEMP%\risu-b715\b61\c806\` (override: `C806_ROOT`). Every scratch path
(trees, dist copies, run folders, `--out`) must lie inside that root: `scratchPath` refuses anything else, and the repository above all.

## Files

| File | Role |
|---|---|
| `c806-server.mjs` | Starts `server/node/server.cjs` with a scratch cwd (`data/<tag>/srv/{save,dist}`) on a free port of 6800-6899, checks its identity, restores a pristine tree, stops only the recorded PID. |
| `c806-reqlog.cjs` | `--require` shim: one JSONL line per request (time, route, decoded keys and key classes, `if-match-revision`, status, bytes, 429). Changes no response. |
| `c806-page.mjs` | Chrome through `chatshell-cdp/launch-chrome.mjs` plus CDP helpers (sign-in, library search, open a character, restore a `.bin` through the page's own picker) and the G1 `smoke` command. |
| `c806-boot.mjs` | Stage 2: boot timing of one arm (`run`) or several (`arms`): a setup boot, cache-cleared boots, a priming load, warm boots; ready is stamped inside the page. |
| `c806-savepass.mjs` | Stage 3: per character, open it, make one UI edit and read the save-pass and commit meters (`run`, `arms`, `selfcheck`). Search, open, marker and edit-record times are page-side `performance.now()` deltas (`timeInPage` in `c806-page.mjs`). |
| `c806-import.mjs` | Stage 4: the `.bin` import peak through the page on a ladder of message medians (`run`, `selfcheck`); generates each `.bin` in a child process (`gen`). |
| `c806-proc-sampler.ps1` | Read-only OS sampler of private bytes and working set of a PID list every 250 ms (used by stage 4); ends on its stop file, when its parent process is gone, or after `-MaxSeconds`. |
| `../save-gen/c806-tree.harness.ts` | Writes a tree (route A: hex files; route C: through the server) and takes the offline census of any tree. |

The stage 0 files `../save-gen/c806-library.mjs`, `c806-bin-write.mjs` and `c806-census.harness.ts` make the library, the `.bin` and the in-process census.

## Safety rules

- Chrome starts only through `launch-chrome.mjs` (node spawn, args array): resolver rules block `discord.com` and `*.risuai.xyz`/`.net`, and a loopback-only proxy fails closed. The profile is a fresh folder. Refused requests are logged in the run folder's `proxy-refusals.jsonl`.
- Only recorded PIDs are killed (`pids.json`, `chrome.pid`, `launcher.pid`), after a name check, never by image name. The launcher is waited for and killed by its recorded PID if it lingers.
- The server cwd is a scratch folder, so `save/` and `dist/` are copies. Ports: server 6800-6899, CDP 9800-9899; never 6001, 6011, 6250, 6251 or 9470. The identity check needs this run's nonce file served back AND the port's listening PID to be the spawned child.
- Synthetic data only. The page import refuses a `.bin` without a matching `.c806.json` sidecar (sha256).
- Run exact harness files only (a folder run rewrites `src` golden fixtures). No `pnpm install`; use `npx --no-install`.
- Hold the full-run slot (`%TEMP%\risu-b715\fullrun-slot`) for the measurement build and for G1 and scale runs; release it afterwards, also after a failure.

## Measurement build

```
$env:VITE_RISU_MEASURE='1'
npx --no-install vite build --outDir <scratch>\build\dist --emptyOutDir
```

Record `git rev-parse HEAD`, `git status --short src` and the dist `index.html` sha256 (every smoke result carries the hash).

## Usage

```
# write a tree: route A (default) -> <C806_ROOT>/data/<tag>/pristine ; route C: C806_ROUTE=node C806_DIST=<dist>
$env:C806_MODE='write'; $env:C806_TAG='t1'; $env:C806_CHARACTERS='3'
npx --no-install vitest run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/c806-tree.harness.ts

# census of any tree (a pristine tree or a server's save/), then compare two censuses (counts equal, bytes within 1%)
$env:C806_MODE='census'; $env:C806_TREE_DIR=<dir>      ;  $env:C806_MODE='compare'; $env:C806_CENSUS_A=<json> $env:C806_CENSUS_B=<json>

# a .bin of the same library:  $env:C806_MODE='bin'; $env:C806_BIN_OUT=<path outside the repo>

# G1 smoke on a tree: boot, search, open, optional edit and reload; --control shard|chunk|utf16 damages the copy first
node Agents/Tools/node-scale/c806-page.mjs smoke --tag <t> --tree <pristine dir> --dist <dist> --tree-json <tree.json> --census <census.json> [--edit] [--control shard]
```

Without `C806_MODE` the harness runs its self-checks (T1a, T1c, damaged-tree refusal). Fault knobs: `C806_FAULT=drop-chat|drop-unit|bad-hex` (harness), `wrong-identity` (`node c806-server.mjs selftest-identity`).
Scale writes need `NODE_OPTIONS=--max-old-space-size=16384`.

## Stages 2-4

```
# stage 2: boot timing. One arm per run; `arms` runs several, releasing the slot after each and waiting --pause-ms (default 90 s)
node Agents/Tools/node-scale/c806-boot.mjs run  --arm scale-on [--label <name>] [--boots 5] [--settle-ms 5000] [--boot-timeout-ms 600000]
node Agents/Tools/node-scale/c806-boot.mjs arms --arms scale-on,scale-off-250 [--boots 5] [--pause-ms 90000]
node Agents/Tools/node-scale/c806-boot.mjs selfcheck --arm <small tree tag>

# stage 3: save pass after one edit, per character
node Agents/Tools/node-scale/c806-savepass.mjs run  --arm scale-on [--count 5] [--indices 100,300] [--quiet-ms 30000]
node Agents/Tools/node-scale/c806-savepass.mjs arms --arms scale-on,scale-off-250 [--count 5] [--pause-ms 90000]
node Agents/Tools/node-scale/c806-savepass.mjs selfcheck --arm <small tree tag> [--index 1]

# stage 4: .bin import ladder (each rung: new .bin, empty server, fresh profile)
node Agents/Tools/node-scale/c806-import.mjs run [--rungs 0.5,1,2,4] [--characters 1000] [--chats 20] [--modules 180] [--archive on|off]
     [--cap-min 60] [--stage1-census <census.json>] [--no-census] [--keep-bin] [--out <folder inside the scratch root>]
node Agents/Tools/node-scale/c806-import.mjs selfcheck
```

The arm names are tree tags: stage 2 and 3 read `<root>/data/<arm>/pristine`, `<root>/runs/stage1/<arm>/tree.json` and `<root>/runs/stage1/<arm>-census/census.json` (stage 1 output) and the measurement build in `<root>/build/dist`.

Outputs, per run folder under `<root>/runs/stage2|stage3|stage4/`:

| Stage | Files |
|---|---|
| 2 | `run.json` (provenance, tool sha256s), `boots.json` (one record per boot), `summary.json`, `checks.json`, `table.md`, `reqlog-<kind>-<n>.jsonl` |
| 3 | `run.json`, `runs.json` (one record per character), `summary.json`, `checks.json`, `information.json` (open reads against the census leaves; asserted by no check), `table.md` |
| 4 | per rung `<tag>/rung.json`, `phases.json`, `series.json` (not on a failed rung), `heap.jsonl`, `proc.jsonl`, `requests.jsonl`, `gen.log`, `census.log`; `ladder.json` and `bins.json` in the `--out` folder |

Stage 4 rung status: `ok` only when the census harness exits 0 and the imported tree equals the `.bin` parameters; `unverified` with `--no-census` (figures unchecked); otherwise `failed`, with no figure in `ladder.json` or on the console. The headline heap figure is `phaseRingPeakHeapMiB` (the page's own import phase notes, a lower bound); `cdpHeapPeakBetweenBlocksMiB` is the highest CDP sample and misses a peak inside a blocked stretch.

Reading limits for stages 3 and 4:

- `rung.json` of a census-failed rung keeps raw diagnostic fields (figures, heap, process data). Only `ladder.json` and the console line are authoritative: a failed rung has no figure there.
- `openPageMs` (stage 3) is the time from the click to the chat container (`[data-part=chat-messages]`), not to rendered content.
- The tree harness's `toolSha256` provenance in generation mode has not been exercised since it was added.

Fault knobs (`C806_FAULT`, scratch self-checks; each must turn a check red):

| Knob | Tool | Expected failure |
|---|---|---|
| `drop-log`, `early-ready`, `arm-swap` | `c806-boot.mjs` | T2a, T2b, T2c |
| `no-edit`, `wrong-char` | `c806-savepass.mjs` | T3a checks |
| `truncate-bin`, `no-sidecar`, `census-mismatch` | `c806-import.mjs` | failed rung without a figure, sidecar refusal, failed rung without a figure |
| `drop-chat`, `drop-unit`, `bad-hex`, `flip-bytes`, `unseeded` | harnesses | T0a-T1c |
| `wrong-identity` | `c806-server.mjs selftest-identity` | T1d |

Slot rule (MC-1826): one measurement process holds `%TEMP%\risu-b715\fullrun-slot` at a time. Stage 2 and 3 runs hold it for one arm; `arms` and the stage 4 ladder release it after each arm or rung, also on failure or a signal, and wait at least 90 s before taking it again so queued lanes can run. SIGINT and SIGTERM end Chrome, the server, the samplers and the slot of the running tool, by recorded PID after a name check.

## Reading the numbers

- **Pristine tree per run.** A boot writes to `save/` (the first save pass after boot commits), and an edit changes it further. Every smoke run restores `save/` from the pristine copy first (`restoreTree` keeps only the login files). The pristine commit key hash is in each result.
- **"Cold" is not cold.** `Network.clearBrowserCache` leaves the registered service worker and Cache Storage, and the first load reloads the page once while the service worker registers (two navigations; the sign-in prompt can appear twice). Label such boots as cache-cleared, not cold, or clear the origin's Cache Storage too. A fresh profile is the colder case.
- **Meter switches.** `risu-measure-savepass` is read once per page life and adds per-pass work, and `__risuSavePassMeter` exists only once it is `on` and a pass ran. Boot numbers use it off; stage 3 uses it on. The switches are set by a script added before any page script runs.
- **Proxy hop.** With `<-loopback>` every page-to-server request, unit bodies included, goes through the launcher's Node proxy; wall times include that hop.
- **429.** The server's 20000-per-minute storage limiter can answer 429 during a boot of a large archive-off library; the client retries, so such a boot is limiter-bound and is marked as such, not counted as boot cost.
- **Reload reopens the last character.** After a reload the app shows the open character, not the home screen.
