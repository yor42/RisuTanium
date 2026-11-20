// @vitest-environment jsdom
/**
 * `StudioTogglePreviewRow.svelte`: the list-style select is named by the row's label span and describes itself with that
 * same span. REAL: the row, the language table and the checker. The stores module is replaced by plain stand-ins that keep
 * the toggle panel import cycle quiet. The radio-group layouts and the text controls are not value controls.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../ts/stores.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    return {
        DBState: { db: {} },
        selIdState: { selId: -1 },
        selectedCharID: store(-1),
        MobileGUI: store(false),
        settingsOpen: store(false),
        ReloadGUIPointer: store(0),
    }
})

import { language } from '../../lang'
import type { PanelValueRow } from '../../ts/chatShell/togglePanel'
import { fieldNameProblems, unnamedControls } from '../a11yNames.test-helpers'
import StudioTogglePreviewRow from './StudioTogglePreviewRow.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

function show(row: PanelValueRow, value: string): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(StudioTogglePreviewRow, { target, props: { row, value, current: false, showKey: false, onset: vi.fn(), onfocus: vi.fn() } }))
    flushSync()
    return target
}

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
})

const KNOWN_UNNAMED: string[] = []
const listRow: PanelValueRow = { type: 'row', uid: 'u1', key: 'toggle_mode', label: 'Alpha mode', kind: 'select', options: ['One', 'Two', 'Three', 'Four'] }

describe('StudioTogglePreviewRow value-control names', () => {
    test('regression reproducer: the list select is named by the label span and describes itself with it (unset value)', () => {
        const target = show(listRow, '')
        expect(fieldNameProblems(target, [{ name: 'Alpha mode' }])).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    })

    test('regression reproducer: a changed value adds the spoken change note to the name and the description alike', () => {
        const target = show(listRow, '2')
        expect(fieldNameProblems(target, [{ name: `Alpha mode, ${language.chatShellTogglesChangedA11y}` }])).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    })
})
