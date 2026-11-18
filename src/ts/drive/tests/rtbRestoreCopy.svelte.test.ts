/**
 * The copy stage of a `.rtb` restore (CHORE-128 S12a-1): `copyRtbEntries` over a real writer file, verified and planned by
 * S11's own `verifyRtb` and `planAssets`, against an in-memory byte store that logs every call and keeps a piece writer's
 * value invisible until `finish`. The CHORE-830 note and the deletion hold are the real ones.
 *
 * Labels: every test is a compatibility guard of a new contract (no pre-fix base: main has no `.rtb` restore copy); each
 * names the scratch mutant it turns red on. A fake store's success says nothing about a native store (the device rows
 * cover that).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { get } from 'svelte/store'
import { alertStore } from 'src/ts/stores.svelte'
import { listAssetsWrittenThisPage, noteAndSettleAssetWrite } from 'src/ts/globalApi.svelte'
import { assetEntryName } from 'src/ts/drive/rtb/assetName'
import { inlayEntryNames } from 'src/ts/drive/rtb/inlayEntries'
import { RestoreAssetPipeline } from 'src/ts/drive/assetBatchPipeline'
import { copyRtbEntries, withCopiedKept, type CopyEnd, type RtbCopyDeps, type RtbCopyPlan } from 'src/ts/drive/rtbRestoreCopy'
import { beginBusy, type BusyHandle } from 'src/ts/process/memory/busyActions'
import { inlayMetaKey } from 'src/ts/process/files/inlayKeys'
import { readAppInlayBody, type InlayRecord } from 'src/ts/process/files/inlayStore'
import { holdAssetDeletion, resetAssetDeleteHoldForTests } from 'src/ts/storage/assetDeleteHold'
import { StoreInvalidKeyError, UploadGoneError } from 'src/ts/storage/store/errors'
import { NodeHttpError } from 'src/ts/storage/store/nodeHttpStore'
import { rtbWorld, type RtbWorld } from 'src/ts/storage/tests/store2/rtbFixtures'
import { dataRangeOf, inlayFixture, loggedSource, withBrokenCrc, withBrokenDeflate, writeRtbFile, type InlayFixture } from './rtb/rtbRestoreFixtures'
import { MemoryByteStore, planOfBytes, type PlanOptions } from './rtb/rtbInstallFixtures'

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))
// The world fixture's Node-server helper resolves a file URL that the DOM environment's URL class refuses; this file never starts a server.
vi.mock('src/ts/storage/tests/nodeServerFixture', () => ({ startNodeServer: vi.fn() }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: {} },
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        botMakerMode: writable(false),
        loadedStore: writable(false),
        LoadingStatusState: { text: '' },
        ReloadGUIPointer: writable(0),
        bodyIntercepterStore: writable(null),
        savingStoppedReason: writable(''),
        frozenSaveKeysStore: writable([]),
    } as unknown as typeof import('src/ts/stores.svelte')
})

const encoder = new TextEncoder()
const HASH = `${'a1'.repeat(32)}.png`
const LITERAL = 'logo.png'
const LITERAL_OTHER = 'sub/Banner.png'
const LITERAL_BIG = 'big-literal.png'
const ABSENT = 'new.png'
const IDB_DOT = '.hidden'
const INLAY_A = '0123abcd-0123-4123-a123-0123456789ab'
const INLAY_B = '0123abcd-0123-4123-a123-0123456789cd'
const INLAY_C = '0123abcd-0123-4123-a123-0123456789ef'
const INLAY_V = '0123abcd-0123-4123-a123-0123456789a1'

let world: RtbWorld
const busyHandles: BusyHandle[] = []

beforeAll(async () => {
    world = await rtbWorld({ layout: 1 })
})

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    resetAssetDeleteHoldForTests()
    alertStore.set({ type: 'none', msg: '' })
})

afterEach(() => {
    for (const handle of busyHandles.splice(0)) {
        handle.end()
    }
    resetAssetDeleteHoldForTests()
    vi.restoreAllMocks()
})

const bytesOf = (text: string): Uint8Array => encoder.encode(text)
const textOf = (bytes: Uint8Array | undefined): string | null => bytes === undefined ? null : new TextDecoder().decode(bytes)

async function fileOf(assets: Record<string, Uint8Array>, inlays: readonly InlayFixture[] = []): Promise<Uint8Array> {
    return (await writeRtbFile({ world, assets, inlays })).bytes
}

interface Run {
    end: CopyEnd
    store: MemoryByteStore
    errors: string[]
    waits: string[]
}

interface RunOptions {
    store?: MemoryByteStore
    plan?: RtbCopyPlan
    planOptions?: PlanOptions
    deps?: Partial<RtbCopyDeps>
}

/** Runs the copy with the page's alerts collected and no pipeline; the busy check is the real one unless `deps` replaces it. */
async function run(file: Uint8Array, options: RunOptions = {}): Promise<Run> {
    const store = options.store ?? new MemoryByteStore()
    const plan = options.plan ?? await planOfBytes(file, options.planOptions)
    const busy = beginBusy('backupLoad')
    const errors: string[] = []
    const waits: string[] = []
    try {
        const end = await copyRtbEntries(plan, { busy }, {
            store: async () => store,
            createPipeline: async () => null,
            error: (text) => { errors.push(text) },
            wait: (text) => { waits.push(text) },
            ...options.deps,
        })
        return { end, store, errors, waits }
    } finally {
        busy.end()
    }
}

const stoppedOf = (end: CopyEnd) => {
    if (end.kind !== 'stopped') {
        throw new Error('the copy did not stop')
    }
    return end
}

const copiedOf = (end: CopyEnd) => {
    if (end.kind !== 'copied') {
        throw new Error(`the copy ended ${end.kind} (${end.kind === 'stopped' ? end.cause : ''})`)
    }
    return end
}

function listingOf(sizes: Record<string, number>) {
    return { kind: 'tauri-sized' as const, items: Object.entries(sizes).map(([key, size]) => ({ key: `assets/${key}`, size })) }
}

describe('the CHORE-830 note (U1a)', () => {
    test('every key the copy reads, compares or writes is noted before its first store call, and stays in the page\'s written set (guard; MU2 fails it)', async () => {
        const file = await fileOf({ [HASH]: bytesOf('hash-body'), [LITERAL]: bytesOf('literal-body'), [LITERAL_BIG]: bytesOf('x'.repeat(20)), [ABSENT]: bytesOf('fresh') })
        const store = new MemoryByteStore({}, { [`assets/${LITERAL}`]: bytesOf('literal-body'), [`assets/${LITERAL_BIG}`]: bytesOf('y'.repeat(20)) })
        const listing = listingOf({ [LITERAL]: 12, [LITERAL_BIG]: 20 })
        const { end } = await run(file, {
            store,
            planOptions: { listing },
            deps: {
                chunkMax: 16,
                noteAndSettle: async (key) => {
                    store.log.push(`note:${key}`)
                    await noteAndSettleAssetWrite(key)
                },
            },
        })
        copiedOf(end)
        const keys = [`assets/${LITERAL}`, `assets/${LITERAL_BIG}`, `assets/${ABSENT}`, `assets/${HASH}`]
        for (const key of keys) {
            const note = store.log.indexOf(`note:${key}`)
            const firstCall = store.log.findIndex((entry) => entry.endsWith(`:${key}`) && !entry.startsWith('note:'))
            expect(note).toBeGreaterThanOrEqual(0)
            if (firstCall >= 0) {
                expect(note).toBeLessThan(firstCall)
            }
            expect(listAssetsWrittenThisPage()).toContain(key)
        }
    })

    test('a deletion pending when the copy starts settles before the first read or write of any key (guard; MU2 fails it)', async () => {
        const file = await fileOf({ [LITERAL]: bytesOf('literal-body') })
        const store = new MemoryByteStore({}, { [`assets/${LITERAL}`]: bytesOf('literal-body') })
        let finishDelete: () => void = () => undefined
        const pending = holdAssetDeletion(() => new Promise<void>((resolve) => { finishDelete = resolve }))
        const plan = await planOfBytes(file, { listing: listingOf({ [LITERAL]: 12 }) })
        const copying = run(file, { store, plan })
        try {
            await new Promise((resolve) => setTimeout(resolve, 20))
            expect(store.log).toEqual([])
        } finally {
            // A failed assertion above must not leave the run and its busy handle pending.
            finishDelete()
        }
        await pending
        copiedOf((await copying).end)
        expect(store.log[0]).toBe(`read:assets/${LITERAL}`)
    })
})

describe('skip modes (U2)', () => {
    test('equal hash names are never touched; a literal name of equal size is compared by CRC-32 up to the bound, skipped when equal and overwritten when not; a literal above the bound is written without a read (guard; MU3, MU4 fail it)', async () => {
        const file = await fileOf({
            [HASH]: bytesOf('hash-body'),
            [LITERAL]: bytesOf('literal-body'),
            [LITERAL_OTHER]: bytesOf('banner-body'),
            [LITERAL_BIG]: bytesOf('x'.repeat(20)),
            [ABSENT]: bytesOf('fresh'),
        })
        const store = new MemoryByteStore({}, {
            [`assets/${HASH}`]: bytesOf('whatever-9'),
            [`assets/${LITERAL}`]: bytesOf('literal-body'),
            [`assets/${LITERAL_OTHER}`]: bytesOf('BANNER-body'),
            [`assets/${LITERAL_BIG}`]: bytesOf('y'.repeat(20)),
        })
        const listing = listingOf({ [HASH]: 9, [LITERAL]: 12, [LITERAL_OTHER]: 11, [LITERAL_BIG]: 20 })
        const { end, waits } = await run(file, { store, planOptions: { listing }, deps: { chunkMax: 16 } })
        const copied = copiedOf(end)
        expect(store.log.filter((entry) => entry.endsWith(`assets/${HASH}`))).toEqual([])
        expect(store.log.filter((entry) => entry === `read:assets/${LITERAL}`)).toHaveLength(1)
        expect(store.log.filter((entry) => entry === `write:assets/${LITERAL}`)).toHaveLength(0)
        expect(textOf(store.files.get(`assets/${LITERAL_OTHER}`))).toBe('banner-body')
        expect(store.log).not.toContain(`read:assets/${LITERAL_BIG}`)
        expect(textOf(store.files.get(`assets/${LITERAL_BIG}`))).toBe('x'.repeat(20))
        expect(textOf(store.files.get(`assets/${ABSENT}`))).toBe('fresh')
        expect(copied.facts.assetsPresent).toBe(2)
        expect(copied.facts.assetsWritten).toBe(3)
        expect(waits.at(-1)).toBe(language.rtbRestoreCopying(100))
    })

    test('a target read that fails is "not equal": the entry is written (guard; a scratch variant whose target comparison answers equal after a failed read fails it)', async () => {
        const file = await fileOf({ [LITERAL]: bytesOf('literal-body') })
        const store = new MemoryByteStore({ failRead: () => new Error('read refused') }, { [`assets/${LITERAL}`]: bytesOf('literal-body') })
        const { end } = await run(file, { store, planOptions: { listing: listingOf({ [LITERAL]: 12 }) } })
        copiedOf(end)
        expect(store.log).toContain(`write:assets/${LITERAL}`)
    })
})

describe('the CRC invariant (U3, U4)', () => {
    test('small path: an entry whose CRC-32 does not match never reaches its key, and the stop names what was copied (guard; MU5 fails it)', async () => {
        const good = await fileOf({ [LITERAL]: bytesOf('literal-body') })
        const file = await withBrokenCrc(good, assetEntryName(LITERAL))
        const store = new MemoryByteStore({}, { [`assets/${LITERAL}`]: bytesOf('old-value-xx') })
        const { end, errors } = await run(file, { store })
        const stopped = stoppedOf(end)
        expect(stopped.cause).toBe('corrupt-entry')
        expect(stopped.outcome).toBe('nothing-replaced')
        expect(stopped.shown).toBe(true)
        expect(errors).toEqual([withCopiedKept(language.rtbRestoreDamaged)])
        expect(textOf(store.files.get(`assets/${LITERAL}`))).toBe('old-value-xx')
        expect(store.log.filter((entry) => entry.startsWith('write:'))).toEqual([])
    })

    test('large path: the writer is aborted and never finished on a CRC mismatch, and finished on a match (guard; MU6 fails it)', async () => {
        const good = await fileOf({ [LITERAL]: bytesOf('literal-body') })
        const broken = await run(await withBrokenCrc(good, assetEntryName(LITERAL)), { deps: { chunkMax: 4 } })
        expect(stoppedOf(broken.end).cause).toBe('corrupt-entry')
        expect(broken.store.log).toContain(`abort:assets/${LITERAL}`)
        expect(broken.store.log).not.toContain(`finish:assets/${LITERAL}`)
        expect(broken.store.files.has(`assets/${LITERAL}`)).toBe(false)

        const intact = await run(good, { deps: { chunkMax: 4 } })
        copiedOf(intact.end)
        expect(intact.store.log).toContain(`finish:assets/${LITERAL}`)
        expect(intact.store.log).not.toContain(`abort:assets/${LITERAL}`)
        expect(textOf(intact.store.files.get(`assets/${LITERAL}`))).toBe('literal-body')
    })
})

describe('a short read (U5)', () => {
    test('a source that cannot deliver an entry stops with the changed-file message alone, writes nothing under the key and shows no second line (guard; MU7 fails it)', async () => {
        const good = await fileOf({ [LITERAL]: bytesOf('literal-body') })
        const range = await dataRangeOf(good, assetEntryName(LITERAL))
        let armed = false
        const plan = await planOfBytes(good, {
            source: (bytes) => loggedSource(bytes, (offset, length) => armed && offset < range.end && offset + length > range.start).source,
        })
        armed = true
        const { end, errors, store } = await run(good, { plan })
        const stopped = stoppedOf(end)
        expect(stopped.cause).toBe('could-not-read')
        expect(stopped.outcome).toBe('nothing-replaced')
        expect(errors).toEqual([language.backupFileChangedWhileReading])
        expect(store.files.size).toBe(0)
    })
})

describe('Node store errors and refused names (U6)', () => {
    const NODE = { assetLimit: 1_000_000, inlayLimit: 1_000_000 }

    test('a 413 on a Node page stops with the too-large message; an upload that is gone stops with the upload message (guard)', async () => {
        const file = await fileOf({ [LITERAL]: bytesOf('literal-body') })
        const small = await run(file, {
            store: new MemoryByteStore({ failWrite: () => new NodeHttpError(413, 'write') }),
            planOptions: { node: NODE },
        })
        expect(stoppedOf(small.end).cause).toBe('node-refused')
        expect(small.errors).toEqual([language.restoreAssetRefusedTooLarge(LITERAL)])

        const large = await run(file, {
            store: new MemoryByteStore({ failPiece: () => new UploadGoneError('append') }),
            planOptions: { node: NODE },
            deps: { chunkMax: 4 },
        })
        const stopped = stoppedOf(large.end)
        expect(stopped.cause).toBe('node-refused')
        expect(stopped.outcome).toBe('nothing-replaced')
        expect(large.errors).toEqual([language.restoreAssetUploadStopped(LITERAL)])
        expect(large.store.log).toContain(`abort:assets/${LITERAL}`)
    })

    test('the same errors on a page that is not a Node page are unexpected: failed, with the write-failed message (guard)', async () => {
        const file = await fileOf({ [LITERAL]: bytesOf('literal-body') })
        const { end, errors } = await run(file, { store: new MemoryByteStore({ failWrite: () => new NodeHttpError(413, 'write') }) })
        const stopped = stoppedOf(end)
        expect(stopped.outcome).toBe('failed')
        expect(stopped.cause).toBe('write-failed')
        expect(errors).toEqual([language.restoreWriteFailed])
    })

    test('a name the store refuses is skipped and named, and the copy goes on (guard)', async () => {
        const file = await fileOf({ [LITERAL]: bytesOf('literal-body'), [ABSENT]: bytesOf('fresh') })
        const store = new MemoryByteStore({ failWrite: (key) => key === `assets/${LITERAL}` ? new StoreInvalidKeyError(key, 'refused') : null })
        const copied = copiedOf((await run(file, { store })).end)
        expect(copied.facts.skippedAssets).toContainEqual({ name: LITERAL, reason: 'invalidName' })
        expect(textOf(store.files.get(`assets/${ABSENT}`))).toBe('fresh')
    })

    test('what the plan left out is named in the facts: uncreatable names and, on a Node page, oversize assets and inlays (guard)', async () => {
        const file = await fileOf(
            { [IDB_DOT]: bytesOf('dot-start'), [LITERAL]: bytesOf('literal-body'), [ABSENT]: bytesOf('x'.repeat(64)) },
            [inlayFixture(INLAY_A, 'y'.repeat(64))],
        )
        const { end, store } = await run(file, { planOptions: { node: { assetLimit: 32, inlayLimit: 32 } } })
        const { facts } = copiedOf(end)
        expect(facts.skippedAssets).toContainEqual({ name: ABSENT, reason: 'tooLarge' })
        expect(facts.inlays.skipped).toContainEqual({ label: INLAY_A, reason: 'tooLarge', limit: 32 })
        expect(store.files.has(`assets/${ABSENT}`)).toBe(false)

        const dot = copiedOf((await run(file, { planOptions: { rule: { kind: 'indexeddb', platform: 'posix' } } })).end)
        expect(dot.facts.skippedAssets).toContainEqual({ name: IDB_DOT, reason: 'invalidName' })
    })
})

describe('inlays (U7)', () => {
    function inlayOf(id: string, body: string, over: Partial<InlayRecord> = {}): InlayFixture {
        return inlayFixture(id, body, over)
    }

    test('blob and string inlays are written through the inlay path with their fields, mime and repr, and an unknown top-level meta field is logged by count only (guard)', async () => {
        const withUnknown = inlayOf(INLAY_B, 'text-body', { repr: 'string', mime: '', fields: { name: 'note.txt' } })
        const record: InlayRecord & { extraFieldZ: number } = { ...withUnknown.record, extraFieldZ: 7 }
        const file = await fileOf({}, [
            inlayOf(INLAY_A, 'small-image', { fields: { name: 'a.png', type: 'image' } }),
            { ...withUnknown, record },
        ])
        const { end, store } = await run(file)
        const copied = copiedOf(end)
        expect(copied.facts.inlays.written).toBe(2)
        const image = await readAppInlayBody(store, INLAY_A)
        expect(image).not.toBeNull()
        expect(image?.data instanceof Blob).toBe(true)
        expect((image?.data as Blob).type).toBe('image/png')
        expect(await (image?.data as Blob).text()).toBe('small-image')
        expect((image as unknown as Record<string, unknown>).name).toBe('a.png')
        const note = await readAppInlayBody(store, INLAY_B)
        expect(note?.data).toBe('text-body')
        const warned = vi.mocked(console.warn).mock.calls.map((call) => String(call[0]))
        expect(warned.some((text) => text.includes('1 meta field') && !text.includes('extraFieldZ'))).toBe(true)
    })

    test('an inlay above its limit is skipped with that limit and its body entry is never read (guard; MU8 fails it)', async () => {
        const video = inlayOf(INLAY_V, 'video-bytes-here', { mime: 'video/mp4', fields: { name: 'v.mp4', type: 'video' } })
        const good = await fileOf({}, [video, inlayOf(INLAY_A, 'small')])
        const bodyRange = await dataRangeOf(good, inlayEntryNames(INLAY_V).bodyName)
        const logged = loggedSource(good)
        const plan = await planOfBytes(good, { source: () => logged.source })
        logged.reads.length = 0
        const { end, store } = await run(good, { plan, deps: { inlayLimit: (type) => type === 'video' ? 4 : 1_000_000 } })
        const copied = copiedOf(end)
        expect(copied.facts.inlays.skipped).toContainEqual({ label: INLAY_V, reason: 'tooLarge', limit: 4 })
        expect(copied.facts.inlays.written).toBe(1)
        expect(logged.reads.some((read) => read.offset < bodyRange.end && read.offset + read.length > bodyRange.start)).toBe(false)
        expect(await readAppInlayBody(store, INLAY_V)).toBeNull()
    })

    test('a store that refuses one inlay skips it as not stored and the copy goes on (guard)', async () => {
        const file = await fileOf({}, [inlayOf(INLAY_A, 'first'), inlayOf(INLAY_B, 'second'), inlayOf(INLAY_C, 'third')])
        const refusedKey = inlayMetaKey(INLAY_B)
        const store = new MemoryByteStore({ failWrite: (key) => key === refusedKey ? new Error('refused') : null })
        const copied = copiedOf((await run(file, { store })).end)
        expect(copied.facts.inlays.skipped).toEqual([{ label: INLAY_B, reason: 'notStored' }])
        expect(copied.facts.inlays.written).toBe(2)
        expect(await readAppInlayBody(store, INLAY_C)).not.toBeNull()
    })

    test('a corrupt inlay body stops the restore with the damaged message and the copied-kept line (guard)', async () => {
        const good = await fileOf({}, [inlayOf(INLAY_A, 'first')])
        const file = await withBrokenCrc(good, inlayEntryNames(INLAY_A).bodyName)
        const { end, errors, store } = await run(file)
        const stopped = stoppedOf(end)
        expect(stopped.cause).toBe('corrupt-entry')
        expect(stopped.shown).toBe(true)
        expect(errors).toEqual([withCopiedKept(language.rtbRestoreDamaged)])
        expect(await readAppInlayBody(store, INLAY_A)).toBeNull()
    })

    test('an inlay whose meta entry does not inflate is refused as damaged and leaves the inlay already in the store as it was (guard for the inflate path; the CRC-only case is the next test)', async () => {
        const store = new MemoryByteStore()
        const first = await run(await fileOf({}, [inlayOf(INLAY_A, 'original-body', { fields: { name: 'old.png' } })]), { store })
        copiedOf(first.end)
        const before = new Map([...store.files].map(([key, bytes]) => [key, textOf(bytes)]))
        const replacement = await fileOf({}, [inlayOf(INLAY_A, 'replacement-body', { fields: { name: 'new.png' } })])
        const damaged = loggedSource(await withBrokenDeflate(replacement, inlayEntryNames(INLAY_A).metaName)).source
        const intact = loggedSource(replacement).source
        // The directory verifies, then the meta entry reads back damaged: the file changed after the check.
        let armed = false
        const plan = await planOfBytes(replacement, { source: () => ({ size: replacement.length, read: (offset, length) => (armed ? damaged : intact).read(offset, length) }) })
        armed = true
        const { end, errors } = await run(replacement, { store, plan })
        const stopped = stoppedOf(end)
        expect(stopped.cause).toBe('corrupt-entry')
        expect(errors).toEqual([withCopiedKept(language.rtbRestoreDamaged)])
        expect(new Map([...store.files].map(([key, bytes]) => [key, textOf(bytes)]))).toEqual(before)
        const kept = await readAppInlayBody(store, INLAY_A)
        expect(await (kept?.data as Blob).text()).toBe('original-body')
    })

    test('an inlay meta entry that inflates cleanly but fails only its CRC stops the restore and does not replace the inlay (guard; ignoring the meta entry read verdict fails it)', async () => {
        const store = new MemoryByteStore()
        const first = await run(await fileOf({}, [inlayOf(INLAY_A, 'original-body', { fields: { name: 'old.png' } })]), { store })
        copiedOf(first.end)
        const before = new Map([...store.files].map(([key, bytes]) => [key, textOf(bytes)]))
        const replacement = await fileOf({}, [inlayOf(INLAY_A, 'replacement-body', { fields: { name: 'new.png' } })])
        const other = await fileOf({}, [inlayOf(INLAY_A, 'replacement-body', { fields: { name: 'nex.png' } })])
        // Same-length meta fields keep both files and the meta data range identical, so a compressor change fails here instead of making the test vacuous.
        expect(other.length).toBe(replacement.length)
        const metaRange = await dataRangeOf(replacement, inlayEntryNames(INLAY_A).metaName)
        const otherRange = await dataRangeOf(other, inlayEntryNames(INLAY_A).metaName)
        expect(otherRange).toEqual(metaRange)
        const served = replacement.slice()
        served.set(other.subarray(metaRange.start, metaRange.end), metaRange.start)
        let differs = 0
        for (let i = 0; i < served.length; i++) {
            if (served[i] !== replacement[i]) {
                differs++
            }
        }
        expect(differs).toBeGreaterThan(0)
        const damaged = loggedSource(served).source
        const intact = loggedSource(replacement).source
        // The directory verifies, then the meta entry reads back as other bytes that inflate cleanly: only its CRC fails.
        let armed = false
        const plan = await planOfBytes(replacement, { source: () => ({ size: replacement.length, read: (offset, length) => (armed ? damaged : intact).read(offset, length) }) })
        armed = true
        const { end, errors } = await run(replacement, { store, plan })
        const stopped = stoppedOf(end)
        expect(stopped.cause).toBe('corrupt-entry')
        expect(errors).toEqual([withCopiedKept(language.rtbRestoreDamaged)])
        expect(new Map([...store.files].map(([key, bytes]) => [key, textOf(bytes)]))).toEqual(before)
        const kept = await readAppInlayBody(store, INLAY_A)
        expect(await (kept?.data as Blob).text()).toBe('original-body')
    })

    test('an inlay body that the source cannot deliver stops with the changed-file message alone and stores nothing (guard; rethrowing the short read fails it)', async () => {
        const good = await fileOf({}, [inlayOf(INLAY_A, 'first')])
        const range = await dataRangeOf(good, inlayEntryNames(INLAY_A).bodyName)
        let armed = false
        const plan = await planOfBytes(good, {
            source: (bytes) => loggedSource(bytes, (offset, length) => armed && offset < range.end && offset + length > range.start).source,
        })
        armed = true
        const { end, errors, store } = await run(good, { plan })
        const stopped = stoppedOf(end)
        expect(stopped.cause).toBe('could-not-read')
        expect(stopped.outcome).toBe('nothing-replaced')
        expect(errors).toEqual([language.backupFileChangedWhileReading])
        expect(store.files.size).toBe(0)
    })

    test('a body the browser cannot read back stops the restore as could-not-read, not as one skipped inlay (guard; mapping the unreadable error to not stored fails it)', async () => {
        const file = await fileOf({}, [inlayOf(INLAY_A, 'first'), inlayOf(INLAY_B, 'second')])
        const memory = new MemoryByteStore()
        // A store that takes Blobs has the body probed with a one-byte read before anything is written.
        const store = Object.assign(memory, {
            writeBlob: async (key: string, blob: Blob) => {
                memory.files.set(key, new Uint8Array(await blob.arrayBuffer()))
                return { version: null }
            },
        })
        vi.spyOn(Blob.prototype, 'arrayBuffer').mockRejectedValue(new Error('the browser cannot read this blob'))
        const { end, errors } = await run(file, { store })
        const stopped = stoppedOf(end)
        expect(stopped.cause).toBe('could-not-read')
        expect(stopped.outcome).toBe('nothing-replaced')
        expect(errors).toEqual([language.backupFileChangedWhileReading])
        expect(store.files.size).toBe(0)
    })
})

describe('C0 (U16, U22)', () => {
    test('a busy entry opened elsewhere stops the copy before any write, with the busy message and no copied-kept line (guard)', async () => {
        const file = await fileOf({ [LITERAL]: bytesOf('literal-body') })
        busyHandles.push(beginBusy('import'))
        const { end, store, errors } = await run(file)
        const stopped = stoppedOf(end)
        expect(stopped.cause).toBe('busy')
        expect(stopped.outcome).toBe('nothing-replaced')
        expect(stopped.shown).toBe(true)
        expect(store.log).toEqual([])
        expect(errors).toEqual([])
        expect(get(alertStore)).toMatchObject({ type: 'error', msg: language.backupLoadWorkInProgress })
    })

    test('a store with no piece writer stops before any store call: no-writer, with the needs-store2 message (guard; MU23 fails it)', async () => {
        const file = await fileOf({ [LITERAL]: bytesOf('literal-body') })
        const store = new MemoryByteStore({ writer: false })
        const { end, errors } = await run(file, { store })
        const stopped = stoppedOf(end)
        expect(stopped.cause).toBe('no-writer')
        expect(stopped.outcome).toBe('nothing-replaced')
        expect(stopped.shown).toBe(true)
        expect(errors).toEqual([language.rtbRestoreNeedsStore2])
        expect(store.log).toEqual([])
    })
})

describe('the batch pipeline (U21)', () => {
    test('small entries go through the batch writer; a large one streams through the store\'s writer (guard)', async () => {
        const file = await fileOf({ [LITERAL]: bytesOf('literal-body'), [ABSENT]: bytesOf('fresh'), [LITERAL_BIG]: bytesOf('x'.repeat(40)) })
        const order: string[] = []
        const store = new MemoryByteStore()
        const pipeline = new RestoreAssetPipeline({
            writeBatch: async (entries) => {
                order.push(`batch:${entries.map((entry) => entry.key).join(',')}`)
                for (const entry of entries) {
                    store.files.set(entry.key, entry.data.slice())
                }
                return entries.map(() => ({ k: 'ok' as const }))
            },
            writeEntry: async () => ({ k: 'ok' }),
            openStream: () => { throw new Error('the copy streams through the store, not the pipeline') },
        }, { batchBytes: 32, maxEntries: 8 })
        const { end } = await run(file, {
            store,
            deps: {
                createPipeline: async () => pipeline,
                noteAndSettle: async (key) => { order.push(`note:${key}`) },
            },
        })
        const copied = copiedOf(end)
        expect(copied.facts.assetsWritten).toBe(3)
        const batches = order.filter((entry) => entry.startsWith('batch:'))
        expect(batches).toHaveLength(1)
        expect(batches[0]).toContain(`assets/${LITERAL}`)
        expect(batches[0]).toContain(`assets/${ABSENT}`)
        expect(batches[0]).not.toContain(LITERAL_BIG)
        expect(store.log).toContain(`finish:assets/${LITERAL_BIG}`)
        expect(textOf(store.files.get(`assets/${LITERAL_BIG}`))).toBe('x'.repeat(40))
        expect(textOf(store.files.get(`assets/${LITERAL}`))).toBe('literal-body')
    })
})

describe('the batch pipeline outcome (U21)', () => {
    type Answer = 'ok' | 'invalid' | 'error'

    /** A pipeline whose batch writer answers per key and may be held until `gate` opens; every batch lands in the store's log. */
    function pipelineOf(store: MemoryByteStore, answer: (key: string) => Answer, gate?: Promise<void>): RestoreAssetPipeline {
        return new RestoreAssetPipeline({
            writeBatch: async (entries) => {
                if (gate !== undefined) {
                    await gate
                }
                store.log.push(`batch:${entries.map((entry) => entry.key).join(',')}`)
                return entries.map((entry) => {
                    const verdict = answer(entry.key)
                    if (verdict === 'ok') {
                        store.files.set(entry.key, entry.data.slice())
                        return { k: 'ok' as const }
                    }
                    return verdict === 'invalid' ? { k: 'invalid' as const, reason: 'refused' } : { k: 'error' as const, message: 'native write failed' }
                })
            },
            writeEntry: async () => ({ k: 'ok' }),
            openStream: () => { throw new Error('the copy streams through the store, not the pipeline') },
        }, { batchBytes: 32, maxEntries: 8 })
    }

    test('a batch whose write fails ends the copy failed with the write-failed message, never copied (guard; drops of the failure rethrow or of the final drain fail it)', async () => {
        const file = await fileOf({ [LITERAL]: bytesOf('literal-body'), [ABSENT]: bytesOf('fresh') })
        const store = new MemoryByteStore()
        const { end, errors } = await run(file, { store, deps: { createPipeline: async () => pipelineOf(store, () => 'error'), noteAndSettle: async () => { } } })
        const stopped = stoppedOf(end)
        expect(stopped.outcome).toBe('failed')
        expect(stopped.cause).toBe('write-failed')
        expect(errors).toEqual([language.restoreWriteFailed])
    })

    test('the copy does not settle while a batch is in flight; a name the batch refuses is named and not counted as written (guard; drops of the final drain, the refused-name fold or the count reduction fail it)', async () => {
        const file = await fileOf({ [LITERAL]: bytesOf('literal-body'), [ABSENT]: bytesOf('fresh') })
        const store = new MemoryByteStore()
        let open: () => void = () => undefined
        const gate = new Promise<void>((resolve) => { open = resolve })
        let settled = false
        const copying = run(file, {
            store,
            deps: { createPipeline: async () => pipelineOf(store, (key) => key === `assets/${LITERAL}` ? 'invalid' : 'ok', gate), noteAndSettle: async () => { } },
        }).then((result) => {
            settled = true
            return result
        })
        try {
            await new Promise((resolve) => setTimeout(resolve, 20))
            expect(settled).toBe(false)
        } finally {
            open()
        }
        const copied = copiedOf((await copying).end)
        expect(copied.facts.skippedAssets).toContainEqual({ name: LITERAL, reason: 'invalidName' })
        expect(copied.facts.assetsWritten).toBe(1)
        expect(store.files.has(`assets/${LITERAL}`)).toBe(false)
    })

    test('once a batch has failed no further entry is taken (guard; the halt on a failed pipeline fails it)', async () => {
        const bodies: Record<string, Uint8Array> = {}
        for (const name of ['a.png', 'b.png', 'c.png', 'd.png', 'e.png']) {
            bodies[name] = bytesOf(name.slice(0, 1).repeat(4))
        }
        const file = await fileOf(bodies)
        const store = new MemoryByteStore()
        const pipeline = new RestoreAssetPipeline({
            writeBatch: async (entries) => entries.map(() => ({ k: 'error' as const, message: 'native write failed' })),
            writeEntry: async () => ({ k: 'ok' }),
            openStream: () => { throw new Error('the copy streams through the store, not the pipeline') },
        }, { batchBytes: 8, maxEntries: 1 })
        const noted: string[] = []
        const { end } = await run(file, {
            store,
            deps: {
                createPipeline: async () => pipeline,
                // The wait lets the first batch's failure land before the next entry is taken.
                noteAndSettle: async (key) => {
                    noted.push(key)
                    await new Promise((resolve) => setTimeout(resolve, 10))
                },
            },
        })
        expect(stoppedOf(end).outcome).toBe('failed')
        expect(noted.length).toBeLessThan(5)
    })

    test('a large entry whose key folds with a batched one is written after the batch, so the later entry in the file wins (guard; dropping the drain before a large write fails it)', async () => {
        const SMALL = 'Fold.png'
        const LARGE = 'fold.png'
        const file = await fileOf({ [SMALL]: bytesOf('small-body'), [LARGE]: bytesOf('z'.repeat(40)) })
        const store = new MemoryByteStore()
        const { end } = await run(file, { store, deps: { createPipeline: async () => pipelineOf(store, () => 'ok'), noteAndSettle: async () => { } } })
        copiedOf(end)
        const batch = store.log.findIndex((entry) => entry.startsWith('batch:') && entry.includes(`assets/${SMALL}`))
        const finish = store.log.indexOf(`finish:assets/${LARGE}`)
        expect(batch).toBeGreaterThanOrEqual(0)
        expect(finish).toBeGreaterThan(batch)
    })
})

describe('an unexpected throw and the message that cannot be shown', () => {
    test('a throw the stage does not know resolves failed with the write-failed message; it never rejects (guard)', async () => {
        const file = await fileOf({ [LITERAL]: bytesOf('literal-body') })
        const store = new MemoryByteStore({ failWrite: () => new TypeError('boom') })
        const { end, errors } = await run(file, { store })
        const stopped = stoppedOf(end)
        expect(stopped.outcome).toBe('failed')
        expect(stopped.cause).toBe('write-failed')
        expect(stopped.shown).toBe(true)
        expect(errors).toEqual([language.restoreWriteFailed])
    })

    test('a message that cannot be shown resolves the stop with shown false, so the caller shows it (guard)', async () => {
        const file = await fileOf({ [LITERAL]: bytesOf('literal-body') })
        const store = new MemoryByteStore({ failWrite: () => new TypeError('boom') })
        const { end } = await run(file, { store, deps: { error: () => { throw new Error('alert failed') } } })
        expect(stoppedOf(end).shown).toBe(false)
    })
})
