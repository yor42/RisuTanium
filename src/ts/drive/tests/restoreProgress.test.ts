// @vitest-environment jsdom

/**
 * The restore progress seam (`restoreProgress.ts`): the legacy implementation posts exactly today's wait texts, the card
 * implementation drives one task card with Cancel until `lockCancel`. The real `alertTask` slot, `exportTask` adapter and
 * cancel token run; only the alert module (spied), the stores it reads and the platform are replaced.
 *
 * Labels: every test is CG-new (a new module, nothing to reproduce on the base); the scratch mutants of the S6d plan
 * (M-D1..M-D3, M-D27, M-C4, M-C6) supply the red evidence.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { language } from 'src/lang'

const spies = vi.hoisted(() => ({
    alertWait: vi.fn(),
    platform: { tauri: false },
    throwing: { on: false },
}))

vi.mock('src/ts/alert', () => ({
    alertClear: vi.fn(),
    alertWait: spies.alertWait,
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    waitUnreadNotice: vi.fn(async () => { }),
    alertNormalWait: vi.fn(async () => { }),
}))

vi.mock('src/ts/stores.svelte', () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}))

vi.mock('src/ts/platform', () => ({
    get isTauri() { return spies.platform.tauri },
    isNodeServer: false,
    isIOS: () => false,
}))

vi.mock('src/ts/vendor/streamSaver', () => ({ default: { useBlobFallback: false, mitm: '', createWriteStream: undefined } }))

// With `throwing.on`, every method of the card handle throws, as a broken card host would.
vi.mock('src/ts/alertTask.svelte', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/alertTask.svelte')>()
    return {
        ...actual,
        alertTask: (def: Parameters<typeof actual.alertTask>[0]) => {
            const handle = actual.alertTask(def)
            if (!spies.throwing.on) return handle
            return new Proxy(handle, {
                get(target, property) {
                    const value = Reflect.get(target, property) as unknown
                    return typeof value === 'function' ? () => { throw new Error('card host broke') } : value
                },
            })
        },
    }
})

import {
    binCardDef, cardRestoreProgress, legacyRestoreProgress, restoreCleanupCardDef, restoreOldCardDef, restorePointCardDef, rtbCardDef,
} from 'src/ts/drive/restoreProgress'
import { ExportCancelledError } from 'src/ts/exportCancel'
import {
    answerTask, requestTaskCancel, resetTaskHostForTests, setTaskClockForTests, taskBackPress, taskHostView, taskResultShowing, taskShown,
} from 'src/ts/alertTask.svelte'

/** A clock that advances one second per read, so every report reaches the published view at once. */
function useSteppingClock(): void {
    let tick = 0
    setTaskClockForTests({ now: () => (tick += 1000), setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (timer) => clearTimeout(timer), hidden: () => false })
}

beforeEach(() => {
    resetTaskHostForTests()
    useSteppingClock()
    spies.alertWait.mockClear()
    spies.platform.tauri = false
    spies.throwing.on = false
    vi.spyOn(console, 'error').mockImplementation(() => { })
    return () => {
        resetTaskHostForTests()
        vi.restoreAllMocks()
    }
})

const stepLabels = (): string[] => (taskHostView()?.steps ?? []).map((entry) => entry.label)

describe('the legacy seam', () => {
    test('U1: phase and bytes post today\'s wait once per non-null text; Cancel is never reported; the lock is always granted', async () => {
        const progress = legacyRestoreProgress()
        progress.phase('save', 'one')
        progress.phase('read', null)
        progress.bytes('copy', 1, 2, 'two')
        progress.bytes('copy', 2, 2, null)

        expect(spies.alertWait.mock.calls).toEqual([['one'], ['two']])
        expect(progress.cancelRequested).toBe(false)
        expect(progress.lockCancel()).toBe(true)
        const wait = Promise.resolve(7)
        expect(progress.race(wait)).toBe(wait)
        expect(await progress.aside(async () => 'asked')).toBe('asked')
        expect(progress.handOver(restoreOldCardDef(), 'read')).toBe(progress)
        progress.cancelled()
        progress.leave()
        expect(taskShown()).toBe(false)
        expect(spies.alertWait).toHaveBeenCalledTimes(2)
    })
})

describe('the card seam', () => {
    test('U2: opens with the def steps and Cancel, moves forward only, shows bytes, leaves, and posts no wait', () => {
        const progress = cardRestoreProgress(binCardDef())
        const view = taskHostView()

        expect(view?.title).toBe(language.restoreTaskTitle)
        expect(stepLabels()).toEqual([
            language.restoreStepSave, language.importStepCheck, language.restoreStepRead, language.restoreStepTabs,
            language.restoreStepCopy, language.restoreStepFinishFiles, language.restoreStepLoad,
        ])
        expect(view?.cancelOffered).toBe(true)

        progress.phase('read', 'legacy text')
        expect(taskHostView()?.stepIndex).toBe(2)
        progress.phase('save', null)
        expect(taskHostView()?.stepIndex).toBe(2)
        progress.bytes('copy', 1024 * 1024, 4 * 1024 * 1024, null)
        expect(taskHostView()?.stepIndex).toBe(4)
        expect(taskHostView()?.bytes).toEqual({ done: 1024 * 1024, total: 4 * 1024 * 1024 })

        progress.leave()
        expect(taskShown()).toBe(false)
        progress.phase('load', null)
        progress.bytes('load', 1, 2, null)
        progress.leave()
        expect(taskShown()).toBe(false)
        expect(spies.alertWait).not.toHaveBeenCalled()
    })

    test('U3: a card host whose handle throws never throws into the restore; the error goes to the console', async () => {
        spies.throwing.on = true
        const progress = cardRestoreProgress(restorePointCardDef())

        expect(() => progress.phase('load', null)).not.toThrow()
        expect(() => progress.bytes('load', 1, 2, null)).not.toThrow()
        expect(await progress.aside(async () => 'asked')).toBe('asked')
        expect(() => progress.lockCancel()).not.toThrow()
        expect(() => progress.cancelled()).not.toThrow()
        // `leave` on a card that no ending has closed yet is the call that reaches the broken handle.
        const open = cardRestoreProgress(restorePointCardDef())
        expect(() => open.leave()).not.toThrow()
        expect(console.error).toHaveBeenCalled()
        expect(progress.cancelRequested).toBe(false)
    })

    test('U4: aside takes the card away while the prompt is pending and it returns at its step with Cancel at the next report', async () => {
        const progress = cardRestoreProgress(rtbCardDef())
        progress.phase('check', null)
        let answer: (value: string) => void = () => { }
        const asked = progress.aside(() => new Promise<string>((resolve) => { answer = resolve }))

        expect(taskShown()).toBe(false)
        answer('secret')
        expect(await asked).toBe('secret')
        expect(taskShown()).toBe(false)

        progress.phase('check', null)
        expect(taskShown()).toBe(true)
        expect(taskHostView()?.stepIndex).toBe(2)
        expect(taskHostView()?.cancelOffered).toBe(true)
    })

    test('U5: titles per route, the save label, no tabs step on Tauri, and no noun on the copy steps', () => {
        expect(restorePointCardDef().title).toBe(language.restorePointTaskTitle)
        expect(restoreOldCardDef().title).toBe(language.restoreOldTaskTitle)
        expect(binCardDef().title).toBe(language.restoreTaskTitle)
        expect(rtbCardDef().title).toBe(language.restoreTaskTitle)
        expect(restoreCleanupCardDef().title).toBe(language.restoreTaskTitle)
        expect(restoreCleanupCardDef().steps.map((entry) => entry.label)).toEqual([language.restoreStepCleanup])
        for (const def of [restorePointCardDef(), restoreOldCardDef(), binCardDef(), rtbCardDef()]) {
            expect(def.steps[0].label).toBe(language.restoreStepSave)
            expect(def.steps.map((entry) => entry.id)).toContain('tabs')
        }
        for (const def of [binCardDef(), rtbCardDef()]) {
            const copy = def.steps.find((entry) => entry.id === 'copy')
            expect(copy?.noun).toBeUndefined()
            expect(copy?.mark).toBe('transfer_in')
        }

        spies.platform.tauri = true
        for (const def of [restorePointCardDef(), restoreOldCardDef(), binCardDef(), rtbCardDef()]) {
            expect(def.steps.map((entry) => entry.id)).not.toContain('tabs')
        }
    })

    test('U6: a Cancel is seen by cancelRequested; cancelled() settles the cancelled card; OK empties the slot', () => {
        const progress = cardRestoreProgress(restorePointCardDef())
        expect(progress.cancelRequested).toBe(false)
        requestTaskCancel()
        expect(progress.cancelRequested).toBe(true)

        progress.cancelled()
        expect(taskResultShowing()).toBe(true)
        expect(taskHostView()?.cancelled).toBe(true)
        answerTask({ kind: 'ok' })
        expect(taskShown()).toBe(false)
        expect(taskHostView()).toBeNull()
    })

    test('U7: a Cancel before the lock refuses it; a lock before the Cancel refuses Cancel and Back', () => {
        const first = cardRestoreProgress(restorePointCardDef())
        requestTaskCancel()
        expect(first.lockCancel()).toBe(false)
        first.leave()
        resetTaskHostForTests()
        useSteppingClock()

        const second = cardRestoreProgress(restorePointCardDef())
        expect(second.lockCancel()).toBe(true)
        requestTaskCancel()
        taskBackPress()

        const view = taskHostView()
        expect(view?.state).toBe('running')
        expect(view?.cancelOffered).toBe(false)
        // The card renders the MC-2620 line when it offers no Cancel and has no reason of its own.
        expect(view?.lockReason).toBeUndefined()
        expect(language.patternTaskCancelUnsafe).toBe("This step can't be stopped midway")
        expect(second.cancelRequested).toBe(false)
    })

    test('U8: cancelled() after a granted lock only closes the card and never shows a result', () => {
        const progress = cardRestoreProgress(restorePointCardDef())
        expect(progress.lockCancel()).toBe(true)
        progress.cancelled()

        expect(taskResultShowing()).toBe(false)
        expect(taskShown()).toBe(false)
    })

    test('U9: handOver swaps the card in place at the step, the old instance goes inert, and one token serves both', async () => {
        const old = cardRestoreProgress(restorePointCardDef())
        const next = old.handOver(restoreOldCardDef(), 'read')

        expect(taskShown()).toBe(true)
        expect(taskHostView()?.title).toBe(language.restoreOldTaskTitle)
        expect(taskHostView()?.stepIndex).toBe(1)

        old.phase('load', null)
        old.leave()
        expect(taskShown()).toBe(true)
        expect(taskHostView()?.stepIndex).toBe(1)

        requestTaskCancel()
        expect(next.cancelRequested).toBe(true)
        expect(old.cancelRequested).toBe(true)
        await expect(old.race(new Promise<never>(() => { }))).rejects.toBeInstanceOf(ExportCancelledError)
    })
})
