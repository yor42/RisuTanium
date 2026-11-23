### MC-3788 — #664: a lease holder may replace a signer-mismatched RisuTanium on a Note 9, 2026-11-23

- Tag: decisions (maintainer via AskUserQuestion, "Yes, both Note 9s", relayed by lane A as MC-3874). Date: 2026-11-23. Exact times: UNKNOWN. Related: `#664`, `#514`, `MC-3874`, `MC-3773`.

**What the maintainer chose.** On either Note 9, a lease holder whose APK signer does not match the installed `io.github.yor42.risutanium` may uninstall it and install its own build, with synthetic data only, logging the old and new signer. The Fold 7 and the Tab S9 are unchanged. Cause: #514 hit `INSTALL_FAILED_UPDATE_INCOMPATIBLE` on phone 1, whose installed app matches neither the debug key nor the shared test key.

**Consequence.** The brief template and the live-checks checklist carry the rule. The `adbg` guard needed no change: `uninstall io.github.yor42.risutanium` already passes on the Note 9 serials (tests NP-A2 and T20-A) and stays refused elsewhere.
