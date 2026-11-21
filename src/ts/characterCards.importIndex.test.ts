// @vitest-environment happy-dom

/**
 * Card import (`characterCards.ts`): every imported card enters the library live, whatever `archiveCharacters` says, and
 * each outcome names the index of its own card, read at the push and not after a later await.
 *
 * The real `characterCards.ts` and `pngChunk.ts` run on synthetic cards. A pass here says nothing about the real stores.
 *
 * Labels: "regression reproducer" fails on the base for the defect it names; "guard" and "compatibility guard" pass with
 * or without the change that removed the archive import path.
 */

import crc32 from 'crc/crc32'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fflate from 'fflate'

//#region module mocks

const h = vi.hoisted(() => ({
    errors: [] as string[],
    normals: [] as string[],
    db: null as unknown as Record<string, unknown> & { characters: Array<Record<string, unknown>> },
    picked: null as File[] | null,
    ordered: 0,
    uuid: 0,
    formatCalls: [] as unknown[],
    /** while set, an asset save waits for this promise */
    saveGate: null as Promise<void> | null,
    saveWaiting: 0,
    changed: [] as number[],
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
    alertNormal: vi.fn((msg: string) => { h.normals.push(msg) }),
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

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
        selectFileByDom: vi.fn(async () => h.picked),
        selectSingleFile: vi.fn(async () => null),
        sleep: vi.fn(async () => {}),
    } as unknown as typeof import('src/ts/util')
})

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(async (index: number) => { h.changed.push(index) }),
    characterFormatUpdate: vi.fn((c: unknown) => {
        h.formatCalls.push(c)
        return c
    }),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { AppendableBuffer } = await import('src/ts/byteBuffer')
    return {
        AppendableBuffer,
        BlankWriter: class {},
        LocalWriter: class {},
        VirtualWriter: class {},
        checkCharOrder: vi.fn(() => { h.ordered++ }),
        downloadFile: vi.fn(async () => {}),
        forageStorage: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
        loadAsset: vi.fn(async () => new Uint8Array()),
        openURL: vi.fn(),
        readImage: vi.fn(async (d: unknown) => d),
        //Not an async function: while gated it hands back the gate itself, so the caller resumes one microtask after the gate opens.
        saveAsset: vi.fn((data: Uint8Array) => {
            if (h.saveGate) {
                h.saveWaiting++
                return h.saveGate
            }
            return Promise.resolve(`asset-${data[0]}-${data.length}`)
        }),
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

import { downloadRisuHub, importCharacter, importCharacterProcess } from 'src/ts/characterCards'
import { resetTaskHostForTests } from 'src/ts/alertTask.svelte'
import { answerImportCard } from 'src/ts/process/tests/answerImportCard'
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

const tavernCard = (name: string) => ({ name, description: 'd', first_mes: 'hi' })

const jsonBytes = (card: unknown) => enc.encode(JSON.stringify(card))

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

function pngOf(card: unknown, fileName: string): File {
    const parts = [
        new U8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', new U8(13).fill(1)),
        pngChunk('tEXt', new U8([...enc.encode('chara'), 0, ...enc.encode(Buffer.from(JSON.stringify(card)).toString('base64'))])),
        pngChunk('IDAT', new U8(20).fill(2)),
        pngChunk('IEND', new U8(0)),
    ]
    const out = new U8(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) { out.set(p, at); at += p.length }
    return new File([out], fileName, { type: 'image/png' })
}

const png = (name: string) => pngOf(v2Card(name), `${name}.png`)
const tavernPng = (name: string) => pngOf(tavernCard(name), `${name}.png`)
const jsonFile = (card: unknown, fileName: string) => new File([jsonBytes(card)], fileName, { type: 'application/json' })

const names = () => h.db.characters.map((c) => c.name)
const stubs = () => h.db.characters.map((c) => typeof c.coldstorage === 'string')

function deferred() {
    let resolve!: () => void
    const promise = new Promise<void>((r) => { resolve = r })
    return { promise, resolve }
}

function setup(over: Record<string, unknown> = {}): void {
    h.db = { statics: { imports: 0 }, characters: [], modules: [], goCharacterOnImport: false, archiveCharacters: true, formatversion: 5, plugins: [], ...over } as typeof h.db
}

beforeEach(() => {
    h.errors = []
    h.normals = []
    h.picked = null
    h.ordered = 0
    h.uuid = 0
    h.formatCalls = []
    h.saveGate = null
    h.saveWaiting = 0
    h.changed = []
    setup()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    resetTaskHostForTests()
    vi.restoreAllMocks()
})

//The picker import resolves only after its result card is answered.
async function pick(files: File[]) {
    h.picked = files
    return await answerImportCard(() => importCharacter())
}

//A Realm download ends on the result card too.
const download = (arg: { forceRedirect?: boolean, creator?: string } = {}) => answerImportCard(() => downloadRisuHub('id', { creator: 'someone', ...arg }))

// ---------------------------------------------------------------------------------------------
// Every card enters live
// ---------------------------------------------------------------------------------------------

describe('a card imported with archiveCharacters on', () => {
    test.each([
        ['a tavern json card', () => ({ name: 'a.json', data: jsonBytes(tavernCard('Tav')) }), 'Tav'],
        ['a tavern png card', () => ({ name: 'a.png', data: tavernPng('TavPng') }), 'TavPng'],
        ['a v2 json card', () => ({ name: 'a.json', data: jsonBytes(v2Card('Two')) }), 'Two'],
        ['a v3 json card', () => ({ name: 'a.json', data: enc.encode(v3Json('Three')) }), 'Three'],
        ['a v3 charx', () => ({ name: 'a.charx', data: charx('Live') }), 'Live'],
        ['a v2 png card', () => ({ name: 'a.png', data: png('Image') }), 'Image'],
    ])('compatibility guard: %s enters the library live, with its own index and no format call', async (_kind, file, name) => {
        const returned = await importCharacterProcess(file())

        expect(returned).toBe(0)
        expect(stubs()).toEqual([false])
        expect(names()).toEqual([name])
        expect(h.formatCalls).toEqual([])
        expect(h.errors).toEqual([])
        expect(h.normals.length).toBeGreaterThan(0)
    })
})

describe('whatever the archiveCharacters setting says', () => {
    test.each([
        ['the setting is true', () => { h.db.archiveCharacters = true }],
        ['the setting is false', () => { h.db.archiveCharacters = false }],
        ['the setting is not yet committed (undefined)', () => { delete h.db.archiveCharacters }],
    ])('compatibility guard: %s -> imported live and no format call', async (_name, apply) => {
        apply()

        const returned = await importCharacterProcess({ name: 'a.json', data: jsonBytes(v2Card('Live')) })

        expect(returned).toBe(0)
        expect(stubs()).toEqual([false])
        expect(names()).toEqual(['Live'])
        expect(h.formatCalls).toEqual([])
        expect(h.errors).toEqual([])
    })

    test('compatibility guard: index 0, the first character of an empty library, is reported as imported', async () => {
        const spec = await importCharacterProcess({ name: 'a.json', data: jsonBytes(v2Card('First')) })
        expect(spec).toBe(0)

        setup()
        const card = await pick([charx('First')])
        expect(names()).toEqual(['First'])
        //index 0 is an import, not a refusal: the result card reports it
        expect(card?.result?.headline).toBe(language.importTaskImported(1))
        expect(card?.failure).toBeUndefined()
        expect(h.errors).toEqual([])
    })
})

describe('a batch through the picker', () => {
    test('compatibility guard: an off-spec json card in a batch with a charx imports live', async () => {
        await pick([jsonFile(tavernCard('Old'), 'old.json'), charx('Good')])

        expect(names()).toEqual(['Old', 'Good'])
        expect(stubs()).toEqual([false, false])
        expect(h.ordered).toBe(2)
    })
})

// ---------------------------------------------------------------------------------------------
// Realm and hub
// ---------------------------------------------------------------------------------------------

describe('downloadRisuHub', () => {
    const realmPng = (name: string) => {
        const file = png(name)
        return new Response(file, { status: 200, headers: { 'content-type': 'image/png' } })
    }

    const hubJson = () => new Response(JSON.stringify({ card: JSON.parse(v3Json('Hub')), img: 'img-id' }), { status: 200, headers: { 'content-type': 'application/json' } })

    function stubFetch(first: Response): void {
        let calls = 0
        vi.stubGlobal('fetch', vi.fn(async () => {
            calls++
            if (calls === 1) return first
            return new Response(new U8([1, 2, 3]), { status: 200 })
        }))
    }

    const realFetch = globalThis.fetch

    //Only fetch is put back: the setup file stubs other globals that the import needs.
    afterEach(() => {
        globalThis.fetch = realFetch
    })

    test('compatibility guard: a realm png that does not open at once is imported live and nothing is opened', async () => {
        stubFetch(realmPng('Realm'))

        await download()

        expect(stubs()).toEqual([false])
        expect(names()).toEqual(['Realm'])
        expect(h.changed).toEqual([])
    })

    test.each([
        ['goCharacterOnImport', () => { h.db.goCharacterOnImport = true }, {}],
        ['forceRedirect', () => {}, { forceRedirect: true }],
    ])('compatibility guard: a realm png with %s is imported live and the imported index is opened', async (_name, apply, arg) => {
        h.db.characters.push({ name: 'Existing' })
        apply()
        stubFetch(realmPng('Realm'))

        await download(arg)

        expect(names()).toEqual(['Existing', 'Realm'])
        expect(h.changed).toEqual([1])
    })

    test('compatibility guard: the opens-at-once decision is the one read before the download', async () => {
        h.db.goCharacterOnImport = true
        const response = realmPng('Realm')
        let calls = 0
        vi.stubGlobal('fetch', vi.fn(async () => {
            calls++
            h.db.goCharacterOnImport = false
            return response
        }))

        await download()

        expect(calls).toBe(1)
        expect(h.changed).toEqual([0])
    })

    test('compatibility guard: a hub spec card that does not open at once is imported live and nothing is opened', async () => {
        stubFetch(hubJson())

        await download()

        expect(stubs()).toEqual([false])
        expect(names()).toEqual(['Hub'])
        expect(h.changed).toEqual([])
    })

    test('compatibility guard: a hub spec card that opens at once is imported live and its own index is opened', async () => {
        h.db.characters.push({ name: 'Existing' }, { name: 'Other' })
        h.db.goCharacterOnImport = true
        stubFetch(hubJson())

        await download()

        expect(names()).toEqual(['Existing', 'Other', 'Hub'])
        expect(h.changed).toEqual([2])
    })
})

// ---------------------------------------------------------------------------------------------
// The index belongs to the card
// ---------------------------------------------------------------------------------------------

describe('two imports that overlap', () => {
    test('regression reproducer: each outcome names its own card when another import lands during one\'s asset save', async () => {
        //B resumes one microtask after its gate opens, before A's caller reads A's position; A pushes synchronously in between.
        //An index read after the await then names B's slot for A.
        const gate = deferred()
        h.saveGate = gate.promise
        const slow = importCharacterProcess({ name: 'b.png', data: png('B') })
        await vi.waitFor(() => expect(h.saveWaiting).toBe(1))
        h.saveGate = null

        gate.resolve()
        const fast = importCharacterProcess({ name: 'a.json', data: jsonBytes(v2Card('A')) })
        const [indexOfA, indexOfB] = [await fast, await slow]

        expect(typeof indexOfA).toBe('number')
        expect(typeof indexOfB).toBe('number')
        expect(h.db.characters[indexOfA as number].name).toBe('A')
        expect(h.db.characters[indexOfB as number].name).toBe('B')
    })
})
