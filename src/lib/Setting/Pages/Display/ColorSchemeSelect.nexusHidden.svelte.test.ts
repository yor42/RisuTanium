// @vitest-environment happy-dom

/**
 * The colour-scheme picker offers the 17 built-in presets plus Custom and never the hidden
 * Nexus preset. Compatibility guard: passes with and without the preset file present.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
}))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => h.db),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: h.db },
    CustomCSSStore: { subscribe: vi.fn(), set: vi.fn() },
    SafeModeStore: { subscribe: vi.fn(), set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/gui/systemBars'), () => ({
    syncSystemBars: vi.fn(),
}) as unknown as typeof import('src/ts/gui/systemBars'))

import { colorSchemePresets, defaultColorScheme } from 'src/ts/gui/colorscheme'
import ColorSchemeSelect from './ColorSchemeSelect.svelte'

let target: HTMLElement
let app: Record<string, unknown>

beforeEach(() => {
    h.db.colorSchemeName = 'default'
    h.db.customColorScheme = structuredClone(defaultColorScheme)
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ColorSchemeSelect, { target, props: {} }) as unknown as Record<string, unknown>
    flushSync()
})

afterEach(async () => {
    await unmount(app as never)
    target.remove()
})

describe('ColorSchemeSelect', () => {
    test('T-PRESET-4 guard: 18 buttons, one per built-in preset plus Custom, none titled Nexus', () => {
        const titles = [...target.querySelectorAll('button')].map((b) => b.getAttribute('title') ?? '')
        expect(titles).toHaveLength(Object.keys(colorSchemePresets).length + 1)
        expect(titles).toHaveLength(18)
        expect(titles.some((t) => /nexus/i.test(t))).toBe(false)
    })
})
