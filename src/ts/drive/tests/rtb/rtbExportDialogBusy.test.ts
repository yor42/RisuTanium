// @vitest-environment node
/**
 * The `.rtb` export (`runRtbExportGuarded`) while its save dialog is pending on an Android page. The real busy
 * registry and the real export shell run; the writer is the shared fake, whose open waits for the test. A fake
 * writer says nothing about a native dialog: the device rows cover that.
 *
 * Regression reproducer: the export's entry refused a backup Load for as long as the dialog stayed open.
 * Compatibility guards (pass before and after): a desktop dialog keeps refusing; the export's own wait stays on
 * screen, without a cancel, while the dialog is pending.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { get } from 'svelte/store'
import { alertClear, alertWait } from 'src/ts/alert'
import { alertStore } from 'src/ts/stores.svelte'
import { refuseBackupLoadWhileBusy } from 'src/ts/drive/backupWorkGuard'
import { busyKinds, isBusy, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { inFlightKinds } from 'src/ts/process/inFlightWork'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { runRtbExportGuarded, type RtbExportDeps } from 'src/ts/drive/rtbExport'
import { buildSmall, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'
import { rtbDeps, rtbWorld, type RtbWorld } from 'src/ts/storage/tests/store2/rtbFixtures'

const platformBox = vi.hoisted(() => ({ isTauri: true }))
const osBox = vi.hoisted(() => ({ os: 'android' }))

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

vi.mock('src/ts/platform', () => ({
    get isTauri() { return platformBox.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => osBox.os }))
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

let world: RtbWorld

beforeAll(async () => {
    world = await rtbWorld({ layout: 1, database: JSON.parse(JSON.stringify(buildSmall(2))) as Obj })
})

beforeEach(() => {
    resetBusyActionsForTest()
    resetPageStorageModeForTests()
    platformBox.isTauri = true
    osBox.os = 'android'
    vi.mocked(alertWait).mockClear()
    vi.mocked(alertClear).mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'info').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

/** An export whose writer open waits for `deliver`; `atFirstWrite` records the Load guard once the open is delivered. */
async function heldExport(progressText?: (event: { phase: string }) => string) {
    const backend = await world.open()
    const built = rtbDeps({ backend, env: world.env, files: {}, iris: {} })
    let deliver: () => void = () => { }
    const held = new Promise<void>((resolve) => { deliver = resolve })
    let opening = false
    const atFirstWrite: { refused: boolean, kinds: string[] }[] = []
    const deps: RtbExportDeps = {
        ...built.deps,
        openWriter: async (session, fileName) => {
            opening = true
            await held
            return built.deps.openWriter(session, fileName)
        },
        saveFirst: async () => {
            atFirstWrite.push({ refused: refuseBackupLoadWhileBusy(), kinds: busyKinds() })
        },
    }
    const exporting = runRtbExportGuarded(deps, { fileName: 'test.rtb', ...(progressText ? { progressText } : {}) })
    await vi.waitFor(() => { expect(opening).toBe(true) })
    return { exporting, deliver, atFirstWrite }
}

describe('a .rtb export waiting on the save dialog', () => {
    // Regression reproducer (R4).
    test('a pending Android save dialog does not refuse a backup Load; the first write does', async () => {
        const { exporting, deliver, atFirstWrite } = await heldExport()

        expect(refuseBackupLoadWhileBusy()).toBe(false)
        expect(isBusy()).toBe(true)
        expect(busyKinds()).toContain('backupSave')
        expect(inFlightKinds()).toContain('busy')

        deliver()
        const result = await exporting

        expect(result).toMatchObject({ status: 'ended', outcome: { status: 'saved' } })
        expect(atFirstWrite).toEqual([{ refused: true, kinds: ['backupSave'] }])
        expect(isBusy()).toBe(false)
        expect(inFlightKinds()).not.toContain('busy')
    })

    // Compatibility guard (G5): a desktop dialog is modal and keeps refusing a Load.
    test('a desktop save dialog keeps refusing a backup Load while it is pending', async () => {
        osBox.os = 'windows'
        const { exporting, deliver } = await heldExport()

        expect(refuseBackupLoadWhileBusy()).toBe(true)

        deliver()
        expect((await exporting).status).toBe('ended')
    })

    // Compatibility guard (G16 b): the export's own wait stays on screen, without a cancel, while the dialog is pending.
    test('the alert store still holds the export\'s own wait, without a cancel, while the dialog is pending', async () => {
        vi.mocked(alertWait).mockImplementation((msg: string, onCancel?: () => void) => {
            const posted = { type: 'wait' as const, msg, ...(onCancel ? { onCancel } : {}) }
            alertStore.set(posted as never)
            return posted as never
        })
        vi.mocked(alertClear).mockImplementation(() => { alertStore.set({ type: 'none', msg: '' } as never) })
        try {
            const { exporting, deliver } = await heldExport((event) => `rtb ${event.phase}`)

            const last = vi.mocked(alertWait).mock.results.at(-1)?.value
            expect(vi.mocked(alertWait).mock.calls.at(-1)).toHaveLength(1)
            expect(get(alertStore)).toBe(last)
            expect(get(alertStore)).not.toHaveProperty('onCancel')
            expect(alertClear).not.toHaveBeenCalled()

            deliver()
            await exporting
        } finally {
            vi.mocked(alertWait).mockReset()
            vi.mocked(alertClear).mockReset()
            alertStore.set({ type: 'none', msg: '' } as never)
        }
    })
})
