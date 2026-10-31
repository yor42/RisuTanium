/**
 * The restore signal: the phase a page is in, which outcomes make the ending sticky, and when the live-end listeners fire.
 * Real: `restoreInProgress.ts` and `busyActions.ts`. Nothing is mocked.
 *
 * Titles starting `guard:` pass before and after any change of the named rule; they pin the contract the Android drain and
 * the drop paths rely on.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { beginBusy } from '../../process/memory/busyActions'
import {
    beginRestoreRun, onRestoreEndedLive, resetRestoreInProgressForTests, restoreInProgress, restorePhase,
} from '../restoreInProgress'
import type { OperationOutcome } from '../operationEnd'

const ended = vi.fn()
let stop: () => void = () => { }

beforeEach(() => {
    resetRestoreInProgressForTests()
    ended.mockReset()
    stop = onRestoreEndedLive(ended)
})

afterEach(() => {
    stop()
})

describe('restore phase', () => {
    test('guard: with no run and nothing busy the phase is none', () => {
        expect(restorePhase()).toBe('none')
        expect(restoreInProgress()).toBe(false)
    })

    test('an open run is asking, a backupLoad busy entry is working, and a run never counts as busy', () => {
        const run = beginRestoreRun()
        expect(restorePhase()).toBe('asking')
        expect(restoreInProgress()).toBe(true)
        const busy = beginBusy('backupLoad')
        expect(restorePhase()).toBe('working')
        busy.end()
        expect(restorePhase()).toBe('asking')
        run.end('canceled')
        expect(restorePhase()).toBe('none')
    })

    test('a backupLoad busy entry with no run (a boot restore) is working; other busy kinds are not', () => {
        const other = beginBusy('import')
        expect(restorePhase()).toBe('none')
        other.end()
        const busy = beginBusy('backupLoad')
        expect(restorePhase()).toBe('working')
        busy.end()
    })

    test.each<OperationOutcome>(['committed', 'permitted-partial', 'unknown'])('%s makes the page ending, and it stays', (outcome) => {
        const run = beginRestoreRun()
        run.end(outcome)
        expect(restorePhase()).toBe('pageEnding')
        beginRestoreRun().end('canceled')
        expect(restorePhase()).toBe('pageEnding')
        expect(ended).not.toHaveBeenCalled()
    })

    test.each<OperationOutcome>(['canceled', 'nothing-replaced', 'failed'])('%s leaves the page live and fires the listeners once', (outcome) => {
        const run = beginRestoreRun()
        run.end(outcome)
        run.end(outcome)
        expect(restorePhase()).toBe('none')
        expect(ended).toHaveBeenCalledTimes(1)
    })

    test('the listeners fire only when the last open run ends', () => {
        const first = beginRestoreRun()
        const second = beginRestoreRun()
        first.end('canceled')
        expect(ended).not.toHaveBeenCalled()
        second.end('canceled')
        expect(ended).toHaveBeenCalledTimes(1)
    })

    test('a run that ends while a backupLoad entry is still open does not fire the listeners', () => {
        const run = beginRestoreRun()
        const busy = beginBusy('backupLoad')
        run.end('failed')
        expect(ended).not.toHaveBeenCalled()
        busy.end()
    })

    test('a listener that throws does not stop the next one', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        const stopThrowing = onRestoreEndedLive(() => { throw new Error('listener') })
        beginRestoreRun().end('failed')
        stopThrowing()
        expect(ended).toHaveBeenCalledTimes(1)
    })

    test('an unsubscribed listener is not called', () => {
        stop()
        beginRestoreRun().end('failed')
        expect(ended).not.toHaveBeenCalled()
    })
})
