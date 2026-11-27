/**
 * #283 T23, compatibility guards: the fork-only group key `risutanium_members` (chaId -> {name, slot}) through the real
 * `SaveLocalBackup({mode:'inline'})` and the real `LoadLocalBackup`, read three ways.
 *
 * - (i) the fork export imports unchanged: the key survives byte-equal (JSON-equal), also for a member that is no longer a character.
 * - (ii) an upstream-shaped edit (the three arrays only: a member added, a member removed) is re-exported in upstream's block
 *   format and imported: the key survives byte-equal, and the removed member's record still gives its name.
 * - (iii) the same file with the key absent imports with the key absent.
 * - The stub variant exports the group as an archived stub (its fields travel in a unit body, not in `database.risudat`):
 *   (i) only, because upstream edits a restored body and never a stub slot.
 *
 * Scope of the upstream half: `upstreamReexport` is the fork's own `writeRisuSaveV0` and the member edit is a transcription of
 * upstream's `addGroupChar` and `rmCharFromGroup` array edits. No upstream code runs; that upstream keeps an unknown
 * character key through its own save and load rests on reading its `JSON.stringify` and parse path. The suite replaces
 * `database.svelte`, so no real `setDatabase` runs; a pass says nothing about the Tauri or Node backends or a real download.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeCharacter, makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { savedDatabase, startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Database, groupChat } from 'src/ts/storage/database.svelte'
import { stubFromEntry } from 'src/ts/storage/store2/codec'
import { upstreamReexport } from 'src/ts/drive/tests/upstreamPresetMirror'
import { memberName } from 'src/ts/process/groupMembers'

vi.setConfig({ testTimeout: 60_000 })

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

const worlds = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

const originalLocks = Object.getOwnPropertyDescriptor(window.navigator, 'locks')

// msgpackr 1.10.1 passes a length past the buffer's end to `Buffer.prototype.utf8Write` for a string of 64 or more
// characters, which the Node running the tests rejects; the browser build has no `Buffer`, so production is unaffected.
interface Utf8Writer {
    utf8Write(this: Uint8Array, text: string, position: number, length: number): number
}
const utf8WriterProto = Buffer.prototype as unknown as Utf8Writer
const nativeUtf8Write = utf8WriterProto.utf8Write

beforeAll(() => {
    utf8WriterProto.utf8Write = function (text, position, length) {
        return nativeUtf8Write.call(this, text, position, Math.min(length, this.length - position))
    }
    class FakeChannel {
        onmessage: ((event: { data: unknown }) => void) | null = null
        constructor(public name: string) { h.channels.push(this) }
        postMessage(data: unknown) { h.broadcasts.push(data) }
        close() { }
    }
    Object.defineProperty(window, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
})

afterAll(() => { utf8WriterProto.utf8Write = nativeUtf8Write })

beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    h.broadcasts.length = 0
    h.channels.length = 0
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    vi.doMock('src/ts/stores.svelte', async () => {
        const { proxy } = await import('svelte/internal/client')
        const { writable } = await import('svelte/store')
        return {
            DBState: proxy({ db: {} as Record<string, unknown> }),
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
            hotReloading: [] as string[],
        } as unknown as typeof import('src/ts/stores.svelte')
    })
    vi.doMock('src/ts/persona', () => ({ changeUserPersona: vi.fn() }))
    vi.doMock('src/ts/process/coldstorage.svelte', async () => ({
        getColdStorageItem: vi.fn(),
        getColdStorageBackupKey: (await import('src/ts/process/coldstorageData')).getColdStorageBackupKey,
        readColdStorageItem: async (key: string) => {
            const { getResidency, isEntityUnitKey } = await import('src/ts/storage/store2/residencyActive')
            const residency = getResidency()
            if (!isEntityUnitKey(key) || residency === null) {
                return { status: 'missing' }
            }
            const read = await residency.readCharacter(key)
            return read.status === 'error' ? { status: 'error', error: read.error, kind: read.kind } : { status: 'ok', value: read.value }
        },
        setColdStorageItem: vi.fn(async () => false),
        collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
        confirmIncompleteColdStorageOperation: vi.fn(async () => true),
        isColdStorageBackupData: vi.fn(() => false),
    }))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(() => {
    worlds.parkAll()
    vi.restoreAllMocks()
    if (originalLocks) {
        Object.defineProperty(window.navigator, 'locks', originalLocks)
    } else {
        Object.defineProperty(window.navigator, 'locks', { value: undefined, configurable: true })
    }
})

interface BinEntry { name: string, data: Uint8Array }

/** The `.bin` container: `[nameLength][name][dataLength][data]` per entry, lengths little-endian u32. */
function parseEntries(bytes: Uint8Array): BinEntry[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const entries: BinEntry[] = []
    let offset = 0
    while (offset + 4 <= bytes.length) {
        const nameLength = view.getUint32(offset, true)
        offset += 4
        const name = new TextDecoder().decode(bytes.subarray(offset, offset + nameLength))
        offset += nameLength
        const dataLength = view.getUint32(offset, true)
        offset += 4
        entries.push({ name, data: bytes.slice(offset, offset + dataLength) })
        offset += dataLength
    }
    return entries
}

function binEntry(name: string, data: Uint8Array): Uint8Array {
    const nameBytes = new TextEncoder().encode(name)
    const out = new Uint8Array(4 + nameBytes.length + 4 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, nameBytes.length, true)
    out.set(nameBytes, 4)
    view.setUint32(4 + nameBytes.length, data.length, true)
    out.set(data, 8 + nameBytes.length)
    return out
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

const KEY = 'risutanium_members'
const GROUP = 'group-283'

/** The records joinRecord writes: {name, slot 0..7} under each member id; `ghost` is a member that is no longer a character. */
const RECORDS = {
    alpha: { name: 'Alpha', slot: 0 },
    beta: { name: 'Beta', slot: 1 },
    ghost: { name: 'Ghost', slot: 2 },
}

function seed(): Record<string, unknown> {
    const db = makeDb('base', ['alpha', 'beta', 'gamma'])
    ;(db.characters as unknown[]).push({
        ...makeCharacter(GROUP, { name: 'Group' }),
        type: 'group',
        characters: ['alpha', 'beta', 'ghost'],
        characterTalks: [1, 1, 1],
        characterActive: [true, true, true],
        [KEY]: structuredClone(RECORDS),
    })
    return db
}

interface Trip {
    /** The fork export's database entry, decoded. */
    exported: Database
    /** The tree the real import committed, every entity assembled whole. */
    saved: Database
    /** Whether the page's own slot of the group held the key when it exported (false for a stub). */
    pageHeldKey: boolean
    /** The bin entries that were exported (the stub variant keeps the group's body outside `database.risudat`). */
    entryNames: string[]
}

/**
 * The fork profile exported by the real `SaveLocalBackup`, optionally edited in the decoded database entry
 * (`reimport` returns the new entry bytes, or undefined to keep the exported ones), then imported by the real `LoadLocalBackup`.
 */
async function trip(options: { stubs?: readonly string[], reimport?: (db: Database) => Uint8Array | undefined | Promise<Uint8Array | undefined> } = {}): Promise<Trip> {
    const locks = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(locks, 'this'), configurable: true })
    const stored = seed()
    h.db = options.stubs === undefined ? stored : { ...seed(), characters: (seed().characters as Record<string, unknown>[]).filter((slot) => !options.stubs?.includes(String(slot.chaId))) }
    const k: Store2Kit = await startStore2({ db: stored as unknown as Database, stubs: options.stubs })
    const w: World = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Record<string, unknown>
    const bootActive = await import('src/ts/storage/store2/bootActive')
    bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer: k.committer } as unknown as Store2Session)
    w.pageMode.setPageStorageMode({ kind: 'store2' })
    const alertWithoutNotice = await import('src/ts/alert')
    vi.doMock('src/ts/alert', () => ({ ...alertWithoutNotice, waitUnreadNotice: async () => { } }))
    vi.mocked(alertWithoutNotice.alertConfirm).mockImplementation(async () => true)
    vi.spyOn(alertWithoutNotice.alertStore, 'set').mockImplementation(() => { })
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => { })
    for (const chaId of options.stubs ?? []) {
        // The page holds the stub of the entity the seeded tree holds for the character, as an archiving boot leaves it.
        const entry = k.residency.entryOf(k.context.previous.entities.get(`${chaId}#0`) as string)
        if (entry === null) {
            throw new Error('The seeded tree holds no entity for the character.')
        }
        ;(h.db.characters as unknown[]).push(stubFromEntry(entry))
    }
    w.start()
    await sleepReal(150)
    await settled(w)
    const pageSlot = (h.db.characters as Record<string, unknown>[]).find((slot) => slot.chaId === GROUP)
    const pageHeldKey = pageSlot !== undefined && Object.hasOwn(pageSlot, KEY)

    const { LoadLocalBackup, SaveLocalBackup } = await import('src/ts/drive/backuplocal')
    const { decodeRisuSave } = await import('src/ts/storage/risuSave')

    const streamSaver = (await import('src/ts/vendor/streamSaver')).default
    const written: Uint8Array[] = []
    vi.spyOn(streamSaver, 'createWriteStream').mockImplementation((() => ({
        ready: Promise.resolve(),
        writable: { getWriter: () => ({ write: async (chunk: Uint8Array) => { written.push(chunk.slice()) }, close: async () => { } }) },
    })) as never)
    await SaveLocalBackup({ mode: 'inline' })
    const entries = parseEntries(concat(written))
    const database = entries.find((entry) => entry.name === 'database.risudat')
    if (database === undefined) {
        throw new Error('The export holds no database entry.')
    }
    const exported = await decodeRisuSave(database.data) as unknown as Database
    const edited = options.reimport === undefined ? undefined : await options.reimport(structuredClone(exported))
    const bytes = concat(entries.map((entry) => binEntry(entry.name, entry.name === 'database.risudat' && edited !== undefined ? edited : entry.data)))
    const realCreateElement = document.createElement.bind(document)
    let input: HTMLInputElement | null = null
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const element = realCreateElement(tag)
        if (tag === 'input') {
            input = element as HTMLInputElement
        }
        return element
    })
    LoadLocalBackup()
    const chosen = input as unknown as HTMLInputElement
    Object.defineProperty(chosen, 'files', { value: [new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')], configurable: true })
    await (chosen.onchange as unknown as (event: Event) => Promise<void>).call(chosen, new Event('change'))
    createElementSpy.mockRestore()

    const { bootThroughDispatch } = await import('src/ts/storage/tests/store2SaveKit')
    const boot = await bootThroughDispatch(k.counted.backend)
    if (boot.result.kind !== 'store2') {
        throw new Error(`The boot answered ${boot.result.kind}.`)
    }
    return { exported, saved: await savedDatabase(k.memory), pageHeldKey, entryNames: entries.map((entry) => entry.name) }
}

function groupOf(db: Database): groupChat & Record<string, unknown> {
    const found = db.characters.find((slot) => slot.chaId === GROUP)
    if (found === undefined) {
        throw new Error('The group is missing.')
    }
    return found as unknown as groupChat & Record<string, unknown>
}

describe('T23 the group member record key through the real .bin export and import (compatibility guards)', () => {
    test('(i) the fork export imports with the key equal, and a member that is no longer a character still gives its name', async () => {
        const result = await trip()
        expect(groupOf(result.exported)[KEY]).toEqual(RECORDS)
        const group = groupOf(result.saved)
        expect(JSON.stringify(group[KEY])).toBe(JSON.stringify(RECORDS))
        expect(group.characters).toEqual(['alpha', 'beta', 'ghost'])
        expect(memberName(result.saved.characters, group, 'ghost')).toBe('Ghost')
        expect(memberName(result.saved.characters, group, 'alpha')).toBe('alpha')
    })

    test('(ii) an upstream-shaped add and remove of a member keeps the key, and the removed member still gives its name once it is not a character', async () => {
        const result = await trip({
            reimport: (db) => {
                const group = groupOf(db)
                // upstream addGroupChar: the three pushes
                group.characters.push('gamma')
                group.characterTalks.push(1 / 6 * 4)
                group.characterActive.push(true)
                // upstream rmCharFromGroup(0): the three splices
                group.characters.splice(0, 1)
                group.characterTalks.splice(0, 1)
                group.characterActive.splice(0, 1)
                return upstreamReexport(db as unknown as Parameters<typeof upstreamReexport>[0])
            },
        })
        const group = groupOf(result.saved)
        expect(group.characters).toEqual(['beta', 'ghost', 'gamma'])
        expect(group.characterTalks).toHaveLength(3)
        expect(JSON.stringify(group[KEY])).toBe(JSON.stringify(RECORDS))
        const withoutAlpha = result.saved.characters.filter((slot) => slot.chaId !== 'alpha')
        expect(memberName(withoutAlpha, group, 'alpha')).toBe('Alpha')
        expect(memberName(withoutAlpha, group, 'ghost')).toBe('Ghost')
        // gamma joined through upstream and has no record: it is live, so it reads its own name
        expect(Object.hasOwn(group[KEY] as object, 'gamma')).toBe(false)
        expect(memberName(result.saved.characters, group, 'gamma')).toBe('gamma')
    })

    test('(iii) the same file with the key absent imports with the key absent', async () => {
        const result = await trip({
            reimport: (db) => {
                delete groupOf(db)[KEY]
                return upstreamReexport(db as unknown as Parameters<typeof upstreamReexport>[0])
            },
        })
        expect(Object.hasOwn(groupOf(result.saved), KEY)).toBe(false)
        expect(memberName(result.saved.characters, groupOf(result.saved), 'ghost')).toBe('Unknown Character')
    })

    test('(stub variant, (i)) a group the page holds as an archived stub is exported with its body and imports with the key equal', async () => {
        const result = await trip({ stubs: [GROUP] })
        expect(result.pageHeldKey).toBe(false)
        expect(groupOf(result.exported)[KEY]).toEqual(RECORDS)
        const group = groupOf(result.saved)
        expect(JSON.stringify(group[KEY])).toBe(JSON.stringify(RECORDS))
        expect(memberName(result.saved.characters, group, 'ghost')).toBe('Ghost')
    })

    test('(stub variant, (iii)) the restored body with the key removed imports with the key absent', async () => {
        const result = await trip({
            stubs: [GROUP],
            reimport: (db) => {
                delete groupOf(db)[KEY]
                return upstreamReexport(db as unknown as Parameters<typeof upstreamReexport>[0])
            },
        })
        expect(result.pageHeldKey).toBe(false)
        expect(Object.hasOwn(groupOf(result.saved), KEY)).toBe(false)
    })
})
