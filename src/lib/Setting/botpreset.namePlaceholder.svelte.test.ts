// @vitest-environment happy-dom

/**
 * The preset-name input shown in the edit mode of `botpreset.svelte` carries the "Name"
 * placeholder of the active UI language, never a fixed type hint.
 *
 * Mounts the REAL `botpreset.svelte` over a real `$state` database. MOCKED: the storage,
 * platform, alert and store modules, as in `botpreset.unnamedPreset.svelte.test.ts`. Titles
 * beginning "regression reproducer:" fail against the version that shows the fixed text
 * "string".
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from 'src/ts/platform'

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const stub: Record<string, unknown> = {
        forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
        getFileSrc: vi.fn(async (loc: string) => `data:mock-image;loc=${loc}`),
        checkCharOrder: vi.fn(),
        requiresFullEncoderReload: { state: false },
        AppendableBuffer: class {}, VirtualWriter: class {}, LocalWriter: class {}, BlankWriter: class {},
        downloadFile: vi.fn(), saveAsset: vi.fn(), readImage: vi.fn(), toGetter: vi.fn((o: unknown) => o),
        aiWatermarkingLawApplies: vi.fn(() => false), aiLawApplies: vi.fn(() => false),
        hubURL: '', usingSw: false, isPlainHttpFileSrc: vi.fn(() => false),
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: async () => true,
        alertStore: writable({ type: 'none', msg: '' }),
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/storage/database.svelte'), async (importOriginal) => {
    const actual = await importOriginal()
    const { DBState } = await import('src/ts/stores.svelte')
    return { ...actual, getDatabase: vi.fn((_o?: { snapshot?: boolean }) => DBState.db) }
})

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false, isNodeServer: false, isIOS: () => false,
    getDetailedOSLabel: vi.fn(async () => 'test-os'), getFallbackOSLabel: vi.fn(() => 'test-os'),
    getRisuEnvironmentLabel: vi.fn((): RisuEnvironmentLabel => 'web'),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(),
    remove: vi.fn(), readDir: vi.fn(async () => []), BaseDirectory: { AppData: 0 },
}))

vi.mock('src/ts/tokenizer', () => ({ tokenizeAccurate: vi.fn(async () => 0) }))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        MobileGUIStack: writable([]), CharEmotion: writable(new Map()),
        OpenRealmStore: writable({ isOpen: false }), MobileSearch: writable(''),
        alertStore: writable({ type: 'none', msg: '' }),
        selIdState: { state: -1 }, SettingsMenuIndex: writable(0), ShowRealmFrameStore: writable(false),
        settingsOpen: writable(false), botMakerMode: writable(false), DynamicGUI: writable(false),
        sideBarClosing: writable(false), sideBarStore: writable({ tab: 0 }), PlaygroundStore: writable({ open: false }),
        QuickSettings: writable([]), additionalHamburgerMenu: writable([]), CharConfigSubMenu: writable(0),
        MobileGUI: writable(false), hypaV3ModalOpen: writable(false), ReloadGUIPointer: writable(0),
        bookmarkListOpen: writable(false), alertGenerationInfoStore: writable(null),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/characterCards'), () => ({
    openRealmUpload: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock('src/lib/Others/PromptDiffModal.svelte', () => ({ default: () => {} }))

//#endregion

import { changeLanguage } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'
import { DBState } from 'src/ts/stores.svelte'
import BotPreset from './botpreset.svelte'

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

/** Mounts the preset list, switches it to edit mode and returns the placeholders of its text inputs. */
function editModePlaceholders(): Array<string | null> {
    DBState.db = {
        formatversion: 5,
        botPresets: [{ name: 'Alpha', aiModel: 'm' }],
        botPresetsId: 0,
        aiModel: 'm',
        NAIsettings: {},
        showPromptComparison: false,
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(BotPreset, { target, props: { close: vi.fn() } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    const toolbar = Array.from(target.querySelectorAll('button')).filter((b) => b.className.includes('hover:text-green-500'))
    // The last toolbar button toggles the edit mode.
    toolbar[toolbar.length - 1].click()
    flushSync()
    return Array.from(target.querySelectorAll('input')).map((i) => i.getAttribute('placeholder'))
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    changeLanguage('en')
})

describe('the preset-name input in the edit mode of the preset list', () => {
    test('regression reproducer: English shows "Name" as the placeholder', () => {
        expect(editModePlaceholders()).toEqual(['Name'])
        expect(languageEnglish.name).toBe('Name')
    })

    test('regression reproducer: Korean shows the Korean "name" locale value as the placeholder', () => {
        changeLanguage('ko')
        expect(languageKorean.name).not.toBe(languageEnglish.name)
        expect(editModePlaceholders()).toEqual([languageKorean.name])
    })
})
