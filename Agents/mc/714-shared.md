### MC-4867 — #714 Studio edits a module whose id another slot shares; #713 inert regex rows are removable, 2026-11-28

- Tag: decision (maintainer rulings asked in this session through lane A, plus the #713 ruling lane A asked to record here). Date: 2026-11-28. Exact times: UNKNOWN. Related: `#714`, `#713`, `#684`, `MC-4866`, `MC-329`, `MC-350`.

**What was decided (#714).**
- Studio edits only the FIRST holder of a shared module id (the lowest slot index). A later copy (`id#n`) opens read-only with one neutral note that says Studio edits only the first module with this ID and that this copy may or may not be used depending on what turns it on.
- A later copy is made editable only by an explicit button, "Give this copy its own ID". It gives that one row a fresh id (v4) and changes nothing else: the first module keeps its id, nothing that turns the old id on is rewritten, and the copy is then on only where the user turns it on or where its namespace is used. The selection follows the copy to its new id. There is no undo for it (the module list changed; the helper refuses with a toast when the list changed under it).
- The classic module screen keeps its link-out for shared ids. A `.bin` exported afterwards carries the new id; that is accepted.
- Update-All keeps the reason `sharedId` for a later copy that a namespace turns on, with its existing text; it resolves owners by slot.
- Accepted: a namespace reference can still select a later copy at runtime. The help text names that.
- Removed keys: `studioRefusalModuleSharedId`, `studioAssetModuleSharedId`. Added keys: `studioModuleSharedIdCopy`, `studioModuleOwnId`, `studioModuleOwnIdHelp`, `studioModuleOwnIdRefused`.

**What was decided (#713, recorded here at lane A's request).** An inert (non-object) regex row can be removed from the Studio regex list ("Remove entry"); it is one history step and undo restores it in place.

**Why.** Editing the later copy by raw id would have written the wrong row, and refusing every shared id left real data uneditable. First-holder editing matches what the runtime resolves; the explicit re-id is the only way to reach a later copy, so no row is renamed without the user asking.

**Contract.** The persisted module id of one row changes. store2 keeps handling `X#n` handles shifting after a re-id; dirty tracking marks `tracker.modules` through the slot assignment. The history store version stays 2 and no key shape changes (`module:<rawId>` stays).

**For the maintainer.** The three new ko strings (`studioModuleSharedIdCopy`, `studioModuleOwnIdHelp`, `studioModuleOwnIdRefused`) and `studioModuleOwnId` were drafted by the translator and are NOT final; please review the Korean wording.
