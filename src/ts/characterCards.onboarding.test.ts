// @vitest-environment happy-dom

/**
 * `character.onboarding` travels in `data.extensions.risuai.onboarding` of a card: the import normalizes it, and
 * `createBaseV3` writes it back. Neither builder is reachable except through `importCharacterProcess` (import) and the
 * exported `createBaseV3` (export), so this drives those two seams with synthetic cards.
 *
 * Mock scaffold copied from `characterCards.newChatIdentity.test.ts`.
 *
 * Titles beginning "regression reproducer:" fail against a build whose import drops onboarding or whose export never
 * writes it; titles beginning "guard:" pin behaviour that is the same before and after.
 */

import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach } from 'vitest'

//#region module mocks -- copied from characterCards.newChatIdentity.test.ts

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
    BlankWriter: class {},
    LocalWriter: class {},
    VirtualWriter: class {},
    checkCharOrder: vi.fn(),
    downloadFile: vi.fn(async () => {}),
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

import { createBaseV3, importCharacterProcess } from 'src/ts/characterCards'
import type { character, CharacterOnboarding } from 'src/ts/storage/database.svelte'

function cardOf(spec: 'chara_card_v2' | 'chara_card_v3', risuai: Record<string, unknown>) {
    return {
        spec,
        spec_version: spec === 'chara_card_v3' ? '3.0' : '2.0',
        data: {
            name: 'Onboarding Character',
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
            extensions: { risuai },
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

/** The card JSON an export would write, as a reader sees it. */
function exportedRisuai(char: character): Record<string, unknown> {
    const card = JSON.parse(JSON.stringify(createBaseV3(char)))
    return card.data.extensions.risuai
}

const formOnboarding = {
    enabled: true,
    mode: 'form',
    title: 'Setup',
    description: 'Choose',
    html: '',
    floatingButton: true,
    questions: [
        {
            id: 'q-single',
            title: 'Genre',
            description: 'Pick one',
            type: 'single',
            varName: 'genre',
            required: true,
            placeholder: '',
            options: [{ label: 'Fantasy', value: 'fantasy' }, { label: 'Sci-fi', value: '' }],
        },
        {
            id: 'q-multiple',
            title: 'Themes',
            description: '',
            type: 'multiple',
            varName: 'themes',
            required: false,
            placeholder: '',
            options: [{ label: 'War', value: 'war' }, { label: 'Peace', value: 'peace' }],
        },
        {
            id: 'q-text',
            title: 'Name',
            description: '',
            type: 'text',
            varName: 'who',
            required: false,
            placeholder: 'Your name',
            options: [],
        },
    ],
} satisfies CharacterOnboarding

const htmlOnboarding = {
    enabled: true,
    mode: 'html',
    title: 'Intro',
    description: '',
    html: '<p>Welcome</p>',
    floatingButton: false,
    questions: [],
} satisfies CharacterOnboarding

beforeEach(() => {
    testDb.db = { characters: [] as unknown[] } as unknown as Record<string, unknown>
})

describe('characterCards.ts -- character onboarding in card extensions', () => {
    test('regression reproducer: a form onboarding with three question types is imported', async () => {
        const char = await importCard(cardOf('chara_card_v3', { onboarding: formOnboarding }))
        expect(char.onboarding).toEqual(formOnboarding)
    })

    test('regression reproducer: an html onboarding is imported from a CCv2 card', async () => {
        const char = await importCard(cardOf('chara_card_v2', { onboarding: htmlOnboarding }))
        expect(char.onboarding).toEqual(htmlOnboarding)
    })

    test('regression reproducer: malformed onboarding data is coerced on import', async () => {
        const char = await importCard(cardOf('chara_card_v3', {
            onboarding: {
                enabled: 'yes',
                mode: 'other',
                title: 4,
                questions: [{ id: 'q', type: 'weird', required: 1, options: [{ label: 'A' }, 'x'], extra: true }, null],
            },
        }))
        expect(char.onboarding).toEqual({
            enabled: false,
            mode: 'form',
            title: '',
            description: '',
            html: '',
            floatingButton: false,
            questions: [{
                id: 'q',
                title: '',
                description: '',
                type: 'single',
                varName: '',
                required: false,
                placeholder: '',
                options: [{ label: 'A', value: '' }],
            }],
        })
    })

    test.each([
        ['absent', {}],
        ['a non-object', { onboarding: 'form' }],
    ])('guard: an onboarding that is %s leaves the field undefined', async (_label, risuai) => {
        const char = await importCard(cardOf('chara_card_v3', risuai))
        expect(char.onboarding).toBeUndefined()
    })

    test('regression reproducer: export writes onboarding into extensions.risuai', async () => {
        const char = await importCard(cardOf('chara_card_v3', { onboarding: formOnboarding }))
        expect(exportedRisuai(char).onboarding).toEqual(formOnboarding)
    })

    test('guard: export of a character without onboarding writes no onboarding key', async () => {
        const char = await importCard(cardOf('chara_card_v3', {}))
        expect(Object.keys(exportedRisuai(char))).not.toContain('onboarding')
    })

    test.each([
        ['form', formOnboarding],
        ['html', htmlOnboarding],
    ])('regression reproducer: %s onboarding survives import, export, import unchanged', async (_label, onboarding) => {
        const first = await importCard(cardOf('chara_card_v3', { onboarding }))
        const exported = JSON.parse(JSON.stringify(createBaseV3(first)))
        const second = await importCard(exported)
        expect(second.onboarding).toEqual(first.onboarding)
        expect(second.onboarding).toEqual(onboarding)
    })
})
