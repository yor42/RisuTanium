### MC-5060 - #654 stage P: scope and token family, 2026-11-28

- Tag: decisions and findings (this session; no maintainer question). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-4702`, `MC-4703`, `MC-4707`, `MC-4881`, `MC-4882`.

**Trace.** Every popup, alert, task card and toast mounts from `App.svelte` as a direct child of `<main>`, outside `.home-root`, the Settings shell root, the Studio root and the chat shell, and belongs to no one area: any screen opens them. About 676 scheme-class hits sit in 30 of the 45 `POPUPS_FILES` (the Nexus pattern files already read `--nexus-*`), plus shared controls (`Button`, `TextInput`, `SelectInput`) they reuse.

**Decision.** One shared family, not per-area: nine `--overlay-*` roles in `src/styles/overlay-roles.css` (`fg`, `fg-2`, `canvas`, `surface`, `surface-raised`, `selected`, `edge`, `edge-strong`, `danger`), each `var(--risu-theme-<name>)`, and one `<div class="overlay-host" style="display: contents">` in `App.svelte` around the overlay hosts that re-points the nine `--color-<scheme>` names at them (the Home mechanism, MC-5021). No component is edited and shared controls follow. The `--popup-*` prefix is taken by `settings-tokens.css`, hence `--overlay-*`. `COLOUR_READY_AREAS` stays `{chat}` and C0's `data-theme-pack-area` contract is untouched; with no pack nothing differs.

### MC-5061 - #654 stage P: base block, pairs and pack-settable roles go to the join PR, 2026-11-28

- Tag: findings (open question to lane A). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-3007`, `MC-4707`.

**Result.** The roles are not yet settable by a pack: `popups.css` is judged with no tokens (Rule SCOPE refuses custom properties, MC-3007), so a pack recolours popups only through part-scoped colour declarations. A popups base block and contrast pairs would freeze provisional targets before any pack ships a popups colour, so they ship with the join PR (as stage S). Whether `popups.css` may then set the nine `--overlay-*` roles is a validator-contract change and the maintainer's or lane A's to rule.

### MC-5062 - #654 stage P: lane A approves option A; join-PR leftover, 2026-11-28

- Tag: decisions (lane A). Date: 2026-11-28. Exact times: UNKNOWN. Related: `MC-5061`, `MC-3007`, `MC-4707`.

**Result.** Lane A approved keeping P as designed. Named leftover for the join PR (the first pack shipping a popups colour): amend the popups registry so `popups.css` may set the nine `--overlay-*` roles, add a popups base block selected by the area attribute, and add the popups contrast pairs. THEMING.md H-7.11 carries the author guidance.
