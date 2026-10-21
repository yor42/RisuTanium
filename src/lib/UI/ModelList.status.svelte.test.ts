// @vitest-environment happy-dom

/**
 * `ModelList.svelte` labels the bound model with its lifecycle status (retired, redirected or
 * deprecated), shows one explanatory note under the picker button, never offers retired or
 * redirected ids as rows, and lists them (still tagged) only for the per-model parameter key
 * chooser, which passes `showRetired`.
 *
 * Mounts the REAL component over the real model catalog and the real English `language`.
 * MOCKED: the database, the page store, the horde model fetch, the model data service and the
 * platform/plugin modules the catalog imports. The date is a fake local noon.
 *
 * Tests whose title starts with `guard:` pass with or without the change and pin behaviour that
 * must be preserved.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

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
import { getModelInfo } from 'src/ts/model/modellist'
import ModelList from './ModelList.svelte'

const RETIRED_ID = 'claude-3-opus-20240229'
const REDIRECTED_ID = 'gemini-3.7-flash'
const DEPRECATED_ID = 'claude-sonnet-4-5-20250929'
const OK_ID = 'gemini-flash-latest'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []
const bound = $state({ value: '' })
let changes: string[] = []

function mountList(value: string, extra: Record<string, unknown> = {}): HTMLElement {
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
            ...extra,
        },
    }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

function closedButton(target: HTMLElement): HTMLButtonElement {
    return target.querySelector(':scope > button') as HTMLButtonElement
}

function note(target: HTMLElement): HTMLElement | null {
    return target.querySelector('[data-testid="model-status-note"]')
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
    return rows.find(button => {
        const text = (button.textContent ?? '').trim()
        return text === name || (text.startsWith(`${name} (`) && text.endsWith(')'))
    })
}

beforeEach(() => {
    vi.stubGlobal('safeStructuredClone', <T>(value: T): T => structuredClone(value))
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 12, 12, 0, 0))
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

describe('the closed button and the note', () => {
    test('a retired value shows its full name, the retired tag and the retired warning', () => {
        const target = mountList(RETIRED_ID)
        const info = getModelInfo(RETIRED_ID)
        expect(closedButton(target).textContent?.trim()).toBe(`${info.fullName} (${language.modelStatus.retiredTag})`)
        expect(note(target)?.textContent?.trim()).toBe(fillLang(language.modelStatus.retiredWarning, { model: info.fullName ?? info.name }))
    })

    test('a redirected value names its target and does not use the retired copy', () => {
        const target = mountList(REDIRECTED_ID)
        const info = getModelInfo(REDIRECTED_ID)
        expect(closedButton(target).textContent?.trim()).toBe(`${info.fullName} (now uses gemini-3.8-flash)`)
        const text = note(target)?.textContent ?? ''
        expect(text).toBe(fillLang(language.modelStatus.redirectedWarning, { model: info.fullName ?? info.name, target: 'gemini-3.8-flash' }))
        expect(text).not.toBe(fillLang(language.modelStatus.retiredWarning, { model: info.fullName ?? info.name }))
    })

    test('a deprecated value shows the retires date and a soft warning', () => {
        const target = mountList(DEPRECATED_ID)
        const info = getModelInfo(DEPRECATED_ID)
        expect(closedButton(target).textContent?.trim()).toBe(`${info.fullName} (retires 2026-11-30)`)
        expect(note(target)?.textContent?.trim()).toBe(fillLang(language.modelStatus.retiresWarning, { model: info.fullName ?? info.name, date: '2026-11-30' }))
    })

    test('guard: an ok value and a blank value show no tag and no note', () => {
        const ok = mountList(OK_ID)
        expect(closedButton(ok).textContent?.trim()).toBe(getModelInfo(OK_ID).fullName)
        expect(note(ok)).toBeNull()

        const blank = mountList('')
        expect(closedButton(blank).textContent?.trim()).toBe(getModelInfo('').fullName)
        expect(note(blank)).toBeNull()
    })
})

describe('the open picker', () => {
    test('show unrecommended never lists retired or redirected ids and labels a deprecated row', () => {
        const target = mountList(OK_ID)
        openPicker(target, true)
        expect(rowFor(target, RETIRED_ID)).toBeUndefined()
        expect(rowFor(target, REDIRECTED_ID)).toBeUndefined()
        const deprecatedRow = rowFor(target, DEPRECATED_ID)
        expect(deprecatedRow?.textContent?.trim()).toBe(`${getModelInfo(DEPRECATED_ID).name} (retires 2026-11-30)`)
        expect(rowFor(target, OK_ID)?.textContent?.trim()).toBe(getModelInfo(OK_ID).name)
    })

    test('a selected value that is not listed still shows its name and tag on the button', () => {
        const target = mountList(RETIRED_ID)
        openPicker(target, true)
        expect(rowFor(target, RETIRED_ID)).toBeUndefined()
        expect(closedButton(target).textContent).toContain(`(${language.modelStatus.retiredTag})`)
        expect(closedButton(target).textContent).toContain(getModelInfo(RETIRED_ID).fullName)
    })

    test('selecting an ok row writes the value, reports the change and removes the note', () => {
        const target = mountList(RETIRED_ID)
        expect(note(target)).not.toBeNull()
        openPicker(target, false)
        const row = rowFor(target, OK_ID)
        expect(row).toBeDefined()
        row?.click()
        flushSync()
        expect(bound.value).toBe(OK_ID)
        expect(changes).toEqual([OK_ID])
        expect(note(target)).toBeNull()
        expect(closedButton(target).textContent?.trim()).toBe(getModelInfo(OK_ID).fullName)
    })
})

describe('showRetired (the parameter key chooser)', () => {
    test('lists retired and redirected ids with their tag, and selecting one writes the value', () => {
        const target = mountList(OK_ID, { showRetired: true })
        openPicker(target, true)
        const retiredRow = rowFor(target, RETIRED_ID)
        const redirectedRow = rowFor(target, REDIRECTED_ID)
        expect(retiredRow?.textContent?.trim()).toBe(`${getModelInfo(RETIRED_ID).name} (${language.modelStatus.retiredTag})`)
        expect(redirectedRow?.textContent?.trim()).toBe(`${getModelInfo(REDIRECTED_ID).name} (now uses gemini-3.8-flash)`)
        redirectedRow?.click()
        flushSync()
        expect(bound.value).toBe(REDIRECTED_ID)
        expect(changes).toEqual([REDIRECTED_ID])
    })

    test('guard: without the prop those ids are absent, and the prop leaves the note for the bound value unchanged', () => {
        const without = mountList(OK_ID)
        openPicker(without, true)
        expect(rowFor(without, RETIRED_ID)).toBeUndefined()
        expect(rowFor(without, REDIRECTED_ID)).toBeUndefined()

        const withProp = mountList(RETIRED_ID, { showRetired: true })
        const info = getModelInfo(RETIRED_ID)
        expect(closedButton(withProp).textContent?.trim()).toBe(`${info.fullName} (${language.modelStatus.retiredTag})`)
        expect(note(withProp)?.textContent?.trim()).toBe(fillLang(language.modelStatus.retiredWarning, { model: info.fullName ?? info.name }))
    })
})
