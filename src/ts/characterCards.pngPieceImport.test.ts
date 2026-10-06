/**
 * Importing a PNG card whose assets are larger than the piece-save threshold, with the real module graph from
 * `characterCards.ts` and `pngCardImport.ts` through `globalApi.svelte.ts` and the desktop files store down to the
 * in-memory file system and command stand-ins of `src/ts/storage/tests`. Everything else the import reaches is mocked.
 * A pass says nothing about the Rust commands, the native bridge or a browser.
 *
 * Titles say what a test pins: `reproducer` fails against the importer that decodes a whole chunk, `data safety` pins
 * what must never reach the disk, `guard` holds before and after.
 */
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import crc32 from 'crc/crc32'
import { ASSET_PIECE_SAVE_MIN_BYTES } from 'src/ts/assetHash'
import { CHUNK_MAX, WRITE_CHUNK_BYTES } from 'src/ts/storage/tauriByteTransport'
import type { ImportSource } from 'src/ts/importSource'
import { patterned } from 'src/ts/process/tests/risumFixtures'

const h = vi.hoisted(() => ({
    platform: { isTauri: false, isNodeServer: false },
    os: 'linux' as 'linux' | 'windows' | 'android',
    keyPair: null as CryptoKeyPair | null,
    errors: [] as string[],
    characters: [] as Array<Record<string, unknown>>,
}))

const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))
const fakePaths = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriPathFake')).createFakeTauriPaths())
const desktop = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriDesktopFake')).createDesktopInvoke(fakeFs))

interface WireChunk {
    bytes: Uint8Array
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
    defaultSdDataFunc: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    importPreset: vi.fn(),
    setCurrentCharacter: vi.fn(),
    getCurrentCharacter: vi.fn(),
    getDatabase: vi.fn(() => ({ statics: { imports: 0 }, characters: h.characters, goCharacterOnImport: false })),
    setDatabaseLite: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    appVer: 'test',
    appSubVer: 'test',
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { characters: h.characters } } },
    SettingsMenuIndex: { set: vi.fn() },
    ShowRealmFrameStore: { set: vi.fn() },
    selectedCharID: writable(-1),
    settingsOpen: { set: vi.fn() },
    selIdState: { selId: -1 },
    alertStore: writable({ type: 'none', msg: '' }),
    MobileGUI: writable(false),
    botMakerMode: writable(false),
    loadedStore: writable(false),
    LoadingStatusState: { text: '' },
    ReloadGUIPointer: writable(0),
    bodyIntercepterStore: writable(null),
    savingStoppedReason: writable(null),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertCardExport: vi.fn(),
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn((msg: string | Error) => { h.errors.push(msg instanceof Error ? msg.message : String(msg)) }),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(async () => 'pw'),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    isKnownUri: vi.fn(() => false),
    selectFileByDom: vi.fn(async () => null),
    sleep: vi.fn(async () => { }),
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
        if (command === 'write_chunk_raw' && args instanceof Uint8Array) {
            chunk = { bytes: args.slice() }
        } else if (command === 'write_chunk') {
            chunk = { bytes: Uint8Array.from(Buffer.from((args as { data: string }).data, 'base64')) }
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
vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl: vi.fn(async () => vi.fn()) }))
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
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({ registerDbChangeEffects: vi.fn() }) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))
vi.mock(import('src/ts/gui/animation'), () => ({ updateAnimationSpeed: vi.fn() }) as unknown as typeof import('src/ts/gui/animation'))
vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))
vi.mock(import('src/ts/observer.svelte'), () => ({ startObserveDom: vi.fn() }) as unknown as typeof import('src/ts/observer.svelte'))
vi.mock(import('src/ts/gui/guisize'), () => ({ updateGuisize: vi.fn() }) as unknown as typeof import('src/ts/gui/guisize'))
vi.mock(import('src/ts/hotkey'), () => ({ initMobileGesture: vi.fn() }) as unknown as typeof import('src/ts/hotkey'))
vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({ getColdStorageItem: vi.fn() }) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/upstreamAgreement'), () => ({
    askUpstreamAgreement: vi.fn(async () => true),
    isUpstreamAccepted: vi.fn(() => true),
    publishUpstreamAccepted: vi.fn(),
}) as unknown as typeof import('src/ts/upstreamAgreement'))
vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(async () => { }),
    characterFormatUpdate: vi.fn((c: unknown) => c),
    updateLorebooks: vi.fn((v: unknown) => v),
}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'png'),
}) as unknown as typeof import('src/ts/media'))
vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))
vi.mock(import('src/ts/process/processzip'), () => ({
    CharXImporter: class { },
    CharXWriter: class { },
    assetByteLimit: () => 200 * 1024 * 1024,
}) as unknown as typeof import('src/ts/process/processzip'))
vi.mock(import('src/ts/process/modules'), () => ({
    exportModuleLegacy: vi.fn(),
    readModule: vi.fn(),
    moduleUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/process/modules'))

//#endregion

const MIB = 1024 * 1024
const KIB = 1024
const LARGE = 18 * MIB + 4321

const U8 = Uint8Array
const SIG = new U8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const utf8 = (s: string) => new TextEncoder().encode(s)
const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const keyOf = (bytes: Uint8Array) => `assets/${sha256Hex(bytes)}.png`

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new U8(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) {
        out.set(p, at)
        at += p.length
    }
    return out
}

function chunk(type: string, body: Uint8Array): Uint8Array {
    const t = utf8(type)
    const len = new U8(4)
    new DataView(len.buffer).setUint32(0, body.length)
    const crc = new U8(4)
    new DataView(crc.buffer).setUint32(0, crc32(Buffer.from(concat([t, body]))))
    return concat([len, t, body, crc])
}

const text = (key: string, value: string | Uint8Array) =>
    chunk('tEXt', concat([utf8(key), new U8([0]), typeof value === 'string' ? utf8(value) : value]))
const iend = () => chunk('IEND', new U8(0))
const ihdr = () => chunk('IHDR', new U8(13).fill(1))
const idat = () => chunk('IDAT', new U8(40).fill(7))

/** Base64 text wrapped every 76 characters with CRLF, so a group of characters and the line breaks fall across the pieces. */
const wrapped = (bytes: Uint8Array) => (Buffer.from(bytes).toString('base64').match(/.{1,76}/g) ?? []).join('\r\n')

const v2Json = (assets: number) => JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
        name: 'Big', description: 'd', first_mes: 'hi', character_version: '1',
        extensions: { risuai: { additionalAssets: Array.from({ length: assets }, (_, i) => [`a${i}`, `__asset:${i}`, 'bin']) } },
    },
})

function fixture() {
    const first = patterned(300, 1)
    const large = patterned(LARGE, 2)
    const last = patterned(400, 3)
    const bytes = concat([
        SIG, ihdr(), idat(),
        text('chara-ext-asset_:0', Buffer.from(first).toString('base64')),
        text('chara-ext-asset_:1', wrapped(large)),
        text('chara-ext-asset_:2', Buffer.from(last).toString('base64')),
        text('chara', Buffer.from(v2Json(3), 'utf-8').toString('base64')),
        iend(),
    ])
    return { first, large, last, bytes }
}

type Api = typeof import('src/ts/globalApi.svelte')
type AppStoreModule = typeof import('src/ts/storage/store/appStore')
type CardsModule = typeof import('src/ts/characterCards')

interface World {
    api: Api
    appStore: AppStoreModule
    cards: CardsModule
    language: typeof import('src/lang').language
}

/** A fresh module graph: a fresh page load for every memory the facade and the store keep. */
async function loadWorld(): Promise<World> {
    vi.resetModules()
    const api = await import('src/ts/globalApi.svelte')
    const appStore = await import('src/ts/storage/store/appStore')
    const cards = await import('src/ts/characterCards')
    const { language } = await import('src/lang')
    return { api, appStore, cards, language }
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

function assetFiles(): string[] {
    return Array.from(fakeFs.files.keys()).filter((key) => key.startsWith('assets/'))
}

interface Recorded {
    source: ImportSource
    spans: number[]
}

/** A source over `bytes` that hands out views of them and counts what it is asked; `over` can replace what it answers. */
function sourceOf(bytes: Uint8Array, over: {
    /** `secondPass` is true once the source has been asked for its stat a second time, which the walk over the assets does first. */
    read?: (real: (start: number, end: number) => Uint8Array, start: number, end: number, secondPass: boolean) => Uint8Array
    stat?: (call: number) => { size: number, modified: number | null }
} = {}): Recorded {
    const spans: number[] = []
    let stats = 0
    const real = (start: number, end: number) => bytes.subarray(Math.min(start, bytes.length), Math.min(end, bytes.length))
    const source: ImportSource = {
        name: 'card.png',
        size: bytes.length,
        read: async (start, end) => {
            spans.push(end - start)
            return over.read ? over.read(real, start, end, stats > 1) : real(start, end)
        },
        stream: () => { throw new Error('the card reader never streams') },
        stat: async () => {
            stats++
            return over.stat ? over.stat(stats) : { size: bytes.length, modified: 1 }
        },
        close: async () => undefined,
    }
    return { source, spans }
}

beforeEach(() => {
    h.platform.isTauri = false
    h.platform.isNodeServer = false
    h.os = 'linux'
    h.keyPair = null
    h.errors = []
    h.characters = []
    fakeFs.reset()
    fakePaths.reset()
    desktop.reset()
    wire.chunks.length = 0
    localStorage.clear()
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

const TRANSPORTS = [
    { name: 'desktop raw chunks', os: 'linux' as const, chunkBytes: CHUNK_MAX },
    { name: 'Android base64 chunks of one MiB', os: 'android' as const, chunkBytes: WRITE_CHUNK_BYTES },
]

describe('a large asset of a PNG card on the desktop and Android app', () => {
    test.each(TRANSPORTS)('reproducer: on $name no read of the source and no write to the store is larger than a piece, and the keys are the content hashes', async (transport) => {
        useTauri(transport.os)
        const { first, large, last, bytes } = fixture()
        const { appStore, cards } = await loadWorld()
        const store = await appStore.getAppStore()
        const writes: number[] = []
        const realWrite = store.write.bind(store)
        vi.spyOn(store, 'write').mockImplementation(async (key, data, mode) => {
            writes.push(data.length)
            return await realWrite(key, data, mode)
        })
        const recorded = sourceOf(bytes)

        await cards.importCharacterProcess({ name: 'card.png', data: recorded.source })

        expect(h.errors).toEqual([])
        expect(h.characters).toHaveLength(1)
        const assets = h.characters[0].additionalAssets as string[][]
        expect(assets.map((asset) => asset[1])).toEqual([keyOf(first), keyOf(large), keyOf(last)])
        expect(Math.max(...recorded.spans)).toBeLessThanOrEqual(CHUNK_MAX)
        expect(wire.chunks.length).toBeGreaterThan(Math.floor(LARGE / transport.chunkBytes))
        expect(Math.max(...wire.chunks.map((chunk) => chunk.bytes.length))).toBeLessThanOrEqual(transport.chunkBytes)
        expect(Math.max(...writes)).toBeLessThan(ASSET_PIECE_SAVE_MIN_BYTES)
        expect(Buffer.compare(Buffer.from(fakeFs.files.get(keyOf(large)) ?? []), Buffer.from(large))).toBe(0)
        expect(assetFiles().filter((key) => key.includes('risu-write-'))).toEqual([])
    }, 120_000)
})

describe('a large asset of a PNG card whose source changes during the save', () => {
    const LARGE_CHUNK_START = (bytes: Uint8Array) => Buffer.from(bytes).indexOf('chara-ext-asset_:1') - 8

    const cases: Array<[string, (bytes: Uint8Array) => Parameters<typeof sourceOf>[1]]> = [
        ['a read error in the middle of the asset', (bytes) => {
            const start = LARGE_CHUNK_START(bytes)
            return { read: (real, from, to) => {
                if (from > start + 8 * MIB && from < start + 12 * MIB) {
                    throw new Error('device removed')
                }
                return real(from, to)
            } }
        }],
        ['a short read in the middle of the asset', (bytes) => {
            const start = LARGE_CHUNK_START(bytes)
            return { read: (real, from, to) => from > start + 4 * MIB && from < start + 6 * MIB ? real(from, to - 1) : real(from, to) }
        }],
        ['a chunk header that differs from the first read', (bytes) => {
            const start = LARGE_CHUNK_START(bytes)
            return { read: (real, from, to, secondPass) => {
                const got = real(from, to).slice()
                if (secondPass && from <= start && start < from + got.length) {
                    got[start - from + 3] ^= 0x01
                }
                return got
            } }
        }],
        ['a size change seen by the check before the file takes its name', () => ({
            stat: (call) => ({ size: call >= 3 ? 1 : -1, modified: 1 }),
        })],
        ['a modification time change seen by the check before the file takes its name', () => ({
            stat: (call) => ({ size: -1, modified: call >= 3 ? 2 : 1 }),
        })],
    ]

    test.each(cases)('data safety: %s refuses the card as a changed file and leaves nothing under the key of the asset in progress', async (_label, make) => {
        useTauri('linux')
        const { first, large, bytes } = fixture()
        const { cards, language } = await loadWorld()
        const over = make(bytes)
        const recorded = sourceOf(bytes, {
            ...over,
            stat: over.stat
                ? (call) => {
                    const answer = over.stat!(call)
                    return { size: answer.size === -1 ? bytes.length : answer.size, modified: answer.modified }
                }
                : undefined,
        })

        await cards.importCharacterProcess({ name: 'card.png', data: recorded.source })

        expect(h.errors).toEqual([language.cardFileChanged])
        expect(h.characters).toEqual([])
        // The asset before it stays; the one in progress left nothing, not even a temp.
        expect(assetFiles()).toEqual([keyOf(first)])
        expect(fakeFs.files.has(keyOf(large))).toBe(false)
    }, 120_000)
})
