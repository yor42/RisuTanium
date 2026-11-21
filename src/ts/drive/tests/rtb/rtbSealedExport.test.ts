// @vitest-environment node
/**
 * The password-sealed `.rtb` export (CHORE-128 E2-X), through `runRtbExportGuarded`: real busy registry, real S7
 * shell, real `writeRtb`, real sealing engine. The file is opened with the test-only `sealedReference`, which shares
 * no code with the engine. The platform writer and the stores are fakes (`rtbDeps`).
 *
 * Labels: compatibility guards of a new contract (no pre-fix base exists); each turns red on a named scratch mutant:
 * the end order (finish after close, finish on cancel), the derivation after the writer opens, the report length
 * taken from the plaintext, a missing yield before the derivation, and a missing cancel check after it.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { ExportCancelToken } from 'src/ts/exportCancel'
import { isBusy, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { classifyRtb } from 'src/ts/drive/rtb/rtbClassify'
import { CoalescingSink } from 'src/ts/drive/rtb/coalescingSink'
import { deriveKek, type Kdf } from 'src/ts/drive/rtb/sealed/kdf'
import { EncryptingSink } from 'src/ts/drive/rtb/sealed/encryptingSink'
import { runRtbExportGuarded, type RtbExportDeps, type RtbExportProgress } from 'src/ts/drive/rtbExport'
import { rangeSourceOfBytes } from './sparseSource'
import { referenceOpen, seededBytes, sequenceRandom, VECTOR_INPUT } from './sealed/sealedReference'
import { buildSmall, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'
import { createClock, testEnv } from 'src/ts/storage/tests/store2/commitFixtures'
import { rtbDeps, rtbWorld, type RtbWorld } from 'src/ts/storage/tests/store2/rtbFixtures'

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

const order = vi.hoisted(() => ({ log: [] as string[] }))
vi.mock('src/ts/storage/saveYield', async (importActual) => {
    const actual = await importActual<typeof import('src/ts/storage/saveYield')>()
    return {
        ...actual,
        yieldToEventLoop: async () => {
            order.log.push('yield')
            await actual.yieldToEventLoop()
        },
    }
})

vi.mock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }))
vi.mock('src/ts/globalApi.svelte', () => {
    class TauriWriter {
        touchedFile = true
        constructor(public path: string) { }
        async write(): Promise<void> { }
        async close(): Promise<void> { }
    }
    return { LocalWriter: class { }, TauriWriter, isSaveClean: () => true, moduleCommitVerdict: () => 'saved' as const }
})
vi.mock('src/ts/alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn(), alertNormalWait: vi.fn(), alertClear: vi.fn(), alertWait: vi.fn() }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { alertStore: writable({ type: 'none', msg: '' }) }
})
vi.mock('@tauri-apps/plugin-fs', () => ({ remove: vi.fn(async () => { }), writeFile: vi.fn(async () => { }), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined), convertFileSrc: (path: string) => path }))
vi.mock('src/ts/drive/exportModules', () => ({ ExportModuleUnreadableError: class extends Error { } }))
vi.mock('src/ts/drive/storeRestore', () => ({ saveFirst: vi.fn(async () => { }), SAVE_FIRST_BOUND_MS: 10_000 }))
vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: () => ({ modules: [] }), appVer: '0.0.0-test' }))
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

const HEX_A = 'a1'.repeat(32)
const ASSET_A = `assets/${HEX_A}.png`
// Several chunks of incompressible bytes, so the asset body spans more than one sealed chunk.
const FILES = { [ASSET_A]: seededBytes(5 * 4096, 11) }

const PASSWORD = 'rtb-test-pw'
const CHUNK = 4096
const SEAL_PARAMS = { m: 256, t: 2, chunkSize: CHUNK }

let world: RtbWorld

beforeAll(async () => {
    const db = JSON.parse(JSON.stringify(buildSmall(2))) as Obj
    ;((db.characters as Obj[])[0]).additionalAssets = [['extra', ASSET_A, 'png']]
    world = await rtbWorld({ layout: 1, database: db })
})

beforeEach(() => {
    order.log.length = 0
    resetBusyActionsForTest()
    resetPageStorageModeForTests()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'info').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

function sealSeam(extra: { kdf?: Kdf } = {}): NonNullable<RtbExportDeps['seal']> {
    return { params: SEAL_PARAMS, random: sequenceRandom([VECTOR_INPUT.master, VECTOR_INPUT.salt, VECTOR_INPUT.wrapNonce, VECTOR_INPUT.fileId]), ...extra }
}

/** Logs the order of the calls whose order is the contract: the derivation, the writer open, the flush, the finish and the close. */
function trace(over: Partial<RtbExportDeps> = {}) {
    const flush = CoalescingSink.prototype.flush
    vi.spyOn(CoalescingSink.prototype, 'flush').mockImplementation(async function (this: CoalescingSink) {
        order.log.push('flush')
        await flush.call(this)
    })
    const finish = EncryptingSink.prototype.finish
    const finishes = vi.spyOn(EncryptingSink.prototype, 'finish').mockImplementation(async function (this: EncryptingSink) {
        order.log.push('finish')
        await finish.call(this)
    })
    const kdf: Kdf = async (password, salt, params) => {
        order.log.push('kdf')
        return await deriveKek(password, salt, params)
    }
    return { finishes, kdf }
}

interface ExportExtra {
    kdf?: Kdf
    /** Cancels the run's token at the first progress event this accepts. */
    cancelAt?: (event: RtbExportProgress) => boolean
}

async function exportWith(password: string | undefined, extra: ExportExtra = {}) {
    const backend = await world.open()
    // A fresh key environment per run: the snapshot id is drawn from it, so two runs agree only if they start equal.
    const built = rtbDeps({ backend, env: testEnv(createClock(), 5), files: FILES, iris: { a: 1 } })
    let token: ExportCancelToken | null = null
    let cancelled = false
    const openWriter = vi.fn(async (...args: Parameters<RtbExportDeps['openWriter']>) => {
        order.log.push('openWriter')
        token = args[0].cancel
        return await built.deps.openWriter(...args)
    })
    const closing = built.writer.close.bind(built.writer)
    const close = vi.spyOn(built.writer, 'close')
    close.mockImplementation(async () => {
        order.log.push('close')
        await closing()
    })
    const deps: RtbExportDeps = { ...built.deps, openWriter, seal: sealSeam({ kdf: extra.kdf }) }
    const result = await runRtbExportGuarded(deps, {
        fileName: 'test.rtb',
        password,
        onProgress: (event) => {
            if (!cancelled && extra.cancelAt?.(event) === true) {
                cancelled = true
                token?.cancel()
            }
        },
    })
    return { result, writer: built.writer, openWriter, close, cancelled: () => cancelled }
}

describe('the sealed export (T35)', () => {
    test('the file opens by the reference, holds the unencrypted export byte for byte, and the report length is the file size', async () => {
        const plain = await exportWith(undefined)
        expect(plain.result.status === 'ended' && plain.result.outcome.status).toBe('saved')
        const sealed = await exportWith(PASSWORD)
        if (sealed.result.status !== 'ended' || sealed.result.outcome.status !== 'saved' || sealed.result.report === null) {
            throw new Error('the sealed export did not save')
        }
        const file = Buffer.from(sealed.writer.bytes())
        const inside = referenceOpen(file, PASSWORD)
        expect(inside.equals(Buffer.from(plain.writer.bytes()))).toBe(true)
        expect(sealed.result.report.length).toBe(file.length)
        expect(sealed.result.report.length).not.toBe(inside.length)
        expect((await classifyRtb(rangeSourceOfBytes(inside))).kind).toBe('ok')
        expect(file.length).toBeGreaterThan(3 * CHUNK)
        expect(sealed.close).toHaveBeenCalledTimes(1)
    })

    test('without a password nothing is derived and the same export twice gives the same bytes', async () => {
        const kdf = vi.fn(deriveKek)
        const one = await exportWith(undefined, { kdf })
        const two = await exportWith(undefined, { kdf })
        expect(kdf).not.toHaveBeenCalled()
        expect(Buffer.from(one.writer.bytes()).equals(Buffer.from(two.writer.bytes()))).toBe(true)
        expect(Buffer.from(one.writer.bytes()).subarray(0, 2).toString('latin1')).toBe('PK')
    })

    test('the order is yield, derivation, writer open; then final flush, finish, close', async () => {
        const { kdf } = trace()
        const run = await exportWith(PASSWORD, { kdf })
        expect(run.result.status === 'ended' && run.result.outcome.status).toBe('saved')
        const at = (name: string) => order.log.indexOf(name)
        expect(at('yield')).toBeGreaterThanOrEqual(0)
        expect(at('yield')).toBeLessThan(at('kdf'))
        expect(at('kdf')).toBeLessThan(at('openWriter'))
        expect(order.log.filter((name) => name === 'kdf')).toHaveLength(1)
        expect(order.log.filter((name) => name === 'finish')).toHaveLength(1)
        expect(order.log.filter((name) => name === 'close')).toHaveLength(1)
        expect(order.log.lastIndexOf('flush')).toBeLessThan(at('finish'))
        expect(at('finish')).toBeLessThan(at('close'))
    })

    test('a cancel during the assets finishes and closes nothing and reports nothing saved', async () => {
        const { kdf, finishes } = trace()
        const run = await exportWith(PASSWORD, { kdf, cancelAt: (event) => event.phase === 'assets' })
        expect(run.cancelled()).toBe(true)
        expect(run.result).toMatchObject({ status: 'ended', outcome: { status: 'declined', cause: 'export-cancelled' }, report: null })
        expect(finishes).not.toHaveBeenCalled()
        expect(order.log).not.toContain('finish')
        expect(order.log).not.toContain('close')
        expect(isBusy()).toBe(false)
    })

    test('a cancel that comes during the derivation ends the export before the writer opens', async () => {
        // The run creates its token itself; the first checkpoint hands it over.
        let token: ExportCancelToken | null = null
        const check = ExportCancelToken.prototype.throwIfCancelled
        vi.spyOn(ExportCancelToken.prototype, 'throwIfCancelled').mockImplementation(function (this: ExportCancelToken) {
            token ??= this
            check.call(this)
        })
        const cancelling: Kdf = async (password, salt, params) => {
            order.log.push('kdf')
            token?.cancel()
            return await deriveKek(password, salt, params)
        }
        const run = await exportWith(PASSWORD, { kdf: cancelling })
        expect(order.log).toContain('kdf')
        expect(run.result).toMatchObject({ status: 'ended', outcome: { status: 'declined', cause: 'export-cancelled' }, report: null })
        expect(run.openWriter).not.toHaveBeenCalled()
        expect(run.writer.writes).toBe(0)
        expect(isBusy()).toBe(false)
    })

    test('a failed derivation opens no writer, saves nothing and leaves no busy entry', async () => {
        const failing: Kdf = async () => {
            order.log.push('kdf')
            throw new RangeError('out of memory')
        }
        const run = await exportWith(PASSWORD, { kdf: failing })
        expect(run.result).toMatchObject({ status: 'ended', outcome: { status: 'failed' }, report: null })
        expect(run.openWriter).not.toHaveBeenCalled()
        expect(order.log).toEqual(['yield', 'kdf'])
        expect(run.writer.writes).toBe(0)
        expect(isBusy()).toBe(false)
    })

    test.each(['', '\ud800'])('the password %j rejects with a TypeError before busy, saving or opening', async (password) => {
        const sampled: boolean[] = []
        const backend = await world.open()
        const saveFirst = vi.fn(async () => { })
        const openWriter = vi.fn(async () => null)
        const { deps } = rtbDeps({
            backend, env: world.env,
            over: {
                pageMode: () => { sampled.push(isBusy()); return { kind: 'store2' } },
                openWriter,
                saveFirst,
                seal: sealSeam(),
            },
        })
        await expect(runRtbExportGuarded(deps, { fileName: 'test.rtb', password })).rejects.toBeInstanceOf(TypeError)
        expect(sampled).toEqual([])
        expect(openWriter).not.toHaveBeenCalled()
        expect(saveFirst).not.toHaveBeenCalled()
        expect(order.log).toEqual([])
        expect(isBusy()).toBe(false)
    })
})
