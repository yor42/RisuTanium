// @vitest-environment node
/**
 * The save-request probe at its two page-side call sites: the reply-end flush wrapper (`flushPageReplyEndWhenHidden`) and the
 * real scheduler's `requestNow`. The save request is wired to a REAL `createSaveScheduler`, so the probe reads the same
 * listener and wait state the save loop sets; the clock is a hand clock. The probe global is read by name only.
 * Labels: new-behaviour (a measurement that did not exist before; not a reproducer of a defect), guard (may pass before and after).
 * A pass says nothing about a device.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const flag = vi.hoisted(() => ({ measure: true }))
const world = vi.hoisted(() => ({ requestNow: () => {} }))
const holdSpy = vi.hoisted(() => vi.fn())
const markSpy = vi.hoisted(() => vi.fn())

vi.mock('src/ts/process/memory/measureFlag', () => ({
    get MEASURE() {
        return flag.measure
    },
}))

vi.mock('src/ts/globalApi.svelte', () => ({
    requestSaveNow: () => world.requestNow(),
    requestNetSweep: vi.fn(),
    hasUnsavedSaveMarks: vi.fn(() => false),
}))

vi.mock('src/ts/process/hiddenReplySaveGuard', () => ({ holdHiddenReplySave: holdSpy }))
vi.mock('src/ts/storage/characterSaveMarks', () => ({ markCharacterForSave: markSpy }))

import { flushPageReplyEndWhenHidden } from 'src/ts/process/saveOnHide'
import { createSaveScheduler, type SaveScheduler } from 'src/ts/storage/saveScheduler'

type Record = { kind: string, seq: number, t: number, hidden?: boolean, armed?: boolean, waiting?: boolean }
type ProbeGlobal = { __risuSaveRequestProbe?: { all(): Record[], reset(): void } }

const clock = { now: 0 }
const origin = { chaId: 'char-0', memberChaId: undefined }

function probeRecords(): Record[] {
    return (globalThis as ProbeGlobal).__risuSaveRequestProbe?.all() ?? []
}

function setVisibility(state: 'visible' | 'hidden'): void {
    vi.stubGlobal('document', { visibilityState: state })
}

function makeScheduler(): SaveScheduler {
    const scheduler = createSaveScheduler({
        debounceMs: 1000,
        sleep: () => new Promise<void>(() => {}),
        hooks: { onMark: vi.fn(), onDue: vi.fn(), onRequestNow: vi.fn() },
    })
    world.requestNow = () => scheduler.requestNow()
    return scheduler
}

beforeEach(() => {
    flag.measure = true
    clock.now = 0
    holdSpy.mockReset()
    markSpy.mockReset()
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now)
    setVisibility('hidden')
})

afterEach(() => {
    ;(globalThis as ProbeGlobal).__risuSaveRequestProbe?.reset()
    delete (globalThis as ProbeGlobal).__risuSaveRequestProbe
    world.requestNow = () => {}
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

async function microtasks(): Promise<void> {
    for (let turn = 0; turn < 5; turn++) {
        await Promise.resolve()
    }
}

describe('the probe in a normal build', () => {
    // Guard: passes before and after (before, nothing exists to record).
    test('guard: records nothing and installs no global, and the request still runs the listener and sets the latch', async () => {
        flag.measure = false
        const scheduler = makeScheduler()
        const listener = vi.fn()
        scheduler.onRequest(listener)

        flushPageReplyEndWhenHidden(origin)

        expect((globalThis as ProbeGlobal).__risuSaveRequestProbe).toBeUndefined()
        expect(listener).toHaveBeenCalledTimes(1)
        let woke = false
        void scheduler.wait(1000).then(() => { woke = true })
        await microtasks()
        expect(woke).toBe(true)
    })
})

describe('the probe in a measurement build', () => {
    test('a flush in a yield gap notes the reply end, then the request with an armed listener', () => {
        const scheduler = makeScheduler()
        clock.now = 150
        const listener = vi.fn()
        scheduler.onRequest(listener)
        clock.now = 170

        flushPageReplyEndWhenHidden(origin)

        const records = probeRecords()
        expect(records).toHaveLength(2)
        expect(records[0]).toMatchObject({ kind: 'replyEnd', hidden: true, t: 170 })
        expect(records[1]).toMatchObject({ kind: 'requestNow', armed: true, waiting: false, t: 170 })
        expect(records[1].seq).toBe(records[0].seq + 1)
        expect(listener).toHaveBeenCalledTimes(1)
    })

    test('a flush after the last yield ended notes the request with no listener armed', () => {
        const scheduler = makeScheduler()
        clock.now = 150
        const release = scheduler.onRequest(vi.fn())
        clock.now = 160
        release()
        clock.now = 320

        flushPageReplyEndWhenHidden(origin)

        const request = probeRecords().find((record) => record.kind === 'requestNow')
        expect(request).toMatchObject({ armed: false, waiting: false, t: 320 })
    })

    test('a visible page notes one reply end and raises no request', () => {
        makeScheduler()
        const requestSpy = vi.fn()
        world.requestNow = requestSpy
        setVisibility('visible')
        clock.now = 50

        flushPageReplyEndWhenHidden(origin)

        expect(probeRecords()).toHaveLength(1)
        expect(probeRecords()[0]).toMatchObject({ kind: 'replyEnd', hidden: false, t: 50 })
        expect(requestSpy).not.toHaveBeenCalled()
    })

    test('a request while the loop sits in a scheduler wait reads waiting; a second one right after does not', () => {
        const scheduler = makeScheduler()
        void scheduler.wait(1000)
        clock.now = 400

        scheduler.requestNow()
        scheduler.requestNow()

        const requests = probeRecords().filter((record) => record.kind === 'requestNow')
        expect(requests).toHaveLength(2)
        expect(requests[0]).toMatchObject({ waiting: true, armed: false, t: 400 })
        expect(requests[1]).toMatchObject({ waiting: false })
    })

    // Guard on behaviour: passes before and after (before, there is no note that could throw).
    test('guard: a failing clock never stops the flush, the request or the listener', () => {
        const scheduler = makeScheduler()
        const listener = vi.fn()
        scheduler.onRequest(listener)
        vi.spyOn(performance, 'now').mockImplementation(() => { throw new Error('clock') })

        expect(() => flushPageReplyEndWhenHidden(origin)).not.toThrow()

        expect(markSpy).toHaveBeenCalledWith('char-0')
        expect(listener).toHaveBeenCalledTimes(1)
    })
})
