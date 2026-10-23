/**
 * Profiling tooling: generates the four synthetic backup-file tiers and
 * round-trips each through RisuAI's REAL encode/decode + backup-container
 * code, to prove the output is genuinely importable via LoadLocalBackup().
 * Also reports the module-array-specific sizing metrics and a Node
 * `structuredClone` timing floor requested for attributing the module-editor
 * "stuttery text field" symptom vs. the streaming-chat deep-clone cost
 * separately (see build.ts's file header for the two suspected effects).
 *
 * This file lives inside the repo, under Agents/Tools/save-gen/, and is
 * only ever run against a throwaway vitest config
 * (../vitest.harness.config.ts) that points `test.include` at this exact
 * path. `pnpm test` (which uses the repo's own vitest.config.ts and its
 * default include glob) never sees this file, because that glob only
 * matches `*.spec.ts`/`*.test.ts` and this file is named `*.harness.ts`.
 *
 * Mocking pattern for risuSave.ts's side-effecting dependencies mirrors the
 * module mocks in src/ts/storage/tests/risuSave.test.ts (localforage,
 * globalApi.svelte, appStore via appStoreMock, database.svelte, platform,
 * plugin-fs) so the encoder/decoder run headlessly here as they do in that suite.
 */
import { describe, test, expect, vi, beforeAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

//#region module mocks — mirror src/ts/storage/tests/risuSave.test.ts
// `vi.hoisted` because the hoisted `vi.mock` factories run during module
// evaluation, before plain top-level `const`s would be initialised.
const { store } = vi.hoisted(() => ({ store: new Map<string, unknown>() }))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => store.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => {
                store.set(key, value)
            }),
            removeItem: vi.fn(async (key: string) => {
                store.delete(key)
            }),
        }),
    },
}))

vi.mock(
    import('src/ts/globalApi.svelte'),
    () =>
        ({
            forageStorage: {
                keys: vi.fn(async () => []),
                getItem: vi.fn(async () => null),
                setItem: vi.fn(async () => {}),
            },
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})

vi.mock(
    import('src/ts/storage/database.svelte'),
    () =>
        ({
            getDatabase: vi.fn(() => { throw new Error('no live database in tests') }),
            presetTemplate: { name: 'test-preset' },
        }) as unknown as typeof import('src/ts/storage/database.svelte'),
)

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))
//#endregion

import { buildTierDatabase, SEED, type TierName } from './build'

// encodeRisuSaveLegacy/decodeRisuSave are loaded lazily (see beforeAll below)
// rather than via a static import, so we can delete global `Buffer` FIRST —
// msgpackr (risuSave.ts's encoder) branches once, at module-evaluation time,
// on `typeof Buffer !== 'undefined'` to decide whether to use Node Buffer's
// internal (and, on this Node version, incompatible) utf8Write fast path or
// the portable Uint8Array + TextEncoder path. The real app runs in a
// browser/Tauri webview where `Buffer` is never defined, so it always takes
// the portable path — a static import here would evaluate msgpackr with
// Node's `Buffer` still present and exercise a code path production never
// hits, which throws `RangeError: length is outside of buffer bounds` on
// this Node version (see msgpackr@1.10.1 pack.js's encodeUtf8/hasNodeBuffer).
let encodeRisuSaveLegacy: typeof import('src/ts/storage/risuSave').encodeRisuSaveLegacy
let decodeRisuSave: typeof import('src/ts/storage/risuSave').decodeRisuSave

beforeAll(async () => {
    const savedBuffer = globalThis.Buffer
    // @ts-expect-error - intentionally simulating the Buffer-less browser/Tauri
    // environment risuSave.ts actually runs in; restored immediately below.
    delete globalThis.Buffer
    try {
        const mod = await import('src/ts/storage/risuSave')
        encodeRisuSaveLegacy = mod.encodeRisuSaveLegacy
        decodeRisuSave = mod.decodeRisuSave
    } finally {
        globalThis.Buffer = savedBuffer
    }
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = path.resolve(__dirname, '../output')

/**
 * Byte-for-byte reimplementation of LocalWriter.writeBackup's container
 * framing (src/ts/globalApi.svelte.ts:1909-1917): for each entry,
 * [nameLen:u32][name][dataLen:u32][data], with `Uint32Array` writing the
 * length in the platform's native (little-endian, on every real target)
 * byte order — matched exactly, not reimplemented differently.
 */
function writeBackupContainer(entries: { name: string; data: Uint8Array }[]): Uint8Array {
    const parts: Uint8Array[] = []
    for (const { name, data } of entries) {
        const nameBytes = new TextEncoder().encode(name)
        const nameLenBuf = new Uint8Array(new Uint32Array([nameBytes.byteLength]).buffer)
        const dataLenBuf = new Uint8Array(new Uint32Array([data.byteLength]).buffer)
        parts.push(nameLenBuf, nameBytes, dataLenBuf, data)
    }
    const total = parts.reduce((a, p) => a + p.length, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const p of parts) {
        out.set(p, offset)
        offset += p.length
    }
    return out
}

/** Byte-for-byte reimplementation of LoadLocalBackup's parsing loop (src/ts/drive/backuplocal.ts:459-479). */
function readBackupContainer(buf: Uint8Array): Map<string, Uint8Array> {
    const result = new Map<string, Uint8Array>()
    let offset = 0
    while (offset + 4 <= buf.length) {
        const nameLength = new Uint32Array(buf.slice(offset, offset + 4).buffer)[0]
        offset += 4
        const name = new TextDecoder().decode(buf.slice(offset, offset + nameLength))
        offset += nameLength
        const dataLength = new Uint32Array(buf.slice(offset, offset + 4).buffer)[0]
        offset += 4
        const data = buf.slice(offset, offset + dataLength)
        offset += dataLength
        result.set(name, data)
    }
    return result
}

function median(nums: number[]): number {
    const sorted = [...nums].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** Node-side `structuredClone` timing floor over the modules array — explicitly
 *  NOT a stand-in for the real cost: it excludes Svelte 5 proxy overhead
 *  (`$state`-wrapped objects, which is the mechanism `$state.snapshot()`
 *  actually has to walk through in the live app), so this only tells us how
 *  expensive cloning this much *plain* data is at an absolute minimum. */
function timeStructuredCloneMs(value: unknown, iterations = 7): { minMs: number; medianMs: number } {
    const timings: number[] = []
    for (let i = 0; i < iterations; i++) {
        const start = performance.now()
        structuredClone(value)
        timings.push(performance.now() - start)
    }
    return { minMs: Math.min(...timings), medianMs: median(timings) }
}

const TIERS: TierName[] = ['light', 'chat-heavy', 'module-heavy', 'both-heavy']

describe('synthetic heavy save-data generator (profiling tooling)', () => {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
    // Clean stale fixtures from any earlier tier scheme before regenerating.
    for (const stale of fs.readdirSync(OUTPUT_DIR)) {
        if ((stale.startsWith('risuai-backup-') || stale.startsWith('raw-')) && stale.endsWith('.bin')) {
            fs.unlinkSync(path.join(OUTPUT_DIR, stale))
        }
    }

    for (const tier of TIERS) {
        test(`generates + round-trips tier: ${tier}`, async () => {
            const { database, stats } = buildTierDatabase(tier)
            const modules = database.modules as Record<string, unknown>[]

            // --- Module-array-specific sizing (requested explicitly, separate
            // from total file size): JSON-UTF8 bytes (universal proxy for "how
            // much data"), and msgpackr-encoded bytes (the actual on-disk
            // encoding risuSave.ts uses for the whole database, applied here to
            // just the modules array for an apples-to-apples on-format number). ---
            const modulesJson = JSON.stringify(modules)
            const modulesJsonBytes = new TextEncoder().encode(modulesJson).byteLength
            const modulesMsgpackBytes = new Uint8Array(encodeRisuSaveLegacy(modules as any, 'noCompression')).byteLength
            const perModuleJsonBytes = modules.map((m) => new TextEncoder().encode(JSON.stringify(m)).byteLength)
            const largestModuleBytes = Math.max(...perModuleJsonBytes)
            const medianModuleBytes = median(perModuleJsonBytes)

            // --- structuredClone timing floor over the modules array (Node-side,
            // explicitly excludes Svelte 5 proxy overhead — see function doc). ---
            const cloneFloor = timeStructuredCloneMs(modules)

            // Same encode call SaveLocalBackup() itself makes (src/ts/drive/backuplocal.ts,
            // `encodeRisuSaveLegacy(dbWithoutAccount, 'compression')`).
            const dbData = new Uint8Array(encodeRisuSaveLegacy(database as any, 'compression'))

            const container = writeBackupContainer([{ name: 'database.risudat', data: dbData }])
            const outPath = path.join(OUTPUT_DIR, `risuai-backup-${tier}.bin`)
            fs.writeFileSync(outPath, container)

            // --- ALSO emit the raw payload with NO backup-container wrapper: this is
            // exactly what a pristine (never-yet-autosaved) app's IndexedDB key
            // `database/database.bin` holds — bootstrap.ts:163-167 seeds that key with
            // `encodeRisuSaveLegacy({})` on first-ever run, the same function used here,
            // and reads it back with a bare `decodeRisuSave(gotStorage)` (no container
            // parsing at all). NOTE: after the app's own autosave loop runs even once,
            // that SAME key gets overwritten with a structurally different encoding —
            // the block-format `RisuSaveEncoder`'s `encoder.set()`/`encoder.encode()`
            // (globalApi.svelte.ts:860-893), not `encodeRisuSaveLegacy` — so the
            // "IndexedDB key == this raw payload" equivalence is exact only for a
            // fresh/pristine dev-server profile, not a previously-used one. Both
            // encodings are read by the same generic decodeRisuSave() dispatch either
            // way, so this only matters for exact byte-for-byte expectations, not for
            // whether the injected file will load successfully. ---
            const rawOutPath = path.join(OUTPUT_DIR, `raw-${tier}.bin`)
            fs.writeFileSync(rawOutPath, dbData)
            const rawReadBack = new Uint8Array(fs.readFileSync(rawOutPath))
            const rawDecoded: any = await decodeRisuSave(rawReadBack)
            expect(rawDecoded.formatversion).toBe(5)
            expect(rawDecoded.characters.length).toBe(stats.totalCharacters)
            expect(rawDecoded.characters[0].chaId).toBe(stats.activeCharacterChaId)
            expect(rawDecoded.modules.length).toBe(stats.moduleCount)

            // --- Round-trip proof: read the WRITTEN CONTAINER FILE back off disk, parse
            // it with our own reimplementation of LoadLocalBackup's container parser,
            // then decode the extracted block with the REAL decodeRisuSave(). ---
            const readBack = new Uint8Array(fs.readFileSync(outPath))
            const parsed = readBackupContainer(readBack)
            expect(parsed.has('database.risudat')).toBe(true)

            const decoded: any = await decodeRisuSave(parsed.get('database.risudat')!)
            expect(decoded.formatversion).toBe(5)
            expect(decoded.characters.length).toBe(stats.totalCharacters)
            expect(decoded.characters[0].chaId).toBe(stats.activeCharacterChaId)
            const activeMessages = decoded.characters[0].chats.reduce((a: number, c: any) => a + c.message.length, 0)
            expect(activeMessages).toBe(stats.activeCharacterMessages)
            const totalMessages = decoded.characters.reduce(
                (a: number, c: any) => a + (c.chats ?? []).reduce((b: number, ch: any) => b + ch.message.length, 0),
                0,
            )
            expect(totalMessages).toBe(stats.totalMessages)
            expect(decoded.modules.length).toBe(stats.moduleCount)

            console.log(
                `[fixture:${tier}] seed=${SEED} path=${outPath} fileBytes=${container.byteLength} ` +
                    `rawPath=${rawOutPath} rawBytes=${dbData.byteLength} rawDecodeOk=true | ` +
                    `totalCharacters=${stats.totalCharacters} totalChats=${stats.totalChats} totalMessages=${stats.totalMessages} ` +
                    `activeChaId=${stats.activeCharacterChaId} activeMessages=${stats.activeCharacterMessages} activeChats=${stats.activeCharacterChats} | ` +
                    `moduleCount=${stats.moduleCount} modulesJsonBytes=${modulesJsonBytes} modulesMsgpackBytes=${modulesMsgpackBytes} ` +
                    `largestModuleBytes=${largestModuleBytes} medianModuleBytes=${medianModuleBytes} | ` +
                    `structuredCloneFloorMs(modules) min=${cloneFloor.minMs.toFixed(2)} median=${cloneFloor.medianMs.toFixed(2)} [FLOOR ONLY — excludes Svelte 5 proxy overhead]`,
            )
        })
    }
})
