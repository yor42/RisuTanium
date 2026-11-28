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
import { resetToastHostForTests, toastHost } from 'src/ts/toast/toastHost.svelte'
import { assignPresetIds, planSlotAssign } from 'src/ts/storage/presetMeta'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { DBState } from 'src/ts/stores.svelte'
import { commitSlotPlan, dropPresetOnById, moveToFolderWithUndo, movePresetStepById, planSlotForPreset } from './presetListActions'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function installDb(presetNames: string[], selected = 0): void {
    DBState.db = {
        formatversion: 5,
        botPresets: presetNames.map((name) => ({ name, aiModel: 'm' })),
        botPresetsId: selected,
        presetFolders: [{ id: 'fa', name: 'A' }],
        aiModel: 'm',
        NAIsettings: {},
        showPromptComparison: false,
    } as unknown as Database
    assignPresetIds(DBState.db)
}

const names = () => DBState.db.botPresets.map((p) => p.name)
const idOf = (name: string) => DBState.db.botPresets.find((p) => p.name === name)!.id!
const slots = () => DBState.db.botPresets.map((p) => p.slot)
const activeName = () => DBState.db.botPresets[DBState.db.botPresetsId]?.name

async function undoLast(): Promise<void> {
    const toast = toastHost.visible[toastHost.visible.length - 1]
    if (!toast) throw new Error('no toast')
    await toastHost.activate(toast.id)
    await sleep(0)
}

beforeEach(() => {
    resetToastHostForTests()
    confirms.pending.length = 0
    alerts.error.mockClear()
})

function assign(id: string, n: number | null, clearSlot?: number): boolean {
    const planned = planSlotForPreset(id, n, clearSlot)
    return planned.ok && commitSlotPlan(planned.plan)
}

describe('L-c2 slot assignment with the Hotkeys page plan', () => {
    test('a free slot is written to the preset by id and offers Undo', () => {
        installDb(['P0', 'P1', 'P2'])
        const planned = planSlotForPreset(idOf('P1'), 4)
        expect(planned.ok && planned.holder).toBeNull()
        expect(assign(idOf('P1'), 4)).toBe(true)
        expect(slots()).toEqual([undefined, 4, undefined])
        expect(toastHost.visible.length).toBe(1)
    })

    test('a slot held by another preset reports the holder; the swap gives the displaced preset the mover\'s old slot', () => {
        installDb(['P0', 'P1', 'P2'])
        DBState.db.botPresets[0].slot = 1
        DBState.db.botPresets[1].slot = 2
        const planned = planSlotForPreset(idOf('P1'), 1)
        expect(planned.ok && planned.holder).toEqual({ id: idOf('P0'), name: 'P0' })
        expect(planned.ok && planned.moverSlot).toBe(2)
        expect(assign(idOf('P1'), 1)).toBe(true)
        expect(slots()).toEqual([2, 1, undefined])
    })

    test('guard: the plan equals planSlotAssign of the Hotkeys page for the same list', () => {
        installDb(['P0', 'P1', 'P2'])
        DBState.db.botPresets[0].slot = 3
        DBState.db.botPresets[2].slot = 3
        const planned = planSlotForPreset(idOf('P1'), 3)
        expect(planned.ok && planned.plan).toEqual(planSlotAssign(DBState.db.botPresets, 3, 1))
    })

    test('Undo restores the slots, and refuses once a later edit changed any affected slot', async () => {
        installDb(['P0', 'P1'])
        DBState.db.botPresets[0].slot = 1
        assign(idOf('P1'), 1)
        expect(slots()).toEqual([undefined, 1])
        await undoLast()
        expect(slots()).toEqual([1, undefined])
        resetToastHostForTests()
        assign(idOf('P1'), 1)
        DBState.db.botPresets[0].slot = 7
        await undoLast()
        expect(slots()).toEqual([7, 1])
    })

    test('a gone preset writes nothing', () => {
        installDb(['P0'])
        expect(planSlotForPreset('nope', 1)).toEqual({ ok: false, reason: 'gone' })
        expect(commitSlotPlan([{ id: 'nope', before: undefined, after: 1 }])).toBe(false)
        expect(toastHost.visible.length).toBe(0)
    })

    test('L-c3: clearing a slot clears every holder of it, hidden duplicates included', () => {
        installDb(['P0', 'P1', 'P2'])
        DBState.db.botPresets[0].slot = 5
        DBState.db.botPresets[2].slot = 5
        expect(assign(idOf('P0'), null, 5)).toBe(true)
        expect(slots()).toEqual([undefined, undefined, undefined])
    })

    test('clearing with no slot shown writes nothing and posts no toast', () => {
        installDb(['P0'])
        expect(assign(idOf('P0'), null, undefined)).toBe(false)
        expect(toastHost.visible.length).toBe(0)
    })
})

describe('L-c4 move up and down within a folder section', () => {
    function interleaved(): void {
        installDb(['A', 'X', 'B'])
        DBState.db.botPresets[0].folderId = 'fa'
        DBState.db.botPresets[2].folderId = 'fa'
    }

    test('B(f1) moving up passes A, the same section\'s neighbour, and X shifts down', () => {
        interleaved()
        expect(movePresetStepById(idOf('B'), -1).ok).toBe(true)
        expect(names()).toEqual(['B', 'A', 'X'])
    })

    test('A(f1) moving down passes B, not X', () => {
        interleaved()
        movePresetStepById(idOf('A'), 1)
        expect(names()).toEqual(['X', 'B', 'A'])
    })

    test('at the end of its section nothing moves and no toast is posted', () => {
        interleaved()
        expect(movePresetStepById(idOf('A'), -1)).toEqual({ ok: true, id: idOf('A') })
        expect(movePresetStepById(idOf('X'), 1).ok).toBe(true)
        expect(names()).toEqual(['A', 'X', 'B'])
        expect(toastHost.visible.length).toBe(0)
    })

    test('botPresetsId follows the active preset through a step', () => {
        installDb(['P0', 'P1', 'P2'], 1)
        movePresetStepById(idOf('P1'), 1)
        expect(names()).toEqual(['P0', 'P2', 'P1'])
        expect(activeName()).toBe('P1')
        movePresetStepById(idOf('P2'), -1)
        expect(names()).toEqual(['P2', 'P0', 'P1'])
        expect(activeName()).toBe('P1')
    })

    test('drag and drop gives the same list as the steps', () => {
        installDb(['P0', 'P1', 'P2', 'P3'], 0)
        expect(dropPresetOnById(idOf('P0'), idOf('P2')).ok).toBe(true)
        expect(names()).toEqual(['P1', 'P2', 'P0', 'P3'])
        expect(activeName()).toBe('P0')
        installDb(['P0', 'P1', 'P2', 'P3'], 0)
        movePresetStepById(idOf('P0'), 1)
        movePresetStepById(idOf('P0'), 1)
        expect(names()).toEqual(['P1', 'P2', 'P0', 'P3'])
        installDb(['P0', 'P1', 'P2', 'P3'], 0)
        dropPresetOnById(idOf('P3'), idOf('P1'))
        expect(names()).toEqual(['P0', 'P3', 'P1', 'P2'])
    })

    test('a drop with a gone source or target refuses and writes nothing', () => {
        installDb(['P0', 'P1'])
        expect(dropPresetOnById('nope', idOf('P1'))).toEqual({ ok: false, reason: 'gone' })
        expect(dropPresetOnById(idOf('P0'), 'nope')).toEqual({ ok: false, reason: 'gone' })
        expect(names()).toEqual(['P0', 'P1'])
    })

    test('M-c2 guard: a step never changes any preset\'s folder', () => {
        interleaved()
        movePresetStepById(idOf('B'), -1)
        expect(DBState.db.botPresets.map((p) => [p.name, p.folderId])).toEqual([['B', 'fa'], ['A', 'fa'], ['X', undefined]])
    })
})

describe('L-c6 Undo of a reorder and of a folder move', () => {
    test('a reorder is undone while the order is unchanged, and the active preset stays active', async () => {
        installDb(['P0', 'P1', 'P2'], 1)
        movePresetStepById(idOf('P2'), -1)
        expect(names()).toEqual(['P0', 'P2', 'P1'])
        await undoLast()
        expect(names()).toEqual(['P0', 'P1', 'P2'])
        expect(activeName()).toBe('P1')
    })

    test('the pointer follows the preset that is active at undo time, not the one active at the move', async () => {
        installDb(['P0', 'P1', 'P2'], 0)
        movePresetStepById(idOf('P2'), -1)
        DBState.db.botPresetsId = DBState.db.botPresets.findIndex((p) => p.name === 'P2')
        await undoLast()
        expect(names()).toEqual(['P0', 'P1', 'P2'])
        expect(activeName()).toBe('P2')
    })

    test('a later reorder, add or removal makes the Undo refuse and change nothing', async () => {
        for (const later of [
            () => movePresetById(DBState.db, idOf('P0'), 3),
            () => { DBState.db.botPresets.push({ name: 'PX', id: 'px' } as never) },
            () => { DBState.db.botPresets = DBState.db.botPresets.filter((p) => p.name !== 'P0') },
        ]) {
            installDb(['P0', 'P1', 'P2'])
            resetToastHostForTests()
            movePresetStepById(idOf('P2'), -1)
            later()
            const snapshot = names()
            await undoLast()
            expect(names()).toEqual(snapshot)
        }
    })

    test('a folder move is undone while the preset still holds the folder it was moved to', async () => {
        installDb(['P0', 'P1'])
        DBState.db.botPresets[1].folderId = 'fa'
        moveToFolderWithUndo(idOf('P1'), undefined)
        expect(DBState.db.botPresets[1].folderId).toBeUndefined()
        await undoLast()
        expect(DBState.db.botPresets[1].folderId).toBe('fa')
    })

    test('a folder move Undo refuses after a later move of the same preset', async () => {
        installDb(['P0', 'P1'])
        DBState.db.presetFolders.push({ id: 'fb', name: 'B' })
        moveToFolderWithUndo(idOf('P1'), 'fa')
        DBState.db.botPresets[1].folderId = 'fb'
        await undoLast()
        expect(DBState.db.botPresets[1].folderId).toBe('fb')
    })

    test('a folder move Undo refuses when the previous folder was deleted meanwhile', async () => {
        installDb(['P0', 'P1'])
        DBState.db.botPresets[1].folderId = 'fa'
        moveToFolderWithUndo(idOf('P1'), undefined)
        DBState.db.presetFolders = []
        await undoLast()
        expect(DBState.db.botPresets[1].folderId).toBeUndefined()
    })

    test('a move to the folder the preset is already in posts no toast', () => {
        installDb(['P0'])
        DBState.db.botPresets[0].folderId = 'fa'
        moveToFolderWithUndo(idOf('P0'), 'fa')
        expect(toastHost.visible.length).toBe(0)
    })
})

describe('the save is marked by the real change hook (stage c)', () => {
    async function marked(act: () => void | Promise<void>, setup?: () => void): Promise<boolean> {
        installDb(['P0', 'P1', 'P2'], 1)
        setup?.()
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

    test('L-c2: a slot swap', async () => {
        expect(await marked(() => {
            assign(idOf('P2'), 1)
        }, () => {
            DBState.db.botPresets[0].slot = 1
            DBState.db.botPresets[2].slot = 2
        })).toBe(true)
    })
    test('a step', async () => { expect(await marked(() => { movePresetStepById(idOf('P2'), -1) })).toBe(true) })
    test('an undone reorder', async () => {
        expect(await marked(async () => { movePresetStepById(idOf('P2'), -1); await undoLast() })).toBe(true)
    })
    test('a refused step marks nothing', async () => { expect(await marked(() => { movePresetStepById('nope', 1) })).toBe(false) })

})