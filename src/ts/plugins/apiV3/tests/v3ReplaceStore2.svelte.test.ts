/**
 * Label: compatibility guard. It passes before and after the legacy-encoder reload fix for a character slot replaced by one
 * of a different `chaId`; it is not a reproducer of that defect.
 *
 * Invariant: on a store2 page, a slot overwritten the way V3 `setCharacterToIndex` writes it
 * (`DBState.db.characters[charId] = char`) leaves the old character out of the next committed tree. The scoped codec builds
 * the manifest entries from the current `db.characters` only, so nothing re-emits the replaced character. The assertions
 * check the committed tree; they do not isolate how the save loop treats a mark of an id that is no longer present.
 *
 * Executed for real: the store2 save loop (`saveDb`), the identity tracker of `dbChangeEffects.svelte` (it notices the
 * replaced proxy and marks the new character), the encoder and the committer over `createMemoryBackend`, and the
 * assembly of the committed manifest (`Store2Kit.saved`, the tree a reload reads). Not executed: the plugin wrapper
 * `setCharacterToIndex` itself (permission prompt, placeholder restore, duplicate warnings need the whole plugin runtime),
 * so the equivalent assignment is driven; the replaced-id reload request of the legacy fix is not part of this path.
 * A memory backend says nothing about a native one.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeCharacter, makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, sleepReal, settled, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import type { Database } from 'src/ts/storage/database.svelte'

vi.setConfig({ testTimeout: 60_000 })

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

const worlds = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

type Entry = Record<string, unknown>

beforeEach(() => {
    vi.clearAllMocks()
    // The real identity tracker: `saveLoopMocks.svelte.ts` replaces it, and a replaced slot is noticed only by it.
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    // The factory runs inside the world's graph, so the reactive state and the effects share one Svelte runtime.
    vi.doMock('src/ts/stores.svelte', async () => {
        const { proxy } = await import('svelte/internal/client')
        const { writable } = await import('svelte/store')
        return {
            DBState: proxy({ db: {} as Entry }),
            selectedCharID: writable(-1),
            selIdState: { selId: -1 },
            alertStore: writable({ type: 'none', msg: '' }),
            MobileGUI: writable(false),
            botMakerMode: writable(false),
            loadedStore: writable(false),
            LoadingStatusState: { text: '' },
            ReloadGUIPointer: writable(0),
            bodyIntercepterStore: writable(null),
            savingStoppedReason: writable(null),
            frozenSaveKeysStore: writable([]),
        } as unknown as typeof import('src/ts/stores.svelte')
    })
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(() => {
    worlds.parkAll()
    vi.restoreAllMocks()
})

interface Page {
    w: World
    k: Store2Kit
    db: Entry
}

/** A store2 page over the memory backend whose live database is `db`; the first tree is seeded from a copy of it. */
async function startPage(db: Record<string, unknown>): Promise<Page> {
    h.db = db
    const k = await startStore2({ db: db as unknown as Database })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    w.start()
    await sleepReal(150)
    await settled(w)
    return { w, k, db: h.db }
}

/** A character made like the V3 plugin hands one over: its own `chaId` and its own chat ids. */
function incoming(chaId: string): Entry {
    return makeCharacter(chaId, { name: `replacement ${chaId}` })
}

/** A character whose `chaId` is a number, as an upstream `.bin` can carry one. */
function numericCharacter(chaId: number): Entry {
    const character = makeCharacter(`numeric-${chaId}`)
    character.chaId = chaId
    character.chats = [{ id: `numeric-${chaId}-chat`, message: [], note: '', name: '', localLore: [] }]
    return character
}

async function replaceAndCommit(page: Page, index: number, replacement: Entry): Promise<void> {
    const { flushSync } = await import('svelte')
    const before = (await page.k.commitKey()).current?.key
    await nextCommit(page.w, () => {
        // As `setCharacterToIndex` writes the slot: through the reactive list, by its key.
        const characters = page.db.characters as Entry[]
        characters[Number(Object.keys(characters)[index])] = replacement
        flushSync()
    })
    expect((await page.k.commitKey()).current?.key, 'precondition: the replacement was committed').not.toBe(before)
}

async function savedCharacters(page: Page): Promise<Entry[]> {
    return (await page.k.saved()).characters as unknown as Entry[]
}

describe('a character slot replaced by one of a different chaId, over the real store2 save loop', () => {
    test('guard: the replaced character is absent from the reloaded tree, the replacement is present once, the others are intact', async () => {
        const page = await startPage(makeDb('p', ['first', 'old', 'last']))
        expect((await savedCharacters(page)).map(c => c.chaId), 'precondition: the seeded tree holds the old character').toEqual(['first', 'old', 'last'])

        await replaceAndCommit(page, 1, incoming('new'))

        const saved = await savedCharacters(page)
        expect(saved.map(c => c.chaId)).toEqual(['first', 'new', 'last'])
        expect(saved.filter(c => c.chaId === 'new')).toHaveLength(1)
        expect(saved.some(c => c.chaId === 'old')).toBe(false)
        expect(saved.flatMap(c => (c.chats as Entry[]).map(chat => chat.id))).not.toContain('old-chat')
        expect((saved[0].chats as Entry[])[0].id).toBe('first-chat')
        expect((saved[2].chats as Entry[])[0].id).toBe('last-chat')
    })

    test('guard: a numeric chaId of the replaced character stays gone after the same replacement', async () => {
        const db = makeDb('p', ['first', 'last'])
        ;(db.characters as Entry[]).splice(1, 0, numericCharacter(42))
        const page = await startPage(db)
        expect((await savedCharacters(page)).map(c => c.chaId), 'precondition: the seeded tree holds the numeric character').toEqual(['first', 42, 'last'])

        await replaceAndCommit(page, 1, incoming('new'))

        const saved = await savedCharacters(page)
        expect(saved.map(c => c.chaId)).toEqual(['first', 'new', 'last'])
        expect(saved.filter(c => c.chaId === 'new')).toHaveLength(1)
        expect(saved.some(c => String(c.chaId) === '42')).toBe(false)
        expect(saved.flatMap(c => (c.chats as Entry[]).map(chat => chat.id))).not.toContain('numeric-42-chat')
        expect((saved[0].chats as Entry[])[0].id).toBe('first-chat')
        expect((saved[2].chats as Entry[])[0].id).toBe('last-chat')
    })
})
