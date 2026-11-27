// @vitest-environment jsdom

/**
 * `LoadoutModal.svelte` carries the overlay vocabulary on its real elements (#438 W3-2). The REAL modal is mounted over a `$state` stand-in for
 * `DBState`, with two loadouts and a current character so that all four sections render (recent, with the character, favourites, all). Each
 * element is found by tag, text, aria-label, placeholder or structure, never by its part, and the part is asserted on it, together with its
 * parent. The outline test pins the whole nesting, so a part that is dropped, renamed, swapped with a sibling or its parent, or moved into a
 * comment fails.
 *
 * Tests starting `acceptance:` fail on the base (every part is absent). Tests starting `guard:` pass before and after.
 * MOCKED: `applyLoadout` and `saveCurrentLoadout` (spies, so nothing is applied or saved), `loadoutPresetIndex` and `getCurrentCharacter`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

const spies = vi.hoisted(() => ({ applyLoadout: vi.fn(), saveCurrentLoadout: vi.fn() }))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const store = $state({ open: true })
    return {
        DBState: state,
        loadoutModalStore: store,
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/loadout'), () => ({
    applyLoadout: spies.applyLoadout,
    saveCurrentLoadout: spies.saveCurrentLoadout,
    loadoutPresetIndex: vi.fn(() => -1),
}) as unknown as typeof import('src/ts/loadout'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(() => ({ chaId: 'c0' })),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock('src/ts/backHandlers', () => ({
    registerBackHandler: () => () => {},
    backCloseHandler: () => () => false,
}))

import { language } from 'src/lang'
import { DBState, loadoutModalStore } from 'src/ts/stores.svelte'
import LoadoutModal from './LoadoutModal.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountModal(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(LoadoutModal, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

beforeEach(() => {
    spies.applyLoadout.mockReset()
    spies.saveCurrentLoadout.mockReset()
    loadoutModalStore.open = true
    DBState.db = {
        loadoutApplyOptions: { modules: true, globalVariables: true, preset: true, persona: true },
        loadouts: [
            { id: 'a', name: 'Alpha', lastUsed: 2, favorite: true, characterIds: ['c0'], modules: [], globalVariables: {}, presetName: 'Preset A' },
            { id: 'b', name: 'Beta', lastUsed: 1, favorite: false, characterIds: [], modules: [], globalVariables: {}, presetName: '' },
        ],
    } as unknown as Database
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const partOf = (el: Element | null): string | null => el?.getAttribute('data-part') ?? null
const spanWithText = (root: HTMLElement, text: string): HTMLElement => {
    const found = Array.from(root.querySelectorAll('span')).find((s) => s.textContent === text)
    if (!found) throw new Error(`no span "${text}"`)
    return found
}
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

const L = language.loadoutModal
const HEADINGS = [L.recentlyUsed, L.recentlyUsedWithCharacter, L.favorites, L.allLoadouts]
// A card: the row, its Pick button holding the name and the meta line, then Star and Remove.
const CARD = 'modal-row(modal-action(modal-text modal-text) modal-action modal-action)'

describe('LoadoutModal overlay parts', () => {
    test('acceptance: the backdrop, frame, header, title and X', () => {
        const root = mountModal()
        const overlay = root.firstElementChild as HTMLElement
        expect(partOf(overlay)).toBe('modal-loadout')
        const frame = overlay.firstElementChild as HTMLElement
        expect(partOf(frame)).toBe('modal-frame')
        const header = frame.firstElementChild as HTMLElement
        expect(partOf(header)).toBe('modal-header')
        const title = spanWithText(root, L.selectLoadout)
        expect(partOf(title)).toBe('modal-title')
        expect(title.parentElement).toBe(header)
        const close = root.querySelector(`button[aria-label="${language.uiCommon.close}"]`) as HTMLElement
        expect(partOf(close)).toBe('modal-close')
        expect(close.parentElement).toBe(header)
    })

    test('acceptance: the load-option bar, its label and its four toggles', () => {
        const root = mountModal()
        const frame = root.firstElementChild!.firstElementChild as HTMLElement
        const bar = frame.children[1] as HTMLElement
        expect(partOf(bar)).toBe('modal-controls')
        const label = spanWithText(root, L.loadLabel)
        expect(partOf(label)).toBe('modal-text')
        expect(label.parentElement).toBe(bar)
        for (const text of [language.modules, L.globalVariables, L.preset, language.persona]) {
            const toggle = buttonWithText(root, text)
            expect(partOf(toggle), text).toBe('modal-action')
            expect(toggle.parentElement, text).toBe(bar)
        }
    })

    test('acceptance: each section heading is modal-text directly before a modal-list in the body', () => {
        const root = mountModal()
        const frame = root.firstElementChild!.firstElementChild as HTMLElement
        const body = frame.children[2] as HTMLElement
        expect(partOf(body)).toBe('modal-body')
        for (const text of HEADINGS) {
            const heading = spanWithText(root, text).parentElement as HTMLElement
            expect(partOf(heading), text).toBe('modal-text')
            const list = heading.nextElementSibling as HTMLElement
            expect(partOf(list), text).toBe('modal-list')
            expect(partOf(list.parentElement), text).toBeNull()
            expect(list.parentElement!.parentElement, text).toBe(body)
        }
    })

    test('acceptance: every card in every list has its row, Pick, name, meta, Star and Remove', () => {
        const root = mountModal()
        const lists = HEADINGS.map((text) => spanWithText(root, text).parentElement!.nextElementSibling as HTMLElement)
        expect(lists.map((list) => list.children.length)).toEqual([2, 1, 1, 2])
        for (const list of lists) {
            for (const row of Array.from(list.children) as HTMLElement[]) {
                expect(partOf(row)).toBe('modal-row')
                expect(row.parentElement).toBe(list)
                const pick = row.firstElementChild as HTMLElement
                expect(pick.tagName).toBe('BUTTON')
                expect(partOf(pick)).toBe('modal-action')
                const [name, meta] = Array.from(pick.children) as HTMLElement[]
                expect(['Alpha', 'Beta']).toContain(name.textContent)
                expect(partOf(name)).toBe('modal-text')
                expect(partOf(meta)).toBe('modal-text')
                expect(meta.parentElement).toBe(pick)
                const star = row.querySelector(`button[aria-label="${L.unfavorite}"], button[aria-label="${L.favorite}"]`) as HTMLElement
                expect(partOf(star)).toBe('modal-action')
                expect(star.parentElement).toBe(row)
                const remove = row.querySelector(`button[aria-label="${language.remove}"]`) as HTMLElement
                expect(partOf(remove)).toBe('modal-action')
                expect(remove.parentElement).toBe(row)
            }
        }
    })

    test('acceptance: the footer holds the name field and Save', () => {
        const root = mountModal()
        const frame = root.firstElementChild!.firstElementChild as HTMLElement
        const footer = frame.lastElementChild as HTMLElement
        expect(partOf(footer)).toBe('modal-footer')
        const field = root.querySelector(`input[type="text"][placeholder="${L.namePlaceholder}"]`) as HTMLElement
        expect(partOf(field)).toBe('modal-field')
        expect(field.parentElement).toBe(footer)
        const save = buttonWithText(root, language.uiCommon.save)
        expect(partOf(save)).toBe('modal-action')
        expect(save.parentElement).toBe(footer)
    })

    test('acceptance: the empty list shows modal-text in place of a list', () => {
        DBState.db.loadouts = []
        const root = mountModal()
        const empty = Array.from(root.querySelectorAll('p')).find((p) => p.textContent?.trim() === L.noLoadouts) as HTMLElement
        expect(partOf(empty)).toBe('modal-text')
        expect(partOf(empty.parentElement)).toBeNull()
        expect(partOf(empty.previousElementSibling)).toBe('modal-text')
        expect(root.querySelector('[data-part="modal-list"]')).toBeNull()
    })

    test('acceptance: the whole nesting with four sections', () => {
        const section = (cards: string[]) => `modal-text modal-list(${cards.join(' ')})`
        const body = [section([CARD, CARD]), section([CARD]), section([CARD]), section([CARD, CARD])].join(' ')
        expect(outline(mountModal())).toBe(
            'modal-loadout(modal-frame(modal-header(modal-title modal-close) modal-controls(modal-text modal-action modal-action modal-action modal-action) '
            + `modal-body(${body}) modal-footer(modal-field modal-action)))`)
    })

    test('guard: Pick applies the loadout once and closes, Remove takes the loadout out, Save hands the typed name over', () => {
        const root = mountModal()
        const pick = spanWithText(root, 'Beta').parentElement as HTMLElement
        pick.click()
        flushSync()
        expect(spies.applyLoadout).toHaveBeenCalledTimes(1)
        expect((spies.applyLoadout.mock.calls[0][0] as { id: string }).id).toBe('b')
        expect(loadoutModalStore.open).toBe(false)

        const again = mountModal()
        const remove = again.querySelector(`button[aria-label="${language.remove}"]`) as HTMLElement
        remove.click()
        flushSync()
        expect(DBState.db.loadouts.map((l) => l.id)).toEqual(['b'])

        const input = again.querySelector('input[type="text"]') as HTMLInputElement
        input.value = 'L1'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        buttonWithText(again, language.uiCommon.save).click()
        expect(spies.saveCurrentLoadout).toHaveBeenCalledWith('L1')
    })

    test('guard: the section elements and the nested meta spans carry no part', () => {
        const root = mountModal()
        const heading = spanWithText(root, L.recentlyUsed).parentElement as HTMLElement
        expect(partOf(heading.parentElement)).toBeNull()
        expect(heading.parentElement!.tagName).toBe('SECTION')
        const meta = spanWithText(root, 'Alpha').nextElementSibling as HTMLElement
        for (const inner of Array.from(meta.querySelectorAll('span'))) expect(partOf(inner)).toBeNull()
    })
})
