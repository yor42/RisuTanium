// @vitest-environment jsdom
/**
 * The lorebook pane in list mode over the real history service on the memory doubles and the real English `language`.
 * MOCKED: the page store (DBState is a `$state` object, so the list re-renders from live writes), the save-mark counter and
 * the alert layer (the Help buttons open it). Rows come from the classic producers' golden; an outside change is made the
 * way the classic editor or a History replay makes it (a direct splice, or the service itself), never through the pane.
 */
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0, saveAsset: vi.fn() }))
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
        // The parser's asset cache reads the module list of the selected character once a module host's form mounts.
        selectedCharID: writable(0),
    }
})

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import { trackedOf } from '../../ts/studio/edit/loreListModel'
import { loreDelete, loreDeleteFolder, loreNewId } from '../../ts/studio/edit/loreListOps'
import { registerStudioField } from '../../ts/studio/fieldFlush'
import { loreItemIdOf, ownerKeyOf } from '../../ts/studio/ownerModel'
import { refusalText } from '../../ts/studio/edit/studioToasts'
import { readExpandedFolders } from '../../ts/studio/loreFolderExpansion'
import { publishOpenModuleId, clearOpenModuleId, resetOpenModuleIdForTests } from '../../ts/studio/assets/openModuleForm.svelte'
import { chatOwnerKey, moduleOwnerKey } from '../../ts/studio/history/ownerPhase'
import { setStudioHistoryServiceForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { openStudioListRow, setStudioHistoryOpen, setStudioRestoreSheetOpen, setStudioSelection, studioDetailBack, studioScreen } from '../../ts/studio/studioScreen.svelte'
import { residentModule } from '../../ts/studio/studioFixtures.test-helpers'
import { toastHost } from '../../ts/toast/toastHost.svelte'
import { buildOwnerModel } from '../../ts/studio/ownerModel'
import { makeInput } from '../../ts/studio/studioFixtures.test-helpers'
import StudioCombined, { combinedKeyOf } from './StudioCombined.svelte'
import StudioRestoreSheet from './StudioRestoreSheet.svelte'
import { makeModuleRig } from './moduleFormRig.test-helpers'
import {
    A,
    STUDIO_KEY,
    changeTo,
    choose,
    click,
    comments,
    compose,
    doneCount,
    field,
    focusedPart,
    focusedRowKey,
    folderRow,
    inRow,
    key,
    lore,
    mountInto,
    mountPane,
    openEntry,
    openMenuOf,
    outsideRemove,
    part,
    parts,
    row,
    rowLabels,
    rowOf,
    service,
    settle,
    setupRig,
    startCharacter,
    teardownRig,
    typeInto,
    unmountLast,
    type Row,
} from './StudioLorePane.rig.test-helpers'

beforeEach(() => setupRig())
afterEach(async () => {
    resetOpenModuleIdForTests()
    await teardownRig()
})

const activeLabel = (): string => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? ''

describe('T17b: a list-mode move writes no selection and focuses the landed row', () => {
    test('Move up on a folder whose child precedes it: no form mounts, and focus is on the folder row`s menu button', async () => {
        // Rows [child of K, X, F (key K)]: the folder's block is the child and F, so the move lands at the block start + 1.
        await startCharacter([{ ...row(0), folder: 'K' }, row(1), folderRow('K', 'F')])
        await mountPane()
        expect(rowOf('f:K')).not.toBeNull()
        await openMenuOf('f:K')
        await choose('studio-lore-move-up')
        expect(comments()).toEqual(['Row 0', 'F', 'Row 1'])
        expect(studioScreen.selectedItemId).toBeNull()
        expect(part('studio-lore-folder-name')).toBeNull()
        expect(focusedPart()).toBe('studio-lore-row-menu')
        expect(focusedRowKey()).toBe('f:K')
        expect(doneCount()).toBe(1)
    })
})

describe('T17d: landing focus and folders opening', () => {
    test('Alt+ArrowDown on an id-less entry focuses its name button at the new key and writes no selection', async () => {
        await startCharacter([row(0), row(1)])
        await mountPane()
        key(inRow('@0', 'studio-lore-row-name')!, { key: 'ArrowDown', altKey: true })
        await settle()
        expect(comments()).toEqual(['Row 1', 'Row 0'])
        expect(studioScreen.selectedItemId).toBeNull()
        expect(focusedPart()).toBe('studio-lore-row-name')
        expect(focusedRowKey()).toBe('@1')
        expect(activeLabel()).toContain('Row 0')
    })

    test('Move to folder into a collapsed folder opens it, persists that, and focuses the moved row`s menu button', async () => {
        await startCharacter([row(0), folderRow('K', 'G')])
        await mountPane()
        expect(rowOf('@0')).not.toBeNull()
        await openMenuOf('@0')
        await choose('studio-lore-move-to-folder')
        expect(part('studio-lore-sheet')).not.toBeNull()
        await click(document.querySelector<HTMLElement>('[data-part="studio-lore-sheet-target"][data-folder-key="K"]'))
        expect(lore().map((entry) => [entry.comment, entry.folder])).toEqual([['G', undefined], ['Row 0', 'K']])
        expect(readExpandedFolders(STUDIO_KEY).has('K')).toBe(true)
        expect(rowOf('@1')).not.toBeNull()
        expect(focusedPart()).toBe('studio-lore-row-menu')
        expect(focusedRowKey()).toBe('@1')
        expect(studioScreen.selectedItemId).toBeNull()
    })
})

describe('TDup: Duplicate in the list', () => {
    test('one step, no selection, no form, and the copy`s name button holds focus', async () => {
        await startCharacter([row(0), row(1)])
        await mountPane()
        await openMenuOf('@0')
        await choose('studio-lore-duplicate')
        expect(comments()).toEqual(['Row 0', 'Row 0', 'Row 1'])
        expect(doneCount()).toBe(1)
        const copyId = lore()[1].id as string
        expect(copyId).toBeTruthy()
        expect(studioScreen.selectedItemId).toBeNull()
        expect(focusedRowKey()).toBe(`id:${copyId}`)
        expect(focusedPart()).toBe('studio-lore-row-name')
    })
})

describe('TL1: the row always-active toggle', () => {
    test('on a module host it lands one step, writes no selection and keeps focus on that row`s toggle', async () => {
        const rig = makeModuleRig()
        // A resident module row stands in for an imported one: the import path needs the module loader, which a list test does not exercise.
        DBState.db = {
            characters: [{ chaId: 'A', type: 'character', chats: [{ id: 'c1', note: '', fmIndex: -1, localLore: [] }], chatPage: 0, globalLore: [] }],
            modules: [residentModule('m1', { lorebook: [row(0), row(1)] as never })],
        } as unknown as typeof DBState.db
        const token = publishOpenModuleId('m1')
        await mountPane({ ownerType: 'module', ownerId: 'm1', moduleId: 'm1', moduleSlotIndex: 0 })
        await settle()
        const owner = moduleOwnerKey('m1')
        await rig.service.whenReady(owner)
        flushSync()
        // A module host stays read-only until its lorebook repair check resolves; the toggle is disabled until then.
        await vi.waitFor(() => expect((inRow('@1', 'studio-lore-row-toggle') as HTMLButtonElement).disabled).toBe(false))
        await click(inRow('@1', 'studio-lore-row-toggle'))
        expect(rig.service.view(owner).done).toHaveLength(1)
        expect(((DBState.db.modules as unknown as { lorebook: { alwaysActive: boolean }[] }[])[0]).lorebook[1].alwaysActive).toBe(true)
        expect(studioScreen.selectedItemId).toBeNull()
        expect(focusedPart()).toBe('studio-lore-row-toggle')
        expect(focusedRowKey()).toBe('@1')
        clearOpenModuleId(token)
    })
})

describe('TF: focus after a delete', () => {
    test('(a) the next visible row is a collapsed folder whose children follow it', async () => {
        await startCharacter([row(0), row(1), folderRow('K', 'F'), { ...row(2), folder: 'K' }])
        await mountPane()
        key(inRow('@1', 'studio-lore-row-name')!, { key: 'Delete' })
        await settle()
        expect(comments()).toEqual(['Row 0', 'F', 'Row 2'])
        expect(focusedRowKey()).toBe('f:K')
        expect(focusedPart()).toBe('studio-lore-row-name')
    })

    test('(b) the last child of an expanded folder, whose array neighbour sits in an unrelated collapsed folder: the previous visible row', async () => {
        localStorage.setItem('risuStudio.loreFolders.' + STUDIO_KEY, JSON.stringify(['K1']))
        await startCharacter([folderRow('K2', 'F2'), folderRow('K1', 'F1'), { ...row(1), folder: 'K1' }, { ...row(2), folder: 'K2' }])
        await mountPane()
        expect(rowLabels()).toEqual(['F2', 'F1', 'Row 1'])
        await openMenuOf('@2')
        await choose('studio-lore-delete')
        expect(comments()).toEqual(['F2', 'F1', 'Row 2'])
        expect(focusedRowKey()).toBe('f:K1')
        expect(focusedPart()).toBe('studio-lore-row-name')
    })

    test('(c) a folder delete with a non-contiguous subtree focuses the next visible row', async () => {
        await startCharacter([row(0), folderRow('K', 'F'), row(1), { ...row(2), folder: 'K' }])
        await mountPane()
        key(inRow('f:K', 'studio-lore-row-name')!, { key: 'Delete' })
        await settle()
        expect(part('studio-lore-confirm')).not.toBeNull()
        await choose('studio-lore-confirm-delete')
        expect(comments()).toEqual(['Row 0', 'Row 1'])
        expect(focusedPart()).toBe('studio-lore-row-name')
        expect(activeLabel()).toContain('Row 1')
    })

    test('(d) the last row hands focus to the row before it', async () => {
        await startCharacter([row(0), row(1)])
        await mountPane()
        await openMenuOf('@1')
        await choose('studio-lore-delete')
        expect(comments()).toEqual(['Row 0'])
        expect(focusedPart()).toBe('studio-lore-row-name')
        expect(activeLabel()).toContain('Row 0')
    })

    test('a delete posts its Undo toast, and the toast`s Undo puts the row back', async () => {
        await startCharacter([row(0), row(1)])
        await mountPane()
        await openMenuOf('@1')
        await choose('studio-lore-delete')
        expect(toastHost.visible.map((toast) => toast.text)).toEqual([language.studioLoreDeleted('Row 1')])
        await toastHost.activate(toastHost.visible[0].id)
        await settle()
        expect(comments()).toEqual(['Row 0', 'Row 1'])
    })
})

describe('TE1: a refused or unchanged op changes nothing else', () => {
    test('a refused delete posts no toast, writes no selection and shows the refusal', async () => {
        await startCharacter([row(0), row(1)])
        setStudioHistoryServiceForTests(new Proxy(service, {
            get: (target, property) => (property === 'objEdit' ? () => ({ ok: false, reason: 'gone' }) : Reflect.get(target, property)),
        }))
        await mountPane()
        await openMenuOf('@1')
        await choose('studio-lore-delete')
        expect(toastHost.visible).toHaveLength(0)
        expect(studioScreen.selectedItemId).toBeNull()
        expect(comments()).toEqual(['Row 0', 'Row 1'])
        expect(part('studio-lore-refusal')?.textContent).toBe(refusalText('gone'))
    })

    test('a bulk change whose values already match writes no step, shows nothing and selects nothing', async () => {
        await startCharacter([{ ...row(0), alwaysActive: true }, { ...row(1), alwaysActive: true }], { bulk: true })
        await mountPane()
        await click(part('studio-lore-bulk-menu'))
        await choose('studio-lore-bulk-on')
        expect(doneCount()).toBe(0)
        expect(toastHost.visible).toHaveLength(0)
        expect(part('studio-lore-refusal')).toBeNull()
        expect(studioScreen.selectedItemId).toBeNull()
        expect(focusedPart()).toBe('studio-lore-bulk-menu')
    })

    test('a move that changes nothing writes no step, no refusal and returns focus to the row`s menu button', async () => {
        await startCharacter([row(0), row(1)])
        await mountPane()
        await openMenuOf('@0')
        await choose('studio-lore-move-up')
        expect(doneCount()).toBe(0)
        expect(part('studio-lore-refusal')).toBeNull()
        expect(studioScreen.selectedItemId).toBeNull()
        expect(focusedPart()).toBe('studio-lore-row-menu')
        expect(focusedRowKey()).toBe('@0')
    })
})

describe('T41: the folder delete question', () => {
    test('an empty folder deletes at once; a folder with entries asks, Cancel writes nothing and Delete is one step with its counts', async () => {
        await startCharacter([folderRow('E', 'Empty'), folderRow('K', 'Full'), { ...row(0), folder: 'K' }])
        await mountPane()
        await openMenuOf('f:E')
        await choose('studio-lore-delete')
        expect(part('studio-lore-confirm')).toBeNull()
        expect(comments()).toEqual(['Full', 'Row 0'])
        expect(doneCount()).toBe(1)

        await openMenuOf('f:K')
        await choose('studio-lore-delete')
        expect(part('studio-lore-confirm-text')?.textContent).toBe(language.studioLoreFolderDeleteConfirm('Full', 1, 0))
        expect(focusedPart()).toBe('studio-lore-confirm-cancel')
        await choose('studio-lore-confirm-cancel')
        expect(part('studio-lore-confirm')).toBeNull()
        expect(doneCount()).toBe(1)

        await openMenuOf('f:K')
        await choose('studio-lore-delete')
        await choose('studio-lore-confirm-delete')
        expect(comments()).toEqual([])
        expect(doneCount()).toBe(2)
    })

    test('Esc and the backdrop write nothing', async () => {
        await startCharacter([folderRow('K', 'Full'), { ...row(0), folder: 'K' }])
        await mountPane()
        await openMenuOf('f:K')
        await choose('studio-lore-delete')
        part('studio-lore-confirm')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await settle()
        expect(part('studio-lore-confirm')).toBeNull()
        await openMenuOf('f:K')
        await choose('studio-lore-delete')
        await click(part('studio-lore-confirm-backdrop'))
        expect(part('studio-lore-confirm')).toBeNull()
        expect(doneCount()).toBe(0)
        expect(comments()).toEqual(['Full', 'Row 0'])
    })
})

describe('Rule D (MC-4192): a surface acts on the entry it was opened on, or closes', () => {
    const outside = (build: ReturnType<typeof loreDelete>): void => {
        service.objEdit(A, build.build)
        flushSync()
    }

    test('TDT1: the folder question names and deletes the folder it was opened on after an outside delete moved it', async () => {
        await startCharacter([row(0), folderRow('K1', 'F1'), folderRow('K2', 'G1'), { ...row(1), folder: 'K1' }, { ...row(2), folder: 'K2' }])
        await mountPane()
        await openMenuOf('f:K1')
        await choose('studio-lore-delete')
        outside(loreDelete(trackedOf(lore(), 0)!, 0))
        await settle()
        expect(part('studio-lore-confirm-text')?.textContent).toBe(language.studioLoreFolderDeleteConfirm('F1', 1, 0))
        const before = doneCount()
        await choose('studio-lore-confirm-delete')
        expect(doneCount()).toBe(before + 1)
        expect(comments()).toEqual(['G1', 'Row 2'])
    })

    test('TDT1b: an outside delete of the folder closes the question, writes nothing and focuses the list', async () => {
        await startCharacter([row(0), folderRow('K1', 'F1'), folderRow('K2', 'G1'), { ...row(1), folder: 'K1' }, { ...row(2), folder: 'K2' }])
        await mountPane()
        await openMenuOf('f:K1')
        await choose('studio-lore-delete')
        outside(loreDeleteFolder(trackedOf(lore(), 1)!, 1))
        await settle()
        expect(part('studio-lore-confirm')).toBeNull()
        expect(doneCount()).toBe(1)
        expect(comments()).toEqual(['Row 0', 'G1', 'Row 2'])
        expect(focusedPart()).toBe('studio-lore-list')
    })

    test('TDT1c: a closing question leaves focus alone when the user already moved it elsewhere (E-8)', async () => {
        await startCharacter([row(0), folderRow('K1', 'F1'), { ...row(1), folder: 'K1' }])
        const elsewhere = document.createElement('input')
        document.body.append(elsewhere)
        await mountPane()
        await openMenuOf('f:K1')
        await choose('studio-lore-delete')
        elsewhere.focus()
        outside(loreDeleteFolder(trackedOf(lore(), 1)!, 1))
        await settle()
        expect(part('studio-lore-confirm')).toBeNull()
        expect(document.activeElement).toBe(elsewhere)
        elsewhere.remove()
    })

    test('TDT2: the move sheet moves the entry it was opened on after an outside delete shifted the rows', async () => {
        await startCharacter([row(0), row(1), row(2), folderRow('K', 'G')])
        await mountPane()
        await openMenuOf('@1')
        await choose('studio-lore-move-to-folder')
        outside(loreDelete(trackedOf(lore(), 0)!, 0))
        await settle()
        await click(document.querySelector<HTMLElement>('[data-part="studio-lore-sheet-target"][data-folder-key="K"]'))
        expect(lore().map((entry) => [entry.comment, entry.folder])).toEqual([['Row 2', undefined], ['G', undefined], ['Row 1', 'K']])
    })

    test('TDT2b: an outside delete of the entry closes the sheet and writes nothing', async () => {
        await startCharacter([row(0), row(1), row(2), folderRow('K', 'G')])
        await mountPane()
        await openMenuOf('@1')
        await choose('studio-lore-move-to-folder')
        outside(loreDelete(trackedOf(lore(), 1)!, 1))
        await settle()
        expect(part('studio-lore-sheet')).toBeNull()
        expect(doneCount()).toBe(1)
        expect(lore().map((entry) => [entry.comment, entry.folder])).toEqual([['Row 0', undefined], ['Row 2', undefined], ['G', undefined]])
    })

    test('TDT3: the row menu duplicates the entry it was opened on after an outside delete shifted the rows', async () => {
        await startCharacter([row(0), row(1), row(2)])
        await mountPane()
        await openMenuOf('@1')
        outside(loreDelete(trackedOf(lore(), 0)!, 0))
        await settle()
        await choose('studio-lore-duplicate')
        expect(comments()).toEqual(['Row 1', 'Row 1', 'Row 2'])
        expect(lore().map((entry) => entry.content)).toEqual(['body 1', 'body 1', 'body 2'])
        expect(doneCount()).toBe(2)
        const copyId = lore()[1].id as string
        expect(focusedRowKey()).toBe(`id:${copyId}`)
        expect(focusedPart()).toBe('studio-lore-row-name')
    })

    test('TDT3b: an outside delete of the entry closes the row menu, writes nothing and focuses the list', async () => {
        await startCharacter([row(0), row(1), row(2)])
        await mountPane()
        await openMenuOf('@1')
        expect(document.querySelector('[role="menu"]')).not.toBeNull()
        outside(loreDelete(trackedOf(lore(), 1)!, 1))
        await settle()
        expect(document.querySelector('[role="menu"]')).toBeNull()
        expect(doneCount()).toBe(1)
        expect(comments()).toEqual(['Row 0', 'Row 2'])
        expect(focusedPart()).toBe('studio-lore-list')
    })

    test('an outside splice above the menu`s entry keeps the menu open on that entry (a classic delete)', async () => {
        await startCharacter([row(0), row(1), row(2)])
        await mountPane()
        await openMenuOf('@2')
        outsideRemove(0)
        await settle()
        expect(document.querySelector('[role="menu"]')).not.toBeNull()
        await choose('studio-lore-move-up')
        expect(comments()).toEqual(['Row 2', 'Row 1'])
    })
})

describe('the pane`s own states', () => {
    test('while the list shows, the settings and the list mount, with the empty state for no entries', async () => {
        await startCharacter([])
        await mountPane()
        expect(part('studio-lore-settings')).not.toBeNull()
        expect(part('studio-lore-empty')?.textContent).toBe(language.studioLoreEmpty)
        expect(parts('studio-lore-row')).toHaveLength(0)
    })

    test('a chat without a unique id is read-only with its note and no row control writes', async () => {
        await startCharacter([row(0)], { localLore: [row(5)] })
        ;(DBState.db.characters as unknown as { chats: { id: string }[] }[])[0].chats.push({ id: 'c1' } as never)
        await mountPane({ ownerType: 'chat', ownerId: 'c1' })
        await settle()
        expect(part('studio-lore-readonly')?.textContent).toBe(language.studioHistoryNone)
        expect((part('studio-lore-add') as HTMLButtonElement).disabled).toBe(true)
    })
})

// ---------------------------------------------------------------- 1c: the open entry (Rules P, O, U) and the form-origin surfaces

const loreIds = (ownerId: string, count: number): string[] => Array.from({ length: count }, (_, index) => loreItemIdOf(ownerId, index))
const nameInput = (): HTMLInputElement => field('studio-lore-name')
const alertDialog = (): Element | null => document.querySelector('[role="alertdialog"]')
const stepsOf = (): number => service.view(A).done.length

describe('Rule O and Rule P on the character host', () => {
    test('T30c: an outside insert above an id-less open entry, then a Name edit, writes the tracked entry', async () => {
        await startCharacter([row(0), row(1), row(2)])
        await mountPane()
        await openEntry(2)
        lore().unshift(row(9))
        flushSync()
        await settle()
        expect(studioScreen.selectedItemId).toBe('A/lore:3')
        typeInto(nameInput(), 'Edited')
        await settle()
        expect(comments()).toEqual(['Row 9', 'Row 0', 'Row 1', 'Edited'])
        expect(studioScreen.selectedItemId).toBe('A/lore:3')
    })

    test('T30e: an outside delete of the open entry drops to the list with the notice, and focuses the list', async () => {
        await startCharacter([row(0), row(1), row(2)])
        await mountPane()
        await openEntry(1)
        outsideRemove(1)
        await settle()
        expect(studioScreen.selectedItemId).toBeNull()
        expect(studioScreen.notice).toBe(language.studioLoreEntryGone)
        expect(part('studio-lore-list')).not.toBeNull()
        expect(part('studio-lore-name')).toBeNull()
        expect(focusedPart()).toBe('studio-lore-list')
    })

    test('T30e-b: History undo of the Add that created the open entry drops to the list with the notice', async () => {
        await startCharacter([row(0)])
        await mountPane()
        await click(part('studio-lore-add'))
        expect(comments()).toHaveLength(2)
        expect(studioScreen.selectedItemId).toBe('A/lore:1')
        expect(part('studio-lore-name')).not.toBeNull()
        service.undo(A)
        flushSync()
        await settle()
        expect(comments()).toEqual(['Row 0'])
        expect(studioScreen.selectedItemId).toBeNull()
        expect(studioScreen.notice).toBe(language.studioLoreEntryGone)
        expect(part('studio-lore-list')).not.toBeNull()
    })

    // TO4 pins the two Rule O branches the restore sheet's Confirm reaches: the open entry is gone (list and notice), and the
    // open entry still exists with a restored value (form stays open, no notice).
    async function confirmRestoreSheet(): Promise<void> {
        setStudioHistoryOpen(true)
        setStudioRestoreSheetOpen(true)
        mountInto(StudioRestoreSheet, {})
        await settle()
        await click(part('studio-restore-confirm'))
    }

    test('TO4 (gone branch): the restore sheet Confirm with the form open on an entry added in this visit removes it and drops to the list with the notice', async () => {
        await startCharacter([row(0)])
        await mountPane()
        await click(part('studio-lore-add'))
        expect(comments()).toHaveLength(2)
        expect(part('studio-lore-name')).not.toBeNull()
        await confirmRestoreSheet()
        expect(comments()).toEqual(['Row 0'])
        expect(studioScreen.restoreSheetOpen).toBe(false)
        expect(studioScreen.selectedItemId).toBeNull()
        expect(studioScreen.notice).toBe(language.studioLoreEntryGone)
        expect(part('studio-lore-list')).not.toBeNull()
        expect(part('studio-lore-name')).toBeNull()
    })

    test('TO4 (stays-open branch): the restore sheet Confirm with the form open on an entry only edited in this visit keeps the form with the restored value', async () => {
        await startCharacter([row(0), row(1)])
        await mountPane()
        await openEntry(1)
        typeInto(nameInput(), 'Changed')
        await settle()
        expect(lore()[1].comment).toBe('Changed')
        await confirmRestoreSheet()
        expect(comments()).toEqual(['Row 0', 'Row 1'])
        expect(studioScreen.selectedItemId).toBe('A/lore:1')
        expect(nameInput().value).toBe('Row 1')
        expect(studioScreen.notice).toBeNull()
    })

    test('T30f: a held composition survives an outside insert above, and lands once on the tracked entry', async () => {
        await startCharacter([row(0), row(1)])
        await mountPane()
        await openEntry(1)
        const input = nameInput()
        compose(input, '가')
        expect(studioScreen.listReturn?.rowId).toBe('A/lore:1')
        lore().unshift(row(9))
        flushSync()
        await settle()
        expect(lore()[2].comment).toBe('Row 1')
        expect(doneCount()).toBe(0)
        expect(studioScreen.selectedItemId).toBe('A/lore:2')
        expect(studioScreen.listReturn?.rowId).toBe('A/lore:2')
        expect(nameInput()).toBe(input)
        expect(input.value).toBe('가')
        input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        flushSync()
        await settle()
        expect(doneCount()).toBe(1)
        expect(lore()[2].comment).toBe('가')
        expect(lore()[1].comment).toBe('Row 0')
    })

    test('TO1: a Name edit then History undo keeps the form open on the entry with the old name and no notice', async () => {
        await startCharacter([row(0), row(1)])
        await mountPane()
        await openEntry(1)
        typeInto(nameInput(), 'Changed')
        await settle()
        expect(lore()[1].comment).toBe('Changed')
        service.undo(A)
        flushSync()
        await settle()
        expect(nameInput().value).toBe('Row 1')
        expect(studioScreen.selectedItemId).toBe('A/lore:1')
        expect(studioScreen.notice).toBeNull()
    })

    test('TO2: an outside delete above and its undo move the selection both ways on the same Name input, with no flush', async () => {
        await startCharacter([row(0), row(1), row(2)])
        await mountPane()
        await openEntry(2)
        const input = nameInput()
        let flushes = 0
        const unregister = registerStudioField(() => { flushes += 1 })
        service.objEdit(A, loreDelete(trackedOf(lore(), 0)!, 0).build)
        flushSync()
        await settle()
        expect(studioScreen.selectedItemId).toBe('A/lore:1')
        expect(nameInput()).toBe(input)
        expect(input.value).toBe('Row 2')
        service.undo(A)
        flushSync()
        await settle()
        expect(studioScreen.selectedItemId).toBe('A/lore:2')
        expect(nameInput()).toBe(input)
        expect(input.value).toBe('Row 2')
        expect(flushes).toBe(0)
        unregister()
    })

    test('TO3: a classic in-place field edit shows in the form with no step and no remount', async () => {
        await startCharacter([row(0), row(1)])
        await mountPane()
        await openEntry(1)
        const input = nameInput()
        lore()[1].comment = 'x'
        flushSync()
        await settle()
        expect(nameInput()).toBe(input)
        expect(input.value).toBe('x')
        expect(doneCount()).toBe(0)
    })

    test('TO5: a selection naming the open item keeps the form and flushes held text once; another item opens a new form', async () => {
        await startCharacter([row(0), row(1)])
        await mountPane()
        await openEntry(0)
        const input = nameInput()
        compose(input, '가')
        setStudioSelection(STUDIO_KEY, 'lore', loreItemIdOf('A', 0))
        await settle()
        expect(nameInput()).toBe(input)
        expect(lore()[0].comment).toBe('가')
        expect(doneCount()).toBe(1)
        setStudioSelection(STUDIO_KEY, 'lore', loreItemIdOf('A', 1))
        await settle()
        expect(nameInput()).not.toBe(input)
        expect(nameInput().value).toBe('Row 1')
    })

    test('TU23: a held write flushed after the selection moved writes nothing, on either entry', async () => {
        await startCharacter([row(0), row(1)])
        await mountPane()
        await openEntry(0)
        compose(nameInput(), '가')
        studioScreen.selectedItemId = loreItemIdOf('A', 1)
        flushSync()
        await settle()
        expect(comments()).toEqual(['Row 0', 'Row 1'])
        expect(doneCount()).toBe(0)
        expect(nameInput().value).toBe('Row 1')
    })

    test('TU23 (b): the same on the folder form', async () => {
        await startCharacter([folderRow('F', 'F1'), folderRow('G', 'G1')])
        await mountPane()
        await openEntry(0)
        compose(field('studio-lore-folder-name'), '가')
        studioScreen.selectedItemId = loreItemIdOf('A', 1)
        flushSync()
        await settle()
        expect(comments()).toEqual(['F1', 'G1'])
        expect(doneCount()).toBe(0)
        expect(field('studio-lore-folder-name').value).toBe('G1')
    })
})

describe('T30g: a form-mode move keeps the form on the entry, on every host', () => {
    interface Host {
        ownerType: 'character' | 'chat' | 'module'
        ownerId: string
        ownerKey: string
        rows: () => Row[]
        service: () => typeof service
    }

    async function hostOf(kind: Host['ownerType']): Promise<Host> {
        const sample = [row(0), row(1), folderRow('G', 'Group')]
        if (kind === 'character') {
            await startCharacter(sample)
            await mountPane()
            return { ownerType: kind, ownerId: 'A', ownerKey: ownerKeyOf('character', 'A'), rows: lore, service: () => service }
        }
        if (kind === 'chat') {
            await startCharacter([], { localLore: sample })
            await mountPane({ ownerType: 'chat', ownerId: 'c1' })
            await service.whenReady(chatOwnerKey('A', 'c1'))
            return { ownerType: kind, ownerId: 'c1', ownerKey: ownerKeyOf('chat', 'c1'), rows: () => (DBState.db.characters as unknown as { chats: { localLore: Row[] }[] }[])[0].chats[0].localLore, service: () => service }
        }
        // The form's content field reads the module list through the parser, so the module code is loaded before the pane mounts.
        await import('../../ts/process/modules')
        await import('../../ts/process/moduleLorebookRepair')
        const rig = makeModuleRig()
        DBState.db = {
            characters: [{ chaId: 'A', type: 'character', chats: [{ id: 'c1', note: '', fmIndex: -1, localLore: [] }], chatPage: 0, globalLore: [] }],
            modules: [residentModule('m1', { lorebook: sample as never })],
        } as unknown as typeof DBState.db
        publishOpenModuleId('m1')
        await mountPane({ ownerType: 'module', ownerId: 'm1', moduleId: 'm1', moduleSlotIndex: 0 })
        await rig.service.whenReady(moduleOwnerKey('m1'))
        flushSync()
        await settle()
        return { ownerType: kind, ownerId: 'm1', ownerKey: ownerKeyOf('module', 'm1'), rows: () => (DBState.db.modules as unknown as { lorebook: Row[] }[])[0].lorebook, service: () => rig.service }
    }

    for (const kind of ['character', 'chat', 'module'] as const) {
        test(`${kind} host: the Folder select moves an id-less entry, the selection follows before any await, and a Name edit lands on it`, async () => {
            const host = await hostOf(kind)
            openStudioListRow({ ownerKey: host.ownerKey, kind: 'lore' }, host.ownerKey, loreItemIdOf(host.ownerId, 0))
            await settle()
            const input = nameInput()
            const select = field<HTMLSelectElement>('studio-lore-folder-select')
            select.value = 'G'
            select.dispatchEvent(new Event('change', { bubbles: true }))
            const moved = loreItemIdOf(host.ownerId, 2)
            expect(studioScreen.selectedItemId).toBe(moved)
            expect(studioScreen.listReturn?.rowId).toBe(moved)
            await settle()
            expect(host.service().view(kind === 'module' ? moduleOwnerKey('m1') : kind === 'chat' ? chatOwnerKey('A', 'c1') : A).done).toHaveLength(1)
            expect(nameInput()).toBe(input)
            expect(studioScreen.notice).toBeNull()
            expect(studioScreen.selectedItemId).toBe(moved)
            typeInto(nameInput(), 'After')
            await settle()
            expect(host.rows()[2].comment).toBe('After')
            expect(host.rows()[2].folder).toBe('G')
        })
    }

    test('T30d: on a module host two edits of an id-less entry both land on it (Name, then Always active and Name)', async () => {
        const host = await hostOf('module')
        openStudioListRow({ ownerKey: host.ownerKey, kind: 'lore' }, host.ownerKey, loreItemIdOf('m1', 1))
        await settle()
        typeInto(nameInput(), 'One')
        await settle()
        typeInto(field('studio-lore-order'), '7')
        await settle()
        expect(host.rows()[1].comment).toBe('One')
        expect(host.rows()[1].insertorder).toBe(7)
        expect(host.rows()[0].comment).toBe('Row 0')
        const toggle = field('studio-lore-always-active')
        await click(toggle)
        typeInto(nameInput(), 'Two')
        await settle()
        expect(host.rows()[1].alwaysActive).toBe(true)
        expect(host.rows()[1].comment).toBe('Two')
        expect(host.rows()[0].alwaysActive).not.toBe(true)
    })
})

describe('TF2 / TFold: delete and new folder from the forms', () => {
    test('TF2: Delete from the entry form drops to the list and focuses the neighbouring row', async () => {
        await startCharacter([row(0), row(1), row(2)])
        await mountPane()
        await openEntry(1)
        await click(part('studio-lore-form-delete'))
        expect(comments()).toEqual(['Row 0', 'Row 2'])
        expect(studioScreen.selectedItemId).toBeNull()
        expect(part('studio-lore-list')).not.toBeNull()
        expect(focusedRowKey()).toBe('@1')
    })

    test('TF2: Delete from the folder form asks through the confirm, and its Delete drops to the list on the neighbour', async () => {
        await startCharacter([row(0), folderRow('K', 'Full'), { ...row(1), folder: 'K' }, row(2)])
        await mountPane()
        await openEntry(1)
        await click(part('studio-lore-folder-delete'))
        expect(part('studio-lore-confirm-text')?.textContent).toBe(language.studioLoreFolderDeleteConfirm('Full', 1, 0))
        await choose('studio-lore-confirm-delete')
        expect(comments()).toEqual(['Row 0', 'Row 2'])
        expect(studioScreen.selectedItemId).toBeNull()
        expect(part('studio-lore-list')).not.toBeNull()
        expect(focusedRowKey()).toBe('@1')
    })

    test('TF2: Delete from the linked-entry view of a chat entry drops to the list', async () => {
        await startCharacter([{ ...row(0), id: 'L1' }], { localLore: [{ ...row(1), id: 'L1', mode: 'child' }, row(2)] })
        await mountPane({ ownerType: 'chat', ownerId: 'c1' })
        await service.whenReady(chatOwnerKey('A', 'c1'))
        const okey = ownerKeyOf('chat', 'c1')
        openStudioListRow({ ownerKey: okey, kind: 'lore' }, okey, loreItemIdOf('c1', 0))
        await settle()
        expect(part('studio-lore-linked')).not.toBeNull()
        await click(part('studio-lore-form-delete'))
        expect(studioScreen.selectedItemId).toBeNull()
        expect(part('studio-lore-list')).not.toBeNull()
        expect((DBState.db.characters as unknown as { chats: { localLore: Row[] }[] }[])[0].chats[0].localLore).toHaveLength(1)
    })

    test('TFold: + Folder opens the folder form, with the name focused and empty; typing a name titles the form', async () => {
        await startCharacter([row(0)])
        await mountPane()
        await click(part('studio-lore-add-folder'))
        expect(part('studio-lore-folder-form')).not.toBeNull()
        expect(focusedPart()).toBe('studio-lore-folder-name')
        expect(field('studio-lore-folder-name').value).toBe('')
        expect(part('studio-lore-form-title')?.textContent).toBe(language.sidebarUi.unnamedFolder)
        typeInto(field('studio-lore-folder-name'), 'Places')
        await settle()
        expect(part('studio-lore-form-title')?.textContent).toBe('Places')
        expect(lore()[1].comment).toBe('Places')
    })
})

describe('TDT4 / TDT5 / TDT6: a deferred surface closes with its view', () => {
    test('TDT4: the folder form`s confirm closes, writing nothing, when the tree opens another folder', async () => {
        await startCharacter([folderRow('K1', 'New Folder'), folderRow('K2', 'New Folder'), { ...row(0), folder: 'K1' }, { ...row(1), folder: 'K2' }])
        await mountPane()
        await openEntry(0)
        await click(part('studio-lore-folder-delete'))
        expect(alertDialog()).not.toBeNull()
        expect(focusedPart()).toBe('studio-lore-confirm-cancel')
        const before = JSON.stringify(lore())
        setStudioSelection(STUDIO_KEY, 'lore', loreItemIdOf('A', 1))
        await settle()
        expect(alertDialog()).toBeNull()
        expect(part('studio-lore-folder-form')).not.toBeNull()
        expect(doneCount()).toBe(0)
        expect(JSON.stringify(lore())).toBe(before)
    })

    test('TDT4b: the same with an entry opened: no dialog, no notice, no step', async () => {
        await startCharacter([folderRow('K1', 'New Folder'), row(0), { ...row(1), folder: 'K1' }])
        await mountPane()
        await openEntry(0)
        await click(part('studio-lore-folder-delete'))
        expect(alertDialog()).not.toBeNull()
        const before = JSON.stringify(lore())
        setStudioSelection(STUDIO_KEY, 'lore', loreItemIdOf('A', 1))
        await settle()
        expect(alertDialog()).toBeNull()
        expect(studioScreen.notice).toBeNull()
        expect(doneCount()).toBe(0)
        expect(JSON.stringify(lore())).toBe(before)
        expect(nameInput().value).toBe('Row 0')
    })

    test('TDT4 (E-8): a closing form-origin confirm leaves focus alone when the user moved it elsewhere', async () => {
        await startCharacter([folderRow('K1', 'F'), folderRow('K2', 'G'), { ...row(0), folder: 'K1' }])
        const elsewhere = document.createElement('input')
        document.body.append(elsewhere)
        await mountPane()
        await openEntry(0)
        await click(part('studio-lore-folder-delete'))
        elsewhere.focus()
        setStudioSelection(STUDIO_KEY, 'lore', loreItemIdOf('A', 1))
        await settle()
        expect(alertDialog()).toBeNull()
        expect(document.activeElement).toBe(elsewhere)
        elsewhere.remove()
    })

    test('E-8: Cancel of a form-origin confirm returns focus to the form`s Delete, unless the user moved it elsewhere', async () => {
        await startCharacter([folderRow('K1', 'F'), { ...row(0), folder: 'K1' }])
        const elsewhere = document.createElement('input')
        document.body.append(elsewhere)
        await mountPane()
        await openEntry(0)
        await click(part('studio-lore-folder-delete'))
        await choose('studio-lore-confirm-cancel')
        expect(alertDialog()).toBeNull()
        expect(focusedPart()).toBe('studio-lore-folder-delete')
        await click(part('studio-lore-folder-delete'))
        elsewhere.focus()
        await choose('studio-lore-confirm-cancel')
        expect(alertDialog()).toBeNull()
        expect(document.activeElement).toBe(elsewhere)
        expect(doneCount()).toBe(0)
        elsewhere.remove()
    })

    test('a form-origin confirm closed by an outside delete of its folder refocuses the form`s Delete only when focus was inside', async () => {
        await startCharacter([row(0), folderRow('K1', 'F'), { ...row(1), folder: 'K1' }])
        await mountPane()
        await openEntry(1)
        await click(part('studio-lore-folder-delete'))
        service.objEdit(A, loreDeleteFolder(trackedOf(lore(), 1)!, 1).build)
        flushSync()
        await settle()
        expect(alertDialog()).toBeNull()
        expect(studioScreen.selectedItemId).toBeNull()
        expect(studioScreen.notice).toBe(language.studioLoreEntryGone)
    })

    test('TDT5: a list-origin confirm ends when an item opens, and does not return with the list', async () => {
        await startCharacter([folderRow('K1', 'F'), { ...row(0), folder: 'K1' }, row(1)])
        await mountPane()
        await openMenuOf('f:K1')
        await choose('studio-lore-delete')
        expect(alertDialog()).not.toBeNull()
        setStudioSelection(STUDIO_KEY, 'lore', loreItemIdOf('A', 2))
        await settle()
        expect(alertDialog()).toBeNull()
        expect(nameInput().value).toBe('Row 1')
        setStudioSelection(STUDIO_KEY, 'lore', null)
        await settle()
        expect(part('studio-lore-list')).not.toBeNull()
        expect(alertDialog()).toBeNull()
        expect(doneCount()).toBe(0)
        expect(comments()).toEqual(['F', 'Row 0', 'Row 1'])
    })

    const surfaces: [string, () => Promise<void>][] = [
        ['(a) the row menu', async () => { await openMenuOf('@1') }],
        ['(b) the move sheet', async () => { await openMenuOf('@1'); await choose('studio-lore-move-to-folder') }],
        ['(c) the bulk menu', async () => { await click(part('studio-lore-bulk-menu')) }],
    ]
    for (const [label, openSurface] of surfaces) {
        test(`TDT6: ${label} ends with the list`, async () => {
            await startCharacter([row(0), row(1), folderRow('G', 'Group')], { bulk: true })
            await mountPane()
            await openSurface()
            expect(document.querySelector('[role="menu"], [data-part="studio-lore-sheet"]')).not.toBeNull()
            setStudioSelection(STUDIO_KEY, 'lore', loreItemIdOf('A', 0))
            await settle()
            setStudioSelection(STUDIO_KEY, 'lore', null)
            await settle()
            expect(part('studio-lore-list')).not.toBeNull()
            expect(document.querySelector('[role="menu"]')).toBeNull()
            expect(part('studio-lore-sheet')).toBeNull()
            expect(doneCount()).toBe(0)
        })
    }
})

describe('THB: Back after a follow or a re-key reveals and focuses the entry`s row', () => {
    const chatReady = (): Promise<void> => service.whenReady(chatOwnerKey('A', 'c1'))
    const focusedName = (): string => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? ''

    beforeEach(() => { studioScreen.layout = 'stack' })

    test('THB: an outside splice above, then Back, focuses the entry`s name button in the shifted row', async () => {
        await startCharacter([row(0), row(1), row(2)])
        await mountPane()
        await click(inRow('@1', 'studio-lore-row-name'))
        outsideRemove(0)
        await settle()
        studioDetailBack()
        await settle()
        expect(part('studio-lore-list')).not.toBeNull()
        expect(studioScreen.revealListRow).toBeNull()
        expect(focusedPart()).toBe('studio-lore-row-name')
        expect(focusedRowKey()).toBe('@0')
        expect(focusedName()).toBe('Row 1')
    })

    test('THB-k1: Give new ID, then Back, focuses the row now keyed by the fresh id', async () => {
        await startCharacter([{ ...row(0), id: 'X' }, { ...row(1), id: 'X' }])
        await mountPane()
        await click(inRow('@0', 'studio-lore-row-name'))
        await click(part('studio-lore-new-id'))
        const fresh = lore()[0].id as string
        expect(fresh).not.toBe('X')
        expect(studioScreen.selectedItemId).toBe('A/lore:0')
        studioDetailBack()
        await settle()
        expect(focusedRowKey()).toBe(`id:${fresh}`)
        expect(focusedName()).toBe('Row 0')
    })

    async function activateThenBack(localLore: unknown): Promise<void> {
        await startCharacter([row(0), row(1)], { localLore })
        ;(DBState.db as unknown as { localActivationInGlobalLorebook: boolean }).localActivationInGlobalLorebook = true
        await mountPane()
        await chatReady()
        await click(inRow('@0', 'studio-lore-row-name'))
        await settle()
        await click(field('studio-lore-local-active'))
        const id =lore()[0].id as string
        expect(id).toBeTruthy()
        studioDetailBack()
        await settle()
        expect(focusedRowKey()).toBe(`id:${id}`)
        expect(focusedName()).toBe('Row 0')
    }

    test('THB-k2: Always active in this chat on, then Back, focuses the row keyed by the new id', async () => {
        await activateThenBack([])
    })

    test('THB-k3: the same when the chat step refuses', async () => {
        await activateThenBack({ notAList: true })
    })

    test('THB-o1: an outside New ID of the other sharer, then its undo, re-keys the open entry and Back finds its row', async () => {
        await startCharacter([{ ...row(0), id: 'X' }, { ...row(1), id: 'X' }])
        await mountPane()
        service.objEdit(A, loreNewId(trackedOf(lore(), 1)!, 1).build)
        flushSync()
        await click(inRow('id:X', 'studio-lore-row-name'))
        service.undo(A)
        flushSync()
        await settle()
        expect(studioScreen.selectedItemId).toBe('A/lore:0')
        expect(studioScreen.notice).toBeNull()
        studioDetailBack()
        await settle()
        expect(focusedRowKey()).toBe('@0')
        expect(focusedName()).toBe('Row 0')
    })

    test('THB-o2: an outside delete of the other sharer, then its undo, re-keys the open entry and Back finds its row', async () => {
        await startCharacter([{ ...row(0), id: 'X' }, { ...row(1), id: 'X' }])
        await mountPane()
        service.objEdit(A, loreDelete(trackedOf(lore(), 1)!, 1).build)
        flushSync()
        await click(inRow('id:X', 'studio-lore-row-name'))
        service.undo(A)
        flushSync()
        await settle()
        studioDetailBack()
        await settle()
        expect(focusedRowKey()).toBe('@0')
        expect(focusedName()).toBe('Row 0')
    })

    test('THB-o3: a classic splice of the other sharer re-keys the open entry to its id and Back finds its row', async () => {
        await startCharacter([{ ...row(0), id: 'X' }, { ...row(1), id: 'X' }])
        await mountPane()
        await click(inRow('@0', 'studio-lore-row-name'))
        outsideRemove(1)
        await settle()
        studioDetailBack()
        await settle()
        expect(focusedRowKey()).toBe('id:X')
        expect(focusedName()).toBe('Row 0')
    })

    test('THB-t: a tester-origin open keeps its return row through a move, and the selection follows', async () => {
        await startCharacter([row(0), row(1), folderRow('G', 'Group')])
        await mountPane()
        openStudioListRow({ ownerKey: STUDIO_KEY, kind: 'lore' }, STUDIO_KEY, loreItemIdOf('A', 0), 'lt:2')
        await settle()
        const select = field<HTMLSelectElement>('studio-lore-folder-select')
        select.value = 'G'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        await settle()
        expect(studioScreen.listReturn?.rowId).toBe('lt:2')
        expect(studioScreen.selectedItemId).toBe('A/lore:2')
    })
})

describe('THB-m: Back to the merged list finds the entry at its new index', () => {
    test('the Folder select moves E, Back through the merged list origin focuses E`s row, not the row now at the old index', async () => {
        studioScreen.layout = 'stack'
        await startCharacter([row(0), row(1), folderRow('G', 'Group')])
        await mountPane()
        const combined = combinedKeyOf('lore')
        openStudioListRow({ ownerKey: combined, kind: 'lore' }, STUDIO_KEY, loreItemIdOf('A', 0))
        await settle()
        const select = field<HTMLSelectElement>('studio-lore-folder-select')
        select.value = 'G'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        await settle()
        expect(studioScreen.listReturn?.rowId).toBe('A/lore:2')
        // StudioDetail drops the pane branch for the merged key in the same flush as Back, so the pane`s own list never takes the reveal.
        studioDetailBack()
        await unmountLast()
        const model = buildOwnerModel(makeInput({ character: DBState.db.characters[0] as never }))
        mountInto(StudioCombined, { model, kind: 'lore' })
        await settle()
        const active = document.activeElement as HTMLElement | null
        expect(active?.dataset.part).toBe('studio-combined-row')
        expect(active?.dataset.itemId).toBe('A/lore:2')
        expect(active?.textContent).toContain('Row 0')
    })
})
