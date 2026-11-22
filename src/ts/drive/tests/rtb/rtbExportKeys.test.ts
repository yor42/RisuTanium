// @vitest-environment node
/**
 * Wrapped connection keys through the real `.rtb` export core (`runRtbExportGuarded`, the real shell, `writeRtb` and
 * readers; stores and the writer are the fixtures' fakes, as in rtbExport.test.ts). The vault is a fake over
 * `src/ts/android/keyVault` with envelopes in the real v1 layout, opaque to this code. A fake writer or vault says nothing
 * about a native one. Keys are synthetic.
 *
 * T22 is the reproducer for the missing confirm and section (against the S2a code no confirm was asked and no section
 * existed); the other rows are guards of the new rule.
 */
import { beforeAll, beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { decodeSideLines } from 'src/ts/drive/rtb/sideLines'
import { RTB_SIDE_TAGS } from 'src/ts/drive/rtb/sideTags'
import { runRtbExportGuarded, type RtbExportDeps, type RtbExportResult } from 'src/ts/drive/rtbExport'
import { liveRtbExportKeys } from 'src/ts/drive/exportKeys'
import { installVaultHost, resetVaultStoreForTest, type VaultPlatform } from 'src/ts/connections/keyVaultStore.svelte'
import type { Connection } from 'src/ts/connections/connections'
import { buildSmall, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'
import { readRtbFile, rtbDeps, rtbManifestOf, rtbWorld, type RtbWorld } from 'src/ts/storage/tests/store2/rtbFixtures'

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

const box = vi.hoisted(() => ({ connections: [] as unknown[], log: [] as string[], confirmAnswer: true, onConfirm: null as null | (() => void) }))

const fake = vi.hoisted(() => {
    const s = { unwraps: [] as string[], codes: new Map<string, string>(), failAfterOpen: false }
    const enc = (plain: string): string => Buffer.concat([
        Buffer.from([1]), Buffer.alloc(8, 3), Buffer.alloc(12, 7), Buffer.from(plain, 'utf8'), Buffer.alloc(16, 9),
    ]).toString('base64')
    const dec = (envelope: string): string => {
        const body = Buffer.from(envelope, 'base64')
        return body.subarray(21, body.length - 16).toString('utf8')
    }
    return {
        s, enc,
        wrapKey: vi.fn(async (plain: string) => ({ ok: true as const, value: enc(plain) })),
        unwrapKey: vi.fn(async (envelope: string) => {
            s.unwraps.push(envelope)
            box.log.push('unwrap')
            if (s.failAfterOpen && box.log.includes('open')) {
                return { ok: false as const, code: 'other' }
            }
            const code = s.codes.get(envelope)
            return code ? { ok: false as const, code } : { ok: true as const, value: dec(envelope) }
        }),
        watchdogFired: () => false,
    }
})

vi.mock('src/ts/android/keyVault', () => ({
    wrapKey: fake.wrapKey,
    unwrapKey: fake.unwrapKey,
    watchdogFired: fake.watchdogFired,
}))

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
vi.mock('src/ts/alert', () => ({
    alertError: vi.fn(), alertNormal: vi.fn(), alertNormalWait: vi.fn(), alertClear: vi.fn(), alertWait: vi.fn(),
    alertConfirm: vi.fn(async (message: string) => {
        box.log.push(`confirm:${message}`)
        box.onConfirm?.()
        return box.confirmAnswer
    }),
}))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { alertStore: writable({ type: 'none', msg: '' }) }
})
vi.mock('@tauri-apps/plugin-fs', () => ({ remove: vi.fn(async () => { }), writeFile: vi.fn(async () => { }), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined), convertFileSrc: (path: string) => path }))
vi.mock('src/ts/drive/exportModules', () => ({ ExportModuleUnreadableError: class extends Error { } }))
vi.mock('src/ts/drive/storeRestore', () => ({ saveFirst: vi.fn(async () => { }), SAVE_FIRST_BOUND_MS: 10_000 }))
vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: () => ({ modules: [], connections: box.connections }), appVer: '0.0.0-test' }))
vi.mock('src/ts/process/files/inlayStore', () => ({
    fieldsOf: () => ({}),
    inlayBodyOf: async () => null,
    legacyInlayStore: { keys: async () => [], getItem: async () => null },
    listAppInlayKeys: async () => ({ ids: [], keys: new Set<string>() }),
    readAppInlayRecord: async () => null,
    withInlayLock: <T>(_id: string, work: () => Promise<T>) => work(),
}))
vi.mock('src/ts/storage/store/appStore', () => ({
    getAppStore: async () => { throw new Error('the page store is not part of this test') },
    getAppStoreKind: async () => 'tauri',
    pageStoreIsOpfsTransitional: async () => false,
}))

const decoder = new TextDecoder()
const ENV_A = fake.enc('SYNTH-KEY-A')
const ENV_B = fake.enc('SYNTH-KEY-B')
const ENV_C = fake.enc('SYNTH-KEY-C')

function wrapped(id: string, name: string, envelope: string): Connection {
    return { id, name, provider: 'openai', key: '', keyWrapped: envelope }
}

let world: RtbWorld
let live: Connection[]

function install(platform: VaultPlatform): void {
    installVaultHost({
        platform,
        findConnection: (id) => live.find((conn) => conn.id === id),
        listConnections: () => live,
        requestSaveNow: () => { },
        markBootWrite: () => { },
        isReadOnlyPage: () => false,
        notify: { keepPlain: () => { }, wrapped: () => { }, reentry: () => { } },
        messages: { keyUnavailable: () => 'unavailable-text' },
    })
}

beforeAll(async () => {
    world = await rtbWorld({ layout: 1, database: JSON.parse(JSON.stringify(buildSmall(2))) as Obj })
})

beforeEach(() => {
    resetBusyActionsForTest()
    resetPageStorageModeForTests()
    resetVaultStoreForTest()
    box.log.length = 0
    box.confirmAnswer = true
    box.onConfirm = null
    fake.s.unwraps.length = 0
    fake.s.codes.clear()
    fake.s.failAfterOpen = false
    live = []
    box.connections = live
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'info').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

async function exportKeys(): Promise<{ result: RtbExportResult, bytes: Uint8Array, opens: number }> {
    const backend = await world.open()
    const built = rtbDeps({ backend, env: world.env })
    let opens = 0
    const openWriter = built.deps.openWriter
    const deps: RtbExportDeps = {
        ...built.deps,
        openWriter: async (session, fileName) => {
            opens++
            box.log.push('open')
            return await openWriter(session, fileName)
        },
        keys: liveRtbExportKeys(),
    }
    const result = await runRtbExportGuarded(deps, { fileName: 'test.rtb' })
    return { result, bytes: built.writer.bytes(), opens }
}

function lines(files: Map<string, Uint8Array>): Array<{ key: string, value: unknown }> {
    const decoded = decodeSideLines(files.get('s/connection-keys/data.jsonl') ?? new Uint8Array(0), RTB_SIDE_TAGS)
    return decoded.kind === 'ok' ? decoded.values : []
}

describe('T22: the .rtb names the keys it cannot carry before its writer opens, and carries the rest as the connection keys section', () => {
    test('readable keys become lines {k, j:{e, p}} sorted by connection id, and no confirm is asked', async () => {
        live.push(wrapped('conn-2', 'B', ENV_B), wrapped('conn-1', 'A', ENV_A), { id: 'conn-3', name: 'C', provider: 'openai', key: 'SYNTH-PLAIN' })
        install('vault')

        const { result, bytes } = await exportKeys()

        expect(result.status === 'ended' && result.outcome.status).toBe('saved')
        expect(box.log.some((entry) => entry.startsWith('confirm:'))).toBe(false)
        const files = await readRtbFile(bytes)
        expect(lines(files)).toEqual([
            { key: 'conn-1', value: { e: ENV_A, p: 'SYNTH-KEY-A' } },
            { key: 'conn-2', value: { e: ENV_B, p: 'SYNTH-KEY-B' } },
        ])
        const row = rtbManifestOf(files).sections.find((item) => item.id === 'side.connection-keys')
        expect(row).toMatchObject({ v: 1, required: false, prefix: 's/connection-keys/', entries: 1 })
        expect(decoder.decode(files.get('manifest.json'))).not.toContain('SYNTH-KEY')
    })

    // regression reproducer: T22
    test('a key this device cannot read has no line and is named in one confirm before the writer opens', async () => {
        live.push(wrapped('conn-1', 'A', ENV_A), wrapped('conn-2', 'Flagged', ENV_B))
        install('vault')
        fake.s.codes.set(ENV_B, 'invalidated')

        const { result, bytes, opens } = await exportKeys()

        expect(result.status === 'ended' && result.outcome.status).toBe('saved')
        const confirmAt = box.log.indexOf(`confirm:${language.vaultExportUnreadableKeys('Flagged')}`)
        expect(confirmAt).toBeGreaterThanOrEqual(0)
        expect(confirmAt).toBeLessThan(box.log.indexOf('open'))
        expect(opens).toBe(1)
        expect(lines(await readRtbFile(bytes)).map((entry) => entry.key)).toEqual(['conn-1'])
    })

    // regression reproducer: T22
    test('declining the confirm ends declined and the writer is never opened', async () => {
        live.push(wrapped('conn-1', 'Flagged', ENV_A))
        install('vault')
        fake.s.codes.set(ENV_A, 'unreadable')
        box.confirmAnswer = false

        const { result, bytes, opens } = await exportKeys()

        expect(result).toMatchObject({ status: 'ended', outcome: { status: 'declined', cause: 'incomplete-data-declined' } })
        expect(opens).toBe(0)
        expect(bytes.length).toBe(0)
    })

    test('a key not readable right now is named with the "right now" text', async () => {
        live.push(wrapped('conn-1', 'Slow', ENV_A))
        install('vault')
        fake.s.codes.set(ENV_A, 'timeout')

        await exportKeys()

        expect(box.log).toContain(`confirm:${language.vaultExportKeysUnavailableNow('Slow')}`)
    })

    test('an orphaned carrier is named too: the .rtb carries every connection', async () => {
        live.push(wrapped('conn-1', 'A', ENV_A), wrapped('conn-9', 'Orphan', ENV_C))
        install('vault')
        fake.s.codes.set(ENV_C, 'invalidated')

        await exportKeys()

        expect(box.log).toContain(`confirm:${language.vaultExportUnreadableKeys('Orphan')}`)
    })

    test('a connection holding a plain key and a stale envelope has no line', async () => {
        live.push({ id: 'conn-1', name: 'Both', provider: 'openai', key: 'SYNTH-PLAIN', keyWrapped: ENV_A })
        install('vault')

        const { bytes } = await exportKeys()

        expect(lines(await readRtbFile(bytes))).toEqual([])
    })
})

describe('T23: no wrapped keys leaves the file as it was', () => {
    // compatibility guard (passes before and after)
    test('no wrapped key writes no row, no entry and no manifest mention', async () => {
        live.push({ id: 'conn-1', name: 'A', provider: 'openai', key: 'SYNTH-PLAIN' })
        install('vault')

        const { bytes } = await exportKeys()

        const files = await readRtbFile(bytes)
        expect([...files.keys()].some((name) => name.startsWith('s/connection-keys/'))).toBe(false)
        expect(decoder.decode(files.get('manifest.json'))).not.toContain('connection-keys')
    })
})

describe('T28: no vault call after the writer opens', () => {
    test('a vault that fails after the confirm changes nothing: every line comes from the snapshot', async () => {
        live.push(wrapped('conn-1', 'A', ENV_A))
        install('vault')
        fake.s.failAfterOpen = true

        const { bytes } = await exportKeys()

        expect(box.log.slice(box.log.indexOf('open')).filter((entry) => entry === 'unwrap')).toEqual([])
        expect(lines(await readRtbFile(bytes))).toEqual([{ key: 'conn-1', value: { e: ENV_A, p: 'SYNTH-KEY-A' } }])
    })

    test('a carrier first unreadable after the confirm has no line and is named in the report, not the manifest', async () => {
        live.push(wrapped('conn-1', 'Flagged', ENV_A))
        install('vault')
        fake.s.codes.set(ENV_A, 'invalidated')
        box.onConfirm = () => { live.push(wrapped('conn-2', 'Late one', ENV_B)) }

        const { result, bytes } = await exportKeys()

        const report = result.status === 'ended' ? result.report : null
        expect(report?.keysLeftOutLate).toEqual(['Late one'])
        const files = await readRtbFile(bytes)
        expect(lines(files)).toEqual([])
        expect(decoder.decode(files.get('manifest.json'))).not.toContain('Late one')
    })
})
