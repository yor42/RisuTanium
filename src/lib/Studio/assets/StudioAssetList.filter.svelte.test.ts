// @vitest-environment jsdom
/**
 * The filter of the Studio asset list over the real history service on the memory doubles: what it matches, what it
 * hides, that it reads no file, that a keystroke costs one pass, and that select-all takes only the rows it shows.
 * Feature guards: none of this exists at the stage's base.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0, matches: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    getFileSrc: async (path: string, use: string) => `blob:${use}:${path}`,
}))
// The matcher the filter shares with Studio search, counted: one pass over the rows is one call per row and field.
vi.mock('src/ts/chatShell/toggleSearch', async (importOriginal) => {
    const original = await importOriginal<typeof import('src/ts/chatShell/toggleSearch')>()
    return { ...original, textMatches: (text: string, query: string) => { h.matches += 1; return original.textMatches(text, query) } }
})

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
    for (const key of ['studioAssetEmotionsElsewhere', 'studioAssetRowMenu', 'studioAssetDeletedOne', 'studioAssetFilterEmpty', 'studioAssetSelectedCount', 'studioAssetDeletedMany', 'studioAssetStillUsed', 'studioAssetModuleNowShows', 'studioStepAssetMove']) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { AssetSizeJob, StoredSize } from 'src/ts/studio/assets/assetSizes'
import { resetStudioToastsForTests, retireAssetToasts } from 'src/ts/studio/edit/studioToasts'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createToastHost, resetToastHostForTests, type ToastClock } from 'src/ts/toast/toastHost.svelte'
import { ASSET_FOLDER_KEY } from '../../../ts/studio/assets/assetOwnerKeys'
import { createOwnerHistoryService } from '../../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../../ts/studio/history/tests/studioStoreDoubles'
import { assetRow } from '../../../ts/studio/assets/assetFixtures.test-helpers'
import StudioAssetList, { setSessionAssetSizeJobForTests } from './StudioAssetList.svelte'
import { installChromiumFocusRemoval } from './chromiumFocusRemoval.test-helpers'

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
const FOLDERS = ['Alpha', 'Beta', 'Gamma']

// 30 rows named `<folder lower>-<n>` over three folders, ten each; the names do not contain the folder's full name in
// capitals, so a name match and a folder match are told apart.
function thirtyRows(): { rows: string[][]; of: [string, string][] } {
    const rows: string[][] = []
    const of: [string, string][] = []
    FOLDERS.forEach((folder, f) => {
        for (let n = 0; n < 10; n++) {
            const name = `${folder.slice(0, 2).toLowerCase()}${f}-pic${n}`
            rows.push(assetRow(name, `assets/${name}.png`))
            of.push([name, folder])
        }
    })
    return { rows, of }
}

let sizeCalls = 0
const countingSizes: AssetSizeJob = {
    peek: () => undefined,
    snapshot: () => new Map<string, StoredSize>(),
    ensure: async () => { sizeCalls += 1; return true },
}

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
    await drainMicrotasks()
}

async function show(): Promise<void> {
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push({ app: mount(StudioAssetList, { target: host, props: { chaId: 'A', host: createToastHost({ clock: { now: () => 0, after: () => () => {} } satisfies ToastClock }) } }), host })
    flushSync()
    await settle()
}

// What the person sees: a hidden row or folder stays in the page, so an element that is itself hidden, or inside a hidden one, is left out.
const parts = (name: string, from: ParentNode = document) => Array.from(from.querySelectorAll<HTMLElement>(`[data-part="${name}"]`)).filter((element) => element.closest('[hidden]') === null)
const rawParts = (name: string, from: ParentNode = document) => Array.from(from.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const part = (name: string) => parts(name)[0]
const shownNames = () => parts('studio-asset-name').map((field) => (field as HTMLInputElement).value)
const shownFolders = () => parts('studio-asset-folder').map((section) => section.dataset.folder ?? 'none')

async function filterBy(text: string): Promise<void> {
    const field = part('studio-asset-filter') as HTMLInputElement
    field.value = text
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
}

async function click(element: HTMLElement): Promise<void> {
    element.click()
    await settle()
}

beforeEach(async () => {
    h.marks = 0
    h.matches = 0
    sizeCalls = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    setSessionAssetSizeJobForTests(countingSizes)
    const { rows, of } = thirtyRows()
    db.db.characters = [{
        chaId: 'A',
        type: 'character',
        desc: 'd0',
        alternateGreetings: [],
        chats: [{ id: 'c1', note: '' }],
        chatPage: 0,
        additionalAssets: rows,
        emotionImages: [],
        extentions: { [ASSET_FOLDER_KEY]: { v: 1, additional: { order: FOLDERS, of } } },
    }]
    selection.selId = 0
    studioScreen.chaId = 'A'
    const service = createOwnerHistoryService({
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
    setSessionAssetSizeJobForTests(undefined)
    resetStudioToastsForTests()
    resetToastHostForTests()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('the filter', () => {
    test('shows the rows whose name matches, ignoring case, and hides the folders that have none', async () => {
        await show()
        expect(parts('studio-asset-row')).toHaveLength(30)
        await filterBy('BE1-PIC3')
        expect(shownNames()).toEqual(['be1-pic3'])
        expect(shownFolders()).toEqual(['Beta'])
    })

    test('shows every row of a folder whose name matches, ignoring case', async () => {
        await show()
        await filterBy('gAmM')
        expect(shownFolders()).toEqual(['Gamma'])
        expect(shownNames()).toHaveLength(10)
        expect(shownNames().every((name) => name.startsWith('ga2'))).toBe(true)
    })

    test('a query that matches nothing says so, with the query, and shows no folder or row', async () => {
        await show()
        await filterBy('zzz')
        expect(part('studio-asset-filter-empty').textContent).toBe('studioAssetFilterEmpty(zzz)')
        expect(parts('studio-asset-row')).toHaveLength(0)
        expect(parts('studio-asset-folder')).toHaveLength(0)
    })

    test('clearing it shows every row and folder again, and trims what is typed', async () => {
        await show()
        await filterBy('  be1-pic3  ')
        expect(shownNames()).toEqual(['be1-pic3'])
        await filterBy('')
        expect(parts('studio-asset-row')).toHaveLength(30)
        expect(shownFolders()).toEqual(['Alpha', 'Beta', 'Gamma'])
    })

    test('reads no file: typing asks the size job and the URL maker for nothing more', async () => {
        await show()
        const sizesBefore = sizeCalls
        await filterBy('al0')
        await filterBy('al0-pic')
        await filterBy('')
        expect(sizeCalls).toBe(sizesBefore)
    })

    test('costs one matching pass per keystroke and never loops an effect', async () => {
        await show()
        const errors: unknown[] = []
        const onError = (event: ErrorEvent) => errors.push(event.error)
        window.addEventListener('error', onError)
        // Each pass asks the matcher once for a row's name and, while that fails, once for its folder.
        const perPass = 30 * 2
        for (const text of ['a', 'al', 'al0', 'al0-', 'al0-p']) {
            h.matches = 0
            await filterBy(text)
            expect(h.matches, text).toBeLessThanOrEqual(perPass)
            expect(h.matches, text).toBeGreaterThan(0)
        }
        window.removeEventListener('error', onError)
        expect(errors).toEqual([])
    })
})

describe('a row the filter or a fold takes off the screen', () => {
    const rowNodes = () => rawParts('studio-asset-row')

    // The page holds displayed rows only: a row the filter or a fold takes off the screen is removed, not hidden, and
    // it comes back, in its place, when the filter clears or the folder opens again.
    test('leaves the page: narrowing keeps only the matching row\'s node, and clearing the filter brings every row back in order', async () => {
        await show()
        const before = rowNodes().map((row) => row.dataset.rowKey)
        expect(before).toHaveLength(30)
        await filterBy('be1-pic3')
        expect(rowNodes()).toHaveLength(1)
        expect(rowNodes().filter((row) => row.closest('[hidden]') !== null)).toHaveLength(0)
        expect(parts('studio-asset-row')).toHaveLength(1)
        await filterBy('')
        expect(rowNodes().map((row) => row.dataset.rowKey)).toEqual(before)
        expect(parts('studio-asset-row')).toHaveLength(30)
    })

    test('leaves the page: folding a folder removes its rows and opening it again brings them back in order', async () => {
        await show()
        const before = rowNodes().map((row) => row.dataset.rowKey)
        const second = Array.from(parts('studio-asset-folder')[1].querySelectorAll<HTMLElement>('[data-part="studio-asset-row"]'))
        expect(second).toHaveLength(10)
        await click(parts('studio-asset-folder-header')[1])
        expect(rowNodes()).toHaveLength(20)
        expect(second.every((row) => !row.isConnected)).toBe(true)
        expect(parts('studio-asset-row')).toHaveLength(20)
        await click(parts('studio-asset-folder-header')[1])
        expect(rowNodes().map((row) => row.dataset.rowKey)).toEqual(before)
        expect(parts('studio-asset-row')).toHaveLength(30)
    })

    test('a section the filter leaves empty is hidden, not removed, and shows again when the filter clears', async () => {
        await show()
        await filterBy('BE1-PIC3')
        expect(rawParts('studio-asset-folder')).toHaveLength(3)
        expect(parts('studio-asset-folder')).toHaveLength(1)
        await filterBy('')
        expect(parts('studio-asset-folder')).toHaveLength(3)
    })

    // The name field of the focused row commits a name that no longer matches: the row is hidden while it still holds
    // focus, and the list hands focus to the next displayed row, as it did when the row was removed.
    describe('that held focus', () => {
        let removeShim: () => void
        beforeEach(() => { removeShim = installChromiumFocusRemoval() })
        afterEach(() => { removeShim() })

        const rowFor = (name: string): HTMLElement => rawParts('studio-asset-row').find((row) => (row.querySelector('[data-part="studio-asset-name"]') as HTMLInputElement).value === name) as HTMLElement
        const nameOf = (name: string) => rowFor(name).querySelector('[data-part="studio-asset-name"]') as HTMLInputElement
        const moreOf = (name: string) => rowFor(name).querySelector('[data-part="studio-asset-row-more"]') as HTMLElement

        test('moves focus to the next displayed row\'s menu button when its rename takes it out of the filter', async () => {
            await show()
            await filterBy('al0-pic')
            expect(parts('studio-asset-row')).toHaveLength(10)
            const field = nameOf('al0-pic3')
            field.focus()
            field.value = 'zzz'
            field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
            await settle()
            expect(parts('studio-asset-row')).toHaveLength(9)
            expect(document.activeElement).toBe(moreOf('al0-pic4'))
        })

        test('leaves focus where it is when it is already outside the list as the rename commits', async () => {
            await show()
            await filterBy('al0-pic')
            const outside = document.createElement('button')
            document.body.append(outside)
            const field = nameOf('al0-pic3')
            field.focus()
            field.value = 'zzz'
            // The blur commits the name and hides the row; the effect runs in the flush that follows.
            outside.focus()
            flushSync()
            await settle()
            expect(parts('studio-asset-row')).toHaveLength(9)
            expect(document.activeElement).toBe(outside)
            outside.remove()
        })
    })
})

describe('select all', () => {
    test('takes only the rows the filter shows, and a delete then removes only those', async () => {
        await show()
        await click(part('studio-asset-select-toggle'))
        await filterBy('Alpha')
        await click(part('studio-asset-select-all') as HTMLElement)
        expect(part('studio-asset-selected-count').textContent).toBe('studioAssetSelectedCount(10)')
        expect(parts('studio-asset-select').filter((box) => (box as HTMLInputElement).checked)).toHaveLength(10)
        await click(part('studio-asset-bulk-delete'))
        expect(db.db.characters[0].additionalAssets).toHaveLength(20)
        expect(db.db.characters[0].additionalAssets.every((row) => !row[0].startsWith('al0'))).toBe(true)
    })

    test('takes only the rows of a folder that is open, so a folded folder\'s rows are never deleted unseen', async () => {
        await show()
        await click(part('studio-asset-select-toggle'))
        await click(parts('studio-asset-folder-header')[0])
        await click(part('studio-asset-select-all') as HTMLElement)
        expect(part('studio-asset-selected-count').textContent).toBe('studioAssetSelectedCount(20)')
        await click(part('studio-asset-bulk-delete'))
        expect(db.db.characters[0].additionalAssets).toHaveLength(10)
        expect(db.db.characters[0].additionalAssets.every((row) => row[0].startsWith('al0'))).toBe(true)
    })

    test('is ticked only while every shown row is, and a second press clears the selection', async () => {
        await show()
        await click(part('studio-asset-select-toggle'))
        const all = part('studio-asset-select-all') as HTMLInputElement
        await click(all)
        expect(all.checked).toBe(true)
        await click(parts('studio-asset-select')[0])
        expect(all.checked).toBe(false)
        await click(parts('studio-asset-select')[0])
        expect(all.checked).toBe(true)
        await click(all)
        expect(part('studio-asset-selected-count').textContent).toBe('studioAssetSelectedCount(0)')
    })
})
