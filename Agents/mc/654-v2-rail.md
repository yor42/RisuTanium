### MC-5164 — #654: the rail and persona "+" button reads the scheme text colour, 2026-11-28

- Tag: findings. Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`.

**What the maintainer chose.** Nothing new. `BaseRoundedButton.svelte` hard-coded `text-gray-300`, which read 1.2 to 1.5:1 on every light scheme (light 1.47, sky-light 1.41, monokai-light 1.38 on the page ground). It now uses `text-textcolor` (and `hover:border-textcolor`), not `text-textcolor2` as K3 suggested: textcolor2 reads only 1.73:1 on the nature scheme's sidebar ground and 3.99 on monokai-light's, while textcolor reads 6 or better on both grounds in all 17 presets and never worse than gray-300 did.

**Consequence.** Two consumers: the sidebar rail "+" and the persona "+". Dark schemes keep a near-white glyph (their textcolor). Home's "+" (CharacterSimpleList) and the held-mode "Coming later" notes are untouched.
