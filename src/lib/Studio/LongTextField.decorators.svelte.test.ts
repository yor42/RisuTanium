// @vitest-environment jsdom
/**
 * The generic `extraProblems` / `extraPicks` / `extraMarks` wiring of the long-text field, driven with the real lore
 * decorator functions as the extra source. Fields without the props are covered by the existing LongText suites.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { checkCbs } from '../../ts/studio/longText/cbsCheck'
import type { LongTextWritePort } from '../../ts/studio/longText/fieldWrite'
import { loreDecoratorNotes, loreDecoratorPickSource, loreDecoratorProblems, type LoreDecoratorCopy } from '../../ts/studio/longText/loreDecorators'
import { createMacroIndex, type MacroEntry } from '../../ts/studio/longText/macroIndex'
import { setMacroIndexForTests } from '../../ts/studio/longText/macroIndexService'
import type { PickSource } from '../../ts/studio/longText/macroPick'
import { setTokenCounterForTests } from '../../ts/studio/longText/tokenService'
import LongTextField from './LongTextField.svelte'

// A language table that answers every key with the key, so the real locale and what it imports stay out of the test.
vi.mock('../../lang', async () => {
    const helpers = await import('../../ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const withArguments = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const own: Record<string, unknown> = {}
    for (const key of ['ltTokens', 'ltTokensEst', 'ltTokEstOnline', 'ltTokEstUnavailable', 'ltTokEstError', 'ltProblemCount', 'ltProblemsShowAll', 'ltProblemLine', 'ltProblemFix', 'cbsUnclosed', 'cbsStrayBlockClose', 'cbsNotABlock', 'ltMacroMatches', 'ltTokensVaries']) own[key] = withArguments(key)
    own.ltMacroRows = new Proxy({}, { get: (_target, id) => typeof id === 'string' ? `row:${id}` : undefined })
    return { language: new Proxy(base, { get: (target, key) => typeof key === 'string' && key in own ? own[key] : Reflect.get(target, key) }) }
})

vi.mock('../../ts/stores.svelte', () => ({ DBState: { db: {} } }))

// The layer reads the notice and the layout only; the real screen state drags the whole app in.
vi.mock('../../ts/studio/studioScreen.svelte', () => ({
    studioScreen: { layout: 'wide', notice: null, noticePlaces: null },
    setStudioNotice: () => {},
}))

vi.mock('../../ts/studio/studioBack.svelte', () => ({ registerStudioBackLayer: () => {} }))

vi.mock('../../ts/studio/history/studioHistoryService.svelte', () => ({ currentVisitAck: () => null }))

vi.mock('../../ts/studio/longText/cbsCheck', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../ts/studio/longText/cbsCheck')>()
    return { ...actual, checkCbs: vi.fn(actual.checkCbs) }
})

const copy: LoreDecoratorCopy = {
    unknown: (name) => `unknown:${name}`,
    afterText: () => 'afterText',
    badArg: (name) => `badArg:${name}`,
    argMissing: (name) => `argMissing:${name}`,
    probabilityNaN: () => 'probabilityNaN',
    priorityNaN: () => 'priorityNaN',
    probabilityMany: () => 'probabilityMany',
    ignored: (name) => `ignored:${name}`,
    fallback: () => 'fallback',
    deprecated: () => 'deprecated',
    help: (name) => `help:${name}`,
    matches: (n) => `decoMatches(${n})`,
    listLabel: () => 'decoList',
}

interface Fixture { owner: { value: string }, writes: string[], port: LongTextWritePort }

function fixture(stored: string): Fixture {
    const owner = $state({ value: stored })
    const writes: string[] = []
    return {
        owner,
        writes,
        port: {
            read: () => owner.value,
            write: (value) => {
                writes.push(value)
                owner.value = value
                return { ok: true }
            },
            closeStep: () => {},
        },
    }
}

const macroEntry = (name: string): MacroEntry => ({ name, aliases: [], summary: name, usage: null, docOnly: false, internalOnly: false, blockSyntax: name.startsWith('#') || name.startsWith(':'), deprecated: null })

let mounted: ReturnType<typeof mount>[] = []
let hosts: HTMLElement[] = []

interface Extras { editable?: boolean, withExtras?: boolean }

function mountField(fix: Fixture, options: Extras = {}): { area: HTMLTextAreaElement, host: HTMLElement } {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const withExtras = options.withExtras ?? true
    const pickSource: PickSource = loreDecoratorPickSource(copy)
    const app = mount(LongTextField, {
        target: host,
        props: {
            port: fix.port,
            part: 'studio-form-desc',
            kind: 'desc',
            mode: 'cbs',
            editable: options.editable ?? true,
            busy: false,
            fieldClass: 'w-full',
            extraMarks: withExtras ? loreDecoratorNotes : undefined,
            extraProblems: withExtras ? (text: string) => loreDecoratorProblems(text, copy) : undefined,
            extraPicks: withExtras ? pickSource : undefined,
            onresult: () => {},
        },
    })
    mounted.push(app)
    hosts.push(host)
    flushSync()
    return { area: host.querySelector('textarea') as HTMLTextAreaElement, host }
}

beforeEach(() => {
    vi.mocked(checkCbs).mockClear()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    setMacroIndexForTests(createMacroIndex(['char', 'user', 'getvar', '#if', ':else'].map(macroEntry)))
    setTokenCounterForTests({ request: async (_key, text) => ({ kind: 'app-count', count: text.length, tokenizer: 'o200k_base', model: 'M' }) })
})

afterEach(async () => {
    setTokenCounterForTests(null)
    setMacroIndexForTests(null)
    for (const app of mounted.splice(0)) await unmount(app)
    for (const host of hosts.splice(0)) host.remove()
    vi.useRealTimers()
})

async function settle(): Promise<void> {
    for (let turn = 0; turn < 6; turn += 1) await Promise.resolve()
    flushSync()
}

async function advance(ms: number): Promise<void> {
    vi.advanceTimersByTime(ms)
    flushSync()
    await settle()
}

function typeInto(area: HTMLTextAreaElement, value: string, composing = false): void {
    area.value = value
    area.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: composing, inputType: composing ? 'insertCompositionText' : 'insertText' }))
    flushSync()
}

function keyOn(target: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    flushSync()
    return event
}

const rowsOf = (root: ParentNode): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>('[data-part="studio-lt-problem-row"]'))
const kindsOf = (root: ParentNode): (string | undefined)[] => rowsOf(root).map((row) => row.dataset.kind)
const lineOf = (row: HTMLElement): string | null | undefined => row.querySelector('[data-part="studio-lt-problem-line"]')?.textContent
const pickerOf = (root: ParentNode): HTMLElement | null => root.querySelector('[data-part="studio-lt-picker"]')
const optionNames = (root: ParentNode): (string | null | undefined)[] => Array.from(root.querySelectorAll('[data-part="studio-lt-picker-option"]')).map((option) => option.querySelector('[data-part="studio-lt-picker-name"]')?.textContent)
const overlayOf = (root: ParentNode): HTMLElement => root.querySelector('[data-part="studio-lt-overlay"]') as HTMLElement
const sheetOptions = (root: ParentNode): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>('[data-part="studio-lt-sheet-option"]'))

const PROBLEM_TEXT = '@@probabilty 50\n\n@@depth 1\nbody {{getvr::x}}'

describe('TW1 extra problems join the checker rows', () => {
    test('rows for W1, W2 and the unknown macro, one count, extra kinds on data-kind', async () => {
        const { host } = mountField(fixture(PROBLEM_TEXT))
        await advance(249)
        expect(rowsOf(host)).toHaveLength(0)
        await advance(1)
        expect(kindsOf(host)).toEqual(['x-deco-unknown', 'x-deco-afterText', 'unknown-macro'])
        expect(rowsOf(host).map(lineOf)).toEqual(['ltProblemLine(1)', 'ltProblemLine(3)', 'ltProblemLine(4)'])
        expect(host.querySelector('[data-part="studio-lt-problem-count"]')?.textContent).toBe('ltProblemCount(3)')
        expect(host.querySelectorAll('[data-part="studio-lt-problem-fix"]')).toHaveLength(0)
    })

    test('without the props the same text lists the checker rows alone', async () => {
        const { host } = mountField(fixture(PROBLEM_TEXT), { withExtras: false })
        await advance(250)
        expect(kindsOf(host)).toEqual(['unknown-macro'])
    })
})

describe('TW2 extra marks and error spans on the overlay', () => {
    test('a throwing decorator line is an error span; block lines carry the decorator note and the W2 line does not', async () => {
        const { host } = mountField(fixture('@@position\n@@depth 1\nbody\n@@depth 2'))
        await advance(250)
        const errors = Array.from(overlayOf(host).querySelectorAll('[data-severity="error"]')).map((el) => el.textContent)
        expect(errors.join('')).toContain('@@position')
        const noted = Array.from(overlayOf(host).querySelectorAll('[data-note="decorator"]')).map((el) => el.textContent)
        expect(noted).toEqual(['@@position', '@@depth 1'])
    })
})

describe('TW3 the decorator picker', () => {
    test('typing @@pro opens it with probability first, named and counted by the source, and Enter writes the insertion once', async () => {
        const fix = fixture('')
        const { area, host } = mountField(fix)
        area.focus()
        typeInto(area, '@@pro')
        await settle()
        expect(optionNames(host)[0]).toBe('probability')
        expect(pickerOf(host)?.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe('decoList')
        expect(pickerOf(host)?.querySelector('[data-part="studio-lt-picker-count"]')?.textContent).toBe(`decoMatches(${optionNames(host).length})`)
        keyOn(area, 'Enter')
        expect(fix.writes).toEqual(['@@pro', '@@probability '])
        expect(area.selectionStart).toBe('@@probability '.length)
        expect(pickerOf(host)).toBeNull()
    })

    test('after text that is not a decorator line there is no picker', async () => {
        const { area, host } = mountField(fixture(''))
        area.focus()
        typeInto(area, 'x\n\n@@pro')
        await settle()
        expect(pickerOf(host)).toBeNull()
    })

    test('{{ still opens the macro picker with the macro wording', async () => {
        const { area, host } = mountField(fixture(''))
        area.focus()
        typeInto(area, '{{')
        await settle()
        expect(pickerOf(host)).not.toBeNull()
        expect(pickerOf(host)?.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe('ltInsertMacro')
        expect(pickerOf(host)?.querySelector('[data-part="studio-lt-picker-count"]')?.textContent).toMatch(/^ltMacroMatches\(/)
        expect(optionNames(host)).not.toContain('probability')
    })
})

describe('TW4 read-only', () => {
    test('a read-only field never opens the decorator picker', async () => {
        const { area, host } = mountField(fixture(''), { editable: false })
        typeInto(area, '@@pro')
        await settle()
        expect(pickerOf(host)).toBeNull()
    })
})

describe('TW5 the focus layer', () => {
    test('shows the same rows and opens the decorator picker', async () => {
        const { host } = mountField(fixture(PROBLEM_TEXT))
        keyOn(host.querySelector('textarea') as HTMLElement, 'e', { ctrlKey: true })
        await settle()
        const layer = document.querySelector('[data-part="studio-lt-focus-layer"]') as HTMLElement
        expect(layer).not.toBeNull()
        await advance(250)
        expect(kindsOf(layer)).toEqual(['x-deco-unknown', 'x-deco-afterText', 'unknown-macro'])
        const input = layer.querySelector('[data-part="studio-lt-focus-input"]') as HTMLTextAreaElement
        input.focus()
        typeInto(input, '@@pro')
        await settle()
        expect(optionNames(layer)[0]).toBe('probability')
        expect(pickerOf(layer)?.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe('decoList')
    })
})

describe('TW6 composition', () => {
    test('no extra problem is computed while composing; the rows appear after the composition ends', async () => {
        const fix = fixture('')
        const { area, host } = mountField(fix)
        area.focus()
        area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        typeInto(area, PROBLEM_TEXT, true)
        await advance(2000)
        expect(rowsOf(host)).toHaveLength(0)
        expect(vi.mocked(checkCbs)).not.toHaveBeenCalled()
        area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        flushSync()
        await advance(250)
        expect(kindsOf(host)).toEqual(['x-deco-unknown', 'x-deco-afterText', 'unknown-macro'])
    })
})

describe('TW8 the sheet always lists macros', () => {
    test('with the decorator picker open, the braces button opens the macro sheet with the macro items only', async () => {
        const macroOnly = mountField(fixture(''), { withExtras: false })
        ;(macroOnly.host.querySelector('[data-part="studio-lt-braces"]') as HTMLButtonElement).click()
        await settle()
        const expected = sheetOptions(macroOnly.host).length
        expect(expected).toBeGreaterThan(0)

        const { area, host } = mountField(fixture(''))
        area.focus()
        typeInto(area, '@@pro')
        await settle()
        expect(pickerOf(host)).not.toBeNull()
        ;(host.querySelector('[data-part="studio-lt-braces"]') as HTMLButtonElement).click()
        await settle()
        expect(pickerOf(host)).toBeNull()
        const listed = sheetOptions(host)
        expect(listed).toHaveLength(expected)
        expect(listed.some((option) => option.textContent?.startsWith('probability'))).toBe(false)
    })
})
