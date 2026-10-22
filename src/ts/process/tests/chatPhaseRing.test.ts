/**
 * The console-free chat phase ring (`../chatPhaseRing`): the three note functions record only while `MEASURE` is true,
 * the ring keeps the newest `CHAT_PHASE_RING_LIMIT` entries, a snapshot is a copy, and a failing note never reaches the
 * caller. A pass says nothing about a device; the build-level proof that a normal bundle carries no trace is
 * `util/checkReleaseDist.mjs`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const flag = vi.hoisted(() => ({ measure: true }))

vi.mock('../memory/measureFlag', () => ({
    get MEASURE() {
        return flag.measure
    },
}))

import { CHAT_PHASE_RING_LIMIT, noteChatSelect, noteEditConfirm, noteScriptPass, type ChatPhaseRingHandle } from '../chatPhaseRing'

type RingGlobal = { __risuChatPhases?: ChatPhaseRingHandle }

function ringOf(): ChatPhaseRingHandle | undefined {
    return (globalThis as RingGlobal).__risuChatPhases
}

beforeEach(() => {
    flag.measure = true
})

afterEach(() => {
    ringOf()?.reset()
    delete (globalThis as RingGlobal).__risuChatPhases
})

describe('chat phase ring', () => {
    test('records select points, a script pass and an edit confirm in order; snapshot copies, reset empties', () => {
        noteChatSelect('start')
        noteChatSelect('flushed')
        noteChatSelect('bumped')
        noteScriptPass('editdisplay', performance.now(), 'miss', 2, 3)
        noteEditConfirm(performance.now())
        const ring = ringOf()
        expect(ring).toBeDefined()
        const snapshot = ring!.snapshot()
        expect(snapshot.map(record => record.kind)).toEqual(['select', 'select', 'select', 'script', 'edit'])
        expect(snapshot.slice(0, 3).map(record => record.kind === 'select' ? record.point : '')).toEqual(['start', 'flushed', 'bumped'])
        const first = snapshot[0]
        expect(first.kind === 'select' && first.sinceStartMs).toBe(0)
        const script = snapshot[3]
        expect(script.kind === 'script' && { mode: script.mode, cache: script.cache, scans: script.scans, earlyRejects: script.earlyRejects })
            .toEqual({ mode: 'editdisplay', cache: 'miss', scans: 2, earlyRejects: 3 })
        if (snapshot[0].kind === 'select') {
            snapshot[0].point = 'bumped'
        }
        const again = ring!.snapshot()[0]
        expect(again.kind === 'select' && again.point).toBe('start')
        ring!.reset()
        expect(ring!.snapshot()).toEqual([])
    })

    test('later select points report the time since the start point', () => {
        noteChatSelect('start')
        noteChatSelect('bumped')
        const [start, bumped] = ringOf()!.snapshot()
        expect(start.kind === 'select' && bumped.kind === 'select' && bumped.t - start.t === bumped.sinceStartMs).toBe(true)
    })

    test('keeps only the newest entries once past the cap', () => {
        for (let index = 0; index < CHAT_PHASE_RING_LIMIT + 25; index++) {
            noteScriptPass(`m${index}`, performance.now(), 'hit', 0, 0)
        }
        const snapshot = ringOf()!.snapshot()
        expect(snapshot).toHaveLength(CHAT_PHASE_RING_LIMIT)
        const modes = snapshot.map(record => record.kind === 'script' ? record.mode : '')
        expect(modes[0]).toBe('m25')
        expect(modes[modes.length - 1]).toBe(`m${CHAT_PHASE_RING_LIMIT + 24}`)
    })

    test('a note that throws never reaches the caller', () => {
        const hostile = new Proxy({}, { set() { throw new Error('refused') } })
        expect(() => noteChatSelect('start', hostile)).not.toThrow()
        expect(() => noteScriptPass('editdisplay', 0, 'hit', 0, 0, hostile)).not.toThrow()
        expect(() => noteEditConfirm(0, hostile)).not.toThrow()
    })

    test('with the measurement flag off there is no global and nothing recorded', () => {
        flag.measure = false
        noteChatSelect('start')
        noteScriptPass('editdisplay', 0, 'hit', 0, 0)
        noteEditConfirm(0)
        expect(ringOf()).toBeUndefined()
    })
})
