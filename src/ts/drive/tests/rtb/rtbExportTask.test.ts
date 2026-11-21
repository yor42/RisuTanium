// @vitest-environment node
/**
 * The `.rtb` export on its task card (S6c step 4): the entry builds the card, the real `runRtbExportGuarded`, busy
 * registry, export shell, `exportTask` and `alertTask` run over the real producer's world (`rtbFixtures.ts`). The alert
 * module is mocked, so it says nothing about how a dialog renders; the card is read through `taskHostView()`.
 *
 * Labels: RT1-RT7 and LD1 (true leg) are regression reproducers: on the step-3 tree no card exists on this route and the
 * core calls `saveFirst` without an argument. RT9 (a), (b) and LD1 (false leg) are compatibility guards (they pass before
 * and after); RT9 (c) is carried by its mutant, since its argument is new.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { alertNormal, alertWait } from 'src/ts/alert'
import { alertTask, requestTaskCancel, resetTaskHostForTests, setTaskClockForTests, taskHostView, taskShown } from 'src/ts/alertTask.svelte'
import { resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { buildSmall, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'
import { FakeLocalWriter, rtbDeps, rtbWorld, type RtbWorld } from 'src/ts/storage/tests/store2/rtbFixtures'
import type { ExportableInlay } from 'src/ts/drive/inlayBackupExport'
import { liveRtbExportDeps, runRtbExportGuarded, type RtbExportDeps, type RtbExportProgress, type RtbExportResult } from 'src/ts/drive/rtbExport'
import { rtbSavedNotice, startRtbExport, type RtbEntryDeps } from 'src/ts/drive/rtbExportEntry'
import { saveFirst } from 'src/ts/drive/storeRestore'

const platformBox = vi.hoisted(() => ({ isTauri: false }))
const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

vi.mock('src/ts/platform', () => ({
    get isTauri() { return platformBox.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))
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

const encoder = new TextEncoder()
const HEX_A = 'a1'.repeat(32)
const ASSET_A = `assets/${HEX_A}.png`
const INLAY_APP = '0123abcd-0123-4123-a123-0123456789ab'
const FILES = { [ASSET_A]: encoder.encode('asset-a-bytes') }

function inlayOf(text: string): ExportableInlay {
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
    }
}

function profile(): Obj {
    const db = JSON.parse(JSON.stringify(buildSmall(2))) as Obj
    const character = (db.characters as Obj[])[0]
    character.additionalAssets = [['extra', ASSET_A, 'png']]
    const chat = (character.chats as Obj[])[0]
    ;(chat.message as Obj[]).push({ role: 'char', data: `see {{inlay::${INLAY_APP}}}`, time: 1 })
    return db
}

let world: RtbWorld

beforeAll(async () => {
    world = await rtbWorld({ layout: 1, database: profile() })
})

beforeEach(() => {
    resetBusyActionsForTest()
    resetPageStorageModeForTests()
    resetTaskHostForTests()
    // Each read advances by more than the publish interval, so every report reaches the card at once.
    let tick = 0
    setTaskClockForTests({ now: () => (tick += 1000), setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (timer) => clearTimeout(timer), hidden: () => false })
    platformBox.isTauri = false
    vi.mocked(alertWait).mockClear()
    vi.mocked(alertNormal).mockReset()
    vi.mocked(saveFirst).mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'info').mockImplementation(() => { })
})

afterEach(() => {
    setTaskClockForTests(null)
    resetTaskHostForTests()
    vi.restoreAllMocks()
})

interface Probe {
    /** The step label of the shown card at each progress event, in order; null while no card is shown. */
    labels: Array<string | null>
    /** `stepIndex:done/total` of the shown card's count at each event that has one. */
    counts: string[]
}

/** The entry over the real guarded run; `probe` samples the card at every progress event of the core. */
function entryOver(deps: RtbExportDeps, probe: Probe | null = null, over: Partial<RtbEntryDeps> = {}): RtbEntryDeps & { posted: { normal: ReturnType<typeof vi.fn>, clear: ReturnType<typeof vi.fn>, error: ReturnType<typeof vi.fn> } } {
    const posted = { normal: vi.fn(), clear: vi.fn(), error: vi.fn() }
    const onProgress = (_event: RtbExportProgress): void => {
        if (probe === null) {
            return
        }
        const view = taskHostView()
        probe.labels.push(view === null ? null : view.steps[view.stepIndex]?.label ?? null)
        if (view?.count !== undefined) {
            probe.counts.push(`${view.stepIndex}:${view.count.done}/${view.count.total}`)
        }
    }
    return {
        refusal: async () => null,
        confirm: async () => true,
        run: (options) => runRtbExportGuarded(deps, { ...options, fileName: 'test.rtb', onProgress }),
        error: posted.error,
        normal: posted.normal,
        clear: posted.clear,
        isTauri: platformBox.isTauri,
        posted,
        ...over,
    }
}

async function build(over: Partial<RtbExportDeps> = {}, writer?: FakeLocalWriter) {
    const backend = await world.open()
    return rtbDeps({
        backend, env: world.env, files: FILES, appInlays: { [INLAY_APP]: inlayOf('inlay-app') }, writer,
        over: { assets: { listSized: async () => null, readBatch: async (keys) => keys.map(() => ({ status: 'large' as const })), readerLimits: {}, pieceSource: async () => null }, ...over },
    })
}

function savedReport(result: RtbExportResult | null) {
    if (result === null || result.status !== 'ended' || result.outcome.status !== 'saved' || result.report === null) {
        throw new Error('the run did not save')
    }
    return result.report
}

describe('the .rtb export card (RT1, RT3)', () => {
    test('RT1 the card shows the steps in order, counts inlays and assets, and offers Cancel on the web', async () => {
        const probe: Probe = { labels: [], counts: [] }
        const { deps } = await build()
        const entry = entryOver(deps, probe)
        const result = await startRtbExport(entry)
        savedReport(result)
        const distinct = probe.labels.filter((label, index) => label !== probe.labels[index - 1])
        expect(distinct).toEqual([
            language.exportStepPrepare, language.rtbStepSaveFirst, language.rtbStepUnits, language.rtbStepSide,
            language.backupStepInlays, language.exportStepAssets,
        ])
        expect(probe.counts.some((count) => count.startsWith('4:') && !count.endsWith('/0'))).toBe(true)
        expect(probe.counts.some((count) => count.startsWith('5:') && !count.endsWith('/0'))).toBe(true)
        expect(alertWait).not.toHaveBeenCalled()
    })

    test('RT1 Cancel is offered while the web card runs', async () => {
        let offered: boolean | undefined
        const { deps } = await build({ afterUnitBatch: async () => { offered = taskHostView()?.cancelOffered } })
        await startRtbExport(entryOver(deps))
        expect(offered).toBe(true)
    })

    test('RT3 a clean save ends on the done card with the download text, and posts nothing else', async () => {
        const { deps } = await build()
        const entry = entryOver(deps)
        savedReport(await startRtbExport(entry))
        expect(taskHostView()?.state).toBe('done')
        expect(taskHostView()?.result?.headline).toBe(language.backupTaskDone)
        expect(taskHostView()?.result?.summary).toEqual([language.exportDownloadStarted])
        expect(entry.posted.normal).not.toHaveBeenCalled()
        expect(alertNormal).not.toHaveBeenCalled()
    })

    test('RT3 on Tauri the done card carries the saved-to-location text and no Cancel', async () => {
        platformBox.isTauri = true
        let offered: boolean | undefined
        const { deps } = await build({ afterUnitBatch: async () => { offered = taskHostView()?.cancelOffered } })
        savedReport(await startRtbExport(entryOver(deps)))
        expect(offered).toBe(false)
        expect(taskHostView()?.result?.summary).toEqual([language.rtbExportSaved])
    })
})

describe('the save dialog on the card route (RT2, RT6)', () => {
    test('RT2 no card stands over a pending native dialog, and it returns after a chosen path', async () => {
        platformBox.isTauri = true
        const built = await build()
        let deliver: () => void = () => { }
        const held = new Promise<void>((resolve) => { deliver = resolve })
        let opening = false
        const atSave: Array<{ shown: boolean, label: string | null }> = []
        const deps: RtbExportDeps = {
            ...built.deps,
            openWriter: async (session, fileName) => {
                opening = true
                await held
                return built.deps.openWriter(session, fileName)
            },
            saveFirst: async () => {
                const view = taskHostView()
                atSave.push({ shown: taskShown(), label: view === null ? null : view.steps[view.stepIndex]?.label ?? null })
            },
        }
        const running = startRtbExport(entryOver(deps))
        await vi.waitFor(() => { expect(opening).toBe(true) })
        expect(taskShown()).toBe(false)
        expect(alertWait).not.toHaveBeenCalled()
        deliver()
        savedReport(await running)
        expect(atSave).toEqual([{ shown: true, label: language.rtbStepSaveFirst }])
    })

    test('RT6 a closed dialog ends silently: no card, no notice and no clear of an unrelated notice', async () => {
        platformBox.isTauri = true
        const built = await build({ openWriter: async () => null })
        const entry = entryOver(built.deps)
        const result = await startRtbExport(entry)
        expect(result).toMatchObject({ status: 'ended', outcome: { status: 'declined', cause: 'save-dialog-cancelled' } })
        expect(taskShown()).toBe(false)
        expect(entry.posted.clear).not.toHaveBeenCalled()
        expect(entry.posted.normal).not.toHaveBeenCalled()
        expect(alertNormal).not.toHaveBeenCalled()
    })
})

/** The parts of the side backends the read touches; the cast widens them back to the backend types. */
const unavailableForage: Pick<LocalForage, 'ready'> = { ready: async () => { throw new Error('the store is unavailable') } }
const emptyLocal: Pick<Storage, 'length' | 'key' | 'getItem'> = { length: 0, key: () => null, getItem: () => null }

describe('a save with a report (RT4)', () => {
    /** Runs `over`, sampling whether a card was shown during the run and when the notice posted. */
    async function reportRun(over: Partial<RtbExportDeps>, newerCard = false) {
        let shownDuring = false
        const atNotice: boolean[] = []
        vi.mocked(alertNormal).mockImplementation(() => { atNotice.push(taskShown()) })
        const built = await build({
            ...over,
            afterUnitBatch: async () => {
                shownDuring = taskShown()
                if (newerCard) {
                    alertTask({ title: 'Newer task', steps: [{ label: 'Step' }] })
                }
            },
        })
        const entry = entryOver(built.deps)
        const result = await startRtbExport(entry)
        const report = savedReport(result)
        return { report, shownDuring, atNotice, entry }
    }

    function expectNotice(run: Awaited<ReturnType<typeof reportRun>>): void {
        expect(run.shownDuring).toBe(true)
        expect(alertNormal).toHaveBeenCalledTimes(1)
        expect(alertNormal).toHaveBeenCalledWith(rtbSavedNotice(run.report, false))
        expect(run.entry.posted.normal).not.toHaveBeenCalled()
    }

    test('RT4 (a) unsaved changes excluded: the card closes, then the saved notice posts once', async () => {
        const run = await reportRun({ isSaveClean: () => false })
        expectNotice(run)
        expect(run.report.unsavedExcluded).toBe(true)
        expect(run.atNotice).toEqual([false])
    })

    test('RT4 (b) an omitted asset: the card closes, then the saved notice posts once', async () => {
        const run = await reportRun({
            assets: {
                listSized: async () => [{ key: ASSET_A, size: FILES[ASSET_A].length }],
                readBatch: async (keys) => keys.map(() => ({ status: 'missing' as const })),
                readerLimits: {},
                pieceSource: async () => null,
            },
        })
        expectNotice(run)
        expect(run.report.omitted.some((entry) => entry.kind === 'asset')).toBe(true)
        expect(run.atNotice).toEqual([false])
    })

    test('RT4 (c) a side-only omission, which the outcome does not carry, still ends on the notice', async () => {
        const run = await reportRun({
            sideBackends: {
                forage: () => unavailableForage as LocalForage,
                local: () => emptyLocal as Storage,
            },
        })
        expectNotice(run)
        expect(run.report.omitted.length).toBeGreaterThan(0)
        expect(run.report.omitted.every((entry) => entry.kind === 'side')).toBe(true)
        const notice = vi.mocked(alertNormal).mock.calls[0][0]
        expect(notice).toContain(language.backupDataLeftOut)
        expect(notice).toContain(language.rtbExportSideLeftOut(run.report.omitted.length))
        expect(run.atNotice).toEqual([false])
    })

    test('RT4 (d) a newer task replaced the card: the report notice still posts once and the newer card stays', async () => {
        const run = await reportRun({ isSaveClean: () => false }, true)
        expectNotice(run)
        expect(taskHostView()?.title).toBe('Newer task')
        expect(taskHostView()?.state).toBe('running')
    })
})

describe('endings of a card run (RT5)', () => {
    test('RT5 (a) a Cancel during the assets ends on a cancelled card with the kept-file line', async () => {
        const built = await build()
        const entry = entryOver(built.deps, null, {
            run: (options) => runRtbExportGuarded(built.deps, {
                ...options,
                fileName: 'test.rtb',
                onProgress: (event) => { if (event.phase === 'assets' && event.done === 0) { requestTaskCancel() } },
            }),
        })
        const result = await startRtbExport(entry)
        expect(result).toMatchObject({ status: 'ended', outcome: { status: 'declined', cause: 'export-cancelled' } })
        expect(taskHostView()?.cancelled).toBe(true)
        expect(taskHostView()?.result?.summary).toEqual([language.exportFailedFileIncomplete])
        expect(alertNormal).not.toHaveBeenCalled()
    })

    test('RT5 (b) a failure before the writer exists ends on a fail card that says nothing was written', async () => {
        const built = await build({ openWriter: async () => { throw new Error('the dialog failed') } })
        const entry = entryOver(built.deps)
        const result = await startRtbExport(entry)
        expect(result).toMatchObject({ status: 'ended', outcome: { status: 'failed', file: 'untouched' } })
        expect(taskHostView()?.state).toBe('failed')
        expect(taskHostView()?.failure?.headline).toBe(language.backupTaskFailed)
        expect(taskHostView()?.failure?.detail).toBe(language.backupFailedNothingWritten())
    })

    test('RT5 (c) a write failure after the writer opened ends on a fail card that says the file is kept', async () => {
        const built = await build({}, new FakeLocalWriter({ failWriteNumber: 1 }))
        const result = await startRtbExport(entryOver(built.deps))
        expect(result).toMatchObject({ status: 'ended', outcome: { status: 'failed', file: 'kept' } })
        expect(taskHostView()?.state).toBe('failed')
        expect(taskHostView()?.failure?.detail).toBe(language.backupFailedFileKept(null))
    })

    test('RT5 (d) a Cancel during the quiet save before the walk ends cancelled and the walk never starts', async () => {
        let walked = false
        const built = await build({
            saveFirst: async () => { requestTaskCancel() },
            afterUnitBatch: async () => { walked = true },
        })
        const result = await startRtbExport(entryOver(built.deps))
        expect(result).toMatchObject({ status: 'ended', outcome: { status: 'declined', cause: 'export-cancelled' } })
        expect(walked).toBe(false)
        expect(taskHostView()?.cancelled).toBe(true)
    })
})

describe('the save before the walk is quiet on the card route (RT7, RT9, LD1)', () => {
    test('RT7 the core calls the saveFirst dep once, quiet, with the card at the save step', async () => {
        const atCall: Array<{ quiet: boolean, shown: boolean, label: string | null }> = []
        const saveFirstDep = vi.fn(async (quiet: boolean) => {
            const view = taskHostView()
            atCall.push({ quiet, shown: taskShown(), label: view === null ? null : view.steps[view.stepIndex]?.label ?? null })
        })
        const { deps } = await build({ saveFirst: saveFirstDep })
        savedReport(await startRtbExport(entryOver(deps)))
        expect(saveFirstDep).toHaveBeenCalledTimes(1)
        expect(saveFirstDep).toHaveBeenCalledWith(true)
        expect(atCall).toEqual([{ quiet: true, shown: true, label: language.rtbStepSaveFirst }])
    })

    test('RT9 without a card: no card at any point, no ending posted by the core, no wait without progressText, and the dep is not quiet', async () => {
        const saveFirstDep = vi.fn(async (_quiet: boolean) => { })
        let shownDuring = false
        const { deps } = await build({ saveFirst: saveFirstDep, afterUnitBatch: async () => { shownDuring = taskShown() } })
        const result = await runRtbExportGuarded(deps, { fileName: 'test.rtb' })
        savedReport(result)
        expect(shownDuring).toBe(false)
        expect(taskShown()).toBe(false)
        expect(alertNormal).not.toHaveBeenCalled()
        expect(alertWait).not.toHaveBeenCalled()
        expect(saveFirstDep).toHaveBeenCalledTimes(1)
        expect(saveFirstDep).toHaveBeenCalledWith(false)
    })

    test('LD1 the live dep forwards quiet to the real saveFirst, and nothing for a loud call', async () => {
        const live = liveRtbExportDeps()
        await live.saveFirst(true)
        expect(saveFirst).toHaveBeenCalledTimes(1)
        expect(saveFirst).toHaveBeenCalledWith(10_000, { quiet: true })
        vi.mocked(saveFirst).mockClear()
        await live.saveFirst(false)
        expect(saveFirst).toHaveBeenCalledTimes(1)
        expect(vi.mocked(saveFirst).mock.calls[0][1]?.quiet).not.toBe(true)
    })
})
