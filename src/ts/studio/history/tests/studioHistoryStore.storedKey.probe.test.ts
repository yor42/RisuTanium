// With the probe session kind registered: the store still reads, counts and evicts only stored keys.
// The store writes only stored owner keys. A session-kind key (or a record that names one) is refused
// `unwritable` before anything is planned or written, and a header under a session-kind prefix is
// another build's data: never read, counted or evicted.
import { describe, expect, test, vi } from 'vitest'
import { commitStep, createModelState, emptyRecord, type OwnerRecord } from '../historyModel'
import { characterOwnerKey, type StoredOwnerKey } from '../ownerPhase'
import {
    HEADER_BOUNDS,
    headerKey,
    readHeader,
    readHeaders,
    serializeHeader,
} from '../studioHistoryStore'
import { createMemoryStudioStore, keysInBounds, seedOwner, storedRecord } from './studioStoreDoubles'

vi.mock('../sessionKinds', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../sessionKinds')>()),
    SESSION_OWNER_KINDS: { probe: { setPaths: ['customModuleToggle'] } },
}))

// A registered session kind's key: still never a stored key.
const FOREIGN = 'probe:x' as string as StoredOwnerKey

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

describe('a header under a non-stored prefix is ignored', () => {
    // Producer-built: a real stored owner, copied under the foreign key by editing the header's key.
    test('T-ST4 (probe registered) readHeader and readHeaders never accept it, and eviction leaves it in place', async () => {
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
