// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: {} },
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        loadedStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/process/index.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return { doingChat: writable(false) } as unknown as typeof import('src/ts/process/index.svelte')
})
vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    markIdentitySeen: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))
vi.mock(import('src/ts/characters'), () => ({
    characterFormatUpdate: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: vi.fn(async () => ({
        read: async () => ({ bytes: null, version: null }),
        has: async () => false,
    })),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

import type { Database } from 'src/ts/storage/database.svelte'
import { copyNameFor, makeChatCopy } from 'src/ts/storage/store2/fastForward/chatCopy'
import { chaIdOf, chars, parsedKey, until } from './lineFixtures'
import { chatsAt, ffSetup, ffTeardown, mergeWorld, peerCommits, personalityOf, resolver, takenBy, type MergeWorld } from './ffFixtures'

/**
 * Stage 3C keep both. A chat becomes a copy of this page's version at the top of its owner's list, whichever character
 * owns it, and the original id holds the peer's; every other record keeps this page's version and the peer's tree is kept
 * as a restore point.
 */

beforeEach(() => {
    ffSetup()
})

afterEach(() => {
    ffTeardown()
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

async function storeHolds(w: MergeWorld, holds: (db: Database) => boolean) {
    await until(async () => holds((await w.page.freeze()).db), 'the own commit', 8000)
    return w.page.freeze()
}

describe('copyNameFor and makeChatCopy', () => {
    test('the name is "(Copy)", then the first "(Copy N)" the owner does not hold; an older marker is not stacked', () => {
        expect(copyNameFor('Chat', new Set(['Chat']))).toBe('Chat (Copy)')
        expect(copyNameFor('Chat', new Set(['Chat (Copy)']))).toBe('Chat (Copy 2)')
        expect(copyNameFor('Chat', new Set(['Chat (Copy)', 'Chat (Copy 2)']))).toBe('Chat (Copy 3)')
        expect(copyNameFor('Chat (Copy 2)', new Set(['Chat (Copy 2)']))).toBe('Chat (Copy)')
    })

    test('the copy is a clone with a given id, a copy name and no streaming flag; the original is not touched', () => {
        const original = { id: 'a', name: 'Chat', isStreaming: true, message: [{ role: 'user', data: 'hi' }] }
        const copy = makeChatCopy(original, new Set(['Chat']), 'fresh-id')
        expect(copy).toEqual({ id: 'fresh-id', name: 'Chat (Copy)', message: [{ role: 'user', data: 'hi' }] })
        expect(original.isStreaming).toBe(true)
        expect((copy.message as unknown[])).not.toBe(original.message)
    })
})

describe('a chat both sides changed (P9)', () => {
    test('P9 keep both for an unselected character: the copy is at the top with this page\'s version and a fresh id, the original holds the peer\'s, the view stays on the original, and the next pass writes the copy', async () => {
        const w = await mergeWorld()
        const { b } = w
        const original = chatsAt(b.db, 3)[0]
        const originalId = String(original.id)
        const originalName = String(original.name)
        const held = resolver(w)
        original.note = 'mine note'
        await peerCommits(w, (db) => { chatsAt(db, 3)[0].note = 'peer note' })
        await takenBy(b, w.memory)
        expect(held.calls[0][0]).toMatchObject({ keepBoth: 'copy', preselect: 'both' })
        const chats = chatsAt(b.db, 3)
        expect(chats).toHaveLength(3)
        expect(chats[0].note).toBe('mine note')
        expect(chats[0].name).toBe(`${originalName} (Copy)`)
        expect(String(chats[0].id)).toMatch(UUID)
        expect(chats[0].id).not.toBe(originalId)
        expect(chats[1]).toBe(original)
        expect(chats[1].id).toBe(originalId)
        expect(chats[1].note).toBe('peer note')
        // The view stays on the original id: it moved from index 0 to index 1.
        expect(chars(b.db)[3].chatPage).toBe(1)
        const frozen = await storeHolds(w, db => chatsAt(db, 3).some(chat => String(chat.name).endsWith('(Copy)')))
        expect(chatsAt(frozen.db, 3).find(chat => String(chat.name).endsWith('(Copy)'))?.note).toBe('mine note')
        expect(chatsAt(frozen.db, 3).find(chat => chat.id === originalId)?.note).toBe('peer note')
    })

    test('a name taken in this character only is resolved against this character\'s chat names', async () => {
        const w = await mergeWorld()
        const { b } = w
        const first = chatsAt(b.db, 3)[0]
        const name = String(first.name)
        chatsAt(b.db, 3)[1].name = `${name} (Copy)`
        resolver(w)
        first.note = 'mine note'
        await peerCommits(w, (db) => { chatsAt(db, 3)[0].note = 'peer note' })
        await takenBy(b, w.memory)
        expect(chatsAt(b.db, 3)[0].name).toBe(`${name} (Copy 2)`)
    })

    test('the copy is made for the keep-both answer only: keep theirs and keep mine leave the chat list as it was', async () => {
        for (const choice of ['theirs', 'mine'] as const) {
            ffSetup()
            const w = await mergeWorld()
            resolver(w, () => choice)
            chatsAt(w.b.db, 3)[0].note = 'mine note'
            await peerCommits(w, (db) => { chatsAt(db, 3)[0].note = 'peer note' })
            await takenBy(w.b, w.memory)
            expect(chatsAt(w.b.db, 3)).toHaveLength(2)
            expect(chatsAt(w.b.db, 3)[0].note).toBe(choice === 'theirs' ? 'peer note' : 'mine note')
            ffTeardown()
        }
    })
})

describe('a record that is not a chat (restore point)', () => {
    test('keep both for the card keeps this page\'s card, and the commit that follows keeps the peer\'s tree as a restore point', async () => {
        const w = await mergeWorld()
        const { b } = w
        // Held so this page cannot commit its own tree before the peer's tree key is read.
        const held = resolver(w, () => undefined, { held: true })
        chars(b.db)[3].personality = 'mine card'
        await peerCommits(w, (db) => { chars(db)[3].personality = 'peer card' })
        const peerTree = (await parsedKey(w.memory)).current?.key
        held.release()
        await takenBy(b, w.memory)
        expect(personalityOf(b.db, 3)).toBe('mine card')
        await until(async () => (await parsedKey(w.memory)).current?.key !== peerTree, 'the own commit', 8000)
        const key = await parsedKey(w.memory)
        expect(key.retained[0].key).toBe(peerTree)
        const frozen = await w.page.freeze()
        expect(personalityOf(frozen.db, 3)).toBe('mine card')
    })

    test('25 settings kept both: one restore point', async () => {
        const w = await mergeWorld()
        const { b } = w
        // Held so this page cannot commit its own tree before the peer's tree key is read.
        const held = resolver(w, () => undefined, { held: true })
        const names = Array.from({ length: 25 }, (_, index) => `peerTestSetting${index}`)
        for (const name of names) {
            Reflect.set(b.db, name, 1)
        }
        w.world.state.dirty = true
        await peerCommits(w, (db) => {
            for (const name of names) {
                Reflect.set(db, name, 2)
            }
        })
        const peerKey = await parsedKey(w.memory)
        const peerTree = peerKey.current?.key
        held.release()
        await takenBy(b, w.memory)
        await until(async () => (await parsedKey(w.memory)).current?.key !== peerTree, 'the own commit', 8000)
        const key = await parsedKey(w.memory)
        expect(key.retained.filter(entry => entry.key === peerTree)).toHaveLength(1)
        expect(key.retained.length).toBe(peerKey.retained.length + 1)
        expect(key.seq).toBe(peerKey.seq + 1)
    })
})

describe('which resolutions ask for a restore point (I18)', () => {
    async function commitsAfter(setup: (w: MergeWorld) => void, edit: (db: Database) => void, wait: (w: MergeWorld) => boolean, choice?: 'mine' | 'theirs'): Promise<Array<boolean | undefined>> {
        const w = await mergeWorld()
        const commit = vi.spyOn(w.b.context.session.committer, 'commit')
        resolver(w, () => choice)
        setup(w)
        await peerCommits(w, edit)
        await takenBy(w.b, w.memory)
        await until(() => wait(w), 'the own commit', 8000)
        // A later own commit asks for nothing: the request is owed once.
        const landed = commit.mock.calls.length
        chars(w.b.db)[0].personality = 'a later edit'
        w.world.mark(chaIdOf(w.b.db, 0))
        await until(() => commit.mock.calls.length > landed, 'the later own commit', 8000)
        return commit.mock.calls.map(call => call[1].keepPrevious)
    }

    test('only a keep both of a record that is not a chat asks, and only on the first commit that follows', async () => {
        const card = await commitsAfter(
            (w) => { chars(w.b.db)[3].personality = 'mine card'; w.world.state.dirty = true },
            (db) => { chars(db)[3].personality = 'peer card' },
            w => w.world.state.saved >= 2,
        )
        expect(card[0]).toBe(true)
        expect(card.slice(1)).not.toContain(true)
        expect(card.length).toBeGreaterThanOrEqual(2)
        ffTeardown()
        ffSetup()
        const chat = await commitsAfter(
            (w) => { chatsAt(w.b.db, 3)[0].note = 'mine note'; w.world.state.dirty = true },
            (db) => { chatsAt(db, 3)[0].note = 'peer note' },
            w => w.world.state.saved >= 2,
        )
        expect(chat).not.toContain(true)
        // RET4: keep mine and keep theirs ask for nothing.
        for (const choice of ['mine', 'theirs'] as const) {
            ffTeardown()
            ffSetup()
            const only = await commitsAfter(
                (w) => { chars(w.b.db)[3].personality = 'mine card'; w.world.state.dirty = true },
                (db) => { chars(db)[3].personality = 'peer card' },
                w => w.world.state.saved >= 2,
                choice,
            )
            expect(only).not.toContain(true)
        }
    })
})
