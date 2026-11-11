// @vitest-environment jsdom

/**
 * The launch order with the real pick path: `startLaunchNavigation` and the real restore over the real
 * `changeChar` (through `changeCharOrAlert`), `restoreColdCharacter`, `readAt` and `openChatOf`. The unit read
 * of an archived character is a deferred promise the test settles, so a tap can arrive while the restore
 * waits (L4), and an unreadable unit shows what a refused target does (L10).
 *
 * Fixtures are built like the real producer: the stub comes from `buildColdStub(full, key, [])` and the unit
 * value is `{ character: coldUnitCharacter(full) }`; a failed read has the producer's `{ status: 'error', error }`.
 */

import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database, character } from 'src/ts/storage/database.svelte'

//#region module mocks

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
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const selection = $state({ selId: -1 })
    // The selection store can drop its subscribers, so a recorder armed by an earlier test cannot answer a
    // later test's selection; its `set` keeps the reactive mirror (`selIdState`) current.
    const subscribers = new Set<(next: number) => void>()
    const permanent = new Set<(next: number) => void>()
    let sealed = false
    let selected = -1
    const selectedCharID = {
        subscribe(run: (next: number) => void): () => void {
            subscribers.add(run)
            run(selected)
            return () => { subscribers.delete(run) }
        },
        set(next: number): void {
            selected = next
            selection.selId = next
            for (const run of [...subscribers]) {
                run(next)
            }
        },
        update(change: (current: number) => number): void {
            selectedCharID.set(change(selected))
        },
        /** The first call keeps the subscribers the app's own modules added at load; later calls drop the rest. */
        dropSubscribers(): void {
            if (!sealed) {
                sealed = true
                for (const run of subscribers) {
                    permanent.add(run)
                }
                return
            }
            for (const run of [...subscribers]) {
                if (!permanent.has(run)) {
                    subscribers.delete(run)
                }
            }
        },
    }
    return {
        DBState: state,
        selIdState: selection,
        selectedCharID,
        CharEmotion: writable({}),
        MobileGUIStack: writable([]),
        OpenRealmStore: writable(false),
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        DynamicGUI: writable(false),
        sideBarStore: writable(false),
        ShowRealmFrameStore: writable(''),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({} as Record<number, number>),
        CharConfigSubMenu: writable(0),
        SettingsMenuIndex: writable(-1),
        botMakerMode: writable(false),
        PlaygroundStore: writable(0),
        CustomGUISettingMenuStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})

const changeChatToMock = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    changeChatTo: changeChatToMock,
    checkCharOrder: vi.fn(),
    downloadFile: vi.fn(),
    getFileSrc: vi.fn(),
    requiresFullEncoderReload: { state: false },
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
    afterNextSaveCommit: vi.fn(),
    isSaveClean: () => false,
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertAddCharacter: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
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
        presetTemplate: { name: 'test-preset' },
        saveImage: vi.fn(),
        defaultSdDataFunc: vi.fn(() => ({})),
        getCharacterByIndex: vi.fn((index: number) => liveDBState.db.characters?.[index]),
        setCharacterByIndex: vi.fn((index: number, char: unknown) => {
            liveDBState.db.characters[index] = char as never
        }),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    findCharacterbyId: vi.fn(),
    findCharacterIndexbyId: vi.fn(() => -1),
    getUserName: vi.fn(() => 'User'),
    selectMultipleFile: vi.fn(),
    selectSingleFile: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/media'), () => ({
    getImageType: vi.fn(),
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

vi.mock(import('src/ts/characterCards'), () => ({
    importCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/pngChunk'), () => ({
    PngChunk: class {},
}) as unknown as typeof import('src/ts/pngChunk'))

const readSpy = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    readColdStorageItem: readSpy,
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/media/avatarThumb'), () => ({
    getAvatarThumbSrc: vi.fn(),
    isThumbEligible: vi.fn(() => false),
}) as unknown as typeof import('src/ts/media/avatarThumb'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

vi.mock(import('src/ts/chatShell/shellSwitch.svelte'), () => ({
    shellEligible: () => false,
}) as unknown as typeof import('src/ts/chatShell/shellSwitch.svelte'))

vi.mock(import('src/ts/caughtErrors'), () => ({
    recordCaughtError: vi.fn(),
}) as unknown as typeof import('src/ts/caughtErrors'))

//#endregion

import { flushSync } from 'svelte'
import { DBState, selectedCharID, settingsOpen, OpenRealmStore, PlaygroundStore, CustomGUISettingMenuStore, botMakerMode } from 'src/ts/stores.svelte'
import { alertError } from 'src/ts/alert'
import { buildColdStub, coldUnitCharacter } from 'src/ts/process/coldCharacter'
import { resetRetainedForTest } from 'src/ts/process/coldRetained'
import { resetChatOnScreenForTests } from 'src/ts/process/chatOnScreen.svelte'
import { studioOpen } from 'src/ts/studio/studioOpen'
import { utilityOpen } from 'src/lib/Utility/utilityGate'
import { showHomeLanding } from 'src/lib/UI/Home/homeView.svelte'
import { LAST_CHARACTER_KEY, writeLastChaId } from 'src/ts/lastCharacterMemory'
import { installLaunchTarget, resetLaunchTargetForTests, startLaunchNavigation } from './launchTarget'

//#region fixtures

const LONG_AGO = 1000

/** A full character as the unit holds it: `scenario` is omitted, so `characterFormatUpdate` has something to fill. */
function fullCharacter(chaId: string, extra: Record<string, unknown> = {}): character {
    return {
        type: 'character',
        name: `${chaId} name`,
        image: `${chaId}.png`,
        chaId,
        chatPage: 0,
        firstMsgIndex: 0,
        creatorNotes: '',
        lastInteraction: LONG_AGO,
        desc: `${chaId} description`,
        globalLore: [],
        newGenData: true,
        chats: [
            { id: `${chaId}-chat`, message: [{ role: 'user', data: 'Hi', time: 1 }], note: '', name: 'Chat 1', localLore: [] },
            { id: `${chaId}-chat2`, message: [{ role: 'user', data: 'Hi', time: 1 }], note: '', name: 'Chat 2', localLore: [] },
        ],
        ...extra,
    } as unknown as character
}

const slot = (index: number): character => DBState.db.characters[index] as unknown as character

/** Slot 0 is warm (Y), slot 1 an archived character (alpha). */
let alphaFull: character

function installArchive(): void {
    alphaFull = fullCharacter('alpha')
    DBState.db = {
        didFirstSetup: true,
        characters: [
            fullCharacter('zero', { scenario: '' }),
            buildColdStub(alphaFull, 'unit-alpha', []),
        ],
    } as unknown as Database
}

interface PendingRead {
    resolve: (result: unknown) => void
    settled: boolean
}

let reads: PendingRead[] = []

function holdReads(): void {
    reads = []
    readSpy.mockImplementation(() => new Promise((resolve) => {
        reads.push({ resolve, settled: false })
    }))
}

function drain(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Settles the pending unit read with `result` and lets everything that follows run. */
async function settleRead(result: unknown): Promise<void> {
    const read = reads.find((candidate) => !candidate.settled)
    expect(read, 'the unit read is pending').toBeDefined()
    read!.settled = true
    read!.resolve(result)
    await drain()
}

const landAlpha = (): Promise<void> => settleRead({ status: 'ok', value: { character: coldUnitCharacter(alphaFull) } })

function resetSurfaces(): void {
    settingsOpen.set(false)
    studioOpen.set(false)
    utilityOpen.set(false)
    OpenRealmStore.set(false)
    PlaygroundStore.set(0)
    CustomGUISettingMenuStore.set(false)
    botMakerMode.set(false)
    selectedCharID.set(-1)
    showHomeLanding()
    flushSync()
}

/** The host answers the page's request with `value`, as `MainActivity` does. */
function installHostAnswering(value: unknown): void {
    installLaunchTarget({ requestOpenTarget: () => { window.__risuTaniumLaunchTarget?.(value) } })
}

beforeEach(() => {
    ;(selectedCharID as unknown as { dropSubscribers(): void }).dropSubscribers()
    readSpy.mockReset()
    changeChatToMock.mockReset()
    vi.mocked(alertError).mockClear()
    resetLaunchTargetForTests()
    resetRetainedForTest()
    resetChatOnScreenForTests()
    localStorage.clear()
    resetSurfaces()
    installArchive()
    holdReads()
})

afterEach(() => {
    resetLaunchTargetForTests()
    resetSurfaces()
    resetRetainedForTest()
    resetChatOnScreenForTests()
    localStorage.clear()
})

//#endregion

describe('a tap and the last-character restore, through the real changeChar', () => {
    test('L4: a warm tap during a pending restore wins: the target opens, the restore ends superseded, the target is remembered', async () => {
        writeLastChaId('alpha')
        installHostAnswering(null)
        await startLaunchNavigation()
        await drain()
        expect(get(selectedCharID)).toBe(-1)

        window.__risuTaniumLaunchTarget?.({ chaId: 'zero', chatId: 'zero-chat2' })
        await drain()
        expect(get(selectedCharID)).toBe(0)
        expect(changeChatToMock).toHaveBeenCalledTimes(1)
        expect(changeChatToMock).toHaveBeenCalledWith(1)

        await landAlpha()

        expect(get(selectedCharID)).toBe(0)
        expect(localStorage.getItem(LAST_CHARACTER_KEY)).toBe('{"chaId":"zero"}')
        expect(slot(0).chats[1].id).toBe('zero-chat2')
        expect(alertError).not.toHaveBeenCalled()
    })

    test('L4: a cold tap on a warm target opens the chat and the restore of the remembered character never starts', async () => {
        writeLastChaId('alpha')
        installHostAnswering({ chaId: 'zero', chatId: 'zero-chat2' })

        await startLaunchNavigation()
        await drain()

        expect(readSpy).not.toHaveBeenCalled()
        expect(get(selectedCharID)).toBe(0)
        expect(changeChatToMock).toHaveBeenCalledWith(1)
        expect(localStorage.getItem(LAST_CHARACTER_KEY)).toBe('{"chaId":"zero"}')
    })

    test('L10: a cold tap on an archived target whose unit cannot be read shows the alert once, stays on Home and runs no restore', async () => {
        writeLastChaId('zero')
        const error = vi.spyOn(console, 'error').mockImplementation(() => { })
        installHostAnswering({ chaId: 'alpha', chatId: 'alpha-chat' })

        await startLaunchNavigation()
        await drain()
        expect(readSpy).toHaveBeenCalledTimes(1)
        await settleRead({ status: 'error', error: new Error('unit unreadable') })

        expect(alertError).toHaveBeenCalledTimes(1)
        expect(get(selectedCharID)).toBe(-1)
        expect(localStorage.getItem(LAST_CHARACTER_KEY)).toBe('{"chaId":"zero"}')
        expect(changeChatToMock).not.toHaveBeenCalled()
        expect(readSpy).toHaveBeenCalledTimes(1)
        error.mockRestore()
    })

    test('MC-1375: a cold target for a character that is gone runs the restore of the remembered one', async () => {
        writeLastChaId('zero')
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { })
        installHostAnswering({ chaId: 'nobody', chatId: 'nobody-chat' })

        await startLaunchNavigation()

        expect(get(selectedCharID)).toBe(0)
        expect(alertError).not.toHaveBeenCalled()
        expect(changeChatToMock).not.toHaveBeenCalled()
        warn.mockRestore()
    })
})
