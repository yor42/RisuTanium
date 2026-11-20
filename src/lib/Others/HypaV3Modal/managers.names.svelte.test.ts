// @vitest-environment jsdom

/**
 * `category-manager-modal.svelte` and `tag-manager-modal.svelte`: every icon control and raw field is
 * named, the glyphs are hidden and no default-palette class is left except the `bg-black/70` scrim
 * (E2). Mounts the REAL components over a real `$state` database; only the store module is replaced.
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
import { controlName, exposedIcons, paletteClasses, textColourTokens, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import CategoryManagerModal from './category-manager-modal.svelte'
import TagManagerModal from './tag-manager-modal.svelte'

const SCRIM = [/^bg-black\/70$/]

function installDb(): void {
    DBState.db = {
        characters: [{
            chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, firstMessage: '', chats: [{
                id: 'chat-a', name: '', note: '', localLore: [], message: [],
                hypaV3Data: {
                    summaries: [
                        { text: 's0', chatMemos: [], isImportant: false, categoryId: 'cat-a', tags: ['alpha', 'beta'] },
                        { text: 's1', chatMemos: [], isImportant: false },
                    ],
                    categories: [{ id: '', name: 'none' }, { id: 'cat-a', name: 'Alpha' }, { id: 'cat-b', name: 'Beta' }],
                    lastSelectedSummaries: [],
                },
            }],
        }],
    } as unknown as Database
}

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountManager(component: unknown, props: Record<string, unknown>): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(component as never, { target, props } as never) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

function categoryState(editing: { id: string, name: string } | null, selected = 'all') {
    const state = $state({ isOpen: true, editingCategory: editing, selectedCategoryFilter: selected })
    return state
}

function tagState(editingIndex: number) {
    const state = $state({ isOpen: true, currentSummaryIndex: 0, editingTag: editingIndex >= 0 ? 'alpha' : '', editingTagIndex: editingIndex })
    return state
}

const categoryProps = (state: ReturnType<typeof categoryState>) => ({ categoryManagerState: state, searchState: null })

beforeEach(() => {
    installDb()
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('category-manager-modal accessible names', () => {
    test('regression reproducer: the header and row buttons carry their meaning as the name', () => {
        const target = mountManager(CategoryManagerModal, categoryProps(categoryState(null)))
        const header = target.querySelector('h2')!.nextElementSibling as HTMLElement
        expect(Array.from(header.querySelectorAll('button')).map(controlName)).toEqual([language.add, language.uiCommon.close])
        const names = Array.from(target.querySelectorAll('button')).map(controlName)
        expect(names).toContain(language.edit)
        expect(names).toContain(language.uiCommon.delete)
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: the editing row names its field, save and cancel', () => {
        const target = mountManager(CategoryManagerModal, categoryProps(categoryState({ id: 'cat-a', name: 'Alpha' })))
        const field = target.querySelector('input[type=text]') as HTMLInputElement
        expect(controlName(field)).toBe(language.hypaV3Modal.categoryName)
        const row = field.parentElement as HTMLElement
        expect(Array.from(row.querySelectorAll('button')).map(controlName)).toEqual([language.uiCommon.save, language.cancel])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: the glyphs are hidden and no default-palette class is left except the scrim', () => {
        const target = mountManager(CategoryManagerModal, categoryProps(categoryState({ id: 'cat-a', name: 'Alpha' }, 'cat-b')))
        expect(exposedIcons(target)).toEqual([])
        expect(paletteClasses(target, { allow: SCRIM })).toEqual([])
        const editing = mountManager(CategoryManagerModal, categoryProps(categoryState(null, 'cat-a')))
        expect(paletteClasses(editing, { allow: SCRIM })).toEqual([])
    })

    test('regression reproducer: the field uses the shared focus ring and rest and hover colours differ', () => {
        const target = mountManager(CategoryManagerModal, categoryProps(categoryState({ id: 'cat-a', name: 'Alpha' })))
        const field = target.querySelector('input[type=text]') as HTMLInputElement
        expect(field.classList.contains('risu-focus-ring')).toBe(true)
        expect(Array.from(field.classList).filter((c) => c.startsWith('focus:ring'))).toEqual([])
        const list = mountManager(CategoryManagerModal, categoryProps(categoryState(null)))
        for (const button of Array.from(list.querySelectorAll('button'))) {
            const svg = button.querySelector('svg')
            if (!svg) continue
            const { rest, hover } = textColourTokens(svg.parentElement!)
            expect(hover, controlName(button)).not.toBe(rest)
        }
    })
})

describe('tag-manager-modal accessible names', () => {
    test('regression reproducer: the close, edit and delete buttons carry their meaning as the name', () => {
        const target = mountManager(TagManagerModal, { tagManagerState: tagState(-1) })
        const close = target.querySelector('h2')!.nextElementSibling as HTMLButtonElement
        expect(controlName(close)).toBe(language.uiCommon.close)
        const names = Array.from(target.querySelectorAll('button')).map(controlName)
        expect(names.filter((n) => n === language.edit)).toHaveLength(2)
        expect(names.filter((n) => n === language.uiCommon.delete)).toHaveLength(2)
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: the new-tag field is named and the editing row names its field, save and cancel', () => {
        const adding = mountManager(TagManagerModal, { tagManagerState: tagState(-1) })
        const addField = adding.querySelector('input[type=text]') as HTMLInputElement
        expect(controlName(addField)).toBe(language.hypaV3Modal.newTagName)

        const editing = mountManager(TagManagerModal, { tagManagerState: tagState(0) })
        const fields = Array.from(editing.querySelectorAll('input[type=text]')) as HTMLInputElement[]
        expect(fields).toHaveLength(2)
        expect(controlName(fields[1])).toBe(language.edit)
        const row = fields[1].parentElement as HTMLElement
        expect(Array.from(row.querySelectorAll('button')).map(controlName)).toEqual([language.uiCommon.save, language.cancel])
        expect(unnamedControls(editing, { fields: true })).toEqual([])
    })

    test('regression reproducer: the glyphs are hidden and no default-palette class is left except the scrim', () => {
        const target = mountManager(TagManagerModal, { tagManagerState: tagState(0) })
        expect(exposedIcons(target)).toEqual([])
        expect(paletteClasses(target, { allow: SCRIM })).toEqual([])
        const list = mountManager(TagManagerModal, { tagManagerState: tagState(-1) })
        expect(paletteClasses(list, { allow: SCRIM })).toEqual([])
    })

    test('regression reproducer: the fields use the shared focus ring', () => {
        const target = mountManager(TagManagerModal, { tagManagerState: tagState(0) })
        for (const field of Array.from(target.querySelectorAll('input[type=text]'))) {
            expect(field.classList.contains('risu-focus-ring')).toBe(true)
            expect(Array.from(field.classList).filter((c) => c.startsWith('focus:ring'))).toEqual([])
        }
    })
})
