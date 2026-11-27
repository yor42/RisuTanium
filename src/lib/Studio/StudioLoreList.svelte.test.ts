// @vitest-environment jsdom
/**
 * The lorebook list of the pane: windowing, inert rows, the move sheet, the always-active toggles, the bulk menu and the
 * reveal of a row by its item id. Real history service on the memory doubles over a reactive database and the real English
 * `language`. MOCKED: the page store, the save-mark counter and the alert layer.
 */
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0 }))
vi.mock('src/ts/alert', () => ({ alertMd: vi.fn() }))
// `lorebookRepairNeed` reads the module body alone; the loader's migration it sits beside pulls in the whole database layer.
vi.mock('src/ts/characters', () => ({ updateLorebooks: (book: unknown) => book }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: { characters: [] } as unknown })
    return {
        DBState: state,
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        ReloadGUIPointer: writable(0),
    }
})

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import { golden, clone } from '../../ts/studio/history/tests/objService.test-helpers'
import { readExpandedFolders } from '../../ts/studio/loreFolderExpansion'
import { loreItemIdOf } from '../../ts/studio/ownerModel'
import { studioScreen } from '../../ts/studio/studioScreen.svelte'
import { setWindowGeometryForTests } from '../../ts/windowing/windowHost.svelte'
import {
    STUDIO_KEY,
    choose,
    click,
    doneCount,
    focusedPart,
    focusedRowKey,
    folderRow,
    inRow,
    key,
    lore,
    mountPane,
    openMenuOf,
    part,
    parts,
    row,
    settle,
    setupRig,
    startCharacter,
    teardownRig,
} from './StudioLorePane.rig.test-helpers'
import { drainMicrotasks } from '../../ts/studio/history/tests/historyTestKit.test-helpers'

beforeEach(() => setupRig())
afterEach(async () => {
    await teardownRig()
})

describe('T29: windowing', () => {
    test('2000 entries mount only the rows near the band, and a far row is reachable by its item id', async () => {
        let frames: (() => void)[] = []
        setWindowGeometryForTests({
            rectOf: () => ({ top: 0, height: 600 }),
            viewport: () => 600,
            scrollBy: () => {},
            schedule: (callback) => {
                frames.push(callback)
                return () => { frames = frames.filter((frame) => frame !== callback) }
            },
        })
        const settleWindow = async (): Promise<void> => {
            for (let round = 0; round < 4; round++) {
                await drainMicrotasks()
                flushSync()
                // The host's reveal waits on Svelte's tick(), which resolves on a frame or a timer.
                await new Promise<void>((resolve) => setTimeout(resolve, 30))
                const pending = frames
                frames = []
                for (const frame of pending) frame()
                flushSync()
            }
        }
        await startCharacter(Array.from({ length: 2000 }, (_, index) => row(index)))
        await mountPane()
        await settleWindow()
        const mounted = parts('studio-lore-row').length
        expect(mounted).toBeGreaterThan(0)
        expect(mounted).toBeLessThan(200)
        expect(inRow('@1500', 'studio-lore-row-name')).toBeNull()
        studioScreen.revealListRow = loreItemIdOf('A', 1500)
        await settleWindow()
        expect(inRow('@1500', 'studio-lore-row-name')).not.toBeNull()
        expect(focusedRowKey()).toBe('@1500')
        expect(parts('studio-lore-row').length).toBeLessThan(200)
    })
})

describe('T59: rows that are not entries', () => {
    test('are inert, carry no controls, and stay in place through a bulk change', async () => {
        // The golden `mixedRows` list is the producer: an imported list holding an entry, a null, two scalars, an array and an entry.
        const mixed = clone(golden.mixedRows.globalLore)
        await startCharacter(mixed, { bulk: true })
        await mountPane()
        const inert = parts('studio-lore-row-inert')
        expect(inert).toHaveLength(4)
        for (const element of inert) {
            expect(element.textContent).toBe(language.studioLoreNonEntryRow)
            const rowElement = element.closest<HTMLElement>('[data-part="studio-lore-row"]')!
            expect(rowElement.querySelector('button')).toBeNull()
        }
        // The keys of a row act only on an entry or a folder: Delete and Alt+ArrowDown on the inert array row do nothing.
        const inertRow = inert[3].closest<HTMLElement>('[data-part="studio-lore-row"]')!
        key(inertRow, { key: 'Delete' })
        key(inertRow, { key: 'ArrowDown', altKey: true })
        await settle()
        expect(doneCount()).toBe(0)
        expect(part('studio-lore-refusal')).toBeNull()
        expect(part('studio-lore-confirm')).toBeNull()
        expect(lore()).toHaveLength(6)
        await click(part('studio-lore-bulk-menu'))
        await choose('studio-lore-bulk-on')
        expect(lore()[0].alwaysActive).toBe(true)
        expect(lore()[5].alwaysActive).toBe(true)
        expect(lore()[1]).toBeNull()
        expect(lore()[2]).toBe('x')
        expect(lore()[3]).toBe(5)
        expect(lore()[4]).toEqual([])
        expect(doneCount()).toBe(1)
    })
})

describe('T17a: the move sheet', () => {
    test('offers the top level and the other folders, never the row`s own subtree', async () => {
        await startCharacter([folderRow('K1', 'F1'), { ...row(0), folder: 'K1' }, folderRow('K2', 'F2', { folder: 'K1' }), folderRow('K3', 'F3')])
        await mountPane()
        await openMenuOf('f:K1')
        await choose('studio-lore-move-to-folder')
        const offered = parts('studio-lore-sheet-target').map((element) => element.dataset.folderKey)
        expect(offered).toEqual(['', 'K3'])
        await click(part('studio-lore-sheet-cancel'))
        expect(part('studio-lore-sheet')).toBeNull()
        expect(doneCount()).toBe(0)
        expect(focusedPart()).toBe('studio-lore-row-menu')
    })
})

describe('T18: always active in the list', () => {
    test('(a) a folder toggle sets the folder and its direct children, not the grandchild', async () => {
        await startCharacter([folderRow('K1', 'F1'), { ...row(0), folder: 'K1' }, folderRow('K2', 'F2', { folder: 'K1' }), { ...row(1), folder: 'K2' }])
        await mountPane()
        await click(inRow('f:K1', 'studio-lore-row-toggle'))
        expect(lore().map((entry) => entry.alwaysActive)).toEqual([true, true, true, false])
        expect(doneCount()).toBe(1)
        expect(inRow('f:K1', 'studio-lore-row-toggle')?.getAttribute('aria-pressed')).toBe('true')
        expect(focusedPart()).toBe('studio-lore-row-toggle')
    })

    test('(b) a linked entry of a chat list has no always-active toggle', async () => {
        // The shape `activateLocally` writes: a child link, always active.
        const link = { key: '', comment: '', content: '', mode: 'child', insertorder: 100, alwaysActive: true, secondkey: '', selective: false, id: 'x' }
        await startCharacter([], { localLore: [link] })
        await mountPane({ ownerType: 'chat', ownerId: 'c1' })
        await settle()
        expect(inRow('id:x', 'studio-lore-row-name')).not.toBeNull()
        expect(inRow('id:x', 'studio-lore-row-toggle')).toBeNull()
    })

    test('(c) bulk off on a chat list leaves the links on and turns the entries off', async () => {
        const link = (id: string) => ({ key: '', comment: '', content: '', mode: 'child', insertorder: 100, alwaysActive: true, secondkey: '', selective: false, id })
        await startCharacter([], { localLore: [link('x'), { ...row(0), alwaysActive: true }, link('y')], bulk: true })
        await mountPane({ ownerType: 'chat', ownerId: 'c1' })
        await settle()
        await click(part('studio-lore-bulk-menu'))
        await choose('studio-lore-bulk-off')
        const stored = (DBState.db.characters as unknown as { chats: { localLore: { alwaysActive: boolean }[] }[] }[])[0].chats[0].localLore
        expect(stored.map((entry) => entry.alwaysActive)).toEqual([true, false, true])
    })
})

describe('T42p: the bulk menu', () => {
    test('shows only while the app setting is on, and after a bulk change focus returns to its trigger with no selection', async () => {
        await startCharacter([row(0), row(1)])
        await mountPane()
        expect(part('studio-lore-bulk-menu')).toBeNull()
        await teardownRig()
        setupRig()
        await startCharacter([row(0), row(1)], { bulk: true })
        await mountPane()
        expect(part('studio-lore-bulk-menu')).not.toBeNull()
        await click(part('studio-lore-bulk-menu'))
        await choose('studio-lore-bulk-on')
        expect(lore().map((entry) => entry.alwaysActive)).toEqual([true, true])
        expect(studioScreen.selectedItemId).toBeNull()
        expect(focusedPart()).toBe('studio-lore-bulk-menu')
    })
})

describe('TR1: the reveal of a row by its item id', () => {
    test('(a) an item of this owner opens its folders, scrolls to its row and focuses it, spending the request', async () => {
        await startCharacter([folderRow('K', 'G'), { ...row(0), folder: 'K' }])
        await mountPane()
        expect(inRow('@1', 'studio-lore-row-name')).toBeNull()
        studioScreen.revealListRow = loreItemIdOf('A', 1)
        await settle()
        expect(readExpandedFolders(STUDIO_KEY).has('K')).toBe(true)
        expect(focusedRowKey()).toBe('@1')
        expect(focusedPart()).toBe('studio-lore-row-name')
        expect(studioScreen.revealListRow).toBeNull()
    })

    test('(b) an id of another list is left alone and nothing takes focus', async () => {
        await startCharacter([row(0)])
        await mountPane()
        studioScreen.revealListRow = 'lt:2'
        await settle()
        expect(studioScreen.revealListRow).toBe('lt:2')
        expect(focusedRowKey()).toBeNull()
    })

    test('(c) an item with no row is spent with nothing shown', async () => {
        await startCharacter([row(0)])
        await mountPane()
        studioScreen.revealListRow = loreItemIdOf('A', 999)
        await settle()
        expect(studioScreen.revealListRow).toBeNull()
        expect(focusedRowKey()).toBeNull()
    })
})
