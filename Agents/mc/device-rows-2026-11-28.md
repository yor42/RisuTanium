### MC-4650 — Second Note 9 device run of 2026-11-28 follows the maintainer's ordered row list; #768 and #688 skipped, #252 and #861 not run, 2026-11-28

- Tag: records (orchestrator, from the maintainer's session brief; no new maintainer choice). Date: 2026-11-28. Exact times: UNKNOWN. Related: `MC-1666`, `MC-3874`, `Agents/Findings-2026-11-28-device-rows-note9.md`.

**What was ordered.** Rows #301, #479, #721, #751, #834, #681, #591, #616/#811, #598, #221, #816 N1..N7, #686, #613, then the #224 stage 4 measurement and the #150 save-cost measurement, on a release APK of origin/main `2f14903fa3c7d0d1dacbbf47090b7124672d2d59`. #768 and #688 were skipped as ordered. #252 (persona builder) and #861 (code-block long press) were conditional on their PRs having merged; neither had, so nothing ran for them.

**Why it matters.** The findings file lists every row as ran, partial, UNVERIFIED or NOT RUN with the reason; acceptance stays with lane A and the owning sessions.

### MC-4651 — Phone 2 signer mismatch handled by uninstall and install, 2026-11-28

- Tag: records (orchestrator, applying a standing rule). Date: 2026-11-28. Exact times: UNKNOWN. Related: `MC-3874`.

**What happened.** The first install of the signed release APK on phone 2 (`2ac80128013f7ece`) reported a signature mismatch (`install-2ac8-attempt1-signature-mismatch.json`). Under MC-3874 the install used `sign-install.ps1 -AllowClear`, which clears the app data of the playground phone and installs with the persistent test key (sha256 `69c387cd7c3fbc161f5551228da6049d91ef044e347c972e1a84a38b69a29aaf`). The previous signer was not recorded. Phone 1 installed cleanly.

### MC-4652 — Device-run rows left owed after this run, 2026-11-28

- Tag: records (orchestrator). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#301`, `#816`, `#686`, `#613`, `#834`, `#221`, `#681`, `#224`.

**What stays owed (observations the runners could not make).**
- #301: Update all / Undo all and the rows named "S1" and "G4" (both undefined in the issue text).
- #816: N3, N4, N5, the N6 export half and L4 (the Android save and open pickers have no allowed route in the brief); 3072-dim vectors.
- #686: archived-member state (c); the This chat and More entries for a group (a group opens the classic chat screen on this build).
- #613: the background import (needs a small character-card fixture).
- #834: description visible on an archived card (`mock.bin` and `c301.bin` creator notes are empty; home500's was not read).
- #221: thumbnail fill-in (no image-bearing fixture).
- #681: the refusal notice for a `.bmp` or `.jpg`, and the boot sweep removing the files of a refused import (not visible in the UI).
- #224: the Note 9 base-content index timing.

### MC-4653 — #224 stage 4: the Note 9 index timing is NOT RUN; the PC counts and times are recorded, 2026-11-28

- Tag: records (orchestrator). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#224`, `PR #116`, `Agents/Tools/device/README.md`.

**What was done.** No file or doc named "D2 harness" exists; the PR #116 reproducers (`ST1`/`ST2`, `IT1`) were taken as the harness and run through a scratch copy that prints counts. Whole and streamed re-imports of `library(80)`, `c301.bin` and `mock.bin` wrote identical fresh-key sets, with 0 duplicates on `library(80)` and `mock.bin` and 2 under the ST1 definition on the c301 re-import (identical in both arms; the 2 moduleBucket there exceed the at-most-one the reproducers allow). The streamed-parent limitation was unreproduced, not refuted. The base-content index build on the PC took a median of 312.1 ms (4,934 units), 44.9 ms (94 units) and 441.5 ms (4,769 units).

**Why the phone timing is not recorded.** A plain release APK cannot expose it; only a `MEASURE` build can. That would be a second APK build (android-build lease, phone leases released first) and a third lease cycle. The orchestrator did not start it without the maintainer's choice; lane A decides.
