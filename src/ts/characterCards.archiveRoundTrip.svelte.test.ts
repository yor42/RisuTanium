// @vitest-environment happy-dom

/**
 * A card imported straight to the archive, then opened: the unit the import wrote must already hold what the first
 * open would add, or the character would look changed to the put-back and stay in memory.
 *
 * The real `characterCards.ts`, `characters.ts` (`changeChar`, `characterFormatUpdate`), the real archive engine,
 * `coldCharacterRestore`, `coldRetained` and a reactive `DBState` built with `$state` run together. The unit store
 * is a map. A pass here says nothing about the real IndexedDB, Tauri or Node stores.
 *
 * Labels: "new behaviour" fails on the base, where an import writes no unit and leaves no retained record, and
 * additionally fails at its clean-after-open assertion when the import's format step is removed;
 * "diagnostic" establishes a mechanism; "guard" passes with or without the change.
 */
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database, character } from 'src/ts/storage/database.svelte'

//#region module mocks

const h = vi.hoisted(() => ({
    units: new Map<string, unknown>(),
    /** while set, the import's own object-mode format step does nothing */
    skipImportFormat: false,
    uuid: 0,
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
    const state = $state({ db: {} as unknown as Database })
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

vi.mock(import('src/ts/media/avatarThumb'), () => ({
    getAvatarThumbSrc: vi.fn(),
    isThumbEligible: vi.fn(() => false),
}) as unknown as typeof import('src/ts/media/avatarThumb'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    setColdStorageItem: async (key: string, value: unknown) => {
        h.units.set(key, JSON.parse(JSON.stringify(value)))
        return true
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

/** The import's own format step is the object-mode call; `changeChar` calls the real one inside its module. */
vi.mock(import('src/ts/characters'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        characterFormatUpdate: (arg: number | character, options?: { updateInteraction?: boolean }) => {
            if (typeof arg !== 'number' && h.skipImportFormat) {
                return arg
            }
            return actual.characterFormatUpdate(arg, options)
        },
    } as unknown as typeof import('src/ts/characters')
})

//#endregion

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { importCharacterProcess } from 'src/ts/characterCards'
import { changeChar, characterFormatUpdate } from 'src/ts/characters'
import { contentFingerprint, resetRetainedForTest, retainedRecordOf } from 'src/ts/process/coldRetained'
import { noteBootArchiveSession, resetIdleReloadBootStateForTest } from 'src/ts/process/memory/idleReloadBootState'
import { resetRestoredBytesForTest } from 'src/ts/process/memory/restoredBytes'
import { resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'

const enc = new TextEncoder()

const v2Card = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: { name: 'Two', description: 'd', personality: 'p', scenario: 's', first_mes: 'hi', mes_example: '', creator_notes: 'n', system_prompt: '', post_history_instructions: 'after', alternate_greetings: ['a'], tags: ['x'], creator: 'me', character_version: '1', extensions: { risuai: {} } },
}

const v3Card = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: { name: 'Three', description: 'd', first_mes: 'hi', character_version: '1', extensions: { risuai: {} }, assets: [], tags: ['y'], creator: 'me' },
}

const tavernCard = { name: 'Tav', description: 'd', first_mes: 'hi' }

const cards: Array<[string, unknown]> = [
    ['a V2 card', v2Card],
    ['a V3 card', v3Card],
    ['a tavern card', tavernCard],
]

const jsonData = (card: unknown) => enc.encode(JSON.stringify(card))

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

/** Imports `card` as `archive` says, opens it as the user would, and reports whether the put-back would call it unchanged. */
async function importAndOpen(card: unknown, archive: boolean): Promise<{ index: number, cleanAfterOpen: boolean, wasStub: boolean }> {
    const index = await importCharacterProcess({ name: 'card.json', data: jsonData(card), archive }) as number
    const wasStub = typeof slot(index).coldstorage === 'string'
    await changeChar(index)
    const opened = slot(index)
    const record = retainedRecordOf(opened)
    return { index, wasStub, cleanAfterOpen: !!record && contentFingerprint(opened) === record.fp }
}

beforeEach(() => {
    h.units.clear()
    h.skipImportFormat = false
    h.uuid = 0
    resetRetainedForTest()
    resetRestoredBytesForTest()
    resetCharacterSaveMarksForTest()
    resetIdleReloadBootStateForTest()
    noteBootArchiveSession(true)
    selectedCharID.set(-1)
    installDb()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('an imported card opened for the first time', () => {
    test.each(cards)('new behaviour: %s imported to the archive is unchanged by its first open', async (_name, card) => {
        const { index, wasStub, cleanAfterOpen } = await importAndOpen(card, true)

        expect(wasStub).toBe(true)
        expect(h.units.size).toBe(1)
        expect(get(selectedCharID)).toBe(index)
        expect(cleanAfterOpen).toBe(true)
    })

    //Control for the test above: a unit built without the format step is dirty on first open, which is why the import formats.
    test('diagnostic: a unit written without the import\'s format step is changed by the first open (V2 and tavern)', async () => {
        h.skipImportFormat = true

        const v2 = await importAndOpen(v2Card, true)
        expect(v2.wasStub).toBe(true)
        expect(v2.cleanAfterOpen).toBe(false)

        installDb()
        h.units.clear()
        resetRetainedForTest()
        const tavern = await importAndOpen(tavernCard, true)
        expect(tavern.wasStub).toBe(true)
        expect(tavern.cleanAfterOpen).toBe(false)
    })

    test('guard: an archived import restores the card the live import would have produced, apart from the volatile fields', async () => {
        const archived = await importAndOpen(v2Card, true)
        const archivedChar = JSON.parse(JSON.stringify(slot(archived.index))) as Record<string, unknown>

        installDb()
        h.units.clear()
        resetRetainedForTest()
        noteBootArchiveSession(false)
        const live = await importAndOpen(v2Card, false)
        const liveChar = JSON.parse(JSON.stringify(slot(live.index))) as Record<string, unknown>

        for (const volatile of ['lastInteraction', 'trashTime', 'creation_date', 'chaId', 'chats']) {
            delete archivedChar[volatile]
            delete liveChar[volatile]
        }
        expect(live.wasStub).toBe(false)
        expect(archivedChar).toEqual(liveChar)
    })
})

describe('the format step', () => {
    test.each(cards)('diagnostic: formatting %s twice gives the content of formatting it once', async (_name, card) => {
        noteBootArchiveSession(false)
        const index = await importCharacterProcess({ name: 'card.json', data: jsonData(card) }) as number
        const char = slot(index)

        characterFormatUpdate(char)
        const once = contentFingerprint(char)
        characterFormatUpdate(char)

        expect(contentFingerprint(char)).toBe(once)
    })
})
