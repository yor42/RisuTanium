import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatDraftEntry } from 'src/ts/storage/database.svelte'
import type { MessageIdentity } from 'src/ts/draftContents'

/**
 * The writer over a plain database object: the store reads and writes `DBState.db.chatDrafts` and nothing else, so the
 * pure rules (cap, duplicate merge, fail-open flush, immediate deletes) are driven here without a controller. The restart and
 * hide paths are covered by editDraftReload and the store2 suites.
 */

type Db = { chatDrafts?: unknown, characters: { chaId: string, chats: { id: string }[] }[] }
const NOW = 1_700_000_000_000
// First 128 bits of SHA-256 over the UTF-8 bytes of the text, computed once with node:crypto (not by the code under test).
const KOREAN_EMOJI_DIGEST = { text: '안녕 😀 café', digest: 'c82329ae1484ab97b016fe0d3ab4818f' }

async function fresh(db: Db) {
    vi.resetModules()
    vi.doMock('src/ts/stores.svelte', () => ({ DBState: { db } }))
    const store = await import('src/ts/chatDraftStore')
    const gate = await import('src/ts/draftContentOrphanGate')
    return { store, gate, db }
}

function identity(chat: string, key: string, options: { chaId?: string } = {}): MessageIdentity {
    return { kind: 'msg', chatKey: 'window', chatId: key, index: 0, persist: { chaId: options.chaId ?? 'cha', chatId: chat } }
}

function draftsOf(db: Db): ChatDraftEntry[] {
    return (db.chatDrafts ?? []) as ChatDraftEntry[]
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(NOW)
})
afterEach(() => {
    vi.useRealTimers()
})

describe('base digest', () => {
    // PIN: the stored base is the first 128 bits of the SHA-256 of the UTF-8 bytes; a UTF-16 or full-width digest differs.
    it('T1.11 / M42: matches the committed vector over non-ASCII text', async () => {
        const { store } = await fresh({ characters: [] })

        expect(store.chatDraftBaseDigest(KOREAN_EMOJI_DIGEST.text)).toBe(KOREAN_EMOJI_DIGEST.digest)
    })
})

describe('T3.5 the 200-draft cap', () => {
    it('keeps the 200 newest by time, and flags do not count', async () => {
        const db: Db = { characters: [] }
        const { store, gate } = await fresh(db)
        for (let index = 0; index < 201; index++) {
            vi.setSystemTime(NOW + index)
            gate.draftContentOrphanGate.set(identity('chat', `m${String(index).padStart(3, '0')}`), `text ${index}`, 'base')
        }
        for (let index = 0; index < 5; index++) {
            store.markLongChatHintShown('cha', `flagged-${index}`)
        }

        store.flushChatDrafts()

        const kept = draftsOf(db).find((entry) => entry.chat === 'chat')?.drafts ?? []
        expect(kept).toHaveLength(200)
        expect(kept.map((draft) => draft.m)).not.toContain('id:m000')
        expect(kept.map((draft) => draft.m)).toContain('id:m200')
        expect(draftsOf(db).filter((entry) => entry.shown === true)).toHaveLength(5)
    })

    it('breaks a tie by dropping the lowest chat key then message key, the same every time', async () => {
        const db: Db = { characters: [] }
        const { store, gate } = await fresh(db)
        for (let index = 0; index < 201; index++) {
            gate.draftContentOrphanGate.set(identity('chat', `m${String(index).padStart(3, '0')}`), `text ${index}`, 'base', NOW)
        }

        store.flushChatDrafts()

        const kept = draftsOf(db)[0].drafts?.map((draft) => draft.m) ?? []
        expect(kept).toHaveLength(200)
        expect(kept).not.toContain('id:m000')
    })
})

describe('T3.16 / T3.17 a flush is fail-open and keeps what it cannot judge', () => {
    it('T3.16: a text flush runs no reconcile, so an entry whose character is missing survives', async () => {
        const gone: ChatDraftEntry = { cha: 'removed', chat: 'x', drafts: [{ m: 'id:m1', text: 'orphan', bh: 'a'.repeat(32), at: 5 }] }
        const db: Db = { characters: [{ chaId: 'cha', chats: [{ id: 'chat' }] }], chatDrafts: [gone] }
        const { store, gate } = await fresh(db)
        gate.draftContentOrphanGate.set(identity('chat', 'm2'), 'typed', 'base')

        store.flushChatDrafts()

        expect(draftsOf(db).map((entry) => entry.cha)).toEqual(['cha', 'removed'])
    })

    it('T3.17: duplicate keys keep the newest draft and OR the flags; unkeyable items are dropped; extra keys survive', async () => {
        const draft = (text: string, at: number, extra: Record<string, unknown> = {}) => ({ m: 'id:m1', text, bh: 'b'.repeat(32), at, ...extra })
        const db: Db = {
            characters: [],
            chatDrafts: [
                { cha: 'c', chat: 'k', shown: true, futureEntry: 'one', drafts: [draft('old', 5, { futureDraft: 1 })] },
                { cha: 'c', chat: 'k', futureEntry2: 'two', drafts: [draft('new', 9, { futureDraft: 2 }), { m: 'id:broken', text: 7 }] },
                { nothing: true },
                { cha: 'c' },
                'text',
                { cha: 'z', chat: 'k', futureEntry: 'solo', drafts: [draft('solo', 1, { futureDraft: 3 })] },
            ],
        }
        const { store, gate } = await fresh(db)
        gate.draftContentOrphanGate.set(identity('other', 'm9'), 'typed', 'base')

        store.flushChatDrafts()

        const merged = draftsOf(db).find((entry) => entry.cha === 'c' && entry.chat === 'k')
        expect(draftsOf(db).map((entry) => `${entry.cha}/${entry.chat}`)).toEqual(['c/k', 'cha/other', 'z/k'])
        expect(merged).toMatchObject({ shown: true, futureEntry: 'one', futureEntry2: 'two' })
        expect(merged?.drafts).toEqual([draft('new', 9, { futureDraft: 2 })])
        expect(draftsOf(db).find((entry) => entry.cha === 'z')?.drafts?.[0]).toMatchObject({ futureDraft: 3 })
    })

    it('an update of a stored message keeps the extra keys of its stored draft', async () => {
        const db: Db = {
            characters: [],
            chatDrafts: [{ cha: 'cha', chat: 'chat', drafts: [{ m: 'id:m1', text: 'before', bh: 'c'.repeat(32), at: 1, futureDraft: 'kept' }] }],
        }
        const { store, gate } = await fresh(db)
        gate.draftContentOrphanGate.set(identity('chat', 'm1'), 'after', 'base')

        store.flushChatDrafts()

        expect(draftsOf(db)[0].drafts?.[0]).toMatchObject({ text: 'after', futureDraft: 'kept', at: NOW })
    })

    it('a flush with nothing pending does not assign the key and reports no change', async () => {
        const stored: ChatDraftEntry[] = [{ cha: 'cha', chat: 'chat', drafts: [{ m: 'id:m1', text: 't', bh: 'c'.repeat(32), at: 1 }] }]
        const db: Db = { characters: [], chatDrafts: stored }
        const { store } = await fresh(db)

        expect(store.flushChatDrafts()).toBe(false)
        expect(db.chatDrafts).toBe(stored)
    })

    it('a persist sink that throws never reaches the caller of the gate', async () => {
        const { gate } = await fresh({ characters: [] })
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        gate.setDraftPersistSink({ set() { throw new Error('sink') }, delete() { throw new Error('sink') }, flush: () => false })
        try {
            expect(() => gate.draftContentOrphanGate.set(identity('chat', 'm1'), 'text', 'base')).not.toThrow()
            expect(() => gate.draftContentOrphanGate.delete(identity('chat', 'm1'))).not.toThrow()
        } finally {
            logged.mockRestore()
        }
    })
})

describe('the gate flush', () => {
    it('reports no change when no store has installed its sink, and flushes through the sink once it has', async () => {
        const db: Db = { characters: [] }
        vi.resetModules()
        vi.doMock('src/ts/stores.svelte', () => ({ DBState: { db } }))
        const gate = await import('src/ts/draftContentOrphanGate')
        expect(gate.flushPersistedDrafts()).toBe(false)

        await import('src/ts/chatDraftStore')
        gate.draftContentOrphanGate.set(identity('chat', 'm1'), 'typed', 'base')

        expect(gate.flushPersistedDrafts()).toBe(true)
        expect(draftsOf(db)[0].drafts?.[0]).toMatchObject({ text: 'typed' })
        expect(gate.flushPersistedDrafts()).toBe(false)
    })
})

describe('chat removal and the idle timer', () => {
    it('forgetChatDrafts drops the chat and its pending overlay, so a later idle flush does not bring it back', async () => {
        const db: Db = { characters: [] }
        const { store, gate } = await fresh(db)
        gate.draftContentOrphanGate.set(identity('doomed', 'm1'), 'stored', 'base')
        store.flushChatDrafts()
        gate.draftContentOrphanGate.set(identity('doomed', 'm2'), 'still pending', 'base')
        gate.draftContentOrphanGate.set(identity('kept', 'm1'), 'other chat', 'base')

        store.forgetChatDrafts('cha', 'doomed')
        vi.advanceTimersByTime(10_000)

        expect(draftsOf(db).map((entry) => entry.chat)).toEqual(['kept'])
    })

    it('a pending draft is written after the idle window and not before', async () => {
        const db: Db = { characters: [] }
        const { gate } = await fresh(db)
        gate.draftContentOrphanGate.set(identity('chat', 'm1'), 'typed', 'base')

        vi.advanceTimersByTime(2999)
        expect(db.chatDrafts).toBeUndefined()
        vi.advanceTimersByTime(1)

        expect(draftsOf(db)[0].drafts?.[0]).toMatchObject({ text: 'typed' })
    })
})

describe('lookup of a stored draft', () => {
    it('removes the same chat\'s index-keyed entry on a chat-id-keyed miss and never restores from it', async () => {
        const db: Db = {
            characters: [],
            chatDrafts: [{ cha: 'cha', chat: 'chat', drafts: [{ m: 'idx:0', text: 'old position', bh: 'd'.repeat(32), at: 3 }] }],
        }
        const { store } = await fresh(db)

        expect(store.lookupPersistedEditDraft(identity('chat', 'm1'), 'base')).toBeUndefined()
        expect(db.chatDrafts).toBeUndefined()
    })

    it('offers a draft only when the digest of the current text equals the stored base, with the capture time as its age', async () => {
        const db: Db = { characters: [] }
        const { store, gate } = await fresh(db)
        gate.draftContentOrphanGate.set(identity('chat', 'm1'), 'typed', 'base text')
        store.flushChatDrafts()

        expect(store.lookupPersistedEditDraft(identity('chat', 'm1'), 'base text')).toEqual({ text: 'typed', baseData: 'base text', updatedAt: NOW })
        expect(store.lookupPersistedEditDraft(identity('chat', 'm1'), 'another text')).toBeUndefined()
        expect(db.chatDrafts).toBeUndefined()
    })
})

describe('reconcile at boot and on removal', () => {
    it('drops entries of chats the profile lacks and keeps a trashed character\'s and a cold stub\'s', async () => {
        const db: Db = {
            characters: [
                { chaId: 'live', chats: [{ id: 'chat-live' }] },
                { chaId: 'trashed', trashTime: 1, chats: [{ id: 'chat-trashed' }] } as Db['characters'][number],
                { chaId: 'stub', coldstorage: 'u', chats: [{ id: 'placeholder' }] } as Db['characters'][number],
            ],
            chatDrafts: ['live/chat-live', 'live/gone', 'trashed/chat-trashed', 'stub/anything', 'missing/x'].map((key) => {
                const [cha, chat] = key.split('/')
                return { cha, chat, drafts: [{ m: 'id:m', text: 't', bh: 'e'.repeat(32), at: 1 }] }
            }),
        }
        const { store } = await fresh(db)

        expect(store.reconcileChatDraftsAtBoot()).toBe(true)

        expect(draftsOf(db).map((entry) => `${entry.cha}/${entry.chat}`)).toEqual(['live/chat-live', 'stub/anything', 'trashed/chat-trashed'])
    })
})
