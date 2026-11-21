// @vitest-environment jsdom
/**
 * `FindFiltersSheet.svelte`: the two date inputs are named by their visible From and To text and carry that text first in
 * their description. REAL: the sheet, the language table, DEFAULT_FILTERS and the checker. MOCKED: the sheet frame.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { DEFAULT_FILTERS } from '../../ts/chatShell/findSession'
import { fieldNameProblems, unnamedControls } from '../a11yNames.test-helpers'

vi.mock('./ShellSheet.svelte', () => ({ default: (anchor: Comment, props: { open: boolean, children: (anchor: Comment) => void }) => {
    props.children(anchor)
    return {}
} }))

import { language } from '../../lang'
import FindFiltersSheet from './FindFiltersSheet.svelte'

let app: ReturnType<typeof mount> | undefined
afterEach(async () => { if (app) await unmount(app); app = undefined; document.body.replaceChildren() })

const KNOWN_UNNAMED: string[] = []

describe('FindFiltersSheet value-control names', () => {
    test('regression reproducer: the From and To date inputs are named by their visible text', () => {
        const target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(FindFiltersSheet, { target, props: { open: true, opener: null, background: [], filters: { ...DEFAULT_FILTERS }, characterName: 'Seraphina', onfilters: vi.fn(), onclear: vi.fn(), onclose: vi.fn() } })
        flushSync()
        expect(fieldNameProblems(target, [
            { name: language.chatShellFindFrom },
            { name: language.chatShellFindTo },
        ])).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    })
})
