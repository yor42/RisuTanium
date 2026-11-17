// @vitest-environment node
/**
 * CHORE-807 stage 2 (G1 measurement tooling, diagnostic; not a regression test): the census of an exported `.bin`, decoded with the
 * application's own import reader. The walk is `indexBackupEntries`, the scan `scanBinForImport`, the cold-storage reader
 * `createBinImportReader`, the database entry `readBinDatabase` plus `decodeBinDatabase`, and the legacy resolve `resolveLegacyTree`
 * (the same steps the page import takes before it commits). Nothing here is a reader of its own: if one of these modules cannot load
 * under this harness the run fails to start, and the tool reports it as BLOCKED.
 *
 * Environment: C807_BIN (the .bin; refused unless it lies under the c807 run root), C807_ROOT (the run root), C807_OUT (the folder that
 * receives bin-census.json; also under the run root), C807_FAULT=flip-bytes (one byte of the database entry is flipped before it is
 * decoded, so the decode or the census must differ).
 *
 * Run (from the repository root; name this one file, never the folder):
 *   node node_modules/vitest/vitest.mjs run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/c807-bin-census.harness.ts
 * Large entries need NODE_OPTIONS=--max-old-space-size=<MiB>.
 */
import { describe, expect, test, vi } from 'vitest'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) }) },
}))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) },
    getSaveMarkCount: () => 0,
    isSaveClean: () => true,
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
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('src/ts/alert', () => ({
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertNormalWait: vi.fn(async () => { }),
    alertWait: vi.fn(),
    alertStore: { set: vi.fn(), subscribe: vi.fn() },
    waitAlert: vi.fn(async () => { }),
}))
const inert = vi.hoisted(() => (): Record<string, unknown> => new Proxy({}, {
    has: () => true,
    get: (_target, name) => name === 'then' ? undefined : (name === 'alertStore' ? {} : () => undefined),
}))
vi.mock('src/ts/process/coldstorage.svelte', inert)
vi.mock('src/ts/drive/restoreReplace', inert)
vi.mock('src/ts/drive/backupWorkGuard', () => ({ refuseBackupLoadWhileBusy: () => false }))
vi.mock('src/ts/storage/store2/saveActive', () => ({ getActiveStore2Save: () => null }))

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { indexBackupEntries, type BinFile, type BinSlice } from 'src/ts/drive/backupContainer'
import { createBinImportReader, decodeBinDatabase, readBinDatabase, scanBinForImport } from 'src/ts/drive/storeImport'
import { resolveLegacyTree } from 'src/ts/storage/store2/legacy/resolve'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..', '..')
const ROOT = path.resolve(process.env.C807_ROOT ?? process.env.C806_ROOT ?? path.join(os.tmpdir(), 'risu-b715', 'b61', 'c807'))
const BIN = process.env.C807_BIN ?? ''
const OUT = process.env.C807_OUT ?? ''
const FAULT = process.env.C807_FAULT ?? ''

const norm = (p: string) => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p)
const isInside = (p: string, root: string) => {
    const a = norm(p)
    const b = norm(root)
    return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep)
}

/** A `BinFile` over a Node file descriptor: each slice reads its own range when asked, so nothing is held between reads. */
function nodeBinFile(fd: number, size: number): BinFile {
    const sliceOf = (start: number, end: number): BinSlice => ({
        size: end - start,
        slice: (from: number, to?: number) => sliceOf(start + from, to === undefined ? end : Math.min(end, start + to)),
        arrayBuffer: async () => {
            const length = end - start
            const buffer = Buffer.alloc(length)
            let done = 0
            while (done < length) {
                const n = fs.readSync(fd, buffer, done, length - done, start + done)
                if (n === 0) break
                done += n
            }
            return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + done) as ArrayBuffer
        },
    })
    return { size, slice: (start: number, end?: number) => sliceOf(start, Math.min(size, end ?? size)) }
}

describe.skipIf(BIN === '')('c807 bin census', () => {
    test('census of C807_BIN through the application import reader', { timeout: 6 * 60 * 60 * 1000 }, async () => {
        const bin = path.resolve(BIN)
        const out = path.resolve(OUT)
        expect(isInside(bin, ROOT), 'the .bin lies under the c807 run root: ' + bin).toBe(true)
        expect(isInside(bin, REPO_ROOT), 'the .bin is not inside the repository').toBe(false)
        expect(isInside(out, ROOT), 'the output folder lies under the c807 run root: ' + out).toBe(true)
        fs.mkdirSync(out, { recursive: true })
        const size = fs.statSync(bin).size
        const fd = fs.openSync(bin, 'r')
        try {
            const file = nodeBinFile(fd, size)
            const walked = await indexBackupEntries(file)
            const scan = scanBinForImport(walked.entries, walked.names)
            expect(scan.database, 'the file holds a database.risudat entry').not.toBeNull()
            const bytes = await readBinDatabase(file, scan.database!)
            if (FAULT === 'flip-bytes') {
                // the middle of the entry is compressed or block data: the decode or the counts must change
                const at = Math.floor(bytes.length / 2)
                bytes[at] = bytes[at] ^ 0xFF
            }
            const decoded = await decodeBinDatabase(bytes)
            const reader = createBinImportReader(file, scan.index, async () => ({ status: 'missing' }) as never)
            const resolved = await resolveLegacyTree(decoded.tree, reader)
            const db = resolved.database as unknown as {
                characters: { chats?: { message?: unknown[] }[] }[]
                modules?: unknown[]
                enabledModules?: unknown[]
                archiveCharacters?: boolean
            }
            let chats = 0
            let messages = 0
            for (const character of db.characters ?? []) {
                for (const chat of character.chats ?? []) {
                    chats++
                    messages += Array.isArray(chat.message) ? chat.message.length : 0
                }
            }
            const census = {
                characters: (db.characters ?? []).length,
                chats,
                messages,
                modules: (db.modules ?? []).length,
                enabledModules: (db.enabledModules ?? []).length,
                archiveCharacters: db.archiveCharacters === true,
                incomplete: resolved.incomplete.length,
                omittedBlocks: decoded.omitted.size,
                entries: walked.entries.length,
                databaseEntryBytes: bytes.length,
            }
            fs.writeFileSync(path.join(out, 'bin-census.json'), JSON.stringify({
                bin, fileBytes: size, fault: FAULT || null, census,
            }, null, 2))
            expect(census.incomplete).toBe(0)
        } finally {
            fs.closeSync(fd)
        }
    })
})
