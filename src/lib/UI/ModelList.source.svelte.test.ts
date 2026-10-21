// @vitest-environment happy-dom

/**
 * `ModelList.svelte` marks the models that only one source knows (the provider's list or the
 * public dataset) in gray, lists them only under "Show unrecommended", asks for confirmation on
 * every selection of one, and keeps a persistent note under the picker button while one is the
 * bound value. Models known to both sources are white and recommended; built-ins are untouched.
 *
 * Mounts the REAL component over the real model catalog, the real added-model registry and the
 * real English `language`. MOCKED: the database holder, the page store, the horde model fetch,
 * the model data store, the platform and plugin modules, and `alertConfirm` (a spy whose answer
 * each test sets). Display names are fed through the registry's own provider list.
 *
 * Tests whose title starts with `guard:` pass with or without the change and pin behaviour that
 * must be preserved.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { LiteLLMData, LiteLLMRow } from 'src/ts/model/modelData/litellmData'

const h = vi.hoisted(() => ({
    confirm: vi.fn<(text: string) => Promise<boolean>>(),
}))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: () => ({}),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: h.confirm,
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/horde/getModels'), () => ({
    getHordeModels: vi.fn(async () => []),
}) as unknown as typeof import('src/ts/horde/getModels'))

vi.mock(import('src/ts/model/modelData/modelDataStore'), () => ({
    startModelData: vi.fn(),
    refreshModelDataNow: vi.fn(),
}) as unknown as typeof import('src/ts/model/modelData/modelDataStore'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    customProviderStore: writable([]),
    pluginV2: { providerOptions: new Map(), providers: new Map() },
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/plugins/apiV3/v3.svelte'), () => ({
    customV3ProviderMetaStore: [],
}) as unknown as typeof import('src/ts/plugins/apiV3/v3.svelte'))

import { language } from 'src/lang'
import { fillLang } from 'src/lang/fill'
import { DBState } from 'src/ts/stores.svelte'
import { getModelInfo } from 'src/ts/model/modellist'
import { resetAddedModelsForTests, seedProviderLists, setProviderList } from 'src/ts/model/modelData/addedModels.svelte'
import { resetModelDataForTests, seedLiteLLMForTests } from 'src/ts/model/modelData/modelDataService.svelte'
import ModelList from './ModelList.svelte'

const BUILTIN_ID = 'gemini-flash-latest'
const DATASET_ID = 'gpt-zz-dataset'
const PROVIDER_ID = 'gpt-zz-provider'
const BOTH_ID = 'gpt-zz-both'
const EVIL_ID = 'gpt-zz-evil'
const EVIL_NAME = '<img src=x onerror=alert(1)>'
const UNKNOWN_DYNAMIC_ID = 'dynamic_google_gemini-ghost'
const GRAY_CLASS = 'text-textcolor2'
const NOW = 1_800_000_000_000

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []
const bound = $state({ value: '' })
let changes: string[] = []

function datasetOf(ids: string[]): LiteLLMData {
    const rows: Record<string, LiteLLMRow> = Object.create(null) as Record<string, LiteLLMRow>
    for (const id of ids) {
        rows[id] = { p: 'openai', m: 'chat', ctx: 1000 }
    }
    return { v: 1, fetchedAt: NOW, rows }
}

/** The registry state every test starts from: DATASET_ID dataset-only, PROVIDER_ID and EVIL_ID provider-only, BOTH_ID in both. */
function loadSources(): void {
    seedLiteLLMForTests(datasetOf([DATASET_ID, BOTH_ID]))
    setProviderList('openai', [
        { id: PROVIDER_ID, name: 'Zz Provider' },
        { id: BOTH_ID, name: 'Zz Both' },
        { id: EVIL_ID, name: EVIL_NAME },
    ])
}

function mountList(value: string): HTMLElement {
    bound.value = value
    changes = []
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ModelList, {
        target,
        props: {
            get value() { return bound.value },
            set value(next: string) { bound.value = next },
            onChange: (next: string) => { changes.push(next) },
            blankable: true,
        },
    }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

function closedButton(target: HTMLElement): HTMLButtonElement {
    return target.querySelector(':scope > button') as HTMLButtonElement
}

function sourceNote(target: HTMLElement): HTMLElement | null {
    return target.querySelector('[data-testid="model-source-note"]')
}

function pickerIsOpen(target: HTMLElement): boolean {
    return target.querySelector('div.fixed') !== null
}

function openPicker(target: HTMLElement, showUnrecommended: boolean) {
    closedButton(target).click()
    flushSync()
    if (showUnrecommended) {
        const check = target.querySelector('input[type="checkbox"]') as HTMLInputElement
        check.checked = true
        check.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
    }
    for (const header of Array.from(target.querySelectorAll('div[class="flex flex-col"] > button:first-child'))) {
        (header as HTMLButtonElement).click()
    }
    flushSync()
}

function rowFor(target: HTMLElement, id: string): HTMLButtonElement | undefined {
    const name = getModelInfo(id).name
    const rows = Array.from(target.querySelectorAll('div.fixed button.text-lg')) as HTMLButtonElement[]
    return rows.find(button => (button.textContent ?? '').trim() === name)
}

/** Lets the confirmation promise settle, then flushes the resulting state change. */
async function settle(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0))
    flushSync()
}

async function choose(target: HTMLElement, id: string): Promise<void> {
    openPicker(target, true)
    const row = rowFor(target, id)
    expect(row).toBeDefined()
    row?.click()
    await settle()
}

beforeEach(() => {
    vi.stubGlobal('safeStructuredClone', <T>(value: T): T => structuredClone(value))
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 12, 12, 0, 0))
    h.confirm.mockReset()
    h.confirm.mockResolvedValue(true)
    resetModelDataForTests()
    resetAddedModelsForTests()
    DBState.db = {
        dynamicModelRegistry: true,
        openAIKey: 'k',
        claudeAPIKey: 'k',
        google: { accessToken: 'k' },
        customModels: [],
    } as unknown as Database
    loadSources()
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('gray rows', () => {
    test('only dataset-only and provider-only rows are gray; both-source and built-in rows are not', () => {
        const target = mountList(BUILTIN_ID)
        openPicker(target, true)
        expect(rowFor(target, DATASET_ID)?.classList.contains(GRAY_CLASS)).toBe(true)
        expect(rowFor(target, PROVIDER_ID)?.classList.contains(GRAY_CLASS)).toBe(true)
        expect(rowFor(target, BOTH_ID)?.classList.contains(GRAY_CLASS)).toBe(false)
        expect(rowFor(target, BUILTIN_ID)?.classList.contains(GRAY_CLASS)).toBe(false)
    })

    test('guard: gray rows are absent while "Show unrecommended" is off and present once it is on; both-source rows are always listed', () => {
        const target = mountList(BUILTIN_ID)
        openPicker(target, false)
        expect(rowFor(target, DATASET_ID)).toBeUndefined()
        expect(rowFor(target, PROVIDER_ID)).toBeUndefined()
        expect(rowFor(target, BOTH_ID)).toBeDefined()
        expect(rowFor(target, BUILTIN_ID)).toBeDefined()

        const withToggle = mountList(BUILTIN_ID)
        openPicker(withToggle, true)
        expect(rowFor(withToggle, DATASET_ID)).toBeDefined()
        expect(rowFor(withToggle, PROVIDER_ID)).toBeDefined()
    })
})

describe('the confirmation', () => {
    test('a dataset-only row asks with the dataset text and the display name', async () => {
        const target = mountList(BUILTIN_ID)
        await choose(target, DATASET_ID)
        expect(h.confirm).toHaveBeenCalledTimes(1)
        expect(h.confirm).toHaveBeenCalledWith(fillLang(language.modelSource.cautionDataset, { model: getModelInfo(DATASET_ID).fullName }))
    })

    test('a provider-only row asks with the provider text and the display name', async () => {
        const target = mountList(BUILTIN_ID)
        await choose(target, PROVIDER_ID)
        expect(h.confirm).toHaveBeenCalledTimes(1)
        expect(h.confirm).toHaveBeenCalledWith(fillLang(language.modelSource.cautionProvider, { model: 'Zz Provider' }))
    })

    test('every selection asks again, including re-picking the model that is already bound (mutant: once per model)', async () => {
        const target = mountList(BUILTIN_ID)
        await choose(target, PROVIDER_ID)
        expect(bound.value).toBe(PROVIDER_ID)
        await choose(target, PROVIDER_ID)
        expect(h.confirm).toHaveBeenCalledTimes(2)
        await choose(target, DATASET_ID)
        expect(h.confirm).toHaveBeenCalledTimes(3)
        await choose(target, DATASET_ID)
        expect(h.confirm).toHaveBeenCalledTimes(4)
    })

    test('"no" leaves the value, the picker and onChange untouched (mutant: no early return)', async () => {
        h.confirm.mockResolvedValue(false)
        const target = mountList(BUILTIN_ID)
        await choose(target, PROVIDER_ID)
        expect(h.confirm).toHaveBeenCalledTimes(1)
        expect(bound.value).toBe(BUILTIN_ID)
        expect(changes).toEqual([])
        expect(pickerIsOpen(target)).toBe(true)
    })

    test('guard: "yes" sets the value, reports the change and closes the picker', async () => {
        const target = mountList(BUILTIN_ID)
        await choose(target, DATASET_ID)
        expect(bound.value).toBe(DATASET_ID)
        expect(changes).toEqual([DATASET_ID])
        expect(pickerIsOpen(target)).toBe(false)
    })

    test('guard: a both-source model and a built-in select without a prompt (mutants: gray class or prompt for both, prompt for built-ins)', async () => {
        const target = mountList(DATASET_ID)
        await choose(target, BOTH_ID)
        expect(bound.value).toBe(BOTH_ID)
        await choose(target, BUILTIN_ID)
        expect(bound.value).toBe(BUILTIN_ID)
        expect(changes).toEqual([BOTH_ID, BUILTIN_ID])
        expect(h.confirm).not.toHaveBeenCalled()
    })

    test('guard: "none" never prompts', async () => {
        const target = mountList(BUILTIN_ID)
        openPicker(target, true)
        const none = Array.from(target.querySelectorAll('div.fixed button.text-lg')).find(button => button.textContent?.trim() === language.none) as HTMLButtonElement
        none.click()
        await settle()
        expect(bound.value).toBe('')
        expect(h.confirm).not.toHaveBeenCalled()
    })
})

describe('the persistent note and the button', () => {
    test('a selected gray model keeps its name on the button and shows the note while the toggle is off', () => {
        const target = mountList(PROVIDER_ID)
        openPicker(target, false)
        expect(rowFor(target, PROVIDER_ID)).toBeUndefined()
        expect(closedButton(target).textContent?.trim()).toBe('Zz Provider')
        expect(sourceNote(target)?.textContent?.trim()).toBe(language.modelSource.grayNote)
        expect(sourceNote(target)?.classList.contains(GRAY_CLASS)).toBe(true)

        const dataset = mountList(DATASET_ID)
        expect(sourceNote(dataset)?.textContent?.trim()).toBe(language.modelSource.grayNote)
    })

    test('a dynamic_google_ id the registry does not hold shows the unknown-source note (mutant: note missing)', () => {
        const target = mountList(UNKNOWN_DYNAMIC_ID)
        expect(sourceNote(target)?.textContent?.trim()).toBe(language.modelSource.sourceUnknownNote)

        const anthropic = mountList('dynamic_anthropic_claude-ghost')
        expect(sourceNote(anthropic)?.textContent?.trim()).toBe(language.modelSource.sourceUnknownNote)
    })

    test('guard: a built-in, a both-source model and "none" show no source note', () => {
        expect(sourceNote(mountList(BUILTIN_ID))).toBeNull()
        expect(sourceNote(mountList(BOTH_ID))).toBeNull()
        expect(sourceNote(mountList(''))).toBeNull()
    })

    test('the note follows the selection: choosing a built-in removes it', async () => {
        const target = mountList(PROVIDER_ID)
        expect(sourceNote(target)).not.toBeNull()
        await choose(target, BUILTIN_ID)
        expect(sourceNote(target)).toBeNull()
    })
})

describe('reactivity to the loading sources (mutant: non-reactive read)', () => {
    test('a saved list-only id updates its label and note once the live list arrives', () => {
        resetAddedModelsForTests()
        const target = mountList('gpt-zz-late')
        expect(sourceNote(target)).toBeNull()
        expect(closedButton(target).textContent?.trim()).not.toBe('Late Name')

        setProviderList('openai', [{ id: 'gpt-zz-late', name: 'Late Name' }])
        flushSync()
        expect(closedButton(target).textContent?.trim()).toBe('Late Name')
        expect(sourceNote(target)?.textContent?.trim()).toBe(language.modelSource.grayNote)
    })

    test('the same holds when the saved lists are seeded after mount', () => {
        resetAddedModelsForTests()
        const target = mountList('gpt-zz-seeded')
        expect(sourceNote(target)).toBeNull()

        seedProviderLists({ v: 1, lists: { openai: { fetchedAt: NOW, items: [{ id: 'gpt-zz-seeded', name: 'Seeded Name' }] } } })
        flushSync()
        expect(closedButton(target).textContent?.trim()).toBe('Seeded Name')
        expect(sourceNote(target)?.textContent?.trim()).toBe(language.modelSource.grayNote)
    })

    test('an unknown dynamic id becomes known once a list for its family arrives', () => {
        resetAddedModelsForTests()
        const target = mountList('dynamic_google_gemini-late')
        expect(sourceNote(target)?.textContent?.trim()).toBe(language.modelSource.sourceUnknownNote)

        setProviderList('google', [{ id: 'gemini-late', name: 'Gemini Late' }])
        flushSync()
        expect(closedButton(target).textContent?.trim()).toBe('Gemini Late')
        expect(sourceNote(target)?.textContent?.trim()).toBe(language.modelSource.grayNote)
    })

    test('the row class follows the registry: a model that gains a second source turns white', () => {
        const target = mountList(BUILTIN_ID)
        openPicker(target, true)
        expect(rowFor(target, PROVIDER_ID)?.classList.contains(GRAY_CLASS)).toBe(true)

        seedLiteLLMForTests(datasetOf([DATASET_ID, BOTH_ID, PROVIDER_ID]))
        flushSync()
        expect(rowFor(target, PROVIDER_ID)?.classList.contains(GRAY_CLASS)).toBe(false)
    })
})

describe('untrusted display names', () => {
    test('a hostile name renders as text in the row, the button and the confirmation, never as markup', async () => {
        const target = mountList(BUILTIN_ID)
        openPicker(target, true)
        const row = rowFor(target, EVIL_ID)
        expect(row?.textContent?.trim()).toBe(EVIL_NAME)
        expect(row?.querySelector('img')).toBeNull()

        row?.click()
        await settle()
        expect(h.confirm).toHaveBeenCalledWith(fillLang(language.modelSource.cautionProvider, { model: EVIL_NAME }))
        expect(closedButton(target).textContent?.trim()).toBe(EVIL_NAME)
        expect(target.querySelector('img')).toBeNull()
    })
})
