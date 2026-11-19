// @vitest-environment jsdom

/**
 * Accessible names of the sub-menu tab icons of the REAL `CharConfig.svelte`. Each icon-only tab
 * carries the name of the page it opens (the page heading's key, or Speech for the TTS page, whose
 * heading is an untranslated literal), its glyph is hidden from the accessibility tree, and only the
 * active tab reports `aria-current`. A group shows no TTS, Scripts or Share tab, and its page's
 * icon-only add-character button is named.
 *
 * The mock set is that of `CharConfig.studioEntry.svelte.test.ts`.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
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

import { CharConfigSubMenu, DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import CharConfig from './CharConfig.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

const subMenu = CharConfigSubMenu as ReturnType<typeof writable<number>>

function install(type: 'character' | 'group'): void {
    const base = {
        chaId: 'char-a',
        name: 'Alpha',
        type,
        license: '',
        chatPage: 0,
        chats: [{ id: 'chat-a', message: [], scriptstate: {}, note: '' }],
        emotionImages: [],
        additionalAssets: [],
        alternateGreetings: [],
        desc: '',
        firstMessage: '',
        customModuleToggle: '',
        bias: [],
        personality: '',
        scenario: '',
        additionalData: { creator: '', character_version: '' },
        nickname: '',
        depth_prompt: { depth: 0, prompt: '' },
    }
    const character = type === 'group' ? { ...base, characters: [], characterTalks: [], characterActive: [] } : base
    DBState.db = { characters: [character], personas: [], modules: [] } as never
}

async function show(type: 'character' | 'group'): Promise<HTMLElement> {
    install(type)
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(CharConfig, { target, props: { studioEntry: false } }))
    flushSync()
    await tick()
    flushSync()
    return target
}

/** The tab row: the buttons whose only content is an icon, before the first page's content. */
function tabs(target: HTMLElement): HTMLButtonElement[] {
    const row = target.querySelector<HTMLElement>('div.flex.mb-2')
    expect(row).not.toBeNull()
    return Array.from(row!.querySelectorAll<HTMLButtonElement>(':scope > button'))
}

beforeEach(() => {
    subMenu.set(0)
})

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never)
    }
    for (const target of mountedTargets.splice(0)) {
        target.remove()
    }
    subMenu.set(0)
})

describe('CharConfig sub-menu tab names', () => {
    test('a character has seven named tabs, in order, with hidden glyphs', async () => {
        const buttons = tabs(await show('character'))
        expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
            language.basicInfo,
            language.characterDisplay,
            language.loreBook,
            language.Speech,
            language.scripts,
            language.advancedSettings,
            language.shareExport,
        ])
        for (const button of buttons) {
            expect(button.getAttribute('aria-label')?.trim()).toBeTruthy()
            expect(button.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
        }
    })

    test('a group has the four tabs it shows, named', async () => {
        const buttons = tabs(await show('group'))
        expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
            language.basicInfo,
            language.characterDisplay,
            language.loreBook,
            language.advancedSettings,
        ])
    })

    test('the group page names its icon-only add-character button', async () => {
        const target = await show('group')
        const add = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.getAttribute('aria-label') === language.addCharacter)
        expect(add).toBeDefined()
        expect(add!.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    })

    test('only the active tab reports aria-current, and it follows a click', async () => {
        const target = await show('character')
        const current = () => tabs(target).filter((b) => b.getAttribute('aria-current') === 'true').map((b) => b.getAttribute('aria-label'))
        expect(current()).toEqual([language.basicInfo])
        tabs(target).find((b) => b.getAttribute('aria-label') === language.loreBook)!.click()
        flushSync()
        await tick()
        flushSync()
        expect(current()).toEqual([language.loreBook])
    })
})
