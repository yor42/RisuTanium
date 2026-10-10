/**
 * The reply streams this page is writing right now. A stream is added in the
 * same synchronous block that sets the chat's `isStreaming` and removed in the
 * block that clears it, so a view that already re-runs on `isStreaming` sees
 * the registry change with it. The registry itself is not reactive.
 *
 * Leaf module: it imports nothing from the chat pipeline.
 */

export interface ActiveStream {
    /** The character that owns the chat the reply is written to. */
    readonly chaId: string
    /** The speaking member of a group, when the owner is a group. */
    readonly memberChaId?: string
    /** The `chatId` of the reply message being written. */
    readonly replyChatId: string
}

const streams = new Set<ActiveStream>()

/** Registers one stream and returns the function that removes it; removing twice is harmless. */
export function addActiveStream(stream: ActiveStream): () => void {
    const entry: ActiveStream = { ...stream }
    streams.add(entry)
    return () => {
        streams.delete(entry)
    }
}

export function activeStreams(): ActiveStream[] {
    return [...streams]
}

/** True while a stream is writing the reply whose `chatId` is given. */
export function isActiveStreamReply(chatId: string | undefined): boolean {
    if (chatId === undefined) {
        return false
    }
    for (const entry of streams) {
        if (entry.replyChatId === chatId) {
            return true
        }
    }
    return false
}

export function resetActiveStreamsForTest(): void {
    streams.clear()
}
