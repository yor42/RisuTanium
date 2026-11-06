// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import { draftContentOrphanGate } from '../../ts/draftContentOrphanGate'
import { resetLocalDraftsForTest } from '../../ts/localDrafts'
import { chatSurface } from '../ChatScreens/chatSurface.svelte'
import { createMessageEditorController, type MessageEditorDeps } from '../../ts/process/messageEditorController.svelte'
import { alertConfirm } from '../../ts/alert'
import { DBState } from '../../ts/stores.svelte'

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
})
