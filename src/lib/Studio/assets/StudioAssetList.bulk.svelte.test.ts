// @vitest-environment jsdom
/**
 * Bulk selection of the Studio asset list over the real history service on the memory doubles: what is selected and
 * when it clears, what each bulk action does and says, the lines that follow a delete, and the preview actions. Feature
 * guards: none of this exists at the stage's base.
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
        'studioAssetFilterEmpty', 'studioAssetSelectedCount', 'studioAssetDeletedMany', 'studioAssetStillUsed', 'studioAssetModuleNowShows', 'studioStepAssetMove',
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
import type { UsedInPort } from '../../../ts/studio/assets/assetPresentation'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, type ClaimDouble } from '../../../ts/studio/history/tests/studioStoreDoubles'
import { assetRow } from '../../../ts/studio/assets/assetFixtures.test-helpers'
import StudioAssetList, { setSessionAssetSizeJobForTests, type EnabledModuleAssets } from './StudioAssetList.svelte'

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
    prebuiltAssetExclude?: string[]
}

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

const sixRows = () => [
    assetRow('smile', 'assets/smile.png'), assetRow('grin', 'assets/grin.png'), assetRow('frown', 'assets/frown.png'),
    assetRow('hat', 'assets/hat.png'), assetRow('cape', 'assets/cape.png'), assetRow('boots', 'assets/boots.png'),
]

function makeCharacter(additionalAssets: string[][], extentions: Record<string, unknown> = {}): LiveCharacter {
    return { chaId: 'A', type: 'character', desc: 'd0', alternateGreetings: [], chats: [{ id: 'c1', note: '' }], chatPage: 0, additionalAssets, emotionImages: [], extentions }
}

let service: OwnerHistoryService
let toastHost: ToastHost
let claim: ClaimDouble
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
const boxOf = (name: string) => rowOf(name).querySelector('[data-part="studio-asset-select"]') as HTMLInputElement
const rowNames = () => db.db.characters[0].additionalAssets.map((row) => row[0])
const countText = () => part('studio-asset-selected-count')?.textContent

async function click(element: HTMLElement): Promise<void> {
    element.click()
    await settle()
}

async function tick(...names: string[]): Promise<void> {
    for (const name of names) await click(boxOf(name))
}

async function filterBy(text: string): Promise<void> {
    const field = part('studio-asset-filter') as HTMLInputElement
    field.value = text
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
}

async function startSelecting(): Promise<void> {
    await click(part('studio-asset-select-toggle'))
}

beforeEach(async () => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    setSessionAssetSizeJobForTests(noSizes)
    db.db.useAdditionalAssetsPreview = false
    db.db.characters = [makeCharacter(sixRows())]
    selection.selId = 0
    studioScreen.chaId = 'A'
    toastHost = createToastHost({ clock: { now: () => 0, after: () => () => {} } satisfies ToastClock })
    claim = createClaimDouble()
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim,
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

describe('the selection', () => {
    test('shows checkboxes and the bar only while selecting, and a count that follows the ticks', async () => {
        await show()
        expect(parts('studio-asset-select')).toHaveLength(0)
        expect(parts('studio-asset-bulkbar')).toHaveLength(0)
        await startSelecting()
        expect(parts('studio-asset-select')).toHaveLength(6)
        expect(countText()).toBe('studioAssetSelectedCount(0)')
        await tick('smile', 'grin', 'frown')
        expect(countText()).toBe('studioAssetSelectedCount(3)')
        await tick('grin')
        expect(countText()).toBe('studioAssetSelectedCount(2)')
    })

    test('clears when the filter changes, so a delete after typing removes nothing that is hidden', async () => {
        await show()
        await startSelecting()
        await tick('smile', 'grin', 'frown')
        await filterBy('hat')
        expect(countText()).toBe('studioAssetSelectedCount(0)')
        // Back to everything: the earlier ticks are gone, not just hidden.
        await filterBy('')
        expect(countText()).toBe('studioAssetSelectedCount(0)')
        expect(parts('studio-asset-select').filter((box) => (box as HTMLInputElement).checked)).toHaveLength(0)
        await filterBy('a')
        await click(part('studio-asset-select-all'))
        await click(part('studio-asset-bulk-delete'))
        expect(rowNames()).toEqual(['smile', 'grin', 'frown', 'boots'])
    })

    test('clears when select mode ends', async () => {
        await show()
        await startSelecting()
        await tick('smile')
        await startSelecting()
        await startSelecting()
        expect(countText()).toBe('studioAssetSelectedCount(0)')
    })

    test('keeps the rows of two identical entries apart by their order', async () => {
        db.db.characters = [makeCharacter([assetRow('twin', 'assets/twin.png'), assetRow('twin', 'assets/twin.png'), assetRow('other', 'assets/other.png')])]
        await show()
        await startSelecting()
        const twins = parts('studio-asset-row').filter((row) => (row.querySelector('[data-part="studio-asset-name"]') as HTMLInputElement).value === 'twin')
        await click(twins[1].querySelector('[data-part="studio-asset-select"]') as HTMLElement)
        expect(countText()).toBe('studioAssetSelectedCount(1)')
        const checked = parts('studio-asset-select').map((box) => (box as HTMLInputElement).checked)
        expect(checked).toEqual([false, true, false])
        await click(part('studio-asset-bulk-delete'))
        expect(rowNames()).toEqual(['twin', 'other'])
    })

    test('drops a row the list deleted itself, and an Undo does not bring the tick back', async () => {
        await show()
        await startSelecting()
        await tick('smile', 'grin')
        ;(rowOf('smile').querySelector('[data-part="studio-asset-row-more"]') as HTMLElement).click()
        await settle()
        await click(rowOf('smile').querySelector('[data-part="studio-asset-menu-delete"]') as HTMLElement)
        expect(countText()).toBe('studioAssetSelectedCount(1)')
        const undone = await service.replay(A, { kind: 'undo' })
        expect(undone.ok).toBe(true)
        await settle()
        expect(rowNames()).toContain('smile')
        expect(boxOf('smile').checked).toBe(false)
        expect(countText()).toBe('studioAssetSelectedCount(1)')
    })

    test('a row that vanishes by a step and returns by its Undo, with no list action between, is ticked again', async () => {
        // The accepted limitation: only the list's own handlers prune the ticks, so a row that leaves and comes back under
        // the same key returns ticked. The checkbox is visible, so nothing is acted on unseen.
        await show()
        await startSelecting()
        await tick('smile')
        expect(service.assetDelete(A, 'additionalAssets', [0]).ok).toBe(true)
        await settle()
        expect(countText()).toBe('studioAssetSelectedCount(0)')
        expect((await service.replay(A, { kind: 'undo' })).ok).toBe(true)
        await settle()
        expect(boxOf('smile').checked).toBe(true)
        expect(countText()).toBe('studioAssetSelectedCount(1)')
    })
})

describe('a bulk delete', () => {
    test('is one step with one toast, bound to that step, and Undo puts every row back', async () => {
        await show()
        await startSelecting()
        await tick('smile', 'grin', 'frown')
        const replay = vi.spyOn(service, 'replay')
        await click(part('studio-asset-bulk-delete'))
        expect(rowNames()).toEqual(['hat', 'cape', 'boots'])
        expect(service.view(A).done.map((step) => step.label)).toEqual([{ kind: 'assetDelete', count: 3, name: null }])
        expect(toastHost.visible.map((toast) => toast.text)).toEqual(['studioAssetDeletedMany(3)'])
        expect(countText()).toBe('studioAssetSelectedCount(0)')
        await toastHost.activate(toastHost.visible[0].id)
        await settle()
        expect(replay.mock.calls[0][1]).toEqual({ kind: 'undo', expectTop: service.view(A).done[0]?.id ?? service.view(A).undone[0].id })
        expect(rowNames().sort()).toEqual(['boots', 'cape', 'frown', 'grin', 'hat', 'smile'])
    })

    test('says how many of the removed names are still used in text, with Show for the first', async () => {
        const shown: string[] = []
        const usedIn: UsedInPort = {
            usedText: (name) => (name === 'smile' || name === 'grin' ? '2 places' : null),
            showUsed: (name) => { shown.push(name) },
            renamedNote: () => null,
            showRenamed: () => {},
        }
        await show({ usedIn })
        await startSelecting()
        await tick('smile', 'grin', 'frown')
        await click(part('studio-asset-bulk-delete'))
        expect(toastHost.visible[0].sub).toBe('studioAssetStillUsed(2)')
        expect(part('studio-asset-bulk-note').textContent).toContain('studioAssetStillUsed(2)')
        await click(part('studio-asset-bulk-show'))
        expect(shown).toEqual(['smile'])
    })

    test('adds no line when no removed name is used in text', async () => {
        await show({ usedIn: { usedText: () => null, showUsed: () => {}, renamedNote: () => null, showRenamed: () => {} } satisfies UsedInPort })
        await startSelecting()
        await tick('smile')
        await click(part('studio-asset-bulk-delete'))
        expect(toastHost.visible[0].sub).toBeUndefined()
        expect(parts('studio-asset-bulk-note')).toHaveLength(0)
    })

    test('is refused as one whole, with the refusal shown and every row kept', async () => {
        claim = createClaimDouble()
        claim.forced = 'held'
        service = createOwnerHistoryService({ store: createMemoryStudioStore(), claim, clock: createFakeClock(), pageSession: 'p2', registerLeaveFlush: () => () => {}, onLanded: retireAssetToasts })
        setStudioHistoryServiceForTests(service)
        await service.whenReady(A)
        await show()
        await startSelecting()
        await tick('smile', 'grin')
        await click(part('studio-asset-bulk-delete'))
        expect(part('studio-asset-refusal').textContent).toBe('studioAssetRefusalOtherTabCharacter')
        expect(rowNames()).toHaveLength(6)
        expect(toastHost.visible).toHaveLength(0)
        expect(countText()).toBe('studioAssetSelectedCount(2)')
    })
})

describe('the line about a module\'s picture', () => {
    const module: EnabledModuleAssets = { id: 'm1', name: 'Props pack', assets: [['smile', 'assets/m-smile.png', 'png']] }
    const modules = () => [{ id: 'm0', name: 'Empty pack', assets: [] }, module]

    async function deleteFromMenu(name: string, index = 0): Promise<void> {
        const row = parts('studio-asset-row').filter((candidate) => (candidate.querySelector('[data-part="studio-asset-name"]') as HTMLInputElement).value === name)[index]
        ;(row.querySelector('[data-part="studio-asset-row-more"]') as HTMLElement).click()
        await settle()
        await click(row.querySelector('[data-part="studio-asset-menu-delete"]') as HTMLElement)
    }

    test('is absent while another row of the name stays, and shown when the last one goes', async () => {
        db.db.characters = [makeCharacter([assetRow('smile', 'assets/s1.png'), assetRow('Smile', 'assets/s2.png'), assetRow('grin', 'assets/grin.png')])]
        await show({ enabledModules: modules })
        await deleteFromMenu('smile')
        expect(toastHost.visible[0].sub).toBeUndefined()
        await deleteFromMenu('Smile')
        expect(toastHost.visible[0].sub).toBe("studioAssetModuleNowShows(Smile,Props pack)")
    })

    test('is absent when no enabled module holds the name, and when no module port is given', async () => {
        await show({ enabledModules: modules })
        await deleteFromMenu('grin')
        expect(toastHost.visible[0].sub).toBeUndefined()
    })

    test('comes with a bulk delete that removes every row of the name, and not when one stays', async () => {
        db.db.characters = [makeCharacter([assetRow('smile', 'assets/s1.png'), assetRow('smile', 'assets/s2.png'), assetRow('grin', 'assets/grin.png')])]
        await show({ enabledModules: modules })
        await startSelecting()
        const boxes = parts('studio-asset-select')
        await click(boxes[0])
        await click(part('studio-asset-bulk-delete'))
        expect(toastHost.visible[0].sub).toBeUndefined()
        await click(part('studio-asset-select-all'))
        await click(part('studio-asset-bulk-delete'))
        expect(toastHost.visible[0].sub).toBe('studioAssetModuleNowShows(smile,Props pack)')
    })
})

describe('the bulk preview action', () => {
    test('exists only while the preview setting is on', async () => {
        await show()
        await startSelecting()
        expect(parts('studio-asset-bulk-preview')).toHaveLength(0)
    })

    test('leaves the picked rows out of the preview and then includes them, as one write with no history step', async () => {
        db.db.useAdditionalAssetsPreview = true
        await show()
        await startSelecting()
        await tick('smile', 'grin')
        const button = part('studio-asset-bulk-preview')
        expect(button.textContent).toBe('studioAssetHideFromPreview')
        const marks = h.marks
        await click(button)
        expect(db.db.characters[0].prebuiltAssetExclude).toEqual(['assets/smile.png', 'assets/grin.png'])
        expect(h.marks).toBe(marks + 1)
        expect(service.view(A).done).toHaveLength(0)
        expect(part('studio-asset-bulk-preview').textContent).toBe('studioAssetShowInPreview')
        await click(part('studio-asset-bulk-preview'))
        expect(db.db.characters[0].prebuiltAssetExclude).toEqual([])
    })

    test('does not repeat a path that is already left out', async () => {
        db.db.useAdditionalAssetsPreview = true
        db.db.characters = [{ ...makeCharacter(sixRows()), prebuiltAssetExclude: ['assets/smile.png'] }]
        await show()
        await startSelecting()
        await tick('smile', 'grin')
        await click(part('studio-asset-bulk-preview'))
        expect(db.db.characters[0].prebuiltAssetExclude).toEqual(['assets/smile.png', 'assets/grin.png'])
    })
})

describe('the bulk move', () => {
    test('puts the picked names in one folder as one step with one toast', async () => {
        db.db.characters = [makeCharacter(sixRows(), { [ASSET_FOLDER_KEY]: { v: 1, additional: { order: ['Poses'], of: [] } } })]
        await show()
        await startSelecting()
        await tick('smile', 'grin')
        await click(part('studio-asset-bulk-move'))
        await click(parts('studio-asset-bulk-move-choice').find((choice) => choice.dataset.folder === 'Poses') as HTMLElement)
        const stored = db.db.characters[0].extentions[ASSET_FOLDER_KEY] as { additional: { of: [string, string][] } }
        expect(Object.fromEntries(stored.additional.of)).toEqual({ smile: 'Poses', grin: 'Poses' })
        expect(service.view(A).done.map((step) => step.label)).toEqual([{ kind: 'assetMove', count: 2, folder: 'Poses' }])
        expect(toastHost.visible.map((toast) => toast.text)).toEqual(['studioStepAssetMove(2,Poses)'])
    })

    test('is off while nothing is picked', async () => {
        await show()
        await startSelecting()
        expect((part('studio-asset-bulk-delete') as HTMLButtonElement).disabled).toBe(true)
        expect((part('studio-asset-bulk-move') as HTMLButtonElement).disabled).toBe(true)
    })
})
