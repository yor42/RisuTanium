// @vitest-environment happy-dom

/**
 * A Realm download that opens the imported card at once (`goCharacterOnImport` or `forceRedirect`) reports a
 * `changeChar` that throws or rejects through `changeCharOrAlert` (characterPick.ts). The open is not awaited, so
 * without it the rejection escapes `downloadRealmCard`'s own try and reaches the window's raw error alert as an
 * unhandled rejection, and the translated import-failed message never applies either.
 *
 * The real `characterCards.ts`, `characterPick.ts` and `pngChunk.ts` run on synthetic cards; `changeChar` is a
 * scripted stand-in whose behaviour each test sets. Module mocks follow characterCards.archiveImport.test.ts.
 *
 * Labels: "regression reproducer" fails on the base for the defect it names; "guard" passes with or without the change.
 */

import crc32 from 'crc/crc32'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fflate from 'fflate'

//#region module mocks

type OpenOutcome = 'selected' | 'superseded' | 'gone' | { failed: 'unreadable' }

const h = vi.hoisted(() => ({
    errors: [] as string[],
    db: null as unknown as Record<string, unknown> & { characters: Array<Record<string, unknown>> },
    uuid: 0,
    changed: [] as number[],
    /** what the next changeChar call does; 'selected' when unset */
    open: null as null | ((index: number) => Promise<OpenOutcome>),
    generation: 0,
}))

vi.mock('uuid', () => ({
    v4: () => `uuid-${++h.uuid}`,
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
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn((msg: string | Error) => { h.errors.push(msg instanceof Error ? msg.message : String(msg)) }),
    alertInput: vi.fn(async () => ''),
    alertMd: vi.fn(),
    alertModuleSelect: vi.fn(),
    alertNormal: vi.fn(),
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/caughtErrors'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        recordCaughtError: vi.fn(actual.recordCaughtError),
    }
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    defaultSdDataFunc: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    importPreset: vi.fn(),
    setCurrentCharacter: vi.fn(),
    getCurrentCharacter: vi.fn(),
    getCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => h.db),
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
        checkPersonaBinded: vi.fn(),
        decryptBuffer: vi.fn(async (d: unknown) => d),
        isKnownUri: vi.fn(() => false),
        selectFileByDom: vi.fn(async () => null),
        selectSingleFile: vi.fn(async () => null),
        sleep: vi.fn(async () => {}),
    } as unknown as typeof import('src/ts/util')
})

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(async (index: number) => {
        h.changed.push(index)
        return h.open ? h.open(index) : 'selected'
    }),
    changeCharGeneration: vi.fn(() => h.generation),
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
        saveAsset: vi.fn((data: Uint8Array) => Promise.resolve(`asset-${data[0]}-${data.length}`)),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'png'),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return h.db } },
    HideIconStore: { set: vi.fn() },
    moduleBackgroundEmbedding: { set: vi.fn() },
    ReloadGUIPointer: { set: vi.fn() },
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

vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(async (d: Uint8Array) => d),
    encodeRPack: vi.fn(async (d: Uint8Array) => d),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: vi.fn(async () => new Uint8Array()),
}))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
}))

//#endregion

import { downloadRisuHub } from 'src/ts/characterCards'
import { recordCaughtError } from 'src/ts/caughtErrors'
import { language } from 'src/lang'

// ---------------------------------------------------------------------------------------------
// Synthetic files (no real images, no user data)
// ---------------------------------------------------------------------------------------------

const U8 = Uint8Array
const enc = new TextEncoder()

const v2Card = (name: string) => ({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: { name, description: 'd', personality: '', scenario: '', first_mes: 'hi', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [], creator: '', character_version: '1', extensions: { risuai: {} } },
})

const v3Json = (name: string) => JSON.stringify({
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: { name, description: 'd', first_mes: 'hi', character_version: '1', extensions: { risuai: {} }, assets: [] },
})

function charx(name: string): File {
    const files: fflate.Zippable = { 'card.json': [enc.encode(v3Json(name)), { level: 0 }] }
    return new File([new U8(fflate.zipSync(files))], `${name}.charx`, { type: 'application/zip' })
}

function pngChunk(type: string, body: Uint8Array): Uint8Array {
    const t = enc.encode(type)
    const out = new U8(12 + body.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, body.length)
    out.set(t, 4)
    out.set(body, 8)
    view.setUint32(8 + body.length, crc32(Buffer.from(out.subarray(4, 8 + body.length))))
    return out
}

function png(name: string): File {
    const parts = [
        new U8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', new U8(13).fill(1)),
        pngChunk('tEXt', new U8([...enc.encode('chara'), 0, ...enc.encode(Buffer.from(JSON.stringify(v2Card(name))).toString('base64'))])),
        pngChunk('IDAT', new U8(20).fill(2)),
        pngChunk('IEND', new U8(0)),
    ]
    const out = new U8(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) { out.set(p, at); at += p.length }
    return new File([out], `${name}.png`, { type: 'image/png' })
}

const realmPng = (name: string) => new Response(png(name), { status: 200, headers: { 'content-type': 'image/png' } })
const realmCharx = (name: string) => new Response(charx(name), { status: 200, headers: { 'content-type': 'application/zip' } })
const hubJson = (name: string) => new Response(JSON.stringify({ card: JSON.parse(v3Json(name)), img: 'img-id' }), { status: 200, headers: { 'content-type': 'application/json' } })

/** The first request is the download itself; any later one is a hub resource. */
function stubFetch(first: Response): void {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
        calls++
        if (calls === 1) return first
        return new Response(new U8([1, 2, 3]), { status: 200 })
    }))
}

const realFetch = globalThis.fetch

/** One macrotask: lets every promise reaction, and the runtime's unhandled-rejection check, run. */
const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

let unhandled: unknown[]
const onUnhandled = (reason: unknown) => { unhandled.push(reason) }

beforeEach(() => {
    unhandled = []
    process.on('unhandledRejection', onUnhandled)
    h.errors = []
    h.uuid = 0
    h.changed = []
    h.open = null
    h.generation = 0
    h.db = { statics: { imports: 0 }, characters: [], modules: [], goCharacterOnImport: true, archiveCharacters: false, formatversion: 5, plugins: [] } as typeof h.db
    vi.mocked(recordCaughtError).mockClear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
    //Only fetch is put back: the setup file stubs other globals that the import needs.
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
})

const BRANCHES = [
    ['png', () => realmPng('Realm'), 'realm.openPng'],
    ['charx', () => realmCharx('Realm'), 'realm.openPng'],
    ['card json', () => hubJson('Hub'), 'realm.openCard'],
] as const

describe('a Realm download that opens the card at once, when the open throws', () => {
    test.each(BRANCHES)('regression reproducer: the %s branch reports the failure once, translated, and does not claim the import failed', async (_branch, response, site) => {
        const failure = new TypeError('boom')
        h.open = async () => { throw failure }
        stubFetch(response())

        await downloadRisuHub('id', { creator: 'someone' })
        await macrotask()

        expect(h.changed).toEqual([0])
        expect(unhandled).toEqual([])
        expect(h.errors).toEqual([language.errors.coldStorageRestoreUnreadable])
        expect(vi.mocked(recordCaughtError)).toHaveBeenCalledWith(site, failure)
    })

    test('regression reproducer: forceRedirect reports it the same way', async () => {
        const failure = new TypeError('boom')
        h.db.goCharacterOnImport = false
        h.open = async () => { throw failure }
        stubFetch(realmPng('Realm'))

        await downloadRisuHub('id', { creator: 'someone', forceRedirect: true })
        await macrotask()

        expect(unhandled).toEqual([])
        expect(h.errors).toEqual([language.errors.coldStorageRestoreUnreadable])
        expect(vi.mocked(recordCaughtError)).toHaveBeenCalledWith('realm.openPng', failure)
    })

    test('regression reproducer: a synchronous throw from changeChar is reported the same way', async () => {
        const failure = new TypeError('sync boom')
        const { changeChar } = await import('src/ts/characters')
        vi.mocked(changeChar).mockImplementationOnce(() => { throw failure })
        stubFetch(hubJson('Hub'))

        await downloadRisuHub('id', { creator: 'someone' })
        await macrotask()

        expect(unhandled).toEqual([])
        expect(h.errors).toEqual([language.errors.coldStorageRestoreUnreadable])
        expect(vi.mocked(recordCaughtError)).toHaveBeenCalledWith('realm.openCard', failure)
    })
})

describe('a Realm download that opens the card at once, when the open resolves', () => {
    test.each(BRANCHES)('guard: the %s branch opens the imported index and shows nothing extra', async (_branch, response) => {
        h.db.characters.push({ name: 'Existing' })
        stubFetch(response())

        await downloadRisuHub('id', { creator: 'someone' })
        await macrotask()

        expect(h.changed).toEqual([1])
        expect(unhandled).toEqual([])
        expect(h.errors).toEqual([])
        expect(vi.mocked(recordCaughtError)).not.toHaveBeenCalled()
    })

    test.each(BRANCHES.flatMap(([branch, response, site]) => (['superseded', 'gone', { failed: 'unreadable' }] as const).map((outcome) => [branch, response, site, outcome] as const)))(
        'guard: the %s branch adds no alert for the %j outcome', async (_branch, response, _site, outcome) => {
            h.open = async () => outcome
            stubFetch(response())

            await downloadRisuHub('id', { creator: 'someone' })
            await macrotask()

            expect(h.changed).toEqual([0])
            expect(unhandled).toEqual([])
            expect(h.errors).toEqual([])
            expect(vi.mocked(recordCaughtError)).not.toHaveBeenCalled()
        })

    test('guard: a card that does not open at once is not opened and not reported', async () => {
        h.db.goCharacterOnImport = false
        h.open = async () => { throw new TypeError('never called') }
        stubFetch(realmPng('Realm'))

        await downloadRisuHub('id', { creator: 'someone' })
        await macrotask()

        expect(h.changed).toEqual([])
        expect(unhandled).toEqual([])
        expect(h.errors).toEqual([])
    })
})
