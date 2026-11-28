### MC-5050 — #654 stage U: scope rulings for Studio colour-ready, 2026-11-28

- Tag: decisions (maintainer rulings given in the stage U brief). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-4702`, `MC-4703`, `MC-4707`.

**Rulings.** Studio gets no own-colour recovery island: turning the pack off is the recovery (MC-4703). `COLOUR_READY_AREAS` stays `{chat}`; Studio joins with or after the first pack that ships a Studio sheet (MC-4707). The markup change is invisible to users.

### MC-5051 — #654 stage U: Studio takes Home's remap, not Settings' paren utilities, 2026-11-28

- Tag: decisions and findings (this session). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-5021`, `MC-5031`, `MC-5033`.

**Result.** Nine `--studio-*` roles (`fg`, `fg-2`, `canvas`, `surface`, `surface-raised`, `selected`, `edge`, `edge-strong`, `danger`) alias the scheme in `src/styles/studio-roles.css`; the same file re-points `--color-<scheme name>` on `.studio-root` only (one class on the `StudioScreen` root). Reason: the closure is 68 Studio files with about 1066 scheme-utility uses, many dynamic, plus shared controls (`WindowedSegment`, `NumberInput`, `SegmentedControl`, `Help`) that the Settings approach had to exempt; a paren migration would edit nearly every Studio file while a concurrent history-core batch edits them. The remap edits one class, covers the shared controls inside Studio only, and leaves everything outside the root on the scheme by construction. Two shared controls (`SliderInput`, `SegmentedControl`) read `--risu-theme-*` directly and now read `--color-*` (same value outside Studio).

### MC-5052 — #654 stage U: base block, pairs and settable roles go to the join PR, 2026-11-28

- Tag: decisions (follows MC-5033). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-4707`.

**Result.** No pack ships a Studio sheet, so a base block, contrast pairs and a registry entry would freeze provisional targets and make the validator judge names nothing applies. The roles are not pack-settable (a test pins the refusal); THEMING.md H-7.12 records the author guidance.

### MC-5053 — #654 stage U: gate dispositions, 2026-11-28

- Tag: findings. Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-2746`, `MC-5051`.

**Gate 1** (fresh native Sonnet reviewer, report in scratch): EDITORIAL, no substantive finding. Applied: the two shared controls that read the scheme directly are named and the dual-use test now targets the shared controls (`SegmentedControl`, `SliderInput`), because `StudioToggleLink` and `StudioEntryRow` are rendered only outside Studio and never inside it; the closure walker resolves `src/lib/...` imports, skips `.svelte.ts` modules and throws on an unresolved import. `escapeWalk.studio` is not added: Studio has no pack-off element (the pack row is in Settings, MC-4703), so the walk's escape-element model has nothing to mark in Studio; Studio's way back (`studio-header-back`) is already in the registry's reach list, which a sheet cannot hide. Rows for Studio's critical closure (`studioCriticalClosure`) are unchanged and pass.
**Mutants** (all fail a named row): dropping one remap line, re-aliasing `--studio-edge`, removing the `studio-root` class, restoring a direct `--risu-theme-*` read in `SegmentedControl`.
**Not run here:** `packBase.svelte.test.ts` (cannot load `@tailwindcss/oxide` in this checkout; CI covers it). No device run; device rows: none from this diff beyond a visual no-change glance at Studio with and without a pack (PC row, optional).
