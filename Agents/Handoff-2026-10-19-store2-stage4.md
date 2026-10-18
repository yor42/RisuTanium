# Handoff 2026-10-19: store2 stage 4, after W5

For the next orchestrator session. Read this first, then [Live-State](Live-State.md) (its 2026-10-19 update) and the decision index for MC-287, MC-289, MC-299 and the stage 4 MC entries recorded on 2026-10-19 (MC-309 onwards).

## Where things are
- **Branch `feat/alite-s4`**, worktree `C:\Projects\RisuAI\.claude\worktrees\alite-s4`, HEAD `b45de7275`. **Not merged, not pushed.** It holds 4a-W steps W1 to W5 (18 commits after `main`'s `092643e32`: W1a `e94412c5f` to W5d1 `b45de7275`). 4a-L is already merged on `main` (`81b016cb4`).
- **4a-W merges together with 4b**, after the maintainer's A4 upstream round trip (MC-299 5). Do not merge 4a-W alone.
- **Final checks on `b45de7275`** (orchestrator, 2026-10-18): `pnpm test` 846 files passed, 1 skipped (18944 passed, 1 expected fail, 23 skipped); `pnpm check` 0 errors 0 warnings; `pnpm build` OK; `node util/checkReleaseDist.mjs dist` OK, 229 files.
- Every W step passed its own Gate 2 (opus-reviewer); gate histories and rulings are in the ledger rows from 1812 and in the decision files below.
- The main checkout carries someone else's uncommitted changes (`.claude/launch.json`, `docs/branding/RisuTanium_Gradient.svg`, untracked `0`, `docs/planning/`, `Agents/Handoff-2026-10-08*`). Leave them alone. In the worktree, `src/ts/process/mcp/risuaccess/tests/__snapshots__/modules.test.ts.snap` shows as modified: never stage or touch it.

## What W1 to W5 built (one line each; details in the commit messages)
- **W1:** the store2 save loop behind `saveDb` (encoder, `previousOfTree`); inactive until boot dispatch.
- **W2:** boot dispatch rows (normal, too-new, OPFS, capability, seed, convert with confirmation), read-only no-write switch, leaf fallback, legacy-to-store2 conversion.
- **W3:** boot screen for start-up questions, recovery exit entry and screen, presence probes, peer prompts and save-failure wording (strings went through the translator).
- **W4:** character residency (load on access, boot opens characters as stubs, unload engine, quiet trigger), `.bin` export inline, legacy cold-storage writers closed on store2.
- **W5:** legacy deleters only on legacy and block pages (W5c); type 24 `deletionSnapshot` written at conversion and seed (W5a); C1 deletion of old fork-format files plus the store2 maintenance runner (W5b); sweep and inlay keep-set dry run, dev builds only, `await __risuSweepDryRun.run()` in a measurement build (W5d1). No asset removal and no store2 inlay deletion until stage 5 (W5-Q6 to Q8); MC-289 stays open.

## Next work, in order
1. **W6:** snapshot / restore list (MC-299 4: store2 restore points first, kept upstream numbered backups listed separately and labelled old), `getDbBackups` rewrite, dev GC action, pacing. Gate 2. S0 reproducer 2 flips at W6 (`getDbBackups()` gains an entry); re-run it as a plain `test`, not `test.fails`.
2. **B3:** `.bin` restore flow on the installer (replaces `replaceWithRestoredSet`, including `loadInternalBackup`). Note: B3 restore currently writes no deletion snapshot (residual).
3. **B4:** export from units (R5). **B5:** remaining entries (`exportAsDataset`, UserSettings).
4. **4b** (scope in `scope-4b.md`), then the close in the plan: replay and live-server re-run with 429 injection, full checks by one owner, device checks (Tauri gate first run, E8, two-tab seed/commit, recovery screen; integrated Note 9 checks), the maintainer's A4 round trip, then merge.

Each step: design (investigator) → senior-advisor if expensive to reverse → Gate 1 (opus-reviewer) → sonnet-coder with an exact grant → Gate 2 (opus-reviewer) → orchestrator verification → commit on `feat/alite-s4` with named paths. Product questions go to the maintainer via AskUserQuestion before the dependent design is approved.

## Open residuals (the main ones; the full list, with carries, is in Live-State's 2026-10-19 update)
U8 same-named main-file swap undetected; one in-flight C1 batch can finish after a fence lands; case-sensitive unit-id comparison; B3 writes no snapshot; the bootstrap call to the store2 maintenance runner is untested (a missing call fails safe); W5d1 stage 5 inheritances (resident-inlay scan ignores the too-deep flag, commit key read before listing, `il: null` owner unrecorded, `isOwnerResident` fixed false in the dev action, closure read one unit per call, inlay candidates are page-store `inlays/m-` only); `dbbackup-*` kept on fork-only profiles departs from A2.4a.

Carries that steer the next steps: the W3-Q9 / X1 import action stays hidden until **B3**; until **B4** a Node tab with unsaved edits is offered Reload only (W3-Q12); "load the stubs, then Save mine" is revisited at **W6 or B3** (W4-Q5, MC-314); the W1 "Export this tab first" base is not pinned against a peer commit or the dev GC action (relevant to the W6 GC action).

## Working notes that cost time this session
- **Write grants:** register with the **main checkout's** script and absolute worktree paths, right after the Agent launch returns the agent id:
  `& C:\Projects\RisuAI\.claude\scripts\register-write-scope.ps1 -SessionId <session> -AgentId <id> -Role sonnet-coder -Files @('C:\Projects\RisuAI\.claude\worktrees\alite-s4\src\...')`
  The worktree's own copy of the script writes a registry the hook does not read; relative paths are refused. Registration replaces the previous scope; `-Revoke` needs `-Role` too. Invoke in-process with `&`, not `pwsh -File` (array arguments break).
- **Tests:** a reproducer must be red on the pre-fix base; a file that fails at import there proves nothing, so red evidence for new modules comes from mutants (apply, record the failing test, revert, SHA-256 before = after).
- **Measurement code** follows MC-300/MC-301: gate on `MEASURE` from `src/ts/process/memory/measureFlag.ts`, static import with the call under `if (MEASURE)` (a dynamic import left an orphan chunk), and add the global's name to `FORBIDDEN_MARKERS` in `util/checkReleaseDist.mjs`.
- Editor (LSP) diagnostics in the worktree are often stale; trust `pnpm check`.

## Scratch (local, not in the repository)
`C:\Users\yor42\AppData\Local\Temp\risu-b715\s4\`: gate verdicts, hand-backs, designs (`w2-design.md`, `w4\`, `w5\`), `scope-4a.md`, `scope-4b.md`, `advisor.md`. Its `job-tmp\` subfolder is a copy of the previous job's folder: the approved plan `s4-plan.md`, per-step rulings `w1-decisions.md` to `w5-decisions.md`, every brief, the commit messages and check outputs. The rulings that matter are now in the repository records; the scratch is supporting evidence and may be cleaned with `%TEMP%`.
