// @vitest-environment jsdom

/**
 * `HypaV3Modal.svelte`, `modal-header.svelte` and `modal-footer.svelte` carry the overlay vocabulary on their real elements (#438 W3-6a). The REAL
 * modal is mounted with its real children, the real `WindowedSegment` and the real windowing geometry hook over a real `$state` database; each
 * element is found by tag, text, aria-label, placeholder or structure, never by its part, and the part is asserted on it together with its direct
 * parent. The outline tests pin the whole nesting, so a part that is dropped, renamed, swapped with a sibling or its parent, or moved inward or
 * outward fails.
 *
 * Tests starting `acceptance:` fail on the base (every part is absent). Tests starting `guard:` pass before and after.
 * MOCKED: the alerts, the summarizer, the translator, the script engine and the save marks, as in `HypaV3Modal.names.svelte.test.ts`. Synthetic data only.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const hoisted = vi.hoisted(() => ({
    settings: { processRegexScript: false, preserveOrphanedMemory: false, doNotSummarizeUserMessage: false },
    processScriptFull: vi.fn(),
}))

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: vi.fn(async () => true),
        alertStore: writable({ type: 'none', msg: '' }),
    }
    return new Proxy(stub, {
        get: (t, k) => {
            if (k in t) return t[k as string]
            if (k === 'then' || typeof k === 'symbol') return undefined
            return vi.fn(async () => {})
        },
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        hypaV3ModalOpen: writable(false),
        settingsOpen: writable(false),
        SettingsMenuIndex: writable(0),
        selIdState: { selId: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    summarize: vi.fn(async () => 'REROLLED'),
    getCurrentHypaV3Preset: vi.fn(() => ({ settings: hoisted.settings })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/translator/translator'), () => ({
    translateHTML: vi.fn(async (text: string) => text),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/scripts'), () => ({
    processScriptFull: hoisted.processScriptFull,
    risuChatParser: vi.fn((text: string) => text),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/process/moduleRefList'), () => ({
    hasModuleStubs: vi.fn(() => false),
}) as unknown as typeof import('src/ts/process/moduleRefList'))

vi.mock(import('src/ts/process/moduleEnsure'), () => ({
    ensureCurrentModulesOrAlert: vi.fn(async (): Promise<boolean> => true),
}) as unknown as typeof import('src/ts/process/moduleEnsure'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

//#endregion

import { language } from 'src/lang'
import { alertConfirm } from 'src/ts/alert'
import { DBState, hypaV3ModalOpen } from 'src/ts/stores.svelte'
import { allRowsGeometry, setWindowGeometryForTests } from 'src/ts/windowing/windowHost.svelte'
import HypaV3Modal from './HypaV3Modal.svelte'
import ModalFooter from './HypaV3Modal/modal-footer.svelte'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

type Installed = { firstMessage?: string, withNext?: boolean }

/** Three summaries over the messages `s0`..`s2`; `memo-next` is the message after the last memo unless `withNext` is false. */
function installDb(texts: string[], { firstMessage = 'hello', withNext = true }: Installed = {}): void {
    const message = texts.map((text) => ({ chatId: 'memo-' + text, role: 'char', data: 'body of ' + text, time: 0 }))
    if (withNext) message.push({ chatId: 'memo-next', role: 'char', data: 'body of next', time: 0 })
    DBState.db = {
        characters: [{
            chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, firstMessage, chats: [{
                id: 'chat-a', name: '', note: '', localLore: [],
                message,
                hypaV3Data: {
                    summaries: texts.map((text, i) => ({ text, chatMemos: ['memo-' + text], isImportant: i === 0 })),
                    categories: [{ id: '', name: 'none' }],
                    lastSelectedSummaries: [],
                    metrics: { lastImportantSummaries: [0], lastRecentSummaries: [1], lastSimilarSummaries: [2], lastRandomSummaries: [] },
                },
            }],
        }],
    } as unknown as Database
}

const chatOf = () => DBState.db.characters[0].chats[0]

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

async function mountModal(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(HypaV3Modal, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    // The windowed cards mount once the host has read the band.
    await Promise.resolve()
    flushSync()
    await Promise.resolve()
    flushSync()
    await settle()
    return target
}

async function mountFooter(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ModalFooter, { target, props: { hypaV3Data: chatOf().hypaV3Data } } as never) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    await settle()
    return target
}

beforeEach(() => {
    // Every card falls in the window: these tests are about where the parts sit, not about which cards are in the page.
    setWindowGeometryForTests(allRowsGeometry())
    hoisted.settings.processRegexScript = false
    hoisted.settings.preserveOrphanedMemory = false
    hoisted.settings.doNotSummarizeUserMessage = false
    hoisted.processScriptFull.mockReset()
    vi.mocked(alertConfirm).mockClear()
    hypaV3ModalOpen.set(false)
    installDb(['s0', 's1', 's2'])
    Element.prototype.scrollIntoView = () => {}
})

afterEach(async () => {
    setWindowGeometryForTests(undefined)
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const partOf = (el: Element | null): string | null => el?.getAttribute('data-part') ?? null
const norm = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()

/** The only element of the selector whose normalised text is exactly `text`. */
function byText(root: ParentNode, selector: string, text: string): HTMLElement {
    const found = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => norm(el.textContent) === norm(text))
    expect(found, `${selector} with text ${text}`).toHaveLength(1)
    return found[0]
}

/** The only button of the root whose aria-label is exactly `label`. */
function byLabel(root: ParentNode, label: string): HTMLButtonElement {
    const found = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).filter((el) => el.getAttribute('aria-label') === label)
    expect(found, `button labelled ${label}`).toHaveLength(1)
    return found[0]
}

/** The names of the parted elements as a nested string: `name(child child)`; an element without a part is looked through. */
function outline(el: Element): string {
    const inner = Array.from(el.children).map(outline).filter((text) => text !== '').join(' ')
    const name = partOf(el)
    if (name === null) return inner
    return inner === '' ? name : `${name}(${inner})`
}

/** The outline of what an element holds, without the element's own part. */
const inside = (el: Element): string => Array.from(el.children).map(outline).filter((text) => text !== '').join(' ')

const frameOf = (target: HTMLElement) => (target.firstElementChild!.firstElementChild as HTMLElement).firstElementChild as HTMLElement
const headerOf = (target: HTMLElement) => frameOf(target).firstElementChild as HTMLElement
const bodyOf = (target: HTMLElement) => frameOf(target).children[1] as HTMLElement

async function openSearch(target: HTMLElement): Promise<void> {
    byLabel(headerOf(target), language.search).click()
    await settle()
}

async function openDropdown(target: HTMLElement): Promise<void> {
    byLabel(headerOf(target), language.chatShellMoreActions).click()
    await settle()
}

const HEADER_CLOSED = 'modal-header(modal-title modal-controls(modal-action modal-action modal-action modal-action modal-action modal-action modal-close))'
const HEADER_OPEN = 'modal-header(modal-title modal-controls(modal-action modal-action modal-action modal-action modal-action modal-action modal-list(modal-action modal-action modal-action modal-action) modal-close))'
const CARD = 'modal-row(modal-text modal-text modal-action modal-controls(modal-action modal-action modal-action modal-action modal-action) modal-field modal-action modal-action)'

const CONVERSION = {
    hypaV3Data: { summaries: [], categories: [], lastSelectedSummaries: [] },
    hypaV2Data: { mainChunks: [{ text: 'v2', chatMemos: ['memo-x'] }], chunks: [], lastMainChunkID: 0 },
}

function installEmpty(withConversion: boolean): void {
    installDb([])
    chatOf().hypaV3Data = CONVERSION.hypaV3Data as never
    if (withConversion) (chatOf() as unknown as Record<string, unknown>).hypaV2Data = CONVERSION.hypaV2Data
}

describe('HypaV3Modal overlay parts', () => {
    test('acceptance: the identity layer and the frame', async () => {
        const target = await mountModal()
        const layer = target.firstElementChild as HTMLElement
        expect(partOf(layer)).toBe('modal-hypa-v3')
        expect(layer.parentElement).toBe(target)
        const wrapper = layer.firstElementChild as HTMLElement
        expect(partOf(wrapper)).toBeNull()
        const frame = wrapper.firstElementChild as HTMLElement
        expect(partOf(frame)).toBe('modal-frame')
        expect(frame.parentElement).toBe(wrapper)
    })

    test('acceptance: the header, its title, its controls and the close button', async () => {
        const target = await mountModal()
        const frame = frameOf(target)
        const header = frame.firstElementChild as HTMLElement
        expect(partOf(header)).toBe('modal-header')
        expect(header.parentElement).toBe(frame)
        const title = byText(frame, 'h1', language.hypaV3Modal.titleLabel)
        expect(partOf(title)).toBe('modal-title')
        expect(title.parentElement).toBe(header)
        const controls = title.nextElementSibling as HTMLElement
        expect(partOf(controls)).toBe('modal-controls')
        expect(controls.parentElement).toBe(header)
        for (const label of [language.search, language.hypaV3ImportantOnly, language.hypaV3BulkEdit, language.hypaV3Modal.categoryManager, language.settings]) {
            const button = byLabel(header, label)
            expect(partOf(button), label).toBe('modal-action')
            expect(button.parentElement, label).toBe(controls)
        }
        const more = byLabel(header, language.chatShellMoreActions)
        expect(partOf(more)).toBe('modal-action')
        const relative = more.parentElement as HTMLElement
        expect(partOf(relative)).toBeNull()
        expect(relative.parentElement).toBe(controls)
        const close = byLabel(header, language.uiCommon.close)
        expect(partOf(close)).toBe('modal-close')
        expect(close.parentElement).toBe(controls)
        expect(outline(header)).toBe(HEADER_CLOSED)
    })

    test('acceptance: the dropdown list and its four actions', async () => {
        const target = await mountModal()
        await openDropdown(target)
        const header = headerOf(target)
        const more = byLabel(header, language.chatShellMoreActions)
        const menu = more.nextElementSibling as HTMLElement
        expect(partOf(menu)).toBe('modal-list')
        expect(partOf(menu.parentElement)).toBeNull()
        const row = menu.firstElementChild as HTMLElement
        expect(partOf(row)).toBeNull()
        expect(row.parentElement).toBe(menu)
        for (const label of [language.hypaV3ShowMetrics, language.hypaV3Modal.exportToLorebookLabel, language.hypaV3Modal.importFromLorebookLabel, language.reset]) {
            const button = byLabel(menu, label)
            expect(partOf(button), label).toBe('modal-action')
            expect(button.parentElement, label).toBe(row)
        }
        expect(outline(header)).toBe(HEADER_OPEN)
    })

    test('acceptance: the body, the unparted list, the cards and the two footers', async () => {
        const target = await mountModal()
        const frame = frameOf(target)
        const body = frame.children[1] as HTMLElement
        expect(partOf(body)).toBe('modal-body')
        expect(body.parentElement).toBe(frame)
        const list = body.querySelector(':scope > [role=list]') as HTMLElement
        expect(list).not.toBeNull()
        expect(partOf(list)).toBeNull()
        expect(list.parentElement).toBe(body)
        const items = Array.from(body.querySelectorAll<HTMLElement>('[role=listitem]'))
        expect(items).toHaveLength(3)
        for (const item of items) {
            expect(partOf(item)).toBeNull()
            expect(partOf(item.firstElementChild)).toBe('modal-row')
            expect((item.firstElementChild as HTMLElement).parentElement).toBe(item)
        }
        expect(outline(target)).toBe(`modal-hypa-v3(modal-frame(${HEADER_CLOSED} modal-body(${CARD} ${CARD} ${CARD} modal-footer(modal-text modal-field) modal-footer(modal-text))))`)
    })

    test('acceptance: the footer previews the next target and the summarisation condition', async () => {
        const target = await mountModal()
        const body = bodyOf(target)
        const second = body.lastElementChild as HTMLElement
        const first = second.previousElementSibling as HTMLElement
        for (const footer of [first, second]) {
            expect(partOf(footer)).toBe('modal-footer')
            expect(footer.parentElement).toBe(body)
        }
        const label = byText(first, 'div', language.hypaV3Modal.nextSummarizationLabel.replace('{0}', 'memo-next'))
        expect(partOf(label)).toBe('modal-text')
        expect(label.parentElement).toBe(first)
        const preview = Array.from(first.querySelectorAll('textarea')).filter((t) => t.value === 'body of next')
        expect(preview).toHaveLength(1)
        expect(partOf(preview[0])).toBe('modal-field')
        expect(preview[0].parentElement).toBe(first)
        const condition = byText(second, 'div', language.hypaV3Modal.summarizationConditionLabel)
        expect(partOf(condition)).toBe('modal-text')
        expect(condition.parentElement).toBe(second)
    })

    test('acceptance: the search bar, its field, its buttons and its result counter', async () => {
        const target = await mountModal()
        await openSearch(target)
        const body = bodyOf(target)
        const bar = body.firstElementChild as HTMLElement
        expect(partOf(bar)).toBe('modal-controls')
        expect(bar.parentElement).toBe(body)
        const input = bar.querySelector('input[placeholder]') as HTMLInputElement
        expect(partOf(input)).toBe('modal-field')
        const form = input.parentElement as HTMLElement
        expect(form.tagName).toBe('FORM')
        expect(partOf(form)).toBeNull()
        const relative = form.parentElement as HTMLElement
        expect(partOf(relative)).toBeNull()
        const inner = relative.parentElement as HTMLElement
        expect(partOf(inner)).toBeNull()
        expect(inner.parentElement).toBe(bar)
        const sr = bar.querySelector('span.sr-only') as HTMLElement
        expect(norm(sr.textContent)).toBe(norm(language.search))
        expect(partOf(sr)).toBeNull()
        for (const label of [language.chatShellFindPrev, language.chatShellFindNext]) {
            const button = byLabel(bar, label)
            expect(partOf(button), label).toBe('modal-action')
            expect(button.parentElement, label).toBe(inner)
        }
        expect(outline(bar)).toBe('modal-controls(modal-field modal-action modal-action)')

        input.value = 's1'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        byLabel(bar, language.chatShellFindNext).click()
        await settle()
        const counter = bar.querySelector('span.absolute') as HTMLElement
        expect(norm(counter.textContent)).toBe('1/1')
        expect(partOf(counter)).toBe('modal-text')
        expect(counter.parentElement).toBe(relative)
        expect(outline(bar)).toBe('modal-controls(modal-field modal-text modal-action modal-action)')
    })

    test('acceptance: the empty state with a possible conversion', async () => {
        installEmpty(true)
        const target = await mountModal()
        const body = bodyOf(target)
        const card = body.firstElementChild as HTMLElement
        expect(partOf(card)).toBe('modal-controls')
        expect(card.parentElement).toBe(body)
        const inner = card.firstElementChild as HTMLElement
        expect(partOf(inner)).toBeNull()
        const label = byText(body, 'div', language.hypaV3Modal.convertLabel)
        expect(partOf(label)).toBe('modal-text')
        expect(label.parentElement).toBe(inner)
        const convert = byText(body, 'button', language.hypaV3Modal.convertButton)
        expect(partOf(convert)).toBe('modal-action')
        expect(convert.parentElement).toBe(inner)
        expect(inside(body)).toBe('modal-controls(modal-text modal-action) modal-footer(modal-text modal-field) modal-footer(modal-text)')
    })

    test('acceptance: the empty state without a conversion', async () => {
        installEmpty(false)
        const target = await mountModal()
        const body = bodyOf(target)
        const label = byText(body, 'div', language.hypaV3Modal.noSummariesLabel)
        expect(partOf(label)).toBe('modal-text')
        expect(label.parentElement).toBe(body)
        expect(inside(body)).toBe('modal-text modal-footer(modal-text modal-field) modal-footer(modal-text)')
    })

    test('acceptance: the footer says every message is summarised', async () => {
        installDb(['s0', 's1'], { withNext: false })
        const target = await mountFooter()
        const first = target.firstElementChild as HTMLElement
        const span = byText(first, 'span', language.hypaV3Modal.nextSummarizationNoMessagesFoundLabel)
        expect(partOf(span)).toBe('modal-text')
        expect(span.parentElement).toBe(first)
        expect(outline(target)).toBe('modal-footer(modal-text) modal-footer(modal-text)')
    })

    test('acceptance: the footer shows the load error of the next target', async () => {
        hoisted.settings.processRegexScript = true
        hoisted.processScriptFull.mockRejectedValue(new Error('boom'))
        const target = await mountFooter()
        const first = target.firstElementChild as HTMLElement
        const span = byText(first, 'span', language.hypaV3Modal.nextSummarizationLoadingError.replace('{0}', 'boom'))
        expect(partOf(span)).toBe('modal-text')
        expect(span.parentElement).toBe(first)
        expect(outline(target)).toBe('modal-footer(modal-text) modal-footer(modal-text)')
    })

    test('acceptance: the footer names a missing first message', async () => {
        installDb(['s0', 's1', 's2'], { firstMessage: '' })
        const target = await mountFooter()
        const second = target.lastElementChild as HTMLElement
        const span = byText(second, 'span', language.hypaV3Modal.emptySelectedFirstMessageLabel)
        expect(partOf(span)).toBe('modal-text')
        expect(span.parentElement).toBe(second)
        expect(outline(target)).toBe('modal-footer(modal-text modal-field) modal-footer(modal-text modal-text)')
    })
})

describe('HypaV3Modal unclaimed elements and behaviour', () => {
    test('guard: the list root, the item wrappers, the frame wrapper, div.relative, the form and the sr-only span carry no part', async () => {
        const target = await mountModal()
        await openSearch(target)
        await openDropdown(target)
        const root = target.querySelector('[role=list]') as HTMLElement
        expect(root).not.toBeNull()
        expect(partOf(root)).toBeNull()
        const items = Array.from(target.querySelectorAll('[role=listitem]'))
        expect(items.length).toBeGreaterThan(0)
        for (const item of items) expect(partOf(item)).toBeNull()
        expect(partOf(frameOf(target).parentElement)).toBeNull()
        expect(partOf(byLabel(headerOf(target), language.chatShellMoreActions).parentElement)).toBeNull()
        expect(partOf(target.querySelector('form'))).toBeNull()
        expect(partOf(target.querySelector('span.sr-only'))).toBeNull()
        expect(target.children.length).toBe(1)
    })

    test('guard: the close button closes, a frame click closes the dropdown, Reset confirms twice and Convert fills the store', async () => {
        hypaV3ModalOpen.set(true)
        const target = await mountModal()
        byLabel(headerOf(target), language.uiCommon.close).click()
        expect(get(hypaV3ModalOpen)).toBe(false)

        await openDropdown(target)
        const more = byLabel(headerOf(target), language.chatShellMoreActions)
        expect(more.nextElementSibling).not.toBeNull()
        byText(frameOf(target), 'h1', language.hypaV3Modal.titleLabel).click()
        flushSync()
        expect(more.nextElementSibling).toBeNull()

        await openDropdown(target)
        byLabel(headerOf(target), language.reset).click()
        await settle()
        expect(vi.mocked(alertConfirm)).toHaveBeenCalledTimes(2)
        expect(chatOf().hypaV3Data.summaries).toEqual([])
    })

    test('guard: Convert writes the V2 chunk as one V3 summary', async () => {
        installEmpty(true)
        const target = await mountModal()
        byText(bodyOf(target), 'button', language.hypaV3Modal.convertButton).click()
        await settle()
        expect(chatOf().hypaV3Data.summaries).toHaveLength(1)
        expect(chatOf().hypaV3Data.summaries[0].text).toBe('v2')
    })

    test('guard: the windowed list keeps all three cards mounted, so the outlines are complete (fixture)', async () => {
        const target = await mountModal()
        expect(target.querySelectorAll('[role=listitem]')).toHaveLength(3)
        expect(Array.from(target.querySelectorAll('[role=listitem]')).every((item) => partOf(item.firstElementChild) === 'modal-row' || partOf(item.firstElementChild) === null)).toBe(true)
        expect(target.querySelectorAll('input[type=checkbox], textarea').length).toBeGreaterThan(0)
    })
})
