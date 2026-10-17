// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { encodeInlayId, INLAY_META_PREFIX } from 'src/ts/process/files/inlayKeys'
import { PresenceProbeError } from 'src/ts/storage/store2/recoveryPick'
import { createPresenceProbes } from 'src/ts/storage/store2/ui/presenceProbes'

/**
 * The presence probes of a recovery pick over a recording byte store: one listing per prefix per pick, case-insensitive
 * ids, raw-key prefixes, and the typed failure and skip. Labels: new behaviour (the probes are new).
 */

const HEX = 'ab'.repeat(32)

function metaKey(id: string): string {
    return INLAY_META_PREFIX + (encodeInlayId(id) as string)
}

function storeWith(keys: readonly string[]): MemoryByteStore {
    const store = createMemoryByteStore()
    for (const key of keys) {
        store.files.set(key, new Uint8Array([1]))
    }
    return store
}

interface Deferred<T> {
    promise: Promise<T>
    resolve(value: T): void
    reject(error: Error): void
}

function deferred<T>(): Deferred<T> {
    let resolve: (value: T) => void = () => {}
    let reject: (error: Error) => void = () => {}
    const promise = new Promise<T>((done, fail) => {
        resolve = done
        reject = fail
    })
    return { promise, resolve, reject }
}

async function probeError(call: Promise<unknown>): Promise<PresenceProbeError> {
    try {
        await call
    } catch (error) {
        if (error instanceof PresenceProbeError) {
            return error
        }
        throw error
    }
    throw new Error('The probe call did not reject.')
}

describe('new behaviour: what the probes answer', () => {
    test('an asset is present when some listed name reduces to the asked key, in any letter case', async () => {
        const store = storeWith(['assets/AbC123.png', `assets/${HEX.toUpperCase()}.PNG`, 'assets/other.gif'])
        const { probes } = createPresenceProbes(store)

        const found = await probes.assetsPresent(['abc123.png', HEX, 'other.gif', 'never-listed.png'])

        expect([...found].sort()).toEqual(['abc123.png', 'other.gif', HEX].sort())
    })

    test('an asset a list names but the store does not list counts missing', async () => {
        const { probes } = createPresenceProbes(storeWith(['assets/there.png']))

        expect([...await probes.assetsPresent(['gone.png'])]).toEqual([])
    })

    test('an inlay record whose id is mixed-case is present for the lower-cased asked key', async () => {
        const { probes } = createPresenceProbes(storeWith([metaKey('Other-ID'), metaKey('ABCDEF01-0000-4000-8000-000000000000')]))

        const found = await probes.inlaysPresent([metaKey('other-id'), metaKey('abcdef01-0000-4000-8000-000000000000'), metaKey('absent-id')])

        expect([...found].sort()).toEqual([metaKey('other-id'), metaKey('abcdef01-0000-4000-8000-000000000000')].sort())
    })

    test('a record that is not the canonical form of an id is skipped, not an error', async () => {
        const { probes } = createPresenceProbes(storeWith([`${INLAY_META_PREFIX}%ZZ`, metaKey('fine')]))

        expect([...await probes.inlaysPresent([metaKey('fine')])]).toEqual([metaKey('fine')])
    })

    test('a hash-stem prefix is present when one record starts with it, whatever its extension', async () => {
        const { probes } = createPresenceProbes(storeWith([metaKey(`assets/${HEX}.png`), metaKey('assets/cd.png')]))
        const stem = (hex: string) => INLAY_META_PREFIX + (encodeInlayId(`assets/${hex}.`) as string)

        const found = await probes.inlayPrefixesPresent([stem(HEX), stem('ef'.repeat(32))])

        expect([...found]).toEqual([stem(HEX)])
    })

    test('prefixes are matched on the raw listed keys: a record stored with an upper-case stem does not satisfy the lower-case prefix', async () => {
        // A 64-digit upper-case stem has no key (its encoding is too long), so the shape is shown with a short one.
        const { probes } = createPresenceProbes(storeWith([metaKey('assets/ABC.png')]))
        const stem = INLAY_META_PREFIX + (encodeInlayId('assets/abc.') as string)

        expect([...await probes.inlayPrefixesPresent([stem])]).toEqual([])
        // The same record is present by id, which the contract compares lower-cased.
        expect([...await probes.inlaysPresent([metaKey('assets/abc.png')])]).toEqual([metaKey('assets/abc.png')])
    })
})

describe('new behaviour: one listing per prefix per pick', () => {
    test('batches and the id and prefix probes share one listing of each prefix', async () => {
        const store = storeWith(['assets/a.png', metaKey('one')])
        const { probes } = createPresenceProbes(store)

        await probes.assetsPresent(['a.png'])
        await probes.assetsPresent(['b.png'])
        await probes.assetsPresent(['c.png'])
        await probes.inlaysPresent([metaKey('one')])
        await probes.inlayPrefixesPresent([INLAY_META_PREFIX])
        await probes.inlaysPresent([metaKey('two')])

        expect(store.lists).toEqual(['assets/', INLAY_META_PREFIX])
    })

    test('concurrent calls of one prefix share the listing in flight', async () => {
        const store = storeWith(['assets/a.png'])
        const { probes } = createPresenceProbes(store)

        await Promise.all([probes.assetsPresent(['a.png']), probes.assetsPresent(['b.png'])])

        expect(store.lists).toEqual(['assets/'])
    })

    test('reset starts a new pick: the next probe lists again and answers from the store as it is now', async () => {
        const store = storeWith(['assets/a.png'])
        const probeSet = createPresenceProbes(store)
        expect([...await probeSet.probes.assetsPresent(['a.png', 'b.png'])]).toEqual(['a.png'])

        store.files.set('assets/b.png', new Uint8Array([1]))
        // Without a reset the first pick's listing still answers.
        expect([...await probeSet.probes.assetsPresent(['b.png'])]).toEqual([])
        probeSet.reset()

        expect([...await probeSet.probes.assetsPresent(['a.png', 'b.png'])].sort()).toEqual(['a.png', 'b.png'])
        expect(store.lists).toEqual(['assets/', 'assets/'])
    })
})

describe('new behaviour: a listing that fails', () => {
    test('any rejection of the listing, typed or not, becomes a list-failed probe error that carries it', async () => {
        for (const failure of [new TypeError('network down'), new SyntaxError('bad json'), new Error('plain')]) {
            const store = storeWith([])
            store.list = async () => { throw failure }
            const probeSet = createPresenceProbes(store)

            const error = await probeError(probeSet.probes.assetsPresent(['a.png']))

            expect(error.reason).toBe('list-failed')
            expect(error.cause).toBe(failure)
            expect(probeSet.cause()).toBe('list-failed')
        }
    })

    test('a listing that throws before it returns a promise is wrapped too', async () => {
        const store = storeWith([])
        store.list = () => { throw new TypeError('sync failure') }
        const probeSet = createPresenceProbes(store)

        expect((await probeError(probeSet.probes.inlaysPresent([metaKey('x')]))).reason).toBe('list-failed')
    })

    test('after the first failure no probe lists again in that pick, for either prefix', async () => {
        const store = storeWith([metaKey('one')])
        let calls = 0
        store.list = async () => { calls += 1; throw new TypeError('down') }
        const probeSet = createPresenceProbes(store)

        await probeError(probeSet.probes.assetsPresent(['a.png']))
        await probeError(probeSet.probes.assetsPresent(['b.png']))
        await probeError(probeSet.probes.inlaysPresent([metaKey('one')]))
        await probeError(probeSet.probes.inlayPrefixesPresent([INLAY_META_PREFIX]))

        expect(calls).toBe(1)
    })

    test('a failure after the images were listed ends the check at the inlays, with the first cause kept', async () => {
        const store = storeWith(['assets/a.png'])
        const list = store.list.bind(store)
        store.list = async (prefix) => {
            if (prefix === INLAY_META_PREFIX) {
                throw new TypeError('inlay listing down')
            }
            return list(prefix)
        }
        const probeSet = createPresenceProbes(store)

        expect([...await probeSet.probes.assetsPresent(['a.png'])]).toEqual(['a.png'])
        await probeError(probeSet.probes.inlaysPresent([metaKey('one')]))
        probeSet.skip()

        expect(probeSet.cause()).toBe('list-failed')
    })

    test('a defect in the reduction is not a probe error and records no cause', async () => {
        const store = storeWith([])
        // A listing that hands back something that is not a list of names: the reduction throws a TypeError of its own.
        store.list = async () => [1] as unknown as string[]
        const probeSet = createPresenceProbes(store)

        await expect(probeSet.probes.assetsPresent(['a.png'])).rejects.toBeInstanceOf(TypeError)
        expect(probeSet.cause()).toBeNull()
    })

    test('a failed listing is not cached: after a reset the next pick lists again', async () => {
        const store = storeWith(['assets/a.png'])
        const list = store.list.bind(store)
        let fail = true
        store.list = async (prefix) => {
            if (fail) {
                throw new TypeError('down')
            }
            return list(prefix)
        }
        const probeSet = createPresenceProbes(store)
        await probeError(probeSet.probes.assetsPresent(['a.png']))
        fail = false
        probeSet.reset()

        expect([...await probeSet.probes.assetsPresent(['a.png'])]).toEqual(['a.png'])
        expect(probeSet.cause()).toBeNull()
    })
})

describe('new behaviour: skipping the check', () => {
    test('a skip during a pending listing settles the pending call with a skipped probe error, and the later result changes nothing', async () => {
        const store = storeWith([])
        const gate = deferred<string[]>()
        let calls = 0
        store.list = () => { calls += 1; return gate.promise }
        const probeSet = createPresenceProbes(store)

        const pending = probeError(probeSet.probes.assetsPresent(['a.png']))
        await Promise.resolve()
        probeSet.skip()
        const error = await pending
        gate.resolve(['assets/a.png'])
        await gate.promise

        expect(error.reason).toBe('skipped')
        expect(probeSet.cause()).toBe('skipped')
        expect((await probeError(probeSet.probes.assetsPresent(['a.png']))).reason).toBe('skipped')
        expect(calls).toBe(1)
    })

    test('a skip before any probe call makes the first call throw at once, without listing', async () => {
        const store = storeWith(['assets/a.png'])
        const probeSet = createPresenceProbes(store)

        probeSet.skip()

        expect((await probeError(probeSet.probes.assetsPresent(['a.png']))).reason).toBe('skipped')
        expect((await probeError(probeSet.probes.inlaysPresent([metaKey('x')]))).reason).toBe('skipped')
        expect(store.lists).toEqual([])
        expect(probeSet.cause()).toBe('skipped')
    })

    test('the first cause wins: a skip after a failure, and a failure after a skip, keep the first', async () => {
        const failing = storeWith([])
        failing.list = async () => { throw new TypeError('down') }
        const afterFailure = createPresenceProbes(failing)
        await probeError(afterFailure.probes.assetsPresent(['a.png']))
        afterFailure.skip()
        expect(afterFailure.cause()).toBe('list-failed')

        const gate = deferred<string[]>()
        const slow = storeWith([])
        slow.list = () => gate.promise
        const afterSkip = createPresenceProbes(slow)
        const pending = probeError(afterSkip.probes.assetsPresent(['a.png']))
        await Promise.resolve()
        afterSkip.skip()
        gate.reject(new TypeError('down late'))
        await pending
        expect(afterSkip.cause()).toBe('skipped')
    })

    test('a skip in one pick does not settle the next pick: reset renews the skip signal', async () => {
        const store = storeWith(['assets/a.png'])
        const probeSet = createPresenceProbes(store)
        probeSet.skip()
        expect((await probeError(probeSet.probes.assetsPresent(['a.png']))).reason).toBe('skipped')
        expect(probeSet.cause()).toBe('skipped')

        probeSet.reset()

        expect(probeSet.cause()).toBeNull()
        expect([...await probeSet.probes.assetsPresent(['a.png'])]).toEqual(['a.png'])
        expect(probeSet.cause()).toBeNull()
    })
})

describe('new behaviour: a late listing never fills the next pick\'s cache', () => {
    test('a listing of the first pick that settles after the reset and after the second pick\'s own result is dropped', async () => {
        const store = storeWith([])
        const first = deferred<string[]>()
        const second = deferred<string[]>()
        const answers = [first, second]
        let calls = 0
        store.list = () => answers[calls++].promise
        const probeSet = createPresenceProbes(store)

        const pickOne = probeError(probeSet.probes.assetsPresent(['old.png']))
        await Promise.resolve()
        probeSet.skip()
        await pickOne
        probeSet.reset()

        const pickTwo = probeSet.probes.assetsPresent(['new.png', 'old.png'])
        await Promise.resolve()
        second.resolve(['assets/new.png'])
        expect([...await pickTwo]).toEqual(['new.png'])
        // The first pick's listing settles last, with the old store state.
        first.resolve(['assets/old.png'])
        await first.promise
        await Promise.resolve()

        expect([...await probeSet.probes.assetsPresent(['new.png', 'old.png'])]).toEqual(['new.png'])
        expect(calls).toBe(2)
    })
})
