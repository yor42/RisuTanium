// @vitest-environment jsdom
/**
 * The Studio emotion-image list, select mode and bulk Delete: the ticks, select all over the rows on screen, one step and
 * one toast for the ticked rows, and the rule that a tick on a row that left the screen deletes nothing.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => 0,
    getFileSrc: async (path: string) => `blob:${path}`,
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
    const table: Record<string, unknown> = { sidebarUi: { noAssets: 'noAssets' } }
    for (const key of ['studioAssetRowMenu', 'studioAssetDeletedOne', 'studioEmotionFilterEmpty', 'studioEmotionDeletedMany', 'studioAssetStillUsed', 'studioAssetSelectedCount']) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { retainedNamesOf } from 'src/ts/storage/store2/lists/assetList'
import type { AssetSizeJob, StoredSize } from 'src/ts/studio/assets/assetSizes'
import { resetStudioToastsForTests, retireAssetToasts } from 'src/ts/studio/edit/studioToasts'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createToastHost, resetToastHostForTests, type ToastHost } from 'src/ts/toast/toastHost.svelte'
import { ASSET_RETAINED_KEY } from '../../../ts/studio/assets/assetOwnerKeys'
import { assetRow, hashPath } from '../../../ts/studio/assets/assetFixtures.test-helpers'
import type { UsedInPort } from '../../../ts/studio/assets/assetPresentation'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, type ClaimDouble } from '../../../ts/studio/history/tests/studioStoreDoubles'
import { setSessionAssetSizeJobForTests } from './StudioAssetList.svelte'
import { installChromiumFocusRemoval } from './chromiumFocusRemoval.test-helpers'
import StudioEmotionList from './StudioEmotionList.svelte'

// No size is ever read: the production size job is not loaded.
const noSizes: AssetSizeJob = { peek: () => undefined, snapshot: () => new Map<string, StoredSize>(), ensure: async () => true }

interface LiveCharacter {
    chaId: string
    type: string
    desc: string
    alternateGreetings: string[]
    chats: { id: string, note: string, fmIndex?: number }[]
    chatPage: number
    additionalAssets: string[][]
    emotionImages: string[][]
    [key: string]: unknown
}

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const pA = hashPath('a', 'png')
const pB = hashPath('b', 'png')
const pC = hashPath('c', 'png')

const ASSET_ROWS = (): string[][] => [assetRow('a0', hashPath('x', 'png')), assetRow('a1', hashPath('y', 'png')), assetRow('a2', hashPath('z', 'png'))]
const THREE = (): string[][] => [['happy', pA], ['sad', pB], ['hat', pC]]

function makeCharacter(emotionImages: string[][]): LiveCharacter {
    return {
        chaId: 'A',
        type: 'character',
        desc: 'd0',
        alternateGreetings: ['g0'],
        chats: [{ id: 'c1', note: 'n0', fmIndex: 2 }],
        chatPage: 0,
        additionalAssets: ASSET_ROWS(),
        emotionImages,
    }
}

let rig: { claim: ClaimDouble, service: OwnerHistoryService }
let toastHost: ToastHost
let mounted: { app: ReturnType<typeof mount>, host: HTMLElement }[] = []
let removeShim: (() => void) | undefined
let pageCount = 0

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
    await drainMicrotasks()
}

async function install(emotions: string[][], configure?: (claim: ClaimDouble) => void): Promise<void> {
    db.db.characters = [makeCharacter(emotions)]
    const claim = createClaimDouble()
    configure?.(claim)
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim,
        clock: createFakeClock(),
        pageSession: `p${++pageCount}`,
        registerLeaveFlush: () => () => {},
        onLanded: retireAssetToasts,
    })
    setStudioHistoryServiceForTests(service)
    rig = { claim, service }
    await service.whenReady(A)
}

async function show(props: Record<string, unknown> = {}): Promise<void> {
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push({ app: mount(StudioEmotionList, { target: host, props: { chaId: 'A', host: toastHost, ...props } }), host })
    flushSync()
    await settle()
}

const parts = (name: string, from: ParentNode = document) => Array.from(from.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const part = (name: string): HTMLElement | null => parts(name)[0] ?? null
const live = () => db.db.characters[0]
const emotions = (): string[][] => JSON.parse(JSON.stringify(live().emotionImages))
const nameField = (row: HTMLElement) => row.querySelector('[data-part="studio-asset-name"]') as HTMLInputElement
const rowOf = (name: string): HTMLElement => parts('studio-asset-row').find((row) => nameField(row).value === name) as HTMLElement
const moreOf = (name: string) => rowOf(name).querySelector('[data-part="studio-asset-row-more"]') as HTMLElement
const tickOf = (name: string) => rowOf(name).querySelector('[data-part="studio-asset-select"]') as HTMLInputElement
const shownNames = (): string[] => parts('studio-asset-row').map((row) => nameField(row).value)
const doneOf = () => rig.service.view(A).done
const countText = () => part('studio-asset-selected-count')?.textContent
const bulkDeleteButton = () => part('studio-asset-bulk-delete') as HTMLButtonElement

async function click(element: HTMLElement): Promise<void> {
    element.click()
    await settle()
}

async function tick(name: string, on = true): Promise<void> {
    const box = tickOf(name)
    box.checked = on
    box.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
}

async function selectAll(on = true): Promise<void> {
    const box = part('studio-asset-select-all') as HTMLInputElement
    box.checked = on
    box.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
}

function typeFilter(text: string): void {
    const field = part('studio-emotion-filter') as HTMLInputElement
    field.value = text
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

async function renameByEnter(from: string, to: string): Promise<void> {
    const field = nameField(rowOf(from))
    field.focus()
    field.value = to
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await settle()
}

const selectToggle = () => part('studio-asset-select-toggle') as HTMLElement

beforeEach(() => {
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => {} })
    resetStudioScreenForTests()
    setSessionAssetSizeJobForTests(noSizes)
    selection.selId = 0
    studioScreen.chaId = 'A'
    toastHost = createToastHost({ clock: { now: () => 0, after: () => () => {} } })
    setStudioVisitAckForTests({ noteEdit: () => {}, dispose: () => {} } as never)
})

afterEach(async () => {
    removeShim?.()
    removeShim = undefined
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

const port = (unused: string[] = []): UsedInPort => ({
    usedText: (name) => (unused.includes(name) ? null : `${name} used 2`),
    showUsed: vi.fn(),
    renamedNote: vi.fn(() => null),
    showRenamed: vi.fn(),
})

describe('select mode', () => {
    test('U11: Select shows the bar with Delete only, a tick per row and a count; select all under a filter ticks only the rows on screen', async () => {
        await install(THREE())
        await show()
        const toggle = selectToggle()
        expect(toggle.getAttribute('aria-pressed')).toBe('false')
        expect(parts('studio-asset-bulkbar')).toHaveLength(0)
        expect(parts('studio-asset-select')).toHaveLength(0)
        await click(toggle)
        expect(toggle.getAttribute('aria-pressed')).toBe('true')
        expect(parts('studio-asset-bulkbar')).toHaveLength(1)
        expect(parts('studio-asset-select')).toHaveLength(3)
        expect(parts('studio-asset-bulk-move')).toHaveLength(0)
        expect(parts('studio-asset-bulk-preview')).toHaveLength(0)
        expect(countText()).toBe('studioAssetSelectedCount(0)')
        expect(bulkDeleteButton().disabled).toBe(true)
        typeFilter('ha')
        await settle()
        await selectAll()
        expect(countText()).toBe('studioAssetSelectedCount(2)')
        expect(tickOf('happy').checked).toBe(true)
        expect(tickOf('hat').checked).toBe(true)
        typeFilter('')
        await settle()
        expect(countText()).toBe('studioAssetSelectedCount(0)')
        await selectAll()
        expect(countText()).toBe('studioAssetSelectedCount(3)')
        await selectAll(false)
        expect(countText()).toBe('studioAssetSelectedCount(0)')
    })

    test('U11: select all ticks only the shown rows, so Delete leaves the hidden ones', async () => {
        await install(THREE())
        await show()
        await click(selectToggle())
        typeFilter('sa')
        await settle()
        await selectAll()
        expect(countText()).toBe('studioAssetSelectedCount(1)')
        await click(bulkDeleteButton())
        expect(emotions()).toEqual([['happy', pA], ['hat', pC]])
    })

    test('U11: a row that reaches the screen after select all (renamed into the filter elsewhere) is not ticked', async () => {
        await install(THREE())
        await show()
        await click(selectToggle())
        typeFilter('ha')
        await settle()
        await selectAll()
        expect(countText()).toBe('studioAssetSelectedCount(2)')
        expect(rig.service.assetRename(A, 'emotionImages', 1, 'hay').ok).toBe(true)
        await settle()
        expect(shownNames()).toEqual(['happy', 'hay', 'hat'])
        expect(tickOf('hay').checked).toBe(false)
        expect(countText()).toBe('studioAssetSelectedCount(2)')
    })

    test('U11: turning Select off and on clears the ticks and the still-used line', async () => {
        await install(THREE())
        await show({ usedIn: port() })
        await click(selectToggle())
        await tick('happy')
        await tick('sad')
        expect(countText()).toBe('studioAssetSelectedCount(2)')
        await click(bulkDeleteButton())
        expect(part('studio-asset-bulk-note')).not.toBeNull()
        await tick('hat')
        expect(countText()).toBe('studioAssetSelectedCount(1)')
        await click(selectToggle())
        expect(parts('studio-asset-bulkbar')).toHaveLength(0)
        expect(parts('studio-asset-bulk-note')).toHaveLength(0)
        await click(selectToggle())
        expect(countText()).toBe('studioAssetSelectedCount(0)')
        expect(tickOf('hat').checked).toBe(false)
    })
})

describe('bulk delete', () => {
    test('U12: under a filter it is one step, one toast, exactly the shown ticked stored rows, and undo and redo restore and repeat it', async () => {
        await install(THREE())
        await show()
        await click(selectToggle())
        typeFilter('ha')
        await settle()
        await selectAll()
        await click(bulkDeleteButton())
        expect(emotions()).toEqual([['sad', pB]])
        expect(doneOf()).toHaveLength(1)
        expect(doneOf()[0].label).toEqual({ kind: 'assetDelete', count: 2, name: null })
        expect(retainedNamesOf(live()[ASSET_RETAINED_KEY]).sort()).toEqual([pA, pC].sort())
        expect(toastHost.visible).toHaveLength(1)
        expect(toastHost.visible[0].text).toBe('studioEmotionDeletedMany(2)')
        expect(countText()).toBe('studioAssetSelectedCount(0)')
        expect(live().additionalAssets).toEqual(ASSET_ROWS())
        await toastHost.activate(toastHost.visible[0].id)
        await settle()
        expect(emotions()).toEqual(THREE())
        expect(rig.service.redo(A)).toEqual({ ok: true })
        await settle()
        expect(emotions()).toEqual([['sad', pB]])
    })

    test('U12: typing in the filter clears the ticks', async () => {
        await install(THREE())
        await show()
        await click(selectToggle())
        await tick('sad')
        expect(countText()).toBe('studioAssetSelectedCount(1)')
        typeFilter('ha')
        await settle()
        typeFilter('')
        await settle()
        expect(countText()).toBe('studioAssetSelectedCount(0)')
        expect(tickOf('sad').checked).toBe(false)
    })

    test('U12b: a ticked row a rename hides from the filter is not deleted, and focus stays in the list', async () => {
        removeShim = installChromiumFocusRemoval()
        await install(THREE())
        await show()
        await click(selectToggle())
        typeFilter('ha')
        await settle()
        await tick('happy')
        await tick('hat')
        expect(countText()).toBe('studioAssetSelectedCount(2)')
        await renameByEnter('hat', 'cap')
        expect(shownNames()).toEqual(['happy'])
        expect(countText()).toBe('studioAssetSelectedCount(1)')
        expect(document.activeElement).toBe(moreOf('happy'))
        await click(bulkDeleteButton())
        expect(emotions()).toEqual([['sad', pB], ['cap', pC]])
        expect(toastHost.visible.at(-1)?.text).toBe('studioEmotionDeletedMany(1)')
    })

    test('a bulk delete that lands no step posts no toast', async () => {
        await install(THREE())
        await show()
        vi.spyOn(rig.service, 'assetDelete').mockReturnValue({ ok: true })
        await click(selectToggle())
        await tick('sad')
        await click(bulkDeleteButton())
        expect(toastHost.visible).toHaveLength(0)
        expect(countText()).toBe('studioAssetSelectedCount(0)')
    })

    test('U12: a ticked row deleted from its own menu is not ticked again when Undo brings it back', async () => {
        await install([['x', pA], ['y', pA]])
        await show()
        await click(selectToggle())
        await tick('y')
        expect(countText()).toBe('studioAssetSelectedCount(1)')
        await click(moreOf('y'))
        await click(rowOf('y').querySelector('[data-part="studio-asset-menu-delete"]') as HTMLElement)
        expect(emotions()).toEqual([['x', pA]])
        await toastHost.activate(toastHost.visible[0].id)
        await settle()
        expect(emotions()).toEqual([['x', pA], ['y', pA]])
        expect(countText()).toBe('studioAssetSelectedCount(0)')
        expect(tickOf('x').checked).toBe(false)
        expect(tickOf('y').checked).toBe(false)
    })

    test('U13: a refused bulk delete shows the refusal, writes nothing, and keeps the ticks', async () => {
        await install(THREE(), (claim) => { claim.unsupported = true })
        await show()
        await click(selectToggle())
        await selectAll()
        await click(bulkDeleteButton())
        expect(part('studio-emotion-refusal')?.textContent).toBe('studioAssetRefusalNoUndo')
        expect(emotions()).toEqual(THREE())
        expect(doneOf()).toHaveLength(0)
        expect(toastHost.visible).toHaveLength(0)
        expect(countText()).toBe('studioAssetSelectedCount(3)')
    })
})

describe('the still-used line', () => {
    test('U14: with the port a bulk delete of used names says so, with Show; a later bulk delete of unused names clears the line', async () => {
        await install(THREE())
        const usedIn = port(['hat'])
        await show({ usedIn })
        await click(selectToggle())
        await tick('happy')
        await click(bulkDeleteButton())
        expect(part('studio-asset-bulk-note')?.textContent).toContain('studioAssetStillUsed(1)')
        expect(toastHost.visible[0].text).toBe('studioEmotionDeletedMany(1)')
        expect(toastHost.visible[0].sub).toBe('studioAssetStillUsed(1)')
        await click(part('studio-asset-bulk-show') as HTMLElement)
        expect(usedIn.showUsed).toHaveBeenCalledWith('happy')
        await tick('hat')
        await click(bulkDeleteButton())
        expect(parts('studio-asset-bulk-note')).toHaveLength(0)
    })

    test('U14: without the port there is no still-used line and no Show', async () => {
        await install(THREE())
        await show()
        await click(selectToggle())
        await selectAll()
        await click(bulkDeleteButton())
        expect(parts('studio-asset-bulk-note')).toHaveLength(0)
        expect(parts('studio-asset-bulk-show')).toHaveLength(0)
        expect(toastHost.visible[0].text).toBe('studioEmotionDeletedMany(3)')
        expect(toastHost.visible[0].sub).toBeUndefined()
    })
})
