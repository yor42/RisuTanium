// @vitest-environment happy-dom

/**
 * The drag image of a bot preset row in `botpreset.svelte` is labelled with the preset's name,
 * and a preset with no name is labelled in the active UI language, never with a fixed English
 * text.
 *
 * Mounts the REAL `botpreset.svelte` over a real `$state` database. MOCKED: the storage,
 * platform, alert and store modules, as in `botpreset.deleteTarget.svelte.test.ts`. The
 * browser drag event is a plain event carrying a recording `dataTransfer`. Titles beginning
 * "guard:" pin behaviour that must be preserved before and after the change; every other test
 * is a regression reproducer for the behaviour it names.
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
        hubURL: '', usingSw: false,
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
import { DBState } from 'src/ts/stores.svelte'
import BotPreset from './botpreset.svelte'

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

function mountPresets(presetNames: string[]): HTMLElement {
    DBState.db = {
        formatversion: 5,
        botPresets: presetNames.map((name) => ({ name, aiModel: 'm' })),
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
    return target
}

/** Starts a drag on the preset row at `index` and returns the text of the drag image element. */
function dragLabel(target: HTMLElement, index: number): string | null {
    const rows = Array.from(target.querySelectorAll('button.draggable-preset')) as HTMLButtonElement[]
    const setDragImage = vi.fn()
    const event = new Event('dragstart', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', {
        value: { effectAllowed: '', types: [], setData: vi.fn(), setDragImage },
    })
    rows[index].dispatchEvent(event)
    flushSync()
    return setDragImage.mock.calls[0]?.[0]?.textContent ?? null
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    changeLanguage('en')
})

describe('the drag image of a bot preset row', () => {
    test('guard: a named preset is labelled with its name', () => {
        const target = mountPresets(['Alpha', 'Beta'])
        expect(dragLabel(target, 1)).toBe('Beta')
    })

    test('guard: English labels a nameless preset "Unnamed Preset"', () => {
        const target = mountPresets(['Alpha', ''])
        expect(dragLabel(target, 1)).toBe('Unnamed Preset')
    })

    test('regression reproducer: Korean labels a nameless preset in Korean', () => {
        changeLanguage('ko')
        const target = mountPresets(['Alpha', ''])
        expect(dragLabel(target, 1)).toBe('이름 없는 프리셋')
    })
})