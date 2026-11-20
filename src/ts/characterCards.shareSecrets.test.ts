// @vitest-environment happy-dom

/**
 * `createBaseV3` builds the v3 card exports (png, json, charx; the v2 builder is a whitelist checked by inspection); it copies a
 * whitelist of character fields, so no credential-scope entry of
 * `SECRET_FIELDS` may reach a card. The character comes from a real import and
 * then holds a registry-driven sentinel at every character-scope credential
 * path. No `characterCards.ts` change is needed; this guards the whitelist.
 *
 * Mock scaffold copied from `characterCards.onboarding.test.ts`.
 *
 * Titles beginning "guard:" pin behaviour that is the same before and after.
 */

import { writable } from 'svelte/store'
import { describe, test, expect, vi } from 'vitest'

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
import type { character } from 'src/ts/storage/database.svelte'
import { missingSentinels, sentinelObject, sentinelsIn } from 'src/ts/storage/tests/shareStripFixture'

const card = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
        name: 'Share Character',
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
        extensions: { risuai: {} },
    },
}

async function importedCharacter(): Promise<character> {
    testDb.db = { characters: [] as unknown[] } as unknown as Record<string, unknown>
    await importCharacterProcess({ name: 'card.json', data: new TextEncoder().encode(JSON.stringify(card)) })
    const characters = testDb.db.characters as character[]
    expect(characters).toHaveLength(1)
    return characters[0]
}

describe('card export carries no character-scope credential', () => {
    test('G10 guard: createBaseV3 of a character holding every character credential writes none of them', async () => {
        const char = await importedCharacter()
        const { object, leaves } = sentinelObject('character')
        Object.assign(char, object)
        expect(missingSentinels(char, leaves)).toEqual([])

        const exported = JSON.parse(JSON.stringify(createBaseV3(char))) as object

        expect(sentinelsIn(exported, leaves)).toEqual([])
    })
})
