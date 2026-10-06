/**
 * Importing a `.risum` whose assets are larger than the piece-save threshold, with the real module graph from
 * `modules.ts` through `globalApi.svelte.ts` and the desktop files store down to the in-memory file system and command
 * stand-ins of `src/ts/storage/tests`. Everything else the importer reaches is mocked. A pass says nothing about the Rust
 * commands, the native bridge or a browser.
 *
 * The RPack layer is a real byte-for-byte substitution (every byte XORed with 0x5a), so a decoder that wrote into the
 * bytes the source handed out would be noticed. `wire` records the bytes the commands received as they received them.
 *
 * Titles say what a test pins: `reproducer` fails against the importer that reads a whole record, `data safety` pins what
 * must never reach the disk or the retry loop, `guard` holds before and after.
 */
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { ASSET_PIECE_SAVE_MIN_BYTES } from 'src/ts/assetHash'
import { CHUNK_MAX, WRITE_CHUNK_BYTES } from 'src/ts/storage/tauriByteTransport'
import type { ImportSource } from 'src/ts/importSource'
import { patterned, risumBytes } from 'src/ts/process/tests/risumFixtures'

const h = vi.hoisted(() => ({
    platform: { isTauri: false, isNodeServer: false },
    os: 'linux' as 'linux' | 'windows' | 'android',
    keyPair: null as CryptoKeyPair | null,
    /** the 1-based number of the chunk command that fails once, or 0 */
    failChunk: 0,
    chunkCommands: 0,
    sleeps: [] as number[],
    alerts: [] as string[],
}))

const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))
const fakePaths = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriPathFake')).createFakeTauriPaths())
const desktop = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriDesktopFake')).createDesktopInvoke(fakeFs))

interface WireChunk {
    command: string
    bytes: Uint8Array
    last: boolean
}

const wire = vi.hoisted(() => ({ chunks: [] as WireChunk[] }))

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
            keys: vi.fn(async () => []),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return h.platform.isTauri },
    get isNodeServer() { return h.platform.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => {
        throw new Error('no live database in tests')
    }),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as Record<string, unknown> },
    selectedCharID: writable(-1),
    selIdState: { selId: -1 },
    alertStore: writable({ type: 'none', msg: '' }),
    MobileGUI: writable(false),
    botMakerMode: writable(false),
    loadedStore: writable(false),
    LoadingStatusState: { text: '' },
    ReloadGUIPointer: writable(0),
    HideIconStore: writable(false),
    moduleBackgroundEmbedding: writable(''),
    bodyIntercepterStore: writable(null),
    savingStoppedReason: writable(null),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertWait: vi.fn((msg: string) => { h.alerts.push(msg) }),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertModuleSelect: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    checkPersonaBinded: vi.fn(),
    selectSingleFileObject: vi.fn(),
    sleep: vi.fn(async (ms: number) => { h.sleeps.push(ms) }),
    sleepForever: vi.fn(async () => { }),
    asBuffer: (value: Uint8Array) => value,
    base64url: (source: Uint8Array | ArrayBuffer) => Buffer.from(source as Uint8Array).toString('base64url'),
    getKeypairStore: vi.fn(async () => {
        h.keyPair ??= await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
        return h.keyPair
    }),
    saveKeypairStore: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

vi.mock('@tauri-apps/api/core', () => ({
    ...fakePaths.coreModule,
    invoke: async (command: string, args?: unknown, options?: { headers?: Record<string, string> }) => {
        let chunk: WireChunk | undefined
        if (command === 'write_chunk_raw' || command === 'write_chunk') {
            h.chunkCommands++
            if (h.failChunk !== 0 && h.chunkCommands === h.failChunk) {
                throw new Error('disk full')
            }
        }
        if (command === 'write_chunk_raw' && args instanceof Uint8Array) {
            chunk = { command, bytes: args.slice(), last: (options?.headers ?? {})['x-risu-last'] === '1' }
        } else if (command === 'write_chunk') {
            const named = args as { data: string, last: boolean }
            chunk = { command, bytes: Uint8Array.from(Buffer.from(named.data, 'base64')), last: named.last }
        }
        let refused = false
        try {
            return await desktop.invoke(command, args, options)
        } catch (error) {
            refused = String(error).startsWith('not-raw:')
            throw error
        } finally {
            if (chunk !== undefined && !refused) {
                wire.chunks.push(chunk)
            }
        }
    },
}))
vi.mock('@tauri-apps/api/path', () => ({ ...fakePaths.pathModule, basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/plugin-fs', () => fakeFs.module)
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => h.os }))
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn(async () => { }) }))
vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: { getWriter: () => ({ write: async () => { }, close: async () => { } }) },
        }),
    },
}))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })),
}))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn(async () => new Response(null, { status: 404 })) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }))

vi.mock(import('src/ts/update'), () => ({ checkRisuUpdate: vi.fn(async () => { }) }))
vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({ loadPlugins: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/plugins/plugins.svelte'))
vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    exportCharacterCard: vi.fn(),
    importCharacterProcess: vi.fn(),
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('src/ts/characterCards'))
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({ registerDbChangeEffects: vi.fn() }) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))
vi.mock(import('src/ts/gui/animation'), () => ({ updateAnimationSpeed: vi.fn() }) as unknown as typeof import('src/ts/gui/animation'))
vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))
vi.mock(import('src/ts/observer.svelte'), () => ({ startObserveDom: vi.fn() }) as unknown as typeof import('src/ts/observer.svelte'))
vi.mock(import('src/ts/gui/guisize'), () => ({ updateGuisize: vi.fn() }) as unknown as typeof import('src/ts/gui/guisize'))
vi.mock(import('src/ts/characters'), () => ({ updateLorebooks: vi.fn((v: unknown) => v) }) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/hotkey'), () => ({ initMobileGesture: vi.fn() }) as unknown as typeof import('src/ts/hotkey'))
vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({ getColdStorageItem: vi.fn() }) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({ convertExternalLorebook: vi.fn() }) as unknown as typeof import('src/ts/process/lorebook.svelte'))
vi.mock(import('src/ts/media'), () => ({ compressImage: vi.fn(async (d: Uint8Array) => d) }) as unknown as typeof import('src/ts/media'))
vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))
vi.mock(import('src/ts/process/processzip'), () => ({
    assetByteLimit: () => 200 * 1024 * 1024,
    charxLimits: { assetBytes: 200 * 1024 * 1024, backlogBytes: 32 * 1024 * 1024 },
}) as unknown as typeof import('src/ts/process/processzip'))

const RPACK_MASK = 0x5a

vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(async (data: Uint8Array) => {
        const out = new Uint8Array(data.length)
        for (let i = 0; i < data.length; i++) {
            out[i] = data[i] ^ RPACK_MASK
        }
        return out
    }),
    encodeRPack: vi.fn(async (data: Uint8Array) => data),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

//#endregion

const MIB = 1024 * 1024
const LARGE = 18 * MIB + 4321

const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const keyOf = (bytes: Uint8Array) => `assets/${sha256Hex(bytes)}.png`
const packed = (asset: Uint8Array) => asset.map((byte) => byte ^ RPACK_MASK)

type AppStoreModule = typeof import('src/ts/storage/store/appStore')
type ModulesModule = typeof import('src/ts/process/modules')
type Api = typeof import('src/ts/globalApi.svelte')

interface World {
    api: Api
    appStore: AppStoreModule
    modules: ModulesModule
    language: typeof import('src/lang').language
}

/** A fresh module graph: a fresh page load for every memory the facade and the store keep. */
async function loadWorld(): Promise<World> {
    vi.resetModules()
    const api = await import('src/ts/globalApi.svelte')
    const appStore = await import('src/ts/storage/store/appStore')
    const modules = await import('src/ts/process/modules')
    const { language } = await import('src/lang')
    return { api, appStore, modules, language }
}

function useTauri(os: 'linux' | 'windows' | 'android'): void {
    h.platform.isTauri = true
    h.platform.isNodeServer = false
    h.os = os
    const platform = os === 'windows' ? 'windows' : 'posix'
    fakeFs.setPlatform(platform)
    fakePaths.setPlatform(platform)
    fakeFs.setAppDataRoot(fakePaths.appDataDirectory(platform))
    fakeFs.directories.add('assets')
}

/** The keys under `assets/` the in-memory file system holds, temp files included. */
function assetFiles(): string[] {
    return Array.from(fakeFs.files.keys()).filter((key) => key.startsWith('assets/'))
}

interface Recorded {
    source: ImportSource
    /** the length of every read call, first pass included */
    spans: number[]
    statCalls: () => number
}

/**
 * A source over `bytes` that hands out views of them, as a source over memory does, and counts what it is asked.
 * `over` replaces methods; its `read` receives the real one.
 */
function sourceOf(bytes: Uint8Array, over: {
    /** `secondPass` is true once the source has been asked for its stat a second time, which the pass that saves the assets does first. */
    read?: (real: (start: number, end: number) => Uint8Array, start: number, end: number, secondPass: boolean) => Uint8Array
    stat?: (call: number) => { size: number, modified: number | null }
} = {}): Recorded {
    const spans: number[] = []
    let stats = 0
    const real = (start: number, end: number) => bytes.subarray(Math.min(start, bytes.length), Math.min(end, bytes.length))
    const source: ImportSource = {
        name: 'm.risum',
        size: bytes.length,
        read: async (start, end) => {
            spans.push(end - start)
            return over.read ? over.read(real, start, end, stats > 1) : real(start, end)
        },
        stream: () => { throw new Error('the module reader never streams') },
        stat: async () => {
            stats++
            return over.stat ? over.stat(stats) : { size: bytes.length, modified: 1 }
        },
        close: async () => undefined,
    }
    return { source, spans, statCalls: () => stats }
}

/** A module of a small record, a large one and a small one, as a `.risum` whose bodies the RPack layer decodes. */
function fixture() {
    const small = patterned(777, 1)
    const large = patterned(LARGE, 2)
    const last = patterned(555, 3)
    const bytes = risumBytes({ records: [packed(small), packed(large), packed(last)] })
    // The module's own block is packed too.
    const mainEnd = 6 + new DataView(bytes.buffer).getUint32(2, true)
    for (let i = 6; i < mainEnd; i++) {
        bytes[i] ^= RPACK_MASK
    }
    return { small, large, last, bytes }
}

beforeEach(() => {
    h.platform.isTauri = false
    h.platform.isNodeServer = false
    h.os = 'linux'
    h.keyPair = null
    h.failChunk = 0
    h.chunkCommands = 0
    h.sleeps = []
    h.alerts = []
    fakeFs.reset()
    fakePaths.reset()
    desktop.reset()
    wire.chunks.length = 0
    localStorage.clear()
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

const TRANSPORTS = [
    { name: 'desktop raw chunks', os: 'linux' as const, chunkBytes: CHUNK_MAX },
    { name: 'Android base64 chunks of one MiB', os: 'android' as const, chunkBytes: WRITE_CHUNK_BYTES },
]

describe('a large asset of a .risum on the desktop and Android app', () => {
    test.each(TRANSPORTS)('reproducer: on $name no read of the source and no write to the store is larger than a piece, and no asset goes through saveAsset whole', async (transport) => {
        useTauri(transport.os)
        const { small, large, last, bytes } = fixture()
        const { appStore, modules } = await loadWorld()
        const store = await appStore.getAppStore()
        const writes: number[] = []
        const realWrite = store.write.bind(store)
        vi.spyOn(store, 'write').mockImplementation(async (key, data, mode) => {
            writes.push(data.length)
            return await realWrite(key, data, mode)
        })
        const recorded = sourceOf(bytes)

        const module = await modules.readModule(recorded.source)

        expect(module.assets?.map((asset) => asset[1])).toEqual([keyOf(small), keyOf(large), keyOf(last)])
        expect(Math.max(...recorded.spans)).toBeLessThanOrEqual(4 * MIB)
        expect(wire.chunks.length).toBeGreaterThan(Math.floor(LARGE / transport.chunkBytes))
        expect(Math.max(...wire.chunks.map((chunk) => chunk.bytes.length))).toBeLessThanOrEqual(transport.chunkBytes)
        if (transport.os === 'linux') {
            // Only the piece save sends chunks on the desktop; on Android the small assets are chunked too.
            expect(sha256Hex(Buffer.concat(wire.chunks.map((chunk) => chunk.bytes)))).toBe(sha256Hex(large))
        } else {
            expect(wire.chunks.reduce((sum, chunk) => sum + chunk.bytes.length, 0)).toBe(small.length + large.length + last.length)
        }
        // Only the two small assets reach the store whole.
        expect(writes.sort((a, b) => a - b)).toEqual([555, 777])
        expect(Math.max(...writes)).toBeLessThan(ASSET_PIECE_SAVE_MIN_BYTES)
        expect(assetFiles().sort()).toEqual([keyOf(small), keyOf(large), keyOf(last)].sort())
        expect(Buffer.compare(Buffer.from(fakeFs.files.get(keyOf(large)) ?? []), Buffer.from(large))).toBe(0)
    }, 120_000)

    test('guard: the source bytes are not changed by the import, and a retried save after a failed first attempt stores the original asset', async () => {
        useTauri('linux')
        const { large, bytes } = fixture()
        const pristine = bytes.slice()
        const { modules } = await loadWorld()
        // The third chunk command of the import fails once, after pieces have been consumed.
        h.failChunk = 3
        const recorded = sourceOf(bytes)

        const module = await modules.readModule(recorded.source)

        expect(h.sleeps).toEqual([5000])
        expect(module.assets?.[1][1]).toBe(keyOf(large))
        expect(Buffer.compare(Buffer.from(fakeFs.files.get(keyOf(large)) ?? []), Buffer.from(large))).toBe(0)
        expect(Buffer.compare(Buffer.from(bytes), Buffer.from(pristine))).toBe(0)
        expect(assetFiles().filter((key) => key.includes('risu-write-'))).toEqual([])
    }, 120_000)
})

describe('a large asset whose source changes during the save', () => {
    const LARGE_RECORD_START = (bytes: Uint8Array) => {
        const mainEnd = 6 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(2, true)
        // The small record first: its 5-byte header and 777 bytes.
        return mainEnd + 5 + 777
    }

    const cases: Array<[string, (bytes: Uint8Array) => Parameters<typeof sourceOf>[1]]> = [
        ['a read error in the middle of the asset', (bytes) => {
            const start = LARGE_RECORD_START(bytes)
            return { read: (real, from, to) => {
                if (from >= start + 5 + 8 * MIB && from < start + 5 + 12 * MIB) {
                    throw new Error('device removed')
                }
                return real(from, to)
            } }
        }],
        ['a short read in the middle of the asset', (bytes) => {
            const start = LARGE_RECORD_START(bytes)
            return { read: (real, from, to) => from === start + 5 + 4 * MIB ? real(from, to - 1) : real(from, to) }
        }],
        ['a record header that differs from the first read', (bytes) => {
            const start = LARGE_RECORD_START(bytes)
            return { read: (real, from, to, secondPass) => {
                const got = real(from, to).slice()
                if (secondPass && from === start && got.length >= 1) {
                    got[0] = 2
                }
                return got
            } }
        }],
        ['a size change seen by the check before the file takes its name', () => ({
            // The calls so far: the first pass, the check at the start of the second pass, then this one.
            stat: (call) => ({ size: call >= 3 ? 1 : -1, modified: 1 }),
        })],
        ['a modification time change seen by the check before the file takes its name', () => ({
            stat: (call) => ({ size: -1, modified: call >= 3 ? 2 : 1 }),
        })],
    ]

    test.each(cases)('data safety: %s refuses the import as a changed file, without a retry, and leaves nothing under the key', async (_label, make) => {
        useTauri('linux')
        const { small, large, bytes } = fixture()
        const { modules, language } = await loadWorld()
        const over = make(bytes)
        // A stat reports the size of the bytes unless the case overrides it.
        const recorded = sourceOf(bytes, {
            ...over,
            stat: over.stat
                ? (call) => {
                    const answer = over.stat!(call)
                    return { size: answer.size === -1 ? bytes.length : answer.size, modified: answer.modified }
                }
                : undefined,
        })

        const result = modules.readModule(recorded.source)

        await expect(result).rejects.toThrow(language.moduleFileChanged)
        expect(h.sleeps).toEqual([])
        expect(assetFiles()).toEqual([keyOf(small)])
        expect(fakeFs.files.has(keyOf(large))).toBe(false)
    }, 120_000)
})
