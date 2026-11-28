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
const alerts = vi.hoisted(() => ({ error: vi.fn() }))

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
        alertError: alerts.error,
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

//#endregion

import { language } from 'src/lang'
import { registerDbChangeEffects } from 'src/ts/storage/dbChangeEffects.svelte'
import { movePresetById } from 'src/ts/storage/presetListOps'
import { assignPresetIds } from 'src/ts/storage/presetMeta'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { DBState } from 'src/ts/stores.svelte'
import { copyPresetById, deletePresetById, newPreset, useInChats } from './presetListActions'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

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
    assignPresetIds(DBState.db)
}

const names = () => DBState.db.botPresets.map((p) => p.name)
const idOf = (name: string) => DBState.db.botPresets.find((p) => p.name === name)!.id!
const activeName = () => DBState.db.botPresets[DBState.db.botPresetsId]?.name

async function answer(value: boolean): Promise<void> {
    await sleep(0)
    const next = confirms.pending.shift()
    if (!next) throw new Error('no confirmation is open')
    next.settle(value)
    await sleep(0)
}

beforeEach(() => {
    confirms.pending.length = 0
    alerts.error.mockClear()
})

describe('delete by id', () => {
    test('L-a3: deleting the active preset at the start, middle and end switches to the first remaining preset and loads it', async () => {
        for (const at of [0, 1, 2]) {
            installDb(['P0', 'P1', 'P2'], at)
            DBState.db.aiModel = 'live-' + at
            const done = deletePresetById(idOf('P' + at))
            await answer(true)
            expect(await done).toEqual({ ok: true })
            expect(names()).toEqual(['P0', 'P1', 'P2'].filter((_, i) => i !== at))
            expect(DBState.db.botPresetsId).toBe(0)
            expect(DBState.db.aiModel).toBe(DBState.db.botPresets[0].aiModel)
            // The deleted preset's live settings were never saved into another slot.
            expect(DBState.db.botPresets.some((p) => p.aiModel === 'live-' + at)).toBe(false)
        }
    })

    test('L-a4: deleting a preset before the active one keeps the active preset', async () => {
        installDb(['P0', 'P1', 'P2', 'P3'], 2)
        const done = deletePresetById(idOf('P0'))
        await answer(true)
        expect(await done).toEqual({ ok: true })
        expect(names()).toEqual(['P1', 'P2', 'P3'])
        expect(activeName()).toBe('P2')
    })

    test('L-a5: deleting a non-active preset does not switch the active preset or reload the live settings', async () => {
        installDb(['P0', 'P1', 'P2'], 1)
        DBState.db.aiModel = 'unsaved-live'
        const done = deletePresetById(idOf('P2'))
        await answer(true)
        expect(await done).toEqual({ ok: true })
        expect(names()).toEqual(['P0', 'P1'])
        expect(activeName()).toBe('P1')
        // Classic's sequence would have reloaded preset 0 over these.
        expect(DBState.db.aiModel).toBe('unsaved-live')
    })

    test('L-a5: the only preset is refused with the classic alert and no confirm', async () => {
        installDb(['P0'], 0)
        expect(await deletePresetById(idOf('P0'))).toEqual({ ok: false, reason: 'only' })
        expect(alerts.error).toHaveBeenCalledWith(language.errors.onlyOneChat)
        expect(confirms.pending).toHaveLength(0)
        expect(names()).toEqual(['P0'])
    })

    test('L-a2b: the list is reordered while the confirm is open: the preset with that id is deleted', async () => {
        installDb(['P0', 'P1', 'P2', 'P3'], 0)
        const done = deletePresetById(idOf('P2'))
        await sleep(0)
        DBState.db.botPresets = [...DBState.db.botPresets].reverse()
        DBState.db.botPresetsId = 3
        await answer(true)
        expect(await done).toEqual({ ok: true })
        expect(names()).toEqual(['P3', 'P1', 'P0'])
        expect(activeName()).toBe('P0')
    })

    test('L-a2b: the target is the active preset and the list is reordered while the confirm is open: it is still deleted through the active sequence', async () => {
        installDb(['P0', 'P1', 'P2', 'P3'], 2)
        const done = deletePresetById(idOf('P2'))
        await sleep(0)
        DBState.db.botPresets = [...DBState.db.botPresets].reverse()
        DBState.db.botPresetsId = 1
        await answer(true)
        expect(await done).toEqual({ ok: true })
        expect(names()).toEqual(['P3', 'P1', 'P0'])
        expect(DBState.db.botPresetsId).toBe(0)
    })

    test('L-a2b: the active preset changes onto a different preset at the confirmed index while the confirm is open: only the target goes', async () => {
        installDb(['P0', 'P1', 'P2', 'P3'], 0)
        const done = deletePresetById(idOf('P2'))
        await sleep(0)
        const [p0, p1, p2, p3] = DBState.db.botPresets
        DBState.db.botPresets = [p0, p2, p1, p3]
        DBState.db.botPresetsId = 2
        await answer(true)
        expect(await done).toEqual({ ok: true })
        expect(names()).toEqual(['P0', 'P1', 'P3'])
        expect(activeName()).toBe('P1')
    })

    test('L-a2b: the target stops being the active preset while the confirm is open: it goes without switching the active preset', async () => {
        installDb(['P0', 'P1', 'P2'], 2)
        DBState.db.botPresets[0].aiModel = 'p0-model'
        DBState.db.aiModel = 'live-edit'
        const done = deletePresetById(idOf('P2'))
        await sleep(0)
        DBState.db.botPresetsId = 0
        await answer(true)
        expect(await done).toEqual({ ok: true })
        expect(names()).toEqual(['P0', 'P1'])
        expect(DBState.db.botPresetsId).toBe(0)
        expect(DBState.db.aiModel).toBe('live-edit')
        expect(DBState.db.botPresets[0].aiModel).toBe('p0-model')
    })

    test('L-a2b: the target becomes the active preset while the confirm is open: it goes through the active sequence', async () => {
        installDb(['P0', 'P1', 'P2'], 0)
        DBState.db.botPresets[0].aiModel = 'p0-model'
        const done = deletePresetById(idOf('P1'))
        await sleep(0)
        DBState.db.botPresetsId = 1
        await answer(true)
        expect(await done).toEqual({ ok: true })
        expect(names()).toEqual(['P0', 'P2'])
        expect(DBState.db.botPresetsId).toBe(0)
        expect(DBState.db.aiModel).toBe('p0-model')
    })

    test('L-a2b: the target is removed while the confirm is open: gone, nothing else deleted', async () => {
        installDb(['P0', 'P1', 'P2'], 0)
        const done = deletePresetById(idOf('P2'))
        await sleep(0)
        DBState.db.botPresets = DBState.db.botPresets.filter((p) => p.name !== 'P2')
        await answer(true)
        expect(await done).toEqual({ ok: false, reason: 'gone' })
        expect(names()).toEqual(['P0', 'P1'])
    })

    test('L-a2b: the list shrinks to one preset while the confirm is open: the only-preset refusal is re-checked', async () => {
        installDb(['P0', 'P1'], 0)
        const done = deletePresetById(idOf('P1'))
        await sleep(0)
        DBState.db.botPresets = DBState.db.botPresets.filter((p) => p.name === 'P1')
        DBState.db.botPresetsId = 0
        await answer(true)
        expect(await done).toEqual({ ok: false, reason: 'only' })
        expect(names()).toEqual(['P1'])
    })

    test('L-a2: an id with no holder refuses as gone before any confirm; a declined confirm removes nothing', async () => {
        installDb(['P0', 'P1'], 0)
        expect(await deletePresetById('no-such-id')).toEqual({ ok: false, reason: 'gone' })
        expect(confirms.pending).toHaveLength(0)
        const done = deletePresetById(idOf('P1'))
        await answer(false)
        expect(await done).toEqual({ ok: false, reason: 'cancelled' })
        expect(names()).toEqual(['P0', 'P1'])
    })
})

describe('new, copy and use', () => {
    test('L-a9: a new preset is appended with a fresh id, no folder, no slot, and the active preset is unchanged', () => {
        installDb(['P0', 'P1'], 1)
        DBState.db.botPresets[0].folderId = 'f'
        const result = newPreset()
        expect(names()).toEqual(['P0', 'P1', language.studioPresetNewName])
        const created = DBState.db.botPresets[2]
        expect(result).toEqual({ ok: true, id: created.id })
        expect(created.folderId).toBeUndefined()
        expect(created.slot).toBeUndefined()
        expect(new Set(DBState.db.botPresets.map((p) => p.id)).size).toBe(3)
        expect(DBState.db.botPresetsId).toBe(1)
    })

    test('L-a8: a copy of the active preset carries the unsaved working values, keeps the folder, gets a new id and no slot', () => {
        installDb(['P0', 'P1'], 1)
        DBState.db.botPresets[1].folderId = 'f1'
        DBState.db.botPresets[1].slot = 4
        DBState.db.aiModel = 'edited-live'
        const result = copyPresetById(idOf('P1'))
        const copy = DBState.db.botPresets[2]
        expect(result).toEqual({ ok: true, id: copy.id })
        expect(copy.aiModel).toBe('edited-live')
        expect(copy.name).toBe('P1' + language.studioPresetCopySuffix)
        expect(copy.folderId).toBe('f1')
        expect(copy.slot).toBeUndefined()
        expect(copy.id).not.toBe(DBState.db.botPresets[1].id)
        expect(DBState.db.botPresetsId).toBe(1)
    })

    test('L-a2: copy of an id with no holder refuses and adds nothing', () => {
        installDb(['P0', 'P1'], 0)
        expect(copyPresetById('no-such-id')).toEqual({ ok: false, reason: 'gone' })
        expect(names()).toEqual(['P0', 'P1'])
    })

    test('L-a11: use in chats saves the current settings into the active slot, then loads the chosen preset', () => {
        installDb(['P0', 'P1', 'P2'], 0)
        DBState.db.aiModel = 'edited-live'
        expect(useInChats(idOf('P2'))).toEqual({ ok: true, id: idOf('P2') })
        expect(DBState.db.botPresets[0].aiModel).toBe('edited-live')
        expect(activeName()).toBe('P2')
        expect(DBState.db.aiModel).toBe('m2')
    })

    test('L-a2: use in chats on a stale id refuses and leaves the active preset', () => {
        installDb(['P0', 'P1'], 0)
        expect(useInChats('no-such-id')).toEqual({ ok: false, reason: 'gone' })
        expect(activeName()).toBe('P0')
    })
})

describe('L-a2c the save is marked by the real change hook', () => {
    async function marked(act: () => void | Promise<void>): Promise<boolean> {
        installDb(['P0', 'P1', 'P2'], 1)
        const markChanged = vi.fn()
        const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
        const stop = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        try {
            flushSync()
            tracker.botPreset = false
            markChanged.mockClear()
            await act()
            await sleep(0)
            flushSync()
            return tracker.botPreset && markChanged.mock.calls.some((call) => call[0] === true)
        } finally {
            stop()
        }
    }

    test('new', async () => { expect(await marked(() => { newPreset() })).toBe(true) })
    test('copy', async () => { expect(await marked(() => { copyPresetById(idOf('P0')) })).toBe(true) })
    test('delete of a non-active preset', async () => {
        expect(await marked(async () => {
            const done = deletePresetById(idOf('P2'))
            await answer(true)
            await done
        })).toBe(true)
    })
    test('delete of the active preset', async () => {
        expect(await marked(async () => {
            const done = deletePresetById(idOf('P1'))
            await answer(true)
            await done
        })).toBe(true)
    })
    test('reorder', async () => { expect(await marked(() => { movePresetById(DBState.db, idOf('P2'), 0) })).toBe(true) })
    test('a refused action marks nothing', async () => {
        expect(await marked(() => { copyPresetById('no-such-id') })).toBe(false)
    })
})
