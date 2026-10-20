// @vitest-environment happy-dom

/**
 * A card imported on a store2 page is pushed live, not as a stub: the import never reaches the
 * legacy archive engine, even when the archive gates would otherwise let it run (the session noted as
 * capable, `archiveCharacters` on). On a legacy page the same import still goes straight to the
 * archive.
 *
 * The real `characterCards.ts`, `characters.ts` and the real archive engine run over a reactive
 * `DBState`; the engine's entry `archiveCharacterNow` is a call-through spy, and the unit store is a
 * map. A pass here says nothing about the real IndexedDB, Tauri or Node stores.
 *
 * Labels: the store2 test is a regression reproducer (it fails on the base, where only
 * `canBootArchive()` stands between a store2 import and the archive); the legacy test is a
 * compatibility guard that passes before and after.
 */
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database, character } from 'src/ts/storage/database.svelte'
import type { Residency } from 'src/ts/storage/store2/residency'

//#region module mocks

const h = vi.hoisted(() => ({
    units: new Map<string, unknown>(),
    uuid: 0,
    /** The `chaId` of every unit written. */
    writes: [] as string[],
    archiveCharacterNow: vi.fn(),
}))

vi.mock('uuid', () => ({
    v4: () => `uuid-${++h.uuid}`,
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(async () => new Uint8Array()),
    BaseDirectory: { AppData: 0 },
}))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
}))

vi.mock(import('src/ts/upstreamAgreement'), () => ({
    askUpstreamAgreement: vi.fn(async () => true),
    isUpstreamAccepted: vi.fn(() => true),
    publishUpstreamAccepted: vi.fn(),
}) as unknown as typeof import('src/ts/upstreamAgreement'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = { db: {} as unknown as Database }
    return {
        DBState: state,
        selectedCharID: writable(-1),
        CharEmotion: writable({}),
        MobileGUIStack: writable([]),
        OpenRealmStore: writable(null),
        SettingsMenuIndex: writable(0),
        ShowRealmFrameStore: writable(false),
        settingsOpen: writable(false),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { AppendableBuffer } = await import('src/ts/byteBuffer')
    return {
        AppendableBuffer,
        afterNextSaveCommit: vi.fn(),
        getPeerSaveCount: () => 0,
        getSaveMarkCount: () => 0,
        isSaveClean: () => false,
        BlankWriter: class {},
        LocalWriter: class {},
        VirtualWriter: class {},
        changeChatTo: vi.fn(),
        checkCharOrder: vi.fn(),
        downloadFile: vi.fn(async () => {}),
        getFileSrc: vi.fn(),
        requiresFullEncoderReload: { state: false },
        forageStorage: {
            keys: vi.fn(async () => []),
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
        },
        loadAsset: vi.fn(async () => new Uint8Array()),
        openURL: vi.fn(),
        readImage: vi.fn(async (d: unknown) => d),
        saveAsset: vi.fn(async () => 'asset'),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertAddCharacter: vi.fn(),
    alertCardExport: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState: liveDBState } = await import('src/ts/stores.svelte')
    return {
        getDatabase: vi.fn(() => liveDBState.db),
        setDatabase: vi.fn((db: Database) => { liveDBState.db = db }),
        setDatabaseLite: vi.fn(),
        importPreset: vi.fn(),
        presetTemplate: { name: 'test-preset' },
        saveImage: vi.fn(),
        appVer: 'test',
        defaultSdDataFunc: vi.fn(() => ({})),
        getCharacterByIndex: vi.fn((index: number) => liveDBState.db.characters?.[index]),
        setCharacterByIndex: vi.fn((index: number, char: unknown) => {
            liveDBState.db.characters[index] = char as never
        }),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    findCharacterbyId: vi.fn(),
    findCharacterIndexbyId: vi.fn(() => -1),
    getUserName: vi.fn(() => 'User'),
    isKnownUri: vi.fn(() => false),
    selectFileByDom: vi.fn(async () => null),
    selectMultipleFile: vi.fn(),
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'png'),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/process/inlayScreen'), () => ({
    updateInlayScreen: vi.fn((cha: unknown) => cha),
}) as unknown as typeof import('src/ts/process/inlayScreen'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    parseMarkdownSafe: vi.fn(),
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/translator/translator'), () => ({
    translateHTML: vi.fn(),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/pngChunk'), () => ({
    PngChunk: class {},
}) as unknown as typeof import('src/ts/pngChunk'))

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

vi.mock(import('src/ts/process/chatOrigin'), () => ({
    isWriting: () => false,
}) as unknown as typeof import('src/ts/process/chatOrigin'))

vi.mock(import('src/ts/media/avatarThumb'), () => ({
    getAvatarThumbSrc: vi.fn(),
    isThumbEligible: vi.fn(() => false),
}) as unknown as typeof import('src/ts/media/avatarThumb'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    setColdStorageItem: async (key: string, value: unknown) => {
        h.units.set(key, JSON.parse(JSON.stringify(value)))
        return true
    },
    writeColdStorageUnit: async (key: string, value: { character: { chaId: string } }) => {
        h.writes.push(value.character.chaId)
        h.units.set(key, JSON.parse(JSON.stringify(value)))
        return 'written'
    },
    readColdStorageItem: async (key: string) => {
        const unit = h.units.get(key)
        return unit === undefined ? { status: 'missing' } : { status: 'ok', value: JSON.parse(JSON.stringify(unit)) }
    },
    getColdStorageItem: async (key: string) => {
        const unit = h.units.get(key)
        return unit === undefined ? null : JSON.parse(JSON.stringify(unit))
    },
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/process/coldCharacterArchive'), async (importOriginal) => {
    const actual = await importOriginal()
    h.archiveCharacterNow.mockImplementation(actual.archiveCharacterNow)
    return { ...actual, archiveCharacterNow: h.archiveCharacterNow } as unknown as typeof import('src/ts/process/coldCharacterArchive')
})

//#endregion

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { importCharacterProcess } from 'src/ts/characterCards'
import { resetRetainedForTest } from 'src/ts/process/coldRetained'
import { noteBootArchiveSession, resetBootArchiveStateForTest } from 'src/ts/process/memory/bootArchiveState'
import { resetRestoredBytesForTest } from 'src/ts/process/memory/restoredBytes'
import { resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { resetPutBackForTest } from 'src/ts/process/memory/characterPutBack'
import { registerResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'

const v2Card = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: { name: 'Two', description: 'd', personality: 'p', scenario: 's', first_mes: 'hi', mes_example: '', creator_notes: 'n', system_prompt: '', post_history_instructions: 'after', alternate_greetings: ['a'], tags: ['x'], creator: 'me', character_version: '1', extensions: { risuai: {} } },
}

const jsonData = (card: unknown) => new TextEncoder().encode(JSON.stringify(card))

function installDb(): void {
    DBState.db = {
        formatversion: 5,
        archiveCharacters: true,
        plugins: [],
        characters: [],
        modules: [],
        statics: { imports: 0 },
        goCharacterOnImport: false,
    } as unknown as Database
}

const slot = (index: number): character => DBState.db.characters[index] as unknown as character

beforeEach(() => {
    h.units.clear()
    h.uuid = 0
    h.writes.length = 0
    h.archiveCharacterNow.mockClear()
    resetPutBackForTest()
    resetRetainedForTest()
    resetRestoredBytesForTest()
    resetCharacterSaveMarksForTest()
    resetBootArchiveStateForTest()
    resetResidencyForTest()
    // Every archive gate but the page's own is open.
    noteBootArchiveSession(true)
    selectedCharID.set(-1)
    installDb()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    resetResidencyForTest()
    vi.restoreAllMocks()
})

describe('a card imported with the archive requested', () => {
    test('on a store2 page it is pushed live, not as a stub, and never reaches the archive engine', async () => {
        registerResidency({} as unknown as Residency)

        const index = await importCharacterProcess({ name: 'card.json', data: jsonData(v2Card), archive: true }) as number

        expect(index).toBe(0)
        expect(DBState.db.characters).toHaveLength(1)
        expect(slot(index).name).toBe('Two')
        expect(slot(index).coldstorage).toBeUndefined()
        expect(h.archiveCharacterNow).not.toHaveBeenCalled()
        expect(h.writes).toEqual([])
        expect(h.units.size).toBe(0)
    })

    // Compatibility guard: passes before and after; it also proves the gates above are open, so the store2 test
    // above is stopped by the page and by nothing else.
    test('on a legacy page it goes straight to the archive', async () => {
        const index = await importCharacterProcess({ name: 'card.json', data: jsonData(v2Card), archive: true }) as number

        expect(typeof slot(index).coldstorage).toBe('string')
        expect(h.archiveCharacterNow).toHaveBeenCalledTimes(1)
        expect(h.writes).toHaveLength(1)
    })
})
