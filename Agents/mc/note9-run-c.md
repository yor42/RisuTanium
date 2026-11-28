### MC-4870 — Note 9 run 2026-11-28c: build, install and PC rows, 2026-11-28

- Tag: run record. Date: 2026-11-28. Exact times: UNKNOWN. Related: `#883`, `#882`, `#886`, `#685`, `#822`, `#654`, `#892`, `#891`.

**Build and install.** Release APK built from origin/main `aae85b520` in a detached scratch worktree (`node_modules` junction, only the gitignored generated Android files copied in). Unsigned APK SHA-256 `565CAC025577A42ACE5A4596026386EAFA7C3DA5869A281B9D4642D56B239D3D`. `git status` showed `AndroidManifest.xml` and `gradlew` modified by the build; `git diff --ignore-cr-at-eol` was empty, so line endings only. Re-signed with the persistent test key (certificate SHA-256 `69c387cd...29aaf`) and installed on Note 9 phone 1 (`29f3cde9193f7ece`) through `sign-install.ps1`; the install step verified `debuggable=False`. Wi-Fi read `wifi_enabled=off associated=no validated=no` at the end of the run. An earlier build from `d8f812901` (SHA `5A186D04...B626`) was superseded after lane A reported that #907, #909, #910, #911 and #912 had merged.

**PC rows observed** (production `dist` of that APK build, Node server, guarded Chrome with the host block read back): see `Agents/Findings-2026-11-28-note9-run-c.md`.

**Not run.** Every Note 9 row. See MC-4871.

### MC-4871 — Note 9 rows handed back unrun, 2026-11-28

- Tag: handoff. Date: 2026-11-28. Exact times: UNKNOWN. Related: MC-4870.

The run installed the pinned APK on phone 1 and released the phone clean (end census equal to the start baseline); no Note 9 row ran. The rows and their prerequisites are listed in the findings file. A device session needs a regenerated synthetic library (the generator in `Agents/Tools/save-gen/c806-library.mjs` now wraps the background filler in `<div hidden>`), pushed with `fixture-push.ps1`, and the Welcome restore driven by screenshot-coordinate taps in the system chooser.
