import { untrack } from 'svelte'
import { cancelReplyNotification, replyNotificationKey } from '../android/replyNotifications.svelte'
import { chatSurface } from '../../lib/ChatScreens/chatSurface.svelte'
import { DBState, DynamicGUI, selectedCharID, ShowRealmFrameStore, sideBarStore } from '../stores.svelte'
import { isShownChat, type Origin } from './chatOrigin'
import { isColdChat } from './coldstorageData'
import { clearReplyMark, replyMarkOf } from './replyMarks'

/**
 * Whether a chat is on screen: only while its chat view is actually showing (CHORE-685 R9). All five hold:
 * 1. the page is visible;
 * 2. `ChatScreen` is mounted (App unmounts it while the grid is open);
 * 3. the chat surface is not covered by Settings or Studio (`chatSurface.hidden`);
 * 4. the selection is this chat, so Home (nothing selected) is off screen;
 * 5. no full-screen cover lies over the chat: the phone layout's sidebar layer (`DynamicGUI` with the sidebar open) or the
 *    Realm browser (`ShowRealmFrameStore` non-empty).
 * Alerts, modals and popups drawn over a mounted, uncovered chat leave it on screen.
 *
 * Until `installChatOnScreen()` runs a chat is always on screen, so a harness that mounts no App sees no marks and no
 * notices, as `chatSurface` is for the surface.
 */

const view = $state({
    /** `ChatScreen` instances alive. */
    holders: 0,
    /** Bumped by each `visibilitychange`, so a reader of `isPageVisible()` reruns. */
    visibility: 0,
    /** The selected character index, mirrored from the `selectedCharID` store. */
    selected: -1,
    /** A full-screen cover is open over the chat. */
    covered: false,
})

let installed: (() => void) | null = null

/** Marks `ChatScreen` as mounted; the returned function releases it (once). */
export function holdChatView(): () => void {
    view.holders += 1
    let released = false
    return () => {
        if (released) {
            return
        }
        released = true
        view.holders -= 1
    }
}

/** Whether the page is visible. Reactive: it reruns on `visibilitychange` once `installChatOnScreen()` ran. */
export function isPageVisible(): boolean {
    void view.visibility
    return typeof document === 'undefined' || document.visibilityState === 'visible'
}

/** Conditions 1, 2, 3 and 5: the chat view shows something the selection can be in. */
function chatViewShowing(): boolean {
    return isPageVisible() && view.holders > 0 && !chatSurface.hidden && !view.covered
}

/** Whether the chat `origin` names is on screen now. */
export function isChatOnScreen(origin: Origin): boolean {
    if (installed === null) {
        return true
    }
    return chatViewShowing() && isShownChat(origin)
}

/**
 * Follows the page, the selection and the cover, and clears the mark of whichever chat is on screen. The clear is level
 * triggered: any path that brings a marked chat on screen (a pick, a return from Settings, Studio or the grid, the page
 * shown again) clears it, and the effect depends only on the on-screen conditions and the selected chat's mark. Idempotent;
 * the returned function stops everything.
 */
export function installChatOnScreen(): () => void {
    if (installed !== null) {
        return installed
    }
    const onVisibility = (): void => {
        view.visibility += 1
    }
    document.addEventListener('visibilitychange', onVisibility)
    let dynamicGui = false
    let sidebarOpen = false
    let realmOpen = false
    const stopStores = [
        selectedCharID.subscribe((value) => {
            view.selected = value
        }),
        DynamicGUI.subscribe((value) => {
            dynamicGui = value
            view.covered = (dynamicGui && sidebarOpen) || realmOpen
        }),
        sideBarStore.subscribe((value) => {
            sidebarOpen = value
            view.covered = (dynamicGui && sidebarOpen) || realmOpen
        }),
        ShowRealmFrameStore.subscribe((value) => {
            realmOpen = Boolean(value)
            view.covered = (dynamicGui && sidebarOpen) || realmOpen
        }),
    ]
    const stopEffect = $effect.root(() => {
        $effect(() => {
            if (!chatViewShowing()) {
                return
            }
            const shown = DBState.db?.characters?.[view.selected]
            const chat = shown?.chats?.[shown.chatPage]
            if (!shown || !chat || isColdChat(chat) || replyMarkOf(chat) === null) {
                return
            }
            const chaId = shown.chaId
            const chatId = chat.id
            // The write looks the owner up in the character list; inside the effect that would subscribe it to the list.
            untrack(() => {
                clearReplyMark(chaId, chat)
                // The chat's system notification goes with its mark.
                cancelReplyNotification(replyNotificationKey({ chaId, chatId }))
            })
        })
    })
    const stop = (): void => {
        stopEffect()
        for (const unsubscribe of stopStores) {
            unsubscribe()
        }
        document.removeEventListener('visibilitychange', onVisibility)
        installed = null
    }
    installed = stop
    return stop
}

/** Test-only: stops following and forgets every mounted view. */
export function resetChatOnScreenForTests(): void {
    installed?.()
    view.holders = 0
    view.visibility = 0
    view.selected = -1
    view.covered = false
}
