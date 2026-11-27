// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { compile } from 'svelte/compiler'
import postcss from 'postcss'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import { draftContentOrphanGate } from '../../ts/draftContentOrphanGate'
import { resetLocalDraftsForTest } from '../../ts/localDrafts'
import { chatSurface } from '../ChatScreens/chatSurface.svelte'
import { createMessageEditorController, type MessageEditorDeps } from '../../ts/process/messageEditorController.svelte'
import { alertConfirm } from '../../ts/alert'
import { DBState } from '../../ts/stores.svelte'

let latestResizeCallback: ResizeObserverCallback | null = null
class StubResizeObserver {
    constructor(cb: ResizeObserverCallback) { latestResizeCallback = cb }
    observe() {}
    disconnect() {}
    unobserve() {}
}

vi.mock('../../ts/stores.svelte', () => ({
    DBState: { db: { language: 'en', characters: [{ chatPage: 0, chats: [{ message: [{ data: 'base' }] }] }] } },
    selIdState: { selId: 0 },
}))
vi.mock('../ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ closeEpoch: 0 })
    return { chatSurface }
})
vi.mock('../../ts/translator/translator', () => ({ getLLMCache: vi.fn(), setLLMCache: vi.fn() }))
vi.mock('../../ts/process/memory/measureFlag', () => ({ MEASURE: false }))
vi.mock('../../ts/process/chatPhaseRing', () => ({ noteEditConfirm: vi.fn() }))
vi.mock('../../ts/alert', () => ({ alertConfirm: vi.fn(async () => true) }))
vi.mock('../../lang', () => ({ language: { edit: 'Edit', draftRestored: 'Restored', draftRevert: 'Revert',
    messageEditDiscard: 'Discard', messageEditSave: 'Save', messageEditDiscardConfirm: 'Discard changes?' } }))

import MessageEditor from './MessageEditor.svelte'

let target: HTMLElement
let app: ReturnType<typeof MessageEditor> | undefined
let destroyRoot: (() => void) | undefined
let written: string[]
function show() {
    let message = 'base'
    written = []
    const deps: MessageEditorDeps = {
        getMessage: () => message,
        setMessage: (value) => { message = value; written.push(value) },
        getIdx: () => 0,
        currentMessageIdentity: () => ({ kind: 'msg', chatKey: 'chat', chatId: 'row', index: 0 }),
        getTranslationCacheKey: async () => 'source',
        translationOpenToken: () => ({ identity: 'row', row: undefined, data: message, closeEpoch: chatSurface.closeEpoch }),
        translationOpenCurrent: (token) => token.closeEpoch === chatSurface.closeEpoch,
        isDestroyed: () => false,
        onTranslationCacheWritten: () => {},
    }
    let editor!: ReturnType<typeof createMessageEditorController>
    destroyRoot = $effect.root(() => { editor = createMessageEditorController(deps) })
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(MessageEditor, { target, props: { editor } })
    editor.startOriginalEdit()
    flushSync()
    return editor
}
function click(label: string) {
    const button = [...target.querySelectorAll('button')].find((element) => element.textContent?.trim() === label)
    expect(button).toBeTruthy()
    button?.click()
    flushSync()
}
beforeEach(() => { resetLocalDraftsForTest(); draftContentOrphanGate.clear(); chatSurface.closeEpoch = 0; DBState.db.characters[0].chats[0].message[0].data = 'base' })
afterEach(async () => { if (app) await unmount(app); app = undefined; destroyRoot?.(); destroyRoot = undefined; target?.remove(); draftContentOrphanGate.clear(); resetLocalDraftsForTest() })

describe('MessageEditor surface', () => {
    test('typing and Save commit through setMessage', () => {
        show()
        const textarea = target.querySelector('textarea')!
        textarea.value = 'edited'
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        click('Save')
        expect(written).toEqual(['edited'])
        expect(target.querySelector('textarea')).toBeNull()
    })

    test('discard asks the existing confirmation and keeps the text when declined', async () => {
        vi.mocked(alertConfirm).mockResolvedValueOnce(false)
        show()
        const textarea = target.querySelector('textarea')!
        textarea.value = 'unsaved'
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        click('Discard')
        await vi.waitFor(() => expect(alertConfirm).toHaveBeenCalledWith('Discard changes?'), { timeout: 3000 })
        expect(target.querySelector('textarea')?.value).toBe('unsaved')
        expect(written).toEqual([])
    })

    test('closeEpoch keeps the draft and reopening shows the restore marker', () => {
        const editor = show()
        const textarea = target.querySelector('textarea')!
        textarea.value = 'kept'
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        chatSurface.closeEpoch += 1
        flushSync()
        expect(target.querySelector('textarea')).toBeNull()
        expect(draftContentOrphanGate.get({ kind: 'msg', chatKey: 'chat', chatId: 'row', index: 0 }, 'base')?.text).toBe('kept')
        editor.startOriginalEdit()
        flushSync()
        expect(target.querySelector('[data-part="chat-message-draft-restored"]')?.textContent).toContain('Restored')
        expect(target.querySelector('textarea')?.value).toBe('kept')
    })

    test('auto-grows and shrinks with content, preserves transcript scrollTop, and re-fits on width resize', () => {
        let currentScrollHeight = 180
        let currentClientWidth = 300
        latestResizeCallback = null
        vi.stubGlobal('ResizeObserver', StubResizeObserver)

        const transcript = document.createElement('div')
        transcript.setAttribute('data-part', 'chat-transcript')
        transcript.scrollTop = 420
        document.body.appendChild(transcript)

        try {
            let message = 'long message'
            const deps: MessageEditorDeps = {
                getMessage: () => message,
                setMessage: (value) => { message = value },
                getIdx: () => 0,
                currentMessageIdentity: () => ({ kind: 'msg', chatKey: 'chat', chatId: 'row', index: 0 }),
                getTranslationCacheKey: async () => 'source',
                translationOpenToken: () => ({ identity: 'row', row: undefined, data: message, closeEpoch: chatSurface.closeEpoch }),
                translationOpenCurrent: (token) => token.closeEpoch === chatSurface.closeEpoch,
                isDestroyed: () => false,
                onTranslationCacheWritten: () => {},
            }
            let editor!: ReturnType<typeof createMessageEditorController>
            destroyRoot = $effect.root(() => { editor = createMessageEditorController(deps) })
            target = document.createElement('div')
            transcript.appendChild(target)
            app = mount(MessageEditor, { target, props: { editor } })
            editor.startOriginalEdit()
            flushSync()

            const installStubs = (field: HTMLTextAreaElement): { zeroResetCount: () => number } => {
                field.style.borderTopWidth = '1px'
                field.style.borderBottomWidth = '1px'
                let resets = 0
                Object.defineProperty(field, 'clientWidth', { configurable: true, get: () => currentClientWidth })
                Object.defineProperty(field, 'scrollHeight', {
                    configurable: true,
                    get: () => {
                        if (field.style.height === '0px') {
                            resets += 1
                            transcript.scrollTop = 300
                        }
                        return currentScrollHeight
                    },
                })
                return { zeroResetCount: () => resets }
            }

            const textarea = target.querySelector('textarea')!
            const counter = installStubs(textarea)

            // Sync initial observer baseline to stubbed clientWidth before testing height-only vs width-change notifications.
            latestResizeCallback?.([], {} as ResizeObserver)

            // Trigger re-measure after stubbing layout getters on the mounted textarea.
            textarea.value = 'line 1\nline 2\nline 3'
            textarea.dispatchEvent(new Event('input', { bubbles: true }))
            flushSync()
            expect(textarea.style.height).toBe('182px')
            expect(transcript.scrollTop).toBe(420)

            // Shrinking content shrinks the textarea height.
            currentScrollHeight = 96
            textarea.value = 'short'
            textarea.dispatchEvent(new Event('input', { bubbles: true }))
            flushSync()
            expect(textarea.style.height).toBe('98px')

            // Height-only resize notification must not re-measure.
            const countBeforeHeightOnly = counter.zeroResetCount()
            latestResizeCallback?.([], {} as ResizeObserver)
            expect(counter.zeroResetCount()).toBe(countBeforeHeightOnly)

            // Width change re-measures.
            currentClientWidth = 220
            currentScrollHeight = 240
            latestResizeCallback?.([], {} as ResizeObserver)
            expect(counter.zeroResetCount()).toBeGreaterThan(countBeforeHeightOnly)
            expect(textarea.style.height).toBe('242px')

            // Zero scrollHeight (hidden/unlaid-out field) clears height to '' rather than collapsing to '0px'.
            currentScrollHeight = 0
            textarea.value = 'hidden check'
            textarea.dispatchEvent(new Event('input', { bubbles: true }))
            flushSync()
            expect(textarea.style.height).toBe('')

            // Programmatic draft revert re-measures height to the reverted message without an input event.
            chatSurface.closeEpoch += 1
            flushSync()
            currentScrollHeight = 200
            editor.startOriginalEdit()
            flushSync()
            const reopened = target.querySelector('textarea')!
            installStubs(reopened)
            reopened.value = 'reopened draft'
            reopened.dispatchEvent(new Event('input', { bubbles: true }))
            flushSync()
            expect(reopened.style.height).toBe('202px')

            currentScrollHeight = 72
            click('Revert')
            expect(reopened.value).toBe('long message')
            expect(reopened.style.height).toBe('74px')
        } finally {
            vi.unstubAllGlobals()
            transcript.remove()
        }
    })

    test('caps textarea height at a viewport fraction with vertical scrolling', () => {
        const filePath = path.resolve(process.cwd(), 'src/lib/ChatShell/MessageEditor.svelte')
        const { css } = compile(readFileSync(filePath, 'utf8'), { filename: 'MessageEditor.svelte', generate: 'client', css: 'external' })
        const maxHeights: string[] = []
        let overflowY: string | undefined
        postcss.parse(css?.code ?? '').walkRules((rule) => {
            if (!rule.selector.includes('textarea')) return
            rule.walkDecls('max-height', (decl) => { maxHeights.push(decl.value) })
            rule.walkDecls('overflow-y', (decl) => { overflowY = decl.value })
        })
        expect(maxHeights).toEqual(['60vh', '60dvh'])
        expect(overflowY).toBe('auto')
    })
})
