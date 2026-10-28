/**
 * YAML card import (`.yaml` / `.yml`) through `importCharacterFile` in `src/ts/characterCards.ts`: a card carries a
 * `name`, a `context` (the description) and a `greeting` (the first message); every other key is ignored.
 *
 * The real `characterCards.ts` and `importSource.ts` run against synthetic YAML text given as string fixtures; everything the
 * import reaches around them (the database, asset storage, alerts, the zip importer) is replaced by recorders. Tests marked
 * "reproducer" fail against the importer before the YAML route existed; tests marked "guard" pin behaviour that is the same
 * before and after.
 */

import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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

import { importCharacterFile } from 'src/ts/characterCards'
import { importSourceOfBytes } from 'src/ts/importSource'
import { language } from 'src/lang'

// ---------------------------------------------------------------------------------------------
// Synthetic cards (no real data)
// ---------------------------------------------------------------------------------------------

type Card = Record<string, unknown>

const utf8 = (s: string) => new TextEncoder().encode(s)

const VALID = 'name: Yaya\ncontext: A short description.\ngreeting: Hello there.\n'
const noData = { kind: 'refused', reason: language.errors.noData }
const notCardFile = { kind: 'refused', reason: language.importNotCardFile }

const yamlOf = (text: string, name = 'card.yaml') => importCharacterFile({ name, data: utf8(text) })

function reset() {
    h.saved = []
    h.characters = []
    h.uuid = 0
}

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
// The three keys
// ---------------------------------------------------------------------------------------------

describe('a YAML card (reproducers)', () => {
    const expected = { name: 'Yaya', desc: 'A short description.', firstMessage: 'Hello there.', personality: '', scenario: '', exampleMessage: '' }

    test.each([['card.yaml'], ['card.yml'], ['CARD.YAML'], ['Card.Yml']])('%s imports name, context and greeting', async (name) => {
        const out = await yamlOf(VALID, name)
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject(expected)
    })

    test('a File and an ImportSource import like the bytes', async () => {
        const fromFile = await importCharacterFile({ name: 'card.yaml', data: new File([utf8(VALID)], 'card.yaml') })
        expect(fromFile.kind).toBe('imported')
        expect(imported()).toMatchObject(expected)
        reset()
        const fromSource = await importCharacterFile({ name: 'card.yml', data: importSourceOfBytes('card.yml', utf8(VALID)) })
        expect(fromSource.kind).toBe('imported')
        expect(imported()).toMatchObject(expected)
    })

    test('a block scalar context keeps its exact text, newlines included', async () => {
        const out = await yamlOf('name: Yaya\ncontext: |\n  line one\n  line two\n\n  line four\ngreeting: hi\n')
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject({ name: 'Yaya', desc: 'line one\nline two\n\nline four\n', firstMessage: 'hi' })
    })

    test('a name alone imports, with an empty description and first message', async () => {
        const out = await yamlOf('name: Solo\n')
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject({ name: 'Solo', desc: '', firstMessage: '' })
    })

    test('keys other than name, context and greeting are not imported', async () => {
        const out = await yamlOf([
            'name: Yaya',
            'context: A short description.',
            'greeting: Hello there.',
            'personality: P',
            'scenario: S',
            'description: D',
            'first_mes: F',
            'mes_example: E',
            'char_name: C',
            'char_persona: CP',
            'spec_version: "2.0"',
            'data: {name: Other}',
            'tags: [t]',
            '',
        ].join('\n'))
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject({ name: 'Yaya', desc: 'A short description.', firstMessage: 'Hello there.', personality: '', scenario: '', exampleMessage: '', tags: [] })
    })

    test('description and first_mes do not stand in for context and greeting', async () => {
        const out = await yamlOf('name: Yaya\ndescription: D\nfirst_mes: F\n')
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject({ name: 'Yaya', desc: '', firstMessage: '' })
    })

    test('a UTF-8 byte order mark before the YAML is accepted', async () => {
        const out = await yamlOf('\uFEFF' + VALID)
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject(expected)
    })

    test('a date-like name stays the text that was written', async () => {
        const out = await yamlOf('name: 2024-01-01\n')
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject({ name: '2024-01-01' })
    })
})

// ---------------------------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------------------------

describe('a YAML file that is no card (reproducers)', () => {
    test.each([
        ['no name', 'context: C\ngreeting: G\n'],
        ['a blank name', 'name: "  "\ncontext: C\n'],
        ['a top-level list', '- name: N\n- name: M\n'],
        ['a top-level scalar', 'just text\n'],
        ['an empty file', ''],
        ['a numeric name', 'name: 123\n'],
    ])('%s is refused with noData and nothing is added', async (_, text) => {
        const out = await yamlOf(text)
        expect(out).toEqual(noData)
        expectNothingSaved()
    })
})

describe('a YAML file the parser rejects (reproducers)', () => {
    //Each fixture has a valid name, so reading a partial document would import it and the test would fail by assertion.
    const aliases = 'name: N\nitems: &a [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]\n' + Array.from({ length: 101 }, (_, i) => `k${i}: *a\n`).join('')

    test.each([
        ['an unclosed flow mapping', 'name: N\nextra: {a: 1\n'],
        ['two documents', 'name: N\n---\nname: M\n'],
        ['more aliases than the limit allows', aliases],
    ])('%s ends failed and nothing is added', async (_, text) => {
        const out = await yamlOf(text)
        expect(out.kind).toBe('failed')
        expectNothingSaved()
    })
})

// ---------------------------------------------------------------------------------------------
// Guards: behaviour that is the same before and after
// ---------------------------------------------------------------------------------------------

describe('guards', () => {
    test('a text file is refused as not a card file (guard)', async () => {
        expect(await importCharacterFile({ name: 'notes.txt', data: utf8(VALID) })).toEqual(notCardFile)
        expectNothingSaved()
    })

    test('a v1 json card imports as before (guard)', async () => {
        const out = await importCharacterFile({ name: 'card.json', data: utf8(JSON.stringify({ name: 'Old', description: 'd', first_mes: 'hi' })) })
        expect(out.kind).toBe('imported')
        expect(imported()).toMatchObject({ name: 'Old', desc: 'd', firstMessage: 'hi' })
    })

    test('a file named yaml with no dot is not a YAML card (guard)', async () => {
        expect(await importCharacterFile({ name: 'yaml', data: utf8(VALID) })).toEqual(notCardFile)
        expectNothingSaved()
    })
})
