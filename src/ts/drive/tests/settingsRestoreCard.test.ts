/**
 * Which restores the Settings, Data and Welcome buttons start on the task card (RS1): `restoreFromBinFile` and
 * `restoreFromBinFileAtFirstRun` hand the router the `card` route, and `restoreFromInternalBackup` hands the restore-point
 * loader its `card` option. Real: `settingsRestore.ts`. Faked: the loaders and the confirmation dialog, so this proves the
 * call each button makes, not a restore.
 *
 * Label: regression reproducers. The base calls `loadBackupFromPicker()` and `loadInternalBackup()` with no arguments, so
 * every assertion below fails there.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const confirmMock = vi.hoisted(() => vi.fn(async (_message: string): Promise<boolean> => true))
const pickerLoaderMock = vi.hoisted(() => vi.fn())
const internalLoaderMock = vi.hoisted(() => vi.fn())

vi.mock('../../alert', () => ({
    alertConfirm: confirmMock,
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertStore: { set: vi.fn(), subscribe: () => () => { } },
}))
vi.mock('../../stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { alertStore: writable({ type: 'none', msg: '' }) }
})
vi.mock('../../process/chatOrigin', () => ({ isWorkInProgress: () => false }))
vi.mock('../backupRouter', () => ({ loadBackupFromPicker: pickerLoaderMock }))
vi.mock('../backuplocal', () => ({ LoadLocalBackup: vi.fn() }))
vi.mock('../internalBackup', () => ({ loadInternalBackup: internalLoaderMock }))

import { resetRestoreInProgressForTests } from '../restoreInProgress'
import { restoreFromBinFile, restoreFromBinFileAtFirstRun, restoreFromInternalBackup } from '../settingsRestore'

const end = { operation: 'import', target: null, outcome: 'canceled', cause: null, detail: {} }

beforeEach(() => {
    resetRestoreInProgressForTests()
    confirmMock.mockReset().mockResolvedValue(true)
    pickerLoaderMock.mockReset().mockResolvedValue(end)
    internalLoaderMock.mockReset().mockResolvedValue(end)
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('the restore buttons choose the card route', () => {
    test('restoreFromBinFile asks the router for the card route', async () => {
        await restoreFromBinFile()

        expect(pickerLoaderMock.mock.calls).toEqual([[{}, { card: true }]])
    })

    test('restoreFromInternalBackup asks the restore-point loader for the card', async () => {
        await restoreFromInternalBackup()

        expect(internalLoaderMock.mock.calls).toEqual([[{ card: true }]])
    })

    test('the Welcome restore asks the router for the first-run card route and its picked callback', async () => {
        await restoreFromBinFileAtFirstRun()

        expect(pickerLoaderMock).toHaveBeenCalledTimes(1)
        expect(pickerLoaderMock.mock.calls[0]).toEqual([{}, { firstRun: true, card: true, onPicked: expect.any(Function) }])
    })
})
