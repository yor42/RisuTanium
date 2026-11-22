/**
 * The registry of taken units (`../activeUnits`): a set of handles keyed by the owner's chat, and the read-only store
 * that mirrors "at least one handle is taken".
 *
 * Every test here is a guard on a new API: it has no pre-fix base. The registry is built fresh per test, so nothing
 * leaks between them; `U6` also reads the page's own instance without changing it.
 */
import { describe, test, expect } from 'vitest'
import { get, writable } from 'svelte/store'
import { activeUnits, createActiveUnits, type ActiveUnitKey } from '../activeUnits'

const A: ActiveUnitKey = { chaId: 'owner-a', chatId: 'chat-x' }
const B: ActiveUnitKey = { chaId: 'owner-b', chatId: 'chat-y' }

function emissionsOf(registry: ReturnType<typeof createActiveUnits>): boolean[] {
    const values: boolean[] = []
    registry.active.subscribe((value) => { values.push(value) })
    return values
}

describe('has', () => {
    test('U1: a unit holds a chat only when both ids match, and null holds nothing', () => {
        const registry = createActiveUnits()
        registry.unit(A).take()

        expect(registry.has(A)).toBe(true)
        expect(registry.has({ chaId: A.chaId, chatId: B.chatId })).toBe(false)
        // The same chat id under another owner is another chat.
        expect(registry.has({ chaId: B.chaId, chatId: A.chatId })).toBe(false)
        expect(registry.has(B)).toBe(false)
        expect(registry.has(null)).toBe(false)
    })
})

describe('the arithmetic of taken handles', () => {
    test('U2: today\'s registry arithmetic: handles are counted one by one, a release affects only its own handle, and the store reports exactly the transitions', () => {
        const registry = createActiveUnits()
        const values = emissionsOf(registry)

        // Two handles of one key.
        const first = registry.unit(A)
        const second = registry.unit(A)
        first.take()
        second.take()
        first.release()
        expect(registry.any()).toBe(true)
        expect(registry.has(A)).toBe(true)
        second.release()
        expect(registry.any()).toBe(false)
        expect(registry.has(A)).toBe(false)

        // Two keys.
        const left = registry.unit(A)
        const right = registry.unit(B)
        left.take()
        right.take()
        left.release()
        expect(registry.has(A)).toBe(false)
        expect(registry.has(B)).toBe(true)
        right.release()
        expect(registry.any()).toBe(false)

        // Release before take, double take, double release.
        const idle = registry.unit(A)
        idle.release()
        expect(registry.any()).toBe(false)
        const once = registry.unit(A)
        once.take()
        once.take()
        once.release()
        expect(registry.any()).toBe(false)
        once.release()
        expect(registry.any()).toBe(false)

        // A late release of a handle that never took, and of one already released, cannot clear a same-key successor.
        const never = registry.unit(A)
        const gone = registry.unit(A)
        gone.take()
        gone.release()
        const successor = registry.unit(A)
        successor.take()
        never.release()
        gone.release()
        expect(registry.any()).toBe(true)
        expect(registry.has(A)).toBe(true)
        successor.release()
        expect(registry.any()).toBe(false)

        // The store emitted only the changes: one true-false pair each for the two same-key handles, the two keys, the
        // double take, the handle released before its successor and the successor, and nothing for the no-ops.
        expect(values).toEqual([false, true, false, true, false, true, false, true, false, true, false])
    })

    test('U2: the store reports false only after the last of two handles is released', () => {
        const registry = createActiveUnits()
        const values = emissionsOf(registry)
        const first = registry.unit(A)
        const second = registry.unit(B)

        first.take()
        second.take()
        first.release()
        expect(values).toEqual([false, true])
        second.release()
        expect(values).toEqual([false, true, false])
    })
})

describe('the key is a copy of the owner\'s chat', () => {
    test('U3: changing the key object after the handle was made changes nothing, and a member is not part of the key', () => {
        const registry = createActiveUnits()
        const origin = { chaId: 'owner-a', chatId: 'chat-x' }
        const handle = registry.unit(origin)
        origin.chaId = 'moved'
        origin.chatId = 'moved-chat'
        handle.take()

        expect(registry.has({ chaId: 'owner-a', chatId: 'chat-x' })).toBe(true)
        expect(registry.has({ chaId: 'moved', chatId: 'moved-chat' })).toBe(false)

        const withMember = { chaId: 'group-1', chatId: 'group-chat', memberChaId: 'member-1' }
        registry.unit(withMember).take()
        expect(registry.has({ chaId: 'group-1', chatId: 'group-chat' })).toBe(true)
        expect(registry.has({ chaId: 'member-1', chatId: 'group-chat' })).toBe(false)
    })
})

describe('the reset', () => {
    test('U4: it notifies false, and a release of a handle from before it cannot clear a unit taken after it', () => {
        const registry = createActiveUnits()
        const values = emissionsOf(registry)
        const before = registry.unit(A)
        before.take()

        registry.resetForTests()
        expect(values).toEqual([false, true, false])
        expect(registry.any()).toBe(false)

        const after = registry.unit(A)
        after.take()
        before.release()
        expect(registry.any()).toBe(true)
        expect(registry.has(A)).toBe(true)
        after.release()
        expect(registry.any()).toBe(false)
    })
})

describe('inside another store\'s subscriber', () => {
    test('U5: after a take and after a release, the set and the store both answer with the current value', () => {
        const registry = createActiveUnits()
        const values = emissionsOf(registry)
        const outer = writable(0)
        const seen: Array<{ anyAfterTake: boolean, activeAfterTake: boolean, anyAfterRelease: boolean, activeAfterRelease: boolean }> = []
        // Subscribed before the trigger, so the queue is already in use when the callback runs.
        outer.subscribe((value) => {
            if (value !== 1) {
                return
            }
            const handle = registry.unit(A)
            handle.take()
            const anyAfterTake = registry.any()
            const activeAfterTake = get(registry.active)
            handle.release()
            seen.push({ anyAfterTake, activeAfterTake, anyAfterRelease: registry.any(), activeAfterRelease: get(registry.active) })
        })

        outer.set(1)

        expect(seen).toEqual([{ anyAfterTake: true, activeAfterTake: true, anyAfterRelease: false, activeAfterRelease: false }])
        expect(values).toEqual([false, true, false])
    })
})

describe('the store is read-only', () => {
    test.each([
        ['a fresh registry', () => createActiveUnits().active],
        ['the page\'s registry', () => activeUnits.active],
    ])('U6: %s exposes subscribe and neither set nor update', (_name, readStore) => {
        const store = readStore()

        expect(typeof store.subscribe).toBe('function')
        expect('set' in store).toBe(false)
        expect('update' in store).toBe(false)
    })
})
