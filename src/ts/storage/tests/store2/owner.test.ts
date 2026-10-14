// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { decideClear, freshOwnerId, isOwnerId, isOwnMarker, persistedOwnerId, type OwnerIdStore, type Staging } from 'src/ts/storage/store2/owner'

const MARKER: Staging = { owner: 'a'.repeat(26), prefix: 'store2/g-0000000000000000-', startedAt: 1, label: 'bulk' }

function memoryStore(initial: string | null): OwnerIdStore & { value: string | null, writes: number } {
    const store = {
        value: initial,
        writes: 0,
        read: async () => store.value,
        write: async (id: string) => {
            store.writes++
            store.value = id
        },
    }
    return store
}

describe('owner id', () => {
    test('a fresh id is 26 digits of 0-9a-v and differs per call', () => {
        const ids = new Set(Array.from({ length: 20 }, () => freshOwnerId()))
        expect(ids.size).toBe(20)
        for (const id of ids) {
            expect(isOwnerId(id)).toBe(true)
        }
        expect(isOwnerId('A'.repeat(26))).toBe(false)
        expect(isOwnerId('a'.repeat(25))).toBe(false)
    })

    test('a persisted id is written once and read back on every later start', async () => {
        const store = memoryStore(null)
        const first = await persistedOwnerId(store)
        const second = await persistedOwnerId(store)
        expect(second).toBe(first)
        expect(store.writes).toBe(1)
    })

    test('a stored value that is not an owner id is replaced', async () => {
        const store = memoryStore('not an id')
        const id = await persistedOwnerId(store)
        expect(isOwnerId(id)).toBe(true)
        expect(store.value).toBe(id)
    })

    test('a failed write rejects instead of returning an id a restart would not know', async () => {
        const store: OwnerIdStore = { read: async () => null, write: async () => { throw new Error('disk full') } }
        await expect(persistedOwnerId(store)).rejects.toThrow('disk full')
    })
})

describe('decideClear', () => {
    test('no marker is nothing to clear', async () => {
        expect(await decideClear('x', null, async () => true)).toEqual({ decision: 'none' })
    })

    test('an own marker clears without asking', async () => {
        let asked = 0
        const decision = await decideClear(MARKER.owner, MARKER, async () => {
            asked++
            return false
        })
        expect(decision).toEqual({ decision: 'clear', marker: MARKER, own: true })
        expect(asked).toBe(0)
        expect(isOwnMarker(MARKER.owner, MARKER)).toBe(true)
    })

    test('a foreign marker clears only on a yes; a no or a missing hook leaves it', async () => {
        expect(await decideClear('b'.repeat(26), MARKER, async () => true)).toEqual({ decision: 'clear', marker: MARKER, own: false })
        expect(await decideClear('b'.repeat(26), MARKER, async () => false)).toEqual({ decision: 'leave', marker: MARKER })
        expect(await decideClear('b'.repeat(26), MARKER, null)).toEqual({ decision: 'leave', marker: MARKER })
    })
})
