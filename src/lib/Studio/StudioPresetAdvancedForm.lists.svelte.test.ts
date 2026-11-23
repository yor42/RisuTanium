// @vitest-environment jsdom
/**
 * The list controls of the preset advanced form over the real history service on the memory doubles, the real preset
 * adapter, the real `changeToPreset` and the real English `language`: fallback model rows (add, move, remove), stop
 * strings on and off for the preset's own model, the model tools switch, the format order (move only), and the bias list
 * with its duplicate note, export file and import (replacing, or refused whole).
 * MOCKED: the page store, the horde model fetch, the model data store, the platform and plugin modules, `downloadFile`
 * (a spy) and the file picker `selectSingleFile` (answers the bytes each test sets).
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    marks: 0,
    selection: { selId: 0 },
    quick: { open: true },
    confirm: vi.fn<(text: string) => Promise<boolean>>(),
    download: vi.fn<(name: string, data: unknown) => Promise<boolean>>(),
    pick: vi.fn<(ext: string[]) => Promise<{ name: string; data: Uint8Array } | null>>(),
}))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    getFileSrc: async (path: string, use: string) => `blob:${use}:${path}`,
    readImage: () => Promise.resolve(undefined),
    saveAsset: vi.fn(),
    downloadFile: h.download,
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
    aiWatermarkingLawApplies: () => false,
}))
vi.mock('src/ts/util', async (importOriginal) => ({ ...(await importOriginal<typeof import('src/ts/util')>()), selectSingleFile: h.pick }))
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
vi.mock('src/ts/alert', async (importOriginal) => ({ ...(await importOriginal<typeof import('src/ts/alert')>()), alertConfirm: h.confirm }))
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
import { resetAddedModelsForTests } from 'src/ts/model/modelData/addedModels.svelte'
import { resetModelDataForTests } from 'src/ts/model/modelData/modelDataService.svelte'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { presetOwnerKey, readPresetField } from 'src/ts/studio/edit/presetTarget'
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

// Preset 0 is active on a local model; preset 1 holds an OpenAI model; preset 2 holds a text generation model.
function seed(): void {
    ids = seedPresetDb([presetNamed('A', 'a=A'), presetNamed('B', 'b=B'), presetNamed('C', 'c=C')], 0, 'a=A')
    dbBag().showUnrecommended = false
    dbBag().aiModel = 'local_x'
    dbBag().subModel = 'local_x'
    dbBag().dynamicModelRegistry = true
    dbBag().customModels = []
    dbBag().bias = []
    dbBag().modelTools = []
    dbBag().formatingOrder = ['main', 'description', 'chats']
    dbBag().fallbackModels = { memory: [], emotion: [], translate: [], otherAx: [], model: [] }
    slotBag(1).aiModel = 'gpt4o'
    slotBag(2).aiModel = 'textgen_webui'
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const field = (path: string) => part(`studio-preset-${path}`)
const within = (path: string, name: string) => [...(field(path)?.querySelectorAll<HTMLElement>(`[data-part="${name}"]`) ?? [])]
const owner = (index: number) => presetOwnerKey(ids[index])
const listOf = (index: number, path: Parameters<typeof readPresetField>[1]): unknown => {
    const read = readPresetField(ids[index], path)
    return read.had ? read.value : null
}

function bytes(text: string): { name: string; data: Uint8Array } {
    return { name: 'bias.json', data: new TextEncoder().encode(text) }
}

function click(element: HTMLElement | undefined): void {
    expect(element, 'the control exists').toBeDefined()
    element?.click()
    flushSync()
}

beforeEach(() => {
    h.marks = 0
    h.confirm.mockReset()
    h.confirm.mockResolvedValue(true)
    h.download.mockReset()
    h.download.mockResolvedValue(true)
    h.pick.mockReset()
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

describe('S4c: the fallback lists', () => {
    test('add, move and remove on an inactive preset are one step each and write the slot', async () => {
        slotBag(1).fallbackModels = { memory: ['a', 'b'], emotion: [], translate: [], otherAx: [], model: [] }
        await mountPreset(1)
        expect(within('presetFallbackMemory', 'studio-preset-list-row')).toHaveLength(2)
        click(within('presetFallbackMemory', 'studio-preset-list-add')[0])
        expect(listOf(1, 'presetFallbackMemory')).toEqual(['a', 'b', ''])
        click(within('presetFallbackMemory', 'studio-preset-list-down')[0])
        expect(listOf(1, 'presetFallbackMemory')).toEqual(['b', 'a', ''])
        click(within('presetFallbackMemory', 'studio-preset-list-remove')[1])
        expect(listOf(1, 'presetFallbackMemory')).toEqual(['b', ''])
        expect(service.view(owner(1)).done).toHaveLength(3)
        expect(dbBag().fallbackModels).toEqual({ memory: [], emotion: [], translate: [], otherAx: [], model: [] })
        expect(service.undo(owner(1))).toEqual({ ok: true })
        flushSync()
        expect(listOf(1, 'presetFallbackMemory')).toEqual(['b', 'a', ''])
    })

    test('the first row cannot move up and the last cannot move down', async () => {
        slotBag(1).fallbackModels = { memory: ['a', 'b'], emotion: [], translate: [], otherAx: [], model: [] }
        await mountPreset(1)
        const up = within('presetFallbackMemory', 'studio-preset-list-up') as HTMLButtonElement[]
        const down = within('presetFallbackMemory', 'studio-preset-list-down') as HTMLButtonElement[]
        expect(up[0].disabled).toBe(true)
        expect(up[1].disabled).toBe(false)
        expect(down[0].disabled).toBe(false)
        expect(down[1].disabled).toBe(true)
    })

    test('the five lists are labelled and the working copy takes the active preset\'s edit', async () => {
        await mountPreset(0)
        for (const path of ['presetFallbackModel', 'presetFallbackMemory', 'presetFallbackTranslate', 'presetFallbackEmotion', 'presetFallbackOtherAx']) {
            expect(field(path), path).not.toBeNull()
        }
        click(within('presetFallbackModel', 'studio-preset-list-add')[0])
        expect((dbBag().fallbackModels as { model: string[] }).model).toEqual([''])
        expect(slotBag(0).fallbackModels).toBeUndefined()
    })
})

describe('S4c-T11: stop strings follow the preset\'s own model', () => {
    test('they show for a local or text generation model and not for an OpenAI one, whatever the active model is', async () => {
        await mountPreset(1)
        expect(field('presetLocalStopStrings')).toBeNull()
        await unmountAll()
        await mountPreset(2)
        expect(field('presetLocalStopStrings')).not.toBeNull()
        await unmountAll()
        await mountPreset(0)
        expect(field('presetLocalStopStrings')).not.toBeNull()
        dbBag().aiModel = 'gpt4o'
        await settle()
        expect(field('presetLocalStopStrings')).toBeNull()
    })

    test('on adds an empty list, entries are listed, off stores null and undo puts the list back', async () => {
        await mountPreset(2)
        const toggle = part('studio-preset-stops-toggle') as HTMLInputElement
        expect(toggle.checked).toBe(false)
        toggle.checked = true
        toggle.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(slotBag(2).localStopStrings).toEqual([])
        click(within('presetLocalStopStrings', 'studio-preset-list-add')[0])
        expect(slotBag(2).localStopStrings).toEqual([''])
        expect(within('presetLocalStopStrings', 'studio-preset-stop-entry')).toHaveLength(1)
        const off = part('studio-preset-stops-toggle') as HTMLInputElement
        off.checked = false
        off.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(slotBag(2).localStopStrings).toBeNull()
        expect(within('presetLocalStopStrings', 'studio-preset-stop-entry')).toHaveLength(0)
        expect(service.undo(owner(2))).toEqual({ ok: true })
        flushSync()
        expect(slotBag(2).localStopStrings).toEqual([''])
    })
})

describe('S4c-T5: model tools and format order', () => {
    test('the search switch adds and removes search and keeps every other stored entry', async () => {
        slotBag(1).modelTools = ['x']
        await mountPreset(1)
        const search = part('studio-preset-tools-search') as HTMLInputElement
        expect(search.checked).toBe(false)
        search.checked = true
        search.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(slotBag(1).modelTools).toEqual(['x', 'search'])
        const again = part('studio-preset-tools-search') as HTMLInputElement
        again.checked = false
        again.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(slotBag(1).modelTools).toEqual(['x'])
    })

    test('the format order moves up and down, offers no add or remove, and keeps an unknown stored item', async () => {
        slotBag(1).formatingOrder = ['main', 'foo', 'chats']
        await mountPreset(1)
        expect(within('presetFormatingOrder', 'studio-preset-list-row').map((row) => row.textContent?.trim().split(/\s+/)[0])).toEqual(['Main', 'foo', 'Past'])
        expect(within('presetFormatingOrder', 'studio-preset-list-add')).toHaveLength(0)
        expect(within('presetFormatingOrder', 'studio-preset-list-remove')).toHaveLength(0)
        click(within('presetFormatingOrder', 'studio-preset-list-up')[2])
        expect(slotBag(1).formatingOrder).toEqual(['main', 'chats', 'foo'])
        click(within('presetFormatingOrder', 'studio-preset-list-down')[0])
        expect(slotBag(1).formatingOrder).toEqual(['chats', 'main', 'foo'])
    })

    test('the format order is hidden while the preset has a prompt template', async () => {
        slotBag(1).promptTemplate = []
        await mountPreset(1)
        expect(field('presetFormatingOrder')).toBeNull()
    })
})

describe('S4c: the bias list', () => {
    test('a row is added, its token and value are written, a duplicate token is noted and a row is removed', async () => {
        await mountPreset(1)
        slotBag(1).bias = [['a', 1], ['a', 2]]
        await settle()
        const rows = within('presetBias', 'studio-preset-bias-row')
        expect(rows).toHaveLength(2)
        expect(rows[0].textContent).toContain(languageEnglish.studioPresetBiasDuplicate)
        const value = within('presetBias', 'studio-preset-bias-value')[1] as HTMLInputElement
        value.value = '500'
        value.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(slotBag(1).bias).toEqual([['a', 1], ['a', 100]])
        click(within('presetBias', 'studio-preset-bias-remove')[0])
        expect(slotBag(1).bias).toEqual([['a', 100]])
        click(within('presetBias', 'studio-preset-bias-add')[0])
        expect(slotBag(1).bias).toEqual([['a', 100], ['', 0]])
        expect(dbBag().bias).toEqual([])
        expect(service.view(owner(1)).done).toHaveLength(3)
    })

    test('S4c-T9: export downloads bias.json holding the list as indented JSON and changes nothing', async () => {
        slotBag(1).bias = [['a', 1], ['b', -101]]
        await mountPreset(1)
        const before = JSON.stringify(DBState.db)
        click(within('presetBias', 'studio-preset-bias-export')[0])
        expect(h.download).toHaveBeenCalledTimes(1)
        expect(h.download).toHaveBeenCalledWith('bias.json', JSON.stringify([['a', 1], ['b', -101]], null, 2))
        expect(JSON.stringify(DBState.db)).toBe(before)
        expect(service.view(owner(1)).done).toHaveLength(0)
    })

    test('S4c-T10: an import on an inactive preset replaces the whole list in one step and undo restores the old list', async () => {
        slotBag(1).bias = [['old', 5]]
        await mountPreset(1)
        h.pick.mockResolvedValue(bytes(JSON.stringify([['n1', 1], ['n2', -3]])))
        click(within('presetBias', 'studio-preset-bias-import')[0])
        await settle()
        expect(h.pick).toHaveBeenCalledWith(['json'])
        expect(slotBag(1).bias).toEqual([['n1', 1], ['n2', -3]])
        expect(dbBag().bias).toEqual([])
        expect(service.view(owner(1)).done).toHaveLength(1)
        expect(service.undo(owner(1))).toEqual({ ok: true })
        flushSync()
        expect(slotBag(1).bias).toEqual([['old', 5]])
    })

    test('S4c-T10: a malformed file is refused whole with a note and nothing is written', async () => {
        slotBag(1).bias = [['old', 5]]
        await mountPreset(1)
        const before = JSON.stringify(DBState.db)
        for (const text of ['not json', '{"a":1}', '[["a","1"]]', '[["a",1],["b"]]', '[["a",1],"b"]', '[[1,2]]']) {
            h.pick.mockResolvedValue(bytes(text))
            click(within('presetBias', 'studio-preset-bias-import')[0])
            await settle()
            expect(within('presetBias', 'studio-preset-bias-import-invalid'), text).toHaveLength(1)
            expect(JSON.stringify(DBState.db), text).toBe(before)
        }
        expect(service.view(owner(1)).done).toHaveLength(0)
        h.pick.mockResolvedValue(bytes('[["ok",2]]'))
        click(within('presetBias', 'studio-preset-bias-import')[0])
        await settle()
        expect(within('presetBias', 'studio-preset-bias-import-invalid')).toHaveLength(0)
        expect(slotBag(1).bias).toEqual([['ok', 2]])
    })

    test('a stored value outside the range never blocks an add or an edit of another row', async () => {
        slotBag(1).bias = [['a', 500], ['b', 1]]
        await mountPreset(1)
        click(within('presetBias', 'studio-preset-bias-add')[0])
        expect(slotBag(1).bias).toEqual([['a', 500], ['b', 1], ['', 0]])
        const value = within('presetBias', 'studio-preset-bias-value')[1] as HTMLInputElement
        value.value = '7'
        value.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(slotBag(1).bias).toEqual([['a', 500], ['b', 7], ['', 0]])
        expect(service.view(owner(1)).done).toHaveLength(2)
    })

    describe.each([
        ['the active preset', 0, (v: unknown) => { dbBag().bias = v }, () => dbBag().bias],
        ['an inactive slot', 1, (v: unknown) => { slotBag(1).bias = v }, () => slotBag(1).bias],
    ] as const)('a malformed stored bias row on %s', (_name, index, store, stored) => {
        test('the list is shown read-only with the unreadable note, nothing is written and export gives the stored value', async () => {
            const bad = [['keep1', 5], ['keep2', null], ['keep3', -3]]
            store(bad)
            await mountPreset(index)
            const before = JSON.stringify(DBState.db)
            expect(within('presetBias', 'studio-preset-bias-row')).toHaveLength(3)
            expect(field('presetBias')?.textContent).not.toContain(languageEnglish.noBias)
            expect(within('presetBias', 'studio-preset-bias-unreadable')[0]?.textContent).toBe(languageEnglish.studioBiasUnreadable)
            for (const name of ['add', 'import', 'remove']) {
                for (const control of within('presetBias', `studio-preset-bias-${name}`)) {
                    expect((control as HTMLButtonElement).disabled, name).toBe(true)
                }
            }
            click(within('presetBias', 'studio-preset-bias-add')[0])
            expect(JSON.stringify(DBState.db)).toBe(before)
            expect(stored()).toEqual(bad)
            click(within('presetBias', 'studio-preset-bias-export')[0])
            expect(h.download).toHaveBeenCalledWith('bias.json', JSON.stringify(bad, null, 2))
            expect(service.view(owner(index)).done).toHaveLength(0)
        })
    })

    test('a cancelled pick writes nothing', async () => {
        await mountPreset(1)
        h.pick.mockResolvedValue(null)
        click(within('presetBias', 'studio-preset-bias-import')[0])
        await settle()
        expect(service.view(owner(1)).done).toHaveLength(0)
        expect(within('presetBias', 'studio-preset-bias-import-invalid')).toHaveLength(0)
    })
})
