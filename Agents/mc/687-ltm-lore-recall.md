### MC-4010 — ChroMemory lore recall ships with `searchLore` default off, 2026-11-23

- Tag: decisions (maintainer via AskUserQuestion in the #687 session). Date: 2026-11-23. Related: `#687`, `MC-2590`, `MC-2594`, `MC-2597`, `MC-2600`.

**What was asked.** Whether `ltmSettings.searchLore` should default on or off. The usefulness gate ran on synthetic lore (seed B, tau 0.02, one recalled entry per send): English precision 0.78, hit rate 0.24, recall on no-relevant turns 0.31; Korean precision 0.38, hit rate 0.22, no-relevant recall 0.38. The proposed pass rule (precision >= 0.6, no-evidence recall <= 0.2, hit rate >= 0.3) failed in both languages. Source: `Agents/Tools/ltm-eval/s4` harness.

**What the maintainer chose.** "Default off (Recommended)". `searchLore` stays opt-in; the spec's fallback ("ships default-off") applies.

### MC-4011 — Recalled lore is not covered by the final recheck's last resort; accepted as a known limitation, 2026-11-23

- Tag: decisions (maintainer via AskUserQuestion in the #687 session). Date: 2026-11-23. Related: `#687`, spec section 4.

**What was asked.** Post-assembly growth of the prompt (Lua `editRequest`, a `depth_prompt` change, random CBS) can push a send that carries recalled lore over the final recheck, which empties only the memory block. A send that fits without ChroMemory could then fail, but only when that growth exceeds the kept history plus slack. Alternative: tag recalled lore chats and let `recheckToContext` drop them (touches prompt merging).

**What the maintainer chose.** "Accept limitation (Recommended)". Named in the PR body; tag-and-drop is deferred.
