// @vitest-environment jsdom

/**
 * `EasyPanel.svelte`: the close button is named, its glyph is hidden, and the beta badge and the
 * requirements note use scheme tokens. Mounts the REAL panel with its real SegmentedControl, Button
 * and CheckInput; the model list, custom models page, parameter panels and the slider (out of scope)
 * are stubs and the store module and the Android Back registry are replaced.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as Record<string, unknown> })
    const easyPanelStore = $state({ open: true })
    return { DBState: state, easyPanelStore, selIdState: { selId: 0 } } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('src/ts/backHandlers', () => ({
    registerBackHandler: () => () => {},
    backCloseHandler: () => () => false,
}))

vi.mock('src/lib/UI/ModelList.svelte', () => ({ default: () => { } }))
vi.mock('src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte', () => ({ default: () => { } }))
vi.mock('src/lib/Setting/Pages/ClaudeThinkingSeparateParams.svelte', () => ({ default: () => { } }))
vi.mock('src/lib/UI/GUI/SliderInput.svelte', () => ({ default: () => { } }))
vi.mock('../AllSeperateParameters.svelte', () => ({ default: () => { } }))

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import { controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import EasyPanel from './EasyPanel.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountPanel(requirementsMet: boolean): HTMLElement {
    DBState.db = (requirementsMet
        ? {
            seperateParametersEnabled: true,
            doNotChangeSeperateModels: true,
            seperateModels: { memory: '', translate: '', emotion: '', otherAx: '' },
            epEnabled: true,
            disableSeperateParameterChangeOnPresetChange: true,
            seperateParameters: {},
        }
        : {}) as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(EasyPanel, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

beforeEach(() => {
    DBState.db = {} as unknown as Database
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const closeButton = (target: HTMLElement) => target.querySelector('h2 > button') as HTMLButtonElement

describe('EasyPanel accessible names and colours', () => {
    test('regression reproducer: the close button is named and its glyph is hidden', () => {
        for (const met of [false, true]) {
            const target = mountPanel(met)
            expect(controlName(closeButton(target))).toBe(language.uiCommon.close)
            expect(unnamedControls(target, { fields: true })).toEqual([])
            expect(exposedIcons(target)).toEqual([])
        }
    })

    test('regression reproducer: the beta badge and the requirements note use scheme tokens', () => {
        const unmet = mountPanel(false)
        expect(paletteClasses(unmet)).toEqual([])
        const badge = unmet.querySelector('h2 > div') as HTMLElement
        expect(badge.classList.contains('bg-darkbutton')).toBe(true)
        expect(badge.classList.contains('text-textcolor')).toBe(true)
        const note = Array.from(unmet.querySelectorAll('div')).find((d) => (d.textContent ?? '').trim() === language.epRequirementsNotMet) as HTMLElement
        expect(note.classList.contains('bg-darkbutton')).toBe(true)
        expect(note.classList.contains('text-textcolor')).toBe(true)
        expect(paletteClasses(mountPanel(true))).toEqual([])
    })
})
