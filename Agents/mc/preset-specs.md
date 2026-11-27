### MC-4720 — #706: NovelList sampling (`ainconfig`) is part of the Studio provider blocks, 2026-11-28

- Tag: decisions (maintainer via AskUserQuestion, relayed in the #706/#707/#710 session). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#706`, `MC-3970`, `MC-4030`.

**What the maintainer chose.** The Studio preset form carries NovelList's sampling rows (`ainconfig.*`), built in stage d with the NovelAI rows. Settles `PRESET_PROVIDER_SPEC.md` section 3.4 (the `presetAin<Key>` rows) and stage d of section 7.

### MC-4721 — #706: separate parameters are fully in the Studio preset form, with per-purpose import and export, 2026-11-28

- Tag: decisions (maintainer via AskUserQuestion). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#706`, `MC-4043`, `MC-4030`.

**What the maintainer chose.** Separate parameters are included fully, in stage f, with per-purpose JSON import and export. The global switch (`seperateParametersEnabled`) stays in Settings (MC-4043). Settles `PRESET_PROVIDER_SPEC.md` section 3.6 and stage f of section 7. Import and export are new in Studio, not classic parity (classic Settings has none).

### MC-4722 — #707: the prompt-template switch is one-way, as in classic, 2026-11-28

- Tag: decisions (maintainer via AskUserQuestion). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#707`, `MC-4030`, `MC-4031`.

**What the maintainer chose.** Studio's "use a prompt template" switch is one-way as in classic; Studio adds no "stop using template". Settles `PRESET_TEMPLATE_SPEC.md` section 2 (data rules) and section 4.6 (undo of the enabling switch).

### MC-4723 — #707: "Add item" asks for the type first, 2026-11-28

- Tag: decisions (maintainer via AskUserQuestion). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#707`, `MC-4030`.

**What the maintainer chose.** Add opens a type picker listing the types classic's select offers, and a plain item is the primary choice. Settles `PRESET_TEMPLATE_SPEC.md` section 4.1.

### MC-4724 — #710: hotkey slots get a badge and assignment in the Studio preset list, 2026-11-28

- Tag: decisions (maintainer via AskUserQuestion). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#710`, `MC-4030`.

**What the maintainer chose.** The Studio list shows a slot badge and assigns slots with the Hotkeys page's swap confirm and the same plan functions. Settles `PRESET_LIST_SPEC.md` section 4.6.

### MC-4725 — #710: Studio delete follows classic's confirm and rules; undo waits for #148, 2026-11-28

- Tag: decisions (maintainer via AskUserQuestion). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#710`, `#148`, `MC-3896`.

**What the maintainer chose.** Delete keeps classic's confirm, last-preset refusal and gone handling. There is no undo for create, copy, import or delete until #148 (restore points, Recently Deleted). Settles `PRESET_LIST_SPEC.md` section 4.4 and the undo rule in section 2.

### MC-4726 — #710: export in Studio is file and bundle export; Realm upload and compare stay in classic, 2026-11-28

- Tag: decisions (maintainer via AskUserQuestion). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#710`, `MC-4030`.

**What the maintainer chose.** Studio offers file and bundle export; Realm upload and preset compare stay in the classic editor, reached through a link. Settles `PRESET_LIST_SPEC.md` section 4.9.

### MC-4727 — #710: Studio manages preset folders, 2026-11-28

- Tag: decisions (maintainer via AskUserQuestion). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#710`, `MC-4030`.

**What the maintainer chose.** The list creates, renames, deletes and moves into folders, with grouped display. Settles `PRESET_LIST_SPEC.md` section 4.5.

### MC-4728 — #710: deleting a non-active preset keeps the active one; list management is a "Manage presets" sheet, 2026-11-28

- Tag: decisions (maintainer via AskUserQuestion). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#710`, `MC-4030`.

**What the maintainer chose.** (a) Delete of a non-active preset does not switch the active preset (a deliberate difference from classic, which switches to preset 0). (b) List management lives in a "Manage presets" sheet opened from the Presets group header. Settles `PRESET_LIST_SPEC.md` sections 2, 3 and 4.4.

### MC-4729 — #706: a Studio "off" for an optional provider setting writes classic's value and reads the union, 2026-11-28

- Tag: decisions (maintainer via AskUserQuestion, recommended option). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#706`, `MC-4720`, `MC-4721`, `MC-4030`.

**What the maintainer chose.** Switching an optional provider setting off in Studio writes what classic writes (`null` for Ooba args, `-1000` for a disableable slider), and Studio reads `null`, `-1000` and an absent key all as off. Requests already skip all three. Cause: a Gate 2 review found classic-written data holds those sentinels, so "off = key absent" mis-read it. Settles `PRESET_PROVIDER_SPEC.md` section 4.2 and `PRESET_SEPARATE_PARAMS_SPEC.md` section 2.
