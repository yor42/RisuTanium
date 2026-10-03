// @vitest-environment happy-dom

/**
 * `PromptDiffModal.svelte` shows its option labels, status words and counters in the UI
 * language, read when the component initialises and renders. The language is set before
 * mount and restored to English afterwards. The radio inputs keep the same English `value`
 * attributes in every language, because those values are what the component binds.
 * Interpolated lines (omitted-line dividers, change counts, the cards-changed summary) are
 * whole translated sentences with the numbers filled in.
 *
 * Mounts the REAL component over two fixture presets. MOCKED: `getDatabase`, which returns
 * a plain object holding the two presets and the stored preferences.
 *
 * Tests whose title starts with `guard:` pass with or without the translation work: they pin
 * behaviour that must be preserved. Tests starting `regression reproducer:` fail while a
 * label is a hard-coded English literal.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import 'src/ts/polyfill'
import type { Database } from 'src/ts/storage/database.svelte'

const dbBox = vi.hoisted(() => ({ db: {} as unknown }))

vi.mock(import('../../ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => dbBox.db),
}) as unknown as typeof import('../../ts/storage/database.svelte'))

import { changeLanguage } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'
import { fillLang } from 'src/lang/fill'
import PromptDiffModal from './PromptDiffModal.svelte'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await sleep(20)
        flushSync()
    }
}

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

function useDb(formatStyle: 'raw' | 'card', showOnlyChanges: boolean): void {
    dbBox.db = {
        promptDiffPrefs: {
            diffStyle: 'line',
            formatStyle,
            viewStyle: 'unified',
            isGrouped: false,
            showOnlyChanges,
            contextRadius: 1,
        },
        botPresets: [
            { promptTemplate: [plain('Main', bodyLines('old')), plain(undefined, 'same')] },
            { promptTemplate: [plain('Main', bodyLines('new')), plain(undefined, 'same'), plain('Extra', 'added body')] },
        ],
    } as unknown as Database
}

const labelTexts = (target: HTMLElement) =>
    Array.from(target.querySelectorAll('label')).map((l) => l.textContent?.trim())

const radioValues = (target: HTMLElement) =>
    Array.from(target.querySelectorAll('input[type="radio"]')).map((i) => (i as HTMLInputElement).value)

beforeEach(() => {
    useDb('card', false)
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    changeLanguage('en')
})

describe('PromptDiffModal option labels', { timeout: 30_000 }, () => {
    test('regression reproducer: Korean shows the diff, format and view options and the toggles in Korean', async () => {
        changeLanguage('ko')
        const ko = languageKorean.promptDiff
        const target = await mountModal()
        const labels = labelTexts(target)
        for (const [translated, english] of [
            [ko.line, languageEnglish.promptDiff.line],
            [ko.intraline, languageEnglish.promptDiff.intraline],
            [ko.unified, languageEnglish.promptDiff.unified],
            [ko.split, languageEnglish.promptDiff.split],
        ]) {
            expect(translated).not.toBe(english)
            expect(labels).toContain(translated)
            expect(labels).not.toContain(english)
        }
        // Raw and Card carry the same wording as the shared format words, so only the English literals are ruled out.
        expect(labels).toContain(ko.raw)
        expect(labels).toContain(ko.card)
        for (const english of ['Raw', 'Card']) {
            expect(labels).not.toContain(english)
        }
        const text = target.textContent ?? ''
        for (const [translated, english] of [
            [ko.diff, 'Diff'],
            [ko.view, 'View'],
            [ko.legacy, 'Legacy'],
            [ko.grouped, 'Grouped'],
            [ko.onlyChanges, 'Only changes'],
        ]) {
            expect(translated).not.toBe(english)
            expect(text).toContain(translated)
            expect(text).not.toContain(english)
        }
    })

    test('guard: Korean keeps the English radio values that the component binds', async () => {
        changeLanguage('ko')
        const target = await mountModal()
        expect(radioValues(target)).toEqual(['line', 'intraline', 'raw', 'card', 'unified', 'split'])
    })

    test('guard: English shows the English option labels and the same radio values', async () => {
        const target = await mountModal()
        expect(labelTexts(target)).toEqual(['Line', 'Intraline', 'Raw', 'Card', 'Unified', 'Split', 'Legacy', 'Grouped', 'Only changes'])
        expect(radioValues(target)).toEqual(['line', 'intraline', 'raw', 'card', 'unified', 'split'])
    })
})

describe('PromptDiffModal interpolated lines', { timeout: 30_000 }, () => {
    test('regression reproducer: Korean card summary fills the compared, total and change counts with no stray brace', async () => {
        changeLanguage('ko')
        const ko = languageKorean.promptDiff
        const target = await mountModal()
        const text = target.textContent ?? ''

        expect(text).toContain(ko.cardsChanged)
        expect(text).toContain(fillLang(ko.comparedCount, { count: 3 }))
        expect(text).toContain(fillLang(ko.totalCards, { first: 2, second: 3 }))
        expect(text).toContain(fillLang(ko.changePlural, { count: 2 }))
        expect(text).toContain(fillLang(ko.changePlural, { count: 3 }))
        expect(text).not.toContain('{')
        expect(text).not.toContain('compared 3')
        expect(text).not.toContain('Cards changed:')
    })

    test('regression reproducer: Korean omitted-line dividers fill the line counts with no stray brace', async () => {
        changeLanguage('ko')
        useDb('card', true)
        const ko = languageKorean.promptDiff
        const target = await mountModal()
        const text = target.textContent ?? ''

        expect(text).toContain(fillLang(ko.linesAboveHidden, { count: 14 }))
        expect(text).toContain(fillLang(ko.linesBelowHidden, { count: 13 }))
        expect(text).not.toContain('{')
        expect(text).not.toContain('lines above not shown')
        expect(text).not.toContain('lines below not shown')
    })

    test('guard: English card summary reads as the English sentences with the numbers filled in', async () => {
        const target = await mountModal()
        const text = (target.textContent ?? '').replace(/\s+/g, ' ')

        expect(text).toContain('Cards changed:')
        expect(text).toContain('compared 3')
        expect(text).toContain('total 2 → 3')
        expect(text).toContain('2 changes')
        expect(text).toContain('3 changes')
        expect(text).not.toContain('{')
    })
})
