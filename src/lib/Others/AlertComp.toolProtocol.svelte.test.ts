// @vitest-environment happy-dom

/**
 * The answer protocol of the ten tool dialogs of `AlertComp.svelte`: addchar, chatOptions, selectChar, requestdata,
 * hypaV2, requestlogs, cardexport, branches, peerConflicts and parkedReply.
 *
 * Drives the REAL `AlertComp.svelte`, the REAL document keydown listener that `initHotkey()` registers, the real alert
 * producers (`alertAddCharacter`, `alertCardExport`, ...) and a real `writable` standing in for `alertStore`. Every
 * assertion reads what a caller receives or what the store holds, so the markup of a dialog may change as long as these
 * answers do not.
 *
 * Controls are found by visible text, accessible name, the kept `button.ico` and `data-*` hooks, or the one
 * `NODE_SELECTOR` constant for branch nodes. Never by layout classes.
 *
 * Every test here is a compatibility guard: it passes on the markup before the redesign and after it. A prompt answered
 * inside `ANSWER_GUARD_MS` is discarded, so every answer waits past it.
 *
 * The module mocks copy `AlertComp.keyAnswers.svelte.test.ts`, extended with what the data viewers and the
 * text fields need to mount.
 */

import { flushSync, mount, unmount } from 'svelte'
import { tickFake } from '../../ts/tests/svelteTick.test-helpers'
import { get, writable } from 'svelte/store'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'
import 'src/ts/polyfill'

//#region module mocks (see file header)

const { getFetchLogsSpy, getFetchDataSpy, aiLawAppliesSpy, getChatBranchesSpy } = vi.hoisted(() => ({
    getFetchLogsSpy: vi.fn(() => [] as unknown[]),
    getFetchDataSpy: vi.fn(() => ({}) as unknown),
    aiLawAppliesSpy: vi.fn(() => false),
    getChatBranchesSpy: vi.fn(() => [] as unknown[]),
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

vi.mock(
    import('src/ts/globalApi.svelte'),
    () =>
        ({
            forageStorage: {
                keys: vi.fn(async () => []),
                getItem: vi.fn(async () => null),
                setItem: vi.fn(async () => {}),
            },
            getFileSrc: vi.fn(async (loc: string) => `data:mock-image;loc=${loc}`),
            checkCharOrder: vi.fn(),
            requiresFullEncoderReload: { state: false },
            AppendableBuffer: class {},
            VirtualWriter: class {},
            LocalWriter: class {},
            BlankWriter: class {},
            downloadFile: vi.fn(),
            openURL: vi.fn(),
            loadAsset: vi.fn(),
            saveAsset: vi.fn(),
            readImage: vi.fn(),
            globalFetch: vi.fn(),
            aiWatermarkingLawApplies: vi.fn(() => false),
            changeChatTo: vi.fn(),
            hubURL: '',
            usingSw: false,
            getFetchLogs: getFetchLogsSpy,
            getFetchData: getFetchDataSpy,
            aiLawApplies: aiLawAppliesSpy,
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('../../ts/stores.svelte')
    return {
        getDatabase: vi.fn((_options?: { snapshot?: boolean }) => DBState.db),
        getCurrentCharacter: vi.fn(() => DBState.db.characters?.[0]),
        changeToPreset: vi.fn(),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isMobile: false,
    isIOS: () => false,
    getDetailedOSLabel: vi.fn(async () => 'test-os'),
    getFallbackOSLabel: vi.fn(() => 'test-os'),
    getRisuEnvironmentLabel: vi.fn((): RisuEnvironmentLabel => 'web'),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    remove: vi.fn(),
    readDir: vi.fn(async () => []),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        MobileGUIStack: writable(0),
        MobileSideBar: writable(0),
        CharEmotion: writable(new Map()),
        OpenRealmStore: writable(false),
        MobileSearch: writable(''),
        alertStore: writable({ type: 'none', msg: '' }),
        selIdState: { state: -1 },
        SettingsMenuIndex: writable(0),
        ShowRealmFrameStore: writable(false),
        settingsOpen: writable(false),
        botMakerMode: writable(false),
        DynamicGUI: writable(false),
        sideBarClosing: writable(false),
        sideBarStore: writable({ tab: 0 }),
        PlaygroundStore: writable(0),
        QuickSettings: { open: false, index: 0 },
        SafeModeStore: writable(false),
        loadoutModalStore: { open: false },
        openPersonaList: writable(false),
        openPresetList: writable(false),
        additionalHamburgerMenu: writable([]),
        CharConfigSubMenu: writable(0),
        MobileGUI: writable(false),
        hypaV3ModalOpen: writable(false),
        ReloadGUIPointer: writable(0),
        bookmarkListOpen: writable(false),
        alertGenerationInfoStore: writable(null),
        disableHighlight: writable(false),
        popUpEditorStore: { open: false, value: '', mode: 'default', language: '' },
    } as unknown as typeof import('../../ts/stores.svelte')
})

vi.mock(import('../../ts/characters'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        changeChar: vi.fn(),
    }
})

vi.mock(import('../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

vi.mock(import('../../ts/sourcemap'), () => ({
    translateStackTrace: vi.fn(async (stackTrace: string) => ({ didTranslate: false, stackTrace })),
}) as unknown as typeof import('../../ts/sourcemap'))

vi.mock(import('src/ts/gui/branches'), () => ({
    getChatBranches: getChatBranchesSpy,
}) as unknown as typeof import('src/ts/gui/branches'))

vi.mock(import('src/ts/tokenizer'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        tokenize: vi.fn(async () => 7),
    }
})

vi.mock(import('../../ts/process/index.svelte'), () => ({
    doingChat: writable(false),
    sendChat: vi.fn(),
}) as unknown as typeof import('../../ts/process/index.svelte'))

//#endregion

import { language } from 'src/lang'
import { alertStore, DBState } from '../../ts/stores.svelte'
import { initHotkey } from '../../ts/hotkey'
import { closeDialogForBack } from '../../ts/alertBack'
import { ANSWER_GUARD_MS, askPrompt, resetAlertPromptsForTests } from '../../ts/alertPrompts'
import {
    alertAddCharacter,
    alertCardExport,
    alertChatOptions,
    alertGenerationInfoStore,
    alertRequestData,
    alertRequestLogs,
    alertSelectChar,
    showHypaV2Alert,
    type PeerConflictRowView,
    type alertData,
} from '../../ts/alert'
import AlertComp from './AlertComp.svelte'

/** The element that is one branch node. Switched to the node's own part name when the nodes become buttons. */
const NODE_SELECTOR = '[data-part="pattern-alert-tree-node"]'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

function mountAlertComp(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(AlertComp, { target, props: {} }))
    return target
}

async function settle(): Promise<void> {
    flushSync()
    await tickFake()
    flushSync()
    await Promise.resolve()
}

/** Posts a raw (non-prompt) alert the way its caller does and lets the component react. */
async function show(value: alertData): Promise<void> {
    alertStore.set(value as never)
    await settle()
}

/** One millisecond past the pause during which a prompt ignores an answer. */
async function pastGuard(): Promise<void> {
    await vi.advanceTimersByTimeAsync(ANSWER_GUARD_MS + 1)
    await settle()
}

async function afterAnswer(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0)
    await settle()
}

function capture<T>(promise: Promise<T>): { settled: boolean, value: T | undefined } {
    const box: { settled: boolean, value: T | undefined } = { settled: false, value: undefined }
    void promise.then((value) => {
        box.settled = true
        box.value = value
    })
    return box
}

function chat(messages: string[]): Record<string, unknown> {
    return {
        message: messages.map((data, i) => ({ role: i % 2 === 0 ? 'user' : 'char', data })),
        hypaV2Data: { chunks: [], mainChunks: [] },
    }
}

function arrangeDatabase(): void {
    DBState.db = {
        characters: [
            { name: 'Alice', chaId: 'cha-a', type: 'character', image: '', chats: [chat([])], chatPage: 0, additionalAssets: [] },
            { name: 'Bob', chaId: 'cha-b', type: 'character', image: '', chats: [chat([])], chatPage: 0, additionalAssets: [] },
        ],
        modules: [],
        enabledModules: [],
        botPresets: [],
        botPresetsId: 0,
        hotkeys: [],
    } as unknown as Database
    alertGenerationInfoStore.set({
        genInfo: { inputTokens: 1, outputTokens: 1, maxContext: 10, model: 'm', generationId: 'g' },
        idx: 0,
    } as never)
}

/** A button whose own text, or the text of one of its labels, is `label`. */
function buttonByText(target: HTMLElement, label: string): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll('button')).find((button) =>
        button.textContent?.trim() === label
        || Array.from(button.querySelectorAll('span')).some((span) => span.textContent?.trim() === label))
    if (!found) throw new Error(`no button named "${label}" is mounted`)
    return found
}

function closeButton(target: HTMLElement): HTMLButtonElement {
    const found = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.uiCommon.close}"]`)
    if (!found) throw new Error('no close button is mounted')
    return found
}

function pressEscape(): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    ;(document.activeElement ?? document.body).dispatchEvent(event)
    return event
}

function stubClipboard(): ReturnType<typeof vi.fn> {
    const writeText = vi.fn(async (_text: string) => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    return writeText
}

async function openPrompt(): Promise<HTMLElement> {
    vi.useFakeTimers()
    arrangeDatabase()
    const target = mountAlertComp()
    await settle()
    return target
}

beforeAll(() => {
    initHotkey()
})

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    vi.useRealTimers()
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' } as never)
    getFetchLogsSpy.mockReset()
    getFetchLogsSpy.mockReturnValue([])
    getFetchDataSpy.mockReset()
    getFetchDataSpy.mockReturnValue({})
    aiLawAppliesSpy.mockReset()
    aiLawAppliesSpy.mockReturnValue(false)
    getChatBranchesSpy.mockReset()
    getChatBranchesSpy.mockReturnValue([])
    if (originalClipboard) {
        Object.defineProperty(navigator, 'clipboard', originalClipboard)
    } else {
        Reflect.deleteProperty(navigator, 'clipboard')
    }
})

afterAll(() => {
    alertStore.set({ type: 'none', msg: '' } as never)
})

describe('guard: addchar answers', () => {
    const OPTIONS: Array<[string, string]> = [
        [language.importFromRealm, 'importFromRealm'],
        [language.importCharacter, 'importCharacter'],
        [language.createfromScratch, 'createfromScratch'],
        [language.createGroup, 'createGroup'],
        [language.cancel, 'cancel'],
    ]

    test.each(OPTIONS)('guard: "%s" resolves %s', async (label, answer) => {
        const target = await openPrompt()
        const result = capture(alertAddCharacter())
        await settle()
        await pastGuard()

        buttonByText(target, label).click()
        await afterAnswer()

        expect(result.value).toBe(answer)
    })

    test('guard: Back resolves cancel', async () => {
        await openPrompt()
        const result = capture(alertAddCharacter())
        await settle()
        await pastGuard()

        closeDialogForBack()
        await afterAnswer()

        expect(result.value).toBe('cancel')
    })
})

describe('guard: chatOptions answers', () => {
    test('guard: Create a Copy resolves 0 and Bind Persona resolves 1', async () => {
        const target = await openPrompt()
        const first = capture(alertChatOptions())
        await settle()
        await pastGuard()
        buttonByText(target, language.createCopy).click()
        await afterAnswer()
        expect(first.value).toBe(0)

        const second = capture(alertChatOptions())
        await settle()
        await pastGuard()
        buttonByText(target, language.bindPersona).click()
        await afterAnswer()
        expect(second.value).toBe(1)
    })

    test('guard: Cancel and Back resolve NaN', async () => {
        const target = await openPrompt()
        const first = capture(alertChatOptions())
        await settle()
        await pastGuard()
        buttonByText(target, language.cancel).click()
        await afterAnswer()
        expect(first.settled).toBe(true)
        expect(Number.isNaN(first.value)).toBe(true)

        const second = capture(alertChatOptions())
        await settle()
        await pastGuard()
        closeDialogForBack()
        await afterAnswer()
        expect(second.settled).toBe(true)
        expect(Number.isNaN(second.value)).toBe(true)
    })
})

describe('guard: selectChar answers', () => {
    function avatars(target: HTMLElement): HTMLButtonElement[] {
        return Array.from(target.querySelectorAll<HTMLButtonElement>('button.ico'))
    }

    test('guard: an avatar resolves that character\'s chaId', async () => {
        const target = await openPrompt()
        const result = capture(alertSelectChar())
        await settle()
        await pastGuard()
        expect(avatars(target)).toHaveLength(2)

        avatars(target)[1].click()
        await afterAnswer()

        expect(result.value).toBe('cha-b')
    })

    test('guard: Cancel and Back resolve the empty string', async () => {
        const target = await openPrompt()
        const first = capture(alertSelectChar())
        await settle()
        await pastGuard()
        buttonByText(target, language.cancel).click()
        await afterAnswer()
        expect(first.value).toBe('')

        const second = capture(alertSelectChar())
        await settle()
        await pastGuard()
        closeDialogForBack()
        await afterAnswer()
        expect(second.value).toBe('')
    })
})

describe('guard: Escape on the tool dialogs', () => {
    test('guard: Escape leaves the six prompt dialogs up and unresolved', async () => {
        const target = await openPrompt()
        const rows: PeerConflictRowView[] = []
        const producers: Array<[alertData['type'], () => Promise<unknown>]> = [
            ['addchar', () => alertAddCharacter()],
            ['chatOptions', () => alertChatOptions()],
            ['selectChar', () => alertSelectChar()],
            ['cardexport', () => alertCardExport('')],
            ['peerConflicts', () => askPrompt({ type: 'peerConflicts', msg: 'Conflicts', peerConflicts: rows })],
            ['parkedReply', () => askPrompt({ type: 'parkedReply', msg: 'A reply', parkedReply: { name: 'Alice', text: 'text' } })],
        ]
        for (const [type, produce] of producers) {
            const result = capture(produce())
            await settle()
            await pastGuard()

            pressEscape()
            await afterAnswer()

            expect.soft(get(alertStore).type, `${type} stays shown`).toBe(type)
            expect.soft(result.settled, `${type} stays unresolved`).toBe(false)
            expect.soft(target.querySelector('[data-alert-box]'), `${type} stays mounted`).not.toBeNull()

            closeDialogForBack()
            await afterAnswer()
            // peerConflicts holds under Back; resolve it through the reset below.
            resetAlertPromptsForTests()
            alertStore.set({ type: 'none', msg: '' } as never)
            await settle()
        }
    })

    test('guard: Escape closes requestdata, hypaV2, requestlogs and branches', async () => {
        await openPrompt()
        const closers: Array<[alertData['type'], () => void]> = [
            ['requestdata', () => alertRequestData({
                genInfo: { inputTokens: 1, outputTokens: 1, maxContext: 10, model: 'm', generationId: 'g' },
                idx: 0,
            } as never)],
            ['hypaV2', () => showHypaV2Alert()],
            ['requestlogs', () => alertRequestLogs()],
            ['branches', () => alertStore.set({ type: 'branches', msg: '' })],
        ]
        for (const [type, open] of closers) {
            open()
            await settle()
            expect.soft(get(alertStore).type, `${type} is shown`).toBe(type)

            pressEscape()
            await afterAnswer()

            expect.soft(get(alertStore), `${type} closes`).toEqual({ type: 'none', msg: '' })
        }
    })
})

describe('guard: focus on open is the dialog box, never a control', () => {
    const CONTROL_TAGS = new Set(['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A', 'SUMMARY'])

    test('guard: each of the ten dialogs puts focus on its [data-alert-box], not on a control', async () => {
        const target = await openPrompt()
        const opens: Array<[string, () => void]> = [
            ['addchar', () => void alertAddCharacter()],
            ['chatOptions', () => void alertChatOptions()],
            ['selectChar', () => void alertSelectChar()],
            ['requestdata', () => alertRequestData({
                genInfo: { inputTokens: 1, outputTokens: 1, maxContext: 10, model: 'm', generationId: 'g' },
                idx: 0,
            } as never)],
            ['hypaV2', () => showHypaV2Alert()],
            ['requestlogs', () => alertRequestLogs()],
            ['cardexport', () => void alertCardExport('')],
            ['branches', () => alertStore.set({ type: 'branches', msg: '' })],
            ['peerConflicts', () => void askPrompt({ type: 'peerConflicts', msg: 'Conflicts', peerConflicts: [] })],
            ['parkedReply', () => void askPrompt({ type: 'parkedReply', msg: 'A reply', parkedReply: { name: 'Alice', text: 'text' } })],
        ]
        for (const [type, open] of opens) {
            resetAlertPromptsForTests()
            alertStore.set({ type: 'none', msg: '' } as never)
            await settle()
            open()
            await settle()

            const focused = document.activeElement
            expect.soft(focused !== document.body && target.contains(focused), `${type}: focus is inside the dialog`).toBe(true)
            expect.soft(focused?.hasAttribute('data-alert-box'), `${type}: focus is on the alert box`).toBe(true)
            expect.soft(CONTROL_TAGS.has(focused?.tagName ?? ''), `${type}: focus is on a control`).toBe(false)
            expect.soft(focused?.closest('[inert]') ?? null, `${type}: focus is not inside an inert subtree`).toBeNull()
        }
    })
})

describe('guard: requestdata', () => {
    function arrangeMessage(): void {
        arrangeDatabase()
        DBState.db.characters[0].chats[0].message = [{
            role: 'char',
            data: 'Generated text',
            chatId: 'chat-id-1',
            saying: 'Alice',
            time: 0,
            promptInfo: undefined,
        }] as never
        alertGenerationInfoStore.set({
            genInfo: { inputTokens: 1234, outputTokens: 321, maxContext: 8000, model: 'model-x', generationId: 'g' },
            idx: 0,
        } as never)
    }

    async function openRequestData(): Promise<HTMLElement> {
        arrangeMessage()
        const target = mountAlertComp()
        await settle()
        alertRequestData({
            genInfo: { inputTokens: 1234, outputTokens: 321, maxContext: 8000, model: 'model-x', generationId: 'g' },
            idx: 0,
        } as never)
        await settle()
        return target
    }

    test('guard: the close button writes none with an empty message', async () => {
        const target = await openRequestData()

        closeButton(target).click()
        await settle()

        expect(get(alertStore)).toEqual({ type: 'none', msg: '' })
    })

    test('guard: the Tokens, Meta Data, Log and Prompt tabs show their content', async () => {
        getFetchDataSpy.mockReturnValue({ url: 'https://x.invalid/v1', body: '{"a":1}', response: '{"r":2}' })
        const target = await openRequestData()
        expect.soft(target.textContent, 'the Tokens tab').toContain(language.tokenWarning)
        expect.soft(target.textContent, 'the Tokens tab shows the input count').toContain('1234')

        buttonByText(target, language.metaData).click()
        await settle()
        expect.soft(target.textContent, 'the Meta Data tab shows the model').toContain('model-x')
        expect.soft(target.textContent, 'the Meta Data tab shows the chat id').toContain('chat-id-1')

        buttonByText(target, language.log).click()
        await settle()
        expect.soft(getFetchDataSpy, 'the Log tab asks for the request by its generation id').toHaveBeenCalledWith('g')
        expect.soft(target.textContent, 'the Log tab shows the url').toContain('https://x.invalid/v1')

        buttonByText(target, language.prompt).click()
        await settle()
        expect.soft(target.textContent, 'the Prompt tab without prompt info').toContain(language.promptInfoEmptyMessage)
    })

    test('guard: the AI disclaimer shows only when the law applies', async () => {
        const without = await openRequestData()
        expect(without.textContent).not.toContain(language.generatedByAIDisclaimer)

        aiLawAppliesSpy.mockReturnValue(true)
        alertStore.set({ type: 'none', msg: '' } as never)
        await settle()
        alertRequestData({
            genInfo: { inputTokens: 1, outputTokens: 1, maxContext: 10, model: 'm', generationId: 'g' },
            idx: 0,
        } as never)
        await settle()
        expect(without.textContent).toContain(language.generatedByAIDisclaimer)
    })
})

describe('guard: hypaV2 edits write into the chat', () => {
    test('guard: typing into a Chunks textarea and a Summarized textarea changes the stored text', async () => {
        arrangeDatabase()
        const stored = DBState.db.characters[0].chats[0] as unknown as {
            hypaV2Data: { chunks: Array<{ text: string }>, mainChunks: Array<{ text: string }> }
        }
        stored.hypaV2Data.chunks = [{ text: 'chunk one' }, { text: 'chunk two' }]
        stored.hypaV2Data.mainChunks = [{ text: 'summary one' }, { text: 'summary two' }]
        const target = mountAlertComp()
        await settle()
        showHypaV2Alert()
        await settle()

        const type = (area: HTMLTextAreaElement, text: string): void => {
            area.value = text
            area.dispatchEvent(new Event('input', { bubbles: true }))
            flushSync()
        }
        const chunkAreas = Array.from(target.querySelectorAll('textarea'))
        expect(chunkAreas).toHaveLength(2)
        type(chunkAreas[1], 'edited chunk')
        expect(stored.hypaV2Data.chunks.map((c) => c.text)).toEqual(['chunk one', 'edited chunk'])

        buttonByText(target, language.alertComp.summarized).click()
        await settle()
        const summaryAreas = Array.from(target.querySelectorAll('textarea'))
        expect(summaryAreas).toHaveLength(2)
        type(summaryAreas[0], 'edited summary')
        expect(stored.hypaV2Data.mainChunks.map((c) => c.text)).toEqual(['edited summary', 'summary two'])
    })
})

describe('guard: requestlogs', () => {
    const LOGS = [
        { url: 'https://a.invalid/v1/one', body: '{"b":1}', header: '{"h":"1"}', response: '{"r":1}', success: true, status: 200, date: '10:41' },
        { url: 'https://a.invalid/v1/two', body: '{"b":2}', header: '{"h":"2"}', response: '{"r":2}', success: false, status: 500, date: '10:42' },
    ]

    async function openLogs(): Promise<{ target: HTMLElement, writeText: ReturnType<typeof vi.fn> }> {
        const writeText = stubClipboard()
        getFetchLogsSpy.mockReturnValue(LOGS)
        arrangeDatabase()
        const target = mountAlertComp()
        await settle()
        alertRequestLogs()
        await settle()
        return { target, writeText }
    }

    function copyButtons(target: HTMLElement): HTMLButtonElement[] {
        return Array.from(target.querySelectorAll<HTMLButtonElement>(`button[title="${language.copy}"]`))
    }

    function rowButton(target: HTMLElement, url: string): HTMLButtonElement {
        const found = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.includes(url))
        if (!found) throw new Error(`no row for ${url}`)
        return found
    }

    test('guard: Expand All and Collapse All toggle every row', async () => {
        const { target } = await openLogs()
        expect(copyButtons(target)).toHaveLength(0)

        buttonByText(target, language.expandAll).click()
        await settle()
        expect(copyButtons(target), 'four copy buttons per expanded row').toHaveLength(8)

        buttonByText(target, language.collapseAll).click()
        await settle()
        expect(copyButtons(target)).toHaveLength(0)
    })

    test('guard: a row expands on its own and its four copy buttons copy url, body, header and response', async () => {
        const { target, writeText } = await openLogs()

        rowButton(target, 'https://a.invalid/v1/two').click()
        await settle()
        const copies = copyButtons(target)
        expect(copies).toHaveLength(4)
        for (const button of copies) {
            button.click()
            await settle()
        }

        expect(writeText.mock.calls.map((call) => call[0])).toEqual([
            'https://a.invalid/v1/two',
            '{"b":2}',
            '{"h":"2"}',
            '{"r":2}',
        ])
    })

    test('guard: the close button writes none with an empty message', async () => {
        const { target } = await openLogs()

        closeButton(target).click()
        await settle()

        expect(get(alertStore)).toEqual({ type: 'none', msg: '' })
    })
})

describe('guard: cardexport answers', () => {
    const answerOf = (box: { value: { type: string, type2: string } | undefined }) => box.value

    async function openExport(submsg: string): Promise<{ target: HTMLElement, result: ReturnType<typeof capture<{ type: string, type2: string }>> }> {
        const target = await openPrompt()
        const result = capture(alertCardExport(submsg))
        await settle()
        await pastGuard()
        return { target, result }
    }

    test('guard: the default Export shares to the realm', async () => {
        const { target, result } = await openExport('')

        buttonByText(target, language.shareCloud).click()
        await afterAnswer()

        expect(answerOf(result)).toEqual({ type: 'realm', type2: '' })
    })

    test('guard: Character Card V3 selects CHARX-JPEG and exports it', async () => {
        const { target, result } = await openExport('')

        buttonByText(target, 'Character Card V3').click()
        await settle()
        expect(target.querySelector('select')?.value, 'the format select shows CHARX-JPEG').toBe('charxJpeg')
        buttonByText(target, language.export).click()
        await afterAnswer()

        expect(answerOf(result)).toEqual({ type: '', type2: 'charxJpeg' })
    })

    test('guard: Character Card V2 exports as ccv2', async () => {
        const { target, result } = await openExport('')

        buttonByText(target, 'Character Card V2').click()
        await settle()
        buttonByText(target, language.export).click()
        await afterAnswer()

        expect(answerOf(result)).toEqual({ type: 'ccv2', type2: '' })
    })

    test('guard: changing the format changes type2', async () => {
        const { target, result } = await openExport('')

        buttonByText(target, 'Character Card V3').click()
        await settle()
        const select = target.querySelector('select')!
        select.selectedIndex = Array.from(select.options).findIndex((option) => option.textContent?.trim() === 'JSON')
        // happy-dom does not resolve `:checked` on a select; Svelte's select binding reads the chosen option through it.
        const query = select.querySelector.bind(select)
        select.querySelector = ((selector: string) =>
            selector === ':checked' ? select.options[select.selectedIndex] : query(selector)) as typeof select.querySelector
        select.dispatchEvent(new Event('change', { bubbles: true }))
        await settle()
        buttonByText(target, language.export).click()
        await afterAnswer()

        expect(answerOf(result)).toEqual({ type: '', type2: 'json' })
    })

    test('guard: the close button cancels and keeps the current format', async () => {
        const { target, result } = await openExport('')

        buttonByText(target, 'Character Card V3').click()
        await settle()
        closeButton(target).click()
        await afterAnswer()

        expect(answerOf(result)).toEqual({ type: 'cancel', type2: 'charxJpeg' })
    })

    test('guard: Back cancels with an empty type2', async () => {
        const { result } = await openExport('')

        closeDialogForBack()
        await afterAnswer()

        expect(answerOf(result)).toEqual({ type: 'cancel', type2: '' })
    })

    test('guard: the preset and module tile sets pick their own type', async () => {
        const preset = await openExport('preset')
        buttonByText(preset.target, 'Risupreset').click()
        await settle()
        buttonByText(preset.target, language.export).click()
        await afterAnswer()
        expect(answerOf(preset.result)).toEqual({ type: '', type2: '' })

        const module = await openExport('module')
        buttonByText(module.target, 'RisuM').click()
        await settle()
        buttonByText(module.target, language.export).click()
        await afterAnswer()
        expect(answerOf(module.result)).toEqual({ type: '', type2: '' })
    })
})

describe('guard: branches pointer behaviour', () => {
    const NODES = [
        { x: 0, y: 1, chatId: 0, connectX: -1, connectY: -1, multiChild: false, content: '' },
        { x: 0, y: 2, chatId: 0, connectX: 0, connectY: 1, multiChild: false, content: '' },
        { x: 1, y: 2, chatId: 1, connectX: 0, connectY: 1, multiChild: false, content: '' },
    ]

    async function openBranches(): Promise<{ target: HTMLElement, nodes: Element[] }> {
        arrangeDatabase()
        DBState.db.characters[0].chats = [chat(['first text', 'second text']), chat(['first text', 'other text'])] as never
        getChatBranchesSpy.mockReturnValue(NODES)
        const target = mountAlertComp()
        await settle()
        await show({ type: 'branches', msg: '' })
        return { target, nodes: Array.from(target.querySelectorAll(NODE_SELECTOR)) }
    }

    const enter = (node: Element): void => {
        node.dispatchEvent(new MouseEvent('mouseenter'))
        flushSync()
    }

    test('guard: the close button writes none with an empty message', async () => {
        const { target } = await openBranches()

        closeButton(target).click()
        await settle()

        expect(get(alertStore)).toEqual({ type: 'none', msg: '' })
    })

    test('guard: a node shows its message on mouseenter, keeps the first preview while one is shown, and hides on mouseleave', async () => {
        const { target, nodes } = await openBranches()
        expect(nodes).toHaveLength(3)
        expect(target.textContent).not.toContain('second text')

        enter(nodes[1])
        expect(target.textContent, 'node 2 shows its message').toContain('second text')

        enter(nodes[2])
        expect.soft(target.textContent, 'node 3 does not replace the shown preview').toContain('second text')
        expect.soft(target.textContent, 'node 3 does not replace the shown preview').not.toContain('other text')

        nodes[1].dispatchEvent(new MouseEvent('mouseleave'))
        flushSync()
        expect(target.textContent, 'the preview is hidden after mouseleave').not.toContain('second text')
    })

    test('guard: a click shows the node\'s message when no preview is shown', async () => {
        const { target, nodes } = await openBranches()

        ;(nodes[2] as HTMLElement).click()
        flushSync()

        expect(target.textContent).toContain('other text')
    })
})

describe('guard: peerConflicts answers', () => {
    const ROWS: PeerConflictRowView[] = [
        { id: 'r1', label: 'Record one', choices: ['mine', 'theirs', 'both'], preselect: 'both', note: 'both keeps two' },
        { id: 'r2', label: 'Record two', choices: ['mine', 'theirs'], preselect: 'mine', note: null },
    ]

    async function openConflicts(): Promise<{ target: HTMLElement, result: ReturnType<typeof capture<string>> }> {
        const target = await openPrompt()
        const result = capture(askPrompt({ type: 'peerConflicts', msg: 'Conflicts', peerConflicts: ROWS }))
        await settle()
        await pastGuard()
        return { target, result }
    }

    test('guard: Apply answers the JSON of every row\'s preselected choice', async () => {
        const { target, result } = await openConflicts()

        buttonByText(target, language.store2Boot.peerConflictApply).click()
        await afterAnswer()

        expect(JSON.parse(result.value ?? 'null')).toEqual({ r1: 'both', r2: 'mine' })
    })

    test('guard: a changed row and a same-for-all choice are answered', async () => {
        const { target, result } = await openConflicts()
        const radio = target.querySelector<HTMLInputElement>('input[type="radio"][name="peer-conflict-r2"][value="theirs"]')!
        radio.checked = true
        radio.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()

        buttonByText(target, language.store2Boot.peerConflictApply).click()
        await afterAnswer()
        expect(JSON.parse(result.value ?? 'null')).toEqual({ r1: 'both', r2: 'theirs' })
    })

    test('guard: Keep theirs for all selects theirs on every row, and Back holds', async () => {
        const { target, result } = await openConflicts()

        closeDialogForBack()
        await afterAnswer()
        expect(result.settled, 'Back holds the dialog').toBe(false)

        buttonByText(target, language.store2Boot.peerKeepTheirs).click()
        await settle()
        buttonByText(target, language.store2Boot.peerConflictApply).click()
        await afterAnswer()
        expect(JSON.parse(result.value ?? 'null')).toEqual({ r1: 'theirs', r2: 'theirs' })
    })
})

describe('guard: parkedReply answers', () => {
    async function openParked(): Promise<{ target: HTMLElement, result: ReturnType<typeof capture<string>> }> {
        const target = await openPrompt()
        stubClipboard()
        const result = capture(askPrompt({
            type: 'parkedReply',
            msg: language.parkedReplyTitle,
            parkedReply: { name: 'Alice', text: 'The reply text' },
        }))
        await settle()
        await pastGuard()
        return { target, result }
    }

    test('guard: Discard answers discard at once', async () => {
        const { target, result } = await openParked()

        buttonByText(target, language.parkedReplyDiscard).click()
        await afterAnswer()

        expect(result.value).toBe('discard')
    })

    test('guard: Later answers later', async () => {
        const { target, result } = await openParked()

        buttonByText(target, language.parkedReplyLater).click()
        await afterAnswer()

        expect(result.value).toBe('later')
    })

    test('guard: Back answers later', async () => {
        const { result } = await openParked()

        closeDialogForBack()
        await afterAnswer()

        expect(result.value).toBe('later')
    })

    test('guard: Copy keeps the dialog open and unresolved', async () => {
        const { target, result } = await openParked()

        buttonByText(target, language.copy).click()
        await afterAnswer()

        expect(result.settled).toBe(false)
        expect(get(alertStore).type).toBe('parkedReply')
        expect(target.textContent).toContain('The reply text')
    })
})
