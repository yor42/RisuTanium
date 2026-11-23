// @vitest-environment happy-dom

/**
 * The word labels of the tool dialogs of `AlertComp.svelte` (the Chunks tab, the request body, header and
 * response panels, and the Bytes suffix of the size row) come from the language layer, not from literals.
 * Each key of `language.alertComp` is overwritten with a sentinel before the dialog opens: a label that
 * still shows the English literal ignores the language layer.
 *
 * Drives the REAL `AlertComp.svelte` over a real `writable` standing in for `alertStore`. The module mocks copy
 * `AlertComp.tools.svelte.test.ts`: none of it is exercised here, the component needs it to mount.
 *
 * Tests whose title starts with `regression reproducer:` fail while a label is a hard-coded English literal.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'
import 'src/ts/polyfill'

//#region module mocks (see file header)

const { getFetchLogsSpy, getFetchDataSpy } = vi.hoisted(() => ({
    getFetchLogsSpy: vi.fn(() => [] as unknown[]),
    getFetchDataSpy: vi.fn(() => ({}) as unknown),
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
            getFetchLogs: getFetchLogsSpy,
            getFetchData: getFetchDataSpy,
            aiLawApplies: vi.fn(() => false),
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
import { changeLanguage, language } from 'src/lang'
import { languageEnglish } from '../../lang/en'
import { languageKorean } from '../../lang/ko'
import { alertStore, DBState } from '../../ts/stores.svelte'
import { resetAlertPromptsForTests } from '../../ts/alertPrompts'
import { alertRequestData, alertRequestLogs, showHypaV2Alert } from '../../ts/alert'
import AlertComp from './AlertComp.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

const LABEL_KEYS = ['chunks', 'requestBody', 'requestHeader', 'response', 'bytes'] as const
type LabelKey = typeof LABEL_KEYS[number]
const ENGLISH: Record<LabelKey, string> = {
    chunks: 'Chunks',
    requestBody: 'Request Body',
    requestHeader: 'Request Header',
    response: 'Response',
    bytes: 'Bytes',
}
const SENTINEL: Record<LabelKey, string> = {
    chunks: 'S1-chunks-label',
    requestBody: 'S2-request-body-label',
    requestHeader: 'S3-request-header-label',
    response: 'S4-response-label',
    bytes: 'S5-bytes-label',
}

type LabelTable = Record<string, string | undefined>
const englishLabels = languageEnglish.alertComp as unknown as LabelTable
const original: LabelTable = {}
for (const key of LABEL_KEYS) original[key] = englishLabels[key]

function useSentinels(): void {
    for (const key of LABEL_KEYS) englishLabels[key] = SENTINEL[key]
}

async function settle(): Promise<void> {
    flushSync()
    await tickFake()
    flushSync()
    await Promise.resolve()
}

function arrangeDatabase(): void {
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
                }],
                hypaV2Data: {
                    chunks: [{ text: 'chunk one' }],
                    mainChunks: [{ text: 'summary one' }],
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

const GEN_INFO = {
    inputTokens: 1,
    outputTokens: 1,
    maxContext: 10,
    model: 'model-x',
    generationId: 'g',
}
const LOGS = [
    { url: 'https://a.invalid/v1/one', body: '{"b":1}', header: '{"h":"1"}', response: '{"r":1}', success: true, status: 200, date: '10:41' },
]

async function openViewer(produce: () => unknown): Promise<HTMLElement> {
    vi.useFakeTimers()
    arrangeDatabase()
    getFetchDataSpy.mockReturnValue({ url: 'https://x.invalid/v1', body: '{"a":"b"}', response: '{"r":1}' })
    getFetchLogsSpy.mockReturnValue(LOGS)
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(AlertComp, { target, props: {} }))
    await settle()
    void produce()
    await settle()
    return target
}

async function pick(target: HTMLElement, label: string): Promise<void> {
    const found = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
    if (!found) throw new Error(`no button named "${label}" is mounted`)
    found.click()
    await settle()
}

const codeLabels = (target: HTMLElement): (string | undefined)[] =>
    Array.from(target.querySelectorAll('[data-part="pattern-alert-code-label"]')).map((l) => l.textContent?.trim())

/** The text of the requestdata Log and Meta Data tabs, the hypaV2 tabs and the expanded request logs. */
async function collectTexts(): Promise<string> {
    const texts: string[] = []
    const requestData = await openViewer(() => alertRequestData({ genInfo: GEN_INFO, idx: 0 } as never))
    await pick(requestData, language.log)
    texts.push(requestData.textContent ?? '')
    await pick(requestData, language.metaData)
    texts.push(requestData.textContent ?? '')

    alertStore.set({ type: 'none', msg: '' } as never)
    await settle()
    const hypa = await openViewer(() => showHypaV2Alert())
    texts.push(Array.from(hypa.querySelectorAll('button')).map((b) => b.textContent?.trim()).join('|'))

    alertStore.set({ type: 'none', msg: '' } as never)
    await settle()
    const logs = await openViewer(() => alertRequestLogs())
    await pick(logs, language.expandAll)
    texts.push(logs.textContent ?? '')
    return texts.join('\n')
}

afterEach(async () => {
    for (const key of LABEL_KEYS) {
        if (original[key] === undefined) delete englishLabels[key]
        else englishLabels[key] = original[key]
    }
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    vi.useRealTimers()
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' } as never)
    changeLanguage('en')
    vi.clearAllMocks()
    getFetchLogsSpy.mockReset()
    getFetchLogsSpy.mockReturnValue([])
    getFetchDataSpy.mockReset()
    getFetchDataSpy.mockReturnValue({})
})

describe('tool dialog word labels come from the language layer', () => {
    test('regression reproducer: every label renders its language-layer value and no English literal', async () => {
        useSentinels()
        const text = await collectTexts()

        for (const key of LABEL_KEYS) {
            expect(text, `${key} sentinel renders`).toContain(SENTINEL[key])
        }
        for (const key of LABEL_KEYS) {
            expect(text, `English "${ENGLISH[key]}" does not render`).not.toContain(ENGLISH[key])
        }
    })

    test('regression reproducer: the Chunks tab is named by the language layer', async () => {
        useSentinels()
        const hypa = await openViewer(() => showHypaV2Alert())
        const tabs = Array.from(hypa.querySelectorAll('button')).map((b) => b.textContent?.trim())
        expect(tabs).toContain(SENTINEL.chunks)
        expect(tabs).not.toContain(ENGLISH.chunks)
    })

    test('regression reproducer: the requestdata Log tab labels its body and response panels', async () => {
        useSentinels()
        const target = await openViewer(() => alertRequestData({ genInfo: GEN_INFO, idx: 0 } as never))
        await pick(target, language.log)
        const labels = codeLabels(target)
        expect(labels).toContain(SENTINEL.requestBody)
        expect(labels).toContain(SENTINEL.response)
        expect(labels).not.toContain(ENGLISH.requestBody)
        expect(labels).not.toContain(ENGLISH.response)
    })

    test('regression reproducer: the requestlogs detail labels body, header and response panels', async () => {
        useSentinels()
        const target = await openViewer(() => alertRequestLogs())
        await pick(target, language.expandAll)
        const labels = codeLabels(target)
        expect(labels).toContain(SENTINEL.requestBody)
        expect(labels).toContain(SENTINEL.requestHeader)
        expect(labels).toContain(SENTINEL.response)
        expect(labels).not.toContain(ENGLISH.requestHeader)
    })

    test('regression reproducer: the size row of the Meta Data tab ends in the Bytes label', async () => {
        useSentinels()
        const target = await openViewer(() => alertRequestData({ genInfo: GEN_INFO, idx: 0 } as never))
        await pick(target, language.metaData)
        const facts = target.querySelector('dl[data-part="pattern-alert-facts"]')!.textContent ?? ''
        expect(facts).toContain(SENTINEL.bytes)
        expect(facts).not.toContain(ENGLISH.bytes)
    })

    test('guard: Korean renders each label it translates and then never the English literal', async () => {
        const korean = languageKorean.alertComp as unknown as LabelTable
        const translated = LABEL_KEYS.filter((key) => korean[key] !== undefined && korean[key] !== ENGLISH[key])
        changeLanguage('ko')
        const text = await collectTexts()
        for (const key of translated) {
            expect(text, `ko ${key} renders`).toContain(korean[key]!)
            expect(text, `English "${ENGLISH[key]}" is gone in ko`).not.toContain(ENGLISH[key])
        }
    })
})
