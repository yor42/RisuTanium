// @vitest-environment jsdom
// End on the transcript is taken at the shell root in the capture phase, so the reader-intent listener on the transcript never sees it.
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { bindReaderIntent, createReaderIntent, type ReaderIntentListener } from './readerIntent'
import { installFindKey, installJumpSheetKey, installTranscriptEndKey } from './shellJumpKeys'
import { recordKeyEventBlocked } from '../keyEventBlocked'
import { registerShell } from '../../lib/Nexus/pattern/patternFocus'

let shell: HTMLElement
let main: HTMLElement
let article: HTMLElement
let insideButton: HTMLButtonElement
let textarea: HTMLTextAreaElement
let run: Mock<() => void>
let intentSpy: Mock<ReaderIntentListener>
let articleSpy: Mock<(event: KeyboardEvent) => void>
let removeKey: () => void
let unbindIntent: () => void

beforeEach(() => {
    shell = document.createElement('div')
    shell.dataset.part = 'chat-shell'
    main = document.createElement('main')
    main.tabIndex = -1
    // A page of travel is what End asks of reader intent; a zero-height host would emit nothing and make "intent never saw it" vacuous.
    Object.defineProperty(main, 'clientHeight', { value: 600, configurable: true })
    article = document.createElement('article')
    article.dataset.part = 'chat-message'
    article.tabIndex = 0
    insideButton = document.createElement('button')
    article.appendChild(insideButton)
    main.appendChild(article)
    textarea = document.createElement('textarea')
    shell.append(main, textarea)
    document.body.appendChild(shell)
    // The real reader-intent binding is attached first, to the transcript, as ChatShell does.
    const intent = createReaderIntent({ canMove: () => true })
    intentSpy = vi.fn<ReaderIntentListener>()
    intent.subscribe(intentSpy)
    unbindIntent = bindReaderIntent(main, intent)
    articleSpy = vi.fn<(event: KeyboardEvent) => void>()
    article.addEventListener('keydown', articleSpy)
    run = vi.fn<() => void>()
    removeKey = installTranscriptEndKey(shell, { transcript: () => main, run: () => run() })
})
afterEach(() => {
    removeKey()
    unbindIntent()
    shell.remove()
})

function press(target: Element, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    return event
}

describe('installTranscriptEndKey', () => {
    test('A1-16a: End on the transcript runs once, is consumed, and reader intent never sees it', () => {
        const event = press(main)
        expect(run).toHaveBeenCalledOnce()
        expect(event.defaultPrevented).toBe(true)
        expect(intentSpy).not.toHaveBeenCalled()
    })
    test('A1-16a: End on a message runs once and neither the message nor reader intent sees it', () => {
        const event = press(article)
        expect(run).toHaveBeenCalledOnce()
        expect(event.defaultPrevented).toBe(true)
        expect(articleSpy).not.toHaveBeenCalled()
        expect(intentSpy).not.toHaveBeenCalled()
    })
    test('A1-16a: Ctrl+End runs too', () => {
        press(main, { ctrlKey: true })
        expect(run).toHaveBeenCalledOnce()
    })
    test('A1-16a: other targets and modified keys keep their own behaviour', () => {
        const button = press(insideButton)
        expect(button.defaultPrevented).toBe(false)
        expect(articleSpy).toHaveBeenCalledOnce()
        const field = press(textarea)
        expect(field.defaultPrevented).toBe(false)
        press(main, { shiftKey: true })
        press(main, { altKey: true })
        press(main, { metaKey: true })
        press(main, { isComposing: true })
        press(main, { keyCode: 229 })
        press(main, { key: 'Home' })
        expect(run).not.toHaveBeenCalled()
    })
    test('A1-16a: removing the listener restores the native path', () => {
        removeKey()
        press(main)
        expect(run).not.toHaveBeenCalled()
        expect(intentSpy).toHaveBeenCalledOnce()
    })
})

describe('installJumpSheetKey', () => {
    let onopen: Mock<(active: Element | null) => void>
    let documentSpy: Mock<(event: KeyboardEvent) => void>
    let state: { visible: boolean, sidebar: boolean, alert: string }
    let removeJump: () => void
    let releaseShell: (() => void) | null

    beforeEach(() => {
        onopen = vi.fn<(active: Element | null) => void>()
        documentSpy = vi.fn<(event: KeyboardEvent) => void>()
        state = { visible: true, sidebar: false, alert: 'none' }
        releaseShell = null
        // The configured hotkey listens on the document in the bubble phase: a taken key must never reach it.
        document.addEventListener('keydown', documentSpy)
        removeJump = installJumpSheetKey({ shellRoot: shell, surfaceVisible: () => state.visible, sidebarOpen: () => state.sidebar, alertType: () => state.alert, onopen })
    })
    afterEach(() => {
        removeJump()
        releaseShell?.()
        document.removeEventListener('keydown', documentSpy)
    })

    function ctrlG(target: EventTarget, init: KeyboardEventInit = {}): KeyboardEvent {
        const event = new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true, cancelable: true, ...init })
        target.dispatchEvent(event)
        return event
    }

    test('A2-20: Ctrl+G on a message opens the sheet, is consumed, and the document listener is never reached', () => {
        const event = ctrlG(article)
        expect(onopen).toHaveBeenCalledOnce()
        expect(event.defaultPrevented).toBe(true)
        expect(documentSpy).not.toHaveBeenCalled()
    })
    test('A2-20: Cmd+G and a Hangul layout (physical KeyG) also open it', () => {
        ctrlG(main, { ctrlKey: false, metaKey: true })
        ctrlG(main, { key: 'ㅎ', code: 'KeyG' })
        expect(onopen).toHaveBeenCalledTimes(2)
    })
    test('A2-20: a text field, Alt or Shift, a blocked key, a consumed key and an open shell leave the key alone', () => {
        const field = ctrlG(textarea)
        expect(field.defaultPrevented).toBe(false)
        ctrlG(article, { altKey: true })
        ctrlG(article, { shiftKey: true })
        const blocked = new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true, cancelable: true })
        recordKeyEventBlocked(blocked, true)
        article.dispatchEvent(blocked)
        releaseShell = registerShell({})
        ctrlG(article)
        expect(onopen).not.toHaveBeenCalled()
        expect(documentSpy).toHaveBeenCalledTimes(5)
    })
    test('A2-20: an alert other than a toast, or a hidden surface, leaves the key alone; a toast does not', () => {
        state.alert = 'error'
        ctrlG(article)
        state.alert = 'none'
        state.visible = false
        ctrlG(article)
        expect(onopen).not.toHaveBeenCalled()
        state.visible = true
        state.alert = 'toast'
        ctrlG(article)
        expect(onopen).toHaveBeenCalledOnce()
    })
    test('A2-20: outside the shell the key reaches the document listener', () => {
        const outside = document.createElement('input')
        outside.type = 'checkbox'
        document.body.appendChild(outside)
        const event = ctrlG(outside)
        outside.remove()
        expect(onopen).not.toHaveBeenCalled()
        expect(event.defaultPrevented).toBe(false)
        expect(documentSpy).toHaveBeenCalledOnce()
    })
    test('A2-20: G16 focus on the page body counts as in the chat only while no sidebar is open', () => {
        ctrlG(document.body)
        expect(onopen).toHaveBeenCalledOnce()
        state.sidebar = true
        const event = ctrlG(document.body)
        expect(onopen).toHaveBeenCalledOnce()
        expect(event.defaultPrevented).toBe(false)
        expect(documentSpy).toHaveBeenCalledOnce()
    })
    test('A2-20: removing the listener hands the key back', () => {
        removeJump()
        ctrlG(article)
        expect(onopen).not.toHaveBeenCalled()
        expect(documentSpy).toHaveBeenCalledOnce()
    })
})

describe('installFindKey', () => {
    let onopen: Mock<(active: Element | null) => void>
    let onrefocus: Mock<() => void>
    let documentSpy: Mock<(event: KeyboardEvent) => void>
    let state: { visible: boolean, sidebar: boolean, alert: string }
    let bar: HTMLElement | undefined
    let barField: HTMLInputElement
    let messageBox: HTMLTextAreaElement
    let translateBox: HTMLTextAreaElement
    let removeFind: () => void
    let releaseShell: (() => void) | null

    beforeEach(() => {
        onopen = vi.fn<(active: Element | null) => void>()
        onrefocus = vi.fn<() => void>()
        documentSpy = vi.fn<(event: KeyboardEvent) => void>()
        state = { visible: true, sidebar: false, alert: 'none' }
        releaseShell = null
        // The composer's two text areas carry the data-parts of ShellComposer's message box and translation field.
        const composer = document.createElement('div')
        messageBox = document.createElement('textarea')
        messageBox.dataset.part = 'chat-composer-input'
        translateBox = document.createElement('textarea')
        translateBox.dataset.part = 'chat-composer-translate'
        composer.append(translateBox, messageBox)
        bar = document.createElement('div')
        bar.dataset.part = 'chat-find-bar'
        barField = document.createElement('input')
        barField.type = 'search'
        bar.appendChild(barField)
        shell.append(composer, bar)
        document.addEventListener('keydown', documentSpy)
        removeFind = installFindKey({
            shellRoot: shell, surfaceVisible: () => state.visible, sidebarOpen: () => state.sidebar, alertType: () => state.alert,
            findBar: () => bar, onopen, onrefocus,
        })
    })
    afterEach(() => {
        removeFind()
        releaseShell?.()
        document.removeEventListener('keydown', documentSpy)
    })

    function ctrlF(target: EventTarget, init: KeyboardEventInit = {}): KeyboardEvent {
        const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true, ...init })
        target.dispatchEvent(event)
        return event
    }

    test('B2b-5: Ctrl+F on the transcript and on a message opens search, is consumed, and the document listener is never reached', () => {
        const onMain = ctrlF(main)
        const onArticle = ctrlF(article)
        expect(onopen).toHaveBeenCalledTimes(2)
        expect(onMain.defaultPrevented).toBe(true)
        expect(onArticle.defaultPrevented).toBe(true)
        expect(documentSpy).not.toHaveBeenCalled()
    })
    test('B2b-5: Ctrl+F in the composer message box opens search and is consumed', () => {
        messageBox.focus()
        const event = ctrlF(messageBox)
        expect(onopen).toHaveBeenCalledOnce()
        expect(onopen).toHaveBeenCalledWith(messageBox)
        expect(event.defaultPrevented).toBe(true)
        expect(documentSpy).not.toHaveBeenCalled()
    })
    test('B2b-5: Ctrl+F in the open bar refocuses and does not open again', () => {
        const event = ctrlF(barField)
        expect(onrefocus).toHaveBeenCalledOnce()
        expect(onopen).not.toHaveBeenCalled()
        expect(event.defaultPrevented).toBe(true)
        expect(documentSpy).not.toHaveBeenCalled()
    })
    test('B2b-5: Cmd+F and a Hangul layout (physical KeyF) also open it; the body counts while no sidebar is open', () => {
        ctrlF(main, { ctrlKey: false, metaKey: true })
        ctrlF(main, { key: 'ㄹ', code: 'KeyF' })
        ctrlF(document.body)
        expect(onopen).toHaveBeenCalledTimes(3)
        state.sidebar = true
        const event = ctrlF(document.body)
        expect(onopen).toHaveBeenCalledTimes(3)
        expect(event.defaultPrevented).toBe(false)
    })
    test('B2b-6: the translation field, another text field, Alt or Shift, a blocked key and a composing key keep the browser find (guard)', () => {
        const translate = ctrlF(translateBox)
        const plain = ctrlF(textarea)
        expect(translate.defaultPrevented).toBe(false)
        expect(plain.defaultPrevented).toBe(false)
        ctrlF(article, { altKey: true })
        ctrlF(article, { shiftKey: true })
        ctrlF(article, { isComposing: true })
        ctrlF(article, { keyCode: 229 })
        const blocked = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true })
        recordKeyEventBlocked(blocked, true)
        article.dispatchEvent(blocked)
        expect(onopen).not.toHaveBeenCalled()
        expect(onrefocus).not.toHaveBeenCalled()
        expect(documentSpy).toHaveBeenCalledTimes(7)
    })
    test('B2b-6: an open shell, an alert other than a toast, and a hidden surface or group chat keep the browser find; a toast does not (guard)', () => {
        releaseShell = registerShell({})
        ctrlF(article)
        releaseShell()
        releaseShell = null
        state.alert = 'error'
        ctrlF(article)
        state.alert = 'none'
        state.visible = false
        ctrlF(article)
        ctrlF(messageBox)
        ctrlF(barField)
        expect(onopen).not.toHaveBeenCalled()
        expect(onrefocus).not.toHaveBeenCalled()
        expect(documentSpy).toHaveBeenCalledTimes(5)
        state.visible = true
        state.alert = 'toast'
        ctrlF(article)
        expect(onopen).toHaveBeenCalledOnce()
    })
    test('B2b-6: outside the shell the key reaches the document listener', () => {
        const outside = document.createElement('input')
        outside.type = 'checkbox'
        document.body.appendChild(outside)
        const event = ctrlF(outside)
        outside.remove()
        expect(onopen).not.toHaveBeenCalled()
        expect(event.defaultPrevented).toBe(false)
        expect(documentSpy).toHaveBeenCalledOnce()
    })
    test('B2b-6: Ctrl+Alt+F (the un-reroll hotkey) is never taken', () => {
        const event = ctrlF(article, { altKey: true })
        expect(event.defaultPrevented).toBe(false)
        expect(onopen).not.toHaveBeenCalled()
    })
    test('B2b-6: removing the listener hands the key back', () => {
        removeFind()
        ctrlF(article)
        expect(onopen).not.toHaveBeenCalled()
        expect(documentSpy).toHaveBeenCalledOnce()
    })
})
