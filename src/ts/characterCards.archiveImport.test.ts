// @vitest-environment happy-dom

/**
 * Card import straight to the archive (`characterCards.ts`): a new card is formatted, written to a unit by the
 * one-character archive and enters the library as a stub; when archiving cannot run, or the write fails, the card
 * enters the library live, silently. A batch stops trying after two failures in a row.
 *
 * The real `characterCards.ts` and `pngChunk.ts` run on synthetic cards. The archive engine is replaced by a
 * scripted stand-in (its own contract is tested in `coldCharacterArchive.svelte.test.ts`); `idleReloadBootState`
 * is real. A pass here says nothing about the real stores.
 *
 * Labels: "new behaviour" tests the archive wiring, which does not exist on the base; "regression reproducer" fails
 * on the base for the defect it names; "guard" passes with or without the change.
 */

import crc32 from 'crc/crc32'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fflate from 'fflate'

//#region module mocks

type Target = { kind: 'new' | 'loaded', character: Record<string, unknown> }
type Step = 'ok' | 'write-failed' | 'setting' | 'throw' | 'gate'

const h = vi.hoisted(() => ({
    errors: [] as string[],
    normals: [] as string[],
    db: null as unknown as Record<string, unknown> & { characters: Array<Record<string, unknown>> },
    picked: null as File[] | null,
    ordered: 0,
    uuid: 0,
    /** what the scripted engine does for each call, in order; 'ok' once the script runs out */
    script: [] as Step[],
    engineCalls: [] as Target[],
    /** while set, every engine call waits for the gate of its own number before it acts */
    engineGates: null as null | Array<Promise<void>>,
    formatCalls: [] as unknown[],
    formatThrowsOnce: false,
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
        if (h.formatThrowsOnce) {
            h.formatThrowsOnce = false
            throw new Error('format failed')
        }
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

/** The scripted stand-in for the archive engine: 'ok' appends a stub the way the real one would and returns its index. */
vi.mock(import('src/ts/process/coldCharacterArchive'), () => ({
    archiveCharacterNow: vi.fn(async (target: Target) => {
        const call = h.engineCalls.push(target) - 1
        await h.engineGates?.[call]
        const step = h.script[call] ?? 'ok'
        if (step === 'throw') {
            throw new Error('engine failed')
        }
        if (step === 'write-failed') {
            return { ok: false, reason: 'write-failed', writtenUnitKey: null, countsAsFailure: true }
        }
        if (step === 'setting' || step === 'gate') {
            return { ok: false, reason: 'setting', writtenUnitKey: null, countsAsFailure: false }
        }
        const stub = { chaId: target.character.chaId, name: target.character.name, coldstorage: `unit-${call}` }
        const index = h.db.characters.push(stub) - 1
        return { ok: true, index, chaId: String(stub.chaId), stub, unitKey: `unit-${call}`, previousUnitKey: null }
    }),
    archiveMayRun: vi.fn(() => null),
}) as unknown as typeof import('src/ts/process/coldCharacterArchive'))

//#endregion

import { downloadRisuHub, importCharacter, importCharacterProcess } from 'src/ts/characterCards'
import { noteBootArchiveSession, resetIdleReloadBootStateForTest } from 'src/ts/process/memory/idleReloadBootState'
import { archiveCharacterNow } from 'src/ts/process/coldCharacterArchive'

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
    h.script = []
    h.engineCalls = []
    h.engineGates = null
    h.formatCalls = []
    h.formatThrowsOnce = false
    h.saveGate = null
    h.saveWaiting = 0
    h.changed = []
    vi.mocked(archiveCharacterNow).mockClear()
    resetIdleReloadBootStateForTest()
    noteBootArchiveSession(true)
    setup()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

async function pick(files: File[]) {
    h.picked = files
    await importCharacter()
}

// ---------------------------------------------------------------------------------------------
// The three push sites
// ---------------------------------------------------------------------------------------------

describe('a card imported on the archive path', () => {
    test.each([
        ['a tavern json card', () => ({ name: 'a.json', data: jsonBytes(tavernCard('Tav')) }), 'Tav'],
        ['a tavern png card', () => ({ name: 'a.png', data: tavernPng('TavPng') }), 'TavPng'],
        ['a v2 json card', () => ({ name: 'a.json', data: jsonBytes(v2Card('Two')) }), 'Two'],
        ['a v3 json card', () => ({ name: 'a.json', data: enc.encode(v3Json('Three')) }), 'Three'],
        ['a v3 charx', () => ({ name: 'a.charx', data: charx('Archive') }), 'Archive'],
        ['a v2 png card', () => ({ name: 'a.png', data: png('Image') }), 'Image'],
    ])('new behaviour: %s enters the library as a stub, formatted first, and its index is the engine\'s', async (_kind, file, name) => {
        const returned = await importCharacterProcess({ ...file(), archive: true })

        expect(returned).toBe(0)
        expect(stubs()).toEqual([true])
        expect(names()).toEqual([name])
        expect(h.engineCalls).toHaveLength(1)
        expect(h.engineCalls[0].kind).toBe('new')
        expect(h.engineCalls[0].character.name).toBe(name)
        expect(h.formatCalls).toEqual([h.engineCalls[0].character])
        expect(h.errors).toEqual([])
        expect(h.normals.length).toBeGreaterThan(0)
    })

    test('new behaviour: the card that falls back to live is formatted, pushed whole and reported like any import', async () => {
        h.script = ['write-failed']

        const returned = await importCharacterProcess({ name: 'a.json', data: jsonBytes(v2Card('Live')), archive: true })

        expect(returned).toBe(0)
        expect(stubs()).toEqual([false])
        expect(h.errors).toEqual([])
        expect(h.normals.length).toBeGreaterThan(0)
    })

    test('guard: without the archive flag nothing is formatted or archived, as before', async () => {
        const returned = await importCharacterProcess({ name: 'a.json', data: jsonBytes(v2Card('Live')) })

        expect(returned).toBe(0)
        expect(stubs()).toEqual([false])
        expect(h.engineCalls).toEqual([])
        expect(h.formatCalls).toEqual([])
    })
})

describe('when archiving cannot run', () => {
    test.each([
        ['the session cannot archive', () => noteBootArchiveSession(false)],
        ['the setting is false', () => { h.db.archiveCharacters = false }],
        ['the setting is not yet committed (undefined)', () => { delete h.db.archiveCharacters }],
    ])('compatibility guard: %s -> imported live, no format call and the engine is never called', async (_name, apply) => {
        apply()

        const returned = await importCharacterProcess({ name: 'a.json', data: jsonBytes(v2Card('Live')), archive: true })

        expect(returned).toBe(0)
        expect(stubs()).toEqual([false])
        expect(names()).toEqual(['Live'])
        expect(h.engineCalls).toEqual([])
        expect(h.formatCalls).toEqual([])
        expect(h.errors).toEqual([])
    })

    test('compatibility guard: index 0, the first character of an empty library, is reported as imported', async () => {
        noteBootArchiveSession(false)
        const spec = await importCharacterProcess({ name: 'a.json', data: jsonBytes(v2Card('First')) })
        expect(spec).toBe(0)

        setup()
        h.picked = [charx('First')]
        await importCharacter()
        expect(names()).toEqual(['First'])
        expect(h.normals.length).toBeGreaterThan(0)
        expect(h.errors).toEqual([])
    })
})

// ---------------------------------------------------------------------------------------------
// The batch breaker
// ---------------------------------------------------------------------------------------------

describe('a batch through the picker', () => {
    const five = () => [charx('C1'), charx('C2'), charx('C3'), charx('C4'), charx('C5')]

    test('new behaviour: two failures in a row import the rest live without trying; the earlier success stays a stub', async () => {
        h.script = ['ok', 'write-failed', 'write-failed']

        await pick(five())

        expect(names()).toEqual(['C1', 'C2', 'C3', 'C4', 'C5'])
        expect(stubs()).toEqual([true, false, false, false, false])
        expect(h.engineCalls).toHaveLength(3)
        expect(h.errors).toEqual([])
    })

    test('new behaviour: failures that are not in a row never stop the batch', async () => {
        h.script = ['write-failed', 'ok', 'write-failed', 'ok']

        await pick([charx('C1'), charx('C2'), charx('C3'), charx('C4')])

        expect(stubs()).toEqual([false, true, false, true])
        expect(h.engineCalls).toHaveLength(4)
    })

    test('new behaviour: a refusal that is not a storage failure does not count toward the breaker', async () => {
        h.script = ['setting', 'setting', 'setting', 'ok']

        await pick([charx('C1'), charx('C2'), charx('C3'), charx('C4')])

        expect(h.engineCalls).toHaveLength(4)
        expect(stubs()).toEqual([false, false, false, true])
    })

    test('new behaviour: an engine that throws is a failure for the breaker and the card imports live', async () => {
        h.script = ['throw', 'throw']

        await pick([charx('C1'), charx('C2'), charx('C3')])

        expect(stubs()).toEqual([false, false, false])
        expect(h.engineCalls).toHaveLength(2)
        expect(h.errors).toEqual([])
    })

    test('new behaviour: a format step that throws imports that card live, skips the engine and leaves the breaker alone', async () => {
        h.script = ['write-failed', 'ok', 'ok']
        h.formatThrowsOnce = true

        await pick([charx('C1'), charx('C2'), charx('C3'), charx('C4')])

        expect(names()).toEqual(['C1', 'C2', 'C3', 'C4'])
        expect(h.engineCalls.map((call) => call.character.name)).toEqual(['C2', 'C3', 'C4'])
        expect(stubs()).toEqual([false, false, true, true])
        expect(h.errors).toEqual([])
    })

    test('new behaviour: each picker call has its own run, so an earlier batch\'s failures do not carry over', async () => {
        h.script = ['write-failed', 'write-failed']
        await pick([charx('C1'), charx('C2'), charx('C3')])
        expect(h.engineCalls).toHaveLength(2)

        h.script = []
        await pick([charx('D1')])

        expect(h.engineCalls).toHaveLength(3)
        expect(stubs()[3]).toBe(true)
    })

    test('new behaviour: presets and modules in a batch are unaffected, and an off-spec json card archives', async () => {
        await pick([jsonFile(tavernCard('Old'), 'old.json'), charx('Good')])

        expect(names()).toEqual(['Old', 'Good'])
        expect(stubs()).toEqual([true, true])
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

    test('new behaviour: a realm png that does not open at once is archived and nothing is opened', async () => {
        stubFetch(realmPng('Realm'))

        await downloadRisuHub('id', { creator: 'someone' })

        expect(stubs()).toEqual([true])
        expect(h.changed).toEqual([])
    })

    test.each([
        ['goCharacterOnImport', () => { h.db.goCharacterOnImport = true }, {}],
        ['forceRedirect', () => {}, { forceRedirect: true }],
    ])('new behaviour: a realm png with %s is imported live and the imported index is opened', async (_name, apply, arg) => {
        h.db.characters.push({ name: 'Existing' })
        apply()
        stubFetch(realmPng('Realm'))

        await downloadRisuHub('id', { creator: 'someone', ...arg })

        expect(h.engineCalls).toEqual([])
        expect(names()).toEqual(['Existing', 'Realm'])
        expect(h.changed).toEqual([1])
    })

    test('new behaviour: the opens-at-once decision is the one read before the download', async () => {
        h.db.goCharacterOnImport = true
        const response = realmPng('Realm')
        let calls = 0
        vi.stubGlobal('fetch', vi.fn(async () => {
            calls++
            h.db.goCharacterOnImport = false
            return response
        }))

        await downloadRisuHub('id', { creator: 'someone' })

        expect(calls).toBe(1)
        expect(h.engineCalls).toEqual([])
        expect(h.changed).toEqual([0])
    })

    test('new behaviour: a hub spec card that does not open at once is archived', async () => {
        stubFetch(hubJson())

        await downloadRisuHub('id', { creator: 'someone' })

        expect(stubs()).toEqual([true])
        expect(h.changed).toEqual([])
    })

    test('new behaviour: a hub spec card that opens at once is imported live and its own index is opened', async () => {
        h.db.characters.push({ name: 'Existing' }, { name: 'Other' })
        h.db.goCharacterOnImport = true
        stubFetch(hubJson())

        await downloadRisuHub('id', { creator: 'someone' })

        expect(h.engineCalls).toEqual([])
        expect(names()).toEqual(['Existing', 'Other', 'Hub'])
        expect(h.changed).toEqual([2])
    })

    test('new behaviour: a hub spec card imported live (opens at once) into an empty library is index 0 and is opened', async () => {
        h.db.goCharacterOnImport = true
        stubFetch(hubJson())

        await downloadRisuHub('id', { creator: 'someone' })

        expect(names()).toEqual(['Hub'])
        expect(h.changed).toEqual([0])
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

    test('new behaviour: two archive-path imports with a splice during the unit writes each get their own index', async () => {
        h.db.characters.push({ name: 'Existing' })
        const first = deferred()
        const second = deferred()
        h.engineGates = [first.promise, second.promise]

        const a = importCharacterProcess({ name: 'a.json', data: jsonBytes(v2Card('A')), archive: true })
        await vi.waitFor(() => expect(h.engineCalls).toHaveLength(1))
        const b = importCharacterProcess({ name: 'b.json', data: jsonBytes(v2Card('B')), archive: true })
        await vi.waitFor(() => expect(h.engineCalls).toHaveLength(2))
        h.db.characters.splice(0, 1)
        second.resolve()
        first.resolve()
        const [indexOfA, indexOfB] = [await a, await b]

        expect(h.db.characters[indexOfA as number].name).toBe('A')
        expect(h.db.characters[indexOfB as number].name).toBe('B')
    })

    test('new behaviour: a live card pushed after a splice during the format and archive wait reports its own index', async () => {
        h.script = ['write-failed']
        const gate = deferred()
        h.engineGates = [gate.promise]
        h.db.characters.push({ name: 'Existing' }, { name: 'Other' })

        const pending = importCharacterProcess({ name: 'a.json', data: jsonBytes(v2Card('A')), archive: true })
        await vi.waitFor(() => expect(h.engineCalls).toHaveLength(1))
        h.db.characters.splice(0, 1)
        gate.resolve()
        const index = await pending

        expect(h.db.characters[index as number].name).toBe('A')
    })
})
