/**
 * The real `importCharacter` (`characterCards.ts`) through the real `addCharacter` (`characters.ts`): an import that was
 * sent to the background never moves the selection when it ends (MC-2483), and one that stayed in front selects the slot
 * it added.
 *
 * Neither `src/ts/characters` nor `src/ts/characterCards` is mocked, so the report that `importCharacter` fills and
 * `addCharacter` reads is the one the application uses. The leaf mocks are those of `characterCards.picker.test.ts` and
 * `characters.addCharacter.svelte.test.ts`; the toast presenter is a fake and the picker answers `alertAddCharacter`.
 *
 * Labels: (RR) fails on the tree before the wiring; (CG) compatibility guard that holds before and after.
 */
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fflate from 'fflate'
import type { Database, character } from './storage/database.svelte'

const h = vi.hoisted(() => ({
    /** the files the picker hands over */
    picked: null as File[] | null,
    uuid: 0,
    /** called inside every asset save, while the card is running */
    probe: null as null | (() => void),
}))

//#region module mocks

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

vi.mock(import('src/ts/upstreamAgreement'), () => ({
    askUpstreamAgreement: vi.fn(async () => true),
    isUpstreamAccepted: vi.fn(() => true),
    publishUpstreamAccepted: vi.fn(),
}) as unknown as typeof import('src/ts/upstreamAgreement'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    SeekMode: { Start: 0, Current: 1, End: 2 },
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        CharEmotion: writable({}),
        MobileGUIStack: writable([]),
        OpenRealmStore: writable(null),
        alertStore: writable({ type: 'none', msg: '' }),
        HideIconStore: { set: vi.fn() },
        moduleBackgroundEmbedding: { set: vi.fn() },
        ReloadGUIPointer: writable(0),
        SettingsMenuIndex: { set: vi.fn() },
        ShowRealmFrameStore: { set: vi.fn() },
        settingsOpen: { set: vi.fn() },
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
        loadAsset: vi.fn(async () => new Uint8Array()),
        openURL: vi.fn(),
        readImage: vi.fn(async (d: unknown) => d),
        requiresFullEncoderReload: { state: false },
        forageStorage: {
            keys: vi.fn(async () => []),
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
        },
        saveAsset: vi.fn(async (data: Uint8Array) => {
            h.probe?.()
            return `asset-${data[0]}-${data.length}`
        }),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertAddCharacter: vi.fn(),
    alertCardExport: vi.fn(),
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertMd: vi.fn(),
    alertModuleSelect: vi.fn(),
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
        presetTemplate: { name: 'test-preset' },
        saveImage: vi.fn(),
        importPreset: vi.fn(),
        setCurrentCharacter: vi.fn(),
        getCurrentCharacter: vi.fn(),
        getCurrentChat: vi.fn(),
        defaultSdDataFunc: vi.fn(() => ({})),
        getCharacterByIndex: vi.fn((index: number) => liveDBState.db.characters?.[index]),
        setCharacterByIndex: vi.fn((index: number, char: unknown) => {
            liveDBState.db.characters[index] = char as never
        }),
        appVer: 'test',
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

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
        findCharacterbyId: vi.fn(),
        findCharacterIndexbyId: vi.fn(() => -1),
        getUserName: vi.fn(() => 'User'),
        isKnownUri: vi.fn(() => false),
        selectFileByDom: vi.fn(async () => h.picked),
        selectMultipleFile: vi.fn(),
        selectSingleFile: vi.fn(async () => null),
        sleep: vi.fn(async () => {}),
    } as unknown as typeof import('src/ts/util')
})

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

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    readColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/media/avatarThumb'), () => ({
    getAvatarThumbSrc: vi.fn(),
    isThumbEligible: vi.fn(() => false),
}) as unknown as typeof import('src/ts/media/avatarThumb'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

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

//#endregion

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { alertAddCharacter } from 'src/ts/alert'
import { addCharacter } from './characters'
import {
    answerTask,
    backgroundTask,
    resetTaskHostForTests,
    setTaskToastPresenter,
    taskResultShowing,
    type TaskToastPresenter,
} from 'src/ts/alertTask.svelte'
import { answerImportCard } from 'src/ts/process/tests/answerImportCard'

//#region fixtures

const LONG_AGO = 1000
const enc = new TextEncoder()

function liveSlot(): character {
    return {
        type: 'character',
        name: 'live',
        image: 'live.png',
        chaId: 'live',
        chatPage: 0,
        firstMsgIndex: 0,
        creatorNotes: '',
        lastInteraction: LONG_AGO,
        desc: 'live description',
        globalLore: [],
        newGenData: true,
        chats: [{ id: 'live-chat', message: [{ role: 'user', data: 'Hi', time: 1 }], note: '', name: 'Chat 1', localLore: [] }],
    } as unknown as character
}

function charxWithAsset(name: string): File {
    const card = JSON.stringify({
        spec: 'chara_card_v3',
        spec_version: '3.0',
        data: {
            name, description: 'd', first_mes: 'hi', character_version: '1',
            extensions: { risuai: {} },
            assets: [{ type: 'x-risu-asset', uri: 'embeded://assets/a0.bin', name: 'a0', ext: 'bin' }],
        },
    })
    const files: fflate.Zippable = {
        'card.json': [enc.encode(card), { level: 0 }],
        'assets/a0.bin': [new Uint8Array(64).fill(1), { level: 0 }],
    }
    return new File([new Uint8Array(fflate.zipSync(files))], `${name}.charx`, { type: 'application/zip' })
}

let ends: { open(): void, end(): void }[] = []

function installPresenter(): void {
    ends = []
    const presenter: TaskToastPresenter = {
        post: (_view, on) => { ends.push(on); return ends.length },
        update: () => { },
        end: () => { },
    }
    setTaskToastPresenter(presenter)
}

const slotAt = (index: number): character => DBState.db.characters[index] as unknown as character
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
    h.picked = null
    h.uuid = 0
    h.probe = null
    DBState.db = { characters: [liveSlot()], statics: { imports: 0 }, modules: [], goCharacterOnImport: false } as unknown as Database
    selectedCharID.set(0)
    vi.mocked(alertAddCharacter).mockReset()
    vi.mocked(alertAddCharacter).mockResolvedValue('importCharacter')
    installPresenter()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
    h.probe = null
    resetTaskHostForTests()
    vi.restoreAllMocks()
})

//#endregion

describe('the selection after an import started from the Add button', () => {
    test('R4-32 (RR): an import sent to the background leaves the selection and the slot untouched when it ends', async () => {
        h.picked = [charxWithAsset('Away')]
        let pressed = false
        h.probe = () => { if (!pressed) pressed = backgroundTask() }
        const done = addCharacter()
        let finished = false
        void done.then(() => { finished = true })
        for (let i = 0; i < 400 && !finished; i++) {
            ends[0]?.end()
            if (!pressed && taskResultShowing()) answerTask({ kind: 'ok' })
            await settle()
        }
        await done
        await settle()
        expect(pressed).toBe(true)
        expect(DBState.db.characters.length).toBe(2)
        expect(get(selectedCharID)).toBe(0)
        expect(slotAt(0).lastInteraction).toBe(LONG_AGO)
    })

    test('R4-32 (CG): an import that stays in front selects the slot it added', async () => {
        h.picked = [charxWithAsset('Front')]
        await answerImportCard(() => addCharacter())
        await settle()
        expect(DBState.db.characters.length).toBe(2)
        expect(get(selectedCharID)).toBe(1)
    })
})
