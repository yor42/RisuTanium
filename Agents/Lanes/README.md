# Parallel lanes (from 2026-10-21)

The maintainer asked on 2026-10-21 for parallel orchestrator sessions, each on its own worktree, and for a fallback when a session runs out of its ID range. This file sets the rules every lane session follows on top of `AGENTS.md` and `docs/workflow/`. Lane briefs: [lane-B-brief.md](lane-B-brief.md), [lane-C-brief.md](lane-C-brief.md), [lane-D-brief.md](lane-D-brief.md) and [lane-E-brief.md](lane-E-brief.md). Lanes F and G (2026-10-24, `MC-503`) have no brief file: lane A gave each brief to the maintainer in chat, to paste into a new Claude app session.

## Lanes

| Lane | Session | Checkout | Owns |
|---|---|---|---|
| A | the session that wrote this file (records owner) | `C:\Projects\RisuAI` (`main`) | the device scripts (`Agents/Tools/device/`), both Note 9s, the shared records files, merges into `main`, CHORE-193 (its triage handed to lane E, or lane B between stages, on 2026-10-22) |
| B | import/export page fixes | `.claude/worktrees/Lane-B`, branch `worktree-Lane-B` (started by the maintainer 2026-10-21) | the import and export code path listed in its brief. State on 2026-10-25 (records batch 14): the reload prompt is removed (`MC-489`, merged as `91d4c2973`); E1 and the reused-bytes change are merged (`8455abf9b`, `fcb85b1dc`); the CHORE-213 test fix is merged (`991ee825c`). Records through `MC-493` and rows through 3071 are folded in. Now on L3 (modules not kept in memory): L3 in progress, PC measurement and code audit first, phone time only by a separate request |
| D (retired) | UI lists | `.claude/worktrees/Lane-D`, branch `worktree-Lane-D` | the character list, list windowing, chat-render tickets, CHORE-195 and CHORE-192 |
| C (cloud) | design of the role-play-first import and the thin native task | `.claude/worktrees/Lane-C`, branch `worktree-Lane-C` (started by the maintainer) | its plan document; first step is the CHORE-202 rerun plan (plan only). Since then: batch Q (CHORE-240, CHORE-185; records folded in, records batch 13) and the upstream sync to `f50b5942e` (CHORE-331; merged as `20b115207` on 2026-10-25, `MC-515`; records folded in, records batch 14). Next: a code-only batch (`MC-516`), with a prompt prepared by lane A for the maintainer to paste (branch `lane-c-codeonly-1025`) |
| E (retired) | CHORE-193 flake triage | `.claude/worktrees/Lane-E`, branch `worktree-Lane-E`, if the maintainer starts it | the investigation and per-file proposals. Lane B may take this work between stages instead; it then uses lane B's IDs and scratch |
| F | the plugin batch (CHORE-30, CHORE-65) | branch `worktree-Lane-F`, started by the maintainer in the Claude app from the brief lane A gave in chat (`MC-503`) | CHORE-30 (V2/V3 `setChar`) and CHORE-65 (plugins reading each other's saved arguments); no phone access. Merged into `main` as `4331440b6` on 2026-10-25 (`MC-506`). Records folded in (records batch 12). Batch 2, the Node group (CHORE-120, CHORE-371, CHORE-62, CHORE-46 and the export Cancel; scope in `MC-507`, `MC-522`), is merged as `95a24de3e` (`MC-513`) and its records are folded in (records batch 14). Now sizing CHORE-372 (lifting the Node server's 100 MiB asset limit; `MC-524`) |
| G | the parity batch (CHORE-178, CHORE-45, CHORE-41) | branch `worktree-Lane-G`, started by the maintainer in the Claude app from the brief lane A gave in chat (`MC-503`) | CHORE-178 (lorebook scan depth larger than the chat), CHORE-45 (script cache misses on repeat sends) and CHORE-41 (edit button sometimes opens no editor); no phone access. Merged into `main` as `dceab1844` on 2026-10-25 (`MC-500` standing approval). Records folded in (records batch 12). Batch 2 (closure audit, CHORE-209, CHORE-183; `MC-507`, `MC-543`) is merged as `efcf63634` (`MC-509`) and its records are folded in (records batch 13). Batch 3 (small fixes and the un-parked CHORE-191, 107 and 02; `MC-508`) is merged as `b37dc6223`, with the Translator's locale commit `6625baedf` (`MC-513`), and its records are folded in (records batch 14). Its MC block (`MC-540` to `MC-559`) is used up, so lane A gave it `MC-560` to `MC-579` (`MC-513`) |

Lane C starts with the CHORE-202 rerun plan; its design work waits for lane A's run of that plan.

## Where these files live

Until `Agents/Lanes/` is committed to `main`, a worktree made from `origin/main` does not contain it. Lane sessions read this README and their brief from `C:\Projects\RisuAI\Agents\Lanes\`, and create `Agents/Lanes/` in their own worktree for their records file. Each lane runs as a separate Claude session launched rooted in its worktree (`docs/workflow/ownership.md`): entering a worktree from a session rooted at `main` can leave the write guard pointed at the main checkout.

## Reserved ID ranges

Each lane takes IDs only from its own range. A range's IDs are permanent once used, and unused IDs remain as gaps, which are expected.

| Lane | MC | CHORE | Ledger rows | Overflow block |
|---|---|---|---|---|
| A | MC-335 to MC-354 | CHORE-202 to CHORE-219 (CHORE-196 to 199 unused; CHORE-200 and 201 already exist) | 2095 to 2299 | MC-420 to 429, CHORE-320 to 329, rows 3200 to 3299 |
| B | MC-355 to MC-374 | CHORE-220 to CHORE-239 | 2300 to 2499 | MC-400 to 409, CHORE-300 to 309, rows 3000 to 3099 |
| D | MC-375 to MC-394 | CHORE-240 to CHORE-259 | 2500 to 2699 | MC-410 to 419, CHORE-310 to 319, rows 3100 to 3199 |
| C | MC-430 to MC-449 | CHORE-330 to CHORE-349 | 3300 to 3499 | none; if the range runs out, go straight to provisional IDs (step 2) |
| E | MC-450 to MC-469 | CHORE-350 to CHORE-369 | 3500 to 3699 | none; if the range runs out, go straight to provisional IDs (step 2) |
| A (added 2026-10-24) | MC-470 to MC-479, then MC-500 to MC-519 | as above | as above | as above |
| B (added 2026-10-24) | MC-480 to MC-499 | as above | as above | as above |
| F (added 2026-10-24) | MC-520 to MC-539 | CHORE-370 to CHORE-389 | 3700 to 3899 | none assigned; see the contingency steps below |
| G (added 2026-10-24) | MC-540 to MC-559 | CHORE-390 to CHORE-409 | 3900 to 4099 | none assigned; see the contingency steps below |
| G (added 2026-10-25) | MC-560 to MC-579 | as above | as above | as above |
| New lanes | from MC-580, CHORE-410, row 4100, in blocks of 20 / 20 / 200, assigned by lane A | | | |

Next free IDs as of 2026-10-25 (records batch 14): lane A MC-518, CHORE-215, row 3229. Lane A's own rows 2290 to 2297 are used and 2298 and 2299 stay as gaps: with two rows left it moved to its overflow rows, 3200 to 3299 (step 1 below), and rows 3200 to 3228 are used (CHORE-211 to 214 used). Lane B MC-494, CHORE-228, row 3072. Lane C MC-442, CHORE-332, row 3361. Lane F MC-531, CHORE-373, row 3745. Lane G MC-560 (its new block is MC-560 to MC-579), CHORE-394, row 3900 (it has used no ledger rows). The other lanes are unchanged.

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

- **Scratch.** Each lane uses its own root under `%TEMP%`: lane A `%TEMP%\risu-b715\`, lane B `%TEMP%\risu-lane-b\`, lane D `%TEMP%\risu-lane-d\`, lane C `%TEMP%\risu-lane-c\`, lane E `%TEMP%\risu-lane-e\`, lane F `%TEMP%\risu-lane-f\`, lane G `%TEMP%\risu-lane-g\`. Do not register a folder with the write guard.
- **node_modules.** Use what the worktree setup provides. If the worktree has none, run `pnpm install --frozen-lockfile` in it. Never remove a `node_modules` junction recursively.
- **Ports.** Lane A 6000 to 6399 (device ports as in its scripts), lane B 6400 to 6419, lane D 6420 to 6439, lane C 6440 to 6459, lane E 6460 to 6479, lane F 6480 to 6499, lane G 6500 to 6519. Use a free-port and identity check; kill only processes you started; never kill by image name. `.claude/launch.json` has fixed ports, such as `risuai-prod-scratch` on 6011 (lane A's range), and must not be edited. A lane starts its own server on its own port and points the preview at it.
- **Phones.** Only lane A drives the Note 9s; lanes C, E, F and G have no phone access. A lane that needs a device result asks the maintainer to pass the request to lane A, with a data ceiling, a time limit and a pass/fail exit (`MC-330`). PC first (`MC-330` 3).
- **Android builds.** A lane that builds Android uses its own `CARGO_TARGET_DIR` (for example `%TEMP%\risu-lane-b\cargo-target-android`), never lane A's warm cache.
- **Full checks.** Focused tests run freely. A full `pnpm test` while another lane's full run is going hits the CHORE-193 load flakes. A failure in `assetPieceSave`, `firstLife` or `storeImportBoot` is rerun alone before it counts.
- **Translations.** The translator's write guard allows `main` only (memory note). A lane's translator writes its strings to the lane's scratch, and the lane's coder copies them into the worktree's locale files.

## Merging into `main`

- A lane merges only with the maintainer's approval for that merge. The standing push approval covers `main` after a commit or fast-forward; pushing a lane branch needs its own approval. Since 2026-10-24, per `MC-500` (lane A's reading of the maintainer's standing approval for gated batches), lane A may merge a lane batch without asking each time when every ticket passed Gate 2 with APPROVE or EDITORIAL, the full checks pass on the merged snapshot and no product question is open. Save format, persistence and data-loss work still needs per-merge approval, and pushing a lane branch still needs its own approval.
- The merge is done in the `main` checkout when lane A has no active application-code writer there.
- Full `pnpm test`, `pnpm check` and the relevant build run on the merged snapshot before the push.
- Order: lane D whenever it passes its gates; lane B after lane D if both are ready, since B carries save-format risk.
- Lane A folds the lane's records in the same merge pass.
