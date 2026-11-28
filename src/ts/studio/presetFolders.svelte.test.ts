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
import { groupPresetsByFolder } from 'src/ts/storage/presetListOps'
import { assignPresetIds } from 'src/ts/storage/presetMeta'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { DBState } from 'src/ts/stores.svelte'
import { cleanFolderName, createFolder, deleteFolderById, movePresetToFolderById, moveFolderBy, newPreset, renameFolder } from './presetListActions'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function installDb(presetNames: string[], folders: string[] = []): void {
    DBState.db = {
        formatversion: 5,
        botPresets: presetNames.map((name) => ({ name, aiModel: 'm' })),
        botPresetsId: 0,
        presetFolders: folders.map((name) => ({ id: 'f-' + name, name })),
        aiModel: 'm',
        NAIsettings: {},
        showPromptComparison: false,
    } as unknown as Database
    assignPresetIds(DBState.db)
}

const idOf = (name: string) => DBState.db.botPresets.find((p) => p.name === name)!.id!
const folderOf = (name: string) => DBState.db.botPresets.find((p) => p.name === name)!.folderId

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

describe('L-b1 create and rename a folder', () => {
    test('a name is trimmed and stored at the end of the folder list', () => {
        installDb(['P0'], ['A'])
        const result = createFolder('  Work  ')
        expect(result.ok).toBe(true)
        expect(DBState.db.presetFolders.map((f) => f.name)).toEqual(['A', 'Work'])
        expect(DBState.db.presetFolders[1].id).toBe(result.ok ? result.id : '')
    })

    test('an empty or blank name is refused and nothing is stored', () => {
        installDb(['P0'], ['A'])
        expect(createFolder('   ')).toEqual({ ok: false, reason: 'required' })
        expect(renameFolder('f-A', '')).toEqual({ ok: false, reason: 'required' })
        expect(DBState.db.presetFolders.map((f) => f.name)).toEqual(['A'])
    })

    test('a name over the 200 unit cap is cut on a whole code point', () => {
        expect(cleanFolderName('x'.repeat(250))).toBe('x'.repeat(200))
        const cut = cleanFolderName('x'.repeat(199) + '😀')
        expect(cut).toBe('x'.repeat(199))
    })

    test('rename writes the trimmed name to that folder only; a missing folder refuses', () => {
        installDb(['P0'], ['A', 'B'])
        expect(renameFolder('f-B', ' Beta ')).toEqual({ ok: true, id: 'f-B' })
        expect(DBState.db.presetFolders.map((f) => f.name)).toEqual(['A', 'Beta'])
        expect(renameFolder('f-none', 'x')).toEqual({ ok: false, reason: 'folder-gone' })
    })

    test('guard: a database with no folder list gets one on the first create', () => {
        installDb(['P0'])
        delete (DBState.db as { presetFolders?: unknown }).presetFolders
        expect(createFolder('A').ok).toBe(true)
        expect(DBState.db.presetFolders.map((f) => f.name)).toEqual(['A'])
    })
})

describe('L-b2 move a preset in and out by id', () => {
    test('the preset that holds the id gets the folder, even after the list was reordered', () => {
        installDb(['P0', 'P1', 'P2'], ['A'])
        const id = idOf('P2')
        DBState.db.botPresets = [DBState.db.botPresets[2], DBState.db.botPresets[0], DBState.db.botPresets[1]]
        expect(movePresetToFolderById(id, 'f-A')).toEqual({ ok: true, id })
        expect([folderOf('P0'), folderOf('P1'), folderOf('P2')]).toEqual([undefined, undefined, 'f-A'])
    })

    test('moving out deletes the key; a gone preset or folder refuses and writes nothing', () => {
        installDb(['P0', 'P1'], ['A'])
        movePresetToFolderById(idOf('P1'), 'f-A')
        expect(movePresetToFolderById(idOf('P1'), undefined).ok).toBe(true)
        expect('folderId' in DBState.db.botPresets[1]).toBe(false)
        expect(movePresetToFolderById('nope', 'f-A')).toEqual({ ok: false, reason: 'gone' })
        expect(movePresetToFolderById(idOf('P0'), 'f-none')).toEqual({ ok: false, reason: 'folder-gone' })
        expect(folderOf('P0')).toBeUndefined()
    })

    test('L-b4: a preset with a dangling folder id is unfoldered in the grouping and can be moved', () => {
        installDb(['P0', 'P1'], ['A'])
        DBState.db.botPresets[1].folderId = 'f-removed'
        const sections = groupPresetsByFolder(DBState.db)
        expect(sections.map((s) => [s.folder?.id ?? null, s.indices])).toEqual([['f-A', []], [null, [0, 1]]])
        expect(movePresetToFolderById(idOf('P1'), 'f-A').ok).toBe(true)
        expect(folderOf('P1')).toBe('f-A')
    })
})

describe('L-b3 delete a folder', () => {
    test('members become folderless, no preset is removed, and the confirm names the count', async () => {
        installDb(['P0', 'P1', 'P2'], ['A', 'B'])
        movePresetToFolderById(idOf('P0'), 'f-A')
        movePresetToFolderById(idOf('P1'), 'f-A')
        movePresetToFolderById(idOf('P2'), 'f-B')
        const done = deleteFolderById('f-A')
        await sleep(0)
        expect(confirms.pending[0].message).toBe(language.studioPresetFolderDeleteConfirm(2))
        await answer(true)
        expect(await done).toEqual({ ok: true })
        expect(DBState.db.botPresets.map((p) => p.name)).toEqual(['P0', 'P1', 'P2'])
        expect([folderOf('P0'), folderOf('P1'), folderOf('P2')]).toEqual([undefined, undefined, 'f-B'])
        expect(DBState.db.presetFolders.map((f) => f.id)).toEqual(['f-B'])
    })

    test('a cancelled confirm changes nothing; a folder removed while the confirm was open refuses', async () => {
        installDb(['P0'], ['A'])
        movePresetToFolderById(idOf('P0'), 'f-A')
        const cancelled = deleteFolderById('f-A')
        await answer(false)
        expect(await cancelled).toEqual({ ok: false, reason: 'cancelled' })
        expect(folderOf('P0')).toBe('f-A')
        const raced = deleteFolderById('f-A')
        await sleep(0)
        DBState.db.presetFolders = []
        await answer(true)
        expect(await raced).toEqual({ ok: false, reason: 'folder-gone' })
    })
})

describe('folder order', () => {
    test('move up and down swap neighbours and stop at the ends', () => {
        installDb(['P0'], ['A', 'B', 'C'])
        moveFolderBy('f-C', -1)
        expect(DBState.db.presetFolders.map((f) => f.name)).toEqual(['A', 'C', 'B'])
        moveFolderBy('f-A', -1)
        moveFolderBy('f-B', 1)
        expect(DBState.db.presetFolders.map((f) => f.name)).toEqual(['A', 'C', 'B'])
        expect(moveFolderBy('f-none', 1)).toEqual({ ok: false, reason: 'folder-gone' })
    })
})

describe('L-b5 grouped order', () => {
    test('folders in folder order, then unfoldered; global order kept inside a section', () => {
        installDb(['P0', 'P1', 'P2', 'P3'], ['A', 'B'])
        movePresetToFolderById(idOf('P3'), 'f-A')
        movePresetToFolderById(idOf('P0'), 'f-B')
        movePresetToFolderById(idOf('P1'), 'f-A')
        expect(groupPresetsByFolder(DBState.db).map((s) => [s.folder?.id ?? null, s.indices])).toEqual([['f-A', [1, 3]], ['f-B', [0]], [null, [2]]])
    })

    test('no folders gives one unfoldered section; an empty unfoldered section is left out when a folder exists', () => {
        installDb(['P0'])
        expect(groupPresetsByFolder(DBState.db)).toEqual([{ folder: null, indices: [0] }])
        installDb(['P0'], ['A'])
        movePresetToFolderById(idOf('P0'), 'f-A')
        expect(groupPresetsByFolder(DBState.db).map((s) => s.folder?.id ?? null)).toEqual(['f-A'])
    })
})

describe('L-b6 the save is marked by the real change hook', () => {
    async function marked(act: () => void | Promise<void>): Promise<boolean> {
        installDb(['P0', 'P1'], ['A'])
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
            return markChanged.mock.calls.some((call) => call[0] === true)
        } finally {
            stop()
        }
    }

    test('create folder', async () => { expect(await marked(() => { createFolder('N') })).toBe(true) })
    test('rename folder', async () => { expect(await marked(() => { renameFolder('f-A', 'Z') })).toBe(true) })
    test('move a preset into a folder', async () => { expect(await marked(() => { movePresetToFolderById(idOf('P1'), 'f-A') })).toBe(true) })
    test('delete a folder', async () => {
        expect(await marked(async () => {
            movePresetToFolderById(idOf('P1'), 'f-A')
            const done = deleteFolderById('f-A')
            await answer(true)
            await done
        })).toBe(true)
    })
    test('new preset in a folder', async () => {
        expect(await marked(() => { const r = newPreset(); if (r.ok && r.id) movePresetToFolderById(r.id, 'f-A') })).toBe(true)
    })
    test('a refused move marks nothing', async () => { expect(await marked(() => { movePresetToFolderById('nope', 'f-A') })).toBe(false) })
})