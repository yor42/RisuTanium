// The persistent turn-off of the active theme pack: the one write the pack escape makes. It imports only leaves (the scheme
// restore, the id writer and the boot window), never install.ts, the driver, the apply core or the judge client, so the
// banner path stays light and works when the driver chunk failed to load.
import { leavePackScheme } from '../gui/colorscheme'
import { markBootWrite } from '../bootWindow'
import { setActiveThemePack } from './activeThemePackId'

let packRequestCanceller: (() => void) | null = null

/** The driver registers how a pending turn-on request is dropped, so this module imports nothing from the driver. */
export function registerPackRequestCanceller(canceller: (() => void) | null): void {
    packRequestCanceller = canceller
}

/**
 * Turns the pack off for good: drops a pending turn-on, restores the user's own scheme, deletes the active id and marks the
 * write. `markBootWrite` is correct at any time: before the boot window closes it is answered as unsaved work when the change
 * effects register, and after it a save is requested at once, so a marked pass follows either way and writes the deletion even
 * when the effects' first run took it into their baseline. Never call it on a read-only page.
 */
export function turnOffThemePack(): void {
    packRequestCanceller?.()
    leavePackScheme()
    setActiveThemePack(undefined)
    markBootWrite()
}
