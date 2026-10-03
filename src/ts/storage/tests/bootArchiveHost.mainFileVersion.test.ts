// @vitest-environment node
/**
 * The production binding of the boot archive pass's main-file effects
 * (`src/ts/storage/bootArchiveHost.ts`) on the Node server: the commit presents
 * the version the boot read took, and after a refused commit the re-read takes
 * the file's current version, so the next save neither conflicts for no reason
 * nor misses a later save by another device.
 *
 * The Node server is the `FakeNodeServer` stand-in at the `fetch` boundary; the
 * real app store and Node client run. A passing test says nothing about the
 * real server.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { FakeNodeServer } from './manualCleanupHarness'

const MAIN = 'database/database.bin'

const h = vi.hoisted(() => ({
    forage: { staleAccountProfile: false, Init: async (): Promise<void> => { }, realStorage: undefined as unknown },
    keyPair: null as CryptoKeyPair | null,
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: true,
    isMobile: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    acquireExclusiveStorageMigrationLock: vi.fn(),
    get forageStorage() { return h.forage },
    locksSupported: true,
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    readColdStorageItem: vi.fn(),
    setColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/reloadGuard'), () => ({
    isAppInitiatedReload: vi.fn(() => false),
}) as unknown as typeof import('src/ts/reloadGuard'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    LoadingStatusState: { text: '' },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'linux' }))

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
    waitAlert: vi.fn(async () => { }),
}))

let server: FakeNodeServer
let deps: Awaited<ReturnType<typeof import('src/ts/storage/bootArchiveHost')['createProductionBootArchiveDeps']>>
let app: typeof import('src/ts/storage/store/appStore')
let conflictError: typeof import('src/ts/storage/store/errors').StoreVersionConflictError

function bytes(...values: number[]): Uint8Array {
    return Uint8Array.from(values)
}

function stored(): number[] {
    return Array.from(server.files.get(MAIN)?.bytes ?? [])
}

beforeEach(async () => {
    server = new FakeNodeServer()
    vi.stubGlobal('fetch', server.fetch)
    vi.resetModules()
    const { NodeStorage } = await import('src/ts/storage/nodeStorage')
    h.forage.realStorage = new NodeStorage()
    app = await import('src/ts/storage/store/appStore')
    conflictError = (await import('src/ts/storage/store/errors')).StoreVersionConflictError
    const host = await import('src/ts/storage/bootArchiveHost')
    deps = await host.createProductionBootArchiveDeps('web')
})

describe('the boot archive pass\'s main-file effects on the Node server', () => {
    test('the commit presents the version the boot read took', async () => {
        server.seed(MAIN, bytes(1))
        const read = await app.readMainFile()

        await deps.writeMainFile(bytes(2))

        expect(server.requestsTo('/api/write')[0].headers['if-match-revision']).toBe(String(read.version))
        expect(stored()).toEqual([2])
    })

    test('after a refused commit the re-read\'s version is the one the next save presents, and a later save by another device is still caught', async () => {
        server.seed(MAIN, bytes(1))
        await app.readMainFile()
        server.peerWrite(MAIN, bytes(5))
        await expect(deps.writeMainFile(bytes(2))).rejects.toBeInstanceOf(conflictError)

        const reread = await deps.readMainFile()
        expect(Array.from(reread ?? [])).toEqual([5])
        await app.writeMainFile(bytes(6))
        expect(stored()).toEqual([6])

        server.peerWrite(MAIN, bytes(8))
        await expect(app.writeMainFile(bytes(7))).rejects.toBeInstanceOf(conflictError)
        expect(stored()).toEqual([8])
    })

    test('a re-read of an absent main file answers null and a zero-length one answers its empty bytes', async () => {
        expect(await deps.readMainFile()).toBeNull()

        server.seed(MAIN, new Uint8Array(0))

        expect((await deps.readMainFile())?.length).toBe(0)
    })
})
