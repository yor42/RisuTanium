// @vitest-environment happy-dom

/**
 * `characterURLImport` in `src/ts/characterCards.ts`: the PWA share hash, `#import=` links, Chub downloads and the
 * file-handler queue.
 *
 * The real `characterCards.ts`, `processzip.ts` and `pngChunk.ts` run against synthetic cards. The database, asset
 * storage and alerts are replaced by recorders, and `fetch` is a fake that plays the service worker's share routes
 * (claim by DELETE of the index, GET of a stored file, DELETE of the share) and the external download URLs. Outcomes
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
    ordered: 0,
    uuid: 0,
    /** what the single alert slot holds: every alert function replaces it */
    last: 'none',
    /** the answer of the low-level-access prompt */
    confirm: true,
    /** makes importPreset throw this message */
    presetFails: null as string | null,
    isTauri: false,
    /** what readFile answers per path; an Error is thrown */
    tauriFiles: {} as Record<string, Uint8Array | Error>,
    deepLinkRegistered: 0,
}))

vi.mock('uuid', () => ({
    v4: () => `uuid-${++h.uuid}`,
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
        alertConfirm: vi.fn(async () => { h.last = 'ask'; const answer = h.confirm; h.last = 'none'; return answer }),
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
    readModule: vi.fn(async (data: Uint8Array) => {
        h.moduleReads.push(data)
        h.events.push('module')
        if (h.moduleFails) throw new ModuleRefusal(h.moduleFails)
        return { name: 'synthetic module', lorebook: [], trigger: [], regex: [] }
    }),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: vi.fn(async (path: string) => {
        const answer = h.tauriFiles[path] ?? new Uint8Array()
        if (answer instanceof Error) throw answer
        return answer
    }),
}))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => { h.deepLinkRegistered++; return vi.fn() }),
}))

//#endregion

import { characterURLImport } from 'src/ts/characterCards'
import { CharXImporter, CharXWriter } from 'src/ts/process/processzip'
import { PngChunk } from 'src/ts/pngChunk'
import { ModuleRefusal } from 'src/ts/process/moduleRefusal'
import type { VirtualWriter } from 'src/ts/globalApi.svelte'
import { language } from 'src/lang'

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
    const chunks: Uint8Array[] = []
    const sink = { write: async (b: Uint8Array) => { chunks.push(new U8(b)) }, close: async () => {} }
    const writer = new CharXWriter(sink as unknown as VirtualWriter)
    await writer.write('card.json', v3Card(name), 6)
    await writer.end()
    return concat(chunks)
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
// Fake network: the service worker's share routes plus external download URLs
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
    h.ordered = 0
    h.uuid = 0
    h.last = 'none'
    h.confirm = true
    h.presetFails = null
    h.isTauri = false
    h.tauriFiles = {}
    h.deepLinkRegistered = 0
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
    vi.spyOn(PngChunk, 'scanCard').mockImplementation((data: ScanArg) => {
        scanArgs.push(data)
        h.events.push('scan:' + (data instanceof File ? data.name : 'bytes'))
        return realScan.call(PngChunk, data)
    })
    vi.stubGlobal('fetch', fakeFetch)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.stubGlobal('fetch', originalFetch)
    vi.restoreAllMocks()
    delete (window as unknown as { launchQueue?: unknown }).launchQueue
    delete (window as unknown as { tauriOpenedFiles?: unknown }).tauriOpenedFiles
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
// The share hash
// ---------------------------------------------------------------------------------------------

describe('#share= hash', () => {
    const shared = async () => ({
        charx: { name: 'a.charx', type: 'application/octet-stream', bytes: await charxBytes('SharedCharx') },
        png: { name: 'b.png', type: 'image/png', bytes: pngCard('SharedPng') },
        risup: { name: 'c.risup', type: '', bytes: new U8([7, 7]) },
        risum: { name: 'd.risum', type: 'application/octet-stream', bytes: new U8([8, 8]) },
    })

    test('each file is imported through the route of its kind in the order shared, cards as Files, the hash is cleared and the share is deleted after the imports', async () => {
        const s = await shared()
        const id = seedShare([s.charx, s.png, s.risup, s.risum])
        setUrl('/#share=' + id)
        await characterURLImport()
        expect(h.events.filter((e) => !e.startsWith('normal:') && e !== 'order')).toEqual(['parse:a.charx', 'scan:b.png', 'preset:c.risup', 'module', 'delete'])
        expect(parseArgs[0]).toBeInstanceOf(File)
        expect(scanArgs[0]).toBeInstanceOf(File)
        expect(h.errors).toEqual([])
        expect(charName(0)).toBe('SharedCharx')
        expect(charName(1)).toBe('SharedPng')
        expect(h.presets[0].data).toBeInstanceOf(Uint8Array)
        expect(h.moduleReads).toHaveLength(1)
        expect(h.ordered).toBeGreaterThanOrEqual(2)
        expect(window.location.hash).toBe('')
        expect(shares.has(id)).toBe(false)
    })

    test('the same hash used a second time imports nothing and says the share was not found', async () => {
        const s = await shared()
        const id = seedShare([s.charx])
        setUrl('/#share=' + id)
        await characterURLImport()
        expect(h.characters).toHaveLength(1)
        h.events = []
        h.errors = []
        setUrl('/#share=' + id)
        await characterURLImport()
        expect(h.characters).toHaveLength(1)
        expect(parseArgs).toHaveLength(1)
        expect(h.errors).toEqual([language.shareNotFound])
    })

    test('a file is sorted by its name suffix whatever its type, a bare image type is accepted, and files that cannot be used are named', async () => {
        const id = seedShare([
            { name: 'photo', type: 'image/png', bytes: pngCard('NoSuffix') },
            { name: 'Card.PNG', type: 'application/octet-stream', bytes: pngCard('UpperCase') },
            { name: 'x.preset', type: 'application/zip', bytes: enc.encode('{"name":"p"}') },
            { name: 'y.json', type: 'application/octet-stream', bytes: enc.encode(v3Card('FromJson')) },
            { name: 'notes.bin', type: 'application/octet-stream', bytes: new U8([1]) },
            { name: 'mystery', type: '', bytes: new U8([2]) },
        ])
        setUrl('/#share=' + id)
        await characterURLImport()
        expect(h.characters.map((c) => (c as { name?: string }).name)).toEqual(['NoSuffix', 'UpperCase', 'FromJson'])
        expect(scanArgs.map((a) => (a as File).name)).toEqual(['photo.png', 'Card.png'])
        expect(h.presets.map((p) => p.name)).toEqual(['x.preset'])
        expect(h.errors).toHaveLength(1)
        expect(h.errors[0]).toContain('notes.bin')
        expect(h.errors[0]).toContain('mystery')
        expect(shares.has(id)).toBe(false)
    })

    test('a file that fails to import reports its own failure and does not stop the files after it', async () => {
        const id = seedShare([
            { name: 'broken.charx', type: '', bytes: new U8(10).fill(7) },
            { name: 'ok.png', type: 'image/png', bytes: pngCard('Survivor') },
        ])
        setUrl('/#share=' + id)
        await characterURLImport()
        expect(charName(0)).toBe('Survivor')
        expect(h.last).toBe('error:' + language.importFilesNotImported(1, 2, 'broken.charx: ' + language.cardFileIncomplete))
        expect(shares.has(id)).toBe(false)
    })

    test('a module that readModule refuses adds nothing and is named among the files not imported, while the files after it import', async () => {
        h.moduleFails = language.errors.noData
        const id = seedShare([
            { name: 'bad.risum', type: '', bytes: new U8([8, 8]) },
            { name: 'ok.png', type: 'image/png', bytes: pngCard('Survivor') },
        ])
        setUrl('/#share=' + id)
        await characterURLImport()
        expect(h.modules).toEqual([])
        expect(charName(0)).toBe('Survivor')
        expect(h.last).toBe('error:' + language.importFilesNotImported(1, 2, 'bad.risum: ' + language.errors.noData))
        expect(shares.has(id)).toBe(false)
    })

    test('a refused card, a good card and an unrecognised file: the good card imports and the last message names the others with their reasons', async () => {
        const id = seedShare([
            { name: 'broken.charx', type: '', bytes: new U8(10).fill(7) },
            { name: 'ok.png', type: 'image/png', bytes: pngCard('Survivor') },
            { name: 'notes.bin', type: 'application/octet-stream', bytes: new U8([1]) },
        ])
        setUrl('/#share=' + id)
        await characterURLImport()
        expect(charName(0)).toBe('Survivor')
        expect(h.characters).toHaveLength(1)
        expect(h.last).toBe('error:Files not imported (2 of 3):\n'
            + 'broken.charx: ' + language.cardFileIncomplete + '\n'
            + 'notes.bin: ' + language.importUnsupportedFile)
        expect(shares.has(id)).toBe(false)
    })

    test('a file that cannot be received is named with its reason and the files after it import', async () => {
        //The index lists a file the share does not hold, so its fetch answers 404.
        const id = seedShare([
            { name: 'ok.png', type: 'image/png', bytes: pngCard('Survivor') },
        ], SHARE_ID, () => new Response(JSON.stringify({ files: [
            { key: `/sw/share/${SHARE_ID}/7`, name: 'gone.png', type: 'image/png' },
            { key: `/sw/share/${SHARE_ID}/0`, name: 'ok.png', type: 'image/png' },
        ] })))
        setUrl('/#share=' + id)
        await characterURLImport()
        expect(h.characters.map((c) => (c as { name?: string }).name)).toEqual(['Survivor'])
        expect(h.last).toBe('error:' + language.importFilesNotImported(1, 2, 'gone.png: ' + language.importFileNotReceived))
    })

    test('a single refused card shows its own message, not a summary (guard)', async () => {
        const id = seedShare([{ name: 'broken.charx', type: '', bytes: new U8(10).fill(7) }])
        setUrl('/#share=' + id)
        await characterURLImport()
        expect(h.last).toBe('error:' + language.cardFileIncomplete)
    })

    test('a single unrecognised file has no message of its own and gets the summary', async () => {
        const id = seedShare([{ name: 'notes.bin', type: 'application/octet-stream', bytes: new U8([1]) }])
        setUrl('/#share=' + id)
        await characterURLImport()
        expect(h.last).toBe('error:' + language.importFilesNotImported(1, 1, 'notes.bin: ' + language.importUnsupportedFile))
    })

    test('a share of imported files shows no error and ends on the last file\'s own message (guard)', async () => {
        const id = seedShare([
            { name: 'a.png', type: 'image/png', bytes: pngCard('A') },
            { name: 'b.png', type: 'image/png', bytes: pngCard('B') },
        ])
        setUrl('/#share=' + id)
        await characterURLImport()
        expect(h.errors).toEqual([])
        expect(h.characters).toHaveLength(2)
        expect(h.last).toBe('normal:' + language.importedCharacter)
    })

    const noImport = () => {
        expect(h.characters).toEqual([])
        expect(h.presets).toEqual([])
        expect(h.moduleReads).toEqual([])
        expect(parseArgs).toEqual([])
        expect(scanArgs).toEqual([])
    }

    test('the empty hash shows one message and imports nothing', async () => {
        setUrl('/#share-empty')
        await characterURLImport()
        expect(h.errors).toEqual([language.shareEmpty])
        expect(window.location.hash).toBe('')
        noImport()
    })

    test('the failure hash shows one message and imports nothing', async () => {
        setUrl('/#share-failed')
        await characterURLImport()
        expect(h.errors).toEqual([language.shareFailed])
        expect(window.location.hash).toBe('')
        noImport()
    })

    test('an unknown id shows one message and imports nothing', async () => {
        setUrl('/#share=1760000000000-ffffffff-0000-4000-8000-000000000009')
        await characterURLImport()
        expect(h.errors).toEqual([language.shareNotFound])
        noImport()
    })

    test('an already claimed id shows one message and imports nothing', async () => {
        const id = seedShare([{ name: 'a.charx', type: '', bytes: await charxBytes('Gone') }])
        shares.get(id)!.claimed = true
        setUrl('/#share=' + id)
        await characterURLImport()
        expect(h.errors).toEqual([language.shareNotFound])
        noImport()
    })

    test.each([
        ['an HTML page', () => new Response('<!doctype html><title>app</title>', { status: 200, headers: { 'content-type': 'text/html' } })],
        ['JSON of the wrong shape', () => new Response(JSON.stringify({ files: 'nope' }), { status: 200 })],
        ['an index whose key climbs out of its share with ..', () => new Response(JSON.stringify({ files: [{ key: `/sw/share/${SHARE_ID}/../x`, name: 'a.charx', type: '' }] }), { status: 200 })],
        ['an index pointing outside its own share', () => new Response(JSON.stringify({ files: [{ key: 'https://evil.test/x', name: 'a.charx', type: '' }] }), { status: 200 })],
    ])('an index that is %s shows one message and imports nothing', async (_label, answer) => {
        const id = seedShare([], SHARE_ID, answer)
        setUrl('/#share=' + id)
        await characterURLImport()
        expect(h.errors).toEqual([language.shareInvalid])
        expect(fetchCalls.some((c) => c.url.startsWith('https://evil.test') || c.url.includes('..'))).toBe(false)
        noImport()
    })

    test('an older-style share hash is not treated as a share', async () => {
        setUrl('/#share_character')
        await characterURLImport()
        expect(fetchCalls).toEqual([])
        expect(h.errors).toEqual([])
    })
})

// ---------------------------------------------------------------------------------------------
// The file-handler queue and share failures
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

    test('a share step that fails still leaves the file-handler consumer registered (compatibility guard)', async () => {
        const setConsumer = vi.fn()
        ;(window as unknown as { launchQueue: unknown }).launchQueue = { setConsumer }
        vi.stubGlobal('fetch', async () => { throw new TypeError('network error') })
        setUrl('/#share=' + SHARE_ID)
        await characterURLImport()
        expect(setConsumer).toHaveBeenCalledTimes(1)
    })
})

// ---------------------------------------------------------------------------------------------
// Files opened through Tauri, and the links that import a module or a preset inline
// ---------------------------------------------------------------------------------------------

describe('tauriOpenedFiles', () => {
    test('a file that cannot be read does not stop the files after it, the start-up work continues, and what did not import is named once at the end', async () => {
        h.isTauri = true
        h.moduleFails = language.errors.noData
        const good = await charxBytes('Opened')
        h.tauriFiles = {
            'C:\\docs\\broken.charx': new Error('read denied'),
            'C:\\docs\\ok.charx': good,
            'C:\\docs\\bad.risum': new U8([8]),
        }
        ;(window as unknown as { tauriOpenedFiles: string[] }).tauriOpenedFiles = ['C:\\docs\\broken.charx', 'C:\\docs\\ok.charx', 'C:\\docs\\bad.risum']
        await characterURLImport()
        expect(charName(0)).toBe('Opened')
        expect(h.characters).toHaveLength(1)
        expect(h.modules).toEqual([])
        expect(h.last).toBe('error:' + language.importFilesNotImported(2, 3, 'broken.charx: read denied\nbad.risum: ' + language.errors.noData))
        expect(h.deepLinkRegistered).toBe(1)
    })

    test('files that all import show no error and the deep-link handler is registered (guard)', async () => {
        h.isTauri = true
        h.tauriFiles = { '/docs/a.charx': await charxBytes('A'), '/docs/b.charx': await charxBytes('B') }
        ;(window as unknown as { tauriOpenedFiles: string[] }).tauriOpenedFiles = ['/docs/a.charx', '/docs/b.charx']
        await characterURLImport()
        expect(h.characters).toHaveLength(2)
        expect(h.errors).toEqual([])
        expect(h.deepLinkRegistered).toBe(1)
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
