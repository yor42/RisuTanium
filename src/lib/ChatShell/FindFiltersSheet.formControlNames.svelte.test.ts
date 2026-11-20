// @vitest-environment jsdom
/**
 * The two search-filter switches are named through aria-label equal to their visible text. REAL: FindFiltersSheet,
 * DEFAULT_FILTERS. MOCKED: the sheet frame (renders its children) and the language table.
 * The date inputs are excluded from the field assertion: date inputs belong to the #334 diagnostic (MC-2562).
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { DEFAULT_FILTERS } from '../../ts/chatShell/findSession'
import { controls, controlName } from '../a11yNames.test-helpers'

vi.mock('./ShellSheet.svelte', () => ({ default: (anchor: Comment, props: { open: boolean, children: (anchor: Comment) => void }) => {
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
afterEach(async () => { if (app) await unmount(app); app = undefined; document.body.replaceChildren() })

describe('FindFiltersSheet form control names', () => {
    test('the image and thinking switches carry aria-label equal to their text, and no aria-labelledby', () => {
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(FindFiltersSheet, { target, props: { open: true, opener: null, background: [], filters: { ...DEFAULT_FILTERS }, characterName: 'Seraphina', onfilters: vi.fn(), onclear: vi.fn(), onclose: vi.fn() } })
        flushSync()
        const switches = [...target.querySelectorAll<HTMLInputElement>('input[role="switch"]')]
        expect(switches.map((box) => box.getAttribute('aria-label'))).toEqual(['Has image', 'Include thinking'])
        expect(switches.every((box) => !box.hasAttribute('aria-labelledby'))).toBe(true)
        const unnamed = controls(target, { fields: true }).filter((el) => controlName(el) === '' && el.getAttribute('type') !== 'date')
        expect(unnamed).toEqual([])
    })
})
