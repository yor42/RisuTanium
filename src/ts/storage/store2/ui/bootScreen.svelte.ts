import { ANSWER_GUARD_MS } from 'src/ts/alertPrompts'
import type { BootScreenModel } from './bootText'

/**
 * The one boot screen the page shows before the application exists. The screen is a value: `App.svelte` shows it for as
 * long as it is set and the database is not loaded, and the port replaces it with the next screen or leaves it up.
 *
 * Invariants:
 *  - Answering a question never clears the screen. The screen stays (its buttons off, a working line on) until the port
 *    shows the next one or the page loads, so no answer can leave a bare loading screen.
 *  - A press within `ANSWER_GUARD_MS` of the screen appearing, or of the screen replacing another, is discarded; a press
 *    after the first answer is discarded too. Nothing else answers a question: no key, backdrop or Back handler exists here.
 *  - The view is a raw state: a screen that lists thousands of names is read, never proxied.
 */

export interface BootScreenView {
    model: BootScreenModel
    /** A `performance.now()` reading taken when this screen was set. */
    shownAt: number
    /** True once a question has been answered; its buttons are off. */
    answered: boolean
    /** Called with the key of a pressed button that passed the guard. */
    onPress: (key: string) => void
}

let view = $state.raw<BootScreenView | null>(null)

export function getBootScreen(): BootScreenView | null {
    return view
}

/** Shows a question and resolves with the key of the button that answers it. The screen is left set. */
export function askBootScreen(model: BootScreenModel): Promise<string> {
    return new Promise<string>((resolve) => {
        const asked: BootScreenView = {
            model,
            shownAt: performance.now(),
            answered: false,
            onPress: (key) => {
                if (view !== asked || asked.answered) {
                    return
                }
                view = { ...asked, answered: true }
                resolve(key)
            },
        }
        view = asked
    })
}

/** Shows a screen that is never answered: its buttons act directly (the Reload button reloads). */
export function showTerminalBootScreen(model: BootScreenModel, onPress: (key: string) => void): void {
    view = { model, shownAt: performance.now(), answered: false, onPress }
}

/** A press from the screen's own button: discarded inside the guard window, otherwise passed to the screen. */
export function pressBootButton(key: string): void {
    const current = view
    if (current === null || current.answered) {
        return
    }
    if (performance.now() - current.shownAt < ANSWER_GUARD_MS) {
        return
    }
    current.onPress(key)
}

/** The page has loaded or no longer needs the screen. */
export function clearBootScreen(): void {
    view = null
}

export function resetBootScreenForTests(): void {
    view = null
}
