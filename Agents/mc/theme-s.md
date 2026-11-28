### MC-5030 — #654 stage S: scope rulings for Settings colour-ready, 2026-11-28

- Tag: decisions (maintainer rulings given in the stage S brief). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-4702`, `MC-4703`, `MC-4707`, `MC-4882`.

**Rulings.** Legacy SideBars and the classic Settings pages are out of scope of colour-ready. No own-colour recovery island is added for Studio or Home. For Settings, what exists stays (MC-4703, H-7.4). `COLOUR_READY_AREAS` stays `{chat}`; Settings joins with or after the first pack that ships a Settings sheet (MC-4707).

### MC-5031 — #654 stage S: the Settings roles are paren utilities over plain scheme aliases, 2026-11-28

- Tag: decisions and findings (this session, Gate 1 approved in round 2). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-4702`, `H-7.1`, `H-7.2`.

**Result.** `src/styles/settings-roles.css` declares the `--settings-*` colour roles in one `:root, [data-own-scheme]` block, each exactly `var(--risu-theme-<name>)`; the shell reads them through Tailwind paren utilities (`text-(--settings-text)`), not through `@theme`, so an island or a later base block that re-declares a role reaches the utility. Same-alias roles stay separate (selected, hover, focus; text, on-selected, swatch) so a later base re-points each to its own judged colour. Rejected: scoped re-declaration of the scheme names on the Settings root (keeps scheme classes as the channel and recolours shared controls), and aliasing `--nexus-*` (the derived `-role-` values would change the no-pack paint). The markup migration is invisible to users: no pack, a readable pack, pack safe mode and own colours paint as before.

### MC-5032 — #654 stage S: no island is added to the Settings shell, 2026-11-28

- Tag: findings (this session; independent reviewer confirmed). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-4703`, `H-7.4`.

**Result.** Own-colour Settings is the root swap (`colorschemeCore.ts`, `effectiveColorScheme`) plus the surface gate masking the Settings sheet while own colours are on (`surfaceGate.svelte.ts`, `screenMasked`), which also removes the base and area attributes. The roles at `:root` then resolve to the own scheme, so no element-level island is needed and none is added. The shell carries no `data-own-scheme` and re-declares no scheme name (a scan test pins it).

### MC-5033 — #654 stage S: partition into two stacked PRs; base block and pairs go to the join PR, 2026-11-28

- Tag: decisions (this session, after Gate 1 round 1 REJECT and round 2 APPROVE). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-4707`, `MC-4882`.

**Result.** S1 migrates 25 shell files with 167 hits and declares only the roles it reads; S2 (stacked) migrates Personas, Connections and Plugins and adds `--settings-swatch-2` and `--settings-danger-fill`. The pack base block `settings-pack-base.css`, its tests and the Settings contrast pairs are not shipped before a pack with a Settings sheet exists, so provisional base targets are not frozen; they go to the join PR. The `ToastHost` paren-syntax gap in the shared-token consumers scan is a separate Tier-1 follow-up. Shared form controls and the classic Settings pages keep scheme classes, exempt by directory; after the join they paint the chat-derived pack scheme over Settings-sheet surfaces and nothing judges that pairing (a join item). Hover fills keep the text role over `hover:bg-selected` (about 35 buttons), unjudged until the join.
