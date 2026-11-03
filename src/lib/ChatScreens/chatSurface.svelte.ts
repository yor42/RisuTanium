import { tick } from 'svelte'
import { get } from 'svelte/store'
import { MobileGUI, ReloadChatPointer, ReloadGUIPointer, settingsOpen } from '../../ts/stores.svelte'
import { topLevelChangeCount } from '../../ts/storage/topLevelChanges'
import { language } from '../../lang'

/**
 * Shared state of the chat surface that App keeps mounted while Settings is open.
 *
 * Until `installChatSurface()` runs nothing here touches a store, so a harness that
 * mounts a chat component without App sees the surface as never hidden and never
 * closed, exactly as before the surface existed.
 *
 * - `hidden`: Settings is open over a kept-mounted chat. It turns false only after the
 *   Settings teardown has flushed, so work that teardown triggers lands first.
 * - `closeEpoch`: bumps whenever Settings opens; transient chat UI (menus, editors)
 *   closes on each bump.
 * - `rebuildEpoch`: bumps once on a return that must rebuild the rows, before `hidden`
 *   turns false. A row or body created under an older epoch is dead and never parses.
 * - `remountEpoch`: bumps on a return after the UI language changed during the visit. The chat
 *   chrome reads its labels once at mount, so only a remount shows the new language.
 * - `heldGui` / `heldChat`: the reload pointers as the surface sees them. They follow the
 *   raw stores while visible and stay put while hidden; a rebuild return catches them up
 *   to the raw values, so the rebuilt rows start from the current pointers.
 */
export const chatSurface = $state({
    hidden: false,
    closeEpoch: 0,
    rebuildEpoch: 0,
    remountEpoch: 0,
    heldGui: 0,
    heldChat: {} as Record<number, number>,
})

let stopWatching: (() => void) | null = null
let visit = 0
// A reload signal arrived while hidden: the rows are out of date whatever the settings did.
let missedSignal = false
// The settings-level change count when the surface was hidden; a different count at the
// release means a setting changed during the visit.
let changesAtHide = 0
// The live `language` object when the surface was hidden. `changeLanguage` replaces the object, so a
// different one at the release means the UI language changed during the visit.
let languageAtHide = language

function onSettingsOpened(){
    visit += 1
    chatSurface.closeEpoch += 1
    const focused = document.activeElement
    if(focused instanceof HTMLElement && focused.closest('[data-chat-surface]')){
        focused.blur()
    }
    if(!chatSurface.hidden && !get(MobileGUI)){
        // A reopen before the release keeps the first baseline.
        missedSignal = false
        changesAtHide = topLevelChangeCount()
        languageAtHide = language
        chatSurface.hidden = true
    }
}

async function onSettingsClosed(){
    const thisVisit = visit
    await tick()
    // A reopen during the flush owns the next release.
    if(visit !== thisVisit || get(settingsOpen) || !chatSurface.hidden){
        return
    }
    // One decision per return, after every event the Settings teardown raised.
    const rebuild = missedSignal || topLevelChangeCount() !== changesAtHide
    if(language !== languageAtHide){
        chatSurface.remountEpoch += 1
    }
    if(rebuild){
        chatSurface.rebuildEpoch += 1
        chatSurface.heldGui = get(ReloadGUIPointer)
        chatSurface.heldChat = { ...get(ReloadChatPointer) }
    }
    chatSurface.hidden = false
}

/** Whether `installChatSurface()` has run; read once when a chat component is created. */
export function isChatSurfaceInstalled(): boolean {
    return stopWatching !== null
}

/** Starts following `settingsOpen` and the reload pointers. Idempotent. */
export function installChatSurface(){
    if(stopWatching){
        return
    }
    let previous = false
    const stopSettings = settingsOpen.subscribe((open) => {
        if(open === previous){
            return
        }
        previous = open
        if(open){
            onSettingsOpened()
        }
        else{
            void onSettingsClosed()
        }
    })
    const stopGui = ReloadGUIPointer.subscribe((value) => {
        if(chatSurface.hidden){
            missedSignal = true
            return
        }
        chatSurface.heldGui = value
    })
    const stopChat = ReloadChatPointer.subscribe((value) => {
        if(chatSurface.hidden){
            missedSignal = true
            return
        }
        // The store mutates its map in place, so the held copy is a fresh object per signal.
        chatSurface.heldChat = { ...value }
    })
    stopWatching = () => {
        stopSettings()
        stopGui()
        stopChat()
    }
}

/** Test-only: stops following the stores and returns the state to its initial values. */
export function resetChatSurfaceForTests(){
    stopWatching?.()
    stopWatching = null
    visit = 0
    missedSignal = false
    changesAtHide = 0
    languageAtHide = language
    chatSurface.hidden = false
    chatSurface.closeEpoch = 0
    chatSurface.rebuildEpoch = 0
    chatSurface.remountEpoch = 0
    chatSurface.heldGui = 0
    chatSurface.heldChat = {}
}
