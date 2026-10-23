// @vitest-environment happy-dom

/**
 * Lorebook keys in exported cards. A regex-mode entry's comma inside
 * `/pattern/flags` survives the CCv2 and CCv3 card writers and a re-import
 * (`/dragon{1,2}/` is not rewritten to `/dragon{1, 2}/`); a non-regex entry is
 * still split on every comma. CCv3 is read from the exported `createBaseV3`;
 * CCv2 (`createBaseV2`, not exported) from the JSON `exportCharacterCard`
 * hands to `downloadFile`.
 *
 * Mock scaffold copied from `characterCards.onboarding.test.ts`.
 *
 * Titles beginning "regression reproducer:" fail against writers that split
 * the key text on every comma; titles beginning "guard:" pass before and after.
 */

import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach } from 'vitest'

const downloaded = vi.hoisted(() => ({ downloadFile: vi.fn(async (_name: string, _data: Uint8Array) => {}) }))

//#region module mocks -- copied from characterCards.onboarding.test.ts

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/alert'), () => ({
    alertCardExport: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

const testDb = vi.hoisted(() => ({ db: { characters: [] as unknown[] } as unknown as Record<string, unknown> }))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    defaultSdDataFunc: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    importPreset: vi.fn(),
    setCurrentCharacter: vi.fn(),
    getCurrentCharacter: vi.fn(),
    getDatabase: vi.fn(() => testDb.db),
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

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    BlankWriter: class { async init() {} async write() {} },
    LocalWriter: class {},
    VirtualWriter: class {},
    checkCharOrder: vi.fn(),
    downloadFile: downloaded.downloadFile,
    forageStorage: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
    loadAsset: vi.fn(async () => new Uint8Array()),
    openURL: vi.fn(),
    readImage: vi.fn(async (d: unknown) => d),
    saveAsset: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'png'),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: testDb,
    SettingsMenuIndex: writable(0),
    ShowRealmFrameStore: writable(false),
    selectedCharID: writable(-1),
    settingsOpen: writable(false),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/pngChunk'), () => ({
    PngChunk: class {},
}) as unknown as typeof import('src/ts/pngChunk'))

vi.mock(import('src/ts/process/processzip'), () => ({
    CharXImporter: class {},
    CharXWriter: class {},
}) as unknown as typeof import('src/ts/process/processzip'))

vi.mock(import('src/ts/process/modules'), () => ({
    exportModuleLegacy: vi.fn(),
    readModule: vi.fn(),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: vi.fn(async () => new Uint8Array()),
}))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
}))

//#endregion

import { createBaseV3, exportCharacterCard, importCharacterProcess } from 'src/ts/characterCards'
import type { character } from 'src/ts/storage/database.svelte'

type Book = { key: string, secondkey: string, selective: boolean, useRegex: boolean }
type CardEntry = { keys: string[], secondary_keys?: string[] }

function cardWith(spec: 'chara_card_v2' | 'chara_card_v3', entries: CardEntry[]) {
    return {
        spec,
        spec_version: spec === 'chara_card_v3' ? '3.0' : '2.0',
        data: {
            name: 'Lore Character',
            first_mes: 'Hello',
            description: 'A card',
            personality: '',
            scenario: '',
            mes_example: '',
            creator_notes: '',
            system_prompt: '',
            post_history_instructions: '',
            alternate_greetings: [],
            character_version: '',
            creator: '',
            tags: [],
            group_only_greetings: [],
            character_book: {
                extensions: {},
                entries: entries.map((e, i) => ({
                    ...e, content: 'c', extensions: {}, enabled: true, insertion_order: 100 + i,
                    constant: false, selective: e.secondary_keys !== undefined, name: `e${i}`, comment: `e${i}`,
                    case_sensitive: false, use_regex: true,
                })),
            },
            extensions: { risuai: {} },
        },
    }
}

async function importCard(card: unknown): Promise<character> {
    testDb.db = { characters: [] as unknown[] } as unknown as Record<string, unknown>
    await importCharacterProcess({ name: 'card.json', data: new TextEncoder().encode(JSON.stringify(card)) })
    const characters = testDb.db.characters as character[]
    expect(characters).toHaveLength(1)
    return characters[0]
}

/** Imports a card whose one entry carries the given key text, then forces the lore flags under test. */
async function charWith(book: Book): Promise<character> {
    const char = await importCard(cardWith('chara_card_v3', [{ keys: ['seed'] }]))
    Object.assign(char.globalLore[0], book)
    return char
}

async function exportedV2Entry(char: character): Promise<CardEntry> {
    downloaded.downloadFile.mockClear()
    char.image = 'portrait'
    expect(await exportCharacterCard(char, 'json', { spec: 'v2' })).toBe(true)
    const card = JSON.parse(Buffer.from(downloaded.downloadFile.mock.calls[0][1]).toString('utf-8'))
    return card.data.character_book.entries[0]
}

const regexBook = (key: string, over: Partial<Book> = {}): Book => ({ key, secondkey: '', selective: false, useRegex: true, ...over })

beforeEach(() => {
    testDb.db = { characters: [] as unknown[] } as unknown as Record<string, unknown>
})

describe('characterCards.ts -- lorebook keys in exported cards', () => {
    test('regression reproducer: a CCv3 export keeps a comma inside a regex key', async () => {
        const char = await charWith(regexBook('/dragon{1,2}/, wolf'))
        expect(createBaseV3(char).data.character_book.entries[0].keys).toEqual(['/dragon{1,2}/', 'wolf'])
    })

    test('regression reproducer: a CCv2 export keeps a comma inside a regex key', async () => {
        const char = await charWith(regexBook('/dragon{1,2}/, wolf'))
        expect((await exportedV2Entry(char)).keys).toEqual(['/dragon{1,2}/', 'wolf'])
    })

    test('regression reproducer: secondary keys keep a comma inside a regex key in both specs', async () => {
        const char = await charWith(regexBook('/a/', { selective: true, secondkey: '/wol{1,2}f/,x' }))
        expect(createBaseV3(char).data.character_book.entries[0].secondary_keys).toEqual(['/wol{1,2}f/', 'x'])
        expect((await exportedV2Entry(char)).secondary_keys).toEqual(['/wol{1,2}f/', 'x'])
    })

    test('regression reproducer: a comma regex key survives export and re-import in both specs', async () => {
        const char = await charWith(regexBook('/dragon{1,2}/,wolf'))
        const v3 = await importCard(JSON.parse(JSON.stringify(createBaseV3(char))))
        expect(v3.globalLore[0].key).toBe('/dragon{1,2}/, wolf')
        const v2Entry = await exportedV2Entry(char)
        const v2 = await importCard(cardWith('chara_card_v2', [{ keys: v2Entry.keys }]))
        expect(v2.globalLore[0].key).toBe('/dragon{1,2}/, wolf')
    })

    test('guard: a non-regex entry is still split on every comma in both specs', async () => {
        const char = await charWith(regexBook('/a,b/, c', { useRegex: false }))
        expect(createBaseV3(char).data.character_book.entries[0].keys).toEqual(['/a', 'b/', 'c'])
        expect((await exportedV2Entry(char)).keys).toEqual(['/a', 'b/', 'c'])
    })
})
