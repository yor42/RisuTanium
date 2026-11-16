// @vitest-environment jsdom
/**
 * The focus rule of the Studio asset list under Chromium's removal events: a browser that removes the focused row
 * reports a `blur` and a `focusout` from an element that is still in the page, with no element that takes the focus.
 * The list must not read that as focus that left on purpose. The cases are those of the plain focus suite (delete from
 * the list, Ctrl+Y, the History panel's Redo), run with the events the browser sends.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    getFileSrc: async (path: string, use: string) => `blob:${use}:${path}`,
}))

const db = $state({ db: fixtureDb([]) })
const selection = $state({ selId: 0 })
const quickSettings = $state({ open: true })

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const stores = {
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        ReloadGUIPointer: writable(0),
        CharConfigSubMenu: writable(0),
        SettingsMenuIndex: writable(-1),
        botMakerMode: writable(false),
        sideBarStore: writable(false),
        frozenSaveKeysStore: writable([]),
        clearCharEmotionCache: () => {},
    }
    return {
        ...stores,
        get DBState() { return db },
        get selIdState() { return selection },
        get QuickSettings() { return quickSettings },
    }
})
vi.mock('src/ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('src/ts/process/moduleRefList', () => ({ moduleListOf: () => [] }))
vi.mock('src/ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('src/ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('src/ts/alert', () => ({ alertError: vi.fn() }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const call = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const table: Record<string, unknown> = { sidebarUi: { noAssets: 'noAssets' } }
    for (const key of ['studioAssetEmotionsElsewhere', 'studioAssetRowMenu', 'studioAssetDeletedOne', 'studioStepAssetDeleteOne', 'studioStepAssetRename', 'studioAssetFileGone', 'studioAssetFileUnchecked']) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { AssetSizeJob, StoredSize } from 'src/ts/studio/assets/assetSizes'
import { resetStudioToastsForTests, retireAssetToasts } from 'src/ts/studio/edit/studioToasts'
import { makeCharacter, makeChat, makeInput, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { openStudio, resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { createToastHost, resetToastHostForTests, type ToastHost } from 'src/ts/toast/toastHost.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../../ts/studio/history/tests/studioStoreDoubles'
import { assetRow } from '../../../ts/studio/assets/assetFixtures.test-helpers'
import StudioScreen from '../StudioScreen.svelte'
import StudioAssetList, { setSessionAssetSizeJobForTests } from './StudioAssetList.svelte'
import { installChromiumFocusRemoval } from './chromiumFocusRemoval.test-helpers'

function fixtureDb(rows: string[][]) {
    const base = studioDbOf(makeInput({ character: makeCharacter({ chaId: 'A' }) }))
    const chat = { ...makeChat({ id: 'c1', name: 'First chat' }), note: 'n0', fmIndex: 2 }
    const character = { ...base.characters[0], desc: 'd0', alternateGreetings: ['g0'], chats: [chat], additionalAssets: rows, emotionImages: [] as string[][] }
    return { ...base, characters: [character], useAdditionalAssetsPreview: false }
}

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const displayTarget = { owner: { type: 'character', id: 'A' }, kind: 'display', item: 'A/display:0', from: 'chat' } as const

const THREE = () => [assetRow('a', 'assets/a.png'), assetRow('b', 'assets/b.png'), assetRow('c', 'assets/c.png')]
// Two rows over one file, then a third.
const SHARED = () => [assetRow('a', 'assets/x.png'), assetRow('b', 'assets/x.png'), assetRow('c', 'assets/c.png')]

// No size is ever read: the production size job is not loaded.
const noSizes: AssetSizeJob = { peek: () => undefined, snapshot: () => new Map<string, StoredSize>(), ensure: async () => true }

class ResizeObserverStub {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(): void {
        this.callback([{ contentRect: { width: 1200 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    disconnect(): void {}
}

let service: OwnerHistoryService
let toastHost: ToastHost
let removeShim: () => void
let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

function install(rows: string[][]): void {
    db.db = fixtureDb(rows)
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
        onLanded: retireAssetToasts,
    })
    setStudioHistoryServiceForTests(service)
}

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
    await drainMicrotasks()
}

function mountInto(component: Parameters<typeof mount>[0], props: Record<string, unknown> = {}): HTMLElement {
    const host = document.createElement('div')
    host.style.position = 'relative'
    document.body.appendChild(host)
    mounted.push({ app: mount(component, { target: host, props }), host })
    flushSync()
    return host
}

async function showList(picker?: { open(): void }): Promise<void> {
    mountInto(StudioAssetList, { chaId: 'A', host: toastHost, ...(picker ? { picker } : {}) })
    await settle()
}

async function showScreen(options: { panel: boolean }): Promise<void> {
    openStudio(displayTarget, null)
    mountInto(StudioScreen, { toastHost })
    await settle()
    if (options.panel) {
        part('studio-history-toggle')?.click()
        await settle()
    }
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const parts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const nameField = (row: HTMLElement) => row.querySelector('[data-part="studio-asset-name"]') as HTMLInputElement
const rowOf = (name: string): HTMLElement => parts('studio-asset-row').find((row) => nameField(row).value === name) as HTMLElement
const moreOf = (name: string): HTMLElement => rowOf(name).querySelector('[data-part="studio-asset-row-more"]') as HTMLElement
const rowNames = () => db.db.characters[0].additionalAssets.map((row) => row[0])

// The two roots a lost focus falls back to: the screen's and the History panel's. Neither may ever take focus.
const rootFocusSpies = () => [part('studio'), part('studio-history')].flatMap((root) => (root ? [vi.spyOn(root, 'focus')] : []))
const expectNoRootFocus = (spies: ReturnType<typeof rootFocusSpies>) => {
    expect(spies.length).toBeGreaterThan(0)
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
}

// A press from the keyboard: the trigger takes focus, the menu opens, its Delete item takes focus and is activated.
async function deleteFromMenu(name: string): Promise<void> {
    moreOf(name).focus()
    moreOf(name).click()
    await settle()
    const item = rowOf(name).querySelector<HTMLElement>('[data-part="studio-asset-menu-delete"]') as HTMLElement
    item.focus()
    item.click()
    await tick()
    await settle()
}

// A timer turn after the settle lets work that was put off to a later task finish before the assertions read the page.
const laterTask = () => new Promise<void>((resolve) => setTimeout(resolve, 5))

async function ctrl(init: KeyboardEventInit): Promise<void> {
    part('studio')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, ...init }))
    flushSync()
    await settle()
    await settle()
    await laterTask()
}

async function press(name: string): Promise<void> {
    part(name)!.click()
    flushSync()
    await settle()
    await settle()
    await laterTask()
}

// The step is made first, then undone, so the row is back and the test starts from the state a redo meets.
async function withUndoneDelete(name: string, index: number): Promise<void> {
    await showScreen({ panel: false })
    expect(service.assetDelete(A, 'additionalAssets', [index]).ok).toBe(true)
    await settle()
    expect((await service.replay(A, { kind: 'undo' })).ok).toBe(true)
    await settle()
    expect(rowNames()).toContain(name)
}

beforeEach(() => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    selection.selId = 0
    studioScreen.chaId = 'A'
    setStudioEnabled(true)
    setSessionAssetSizeJobForTests(noSizes)
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    toastHost = createToastHost({ clock: { now: () => 0, after: () => () => {} } })
    // The chip the detail shows reads the ack's state.
    setStudioVisitAckForTests({ display: 'saved', canRetry: () => false, retry: () => false, noteEdit: () => {}, dispose: () => {} } as never)
    removeShim = installChromiumFocusRemoval()
})

afterEach(async () => {
    removeShim()
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    setSessionAssetSizeJobForTests(undefined)
    resetStudioToastsForTests()
    resetToastHostForTests()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    setStudioEnabled(false)
})

describe('focus after a delete from the list, with the browser\'s removal events', () => {
    test('deleting the first row focuses the next row\'s menu button', async () => {
        install(THREE())
        await service.whenReady(A)
        await showList()
        await deleteFromMenu('a')
        expect(rowNames()).toEqual(['b', 'c'])
        expect(document.activeElement).toBe(moreOf('b'))
    })

    test('deleting a middle row focuses the next row\'s menu button', async () => {
        install(THREE())
        await service.whenReady(A)
        await showList()
        await deleteFromMenu('b')
        expect(rowNames()).toEqual(['a', 'c'])
        expect(document.activeElement).toBe(moreOf('c'))
    })

    test('deleting the last row focuses the previous row\'s menu button', async () => {
        install(THREE())
        await service.whenReady(A)
        await showList()
        await deleteFromMenu('c')
        expect(rowNames()).toEqual(['a', 'b'])
        expect(document.activeElement).toBe(moreOf('b'))
    })

    test('deleting the only row focuses Add when the list has a picker', async () => {
        install([assetRow('a', 'assets/a.png')])
        await service.whenReady(A)
        await showList({ open: () => {} })
        await deleteFromMenu('a')
        expect(rowNames()).toEqual([])
        expect(document.activeElement).toBe(part('studio-asset-add'))
    })

    test('deleting the only row of a list with no picker focuses the list itself, never the page', async () => {
        install([assetRow('a', 'assets/a.png')])
        await service.whenReady(A)
        await showList()
        await deleteFromMenu('a')
        expect(document.activeElement).toBe(part('studio-asset-list'))
        expect(document.activeElement).not.toBe(document.body)
    })

    test('deleting the first of two rows over one file focuses the row that took its place', async () => {
        install(SHARED())
        await service.whenReady(A)
        await showList()
        await deleteFromMenu('a')
        expect(rowNames()).toEqual(['b', 'c'])
        expect(document.activeElement).toBe(moreOf('b'))
    })

    test('a row removed after focus went to the page moves no focus', async () => {
        install(THREE())
        await service.whenReady(A)
        await showList()
        moreOf('b').focus()
        moreOf('b').blur()
        expect(document.activeElement).toBe(document.body)
        await settle()
        expect(service.assetDelete(A, 'additionalAssets', [1]).ok).toBe(true)
        await settle()
        expect(rowNames()).toEqual(['a', 'c'])
        expect(document.activeElement).toBe(document.body)
    })

    test('focus that leaves the list and comes back to another row before the next microtask keeps that row tracked', async () => {
        install(THREE())
        await service.whenReady(A)
        await showList()
        const outside = document.createElement('button')
        document.body.append(outside)
        moreOf('b').focus()
        outside.focus()
        moreOf('c').focus()
        await settle()
        expect(service.assetDelete(A, 'additionalAssets', [2]).ok).toBe(true)
        await settle()
        expect(rowNames()).toEqual(['a', 'b'])
        expect(document.activeElement).toBe(moreOf('b'))
        outside.remove()
    })
})

describe('focus after an undo or redo of an asset step, with the browser\'s removal events', () => {
    test('Ctrl+Y of the focused middle row\'s delete focuses the next row\'s menu button', async () => {
        install(THREE())
        await service.whenReady(A)
        await withUndoneDelete('b', 1)
        const rootFocus = rootFocusSpies()
        moreOf('b').focus()
        await ctrl({ key: 'y' })
        expect(rowNames()).toEqual(['a', 'c'])
        expect(document.activeElement).toBe(moreOf('c'))
        expectNoRootFocus(rootFocus)
    })

    test('Ctrl+Y of the focused last row\'s delete focuses the previous row\'s menu button', async () => {
        install(THREE())
        await service.whenReady(A)
        await withUndoneDelete('c', 2)
        const rootFocus = rootFocusSpies()
        moreOf('c').focus()
        await ctrl({ key: 'y' })
        expect(rowNames()).toEqual(['a', 'b'])
        expect(document.activeElement).toBe(moreOf('b'))
        expectNoRootFocus(rootFocus)
    })

    test('Ctrl+Y of the only row\'s delete focuses the list, never the screen root', async () => {
        install([assetRow('a', 'assets/a.png')])
        await service.whenReady(A)
        await withUndoneDelete('a', 0)
        const rootFocus = rootFocusSpies()
        moreOf('a').focus()
        await ctrl({ key: 'y' })
        expect(rowNames()).toEqual([])
        expect(document.activeElement).toBe(part('studio-asset-list'))
        expectNoRootFocus(rootFocus)
    })

    test('Ctrl+Y of the first row\'s delete over a shared file focuses the row that took its place', async () => {
        install(SHARED())
        await service.whenReady(A)
        await withUndoneDelete('a', 0)
        const rootFocus = rootFocusSpies()
        moreOf('a').focus()
        await ctrl({ key: 'y' })
        expect(rowNames()).toEqual(['b', 'c'])
        expect(document.activeElement).toBe(moreOf('b'))
        expectNoRootFocus(rootFocus)
    })

    test('the History panel\'s Redo of the focused middle row\'s delete focuses the next row\'s menu button', async () => {
        install(THREE())
        await service.whenReady(A)
        await showScreen({ panel: true })
        expect(service.assetDelete(A, 'additionalAssets', [1]).ok).toBe(true)
        await settle()
        await press('studio-history-undo')
        expect(rowNames()).toEqual(['a', 'b', 'c'])
        const rootFocus = rootFocusSpies()
        moreOf('b').focus()
        await press('studio-history-redo')
        expect(rowNames()).toEqual(['a', 'c'])
        expect(document.activeElement).toBe(moreOf('c'))
        expectNoRootFocus(rootFocus)
    })

    test('the History panel\'s Redo of the only row\'s delete focuses the list, and its Redo of the last row\'s focuses the previous', async () => {
        install([assetRow('a', 'assets/a.png'), assetRow('b', 'assets/b.png')])
        await service.whenReady(A)
        await showScreen({ panel: true })
        expect(service.assetDelete(A, 'additionalAssets', [1]).ok).toBe(true)
        await settle()
        await press('studio-history-undo')
        const rootFocus = rootFocusSpies()
        moreOf('b').focus()
        await press('studio-history-redo')
        expect(document.activeElement).toBe(moreOf('a'))
        expect(service.assetDelete(A, 'additionalAssets', [0]).ok).toBe(true)
        await settle()
        await press('studio-history-undo')
        expect(rowNames()).toEqual(['a'])
        moreOf('a').focus()
        await press('studio-history-redo')
        expect(rowNames()).toEqual([])
        expect(document.activeElement).toBe(part('studio-asset-list'))
        expectNoRootFocus(rootFocus)
    })
})

describe('a name field that is removed with its row, with the browser\'s removal events', () => {
    test('uncommitted text in the removed row\'s field renames no other row', async () => {
        install(THREE())
        await service.whenReady(A)
        await showList()
        const field = nameField(rowOf('a'))
        field.focus()
        field.value = 'typed'
        expect(service.assetDelete(A, 'additionalAssets', [0]).ok).toBe(true)
        await settle()
        expect(rowNames()).toEqual(['b', 'c'])
    })

    test('uncommitted text in a removed row\'s field renames no other row that has the same name', async () => {
        install([assetRow('n', 'assets/p.png'), assetRow('n', 'assets/q.png'), assetRow('c', 'assets/c.png')])
        await service.whenReady(A)
        await showList()
        const field = nameField(parts('studio-asset-row')[0])
        field.focus()
        field.value = 'typed'
        expect(service.assetDelete(A, 'additionalAssets', [0]).ok).toBe(true)
        await settle()
        expect(rowNames()).toEqual(['n', 'c'])
    })
})
