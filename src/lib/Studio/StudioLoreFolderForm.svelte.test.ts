// @vitest-environment jsdom
/**
 * The lorebook folder form, mounted through the pane over the real history service on the memory doubles. MOCKED: the page
 * store, the save-mark counter and the alert layer. Folder rows come from the classic producer's golden (`addLorebookFolder`).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0 }))
vi.mock('src/ts/alert', () => ({ alertMd: vi.fn() }))
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
import { drainMicrotasks } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { flushStudioFields } from '../../ts/studio/fieldFlush'
import { studioScreen } from '../../ts/studio/studioScreen.svelte'
import {
    click,
    compose,
    doneCount,
    field,
    focusedPart,
    folderRow,
    lore,
    mountPane,
    openEntry,
    part,
    row,
    setupRig,
    startCharacter,
    teardownRig,
    typeInto,
    unmountLast,
} from './StudioLorePane.rig.test-helpers'

beforeEach(() => setupRig())
afterEach(async () => {
    await teardownRig()
})

async function openFolder(): Promise<void> {
    await startCharacter([folderRow('K', 'Group'), { ...row(0), folder: 'K' }, { ...row(1), folder: 'K' }])
    await mountPane()
    await openEntry(0)
}

describe('the folder form', () => {
    test('it shows the folder name and the entry count, and replaces the list', async () => {
        await openFolder()
        expect(field('studio-lore-folder-name').value).toBe('Group')
        expect(part('studio-lore-folder-count')?.textContent).toBe(language.studioLoreFolderCount(2))
        expect(part('studio-lore-list')).toBeNull()
    })

    test('TIME4: a composing Folder name is written once by pagehide, as one step', async () => {
        await openFolder()
        compose(field('studio-lore-folder-name'), '가')
        expect(lore()[0].comment).toBe('Group')
        window.dispatchEvent(new Event('pagehide'))
        await drainMicrotasks()
        expect(lore()[0].comment).toBe('가')
        expect(doneCount()).toBe(1)
    })

    test('TIME4: a composing Folder name still held when the pane unmounts is written in the destroy microtask', async () => {
        await openFolder()
        compose(field('studio-lore-folder-name'), '나')
        await unmountLast()
        await drainMicrotasks()
        expect(lore()[0].comment).toBe('나')
        expect(doneCount()).toBe(1)
    })

    test('TIME4: the leave flush writes the held name, and the typing after it coalesces into the same step', async () => {
        await openFolder()
        compose(field('studio-lore-folder-name'), '다')
        flushStudioFields('leave')
        await drainMicrotasks()
        expect(lore()[0].comment).toBe('다')
        typeInto(field('studio-lore-folder-name'), '다라')
        typeInto(field('studio-lore-folder-name'), '다라마')
        await drainMicrotasks()
        expect(lore()[0].comment).toBe('다라마')
        expect(doneCount()).toBe(1)
    })

    test('Always active sets the folder and the entries directly inside it, in one step', async () => {
        await openFolder()
        await click(field('studio-lore-folder-always-active'))
        expect(lore()[0].alwaysActive).toBe(true)
        expect(lore()[1].alwaysActive).toBe(true)
        expect(lore()[2].alwaysActive).toBe(true)
        expect(doneCount()).toBe(1)
    })

    test('TAddHere: Add entry here opens the new entry`s form with focus on Name, after the folder`s subtree', async () => {
        await openFolder()
        await click(part('studio-lore-add-here'))
        expect(lore()).toHaveLength(4)
        expect(lore()[3].folder).toBe('K')
        expect(studioScreen.selectedItemId).toBe('A/lore:3')
        expect(studioScreen.listReturn?.rowId).toBe('A/lore:3')
        expect(part('studio-lore-folder-form')).toBeNull()
        expect(focusedPart()).toBe('studio-lore-name')
    })

    test('an unnamed folder titles its form with the unnamed fallback', async () => {
        await startCharacter([folderRow('K', '')])
        await mountPane()
        await openEntry(0)
        expect(part('studio-lore-form-title')?.textContent).toBe(language.sidebarUi.unnamedFolder)
    })
})
