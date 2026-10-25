/**
 * Saves what is marked but not yet saved when the page is hidden or goes away.
 * A hidden page can be killed at any moment and its debounce may not run, so the
 * save is requested at once.
 *
 * While a 'chat' unit of work is in flight, the reply streamed so far is marked
 * and saved; the text saved is what the chat already holds at the hide. Without
 * a chat, it acts only when the page has unsaved edits, and marks nothing: a
 * page without unsaved edits is never made dirty by a hide, so a hide never
 * changes what a peer tab's commit or a parked loop sees. The save is best
 * effort, not durable: the asynchronous write may not finish if the page is
 * killed right away.
 *
 * Every flush, by hide or by Back, first asks the save loop to verdict each
 * resident at its next turn. That request marks nothing and never makes the
 * page dirty.
 */
import { activeStreams, type ActiveStream } from './activeStreams'
import { inFlightKinds, type InFlightKind } from './inFlightWork'
import { hasUnsavedSaveMarks, requestNetSweep, requestSaveNow } from '../globalApi.svelte'
import { markCharacterForSave } from '../storage/characterSaveMarks'

export interface SaveOnHideDeps {
    /** Where `visibilitychange` is heard and `visibilityState` is read. */
    doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>
    /** Where `pagehide` is heard. */
    win: Pick<Window, 'addEventListener' | 'removeEventListener'>
    kinds: () => InFlightKind[]
    streams: () => ActiveStream[]
    /** True only while an edit is marked and not yet taken by a save pass. */
    unsaved: () => boolean
    mark: (chaId: string | undefined) => void
    saveNow: () => void
    /** Asks the idle net to verdict every resident at its next turn; it marks nothing and never dirties the page. */
    sweepNet?: () => void
}

export type FlushDeps = Pick<SaveOnHideDeps, 'kinds' | 'streams' | 'unsaved' | 'mark' | 'saveNow' | 'sweepNet'>

/**
 * The one rule for leaving the page, by hide or by Back: first ask the idle net for a sweep, whatever else
 * follows; then, with a chat in flight, mark its streams and save; otherwise save only when there are
 * unsaved edits. Without a chat in flight, a page without unsaved edits is never made dirty, because the
 * save request itself marks the page dirty.
 */
export function flushBeforeLeaving(deps: FlushDeps): void {
    try {
        deps.sweepNet?.()
    } catch (error) {
        console.error(error)
    }
    if (deps.kinds().includes('chat')) {
        for (const stream of deps.streams()) {
            deps.mark(stream.chaId)
            deps.mark(stream.memberChaId)
        }
        // Marks first: each one restarts the debounce, which the request clears.
        deps.saveNow()
        return
    }
    if (deps.unsaved()) {
        deps.saveNow()
    }
}

export interface ReplyEndDeps {
    isHidden: () => boolean
    mark: (chaId: string | undefined) => void
    saveNow: () => void
}

/** The characters a reply was written to: the owner and, in a group, the speaking member. */
export interface ReplyEndOrigin {
    readonly chaId: string | undefined
    readonly memberChaId?: string | undefined
}

/**
 * A hidden page's timers may be stopped, so the debounce behind an ordinary mark never runs and a
 * finished reply would wait for the page to be shown again. At a reply's end, while the page is
 * hidden, mark the origin explicitly (the stream's registry entry is already gone, and the selection
 * may have moved) and request the save at once. A visible page does nothing: its debounce runs.
 * It only adds marks and a request, never removes either; the save stays best effort, as above.
 */
export function flushReplyEndWhenHidden(deps: ReplyEndDeps, origin: ReplyEndOrigin): void {
    if (!deps.isHidden()) {
        return
    }
    deps.mark(origin.chaId)
    deps.mark(origin.memberChaId)
    // Marks first: each one restarts the debounce, which the request clears.
    deps.saveNow()
}

function pageIsHidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

/**
 * The page's reply-end flush, for the send path. A visible page returns before any persistence
 * entry point is touched; a failure of the flush never fails the send.
 */
export function flushPageReplyEndWhenHidden(origin: ReplyEndOrigin): void {
    if (!pageIsHidden()) {
        return
    }
    try {
        flushReplyEndWhenHidden({ isHidden: pageIsHidden, mark: markCharacterForSave, saveNow: requestSaveNow }, origin)
    } catch (error) {
        console.error(error)
    }
}

/** Installs the listeners; the returned function removes them. */
export function installSaveOnHide(deps: SaveOnHideDeps): () => void {
    const onHide = (): void => {
        flushBeforeLeaving(deps)
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

// Read when used, not at module load: the send path imports this module, and a suite that replaces
// the persistence module must not have to provide every export for a visible page.
function pageFlushDeps(): FlushDeps {
    return {
        kinds: inFlightKinds,
        streams: activeStreams,
        unsaved: hasUnsavedSaveMarks,
        mark: markCharacterForSave,
        saveNow: requestSaveNow,
        sweepNet: requestNetSweep,
    }
}

/** The page's flush: the same rule the hide listeners apply. */
export function flushPageBeforeLeaving(): void {
    flushBeforeLeaving(pageFlushDeps())
}

/** Installs the page's one hide listener pair. */
export function startSaveOnHide(): () => void {
    return installSaveOnHide({
        doc: document,
        win: window,
        ...pageFlushDeps(),
    })
}
