---
paths:
  - "src/**/*.svelte"
  - "src/**/*.svelte.ts"
---

DBState is a rune-based plain reactive object: DBState.db, never $DBState. Legitimate writable-store subscriptions remain valid. Use Svelte 5 runes where the surrounding reactive design requires them; do not hide type errors behind any or un-narrowed unknown.
Use custom colors from src/styles.css: textcolor, textcolor2, bgcolor, darkbg, darkbutton, selected, borderc, darkborderc and draculared. Opacity modifiers are supported. Open colorscheme.ts only for theme-related work.
Preserve existing edits and each file's line endings. Hand-match surrounding style; no whole-file formatter. Comments state invariants and consequences, not investigation history or repository line numbers.
Verify load-bearing framework behavior in resolved source rather than infer tracking depth or snapshot cost. Follow the existing [independent gates](../../docs/workflow/gates.md) and [ownership](../../docs/workflow/ownership.md); this rule does not replace them.
