// @vitest-environment jsdom
/**
 * The Studio emotion-image list: rows, filter, rename, single delete, the empty state, the pause line, and the rule that
 * every write addresses the stored row, whatever the filter shows. The history service is real, on the memory doubles.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    marks: 0,
    cleared: [] as string[],
    held: new Set<string>(),
    releases: new Map<string, (() => void)[]>(),
}))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    getFileSrc: async (path: string) => {
        if (h.held.has(path)) await new Promise<void>((resolve) => h.releases.set(path, [...(h.releases.get(path) ?? []), resolve]))
        return `blob:${path}`
    },
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
        clearCharEmotionCache: (chaId: string) => { h.cleared.push(chaId) },
    }
})
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const call = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const table: Record<string, unknown> = { sidebarUi: { noAssets: 'noAssets' } }
    for (const key of ['studioAssetRowMenu', 'studioAssetDeletedOne', 'studioEmotionFilterEmpty', 'studioAssetSelectedCount']) table[key] = call(key)
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
    license?: string
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
const pP = hashPath('p', 'png')
const pQ = hashPath('q', 'png')
const pM = hashPath('m', 'mp4')

// The asset rows are as many as the emotion indexes the tests use, so a write to the wrong array shows.
const ASSET_ROWS = (): string[][] => [assetRow('a0', hashPath('x', 'png')), assetRow('a1', hashPath('y', 'png')), assetRow('a2', hashPath('z', 'png')), assetRow('a3', hashPath('w', 'png'))]

function makeCharacter(emotionImages: string[][], over: Partial<LiveCharacter> = {}): LiveCharacter {
    return {
        chaId: 'A',
        type: 'character',
        desc: 'd0',
        alternateGreetings: ['g0'],
        chats: [{ id: 'c1', note: 'n0', fmIndex: 2 }],
        chatPage: 0,
        additionalAssets: ASSET_ROWS(),
        emotionImages,
        ...over,
    }
}

const THREE = (): string[][] => [['happy', pA], ['sad', pB], ['hat', pC]]

let rig: { claim: ClaimDouble, service: OwnerHistoryService }
let toastHost: ToastHost
let mounted: { app: ReturnType<typeof mount>, host: HTMLElement }[] = []
let removeShim: (() => void) | undefined
let pageCount = 0

function makeRig(configure?: (claim: ClaimDouble) => void): void {
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
}

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
    await drainMicrotasks()
}

async function show(props: Record<string, unknown> = {}, chaId = 'A'): Promise<HTMLElement> {
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push({ app: mount(StudioEmotionList, { target: host, props: { chaId, host: toastHost, ...props } }), host })
    flushSync()
    await settle()
    return host
}

async function install(emotions: string[][], over: Partial<LiveCharacter> = {}, configure?: (claim: ClaimDouble) => void): Promise<void> {
    db.db.characters = [makeCharacter(emotions, over)]
    makeRig(configure)
    await rig.service.whenReady(A)
}

const parts = (name: string, from: ParentNode = document) => Array.from(from.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const part = (name: string): HTMLElement | null => parts(name)[0] ?? null
const live = () => db.db.characters[0]
const emotions = (): string[][] => JSON.parse(JSON.stringify(live().emotionImages))
const assetsOf = (): string[][] => JSON.parse(JSON.stringify(live().additionalAssets))
const nameField = (row: HTMLElement) => row.querySelector('[data-part="studio-asset-name"]') as HTMLInputElement
const rowOf = (name: string): HTMLElement => parts('studio-asset-row').find((row) => nameField(row).value === name) as HTMLElement
const moreOf = (name: string) => rowOf(name).querySelector('[data-part="studio-asset-row-more"]') as HTMLElement
const shownNames = (): string[] => parts('studio-asset-row').map((row) => nameField(row).value)
const section = () => part('studio-emotion-list') as HTMLElement

function type(field: HTMLInputElement, value: string): void {
    field.focus()
    field.value = value
}

function key(field: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    field.dispatchEvent(event)
    return event
}

function typeFilter(text: string): void {
    const field = part('studio-emotion-filter') as HTMLInputElement
    field.value = text
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

// Types `to` into the field of the row named `from` and commits it by blur or Enter.
async function renameRow(from: string, to: string, how: 'blur' | 'enter' = 'blur'): Promise<void> {
    const field = nameField(rowOf(from))
    type(field, to)
    if (how === 'enter') key(field, { key: 'Enter' })
    else field.blur()
    await settle()
}

async function openMenu(name: string): Promise<void> {
    moreOf(name).click()
    await settle()
}

async function deleteRow(name: string): Promise<void> {
    await openMenu(name)
    ;(rowOf(name).querySelector('[data-part="studio-asset-menu-delete"]') as HTMLElement).click()
    await settle()
}

const doneOf = () => rig.service.view(A).done

beforeEach(() => {
    h.marks = 0
    h.cleared.length = 0
    h.held.clear()
    h.releases.clear()
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
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

describe('what the list shows', () => {
    test('U1: a row has its thumbnail, meta, name field and a menu with Delete only; the section is a focus target with the help lines', async () => {
        await install(THREE())
        await show()
        expect(section().getAttribute('tabindex')).toBe('-1')
        expect(part('studio-emotion-list')?.querySelector('h3')?.textContent).toBe('emotionImage')
        expect(part('studio-emotion-help')?.textContent).toBe('studioEmotionHelp')
        expect(part('studio-emotion-rename-note')?.textContent).toBe('studioEmotionRenameNote')
        expect(shownNames()).toEqual(['happy', 'sad', 'hat'])
        expect(parts('studio-thumb').map((image) => image.getAttribute('alt'))).toEqual(['happy', 'sad', 'hat'])
        expect(parts('studio-asset-meta').map((meta) => meta.textContent)).toEqual(['png', 'png', 'png'])
        for (const control of ['studio-asset-add', 'studio-asset-folder', 'studio-asset-new-folder', 'studio-asset-select']) {
            expect(parts(control)).toHaveLength(0)
        }
        await openMenu('sad')
        const items = Array.from(rowOf('sad').querySelectorAll<HTMLElement>('[role="menuitem"]'))
        expect(items.map((item) => item.dataset.part)).toEqual(['studio-asset-menu-delete'])
    })

    test('U1: a file the list cannot show as an image is a type tile with no Preview item', async () => {
        await install([['clip', pM], ['happy', pA]])
        await show()
        expect(rowOf('clip').querySelector('[data-part="studio-asset-tile"]')).not.toBeNull()
        expect(rowOf('clip').querySelector('[data-part="studio-thumb"]')).toBeNull()
        await openMenu('clip')
        expect(parts('studio-asset-menu-preview')).toHaveLength(0)
    })

    test('U1: the menu opens on its first item, and Esc closes it and hands focus back to the row\'s trigger', async () => {
        await install(THREE())
        await show()
        await openMenu('sad')
        expect(document.activeElement).toBe(rowOf('sad').querySelector('[data-part="studio-asset-menu-delete"]'))
        key(document.activeElement as HTMLElement, { key: 'Escape' })
        await settle()
        expect(parts('studio-row-menu')).toHaveLength(0)
        expect(document.activeElement).toBe(moreOf('sad'))
    })

    test('U7: with no emotion image the list says so and points to the classic editor, with no filter and no Add', async () => {
        await install([])
        await show()
        expect(part('studio-emotion-empty')?.textContent).toContain('studioEmotionEmpty')
        expect(part('studio-emotion-empty')?.textContent).toContain('studioEmotionEmptyHint')
        expect(parts('studio-emotion-filter')).toHaveLength(0)
        expect(section().querySelectorAll('button')).toHaveLength(0)
    })

    test('U8: every row sits in its own li directly inside the rows list', async () => {
        await install(THREE())
        await show()
        const list = part('studio-emotion-rows') as HTMLElement
        const rows = parts('studio-asset-row', section())
        expect(rows).toHaveLength(3)
        expect(list.children).toHaveLength(3)
        for (const row of rows) {
            const item = row.parentElement as HTMLElement
            expect(item.tagName).toBe('LI')
            expect(item.parentElement).toBe(list)
            expect(item.children).toHaveLength(1)
        }
    })

    test.each([
        ['a private character', { license: 'private' }, 'A'],
        ['a group', { type: 'group' }, 'A'],
        ['a character that is not there', {}, 'Z'],
    ])('U6: %s shows no list', async (_label, over, chaId) => {
        await install(THREE(), over)
        await show({}, chaId)
        expect(parts('studio-emotion-list')).toHaveLength(0)
    })

    test('U6: a private character shows no list even when the service does not call its owner restricted', async () => {
        await install(THREE(), { license: 'private' })
        const real = rig.service.view.bind(rig.service)
        vi.spyOn(rig.service, 'view').mockImplementation((owner) => ({ ...real(owner), restricted: false }))
        await show()
        expect(parts('studio-emotion-list')).toHaveLength(0)
    })

    test('U6: a restricted owner shows no list', async () => {
        await install(THREE())
        const real = rig.service.view.bind(rig.service)
        vi.spyOn(rig.service, 'view').mockImplementation((owner) => ({ ...real(owner), restricted: true }))
        await show()
        expect(parts('studio-emotion-list')).toHaveLength(0)
    })
})

describe('the filter', () => {
    test('U2: keeps the rows whose name matches, trimmed and in any case, and never matches a path', async () => {
        await install(THREE())
        await show()
        typeFilter('ha')
        expect(shownNames()).toEqual(['happy', 'hat'])
        typeFilter(' HA ')
        expect(shownNames()).toEqual(['happy', 'hat'])
        typeFilter('assets')
        expect(shownNames()).toEqual([])
        expect(part('studio-emotion-filter-empty')?.textContent).toBe('studioEmotionFilterEmpty(assets)')
    })

    test('U2: clearing the filter brings every row back with its thumbnail', async () => {
        await install(THREE())
        await show()
        typeFilter('ha')
        typeFilter('')
        await settle()
        expect(shownNames()).toEqual(['happy', 'sad', 'hat'])
        expect(parts('studio-thumb').map((image) => image.getAttribute('src'))).toEqual([`blob:${pA}`, `blob:${pB}`, `blob:${pC}`])
        expect(parts('studio-emotion-filter-empty')).toHaveLength(0)
    })
})

describe('renaming', () => {
    test('U3: Enter and blur each commit one rename step in the emotion array, on the same node, with no text rewritten', async () => {
        await install(THREE())
        await show()
        const node = rowOf('sad')
        type(nameField(node), 'gloomy')
        const event = key(nameField(node), { key: 'Enter' })
        await settle()
        expect(event.defaultPrevented).toBe(true)
        expect(doneOf()).toHaveLength(1)
        expect(doneOf()[0].label).toEqual({ kind: 'assetRename', from: 'sad', to: 'gloomy' })
        expect(doneOf()[0].ops.map((op) => op.op)).not.toContain('textEdit')
        expect(emotions()[1]).toEqual(['gloomy', pB])
        expect(rowOf('gloomy')).toBe(node)
        expect(assetsOf()).toEqual(ASSET_ROWS())
        await renameRow('hat', 'cap')
        expect(emotions()).toEqual([['happy', pA], ['gloomy', pB], ['cap', pC]])
        expect(doneOf()).toHaveLength(2)
        expect(assetsOf()).toEqual(ASSET_ROWS())
    })

    test('U3a: a blank name is refused with its message and the old name back; the next valid rename clears the message; padding is stored as typed', async () => {
        await install(THREE())
        await show()
        for (const blank of ['', '   ']) {
            await renameRow('sad', blank)
            expect(nameField(rowOf('sad')).value).toBe('sad')
            expect(part('studio-emotion-refusal')?.textContent).toBe('studioEmotionNameBlank')
            expect(doneOf()).toHaveLength(0)
        }
        await renameRow('sad', ' gloomy ')
        expect(parts('studio-emotion-refusal')).toHaveLength(0)
        expect(emotions()[1]).toEqual([' gloomy ', pB])
        expect(doneOf()).toHaveLength(1)
    })

    test('U3b: a name another row already holds lands, in either case', async () => {
        await install(THREE())
        await show()
        await renameRow('sad', 'Happy')
        await renameRow('hat', 'happy')
        expect(emotions()).toEqual([['happy', pA], ['Happy', pB], ['happy', pC]])
        expect(doneOf()).toHaveLength(2)
        expect(parts('studio-emotion-refusal')).toHaveLength(0)
    })

    test('U3c: a refused rename shows the refusal, puts the name back and writes nothing', async () => {
        await install(THREE())
        await show()
        studioScreen.chaId = 'B'
        await renameRow('sad', 'gloomy')
        expect(nameField(rowOf('sad')).value).toBe('sad')
        expect(part('studio-emotion-refusal')?.textContent).toBe('studioRefusalNotSelected')
        expect(emotions()).toEqual(THREE())
        expect(doneOf()).toHaveLength(0)
    })

    test('U3d: a rename that landed nothing posts no toast and leaves the field on the old name', async () => {
        await install(THREE())
        await show()
        vi.spyOn(rig.service, 'assetRename').mockReturnValue({ ok: true, unchanged: true })
        await renameRow('sad', 'gloomy', 'enter')
        expect(toastHost.visible).toHaveLength(0)
        expect(nameField(rowOf('sad')).value).toBe('sad')
        expect(parts('studio-asset-renamed-note')).toHaveLength(0)
    })

    test('U4b: with a filter, a rename of the shown row writes the stored row, and undo restores it', async () => {
        await install([['sad', pB], ['happy', pA], ['smile', pC]])
        await show()
        typeFilter('s')
        expect(shownNames()).toEqual(['sad', 'smile'])
        await renameRow('smile', 'grin')
        expect(emotions()).toEqual([['sad', pB], ['happy', pA], ['grin', pC]])
        expect(rig.service.undo(A)).toEqual({ ok: true })
        await settle()
        expect(emotions()).toEqual([['sad', pB], ['happy', pA], ['smile', pC]])
    })
})

describe('deleting one row', () => {
    test('U4: is one step with the file retained, a toast whose Undo is the step, and the emotion cache cleared once', async () => {
        await install(THREE())
        await show()
        await deleteRow('happy')
        expect(emotions()).toEqual([['sad', pB], ['hat', pC]])
        expect(doneOf()).toHaveLength(1)
        expect(doneOf()[0].label).toEqual({ kind: 'assetDelete', count: 1, name: 'happy' })
        expect(retainedNamesOf(live()[ASSET_RETAINED_KEY])).toEqual([pA])
        expect(h.cleared).toEqual(['A'])
        expect(assetsOf()).toEqual(ASSET_ROWS())
        expect(toastHost.visible).toHaveLength(1)
        expect(toastHost.visible[0].text).toBe('studioAssetDeletedOne(happy)')
        await toastHost.activate(toastHost.visible[0].id)
        await settle()
        expect(emotions()).toEqual(THREE())
    })

    test('U4: focus goes to the next row\'s trigger, the previous one when the last row went, and the list when the only row went', async () => {
        await install(THREE())
        await show()
        await deleteRow('happy')
        expect(document.activeElement).toBe(moreOf('sad'))
        await deleteRow('hat')
        expect(document.activeElement).toBe(moreOf('sad'))
        await deleteRow('sad')
        expect(shownNames()).toEqual([])
        expect(document.activeElement).toBe(section())
    })

    test('U4: after an undo the restored row\'s trigger holds focus, and a redo hands focus to the next row\'s trigger', async () => {
        await install(THREE())
        await show()
        await deleteRow('sad')
        expect(rig.service.undo(A)).toEqual({ ok: true })
        await settle()
        moreOf('sad').focus()
        expect(rig.service.redo(A)).toEqual({ ok: true })
        await settle()
        expect(shownNames()).toEqual(['happy', 'hat'])
        expect(document.activeElement).toBe(moreOf('hat'))
    })

    test('U4: focus elsewhere in the list stays where it is when rows are removed', async () => {
        await install(THREE())
        await show()
        const filter = part('studio-emotion-filter') as HTMLInputElement
        moreOf('sad').focus()
        filter.focus()
        expect(rig.service.assetDelete(A, 'emotionImages', [0]).ok).toBe(true)
        await settle()
        expect(document.activeElement).toBe(filter)
    })

    test('U4: a row whose focus left the list for the page moves nothing when another row is removed', async () => {
        await install(THREE())
        await show()
        moreOf('happy').focus()
        ;(document.activeElement as HTMLElement).blur()
        await settle()
        expect(document.activeElement).toBe(document.body)
        expect(rig.service.assetDelete(A, 'emotionImages', [2]).ok).toBe(true)
        await settle()
        expect(document.activeElement).toBe(document.body)
    })

    test('U4: a blank-name refusal is cleared by the delete that follows', async () => {
        await install(THREE())
        await show()
        await renameRow('sad', '')
        expect(part('studio-emotion-refusal')).not.toBeNull()
        await deleteRow('hat')
        expect(parts('studio-emotion-refusal')).toHaveLength(0)
    })

    test('U4b: with a filter, a delete of the shown row removes the stored row, and undo restores the whole array', async () => {
        await install([['sad', pB], ['happy', pA], ['smile', pC]])
        await show()
        typeFilter('s')
        await deleteRow('smile')
        expect(emotions()).toEqual([['sad', pB], ['happy', pA]])
        expect(retainedNamesOf(live()[ASSET_RETAINED_KEY])).toEqual([pC])
        expect(toastHost.visible[0].text).toBe('studioAssetDeletedOne(smile)')
        await toastHost.activate(toastHost.visible[0].id)
        await settle()
        expect(emotions()).toEqual([['sad', pB], ['happy', pA], ['smile', pC]])
    })

    test('U5: a refused delete shows the refusal, keeps the row and its place, and leaves focus on the row\'s trigger', async () => {
        await install(THREE(), {}, (claim) => { claim.unsupported = true })
        await show()
        expect(parts('studio-emotion-paused')).toHaveLength(0)
        await deleteRow('sad')
        expect(part('studio-emotion-refusal')?.textContent).toBe('studioAssetRefusalNoUndo')
        expect(emotions()).toEqual(THREE())
        expect(doneOf()).toHaveLength(0)
        expect(toastHost.visible).toHaveLength(0)
        expect(document.activeElement).toBe(moreOf('sad'))
    })

    test('U20: while editing is off the pause line comes first, fields are read-only and Delete is disabled; it goes when editing is on', async () => {
        await install(THREE())
        const gate = $state({ editable: false })
        const real = rig.service.view.bind(rig.service)
        vi.spyOn(rig.service, 'view').mockImplementation((owner) => ({ ...real(owner), editable: gate.editable }))
        await show()
        expect(section().children[1]).toBe(part('studio-emotion-paused'))
        expect(section().getAttribute('aria-busy')).toBe('true')
        expect(nameField(rowOf('sad')).readOnly).toBe(true)
        await openMenu('sad')
        expect((rowOf('sad').querySelector('[data-part="studio-asset-menu-delete"]') as HTMLButtonElement).disabled).toBe(true)
        // With rows ticked, bulk Delete stays disabled while editing is off.
        ;(part('studio-asset-select-toggle') as HTMLElement).click()
        await settle()
        const all = part('studio-asset-select-all') as HTMLInputElement
        all.checked = true
        all.dispatchEvent(new Event('change', { bubbles: true }))
        await settle()
        expect(part('studio-asset-selected-count')?.textContent).toBe('studioAssetSelectedCount(3)')
        expect((part('studio-asset-bulk-delete') as HTMLButtonElement).disabled).toBe(true)
        gate.editable = true
        await settle()
        expect(parts('studio-emotion-paused')).toHaveLength(0)
        expect(section().hasAttribute('aria-busy')).toBe(false)
        expect(nameField(rowOf('sad')).readOnly).toBe(false)
    })
})

describe('a name field that is removed with its row, with the browser\'s removal events', () => {
    test('U4c (i): uncommitted text in the removed row\'s field renames no other row', async () => {
        removeShim = installChromiumFocusRemoval()
        await install([['happy', pA], ['sad', pB], ['smile', pC]])
        await show()
        type(nameField(rowOf('happy')), 'typed')
        expect(rig.service.assetDelete(A, 'emotionImages', [0]).ok).toBe(true)
        await settle()
        expect(emotions()).toEqual([['sad', pB], ['smile', pC]])
        expect(doneOf()).toHaveLength(1)
    })

    test('U4c (ii): the same holds when the row that moved up has the removed row\'s name', async () => {
        removeShim = installChromiumFocusRemoval()
        await install([['n', pP], ['n', pQ], ['c', pC]])
        await show()
        type(nameField(parts('studio-asset-row')[0]), 'typed')
        expect(rig.service.assetDelete(A, 'emotionImages', [0]).ok).toBe(true)
        await settle()
        expect(emotions()).toEqual([['n', pQ], ['c', pC]])
        expect(doneOf()).toHaveLength(1)
    })

    test('U4c (iii): a row a rename hides from the filter is not renamed again by its field\'s own blur', async () => {
        removeShim = installChromiumFocusRemoval()
        await install(THREE())
        await show()
        typeFilter('ha')
        type(nameField(rowOf('hat')), 'typed')
        expect(rig.service.assetRename(A, 'emotionImages', 2, 'cap').ok).toBe(true)
        await settle()
        expect(emotions()).toEqual([['happy', pA], ['sad', pB], ['cap', pC]])
        expect(doneOf()).toHaveLength(1)
    })
})

describe('the used-in port', () => {
    const port = (note: { text: string, action: string } | null): UsedInPort => ({
        usedText: (name) => `${name} used 2`,
        showUsed: vi.fn(),
        renamedNote: vi.fn(() => note),
        showRenamed: vi.fn(),
    })

    test('U9: without a port a row has no used-in button and no renamed note', async () => {
        await install(THREE())
        await show()
        expect(parts('studio-asset-used')).toHaveLength(0)
        await renameRow('sad', 'gloomy')
        expect(parts('studio-asset-renamed-note')).toHaveLength(0)
    })

    test('U9: with a port each row shows its button, and a renamed field shows the port\'s note', async () => {
        await install(THREE())
        const usedIn = port({ text: '2 places still use the old name', action: 'Show' })
        await show({ usedIn })
        expect(parts('studio-asset-used').map((button) => button.textContent)).toEqual(['happy used 2', 'sad used 2', 'hat used 2'])
        await renameRow('sad', 'gloomy')
        expect(parts('studio-asset-renamed-note')).toHaveLength(1)
        expect(usedIn.renamedNote).toHaveBeenCalledWith('sad')
    })

    test('U9b: rows over one file keep the old-name note with the row that now holds its key after a delete', async () => {
        await install([['x', pA], ['y', pA]])
        await show({ usedIn: port({ text: 'still used', action: 'Show' }) })
        await renameRow('y', 'w')
        await deleteRow('x')
        expect(shownNames()).toEqual(['w'])
        expect(parts('studio-asset-renamed-note')).toHaveLength(1)
    })

    test('U9b: the note of a removed row does not pass to the row after it', async () => {
        await install([['x', pA], ['y', pA]])
        await show({ usedIn: port({ text: 'still used', action: 'Show' }) })
        await renameRow('x', 'z')
        expect(parts('studio-asset-renamed-note')).toHaveLength(1)
        await deleteRow('z')
        expect(shownNames()).toEqual(['y'])
        expect(parts('studio-asset-renamed-note')).toHaveLength(0)
    })
})

describe('sizes', () => {
    test('U21: the size run ends with the list, and a delete that changes the path set ends the old run and starts one for the new paths', async () => {
        await install(THREE())
        const runs: { paths: string[], signal: AbortSignal }[] = []
        const job: AssetSizeJob = {
            peek: () => undefined,
            snapshot: () => new Map<string, StoredSize>(),
            ensure: async (paths, signal) => { runs.push({ paths: [...paths], signal }); return true },
        }
        await show({ sizeJob: async () => job })
        expect(runs).toHaveLength(1)
        expect(runs[0].paths).toEqual([pA, pB, pC])
        await deleteRow('happy')
        expect(runs[0].signal.aborted).toBe(true)
        expect(runs).toHaveLength(2)
        expect(runs[1].paths).toEqual([pB, pC])
        expect(runs[1].signal.aborted).toBe(false)
        for (const entry of mounted.splice(0)) {
            await unmount(entry.app)
            entry.host.remove()
        }
        expect(runs[1].signal.aborted).toBe(true)
    })
})

describe('thumbnails', () => {
    test('U22: after a delete every remaining row shows the picture of its own file', async () => {
        await install(THREE())
        await show()
        expect(parts('studio-thumb').map((image) => image.getAttribute('src'))).toEqual([`blob:${pA}`, `blob:${pB}`, `blob:${pC}`])
        await deleteRow('happy')
        expect(shownNames()).toEqual(['sad', 'hat'])
        expect(parts('studio-thumb').map((image) => image.getAttribute('src'))).toEqual([`blob:${pB}`, `blob:${pC}`])
    })

    test('U22: a picture that settles after the delete, for the file the row at its index held before, is dropped', async () => {
        await install(THREE())
        h.held.add(pA)
        h.held.add(pB)
        await show()
        expect(parts('studio-thumb')).toHaveLength(1)
        expect(rig.service.assetDelete(A, 'emotionImages', [0]).ok).toBe(true)
        await settle()
        // The new row at index 0 asked for its own file; the old requests settle last and first.
        for (const path of [pB, pA]) {
            for (const release of h.releases.get(path) ?? []) release()
            await settle()
        }
        expect(shownNames()).toEqual(['sad', 'hat'])
        expect(parts('studio-thumb').map((image) => image.getAttribute('src'))).toEqual([`blob:${pB}`, `blob:${pC}`])
    })
})
