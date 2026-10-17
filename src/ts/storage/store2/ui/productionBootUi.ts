import { changeLanguage } from 'src/lang'
import { markAppInitiatedReload } from 'src/ts/reloadGuard'
import type { Store2BootUi } from '../bootDispatch'
import { askBootScreen, showTerminalBootScreen } from './bootScreen.svelte'
import {
    bootLanguage, confirmConvertScreen, confirmConvertWithoutScreen, confirmFlaggedOpenScreen, confirmFromBackupScreen,
    confirmIncompleteScreen, declinedScreen, foreignMarkerScreen, offerScreen, stoppedScreen, tooNewScreen, blockedScreen,
    type BootQuestion, type BootScreenModel,
} from './bootText'

/**
 * The port the page registers for the store2 boot: every prompt is a boot screen, and a boot that stops leaves a screen
 * up. `recovery` and `peer` are still the placeholders of a build without those screens.
 *
 * Invariants:
 *  - The language is set from the browser before any screen is built, because the screens read it at build time.
 *  - A question that ends in a stop (a declined import, a waiting foreign marker, a declined or earlier flagged open)
 *    replaces its screen with the terminal "nothing was changed" screen before the answer returns, so the page never
 *    falls back to a bare loading screen.
 *  - Nothing here writes: an answer only returns to the dispatch, which decides what is written.
 *  - Informational notices are not shown here: the dispatch's result carries them and the page posts them once the
 *    database is installed. Only a notice that ends the boot (`too-new`) is a screen.
 */

export interface ProductionBootUiOptions {
    /** The reload action of the terminal screens; the real reload by default. */
    reload?: () => void
    /** The browser language tag; `navigator.language` by default. */
    browserLanguage?: string | null
    /** Whether the page can act on a "restore from a backup file" answer. Nothing can yet, so the button is hidden. */
    importAvailable?: boolean
}

function pageReload(): void {
    markAppInitiatedReload()
    location.reload()
}

function pageLanguage(): string | null {
    return typeof navigator === 'undefined' ? null : navigator.language
}

export function createProductionBootUi(options: ProductionBootUiOptions = {}): Store2BootUi {
    const reload = options.reload ?? pageReload
    const importAvailable = options.importAvailable ?? false
    const open = <T>(): Promise<T> => new Promise<T>(() => { })
    let languageSet = false

    function ensureLanguage(): void {
        if (!languageSet) {
            languageSet = true
            changeLanguage(bootLanguage(options.browserLanguage === undefined ? pageLanguage() : options.browserLanguage))
        }
    }

    function terminal(model: BootScreenModel): void {
        showTerminalBootScreen(model, (key) => {
            if (key === 'reload') {
                reload()
            }
        })
    }

    function stopped(): void {
        terminal(stoppedScreen())
    }

    async function ask<T>(build: () => BootQuestion<T>): Promise<T> {
        ensureLanguage()
        const question = build()
        const key = await askBootScreen(question.model)
        if (!Object.prototype.hasOwnProperty.call(question.answers, key)) {
            throw new Error(`The boot screen answered with an unknown button: ${key}`)
        }
        return question.answers[key]
    }

    return {
        notice: (notice) => {
            if (notice.name === 'too-new') {
                ensureLanguage()
                terminal(tooNewScreen())
            }
        },
        blocked: (blocked) => {
            ensureLanguage()
            terminal(blockedScreen(blocked))
            return Promise.resolve()
        },
        offerRestoreOrImport: (backups) => {
            ensureLanguage()
            terminal(offerScreen(backups))
            return Promise.resolve()
        },
        confirmConvert: () => ask(confirmConvertScreen),
        declined: async () => {
            const answer = await ask(() => declinedScreen(importAvailable))
            if (answer === 'import') {
                stopped()
            }
            return answer
        },
        confirmFromBackup: (backup) => ask(() => confirmFromBackupScreen(backup)),
        confirmConvertWithout: (skipped) => ask(() => confirmConvertWithoutScreen(skipped)),
        confirmIncomplete: (items) => ask(() => confirmIncompleteScreen(items)),
        confirmFlaggedOpen: async (items) => {
            const answer = await ask(() => confirmFlaggedOpenScreen(items))
            if (answer !== 'continue') {
                stopped()
            }
            return answer
        },
        foreignMarker: async (marker) => {
            const answer = await ask(() => foreignMarkerScreen(marker))
            if (answer === 'wait') {
                stopped()
            }
            return answer
        },
        recovery: (request) => {
            console.warn('[store2 boot] recovery', request.decision)
            return open<void>()
        },
        peer: {
            parkedClean: (prompt) => console.warn('[store2 boot] parked', prompt),
            decide: () => open(),
            exportThisTab: () => Promise.reject(new Error('The export is not available in this build.')),
            reload: pageReload,
        },
    }
}
