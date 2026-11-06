// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'
import { DBState, selectedCharID, selIdState } from '../stores.svelte'
import { doingChat } from '../process/index.svelte'
import { beginWork } from '../process/chatOrigin'
import { getLLMCache } from '../translator/translator'
import { createMessageEditorController, translationEditLoading, type MessageEditorDeps } from '../process/messageEditorController.svelte'
import { shellFlipBlocker } from './flipBlocker'

vi.mock('../translator/translator', async (importOriginal) => ({
    ...await importOriginal<typeof import('../translator/translator')>(),
    getLLMCache: vi.fn(),
}))

// The parser's module-level effect reads selIdState while the stores module is still initialising; this test never parses.
vi.mock('../parser/parser.svelte', () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
}))
vi.mock('../parser/chatML', () => ({ parseChatML: vi.fn(() => []) }))

function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((yes) => { resolve = yes })
    return { promise, resolve }
}

function installChat() {
    const chat = { id: 'flip-chat', message: [{ role: 'char', data: 'base', chatId: 'row' }] }
    const owner = { chaId: 'flip-owner', type: 'character', chatPage: 0, chats: [chat] }
    DBState.db = { characters: [owner], theme: '' } as never
    selectedCharID.set(0)
    selIdState.selId = 0
    return { owner: DBState.db.characters[0], chat: DBState.db.characters[0].chats[0] }
}

beforeEach(() => {
    installChat()
    doingChat.set(false)
    vi.mocked(getLLMCache).mockReset()
})

afterEach(() => { doingChat.set(false) })

describe('T20 real flip blocker producers', () => {
    it('blocks for the real generation flag', () => {
        doingChat.set(true)
        expect(shellFlipBlocker()?.reasonKey).toBe('chatShellFlipRefusedGenerating')
        doingChat.set(false)
        expect(shellFlipBlocker()).toBeNull()
    })

    it('blocks for real work registered on the on-screen chat', () => {
        const { owner, chat } = installChat()
        const work = beginWork(owner, chat)
        expect(work).not.toBeNull()
        expect(shellFlipBlocker()?.reasonKey).toBe('chatShellFlipRefusedWorking')
        work?.end()
        expect(shellFlipBlocker()).toBeNull()
    })

    it('blocks during a real translation-load counter increment', async () => {
        const pending = deferred<string | null>()
        vi.mocked(getLLMCache).mockReturnValueOnce(pending.promise)
        const deps: MessageEditorDeps = {
            getMessage: () => 'base',
            setMessage: () => {},
            getIdx: () => 0,
            currentMessageIdentity: () => ({ kind: 'msg', chatKey: 'flip-chat', chatId: 'row', index: 0 }),
            getTranslationCacheKey: async () => 'source',
            translationOpenToken: () => ({ identity: 'row', row: undefined, data: 'base', closeEpoch: 0 }),
            translationOpenCurrent: () => true,
            isDestroyed: () => false,
            onTranslationCacheWritten: () => {},
        }
        let controller!: ReturnType<typeof createMessageEditorController>
        const destroy = $effect.root(() => { controller = createMessageEditorController(deps) })
        flushSync()
        const load = controller.loadTranslationForEdit()
        await Promise.resolve()
        expect(translationEditLoading()).toBeGreaterThan(0)
        expect(shellFlipBlocker()?.reasonKey).toBe('chatShellFlipRefusedEditing')
        pending.resolve('translated')
        await load
        expect(translationEditLoading()).toBe(0)
        controller.closeTranslationKeep()
        flushSync()
        destroy()
        expect(shellFlipBlocker()).toBeNull()
    })
})
