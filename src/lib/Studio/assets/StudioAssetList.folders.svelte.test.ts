// @vitest-environment jsdom
/**
 * The folders of the Studio asset list over the real history service on the memory doubles: the groups and their
 * order, folding, moving rows, the refusals, deleting a folder with its Undo toast, the line a rename leaves when the
 * row joins a folder, and where an import lands. Feature guards: none of this exists at the stage's base.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    getFileSrc: async (path: string, use: string) => `blob:${use}:${path}`,
}))

const db = $state({ db: { characters: [] as LiveCharacter[], useAdditionalAssetsPreview: false, modules: [] as unknown[] } })
const selection = $state({ selId: 0 })

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        get DBState() { return db },
        get selIdState() { return selection },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        frozenSaveKeysStore: writable([]),
        clearCharEmotionCache: () => {},
    }
})
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const call = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const table: Record<string, unknown> = { sidebarUi: { noAssets: 'noAssets' }, uiCommon: { close: 'close' } }
    for (const key of [
        'studioAssetEmotionsElsewhere', 'studioAssetRowMenu', 'studioAssetDeletedOne', 'studioAssetFileGone', 'studioAssetFileUnchecked',
        'studioAssetFilterEmpty', 'studioAssetMovesSameName', 'studioAssetFolderDeletedToast', 'studioAssetRenameJoins', 'studioAssetImportJoins',
        'studioAssetSelectedCount', 'studioAssetDeletedMany', 'studioAssetStillUsed', 'studioAssetModuleNowShows', 'studioStepAssetMove',
    ]) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { AssetSizeJob, StoredSize } from 'src/ts/studio/assets/assetSizes'
import { resetStudioToastsForTests, retireAssetToasts } from 'src/ts/studio/edit/studioToasts'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createToastHost, resetToastHostForTests, type ToastClock, type ToastHost } from 'src/ts/toast/toastHost.svelte'
import { ASSET_FOLDER_KEY } from '../../../ts/studio/assets/assetOwnerKeys'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../../ts/studio/history/tests/studioStoreDoubles'
import { assetRow } from '../../../ts/studio/assets/assetFixtures.test-helpers'
import StudioAssetList, { setSessionAssetSizeJobForTests, type ImportLanding } from './StudioAssetList.svelte'

// No size is ever read: the production size job is not loaded.
const noSizes: AssetSizeJob = { peek: () => undefined, snapshot: () => new Map<string, StoredSize>(), ensure: async () => true }

interface LiveCharacter {
    chaId: string
    type: string
    desc: string
    alternateGreetings: string[]
    chats: { id: string; note: string; fmIndex?: number }[]
    chatPage: number
    additionalAssets: string[][]
    emotionImages: string[][]
    extentions: Record<string, unknown>
}

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

// The stored shape the codec writes: `{ v: 1, additional: { order, of } }` with `[name, folder]` pairs.
function folderDoc(order: string[], of: [string, string][]): unknown {
    return { v: 1, additional: { order, of } }
}

function makeCharacter(additionalAssets: string[][], folders?: unknown): LiveCharacter {
    return {
        chaId: 'A',
        type: 'character',
        desc: 'd0',
        alternateGreetings: [],
        chats: [{ id: 'c1', note: '' }],
        chatPage: 0,
        additionalAssets,
        emotionImages: [],
        extentions: folders === undefined ? {} : { [ASSET_FOLDER_KEY]: folders },
    }
}

const baseRows = () => [
    assetRow('smile', 'assets/smile.png'), assetRow('grin', 'assets/grin.png'), assetRow('frown', 'assets/frown.png'),
    assetRow('hat', 'assets/hat.png'), assetRow('a/b', 'assets/ab.png'),
]
const baseFolders = () => folderDoc(['Poses', 'Props'], [['smile', 'Poses'], ['grin', 'Poses'], ['hat', 'Props']])

function fakeToastClock(): ToastClock {
    return { now: () => 0, after: () => () => {} }
}

let service: OwnerHistoryService
let toastHost: ToastHost
let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
    await drainMicrotasks()
}

async function show(props: Record<string, unknown> = {}): Promise<void> {
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push({ app: mount(StudioAssetList, { target: host, props: { chaId: 'A', host: toastHost, ...props } }), host })
    flushSync()
    await settle()
}

// What the person sees: a hidden row or folder stays in the page, so an element that is itself hidden, or inside a hidden one, is left out.
const parts = (name: string, from: ParentNode = document) => Array.from(from.querySelectorAll<HTMLElement>(`[data-part="${name}"]`)).filter((element) => element.closest('[hidden]') === null)
const part = (name: string, from: ParentNode = document) => parts(name, from)[0]
const rowOf = (name: string): HTMLElement => parts('studio-asset-row').find((row) => (row.querySelector('[data-part="studio-asset-name"]') as HTMLInputElement).value === name) as HTMLElement
const folderOfSection = (folder: string | null): HTMLElement => parts('studio-asset-folder').find((section) => (folder === null ? section.dataset.none === 'true' : section.dataset.folder === folder)) as HTMLElement
const namesIn = (section: HTMLElement) => parts('studio-asset-name', section).map((field) => (field as HTMLInputElement).value)
const stored = () => db.db.characters[0].extentions[ASSET_FOLDER_KEY] as { additional: { order: string[]; of: [string, string][] } } | undefined
const entriesOf = () => Object.fromEntries(stored()?.additional.of ?? [])

async function click(element: HTMLElement): Promise<void> {
    element.click()
    await settle()
}

async function openMenu(name: string): Promise<void> {
    await click(rowOf(name).querySelector('[data-part="studio-asset-row-more"]') as HTMLElement)
}

async function moveRowTo(name: string, folder: string | null): Promise<void> {
    await openMenu(name)
    await click(rowOf(name).querySelector('[data-part="studio-asset-menu-move"]') as HTMLElement)
    await click(parts('studio-asset-move-choice', rowOf(name)).find((choice) => choice.dataset.folder === (folder ?? '')) as HTMLElement)
}

async function type(field: HTMLInputElement, value: string, key = 'Enter'): Promise<void> {
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    await settle()
}

beforeEach(async () => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    setSessionAssetSizeJobForTests(noSizes)
    db.db.useAdditionalAssetsPreview = false
    db.db.characters = [makeCharacter(baseRows(), baseFolders())]
    selection.selId = 0
    studioScreen.chaId = 'A'
    toastHost = createToastHost({ clock: fakeToastClock() })
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
        onLanded: retireAssetToasts,
    })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests({ noteEdit: () => {}, dispose: () => {} } as never)
    await service.whenReady(A)
})

afterEach(async () => {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
    vi.restoreAllMocks()
    setSessionAssetSizeJobForTests(undefined)
    resetStudioToastsForTests()
    resetToastHostForTests()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('the folder groups', () => {
    test('show the listed folders in stored order and "No folder" last, each header collapsing its rows', async () => {
        await show()
        expect(parts('studio-asset-folder').map((section) => section.dataset.folder ?? 'none')).toEqual(['Poses', 'Props', 'none'])
        expect(namesIn(folderOfSection('Poses'))).toEqual(['smile', 'grin'])
        expect(namesIn(folderOfSection('Props'))).toEqual(['hat'])
        expect(namesIn(folderOfSection(null))).toEqual(['frown', 'a/b'])
        const header = part('studio-asset-folder-header', folderOfSection('Poses'))
        expect(header.getAttribute('aria-expanded')).toBe('true')
        await click(header)
        expect(header.getAttribute('aria-expanded')).toBe('false')
        expect(namesIn(folderOfSection('Poses'))).toEqual([])
        await click(header)
        expect(namesIn(folderOfSection('Poses'))).toEqual(['smile', 'grin'])
    })

    test('follow the stored order of the list, not the alphabet, and offer no control to reorder them', async () => {
        db.db.characters = [makeCharacter(baseRows(), folderDoc(['Zed', 'Alpha'], [['smile', 'Zed'], ['hat', 'Alpha']]))]
        await show()
        expect(parts('studio-asset-folder').map((section) => section.dataset.folder ?? 'none')).toEqual(['Zed', 'Alpha', 'none'])
        // The only folder controls are the header's toggle, rename and delete, and the toolbar's New folder.
        const folderParts = new Set(parts('studio-asset-list').flatMap((list) => Array.from(list.querySelectorAll<HTMLElement>('button')).map((button) => button.dataset.part ?? '')).filter((name) => name.includes('folder')))
        expect([...folderParts].sort()).toEqual(['studio-asset-folder-delete', 'studio-asset-folder-header', 'studio-asset-folder-rename', 'studio-asset-new-folder'])
    })

    test('a name with a slash is a plain name: no folder is made of it and the row is in "No folder"', async () => {
        await show()
        expect(namesIn(folderOfSection(null))).toContain('a/b')
        expect(parts('studio-asset-folder-header').map((header) => header.textContent)).not.toContain('a')
        expect(stored()?.additional.order).toEqual(['Poses', 'Props'])
    })

    test('with no folder listed the list is flat, as before folders', async () => {
        db.db.characters = [makeCharacter(baseRows())]
        await show()
        expect(parts('studio-asset-folder-header')).toHaveLength(0)
        expect(parts('studio-asset-rows')).toHaveLength(1)
        expect(parts('studio-asset-row')).toHaveLength(5)
    })

    test('a folder list from a newer version is named, never written, and shows the list flat', async () => {
        const newer = { v: 2, additional: { order: ['Poses'], of: [['smile', 'Poses']] } }
        db.db.characters = [makeCharacter(baseRows(), newer)]
        await show()
        expect(part('studio-asset-folders-newer').textContent).toBe('studioAssetFoldersNewer')
        expect(parts('studio-asset-folder-header')).toHaveLength(0)
        expect(parts('studio-asset-row')).toHaveLength(5)
        expect(stored()).toEqual(newer)
    })
})

describe('moving rows to a folder', () => {
    test('is one step with a toast, and the row shows in the new folder', async () => {
        await show()
        await moveRowTo('frown', 'Props')
        expect(entriesOf()).toEqual({ smile: 'Poses', grin: 'Poses', hat: 'Props', frown: 'Props' })
        expect(namesIn(folderOfSection('Props'))).toEqual(['frown', 'hat'])
        expect(service.view(A).done.map((step) => step.label)).toEqual([{ kind: 'assetMove', count: 1, folder: 'Props' }])
        expect(toastHost.visible.map((toast) => toast.text)).toEqual(['studioStepAssetMove(1,Props)'])
        expect(parts('studio-asset-refusal')).toHaveLength(0)
    })

    test('to "No folder" leaves the name with no entry', async () => {
        await show()
        await moveRowTo('hat', null)
        expect(entriesOf()).toEqual({ smile: 'Poses', grin: 'Poses' })
        expect(namesIn(folderOfSection(null))).toEqual(['frown', 'hat', 'a/b'])
    })

    test('says it moves every row of a name when rows share one, and moves them all', async () => {
        db.db.characters = [makeCharacter([...baseRows(), assetRow('Smile', 'assets/smile2.png')], baseFolders())]
        await show()
        await openMenu('smile')
        await click(rowOf('smile').querySelector('[data-part="studio-asset-menu-move"]') as HTMLElement)
        expect(part('studio-asset-move-note', rowOf('smile')).textContent).toBe('studioAssetMovesSameName(2,smile)')
        await click(parts('studio-asset-move-choice', rowOf('smile')).find((choice) => choice.dataset.folder === 'Props') as HTMLElement)
        expect(namesIn(folderOfSection('Props'))).toEqual(['smile', 'hat', 'Smile'])
        expect(toastHost.visible.map((toast) => toast.text)).toEqual(['studioStepAssetMove(2,Props)'])
    })

    test('a row with a name of its own says nothing about other rows', async () => {
        await show()
        await openMenu('frown')
        await click(rowOf('frown').querySelector('[data-part="studio-asset-menu-move"]') as HTMLElement)
        expect(parts('studio-asset-move-note', rowOf('frown'))).toHaveLength(0)
    })

    test('into the folder the row is already in lands nothing, posts no toast and keeps focus on the row', async () => {
        await show()
        await moveRowTo('smile', 'Poses')
        expect(service.view(A).done).toHaveLength(0)
        expect(toastHost.visible).toHaveLength(0)
        expect(parts('studio-asset-refusal')).toHaveLength(0)
        expect(document.activeElement).toBe(rowOf('smile').querySelector('[data-part="studio-asset-row-more"]'))
    })

    // The row stays in the page, hidden, inside the folded folder: its menu button is not a place focus may go to.
    test('into a folded folder takes the row off the screen and focuses the list, never the hidden row or the page', async () => {
        await show()
        await click(part('studio-asset-folder-header', folderOfSection('Props')))
        await moveRowTo('frown', 'Props')
        expect(parts('studio-asset-row')).toHaveLength(3)
        expect(document.activeElement).toBe(part('studio-asset-list'))
        expect(document.activeElement).not.toBe(document.body)
    })
})

describe('the folder actions', () => {
    test('a new folder is listed, empty, at the end of the stored order', async () => {
        await show()
        await click(part('studio-asset-new-folder'))
        await type(part('studio-asset-new-folder-name') as HTMLInputElement, '  Scenes  ')
        expect(stored()?.additional.order).toEqual(['Poses', 'Props', 'Scenes'])
        expect(parts('studio-asset-folder').map((section) => section.dataset.folder ?? 'none')).toEqual(['Poses', 'Props', 'Scenes', 'none'])
        expect(part('studio-asset-new-folder-name')).toBeUndefined()
    })

    test.each([
        ['an empty name', '   ', 'studioAssetFolderNameEmpty'],
        ['the name "No folder", in any case', 'NO folder', 'studioAssetFolderNameReserved'],
        ['a name a folder has, ignoring case', 'poses', 'studioAssetFolderExists'],
    ])('refuses a new folder named with %s with its own line and writes nothing', async (_label, name, line) => {
        await show()
        const before = JSON.stringify(stored())
        await click(part('studio-asset-new-folder'))
        await type(part('studio-asset-new-folder-name') as HTMLInputElement, name)
        expect(part('studio-asset-refusal').textContent).toBe(line)
        expect(JSON.stringify(stored())).toBe(before)
        expect(service.view(A).done).toHaveLength(0)
    })

    test('renaming a folder keeps its rows in it and refuses a name another folder has', async () => {
        await show()
        await click(part('studio-asset-folder-rename', folderOfSection('Poses')))
        await type(part('studio-asset-folder-name') as HTMLInputElement, 'props')
        expect(part('studio-asset-refusal').textContent).toBe('studioAssetFolderExists')
        expect(stored()?.additional.order).toEqual(['Poses', 'Props'])
        await type(part('studio-asset-folder-name') as HTMLInputElement, 'Stances')
        expect(stored()?.additional.order).toEqual(['Stances', 'Props'])
        expect(namesIn(folderOfSection('Stances'))).toEqual(['smile', 'grin'])
        expect(parts('studio-asset-refusal')).toHaveLength(0)
    })

    test('a refusal the list cannot name falls back to the precondition line', async () => {
        await show()
        vi.spyOn(service, 'assetFolder').mockReturnValue({ ok: false, reason: 'precondition', folderRefusal: 'unknownFolder' })
        await click(part('studio-asset-folder-delete', folderOfSection('Poses')))
        expect(part('studio-asset-refusal').textContent).toBe('studioRefusalPrecondition')
    })

    test('a newer-version list refuses a move and a new folder with the newer-version line, and a row delete still lands', async () => {
        const newer = { v: 2, additional: { order: [], of: [] } }
        db.db.characters = [makeCharacter(baseRows(), newer)]
        await show()
        await openMenu('frown')
        await click(rowOf('frown').querySelector('[data-part="studio-asset-menu-move"]') as HTMLElement)
        await click(parts('studio-asset-move-choice', rowOf('frown'))[0])
        expect(part('studio-asset-refusal').textContent).toBe('studioAssetFoldersNewer')
        await click(part('studio-asset-new-folder'))
        await type(part('studio-asset-new-folder-name') as HTMLInputElement, 'Scenes')
        expect(part('studio-asset-refusal').textContent).toBe('studioAssetFoldersNewer')
        expect(stored()).toEqual(newer)
        await openMenu('frown')
        await click(rowOf('frown').querySelector('[data-part="studio-asset-menu-delete"]') as HTMLElement)
        expect(db.db.characters[0].additionalAssets.map((row) => row[0])).toEqual(['smile', 'grin', 'hat', 'a/b'])
        expect(stored()).toEqual(newer)
    })

    test('deleting a folder moves its rows to "No folder" with a toast, never deletes a row, and Undo puts it all back', async () => {
        await show()
        await click(part('studio-asset-folder-delete', folderOfSection('Poses')))
        expect(stored()?.additional.order).toEqual(['Props'])
        expect(entriesOf()).toEqual({ hat: 'Props' })
        expect(db.db.characters[0].additionalAssets).toHaveLength(5)
        expect(namesIn(folderOfSection(null))).toEqual(['smile', 'grin', 'frown', 'a/b'])
        expect(toastHost.visible.map((toast) => toast.text)).toEqual(['studioAssetFolderDeletedToast(Poses)'])
        const replay = vi.spyOn(service, 'replay')
        await toastHost.activate(toastHost.visible[0].id)
        await settle()
        expect(replay.mock.calls[0][1]).toEqual({ kind: 'undo', expectTop: service.view(A).done[0]?.id ?? service.view(A).undone[0].id })
        expect(stored()?.additional.order).toEqual(['Poses', 'Props'])
        expect(namesIn(folderOfSection('Poses'))).toEqual(['smile', 'grin'])
    })
})

describe('the folder controls and focus', () => {
    const boxOf = (name: string) => rowOf(name).querySelector('[data-part="studio-asset-select"]') as HTMLInputElement
    // Poses is the only folder, so deleting it leaves the list flat.
    const onlyPoses = () => {
        db.db.characters = [makeCharacter([assetRow('smile', 'assets/smile.png'), assetRow('grin', 'assets/grin.png')], folderDoc(['Poses'], [['smile', 'Poses'], ['grin', 'Poses']]))]
    }
    // Every row is in a folder, so "No folder" has no section until a folder delete hands it rows.
    const twoFolders = () => {
        db.db.characters = [makeCharacter([assetRow('smile', 'assets/smile.png'), assetRow('grin', 'assets/grin.png'), assetRow('hat', 'assets/hat.png')], folderDoc(['Poses', 'Props'], [['smile', 'Poses'], ['grin', 'Poses'], ['hat', 'Props']]))]
    }

    test('a ticked row of a folded folder is left out of bulk Delete and bulk Move, and the count ignores it', async () => {
        await show()
        await click(part('studio-asset-select-toggle'))
        await click(boxOf('smile'))
        await click(part('studio-asset-folder-header', folderOfSection('Poses')))
        expect(part('studio-asset-selected-count').textContent).toBe('studioAssetSelectedCount(0)')
        await click(part('studio-asset-bulk-delete'))
        await click(part('studio-asset-bulk-move'))
        expect(db.db.characters[0].additionalAssets.map((row) => row[0])).toEqual(['smile', 'grin', 'frown', 'hat', 'a/b'])
        // A shown row ticked as well enables both actions, and each acts on that row alone.
        await click(boxOf('frown'))
        expect(part('studio-asset-selected-count').textContent).toBe('studioAssetSelectedCount(1)')
        await click(part('studio-asset-bulk-move'))
        await click(parts('studio-asset-bulk-move-choice').find((choice) => choice.dataset.folder === 'Props') as HTMLElement)
        expect(entriesOf()).toEqual({ smile: 'Poses', grin: 'Poses', hat: 'Props', frown: 'Props' })
        await click(part('studio-asset-bulk-delete'))
        expect(db.db.characters[0].additionalAssets.map((row) => row[0])).toEqual(['smile', 'grin', 'hat', 'a/b'])
    })

    test('select all with a folder folded ticks none of its rows, and unfolding it shows them unticked', async () => {
        await show()
        await click(part('studio-asset-select-toggle'))
        await click(part('studio-asset-folder-header', folderOfSection('Poses')))
        await click(part('studio-asset-select-all'))
        await click(part('studio-asset-folder-header', folderOfSection('Poses')))
        expect(boxOf('smile').checked).toBe(false)
        expect(boxOf('grin').checked).toBe(false)
        expect(boxOf('hat').checked).toBe(true)
        expect(part('studio-asset-selected-count').textContent).toBe('studioAssetSelectedCount(3)')
    })

    test('a landed folder delete from its Delete button focuses the "No folder" header, which the flush has just made', async () => {
        twoFolders()
        await show()
        expect(folderOfSection(null)).toBeUndefined()
        const button = part('studio-asset-folder-delete', folderOfSection('Poses'))
        button.focus()
        await click(button)
        expect(document.activeElement).toBe(part('studio-asset-folder-header', folderOfSection(null)))
    })

    test('a landed delete of the last folder focuses the list, as the flat list has no "No folder" header', async () => {
        onlyPoses()
        await show()
        const button = part('studio-asset-folder-delete', folderOfSection('Poses'))
        button.focus()
        await click(button)
        expect(document.activeElement).toBe(part('studio-asset-list'))
    })

    test('a landed folder delete leaves focus where it was when it was not on that Delete button', async () => {
        onlyPoses()
        await show()
        const filter = part('studio-asset-filter') as HTMLInputElement
        filter.focus()
        await click(part('studio-asset-folder-delete', folderOfSection('Poses')))
        expect(document.activeElement).toBe(filter)
    })

    test('a refused folder delete moves no focus', async () => {
        onlyPoses()
        await show()
        vi.spyOn(service, 'assetFolder').mockReturnValue({ ok: false, reason: 'precondition', folderRefusal: 'unknownFolder' })
        const button = part('studio-asset-folder-delete', folderOfSection('Poses'))
        button.focus()
        await click(button)
        expect(document.activeElement).toBe(button)
    })

    test('a folder rename committed with Enter focuses the header of the renamed folder, which the flush has re-created', async () => {
        await show()
        await click(part('studio-asset-folder-rename', folderOfSection('Poses')))
        const field = part('studio-asset-folder-name') as HTMLInputElement
        expect(document.activeElement).toBe(field)
        await type(field, 'Stances')
        expect(document.activeElement).toBe(part('studio-asset-folder-header', folderOfSection('Stances')))
    })

    test('a folder rename that is refused keeps focus in its field', async () => {
        await show()
        await click(part('studio-asset-folder-rename', folderOfSection('Poses')))
        const field = part('studio-asset-folder-name') as HTMLInputElement
        await type(field, 'props')
        expect(document.activeElement).toBe(field)
    })

    test('a folder rename that lands as the field is left for another element leaves focus on that element', async () => {
        await show()
        await click(part('studio-asset-folder-rename', folderOfSection('Poses')))
        const field = part('studio-asset-folder-name') as HTMLInputElement
        field.value = 'Stances'
        const filter = part('studio-asset-filter') as HTMLInputElement
        filter.focus()
        await settle()
        expect(stored()?.additional.order).toEqual(['Stances', 'Props'])
        expect(document.activeElement).toBe(filter)
    })
})

describe('a rename into a name that has rows in a folder', () => {
    test('puts the row in that folder, says so on the row, and drops the old name\'s entry', async () => {
        db.db.characters = [makeCharacter(baseRows(), folderDoc(['Poses', 'Props'], [['smile', 'Poses'], ['grin', 'Poses'], ['hat', 'Props'], ['frown', 'Poses']]))]
        await show()
        const field = rowOf('frown').querySelector('[data-part="studio-asset-name"]') as HTMLInputElement
        await type(field, 'hat')
        expect(service.view(A).done.map((step) => step.label)).toEqual([{ kind: 'assetRename', from: 'frown', to: 'hat' }])
        expect(entriesOf()).toEqual({ smile: 'Poses', grin: 'Poses', hat: 'Props' })
        const joined = parts('studio-asset-row').find((row) => (row.querySelector('[data-part="studio-asset-name"]') as HTMLInputElement).value === 'hat' && row.querySelector('[data-part="studio-asset-join-note"]'))
        expect(joined?.querySelector('[data-part="studio-asset-join-note"]')?.textContent).toBe('studioAssetRenameJoins(Props,hat)')
        expect(namesIn(folderOfSection('Props'))).toEqual(['hat', 'hat'])
    })

    test('says nothing when the new name has no folder or the rows are already together', async () => {
        await show()
        await type(rowOf('frown').querySelector('[data-part="studio-asset-name"]') as HTMLInputElement, 'fresh')
        expect(parts('studio-asset-join-note')).toHaveLength(0)
    })
})

describe('an import', () => {
    let landing: ImportLanding | undefined
    const picker = { open: (given?: ImportLanding) => { landing = given } }

    beforeEach(() => { landing = undefined })

    async function pressAdd(): Promise<ImportLanding> {
        const add = part('studio-asset-add') as HTMLElement
        add.focus()
        await click(add)
        expect(landing).toBeDefined()
        return landing as ImportLanding
    }

    function importRows(...rows: string[][]): void {
        expect(service.assetInsert(A, 'additionalAssets', rows).ok).toBe(true)
    }

    test('lands in the folder whose row had focus when Add was pressed', async () => {
        await show({ picker })
        ;(rowOf('smile').querySelector('[data-part="studio-asset-row-more"]') as HTMLElement).focus()
        const given = await pressAdd()
        expect(given.folder).toBe('Poses')
        importRows(assetRow('newpic', 'assets/newpic.png'))
        const result = given.land(['newpic'])
        await settle()
        expect(result).toEqual({ landed: true, notes: [], refusal: null })
        expect(entriesOf().newpic).toBe('Poses')
        expect(namesIn(folderOfSection('Poses'))).toContain('newpic')
    })

    test('lands in the folder whose header had focus', async () => {
        await show({ picker })
        part('studio-asset-folder-header', folderOfSection('Props')).focus()
        const given = await pressAdd()
        expect(given.folder).toBe('Props')
    })

    test('lands in "No folder" when focus was on no folder or on the filter', async () => {
        await show({ picker })
        part('studio-asset-filter').focus()
        const given = await pressAdd()
        expect(given.folder).toBeNull()
        importRows(assetRow('newpic', 'assets/newpic.png'))
        expect(given.land(['newpic']).landed).toBe(false)
        expect(entriesOf().newpic).toBeUndefined()
    })

    test('a name that already has rows in another folder stays there, and the line says so', async () => {
        await show({ picker })
        ;(rowOf('smile').querySelector('[data-part="studio-asset-row-more"]') as HTMLElement).focus()
        const given = await pressAdd()
        importRows(assetRow('hat', 'assets/hat2.png'))
        const result = given.land(['hat'])
        await settle()
        expect(result.notes).toEqual(['studioAssetImportJoins(Props,hat)'])
        expect(result.landed).toBe(false)
        expect(entriesOf().hat).toBe('Props')
    })

    test('a stored entry for a name with no other row is stale and is not followed', async () => {
        db.db.characters = [makeCharacter(baseRows(), folderDoc(['Poses', 'Props'], [['smile', 'Poses'], ['ghost', 'Props']]))]
        await show({ picker })
        ;(rowOf('smile').querySelector('[data-part="studio-asset-row-more"]') as HTMLElement).focus()
        const given = await pressAdd()
        importRows(assetRow('ghost', 'assets/ghost.png'))
        const result = given.land(['ghost'])
        await settle()
        expect(result.notes).toEqual([])
        expect(entriesOf().ghost).toBe('Poses')
        expect(namesIn(folderOfSection('Poses'))).toContain('ghost')
    })
})
