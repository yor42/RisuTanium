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
    cardsOpened: vi.fn(),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    waitUnreadNotice: vi.fn(async () => { }),
}))

vi.mock('src/ts/alert', () => ({
    alertClear: vi.fn(),
    alertWait: vi.fn(),
    alertError: spies.alertError,
    alertNormal: spies.alertNormal,
    waitUnreadNotice: spies.waitUnreadNotice,
    alertNormalWait: vi.fn(async () => { }),
}))

vi.mock('src/ts/alertTask.svelte', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/alertTask.svelte')>()
    return { ...actual, alertTask: (def: Parameters<typeof actual.alertTask>[0]) => (spies.cardsOpened(), actual.alertTask(def)) }
})

vi.mock('src/ts/stores.svelte', () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}))

vi.mock('src/ts/platform', () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}))

vi.mock('src/ts/vendor/streamSaver', () => ({ default: { useBlobFallback: false, mitm: '', createWriteStream: undefined } }))

import { createExportTask, EXPORT_STEPS, pickerAside, type ExportTarget, type ExportTask, type ExportTaskDef, type ExportTaskStepDef } from 'src/ts/exportTask'
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

type ChatStep = 'messages' | 'write'
const CHAT_STEPS: readonly ExportTaskStepDef<ChatStep>[] = [
    { id: 'messages', label: 'Prepare messages', noun: 'Messages' },
    { id: 'write', label: 'Write file', mark: 'transfer_out' },
]
const CHAT_DEF = { title: 'Exporting chat', subtitle: 'Synthetic', steps: CHAT_STEPS }

function deferred() {
    let resolve: () => void = () => { }
    const promise = new Promise<void>((done) => { resolve = done })
    return { promise, resolve }
}

describe('a def with its own steps and headlines', () => {
    test('E16: the card shows the def\'s labels, nouns and marks', () => {
        const task = createExportTask(CHAT_DEF)
        task.useToken(null)
        task.open()

        const steps = taskHostView()?.steps
        expect(steps?.map((step) => step.label)).toEqual(['Prepare messages', 'Write file'])
        expect(steps?.[0].noun).toBe('Messages')
        expect(steps?.[1].mark).toBe('transfer_out')
    })

    test('E17: step moves to the def\'s index and never back', () => {
        useSteppingClock()
        const task = createExportTask(CHAT_DEF)
        task.useToken(null)
        task.open()
        task.step('write')
        expect(taskHostView()?.stepIndex).toBe(1)
        task.step('messages')
        expect(taskHostView()?.stepIndex).toBe(1)
    })

    test('E18: doneHeadline and failedHeadline replace the headlines; the idle and replaced columns are unchanged', () => {
        const def = { ...CHAT_DEF, doneHeadline: 'Copied it', failedHeadline: 'Could not copy' }
        const done = createExportTask(def)
        done.open()
        done.done('S')
        expect(taskHostView()?.result?.headline).toBe('Copied it')

        resetTaskHostForTests()
        const failed = createExportTask(def)
        failed.open()
        failed.failed(new Error('disk'), false)
        expect(taskHostView()?.failure?.headline).toBe('Could not copy')
        expect(taskHostView()?.failure?.detail).toBe('disk')

        resetTaskHostForTests()
        spies.alertError.mockClear()
        spies.alertNormal.mockClear()
        createExportTask(def).done('Idle')
        expect(spies.alertNormal).toHaveBeenCalledWith('Idle')
        const replaced = createExportTask(def)
        replaced.open()
        replaceWithNewerTask()
        replaced.failed(new Error('late'), false)
        expect(spies.alertError).not.toHaveBeenCalled()
    })

    test('E19: omitted options keep the export labels, ids and headlines (compatibility guard: passes before and after)', () => {
        const task = createExportTask(DEF)
        task.open()
        expect(taskHostView()?.steps.map((step) => step.label)).toEqual([language.exportStepPrepare, language.exportStepAssets, language.exportStepWrite])
        task.done('S')
        expect(taskHostView()?.result?.headline).toBe(language.exportTaskDone)

        resetTaskHostForTests()
        const failed = createExportTask(DEF)
        failed.open()
        failed.failed(new Error('disk'), false)
        expect(taskHostView()?.failure?.headline).toBe(language.exportTaskFailed)
    })
})

describe('stepAside', () => {
    test('E20: a shown card steps aside at once without ending the run, and done then posts the legacy notice', () => {
        const task = createExportTask(DEF)
        task.open()
        task.stepAside()

        expect(taskHostView()).toBeNull()
        expect(taskShown()).toBe(false)
        expect(task.ended).toBe(false)
        task.done('S')
        expect(spies.alertNormal).toHaveBeenCalledTimes(1)
        expect(spies.alertNormal).toHaveBeenCalledWith('S')
        expect(taskHostView()).toBeNull()
    })

    test('E21: after a step-aside, failed, endOnError and close end as the legacy calls', () => {
        const error = new Error('disk')
        const failed = createExportTask(DEF)
        failed.open()
        failed.stepAside()
        failed.failed(error, false)
        expect(spies.alertError).toHaveBeenCalledTimes(1)
        expect(spies.alertError.mock.calls[0][0]).toBe(error)

        spies.alertError.mockClear()
        const ended = createExportTask(DEF)
        ended.useToken(null)
        ended.open()
        ended.stepAside()
        ended.endOnError(error, undefined)
        expect(spies.alertError).toHaveBeenCalledTimes(1)

        spies.alertError.mockClear()
        const closed = createExportTask(DEF)
        closed.open()
        closed.stepAside()
        closed.close()
        expect(spies.alertError).not.toHaveBeenCalled()
        expect(spies.alertNormal).not.toHaveBeenCalled()
    })

    test('E22: after a step-aside open, step and count show no card, and a second stepAside does nothing', () => {
        useSteppingClock()
        const task = createExportTask(CHAT_DEF)
        task.open()
        task.stepAside()
        task.open()
        task.step('write')
        task.count(1, 2)

        expect(taskHostView()).toBeNull()
        expect(taskShown()).toBe(false)
        task.stepAside()
        expect(taskHostView()).toBeNull()
        expect(task.ended).toBe(false)
    })

    test.each([false, true])('E23: a card a newer task replaced stays silent through stepAside and every ending (legacyErrorText %s)', (withText) => {
        const def = withText ? { ...DEF, legacyErrorText: 'L' } : DEF
        const error = new Error('disk')
        const runs = [
            (task: ReturnType<typeof createExportTask>) => task.done('S'),
            (task: ReturnType<typeof createExportTask>) => task.failed(error, false),
            (task: ReturnType<typeof createExportTask>) => { task.useToken(null); task.endOnError(error, undefined) },
        ]
        for (const run of runs) {
            resetTaskHostForTests()
            vi.mocked(console.error).mockClear()
            spies.alertError.mockClear()
            spies.alertNormal.mockClear()
            const task = createExportTask(def)
            task.open()
            replaceWithNewerTask()
            const before = taskHostView()
            task.stepAside()
            expect(taskHostView()).toEqual(before)
            expect(taskShown()).toBe(true)
            run(task)

            expect(spies.alertNormal).not.toHaveBeenCalled()
            expect(spies.alertError).not.toHaveBeenCalled()
            expect(taskHostView()?.title).toBe('Newer task')
        }
        expect(console.error).toHaveBeenCalledWith(error)
    })

    test('E24: a run that never opened a card is unaffected by stepAside (compatibility guard: passes before and after)', () => {
        const task = createExportTask(DEF)
        try { task.stepAside() } catch { /* the base has no stepAside; the guard is about the endings */ }
        const error = new Error('disk')
        task.failed(error, false)
        expect(spies.alertError).toHaveBeenCalledTimes(1)
        expect(spies.alertError.mock.calls[0][0]).toBe(error)
        expect(taskShown()).toBe(false)
    })

    test('E27: only a card taken down counts as a step-aside: never opened, stepAside, then open shows the card', () => {
        const task = createExportTask(DEF)
        task.stepAside()
        task.open()
        expect(taskShown()).toBe(true)
        task.done('S')

        expect(taskHostView()?.result?.headline).toBe(language.exportTaskDone)
        expect(spies.alertNormal).not.toHaveBeenCalled()
    })

    test('E28: a step-aside is final: a newer task card after it does not silence the legacy ending', () => {
        const done = createExportTask(DEF)
        done.open()
        done.stepAside()
        const newer = alertTask({ title: 'Newer task', steps: [{ label: 'Step' }] })
        const before = taskHostView()
        done.done('S')
        expect(spies.alertNormal).toHaveBeenCalledTimes(1)
        expect(spies.alertNormal).toHaveBeenCalledWith('S')
        expect(newer.detached).toBe(false)
        expect(taskHostView()).toEqual(before)

        resetTaskHostForTests()
        spies.alertError.mockClear()
        const error = new Error('disk')
        const failed = createExportTask(DEF)
        failed.open()
        failed.stepAside()
        alertTask({ title: 'Newer task', steps: [{ label: 'Step' }] })
        failed.failed(error, false)
        expect(spies.alertError).toHaveBeenCalledTimes(1)
        expect(spies.alertError.mock.calls[0][0]).toBe(error)
    })
})

describe('pickerAside', () => {
    test('E25: the card steps aside before the unread-notice wait, the picker waits for it, and the value passes through', async () => {
        const gate = deferred()
        const seen: string[] = []
        spies.waitUnreadNotice.mockImplementation(async () => {
            seen.push(taskShown() ? 'wait-with-card' : 'wait-without-card')
            await gate.promise
        })
        const task = createExportTask(DEF)
        task.open()
        const open = vi.fn(async () => 7)
        const run = pickerAside(task)(open)
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(seen).toEqual(['wait-without-card'])
        expect(open).not.toHaveBeenCalled()
        gate.resolve()
        expect(await run).toBe(7)
        expect(open).toHaveBeenCalledTimes(1)
        spies.waitUnreadNotice.mockImplementation(async () => { })
    })
})

describe('legacyErrorText', () => {
    const error = new Error('disk')

    test('E26 (a): a stepped-aside run posts the text, not the error, and logs the error', () => {
        const task = createExportTask({ ...DEF, legacyErrorText: 'L' })
        task.open()
        task.stepAside()
        task.failed(error, false)

        expect(console.error).toHaveBeenCalledWith(error)
        expect(spies.alertError).toHaveBeenCalledTimes(1)
        expect(spies.alertError).toHaveBeenCalledWith('L')
    })

    test('E26 (b): a shown card keeps the headline and the error text as detail and posts no alert', () => {
        const task = createExportTask({ ...DEF, failedHeadline: 'Screenshot failed', legacyErrorText: 'L' })
        task.open()
        task.failed(error, false)

        expect(taskHostView()?.failure?.headline).toBe('Screenshot failed')
        expect(taskHostView()?.failure?.detail).toBe('disk')
        expect(spies.alertError).not.toHaveBeenCalled()
    })

    test('E26 (c): a run that never showed a card posts the text once', () => {
        createExportTask({ ...DEF, legacyErrorText: 'L' }).failed(error, false)

        expect(spies.alertError).toHaveBeenCalledTimes(1)
        expect(spies.alertError).toHaveBeenCalledWith('L')
    })

    test('E26 (d): after a step-aside a kept incomplete file still posts the incomplete-file sentence', () => {
        const task = createExportTask({ ...DEF, legacyErrorText: 'L' })
        task.open()
        task.stepAside()
        task.failed(error, true)

        expect(spies.alertError).toHaveBeenCalledTimes(1)
        const posted = spies.alertError.mock.calls[0][0] as Error
        expect(posted).toBeInstanceOf(Error)
        expect(posted.message).toBe(withFileIncompleteSentence(error).message)
    })
})

describe('holdAside and the card that comes back', () => {
    const STEPS = [
        { id: 'collect', label: 'Collect' },
        { id: 'assets', label: 'Assets', noun: 'assets' },
        { id: 'database', label: 'Database' },
    ] as const satisfies readonly ExportTaskStepDef<string>[]
    type StepId = (typeof STEPS)[number]['id']
    const STEPPED = { ...DEF, steps: STEPS }

    /** A run with Cancel, its card shown at `assets` and then held aside; the clock steps so every report is published. */
    async function heldAtAssets(def: ExportTaskDef<StepId> & { readonly steps: readonly ExportTaskStepDef<StepId>[] } = STEPPED) {
        useSteppingClock()
        const task = createExportTask<StepId>(def)
        const token = new ExportCancelToken()
        task.useToken(token)
        task.open()
        task.step('assets')
        await task.holdAside(async () => undefined)
        return { task, token }
    }

    test('E29: a held card is out of the slot during and after ask, and the next report brings it back at its step', async () => {
        useSteppingClock()
        const task = createExportTask<StepId>(STEPPED)
        task.useToken(new ExportCancelToken())
        task.open()
        task.step('assets')
        const inside: Array<{ shown: boolean, view: ReturnType<typeof taskHostView> }> = []
        const result = await task.holdAside(async () => {
            inside.push({ shown: taskShown(), view: taskHostView() })
            return 7
        })

        expect(result).toBe(7)
        expect(inside).toEqual([{ shown: false, view: null }])
        expect(taskShown()).toBe(false)
        task.count(1, 3)
        const view = taskHostView()
        expect(view?.title).toBe('Exporting')
        expect(view?.cancelOffered).toBe(true)
        expect(view?.stepIndex).toBe(1)
        expect(view?.count).toEqual({ done: 1, total: 3 })
    })

    test('E30: two holds in a row open no card between them', async () => {
        const { task } = await heldAtAssets()
        const seen: boolean[] = []
        await task.holdAside(async () => {
            seen.push(taskShown())
        })

        expect(seen).toEqual([false])
        expect(taskShown()).toBe(false)
    })

    test('E31: step after a hold reopens at the new step; count after a hold reopens at the held step', async () => {
        const first = await heldAtAssets()
        first.task.step('database')
        expect(taskHostView()?.stepIndex).toBe(2)

        resetTaskHostForTests()
        const second = await heldAtAssets()
        second.task.count(1, 2)
        expect(taskHostView()?.stepIndex).toBe(1)
    })

    test('E32: every ending after a hold lands on the returned card', async () => {
        const failed = await heldAtAssets()
        failed.task.failedWith('T', false)
        expect(taskHostView()?.state).toBe('failed')
        expect(taskHostView()?.failure?.detail).toBe('T')

        resetTaskHostForTests()
        const thrown = await heldAtAssets()
        thrown.task.failed(new Error('disk'), false)
        expect(taskHostView()?.state).toBe('failed')
        expect(taskHostView()?.failure?.detail).toBe('disk')

        resetTaskHostForTests()
        const cancelled = await heldAtAssets()
        cancelled.task.cancelled(true)
        expect(taskHostView()?.cancelled).toBe(true)
        expect(taskHostView()?.result?.summary).toEqual([language.exportFailedFileIncomplete])

        resetTaskHostForTests()
        const done = await heldAtAssets()
        done.task.done(['S'])
        expect(taskHostView()?.state).toBe('done')
        expect(taskHostView()?.result?.summary).toEqual(['S'])
        expect(spies.alertNormal).not.toHaveBeenCalled()
        expect(spies.alertError).not.toHaveBeenCalled()
    })

    test('E33: close after a hold never shows the card again', async () => {
        const { task } = await heldAtAssets()
        task.open()
        expect(taskShown()).toBe(false)
        const opened = spies.cardsOpened.mock.calls.length
        task.close()
        task.count(1, 3)
        task.step('database')

        expect(task.ended).toBe(true)
        expect(taskShown()).toBe(false)
        expect(spies.cardsOpened.mock.calls.length).toBe(opened)
    })

    test('E34: a card held while a newer task takes the slot is not brought back over it, and the run is a replaced one', async () => {
        async function displaced(): Promise<ExportTask<StepId>> {
            resetTaskHostForTests()
            spies.alertError.mockClear()
            spies.alertNormal.mockClear()
            const held = await heldAtAssets({ ...STEPPED, cancelledFileKeptNotice: 'KEPT' })
            return held.task
        }
        const newer = (): ReturnType<typeof alertTask> => alertTask({ title: 'Newer task', steps: [{ label: 'Step' }] })

        const counting = await displaced()
        const handle = newer()
        counting.count(1, 3)
        expect(taskHostView()?.title).toBe('Newer task')
        expect(handle.detached).toBe(false)

        const silent = await displaced()
        const silentNewer = newer()
        silent.done('S')
        expect(spies.alertNormal).not.toHaveBeenCalled()
        expect(silentNewer.detached).toBe(false)

        const keptFail = await displaced()
        newer()
        keptFail.failedWith('T', true)
        expect(spies.alertError).toHaveBeenCalledTimes(1)
        expect(spies.alertError).toHaveBeenCalledWith('T')
        expect(taskHostView()?.title).toBe('Newer task')

        const unkeptFail = await displaced()
        newer()
        unkeptFail.failedWith('T', false)
        expect(spies.alertError).not.toHaveBeenCalled()

        const keptCancel = await displaced()
        newer()
        keptCancel.cancelled(true)
        expect(spies.alertNormal).toHaveBeenCalledTimes(1)
        expect(spies.alertNormal).toHaveBeenCalledWith('KEPT')
    })

    test('E35: holdAside on a never-opened, ended or replaced run only runs ask and opens no card', async () => {
        useSteppingClock()
        const never = createExportTask(DEF)
        const askNever = vi.fn(async () => 1)
        expect(await never.holdAside(askNever)).toBe(1)
        never.count(1, 2)
        expect(askNever).toHaveBeenCalledTimes(1)
        expect(taskShown()).toBe(false)

        const ended = createExportTask(DEF)
        ended.open()
        ended.done('S')
        resetTaskHostForTests()
        const askEnded = vi.fn(async () => 2)
        expect(await ended.holdAside(askEnded)).toBe(2)
        ended.count(1, 2)
        expect(askEnded).toHaveBeenCalledTimes(1)
        expect(taskShown()).toBe(false)

        const replacedRun = createExportTask(DEF)
        replacedRun.open()
        replaceWithNewerTask()
        const askReplaced = vi.fn(async () => 3)
        expect(await replacedRun.holdAside(askReplaced)).toBe(3)
        replacedRun.count(1, 2)
        expect(askReplaced).toHaveBeenCalledTimes(1)
        expect(taskHostView()?.title).toBe('Newer task')
    })

    test('E39 (diagnostic): a cancel requested before the hold stays requested and the returned card starts running with Cancel offered', async () => {
        const { task, token } = await heldAtAssets()
        token.cancel()
        await task.holdAside(async () => undefined)
        task.count(1, 3)

        expect(token.cancelled).toBe(true)
        expect(taskHostView()?.state).toBe('running')
        expect(taskHostView()?.cancelOffered).toBe(true)
        task.cancelled(false)
        expect(taskHostView()?.cancelled).toBe(true)
    })
})

describe('failedWith, cancelledFileKeptNotice and a done list', () => {
    test('E36: failedWith ends each column with its text exactly', () => {
        const shownRun = createExportTask({ ...DEF, failedHeadline: 'Backup failed' })
        shownRun.open()
        shownRun.failedWith('T', true)
        expect(taskHostView()?.failure?.headline).toBe('Backup failed')
        expect(taskHostView()?.failure?.detail).toBe('T')
        expect(console.error).not.toHaveBeenCalled()
        expect(spies.alertError).not.toHaveBeenCalled()

        resetTaskHostForTests()
        const keptReplaced = createExportTask(DEF)
        keptReplaced.open()
        replaceWithNewerTask()
        keptReplaced.failedWith('T', true)
        expect(spies.alertError).toHaveBeenCalledTimes(1)
        expect(spies.alertError).toHaveBeenCalledWith('T')

        spies.alertError.mockClear()
        resetTaskHostForTests()
        const unkeptReplaced = createExportTask(DEF)
        unkeptReplaced.open()
        replaceWithNewerTask()
        unkeptReplaced.failedWith('T', false)
        expect(spies.alertError).not.toHaveBeenCalled()

        resetTaskHostForTests()
        createExportTask(DEF).failedWith('T', false)
        expect(spies.alertError).toHaveBeenCalledTimes(1)
        expect(spies.alertError).toHaveBeenCalledWith('T')
        expect(console.error).not.toHaveBeenCalled()
    })

    test('E36b: failedWith never passes the text through the file-incomplete sentence and the first ending wins', () => {
        const task = createExportTask(DEF)
        task.open()
        task.failedWith('T', true)
        task.failedWith('U', true)
        task.done('S')

        expect(taskHostView()?.failure?.detail).toBe('T')
        expect(taskHostView()?.failure?.detail).not.toContain(language.exportFailedFileIncomplete)
    })

    test('E37: a kept cancel with no shown card posts the def notice; the card column is unchanged', () => {
        const neverOpened = createExportTask({ ...DEF, cancelledFileKeptNotice: 'B' })
        neverOpened.cancelled(true)
        expect(spies.alertNormal).toHaveBeenCalledTimes(1)
        expect(spies.alertNormal).toHaveBeenCalledWith('B')

        spies.alertNormal.mockClear()
        const replacedRun = createExportTask({ ...DEF, cancelledFileKeptNotice: 'B' })
        replacedRun.open()
        replaceWithNewerTask()
        replacedRun.cancelled(true)
        expect(spies.alertNormal).toHaveBeenCalledWith('B')

        spies.alertNormal.mockClear()
        resetTaskHostForTests()
        const shownRun = createExportTask({ ...DEF, cancelledFileKeptNotice: 'B' })
        shownRun.open()
        shownRun.cancelled(true)
        expect(taskHostView()?.result?.summary).toEqual([language.exportFailedFileIncomplete])
        expect(spies.alertNormal).not.toHaveBeenCalled()

        createExportTask(DEF).cancelled(true)
        expect(spies.alertNormal).toHaveBeenCalledWith(language.exportCancelledFileIncomplete)
    })

    test('E38: done with a list shows each entry on the card and joins with a blank line without one', () => {
        const shownRun = createExportTask(DEF)
        shownRun.open()
        shownRun.done(['A', 'B'])
        expect(taskHostView()?.result?.summary).toEqual(['A', 'B'])
        expect(spies.alertNormal).not.toHaveBeenCalled()

        createExportTask(DEF).done(['A', 'B'])
        expect(spies.alertNormal).toHaveBeenCalledTimes(1)
        expect(spies.alertNormal).toHaveBeenCalledWith('A\n\nB')

        spies.alertNormal.mockClear()
        createExportTask(DEF).done('S')
        expect(spies.alertNormal).toHaveBeenCalledWith('S')
    })
})

describe('without the new fields or calls', () => {
    test('E40 (guard): stepAside stays final and the legacy columns keep today\'s texts', () => {
        useSteppingClock()
        const task = createExportTask(DEF)
        task.open()
        task.stepAside()
        task.count(1, 2)
        task.step('assets')
        expect(taskShown()).toBe(false)
        task.cancelled(true)
        expect(spies.alertNormal).toHaveBeenCalledWith(language.exportCancelledFileIncomplete)

        const error = new Error('disk')
        const failing = createExportTask(DEF)
        failing.failed(error, false)
        expect(spies.alertError).toHaveBeenCalledWith(error)
    })
})
