// The Web Locks adapter of the single-writer claim, against a fake lock table that is exclusive, keyed
// by name and not re-entrant, and against minimal stand-ins that fail the way a storage-blocked origin
// does. The adapter never rejects and never steals.
import { afterEach, describe, expect, test } from 'vitest'
import { CLAIM_LOCK_PREFIX, createStudioClaimLocks, type ClaimLockManager } from '../studioClaimLocks'
import { createLocksWorld } from './studioLocksFake'

afterEach(() => {
    Reflect.deleteProperty(navigator, 'locks')
})

describe('T-C4 claims over the fake lock table', () => {
    test('different characters are claimed independently; the same name in a second tab is held until the holder ends', async () => {
        const world = createLocksWorld()
        const tab1 = world.createTab()
        const tab2 = world.createTab()
        const claim1 = createStudioClaimLocks(() => tab1)
        const claim2 = createStudioClaimLocks(() => tab2)

        expect(await claim1.tryClaim('X')).toBe('granted')
        expect(await claim1.tryClaim('Y')).toBe('granted')
        expect(await claim2.tryClaim('X')).toBe('held')
        expect(await claim2.tryClaim('Z')).toBe('granted')

        tab1.closeTab()
        expect(await claim2.tryClaim('X')).toBe('granted')
        expect(world.heldNames().sort()).toEqual([CLAIM_LOCK_PREFIX + 'X', CLAIM_LOCK_PREFIX + 'Z'].sort())
    })

    test('a granted lock stays held after tryClaim answers, and the request is exclusive and ifAvailable with no steal', async () => {
        const world = createLocksWorld()
        const tab = world.createTab()
        const seen: { name: string; options: unknown }[] = []
        const spying: ClaimLockManager = {
            request(name, options, callback) {
                seen.push({ name, options })
                return tab.request(name, options, callback)
            },
        }
        expect(await createStudioClaimLocks(() => spying).tryClaim('X')).toBe('granted')
        await Promise.resolve()
        expect(tab.held()).toEqual([CLAIM_LOCK_PREFIX + 'X'])
        expect(seen).toEqual([{ name: 'risuStudio.history:X', options: { mode: 'exclusive', ifAvailable: true } }])
    })

    test('the fake is not re-entrant: a second request for a name this page holds is held', async () => {
        const tab = createLocksWorld().createTab()
        const claim = createStudioClaimLocks(() => tab)
        expect(await claim.tryClaim('X')).toBe('granted')
        expect(await claim.tryClaim('X')).toBe('held')
        // Two requests in one turn: the first takes the lock, the second finds it held.
        const other = createLocksWorld().createTab()
        const both = createStudioClaimLocks(() => other)
        expect(await Promise.all([both.tryClaim('Q'), both.tryClaim('Q')])).toEqual(['granted', 'held'])
    })

    test('a page without Web Locks answers unsupported', async () => {
        const claim = createStudioClaimLocks(() => undefined)
        expect(await claim.tryClaim('X')).toBe('unsupported')
    })

    test('the default lock manager is the page navigator, read at every request', async () => {
        const claim = createStudioClaimLocks()
        expect(await claim.tryClaim('X')).toBe('unsupported')
        const tab = createLocksWorld().createTab()
        Object.defineProperty(navigator, 'locks', { value: tab, configurable: true })
        expect(await claim.tryClaim('X')).toBe('granted')
        expect(tab.requests).toEqual([CLAIM_LOCK_PREFIX + 'X'])
    })
})

describe('T-S14c a failing lock manager gives failed and never rejects', () => {
    test('a request that throws synchronously (a SecurityError) gives failed', async () => {
        const throwing: ClaimLockManager = {
            request() {
                throw new DOMException('The operation is insecure.', 'SecurityError')
            },
        }
        await expect(createStudioClaimLocks(() => throwing).tryClaim('X')).resolves.toBe('failed')
    })

    test('a request whose promise rejects before the callback runs gives failed', async () => {
        const rejecting: ClaimLockManager = {
            request() {
                return Promise.reject(new DOMException('The operation is insecure.', 'SecurityError'))
            },
        }
        await expect(createStudioClaimLocks(() => rejecting).tryClaim('X')).resolves.toBe('failed')
    })

    test('a lock manager that cannot even be read gives failed', async () => {
        const claim = createStudioClaimLocks(() => {
            throw new DOMException('The operation is insecure.', 'SecurityError')
        })
        await expect(claim.tryClaim('X')).resolves.toBe('failed')
    })

    test('a rejection after the lock was granted changes nothing: the claim stays granted', async () => {
        const lateRejecting: ClaimLockManager = {
            async request(_name, _options, callback) {
                await Promise.resolve()
                void callback({ name: 'x' })
                throw new Error('torn down')
            },
        }
        await expect(createStudioClaimLocks(() => lateRejecting).tryClaim('X')).resolves.toBe('granted')
    })
})
