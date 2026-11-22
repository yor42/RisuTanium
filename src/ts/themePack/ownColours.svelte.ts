// The one value that decides whether the escape controls and Settings paint the app's own colours instead of an applied
// theme pack's: `on`. Only `updateColorScheme` writes it; it is never persisted. `verdict` is the judge's readability or
// contrast outcome for the painted pack sheet, `settingsOpen` the open/close edge of Settings and `vars` the own scheme's
// root custom properties, which an island re-declares. This module imports nothing, so the colour code, the pack driver and
// the island action can all read it without a cycle.

/** The judge's warning categories that make a pack's colours untrusted. `layout` never triggers. */
export const OWN_COLOUR_RULES: ReadonlySet<string> = new Set(['contrast', 'readability'])

/** True when one warning belongs to a category that triggers own colours. */
export function triggersOwnColours(warnings: readonly { rule?: string }[]): boolean {
    return warnings.some((warning) => warning.rule !== undefined && OWN_COLOUR_RULES.has(warning.rule))
}

export const ownColours: { verdict: boolean, settingsOpen: boolean, on: boolean, vars: Record<string, string> } = $state({
    verdict: false,
    settingsOpen: false,
    on: false,
    vars: {},
})

/** Test seam. */
export function resetOwnColoursForTests(): void {
    ownColours.verdict = false
    ownColours.settingsOpen = false
    ownColours.on = false
    ownColours.vars = {}
}
