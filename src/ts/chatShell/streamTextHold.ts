import holdSheet from './streamTextHold.css?raw'
import { adoptSheet } from '../gui/adoptSheet'
import { streamWroteText, subscribeStreamChanges } from '../process/activeStreams'

// The hold rule reaches the document with the first module that uses the action, before any ring paints.
adoptSheet('stream-text-hold', holdSheet)

export interface StreamTextHoldParams {
    /** The shown chat the ring belongs to; null or undefined never latches. */
    origin: { chaId: string, chatId: string } | null | undefined
}

/**
 * Marks a progress ring `data-still` once the shown chat's own stream has written its first text, so the ring
 * stops ticking while text arrives. The mark lives as long as the ring element: it never clears while mounted
 * and survives the stream's end, so a ring that outlives its stream does not resume. A ring for a different
 * origin starts over, and a new ring mounted after the first text latches at once.
 */
export function streamTextHold(node: HTMLElement, params: StreamTextHoldParams) {
    let origin = params.origin
    const check = () => {
        if (origin && !node.hasAttribute('data-still') && streamWroteText(origin.chaId, origin.chatId)) {
            node.setAttribute('data-still', '')
        }
    }
    const unsubscribe = subscribeStreamChanges(check)
    check()
    return {
        update(next: StreamTextHoldParams) {
            const changed = next.origin?.chaId !== origin?.chaId || next.origin?.chatId !== origin?.chatId
            origin = next.origin
            if (changed) {
                node.removeAttribute('data-still')
            }
            check()
        },
        destroy() {
            unsubscribe()
        },
    }
}
