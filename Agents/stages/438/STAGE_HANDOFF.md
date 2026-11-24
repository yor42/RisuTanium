# #438 stage handoff: W1 docs done (wrap-up stage 1 of 4)

Branch `claude/438-w1-docs`, PR "Refs #438" (the issue stays open; only W5 closes it). Docs and one help string; no validator or markup change. The previous stages are merged: S3c-B popups (PR 743), Home (PR 748).

## Why this wrap-up exists
The maintainer chose "audit first, then ask" (MC-4148). The W0 audit (and W0b) found gaps against the acceptance sentence of #438; the maintainer answered them (MC-4149, MC-4160..4164, `Agents/mc/438-wrapup.md`):
- Effects (MC-2942) move to ticket #751, which must land before #654's Terran Eclipse, Aqua Halo and Elemental Ivory; #438 closes without them (MC-4149).
- W2: the missing chat-sidebar parts; the sidebar is part of chat, `sidebar.css` stays a skipped sheet, no refusal is built (MC-4161).
- W3: theme parts for the 11 App-level overlays plus six groups found below App level, the code-block menu and SavePopupIcon (MC-4160, MC-4164), sized by an Opus designer into several PRs.
- Acceptance reads "when the new screens are on"; built-in packs stay chat-only until #654; docs now; one closeout Note 9 run, W5, whose PR closes #438 (MC-4162, MC-4163).

## What changed in W1
- `docs/design/THEMING.md`: new section "What a pack covers today" (the five applied areas, held colours, popups overlays, when a pack shows, safe start, installing, author limits, what is planned); stale walls corrected or deleted against `engine.ts`, the install rule rewritten as refused versus notes (`failclosed.ts`, MC-3421), the calibration file name fixed, the stale absolute path replaced.
- `Agents/Theme-Packs.md`: status section 2026-11-24; the blur fallback line says no mechanism exists yet (#751); Motion and Blur columns marked not available yet.
- `docs/wiki/Theme-Packs.md` (new, plain user page) and a link line in `docs/wiki/_Sidebar.md`.
- `src/ts/themePack/goldens/README.md`: one sentence that popups.css and sidebar.css are not part of the frozen goldens (MC-4161).
- `themePackRowHelp` (en.ts and the 7 locales): restyles chat, Studio, Settings and Home and the popups over them; the preview switches; Home needs no switch; colours on chat only.
- Records: `Agents/mc/438-wrapup.md` (MC-4149, MC-4160..4164) and MC-4148 in `Agents/mc/438-home.md`.

## Evidence
- Docs written by a Sonnet doc-writer from the W0 audit (`%TEMP%/risu-b715/438/w0/`) and checked by a fresh doc-verifier (`%TEMP%/risu-b715/438/w1/verify.md`): the new section, the wiki page, the status section and `themePackRowHelp` were CONFIRMED against source; the verifier's amendments to THEMING.md (walls, contract list, file name) were applied in a second round, and the orchestrator re-read the engine lines it cites (engine.ts:468, 470, 562-564).
- Not re-verified by a second reader: the round-2 text itself, and the line-endings of the locale files (translator reports CRLF kept). Locale parity and the ThemePackRow tests: 57 passed (translator's run).
- Two claims of the writing brief were wrong and the docs state source instead: the `:root` core-token rule governs the default scheme colours only; the em refusal applies only to size tokens with a floor or ceiling.

## Open for the next stages / lane A
- W2 (sidebar parts, Tier 1) runs in its own worktree `438-w2-sidebar`; W3 (overlay parts, Tier 2) is being sized by an Opus designer; W5 (closeout run) last.
- Studio hooks stay held. #751 (effects) and the release-switch ticket are outside #438.
- Plans, audits and reports: `%TEMP%/risu-b715/438/` (`w0/`, `w1/`, `w2/`, `w3/`, `wrapup-proposal.md`).
