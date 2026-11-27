### MC-4470 — Upstream sync e81b12038: inlay creation time hand-ported, upstream recorded with an ours merge

Upstream range `979bb8d27..e81b12038` (14 commits) is one feature, upstream PR #1259 "Record inlay creation timestamp". Following MC-2976 (precedent MC-2341), the change was ported by hand onto the fork's inlayStore-based writers and upstream was then recorded as merged with `git merge -s ours`, so the PR must be merged with a merge commit to keep the upstream parent. No GitHub issue was opened (as for #695, #699 and #775); the PR body says so. Details and the hash mapping are in the 2026-11-27 section of `Agents/Upstream-Merges.md`.

### MC-4471 — Inlay `created` is an optional additive record field; unknown date is a localized key

`created` (ms since epoch) is stamped by every fork writer of a new inlay (audio/video attachments, `writeInlayImage`, `saveInlayedSignature`, the Gemini audio write) and kept by copies and `.bin`/`.rtb` restores. It lives in the record's `fields` map, which `.bin` and `.rtb` carry verbatim, so there is no migration or format step (MC-175, MC-774); inlays stored earlier have none. The explorer shows "(unknown date)" for them through the new key `playground.inlayUnknownDate` in all 8 locales, where upstream hardcodes English (MC-058).
