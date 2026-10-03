/**
 * The transitional OPFS store (`src/ts/storage/store/opfsTransitionalStore.ts`)
 * over the real `OpfsStorage` and an in-memory OPFS root: the shared
 * conformance scenarios, then what only this store does. These are conformance
 * and compatibility checks of new code; a pass against the in-memory root is no
 * evidence about a real browser's OPFS.
 *
 * Every conformance scenario applies. The conditional-write scenarios run their
 * unconditional half: OPFS keeps no version, so the store reports that it cannot
 * enforce conditions and rejects every `ifVersion`.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { OpfsStorage } from 'src/ts/storage/opfsStorage'
import { createOpfsTransitionalStore } from 'src/ts/storage/store/opfsTransitionalStore'
import { StoreUnsupportedConditionError } from 'src/ts/storage/store/errors'
import { describeByteStoreConformance } from './byteStoreConformance'
import { FakeOpfsRoot, hexName } from './fakeOpfsRoot'

vi.mock(import('src/ts/util'), () => ({
    asBuffer: (value: Uint8Array) => value,
}) as unknown as typeof import('src/ts/util'))

let root: FakeOpfsRoot

function makeStore() {
    root = new FakeOpfsRoot()
    const opfs = new OpfsStorage()
    opfs.opfs = root as unknown as FileSystemDirectoryHandle
    return createOpfsTransitionalStore(opfs)
}

describeByteStoreConformance({
    name: 'OPFS transitional',
    conditionalWrites: false,
    async create() {
        return makeStore()
    },
    async plant(key, bytes) {
        root.files.set(hexName(key), bytes.slice())
    },
    async peek(key) {
        const found = root.files.get(hexName(key))
        return found === undefined ? null : found.slice()
    },
    backendCalls: () => root?.calls ?? 0,
    invalidEverywhere: [''],
    invalidPrefixes: [''],
    writeOnlyInvalid: [],
    oddKeys: ['assets/x.v2\\smile', 'assets/.hidden'],
    failDeleteOf(key) {
        root.failRemoval.add(hexName(key))
        return () => { root.failRemoval.delete(hexName(key)) }
    },
})

describe('OPFS transitional store', () => {
    beforeEach(() => {
        makeStore()
    })

    test('a key is the hex-named file at the OPFS root that the app already uses, so an existing profile reads as it is', async () => {
        const store = makeStore()
        root.files.set(hexName('database/database.bin'), Uint8Array.from([1, 2, 3]))

        const { bytes, version } = await store.read('database/database.bin')

        expect(Array.from(bytes ?? [])).toEqual([1, 2, 3])
        expect(version).toBeNull()
        await store.write('database/dbbackup-9.bin', Uint8Array.from([4]), 'unconditional')
        expect(Array.from(root.files.get(hexName('database/dbbackup-9.bin')) ?? [])).toEqual([4])
    })

    test('a file at the root that is not a hex name, such as a cold-storage unit, is never listed as a key', async () => {
        const store = makeStore()
        root.files.set(hexName('database/dbbackup-1.bin'), Uint8Array.from([1]))
        root.files.set('coldstorage_unit.json', Uint8Array.from([2]))

        expect(await store.list('coldstorage')).toEqual([])
        expect(await store.list('database/')).toEqual(['database/dbbackup-1.bin'])
    })

    test('an ifVersion is rejected and nothing is written', async () => {
        const store = makeStore()

        await expect(store.write('database/database.bin', Uint8Array.from([1]), { ifVersion: 0 })).rejects.toBeInstanceOf(StoreUnsupportedConditionError)

        expect(root.files.size).toBe(0)
    })
})
