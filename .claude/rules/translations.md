---
paths:
  - "src/lang/*.ts"
---

en.ts is the source; sonnet-coder owns English source/call-site changes. Translator owns named keys in ko, cn, zh-Hant, ja, vi, de and es, Korean included (MC-058). The write guard still refuses translator writes to ja.ts (and translator writes inside worktrees) until #384 or a guard fix lands; meanwhile the translator returns those strings as a scratch packet and the session applies them. Preserve the maintainer's English/Korean changes; do not revert, normalize or reword unrelated keys.
Preserve key paths/order, interpolation expressions and function signatures, CBS/syntax tokens, HTML/code/URLs, escaping, newline/concatenation structure and line endings. Translation may move an interpolation for grammar but cannot change its expression.
Warnings and consent retain every consequence and full force. Translate ambiguous English faithfully and report the ambiguity or low-confidence wording; do not quietly fix product meaning.
Use named-file/key ownership and relevant key/interpolation parity plus type checks under [gates](../../docs/workflow/gates.md). No rule grants edits beyond the accepted brief.
