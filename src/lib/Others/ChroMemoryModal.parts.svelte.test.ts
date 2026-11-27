// @vitest-environment jsdom

/**
 * `ChroMemoryModal.svelte`, `ChroMemoryModal/last-send-tab.svelte` and `ChroMemoryModal/index-tab.svelte` carry the overlay vocabulary on their
 * real elements (#438 W3-6b). The REAL modal and both tabs are mounted over a `$state` database and the real trace stores; each element is found
 * by tag, role, text or structure, never by its part, and the part is asserted on it together with its direct parent. The outline tests pin the
 * whole nesting, so a part that is dropped, renamed, swapped with a sibling or its parent, or put on an element that is promised to carry none
 * (the wrapper, icon, meter, line rows, item headers, the lore section, the shared Check and Button) fails.
 *
 * Tests starting `acceptance:` fail on the base (every part is absent). Tests starting `guard:` pass before and after.
 * MOCKED: `stores.svelte` (state and the open flag only), the alert module and `alertBack`, as in `ChroMemoryModal.svelte.test.ts`. Synthetic data only.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import { language } from 'src/lang'
import { fillLang } from 'src/lang/fill'

//#region module mocks

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: async () => true,
        alertStore: writable({ type: 'none', msg: '' }),
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' || typeof k === 'symbol' ? undefined : vi.fn(async () => {})),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        hypaV3ModalOpen: writable(true),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))

//#endregion

import { DBState, hypaV3ModalOpen, selectedCharID } from 'src/ts/stores.svelte'
import { installBackGuard, resetBackHandlersForTests } from 'src/ts/backHandlers'
import { chroLoreTrace, chroMemoryDiscarded, chroMemoryTrace } from 'src/ts/process/memory/chroMemory/traceStore'
import type { ChroLoreTrace } from 'src/ts/process/memory/chroMemory/loreRecall'
import type { ChroMemoryTrace } from 'src/ts/process/memory/chroMemory/shadow'
import ChroMemoryModal from './ChroMemoryModal.svelte'

const KEY = 'c0:chat'
const showToast = vi.fn()
const mounted: Array<ReturnType<typeof mount>> = []

function installDb(): void {
    DBState.db = {
        ltmEngine: true,
        ltmSettings: { budgetTokens: 900, future: { x: 1 } },
        characters: [{
            chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, firstMessage: '',
            chats: [{
                id: 'chat', name: '', note: '', localLore: [],
                message: [
                    { role: 'user', data: 'zero', chatId: 'm0' },
                    { role: 'char', data: 'one', chatId: 'm1' },
                    { role: 'user', data: `<b>bold</b>   ${'x'.repeat(200)}`, chatId: 'm2' },
                ],
            }],
        }],
    } as unknown as Database
    selectedCharID.set(0)
}

function traceFor(chatKey: string, patch: Partial<ChroMemoryTrace> = {}): ChroMemoryTrace {
    return {
        v: 1, mode: 'inject', chatKey, at: 1, ms: 12.4, outcome: 'injected',
        d0: { records: 30, units: 45, firstChatId: 'm0', lastChatId: 'm29' },
        index: { units: 45, removed: 1, added: 2, churn: 0.25, rebuilt: false, fresh: false, rebuildCause: null },
        rebuildCause: 'fresh',
        query: { chatId: 'm29', terms: ['alpha', 'beta'] },
        admission: 'none', budgetTokens: 900, T: 450, countCap: 12, slots: 3, counted: 3, countCapped: false,
        items: [
            { source: { kind: 'turn', chatId: 'm2', index: 2, off: 0 }, rank: { lexical: 1, dense: null, fused: null }, tokens: 100 },
            { source: { kind: 'turn', chatId: '#first', index: -1, off: 0 }, rank: { lexical: 2, dense: null, fused: null }, tokens: 50 },
        ],
        makeRoom: { room: 600, limit: 5000, reserved: 0, floor: 4, evictedChats: 3, evictedTokens: 321, itemsDropped: 2 },
        timings: { index: 1, rank: 1, pack: 1, room: 1 },
        timeBox: 'none', error: null, dense: null,
        ...patch,
    }
}

function loreTraceFor(chatKey: string, patch: Partial<ChroLoreTrace> = {}): ChroLoreTrace {
    return {
        v: 1, chatKey, at: 1, ms: 2, mode: 'inject', outcome: 'placed',
        query: { chars: 40, terms: 5 },
        budget: { loreToken: 2000, unused: 1500, cap: 5000, limit: 1500, used: 64 },
        candidates: { missed: 9, staticExcluded: 1, linked: 0, duplicate: 0, identityMiss: 0, eligible: 8 },
        admission: { tau: 0.02, rejected: 3 },
        index: { state: 'ready', entries: 77, buildMs: 3 },
        items: [
            { source: { kind: 'lore', from: 'chat', index: 4, name: 'Wyvern roost' }, rank: { lexical: 1, dense: null, fused: null }, score: 2.5, tokens: 40 },
            { source: { kind: 'lore', from: 'module', index: 9, name: 'Sky citadel' }, rank: { lexical: 2, dense: null, fused: null }, score: 1.5, tokens: 24 },
        ],
        renders: 2, droppedEmpty: 0, trimmed: null,
        ...patch,
    }
}

function mountModal(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(ChroMemoryModal, { target, props: {} }))
    flushSync()
    return target
}

const tabButton = (target: HTMLElement, label: string): HTMLButtonElement =>
    Array.from(target.querySelectorAll<HTMLButtonElement>('[role=tab]')).find((b) => b.textContent?.trim() === label)!

function openIndexTab(target: HTMLElement): void {
    tabButton(target, language.chroMemoryTabIndex).click()
    flushSync()
}

beforeEach(() => {
    showToast.mockReset()
    resetBackHandlersForTests()
    installBackGuard({ showToast })
    hypaV3ModalOpen.set(true)
    chroMemoryTrace.set(null)
    chroLoreTrace.set(null)
    chroMemoryDiscarded.set(null)
    installDb()
})

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
    resetBackHandlersForTests()
})

const partOf = (el: Element | null): string | null => el?.getAttribute('data-part') ?? null
const norm = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()

/** The only element of the selector whose normalised text is exactly `text`. */
function byText(root: ParentNode, selector: string, text: string): HTMLElement {
    const found = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => norm(el.textContent) === norm(text))
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

/** The outline of what an element holds, without the element's own part. */
const inside = (el: Element): string => Array.from(el.children).map(outline).filter((text) => text !== '').join(' ')

const bodyOf = (target: HTMLElement): HTMLElement => target.querySelector('[role=tabpanel]') as HTMLElement

/** Expects every element to carry `part` and to sit directly under `parent`. */
function expectAll(elements: Element[], part: string, parent: Element | null): void {
    expect(elements.length).toBeGreaterThan(0)
    for (const el of elements) {
        expect(partOf(el), el.outerHTML.slice(0, 80)).toBe(part)
        if (parent) expect(el.parentElement).toBe(parent)
    }
}

const CHRO0 = 'modal-chro-memory(modal-frame(modal-header(modal-title modal-close) modal-controls(modal-action modal-action) modal-body(modal-text)))'
const L1 = 'modal-list(modal-row(modal-text modal-text) modal-row(modal-text modal-text) modal-row(modal-text modal-text) modal-row(modal-text modal-text)) modal-text modal-list(modal-row(modal-text modal-text modal-text) modal-row(modal-text modal-text))'
const L2 = 'modal-title modal-row(modal-text modal-text modal-text modal-text) modal-list(modal-row(modal-text modal-text modal-text) modal-row(modal-text modal-text modal-text))'
const I0 = 'modal-controls(modal-text) modal-controls(modal-text) modal-controls(modal-text) modal-controls(modal-text)'
const I1 = 'modal-list(modal-row(modal-text modal-text) modal-row(modal-text modal-text) modal-row(modal-text modal-text) modal-row(modal-text modal-text)) modal-list(modal-row(modal-text modal-text)) modal-controls(modal-text) modal-controls(modal-text) modal-controls(modal-text modal-text) modal-controls(modal-text)'
const I2 = 'modal-controls(modal-text) modal-controls(modal-text) modal-controls(modal-text) modal-controls(modal-text modal-text)'

describe('ChroMemoryModal shell overlay parts', () => {
    test('acceptance: the identity layer, the frame, the header, the tabs and the panel, and no part on the wrapper or the close icon', () => {
        const target = mountModal()
        const layer = target.firstElementChild as HTMLElement
        expect(partOf(layer)).toBe('modal-chro-memory')
        expect(layer.parentElement).toBe(target)
        const wrapper = layer.firstElementChild as HTMLElement
        expect(partOf(wrapper)).toBeNull()
        expect(wrapper.parentElement).toBe(layer)
        const frame = wrapper.firstElementChild as HTMLElement
        expect(partOf(frame)).toBe('modal-frame')
        expect(frame.parentElement).toBe(wrapper)
        const header = frame.firstElementChild as HTMLElement
        expect(partOf(header)).toBe('modal-header')
        expect(header.parentElement).toBe(frame)
        const title = header.querySelector(':scope > h1') as HTMLElement
        expect(norm(title.textContent)).toBe(norm(language.chroMemoryModal))
        expectAll([title], 'modal-title', header)
        const close = header.querySelector(`:scope > button[aria-label="${language.uiCommon.close}"]`) as HTMLElement
        expectAll([close], 'modal-close', header)
        expect(partOf(close.querySelector('svg'))).toBeNull()
        const tablist = frame.querySelector(':scope > [role=tablist]') as HTMLElement
        expectAll([tablist], 'modal-controls', frame)
        expectAll(Array.from(tablist.querySelectorAll('[role=tab]')), 'modal-action', tablist)
        expect(tablist.querySelectorAll('[role=tab]')).toHaveLength(2)
        const panel = frame.querySelector(':scope > [role=tabpanel]') as HTMLElement
        expectAll([panel], 'modal-body', frame)
        expect(outline(target)).toBe(CHRO0)
    })

    test('acceptance: the no-send text is a text in the body', () => {
        const target = mountModal()
        const body = bodyOf(target)
        const none = byText(body, 'p', language.chroMemoryNoSend)
        expectAll([none], 'modal-text', body)
    })

    test('guard: the tab switch flips aria-selected and swaps the panel, and Close clears the open flag', () => {
        const target = mountModal()
        const last = tabButton(target, language.chroMemoryTabLastSend)
        const index = tabButton(target, language.chroMemoryTabIndex)
        expect(last.getAttribute('aria-selected')).toBe('true')
        index.click()
        flushSync()
        expect(index.getAttribute('aria-selected')).toBe('true')
        expect(last.getAttribute('aria-selected')).toBe('false')
        expect(bodyOf(target).textContent).toContain(language.chroMemoryRebuild)
        target.querySelector<HTMLButtonElement>(`button[aria-label="${language.uiCommon.close}"]`)!.click()
        flushSync()
        expect(get(hypaV3ModalOpen)).toBe(false)
    })
})

describe('Last send tab overlay parts', () => {
    test('acceptance: the trace tiles, the lines block and the items', () => {
        chroMemoryTrace.set(traceFor(KEY, {
            countCapped: true,
            dense: { state: 'ready', reason: null, vectors: 40, units: 45, queryMs: 5, ms: 9 },
        }))
        const target = mountModal()
        const body = bodyOf(target)
        const grid = body.firstElementChild as HTMLElement
        expectAll([grid], 'modal-list', body)
        expect(grid.children).toHaveLength(4)
        expectAll(Array.from(grid.children), 'modal-row', grid)
        for (const label of [language.chroMemoryOutcome, language.chroMemoryItems, language.chroMemoryTime, language.chroMemoryTokens]) {
            const labelEl = byText(grid, 'div', label)
            const tile = labelEl.parentElement as HTMLElement
            expect(tile.parentElement).toBe(grid)
            expectAll([labelEl, labelEl.nextElementSibling as HTMLElement], 'modal-text', tile)
        }
        const meter = body.querySelector('[role=meter]') as HTMLElement
        expect(partOf(meter)).toBeNull()
        expect(meter.parentElement!.parentElement).toBe(grid)
        expect(partOf(meter.parentElement)).toBe('modal-row')
        expect(meter.children).toHaveLength(1)
        expect(partOf(meter.firstElementChild)).toBeNull()

        const searched = byText(body, 'div', fillLang(language.chroMemorySearched, { records: 30, units: 45 }))
        const lines = searched.parentElement as HTMLElement
        expectAll([lines], 'modal-text', body)
        expect(lines.children).toHaveLength(6)
        expect(outline(lines)).toBe('modal-text')

        const list = body.querySelector('ul') as HTMLElement
        expectAll([list], 'modal-list', body)
        const items = Array.from(list.children)
        expect(items).toHaveLength(2)
        expectAll(items, 'modal-row', list)
        for (const item of items) {
            const header = item.firstElementChild as HTMLElement
            expect(partOf(header)).toBeNull()
            expect(header.parentElement).toBe(item)
            expectAll(Array.from(header.children), 'modal-text', header)
            expect(header.children).toHaveLength(2)
        }
        const excerpt = items[0].lastElementChild as HTMLElement
        expect(excerpt.textContent!.startsWith('<b>bold</b>')).toBe(true)
        expectAll([excerpt], 'modal-text', items[0])
        expect(items[1].children).toHaveLength(1)
        expect(inside(body)).toBe(L1)
    })

    test('acceptance: the lore section carries a title, a tile and a list and no part of its own', () => {
        chroLoreTrace.set(loreTraceFor(KEY, { trimmed: { removed: 2 } }))
        const target = mountModal()
        const body = bodyOf(target)
        const section = body.firstElementChild as HTMLElement
        expect(section.tagName).toBe('SECTION')
        expect(partOf(section)).toBeNull()
        expect(section.parentElement).toBe(body)
        const title = section.querySelector(':scope > h2') as HTMLElement
        expectAll([title], 'modal-title', section)
        const tile = section.querySelector(':scope > div') as HTMLElement
        expectAll([tile], 'modal-row', section)
        expect(tile.children).toHaveLength(4)
        expectAll(Array.from(tile.children), 'modal-text', tile)
        const list = section.querySelector(':scope > ul') as HTMLElement
        expectAll([list], 'modal-list', section)
        expectAll(Array.from(list.children), 'modal-row', list)
        for (const item of Array.from(list.children)) {
            const header = item.firstElementChild as HTMLElement
            expect(partOf(header)).toBeNull()
            expect(header.parentElement).toBe(item)
            expectAll(Array.from(header.children), 'modal-text', header)
            expectAll([item.lastElementChild as HTMLElement], 'modal-text', item)
        }
        expect(inside(body)).toBe(L2)
    })
})

describe('Index tab overlay parts', () => {
    test('acceptance: the four setting groups hold the shared Check and Button unparted and their descriptions are texts', () => {
        const target = mountModal()
        openIndexTab(target)
        const body = bodyOf(target)
        const labels = Array.from(body.querySelectorAll('label'))
        expect(labels).toHaveLength(3)
        const groups = labels.map((label) => label.parentElement as HTMLElement)
        for (const [i, label] of labels.entries()) {
            expect(partOf(label)).toBeNull()
            expectAll([groups[i]], 'modal-controls', body)
            expectAll([groups[i].querySelector(':scope > span') as HTMLElement], 'modal-text', groups[i])
        }
        const rebuild = byText(body, 'button', language.chroMemoryRebuild)
        expect(partOf(rebuild)).toBeNull()
        const wrapper = rebuild.parentElement as HTMLElement
        expect(partOf(wrapper)).toBeNull()
        const rebuildGroup = wrapper.parentElement as HTMLElement
        expectAll([rebuildGroup], 'modal-controls', body)
        expectAll([rebuildGroup.querySelector(':scope > span') as HTMLElement], 'modal-text', rebuildGroup)
        expect(body.querySelectorAll('input[type=checkbox]')).toHaveLength(3)
        for (const box of Array.from(body.querySelectorAll('input[type=checkbox]'))) expect(partOf(box)).toBeNull()
        expect(inside(body)).toBe(I0)
    })

    test('acceptance: the index tiles, the lore index tile and the English-only warning', () => {
        chroMemoryTrace.set(traceFor(KEY))
        chroLoreTrace.set(loreTraceFor(KEY))
        DBState.db.ltmSettings = { budgetTokens: 900, retrieval: 'hybrid' } as typeof DBState.db.ltmSettings
        DBState.db.hypaModel = 'bgeSmallEn' as typeof DBState.db.hypaModel
        const target = mountModal()
        openIndexTab(target)
        const body = bodyOf(target)
        const stats = byText(body, 'div', language.chroMemoryUnits).parentElement!.parentElement as HTMLElement
        const lore = byText(body, 'div', language.chroMemoryLoreIndex).parentElement!.parentElement as HTMLElement
        for (const grid of [stats, lore]) {
            expectAll([grid], 'modal-list', body)
            expectAll(Array.from(grid.children), 'modal-row', grid)
            for (const tile of Array.from(grid.children)) expectAll(Array.from(tile.children), 'modal-text', tile as HTMLElement)
        }
        expect(stats.children).toHaveLength(4)
        expect(lore.children).toHaveLength(1)
        const warning = byText(body, 'span', language.chroMemoryHybridEnglishOnly)
        expect(warning.getAttribute('role')).toBe('status')
        expectAll([warning], 'modal-text', warning.parentElement)
        expect(partOf(warning.parentElement)).toBe('modal-controls')
        expect(inside(body)).toBe(I1)
    })

    test('acceptance: after a discard the rebuilt notice is a text in the rebuild group and the tiles are gone', () => {
        chroMemoryTrace.set(traceFor(KEY))
        chroMemoryDiscarded.set(KEY)
        const target = mountModal()
        openIndexTab(target)
        const body = bodyOf(target)
        const notice = byText(body, 'span', language.chroMemoryRebuilt)
        expect(notice.getAttribute('role')).toBe('status')
        const group = notice.parentElement as HTMLElement
        expectAll([notice], 'modal-text', group)
        expect(partOf(group)).toBe('modal-controls')
        expect(group.parentElement).toBe(body)
        expect(inside(body)).toBe(I2)
    })
})
