# UI-S6 stage 1: the theme-pack safety validator as fs-free browser TypeScript, plus the hostile-pack suite (cloud lane, 2026-11-12)

Branch `cloud/ui-s6-s1`, cut from `origin/main` 2665ccb05. Decisions: MC-1527 (cloud scope: stage 1 only), MC-1351 (bundled fonts and images; remote url() blocked), MC-1354 (warning above 20 MB), MC-1355 (Origin Navy and Banana Cocoa acceptance packs), MC-058 (no user strings: reasons stay English for the later install UI). Environment: Linux cloud container, Node 22.22.0, 4 CPUs. Hooks note: see `CHORE-585.md`.

## What changed

- `src/ts/themePack/` (new, nothing in the app imports it yet):
  - `csslit.ts`, `failclosed.ts`, `geometry.ts`, `engine.ts` (the reference `packlint.mjs` engine and chat registry), `registries/{studio,settings,settings4,settings5a,settings5b,home}.ts`: a typed rewrite of the reference validator in `docs/design` (same algorithm, regexes, constants, messages and order; no node APIs; the CLIs dropped).
  - `tokens.ts`: the six token stylesheets and the three Studio parts registries the reference reads, bundled from `docs/design` (`?raw` and JSON imports); a missing or emptied file throws instead of silently emptying a token map. The single injection point a later stage repoints to `src/styles` (those files differ from the design ones today, so stage 1 keeps reference parity as its oracle).
  - `canonical.ts` (the front end every stylesheet passes first): reads the preprocessed stylesheet with CSS tokenising and refuses anything a browser could read differently from the engine (a strict profile). It refuses:
    - backslash escapes anywhere; control characters other than tab and line feed; non-ASCII outside strings and comments;
    - broken or unterminated strings and comments; `/*` or `*/` inside a string or url; a comment joining two word characters; `<!--` / `-->`;
    - an unquoted url() holding a quote, parenthesis, brace, `;`, backslash, whitespace or non-ASCII, or left unclosed;
    - nesting (a block inside a rule, an at-rule inside a rule, an at-rule inside `@media`), a brace inside `()` or `[]`, anything unclosed at the end;
    - `!` not written as `!important`;
    - a number with an exponent or with a unit the size checks do not measure (allowed: the measured lengths in lower case, `%`, deg/rad/grad/turn, s/ms, fr, x, dpi/dppx/dpcm, and the an+b `n`; a `#` colour and a `u+` unicode-range are not numbers).
    - Every resource is judged where it is written (MC-1351): each url token and each string inside url(), image-set(), src(), image() or cross-fade() (vendor prefixes stripped) must pass `isBundledTarget`; element() is refused; var(), attr() and env() inside a resource function are refused.
    - It returns the canonical text (comments become a space) for the next passes.
  - `urlPolicy.ts` (MC-1351): `isBundledTarget`: a bundled relative path only. Refused: empty; whitespace, control, backslash or `:` (so every scheme, data: and blob: included); a leading `/` (so `//`) or `#`; an undecodable percent escape; the same checks again after decoding; any `..` segment. The refusal reads "a remote or non-bundled url() is not allowed: a pack may only point at its own bundled fonts and images (MC-1351)".
  - `fontFace.ts` (MC-1351): top-level `@font-face` blocks are taken out of the canonical text and judged on their own:
    - descriptors font-family, src, font-weight, font-style, font-stretch, font-display, unicode-range;
    - src items `url(<bundled>)` with optional format()/tech(); local() refused;
    - src and font-family required.
    - The engine judges the remainder. A nested @font-face is refused by the profile.
  - `packSize.ts` (MC-1354): a warning strictly above 20 MiB (20 × 1024 × 1024, the repo's convention) of uncompressed stylesheets plus bundled assets; never a rejection.
  - `index.ts`:
    - `preprocessCss`: CR LF, CR and FF become LF, and NUL becomes U+FFFD, as CSS Syntax does.
    - `lintAreaPack(area, css, name)`: preprocess, then the profile, then @font-face, then the area's reference lint. Errors are the union, de-duplicated, and `ok` means none.
    - Also `validateThemePack({ files, totalBytes })`, `AREA_LINT` and `THEME_AREAS`.
  - The translated engine's var() expansion (in `failclosed.ts`, `geometry.ts` and `engine.ts`) is memoised on (value, depth), because a chain of eight custom properties each naming the next eight times took exponential time; the results are unchanged (parity).
- `vitest.config.ts`: `test.css.include: [/docs\/design\/.+\.css/]`, because Vitest empties a CSS import, `?raw` included, unless it is listed; scoped to the design stylesheets so no existing test's CSS handling changes.

## Tests

- `parity.test.ts` (translation faithfulness only): reference vs port, deep equal including error order, for the four area lints, the engine `lintPack` and `sheetReport` over the 8 shipped packs, both hostile JSON fixtures (bare and on Origin Navy), benign.mjs, packlint-hostile.mjs, packlint-values.mjs (with its registry), the seven legacy settings files and index-right.css, the R1..R16 reach packs, and a seed-727 single-token fuzz (> 300 cases) over every chat, studio and home floor and ceiling. Loads the reference by URL from the repository root; a missing reference file fails with its name (accepted coupling to `docs/design`).
- `hostilePacks.test.ts` (992 tests): run.mjs sections 1 to 6 on the port's public API alone, every regex and decided-accept set copied verbatim. Sections 7 (fuzz, covered by parity) and 8 (token-file checks) and dd256's rendered-page calibration stay in docs/design (mockup and calibration checks, not validator behaviour).
- `packRules.test.ts` (121 tests) covers:
  - the MC-1351 url forms and @font-face rules, and MC-1354;
  - CR/FF preprocessing (a CR LF Origin Navy still passes);
  - every bypass the two hunts confirmed in Chromium, as a regression case: 24 from hunt 1, plus the 10 number/unit cases from hunt 2;
  - a reason test per profile rule (16 cases), and an acceptance test for ordinary numbers, colours, unicode ranges and an+b;
  - the 8 acceptance packs through the public API; the bundled inputs equal the files on disk; the fs-free source guard;
  - time bounds: a 2 MB stylesheet, and an 8 × 8 var() chain.
- `browserImport.test.ts`: the validator imports and judges in jsdom.

## Plan and reviews

| Gate | Reviewer | Verdict | Notes |
|---|---|---|---|
| Gate 1 | adversarial-reviewer (fresh) | [APPROVE WITH CHANGES] | Changes folded into plan rev 2: the token injection point, the parity oracle, the MC-1351 wrappers outside the engine, the test split |
| Gate 2 round 1, translation lens | adversarial-reviewer (fresh) | [APPROVE WITH CHANGES] | Translation faithful; minor typing points fixed |
| Gate 2 round 1, rules lens | adversarial-reviewer (fresh) | **[REJECT]** (1) | The engine's comment-stripped view diverged from the browser (comment delimiters in strings, escapes), which hid a remote url() |
| Gate 2 round 2, bypass lens | adversarial-reviewer (fresh) | **[REJECT]** (2) | CR, FF and CR LF end escapes and strings for the browser but not for the validator |
| Gate 2 round 2, memo lens | adversarial-reviewer (fresh) | [APPROVE WITH CHANGES] | The var() memo key must keep the depth (it does) |
| Self-run bypass hunt 1 | 2 hunters, Playwright Chromium | 24 bypasses | Escapes, string continuation, NBSP/VT/FEFF, comment joins, bad-url hiding rules, url() inside image-set, var() into image-set, nesting, braces in groups, `{}` values, non-ASCII names, `! important` |
| — | (mechanism change at the second rejection) | — | Regex patching replaced by the strict-profile tokeniser `canonical.ts` (plan rev 4) |
| Self-run bypass hunt 2 | tokeniser hunter, Playwright Chromium | 1 family | An exponent or an unmeasured unit read smaller than the browser draws: `1e3px`, `10pc`, `300q`, `100dvh`, `1000PX` in border or box-shadow. Fixed by the number rule (plan rev 5); 10 regression cases fail without it |
| Gate 2 round 3 | adversarial-reviewer (fresh) | [APPROVE] | Ran the suite and probed 35 resource cases; no Chromium run of its own. It created and removed one scratch test inside the worktree (no residue; `git status` clean) |

Two consecutive substantive rejections (rounds 1 and 2), then an approval; no advisor escalation was needed.

**Not covered:** the hunt-2 semantics hunter, which was to cover @font-face, @media, custom properties, image functions and fetching properties, stopped before running any case. This angle has had no self-run hunt since the redesign. It was covered only by the reviewers' reading and by the regression and reason tests. Lane A may want a person to hunt it.

**False positives, kept by design.** Hunt 2 found three over-refusals; each has a plain way to write the same thing:
- `! important` with a space: write `!important`.
- An escape in a string, such as `"\2014"`: write the character itself in UTF-8.
- An unquoted Hangul font name: quote it.

Wider ones:
- `100dvh` and the other newer viewport units, `pc` and `q`, and upper-case units are refused.
- data: and blob: are refused (conservative reading of MC-1351; lane A to confirm).

**Report-only, from the reference engine's own rules** (parity keeps them; not changed here):
- vendor aliases (-webkit-transform, -webkit-margin-before, -webkit-perspective, -webkit-box-reflect);
- the data-role safe context across `~` and `+`;
- 0.0px and calc(0px) font sizes;
- var() failing open in the size checks;
- focus loss via `initial` or `hidden`;
- inlinePrivate's name-keyed memo depending on order;
- image-set(attr()) accepted (Chromium makes no request).

## Red on origin/main

Every test is new and the module is new, so on `origin/main` all four files fail at import (the module does not exist): import-level evidence only, no behavioural claim. The behavioural power of each file is shown instead by mutants (below) and by the authors' falsification runs (parity: a changed home contrast ratio fails the home and fuzz tests; hostile suite: an always-accept stub fails 848 of 992).

## Mutants (scratch copy outside the tree)

Each mutant was applied to a scratch copy outside the tree and run against `src/ts/themePack`. All runs were against the final code.

**Profile and wiring (`canonical.ts` C1–C27, `index.ts` I1–I4): 29 / 31 killed.** The mutants removed each refusal in turn: escapes outside and inside strings, control characters, unterminated comments, comment joins, CDO/CDC, bad strings, comment markers in strings and urls, judging of strings inside resource functions, non-ASCII, element(), var() inside a resource function, vendor-prefix stripping, the bad unquoted-url character and an unclosed url, judging of unquoted url targets, braces inside groups (open and close), nesting, nested at-rules in `@media` and in rules, `!`, unclosed groups, upper-case units, the unicode-range exemption, image-set as a resource function, FF preprocessing, and dropping the profile or font errors.
- First pass: 20 killed. Ten survived only because another rule refused the same input (C3, C4, C6, C7, C16, C17, C19, C20, C22, plus C14). The reason tests killed all of them except C14 on the re-run.
- Two equivalent, accepted:
  - **C14:** a bad character in an unquoted url stops the scan on a character that is not `)`, so the "unclosed url" refusal fires with the same reason.
  - **I4:** feeding @font-face extraction the preprocessed text instead of the canonical text differs only in comments, which `fontFace.ts` skips and the engine strips.

**Unchanged passes (`urlPolicy` U1–U3, `fontFace` U6–U11, size U12, `index` U13–U15, `tokens` U16, private prefix U17, memo U24): 13 / 16 killed.** Three survived, accepted:
- **U3 (equivalent):** `:` allowed before decoding; the check after decoding refuses it.
- **U10 (equivalent through the public path):** non-ASCII name characters in an @font-face keyword; the profile refuses non-ASCII first.
- **U16:** the missing-token-file sentinel. Its files are bundled at build time, and the bundled-input equality test pins their content, so the guard cannot fire under test without mocking a module.

Mutants on the replaced design (the regex url finder and the comment-view pass) were retired with that code.

## Checks

- `pnpm check` (8 GB heap): 7805 files, 0 errors, 2 warnings. Both are the pre-existing tsconfig notices; three extra warnings from statically importing the .mjs data modules were removed by loading them by URL.
- `pnpm exec vitest run src/ts/themePack`: 4 files, 1124 tests passed.
- Full `pnpm test`, final snapshot, 35 min 12 s: 1827 files passed, 1 failed, 1 skipped; **38,710 passed, 2 failed, 30 skipped**. The 2 failures are the known `replay/actors.test.ts` environment timeouts.
- `pnpm build`: 7613 modules transformed, built in 24.70 s, exit 0 (nothing imports the validator yet, so it is not in the bundle; it type-checks under `pnpm check` and loads in jsdom).

## Known failures, not fixed here

- `replay/actors.test.ts`: 2 timeouts, the environment failure recorded in `Agents/Lanes/lane-cloud-records.md` (storage code, untouched).

## New en.ts keys

None.

## Left out (later stages, lane A)

Install UI, storage, asset store, Settings entry, applying a pack; font and image magic-byte checks and the SVG refusal (the asset stage: this stage judges stylesheets only); licence checks for the other three packs; repointing the tokens to `src/styles`; registering any of this in the design docs. Performance: the install stage must load the validator lazily and run it off the main thread or in slices.

## Accepted limitations

- Parity proves faithfulness to the reference, not the reference's security.
- A bundled font can map glyphs freely (MC-1351 allows fonts).
- The suite depends on `docs/design/**` staying in place.

## Device checks for lane B

None for this stage (no UI). When the install stage lands: time to validate both acceptance packs on the Note 9 off the main thread.
