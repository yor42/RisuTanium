// @vitest-environment jsdom

/**
 * TC3-6: the action sheet's destructive group paints the danger role on the sheet surface, at 4.5:1 or more, under every built-in
 * colour scheme with no theme pack. The colour comes from the real compiled `ActionSheet.svelte` CSS, resolved over the real
 * Tailwind output of `src/styles.css` (which carries `nexus-tokens.css`), the chat stylesheets in the order ChatShell imports
 * them, and the real `updateColorScheme`.
 *
 * (i) the sheet surface is the scheme's bgcolor: a compatibility guard that passes before and after, and fails if the sheet
 * mapping moves to another colour. (ii) the pair is at least 4.5:1: a compatibility guard. (iii) the destructive paint is the
 * danger role itself: a regression reproducer for "destructive marked only by warning yellow". No pack is installed here; the
 * pack case is judged by the install-time shared pairs.
 */
import { compile } from 'svelte/compiler'
import postcss from 'postcss'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { cr, parseConcrete, type Rgba } from '../../ts/themePack/colour'
import { CascadeModel, chatShellCssImports, compileAppStyles, compileRules, normaliseColours, readRepoFile, type RuleSet } from '../../styles/tests/cascadeModel'

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

import { colorSchemeList, updateColorScheme } from '../../ts/gui/colorscheme'

let rules: RuleSet
let destructiveColor: string | undefined

beforeAll(async () => {
    const tailwind = await compileAppStyles([])
    const chat = chatShellCssImports().map((file) => ({ name: file.split('/').pop()!.replace(/\.css$/, ''), css: readRepoFile(file) }))
    rules = compileRules([tailwind, ...chat])
    const source = readRepoFile('src/lib/ChatShell/ActionSheet.svelte')
    const { css } = compile(source, { filename: 'ActionSheet.svelte', generate: 'client', css: 'external' })
    postcss.parse(css?.code ?? '').walkRules((rule) => {
        if (!rule.selector.includes('data-destructive-group')) return
        rule.walkDecls('color', (d) => { destructiveColor = d.value })
    })
}, 120000)

function fromHex8(text: string): Rgba {
    const c = parseConcrete(`#${text.slice(1, 7)}`)!
    return [c[0], c[1], c[2], text.length === 9 ? parseInt(text.slice(7, 9), 16) / 255 : 1]
}

describe('TC3-6: the destructive group on the sheet surface, no theme pack', () => {
    test('the compiled component paints its destructive group with a colour declaration', () => {
        expect(destructiveColor, 'the compiled component styles the destructive group colour').toBeDefined()
    })

    test.each(colorSchemeList as string[])('%s: sheet is bgcolor, danger paint is the danger role, pair at least 4.5:1', (key) => {
        h.db.colorSchemeName = key
        document.documentElement.removeAttribute('style')
        updateColorScheme()
        document.body.innerHTML = `<div id="probe" style="color: ${destructiveColor}"></div>`
        const m = new CascadeModel(rules)
        const root = document.documentElement
        const norm = (value: string | undefined): string => normaliseColours(value!, '#000000ff')
        const sheet = norm(m.custom(root, '--color-surface-sheet'))
        expect(sheet).toBe(norm(m.custom(root, '--risu-theme-bgcolor')))
        const painted = m.painted(document.getElementById('probe')!).color
        expect(painted).toBe(norm(m.custom(root, '--nexus-danger')))
        expect(cr(fromHex8(painted), fromHex8(sheet))).toBeGreaterThanOrEqual(4.5)
    })
})
