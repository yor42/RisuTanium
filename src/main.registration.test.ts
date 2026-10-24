// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * `src/main.ts` registers the store2 boot dispatch before it starts the boot. The test imports the real entry module
 * with everything it mounts or starts replaced, and reads the seam at the moment `loadData` is called: a page whose
 * entry forgot the registration would run the legacy boot only. Labels: new behaviour.
 */

const seen = vi.hoisted(() => ({
    loadDataCalls: 0,
    registeredAtLoadData: [] as boolean[],
    dispatch: vi.fn(async (_env: unknown, _deps: unknown) => ({ kind: 'stopped' as const })),
    ui: { marker: 'the production port' },
    readSeam: null as null | (() => boolean),
    loadBackupAtBoot: vi.fn(async (_target: unknown) => ({ kind: 'cancelled' as const })),
    flushPage: vi.fn(),
    installBackGuard: vi.fn(),
}))

vi.mock('./ts/polyfill', () => ({}))
vi.mock('core-js/actual', () => ({}))
vi.mock('./ts/storage/database.svelte', () => ({}))
vi.mock('./App.svelte', () => ({ default: {} }))
vi.mock('./ts/bootstrap', () => ({
    loadData: () => {
        seen.loadDataCalls += 1
        seen.registeredAtLoadData.push(seen.readSeam === null ? false : seen.readSeam())
    },
}))
vi.mock('./ts/hotkey', () => ({ initHotkey: vi.fn() }))
vi.mock('./preload', () => ({ preLoadCheck: vi.fn() }))
vi.mock('./ts/android/keepAliveService', () => ({ startKeepAliveService: vi.fn() }))
vi.mock('./ts/process/saveOnHide', () => ({ startSaveOnHide: vi.fn(), flushPageBeforeLeaving: seen.flushPage }))
vi.mock('./ts/process/sessionUse', () => ({ startSessionUseTracking: vi.fn() }))
vi.mock('svelte', () => ({ mount: vi.fn(() => ({})) }))
vi.mock('./ts/backHandlers', () => ({ installBackGuard: seen.installBackGuard }))
vi.mock('./ts/alert', () => ({ alertToast: vi.fn() }))
vi.mock('./lang', () => ({ language: { alerts: { pressBackAgainToQuit: 'press back again' } } }))
vi.mock('./ts/storage/store2/bootDispatch', () => ({
    dispatchStore2Boot: seen.dispatch,
}))
vi.mock('./ts/drive/backuplocal', () => ({ loadBackupAtBoot: seen.loadBackupAtBoot }))
vi.mock('./ts/storage/store2/ui/productionBootUi', () => ({
    createProductionBootUi: () => seen.ui,
}))

beforeEach(() => {
    vi.resetModules()
    seen.loadDataCalls = 0
    seen.registeredAtLoadData = []
    seen.dispatch.mockClear()
    seen.installBackGuard.mockClear()
    document.body.innerHTML = '<div id="app"></div><div id="preloading"></div>'
})

async function loadEntry() {
    const active = await import('./ts/storage/store2/bootActive')
    seen.readSeam = () => active.getStore2Boot() !== null
    await import('./main')
    return active
}

describe('new behaviour: the entry module registers the store2 boot', () => {
    test('the seam is set at the moment loadData is called', async () => {
        await loadEntry()
        expect(seen.loadDataCalls).toBe(1)
        expect(seen.registeredAtLoadData).toEqual([true])
    })

    test('the registered function runs the dispatch with the page\'s environment and the production port', async () => {
        const active = await loadEntry()
        const boot = active.getStore2Boot()
        expect(boot).not.toBeNull()
        const env = { store: {}, upstreamMainFile: async () => false, listBackupTimes: async () => [] }
        const result = await boot?.(env as unknown as Parameters<NonNullable<typeof boot>>[0])
        expect(result).toEqual({ kind: 'stopped' })
        expect(seen.dispatch).toHaveBeenCalledTimes(1)
        expect(seen.dispatch).toHaveBeenCalledWith(env, { ui: seen.ui, importBackup: expect.any(Function) })
    })

    test('new behaviour: the dispatch is given the .bin file flow, which loads the backup code only when an import runs and hands it the target', async () => {
        const active = await loadEntry()
        await active.getStore2Boot()?.({} as unknown as Parameters<NonNullable<ReturnType<typeof active.getStore2Boot>>>[0])
        const deps = seen.dispatch.mock.calls[0][1] as { importBackup: (target: unknown) => Promise<unknown> }
        expect(seen.loadBackupAtBoot).not.toHaveBeenCalled()
        const target = { install: vi.fn(), readColdStorageItem: vi.fn() }
        await expect(deps.importBackup(target)).resolves.toEqual({ kind: 'cancelled' })
        expect(seen.loadBackupAtBoot).toHaveBeenCalledWith(target)
    })

    test('the Back guard is installed with the page flush, so the first Back press saves unsaved edits', async () => {
        await loadEntry()
        expect(seen.installBackGuard).toHaveBeenCalledTimes(1)
        expect(seen.installBackGuard).toHaveBeenCalledWith({
            showToast: expect.any(Function),
            flush: seen.flushPage,
        })
    })

    test('guard: nothing is registered before the entry module has run', async () => {
        const active = await import('./ts/storage/store2/bootActive')
        expect(active.getStore2Boot()).toBeNull()
    })
})
