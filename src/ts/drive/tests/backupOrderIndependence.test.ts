// @vitest-environment happy-dom

/**
 * Guard of the new contract (the walk's kept names, which the old reader did not have; the positions correspond to the old
 * walk plus scan): where the database, the cold-storage units and the encryption marker sit in a `.bin` does not change
 * what the walk finds. A writer of upstream or of this fork
 * puts the assets first, the cold units next and the database last, but a hand-made or future file may not, and an
 * import of such a file must carry the same content (MC-175). The walk keeps the name of every entry of at most 64
 * bytes, which is what the store2 scan reads; the scan itself and the imports are exercised in
 * `storeImport.svelte.test.ts` (store2) and `backuplocalEncryptedRefusal.test.ts` (block era), which import real
 * files in these orders.
 */
import { describe, test, expect } from 'vitest'
import { BACKUP_ENCRYPTION_MARKER_NAME, indexBackupEntries } from '../backupContainer'

function u32le(n: number): Uint8Array {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
}

function chunk(name: string, data: Uint8Array): Uint8Array {
    const nameBytes = new TextEncoder().encode(name)
    const out = new Uint8Array(4 + nameBytes.length + 4 + data.length)
    out.set(u32le(nameBytes.length), 0)
    out.set(nameBytes, 4)
    out.set(u32le(data.length), 4 + nameBytes.length)
    out.set(data, 8 + nameBytes.length)
    return out
}

function concat(chunks: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(chunks.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of chunks) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

function fileOf(bytes: Uint8Array): File {
    return new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')
}

const COLD_A = 'coldstorage_11111111-1111-1111-1111-111111111111.json'
const COLD_B = 'coldstorage_22222222-2222-2222-2222-222222222222.json'
const ASSET_NAME = 'a'.repeat(66) + '.png'

const asset = chunk(ASSET_NAME, new Uint8Array(40).fill(1))
const coldA = chunk(COLD_A, new TextEncoder().encode('{"message":[]}'))
const coldA2 = chunk(COLD_A, new TextEncoder().encode('{"message":[1]}'))
const coldB = chunk(COLD_B, new TextEncoder().encode('{"message":[]}'))
const database1 = chunk('database.risudat', new Uint8Array([1, 1, 1]))
const database2 = chunk('database.risudat', new Uint8Array([2, 2, 2, 2]))
const marker = chunk(BACKUP_ENCRYPTION_MARKER_NAME, new Uint8Array([9]))

/** The chunks of a walked file that the walk kept a name for, as the chunk's place among `parts`, by name, in file order. */
async function placesByName(parts: Uint8Array[], windowBytes?: number): Promise<Map<string, number[]>> {
    const walk = await indexBackupEntries(fileOf(concat(parts)), { windowBytes })
    const starts: number[] = []
    let offset = 0
    for (const part of parts) {
        starts.push(offset)
        offset += part.length
    }
    const places = new Map<string, number[]>()
    for (const entry of walk.entries) {
        const name = walk.names.get(entry.headerOffset)
        if (name !== undefined) {
            places.set(name, [...(places.get(name) ?? []), starts.indexOf(entry.headerOffset)])
        }
    }
    return places
}

describe.each([undefined, 4, 16] as const)('the walk finds the same entries wherever they sit (windows: %s)', (windowBytes) => {
    test('every database entry is named, so the last one is the one a scan keeps, wherever that is', async () => {
        expect((await placesByName([database1, asset, coldA, database2], windowBytes)).get('database.risudat')).toEqual([0, 3])
        expect((await placesByName([asset, database1, coldA, database2, coldB], windowBytes)).get('database.risudat')).toEqual([1, 3])
        expect((await placesByName([database1, asset, coldA, coldB], windowBytes)).get('database.risudat')).toEqual([0])
    })

    test('cold units interleaved with assets are all named, and a repeated id keeps every place in file order', async () => {
        const places = await placesByName([coldA, asset, coldB, asset, coldA2, database1], windowBytes)

        expect(places.get(COLD_A)).toEqual([0, 4])
        expect(places.get(COLD_B)).toEqual([2])
        expect(places.has(ASSET_NAME)).toBe(false)
    })

    test('a file with no database entry names none', async () => {
        const places = await placesByName([asset, coldA, coldB], windowBytes)

        expect(places.has('database.risudat')).toBe(false)
    })

    test('a marker after the database, before it, or cut off at the end is found and lists no entries', async () => {
        const cutOff = marker.slice(0, 4 + BACKUP_ENCRYPTION_MARKER_NAME.length + 2)
        for (const parts of [[asset, coldA, database1, marker], [marker, asset, database1], [asset, database1, cutOff], [database1, marker, coldA]]) {
            const walk = await indexBackupEntries(fileOf(concat(parts)), { windowBytes })
            expect(walk.hasMarker).toBe(true)
            expect(walk.entries).toEqual([])
        }
    })
})
