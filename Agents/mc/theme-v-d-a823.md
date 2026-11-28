### MC-4740 — #654 stage V: Home sheets may carry bundled images and fonts, 2026-11-28

- Tag: decisions (maintainer via AskUserQuestion in the theme-v-d-a823 session). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-3419`, `MC-1351`, `MC-4700`.

**What the maintainer chose.** Option "Fix: allow Home assets (Recommended)": the stage V probe showed the Home sheet refuses every `url()` in its rules ("a pack carries none"; top-level @font-face blocks were already accepted), while chat, Settings and Studio accept bundled images and fonts. Under MC-3419 a refusal of a full-spec pack is a validator defect, so the Home supplement now refuses only what names a scheme or host and every `image()`, `src()` and `element()`; a relative bundled path is judged like in the other areas. No change to `apply.ts`. Limit (Gate 2 E2): Home is a shape-only area today, so a bundled Home image is accepted at intake but not painted until Home is colour-ready (MC-4707); fonts and shape apply now.

### MC-4741 — #654 stage V: probe result and what stays a contract limit, 2026-11-28

- Tag: findings (this session's own evidence, not a maintainer decision). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-3419`, `MC-3422`, `MC-4243`, `MC-4244`.

**Result.** The 36 sheets that exist (four packs across chat, studio, settings, home in `docs/design/*/themes`, the two golden archives, the two `theme-packs/` archives) all judge ok with no notes. The three new packs have no sheets, so a stress matrix over every chat, settings and home part stood in for them (probe kept outside the tree). Contract limits, not defects: effects (animation, transform, filter) and images apply on safe-tier leaves only (22 chat parts, 1 settings part, 19 home parts); an ornament, image or neon edge on any other part must be a `::before`/`::after` with empty `content` (accepted on 373 chat parts); `position`, `inset`, `z-index`, text in `content`, `drop-shadow()`, `calc()` other than `calc(<x> * -1)`, `::selection` and `@keyframes` frames other than opacity, transform, translate, scale, rotate and filter are refused by design (MC-3422, MC-4243); a font family must start with `pack-`. Cosmetic: a refused image also lists a second, misleading "colour word that is not a colour" error. Studio and popups were not stress-probed (no part list constant); re-run before each pack PR.

### MC-4742 — #654 stage D: built-ins become bundled archives, whole-pack broken on failure, 2026-11-28

- Tag: decisions (maintainer via AskUserQuestion, two questions in the theme-v-d-a823 session). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-4700`, `MC-4705`, `MC-4708`.

**What the maintainer chose.** (1) "Replace with archive shape": the chat-only `BuiltinPack` is replaced; every built-in is a bundled `.risutheme` archive read through the intake on each apply. (2) "Simplify: whole-pack broken": Gate 1 showed runtime partial apply is nearly unreachable (bytes are SHA-pinned to what the build-time test judged), so a bundled pack that fails at runtime shows the existing broken row and the app's own colours; the build-time test judging every bundled archive stays. This overrides the partial-apply half of MC-4708 only.
