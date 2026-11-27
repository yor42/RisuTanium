// @vitest-environment jsdom

/**
 * `category-manager-modal.svelte` and `tag-manager-modal.svelte` carry the overlay vocabulary on their real elements (#438 W3-6b). The REAL
 * managers are mounted over a real `$state` database; each element is found by tag, text, aria-label or structure, never by its part, and the
 * part is asserted on it together with its direct parent. The outline tests pin the whole nesting, so a part that is dropped, renamed, swapped
 * with a sibling or its parent, or put on an element that is promised to carry none (spacers, sr-only spans, icons, the empty-state hint) fails.
 *
 * Tests starting `acceptance:` fail on the base (every part is absent). Tests starting `guard:` pass before and after.
 * MOCKED: the stores module (the selected character) and the confirm dialog. Synthetic data only.
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

const alertConfirm = vi.hoisted(() => vi.fn<(msg: string) => Promise<boolean>>())
vi.mock('src/ts/alert', () => ({ alertConfirm }))

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import CategoryManagerModal from './category-manager-modal.svelte'
import TagManagerModal from './tag-manager-modal.svelte'

type Data = { summaries: { categoryId?: string, tags?: string[] }[], categories: { id: string, name: string }[] }
const chatData = (): Data => (DBState.db as unknown as { characters: { chats: { hypaV3Data: Data }[] }[] }).characters[0].chats[0].hypaV3Data

function installDb(categories: { id: string, name: string }[]): void {
    DBState.db = {
        characters: [{
            chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, firstMessage: '', chats: [{
                id: 'chat-a', name: '', note: '', localLore: [], message: [],
                hypaV3Data: {
                    summaries: [
                        { text: 's0', chatMemos: [], isImportant: false, categoryId: 'cat-a', tags: ['alpha', 'beta'] },
                        { text: 's1', chatMemos: [], isImportant: false },
                    ],
                    categories,
                    lastSelectedSummaries: [],
                },
            }],
        }],
    } as unknown as Database
}

const FULL_CATEGORIES = [{ id: '', name: 'none' }, { id: 'cat-a', name: 'Alpha' }, { id: 'cat-b', name: 'Beta' }]

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountManager(component: unknown, props: Record<string, unknown>): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(component as never, { target, props } as never) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

const settle = async () => { for (let i = 0; i < 5; i++) { await Promise.resolve(); flushSync() } }

beforeEach(() => {
    installDb(FULL_CATEGORIES)
    alertConfirm.mockReset()
    alertConfirm.mockResolvedValue(true)
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

const CM_FULL = 'modal-hypa-v3-category-manager(modal-frame(modal-header(modal-title modal-controls(modal-action modal-close)) modal-list(modal-row modal-row(modal-action) modal-row(modal-action modal-action modal-action) modal-row(modal-action modal-action modal-action))))'
const TM_FULL = 'modal-hypa-v3-tag-manager(modal-frame(modal-header(modal-title modal-close) modal-controls(modal-field modal-action) modal-list(modal-row(modal-text modal-action modal-action) modal-row(modal-text modal-action modal-action))))'

function categoryState() {
    const state = $state({ isOpen: true, editingCategory: null as { id: string, name: string } | null, selectedCategoryFilter: 'all' })
    return state
}

function tagState(currentSummaryIndex = 0) {
    const state = $state({ isOpen: true, currentSummaryIndex, editingTag: '', editingTagIndex: -1 })
    return state
}

const mountCategory = (state = categoryState()) => mountManager(CategoryManagerModal, { categoryManagerState: state, searchState: null })
const mountTag = (state = tagState()) => mountManager(TagManagerModal, { tagManagerState: state })

/** The row element that holds the button whose text is `text`. */
const rowOf = (target: HTMLElement, text: string): HTMLElement => byText(target, 'button', text).parentElement as HTMLElement

describe('category manager overlay parts', () => {
    test('acceptance: the identity root, the frame, the header, its title and its controls', async () => {
        const target = mountCategory()
        const root = target.firstElementChild as HTMLElement
        expect(partOf(root)).toBe('modal-hypa-v3-category-manager')
        expect(root.parentElement).toBe(target)
        const frame = root.firstElementChild as HTMLElement
        expect(partOf(frame)).toBe('modal-frame')
        expect(frame.parentElement).toBe(root)
        const header = frame.firstElementChild as HTMLElement
        expect(partOf(header)).toBe('modal-header')
        expect(header.parentElement).toBe(frame)
        const title = byText(header, 'h2', language.hypaV3Modal.categoryManager)
        expect(partOf(title)).toBe('modal-title')
        expect(title.parentElement).toBe(header)
        const controls = title.nextElementSibling as HTMLElement
        expect(partOf(controls)).toBe('modal-controls')
        expect(controls.parentElement).toBe(header)
        const add = byLabel(controls, language.add)
        expect(partOf(add)).toBe('modal-action')
        expect(add.parentElement).toBe(controls)
        const close = byLabel(controls, language.uiCommon.close)
        expect(partOf(close)).toBe('modal-close')
        expect(close.parentElement).toBe(controls)
    })

    test('acceptance: the list, its rows and their actions, and no part on the spacers or icons', async () => {
        const target = mountCategory()
        const frame = target.firstElementChild!.firstElementChild as HTMLElement
        const list = (frame.firstElementChild as HTMLElement).nextElementSibling as HTMLElement
        expect(partOf(list)).toBe('modal-list')
        expect(list.parentElement).toBe(frame)

        const all = byText(list, 'button', `${language.hypaV3Modal.allCategories} (2)`)
        expect(partOf(all)).toBe('modal-row')
        expect(all.parentElement).toBe(list)
        const label = all.querySelector(':scope > span') as HTMLElement
        expect(partOf(label)).toBeNull()
        expect(label.parentElement).toBe(all)
        const spacer = all.querySelector(':scope > div') as HTMLElement
        expect(partOf(spacer)).toBeNull()
        expect(spacer.parentElement).toBe(all)
        for (const inner of Array.from(spacer.children)) {
            expect(partOf(inner)).toBeNull()
            expect(inner.parentElement).toBe(spacer)
        }
        expect(spacer.children).toHaveLength(2)

        const unclassifiedButton = byText(list, 'button', `${language.hypaV3Modal.unclassified} (1)`)
        const unclassified = unclassifiedButton.parentElement as HTMLElement
        expect(partOf(unclassified)).toBe('modal-row')
        expect(unclassified.parentElement).toBe(list)
        expect(partOf(unclassifiedButton)).toBe('modal-action')
        const unclassifiedSpacer = unclassified.querySelector(':scope > div') as HTMLElement
        expect(partOf(unclassifiedSpacer)).toBeNull()
        expect(unclassifiedSpacer.parentElement).toBe(unclassified)
        expect(unclassifiedSpacer.children).toHaveLength(2)
        for (const inner of Array.from(unclassifiedSpacer.children)) {
            expect(partOf(inner)).toBeNull()
            expect(inner.parentElement).toBe(unclassifiedSpacer)
        }

        const alpha = rowOf(target, 'Alpha (1)')
        expect(partOf(alpha)).toBe('modal-row')
        expect(alpha.parentElement).toBe(list)
        for (const button of [byText(alpha, 'button', 'Alpha (1)'), byLabel(alpha, language.edit), byLabel(alpha, language.uiCommon.delete)]) {
            expect(partOf(button)).toBe('modal-action')
            expect(button.parentElement).toBe(alpha)
        }
        for (const icon of Array.from(alpha.querySelectorAll('svg'))) expect(partOf(icon)).toBeNull()
        expect(outline(target)).toBe(CM_FULL)
    })

    test('acceptance: the edit row carries the field and two actions and no part on the sr-only label', async () => {
        const target = mountCategory()
        const row = rowOf(target, 'Alpha (1)')
        byLabel(row, language.edit).click()
        await settle()
        const label = row.querySelector(':scope > span.sr-only') as HTMLElement
        expect(label).not.toBeNull()
        expect(partOf(label)).toBeNull()
        expect(label.parentElement).toBe(row)
        const field = row.querySelector(':scope > input[type=text]') as HTMLElement
        expect(partOf(field)).toBe('modal-field')
        expect(field.parentElement).toBe(row)
        for (const button of [byLabel(row, language.uiCommon.save), byLabel(row, language.cancel)]) {
            expect(partOf(button)).toBe('modal-action')
            expect(button.parentElement).toBe(row)
        }
        for (const icon of Array.from(row.querySelectorAll('svg'))) expect(partOf(icon)).toBeNull()
        expect(outline(row)).toBe('modal-row(modal-field modal-action modal-action)')
    })

    test('acceptance: the empty state is a text and its hint and line break carry none', async () => {
        installDb([{ id: '', name: 'none' }])
        const target = mountCategory()
        const list = ((target.firstElementChild!.firstElementChild as HTMLElement).firstElementChild as HTMLElement).nextElementSibling as HTMLElement
        const empty = list.lastElementChild as HTMLElement
        expect(norm(empty.textContent)).toContain(norm(language.hypaV3Modal.noCategoriesYet))
        expect(partOf(empty)).toBe('modal-text')
        expect(empty.parentElement).toBe(list)
        const hint = empty.querySelector(':scope > span') as HTMLElement
        expect(partOf(hint)).toBeNull()
        expect(hint.parentElement).toBe(empty)
        const br = empty.querySelector(':scope > br') as HTMLElement
        expect(partOf(br)).toBeNull()
        expect(outline(list)).toBe('modal-list(modal-row modal-row(modal-action) modal-text)')
    })

    test('guard: nothing renders while closed, and Delete and the select button behave as before', async () => {
        const closed = categoryState()
        closed.isOpen = false
        expect(mountCategory(closed).children).toHaveLength(0)

        const state = categoryState()
        const target = mountCategory(state)
        byLabel(rowOf(target, 'Alpha (1)'), language.uiCommon.delete).click()
        await settle()
        expect(alertConfirm).toHaveBeenCalledTimes(1)
        expect(chatData().categories.map((c) => c.id)).toEqual(['', 'cat-b'])
        byText(target, 'button', 'Beta (0)').click()
        await settle()
        expect(state.selectedCategoryFilter).toBe('cat-b')
        expect(state.isOpen).toBe(false)

        const again = categoryState()
        const second = mountCategory(again)
        byLabel(second, language.uiCommon.close).click()
        await settle()
        expect(again.isOpen).toBe(false)
    })
})

describe('tag manager overlay parts', () => {
    test('acceptance: the identity root, the frame, the header and the add row', async () => {
        const target = mountTag()
        const root = target.firstElementChild as HTMLElement
        expect(partOf(root)).toBe('modal-hypa-v3-tag-manager')
        expect(root.parentElement).toBe(target)
        const frame = root.firstElementChild as HTMLElement
        expect(partOf(frame)).toBe('modal-frame')
        expect(frame.parentElement).toBe(root)
        const header = frame.firstElementChild as HTMLElement
        expect(partOf(header)).toBe('modal-header')
        expect(header.parentElement).toBe(frame)
        const title = byText(header, 'h2', language.hypaV3Modal.tagManagerTitle.replace('{0}', '1'))
        expect(partOf(title)).toBe('modal-title')
        expect(title.parentElement).toBe(header)
        const close = byLabel(header, language.uiCommon.close)
        expect(partOf(close)).toBe('modal-close')
        expect(close.parentElement).toBe(header)

        const wrapper = header.nextElementSibling as HTMLElement
        expect(partOf(wrapper)).toBeNull()
        expect(wrapper.parentElement).toBe(frame)
        const controls = wrapper.firstElementChild as HTMLElement
        expect(partOf(controls)).toBe('modal-controls')
        expect(controls.parentElement).toBe(wrapper)
        const sr = controls.querySelector(':scope > span.sr-only') as HTMLElement
        expect(partOf(sr)).toBeNull()
        expect(sr.parentElement).toBe(controls)
        const field = controls.querySelector(':scope > input') as HTMLElement
        expect(partOf(field)).toBe('modal-field')
        expect(field.parentElement).toBe(controls)
        const add = byText(controls, 'button', language.add)
        expect(partOf(add)).toBe('modal-action')
        expect(add.parentElement).toBe(controls)
        for (const icon of Array.from(header.querySelectorAll('svg'))) expect(partOf(icon)).toBeNull()
        expect(outline(target)).toBe(TM_FULL)
    })

    test('acceptance: the list, its rows, the tag texts and their actions', async () => {
        const target = mountTag()
        const frame = target.firstElementChild!.firstElementChild as HTMLElement
        const list = frame.lastElementChild as HTMLElement
        expect(partOf(list)).toBe('modal-list')
        expect(list.parentElement).toBe(frame)
        expect(list.children).toHaveLength(2)
        for (const row of Array.from(list.children)) {
            expect(partOf(row)).toBe('modal-row')
            expect(row.parentElement).toBe(list)
        }
        const alpha = byText(list, 'span', '#alpha')
        expect(partOf(alpha)).toBe('modal-text')
        const row = alpha.parentElement as HTMLElement
        expect(row.parentElement).toBe(list)
        for (const button of [byLabel(row, language.edit), byLabel(row, language.uiCommon.delete)]) {
            expect(partOf(button)).toBe('modal-action')
            expect(button.parentElement).toBe(row)
        }
        for (const icon of Array.from(row.querySelectorAll('svg'))) expect(partOf(icon)).toBeNull()
    })

    test('acceptance: the edit row carries the field and two actions and no part on the sr-only label', async () => {
        const target = mountTag()
        const alpha = byText(target, 'span', '#alpha')
        const row = alpha.parentElement as HTMLElement
        byLabel(row, language.edit).click()
        await settle()
        const label = row.querySelector(':scope > span.sr-only') as HTMLElement
        expect(label).not.toBeNull()
        expect(partOf(label)).toBeNull()
        expect(label.parentElement).toBe(row)
        const field = row.querySelector(':scope > input') as HTMLElement
        expect(partOf(field)).toBe('modal-field')
        expect(field.parentElement).toBe(row)
        for (const button of [byLabel(row, language.uiCommon.save), byLabel(row, language.cancel)]) {
            expect(partOf(button)).toBe('modal-action')
            expect(button.parentElement).toBe(row)
        }
        for (const icon of Array.from(row.querySelectorAll('svg'))) expect(partOf(icon)).toBeNull()
        expect(outline(row)).toBe('modal-row(modal-field modal-action modal-action)')
    })

    test('acceptance: the empty state is a text and its hint and line break carry none', async () => {
        const target = mountTag(tagState(1))
        const list = (target.firstElementChild!.firstElementChild as HTMLElement).lastElementChild as HTMLElement
        expect(list.children).toHaveLength(1)
        const empty = list.firstElementChild as HTMLElement
        expect(norm(empty.textContent)).toContain(norm(language.hypaV3Modal.noTagsYet))
        expect(partOf(empty)).toBe('modal-text')
        expect(empty.parentElement).toBe(list)
        const hint = empty.querySelector(':scope > span') as HTMLElement
        expect(partOf(hint)).toBeNull()
        expect(hint.parentElement).toBe(empty)
        expect(partOf(empty.querySelector(':scope > br'))).toBeNull()
        expect(outline(list)).toBe('modal-list(modal-text)')
    })

    test('guard: nothing renders while closed or without a summary, and Remove and Close behave as before', async () => {
        const closed = tagState()
        closed.isOpen = false
        expect(mountTag(closed).children).toHaveLength(0)
        expect(mountTag(tagState(-1)).children).toHaveLength(0)

        const state = tagState()
        const target = mountTag(state)
        const beta = byText(target, 'span', '#beta').parentElement as HTMLElement
        byLabel(beta, language.uiCommon.delete).click()
        await settle()
        expect(alertConfirm).toHaveBeenCalledTimes(1)
        expect(chatData().summaries[0].tags).toEqual(['alpha'])
        byLabel(target, language.uiCommon.close).click()
        await settle()
        expect(state.isOpen).toBe(false)
    })
})
