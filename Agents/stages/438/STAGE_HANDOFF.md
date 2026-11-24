# #438 stage handoff: Home sheet (home area) done, device rows pending

Branch `claude/438-home`, PR "Refs #438" (the issue stays open; the wrap-up scope is asked of the maintainer after this merges). Tier 2, critical contract (safe start and critical names). Plan r2 (Gate 1 r1 [REJECT] on two test-plan defects, Gate 1 r2 [EDITORIAL]) and Gate 2 [EDITORIAL] by fresh opus-reviewers; no blocking finding in the accepted rounds. The previous stage (S3c-B popups, PR 743) is merged as b159fce09.

## What changed
- `home` joins `APPLIED_AREAS` (now chat, studio, settings, home, popups) and `SCREEN_AREAS`. It stays a reference area as before (`THEME_AREAS` unchanged).
- Rule SCOPE covers home: part membership by the `home-*` / `library-*` prefix rule plus a census (`HOME_PARTS`, `homeParts.test.ts`), home tokens through `allowedTokenNames('home')`.
- `scroll-snap-type` joins the shared `PROP_ALLOW` and the shape-mode classification (maintainer decision MC-4146); nothing else. Settings still refuses it through its own engine allowlist, pinned by a test.
- Apply: a shape-only home element (not colour-ready, MC-3121); Home never triggers own colours (MC-3660, MC-3642). Popups over Home take the shape overlay.
- Surface gate: gate area `home` below chat (`settings > studio > chat > home`), declared by `HomeShell` (`declareSurface('home')`, the only component edit; no Studio file touched).
- Copy: `themePackSkippedAreas` and `themePackRefuseNoArea` name Home (en.ts and the 7 locales); goldens README sentences.
- Corpus golden regenerated; the evidence is the CG-D diagnostic (81 home-column rows change, all accepted to refused by Rule SCOPE reasons, none refused to accepted, a non-home column changes only on an input containing `scroll-snap-type`, and there is none that changes).

## Consequences accepted by the orchestrator (follow from home being a scoped screen area)
- Home font families must start with `pack-`; home refuses `column-count` and `-moz-*` aliases like the other areas.
- A home.css carrying colours appears in the held-colours install notice (home is shape-only).
- `--home-hairline` is left out of the home geometry token list: the consumer scan finds it read in `box-shadow` and `border` shorthands.
- A bundled `@font-face` in home.css follows the shared font path (target check, blob minted and revoked with the element).

## Decisions and records
`Agents/mc/438-home.md`: MC-4144 (Home starts now), MC-4145 (real-picker device row), MC-4146 (scroll-snap-type), plus the device rulings below once recorded.

## Tests and evidence
- Own run on the combined tree before the last label edits: `pnpm check` 0 errors; `pnpm vitest run src/ts/themePack src/lib/Setting/Pages/Display src/lang src/lib/UI/Home`: 141 files, 5351 tests passed. The last coder pass changed only three test files (two test-name labels and the DV438H pin N-H1 (5)); those three files pass (291 tests).
- Reproducers and acceptance tests fail on the base (coder reports code1/code2); mutants M5-M10, M13, M15 and the 11 stage-1 mutants killed by in-memory substitution; Gate 2 spot-checked mutants by a scratch harness.
- Process: the coders ran base evidence and mutants through scratch harnesses and did not swap tracked files in place.
- `src/styles/tests/packBase.svelte.test.ts` could not load in a coder run (missing `@tailwindcss/oxide` in the shared node_modules); it is outside the orchestrator's run (src/styles) and CI is the check for it.

## Known limitations (MC-3638, no guard)
- A pack's scroll-snap-type can pin a scroller that holds snap points from card HTML; same class as overflow.
- popups.css and home.css can restyle reach and safe parts inside an own-scheme save-guard dialog or the Home screen (MC-3638, MC-3639).

## Device rows (Note 9 phone 1, synthetic data, leased through the controller; run by this session)
Debug APK of 4f090bea0, SHA-256 5529FCBC82D3BCD5391E7627F93A566FE58C1D923B2BFD2384D07CF4AC1001D0 (the later commit changes only records). Result file: `%TEMP%/risu-b715/438/home/dv/run1/dv438h-result.md` (claim DV-438H recorded pass, lease released --clean after a clean end census). The phone UI language was Korean.
- DV-P PASS (MC-4145): the pack `dv438h-pick.risutheme` (760 bytes, SHA-256 d1a19a1c...36d6) was pushed to `/sdcard/Download` by exact name, the app's install-from-file control opened `com.android.documentsui/.picker.PickActivity`, `pick --name` + `tap` chose the file shown once in the Downloads root, the picker closed and the app installed the pack ("installed; this version only uses home.css's shape; colours are kept with the pack"). No NotReadableError. So a pack in Downloads is readable through the real picker; the S3c-B read failure was the CDP-injected path, not the picker. The MC-3641 risk warning came after the picker.
- DV-H0 control PASS (home element `all`, greeting letter-spacing 0.08rem, the held colour #7a1f5c not painted, card radius 2px); DV-H1 PASS (chat open: chat `all`, home `not all`); DV-H2 PASS (Settings and Studio: home `not all`); DV-H3 PASS (own scheme: home `all`, no pack base); DV-H4 PASS (Home drawer opens Settings); DV-H5 PASS (pack-free launch via the START_WITHOUT_THEME_PACK intent action as a stand-in for the launcher long-press: 0 `style[data-theme-pack]`, still 0 after choosing None). DV-H6 (example) NOT RUN.
- Caveats: the pack's name shows as "Test Pack" (builder manifest), not "DV438H". The app reopens into the last chat after a plain launch, so Home was reached through the sidebar. The chat-shell and Studio preview toggles were turned on for H1/H2 and off again. Phone 1 was left with the pinned APK, active pack None, colour scheme Default.

## Open for the next stage / lane A
- The wrap-up (built-in packs, THEMING docs, locales, Note 9 rows) needs its scope confirmed with the maintainer after Home merges; #363 and #325 are normal tickets, not part of it.
- `themePackRowHelp` still says the pack restyles "the new chat screen" (stale before this stage; optional copy follow-up).
- Plan, reviews and reports: `%TEMP%/risu-b715/438/home/` (plan-r2.md, g1-r1.md, g1-r2.md, g2-r1.md, code1/2/3-report.md, tl-report.md).
