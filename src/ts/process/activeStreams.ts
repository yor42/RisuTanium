/**
 * The reply streams this page is writing right now. A stream is added in the
 * same synchronous block that sets the chat's `isStreaming` and removed in the
 * block that clears it, so a view that already re-runs on `isStreaming` sees
 * the registry change with it. The registry itself is not reactive.
 *
 * Each stream carries two lengths: what it has written to the reply, and what it has
 * received from the network. The received length leads the written one in the
 * smoother render modes, whose display writes wait for a frame a hidden page never runs
 * (MC-1499). A listener hears of every length note, so a consumer can react per chunk
 * without a timer. A group turn also registers its speaking member for the turn's length (MC-1502).
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
// The length of the text a stream has received, before it is formatted or written; an entry lives and dies with its stream.
const receivedChars = new Map<ActiveStream, number>()

/** What changed: the count of a stream, or the member a group turn names as its speaker. */
export type StreamChange = 'count' | 'speaker'

const changeListeners = new Set<(change: StreamChange) => void>()

/** A throwing listener is logged and never breaks the stream write or the send that noted the change. */
function notifyChange(change: StreamChange): void {
    for (const listener of [...changeListeners]) {
        try {
            listener(change)
        } catch (error) {
            console.error('stream change listener failed', error)
        }
    }
}

/** Calls `listener` after each change; returns the function that stops it, and stopping twice is harmless. */
export function subscribeStreamChanges(listener: (change: StreamChange) => void): () => void {
    changeListeners.add(listener)
    return () => {
        changeListeners.delete(listener)
    }
}

/** Registers one stream and returns the function that removes it; removing twice is harmless. */
export function addActiveStream(stream: ActiveStream): () => void {
    const entry: ActiveStream = { ...stream }
    streams.add(entry)
    return () => {
        streams.delete(entry)
        writtenChars.delete(entry)
        receivedChars.delete(entry)
    }
}

/** Records the length of the text the stream of the reply `replyChatId` has written; no stream of that reply changes nothing. */
export function noteStreamText(replyChatId: string, text: string): void {
    for (const entry of streams) {
        if (entry.replyChatId === replyChatId) {
            writtenChars.set(entry, text.length)
            notifyChange('count')
            return
        }
    }
}

/** Records the length of the text the stream of the reply `replyChatId` has received so far; no stream of that reply changes nothing. */
export function noteStreamReceived(replyChatId: string, length: number): void {
    for (const entry of streams) {
        if (entry.replyChatId === replyChatId) {
            receivedChars.set(entry, length)
            notifyChange('count')
            return
        }
    }
}

/**
 * The characters written so far by the latest stream of the owner that has a count; null when none has.
 * With `preferReceived` a stream's received length outranks its written one: approximate, and ahead of the
 * display in the smoother render modes (MC-1499, MC-1466). Without it only written lengths count.
 */
export function activeStreamChars(chaId: string, preferReceived = false): number | null {
    let chars: number | null = null
    for (const entry of streams) {
        if (entry.chaId === chaId) {
            const count = preferReceived ? receivedChars.get(entry) ?? writtenChars.get(entry) : writtenChars.get(entry)
            chars = count ?? chars
        }
    }
    return chars
}

/** The member a group turn speaks as, for the length of that turn, streaming or not. */
interface ReplySpeaker {
    readonly chaId: string
    readonly chatId: string
    readonly memberChaId: string
}

const replySpeakers = new Set<ReplySpeaker>()

/**
 * Registers the member that speaks a group turn from the turn's start to its end, so a request that streams
 * nothing still names its speaker (MC-1502). Returns the function that removes it; removing twice is harmless.
 * Adding is a change a listener hears; removing is not: the next turn or the closing notice renames the card.
 */
export function addReplySpeaker(speaker: ReplySpeaker): () => void {
    const entry: ReplySpeaker = { ...speaker }
    replySpeakers.add(entry)
    notifyChange('speaker')
    return () => {
        replySpeakers.delete(entry)
    }
}

/** The member of the latest live turn of the group `chaId` writing to the chat `chatId`; undefined when none. */
export function replySpeakerOf(chaId: string, chatId: string): string | undefined {
    let memberChaId: string | undefined
    for (const entry of replySpeakers) {
        if (entry.chaId === chaId && entry.chatId === chatId) {
            memberChaId = entry.memberChaId
        }
    }
    return memberChaId
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
    receivedChars.clear()
    replySpeakers.clear()
    changeListeners.clear()
}
