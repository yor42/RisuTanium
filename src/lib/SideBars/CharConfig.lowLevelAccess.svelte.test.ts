// @vitest-environment happy-dom

/**
 * The optional-flag checkboxes of the REAL `CharConfig.svelte`: the advanced tab and the flags on the other tabs.
 *
 * Invariants pinned here:
 *  - showing the tab on a character that lacks an optional flag leaves the character object
 *    without that key, so nothing marks it changed;
 *  - an absent flag displays unchecked;
 *  - toggling a flag writes true, then false.
 *
 * Dirtiness is asserted through the object shape (no key added, value unchanged), not through
 * the change-tracking effects, which this harness does not mount.
 *
 * Most service modules and the heavy child components are fakes; the form inputs, icons,
 * `lang`, `warnOnReject`, `busyActions` and `ttsDefaults` are real.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selIdState: { selId: 0 },
        CharConfigSubMenu: writable(2),
        MobileGUI: writable(false),
        selectedCharID: writable(0),
        hypaV3ModalOpen: writable(false),
        disableHighlight: writable(true),
        popUpEditorStore: writable(null),
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
    showHypaV2Alert: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    findCharacterbyId: vi.fn(() => null),
    getAuthorNoteDefaultText: vi.fn(() => ''),
    selectMultipleFile: vi.fn(),
    selectSingleFile: vi.fn(),
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
    oaiVoices: [],
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getFileSrc: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/process/group'), () => ({
    addGroupChar: vi.fn(),
    rmCharFromGroup: vi.fn(),
}) as unknown as typeof import('src/ts/process/group'))

vi.mock(import('src/ts/process/inlayScreen'), () => ({
    updateInlayScreen: vi.fn((c: unknown) => c),
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

type Patch = Record<string, unknown>

function install(type: 'character' | 'group', patch: Patch = {}): void {
    DBState.db = {
        characters: [{
            chaId: 'char-a',
            name: 'Alpha',
            type,
            chatPage: 0,
            chats: [{ id: 'chat-a', message: [], scriptstate: {} }],
            characters: [],
            characterActive: [],
            characterTalks: [],
            bias: [],
            personality: '',
            scenario: '',
            additionalData: {},
            depth_prompt: { depth: 0, prompt: '' },
            alternateGreetings: [],
            customscript: [],
            triggerscript: [],
            additionalAssets: [],
            emotionImages: [],
            utilityBot: false,
            ...patch,
        }],
        personas: [],
        modules: [],
    } as never
}

async function mountConfig(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(CharConfig, { target, props: {} }))
    flushSync()
    await tick()
    flushSync()
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
    return target
}

function checkbox(root: HTMLElement, name: string): HTMLInputElement {
    const found = root.querySelector(`input[type="checkbox"][alt="${name}"]`)
    expect(found, `the checkbox named ${name}`).not.toBeNull()
    return found as HTMLInputElement
}

function currentCharacter(): Record<string, unknown> {
    return (DBState.db as unknown as { characters: Record<string, unknown>[] }).characters[0]
}

function toggle(box: HTMLInputElement): void {
    box.click()
    flushSync()
}

beforeEach(() => {
    window.innerWidth = 1024
    CharConfigSubMenu.set(2)
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
    vi.restoreAllMocks()
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
})

const OPTIONAL_FLAGS: Array<[string, () => string]> = [
    ['lowLevelAccess', () => language.lowLevelAccess],
    ['hideChatIcon', () => language.hideChatIcon],
    ['escapeOutput', () => language.escapeOutput],
]

describe('the advanced tab flag checkboxes on a character that lacks the flags', () => {
    test.each(OPTIONAL_FLAGS)('regression reproducer: showing the tab does not add %s to the character', async (key, label) => {
        install('character')

        const root = await mountConfig()

        expect(checkbox(root, label()).checked).toBe(false)
        expect(Object.keys(currentCharacter())).not.toContain(key)
    })

    test('regression reproducer: showing the group tab does not add lowLevelAccess to the group', async () => {
        CharConfigSubMenu.set(2)
        install('group')

        const root = await mountConfig()

        expect(checkbox(root, language.lowLevelAccess).checked).toBe(false)
        expect(Object.keys(currentCharacter())).not.toContain('lowLevelAccess')
    })

    test('guard: toggling lowLevelAccess on a group writes true and then false', async () => {
        install('group')

        const root = await mountConfig()
        const box = checkbox(root, language.lowLevelAccess)

        toggle(box)
        expect(currentCharacter().lowLevelAccess).toBe(true)
        expect(box.checked).toBe(true)

        toggle(box)
        expect(currentCharacter().lowLevelAccess).toBe(false)
        expect(box.checked).toBe(false)
    })

    test.each(OPTIONAL_FLAGS)('guard: toggling %s writes true and then false', async (key, label) => {
        install('character')

        const root = await mountConfig()
        const box = checkbox(root, label())

        toggle(box)
        expect(currentCharacter()[key]).toBe(true)
        expect(box.checked).toBe(true)

        toggle(box)
        expect(currentCharacter()[key]).toBe(false)
        expect(box.checked).toBe(false)
    })

    test('guard: a stored true displays checked and a stored false displays unchecked', async () => {
        install('character', { lowLevelAccess: true, hideChatIcon: false })

        const root = await mountConfig()

        expect(checkbox(root, language.lowLevelAccess).checked).toBe(true)
        expect(checkbox(root, language.hideChatIcon).checked).toBe(false)
        expect(currentCharacter().lowLevelAccess).toBe(true)
        expect(currentCharacter().hideChatIcon).toBe(false)
    })
})

//#region flags outside the advanced tab

function clickTab(root: HTMLElement, label: string): void {
    const span = [...root.querySelectorAll('span')].find((s) => s.textContent?.trim() === label)
    expect(span, `the tab labelled ${label}`).toBeDefined()
    ;(span!.closest('button') as HTMLButtonElement).click()
    flushSync()
}

async function mountOn(subMenu: number, tab?: string): Promise<HTMLElement> {
    CharConfigSubMenu.set(subMenu)
    const root = await mountConfig()
    if (tab !== undefined) {
        clickTab(root, tab)
        await tick()
        flushSync()
    }
    return root
}

interface FlagCase {
    name: string
    key: string
    label: () => string
    setup: () => void
    open: () => Promise<HTMLElement>
}

const withBeta = (): void => {
    ;(DBState.db as unknown as Record<string, unknown>).newImageHandlingBeta = true
}

const FLAG_CASES: FlagCase[] = [
    {
        name: 'largePortrait on the icon tab',
        key: 'largePortrait',
        label: () => language.largePortrait,
        setup: () => install('character', { image: 'icon.png' }),
        open: () => mountOn(1),
    },
    {
        name: 'inlayViewScreen on the emotion view screen',
        key: 'inlayViewScreen',
        label: () => language.inlayViewScreen,
        setup: () => install('character', { viewScreen: 'emotion', newGenData: { prompt: '', negative: '', instructions: '', emotionInstructions: '' } }),
        open: () => mountOn(1, language.viewScreen),
    },
    {
        name: 'inlayViewScreen on the image generation view screen',
        key: 'inlayViewScreen',
        label: () => language.inlayViewScreen,
        setup: () => install('character', { viewScreen: 'imggen', newGenData: { prompt: '', negative: '', instructions: '', emotionInstructions: '' } }),
        open: () => mountOn(1, language.viewScreen),
    },
    {
        name: 'prebuiltAssetCommand on the additional assets tab',
        key: 'prebuiltAssetCommand',
        label: () => language.insertAssetPrompt,
        setup: () => { install('character'); withBeta() },
        open: () => mountOn(1, language.additionalAssets),
    },
    {
        name: 'orderByOrder on a group',
        key: 'orderByOrder',
        label: () => language.orderByOrder,
        setup: () => install('group'),
        open: () => mountOn(0),
    },
    {
        name: 'ttsReadOnlyQuoted on the TTS tab',
        key: 'ttsReadOnlyQuoted',
        label: () => language.ttsReadOnlyQuoted,
        setup: () => install('character', { ttsMode: 'openai', ttsSpeech: '', oaiVoice: 'alloy', oaiTTSConfig: { enabled: true, format: 'mp3' } }),
        open: () => mountOn(5),
    },
]

describe('the optional flag checkboxes outside the advanced tab', () => {
    test.each(FLAG_CASES)('regression reproducer: showing $name does not add the key to the character', async (c) => {
        c.setup()

        const root = await c.open()

        expect(checkbox(root, c.label()).checked).toBe(false)
        expect(Object.keys(currentCharacter())).not.toContain(c.key)
    })

    test.each(FLAG_CASES)('guard: toggling $name writes true and then false', async (c) => {
        c.setup()

        const root = await c.open()
        const box = checkbox(root, c.label())

        toggle(box)
        expect(currentCharacter()[c.key]).toBe(true)
        expect(box.checked).toBe(true)

        toggle(box)
        expect(currentCharacter()[c.key]).toBe(false)
        expect(box.checked).toBe(false)
    })

    test('guard: an empty-string prebuiltAssetCommand stays an empty string and displays unchecked', async () => {
        install('character', { prebuiltAssetCommand: '' })
        withBeta()

        const root = await mountOn(1, language.additionalAssets)

        expect(checkbox(root, language.insertAssetPrompt).checked).toBe(false)
        expect(currentCharacter().prebuiltAssetCommand).toBe('')
    })
})

//#endregion
