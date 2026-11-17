/**
 * The stale-read install guard of `restoreColdCharacter` (`src/ts/process/coldCharacterRestore.ts`): a store2 read installs
 * only while the acknowledged entry of its entity still names the units it read. A fast-forward that moves the acknowledged
 * encoding while a read is pending must not have the old read installed over the new entry. A stale read is read once more;
 * a second stale read installs nothing and answers `gone`. The real restore runs over a stand-in residency whose
 * acknowledged entry the test moves; the reads are prepared. Mocked storage says nothing about a native backend.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { createForageBackedStore } = await import('src/ts/storage/tests/forageBackedStore')
    const store = createForageBackedStore({
        getItem: async () => null,
        setItem: async () => { },
        keys: async () => [],
        removeItem: async () => { },
    })
    return { getAppStore: async () => store } as unknown as typeof import('src/ts/storage/store/appStore')
})

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
    selIdState: { selId: -1 },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    markIdentitySeen: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertWait: vi.fn(),
    alertClear: vi.fn(),
    waitAlert: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/alert'))

import { restoreColdCharacter } from 'src/ts/process/coldCharacterRestore'
import { takeResidentLoaded } from 'src/ts/storage/store2/residentLoads'
import { DBState } from 'src/ts/stores.svelte'
import { registerResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import type { Residency, ResidencyRead } from 'src/ts/storage/store2/residency'
import type { Database } from 'src/ts/storage/database.svelte'

type Slot = Database['characters'][number]

const KEY = '0'.repeat(26)

function stub(): Slot {
    return { chaId: 'cha-a', name: 'Ann', type: 'character', coldstorage: KEY, chatPage: 0, chats: [] } as unknown as Slot
}

function full(note: string): Slot {
    return { chaId: 'cha-a', name: 'Ann', type: 'character', note, chatPage: 0, chats: [{ id: 'chat-one', name: '', message: [], note: '', localLore: [] }] } as unknown as Slot
}

/** A read that carries the entry `core` names; the entry is the guard's evidence of which units were read. */
function readOf(core: string, note: string): Extract<ResidencyRead, { status: 'ok' }> {
    return { status: 'ok', value: { character: full(note) }, entry: { u: KEY, core }, source: { get: () => undefined }, bytes: 1, droppedAlt: [] } as unknown as Extract<ResidencyRead, { status: 'ok' }>
}

interface Standin {
    reads: number
    hydrated: string[]
}

/**
 * The residency answers each read from `queue` in order and holds the acknowledged entry `held.core`; the test changes
 * `held.core` between the read and the install through `afterRead`.
 */
function registerStandin(queue: Array<Extract<ResidencyRead, { status: 'ok' }>>, held: { core: string }, afterRead: (index: number) => void = () => { }): Standin {
    const standin: Standin = { reads: 0, hydrated: [] }
    registerResidency({
        readCharacter: async () => {
            const read = queue[Math.min(standin.reads, queue.length - 1)]
            standin.reads += 1
            afterRead(standin.reads)
            return read
        },
        entryOf: () => ({ u: KEY, core: held.core }),
        hydrate: (read: { entry: { core?: string } }) => { standin.hydrated.push(String(read.entry.core)) },
    } as unknown as Residency)
    return standin
}

beforeEach(() => {
    resetResidencyForTest()
    takeResidentLoaded()
})

afterEach(() => {
    resetResidencyForTest()
    vi.restoreAllMocks()
})

describe('I6 a stale read never installs', () => {
    test('a read whose entry is still the acknowledged one installs', async () => {
        const held = { core: 'core-1' }
        const standin = registerStandin([readOf('core-1', 'read one')], held)
        const archived = stub()
        DBState.db = { characters: [archived] } as unknown as Database
        const outcome = await restoreColdCharacter(archived)
        expect(outcome.status === 'restored' && outcome.installedHere).toBe(true)
        expect(standin.reads).toBe(1)
        expect(standin.hydrated).toEqual(['core-1'])
    })

    test('a read made stale by a fast-forward is read once more and the fresh read installs', async () => {
        const held = { core: 'core-1' }
        // The acknowledged entry moves while the first read is pending; the second read names the new units.
        const standin = registerStandin([readOf('core-1', 'stale read'), readOf('core-2', 'fresh read')], held, (index) => {
            if (index === 1) {
                held.core = 'core-2'
            }
        })
        const archived = stub()
        DBState.db = { characters: [archived] } as unknown as Database
        const outcome = await restoreColdCharacter(archived)
        expect(standin.reads).toBe(2)
        expect(outcome.status).toBe('restored')
        expect((DBState.db as unknown as { characters: Array<{ note?: string }> }).characters[0].note).toBe('fresh read')
        expect(standin.hydrated).toEqual(['core-2'])
    })

    test('a second stale read installs nothing and answers gone', async () => {
        const held = { core: 'core-1' }
        const standin = registerStandin([readOf('core-0', 'stale one'), readOf('core-0', 'stale two')], held)
        const archived = stub()
        DBState.db = { characters: [archived] } as unknown as Database
        const outcome = await restoreColdCharacter(archived, { quiet: true })
        expect(outcome.status).toBe('gone')
        expect(standin.reads).toBe(2)
        expect(standin.hydrated).toEqual([])
        expect((DBState.db as unknown as { characters: unknown[] }).characters[0]).toBe(archived)
        expect(takeResidentLoaded()).toBe(false)
    })
})
