/**
 * The restored-bytes counter (`../memory/restoredBytes`): what this page has read
 * back from archived units, per `chaId`.
 *
 * The real reader (`../coldstorage.svelte`, with the real fflate decoder) and the
 * real restore (`../coldCharacterRestore`) run over a stand-in page byte store and
 * a mocked alert. Counted: the unit of a stub installed by `restoreColdCharacter`
 * (once per install) and an archived chat applied by `preLoadChat`. Never counted:
 * a request that joins a running restore, a refused restore, and
 * `readColdCharacterCopy`, which installs nothing. `setColdStorageItem` counts
 * itself as an in-flight write for the busy registry's choke-point counter.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import { compressSync } from 'fflate'

//#region module mocks

const h = vi.hoisted(() => ({
    units: new Map<string, Uint8Array>(),
    hold: null as null | Promise<void>,
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
        setItem: async (key, value) => {
            if (h.hold) {
                await h.hold
            }
            h.units.set(key, value)
        },
        keys: async () => Array.from(h.units.keys()),
        removeItem: async (key) => { h.units.delete(key) },
    })
    return { getAppStore: async () => store } as unknown as typeof import('src/ts/storage/store/appStore')
})

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertClear: vi.fn(),
    waitAlert: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/alert'))

//#endregion

import { readColdCharacterCopy, restoreColdCharacter } from '../coldCharacterRestore'
import { preLoadChat, setColdStorageItem } from '../coldstorage.svelte'
import { chokePointInFlight } from '../memory/busyActions'
import { coldStorageHeader } from '../coldstorageData'
import { resetRestoredBytesForTest, restoredBytesOf, restoredBytesOutside } from '../memory/restoredBytes'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import type { Database } from 'src/ts/storage/database.svelte'

type Slot = Database['characters'][number]

const enc = new TextEncoder()

/** Stores `value` as a unit under `key` and returns its inflated payload length. */
function storeUnit(key: string, value: unknown): number {
    const json = enc.encode(JSON.stringify(value))
    h.units.set(`coldstorage/${key}`, compressSync(json))
    return json.length
}

function character(chaId: string): Slot {
    return { chaId, name: chaId, type: 'character', chatPage: 0, chats: [{ id: `${chaId}-chat`, message: [], note: '', name: '', localLore: [] }] } as unknown as Slot
}

function stub(chaId: string, key: string): Slot {
    return { chaId, name: chaId, type: 'character', coldstorage: key, chatPage: 0, chats: [] } as unknown as Slot
}

function install(...slots: Slot[]): void {
    DBState.db = { characters: slots } as unknown as Database
}

beforeEach(() => {
    h.units.clear()
    resetRestoredBytesForTest()
    selectedCharID.set(-1)
})

describe('restoredBytes', () => {
    test('a restore that installs a unit counts its inflated length for that chaId', async () => {
        const size = storeUnit('unit-a', { character: character('a') })
        const archived = stub('a', 'unit-a')
        install(archived)

        const outcome = await restoreColdCharacter(archived)

        expect(outcome.status === 'restored' && outcome.installedHere).toBe(true)
        expect(size).toBeGreaterThan(0)
        expect(restoredBytesOf('a')).toBe(size)
    })

    test('a request that joins a running restore does not count again', async () => {
        const size = storeUnit('unit-a', { character: character('a') })
        const archived = stub('a', 'unit-a')
        install(archived)

        const [first, second] = await Promise.all([restoreColdCharacter(archived), restoreColdCharacter(archived)])

        expect(first.status).toBe('restored')
        expect(second.status === 'restored' && second.installedHere).toBe(false)
        expect(restoredBytesOf('a')).toBe(size)
    })

    test('guard: readColdCharacterCopy installs nothing and counts nothing', async () => {
        storeUnit('unit-a', { character: character('a') })
        const archived = stub('a', 'unit-a')
        install(archived)

        const copy = await readColdCharacterCopy(archived)

        expect(copy.status).toBe('ok')
        expect(restoredBytesOf('a')).toBe(0)
    })

    test('a restore refused because the unit holds another chaId counts nothing', async () => {
        storeUnit('unit-a', { character: character('other') })
        const archived = stub('a', 'unit-a')
        install(archived)

        const outcome = await restoreColdCharacter(archived, { quiet: true })

        expect(outcome.status).toBe('refused')
        expect(restoredBytesOf('a')).toBe(0)
    })

    test('the total outside a keep-inline set leaves that set out', async () => {
        const sizeA = storeUnit('unit-a', { character: character('a') })
        const sizeB = storeUnit('unit-b', { character: character('b') })
        const a = stub('a', 'unit-a')
        const b = stub('b', 'unit-b')
        install(a, b)

        await restoreColdCharacter(a)
        await restoreColdCharacter(b)

        expect(restoredBytesOutside()).toBe(sizeA + sizeB)
        expect(restoredBytesOutside(new Set(['a']))).toBe(sizeB)
        expect(restoredBytesOutside(new Set(['a', 'b']))).toBe(0)
    })

    test('an archived chat applied by preLoadChat counts for its character', async () => {
        const blob = { message: [{ role: 'user', data: 'hello', time: 1 }] }
        const size = storeUnit('chat-unit', blob)
        const owner = character('a')
        owner.chats[0].message = [{ role: 'char', data: coldStorageHeader + 'chat-unit' }] as unknown as typeof owner.chats[0]['message']
        install(owner)
        selectedCharID.set(0)

        const result = await preLoadChat(0, 0)

        expect(result).toBe('ok')
        expect(restoredBytesOf('a')).toBe(size)
    })

    test('setColdStorageItem counts as a write in flight until the store write settles', async () => {
        let release: () => void = () => {}
        h.hold = new Promise<void>((resolve) => { release = resolve })

        const pending = setColdStorageItem('written-unit', { character: character('a') })
        await vi.waitFor(() => {
            expect(chokePointInFlight('coldStorage')).toBe(1)
        }, { timeout: 2000, interval: 5 })

        h.hold = null
        release()
        expect(await pending).toBe(true)
        expect(chokePointInFlight('coldStorage')).toBe(0)
    })

    test('a refused key counts nothing', async () => {
        expect(await setColdStorageItem('../escape', { character: character('a') })).toBe(false)
        expect(chokePointInFlight('coldStorage')).toBe(0)
    })

    test('a chat read that is not applied counts nothing', async () => {
        storeUnit('chat-unit', { message: [{ role: 'user', data: 'hello', time: 1 }] })
        const owner = character('a')
        owner.chats[0].message = [{ role: 'char', data: coldStorageHeader + 'chat-unit' }] as unknown as typeof owner.chats[0]['message']
        install(owner)
        selectedCharID.set(-1)

        const result = await preLoadChat(0, 0)

        expect(result).toBe('none')
        expect(restoredBytesOf('a')).toBe(0)
    })
})
