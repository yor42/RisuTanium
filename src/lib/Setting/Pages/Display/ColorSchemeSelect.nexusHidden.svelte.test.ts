// @vitest-environment happy-dom

/**
 * The colour-scheme picker offers the 17 built-in presets, Nexus and Custom; choosing Nexus
 * applies it through changeColorScheme. The file keeps its historical name.
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
import { nexusColorScheme } from 'src/ts/gui/nexusColorScheme'
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
    test('T-PRESET-4: 19 buttons, one per preset including one titled Nexus, plus Custom', () => {
        const titles = [...target.querySelectorAll('button')].map((b) => b.getAttribute('title') ?? '')
        expect(titles).toHaveLength(Object.keys(colorSchemePresets).length + 1)
        expect(titles).toHaveLength(19)
        expect(titles.filter((t) => t === 'Nexus')).toHaveLength(1)
    })

    test('T-PRESET-4 clicking Nexus stores the nexus values and name', () => {
        const button = [...target.querySelectorAll('button')].find((b) => b.getAttribute('title') === 'Nexus')
        button!.click()
        flushSync()
        expect(h.db.colorSchemeName).toBe('nexus')
        expect(h.db.colorScheme).toEqual(nexusColorScheme)
    })
})
