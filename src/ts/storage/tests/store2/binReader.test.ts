// @vitest-environment node
/**
 * The lazy `.bin` cold-entry reader: parity with the entries the restore loop stores (accepted names and shapes, the
 * last accepted duplicate, the device fallback only when the file holds nothing usable), and the re-check of the
 * entry header and length at read time that the loop makes for every entry it reads.
 */
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) }) },
}))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) },
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: true }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))

import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { indexBackupEntries } from 'src/ts/drive/backupContainer'
import type { Database } from 'src/ts/storage/database.svelte'
import {
    BinFileChangedError, ColdEntryIndex, createBinEntryReader, indexColdEntries,
} from 'src/ts/storage/store2/legacy/binReader'
import { resolveLegacyTree, type LegacyEntryReader, type LegacyUnitRead } from 'src/ts/storage/store2/legacy/resolve'
import { ALL_GOLDENS, ID, loadGolden, readerOver } from './legacyFixtures'

const U1 = '00000000-0000-4000-8000-0000000000e1'
const U2 = '00000000-0000-4000-8000-0000000000e2'
const CHAT = { message: [{ time: 1, data: 'hello', role: 'char' }] }

interface BinEntry {
    name: string
    data: string | Uint8Array
}

function u32(value: number): Uint8Array {
    const out = new Uint8Array(4)
    new DataView(out.buffer).setUint32(0, value, true)
    return out
}

function binOf(entries: readonly BinEntry[]): Uint8Array {
    const parts: Uint8Array[] = []
    for (const entry of entries) {
        const name = new TextEncoder().encode(entry.name)
        const data = typeof entry.data === 'string' ? new TextEncoder().encode(entry.data) : entry.data
        parts.push(u32(name.length), name, u32(data.length), data)
    }
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of parts) {
        out.set(part, at)
        at += part.length
    }
    return out
}

function blobOf(bytes: Uint8Array): Blob {
    return new Blob([bytes as unknown as Uint8Array<ArrayBuffer>])
}

/** A blob that records every range sliced from it. */
class TrackingBlob extends Blob {
    readonly slices: [number, number][] = []

    override slice(start?: number, end?: number, type?: string): Blob {
        this.slices.push([start ?? 0, end ?? this.size])
        return super.slice(start, end, type)
    }
}

class UnreadableSlice extends Blob {
    override arrayBuffer(): Promise<ArrayBuffer> {
        return Promise.reject(new Error('injected read failure'))
    }
}

class FailingSliceBlob extends Blob {
    override slice(): Blob {
        return new UnreadableSlice([])
    }
}

function tracking(bytes: Uint8Array): TrackingBlob {
    return new TrackingBlob([bytes as unknown as Uint8Array<ArrayBuffer>])
}

async function readerFor(bytes: Uint8Array, fallback?: LegacyEntryReader, file: Blob = blobOf(bytes)): Promise<LegacyEntryReader> {
    const walk = await indexBackupEntries(blobOf(bytes))
    const index = await indexColdEntries(blobOf(bytes), walk.entries)
    return createBinEntryReader({ file, index, fallback })
}

function fallbackOf(answer: LegacyUnitRead): LegacyEntryReader & { asked: string[] } {
    const asked: string[] = []
    return {
        asked,
        async read(key) {
            asked.push(key)
            return answer
        },
    }
}

describe('golden files', () => {
    test.each(ALL_GOLDENS.map(name => [name]))('%s: every unit answers as the stored unit the restore would have written', async (name) => {
        const golden = await loadGolden(name)
        const bytes = new Uint8Array(fs.readFileSync(path.join(process.cwd(), 'src/ts/drive/tests/binGoldens', name)))
        const reader = await readerFor(bytes)
        const oracle = readerOver(golden.units)
        const keys = new Set<string>([...golden.units.keys(), ...Object.values(ID)])
        if (name.endsWith('-full.bin')) {
            expect(golden.units.size).toBeGreaterThan(0)
        }
        for (const key of keys) {
            expect(await reader.read(key), `${name} ${key}`).toEqual(await oracle.read(key))
        }
    })

    test('the index holds exactly the entries whose name maps to a unit id', async () => {
        const bytes = new Uint8Array(fs.readFileSync(path.join(process.cwd(), 'src/ts/drive/tests/binGoldens/upstream-full.bin')))
        const walk = await indexBackupEntries(blobOf(bytes))
        const index = await indexColdEntries(blobOf(bytes), walk.entries)
        const golden = await loadGolden('upstream-full.bin')
        expect(index.size).toBe(golden.units.size)
        expect(index.size).toBeLessThan(walk.entries.length)
    })
})

describe('entry acceptance', () => {
    test('under the exporter\'s name any JSON is a unit, under a bare name only a chat or character shape is', async () => {
        const bytes = binOf([
            { name: `coldstorage_${U1}.json`, data: '"a plugin value"' },
            { name: `${U2}.json`, data: '"a plugin value"' },
        ])
        const reader = await readerFor(bytes)
        expect(await reader.read(U1)).toEqual({ status: 'ok', value: 'a plugin value' })
        expect(await reader.read(U2)).toEqual({ status: 'missing' })
        const chat = await readerFor(binOf([{ name: `coldstorage/${U2}.json`, data: JSON.stringify(CHAT) }]))
        expect(await chat.read(U2)).toEqual({ status: 'ok', value: CHAT })
    })

    test('a body that is not JSON is unparsable, and missing for a shape rejection', async () => {
        const reader = await readerFor(binOf([
            { name: `coldstorage_${U1}.json`, data: '{not json' },
            { name: `${U2}.json`, data: '42' },
        ]))
        expect(await reader.read(U1)).toEqual({ status: 'unparsable' })
        expect(await reader.read(U2)).toEqual({ status: 'missing' })
    })

    test('an id the file does not hold is missing', async () => {
        const reader = await readerFor(binOf([{ name: `coldstorage_${U1}.json`, data: JSON.stringify(CHAT) }]))
        expect(await reader.read(U2)).toEqual({ status: 'missing' })
    })
})

describe('duplicate entries', () => {
    const second = { message: [{ time: 2, data: 'second', role: 'char' }] }

    test('the last accepted entry wins and the earlier one is not read', async () => {
        const bytes = binOf([
            { name: `coldstorage_${U1}.json`, data: JSON.stringify(CHAT) },
            { name: `coldstorage_${U1}.json`, data: JSON.stringify(second) },
        ])
        const walk = await indexBackupEntries(blobOf(bytes))
        const index = await indexColdEntries(blobOf(bytes), walk.entries)
        const file = tracking(bytes)
        const reader = createBinEntryReader({ file, index })
        expect(await reader.read(U1)).toEqual({ status: 'ok', value: second })
        expect(file.slices).toEqual([[walk.entries[1].headerOffset, walk.entries[1].headerOffset + walk.entries[1].headerLength + walk.entries[1].dataLength]])
    })

    test('a later entry that is not JSON or is shape-rejected does not undo an earlier accepted one', async () => {
        const badLast = await readerFor(binOf([
            { name: `coldstorage_${U1}.json`, data: JSON.stringify(CHAT) },
            { name: `coldstorage_${U1}.json`, data: '{not json' },
        ]))
        expect(await badLast.read(U1)).toEqual({ status: 'ok', value: CHAT })
        const rejectedLast = await readerFor(binOf([
            { name: `${U1}.json`, data: JSON.stringify(CHAT) },
            { name: `${U1}.json`, data: '7' },
        ]))
        expect(await rejectedLast.read(U1)).toEqual({ status: 'ok', value: CHAT })
    })

    test('an accepted later entry replaces an earlier one that was not JSON', async () => {
        const reader = await readerFor(binOf([
            { name: `coldstorage_${U1}.json`, data: '{not json' },
            { name: `coldstorage_${U1}.json`, data: JSON.stringify(CHAT) },
        ]))
        expect(await reader.read(U1)).toEqual({ status: 'ok', value: CHAT })
    })
})

describe('fallback to the page\'s own unit', () => {
    const device: LegacyUnitRead = { status: 'ok', value: CHAT }

    test('is not asked for an id the file holds an accepted entry for', async () => {
        const fallback = fallbackOf(device)
        const reader = await readerFor(binOf([{ name: `coldstorage_${U1}.json`, data: JSON.stringify({ message: [] }) }]), fallback)
        expect(await reader.read(U1)).toEqual({ status: 'ok', value: { message: [] } })
        expect(fallback.asked).toEqual([])
    })

    test('is asked, and answers, for an id the file does not hold', async () => {
        const fallback = fallbackOf(device)
        const reader = await readerFor(binOf([{ name: `coldstorage_${U1}.json`, data: JSON.stringify(CHAT) }]), fallback)
        expect(await reader.read(U2)).toEqual(device)
        expect(fallback.asked).toEqual([U2])
    })

    test('answers for an id whose entries are all unusable, as the restore leaves the device\'s own unit in place', async () => {
        const fallback = fallbackOf(device)
        const reader = await readerFor(binOf([
            { name: `coldstorage_${U1}.json`, data: '{not json' },
            { name: `${U2}.json`, data: '5' },
        ]), fallback)
        expect(await reader.read(U1)).toEqual(device)
        expect(await reader.read(U2)).toEqual(device)
    })

    test('a missing answer after an unparsable entry stays unparsable, and a failure passes through', async () => {
        const file = binOf([{ name: `coldstorage_${U1}.json`, data: '{not json' }])
        expect(await (await readerFor(file, fallbackOf({ status: 'missing' }))).read(U1)).toEqual({ status: 'unparsable' })
        const failure = { status: 'error', error: new Error('device') } as const
        expect(await (await readerFor(file, fallbackOf(failure))).read(U1)).toEqual(failure)
    })
})

describe('keys that are not unit ids', () => {
    test('are never looked up in the file or the fallback', async () => {
        const fallback = fallbackOf({ status: 'ok', value: CHAT })
        const bytes = binOf([{ name: `coldstorage_${U1}.json`, data: JSON.stringify(CHAT) }])
        const walk = await indexBackupEntries(blobOf(bytes))
        const index = await indexColdEntries(blobOf(bytes), walk.entries)
        const file = tracking(bytes)
        const reader = createBinEntryReader({ file, index, fallback })
        for (const key of ['abcdefghijklmnopqrstuvwxyz', '', 'coldstorage_' + U1, U1 + '.json', U1 + '0']) {
            expect(await reader.read(key), key).toEqual({ status: 'missing' })
        }
        expect(fallback.asked).toEqual([])
        expect(file.slices).toEqual([])
    })

    test('a stub that names a 26-character entity id of an existing character is missing and the resolve never reads it', async () => {
        const entityId = 'abcdefghijklmnopqrstuvwxyz'
        const fallback = fallbackOf({ status: 'ok', value: { character: { chaId: 'x', name: 'Existing', type: 'character', chats: [] } } })
        const reader = await readerFor(binOf([{ name: `coldstorage_${U1}.json`, data: JSON.stringify(CHAT) }]), fallback)
        const tree = { botPresets: [], characters: [{ chaId: 'x', name: 'Stub', type: 'character', coldstorage: entityId, coldStoragedChats: [], chats: [] }] }
        const resolved = await resolveLegacyTree(tree as unknown as Database, reader)
        expect(resolved.incomplete).toEqual([{ kind: 'character', chaId: 'x', name: 'Stub', key: entityId, reason: 'missing' }])
        expect(fallback.asked).toEqual([])
    })
})

describe('re-check at read time', () => {
    const entryBytes = (): Uint8Array => binOf([
        { name: `coldstorage_${U1}.json`, data: JSON.stringify(CHAT) },
        { name: 'assets/x.png', data: 'png' },
    ])

    async function indexOf(bytes: Uint8Array) {
        const walk = await indexBackupEntries(blobOf(bytes))
        return indexColdEntries(blobOf(bytes), walk.entries)
    }

    function changed(result: LegacyUnitRead, reason: string): void {
        expect(result.status).toBe('error')
        if (result.status !== 'error') {
            return
        }
        expect(result.error).toBeInstanceOf(BinFileChangedError)
        expect((result.error as BinFileChangedError).reason).toBe(reason)
    }

    test('a file that is shorter than the walk saw is an error, not a missing unit', async () => {
        const bytes = entryBytes()
        const index = await indexOf(bytes)
        const cut = blobOf(bytes.subarray(0, 20))
        changed(await createBinEntryReader({ file: cut, index }).read(U1), 'length')
    })

    test('a header that now carries another name of the same length is an error', async () => {
        const bytes = entryBytes()
        const index = await indexOf(bytes)
        const edited = bytes.slice()
        // The last character of the unit id inside the name.
        const at = new TextDecoder().decode(bytes).indexOf(U1) + U1.length - 1
        edited[at] = U1.charCodeAt(U1.length - 1) === 0x31 ? 0x32 : 0x31
        changed(await createBinEntryReader({ file: blobOf(edited), index }).read(U1), 'header')
    })

    test('a header that now carries other lengths is an error', async () => {
        const bytes = entryBytes()
        const index = await indexOf(bytes)
        const edited = bytes.slice()
        new DataView(edited.buffer).setUint32(4 + `coldstorage_${U1}.json`.length, chatLength() - 1, true)
        changed(await createBinEntryReader({ file: blobOf(edited), index }).read(U1), 'header')
    })

    test('an entry that is now the encryption marker is an error', async () => {
        const index = await indexOf(entryBytes())
        // Long enough that the slice has the indexed length, so only the header can tell.
        const marker = binOf([{ name: 'encryption.risudat', data: 'x'.repeat(300) }])
        changed(await createBinEntryReader({ file: blobOf(marker), index }).read(U1), 'marker')
    })

    test('a slice that cannot be read is an error', async () => {
        const bytes = entryBytes()
        const index = await indexOf(bytes)
        changed(await createBinEntryReader({ file: new FailingSliceBlob([]), index }).read(U1), 'unreadable')
    })

    test('an error reaches the resolve as a failed read, so nothing is written', async () => {
        const bytes = entryBytes()
        const index = await indexOf(bytes)
        const reader = createBinEntryReader({ file: blobOf(bytes.subarray(0, 20)), index })
        const tree = { botPresets: [], characters: [{ chaId: 'x', name: 'Stub', type: 'character', coldstorage: U1, coldStoragedChats: [], chats: [] }] }
        await expect(resolveLegacyTree(tree as unknown as Database, reader)).rejects.toMatchObject({ name: 'LegacyReadError' })
    })
})

describe('indexing', () => {
    test('a name that cannot be a cold entry is not read for its name, and an asset is not indexed', async () => {
        const bytes = binOf([
            { name: 'assets/' + 'n'.repeat(200), data: 'a' },
            { name: `coldstorage_${U1}.json`, data: JSON.stringify(CHAT) },
        ])
        const walk = await indexBackupEntries(blobOf(bytes))
        const file = tracking(bytes)
        const index = await indexColdEntries(file, walk.entries)
        expect(index.size).toBe(1)
        expect(file.slices).toHaveLength(1)
    })

    test('note records a cold name and refuses any other', () => {
        const index = new ColdEntryIndex()
        const place = { headerOffset: 0, headerLength: 8, nameLength: 0, dataLength: 0 }
        expect(index.note(place, `coldstorage_${U1}.json`)).toBe(true)
        expect(index.note(place, 'assets/x.png')).toBe(false)
        expect(index.note(place, 'database.risudat')).toBe(false)
        expect(index.size).toBe(1)
        expect(index.get(U1)).toHaveLength(1)
        expect(index.get(U2)).toEqual([])
    })

    test('a header that is not what the walk saw, or the marker, stops the index', async () => {
        const bytes = binOf([{ name: `coldstorage_${U1}.json`, data: JSON.stringify(CHAT) }])
        const walk = await indexBackupEntries(blobOf(bytes))
        const marker = binOf([{ name: 'encryption.risudat', data: 'x'.repeat(300) }])
        await expect(indexColdEntries(blobOf(marker), walk.entries)).rejects.toBeInstanceOf(BinFileChangedError)
        await expect(indexColdEntries(blobOf(bytes.subarray(0, 10)), walk.entries)).rejects.toBeInstanceOf(BinFileChangedError)
    })
})

function chatLength(): number {
    return JSON.stringify(CHAT).length
}
