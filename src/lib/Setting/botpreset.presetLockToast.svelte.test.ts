// @vitest-environment happy-dom

/**
 * The row click of the real `botpreset.svelte` over the real `changeToPreset`: a click on another preset posts the
 * kept-groups toast when a group is locked, a click on the already active preset switches nothing and posts nothing,
 * and no lock means no toast. The toast host's `post` is a spy on the real host; mocks as in
 * `botpreset.presetId.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { allRowsGeometry, setWindowGeometryForTests } from 'src/ts/windowing/windowHost.svelte'
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
        downloadFile: vi.fn(async () => true), saveAsset: vi.fn(), readImage: vi.fn(), toGetter: vi.fn((o: unknown) => o),
        aiWatermarkingLawApplies: vi.fn(() => false), aiLawApplies: vi.fn(() => false),
        hubURL: '',
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: vi.fn(async () => true),
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

vi.mock('src/ts/rpack/rpack_js', () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => data),
    decodeRPack: vi.fn(async (data: Uint8Array) => data),
}))

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

import { DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { toastHost } from 'src/ts/toast/toastHost.svelte'
import BotPreset from './botpreset.svelte'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

function installDb(extra: Record<string, unknown>): void {
    DBState.db = {
        formatversion: 5,
        botPresets: [0, 1].map((n) => ({ name: `P${n}`, aiModel: `m${n}`, id: `id-${n}` })),
        botPresetsId: 0,
        aiModel: 'm0',
        presetFolders: [],
        NAIsettings: {},
        showPromptComparison: false,
        ...extra,
    } as unknown as Database
}

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []
const close = vi.fn()

function mountPresets(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    setWindowGeometryForTests(allRowsGeometry())
    const app = mount(BotPreset, { target, props: { close } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

const rowsOf = (target: HTMLElement) => [...target.querySelectorAll<HTMLButtonElement>('[data-part="modal-row"]')]

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    vi.restoreAllMocks()
    close.mockClear()
})

describe('botpreset row click and the kept-groups toast', () => {
    test('clicking another preset with a group locked switches and posts the toast once', async () => {
        const post = vi.spyOn(toastHost, 'post')
        installDb({ presetFieldLocks: ['sampling'] })
        const target = mountPresets()
        await settle()
        rowsOf(target)[1].click()
        await settle()
        expect(DBState.db.botPresetsId).toBe(1)
        expect(post).toHaveBeenCalledTimes(1)
        expect(post).toHaveBeenCalledWith({ kind: 'info', text: language.presetLockKept(language.presetLockSampling) })
    })

    test('clicking the already active preset posts nothing, however many groups are locked', async () => {
        const post = vi.spyOn(toastHost, 'post')
        installDb({ presetFieldLocks: ['sampling'], doNotChangeFallbackModels: true })
        const target = mountPresets()
        await settle()
        rowsOf(target)[0].click()
        await settle()
        expect(DBState.db.botPresetsId).toBe(0)
        expect(post).not.toHaveBeenCalled()
    })

    test('a switch with no group locked posts nothing', async () => {
        const post = vi.spyOn(toastHost, 'post')
        installDb({})
        const target = mountPresets()
        await settle()
        rowsOf(target)[1].click()
        await settle()
        expect(DBState.db.botPresetsId).toBe(1)
        expect(post).not.toHaveBeenCalled()
    })
})
