// @vitest-environment happy-dom

/**
 * `LoadoutModal.svelte` shows the preset a loadout targets by that preset's current name: a loadout whose `presetId`
 * resolves shows the renamed preset, and one whose id is absent or dangling shows the stored `presetName`.
 *
 * Mounts the REAL component and the REAL `loadout.ts` resolver over a `$state` stand-in for `DBState`. MOCKED: the
 * database module's `getCurrentCharacter` and the persona switch, which the card never calls.
 *
 * C4 is a regression reproducer: it fails while the card prints the stored name. The other cases are guards.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        loadoutModalStore: { open: true },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(() => undefined),
    changeToPreset: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/persona'), () => ({
    changeUserPersona: vi.fn(),
}) as unknown as typeof import('src/ts/persona'))

import { DBState } from 'src/ts/stores.svelte'
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

function seed(loadout: Record<string, unknown>): void {
    DBState.db = {
        loadoutApplyOptions: { modules: true, globalVariables: true, preset: true, persona: true },
        botPresets: [{ name: 'Alpha', id: 'id-a' }, { name: 'Beta Renamed', id: 'id-b' }],
        loadouts: [{ id: 'l1', name: 'My loadout', lastUsed: 1, favorite: false, ...loadout }],
    } as unknown as Database
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

/** The preset names the cards print, one per card in each section. */
function shownNames(target: HTMLElement): string[] {
    return Array.from(target.querySelectorAll('span[class~="text-textcolor/60"]')).map((span) => span.textContent?.trim() ?? '')
}

describe('LoadoutModal preset name', () => {
    test('C4 regression reproducer: a renamed preset shows its current name', () => {
        seed({ presetName: 'Beta', presetId: 'id-b' })
        const names = shownNames(mountModal())
        expect(names.length).toBeGreaterThan(0)
        expect(names.every((name) => name === 'Beta Renamed')).toBe(true)
    })

    test('guard: a loadout without a preset id shows the name it holds', () => {
        seed({ presetName: 'Alpha' })
        const names = shownNames(mountModal())
        expect(names.length).toBeGreaterThan(0)
        expect(names.every((name) => name === 'Alpha')).toBe(true)
    })

    test('guard: a dangling id falls back to the stored name', () => {
        seed({ presetName: 'Gone', presetId: 'id-gone' })
        const names = shownNames(mountModal())
        expect(names.length).toBeGreaterThan(0)
        expect(names.every((name) => name === 'Gone')).toBe(true)
    })

    test('guard: no stored name and no resolving id shows no preset name', () => {
        seed({ presetName: '' })
        expect(shownNames(mountModal())).toEqual([])
    })
})
