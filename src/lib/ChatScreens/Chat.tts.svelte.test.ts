// @vitest-environment happy-dom

/**
 * The speaker button of the REAL `Chat.svelte`, over the REAL CBS parser.
 *
 * Invariants pinned here:
 *  - the button shows for a non-group character whose `ttsMode` is set and is
 *    neither `'none'` nor `'normal'`, plugin-defined mode strings included,
 *    and never for a group owner;
 *  - a tap speaks what a plain copy would put on the clipboard: the message
 *    parsed as it is displayed, with closed `<Thoughts>` blocks removed, and a
 *    thinking-only message spoken whole; a strong-optimised stream is spoken
 *    as the parse of its raw streaming text;
 *  - the displayed text of a message (read through the copy button) is the
 *    parse the message list asks for: `{{char}}` is the name string passed in
 *    (the group's name in a group chat), `{{getvar}}` reads the chat on screen.
 *
 * `sayTTS` and the clipboard are recording fakes; nothing here speaks aloud
 * or touches a real clipboard.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock('dompurify', () => ({
    default: { addHook: vi.fn(), sanitize: (value: string) => value },
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        selectedCharID: writable(-1),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({} as Record<number, number>),
        CurrentTriggerIdStore: writable(null),
        popupStore: { children: null, mouseX: 0, mouseY: 0, openId: 0 },
        HideIconStore: writable(false),
        createSimpleCharacter: vi.fn(() => null),
        bookmarkListOpen: writable(false),
        ScrollToMessageStore: { value: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    aiLawApplies: vi.fn(() => false),
    aiWatermarkingLawApplies: vi.fn(() => false),
    isPlainHttpFileSrc: vi.fn(() => false),
    changeChatTo: vi.fn(),
    foldChatToMessage: vi.fn(),
    getFileSrc: vi.fn(async () => ''),
    createChatCopyName: vi.fn((name: string) => `${name} Branch`),
    downloadFile: vi.fn(),
    fetchNative: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    const live = stores.DBState as unknown as { db: { characters: Array<{ chatPage: number, chats: unknown[] }> } }
    const owner = () => live.db.characters[0]
    return {
        appVer: '0.0.0',
        getCurrentCharacter: vi.fn(() => owner()),
        getCurrentChat: vi.fn(() => owner()?.chats[owner().chatPage]),
        setCurrentChat: vi.fn(),
        getDatabase: vi.fn(() => live.db),
        setDatabase: vi.fn(),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertSelect: vi.fn(async () => ''),
    alertNormal: vi.fn(),
    alertWait: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertRequestData: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

// The parser module is the real one with only `ParseMarkdown` replaced; `src/ts/process/scripts` hands out its `risuChatParser` through a late-bound wrapper.
const parserBox = vi.hoisted(() => ({ parse: null as null | ((text: string, options?: unknown) => string) }))

vi.mock(import('src/ts/parser/parser.svelte'), async (importOriginal) => ({
    ...(await importOriginal()),
    ParseMarkdown: vi.fn(async (text: string) => text),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/translator/translator'), () => ({
    getLLMCache: vi.fn(async () => null),
    setLLMCache: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/scriptings'), () => ({
    runLuaButtonTrigger: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/process/scriptings'))

vi.mock(import('src/ts/process/scripts'), async () => {
    return {
        risuChatParser: (text: string, options?: unknown) => parserBox.parse!(text, options),
        processScriptFull: vi.fn(async (_char: unknown, text: string) => ({ data: text, emoChanged: false })),
    } as unknown as typeof import('src/ts/process/scripts')
})

vi.mock(import('src/ts/process/modules'), () => ({
    getModuleAssets: vi.fn(() => []),
    getModuleLorebooks: vi.fn(() => []),
    getModules: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    getInlayAssetBlob: vi.fn(async () => undefined),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/triggers'), () => ({
    runTrigger: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/process/triggers'))

vi.mock(import('src/ts/process/tts'), () => ({
    sayTTS: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    ColorSchemeTypeStore: writable('dark'),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ shortName: 'test-model' })),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/util'), () => ({
    capitalize: vi.fn((s: string) => s),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    getPersonaPrompt: vi.fn(() => ''),
    pickHashRand: vi.fn(() => 0.5),
    replaceAsync: vi.fn(),
    sleep: vi.fn(async () => {}),
    findCharacterbyId: vi.fn(() => null),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/characters'))

vi.mock('./ChatBody.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('./PartialEditController.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

//#endregion

import { DBState, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import * as parserModule from 'src/ts/parser/parser.svelte'
import { sayTTS } from 'src/ts/process/tts'
import Chat from './Chat.svelte'

//#region fixtures and helpers

type Owner = { type: 'character' | 'group', ttsMode: string, name: string, chaId: string, chatPage: number, chats: unknown[], characters?: string[] }

function setupDb(owner: Partial<Owner> = {}, scriptstate: Record<string, string> = {}): void {
    DBState.db = {
        askRemoval: false,
        instantRemove: false,
        translatorType: 'none',
        translateBeforeHTMLFormatting: false,
        legacyTranslation: false,
        requestInfoInsideChat: false,
        clickToEdit: false,
        zoomsize: 100,
        lineHeight: 1.25,
        enableBlockPartialEdit: false,
        enableDragPartialEdit: false,
        useChatCopy: true,
        translator: '',
        swipe: false,
        showFirstMessagePages: false,
        enableBookmark: true,
        createFolderOnBranch: false,
        iconsize: 100,
        memoryLimitThickness: 2,
        theme: 'default',
        guiHTML: '',
        roundIcons: false,
        username: 'User',
        characters: [{
            chaId: 'owner-a',
            name: 'Alpha',
            type: 'character',
            ttsMode: 'webspeech',
            chatPage: 0,
            chats: [{
                id: 'chat-a',
                message: [{ role: 'char', data: 'text', chatId: 'id-1' }],
                scriptstate,
                bookmarks: [] as string[],
                bookmarkNames: {} as Record<string, string>,
            }],
            ...owner,
        }],
    } as never
    selIdState.selId = 0
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
}

async function mountChat(props: Record<string, unknown> = {}): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(Chat, { target, props: { idx: 0, message: 'text', name: 'Alpha', isLastMemory: false, ...props } }))
    flushSync()
    await settle()
    return target
}

function speakerButton(root: HTMLElement): HTMLButtonElement | null {
    return root.querySelector<HTMLButtonElement>('.button-icon-tts')
}

function copyButton(root: HTMLElement): HTMLButtonElement {
    const button = root.querySelector<HTMLButtonElement>('.button-icon-copy')
    expect(button, 'the copy button').not.toBeNull()
    return button!
}

const writeText = vi.fn(async (_text: string) => {})
const realClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

//#endregion

beforeAll(() => {
    parserBox.parse = parserModule.risuChatParser as unknown as (text: string, options?: unknown) => string
})

beforeEach(() => {
    window.innerWidth = 1024
    setupDb()
    selectedCharID.set(0)
    writeText.mockClear()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText, write: vi.fn(async () => {}) }, configurable: true })
    vi.mocked(sayTTS).mockClear()
})

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    if (realClipboard) {
        Object.defineProperty(navigator, 'clipboard', realClipboard)
    } else {
        Reflect.deleteProperty(navigator, 'clipboard')
    }
})

describe('the speaker button of a message', () => {
    test.each([
        'webspeech', 'elevenlab', 'VOICEVOX', 'openai', 'novelai', 'huggingface', 'vits', 'gptsovits', 'fishspeech', 'my-plugin-voice',
    ])('guard: a character with the voice mode %s has the button', async (ttsMode) => {
        setupDb({ ttsMode })

        const root = await mountChat()

        expect(speakerButton(root)).not.toBeNull()
    })

    test.each([
        ['an empty mode', ''],
        ['none', 'none'],
    ])('guard: a character with %s has no button', async (_label, ttsMode) => {
        setupDb({ ttsMode })

        const root = await mountChat()

        expect(speakerButton(root)).toBeNull()
    })

    test('regression reproducer: a character with the mode normal, which card import writes for no TTS, has no button', async () => {
        setupDb({ ttsMode: 'normal' })

        const root = await mountChat()

        expect(speakerButton(root)).toBeNull()
    })

    test('guard: a group owner has no button, whatever its members', async () => {
        setupDb({ type: 'group', ttsMode: 'openai', characters: [] })

        const root = await mountChat()

        expect(speakerButton(root)).toBeNull()
    })
})

describe('a tap on the speaker button', () => {
    test('regression reproducer: speaks the parsed message with a closed thinking block removed', async () => {
        const root = await mountChat({ message: 'Hi {{user}}.\n\n<Thoughts>private</Thoughts>\n\nAnswer.' })

        speakerButton(root)!.click()

        expect(sayTTS).toHaveBeenCalledTimes(1)
        expect(vi.mocked(sayTTS).mock.calls[0][0]).toBeNull()
        expect(vi.mocked(sayTTS).mock.calls[0][1]).toBe('Hi User.\n\nAnswer.')
    })

    test('regression reproducer: speaks a thinking-only message whole, parsed', async () => {
        const root = await mountChat({ message: '<Thoughts>{{user}} thinks</Thoughts>' })

        speakerButton(root)!.click()

        expect(vi.mocked(sayTTS).mock.calls[0][1]).toBe('<Thoughts>User thinks</Thoughts>')
    })

    test('regression reproducer: speaks exactly the text a plain copy writes', async () => {
        const root = await mountChat({ message: 'Hi {{user}}.\n\n<Thoughts>private</Thoughts>\n\nAnswer.' })

        copyButton(root).click()
        speakerButton(root)!.click()

        expect(writeText).toHaveBeenCalledTimes(1)
        expect(vi.mocked(sayTTS).mock.calls[0][1]).toBe(writeText.mock.calls[0][0])
    })

    test('regression reproducer: a strong-optimised streaming message is spoken as the parse of its raw streaming text', async () => {
        const root = await mountChat({
            message: 'stale stored text',
            isOptimizedStreamingMessage: true,
            streamingOptimizationMode: 'strong',
            rawStreamingText: 'Streaming {{user}}<Thoughts>t</Thoughts> answer',
        })

        speakerButton(root)!.click()

        expect(vi.mocked(sayTTS).mock.calls[0][1]).toBe('Streaming User answer')
    })
})

describe('the displayed text of a message', () => {
    // The same message and the same expected text as the auto-TTS scenario in
    // `src/ts/process/tests/sendChatTts.svelte.test.ts`: the spoken parse and the
    // displayed parse of one stored message are one string.
    const MESSAGE = '{{char}} says hi to {{user}}. Mood: {{getvar::mood}}'
    const DISPLAYED_CHARACTER = 'Alpha says hi to User. Mood: calm'
    const DISPLAYED_GROUP = 'The Party says hi to User. Mood: calm'

    test('guard: {{char}} is the character name passed in and {{getvar}} reads the chat on screen', async () => {
        setupDb({}, { $mood: 'calm' })
        const root = await mountChat({ message: MESSAGE, name: 'Alpha' })

        copyButton(root).click()

        expect(writeText).toHaveBeenCalledWith(DISPLAYED_CHARACTER)
    })

    test('guard: in a group-owned chat {{char}} is the group name passed in', async () => {
        setupDb({ type: 'group', name: 'The Party', characters: [] }, { $mood: 'calm' })
        const root = await mountChat({ message: MESSAGE, name: 'The Party' })

        copyButton(root).click()

        expect(writeText).toHaveBeenCalledWith(DISPLAYED_GROUP)
    })
})
