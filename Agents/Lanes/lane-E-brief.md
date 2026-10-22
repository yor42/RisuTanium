# Lane E brief: CHORE-193 flake triage

You are the orchestrator of lane E. Follow `AGENTS.md`, the `campaign-workflow` skill and `docs/workflow/`, and the lane rules in [README.md](README.md). Those rules cover your ID range, your records file, scratch, ports, builds, merging and the contingency for running out of IDs.

Lane B may take this work between stages instead of a separate lane E. If so, it uses lane B's IDs and scratch, and this brief still describes the work.

## Start

1. The maintainer starts this lane, if at all, as a separate Claude session rooted in its own worktree, `C:\Projects\RisuAI\.claude\worktrees\Lane-E` on branch `worktree-Lane-E`, the same way lane B was started. Check `git status` and `git log -3` there. Read this brief and the README from `C:\Projects\RisuAI\Agents\Lanes\` until they are committed.
2. Create `Agents/Lanes/lane-E-records.md` on your branch (sections: MC entries, CHORE entries, ledger rows, handoff).
3. Your IDs: MC-450 to MC-469, CHORE-350 to CHORE-369, ledger rows 3500 to 3699. There is no overflow block: if a range runs out, go straight to provisional IDs (README, step 2). Scratch: `%TEMP%\risu-lane-e\`. Ports: 6460 to 6479.

## Read first

- `Agents/Roadmap.md`: CHORE-193 (and its sibling CHORE-185).
- Evidence in lane A's scratch (read-only for you): the full-suite logs `%TEMP%\risu-b715\merge-b3\test.txt`, `test2.txt` and `test3.txt`, and the reruns `rerun.txt` and `rerun3.txt`.
- `Agents/Investigation-Ledger.md`, row 2121 (the corrected counts; note that the `saveLoop` failure in run 2 was an assertion failure and the `memorySummarizerSubject` failure in run 3 was a 10000 ms hook timeout).

## Scope

**The question:** classify each affected test file as load-only or as an isolation or cascade defect, like the stage 3 one fixed in `92f7d900a`, and propose a fix for each file.

**Files:** `assetPieceSave`, `firstLife`, `storeImportBoot`, `risuSave.msgpackRelease`, `tauriFilesStore.desktop`, `memorySummarizerSubject`, `blockStore.node`, `saveLoop`.

An `investigator` does the triage. The output is a per-file report with the classification, the evidence, and a proposed fix. Any test change is a separate gated step with a red-before-green reproducer (`MC-329`), where possible a deterministic one through a scratch hook, as lane B did.

Out of scope: application code, and changes to tests outside the files above. If a fix needs either, stop and ask the maintainer.

## Checks and load

- Avoid heavy full-suite runs while a phone build is going. Ask lane A, through the maintainer, before a full run.
- Rerun a failing file alone before it counts (README, "Full checks").

## Devices

You do not drive the phones.

## Done

A step is technically accepted when its gates pass, its records are in `lane-E-records.md` and verified by `doc-verifier`, and the maintainer has approved its commit. It is COMPLETE only after lane A folds its records into the shared files (`docs/workflow/records.md`). Merging into `main` follows the README.
