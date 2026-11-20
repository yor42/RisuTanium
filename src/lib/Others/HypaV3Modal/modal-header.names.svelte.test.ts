// @vitest-environment jsdom

/**
 * `modal-header.svelte`: every icon control is named, the three toggles expose `aria-pressed` that
 * follows their state, the glyphs are hidden and no default-palette class is left. Mounts the REAL
 * component; only the store module is replaced (the header writes `hypaV3ModalOpen` and friends).
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/stores.svelte'), () => ({
    hypaV3ModalOpen: writable(true),
    settingsOpen: writable(false),
    SettingsMenuIndex: writable(0),
}) as unknown as typeof import('src/ts/stores.svelte'))

import { language } from 'src/lang'
import { controlName, exposedIcons, paletteClasses, textColourTokens, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import ModalHeader from './modal-header.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

type HeaderProps = Record<string, unknown>

function mountHeader(overrides: HeaderProps = {}): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const props = {
        searchState: null,
        filterImportant: false,
        dropdownOpen: false,
        filterSelected: false,
        bulkEditState: { isEnabled: false, selectedSummaries: new Set<number>(), selectedCategory: '', bulkSelectInput: '' },
        categoryManagerState: { isOpen: false, editingCategory: null, selectedCategoryFilter: 'all' },
        filterState: { showImportantOnly: false, selectedCategoryFilter: 'all', isManualImportantToggle: false },
        uiState: { collapsedSummaries: new Set<number>(), dropdownOpen: false },
        hypaV3Data: { summaries: [] },
        onResetData: async () => {},
        onToggleBulkEditMode: () => {},
        onOpenCategoryManager: () => {},
        onExportToLorebook: async () => {},
        onImportFromLorebook: async () => {},
        ...overrides,
    }
    const app = mount(ModalHeader, { target, props } as never) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const bar = (target: HTMLElement) => target.querySelector('h1')!.nextElementSibling as HTMLElement
const barButtons = (target: HTMLElement) => Array.from(bar(target).querySelectorAll(':scope > button')) as HTMLButtonElement[]
const moreButton = (target: HTMLElement) => bar(target).querySelector(':scope > div.relative > button') as HTMLButtonElement

describe('modal-header accessible names', () => {
    test('regression reproducer: the header buttons carry their meaning as the name', () => {
        const target = mountHeader()
        expect(barButtons(target).map(controlName)).toEqual([
            language.search,
            language.hypaV3ImportantOnly,
            language.hypaV3BulkEdit,
            language.hypaV3Modal.categoryManager,
            language.settings,
            language.uiCommon.close,
        ])
        expect(controlName(moreButton(target))).toBe(language.chatShellMoreActions)
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: the dropdown buttons are named', () => {
        const target = mountHeader({ dropdownOpen: true })
        const menu = target.querySelector('div.absolute.right-0') as HTMLElement
        const buttons = Array.from(menu.querySelectorAll('button'))
        expect(buttons.map(controlName)).toEqual([
            language.hypaV3ShowMetrics,
            language.hypaV3Modal.exportToLorebookLabel,
            language.hypaV3Modal.importFromLorebookLabel,
            language.reset,
        ])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: the glyphs are hidden from the accessibility tree', () => {
        const target = mountHeader({ dropdownOpen: true })
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the important filter exposes aria-pressed that follows the filter', () => {
        const off = mountHeader()
        expect(barButtons(off)[1].getAttribute('aria-pressed')).toBe('false')
        const on = mountHeader({ filterState: { showImportantOnly: true, selectedCategoryFilter: 'all', isManualImportantToggle: false } })
        expect(barButtons(on)[1].getAttribute('aria-pressed')).toBe('true')
    })

    test('regression reproducer: the bulk edit and metrics toggles expose aria-pressed that follows their state', () => {
        const off = mountHeader({ dropdownOpen: true })
        expect(barButtons(off)[2].getAttribute('aria-pressed')).toBe('false')
        const menuOff = off.querySelector('div.absolute.right-0') as HTMLElement
        expect(menuOff.querySelector('button')!.getAttribute('aria-pressed')).toBe('false')

        const on = mountHeader({
            dropdownOpen: true,
            filterSelected: true,
            bulkEditState: { isEnabled: true, selectedSummaries: new Set<number>(), selectedCategory: '', bulkSelectInput: '' },
        })
        expect(barButtons(on)[2].getAttribute('aria-pressed')).toBe('true')
        const menuOn = on.querySelector('div.absolute.right-0') as HTMLElement
        expect(menuOn.querySelector('button')!.getAttribute('aria-pressed')).toBe('true')
    })

    test('regression reproducer: an on toggle keeps a non-colour cue, a ring and a fill, and no yellow or blue hue', () => {
        const on = mountHeader({ filterState: { showImportantOnly: true, selectedCategoryFilter: 'all', isManualImportantToggle: false } })
        const star = barButtons(on)[1]
        expect(star.classList.contains('bg-selected')).toBe(true)
        expect(star.classList.contains('ring-1')).toBe(true)
        expect(star.classList.contains('ring-borderc')).toBe(true)
    })

    test('regression reproducer: no default-palette class is left and the rest and hover colours differ', () => {
        const target = mountHeader({ dropdownOpen: true })
        expect(paletteClasses(target)).toEqual([])
        for (const button of Array.from(target.querySelectorAll('button'))) {
            const glyph = button.querySelector('svg')!.parentElement!
            const { rest, hover } = textColourTokens(glyph)
            if (hover !== null) {
                expect(hover, controlName(button)).not.toBe(rest)
            }
        }
    })
})
