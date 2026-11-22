// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assembleDatabase, unitMapSource } from 'src/ts/storage/store2/codec'
import { buildSmall, encodeWith } from 'src/ts/storage/tests/store2/codecFixtures'
import type { ChatDraftEntry, Database } from 'src/ts/storage/database.svelte'
import type { MessageEditorDeps } from 'src/ts/process/messageEditorController.svelte'

vi.mock('src/ts/translator/translator', () => ({
    getLLMCache: vi.fn(async () => 'cached'),
    setLLMCache: vi.fn(async () => {}),
}))
vi.mock('src/ts/process/memory/measureFlag', () => ({ MEASURE: false }))
vi.mock('src/ts/process/chatPhaseRing', () => ({ noteEditConfirm: vi.fn() }))
vi.mock('src/ts/alert', () => ({ alertConfirm: vi.fn(async () => true) }))
vi.mock('src/lang', () => ({ language: { messageEditDiscardConfirm: 'Discard?' } }))

/**
 * Original-message edit drafts across a restart, driven through the real controller, the real gate and the real leave rule;
 * the restart is a module reset plus the profile the store2 codec assembles from what the first page left in its database.
 * R1a and T3.1 import only modules that exist before the change, so they fail by assertion on the pre-change code.
 */

const NOW = 1_700_000_000_000
const BASE = 'the reply as it was saved'
const TYPED = 'the reply, partly rewritten'

type Row = { role: string, data: string, time: number, chatId?: string }
type Shape = { characters: { chaId: string, chatPage: number, chats: { id: string, message: Row[] }[] }[], chatDrafts?: ChatDraftEntry[] }

function profile(withChatId = true): Database {
    const db = buildSmall(1) as unknown as Shape
    const messages = db.characters[0].chats[0].message
    messages[1] = { role: 'user', data: BASE, time: 2, ...(withChatId ? { chatId: 'm-1' } : {}) }
    db.characters[0].chatPage = 0
    return db as unknown as Database
}

/**
 * One page load: a fresh module graph with its own copy of Svelte's runtime, so the state the mocks make lives in the same runtime as the
 * controller's effects. The save entry points are only what the leave rule calls; the save loop itself is covered by the store2 suites.
 */
async function open(db: Database, options: { persist?: boolean } = {}) {
    vi.resetModules()
    vi.doMock('src/ts/stores.svelte', () => ({ DBState: { db: {} }, selIdState: { selId: 0 } }))
    vi.doMock('src/lib/ChatScreens/chatSurface.svelte', async () => {
        const { proxy } = await import('svelte/internal/client')
        return { chatSurface: proxy({ closeEpoch: 0 }) }
    })
    vi.doMock('src/ts/globalApi.svelte', () => ({ requestSaveNow: vi.fn(), requestNetSweep: vi.fn(), hasUnsavedSaveMarks: vi.fn(() => false) }))
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = db
    const editor = await import('src/ts/process/messageEditorController.svelte')
    const hide = await import('src/ts/process/saveOnHide')
    const globalApi = await import('src/ts/globalApi.svelte')
    const { chatSurface } = await import('src/lib/ChatScreens/chatSurface.svelte')
    const shape = (): Shape => stores.DBState.db as unknown as Shape
    const row = (): Row => shape().characters[0].chats[0].message[1]
    const deps: MessageEditorDeps = {
        getMessage: () => row().data,
        setMessage: (value) => { row().data = value },
        getIdx: () => 1,
        currentMessageIdentity: () => ({
            kind: 'msg',
            chatKey: 'window',
            chatId: row().chatId,
            index: 1,
            ...(options.persist === false ? {} : { persist: { chaId: shape().characters[0].chaId, chatId: shape().characters[0].chats[0].id } }),
        }),
        getTranslationCacheKey: async () => 'source',
        translationOpenToken: () => ({ identity: 'row', row: undefined, data: BASE, closeEpoch: chatSurface.closeEpoch }),
        translationOpenCurrent: (token) => token.closeEpoch === chatSurface.closeEpoch,
        isDestroyed: () => false,
        onTranslationCacheWritten: vi.fn(),
    }
    const { flushSync } = await import('svelte')
    const { effect_root: effectRoot } = await import('svelte/internal/client')
    let controller!: ReturnType<typeof editor.createMessageEditorController>
    const destroy = effectRoot(() => {
        controller = editor.createMessageEditorController(deps)
    })
    flushSync()
    return { controller, destroy, hide, globalApi, chatSurface, stores, shape, flush: flushSync }
}
type Page = Awaited<ReturnType<typeof open>>

function type(page: Page, text: string): void {
    page.controller.startOriginalEdit()
    page.flush()
    page.controller.editBuffer = text
    page.controller.captureMessageEdit(text)
}

/** The profile a restart would load: what the codec stores of the page's database, assembled again. */
function restarted(page: Page): Database {
    const tree = encodeWith(page.stores.DBState.db as unknown as Database)
    return assembleDatabase(tree.manifest, unitMapSource(tree.units))
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(NOW)
})
afterEach(() => {
    vi.useRealTimers()
})

describe('R1a / T3.1 a draft typed before a hide is offered on Edit after a restart', () => {
    // REPRO (DESIGNED against 05bc0617d, demonstrated by the stage coder): the pre-change draft lives only in the module map.
    it('R1a: hide with no timer advance, restart, Edit shows the draft with its original age', async () => {
        const first = await open(profile())
        type(first, TYPED)
        first.hide.flushPageBeforeLeaving()
        const loaded = restarted(first)
        first.destroy()
        vi.setSystemTime(NOW + 60_000)

        const second = await open(loaded)
        second.controller.startOriginalEdit()

        expect(second.controller.editBuffer).toBe(TYPED)
        expect(second.controller.restoredMessageRecord?.updatedAt).toBe(NOW)
        second.destroy()
    })

    it('T3.1: the same for a message without a chat id, keyed by its index', async () => {
        const first = await open(profile(false))
        type(first, TYPED)
        first.hide.flushPageBeforeLeaving()
        const loaded = restarted(first)
        first.destroy()

        const second = await open(loaded)
        second.controller.startOriginalEdit()

        expect(second.controller.editBuffer).toBe(TYPED)
        expect(second.controller.restoredMessageRecord?.updatedAt).toBe(NOW)
        second.destroy()
    })

    it('a hide with a pending draft requests the save, and the draft rides on the one top-level key', async () => {
        const page = await open(profile())
        type(page, TYPED)
        page.hide.flushPageBeforeLeaving()

        expect(page.globalApi.requestSaveNow).toHaveBeenCalledTimes(1)
        expect(page.shape().chatDrafts).toHaveLength(1)
        expect(page.shape().chatDrafts?.[0].drafts?.[0]).toMatchObject({ m: 'id:m-1', text: TYPED, at: NOW })
        page.destroy()
    })

    it('a hide with nothing pending requests no save', async () => {
        const page = await open(profile())
        page.controller.startOriginalEdit()
        page.hide.flushPageBeforeLeaving()

        expect(page.globalApi.requestSaveNow).not.toHaveBeenCalled()
        page.destroy()
    })

    // GUARD: passes before and after the change.
    it('T3.2 (guard): a restarted page opens no editor by itself', async () => {
        const first = await open(profile())
        type(first, TYPED)
        first.hide.flushPageBeforeLeaving()
        const loaded = restarted(first)
        first.destroy()

        const second = await open(loaded)

        expect(second.controller.editMode).toBe(false)
        expect(second.controller.editBuffer).toBe('')
        second.destroy()
    })

    it('T3.3: a message whose text changed since is not restored, and the stored draft is removed at once', async () => {
        const first = await open(profile())
        type(first, TYPED)
        first.hide.flushPageBeforeLeaving()
        const loaded = restarted(first)
        first.destroy()
        ;(loaded as unknown as Shape).characters[0].chats[0].message[1].data = 'text changed elsewhere'

        const second = await open(loaded)
        second.controller.startOriginalEdit()

        expect(second.controller.editBuffer).toBe('text changed elsewhere')
        expect(second.controller.restoredMessageRecord).toBeNull()
        expect(second.shape().chatDrafts).toBeUndefined()
        second.destroy()
    })

    it('a restored draft keeps its capture time as its age on every later Edit, because it is never filed into the in-memory store', async () => {
        const first = await open(profile())
        type(first, TYPED)
        first.hide.flushPageBeforeLeaving()
        const loaded = restarted(first)
        first.destroy()
        vi.setSystemTime(NOW + 60_000)

        const second = await open(loaded)
        second.controller.startOriginalEdit()
        second.controller.editMode = false
        second.flush()
        second.controller.startOriginalEdit()

        expect(second.controller.restoredMessageRecord?.updatedAt).toBe(NOW)
        second.destroy()
    })

    it('a restored draft left untouched stays stored after the editor closes', async () => {
        const first = await open(profile())
        type(first, TYPED)
        first.hide.flushPageBeforeLeaving()
        const loaded = restarted(first)
        first.destroy()

        const second = await open(loaded)
        second.controller.startOriginalEdit()
        second.controller.editMode = false
        second.flush()

        expect(second.shape().chatDrafts?.[0].drafts?.[0]).toMatchObject({ text: TYPED, at: NOW })
        second.destroy()
    })
})

describe('R1b the idle timer path', () => {
    it('writes after 3,000 ms of quiet, and a keystroke inside the window restarts it', async () => {
        const page = await open(profile())
        type(page, 'a')
        expect(page.shape().chatDrafts).toBeUndefined()
        vi.advanceTimersByTime(2000)
        page.controller.captureMessageEdit('ab')
        vi.advanceTimersByTime(2999)
        expect(page.shape().chatDrafts).toBeUndefined()

        vi.advanceTimersByTime(1)

        expect(page.shape().chatDrafts?.[0].drafts?.[0]).toMatchObject({ m: 'id:m-1', text: 'ab' })
        page.destroy()
    })
})

describe('T3.4 / T3.11 what is never persisted', () => {
    it('T3.4: a translation edit reaches no stored draft', async () => {
        const page = await open(profile())
        await page.controller.loadTranslationForEdit()
        page.controller.editTranslationText = 'translated'
        page.controller.captureTranslationEdit('translated')
        page.hide.flushPageBeforeLeaving()
        vi.advanceTimersByTime(10_000)

        expect(page.shape().chatDrafts).toBeUndefined()
        page.destroy()
    })

    it('T3.11: a message whose chat or owner has no id stays memory-only, and the in-memory draft still restores', async () => {
        const page = await open(profile(), { persist: false })
        type(page, TYPED)
        page.hide.flushPageBeforeLeaving()
        vi.advanceTimersByTime(10_000)
        expect(page.shape().chatDrafts).toBeUndefined()

        page.controller.editMode = false
        page.flush()
        page.controller.startOriginalEdit()

        expect(page.controller.editBuffer).toBe(TYPED)
        page.destroy()
    })
})

describe('T3.6 deletes and the flag write at once', () => {
    async function withStoredDraft() {
        const page = await open(profile())
        type(page, TYPED)
        const store = await import('src/ts/chatDraftStore')
        store.flushChatDrafts()
        expect(page.shape().chatDrafts).toHaveLength(1)
        return { page, store }
    }

    it.each([
        ['save', (page: Page) => page.controller.toggleOriginalEdit()],
        ['discard', (page: Page) => page.controller.discardOriginalEdit(page.controller.frozenMessageIdentity)],
        ['revert', (page: Page) => page.controller.revertOriginalEdit()],
        ['typing back to the base text', (page: Page) => page.controller.captureMessageEdit(BASE)],
    ])('%s removes the stored draft with no timer advance', async (_name, act) => {
        const { page } = await withStoredDraft()

        act(page)

        expect(page.shape().chatDrafts).toBeUndefined()
        page.destroy()
    })

    it('marking the hint shown writes the flag with no timer advance', async () => {
        const page = await open(profile())
        const store = await import('src/ts/chatDraftStore')

        store.markLongChatHintShown('cha', 'chat')

        expect(page.shape().chatDrafts).toEqual([{ cha: 'cha', chat: 'chat', shown: true }])
        expect(store.isLongChatHintShown('cha', 'chat')).toBe(true)
        page.destroy()
    })
})

describe('T3.15 the editor closing writes the pending draft at once', () => {
    it.each([
        ['a close epoch', (page: Page) => { page.chatSurface.closeEpoch += 1; page.flush() }],
        ['the editor turned off', (page: Page) => { page.controller.editMode = false; page.flush() }],
        ['unmount', (page: Page) => { page.destroy() }],
    ])('%s', async (_name, close) => {
        const page = await open(profile())
        type(page, TYPED)
        expect(page.shape().chatDrafts).toBeUndefined()

        close(page)

        expect(page.shape().chatDrafts?.[0].drafts?.[0]).toMatchObject({ m: 'id:m-1', text: TYPED })
        page.destroy()
    })
})
