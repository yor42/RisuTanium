/**
 * The packing worker arm of `readStubsForExport` (`drive/exportInline.ts`, `drive/stubPackClient.ts`): a stub's encoded
 * body is packed in a worker, and the collection a worker gives equals the serial one in membership, order, uuids and bytes.
 *
 * `readColdCharacterCopy` is a plain fake that returns a fresh character per read; the worker is `fakePackWorker.ts`, whose
 * messages and replies cross a structured clone like a real worker boundary, and whose packing is the real
 * `handlePackMessage`. A pass here says nothing about a real module worker in a WebView; the device row covers that.
 *
 * Labels: (G) a guard that passes on the serial collection too and pins what the change must keep; (new behaviour) names
 * something that does not exist before the change, so it is shown by mutating the implementation, not by a red base.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ColdCopyOutcome } from 'src/ts/process/coldCharacterRestore'
import { inlineKeyOf, readStubsForExport, setStubPackProbeForTest, stubEntriesInTree, stubWithMintedKey, takeStubReadStats, unpackStubEntry, type StubPackProbeEvent, type StubsForExport } from 'src/ts/drive/exportInline'
import { handlePackMessage } from 'src/ts/drive/stubPackWorker'
import type { character } from 'src/ts/storage/database.svelte'
import { installFakePackWorker, withoutWorker, type FakePackController, type FakePackOptions } from './fakePackWorker'

type Slot = character

const store = vi.hoisted(() => ({
    started: [] as string[],
    answer: null as null | ((u: string) => unknown),
}))

const deflateBox = vi.hoisted(() => ({
    /** Calls of `deflateSync` made outside the fake worker. */
    mainCalls: 0,
    inWorker: false,
    throwWhen: null as null | ((bytes: Uint8Array) => boolean),
}))

const uuidBox = vi.hoisted(() => ({ next: 0 }))

const frozen = vi.hoisted(() => ({ on: false }))

vi.mock('fflate', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fflate')>()
    return {
        ...actual,
        deflateSync: (data: Uint8Array, options?: import('fflate').DeflateOptions) => {
            if (!deflateBox.inWorker) {
                deflateBox.mainCalls += 1
                if (deflateBox.throwWhen?.(data)) {
                    throw new Error('the main thread could not allocate')
                }
            }
            return actual.deflateSync(data, options)
        },
    }
})

vi.mock('uuid', async (importOriginal) => ({
    ...(await importOriginal<typeof import('uuid')>()),
    v4: () => `u-${++uuidBox.next}`,
}))

vi.mock('src/ts/storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/storage/tauriByteTransport')>()),
    shouldBypassFrozenPagePaths: () => frozen.on,
}))

vi.mock('src/ts/process/coldCharacterRestore', () => ({
    readColdCharacterCopy: async (slot: { coldstorage: string }): Promise<ColdCopyOutcome> => {
        store.started.push(slot.coldstorage)
        const answer = store.answer?.(slot.coldstorage)
        if (answer instanceof Error) {
            throw answer
        }
        return (answer ?? { status: 'ok', character: characterOf(numberOf(slot.coldstorage)) }) as ColdCopyOutcome
    },
}))

vi.mock('src/ts/process/coldstorage.svelte', () => ({ collectColdStorageBackupPayloads: vi.fn() }))
vi.mock('src/ts/process/coldstorageData', () => ({
    getColdStorageBackupName: (key: string) => `coldstorage_${key}.json`,
    listColdBackupRoots: () => [],
    listColdPluginStorageKeys: () => [],
}))
vi.mock('src/ts/process/coldCharacter', () => ({
    applyStubStateOnRestore: (_stub: unknown, whole: unknown) => whole,
    coldUnitCharacter: (source: unknown) => source,
}))

/** A valid entity key: 26 characters of the store2 alphabet. */
function unit(n: number): string {
    return n.toString(32).padStart(26, '0')
}

function numberOf(u: string): number {
    return Number.parseInt(u, 32)
}

/** The character read for stub `n`: its text differs by `n`, so a body belongs to one character only. */
function characterOf(n: number, size = 200): Record<string, unknown> {
    return { chaId: `cha${n}`, name: `whole-${unit(n)}`, desc: `${n}:${'abcdefghij'.repeat(Math.ceil((size + n * 37) / 10))}` }
}

function stub(n: number, extra: Partial<Slot> = {}): Slot {
    return { chaId: `cha${n}`, name: `stub-${n}`, coldstorage: unit(n), ...extra } as unknown as Slot
}

function bodyOf(n: number, size = 200): Uint8Array {
    return new TextEncoder().encode(JSON.stringify({ character: characterOf(n, size) }))
}

async function turns(count = 10): Promise<void> {
    for (let i = 0; i < count; i++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
}

/** The real handler, with its deflate counted as the worker's. */
function realPack(data: unknown): unknown {
    deflateBox.inWorker = true
    try {
        return handlePackMessage(data)
    } finally {
        deflateBox.inWorker = false
    }
}

let controller: FakePackController | null = null
let restoreWorker: (() => void) | null = null

function useWorker(options: Partial<FakePackOptions> = {}): FakePackController {
    controller = installFakePackWorker({ pack: realPack, ...options })
    return controller
}

/** Awaits `done`, answering every held job between macrotask turns, with a bound on the turns. */
async function finish<T>(done: Promise<T>): Promise<T> {
    let settled = false
    done.then(() => { settled = true }, () => { settled = true })
    for (let i = 0; i < 200 && !settled; i++) {
        await turns(1)
        controller?.releaseAll()
    }
    expect(settled).toBe(true)
    return done
}

function stubSlots(count: number): Slot[] {
    return Array.from({ length: count }, (_, i) => stub(i + 1))
}

function entryOf(result: StubsForExport, n: number) {
    const entry = result.stubEntries.get(inlineKeyOf(unit(n), `cha${n}`))
    if (entry === undefined) {
        throw new Error(`no entry for stub ${n}`)
    }
    return entry
}

function keyUnits(keys: Iterable<string>): string[] {
    return [...keys].map((key) => key.split('\u0000')[0])
}

beforeEach(() => {
    store.started.length = 0
    store.answer = null
    deflateBox.mainCalls = 0
    deflateBox.inWorker = false
    deflateBox.throwWhen = null
    uuidBox.next = 0
    frozen.on = false
    takeStubReadStats()
})

afterEach(() => {
    setStubPackProbeForTest(null)
    controller?.uninstall()
    controller = null
    restoreWorker?.()
    restoreWorker = null
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('replies out of order', () => {
    test.each([
        ['reverse', 'reverse' as const, 1],
        ['random seed 1', 'random' as const, 1],
        ['random seed 9', 'random' as const, 9],
    ])('(new behaviour) with %s replies each entry unpacks to its own character body', async (_name, policy, seed) => {
        useWorker({ policy, seed })
        const slots = stubSlots(12)

        const result = await finish(readStubsForExport({ characters: slots } as never, { mode: 'stub' }))

        expect([...result.stubEntries.keys()]).toHaveLength(12)
        for (let n = 1; n <= 12; n++) {
            expect(Array.from(unpackStubEntry(entryOf(result, n)))).toEqual(Array.from(bodyOf(n)))
        }
        expect(takeStubReadStats()?.packFallbacks).toBe(0)
    })
})

describe('order of entries and uuids', () => {
    async function run(arm: 'serial' | 'reverse' | 'random') {
        uuidBox.next = 0
        if (arm === 'serial') {
            restoreWorker = withoutWorker()
        } else {
            useWorker({ policy: arm, seed: 5 })
        }
        const slots = stubSlots(10)
        const result = await finish(readStubsForExport({ characters: slots } as never, { mode: 'stub' }))
        const tree = slots.map((slot) => stubWithMintedKey(slot, result.stubEntries) ?? slot)
        controller?.uninstall()
        controller = null
        restoreWorker?.()
        restoreWorker = null
        return { result, tree }
    }

    test.each(['serial', 'reverse', 'random'] as const)('(G) %s: keys in list order, the k-th stub holds uuid k, and the tree lists the entries in list order', async (arm) => {
        const { result, tree } = await run(arm)

        expect(keyUnits(result.stubEntries.keys())).toEqual(stubSlots(10).map((slot) => slot.coldstorage))
        expect([...result.stubEntries.values()].map((entry) => entry.uuid)).toEqual(Array.from({ length: 10 }, (_, i) => `u-${i + 1}`))
        expect(stubEntriesInTree(tree, result.stubEntries).map((entry) => entry.uuid)).toEqual(Array.from({ length: 10 }, (_, i) => `u-${i + 1}`))
        expect(result.inlined.size).toBe(0)
    })
})

describe('bounds on the live jobs', () => {
    function recordEvents(): StubPackProbeEvent[] {
        const events: StubPackProbeEvent[] = []
        setStubPackProbeForTest((event) => { events.push(event) })
        return events
    }

    test('(new behaviour) the byte budget holds the loop back: held bytes stay within it, and the bytes the records hold are counted', async () => {
        const held = useWorker({ policy: 'hold' })
        const events = recordEvents()
        store.answer = (u) => ({ status: 'ok', character: characterOf(numberOf(u), 3000) })
        const done = readStubsForExport({ characters: stubSlots(6) } as never, { mode: 'stub', pack: { budgetBytes: 10240, maxJobs: 4 } })
        await turns()

        // About 3 KiB each: three fit in 10 KiB and the fourth waits.
        expect(held.posted).toHaveLength(3)
        await finish(done)
        expect(events.length).toBeGreaterThan(0)
        for (const event of events) {
            expect(event.bytes).toBeLessThanOrEqual(10240)
            if (event.records > 0 && event.characters > 0) {
                expect(event.bytes).toBeGreaterThan(0)
            }
        }
    })

    test('(new behaviour) the job count caps the live jobs at four whatever the budget, and the next stub is not consumed until a reply is released', async () => {
        const held = useWorker({ policy: 'hold' })
        const events = recordEvents()
        const done = readStubsForExport({ characters: stubSlots(8) } as never, { mode: 'stub', pack: { budgetBytes: 1024 * 1024, maxJobs: 4 } })
        await turns()

        expect(held.posted).toHaveLength(4)
        await turns()
        expect(held.posted).toHaveLength(4)
        held.release(held.posted[0])
        await turns()
        expect(held.posted).toHaveLength(5)
        await finish(done)
        expect(Math.max(...events.map((event) => event.records))).toBeLessThanOrEqual(4)
        for (const event of events) {
            expect(event.characters).toBeLessThanOrEqual(event.records)
        }
    })

    test('(new behaviour) a body larger than the budget is admitted only when no job is live, and alone', async () => {
        const held = useWorker({ policy: 'hold' })
        const events = recordEvents()
        store.answer = (u) => ({ status: 'ok', character: characterOf(numberOf(u), numberOf(u) === 2 ? 20 * 1024 : 200) })
        const done = readStubsForExport({ characters: stubSlots(3) } as never, { mode: 'stub', pack: { budgetBytes: 10240, maxJobs: 4 } })
        await turns()

        // Stub 1 is live; the 20 KiB body of stub 2 waits for it.
        expect(held.posted).toHaveLength(1)
        held.release(held.posted[0])
        await turns()
        expect(held.posted).toHaveLength(2)
        await finish(done)
        for (const event of events) {
            if (event.bytes > 10240) {
                expect(event.records).toBe(1)
            }
        }
        expect(events.some((event) => event.bytes > 10240)).toBe(true)
    })
})

describe('a worker that fails', () => {
    const FAIL_AFTER = 3

    async function expectEveryEntryWhole(result: StubsForExport, count: number): Promise<void> {
        expect([...result.stubEntries.keys()]).toHaveLength(count)
        for (let n = 1; n <= count; n++) {
            expect(Array.from(unpackStubEntry(entryOf(result, n)))).toEqual(Array.from(bodyOf(n)))
        }
        expect([...result.stubEntries.values()].map((entry) => entry.uuid)).toEqual(Array.from({ length: count }, (_, i) => `u-${i + 1}`))
    }

    test.each(['error', 'messageerror', 'malformed'] as const)('(new behaviour) a %s event fails the jobs in flight over to the main thread and later stubs pack there, every entry whole', async (kind) => {
        const held = useWorker({ policy: 'hold', failure: { after: FAIL_AFTER, kind } })

        const result = await finish(readStubsForExport({ characters: stubSlots(7) } as never, { mode: 'stub' }))

        await expectEveryEntryWhole(result, 7)
        // The event arrives a turn after the failing post, so a job posted in that turn falls back too.
        expect(takeStubReadStats()?.packFallbacks).toBeGreaterThanOrEqual(FAIL_AFTER)
        expect(held.terminated()).toBe(1)
        expect(result.inlined.size).toBe(0)
    })

    test('(new behaviour) a spawn that throws falls back to the main thread for every entry', async () => {
        useWorker({ throwOnSpawn: true })

        const result = await finish(readStubsForExport({ characters: stubSlots(5) } as never, { mode: 'stub' }))

        await expectEveryEntryWhole(result, 5)
        expect(takeStubReadStats()?.packFallbacks).toBeGreaterThan(0)
    })

    test('(new behaviour) a job that is not answered within the timeout fails the worker over, and a late reply for it changes nothing', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const held = useWorker({ policy: 'hold', failure: { after: FAIL_AFTER, kind: 'silent' } })
        const done = readStubsForExport({ characters: stubSlots(6) } as never, { mode: 'stub' })
        let outcome: StubsForExport | null = null
        done.then((result) => { outcome = result })
        await vi.advanceTimersByTimeAsync(1)
        expect(outcome).toBeNull()

        await vi.advanceTimersByTimeAsync(30_001)
        // The main thread packed the jobs in flight; the rest of the stubs follow on the main thread.
        for (let i = 0; i < 20 && outcome === null; i++) {
            await vi.advanceTimersByTimeAsync(1)
        }
        expect(outcome).not.toBeNull()
        const result = outcome as unknown as StubsForExport
        held.deliver({ id: 1, packed: new Uint8Array([1, 2, 3]) })
        await vi.advanceTimersByTimeAsync(1)

        await expectEveryEntryWhole(result, 6)
        expect(takeStubReadStats()?.packFallbacks).toBeGreaterThan(0)
    })
})

describe('a page that may be frozen', () => {
    test('(new behaviour) while the page is hidden on Android no job is posted, and the main thread packs', async () => {
        const held = useWorker()
        frozen.on = true

        const result = await finish(readStubsForExport({ characters: stubSlots(5) } as never, { mode: 'stub' }))

        expect(held.posted).toHaveLength(0)
        expect(deflateBox.mainCalls).toBe(5)
        expect([...result.stubEntries.keys()]).toHaveLength(5)
        expect(Array.from(unpackStubEntry(entryOf(result, 3)))).toEqual(Array.from(bodyOf(3)))
    })
})

describe('lifetime', () => {
    let unhandled: unknown[]
    const onUnhandled = (reason: unknown) => { unhandled.push(reason) }

    beforeEach(() => {
        unhandled = []
        process.on('unhandledRejection', onUnhandled)
    })

    afterEach(() => {
        process.off('unhandledRejection', onUnhandled)
    })

    test('(new behaviour) a collection that succeeds ends its worker once, with every job settled', async () => {
        const held = useWorker()
        const events: StubPackProbeEvent[] = []
        setStubPackProbeForTest((event) => { events.push(event) })

        await finish(readStubsForExport({ characters: stubSlots(6) } as never, { mode: 'stub' }))
        await turns()

        expect(held.terminated()).toBe(1)
        expect(events[events.length - 1]).toMatchObject({ records: 0, characters: 0, bytes: 0 })
        expect(unhandled).toEqual([])
    })

    test('(new behaviour) a collection with no stub to pack starts no worker', async () => {
        const held = useWorker()

        await finish(readStubsForExport({ characters: [{ chaId: 'plain', name: 'not a stub' }] } as never, { mode: 'stub' }))

        expect(held.posted).toHaveLength(0)
        expect(held.terminated()).toBe(0)
    })

    test('(new behaviour) a read that rejects while jobs are live ends the worker, settles every job and packs nothing on the main thread', async () => {
        const held = useWorker({ policy: 'hold' })
        const events: StubPackProbeEvent[] = []
        setStubPackProbeForTest((event) => { events.push(event) })
        store.answer = (u) => numberOf(u) === 4 ? new Error('the store failed') : undefined
        const done = readStubsForExport({ characters: stubSlots(6) } as never, { mode: 'stub' })
        const outcome = done.then(() => 'resolved', (error: Error) => error.message)

        expect(await outcome).toBe('the store failed')
        const mainCallsAtRejection = deflateBox.mainCalls
        await turns()

        expect(held.posted).toHaveLength(3)
        expect(held.terminated()).toBe(1)
        expect(deflateBox.mainCalls).toBe(mainCallsAtRejection)
        expect(deflateBox.mainCalls).toBe(0)
        expect(events[events.length - 1]).toMatchObject({ records: 0 })
        expect(unhandled).toEqual([])
    })
})

describe('membership and the double fault', () => {
    test.each(['serial', 'random'] as const)('(G) %s: a stub listed again, trashed or not, is read once and kept once', async (arm) => {
        if (arm === 'serial') {
            restoreWorker = withoutWorker()
        } else {
            useWorker({ policy: 'random', seed: 3 })
        }
        const slots = [stub(1), stub(1), stub(2), stub(1, { trashTime: 5 })]

        const result = await finish(readStubsForExport({ characters: slots } as never, { mode: 'stub' }))

        expect(store.started).toEqual([unit(1), unit(2)])
        expect(keyUnits(result.stubEntries.keys())).toEqual([unit(1), unit(2)])
        expect(result.inlined.size).toBe(0)
        expect(result.failedKeys).toEqual([])
        expect(uuidBox.next).toBe(2)
    })

    async function runDouble(arm: 'serial' | 'worker') {
        uuidBox.next = 0
        deflateBox.throwWhen = (bytes) => new TextDecoder().decode(bytes).includes(`cha3`)
        if (arm === 'serial') {
            restoreWorker = withoutWorker()
        } else {
            useWorker({ policy: 'hold', failure: { after: 3, kind: 'error' } })
        }
        const result = await finish(readStubsForExport({ characters: stubSlots(5) } as never, { mode: 'stub' }))
        controller?.uninstall()
        controller = null
        restoreWorker?.()
        restoreWorker = null
        return {
            inlinedKeys: [...result.inlined.keys()],
            stubKeys: [...result.stubEntries.keys()],
            uuids: [...result.stubEntries.values()].map((entry) => entry.uuid),
            bodies: [...result.stubEntries.values()].map((entry) => Array.from(unpackStubEntry(entry))),
            minted: uuidBox.next,
        }
    }

    test('(G) a body no thread can pack is inlined at its position, mints no uuid, and the collection equals the serial one under the same throw', async () => {
        const serial = await runDouble('serial')
        const worker = await runDouble('worker')

        expect(serial.inlinedKeys.map((key) => key.split('\u0000')[0])).toEqual([unit(3)])
        expect(worker).toEqual(serial)
        expect(worker.minted).toBe(4)
    })
})

describe('the measure fields', () => {
    test('(new behaviour) the stats count the packed bytes at materialization, the wait, the drain, no fallback, and four live jobs at most', async () => {
        useWorker({ policy: 'hold' })

        const result = await finish(readStubsForExport({ characters: stubSlots(6) } as never, { mode: 'stub' }))
        const stats = takeStubReadStats()

        const entries = [...result.stubEntries.values()]
        expect(stats?.packedBytes).toBe(entries.reduce((sum, entry) => sum + entry.packed.byteLength, 0))
        expect(stats?.packedBytes).toBeGreaterThan(0)
        expect(stats?.rawBytes).toBe(entries.reduce((sum, entry) => sum + entry.rawLength, 0))
        expect(Number.isFinite(stats?.packWaitMs)).toBe(true)
        expect(Number.isFinite(stats?.packDrainMs)).toBe(true)
        expect(stats?.packWaitMs).toBeGreaterThanOrEqual(0)
        expect(stats?.packDrainMs).toBeGreaterThanOrEqual(0)
        expect(stats?.packFallbacks).toBe(0)
        expect(stats?.packHeldMax).toBe(4)
    })
})
