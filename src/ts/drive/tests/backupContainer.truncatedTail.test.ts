// @vitest-environment happy-dom

/**
 * `indexBackupEntries` reports `truncatedTail` exactly when the file ends inside an entry. These are unit tests of
 * the new field; the restore's refusal built on it is pinned by the LoadLocalBackup tests.
 */
import { describe, test, expect } from 'vitest'
import { BACKUP_ENCRYPTION_MARKER_NAME, BACKUP_NAME_PREFIX_BYTES, indexBackupEntries } from '../backupContainer'

function u32le(n: number): Uint8Array {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
}

function chunkOf(name: string, data: Uint8Array): Uint8Array {
    const nameBytes = new TextEncoder().encode(name)
    const out = new Uint8Array(4 + nameBytes.length + 4 + data.length)
    out.set(u32le(nameBytes.length), 0)
    out.set(nameBytes, 4)
    out.set(u32le(data.length), 4 + nameBytes.length)
    out.set(data, 8 + nameBytes.length)
    return out
}

function joined(chunks: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
    let offset = 0
    for (const chunk of chunks) {
        out.set(chunk, offset)
        offset += chunk.length
    }
    return out
}

function blobOf(bytes: Uint8Array): Blob {
    return new Blob([bytes as unknown as Uint8Array<ArrayBuffer>])
}

const FIRST = chunkOf('first.png', new Uint8Array(10).fill(1))
const LONG_NAME = 'n'.repeat(BACKUP_NAME_PREFIX_BYTES + 76)
const LONG = chunkOf(LONG_NAME, new Uint8Array(20).fill(2))

describe('unit: indexBackupEntries reports a truncated tail', () => {
    test.each([
        ['inside the second entry\'s name-length field', FIRST.slice(0, 2)],
        ['inside the second entry\'s name', FIRST.slice(0, 7)],
        ['inside the second entry\'s data-length field', FIRST.slice(0, 4 + 'first.png'.length + 2)],
        ['inside the second entry\'s body', FIRST.slice(0, FIRST.length - 3)],
    ])('%s -> true', async (_label, tail) => {
        const result = await indexBackupEntries(blobOf(joined([FIRST, tail])))
        expect(result.truncatedTail).toBe(true)
        expect(result.entries).toHaveLength(1)
        expect(result.hasMarker).toBe(false)
    })

    test('a long name cut inside its data-length field -> true', async () => {
        const result = await indexBackupEntries(blobOf(joined([FIRST, LONG.slice(0, 4 + LONG_NAME.length + 2)])))
        expect(result.truncatedTail).toBe(true)
        expect(result.entries).toHaveLength(1)
    })

    test('a long name cut inside its body -> true', async () => {
        const result = await indexBackupEntries(blobOf(joined([FIRST, LONG.slice(0, LONG.length - 5)])))
        expect(result.truncatedTail).toBe(true)
        expect(result.entries).toHaveLength(1)
    })

    test('a cut on an entry boundary, a complete file, an empty file -> false', async () => {
        for (const bytes of [FIRST, joined([FIRST, LONG]), new Uint8Array(0)]) {
            const result = await indexBackupEntries(blobOf(bytes))
            expect(result.truncatedTail).toBe(false)
        }
    })

    test('a marker file -> false, with no entries', async () => {
        const result = await indexBackupEntries(blobOf(joined([FIRST, chunkOf(BACKUP_ENCRYPTION_MARKER_NAME, new Uint8Array(3)), FIRST.slice(0, 5)])))
        expect(result.hasMarker).toBe(true)
        expect(result.truncatedTail).toBe(false)
        expect(result.entries).toEqual([])
    })

    test('every cut point of a three-entry file is true exactly when it is not on an entry boundary', async () => {
        const whole = joined([FIRST, LONG, chunkOf('database.risudat', new Uint8Array(6))])
        const boundaries = new Set([0, FIRST.length, FIRST.length + LONG.length, whole.length])
        for (let cut = 0; cut <= whole.length; cut++) {
            const result = await indexBackupEntries(blobOf(whole.slice(0, cut)))
            expect(result.truncatedTail, `cut at ${cut}`).toBe(!boundaries.has(cut))
        }
    })
})
