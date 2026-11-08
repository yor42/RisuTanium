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

const alertErrorMock = vi.hoisted(() => vi.fn())

vi.mock('../../alert', () => ({
    alertConfirm: confirmMock,
    alertError: alertErrorMock,
    alertNormal: vi.fn(),
    alertStore: { set: vi.fn(), subscribe: () => () => { } },
}))
vi.mock('../../stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    // Importing the bootstrap module loads the parser, whose module-level effect reads `selIdState` and `DBState`.
    return { alertStore: writable({ type: 'none', msg: '' }), selIdState: { selId: -1 }, DBState: { db: {} } }
})
const workInProgressMock = vi.hoisted(() => vi.fn((): boolean => false))
const runEndFault = vi.hoisted(() => ({ throws: false }))
vi.mock('../../process/chatOrigin', () => ({ isWorkInProgress: workInProgressMock }))
vi.mock('../backuplocal', () => ({ LoadLocalBackup: localLoaderMock }))
vi.mock('../internalBackup', () => ({ loadInternalBackup: vi.fn() }))
// The real run is kept; a case can make its `end` throw after the real end ran, as a failing end bookkeeping would.
vi.mock('../restoreInProgress', async (importOriginal) => {
    const original = await importOriginal<typeof import('../restoreInProgress')>()
    return {
        ...original,
        beginRestoreRun: () => {
            const run = original.beginRestoreRun()
            return {
                end: (outcome: OperationOutcome) => {
                    run.end(outcome)
                    if (runEndFault.throws) {
                        throw new Error('run end failed')
                    }
                },
            }
        },
    }
})

import { beginBusy, resetBusyActionsForTest } from '../../process/memory/busyActions'
import { resetRestoreInProgressForTests, restorePhase } from '../restoreInProgress'
import { restoreFromBinFile, restoreFromBinFileAtFirstRun } from '../settingsRestore'

const endOf = (outcome: OperationOutcome) => ({ operation: 'import', target: null, outcome, cause: null, detail: {} })

/** Loaders a case holds open; the next teardown settles each, so no run or watcher outlives its case. */
const heldLoaders: Array<(outcome: OperationOutcome) => void> = []

beforeEach(() => {
    resetRestoreInProgressForTests()
    resetBusyActionsForTest()
    confirmMock.mockReset().mockResolvedValue(true)
    alertErrorMock.mockReset()
    localLoaderMock.mockReset().mockResolvedValue(endOf('canceled'))
    workInProgressMock.mockReset().mockReturnValue(false)
    runEndFault.throws = false
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(async () => {
    for (const release of heldLoaders.splice(0)) {
        release('nothing-replaced')
    }
    await flushMicrotasks()
    vi.useRealTimers()
    vi.restoreAllMocks()
    resetBusyActionsForTest()
})

async function flushMicrotasks(): Promise<void> {
    for (let turn = 0; turn < 20; turn += 1) {
        await Promise.resolve()
    }
}

/** Makes the loader return a promise the case settles itself (a picker that has not answered yet). */
function holdLoader(): (outcome: OperationOutcome) => void {
    let release: (outcome: OperationOutcome) => void = () => { }
    localLoaderMock.mockReturnValue(new Promise((resolve) => {
        release = (outcome) => resolve(endOf(outcome))
    }))
    heldLoaders.push(release)
    return release
}

/** Counts the return-event handlers (window focus, document visibilitychange) added and not yet removed. */
function watchReturnListeners(): { added: () => number, live: () => number } {
    const returnEvents = ['focus', 'visibilitychange']
    const added = [vi.spyOn(window, 'addEventListener'), vi.spyOn(document, 'addEventListener')]
    const removed = [vi.spyOn(window, 'removeEventListener'), vi.spyOn(document, 'removeEventListener')]
    const handlersOf = (spy: typeof added[number]) => spy.mock.calls.filter((call) => returnEvents.includes(call[0])).map((call) => call[1])
    return {
        added: () => handlersOf(added[0]).length + handlersOf(added[1]).length,
        live: () => [0, 1].reduce((sum, target) => sum + handlersOf(added[target]).filter((handler) => !handlersOf(removed[target]).includes(handler)).length, 0),
    }
}

function startWelcomeEntry(): { settled: () => boolean, rejection: () => unknown } {
    let settled = false
    let rejection: unknown
    void restoreFromBinFileAtFirstRun().then(() => {
        settled = true
    }, (error: unknown) => {
        settled = true
        rejection = error
    })
    return { settled: () => settled, rejection: () => rejection }
}

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

    test('a busy guard that throws rejects the entry with that error and leaves no listener', async () => {
        const listeners = watchReturnListeners()
        const failure = new Error('guard failed')
        workInProgressMock.mockImplementation(() => {
            throw failure
        })

        const entry = startWelcomeEntry()
        await flushMicrotasks()

        expect(entry.settled()).toBe(true)
        expect(entry.rejection()).toBe(failure)
        expect(listeners.live()).toBe(0)
        expect(localLoaderMock).not.toHaveBeenCalled()
    })

    test('a run end that throws after the loader armed the watcher rejects the entry with that error, removes the listeners and stops the watcher', async () => {
        vi.useFakeTimers()
        const listeners = watchReturnListeners()
        runEndFault.throws = true
        const release = holdLoader()

        const entry = startWelcomeEntry()
        await flushMicrotasks()
        expect(listeners.added()).toBeGreaterThan(0)
        release('nothing-replaced')
        await flushMicrotasks()

        expect(entry.settled()).toBe(true)
        expect(entry.rejection()).toEqual(new Error('run end failed'))
        expect(listeners.live()).toBe(0)
        // A stopped watcher never reacts to a later window return.
        const loaderCalls = localLoaderMock.mock.calls.length
        window.dispatchEvent(new Event('focus'))
        await vi.advanceTimersByTimeAsync(3000)
        expect(localLoaderMock).toHaveBeenCalledTimes(loaderCalls)
    })

    test('guard: the Settings entry still calls the loader with no arguments', async () => {
        await restoreFromBinFile()

        expect(localLoaderMock).toHaveBeenCalledTimes(1)
        expect(localLoaderMock.mock.calls[0]).toEqual([])
    })
})

describe('the Welcome restore entry when the picker is dismissed without an event', () => {
    test('the window coming back ends the wait after the grace, and the restore run stays open', async () => {
        vi.useFakeTimers()
        holdLoader()
        const entry = startWelcomeEntry()
        await flushMicrotasks()
        expect(localLoaderMock).toHaveBeenCalledTimes(1)

        window.dispatchEvent(new Event('focus'))
        await vi.advanceTimersByTimeAsync(500)
        expect(entry.settled()).toBe(false)
        await vi.advanceTimersByTimeAsync(2500)

        expect(entry.settled()).toBe(true)
        // Pins a pre-existing limitation, not intended behaviour: the fallback only stops the Welcome entry waiting, so the
        // run stays open until the loader settles. A fix that ends the run on dismissal updates this assertion deliberately.
        expect(restorePhase()).toBe('asking')
        expect(localLoaderMock).toHaveBeenCalledTimes(1)
    })

    test('a visibility return to visible ends the wait; a change to hidden does not', async () => {
        vi.useFakeTimers()
        const visibility = vi.spyOn(document, 'visibilityState', 'get')

        visibility.mockReturnValue('hidden')
        holdLoader()
        const hiddenEntry = startWelcomeEntry()
        await flushMicrotasks()
        document.dispatchEvent(new Event('visibilitychange'))
        await vi.advanceTimersByTimeAsync(60000)
        expect(hiddenEntry.settled()).toBe(false)
        heldLoaders.splice(0).forEach((release) => release('nothing-replaced'))
        await flushMicrotasks()
        expect(hiddenEntry.settled()).toBe(true)

        visibility.mockReturnValue('visible')
        holdLoader()
        const visibleEntry = startWelcomeEntry()
        await flushMicrotasks()
        document.dispatchEvent(new Event('visibilitychange'))
        await vi.advanceTimersByTimeAsync(3000)

        // Pinned pre-existing limitation, as in the focus case: the run is still open after the entry settles.
        expect(visibleEntry.settled()).toBe(true)
        expect(restorePhase()).toBe('asking')
    })

    test('a picker that took a file keeps the entry waiting through a window return', async () => {
        vi.useFakeTimers()
        const release = holdLoader()
        const entry = startWelcomeEntry()
        await flushMicrotasks()
        // The picker's change handler opens the busy entry before anything else.
        const busy = beginBusy('backupLoad')

        window.dispatchEvent(new Event('focus'))
        await vi.advanceTimersByTimeAsync(3000)
        expect(entry.settled()).toBe(false)
        expect(restorePhase()).toBe('working')

        busy.end()
        release('nothing-replaced')
        await flushMicrotasks()
        expect(entry.settled()).toBe(true)
    })

    test('a window return during the confirmations does not end the wait, and no return ends nothing by itself', async () => {
        vi.useFakeTimers()
        let answerFirst: (answer: boolean) => void = () => { }
        confirmMock.mockReturnValueOnce(new Promise<boolean>((resolve) => {
            answerFirst = resolve
        }))
        const early = startWelcomeEntry()
        await flushMicrotasks()

        window.dispatchEvent(new Event('focus'))
        await vi.advanceTimersByTimeAsync(3000)
        expect(early.settled()).toBe(false)
        expect(localLoaderMock).not.toHaveBeenCalled()
        answerFirst(false)
        await flushMicrotasks()
        expect(early.settled()).toBe(true)

        holdLoader()
        const silent = startWelcomeEntry()
        await flushMicrotasks()
        await vi.advanceTimersByTimeAsync(60000)
        expect(silent.settled()).toBe(false)
    })

    test('every window and document listener the entry added is removed once it settles', async () => {
        vi.useFakeTimers()
        const listeners = watchReturnListeners()

        const release = holdLoader()
        const byLoader = startWelcomeEntry()
        await flushMicrotasks()
        expect(listeners.added()).toBeGreaterThan(0)
        release('nothing-replaced')
        await flushMicrotasks()
        expect(byLoader.settled()).toBe(true)
        expect(listeners.live()).toBe(0)

        // The fallback settles the entry while its loader is still pending: the timer's own cleanup must have run, not a later one.
        holdLoader()
        const byFallback = startWelcomeEntry()
        await flushMicrotasks()
        window.dispatchEvent(new Event('focus'))
        await vi.advanceTimersByTimeAsync(3000)
        expect(byFallback.settled()).toBe(true)
        expect(listeners.live()).toBe(0)
        heldLoaders.splice(0).forEach((held) => held('nothing-replaced'))
        await flushMicrotasks()

        const loaderCalls = localLoaderMock.mock.calls.length
        window.dispatchEvent(new Event('focus'))
        await vi.advanceTimersByTimeAsync(3000)
        expect(localLoaderMock).toHaveBeenCalledTimes(loaderCalls)
    })

    test('guard: the Settings entry has no fallback and keeps waiting through a window return', async () => {
        vi.useFakeTimers()
        holdLoader()
        let settled = false
        void restoreFromBinFile().then(() => {
            settled = true
        })
        await flushMicrotasks()

        window.dispatchEvent(new Event('focus'))
        await vi.advanceTimersByTimeAsync(3000)

        expect(localLoaderMock).toHaveBeenCalledTimes(1)
        expect(settled).toBe(false)
    })
})

describe('a failed Welcome restore reaches the installed rejection handler', () => {
    const installed: Array<[string, EventListener]> = []

    /** Installs the real bootstrap handlers and records them, so teardown removes exactly the ones this case added. */
    async function installRealHandlers(): Promise<void> {
        const add = window.addEventListener.bind(window)
        vi.spyOn(window, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
            if (type === 'error' || type === 'unhandledrejection') {
                installed.push([type, listener as EventListener])
            }
            add(type, listener, options)
        })
        const { updateErrorHandling } = await import('../../bootstrap')
        updateErrorHandling()
    }

    /** The test DOM (happy-dom) never raises `unhandledrejection` itself, so the event is dispatched carrying the real rejected promise and reason. */
    function raiseUnhandledRejection(promise: Promise<unknown>, reason: unknown): void {
        window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { promise, reason }))
    }

    afterEach(() => {
        for (const [type, listener] of installed.splice(0)) {
            window.removeEventListener(type, listener)
        }
    })

    test('the rejection of the Welcome entry reaches alertError, so the failure stays visible', async () => {
        await installRealHandlers()
        const failure = new Error('guard failed')
        workInProgressMock.mockImplementation(() => {
            throw failure
        })

        // As welcomeFlow does: the returned promise is voided and nothing handles it. The no-op handler only keeps the
        // test runner from reporting the same rejection a second time; the page-level event below is what the app sees.
        const entry = restoreFromBinFileAtFirstRun()
        void entry
        const reason = await entry.then(() => undefined, (error: unknown) => error)
        expect(reason).toBe(failure)
        raiseUnhandledRejection(entry, reason)

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(failure)
    })

    test('a run end that throws after the fallback already resolved the entry is rethrown and reaches alertError', async () => {
        await installRealHandlers()
        // The runner's own rejection listeners are set aside so this deliberate unhandled rejection is not reported as a
        // test error; the stand-in forwards it to the installed page handler exactly as a browser would.
        const runnerListeners = process.listeners('unhandledRejection')
        process.removeAllListeners('unhandledRejection')
        const forwarded: unknown[] = []
        const forward = (reason: unknown, promise: Promise<unknown>): void => {
            forwarded.push(reason)
            raiseUnhandledRejection(promise, reason)
        }
        process.on('unhandledRejection', forward)
        try {
            vi.useFakeTimers()
            runEndFault.throws = true
            const release = holdLoader()
            const entry = startWelcomeEntry()
            await flushMicrotasks()
            window.dispatchEvent(new Event('focus'))
            await vi.advanceTimersByTimeAsync(3000)
            expect(entry.settled()).toBe(true)
            expect(entry.rejection()).toBeUndefined()

            release('nothing-replaced')
            await flushMicrotasks()
            vi.useRealTimers()
            await new Promise((resolve) => setTimeout(resolve, 20))

            expect(forwarded).toEqual([new Error('run end failed')])
            expect(alertErrorMock).toHaveBeenCalledTimes(1)
            expect(alertErrorMock).toHaveBeenCalledWith(new Error('run end failed'))
        } finally {
            process.off('unhandledRejection', forward)
            for (const listener of runnerListeners) {
                process.on('unhandledRejection', listener)
            }
        }
    })
})
