// @vitest-environment jsdom

/**
 * `CustomSidebarConfig.svelte` carries the overlay vocabulary on its real elements (#438 W3-2). The REAL dialog is mounted with its real Button
 * and TextInput; each element is found by tag, text, the `data-sidebar-item-*` hooks or structure, never by its part, and the part is asserted
 * on it, together with its parent. The outline tests pin the whole nesting per page, so a part that is dropped, renamed, swapped with a sibling
 * or its parent, or moved into a comment fails.
 *
 * Tests starting `acceptance:` fail on the base (every part is absent). Tests starting `guard:` pass before and after.
 * MOCKED: `DBState` (a `$state` object), the dialog store and the settings catalogue. Deleting an item is not clicked: `CustomSidebarConfig.undo`
 * covers the Undo toast.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const dialog = $state({ open: true })
    return {
        DBState: state,
        customSideBarConfigDialogStore: dialog,
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock('src/ts/setting/utils', () => ({
    getFullSettingsData: () => [{ id: 'sample-setting' }],
    getLabel: () => 'Sample setting',
}))

import { language } from 'src/lang'
import { DBState, customSideBarConfigDialogStore } from 'src/ts/stores.svelte'
import CustomSidebarConfig from './CustomSidebarConfig.svelte'

const mounted: Array<{ instance: object, target: HTMLElement }> = []

function open(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(CustomSidebarConfig, { target, props: {} })
    mounted.push({ instance, target })
    flushSync()
    return target
}

function press(root: HTMLElement, text: string) {
    buttonWithText(root, text).click()
    flushSync()
}

const buttonWithText = (root: HTMLElement, text: string): HTMLButtonElement => {
    const found = Array.from(root.querySelectorAll('button')).find((button) => button.textContent?.trim() === text)
    if (!found) throw new Error(`no button "${text}"`)
    return found
}
const partOf = (el: Element | null): string | null => el?.getAttribute('data-part') ?? null

/** The names of the parted elements as a nested string: `name(child child)`; an element without a part is looked through. */
function outline(el: Element): string {
    const inner = Array.from(el.children).map(outline).filter((text) => text !== '').join(' ')
    const name = partOf(el)
    if (name === null) return inner
    return inner === '' ? name : `${name}(${inner})`
}

beforeEach(() => {
    customSideBarConfigDialogStore.open = true
    DBState.db = {
        customSidebarItems: [
            { id: 'i1', type: 'model', subType: 'none', label: 'Model A' },
            { id: 'i2', type: 'preset', subType: 'none', label: 'Preset B' },
        ],
    } as unknown as Database
})

afterEach(async () => {
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
})

describe('CustomSidebarConfig overlay parts', () => {
    test('acceptance: the backdrop, frame and list of the list page', () => {
        const root = open()
        const overlay = root.firstElementChild as HTMLElement
        expect(partOf(overlay)).toBe('modal-custom-sidebar-config')
        const frame = overlay.firstElementChild as HTMLElement
        expect(partOf(frame)).toBe('modal-frame')
        const list = frame.firstElementChild as HTMLElement
        expect(partOf(list)).toBe('modal-list')
        expect(list.children).toHaveLength(2)
    })

    test('acceptance: each item is a modal-row of a modal-text label and a Delete modal-action', () => {
        const root = open()
        const list = root.firstElementChild!.firstElementChild!.firstElementChild as HTMLElement
        const deletes = Array.from(root.querySelectorAll<HTMLElement>('[data-sidebar-item-delete]'))
        expect(deletes).toHaveLength(2)
        const labels = ['Model A', 'Preset B']
        deletes.forEach((del, index) => {
            expect(del.tagName).toBe('BUTTON')
            expect(del.textContent?.trim()).toBe(language.uiCommon.delete)
            expect(partOf(del)).toBe('modal-action')
            const row = del.parentElement as HTMLElement
            expect(partOf(row)).toBe('modal-row')
            expect(row.parentElement).toBe(list)
            const label = del.previousElementSibling as HTMLElement
            expect(label.textContent).toBe(labels[index])
            expect(partOf(label)).toBe('modal-text')
            expect(label.parentElement).toBe(row)
        })
    })

    test('acceptance: the empty list shows modal-text inside the modal-list', () => {
        DBState.db.customSidebarItems = []
        const root = open()
        const empty = Array.from(root.querySelectorAll('div')).find((d) => d.children.length === 0 && d.textContent?.trim() === language.othersUi.noCustomSidebarItems) as HTMLElement
        expect(partOf(empty)).toBe('modal-text')
        expect(partOf(empty.parentElement)).toBe('modal-list')
        expect(outline(root)).toBe('modal-custom-sidebar-config(modal-frame(modal-list(modal-text)))')
    })

    test('acceptance: the whole nesting of the list page', () => {
        expect(outline(open())).toBe('modal-custom-sidebar-config(modal-frame(modal-list(modal-row(modal-text modal-action) modal-row(modal-text modal-action))))')
    })

    test('acceptance: the settings submenu is one modal-body in the frame, and the add page has the frame alone', () => {
        const root = open()
        press(root, language.othersUi.addItem)
        expect(outline(root)).toBe('modal-custom-sidebar-config(modal-frame)')
        press(root, language.settings)
        const frame = root.firstElementChild!.firstElementChild as HTMLElement
        const input = root.querySelector(`input[placeholder="${language.settingsPage.searchEllipsis}"]`) as HTMLElement
        const body = input.closest('[data-part]') as HTMLElement
        expect(partOf(body)).toBe('modal-body')
        expect(body.parentElement).toBe(frame)
        expect(partOf(buttonWithText(root, 'Sample setting').parentElement)).toBe('modal-body')
        expect(outline(root)).toBe('modal-custom-sidebar-config(modal-frame(modal-body))')
    })

    test('guard: the Add item and Close buttons carry no part and the Add wrapper keeps its hook', () => {
        const root = open()
        expect(partOf(buttonWithText(root, language.othersUi.addItem))).toBeNull()
        expect(partOf(buttonWithText(root, language.uiCommon.close))).toBeNull()
        expect(partOf(root.querySelector('[data-sidebar-item-add]'))).toBeNull()
    })

    test('guard: Close closes the dialog and a click on the backdrop closes it, a click inside the frame does not', () => {
        const root = open()
        root.firstElementChild!.firstElementChild!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(customSideBarConfigDialogStore.open).toBe(true)
        press(root, language.uiCommon.close)
        expect(customSideBarConfigDialogStore.open).toBe(false)
        customSideBarConfigDialogStore.open = true
        root.firstElementChild!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(customSideBarConfigDialogStore.open).toBe(false)
    })
})
