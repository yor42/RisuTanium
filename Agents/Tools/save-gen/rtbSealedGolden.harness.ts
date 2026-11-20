// @vitest-environment node
/**
 * Generator of the sealed golden `v1-sealed-small.rtb` and its unencrypted twin
 * `v1-sealed-small.plain.rtb` (CHORE-128 E2).
 *
 * The sealed file is written by the real producer, `runRtbExportGuarded` with a password,
 * over a small synthetic profile (the restore fixture builders, a fake writer): fixed clock,
 * fixed injected key environment, fixed injected randomness (master key, salt, wrap nonce
 * and file id), explicit small Argon2id parameters and 4096-byte chunks. The twin is the
 * same export without the password, from an identical key environment and clock, so the
 * plaintext inside the sealed file equals the twin byte for byte; the generator checks that
 * with the independent test-only reference before it writes anything.
 *
 * Each asset, the inlay body and the iris record carry at least three chunks of
 * incompressible bytes, so a later test can damage one chunk lying wholly inside one entry.
 *
 * Fixed inputs a golden test needs:
 *   password     rtb-golden-pw (ASCII)
 *   Argon2id     m = 256 KiB, t = 2, p = 1
 *   chunk size   4096 bytes
 *
 * Writes only through `writeGoldenFile` (exclusive create, refused under any repository)
 * and only when RTB_GENERATE=1, so a run of the whole save-gen folder generates nothing. The
 * checked-in copy is a deliberate hand copy; the size and SHA-256 printed here are written by
 * hand into the golden's consumers.
 *
 * Run (repository root):
 *   $env:RTB_GENERATE = '1'
 *   node node_modules/vitest/vitest.mjs run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/rtbSealedGolden.harness.ts
 */
import { createHash } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import { runRtbExportGuarded, type RtbExportDeps } from 'src/ts/drive/rtbExport'
import type { ExportableInlay } from 'src/ts/drive/inlayBackupExport'
import { classifyRtb } from 'src/ts/drive/rtb/rtbClassify'
import { goldenOutDir, writeGoldenFile } from 'src/ts/drive/tests/rtb/goldenOut'
import { referenceOpen, seededBytes, sequenceRandom } from 'src/ts/drive/tests/rtb/sealed/sealedReference'
import { rangeSourceOfBytes } from 'src/ts/drive/tests/rtb/sparseSource'
import { buildSmall, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'
import { createClock, testEnv } from 'src/ts/storage/tests/store2/commitFixtures'
import { rtbDeps, rtbWorld } from 'src/ts/storage/tests/store2/rtbFixtures'

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))
vi.mock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }))
vi.mock('src/ts/globalApi.svelte', () => {
    class TauriWriter {
        touchedFile = true
        constructor(public path: string) { }
        async write(): Promise<void> { }
        async close(): Promise<void> { }
    }
    return { LocalWriter: class { }, TauriWriter, isSaveClean: () => true, moduleCommitVerdict: () => 'saved' as const }
})
vi.mock('src/ts/alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn(), alertNormalWait: vi.fn(), alertClear: vi.fn(), alertWait: vi.fn() }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { alertStore: writable({ type: 'none', msg: '' }) }
})
vi.mock('@tauri-apps/plugin-fs', () => ({ remove: vi.fn(async () => { }), writeFile: vi.fn(async () => { }), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined), convertFileSrc: (path: string) => path }))
vi.mock('src/ts/drive/exportModules', () => ({ ExportModuleUnreadableError: class extends Error { } }))
vi.mock('src/ts/drive/storeRestore', () => ({ saveFirst: vi.fn(async () => { }), SAVE_FIRST_BOUND_MS: 10_000 }))
vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: () => ({ modules: [] }), appVer: '0.0.0-test' }))
vi.mock('src/ts/process/files/inlayStore', () => ({
    fieldsOf: () => ({}),
    inlayBodyOf: async () => null,
    legacyInlayStore: { keys: async () => [], getItem: async () => null },
    listAppInlayKeys: async () => ({ ids: [], keys: new Set<string>() }),
    readAppInlayRecord: async () => null,
    withInlayLock: <T>(_id: string, work: () => Promise<T>) => work(),
}))
vi.mock('src/ts/storage/store/appStore', () => ({
    getAppStore: async () => { throw new Error('the page store is not part of this generator') },
    getAppStoreKind: async () => 'tauri',
    pageStoreIsOpfsTransitional: async () => false,
}))

const GENERATE = process.env.RTB_GENERATE === '1'
const SEALED_NAME = 'v1-sealed-small.rtb'
const PLAIN_NAME = 'v1-sealed-small.plain.rtb'
const PASSWORD = 'rtb-golden-pw'
const SEAL_PARAMS = { m: 256, t: 2, chunkSize: 4096 }
const CHUNK = SEAL_PARAMS.chunkSize
const KEY_ENV_SEED = 41
const SEAL_SALT_SEED = [0x60, 0x70, 0x80, 0x90] as const

const HEX_A = 'a1'.repeat(32)
const HEX_B = 'c3'.repeat(32)
const ASSET_A = `assets/${HEX_A}.png`
const ASSET_B = `assets/${HEX_B}.png`
const INLAY_APP = '0123abcd-0123-4123-a123-0123456789ab'

const FILES = {
    [ASSET_A]: seededBytes(4 * CHUNK + 100, 21),
    [ASSET_B]: seededBytes(4 * CHUNK + 700, 22),
}
const INLAY_BODY = seededBytes(4 * CHUNK + 300, 23)
const IRIS_TEXT = Buffer.from(seededBytes(4 * CHUNK, 24)).toString('hex')

function bytesFrom(base: number, length: number): Uint8Array {
    return Uint8Array.from({ length }, (_, i) => (base + i) & 0xff)
}

/** The random draws the sealed export takes, in the engine's order: master key, salt, wrap nonce, file id. */
function goldenRandom(): (length: number) => Uint8Array {
    return sequenceRandom([bytesFrom(SEAL_SALT_SEED[0], 32), bytesFrom(SEAL_SALT_SEED[1], 16), bytesFrom(SEAL_SALT_SEED[2], 12), bytesFrom(SEAL_SALT_SEED[3], 16)])
}

function inlayOfBody(bytes: Uint8Array): ExportableInlay {
    let position = 0
    return {
        repr: 'blob', mime: 'image/png', fields: { name: 'golden.png' }, len: bytes.length,
        source: {
            take: async (count: number) => {
                const part = bytes.subarray(position, position + count)
                position += count
                return part
            },
            close: async () => { },
        },
    }
}

function profile(): Obj {
    const db = JSON.parse(JSON.stringify(buildSmall(2))) as Obj
    const character = (db.characters as Obj[])[0]
    character.additionalAssets = [['extra', ASSET_A, 'png'], ['more', ASSET_B, 'png']]
    const chat = (character.chats as Obj[])[0]
    ;(chat.message as Obj[]).push({ role: 'char', data: `see {{inlay::${INLAY_APP}}}`, time: 1 })
    return db
}

describe.skipIf(!GENERATE)('sealed golden generation (RTB_GENERATE=1)', () => {
    test('writes v1-sealed-small.rtb and its unencrypted twin', async () => {
        const world = await rtbWorld({ layout: 1, database: profile() })

        async function exportBytes(password: string | undefined): Promise<Uint8Array> {
            const backend = await world.open()
            // A fresh key environment per run: the snapshot id is drawn from it, so the sealed file and the twin agree only if both start equal.
            const built = rtbDeps({
                backend, env: testEnv(createClock(), KEY_ENV_SEED), files: FILES, iris: { golden: IRIS_TEXT },
                appInlays: { [INLAY_APP]: inlayOfBody(INLAY_BODY) },
            })
            const deps: RtbExportDeps = { ...built.deps, seal: { params: SEAL_PARAMS, random: goldenRandom() } }
            const result = await runRtbExportGuarded(deps, { fileName: 'golden.rtb', password })
            if (result.status !== 'ended' || result.outcome.status !== 'saved' || result.report === null) {
                throw new Error(`the golden export did not save: ${JSON.stringify(result.status === 'ended' ? result.outcome.status : result.reason)}`)
            }
            const bytes = built.writer.bytes()
            expect(result.report.length).toBe(bytes.length)
            return bytes
        }

        const plain = await exportBytes(undefined)
        const sealed = await exportBytes(PASSWORD)
        const inside = referenceOpen(Buffer.from(sealed), PASSWORD)
        expect(inside.equals(Buffer.from(plain))).toBe(true)
        expect((await classifyRtb(rangeSourceOfBytes(plain))).kind).toBe('ok')
        for (const body of [FILES[ASSET_A], FILES[ASSET_B], INLAY_BODY]) {
            expect(body.length).toBeGreaterThanOrEqual(3 * CHUNK)
        }

        const dir = goldenOutDir()
        for (const [name, bytes] of [[SEALED_NAME, sealed], [PLAIN_NAME, plain]] as const) {
            const file = writeGoldenFile(dir, name, bytes)
            const sha = createHash('sha256').update(bytes).digest('hex')
            process.stdout.write(`sealed golden ${name} file: ${file}\n`)
            process.stdout.write(`sealed golden ${name} size: ${bytes.length} bytes\n`)
            process.stdout.write(`sealed golden ${name} sha256: ${sha}\n`)
        }
        process.stdout.write(`sealed golden password: ${PASSWORD}\n`)
        process.stdout.write(`sealed golden params: m=${SEAL_PARAMS.m} KiB, t=${SEAL_PARAMS.t}, p=1, chunk=${SEAL_PARAMS.chunkSize}\n`)
    }, 120000)
})
