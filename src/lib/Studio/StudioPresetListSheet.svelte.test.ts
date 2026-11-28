// @vitest-environment happy-dom

/**
 * The "Manage presets" sheet mounted over the real preset list actions and a real `$state` database. The alert confirm
 * is a mock the test answers; the history service is a stub that records the name step the sheet asks for.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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
const history = vi.hoisted(() => ({
    editText: vi.fn((..._args: unknown[]) => ({ ok: true }) as { ok: boolean, reason?: string }),
    closeOpenStep: vi.fn(),
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

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const stub: Record<string, unknown> = {
        forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
        getFileSrc: vi.fn(async (loc: string) => `data:mock-image;loc=${loc}`),
        checkCharOrder: vi.fn(),
        requiresFullEncoderReload: { state: false },
        AppendableBuffer: class {}, VirtualWriter: class {}, LocalWriter: class {}, BlankWriter: class {},
        downloadFile: vi.fn(), saveAsset: vi.fn(), readImage: vi.fn(), toGetter: vi.fn((o: unknown) => o),
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

vi.mock('src/ts/studio/history/studioHistoryService.svelte', () => ({
    loadStudioHistoryService: vi.fn(async () => history),
    beginOwnerVisit: vi.fn(),
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

//#endregion

import { language } from 'src/lang'
import { assignPresetIds } from 'src/ts/storage/presetMeta'
import { studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { DBState } from 'src/ts/stores.svelte'
import StudioPresetListSheet from './StudioPresetListSheet.svelte'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(10)
    flushSync()
}

function installDb(presetNames: string[], selected = 0): void {
    DBState.db = {
        formatversion: 5,
        botPresets: presetNames.map((name) => ({ name, aiModel: 'm' + name.slice(1) })),
        botPresetsId: selected,
        aiModel: 'm' + presetNames[selected].slice(1),
        NAIsettings: {},
        showPromptComparison: false,
    } as unknown as Database
    assignPresetIds(DBState.db)
}

const names = () => DBState.db.botPresets.map((p) => p.name)
const idOf = (name: string) => DBState.db.botPresets.find((p) => p.name === name)!.id!

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

async function mountSheet(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(StudioPresetListSheet, { target }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    await settle()
    return target
}

const row = (target: HTMLElement, name: string): HTMLElement => {
    const found = target.querySelector<HTMLElement>(`[data-part="studio-preset-row"][data-preset-id="${idOf(name)}"]`)
    if (!found) throw new Error('row not found: ' + name)
    return found
}

async function click(element: Element | null): Promise<void> {
    if (!(element instanceof HTMLElement)) throw new Error('control not found')
    element.click()
    await settle()
}

async function menuAction(target: HTMLElement, name: string, part: string): Promise<void> {
    await click(row(target, name).querySelector('[data-part="studio-preset-menu-button"]'))
    await click(row(target, name).querySelector(`[data-part="${part}"]`))
}

beforeEach(() => {
    confirms.pending.length = 0
    history.editText.mockClear()
    history.closeOpenStep.mockClear()
    studioScreen.presetSheetOpen = true
    studioScreen.selectedOwnerKey = null
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('the Manage presets sheet', () => {
    test('lists every preset in list order and marks the active one', async () => {
        installDb(['P0', 'P1', 'P2'], 1)
        const target = await mountSheet()
        const rows = [...target.querySelectorAll('[data-part="studio-preset-row"]')]
        expect(rows.map((r) => r.querySelector('[data-part="studio-preset-open"] span')?.textContent)).toEqual(['P0', 'P1', 'P2'])
        expect(rows.map((r) => r.querySelector('[data-part="studio-preset-active"]') !== null)).toEqual([false, true, false])
    })

    test('L-a11: Use in chats moves the badge and the sheet stays open', async () => {
        installDb(['P0', 'P1', 'P2'], 0)
        const target = await mountSheet()
        await menuAction(target, 'P2', 'studio-preset-use')
        expect(DBState.db.botPresetsId).toBe(2)
        expect(row(target, 'P2').querySelector('[data-part="studio-preset-active"]')).not.toBeNull()
        expect(row(target, 'P0').querySelector('[data-part="studio-preset-active"]')).toBeNull()
        expect(studioScreen.presetSheetOpen).toBe(true)
    })

    test('New adds a preset that is highlighted, and the active preset is unchanged', async () => {
        installDb(['P0', 'P1'], 1)
        const target = await mountSheet()
        await click(target.querySelector('[data-part="studio-preset-new"]'))
        expect(names()).toEqual(['P0', 'P1', language.studioPresetNewName])
        expect(DBState.db.botPresetsId).toBe(1)
        expect(target.querySelectorAll('[data-part="studio-preset-row"]').length).toBe(3)
    })

    test('Copy appends the copy of the chosen row', async () => {
        installDb(['P0', 'P1'], 0)
        const target = await mountSheet()
        await menuAction(target, 'P1', 'studio-preset-copy')
        expect(names()).toEqual(['P0', 'P1', 'P1' + language.studioPresetCopySuffix])
    })

    test('Delete asks classic\'s confirm, removes the row and keeps the active preset', async () => {
        installDb(['P0', 'P1', 'P2'], 1)
        const target = await mountSheet()
        await menuAction(target, 'P2', 'studio-preset-delete')
        expect(confirms.pending[0].message).toBe(`${language.removeConfirm}P2`)
        confirms.pending[0].settle(true)
        await settle()
        expect(names()).toEqual(['P0', 'P1'])
        expect(DBState.db.botPresetsId).toBe(1)
        expect(target.querySelectorAll('[data-part="studio-preset-row"]').length).toBe(2)
    })

    test('L-a7: an import adds presets while a row menu is open; the open menu still acts on its own preset', async () => {
        installDb(['P0', 'P1'], 0)
        const target = await mountSheet()
        const id = idOf('P1')
        await click(row(target, 'P1').querySelector('[data-part="studio-preset-menu-button"]'))
        DBState.db.botPresets = [{ name: 'X', id: 'x-new' } as never, ...DBState.db.botPresets]
        DBState.db.botPresetsId = 1
        flushSync()
        await click(target.querySelector(`[data-preset-id="${id}"] [data-part="studio-preset-use"]`))
        expect(DBState.db.botPresets[DBState.db.botPresetsId].id).toBe(id)
    })

    test('L-a7: an action whose preset is gone says so and changes nothing', async () => {
        installDb(['P0', 'P1'], 0)
        const target = await mountSheet()
        await click(row(target, 'P1').querySelector('[data-part="studio-preset-menu-button"]'))
        const use = row(target, 'P1').querySelector<HTMLElement>('[data-part="studio-preset-use"]')!
        DBState.db.botPresets = DBState.db.botPresets.filter((p) => p.name !== 'P1')
        use.click()
        await settle()
        expect(names()).toEqual(['P0'])
        expect(DBState.db.botPresetsId).toBe(0)
        expect(target.querySelector('[data-part="studio-preset-message"]')?.textContent).toBe(language.studioRefusalPresetGone)
    })

    test('L-a2: a tap before the list re-renders resolves by its own id, not its stale index', async () => {
        installDb(['P0', 'P1', 'P2'], 0)
        const target = await mountSheet()
        await click(row(target, 'P2').querySelector('[data-part="studio-preset-menu-button"]'))
        const use = row(target, 'P2').querySelector<HTMLElement>('[data-part="studio-preset-use"]')!
        DBState.db.botPresets = DBState.db.botPresets.filter((p) => p.name !== 'P1')
        use.click()
        await settle()
        expect(names()).toEqual(['P0', 'P2'])
        expect(DBState.db.botPresets[DBState.db.botPresetsId].name).toBe('P2')
    })

    test('opening a row closes the sheet and selects that preset by its current index', async () => {
        installDb(['P0', 'P1', 'P2'], 0)
        const target = await mountSheet()
        await click(row(target, 'P2').querySelector('[data-part="studio-preset-open"]'))
        expect(studioScreen.presetSheetOpen).toBe(false)
        expect(studioScreen.selectedOwnerKey).toBe('preset:2')
        expect(studioScreen.selectedPresetId).toBe(idOf('P2'))
    })

    test('L-a10: rename asks the presetName step with the typed name, as one closed step; an empty name is allowed', async () => {
        installDb(['P0', 'P1'], 0)
        const target = await mountSheet()
        await menuAction(target, 'P1', 'studio-preset-rename')
        const input = row(target, 'P1').querySelector<HTMLInputElement>('[data-part="studio-preset-rename-input"]')!
        input.value = ''
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await click(row(target, 'P1').querySelector('[data-part="studio-preset-rename-apply"]'))
        expect(history.editText).toHaveBeenCalledWith(`preset:${idOf('P1')}`, 'presetName', '', 'single')
        expect(history.closeOpenStep).toHaveBeenCalledTimes(1)
        expect(row(target, 'P1').querySelector('[data-part="studio-preset-menu"]')).toBeNull()
    })

    test('L-a10: a refused rename shows the gone text', async () => {
        installDb(['P0', 'P1'], 0)
        history.editText.mockReturnValueOnce({ ok: false, reason: 'gone' })
        const target = await mountSheet()
        await menuAction(target, 'P1', 'studio-preset-rename')
        await click(row(target, 'P1').querySelector('[data-part="studio-preset-rename-apply"]'))
        expect(target.querySelector('[data-part="studio-preset-message"]')?.textContent).toBe(language.studioRefusalPresetGone)
    })

    test('the footer names what stays in the classic editor', async () => {
        installDb(['P0'], 0)
        const target = await mountSheet()
        expect(target.querySelector('[data-part="studio-preset-classic-note"]')?.textContent).toBe(language.studioPresetClassicOnly)
    })
})
