# #560 stage handoff: PR3 done, ticket closes (2026-11-23)

## 1. Completed PR

- PR3 is the last #560 PR, on branch `claude/560-pr3-c2f3f8` from origin/main 7817e0cee. Its body carries `Closes #560`.
- Earlier #560 PRs, all merged: PR-A #597, PR-A2 #611, PR-B #622 and PR2 #693.

## 2. Decisions

- **MC-3881** (orchestrator readings, `Agents/mc/560.md`) reads MC-3422, MC-3427, MC-3429 and MC-3431 under MC-3638:
  - `::before`/`::after` must directly end the last compound. They take the safe tier, and `content` accepts only `""` or `''`.
  - mask, clip-path and border-image are admitted. On a control part, mask and clip-path give a `layout` note.
  - Rule E-2 is a 64 px total reach in chat and Studio. Settings and Home keep the 64 px cap per length.
  - The DD-243 outline ban is lifted. Removing the ring in a focus state gives a `readability` note.
- MC-3422's bans stay: z-index, position fixed/sticky, `content` text, direction, unicode-bidi, writing-mode, `all` and offset. url() stays bundled-only.
- The notes channel shape from PR2 is unchanged, so #438 S3c-B needs nothing new.

## 3. Evidence

- New `src/ts/themePack/effectsAdmission.test.ts`: on the base, 112 tests fail and 30 pass (the 30 are the COMPAT and GUARD rows; Gate 2 executed this).
- themePack suite: 4284 passed. The 5 known environment failures are tailwind and wasmoon, which the worktree has no `node_modules` for; CI covers them.
- svelte-check: 0 errors. The corpus has 0 verdicts going from OK to NO, and the canonical column is byte-identical.
- Gates: Gate 1 r1 [REJECT] (pseudo-element after a combinator), then r2 [EDITORIAL]. Gate 2 r1 [EDITORIAL], with fixes in the PR. All by opus-reviewer.
- Judge cost: base and head medians are in the PR body. No sheet moved by more than about 1 ms, and the corpus is +2%.

## 4. Leftovers (in the PR body)

- run.mjs was red on the base (272 FAIL). At head it has 276; the 4 extra are `new:*:outline-color transparent`, which are notes now.
- Stale comments in `chat/themes/scratch-white.css` and `office-sheet.css`, which byte pins hold. They go to #452.
- The digit regex in engine.ts `maxLen` is cubic. This predates PR3, and the 60 s judge timeout bounds it.
- #207 (re-tightening): closing it needs the maintainer.
