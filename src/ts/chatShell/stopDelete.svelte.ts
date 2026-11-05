import { get } from 'svelte/store'
import { doingChat } from '../process/index.svelte'
import { abortChat } from '../process/composerActions.svelte'
import { deleteAtSettle, freezeDeleteIds, type DeleteMode, type FrozenDeleteIds } from '../process/messageActions.svelte'
import { originOf, type Origin } from '../process/chatOrigin'
import type { character, groupChat, Chat, Message } from '../storage/database.svelte'
import { alertNormal } from '../alert'
import { language } from '../../lang'

/** What a stop-and-delete waits to remove: ids and an origin, never message objects a stream may replace. */
interface PendingStopDelete {
    readonly origin: Origin
    readonly ids: FrozenDeleteIds
    readonly mode: DeleteMode
}

// At most one request at a time: while it waits, every delete of its chat is disabled, so a
// second request or an ordinary delete cannot change what the frozen ids describe.
let pendingStopDelete = $state.raw<PendingStopDelete | null>(null)

/** True while a stop-and-delete waits for a generation to settle, for one chat when `origin` is given. */
export function isStopDeletePending(origin?: Origin | null): boolean {
    const pending = pendingStopDelete
    if (!pending) return false
    if (origin === undefined) return true
    return origin !== null && pending.origin.chaId === origin.chaId && pending.origin.chatId === origin.chatId
}

function resolve(request: PendingStopDelete): void {
    try {
        if (!deleteAtSettle(request.origin, request.ids, request.mode)) alertNormal(language.chatShellStopDeleteChanged)
    } finally {
        if (pendingStopDelete === request) pendingStopDelete = null
    }
}

/**
 * Stops the running generation, then removes the frozen reply (or range) once it has settled.
 * The delete runs in a microtask queued from the first `doingChat` false: a synchronous
 * subscriber would delete while the stopped send's work is still registered and before its
 * settle mark, whereas the microtask runs after the send's outer `finally` completes.
 * There is no timeout; the wait ends when the generation settles. Returns false when a
 * request is already pending or the target cannot be frozen.
 */
export function requestStopDelete(owner: character | groupChat, chat: Chat, target: Message, mode: DeleteMode): boolean {
    if (pendingStopDelete) return false
    const origin = originOf(owner, chat)
    const ids = origin ? freezeDeleteIds(chat, target, mode) : null
    if (!origin || !ids) return false
    const request: PendingStopDelete = Object.freeze({ origin, ids, mode })
    pendingStopDelete = request
    const settle = () => queueMicrotask(() => resolve(request))
    try {
        abortChat()
    } catch (error) {
        pendingStopDelete = null
        throw error
    }
    if (!get(doingChat)) {
        settle()
        return true
    }
    let done = false
    let unsubscribe: (() => void) | undefined
    unsubscribe = doingChat.subscribe((busy) => {
        if (busy || done) return
        done = true
        unsubscribe?.()
        settle()
    })
    if (done) unsubscribe?.()
    return true
}
