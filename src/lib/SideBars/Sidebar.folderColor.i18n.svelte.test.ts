// @vitest-environment happy-dom

/**
 * Choosing "change folder colour" from a folder's context menu in `Sidebar.svelte` offers the
 * colour names in the UI language, and picking one stores the English lower-case colour on the
 * folder, because the folder styling matches on those English strings. The language is set
 * before mount and restored to English afterwards.
 *
 * Mounts the REAL `Sidebar.svelte`. Module mocks follow `Sidebar.closeButton.svelte.test.ts`
 * (same directory). MOCKED: `alertSelect` and `alertInput`, which answer from a queue and
 * record what they were offered, so no dialog opens.
 *
 * Tests whose title starts with `guard:` pass with or without the translation work.
 * Tests starting `regression reproducer:` fail while the offered names are English literals.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'

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
            getFetchLogs: vi.fn(() => []),
            getFetchData: vi.fn(() => ({})),
            aiLawApplies: vi.fn(() => false),
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('../../ts/stores.svelte')
    return {
        getDatabase: vi.fn(() => DBState.db),
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
        selectedCharID: writable(-1),
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
    } as unknown as typeof import('../../ts/stores.svelte')
})


const selectAnswers: string[] = []
const selectOffers: string[][] = []

vi.mock(import('src/ts/alert'), async (importOriginal) => ({
    ...(await importOriginal()),
    alertSelect: vi.fn(async (offered: string[]) => {
        selectOffers.push(offered)
        return selectAnswers.shift() ?? '3'
    }),
    alertInput: vi.fn(async () => ''),
}))
import { DBState } from '../../ts/stores.svelte'
import { changeLanguage, language } from '../../lang'
import { languageKorean } from '../../lang/ko'
import Sidebar from './Sidebar.svelte'

const STORED = ['red', 'green', 'blue', 'yellow', 'indigo', 'purple', 'pink', 'default']

interface FolderEntry {
    id: string
    name: string
    color: string
    data: string[]
}

function buildDb(folder: FolderEntry): Database {
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: [folder],
        characters: [],
        hideAllImages: false,
    } as unknown as Database
}

let mounted: { target: HTMLElement; app: Record<string, unknown> } | null = null

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        flushSync()
        await Promise.resolve()
    }
}

/** Opens the folder's context menu, picks "change colour", then picks the colour at `index`. */
async function pickFolderColor(answer: number | string): Promise<void> {
    selectAnswers.push('1', String(answer))
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(Sidebar, { target, props: {} }) as unknown as Record<string, unknown>
    mounted = { target, app }
    await settle()
    const avatar = target.querySelector('span.avatar') as HTMLElement
    avatar.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await settle()
    await new Promise((r) => setTimeout(r, 20))
    await settle()
}

beforeEach(() => {
    selectAnswers.length = 0
    selectOffers.length = 0
    DBState.db = buildDb({ id: 'f1', name: 'Folder', color: '', data: [] })
})

afterEach(async () => {
    if (mounted) {
        await unmount(mounted.app as never)
        mounted.target.remove()
        mounted = null
    }
    changeLanguage('en')
})

describe('folder colour select in the sidebar', () => {
    test('regression reproducer: Korean offers the colour names in Korean', async () => {
        changeLanguage('ko')
        await pickFolderColor(2)

        expect(selectOffers).toHaveLength(2)
        expect(selectOffers[0]).toEqual([language.renameFolder, language.changeFolderColor, language.changeFolderImage, language.cancel])
        const ko = languageKorean.sidebarUi
        expect(selectOffers[1]).toEqual([
            ko.folderColorRed,
            ko.folderColorGreen,
            ko.folderColorBlue,
            ko.folderColorYellow,
            ko.folderColorIndigo,
            ko.folderColorPurple,
            ko.folderColorPink,
            ko.folderColorDefault,
        ])
        expect(selectOffers[1]).not.toEqual(STORED)
    })

    test('guard: picking a colour in Korean stores the English lower-case colour for that position', async () => {
        changeLanguage('ko')
        await pickFolderColor(2)

        const stored = DBState.db.characterOrder[0] as unknown as FolderEntry
        expect(stored.color).toBe('blue')
    })

    test('guard: each position stores its own English colour', async () => {
        changeLanguage('ko')
        await pickFolderColor(7)

        const stored = DBState.db.characterOrder[0] as unknown as FolderEntry
        expect(stored.color).toBe('default')
    })

    test.each([['an empty answer', ''], ['an out-of-range index', '99'], ['a negative index', '-1']])('regression reproducer: %s leaves the folder colour unchanged and throws nothing', async (_label, answer) => {
        DBState.db = buildDb({ id: 'f1', name: 'Folder', color: 'red', data: [] })
        const unhandled: unknown[] = []
        const record = (reason: unknown) => { unhandled.push(reason) }
        process.on('unhandledRejection', record)
        try {
            await pickFolderColor(answer)
            await new Promise((r) => setTimeout(r, 20))
        } finally {
            process.off('unhandledRejection', record)
        }

        const stored = DBState.db.characterOrder[0] as unknown as FolderEntry
        expect(stored).toEqual({ id: 'f1', name: 'Folder', color: 'red', data: [] })
        expect(selectOffers).toHaveLength(2)
        expect(unhandled).toEqual([])
    })

    test('guard: English offers the English colour names and stores the picked one', async () => {
        await pickFolderColor(4)

        expect(selectOffers[1]).toEqual(STORED)
        const stored = DBState.db.characterOrder[0] as unknown as FolderEntry
        expect(stored.color).toBe('indigo')
    })
})