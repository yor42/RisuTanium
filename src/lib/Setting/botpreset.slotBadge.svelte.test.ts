// @vitest-environment happy-dom

/**
 * The number the legacy preset list shows beside a preset is the slot the Ctrl+n resolver (`presetIndexForSlot`) lands
 * on for that entry, never the list position: an entry whose slot is empty, invalid or a later duplicate shows none.
 * The real `botpreset.svelte` over the real `DBState` object.
 */
import { flushSync, mount, unmount } from 'svelte'
import { allRowsGeometry, setWindowGeometryForTests } from 'src/ts/windowing/windowHost.svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

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

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false, isNodeServer: false, isIOS: () => false,
    getDetailedOSLabel: vi.fn(async () => 'test-os'), getFallbackOSLabel: vi.fn(() => 'test-os'),
    getRisuEnvironmentLabel: vi.fn(() => 'web' as const),
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

import { DBState } from 'src/ts/stores.svelte'
import BotPreset from './botpreset.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function install(presets: Array<{ name: string, slot?: unknown }>): void {
    DBState.db = {
        formatversion: 5,
        botPresets: presets.map((preset, n) => ({ ...preset, id: `id-${n}` })),
        botPresetsId: 0,
        NAIsettings: {},
        showPromptComparison: false,
    } as unknown as Database
}

async function mountPresets(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    // The windowed rows mount once the host has read the band: every row falls in it, as these tests are not about which rows are in the page.
    setWindowGeometryForTests(allRowsGeometry())
    const app = mount(BotPreset, { target, props: { close: vi.fn() } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    await Promise.resolve()
    flushSync()
    await Promise.resolve()
    flushSync()
    return target
}

/** The badge text beside each preset name, or null when the row shows none. */
function badges(target: HTMLElement, names: string[]): Array<string | null> {
    return names.map((name) => {
        const label = Array.from(target.querySelectorAll('span')).find((span) => span.textContent === name && !span.className)
        const badge = label?.parentElement?.querySelector('span.w-2')
        return badge ? badge.textContent : null
    })
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('the legacy list slot badge', () => {
    test('L1 the badge is the slot the resolver lands on: slots 2, 1, none, and a later duplicate of 2 shows none', async () => {
        install([{ name: 'B', slot: 2 }, { name: 'A', slot: 1 }, { name: 'C' }, { name: 'D', slot: 2 }])
        expect(badges(await mountPresets(), ['B', 'A', 'C', 'D'])).toEqual(['2', '1', null, null])
    })

    test('an invalid slot value shows no number, and the position never does', async () => {
        install([{ name: 'X', slot: 0 }, { name: 'Y', slot: 12 }, { name: 'Z', slot: '3' }, { name: 'W', slot: 9 }])
        expect(badges(await mountPresets(), ['X', 'Y', 'Z', 'W'])).toEqual([null, null, null, '9'])
    })

    test('the badge follows a slot that is reassigned while the list is open', async () => {
        install([{ name: 'A', slot: 1 }, { name: 'B', slot: 2 }])
        const target = await mountPresets()
        DBState.db.botPresets[0].slot = 5
        flushSync()
        expect(badges(target, ['A', 'B'])).toEqual(['5', '2'])
    })
})
