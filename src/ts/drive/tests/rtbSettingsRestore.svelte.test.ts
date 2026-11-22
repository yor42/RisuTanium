import { flushSync } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, botPreset } from 'src/ts/storage/database.svelte'

// A genuinely reactive stand-in for the database holder: the apply writes through it, the real change effects watch it.
vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
    isSaveClean: vi.fn(() => true),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import { DBState } from 'src/ts/stores.svelte'
import { changeToPreset, presetFromWorkingSettings, saveCurrentPreset } from 'src/ts/storage/database.svelte'
import { registerDbChangeEffects } from 'src/ts/storage/dbChangeEffects.svelte'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { language } from 'src/lang'
import { applySettingsRestore, type SettingsRestoreDeps } from 'src/ts/drive/rtbSettingsRestore'
import { UI_PREFS_KEYS } from 'src/ts/drive/rtb/sideStoreConfig'
import { DEVICE_LIST_KEYS, type SettingsPayloadInput } from 'src/ts/drive/rtb/settingsPayload'
import { createHypaV3Preset } from 'src/ts/process/memory/hypaV3Presets'
import { settingsSource } from 'src/ts/drive/rtbSettingsSource.svelte'
import { inputOf, realisticDb } from './rtb/settingsTestKit'

type Fields = Record<string, unknown>
const asRecord = (value: object): Fields => value as unknown as Fields

function liveLists(): ReturnType<SettingsRestoreDeps['lists']> {
    const source = settingsSource(DEVICE_LIST_KEYS)
    return {
        botPresets: source.get('botPresets'),
        botPresetsId: source.get('botPresetsId'),
        presetFolders: source.get('presetFolders'),
        hypaV3Presets: source.get('hypaV3Presets'),
        hypaV3PresetId: source.get('hypaV3PresetId'),
        translatorPresets: source.get('translatorPresets'),
        translatorPresetId: source.get('translatorPresetId'),
    }
}

interface Harness {
    deps: SettingsRestoreDeps
    log: string[]
    uiWrites: { key: string, value: string }[]
    errors: string[]
    notices: string[]
    confirms: string[]
}

/** Deps over the live (stand-in) database; only the page-level calls (dialogs, save loop, reload) are replaced. */
function harness(over: Partial<SettingsRestoreDeps> = {}, clean = true): Harness {
    const h: Harness = { deps: undefined as unknown as SettingsRestoreDeps, log: [], uiWrites: [], errors: [], notices: [], confirms: [] }
    h.deps = {
        lists: liveLists,
        db: () => DBState.db,
        confirm: async (text) => { h.confirms.push(text); return true },
        error: async (text) => { h.errors.push(text) },
        notice: async (text) => { h.notices.push(text) },
        saveCurrentPreset,
        changeToPreset,
        tick: async () => {},
        saveFirst: async () => { h.log.push('saveFirst') },
        isSaveClean: () => clean,
        writeUiPref: (key, value) => { h.uiWrites.push({ key, value }) },
        markReload: () => { h.log.push('markReload') },
        reload: async () => { h.log.push('reload') },
        ...over,
    }
    return h
}

function install(setup: (db: Database) => void): void {
    const db = realisticDb()
    setup(db)
    DBState.db = db
}

function presetOf(db: Database, id: string, name: string, over: Fields = {}): botPreset {
    const made = presetFromWorkingSettings(db, name, '')
    made.id = id
    Object.assign(made, over)
    return made
}

const PAIR_URLS = { X: 'http://kobold-x.invalid', F: 'http://kobold-f.invalid' }

/** Two presets X (selected, working koboldURL is X's) and F, each with its own endpoint. */
function installPair(): void {
    install((db) => {
        db.koboldURL = PAIR_URLS.F
        const f = presetOf(db, 'idF', 'F', { temperature: 0.2 })
        db.koboldURL = PAIR_URLS.X
        const x = presetOf(db, 'idX', 'X', { temperature: 0.1 })
        db.botPresets = [x, f]
        db.botPresetsId = 0
        db.temperature = 0.1
    })
}

const fileSelectingF = (): SettingsPayloadInput => inputOf([
    { key: 'botPresets', value: [{ id: 'idF', name: 'F', temperature: 0.9 }] },
    { key: 'botPresetsId', value: 0 },
    { key: 'theme', value: 'waifu' },
])

const dump = (): string => JSON.stringify(DBState.db)

let cleanup: (() => void) | undefined
afterEach(() => {
    cleanup?.()
    cleanup = undefined
})

describe('applySettingsRestore: refusals write nothing', () => {
    test('T11 the Welcome restore is refused before any read or write', async () => {
        installPair()
        const before = dump()
        const h = harness()
        const save = vi.fn()
        const end = await applySettingsRestore(fileSelectingF(), { firstRun: true }, { ...h.deps, saveCurrentPreset: save })
        expect(end.outcome).toBe('nothing-replaced')
        expect(h.errors).toEqual([language.rtbRestoreSettingsAtStart])
        expect(h.confirms).toEqual([])
        expect(save).not.toHaveBeenCalled()
        expect(dump()).toBe(before)
        expect(h.uiWrites).toEqual([])
    })

    test('T9 a file the reader refuses shows the damaged text and writes nothing', async () => {
        installPair()
        const before = dump()
        const h = harness()
        const save = vi.fn()
        const refused = inputOf([
            { key: 'botPresets', value: [{ id: 'dup', name: 'A' }, { id: 'dup', name: 'B' }] },
            { key: 'theme', value: 'waifu' },
        ])
        const end = await applySettingsRestore(refused, {}, { ...h.deps, saveCurrentPreset: save })
        expect(end.outcome).toBe('nothing-replaced')
        expect(h.errors).toEqual([language.rtbRestoreDamaged])
        expect(save).not.toHaveBeenCalled()
        expect(dump()).toBe(before)
    })

    test('a cancelled confirm ends canceled with no write, and the confirm shows the five counts', async () => {
        installPair()
        const before = dump()
        const h = harness({ confirm: async (text) => { h.confirms.push(text); return false } })
        const save = vi.fn()
        const end = await applySettingsRestore(fileSelectingF(), {}, { ...h.deps, saveCurrentPreset: save })
        expect(end.outcome).toBe('canceled')
        expect(h.confirms).toEqual([language.rtbRestoreSettingsConfirm(1, 1, 0, 0, 0)])
        expect(save).not.toHaveBeenCalled()
        expect(dump()).toBe(before)
        expect(h.uiWrites).toEqual([])
    })
})

describe('applySettingsRestore: the save and the reload', () => {
    test('T11 the working edits land in the device preset X before the file is merged', async () => {
        installPair()
        DBState.db.temperature = 0.77
        const h = harness()
        await applySettingsRestore(fileSelectingF(), {}, h.deps)
        const x = DBState.db.botPresets.find((entry) => entry.id === 'idX')!
        expect(x.temperature).toBe(0.77)
    })

    test('T11 an unclean save writes no ui-pref, shows the not-saved text and does not reload', async () => {
        installPair()
        const h = harness({}, false)
        const input = { ...fileSelectingF(), uiPrefs: [{ key: UI_KEY, value: 'v' }] }
        const end = await applySettingsRestore(input, {}, h.deps)
        expect(end.outcome).toBe('committed')
        expect(h.uiWrites).toEqual([])
        expect(h.notices).toEqual([language.rtbRestoreSettingsNotSaved])
        expect(h.log).toEqual(['saveFirst'])
        expect(DBState.db.theme).toBe('waifu')
    })

    test('T11 a clean save writes only the file ui-prefs, then reloads after the done notice', async () => {
        installPair()
        const h = harness()
        const input = { ...fileSelectingF(), uiPrefs: [{ key: UI_KEY, value: 'v' }] }
        const end = await applySettingsRestore(input, { card: true }, h.deps)
        expect(end.outcome).toBe('committed')
        expect(h.uiWrites).toEqual([{ key: UI_KEY, value: 'v' }])
        expect(h.notices).toEqual([language.rtbRestoreSettingsDone])
        expect(h.log).toEqual(['saveFirst', 'markReload', 'reload'])
    })

    test('ui-prefs are written after the save is clean, never before the save call', async () => {
        installPair()
        const order: string[] = []
        const h = harness({
            saveFirst: async () => { order.push('save') },
            isSaveClean: () => { order.push('clean?'); return true },
            writeUiPref: () => { order.push('ui') },
        })
        await applySettingsRestore({ ...fileSelectingF(), uiPrefs: [{ key: UI_KEY, value: 'v' }] }, {}, h.deps)
        expect(order).toEqual(['save', 'clean?', 'ui'])
    })

    test('a ui-pref write that throws does not stop the reload', async () => {
        installPair()
        const h = harness({ writeUiPref: () => { throw new Error('quota') } })
        const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
        await applySettingsRestore({ ...fileSelectingF(), uiPrefs: [{ key: UI_KEY, value: 'v' }] }, {}, h.deps)
        quiet.mockRestore()
        expect(h.log).toEqual(['saveFirst', 'markReload', 'reload'])
    })
})

const UI_KEY = UI_PREFS_KEYS[0]

describe('applySettingsRestore: steps 4 to 6 are one synchronous block', () => {
    test('T11b a microtask queued by the preset save runs only after the writes', async () => {
        installPair()
        const log: string[] = []
        const h = harness({
            saveCurrentPreset: () => {
                log.push('save')
                saveCurrentPreset()
                void Promise.resolve().then(() => {
                    log.push(`microtask:${DBState.db.botPresetsId}`)
                    DBState.db.botPresetsId = 0
                })
            },
            lists: () => { log.push('replan'); return liveLists() },
            changeToPreset: (id, saveCurrent) => { log.push(`change:${id}:${saveCurrent}`); changeToPreset(id, saveCurrent) },
        })
        await applySettingsRestore(fileSelectingF(), {}, h.deps)
        // The first `replan` is the confirm preview; the block is save, replan, change.
        expect(log).toEqual(['replan', 'save', 'replan', 'change:1:false', 'microtask:1'])
    })
})

describe('applySettingsRestore: the selected preset and the working fields (T20)', () => {
    test('the working fields and the connection follow F, X keeps the device edits', async () => {
        installPair()
        DBState.db.temperature = 0.33
        const h = harness()
        await applySettingsRestore(fileSelectingF(), {}, h.deps)
        const db = DBState.db
        expect(db.botPresetsId).toBe(1)
        expect(db.koboldURL).toBe(PAIR_URLS.F)
        expect(db.temperature).toBe(0.9)
        expect(db.theme).toBe('waifu')

        changeToPreset(0)
        const f = db.botPresets.find((entry) => entry.id === 'idF')!
        const x = db.botPresets.find((entry) => entry.id === 'idX')!
        expect(f.koboldURL).toBe(PAIR_URLS.F)
        expect(f.temperature).toBe(0.9)
        expect(x.temperature).toBe(0.33)
        expect(x.koboldURL).toBe(PAIR_URLS.X)
    })

    test('a top-level working field in the file loses to the selected preset, which is applied last', async () => {
        installPair()
        const h = harness()
        const input = inputOf([
            { key: 'temperature', value: 0.55 },
            { key: 'botPresets', value: [{ id: 'idF', name: 'F', temperature: 0.9 }] },
            { key: 'botPresetsId', value: 0 },
        ])
        await applySettingsRestore(input, {}, h.deps)
        expect(DBState.db.botPresetsId).toBe(1)
        expect(DBState.db.temperature).toBe(0.9)
    })

    test('a new-id preset keeps the device connection: the omitted endpoint fields are never blanked', async () => {
        installPair()
        DBState.db.proxyConnectionId = 'connection-x'
        const h = harness()
        const input = inputOf([
            { key: 'botPresets', value: [{ id: 'idNew', name: 'New', temperature: 0.4 }] },
            { key: 'botPresetsId', value: 0 },
        ])
        await applySettingsRestore(input, {}, h.deps)
        expect(DBState.db.botPresetsId).toBe(2)
        expect(DBState.db.koboldURL).toBe(PAIR_URLS.X)
        expect(DBState.db.proxyConnectionId).toBe('connection-x')
        expect(DBState.db.temperature).toBe(0.4)
    })

    test('without a selection botPresetsId stays and the file fields become working edits', async () => {
        installPair()
        const h = harness()
        const input = inputOf([{ key: 'temperature', value: 0.55 }, { key: 'botPresets', value: [{ id: 'idF', name: 'F', temperature: 0.9 }] }])
        await applySettingsRestore(input, {}, h.deps)
        expect(DBState.db.botPresetsId).toBe(0)
        expect(DBState.db.temperature).toBe(0.55)
        expect(DBState.db.botPresets.find((entry) => entry.id === 'idF')!.temperature).toBe(0.9)
    })

    test('T26 a top-level NAIsettings null is dropped and a same-id preset NAISettings null does not throw', async () => {
        installPair()
        const naiBefore = JSON.stringify(DBState.db.NAIsettings)
        const h = harness()
        const input = inputOf([
            { key: 'NAIsettings', value: null },
            { key: 'botPresets', value: [{ id: 'idF', name: 'F', NAISettings: null }, { id: 'idNew', name: 'New' }] },
            { key: 'botPresetsId', value: 1 },
        ])
        await expect(applySettingsRestore(input, {}, h.deps)).resolves.toEqual({ outcome: 'committed' })
        expect(JSON.stringify(DBState.db.NAIsettings)).toBe(naiBefore)
        expect(DBState.db.botPresetsId).toBe(2)
        const f = DBState.db.botPresets.find((entry) => entry.id === 'idF')!
        expect(f.NAISettings).not.toBeNull()
    })
})

describe('applySettingsRestore: memory and translator presets are written with their indices', () => {
    test('the merged lists and remapped indices land on the database', async () => {
        install((db) => {
            db.translatorPresets = [{ name: 't1', prompt: 'p1', maxResponse: 100 }, { name: 't2', prompt: 'p2', maxResponse: 100 }]
            db.translatorPresetId = 0
        })
        const h = harness()
        const input = inputOf([
            { key: 'translatorPresets', value: [{ name: 't1', prompt: 'p1', maxResponse: 100 }, { name: 't3', prompt: 'p3', maxResponse: 50 }] },
            { key: 'translatorPresetId', value: 1 },
        ])
        await applySettingsRestore(input, {}, h.deps)
        expect(DBState.db.translatorPresets.map((entry) => entry.name)).toEqual(['t1', 't2', 't3'])
        expect(DBState.db.translatorPresetId).toBe(2)
    })
})

describe('applySettingsRestore: memory presets and the save call', () => {
    test('the HypaV3 selection is remapped to the merged position', async () => {
        install((db) => {
            const a = createHypaV3Preset('A')
            a.id = 'hypa-a'
            const b = createHypaV3Preset('B')
            b.id = 'hypa-b'
            db.hypaV3Presets = [a, b]
            db.hypaV3PresetId = 1
        })
        const input = inputOf([
            { key: 'hypaV3Presets', value: [{ id: 'hypa-c', name: 'C', settings: {} }] },
            { key: 'hypaV3PresetId', value: 0 },
        ])
        await applySettingsRestore(input, {}, harness().deps)
        expect(DBState.db.hypaV3Presets.map((entry) => entry.id)).toEqual(['hypa-a', 'hypa-b', 'hypa-c'])
        expect(DBState.db.hypaV3PresetId).toBe(2)
    })

    test('the save is quiet exactly when the restore runs on the task card', async () => {
        installPair()
        const seen: boolean[] = []
        const deps = harness({ saveFirst: async (quiet) => { seen.push(quiet) } }).deps
        await applySettingsRestore(fileSelectingF(), { card: true }, deps)
        await applySettingsRestore(fileSelectingF(), {}, deps)
        expect(seen).toEqual([true, false])
    })
})

describe('applySettingsRestore: the writes are marked for the save (T12)', () => {
    function arm() {
        const tracker: toSaveType = {
            character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false,
        }
        const markChanged = vi.fn()
        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        markChanged.mockClear()
        tracker.botPreset = false
        return { tracker, markChanged }
    }

    test('a preset merge marks the preset block', async () => {
        installPair()
        const { tracker, markChanged } = arm()
        await applySettingsRestore(fileSelectingF(), {}, harness().deps)
        flushSync()
        expect(tracker.botPreset).toBe(true)
        expect(markChanged).toHaveBeenCalledWith(true)
    })

    test('a hypaV3Presets write is marked by the top-level effect', async () => {
        installPair()
        const { tracker, markChanged } = arm()
        const input = inputOf([{ key: 'hypaV3Presets', value: [{ id: 'hypa-new', name: 'H', settings: {} }] }])
        await applySettingsRestore(input, {}, harness({ saveCurrentPreset: () => {} }).deps)
        flushSync()
        expect(DBState.db.hypaV3Presets.some((entry) => entry.id === 'hypa-new')).toBe(true)
        expect(tracker.botPreset).toBe(false)
        expect(markChanged).toHaveBeenCalledWith(true)
    })

    test('a translatorPresets write is marked by the top-level effect', async () => {
        installPair()
        const { tracker, markChanged } = arm()
        const input = inputOf([{ key: 'translatorPresets', value: [{ name: 'only-new', prompt: 'p', maxResponse: 9 }] }])
        await applySettingsRestore(input, {}, harness({ saveCurrentPreset: () => {} }).deps)
        flushSync()
        expect(tracker.botPreset).toBe(false)
        expect(markChanged).toHaveBeenCalledWith(true)
    })
})
