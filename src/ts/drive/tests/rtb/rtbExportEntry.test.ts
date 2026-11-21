// @vitest-environment node
/**
 * The `.rtb` export entry (CHORE-128 S9). Every test is a compatibility guard of a new contract (no pre-fix base
 * exists); each turns red on a named scratch mutant. The entry tests inject `RtbEntryDeps` and use the real `language`.
 * The wiring test drives the real `runRtbExportGuarded`, busy registry and S7 shell with S8's real-producer world and a
 * memory writer; the alert module is mocked, so it says nothing about how a dialog renders.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { alertWait } from 'src/ts/alert'
import { requestTaskCancel, resetTaskHostForTests, setTaskClockForTests, taskHostView } from 'src/ts/alertTask.svelte'
import { isBusy, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { buildSmall, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'
import { rtbDeps, rtbWorld, type RtbWorld } from 'src/ts/storage/tests/store2/rtbFixtures'
import type { OmittedEntry } from 'src/ts/drive/rtb/manifest'
import {
    rtbExportRefusal, runRtbExportGuarded,
    type RtbExportOptions, type RtbExportRefusal, type RtbExportReport, type RtbExportResult,
} from 'src/ts/drive/rtbExport'
import { rtbProgressText, rtbRefusalText, rtbSavedNotice, startRtbExport, type RtbEntryDeps } from 'src/ts/drive/rtbExportEntry'

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
vi.mock('src/ts/alert', () => ({
    alertError: vi.fn(), alertNormal: vi.fn(), alertNormalWait: vi.fn(), alertClear: vi.fn(), alertWait: vi.fn(), alertConfirm: vi.fn(async () => true),
}))
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

const bin = language.saveBackupLocal

function reportOf(over: Partial<RtbExportReport> = {}): RtbExportReport {
    return {
        fileName: 'local-20261117.rtb', length: 10, snapshotId: 's', createdAt: 1_700_000_000_000, committedAt: 1_700_000_000_000,
        unsavedExcluded: false, omitted: [], referencedNotices: [], oldInlayStoreUnlisted: false, counts: { units: 1, inlays: 0, assets: 0 },
        ...over,
    }
}

function savedResult(report: RtbExportReport | null): RtbExportResult {
    return { status: 'ended', outcome: { status: 'saved', notices: [], omitted: { assets: [], oversize: [], units: [], inlays: [], oldStoreUnlisted: false, repaired: null }, inlays: null }, report }
}

function endedWith(outcome: Extract<RtbExportResult, { status: 'ended' }>['outcome']): RtbExportResult {
    return { status: 'ended', outcome, report: null }
}

function entryDeps(over: Partial<RtbEntryDeps> = {}): RtbEntryDeps & { calls: Record<'refusal' | 'confirm' | 'run' | 'error' | 'normal' | 'clear', ReturnType<typeof vi.fn>> } {
    const calls = {
        refusal: vi.fn(async (): Promise<RtbExportRefusal | null> => null),
        confirm: vi.fn(async (_msg: string) => true),
        run: vi.fn(async (_options: RtbExportOptions) => savedResult(reportOf())),
        error: vi.fn(),
        normal: vi.fn(),
        clear: vi.fn(),
    }
    return { ...calls, isTauri: false, calls, ...over }
}

describe('the progress texts (T-S9-1)', () => {
    test('every phase maps to its text, the saving phase to the existing saving text, and the counters appear', () => {
        expect(rtbProgressText({ phase: 'opening' })).toBe(language.rtbExportProgressOpening)
        expect(rtbProgressText({ phase: 'saving' })).toBe(language.store2RestoreSaving)
        expect(rtbProgressText({ phase: 'units', units: 12 })).toBe(language.rtbExportProgressUnits(12))
        expect(rtbProgressText({ phase: 'units', units: 12 })).toContain('12')
        expect(rtbProgressText({ phase: 'side', section: 'x' })).toBe(language.rtbExportProgressSide)
        expect(rtbProgressText({ phase: 'inlays', done: 3, total: 9 })).toBe(language.rtbExportProgressInlays(3, 9))
        expect(rtbProgressText({ phase: 'inlays', done: 3, total: 9 })).toContain('3 / 9')
        expect(rtbProgressText({ phase: 'assets', done: 4, total: 8 })).toBe(language.rtbExportProgressAssets(4, 8))
        expect(rtbProgressText({ phase: 'assets', done: 4, total: 8 })).toContain('4 / 8')
        expect(rtbProgressText({ phase: 'finishing' })).toBe(language.rtbExportProgressFinishing)
    })
})

describe('refusals (T-S9-3)', () => {
    test.each([
        ['read-only', language.rtbExportRefusedReadOnly(bin)],
        ['not-store2', language.rtbExportUnavailable(bin)],
        ['no-session', language.rtbExportUnavailable(bin)],
    ] as const)('%s shows its text naming the .bin button once, and asks and runs nothing', async (reason, text) => {
        const deps = entryDeps({ refusal: async () => reason })
        expect(await startRtbExport(deps)).toBeNull()
        expect(deps.calls.error).toHaveBeenCalledTimes(1)
        expect(deps.calls.error).toHaveBeenCalledWith(text)
        expect(text).toContain(bin)
        expect(rtbRefusalText(reason)).toBe(text)
        expect(deps.calls.confirm).not.toHaveBeenCalled()
        expect(deps.calls.run).not.toHaveBeenCalled()
    })
})

describe('the confirm and the run (T-S9-5)', () => {
    test('declining the confirm runs and shows nothing', async () => {
        const deps = entryDeps({ confirm: async () => false })
        expect(await startRtbExport(deps)).toBeNull()
        expect(deps.calls.run).not.toHaveBeenCalled()
        expect(deps.calls.error).not.toHaveBeenCalled()
        expect(deps.calls.normal).not.toHaveBeenCalled()
        expect(deps.calls.clear).not.toHaveBeenCalled()
    })

    test('the confirm names the .bin button and the run gets the progress texts', async () => {
        const deps = entryDeps()
        await startRtbExport(deps)
        expect(deps.calls.confirm).toHaveBeenCalledWith(language.rtbExportConfirm(bin))
        expect(deps.calls.run).toHaveBeenCalledWith({ progressText: rtbProgressText, card: expect.objectContaining({ def: expect.any(Object), savedEnding: expect.any(Function) }) })
    })

    test('T-S2-10: a password in the options reaches the run, and no options leave it undefined', async () => {
        const sealed = entryDeps()
        await startRtbExport(sealed, { password: 'pw' })
        expect(sealed.calls.run).toHaveBeenCalledWith({ progressText: rtbProgressText, card: expect.objectContaining({ def: expect.any(Object), savedEnding: expect.any(Function) }), password: 'pw' })
        const plain = entryDeps()
        await startRtbExport(plain)
        expect(plain.calls.run.mock.calls[0][0].password).toBeUndefined()
    })

    test('a run that finds the page changed shows the refusal text', async () => {
        const deps = entryDeps({ run: async () => ({ status: 'refused', reason: 'read-only' }) })
        await startRtbExport(deps)
        expect(deps.calls.error).toHaveBeenCalledWith(language.rtbExportRefusedReadOnly(bin))
        expect(deps.calls.normal).not.toHaveBeenCalled()
    })
})

describe('the saved notice (T-S9-6, T-S9-7, T-S9-8)', () => {
    test('with nothing left out it is the saved text on Tauri and the download text on the web, and nothing else', () => {
        expect(rtbSavedNotice(reportOf(), true)).toBe(language.rtbExportSaved)
        expect(rtbSavedNotice(reportOf(), false)).toBe(language.exportDownloadStarted)
    })

    test('unsavedExcluded adds the saved time, and its absence does not', () => {
        const at = 1_700_000_123_000
        const paragraph = language.rtbExportUnsavedExcluded(new Date(at).toLocaleString())
        expect(rtbSavedNotice(reportOf({ unsavedExcluded: true, committedAt: at }), true)).toContain(paragraph)
        expect(rtbSavedNotice(reportOf({ unsavedExcluded: false, committedAt: at }), true)).not.toContain(paragraph)
    })

    test('a side omission that only the report holds is named, with the outcome\'s omitted list empty', async () => {
        const side: OmittedEntry = { kind: 'side', name: 'side.iris', reason: 'unreadable' }
        const deps = entryDeps()
        deps.calls.run.mockImplementation(async () => savedResult(reportOf({ omitted: [side] })))
        await startRtbExport(deps)
        // The run posts the saved ending on its card; the entry posts nothing itself.
        expect(deps.calls.normal).not.toHaveBeenCalled()
        const { savedEnding } = deps.calls.run.mock.calls[0][0].card!
        const sideReport = reportOf({ omitted: [side] })
        expect(savedEnding(sideReport)).toEqual({ notice: rtbSavedNotice(sideReport, false) })
        const ending = savedEnding(sideReport)
        const notice = 'notice' in ending ? ending.notice : ''
        expect(notice).toContain(language.backupDataLeftOut)
        expect(notice).toContain(language.rtbExportSideLeftOut(1))
        expect(notice).not.toContain('side.iris')
        expect(savedEnding(reportOf())).toEqual({ summary: [language.exportDownloadStarted] })
    })

    test('units, assets, inlays and the old inlay store each add their paragraph, and long lists are cut', () => {
        const assets: OmittedEntry[] = Array.from({ length: 40 }, (_, index) => ({ kind: 'asset', name: `a${index}.png`, reason: 'unreadable' }))
        const notice = rtbSavedNotice(reportOf({
            omitted: [
                { kind: 'unit', name: 'u1', reason: 'damaged' },
                ...assets,
                { kind: 'inlay', name: 'inlay-1', reason: 'unreadable' },
            ],
            oldInlayStoreUnlisted: true,
        }), true)
        expect(notice).toContain(language.rtbExportUnitsLeftOut(1))
        expect(notice).toContain('a0.png')
        expect(notice).toMatch(/\.\.\.and \d+ more/)
        expect(notice).toContain('inlay-1')
        expect(notice).toContain(language.backupInlaysOldStoreUnlisted)
        expect(notice).not.toContain('u1')
        expect(notice).not.toContain('a39.png')
    })
})

describe('what ends without a saved file (T-S9-9)', () => {
    test.each([
        ['failed', endedWith({ status: 'failed', cause: new Error('x'), file: 'untouched' })],
        ['export-cancelled', endedWith({ status: 'declined', cause: 'export-cancelled', file: 'untouched' })],
        ['oversize-declined', endedWith({ status: 'declined', cause: 'oversize-declined' })],
    ])('%s adds no notice and no error', async (_name, result) => {
        const deps = entryDeps({ run: async () => result })
        await startRtbExport(deps)
        expect(deps.calls.normal).not.toHaveBeenCalled()
        expect(deps.calls.error).not.toHaveBeenCalled()
        expect(deps.calls.clear).not.toHaveBeenCalled()
    })

    test('a closed save dialog says nothing and clears no notice, as no wait of the run is up', async () => {
        const deps = entryDeps({ run: async () => endedWith({ status: 'declined', cause: 'save-dialog-cancelled' }) })
        await startRtbExport(deps)
        expect(deps.calls.clear).not.toHaveBeenCalled()
        expect(deps.calls.error).not.toHaveBeenCalled()
        expect(deps.calls.normal).not.toHaveBeenCalled()
    })
})

describe('one run at a time (item 4)', () => {
    test('a second start while one is in flight is ignored, and a later start runs', async () => {
        let release: (confirmed: boolean) => void = () => { }
        const first = entryDeps({ confirm: () => new Promise<boolean>((resolve) => { release = resolve }) })
        const pending = startRtbExport(first)
        await Promise.resolve()
        const second = entryDeps()
        expect(await startRtbExport(second)).toBeNull()
        expect(second.calls.refusal).not.toHaveBeenCalled()
        expect(second.calls.confirm).not.toHaveBeenCalled()
        release(false)
        await pending
        const third = entryDeps()
        await startRtbExport(third)
        expect(third.calls.run).toHaveBeenCalledTimes(1)
    })
})

describe('the wiring through the real guarded run (T-S9-2, T-S9-4)', () => {
    let world: RtbWorld

    beforeAll(async () => {
        const database = JSON.parse(JSON.stringify(buildSmall(2))) as Obj
        world = await rtbWorld({ layout: 1, database })
    })

    beforeEach(() => {
        resetBusyActionsForTest()
        resetPageStorageModeForTests()
        resetTaskHostForTests()
        let tick = 0
        setTaskClockForTests({ now: () => (tick += 1000), setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (timer) => clearTimeout(timer), hidden: () => false })
        vi.mocked(alertWait).mockClear()
        vi.spyOn(console, 'error').mockImplementation(() => { })
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        vi.spyOn(console, 'info').mockImplementation(() => { })
    })

    afterEach(() => {
        setTaskClockForTests(null)
        resetTaskHostForTests()
        vi.restoreAllMocks()
    })

    test('the entry passes its card to the run, so the card shows the steps in order with a Cancel, and a Cancel ends it as cancelled', async () => {
        const backend = await world.open()
        const stepsSeen: string[] = []
        const { deps } = rtbDeps({
            backend, env: world.env,
            over: { afterUnitBatch: async () => { const view = taskHostView(); stepsSeen.push(view?.steps[view.stepIndex]?.label ?? '') } },
        })
        const live = entryDeps({ run: (options) => runRtbExportGuarded(deps, { ...options, fileName: 'test.rtb' }) })
        const result = await startRtbExport(live)
        expect(result?.status).toBe('ended')
        expect(stepsSeen.length).toBeGreaterThan(0)
        expect(stepsSeen.every((label) => label === language.rtbStepUnits)).toBe(true)
        expect(taskHostView()?.state).toBe('done')
        expect(taskHostView()?.result?.summary).toEqual([language.exportDownloadStarted])
        expect(taskHostView()?.steps.map((step) => step.label)).toEqual([
            language.exportStepPrepare, language.rtbStepSaveFirst, language.rtbStepUnits, language.rtbStepSide,
            language.backupStepInlays, language.exportStepAssets, language.exportStepWrite,
        ])
        expect(live.calls.normal).not.toHaveBeenCalled()
        expect(alertWait).not.toHaveBeenCalled()

        resetTaskHostForTests()
        const second = rtbDeps({
            backend: await world.open(), env: world.env,
            over: { afterUnitBatch: async () => { expect(taskHostView()?.cancelOffered).toBe(true); requestTaskCancel() } },
        })
        const cancelled = entryDeps({ run: (options) => runRtbExportGuarded(second.deps, { ...options, fileName: 'test.rtb' }) })
        const ended = await startRtbExport(cancelled)
        expect(ended).toMatchObject({ status: 'ended', outcome: { status: 'declined', cause: 'export-cancelled' } })
        expect(taskHostView()?.cancelled).toBe(true)
        expect(alertWait).not.toHaveBeenCalled()
        expect(cancelled.calls.normal).not.toHaveBeenCalled()
        expect(second.writer.closes).toBe(0)
        expect(isBusy()).toBe(false)
    })

    test('the refusal the entry asks first equals the guarded run\'s refusal for each page state', async () => {
        const backend = await world.open()
        const cases: Array<[Parameters<typeof rtbDeps>[0]['over'], RtbExportRefusal]> = [
            [{ pageMode: () => ({ kind: 'read-only', reason: 'backend-unavailable' }) }, 'read-only'],
            [{ session: () => null }, 'no-session'],
        ]
        for (const [over, expected] of cases) {
            const { deps } = rtbDeps({ backend, env: world.env, over })
            expect(await rtbExportRefusal(deps)).toBe(expected)
            expect(await runRtbExportGuarded(deps, { fileName: 'test.rtb' })).toEqual({ status: 'refused', reason: expected })
        }
    })
})
