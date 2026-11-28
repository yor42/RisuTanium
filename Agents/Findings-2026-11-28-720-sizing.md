# #720 sizing: repair action for lorebook elements that are not entries (2026-11-28)

Refs #720 (follow-up to #685, MC-4081). Sizing only; no build until S6a (the Studio history-core slot) has merged. Source: origin/main at 2fe891359.

## Verdict

The repair needs the Studio history-core slot (objectListOps, ownerHistory, studioSetters, fieldRegistry, historyModel, objectLists, studioHistoryService, studioHistoryStore). Tier 2, and a critical contract (see below): independent Gate 1 plan review, `opus-reviewer` at Gate 2.

## Why

- A lorebook list can hold a live element that is `null`, a string, a number or an array. S7 renders it as an inert row (`src/lib/Studio/StudioLoreList.svelte`, `data-part="studio-lore-row-inert"`, key `studioLoreNonEntryRow`) with no actions; data is untouched (MC-4081, T59 in `docs/design/studio/S7_LORE_SPEC.md`).
- The history op family cannot name such an element. `src/ts/studio/history/objectListOps.ts`: `ObjEntry = JsonObject` (line 51); `ObjRemoveOp` and `ObjInsertOp` carry `entry: ObjEntry`, `counts` and an identity (`identitiesOf` / `entryAnchor` read an object's id, folder key or content hash; non-objects hold none, see `holdersOf`). The parser (`objRemove` case, ~524-541), planner (~777-787) and apply (~906-918) assume an object entry. An undoable remove therefore needs either a widened entry type with an anchor by position plus canonical JSON of the element, or a new op shape.

## Critical contract named

Persisted history-record format and its replay (op shape, parser, planner, identity/anchor rules). A change here can make older records unreadable or mis-replay; the record shape must stay readable by builds without it (MC-350 applies to saved Android data). Failure scenario: a visit removes a `null` element, the record is saved, the app reloads; the record must parse, undo must reinsert the same element at the same position, and a record with the new shape must be refused cleanly, not misapplied, by an older reader.

## Files expected

History-core slot: `objectListOps.ts` (op shape, parser, canonical form), `objectLists.ts` and `studioSetters.ts` (the list's write path), `ownerHistory.ts`/`historyModel.ts` (labels, journal), `fieldRegistry.ts` only if a field entry is added. Outside the slot: `StudioLoreList.svelte` (a remove control on the inert row, replacing "no actions"), `en.ts` plus all 7 locales (repair label, confirm, history label; localeParity), tests, `S7_LORE_SPEC.md` amendment (T59 currently pins "no row menu, no op").

## Open decisions for the maintainer (before the plan)

1. Action set: undoable remove only (the ticket's example) or also "convert to an empty entry".
2. Whether the regex follow-up from #684 shares the same op shape (the ticket says to coordinate), so one widened shape serves both lists.
3. Format compatibility: a widened shape in saved history must be forward-readable (MC-350); confirm acceptable that an older build refuses such a record.

## Tests expected

Regression: remove a non-entry element, undo and redo restore it in place for each of `null`, string, number, array; the record round-trips through the store protocol (`diffEntry`/`applyEdits`, T57-style); a concurrent edit to a neighbouring entry still replays; T59 updated (repair control present, other behaviour unchanged). Guard: object-entry ops unchanged.

## Waits on

S6a merge (it holds the history-core files). Then lane A starts a fresh session for the plan and build.
