import { language } from '../lang'
import { alertError } from './alert'
import { recordCaughtError } from './caughtErrors'
import { changeChar, changeCharGeneration, type ChangeCharOutcome } from './characters'

/** The generation of the latest `changeChar`; null when it cannot be read, so the alert rule fails open. */
function readGeneration(): number | null {
    try {
        return changeCharGeneration()
    } catch {
        return null
    }
}

/**
 * Opens a character from a list row and reports a `changeChar` that throws or rejects, which would
 * otherwise reach the window's raw error alert as an unhandled rejection. Every resolved outcome passes
 * through untouched; a refused restore has already told the user.
 *
 * `changeChar` is called synchronously, before any await, so the click's own tick still runs its reset
 * and bumps the generation. A failure is always logged and recorded under `site`. It is alerted only
 * while no later `changeChar` or supersede has run since this call started, so a slow older tap that
 * the user has moved past stays silent and two joined taps show one alert. An unreadable generation
 * alerts. Never rejects.
 */
export async function changeCharOrAlert(
    site: string,
    index: number,
    arg?: Parameters<typeof changeChar>[1],
):Promise<ChangeCharOutcome | 'error'> {
    let before: number | null = null
    try {
        const pending = arg ? changeChar(index, arg) : changeChar(index)
        before = readGeneration()
        return await pending
    } catch (error) {
        console.error('Character pick failed:', error)
        recordCaughtError(site, error)
        const after = readGeneration()
        if (before === null || after === null || before === after) {
            alertError(language.errors.coldStorageRestoreUnreadable)
        }
        return 'error'
    }
}
