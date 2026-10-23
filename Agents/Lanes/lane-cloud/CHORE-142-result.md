# CHORE-142 result: `generate-and-verify.harness.ts` runs again

**Status:** proposed FIXED on `lane-cloud`; technically accepted at Gate 2 `[APPROVE]` (ledger row 5001). Commit `dc82aff` (together with the lane Cloud records file; `MC-700`). Short entry: [CHORE-142 in lane-cloud-records.md](../lane-cloud-records.md).

## Question / ticket ask

`Agents/Roadmap.md`, "### CHORE-142 — `Agents/Tools/generate-and-verify.harness.ts` is broken" (status 2026-10-08, open, type tooling): the entry lists it "without details" and says TODO(evidence): the failure and the commands that show it. The entry's path is wrong: the file is `Agents/Tools/save-gen/generate-and-verify.harness.ts`.

## Environment

Linux container, Node 22.22.0, 4 CPUs, loaded. Base `9a6127354`. Command: `npx vitest run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/generate-and-verify.harness.ts`. Timings (6.4 s Gate 2; 6.12 s verifier) are indicative only and are not evidence for the Note 9 or Pi targets. Scratchpad paths are in the session scratchpad (`/tmp/claude-0/-home-user-RisuTanium/fdce1fd0-b592-51b6-b636-a27a87425761/scratchpad/`), not in the repository.

## Findings

1. **The failure reproduces on the base. CONFIRMED (RUN).** Exit 1 with `[vitest] No "readImage" export is defined on the "src/ts/globalApi.svelte" mock`, 4 tests skipped. The import chain is `characters.ts` to `avatarThumb.ts` (session scratchpad `c142/result.md`). The pre-fix run was not re-executed by the verifier (`c142/cv/result.md`).
2. **Cause: stale mocks. TRACED.** The harness mocks were copied from `src/ts/storage/tests/risuSave.test.ts` and drifted. That test now also mocks `src/ts/storage/store/appStore` through `appStoreModuleOver` from `src/ts/storage/tests/appStoreMock`; the mock keeps the real application graph (and so `characters.ts`) from loading. The verifier confirmed `risuSave.test.ts:56-59` mocks it that way.
3. **`appStore` is not on the verified path. TRACED (orchestrator and Gate 2).** `risuSave.ts` imports `getAppStore` (import at line 6) and uses it only in a remote-sync branch (sole use at line 1335, verifier). `encodeRisuSaveLegacy`, `decodeRisuSave` and the harness's container framing do not touch it, so the mock bypasses no checked path.
4. **Not mocked:** the encoder, decoder and backup container. The `saveYield` mock was not needed and the harness does not claim to mirror it.

## What changed and evidence

Only `Agents/Tools/save-gen/generate-and-verify.harness.ts`; the records file travels in the same commit. `git diff --numstat` 15 insertions, 5 deletions (verifier); no assertion line is in the diff.

- A `vi.mock` of `src/ts/storage/store/appStore` built from `appStoreModuleOver(() => forageStorage ...)`, as in `risuSave.test.ts`.
- `store` declared through `vi.hoisted`, because the hoisted `vi.mock` factories run before plain top-level `const`s are initialised.
- `import type { ForageLike }`.
- The header and region comments changed from "copied verbatim ... (lines ~7-55)" to "mirrors", removing the stale line reference.

Evidence:

- Post-fix: same command, exit 0, 1 file, 4/4 passed. Runs: implementer 3 (no flake seen), reviewer 1 (6.4 s), claim verifier 1 (6.12 s). The orchestrator's own run is listed in the records file but was UNVERIFIABLE to the claim verifier.
- Mutant (reviewer, scratch copy of the harness, a `decodeRisuSave` wrapper drops one character): 4/4 fail with "expected 30 to be 31". The assertions are live. Not re-run by the verifier (`c142/g2/result.md`).
- Comments: "mirrors" matches the file's mocks; the `vi.hoisted` comment states the invariant; no line numbers added (pre-existing comments elsewhere cite `src` line numbers and are untouched).
- `Agents/Tools/output` is gitignored.
- No CR in the diff, no line-ending churn (verifier).

## What was not done / residuals

- `pnpm test` and `pnpm check` were not run: the test glob matches `*.test`/`*.spec` only, not `*.harness.ts` (harness config unchanged), and `tsconfig.json` includes `src/**` only (verifier, `tsconfig.json:32`), so `pnpm check` does not cover `Agents/Tools`.
- The harness is not part of CI; nothing guards it from drifting again. Not addressed.
- Pre-existing comments in the harness citing `src` line numbers were left untouched (out of scope).
- Baseline context: the lane's baseline full suite on the base had unrelated failures in store2 (see the "For lane A" section of the records file); they do not involve this harness. One of them, `saveLoop` "a commit with flushed:false does not count as saved", may be a persistence defect rather than a test race; it is passed to lane A (or lane B) in that section, not traced here.

## Decisions

`MC-700` ("you can commit the completed items": the quote is UNVERIFIABLE exactly; there is no transcript in the repository, the verifier found it matches the task's quote only). Related `MC-701`. Full text: [lane-cloud-records.md](../lane-cloud-records.md); ledger rows 5000, 5001 and 5004 are there.

## Corrections from doc-verifier

This section takes precedence over the body above. Seeded from the corrections issued in the claim verification of the CHORE-142 commit message and records file (session scratchpad `c142/cv/result.md`; ledger row 5004).

1. The verifier's trailer finding was rejected by the orchestrator (row 5004): the trailer is the session's prescribed attribution.
2. **Lane A's "21,163 passed" run.** OVERSTATED as "same tree": the figure is from `Agents/Handoff-2026-10-23-laneA.md` for merge `3882db23e`, and was not shown to be the same tree as `9a6127354`. Correct form: merge `3882db23e` per the lane A handoff; `9a6127354` differs from it only in records and one workflow script (applied in the records file; not used in this report's body).
3. **"timeouts only"** for the store2 `actors` failures is OVERSTATED mildly: say "no assertion failures in the log". The log shows 0 AssertionError but only 4 distinct timeout messages for 9 failures (others grouped). (Records-file wording; applied there.)
4. **Cloud ID ranges** (MC-700..., CHORE-500..., rows 5000...) are UNVERIFIABLE from `Agents/Lanes/README.md`, which has no Cloud block. The records file now cites the lane brief: the maintainer's lane Cloud brief of 2026-10-23, the session's opening message, which is not a repository file.
5. UNVERIFIABLE, no evidence available: the `saveLoop` alone runs (2/3, 4/4, Node 24 1/4; no log), the ledger token figures (32,460 and 29,539), the exact wording of the `MC-700` quote.
