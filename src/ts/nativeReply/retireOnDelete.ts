import type { NativeReplyStore } from './store'
import { requestReconcile } from './pageState'
import { retireRunningReplies } from './runningReplies.svelte'

/**
 * A message the person deletes while its reply still runs natively (after a reload the page holds no request for it) must
 * stop that request and drop its record. The page marks the key retired in the same synchronous stretch as the delete, so
 * nothing re-adds the reply; the native stop follows without being awaited, so the delete never waits on IPC.
 */

let canceller: Pick<NativeReplyStore, 'cancel'> | null = null

/** Wires the native canceller; the page does it once at boot where the reply store exists. Web and desktop install none. */
export function installReplyCanceller(store: Pick<NativeReplyStore, 'cancel'> | null): void {
    canceller = store
}

/**
 * Retires the running keys among the removed messages (a message's chatId is its generation key) and asks the native side to
 * stop each once. A rejected cancel is logged and runs one reconcile pass, which discards the record once it is not live.
 */
export function retireDeletedReplies(removed: readonly { chatId?: string }[]): void {
    const keys: string[] = []
    for (const message of removed) {
        if (message.chatId !== undefined) {
            keys.push(message.chatId)
        }
    }
    const retired = retireRunningReplies(keys)
    const store = canceller
    if (store === null) {
        return
    }
    for (const key of retired) {
        store.cancel(key).catch((error) => {
            console.error(error)
            void requestReconcile()
        })
    }
}
