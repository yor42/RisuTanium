// @vitest-environment happy-dom

/**
 * O8 (Agents/Reports/30-chore39-opfs-migration-plan.md, MC-089): cold storage
 * writes `coldstorage_<key>.json` files directly into the OPFS root --
 * the same directory `OpfsStorage` itself uses -- so `OpfsStorage.keys()`
 * must return only file names that round-trip through hex-decode then
 * re-encode. A foreign name that does not round-trip (as a plain-text cold
 * storage file name does not) must never surface as a "key" a caller then
 * tries to read back.
 *
 * Real, unmocked: `OpfsStorage` (this file's subject). Mocked: `src/ts/util`
 * (`asBuffer`, kept as the real identity function so no behaviour is
 * altered). Global stub: `navigator.storage.getDirectory`, returning one
 * fake `FileSystemDirectoryHandle`.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/util'), () => ({
    asBuffer: (v: unknown) => v,
}) as unknown as typeof import('src/ts/util'))

import { OpfsStorage } from '../opfsStorage'

/** A minimal `FileSystemDirectoryHandle` fake: every entry `values()` yields is a raw file name in the OPFS root, exactly as cold storage's own writer and `OpfsStorage` share. */
class FakeOpfsDirectory {
    entries = new Map<string, Uint8Array>()

    async getFileHandle(name: string, options?: { create?: boolean }) {
        if (!this.entries.has(name)) {
            if (!options?.create) {
                throw new DOMException('A requested file or directory could not be found.', 'NotFoundError')
            }
            this.entries.set(name, new Uint8Array())
        }
        const dir = this
        return {
            async createWritable() {
                return {
                    async write(data: Uint8Array) { dir.entries.set(name, data) },
                    async close() { },
                }
            },
            async getFile() {
                const data = dir.entries.get(name) ?? new Uint8Array()
                return { async arrayBuffer() { return data.buffer } }
            },
        }
    }

    async removeEntry(name: string) {
        this.entries.delete(name)
    }

    async *values() {
        for (const name of [...this.entries.keys()]) {
            yield { name } as FileSystemHandle
        }
    }
}

let directory: FakeOpfsDirectory

beforeEach(() => {
    directory = new FakeOpfsDirectory()
    Object.defineProperty(window.navigator, 'storage', {
        value: { getDirectory: async () => directory },
        configurable: true,
    })
})

describe('OpfsStorage.keys() (O8)', () => {
    test('regression reproducer: a cold-storage file in the OPFS root is excluded, even though a real key set by OpfsStorage itself round-trips', async () => {
        const storage = new OpfsStorage()
        await storage.setItem('database/database.bin', new TextEncoder().encode('db'))
        // Cold storage's own writer, sharing the OPFS root -- a plain-text name, never hex-encoded.
        directory.entries.set('coldstorage_abcdefacab.json', new TextEncoder().encode('{}'))

        const keys = await storage.keys()

        expect(keys).toEqual(['database/database.bin'])
    })

    test('guard: every name OpfsStorage itself writes round-trips and is returned', async () => {
        const storage = new OpfsStorage()
        await storage.setItem('database/database.bin', new TextEncoder().encode('db'))
        await storage.setItem('migrated', new TextEncoder().encode('true'))

        const keys = await storage.keys()

        expect(new Set(keys)).toEqual(new Set(['database/database.bin', 'migrated']))
    })
})
