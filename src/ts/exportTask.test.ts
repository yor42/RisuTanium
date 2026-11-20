// @vitest-environment jsdom

/**
 * The export task adapter (`createExportTask`): one adapter per export run that ends the run in every state. The real
 * `alertTask` slot, `exportCancel` token and `exportWriters` helpers run; only the alert module (spied) and the stores
 * it reads are replaced. A card that was never opened ends as the legacy notice did, a card that a newer task replaced
 * stays silent unless a kept incomplete file needs its warning, and a shown card settles.
 *
 * Labels: every test here is RR-m (a new module): its red evidence comes from the scratch mutants of the S6a plan.
 */
import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { writable } from 'svelte/store'
import { language } from 'src/lang'

const spies = vi.hoisted(() => ({
    alertError: vi.fn(),
    alertNormal: vi.fn(),
}))

vi.mock('src/ts/alert', () => ({
    alertClear: vi.fn(),
    alertWait: vi.fn(),
    alertError: spies.alertError,
    alertNormal: spies.alertNormal,
    alertNormalWait: vi.fn(async () => { }),
}))

vi.mock('src/ts/stores.svelte', () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}))

vi.mock('src/ts/platform', () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}))

vi.mock('src/ts/vendor/streamSaver', () => ({ default: { useBlobFallback: false, mitm: '', createWriteStream: undefined } }))

import { createExportTask, EXPORT_STEPS, type ExportTarget } from 'src/ts/exportTask'
import { ExportCancelledError, ExportCancelToken } from 'src/ts/exportCancel'
import { BlobDownloadWriter, exportErrorText, withFileIncompleteSentence, type ExportByteWriter } from 'src/ts/exportWriters'
import {
    alertTask,
    requestTaskCancel,
    resetTaskHostForTests,
    setTaskClockForTests,
    taskHostView,
    taskResultShowing,
    taskShown,
} from 'src/ts/alertTask.svelte'

const DEF = { title: 'Exporting', subtitle: 'Synthetic' }

/** A clock that advances one second per read, so every report reaches the published view at once. */
function useSteppingClock(): void {
    let tick = 0
    setTaskClockForTests({ now: () => (tick += 1000), setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (timer) => clearTimeout(timer), hidden: () => false })
}

function replaceWithNewerTask(): void {
    alertTask({ title: 'Newer task', steps: [{ label: 'Step' }] })
}

/** An `ExportTarget` whose abort is a spy. */
interface SpyTarget extends ExportTarget {
    abort: Mock<(reason: unknown) => void>
}

/** A target whose file a failed export has to report as kept: a stream that may already have handed bytes on. */
function keptTarget(): SpyTarget {
    const writer: ExportByteWriter = { heldInMemory: false, write: async () => { }, close: async () => { } }
    return { writer, abort: vi.fn<(reason: unknown) => void>() }
}

/** A target with nothing on disk: a Blob writer holds every byte in memory until it is closed. */
function untouchedTarget(): SpyTarget {
    return { writer: new BlobDownloadWriter('synthetic.png'), abort: vi.fn<(reason: unknown) => void>() }
}

beforeEach(() => {
    resetTaskHostForTests()
    spies.alertError.mockClear()
    spies.alertNormal.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    return () => {
        resetTaskHostForTests()
        vi.restoreAllMocks()
    }
})

describe('a shown card', () => {
    test('E1: with a token the card offers Cancel and pressing it cancels the token', () => {
        const task = createExportTask(DEF)
        const token = new ExportCancelToken()
        task.useToken(token)
        task.open()

        expect(taskHostView()?.cancelOffered).toBe(true)
        expect(taskHostView()?.title).toBe('Exporting')
        requestTaskCancel()
        expect(token.cancelled).toBe(true)
    })

    test('E2: without a token the card offers no Cancel and shows no lock reason of its own', () => {
        const task = createExportTask(DEF)
        task.useToken(null)
        task.open()

        expect(taskHostView()?.cancelOffered).toBe(false)
        expect(taskHostView()?.lockReason).toBeUndefined()
    })

    test('E3: cancelled with a kept file shows the incomplete-file line', () => {
        const task = createExportTask(DEF)
        task.useToken(new ExportCancelToken())
        task.open()
        task.cancelled(true)

        expect(taskHostView()?.cancelled).toBe(true)
        expect(taskHostView()?.result?.summary).toEqual([language.exportFailedFileIncomplete])
    })

    test('E4: cancelled with no file kept shows no summary line', () => {
        const task = createExportTask(DEF)
        task.useToken(new ExportCancelToken())
        task.open()
        task.cancelled(false)

        expect(taskHostView()?.cancelled).toBe(true)
        expect(taskHostView()?.result?.summary).toBeUndefined()
    })

    test('E5: a failure with a kept file shows one detail with the incomplete-file sentence and logs the error', () => {
        const task = createExportTask(DEF)
        task.open()
        const error = new Error('disk')
        task.failed(error, true)

        const view = taskHostView()
        expect(view?.state).toBe('failed')
        expect(view?.failure?.headline).toBe(language.exportTaskFailed)
        expect(view?.failure?.dataState).toBe('same')
        expect(view?.failure?.detail).toBe(withFileIncompleteSentence(error).message)
        expect(console.error).toHaveBeenCalledTimes(1)
        expect(console.error).toHaveBeenCalledWith(error)
    })

    test('E5b: the failure text follows the alert rules and every original value is logged', () => {
        const cases: Array<[unknown, string | undefined]> = [
            [{ code: 7 }, '{"code":7}'],
            ['  plain  ', 'plain'],
            [{}, undefined],
        ]
        for (const [value, expected] of cases) {
            resetTaskHostForTests()
            const task = createExportTask(DEF)
            task.open()
            task.failed(value, false)

            expect(taskHostView()?.state).toBe('failed')
            expect(taskHostView()?.failure?.detail).toBe(expected)
            expect(console.error).toHaveBeenCalledWith(value)
        }
        const cyclic: Record<string, unknown> = {}
        cyclic.self = cyclic
        expect(exportErrorText(new Error('  spaced  '))).toBe('spaced')
        expect(exportErrorText('text')).toBe('text')
        expect(exportErrorText({ a: 1 })).toBe('{"a":1}')
        expect(exportErrorText(cyclic)).toBe('[object Object]')
    })

    test('E6: done shows the success headline and the summary line', () => {
        const task = createExportTask(DEF)
        task.open()
        task.done('Saved it')

        expect(taskHostView()?.cancelled).toBe(false)
        expect(taskHostView()?.result?.headline).toBe(language.exportTaskDone)
        expect(taskHostView()?.result?.summary).toEqual(['Saved it'])
    })

    test('E7: close removes the card at once', () => {
        const task = createExportTask(DEF)
        task.open()
        task.close()

        expect(taskShown()).toBe(false)
        expect(taskResultShowing()).toBe(false)
    })

    test('E8: step, count and bytes reach the card only once it is open, and steps never move back', () => {
        useSteppingClock()
        const task = createExportTask(DEF)
        task.step('assets')
        task.count(1, 3)
        task.bytes(1, 2)
        expect(taskHostView()).toBeNull()

        task.open()
        task.step('assets')
        task.count(2, 3)
        expect(taskHostView()?.stepIndex).toBe(EXPORT_STEPS.indexOf('assets'))
        expect(taskHostView()?.count).toEqual({ done: 2, total: 3 })
        task.bytes(5, 10)
        expect(taskHostView()?.bytes).toEqual({ done: 5, total: 10 })
        task.step('prepare')
        expect(taskHostView()?.stepIndex).toBe(EXPORT_STEPS.indexOf('assets'))
        task.step('write')
        expect(taskHostView()?.stepIndex).toBe(EXPORT_STEPS.indexOf('write'))
    })

    test('E9: a late Cancel loses: done after a cancel request shows the true result', () => {
        const task = createExportTask(DEF)
        task.useToken(new ExportCancelToken())
        task.open()
        requestTaskCancel()
        task.done('Saved it')

        expect(taskHostView()?.cancelled).toBe(false)
        expect(taskHostView()?.state).toBe('done')
        expect(taskHostView()?.result?.summary).toEqual(['Saved it'])
    })

    test('E10: throwIfCancelled throws after a cancel and is a no-op without a token or before one is set', () => {
        const task = createExportTask(DEF)
        expect(() => task.throwIfCancelled()).not.toThrow()
        const token = new ExportCancelToken()
        task.useToken(token)
        expect(() => task.throwIfCancelled()).not.toThrow()
        token.cancel()
        expect(() => task.throwIfCancelled()).toThrow(ExportCancelledError)

        const without = createExportTask(DEF)
        without.useToken(null)
        expect(() => without.throwIfCancelled()).not.toThrow()
    })
})

describe('a card that a newer task replaced', () => {
    test('E11: done and a cancel without a kept file leave the newer card alone and post nothing', () => {
        const token = new ExportCancelToken()
        const first = createExportTask(DEF)
        first.useToken(token)
        first.open()
        replaceWithNewerTask()
        const before = taskHostView()
        first.done('Saved it')
        const second = createExportTask(DEF)
        second.useToken(token)
        second.open()
        replaceWithNewerTask()
        second.cancelled(false)

        expect(taskHostView()?.title).toBe(before?.title)
        expect(spies.alertError).not.toHaveBeenCalled()
        expect(spies.alertNormal).not.toHaveBeenCalled()
        expect(token.cancelled).toBe(false)
    })

    test('E11b: a failure with a kept file posts the legacy error with the sentence', () => {
        const task = createExportTask(DEF)
        task.open()
        replaceWithNewerTask()
        const error = new Error('disk')
        task.failed(error, true)

        expect(spies.alertError).toHaveBeenCalledTimes(1)
        const posted = spies.alertError.mock.calls[0][0] as Error
        expect(posted).toBeInstanceOf(Error)
        expect(posted.message).toBe(withFileIncompleteSentence(error).message)
        expect(taskHostView()?.title).toBe('Newer task')
    })

    test('E11c: a failure without a kept file is only logged', () => {
        const task = createExportTask(DEF)
        task.open()
        replaceWithNewerTask()
        const error = new Error('disk')
        task.failed(error, false)

        expect(spies.alertError).not.toHaveBeenCalled()
        expect(spies.alertNormal).not.toHaveBeenCalled()
        expect(console.error).toHaveBeenCalledWith(error)
    })

    test('E11d: a cancel with a kept file posts the legacy incomplete-file notice once', () => {
        const task = createExportTask(DEF)
        task.useToken(new ExportCancelToken())
        task.open()
        replaceWithNewerTask()
        task.cancelled(true)

        expect(spies.alertNormal).toHaveBeenCalledTimes(1)
        expect(spies.alertNormal).toHaveBeenCalledWith(language.exportCancelledFileIncomplete)
    })
})

describe('the first ending wins', () => {
    test('E12: after done, no later ending, classification or close touches the shown result', () => {
        const task = createExportTask(DEF)
        task.useToken(new ExportCancelToken())
        task.open()
        task.done('Saved it')
        const target = keptTarget()
        task.failed(new Error('late'), true)
        task.endOnError(new Error('late'), target)
        task.close()

        expect(task.ended).toBe(true)
        expect(taskResultShowing()).toBe(true)
        expect(taskHostView()?.result?.summary).toEqual(['Saved it'])
        expect(target.abort).not.toHaveBeenCalled()
    })
})

describe('endOnError', () => {
    test('E13 (a): a cancelled token is a cancel, whatever the error, and nothing aborts or logs', () => {
        const token = new ExportCancelToken()
        const task = createExportTask(DEF)
        task.useToken(token)
        task.open()
        token.cancel()
        const target = keptTarget()
        task.endOnError(new Error('stream aborted'), target)

        expect(taskHostView()?.cancelled).toBe(true)
        expect(taskHostView()?.result?.summary).toEqual([language.exportFailedFileIncomplete])
        expect(target.abort).not.toHaveBeenCalled()
        expect(console.error).not.toHaveBeenCalled()
    })

    test('E13 (b): an ExportCancelledError is a cancel even before the token reads as cancelled', () => {
        const task = createExportTask(DEF)
        task.useToken(new ExportCancelToken())
        task.open()
        const target = untouchedTarget()
        task.endOnError(new ExportCancelledError(), target)

        expect(taskHostView()?.cancelled).toBe(true)
        expect(taskHostView()?.result?.summary).toBeUndefined()
        expect(target.abort).not.toHaveBeenCalled()
    })

    test('E13 (c): without a token an ExportCancelledError is a failure and the writer aborts', () => {
        const task = createExportTask(DEF)
        task.useToken(null)
        task.open()
        const target = untouchedTarget()
        task.endOnError(new ExportCancelledError(), target)

        expect(taskHostView()?.state).toBe('failed')
        expect(taskHostView()?.failure?.detail).toBe('The export was cancelled')
        expect(target.abort).toHaveBeenCalledTimes(1)
    })

    test('E13 (d): a failure aborts the writer first, then reads the file state for the detail', () => {
        const kept = createExportTask(DEF)
        kept.useToken(new ExportCancelToken())
        kept.open()
        const error = new Error('disk')
        const keptWriter = keptTarget()
        kept.endOnError(error, keptWriter)

        expect(keptWriter.abort).toHaveBeenCalledTimes(1)
        expect(keptWriter.abort).toHaveBeenCalledWith(error)
        expect(taskHostView()?.failure?.detail).toBe(withFileIncompleteSentence(error).message)

        resetTaskHostForTests()
        const untouched = createExportTask(DEF)
        untouched.useToken(new ExportCancelToken())
        untouched.open()
        const untouchedWriter = untouchedTarget()
        untouched.endOnError(error, untouchedWriter)

        expect(untouchedWriter.abort).toHaveBeenCalledTimes(1)
        expect(taskHostView()?.failure?.detail).toBe('disk')
    })
})

describe('a run that never opened a card ends as the legacy notice did', () => {
    test('E14: every ending posts the legacy call and shows no card', () => {
        const error = new Error('disk')
        for (const make of [() => createExportTask(DEF), () => { const legacy = createExportTask(null); legacy.open(); return legacy }]) {
            spies.alertError.mockClear()
            spies.alertNormal.mockClear()

            make().failed(error, false)
            expect(spies.alertError).toHaveBeenCalledTimes(1)
            expect(spies.alertError.mock.calls[0][0]).toBe(error)

            make().failed({ code: 7 }, false)
            expect(spies.alertError).toHaveBeenLastCalledWith('{"code":7}')

            spies.alertError.mockClear()
            make().failed(error, true)
            expect(spies.alertError).toHaveBeenCalledTimes(1)
            const posted = spies.alertError.mock.calls[0][0] as Error
            expect(posted).toBeInstanceOf(Error)
            expect(posted.message).toBe(withFileIncompleteSentence(error).message)

            make().cancelled(true)
            expect(spies.alertNormal).toHaveBeenCalledTimes(1)
            expect(spies.alertNormal).toHaveBeenCalledWith(language.exportCancelledFileIncomplete)
            make().cancelled(false)
            expect(spies.alertNormal).toHaveBeenCalledTimes(1)

            spies.alertNormal.mockClear()
            make().done('Saved it')
            expect(spies.alertNormal).toHaveBeenCalledTimes(1)
            expect(spies.alertNormal).toHaveBeenCalledWith('Saved it')

            spies.alertNormal.mockClear()
            spies.alertError.mockClear()
            make().close()
            expect(spies.alertNormal).not.toHaveBeenCalled()
            expect(spies.alertError).not.toHaveBeenCalled()

            expect(taskShown()).toBe(false)
            expect(console.error).not.toHaveBeenCalled()
        }
    })

    test('E15: open is idempotent and does nothing after an ending', () => {
        const twice = createExportTask(DEF)
        twice.open()
        const id = taskHostView()?.id
        twice.open()
        expect(taskHostView()?.id).toBe(id)
        twice.close()

        const failed = createExportTask(DEF)
        failed.failed(new Error('disk'), false)
        failed.open()
        expect(taskShown()).toBe(false)

        const closed = createExportTask(DEF)
        closed.close()
        closed.open()
        expect(taskShown()).toBe(false)
    })
})
