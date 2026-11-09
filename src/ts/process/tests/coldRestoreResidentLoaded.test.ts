/**
 * The resident-load signal the save loop's idle back-off reads (`../../storage/store2/residentLoads`): the install seam
 * of `restoreColdCharacter` (`../coldCharacterRestore`) records one load when it puts a restored character in its stub's
 * slot, on both branches (a store2 residency read and the legacy unit read), and records none when nothing is installed
 * (the stub is gone, or the restore is refused). The real reader and restore run over a stand-in page byte store; the
 * residency is a stand-in that answers a prepared read.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { compressSync } from 'fflate'

//#region module mocks

const h = vi.hoisted(() => ({
    units: new Map<string, Uint8Array>(),
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { createForageBackedStore } = await import('src/ts/storage/tests/forageBackedStore')
    const store = createForageBackedStore({
        getItem: async (key) => h.units.get(key) ?? null,
        setItem: async (key, value) => { h.units.set(key, value) },
        keys: async () => Array.from(h.units.keys()),
        removeItem: async (key) => { h.units.delete(key) },
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
    waitAlert: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/alert'))

//#endregion

import { restoreColdCharacter } from '../coldCharacterRestore'
import { takeResidentLoaded } from 'src/ts/storage/store2/residentLoads'
import { DBState } from 'src/ts/stores.svelte'
import { registerResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import type { Residency, ResidencyRead } from 'src/ts/storage/store2/residency'
import type { Database } from 'src/ts/storage/database.svelte'

type Slot = Database['characters'][number]

const KEY = '0'.repeat(26)

/** A key that is not a store2 entity key, so the read takes the legacy unit path. */
const LEGACY_KEY = 'unit-a'

function stub(key = KEY): Slot {
    return { chaId: 'cha-a', name: 'Ann', type: 'character', coldstorage: key, chatPage: 0, chats: [] } as unknown as Slot
}

function full(): Slot {
    return { chaId: 'cha-a', name: 'Ann', type: 'character', chatPage: 0, chats: [{ id: 'chat-one', name: '', message: [], note: '', localLore: [] }] } as unknown as Slot
}

function storeUnit(value: unknown): void {
    h.units.set(`coldstorage/${LEGACY_KEY}`, compressSync(new TextEncoder().encode(JSON.stringify(value))))
}

function registerStore2Read(): void {
    const read = { status: 'ok', value: { character: full() }, entry: { u: KEY }, source: { get: () => undefined }, bytes: 1, droppedAlt: [] } as unknown as Extract<ResidencyRead, { status: 'ok' }>
    registerResidency({ readCharacter: async () => read, hydrate: () => {} } as unknown as Residency)
}

beforeEach(() => {
    h.units.clear()
    resetResidencyForTest()
    // The flag is module state: drain whatever an earlier test left.
    takeResidentLoaded()
})

afterEach(() => {
    resetResidencyForTest()
    vi.restoreAllMocks()
})

describe('a restore records one resident load when it installs', () => {
    test('T11 the store2 residency branch records one load, and the flag clears when taken', async () => {
        registerStore2Read()
        const archived = stub()
        DBState.db = { characters: [archived] } as unknown as Database

        const outcome = await restoreColdCharacter(archived)

        expect(outcome.status === 'restored' && outcome.installedHere).toBe(true)
        expect(takeResidentLoaded()).toBe(true)
        expect(takeResidentLoaded()).toBe(false)
    })

    test('T11 the legacy unit branch records one load', async () => {
        storeUnit({ character: full() })
        const archived = stub(LEGACY_KEY)
        DBState.db = { characters: [archived] } as unknown as Database

        const outcome = await restoreColdCharacter(archived)

        expect(outcome.status === 'restored' && outcome.installedHere).toBe(true)
        expect(takeResidentLoaded()).toBe(true)
    })

    test('T11 a stub that is gone by the time the read returns records none', async () => {
        storeUnit({ character: full() })
        const archived = stub(LEGACY_KEY)
        DBState.db = { characters: [] } as unknown as Database

        const outcome = await restoreColdCharacter(archived, { quiet: true })

        expect(outcome.status).toBe('gone')
        expect(takeResidentLoaded()).toBe(false)
    })

    test('T11 a refused restore records none', async () => {
        const archived = stub(LEGACY_KEY)
        DBState.db = { characters: [archived] } as unknown as Database

        const outcome = await restoreColdCharacter(archived, { quiet: true })

        expect(outcome.status).toBe('refused')
        expect(takeResidentLoaded()).toBe(false)
    })
})
