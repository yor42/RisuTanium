// @vitest-environment happy-dom

/**
 * `characterURLImport` in `src/ts/characterCards.ts`: `#import=` links, Chub downloads, the file-handler queue and the
 * retired `#share` hashes, which do nothing.
 *
 * The real `characterCards.ts`, `processzip.ts` and `pngChunk.ts` run against synthetic cards. The database, asset
 * storage and alerts are replaced by recorders, and `fetch` is a fake that records every call and answers the external
 * download URLs; its share routes only stand for a share that no code consumes any more. Outcomes
 * are asserted (characters made, presets and modules read, messages shown); `PngChunk.scanCard` and
 * `CharXImporter.prototype.parse` are observed to check that a card reaches the parser as a `File`.
 */

import crc32 from 'crc/crc32'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const h = vi.hoisted(() => ({
    saved: 0,
    errors: [] as string[],
    /** typeof of every value handed to alertError */
    errorKinds: [] as string[],
    /** alert and import events in the order they happened */
    events: [] as string[],
    characters: [] as Array<Record<string, unknown>>,
    modules: [] as Array<Record<string, unknown>>,
    presets: [] as Array<{ name: string, data: unknown }>,
    moduleReads: [] as unknown[],
    /** makes the mocked readModule throw a ModuleRefusal with this message */
    moduleFails: null as string | null,
    /** makes the mocked readModule ask its beforeAssets hook about a module with low-level access, as the real one does before it saves an asset */
    moduleLowLevel: false,
    /** how many times the mocked readModule got past its hook, that is, started saving assets */
    moduleSaved: 0,
    ordered: 0,
    uuid: 0,
    /** what the single alert slot holds: every alert function replaces it */
    last: 'none',
    /** the answer of the low-level-access prompt */
    confirm: true,
    /** the text of every confirmation prompt shown, link prompts and low-level-access prompts alike */
    prompts: [] as string[],
    /** the answer of the link prompts (`#import=`, `?charahub=`, `#import_module=`, `#import_preset=`) */
    linkConfirm: true,
    /** what was true at the moment each prompt was shown: fetches so far, the alert slot and the busy entries */
    asks: [] as Array<{ msg: string, fetchCount: number, last: string, busy: string[] }>,
    /** answers a prompt by its content and records the state it was shown in; assigned in beforeEach */
    ask: (_msg: string): boolean => true,
    /** makes importPreset throw this message */
    presetFails: null as string | null,
    isTauri: false,
    /** what readFile answers per path; an Error is thrown */
    tauriFiles: {} as Record<string, Uint8Array | Error>,
    /** whether the mocked restore guard refuses a file-handler launch, and how many launches it refused */
    restoring: false,
    refusals: 0,
}))

vi.mock(import('src/ts/drive/backupWorkGuard'), async (importOriginal) => ({
    ...await importOriginal(),
    refuseImportWhileRestoring: () => {
        if (h.restoring) {
            h.refusals++
        }
        return h.restoring
    },
}))

vi.mock('uuid', () => ({
    v4: () => `uuid-${++h.uuid}`,
}))

/** What the operating-system plugin answers; 'throw' (the default) models a page without the plugin. */
const osBox = vi.hoisted(() => ({ os: 'throw' }))

vi.mock('@tauri-apps/plugin-os', () => ({
    type: () => {
        if (osBox.os === 'throw') throw new Error('no operating-system plugin')
        return osBox.os
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return h.isTauri },
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/upstreamAgreement'), () => ({
    askUpstreamAgreement: vi.fn(async () => true),
    isUpstreamAccepted: vi.fn(() => true),
    publishUpstreamAccepted: vi.fn(),
}) as unknown as typeof import('src/ts/upstreamAgreement'))

vi.mock(import('src/ts/alert'), () => {
    const text = (msg: string | Error) => msg instanceof Error ? msg.message : String(msg)
    return {
        alertCardExport: vi.fn(),
        alertConfirm: vi.fn(async (msg?: string) => { h.prompts.push(String(msg)); const answer = h.ask(String(msg)); h.last = 'none'; return answer }),
        alertError: vi.fn((msg: string | Error) => { h.errors.push(text(msg)); h.errorKinds.push(typeof msg); h.events.push('error:' + text(msg)); h.last = 'error:' + text(msg) }),
        alertInput: vi.fn(async () => ''),
        alertMd: vi.fn(),
        alertNormal: vi.fn((msg: string) => { h.events.push('normal:' + msg); h.last = 'normal:' + msg }),
        alertStore: { set: (v: { type?: string, msg?: string }) => { h.last = v.type === 'none' ? 'none' : `${v.type}:${v.msg}` }, subscribe: vi.fn(), update: vi.fn() },
        alertWait: vi.fn((msg: string) => { h.last = 'wait:' + msg }),
    } as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    defaultSdDataFunc: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    importPreset: vi.fn(async (f: { name: string, data: unknown }) => {
        if (h.presetFails !== null) throw new Error(h.presetFails)
        h.presets.push(f)
        h.events.push('preset:' + f.name)
    }),
    setCurrentCharacter: vi.fn(),
    getCurrentCharacter: vi.fn(),
    getDatabase: vi.fn(() => ({ statics: { imports: 0 }, characters: h.characters, goCharacterOnImport: false })),
    setDatabaseLite: vi.fn(),
    appVer: 'test',
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/util'), () => {
    class Semaphore {
        private available: number
        private readonly max: number
        private waiting: Array<() => void> = []
        constructor(max: number) { this.available = max; this.max = max }
        async acquire(): Promise<void> {
            if (this.available > 0) { this.available -= 1; return }
            await new Promise<void>((resolve) => this.waiting.push(resolve))
        }
        release(): void {
            const next = this.waiting.shift()
            if (next) { next(); return }
            if (this.available < this.max) this.available += 1
        }
    }
    return {
        asBuffer: (a: unknown) => a,
        Semaphore,
        checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
        decryptBuffer: vi.fn(async (d: unknown) => d),
        isKnownUri: vi.fn(() => false),
        selectFileByDom: vi.fn(async () => null),
        sleep: vi.fn(async () => {}),
    } as unknown as typeof import('src/ts/util')
})

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(async () => {}),
    characterFormatUpdate: vi.fn((c: unknown) => c),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { AppendableBuffer } = await import('src/ts/byteBuffer')
    return {
        AppendableBuffer,
        BlankWriter: class {},
        LocalWriter: class {},
        VirtualWriter: class {},
        checkCharOrder: vi.fn(() => { h.ordered++; h.events.push('order') }),
        downloadFile: vi.fn(async () => {}),
        forageStorage: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
        loadAsset: vi.fn(async () => new Uint8Array()),
        openURL: vi.fn(),
        readImage: vi.fn(async (d: unknown) => d),
        saveAsset: vi.fn(async () => `asset-${++h.saved}`),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'png'),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { characters: h.characters, modules: h.modules } } },
    SettingsMenuIndex: { set: vi.fn() },
    ShowRealmFrameStore: { set: vi.fn() },
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    selectedCharID: { set: vi.fn() },
    settingsOpen: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/modules'), () => ({
    exportModuleLegacy: vi.fn(),
    readModule: vi.fn(async (data: Uint8Array | { size: number, read: (start: number, end: number) => Promise<Uint8Array> }, opts?: { beforeAssets?: (module: { name: string, lowLevelAccess?: boolean }) => Promise<void> }) => {
        h.moduleReads.push(data instanceof Uint8Array ? data : await data.read(0, data.size))
        h.events.push('module')
        if (h.moduleFails) throw new ModuleRefusal(h.moduleFails)
        if (h.moduleLowLevel) await opts?.beforeAssets?.({ name: 'synthetic module', lowLevelAccess: true })
        h.moduleSaved++
        return { name: 'synthetic module', lorebook: [], trigger: [], regex: [] }
    }),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    SeekMode: { Start: 0, Current: 1, End: 2 },
    readFile: vi.fn(async (path: string) => {
        const answer = h.tauriFiles[path] ?? new Uint8Array()
        if (answer instanceof Error) throw answer
        return answer
    }),
    open: vi.fn(async (path: string) => {
        const answer = h.tauriFiles[path] ?? new Uint8Array()
        if (answer instanceof Error) throw answer
        let position = 0
        return {
            read: async (buffer: Uint8Array) => {
                if (position >= answer.length) return null
                const count = Math.min(buffer.byteLength, answer.length - position)
                buffer.set(answer.subarray(position, position + count), 0)
                position += count
                return count
            },
            seek: async (offset: number) => { position = offset; return position },
            stat: async () => ({ size: answer.length, mtime: null }),
            close: async () => {},
        }
    }),
}))

//#endregion

import { characterURLImport, importCharacterFile, importOpenedFiles } from 'src/ts/characterCards'
import { CharXImporter } from 'src/ts/process/processzip'
import { fflateZipArchive, type ZipEntry } from 'src/ts/process/tests/zipFixtures'
import { PngChunk } from 'src/ts/pngChunk'
import { ModuleRefusal } from 'src/ts/process/moduleRefusal'
import { language } from 'src/lang'
import { fillLang } from 'src/lang/fill'
import { MODULE_STUB_KEY } from 'src/ts/storage/moduleStub'
import { busyKinds, isBusy } from 'src/ts/process/memory/busyActions'

// ---------------------------------------------------------------------------------------------
// Synthetic cards (no real images, no user data)
// ---------------------------------------------------------------------------------------------

const U8 = Uint8Array
const enc = new TextEncoder()

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new U8(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) {
        out.set(p, at)
        at += p.length
    }
    return out
}

const v3Card = (name: string) => JSON.stringify({
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
        name, description: 'd', first_mes: 'hi', character_version: '1',
        extensions: { risuai: {} },
        assets: [],
    },
})

async function charxBytes(name: string): Promise<Uint8Array> {
    return fflateZipArchive([['card.json', enc.encode(v3Card(name)), 6]])
}

function pngChunk(type: string, body: Uint8Array): Uint8Array {
    const t = enc.encode(type)
    const len = new U8(4)
    new DataView(len.buffer).setUint32(0, body.length)
    const crc = new U8(4)
    new DataView(crc.buffer).setUint32(0, crc32(Buffer.from(concat([t, body]))))
    return concat([len, t, body, crc])
}

function pngCard(name: string): Uint8Array {
    const card = JSON.stringify({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: { name, description: 'd', personality: '', scenario: '', first_mes: 'hi', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [], creator: '', character_version: '1', extensions: { risuai: {} } },
    })
    return concat([
        new U8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', new U8(13).fill(1)),
        pngChunk('tEXt', concat([enc.encode('chara'), new U8([0]), enc.encode(Buffer.from(card).toString('base64'))])),
        pngChunk('IDAT', new U8(20).fill(2)),
        pngChunk('IEND', new U8(0)),
    ])
}

// ---------------------------------------------------------------------------------------------
// Fake network: the retired share routes plus external download URLs
// ---------------------------------------------------------------------------------------------

type Shared = { name: string, type: string, bytes: Uint8Array }
type Share = { files: Shared[], claimed: boolean, indexAnswer?: () => Response }

const shares = new Map<string, Share>()
const routes = new Map<string, () => Response>()
let fetchCalls: Array<{ url: string, method: string }> = []

const SHARE_ID = '1760000000000-00000000-0000-4000-8000-000000000001'

function seedShare(files: Shared[], id = SHARE_ID, indexAnswer?: () => Response): string {
    shares.set(id, { files, claimed: false, indexAnswer })
    return id
}

const notFound = () => new Response('not found', { status: 404 })

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = String(input)
    const method = init?.method ?? 'GET'
    fetchCalls.push({ url, method })
    let m = /^\/sw\/share\/([^/]+)\/index$/.exec(url)
    if (m && method === 'DELETE') {
        const share = shares.get(m[1])
        if (!share || share.claimed) return notFound()
        share.claimed = true
        if (share.indexAnswer) return share.indexAnswer()
        return new Response(JSON.stringify({
            files: share.files.map((f, n) => ({ key: `/sw/share/${m![1]}/${n}`, name: f.name, type: f.type })),
        }), { headers: { 'content-type': 'application/json' } })
    }
    m = /^\/sw\/share\/([^/]+)\/(\d+)$/.exec(url)
    if (m && method === 'GET') {
        const file = shares.get(m[1])?.files[Number(m[2])]
        if (!file) return notFound()
        return new Response(new U8(file.bytes), { headers: file.type ? { 'content-type': file.type } : {} })
    }
    m = /^\/sw\/share\/([^/]+)$/.exec(url)
    if (m && method === 'DELETE') {
        h.events.push('delete')
        shares.delete(m[1])
        return new Response(JSON.stringify({ done: true }))
    }
    const route = routes.get(url)
    if (route) return route()
    throw new TypeError('network error (no route): ' + url)
}

/**
 * Counts reads of a Response body: `blob()` and `text()` are counted, `arrayBuffer()` only when it is not called from
 * inside `blob()` (a Response may implement `blob()` through it).
 */
function watched(res: Response) {
    const reads = { arrayBuffer: 0, blob: 0, other: 0 }
    const realArrayBuffer = res.arrayBuffer.bind(res)
    const realBlob = res.blob.bind(res)
    const realText = res.text.bind(res)
    let insideBlob = false
    Object.defineProperty(res, 'arrayBuffer', { configurable: true, value: () => { if (!insideBlob) reads.arrayBuffer++; return realArrayBuffer() } })
    Object.defineProperty(res, 'blob', { configurable: true, value: async () => { reads.blob++; insideBlob = true; try { return await realBlob() } finally { insideBlob = false } } })
    Object.defineProperty(res, 'text', { configurable: true, value: () => { reads.other++; return realText() } })
    Object.defineProperty(res, 'json', { configurable: true, value: async () => { reads.other++; return JSON.parse(await realText()) } })
    return reads
}

const setUrl = (pathAndQuery: string) => window.history.replaceState(null, '', pathAndQuery)

// ---------------------------------------------------------------------------------------------
// Observing the card parsers
// ---------------------------------------------------------------------------------------------

type ParseArg = Parameters<CharXImporter['parse']>[0]
type ScanArg = Parameters<typeof PngChunk.scanCard>[0]
type ScanOptions = Parameters<typeof PngChunk.scanCard>[1]
let parseArgs: ParseArg[] = []
let scanArgs: ScanArg[] = []

const originalFetch = globalThis.fetch
const realParse = CharXImporter.prototype.parse
const realScan = PngChunk.scanCard

beforeEach(() => {
    h.saved = 0
    h.errors = []
    h.errorKinds = []
    h.events = []
    h.characters = []
    h.modules = []
    h.presets = []
    h.moduleReads = []
    h.moduleFails = null
    h.moduleLowLevel = false
    h.moduleSaved = 0
    h.ordered = 0
    h.uuid = 0
    h.last = 'none'
    h.confirm = true
    h.prompts = []
    h.linkConfirm = true
    h.asks = []
    h.ask = (msg) => {
        h.asks.push({ msg, fetchCount: fetchCalls.length, last: h.last, busy: busyKinds() })
        // The low-level-access prompts keep answering through `h.confirm`; every other prompt is a link prompt.
        return msg.includes(language.lowLevelAccessConfirm) ? h.confirm : h.linkConfirm
    }
    h.presetFails = null
    h.isTauri = false
    h.tauriFiles = {}
    h.restoring = false
    h.refusals = 0
    shares.clear()
    routes.clear()
    fetchCalls = []
    parseArgs = []
    scanArgs = []
    setUrl('/')
    vi.spyOn(CharXImporter.prototype, 'parse').mockImplementation(function (this: CharXImporter, data: ParseArg) {
        parseArgs.push(data)
        h.events.push('parse:' + (data instanceof File ? data.name : 'bytes'))
        return realParse.call(this, data)
    })
    vi.spyOn(PngChunk, 'scanCard').mockImplementation((data: ScanArg, arg?: ScanOptions) => {
        scanArgs.push(data)
        h.events.push('scan:' + (data instanceof File ? data.name : 'bytes'))
        return realScan.call(PngChunk, data, arg)
    })
    vi.stubGlobal('fetch', fakeFetch)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.stubGlobal('fetch', originalFetch)
    vi.restoreAllMocks()
    delete (window as unknown as { launchQueue?: unknown }).launchQueue
    osBox.os = 'throw'
    setUrl('/')
})

const charName = (i: number) => (h.characters[i] as { name?: string })?.name

// ---------------------------------------------------------------------------------------------
// #import= links
// ---------------------------------------------------------------------------------------------

describe('#import= links', () => {
    test('a .charx link is read as a Blob and reaches the parser as a File named from content-disposition', async () => {
        const bytes = await charxBytes('Linked')
        const res = new Response(new U8(bytes), { headers: { 'content-disposition': 'attachment; filename="cool.charx"' } })
        const reads = watched(res)
        routes.set('https://files.test/dl', () => res)
        setUrl('/#import=https://files.test/dl')
        await characterURLImport()
        expect(parseArgs).toHaveLength(1)
        expect(parseArgs[0]).toBeInstanceOf(File)
        expect((parseArgs[0] as File).name).toBe('cool.charx')
        expect(reads.blob).toBe(1)
        expect(reads.arrayBuffer).toBe(0)
        expect(h.errors).toEqual([])
        expect(charName(0)).toBe('Linked')
        expect(h.ordered).toBe(1)
        expect(window.location.hash).toBe('')
    })

    // Classification: the suffix table maps .byaf to a card, so the link reaches the card import (a base classifies it as an unsupported file).
    test('a .byaf link is classified as a card and imports as a character (two passes read the same File)', async () => {
        const setupClone = globalThis.safeStructuredClone
        globalThis.safeStructuredClone = structuredClone
        try {
            const manifest = { schemaVersion: 1, characters: ['characters/c1/character.json'], scenarios: ['scenarios/s1.json'] }
            const character = { schemaVersion: 1, id: 'c1', name: 'Linked', images: [] }
            const scenario = { schemaVersion: 1, narrative: 'n', firstMessages: [{ text: 'hi' }] }
            const bytes = fflateZipArchive([
                ['manifest.json', enc.encode(JSON.stringify(manifest))],
                ['characters/c1/character.json', enc.encode(JSON.stringify(character))],
                ['scenarios/s1.json', enc.encode(JSON.stringify(scenario))],
            ])
            const res = new Response(new U8(bytes), { headers: { 'content-disposition': 'attachment; filename="cool.byaf"' } })
            routes.set('https://files.test/dl', () => res)
            setUrl('/#import=https://files.test/dl')
            await characterURLImport()
            expect(h.errors).toEqual([])
            expect(charName(0)).toBe('Linked')
            expect(parseArgs.map((a) => (a as File).name)).toEqual(['cool.byaf', 'cool.byaf'])
        } finally {
            globalThis.safeStructuredClone = setupClone
        }
    })

    test('a link answered with a non-2xx status is refused with noData and its body is never read', async () => {
        const res = new Response(new U8(await charxBytes('Linked')), { status: 404, headers: { 'content-disposition': 'attachment; filename="cool.charx"' } })
        const reads = watched(res)
        routes.set('https://files.test/dl', () => res)
        setUrl('/#import=https://files.test/dl')
        await characterURLImport()
        expect(h.errors).toEqual([language.errors.noData])
        expect(reads).toEqual({ arrayBuffer: 0, blob: 0, other: 0 })
        expect(parseArgs).toEqual([])
        expect(h.characters).toEqual([])
    })

    test('guard: on Android a refused https link keeps noData', async () => {
        osBox.os = 'android'
        routes.set('https://files.test/dl', () => { throw new TypeError('Failed to fetch') })
        setUrl('/#import=https://files.test/dl')
        await characterURLImport()
        expect(h.errors).toEqual([language.errors.noData])
    })

    test('a .json card link imports as a card and a .preset link reaches the preset importer', async () => {
        routes.set('https://files.test/c.json', () => new Response(v3Card('FromJson'), { headers: { 'content-disposition': 'attachment; filename="c.json"' } }))
        setUrl('/#import=https://files.test/c.json')
        await characterURLImport()
        expect(charName(0)).toBe('FromJson')
        routes.set('https://files.test/p.preset', () => new Response('{"name":"x"}', { headers: { 'content-disposition': 'attachment; filename="p.preset"' } }))
        setUrl('/#import=https://files.test/p.preset')
        await characterURLImport()
        expect(h.presets.map((p) => p.name)).toEqual(['p.preset'])
    })

    test('.risup and .risum links still reach their importers with bytes (compatibility guard)', async () => {
        routes.set('https://files.test/p.risup', () => new Response(new U8([1, 2, 3]), { headers: { 'content-disposition': 'attachment; filename="p.risup"' } }))
        routes.set('https://files.test/m.risum', () => new Response(new U8([4, 5]), { headers: { 'content-disposition': 'attachment; filename="m.risum"' } }))
        setUrl('/#import=https://files.test/p.risup')
        await characterURLImport()
        setUrl('/#import=https://files.test/m.risum')
        await characterURLImport()
        expect(h.presets).toHaveLength(1)
        expect(h.presets[0].name).toBe('p.risup')
        expect(h.presets[0].data).toBeInstanceOf(Uint8Array)
        expect(h.presets[0].data).not.toBeInstanceOf(File)
        expect(Array.from(h.presets[0].data as Uint8Array)).toEqual([1, 2, 3])
        expect(h.moduleReads).toHaveLength(1)
        expect(Array.from(h.moduleReads[0] as Uint8Array)).toEqual([4, 5])
        expect(h.modules).toHaveLength(1)
    })

    test('#import_module= and #import_preset= links behave as before (compatibility guard)', async () => {
        const moduleJson = Buffer.from(JSON.stringify({ name: 'inline module' })).toString('base64')
        setUrl('/#import_module=' + encodeURIComponent(moduleJson))
        await characterURLImport()
        expect(h.modules).toHaveLength(1)
        expect(h.modules[0].name).toBe('inline module')
        expect(h.events).toContain('normal:' + language.successImport)
        const presetBytes = Buffer.from('{"name":"inline"}').toString('base64')
        setUrl('/#import_preset=' + encodeURIComponent(presetBytes))
        await characterURLImport()
        expect(h.presets.map((p) => p.name)).toEqual(['imported.risupreset'])
    })
})

// ---------------------------------------------------------------------------------------------
// Chub downloads
// ---------------------------------------------------------------------------------------------

describe('?charahub= downloads', () => {
    const CHUB = 'https://api.chub.ai/api/characters/download'

    test('a successful download reaches the PNG reader as a File named charahub.png and the card is imported and ordered', async () => {
        const res = new Response(new U8(pngCard('FromChub')), { headers: { 'content-type': 'image/png' } })
        const reads = watched(res)
        routes.set(CHUB, () => res)
        setUrl('/?charahub=someone/card')
        await characterURLImport()
        expect(scanArgs).toHaveLength(1)
        expect(scanArgs[0]).toBeInstanceOf(File)
        expect((scanArgs[0] as File).name).toBe('charahub.png')
        expect((scanArgs[0] as File).type).toBe('image/png')
        expect(reads.arrayBuffer).toBe(0)
        expect(h.errors).toEqual([])
        expect(charName(0)).toBe('FromChub')
        expect(h.ordered).toBe(1)
    })

    test('a download answered with a non-2xx status is refused with noData and its body is never read', async () => {
        const res = new Response(new U8(pngCard('FromChub')), { status: 404 })
        const reads = watched(res)
        routes.set(CHUB, () => res)
        setUrl('/?charahub=someone/card')
        await characterURLImport()
        expect(h.errors).toEqual([language.errors.noData])
        expect(reads).toEqual({ arrayBuffer: 0, blob: 0, other: 0 })
        expect(scanArgs).toEqual([])
        expect(h.characters).toEqual([])
    })
})

// ---------------------------------------------------------------------------------------------
// Retired share hashes
// ---------------------------------------------------------------------------------------------

describe('retired share hashes', () => {
    test.each([
        ['#share=<id> with a stored share', async () => '/#share=' + seedShare([{ name: 'a.charx', type: 'application/octet-stream', bytes: await charxBytes('Shared') }])],
        ['#share-empty', async () => '/#share-empty'],
        ['#share-failed', async () => '/#share-failed'],
    ] as Array<[string, () => Promise<string>]>)('R3 %s fetches nothing, imports nothing, shows nothing and keeps the file-handler consumer registered', async (_label, link) => {
        const setConsumer = vi.fn()
        ;(window as unknown as { launchQueue: unknown }).launchQueue = { setConsumer }
        setUrl(await link())
        await characterURLImport()
        expect(fetchCalls).toEqual([])
        expect(h.errors).toEqual([])
        expect(h.events).toEqual([])
        expect(h.characters).toEqual([])
        expect(h.asks).toEqual([])
        expect(setConsumer).toHaveBeenCalledTimes(1)
    })
})

// ---------------------------------------------------------------------------------------------
// The file-handler queue
// ---------------------------------------------------------------------------------------------

type LaunchParams = { files: Array<{ name: string, getFile: () => Promise<File> }> }

describe('launchQueue', () => {
    test('a file handed over by the file handler reaches the card parser as a File', async () => {
        let consumer: ((params: LaunchParams) => void) | null = null
        ;(window as unknown as { launchQueue: unknown }).launchQueue = { setConsumer: (fn: (params: LaunchParams) => void) => { consumer = fn } }
        await characterURLImport()
        expect(consumer).not.toBeNull()
        const file = new File([new U8(await charxBytes('Queued'))], 'q.charx', { type: 'application/octet-stream' })
        consumer!({ files: [{ name: 'q.charx', getFile: async () => file }] })
        await vi.waitFor(() => expect(h.characters).toHaveLength(1))
        expect(parseArgs[0]).toBeInstanceOf(File)
        expect(charName(0)).toBe('Queued')
    })

    test('a launched JSON over the cap is refused as not a card file without one read of its content', async () => {
        let consumer: ((params: LaunchParams) => Promise<void>) | null = null
        ;(window as unknown as { launchQueue: unknown }).launchQueue = { setConsumer: (fn: (params: LaunchParams) => Promise<void>) => { consumer = fn } }
        await characterURLImport()
        const file = new File([new U8(64 * 1024 * 1024 + 1)], 'big.json', { type: 'application/json' })
        const spies = (['arrayBuffer', 'slice', 'stream', 'text'] as const).map((method) => vi.spyOn(file, method))
        await consumer!({ files: [{ name: 'big.json', getFile: async () => file }] })
        expect(h.last).toBe('error:' + language.importNotCardFile)
        expect(spies.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0, 0])
        expect(h.characters).toEqual([])
    })

    test('a launch during a restore is refused and nothing is imported; once the restore is over the same launch imports', async () => {
        let consumer: ((params: LaunchParams) => void) | null = null
        ;(window as unknown as { launchQueue: unknown }).launchQueue = { setConsumer: (fn: (params: LaunchParams) => void) => { consumer = fn } }
        await characterURLImport()
        const file = new File([new U8(await charxBytes('Queued'))], 'q.charx', { type: 'application/octet-stream' })
        h.restoring = true
        consumer!({ files: [{ name: 'q.charx', getFile: async () => file }] })
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(h.refusals).toBe(1)
        expect(h.characters).toHaveLength(0)
        expect(parseArgs).toHaveLength(0)

        h.restoring = false
        consumer!({ files: [{ name: 'q.charx', getFile: async () => file }] })
        await vi.waitFor(() => expect(h.characters).toHaveLength(1))
        expect(charName(0)).toBe('Queued')
    })

    test('a file that cannot be read does not stop the files after it; what did not import is named once at the end, a refused module with its reason', async () => {
        const unhandled: unknown[] = []
        const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
        process.on('unhandledRejection', onUnhandled)
        try {
            h.moduleFails = language.errors.noData
            let consumer: ((params: LaunchParams) => Promise<void>) | null = null
            ;(window as unknown as { launchQueue: unknown }).launchQueue = { setConsumer: (fn: (params: LaunchParams) => Promise<void>) => { consumer = fn } }
            await characterURLImport()
            const good = new File([new U8(await charxBytes('Queued'))], 'q.charx', { type: 'application/octet-stream' })
            await consumer!({ files: [
                { name: 'broken.charx', getFile: async () => { throw new Error('read failed') } },
                { name: 'q.charx', getFile: async () => good },
                { name: 'bad.risum', getFile: async () => new File([new U8([8])], 'bad.risum') },
            ] })
            await vi.waitFor(() => expect(h.characters).toHaveLength(1), { timeout: 500 })
            expect(charName(0)).toBe('Queued')
            expect(h.last).toBe('error:' + language.importFilesNotImported(2, 3, 'broken.charx: read failed\nbad.risum: ' + language.errors.noData))
            expect(h.modules).toEqual([])
            await new Promise((resolve) => setTimeout(resolve, 20))
            expect(unhandled).toEqual([])
        } finally {
            process.off('unhandledRejection', onUnhandled)
        }
    })

    test('a refused module opened alone shows its reason as the last message', async () => {
        h.moduleFails = language.errors.noData
        let consumer: ((params: LaunchParams) => Promise<void>) | null = null
        ;(window as unknown as { launchQueue: unknown }).launchQueue = { setConsumer: (fn: (params: LaunchParams) => Promise<void>) => { consumer = fn } }
        await characterURLImport()
        await consumer!({ files: [{ name: 'bad.risum', getFile: async () => new File([new U8([8])], 'bad.risum') }] })
        await vi.waitFor(() => expect(h.last).toBe('error:' + language.errors.noData), { timeout: 500 })
        expect(h.errorKinds).toEqual(['string'])
        expect(h.modules).toEqual([])
    })
})

// ---------------------------------------------------------------------------------------------
// Files opened through Tauri, and the links that import a module or a preset inline
// ---------------------------------------------------------------------------------------------

describe('importOpenedFiles', () => {
    test('a file that cannot be read does not stop the files after it, and what did not import is named once at the end', async () => {
        h.moduleFails = language.errors.noData
        const good = await charxBytes('Opened')
        h.tauriFiles = {
            'C:\\docs\\broken.charx': new Error('read denied'),
            'C:\\docs\\ok.charx': good,
            'C:\\docs\\bad.risum': new U8([8]),
        }
        await importOpenedFiles(['C:\\docs\\broken.charx', 'C:\\docs\\ok.charx', 'C:\\docs\\bad.risum'])
        expect(charName(0)).toBe('Opened')
        expect(h.characters).toHaveLength(1)
        expect(h.modules).toEqual([])
        expect(h.last).toBe('error:' + language.importFilesNotImported(2, 3, 'broken.charx: read denied\nbad.risum: ' + language.errors.noData))
    })

    test('files that all import show no error (guard)', async () => {
        h.tauriFiles = { '/docs/a.charx': await charxBytes('A'), '/docs/b.charx': await charxBytes('B') }
        await importOpenedFiles(['/docs/a.charx', '/docs/b.charx'])
        expect(h.characters).toHaveLength(2)
        expect(h.errors).toEqual([])
    })

    test('characterURLImport reads no file from a window.tauriOpenedFiles list', async () => {
        const { readFile } = await import('@tauri-apps/plugin-fs')
        vi.mocked(readFile).mockClear()
        h.isTauri = true
        h.tauriFiles = { '/docs/a.charx': await charxBytes('A') }
        ;(window as unknown as { tauriOpenedFiles: string[] }).tauriOpenedFiles = ['/docs/a.charx']
        await characterURLImport()
        delete (window as unknown as { tauriOpenedFiles?: unknown }).tauriOpenedFiles
        expect(readFile).not.toHaveBeenCalled()
        expect(h.characters).toHaveLength(0)
    })
})

describe('#import_module= and #import_preset= links', () => {
    const moduleLink = (body: string) => '/#import_module=' + encodeURIComponent(Buffer.from(body).toString('base64'))
    const presetLink = (body: string) => '/#import_preset=' + encodeURIComponent(Buffer.from(body).toString('base64'))

    test.each([
        ['malformed module data', () => moduleLink('not json'), 'error:'],
        ['a module whose low-level-access prompt is declined', () => { h.confirm = false; return moduleLink(JSON.stringify({ name: 'm', lowLevelAccess: true })) }, 'none'],
        ['a module that imports', () => moduleLink(JSON.stringify({ name: 'm' })), 'normal:' + language.successImport],
        ['a preset that fails to import', () => { h.presetFails = 'preset broken'; return presetLink('{"name":"p"}') }, 'error:preset broken'],
        ['a preset that imports', () => presetLink('{"name":"p"}'), 'none'],
    ] as Array<[string, () => string, string]>)('%s: the start-up work after it still runs and the file-handler consumer is registered', async (_label, link, lastStart) => {
        const setConsumer = vi.fn()
        ;(window as unknown as { launchQueue: unknown }).launchQueue = { setConsumer }
        setUrl(link())
        await characterURLImport()
        expect(setConsumer).toHaveBeenCalledTimes(1)
        expect(h.last.startsWith(lastStart)).toBe(true)
    })

    test('a module that carries the stub marker is refused as text before the low-level prompt, and nothing is added', async () => {
        h.confirm = true
        setUrl(moduleLink(JSON.stringify({ name: 'm', lowLevelAccess: true, [MODULE_STUB_KEY]: 7 })))
        await characterURLImport()
        expect(h.modules).toHaveLength(0)
        expect(h.prompts).toEqual([])
        expect(h.errors).toEqual([language.errors.noData])
        expect(h.errorKinds).toEqual(['string'])
        expect(h.events).not.toContain('normal:' + language.successImport)
    })

    test('R13 a low-level module link asks twice, the link prompt first and the low-level-access prompt second, and imports when both are accepted', async () => {
        h.confirm = true
        setUrl(moduleLink(JSON.stringify({ name: 'm', lowLevelAccess: true })))
        await characterURLImport()
        expect(h.prompts).toHaveLength(2)
        expect(h.prompts[0]).not.toContain(language.lowLevelAccessConfirm)
        expect(h.prompts[1]).toBe(language.lowLevelAccessConfirm)
        expect(h.prompts[0]).toBe(language.importModuleLinkConfirm)
        expect(h.modules).toHaveLength(1)
        expect(h.events).toContain('normal:' + language.successImport)
    })
})

// ---------------------------------------------------------------------------------------------
// Link confirmation: every link kind asks before anything is fetched, saved or marked busy
// ---------------------------------------------------------------------------------------------

describe('link confirmation', () => {
    const linkAsks = () => h.asks.filter((a) => !a.msg.includes(language.lowLevelAccessConfirm))
    const importPrompt = (host: string) => fillLang(language.importLinkConfirm, { host })
    const moduleLink = (body: string) => '/#import_module=' + encodeURIComponent(Buffer.from(body).toString('base64'))
    const presetLink = (body: string) => '/#import_preset=' + encodeURIComponent(Buffer.from(body).toString('base64'))
    const cardRoute = (url: string) => routes.set(url, () => new Response(v3Card('Linked'), { headers: { 'content-disposition': 'attachment; filename="c.json"' } }))
    const CHUB = 'https://api.chub.ai/api/characters/download'
    const chubRoute = () => routes.set(CHUB, () => new Response(new U8(pngCard('FromChub')), { headers: { 'content-type': 'image/png' } }))
    /** A followed redirect as a browser reports it: the final address in `url` and `redirected` set. */
    const redirected = (finalUrl: string, bytes: Uint8Array) => {
        const res = new Response(new U8(bytes), { headers: { 'content-disposition': 'attachment; filename="cool.charx"' } })
        Object.defineProperty(res, 'url', { configurable: true, value: finalUrl })
        Object.defineProperty(res, 'redirected', { configurable: true, value: true })
        return res
    }

    describe('#import=', () => {
        test('R1 a declined link fetches nothing, imports nothing, shows nothing, leaves nothing busy and is cleared without a new history entry', async () => {
            h.linkConfirm = false
            const bytes = await charxBytes('Declined')
            routes.set('https://files.test/dl', () => new Response(new U8(bytes), { headers: { 'content-disposition': 'attachment; filename="cool.charx"' } }))
            setUrl('/#import=https://files.test/dl')
            const history = window.history.length
            await characterURLImport()
            expect(fetchCalls).toEqual([])
            expect(h.characters).toEqual([])
            expect(window.history.length).toBe(history)
            expect(window.location.hash).toBe('')
            expect(h.errors).toEqual([])
            expect(h.last).toBe('none')
            expect(isBusy()).toBe(false)
            expect(linkAsks()).toHaveLength(1)
        })

        test('R1 a second run after a decline asks nothing', async () => {
            h.linkConfirm = false
            cardRoute('https://files.test/dl')
            setUrl('/#import=https://files.test/dl')
            await characterURLImport()
            const asked = h.asks.length
            await characterURLImport()
            expect(h.asks).toHaveLength(asked)
            expect(fetchCalls).toEqual([])
        })

        test('R2 an accepted link is asked once, before the entry is busy and before any fetch, and names the host', async () => {
            cardRoute('https://files.test/dl')
            setUrl('/#import=https://files.test/dl')
            await characterURLImport()
            expect(linkAsks()).toHaveLength(1)
            expect(linkAsks()[0].fetchCount).toBe(0)
            expect(linkAsks()[0].busy).toEqual([])
            expect(linkAsks()[0].msg).toContain('files.test')
            expect(charName(0)).toBe('Linked')
            expect(linkAsks()[0].msg).toBe(importPrompt('files.test'))
        })

        test('R3 an http link is refused with invalidUrl, with no prompt and no fetch', async () => {
            cardRoute('http://files.test/dl')
            setUrl('/#import=http://files.test/dl')
            await characterURLImport()
            expect(fetchCalls).toEqual([])
            expect(h.asks).toEqual([])
            expect(h.errors).toEqual([language.errors.invalidUrl])
            expect(window.location.hash).toBe('')
        })

        test.each([
            ['javascript:alert(1)'],
            ['data:text/plain,hi'],
            ['ftp://files.test/x'],
            ['/rel'],
            ['not a url'],
            ['https://'],
        ])('R4 the target %s is refused with invalidUrl, with no prompt and no fetch', async (target) => {
            setUrl('/#import=' + target)
            await characterURLImport()
            expect(fetchCalls).toEqual([])
            expect(h.asks).toEqual([])
            expect(h.errors).toEqual([language.errors.invalidUrl])
            expect(window.location.hash).toBe('')
        })

        test.each([
            ['R5a', 'https://trusted.com@files.test/dl'],
            ['R5b', 'https://:pw@files.test/dl'],
        ])('%s a target with userinfo is refused with invalidUrl, with no prompt and no fetch', async (_id, target) => {
            setUrl('/#import=' + target)
            await characterURLImport()
            expect(fetchCalls).toEqual([])
            expect(h.asks).toEqual([])
            expect(h.errors).toEqual([language.errors.invalidUrl])
            expect(window.location.hash).toBe('')
        })

        test('R6 an IDN host is shown in its punycode form and the parsed address is fetched', async () => {
            const raw = 'https://%D0%B0pple.com/c.json'
            const parsed = new URL(raw)
            cardRoute(parsed.href)
            setUrl('/#import=' + raw)
            await characterURLImport()
            expect(linkAsks()).toHaveLength(1)
            expect(linkAsks()[0].msg).toContain(parsed.host)
            expect(fetchCalls.map((c) => c.url)).toEqual([parsed.href])
            expect(charName(0)).toBe('Linked')
            expect(linkAsks()[0].msg).toBe(importPrompt(parsed.host))
        })

        test('R7 a port is part of the host that is shown', async () => {
            cardRoute('https://files.test:8443/dl')
            setUrl('/#import=https://files.test:8443/dl')
            await characterURLImport()
            expect(linkAsks()).toHaveLength(1)
            expect(linkAsks()[0].msg).toContain('files.test:8443')
            expect(linkAsks()[0].msg).toBe(importPrompt('files.test:8443'))
        })

        test('R8 an upper-case scheme and host are fetched in their parsed lower-case form', async () => {
            cardRoute('https://files.test/dl')
            setUrl('/#import=HTTPS://Files.Test/dl')
            await characterURLImport()
            expect(linkAsks()).toHaveLength(1)
            expect(fetchCalls.map((c) => c.url)).toEqual(['https://files.test/dl'])
            expect(charName(0)).toBe('Linked')
        })

        test.each([
            ['http://other.test/dl'],
            ['http://files.test/dl'],
        ])('R16 a redirect that ends on %s is refused with invalidUrl and its body is never read', async (finalUrl) => {
            const res = redirected(finalUrl, await charxBytes('Redirected'))
            const reads = watched(res)
            routes.set('https://files.test/dl', () => res)
            setUrl('/#import=https://files.test/dl')
            await characterURLImport()
            expect(reads).toEqual({ arrayBuffer: 0, blob: 0, other: 0 })
            expect(h.characters).toEqual([])
            expect(h.errors).toEqual([language.errors.invalidUrl])
            expect(isBusy()).toBe(false)
        })

        test('G9 a redirect to another https host is followed and imports (compatibility guard: passes before and after)', async () => {
            const res = redirected('https://cdn.test/dl', await charxBytes('Cdn'))
            routes.set('https://files.test/dl', () => res)
            setUrl('/#import=https://files.test/dl')
            await characterURLImport()
            expect(h.errors).toEqual([])
            expect(charName(0)).toBe('Cdn')
        })
    })

    describe('?charahub=', () => {
        test('R9 a declined link posts nothing, shows no wait notice and imports nothing', async () => {
            h.linkConfirm = false
            chubRoute()
            setUrl('/?charahub=someone/card')
            await characterURLImport()
            expect(fetchCalls).toEqual([])
            expect(h.characters).toEqual([])
            expect(h.last).toBe('none')
            expect(isBusy()).toBe(false)
            expect(window.location.search).toBe('')
        })

        test('R10 an accepted link names api.chub.ai, asks before the wait notice and before any busy entry, then imports', async () => {
            chubRoute()
            setUrl('/?charahub=someone/card')
            await characterURLImport()
            expect(linkAsks()).toHaveLength(1)
            expect(linkAsks()[0].fetchCount).toBe(0)
            expect(linkAsks()[0].busy).toEqual([])
            expect(linkAsks()[0].last.startsWith('wait:')).toBe(false)
            expect(linkAsks()[0].msg).toContain('api.chub.ai')
            expect(charName(0)).toBe('FromChub')
            expect(linkAsks()[0].msg).toBe(importPrompt('api.chub.ai'))
        })

        test('R11 a declined link clears only its own query key and adds no history entry', async () => {
            h.linkConfirm = false
            chubRoute()
            setUrl('/?mainpage=1&charahub=a/b')
            const history = window.history.length
            await characterURLImport()
            expect(fetchCalls).toEqual([])
            expect(window.history.length).toBe(history)
            expect(window.location.search).toBe('?mainpage=1')
        })
    })

    describe('#import_module=', () => {
        test('R12 a declined link adds no module and shows no success text', async () => {
            h.linkConfirm = false
            setUrl(moduleLink(JSON.stringify({ name: 'm' })))
            await characterURLImport()
            expect(h.modules).toEqual([])
            expect(h.events).not.toContain('normal:' + language.successImport)
            expect(h.last).toBe('none')
            expect(window.location.hash).toBe('')
        })

        test('R12 an accepted link is asked once with the module wording and imports', async () => {
            setUrl(moduleLink(JSON.stringify({ name: 'm' })))
            await characterURLImport()
            expect(linkAsks()).toHaveLength(1)
            expect(h.modules).toHaveLength(1)
            expect(linkAsks()[0].msg).toBe(language.importModuleLinkConfirm)
        })

        test('R13 a declined link prompt of a low-level module asks nothing further and adds no module', async () => {
            h.linkConfirm = false
            setUrl(moduleLink(JSON.stringify({ name: 'm', lowLevelAccess: true })))
            await characterURLImport()
            expect(h.prompts).toHaveLength(1)
            expect(h.modules).toEqual([])
        })

        test('G2 malformed module data is refused with no prompt', async () => {
            setUrl(moduleLink('not json'))
            await characterURLImport()
            expect(h.asks).toEqual([])
            expect(h.errors).toHaveLength(1)
        })
    })

    describe('#import_preset=', () => {
        test('R14 a declined link imports nothing and leaves nothing busy', async () => {
            h.linkConfirm = false
            setUrl(presetLink('{"name":"p"}'))
            await characterURLImport()
            expect(h.presets).toEqual([])
            expect(linkAsks()).toHaveLength(1)
            expect(linkAsks()[0].busy).toEqual([])
            expect(isBusy()).toBe(false)
            expect(h.last).toBe('none')
            expect(window.location.hash).toBe('')
        })

        test('R14 an accepted link is asked once, before the entry is busy, with the preset wording, and imports', async () => {
            setUrl(presetLink('{"name":"p"}'))
            await characterURLImport()
            expect(linkAsks()).toHaveLength(1)
            expect(linkAsks()[0].busy).toEqual([])
            expect(h.presets.map((p) => p.name)).toEqual(['imported.risupreset'])
            expect(linkAsks()[0].msg).toBe(language.importPresetLinkConfirm)
        })

        test('G10 undecodable preset data shows its error with no prompt and the consumer is still registered (compatibility guard: passes before and after)', async () => {
            const setConsumer = vi.fn()
            ;(window as unknown as { launchQueue: unknown }).launchQueue = { setConsumer }
            setUrl('/#import_preset=%E0%A4%A')
            await characterURLImport()
            expect(h.asks).toEqual([])
            expect(h.errors).toHaveLength(1)
            expect(setConsumer).toHaveBeenCalledTimes(1)
        })
    })

    describe('start-up work after a declined link', () => {
        test.each([
            ['#import=', () => { cardRoute('https://files.test/dl'); return '/#import=https://files.test/dl' }],
            ['?charahub=', () => { chubRoute(); return '/?charahub=someone/card' }],
            ['#import_module=', () => moduleLink(JSON.stringify({ name: 'm' }))],
            ['#import_preset=', () => presetLink('{"name":"p"}')],
        ] as Array<[string, () => string]>)('G4 a declined %s link still registers the file-handler consumer (compatibility guard: passes before and after)', async (_kind, link) => {
            h.linkConfirm = false
            const setConsumer = vi.fn()
            ;(window as unknown as { launchQueue: unknown }).launchQueue = { setConsumer }
            setUrl(link())
            await characterURLImport()
            expect(setConsumer).toHaveBeenCalledTimes(1)
        })
    })
})

describe('imports are registered as busy while they run', () => {
    test('a file handed over by the file handler is registered while it is read and imported, and the entry ends after', async () => {
        let during: string[] = []
        let consumer: ((params: LaunchParams) => Promise<void>) | null = null
        ;(window as unknown as { launchQueue: unknown }).launchQueue = { setConsumer: (fn: (params: LaunchParams) => Promise<void>) => { consumer = fn } }
        await characterURLImport()
        const file = new File([new U8(await charxBytes('Queued'))], 'q.charx', { type: 'application/octet-stream' })

        await consumer!({ files: [{ name: 'q.charx', getFile: async () => { during = busyKinds(); return file } }] })

        expect(during).toEqual(['import'])
        expect(isBusy()).toBe(false)
    })

    test('an import that fails still ends its entry', async () => {
        let consumer: ((params: LaunchParams) => Promise<void>) | null = null
        ;(window as unknown as { launchQueue: unknown }).launchQueue = { setConsumer: (fn: (params: LaunchParams) => Promise<void>) => { consumer = fn } }
        await characterURLImport()

        await consumer!({ files: [{ name: 'broken.charx', getFile: async () => { throw new Error('read failed') } }] })

        expect(isBusy()).toBe(false)
    })

    test('a #import= download is registered from its fetch onward and the entry ends after', async () => {
        let during: string[] = []
        routes.set('https://files.test/dl', () => {
            during = busyKinds()
            return new Response(JSON.stringify({ name: 'FromLink' }), { headers: { 'content-disposition': 'attachment; filename="c.json"' } })
        })
        setUrl('/#import=https://files.test/dl')

        await characterURLImport()

        expect(during).toEqual(['import'])
        expect(isBusy()).toBe(false)
    })
})

describe('a reload that keeps the fragment of an inline link', () => {
    test('a #import_module= link imports once and a second run with the same fragment imports nothing', async () => {
        setUrl('/#import_module=' + encodeURIComponent(Buffer.from(JSON.stringify({ name: 'once' })).toString('base64')))
        await characterURLImport()
        expect(h.modules).toHaveLength(1)
        const hashAfterFirstRun = window.location.hash

        await characterURLImport()
        expect(h.modules).toHaveLength(1)
        expect(hashAfterFirstRun).toBe('')
    })

    test('a #import_preset= link imports once and a second run with the same fragment imports nothing', async () => {
        setUrl('/#import_preset=' + encodeURIComponent(Buffer.from('{"name":"once"}').toString('base64')))
        await characterURLImport()
        expect(h.presets).toHaveLength(1)
        const hashAfterFirstRun = window.location.hash

        await characterURLImport()
        expect(h.presets).toHaveLength(1)
        expect(hashAfterFirstRun).toBe('')
    })

    test('a link that fails to import is also cleared from the URL', async () => {
        setUrl('/#import_module=' + encodeURIComponent(Buffer.from('not json').toString('base64')))
        await characterURLImport()
        expect(window.location.hash).toBe('')
    })

    test('the query string stays when the fragment is cleared', async () => {
        setUrl('/?mainpage=1#import_preset=' + encodeURIComponent(Buffer.from('{"name":"q"}').toString('base64')))
        await characterURLImport()
        expect(window.location.search).toBe('?mainpage=1')
        expect(window.location.hash).toBe('')
    })
})

describe('download links that fail', () => {
    test.each([
        ['a #import= link answered with a non-ok status', () => { routes.set('https://files.test/dl', () => new Response('gone', { status: 404 })); return '/#import=https://files.test/dl' }],
        ['a ?charahub= download answered with a non-ok status', () => { routes.set('https://api.chub.ai/api/characters/download', () => new Response('gone', { status: 404 })); return '/?charahub=someone/card' }],
    ] as Array<[string, () => string]>)('%s shows noData and the file-handler consumer is still registered', async (_label, link) => {
        const setConsumer = vi.fn()
        ;(window as unknown as { launchQueue: unknown }).launchQueue = { setConsumer }
        setUrl(link())
        await characterURLImport()
        expect(h.last).toBe('error:' + language.errors.noData)
        expect(setConsumer).toHaveBeenCalledTimes(1)
    })
})

// ---------------------------------------------------------------------------------------------
// The low-level-access prompt of a .risum module on the paths that reach importClassified
// ---------------------------------------------------------------------------------------------

describe('a .risum module and the low-level-access prompt', () => {
    const paths: Array<[string, () => Promise<void>]> = [
        ['open-with', async () => {
            h.tauriFiles = { '/docs/m.risum': new U8([8]) }
            await importOpenedFiles(['/docs/m.risum'])
        }],
        ['#import= link', async () => {
            routes.set('https://files.test/m.risum', () => new Response(new U8([4, 5]), { headers: { 'content-disposition': 'attachment; filename="m.risum"' } }))
            setUrl('/#import=https://files.test/m.risum')
            await characterURLImport()
        }],
        ['launchQueue consumer', async () => {
            let consumer: ((params: LaunchParams) => Promise<void>) | null = null
            ;(window as unknown as { launchQueue: unknown }).launchQueue = { setConsumer: (fn: (params: LaunchParams) => Promise<void>) => { consumer = fn } }
            await characterURLImport()
            await consumer!({ files: [{ name: 'm.risum', getFile: async () => new File([new U8([8])], 'm.risum') }] })
            await new Promise((resolve) => setTimeout(resolve, 50))
        }],
    ]

    test.each(paths)('%s: a declined prompt saves nothing, adds no module, and shows neither a success text nor an error (feature test)', async (_label, run) => {
        h.moduleLowLevel = true
        h.confirm = false
        await run()
        expect(h.moduleSaved).toBe(0)
        expect(h.modules).toEqual([])
        expect(h.events.filter((e) => e.startsWith('normal:') || e.startsWith('error:'))).toEqual([])
        expect(h.last).toBe('none')
    })

    test.each(paths)('%s: a confirmed prompt imports the module and reports success (compatibility guard: passes before and after)', async (_label, run) => {
        h.moduleLowLevel = true
        h.confirm = true
        await run()
        expect(h.moduleSaved).toBe(1)
        expect(h.modules).toHaveLength(1)
        expect(h.events).toContain('normal:' + language.successImport)
    })
})

// ---------------------------------------------------------------------------------------------
// The charx low-level-access prompt label, and a module embedded in a charx
// ---------------------------------------------------------------------------------------------

describe('the charx low-level-access prompt label (feature tests)', () => {
    async function lowLevelCharx(name: string, embeddedModule?: Uint8Array): Promise<File> {
        const card = JSON.parse(v3Card(name))
        card.data.extensions.risuai.lowLevelAccess = true
        const entries: ZipEntry[] = [['card.json', enc.encode(JSON.stringify(card)), 6]]
        if (embeddedModule) entries.push(['module.risum', embeddedModule, 6])
        return new File([new U8(fflateZipArchive(entries))], 'card.charx', { type: 'application/zip' })
    }

    test('guard: without a label the prompt is the plain question (passes before and after the label existed)', async () => {
        const file = await lowLevelCharx('Risky')
        expect((await importCharacterFile({ name: file.name, data: file })).kind).toBe('imported')
        expect(h.prompts).toEqual([language.lowLevelAccessConfirm])
    })

    test('a text label is the first line of the prompt', async () => {
        const file = await lowLevelCharx('Risky')
        await importCharacterFile({ name: file.name, data: file, lowLevelLabel: 'Label line' })
        expect(h.prompts).toEqual([`Label line\n${language.lowLevelAccessConfirm}`])
    })

    test('a label function is given the card name that only the parsed card knows', async () => {
        const file = await lowLevelCharx('Risky')
        await importCharacterFile({ name: file.name, data: file, lowLevelLabel: (cardName) => language.moduleLowLevelNamed(cardName, 'card.charx') })
        expect(h.prompts).toEqual([`${language.moduleLowLevelNamed('Risky', 'card.charx')}\n${language.lowLevelAccessConfirm}`])
    })

    test('a declined labelled prompt ends as declined and adds no character', async () => {
        h.confirm = false
        const file = await lowLevelCharx('Risky')
        expect(await importCharacterFile({ name: file.name, data: file, lowLevelLabel: 'Label line' })).toEqual({ kind: 'declined' })
        expect(h.characters).toEqual([])
    })

    test('a card that does not ask is not asked, label or not', async () => {
        const file = new File([new U8(await charxBytes('Plain'))], 'card.charx', { type: 'application/zip' })
        await importCharacterFile({ name: file.name, data: file, lowLevelLabel: 'Label line' })
        expect(h.prompts).toEqual([])
    })

    test('guard: a module embedded in the charx is read without a hook, so it never asks the prompt', async () => {
        const { readModule } = await import('src/ts/process/modules')
        vi.mocked(readModule).mockClear()
        const file = await lowLevelCharx('Risky', new U8([111, 0]))
        h.confirm = true
        await importCharacterFile({ name: file.name, data: file, lowLevelLabel: 'Label line' })
        expect(vi.mocked(readModule)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(readModule).mock.calls[0][1]).toBeUndefined()
        expect(h.prompts).toEqual([`Label line\n${language.lowLevelAccessConfirm}`])
    })
})
