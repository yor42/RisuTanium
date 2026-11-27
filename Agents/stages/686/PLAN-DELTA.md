# Plan r4 delta (orchestrator), answering Gate 1 round 4 (gate1r4.md findings 1-5)

Plan = plan-r4.md plus this file. Where they differ, this file wins.

1. (SUBSTANTIVE) `openStudio` group normalisation (r4 Stage 2 item 8): when the target's owner is normalised to `type:'group'` and the target names no `kind`, set `kind:'basic'`. Character targets stay byte-identical (I10). Tests (T31): for each of the three entries (More menu, the CharConfig entry row, This chat) after a flush `StudioGroupForm` is mounted and `studio-detail-readonly` is absent. New mutant M35: group normalisation leaves `kind` undefined -> killed by T31.
2. (M34/T33) T33 first asserts, after a flush with the selection unchanged, that `studioScreen.open` is still true; only then changes the selection and asserts the visit closes. M34 is also mapped to T31's "open the group visit" row (asserts after a flush).
3. (`groupFormLive`) Its own branch in StudioDetail's if/else-if chain, ahead of the `!toggleBuilderLive` read-only fallback; NOT part of `formLive` (no `StudioStatusChip`, OQ-f). T30 asserts no `studio-detail-readonly` and no status chip.
4. (R4 list) Add `readUpdateReach` (`toggleUpdateAllDb.ts:43`) to the Gate 2 consumer check: for a group chaId it now gets the one-node model, still ends `unreached: 'restricted'`, unreachable in a group visit.
5. (`studioVisitKind`) returns `'group'` only for `type === 'group'` and `'character'` for anything else, so `studioEligible()` stays identical for every input (I10).
