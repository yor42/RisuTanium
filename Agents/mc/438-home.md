### MC-4144 — #438 The Home sheet is the next theme-pack stage, started in the same session, 2026-11-24

- Tag: decisions (maintainer, lane A AskUserQuestion, "Start Home sheet now (Recommended)"). Date: 2026-11-24. Exact times: UNKNOWN. Sweep ref: none. Related: `#438`, `MC-3871`, `MC-3621`, `MC-3622`.

**What the maintainer chose.** The Home sheet stage starts now in the #438 session (Sonnet orchestrator, Opus designer, fresh opus-reviewer Gate 1, then implementation and Gate 2), on a new branch cut from `origin/main` after PR 743. One PR "Refs #438" with a stage handoff. The wrap-up scope is asked of the maintainer after Home merges.

### MC-4145 — #438 The Home stage adds a Note 9 row that installs a downloaded pack through the real Android picker, 2026-11-24

- Tag: decisions (maintainer, lane A AskUserQuestion, "Device row in Home stage (Recommended)"). Date: 2026-11-24. Exact times: UNKNOWN. Sweep ref: none. Related: `#438`, `MC-4143`.

**What the maintainer chose.** The Home plan carries a Note 9 row that downloads a synthetic pack to the phone and installs it through the real Android system file picker (DocumentsUI) with guarded taps, with no CDP File injection. It settles whether a pack downloaded to the Downloads folder is readable through the picker, which the S3c-B run could not show (MC-4143).

### MC-4146 — #438 scroll-snap-type joins the allowed properties so the golden Home sheet stays accepted, 2026-11-24

- Tag: decisions (maintainer, #438 session, AskUserQuestion; Home plan r1 OQ-1 after diagnostic D-0). Date: 2026-11-24. Exact times: UNKNOWN. Sweep ref: none. Related: `#438`, `MC-3008`, `MC-3419`, `MC-3871`.

**What the maintainer chose.** Applying Rule SCOPE to Home would refuse the golden banana-cocoa pack, because its home.css sets `scroll-snap-type: none` and `scroll-snap-type` is not on the shared allowed-properties list. D-0 (both golden home.css texts, scratch run on 2026-11-24) found it to be the only such property, and every Home part name in both goldens fits the `home-*` / `library-*` rule. The maintainer chose to add only `scroll-snap-type` to the shared list (it changes how a scroll area snaps and cannot hide, cover, run code or reach the network), so the golden stays accepted whole. Not chosen: refusing the golden, and exempting Home from the list.

### MC-4147 — #438 A pack in Downloads installs through the real Android picker, 2026-11-24

- Tag: evidence (device run DV-P, MC-4145; result file `%TEMP%/risu-b715/438/home/dv/run1/dv438h-result.md`). Date: 2026-11-24. Exact times: UNKNOWN. Sweep ref: none. Related: `#438`, `MC-4143`, `MC-4145`.

**What was observed.** On Note 9 phone 1 (synthetic data, debug APK of 4f090bea0), a pack pushed to `/sdcard/Download` was installed through the app's install-from-file control and the real DocumentsUI picker (`com.android.documentsui/.picker.PickActivity`), chosen by an exact file-name pick and a guarded tap, with no CDP file injection. The app installed it with the held-colours line for home.css and no read error. The S3c-B read failure (MC-4143) came from a CDP-set path, not from the picker. Not covered: a browser download, other file managers, other Android versions or phones.
