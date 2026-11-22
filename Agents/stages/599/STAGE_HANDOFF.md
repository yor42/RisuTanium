# Stage handoff: #599 plugin getDatabase without installs

- Completed: PR https://github.com/yor42/RisuTanium/pull/640 (Closes #599). Reviewed head: commit 6a29f91b7, merged with main as b9e784efd (the merge adds only main's chat-drafts change to `codec/split.ts`).
- Decisions: MC-3694 to MC-3699 in `Agents/mc/599.md` (waits, write-stall rule, chat change, repeat reads, early host numbers, retained-paths record). Unused block: MC-3700 to MC-3703.
- Changed files: `src/ts/plugins/apiV3/moduleStubCopy.svelte.ts` (new), `src/ts/plugins/moduleStubWrite.ts` (new), `src/ts/plugins/apiV3/v3.svelte.ts`, `src/ts/plugins/plugins.svelte.ts`, `src/ts/plugins/retainedCarry.ts`, `src/ts/storage/store2/codec/split.ts`, `src/ts/storage/store2/residency.ts`, and tests: `v3ModuleWriteBack` (new), `v3ModuleStubsRealLoader`, `v3ModuleStubs`, `retainedCarry`, `store2/residency`, plus three typed fakes.
- Tests:
  - Red run on base 72a7e32a4: 46 of 151 fail, no import failure.
  - Mutants: all planned ones killed.
  - After the merge: 985 files, 22000 tests passed; svelte-check 0 errors.
  - Host A/B: medians of 5, numbers in the PR body.
  - Gates: Gate 1 opus [REJECT] then [EDITORIAL]; Gate 2 opus [EDITORIAL], test-only fix re-checked [APPROVE].
  - CI: TODO(evidence).
  - Device rows DV-599-1 to DV-599-8: TODO(evidence), requested from lane B.
- Unresolved:
  - Before merge, the maintainer sees the Note 9 numbers of DV-599-7 and DV-599-8 (MC-3697), and DV-599-3 if it is over 110% of today on either library shape (MC-3695, MC-3698).
  - The worktree has its own `node_modules` from an unauthorized install, kept on lane A's instruction until worktree cleanup.
  - Boundary with #600: #599 owns the v3 read and write-back, and #600 the module save-tracking effect. Device A/B arms state which #600 state they have.
  - Leftovers: a stale `moduleLoader.ts` comment, and `withoutModuleUnit` duplicated from the loader (both wait for `moduleLoader.ts` to be assigned). Follow-up #641 (existing parseRisuChat inject write into another chat).
- Next stage: none remains for #599.
