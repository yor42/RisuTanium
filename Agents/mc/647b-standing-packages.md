### MC-3786 — #647 follow-up: the Note 9 census packages are allow-listed as standing, 2026-11-23

- Tag: decisions (maintainer via AskUserQuestion, "Allow-list them"). Date: 2026-11-23. Exact times: UNKNOWN. Related: `#647`, `MC-3773`, `MC-3774`, `MC-3782`.

**What the maintainer chose.** The packages the first phone census found beyond the two RisuTanium apps (21 stock and installed apps) join `devicePool.standingPackages`, so a census no longer stops on them. `dev.risu.dv603` stays off the list: it is a test helper the #603 rerun still needs and the helper rule removes it.

**Consequence.** A later holder keeps those packages without a ruling. The second phone census is added in a follow-up PR under the same issue once that phone is free.

**Keep-helper entry (lane A request, #514 finding).** `lease-reset-done` refuses `--stranded` for any helper-pattern name, so `dev.risu.dv603` cannot be marked. Policy gains `devicePool.keepHelpers` (helper-pattern package plus a note); the grant carries it and the census rule says keep and report it, never remove or mark it, and count the end census clean with it present. The entry is temporary: drop it once #603 is accepted.
