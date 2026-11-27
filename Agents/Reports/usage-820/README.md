# #820 frozen-input before/after run and usage and coverage-gap export

Aggregates only. The frozen transcript copies and both manifests stay in private scratch (manifest digests below); no raw transcript, session id or local path is in Git.

## Inputs and configuration

- Input: 77 top-level main-session transcripts from the `C--Projects-RisuAI*` project folders whose file modified time falls in 2026-11-22..24 UTC. Subagent transcripts are not in the set. The maintainer chose this scope (AskUserQuestion, "Census window, main files"); the files were byte-copied once, then only the copies were hashed and read. The census `usage-full\work` folder holds no transcript copies, so the 81-session / 1,109-agent-transcript census is not reproduced here.
- Window: `[2026-11-22T00:00:00Z, 2026-11-25T00:00:00Z)`. Parser `mainloop` 1.0.0.
- Commands (from this branch): `node Agents/Tools/usage/mainloop.mjs capture --root FROZEN --since 2026-11-22T00:00:00Z --until 2026-11-25T00:00:00Z --attribution {union|legacy-first-block} --out MANIFEST FILES...`, then `analyze --manifest MANIFEST --root FROZEN --out RESULT --envelope ENV`, then `node Agents/Tools/usage/gaps.mjs --result RESULT --out GAPS`.
- Manifest digests: union `ccc29f10781204a838b9362a7a82418e2de8b9ea19014e6d45ac359706476c05` (see each result's `manifestDigest`). Result SHA-256: union `23f05a24...`, legacy `ba8f3ce9...` (full values in the envelopes, kept in scratch).

## Before / after (legacy-first-block vs union), same frozen bytes

| Quantity | legacy-first-block | union |
|---|---|---|
| Calls | 12,503 | 12,503 |
| Tokens (in / cache write / cache read / out) | 28,952 / 33,564,620 / 2,994,603,410 / 7,255,454 | identical |
| Assumed-list-price weighted cost (USD) | 1,431.173253 | 1,431.173253 |
| Tool calls attributed | 4,146 | 13,297 |
| Turns | 1,045 | 1,045 |

Calls, tokens and cost are unchanged, as the correction requires; only the tool count moves, because tools in usage-free or repeated-usage blocks of a message tuple are no longer lost. The trigger-class tool counts (legacy -> union): cross-session 2,015 -> 6,583; task-notification 1,104 -> 3,141; maintainer 917 -> 3,128; compact-summary 110 -> 445. Zero-tool turns (call-count label only, not proof of an acknowledgement): cross-session 173 -> 55; task-notification 40 -> 24; maintainer 7 -> 4.

Cost is the report's assumed list-price weighting (Opus 5/25, Sonnet 2/10, Haiku 1/5 per million tokens; cache write 1.25x, read 0.1x), not an invoice and not quota. No saving is claimed.

Diagnostics on the union run: 22,894 repeated identical usage blocks, 10 synthetic messages skipped, 10 turns that start before `since`, 1 boundary-straddling tuple, 1 message with a missing id, 0 usage-conflicts, 0 cross-transcript collisions, 0 tool tuples without usage.

## Coverage-gap export (`gaps-*.json`)

`Agents/Tools/usage/gap-registry.json` names the known gaps with the source of each claim: Codex and Antigravity dispatches (no usage block), native dispatches the tool did not report, subagent transcripts outside the frozen set, and missing accepted-result ids. Every gap has `costUsd: null`; nothing is estimated, and Codex pricing stays unverified. The export adds the measured totals and the coverage diagnostics from the frozen run.

## Limits

- Main-session files only: subagent transcripts, and so their calls and cost, are outside both runs. Totals are therefore not comparable with the 61,149-call census.
- File selection used modified time, not event time; the window then filters events.
- Preparation and measurement cost of this run is not recorded: the session's own usage is not available to it.
- The registry's Antigravity entry cites the maintainer brief, because no repository record states it.
