/**
 * The Settings restore flows (`restoreFromBinFile`, `restoreFromInternalBackup`): the run they register spans the
 * confirmations and the whole loader, ends with the loader's outcome, and a rejecting loader ends it `failed`.
 * Real: `settingsRestore.ts`, `restoreInProgress.ts`, `backupWorkGuard.ts`, `busyActions.ts`. Faked: the two loaders and the
 * confirmation dialog. A faked loader proves the flow's contract, not a picker or a native write.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { OperationOutcome } from '../operationEnd'

const confirmMock = vi.hoisted(() => vi.fn(async (_message: string): Promise<boolean> => true))
const localLoaderMock = vi.hoisted(() => vi.fn())
const internalLoaderMock = vi.hoisted(() => vi.fn())

vi.mock('../../alert', () => ({
    alertConfirm: confirmMock,
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertStore: { set: vi.fn(), subscribe: () => () => { } },
}))
vi.mock('../../process/chatOrigin', () => ({ isWorkInProgress: () => false }))
vi.mock('../backuplocal', () => ({ LoadLocalBackup: localLoaderMock }))
vi.mock('../internalBackup', () => ({ loadInternalBackup: internalLoaderMock }))

import { beginBusy } from '../../process/memory/busyActions'
import { onRestoreEndedLive, resetRestoreInProgressForTests, restorePhase } from '../restoreInProgress'
import { restoreFromBinFile, restoreFromInternalBackup } from '../settingsRestore'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const ended = vi.fn()
let stop: () => void = () => { }

function held<T>(): { promise: Promise<T>, resolve: (value: T) => void } {
    let resolve: (value: T) => void = () => { }
    const promise = new Promise<T>((r) => { resolve = r })
    return { promise, resolve }
}

const endOf = (outcome: OperationOutcome) => ({ operation: 'import', target: null, outcome, cause: null, detail: {} })

beforeEach(() => {
    resetRestoreInProgressForTests()
    ended.mockReset()
    stop = onRestoreEndedLive(ended)
    confirmMock.mockReset().mockResolvedValue(true)
    localLoaderMock.mockReset().mockResolvedValue(endOf('canceled'))
    internalLoaderMock.mockReset().mockResolvedValue(endOf('canceled'))
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    stop()
    vi.restoreAllMocks()
})

describe.each([
    ['restoreFromBinFile', restoreFromBinFile, localLoaderMock],
    ['restoreFromInternalBackup', restoreFromInternalBackup, internalLoaderMock],
])('%s', (_name, flow, loader) => {
    test('the run is open from the first confirmation until the loader settles', async () => {
        const first = held<boolean>()
        confirmMock.mockImplementationOnce(() => first.promise)
        const loaderEnd = held<ReturnType<typeof endOf>>()
        loader.mockImplementation(() => loaderEnd.promise)
        const done = flow()
        expect(restorePhase()).toBe('asking')
        first.resolve(true)
        await settle()
        expect(loader).toHaveBeenCalledTimes(1)
        expect(restorePhase()).toBe('asking')
        loaderEnd.resolve(endOf('canceled'))
        await done
        expect(restorePhase()).toBe('none')
        expect(ended).toHaveBeenCalledTimes(1)
    })

    test('a NO on either confirmation ends the run canceled without calling the loader', async () => {
        confirmMock.mockResolvedValueOnce(false)
        await flow()
        expect(restorePhase()).toBe('none')
        confirmMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
        await flow()
        expect(restorePhase()).toBe('none')
        expect(loader).not.toHaveBeenCalled()
        expect(ended).toHaveBeenCalledTimes(2)
    })

    test('a landed restore leaves the page ending and fires nothing', async () => {
        loader.mockResolvedValue(endOf('committed'))
        await flow()
        expect(restorePhase()).toBe('pageEnding')
        expect(ended).not.toHaveBeenCalled()
    })

    test('a rejecting loader ends the run failed: the page is live and the listeners fire (G-throw)', async () => {
        loader.mockRejectedValue(new Error('picker threw'))
        await flow()
        expect(restorePhase()).toBe('none')
        expect(ended).toHaveBeenCalledTimes(1)
    })

    test('guard: with other work busy the flow is refused before any run opens', async () => {
        const busy = beginBusy('import')
        try {
            await flow()
        } finally {
            busy.end()
        }
        expect(confirmMock).not.toHaveBeenCalled()
        expect(loader).not.toHaveBeenCalled()
        expect(restorePhase()).toBe('none')
        expect(ended).not.toHaveBeenCalled()
    })
})
