// @vitest-environment jsdom
/**
 * The search filters sheet. REAL: `FindFiltersSheet.svelte`, `DEFAULT_FILTERS`. MOCKED: the sheet frame (always renders its children)
 * and the language table.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { DEFAULT_FILTERS } from '../../ts/chatShell/findSession'
import type { SearchFilters } from '../../ts/chatShell/inChatSearch'

vi.mock('./ShellSheet.svelte', () => ({ default: (anchor: Comment, props: { open: boolean, children: (anchor: Comment) => void }) => {
    // The frame renders its children even when closed, so the sheet's own open guard is what the closed case tests.
    props.children(anchor)
    return {}
} }))
vi.mock('../../lang', () => ({
    language: {
        chatShellFindFilters: 'Filters', chatShellFindSpeaker: 'Speaker', chatShellFindSpeakerAny: 'Anyone', chatShellFindSpeakerMe: 'Me',
        chatShellFindSpeakerChar: 'Character', chatShellFindHasImage: 'Has image', chatShellFindIncludeThinking: 'Include thinking',
        chatShellFindDate: 'Date', chatShellFindFrom: 'From', chatShellFindTo: 'To', chatShellFindClearFilters: 'Clear filters',
    },
}))

import FindFiltersSheet from './FindFiltersSheet.svelte'

let app: ReturnType<typeof mount> | undefined
let target: HTMLElement
let onfilters: Mock<(patch: Partial<SearchFilters>) => void>
let onclear: Mock<() => void>
let onclose: Mock<() => void>

function show(filters: SearchFilters = { ...DEFAULT_FILTERS }, characterName = 'Seraphina', open = true): void {
    target = document.createElement('div')
    document.body.appendChild(target)
    onfilters = vi.fn<(patch: Partial<SearchFilters>) => void>()
    onclear = vi.fn<() => void>()
    onclose = vi.fn<() => void>()
    app = mount(FindFiltersSheet, { target, props: { open, opener: null, background: [], filters, characterName, onfilters, onclear, onclose } })
    flushSync()
}

const radios = () => [...target.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
const switches = () => [...target.querySelectorAll<HTMLInputElement>('input[role="switch"]')]

beforeEach(() => { document.body.replaceChildren() })
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    document.body.replaceChildren()
})

describe('FindFiltersSheet', () => {
    test('B2c-4: renders nothing while closed and the filters body while open', () => {
        show(undefined, 'Seraphina', false)
        expect(target.querySelector('[data-part="chat-find-filters"]')).toBeNull()
        void unmount(app!)
        app = undefined
        document.body.replaceChildren()
        show()
        expect(target.querySelector('[data-part="chat-find-filters"]')).not.toBeNull()
    })

    test('B2c-4: the speaker choices name the character, mark the current one and report the pick', () => {
        show({ ...DEFAULT_FILTERS, speaker: 'me' })
        expect(radios().map((radio) => radio.textContent)).toEqual(['Anyone', 'Me', 'Seraphina'])
        expect(radios().map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
        radios()[2].click()
        expect(onfilters).toHaveBeenLastCalledWith({ speaker: 'char' })
        radios()[0].click()
        expect(onfilters).toHaveBeenLastCalledWith({ speaker: 'any' })
    })

    test('B2c-4: an empty character name falls back to the generic label', () => {
        show(undefined, '')
        expect(radios()[2].textContent).toBe('Character')
    })

    test('B2c-4: the image and thinking switches report their state', () => {
        show({ ...DEFAULT_FILTERS, thinking: true })
        expect(switches().map((box) => box.checked)).toEqual([false, true])
        void unmount(app!)
        app = undefined
        document.body.replaceChildren()
        show({ ...DEFAULT_FILTERS, hasImage: true })
        expect(switches().map((box) => box.checked)).toEqual([true, false])
        switches()[0].checked = true
        switches()[0].dispatchEvent(new Event('change', { bubbles: true }))
        expect(onfilters).toHaveBeenLastCalledWith({ hasImage: true })
        switches()[1].checked = false
        switches()[1].dispatchEvent(new Event('change', { bubbles: true }))
        expect(onfilters).toHaveBeenLastCalledWith({ thinking: false })
    })

    test('B2c-4: the date fields show the bounds and report a change per bound', () => {
        show({ ...DEFAULT_FILTERS, from: '2026-01-02' })
        const from = target.querySelector<HTMLInputElement>('#find-from-field')!
        const to = target.querySelector<HTMLInputElement>('#find-to-field')!
        expect(from.value).toBe('2026-01-02')
        expect(to.value).toBe('')
        to.value = '2026-03-04'
        to.dispatchEvent(new Event('change', { bubbles: true }))
        expect(onfilters).toHaveBeenLastCalledWith({ to: '2026-03-04' })
        from.value = ''
        from.dispatchEvent(new Event('change', { bubbles: true }))
        expect(onfilters).toHaveBeenLastCalledWith({ from: '' })
    })

    test('B2c-4: Clear filters calls onclear', () => {
        show()
        target.querySelector<HTMLButtonElement>('.clear')!.click()
        expect(onclear).toHaveBeenCalledTimes(1)
    })
})
