// @vitest-environment happy-dom

/**
 * `botpreset.svelte`'s delete button removes the bot preset the user aimed at, and only
 * that preset, however the list changes while its confirmation is open; the last
 * remaining preset is never removed, and the first preset is selected afterwards with
 * the live settings of the selected preset saved first.
 *
 * Mounts the REAL `botpreset.svelte` over the real `changeToPreset` / `saveCurrentPreset`
 * and a real `$state` database. The alert confirm is a mock the test holds open and
 * answers. Titles beginning "guard:" pin behaviour that must be preserved before and
 * after the change; every other test is a regression reproducer for the behaviour it names.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from 'src/ts/platform'

//#region module mocks

const confirms = vi.hoisted(() => {
    const pending: Array<{ message: string, settle: (answer: boolean) => void }> = []
    return {
        pending,
        ask: (message: string) => new Promise<boolean>((settle) => { pending.push({ message, settle }) }),
    }
})

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
        alertConfirm: confirms.ask,
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

import { DBState } from 'src/ts/stores.svelte'
import BotPreset from './botpreset.svelte'

//#region helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

/** Preset `Pn` carries the model name `mn`; the live settings start as the selected preset's. */
function installDb(presetNames: string[], selected = 0): void {
    DBState.db = {
        formatversion: 5,
        botPresets: presetNames.map((name) => ({ name, aiModel: 'm' + name.slice(1) })),
        botPresetsId: selected,
        aiModel: 'm' + presetNames[selected].slice(1),
        NAIsettings: {},
        showPromptComparison: false,
    } as unknown as Database
}

const names = () => DBState.db.botPresets.map((p) => p.name)
const preset = (name: string) => DBState.db.botPresets.find((p) => p.name === name)

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

function mountPresets(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(BotPreset, { target, props: { close: vi.fn() } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

/** The trash control of the row whose title is `title`. */
function trash(target: HTMLElement, title: string): HTMLElement {
    const span = Array.from(target.querySelectorAll('span')).find((s) => s.textContent?.trim() === title)
    if (!span) throw new Error('row not found: ' + title)
    const controls = Array.from(span.closest('button')!.querySelectorAll('[role=button]')) as HTMLElement[]
    return controls[controls.length - 1]
}

async function clickTrash(target: HTMLElement, title: string): Promise<void> {
    trash(target, title).click()
    await settle()
}

async function answer(value: boolean): Promise<void> {
    const next = confirms.pending.shift()
    if (!next) throw new Error('no confirmation is open')
    next.settle(value)
    await settle()
}

beforeEach(() => {
    confirms.pending.length = 0
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

//#endregion

describe('a bot preset delete', () => {
    test('guard: with nothing else changing, the confirmed preset is removed and no other', async () => {
        installDb(['P0', 'P1', 'P2', 'P3'], 0)
        const target = mountPresets()
        await clickTrash(target, 'P2')
        await answer(true)
        expect(names()).toEqual(['P0', 'P1', 'P3'])
    })

    test('guard: after a delete the first preset is selected and loaded', async () => {
        installDb(['P0', 'P1', 'P2', 'P3'], 2)
        const target = mountPresets()
        await clickTrash(target, 'P1')
        await answer(true)
        expect(DBState.db.botPresetsId).toBe(0)
        expect(DBState.db.aiModel).toBe('m0')
    })

    test('guard: the live settings of the selected preset are saved into it before the first preset is loaded', async () => {
        installDb(['P0', 'P1', 'P2'], 2)
        DBState.db.aiModel = 'edited-live'
        const target = mountPresets()
        await clickTrash(target, 'P1')
        await answer(true)
        expect(names()).toEqual(['P0', 'P2'])
        expect(preset('P2')?.aiModel).toBe('edited-live')
    })

    test('guard: deleting the selected preset removes it and selects the first', async () => {
        installDb(['P0', 'P1', 'P2'], 1)
        const target = mountPresets()
        await clickTrash(target, 'P1')
        await answer(true)
        expect(names()).toEqual(['P0', 'P2'])
        expect(DBState.db.botPresetsId).toBe(0)
        expect(DBState.db.aiModel).toBe('m0')
    })

    test('guard: refusing the confirmation removes nothing', async () => {
        installDb(['P0', 'P1', 'P2'])
        const target = mountPresets()
        await clickTrash(target, 'P1')
        await answer(false)
        expect(names()).toEqual(['P0', 'P1', 'P2'])
    })

    test('guard: the only preset has no confirmation and is kept', async () => {
        installDb(['P0'])
        const target = mountPresets()
        await clickTrash(target, 'P0')
        expect(confirms.pending.length).toBe(0)
        expect(names()).toEqual(['P0'])
    })

    test('a preset inserted above it while the confirmation is open does not change which preset is removed', async () => {
        installDb(['P0', 'P1', 'P2', 'P3'], 0)
        const target = mountPresets()
        await clickTrash(target, 'P2')
        DBState.db.botPresets.unshift({ name: 'new' } as never)
        DBState.db.botPresetsId = 1
        flushSync()
        await answer(true)
        expect(names()).toEqual(['new', 'P0', 'P1', 'P3'])
    })

    test('a preset removed above it while the confirmation is open does not change which preset is removed', async () => {
        installDb(['P0', 'P1', 'P2', 'P3'], 1)
        const target = mountPresets()
        await clickTrash(target, 'P2')
        DBState.db.botPresets.splice(0, 1)
        DBState.db.botPresetsId = 0
        flushSync()
        await answer(true)
        expect(names()).toEqual(['P1', 'P3'])
    })

    test('two pending deletes of the same preset remove it once', async () => {
        installDb(['P0', 'P1', 'P2', 'P3'], 0)
        const target = mountPresets()
        await clickTrash(target, 'P1')
        await clickTrash(target, 'P1')
        expect(confirms.pending.length).toBe(2)
        await answer(true)
        await answer(true)
        expect(names()).toEqual(['P0', 'P2', 'P3'])
    })

    test('a preset removed by something else while its confirmation is open leaves every other preset in place', async () => {
        installDb(['P0', 'P1', 'P2', 'P3'], 0)
        const target = mountPresets()
        await clickTrash(target, 'P1')
        DBState.db.botPresets.splice(1, 1)
        flushSync()
        await answer(true)
        expect(names()).toEqual(['P0', 'P2', 'P3'])
    })

    test('a delete whose confirmation outlives all but its own preset keeps that last preset', async () => {
        installDb(['P0', 'P1'], 0)
        const target = mountPresets()
        await clickTrash(target, 'P0')
        DBState.db.botPresets.splice(1, 1)
        flushSync()
        await answer(true)
        expect(names()).toEqual(['P0'])
    })
})
