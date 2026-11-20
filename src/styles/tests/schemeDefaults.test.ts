// @vitest-environment node

/**
 * The colours the page paints before the colour scheme is applied (the `:root` defaults of
 * `src/styles.css`) are the built-in Default scheme, so the pre-scheme paint and the first scheme
 * write do not differ. The file reads the real stylesheet and the real default table.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import { describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
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
    DBState: { db: {} },
    CustomCSSStore: { subscribe: vi.fn(), set: vi.fn() },
    SafeModeStore: { subscribe: vi.fn(), set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/gui/systemBars'), () => ({
    syncSystemBars: vi.fn(),
}) as unknown as typeof import('src/ts/gui/systemBars'))

import { defaultColorScheme } from '../../ts/gui/colorscheme'

const FIELD_BY_PROPERTY = {
    '--risu-theme-bgcolor': 'bgcolor',
    '--risu-theme-darkbg': 'darkbg',
    '--risu-theme-borderc': 'borderc',
    '--risu-theme-selected': 'selected',
    '--risu-theme-draculared': 'draculared',
    '--risu-theme-textcolor': 'textcolor',
    '--risu-theme-textcolor2': 'textcolor2',
    '--risu-theme-darkborderc': 'darkBorderc',
    '--risu-theme-darkbutton': 'darkbutton',
} as const

describe('TB4a: the pre-scheme page defaults are the built-in Default', () => {
    test('each of the nine --risu-theme-* defaults of src/styles.css equals the default scheme field', () => {
        const css = readFileSync(path.join(process.cwd(), 'src/styles.css'), 'utf8')
        const declared: Record<string, string> = {}
        postcss.parse(css).walkRules(':root', (rule) => {
            rule.walkDecls(/^--risu-theme-(bgcolor|darkbg|borderc|selected|draculared|textcolor|textcolor2|darkborderc|darkbutton)$/, (d) => {
                declared[d.prop] = d.value.trim().toLowerCase()
            })
        })
        const expected: Record<string, string> = {}
        for (const [property, field] of Object.entries(FIELD_BY_PROPERTY)) expected[property] = defaultColorScheme[field].toLowerCase()
        expect(declared).toEqual(expected)
    })
})
