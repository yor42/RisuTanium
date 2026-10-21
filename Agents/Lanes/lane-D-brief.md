# Lane D brief: UI lists and small items

You are the orchestrator of lane D. Follow `AGENTS.md`, the `campaign-workflow` skill and `docs/workflow/`, and the lane rules in [README.md](README.md). Those rules cover your ID range, your records file, scratch, ports, builds, merging and the contingency for running out of IDs.

## Start

1. The maintainer starts this lane as a separate Claude session rooted in its own worktree, `C:\Projects\RisuAI\.claude\worktrees\Lane-D` on branch `worktree-Lane-D`, the same way lane B was started. Check `git status` and `git log -3` there. Read this brief and the README from `C:\Projects\RisuAI\Agents\Lanes\` until they are committed. CHORE-195 is not on `origin/main` until lane A's next records commit; until then read it in `C:\Projects\RisuAI\Agents\Roadmap.md`.
2. Create `Agents/Lanes/lane-D-records.md` on your branch (sections: MC entries, CHORE entries, ledger rows, handoff).
3. Your IDs: MC-375 to MC-394, CHORE-240 to CHORE-259, ledger rows 2500 to 2699. Overflow: MC-410 to 419, CHORE-310 to 319, rows 3100 to 3199. Scratch: `%TEMP%\risu-lane-d\`. Ports: 6420 to 6439, including the preview server for live checks.

## Read first

- Decisions, by heading in `Agents/Maintainer-Context.md`: `MC-256`, `MC-257`, and `MC-273` to `MC-279` (the character list rework).
- `Agents/Roadmap.md`, the sections "Character list rework" (S4-4 to S4-6 remaining, with the notes R5 and the S4-2 notes), CHORE-154 to CHORE-157, CHORE-169 to CHORE-174, CHORE-192 and CHORE-195.
- **The plans are older than the code.** The character list plans date from 2026-10-10 to 12. Since then the store2 storage rewrite and the unload work landed on `main`. Re-trace the current code before trusting any file or function a plan names. The plan files the Roadmap cites (`plan-s4.md`, `plan-s4-2b.md`, `answers.md`) were in the old scratch and may have been removed in the 2026-10-21 cleanup. If they are gone, rebuild the plan from the Roadmap text and the code, and say so in your Gate 1 plan.

## Scope, in this order, each a separately gated stage

1. **Character list S4-4.** Drag: hit test, moves, append to a folder, dwell merge onto a character, Alt+Left/Right, the "Moved N items" announcement. It must also restore source-gone cancellation during a tile drag and bring Grid edge scroll back while dragging tiles. It writes `characterOrder`, so Gate 1 and Gate 2 use `opus-reviewer`.
2. **S4-5** (the folder-menu extraction and the Grid menu) and **S4-6** (arrow-key focus).
3. **Windowing** of the plugin, module and preset lists (CHORE-169 to CHORE-174, as far as they cover it).
4. **Chat-render tickets** CHORE-154 to CHORE-157 (`MC-257`). CHORE-154 needs a differential test per sub-item proving output is unchanged.
5. **Small items, any time between stages:**
   - CHORE-192: the `risuai.d.ts` JSDoc example that closes its comment early.
   - CHORE-195: the hono server follow-ups, `server/hono` only. Switching `bun.ts` to `@hono/bun` is small. Moving to `@hono/node-server` 2.x is a major bump: assess it first and ask the maintainer before taking it.

Out of scope: storage, save format and import/export code (lane B), the device scripts (lane A), and CHORE-193 (lane A).

## Files you own

The character list and sidebar components, the list components you window, the chat-render pipeline files the CHORE-154 to CHORE-157 tickets name, `src/ts/plugins/apiV3/risuai.d.ts`, and `server/hono/**`. Name each file in your stage plan. If a stage needs a storage, persistence or import/export file, stop and ask the maintainer, because lane B owns those.

## Gates and checks

- Every stage gets a Gate 2 review; nontrivial stages also get a Gate 1 plan review.
- Stages that write `characterOrder` or other saved state use `opus-reviewer`.
- Every change needs red-before-green evidence (`MC-329`).
- UI acceptance uses the built-in preview first (`docs/workflow/live-checks.md`), on your port range and with synthetic data. The preview pane must be visible: a hidden pane runs no animation frames.
- New UI strings: English in the worktree's `en.ts`. The translator writes the other locales to your scratch, and your coder copies them in (README, "Translations"). Use "first message", never "greeting".
- Full `pnpm test`, `pnpm check` and `pnpm build` run at each stage's end. For load flakes, see the README.

## Done

A stage is technically accepted when its gates pass, its records are in `lane-D-records.md` and verified by `doc-verifier`, and the maintainer has approved its commit. It is COMPLETE only after lane A folds its records into the shared files (`docs/workflow/records.md`). Merging into `main` follows the README.
