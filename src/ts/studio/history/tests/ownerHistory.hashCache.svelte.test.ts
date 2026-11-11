// @vitest-environment jsdom
// Units of first-message text the service hashes per action, and the
// idle warm-up at card open.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey, chatOwnerKey } from '../ownerPhase'
import { COALESCE_MS } from '../historyModel'
import { WARM_CHUNK_MS, WARM_MAX_YIELDS, WARM_MS_PER_ELEMENT, WARM_MS_PER_UNIT, type ElementHashCache } from '../elementHashCache'
import { createFakeClock, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, type MemoryStudioStore } from './studioStoreDoubles'

const h = vi.hoisted(() => ({ marks: 0 }))
// Element hashes the service asks for, whichever route asks: `units` = UTF-16 units read.
const fp = vi.hoisted(() => ({ elem: 0, units: 0 }))

vi.mock('../listFingerprint', async (importOriginal) => {
    const real = await importOriginal<typeof import('../listFingerprint')>()
    const counted = (value: unknown): number => {
        fp.elem += 1
        fp.units += typeof value === 'string' ? value.length : 0
        return real.fingerprintElement(value)
    }
    return {
        fingerprintElement: counted,
        mixElementHashes: real.mixElementHashes,
        listFingerprintOf: (list: readonly unknown[], elementHash: (value: unknown) => number = counted) => {
            const hashes = new Array<number>(list.length)
            for (let i = 0; i < list.length; i++) hashes[i] = elementHash(list[i])
            return real.mixElementHashes(hashes)
        },
    }
})

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
    }
})

interface LiveCharacter {
    chaId: string
    license?: string
    desc: string
    alternateGreetings: string[]
    chats: { id?: string; note: string; fmIndex?: number }[]
    chatPage: number
}

function makeCharacter(chaId: string, greetings: string[], overrides: Partial<LiveCharacter> = {}): LiveCharacter {
    return { chaId, desc: 'd0', alternateGreetings: greetings, chats: [{ id: 'c1', note: '', fmIndex: 1 }], chatPage: 0, ...overrides }
}

function putCharacters(...characters: LiveCharacter[]): void {
    DBState.db.characters = characters as unknown as typeof DBState.db.characters
}

function live(chaId = 'A'): LiveCharacter {
    return (DBState.db.characters as unknown as LiveCharacter[]).find((c) => c.chaId === chaId) as LiveCharacter
}

const A = characterOwnerKey('A')

interface Idle {
    queue: { run: (remainingMs: () => number) => void; cancelled: boolean }[]
    scheduled: number
    schedule: (run: (remainingMs: () => number) => void) => () => void
    flush(ms: number): void
}

function fakeIdle(): Idle {
    const idle: Idle = {
        queue: [],
        scheduled: 0,
        schedule(run) {
            const entry = { run, cancelled: false }
            idle.queue.push(entry)
            idle.scheduled += 1
            return () => {
                entry.cancelled = true
            }
        },
        flush(ms) {
            let guard = 0
            while (idle.queue.length > 0 && guard++ < 10_000) {
                const entry = idle.queue.shift()!
                if (!entry.cancelled) entry.run(() => ms)
            }
        },
    }
    return idle
}

let clock: FakeClock
let store: MemoryStudioStore
let service: OwnerHistoryService
let idle: Idle

function build(withIdle: boolean, elementHashCache?: ElementHashCache): void {
    clock = createFakeClock()
    store = createMemoryStudioStore()
    idle = fakeIdle()
    const deps = {
        store,
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        ...(withIdle ? { scheduleIdle: idle.schedule } : {}),
        ...(elementHashCache ? { elementHashCache } : {}),
    }
    service = createOwnerHistoryService(deps)
}

function reset(): void {
    fp.elem = 0
    fp.units = 0
}

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const texts = (n: number, length: number, tag = 'g') => Array.from({ length: n }, (_, i) => `${tag}${i}:`.padEnd(length, 'x'))

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    reset()
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('S-R1 an action on unchanged first messages reads none of their text again', () => {
    test('delete, undo, redo, delete, Restore deleted, add', async () => {
        putCharacters(makeCharacter('A', texts(6, 40)))
        build(false)
        await service.whenReady(A)
        expect(service.greetingDelete(A, 1).ok).toBe(true)
        // The first action of the page reads every message once.
        expect(fp.units).toBe(240)
        reset()
        expect(service.undo(A).ok).toBe(true)
        expect(service.redo(A).ok).toBe(true)
        clock.tick(COALESCE_MS)
        expect(service.greetingDelete(A, 0).ok).toBe(true)
        const deleted = service.view(A).deleted.at(-1)!.id
        expect(service.restoreDeleted(A, deleted).ok).toBe(true)
        expect(service.greetingAdd(A).ok).toBe(true)
        expect(fp.units).toBe(0)
    })

    test('typing hashes nothing; the next action reads only the edited message', async () => {
        putCharacters(makeCharacter('A', texts(6, 40)))
        build(false)
        await service.whenReady(A)
        expect(service.greetingDelete(A, 5).ok).toBe(true)
        reset()
        const typed = 'typed'.padEnd(70, 'y')
        expect(service.greetingEdit(A, 2, typed).ok).toBe(true)
        expect(fp.units).toBe(0)
        clock.tick(COALESCE_MS)
        expect(service.greetingDelete(A, 0).ok).toBe(true)
        expect(fp.units).toBe(70)
    })

    test('a revert across deletes of known messages reads no message text', async () => {
        putCharacters(makeCharacter('A', texts(6, 40)))
        build(false)
        await service.whenReady(A)
        service.editField(A, 'desc', 'anchor')
        const anchor = service.view(A).done[0].id
        for (let i = 0; i < 3; i++) {
            clock.tick(COALESCE_MS)
            expect(service.greetingDelete(A, 0).ok).toBe(true)
        }
        reset()
        expect(service.revertTo(A, anchor).ok).toBe(true)
        expect(live().alternateGreetings).toEqual(texts(6, 40))
        expect(fp.units).toBe(0)
    })
})

describe('S-W warm-up at card open', () => {
    test('W1 after the idle warm-up the first action reads no message text', async () => {
        putCharacters(makeCharacter('A', texts(6, 40)))
        build(true)
        service.useOwner(A)
        idle.flush(50)
        expect(fp.units).toBe(240)
        await service.whenReady(A)
        reset()
        expect(service.greetingDelete(A, 1).ok).toBe(true)
        expect(fp.units).toBe(0)
    })

    test('W2 never during typing: a write cancels the pending warm-up and nothing restarts it', async () => {
        putCharacters(makeCharacter('A', texts(6, 40)))
        build(true)
        service.useOwner(A)
        await service.whenReady(A)
        expect(idle.queue.length).toBe(1)
        const scheduled = idle.scheduled
        const typed = 'typed'.padEnd(70, 'y')
        expect(service.greetingEdit(A, 3, typed).ok).toBe(true)
        expect(idle.queue[0].cancelled).toBe(true)
        expect(idle.scheduled).toBe(scheduled)
        reset()
        idle.flush(50)
        expect(fp.units).toBe(0)
        expect(idle.scheduled).toBe(scheduled)
        clock.tick(COALESCE_MS)
        expect(service.greetingDelete(A, 0).ok).toBe(true)
        // Left to the first action: the whole list, once (MC-1431).
        expect(fp.units).toBe(270)
    })

    test('W2d the warm-up hashes the texts held at open, not a later change made outside the history', async () => {
        putCharacters(makeCharacter('A', texts(6, 40)))
        build(true)
        service.useOwner(A)
        await service.whenReady(A)
        live().alternateGreetings[3] = 'outside'.padEnd(70, 'o')
        idle.flush(50)
        expect(fp.units).toBe(240)
        reset()
        expect(service.greetingDelete(A, 0).ok).toBe(true)
        expect(fp.units).toBe(70)
    })

    test('W2c a write between two chunks ends the job: the rest stays cold', async () => {
        putCharacters(makeCharacter('A', texts(6, 40_000)))
        build(true)
        service.useOwner(A)
        await service.whenReady(A)
        idle.queue.shift()!.run(() => 50)
        expect(fp.units).toBe(40_000)
        expect(idle.queue.length).toBe(1)
        expect(service.editField(A, 'desc', 'typed').ok).toBe(true)
        expect(idle.queue[0].cancelled).toBe(true)
        reset()
        idle.flush(50)
        expect(fp.units).toBe(0)
    })

    test('W10 every kind of write cancels, including a refused one and another owner\'s', async () => {
        putCharacters(makeCharacter('A', texts(6, 40)))
        build(true)
        await service.whenReady(A)
        const writes: (() => unknown)[] = [
            () => service.editField(A, 'desc', 'x'),
            () => service.greetingAdd(A),
            () => service.undo(A),
            () => service.redo(A),
            () => service.undo(chatOwnerKey('A', 'missing')),
        ]
        for (const write of writes) {
            service.useOwner(A)
            const job = idle.queue[idle.queue.length - 1]
            expect(job.cancelled).toBe(false)
            write()
            expect(job.cancelled).toBe(true)
        }
    })

    test('W12a cancelWarm (input in Studio that is not a history write) ends the pending warm-up; nothing restarts it', async () => {
        putCharacters(makeCharacter('A', texts(6, 40)))
        build(true)
        service.useOwner(A)
        await service.whenReady(A)
        const scheduled = idle.scheduled
        service.cancelWarm()
        expect(idle.queue[0].cancelled).toBe(true)
        service.cancelWarm()
        reset()
        idle.flush(50)
        expect(fp.units).toBe(0)
        expect(idle.scheduled).toBe(scheduled)
        // Left to the first action: the whole list, once (MC-1431).
        expect(service.greetingDelete(A, 0).ok).toBe(true)
        expect(fp.units).toBe(240)
    })

    test('W9 the end of the owner\'s visit cancels its pending warm-up; another character\'s does not', async () => {
        putCharacters(makeCharacter('A', texts(6, 40)), makeCharacter('B', texts(4, 30, 'b')))
        build(true)
        service.useOwner(A)
        service.setAck('B', null)
        expect(idle.queue[0].cancelled).toBe(false)
        service.setAck('A', null)
        expect(idle.queue[0].cancelled).toBe(true)
        reset()
        idle.flush(50)
        expect(fp.units).toBe(0)
    })

    test('W7 one idle callback spends at most WARM_CHUNK_MS, even when the idle period is longer', async () => {
        // 40,000 units: about 4.8 ms each by the estimate, so one chunk holds one of them.
        putCharacters(makeCharacter('A', texts(6, 40_000)))
        build(true)
        service.useOwner(A)
        idle.flush(50)
        expect(idle.scheduled).toBe(6)
        expect(fp.units).toBe(240_000)
        await service.whenReady(A)
        reset()
        expect(service.greetingDelete(A, 1).ok).toBe(true)
        expect(fp.units).toBe(0)
    })

    test('W2b never on typing or on an action once the warm-up has finished', async () => {
        putCharacters(makeCharacter('A', texts(6, 40)))
        build(true)
        service.useOwner(A)
        await service.whenReady(A)
        idle.flush(50)
        expect(idle.queue.length).toBe(0)
        const scheduled = idle.scheduled
        expect(service.greetingEdit(A, 3, 'typed'.padEnd(70, 'y')).ok).toBe(true)
        expect(service.greetingEdit(A, 3, 'typed'.padEnd(71, 'y')).ok).toBe(true)
        expect(idle.scheduled).toBe(scheduled)
        clock.tick(COALESCE_MS)
        expect(service.greetingDelete(A, 0).ok).toBe(true)
        expect(service.undo(A).ok).toBe(true)
        expect(service.redo(A).ok).toBe(true)
        expect(service.greetingAdd(A).ok).toBe(true)
        expect(idle.scheduled).toBe(scheduled)
        expect(idle.queue.length).toBe(0)
    })

    test('W5b a new visit after the warm-up finished warms again, once', async () => {
        putCharacters(makeCharacter('A', texts(6, 40)))
        build(true)
        service.useOwner(A)
        await service.whenReady(A)
        idle.flush(50)
        const scheduled = idle.scheduled
        // Changed outside the history, so no write ends anything: only the finished job's own end lets
        // the next visit warm.
        live().alternateGreetings[3] = 'typed'.padEnd(70, 'y')
        service.useOwner(A)
        service.useOwner(A)
        expect(idle.scheduled).toBe(scheduled + 1)
        reset()
        idle.flush(50)
        expect(fp.units).toBe(70)
    })

    test('W7b one idle callback also stops at WARM_CHUNK_MS by the clock when the work runs slower than the estimate', async () => {
        putCharacters(makeCharacter('A', texts(30, 40)))
        build(true)
        service.useOwner(A)
        // Every read of the remaining time reports one millisecond less, as if each element took 1 ms.
        let left = 50
        idle.queue.shift()!.run(() => (left -= 1))
        expect(fp.elem).toBeGreaterThan(0)
        expect(fp.elem).toBeLessThanOrEqual(9)
        expect(idle.queue.length).toBe(1)
    })

    test('W7c the chunk estimate carries a fixed part per element, so many tiny elements still end a chunk', async () => {
        putCharacters(makeCharacter('A', texts(400, 6)))
        build(true)
        service.useOwner(A)
        // The clock reports a constant 50 ms, so only the estimate can end the chunk.
        idle.queue.shift()!.run(() => 50)
        const perChunk = Math.floor(WARM_CHUNK_MS / (6 * WARM_MS_PER_UNIT + WARM_MS_PER_ELEMENT))
        expect(fp.elem).toBeGreaterThanOrEqual(perChunk - 1)
        expect(fp.elem).toBeLessThanOrEqual(perChunk + 1)
        expect(idle.queue.length).toBe(1)
    })

    test('W3d the count of yields belongs to one element: a later element is skipped after yields of its own', async () => {
        const big = 'big'.padEnd(50_000, 'z')
        putCharacters(makeCharacter('A', [big, big.replace('big', 'bag')]))
        build(true)
        service.useOwner(A)
        let runs = 0
        while (idle.queue.length > 0 && runs < 50) {
            idle.queue.shift()!.run(() => 5)
            runs += 1
        }
        // Each element yields WARM_MAX_YIELDS chunks and is skipped on the next one.
        expect(runs).toBe(2 * (WARM_MAX_YIELDS + 1) - 1)
        expect(fp.units).toBe(0)
    })

    test('W3e a warmed element also starts the next one with no yields counted', async () => {
        const big = 'big'.padEnd(50_000, 'z')
        putCharacters(makeCharacter('A', [big, 'small'.padEnd(40, 'x'), big.replace('big', 'bag')]))
        build(true)
        service.useOwner(A)
        // One short idle period makes the first element yield; a long one then warms it and the small one.
        idle.queue.shift()!.run(() => 5)
        idle.queue.shift()!.run(() => 50)
        let runs = 2
        while (idle.queue.length > 0 && runs < 50) {
            idle.queue.shift()!.run(() => 5)
            runs += 1
        }
        expect(fp.units).toBe(50_040)
        expect(runs).toBe(2 + WARM_MAX_YIELDS + 1)
    })

    test('W3 a message too long for the idle time yields, then is left to the action', async () => {
        const greetings = ['big'.padEnd(50_000, 'z'), ...texts(3, 40)]
        putCharacters(makeCharacter('A', greetings))
        build(true)
        service.useOwner(A)
        idle.flush(5)
        expect(idle.scheduled).toBeGreaterThanOrEqual(4)
        await service.whenReady(A)
        reset()
        expect(service.greetingDelete(A, 1).ok).toBe(true)
        expect(fp.units).toBe(50_000)
    })

    test('W3b the same message is warmed when the idle period has room', async () => {
        putCharacters(makeCharacter('A', ['big'.padEnd(50_000, 'z'), ...texts(3, 40)]))
        build(true)
        service.useOwner(A)
        idle.flush(50)
        await service.whenReady(A)
        reset()
        expect(service.greetingDelete(A, 1).ok).toBe(true)
        expect(fp.units).toBe(0)
    })

    test('W3c a message over one chunk is left to the action even when the idle period is long', async () => {
        putCharacters(makeCharacter('A', ['big'.padEnd(100_000, 'z'), ...texts(3, 40)]))
        build(true)
        service.useOwner(A)
        idle.flush(50)
        await service.whenReady(A)
        reset()
        expect(service.greetingDelete(A, 1).ok).toBe(true)
        expect(fp.units).toBe(100_000)
    })

    test('W4 a chat owner warms nothing', async () => {
        putCharacters(makeCharacter('A', texts(6, 40)))
        build(true)
        service.useOwner(chatOwnerKey('A', 'c1'))
        expect(idle.scheduled).toBe(0)
    })

    test('W4b a private character warms nothing', async () => {
        putCharacters(makeCharacter('A', texts(6, 40), { license: 'private' }))
        build(true)
        service.useOwner(A)
        expect(idle.scheduled).toBe(0)
    })

    test('W5 a second open of the same card while warming starts nothing; another card cancels it', async () => {
        putCharacters(makeCharacter('A', texts(6, 40)), makeCharacter('B', texts(4, 30, 'b')))
        build(true)
        service.useOwner(A)
        service.useOwner(A)
        expect(idle.scheduled).toBe(1)
        studioScreen.chaId = 'B'
        selIdState.selId = 1
        service.useOwner(characterOwnerKey('B'))
        expect(idle.queue[0].cancelled).toBe(true)
        expect(idle.scheduled).toBe(2)
    })

    test('W6 the warm-up changes nothing a user or the store can see', async () => {
        putCharacters(makeCharacter('A', texts(6, 40)))
        build(true)
        service.useOwner(A)
        await service.whenReady(A)
        const before = JSON.stringify({ chars: DBState.db.characters, view: service.view(A), counts: store.counts, marks: h.marks })
        idle.flush(50)
        await clock.advance(10_000)
        expect(JSON.stringify({ chars: DBState.db.characters, view: service.view(A), counts: store.counts, marks: h.marks })).toBe(before)
    })
})

describe('S-X a card larger than the cache', () => {
    test('its passes look up but store nothing', async () => {
        // Imported here, so the rest of this file also runs where the cache module does not exist.
        const modulePath = '../elementHashCache'
        const { createElementHashCache } = (await import(/* @vite-ignore */ modulePath)) as typeof import('../elementHashCache')
        const cache = createElementHashCache({ maxUnits: 100, maxEntries: 50, maxEntryUnits: 100 })
        putCharacters(makeCharacter('A', texts(3, 40)))
        build(false, cache)
        await service.whenReady(A)
        expect(service.greetingDelete(A, 1).ok).toBe(true)
        expect(cache.stats().entries).toBe(0)
        // Two messages (80 units) now fit: the next action stores them.
        clock.tick(COALESCE_MS)
        expect(service.undo(A).ok).toBe(true)
        expect(cache.stats().entries).toBeGreaterThan(0)
    })
})

describe('S-D default-built service (MC-1492)', () => {
    async function secondDeleteUnits(count: number): Promise<number> {
        putCharacters(makeCharacter('A', texts(count, 8)))
        build(false)
        await service.whenReady(A)
        expect(service.greetingDelete(A, 0).ok).toBe(true)
        reset()
        clock.tick(COALESCE_MS)
        expect(service.greetingDelete(A, 0).ok).toBe(true)
        return fp.units
    }

    test('D3a a card one over the default entry limit reads the whole list at every action', async () => {
        expect(await secondDeleteUnits(4_098)).toBeGreaterThanOrEqual(4_097 * 8)
    })

    test('D3b a card at the default entry limit reads nothing on the second action', async () => {
        expect(await secondDeleteUnits(4_096)).toBe(0)
    })
})

describe('S-P the warm-up is one pass', () => {
    test('W11 a warm-up right after other cards were used keeps the card it warmed for its first action', async () => {
        const modulePath = '../elementHashCache'
        const { createElementHashCache } = (await import(/* @vite-ignore */ modulePath)) as typeof import('../elementHashCache')
        const cache = createElementHashCache({ maxUnits: 2_000, maxEntries: 200, maxEntryUnits: 1_000 })
        const ids = ['A', 'B', 'C']
        putCharacters(...ids.map((chaId) => makeCharacter(chaId, texts(22, 40, chaId.toLowerCase()))))
        build(true, cache)
        let worst = 0
        for (let visit = 0; visit < 6; visit++) {
            const chaId = ids[visit % 3]
            studioScreen.chaId = chaId
            selIdState.selId = visit % 3
            const owner = characterOwnerKey(chaId)
            service.useOwner(owner)
            idle.flush(50)
            await service.whenReady(owner)
            reset()
            clock.tick(COALESCE_MS)
            expect(service.greetingDelete(owner, 0).ok).toBe(true)
            expect(service.undo(owner).ok).toBe(true)
            worst = Math.max(worst, fp.units)
        }
        expect(worst).toBeLessThanOrEqual(40)
    })

    test('W16 the warm-up job is one pass however many idle chunks it takes', async () => {
        const modulePath = '../elementHashCache'
        const { createElementHashCache } = (await import(/* @vite-ignore */ modulePath)) as typeof import('../elementHashCache')
        const real = createElementHashCache()
        let passes = 0
        const cache: ElementHashCache = {
            hash: real.hash,
            stats: real.stats,
            forList(list, scope) {
                passes += 1
                return real.forList(list, scope)
            },
        }
        // 40,000 units each: one element per chunk by the estimate, so the job takes six chunks.
        putCharacters(makeCharacter('A', texts(6, 40_000)))
        build(true, cache)
        service.useOwner(A)
        idle.flush(50)
        expect(idle.scheduled).toBe(6)
        expect(passes).toBe(1)
    })
})

describe('S-P2 what the warm-up stored belongs to its pass', () => {
    test('W14 a sweep in the first action keeps the texts the warm-up just read', async () => {
        const modulePath = '../elementHashCache'
        const { createElementHashCache } = (await import(/* @vite-ignore */ modulePath)) as typeof import('../elementHashCache')
        // 6 x 40 units in a 250-unit cache: a changed message does not fit beside the warmed ones.
        const cache = createElementHashCache({ maxUnits: 250, maxEntries: 50, maxEntryUnits: 100 })
        putCharacters(makeCharacter('A', texts(6, 40)))
        build(true, cache)
        service.useOwner(A)
        idle.flush(50)
        await service.whenReady(A)
        live().alternateGreetings[0] = 'outside'.padEnd(40, 'o')
        reset()
        expect(service.greetingDelete(A, 5).ok).toBe(true)
        // Only the changed message is read; the warmed ones survive the action's sweep.
        expect(fp.units).toBe(40)
    })
})

describe('S-V stored values with the cache equal the plain fingerprints', () => {
    test('a delete, its undo and a revert store the exact fingerprints', async () => {
        const start = texts(6, 40)
        putCharacters(makeCharacter('A', [...start]))
        build(false)
        await service.whenReady(A)
        service.editField(A, 'desc', 'anchor')
        const anchor = service.view(A).done[0].id
        clock.tick(COALESCE_MS)
        service.greetingDelete(A, 2)
        const real = await vi.importActual<typeof import('../listFingerprint')>('../listFingerprint')
        expect(service.view(A).done.at(-1)!.listFingerprint).toStrictEqual({
            before: real.listFingerprintOf(start),
            after: real.listFingerprintOf(start.filter((_, i) => i !== 2)),
        })
        clock.tick(COALESCE_MS)
        service.greetingDelete(A, 0)
        const before = [...live().alternateGreetings]
        expect(service.revertTo(A, anchor).ok).toBe(true)
        expect(service.view(A).done.at(-1)!.listFingerprint).toStrictEqual({ before: real.listFingerprintOf(before), after: real.listFingerprintOf(start) })
    })
})
