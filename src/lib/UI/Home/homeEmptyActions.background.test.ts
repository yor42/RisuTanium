/**
 * `importCharacterFromHome` selects only the slot its own import added, found again by identity, and selects nothing after
 * an import that was sent to the background (MC-2483). `importCharacter` and `changeChar` are recorders; the slots are one
 * live list, as in the application.
 *
 * Labels: (RR) fails on the tree before the rule; (CG) compatibility guard that holds before and after.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

type Slot = { chaId: string }

const h = vi.hoisted(() => ({
    db: { characters: [] as { chaId: string }[] },
    /** what the picker does: pushes slots, may set the report, answers the slots it added */
    pick: null as null | ((report: { backgrounded?: boolean }) => { chaId: string }[]),
    selected: [] as number[],
}))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return h.db } },
    SettingsMenuIndex: { set: vi.fn() },
    settingsOpen: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/settingsShell/settingsPages'), () => ({
    firstIndexOf: vi.fn(() => 0),
}) as unknown as typeof import('src/ts/settingsShell/settingsPages'))

vi.mock(import('src/ts/characterCards'), () => ({
    importCharacter: vi.fn(async (report?: { backgrounded?: boolean }) => h.pick?.(report ?? {}) ?? []),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(async (index: number) => { h.selected.push(index); return 'selected' }),
}) as unknown as typeof import('src/ts/characters'))

import { importCharacterFromHome } from './homeEmptyActions'

const slot = (chaId: string): Slot => ({ chaId })
const push = (chaId: string): Slot => {
    h.db.characters.push(slot(chaId))
    return h.db.characters[h.db.characters.length - 1]
}

beforeEach(() => {
    h.db = { characters: [slot('existing')] }
    h.pick = null
    h.selected = []
})

describe('Home import selection', () => {
    test('R4-26 (RR): an import sent to the background selects nothing and Home stays put', async () => {
        h.pick = (report) => { report.backgrounded = true; return [push('away')] }
        expect(await importCharacterFromHome()).toBe(false)
        expect(h.selected).toEqual([])
    })

    test('R4-34 (RR): Home selects the slot its own import added, not the list tail another import pushed after it', async () => {
        h.pick = () => {
            const mine = push('mine')
            push('other import')
            return [mine]
        }
        expect(await importCharacterFromHome()).toBe(true)
        expect(h.selected).toEqual([1])
    })

    test('R4-34 (RR): a slot that is no longer in the list is not selected, and the tail is not guessed instead', async () => {
        h.pick = () => {
            push('tail')
            return [slot('gone')]
        }
        expect(await importCharacterFromHome()).toBe(false)
        expect(h.selected).toEqual([])
    })

    test('R4-26 (CG): a foreground import selects the added slot', async () => {
        h.pick = () => [push('added')]
        expect(await importCharacterFromHome()).toBe(true)
        expect(h.selected).toEqual([1])
    })

    test('R4-26 (CG): a cancelled pick adds nothing and selects nothing', async () => {
        h.pick = () => []
        expect(await importCharacterFromHome()).toBe(false)
        expect(h.selected).toEqual([])
    })

    test('R4-26 (CG): a pick that added slots selects the last one added', async () => {
        h.pick = () => {
            push('first')
            return [h.db.characters[1], push('second')]
        }
        expect(await importCharacterFromHome()).toBe(true)
        expect(h.selected).toEqual([2])
    })
})
