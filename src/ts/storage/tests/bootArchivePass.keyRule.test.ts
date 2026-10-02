/**
 * The boot archive pass (`src/ts/storage/bootArchivePass.ts`) given an upstream
 * stub whose unit key cannot be a storage name (`isSafeColdStorageKey`).
 * The unit reader is the real `readColdStorageItem`, which answers such a key
 * with an error of kind `damaged` before any backend is asked; everything else
 * is the in-memory model of `bootArchivePassHarness.ts`. These tests say nothing
 * about a real browser, the native file system or a real Node server.
 *
 * Every test here is a guard: the pass decides by the status of the read alone,
 * so a stub whose key the rule rejects is left exactly as it was found.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import {
    baseTree,
    bootOnce,
    charactersOf,
    installedTree,
    unitValue,
    upstreamStub,
    worldFor,
    type Json,
    type RemoteLike,
    type WorldKit,
} from './bootArchivePassHarness'

const h = vi.hoisted(() => ({
    platform: { isTauri: false, isNodeServer: false },
    db: {} as Record<string, unknown>,
    remote: null as RemoteLike | null,
    keyPair: null as CryptoKeyPair | null,
    storageCalls: [] as string[],
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return h.platform.isTauri },
    get isNodeServer() { return h.platform.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => h.db),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        getItem: (key: string) => (h.remote as RemoteLike).getItem(key),
        setItem: (key: string, value: Uint8Array) => (h.remote as RemoteLike).setItem(key, value),
        keys: () => (h.remote as RemoteLike).keys(),
        realStorage: undefined,
    },
    isPlainHttpFileSrc: vi.fn(() => false),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(async () => { }),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => { }),
    readFile: vi.fn(async () => undefined),
    readDir: vi.fn(async () => []),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('src/ts/util'), () => ({
    base64url: (source: Uint8Array | ArrayBuffer) => Buffer.from(source as Uint8Array).toString('base64url'),
    getKeypairStore: vi.fn(async () => {
        h.keyPair ??= await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
        return h.keyPair
    }),
    saveKeypairStore: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertInput: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    waitAlert: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

import { RisuSaveEncoder, decodeRisuSave } from 'src/ts/storage/risuSave'
import { NodeStorage } from 'src/ts/storage/nodeStorage'
import { openBootArchiveSession } from 'src/ts/storage/bootArchivePass'
import { readColdStorageItem } from 'src/ts/process/coldstorage.svelte'

const kit: WorldKit = {
    Encoder: RisuSaveEncoder,
    decodeRisuSave: decodeRisuSave as WorldKit['decodeRisuSave'],
    openBootArchiveSession,
    NodeStorage: NodeStorage as unknown as WorldKit['NodeStorage'],
    setRemote: (remote) => { h.remote = remote },
}

beforeEach(() => {
    localStorage.clear()
    h.platform.isNodeServer = false
    h.platform.isTauri = false
    h.db = {}
    h.remote = null
    h.storageCalls.length = 0
    // The backend the real reader would use in this world: any call to it is recorded.
    Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: { getDirectory: async () => { h.storageCalls.push('getDirectory'); throw new Error('the reader must not ask the backend') } },
    })
})

afterEach(() => {
    Reflect.deleteProperty(navigator, 'storage')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('guard: boot archive pass with an upstream stub whose unit key the key rule rejects', () => {
    const CHA_ID = 'cha-rejected-key'
    const ENRICHMENT_FIELDS = ['coldVersion', 'coldChatCount', 'creatorNotes', 'lastInteraction', 'characters']
    const REJECTED_KEYS = ['a/b', 'a\\b', 'a:b', 'k'.repeat(101)]

    test.each(REJECTED_KEYS.map((key) => [key.length > 20 ? `a ${key.length}-byte key` : key, key]))('%s: the stub is kept as found and nothing is written', async (_label, key) => {
        const stub = upstreamStub(CHA_ID, 'Stub Name', key)
        const world = await worldFor(kit, 'opfs', baseTree([stub], { archiveCharacters: true }))
        world.units.readOverride = (unitKey) => readColdStorageItem(unitKey)

        const boot = await bootOnce(world)

        const slot = charactersOf(installedTree(boot.outcome)).find((c) => c.chaId === CHA_ID) as Json
        for (const field of ENRICHMENT_FIELDS) {
            expect(slot, field).not.toHaveProperty(field)
        }
        expect(slot.name).toBe('Stub Name')
        expect(slot.coldstorage).toBe(key)
        expect(world.units.reads).toEqual([key])
        expect(world.mainWrites.length).toBe(0)
        expect(world.units.writes.length).toBe(0)
        expect(h.storageCalls).toEqual([])
    })

    test('a valid stub beside the rejected one is enriched as usual', async () => {
        const goodKey = '11111111-2222-4333-8444-555555555555'
        const bad = upstreamStub(CHA_ID, 'Bad Key', 'a/b')
        const good = upstreamStub('cha-good', 'Good Key', goodKey)
        const world = await worldFor(kit, 'opfs', baseTree([bad, good], { archiveCharacters: false }))
        await world.seedUnit(goodKey, unitValue({
            chaId: 'cha-good',
            name: 'Name In Unit',
            type: 'character',
            image: '',
            chatPage: 0,
            chats: [{ id: 'chat-1', message: [{ time: 1, data: 'hi', role: 'user' }], note: '', name: '', localLore: [] }],
        }))
        world.units.readOverride = (unitKey, real) => unitKey === goodKey ? real() : readColdStorageItem(unitKey)

        const boot = await bootOnce(world)

        const slots = charactersOf(installedTree(boot.outcome))
        const kept = slots.find((c) => c.chaId === CHA_ID) as Json
        expect(kept.coldstorage).toBe('a/b')
        expect(kept).not.toHaveProperty('coldVersion')
        expect(slots.find((c) => c.chaId === 'cha-good')).toHaveProperty('coldVersion')
    })
})
