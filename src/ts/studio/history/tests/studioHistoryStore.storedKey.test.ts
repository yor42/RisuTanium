// The store writes only stored owner keys. A session-kind key (or a record that names one) is refused
// `unwritable` before anything is planned or written, and a header under a session-kind prefix is
// another build's data: never read, counted or evicted.
import { describe, expect, test } from 'vitest'
import { commitStep, createModelState, emptyRecord, type OwnerRecord } from '../historyModel'
import { characterOwnerKey, type StoredOwnerKey } from '../ownerPhase'
import {
    CAP_BYTES,
    HEADER_BOUNDS,
    headerKey,
    prepareSave,
    readHeader,
    readHeaders,
    readOwnHeader,
    serializeHeader,
} from '../studioHistoryStore'
import { createMemoryStudioStore, keysInBounds, seedOwner, storedRecord } from './studioStoreDoubles'

// A key no build registers: the cast stands for another build's key reaching this store.
const FOREIGN = 'preset:x' as string as StoredOwnerKey

function recordFor(ownerKey: StoredOwnerKey, at = 1): OwnerRecord {
    const state = commitStep(createModelState(emptyRecord(ownerKey, 0)), {
        id: 's1',
        at,
        visitId: 'v1',
        label: { kind: 'field', field: 'desc' },
        ops: [{ op: 'set', path: 'desc', before: { had: true, value: 'a' }, after: { had: true, value: 'b' } }],
        restoreWrites: [],
        coalesceKey: null,
        replacesRestore: false,
    })
    return state.record
}

function prepareInput(owner: StoredOwnerKey, record: OwnerRecord) {
    return {
        owner,
        record,
        protect: new Set<StoredOwnerKey>([owner]),
        expectation: { kind: 'none' } as const,
        baseline: null,
        ownHeader: readOwnHeader(owner, undefined),
        headers: [],
        asideTaken: false,
        cap: CAP_BYTES,
        memo: new WeakMap<object, number>(),
        nextWid: () => 'w:1',
    }
}

describe('prepareSave refuses a non-stored key', () => {
    test('T-ST1 an owner key outside the stored kinds is unwritable', () => {
        const prepared = prepareSave(prepareInput(FOREIGN, recordFor(FOREIGN)))
        expect(prepared).toEqual({ kind: 'result', result: { kind: 'unwritable' } })
    })

    test('T-ST1 a record naming a non-stored key under a stored owner is unwritable', () => {
        const owner = characterOwnerKey('c')
        const prepared = prepareSave(prepareInput(owner, recordFor(FOREIGN)))
        expect(prepared).toEqual({ kind: 'result', result: { kind: 'unwritable' } })
    })

    test('T-ST1 a non-stored owner is unwritable even when the record names a stored key', () => {
        const stored = characterOwnerKey('c')
        const prepared = prepareSave(prepareInput(FOREIGN, recordFor(stored)))
        expect(prepared).toEqual({ kind: 'result', result: { kind: 'unwritable' } })
    })

    test('a stored owner still plans a write', () => {
        const owner = characterOwnerKey('c')
        expect(prepareSave(prepareInput(owner, recordFor(owner))).kind).toBe('write')
    })
})

describe('the store double refuses a non-stored key', () => {
    test('T-ST2 load then save answers unwritable and writes nothing', async () => {
        const store = createMemoryStudioStore()
        await store.load(FOREIGN)
        const result = await store.save(FOREIGN, recordFor(FOREIGN), new Set([FOREIGN]))
        expect(result).toEqual({ kind: 'unwritable' })
        expect([...store.shared.keys()]).toEqual([])
        expect(store.writes).toEqual([])
    })
})

describe('a header under a non-stored prefix is ignored', () => {
    // Producer-built: a real stored owner, copied under the foreign key by editing the header's key.
    test('T-ST4 readHeader and readHeaders never accept it, and eviction leaves it in place', async () => {
        const shared = new Map<string, string>()
        const old = characterOwnerKey('old')
        seedOwner(shared, recordFor(old, 1), 'w:seed')
        const oldHeader = shared.get(headerKey(old)) as string
        const parsed = readHeader(oldHeader)
        expect(parsed).not.toBeNull()
        const foreignHeader = serializeHeader({ ...parsed!, ownerKey: FOREIGN, touchedAt: 0, size: 400 })
        shared.set(headerKey(FOREIGN), foreignHeader)

        expect(readHeader(foreignHeader)).toBeNull()
        const keys = keysInBounds(shared, HEADER_BOUNDS)
        const read = readHeaders(keys, keys.map((key) => shared.get(key)))
        expect(read.headers.map((header) => header.ownerKey)).toEqual([old])

        const store = createMemoryStudioStore({ shared, capBytes: 1200 })
        const fresh = characterOwnerKey('fresh')
        await store.load(fresh)
        expect(await store.save(fresh, recordFor(fresh, 5), new Set([fresh]))).toMatchObject({ kind: 'ok' })
        expect(shared.get(headerKey(FOREIGN))).toBe(foreignHeader)
        expect(storedRecord(shared, fresh)).not.toBeNull()
    })
})
