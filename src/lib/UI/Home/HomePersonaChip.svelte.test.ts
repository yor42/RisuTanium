// @vitest-environment jsdom

/**
 * `HomePersonaChip.svelte` label wrapping. The set-up label (no stored name) must wrap rather than
 * be cut off at large font sizes, so it carries no `truncate` and keeps Korean words whole with
 * `break-keep`; a stored name is unbounded, so the named label stays one truncated line.
 *
 * jsdom does no layout, so the classes are the observable contract here; the real width check is a
 * device leg at the largest font size.
 *
 * The named-label case is a compatibility guard: its behaviour is unchanged, and it fails before the
 * change only because the `data-part` hook did not exist.
 *
 * MOCKED: `stores.svelte` (only `DBState.db.username` is read) and the Settings opener.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { username: '' } })
    return { DBState: state } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('./homeEmptyActions'), () => ({
    openPersonaSettings: vi.fn(),
}) as unknown as typeof import('./homeEmptyActions'))

import HomePersonaChip from './HomePersonaChip.svelte'
import { DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'

const mounted: { instance: unknown, target: HTMLElement }[] = []

function mountChip(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push({ instance: mount(HomePersonaChip, { target }), target })
    flushSync()
    return target
}

function label(root: HTMLElement): HTMLElement {
    const el = root.querySelector<HTMLElement>('[data-part="home-persona-chip-label"]')
    expect(el).not.toBeNull()
    return el!
}

afterEach(async () => {
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
    DBState.db.username = ''
})

describe('HomePersonaChip label', () => {
    test('the set-up label wraps: no truncate, break-keep', () => {
        DBState.db.username = ''
        const el = label(mountChip())
        expect(el.textContent).toBe(language.homePersonaChipUnnamed)
        expect(el.classList.contains('truncate')).toBe(false)
        expect(el.classList.contains('break-keep')).toBe(true)
        expect(el.classList.contains('min-w-0')).toBe(true)
    })

    test('a named label stays one truncated line', () => {
        DBState.db.username = 'A very long persona name that would otherwise push the chip wide'
        const el = label(mountChip())
        expect(el.textContent).toBe(language.homePersonaChip('A very long persona name that would otherwise push the chip wide'))
        expect(el.classList.contains('truncate')).toBe(true)
    })

    test('the label switches form live when the name is set and cleared', () => {
        DBState.db.username = ''
        const root = mountChip()
        expect(label(root).classList.contains('truncate')).toBe(false)
        DBState.db.username = 'Mina'
        flushSync()
        expect(label(root).classList.contains('truncate')).toBe(true)
        DBState.db.username = ''
        flushSync()
        expect(label(root).classList.contains('truncate')).toBe(false)
    })
})
