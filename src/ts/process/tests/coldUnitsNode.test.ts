/**
 * Cold-storage units on the self-hosted Node server go through the page's byte
 * store: the real `readColdStorageItem`, `setColdStorageItem`,
 * `deleteColdStorageUnits` and `listColdStorageItems` run over the real Node
 * HTTP store with the `FakeNodeServer` stand-in at the `fetch` boundary. A pass
 * here says nothing about the real server.
 *
 * Every test is labelled in its title:
 * - "guard": holds before and after units went through the byte store (the
 *   server's file names, the per-key conflict refusal) and protects behaviour
 *   that must stay;
 * - "new behaviour": asserts what only units-through-the-store does.
 */
import { compressSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { FakeNodeServer } from 'src/ts/storage/tests/manualCleanupHarness'

const h = vi.hoisted(() => ({
    platform: { isTauri: false, isNodeServer: true },
    forage: { Init: async (): Promise<void> => { }, realStorage: undefined as unknown, staleAccountProfile: false },
    keyPair: null as CryptoKeyPair | null,
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return h.platform.isTauri },
    get isNodeServer() { return h.platform.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    get forageStorage() { return h.forage },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock('src/lang', () => ({
    language: { setNodePassword: 'set password', inputNodePassword: 'input password' },
}))

vi.mock('src/ts/util', () => ({
    asBuffer: (value: Uint8Array) => value,
    base64url: (source: Uint8Array | ArrayBuffer) => Buffer.from(source as Uint8Array).toString('base64url'),
    getKeypairStore: vi.fn(async () => {
        h.keyPair ??= await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
        return h.keyPair
    }),
    saveKeypairStore: vi.fn(async () => { }),
}))

vi.mock('src/ts/alert', () => ({
    alertError: vi.fn(),
    alertInput: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    waitAlert: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'linux' }))

type ColdModule = typeof import('src/ts/process/coldstorage.svelte')

let cold: ColdModule
let server: FakeNodeServer

const UUID = '3f2b8c1e-5a47-4d9e-8b61-0c7a9d2e4f10'
const OTHER = '9a1d7c20-2b3e-4f5a-8c6d-1e2f3a4b5c6d'
const VALUE = { message: [{ time: 1, data: 'x', role: 'user' }] }

function encodeUnit(value: unknown): Uint8Array {
    return compressSync(new TextEncoder().encode(JSON.stringify(value)))
}

function hex(key: string): string {
    return Buffer.from(key, 'utf-8').toString('hex')
}

function unitWrites() {
    return server.requestsTo('/api/write')
}

beforeEach(async () => {
    server = new FakeNodeServer()
    vi.stubGlobal('fetch', server.fetch)
    vi.resetModules()
    const { NodeStorage } = await import('src/ts/storage/nodeStorage')
    h.forage.realStorage = new NodeStorage()
    cold = await import('src/ts/process/coldstorage.svelte')
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'log').mockImplementation(() => { })
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('the server\'s file names and the per-key conflict refusal', () => {
    test.each([
        ['a UUID', UUID],
        ['a UUID with the _accessMeta suffix upstream wrote', UUID + '_accessMeta'],
    ])('guard: %s is stored under the hex of coldstorage/<key> and read back', async (_label, key) => {
        expect(await cold.setColdStorageItem(key, VALUE)).toBe(true)

        expect(unitWrites().map((request) => request.headers['file-path'])).toEqual([hex('coldstorage/' + key)])
        expect(server.keysWithPrefix('coldstorage/')).toEqual(['coldstorage/' + key])
        expect(await cold.readColdStorageItem(key)).toEqual({ status: 'ok', value: VALUE })
    })

    test('guard: a unit written by an earlier build under that file name is read', async () => {
        server.seed('coldstorage/' + UUID, encodeUnit(VALUE))

        expect(await cold.readColdStorageItem(UUID)).toEqual({ status: 'ok', value: VALUE })
    })

    test('guard: a write after a read presents the version the read took, and a peer write in between refuses it', async () => {
        server.seed('coldstorage/' + UUID, encodeUnit({ n: 1 }))
        await cold.readColdStorageItem(UUID)
        server.peerWrite('coldstorage/' + UUID, encodeUnit({ n: 2 }))

        const written = await cold.setColdStorageItem(UUID, { n: 3 })

        expect(written).toBe(false)
        expect(unitWrites().at(-1)?.headers['if-match-revision']).toBe('1')
        expect(await cold.readColdStorageItem(UUID)).toEqual({ status: 'ok', value: { n: 2 } })
    })

    test('guard: a refused write keeps being refused until the unit is read again', async () => {
        server.seed('coldstorage/' + UUID, encodeUnit({ n: 1 }))
        await cold.readColdStorageItem(UUID)
        server.peerWrite('coldstorage/' + UUID, encodeUnit({ n: 2 }))

        expect(await cold.setColdStorageItem(UUID, { n: 3 })).toBe(false)
        expect(await cold.setColdStorageItem(UUID, { n: 3 })).toBe(false)

        await cold.readColdStorageItem(UUID)
        expect(await cold.setColdStorageItem(UUID, { n: 4 })).toBe(true)
    })

    test('guard: a write of a unit this page never read or wrote is unconditional', async () => {
        expect(await cold.setColdStorageItem(UUID, VALUE)).toBe(true)

        expect(unitWrites()[0].headers['if-match-revision']).toBeUndefined()
    })

    test('guard: a second write presents the version of the first', async () => {
        await cold.setColdStorageItem(UUID, { n: 1 })
        await cold.setColdStorageItem(UUID, { n: 2 })

        expect(unitWrites()[1].headers['if-match-revision']).toBe(String(server.revisionOf('coldstorage/' + UUID) - 1))
    })
})

describe('deleting units on the Node server', () => {
    test('new behaviour: a unit this page wrote, deleted and wrote again is written: the deletion forgot the version', async () => {
        await cold.setColdStorageItem(UUID, { n: 1 })

        expect(await cold.deleteColdStorageUnits([UUID])).toEqual([])

        // The server keeps counting after a delete, so a write that still presented the old version would be refused.
        expect(await cold.setColdStorageItem(UUID, { n: 2 })).toBe(true)
        expect(unitWrites().at(-1)?.headers['if-match-revision']).toBeUndefined()
        expect(await cold.readColdStorageItem(UUID)).toEqual({ status: 'ok', value: { n: 2 } })
    })

    test('new behaviour: units of both shapes are listed and deleted, and a failed request reports its keys', async () => {
        await cold.setColdStorageItem(UUID, VALUE)
        await cold.setColdStorageItem(OTHER + '_accessMeta', VALUE)

        expect((await cold.listColdStorageItems()).items.sort()).toEqual([UUID, OTHER + '_accessMeta'].sort())
        expect(await cold.deleteColdStorageUnits([UUID, OTHER + '_accessMeta'])).toEqual([])
        expect(server.keysWithPrefix('coldstorage/')).toEqual([])
    })

    test('new behaviour: a delete request the server answers with 500 reports every key of that call and the unit stays', async () => {
        await cold.setColdStorageItem(UUID, VALUE)
        server.removeOverride = () => new Response('boom', { status: 500 })

        const failed = await cold.deleteColdStorageUnits([UUID])

        expect(failed.map((entry) => entry.key)).toEqual([UUID])
        expect(server.keysWithPrefix('coldstorage/')).toEqual(['coldstorage/' + UUID])
    })
})

describe('the key rule on the Node server', () => {
    test('new behaviour: a key the cold-key rule accepts but the store refuses reads damaged and writes false without a request', async () => {
        const requestsBefore = server.requests.length

        const read = await cold.readColdStorageItem('.hidden')
        const written = await cold.setColdStorageItem('.hidden', VALUE)

        expect(read.status).toBe('error')
        expect((read as { kind?: unknown }).kind).toBe('damaged')
        expect(written).toBe(false)
        expect(server.requests.length).toBe(requestsBefore)
    })

    test('new behaviour: a zero-length unit on the server is a value that does not decode: damaged, not missing', async () => {
        server.seed('coldstorage/' + UUID, new Uint8Array(0))

        const read = await cold.readColdStorageItem(UUID)

        expect(read.status).toBe('error')
        expect((read as { kind?: unknown }).kind).toBe('damaged')
    })

    test('guard: a unit the server does not hold is missing', async () => {
        expect(await cold.readColdStorageItem(UUID)).toEqual({ status: 'missing' })
    })

    test('guard: a failing read is an error with no kind', async () => {
        server.readFailures.add('coldstorage/' + UUID)

        const read = await cold.readColdStorageItem(UUID)

        expect(read.status).toBe('error')
        expect((read as { kind?: unknown }).kind).toBeUndefined()
    })
})
