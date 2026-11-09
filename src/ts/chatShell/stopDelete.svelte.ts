import { deleteAtSettle, freezeDeleteIds, type DeleteMode, type FrozenDeleteIds } from '../process/messageActions.svelte'
import { isWriting, originOf, stopWorkIn, type Origin } from '../process/chatOrigin'
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

/** How often a settle that found the origin's work still registered looks again. */
const RECHECK_MS = 25

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
 * Stops the work registered in the origin's chat, then removes the frozen reply (or range) once it
 * has settled. Work in another chat is never stopped. The delete is written only when the origin has
 * no registered work: the target-absent save mark must come after the stopped send's settle mark,
 * and the composer ends its own work registration only after the send returns. So the settle starts
 * from a macrotask and re-checks `isWriting(origin)`, re-queueing at a short interval while the work
 * stays registered. The wait follows the origin's registered work only, never the global flag: a
 * later generation of this chat that registers keeps the delete waiting while the origin still writes. There is no timeout: the wait ends when the origin's work ends, and the
 * frozen-id check then refuses and announces a range that a later send appended to. Returns
 * false when a request is already pending or the target cannot be frozen.
 */
export function requestStopDelete(owner: character | groupChat, chat: Chat, target: Message, mode: DeleteMode): boolean {
    if (pendingStopDelete) return false
    const origin = originOf(owner, chat)
    const ids = origin ? freezeDeleteIds(chat, target, mode) : null
    if (!origin || !ids) return false
    const request: PendingStopDelete = Object.freeze({ origin, ids, mode })
    pendingStopDelete = request
    const settle = () => {
        const check = () => {
            if (pendingStopDelete !== request) return
            if (isWriting(request.origin)) {
                setTimeout(check, RECHECK_MS)
                return
            }
            resolve(request)
        }
        setTimeout(check, 0)
    }
    try {
        stopWorkIn(request.origin)
    } catch (error) {
        pendingStopDelete = null
        throw error
    }
    settle()
    return true
}
