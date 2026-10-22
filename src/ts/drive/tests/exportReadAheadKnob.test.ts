/**
 * The measurement-build knob `risu-measure-export-readahead` of `readStubsForExport` (`drive/exportInline.ts`): a stored
 * integer 0 to 3 replaces `STUB_READ_AHEAD` for the export's stub collection, an explicit `readAhead` option wins over it,
 * and any other stored value means the default. A normal build (`MEASURE` false) ignores the key.
 *
 * `readColdCharacterCopy` is replaced by a fake store that holds every first read until the test releases it, so the
 * number of reads started while the consumer waits on slot 0 is the read-ahead plus one. A pass here says nothing about
 * the speed of the native store.
 *
 * Labels: (R) fails against the base, where the key is ignored; (G) is a compatibility guard that passes with or
 * without the change.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ColdCopyOutcome } from 'src/ts/process/coldCharacterRestore'
import * as exportInline from 'src/ts/drive/exportInline'
import { readStubsForExport, type ExportCollectionOptions } from 'src/ts/drive/exportInline'
import type { character } from 'src/ts/storage/database.svelte'

type Slot = character

const KEY = 'risu-measure-export-readahead'

interface Deferred {
    promise: Promise<void>
    resolve: () => void
}

function deferred(): Deferred {
    let resolve = () => { }
    const promise = new Promise<void>((done) => { resolve = done })
    return { promise, resolve }
}

const flags = vi.hoisted(() => ({ measure: true }))

const store = vi.hoisted(() => ({
    started: [] as string[],
    gates: new Map<string, unknown>(),
}))

vi.mock('src/ts/process/memory/measureFlag', () => ({
    get MEASURE() {
        return flags.measure
    },
}))

vi.mock('src/ts/process/coldCharacterRestore', () => {
    return {
        readColdCharacterCopy: async (slot: { coldstorage: string }): Promise<ColdCopyOutcome> => {
            const u = slot.coldstorage
            store.started.push(u)
            let gate = store.gates.get(u) as Deferred | undefined
            if (gate === undefined) {
                gate = deferred()
                store.gates.set(u, gate)
            }
            await gate.promise
            return { status: 'ok', character: { ...slot, name: `whole-${u}`, coldstorage: undefined } } as ColdCopyOutcome
        },
    }
})

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

function unit(n: number): string {
    return n.toString(32).padStart(26, '0')
}

function stub(n: number): Slot {
    return { chaId: `cha${n}`, name: `stub-${n}`, coldstorage: unit(n) } as unknown as Slot
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

/** The reads started while every first read is held, with `stored` as the knob (`null`: no key). */
async function readsStarted(stored: string | null, options: ExportCollectionOptions = {}): Promise<number> {
    vi.stubGlobal('localStorage', { getItem: (key: string) => (key === KEY ? stored : null) })
    const slots = Array.from({ length: 8 }, (_, i) => stub(i + 1))
    const done = readStubsForExport({ characters: slots } as never, { mode: 'inline', ...options })
    await turns()
    const started = store.started.length
    for (const slot of slots) {
        release(slot.coldstorage as string)
    }
    await done
    return started
}

beforeEach(() => {
    flags.measure = true
    store.started.length = 0
    store.gates.clear()
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('the export read-ahead knob', () => {
    test('(R) the key 0 reads the stubs one at a time', async () => {
        expect(await readsStarted('0')).toBe(1)
    })

    test('(R) the key 1 and 2 start that many reads beyond the one being consumed', async () => {
        expect(await readsStarted('1')).toBe(2)
        store.started.length = 0
        store.gates.clear()
        expect(await readsStarted('2')).toBe(3)
    })

    test('(G) with no key the default read-ahead applies', async () => {
        expect(await readsStarted(null)).toBe(exportInline.STUB_READ_AHEAD + 1)
    })

    test.each(['-1', '4', '1.5', 'abc', '', ' 1', '1 ', '01', '1e0', 'NaN'])('(G) the out-of-range or malformed value %j means the default', async (stored) => {
        expect(await readsStarted(stored)).toBe(exportInline.STUB_READ_AHEAD + 1)
    })

    test('(G) an unreadable storage means the default', async () => {
        vi.stubGlobal('localStorage', { getItem: () => { throw new Error('storage is blocked') } })
        const slots = Array.from({ length: 8 }, (_, i) => stub(i + 1))
        const done = readStubsForExport({ characters: slots } as never, { mode: 'inline' })
        await turns()
        const started = store.started.length
        for (const slot of slots) {
            release(slot.coldstorage as string)
        }
        await done
        expect(started).toBe(exportInline.STUB_READ_AHEAD + 1)
    })

    test('an explicit readAhead option wins over the key, whichever is larger', async () => {
        expect(await readsStarted('0', { readAhead: 2 })).toBe(3)
        store.started.length = 0
        store.gates.clear()
        expect(await readsStarted('3', { readAhead: 0 })).toBe(1)
    })

    test('the effective value is the one the stats report', async () => {
        await readsStarted('1')
        expect(exportInline.takeStubReadStats()?.ahead).toBe(1)
    })

    test('(G) on a normal build (MEASURE false) the key is ignored', async () => {
        flags.measure = false
        expect(await readsStarted('0')).toBe(exportInline.STUB_READ_AHEAD + 1)
    })
})

describe('parseReadAheadKnob', () => {
    test('accepts the integers 0 to 3 and nothing else', () => {
        expect(['0', '1', '2', '3'].map(exportInline.parseReadAheadKnob)).toEqual([0, 1, 2, 3])
        expect([null, '-1', '4', '1.5', 'abc', ''].map(exportInline.parseReadAheadKnob)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined])
    })
})
