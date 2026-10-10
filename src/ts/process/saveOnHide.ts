/**
 * Saves the reply streamed so far when the page is hidden or goes away while a
 * reply is being generated. A hidden page can be killed at any moment and
 * its debounce may not run, so the reply that is marked now is saved at once.
 *
 * It acts only while a 'chat' unit of work is in flight. The text saved is what
 * the chat already holds at the hide; nothing is flushed here. It is best
 * effort: the asynchronous write may not finish if the page is killed right away.
 */
import { activeStreams, type ActiveStream } from './activeStreams'
import { inFlightKinds, type InFlightKind } from './inFlightWork'
import { requestSaveNow } from '../globalApi.svelte'
import { markCharacterForSave } from '../storage/characterSaveMarks'

export interface SaveOnHideDeps {
    /** Where `visibilitychange` is heard and `visibilityState` is read. */
    doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>
    /** Where `pagehide` is heard. */
    win: Pick<Window, 'addEventListener' | 'removeEventListener'>
    kinds: () => InFlightKind[]
    streams: () => ActiveStream[]
    mark: (chaId: string | undefined) => void
    saveNow: () => void
}

/** Installs the listeners; the returned function removes them. */
export function installSaveOnHide(deps: SaveOnHideDeps): () => void {
    const onHide = (): void => {
        if (!deps.kinds().includes('chat')) {
            return
        }
        for (const stream of deps.streams()) {
            deps.mark(stream.chaId)
            deps.mark(stream.memberChaId)
        }
        // Marks first: each one restarts the debounce, which the request clears.
        deps.saveNow()
    }
    const onVisibility = (): void => {
        if (deps.doc.visibilityState === 'hidden') {
            onHide()
        }
    }
    deps.doc.addEventListener('visibilitychange', onVisibility)
    deps.win.addEventListener('pagehide', onHide)
    return () => {
        deps.doc.removeEventListener('visibilitychange', onVisibility)
        deps.win.removeEventListener('pagehide', onHide)
    }
}

/** Installs the page's one hide listener pair. */
export function startSaveOnHide(): () => void {
    return installSaveOnHide({
        doc: document,
        win: window,
        kinds: inFlightKinds,
        streams: activeStreams,
        mark: markCharacterForSave,
        saveNow: requestSaveNow,
    })
}
