### MC-5020 - #654 stage H: Home colour-ready rulings, 2026-11-28

- Tag: decisions (maintainer, relayed by lane A). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-4702`, `MC-4703`, `MC-4707`.

**What the maintainer ruled.** Home gets no preview switch. The legacy `SideBars` and classic Settings are out of scope. Home has no own-colour recovery island: turning the pack off is the recovery (MC-4703). `COLOUR_READY_AREAS` stays `{chat}` in this PR; Home joins with or after the first pack that ships a Home sheet (MC-4707).

### MC-5021 - #654 stage H: the landing re-points the Tailwind scheme names at Home roles (option B), 2026-11-28

- Tag: decisions and findings (maintainer chose option B through lane A, after the session sized the closure). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-4702`, `MC-4882`.

**Finding.** The sizing counted the 9 files under `src/lib/UI/Home`. The real `HomeShell` closure is about 40 files (shared catalog `GridCatalog`, character lists, `MainMenu`, the Realm panel, and the app-wide `Button`, `TextInput` and `SelectInput`), and H-7.2 covers all of it.

**Decision.** Nine `--home-*` roles (`fg`, `fg-2`, `canvas`, `surface`, `surface-raised`, `selected`, `edge`, `edge-strong`, `danger`) alias the scheme roles in `src/styles/home-roles.css`. The same file re-points `--color-<scheme name>` on `.home-root` only, so every scheme utility inside Home (shared components included, none edited) reads a Home role, and nothing outside `.home-root` changes. Departs from MC-4702's wording in mechanism only; the channel is the token. Two files read `--risu-theme-*` directly in markup and now read `--color-*` (same value outside Home). Popups portalled out of `.home-root` stay with stage P; `ToastHost` stays with A823.

### MC-5022 - #654 stage H: base block, pairs and the secondary-text exception, 2026-11-28

- Tag: findings (Gate 1 rejection of the first plan, then revision). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-3421`.

**Result.** `home-pack-base.css` is selected by the area attribute, pins the nine roles to the registry reference scheme and repaints `body` with `--home-canvas`, so pinned text is never drawn on a light user scheme (inert while Home is not ready). `--home-fg-2` is the one role lifted in the base (`#b8bfd0`; the reference `#64748b` is 1.9 to 3:1 on the base surfaces) and carries no pair, since the registry default fails 4.5:1 on its own. `--home-fg` is paired at 4.5 on canvas, surface, raised and selected; a failing pair is a contrast note (MC-3421), not a refusal. The nine names are pack-settable.

### MC-5023 - #654 stage H: PC row of C0 observed; a pack already recolours Home through the scheme, 2026-11-28

- Tag: findings (delegated PC run, desktop Chrome via CDP). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-4882`, `MC-3001`.

**Result.** MC-4882's expectation (only the area attribute differs with a pack on) did not hold: with `builtin:banana-cocoa` on, 148 custom properties differ on Home because the pack's declared scheme rewrites the root `--risu-theme-*` block and everything derived follows. The area and base attributes are absent on Home, as designed while Home is not ready. Detail in `Agents/Findings-2026-11-28-theme-c0-pc-row.md`. Consequence for H: Home roles alias the scheme, so Home looks the same as before this PR with or without a pack.

### MC-5024 - #654 stage H: gate dispositions, 2026-11-28

- Tag: findings. Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-2746`.

**Gate 1** (native Sonnet, of the first per-class plan) rejected it on four substantive findings: the app token spelling, an unsatisfiable `--home-fg-2` pair, a closure about 40 files wide instead of 9, and no canvas paint under the base. Option B (MC-5021), the lifted base `--home-fg-2` and the body canvas rule answer them; the revised design was not re-reviewed at Gate 1 because Gate 2 reviewed it as built.
**Gate 2** (`opus-reviewer`, scenarios: a colour variant nothing reads; Home unreadable or unescapable with a pack on; a visible change with no pack) rejected once: `home-roles.css` re-declared the role defaults after `home-pack-base.css` at equal specificity, so the base could never win. Fixed by importing the roles before the base, with a pin on the order and a new cascade row (`homeBase.cascade.test.ts`) that runs the shipped order. Its editorial findings: translucent Home surfaces are now listed as `opaque` (done); `--home-fg-2` has no pair and a pack can set it equal to a surface (known limitation, MC-3638); a Home sheet that sets the shared `--color-<scheme>` names reaches nothing inside Home, so the join PR's author guidance or a validator note must say Home colours go through `--home-*` (open, for the join PR); the scan test now also reports an unknown `--color-*` read.
**Mutants:** dropping one remap line, and restoring a direct `--risu-theme-*` read in `GridCatalog`, each fail `homeColourRoles.test.ts`.
**Not run:** `packBase.svelte.test.ts` cannot load `@tailwindcss/oxide` in this checkout (also fails in the main checkout); CI covers it. No device run (one device session exists).

- MC-5025 (2026-11-28) fresh Gate 2 re-review of b64500158 (option B and the cascade-order fix, report gate2b-report.md in scratch): no substantive finding, scenarios refuted against the production build and an order mutant. Editorial fixes applied (stale order comment, stale test header, stray CR); the import-order guard reads text order only and stays a known limitation until Home joins COLOUR_READY_AREAS (hardening: role defaults as :where(:root)). Author guidance added as THEMING.md H-7.10.
