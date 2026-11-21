// @vitest-environment happy-dom

/**
 * Downloaded character imports on the task card: Realm (`downloadRisuHub`), the Chub link and the `#import=` link in
 * `src/ts/characterCards.ts`. What the Download step shows while the body streams in, that Cancel aborts the request, and
 * that the caller's busy scope ends when the result card posts.
 *
 * The real `characterCards.ts`, `importBatch.ts`, `importProgress.ts`, `alertTask.svelte.ts`, `busyActions.ts`,
 * `processzip.ts` and `pngChunk.ts` run on synthetic cards. `fetch` is a stub that answers synthetic `Response` objects
 * with a streamed body and never reaches a host; asset storage, alerts and the database are recorders.
 *
 * Labels: (RR) regression reproducer, (RR-m) new behaviour pinned by mutants.
 */
import { createHash } from 'node:crypto'
import crc32 from 'crc/crc32'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    saved: [] as Array<{ id: string, length: number }>,
    errors: [] as string[],
    /** Every legacy `wait` or `progress` alert posted. A tasked flow posts none. */
    legacy: [] as string[],
    prompts: [] as string[],
    characters: [] as Array<Record<string, unknown>>,
    uuid: 0,
    confirm: true,
    onSave: null as null | (() => void),
}))

vi.mock('uuid', () => ({ v4: () => `uuid-${++h.uuid}` }))

vi.mock('@tauri-apps/plugin-os', () => ({
    type: () => { throw new Error('no operating-system plugin') },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/upstreamAgreement'), () => ({
    askUpstreamAgreement: vi.fn(async () => true),
    isUpstreamAccepted: vi.fn(() => true),
    publishUpstreamAccepted: vi.fn(),
}) as unknown as typeof import('src/ts/upstreamAgreement'))

vi.mock(import('src/ts/alert'), () => ({
    alertCardExport: vi.fn(),
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async (msg?: string) => { h.prompts.push(String(msg)); return h.confirm }),
    alertError: vi.fn((msg: string | Error) => { h.errors.push(msg instanceof Error ? msg.message : String(msg)) }),
    alertInput: vi.fn(async () => ''),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertStore: { set: (v: { type?: string }) => { if (v.type === 'wait' || v.type === 'progress') h.legacy.push(String(v.type)) }, subscribe: vi.fn(), update: vi.fn() },
    alertWait: vi.fn(() => { h.legacy.push('wait') }),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    defaultSdDataFunc: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    importPreset: vi.fn(),
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
        checkCharOrder: vi.fn(),
        downloadFile: vi.fn(async () => {}),
        forageStorage: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
        loadAsset: vi.fn(async () => new Uint8Array()),
        openURL: vi.fn(),
        readImage: vi.fn(async (d: unknown) => d),
        saveAsset: vi.fn(async (data: Uint8Array) => {
            h.onSave?.()
            const id = createHash('sha1').update(data).digest('hex')
            h.saved.push({ id, length: data.length })
            return id
        }),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'png'),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { characters: h.characters, modules: [] } } },
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
    readModule: vi.fn(),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn(async () => new Uint8Array()) }))
vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl: vi.fn(async () => vi.fn()) }))

import { characterURLImport, downloadRisuHub } from 'src/ts/characterCards'
import { answerTask, requestTaskCancel, resetTaskHostForTests, setTaskClockForTests, taskHostView, taskResultShowing } from 'src/ts/alertTask.svelte'
import { taskDeterminate, type TaskClock } from 'src/lib/Nexus/pattern/taskProgress'
import { answerImportCard } from 'src/ts/process/tests/answerImportCard'
import { fflateZipArchive } from 'src/ts/process/tests/zipFixtures'
import { busyKinds, resetBusyActionsForTest, type BusyKind } from 'src/ts/process/memory/busyActions'
import { language } from 'src/lang'

const U8 = Uint8Array
const SIG = new U8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const utf8 = (s: string) => new TextEncoder().encode(s)

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

const text = (key: string, value: string) => chunk('tEXt', concat([utf8(key), new U8([0]), utf8(value)]))
const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64')
const assetValue = (index: number, size: number) => Buffer.from(new U8(size).map((_, i) => (i * 31 + index * 17 + 5) & 0xff)).toString('base64')

const ASSET_SIZES = [300, 1500, 40_000]

//The exporter's chunk order: image header and data, the assets, the card chunk, the end.
function exportOrderPng(): Uint8Array {
    const v2 = JSON.stringify({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name: 'Synthetic', description: 'd', first_mes: 'hi', character_version: '1',
            extensions: { risuai: { additionalAssets: ASSET_SIZES.map((_, i) => [`a${i}`, `__asset:${i}`, 'bin']) } },
        },
    })
    return concat([
        SIG,
        chunk('IHDR', new U8(13).fill(1)), chunk('IDAT', new U8(40).fill(7)),
        ...ASSET_SIZES.map((s, i) => text(`chara-ext-asset_:${i}`, assetValue(i, s))),
        text('chara', b64(v2)),
        chunk('IEND', new U8(0)),
    ])
}

//A v3 card whose extension asks for low-level access, packed as the exporter's charx.
function charxWithLowLevel(): Uint8Array {
    const card = JSON.stringify({
        spec: 'chara_card_v3',
        spec_version: '3.0',
        data: { name: 'Linked', description: 'd', first_mes: 'hi', character_version: '1', extensions: { risuai: { lowLevelAccess: true } }, assets: [] },
    })
    return fflateZipArchive([['card.json', utf8(card), 6]])
}

type StreamOptions = {
    headers?: Record<string, string>
    pieceBytes?: number
    /** Called before each piece (and the close) is handed out, so the test observes the card while the body streams. */
    beforePiece?: (index: number) => void
}

//A synthetic download: the body arrives in pieces, each one a macrotask apart, so every earlier piece has been counted when the next is requested.
function streamedResponse(bytes: Uint8Array, opts: StreamOptions = {}): Response {
    const piece = opts.pieceBytes ?? 4000
    let at = 0
    let index = 0
    const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
            await new Promise((resolve) => setTimeout(resolve, 0))
            opts.beforePiece?.(index++)
            if (at >= bytes.length) {
                controller.close()
                return
            }
            controller.enqueue(bytes.slice(at, at + piece))
            at += piece
        },
    })
    return new Response(body, { status: 200, headers: opts.headers })
}

type Call = { url: string, signal: AbortSignal | null | undefined }
let calls: Call[] = []
let answer: (url: string) => Response = () => { throw new TypeError('no route') }

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = String(input)
    calls.push({ url, signal: init?.signal })
    return answer(url)
}

type Seen = { label: string | undefined, title: string, bytes: { done: number, total: number } | undefined, fraction: number, determinate: boolean }

function seenNow(): Seen | null {
    const view = taskHostView()
    if (!view) return null
    return {
        label: view.steps[view.stepIndex]?.label,
        title: view.title,
        bytes: view.bytes,
        fraction: view.fraction,
        determinate: taskDeterminate(view),
    }
}

const setUrl = (pathAndQuery: string) => window.history.replaceState(null, '', pathAndQuery)

async function untilResult(): Promise<void> {
    for (const deadline = performance.now() + 10_000; !taskResultShowing() && performance.now() < deadline;) {
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
}

const originalFetch = globalThis.fetch

beforeEach(() => {
    h.saved = []
    h.errors = []
    h.legacy = []
    h.prompts = []
    h.characters = []
    h.uuid = 0
    h.confirm = true
    h.onSave = null
    calls = []
    answer = () => { throw new TypeError('no route') }
    resetBusyActionsForTest()
    setUrl('/')
    let now = 0
    const clock: TaskClock = {
        now: () => (now += 1000),
        setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
        clearTimeout: () => {},
        hidden: () => false,
    }
    setTaskClockForTests(clock)
    vi.stubGlobal('fetch', fakeFetch)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
    resetTaskHostForTests()
    setTaskClockForTests(null)
    vi.stubGlobal('fetch', originalFetch)
    vi.restoreAllMocks()
    setUrl('/')
})

describe('Realm download on the card', () => {
    //(RR) The download showed a static "Downloading..." and, with forceRedirect, nothing.
    test.each([false, true])('R-b3: with a Content-Length the Download step shows rising bytes against the total (forceRedirect %s)', async (forceRedirect) => {
        const png = exportOrderPng()
        const seen: Seen[] = []
        answer = () => streamedResponse(png, {
            headers: { 'content-type': 'image/png', 'content-length': String(png.length) },
            beforePiece: () => { const s = seenNow(); if (s) seen.push(s) },
        })
        const card = await answerImportCard(() => downloadRisuHub('synthetic-id', { creator: 'synthetic-creator', forceRedirect }))

        expect(card?.result).toBeDefined()
        expect(h.characters).toHaveLength(1)
        expect(seen.length).toBeGreaterThanOrEqual(4)
        expect(seen.every((s) => s.label === language.importStepDownload && s.title === language.importTaskRealmTitle)).toBe(true)
        const withBytes = seen.filter((s) => s.bytes !== undefined && s.bytes.done > 0)
        expect(withBytes.length).toBeGreaterThanOrEqual(3)
        expect(withBytes.every((s) => s.bytes?.total === png.length && s.determinate)).toBe(true)
        const done = withBytes.map((s) => s.bytes?.done ?? 0)
        expect(done).toEqual([...done].sort((a, b) => a - b))
        expect(done[done.length - 1]).toBeGreaterThan(done[0])
        //The bar fills with the bytes but never past the Download step's share before the body is read.
        expect(withBytes[withBytes.length - 1].fraction).toBeGreaterThan(withBytes[0].fraction)
        expect(h.legacy).toEqual([])
    })

    //(RR-m) With a content encoding the header counts compressed bytes: the card cannot know the total.
    test('R-b4: a gzip-encoded download has an unknown total and never shows a full bar while bytes arrive', async () => {
        const png = exportOrderPng()
        const seen: Seen[] = []
        //The header counts fewer bytes than the body delivers, as a compressed size would.
        answer = () => streamedResponse(png, {
            headers: { 'content-type': 'image/png', 'content-length': String(Math.floor(png.length / 2)), 'content-encoding': 'gzip' },
            beforePiece: () => { const s = seenNow(); if (s) seen.push(s) },
        })
        await answerImportCard(() => downloadRisuHub('synthetic-id', { creator: 'synthetic-creator' }))

        const withBytes = seen.filter((s) => s.bytes !== undefined && s.bytes.done > 0)
        expect(withBytes.length).toBeGreaterThanOrEqual(3)
        expect(withBytes.every((s) => s.bytes?.total === 0)).toBe(true)
        expect(withBytes.every((s) => !s.determinate && s.fraction < 1)).toBe(true)
        expect(h.characters).toHaveLength(1)
    })

    //(RR-m) Cancel before the first write aborts the request and imports nothing.
    test('R-b11: Cancel during the download aborts the fetch signal and nothing is imported', async () => {
        const png = exportOrderPng()
        let abortedAfterCancel: boolean | null = null
        answer = () => streamedResponse(png, {
            headers: { 'content-type': 'image/png', 'content-length': String(png.length) },
            beforePiece: (index) => {
                if (index === 2) {
                    requestTaskCancel()
                    abortedAfterCancel = calls[0].signal?.aborted ?? null
                }
            },
        })
        const card = await answerImportCard(() => downloadRisuHub('synthetic-id', { creator: 'synthetic-creator' }))

        expect(calls).toHaveLength(1)
        expect(calls[0].url).toContain('/api/v1/download/dynamic/synthetic-id')
        expect(calls[0].signal).toBeTruthy()
        expect(abortedAfterCancel).toBe(true)
        expect(card?.cancelled).toBe(true)
        expect(h.characters).toEqual([])
        expect(h.saved).toEqual([])
        expect(h.errors).toEqual([])
    })
})

describe('Chub link on the card', () => {
    const CHUB = 'https://api.chub.ai/api/characters/download'

    //(RR-m) The download is the first step of the card; the PNG flow follows on the same card.
    test('R-b12: the Download step comes first, then the PNG flow saves its assets on the same card', async () => {
        const png = exportOrderPng()
        const events: string[] = []
        const ids = new Set<number>()
        answer = () => streamedResponse(png, {
            headers: { 'content-type': 'image/png' },
            beforePiece: () => { const view = taskHostView(); if (view) { ids.add(view.id); events.push('pull:' + view.steps[view.stepIndex]?.label) } },
        })
        h.onSave = () => { const view = taskHostView(); if (view) { ids.add(view.id); events.push('save:' + view.steps[view.stepIndex]?.label) } }
        setUrl('/?charahub=someone/card')
        const card = await answerImportCard(() => characterURLImport())

        expect(card?.result).toBeDefined()
        expect(calls.map((c) => c.url)).toEqual([CHUB])
        expect(h.characters).toHaveLength(1)
        const pulls = events.filter((e) => e.startsWith('pull:'))
        const saves = events.filter((e) => e.startsWith('save:'))
        expect(pulls.length).toBeGreaterThan(1)
        expect(pulls.every((e) => e === 'pull:' + language.importStepDownload)).toBe(true)
        expect(saves.length).toBeGreaterThanOrEqual(ASSET_SIZES.length)
        expect(saves.every((e) => e === 'save:' + language.importStepAssets)).toBe(true)
        expect(events.lastIndexOf(pulls[0])).toBeLessThan(events.indexOf(saves[0]))
        expect(ids.size).toBe(1)
        expect(h.legacy).toEqual([])
    })

    //(RR-m)
    test('R-b12: Cancel during the download aborts the Chub request and nothing is imported', async () => {
        const png = exportOrderPng()
        let abortedAfterCancel: boolean | null = null
        answer = () => streamedResponse(png, {
            headers: { 'content-type': 'image/png' },
            beforePiece: (index) => {
                if (index === 2) {
                    requestTaskCancel()
                    abortedAfterCancel = calls[0].signal?.aborted ?? null
                }
            },
        })
        setUrl('/?charahub=someone/card')
        const card = await answerImportCard(() => characterURLImport())

        expect(calls).toHaveLength(1)
        expect(calls[0].signal).toBeTruthy()
        expect(abortedAfterCancel).toBe(true)
        expect(card?.cancelled).toBe(true)
        expect(h.characters).toEqual([])
        expect(h.saved).toEqual([])
    })
})

describe('the caller busy scope of a download', () => {
    //Samples the busy kinds when the result card posts, which is when the answer starts to wait.
    async function busyWhenResultShows(run: () => Promise<unknown>): Promise<BusyKind[]> {
        const done = run()
        await untilResult()
        const atResult = busyKinds()
        answerTask({ kind: 'ok' })
        await done
        return atResult
    }

    //(RR-m) The scope that covers the agreement and creator checks must not be held through the answer.
    test('R-b24: Realm holds busy while it downloads and no busy kind while the result card shows', async () => {
        const png = exportOrderPng()
        const during: BusyKind[][] = []
        answer = () => streamedResponse(png, {
            headers: { 'content-type': 'image/png', 'content-length': String(png.length) },
            beforePiece: () => { during.push(busyKinds()) },
        })
        const atResult = await busyWhenResultShows(() => downloadRisuHub('synthetic-id', { creator: 'synthetic-creator' }))

        expect(during.length).toBeGreaterThan(1)
        expect(during.every((kinds) => kinds.includes('import'))).toBe(true)
        expect(atResult).toEqual([])
        expect(h.characters).toHaveLength(1)
        expect(busyKinds()).toEqual([])
    })

    //(RR-m) The same for a `#import=` link, whose scope is begun by `characterURLImport` itself.
    test('R-b24: a #import= link holds busy while it downloads and no busy kind while the result card shows', async () => {
        const png = exportOrderPng()
        const during: BusyKind[][] = []
        answer = () => streamedResponse(png, {
            headers: { 'content-type': 'image/png', 'content-disposition': 'attachment; filename="cool.png"' },
        })
        const original = answer
        answer = (url) => {
            during.push(busyKinds())
            return original(url)
        }
        setUrl('/#import=https://files.test/dl')
        const atResult = await busyWhenResultShows(() => characterURLImport())

        expect(calls.map((c) => c.url)).toEqual(['https://files.test/dl'])
        expect(during).toHaveLength(1)
        expect(during[0]).toContain('import')
        expect(atResult).toEqual([])
        expect(h.characters).toHaveLength(1)
        expect(busyKinds()).toEqual([])
    })
})

describe('legacy alerts on a tasked character flow', () => {
    //(RR-m) The charx read used to post its own wait; the card replaces it, and the prompt still shows.
    test('R-b21: a charx link posts no legacy wait or progress and still asks the low-level-access question', async () => {
        const bytes = charxWithLowLevel()
        answer = () => new Response(new U8(bytes), { headers: { 'content-disposition': 'attachment; filename="cool.charx"' } })
        setUrl('/#import=https://files.test/dl')
        const card = await answerImportCard(() => characterURLImport())

        expect(h.prompts.some((p) => p.includes(language.lowLevelAccessConfirm))).toBe(true)
        expect(h.characters).toHaveLength(1)
        expect(card?.result).toBeDefined()
        expect(h.legacy).toEqual([])
    })
})
