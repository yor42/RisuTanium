// @vitest-environment node
/**
 * N1 of the `.rtb` export (CHORE-128 S8): while the export walks the store2 units, the automatic clean-up pass removes
 * nothing, because the export's busy entry is registered. The test calls `runRtbExportGuarded`, which holds the real
 * busy registry, and runs the real `gcPass` with the page's own stop rule (`buildAutoGcDeps`) from inside the walk,
 * after the commit key has moved to a second tree published in the same store, so the exported tree is exactly what a
 * pass would collect. A memory backend says nothing about the app's files store; the collector's own tests and the
 * device rows cover that.
 *
 * Label: compatibility guard of a new contract; its scratch mutant (the walk outside the busy entry) turns it red.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { isBusy, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import type { Ref } from 'src/ts/storage/store2/format'
import { buildAutoGcDeps, type AutoGcFacts } from 'src/ts/storage/store2/gc/autoGc'
import { gcPass, type GcResult } from 'src/ts/storage/store2/gc/pass'
import { omittedTailsOf, planRestore } from 'src/ts/storage/store2/rtb/restoreBuild'
import { classifyRtb } from 'src/ts/drive/rtb/rtbClassify'
import { runRtbExportGuarded } from 'src/ts/drive/rtbExport'
import { rangeSourceOfBytes } from './sparseSource'
import { buildSmall, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'
import {
    assembleStore, commitRestore, framesOfRtbFile, moveCurrent, readRtbFile, rtbDeps, rtbManifestOf, rtbWorld, type RtbWorld,
} from 'src/ts/storage/tests/store2/rtbFixtures'

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

vi.mock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false, isWeb: true, isIOS: () => false }))
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

// The page's own stop rule reads the real busy registry; the other two facts are quiet.
const FACTS: AutoGcFacts = { isBusy: () => isBusy(), saveLoopParked: () => false, isSaveClean: () => true }

let world: RtbWorld
let second: RtbWorld

function profile(name: string): Obj {
    const db = JSON.parse(JSON.stringify(buildSmall(2))) as Obj
    ;(db.characters as Obj[])[0].name = name
    return db
}

beforeAll(async () => {
    world = await rtbWorld({ layout: 1, database: profile('first tree') })
    second = await rtbWorld({ layout: 1, seed: 9, database: profile('second tree') })
})

beforeEach(() => {
    resetBusyActionsForTest()
    resetPageStorageModeForTests()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('a clean-up pass during the unit phase (T-S8-2, N1)', () => {
    test('the pass stops at its first batch while the export holds busy, the export completes, and the same pass deletes once busy has ended', async () => {
        const backend = await world.open()
        for (const [key, bytes] of second.store) {
            await backend.putUnit(key, bytes)
        }
        const passDeps = buildAutoGcDeps({ kind: 'tauri', backend, idleReason: null }, FACTS)
        if (passDeps === null) {
            throw new Error('the pass has no deps')
        }
        let during: GcResult | null = null
        const { deps, writer } = rtbDeps({
            backend, env: world.env,
            over: {
                afterUnitBatch: async () => {
                    if (during !== null) {
                        return
                    }
                    // The commit key now names the second tree: every unit of the exported tree is a candidate for the pass.
                    await moveCurrent(backend, second.manifestKey, world.env)
                    during = await gcPass(passDeps)
                },
            },
        })

        const result = await runRtbExportGuarded(deps, { fileName: 'test.rtb' })

        // (a) the pass did nothing, and the export is whole and holds the first tree.
        expect(during).toMatchObject({ status: 'done', deleted: 0, stopped: 'yielded' })
        expect(result).toMatchObject({ status: 'ended', outcome: { status: 'saved' } })
        const bytes = writer.bytes()
        expect((await classifyRtb(rangeSourceOfBytes(bytes))).kind).toBe('ok')
        const files = await readRtbFile(bytes)
        const manifest = rtbManifestOf(files)
        const root = manifest.sections.find((row) => row.id === 'store2')?.meta?.root as Ref
        expect(root[0]).toBe(world.manifestKey.slice('store2/'.length))
        const request = planRestore({ frames: framesOfRtbFile(files), root, omitted: omittedTailsOf(manifest.omitted), target: { legacyKeep: null, req: [] } })
        const restored = await commitRestore(request)
        expect(assembleStore(restored.units, restored.manifestKey)).toEqual(assembleStore(world.store, world.manifestKey))
        expect(isBusy()).toBe(false)

        // (b) control: with busy ended, the same pass over the same store removes units of the exported tree.
        const after = await gcPass(passDeps)
        expect(after.status === 'done' && after.deleted).toBeGreaterThan(0)
        const exportedKeys = [...world.store.keys()].filter((key) => !second.store.has(key))
        const left = await backend.readUnits(exportedKeys)
        expect(exportedKeys.some((key) => left.get(key) === null)).toBe(true)
    })
})
