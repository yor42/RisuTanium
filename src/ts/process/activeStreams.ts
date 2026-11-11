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
// The length of the reply text each stream has written so far; an entry lives and dies with its stream.
const writtenChars = new Map<ActiveStream, number>()

/** Registers one stream and returns the function that removes it; removing twice is harmless. */
export function addActiveStream(stream: ActiveStream): () => void {
    const entry: ActiveStream = { ...stream }
    streams.add(entry)
    return () => {
        streams.delete(entry)
        writtenChars.delete(entry)
    }
}

/** Records the length of the text the stream of the reply `replyChatId` has written; no stream of that reply changes nothing. */
export function noteStreamText(replyChatId: string, text: string): void {
    for (const entry of streams) {
        if (entry.replyChatId === replyChatId) {
            writtenChars.set(entry, text.length)
            return
        }
    }
}

/** The characters written so far by the latest stream of the owner that has a count; null when none has. */
export function activeStreamChars(chaId: string): number | null {
    let chars: number | null = null
    for (const entry of streams) {
        if (entry.chaId === chaId) {
            chars = writtenChars.get(entry) ?? chars
        }
    }
    return chars
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

/** The owners a reply streams into now, by `chaId`; a group's speaking member is not one. */
export function activeStreamOwners(): Set<string> {
    const owners = new Set<string>()
    for (const entry of streams) {
        owners.add(entry.chaId)
    }
    return owners
}

export function resetActiveStreamsForTest(): void {
    streams.clear()
    writtenChars.clear()
}
