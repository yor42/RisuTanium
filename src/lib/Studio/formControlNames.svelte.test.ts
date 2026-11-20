// @vitest-environment jsdom
/**
 * Raw checkboxes and switches of the Studio screen's small components are named through aria-label equal to the
 * visible text beside them: the find bar's match-case box, the asset bulk bar's select-all, the duplicate finder's
 * include-modules box and the toggle preview row's switch. REAL: the four components and the real language table.
 * Excluded from the field assertions, with the reason: the toggle preview row's text/textarea/select controls are
 * named by aria-labelledby only (not in the A3c plan list), and select controls belong to #334 (MC-2562).
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
// The toggle preview row's imports reach the stores through the toggle panel module; plain stand-ins keep that
// import cycle quiet.
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
import { controlName, unnamedControls } from '../a11yNames.test-helpers'
import LongTextFind from './LongTextFind.svelte'
import StudioAssetBulkBar from './assets/StudioAssetBulkBar.svelte'
import StudioAssetFinder from './assets/StudioAssetFinder.svelte'
import StudioTogglePreviewRow from './StudioTogglePreviewRow.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

function show(component: Parameters<typeof mount>[0], props: Record<string, unknown>): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(component, { target, props }))
    flushSync()
    return target
}

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
})

const only = (target: HTMLElement, selector: string) => target.querySelector<HTMLInputElement>(selector)!

describe('Studio form control names', () => {
    test('the find bar match-case checkbox is named by its visible text; the query and replacement fields keep their aria-label', () => {
        const target = show(LongTextFind, { field: undefined, text: 'abc', editable: true, replace: true, onclose: vi.fn() })
        const box = only(target, '[data-part="studio-lt-find-case"]')
        expect(box.getAttribute('aria-label')).toBe(language.ltMatchCase)
        expect(box.hasAttribute('aria-labelledby')).toBe(false)
        expect(controlName(box)).toBe(box.closest('label')!.textContent!.trim())
        const checks = [...target.querySelectorAll<HTMLInputElement>('input[type="checkbox"], input[type="radio"]')]
        expect(checks.filter((el) => controlName(el) === '')).toEqual([])
    })

    test.each([true, false])('the bulk bar select-all checkbox (shown rows: %s) is named by its visible text', (hasRows) => {
        const target = show(StudioAssetBulkBar, { count: 0, shown: hasRows ? 3 : 0, editable: true, moveChoices: [], previewAction: null, onselectall: vi.fn(), onmove: vi.fn(), ondelete: vi.fn(), onpreview: vi.fn() })
        const box = only(target, '[data-part="studio-asset-select-all"]')
        expect(box.getAttribute('aria-label')).toBe(language.studioAssetSelectAll)
        expect(box.hasAttribute('aria-labelledby')).toBe(false)
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('the duplicate finder include-modules checkbox is named by its visible text', () => {
        const target = show(StudioAssetFinder, {
            arrays: [], moduleArrays: () => [], port: async () => { throw new Error('not started') }, sizes: {}, editable: true,
            onremoveextras: vi.fn(), onclose: vi.fn(),
        })
        const box = only(target, '[data-part="studio-asset-dup-modules"]')
        expect(box.getAttribute('aria-label')).toBe(language.studioAssetDupIncludeModules)
        expect(box.hasAttribute('aria-labelledby')).toBe(false)
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test.each(['0', '1'])('the toggle preview row switch (value %s) is named by the row label', (value) => {
        const row: PanelValueRow = { type: 'row', uid: 'u1', key: 'toggle_a', label: 'Alpha mode', kind: 'check', options: [] }
        const target = show(StudioTogglePreviewRow, { row, value, current: false, showKey: false, onset: vi.fn(), onfocus: vi.fn() })
        const box = only(target, '[data-part="studio-tg-preview-switch"]')
        expect(box.getAttribute('aria-label')).toBe('Alpha mode')
        expect(box.hasAttribute('aria-labelledby')).toBe(false)
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })
})
