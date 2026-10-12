# Runtime unload, the work after increment 1: records of the cloud session (branch `feat/unload-2`)

This file holds every record this session produced, for the main session to fold into `Maintainer-Context.md`, `Decision-Index.md`, `Investigation-Ledger.md`, `Roadmap.md` and `Live-State.md` at merge. Reserved ranges: `MC-300` to `MC-319`, ledger rows 2001 to 2099, `CHORE-200` to `CHORE-219`. Branch base: `origin/main` at `f45ac41`.

Environment: a cloud Linux container (no Note 9, no Android build, no Windows, no Tauri desktop; the PowerShell write guard does not run here, so ownership was kept by discipline). Every device or Tauri claim below is owed, not observed.

## Maintainer decisions (MC format)

### MC-300 — Unload-2 session, 2026-10-12: the stage-1c measurement code is kept, compiled out of normal builds

- **Tag:** decision (`AskUserQuestion` answer, by option label)
- **Date:** 2026-10-12
- **Sweep ref:** none (stated directly this session)
- **Source:** this session's `AskUserQuestion`. Question as asked: "What should happen to the stage-1c measurement code (the MEASURE switch, the __risuPutBackMeasure counters and the late-write tripwire)? Today a normal build compiles all of it out; only a dev build or a VITE_RISU_MEASURE=1 build has it."
- **Reasoning:** the chosen option's text: "Leave it as is, compiled out of normal builds. Stage 2 (re-archiving edited characters) will need the same counters to be measured on the Note 9 and Windows. The new dist check guards that it never ships. Revisit after stage 2."
- **Alternatives rejected:** "Remove after stage 2" (keep it now and ticket its removal once stage 2 is measured); "Remove it now".
- **Related:** `MC-270` (D4, the dev-only A/B flag, "removed after measurement"), the Roadmap stage 1c paragraph ("removed or folded down after measurement except what the maintainer keeps"), `MC-301`.

**What was decided:** keep `measureFlag.ts`, `putBackMeasure.ts` and their hooks as they are. A normal build keeps folding them away. Revisit after stage 2 is measured. This settles the Roadmap's open "whether it is kept" for now.

### MC-301 — Unload-2 session, 2026-10-12: the `dist` check for the measurement code is a script plus a CI step

- **Tag:** decision (`AskUserQuestion` answer, by option label)
- **Date:** 2026-10-12
- **Sweep ref:** none (stated directly this session)
- **Source:** this session's `AskUserQuestion`. Question as asked: "Where should the release check that confirms __risuPutBackMeasure is absent from dist run?"
- **Reasoning:** the chosen option's text: "A small node script with a `pnpm check:dist` command, and a CI step after `pnpm build` in ci.yml, so every main push and PR checks it automatically."
- **Alternatives rejected:** "Script only" (run by hand before a release); "Script + all builds" (also a step in the desktop and Android release workflows).
- **Related:** `MC-300`; the release requirement in the Roadmap stage 1c paragraph and the Live-State unload bullet.

### MC-302 — Unload-2 session, 2026-10-12: stub v3 answers (the edited creator with a fallback, for loaded and archived characters; a one-time upgrade of existing stubs; no length limit)

- **Tag:** decisions (`AskUserQuestion` answers, by option label)
- **Date:** 2026-10-12
- **Sweep ref:** none (stated directly this session)
- **Source:** this session's `AskUserQuestion`, three questions, quoted below with the chosen option's text. The sizing they rest on: ledger row 2001.
- **Reasoning:** none stated, except where the option text carries it.
- **Alternatives rejected:** per item below.
- **Related:** `MC-268` item 7, `MC-270` item 3, `MC-175`, `MC-223`.

**What was decided:**
1. **Which creator search and the stub use: "Edited one, fallback (Recommended)".** The question explained that search reads the top-level `creator`, set only at import, while the character settings edit `additionalData.creator`, which export also writes, so an edited creator is not searchable today. Option text: "Use the creator you edit (additionalData.creator); if it is empty, fall back to the top-level one. Applies to loaded and archived characters alike, so this also fixes search for edited creators." Alternatives: "Both fields" (search matches either; the stub carries both), "Top-level only" (keep today's field).
2. **How existing archived characters get tags and creator: "One-time upgrade (Recommended)".** Option text: "At the next startup where archiving runs, each archived character's archive file is read once and its stub rewritten (with the existing 'Updating archived characters n/N' progress). One-time cost, proportional to library size. Platforms where archiving never runs (iOS, OPFS-only browsers) keep old stubs, still working, just without tag search." Alternative: "Only new archives".
3. **A length limit on tags and creator in the stub: "No limit (Recommended)".** Option text: "Copy them whole. The stub stays far smaller than the full character, and an archived character keeps matching exactly the same searches as a loaded one." Alternative: "Limit them".

**Orchestrator note (not asked; a correctness requirement from the sizing):** raising `COLD_STUB_VERSION` must not change the chat count an older fork stub shows. Today `coldStubChatCount` trusts `coldChatCount` only on a current-version stub, so a bare bump would show a chat count of 1 on every v2 stub until it is upgraded, forever where the pass does not run.

### MC-303 — Unload-2 session, 2026-10-12: card import to the archive answers (import live when archiving cannot run; skip archiving for an import that opens the character; fall back per card and stop after two failures in a row; silent fallback)

- **Tag:** decisions (`AskUserQuestion` answers, by option label)
- **Date:** 2026-10-12
- **Sweep ref:** none (stated directly this session)
- **Source:** this session's `AskUserQuestion`, four questions, quoted below with the chosen option's text. The sizing they rest on: ledger row 2002.
- **Reasoning:** none stated, except where the option text carries it.
- **Alternatives rejected:** per item below.
- **Related:** `MC-268` item 4, `MC-273`, `MC-139` 3 (orphan units accepted).

**What was decided:**
1. **Archiving cannot run on this device (iOS, a browser without the needed storage features, or archiving turned off in settings): "Import live (Recommended)".** Option text: "Import the character as a normal loaded character, exactly as today. The next startup that can archive will archive it." Alternative: "Refuse with a message".
2. **An import that opens the new character at once (Realm or hub downloads with "go to character on import", or a forced redirect): "Skip archiving (Recommended)".** Option text: "Keep them loaded, since they would be restored from the archive right away anyway. Put-back archives them once you move on and they're unchanged." Alternative: "Archive anyway". Orchestrator note: put-back swaps back only a character that was restored from a unit (it needs a retained stub), so such an import stays loaded until the next boot archive pass or stage 2; the option text's "Put-back archives them" is accurate only once stage 2 or a boot pass has archived them.
3. **A bulk import whose archive write fails: "Fall back, stop after 2 (Recommended)".** Option text: "A card whose archive write fails is imported as a normal loaded character (nothing is lost). After two failures in a row, the rest of the batch imports live without trying to archive, like the startup archive pass does." Alternative: "Fall back per card".
4. **Telling the user about a fallback: "Silent (Recommended)".** Option text: "No message: the character imported fine and nothing was lost; it is just held in memory until a later archive." Alternative: "Short notice".

### MC-304 — Unload-2 session, 2026-10-12: a permanently deleted archived character leaves its archive file for the manual cleanup

- **Tag:** decision (`AskUserQuestion` answer, by option label)
- **Date:** 2026-10-12
- **Sweep ref:** none (stated directly this session)
- **Source:** this session's `AskUserQuestion`. Question as asked: "Trashed characters will now be archived too. When an archived character in the trash is deleted for good (by hand, by 'empty trash', or by the 3-day automatic purge), what should happen to its archive file?" The sizing it rests on: ledger row 2007.
- **Reasoning:** the chosen option's text: "Leave the archive file on disk, exactly as delete works today for every character. The planned manual cleanup (the orphan counter and prompt) reclaims it later. This adds no new delete path in the riskiest part of saving."
- **Alternatives rejected:** "Delete it too" (deleting the character also deletes its archive file and chat files right away).
- **Related:** `MC-268` items 2 and 6, `MC-139` 3 (orphan units accepted), `MC-148`.

**What was decided:** trash archiving adds no unit deletion. Single permanent delete, "empty trash" and the startup purge keep today's contract: the stub goes, its units stay for the manual cleanup.

**Orchestrator note (implementation-level, not asked):** the boot archive pass runs before the startup purge in the same boot, so a character whose purge is already due would get a unit written and then orphaned at once. The pass will skip a trashed character whose purge is due, sharing the purge's age constant.

### MC-305 — Unload-2 session, 2026-10-12: stage 2 answers (all loaded characters; re-archive when you move on; stay loaded silently on failure; delete the character's previous archive file once the new one is safe)

- **Tag:** decisions (`AskUserQuestion` answers, by option label)
- **Date:** 2026-10-12
- **Sweep ref:** none (stated directly this session)
- **Source:** this session's `AskUserQuestion`, four questions, quoted below with the chosen option's text. The sizing they rest on: ledger row 2008.
- **Reasoning:** none stated, except where the option text carries it.
- **Alternatives rejected:** per item below.
- **Related:** `MC-268` items 2 and 3, `MC-270`, `MC-273`, `MC-139` 3, `MC-141` item 2.

**What was decided:**
1. **Scope: "All loaded characters"** (not the recommended option). Option text: "Also archive loaded characters that were never archived, during use. Covers more memory, but there is no 'before' snapshot to compare against, so it needs a separate scan and more code in the save path." Alternative rejected: "Opened from archive (Recommended)".
2. **Timing: "When you move on (Recommended)".** Option text: "Right after the next save once you have switched away (the one you just left stays loaded). Frees memory soonest. Switching back and forth while editing writes a new archive copy each time." Alternative rejected: "Only past a memory limit" (about 50 MB).
3. **Failure: "Stay loaded, silent (Recommended)".** Option text: "The character just stays loaded; nothing is lost. After two failures in a row, stop trying for the rest of the session, like the startup archive pass does." Alternative rejected: "Stay loaded, tell me".
4. **Old copies: "Delete the old copy now"** (not the recommended option). Option text: "Delete the character's previous archive file right after the new one is safely saved. Saves disk, but adds a delete step to the save code in stage 2." Alternative rejected: "Yes, manual cleanup (Recommended)".

**Orchestrator note:** item 4 applies to a re-archive replacing a character's own previous unit; `MC-304` (permanent delete leaves units) is unchanged. "Safely saved" must cover the stub that names the new unit being committed, and any snapshot, backup or other copy that still names the old unit; the plan settles this at Gate 1 against the manual cleanup's keep rules, and any remaining product trade-off goes back to the maintainer.

### MC-306 — Unload-2 session, 2026-10-12: a card imported straight to the archive gets its creation date at import

- **Tag:** decision (`AskUserQuestion` answer, by option label)
- **Date:** 2026-10-12
- **Sweep ref:** none (stated directly this session)
- **Source:** this session's `AskUserQuestion`. Question as asked: "Imported cards that go straight to the archive get the same one-time tidy-up the app normally does the first time you open a character. One side effect: an older-format card (V2 or Tavern) gets its 'creation date' set to the import time instead of the time you first open it. The date shows nowhere in the app; it only appears inside a card you export. Is that fine?"
- **Reasoning:** the chosen option's text: "Stamp the date at import. Archived cards then open 'clean' and can be put back into the archive without a rewrite. An exported card that was never opened carries the import date instead of 0."
- **Alternatives rejected:** "Keep first-open date" (skip just the date during import; every older-format card then looks changed at first open and is re-archived once by stage 2).
- **Related:** `MC-303`, `MC-273`.

**What was decided:** on the archive path only, the import runs the character format step (which stamps `creation_date` when it is missing) before the unit is written. Cards imported live keep today's behaviour (stamped at first open).

## Ledger rows (2001 to 2099)

| Row | Date | Dispatch / question | Role | Usage | Gate | Outcome |
|---|---|---|---|---|---|---|
| 2001 | 2026-10-12 | Size stub v3 (tags and creator in the stub): builders, readers, the version bump, upstream reader, bounds, put-back, tests | `investigator` | 109,082 subagent tokens, 47 tool uses, 140,319 ms | n/a (sizing) | Packet, source reading only, on `f45ac41`. The only stub builders are `buildColdStub` and `enrichLegacyStub`, called from the boot archive pass; search is the only reader of tags and creator; a bare bump drops `coldStubChatCount` to 1 on v2 stubs; upstream compatibility from Reports 49 and 51 (read, not executed). Suspected pre-existing defect: search reads the top-level `creator` while the UI edits `additionalData.creator` (decided in `MC-302` 1). Questions answered in `MC-302`. |
| 2002 | 2026-10-12 | Size card import straight to the archive | `investigator` | 117,202 subagent tokens, 33 tool uses, 132,056 ms | n/a (sizing) | Packet, source reading only, on `f45ac41`. No reusable "archive one character now" function (the only unit writer that makes a stub is the boot pass); import never calls `characterFormatUpdate`, so an import archived without it would be dirty on first open (`MC-273`); only the realm and hub paths select the new character, and only with `goCharacterOnImport` or a forced redirect; plugins cannot add a character. Questions answered in `MC-303`. |
| 2003 | 2026-10-12 | Implement the `dist` check (`util/checkReleaseDist.mjs`, `pnpm check:dist`, the CI step) | `sonnet-coder` | 26,472 subagent tokens, 4 tool uses, 110,236 ms | Gate 2 in row 2004 | Executed: normal `pnpm build` then `pnpm check:dist` exit 0 (203 files); a `VITE_RISU_MEASURE=1` build into `/tmp` exit 1 with all three markers in one chunk; a missing directory exit 2. `.map` files are not scanned (they embed original source). |
| 2004 | 2026-10-12 | Gate 2, the `dist` check | `adversarial-reviewer` | 24,075 subagent tokens, 7 tool uses, 115,061 ms | Gate 2 | `[APPROVE]`, no substantive finding. Re-ran: normal build exit 0 (203 files, equal to the count of .js/.mjs/.cjs/.html/.css files in `dist`); a measurement build exit 1 with all three markers; a missing directory and a directory of dangling symlinks exit 2. Fact recorded: `pnpm build` is `vite build --sourcemap`, so a normal build ships 164 `.map` files, and `dist/assets/database.svelte-*.js.map` contains `__risuPutBackMeasure` and `risu-measure` in its `sourcesContent`; a literal `grep -r dist` therefore fails on a normal build, and the script deliberately scans only shipped code. Whether to ship source maps is a separate question, not raised. Optional: symlinks are skipped (Vite emits none). |
| 2005 | 2026-10-12 | Pin upstream's reader shape for an archived character, upstream's `.bin` import, and this fork's `.bin` export | `investigator` | 59,573 subagent tokens, 23 tool uses, 93,285 ms | Gate 1 input (stub v3) | Upstream `kwaroran/RisuAI` main at `979dbc9d5fd913abd6996eaec64e0f83be53964d` (`git ls-remote`), read in a scratch clone; source tracing only, nothing run. Upstream detects a stub by a truthy `coldstorage`, restores in `changeChar` by replacing the slot wholesale with the unit's `character` when its `chaId` equals the stub's, lists a stub from `name`, `image`, `chats.length` and `creatorNotes` only, never validates stubs on `.bin` import, has no `coldVersion` or `coldChatCount`, and declares top-level `tags` and `creator` on every character (its own defaults fill them on stubs too). This fork's export writes stubs as stubs plus `coldstorage_<key>.json` units. Conclusion: a v3 stub is read by upstream exactly as a v2 stub. |
| 2006 | 2026-10-12 | Gate 1, the stub v3 plan (`/tmp/unload2/stubv3/plan.md` v1) | `opus-reviewer` | 99,036 subagent tokens, 38 tool uses, 308,309 ms | Gate 1 | `[APPROVE]`; source reading and `git log -S/-G` only, nothing run. Confirmed the backwards `lastInteraction` defect (put-back refreshes the stub, the unit keeps the older value, enrichment copies the unit's) and the newer-of-two rule; the chat-count trust floor 2 (no version 1 was ever written); search reactivity on `additionalData.creator` through the deep `$state`; no data-loss path in the upgrade (no unit writes, nothing committed before the pass's commit); upstream claims against the clone at `979dbc9d`. SHOULD findings adopted as plan v2: invert the three existing tests that pin "stubs are not searched by tags or creator"; a reactivity reproducer for an edited creator; build the compatibility test from real builder output; add `tags` and `creator` to four `ENRICHMENT_FIELDS` lists and split the current and v2 stub fixtures; reword comments and logs that equate "legacy" with upstream-made. NIT accepted as a limitation: a group stub's member list remapped by duplicate-id repair reverts at upgrade, as restore already does. |
| 2007 | 2026-10-12 | Size trash archiving (`MC-268` item 6) | `investigator` | 81,778 subagent tokens, 32 tool uses, 77,456 ms | n/a (sizing) | Packet, source reading only, on `feat/unload-2`. Two gates exclude trashed characters: `isArchivableCharacter` and an inline `trashTime` check in the boot pass's `eligibleIndexes` (the pass does not call the former). The original reason (Report 49 D7, Report 51 R1) was trash-state fidelity, already solved: the stub carries `trashTime`, `applyStubStateOnRestore` makes the stub authoritative, and put-back copies the live value. Every trashed-character consumer (purge, permanent delete, empty trash, restore from trash, the trash list, search) reads only stub fields; none needs a restore. Permanent removals never delete units today. New hazard (inferred from the traced order): the pass runs before the startup purge, so a purge-due trashed character would be archived and then orphaned on the same boot. `idleReloadHost` `bytesExcluded` excludes trashed characters on the "never archived" premise. About 12 test files use a trashed character as an ineligible fixture. Question answered in `MC-304`. |
| 2008 | 2026-10-12 | Size stage 2 (re-archive characters changed after restore) | `investigator` | 172,741 subagent tokens, 53 tool uses, 345,431 ms | n/a (sizing) | Packet, source reading only, on `feat/unload-2`. Refuted premises: a dirty put-back verdict drops the retained record (stage 2 must keep it); no per-character "save landed" signal exists (commit callbacks run while the save is still in progress); the boot pass does not run `characterFormatUpdate`; the fork never writes chat units; put-back has no `canBootArchive` gate. Proposed engine: fingerprint, write a unit under a fresh key, read it back and compare fingerprints, then one synchronous swap with the put-back checks, gated by `canBootArchive`, `archiveCharacters === true`, no V2.1 plugin and formatversion >= 5, with a two-in-a-row breaker; shared with card import. First-open dirty (`MC-273`): stage 2 makes a remedy unnecessary for correctness (one extra re-archive per character); recommends measuring before adding one. Superseded units stay for the manual cleanup. Product questions listed for the maintainer. |
| 2009 | 2026-10-12 | Draft the plan for card import to the archive plus a shared one-character archive engine (`/tmp/unload2/import/plan.md`) | `Plan` | 170,846 subagent tokens, 46 tool uses, 458,508 ms | Gate 1 input | Draft plan, source reading only. New `process/coldCharacterArchive.ts` engine (fingerprint, unit under a fresh key, read-back with fingerprint compare, one synchronous final step, v3 stub, explicit save mark; never commits, formats or deletes; echoes a previous unit key for stage 2); `pointerChatKeys` moves to `coldstorageData.ts`; the import writes the unit before the card enters the list, runs the format step on the archive path (product question answered in `MC-306`), keeps a per-batch two-in-a-row breaker, and passes no run for realm and hub imports that open at once. Fixes the pre-existing index-after-await bug (B1) as a shared cause; proposes a ticket for the missing Node body-limit precheck (B2). |

## Tickets (CHORE-200 to CHORE-219)

None yet.

## Gate verdicts

- **Stub v3 (`MC-302`):** Gate 1 `opus-reviewer` `[APPROVE]` with SHOULD findings adopted into plan v2 (row 2006). Gate 2 pending.
- **Release item, the `dist` check (`MC-301`):** small and low-risk, no plan gate (the carve-out); Gate 2 `adversarial-reviewer` `[APPROVE]` (row 2004). No application code changed, so no `pnpm test` or `pnpm check` run for it; the script was run against a normal and a measurement build (rows 2003, 2004).

## Full checks

None yet.

## Owed device and Tauri checks

None yet.
