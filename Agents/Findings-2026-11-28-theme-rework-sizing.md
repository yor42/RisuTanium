# Theme rework sizing: #654 with #821, #822, #823

Date 2026-11-28. Session: theme-sizing (branch `claude/theme-sizing`, snapshot origin/main `4af04dca0`). Sizing and plan only: no application code. The PR refs #654, #821, #822 and #823 and closes none of them. Decisions are the maintainer's answers of this session, recorded as MC-4650..MC-4658 in `Agents/mc/theme-sizing.md` (the MC block was not named in the brief; lane A to confirm or renumber). Evidence is two read-only investigator reports (mechanism packet, colour-ready packet) whose cited `file:line` facts were read from source on the snapshot above; nothing was executed, and the investigators' size estimates are unverified.

## 1. What the tickets ask, and corrected premises

- **#654** (release-blocker, MC-3871): rebuild the acceptance packs Banana Cocoa, Scratch White, Office Sheet, Origin Navy and Terran Eclipse at full spec (MC-3419), plus gallery packs Aqua Halo and Elemental Ivory. Prerequisites #560, #438 and #452 are closed; #751 (effects) is merged.
- **#821** is the Banana Cocoa styling slice (UI-S7 D2, MC-2503, reference pictures from MC-2516). **#822** is classic chat polish (stage H, MC-2506). **#823** is the remaining restyle stage B2 (MC-2517): chat sidebar, toggle-scope switch, toast host and transcript prose-invert still follow the user's scheme while a pack is on.

Premises the issues imply that source refutes:

1. **Only four of the five acceptance packs exist, and the built-ins are chat-only and asset-free.** `BuiltinPack` holds only `chatCss` (`builtins.ts:9-21`); `prepareBuiltin` judges the chat sheet only, refuses any sheet with resources and returns no blobs (`apply.ts:327-363`). Terran Eclipse, Aqua Halo and Elemental Ivory exist nowhere in `src`, `docs` or `theme-packs/`. Fonts, images and the studio, settings, home and popups sheets can today ride only a downloaded `.risutheme` archive (`theme-packs/`, not imported by `src`, not in the APK).
2. **Colour-ready is not a switch.** `COLOUR_READY_AREAS = {chat}` (`colourReady.ts:5`) is the gate, but Studio (953 scheme-class hits in 70 files), Settings (415 in 39 files, no `src/styles` token file) and Home (67 in 9 files) paint with scheme classes. Studio's `--studio-*` colour tokens are read by no Studio component. Flipping the entry would apply a colour variant nothing reads. The colour-consumption contract the gate cites (H-7) was not found in the repo.
3. **#349 is a device-row tracker, not a colour-ready ticket.** #231 (new screens use theme tokens) is the only open overlap and is unsized. #803 (paper texture, Scratch White and Office Sheet) is open and overlaps the Scratch White pack.
4. **Frozen goldens and one guard bind the rebuild.** Goldens never change (`goldens/README.md`). `builtins.test.ts:28-34` pins the Origin Navy and Banana Cocoa built-in chat sheets to the frozen golden bytes, so rebuilding them needs the same narrowing MC-2540 accepted for the other two packs, and `:43-46` asserts the chat sheet draws no notes, which conflicts with MC-3419 (a validator note on a full-spec pack is a validator defect to fix, not a reason to relax the pack).

## 2. Mechanism (what a full-spec pack can and cannot do today)

Archive format v1 (`intake.ts`): `manifest.json`, up to five judged area sheets (chat, studio, settings, home, popups), `fonts/*` with a manifest licence entry per file, `images/*` (png, jpg, gif, webp, avif; SVG refused), 64 MiB per file, 256 MiB total, warning at 20 MiB. Tokens plus part-scoped CSS only; selectors end in the sheet's own area `[data-part]`. Effects (#751): bounded transitions, transforms, `@keyframes`, blur and backdrop blur on safe parts, with an app-written reduce-motion and reduce-transparency tail. Hard limits that shape the packs: no `z-index` or fixed/sticky position (MC-4243), so ornaments and neon edges must be in-flow `::before`/`::after`, borders, shadows, gradients, mask, clip-path or border-image; colour variants apply on chat only; classic screens and critical surfaces never take pack CSS; new shells show a pack only while their preview switches are on (MC-4162).

Whether the validator refuses anything a full-spec pack needs is **not known**: no draft sheet was judged. Likely friction (unverified): reach parts cannot be hidden or moved, effect values are literal-only, backdrop blur is limited to safe and named reach parts, images only on safe leaves or pseudo-elements. The cheap probe is `judgeAreaSheet(area, css)` over each draft sheet, as `builtins.test.ts:37` does.

## 3. Maintainer decisions taken in this session (recorded in `Agents/mc/theme-sizing.md`)

| ID | Decision |
|---|---|
| MC-4650 | Full-spec packs are bundled with the app as archives: the built-in path is extended to load bundled `.risutheme` archives through the existing archive intake (all five sheets, fonts, images). All seven packs ship in-app; bundled fonts must be free (MC-695 rule 3). |
| MC-4651 | Colour-ready comes first, for all areas (Home, Settings, Studio, then popups), before the pack PRs. Sized after the investigator showed it is the largest part of #654. |
| MC-4652 | Colour-ready means new area role colour tokens (for example `--settings-*`, `--studio-*`) in `src/styles`, defaulting to today's scheme values, that the markup reads; plus a pack base block and contrast pairs per area. Scheme classes do not remain the channel. |
| MC-4653 | Studio and Home get no own-colour recovery island: turning the pack off is the recovery (MC-3420, MC-3421). |
| MC-4654 | Ordering: #823 lands before the first pack PR; #821 is folded into the Banana Cocoa pack PR; #822 runs in parallel and independent; pack PRs are grouped by risk in pairs where the packs are similar. |
| MC-4655 | Bundled packs keep their `builtin:<slug>` ids: the archive is read from the app on each apply and nothing is stored in the database. Updates ship with the app, bundled packs cannot be deleted (the row says they ship with the app), an active builtin id stays valid and the rebuilt pack upgrades silently under the existing install notice. No migration. |
| MC-4656 | The downloadable Scratch White and Office Sheet archives coexist with the bundled packs (the builtin namespace never collides with installed records); the picker lists bundled packs first; the download archives are retired in a follow-up once the bundled ones ship. |
| MC-4657 | Colour-ready timing: each area's markup migration lands with tokens defaulting to scheme values and `COLOUR_READY_AREAS` unchanged, so no user sees a difference. An area joins the set in the same PR as, or after, the first pack that ships a sheet for it (Home has no switch, so this avoids an unreviewed Home change for everyone). |
| MC-4658 | A bundled pack that still fails at runtime (sheet refused, font undecodable) applies the areas that judged ok, shows the skipped areas on its row, falls back to the declared system font without a popup; a build-time test judges every bundled archive so a failure cannot ship. |

Plan assumptions from the grilling step that were not asked and follow the recommended option; the maintainer can overrule them at the dependent stage: (a) a pack's declared `modes` win while it is on (forced tone through the base block, as chat does today); (b) with a preview switch off, a screen uses the user's scheme and the colour-ready markup is invisible, asserted by a test row; (c) the Settings own-colour island keeps working as it does today; (d) every bundled sheet declares a fallback font stack, and a missing one is a validator note (MC-3421), not a refusal.

## 4. Subsystems and the smallest coherent boundary

Delivery and engine: `src/ts/themePack/{builtins,apply,activePack,colourReady,surfaceGate,packSize}`, bundled archive location, install notice and `themePackInstallFlow` tests (held-colour lists are hard-coded in tests). Colour-ready: `src/styles/*-tokens.css`, `src/styles/*-pack-base.css`, area registries (`registries/*.ts`), `sharedTokenConsumers.ts`, `engine.ts` surfaces and pairs, the per-area `*CriticalClosure` and `escapeWalk.*` tests. Markup: `src/lib/{Studio,SettingsShell,UI/Home,Nexus,Others,ChatShell}`. Packs: per-pack sheets and assets, manifest, fonts, textures.

## 5. Stages and dependency order

Each row is one PR unless noted; "Tier" is the MC-2746 size tier proposed, "Gate" the proposed review. Estimates are the investigator's and unverified.

| Stage | Content | Tier / Gate | Depends on |
|---|---|---|---|
| **V** | Validator probe: judge draft sheets per pack, list refusals and notes, fix each validator defect in its own small PR (MC-3419). Drafts stay outside the tree. | 1, native review; opus-reviewer for any validator-contract fix | none; runs early, again before each pack PR |
| **D** | Delivery: extend the built-in path to bundled archives (multi-area, blobs, fonts, images), decide where bundled archives and their size/SHA pins live, narrow `builtins.test.ts` for rebuilt packs, resolve the no-notes guard. Install notice, THEMING.md and wiki rows. | 2, Gate 1 plan review, opus-reviewer (apply path, blob lifecycle) | none; serialise with C0 on `apply.ts` |
| **C0** | Shared colour-ready stage: write the colour-consumption contract (H-7), generalise `apply.ts` so a ready area yields a colour text and base (`judgeVariants` is chat-centric), per-area base-block mechanism, settings tokens into `src/styles` (#235 slice). `COLOUR_READY_AREAS` stays `{chat}`. | 2, Gate 1, opus-reviewer | none; serialise with D |
| **A823** | #823: sidebar, toggle-scope switch, toast host, prose-invert onto chat tokens (`ToggleScopeSwitch.svelte`, `ShellMessage.svelte`, sidebar files, toast host component not yet located). | 1 or 2, native; regenerate `areaParts` constants | none |
| **H** | Home colour-ready (1 to 2 PRs): markup migration to role tokens with defaults equal to today's scheme; joins `COLOUR_READY_AREAS` per MC-4657. | 2, opus-reviewer (gate set, escape walk) | C0 |
| **S** | Settings colour-ready (2 to 3 PRs); highest escape-route risk, own-colour island interaction. | 2, opus-reviewer | C0 |
| **U** | Studio colour-ready (3 to 4 PRs): the largest migration, critical closure for `StudioRiskyConfirm` and `StudioRestoreSheet`. | 2, opus-reviewer | C0 |
| **P** | Popups colour over each ready screen: widen the overlay rule (`apply.ts:477`, `surfaceGate`), move palette classes in `Others` and `UI` popups to tokens (2 PRs, #231 slice). | 2, opus-reviewer | each area it covers |
| **K1..K5** | Packs, after D and the areas they recolour: K1 Origin Navy + Office Sheet; K2 Banana Cocoa (folds #821, reference pictures); K3 Scratch White (Nanum Pen Script 3.2 MB, texture, #803 overlap); K4 Terran Eclipse (new; blur, Note 9 performance row); K5 Aqua Halo + Elemental Ivory (new; fonts, licence checks, ornaments). | 1 each, native gates; critical contracts only if a pack needs engine change | D, C0, areas, V |
| **#822** | Classic chat polish: mobile header, pinned composer, focus order and skip link, empty state, red regenerate, tap targets, initials. App code on classic chat only, new `en.ts` keys with 7 locales and `localeParity`. | 2, native; device rows (TalkBack focus order, mobile header) | none |

Total: about 12 to 16 PRs besides the packs (estimate), 5 pack PRs, 1 for #822. Parallelism: V, D/C0 (serialised), A823 and #822 are disjoint and can start at once; H, S and U run in parallel after C0 but share `colourReady.ts`, its test, `apply.ts`, `sharedTokenConsumers.ts`, `THEMING.md` and the install-flow tests, so those small files are rebased in turn. No open PR or worktree changes the theme or chat-shell paths today (investigator check, 2026-11-28).

Sequencing consequences (from the grilling step): K1 recolours Home, Settings and Studio, so it waits for H, S and U in full and the first pack PR comes after most colour-ready PRs; under MC-4657 the area PRs are invisible to users until the first pack ships. Stage D must say whether the chat-only `BuiltinPack` shape stays beside the bundled-archive shape or is replaced (`builtins.test.ts` pins exact ids, golden equality and the chat-only key list). Stages C0 and P both touch the overlay rule at `apply.ts:477`; assign it to one of them. The frozen goldens `origin-navy.risutheme` and `banana-cocoa.risutheme` are already five-area archives and must not be edited: pack PRs add new archives. Colour-ready counts are lower bounds (heuristic regexes miss dynamic classes). Verify #803 and the toast host component before K3 and A823.

## 6. Verification each stage needs

- Engine and colour-ready stages: the `colourReady.test.ts` row, `apply`/`applyEffects`/`surfaceGate` tests for the colour variant and base, the per-area `*CriticalClosure` and `escapeWalk.<area>` tests, `sharedTokenConsumers` recompute, `cascadeRules`, `hostilePacks`, `corpusGolden` (frozen goldens stay frozen), `appImportantPaint` (no `!important` colours in app source), safe start and escape route legible with the colour variant on, `pnpm check`, targeted tests and mutants for gate changes, independent Gate 2.
- Pack stages: `judgeAreaSheet` ok with notes recorded for every sheet, install-from-file through intake on the real archive, size and SHA pin tests as for `theme-packs/`, tile colours, licence evidence per font and asset (MC-695 rules 2 and 8, MC-1355), screenshots at 360 and 1280, PC rows first, Note 9 rows for blur, fonts and reduced-effects, one safe-start check per new colour-ready area.
- #822 and A823: component tests, regenerated part constants, locale parity, device rows tracked on #349.

## 7. Risks

- Scope: colour-ready alone is roughly 120 to 200 files; the release waits on it (MC-3871, MC-4651).
- Colour regressions on Home are visible to everyone with a pack on and no switch to gate them.
- Delivery stage D touches the apply, blob and commit path (critical contract): needs Gate 1 and opus-reviewer.
- APK size: bundled fonts of 3 to 10 MB each (Noto Sans KR 10.4 MB) are unmeasured against the APK budget.
- Licence evidence is thin: 경기천년제목 KOGL listing unverified, NanumGothic for Genshin only inferred, Novecento Wide unreadable, Galmuri unchecked; game-font matches are fan claims. #654 says finish licence checks before shipping.
- No reference imagery is recorded for Terran Eclipse, Aqua Halo or Elemental Ivory (only Banana Cocoa, MC-2516).

## 8. Still open (to settle before the dependent stage, not before this PR)

Settled by the grilling step and dropped from this list: bundled-pack identity, downloads, Home timing, load failure (MC-4655 to MC-4658); contrast notes (MC-3421), recovery (MC-3420, MC-4653), layering (MC-4243), reduced-motion (MC-4244), the no-notes guard (MC-3419).

1. Where bundled archives live and how they are built (committed `.risutheme` with size and SHA pins as in `theme-packs/`, or built from `docs/design/*/themes` sheets at build time): an engineering choice for the stage D designer, with a recommendation.
2. #803 (paper texture): fold into Scratch White (K3) or land first.
3. Reference imagery and font picks for Terran Eclipse, Aqua Halo and Elemental Ivory (maintainer supplies or approves at K4 and K5).
4. APK size budget for bundled fonts and textures.
5. The legacy `SideBars` sidebar and classic Settings: in scope of colour-ready or not (MC-2941 versus MC-1608 Q2); this sizing assumes not.
6. Whether Home gets a preview switch before colour-ready lands (the plan assumes no).
