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

## Ledger rows (2001 to 2099)

| Row | Date | Dispatch / question | Role | Usage | Gate | Outcome |
|---|---|---|---|---|---|---|
| 2001 | 2026-10-12 | Size stub v3 (tags and creator in the stub): builders, readers, the version bump, upstream reader, bounds, put-back, tests | `investigator` | 109,082 subagent tokens, 47 tool uses, 140,319 ms | n/a (sizing) | Packet, source reading only, on `f45ac41`. The only stub builders are `buildColdStub` and `enrichLegacyStub`, called from the boot archive pass; search is the only reader of tags and creator; a bare bump drops `coldStubChatCount` to 1 on v2 stubs; upstream compatibility from Reports 49 and 51 (read, not executed). Suspected pre-existing defect: search reads the top-level `creator` while the UI edits `additionalData.creator` (decided in `MC-302` 1). Questions answered in `MC-302`. |
| 2002 | 2026-10-12 | Size card import straight to the archive | `investigator` | 117,202 subagent tokens, 33 tool uses, 132,056 ms | n/a (sizing) | Packet, source reading only, on `f45ac41`. No reusable "archive one character now" function (the only unit writer that makes a stub is the boot pass); import never calls `characterFormatUpdate`, so an import archived without it would be dirty on first open (`MC-273`); only the realm and hub paths select the new character, and only with `goCharacterOnImport` or a forced redirect; plugins cannot add a character. Questions answered in `MC-303`. |
| 2003 | 2026-10-12 | Implement the `dist` check (`util/checkReleaseDist.mjs`, `pnpm check:dist`, the CI step) | `sonnet-coder` | 26,472 subagent tokens, 4 tool uses, 110,236 ms | Gate 2 in row 2004 | Executed: normal `pnpm build` then `pnpm check:dist` exit 0 (203 files); a `VITE_RISU_MEASURE=1` build into `/tmp` exit 1 with all three markers in one chunk; a missing directory exit 2. `.map` files are not scanned (they embed original source). |
| 2004 | 2026-10-12 | Gate 2, the `dist` check | `adversarial-reviewer` | 24,075 subagent tokens, 7 tool uses, 115,061 ms | Gate 2 | `[APPROVE]`, no substantive finding. Re-ran: normal build exit 0 (203 files, equal to the count of .js/.mjs/.cjs/.html/.css files in `dist`); a measurement build exit 1 with all three markers; a missing directory and a directory of dangling symlinks exit 2. Fact recorded: `pnpm build` is `vite build --sourcemap`, so a normal build ships 164 `.map` files, and `dist/assets/database.svelte-*.js.map` contains `__risuPutBackMeasure` and `risu-measure` in its `sourcesContent`; a literal `grep -r dist` therefore fails on a normal build, and the script deliberately scans only shipped code. Whether to ship source maps is a separate question, not raised. Optional: symlinks are skipped (Vite emits none). |
| 2005 | 2026-10-12 | Pin upstream's reader shape for an archived character, upstream's `.bin` import, and this fork's `.bin` export | `investigator` | 59,573 subagent tokens, 23 tool uses, 93,285 ms | Gate 1 input (stub v3) | Upstream `kwaroran/RisuAI` main at `979dbc9d5fd913abd6996eaec64e0f83be53964d` (`git ls-remote`), read in a scratch clone; source tracing only, nothing run. Upstream detects a stub by a truthy `coldstorage`, restores in `changeChar` by replacing the slot wholesale with the unit's `character` when its `chaId` equals the stub's, lists a stub from `name`, `image`, `chats.length` and `creatorNotes` only, never validates stubs on `.bin` import, has no `coldVersion` or `coldChatCount`, and declares top-level `tags` and `creator` on every character (its own defaults fill them on stubs too). This fork's export writes stubs as stubs plus `coldstorage_<key>.json` units. Conclusion: a v3 stub is read by upstream exactly as a v2 stub. |

## Tickets (CHORE-200 to CHORE-219)

None yet.

## Gate verdicts

- **Release item, the `dist` check (`MC-301`):** small and low-risk, no plan gate (the carve-out); Gate 2 `adversarial-reviewer` `[APPROVE]` (row 2004). No application code changed, so no `pnpm test` or `pnpm check` run for it; the script was run against a normal and a measurement build (rows 2003, 2004).

## Full checks

None yet.

## Owed device and Tauri checks

None yet.
