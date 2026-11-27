# #508 Phase 1: Home boot and return breakdown (Note 9, measure only)

Written 2026-11-27 by the #508 ticket session. No application code changed. Synthetic data only.

## Setup and evidence

- Phone: Galaxy Note 9 (SM-N960N, serial ending ...7ece), release builds, own port 6270, battery 29.4-30.0 C during runs (PR 494 baselines were at 32-33 C).
- Builds: A = main 41ee73703 (S6a/Tasks Home); B = #234 S3b head dae310692 (the PR 494 baseline build). Both unsigned release builds re-signed with the persistent test key and installed in place; same imported data (fixture `home-1000-shelf`, 1000 synthetic characters, archive on).
- Harness: `Agents/Tools/home-bench/home-bench.mjs` (the #234 G10 probe is lost; this is a re-creation). Boot = `Page.addScriptToEvaluateOnNewDocument` + `Page.reload` (warm process, document reload, not a process cold start). Value per run = max(T_paint, T_paint + tap input-to-second-frame) (the G10 run value, MC-3120); reported as median (max) of 5. Return = story card tap, open sidebar, open menu (untimed), then the timed tap on the Home icon.
- Raw files (kept in `%TEMP%\risu-508\run\`, not in the repo): `B-shelf-boot1`, `A-shelf-boot1`, `A-shelf-return1`, `B-shelf-return1` (`*-results.json`, with every Long Task), `prof\B-boot.cpuprofile`, `adb-commands.log`.
- Static trace of the boot and Home mount code (read-only source, origin/main 41ee73703): `%TEMP%\risu-508\static-breakdown.md`. It cites file:line for every pass named below.

## Measurements (median (max), ms)

| Cell | Build | Result | PR 494 baseline (build B) |
|---|---|---|---|
| Boot, shelf, 1000 chars | B | 1931 (2229); values 1844 1859 1931 2125 2229 | 1972 / 1928 |
| Boot, shelf, 1000 chars | A | 2345 (2379); values 2040 2092 2345 2356 2379 | none |
| Return to Home, same route | B | 196 (213) | 1482-1556 |
| Return to Home, same route | A | 196 (290) | none |

Harness check: on B, boot reproduces the baseline (1931 vs 1972 / 1928). Not measured: `home-1000-noshelf`, `home-500-shelf`, a cold process start.

### The return baseline is NOT reproduced

My return route measures about 196 ms on both builds, against 1482-1556 ms in PR 494. The route is real (checked: the chat `textarea` appears after the card tap and Home landing is gone, Home landing is back at the end), so the difference is in what the baseline timed, which I cannot recover because the G10 probe is lost. Likely candidates, none verified: the baseline ended at the library being usable (my `lib` mark is +100-600 ms after paint on A, absent in B's window), or it returned from a chat whose units had to be loaded or released, or it used the Back route. I need lane A to name the baseline's route and end mark before I claim anything about the return path. The static trace says return is not cheap in principle (HomeShell is recreated, freezeStories, the library mount and a new search cache repeat), so the cost may be in the part my end mark does not wait for.

## Boot: what the Long Tasks show (build B, 1000 shelf)

Per run, the same shape five times:

1. Task of 115-265 ms at about 0.6-0.75 s (bundle evaluation and start).
2. One synchronous task of 626-726 ms starting at about 1.17-1.45 s. This is the only big block, and it is consistent with the static trace's O(N) synchronous passes in `loadData` (stub assembly, `setDatabase` twice, `checkNewFormat` through reactive proxies, id and order repair).
3. First Home frame (paint) 0.5-0.75 s after that task ends (1.8-2.2 s). That gap holds no long task, so it is async waits (store reads, awaits, next frames), not a CPU block.
4. Library mount, later tasks at 2.9-3.3 s (95-159 ms), and tasks at 4.2-4.6 s. B's library mark never fired within 3.5 s in these runs.

Build A, same data: the 626-726 ms block is split into four tasks (about 170, 165, 330, 120 ms at 1.25-2.3 s), and the library mounts 110-180 ms after paint (the library mount long task is 100-125 ms). A's paint is later than B's by about 410 ms (2345 vs 1931). The extra Home pieces in A (Tasks control, persona chip in the header) and the changed mount order are suspects, but I have not attributed the 410 ms.

Attribution limit: the minified bundle gave a flat profile (82% of 7.2 s self time had an empty url), so I cannot name functions inside the 626-726 ms block from the profile alone. The static trace names the passes; no measurement splits them.

## Dominant costs, ranked (what is measured and what is inferred)

1. Pre-paint synchronous boot work, about 630-730 ms in one block on B (measured as a Long Task; passes inferred from the static trace). Dominant, and entirely before Home exists, so Home-side deferral cannot touch it.
2. Async wait between that block and the first Home frame, about 500-750 ms on B (measured as a gap with no Long Task; cause not yet identified: store reads, awaits in `loadData`, plugin and update checks (`loadPlugins`, `checkRisuUpdate`) are the candidates in the static trace).
3. Bundle evaluation and start, about 700 ms before the first big task (measured; not examined).
4. Extra pre-paint cost on A versus B, about 410 ms (measured as a difference; cause unknown).
5. Library mount after paint (100-360 ms of Long Tasks around 2.0-3.3 s). It follows paint, so it hits T_tap (input-to-frame 53-80 ms on A, 33-51 ms on B) but not T_paint.

## Is 1 s reachable?

Not by Home-side deferral. Paint arrives at 1.8-2.3 s and 1.1-1.2 s of that precedes the first Home mount work. Reaching 1 s on a warm document reload needs most of items 1-3 removed or moved after the first frame. That reaches into `loadData` order and persistence, so it is the Tier 2 critical-contract territory the ticket names. Candidates and their contract risk are in the static trace section E (C5 `checkNewFormat` and the second `setDatabase`: load-order contract; C6 duplicate `migrateConnectionsOnLoad`: boot-write marking; C7 avatar thumb sweep prefix: keep-set contract; C9 id and order repair: must stay before the first save; C10 plugins and update check: product behaviour; C11 first `saveDb`: must follow the last boot mutation).

## Proposal for lane A (smallest set; gains are estimates, not measurements)

| # | Change | Class | Expected gain (estimate, to be measured per change) |
|---|---|---|---|
| P0 | Attribution first: instrument `loadData` and `Home` with `performance.measure` marks in a throwaway local build (not committed) to split the 626-726 ms block and the 500-750 ms gap | measure only, no product change | none by itself; it decides P1-P3 and replaces the guesses above |
| P1 | Skip the duplicated per-character work in boot (second `setDatabase` loop; `checkNewFormat` pass over proxies) by running the defaults once on the raw tree | Tier 2 critical contract (load order, dirty tracking), Gate 1 plus Gate 2 `opus-reviewer` | up to a fraction of the 626-726 ms block; size unknown until P0 |
| P2 | Move detachable boot awaits (avatar thumb sweep prefix, update check, plugin load where product allows) after the first Home frame | Tier 2 for the thumb sweep (keep-set contract); plugins and update check need a product decision | up to the 500-750 ms gap if it is these awaits; unknown until P0 |
| P3 | A-only regression: find what adds 410 ms to A versus B | investigation, then a fix in Home mount order | up to 410 ms on A |
| P4 | Library mount after paint (C1 top-k selection, C3 lazy entries, C4 hoisted search cache) | no persistence contract; fresh independent review | no gain to T_paint; reduces 100-360 ms of post-paint tasks and the tap delay of 53-80 ms |

The 1 s target is not claimed reachable from this data; P0 should come first and may show the floor is bundle evaluation plus store reads.

## Needs from lane A before Phase 2

1. The baseline's return route and end mark (the 1482 ms figure), or approval to define "return to Home" as: Home landing and library list present and the first tap answered.
2. Go or no-go on P0-P4 and the order. P1 and P2 are Tier 2 and need the plan gate.
3. Whether to also measure `home-1000-noshelf` and `home-500-shelf` first (needs a fixture re-import, about 10 minutes each).

## Process notes

- One guard slip: I issued a `monkey` command in a probe; the guard refused it (DZ-13, exit 89) and I did not retry or vary it.
- Device end-of-run: forward removed, `reverse --list` empty, `net-status` wifi_enabled=off associated=no, end census listed only standing packages, lease `r508-phone` released with `--clean`. Build B is currently installed on the phone, with the 1000-character data in place.
- The harness is untracked in the worktree (`Agents/Tools/home-bench/home-bench.mjs`); I have not committed it.

## Addendum: P0 marks (2026-11-27, throwaway instrumented builds, not committed)

Same marks (29, `performance.now()` ms from document start) built into A (main 41ee73703, patch `%TEMP%\risu-508\p0-marks.patch`) and B (dae310692, `p0b-marks.patch`). Release builds, Note 9, 1000-char shelf, 4 document reloads each, median (min-max). Full table: `%TEMP%\risu-508\run\p0-summary.txt`.

| Boot step | A | B |
|---|---|---|
| Bundle start to `store2Reads start` | 970 (826-1152) | 908 (869-938) |
| `store2Reads` (start to end) | 574 | 511 |
| `setDatabase1`, `checkRisuUpdate`, `loadPlugins` (each, sync part) | 2 / 11 / 1 | 2 / 1 / 1 |
| `checkNewFormat` (includes `setDatabase2` 13 ms, `checkCharOrder` 14 ms) | 138 | 136 |
| `checkNewFormat end` to `loadedStore true` | 64 | 17 |
| `assignIds`, `charPutBack`, `saveDb`, avatar sweep sync prefix | 9 / 1 / 2 / 5 | 0 / 1 / 2 / 4 |
| `loadedStore` to `HomeShell` script start | 40 | 39 |
| `HomeShell` script start to `onMount` | 152 | 118 |
| `HomeShell onMount` (ms from document start) | 1965 | 1739 |
| `GridCatalog` mount (start to end) | 2271 to 2387 | never mounted (B's Home has no embedded library) |

Findings:
- The update check and plugin load cost about 12 ms together before Home on this fixture. Deferring them gains at most that; it is not where the time is.
- Avatar sweep sync prefix is 5 ms; `saveDb` first call is 2 ms.
- The measured pre-Home time is mostly outside the approved candidates: about 970 ms before `store2Reads` starts (bundle fetch, parse and evaluation, early init; not marked), then 574 ms inside `store2Reads` (it contains the two long CPU tasks the profile showed, not only I/O), then about 230 ms of `checkNewFormat` and the gap after it.
- A vs B: `HomeShell onMount` is 226 ms later on A (63 ms before `store2Reads`, 63 ms inside it, 49 ms after `checkNewFormat`, 34 ms in the `HomeShell` mount, about 20 ms elsewhere). The remaining part of the 410 ms paint gap is the A-only embedded library mount (GridCatalog, 116 ms) and its effect on the 2-rAF paint mark.

## Addendum 2: P0c attribution of the 970 ms before the store read and the 574 ms inside it (build A, main 41ee73703)

Throwaway build, patch `%TEMP%\risu-508\p0c-marks.patch` (not committed); Note 9, 1000-char shelf, 4 document reloads, median (min-max), ms from document start. Table: `%TEMP%\risu-508\run\p0c-summary.txt`. Run-to-run spread is about 120-150 ms on the late marks, so differences under about 50 ms are noise.

Before `loadData` (about 830 ms):
- Navigation `respEnd` 30; first app script request starts at about 150.
- 164 resources (the app's JS chunks, all `transferSize` 0, so served locally) are requested at 140-160 and the last response ends at 490-540 (median about 500). That is about 350 ms of module-graph fetch from the app asset protocol.
- `first import evaluated` 775 (760-881): about 275 ms after the last response, spent compiling and evaluating the graph.
- `entry body start` 812; `loadData start` 827.

From `loadData start` to `store2Reads start` (999) is 172 ms not attributed (code before `runStore2Boot` in boot).

Inside `store2Reads` (999 to 1516, 517 ms):
- Session open 999-1204 (205 ms): owner/backend 24, reflush 50, fence and commit 35, tree read 96 (read 1: 21, read 2: 35, 67 keys).
- `treeBytes` 1205-1356 (152 ms): reads 3, 4, 5 take 29 + 49 + 27 = 105 ms (1, 74 and 9 keys), the rest is the resident checks.
- `assemble` 1356-1418 (61 ms; the stub build itself 12 ms for 1005 stubs).
- `previousOfTree` 1418-1515 (97 ms).
- Total awaited byte reads: five calls, about 160-190 ms; the rest is CPU in the tree and session code.

After the read, unchanged from the earlier table: update check and plugin load 15 ms, `checkNewFormat` 145 ms, 80 ms before `loadedStore`, `HomeShell` script to `onMount` 121 ms (onMount at 1960), library mount 2124-2247.

Floor estimate (judgment, not measured):
- Time to `HomeShell onMount` is about 1960 ms. About 830 ms of it is the module graph and about 520 ms is the store read; the two together are 70% of it.
- Cutting every item the approved list names (update check, plugins, sweep, `checkNewFormat` passes) removes at most about 200 ms.
- Merging the 164 chunks into few (less fetch, cheaper graph start) is the only lever on the 830 ms that I can see in the data; it might save a few hundred ms but is a build change, and I have not measured it.
- Overlapping the five reads or trimming `previousOfTree` and `reflush` could save up to about 150-250 ms inside the store read, and touches the store2 session and tree code (critical contracts).
- 1 s to a Home with the real library list is not reachable on this phone with any of these. Even removing the whole 520 ms store read would leave about 1.4 s.

## Addendum 3: device check of P4 and the chunk-merge experiment (same phone, same data, harness `home-bench.mjs`)

Unmarked release builds, Note 9, 1000-char shelf, 5 runs per cell, interleaved A, P4, CM, A again (battery 29.5-30.7 C). Boot value = the run value defined at the top (landing paint plus the tap delay); `lib` = library list present, ms from document start (boot) or from the Home icon tap (return). Medians (max).

| Build | Boot value | Boot lib | Return value | Return lib |
|---|---|---|---|---|
| A (main 41ee73703), first | 2251 (2311) | 2402 | 223 (385) | 305 |
| A, second (after the others) | 2186 (2219) | 2290 | 222 (442) | 282 |
| P4 (A plus the three edits) | 2134 (2413) | 2293 | 221 (337) | 281 |
| CM (A plus chunk merge, config only) | 2641 (2731) | 2713 | 189 (203) | 259 |

- P4: the differences from A (boot value 2134 vs 2251/2186, return lib 281 vs 305/282) are inside the noise (A against A differs by 65 ms at boot). P4 shows no gain that the harness can resolve on this fixture; it is a work reduction (the story selection is no longer a full sort, the Simple tab no longer builds Grid entries, the search normalisation is shared) without a measurable time effect here. The later tail of return `lib` values (790 and 767 in two P4 runs, 899 in one A run) is the same kind of outlier on both builds.
- CM (155 startup files merged into 2; one app chunk of 8.8 MB): boot is about 400-450 ms SLOWER (2641 vs 2186-2251), paint about 2.3-2.6 s vs 2.0-2.2 s. Return is unchanged within noise. The module graph fetch count is not the cost; compiling one large file up front is worse. Chunk merging is not shipped and is not recommended; the 830 ms module graph floor needs a different approach (less code evaluated at startup, not fewer files).
