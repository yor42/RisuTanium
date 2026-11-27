// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    db: { ltmEngine: true as boolean | undefined, ltmSettings: { retrieval: 'hybrid' } as unknown },
    store: null as unknown,
}))
vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: () => h.db, appVer: '9.9.9' }))
// The real selector pulls the whole app's reactive state in; the byte store a page would resolve is what the tests inject.
vi.mock('src/ts/storage/store/appStore', () => ({
    getAppStore: async () => {
        if (h.store === null) throw new Error('This page has no storage.')
        return h.store
    },
}))

import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import type { ChatDraftSlot } from 'src/ts/chatDraftsModel'
import { DenseStore } from '../dense'
import {
    MAGIC,
    PREFIX,
    chunkKey,
    encodeHead,
    flushVectorPersist,
    folderPrefix,
    headKey,
    holdVectorPersist,
    resetVectorPersistForTests,
    segOf,
    sweepVectorsAtBoot,
    vectorsPresent,
    type VectorHead,
} from '../vectorPersist'

let mem: MemoryByteStore

beforeEach(() => {
    mem = createMemoryByteStore()
    h.store = mem
    setPageStorageMode({ kind: 'store2' })
    resetVectorPersistForTests()
    h.db = { ltmEngine: true, ltmSettings: { retrieval: 'hybrid' } }
    setVisibility('visible')
})
afterEach(() => {
    h.store = null
    resetPageStorageModeForTests()
    resetVectorPersistForTests()
    setVisibility('visible')
    vi.restoreAllMocks()
})

function setVisibility(state: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
}

/** A readable folder (head and one chunk) of a chat; returns its seg. */
function seed(owner: string, chat: string, at = 1): string {
    const seg = segOf(`${owner}:${chat}`)
    const head: VectorHead = { f: MAGIC, v: 1, g: 1, w: 'x', owner, chat, model: 'm', label: 'l', dim: 4, chunks: [1], at }
    mem.files.set(headKey(seg), encodeHead(head))
    mem.files.set(chunkKey(seg, 1), new Uint8Array([1, 2, 3]))
    return seg
}

const has = (seg: string): boolean => [...mem.files.keys()].some((k) => k.startsWith(folderPrefix(seg)))

const SLOTS: ChatDraftSlot[] = [
    { chaId: 'live', chats: [{ id: 'c1' }] },
    { chaId: 'trashed', chats: [{ id: 't1' }] },
    { chaId: 'stub', coldstorage: 'uuid', chats: [{ id: 'placeholder' }] },
    { chaId: 'shared', chats: [{ id: 's1' }] },
    { chaId: 'shared', chats: [{ id: 's2' }] },
]

describe('G8 the boot sweep applies the draft ownership rule to the vector folders', () => {
    test('guard: a deleted owner or chat loses its folder; trashed, stub, cold-body and shared-id chats keep theirs', async () => {
        const kept = [seed('live', 'c1'), seed('trashed', 't1'), seed('stub', 'cold-body-chat-id'), seed('shared', 's1'), seed('shared', 's2')]
        const lost = [seed('absent', 'c1'), seed('live', 'not-in-slot'), seed('shared', 's3')]
        await sweepVectorsAtBoot(SLOTS)
        for (const seg of kept) expect(has(seg), seg).toBe(true)
        for (const seg of lost) expect(has(seg), seg).toBe(false)
    })

    test('guard: a chat that only a non-stub slot lacks is lost even though another owner has the id', async () => {
        const seg = seed('live', 'c-other-owner')
        await sweepVectorsAtBoot([...SLOTS, { chaId: 'other', chats: [{ id: 'c-other-owner' }] }])
        expect(has(seg)).toBe(false)
    })

    test('guard: a foreign folder is never touched and a damaged one is removed', async () => {
        const foreign = new TextEncoder().encode(JSON.stringify({ f: MAGIC, v: 2 }))
        mem.files.set(headKey('newer'), foreign)
        mem.files.set(chunkKey('newer', 1), new Uint8Array([9]))
        mem.files.set(headKey('bad'), new Uint8Array([0]))
        mem.files.set(chunkKey('headless', 1), new Uint8Array([1]))
        await sweepVectorsAtBoot(SLOTS)
        expect([...mem.files.keys()].sort()).toEqual([chunkKey('newer', 1), headKey('newer')].sort())
        expect(Array.from(mem.files.get(headKey('newer'))!)).toEqual(Array.from(foreign))
    })

    test('guard: a read-only page, a held page and a page without a store delete nothing; the held sweep runs on release', async () => {
        const seg = seed('absent', 'c1')
        setPageStorageMode({ kind: 'read-only', reason: 'older-version' } as never)
        await sweepVectorsAtBoot(SLOTS)
        expect(has(seg)).toBe(true)
        setPageStorageMode({ kind: 'store2' })
        h.store = null
        await sweepVectorsAtBoot(SLOTS)
        h.store = mem
        expect(has(seg)).toBe(true)
        const release = await holdVectorPersist()
        void sweepVectorsAtBoot(SLOTS)
        await flushVectorPersist()
        expect(has(seg)).toBe(true)
        release()
        await flushVectorPersist()
        expect(has(seg)).toBe(false)
    })

    test('guard: a hidden page deletes nothing and the remembered sweep runs when it is visible again', async () => {
        const seg = seed('absent', 'c1')
        setVisibility('hidden')
        await sweepVectorsAtBoot(SLOTS)
        expect(has(seg)).toBe(true)
        setVisibility('visible')
        await flushVectorPersist()
        expect(has(seg)).toBe(false)
    })
})

describe('G15 the boot sweep with the engine or hybrid retrieval off', () => {
    test('guard: every readable and damaged folder goes, a foreign one stays, and a later persist writes nothing', async () => {
        h.db.ltmEngine = false
        const owned = seed('live', 'c1')
        mem.files.set(headKey('bad'), new Uint8Array([0]))
        const foreign = new TextEncoder().encode(JSON.stringify({ f: MAGIC, v: 5 }))
        mem.files.set(headKey('newer'), foreign)
        await sweepVectorsAtBoot(SLOTS)
        expect(has(owned)).toBe(false)
        expect(has('bad')).toBe(false)
        expect(Array.from(mem.files.get(headKey('newer'))!)).toEqual(Array.from(foreign))
        mem.writes.length = 0
        const s = new DenseStore()
        s.bindPersist({ chaId: 'live', chatId: 'c1' })
        s.useModel('modelA|u|c|tag')
        s.set({ key: 'r\u0000h', ordinal: 0, off: 0, text: 't' }, Float32Array.from([1, 2, 3, 4]))
        const { requestPersist } = await import('../vectorPersist')
        requestPersist(s)
        await flushVectorPersist()
        expect(mem.writes).toEqual([])
    })

    test('guard: hybrid retrieval off sweeps the same way', async () => {
        h.db.ltmSettings = { retrieval: 'lexical' }
        const owned = seed('live', 'c1')
        await sweepVectorsAtBoot(SLOTS)
        expect(has(owned)).toBe(false)
    })
})

describe('vectorsPresent', () => {
    test('is true for any key under the prefix, a newer version\'s folder included, and false otherwise', async () => {
        expect(await vectorsPresent()).toBe(false)
        mem.files.set(headKey('newer'), new TextEncoder().encode(JSON.stringify({ f: MAGIC, v: 2 })))
        expect(await vectorsPresent()).toBe(true)
        mem.files.clear()
        mem.files.set('other/key', new Uint8Array([1]))
        expect(await vectorsPresent()).toBe(false)
        expect(PREFIX.endsWith('/')).toBe(true)
    })

    test('a failing list is false', async () => {
        vi.spyOn(mem, 'list').mockRejectedValue(new Error('list failed'))
        expect(await vectorsPresent()).toBe(false)
        h.store = null
        expect(await vectorsPresent()).toBe(false)
    })
})
