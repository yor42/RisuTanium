# #438 stage handoff: S3c-B (popups area) done

Branch `claude/438-s3c-b`, PR "Refs #438" (the issue stays open). Tier 2, critical contract (safe start and critical names). Plan r1 (Gate 1 [EDITORIAL]) and Gate 2 [EDITORIAL] by fresh opus-reviewers; no blocking finding in either.

## What changed
- `popups` joins `APPLIED_AREAS` (`['chat','studio','settings','popups']`). It is a judged area (`JudgedArea = ThemeArea | 'popups'`), not a reference area: `ThemeArea` and `THEME_AREAS` are unchanged.
- Judge: `POPUPS_REGISTRY` over the S3c-A census; Rule SCOPE admits popups parts and refuses every custom property in popups.css (MC-3007).
- Intake: `noArea` reads the screen areas only (`SCREEN_AREAS`), so a pack with only popups.css is still refused (MC-3123).
- Apply: two overlay `<style data-theme-pack="popups">` elements (colour, shape), created off after the screen elements, removed with them. The surface gate turns one on from the shown screen's own element: none when that screen applies nothing, colour over a colour-ready screen, shape otherwise. Popups never switch own colours on (MC-3660).
- Install notices: popups is never "shown" on its own; "held" only when there is no chat sheet and its strip differs.
- Copy: `themePackSkippedAreas` names popups in en.ts and the 7 locales.
- Not built (MC-3659, MC-3638, MC-3639, MC-3660): toast containment, protected data notices, toast image ban, popups own-colour trigger, clash note (MC-4141).

## Decisions and records
`Agents/mc/438-s3cb.md` (MC-4140..4142) and `Agents/mc/438.md` (MC-3654..3660, copied unchanged from the earlier worktree).

## Tests and evidence
- Own run on the combined tree: `pnpm check` 0 errors; `pnpm vitest run src/ts/themePack src/lib/Setting/Pages/Display src/lang` 104 files, 4797 tests passed.
- Reproducers I-1..I-4, I4 and T1-36 fail on the base (assertions); the other new tests are acceptance or guards, labelled in the files. Seven popupsJudge rows are guards that also pass on the base (SC-2 'anywhere else', SC-3 '--pack helper', four J-2 refusal rows, P-1 'reference area list unchanged'); P-1's shape-mode row fails on an assertion there, its registry row on a TypeError. The surfaceGate overlay tests fail on the base with a TypeError (new symbols). I-2 pins refusal, not the reason (SC-1 pins the membership reason). A-3b guards a dropped or refused popups#shape verdict.
- Mutants M1-M14 killed (coder reports), 10 re-run by the Gate 2 reviewer by in-memory substitution.
- Process note (Gate 2 F-6): the coders ran base runs and mutants by swapping repository files in place and restoring them; the tree was checked hash-identical afterwards. Future briefs should name an in-memory transform harness.

## Known limitations (MC-3638, no guard)
- popups.css may set `color-scheme` (light or dark) on `:root` or `html`; the colour overlay carries it (MC-4142).
- Popup colours over a light-based chat are not checked against that base.
- A popups value reading an app token is judged against the app's own value; a screen sheet may set it differently within its bounds.
- A popups.css holding only `@font-face` mints its font and shows nothing.
- popups.css can restyle reach and safe parts inside an own-scheme save-guard dialog (MC-3638, MC-3639, no guard).

## Open for the next stage / lane A
- Device rows (Note 9, synthetic, lease; plan section "Note 9 device rows" DV-0..DV-6, including the control row "a plain launch applies the pack") are NOT run. Lane B owns the lease.
- The plan notes S3c-B stays blocked on #629's gating device rows being PASS or waived (`Agents/stages/629/STAGE_HANDOFF.md`); lane A should confirm before merge.
- Next stage: the Home sheet (a `home` registry exists; the area is not applied). It touches no Studio forms. The wrap-up scope is still to be confirmed with the maintainer. Hold any stage adding hooks to Studio screens until lane A says the Studio forms merged. Start only after the maintainer is asked (MC-3621, MC-3622).
- Plan, reviews and reports: `%TEMP%\risu-b715\438\s3cb2\` (plan-r1.md, g1-r1.md, g2-r1.md, code1/2-report.md).
