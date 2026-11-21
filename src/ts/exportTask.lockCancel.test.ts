// @vitest-environment jsdom

/**
 * `ExportTask.lockCancel`: the additive point of no return of a run with a Cancel. The real `alertTask` slot and cancel
 * token run; only the alert module and the stores it reads are replaced. An export never calls it, so an export run's
 * Cancel must stay offered on a returned card.
 *
 * Labels: CG-new (a new method); the scratch mutants M-C6 and M-C7 supply the red evidence.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock('src/ts/alert', () => ({
    alertClear: vi.fn(),
    alertWait: vi.fn(),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    waitUnreadNotice: vi.fn(async () => { }),
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

import { createExportTask } from 'src/ts/exportTask'
import { ExportCancelToken } from 'src/ts/exportCancel'
import { requestTaskCancel, resetTaskHostForTests, setTaskClockForTests, taskHostView, taskShown } from 'src/ts/alertTask.svelte'

const DEF = { title: 'Restoring', steps: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }] }

beforeEach(() => {
    resetTaskHostForTests()
    // One second per read, so every report reaches the published view at once.
    let tick = 0
    setTaskClockForTests({ now: () => (tick += 1000), setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (timer) => clearTimeout(timer), hidden: () => false })
    return () => resetTaskHostForTests()
})

describe('ExportTask.lockCancel', () => {
    test('X-T1a: false after a Cancel, true otherwise, and a granted lock removes Cancel from the shown card', () => {
        const cancelled = createExportTask(DEF)
        cancelled.useToken(new ExportCancelToken())
        cancelled.open()
        requestTaskCancel()
        expect(cancelled.lockCancel()).toBe(false)
        cancelled.close()
        resetTaskHostForTests()

        const task = createExportTask(DEF)
        task.useToken(new ExportCancelToken())
        task.open()
        expect(taskHostView()?.cancelOffered).toBe(true)
        expect(task.lockCancel()).toBe(true)
        expect(taskHostView()?.cancelOffered).toBe(false)
        requestTaskCancel()
        expect(task.token?.cancelled).toBe(false)
    })

    test('X-T1b: a card that holdAside brought back after the lock offers no Cancel', async () => {
        const task = createExportTask(DEF)
        task.useToken(new ExportCancelToken())
        task.open()
        expect(task.lockCancel()).toBe(true)

        await task.holdAside(async () => {
            expect(taskShown()).toBe(false)
        })
        task.step('two')

        expect(taskShown()).toBe(true)
        expect(taskHostView()?.stepIndex).toBe(1)
        expect(taskHostView()?.cancelOffered).toBe(false)
    })

    test('X-T1c: a lock taken while the card is held aside still applies when it returns', async () => {
        const task = createExportTask(DEF)
        task.useToken(new ExportCancelToken())
        task.open()

        await task.holdAside(async () => {
            expect(task.lockCancel()).toBe(true)
        })
        task.step('two')

        expect(taskHostView()?.cancelOffered).toBe(false)
    })

    test('X-T1d: an export run that never locks keeps Cancel on the card it gets back', async () => {
        const task = createExportTask(DEF)
        task.useToken(new ExportCancelToken())
        task.open()

        await task.holdAside(async () => { })
        task.step('two')

        expect(taskHostView()?.cancelOffered).toBe(true)
    })

    test('X-T1e: after any ending the lock is refused', () => {
        const task = createExportTask(DEF)
        task.useToken(new ExportCancelToken())
        task.open()
        task.close()

        expect(task.lockCancel()).toBe(false)
    })
})
