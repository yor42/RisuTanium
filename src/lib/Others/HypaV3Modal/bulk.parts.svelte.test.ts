// @vitest-environment jsdom

/**
 * `bulk-edit-actions.svelte` and `bulk-resummary-result.svelte` carry the overlay vocabulary on their real elements (#438 W3-6b). The REAL
 * components are mounted; each element is found by tag, text, aria-label or structure, never by its part, and the part is asserted on it
 * together with its direct parent. The outline tests pin the whole nesting, so a part that is dropped, renamed, swapped with a sibling or its
 * parent, or put on an element that is promised to carry none (inner wrappers, sr-only labels, options, the translation wrapper, icons) fails.
 *
 * Tests starting `acceptance:` fail on the base (every part is absent). Tests starting `guard:` pass before and after.
 * MOCKED: the stores module (the selected character). Synthetic data only.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        selIdState: { selId: 0 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import BulkEditActions from './bulk-edit-actions.svelte'
import BulkResummaryResult from './bulk-resummary-result.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountBulk(component: unknown, props: Record<string, unknown>): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(component as never, { target, props } as never) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

function actionProps(selected: number[], overrides: Record<string, unknown> = {}) {
    return {
        bulkEditState: { isEnabled: true, selectedSummaries: new Set<number>(selected), selectedCategory: '', bulkSelectInput: '' },
        categories: [{ id: '', name: 'none' }, { id: 'k', name: 'K' }],
        showImportantOnly: false,
        selectedCategoryFilter: 'all',
        onResummarize: () => {},
        onClearSelection: () => {},
        onUpdateSelectedCategory: () => {},
        onUpdateBulkSelectInput: () => {},
        onApplyCategory: () => {},
        onToggleImportant: () => {},
        onParseAndSelectSummaries: () => {},
        ...overrides,
    }
}

function resultProps(state: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
    return {
        bulkResummaryState: { isProcessing: false, result: 'merged', heldSummaries: [], mergedChatMemos: [], isTranslating: false, translation: null, ...state },
        onToggleTranslation: () => {},
        onReroll: () => {},
        onApply: () => {},
        onCancel: () => {},
        ...overrides,
    }
}

beforeEach(() => {
    DBState.db = {
        characters: [{ chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, chats: [{ id: 'chat-a', message: [], hypaV3Data: { summaries: [], categories: [] } }] }],
    } as unknown as Database
})

afterEach(async () => {
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

const BAR = 'modal-footer(modal-controls(modal-action) modal-controls(modal-field modal-action modal-action modal-field modal-action modal-action))'
const RESULT_HEAD = 'modal-title modal-controls(modal-action modal-action modal-action modal-action)'

describe('bulk edit bar overlay parts', () => {
    test('acceptance: the bar, its two groups, every control and no part on the wrappers, labels, options or icon', async () => {
        const target = mountBulk(BulkEditActions, actionProps([0, 1]))
        const footer = target.firstElementChild as HTMLElement
        expect(partOf(footer)).toBe('modal-footer')
        expect(footer.parentElement).toBe(target)
        const inner = footer.firstElementChild as HTMLElement
        expect(partOf(inner)).toBeNull()
        expect(inner.parentElement).toBe(footer)
        expect(inner.children).toHaveLength(2)
        const left = inner.children[0] as HTMLElement
        const right = inner.children[1] as HTMLElement
        for (const group of [left, right]) {
            expect(partOf(group)).toBe('modal-controls')
            expect(group.parentElement).toBe(inner)
        }
        const resummarize = byText(left, 'button', language.hypaV3Modal.reSummarize)
        expect(partOf(resummarize)).toBe('modal-action')
        expect(resummarize.parentElement).toBe(left)

        const categoryLabel = right.querySelector(':scope > span.sr-only') as HTMLElement
        expect(partOf(categoryLabel)).toBeNull()
        expect(categoryLabel.parentElement).toBe(right)
        const select = right.querySelector(':scope > select') as HTMLElement
        expect(partOf(select)).toBe('modal-field')
        expect(select.parentElement).toBe(right)
        const options = Array.from(select.querySelectorAll('option'))
        expect(options).toHaveLength(2)
        for (const option of options) {
            expect(partOf(option)).toBeNull()
            expect(option.parentElement).toBe(select)
        }
        for (const button of [byText(right, 'button', language.apply), byLabel(right, language.hypaV3BulkImportant), byText(right, 'button', language.cancel)]) {
            expect(partOf(button)).toBe('modal-action')
            expect(button.parentElement).toBe(right)
        }
        const star = byLabel(right, language.hypaV3BulkImportant).querySelector('svg') as SVGElement
        expect(partOf(star)).toBeNull()

        const numberRow = right.querySelector(':scope > div') as HTMLElement
        expect(partOf(numberRow)).toBeNull()
        expect(numberRow.parentElement).toBe(right)
        const numberLabel = numberRow.querySelector(':scope > span.sr-only') as HTMLElement
        expect(partOf(numberLabel)).toBeNull()
        expect(numberLabel.parentElement).toBe(numberRow)
        const numberField = numberRow.querySelector(':scope > input[type=text]') as HTMLElement
        expect(partOf(numberField)).toBe('modal-field')
        expect(numberField.parentElement).toBe(numberRow)
        const selectButton = byText(numberRow, 'button', language.select)
        expect(partOf(selectButton)).toBe('modal-action')
        expect(selectButton.parentElement).toBe(numberRow)

        expect(outline(target)).toBe(BAR)
    })

    test('acceptance: the outline holds for an empty selection too', async () => {
        expect(outline(mountBulk(BulkEditActions, actionProps([])))).toBe(BAR)
    })

    test('guard: nothing renders while bulk edit is off, and the controls call their callbacks once', async () => {
        expect(mountBulk(BulkEditActions, actionProps([0, 1], { bulkEditState: { isEnabled: false, selectedSummaries: new Set<number>(), selectedCategory: '', bulkSelectInput: '' } })).children).toHaveLength(0)
        const calls = { resummarize: vi.fn(), clear: vi.fn() }
        const target = mountBulk(BulkEditActions, actionProps([0, 1], { onResummarize: calls.resummarize, onClearSelection: calls.clear }))
        byText(target, 'button', language.hypaV3Modal.reSummarize).click()
        byText(target, 'button', language.cancel).click()
        expect(calls.resummarize).toHaveBeenCalledTimes(1)
        expect(calls.clear).toHaveBeenCalledTimes(1)
    })
})

describe('bulk re-summary result overlay parts', () => {
    test('acceptance: the panel, its title row, controls and result field and no part on the wrappers or icons', async () => {
        const target = mountBulk(BulkResummaryResult, resultProps({}))
        const footer = target.firstElementChild as HTMLElement
        expect(partOf(footer)).toBe('modal-footer')
        expect(footer.parentElement).toBe(target)
        const column = footer.firstElementChild as HTMLElement
        expect(partOf(column)).toBeNull()
        expect(column.parentElement).toBe(footer)
        const row = column.firstElementChild as HTMLElement
        expect(partOf(row)).toBeNull()
        expect(row.parentElement).toBe(column)
        const title = byText(row, 'h3', language.hypaV3Modal.reSummarizeResult)
        expect(partOf(title)).toBe('modal-title')
        expect(title.parentElement).toBe(row)
        const controls = title.nextElementSibling as HTMLElement
        expect(partOf(controls)).toBe('modal-controls')
        expect(controls.parentElement).toBe(row)
        for (const label of [language.hypaV3Modal.translate, language.hypaV3Modal.retry, language.apply, language.cancel]) {
            const button = byLabel(controls, label)
            expect(partOf(button)).toBe('modal-action')
            expect(button.parentElement).toBe(controls)
            expect(partOf(button.querySelector('svg'))).toBeNull()
        }
        const area = column.querySelector(':scope > textarea') as HTMLElement
        expect(partOf(area)).toBe('modal-field')
        expect(area.parentElement).toBe(column)
        expect(outline(target)).toBe(`modal-footer(${RESULT_HEAD} modal-field)`)
    })

    test('acceptance: the translation wrapper carries no part and its label and field do', async () => {
        const target = mountBulk(BulkResummaryResult, resultProps({ translation: 'T' }))
        const column = (target.firstElementChild as HTMLElement).firstElementChild as HTMLElement
        const areas = Array.from(column.querySelectorAll('textarea'))
        expect(areas).toHaveLength(2)
        const field = areas[1]
        const label = field.previousElementSibling as HTMLElement
        expect(norm(label.textContent)).toBe(norm(language.hypaV3Modal.translationLabel))
        expect(partOf(label)).toBe('modal-text')
        const wrapper = label.parentElement as HTMLElement
        expect(partOf(wrapper)).toBeNull()
        expect(wrapper.parentElement).toBe(column)
        expect(partOf(field)).toBe('modal-field')
        expect(field.parentElement).toBe(wrapper)
        expect(outline(target)).toBe(`modal-footer(${RESULT_HEAD} modal-field modal-text modal-field)`)
    })

    test('acceptance: while processing the busy text carries a part and its icon none', async () => {
        const target = mountBulk(BulkResummaryResult, resultProps({ isProcessing: true, result: null }))
        const column = (target.firstElementChild as HTMLElement).firstElementChild as HTMLElement
        const busy = byText(column, 'div', language.hypaV3Modal.reSummarizing)
        expect(partOf(busy)).toBe('modal-text')
        expect(busy.parentElement).toBe(column)
        const icon = busy.querySelector('svg') as SVGElement
        expect(icon).not.toBeNull()
        expect(partOf(icon)).toBeNull()
        expect(outline(target)).toBe(`modal-footer(${RESULT_HEAD} modal-text)`)
    })

    test('acceptance: with no result the panel holds only the title row', async () => {
        expect(outline(mountBulk(BulkResummaryResult, resultProps({ result: null })))).toBe(`modal-footer(${RESULT_HEAD})`)
    })

    test('guard: nothing renders without a state, and Apply, Cancel and Retry call their callbacks once', async () => {
        expect(mountBulk(BulkResummaryResult, resultProps({}, { bulkResummaryState: null })).children).toHaveLength(0)
        const calls = { apply: vi.fn(), cancel: vi.fn(), reroll: vi.fn() }
        const target = mountBulk(BulkResummaryResult, resultProps({}, { onApply: calls.apply, onCancel: calls.cancel, onReroll: calls.reroll }))
        byLabel(target, language.apply).click()
        byLabel(target, language.cancel).click()
        byLabel(target, language.hypaV3Modal.retry).click()
        expect(calls.apply).toHaveBeenCalledTimes(1)
        expect(calls.cancel).toHaveBeenCalledTimes(1)
        expect(calls.reroll).toHaveBeenCalledTimes(1)
    })
})
