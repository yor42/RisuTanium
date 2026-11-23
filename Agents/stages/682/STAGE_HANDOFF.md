# #682 stage handoff: spec (Studio S4 preset advanced form)

- Stage: spec only (MC-3902). File: `docs/design/studio/PRESET_ADVANCED_SPEC.md`, revision 3. The build lands as staged PRs S4a..S4d on #682 (MC-3975); only S4d closes the ticket.
- Decisions: `Agents/mc/682.md`, MC-3970..3979 and MC-4030..4047. MC-4030 (Studio must be feature complete compared with classic) applies to every Studio form; MC-4043 is its explicit exception for app-wide settings.
- Gate 1: the designer was Opus. Round 1 (opus-reviewer) returned [REJECT] with S1..S4 and E1..E9; revision 3 fixed them. Round 2 (a fresh opus-reviewer) returned [EDITORIAL], so the plan passed.
- Leftovers to apply in the S4a build brief (accepted in round 2 as editorial, no re-review needed):
  - E-r2-1: name the mechanism that reveals a collapsed section for history focus. For example, a field-reveal hook the preset form registers, like `registerGreetingReveal`, called when `elementFor` misses. Say whether that expansion persists the collapse state (DD-099).
  - E-r2-2: the S4a-T19 fixture needs `jsonSchemaEnabled: true`. The anchor for `edit/ownerTargets.ts` is `:21-40`.
- Follow-ups filed: #706 (provider-specific blocks, MC-4041), #707 (prompt template item list, MC-3971), #710 (preset list management, MC-4044).
- MC IDs: MC-4048..4049 are still unused, held for the rest of #682.
- Scratch artifacts for the gate reports and briefs: `%TEMP%\risu-b715\b61\c682\` (sizing.md, gate1.md, gate1-r2.md).
