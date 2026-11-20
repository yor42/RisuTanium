// @vitest-environment jsdom

/**
 * `PromptDiffModal.svelte`: the close button, the option radios and the toggle checkboxes are named,
 * the glyph is hidden, the active pill and the chrome follow the scheme tokens, and the diff
 * semantics (the green, red and blue add, remove and modify classes, E5) and the `bg-black bg-black/60`
 * scrim (E2) stay. Mounts the REAL component over two fixture presets; only `getDatabase` and the
 * Android Back registry are replaced, as in `PromptDiffModal.i18n.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import 'src/ts/polyfill'
import type { Database } from 'src/ts/storage/database.svelte'

const dbBox = vi.hoisted(() => ({ db: {} as unknown }))

vi.mock(import('../../ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => dbBox.db),
}) as unknown as typeof import('../../ts/storage/database.svelte'))

vi.mock('src/ts/backHandlers', () => ({
    registerBackHandler: () => () => {},
    backCloseHandler: () => () => false,
}))

import { language } from 'src/lang'
import { controlName, exposedIcons, paletteClasses, textColourTokens, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import PromptDiffModal from './PromptDiffModal.svelte'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await sleep(20)
        flushSync()
    }
}

/** The diff semantics keep their categorical hues (E5) and the dimmed scrim stays (E2). */
const E5_AND_E2 = [/^(bg|border|text)-(green|red|blue)-\d{3}(\/\d+)?$/, /^bg-black$/, /^bg-black\/60$/]

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

async function mountModal(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PromptDiffModal, { target, props: { firstPresetId: 0, secondPresetId: 1 } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    await settle()
    return target
}

const bodyLines = (changed: string) =>
    Array.from({ length: 30 }, (_, i) => (i === 15 ? changed : `line ${i}`)).join('\n')

function plain(name: string | undefined, text: string) {
    return { type: 'plain', type2: 'normal', role: 'system', text, ...(name === undefined ? {} : { name }) }
}

type Prefs = { diffStyle: string, formatStyle: string, viewStyle: string, showOnlyChanges: boolean }

function useDb(prefs: Prefs): void {
    dbBox.db = {
        promptDiffPrefs: { isGrouped: false, contextRadius: 1, ...prefs },
        botPresets: [
            { promptTemplate: [plain('Main', bodyLines('old')), plain(undefined, 'same'), plain('Gone', 'removed body')] },
            { promptTemplate: [plain('Main', bodyLines('new')), plain(undefined, 'same'), plain('Extra', 'added body')] },
        ],
    } as unknown as Database
}

const STATES: Prefs[] = []
for (const formatStyle of ['card', 'raw']) {
    for (const viewStyle of ['unified', 'split']) {
        for (const diffStyle of ['line', 'intraline']) {
            for (const showOnlyChanges of [false, true]) {
                STATES.push({ diffStyle, formatStyle, viewStyle, showOnlyChanges })
            }
        }
    }
}

beforeEach(() => {
    useDb({ diffStyle: 'line', formatStyle: 'card', viewStyle: 'unified', showOnlyChanges: false })
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('PromptDiffModal accessible names', { timeout: 60_000 }, () => {
    test('regression reproducer: the close button is named and the options are named by their visible text', async () => {
        const target = await mountModal()
        const close = Array.from(target.querySelectorAll('button')).find((b) => b.querySelector('svg') !== null && (b.textContent ?? '').trim() === '') as HTMLButtonElement
        expect(controlName(close)).toBe(language.uiCommon.close)
        const radios = Array.from(target.querySelectorAll('input[type=radio]')) as HTMLInputElement[]
        expect(radios.length).toBeGreaterThan(0)
        for (const radio of radios) {
            expect(controlName(radio)).toBe((radio.parentElement!.textContent ?? '').trim())
            expect(radio.hasAttribute('aria-labelledby')).toBe(false)
        }
        const boxes = Array.from(target.querySelectorAll('input[type=checkbox]')) as HTMLInputElement[]
        expect(boxes).toHaveLength(3)
        expect(boxes.map(controlName)).toEqual([language.promptDiff.legacy, language.promptDiff.grouped, language.promptDiff.onlyChanges])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: the close glyph is hidden', async () => {
        const target = await mountModal()
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: every view state has no default-palette class beyond the diff semantics and the scrim', async () => {
        for (const state of STATES) {
            useDb(state)
            const target = await mountModal()
            expect(paletteClasses(target, { allow: E5_AND_E2 }), JSON.stringify(state)).toEqual([])
            await unmount(mounted.pop()!.app as never)
            target.remove()
        }
    })

    test('regression reproducer: the active pill is a scheme fill with a ring, not black on white', async () => {
        const target = await mountModal()
        const active = Array.from(target.querySelectorAll('label')).filter((l) => (l.querySelector('input[type=radio]') as HTMLInputElement | null)?.checked)
        expect(active.length).toBeGreaterThan(0)
        for (const pill of active) {
            expect(pill.classList.contains('bg-selected')).toBe(true)
            expect(pill.classList.contains('text-textcolor')).toBe(true)
            expect(pill.classList.contains('ring-1')).toBe(true)
            expect(pill.classList.contains('ring-borderc')).toBe(true)
        }
    })

    test('regression reproducer: the checkbox and range accents use the scheme token', async () => {
        const target = await mountModal()
        for (const input of Array.from(target.querySelectorAll('input[type=checkbox]'))) {
            expect(input.classList.contains('accent-borderc')).toBe(true)
        }
    })

    test('regression reproducer: the close hover differs from its rest colour', async () => {
        const target = await mountModal()
        const close = Array.from(target.querySelectorAll('button')).find((b) => b.querySelector('svg') !== null && (b.textContent ?? '').trim() === '') as HTMLButtonElement
        const { rest, hover } = textColourTokens(close.querySelector('svg')!.parentElement!)
        expect(hover).not.toBeNull()
        expect(hover).not.toBe(rest)
    })

    test('guard: the diff semantics keep their add and remove classes (E5)', async () => {
        useDb({ diffStyle: 'line', formatStyle: 'raw', viewStyle: 'unified', showOnlyChanges: false })
        const target = await mountModal()
        expect(target.querySelector('.border-green-500.bg-green-500\\/10.text-green-400')).not.toBeNull()
        expect(target.querySelector('.border-red-500.bg-red-500\\/10.text-red-400')).not.toBeNull()
        expect(target.querySelector('.bg-blue-500')).not.toBeNull()
    })
})
