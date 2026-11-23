// The IndexedDB adapter refuses a non-stored owner or record key before it opens a transaction, in
// either order of load and save.
import 'fake-indexeddb/auto'
import { IDBDatabase, IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { commitStep, createModelState, emptyRecord, type OwnerRecord } from '../historyModel'
import { characterOwnerKey, type StoredOwnerKey } from '../ownerPhase'
import { createStudioStoreIdb } from '../studioStoreIdb'

const FOREIGN = 'preset:x' as string as StoredOwnerKey

function recordFor(ownerKey: StoredOwnerKey): OwnerRecord {
    return commitStep(createModelState(emptyRecord(ownerKey, 0)), {
        id: 's1',
        at: 1,
        visitId: 'v1',
        label: { kind: 'field', field: 'desc' },
        ops: [{ op: 'set', path: 'desc', before: { had: true, value: 'a' }, after: { had: true, value: 'b' } }],
        restoreWrites: [],
        coalesceKey: null,
        replacesRestore: false,
    }).record
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe('IDB save refuses a non-stored key', () => {
    test('T-ST3 after a load: unwritable, no transaction opened by the save', async () => {
        const factory = new IDBFactory()
        const store = createStudioStoreIdb({ factory })
        await store.load(FOREIGN)
        const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction')
        expect(await store.save(FOREIGN, recordFor(FOREIGN), new Set([FOREIGN]))).toEqual({ kind: 'unwritable' })
        expect(transaction).not.toHaveBeenCalled()
    })

    test('T-ST3 without a load: unwritable, not notLoaded', async () => {
        const factory = new IDBFactory()
        const store = createStudioStoreIdb({ factory })
        const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction')
        expect(await store.save(FOREIGN, recordFor(FOREIGN), new Set([FOREIGN]))).toEqual({ kind: 'unwritable' })
        expect(transaction).not.toHaveBeenCalled()
    })

    test('T-ST3 a record naming a non-stored key under a stored owner: unwritable', async () => {
        const factory = new IDBFactory()
        const store = createStudioStoreIdb({ factory })
        const owner = characterOwnerKey('c')
        await store.load(owner)
        const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction')
        expect(await store.save(owner, recordFor(FOREIGN), new Set([owner]))).toEqual({ kind: 'unwritable' })
        expect(transaction).not.toHaveBeenCalled()
    })
})
