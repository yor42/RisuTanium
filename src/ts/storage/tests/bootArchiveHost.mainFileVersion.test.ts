// @vitest-environment node
/**
 * The production binding of the boot archive pass's commit and re-read
 * (`src/ts/storage/bootArchiveHost.ts`) on the Node server, for a legacy
 * profile: the re-read of the main file answers what the file holds, and the
 * conversion never touches the main file, so a save another device makes there
 * neither conflicts with the conversion nor is renamed away as if it were the
 * converted one.
 *
 * The Node server is the `FakeNodeServer` stand-in at the `fetch` boundary; the
 * real app store, Node client and block-store owner run. A passing test says
 * nothing about the real server.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { FakeNodeServer } from './manualCleanupHarness'
import { makeSet } from './blockStoreHarness'

const MAIN = 'database/database.bin'
const PRE_BLOCKS = 'database/database.pre-blocks.bin'

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

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))

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
let fingerprintMainFile: typeof import('src/ts/storage/mainFileFingerprint')['fingerprintMainFile']
let setPageStorageMode: typeof import('src/ts/storage/pageStorageMode')['setPageStorageMode']

function bytes(...values: number[]): Uint8Array {
    return Uint8Array.from(values)
}

function stored(key: string): number[] {
    return Array.from(server.files.get(key)?.bytes ?? [])
}

function writesToMain(): number {
    return server.requestsTo('/api/write').filter((request) => Buffer.from(request.headers['file-path'] ?? '', 'hex').toString('utf-8') === MAIN).length
}

beforeEach(async () => {
    server = new FakeNodeServer()
    vi.stubGlobal('fetch', server.fetch)
    vi.resetModules()
    const { NodeStorage } = await import('src/ts/storage/nodeStorage')
    h.forage.realStorage = new NodeStorage()
    fingerprintMainFile = (await import('src/ts/storage/mainFileFingerprint')).fingerprintMainFile
    setPageStorageMode = (await import('src/ts/storage/pageStorageMode')).setPageStorageMode
    const host = await import('src/ts/storage/bootArchiveHost')
    deps = await host.createProductionBootArchiveDeps('web')
})

describe('the boot archive pass\'s main-file effects on the Node server', () => {
    test('the conversion never writes the main file, and moves the converted one aside', async () => {
        server.seed(MAIN, bytes(1))
        setPageStorageMode({ kind: 'legacy', convertedFrom: fingerprintMainFile(bytes(1)) })

        await deps.commit(makeSet({ characters: [{ chaId: 'a' }] }))

        expect(writesToMain()).toBe(0)
        expect(server.files.has(MAIN)).toBe(false)
        expect(stored(PRE_BLOCKS)).toEqual([1])
        expect(server.files.has('blocks/head')).toBe(true)
    })

    test('a save another device makes to the main file during the conversion does not conflict with it, and is left where it is', async () => {
        server.seed(MAIN, bytes(1))
        setPageStorageMode({ kind: 'legacy', convertedFrom: fingerprintMainFile(bytes(1)) })
        server.peerWrite(MAIN, bytes(5))

        await deps.commit(makeSet({ characters: [{ chaId: 'a' }] }))

        expect(server.files.has('blocks/head')).toBe(true)
        expect(stored(MAIN)).toEqual([5])
        expect(server.files.has(PRE_BLOCKS)).toBe(false)
    })

    test('the re-read of a legacy profile answers the main file as it stands and writes nothing', async () => {
        server.seed(MAIN, bytes(1))
        setPageStorageMode({ kind: 'legacy', convertedFrom: fingerprintMainFile(bytes(1)) })
        server.peerWrite(MAIN, bytes(5))

        const reread = await deps.reread()

        expect(reread.kind === 'bytes' && Array.from(reread.bytes ?? [])).toEqual([5])
        expect(writesToMain()).toBe(0)
    })

    test('a re-read of an absent main file answers null and a zero-length one answers its empty bytes', async () => {
        setPageStorageMode({ kind: 'legacy', convertedFrom: null })
        expect(await deps.reread()).toEqual({ kind: 'bytes', bytes: null })

        server.seed(MAIN, new Uint8Array(0))

        const second = await deps.reread()
        expect(second.kind === 'bytes' && second.bytes?.length).toBe(0)
    })
})
