// @vitest-environment jsdom
// End on the transcript is taken at the shell root in the capture phase, so the reader-intent listener on the transcript never sees it.
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { bindReaderIntent, createReaderIntent, type ReaderIntentListener } from './readerIntent'
import { installTranscriptEndKey } from './shellJumpKeys'

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
