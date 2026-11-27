// @vitest-environment jsdom

/**
 * `ModelList.svelte` carries the overlay vocabulary on the elements of its opened picker only (#438 W3-5). The REAL component is mounted with the
 * mocks of `ModelList.names.svelte.test.ts`; each element is found by tag, aria-label, text or structure, never by its part, and the part is
 * asserted on it together with its direct parent. The inline trigger and both notes stay unparted.
 *
 * Tests starting `acceptance:` fail on the base (every part is absent). Tests starting `guard:` pass before and after.
 * MOCKED: the database, stores, Horde fetch, model-data store, network, platform and plugin stores. Synthetic data only.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
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
    getHordeModels: vi.fn(async () => [{ name: 'horde-model', performance: 1.5 }]),
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
import { getHordeModels } from 'src/ts/horde/getModels'
import { DBState } from 'src/ts/stores.svelte'
import ModelList from './ModelList.svelte'

const RETIRED_ID = 'claude-3-opus-20240229'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountList(value: string, open: boolean, onChange?: (v: string) => void): HTMLElement {
    DBState.db = { customModels: [{ id: 'zz-custom', name: 'Zz Custom' }] } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ModelList, { target, props: { value, blankable: true, onChange } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    if (open) {
        ;(target.querySelector(':scope > button') as HTMLButtonElement).click()
        flushSync()
    }
    return target
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const partOf = (el: Element | null): string | null => el?.getAttribute('data-part') ?? null

/** The only element of the selector whose trimmed text is exactly `text`. */
function byText(root: ParentNode, selector: string, text: string): HTMLElement {
    const found = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => el.textContent?.trim() === text)
    expect(found, `${selector} with text ${text}`).toHaveLength(1)
    return found[0]
}

/** The names of the parted elements as a nested string: `name(child child)`; an element without a part is looked through. */
function outline(el: Element): string {
    const inner = Array.from(el.children).map(outline).filter((text) => text !== '').join(' ')
    const name = partOf(el)
    if (name === null) return inner
    return inner === '' ? name : `${name}(${inner})`
}

function layerOf(target: HTMLElement): HTMLElement {
    return target.firstElementChild as HTMLElement
}

function frameOf(target: HTMLElement): HTMLElement {
    return layerOf(target).firstElementChild as HTMLElement
}

/** The body of the accordion whose header text is `name`, opened by a click. */
function openAccordion(frame: HTMLElement, name: string): HTMLElement {
    const header = byText(frame, 'div > button:first-child', name)
    header.click()
    flushSync()
    return header.nextElementSibling as HTMLElement
}

describe('ModelList overlay parts', () => {
    test('acceptance: the layer identity root and the frame', () => {
        const target = mountList('', true)
        const layer = layerOf(target)
        expect(partOf(layer)).toBe('modal-model-list')
        expect(layer.parentElement).toBe(target)
        const frame = frameOf(target)
        expect(partOf(frame)).toBe('modal-frame')
        expect(frame.parentElement).toBe(layer)
    })

    test('acceptance: the header, close and title', () => {
        const target = mountList('', true)
        const frame = frameOf(target)
        const header = frame.firstElementChild as HTMLElement
        expect(partOf(header)).toBe('modal-header')
        const close = byText(frame, `button[aria-label="${language.settingsPage.back}"]`, '')
        expect(partOf(close)).toBe('modal-close')
        expect(close.parentElement).toBe(header)
        const title = byText(frame, 'h1', language.model)
        expect(partOf(title)).toBe('modal-title')
        expect(title.parentElement).toBe(header)
        expect(partOf(frame.children[1])).toBeNull()
    })

    test('acceptance: an as-is row is a row of the frame', () => {
        const target = mountList('', true)
        const frame = frameOf(target)
        const row = byText(frame, ':scope > button', 'Ooba')
        expect(partOf(row)).toBe('modal-row')
        expect(row.parentElement).toBe(frame)
    })

    test('acceptance: a provider accordion has no part and its model rows are rows of its body', () => {
        const target = mountList('', true)
        const frame = frameOf(target)
        const header = byText(frame, 'div > button:first-child', 'OpenAI')
        expect(partOf(header)).toBeNull()
        const wrapper = header.parentElement as HTMLElement
        expect(partOf(wrapper)).toBeNull()
        expect(wrapper.parentElement).toBe(frame)
        const body = openAccordion(frame, 'OpenAI')
        expect(partOf(body)).toBeNull()
        const first = body.firstElementChild as HTMLElement
        expect(partOf(first)).toBe('modal-row')
        expect(first.parentElement).toBe(body)
        expect(outline(body)).toMatch(/^modal-row( modal-row)*$/)
    })

    test('acceptance: the Horde rows and their subtexts', async () => {
        const target = mountList('', true)
        const frame = frameOf(target)
        const body = openAccordion(frame, 'Horde')
        await new Promise((resolve) => setTimeout(resolve, 10))
        flushSync()
        expect(outline(body)).toBe('modal-row(modal-text) modal-row(modal-text)')
        const auto = Array.from(body.querySelectorAll<HTMLElement>(':scope > button')).find((b) => b.textContent?.includes(language.uiCommon.autoModel)) as HTMLElement
        expect(partOf(auto)).toBe('modal-row')
        const autoText = byText(auto, 'span', language.uiCommon.performanceAuto)
        expect(partOf(autoText)).toBe('modal-text')
        expect(autoText.parentElement).toBe(auto)
        const hordeRow = Array.from(body.querySelectorAll<HTMLElement>(':scope > button')).find((b) => b.textContent?.includes('horde-model')) as HTMLElement
        expect(partOf(hordeRow)).toBe('modal-row')
        const hordeText = byText(hordeRow, 'span', fillLang(language.uiCommon.performance, { value: '1.5' }))
        expect(partOf(hordeText)).toBe('modal-text')
        expect(hordeText.parentElement).toBe(hordeRow)
    })

    test('acceptance: a custom model row is a row of its accordion body', () => {
        const target = mountList('', true)
        const frame = frameOf(target)
        const body = openAccordion(frame, language.customModels)
        const row = byText(body, 'button', 'Zz Custom')
        expect(partOf(row)).toBe('modal-row')
        expect(row.parentElement).toBe(body)
        expect(partOf(body)).toBeNull()
        expect(outline(body)).toBe('modal-row')
    })

    test('acceptance: the None row, the footer and the whole outline', () => {
        const target = mountList('', true)
        const frame = frameOf(target)
        const none = byText(frame, ':scope > button', language.none)
        expect(partOf(none)).toBe('modal-row')
        expect(none.parentElement).toBe(frame)
        const checkbox = frame.querySelector('input[type=checkbox]') as HTMLElement
        const footer = frame.lastElementChild as HTMLElement
        expect(footer.contains(checkbox)).toBe(true)
        expect(partOf(footer)).toBe('modal-footer')
        expect(footer.parentElement).toBe(frame)
        for (let el = checkbox.parentElement; el && el !== footer; el = el.parentElement) {
            expect(partOf(el)).toBeNull()
        }
        expect(outline(target)).toMatch(/^modal-model-list\(modal-frame\(modal-header\(modal-close modal-title\)( modal-row)+ modal-footer\)\)$/)
    })

    test('guard: a pending Horde fetch leaves its loading row unparted', async () => {
        vi.mocked(getHordeModels).mockImplementationOnce(() => new Promise(() => {}))
        const target = mountList('', true)
        const frame = frameOf(target)
        const body = openAccordion(frame, 'Horde')
        const loading = byText(body, 'button', language.loadingEllipsis)
        expect(partOf(loading)).toBeNull()
        expect(outline(body)).toBe('')
    })

    test('guard: the source note and the trigger carry no part, closed or open', () => {
        const target = mountList('dynamic_google_gemini-ghost', false)
        expect(target.querySelectorAll('[data-part]')).toHaveLength(0)
        const trigger = target.querySelector(':scope > button') as HTMLElement
        const note = target.querySelector('p[data-testid="model-source-note"]') as HTMLElement
        expect(trigger).not.toBeNull()
        expect(note).not.toBeNull()
        expect(partOf(trigger)).toBeNull()
        expect(partOf(note)).toBeNull()
        trigger.click()
        flushSync()
        const layer = layerOf(target)
        for (const el of Array.from(target.querySelectorAll('[data-part]'))) {
            expect(layer.contains(el)).toBe(true)
        }
        expect(partOf(target.querySelector('p[data-testid="model-source-note"]'))).toBeNull()
    })

    test('guard: the status note carries no part, closed or open', () => {
        const target = mountList(RETIRED_ID, false)
        const note = target.querySelector('p[data-testid="model-status-note"]') as HTMLElement
        expect(note).not.toBeNull()
        expect(partOf(note)).toBeNull()
        expect(target.querySelectorAll('[data-part]')).toHaveLength(0)
        ;(target.querySelector(':scope > button') as HTMLButtonElement).click()
        flushSync()
        const layer = layerOf(target)
        for (const el of Array.from(target.querySelectorAll('[data-part]'))) {
            expect(layer.contains(el)).toBe(true)
        }
        expect(partOf(target.querySelector('p[data-testid="model-status-note"]'))).toBeNull()
    })

    test('guard: layer and Back close, the frame keeps it open, a row picks and closes', () => {
        const onChange = vi.fn()
        const target = mountList('', true, onChange)
        let frame = frameOf(target)
        ;(frame.firstElementChild as HTMLElement).click()
        flushSync()
        expect(layerOf(target).tagName).toBe('DIV')
        expect(target.querySelector('h1')).not.toBeNull()
        ;(target.querySelector(`button[aria-label="${language.settingsPage.back}"]`) as HTMLButtonElement).click()
        flushSync()
        expect(target.querySelector('h1')).toBeNull()

        ;(target.querySelector(':scope > button') as HTMLButtonElement).click()
        flushSync()
        layerOf(target).click()
        flushSync()
        expect(target.querySelector('h1')).toBeNull()

        ;(target.querySelector(':scope > button') as HTMLButtonElement).click()
        flushSync()
        frame = frameOf(target)
        byText(frame, ':scope > button', 'Ooba').click()
        flushSync()
        expect(onChange).toHaveBeenCalledTimes(1)
        expect(onChange).toHaveBeenCalledWith('ooba')
        expect(target.querySelector('h1')).toBeNull()
    })
})
