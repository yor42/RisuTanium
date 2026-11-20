// @vitest-environment jsdom

/**
 * The composer field's border is a text-field border: at least 3:1 against the canvas under the
 * built-in Default. The rule is read from the real compiled component CSS and resolved over the real
 * Tailwind output of `src/styles.css` and the real `updateColorScheme`.
 */
import { compile } from 'svelte/compiler'
import postcss from 'postcss'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { cr, over, parseConcrete, type Rgba } from '../../ts/themePack/colour'
import { CascadeModel, compileAppStyles, compileRules, normaliseColours, readRepoFile, type RuleSet } from '../../styles/tests/cascadeModel'

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

import { defaultColorScheme, updateColorScheme } from '../../ts/gui/colorscheme'

let rules: RuleSet

beforeAll(async () => {
    const tailwind = await compileAppStyles([])
    rules = compileRules([tailwind, { name: 'chat-tokens', css: readRepoFile('src/styles/chat-tokens.css') }])
}, 120000)

function fromHex8(text: string): Rgba {
    const c = parseConcrete(`#${text.slice(1, 7)}`)!
    return [c[0], c[1], c[2], text.length === 9 ? parseInt(text.slice(7, 9), 16) / 255 : 1]
}

describe('TB3: the composer field border', () => {
    test('AS-B1c: the composer input border is at least 3:1 against the canvas under Default', () => {
        const source = readRepoFile('src/lib/ChatShell/ShellComposer.svelte')
        const { css } = compile(source, { filename: 'ShellComposer.svelte', generate: 'client', css: 'external' })
        let border: string | undefined
        postcss.parse(css?.code ?? '').walkRules((rule) => {
            if (!rule.selector.includes('chat-composer-input')) return
            rule.walkDecls('border', (d) => { border = d.value })
        })
        expect(border, 'the compiled component styles the input with a border').toBeDefined()

        h.db.colorScheme = structuredClone(defaultColorScheme)
        h.db.colorSchemeName = 'default'
        document.documentElement.removeAttribute('style')
        updateColorScheme()
        document.body.innerHTML = `<div id="field" style="border: ${border}"></div>`
        const m = new CascadeModel(rules)
        const canvas = fromHex8(normaliseColours(m.custom(document.documentElement, '--nexus-canvas')!, '#000000ff'))
        const edge = fromHex8(m.painted(document.getElementById('field')!)['border-top-color'])
        expect(cr(over(edge, canvas), canvas)).toBeGreaterThanOrEqual(3)
    })
})
