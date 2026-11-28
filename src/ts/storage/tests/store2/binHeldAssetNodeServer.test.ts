// @vitest-environment node
/**
 * A `.bin` import (`LoadPickedLocalBackup`, `src/ts/drive/backuplocal.ts`) over a Node profile that already holds assets,
 * against the real `server/node/server.cjs` through `createNodeHttpStore`: an asset entry whose key the store holds with the
 * same length and exactly the same bytes is not sent (`binAssetHeld.ts`), and is touched, so its revision moves as a write
 * would move it. The server, its asset listing, its ranged reads, its uploads, its touch route and its revision map are real;
 * the commit of the imported database is the stub of `store2ShellStub.ts` (the real commit is another suite's subject), the
 * alert and storage-lock modules are replaced, and the `.bin` is built entry by entry in the container's own shape, not by a
 * real export.
 *
 * Labels:
 * - Regression reproducer: the identical re-import (T3). On the base no `present` count exists and every asset is sent again,
 *   so the requests that carry asset bytes are not empty. The same row on a page whose server takes no pieces (whole read) is
 *   a reproducer too.
 * - Compatibility guards: a changed last byte, the empty-profile control and the hex-case variant listing (T19c) pass before
 *   and after, because the base writes the entry in each. The sweep fence (T12) and the value that changed between the
 *   listing and the held read (shorter, longer; pieces and whole read) end in the same store on the base, but also assert the
 *   `present` count and that the import's listing ran, which the base lacks, so those two rows fail on the base for that
 *   reason and not for a defect. A mutant of the skip rule is what catches a defect in the guards.
 *
 * T19c needs a case-sensitive file system for the save directory: the server lists every hex-case variant of a key
 * (`/api/list-prefix`) and reads the lowercase name, so the larger uppercase file is what the listing names. On a
 * case-insensitive file system the two names are one file and the row is skipped (the probe is below). CI runs on Linux.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

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
    isTauri: false,
    isNodeServer: true,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(async () => { }),
    rename: vi.fn(async () => { }),
    remove: vi.fn(async () => { }),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => { }),
    readFile: vi.fn(async () => new Uint8Array()),
    readDir: vi.fn(async () => []),
    BaseDirectory: { AppData: 0 },
}))

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as unknown as Database },
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

const alertErrorMock = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: alertErrorMock,
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(async () => { }),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/coldstorage.svelte'), async () => {
    const { getColdStorageBackupKey, isColdStorageBackupData } = await import('src/ts/process/coldstorageData')
    return {
        collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
        readColdStorageItem: vi.fn(async () => ({ status: 'missing' })),
        confirmIncompleteColdStorageOperation: vi.fn(async () => true),
        getColdStorageBackupKey,
        getColdStorageItem: vi.fn(async () => null),
        isColdStorageBackupData,
        setColdStorageItem: vi.fn(async () => true),
    } as unknown as typeof import('src/ts/process/coldstorage.svelte')
})

// A clean page: the restore's save-first step returns at its clean check instead of waiting out its bound. The piece store
// answers the page's store only once its capability is recorded (`startWorld` records it or leaves it unrecorded), so a
// page with no piece route stays on the whole-value paths: the real answer would probe, and the real server takes pieces.
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    pieceStoreOrNull: async () => {
        const { getAppStore } = await import('src/ts/storage/store/appStore')
        const store = await getAppStore()
        return store.piecesRecorded?.() === true ? store : null
    },
    LocalWriter: class { },
    forageStorage: {},
    requiresFullEncoderReload: { state: false },
    noteAssetWrittenThisPage: vi.fn(),
    dbWriteLock: { acquire: vi.fn(async () => vi.fn()) },
    acquireExclusiveStorageMigrationLock: vi.fn(async () => (async () => { })),
    locksSupported: true,
    tabPresenceLockAcquired: Promise.resolve(),
    isSaveClean: () => true,
    afterNextSaveCommit: vi.fn(),
    requestSaveNow: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

const shell = vi.hoisted((): Store2ShellBox => ({ commits: [], events: [] }))
vi.mock(import('src/ts/drive/storeImport'), (importOriginal) => store2ShellMock(shell)(importOriginal))

//#endregion

import { resetStore2ShellBox, store2ShellMock, useStore2RestorePage, type Store2ShellBox } from 'src/ts/drive/tests/store2ShellStub'
import { LoadPickedLocalBackup, type LocalBackupEnd } from 'src/ts/drive/backuplocal'
import { encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { StoreVersionConflictError } from 'src/ts/storage/store/errors'
import { createNodeHttpStore, type FetchLike } from 'src/ts/storage/store/nodeHttpStore'
import { hexOfKey, startNodeServer, type NodeServerFixture } from '../nodeServerFixture'

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 })

//#region fixtures

const encoder = new TextEncoder()

/** The size above which the restore streams an entry (`CHUNK_MAX`) and the size of one Node piece (`NODE_PIECE_BYTES`). */
const STREAM_ABOVE = 4 * 1024 * 1024
const NODE_PIECE = 8 * 1024 * 1024

const SMALL = 3000
/** A streamed entry whose held value is two pieces: one full piece and a 5-byte last one. */
const LARGE = NODE_PIECE + 5

function u32le(n: number): Uint8Array {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
}

function buildChunk(name: string, data: Uint8Array): Uint8Array {
    const nameBuf = encoder.encode(name)
    const out = new Uint8Array(4 + nameBuf.length + 4 + data.length)
    out.set(u32le(nameBuf.length), 0)
    out.set(nameBuf, 4)
    out.set(u32le(data.length), 4 + nameBuf.length)
    out.set(data, 8 + nameBuf.length)
    return out
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

function asBlobPart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    return bytes as unknown as Uint8Array<ArrayBuffer>
}

/** Offset-sensitive bytes: period 251 is coprime with every power of two, so a piece compared against the wrong offset differs. */
function patterned(size: number, seed: number): Uint8Array {
    const out = new Uint8Array(size)
    for (let i = 0; i < size; i++) {
        out[i] = (i * 13 + seed) % 251
    }
    return out
}

function databaseChunk(): Uint8Array {
    const database = { characters: [], personas: [], characterOrder: [], botPresets: [] } as unknown as Database
    return buildChunk('database.risudat', encodeRisuSaveLegacy(database, 'noCompression'))
}

/** The `.bin` of these asset entries, in order, then the database entry, as the container writes them. */
function backupOf(entries: [string, Uint8Array][]): Uint8Array {
    return concat([...entries.map(([name, data]) => buildChunk(name, data)), databaseChunk()])
}

function withLastByteFlipped(bytes: Uint8Array): Uint8Array {
    const out = bytes.slice()
    out[out.length - 1] ^= 0xff
    return out
}

function same(actual: Uint8Array | null | undefined, expected: Uint8Array): boolean {
    return actual !== null && actual !== undefined && Buffer.compare(Buffer.from(actual), Buffer.from(expected)) === 0
}

/** Whether the temp directory (where the server's save directory lives) is on a file system that folds letter case. */
async function probeCaseInsensitive(): Promise<boolean> {
    const dir = await mkdtemp(join(tmpdir(), 'risu-case-probe-'))
    try {
        await writeFile(join(dir, 'ab'), 'x')
        return await stat(join(dir, 'AB')).then(() => true, () => false)
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
}

const caseInsensitive = await probeCaseInsensitive()

//#endregion

//#region the world

/** One request the page's store sent to the server. */
interface LoggedRequest {
    path: string
    method: string
    /** The bytes of the body: 0 for a request with none. */
    bodyBytes: number
}

interface World {
    fixture: NodeServerFixture
    store: ByteStore
}

let world: World
const requests: LoggedRequest[] = []
/** Runs once, after the server answered the page's asset listing and before the page reads anything. */
let afterListing: (() => Promise<void>) | null = null

function bodyBytesOf(body: RequestInit['body']): number {
    if (body === undefined || body === null) {
        return 0
    }
    if (typeof body === 'string') {
        return encoder.encode(body).length
    }
    if (body instanceof Blob) {
        return body.size
    }
    if (ArrayBuffer.isView(body)) {
        return body.byteLength
    }
    if (body instanceof ArrayBuffer) {
        return body.byteLength
    }
    return -1
}

const loggingFetch: FetchLike = async (url, init) => {
    const path = url.slice(world.fixture.baseUrl.length)
    requests.push({ path, method: init?.method ?? 'GET', bodyBytes: bodyBytesOf(init?.body) })
    const response = await fetch(url, init)
    if (path.startsWith('/api/list-prefix') && afterListing !== null) {
        const hook = afterListing
        afterListing = null
        // The answer is consumed before the world changes under the page.
        await response.clone().arrayBuffer()
        await hook()
    }
    return response
}

/** The requests that carry or open an asset write: the single write, and the chunked upload routes. */
function uploadRequests(): LoggedRequest[] {
    return requests.filter((request) => request.path.startsWith('/api/write') || request.path.startsWith('/api/upload'))
}

function touchRequests(): LoggedRequest[] {
    return requests.filter((request) => request.path.startsWith('/api/touch'))
}

/**
 * Starts a real server and the page's store over it. With `pieces` the capability probe has run, as at a page boot, so the
 * store knows the server takes pieces; without it the page stays on the whole-value paths.
 */
async function startWorld(options: { pieces: boolean }): Promise<void> {
    const fixture = await startNodeServer()
    const store = createNodeHttpStore({
        baseUrl: fixture.baseUrl,
        authHeader: () => fixture.authHeader(),
        fetch: loggingFetch,
    })
    world = { fixture, store }
    if (options.pieces) {
        await store.guarded?.probe()
        expect(store.piecesRecorded?.()).toBe(true)
    }
    useStore2RestorePage(store, 'node')
}

beforeEach(() => {
    resetStore2ShellBox(shell)
    requests.length = 0
    afterListing = null
    alertErrorMock.mockClear()
})

afterEach(async () => {
    injectAppStore(null)
    await world?.fixture.stop()
})

function assetKey(name: string): string {
    return `assets/${name}`
}

/** Puts a value in the store through the page's own write path, as an earlier import or save left it. */
async function hold(name: string, bytes: Uint8Array): Promise<void> {
    await world.store.write(assetKey(name), bytes, 'unconditional')
}

/** The file the server keeps under a key (the lowercase hex name every write uses). */
function fileOf(name: string, upper: boolean = false): string {
    const hex = hexOfKey(assetKey(name))
    return join(world.fixture.saveDir, upper ? hex.toUpperCase() : hex)
}

async function storedBytes(name: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(fileOf(name)))
}

async function versionOf(name: string): Promise<number> {
    const revisions = await world.store.listRevisions?.('assets/')
    const found = revisions?.find((entry) => entry.key === assetKey(name))
    if (found === undefined || found.rev === null || found.rev === undefined) {
        throw new Error(`The store reports no revision for ${name}.`)
    }
    return found.rev
}

/** Restores `bytes` as a `.bin` through the card route, which reports the end of the run and the asset counts. */
async function restoreBytes(bytes: Uint8Array): Promise<LocalBackupEnd> {
    return await LoadPickedLocalBackup(new File([asBlobPart(bytes)], 'backup.bin'), undefined, { card: true })
}

/** The import's counts of the assets it wrote and found held. */
function assetFacts(end: LocalBackupEnd): { written: number, present: number } {
    const assets = end.detail.assets
    expect(assets).not.toBeNull()
    // A build without the count reads as none present.
    return { written: assets?.written ?? -1, present: assets?.present ?? 0 }
}

function expectCommittedOnce(): void {
    expect(shell.commits).toHaveLength(1)
    expect(alertErrorMock).not.toHaveBeenCalled()
}

//#endregion

describe('a .bin import over a Node profile that holds the same assets (real server)', () => {
    // T3, regression reproducer: on the base every held asset is sent again and no `present` count exists.
    test('sends no asset bytes, touches every held asset and counts them present (small and two-piece large)', async () => {
        await startWorld({ pieces: true })
        const entries: [string, Uint8Array][] = [
            ['held-small-a.png', patterned(SMALL, 1)],
            ['held-small-b.png', patterned(SMALL + 100, 2)],
            ['held-large.png', patterned(LARGE, 3)],
        ]
        expect(LARGE).toBeGreaterThan(STREAM_ABOVE)
        for (const [name, data] of entries) {
            await hold(name, data)
        }
        const before = new Map<string, number>()
        for (const [name] of entries) {
            before.set(name, await versionOf(name))
        }
        requests.length = 0

        const end = await restoreBytes(backupOf(entries))

        expectCommittedOnce()
        expect(uploadRequests()).toEqual([])
        expect(assetFacts(end)).toEqual({ written: 0, present: 3 })
        expect(touchRequests()).toHaveLength(3)
        for (const [name, data] of entries) {
            expect(same(await storedBytes(name), data), `${name} keeps its bytes`).toBe(true)
            expect(await versionOf(name), `${name} moved its revision`).toBeGreaterThan(before.get(name) ?? Infinity)
        }
    })

    // Reproducer on a page whose server takes no pieces: the held value is read whole and compared.
    test('on a page with no piece route sends no small asset bytes either', async () => {
        await startWorld({ pieces: false })
        const entries: [string, Uint8Array][] = [
            ['held-small-a.png', patterned(SMALL, 1)],
            ['held-small-b.png', patterned(SMALL + 100, 2)],
        ]
        for (const [name, data] of entries) {
            await hold(name, data)
        }
        const before = await versionOf(entries[0][0])
        requests.length = 0

        const end = await restoreBytes(backupOf(entries))

        expectCommittedOnce()
        expect(uploadRequests()).toEqual([])
        expect(assetFacts(end)).toEqual({ written: 0, present: 2 })
        expect(await versionOf(entries[0][0])).toBeGreaterThan(before)
    })

    // Guard for the reproducers above: the spy sees asset bytes when the profile holds nothing.
    test('an empty profile receives every asset (the request spy is not vacuous)', async () => {
        await startWorld({ pieces: true })
        const entries: [string, Uint8Array][] = [
            ['fresh-small.png', patterned(SMALL, 4)],
            ['fresh-large.png', patterned(LARGE, 5)],
        ]

        const end = await restoreBytes(backupOf(entries))

        expectCommittedOnce()
        expect(uploadRequests().length).toBeGreaterThan(0)
        expect(assetFacts(end)).toEqual({ written: 2, present: 0 })
        for (const [name, data] of entries) {
            expect(same(await storedBytes(name), data), `${name} holds the entry`).toBe(true)
        }
    })

    // Guard: a different byte in the last position of the last piece is written; the base writes it too.
    test.each([
        ['small', SMALL],
        ['two-piece large', LARGE],
    ])('a %s value that differs only in its last byte is replaced', async (_label, size) => {
        await startWorld({ pieces: true })
        const entry = patterned(size, 6)
        await hold('differs.png', withLastByteFlipped(entry))
        requests.length = 0

        const end = await restoreBytes(backupOf([['differs.png', entry]]))

        expectCommittedOnce()
        expect(uploadRequests().length).toBeGreaterThan(0)
        expect(assetFacts(end)).toEqual({ written: 1, present: 0 })
        expect(same(await storedBytes('differs.png'), entry)).toBe(true)
    })
})

describe('the sweep fence of a skipped asset on a Node profile (real server)', () => {
    // T12, compatibility guard: the base writes the held asset, which also moves its revision.
    test('an unreferenced skipped asset is not deleted by a revision-bound delete from before the import, and its revision moved as a write moves it', async () => {
        await startWorld({ pieces: true })
        const kept = patterned(SMALL, 7)
        const rewritten = patterned(SMALL, 8)
        await hold('skipped.png', kept)
        await hold('written.png', withLastByteFlipped(rewritten))
        // What a sweep recorded before the import: both assets at their stored revision. The imported database references neither.
        const skippedBefore = (await world.store.read(assetKey('skipped.png'))).version
        const writtenBefore = (await world.store.read(assetKey('written.png'))).version
        const skippedRevisionBefore = await versionOf('skipped.png')
        const writtenRevisionBefore = await versionOf('written.png')
        requests.length = 0

        const end = await restoreBytes(backupOf([['skipped.png', kept], ['written.png', rewritten]]))

        expectCommittedOnce()
        expect(assetFacts(end)).toEqual({ written: 1, present: 1 })
        const skippedRevision = await versionOf('skipped.png')
        const writtenRevision = await versionOf('written.png')
        expect(skippedRevision - skippedRevisionBefore, 'the skipped asset moved by one revision').toBe(1)
        expect(skippedRevision - skippedRevisionBefore).toBe(writtenRevision - writtenRevisionBefore)
        expect(skippedBefore).not.toBeNull()
        expect(writtenBefore).not.toBeNull()
        if (skippedBefore === null || writtenBefore === null) {
            return
        }
        await expect(world.store.delete(assetKey('skipped.png'), { ifVersion: skippedBefore })).rejects.toBeInstanceOf(StoreVersionConflictError)
        await expect(world.store.delete(assetKey('written.png'), { ifVersion: writtenBefore })).rejects.toBeInstanceOf(StoreVersionConflictError)
        expect(same(await storedBytes('skipped.png'), kept)).toBe(true)
        expect(same(await storedBytes('written.png'), rewritten)).toBe(true)
    })
})

describe('a value that changed between the listing and the held read is written (real server)', () => {
    // Guards: the listing names the entry's size, then the held value changes length, as a concurrent writer can make it.
    test.each([
        ['pieces', 'small', 'shorter', true, SMALL],
        ['pieces', 'small', 'longer', true, SMALL],
        ['pieces', 'two-piece large', 'shorter', true, LARGE],
        ['pieces', 'two-piece large', 'longer', true, LARGE],
        ['whole read', 'small', 'shorter', false, SMALL],
        ['whole read', 'small', 'longer', false, SMALL],
    ] as const)('on a %s page, a %s value that became %s than the entry after the listing is replaced', async (_page, _size, change, pieces, size) => {
        await startWorld({ pieces })
        const entry = patterned(size, 9)
        await hold('stale.png', entry)
        const changed = change === 'shorter' ? entry.slice(0, size - 1) : concat([entry, patterned(7, 10)])
        afterListing = async () => { await writeFile(fileOf('stale.png'), changed) }
        requests.length = 0

        const end = await restoreBytes(backupOf([['stale.png', entry]]))

        expectCommittedOnce()
        expect(afterListing, 'the hook ran after the import listing').toBeNull()
        expect(uploadRequests().length).toBeGreaterThan(0)
        expect(assetFacts(end)).toEqual({ written: 1, present: 0 })
        expect(same(await storedBytes('stale.png'), entry)).toBe(true)
    })
})

// T19c, compatibility guard on the hex-case variant listing: the larger uppercase variant is the size the listing names,
// the range read opens the lowercase file. A case-insensitive file system has one file under both names: skipped there.
describe.skipIf(caseInsensitive)('a hex-case variant listed larger than the lowercase file is not mistaken for the held value (real server)', () => {
    test.each([
        ['small', 3 * 1024, 1024],
        ['two-piece large', LARGE, NODE_PIECE],
    ])('%s entry: the lowercase file holds a prefix, the uppercase variant the whole entry; the import writes and ends on the entry', async (_label, size, lowerBytes) => {
        await startWorld({ pieces: true })
        const entry = patterned(size, 11)
        const name = 'case-variant.png'
        expect(hexOfKey(assetKey(name)).toUpperCase()).not.toBe(hexOfKey(assetKey(name)))
        // An outside writer leaves both files; the store's own write path never makes the uppercase one.
        await writeFile(fileOf(name), entry.subarray(0, lowerBytes))
        await writeFile(fileOf(name, true), entry)
        const listed = await world.store.listSized?.('assets/', 0)
        expect(listed?.find((item) => item.key === assetKey(name))?.size, 'the listing names the larger variant').toBe(size)
        requests.length = 0

        const end = await restoreBytes(backupOf([[name, entry]]))

        expectCommittedOnce()
        expect(uploadRequests().length).toBeGreaterThan(0)
        expect(assetFacts(end)).toEqual({ written: 1, present: 0 })
        expect(same(await storedBytes(name), entry)).toBe(true)
    })
})
