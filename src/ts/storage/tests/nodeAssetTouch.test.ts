// @vitest-environment node
/**
 * A Node save of an asset the key already holds moves the key's revision with
 * `POST /api/touch` instead of rewriting it, against the real
 * `server/node/server.cjs` run as a child process. A sweep's guarded delete at an
 * earlier revision then fails, and a delete that applied first makes the touch
 * answer 404 so the save re-creates the key. A pass here says nothing about a
 * browser or a real proxy.
 *
 * Titles say what a test pins. `reproducer` fails on the code before the touch
 * (a save of a stored key left its revision alone); `guard` holds the rule
 * afterwards; `compatibility guard` passes before and after.
 */
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writable } from 'svelte/store'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

// The facade builds its storage tab locks on `localStorage` when it loads; the live-server fixture needs the
// `node` environment, which has none.
vi.hoisted(() => {
    const memory = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => memory.get(key) ?? null,
            setItem: (key: string, value: string) => { memory.set(key, String(value)) },
            removeItem: (key: string) => { memory.delete(key) },
            clear: () => memory.clear(),
            key: (index: number) => Array.from(memory.keys())[index] ?? null,
            get length() { return memory.size },
        },
    })
})

const h = vi.hoisted(() => ({
    platform: { isTauri: false, isNodeServer: true },
    keyPair: null as CryptoKeyPair | null,
    /** A module whose every named export is a mock function, for the native bridges the facade imports but never reaches here. */
    permissive: (): Record<string, unknown> => new Proxy({} as Record<string, unknown>, {
        get: (_target, key) => (key === 'then' ? undefined : vi.fn()),
        has: () => true,
    }),
}))

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
            keys: vi.fn(async () => []),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return h.platform.isTauri },
    get isNodeServer() { return h.platform.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => {
        throw new Error('no live database in tests')
    }),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as Record<string, unknown> },
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
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(async () => { }),
    sleepForever: vi.fn(async () => { }),
    asBuffer: (value: Uint8Array) => value,
    base64url: (source: Uint8Array | ArrayBuffer) => Buffer.from(source as Uint8Array).toString('base64url'),
    getKeypairStore: vi.fn(async () => {
        h.keyPair ??= await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
        return h.keyPair
    }),
    saveKeypairStore: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

vi.mock('@tauri-apps/api/core', () => h.permissive())
vi.mock('@tauri-apps/api/path', () => h.permissive())
vi.mock('@tauri-apps/plugin-fs', () => h.permissive())
vi.mock('@tauri-apps/plugin-os', () => h.permissive())
vi.mock('@tauri-apps/plugin-shell', () => h.permissive())
vi.mock('@tauri-apps/plugin-http', () => h.permissive())
vi.mock('@tauri-apps/plugin-dialog', () => h.permissive())
vi.mock('@tauri-apps/api/event', () => h.permissive())
vi.mock('@tauri-apps/api/webviewWindow', () => h.permissive())
vi.mock('src/ts/vendor/streamSaver', () => ({ default: { useBlobFallback: false, createWriteStream: vi.fn() } }))

vi.mock(import('src/ts/update'), () => ({ checkRisuUpdate: vi.fn(async () => { }) }))
vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({ loadPlugins: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/plugins/plugins.svelte'))
vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: async () => {
        throw new Error('assets are not hashed through the parser')
    },
}) as unknown as typeof import('src/ts/parser/parser.svelte'))
vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('src/ts/characterCards'))
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({ registerDbChangeEffects: vi.fn() }) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))
vi.mock(import('src/ts/gui/animation'), () => ({ updateAnimationSpeed: vi.fn() }) as unknown as typeof import('src/ts/gui/animation'))
vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))
vi.mock(import('src/ts/observer.svelte'), () => ({ startObserveDom: vi.fn() }) as unknown as typeof import('src/ts/observer.svelte'))
vi.mock(import('src/ts/gui/guisize'), () => ({ updateGuisize: vi.fn() }) as unknown as typeof import('src/ts/gui/guisize'))
vi.mock(import('src/ts/characters'), () => ({ updateLorebooks: vi.fn((v: unknown) => v) }) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/hotkey'), () => ({ initMobileGesture: vi.fn() }) as unknown as typeof import('src/ts/hotkey'))
vi.mock(import('src/ts/process/modules'), () => ({ moduleUpdate: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/process/modules'))
vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({ getColdStorageItem: vi.fn() }) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

//#endregion

import { saveAsset, saveAssetFromPieces } from 'src/ts/globalApi.svelte'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { StoreOutcomeUnknownError, StoreVersionConflictError } from 'src/ts/storage/store/errors'
import { createNodeHttpStore, type FetchLike } from 'src/ts/storage/store/nodeHttpStore'
import { createReplyDropper, hexOfKey, startNodeServer, type NodeServerFixture } from './nodeServerFixture'

let main: NodeServerFixture
let faulty: NodeServerFixture
let preloadDir: string

/**
 * Makes `rename` fail with EPERM when its destination exists and is an asset
 * file, as a Windows-hosted server does while another handle streams the file.
 */
const RENAME_FAULT = `
const fsp = require('fs/promises')
const original = fsp.rename
const ASSET_PREFIX = '${hexOfKey('assets/')}'
fsp.rename = async (from, to) => {
    const exists = await fsp.stat(to).then(() => true, () => false)
    if (exists && require('path').basename(String(to)).startsWith(ASSET_PREFIX)) {
        const error = new Error('EPERM: operation not permitted, rename')
        error.code = 'EPERM'
        throw error
    }
    return original(from, to)
}
`

beforeAll(async () => {
    preloadDir = await mkdtemp(join(tmpdir(), 'risu-touch-preload-'))
    const preload = join(preloadDir, 'renameFault.cjs')
    await writeFile(preload, RENAME_FAULT)
    main = await startNodeServer()
    faulty = await startNodeServer({ nodeArgs: ['--require', preload] })
}, 120_000)

afterAll(async () => {
    await Promise.all([main?.stop(), faulty?.stop()])
    await rm(preloadDir, { recursive: true, force: true })
}, 60_000)

beforeEach(() => {
    h.platform.isTauri = false
    h.platform.isNodeServer = true
})

afterEach(() => {
    injectAppStore(null)
    vi.restoreAllMocks()
})

//#region helpers

function patterned(length: number, seed: number): Uint8Array {
    return Uint8Array.from({ length }, (_, index) => (index * 7 + seed) & 255)
}

const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const keyOf = (bytes: Uint8Array) => `assets/${sha256Hex(bytes)}.png`

function storeOf(fx: NodeServerFixture, fetchLike?: FetchLike): ByteStore {
    return createNodeHttpStore({ baseUrl: fx.baseUrl, authHeader: () => fx.authHeader(), fetch: fetchLike, sleep: async () => { } })
}

/** The app store with its capabilities probed (so pieces are recorded) and its requests counted by route. */
async function appStore(fx: NodeServerFixture): Promise<{ store: ByteStore, routes: string[] }> {
    const routes: string[] = []
    const counting: FetchLike = async (url, init) => {
        routes.push(new URL(url).pathname)
        return await fetch(url, init)
    }
    const store = storeOf(fx, counting)
    await store.guarded!.probe()
    routes.length = 0
    injectAppStore(store, 'node')
    return { store, routes }
}

async function revisionOf(store: ByteStore, key: string): Promise<number> {
    const { version } = await store.read(key)
    return version as number
}

async function onDisk(fx: NodeServerFixture, key: string): Promise<Uint8Array | null> {
    try {
        return new Uint8Array(await readFile(join(fx.saveDir, hexOfKey(key))))
    } catch {
        return null
    }
}

async function* piecesOf(bytes: Uint8Array, length: number): AsyncGenerator<Uint8Array> {
    for (let at = 0; at < bytes.length; at += length) {
        yield bytes.subarray(at, Math.min(bytes.length, at + length))
    }
}

/** The commit key a sweep's delete is bound to, written through the production store so it carries a revision. */
async function commitKey(store: ByteStore, label: string): Promise<{ key: string, version: number }> {
    const key = `store2-commit-${label}`
    const written = await store.write(key, new Uint8Array([1]), 'unconditional')
    return { key, version: written.version as number }
}

//#endregion

describe('whole bytes', () => {
    test('reproducer: saveAsset of a stored key moves its revision and sends no write', async () => {
        const { store, routes } = await appStore(main)
        const bytes = patterned(60, 1)
        const key = await saveAsset(bytes)
        const before = await revisionOf(store, key)
        routes.length = 0

        await saveAsset(bytes)

        expect(await revisionOf(store, key)).toBeGreaterThan(before)
        expect(routes).not.toContain('/api/write')
        expect(routes).toContain('/api/touch')
    })

    test('reproducer: a guarded removal at the revision a listing saw conflicts after the save, and the asset survives', async () => {
        const { store } = await appStore(main)
        const bytes = patterned(60, 2)
        const key = await saveAsset(bytes)
        const seen = await revisionOf(store, key)
        const commit = await commitKey(store, 'rr4')

        await saveAsset(bytes)

        await expect(store.guarded!.removeChecked([{ key, condition: { ifVersion: seen } }], [{ key: commit.key, version: commit.version }]))
            .rejects.toBeInstanceOf(StoreVersionConflictError)
        expect(await store.has(key)).toBe(true)
        expect((await onDisk(main, key))?.length).toBe(60)
    })

    test('compatibility guard: a removal that applied first makes the save re-create the key, whole bytes and pieces', async () => {
        const { store } = await appStore(main)
        const whole = patterned(60, 3)
        const wholeKey = await saveAsset(whole)
        const pieced = patterned(300, 4)
        const piecedKey = await saveAssetFromPieces(piecesOf(pieced, 70), { sizeBound: pieced.length, minPieceBytes: 1 })
        const commit = await commitKey(store, 'rr4b')
        await store.guarded!.removeChecked([
            { key: wholeKey, condition: { ifVersion: await revisionOf(store, wholeKey) } },
            { key: piecedKey, condition: { ifVersion: await revisionOf(store, piecedKey) } },
        ], [{ key: commit.key, version: commit.version }])
        expect(await store.has(wholeKey)).toBe(false)
        expect(await store.has(piecedKey)).toBe(false)

        await saveAsset(whole)
        await saveAssetFromPieces(piecesOf(pieced, 70), { sizeBound: pieced.length, minPieceBytes: 1 })

        expect(Buffer.from((await onDisk(main, wholeKey))!).equals(Buffer.from(whole))).toBe(true)
        expect(Buffer.from((await onDisk(main, piecedKey))!).equals(Buffer.from(pieced))).toBe(true)
    })
})

describe('pieces, upload mode', () => {
    test('reproducer: saveAssetFromPieces of a stored key moves its revision and commits nothing for it', async () => {
        const { store, routes } = await appStore(main)
        const bytes = patterned(300, 5)
        const key = await saveAssetFromPieces(piecesOf(bytes, 70), { sizeBound: bytes.length, minPieceBytes: 1 })
        const before = await revisionOf(store, key)
        routes.length = 0

        await saveAssetFromPieces(piecesOf(bytes, 70), { sizeBound: bytes.length, minPieceBytes: 1 })

        expect(await revisionOf(store, key)).toBeGreaterThan(before)
        expect(routes).not.toContain('/api/upload/commit')
        expect(routes).not.toContain('/api/write')
        expect(Buffer.from((await onDisk(main, key))!).equals(Buffer.from(bytes))).toBe(true)
    })
})

describe('a touch whose reply is lost', () => {
    test('guard: lost once, the save resolves after one re-send; two touches applied, no write or commit', async () => {
        const bytes = patterned(60, 6)
        const key = keyOf(bytes)
        const plain = storeOf(main)
        await plain.write(key, bytes, 'unconditional')
        const before = await revisionOf(plain, key)
        const dropper = createReplyDropper({ drops: { touch: (nth) => nth === 1 } })
        const store = storeOf(main, dropper.fetch)
        injectAppStore(store, 'node')

        await expect(saveAsset(bytes)).resolves.toBe(key)

        expect(dropper.seen.get('touch')).toBe(2)
        expect(dropper.seen.get('write')).toBeUndefined()
        expect(dropper.seen.get('upload/commit')).toBeUndefined()
        expect(await revisionOf(plain, key)).toBe(before + 2)
    })

    test('guard: lost twice, the save fails with the unknown outcome, sends no write or commit and the asset stays', async () => {
        const bytes = patterned(60, 7)
        const key = keyOf(bytes)
        const plain = storeOf(main)
        await plain.write(key, bytes, 'unconditional')
        const dropper = createReplyDropper({ drops: { touch: () => true } })
        const store = storeOf(main, dropper.fetch)
        injectAppStore(store, 'node')

        await expect(saveAsset(bytes)).rejects.toBeInstanceOf(StoreOutcomeUnknownError)

        expect(dropper.seen.get('touch')).toBe(2)
        expect(dropper.seen.get('write')).toBeUndefined()
        expect(dropper.seen.get('upload/commit')).toBeUndefined()
        expect(await plain.has(key)).toBe(true)
    })
})

describe('a server whose rename onto an existing asset fails', () => {
    test('guard: the injection is armed, and saving a stored asset again still resolves with its bytes unchanged and its revision moved', async () => {
        const { store } = await appStore(faulty)
        const whole = patterned(60, 8)
        const wholeKey = await saveAsset(whole)
        const pieced = patterned(300, 9)
        const piecedKey = await saveAssetFromPieces(piecesOf(pieced, 70), { sizeBound: pieced.length, minPieceBytes: 1 })
        const wholeBefore = await revisionOf(store, wholeKey)
        const piecedBefore = await revisionOf(store, piecedKey)

        const control = await fetch(`${faulty.baseUrl}/api/write`, {
            method: 'POST',
            headers: { 'risu-auth': await faulty.authHeader(), 'file-path': hexOfKey(wholeKey), 'content-type': 'application/octet-stream' },
            body: whole as Uint8Array<ArrayBuffer>,
        })
        await control.arrayBuffer()
        expect(control.status).toBe(500)

        await expect(saveAsset(whole)).resolves.toBe(wholeKey)
        await expect(saveAssetFromPieces(piecesOf(pieced, 70), { sizeBound: pieced.length, minPieceBytes: 1 })).resolves.toBe(piecedKey)

        // The control write bumps the revision before its rename fails, so the touches are measured against a fresh read.
        expect(await revisionOf(store, wholeKey)).toBeGreaterThan(wholeBefore)
        expect(await revisionOf(store, piecedKey)).toBeGreaterThan(piecedBefore)
        expect(Buffer.from((await onDisk(faulty, wholeKey))!).equals(Buffer.from(whole))).toBe(true)
        expect(Buffer.from((await onDisk(faulty, piecedKey))!).equals(Buffer.from(pieced))).toBe(true)
    })
})
