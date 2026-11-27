### MC-4600 — Guided persona builder built as designed (ticket #252, CHORE-326)

The builder of `docs/design/settings/PERSONA_BUILDER.md` (approved revision 1, MC-4530 to MC-4535) is implemented: "+ Persona" menu item "Create with guide", three steps (who you are, tell characters about you, check and finish), a sticky footer with 44 px buttons, and live writes through the existing `createPersona`/`editPersona`/`selectUserImg`. It adds no stored field, no format step and no change to `personaList.ts` or the export path (MC-175). Sized Tier 1: a UI flow over the existing write path, no persisted-field, shared-write-path or dirty-tracking change.

### MC-4601 — Builder leaves the persona note to the editor

The design says step 3 shows the note field "only when the advanced persona note is on". The page has no such flag: the editor shows the note field always, and no `personaNote` setting is read anywhere in `src` (the `personaNote` language key is only a label). The builder therefore has no note field and the editor stays the place for it. This matches the design's own rule that the builder writes `note` only when that setting is on, and it makes the builder never write `note`.

### MC-4602 — Back, cancel and Keep/Delete behavior fixed by the build

Settings Back and the on-screen back go one step, and leave the builder from step 1, through the page's existing sub-level registration. The step 2 to 3 recomposition is `recomposeDecision` in `ts/settingsShell/personaBuilder.ts`: an unchanged composition does nothing, a changed one replaces a text that still equals the last offered composition, and asks ("Replace" or "Keep as is") over a hand-edited one. Cancel on an untouched persona (default name, no picture, empty text and note) removes it with the ordinary undo toast; otherwise it asks Delete or Keep, and the dialog's own dismissal means Keep, which is the non-destructive answer. Choosing another card while the builder is open leaves the builder and keeps the persona as it is.

### MC-4603 — New strings and Korean wording

27 `settingsShellPersonaGuided` and `settingsShellPersonaBuilder*` keys ship in en.ts and all 7 locales (MC-058). The Korean menu item, buttons, confirms and use hint are the design document's own words. The step titles, field labels, helpers and the four example placeholders have no wording in the design, so the translator wrote them; the maintainer may reword them (keys stay).

### MC-4604 — Theme parts

No new `data-part` is added: the builder uses plain `data-persona-builder*` attributes, so the theme-part census (`areaParts.ts`) is unchanged.

### MC-4605 — Typed step 2 answers are kept when the builder is left

Step 2 answers reach the persona only on "Next", so a persona can look untouched while the person has typed into step 2. The builder reports typed input (`hasInput`), and Cancel then asks instead of removing the persona. When the builder is left by Keep, by choosing another card, or by the page unmounting (Settings switches or closes pages with a keyed block), `flush` writes the composed answers into the description, but only while no composition was offered yet and the description is still empty. A text the person emptied or edited on step 3 is therefore never refilled or overwritten. Found by Gate 2 rounds 1 and 2; Gate 2 round 3 passed. The remaining accepted limit: choosing another card with nothing typed leaves a blank default-named persona, like opening "Create new" and walking away.
