// @vitest-environment jsdom
/**
 * The icon of the preset advanced form over the real history service on the memory doubles, the real preset adapter, the
 * real `changeToPreset` and the real English `language`: choosing an icon on the active and on an inactive preset,
 * removing it, undo, and a cancelled pick.
 * MOCKED: the page store, the horde model fetch, the model data store, the platform and plugin modules, and the icon
 * pipeline `pickPresetIcon` at the helper boundary (jsdom has no canvas; the pipeline itself is in presetIcon.test.ts).
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    marks: 0,
    selection: { selId: 0 },
    quick: { open: true },
    pickIcon: vi.fn<() => Promise<string | null>>(),
}))

vi.mock('src/ts/presetIcon', () => ({ pickPresetIcon: h.pickIcon }))
vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    getFileSrc: async (path: string, use: string) => `blob:${use}:${path}`,
    readImage: () => Promise.resolve(undefined),
    saveAsset: vi.fn(),
    downloadFile: vi.fn(),
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
    aiWatermarkingLawApplies: () => false,
}))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: {} as unknown })
    return {
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        ReloadGUIPointer: writable(0),
        CharConfigSubMenu: writable(0),
        SettingsMenuIndex: writable(-1),
        botMakerMode: writable(false),
        sideBarStore: writable(false),
        frozenSaveKeysStore: writable([]),
        selectedCharID: writable(0),
        clearCharEmotionCache: vi.fn(),
        DBState: state,
        get selIdState() { return h.selection },
        get QuickSettings() { return h.quick },
    }
})
vi.mock('src/ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('src/ts/alertPrompts', async (importOriginal) => ({ ...(await importOriginal<typeof import('src/ts/alertPrompts')>()), pageCovered: () => false }))
vi.mock('src/ts/horde/getModels', () => ({ getHordeModels: vi.fn(async () => []) }))
vi.mock('src/ts/model/modelData/modelDataStore', () => ({ startModelData: vi.fn(), refreshModelDataNow: vi.fn(), refreshAllNow: vi.fn(async () => {}) }))
vi.mock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('src/ts/plugins/plugins.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { customProviderStore: writable([]), pluginV2: { providerOptions: new Map(), providers: new Map() } }
})
vi.mock('src/ts/plugins/apiV3/v3.svelte', () => ({ customV3ProviderMetaStore: [] }))

import { DBState } from 'src/ts/stores.svelte'
import { languageEnglish } from 'src/lang/en'
import { changeToPreset, saveCurrentPreset } from 'src/ts/storage/database.svelte'
import { resetAddedModelsForTests } from 'src/ts/model/modelData/addedModels.svelte'
import { resetModelDataForTests } from 'src/ts/model/modelData/modelDataService.svelte'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { presetOwnerKey } from 'src/ts/studio/edit/presetTarget'
import { presetNamed, seedPresetDb } from 'src/ts/studio/edit/tests/presetFixture.test-helpers'
import { createMacroIndex } from 'src/ts/studio/longText/macroIndex'
import { setMacroIndexForTests } from 'src/ts/studio/longText/macroIndexService'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import StudioPresetAdvancedForm from './StudioPresetAdvancedForm.svelte'

const dbBag = (): Record<string, unknown> => DBState.db as unknown as Record<string, unknown>
const slotBag = (index: number): Record<string, unknown> => DBState.db.botPresets[index] as unknown as Record<string, unknown>

const ICON_A = 'data:image/jpeg;base64,AAAA'
const ICON_B = 'data:image/jpeg;base64,BBBB'
const ICON_NEW = 'data:image/jpeg;base64,NEWW'

function makeAck(clock: FakeClock): SaveAck {
    const deps: SaveAckDeps = {
        getMarkCount: () => h.marks,
        getCommittedMarkCount: () => 0,
        afterNextCommit: () => {},
        requestSaveNow: () => {},
        getPeerSaveCount: () => 0,
        onStopped: () => () => {},
        isStopped: () => false,
        subscribeFailure: () => () => {},
        currentFailure: () => null,
        frozenKeys: () => new Set<string>(),
        isCharacterUnsavable: () => false,
        onPassStart: () => () => {},
        visible: () => true,
        onVisibilityChange: () => () => {},
        clock,
    }
    return createSaveAck(deps)
}

let service: OwnerHistoryService
let ids: string[]
let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

function makeService(): void {
    const clock = createFakeClock()
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
    })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(makeAck(clock))
}

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
}

async function mountPreset(index: number): Promise<void> {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = mount(StudioPresetAdvancedForm, { target: host, props: { presetId: ids[index] } })
    mounted.push({ app, host })
    flushSync()
    await settle()
}

async function unmountAll(): Promise<void> {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const owner = (index: number) => presetOwnerKey(ids[index])

async function click(name: string): Promise<void> {
    const element = part(name)
    expect(element, `${name} exists`).not.toBeNull()
    element?.click()
    await settle()
}

// Preset 0 is active; both presets hold an icon unless a test says otherwise.
function seed(): void {
    ids = seedPresetDb([presetNamed('A', 'a=A'), presetNamed('B', 'b=B')], 0, 'a=A')
    dbBag().aiModel = 'local_x'
    dbBag().subModel = 'local_x'
    dbBag().dynamicModelRegistry = true
    dbBag().customModels = []
    dbBag().bias = []
    dbBag().modelTools = []
    dbBag().formatingOrder = ['main', 'description', 'chats']
    dbBag().fallbackModels = { memory: [], emotion: [], translate: [], otherAx: [], model: [] }
}

beforeEach(() => {
    h.marks = 0
    h.pickIcon.mockReset()
    resetStudioScreenForTests()
    studioScreen.visitId = 'v1'
    studioScreen.open = true
    localStorage.clear()
    resetModelDataForTests()
    resetAddedModelsForTests()
    seed()
    makeService()
    setMacroIndexForTests(createMacroIndex([{ name: 'char', aliases: [], summary: 'char', usage: null, docOnly: false, internalOnly: false, blockSyntax: false, deprecated: null }]))
})

afterEach(async () => {
    setMacroIndexForTests(null)
    await unmountAll()
    resetStudioHistoryAccessorForTests()
    resetStudioScreenForTests()
    resetModelDataForTests()
    resetAddedModelsForTests()
})

describe('S4d: the preset icon', () => {
    test('S4d-T1: an icon on the active preset lands on its slot, survives the save and a switch round trip, and db gains no image key', async () => {
        h.pickIcon.mockResolvedValue(ICON_NEW)
        await mountPreset(0)
        await click('studio-preset-icon-choose')
        expect(slotBag(0).image).toBe(ICON_NEW)
        expect(Object.hasOwn(dbBag(), 'image')).toBe(false)
        expect(part('studio-preset-icon-tile')?.querySelector('img')?.getAttribute('src')).toBe(ICON_NEW)
        saveCurrentPreset()
        expect(slotBag(0).image).toBe(ICON_NEW)
        changeToPreset(1)
        changeToPreset(0)
        expect(slotBag(0).image).toBe(ICON_NEW)
        expect(Object.hasOwn(dbBag(), 'image')).toBe(false)
        expect(service.view(owner(0)).done).toHaveLength(1)
    })

    test('S4d-T2: an icon on an inactive preset lands on that slot only, and undo restores no icon (the key is deleted)', async () => {
        slotBag(0).image = ICON_A
        h.pickIcon.mockResolvedValue(ICON_NEW)
        await mountPreset(1)
        expect(Object.hasOwn(slotBag(1), 'image')).toBe(false)
        await click('studio-preset-icon-choose')
        expect(slotBag(1).image).toBe(ICON_NEW)
        expect(slotBag(0).image).toBe(ICON_A)
        expect(Object.hasOwn(dbBag(), 'image')).toBe(false)
        expect(service.undo(owner(1))).toEqual({ ok: true })
        flushSync()
        expect(Object.hasOwn(slotBag(1), 'image')).toBe(false)
        expect(slotBag(0).image).toBe(ICON_A)
    })

    test('S4d-T4: a cancelled pick writes nothing and records no step', async () => {
        slotBag(1).image = ICON_B
        h.pickIcon.mockResolvedValue(null)
        await mountPreset(1)
        await click('studio-preset-icon-choose')
        expect(h.pickIcon).toHaveBeenCalledTimes(1)
        expect(slotBag(1).image).toBe(ICON_B)
        expect(service.view(owner(1)).done).toHaveLength(0)
    })

    test('S4d-T5: remove on an inactive preset deletes only its icon and undo restores the data URL', async () => {
        slotBag(0).image = ICON_A
        slotBag(1).image = ICON_B
        await mountPreset(1)
        await click('studio-preset-icon-remove')
        expect(Object.hasOwn(slotBag(1), 'image')).toBe(false)
        expect(slotBag(0).image).toBe(ICON_A)
        expect(part('studio-preset-icon-remove')).toBeNull()
        expect(service.view(owner(1)).done).toHaveLength(1)
        expect(service.undo(owner(1))).toEqual({ ok: true })
        flushSync()
        expect(slotBag(1).image).toBe(ICON_B)
        expect(part('studio-preset-icon-remove')).not.toBeNull()
    })

    test('S4d-T5: remove on the active preset leaves it without an icon, and the next save writes an empty image', async () => {
        slotBag(0).image = ICON_A
        slotBag(1).image = ICON_B
        await mountPreset(0)
        await click('studio-preset-icon-remove')
        expect(Object.hasOwn(slotBag(0), 'image')).toBe(false)
        expect(slotBag(1).image).toBe(ICON_B)
        saveCurrentPreset()
        expect(slotBag(0).image).toBe('')
        expect(part('studio-preset-icon-remove')).toBeNull()
        expect(part('studio-preset-icon-tile')?.textContent).toBe(languageEnglish.noImages)
    })

    test('the remove button is absent while the preset holds no icon', async () => {
        await mountPreset(1)
        expect(part('studio-preset-icon-remove')).toBeNull()
        expect(part('studio-preset-icon-choose')?.textContent).toBe(languageEnglish.chooseIconImage)
    })
})
