### MC-3787 — #660: the second Note 9's census packages are allow-listed as standing, 2026-11-23

- Tag: decisions (maintainer via AskUserQuestion, "Allow all 15"). Date: 2026-11-23. Exact times: UNKNOWN. Related: `#660`, `MC-3786`, `MC-3774`.

**What the maintainer chose.** The 15 packages the second phone's census found beyond the first phone's list join `devicePool.standingPackages`, including `io.github.yor42.tbprobe` and Firefox. None matches the helper pattern.

**Consequence.** Both Note 9s now census clean against one list. A later holder keeps these packages without a ruling; the first holder after this runs the census again because both phones are marked `needsReset`.
