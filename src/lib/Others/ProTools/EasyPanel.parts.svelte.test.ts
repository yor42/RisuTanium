// @vitest-environment jsdom

/**
 * `EasyPanel.svelte` carries the overlay vocabulary on its real elements (#438 W3-2). The REAL panel is mounted with its real SegmentedControl,
 * Button and CheckInput; each element is found by tag, text or structure, never by its part, and the part is asserted on it, together with its
 * parent. The outline tests pin the whole nesting per view, so a part that is dropped, renamed, swapped with a sibling or its parent, or moved
 * into a comment fails.
 *
 * Tests starting `acceptance:` fail on the base (every part is absent). Tests starting `guard:` pass before and after.
 * MOCKED: the model list, custom models page, parameter panels and the slider (they render nothing), the store module and the Back registry.
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
import { DBState, easyPanelStore } from 'src/ts/stores.svelte'
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
    easyPanelStore.open = true
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

const partOf = (el: Element | null): string | null => el?.getAttribute('data-part') ?? null
const buttonWithText = (root: HTMLElement, text: string): HTMLButtonElement => {
    const found = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)
    if (!found) throw new Error(`no button "${text}"`)
    return found
}

/** The names of the parted elements as a nested string: `name(child child)`; an element without a part is looked through. */
function outline(el: Element): string {
    const inner = Array.from(el.children).map(outline).filter((text) => text !== '').join(' ')
    const name = partOf(el)
    if (name === null) return inner
    return inner === '' ? name : `${name}(${inner})`
}

const HEADER = 'modal-header(modal-text modal-close)'
const CELL = 'modal-controls(modal-text)'

describe('EasyPanel overlay parts', () => {
    test('acceptance: the root, frame, header, badge and X with the requirements unmet', () => {
        const root = mountPanel(false)
        const overlay = root.firstElementChild as HTMLElement
        expect(partOf(overlay)).toBe('modal-easy-panel')
        const frame = overlay.firstElementChild as HTMLElement
        expect(partOf(frame)).toBe('modal-frame')
        const header = frame.firstElementChild as HTMLElement
        expect(header.tagName).toBe('H2')
        expect(partOf(header)).toBe('modal-header')
        const close = header.querySelector('button') as HTMLElement
        expect(partOf(close)).toBe('modal-close')
        expect(close.parentElement).toBe(header)
        const badge = header.querySelector('div') as HTMLElement
        expect(badge.textContent).toBe(language.othersUi.beta)
        expect(partOf(badge)).toBe('modal-text')
        expect(badge.parentElement).toBe(header)
    })

    test('acceptance: the requirements note is modal-text in the frame, and the whole nesting', () => {
        const root = mountPanel(false)
        const note = Array.from(root.querySelectorAll('div')).find((d) => (d.textContent ?? '').trim() === language.epRequirementsNotMet) as HTMLElement
        expect(partOf(note)).toBe('modal-text')
        expect(partOf(note.parentElement)).toBe('modal-frame')
        expect(outline(root)).toBe(`modal-easy-panel(modal-frame(${HEADER} modal-text))`)
    })

    test('acceptance: the models view has one modal-body of six labelled cells', () => {
        const root = mountPanel(true)
        const frame = root.firstElementChild!.firstElementChild as HTMLElement
        const labels = [language.mainModel, language.submodel, language.longTermMemory, language.translator, language.emotionImage, language.others]
        const spans = labels.map((text) => Array.from(root.querySelectorAll('span')).find((s) => s.textContent === text) as HTMLElement)
        const body = spans[0].parentElement!.parentElement as HTMLElement
        expect(partOf(body)).toBe('modal-body')
        expect(body.parentElement).toBe(frame)
        for (const [index, span] of spans.entries()) {
            expect(partOf(span), labels[index]).toBe('modal-text')
            const cell = span.parentElement as HTMLElement
            expect(cell.tagName, labels[index]).toBe('DIV')
            expect(partOf(cell), labels[index]).toBe('modal-controls')
            expect(cell.parentElement, labels[index]).toBe(body)
        }
        expect(outline(root)).toBe(`modal-easy-panel(modal-frame(${HEADER} modal-body(${Array(6).fill(CELL).join(' ')})))`)
    })

    test('acceptance: the parameters view swaps the grid for a different modal-body in the frame', () => {
        const root = mountPanel(true)
        const frame = root.firstElementChild!.firstElementChild as HTMLElement
        const grid = frame.lastElementChild as HTMLElement
        buttonWithText(root, language.parameters).click()
        flushSync()
        const body = frame.lastElementChild as HTMLElement
        expect(body).not.toBe(grid)
        expect(grid.isConnected).toBe(false)
        expect(partOf(body)).toBe('modal-body')
        expect(body.parentElement).toBe(frame)
        expect(outline(root)).toBe(`modal-easy-panel(modal-frame(${HEADER} modal-body))`)
    })

    test('guard: the X closes the panel', () => {
        const root = mountPanel(true)
        expect(easyPanelStore.open).toBe(true)
        ;(root.querySelector('h2 button') as HTMLElement).click()
        expect(easyPanelStore.open).toBe(false)
    })

    test('guard: the Run button and the view switch carry no part', () => {
        const unmet = mountPanel(false)
        expect(partOf(buttonWithText(unmet, language.run))).toBeNull()
        expect(partOf(buttonWithText(unmet, language.model).parentElement)).toBeNull()
        expect(partOf(buttonWithText(unmet, language.parameters))).toBeNull()
    })

    test('acceptance: the settings view adds no part below the header', () => {
        const met = mountPanel(true)
        buttonWithText(met, language.settings).click()
        flushSync()
        expect(outline(met)).toBe(`modal-easy-panel(modal-frame(${HEADER}))`)
    })
})
