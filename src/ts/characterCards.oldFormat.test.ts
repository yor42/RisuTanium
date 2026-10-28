/**
 * Old-format card import (TavernAI v1, Pygmalion, v2 wrapper without a spec) through `importCharacterFile` in
 * `src/ts/characterCards.ts`, on the JSON and the PNG route.
 *
 * The real `characterCards.ts`, `pngChunk.ts`, `pngCardImport.ts` and `importSource.ts` run against synthetic cards built
 * here; everything the import reaches around them (the database, asset storage, alerts, the zip importer) is replaced by
 * recorders. Tests marked "reproducer" fail against the importer before the old-card reader existed; tests marked
 * "guard" pin behaviour that is the same before and after; tests marked "unit" call a helper that did not exist before.
 */

import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import crc32 from 'crc/crc32'

//#region module mocks

const h = vi.hoisted(() => ({
    saved: [] as Array<{ id: string, length: number }>,
    characters: [] as Array<Record<string, unknown>>,
    uuid: 0,
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
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertInput: vi.fn(async () => 'pw'),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    alertWait: vi.fn(),
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

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    isKnownUri: vi.fn(() => false),
    selectFileByDom: vi.fn(async () => null),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

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
    DBState: { get db() { return { characters: h.characters } } },
    SettingsMenuIndex: { set: vi.fn() },
    ShowRealmFrameStore: { set: vi.fn() },
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    selectedCharID: { set: vi.fn() },
    settingsOpen: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn(async (d: Uint8Array) => `len${d.length}`),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/processzip'), () => ({
    CharXImporter: class {},
    CharXWriter: class {},
    assetByteLimit: () => 200 * 1024 * 1024,
}) as unknown as typeof import('src/ts/process/processzip'))

vi.mock(import('src/ts/process/modules'), () => ({
    exportModuleLegacy: vi.fn(),
    readModule: vi.fn(),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    SeekMode: { Start: 0, Current: 1, End: 2 },
    readFile: vi.fn(async () => new Uint8Array()),
}))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
}))

//#endregion

import { importCharacterFile, planOldCard } from 'src/ts/characterCards'
import { language } from 'src/lang'

// ---------------------------------------------------------------------------------------------
// Synthetic cards (no real images, no user data)
// ---------------------------------------------------------------------------------------------

const U8 = Uint8Array
const SIG = new U8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const utf8 = (s: string) => new TextEncoder().encode(s)
const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64')

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
/** A card image whose `chara` chunk carries `cardJson` (any JSON text, including a non-object). */
const pngOf = (cardJson: string) => concat([SIG, chunk('IHDR', new U8(13).fill(1)), chunk('IDAT', new U8(40).fill(7)), text('chara', b64(cardJson)), chunk('IEND', new U8(0))])

type Card = Record<string, unknown>
type Route = (card: unknown) => ReturnType<typeof importCharacterFile>

function reset() {
    h.saved = []
    h.characters = []
    h.uuid = 0
}

const asJson: Route = (card) => importCharacterFile({ name: 'card.json', data: utf8(JSON.stringify(card)) })
const asPng: Route = (card) => importCharacterFile({ name: 'card.png', data: pngOf(JSON.stringify(card)) })
const routes: Array<[string, Route]> = [['JSON', asJson], ['PNG', asPng]]

const entry = { keys: ['k'], content: 'c', insertion_order: 1, enabled: true }
const wrapper = (data: unknown, top: Card = {}): Card => ({ spec_version: '2.0', data, ...top })

const noData = { kind: 'refused', reason: language.errors.noData }

function imported(): Card {
    expect(h.characters).toHaveLength(1)
    return h.characters[0]
}

function expectNothingSaved() {
    expect(h.characters).toHaveLength(0)
    expect(h.saved).toHaveLength(0)
}

beforeEach(() => {
    reset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------------------------
// Pygmalion and mixed cards
// ---------------------------------------------------------------------------------------------

describe('Pygmalion and mixed cards (reproducers)', () => {
    const pygmalion: Card = { char_name: 'P', char_persona: 'persona', char_greeting: 'hello', example_dialogue: 'ex', world_scenario: 'sc', creator_notes: 'cn', creator: 'me', tags: ['a', 1, 'b'] }

    test.each(routes)('%s: a Pygmalion card maps every field it carries', async (_, route) => {
        const out = await route(pygmalion)
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject({ name: 'P', desc: 'persona', firstMessage: 'hello', exampleMessage: 'ex', scenario: 'sc', creatorNotes: 'cn', creator: 'me', tags: ['a', 'b'] })
    })

    test.each(routes)('%s: a card with char_name and v1 text fields keeps what the v1 fields carry', async (_, route) => {
        const out = await route({ char_name: 'P', description: 'd', first_mes: 'hi', personality: 'pp', scenario: 'sc', mes_example: 'ex' })
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject({ name: 'P', desc: 'd', firstMessage: 'hi', personality: 'pp', scenario: 'sc', exampleMessage: 'ex' })
    })

    test.each(routes)('%s: an empty Pygmalion text field does not override the filled v1 field', async (_, route) => {
        const out = await route({ char_name: 'P', char_persona: '', description: 'd', char_greeting: '', first_mes: 'hi' })
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject({ name: 'P', desc: 'd', firstMessage: 'hi' })
    })
})

// ---------------------------------------------------------------------------------------------
// The v2 wrapper without a spec
// ---------------------------------------------------------------------------------------------

describe('a v2 wrapper without a spec (reproducers)', () => {
    test('JSON: the wrapper is read through its data, system prompt included', async () => {
        const out = await asJson(wrapper({ name: 'W', description: 'dd', first_mes: 'hi', system_prompt: 'sp' }))
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject({ name: 'W', desc: 'dd', firstMessage: 'hi', systemPrompt: 'sp' })
    })

    test('JSON: the wrapper keeps its character book entries', async () => {
        const out = await asJson(wrapper({ name: 'W', first_mes: 'hi', character_book: { entries: [entry] } }))
        expect(out.kind).toBe('imported')
        expect(imported().globalLore).toHaveLength(1)
    })

    test.each(routes)('%s: a wrapper whose data is null imports from the top level, with no wrapper extras', async (label, route) => {
        const out = await route(wrapper(null, { name: 'N', first_mes: 'hi' }))
        expect(out.kind, label).toBe('imported')
        expect(imported()).toMatchObject({ name: 'N', firstMessage: 'hi', systemPrompt: '', postHistoryInstructions: '', globalLore: [] })
        if (label === 'PNG') {
            //The image is the only asset, and the character uses it.
            expect(h.saved).toHaveLength(1)
            expect(imported().image).toBe(h.saved[0].id)
        }
    })

    test.each(routes)('%s: a wrapper whose data has no name takes the name from the top level', async (_, route) => {
        const out = await route(wrapper({ description: 'x' }, { name: 'Top', first_mes: 'hi' }))
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject({ name: 'Top', desc: 'x', firstMessage: 'hi' })
    })

    test.each(routes)('%s: data fills the fields it has, and the top level fills the rest', async (_, route) => {
        const out = await route(wrapper({ description: 'dd', first_mes: 'f' }, { name: 'Top', first_mes: 'hi' }))
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject({ name: 'Top', firstMessage: 'f', desc: 'dd' })
    })

    test('PNG: a nameless data keeps its extras and takes only the name from the top level', async () => {
        const out = await asPng(wrapper({ description: 'dd', system_prompt: 'sp', character_book: { entries: [entry] } }, { name: 'Top' }))
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject({ name: 'Top', desc: 'dd', systemPrompt: 'sp' })
        expect(imported().globalLore).toHaveLength(1)
    })
})

// ---------------------------------------------------------------------------------------------
// A character book that cannot be converted refuses the card before anything is saved
// ---------------------------------------------------------------------------------------------

describe('a wrapper whose character book cannot be converted', () => {
    const books: Array<[string, unknown]> = [
        ['an entry that is null', [null]],
        ['an entry that is an empty object', [{}]],
        ['an entry that is a number', [42]],
        ['entries that are not an array', 's'],
        ['an entry whose keys are a string', [{ keys: 'abc', content: 'c', insertion_order: 1, enabled: true }]],
    ]

    test.each(books)('PNG, %s: refused with noData, nothing saved (reproducer)', async (_, entries) => {
        const out = await asPng(wrapper({ name: 'N', character_book: { entries } }))
        expect(out).toEqual(noData)
        expectNothingSaved()
    })

    test.each(books)('JSON, %s: refused with noData, nothing saved (guard)', async (_, entries) => {
        const out = await asJson(wrapper({ name: 'N', character_book: { entries } }))
        expect(out).toEqual(noData)
        expectNothingSaved()
    })
})

// ---------------------------------------------------------------------------------------------
// A name is enough; a card with no name is refused
// ---------------------------------------------------------------------------------------------

describe('a card that carries only some fields', () => {
    test('JSON: a card with only a name imports, every other text field empty (reproducer)', async () => {
        const out = await asJson({ name: 'N' })
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject({ name: 'N', desc: '', firstMessage: '', exampleMessage: '', personality: '', scenario: '' })
    })

    test('JSON: a card with a name and a description but no first message imports an empty first message (reproducer)', async () => {
        const out = await asJson({ name: 'N', description: 'd' })
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject({ name: 'N', desc: 'd', firstMessage: '' })
    })

    test('PNG: a card with only a name has an empty first message and example, not a placeholder (reproducer)', async () => {
        const out = await asPng({ name: 'N' })
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject({ name: 'N', firstMessage: '', exampleMessage: '' })
    })

    test('PNG: a card with no name is refused, and neither the character nor the image is saved (reproducer)', async () => {
        const out = await asPng({ description: 'd' })
        expect(out).toEqual(noData)
        expectNothingSaved()
    })

    test('JSON: a whitespace name is refused (reproducer)', async () => {
        const out = await asJson({ name: '  ', first_mes: 'hi', description: 'd' })
        expect(out).toEqual(noData)
        expectNothingSaved()
    })

    test('PNG: a whitespace name is refused, and nothing is saved (reproducer)', async () => {
        const out = await asPng({ name: '  ', first_mes: 'hi', description: 'd' })
        expect(out).toEqual(noData)
        expectNothingSaved()
    })

    test.each([['null', 'null'], ['a number', '42'], ['an array', '[]'], ['a string', '"s"']])('PNG: a card JSON that is %s is refused with noData, nothing saved (reproducer)', async (_, cardJson) => {
        const out = await importCharacterFile({ name: 'card.png', data: pngOf(cardJson) })
        expect(out).toEqual(noData)
        expectNothingSaved()
    })
})

// ---------------------------------------------------------------------------------------------
// File name suffixes are matched in any case
// ---------------------------------------------------------------------------------------------

describe('file name suffix case', () => {
    test.each(['X.JSON', 'X.Json'])('%s imports as a json card (reproducer)', async (name) => {
        const out = await importCharacterFile({ name, data: utf8(JSON.stringify({ name: 'N', description: 'd', first_mes: 'hi' })) })
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject({ name: 'N' })
    })

    test.each(['X.PNG', 'X.Png'])('%s imports as a png card (reproducer)', async (name) => {
        const out = await importCharacterFile({ name, data: pngOf(JSON.stringify({ name: 'N', description: 'd', first_mes: 'hi' })) })
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject({ name: 'N' })
    })
})

// ---------------------------------------------------------------------------------------------
// Guards: behaviour that is the same before and after
// ---------------------------------------------------------------------------------------------

describe('guards', () => {
    test.each(routes)('%s: a v1 card keeps the fields it imported before (guard)', async (_, route) => {
        const out = await route({ name: 'Old', description: 'd', first_mes: 'hi', personality: 'pp', scenario: 'sc', mes_example: 'ex' })
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject({ name: 'Old', desc: 'd', firstMessage: 'hi', personality: 'pp', scenario: 'sc', exampleMessage: 'ex' })
    })

    test.each(routes)('%s: a card with both name and char_name uses name (guard)', async (_, route) => {
        const out = await route({ name: 'V1', char_name: 'Pyg', description: 'd', first_mes: 'hi' })
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject({ name: 'V1' })
    })

    test('PNG: a v1 card saves its image as the character image (guard)', async () => {
        const out = await asPng({ name: 'Old', description: 'd', first_mes: 'hi' })
        expect(out.kind).toBe('imported')
        expect(h.saved).toHaveLength(1)
        expect(imported().image).toBe(h.saved[0].id)
    })

    test.each(routes)('%s: a v2 card is imported as before (guard)', async (_, route) => {
        const out = await route({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'V2', description: 'd', first_mes: 'hi', character_version: '1', extensions: { risuai: {} } } })
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject({ name: 'V2', desc: 'd', firstMessage: 'hi' })
    })

    test.each(routes)('%s: a v3 card is imported as before (guard)', async (_, route) => {
        const out = await route({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'V3', description: 'd', first_mes: 'hi', character_version: '1', extensions: { risuai: {} }, assets: [] } })
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject({ name: 'V3', desc: 'd', firstMessage: 'hi' })
    })

    test('JSON: a file that is not a card is refused with noData (guard)', async () => {
        const out = await asJson({ foo: 1 })
        expect(out).toEqual(noData)
        expectNothingSaved()
    })

    test('a text file is refused as not a card file (guard)', async () => {
        const out = await importCharacterFile({ name: 'notes.txt', data: new U8([1, 2, 3]) })
        expect(out).toEqual({ kind: 'refused', reason: language.importNotCardFile })
        expectNothingSaved()
    })
})

// ---------------------------------------------------------------------------------------------
// planOldCard
// ---------------------------------------------------------------------------------------------

describe('planOldCard (unit)', () => {
    test('a character book whose entries are null is refused', () => {
        expect(planOldCard(wrapper({ name: 'N', character_book: { entries: [null] } }))).toBeNull()
    })

    test('a character book whose entries are not an array is refused', () => {
        expect(planOldCard(wrapper({ name: 'N', character_book: { entries: 's' } }))).toBeNull()
    })

    test('a character book whose entries are an empty string imports with no lore', () => {
        const character = planOldCard(wrapper({ name: 'N', character_book: { entries: '' } }))
        expect(character).not.toBeNull()
        expect(character?.name).toBe('N')
        expect(character?.globalLore).toEqual([])
    })

    test('a value that is no old card is refused', () => {
        expect(planOldCard(null)).toBeNull()
        expect(planOldCard({ description: 'd' })).toBeNull()
    })
})
