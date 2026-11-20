// @vitest-environment jsdom

/**
 * Accessible names of the REAL `CharConfigPanel.svelte` (the body of `CharConfig.svelte`), character and
 * group branches, in every page and state the fixtures reach. In each mounted state no icon-only control,
 * text field, textarea or `role="textbox"` is unnamed (`unnamedControls(root, { fields: true })`), every
 * Lucide glyph is hidden, the toggles report `aria-pressed`, every field is named by its visible label
 * (Help excluded) or by the key its placeholder uses, and the red and green palette classes are gone.
 *
 * The mock set is that of `CharConfig.tabNames.svelte.test.ts`; the highlighter, size and hotkey modules are
 * those of `TextAreaInput.ime.svelte.test.ts`. The lorebook, regex, trigger and toggle child panels are stubs
 * (their own names are asserted in their own files); BarIcon, Help and the shared inputs are real. The
 * unnamed-control assertions exclude exactly the nodes named in `foreignUnnamed` (none are excluded today).
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
        ReloadGUIPointer: writable(0),
        alertStore: writable({ type: 'none', msg: '' }),
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
    alertMd: vi.fn(),
    showHypaV2Alert: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    findCharacterbyId: vi.fn((id: string) => ({ name: 'Member ' + id, image: '' })),
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
    getNovelAIVoices: vi.fn(async () => []),
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

vi.mock('src/ts/gui/guisize', () => ({
    textAreaSize: writable(0),
    textAreaTextSize: writable(1),
}))
vi.mock('src/ts/gui/highlight', () => ({
    highlighter: vi.fn(),
    getNewHighlightId: vi.fn(() => 1),
    removeHighlight: vi.fn(),
    AllCBS: ['random', 'randint'],
}))
vi.mock('src/ts/platform', () => ({ isMobile: false, isNodeServer: false, isTauri: false, isIOS: () => false }))
vi.mock('src/ts/hotkey', () => ({ hotkeyMatches: vi.fn(() => false) }))

vi.mock('./LoreBook/LoreBookSetting.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('./Scripts/RegexList.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('./Scripts/TriggerList.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('./Toggles.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
// Stands in for MultiLangInput's one field: it carries the naming attributes from the props the panel passes, as the real
// component forwards them to its TextAreaInput (the forwarding itself is covered by the MultiLangInput misc test).
vi.mock('../UI/GUI/MultiLangInput.svelte', () => ({
    default: (anchor: Comment, props: { labelId?: string }) => {
        const area = document.createElement('textarea')
        if (props.labelId) {
            area.setAttribute('aria-labelledby', props.labelId)
            area.setAttribute('aria-describedby', props.labelId)
        }
        anchor.before(area)
    },
}))
vi.mock('../Studio/StudioToggleLink.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))

//#endregion

import { CharConfigSubMenu, DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { controlDescription, controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import { getFileSrc } from 'src/ts/globalApi.svelte'
import CharConfigPanel from './CharConfigPanel.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

const subMenu = CharConfigSubMenu as ReturnType<typeof writable<number>>

type Fixture = { character?: Record<string, unknown>, db?: Record<string, unknown> }

/** The character in the shape a card import writes, with every optional block the pages read. */
function characterBase(): Record<string, unknown> {
    return {
        chaId: 'char-a',
        name: 'Alpha',
        type: 'character',
        license: '',
        chatPage: 0,
        chats: [{ id: 'chat-a', message: [], scriptstate: {}, note: '', fmIndex: -1 }],
        image: '',
        emotionImages: [],
        additionalAssets: [],
        ccAssets: [],
        alternateGreetings: [],
        desc: '',
        firstMessage: '',
        customModuleToggle: '',
        bias: [],
        personality: '',
        scenario: '',
        exampleMessage: '',
        systemPrompt: '',
        replaceGlobalNote: '',
        additionalText: '',
        defaultVariables: '',
        translatorNote: '',
        backgroundHTML: '',
        customscript: [],
        triggerscript: [],
        virtualscript: '',
        creatorNotes: '',
        additionalData: { creator: '', character_version: '' },
        nickname: '',
        depth_prompt: { depth: 0, prompt: '' },
        viewScreen: 'none',
        newGenData: { prompt: '', negative: '', instructions: '', emotionInstructions: '' },
        voicevoxConfig: { speaker: '', SPEED_SCALE: 1, PITCH_SCALE: 0, VOLUME_SCALE: 1, INTONATION_SCALE: 1 },
        hfTTS: { model: '', language: 'en' },
        ttsMode: '',
        utilityBot: false,
    }
}

function groupBase(): Record<string, unknown> {
    const base = characterBase()
    return {
        ...base,
        type: 'group',
        characters: ['m1', 'm2'],
        characterTalks: [0.5, 1],
        characterActive: [true, false],
    }
}

function install(fixture: Fixture, type: 'character' | 'group' = 'character'): void {
    const character = { ...(type === 'group' ? groupBase() : characterBase()), ...(fixture.character ?? {}) }
    DBState.db = {
        characters: [character],
        personas: [],
        modules: [],
        hotkeys: [],
        longPressToPopupEditor: false,
        useAdditionalAssetsPreview: false,
        showUnrecommended: true,
        hideApiKey: false,
        supaModelType: 'none',
        ...(fixture.db ?? {}),
    } as never
}

async function settle(): Promise<void> {
    flushSync()
    await tick()
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
    flushSync()
}

async function show(page: number, fixture: Fixture = {}, type: 'character' | 'group' = 'character'): Promise<HTMLElement> {
    install(fixture, type)
    subMenu.set(page)
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(CharConfigPanel, { target, props: { studioEntry: false } }))
    await settle()
    return target
}

function tabButtons(target: HTMLElement): HTMLButtonElement[] {
    return Array.from(target.querySelectorAll<HTMLButtonElement>('div.flex.w-full.rounded-md button'))
}

async function pickView(target: HTMLElement, index: number): Promise<void> {
    tabButtons(target)[index].click()
    await settle()
}

const foreignUnnamed: string[] = []

function unnamed(root: HTMLElement): string[] {
    return unnamedControls(root, { fields: true }).filter((entry) => !foreignUnnamed.some((fragment) => entry.includes(fragment)))
}

function fieldNames(root: HTMLElement): string[] {
    return Array.from(root.querySelectorAll<HTMLElement>('input[type="text"], input[type="password"], input:not([type]), textarea, [role="textbox"]')).map(controlName)
}

function field(root: HTMLElement, label: string, index = 0): HTMLElement {
    const found = Array.from(root.querySelectorAll<HTMLElement>('input[type="text"], input[type="password"], input:not([type]), textarea, [role="textbox"]'))
        .filter((el) => controlName(el) === label)[index]
    if (!found) expect.fail('no field named ' + label + ' #' + index)
    return found
}

beforeEach(() => {
    subMenu.set(0)
})

afterEach(async () => {
    vi.unstubAllGlobals()
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never)
    }
    for (const target of mountedTargets.splice(0)) {
        target.remove()
    }
    subMenu.set(0)
})

describe('CharConfigPanel (character) accessible names', () => {
    test('regression reproducer: the basic page names its fields by label and placeholder key', async () => {
        const target = await show(0)
        expect(unnamed(target)).toEqual([])
        const names = fieldNames(target)
        expect(names).toEqual(expect.arrayContaining([
            language.sidebarUi.characterName, language.description, language.firstMessage, language.authorNote,
        ]))
        for (const label of [language.description, language.firstMessage, language.authorNote]) {
            expect(controlDescription(field(target, label)).startsWith(label)).toBe(true)
        }
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the icon page names the remove-mode toggle with aria-pressed and every icon tile', async () => {
        const target = await show(1, {
            character: {
                image: 'icon.png',
                ccAssets: [{ type: 'icon', name: 'Alt', uri: 'alt.png', ext: 'png' }],
            },
        })
        await pickView(target, 0)
        const toggle = Array.from(target.querySelectorAll<HTMLButtonElement>('div.mt-2 > button')).find((b) => b.hasAttribute('aria-pressed'))
        if (!toggle) expect.fail('no remove-mode toggle with aria-pressed')
        expect(controlName(toggle)).toBe(language.removeIconsMode)
        expect(toggle.getAttribute('aria-pressed')).toBe('false')
        toggle.click()
        await settle()
        expect(toggle.getAttribute('aria-pressed')).toBe('true')
        expect(unnamed(target)).toEqual([])
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the emotion table names its name field, remove and add buttons', async () => {
        const target = await show(1, {
            character: {
                viewScreen: 'emotion',
                inlayViewScreen: true,
                emotionImages: [['happy', 'happy.png']],
            },
        })
        await pickView(target, 1)
        expect(unnamed(target)).toEqual([])
        const names = Array.from(target.querySelectorAll('button')).map(controlName)
        expect(names).toEqual(expect.arrayContaining([language.remove, language.add]))
        field(target, language.emotion)
        field(target, language.emotionInstructions)
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the image generation page names its three prompt fields', async () => {
        const target = await show(1, { character: { viewScreen: 'imggen', inlayViewScreen: true } })
        await pickView(target, 1)
        expect(unnamed(target)).toEqual([])
        for (const label of [language.imgGenPrompt, language.imgGenNegatives, language.imgGenInstructions]) {
            field(target, label)
        }
    })

    test('regression reproducer: the additional assets table names add, remove, prompt toggle with aria-pressed and the name field', async () => {
        const target = await show(1, {
            character: {
                additionalAssets: [['one', 'one.png', 'png'], ['two', 'two.png', 'png']],
                prebuiltAssetExclude: ['two.png'],
            },
            db: { useAdditionalAssetsPreview: true, newImageHandlingBeta: true },
        })
        await pickView(target, 2)
        expect(unnamed(target)).toEqual([])
        const toggles = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).filter((b) => controlName(b) === language.assetInPrompt)
        expect(toggles.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
        toggles[0].click()
        await settle()
        expect(toggles[0].getAttribute('aria-pressed')).toBe('false')
        const names = Array.from(target.querySelectorAll('button')).map(controlName)
        expect(names).toEqual(expect.arrayContaining([language.add, language.remove]))
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the asset name boxes use the neutral tile and carry the data-part marker', async () => {
        // A withheld URL ('') is what shows the name box in place of the image.
        vi.mocked(getFileSrc).mockResolvedValue('')
        try {
            const target = await show(1, {
                character: { additionalAssets: [['clip', 'clip.png', 'png']] },
                db: { useAdditionalAssetsPreview: true },
            })
            await pickView(target, 2)
            const box = target.querySelector('[data-part="asset-name-box"]')
            expect(box).not.toBeNull()
            expect(box!.classList.contains('bg-darkbutton')).toBe(true)
            expect(paletteClasses(target)).not.toContain('bg-slate-500')
        } finally {
            vi.mocked(getFileSrc).mockImplementation(async (path: string) => 'src:' + path)
        }
    })

    test('regression reproducer: the scripts page names its regex buttons and its fields', async () => {
        const target = await show(4)
        expect(unnamed(target)).toEqual([])
        const names = Array.from(target.querySelectorAll('button')).map(controlName)
        expect(names).toEqual(expect.arrayContaining([language.add, language.export, language.import]))
        field(target, language.backgroundHTML)
        field(target, language.charjs)
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the advanced page names bias, alternate greeting and every field', async () => {
        const target = await show(2, {
            character: {
                bias: [['word', 3]],
                alternateGreetings: ['one', 'two'],
                chats: [{ id: 'chat-a', message: [], scriptstate: {}, note: '', fmIndex: -1, supaMemoryData: 'long memory text' }],
            },
        })
        expect(unnamed(target)).toEqual([])
        const names = Array.from(target.querySelectorAll('button')).map(controlName)
        expect(names.filter((n) => n === language.chatShellMoveUp)).toHaveLength(2)
        expect(names.filter((n) => n === language.chatShellMoveDown)).toHaveLength(2)
        for (const label of [
            language.sidebarUi.bias, language.exampleMessage, language.systemPrompt, language.replaceGlobalNote,
            language.additionalText, language.personality, language.scenario, language.defaultVariables,
            language.translatorNote, language.customPromptTemplateToggle, language.creator, language.CharVersion,
            language.nickname, language.depthPrompt, language.altGreet, language.SuperMemory,
        ]) {
            const el = field(target, label)
            expect(controlDescription(el).startsWith(label)).toBe(true)
        }
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the creator notes field is named by its label text alone, with that label first in its description', async () => {
        const target = await show(2)
        const el = field(target, language.creatorNotes)
        expect(controlName(el)).toBe(language.creatorNotes)
        const labelId = el.getAttribute('aria-labelledby')!
        expect(el.getAttribute('aria-describedby')!.split(' ')[0]).toBe(labelId)
        expect(controlDescription(el).startsWith(language.creatorNotes)).toBe(true)
        expect(unnamed(target)).toEqual([])
    })

    test('regression reproducer: a move-up button of an alternate greeting is named and still moves the row', async () => {
        const target = await show(2, { character: { alternateGreetings: ['one', 'two'] } })
        const stacks = Array.from(target.querySelectorAll<HTMLElement>('div.flex.flex-col.items-center'))
        expect(stacks).toHaveLength(2)
        const up = stacks[1].querySelectorAll<HTMLButtonElement>('button')[0]
        expect(controlName(up)).toBe(language.chatShellMoveUp)
        up.click()
        await settle()
        expect((DBState.db.characters[0] as unknown as { alternateGreetings: string[] }).alternateGreetings).toEqual(['two', 'one'])
    })

    test('regression reproducer: the novelai, openai, gpt-sovits and fish speech pages name their fields and checkboxes', async () => {
        const cases: Array<[string, Record<string, unknown>, string[]]> = [
            ['novelai', { naittsConfig: { customvoice: true, voice: 'a', version: 'v2' } }, [language.sidebarUi.ttsCustomVoiceSeed]],
            ['openai', { oaiTTSConfig: { enabled: true, format: 'mp3', voice: '', baseURL: '', apiKey: '', model: '' }, oaiVoice: '' }, [language.sidebarUi.ttsAdvancedEndpoint]],
            ['gptsovits', { gptSoVitsConfig: { url: '', use_auto_path: false, ref_audio_path: '', use_long_audio: false, ref_audio_data: { fileName: '', assetId: '' }, volume: 1, text_lang: 'auto', text: 'en', use_prompt: true, prompt: '', prompt_lang: 'en', top_p: 1, temperature: 0.7, speed: 1, top_k: 5, text_split_method: 'cut0' } }, [language.sidebarUi.ttsUseAutoPath, language.sidebarUi.ttsUseLongAudio, language.sidebarUi.ttsUseRefAudioScript]],
            ['fishspeech', { fishSpeechConfig: { model: { _id: '' }, chunk_length: 200, normalize: true } }, ['Normalize']],
            ['huggingface', {}, []],
        ]
        for (const [mode, config, boxLabels] of cases) {
            const target = await show(5, { character: { ttsMode: mode, ...config } })
            expect(unnamed(target), mode).toEqual([])
            const boxNames = Array.from(target.querySelectorAll('input[type="checkbox"]')).map(controlName)
            for (const label of boxLabels) {
                expect(boxNames, mode).toContain(label)
            }
            expect(exposedIcons(target), mode).toEqual([])
        }
    })

    test('regression reproducer: the tts text fields are named by their visible labels', async () => {
        const target = await show(5, {
            character: {
                ttsMode: 'openai',
                oaiVoice: '',
                oaiTTSConfig: { enabled: true, format: 'mp3', voice: '', baseURL: '', apiKey: '', model: '' },
            },
        })
        for (const label of [language.sidebarUi.ttsVoice, 'Base URL', language.sidebarUi.apiKeyOverridesGlobal, language.model]) {
            expect(controlDescription(field(target, label)).startsWith(label)).toBe(true)
        }
    })

    test('regression reproducer: the red and green palette classes of the touched pages are gone (AS7)', async () => {
        vi.stubGlobal('speechSynthesis', {})
        const pages: Array<[number, Fixture]> = [
            [1, { character: { image: 'icon.png', ccAssets: [{ type: 'icon', name: 'Alt', uri: 'alt.png', ext: 'png' }] } }],
            [2, { character: { bias: [['w', 1]], alternateGreetings: ['one', 'two'] } }],
            [4, {}],
            [5, { character: { ttsMode: 'webspeech', ttsSpeech: 'x' } }],
        ]
        for (const [page, fixture] of pages) {
            const target = await show(page, fixture)
            if (page === 1) {
                await pickView(target, 0)
                const toggle = Array.from(target.querySelectorAll<HTMLButtonElement>('div.mt-2 > button')).find((b) => b.querySelector('svg'))
                toggle?.click()
                await settle()
            }
            expect(paletteClasses(target), 'page ' + page).toEqual([])
        }
    })
})

describe('CharConfigPanel (group) accessible names', () => {
    test('regression reproducer: member icons are named remove, the talk segments are named, the active checks are named', async () => {
        const target = await show(0, {}, 'group')
        expect(unnamed(target)).toEqual([])
        const members = Array.from(target.querySelectorAll<HTMLButtonElement>('button.ico'))
        expect(members.map(controlName)).toEqual([language.remove, language.remove])
        const segments = Array.from(target.querySelectorAll<HTMLButtonElement>('button.border-r-bgcolor'))
        expect(segments).toHaveLength(12)
        expect(segments.slice(0, 6).map(controlName)).toEqual([1, 2, 3, 4, 5, 6].map((n) => language.groupTalkLevel(n)))
        expect(segments.some((b) => b.hasAttribute('aria-labelledby'))).toBe(false)
        const names = fieldNames(target)
        expect(names).toEqual(expect.arrayContaining([language.sidebarUi.groupName, language.authorNote]))
        const boxes = Array.from(target.querySelectorAll('input[type="checkbox"]')).map(controlName)
        expect(boxes).toEqual(expect.arrayContaining(['Member m1', 'Member m2']))
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the talk meter fill uses the scheme token', async () => {
        const target = await show(0, {}, 'group')
        const filled = Array.from(target.querySelectorAll<HTMLButtonElement>('button.border-r-bgcolor')).filter((b) => b.classList.contains('bg-textcolor2'))
        expect(filled.length).toBeGreaterThan(0)
        expect(paletteClasses(target)).toEqual([])
    })

    test('regression reproducer: the group icon page and the lorebook-free tabs name every control', async () => {
        const target = await show(1, {}, 'group')
        await pickView(target, 0)
        expect(unnamed(target)).toEqual([])
        expect(exposedIcons(target)).toEqual([])
    })
})
