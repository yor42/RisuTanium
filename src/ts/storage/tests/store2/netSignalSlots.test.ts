import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { classifyChange, ensureInstalled, noteSignal, resetNetSignalsForTest } from '../../netSignalMeter'
import {
    noteNetSlotBegin, noteNetSlotEnd, noteNetSlotMs, noteSignalAck, noteSignalAdopted, noteSignalKept, noteSignalPassStart,
    noteSignalResidents, noteSignalSlotClock, noteSignalUnchanged, noteSignalVerdict, startSavePass,
    type NetVerdictOutcome, type SavePassMeterHandle,
} from '../../store2/savePassMeter'

/**
 * CHORE-205 counter experiment: the signal slot records and the ack ring of the save-pass meter. The meter reaches the
 * signal counters only through `globalThis.__risuNetSignals`; these tests drive the meter's functions the way the idle
 * net does, with the handle installed and absent. Labels: guard (passes with the handle present or absent unless the
 * record shape breaks), reproducer (fails if the named behaviour is removed).
 */

const SWITCH_KEY = 'risu-measure-savepass'

function meterOf(): SavePassMeterHandle {
    const found = (globalThis as { __risuSavePassMeter?: SavePassMeterHandle }).__risuSavePassMeter
    if (found === undefined) {
        throw new Error('The meter handle is not installed.')
    }
    return found
}

function withSignals(selected: string | null = 'SEL'): void {
    ensureInstalled(() => selected)
}

/** One slot as the loop drives it: begin, residents, an optional verdict, the end reason and the close. */
function runSlot(options: {
    chaId?: string, outcome?: NetVerdictOutcome, endAt?: number | null, residents?: number, clock?: [number, number], reason?: 'verdictDirty' | 'verdictClean' | 'noResident'
} = {}): void {
    noteNetSlotBegin()
    if (options.residents !== undefined) {
        noteSignalResidents(options.residents)
    }
    if (options.chaId !== undefined && options.outcome !== undefined) {
        noteSignalVerdict(options.chaId, options.outcome, options.endAt === undefined ? 500 : options.endAt)
    }
    noteNetSlotEnd(options.reason ?? 'verdictClean', options.outcome ?? null)
    const [start, end] = options.clock ?? [100, 520]
    noteSignalSlotClock(start, end)
    noteNetSlotMs(end - start)
}

beforeEach(() => {
    localStorage.clear()
    localStorage.setItem(SWITCH_KEY, 'on')
    resetNetSignalsForTest()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    startSavePass()
    meterOf().reset()
})

afterEach(() => {
    meterOf().reset()
    vi.restoreAllMocks()
    resetNetSignalsForTest()
    localStorage.clear()
    delete (globalThis as { __risuSavePassMeter?: SavePassMeterHandle }).__risuSavePassMeter
})

describe('the signal slot record', () => {
    test('a dirty verdict carries the slot context and the counters copied at the verdict instant', () => {
        withSignals('SEL')
        noteSignal('api', 'A')
        noteSignal('part', 'A')
        runSlot({ chaId: 'A', outcome: 'dirty', residents: 3, reason: 'verdictDirty' })
        const [record] = meterOf().signalSlots()
        expect(record).toMatchObject({
            seq: 1, at: 100, endAt: 500, reason: 'verdictDirty', decisionMs: 420, chaId: 'A', outcome: 'dirty', residents: 3,
            residentsDelta: null, dirtyRun: 1, selectedChaId: 'SEL', lateAt: null, watchRefused: false, commits: 0, inFlightKinds: [],
        })
        expect(record.signals?.api.n).toBe(1)
        expect(record.signals?.part.n).toBe(1)
        expect(record.signals?.identity.n).toBe(0)
        expect(record.signalGlobals).toMatchObject({ partGlobal: 0 })
    })

    test('an event after endAt leaves the stored counters unchanged (the record holds copies)', () => {
        withSignals()
        const now = vi.spyOn(performance, 'now')
        now.mockReturnValue(300)
        noteSignal('api', 'A')
        runSlot({ chaId: 'A', outcome: 'dirty', residents: 1, reason: 'verdictDirty' })
        now.mockReturnValue(900)
        noteSignal('api', 'A')
        classifyChange(true)
        const [record] = meterOf().signalSlots()
        expect(record.signals?.api).toEqual({ n: 1, lastAt: 300 })
        expect(record.signalGlobals?.partGlobal).toBe(0)
    })

    test('a dirty slot is marked late by a signal for its character within 10 s of endAt, once', () => {
        withSignals()
        const now = vi.spyOn(performance, 'now')
        now.mockReturnValue(600)
        runSlot({ chaId: 'A', outcome: 'dirty', reason: 'verdictDirty' })
        now.mockReturnValue(700)
        noteSignal('part', 'B')
        expect(meterOf().signalSlots()[0].lateAt).toBeNull()
        now.mockReturnValue(5000)
        noteSignal('part', 'A')
        now.mockReturnValue(6000)
        noteSignal('part', 'A')
        expect(meterOf().signalSlots()[0].lateAt).toBe(5000)
    })

    test('a signal later than 10 s after endAt does not mark the slot late', () => {
        withSignals()
        const now = vi.spyOn(performance, 'now')
        now.mockReturnValue(600)
        runSlot({ chaId: 'A', outcome: 'dirty', endAt: 500, reason: 'verdictDirty' })
        now.mockReturnValue(10501)
        noteSignal('part', 'A')
        expect(meterOf().signalSlots()[0].lateAt).toBeNull()
    })

    test('a clean slot registers no late check', () => {
        withSignals()
        runSlot({ chaId: 'A', outcome: 'clean' })
        noteSignal('part', 'A')
        expect(meterOf().signalSlots()[0].lateAt).toBeNull()
    })

    test('a dirty slot whose late check the cap refused says so', () => {
        withSignals()
        const signals = (globalThis as { __risuNetSignals?: { watch(chaId: string, untilMs: number, cb: () => void): boolean } }).__risuNetSignals
        for (let i = 0; i < 64; i++) {
            signals?.watch(`W${i}`, Number.MAX_SAFE_INTEGER, () => {})
        }
        runSlot({ chaId: 'A', outcome: 'dirty', reason: 'verdictDirty' })
        expect(meterOf().signalSlots()[0].watchRefused).toBe(true)
    })

    test('a slot that left before a verdict uses the decision end, has no character and still copies the globals', () => {
        withSignals()
        runSlot({ residents: 0, reason: 'noResident', clock: [200, 260] })
        const [record] = meterOf().signalSlots()
        expect(record).toMatchObject({ endAt: 260, at: 200, chaId: null, outcome: null, signals: null, residents: 0, reason: 'noResident' })
        expect(record.signalGlobals).not.toBeNull()
    })

    test('an unsavable or missing resident notes its character with no instant: counters are copied at the decision end', () => {
        withSignals()
        noteSignal('api', 'A')
        runSlot({ chaId: 'A', outcome: 'unknown', endAt: null, clock: [200, 260], reason: 'verdictClean' })
        const [record] = meterOf().signalSlots()
        expect(record).toMatchObject({ chaId: 'A', outcome: 'unknown', endAt: 260, dirtyRun: 0 })
        expect(record.signals?.api.n).toBe(1)
    })

    test('dirtyRun counts consecutive dirty verdicts per character; a clean verdict resets it; residentsDelta follows the resident count', () => {
        withSignals()
        runSlot({ chaId: 'A', outcome: 'dirty', residents: 4, reason: 'verdictDirty' })
        runSlot({ chaId: 'B', outcome: 'dirty', residents: 4, reason: 'verdictDirty' })
        runSlot({ chaId: 'A', outcome: 'dirty', residents: 5, reason: 'verdictDirty' })
        runSlot({ chaId: 'A', outcome: 'clean', residents: 5 })
        runSlot({ chaId: 'A', outcome: 'dirty', residents: 3, reason: 'verdictDirty' })
        const records = meterOf().signalSlots()
        expect(records.map(record => record.dirtyRun)).toEqual([1, 1, 2, 0, 1])
        expect(records.map(record => record.residentsDelta)).toEqual([null, 0, 1, 0, -2])
        expect(records.map(record => record.seq)).toEqual([1, 2, 3, 4, 5])
    })

    test('the ring keeps the newest 1500 records in order', () => {
        withSignals()
        for (let i = 0; i < 1503; i++) {
            runSlot({ chaId: 'A', outcome: 'clean' })
        }
        const records = meterOf().signalSlots()
        expect(records).toHaveLength(1500)
        expect(records[0].seq).toBe(4)
        expect(records[1499].seq).toBe(1503)
    })

    test('the accessor returns copies: changing one does not change the ring', () => {
        withSignals()
        runSlot({ chaId: 'A', outcome: 'clean' })
        meterOf().signalSlots()[0].chaId = 'tampered'
        expect(meterOf().signalSlots()[0].chaId).toBe('A')
    })
})

describe('without the signal handle', () => {
    test('the record carries null signal fields and nothing throws', () => {
        expect(() => runSlot({ chaId: 'A', outcome: 'dirty', residents: 2, reason: 'verdictDirty' })).not.toThrow()
        const [record] = meterOf().signalSlots()
        expect(record).toMatchObject({
            chaId: 'A', outcome: 'dirty', residents: 2, signals: null, signalGlobals: null, inFlightKinds: null, selectedChaId: null,
            lateAt: null, watchRefused: false,
        })
        expect(() => noteSignalPassStart()).not.toThrow()
        expect(() => noteSignalAck(['A'])).not.toThrow()
    })

    test('a throwing handle method never escapes the meter', () => {
        const broken = {
            signals: () => { throw new Error('signals') }, globals: () => { throw new Error('globals') }, watch: () => { throw new Error('watch') },
            inFlightKinds: () => { throw new Error('kinds') }, selected: () => { throw new Error('selected') },
            dump: () => { throw new Error('dump') }, reset: () => { throw new Error('reset') },
        }
        ;(globalThis as { __risuNetSignals?: unknown }).__risuNetSignals = broken
        try {
            expect(() => runSlot({ chaId: 'A', outcome: 'dirty', reason: 'verdictDirty' })).not.toThrow()
            expect(meterOf().signalSlots()[0]).toMatchObject({ chaId: 'A', signals: null, signalGlobals: null, watchRefused: true })
            expect(() => meterOf().reset()).not.toThrow()
        } finally {
            delete (globalThis as { __risuNetSignals?: unknown }).__risuNetSignals
        }
    })
})

describe('the switch', () => {
    test('a slot begun with the switch off records nothing', () => {
        withSignals()
        localStorage.setItem(SWITCH_KEY, 'off')
        runSlot({ chaId: 'A', outcome: 'clean' })
        expect(meterOf().signalSlots()).toEqual([])
    })

    test('no ack is noted with the switch off', () => {
        localStorage.setItem(SWITCH_KEY, 'off')
        noteSignalPassStart()
        noteSignalAck(['A'])
        expect(meterOf().signalAcks()).toEqual([])
    })
})

describe('the ack ring', () => {
    test('a commit books an ack with the pass start and the encoded set, and counts a commit', () => {
        withSignals()
        const now = vi.spyOn(performance, 'now')
        now.mockReturnValue(1000)
        noteSignalPassStart()
        now.mockReturnValue(1800)
        noteSignalAck(['A', 'B'])
        expect(meterOf().signalAcks()).toEqual([{ kind: 'ack', passStartAt: 1000, ackAt: 1800, chaIds: ['A', 'B'] }])
        runSlot({ chaId: 'A', outcome: 'clean' })
        expect(meterOf().signalSlots()[0].commits).toBe(1)
    })

    test('an unchanged pass books the implicit clean point of its encoded set', () => {
        withSignals()
        noteSignalPassStart()
        noteSignalUnchanged(['A'])
        expect(meterOf().signalAcks().map(entry => [entry.kind, entry.chaIds])).toEqual([['unchanged', ['A']]])
    })

    test('an adoption books the kept pass start and set, once', () => {
        withSignals()
        const now = vi.spyOn(performance, 'now')
        now.mockReturnValue(2000)
        noteSignalPassStart()
        noteSignalKept(['A'])
        now.mockReturnValue(2500)
        noteSignalPassStart()
        noteSignalAdopted()
        noteSignalAdopted()
        expect(meterOf().signalAcks().map(entry => [entry.kind, entry.passStartAt, entry.chaIds])).toEqual([['adopted', 2000, ['A']]])
    })

    test('a later commit drops the kept attempt: a following adoption books nothing', () => {
        withSignals()
        noteSignalPassStart()
        noteSignalKept(['A'])
        noteSignalPassStart()
        noteSignalAck(['B'])
        noteSignalAdopted()
        expect(meterOf().signalAcks().map(entry => entry.kind)).toEqual(['ack'])
    })

    test('the ring keeps the newest 500 entries and returns copies', () => {
        withSignals()
        noteSignalPassStart()
        for (let i = 0; i < 503; i++) {
            noteSignalAck([`c${i}`])
        }
        const acks = meterOf().signalAcks()
        expect(acks).toHaveLength(500)
        expect(acks[0].chaIds).toEqual(['c3'])
        acks[0].chaIds.push('tampered')
        expect(meterOf().signalAcks()[0].chaIds).toEqual(['c3'])
    })
})

describe('reset', () => {
    test('clears the slot ring, the ack ring and the counters of the handle', () => {
        withSignals()
        noteSignal('api', 'A')
        noteSignalPassStart()
        noteSignalAck(['A'])
        runSlot({ chaId: 'A', outcome: 'dirty', residents: 2, reason: 'verdictDirty' })
        meterOf().reset()
        expect(meterOf().signalSlots()).toEqual([])
        expect(meterOf().signalAcks()).toEqual([])
        runSlot({ chaId: 'A', outcome: 'clean', residents: 5 })
        const [record] = meterOf().signalSlots()
        expect(record).toMatchObject({ seq: 1, commits: 0, residentsDelta: null, dirtyRun: 0 })
        expect(record.signals).toEqual({ api: { n: 0, lastAt: 0 }, identity: { n: 0, lastAt: 0 }, part: { n: 0, lastAt: 0 } })
    })
})
