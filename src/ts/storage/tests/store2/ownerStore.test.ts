// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { createMemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { freshOwnerId, isOwnerId, persistedOwnerId } from 'src/ts/storage/store2/owner'
import { createOwnerIdStore, OWNER_KEY } from 'src/ts/storage/store2/ownerStore'

/**
 * The Tauri owner id over the page's byte store. Labels: new behaviour (a property the store is built to have), guard
 * (passes before and after; there is no earlier store, so every case here is new behaviour).
 */

const ID = freshOwnerId()

describe('new behaviour: the owner id store', () => {
    test('the key is a plain top-level key outside the store2 prefix, so the page gate never sees it', () => {
        expect(OWNER_KEY).toBe('store2-owner')
        expect(OWNER_KEY.startsWith('store2/')).toBe(false)
        expect(OWNER_KEY).not.toBe('store2-commit')
        expect(OWNER_KEY).not.toBe('store2-fence')
    })

    test('an absent key reads as no id', async () => {
        const store = createMemoryByteStore()
        expect(await createOwnerIdStore(store).read()).toBeNull()
        expect(store.writes).toEqual([])
    })

    test('a written id is stored under the key as the id\'s own text and reads back', async () => {
        const store = createMemoryByteStore()
        const owner = createOwnerIdStore(store)
        await owner.write(ID)
        expect(store.writes).toEqual([OWNER_KEY])
        expect(new TextDecoder().decode(store.files.get(OWNER_KEY))).toBe(ID)
        expect(await owner.read()).toBe(ID)
    })

    test.each([
        ['text that is not an owner id', new TextEncoder().encode('not-an-owner-id')],
        ['an owner id with a trailing newline', new TextEncoder().encode(`${ID}\n`)],
        ['an empty value', new Uint8Array(0)],
        ['bytes that are not UTF-8', new Uint8Array([0xff, 0xfe, 0xfd])],
    ])('%s reads as no id', async (_label, bytes) => {
        const store = createMemoryByteStore()
        store.files.set(OWNER_KEY, bytes)
        expect(await createOwnerIdStore(store).read()).toBeNull()
    })

    test('a read failure of the store is the caller\'s failure, not an absent id', async () => {
        const store = createMemoryByteStore()
        store.failRead = () => new Error('the disk is gone')
        await expect(createOwnerIdStore(store).read()).rejects.toThrow('the disk is gone')
    })

    test('a failed write rejects, so no marker is started under an id a restart would not know', async () => {
        const store = createMemoryByteStore()
        store.failWrite = () => new Error('the disk is full')
        await expect(persistedOwnerId(createOwnerIdStore(store))).rejects.toThrow('the disk is full')
    })

    test('the persisted owner id is minted once and the same on the next load; a damaged value is replaced by a well-formed id', async () => {
        const store = createMemoryByteStore()
        const first = await persistedOwnerId(createOwnerIdStore(store))
        expect(isOwnerId(first)).toBe(true)
        expect(await persistedOwnerId(createOwnerIdStore(store))).toBe(first)
        expect(store.writes).toEqual([OWNER_KEY])

        store.files.set(OWNER_KEY, new TextEncoder().encode('damaged'))
        const replaced = await persistedOwnerId(createOwnerIdStore(store))
        expect(isOwnerId(replaced)).toBe(true)
        expect(replaced).not.toBe(first)
        expect(new TextDecoder().decode(store.files.get(OWNER_KEY))).toBe(replaced)
    })
})
