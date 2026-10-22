/**
 * The read-ahead of `readStubsForExport` (`drive/exportInline.ts`): the first read of the next `STUB_READ_AHEAD` stubs
 * runs while the consumer works on the current one, and the result is what a serial read gives.
 *
 * `readColdCharacterCopy` is replaced by a fake store that records when each read starts, can hold a read until the
 * test releases it, and answers by entity and attempt. A pass here says nothing about the speed of the native store.
 *
 * Labels: (R) fails against the serial collection before this change (it reads one stub at a time); (G) is a guard
 * that passes with or without the change and pins what the change must keep; (new behaviour) names something that
 * does not exist before the change, so it is shown by mutating the implementation, not by a red base; (R rescue)
 * passes against the serial collection and fails against the read-ahead without its shared-failure rescue.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ColdCopyOutcome } from 'src/ts/process/coldCharacterRestore'
import * as exportInline from 'src/ts/drive/exportInline'
import { readStubsForExport, takeStubReadStats } from 'src/ts/drive/exportInline'
import type { character } from 'src/ts/storage/database.svelte'

type Slot = character

/** The read-ahead the tests rely on; the first test pins that it is the production default. */
const AHEAD = 3

interface Deferred {
    promise: Promise<void>
    resolve: () => void
}

function deferred(): Deferred {
    let resolve = () => { }
    const promise = new Promise<void>((done) => { resolve = done })
    return { promise, resolve }
}

const store = vi.hoisted(() => ({
    /** Every read, in the order it started: the entity and the attempt number of that entity. */
    started: [] as Array<{ u: string, attempt: number }>,
    active: 0,
    maxActive: 0,
    hold: false,
    gates: new Map<string, unknown>(),
    attempts: new Map<string, number>(),
    answer: null as null | ((u: string, attempt: number, slot: unknown) => unknown),
}))

vi.mock('src/ts/process/coldCharacterRestore', () => {
    return {
        readColdCharacterCopy: async (slot: { coldstorage: string }): Promise<ColdCopyOutcome> => {
            const u = slot.coldstorage
            const attempt = (store.attempts.get(u) ?? 0) + 1
            store.attempts.set(u, attempt)
            store.started.push({ u, attempt })
            store.active += 1
            store.maxActive = Math.max(store.maxActive, store.active)
            try {
                if (store.hold && attempt === 1) {
                    let gate = store.gates.get(u) as Deferred | undefined
                    if (gate === undefined) {
                        gate = deferred()
                        store.gates.set(u, gate)
                    }
                    await gate.promise
                }
                const answer = store.answer?.(u, attempt, slot)
                if (answer instanceof Error) {
                    throw answer
                }
                return (answer ?? { status: 'ok', character: { ...slot, name: `whole-${u}`, coldstorage: undefined } }) as ColdCopyOutcome
            } finally {
                store.active -= 1
            }
        },
    }
})

// The collection's other imports reach the parser and the stores of a running page; only what the stub read uses is kept.
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

function stub(n: number, extra: Partial<Slot> = {}): Slot {
    return { chaId: `cha${n}`, name: `stub-${n}`, coldstorage: unit(n), ...extra } as unknown as Slot
}

function release(u: string) {
    let gate = store.gates.get(u) as Deferred | undefined
    if (gate === undefined) {
        gate = deferred()
        store.gates.set(u, gate)
    }
    gate.resolve()
}

async function turns(): Promise<void> {
    for (let i = 0; i < 3; i++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
}

beforeEach(() => {
    store.started.length = 0
    store.active = 0
    store.maxActive = 0
    store.hold = false
    store.gates.clear()
    store.attempts.clear()
    store.answer = null
    takeStubReadStats()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('readStubsForExport read-ahead', () => {
    test('(new behaviour) the default read-ahead is three', () => {
        expect((exportInline as { STUB_READ_AHEAD?: number }).STUB_READ_AHEAD).toBe(AHEAD)
    })

    test('(R) with K+2 stubs and every read held, exactly K+1 reads are running, and the collection finishes once they are released', async () => {
        store.hold = true
        const slots = Array.from({ length: AHEAD + 4 }, (_, i) => stub(i + 1))
        const done = readStubsForExport({ characters: slots } as never, { mode: 'inline' })
        await turns()

        expect(store.started).toHaveLength(AHEAD + 1)
        expect(store.maxActive).toBe(AHEAD + 1)
        for (const slot of slots) {
            release(slot.coldstorage as string)
        }
        const result = await done
        expect([...result.inlined.keys()].map((key) => key.split('\u0000')[0])).toEqual(slots.map((slot) => slot.coldstorage))
        expect(store.maxActive).toBe(AHEAD + 1)
    })

    test('(R) while the consumer waits on slot 0, reads of slots 1 to K are running and no read past slot K starts, however fast the others finish; slot K+1 starts when slot 0 is consumed', async () => {
        store.hold = true
        const slots = Array.from({ length: AHEAD + 4 }, (_, i) => stub(i + 1))
        const done = readStubsForExport({ characters: slots } as never, { mode: 'inline' })
        await turns()
        for (let i = 1; i <= AHEAD; i++) {
            release(slots[i].coldstorage as string)
        }
        await turns()

        expect(store.started.map((read) => read.u)).toEqual(slots.slice(0, AHEAD + 1).map((slot) => slot.coldstorage))

        release(slots[0].coldstorage as string)
        await turns()
        expect(store.started.map((read) => read.u)).toContain(slots[AHEAD + 1].coldstorage)
        for (const slot of slots) {
            release(slot.coldstorage as string)
        }
        await done
    })

    test('(G) the result maps are in list order even when later reads finish first', async () => {
        store.hold = true
        const slots = Array.from({ length: 4 }, (_, i) => stub(i + 1))
        const done = readStubsForExport({ characters: slots } as never, { mode: 'inline' })
        await turns()
        for (const slot of [...slots].reverse()) {
            release(slot.coldstorage as string)
        }
        const result = await done

        expect([...result.inlined.values()].map((whole) => whole.name)).toEqual(slots.map((slot) => `whole-${slot.coldstorage}`))
    })

    test('(new behaviour) a stub listed twice inside the window is read once and kept once', async () => {
        store.hold = true
        const slots = [stub(1), stub(1), stub(3), stub(1)]
        const done = readStubsForExport({ characters: slots } as never, { mode: 'inline' })
        await turns()
        expect(store.started.map((read) => read.u)).toEqual([unit(1), unit(3)])
        release(unit(1))
        release(unit(3))
        const result = await done

        expect(store.started.map((read) => read.u)).toEqual([unit(1), unit(3)])
        expect([...result.inlined.keys()].map((key) => key.split('\u0000')[0])).toEqual([unit(1), unit(3)])
    })

    test('(G) a read-ahead of 0 reads one stub at a time in list order', async () => {
        const slots = Array.from({ length: 5 }, (_, i) => stub(i + 1))
        await readStubsForExport({ characters: slots } as never, { mode: 'inline', readAhead: 0 })

        expect(store.maxActive).toBe(1)
        expect(store.started.map((read) => read.u)).toEqual(slots.map((slot) => slot.coldstorage))
    })

    test('(new behaviour) the stats of a measurement build report the read-ahead and the most characters held', async () => {
        store.hold = true
        const slots = Array.from({ length: 7 }, (_, i) => stub(i + 1))
        const done = readStubsForExport({ characters: slots } as never, { mode: 'inline', readAhead: 2 })
        await turns()
        for (const slot of slots) {
            release(slot.coldstorage as string)
        }
        await done

        const stats = takeStubReadStats()
        expect(stats?.ahead).toBe(2)
        expect(stats?.heldMax).toBe(3)
        expect(stats?.characters).toBe(7)
    })

    describe('equivalence with the serial read', () => {
        function mixedList(): Slot[] {
            return [
                stub(1),
                stub(2),
                { chaId: 'plain', name: 'not a stub' } as unknown as Slot,
                stub(3, { trashTime: 5 }),
                stub(4),
                stub(2),
                stub(5, { chaId: 'cha5b' }),
                stub(6),
                stub(7),
                stub(8),
            ]
        }

        /** Entity 2 is missing, entity 4 is unreadable twice and then reads, entity 6 stays unreadable, entity 7 is damaged. */
        function answer(u: string, attempt: number): unknown {
            if (u === unit(2)) {
                return { status: 'missing' }
            }
            if (u === unit(4)) {
                return attempt <= 2 ? { status: 'unreadable', error: new Error('transient') } : undefined
            }
            if (u === unit(6)) {
                return { status: 'unreadable', error: new Error('down') }
            }
            if (u === unit(7)) {
                return { status: 'unreadable', error: new Error('damaged'), kind: 'damaged' }
            }
            return undefined
        }

        async function run(readAhead: number) {
            store.started.length = 0
            store.attempts.clear()
            store.answer = (u, attempt) => answer(u, attempt)
            const pauses: number[] = []
            const result = await readStubsForExport({ characters: mixedList() } as never, {
                mode: 'inline',
                readAhead,
                readRetry: { pausesMs: [10, 20], budgetMs: 1000, maxRetries: 3, pause: async (ms) => { pauses.push(ms) } },
            })
            const reads = new Map<string, number>()
            for (const read of store.started) {
                reads.set(read.u, (reads.get(read.u) ?? 0) + 1)
            }
            return {
                keys: [...result.inlined.keys()],
                names: [...result.inlined.values()].map((whole) => whole.name),
                failed: result.failedKeys,
                pauses,
                reads: [...reads.entries()],
            }
        }

        test('(G) the maps, failedKeys, retry pauses and the reads of each entity equal those of the serial read, for a failing, a transient, a damaged, a trashed and a duplicate stub', async () => {
            const serial = await run(0)
            const ahead = await run(AHEAD)

            expect(ahead.keys).toEqual(serial.keys)
            expect(ahead.names).toEqual(serial.names)
            expect(ahead.failed).toEqual(serial.failed)
            // Entity 2 failed on its first occurrence, so its second occurrence is read again, as serially.
            expect(serial.reads.find(([u]) => u === unit(2))?.[1]).toBe(2)
            expect(serial.failed).toEqual([unit(2), unit(6), unit(7)])
            expect(serial.pauses).toEqual([10, 20, 10])
        })

        test('(new behaviour) a read made ahead that is unreadable is made again at its own turn without a pause or a charge to the retry budget, so the retries it needs are the serial ones counted from that read', async () => {
            const serial = await run(0)
            const ahead = await run(AHEAD)

            // Entity 4 is unreadable on attempts 1 and 2: the read made ahead is attempt 1 and the read at its turn is attempt 2,
            // so one pause remains before attempt 3 succeeds. Entity 6 never reads: it takes the pauses left in the budget.
            expect(ahead.pauses).toEqual([10, 10, 20])
            expect(ahead.reads.find(([u]) => u === unit(4))?.[1]).toBe(serial.reads.find(([u]) => u === unit(4))?.[1])
        })
    })

    describe('a store outage that fails several concurrent reads together', () => {
        /**
         * The store is down from a trigger read until the consumer's next pause. The production retry policy is used, so
         * the shared budget is the real one.
         */
        async function runOutage(readAhead: number, triggers: number[]) {
            let down = false
            const triggered = new Set(triggers.map(unit))
            store.answer = (u, attempt) => {
                if (attempt === 1 && triggered.has(u)) {
                    down = true
                }
                return down ? { status: 'unreadable', error: new Error('the store blipped') } : undefined
            }
            const pauses: number[] = []
            const slots = Array.from({ length: 16 }, (_, i) => stub(i + 1))
            const result = await readStubsForExport({ characters: slots } as never, {
                mode: 'inline',
                readAhead,
                readRetry: { pause: async (ms) => { pauses.push(ms); down = false } },
            })
            return { pauses, failed: result.failedKeys.length, inlined: result.inlined.size }
        }

        test('(R rescue) two short outages cost the read-ahead no more failed characters than the serial read, which loses none', async () => {
            store.started.length = 0
            store.attempts.clear()
            const serial = await runOutage(0, [1, 9])
            store.started.length = 0
            store.attempts.clear()
            const ahead = await runOutage(AHEAD, [1, 9])

            expect(serial.failed).toBe(0)
            expect(serial.pauses).toHaveLength(2)
            expect(ahead.failed).toBe(serial.failed)
            expect(ahead.inlined).toBe(serial.inlined)
            expect(ahead.pauses).toEqual(serial.pauses)
        })
    })

    describe('a slot that changes after its read started', () => {
        test('(G) a stub whose entity changed is read again for the new entity, and the old read is not used', async () => {
            store.hold = true
            const slots = [stub(1), stub(2), stub(3)]
            const done = readStubsForExport({ characters: slots } as never, { mode: 'inline' })
            await turns()
            slots[1].coldstorage = unit(9)
            for (const u of [unit(1), unit(2), unit(3), unit(9)]) {
                release(u)
            }
            const result = await done

            expect([...result.inlined.keys()].map((key) => key.split('\u0000')[0])).toEqual([unit(1), unit(9), unit(3)])
            expect([...result.inlined.values()].map((whole) => whole.name)).toEqual([`whole-${unit(1)}`, `whole-${unit(9)}`, `whole-${unit(3)}`])
            expect(store.started.filter((read) => read.u === unit(9))).toHaveLength(1)
        })

        test('(new behaviour) a stub whose chaId changed is read again under the new identity', async () => {
            store.hold = true
            const slots = [stub(1), stub(2)]
            const done = readStubsForExport({ characters: slots } as never, { mode: 'inline' })
            await turns()
            slots[1].chaId = 'renamed'
            release(unit(1))
            release(unit(2))
            const result = await done

            expect([...result.inlined.keys()]).toEqual([`${unit(1)}\u0000cha1`, `${unit(2)}\u0000renamed`])
            expect([...result.inlined.values()].map((whole) => whole.chaId)).toEqual(['cha1', 'renamed'])
            // The read made for the old identity is not reused: the entity is read once for each identity.
            expect(store.started.filter((read) => read.u === unit(2))).toHaveLength(2)
        })

        test('(G) a slot that is no longer a stub is skipped, as the serial read skips it', async () => {
            store.hold = true
            const slots = [stub(1), stub(2), stub(3)]
            const done = readStubsForExport({ characters: slots } as never, { mode: 'inline' })
            await turns()
            slots[1].coldstorage = undefined
            for (const u of [unit(1), unit(2), unit(3)]) {
                release(u)
            }
            const result = await done

            expect([...result.inlined.keys()].map((key) => key.split('\u0000')[0])).toEqual([unit(1), unit(3)])
            expect(result.failedKeys).toEqual([])
        })
    })

    describe('a read that rejects', () => {
        let unhandled: unknown[]
        const onUnhandled = (reason: unknown) => { unhandled.push(reason) }

        beforeEach(() => {
            unhandled = []
            process.on('unhandledRejection', onUnhandled)
        })

        afterEach(() => {
            process.off('unhandledRejection', onUnhandled)
        })

        test('(R) a rejection of a read that is ahead of the consumer is not unhandled, and reaches the collection when its slot is consumed', async () => {
            store.hold = true
            store.answer = (u) => u === unit(3) ? new Error('the store failed') : undefined
            const slots = [stub(1), stub(2), stub(3), stub(4)]
            const done = readStubsForExport({ characters: slots } as never, { mode: 'inline' })
            const outcome = done.then(() => 'resolved', (error: Error) => error.message)
            await turns()
            release(unit(3))
            await turns()

            expect(unhandled).toEqual([])
            release(unit(1))
            release(unit(2))
            release(unit(4))
            expect(await outcome).toBe('the store failed')
            await turns()
            expect(unhandled).toEqual([])
        })

        test('(G) a read that rejects at its own turn rejects the collection, with no other read left unhandled', async () => {
            store.answer = (u) => u === unit(1) ? new Error('the store failed') : new Error('also failed')
            const slots = [stub(1), stub(2), stub(3)]
            await expect(readStubsForExport({ characters: slots } as never, { mode: 'inline' })).rejects.toThrow('the store failed')
            await turns()

            expect(unhandled).toEqual([])
        })
    })
})
