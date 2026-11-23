# #233 stage handoff: preset toggles link (2026-11-24)

## 1. Completed PR
- One PR on `claude/233-preset-link-3618a0`, body `Closes #233`. Tier 1, no stage follows.

## 2. Decisions
- MC-4100 (`Agents/mc/233.md`): the link targets the active preset only; hidden without a valid `botPresets[botPresetsId]`.
- `ToggleLinkOwner` gained `{ type: 'preset' }`. The Studio owner id is `String(botPresetsId)`, the model's index id. No history-core file is touched.

## 3. Changed files
- `src/ts/studio/studioToggleLinks.ts`, `src/lib/Setting/Pages/PromptSettings.svelte` (mount under the toggle field), `studioToggleLinks.test.ts` (GL-5 rows), and a `StudioToggleLink` mock in the four PromptSettings tests (their stores mock lacks `settingsOpen`).

## 4. Evidence
- vitest: studioToggleLinks and PromptSettings tests, 5 files / 28 tests pass. svelte-check: 0 errors.

## 5. Unresolved
- None. Device row not needed: the link reuses the module/character link component and open path.
