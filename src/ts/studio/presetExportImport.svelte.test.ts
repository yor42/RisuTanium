// @vitest-environment happy-dom

/**
 * The "Manage presets" sheet's actions (`presetListActions.ts`) over the real `changeToPreset`, `copyPreset` and
 * `saveCurrentPreset` and a real `$state` database. The alert confirm is a mock the test holds open and answers.
 * Titles beginning "guard:" pin behaviour that holds before and after the change; the others name the defect an
 * index-based or classic-sequence build would show.
 */
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach } from 'vitest'
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
const alerts = vi.hoisted(() => ({ error: vi.fn(), normal: vi.fn() }))
const files = vi.hoisted(() => ({ saved: [] as Array<{ name: string, data: Uint8Array }>, picked: null as null | { name: string, data: Uint8Array }, prompt: vi.fn(async (_d: unknown) => '[0]') }))

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
        downloadFile: vi.fn(async (name: string, data: Uint8Array) => { files.saved.push({ name, data: new Uint8Array(data) }); return true }), saveAsset: vi.fn(), readImage: vi.fn(), toGetter: vi.fn((o: unknown) => o),
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
        alertError: alerts.error, alertNormal: alerts.normal,
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

vi.mock('src/ts/alertPrompts', () => ({ askPrompt: files.prompt, ANSWER_GUARD_MS: 400 }))
vi.mock('src/ts/rpack/rpack_js', () => ({ encodeRPack: vi.fn(async (b: Uint8Array) => b), decodeRPack: vi.fn(async (b: Uint8Array) => b) }))
vi.mock(import('src/ts/util'), async (importOriginal) => ({ ...(await importOriginal()), selectSingleFile: vi.fn(async () => files.picked) }))
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

//#endregion

import { language } from 'src/lang'
import { importPreset } from 'src/ts/storage/database.svelte'
import { MAX_BUNDLE_PRESETS } from 'src/ts/storage/presetBundle'
import { assignPresetIds } from 'src/ts/storage/presetMeta'
import { DBState } from 'src/ts/stores.svelte'
import { exportBundleByIds, exportPresetById, importPresetsFromPicker } from './presetListActions'

function installDb(presetNames: string[], selected = 0): void {
    DBState.db = {
        formatversion: 5,
        botPresets: presetNames.map((name) => ({ name, aiModel: 'm', openAIKey: 'sk-secret' })),
        botPresetsId: selected,
        presetFolders: [{ id: 'fa', name: 'A' }],
        aiModel: 'm',
        NAIsettings: {},
        showPromptComparison: false,
    } as unknown as Database
    assignPresetIds(DBState.db)
}

const names = () => DBState.db.botPresets.map((p) => p.name)
// The importer de-duplicates a clashing name with a ' (n)' suffix.
const baseNames = (list: string[]) => list.map((n) => n.replace(/ \(\d+\)$/, ''))
const idOf = (name: string) => DBState.db.botPresets.find((p) => p.name === name)!.id!

beforeEach(() => {
    files.saved.length = 0
    files.picked = null
    files.prompt.mockClear()
    alerts.error.mockClear()
    alerts.normal.mockClear()
})

describe('L-d1 single export is classic\'s file', () => {
    test('writes <name>_preset.risup once, and the bytes import as a new preset without id, slot or folder', async () => {
        installDb(['P0', 'P1'])
        DBState.db.botPresets[1].slot = 3
        DBState.db.botPresets[1].folderId = 'fa'
        expect(await exportPresetById(idOf('P1'))).toEqual({ ok: true, id: idOf('P1') })
        expect(files.saved.map((f) => f.name)).toEqual(['P1_preset.risup'])
        await importPreset(files.saved[0])
        expect(baseNames(names())).toEqual(['P0', 'P1', 'P1'])
        const added = DBState.db.botPresets[2]
        expect(added.id).not.toBe(idOf('P1'))
        expect(added.slot).toBeUndefined()
        expect(added.folderId).toBeUndefined()
        expect(added.openAIKey).toBe('')
    })

    test('a gone preset exports nothing', async () => {
        installDb(['P0'])
        expect(await exportPresetById('nope')).toEqual({ ok: false, reason: 'gone' })
        expect(files.saved.length).toBe(0)
    })
})

describe('L-d2 bundle selection', () => {
    test('exports exactly the selected ids, in list order whatever the order of the ids', async () => {
        installDb(['P0', 'P1', 'P2', 'P3'])
        await exportBundleByIds([idOf('P3'), idOf('P1')])
        expect(files.saved.length).toBe(1)
        expect(files.saved[0].name.endsWith('_presets.risup')).toBe(true)
        files.prompt.mockImplementation(async (d: unknown) => {
            const rows = (d as { presetBundle: { rows: { name: string }[] } }).presetBundle.rows
            return JSON.stringify(rows.map((_, i) => i))
        })
        const before = names().length
        await importPreset(files.saved[0])
        expect(baseNames(names().slice(before))).toEqual(['P1', 'P3'])
    })

    test('ids stay valid after a reorder: selection by id still names the same presets', async () => {
        installDb(['P0', 'P1', 'P2'])
        const picked = [idOf('P2')]
        DBState.db.botPresets = [DBState.db.botPresets[2], DBState.db.botPresets[0], DBState.db.botPresets[1]]
        await exportBundleByIds(picked)
        files.prompt.mockImplementation(async () => '[0]')
        await importPreset(files.saved[0])
        expect(baseNames(names().slice(3))).toEqual(['P2'])
    })

    test('an empty selection writes nothing', async () => {
        installDb(['P0'])
        expect(await exportBundleByIds([])).toEqual({ ok: true })
        expect(files.saved.length).toBe(0)
    })

    test('more than the bundle cap is refused with the error and no file', async () => {
        installDb(['P0'])
        const many = Array.from({ length: MAX_BUNDLE_PRESETS + 1 }, (_, i) => `x${i}`)
        DBState.db.botPresets = many.map((name) => ({ name, aiModel: 'm' })) as unknown as Database['botPresets']
        assignPresetIds(DBState.db)
        await exportBundleByIds(DBState.db.botPresets.map((p) => p.id!))
        expect(files.saved.length).toBe(0)
        expect(alerts.error).toHaveBeenCalled()
    })
})

describe('L-d3 import goes through classic\'s importer', () => {
    test('a picker that returns no file adds nothing and reports ok', async () => {
        installDb(['P0'])
        files.picked = null
        const result = await importPresetsFromPicker()
        expect(names()).toEqual(['P0'])
        expect(result.ok).toBe(true)
    })

    test('a picked single-preset file is added', async () => {
        installDb(['P0', 'P1'])
        await exportPresetById(idOf('P1'))
        files.picked = files.saved[0]
        expect(await importPresetsFromPicker()).toEqual({ ok: true })
        expect(baseNames(names())).toEqual(['P0', 'P1', 'P1'])
    })

    test('a bundle whose preview is cancelled adds nothing and reports cancelled', async () => {
        installDb(['P0', 'P1'])
        await exportBundleByIds([idOf('P0')])
        files.picked = files.saved[0]
        files.prompt.mockImplementation(async () => 'cancel')
        const result = await importPresetsFromPicker()
        expect(result).toEqual({ ok: false, reason: 'cancelled' })
        expect(names()).toEqual(['P0', 'P1'])
    })
})

describe('L-d4 no new export contract', () => {
    test('the export notice keys are the existing ones', () => {
        expect(language.presetBundleExport).toBeTruthy()
        expect(language.studioOpenClassic).toBeTruthy()
    })
})