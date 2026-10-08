/**
 * The save loop's live check of the character list (`saveDb()` in
 * `globalApi.svelte.ts`): an entry that is not a character is dropped, a
 * character with no id is given one, and the list the next start loads matches
 * the list the page holds.
 *
 * This file drives the REAL, unmocked `saveDb()` loop, `RisuSaveEncoder` and the
 * page's block-store owner against an in-memory byte store (see
 * `saveLoopWorld.ts`); every test starts a fresh module graph. A mocked success
 * here is not evidence of native backend behaviour.
 *
 * Title labels: (R) marks a reproducer that fails against a loop with no live
 * check; (G) marks a guard that passes with or without it.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { get } from 'svelte/store'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeCharacter, makeDb, mutationsOf, isBlockKey } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'

vi.setConfig({ testTimeout: 40_000 })

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

const kit = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

type Entry = Record<string, unknown>

// Longer than the save debounce (500 ms) plus a loop pass, so a write that would happen has happened.
const QUIET_MS = 1300

beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    kit.parkAll()
    vi.restoreAllMocks()
})

const characters = () => h.db!.characters as unknown[]

/** The character ids a fresh owner loads from the store, strictly decoded: what the next start would boot with. */
async function nextStart(w: World): Promise<string> {
    const { makeOwner } = await import('src/ts/storage/tests/blockStoreHarness')
    const { validateLoadedBlocks } = await import('src/ts/storage/blockProfileValidate')
    const { owner } = makeOwner(w.store)
    try {
        const loaded = await owner.load({ validate: validateLoadedBlocks })
        if (loaded.kind !== 'loaded') {
            return `not loaded: ${loaded.kind}`
        }
        return (loaded.tree.characters as unknown as Entry[]).map((c) => String(c.chaId)).join(',')
    } catch (error) {
        return `THROWS ${error instanceof Error ? error.message : String(error)}`
    }
}

async function toasts(): Promise<number> {
    const alerts = await import('src/ts/alert')
    return vi.mocked(alerts.alertToast).mock.calls.length
}

describe('an entry that is not a character (S1L)', () => {
    test.each([
        ['a number', 5],
        ['an empty list', []],
        ['null', null],
    ])('(R) %s pushed into the live list is dropped, the selection keeps its character, the person is told, and the next start loads the rest', async (_label, junk) => {
        h.db = makeDb('p', ['a', 'b'])
        const w = await kit.startWorld()
        const stores = await import('src/ts/stores.svelte')
        characters().splice(1, 0, junk)
        stores.selectedCharID.set(2)
        const told = await toasts()

        await until(() => !characters().includes(junk), 'the entry to be dropped', 3000)
        await settled(w)

        expect(characters().map((c) => (c as Entry).chaId)).toEqual(['a', 'b'])
        expect(get(stores.selectedCharID)).toBe(1)
        expect(await toasts()).toBeGreaterThan(told)
        expect(await nextStart(w)).toBe('a,b')
    })

    test('(R) further saves after the drop write no unchanged block and announce nothing new (S6)', async () => {
        h.db = makeDb('p', ['a', 'b'])
        const w = await kit.startWorld()
        characters().splice(1, 0, 5)
        await until(() => !characters().includes(5), 'the entry to be dropped', 3000)
        await settled(w)
        const told = await toasts()
        const blockWrites = mutationsOf(w.store, isBlockKey).length

        await nextCommit(w, () => w.marks.markCharacterForSave('a'))

        expect(await toasts()).toBe(told)
        expect(mutationsOf(w.store, isBlockKey).length).toBe(blockWrites)
    })
})

describe('a character with no id (S2)', () => {
    test.each([
        ['undefined', undefined],
        ['an empty string', ''],
        ['null', null],
    ])('(R) an unarchived character whose id is %s is given a new id, written, and loads on the next start', async (_label, missing) => {
        h.db = makeDb('p', ['a', 'b'])
        const w = await kit.startWorld()
        const added = makeCharacter('placeholder') as Entry
        added.name = 'added'
        added.chaId = missing
        characters().push(added)

        await until(() => typeof added.chaId === 'string' && added.chaId !== '', 'the character to get an id', 3000)
        await settled(w)

        expect(added.chaId).toMatch(/^[0-9a-f-]{36}$/)
        expect(await nextStart(w)).toBe(`a,b,${String(added.chaId)}`)
    })
})

describe('a character that is not in the list the person edits stays as it is (G)', () => {
    test('(G) a well-formed list is not touched and a mark saves exactly the marked block', async () => {
        h.db = makeDb('p', ['a', 'b', 'c'])
        const w = await kit.startWorld()
        const before = [...characters()]
        const blockWrites = mutationsOf(w.store, isBlockKey).length
        ;(characters()[1] as Entry).name = 'renamed b'

        await nextCommit(w, () => w.marks.markCharacterForSave('b'))

        expect(characters()).toEqual(before)
        expect(characters().every((c, i) => c === before[i])).toBe(true)
        expect(mutationsOf(w.store, isBlockKey).length).toBeGreaterThan(blockWrites)
        expect(await nextStart(w)).toBe('a,b,c')
    })

    test('(G) numeric ids keep loading', async () => {
        h.db = makeDb('p', ['a'])
        const w = await kit.startWorld()
        const numeric = makeCharacter('7') as Entry
        numeric.chaId = 7
        characters().push(numeric)
        await nextCommit(w, () => w.marks.markCharacterForSave('a'))
        await sleepReal(100)
        expect(numeric.chaId).toBe(7)
        // A numeric key is listed first by the object that holds the blocks; the order is not the point.
        expect((await nextStart(w)).split(',').sort()).toEqual(['7', 'a'])
    })
})

describe('an archived character with no id (S22)', () => {
    test('(R) is not given an id: saving waits, and the edit made meanwhile commits after the stub is gone', async () => {
        h.db = makeDb('p', ['a', 'b'])
        const w = await kit.startWorld()
        const stub = makeCharacter('s', { coldstorage: 'unit-1' }) as Entry
        delete stub.chaId
        characters().push(stub)
        ;(characters()[0] as Entry).name = 'edited while waiting'
        const blockWrites = mutationsOf(w.store, isBlockKey).length

        w.marks.markCharacterForSave('a')
        await sleepReal(QUIET_MS)

        expect(Object.hasOwn(stub, 'chaId')).toBe(false)
        expect(mutationsOf(w.store, isBlockKey).length).toBe(blockWrites)
        expect(w.api.isSaveClean()).toBe(false)

        characters().splice(characters().indexOf(stub), 1)
        w.api.requiresFullEncoderReload.state = true
        await until(() => mutationsOf(w.store, isBlockKey).length > blockWrites, 'the edit to commit', 4000)
        await settled(w)
        expect(await nextStart(w)).toBe('a,b')
    })
})
