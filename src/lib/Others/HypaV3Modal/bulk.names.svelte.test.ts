// @vitest-environment jsdom

/**
 * `bulk-edit-actions.svelte` and `bulk-resummary-result.svelte`: the title-only result buttons and
 * the bulk star are named, the result text areas and the number-list field are named by their
 * visible labels, the glyphs are hidden, the blue, green, yellow and red buttons follow the scheme
 * rules and no `hover:bg-selected` sits on a `bg-darkbutton` rest. Mounts the REAL components; only
 * the store module is replaced.
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
import { controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import BulkEditActions from './bulk-edit-actions.svelte'
import BulkResummaryResult from './bulk-resummary-result.svelte'

const norm = (text: string) => text.replace(/\s+/g, ' ').trim()

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountBulk(component: unknown, props: Record<string, unknown>): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(component as never, { target, props } as never) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

function actionProps(selected: number[]) {
    return {
        bulkEditState: { isEnabled: true, selectedSummaries: new Set<number>(selected), selectedCategory: '', bulkSelectInput: '' },
        categories: [{ id: '', name: 'none' }],
        showImportantOnly: false,
        selectedCategoryFilter: 'all',
        onResummarize: () => {},
        onClearSelection: () => {},
        onUpdateSelectedCategory: () => {},
        onUpdateBulkSelectInput: () => {},
        onApplyCategory: () => {},
        onToggleImportant: () => {},
        onParseAndSelectSummaries: () => {},
    }
}

function resultProps(state: Record<string, unknown>) {
    return {
        bulkResummaryState: { isProcessing: false, result: 'merged', heldSummaries: [], mergedChatMemos: [], isTranslating: false, translation: null, ...state },
        onToggleTranslation: () => {},
        onReroll: () => {},
        onApply: () => {},
        onCancel: () => {},
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

const buttons = (target: HTMLElement) => Array.from(target.querySelectorAll('button')) as HTMLButtonElement[]

describe('bulk-edit-actions accessible names and colours', () => {
    test('regression reproducer: the bulk star is named and the bar has no unnamed control or field', () => {
        const target = mountBulk(BulkEditActions, actionProps([0, 1]))
        const names = buttons(target).map(controlName)
        expect(names).toEqual([
            norm(language.hypaV3Modal.reSummarize),
            norm(language.apply),
            language.hypaV3BulkImportant,
            norm(language.select),
            norm(language.cancel),
        ])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: the number-list field is named', () => {
        const target = mountBulk(BulkEditActions, actionProps([0]))
        const field = target.querySelector('input[type=text]') as HTMLInputElement
        expect(controlName(field)).toBe(language.select)
    })

    test('regression reproducer: the star glyph is hidden', () => {
        const target = mountBulk(BulkEditActions, actionProps([0]))
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: no default-palette class is left, enabled or disabled', () => {
        for (const selected of [[], [0], [0, 1]]) {
            const target = mountBulk(BulkEditActions, actionProps(selected))
            expect(paletteClasses(target), `selected ${selected.length}`).toEqual([])
        }
    })

    test('regression reproducer: the field and select use the shared focus ring and no darkbutton rest hovers to selected', () => {
        const target = mountBulk(BulkEditActions, actionProps([0, 1]))
        for (const control of Array.from(target.querySelectorAll('input, select'))) {
            expect(control.classList.contains('risu-focus-ring')).toBe(true)
            expect(Array.from(control.classList).filter((c) => c.startsWith('focus:ring'))).toEqual([])
        }
        for (const el of Array.from(target.querySelectorAll('.bg-darkbutton'))) {
            expect(el.classList.contains('hover:bg-selected')).toBe(false)
        }
    })
})

describe('bulk-resummary-result accessible names and colours', () => {
    test('regression reproducer: the four title-only buttons are named by their titles', () => {
        const target = mountBulk(BulkResummaryResult, resultProps({ translation: 'T' }))
        expect(buttons(target).map(controlName)).toEqual([
            language.hypaV3Modal.translate,
            language.hypaV3Modal.retry,
            language.apply,
            language.cancel,
        ])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: the result and translation text areas are named by their visible labels', () => {
        const target = mountBulk(BulkResummaryResult, resultProps({ translation: 'T' }))
        const areas = Array.from(target.querySelectorAll('textarea')) as HTMLTextAreaElement[]
        expect(areas.map(controlName)).toEqual([
            norm(language.hypaV3Modal.reSummarizeResult),
            norm(language.hypaV3Modal.translationLabel),
        ])
    })

    test('regression reproducer: the glyphs are hidden in the processing and result states', () => {
        expect(exposedIcons(mountBulk(BulkResummaryResult, resultProps({})))).toEqual([])
        expect(exposedIcons(mountBulk(BulkResummaryResult, resultProps({ isProcessing: true, result: null })))).toEqual([])
    })

    test('regression reproducer: no default-palette class is left in any state and the text area uses the shared focus ring', () => {
        for (const state of [{}, { isProcessing: true, result: null }, { result: null }, { translation: 'T' }]) {
            const target = mountBulk(BulkResummaryResult, resultProps(state))
            expect(paletteClasses(target), JSON.stringify(state)).toEqual([])
        }
        const target = mountBulk(BulkResummaryResult, resultProps({}))
        const area = target.querySelector('textarea') as HTMLTextAreaElement
        expect(area.classList.contains('risu-focus-ring')).toBe(true)
        expect(Array.from(area.classList).filter((c) => c.startsWith('focus:ring'))).toEqual([])
    })
})
