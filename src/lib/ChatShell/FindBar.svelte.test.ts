// @vitest-environment jsdom
/**
 * The search bar. REAL: `FindBar.svelte`, the IME guard, `DEFAULT_FILTERS`. MOCKED: the language table (the bar reads only strings).
 * The session, the list and the shell are not involved: the bar takes its state as props and reports through callbacks.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { DEFAULT_FILTERS } from '../../ts/chatShell/findSession'
import type { SearchFilters } from '../../ts/chatShell/inChatSearch'

vi.mock('../../lang', () => ({
    language: {
        chatShellSearchInChat: 'Search in chat', chatShellFindPlaceholder: 'Search this chat',
        chatShellFindCounter: (index: string, total: string) => `${index} / ${total}`,
        chatShellFindCounterPartial: (index: string, total: string) => `${index} / ${total}+`,
        chatShellFindPrev: 'Previous match', chatShellFindNext: 'Next match', chatShellFindFilters: 'Filters', chatShellFindFiltersOn: 'Filters on',
        chatShellFindSeeAll: 'See all', chatShellFindClose: 'Close search', chatShellFindNoResults: 'No messages found', chatShellFindClearFilters: 'Clear filters',
        chatShellFindSpeakerMe: 'Me', chatShellFindSpeakerChar: 'Character', chatShellFindHasImage: 'Has image', chatShellFindIncludeThinking: 'Include thinking',
    },
}))

import FindBar from './FindBar.svelte'

interface BarState { query: string, count: number, current: number | null, complete: boolean, filters: SearchFilters }

let app: ReturnType<typeof mount> | undefined
let target: HTMLElement
const state = $state<BarState>({ query: '', count: 0, current: null, complete: true, filters: { ...DEFAULT_FILTERS } })
let calls: {
    onquery: Mock<(value: string, options: { composing: boolean }) => void>
    oncomposing: Mock<(on: boolean) => void>
    onstep: Mock<(direction: 1 | -1) => void>
    onclose: Mock<() => void>
    onclearfilters: Mock<() => void>
    onfilters: Mock<(opener: HTMLElement) => void>
    onseeall: Mock<(opener: HTMLElement) => void>
}

function show(initial: Partial<BarState> = {}, characterName = 'Seraphina'): void {
    Object.assign(state, { query: '', count: 0, current: null, complete: true, filters: { ...DEFAULT_FILTERS } }, initial)
    calls = {
        onquery: vi.fn<(value: string, options: { composing: boolean }) => void>(),
        oncomposing: vi.fn<(on: boolean) => void>(),
        onstep: vi.fn<(direction: 1 | -1) => void>(),
        onclose: vi.fn<() => void>(),
        onclearfilters: vi.fn<() => void>(),
        onfilters: vi.fn<(opener: HTMLElement) => void>(),
        onseeall: vi.fn<(opener: HTMLElement) => void>(),
    }
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(FindBar, {
        target,
        props: {
            get query() { return state.query },
            get count() { return state.count },
            get current() { return state.current },
            get complete() { return state.complete },
            get filters() { return state.filters },
            characterName,
            ...calls,
        },
    })
    flushSync()
}

const q = <T extends Element>(selector: string): T => target.querySelector<T>(selector)!
const field = () => q<HTMLInputElement>('[data-part="chat-find-field"]')
const rowTwo = () => target.querySelector<HTMLElement>('.row-two')
const seeAll = () => q<HTMLButtonElement>('.see-all')

function type(value: string, composing = false): void {
    const input = field()
    input.focus()
    input.value = value
    input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: composing }))
    flushSync()
}

function key(name: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init })
    field().dispatchEvent(event)
    flushSync()
    return event
}

beforeEach(() => { document.body.replaceChildren() })
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    document.body.replaceChildren()
})

describe('FindBar field', () => {
    test('B2c-1: the field is a search input capped at 200 characters with the search enter key', () => {
        show()
        expect(field().type).toBe('search')
        expect(field().getAttribute('maxlength')).toBe('200')
        expect(field().getAttribute('enterkeyhint')).toBe('search')
        expect(field().getAttribute('aria-label')).toBe('Search in chat')
        expect(q('[data-part="chat-find-bar"]')).not.toBeNull()
    })

    test('B2c-1: typing reports the raw text, and the composing flag comes from the input event', () => {
        show()
        type('  Lantern ')
        expect(calls.onquery).toHaveBeenLastCalledWith('  Lantern ', { composing: false })
        type('등불', true)
        expect(calls.onquery).toHaveBeenLastCalledWith('등불', { composing: true })
    })

    test('B2c-1: composition start and end are reported', () => {
        show()
        field().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        field().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        expect(calls.oncomposing.mock.calls).toEqual([[true], [false]])
    })
})

describe('FindBar keys', () => {
    test('B2c-1: Enter steps to the next older hit and Shift+Enter to the newer one, and the field keeps focus', () => {
        show({ query: 'a', count: 3, current: 0 })
        field().focus()
        const enter = key('Enter')
        expect(calls.onstep).toHaveBeenLastCalledWith(1)
        expect(enter.defaultPrevented).toBe(true)
        key('Enter', { shiftKey: true })
        expect(calls.onstep).toHaveBeenLastCalledWith(-1)
        expect(document.activeElement).toBe(field())
    })

    test('B2c-1: an IME Enter (isComposing or key code 229) does not step', () => {
        show({ query: 'a', count: 3, current: 0 })
        key('Enter', { isComposing: true })
        key('Enter', { keyCode: 229 })
        expect(calls.onstep).not.toHaveBeenCalled()
    })

    test('B2c-1: Esc clears a non-empty field first and closes only on an empty one', () => {
        show()
        type('lantern')
        const first = key('Escape')
        expect(first.defaultPrevented).toBe(true)
        expect(calls.onquery).toHaveBeenLastCalledWith('', { composing: false })
        expect(field().value).toBe('')
        expect(calls.onclose).not.toHaveBeenCalled()
        key('Escape')
        expect(calls.onclose).toHaveBeenCalledTimes(1)
    })

    test('B2c-1: Esc during a composition does nothing', () => {
        show()
        type('등', true)
        key('Escape', { isComposing: true })
        expect(calls.onclose).not.toHaveBeenCalled()
        expect(field().value).toBe('등')
    })

    test('B2c-1: the chevrons step (down = next older, up = newer), the close button closes', () => {
        show({ query: 'a', count: 3, current: 1 })
        q<HTMLButtonElement>('[aria-label="Next match"]').click()
        expect(calls.onstep).toHaveBeenLastCalledWith(1)
        q<HTMLButtonElement>('[aria-label="Previous match"]').click()
        expect(calls.onstep).toHaveBeenLastCalledWith(-1)
        q<HTMLButtonElement>('[aria-label="Close search"]').click()
        expect(calls.onclose).toHaveBeenCalledTimes(1)
    })

    test('B2c-1: the filter and See all buttons pass themselves as the opener', () => {
        show({ query: 'a', count: 2, current: 0 })
        const filters = q<HTMLButtonElement>('[aria-label="Filters"]')
        filters.click()
        expect(calls.onfilters).toHaveBeenCalledWith(filters)
        seeAll().click()
        expect(calls.onseeall).toHaveBeenCalledWith(seeAll())
    })
})

describe('FindBar row two', () => {
    test('B2c-1: no second row without a normalised query (whitespace-only text is no query)', () => {
        show({ query: '' })
        type('   ')
        expect(rowTwo()).toBeNull()
    })

    test('B2c-1: a counter counts from the newest, with a plus while the scan runs', () => {
        show({ query: 'a', count: 27, current: 2, complete: false })
        expect(rowTwo()!.querySelector('.counter')!.textContent).toBe('3 / 27+')
        state.complete = true
        flushSync()
        expect(rowTwo()!.querySelector('.counter')!.textContent).toBe('3 / 27')
        state.current = null
        flushSync()
        expect(rowTwo()!.querySelector('.counter')!.textContent).toBe('… / 27')
    })

    test('B2c-1: with no hit and the scan running there is no counter, the row is busy and See all is disabled', () => {
        show({ query: 'a', count: 0, complete: false })
        expect(rowTwo()!.querySelector('.counter')!.textContent).toBe('')
        expect(rowTwo()!.getAttribute('aria-busy')).toBe('true')
        expect(seeAll().disabled).toBe(true)
    })

    test('B2c-1: See all is enabled exactly when there is a hit, and the busy mark leaves with the first hit', () => {
        show({ query: 'a', count: 0, complete: false })
        state.count = 1
        flushSync()
        expect(seeAll().disabled).toBe(false)
        expect(rowTwo()!.hasAttribute('aria-busy')).toBe(false)
    })

    test('B2c-1: numbers are formatted for the locale', () => {
        show({ query: 'a', count: 12345, current: 0, complete: true })
        expect(rowTwo()!.querySelector('.counter')!.textContent).toBe(`1 / ${(12345).toLocaleString()}`)
    })
})

describe('FindBar no results', () => {
    const panel = () => target.querySelector<HTMLElement>('[data-part="chat-find-empty"]')

    test('B2c-2: the panel shows only when the scan is complete with no hit', () => {
        show({ query: 'a', count: 0, complete: false })
        expect(panel()).toBeNull()
        state.complete = true
        flushSync()
        expect(panel()!.textContent).toContain('No messages found')
        state.count = 1
        flushSync()
        expect(panel()).toBeNull()
    })

    test('B2c-2: no panel without a query', () => {
        show({ query: '', count: 0, complete: true })
        expect(panel()).toBeNull()
    })

    test('B2c-2: the filter summary and the clear button appear only while a filter is on', () => {
        show({ query: 'a', count: 0, complete: true })
        expect(panel()!.querySelector('.empty-summary')).toBeNull()
        expect(panel()!.querySelector('.clear-filters')).toBeNull()
        state.filters = { ...DEFAULT_FILTERS, speaker: 'char', hasImage: true, from: '2026-01-02', to: '2026-02-03' }
        flushSync()
        expect(panel()!.querySelector('.empty-summary')!.textContent).toBe('Seraphina · Has image · 2026-01-02 – 2026-02-03')
        panel()!.querySelector<HTMLButtonElement>('.clear-filters')!.click()
        expect(calls.onclearfilters).toHaveBeenCalledTimes(1)
    })

    test('B2c-2: the filter button is named "Filters on" while any filter is on', () => {
        show({ query: 'a', count: 0, complete: true, filters: { ...DEFAULT_FILTERS, thinking: true } })
        expect(q('[aria-label="Filters on"]').hasAttribute('data-on')).toBe(true)
        expect(target.querySelector('[aria-label="Filters"]')).toBeNull()
    })

    test('B2c-2: a date bound alone counts as a filter on', () => {
        show({ query: 'a', count: 0, complete: true, filters: { ...DEFAULT_FILTERS, from: '2026-01-02' } })
        expect(q('[aria-label="Filters on"]').hasAttribute('data-on')).toBe(true)
        state.filters = { ...DEFAULT_FILTERS, to: '2026-02-03' }
        flushSync()
        expect(q('[aria-label="Filters on"]').hasAttribute('data-on')).toBe(true)
        state.filters = { ...DEFAULT_FILTERS }
        flushSync()
        expect(q('[aria-label="Filters"]').hasAttribute('data-on')).toBe(false)
    })
})
