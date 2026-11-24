// @vitest-environment jsdom

/**
 * `RealmBlockedCreators.svelte` carries the overlay vocabulary on its real elements (#438 W3-3). The REAL component is mounted; each element is
 * found by tag, id, role, aria-label, text or structure, never by its part, and the part is asserted on it together with its direct parent. The
 * outline tests pin the whole nesting for the populated list and the empty state, so a part that is dropped, renamed, swapped with a sibling
 * or its parent, moved into a comment or moved inward or outward fails.
 *
 * Tests starting `acceptance:` fail on the base (every part is absent). Tests starting `guard:` pass before and after.
 * MOCKED: `src/ts/stores.svelte` (a plain database with two blocked creators). Synthetic data only.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { blockedRealmCreators: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }] } as unknown as Record<string, unknown> })
    return {
        DBState: state,
        settingsOpen: writable(false),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

import { DBState } from 'src/ts/stores.svelte'
import { installBackGuard, resetBackHandlersForTests } from 'src/ts/backHandlers'
import RealmBlockedCreators from './RealmBlockedCreators.svelte'

const mounted: Array<ReturnType<typeof mount>> = []
const showToast = vi.fn()

function mountDialog(props: { onClose?: () => void, onUnblock?: () => void } = {}) {
    const main = document.createElement('main')
    document.body.appendChild(main)
    const target = document.createElement('div')
    main.appendChild(target)
    mounted.push(mount(RealmBlockedCreators, { target, props }))
    flushSync()
    return { target }
}

beforeEach(() => {
    resetBackHandlersForTests()
    installBackGuard({ showToast })
    showToast.mockReset()
    DBState.db.blockedRealmCreators = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }]
})

afterEach(() => {
    for (const component of mounted.splice(0)) {
        unmount(component)
    }
    document.body.replaceChildren()
    resetBackHandlersForTests()
})

const partOf = (el: Element | null): string | null => el?.getAttribute('data-part') ?? null

/** The only element of the selector whose trimmed text is exactly `text`. */
function byText(root: ParentNode, selector: string, text: string): HTMLElement {
    const found = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => el.textContent?.trim() === text)
    expect(found, `${selector} with text ${text}`).toHaveLength(1)
    return found[0]
}

/** The names of the parted elements as a nested string: `name(child child)`; an element without a part is looked through. */
function outline(el: Element): string {
    const inner = Array.from(el.children).map(outline).filter((text) => text !== '').join(' ')
    const name = partOf(el)
    if (name === null) return inner
    return inner === '' ? name : `${name}(${inner})`
}

describe('RealmBlockedCreators overlay parts', () => {
    test('acceptance: the backdrop layer, frame, header, title and close', () => {
        const { target } = mountDialog()
        const layer = target.firstElementChild as HTMLElement
        expect(partOf(layer)).toBe('modal-realm-blocked-creators')
        const dialog = target.querySelector('[role="dialog"]') as HTMLElement
        expect(partOf(dialog)).toBe('modal-frame')
        expect(dialog.parentElement).toBe(layer)
        const title = target.querySelector('#blocked-creators-title') as HTMLElement
        expect(partOf(title)).toBe('modal-title')
        const header = title.parentElement as HTMLElement
        expect(partOf(header)).toBe('modal-header')
        expect(header).toBe(dialog.firstElementChild)
        const close = target.querySelector(`button[aria-label="${language.uiCommon.close}"]`) as HTMLElement
        expect(partOf(close)).toBe('modal-close')
        expect(close.parentElement).toBe(header)
    })

    test('acceptance: each creator row, its name and id, and its Unblock button', () => {
        const { target } = mountDialog()
        const dialog = target.querySelector('[role="dialog"]') as HTMLElement
        const buttons = Array.from(target.querySelectorAll('button')).filter((b) => b.textContent?.trim() === language.unblockRealmCreator)
        expect(buttons).toHaveLength(2)
        const list = buttons[0].parentElement!.parentElement as HTMLElement
        expect(partOf(list)).toBe('modal-list')
        expect(list.parentElement).toBe(dialog)
        for (const [index, [name, id]] of [['Alpha', 'a'], ['Beta', 'b']].entries()) {
            const button = buttons[index]
            expect(partOf(button), name).toBe('modal-action')
            const row = button.parentElement as HTMLElement
            expect(partOf(row), name).toBe('modal-row')
            expect(row.parentElement, name).toBe(list)
            for (const text of [name, id]) {
                const cell = byText(row, 'div', text)
                expect(partOf(cell), text).toBe('modal-text')
                const column = cell.parentElement as HTMLElement
                expect(partOf(column), text).toBeNull()
                expect(column.parentElement, text).toBe(row)
            }
        }
    })

    test('acceptance: the whole nesting of the populated list', () => {
        const { target } = mountDialog()
        expect(outline(target)).toBe('modal-realm-blocked-creators(modal-frame(modal-header(modal-title modal-close) '
            + 'modal-list(modal-row(modal-text modal-text modal-action) modal-row(modal-text modal-text modal-action))))')
    })

    test('acceptance: the empty state is a modal-text paragraph directly in the frame', () => {
        DBState.db.blockedRealmCreators = []
        const { target } = mountDialog()
        const dialog = target.querySelector('[role="dialog"]') as HTMLElement
        const empty = byText(target, 'p', language.noBlockedRealmCreators)
        expect(partOf(empty)).toBe('modal-text')
        expect(empty.parentElement).toBe(dialog)
        expect(target.querySelector('[data-part="modal-list"]')).toBeNull()
        expect(outline(target)).toBe('modal-realm-blocked-creators(modal-frame(modal-header(modal-title modal-close) modal-text))')
    })

    test('guard: Unblock removes the creator and calls onUnblock once; close calls onClose', () => {
        const onClose = vi.fn()
        const onUnblock = vi.fn()
        const { target } = mountDialog({ onClose, onUnblock })
        const alphaRow = byText(target, 'div', 'Alpha').parentElement!.parentElement as HTMLElement
        const unblock = Array.from(alphaRow.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.unblockRealmCreator) as HTMLElement
        unblock.click()
        flushSync()
        expect(DBState.db.blockedRealmCreators.map((c: { id: string }) => c.id)).toEqual(['b'])
        expect(onUnblock).toHaveBeenCalledTimes(1)
        ;(target.querySelector(`button[aria-label="${language.uiCommon.close}"]`) as HTMLElement).click()
        flushSync()
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    test('guard: the name column carries no part', () => {
        const { target } = mountDialog()
        expect(partOf(byText(target, 'div', 'Alpha').parentElement)).toBeNull()
    })
})
