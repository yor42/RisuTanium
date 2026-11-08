import { HOME_MODES, shownModes, type HomeMode, type ModeState } from 'src/ts/storage/homeModes'

/** The modes whose Home content exists. The others are held: listed, inert, tagged "coming later". */
export const BUILT_HOME_MODES: readonly HomeMode[] = ['rp']

export type SwitcherEntry = {
    mode: HomeMode
    /** Not built yet: shown disabled with the "coming later" tag. */
    held: boolean
    /** The mode whose content Home is showing. */
    current: boolean
}

/**
 * The switcher's entries, in canonical mode order, from `shownModes` only; the mode fields are
 * never written here.
 *
 * - One shown mode: no switcher (empty list).
 * - While Roleplay is the only built mode, Roleplay stays listed even when `shownModes` omits it,
 *   because its content and entry are all Home has. Hiding Roleplay applies once another mode is
 *   built.
 */
export function switcherEntries(state: ModeState, built: readonly HomeMode[] = BUILT_HOME_MODES): SwitcherEntry[] {
    const shown = shownModes(state)
    if (shown.length <= 1) {
        return []
    }
    const keepRoleplay = built.length === 1 && built[0] === 'rp'
    const listed = HOME_MODES.filter((mode) => shown.includes(mode) || (keepRoleplay && mode === 'rp'))
    const current = listed.find((mode) => built.includes(mode))
    return listed.map((mode) => ({
        mode,
        held: !built.includes(mode),
        current: mode === current,
    }))
}
