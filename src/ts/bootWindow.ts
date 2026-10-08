/**
 * The boot window: from the moment `saveDb()` starts until the change effects
 * are registered. `encoder.init` yields while it encodes, so the UI is live
 * and the person can act while nothing watches the database yet.
 *
 * Two things from the window are invisible to the effects, which first run
 * after it: a character that was selected and edited in place and then left,
 * and whether any of it is unsaved work. This module records both and answers
 * them once, synchronously, when the effects are registered. The answer is
 * "unsaved" when the person gave trusted input, a boot-time import wrote to the
 * database, a plugin panel was used, or the recording itself failed: a peer's
 * save then asks instead of reloading the tab.
 *
 * Nothing here may throw into the save loop, into Svelte's shared store
 * subscriber queue (one throwing subscriber stops every later store
 * notification) or into an event dispatch.
 */
import { selectedCharID } from "./stores.svelte"
import { getPluginPanelShownCount, isPluginPanelOpen } from "./process/memory/busyActions"

/**
 * Events only a person causes. `wheel` is left out on purpose: scrolling edits
 * nothing, and a scrolled list would make every boot look unsaved.
 */
const INPUT_EVENTS = [
    'pointerdown', 'touchstart', 'click', 'keydown', 'beforeinput', 'input', 'change', 'drop', 'paste', 'cut',
] as const

let bootWriteSeen = false
let markUnsavedAfterWindow: (() => void) | null = null

/**
 * Every import in characterCards.ts that is about to add a character, module or preset calls this,
 * for the whole page life. Before the window closes the write is remembered for
 * the window's answer, because an effect's first run cannot tell it from the
 * state the effects started from. After the window closes the save loop is asked
 * for a save and the tab counts as unsaved: the request is redundant with the
 * effects once they have run, and it covers a write that lands before their first
 * run. It errs toward a save: an import that fails after the mark only costs an
 * empty pass, or a prompt instead of a quiet reload if a peer saves first.
 * Never throws.
 */
export function markBootWrite(): void {
    if (markUnsavedAfterWindow === null) {
        bootWriteSeen = true
        return
    }
    try {
        markUnsavedAfterWindow()
    } catch (error) {
        console.error(error)
    }
}

export interface BootWindowOptions {
    getCharacters: () => ReadonlyArray<{ chaId?: string }> | undefined
    /** Called by any import write that lands after the window closed. */
    markUnsaved: () => void
}

export interface BootWindowAnswer {
    /** Whether the window held anything that counts as unsaved work. */
    unsaved: boolean
    /** The chaId of every character that was selected during the window, in selection order. */
    selectedChaIds: string[]
}

export interface BootWindow {
    /** Removes the listener and the subscription and answers. Idempotent. */
    close(): BootWindowAnswer
}

export function openBootWindow(options: BootWindowOptions): BootWindow {
    let failed = false
    let sawInput = false
    const selected = new Set<string>()
    let panelOpenAtStart = false
    let panelsShownAtStart = 0
    try {
        panelOpenAtStart = isPluginPanelOpen()
        panelsShownAtStart = getPluginPanelShownCount()
    } catch {
        failed = true
    }

    const onInput = (event: Event) => {
        try {
            if (event.isTrusted === true) {
                sawInput = true
            }
        } catch {
            sawInput = true
        }
    }
    try {
        for (const type of INPUT_EVENTS) {
            window.addEventListener(type, onInput, { capture: true, passive: true })
        }
    } catch {
        failed = true
    }

    // An index of -1 is "no selection" and records nothing; any other index
    // that names no character with an id is a failure of the recording.
    let unsubscribe: (() => void) | null = null
    try {
        unsubscribe = selectedCharID.subscribe((index) => {
            try {
                if (index === -1) {
                    return
                }
                const chaId = options.getCharacters()?.[index]?.chaId
                if (typeof chaId === 'string' && chaId !== '') {
                    selected.add(chaId)
                } else {
                    failed = true
                }
            } catch {
                failed = true
            }
        })
    } catch {
        failed = true
    }

    let answer: BootWindowAnswer | null = null
    return {
        close() {
            if (answer !== null) {
                return answer
            }
            try {
                unsubscribe?.()
            } catch { /* nothing is left to release */ }
            for (const type of INPUT_EVENTS) {
                try {
                    window.removeEventListener(type, onInput, { capture: true })
                } catch { /* never installed */ }
            }
            let panelUsed: boolean
            try {
                panelUsed = panelOpenAtStart || getPluginPanelShownCount() !== panelsShownAtStart || isPluginPanelOpen()
            } catch {
                panelUsed = true
            }
            // Read and handed over in one step: a write that lands after this
            // line reaches the save loop, one that landed before it is in the flag.
            const bootWrite = bootWriteSeen
            markUnsavedAfterWindow = options.markUnsaved
            answer = {
                unsaved: failed || sawInput || bootWrite || panelUsed,
                selectedChaIds: [...selected],
            }
            return answer
        },
    }
}

export function resetBootWindowForTest(): void {
    bootWriteSeen = false
    markUnsavedAfterWindow = null
}
