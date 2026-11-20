// @vitest-environment node
/**
 * The `.rtb` export core (CHORE-128 S8), through `runRtbExportGuarded`: it holds the refusals, the real busy
 * registry and the real S7 shell, so nothing here registers busy itself. Stores come from the real producer
 * (`encodeDatabase`, `rtbFixtures.ts`), the file is written by the real `writeRtb` and read back by the real
 * `classifyRtb`, `readEntry`, `decodeBlock`, `planRestore` and `commitRestore`. Platform writers and the asset and
 * inlay stores are fakes: a fake writer says nothing about a native one (the device rows cover that).
 *
 * Labels: every test is a compatibility guard of a new contract (no pre-fix base exists); each turns red on a named
 * scratch mutant, not on a pre-fix run.
 */
import { randomBytes } from 'node:crypto'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { remove } from '@tauri-apps/plugin-fs'
import { ExportCancelToken } from 'src/ts/exportCancel'
import { nobleAead, type AeadBackend } from 'src/ts/drive/rtb/sealed/aead'
import { isBusy, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { exportClosure, ExportClosureError } from 'src/ts/storage/store2/rtb/exportClosure'
import { omittedTailsOf, planRestore } from 'src/ts/storage/store2/rtb/restoreBuild'
import { UNIT_TYPE, type Ref } from 'src/ts/storage/store2/format'
import { TauriWriter } from 'src/ts/globalApi.svelte'
import { ExportAssetReader } from 'src/ts/drive/assetBatchPipeline'
import type { ExportableInlay } from 'src/ts/drive/inlayBackupExport'
import { assetEntryName } from 'src/ts/drive/rtb/assetName'
import { inlayEntryNames, decodeInlayMeta } from 'src/ts/drive/rtb/inlayEntries'
import { classifyRtb } from 'src/ts/drive/rtb/rtbClassify'
import { decodeSideLines } from 'src/ts/drive/rtb/sideLines'
import { RTB_SIDE_TAGS } from 'src/ts/drive/rtb/sideTags'
import { alertWait } from 'src/ts/alert'
import { rtbExportRefusal, runRtbExportGuarded, type RtbExportDeps, type RtbExportProgress, type RtbExportResult } from 'src/ts/drive/rtbExport'
import { rangeSourceOfBytes } from './sparseSource'
import { buildSmall, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'
import {
    assembleStore, commitRestore, CURRENT_AT, damagedFrame, FakeLocalWriter, framesOfRtbFile, moveCurrent, readRtbFile, rtbDeps,
    RTB_TEST_CLOCK, rtbManifestOf, rtbWorld, type RtbWorld,
} from 'src/ts/storage/tests/store2/rtbFixtures'

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

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

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const HEX_A = 'a1'.repeat(32)
const HEX_UNREF = 'b2'.repeat(32)
const HEX_PACK = 'ab'.repeat(32)
const ASSET_A = `assets/${HEX_A}.png`
const ASSET_UNREF = `assets/${HEX_UNREF}.png`
const ARCHIVE = `assets/tp-${HEX_PACK}.risutheme`
const INLAY_APP = '0123abcd-0123-4123-a123-0123456789ab'
const INLAY_OLD = '0123abcd-0123-4123-a123-0123456789cd'
const INLAY_UNREF = '0123abcd-0123-4123-a123-0123456789ef'

const FILES = {
    [ASSET_A]: encoder.encode('asset-a-bytes'),
    [ASSET_UNREF]: encoder.encode('unreferenced-asset'),
    [ARCHIVE]: encoder.encode('theme-pack-archive'),
}

function inlayOf(text: string, over: Partial<ExportableInlay> = {}): ExportableInlay {
    const bytes = encoder.encode(text)
    let position = 0
    return {
        repr: 'blob', mime: 'image/png', fields: { name: `${text}.png` }, len: bytes.length,
        source: {
            take: async (count: number) => {
                const part = bytes.subarray(position, position + count)
                position += count
                return part
            },
            close: async () => { },
        },
        ...over,
    }
}

const themeRecord: Obj = {
    v: 1, id: 'pack-1', packId: 'origin-navy', name: 'Origin Navy', version: '1.0.0', license: 'MIT', attribution: 'A. Author',
    modes: ['light', 'dark'], fonts: [{ file: 'fonts/a.woff2', license: 'OFL-1.1' }], archive: ARCHIVE, bytes: 4096, installedAt: 1_700_000_000_000,
}

function profile(extra: (db: Obj) => void = () => { }): Obj {
    const db = JSON.parse(JSON.stringify(buildSmall(2))) as Obj
    const character = (db.characters as Obj[])[0]
    character.additionalAssets = [['extra', ASSET_A, 'png']]
    const chat = (character.chats as Obj[])[0]
    ;(chat.message as Obj[]).push({ role: 'char', data: `see {{inlay::${INLAY_APP}}} and {{inlay::${INLAY_OLD}}}`, time: 1 })
    db.themePacks = [themeRecord]
    db.activeThemePack = 'pack-1'
    db.taskPresets = [{ name: 'tp1', x: 1 }, { name: 'tp2', y: 2 }]
    extra(db)
    return db
}

let world: RtbWorld
let edited: RtbWorld

beforeAll(async () => {
    world = await rtbWorld({ layout: 1, database: profile() })
    edited = await rtbWorld({ layout: 1, seed: 9, database: profile((db) => { (db.characters as Obj[])[0].name = 'edited name' }) })
})

beforeEach(() => {
    resetBusyActionsForTest()
    resetPageStorageModeForTests()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'info').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.mocked(remove).mockClear()
})

const inlays = () => ({ appInlays: { [INLAY_APP]: inlayOf('inlay-app'), [INLAY_UNREF]: inlayOf('unref') }, oldInlays: { [INLAY_OLD]: inlayOf('inlay-old', { mime: 'image/webp' }) } })

async function exportFrom(source: RtbWorld, extra: Partial<Parameters<typeof rtbDeps>[0]> = {}, replace?: ReadonlyMap<string, Uint8Array | null>) {
    const backend = await source.open(replace)
    const built = rtbDeps({ backend, env: source.env, files: FILES, iris: { a: { x: 1 }, b: 'two' }, ...inlays(), ...extra })
    const result = await runRtbExportGuarded(built.deps, { fileName: 'test.rtb' })
    return { ...built, backend, result }
}

function saved(result: RtbExportResult) {
    if (result.status !== 'ended' || result.outcome.status !== 'saved' || result.report === null) {
        throw new Error(`the export did not save: ${JSON.stringify(result.status === 'ended' ? result.outcome.status : result.reason)}`)
    }
    return { outcome: result.outcome, report: result.report }
}

describe('the round trip (T-S8-1)', () => {
    test('the file classifies ok and everything the export carried reads back equal', async () => {
        const { result, writer, backend } = await exportFrom(world)
        const { outcome, report } = saved(result)
        const bytes = writer.bytes()
        expect((await classifyRtb(rangeSourceOfBytes(bytes))).kind).toBe('ok')
        const files = await readRtbFile(bytes)
        const manifest = rtbManifestOf(files)

        // Referenced assets (the pack archive included) are byte-equal; the unreferenced one is absent.
        expect(files.get(assetEntryName(`${HEX_A}.png`))).toEqual(FILES[ASSET_A])
        expect(files.get(assetEntryName(`tp-${HEX_PACK}.risutheme`))).toEqual(FILES[ARCHIVE])
        expect(files.has(assetEntryName(`${HEX_UNREF}.png`))).toBe(false)

        // Inlays of both stores, referenced ones only, with their meta.
        for (const [id, text, mime] of [[INLAY_APP, 'inlay-app', 'image/png'], [INLAY_OLD, 'inlay-old', 'image/webp']] as const) {
            const names = inlayEntryNames(id)
            expect(decoder.decode(files.get(names.bodyName))).toBe(text)
            const meta = decodeInlayMeta(files.get(names.metaName) ?? new Uint8Array(0), text.length)
            expect(meta.kind === 'ok' && meta.meta.mime).toBe(mime)
        }
        expect(files.has(inlayEntryNames(INLAY_UNREF).bodyName)).toBe(false)

        // Side records decode.
        const iris = decodeSideLines(files.get('s/iris/data.jsonl') ?? new Uint8Array(0), RTB_SIDE_TAGS)
        expect(iris.kind === 'ok' && iris.values.map((entry) => entry.key)).toEqual(['a', 'b'])

        // meta.refs is the closure's own row list, and the manifest's commit time is the exported commit's.
        const closure = await exportClosure(await world.open(), { onUnits: async () => { } })
        const store2 = manifest.sections.find((row) => row.id === 'store2')
        expect(store2?.meta?.refs).toEqual(closure.refRows)
        expect(manifest.source.committedAt).toBe(CURRENT_AT)
        expect(manifest.source).toMatchObject({ device: { label: 'Browser', platform: 'web' }, unsavedExcluded: false })
        expect(manifest.omitted).toEqual([])

        // The units restore, through the real planner and commit, to the source database.
        const root = store2?.meta?.root as Ref
        const request = planRestore({ frames: framesOfRtbFile(files), root, omitted: omittedTailsOf(manifest.omitted), target: { legacyKeep: null, req: [] } })
        const restored = await commitRestore(request)
        expect(assembleStore(restored.units, restored.manifestKey)).toEqual(assembleStore(world.store, world.manifestKey))

        // The last bytes (the directory and end records) reach the writer before it is closed, and it is closed once.
        expect(writer.closes).toBe(1)

        // The report is the manifest's and the outcome names the file.
        expect(report.omitted).toEqual(manifest.omitted)
        expect(report).toMatchObject({ fileName: 'test.rtb', length: bytes.length, committedAt: CURRENT_AT, unsavedExcluded: false, counts: { assets: 2, inlays: 2 } })
        expect(outcome).toMatchObject({ status: 'saved', suggestedName: 'test.rtb', inlays: { exported: 2, leftOut: [], oldStoreUnlisted: false } })
        expect(backend).toBeDefined()
    })

    test('a damaged type 26 unit is omitted and named, the planner accepts the file, and the manifest entry is exactly kind, name, reason', async () => {
        const key = world.keysOfType(UNIT_TYPE.taskPreset)[0]
        const tail = key.slice('store2/'.length)
        const replace = new Map([[key, damagedFrame(world.store.get(key) as Uint8Array)]])
        const { result, writer } = await exportFrom(world, {}, replace)
        const { outcome, report } = saved(result)
        const files = await readRtbFile(writer.bytes())
        const manifest = rtbManifestOf(files)
        expect(manifest.omitted).toEqual([{ kind: 'unit', name: tail, reason: 'damaged' }])
        expect(Object.keys(manifest.omitted[0]).sort()).toEqual(['kind', 'name', 'reason'])
        expect(report.omitted).toEqual(manifest.omitted)
        expect(outcome.status === 'saved' && outcome.omitted.units).toEqual([tail])
        const store2 = manifest.sections.find((row) => row.id === 'store2')
        const request = planRestore({ frames: framesOfRtbFile(files), root: store2?.meta?.root as Ref, omitted: omittedTailsOf(manifest.omitted), target: { legacyKeep: null, req: [] } })
        expect(request.newUnits).toBeGreaterThan(0)
    })
})

describe('what the file leaves out and the outcome that says so (T-S8-1, AS-S8-6)', () => {
    const INLAY_UNSUP = '0123abcd-0123-4123-a123-0123456789aa'

    test('an unreadable asset, an inlay no copy opens, an unsupported inlay, an unlisted old store and an unreadable side store are named in the manifest, the report and the outcome', async () => {
        const rich = await rtbWorld({
            layout: 1, seed: 7,
            database: profile((db) => {
                const chat = ((db.characters as Obj[])[0].chats as Obj[])[0]
                ;(chat.message as Obj[]).push({ role: 'char', data: `and {{inlay::${INLAY_UNSUP}}}`, time: 3 })
            }),
        })
        const backend = await rich.open()
        const sized = [ASSET_A, ARCHIVE, ASSET_UNREF].map((key) => ({ key, size: FILES[key].length }))
        const built = rtbDeps({
            backend, env: rich.env,
            over: {
                assets: {
                    listSized: async () => sized,
                    readBatch: async (keys) => keys.map((key) => (key === ASSET_A ? { status: 'missing' as const } : { status: 'ok' as const, bytes: FILES[key] })),
                    readerLimits: {},
                    pieceSource: async () => null,
                },
                inlays: {
                    legacyKeys: async () => { throw new Error('the old inlay store is gone') },
                    appIds: async () => [INLAY_APP, INLAY_OLD, INLAY_UNSUP],
                    open: async (_store, id, _streaming, fromApp) => (id === INLAY_APP && fromApp ? inlayOf('inlay-app') : id === INLAY_UNSUP && fromApp ? 'unsupported' : null),
                    withLock: (_id, work) => work(),
                    options: async () => ({ streaming: false }),
                },
                sideBackends: {
                    forage: () => ({ ready: async () => { throw new Error('the store is unavailable') } }) as never,
                    local: () => ({ length: 0, key: () => null, getItem: () => null }) as never,
                },
            },
        })
        const result = await runRtbExportGuarded(built.deps, { fileName: 'test.rtb' })
        const { outcome, report } = saved(result)
        const manifest = rtbManifestOf(await readRtbFile(built.writer.bytes()))

        // Order: the late list (inlays, then assets), then the writer's own (the unreadable side stores).
        expect(manifest.omitted.slice(0, 3)).toEqual([
            { kind: 'inlay', name: INLAY_OLD, reason: 'unreadable' },
            { kind: 'inlay', name: INLAY_UNSUP, reason: 'unreadable' },
            { kind: 'asset', name: `${HEX_A}.png`, reason: 'unreadable' },
        ])
        const sides = manifest.omitted.slice(3)
        expect(sides.length).toBeGreaterThan(0)
        expect(sides.every((entry) => entry.kind === 'side' && entry.reason === 'unreadable')).toBe(true)
        expect(sides.map((entry) => entry.name)).toContain('side.iris')
        expect(report.omitted).toEqual(manifest.omitted)
        expect(report.oldInlayStoreUnlisted).toBe(true)

        expect(outcome.omitted).toEqual({
            assets: [`${HEX_A}.png`],
            oversize: [],
            units: [],
            inlays: [{ id: INLAY_OLD, reason: 'unreadable' }, { id: INLAY_UNSUP, reason: 'unsupported' }],
            oldStoreUnlisted: true,
            repaired: null,
        })
        expect(outcome.inlays).toEqual({
            exported: 1,
            leftOut: [{ id: INLAY_OLD, reason: 'unreadable' }, { id: INLAY_UNSUP, reason: 'unsupported' }],
            oldStoreUnlisted: true,
        })
        expect(report.counts).toMatchObject({ inlays: 1, assets: 1 })
    })
})

describe('save first (T-S8-3)', () => {
    test('a save that publishes a newer manifest before the walk is the exported root, and the file clock is read after it', async () => {
        const backend = await world.open()
        for (const [key, bytes] of edited.store) {
            await backend.putUnit(key, bytes)
        }
        const clock = { now: RTB_TEST_CLOCK }
        let savedAt = 0
        const built = rtbDeps({
            backend, env: world.env, files: FILES, ...inlays(),
            over: {
                clock: () => clock.now,
                saveFirst: async () => {
                    await moveCurrent(backend, edited.manifestKey, world.env)
                    clock.now = RTB_TEST_CLOCK + 5000
                    savedAt = clock.now
                },
            },
        })
        const result = await runRtbExportGuarded(built.deps, { fileName: 'test.rtb' })
        const { report } = saved(result)
        const manifest = rtbManifestOf(await readRtbFile(built.writer.bytes()))
        const root = manifest.sections.find((row) => row.id === 'store2')?.meta?.root
        expect(root?.[0]).toBe(edited.manifestKey.slice('store2/'.length))
        expect(manifest.source.committedAt).toBe(CURRENT_AT + 1)
        expect(report.createdAt).toBeGreaterThanOrEqual(savedAt)
        expect(manifest.createdAt).toBe(report.createdAt)
    })
})

describe('what was left unsaved (T-S8-4)', () => {
    async function flagged(over: Partial<RtbExportDeps>) {
        const { result, writer } = await exportFrom(world, { over })
        const { report } = saved(result)
        const manifest = rtbManifestOf(await readRtbFile(writer.bytes()))
        return { report, manifest }
    }

    test('(a) clean before and after: not excluded', async () => {
        const { report, manifest } = await flagged({ isSaveClean: () => true })
        expect(manifest.source.unsavedExcluded).toBe(false)
        expect(report.unsavedExcluded).toBe(false)
    })

    test('(b) a page that stays dirty exports its saved state flagged, with the commit time from the walk', async () => {
        const { report, manifest } = await flagged({ isSaveClean: () => false })
        expect(manifest.source.unsavedExcluded).toBe(true)
        expect(manifest.source.committedAt).toBe(CURRENT_AT)
        expect(report.unsavedExcluded).toBe(true)
    })

    test('(c) a clean page with an unsavable module is flagged', async () => {
        const { report, manifest } = await flagged({ moduleVerdicts: () => ['saved', 'unsavable'] })
        expect(manifest.source.unsavedExcluded).toBe(true)
        expect(report.unsavedExcluded).toBe(true)
    })

    test('(d) a blocked module is flagged too, and report and manifest agree', async () => {
        const { report, manifest } = await flagged({ moduleVerdicts: () => ['blocked'] })
        expect(report.unsavedExcluded).toBe(manifest.source.unsavedExcluded)
        expect(report.unsavedExcluded).toBe(true)
    })

    test('(e) dirty when the call starts and clean once the save finished: not flagged in the manifest and the report', async () => {
        let dirty = true
        const { report, manifest } = await flagged({
            isSaveClean: () => !dirty,
            saveFirst: async () => { dirty = false },
        })
        expect(manifest.source.unsavedExcluded).toBe(false)
        expect(report.unsavedExcluded).toBe(false)
    })
})

describe('refusals (T-S8-5)', () => {
    interface Case {
        name: string
        opfs: boolean
        mode: ReturnType<RtbExportDeps['pageMode']>
        session: ReturnType<RtbExportDeps['session']>
        reason: 'read-only' | 'not-store2' | 'no-session'
    }
    const live = { committer: {} as never, backend: {} as never }
    const cases: Case[] = [
        { name: 'the OPFS page: read-only mode, no committer', opfs: true, mode: { kind: 'read-only', reason: 'opfs-transitional' }, session: { committer: null, backend: null }, reason: 'read-only' },
        { name: 'the OPFS check is independent of the mode (branch order)', opfs: true, mode: { kind: 'store2' }, session: live, reason: 'read-only' },
        { name: 'a read-only page with a session that has no committer', opfs: false, mode: { kind: 'read-only', reason: 'backend-unavailable' }, session: { committer: null, backend: live.backend }, reason: 'read-only' },
        { name: 'a page that has not booted', opfs: false, mode: { kind: 'unset' }, session: null, reason: 'not-store2' },
        { name: 'a store2 page with a null committer', opfs: false, mode: { kind: 'store2' }, session: { committer: null, backend: live.backend }, reason: 'no-session' },
        { name: 'a store2 page with a null backend', opfs: false, mode: { kind: 'store2' }, session: { committer: live.committer, backend: null }, reason: 'no-session' },
        { name: 'a store2 page with no session', opfs: false, mode: { kind: 'store2' }, session: null, reason: 'no-session' },
    ]

    test.each(cases)('$name is refused as $reason, with nothing opened, saved or registered', async ({ opfs, mode, session, reason }) => {
        const backend = await world.open()
        const sampled: boolean[] = []
        const openWriter = vi.fn(async () => null)
        const saveFirst = vi.fn(async () => { })
        const { deps } = rtbDeps({
            backend, env: world.env,
            over: {
                opfsTransitional: async () => { sampled.push(isBusy()); return opfs },
                pageMode: () => { sampled.push(isBusy()); return mode },
                session: () => { sampled.push(isBusy()); return session },
                openWriter,
                saveFirst,
            },
        })
        const result = await runRtbExportGuarded(deps)
        expect(result).toEqual({ status: 'refused', reason })
        expect(openWriter).not.toHaveBeenCalled()
        expect(saveFirst).not.toHaveBeenCalled()
        expect(sampled.length).toBeGreaterThan(0)
        expect(sampled.every((busy) => !busy)).toBe(true)
        expect(isBusy()).toBe(false)
    })
})

describe('the pre-check agrees with the guarded entry (refusal parity)', () => {
    const live = { committer: {} as never, backend: {} as never }
    const pairs: { name: string, opfs: boolean, mode: ReturnType<RtbExportDeps['pageMode']>, session: ReturnType<RtbExportDeps['session']> }[] = [
        { name: 'the OPFS page', opfs: true, mode: { kind: 'read-only', reason: 'opfs-transitional' }, session: { committer: null, backend: null } },
        { name: 'an OPFS page whose mode reads store2', opfs: true, mode: { kind: 'store2' }, session: live },
        { name: 'a read-only page', opfs: false, mode: { kind: 'read-only', reason: 'backend-unavailable' }, session: { committer: null, backend: live.backend } },
        { name: 'a page that has not booted', opfs: false, mode: { kind: 'unset' }, session: null },
        { name: 'a store2 page without a committer', opfs: false, mode: { kind: 'store2' }, session: { committer: null, backend: live.backend } },
    ]

    test.each(pairs)('$name: rtbExportRefusal equals the reason the guarded entry refuses with', async ({ opfs, mode, session }) => {
        const backend = await world.open()
        const { deps } = rtbDeps({ backend, env: world.env, over: { opfsTransitional: async () => opfs, pageMode: () => mode, session: () => session } })
        const asked = await rtbExportRefusal(deps)
        const result = await runRtbExportGuarded(deps)
        expect(asked).not.toBeNull()
        expect(result).toEqual({ status: 'refused', reason: asked })
    })

    test('a page that can save has no refusal, and the guarded entry runs', async () => {
        const backend = await world.open()
        const { deps } = rtbDeps({ backend, env: world.env, files: FILES })
        expect(await rtbExportRefusal(deps)).toBeNull()
        expect((await runRtbExportGuarded(deps, { fileName: 'test.rtb' })).status).toBe('ended')
    })
})

describe('the progress text on the wait gate (S1, N-2)', () => {
    const textOf = (event: RtbExportProgress): string => JSON.stringify(event)
    const waits = () => vi.mocked(alertWait).mock.calls

    beforeEach(() => {
        vi.mocked(alertWait).mockClear()
    })

    test('with progressText every event posts its text through the real wait gate, after onProgress and in event order, and the file has the same entries', async () => {
        const log: string[] = []
        const events: RtbExportProgress[] = []
        const backend = await world.open()
        const withText = rtbDeps({ backend, env: world.env, files: FILES, ...inlays() })
        const result = await runRtbExportGuarded(withText.deps, {
            fileName: 'test.rtb',
            onProgress: (event) => { events.push(event); log.push(`progress ${textOf(event)}`) },
            progressText: (event) => { log.push(`text ${textOf(event)}`); return textOf(event) },
        })
        saved(result)
        expect(events.length).toBeGreaterThan(8)
        expect(waits().map((call) => call[0])).toEqual(events.map(textOf))
        expect(log).toEqual(events.flatMap((event) => [`progress ${textOf(event)}`, `text ${textOf(event)}`]))
        // On the web the wait dialog carries the Cancel.
        expect(waits().every((call) => typeof call[1] === 'function')).toBe(true)

        const plain = rtbDeps({ backend: await world.open(), env: world.env, files: FILES, ...inlays() })
        saved(await runRtbExportGuarded(plain.deps, { fileName: 'test.rtb' }))
        const names = async (bytes: Uint8Array) => [...(await readRtbFile(bytes)).keys()].sort()
        expect(await names(withText.writer.bytes())).toEqual(await names(plain.writer.bytes()))
    })

    test('without progressText no wait dialog is posted', async () => {
        const { deps } = rtbDeps({ backend: await world.open(), env: world.env, files: FILES })
        saved(await runRtbExportGuarded(deps, { fileName: 'test.rtb' }))
        expect(waits()).toHaveLength(0)
    })

    test('the dialog\'s Cancel during the units ends the run as declined/export-cancelled, busy ends only after the walk settled, and nothing posts afterwards', async () => {
        const backend = await world.open()
        const state = { calls: 0, held: false, reads: 0 }
        let release: () => void = () => { }
        const gate = new Promise<void>((resolve) => { release = resolve })
        const original = backend.readUnits.bind(backend)
        backend.readUnits = async (keys) => {
            state.calls++
            if (state.calls === 3) {
                state.held = true
                await gate
            }
            state.reads++
            return original(keys)
        }
        const writer = new FakeLocalWriter()
        const { deps } = rtbDeps({ backend, env: world.env, files: FILES, writer })
        let settled = false
        const run = runRtbExportGuarded(deps, { fileName: 'test.rtb', progressText: textOf }).finally(() => { settled = true })

        for (let waited = 0; !state.held && waited < 200; waited++) {
            await new Promise((resolve) => setTimeout(resolve, 10))
        }
        expect(state.held, 'the walk is suspended in a read').toBe(true)
        const cancel = waits().at(-1)?.[1]
        expect(cancel).toBeTypeOf('function')
        cancel?.()
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(settled, 'the export waits for the walk').toBe(false)
        expect(isBusy()).toBe(true)
        const postedAtCancel = waits().length

        release()
        const result = await run
        expect(result).toMatchObject({ status: 'ended', outcome: { status: 'declined', cause: 'export-cancelled' }, report: null })
        expect(writer.closes).toBe(0)
        expect(isBusy()).toBe(false)
        expect(waits().length, 'a cancelled gate posts nothing').toBe(postedAtCancel)
        const readsAtEnd = state.reads
        await new Promise((resolve) => setTimeout(resolve, 30))
        expect(state.reads).toBe(readsAtEnd)
    })
})

describe('cancel and failure through the shell (T-S8-9)', () => {
    function readCounter(backend: Awaited<ReturnType<RtbWorld['open']>>) {
        const state = { reads: 0 }
        const original = backend.readUnits.bind(backend)
        backend.readUnits = (keys) => {
            state.reads++
            return original(keys)
        }
        return state
    }

    test('(a) a cancel at the second unit batch ends declined, closes nothing, reads nothing more and leaves no walk running', async () => {
        const backend = await world.open()
        const counter = readCounter(backend)
        let cancel: ExportCancelToken | null = null
        let batches = 0
        let readsAtCancel = -1
        const writer = new FakeLocalWriter()
        const { deps } = rtbDeps({
            backend, env: world.env, files: FILES, writer,
            over: {
                openWriter: async (session) => {
                    cancel = session.cancel
                    writer.cancel = session.cancel
                    session.writer = writer as never
                    return writer as never
                },
                afterUnitBatch: async () => {
                    batches++
                    if (batches === 2) {
                        readsAtCancel = counter.reads
                        cancel?.cancel()
                    }
                },
            },
        })
        const result = await runRtbExportGuarded(deps, { fileName: 'test.rtb' })
        expect(result).toMatchObject({ status: 'ended', outcome: { status: 'declined', cause: 'export-cancelled' }, report: null })
        expect(writer.closes).toBe(0)
        expect(batches).toBe(2)
        expect(isBusy()).toBe(false)
        const readsAtReturn = counter.reads
        expect(readsAtReturn).toBe(readsAtCancel)
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(counter.reads).toBe(readsAtReturn)
    })

    const big = { [ASSET_A]: new Uint8Array(2 * 1024 * 1024).fill(7) }

    test('(b) a sink failure during the assets ends failed and deleted on a touched file writer, and the batch reader is closed', async () => {
        const backend = await world.open()
        const close = vi.spyOn(ExportAssetReader.prototype, 'close')
        const writer = new FakeLocalWriter({ file: new TauriWriter('out.rtb') as never, failWriteNumber: 2 })
        const { deps } = rtbDeps({
            backend, env: world.env, files: big, writer,
            over: {
                assets: {
                    listSized: async () => [{ key: ASSET_A, size: big[ASSET_A].length }],
                    readBatch: async () => [{ status: 'ok', bytes: big[ASSET_A] }],
                    readerLimits: { batchBytes: 4 * 1024 * 1024 },
                    pieceSource: async () => null,
                },
            },
        })
        const result = await runRtbExportGuarded(deps, { fileName: 'test.rtb' })
        expect(result).toMatchObject({ status: 'ended', outcome: { status: 'failed', file: 'deleted' }, report: null })
        expect(vi.mocked(remove)).toHaveBeenCalledWith('out.rtb')
        expect(writer.closes).toBe(0)
        expect(close).toHaveBeenCalled()
        expect(isBusy()).toBe(false)
    })

    test('(b) the same failure on a stream writer is kept, and on a memory writer untouched', async () => {
        for (const [held, file] of [['stream', 'kept'], ['memory', 'untouched']] as const) {
            const backend = await world.open()
            const writer = new FakeLocalWriter({ held, failWriteNumber: 2 })
            const { deps } = rtbDeps({ backend, env: world.env, files: big, writer })
            const result = await runRtbExportGuarded(deps, { fileName: 'test.rtb' })
            expect(result).toMatchObject({ status: 'ended', outcome: { status: 'failed', file } })
        }
    })

    test('(c) a close that rejects is a failure and never saved', async () => {
        const backend = await world.open()
        const writer = new FakeLocalWriter({ failClose: true })
        const { deps } = rtbDeps({ backend, env: world.env, files: FILES, writer })
        const result = await runRtbExportGuarded(deps, { fileName: 'test.rtb' })
        expect(writer.closes).toBe(1)
        expect(result).toMatchObject({ status: 'ended', outcome: { status: 'failed' }, report: null })
    })

    test('(d) a failure inside the walk fails the export, the walk has settled, and busy has ended', async () => {
        const backend = await world.open()
        const counter = readCounter(backend)
        let batches = 0
        const { deps, writer } = rtbDeps({
            backend, env: world.env,
            over: { afterUnitBatch: async () => { if (++batches === 2) { throw new Error('the walk was interrupted') } } },
        })
        const result = await runRtbExportGuarded(deps, { fileName: 'test.rtb' })
        expect(result).toMatchObject({ status: 'ended', outcome: { status: 'failed' }, report: null })
        expect(writer.closes).toBe(0)
        expect(isBusy()).toBe(false)
        const reads = counter.reads
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(counter.reads).toBe(reads)
    })

    test('(e) a writer that fails before it pulls a unit never starts the walk and leaves no busy entry', async () => {
        const backend = await world.open()
        const counter = readCounter(backend)
        const { deps } = rtbDeps({
            backend, env: world.env,
            over: { clock: () => { throw new Error('the clock failed') } },
        })
        const result = await runRtbExportGuarded(deps, { fileName: 'test.rtb' })
        expect(result).toMatchObject({ status: 'ended', outcome: { status: 'failed' }, report: null })
        expect(counter.reads).toBe(0)
        expect(isBusy()).toBe(false)
    })

    test('(f) a writer failure while the walk is suspended in a read keeps busy until that read settles, and nothing is read after busy ends', async () => {
        // One chat unit of about 5 MB of incompressible text: its block is written (and the fake writer fails) while
        // the walk, released from its push at once, is already asking the store for the next batch.
        const heavy = await rtbWorld({
            layout: 1, seed: 5,
            database: profile((db) => {
                const chat = ((db.characters as Obj[])[0].chats as Obj[])[0]
                ;(chat.message as Obj[]).push({ role: 'char', data: randomBytes(2_500_000).toString('hex'), time: 2 })
            }),
        })
        const backend = await heavy.open()
        const state = { bigSeen: false, held: false, reads: 0 }
        let release: () => void = () => { }
        const gate = new Promise<void>((resolve) => { release = resolve })
        const original = backend.readUnits.bind(backend)
        backend.readUnits = async (keys) => {
            if (state.bigSeen && !state.held) {
                state.held = true
                await gate
            }
            state.reads++
            const read = await original(keys)
            for (const bytes of read.values()) {
                if (bytes !== null && bytes.length > 4 * 1024 * 1024) {
                    state.bigSeen = true
                }
            }
            return read
        }
        const writer = new FakeLocalWriter({ failWriteNumber: 1 })
        const { deps } = rtbDeps({ backend, env: heavy.env, files: FILES, writer })
        let settled = false
        const run = runRtbExportGuarded(deps, { fileName: 'test.rtb' }).finally(() => { settled = true })

        for (let waited = 0; (!state.held || writer.writes < 1) && waited < 200; waited++) {
            await new Promise((resolve) => setTimeout(resolve, 25))
        }
        expect(state.held, 'the walk reached a read after the large unit').toBe(true)
        expect(writer.writes, 'the writer failed').toBeGreaterThanOrEqual(1)
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(settled, 'the export waits for the walk').toBe(false)
        expect(isBusy(), 'busy lasts as long as the walk').toBe(true)
        const readsWhileHeld = state.reads

        release()
        const result = await run
        expect(result).toMatchObject({ status: 'ended', outcome: { status: 'failed' }, report: null })
        expect(isBusy()).toBe(false)
        const readsAtEnd = state.reads
        expect(readsAtEnd - readsWhileHeld, 'only the read in flight finished').toBeLessThanOrEqual(1)
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(state.reads, 'no read after busy ended').toBe(readsAtEnd)
    })

    test('a cancelled save dialog is declined and nothing is saved', async () => {
        const backend = await world.open()
        const saveFirst = vi.fn(async () => { })
        const { deps } = rtbDeps({ backend, env: world.env, over: { openWriter: async () => null, saveFirst } })
        const result = await runRtbExportGuarded(deps)
        expect(result).toMatchObject({ status: 'ended', outcome: { status: 'declined', cause: 'save-dialog-cancelled' }, report: null })
        expect(saveFirst).not.toHaveBeenCalled()
        expect(isBusy()).toBe(false)
    })
})

describe('a sealed export wipes its key on every exit (issue 357)', () => {
    const allZero = (bytes: Uint8Array) => bytes.every((byte) => byte === 0)

    /** Cheap seal seams; `payloadKey()` is the byte array the sink would seal with (the second key imported). */
    function sealSeam(afterPayloadKey: () => void = () => { }) {
        const inner = nobleAead()
        const keys: Uint8Array[] = []
        const aead: AeadBackend = {
            ...inner,
            importKey: async (raw) => {
                const key = await inner.importKey(raw)
                keys.push(key as Uint8Array)
                if (keys.length === 2) {
                    afterPayloadKey()
                }
                return key
            },
        }
        return {
            seal: { params: { m: 8, t: 1, chunkSize: 65_536 }, kdf: async () => new Uint8Array(32).fill(9), aead },
            payloadKey: () => {
                expect(keys.length, 'the payload key was imported').toBe(2)
                return keys[1]
            },
        }
    }

    test('a cancel during the walk leaves the key zero', async () => {
        const seam = sealSeam()
        let batches = 0
        // `rtbDeps` ties the writer to the run's cancel switch when it opens the writer.
        const writer = new FakeLocalWriter()
        const { deps } = rtbDeps({
            backend: await world.open(), env: world.env, files: FILES, writer,
            over: {
                seal: seam.seal,
                afterUnitBatch: async () => {
                    batches++
                    if (batches === 2) {
                        writer.cancel?.cancel()
                    }
                },
            },
        })
        const result = await runRtbExportGuarded(deps, { fileName: 'test.rtb', password: 'password one' })
        expect(result).toMatchObject({ status: 'ended', outcome: { status: 'declined', cause: 'export-cancelled' } })
        expect(batches).toBe(2)
        expect(allZero(seam.payloadKey())).toBe(true)
    })

    test('a write failure leaves the key zero', async () => {
        const seam = sealSeam()
        const writer = new FakeLocalWriter({ failWriteNumber: 1 })
        const { deps } = rtbDeps({ backend: await world.open(), env: world.env, files: FILES, writer, over: { seal: seam.seal } })
        const result = await runRtbExportGuarded(deps, { fileName: 'test.rtb', password: 'password one' })
        expect(result).toMatchObject({ status: 'ended', outcome: { status: 'failed' } })
        expect(allZero(seam.payloadKey())).toBe(true)
    })

    test('a failure before any sink is taken leaves the key zero', async () => {
        const seam = sealSeam()
        const { deps } = rtbDeps({
            backend: await world.open(), env: world.env,
            over: { seal: seam.seal, saveFirst: async () => { throw new Error('the save failed') } },
        })
        const result = await runRtbExportGuarded(deps, { fileName: 'test.rtb', password: 'password one' })
        expect(result).toMatchObject({ status: 'ended', outcome: { status: 'failed' } })
        expect(allZero(seam.payloadKey())).toBe(true)
    })

    test('a declined writer leaves the key zero', async () => {
        const seam = sealSeam()
        const { deps } = rtbDeps({ backend: await world.open(), env: world.env, over: { seal: seam.seal, openWriter: async () => null } })
        const result = await runRtbExportGuarded(deps, { fileName: 'test.rtb', password: 'password one' })
        expect(result).toMatchObject({ status: 'ended', outcome: { status: 'declined', cause: 'save-dialog-cancelled' } })
        expect(allZero(seam.payloadKey())).toBe(true)
    })

    test('a cancel right after the derivation, before the writer opens, leaves the key zero', async () => {
        vi.mocked(alertWait).mockClear()
        const seam = sealSeam(() => {
            vi.mocked(alertWait).mock.calls.at(-1)?.[1]?.()
        })
        const openWriter = vi.fn(async () => null)
        const { deps } = rtbDeps({ backend: await world.open(), env: world.env, over: { seal: seam.seal, openWriter } })
        const result = await runRtbExportGuarded(deps, { fileName: 'test.rtb', password: 'password one', progressText: (event) => JSON.stringify(event) })
        expect(result).toMatchObject({ status: 'ended', outcome: { status: 'declined', cause: 'export-cancelled' } })
        expect(openWriter).not.toHaveBeenCalled()
        expect(allZero(seam.payloadKey())).toBe(true)
    })

    test('a successful export still writes the file and leaves the key zero', async () => {
        const seam = sealSeam()
        const { deps, writer } = rtbDeps({ backend: await world.open(), env: world.env, over: { seal: seam.seal } })
        saved(await runRtbExportGuarded(deps, { fileName: 'test.rtb', password: 'password one' }))
        expect(writer.bytes().length).toBeGreaterThan(0)
        expect(allZero(seam.payloadKey())).toBe(true)
    })
})

describe('progress (T-S8-10)', () => {
    test('the phases come in order, counters never decrease and the totals are the filtered counts', async () => {
        const events: RtbExportProgress[] = []
        const backend = await world.open()
        const { deps } = rtbDeps({ backend, env: world.env, files: FILES, iris: { a: 1 }, ...inlays() })
        const result = await runRtbExportGuarded(deps, { fileName: 'test.rtb', onProgress: (event) => events.push(event) })
        saved(result)
        const firsts: string[] = []
        for (const event of events) {
            if (!firsts.includes(event.phase)) {
                firsts.push(event.phase)
            }
        }
        expect(firsts).toEqual(['opening', 'saving', 'units', 'side', 'inlays', 'assets', 'finishing'])
        const phases: string[] = events.map((event) => event.phase)
        const lastIndex = (phase: string) => phases.lastIndexOf(phase)
        const firstIndex = (phase: string) => phases.indexOf(phase)
        expect(lastIndex('units')).toBeLessThan(firstIndex('side'))
        expect(lastIndex('side')).toBeLessThan(firstIndex('inlays'))
        expect(lastIndex('inlays')).toBeLessThan(firstIndex('assets'))
        for (const phase of ['inlays', 'assets'] as const) {
            const own = events.filter((event): event is Extract<RtbExportProgress, { phase: 'inlays' | 'assets' }> => event.phase === phase)
            expect(own.map((event) => event.total).every((total) => total === own[0].total)).toBe(true)
            expect(own.map((event) => event.done)).toEqual([...own.map((event) => event.done)].sort((a, b) => a - b))
            expect(own[own.length - 1].done).toBe(own[0].total)
        }
        expect(events.find((event) => event.phase === 'inlays')).toMatchObject({ total: 2 })
        expect(events.find((event) => event.phase === 'assets')).toMatchObject({ total: 2 })
        const unitCounts = events.filter((event): event is { phase: 'units', units: number } => event.phase === 'units').map((event) => event.units)
        expect(unitCounts).toEqual([...unitCounts].sort((a, b) => a - b))
    })
})

describe('damage in the walk (T-S8-14)', () => {
    test('a damaged type 21 unit fails the export with the closure error', async () => {
        const key = world.keysOfType(UNIT_TYPE.inlayList)[0]
        const { result } = await exportFrom(world, {}, new Map([[key, damagedFrame(world.store.get(key) as Uint8Array)]]))
        expect(result.status === 'ended' && result.outcome.status === 'failed' && result.outcome.cause).toBeInstanceOf(ExportClosureError)
        expect(result.status === 'ended' && result.outcome.status === 'failed' && (result.outcome.cause as ExportClosureError).kind).toBe('damaged')
    })

    test('a damaged type 26 unit plus a commit that lands during the walk fails the export as moved', async () => {
        const key = world.keysOfType(UNIT_TYPE.taskPreset)[0]
        const backend = await world.open(new Map([[key, damagedFrame(world.store.get(key) as Uint8Array)]]))
        for (const [unitKey, bytes] of edited.store) {
            await backend.putUnit(unitKey, bytes)
        }
        let moved = false
        const { deps } = rtbDeps({
            backend, env: world.env, files: FILES,
            over: { afterUnitBatch: async () => { if (!moved) { moved = true; await moveCurrent(backend, edited.manifestKey, world.env) } } },
        })
        const result = await runRtbExportGuarded(deps, { fileName: 'test.rtb' })
        expect(result.status === 'ended' && result.outcome.status === 'failed' && (result.outcome.cause as ExportClosureError).kind).toBe('moved')
        expect(isBusy()).toBe(false)
    })
})
