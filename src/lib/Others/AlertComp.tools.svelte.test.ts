// @vitest-environment happy-dom

/**
 * The shared anatomy of the tool dialogs of `AlertComp.svelte` and its choosers: addchar, chatOptions and selectChar.
 * A tool dialog is named by its headline, its options are real buttons inside the pattern's row and grid parts, and the
 * part names are pinned by the census because a theme pack hooks onto them.
 *
 * Drives the REAL `AlertComp.svelte` over a real `writable` standing in for `alertStore` and the real alert producers.
 * The module mocks copy `AlertComp.shell.svelte.test.ts`: none of it is exercised here, the component needs it to mount.
 *
 * Tests whose title starts with `guard:` pass with or without the redesign. Every other test fails while the
 * behaviour it names is missing, except the census, which names parts that do not exist before the redesign and is
 * falsified by renaming a part.
 */

import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'
import 'src/ts/polyfill'

//#region module mocks (see file header)

const { getFetchLogsSpy, getFetchDataSpy, aiLawAppliesSpy } = vi.hoisted(() => ({
    getFetchLogsSpy: vi.fn(() => [] as unknown[]),
    getFetchDataSpy: vi.fn(() => ({}) as unknown),
    aiLawAppliesSpy: vi.fn(() => false),
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
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
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
        MobileGUIStack: writable([]),
        CharEmotion: writable(new Map()),
        OpenRealmStore: writable({ isOpen: false }),
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
        PlaygroundStore: writable({ open: false }),
        QuickSettings: writable([]),
        additionalHamburgerMenu: writable([]),
        CharConfigSubMenu: writable(0),
        MobileGUI: writable(false),
        hypaV3ModalOpen: writable(false),
        ReloadGUIPointer: writable(0),
        bookmarkListOpen: writable(false),
        alertGenerationInfoStore: writable(null),
        CustomCSSStore: { subscribe: vi.fn(), set: vi.fn() },
        SafeModeStore: { subscribe: vi.fn(), set: vi.fn() },
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
    getChatBranches: vi.fn(() => []),
}) as unknown as typeof import('src/ts/gui/branches'))

vi.mock(import('src/ts/tokenizer'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        tokenize: vi.fn(async () => 7),
    }
})

//#endregion

import { tickFake } from '../../ts/tests/svelteTick.test-helpers'
import { language } from 'src/lang'
import { alertStore, DBState } from '../../ts/stores.svelte'
import { askPrompt, resetAlertPromptsForTests } from '../../ts/alertPrompts'
import {
    alertAddCharacter,
    alertCardExport,
    alertChatOptions,
    alertGenerationInfoStore,
    alertModuleSelect,
    alertRequestData,
    alertRequestLogs,
    alertSelectChar,
    showHypaV2Alert,
} from '../../ts/alert'
import { getChatBranches } from 'src/ts/gui/branches'
import { controlName, unnamedControls } from '../a11yNames.test-helpers'
import { setWindowGeometryForTests } from '../../ts/windowing/windowHost.svelte'
import AlertComp from './AlertComp.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

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

function arrangeDatabase(): void {
    DBState.db = {
        characters: [
            { name: 'Alice', chaId: 'cha-a', type: 'character', image: '', chats: [], chatPage: 0 },
            { name: 'Bob', chaId: 'cha-b', type: 'character', image: '', chats: [], chatPage: 0 },
            { name: 'Scratch', chaId: '§temp', type: 'character', image: '', chats: [], chatPage: 0 },
        ],
        modules: [],
        enabledModules: [],
        botPresets: [],
        botPresetsId: 0,
    } as unknown as Database
}

async function openChooser(produce: () => Promise<unknown>): Promise<HTMLElement> {
    arrangeDatabase()
    const target = mountAlertComp()
    await settle()
    void produce()
    await settle()
    return target
}

function dialogOf(target: HTMLElement): HTMLElement {
    const dialog = target.querySelector<HTMLElement>('[data-part="pattern-dialog"][data-alert-box]')
    if (!dialog) throw new Error('no pattern dialog carries the alert box')
    return dialog
}

/** Every distinct part name in the layer around the dialog, the layer included, sorted. */
function partsOf(target: HTMLElement): string[] {
    const layer = dialogOf(target).closest<HTMLElement>('[data-part="pattern-layer"]')!
    const names = [layer, ...Array.from(layer.querySelectorAll<HTMLElement>('[data-part]'))].map((el) => el.getAttribute('data-part') ?? '')
    return Array.from(new Set(names)).sort()
}

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    vi.useRealTimers()
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' } as never)
    vi.clearAllMocks()
    getFetchLogsSpy.mockReset()
    getFetchLogsSpy.mockReturnValue([])
    getFetchDataSpy.mockReset()
    getFetchDataSpy.mockReturnValue({})
    aiLawAppliesSpy.mockReset()
    aiLawAppliesSpy.mockReturnValue(false)
})

const SHELL_PARTS = [
    'pattern-alert-body',
    'pattern-alert-head',
    'pattern-dialog',
    'pattern-layer',
    'pattern-scrim',
    'pattern-warn-actions',
    'pattern-warn-headline',
    'pattern-warn-mark',
    'pattern-warn-root',
]

/** The part names of the choosers, pinned because a theme pack hooks onto them. */
const CHOOSER_PARTS = {
    addchar: [...SHELL_PARTS, 'pattern-alert-row', 'pattern-alert-row-desc', 'pattern-alert-row-title', 'pattern-alert-rows'].sort(),
    chatOptions: [...SHELL_PARTS, 'pattern-alert-row', 'pattern-alert-row-title', 'pattern-alert-rows'].sort(),
    selectChar: [...SHELL_PARTS, 'pattern-alert-char', 'pattern-alert-char-name', 'pattern-alert-chars'].sort(),
}

describe('the choosers carry a headline that names the dialog', () => {
    test.each([
        ['addchar', () => alertAddCharacter(), () => language.addCharacter],
        ['chatOptions', () => alertChatOptions(), () => language.chatOptions],
    ])('a %s dialog renders its headline as an h2 and is labelled by it', async (_type, produce, expected) => {
        vi.useFakeTimers()
        const target = await openChooser(produce)

        const headline = target.querySelector('h2[data-part="pattern-warn-headline"]')
        expect(headline?.textContent).toBe(expected())
        const labelledBy = dialogOf(target).getAttribute('aria-labelledby') ?? ''
        expect(document.getElementById(labelledBy)).toBe(headline)
    })

    test('guard: the selectChar headline stays the select string', async () => {
        vi.useFakeTimers()
        const target = await openChooser(() => alertSelectChar())

        const headline = target.querySelector('h2[data-part="pattern-warn-headline"]')
        expect(headline?.textContent).toBe(language.select)
        expect(document.getElementById(dialogOf(target).getAttribute('aria-labelledby') ?? '')).toBe(headline)
    })

    test('selectChar describes itself by nothing: it has no message element to point at', async () => {
        vi.useFakeTimers()
        const target = await openChooser(() => alertSelectChar())

        expect(dialogOf(target).getAttribute('aria-describedby')).toBeNull()
    })
})

describe('selectChar names every avatar', () => {
    test('every avatar button is named by its character and the caption shows the same name', async () => {
        vi.useFakeTimers()
        const target = await openChooser(() => alertSelectChar())

        const avatars = Array.from(target.querySelectorAll<HTMLButtonElement>('button.ico'))
        expect(avatars.map(controlName), 'a hidden system character stays absent').toEqual(['Alice', 'Bob'])
        const captions = Array.from(target.querySelectorAll('[data-part="pattern-alert-char-name"]')).map((el) => el.textContent?.trim())
        expect(captions).toEqual(['Alice', 'Bob'])
        expect(unnamedControls(dialogOf(target))).toEqual([])
    })

    test('a character with a picture is named like one without', async () => {
        vi.useFakeTimers()
        arrangeDatabase()
        ;(DBState.db.characters[0] as unknown as { image: string }).image = 'alice.png'
        const target = mountAlertComp()
        await settle()
        void alertSelectChar()
        await settle()

        const avatars = Array.from(target.querySelectorAll<HTMLButtonElement>('button.ico'))
        expect(avatars.map(controlName)).toEqual(['Alice', 'Bob'])
    })
})

describe('the choosers are made of the pinned parts', () => {
    test('addchar: a hero row, three quiet rows and a Cancel in the footer', async () => {
        vi.useFakeTimers()
        const target = await openChooser(() => alertAddCharacter())

        expect(partsOf(target)).toEqual(CHOOSER_PARTS.addchar)
        const rows = Array.from(target.querySelectorAll<HTMLElement>('[data-part="pattern-alert-rows"] > [data-part="pattern-alert-row"]'))
        expect(rows.map((row) => row.getAttribute('data-emphasis'))).toEqual(['hero', null, null, null])
        expect(rows[0].querySelector('[data-part="pattern-alert-row-title"]')?.textContent).toBe(language.importFromRealm)
        expect(rows[0].querySelector('[data-part="pattern-alert-row-desc"]')?.textContent).toBe(language.importFromRealmDesc)
        const footer = target.querySelector('[data-part="pattern-warn-actions"]')
        expect(Array.from(footer?.querySelectorAll('button') ?? []).map((b) => b.textContent?.trim())).toEqual([language.cancel])
        expect(rows.every((row) => row.getAttribute('type') === 'button')).toBe(true)
    })

    test('chatOptions: two rows and a Cancel in the footer', async () => {
        vi.useFakeTimers()
        const target = await openChooser(() => alertChatOptions())

        expect(partsOf(target)).toEqual(CHOOSER_PARTS.chatOptions)
        const rows = Array.from(target.querySelectorAll('[data-part="pattern-alert-row-title"]')).map((el) => el.textContent)
        expect(rows).toEqual([language.createCopy, language.bindPersona])
        const footer = target.querySelector('[data-part="pattern-warn-actions"]')
        expect(Array.from(footer?.querySelectorAll('button') ?? []).map((b) => b.textContent?.trim())).toEqual([language.cancel])
    })

    test('selectChar: a grid of avatar tiles and a Cancel in the footer', async () => {
        vi.useFakeTimers()
        const target = await openChooser(() => alertSelectChar())

        expect(partsOf(target)).toEqual(CHOOSER_PARTS.selectChar)
        expect(target.querySelectorAll('[data-part="pattern-alert-chars"] [data-part="pattern-alert-char"]')).toHaveLength(2)
        const footer = target.querySelector('[data-part="pattern-warn-actions"]')
        expect(Array.from(footer?.querySelectorAll('button') ?? []).map((b) => b.textContent?.trim())).toEqual([language.cancel])
    })
})

//#region selectChar with a large library: the windowed grid

/**
 * The picker mounts only the grid rows near the dialog's view, under the window host's test geometry
 * (a 600 px band). The list element's top follows `scrolled`, as a scrolled-away list does. Titles that
 * start with "regression reproducer:" fail against the picker that mounted every character.
 */
describe('selectChar windows its avatar grid', () => {
    const LIBRARY = 300
    let frames: (() => void)[] = []
    let scrolled = 0

    function runFrames(): void {
        const pending = frames
        frames = []
        for (const frame of pending) frame()
        flushSync()
    }

    async function settleWindow(): Promise<void> {
        flushSync()
        await Promise.resolve()
        flushSync()
        runFrames()
    }

    function arrangeLibrary(count: number): void {
        DBState.db = {
            characters: Array.from({ length: count }, (_, i) => ({ name: `c${i}`, chaId: `cha-${i}`, type: 'character', image: '', chats: [], chatPage: 0 })),
            modules: [],
            enabledModules: [],
            botPresets: [],
            botPresetsId: 0,
        } as unknown as Database
    }

    async function openLibrary(count: number): Promise<{ target: HTMLElement, picked: Promise<unknown> }> {
        arrangeLibrary(count)
        const target = mountAlertComp()
        await settleWindow()
        const picked = alertSelectChar()
        await settleWindow()
        return { target, picked }
    }

    const avatarNames = (target: HTMLElement) => Array.from(target.querySelectorAll<HTMLButtonElement>('button.ico')).map(controlName)

    beforeEach(() => {
        frames = []
        scrolled = 0
        setWindowGeometryForTests({
            rectOf: (element) => (element.getAttribute('role') === 'list' ? { top: -scrolled, height: 600 } : { top: 0, height: 600 }),
            viewport: () => 600,
            scrollBy: () => {},
            schedule: (callback) => {
                frames.push(callback)
                return () => { frames = frames.filter((frame) => frame !== callback) }
            },
        })
    })

    afterEach(() => {
        setWindowGeometryForTests(undefined)
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    test('regression reproducer: a library of 300 characters mounts only the avatars near the view', async () => {
        const { target } = await openLibrary(LIBRARY)

        const names = avatarNames(target)
        expect(names[0]).toBe('c0')
        expect(names.length).toBeGreaterThan(0)
        expect(names.length).toBeLessThan(100)
    })

    test('regression reproducer: scrolling brings a far avatar in, and it resolves the prompt with its own chaId', async () => {
        vi.useFakeTimers()
        const { target, picked } = await openLibrary(LIBRARY)
        expect(avatarNames(target)).not.toContain('c250')

        // Four cards per row until a row reports its tracks, 120 px per unmeasured row: c250 is in row 62.
        scrolled = 62 * 120
        window.dispatchEvent(new Event('scroll'))
        await settleWindow()

        const avatar = Array.from(target.querySelectorAll<HTMLButtonElement>('button.ico')).find((button) => controlName(button) === 'c250')
        expect(avatar).toBeDefined()
        expect(avatarNames(target)).not.toContain('c0')
        // Past the prompt's guard against a click that lands as it opens.
        vi.advanceTimersByTime(2000)
        avatar!.click()
        flushSync()
        expect(await picked).toBe('cha-250')
    })

    test('the cards per row follow the tracks a mounted row reports', async () => {
        const observers: ((records: unknown[]) => void)[] = []
        vi.stubGlobal('ResizeObserver', class {
            constructor(callback: (records: unknown[]) => void) { observers.push(callback) }
            observe() {}
            unobserve() {}
            disconnect() {}
        })
        const computed = window.getComputedStyle.bind(window)
        vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => {
            const style = computed(element)
            if (element.getAttribute('role') !== 'listitem') return style
            return new Proxy(style, { get: (base, key) => (key === 'gridTemplateColumns' ? '100px 100px 100px' : Reflect.get(base, key)) })
        })
        const { target } = await openLibrary(10)

        const rowsBefore = Array.from(target.querySelectorAll('[role="listitem"]')).map((row) => row.querySelectorAll('button.ico').length)
        expect(rowsBefore).toEqual([4, 4, 2])
        expect(observers.length).toBeGreaterThan(0)
        for (const observer of observers) observer([])
        await settleWindow()

        const rowsAfter = Array.from(target.querySelectorAll('[role="listitem"]')).map((row) => row.querySelectorAll('button.ico').length)
        expect(rowsAfter).toEqual([3, 3, 3, 1])
        expect(avatarNames(target)).toEqual(Array.from({ length: 10 }, (_, i) => `c${i}`))
    })
})

//#region data viewers: requestdata, hypaV2 and requestlogs

type GenInfo = Record<string, unknown>

const GEN_INFO: GenInfo = {
    inputTokens: 1234,
    outputTokens: 321,
    maxContext: 8000,
    model: 'model-x',
    generationId: 'g',
    stageTiming: { stage1: 1000, stage2: 2000, stage3: 3000, stage4: 4000 },
}
const JSON_BODY = '{"a":"b","n":1,"t":true}'
const LOGS = [
    { url: 'https://a.invalid/v1/one', body: '{"b":1}', header: '{"h":"1"}', response: '{"r":1}', success: true, status: 200, date: '10:41' },
    { url: 'https://a.invalid/v1/two', body: '{"b":2}', header: '{"h":"2"}', response: '{"r":2}', success: false, status: 500, date: '10:42' },
]

/** The part names of the data viewers, pinned because a theme pack hooks onto them. A viewer has a close in its head and no footer. */
const VIEWER_SHELL = [...SHELL_PARTS.filter((part) => part !== 'pattern-warn-actions'), 'pattern-alert-close']
const CODE_PARTS = ['pattern-alert-code', 'pattern-alert-code-block', 'pattern-alert-code-head', 'pattern-alert-code-label']
const sorted = (...parts: string[][]): string[] => parts.flat().sort()
const VIEWER_PARTS = {
    requestdataTokens: sorted(VIEWER_SHELL, ['pattern-alert-tab', 'pattern-alert-tabs', 'pattern-alert-stack', 'pattern-alert-meter', 'pattern-alert-meter-input', 'pattern-alert-meter-output', 'pattern-alert-legend', 'pattern-alert-swatch', 'pattern-warn-detail']),
    requestdataMeta: sorted(VIEWER_SHELL, ['pattern-alert-tab', 'pattern-alert-tabs', 'pattern-alert-facts']),
    requestdataLog: sorted(VIEWER_SHELL, ['pattern-alert-tab', 'pattern-alert-tabs', 'pattern-alert-stack'], CODE_PARTS),
    requestdataPrompt: sorted(VIEWER_SHELL, ['pattern-alert-tab', 'pattern-alert-tabs', 'pattern-alert-stack', 'pattern-alert-facts', 'pattern-alert-panel'], CODE_PARTS),
    hypaChunks: sorted(VIEWER_SHELL, ['pattern-alert-tab', 'pattern-alert-tabs', 'pattern-alert-stack']),
    hypaSummarized: sorted(VIEWER_SHELL, ['pattern-alert-tab', 'pattern-alert-tabs', 'pattern-alert-stack', 'pattern-alert-chunk', 'pattern-alert-chunk-label']),
    requestlogs: sorted(VIEWER_SHELL, [
        'pattern-alert-toolbar', 'pattern-alert-logs', 'pattern-alert-log', 'pattern-alert-log-summary', 'pattern-alert-log-status',
        'pattern-alert-log-url', 'pattern-alert-log-date', 'pattern-alert-log-chevron', 'pattern-alert-log-detail', 'pattern-alert-copy',
    ], CODE_PARTS),
}

function arrangeViewerDatabase(): void {
    DBState.db = {
        characters: [{
            name: 'Alice',
            chaId: 'cha-a',
            type: 'character',
            image: '',
            chatPage: 0,
            chats: [{
                message: [{
                    role: 'char',
                    data: 'Generated text',
                    chatId: 'chat-id-1',
                    saying: 'Alice',
                    time: 0,
                    promptInfo: {
                        promptName: 'Preset A',
                        promptToggles: [{ key: 'toggle-one', value: 'on' }],
                        promptText: [{ role: 'system', content: 'You are a helpful narrator.' }],
                    },
                }],
                hypaV2Data: {
                    chunks: [{ text: 'chunk one' }, { text: 'chunk two' }],
                    mainChunks: [{ text: 'summary one' }, { text: 'summary two' }],
                },
            }],
            additionalAssets: [],
        }],
        modules: [],
        enabledModules: [],
        botPresets: [],
        botPresetsId: 0,
        hotkeys: [],
    } as unknown as Database
}

async function openViewer(produce: () => unknown): Promise<HTMLElement> {
    vi.useFakeTimers()
    arrangeViewerDatabase()
    getFetchDataSpy.mockReturnValue({ url: 'https://x.invalid/v1', body: JSON_BODY, response: JSON_BODY })
    getFetchLogsSpy.mockReturnValue(LOGS)
    const target = mountAlertComp()
    await settle()
    void produce()
    await settle()
    return target
}

const openRequestData = (genInfo: GenInfo = GEN_INFO): Promise<HTMLElement> =>
    openViewer(() => alertRequestData({ genInfo, idx: 0 } as never))
const openHypa = (): Promise<HTMLElement> => openViewer(() => showHypaV2Alert())
const openLogs = (): Promise<HTMLElement> => openViewer(() => alertRequestLogs())

function buttonByText(target: HTMLElement, label: string): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
    if (!found) throw new Error(`no button named "${label}" is mounted`)
    return found
}

async function pick(target: HTMLElement, label: string): Promise<void> {
    buttonByText(target, label).click()
    await settle()
}

const PALETTE = /^(?:[a-z-]+:)*(?:text|bg|border|ring|from|to|via|fill|stroke)-(?:gray|red|green|blue|stone|amber|yellow|cyan|purple|slate|zinc|neutral|orange|white|black)(?:-\d+)?(?:\/\d+)?$/
const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i

/** Every palette utility class and every inline colour literal under `root`, as `tag.token` strings. */
function paletteLeaks(root: HTMLElement): string[] {
    const found: string[] = []
    for (const el of Array.from(root.querySelectorAll('*'))) {
        for (const token of Array.from(el.classList)) {
            if (PALETTE.test(token)) found.push(`${el.tagName.toLowerCase()}.${token}`)
        }
        const style = el.getAttribute('style') ?? ''
        if (COLOUR_LITERAL.test(style)) found.push(`${el.tagName.toLowerCase()}[style=${style}]`)
    }
    return found
}

function headlineOf(target: HTMLElement): HTMLElement | null {
    return target.querySelector<HTMLElement>('h2[data-part="pattern-warn-headline"]')
}

describe('the data viewers paint with theme tokens only', () => {
    test('requestdata: no palette class and no colour literal in any of its four tabs', async () => {
        aiLawAppliesSpy.mockReturnValue(true)
        const target = await openRequestData()
        const found: string[] = []
        for (const tab of [language.tokens, language.metaData, language.log, language.prompt]) {
            await pick(target, tab)
            found.push(...paletteLeaks(target).map((leak) => `${tab}: ${leak}`))
        }
        expect(found).toEqual([])
    })

    test('hypaV2: no palette class and no colour literal in either tab', async () => {
        const target = await openHypa()
        const found: string[] = []
        for (const tab of ['Chunks', language.alertComp.summarized]) {
            await pick(target, tab)
            found.push(...paletteLeaks(target).map((leak) => `${tab}: ${leak}`))
        }
        expect(found).toEqual([])
    })

    test('requestlogs: no palette class and no colour literal with every row expanded', async () => {
        const target = await openLogs()
        await pick(target, language.expandAll)
        expect(paletteLeaks(target)).toEqual([])
    })
})

describe('requestlogs sits in the shared dialog box', () => {
    test('the box is the pattern dialog: a wide, labelled, modal dialog named by the log headline', async () => {
        const target = await openLogs()

        const dialog = target.querySelector<HTMLElement>('[data-part="pattern-dialog"]')!
        expect(dialog.matches('[data-alert-box]'), 'the dialog is the focus box').toBe(true)
        expect(dialog.getAttribute('role')).toBe('dialog')
        expect(dialog.getAttribute('aria-modal')).toBe('true')
        expect(dialog.getAttribute('data-alert-size')).toBe('wide')
        const headline = headlineOf(target)
        expect(headline?.textContent).toBe(language.ShowLog)
        expect(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')).toBe(headline)
        expect(dialog.getAttribute('aria-describedby'), 'no message element to point at').toBeNull()
    })

    test('each summary announces whether its row is expanded', async () => {
        const target = await openLogs()
        const summary = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.includes(LOGS[0].url))!

        expect(summary.getAttribute('aria-expanded')).toBe('false')
        summary.click()
        await settle()
        expect(summary.getAttribute('aria-expanded')).toBe('true')
        const other = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.includes(LOGS[1].url))!
        expect(other.getAttribute('aria-expanded'), 'a sibling row stays collapsed').toBe('false')
    })

    test('a status says OK or ERR with its code and a glyph, and carries its state as data', async () => {
        const target = await openLogs()
        const statuses = Array.from(target.querySelectorAll<HTMLElement>('[data-part="pattern-alert-log-status"]'))

        expect(statuses.map((s) => s.getAttribute('data-state'))).toEqual(['ok', 'err'])
        expect(statuses.map((s) => s.textContent?.trim())).toEqual(['200', '500'])
        expect(statuses.every((s) => s.querySelector('svg') !== null), 'a glyph, not a colour alone').toBe(true)
    })

    test('a log without a status code falls back to OK or ERR', async () => {
        getFetchLogsSpy.mockReturnValue([])
        const target = await openLogs()
        getFetchLogsSpy.mockReturnValue([{ ...LOGS[0], status: undefined }, { ...LOGS[1], status: undefined }])
        alertStore.set({ type: 'none', msg: '' } as never)
        await settle()
        void alertRequestLogs()
        await settle()

        const statuses = Array.from(target.querySelectorAll('[data-part="pattern-alert-log-status"]')).map((s) => s.textContent?.trim())
        expect(statuses).toEqual(['OK', 'ERR'])
    })

    test('the empty state says there are no logs', async () => {
        const target = await openViewer(() => {
            getFetchLogsSpy.mockReturnValue([])
            return alertRequestLogs()
        })
        expect(target.textContent).toContain(language.noRequestLogs)
        expect(target.querySelector('[data-part="pattern-alert-log"]')).toBeNull()
    })
})

describe('the data viewers carry a headline and a named close in the head', () => {
    test('requestdata is named Request info, by an h2 the dialog is labelled by', async () => {
        const target = await openRequestData()

        const headline = headlineOf(target)
        expect(headline?.textContent).toBe('Request info')
        const dialog = target.querySelector<HTMLElement>('[data-part="pattern-dialog"][data-alert-box]')!
        expect(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')).toBe(headline)
    })

    test('hypaV2 is named by its modal headline and a summary shows the active state on the first chunk only', async () => {
        const target = await openHypa()
        const headline = headlineOf(target)
        expect(headline?.textContent).toBe(language.hypaMemoryV2Modal)
        const dialog = target.querySelector<HTMLElement>('[data-part="pattern-dialog"][data-alert-box]')!
        expect(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')).toBe(headline)

        await pick(target, language.alertComp.summarized)
        const chunks = Array.from(target.querySelectorAll<HTMLElement>('[data-part="pattern-alert-chunk"]'))
        expect(chunks.map((c) => c.getAttribute('data-state'))).toEqual(['active', null])
        expect(chunks.map((c) => c.querySelector('[data-part="pattern-alert-chunk-label"]')?.textContent?.trim())).toEqual([language.active, language.alertComp.inactive])
    })

    test.each([
        ['requestdata', () => openRequestData()],
        ['hypaV2', () => openHypa()],
        ['requestlogs', () => openLogs()],
    ])('%s closes from a named close button inside the head, drawn with the X icon', async (_type, open) => {
        const target = await open()

        const close = target.querySelector<HTMLButtonElement>('[data-part="pattern-alert-head"] > button[data-part="pattern-alert-close"]')
        expect(close, 'the close sits in the head').not.toBeNull()
        expect(controlName(close!)).toBe(language.uiCommon.close)
        expect(close!.getAttribute('type')).toBe('button')
        expect(close!.querySelector('svg')).not.toBeNull()
        expect(target.querySelectorAll(`button[aria-label="${language.uiCommon.close}"]`)).toHaveLength(1)
        close!.click()
        await settle()
        expect(target.querySelector('[data-part="pattern-dialog"]')).toBeNull()
    })
})

describe('requestdata: the token meter', () => {
    const meterOf = (target: HTMLElement): HTMLElement => target.querySelector<HTMLElement>('[data-part="pattern-alert-meter"]')!
    const fractions = (target: HTMLElement): [string, string] => {
        const meter = meterOf(target)
        return [meter.style.getPropertyValue('--p-in'), meter.style.getPropertyValue('--p-out')]
    }

    test('the input and output fractions of the context are written as custom properties', async () => {
        const target = await openRequestData({ inputTokens: 1, outputTokens: 1, maxContext: 10, model: 'm', generationId: 'g' })

        expect(fractions(target)).toEqual(['0.1', '0.1'])
        const legend = target.querySelector('[data-part="pattern-alert-legend"]')!
        expect(legend.textContent).toContain(language.inputTokens)
        expect(legend.textContent).toContain(language.outputTokens)
        expect(legend.textContent).toContain(language.maxContextSize)
        expect(legend.textContent).toContain(`10 ${language.tokens}`)
    })

    test('a missing context size draws an empty meter, never NaN', async () => {
        const target = await openRequestData({ inputTokens: 5, outputTokens: 5, model: 'm', generationId: 'g' })

        expect(fractions(target)).toEqual(['0', '0'])
        expect(target.querySelector('[data-part="pattern-alert-legend"]')!.textContent).toContain(`? ${language.tokens}`)
    })

    test('an input beyond the context fills the meter and leaves no room for the output', async () => {
        const target = await openRequestData({ inputTokens: 20, outputTokens: 5, maxContext: 10, model: 'm', generationId: 'g' })

        expect(fractions(target)).toEqual(['1', '0'])
    })

    test('the meter is decoration: the legend carries the numbers', async () => {
        const target = await openRequestData()

        expect(meterOf(target).getAttribute('aria-hidden')).toBe('true')
        expect(target.querySelector('[data-part="pattern-alert-legend"]')!.textContent).toContain(`1234 ${language.tokens}`)
    })
})

describe('the data viewers are made of the pinned parts', () => {
    test('requestlogs: a toolbar, one log per row, and a code panel with a copy button per field when expanded', async () => {
        const target = await openLogs()
        await pick(target, language.expandAll)

        expect(partsOf(target)).toEqual(VIEWER_PARTS.requestlogs)
        expect(target.querySelectorAll('[data-part="pattern-alert-code"]')).toHaveLength(8)
        expect(target.querySelectorAll('[data-part="pattern-alert-copy"]')).toHaveLength(8)
    })

    test('requestdata: the Tokens tab', async () => {
        const target = await openRequestData()

        expect(partsOf(target)).toEqual(VIEWER_PARTS.requestdataTokens)
        const tabs = Array.from(target.querySelectorAll<HTMLElement>('[data-part="pattern-alert-tab"]'))
        expect(tabs.map((t) => t.textContent?.trim())).toEqual([language.tokens, language.metaData, language.log, language.prompt])
        expect(tabs.map((t) => t.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false'])
    })

    test('requestdata: the Log tab shows the url, the body and the response as code panels, the body highlighted', async () => {
        const target = await openRequestData()
        await pick(target, language.log)

        const panels = Array.from(target.querySelectorAll<HTMLElement>('[data-part="pattern-alert-code"]'))
        expect(panels).toHaveLength(3)
        expect(panels[0].textContent).toBe('https://x.invalid/v1')
        expect(panels[1].querySelector('.hljs-attr'), 'a JSON key is highlighted').not.toBeNull()
        expect(partsOf(target)).toEqual(VIEWER_PARTS.requestdataLog)
    })

    test('requestdata: the Meta Data tab is a definition list', async () => {
        const target = await openRequestData()
        await pick(target, language.metaData)

        expect(partsOf(target)).toEqual(VIEWER_PARTS.requestdataMeta)
        const facts = target.querySelector('dl[data-part="pattern-alert-facts"]')!
        expect(facts.textContent).toContain('model-x')
        expect(facts.textContent).toContain('chat-id-1')
        expect(facts.textContent).toContain('10.0s')
    })

    test('requestdata: the Prompt tab', async () => {
        const target = await openRequestData()
        await pick(target, language.prompt)

        expect(partsOf(target)).toEqual(VIEWER_PARTS.requestdataPrompt)
        expect(target.textContent).toContain('Preset A')
        expect(target.textContent).toContain('toggle-one')
        expect(target.textContent).toContain('You are a helpful narrator.')
    })

    test('hypaV2: tabs, a textarea per chunk, and the pinned parts in the Summarized tab', async () => {
        const target = await openHypa()
        expect(partsOf(target)).toEqual(VIEWER_PARTS.hypaChunks)

        await pick(target, language.alertComp.summarized)
        expect(partsOf(target)).toEqual(VIEWER_PARTS.hypaSummarized)
    })
})

//#endregion

//#region cardexport and the two prompts

const PEER_ROWS = [
    { id: 'a', label: 'Setting: zoomsize', choices: ['mine', 'theirs', 'both'], preselect: 'both', note: 'restore note' },
    { id: 'c', label: 'Ann was deleted there', choices: ['mine', 'theirs'], preselect: 'mine', note: null },
]
const PARKED = { name: 'Alice', text: 'The reply text' }

const openExport = (submsg = ''): Promise<HTMLElement> => openViewer(() => alertCardExport(submsg))
const openPeerConflicts = (): Promise<HTMLElement> =>
    openViewer(() => askPrompt({ type: 'peerConflicts', msg: 'Conflicts', peerConflicts: PEER_ROWS } as never))
const openParkedReply = (): Promise<HTMLElement> =>
    openViewer(() => askPrompt({ type: 'parkedReply', msg: language.parkedReplyTitle, parkedReply: PARKED }))

/** The part names of the export dialog and the two prompts, pinned because a theme pack hooks onto them. */
const PROMPT_SHELL = SHELL_PARTS.filter((part) => part !== 'pattern-warn-headline')
const EXPORT_SHELL = [...SHELL_PARTS, 'pattern-alert-close']
const PROMPT_PARTS = {
    cardexport: sorted(EXPORT_SHELL, ['pattern-alert-stack', 'pattern-alert-field-label', 'pattern-alert-tiles', 'pattern-alert-tile', 'pattern-alert-note']),
    cardexportWarning: sorted(EXPORT_SHELL, ['pattern-alert-stack', 'pattern-alert-field-label', 'pattern-alert-tiles', 'pattern-alert-tile', 'pattern-alert-note', 'pattern-alert-warning', 'pattern-alert-warning-mark']),
    peerConflicts: sorted(PROMPT_SHELL, ['pattern-alert-stack', 'pattern-alert-title', 'pattern-alert-bulk', 'pattern-alert-conflict', 'pattern-alert-choice', 'pattern-alert-note']),
    parkedReply: sorted(PROMPT_SHELL, ['pattern-alert-stack', 'pattern-alert-title', 'pattern-alert-text', 'pattern-alert-reply', 'pattern-alert-reply-tools']),
}

describe('cardexport sits in the shared dialog box', () => {
    test('the box is the pattern dialog: a wide, labelled, modal dialog named by the share headline, with a named close', async () => {
        const target = await openExport()

        const dialog = dialogOf(target)
        expect(dialog.getAttribute('role')).toBe('dialog')
        expect(dialog.getAttribute('aria-modal')).toBe('true')
        expect(dialog.getAttribute('data-alert-size')).toBe('wide')
        const headline = headlineOf(target)!
        expect(headline.textContent).toBe(language.shareExport)
        expect(dialog.getAttribute('aria-labelledby')).toBe(headline.id)
        const close = target.querySelector<HTMLElement>('[data-part="pattern-alert-close"]')!
        expect(close.getAttribute('aria-label')).toBe(language.uiCommon.close)
        expect(close.querySelector('svg')).not.toBeNull()
        expect(document.activeElement === dialog || dialog.contains(document.activeElement)).toBe(true)
    })

    test('the backdrop is inert (MC-3222): no element but a real button has the button role, and the layer and scrim are not focusable', async () => {
        const target = await openExport()

        expect(Array.from(target.querySelectorAll('[role="button"]')).filter((el) => el.tagName !== 'BUTTON')).toEqual([])
        const layer = target.querySelector<HTMLElement>('[data-part="pattern-layer"]')!
        const scrim = target.querySelector<HTMLElement>('[data-part="pattern-scrim"]')!
        expect(layer.hasAttribute('tabindex')).toBe(false)
        expect(scrim.hasAttribute('tabindex')).toBe(false)
        expect(dialogOf(target).getAttribute('role')).not.toBe('button')
    })

    test('tapping the layer, the scrim or the dialog body answers nothing, closes nothing and leaves the dialog up', async () => {
        const target = await openExport()
        const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {})
        const before = JSON.stringify(get(alertStore))

        for (const el of [
            target.querySelector<HTMLElement>('[data-part="pattern-layer"]')!,
            target.querySelector<HTMLElement>('[data-part="pattern-scrim"]')!,
            dialogOf(target),
        ]) {
            el.click()
            await settle()
        }

        expect(closeSpy).not.toHaveBeenCalled()
        expect(JSON.stringify(get(alertStore))).toBe(before)
        expect(get(alertStore).type).toBe('cardexport')
        expect(target.querySelector('[data-part="pattern-dialog"][data-alert-box]')).not.toBeNull()
        closeSpy.mockRestore()
    })

    test('the tiles keep their pressed state and ring, and the description follows the tiles', async () => {
        const target = await openExport()

        const tiles = Array.from(target.querySelectorAll<HTMLElement>('[data-part="pattern-alert-tile"]'))
        expect(tiles.map((t) => t.textContent?.trim())).toEqual(['RisuRealm', 'Character Card V3', 'Character Card V2'])
        expect(tiles.map((t) => t.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
        const note = target.querySelector('[data-part="pattern-alert-note"]')!
        expect(note.textContent).toBe(language.realmDesc)
        expect(tiles[2].compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

        await pick(target, 'Character Card V2')
        expect(target.querySelector('[data-part="pattern-alert-warning"]')?.textContent).toContain(language.v2Warning)
        expect(Array.from(target.querySelectorAll('[data-part="pattern-alert-tile"]')).map((t) => t.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true'])
    })

    test('the footer holds one confirm button that names the action', async () => {
        const target = await openExport()

        const actions = target.querySelector('[data-part="pattern-warn-actions"]')!
        const buttons = Array.from(actions.querySelectorAll('button'))
        expect(buttons).toHaveLength(1)
        expect(buttons[0].getAttribute('data-variant')).toBe('confirm')
        expect(buttons[0].textContent?.trim()).toBe(language.shareCloud)
        await pick(target, 'Character Card V2')
        expect(actions.querySelector('button')?.textContent?.trim()).toBe(language.export)
    })
})

describe('the prompts are named by their titles', () => {
    test('peerConflicts: the dialog is labelled by exactly the title', async () => {
        const target = await openPeerConflicts()

        const labelled = document.getElementById(dialogOf(target).getAttribute('aria-labelledby') ?? '')
        expect(labelled?.textContent?.trim()).toBe('Conflicts')
        expect(labelled?.hasAttribute('data-peer-conflicts')).toBe(false)
    })

    test('parkedReply: the dialog is labelled by exactly the title', async () => {
        const target = await openParkedReply()

        const labelled = document.getElementById(dialogOf(target).getAttribute('aria-labelledby') ?? '')
        expect(labelled?.textContent?.trim()).toBe(language.parkedReplyTitle)
        expect(labelled?.hasAttribute('data-parked-reply')).toBe(false)
    })
})

describe('peerConflicts: Apply', () => {
    test('Apply is the only button of the footer and carries the confirm fill; the same-for-all buttons are quiet', async () => {
        const target = await openPeerConflicts()

        const footer = Array.from(target.querySelector('[data-part="pattern-warn-actions"]')!.querySelectorAll('button'))
        expect(footer.map((b) => b.textContent?.trim())).toEqual([language.store2Boot.peerConflictApply])
        expect(footer[0].getAttribute('data-variant')).toBe('confirm')
        const bulk = Array.from(target.querySelectorAll('[data-part="pattern-alert-bulk"] button'))
        expect(bulk).toHaveLength(3)
        for (const button of bulk) {
            expect(button.classList.contains('pattern-button')).toBe(true)
            expect(button.hasAttribute('data-variant')).toBe(false)
        }
    })
})

describe('parkedReply: the buttons (MC-3225)', () => {
    test('Later is the filled confirm button on the right, Discard the neutral one before it, Copy and Save are quiet', async () => {
        const target = await openParkedReply()

        const actions = Array.from(target.querySelector('[data-part="pattern-warn-actions"]')!.querySelectorAll('button'))
        expect(actions.map((b) => b.textContent?.trim())).toEqual([language.parkedReplyDiscard, language.parkedReplyLater])
        const [discard, later] = actions
        expect(later.classList.contains('pattern-button')).toBe(true)
        expect(later.getAttribute('data-variant')).toBe('confirm')
        expect(discard.classList.contains('pattern-button')).toBe(true)
        expect(discard.hasAttribute('data-variant')).toBe(false)
        for (const label of [language.copy, language.parkedReplySaveTxt]) {
            const quiet = buttonByText(target, label)
            expect(quiet.classList.contains('pattern-button'), `${label} is a pattern button`).toBe(true)
            expect(quiet.hasAttribute('data-variant'), `${label} is quiet`).toBe(false)
        }
    })
})

describe('the export dialog and the two prompts paint with theme tokens only', () => {
    test('cardexport as Character Card V2 carries no palette class and no colour literal', async () => {
        const target = await openExport()
        await pick(target, 'Character Card V2')
        expect(target.querySelector('[data-part="pattern-alert-warning"]')).not.toBeNull()
        expect(paletteLeaks(target)).toEqual([])
    })

    test('cardexport of a preset with an image carries no palette class and no colour literal', async () => {
        const target = await openExport('preset')
        ;(DBState.db as unknown as Record<string, unknown>).botPresets = [{ name: 'p', image: 'img', regex: [] }]
        await settle()
        expect(paletteLeaks(target)).toEqual([])
    })

    test('peerConflicts carries no palette class and no colour literal', async () => {
        expect(paletteLeaks(await openPeerConflicts())).toEqual([])
    })

    test('parkedReply carries no palette class and no colour literal', async () => {
        expect(paletteLeaks(await openParkedReply())).toEqual([])
    })
})

describe('the export dialog and the two prompts are made of the pinned parts', () => {
    test('cardexport: tiles, a description and a footer', async () => {
        expect(partsOf(await openExport())).toEqual(PROMPT_PARTS.cardexport)
    })

    test('cardexport: a warning line carries its mark', async () => {
        const target = await openExport()
        await pick(target, 'Character Card V2')
        expect(partsOf(target)).toEqual(PROMPT_PARTS.cardexportWarning)
    })

    test('peerConflicts: a title, the same-for-all row, a fieldset per record and Apply', async () => {
        const target = await openPeerConflicts()
        expect(partsOf(target)).toEqual(PROMPT_PARTS.peerConflicts)
        expect(target.querySelectorAll('[data-conflict-row]')).toHaveLength(2)
        expect(target.querySelectorAll('[data-conflict-note]')).toHaveLength(1)
    })

    test('parkedReply: a title, the body, the reply panel with its tools, and the footer', async () => {
        const target = await openParkedReply()
        expect(partsOf(target)).toEqual(PROMPT_PARTS.parkedReply)
        expect(target.querySelector('[data-parked-reply-text]')?.textContent).toBe(PARKED.text)
        expect(target.querySelector('[role="status"][data-parked-reply-status]')).not.toBeNull()
    })
})

//#endregion

//#region branches and selectModule

/** Four nodes that between them draw every link kind: a root, a straight run, a branch with its elbow, and a second straight run. */
const BRANCH_NODES = [
    { x: 0, y: 0, chatId: 0, connectX: -1, connectY: -1, multiChild: false, content: '' },
    { x: 0, y: 1, chatId: 0, connectX: 0, connectY: 0, multiChild: true, content: '' },
    { x: 1, y: 1, chatId: 1, connectX: 0, connectY: 0, multiChild: true, content: '' },
    { x: 0, y: 2, chatId: 0, connectX: 0, connectY: 1, multiChild: false, content: '' },
]
const BRANCH_SHELL = [...SHELL_PARTS.filter((part) => part !== 'pattern-warn-actions'), 'pattern-alert-close']
const BRANCH_PARTS = sorted(BRANCH_SHELL, ['pattern-alert-tree', 'pattern-alert-tree-node', 'pattern-alert-tree-link', 'pattern-alert-tree-preview'])

async function openBranchTree(): Promise<HTMLElement> {
    vi.useFakeTimers()
    arrangeViewerDatabase()
    const owner = DBState.db.characters[0] as unknown as Record<string, unknown>
    owner.firstMessage = 'Hello'
    owner.alternateGreetings = []
    owner.chats = [
        { message: [{ role: 'user', data: 'one' }, { role: 'char', data: 'two' }] },
        { message: [{ role: 'user', data: 'other' }] },
    ]
    vi.mocked(getChatBranches).mockReturnValue(BRANCH_NODES as never)
    const target = mountAlertComp()
    await settle()
    alertStore.set({ type: 'branches', msg: '' } as never)
    await settle()
    return target
}

describe('branches sits in the shared dialog box', () => {
    afterEach(() => {
        vi.mocked(getChatBranches).mockReturnValue([])
    })

    test('the box is the pattern dialog: a wide, labelled, modal dialog named by the branches headline, with a named close', async () => {
        const target = await openBranchTree()

        const dialog = dialogOf(target)
        expect(dialog.getAttribute('role')).toBe('dialog')
        expect(dialog.getAttribute('aria-modal')).toBe('true')
        expect(dialog.getAttribute('data-alert-size')).toBe('wide')
        const headline = headlineOf(target)!
        expect(headline.textContent).toBe(language.chatShellBranches)
        expect(dialog.getAttribute('aria-labelledby')).toBe(headline.id)
        expect(dialog.getAttribute('aria-describedby')).toBeNull()
        const close = target.querySelector<HTMLElement>('[data-part="pattern-alert-close"]')!
        expect(close.getAttribute('aria-label')).toBe(language.uiCommon.close)
        expect(close.querySelector('svg')).not.toBeNull()
        expect(document.activeElement).toBe(dialog)
    })

    test('the tree carries no ARIA role and its links are empty, role-less elements', async () => {
        const target = await openBranchTree()

        expect(target.querySelector('[data-part="pattern-alert-tree"]')!.hasAttribute('role')).toBe(false)
        const links = Array.from(target.querySelectorAll('[data-part="pattern-alert-tree-link"]'))
        expect(links.map((link) => link.getAttribute('data-kind'))).toEqual(['branch', 'branch', 'branch', 'line'])
        for (const link of links) {
            expect(link.hasAttribute('role')).toBe(false)
            expect(link.childElementCount + (link.textContent?.length ?? 0)).toBe(0)
        }
    })

    test('the tree paints with theme tokens only: no palette class and no colour literal, with the preview open', async () => {
        const target = await openBranchTree()
        target.querySelector('[data-part="pattern-alert-tree-node"]')!.dispatchEvent(new MouseEvent('mouseenter'))
        await settle()

        expect(target.querySelector('[data-part="pattern-alert-tree-preview"]')).not.toBeNull()
        expect(paletteLeaks(target)).toEqual([])
    })

    test('the tree is made of the pinned parts', async () => {
        const target = await openBranchTree()
        target.querySelector('[data-part="pattern-alert-tree-node"]')!.dispatchEvent(new MouseEvent('mouseenter'))
        await settle()

        expect(partsOf(target)).toEqual(BRANCH_PARTS)
    })
})

describe('selectModule stays as it was (MC-3226)', () => {
    test('guard: it renders the module menu with no pattern layer around it and no alert part inside it (passes before and after)', async () => {
        vi.useFakeTimers()
        arrangeViewerDatabase()
        const target = mountAlertComp()
        await settle()
        void alertModuleSelect()
        await settle()

        expect(target.querySelector('[data-part="pattern-layer"]')).toBeNull()
        expect(target.querySelector('[data-part^="pattern-alert-"]')).toBeNull()
        expect(target.querySelector('[data-part="pattern-dialog"]')).toBeNull()
    })
})

//#endregion
