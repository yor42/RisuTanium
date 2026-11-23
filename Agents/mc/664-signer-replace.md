### MC-3788 — #664: a lease holder may replace a signer-mismatched RisuTanium on a Note 9, 2026-11-23

- Tag: decisions (maintainer via AskUserQuestion, "Yes, both Note 9s", relayed by lane A as MC-3874). Date: 2026-11-23. Exact times: UNKNOWN. Related: `#664`, `#514`, `MC-3874`, `MC-3773`.

**What the maintainer chose.** On either Note 9, a lease holder whose APK signer does not match the installed `io.github.yor42.risutanium` may uninstall it and install its own build, with synthetic data only, logging the old and new signer. The Fold 7 and the Tab S9 are unchanged. Cause: #514 hit `INSTALL_FAILED_UPDATE_INCOMPATIBLE` on phone 1, whose installed app matches neither the debug key nor the shared test key.

**Consequence.** The brief template and the live-checks checklist carry the rule. The `adbg` guard needed no change: `uninstall io.github.yor42.risutanium` already passes on the Note 9 serials (tests NP-A2 and T20-A) and stays refused elsewhere.

### MC-3789 — #664: vendor and OneUI preinstalls found by a Note 9 census are never a maintainer question, 2026-11-23

- Tag: decisions (maintainer standing rule, relayed by lane A as MC-3875). Date: 2026-11-23. Exact times: UNKNOWN. Related: `#664`, `#660`, `MC-3875`, `MC-3787`.

**What the maintainer chose.** Vendor and OneUI preinstalls (Samsung, Google, Naver/Daum, Microsoft and similar) that a Note 9 census finds are safe to ignore. The lease holder marks them with `lease-reset-done --stranded` and continues, without asking. Project packages (`io.github.yor42.*`, `dev.risu.*`) keep their current rules. Every holder had been asking about the same 15 apps.

**Consequence.** BRIEF-TEMPLATE section 8 step 2 and the live-checks census paragraph carry the rule. The controller still refuses `--stranded` for helper-pattern and standing names.
