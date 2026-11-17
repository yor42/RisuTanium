/**
 * What the packing jobs of `readStubsForExport` keep reachable while the loop still runs: a consumed stub whose job has
 * settled keeps neither its character nor its encoded body, and no more than four jobs are live at once.
 *
 * Reachability is read with forced GC and `WeakRef`s (the technique of storeImportRetention.svelte.test.ts and
 * dbWriteHook.gc.svelte.test.ts). V8 may keep one stale value in the saved registers of a suspended async function, so the
 * check allows one live character and one live body among the eleven consumed stubs; a retention mutant leaves all eleven.
 * The file uses no `vi.fn` or `vi.spyOn` on the read mock, `TextEncoder`, the worker or the probe: their call records would
 * keep the targets alive.
 *
 * The probe seam is looked up on the module namespace, as exportReadAhead.test.ts looks up `STUB_READ_AHEAD`, so the
 * reachability part also runs against the collection before the worker (calibration of the harness: at most one live
 * character and no live body among consumed stubs, whatever the collection).
 *
 * Labels: (new behaviour) names something that does not exist before the change, so it is shown by mutating the
 * implementation, not by a red base.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import v8 from 'node:v8'
import vm from 'node:vm'
import type { ColdCopyOutcome } from 'src/ts/process/coldCharacterRestore'
import * as exportInline from 'src/ts/drive/exportInline'
import { readStubsForExport, unpackStubEntry } from 'src/ts/drive/exportInline'
import { handlePackMessage } from 'src/ts/drive/stubPackWorker'
import type { character } from 'src/ts/storage/database.svelte'
import { installFakePackWorker, type FakePackController } from './fakePackWorker'

interface ProbeEvent { records: number, characters: number, bytes: number }

const setProbe = (exportInline as { setStubPackProbeForTest?: (probe: ((event: ProbeEvent) => void) | null) => void }).setStubPackProbeForTest

interface Deferred {
    promise: Promise<void>
    resolve: () => void
}

const harness = vi.hoisted(() => ({
    /** The characters and encoded bodies made since the last conversion to weak references. */
    pendingRefs: [] as Array<{ kind: 'character' | 'body', target: object }>,
    started: [] as string[],
    gatedUnit: '',
    gate: null as null | { promise: Promise<void>, resolve: () => void },
}))

vi.mock('src/ts/process/coldCharacterRestore', () => ({
    readColdCharacterCopy: async (slot: { coldstorage: string }): Promise<ColdCopyOutcome> => {
        harness.started.push(slot.coldstorage)
        if (slot.coldstorage === harness.gatedUnit && harness.gate !== null) {
            await harness.gate.promise
        }
        const made = characterOf(Number.parseInt(slot.coldstorage, 32))
        harness.pendingRefs.push({ kind: 'character', target: made })
        return { status: 'ok', character: made } as unknown as ColdCopyOutcome
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

const BODY_MIN_BYTES = 64 * 1024
const STUBS = 12

function unit(n: number): string {
    return n.toString(32).padStart(26, '0')
}

/** A character with a 64 KiB description that differs by `n`. */
function characterOf(n: number): Record<string, unknown> {
    return { chaId: `cha${n}`, name: `whole-${unit(n)}`, description: `${n}`.repeat(1) + 'abcdefghij'.repeat(6600) }
}

function expectedBody(n: number): Uint8Array {
    return new TextEncoder().encode(JSON.stringify({ character: characterOf(n) }))
}

function deferred(): Deferred {
    let resolve = () => { }
    const promise = new Promise<void>((done) => { resolve = done })
    return { promise, resolve }
}

async function turn(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

const gc = (() => {
    v8.setFlagsFromString('--expose-gc')
    return vm.runInNewContext('gc') as () => void
})()

const originalEncode = TextEncoder.prototype.encode
let controller: FakePackController | null = null

beforeEach(() => {
    harness.pendingRefs.length = 0
    harness.started.length = 0
    harness.gatedUnit = unit(STUBS)
    harness.gate = deferred()
    TextEncoder.prototype.encode = function encodeAndNote(this: TextEncoder, input?: string): Uint8Array<ArrayBuffer> {
        const encoded = originalEncode.call(this, input)
        harness.pendingRefs.push({ kind: 'body', target: encoded })
        return encoded
    }
})

afterEach(() => {
    TextEncoder.prototype.encode = originalEncode
    setProbe?.(null)
    controller?.uninstall()
    controller = null
    harness.gate?.resolve()
    harness.gate = null
})

describe('the live packing jobs during the loop', () => {
    test('(new behaviour) once their jobs settle, the eleven consumed stubs keep at most one character and one body reachable, and no more than four jobs were ever live', async () => {
        controller = installFakePackWorker({ pack: handlePackMessage })
        const events: ProbeEvent[] = []
        setProbe?.((event) => { events.push(event) })
        const slots = Array.from({ length: STUBS }, (_, i) => ({ chaId: `cha${i + 1}`, name: `stub-${i + 1}`, coldstorage: unit(i + 1) }) as unknown as character)

        const done = readStubsForExport({ characters: slots } as never, { mode: 'stub' })
        for (let i = 0; i < 30 && !(harness.started.includes(unit(STUBS)) && (setProbe === undefined || events[events.length - 1]?.records === 0)); i++) {
            await turn()
        }
        expect(harness.started).toContain(unit(STUBS))
        if (setProbe !== undefined) {
            expect(events.length).toBeGreaterThan(0)
            expect(events[events.length - 1]?.records).toBe(0)
            for (const event of events) {
                expect(event.characters).toBeLessThanOrEqual(event.records)
                expect(event.records).toBeLessThanOrEqual(4)
            }
        }

        // The weak references are made in a later macrotask than the jobs that created their targets.
        const refs: Array<{ kind: 'character' | 'body', ref: WeakRef<object> }> = []
        await new Promise<void>((resolve) => setTimeout(() => {
            for (const pending of harness.pendingRefs) {
                refs.push({ kind: pending.kind, ref: new WeakRef(pending.target) })
            }
            harness.pendingRefs.length = 0
            resolve()
        }, 0))
        gc()
        await turn()
        gc()
        await turn()

        const characters = refs.filter((entry) => entry.kind === 'character')
        const bodies = refs.filter((entry) => entry.kind === 'body' && entry.ref.deref() !== undefined && (entry.ref.deref() as Uint8Array).byteLength > BODY_MIN_BYTES)
        const allBodies = refs.filter((entry) => entry.kind === 'body')
        expect(characters).toHaveLength(STUBS - 1)
        expect(allBodies.length).toBeGreaterThanOrEqual(STUBS - 1)
        expect(characters.filter((entry) => entry.ref.deref() !== undefined).length).toBeLessThanOrEqual(1)
        expect(bodies.length).toBeLessThanOrEqual(1)

        TextEncoder.prototype.encode = originalEncode
        harness.gate?.resolve()
        const result = await done
        expect(result.stubEntries.size).toBe(STUBS)
        for (let n = 1; n <= STUBS; n++) {
            const entry = result.stubEntries.get(exportInline.inlineKeyOf(unit(n), `cha${n}`))
            expect(entry).toBeDefined()
            if (entry !== undefined) {
                expect(Array.from(unpackStubEntry(entry))).toEqual(Array.from(expectedBody(n)))
            }
        }
    })
})
