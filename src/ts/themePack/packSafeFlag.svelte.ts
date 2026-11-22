// Pack safe mode: the one in-memory switch that paints the user's own scheme and keeps every theme pack sheet off, so a pack
// that makes the app unusable can be left. This module is a leaf (it imports only svelte's rune) so the colour code can read
// it before any pack code loads. The flag is never persisted; a page reload without the URL flag starts with it off.

export type PackSafeSource = 'url' | 'boot' | 'shortcut'

/** The URL flag `?nothemepack` turns the flag on at module load, which is before the first `updateColorScheme()` of boot. */
function urlFlagOn(): boolean {
    try {
        return typeof location !== 'undefined' && new URLSearchParams(location.search).has('nothemepack')
    } catch {
        return false
    }
}

export const packSafe: { on: boolean, source: PackSafeSource | null } = $state(
    urlFlagOn() ? { on: true, source: 'url' } : { on: false, source: null },
)
