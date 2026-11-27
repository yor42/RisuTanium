// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { compile } from 'svelte/compiler'
import postcss from 'postcss'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import { draftContentOrphanGate } from '../../ts/draftContentOrphanGate'
import { resetLocalDraftsForTest } from '../../ts/localDrafts'
import { chatSurface } from '../ChatScreens/chatSurface.svelte'
import { createMessageEditorController, type MessageEditorDeps } from '../../ts/process/messageEditorController.svelte'
import { getLLMCache, setLLMCache } from '../../ts/translator/translator'

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
vi.mock('../../ts/alert', () => ({ alertConfirm: vi.fn(async () => true), alertError: vi.fn() }))
vi.mock('../../lang', () => ({ language: { editTranslation: 'Edit translation', editTranslationSave: 'Save Translation',
    draftRestored: 'Restored', draftRevert: 'Revert', chatShellTranslationClose: 'Close translation editor' } }))

import TranslationEditor from './TranslationEditor.svelte'

let target: HTMLElement
let app: ReturnType<typeof TranslationEditor> | undefined
let destroyRoot: (() => void) | undefined
let written: Mock<() => void>
async function show() {
    const deps: MessageEditorDeps = {
        getMessage: () => 'base', setMessage: () => {}, getIdx: () => 0,
        currentMessageIdentity: () => ({ kind: 'msg', chatKey: 'chat', chatId: 'row', index: 0 }),
        getTranslationCacheKey: async () => 'source',
        translationOpenToken: () => ({ identity: 'row', row: undefined, data: 'base', closeEpoch: chatSurface.closeEpoch }),
        translationOpenCurrent: (token) => token.closeEpoch === chatSurface.closeEpoch,
        isDestroyed: () => false,
        onTranslationCacheWritten: written,
    }
    let editor!: ReturnType<typeof createMessageEditorController>
    destroyRoot = $effect.root(() => { editor = createMessageEditorController(deps) })
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(TranslationEditor, { target, props: { editor } })
    await editor.loadTranslationForEdit()
    flushSync()
    return editor
}
beforeEach(() => {
    resetLocalDraftsForTest(); draftContentOrphanGate.clear(); chatSurface.closeEpoch = 0
    written = vi.fn()
    vi.mocked(getLLMCache).mockReset().mockResolvedValue('cached')
    vi.mocked(setLLMCache).mockReset().mockResolvedValue(undefined)
})
afterEach(async () => { if (app) await unmount(app); app = undefined; destroyRoot?.(); destroyRoot = undefined; target?.remove(); draftContentOrphanGate.clear(); resetLocalDraftsForTest() })

describe('TranslationEditor surface', () => {
    test('typing and Save use the controller cache chain', async () => {
        await show()
        const textarea = target.querySelector('textarea')!
        textarea.value = 'translated'
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        target.querySelector<HTMLButtonElement>('button:last-child')?.click()
        await vi.waitFor(() => expect(setLLMCache).toHaveBeenCalledWith('source', 'translated'), { timeout: 3000 })
        expect(written).toHaveBeenCalledTimes(1)
    })

    test('closeEpoch retains the tr record and the next open shows its marker', async () => {
        const editor = await show()
        const textarea = target.querySelector('textarea')!
        textarea.value = 'kept'
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        chatSurface.closeEpoch += 1
        flushSync()
        expect(target.querySelector('textarea')).toBeNull()
        expect(draftContentOrphanGate.get({ kind: 'tr', key: 'source' }, 'source')?.text).toBe('kept')
        await editor.loadTranslationForEdit()
        flushSync()
        expect(target.querySelector('[data-part="chat-message-draft-restored"]')?.textContent).toContain('Restored')
        expect(target.querySelector('textarea')?.value).toBe('kept')
    })

    test('auto-grows and shrinks with content, preserves transcript scrollTop, and caps height at 60dvh', async () => {
        let currentScrollHeight = 160
        const transcript = document.createElement('div')
        transcript.setAttribute('data-part', 'chat-transcript')
        transcript.scrollTop = 250
        document.body.appendChild(transcript)

        try {
            const deps: MessageEditorDeps = {
                getMessage: () => 'base', setMessage: () => {}, getIdx: () => 0,
                currentMessageIdentity: () => ({ kind: 'msg', chatKey: 'chat', chatId: 'row', index: 0 }),
                getTranslationCacheKey: async () => 'source',
                translationOpenToken: () => ({ identity: 'row', row: undefined, data: 'base', closeEpoch: chatSurface.closeEpoch }),
                translationOpenCurrent: (token) => token.closeEpoch === chatSurface.closeEpoch,
                isDestroyed: () => false,
                onTranslationCacheWritten: written,
            }
            let editor!: ReturnType<typeof createMessageEditorController>
            destroyRoot = $effect.root(() => { editor = createMessageEditorController(deps) })
            target = document.createElement('div')
            transcript.appendChild(target)
            app = mount(TranslationEditor, { target, props: { editor } })
            await editor.loadTranslationForEdit()
            flushSync()

            const installStubs = (field: HTMLTextAreaElement): void => {
                field.style.borderTopWidth = '1px'
                field.style.borderBottomWidth = '1px'
                Object.defineProperty(field, 'scrollHeight', {
                    configurable: true,
                    get: () => {
                        if (field.style.height === '0px') transcript.scrollTop = 100
                        return currentScrollHeight
                    },
                })
            }

            const textarea = target.querySelector('textarea')!
            installStubs(textarea)

            textarea.value = 'translated long text'
            textarea.dispatchEvent(new Event('input', { bubbles: true }))
            flushSync()
            expect(textarea.style.height).toBe('162px')
            expect(transcript.scrollTop).toBe(250)

            currentScrollHeight = 84
            textarea.value = 'short'
            textarea.dispatchEvent(new Event('input', { bubbles: true }))
            flushSync()
            expect(textarea.style.height).toBe('86px')

            // Zero scrollHeight clears height to '' rather than collapsing to '0px'.
            currentScrollHeight = 0
            textarea.value = 'hidden check'
            textarea.dispatchEvent(new Event('input', { bubbles: true }))
            flushSync()
            expect(textarea.style.height).toBe('')

            // Programmatic translation revert re-measures height without an input event.
            chatSurface.closeEpoch += 1
            flushSync()
            currentScrollHeight = 190
            await editor.loadTranslationForEdit()
            flushSync()
            const reopened = target.querySelector('textarea')!
            installStubs(reopened)
            reopened.value = 'reopened translation'
            reopened.dispatchEvent(new Event('input', { bubbles: true }))
            flushSync()
            expect(reopened.style.height).toBe('192px')

            currentScrollHeight = 90
            target.querySelector<HTMLButtonElement>('[data-part="chat-message-draft-restored"] button')!.click()
            flushSync()
            expect(reopened.value).toBe('cached')
            expect(reopened.style.height).toBe('92px')

            const filePath = path.resolve(process.cwd(), 'src/lib/ChatShell/TranslationEditor.svelte')
            const { css } = compile(readFileSync(filePath, 'utf8'), { filename: 'TranslationEditor.svelte', generate: 'client', css: 'external' })
            const maxHeights: string[] = []
            let overflowY: string | undefined
            postcss.parse(css?.code ?? '').walkRules((rule) => {
                if (!rule.selector.includes('textarea')) return
                rule.walkDecls('max-height', (decl) => { maxHeights.push(decl.value) })
                rule.walkDecls('overflow-y', (decl) => { overflowY = decl.value })
            })
            expect(maxHeights).toEqual(['60vh', '60dvh'])
            expect(overflowY).toBe('auto')
        } finally {
            transcript.remove()
        }
    })
})
