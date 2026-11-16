// @vitest-environment jsdom
/**
 * Deleting a row from the Studio asset list: one step with the file retained for the durable undo, an Undo toast
 * that belongs to the step, the history that survives a reload, and the refusals that change nothing. The history
 * service is real, on the memory doubles.
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
    const table: Record<string, unknown> = { sidebarUi: { noAssets: 'noAssets' } }
    for (const key of ['studioAssetEmotionsElsewhere', 'studioAssetRowMenu', 'studioAssetDeletedOne']) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { retainedNamesOf } from 'src/ts/storage/store2/lists/assetList'
import type { AssetSizeJob, StoredSize } from 'src/ts/studio/assets/assetSizes'
import { resetStudioToastsForTests, retireAssetToasts } from 'src/ts/studio/edit/studioToasts'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createToastHost, resetToastHostForTests, type ToastClock, type ToastHost } from 'src/ts/toast/toastHost.svelte'
import { ASSET_RETAINED_KEY } from '../../../ts/studio/assets/assetOwnerKeys'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, type ClaimDouble } from '../../../ts/studio/history/tests/studioStoreDoubles'
import { assetRow } from '../../../ts/studio/assets/assetFixtures.test-helpers'
import StudioAssetList, { setSessionAssetSizeJobForTests } from './StudioAssetList.svelte'

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
    [key: string]: unknown
}

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

function makeCharacter(): LiveCharacter {
    return {
        chaId: 'A',
        type: 'character',
        desc: 'd0',
        alternateGreetings: ['g0'],
        chats: [{ id: 'c1', note: 'n0', fmIndex: 2 }],
        chatPage: 0,
        additionalAssets: [assetRow('smile', 'assets/smile.png'), assetRow('grin', 'assets/grin.png'), assetRow('frown', 'assets/frown.png')],
        emotionImages: [],
    }
}

function fakeToastClock(): ToastClock {
    return { now: () => 0, after: () => () => {} }
}

interface Rig {
    clock: FakeClock
    claim: ClaimDouble
    shared: Map<string, string>
    service: OwnerHistoryService
}

let rig: Rig
let toastHost: ToastHost
let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []
let pageCount = 0

function makeRig(shared: Map<string, string> = new Map(), configure?: (claim: ClaimDouble) => void): Rig {
    const clock = createFakeClock()
    const claim = createClaimDouble()
    configure?.(claim)
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore({ shared }),
        claim,
        clock,
        pageSession: `p${++pageCount}`,
        registerLeaveFlush: () => () => {},
        onLanded: retireAssetToasts,
    })
    setStudioHistoryServiceForTests(service)
    return { clock, claim, shared, service }
}

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
    await drainMicrotasks()
}

async function show(): Promise<void> {
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push({ app: mount(StudioAssetList, { target: host, props: { chaId: 'A', host: toastHost } }), host })
    flushSync()
    await settle()
}

const parts = (name: string, from: ParentNode = document) => Array.from(from.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const rowNames = () => db.db.characters[0].additionalAssets.map((row) => row[0])
const rowOf = (name: string): HTMLElement => parts('studio-asset-row').find((row) => (row.querySelector('[data-part="studio-asset-name"]') as HTMLInputElement).value === name) as HTMLElement

async function deleteRow(name: string): Promise<void> {
    ;(rowOf(name).querySelector('[data-part="studio-asset-row-more"]') as HTMLElement).click()
    await settle()
    ;(rowOf(name).querySelector('[data-part="studio-asset-menu-delete"]') as HTMLElement).click()
    await settle()
}

beforeEach(async () => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    setSessionAssetSizeJobForTests(noSizes)
    db.db.useAdditionalAssetsPreview = false
    db.db.characters = [makeCharacter()]
    selection.selId = 0
    studioScreen.chaId = 'A'
    toastHost = createToastHost({ clock: fakeToastClock() })
    rig = makeRig()
    setStudioVisitAckForTests({ noteEdit: () => {}, dispose: () => {} } as never)
    await rig.service.whenReady(A)
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

describe('a landed delete', () => {
    test('is one assetDelete step, keeps the file for the undo and leaves the chat\'s first-message index alone', async () => {
        await show()
        const marks = h.marks
        await deleteRow('grin')
        expect(rowNames()).toEqual(['smile', 'frown'])
        const done = rig.service.view(A).done
        expect(done).toHaveLength(1)
        expect(done[0].label).toEqual({ kind: 'assetDelete', count: 1, name: 'grin' })
        expect(done[0].ops.filter((op) => op.op === 'assetRowRemove')).toHaveLength(1)
        expect(retainedNamesOf(db.db.characters[0][ASSET_RETAINED_KEY])).toEqual(['assets/grin.png'])
        expect(h.marks).toBe(marks + 1)
        expect(db.db.characters[0].chats[0].fmIndex).toBe(2)
        expect(parts('studio-asset-row')).toHaveLength(2)
    })

    test('posts a Deleted toast whose Undo is bound to the step on top, and Undo puts the row back', async () => {
        await show()
        const replay = vi.spyOn(rig.service, 'replay')
        await deleteRow('grin')
        const stepId = rig.service.view(A).done[0].id
        expect(toastHost.visible).toHaveLength(1)
        expect(toastHost.visible[0].text).toBe('studioAssetDeletedOne(grin)')
        await toastHost.activate(toastHost.visible[0].id)
        await settle()
        expect(replay).toHaveBeenCalledTimes(1)
        expect(replay.mock.calls[0][1]).toEqual({ kind: 'undo', expectTop: stepId })
        expect(rowNames()).toEqual(['smile', 'grin', 'frown'])
        expect(parts('studio-asset-row')).toHaveLength(3)
    })

    test('a later step ends the toast of the earlier one, so its Undo can never undo the wrong step', async () => {
        await show()
        await deleteRow('grin')
        expect(toastHost.visible).toHaveLength(1)
        await deleteRow('frown')
        expect(toastHost.visible).toHaveLength(1)
        expect(toastHost.visible[0].text).toBe('studioAssetDeletedOne(frown)')
    })

    test('stays reachable by Undo after a reload, and its history line is on the new page\'s record', async () => {
        await show()
        await deleteRow('grin')
        await rig.clock.advance(60_000)
        await settle()
        for (const entry of mounted.splice(0)) {
            await unmount(entry.app)
            entry.host.remove()
        }
        resetStudioToastsForTests()
        resetToastHostForTests()
        // The page is gone with its tab: the reloaded one builds a new service over what the device kept.
        rig.claim.endPage()
        db.db.characters = [{ ...makeCharacter(), additionalAssets: [assetRow('smile', 'assets/smile.png'), assetRow('frown', 'assets/frown.png')] }]
        const reloaded = makeRig(rig.shared)
        await reloaded.service.whenReady(A)
        expect(reloaded.service.view(A).done.map((step) => step.label)).toEqual([{ kind: 'assetDelete', count: 1, name: 'grin' }])
        const undone = await reloaded.service.replay(A, { kind: 'undo' })
        expect(undone.ok).toBe(true)
        expect(rowNames()).toEqual(['smile', 'grin', 'frown'])
    })
})

describe('a delete that landed nothing', () => {
    test('posts no toast and leaves the rows alone', async () => {
        await show()
        vi.spyOn(rig.service, 'assetDelete').mockReturnValue({ ok: true, unchanged: true })
        await deleteRow('grin')
        expect(toastHost.visible).toHaveLength(0)
        expect(rowNames()).toEqual(['smile', 'grin', 'frown'])
        expect(parts('studio-asset-refusal')).toHaveLength(0)
    })
})

describe('a refused delete', () => {
    const refusalCase = async (configure: (claim: ClaimDouble) => void, key: string): Promise<void> => {
        rig = makeRig(new Map(), configure)
        await rig.service.whenReady(A)
        await show()
        const before = JSON.stringify(db.db.characters[0].additionalAssets)
        const marks = h.marks
        await deleteRow('grin')
        expect(parts('studio-asset-refusal')[0].textContent).toBe(key)
        expect(JSON.stringify(db.db.characters[0].additionalAssets)).toBe(before)
        expect(rig.service.view(A).done).toHaveLength(0)
        expect(toastHost.visible).toHaveLength(0)
        expect(h.marks).toBe(marks)
        expect(db.db.characters[0][ASSET_RETAINED_KEY]).toBeUndefined()
        expect(parts('studio-asset-row')).toHaveLength(3)
    }

    test('while another tab holds the character shows the other-tab copy and changes nothing', async () => {
        await refusalCase((claim) => { claim.forced = 'held' }, 'studioAssetRefusalOtherTabCharacter')
    })

    test('while history cannot be kept shows the no-undo copy and changes nothing', async () => {
        await refusalCase((claim) => { claim.unsupported = true }, 'studioAssetRefusalNoUndo')
    })
})
