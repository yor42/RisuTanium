### MC-5163 — #654: a committed code block keeps the highlighter's dark ground under a pack, 2026-11-28

- Tag: findings. Date: 2026-11-28. Exact times: UNKNOWN. Related: `#654`, `MC-3421`.

**What the maintainer chose.** Nothing new. Of the two corrections K2 proposed, the app-side fixed ground is the smaller: no new role, no pack control, no validator or scope change. A settable `--color-code-bg` would need a new pack surface and a product choice, so it is not built.

**Consequence.** `ShellMessage.svelte` gives `pre.hljs` the highlighter's own ground (#282c34) and text (#abb2bf) while a pack base is on. Against a white bubble before and after: keyword 2.94 to 4.75, string 2.02 to 6.94, title and bullet 2.39 to 5.86, plain text 4.5 or better. Comments (#5c6370) are 2.32 on the dark ground, the app's own default; they were 6.05 on white.

**Amended after CI.** `chatShellCss.test.ts` refuses colour literals in ChatShell style blocks, so the two colours live as app tokens `--color-code-block-bg` and `--color-code-block-text` in `chat-tokens.css` and the rule reads them. They are app tokens, not pack-settable; `chatTokens.test.ts` count 345 to 347.
