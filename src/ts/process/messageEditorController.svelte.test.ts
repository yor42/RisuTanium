// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'
import { hasMessageEditorDrafts, resetLocalDraftsForTest } from '../localDrafts'
import { draftContentOrphanGate } from '../draftContentOrphanGate'
import { chatSurface } from '../../lib/ChatScreens/chatSurface.svelte'
import { getLLMCache, setLLMCache } from '../translator/translator'
import {
    closeTranslationKeep,
    createMessageEditorController,
    translationEditLoading,
    type MessageEditorDeps,
} from './messageEditorController.svelte'

vi.mock('../stores.svelte', () => ({
    DBState: { db: { characters: [{ chatPage: 0, chats: [{ message: [{ data: 'base' }] }] }] } },
    selIdState: { selId: 0 },
}))
vi.mock('../../lib/ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ closeEpoch: 0 })
    return { chatSurface }
})
vi.mock('../translator/translator', () => ({
    getLLMCache: vi.fn(),
    setLLMCache: vi.fn(),
}))
vi.mock('./memory/measureFlag', () => ({ MEASURE: false }))
vi.mock('./chatPhaseRing', () => ({ noteEditConfirm: vi.fn() }))
vi.mock('../alert', () => ({ alertConfirm: vi.fn(async () => true) }))
vi.mock('../../lang', () => ({ language: { messageEditDiscardConfirm: 'Discard?' } }))

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: Error) => void
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
}

function fixture(overrides: Partial<MessageEditorDeps> = {}) {
    let message = 'base'
    const written = vi.fn()
    const deps: MessageEditorDeps = {
        getMessage: () => message,
        setMessage: (value) => { message = value },
        getIdx: () => 0,
        currentMessageIdentity: () => ({ kind: 'msg', chatKey: 'chat', chatId: 'row', index: 0 }),
        getTranslationCacheKey: async () => 'source',
        translationOpenToken: () => ({ identity: 'row', row: undefined, data: 'base', closeEpoch: chatSurface.closeEpoch }),
        translationOpenCurrent: (token) => token.closeEpoch === chatSurface.closeEpoch,
        isDestroyed: () => false,
        onTranslationCacheWritten: written,
        ...overrides,
    }
    let controller!: ReturnType<typeof createMessageEditorController>
    const destroy = $effect.root(() => {
        controller = createMessageEditorController(deps)
    })
    flushSync()
    return { controller, destroy, written }
}

beforeEach(() => {
    resetLocalDraftsForTest()
    draftContentOrphanGate.clear()
    chatSurface.closeEpoch = 0
    vi.mocked(getLLMCache).mockReset()
    vi.mocked(setLLMCache).mockReset()
    vi.mocked(getLLMCache).mockResolvedValue('cached')
    vi.mocked(setLLMCache).mockResolvedValue(undefined)
})
afterEach(() => {
    draftContentOrphanGate.clear()
    resetLocalDraftsForTest()
})

describe('T33 message editor controller', () => {
    it('registers original and translation drafts, then releases them on close and dispose', async () => {
        const { controller, destroy } = fixture()
        controller.startOriginalEdit()
        flushSync()
        expect(hasMessageEditorDrafts()).toBe(true)
        controller.editMode = false
        flushSync()
        expect(hasMessageEditorDrafts()).toBe(false)
        await controller.loadTranslationForEdit()
        flushSync()
        expect(hasMessageEditorDrafts()).toBe(true)
        controller.closeTranslationKeep()
        flushSync()
        expect(hasMessageEditorDrafts()).toBe(false)
        controller.startOriginalEdit()
        flushSync()
        controller.dispose()
        expect(hasMessageEditorDrafts()).toBe(false)
        destroy()
    })

    it('a close epoch keeps the original editor content record', async () => {
        const { controller, destroy } = fixture()
        controller.startOriginalEdit()
        controller.editBuffer = 'typed'
        controller.captureMessageEdit('typed')
        flushSync()
        chatSurface.closeEpoch += 1
        flushSync()
        expect(controller.editMode).toBe(false)
        expect(hasMessageEditorDrafts()).toBe(false)
        expect(draftContentOrphanGate.get({ kind: 'msg', chatKey: 'chat', chatId: 'row', index: 0 }, 'base')?.text).toBe('typed')
        destroy()
    })

    it('a close epoch keeps the translation editor content record', async () => {
        const { controller, destroy } = fixture()
        await controller.loadTranslationForEdit()
        expect(controller.editTranslationMode).toBe(true)
        controller.editTranslationText = 'translated'
        controller.captureTranslationEdit('translated')
        flushSync()
        chatSurface.closeEpoch += 1
        flushSync()
        expect(controller.editTranslationMode).toBe(false)
        expect(hasMessageEditorDrafts()).toBe(false)
        expect(draftContentOrphanGate.get({ kind: 'tr', key: 'source' }, 'source')?.text).toBe('translated')
        destroy()
    })

    it('M36: decrements the shared loading counter after a rejected load', async () => {
        const { controller, destroy } = fixture()
        const pending = deferred<string | null>()
        vi.mocked(getLLMCache).mockReturnValueOnce(pending.promise)
        const load = controller.loadTranslationForEdit()
        expect(translationEditLoading()).toBeGreaterThan(0)
        await Promise.resolve()
        expect(translationEditLoading()).toBeGreaterThan(0)
        pending.reject(new Error('cache failed'))
        await expect(load).rejects.toThrow('cache failed')
        expect(translationEditLoading()).toBe(0)
        destroy()
    })

    it('serialises writes per instance and reports each completed write', async () => {
        const first = fixture()
        const second = fixture()
        const gate = deferred<void>()
        const calls: string[] = []
        vi.mocked(setLLMCache).mockImplementation(async (key: string, data: string) => {
            calls.push(data)
            if (data === 'first') await gate.promise
        })
        const a = first.controller.updateTranslationCache('source', 'first')
        const b = first.controller.updateTranslationCache('source', 'second')
        const c = second.controller.updateTranslationCache('source', 'other')
        await Promise.resolve()
        expect(calls).toContain('first')
        expect(calls).toContain('other')
        expect(calls).not.toContain('second')
        gate.resolve()
        await Promise.all([a, b, c])
        expect(calls.indexOf('second')).toBeGreaterThan(calls.indexOf('first'))
        expect(first.written).toHaveBeenCalledTimes(2)
        expect(second.written).toHaveBeenCalledTimes(1)
        first.destroy()
        second.destroy()
    })

    it('closeTranslationKeep preserves the tr record and closes the editor', async () => {
        const { controller, destroy } = fixture()
        await controller.loadTranslationForEdit()
        controller.editTranslationText = 'kept'
        controller.captureTranslationEdit('kept')
        closeTranslationKeep(controller)
        flushSync()
        expect(controller.editTranslationMode).toBe(false)
        expect(controller.editTranslationKey).toBeNull()
        expect(draftContentOrphanGate.get({ kind: 'tr', key: 'source' }, 'source')?.text).toBe('kept')
        destroy()
    })
    it('restores only a matching frozen original draft and confirms discard', async () => {
        const identity = { kind: 'msg' as const, chatKey: 'chat', chatId: 'row', index: 0 }
        draftContentOrphanGate.set(identity, 'older typing', 'base')
        const { controller, destroy } = fixture()
        controller.startOriginalEdit()
        expect(controller.editBuffer).toBe('older typing')
        expect(controller.restoredMessageRecord?.text).toBe('older typing')
        controller.editBuffer = 'new typing'
        controller.captureMessageEdit('new typing')
        await controller.requestDiscardOriginalEdit()
        flushSync()
        expect(controller.editMode).toBe(false)
        expect(draftContentOrphanGate.get(identity, 'base')).toBeUndefined()
        destroy()
    })

    it('saves the frozen translation key through the shared chain', async () => {
        const { controller, written, destroy } = fixture()
        await controller.loadTranslationForEdit()
        expect(controller.editTranslationKey).toBe('source')
        controller.editTranslationText = 'changed'
        controller.captureTranslationEdit('changed')
        await controller.saveTranslationEdit()
        expect(setLLMCache).toHaveBeenCalledWith('source', 'changed')
        expect(written).toHaveBeenCalledTimes(1)
        expect(controller.editTranslationMode).toBe(false)
        destroy()
    })

    it('disables opening controls while the other editor or a load is active', async () => {
        const { controller, destroy } = fixture()
        controller.startOriginalEdit()
        flushSync()
        expect(controller.translationViewControlsDisabled).toBe(true)
        expect(controller.translationEditControlDisabled).toBe(true)
        await controller.loadTranslationForEdit()
        expect(getLLMCache).not.toHaveBeenCalled()
        controller.editMode = false
        flushSync()
        await controller.loadTranslationForEdit()
        flushSync()
        expect(controller.originalEditControlDisabled).toBe(true)
        controller.startOriginalEdit()
        controller.toggleOriginalEdit()
        expect(controller.editMode).toBe(false)
        expect(controller.editTranslationMode).toBe(true)
        destroy()
    })

    it('releases the loading counter when the translation key is absent', async () => {
        const { controller, destroy } = fixture({ getTranslationCacheKey: async () => null })
        await controller.loadTranslationForEdit()
        expect(translationEditLoading()).toBe(0)
        expect(controller.loadingTranslationEdit).toBe(false)
        expect(controller.editTranslationMode).toBe(false)
        expect(getLLMCache).not.toHaveBeenCalled()
        destroy()
    })

    it('orders a save and a partial translation update on one chain', async () => {
        const { controller, written, destroy } = fixture()
        await controller.loadTranslationForEdit()
        controller.editTranslationText = 'saved'
        const gate = deferred<void>()
        const calls: string[] = []
        vi.mocked(setLLMCache).mockImplementation(async (_key: string, data: string) => {
            calls.push(data)
            if (data === 'saved') await gate.promise
        })
        const save = controller.saveTranslationEdit()
        const partial = controller.updateTranslationCache('source', 'partial')
        await Promise.resolve()
        expect(calls).toEqual(['saved'])
        gate.resolve()
        await Promise.all([save, partial])
        expect(calls).toEqual(['saved', 'partial'])
        expect(written).toHaveBeenCalledTimes(2)
        destroy()
    })
})
