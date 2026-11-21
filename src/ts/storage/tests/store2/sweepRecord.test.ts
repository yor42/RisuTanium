// @vitest-environment node
/**
 * The age record through the page's byte store (`store2/sweep/record.ts`): every state a read reports, the round trip of the
 * real unit encoder, and the rule that a write touches only `store2-sweep`.
 *
 * Stand-ins: a memory byte store for the states and the round trip. A pass is no evidence about a real desktop or Node store.
 *
 * The module does not exist on the base, so a failure at import there proves nothing; each test is a guard that a mutant of
 * the rule it pins (a too-new record read as absent, a damaged record read as ok) turns red.
 */
import { describe, expect, test } from 'vitest'
import { createMemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { SWEEP_KEY, UNIT_TYPE, encodeUnit, type SweepRecord } from 'src/ts/storage/store2/format'
import { readSweepRecord, writeSweepRecord } from 'src/ts/storage/store2/sweep'

const RECORD: SweepRecord = { v: 1, at: 1_900_000_000_000, items: [['a.png', null], ['b.png', null]] }

describe('readSweepRecord over a memory byte store', () => {
    test('an absent key is absent', async () => {
        expect(await readSweepRecord(createMemoryByteStore())).toEqual({ status: 'absent' })
    })

    test('a record the encoder produced reads back as ok with the same body', async () => {
        const store = createMemoryByteStore()
        store.files.set(SWEEP_KEY, encodeUnit(UNIT_TYPE.sweepRecord, RECORD))

        expect(await readSweepRecord(store)).toEqual({ status: 'ok', value: RECORD })
    })

    test('bytes that are no unit, and a unit of another type, are unreadable and never ok', async () => {
        const store = createMemoryByteStore()
        store.files.set(SWEEP_KEY, new Uint8Array([9, 9, 9]))
        expect(await readSweepRecord(store)).toEqual({ status: 'unreadable' })

        store.files.set(SWEEP_KEY, encodeUnit(UNIT_TYPE.commit, { v: 1 }))
        expect(await readSweepRecord(store)).toEqual({ status: 'unreadable' })
    })

    test('a record of a newer version is too-new, not absent and not unreadable', async () => {
        const store = createMemoryByteStore()
        store.files.set(SWEEP_KEY, encodeUnit(UNIT_TYPE.sweepRecord, { v: 2, at: 1, items: [] }))

        expect(await readSweepRecord(store)).toEqual({ status: 'too-new' })
    })

    test('a store whose read fails is io-failed, which is not absent', async () => {
        const store = createMemoryByteStore()
        store.failRead = () => new Error('read failed')

        expect(await readSweepRecord(store)).toEqual({ status: 'io-failed' })
    })
})

describe('writeSweepRecord', () => {
    test('writes only the record key, unconditionally, and the bytes read back', async () => {
        const store = createMemoryByteStore()

        await writeSweepRecord(store, RECORD)

        expect(store.writes).toEqual([SWEEP_KEY])
        expect(store.deletes).toEqual([])
        expect(await readSweepRecord(store)).toEqual({ status: 'ok', value: RECORD })
    })

    test('a record with an unknown extra field and an extra tuple element keeps them across a rewrite of what was read', async () => {
        const store = createMemoryByteStore()
        store.files.set(SWEEP_KEY, encodeUnit(UNIT_TYPE.sweepRecord, { v: 1, at: 5, items: [['a.png', null, 'future']], later: 'x' }))

        const read = await readSweepRecord(store)
        if (read.status !== 'ok') {
            throw new Error('The record must read ok.')
        }
        await writeSweepRecord(store, read.value)

        expect(await readSweepRecord(store)).toEqual(read)
    })
})
