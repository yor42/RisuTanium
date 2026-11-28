### MC-4880 — #654 stage C0: the Settings tokens slice of #235 is narrowed to unread layout names, 2026-11-28

- Tag: decisions (maintainer via AskUserQuestion in the theme-c0 session). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `#235`, `MC-4702`, `MC-4707`, `MC-091`.

**What the maintainer chose.** Option "Narrow (Recommended)": `src/styles/settings-tokens.css` holds only the non-colour Settings names that no shared token file declares and no code reads, with the registry's values resolved to literals, imported by `SettingsShell.svelte`. A verbatim copy was refused as a design: it collides with `chat-tokens.css` and sets `color-scheme`, so it would restyle the whole app. `docs/design/settings/theme-tokens.css` stays the validator reference with a drift test; the validator is not repointed (a repoint belongs to a later #235 stage for every area, behind a verdict-diff gate). Colour roles for Settings come with stage S (MC-4702).

### MC-4881 — #654 stage C0: the popups overlay rule is C0's, and follows the colour-ready set, 2026-11-28

- Tag: findings and scope (this session; no maintainer question). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-3121`, `MC-4707`.

**Result.** No stage P existed, so the overlap named in the sizing (Stage C0/P on the overlay rule) was assigned to C0. The popups colour text now exists when any colour-ready area has a non-blank sheet (apply, and the install-flow held-colours notice, one rule), instead of "the chat sheet has text". With `COLOUR_READY_AREAS` unchanged at `{chat}` nothing differs for users.

### MC-4882 — #654 stage C0: per-area base blocks select on a root area attribute; contract H-7 is written, 2026-11-28

- Tag: decisions and findings (this session). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-4702`, `MC-4703`, `MC-4707`.

**Result.** The surface gate sets `data-theme-pack-area` beside `data-theme-pack-base`, only while a colour-ready area with a base is on, so a later area ships `:root:where([data-theme-pack-base][data-theme-pack-area="<area>"])` blocks; chat's presence-only blocks are unchanged. A per-area table (`colourAreas.ts`) drives `apply.ts` so joining the set is a table plus registry change. The colour-consumption contract (H-7, H-7a) is a section of `docs/design/THEMING.md`; earlier code comments citing H-7 now point at it. `COLOUR_READY_AREAS` stays `{chat}`.
