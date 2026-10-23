// @vitest-environment happy-dom

/**
 * `CharConfig.svelte`'s "Reset SupaMemory data" buttons (character and group
 * panels) ask for confirmation first: No leaves the chat's SupaMemory data and
 * covered ID untouched, Yes clears both. The cleared chat is the one that was
 * on screen when the button was pressed, even if the chat page changes while
 * the confirmation is open.
 *
 * Mounts the real `CharConfig.svelte` against a real `$state` database; its
 * heavy imports and child lists are stubbed. The alert confirm is a mock.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const alertConfirmMock = vi.hoisted(() => vi.fn(async (_msg: string) => true))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        CharEmotion: writable({}),
        selectedCharID: writable(-1),
        MobileGUI: writable(false),
        CharConfigSubMenu: writable(2),
        hypaV3ModalOpen: writable(false),
        disableHighlight: writable(true),
        popUpEditorStore: writable(null),
        selIdState: { selId: 0 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(),
    saveImage: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/tokenizer'), () => ({
    tokenizeAccurate: vi.fn(async () => 0),
}) as unknown as typeof import('src/ts/tokenizer'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertConfirm: alertConfirmMock,
    showHypaV2Alert: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/characters'), () => ({
    addCharEmotion: vi.fn(),
    addingEmotion: writable(false),
    getCharImage: vi.fn(async () => ''),
    rmCharEmotion: vi.fn(),
    selectCharImg: vi.fn(),
    makeGroupImage: vi.fn(),
    removeChar: vi.fn(),
    changeCharImage: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/util'), () => ({
    findCharacterbyId: vi.fn(),
    getAuthorNoteDefaultText: vi.fn(() => ''),
    selectMultipleFile: vi.fn(),
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
    parseMultilangString: vi.fn(() => ({ xx: '' })),
    encodeMultilangString: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/memory/busyActions'), () => ({
    beginBusy: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/busyActions'))

vi.mock(import('src/ts/characterCards'), () => ({
    exportChar: vi.fn(),
    openRealmUpload: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/process/tts'), () => ({
    fetchFishSpeechModels: vi.fn(),
    getElevenTTSVoices: vi.fn(),
    getWebSpeechTTSVoices: vi.fn(),
    getVOICEVOXVoices: vi.fn(),
    oaiVoices: [],
    getNovelAIVoices: vi.fn(),
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/process/ttsDefaults'), () => ({
    createFishSpeechDefaults: vi.fn(),
    createNovelAIVoiceDefaults: vi.fn(),
}) as unknown as typeof import('src/ts/process/ttsDefaults'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getFileSrc: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/process/group'), () => ({
    addGroupChar: vi.fn(),
    rmCharFromGroup: vi.fn(),
}) as unknown as typeof import('src/ts/process/group'))

vi.mock(import('src/ts/process/inlayScreen'), () => ({
    updateInlayScreen: vi.fn(),
}) as unknown as typeof import('src/ts/process/inlayScreen'))

vi.mock(import('src/ts/process/transformers'), () => ({
    registerOnnxModel: vi.fn(),
}) as unknown as typeof import('src/ts/process/transformers'))

vi.mock(import('src/ts/process/modules'), () => ({
    applyModule: vi.fn(),
    getModuleAssets: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/scripts'), () => ({
    exportRegex: vi.fn(),
    importRegex: vi.fn(),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

vi.mock('src/lib/SideBars/Toggles.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('src/lib/SideBars/LoreBook/LoreBookSetting.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('src/lib/SideBars/Scripts/RegexList.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('src/lib/SideBars/Scripts/TriggerList.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('src/lib/Others/Help.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))

//#endregion

import { flushSync, mount, unmount } from 'svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import CharConfig from 'src/lib/SideBars/CharConfig.svelte'
import { language } from 'src/lang'

type CharacterFixture = Database['characters'][number]

const SEEDED = 'a summary longer than four characters'

function installWorld(type: 'character' | 'group'): void {
    const chats = [0, 1].map((n) => ({
        id: `chat-${n}`,
        name: `Chat ${n}`,
        message: [],
        localLore: [],
        fmIndex: -1,
        scriptstate: {},
        supaMemoryData: SEEDED,
        supaMemoryCoveredId: `covered-${n}`,
    }))
    const character = {
        chaId: 'char-0',
        name: 'char-0',
        type,
        chatPage: 0,
        firstMessage: '',
        alternateGreetings: [],
        desc: '',
        personality: '',
        scenario: '',
        additionalData: { creator: '', character_version: '' },
        depth_prompt: { depth: 0, prompt: '' },
        bias: [],
        utilityBot: false,
        inlayViewScreen: false,
        reloadKeys: 0,
        supaMemory: false,
        triggerscript: [],
        customscript: [],
        globalLore: [],
        emotionImages: [],
        additionalAssets: [],
        characters: [],
        chats,
    } as unknown as CharacterFixture
    DBState.db = {
        characters: [character],
        modules: [],
        plugins: [],
        supaModelType: 'none',
        hypav2: false,
        hypaV3: false,
        ttsAutoSpeech: false,
    } as unknown as Database
    selectedCharID.set(0)
}

function chatAt(index: number) {
    return DBState.db.characters[0].chats[index]
}

let mounted: { instance: Record<string, unknown>, target: HTMLElement } | undefined

function mountConfig(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(CharConfig, { target, props: {} }) as unknown as Record<string, unknown>
    mounted = { instance, target }
    flushSync()
    return target
}

function resetButton(target: HTMLElement): HTMLElement {
    const found = Array.from(target.querySelectorAll<HTMLElement>('button'))
        .find((b) => b.textContent?.trim() === language.resetSupaMemory)
    if (!found) {
        throw new Error('reset SupaMemory button not rendered')
    }
    return found
}

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        flushSync()
        await new Promise<void>((res) => setTimeout(res, 0))
    }
}

beforeEach(() => {
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
})

afterEach(async () => {
    if (mounted) {
        await unmount(mounted.instance as never).catch(() => {})
        mounted.target.remove()
        mounted = undefined
    }
    document.body.replaceChildren()
    selectedCharID.set(-1)
})

describe.each(['character', 'group'] as const)('reset SupaMemory button of a %s', (type) => {
    test('regression reproducer: No leaves the SupaMemory data and covered ID untouched', async () => {
        installWorld(type)
        alertConfirmMock.mockImplementation(async () => false)
        const target = mountConfig()
        resetButton(target).click()
        await settle()
        expect(alertConfirmMock).toHaveBeenCalledTimes(1)
        expect(alertConfirmMock).toHaveBeenCalledWith(language.resetSupaMemoryConfirm)
        expect(chatAt(0).supaMemoryData).toBe(SEEDED)
        expect(chatAt(0).supaMemoryCoveredId).toBe('covered-0')
    })

    test('regression reproducer: Yes, after one confirm, clears the data and the covered ID of the chat on screen only', async () => {
        installWorld(type)
        const target = mountConfig()
        resetButton(target).click()
        await settle()
        expect(alertConfirmMock).toHaveBeenCalledTimes(1)
        expect(chatAt(0).supaMemoryData).toBe('')
        expect(chatAt(0).supaMemoryCoveredId).toBeUndefined()
        expect(chatAt(1).supaMemoryData).toBe(SEEDED)
        expect(chatAt(1).supaMemoryCoveredId).toBe('covered-1')
    })

    test('guard: a chat page change while the confirm is open does not redirect the clear', async () => {
        installWorld(type)
        let answer: (v: boolean) => void = () => {}
        alertConfirmMock.mockImplementation(() => new Promise<boolean>((res) => { answer = res }))
        const target = mountConfig()
        resetButton(target).click()
        await settle()
        DBState.db.characters[0].chatPage = 1
        answer(true)
        await settle()
        expect(chatAt(0).supaMemoryData).toBe('')
        expect(chatAt(1).supaMemoryData).toBe(SEEDED)
    })
})
