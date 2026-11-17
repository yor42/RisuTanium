// @vitest-environment jsdom
/**
 * The inputs of an `.rtb` export from the page's stores (CHORE-128 S8): the asset section, the inlay section and the
 * platform label. The readers run for real (`ExportAssetReader`, `openExportAssetPieces`, the inlay body rules) over
 * injected fakes of the stores; a fake says nothing about a native store, which the device rows cover.
 *
 * Labels: every test here is a compatibility guard of a new contract (no pre-fix base exists); its scratch mutant is
 * what turns it red.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ExportCancelToken, ExportCancelledError } from 'src/ts/exportCancel'
import type { ByteStore } from 'src/ts/storage/store/contract'
import type { AssetReadResult, SizedAssetKey } from 'src/ts/storage/tauriAssetBatch'
import type { InlayRecord } from 'src/ts/process/files/inlayStore'

vi.mock('src/ts/globalApi.svelte', () => ({ LocalWriter: class { }, TauriWriter: class { } }))
vi.mock('@tauri-apps/plugin-fs', () => ({ remove: vi.fn(async () => { }), BaseDirectory: { AppData: 0 } }))
vi.mock('src/ts/alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn(), alertNormalWait: vi.fn(), alertClear: vi.fn(), alertWait: vi.fn() }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { alertStore: writable({ type: 'none', msg: '' }) }
})
vi.mock('src/ts/process/files/inlayStore', () => ({
    fieldsOf: () => ({}),
    inlayBodyOf: async () => null,
    legacyInlayStore: { keys: async () => [], getItem: async () => null },
    listAppInlayKeys: async () => ({ ids: [], keys: new Set<string>() }),
    readAppInlayRecord: async () => null,
    withInlayLock: <T>(_id: string, work: () => Promise<T>) => work(),
}))
vi.mock('src/ts/storage/store/appStore', () => ({
    getAppStore: async () => { throw new Error('the page store is not part of this test') },
    getAppStoreKind: async () => 'tauri',
    pageStoreIsOpfsTransitional: async () => false,
}))
// The shell pulls the whole app in; only its error class matters to the readers.
vi.mock('src/ts/drive/exportShell', () => ({
    BackupAssetChangedError: class BackupAssetChangedError extends Error {
        constructor(public readonly key: string, cause: unknown) {
            super(`The asset ${key} changed or could not be read while it was being saved`, { cause })
            this.name = 'BackupAssetChangedError'
        }
    },
}))

import { ExportAssetReader } from 'src/ts/drive/assetBatchPipeline'
import type { ExportAssetSource } from 'src/ts/drive/assetPieces'
import { BackupAssetChangedError } from 'src/ts/drive/exportShell'
import { ExportReadError, type ExportableInlay, type ReadPiece } from 'src/ts/drive/inlayBackupExport'
import type { OmittedEntry } from 'src/ts/drive/rtb/manifest'
import type { ZipPiece } from 'src/ts/drive/rtb/zip64Writer'
import type { AssetInput, InlayInput } from 'src/ts/drive/rtb/rtbWriter'
import {
    platformOfFacts, rtbAssetInputs, rtbBackupFileName, rtbInlayInputs,
    type RtbAssetDeps, type RtbExportProgress, type RtbInlayDeps, type RtbSectionContext,
} from 'src/ts/drive/rtbExportSources'

const encoder = new TextEncoder()
const bytesOf = (text: string): Uint8Array => encoder.encode(text)

async function bodyBytes(body: AsyncIterable<ZipPiece>): Promise<Uint8Array> {
    const parts: Uint8Array[] = []
    for await (const piece of body) {
        if ('fillByte' in piece) {
            throw new Error('a fill piece was not expected')
        }
        parts.push(piece)
    }
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of parts) {
        out.set(part, at)
        at += part.length
    }
    return out
}

function context(over: Partial<RtbSectionContext> = {}): RtbSectionContext & { events: RtbExportProgress[], cancel: ExportCancelToken } {
    const events: RtbExportProgress[] = []
    return { cancel: new ExportCancelToken(), lateOmitted: [], onProgress: (event) => events.push(event), ...over, events } as RtbSectionContext & { events: RtbExportProgress[], cancel: ExportCancelToken }
}

function fakeStore(files: Record<string, string>): ByteStore {
    return {
        list: async () => Object.keys(files),
        read: async (key: string) => ({ bytes: key in files ? bytesOf(files[key]) : null }),
    } as unknown as ByteStore
}

/** The pieces of one key: each text is a piece; `total` is stated on every piece. */
function pieceSource(files: Record<string, { pieces: string[], failAfter?: number, total?: number }>, kind: ExportAssetSource['kind'] = 'tauri', store: ByteStore = fakeStore({})): ExportAssetSource {
    return {
        kind,
        store,
        pieces: {
            node: kind === 'node',
            open: async function* (key: string): AsyncGenerator<ReadPiece, void, undefined> {
                const file = files[key]
                if (file === undefined) {
                    return
                }
                const total = file.total ?? file.pieces.reduce((sum, piece) => sum + piece.length, 0)
                for (let i = 0; i < file.pieces.length; i++) {
                    if (file.failAfter !== undefined && i >= file.failAfter) {
                        throw new Error(`the read of ${key} failed`)
                    }
                    yield { bytes: bytesOf(file.pieces[i]), total }
                }
            },
        },
    }
}

function assetDeps(over: Partial<RtbAssetDeps> = {}): RtbAssetDeps {
    return {
        listSized: async () => null,
        readBatch: async (keys) => keys.map((): AssetReadResult => ({ status: 'large' })),
        readerLimits: {},
        pieceSource: async () => null,
        ...over,
    }
}

async function collectAssets(generator: AsyncGenerator<AssetInput>): Promise<{ key: string, size: number, text: string }[]> {
    const out: { key: string, size: number, text: string }[] = []
    for await (const input of generator) {
        out.push({ key: input.key, size: input.size, text: new TextDecoder().decode(await bodyBytes(input.body)) })
    }
    return out
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe('rtbAssetInputs (T-S8-7)', () => {
    const sizedOf = (files: Record<string, string>): SizedAssetKey[] => Object.entries(files).map(([key, text]) => ({ key, size: text.length }))

    test('(a) filter mode builds the reader over the filtered, index-aligned list; all mode carries every key including tp-*', async () => {
        const files = { 'assets/a.png': 'AAAA', 'assets/tp-aa.risutheme': 'TP', 'assets/b.png': 'BBBBBB', 'assets/c.png': 'C' }
        const requested: string[][] = []
        const deps = assetDeps({
            listSized: async () => sizedOf(files),
            readBatch: async (keys) => {
                requested.push([...keys])
                return keys.map((key): AssetReadResult => ({ status: 'ok', bytes: bytesOf(files[key as keyof typeof files]) }))
            },
        })
        const filtered = await collectAssets(rtbAssetInputs(fakeStore(files), deps, { mode: 'filter', holds: (key) => key !== 'assets/b.png' }, context()))
        expect(requested.flat()).toEqual(['assets/a.png', 'assets/tp-aa.risutheme', 'assets/c.png'])
        expect(filtered).toEqual([
            { key: 'a.png', size: 4, text: 'AAAA' },
            { key: 'tp-aa.risutheme', size: 2, text: 'TP' },
            { key: 'c.png', size: 1, text: 'C' },
        ])
        requested.length = 0
        const all = await collectAssets(rtbAssetInputs(fakeStore(files), deps, { mode: 'all' }, context()))
        expect(all.map((entry) => entry.key)).toEqual(['a.png', 'tp-aa.risutheme', 'b.png', 'c.png'])
        expect(requested.flat()).toHaveLength(4)
    })

    test('(a) without a sized listing the store listing is filtered the same way', async () => {
        const files = { 'assets/a.png': 'A', 'assets/b.png': 'B' }
        const out = await collectAssets(rtbAssetInputs(fakeStore(files), assetDeps(), { mode: 'filter', holds: (key) => key === 'assets/a.png' }, context()))
        expect(out).toEqual([{ key: 'a.png', size: 1, text: 'A' }])
    })

    test('(b) a key that is absent when its turn comes is omitted as unreadable and the run goes on', async () => {
        const ctx = context()
        const source = pieceSource({ 'assets/b.png': { pieces: ['B'] } })
        const out = await collectAssets(rtbAssetInputs(fakeStore({}), assetDeps({ listSized: async () => [{ key: 'assets/a.png', size: 1 }, { key: 'assets/b.png', size: 1 }], pieceSource: async () => source }), { mode: 'all' }, ctx))
        expect(out.map((entry) => entry.key)).toEqual(['b.png'])
        expect(ctx.lateOmitted).toEqual([{ kind: 'asset', name: 'a.png', reason: 'unreadable' }])
    })

    test('(b) a batch answer of missing is an omission without a per-entry read', async () => {
        const ctx = context()
        const deps = assetDeps({
            listSized: async () => [{ key: 'assets/a.png', size: 1 }],
            readBatch: async () => [{ status: 'missing' }],
            pieceSource: async () => { throw new Error('the per-entry source must not be asked for a missing key') },
        })
        await expect(collectAssets(rtbAssetInputs(fakeStore({}), deps, { mode: 'all' }, ctx))).rejects.toThrow('per-entry source')
        const quiet = context()
        const deps2 = { ...deps, pieceSource: async () => pieceSource({}) }
        expect(await collectAssets(rtbAssetInputs(fakeStore({}), deps2, { mode: 'all' }, quiet))).toEqual([])
        expect(quiet.lateOmitted).toEqual([{ kind: 'asset', name: 'a.png', reason: 'unreadable' }])
    })

    test('(c) a small body that fails mid-read is an omission', async () => {
        const ctx = context()
        const source = pieceSource({ 'assets/a.png': { pieces: ['12', '34'], failAfter: 1, total: 4 }, 'assets/b.png': { pieces: ['ok'] } })
        const out = await collectAssets(rtbAssetInputs(fakeStore({ 'assets/a.png': '', 'assets/b.png': '' }), assetDeps({ pieceSource: async () => source }), { mode: 'all' }, ctx))
        expect(out).toEqual([{ key: 'b.png', size: 2, text: 'ok' }])
        expect(ctx.lateOmitted).toEqual([{ kind: 'asset', name: 'a.png', reason: 'unreadable' }])
    })

    test('(d) a body over the buffer limit that fails after its first piece throws BackupAssetChangedError naming the key', async () => {
        const source = pieceSource({ 'assets/big.bin': { pieces: ['1234', '5678', '9'], failAfter: 1, total: 9 } })
        const deps = assetDeps({ pieceSource: async () => source, bufferLimit: 4 })
        const run = collectAssets(rtbAssetInputs(fakeStore({ 'assets/big.bin': '' }), deps, { mode: 'all' }, context()))
        await expect(run).rejects.toBeInstanceOf(BackupAssetChangedError)
        await expect(collectAssets(rtbAssetInputs(fakeStore({ 'assets/big.bin': '' }), deps, { mode: 'all' }, context()))).rejects.toMatchObject({ key: 'assets/big.bin' })
    })

    test('(d) a streamed body shorter than its stated total throws BackupAssetChangedError', async () => {
        const source = pieceSource({ 'assets/big.bin': { pieces: ['1234', '56'], total: 9 } })
        const deps = assetDeps({ pieceSource: async () => source, bufferLimit: 4 })
        await expect(collectAssets(rtbAssetInputs(fakeStore({ 'assets/big.bin': '' }), deps, { mode: 'all' }, context()))).rejects.toBeInstanceOf(BackupAssetChangedError)
    })

    test('(e) a Node read failure of the first range fails the export and is never an omission', async () => {
        const ctx = context()
        const failing: ExportAssetSource = {
            kind: 'node',
            store: fakeStore({}),
            pieces: { node: true, open: async function* (): AsyncGenerator<ReadPiece, void, undefined> { throw new Error('network down') } },
        }
        const run = collectAssets(rtbAssetInputs(fakeStore({ 'assets/a.png': '' }), assetDeps({ pieceSource: async () => failing }), { mode: 'all' }, ctx))
        await expect(run).rejects.toBeInstanceOf(ExportReadError)
        expect(ctx.lateOmitted).toEqual([])
    })

    test('(f) the batch path and the ranged path give identical bytes', async () => {
        const files = { 'assets/a.png': 'alpha', 'assets/b.png': 'beta-beta' }
        const batch = assetDeps({
            listSized: async () => sizedOf(files),
            readBatch: async (keys) => keys.map((key): AssetReadResult => ({ status: 'ok', bytes: bytesOf(files[key as keyof typeof files]) })),
        })
        const ranged = assetDeps({ pieceSource: async () => pieceSource({ 'assets/a.png': { pieces: ['al', 'pha'] }, 'assets/b.png': { pieces: ['beta-beta'] } }) })
        const viaBatch = await collectAssets(rtbAssetInputs(fakeStore(files), batch, { mode: 'all' }, context()))
        const viaRanged = await collectAssets(rtbAssetInputs(fakeStore(files), ranged, { mode: 'all' }, context()))
        expect(viaRanged).toEqual(viaBatch)
    })

    test('(f) the reader is closed on success, on cancel and on failure', async () => {
        const close = vi.spyOn(ExportAssetReader.prototype, 'close')
        const files = { 'assets/a.png': 'A', 'assets/b.png': 'B' }
        const deps = assetDeps({
            listSized: async () => sizedOf(files),
            readBatch: async (keys) => keys.map((key): AssetReadResult => ({ status: 'ok', bytes: bytesOf(files[key as keyof typeof files]) })),
        })
        await collectAssets(rtbAssetInputs(fakeStore(files), deps, { mode: 'all' }, context()))
        expect(close).toHaveBeenCalledTimes(1)

        const cancelled = context()
        const run = rtbAssetInputs(fakeStore(files), deps, { mode: 'all' }, cancelled)
        await run.next()
        cancelled.cancel.cancel()
        await expect(run.next()).rejects.toBeInstanceOf(ExportCancelledError)
        expect(close).toHaveBeenCalledTimes(2)

        const consumerStops = rtbAssetInputs(fakeStore(files), deps, { mode: 'all' }, context())
        await consumerStops.next()
        await consumerStops.return(undefined)
        expect(close).toHaveBeenCalledTimes(3)
    })

    test('(g) a store with no piece source is read whole through store.read', async () => {
        const out = await collectAssets(rtbAssetInputs(fakeStore({ 'assets/a.png': 'whole' }), assetDeps(), { mode: 'all' }, context()))
        expect(out).toEqual([{ key: 'a.png', size: 5, text: 'whole' }])
    })

    test('progress: the total is known at the start and the counter never decreases', async () => {
        const ctx = context()
        await collectAssets(rtbAssetInputs(fakeStore({ 'assets/a.png': 'A', 'assets/b.png': 'B' }), assetDeps(), { mode: 'all' }, ctx))
        expect(ctx.events).toEqual([
            { phase: 'assets', done: 0, total: 2 },
            { phase: 'assets', done: 1, total: 2 },
            { phase: 'assets', done: 2, total: 2 },
        ])
    })
})

function exportable(over: Partial<ExportableInlay> & { body?: string, takes?: (count: number) => Promise<Uint8Array> } = {}): { inlay: ExportableInlay, closed: () => number } {
    let closed = 0
    const body = bytesOf(over.body ?? 'inlay-body')
    let position = 0
    const take = over.takes ?? (async (count: number) => {
        const part = body.subarray(position, position + count)
        position += count
        return part
    })
    return {
        closed: () => closed,
        inlay: {
            repr: 'blob', mime: 'image/png', fields: { name: 'one.png' }, len: body.length,
            source: { take, close: async () => { closed++ } },
            ...over,
        },
    }
}

function inlayDeps(by: { app?: Record<string, ExportableInlay | 'unsupported' | null | 'throw'>, old?: Record<string, ExportableInlay | 'unsupported' | null | 'throw'>, legacyKeys?: () => Promise<string[]> }, over: Partial<RtbInlayDeps> = {}): RtbInlayDeps {
    return {
        legacyKeys: by.legacyKeys ?? (async () => Object.keys(by.old ?? {})),
        appIds: async () => Object.keys(by.app ?? {}),
        open: async (_store, id, _streaming, fromApp) => {
            const answer = (fromApp ? by.app : by.old)?.[id] ?? null
            if (answer === 'throw') {
                throw new Error('opening failed')
            }
            return answer
        },
        withLock: (_id, work) => work(),
        options: async () => ({ streaming: false }),
        ...over,
    }
}

async function collectInlays(generator: AsyncGenerator<InlayInput>): Promise<{ id: string, record: InlayRecord, text: string }[]> {
    const out: { id: string, record: InlayRecord, text: string }[] = []
    for await (const input of generator) {
        out.push({ id: input.id, record: input.record, text: new TextDecoder().decode(await bodyBytes(input.body)) })
    }
    return out
}

describe('rtbInlayInputs (T-S8-8)', () => {
    const state = () => ({ oldStoreUnlisted: false, unsupported: [] as string[] })
    const store = fakeStore({})

    test('ids of both stores are de-duplicated and filtered by includes; the record round-trips with an empty body key', async () => {
        const a = exportable({ body: 'AAA' })
        const b = exportable({ body: 'BBBB', repr: 'string', mime: 'text/plain', fields: { k: [1] } })
        const skipped = exportable({ body: 'no' })
        const deps = inlayDeps({ app: { a: a.inlay, b: b.inlay }, old: { b: b.inlay, c: skipped.inlay } })
        const out = await collectInlays(rtbInlayInputs(store, deps, { mode: 'filter', includes: (id) => id !== 'c' }, state(), context()))
        expect(out.map((entry) => entry.id)).toEqual(['b', 'a'])
        const one = out.find((entry) => entry.id === 'b')
        expect(one?.record).toEqual({ v: 1, repr: 'string', mime: 'text/plain', len: 4, fields: { k: [1] }, body: '' })
        expect(one?.text).toBe('BBBB')
    })

    test('an app copy that throws on opening falls back to the old store', async () => {
        const old = exportable({ body: 'old-copy' })
        const out = await collectInlays(rtbInlayInputs(store, inlayDeps({ app: { x: 'throw' }, old: { x: old.inlay } }), { mode: 'all' }, state(), context()))
        expect(out).toHaveLength(1)
        expect(out[0].text).toBe('old-copy')
    })

    test('an app copy whose body read fails falls back to the old store, and the failed source is closed', async () => {
        const failing = exportable({ takes: async () => { throw new Error('body gone') } })
        const old = exportable({ body: 'old-copy' })
        const out = await collectInlays(rtbInlayInputs(store, inlayDeps({ app: { x: failing.inlay }, old: { x: old.inlay } }), { mode: 'all' }, state(), context()))
        expect(out.map((entry) => entry.text)).toEqual(['old-copy'])
        expect(failing.closed()).toBe(1)
        expect(old.closed()).toBeGreaterThanOrEqual(1)
    })

    test('both copies failing leaves the inlay out as inlay/unreadable', async () => {
        const ctx = context()
        const out = await collectInlays(rtbInlayInputs(store, inlayDeps({ app: { x: 'throw' }, old: { x: 'throw' } }), { mode: 'all' }, state(), ctx))
        expect(out).toEqual([])
        expect(ctx.lateOmitted).toEqual([{ kind: 'inlay', name: 'x', reason: 'unreadable' } satisfies OmittedEntry])
    })

    test('unsupported is inlay/unreadable in the manifest list and remembered as unsupported for the notice', async () => {
        const ctx = context()
        const s = state()
        await collectInlays(rtbInlayInputs(store, inlayDeps({ old: { x: 'unsupported' } }), { mode: 'all' }, s, ctx))
        expect(ctx.lateOmitted).toEqual([{ kind: 'inlay', name: 'x', reason: 'unreadable' }])
        expect(s.unsupported).toEqual(['x'])
    })

    test('an ExportReadError from a small body fails the export', async () => {
        const failing = exportable({ takes: async () => { throw new ExportReadError('inlays/x', new Error('network')) } })
        const run = collectInlays(rtbInlayInputs(store, inlayDeps({ app: { x: failing.inlay } }), { mode: 'all' }, state(), context()))
        await expect(run).rejects.toBeInstanceOf(ExportReadError)
        expect(failing.closed()).toBe(1)
    })

    test('a failed old-store listing sets oldInlayStoreUnlisted and the app store inlays are still carried', async () => {
        const a = exportable({ body: 'AAA' })
        const s = state()
        const out = await collectInlays(rtbInlayInputs(store, inlayDeps({ app: { a: a.inlay }, legacyKeys: async () => { throw new Error('old store gone') } }), { mode: 'all' }, s, context()))
        expect(s.oldStoreUnlisted).toBe(true)
        expect(out.map((entry) => entry.id)).toEqual(['a'])
    })

    test('a body over the buffer limit streams, and a failure after its first piece throws BackupAssetChangedError naming the inlay', async () => {
        let call = 0
        const streamed = exportable({
            len: 5 * 1024 * 1024,
            takes: async (count) => {
                call++
                if (call > 1) {
                    throw new Error('went away')
                }
                return new Uint8Array(count)
            },
        })
        const deps = inlayDeps({ app: { big: streamed.inlay } }, { bufferLimit: 4 })
        const run = collectInlays(rtbInlayInputs(store, deps, { mode: 'all' }, state(), context()))
        await expect(run).rejects.toBeInstanceOf(BackupAssetChangedError)
        expect(streamed.closed()).toBeGreaterThanOrEqual(1)
    })

    test('progress counts the filtered ids, and a cancel stops before the next inlay', async () => {
        const a = exportable({ body: 'A' })
        const b = exportable({ body: 'B' })
        const ctx = context()
        const run = rtbInlayInputs(store, inlayDeps({ app: { a: a.inlay, b: b.inlay } }), { mode: 'all' }, state(), ctx)
        await run.next()
        expect(ctx.events[0]).toEqual({ phase: 'inlays', done: 0, total: 2 })
        ctx.cancel.cancel()
        await expect(run.next()).rejects.toBeInstanceOf(ExportCancelledError)
    })
})

describe('platformOfFacts and the file name (T-S8-13)', () => {
    const facts = (over: Partial<Parameters<typeof platformOfFacts>[0]>) => ({ isTauri: false, isNodeServer: false, transport: '', userAgent: '', ...over })

    test.each([
        [{ isTauri: true, transport: 'android', userAgent: 'Linux; Android 14' }, 'android', 'Android app'],
        [{ isTauri: true, transport: 'desktop', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, 'tauri-windows', 'Windows app'],
        [{ isTauri: true, transport: 'desktop', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)' }, 'tauri-macos', 'macOS app'],
        [{ isTauri: true, transport: 'desktop', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }, 'tauri-linux', 'Linux app'],
        [{ isTauri: true, transport: 'desktop', userAgent: 'something unknown' }, 'tauri-linux', 'Linux app'],
        [{ isNodeServer: true, userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }, 'node', 'Hosted page'],
        [{ userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }, 'web', 'Browser'],
        [{ userAgent: '' }, 'web', 'Browser'],
    ])('%j gives %s / %s', (given, platform, label) => {
        expect(platformOfFacts(facts(given))).toEqual({ platform, label })
    })

    test('the default name is local-YYYYMMDD.rtb of the local date', () => {
        expect(rtbBackupFileName(new Date(2026, 9, 10, 12, 0, 0))).toBe('local-20261010.rtb')
    })
})

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
})
