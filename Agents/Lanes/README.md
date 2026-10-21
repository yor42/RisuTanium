# Parallel lanes (from 2026-10-21)

The maintainer asked on 2026-10-21 for parallel orchestrator sessions, each on its own worktree, and for a fallback when a session runs out of its ID range. This file sets the rules every lane session follows on top of `AGENTS.md` and `docs/workflow/`. Lane briefs: [lane-B-brief.md](lane-B-brief.md) and [lane-D-brief.md](lane-D-brief.md).

## Lanes

| Lane | Session | Checkout | Owns |
|---|---|---|---|
| A | the session that wrote this file (records owner) | `C:\Projects\RisuAI` (`main`) | the device scripts (`Agents/Tools/device/`), both Note 9s, the shared records files, merges into `main`, CHORE-193 |
| B | import/export page fixes | `.claude/worktrees/Lane-B`, branch `worktree-Lane-B` (started by the maintainer 2026-10-21) | the import and export code path listed in its brief |
| D | UI lists | `.claude/worktrees/Lane-D`, branch `worktree-Lane-D` | the character list, list windowing, chat-render tickets, CHORE-195 and CHORE-192 |

Lane C (design of the role-play-first import and the thin native task) is not started; it waits for lane A's screen-off finding.

## Where these files live

Until `Agents/Lanes/` is committed to `main`, a worktree made from `origin/main` does not contain it. Lane sessions read this README and their brief from `C:\Projects\RisuAI\Agents\Lanes\`, and create `Agents/Lanes/` in their own worktree for their records file. Each lane runs as a separate Claude session launched rooted in its worktree (`docs/workflow/ownership.md`): entering a worktree from a session rooted at `main` can leave the write guard pointed at the main checkout.

## Reserved ID ranges

Each lane takes IDs only from its own range. A range's IDs are permanent once used, and unused IDs remain as gaps, which are expected.

| Lane | MC | CHORE | Ledger rows | Overflow block |
|---|---|---|---|---|
| A | MC-335 to MC-354 | CHORE-202 to CHORE-219 (CHORE-196 to 199 unused; CHORE-200 and 201 already exist) | 2095 to 2299 | MC-420 to 429, CHORE-320 to 329, rows 3200 to 3299 |
| B | MC-355 to MC-374 | CHORE-220 to CHORE-239 | 2300 to 2499 | MC-400 to 409, CHORE-300 to 309, rows 3000 to 3099 |
| D | MC-375 to MC-394 | CHORE-240 to CHORE-259 | 2500 to 2699 | MC-410 to 419, CHORE-310 to 319, rows 3100 to 3199 |
| New lanes | from MC-430, CHORE-330, row 3300, in blocks of 20 / 20 / 200, assigned by lane A | | | |

### When a range runs out (contingency)

1. **Overflow block.** When a lane has two or fewer IDs left of a kind, it moves to its own overflow block above. No other lane uses that block, so the move needs no coordination. The lane notes the switch in its lane records file.
2. **Provisional IDs.** If the overflow block also runs out, the lane uses provisional IDs: `MC-B1`, `MC-B2`, and so on, with `CHORE-B1` and `row B1` for the other kinds (`D` for lane D). It uses them in its lane records file and, if needed, in commit messages, and never in code or test comments. At fold-in, lane A assigns real IDs and writes the provisional-to-real mapping in [id-map.md](id-map.md). That mapping keeps provisional IDs cited in pushed commit messages traceable.
3. **New ranges.** The maintainer can ask lane A for a further range at any time; lane A adds a row to the table above.
4. **Collision found anyway** (two records with one ID): the later one by date gets a provisional ID and goes through step 2. Neither record is deleted.

## Records

- A lane session does not edit the shared records files on its branch: `Agents/Live-State.md`, `Agents/Roadmap.md`, `Agents/Maintainer-Context.md`, `Agents/Decision-Index.md`, `Agents/Investigation-Ledger.md`, `Agents/Upstream-Merges.md`. It keeps `Agents/Lanes/lane-<X>-records.md` on its own branch, with sections for its MC entries (same format as `Maintainer-Context.md`), new or changed CHORE entries (same format as `Roadmap.md`), ledger rows, and its handoff notes.
- Maintainer decisions are recorded in the lane records file in the same turn they are made, with the same evidence rules (`docs/workflow/records.md`), and verified by `doc-verifier` before the lane's merge.
- At merge, lane A folds the lane records into the shared files, regenerates the decision index (`update-decision-index.ps1`), and has the fold-in verified by `doc-verifier`.
- Each lane writes its own handoff into its lane records file before its context runs out (`docs/workflow/records.md`, "Batching and session discipline").

## Shared resources

- **Scratch.** Each lane uses its own root under `%TEMP%`: lane A `%TEMP%\risu-b715\`, lane B `%TEMP%\risu-lane-b\`, lane D `%TEMP%\risu-lane-d\`. Do not register a folder with the write guard.
- **node_modules.** Use what the worktree setup provides. If the worktree has none, run `pnpm install --frozen-lockfile` in it. Never remove a `node_modules` junction recursively.: lane A 6000 to 6399 (device ports as in its scripts), lane B 6400 to 6419, lane D 6420 to 6439. Use a free-port and identity check; kill only processes you started; never kill by image name. `.claude/launch.json` has fixed ports, such as `risuai-prod-scratch` on 6011 (lane A's range), and must not be edited. A lane starts its own server on its own port and points the preview at it.
- **Phones.** Only lane A drives the Note 9s. A lane that needs a device result asks the maintainer to pass the request to lane A, with a data ceiling, a time limit and a pass/fail exit (`MC-330`). PC first (`MC-330` 3).
- **Android builds.** A lane that builds Android uses its own `CARGO_TARGET_DIR` (for example `%TEMP%\risu-lane-b\cargo-target-android`), never lane A's warm cache.
- **Full checks.** Focused tests run freely. A full `pnpm test` while another lane's full run is going hits the CHORE-193 load flakes. A failure in `assetPieceSave`, `firstLife` or `storeImportBoot` is rerun alone before it counts.
- **Translations.** The translator's write guard allows `main` only (memory note). A lane's translator writes its strings to the lane's scratch, and the lane's coder copies them into the worktree's locale files.

## Merging into `main`

- A lane merges only with the maintainer's approval for that merge. The standing push approval covers `main` after a commit or fast-forward; pushing a lane branch needs its own approval.
- The merge is done in the `main` checkout when lane A has no active application-code writer there.
- Full `pnpm test`, `pnpm check` and the relevant build run on the merged snapshot before the push.
- Order: lane D whenever it passes its gates; lane B after lane D if both are ready, since B carries save-format risk.
- Lane A folds the lane's records in the same merge pass.
