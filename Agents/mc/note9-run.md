# Note 9 device rows, second run (2026-11-28)

Block MC-4654..4659 (lane A). Lane A folds these into Maintainer-Context. Findings: `Agents/Findings-2026-11-28-note9-run.md`.

### MC-4654 — Second Note 9 run queued behind the first and covered only the rows #880 did not, 2026-11-28

- Tag: process. Date: 2026-11-28. Exact times: UNKNOWN. Related: `#880`, `MC-3874`.

**What the maintainer chose.** On finding the first orchestrator still holding both phones, the maintainer chose to queue behind it and run only the remaining rows (#252, #861, #686/#613 single-character routes, #819, #224 index timing, #816 N3/N4/N5/N6 export/L4, #826). Lane A then ordered the rest of the work: skip anything #880 holds, send one PR message, do not fix #882, #883 or #884.

**Consequence.** #150 save cost stays with D3 in #880; #827 was not run (needs a code change).

### MC-4655 — The picker is driven by screenshot-coordinate taps for both sides, 2026-11-28

- Tag: decision applied (maintainer ruling 2026-11-27, via lane A). Date: 2026-11-28. Exact times: UNKNOWN. Related: `MC-3874`.

**What was done.** Imports and exports used the system picker with a screenshot viewed before each tap, `adb push` for the open side, no PICK-LOCK bypass, no real keys, no Tauri `invoke` patch. Each runner reports opening the frame before the tap.

**Consequence.** Picker oddities observed (stale DocumentsUI rows after exact-name removal, a duplicate-name save landing as `name.rtb (1)`, a blank frame after one deliberate Back) are recorded as observations, not defects.

### MC-4656 — Three defects were filed and left unfixed, 2026-11-28

- Tag: defect filing. Date: 2026-11-28. Exact times: UNKNOWN. Related: `#882`, `#883`, `#884`, `#438`, `#861`, `#819`.

**What was filed.** #882 long messages render as overlapping text layers; #883 a real long press on prose opens native selection, not the message sheet (behavior before #866 unchecked); #884 the Advanced custom-model editor shows the connection key in clear text. Lane A ordered no fixes in this session.

**Consequence.** The ownership of each fix and whether #883/#884 are intended or inherited upstream behavior is the maintainer's.

### MC-4657 — #826 plugin load share of Home boot is a distribution, not one number, 2026-11-28

- Tag: measurement. Date: 2026-11-28. Exact times: UNKNOWN. Related: `#826`, `#827`, `#508`.

**What was observed.** Note 9, release build, two V3 plugins: ready time with plugins on is bimodal (about 2.8-5 s or 9-16 s) and plugins off never exceeded 3.4 s; `am start -W` TotalTime is unchanged (about 275-283 ms). A-minus-B differences of medians were +0.38 s, +6.33 s and +4.16 s pooled. Cause not established, order effects not separated, no per-plugin timing. The #508 12 ms figure (no plugins) is not reproduced by this run. #827 not run.

**Consequence.** A single-number claim for plugin cost on a Note 9 needs more runs, a randomized arm order or an instrumented build; that is a new run, not a re-read of this one.

### MC-4658 — #224 stage 4 index time on the phone, 2026-11-28

- Tag: measurement. Date: 2026-11-28. Exact times: UNKNOWN. Related: `#224`.

**What was observed.** MEASURE release build, streamed path only: base-content index 284 ms median (n=3) for 94 units / 4.2 MB and 4,598 ms (n=1) for 4,769 units / 62.3 MB on a home500 re-import; stream-prepared units drop to 25 and 55 on re-import. Index time includes production `yieldToMain`, so it is a phone figure.

**Consequence.** No whole-path run, one home500 sample, commit and reload time not captured; PC numbers are in #880.

### MC-4659 — Incidents and deviations of the run, 2026-11-28

- Tag: incident record. Date: 2026-11-28. Exact times: UNKNOWN. Related: `#819`, `#224`.

**What happened.** G3's prep script sent stray taps over the restore overlay during one import (screenshot showed only the progress sheet, import completed, no effect judged, not provable). H1 ran in Node-server dev mode on port 6413 with a scratch DNS preload and printed a throwaway synthetic key in its own output. G2's restored backup changed the UI language to English. G1 left synthetic personas on the profile. The lease renewer hit a 30-minute job limit once and was renewed by hand before expiry. The lease ended through the helper (`released`, `needsReset: false`).

**Consequence.** No real data, key or other app was touched; nothing was hand-edited.
