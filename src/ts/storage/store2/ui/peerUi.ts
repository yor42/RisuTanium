import { language } from 'src/lang'
import { alertMd, alertSelect, waitAlert, type alertData } from 'src/ts/alert'
import { escapeActionFor } from 'src/ts/alertEscape'
import { alertStore } from 'src/ts/stores.svelte'
import { get } from 'svelte/store'
import { Store2CommitRefusedError, Store2NotFlushedError, type PeerLiveState, type PeerOffer, type PeerParkPrompt, type Store2PeerHandler } from '../saveLoop'

/**
 * The in-session prompts of a page parked on a commit it did not make, and the wording of a failing save.
 *
 * Invariants:
 *  - A prompt never covers an alert that Escape closes (an error, a notice, a viewer): `decide` and `parkedClean`
 *    first wait for `acknowledged()`, because a prompt asked while such an alert is up replaces it on screen. The
 *    last check happens in the same synchronous step that asks, so nothing can be posted between them. A wait alert,
 *    a progress bar and a toast never hold a prompt.
 *  - The answer index maps over the offers that were displayed, never over `prompt.offers`: an offer left out of the
 *    buttons must not shift the others.
 *  - `parkedClean` is a closable prompt: only the Reload button reloads, and only when the live state read at the press
 *    allows it. Any other answer, Reload on a page that is no longer parked and Reload on a tab that has become dirty
 *    leave the page as it is. A tab with typed text gets the wording that says a reload discards it; text that appeared
 *    after a prompt without that wording was shown makes Reload ask again with it, never reload.
 *  - 'export-first' is shown only when the page can export; without the seam an unsaved tab has Reload (and Save mine
 *    where it is offered).
 *  - Technical text of a failed save goes to the alert's sub-message, never into the sentence the person reads.
 *  - Nothing here sets the language: a parked page already runs in the database's language.
 */

/**
 * How an export of this tab ended, as far as the prompt needs it: `saved` carries the report the writer showed (empty on
 * a plain success, whose own alert only says that inlays are not included; the hand-off prompt then shows that sentence);
 * `declined` and `failed` mean no file was kept and the writer has already told the person why.
 */
export type PeerExportResult =
    | { status: 'saved', notices: string[] }
    | { status: 'declined' | 'failed' }

export interface PeerUiOptions {
    reload: () => void
    /** Whether 'export-first' may be shown. False until the page has an export of this tab. */
    exportAvailable?: boolean
    /** Writes the export of this tab. Required for 'export-first' to do anything; without it the handler rejects. */
    exportThisTab?: (manifestKey: string) => Promise<PeerExportResult>
}

/** The alert types that wait for an OK or a close; a prompt asked over one of them would replace it. */
function holds(type: alertData['type']): boolean {
    return escapeActionFor(type) === 'close'
}

/** Resolves once the alert on screen is not one that waits for an OK (at once when none is up). */
export function acknowledged(): Promise<void> {
    return new Promise<void>((resolve) => {
        let settled = false
        let unsubscribe: (() => void) | undefined
        unsubscribe = alertStore.subscribe((value) => {
            if (settled || holds(value.type)) {
                return
            }
            settled = true
            resolve()
            // On the synchronous first call `unsubscribe` is not assigned yet; the check below covers it.
            unsubscribe?.()
        })
        if (settled) {
            unsubscribe()
        }
    })
}

/** Waits until no holding alert is up; the last check is synchronous, so the caller asks in the same step. */
async function untilClear(): Promise<void> {
    do {
        await acknowledged()
    } while (holds(get(alertStore).type))
}

function titleOf(prompt: PeerParkPrompt): string {
    const text = language.store2Boot
    const title = prompt.reason === 'replaced' ? text.peerReplacedTitle : text.peerCommitTitle
    switch (prompt.saveMineUnavailable) {
        case 'node': return `${title} ${text.peerNoSaveNode}`
        case 'replaced': return `${title} ${text.peerNoSaveReplaced}`
        case 'unloaded-characters': return `${title} ${text.peerNoSaveUnloaded}`
        case undefined: return title
    }
}

function labelOf(offer: PeerOffer): string {
    const text = language.store2Boot
    switch (offer) {
        case 'reload': return text.peerReload
        case 'save-mine': return text.peerSaveMine
        case 'export-first': return text.peerExportFirst
    }
}

export function createPeerUi(options: PeerUiOptions): Store2PeerHandler {
    const exportAvailable = options.exportAvailable ?? false

    async function decide(prompt: PeerParkPrompt): Promise<PeerOffer> {
        await untilClear()
        const displayed = prompt.offers.filter((offer) => offer !== 'export-first' || exportAvailable)
        const index = await alertSelect(displayed.map(labelOf), titleOf(prompt))
        return displayed[Number(index)] ?? 'reload'
    }

    async function askClean(prompt: PeerParkPrompt, live: () => PeerLiveState): Promise<void> {
        for (;;) {
            await untilClear()
            const text = language.store2Boot
            const warned = live().drafts
            const title = prompt.reason === 'replaced'
                ? (warned ? text.peerCleanReplacedDrafts : text.peerCleanReplaced)
                : (warned ? text.peerCleanCommitDrafts : text.peerCleanCommit)
            const index = await alertSelect([warned ? text.peerReloadDrafts : text.peerReloadOnly, text.peerKeepReading], title)
            if (index !== '0') {
                return
            }
            const now = live()
            if (!now.parked || now.dirty) {
                return
            }
            if (now.drafts && !warned) {
                continue
            }
            options.reload()
            return
        }
    }

    async function exportThisTab(manifestKey: string): Promise<'saved' | 'declined'> {
        if (options.exportThisTab === undefined) {
            throw new Error('The export is not available in this build.')
        }
        const result = await options.exportThisTab(manifestKey)
        if (result.status !== 'saved') {
            return 'declined'
        }
        // The writer's own success alert is replaced by its report, shown again here; a plain success reported only the
        // inlays sentence, which is kept. Nothing reloads on that alert, so any close of it is enough. The reload is held
        // until the answer of the prompt after it: the browser's download cannot be watched to its end from the page.
        // The prompt's text is language strings only (the report can hold names and `||`, which the select would split
        // into buttons). A select prompt is shown again when another alert covers it, and only a press of its button
        // answers it; any other close of the store asks again.
        const text = language.store2Boot
        alertMd((result.notices.length > 0 ? result.notices : [language.partialBackupInlaysNotIncluded]).join('\n\n'))
        await waitAlert()
        for (;;) {
            const index = await alertSelect([text.peerExportReloadNow], text.peerExportHandedOff)
            if (index === '0') {
                return 'saved'
            }
        }
    }

    return {
        parkedClean: (prompt, live) => {
            askClean(prompt, live).catch((error: unknown) => console.error(error))
        },
        decide,
        exportThisTab,
        reload: options.reload,
    }
}

export interface SaveFailureReport {
    toast: string | null
    /** A failure with a wording of its own: the sentence the person reads, and the technical text apart from it. */
    alert: { msg: string, submsg: string } | null
    /** A failure without one is shown as the error it is, once the attempts run out. */
    showRaw: boolean
    /** How long the loop waits before it tries again. */
    waitMs: number
}

/** What a failing save tells the person and how long the loop waits; `attempts` counts the failures in a row. */
export function describeSaveFailure(error: unknown, attempts: number, storageFull: boolean): SaveFailureReport {
    const text = language
    if (storageFull) {
        return { toast: text.saveStorageFull, alert: null, showRaw: false, waitMs: 5000 }
    }
    const technical = error instanceof Error ? error.message : String(error)
    const escalated = attempts > 4
    if (error instanceof Store2NotFlushedError) {
        return {
            toast: attempts === 1 ? text.saveNotFlushed : null,
            alert: escalated ? { msg: text.saveNotFlushed, submsg: technical } : null,
            showRaw: false,
            waitMs: 1000,
        }
    }
    if (error instanceof Store2CommitRefusedError) {
        return {
            toast: attempts === 1 ? text.saveRetrying : null,
            alert: escalated ? { msg: text.saveEscalated, submsg: technical } : null,
            showRaw: false,
            waitMs: 1000,
        }
    }
    return { toast: attempts === 1 ? text.saveRetrying : null, alert: null, showRaw: escalated, waitMs: 1000 }
}
