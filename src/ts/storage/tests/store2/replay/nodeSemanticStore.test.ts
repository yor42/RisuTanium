// @vitest-environment node
/**
 * The node-semantics fake (`nodeSemanticStore.ts`) pinned to the real
 * `server/node/server.cjs`. The shared byte-store conformance runs against both
 * in this file; differential cases then run the same script against each and
 * require the same answer; `createNodeBackend` runs unchanged over the fake. When
 * the fake and the real server disagree the fake is wrong: the expectations are
 * the real server's.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { createNodeBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { COMMIT_KEY } from 'src/ts/storage/store2/format/keys'
import type { ByteStore, DeleteEntry } from 'src/ts/storage/store/contract'
import {
    StoreCheckListTooLongError,
    StoreOutcomeUnknownError,
    StoreVersionConflictError,
} from 'src/ts/storage/store/errors'
import { createNodeHttpStore, type FetchLike } from 'src/ts/storage/store/nodeHttpStore'
import { describeByteStoreConformance } from '../../byteStoreConformance'
import { hexOfKey, startNodeServer, type NodeServerFixture } from '../../nodeServerFixture'
import { bytesOf, runBackendConformance, unit, unitKey } from '../backendConformance'
import { createNodeSemanticStore, type LostReplyOperation, type NodeSemanticOptions, type NodeSemanticStore } from './nodeSemanticStore'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let fixture: NodeServerFixture
let realRequests = 0
const realLoss = new Map<LostReplyOperation, number>()

const ROUTE_OF: Record<LostReplyOperation, string> = {
    'write': '/api/write',
    'remove': '/api/remove',
    'write-checked': '/api/write-checked',
    'remove-checked': '/api/remove-checked',
}

/** Counts every request and, for a route with a loss pending, lets the server apply it and then drops the connection. */
const realFetch: FetchLike = async (url, init) => {
    realRequests++
    const path = new URL(url).pathname
    const pending = (Object.keys(ROUTE_OF) as LostReplyOperation[]).find((operation) => ROUTE_OF[operation] === path && (realLoss.get(operation) ?? 0) > 0)
    if (pending === undefined) {
        return fetch(url, init)
    }
    realLoss.set(pending, (realLoss.get(pending) ?? 0) - 1)
    await (await fetch(url, init)).arrayBuffer()
    throw new TypeError('fetch failed')
}

type StoreLimits = Pick<NodeSemanticOptions, 'maxCheckOnlyKeys' | 'guardedHeaderBytes'>

function makeRealStore(limits: StoreLimits = {}): ByteStore {
    return createNodeHttpStore({ baseUrl: fixture.baseUrl, authHeader: () => fixture.authHeader(), fetch: realFetch, ...limits })
}

beforeAll(async () => {
    fixture = await startNodeServer()
})

afterAll(async () => {
    await fixture?.stop()
})

describe('conformance: the fake and the real server run the same byte-store scenarios', () => {
    let current: NodeSemanticStore

    describeByteStoreConformance({
        name: 'node semantic fake',
        conditionalWrites: true,
        async create() {
            current = createNodeSemanticStore()
            return current.store
        },
        async plant(key, value) {
            current.plant(key, value)
        },
        async peek(key) {
            return current.peek(key).bytes
        },
        backendCalls: () => current.log.length,
        invalidEverywhere: ['', 'a\uD800b'],
        invalidPrefixes: ['', 'a\uD800'],
        writeOnlyInvalid: [`k/${'x'.repeat(116)}`],
        oddKeys: ['assets/x.v2\\smile', 'assets/x.jpg\u0001'],
        offersGuarded: true,
    })

    describeByteStoreConformance({
        name: 'real Node server',
        conditionalWrites: true,
        async create() {
            await fixture.clearKeys()
            return makeRealStore()
        },
        async plant(key, value) {
            await writeFile(join(fixture.saveDir, hexOfKey(key)), value)
        },
        async peek(key) {
            try {
                return new Uint8Array(await readFile(join(fixture.saveDir, hexOfKey(key))))
            } catch {
                return null
            }
        },
        backendCalls: () => realRequests,
        invalidEverywhere: ['', 'a\uD800b'],
        invalidPrefixes: ['', 'a\uD800'],
        writeOnlyInvalid: [`k/${'x'.repeat(116)}`],
        oddKeys: ['assets/x.v2\\smile', 'assets/x.jpg\u0001'],
        offersGuarded: true,
    })
})

/** A store under test, fake or real, with the means to lose a reply and read the stored state. */
interface Subject {
    store: ByteStore
    backend: Store2Backend
    loseReply(operation: LostReplyOperation, times?: number): void
}

function fakeSubject(options: NodeSemanticOptions = {}): Subject {
    const fake = createNodeSemanticStore(options)
    return { store: fake.store, backend: createNodeBackend(fake.store), loseReply: (operation, times) => fake.loseReply(operation, times) }
}

function realSubject(limits: StoreLimits = {}): Subject {
    const store = makeRealStore(limits)
    return {
        store,
        backend: createNodeBackend(store),
        loseReply: (operation, times = 1) => realLoss.set(operation, (realLoss.get(operation) ?? 0) + times),
    }
}

const SUBJECTS: Array<[string, () => Subject]> = [['fake', () => fakeSubject()], ['real server', () => realSubject()]]

/** Fresh key names for one scenario run; labels stand in for them in what a scenario reports, so the two runs compare. */
class Names {
    private static counter = 1_000_000
    private readonly labels = new Map<string, string>()

    unit(label: string): string {
        return this.name(`store2/u-${(Names.counter++).toString(32).padStart(26, '0')}`, label)
    }

    plain(label: string): string {
        return this.name(`differential/${Names.counter++}-${label}`, label)
    }

    private name(key: string, label: string): string {
        this.labels.set(key, label)
        return key
    }

    labelOf(key: string): string {
        return this.labels.get(key) ?? key
    }
}

async function stateOf(store: ByteStore, names: Names, keys: readonly string[]): Promise<Record<string, { bytes: number[] | null, revision: number | null }>> {
    const out: Record<string, { bytes: number[] | null, revision: number | null }> = {}
    for (const key of keys) {
        const read = await store.read(key)
        out[names.labelOf(key)] = { bytes: read.bytes === null ? null : [...read.bytes], revision: read.version }
    }
    return out
}

/** What a client sees of a failure, with key names replaced by labels. */
function describeError(error: unknown, names: Names): Record<string, unknown> {
    if (error instanceof StoreVersionConflictError) {
        return { name: 'StoreVersionConflictError', key: names.labelOf(error.key), currentVersion: error.currentVersion }
    }
    if (error instanceof StoreOutcomeUnknownError) {
        return { name: 'StoreOutcomeUnknownError', operation: error.operation }
    }
    if (error instanceof StoreCheckListTooLongError) {
        return { name: 'StoreCheckListTooLongError', keyCount: error.keyCount, sent: error.sent, mayHaveApplied: error.mayHaveApplied }
    }
    return { name: error instanceof Error ? error.constructor.name : typeof error }
}

async function attempt(names: Names, run: () => Promise<unknown>): Promise<Record<string, unknown> | 'ok'> {
    try {
        await run()
        return 'ok'
    } catch (error) {
        return describeError(error, names)
    }
}

interface Observation {
    outcome: Record<string, unknown> | 'ok'
    after: Record<string, { bytes: number[] | null, revision: number | null }>
}

/** Runs `scenario` against the fake and against the real server and requires the same observation; returns it for the expectations that make the case non-vacuous. */
async function differ(scenario: (subject: Subject, names: Names) => Promise<Observation>): Promise<Observation> {
    const fake = await scenario(fakeSubject(), new Names())
    const real = await scenario(realSubject(), new Names())
    expect(fake).toEqual(real)
    return real
}

describe('differential: which conflict is reported first when several conditions fail', () => {
    test('a write names its own key before a stale check-only key', async () => {
        const seen = await differ(async ({ store }, names) => {
            const own = names.plain('own')
            const other = names.plain('other')
            await store.write(own, bytesOf(1), 'unconditional')
            await store.write(own, bytesOf(2), 'unconditional')
            await store.write(other, bytesOf(1), 'unconditional')
            const outcome = await attempt(names, () => store.guarded!.writeChecked(own, bytesOf(9), { ifVersion: 1 }, [{ key: other, version: 7 }]))
            return { outcome, after: await stateOf(store, names, [own, other]) }
        })
        expect(seen.outcome).toEqual({ name: 'StoreVersionConflictError', key: 'own', currentVersion: 2 })
        expect(seen.after.own.bytes).toEqual([2])
    })

    test('a write names the first stale check-only key in list order', async () => {
        const seen = await differ(async ({ store }, names) => {
            const target = names.plain('target')
            const first = names.plain('first')
            const second = names.plain('second')
            await store.write(first, bytesOf(1), 'unconditional')
            await store.write(second, bytesOf(1), 'unconditional')
            await store.write(second, bytesOf(2), 'unconditional')
            const outcome = await attempt(names, () => store.guarded!.writeChecked(target, bytesOf(9), { ifVersion: 0 }, [{ key: second, version: 1 }, { key: first, version: 5 }]))
            return { outcome, after: await stateOf(store, names, [target, first, second]) }
        })
        expect(seen.outcome).toEqual({ name: 'StoreVersionConflictError', key: 'second', currentVersion: 2 })
        expect(seen.after.target.bytes).toBeNull()
    })

    test.each([
        ['removeChecked', 'plain'],
        ['retireChecked', 'unit'],
    ] as const)('%s names the first stale own key in list order, before a stale check-only key, and removes nothing', async (method, kind) => {
        const seen = await differ(async ({ store }, names) => {
            const make = (label: string) => kind === 'unit' ? names.unit(label) : names.plain(label)
            const early = make('early')
            const late = make('late')
            const guard = names.plain('guard')
            for (const key of [early, late, guard]) {
                await store.write(key, bytesOf(1), 'unconditional')
            }
            const entries: DeleteEntry[] = [{ key: late, condition: { ifVersion: 0 } }, { key: early, condition: { ifVersion: 0 } }]
            const outcome = await attempt(names, () => store.guarded![method](entries, [{ key: guard, version: 9 }]))
            return { outcome, after: await stateOf(store, names, [early, late, guard]) }
        })
        expect(seen.outcome).toEqual({ name: 'StoreVersionConflictError', key: 'late', currentVersion: 1 })
        expect(seen.after.early.bytes).toEqual([1])
        expect(seen.after.late.bytes).toEqual([1])
    })

    test.each([
        ['removeChecked', 'plain'],
        ['retireChecked', 'unit'],
    ] as const)('%s names the first stale check-only key in list order when its own keys match', async (method, kind) => {
        const seen = await differ(async ({ store }, names) => {
            const victim = kind === 'unit' ? names.unit('victim') : names.plain('victim')
            const first = names.plain('first')
            const second = names.plain('second')
            for (const key of [victim, first, second]) {
                await store.write(key, bytesOf(1), 'unconditional')
            }
            const outcome = await attempt(names, () => store.guarded![method]([{ key: victim, condition: { ifVersion: 1 } }], [{ key: second, version: 4 }, { key: first, version: 4 }]))
            return { outcome, after: await stateOf(store, names, [victim, first, second]) }
        })
        expect(seen.outcome).toEqual({ name: 'StoreVersionConflictError', key: 'second', currentVersion: 1 })
        expect(seen.after.victim.bytes).toEqual([1])
    })

    test('a request whose conditions all hold applies: a removal leaves a tombstone, a retire forgets the key', async () => {
        const seen = await differ(async ({ store }, names) => {
            const removed = names.plain('removed')
            const retired = names.unit('retired')
            const guard = names.plain('guard')
            for (const key of [removed, retired, guard]) {
                await store.write(key, bytesOf(1), 'unconditional')
            }
            await store.guarded!.removeChecked([{ key: removed, condition: { ifVersion: 1 } }], [{ key: guard, version: 1 }])
            await store.guarded!.retireChecked([{ key: retired, condition: { ifVersion: 1 } }], [{ key: guard, version: 1 }])
            return { outcome: 'ok', after: await stateOf(store, names, [removed, retired, guard]) }
        })
        expect(seen.after.removed).toEqual({ bytes: null, revision: 2 })
        expect(seen.after.retired).toEqual({ bytes: null, revision: 0 })
        expect(seen.after.guard).toEqual({ bytes: [1], revision: 1 })
    })

    test('the capability answer is the patched server\'s', async () => {
        const answers = await Promise.all(SUBJECTS.map(([, make]) => make().store.guarded!.probe()))
        expect(answers[0]).toEqual(answers[1])
        expect(answers[1]).toEqual({ checkOnly: true, retire: true, pieces: false })
    })
})

describe('differential: the error class of a lost reply', () => {
    test.each([
        ['write-checked', 'writeChecked'],
        ['remove-checked', 'removeChecked'],
        ['remove-checked', 'retireChecked'],
    ] as const)('a guarded %s request (%s) whose reply is lost is an unknown outcome, and it was applied', async (operation, method) => {
        const seen = await differ(async ({ store, loseReply }, names) => {
            const key = method === 'retireChecked' ? names.unit('key') : names.plain('key')
            const guard = names.plain('guard')
            await store.write(key, bytesOf(1), 'unconditional')
            await store.write(guard, bytesOf(1), 'unconditional')
            loseReply(operation)
            const outcome = await attempt(names, () => method === 'writeChecked'
                ? store.guarded!.writeChecked(key, bytesOf(2), { ifVersion: 1 }, [{ key: guard, version: 1 }])
                : store.guarded![method]([{ key, condition: { ifVersion: 1 } }], [{ key: guard, version: 1 }]))
            return { outcome, after: await stateOf(store, names, [key, guard]) }
        })
        expect(seen.outcome).toEqual({ name: 'StoreOutcomeUnknownError', operation })
        expect(seen.after.key.bytes).not.toEqual([1])
    })

    test('a plain write or delete whose reply is lost fails with the transport error, and it was applied', async () => {
        const seen = await differ(async ({ store, loseReply }, names) => {
            const written = names.plain('written')
            const deleted = names.plain('deleted')
            await store.write(deleted, bytesOf(1), 'unconditional')
            loseReply('write')
            loseReply('remove')
            const writeOutcome = await attempt(names, () => store.write(written, bytesOf(5), 'unconditional'))
            const deleteOutcome = await attempt(names, () => store.delete(deleted, 'unconditional'))
            return { outcome: { writeOutcome, deleteOutcome }, after: await stateOf(store, names, [written, deleted]) }
        })
        expect(seen.outcome).toEqual({ writeOutcome: { name: 'TypeError' }, deleteOutcome: { name: 'TypeError' } })
        expect(seen.after.written.bytes).toEqual([5])
        expect(seen.after.deleted.bytes).toBeNull()
    })

    test('a lost reply that would have been a conflict is still an unknown outcome and applied nothing', async () => {
        const seen = await differ(async ({ store, loseReply }, names) => {
            const key = names.plain('key')
            await store.write(key, bytesOf(1), 'unconditional')
            loseReply('write-checked')
            const outcome = await attempt(names, () => store.guarded!.writeChecked(key, bytesOf(2), { ifVersion: 0 }, []))
            return { outcome, after: await stateOf(store, names, [key]) }
        })
        expect(seen.outcome).toEqual({ name: 'StoreOutcomeUnknownError', operation: 'write-checked' })
        expect(seen.after.key.bytes).toEqual([1])
    })

    test('through createNodeBackend a lost commit-key write and a lost removal are unknown outcomes, and both were applied', async () => {
        const observe = async (subject: Subject) => {
            const { backend, loseReply, store } = subject
            const names = new Names()
            const target = names.unit('unit')
            await backend.putUnit(target, bytesOf(1))
            const commit = await backend.readCommit()
            const fence = await backend.readFence()
            loseReply('write-checked')
            const commitOutcome = await attempt(names, () => backend.casCommit(commit.token, bytesOf(7)))
            const committed = (await backend.readCommit())
            loseReply('remove-checked')
            const removeOutcome = await attempt(names, () => backend.removeBatch([target], committed.token, fence.token))
            return { commitOutcome, commitBytes: [...(await store.read(COMMIT_KEY)).bytes!], removeOutcome, unitBytes: (await store.read(target)).bytes }
        }
        const fake = await observe(fakeSubject())
        const real = await observe(realSubject())
        expect(fake).toEqual(real)
        expect(real.commitOutcome).toEqual({ name: 'Store2UnknownOutcomeError' })
        expect(real.commitBytes).toEqual([7])
        expect(real.removeOutcome).toEqual({ name: 'Store2UnknownOutcomeError' })
        expect(real.unitBytes).toBeNull()
    })
})

describe('differential: the error class of a 431', () => {
    const LARGE_LIMITS: StoreLimits = { maxCheckOnlyKeys: 5000, guardedHeaderBytes: 10_000_000 }
    const OVER = 500
    const UNDER = 20

    function checkList(names: Names, count: number) {
        return Array.from({ length: count }, (_, index) => ({ key: names.unit(`guard-${index}`), version: 0 }))
    }

    test.each([
        ['writeChecked'],
        ['removeChecked'],
    ] as const)('%s with a check-only list the server\'s header limit refuses is the list-too-long error, sent and not applied', async (method) => {
        const run = async (subject: Subject) => {
            const names = new Names()
            const key = names.plain('key')
            await subject.store.write(key, bytesOf(1), 'unconditional')
            const guards = checkList(names, OVER)
            const outcome = await attempt(names, () => method === 'writeChecked'
                ? subject.store.guarded!.writeChecked(key, bytesOf(2), 'unconditional', guards)
                : subject.store.guarded!.removeChecked([{ key, condition: 'unconditional' }], guards))
            return { outcome, after: await stateOf(subject.store, names, [key]) }
        }
        const fake = await run(fakeSubject(LARGE_LIMITS))
        const real = await run(realSubject(LARGE_LIMITS))
        expect(real).toEqual(fake)
        expect(real.outcome).toEqual({ name: 'StoreCheckListTooLongError', keyCount: method === 'writeChecked' ? OVER : OVER + 1, sent: true, mayHaveApplied: false })
        expect(real.after.key.bytes).toEqual([1])
    })

    test('with the production client limits the same list is refused before it is sent, by both', async () => {
        const run = async (subject: Subject) => {
            const names = new Names()
            const key = names.plain('key')
            return await attempt(names, () => subject.store.guarded!.writeChecked(key, bytesOf(2), 'unconditional', checkList(names, OVER)))
        }
        const fake = await run(fakeSubject())
        const real = await run(realSubject())
        expect(fake).toEqual(real)
        expect(real).toEqual({ name: 'StoreCheckListTooLongError', keyCount: OVER, sent: false, mayHaveApplied: false })
    })

    test('a list under the server limit is accepted by both', async () => {
        const run = async (subject: Subject) => {
            const names = new Names()
            const key = names.plain('key')
            const guards = checkList(names, UNDER)
            const outcome = await attempt(names, () => subject.store.guarded!.writeChecked(key, bytesOf(2), 'unconditional', guards))
            return { outcome, after: await stateOf(subject.store, names, [key]) }
        }
        const fake = await run(fakeSubject())
        const real = await run(realSubject(LARGE_LIMITS))
        expect(fake).toEqual(real)
        expect(real.outcome).toBe('ok')
    })

    test('through createNodeBackend the 431 is a definite failure, not an unknown outcome', async () => {
        const run = async (subject: Subject) => {
            const names = new Names()
            const units = Array.from({ length: OVER }, (_, index) => unit(index))
            const commit = await subject.backend.readCommit()
            const outcome = await attempt(names, () => subject.backend.commitOrdinary(commit.token, units, bytesOf(1)))
            return outcome
        }
        const fake = await run(fakeSubject({ maxCheckOnlyKeys: 5000, guardedHeaderBytes: 10_000_000 }))
        const real = await run(realSubject(LARGE_LIMITS))
        expect(fake).toEqual(real)
        expect(real).toEqual({ name: 'Store2BackendFailureError' })
    })
})

describe('the fake\'s own hooks', () => {
    test('damage keeps the revision and changes the bytes; peek and snapshot read without a request and hand out copies', async () => {
        const fake = createNodeSemanticStore()
        const written = await fake.store.write('hook/k', bytesOf(1, 2), 'unconditional')
        const requests = fake.log.length
        fake.damage('hook/k', bytesOf(9))
        expect(fake.peek('hook/k')).toEqual({ bytes: bytesOf(9), revision: written.version })
        const snap = fake.snapshot()
        snap.get('hook/k')!.bytes!.fill(0)
        expect(fake.peek('hook/k').bytes).toEqual(bytesOf(9))
        expect(fake.list('hook/')).toEqual(['hook/k'])
        expect(fake.log.length).toBe(requests)
        expect(await fake.store.read('hook/k')).toEqual({ bytes: bytesOf(9), version: written.version })
    })

    test('a retired key is forgotten and a removed key keeps a tombstone in the snapshot', async () => {
        const fake = createNodeSemanticStore()
        const names = new Names()
        const retired = names.unit('retired')
        const removed = names.plain('removed')
        await fake.store.write(retired, bytesOf(1), 'unconditional')
        await fake.store.write(removed, bytesOf(1), 'unconditional')
        await fake.store.write('guard/k', bytesOf(1), 'unconditional')
        await fake.store.guarded!.retireChecked([{ key: retired, condition: 'unconditional' }], [{ key: 'guard/k', version: 1 }])
        await fake.store.guarded!.removeChecked([{ key: removed, condition: 'unconditional' }], [{ key: 'guard/k', version: 1 }])
        const snap = fake.snapshot()
        expect(snap.has(retired)).toBe(false)
        expect(snap.get(removed)).toEqual({ bytes: null, revision: 2 })
    })
})

describe('createNodeBackend over the fake', () => {
    runBackendConformance('node semantic fake', async () => {
        const fake = createNodeSemanticStore()
        return { backend: createNodeBackend(fake.store), plant: async (key, bytes) => { await fake.store.write(key, bytes, 'unconditional') } }
    }, { compare: 'revision', atomicUnits: false })

    test('one commit uploads each unit create-only and then writes the commit key once; one removal is one retire request carrying the commit and fence revisions', async () => {
        const fake = createNodeSemanticStore()
        const backend = createNodeBackend(fake.store)
        await backend.commitOrdinary((await backend.readCommit()).token, [unit(1), unit(2)], bytesOf(1))
        expect(fake.log).toEqual(['read', 'write-checked', 'write-checked', 'write-checked'])
        const commit = await backend.readCommit()
        const fence = await backend.readFence()
        const before = fake.log.length
        await backend.removeBatch([unitKey(1), unitKey(2)], commit.token, fence.token)
        expect(fake.log.slice(before)).toEqual(['remove-checked'])
        const snap = fake.snapshot()
        expect(snap.has(unitKey(1))).toBe(false)
        expect(snap.get(COMMIT_KEY)?.bytes).toEqual(bytesOf(1))
        await expect(backend.listStore2()).resolves.toEqual([])
    })
})
