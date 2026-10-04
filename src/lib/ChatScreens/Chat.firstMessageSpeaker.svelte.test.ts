// @vitest-environment happy-dom

/**
 * The speaker button of the first message (idx -1) of the REAL `Chat.svelte`,
 * over the REAL CBS parser.
 *
 * Invariants pinned here:
 *  - the first message of a character with a voice mode shows the speaker
 *    button, and shows none for a mode of none, normal or empty, for a group
 *    owner, or for a blank first message;
 *  - a tap speaks the parsed display text of the shown page: a `firstmsg`-
 *    dependent CBS tag resolves as for the first message, and an alternate
 *    first message page is spoken instead of the first page;
 *  - the first message has no Remove button;
 *  - a `Chat` mounted with no index and no first-message flag, with no
 *    character behind it (the welcome screen and the bookmark list), mounts
 *    without a speaker button and without throwing.
 *
 * `sayTTS` is a recording fake; nothing here speaks aloud.
 */

import { flushSync, mount, unmount, type ComponentProps } from 'svelte'
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

type ChatProps = ComponentProps<typeof Chat>
type Owner = { type: 'character' | 'group', ttsMode: string, name: string, chaId: string, chatPage: number, chats: unknown[], characters?: string[] }

function setupDb(owner: Partial<Owner> = {}): void {
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
                message: [],
                scriptstate: {},
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

async function mountFirstMessage(overrides: Partial<ChatProps> = {}): Promise<{ root: HTMLElement; props: ChatProps }> {
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountedTargets.push(root)
    const props: ChatProps = $state({
        idx: -1,
        firstMessage: true,
        message: 'Welcome',
        name: 'Alpha',
        isLastMemory: false,
        ...overrides,
    })
    mountedInstances.push(mount(Chat, { target: root, props }))
    flushSync()
    await settle()
    return { root, props }
}

function speakerButton(root: HTMLElement): HTMLButtonElement | null {
    return root.querySelector<HTMLButtonElement>('.button-icon-tts')
}

function requireSpeaker(root: HTMLElement): HTMLButtonElement {
    const button = speakerButton(root)
    expect(button, 'the speaker button').not.toBeNull()
    return button!
}

//#endregion

beforeAll(() => {
    parserBox.parse = parserModule.risuChatParser as unknown as (text: string, options?: unknown) => string
})

beforeEach(() => {
    window.innerWidth = 1024
    setupDb()
    selectedCharID.set(0)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => {}), write: vi.fn(async () => {}) }, configurable: true })
    vi.mocked(sayTTS).mockClear()
})

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    Reflect.deleteProperty(navigator, 'clipboard')
})

describe('the speaker button of the first message', () => {
    test('regression reproducer: a character with a voice mode has the button on the first message', async () => {
        const { root } = await mountFirstMessage()

        expect(speakerButton(root)).not.toBeNull()
    })

    test.each([
        ['an empty mode', ''],
        ['none', 'none'],
        ['normal', 'normal'],
    ])('guard: a character with %s has no button on the first message', async (_label, ttsMode) => {
        setupDb({ ttsMode })

        const { root } = await mountFirstMessage()

        expect(speakerButton(root)).toBeNull()
    })

    test('guard: a group owner has no button on the first message', async () => {
        setupDb({ type: 'group', ttsMode: 'openai', characters: [] })

        const { root } = await mountFirstMessage()

        expect(speakerButton(root)).toBeNull()
    })

    test.each([
        ['an empty message', ''],
        ['{{none}}', '{{none}}'],
        ['{{blank}}', '{{blank}}'],
    ])('guard: %s as the first message has no button', async (_label, message) => {
        const { root } = await mountFirstMessage({ message })

        expect(speakerButton(root)).toBeNull()
    })

    test('guard: the first message has no Remove button', async () => {
        const { root } = await mountFirstMessage()

        expect(root.querySelector('.button-icon-remove')).toBeNull()
    })

    test('guard: a Chat with no index, no first-message flag and no character mounts with no button and no throw', async () => {
        DBState.db.characters = [] as never

        const { root } = await mountFirstMessage({ idx: undefined, firstMessage: undefined })

        expect(speakerButton(root)).toBeNull()
    })
})

describe('a tap on the speaker button of the first message', () => {
    test('regression reproducer: speaks the parsed text, with a firstmsg-dependent tag resolved for the first message', async () => {
        const { root } = await mountFirstMessage({ message: 'Hi {{user}}, first: {{isfirstmsg}}' })

        requireSpeaker(root).click()

        expect(sayTTS).toHaveBeenCalledTimes(1)
        expect(vi.mocked(sayTTS).mock.calls[0][0]).toBeNull()
        expect(vi.mocked(sayTTS).mock.calls[0][1]).toBe('Hi User, first: 1')
    })

    test('regression reproducer: an alternate first message page is spoken instead of the first page', async () => {
        const { root, props } = await mountFirstMessage({ message: 'Page one' })

        props.message = 'Page two'
        flushSync()
        await settle()
        requireSpeaker(root).click()

        expect(vi.mocked(sayTTS).mock.calls[0][1]).toBe('Page two')
    })
})
