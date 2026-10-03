import { get } from "svelte/store"
import { alertSelect, alertToast, alertClear, doingAlert, alertRequestLogs, type alertData } from "./alert"
import { coversPage, escapeActionFor } from "./alertEscape"
import { ANSWER_GUARD_MS, promptWaiting } from "./alertPrompts"
import { recordKeyEventBlocked, setLiveKeysBlockedReader } from "./keyEventBlocked"
import { changeToPreset as changeToPreset2, getDatabase, type Database } from "./storage/database.svelte"
import { alertStore, DBState, loadoutModalStore, MobileGUIStack, MobileSideBar, openPersonaList, openPresetList, OpenRealmStore, PlaygroundStore, QuickSettings, SafeModeStore, selectedCharID, settingsOpen } from "./stores.svelte"
import { language } from "src/lang"
import { updateTextThemeAndCSS } from "./gui/colorscheme"
import { defaultHotkeys } from "./defaulthotkeys"
import { previewMayStart, renderPromptResult, runPreview } from "./process/previewRunner"
import { RISU_SIDEBAR_DRAG_TYPE } from "./dragTypes"
import { isEnterActivatedControl, shouldYieldToFocusedControl } from "./hotkeyYield"
import { changeChar } from "./characters"
import { isHiddenSystemCharacter } from "./hiddenCharacters"

// The one predicate for every key path: a prompt is waiting, or an alert covers the page.
function keysBlocked(): boolean {
    return promptWaiting() || coversPage(get(alertStore).type)
}

const BUTTON_LIKE_INPUT_TYPES = ['button', 'submit', 'reset', 'image', 'checkbox', 'radio']

// A control that Enter or Space presses.
function isActivatableControl(el: Element): boolean {
    if(el.tagName === 'INPUT'){
        return BUTTON_LIKE_INPUT_TYPES.includes((el as HTMLInputElement).type)
    }
    return el.tagName === 'BUTTON' ||
        el.tagName === 'SUMMARY' ||
        el.getAttribute('role') === 'button' ||
        (el.tagName === 'A' && el.hasAttribute('href'))
}

// Runs before any other listener of the event: records whether the keys were blocked when the
// event began, and stops a held Enter or Space from repeating a press on a control.
function captureKeydown(ev: KeyboardEvent){
    recordKeyEventBlocked(ev, keysBlocked())
    if(
        ev.repeat &&
        (ev.key === 'Enter' || ev.key === ' ') &&
        ev.target instanceof Element &&
        isActivatableControl(ev.target)
    ){
        ev.preventDefault()
        ev.stopPropagation()
    }
}

// When each alert object first reached the store. An alert seen before initHotkey() has no entry.
const alertAppeared = new WeakMap<alertData, number>()
let stopAlertClock: (() => void) | undefined

function startAlertClock(){
    stopAlertClock?.()
    let primed = false
    stopAlertClock = alertStore.subscribe((value) => {
        if(primed && !alertAppeared.has(value)){
            alertAppeared.set(value, performance.now())
        }
    })
    primed = true
}

function withinAnswerPause(value: alertData): boolean {
    const appeared = alertAppeared.get(value)
    return appeared !== undefined && performance.now() - appeared < ANSWER_GUARD_MS
}

// A plain, first, non-composing Enter aimed at the alert or at the page body. With an
// Enter-activated control of the alert focused, that control takes the key instead.
function enterMayAnswer(ev: KeyboardEvent): boolean {
    if(ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey || ev.repeat){
        return false
    }
    if(ev.isComposing || ev.keyCode === 229){
        return false
    }
    const alertRoot = document.querySelector('[data-alert-root]')
    const target = ev.target
    const aimedAtAlert = target === document.body ||
        target === document ||
        (alertRoot !== null && target instanceof Node && alertRoot.contains(target))
    if(!aimedAtAlert){
        return false
    }
    const focused = document.activeElement
    return !(focused && alertRoot?.contains(focused) && isEnterActivatedControl(focused))
}

export function initHotkey(){
    setLiveKeysBlockedReader(keysBlocked)
    startAlertClock()
    window.addEventListener('keydown', captureKeydown, true)
    document.addEventListener('keydown', async (ev) => {
        // Escape cancels a wait notice that offers a Cancel button, whatever
        // has focus, and is consumed so that nothing else acts on it.
        if(ev.key === 'Escape'){
            const shown = get(alertStore)
            if(shown.type === 'wait' && shown.onCancel){
                shown.onCancel()
                ev.preventDefault()
                ev.stopPropagation()
                return
            }
        }

        if(
            !ev.ctrlKey &&
            !ev.altKey &&
            !ev.shiftKey &&
            (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) ||
            document.activeElement.getAttribute('contenteditable'))
        ){
            return
        }


        const database = getDatabase()

        const hotKeys = database?.hotkeys ?? defaultHotkeys

        let hotkeyRan = false
        // While the keys are blocked a shortcut is still recognised and
        // consumed as usual, but does nothing.
        const blocked = keysBlocked()
        const act = (action: () => void) => {
            if(!blocked){
                action()
            }
        }
        // A control that natively activates on this key (a button, select,
        // etc.) and currently holds keyboard focus should get to handle it
        // instead of a hotkey match stealing it via preventDefault below.
        const yieldToFocusedControl = shouldYieldToFocusedControl(ev, document.activeElement)
        for(const hotkey of (yieldToFocusedControl ? [] : hotKeys)){
            let hotKeyRanThisTime = true

            if(!hotkeyMatches(hotkey, ev)){
                continue
            }
            switch(hotkey.action){
                case 'reroll':{
                    act(() => clickQuery('.button-icon-reroll'))
                    break
                }
                case 'unreroll':{
                    act(() => clickQuery('.button-icon-unreroll'))
                    break
                }
                case 'translate':{
                    act(() => clickQuery('.button-icon-translate'))
                    break
                }
                case 'remove':{
                    act(() => clickQuery('.button-icon-remove'))
                    break
                }
                case 'edit':{
                    act(() => {
                        clickQuery('.button-icon-edit')
                        setTimeout(() => {
                            focusQuery('.message-edit-area')
                        }, 100)
                    })
                    break
                }
                case 'copy':{
                    act(() => clickQuery('.button-icon-copy'))
                    break
                }
                case 'focusInput':{
                    act(() => focusQuery('.text-input-area'))
                    break
                }
                case 'send':{
                    act(() => clickQuery('.button-icon-send'))
                    break
                }
                case 'settings':{
                    act(() => settingsOpen.set(!get(settingsOpen)))
                    break
                }
                case 'home':{
                    act(() => selectedCharID.set(-1))
                    break
                }
                case 'presets':{
                    act(() => openPresetList.set(!get(openPresetList)))
                    break
                }
                case 'persona':{
                    act(() => openPersonaList.set(!get(openPersonaList)))
                    break
                }
                case 'toggleCSS':{
                    act(() => {
                        SafeModeStore.set(!get(SafeModeStore))
                        updateTextThemeAndCSS()
                    })
                    break
                }
                case 'prevChar':{
                    const sorted = characterCycle(database.characters)
                    if(sorted.length === 0){
                        return
                    }
                    const currentIndex = sorted.findIndex(v => v.i === get(selectedCharID))
                    if(currentIndex === 0){
                        return
                    }
                    const targetIndex = currentIndex === -1 ? sorted.length - 1 : currentIndex - 1
                    const target = sorted[targetIndex].i
                    ev.preventDefault()
                    ev.stopPropagation()
                    if(blocked){
                        break
                    }
                    await changeChar(target)
                    if(get(selectedCharID) === target){
                        PlaygroundStore.set(0)
                        OpenRealmStore.set(false)
                    }
                    break
                }
                case 'nextChar':{
                    const sorted = characterCycle(database.characters)
                    if(sorted.length === 0){
                        return
                    }
                    const currentIndex = sorted.findIndex(v => v.i === get(selectedCharID))
                    if(currentIndex === sorted.length - 1){
                        return
                    }
                    const targetIndex = currentIndex === -1 ? 0 : currentIndex + 1
                    const target = sorted[targetIndex].i
                    ev.preventDefault()
                    ev.stopPropagation()
                    if(blocked){
                        break
                    }
                    await changeChar(target)
                    if(get(selectedCharID) === target){
                        PlaygroundStore.set(0)
                        OpenRealmStore.set(false)
                    }
                    break
                }
                case 'quickMenu':{
                    act(() => quickMenu())
                    break
                }
                case 'previewRequest':{
                    // Consumed whether or not a preview starts, so the
                    // browser's own Ctrl+U (view source) never runs.
                    ev.preventDefault()
                    ev.stopPropagation()
                    if(blocked || get(selectedCharID) === -1 || !previewMayStart()){
                        return false
                    }
                    await runPreview({
                        previewPrompt: true
                    }, renderPromptResult)
                    return
                }
                case 'toggleLog':{
                    act(() => alertRequestLogs())
                    break
                }
                case 'quickSettings':{
                    act(() => {
                        QuickSettings.open = !QuickSettings.open
                        QuickSettings.index = 0
                    })
                    break
                }
                case 'scrollToActiveChar':{
                    act(() => {
                        if(database.enableScrollToActiveChar !== false){
                            window.dispatchEvent(new CustomEvent('scrollToActiveCharacter'))
                        }
                    })
                    break
                }
                case 'loadout':{
                    act(() => {
                        loadoutModalStore.open = !loadoutModalStore.open
                    })
                    break
                }
                default:{
                    hotKeyRanThisTime = false
                }
            }

            if(hotKeyRanThisTime){
                hotkeyRan = true
                break
            }
        }

        if(hotkeyRan){
            ev.preventDefault()
            ev.stopPropagation()
            return
        }


        if(ev.ctrlKey){
            switch (ev.key){
                case "1":{
                    changeToPreset(0)
                    ev.preventDefault()
                    ev.stopPropagation()
                    break
                }
                case "2":{
                    changeToPreset(1)
                    ev.preventDefault()
                    ev.stopPropagation()
                    break
                }
                case "3":{
                    changeToPreset(2)
                    ev.preventDefault()
                    ev.stopPropagation()
                    break
                }
                case "4":{
                    changeToPreset(3)
                    ev.preventDefault()
                    ev.stopPropagation()
                    break
                }
                case "5":{
                    changeToPreset(4)
                    ev.preventDefault()
                    ev.stopPropagation()
                    break
                }
                case "6":{
                    changeToPreset(5)
                    ev.preventDefault()
                    ev.stopPropagation()
                    break
                }
                case "7":{
                    changeToPreset(6)
                    ev.preventDefault()
                    ev.stopPropagation()
                    break
                }
                case "8":{
                    changeToPreset(7)
                    ev.preventDefault()
                    ev.stopPropagation()
                    break
                }
                case "9":{
                    changeToPreset(8)
                    ev.preventDefault()
                    ev.stopPropagation()
                    break
                }
            }
        }
        if(ev.key === 'Escape'){
            // A prompt waiting for an answer is never answered by Escape, and
            // nothing behind it reacts to the key either.
            const escapeAction = escapeActionFor(get(alertStore).type)
            if(escapeAction === 'ignore'){
                ev.preventDefault()
                ev.stopPropagation()
                return
            }
            if(escapeAction === 'close'){
                alertClear()
            }
            if(get(settingsOpen)){
                settingsOpen.set(false)
            }
            ev.preventDefault()
        }
        if(ev.key === 'Enter' && enterMayAnswer(ev)){
            // Enter answers a confirm yes and closes a notice, but not one
            // that has only just appeared.
            const shown = get(alertStore)
            if(shown.type === 'ask' || ((shown.type === 'normal' || shown.type === 'error') && !withinAnswerPause(shown))){
                alertStore.set({
                    type: 'none',
                    msg: 'yes'
                })
            }
        }
    })


    let touchs = 0
    let touchStartTime = 0
    //check for triple touch
    document.addEventListener('touchstart', (ev) => {
        touchs++
        if(touchs > 2){
            if(Date.now() - touchStartTime > 300){
                return
            }
            touchs = 0
            if(doingAlert()){
                return
            }
            quickMenu()
        }
        if(touchs === 1){
            touchStartTime = Date.now()
        }
    })
    document.addEventListener('touchend', (ev) => {
        touchs = 0
    })
    
    let lastScrollTime = 0
    const SCROLL_COOLDOWN = 500
    
    document.addEventListener('dragover', (ev) => {
        if (ev.ctrlKey && !ev.shiftKey && !ev.altKey) {
            const types = ev.dataTransfer?.types || []
            const isCharacterDrag = types.includes(RISU_SIDEBAR_DRAG_TYPE)
            
            if (isCharacterDrag) {
                const db = getDatabase()
                if(db.enableScrollToActiveChar !== false){
                    const now = Date.now()
                    if (now - lastScrollTime > SCROLL_COOLDOWN) {
                        lastScrollTime = now
                        window.dispatchEvent(new CustomEvent('scrollToActiveCharacter'))
                    }
                }
            }
        }
    }, true)
}

// The characters the previous/next hotkeys cycle through, sorted by name, each
// with its index in the character list. Trashed characters and the hidden
// system characters are not part of the cycle, so it holds the characters the
// sidebar shows, in name order rather than the sidebar's order.
function characterCycle(characters: Database['characters']){
    const cycle: {name: string, i: number}[] = []
    for(let i = 0; i < characters.length; i++){
        const v = characters[i]
        if(v.trashTime || isHiddenSystemCharacter(v)){
            continue
        }
        cycle.push({name: v.name, i})
    }
    return cycle.sort((a, b) => a.name.localeCompare(b.name))
}

async function quickMenu(){
    const selStr = await alertSelect([
        language.presets,
        language.persona,
        language.hotkeyDesc.loadout,
        language.cancel
    ])
    const sel = parseInt(selStr)
    if(sel === 0){
        openPresetList.set(!get(openPresetList))
    }
    if(sel === 1){
        openPersonaList.set(!get(openPersonaList))
    }
    if(sel === 2){
        loadoutModalStore.open = !(loadoutModalStore.open)
    }
}

export function hotkeyMatches(hotkey: typeof DBState.db.hotkeys[number], ev: KeyboardEvent): boolean {
    if(!hotkey){
        return false
    }
    
    hotkey.ctrl = hotkey.ctrl ?? false
    hotkey.alt = hotkey.alt ?? false
    hotkey.shift = hotkey.shift ?? false

    if(hotkey.ctrl !== ev.ctrlKey) return false
    if(hotkey.alt !== ev.altKey) return false
    if(hotkey.shift !== ev.shiftKey) return false
    if(hotkey.key.toLowerCase() !== ev.key.toLowerCase()) return false
    if(!hotkey.ctrl && !hotkey.alt && !hotkey.shift){
        if(['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return false
    }
    return true
}

function clickQuery(query:string){
    let ele = document.querySelector(query) as HTMLElement
    console.log(ele)
    if(ele){
        ele.click()
    }
}

function focusQuery(query:string){
    let ele = document.querySelector(query) as HTMLElement
    if(ele){
        ele.focus()
    }
}



export function initMobileGesture(){
    let pressingPointers = new Map<number, {x:number, y:number}>()

    const onTouchStart = (ev: TouchEvent) => {
        for(const touch of ev.changedTouches){
            const ele = touch.target as HTMLElement
            // A control's own touch is never a swipe; the other touches of the event still are.
            if(ele.tagName === 'BUTTON' || ele.tagName === 'INPUT' || ele.tagName === 'SELECT' || ele.tagName === 'TEXTAREA'){
                continue
            }
            pressingPointers.set(touch.identifier, {x: touch.clientX, y: touch.clientY})
        }
    }
    const onTouchCancel = (ev: TouchEvent) => {
        for(const touch of ev.changedTouches){
            pressingPointers.delete(touch.identifier)
        }
    }
    const onTouchEnd = (ev: TouchEvent) => {
        for(const touch of ev.changedTouches){
            const d = pressingPointers.get(touch.identifier)
            if(!d){
                continue
            }
            const moveX = touch.clientX - d.x
            const moveY = touch.clientY - d.y
            pressingPointers.delete(touch.identifier)

            if(moveX > 50 && Math.abs(moveY) < Math.abs(moveX)){
                if(get(selectedCharID) === -1){
                    if(get(MobileGUIStack) > 0){
                        MobileGUIStack.update(v => v - 1)
                    }
                }
                else{
                    if(get(MobileSideBar) > 0){
                        MobileSideBar.update(v => v - 1)
                    }
                }
            }
            else if(moveX < -50 && Math.abs(moveY) < Math.abs(moveX)){
                if(get(selectedCharID) === -1){
                    if(get(MobileGUIStack) < 2){
                        MobileGUIStack.update(v => v + 1)
                    }
                }
                else{
                    if(get(MobileSideBar) < 3){
                        MobileSideBar.update(v => v + 1)
                    }
                }
            }
        }
    }

    document.addEventListener('touchstart', onTouchStart, {passive: true})
    document.addEventListener('touchend', onTouchEnd, {passive: true})
    document.addEventListener('touchcancel', onTouchCancel, {passive: true})

    return () => {
        document.removeEventListener('touchstart', onTouchStart)
        document.removeEventListener('touchend', onTouchEnd)
        document.removeEventListener('touchcancel', onTouchCancel)
        pressingPointers.clear()
    }
}

function changeToPreset(num:number){
    if(!keysBlocked()){
        let db = getDatabase()
        let pres = db.botPresets
        if(pres.length > num){
            alertToast(`Changed to Preset: ${pres[num].name}`)
            changeToPreset2(num)
        }
    }
}
