/**
 * `runResumedExport`: the export a resume note asks for once the reloaded page is ready. The export cases are
 * reproducers: against a skeleton that never exports they fail by assertion. The cases that expect nothing to run are
 * guards: they also pass against that skeleton and fail only under a mutant that drops the matching check.
 *
 * MOCKED: the backup writers (they are asserted, not run), the Android transport probe and the application modules
 * the dependency set imports so the module loads. The page storage mode is real.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    android: { value: true },
    saveLocalBackup: vi.fn(async () => ({ status: 'saved' })),
    exportThisTabBackup: vi.fn(async () => ({ status: 'saved' })),
    savePartialLocalBackup: vi.fn(async () => ({ status: 'saved' })),
}))

vi.mock(import('src/ts/alert'), () => ({}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/alertPrompts'), () => ({}) as unknown as typeof import('src/ts/alertPrompts'))
vi.mock(import('src/ts/stores.svelte'), () => ({}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/storage/store2/saveLoop'), () => ({}) as unknown as typeof import('src/ts/storage/store2/saveLoop'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/process/sessionUse'), () => ({}) as unknown as typeof import('src/ts/process/sessionUse'))
vi.mock(import('src/ts/reloadGuard'), () => ({}) as unknown as typeof import('src/ts/reloadGuard'))
vi.mock(import('src/ts/drive/restoreReload'), () => ({}) as unknown as typeof import('src/ts/drive/restoreReload'))
vi.mock(import('src/ts/storage/tauriByteTransport'), () => ({
    isAndroidTransport: () => mocks.android.value,
}) as unknown as typeof import('src/ts/storage/tauriByteTransport'))
vi.mock(import('src/ts/drive/backuplocal'), () => ({
    SaveLocalBackup: mocks.saveLocalBackup,
    exportThisTabBackup: mocks.exportThisTabBackup,
    SavePartialLocalBackup: mocks.savePartialLocalBackup,
}) as unknown as typeof import('src/ts/drive/backuplocal'))

import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { withBusy } from 'src/ts/process/memory/busyActions'
import { runResumedExport } from '../reloadFirst'

beforeEach(() => {
    vi.clearAllMocks()
    mocks.android.value = true
    setPageStorageMode({ kind: 'store2' })
})

afterEach(() => {
    resetPageStorageModeForTests()
})

describe('runResumedExport', () => {
    test('reproducer: a full note opens the full export once', async () => {
        await runResumedExport('export-full')
        expect(mocks.saveLocalBackup).toHaveBeenCalledTimes(1)
        expect(mocks.exportThisTabBackup).not.toHaveBeenCalled()
    })

    test('reproducer: a partial note opens the partial export without its confirms, once', async () => {
        await runResumedExport('export-partial')
        expect(mocks.exportThisTabBackup).toHaveBeenCalledTimes(1)
        expect(mocks.savePartialLocalBackup).not.toHaveBeenCalled()
        expect(mocks.saveLocalBackup).not.toHaveBeenCalled()
    })

    test('guard: off Android nothing runs', async () => {
        mocks.android.value = false
        await runResumedExport('export-full')
        await runResumedExport('export-partial')
        expect(mocks.saveLocalBackup).not.toHaveBeenCalled()
        expect(mocks.exportThisTabBackup).not.toHaveBeenCalled()
    })

    test('guard: another storage mode, a busy action or no note runs nothing', async () => {
        setPageStorageMode({ kind: 'block' })
        await runResumedExport('export-full')
        setPageStorageMode({ kind: 'store2' })
        await withBusy('backupSave', () => runResumedExport('export-full'))
        await runResumedExport(null)
        expect(mocks.saveLocalBackup).not.toHaveBeenCalled()
        expect(mocks.exportThisTabBackup).not.toHaveBeenCalled()
    })
})
