# Lane C brief: the CHORE-202 rerun plan (first step)

You are the orchestrator of lane C. Follow `AGENTS.md`, the `campaign-workflow` skill and `docs/workflow/`, and the lane rules in [README.md](README.md). Those rules cover your ID range, your records file, scratch, ports, builds, merging and the contingency for running out of IDs.

## Start

1. The maintainer starts this lane as a separate Claude session rooted in its own worktree, `C:\Projects\RisuAI\.claude\worktrees\Lane-C` on branch `worktree-Lane-C`, the same way lane B was started. Check `git status` and `git log -3` there. Read this brief and the README from `C:\Projects\RisuAI\Agents\Lanes\` until they are committed.
2. Create `Agents/Lanes/lane-C-records.md` on your branch (sections: MC entries, CHORE entries, ledger rows, handoff).
3. Your IDs: MC-430 to MC-449, CHORE-330 to CHORE-349, ledger rows 3300 to 3499. There is no overflow block: if a range runs out, go straight to provisional IDs (README, step 2). Scratch: `%TEMP%\risu-lane-c\`. Ports: 6440 to 6459.

## Read first

- Decisions, by heading in `Agents/Maintainer-Context.md`: `MC-326` (4 especially: the import keeps running with the screen off), `MC-330` (device requests: a data ceiling, a time limit and a pass/fail exit; PC first), `MC-336`.
- `Agents/Roadmap.md`: CHORE-202 and CHORE-203.
- Evidence in lane A's scratch (read-only for you):
  - `%TEMP%\risu-b715\measure2\report.md`: only its "Corrections from doc-verifier" section and the statements it leaves standing.
  - `%TEMP%\risu-b715\measure2\verify.md`.
  - b1's `power.txt` and `ths.log` under `%TEMP%\risu-b715\measure2\runs\`, where they exist (b1 has both; b1's screen-off power polls are empty).
- `src/ts/storage/saveYield.ts` (the copy loop yields through it).
- `Agents/Tools/device/README.md`: what the device scripts can record and their limits.

## Scope: the first step only

**The question:** why does the import's asset copy stall when the screen is off?

**Output: a plan document, not a run and not code.** The plan must give power polling that records samples (b1's screen-off polls were empty), together with a trace or a no-yield build, so the cause can be separated. It must say:

- what to record and how;
- the data ceiling, the time limit and a pass/fail exit for each run (`MC-330`);
- what each outcome would mean.

Lane A runs the plan on a phone later. You have no phone access and change no application code in this step. The plan is committed on your branch.

Later design work (the role-play-first import and the thin native task) waits for lane A's run of this plan. Do not start it.

## Gates

- A doc-verifier checks the plan document against its sources before you hand it over.
- If the plan proposes a special build (for example a no-yield build), it also gets a Gate 1-style challenge before it goes to lane A.
- A special build is a code change and needs its own gated stage, with a separate maintainer decision to build it.

## Devices

You do not drive the phones. Lane A runs the plan once the maintainer passes it on.

## Done

The plan is technically accepted when it is verified by `doc-verifier`, its records are in `lane-C-records.md`, and the maintainer has approved its commit. It is COMPLETE only after lane A folds its records into the shared files (`docs/workflow/records.md`). Merging into `main` follows the README.
