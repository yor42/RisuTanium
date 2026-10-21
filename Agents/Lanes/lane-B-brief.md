# Lane B brief: import/export page fixes

You are the orchestrator of lane B. Follow `AGENTS.md`, the `campaign-workflow` skill and `docs/workflow/`, and the lane rules in [README.md](README.md). Those rules cover your ID range, your records file, scratch, ports, builds, merging and the contingency for running out of IDs.

## Start

1. Your worktree is `C:\Projects\RisuAI\.claude\worktrees\Lane-B` on branch `worktree-Lane-B`, created by the maintainer from `74b28ddd1`. Your session is rooted there. Check `git status` and `git log -3`. Read this brief and the README from `C:\Projects\RisuAI\Agents\Lanes\` until they are committed.
2. Create `Agents/Lanes/lane-B-records.md` on your branch (sections: MC entries, CHORE entries, ledger rows, handoff).
3. Your IDs: MC-355 to MC-374, CHORE-220 to CHORE-239, ledger rows 2300 to 2499. Overflow: MC-400 to 409, CHORE-300 to 309, rows 3000 to 3099. Scratch: `%TEMP%\risu-lane-b\`. Ports: 6400 to 6419.

## Read first

- Decisions, by heading in `Agents/Maintainer-Context.md`: `MC-175` and `MC-223` (`.bin` compatibility, the only size exception), `MC-318` 6 and 7, `MC-323`, `MC-324` 1 (tiered test data), `MC-326`, `MC-328`, `MC-329`, `MC-330`, `MC-334`.
- `Agents/Roadmap.md`: CHORE-194, CHORE-182 and CHORE-103.
- Evidence in lane A's scratch (read-only for you):
  - `%TEMP%\risu-b715\mc323\fit-map.md` with `fit-map-verify.md` (the import/export pipeline map, with corrections).
  - `%TEMP%\risu-b715\ioarch\report.md`, `report-verify.md` and `advisor.md`.
  - `%TEMP%\risu-b715\measure2\report.md` with `verify.md`: today's Note 9 debug-build figures. Use the corrected figures only; its screen-off mechanism is withdrawn.

## Scope, in this order, each a separately gated stage

1. **CHORE-194.** The import size and time warning is keyed on the database entry, which comes out low for stub-form files. Its draft correction and acceptance are in the ticket.
2. **Read the `.bin` once and decode the database once** (`MC-328` 2 page fixes, `MC-323` lead 6, CHORE-103). Locate the database from the file's tail, read the source once, and decode the database entry once. In the Note 9 run (debug build, 170.8 MiB database), renderer plus app PSS peaked at 853 MiB (at "assets copied") and 881 MiB (at the database decode) in the two runs; at the decode they were 688 and 881 MiB.
3. **Parallel large entries** (`MC-328` 2).
4. **Android batched asset reader for export** (fit-map E1). The Note 9 stub export of 3,000 small assets took about 7.5 min in the per-asset read loop, against 13.5 s for the whole export on the PC.

Already done, not in scope: the faster base64 (`ac5b4e105`, on `main`).

Out of scope; lane C or later, do not start: role-play-first import and keeping the previous profile (`MC-326` 5 and 10), resume (`MC-326` 2 and 3), background or screen-off import (`MC-326` 4), the thin native task, native export, Node endpoints, the fork-native format (`MC-327`), and any `.bin` format change (`MC-175`). If a stage needs one of these, stop and ask the maintainer.

## Files you own

The import and export path: `src/ts/drive/backuplocal.ts`, `storeImport.ts`, `backupContainer.ts`, `importEstimate.ts` and `exportInline.ts`, plus `src/ts/storage/tauriAssetBatch.ts` and `src/ts/storage/tauriByteTransport.ts`, with their tests. For stage 4, also `src-tauri/src/asset_batch.rs` if a batched read command is needed. Name any other file in your stage plan before touching it. Lane D does not touch these files.

## Gates

- Every stage changes save or import/export behaviour, so it gets a Gate 1 plan review and a Gate 2 review by `opus-reviewer`.
- Stage 2 changes how the database is read, and is expensive to reverse, so it also gets a `senior-advisor` challenge before Gate 1.
- Every change needs red-before-green evidence (`MC-329`).
- An upstream round trip of a `.bin` covers any change that touches what is written or read (`MC-175`).
- Each stage passes its focused tests and `pnpm check`. Full `pnpm test`, `pnpm check` and `pnpm build` run at each stage's end. For load flakes, see the README.

## Devices

You do not drive the phones. Prove logic on the PC first (headless Chrome or vitest, `MC-330` 3). When a stage needs Note 9 numbers, write a device request (build, fixture, data ceiling, time limit, pass/fail exit) to `%TEMP%\risu-lane-b\device-requests\` and tell the maintainer; lane A runs it. Android builds use your own `CARGO_TARGET_DIR`.

## Done

A stage is technically accepted when its gates pass, its records are in `lane-B-records.md` and verified by `doc-verifier`, and the maintainer has approved its commit. It is COMPLETE only after lane A folds its records into the shared files (`docs/workflow/records.md`). Merging into `main` follows the README.
