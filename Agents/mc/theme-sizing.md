### MC-4700 — #654: full-spec theme packs are bundled with the app as archives, 2026-11-28

- Tag: decisions (maintainer via AskUserQuestion in the theme-sizing session). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-3871`, `MC-695`, `MC-4162`.

**What the maintainer chose.** Option "Bundle as archives (Recommended)": extend the built-in path to load bundled `.risutheme` archives through the existing archive intake (all five area sheets, fonts, images), so all seven packs ship in the app. Bundled fonts must be free (MC-695 rule 3). The built-in path today is chat-only and asset-free, and the app has no gallery host.

### MC-4701 — #654: colour-ready for Home, Settings, Studio and popups comes before the pack PRs, 2026-11-28

- Tag: decisions (maintainer via AskUserQuestion, asked twice). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-3121`, `MC-3125`, `MC-3126`, `MC-2938`.

**What the maintainer chose.** First "Colour-ready first"; then, after the sizing showed that the work is not a switch flip (Studio, Settings and Home still paint with scheme classes, Studio's colour tokens are read by no component, estimate about 9 to 12 PRs, unverified), "Yes, all areas first": Home, Settings, Studio and popups become colour-ready before the packs are rebuilt, so a pack recolours every new screen. The recommended smaller option (Home and Settings first) was not chosen.

### MC-4702 — Colour-ready means new area role colour tokens that the markup reads, 2026-11-28

- Tag: decisions (maintainer via AskUserQuestion). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `#231`, `#235`, `MC-3121`.

**What the maintainer chose.** Option "New area role tokens (Recommended)": colour role tokens such as `--settings-*` and `--studio-*` in `src/styles`, defaulting to today's scheme values, with markup migrated to read them, plus a pack base block and contrast pairs per area. Scheme classes do not stay the colour channel for non-chat areas.

### MC-4703 — Studio and Home get no own-colour recovery island, 2026-11-28

- Tag: decisions (maintainer via AskUserQuestion). Date: 2026-11-28. Exact times: UNKNOWN. Related: `MC-3420`, `MC-3421`, `#654`.

**What the maintainer chose.** Option "Accept turn-off only (Recommended)": a colour-ready Studio or Home with unreadable pack colours is recovered by turning the pack off (escape route and safe start), not by an own-colour island like Settings has.

### MC-4704 — Order of #823, #821, #822 and the pack PRs, 2026-11-28

- Tag: decisions (maintainer via AskUserQuestion, two questions). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `#821`, `#822`, `#823`, `MC-2503`, `MC-2517`.

**What the maintainer chose.** (1) "823 first, 821 folded": #823 lands before the first pack PR; #821 becomes the Banana Cocoa pack PR inside #654; #822 runs in parallel on its own files. (2) Pack PRs are grouped by risk in pairs: Origin Navy with Office Sheet; Banana Cocoa; Scratch White; Terran Eclipse; Aqua Halo with Elemental Ivory.

### MC-4705 — Bundled theme packs keep their builtin ids and are read from the app, 2026-11-28

- Tag: decisions (maintainer via AskUserQuestion). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-4700`, `MC-350`.

**What the maintainer chose.** Option "Keep builtin ids (Recommended)": the bundled archive is read from the app on each apply and nothing is stored in the database. Updates ship with the app, bundled packs cannot be deleted, an active `builtin:` id stays valid, and a rebuilt pack upgrades silently with the existing install notice. No migration.

### MC-4706 — Downloadable Scratch White and Office Sheet coexist with the bundled packs, 2026-11-28

- Tag: decisions (maintainer via AskUserQuestion). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-4700`.

**What the maintainer chose.** Option "Coexist, retire later (Recommended)": bundled packs use the builtin namespace and never collide with installed archives; the picker lists bundled packs first; the `theme-packs/` download archives are retired in a follow-up once the bundled packs ship.

### MC-4707 — An area joins the colour-ready set with or after the first pack that ships a sheet for it, 2026-11-28

- Tag: decisions (maintainer via AskUserQuestion). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-3121`, `MC-4701`.

**What the maintainer chose.** Option "With the first pack PR (Recommended)": each area's markup migration lands with role tokens defaulting to today's scheme values and `COLOUR_READY_AREAS` unchanged, so no user sees a difference; an area is added to the set in the same PR as, or after, the first pack that ships a sheet for it. The same rule applies to Home, Settings and Studio.

### MC-4708 — A bundled pack that fails at runtime applies what judged ok, 2026-11-28

- Tag: decisions (maintainer via AskUserQuestion). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-4700`, `MC-3420`.

**What the maintainer chose.** Option "Partial apply, no popup (Recommended)": the areas that judged ok are applied, skipped areas show on the pack row, an undecodable font falls back to the declared system font without a message, and a build-time test judges every bundled archive so a failure cannot ship.
