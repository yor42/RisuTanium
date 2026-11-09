// @vitest-environment happy-dom

/**
 * The TTS tab of the REAL `CharConfig.svelte` under Svelte's async scheduler: block effects
 * run before the component's `$effect.pre`s, so a mode form that binds to its config must
 * stay out of the markup until those effects have created the config.
 *
 * The app ships the sync scheduler; this file switches the async one on for itself through
 * the public `svelte/internal/flags/async` export (vitest isolates module state per file;
 * `beforeAll` enables it before the first mount), so it pins the `ttsConfigReady` gates
 * against a later flag change. The character is as `characterFormatUpdate` leaves it:
 * `ttsMode` empty, VOICEVOX and Huggingface defaults present, no other TTS config.
 *
 * Every module `CharConfig.svelte` imports and every child component other than the form
 * inputs is a fake, as in `CharConfig.ttsLabels.svelte.test.ts`; nothing reaches the network.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selIdState: { selId: 0 },
        CharConfigSubMenu: writable(5),
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
    fetchFishSpeechModels: vi.fn(async () => []),
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

// A static import is rejected by the Svelte compiler in a .svelte.test.ts file; the flag is
// read at runtime, so enabling it before the first mount is enough.
beforeAll(async () => {
    await import('svelte/internal/flags/async')
})

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** A character as `characterFormatUpdate` leaves it: no novelai, gptsovits, fishspeech or openai config. */
function installFormatUpdated(): void {
    DBState.db = {
        characters: [{
            chaId: 'char-a',
            name: 'Alpha',
            type: 'character',
            ttsMode: '',
            ttsSpeech: '',
            chatPage: 0,
            chats: [{ id: 'chat-a', message: [], scriptstate: {} }],
            vits: null,
            oaiVoice: 'alloy',
            bias: [],
            personality: '',
            scenario: '',
            additionalData: {},
            depth_prompt: { depth: 0, prompt: '' },
            alternateGreetings: [],
            voicevoxConfig: { SPEED_SCALE: 1, PITCH_SCALE: 0, INTONATION_SCALE: 1, VOLUME_SCALE: 1, speaker: '[{"id":1,"name":"Normal"}]' },
            hfTTS: { model: '', language: 'en' },
            additionalAssets: [],
            emotionImages: [],
        }],
        personas: [],
        modules: [],
    } as never
}

async function mountAndSettle(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(CharConfig, { target, props: {} }))
    flushSync()
    await sleep(20)
    flushSync()
    return target
}

/** Switches the mode as the select does and lets the effects and the next pass run. */
async function switchMode(mode: string): Promise<void> {
    const chara = DBState.db.characters as unknown as Array<{ ttsMode: string }>
    chara[0].ttsMode = mode
    expect(() => flushSync(), `the first flush after switching to ${mode}`).not.toThrow()
    await sleep(20)
    expect(() => flushSync(), `the second flush after switching to ${mode}`).not.toThrow()
}

function labelTexts(root: HTMLElement): string[] {
    return [...root.querySelectorAll('span')].map((el) => el.textContent?.trim() ?? '')
}

beforeEach(() => {
    window.innerWidth = 1024
    CharConfigSubMenu.set(5)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    // The Web Speech form reads the browser global, which happy-dom does not define.
    vi.stubGlobal('speechSynthesis', {})
})

afterEach(async () => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
})

interface ConfigCase {
    mode: string
    configKey: string
    firstLabel: string
}

const GATED: ConfigCase[] = [
    { mode: 'novelai', configKey: 'naittsConfig', firstLabel: language.sidebarUi.ttsCustomVoiceSeed },
    { mode: 'openai', configKey: 'oaiTTSConfig', firstLabel: language.sidebarUi.ttsAdvancedEndpoint },
    { mode: 'gptsovits', configKey: 'gptSoVitsConfig', firstLabel: language.sidebarUi.ttsVolume },
    { mode: 'fishspeech', configKey: 'fishSpeechConfig', firstLabel: 'Chunk Length' },
]

describe('the TTS tab under the async scheduler', () => {
    test.each(GATED)('regression reproducer: switching to $mode creates its config and renders its form without throwing', async (c) => {
        installFormatUpdated()
        const root = await mountAndSettle()
        const chara = DBState.db.characters as unknown as Array<Record<string, unknown>>
        expect(chara[0][c.configKey], 'the config does not exist before the switch').toBeUndefined()

        await switchMode(c.mode)

        expect(chara[0][c.configKey], `the ${c.configKey} created by the mode's effect`).toBeDefined()
        expect(labelTexts(root), `the ${c.mode} form's first label`).toContain(c.firstLabel)
    })

    const UNGATED: Array<{ mode: string, label: () => string[] }> = [
        { mode: 'VOICEVOX', label: () => [language.sidebarUi.ttsSpeaker] },
        { mode: 'huggingface', label: () => [language.model] },
        { mode: 'webspeech', label: () => [language.Speech] },
        { mode: 'elevenlab', label: () => [language.ttsElevenLabsKeyHint] },
    ]

    test.each(UNGATED)('compatibility guard: switching to $mode renders its form without the gate', async (c) => {
        installFormatUpdated()
        const root = await mountAndSettle()

        await switchMode(c.mode)

        const texts = labelTexts(root)
        expect(c.label().some((label) => texts.includes(label)), `a ${c.mode} label among ${JSON.stringify(c.label())}`).toBe(true)
    })
})
