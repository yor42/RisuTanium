// @vitest-environment jsdom
/**
 * The model and parameter sections of the preset advanced form over the real history service on the memory doubles, the
 * real preset adapter, the real `changeToPreset`, the real picker (`ModelList`) and the real English `language`: which
 * parameters show for the preset's own model, what a not-set number looks like, how a drag and a typed number write, the
 * "do not change on switch" notes of the auxiliary models, and that changing a model writes nothing but the model.
 * MOCKED: the page store, the horde model fetch, the model data store, the platform and plugin modules, and
 * `alertConfirm` (a spy whose answer each test sets).
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0, selection: { selId: 0 }, quick: { open: true }, confirm: vi.fn<(text: string) => Promise<boolean>>() }))

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
import { changeToPreset } from 'src/ts/storage/database.svelte'
import { getModelInfo } from 'src/ts/model/modellist'
import { resetAddedModelsForTests } from 'src/ts/model/modelData/addedModels.svelte'
import { resetModelDataForTests, seedLiteLLMForTests } from 'src/ts/model/modelData/modelDataService.svelte'
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

const DATASET_ID = 'gpt-zz-dataset'
const NOW = 1_800_000_000_000

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

// Preset 0 is active on an OpenAI model, preset 1 holds a Claude adaptive-thinking model, preset 2 holds no model at all.
function seed(): void {
    ids = seedPresetDb([presetNamed('A', 'a=A'), presetNamed('B', 'b=B'), presetNamed('C', 'c=C')], 0, 'a=A')
    dbBag().showUnrecommended = false
    dbBag().aiModel = 'gpt4o'
    dbBag().subModel = 'gpt4o'
    dbBag().dynamicModelRegistry = true
    dbBag().customModels = []
    slotBag(1).aiModel = 'claude-opus-4-8'
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const field = (path: string) => part(`studio-preset-${path}`)
const owner = (index: number) => presetOwnerKey(ids[index])
const noteOf = (path: string) => field(path)?.closest('[data-path]')?.querySelector('[data-part="studio-preset-not-set"]') ?? null

function snapshot(): string {
    return JSON.stringify(DBState.db)
}

function changedPaths(before: unknown, after: unknown, path = ''): string[] {
    if (JSON.stringify(before) === JSON.stringify(after)) return []
    if (typeof before === 'object' && before !== null && typeof after === 'object' && after !== null) {
        const names = new Set([...Object.keys(before), ...Object.keys(after)])
        return [...names].flatMap((name) => changedPaths((before as Record<string, unknown>)[name], (after as Record<string, unknown>)[name], `${path}.${name}`))
    }
    return [path]
}

beforeEach(() => {
    h.marks = 0
    h.confirm.mockReset()
    h.confirm.mockResolvedValue(true)
    resetStudioScreenForTests()
    studioScreen.visitId = 'v1'
    studioScreen.open = true
    localStorage.clear()
    resetModelDataForTests()
    resetAddedModelsForTests()
    seedLiteLLMForTests({ v: 1, fetchedAt: NOW, rows: { [DATASET_ID]: { p: 'openai', m: 'chat', ctx: 1000 } } })
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

describe('S4b-T6: the parameters follow the preset\'s own model', () => {
    test('an inactive Claude adaptive preset shows thinking mode and effort while the active OpenAI preset shows sampling rows', async () => {
        await mountPreset(1)
        expect(field('presetThinkingType')).not.toBeNull()
        expect(field('presetAdaptiveThinkingEffort')).not.toBeNull()
        expect(field('presetThinkingTokens')).toBeNull()
        expect(field('presetTemperature')).toBeNull()
        expect(field('presetTopP')).toBeNull()
        expect(field('presetMaxContext')).not.toBeNull()
        expect(field('presetMaxResponse')).not.toBeNull()
        await unmountAll()
        await mountPreset(0)
        expect(field('presetTemperature')).not.toBeNull()
        expect(field('presetTopP')).not.toBeNull()
        expect(field('presetFrequencyPenalty')).not.toBeNull()
        expect(field('presetThinkingType')).toBeNull()
        expect(field('presetAdaptiveThinkingEffort')).toBeNull()
        expect(field('presetTopK')).toBeNull()
    })

    test('a slot with no model reads the working model, as a switch keeps it', async () => {
        await mountPreset(2)
        expect(slotBag(2).aiModel).toBeUndefined()
        expect(field('presetTemperature')).not.toBeNull()
        expect(field('presetThinkingType')).toBeNull()
        dbBag().aiModel = 'claude-opus-4-8'
        flushSync()
        expect(field('presetThinkingType')).not.toBeNull()
    })

    test('the model rows, the four auxiliary rows and the data refresh row show', async () => {
        await mountPreset(1)
        for (const path of ['presetAiModel', 'presetSubModel', 'presetAuxMemory', 'presetAuxTranslate', 'presetAuxEmotion', 'presetAuxOtherAx']) {
            expect(field(path), path).not.toBeNull()
        }
        expect(document.querySelector('[data-testid="model-data-refresh"]')).not.toBeNull()
    })
})

describe('S4b-T6b: the DeepSeek effort row follows this preset\'s own thinking mode', () => {
    test('shown when the preset holds the enabled mode while the working settings are off, hidden in the reverse case', async () => {
        slotBag(2).aiModel = 'deepseek-v4-pro'
        slotBag(2).deepseekThinkingType = 'enabled'
        dbBag().deepseekThinkingType = 'off'
        await mountPreset(2)
        expect(field('presetDeepseekReasoningEffort')).not.toBeNull()
        await unmountAll()
        slotBag(2).deepseekThinkingType = 'off'
        dbBag().deepseekThinkingType = 'enabled'
        await mountPreset(2)
        expect(field('presetDeepseekReasoningEffort')).toBeNull()
    })
})

describe('S4b-T14: a stored segmented value the row does not offer stays visible', () => {
    const buttons = (path: string): HTMLButtonElement[] => [...(field(path)?.querySelectorAll<HTMLButtonElement>('button[data-segment-btn]') ?? [])]

    test('a valid value gated out for the model shows as the selected disabled extra segment and is not written over', async () => {
        slotBag(2).aiModel = 'claude-opus-4-7'
        slotBag(2).adaptiveThinkingEffort = 'xhigh'
        await mountPreset(2)
        const offered = buttons('presetAdaptiveThinkingEffort').filter((button) => !button.disabled)
        expect(offered.map((button) => button.textContent?.trim())).not.toContain('XHigh')
        const extra = buttons('presetAdaptiveThinkingEffort').filter((button) => button.disabled)
        expect(extra).toHaveLength(1)
        expect(extra[0].textContent?.trim()).toBe(languageEnglish.studioPresetUnknownValue('xhigh'))
        expect(extra[0].classList.contains('segmented-btn-active')).toBe(true)
        extra[0].click()
        flushSync()
        expect(slotBag(2).adaptiveThinkingEffort).toBe('xhigh')
        expect(service.view(owner(2)).done).toHaveLength(0)
    })

    test('an out-of-range number shows the same way, and picking an offered value replaces it', async () => {
        slotBag(2).aiModel = 'gpt-5.4'
        slotBag(2).verbosity = 5
        await mountPreset(2)
        const extra = buttons('presetVerbosity').filter((button) => button.disabled)
        expect(extra.map((button) => button.textContent?.trim())).toEqual([languageEnglish.studioPresetUnknownValue('5')])
        expect(extra[0].classList.contains('segmented-btn-active')).toBe(true)
        buttons('presetVerbosity').find((button) => button.textContent?.trim() === languageEnglish.optHigh)?.click()
        flushSync()
        expect(slotBag(2).verbosity).toBe(2)
        expect(buttons('presetVerbosity').filter((button) => button.disabled)).toHaveLength(0)
    })

    test('a value that is offered, or not set, adds no extra segment', async () => {
        slotBag(2).aiModel = 'gpt-5.4'
        slotBag(2).verbosity = 1
        await mountPreset(2)
        expect(buttons('presetVerbosity').filter((button) => button.disabled)).toHaveLength(0)
        await unmountAll()
        delete slotBag(2).verbosity
        await mountPreset(2)
        expect(buttons('presetVerbosity').filter((button) => button.disabled)).toHaveLength(0)
    })
})

describe('S4b-T9: changing the model writes the model only', () => {
    function openPicker(path: string, showUnrecommended: boolean): void {
        const trigger = field(path)?.querySelector<HTMLButtonElement>('button.drop-shadow-lg')
        expect(trigger, path).toBeTruthy()
        trigger?.click()
        flushSync()
        if (showUnrecommended) {
            const check = field(path)?.querySelector<HTMLInputElement>('div.fixed input[type="checkbox"]')
            if (check) {
                check.checked = true
                check.dispatchEvent(new Event('change', { bubbles: true }))
                flushSync()
            }
        }
        for (const header of Array.from(field(path)?.querySelectorAll('div[class="flex flex-col"] > button:first-child') ?? [])) {
            (header as HTMLButtonElement).click()
        }
        flushSync()
    }
    function rowFor(path: string, id: string): HTMLButtonElement | undefined {
        const name = getModelInfo(id).name
        return Array.from(field(path)?.querySelectorAll<HTMLButtonElement>('div.fixed button.text-lg') ?? []).find((button) => (button.textContent ?? '').trim() === name)
    }

    test('picking a Claude adaptive model on the active preset changes aiModel and nothing else, and the thinking mode shows the resolved value', async () => {
        await mountPreset(0)
        const before = JSON.parse(snapshot()) as unknown
        openPicker('presetAiModel', false)
        const row = rowFor('presetAiModel', 'claude-opus-4-8')
        expect(row).toBeDefined()
        row?.click()
        await settle()
        expect(dbBag().aiModel).toBe('claude-opus-4-8')
        expect(changedPaths(before, JSON.parse(snapshot()))).toEqual(['.aiModel'])
        expect(Object.hasOwn(dbBag(), 'thinkingType')).toBe(false)
        const active = field('presetThinkingType')?.querySelector('.segmented-btn-active')
        expect(active?.textContent?.trim()).toBe(languageEnglish.optAdaptive)
        expect(service.view(owner(0)).done).toHaveLength(1)
    })

    test('S4b-T12: a model known from one source asks first; cancel writes nothing and records no step, confirm writes once', async () => {
        await mountPreset(1)
        const before = snapshot()
        h.confirm.mockResolvedValue(false)
        openPicker('presetSubModel', true)
        rowFor('presetSubModel', DATASET_ID)?.click()
        await settle()
        expect(h.confirm).toHaveBeenCalledTimes(1)
        expect(snapshot()).toBe(before)
        expect(service.view(owner(1)).done).toHaveLength(0)
        // The picker stays open after a cancelled choice.
        h.confirm.mockResolvedValue(true)
        const row = rowFor('presetSubModel', DATASET_ID)
        expect(row).toBeDefined()
        row?.click()
        await settle()
        expect(h.confirm).toHaveBeenCalledTimes(2)
        expect(slotBag(1).subModel).toBe(DATASET_ID)
        expect(service.view(owner(1)).done).toHaveLength(1)
    })
})

describe('S4b-T13: not-set numbers', () => {
    test('an inactive keyless preset shows min_p off with no note and temperature with the not-set note', async () => {
        slotBag(2).aiModel = 'openrouter'
        await mountPreset(2)
        expect(Object.hasOwn(slotBag(2), 'min_p')).toBe(false)
        expect(field('presetMinP')).not.toBeNull()
        const check = field('presetMinP')?.querySelector<HTMLInputElement>('input[type="checkbox"]')
        expect(check?.checked).toBe(false)
        expect(noteOf('presetMinP')).toBeNull()
        expect(noteOf('presetTemperature')?.textContent).toBe(languageEnglish.studioPresetNotSet)
        expect(field('presetTemperature')?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false)
    })

    test('the active preset with no min_p shows it off with no note', async () => {
        dbBag().aiModel = 'openrouter'
        delete dbBag().min_p
        await mountPreset(0)
        expect(field('presetMinP')?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false)
        expect(noteOf('presetMinP')).toBeNull()
        expect(noteOf('presetTemperature')).toBeNull()
    })
})

describe('S4b-T10: a drag is one step and the switch is its own', () => {
    test('switching a slider on, then three keyboard steps, is two steps; undo of the drag goes back to the switch value', async () => {
        slotBag(2).aiModel = 'openrouter'
        await mountPreset(2)
        const wrap = field('presetMinP')
        const check = wrap?.querySelector<HTMLInputElement>('input[type="checkbox"]')
        check?.click()
        flushSync()
        expect(slotBag(2).min_p).toBe(0)
        const slider = wrap?.querySelector<HTMLElement>('[role="slider"]')
        for (let n = 0; n < 3; n++) {
            slider?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
            flushSync()
        }
        expect(slotBag(2).min_p).toBeCloseTo(0.03, 5)
        expect(service.view(owner(2)).done).toHaveLength(2)
        expect(service.undo(owner(2))).toEqual({ ok: true })
        expect(slotBag(2).min_p).toBe(0)
        check?.click()
        flushSync()
        expect(slotBag(2).min_p).toBe(-1000)
    })

    test('a drag followed at once by the off switch is two steps, the switch never joins the drag', async () => {
        slotBag(2).aiModel = 'openrouter'
        slotBag(2).min_p = 0.5
        await mountPreset(2)
        const wrap = field('presetMinP')
        const slider = wrap?.querySelector<HTMLElement>('[role="slider"]')
        slider?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
        flushSync()
        expect(service.view(owner(2)).done).toHaveLength(1)
        wrap?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click()
        flushSync()
        expect(slotBag(2).min_p).toBe(-1000)
        expect(service.view(owner(2)).done).toHaveLength(2)
        expect(service.undo(owner(2))).toEqual({ ok: true })
        expect(slotBag(2).min_p).toBeCloseTo(0.51, 5)
    })

    test('typing a number writes it, an entry above the range is clamped and shown back clamped', async () => {
        await mountPreset(0)
        const input = field('presetMaxResponse')?.querySelector<HTMLInputElement>('input[type="number"]')
        expect(input).toBeTruthy()
        if (!input) return
        input.value = '99999'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        input.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(dbBag().maxResponse).toBe(2048)
        expect(input.value).toBe('2048')
        input.value = ''
        input.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        input.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(dbBag().maxResponse).toBe(2048)
        expect(input.value).toBe('2048')
    })

    test('the thought tag depth number of the prompt options writes into the container', async () => {
        await mountPreset(1)
        const input = field('presetMaxThoughtTagDepth')?.querySelector<HTMLInputElement>('input[type="number"]')
        expect(input?.value).toBe('-1')
        if (!input) return
        input.value = '3'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        expect((slotBag(1).promptSettings as Record<string, unknown>).maxThoughtTagDepth).toBe(3)
        expect(service.undo(owner(1))).toEqual({ ok: true })
        expect((slotBag(1).promptSettings as Record<string, unknown>).maxThoughtTagDepth).toBe(-1)
    })
})

describe('S4b-T8: the auxiliary model notes', () => {
    test('the kept note shows for an inactive preset with the switch on, the not-saved note for the active one, none with the switch off', async () => {
        dbBag().doNotChangeSeperateModels = true
        await mountPreset(1)
        expect(part('studio-preset-aux-note')?.textContent).toBe(languageEnglish.studioPresetAuxKept)
        await unmountAll()
        await mountPreset(0)
        expect(part('studio-preset-aux-note')?.textContent).toBe(languageEnglish.studioPresetAuxNotSaved)
        await unmountAll()
        dbBag().doNotChangeSeperateModels = false
        await mountPreset(1)
        expect(part('studio-preset-aux-note')).toBeNull()
    })

    test('the kept note says switching to the preset and away clears the models, and that is what happens', async () => {
        expect(languageEnglish.studioPresetAuxKept).toContain('away again clears them')
        dbBag().doNotChangeSeperateModels = true
        expect(service.editText(owner(1), 'presetAuxMemory', 'edited', 'single')).toEqual({ ok: true })
        changeToPreset(1)
        changeToPreset(2)
        expect(slotBag(1).seperateModels).toBeNull()
    })
})
