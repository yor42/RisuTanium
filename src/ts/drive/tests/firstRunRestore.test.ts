/**
 * The Welcome restore entry (`restoreFromBinFileAtFirstRun`) next to the Settings entry (`restoreFromBinFile`): the
 * first-run entry passes the first-run option to the loader after both confirmations, and the Settings entry passes
 * nothing. Real: `settingsRestore.ts`, `restoreInProgress.ts`, `backupWorkGuard.ts`. Faked: the loaders and the
 * confirmation dialog, so this proves the call shape and the confirmation order, not a picker or a native write.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import type { OperationOutcome } from '../operationEnd'

const confirmMock = vi.hoisted(() => vi.fn(async (_message: string): Promise<boolean> => true))
const localLoaderMock = vi.hoisted(() => vi.fn())

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
vi.mock('../backuplocal', () => ({ LoadLocalBackup: localLoaderMock }))
vi.mock('../internalBackup', () => ({ loadInternalBackup: vi.fn() }))

import { resetRestoreInProgressForTests, restorePhase } from '../restoreInProgress'
import { restoreFromBinFile, restoreFromBinFileAtFirstRun } from '../settingsRestore'

const endOf = (outcome: OperationOutcome) => ({ operation: 'import', target: null, outcome, cause: null, detail: {} })

beforeEach(() => {
    resetRestoreInProgressForTests()
    confirmMock.mockReset().mockResolvedValue(true)
    localLoaderMock.mockReset().mockResolvedValue(endOf('canceled'))
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('the Welcome restore entry', () => {
    test('asks both confirmations, then calls the loader with the first-run option', async () => {
        await restoreFromBinFileAtFirstRun()

        expect(confirmMock.mock.calls.map((call) => call[0])).toEqual([language.backupLoadConfirm, language.backupLoadConfirm2])
        expect(localLoaderMock).toHaveBeenCalledTimes(1)
        expect(localLoaderMock).toHaveBeenCalledWith(undefined, undefined, { completeFirstSetup: true })
        expect(restorePhase()).toBe('none')
    })

    test('a declined confirmation never reaches the loader', async () => {
        confirmMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

        await restoreFromBinFileAtFirstRun()

        expect(localLoaderMock).not.toHaveBeenCalled()
        expect(restorePhase()).toBe('none')
    })

    test('a loader that rejects leaves the page usable', async () => {
        localLoaderMock.mockRejectedValue(new Error('picker threw'))

        await expect(restoreFromBinFileAtFirstRun()).resolves.toBeUndefined()

        expect(restorePhase()).toBe('none')
    })

    test('guard: the Settings entry still calls the loader with no arguments', async () => {
        await restoreFromBinFile()

        expect(localLoaderMock).toHaveBeenCalledTimes(1)
        expect(localLoaderMock.mock.calls[0]).toEqual([])
    })
})
