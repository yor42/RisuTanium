// @vitest-environment jsdom

/**
 * The Studio row of the REAL `CharConfig.svelte`: shown at the top only while Studio is eligible and the
 * host has not turned it off with `studioEntry={false}`. The mock set is that of
 * `CharConfig.preview.svelte.test.ts`, plus the stores the Studio entry reads.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    const selection = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selection,
        CharConfigSubMenu: writable(0),
        MobileGUI: writable(false),
        selectedCharID: writable(0),
        hypaV3ModalOpen: writable(false),
        disableHighlight: writable(true),
        popUpEditorStore: writable(null),
        settingsOpen: writable(false),
        SettingsMenuIndex: writable(-1),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/tokenizer'), () => ({
    tokenizeAccurate: vi.fn(async () => 0),
}) as unknown as typeof import('src/ts/tokenizer'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(() => null),
    saveImage: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/characters'), () => ({
    addCharEmotion: vi.fn(),
    addingEmotion: writable(false),
    getCharImage: vi.fn(() => ''),
    rmCharEmotion: vi.fn(),
    selectCharImg: vi.fn(),
    makeGroupImage: vi.fn(),
    removeChar: vi.fn(),
    changeCharImage: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(),
    alertError: vi.fn(),
    showHypaV2Alert: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    findCharacterbyId: vi.fn(() => null),
    getAuthorNoteDefaultText: vi.fn(() => ''),
    selectMultipleFile: vi.fn(),
    selectSingleFile: vi.fn(),
    selectMultipleFileObjects: vi.fn(),
    selectSingleFileObject: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characterCards'), () => ({
    exportChar: vi.fn(),
    openRealmUpload: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/process/tts'), () => ({
    getElevenTTSVoices: vi.fn(async () => []),
    getWebSpeechTTSVoices: vi.fn(() => []),
    getVOICEVOXVoices: vi.fn(async () => []),
    getNovelAIVoices: vi.fn(() => []),
    fetchFishSpeechModels: vi.fn(async () => []),
    oaiVoices: [],
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getFileSrc: vi.fn(async (path: string) => 'src:' + path),
    saveAssetFromBlob: vi.fn(async () => 'assets/saved'),
    pickedAssetLimitBytes: vi.fn(async () => 1024 * 1024),
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
    getModuleLorebooks: vi.fn(() => []),
    getModules: vi.fn(() => []),
    getModuleToggles: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/scripts'), () => ({
    exportRegex: vi.fn(),
    importRegex: vi.fn(),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

vi.mock('./LoreBook/LoreBookSetting.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('./Scripts/RegexList.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('./Scripts/TriggerList.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('./Toggles.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('./BarIcon.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('../Others/Help.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('../UI/GUI/MultiLangInput.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))

//#endregion

import { CharConfigSubMenu, DBState, MobileGUI } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import CharConfig from './CharConfig.svelte'
import { resetStudioScreenForTests, studioScreen } from '../../ts/studio/studioScreen.svelte'
import { setStudioEnabled } from '../../ts/studio/studioSwitch.svelte'
import { studioOpen } from '../../ts/studio/studioOpen'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function install(): void {
    const character = {
        chaId: 'char-a',
        name: 'Alpha',
        type: 'character',
        license: '',
        chatPage: 0,
        chats: [{ id: 'chat-a', message: [], scriptstate: {}, note: '' }],
        emotionImages: [],
        additionalAssets: [],
        alternateGreetings: [],
        desc: '',
        firstMessage: '',
        customModuleToggle: 'a=A',
        bias: [],
        personality: '',
        scenario: '',
        additionalData: { creator: '', character_version: '' },
        nickname: '',
        depth_prompt: { depth: 0, prompt: '' },
    }
    DBState.db = { characters: [character], personas: [], modules: [] } as never
}

async function show(props: { studioEntry?: boolean } = {}): Promise<HTMLElement> {
    install()
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(CharConfig, { target, props }))
    flushSync()
    await tick()
    flushSync()
    return target
}

const entry = (target: HTMLElement) => target.querySelector<HTMLElement>('[data-part="studio-entry"]')

beforeEach(() => {
    localStorage.clear()
    resetStudioScreenForTests()
    ;(MobileGUI as ReturnType<typeof writable<boolean>>).set(false)
    setStudioEnabled(true)
})

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never)
    }
    for (const target of mountedTargets.splice(0)) {
        target.remove()
    }
    resetStudioScreenForTests()
    setStudioEnabled(false)
    localStorage.clear()
})

describe('2n the Studio row of the classic character settings', () => {
    test('with the switch on and the classic layout, the row is the first thing in the settings', async () => {
        const target = await show()
        const row = entry(target)
        expect(row).not.toBeNull()
        expect(target.firstElementChild).toBe(row)
    })

    test('the row opens the selected character in Studio from the chat', async () => {
        const target = await show()
        entry(target)?.click()
        flushSync()
        expect(get(studioOpen)).toBe(true)
        expect(studioScreen.target).toEqual({ owner: { type: 'character', id: 'char-a' }, from: 'chat' })
        expect(studioScreen.opener?.element).toBe(entry(target))
    })

    test('a host that passes studioEntry={false} shows no row', async () => {
        const target = await show({ studioEntry: false })
        expect(entry(target)).toBeNull()
    })

    test('with the switch off there is no row', async () => {
        setStudioEnabled(false)
        const target = await show()
        expect(entry(target)).toBeNull()
    })
})

const toggleLink = (target: HTMLElement) => target.querySelector<HTMLButtonElement>('[data-part="studio-toggle-link"]')

// The toggle definition field is on the advanced page of the settings.
const ADVANCED_PAGE = 2

function onAdvancedPage(): void {
    beforeEach(() => {
        ;(CharConfigSubMenu as ReturnType<typeof writable<number>>).set(ADVANCED_PAGE)
    })
    afterEach(() => {
        ;(CharConfigSubMenu as ReturnType<typeof writable<number>>).set(0)
    })
}

describe('GL-2 the Edit in Studio link beside the toggle definition', () => {
    onAdvancedPage()
    test('sits between the field label and its textarea and opens the character toggles', async () => {
        const target = await show()
        const link = toggleLink(target)
        expect(link).not.toBeNull()
        expect(link!.previousElementSibling?.textContent).toContain(language.customPromptTemplateToggle)
        const field = Array.from(target.querySelectorAll('textarea')).find((area) => area.value === 'a=A')
        expect(field).toBeDefined()
        expect(link!.compareDocumentPosition(field!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        link!.click()
        flushSync()
        expect(get(studioOpen)).toBe(true)
        expect(studioScreen.target).toEqual({ owner: { type: 'character', id: 'char-a' }, kind: 'toggles', from: 'chat' })
        expect(studioScreen.opener?.element).toBe(link)
    })

    test('is there with studioEntry={false}, which hides only the top row', async () => {
        const target = await show({ studioEntry: false })
        expect(entry(target)).toBeNull()
        expect(toggleLink(target)).not.toBeNull()
    })

    test('is absent while Studio is off or under the Beta Mobile GUI', async () => {
        setStudioEnabled(false)
        expect(toggleLink(await show())).toBeNull()
        setStudioEnabled(true)
        ;(MobileGUI as ReturnType<typeof writable<boolean>>).set(true)
        expect(toggleLink(await show())).toBeNull()
    })
})

describe('GL-5 the classic toggle textarea keeps its binding', () => {
    onAdvancedPage()
    test('typing writes the character field', async () => {
        const target = await show()
        const field = Array.from(target.querySelectorAll('textarea')).find((area) => area.value === 'a=A')
        expect(field).toBeDefined()
        field!.value = 'b=B'
        field!.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        expect((DBState.db as { characters: { customModuleToggle: string }[] }).characters[0].customModuleToggle).toBe('b=B')
    })
})

describe('2p CharConfig under the Beta Mobile GUI', () => {
    test('with the Beta Mobile GUI on and the switch on there is no row', async () => {
        ;(MobileGUI as ReturnType<typeof writable<boolean>>).set(true)
        const target = await show()
        expect(entry(target)).toBeNull()
    })
})
