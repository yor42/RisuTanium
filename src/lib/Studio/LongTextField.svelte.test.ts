// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from '../../lang'
import { setLowPower } from '../../ts/chatShell/motionPrefs.svelte'
import { flushStudioFields } from '../../ts/studio/fieldFlush'
import type { StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
import type { LongTextKind, LongTextMode, LongTextWritePort } from '../../ts/studio/longText/fieldWrite'
import { checkCbs } from '../../ts/studio/longText/cbsCheck'
import { setUpdateClockForTests, tokenSpans, WINDOW_LIMIT, type Note } from '../../ts/studio/longText/highlightSpans'
import type { character } from '../../ts/storage/database.svelte'
import { createMacroIndex, type MacroEntry, type MacroIndex } from '../../ts/studio/longText/macroIndex'
import { setPreviewEngineForTests, type PreviewEngine } from '../../ts/studio/longText/previewEngineService'
import { loadMacroIndex, setMacroIndexForTests } from '../../ts/studio/longText/macroIndexService'
import { LT_TEXT_LAYOUT } from '../../ts/studio/longText/overlayMetrics'
import type { TokenResult } from '../../ts/studio/longText/tokenCount'
import { tokenChipView } from '../../ts/studio/longText/tokenChip'
import { setTokenCounterForTests } from '../../ts/studio/longText/tokenService'
import { studioScreen } from '../../ts/studio/studioScreen.svelte'
import LongTextField from './LongTextField.svelte'
import type { PreviewSourceInput } from './LongTextPreview.svelte'

// A language table that answers every key with the key, so the real locale and what it imports stay out of the test.
// The token chip's keys take arguments, so they answer with the key and its arguments.
vi.mock('../../lang', async () => {
    const helpers = await import('../../ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const withArguments = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const own: Record<string, unknown> = {}
    for (const key of ['ltTokens', 'ltTokensEst', 'ltTokEstOnline', 'ltTokEstUnavailable', 'ltTokEstError', 'ltProblemCount', 'ltProblemsShowAll', 'ltProblemLine', 'ltProblemFix', 'cbsUnclosed', 'cbsStrayBlockClose', 'cbsNotABlock', 'ltMacroMatches', 'ltTokensVaries', 'sbWrites', 'sbMediaHidden']) own[key] = withArguments(key)
    // The macro table's labels: one per row id, answering `row:<id>`.
    own.ltMacroRows = new Proxy({}, { get: (_target, id) => typeof id === 'string' ? `row:${id}` : undefined })
    return { language: new Proxy(base, { get: (target, key) => typeof key === 'string' && key in own ? own[key] : Reflect.get(target, key) }) }
})

// The session adapter table loads the preset adapter, which reads the page database; the real store module loads the
// whole app, so a bare database stands in.
vi.mock('../../ts/stores.svelte', () => ({ DBState: { db: {} } }))

// Only the layout is read (for the default height cap); the real screen state drags the whole app in.
vi.mock('../../ts/studio/studioScreen.svelte', () => ({ studioScreen: { layout: 'wide' } }))

// The picker and the sheet register a Back layer; the real one reaches the whole back-handler chain. The Back rule has
// its own row in the Studio forms rig, which installs the real layers. The registered layers are kept so a row can press Back.
const back = vi.hoisted(() => ({ layers: [] as { isOpen: () => boolean, close: () => void }[] }))
vi.mock('../../ts/studio/studioBack.svelte', () => ({
    registerStudioBackLayer: (layer: { isOpen: () => boolean, close: () => void }) => { back.layers.push(layer) },
}))

// The real colouring, wrapped so a test can count its runs.
vi.mock('../../ts/studio/longText/highlightSpans', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../ts/studio/longText/highlightSpans')>()
    return { ...actual, tokenSpans: vi.fn(actual.tokenSpans) }
})

// The real checker, wrapped so a test can count its runs.
vi.mock('../../ts/studio/longText/cbsCheck', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../ts/studio/longText/cbsCheck')>()
    return { ...actual, checkCbs: vi.fn(actual.checkCbs) }
})

// The real chip view, wrapped so a test can see whether a result reached it.
vi.mock('../../ts/studio/longText/tokenChip', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../ts/studio/longText/tokenChip')>()
    return { ...actual, tokenChipView: vi.fn(actual.tokenChipView) }
})

// The real index loader, wrapped so a test can hold one load back.
vi.mock('../../ts/studio/longText/macroIndexService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../ts/studio/longText/macroIndexService')>()
    return { ...actual, loadMacroIndex: vi.fn(actual.loadMacroIndex) }
})

interface Fixture {
    owner: { value: string }
    writes: string[]
    results: (StudioResult | null)[]
    steps: { count: number }
    port: LongTextWritePort
}

function fixture(stored: string): Fixture {
    const owner = $state({ value: stored })
    const writes: string[] = []
    const steps = { count: 0 }
    return {
        owner,
        writes,
        results: [],
        steps,
        port: {
            read: () => owner.value,
            write: (value) => {
                writes.push(value)
                owner.value = value
                return { ok: true }
            },
            closeStep: () => {
                steps.count += 1
            },
        },
    }
}

let mounted: ReturnType<typeof mount>[] = []
let hosts: HTMLElement[] = []

interface FieldExports {
    insertText(start: number, end: number, text: string, caret: number): void
    value(): string
    selection(): { start: number, end: number }
    composing(): boolean
    reveal(start: number, end: number, refocus?: HTMLElement | null): void
    keepScroll(fn: () => void): void
}

function mountField(fix: Fixture, overrides: { editable?: boolean, busy?: boolean, label?: string, kind?: LongTextKind, mode?: LongTextMode, variant?: 'inline' | 'focus', onvalue?: (value: string) => void, previewSource?: () => PreviewSourceInput, extraMarks?: (text: string) => Note[] } = {}): { area: HTMLTextAreaElement, host: HTMLElement, exported: FieldExports } {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = mount(LongTextField, {
        target: host,
        props: {
            port: fix.port,
            part: 'studio-form-desc',
            label: overrides.label,
            kind: overrides.kind ?? 'desc',
            mode: overrides.mode ?? 'cbs',
            editable: overrides.editable ?? true,
            busy: overrides.busy ?? false,
            fieldClass: 'w-full',
            variant: overrides.variant,
            onvalue: overrides.onvalue,
            previewSource: overrides.previewSource,
            extraMarks: overrides.extraMarks,
            onresult: (result: StudioResult | null) => fix.results.push(result),
        },
    })
    mounted.push(app)
    hosts.push(host)
    flushSync()
    return { area: host.querySelector('textarea') as HTMLTextAreaElement, host, exported: app }
}

// The token counter seam: every request is recorded and answered with an exact count of the text's length.
const tokenRequests: { key: string, text: string }[] = []
let tokenAnswer: (text: string) => Promise<TokenResult | null> = async (text) => ({ kind: 'app-count', count: text.length, tokenizer: 'o200k_base', model: 'M' })

// A real index over synthetic entries: the checker knows `char` and `getvar` and nothing else.
function macroEntry(name: string): MacroEntry {
    return { name, aliases: [], summary: name, usage: null, docOnly: false, internalOnly: false, blockSyntax: name.startsWith('#') || name.startsWith(':'), deprecated: null }
}

beforeEach(() => {
    vi.mocked(tokenSpans).mockClear()
    vi.mocked(checkCbs).mockClear()
    vi.mocked(tokenChipView).mockClear()
    vi.mocked(loadMacroIndex).mockClear()
    setMacroIndexForTests(createMacroIndex(['char', 'user', 'getvar', '#if', ':else'].map(macroEntry)))
    tokenRequests.length = 0
    tokenAnswer = async (text) => ({ kind: 'app-count', count: text.length, tokenizer: 'o200k_base', model: 'M' })
    setTokenCounterForTests({
        request: async (key, text) => {
            tokenRequests.push({ key, text })
            return tokenAnswer(text)
        },
    })
})

afterEach(async () => {
    setTokenCounterForTests(null)
    setMacroIndexForTests(null)
    for (const app of mounted.splice(0)) await unmount(app)
    for (const host of hosts.splice(0)) host.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    setUpdateClockForTests(null)
    setLowPower(false)
    localStorage.clear()
})

function typeInto(area: HTMLTextAreaElement, value: string, composing = false): void {
    area.value = value
    area.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: composing, inputType: composing ? 'insertCompositionText' : 'insertText' }))
}

describe('the long-text field shell', () => {
    test('shows the stored text with LF endings and marks read-only and busy', () => {
        const { area } = mountField(fixture('a\r\nb\rc'), { editable: false, busy: true })
        expect(area.value).toBe('a\nb\nc')
        expect(area.readOnly).toBe(true)
        expect(area.getAttribute('aria-busy')).toBe('true')
        expect(area.getAttribute('dir')).toBe('auto')
        expect(area.dataset.part).toBe('studio-form-desc')
    })

    test('the label names the textarea', () => {
        const { area } = mountField(fixture('x'), { label: 'Description' })
        const id = area.getAttribute('aria-labelledby') as string
        expect(document.getElementById(id)?.textContent).toBe('Description')
    })

    test('focus records the focus value', () => {
        const { area } = mountField(fixture('d0'))
        area.focus()
        expect(area.dataset.studioFocusValue).toBe('d0')
    })

    test('a non-composing input writes through the port in the stored line-ending style', () => {
        const fix = fixture('a\r\nb')
        const { area } = mountField(fix)
        typeInto(area, 'a\nbX')
        expect(fix.writes).toEqual(['a\r\nbX'])
        expect(fix.results).toEqual([{ ok: true }])
    })

    test('a composing input is held and written at compositionend', () => {
        const fix = fixture('d0')
        const { area } = mountField(fix)
        area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        typeInto(area, 'd0ㅎ', true)
        typeInto(area, 'd0한', true)
        expect(fix.writes).toEqual([])
        area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        expect(fix.writes).toEqual(['d0한'])
    })

    test('focus and blur without input write nothing and close the step', () => {
        const fix = fixture('a\r\nb')
        const { area } = mountField(fix)
        area.focus()
        area.blur()
        expect(fix.writes).toEqual([])
        expect(fix.results).toEqual([])
        expect(fix.steps.count).toBe(1)
    })

    test('a registry flush writes held text', () => {
        const fix = fixture('d0')
        const { area } = mountField(fix)
        typeInto(area, 'd0한', true)
        flushStudioFields('hide')
        expect(fix.writes).toEqual(['d0한'])
    })

    test('after unmount nothing is written or closed, and the registry no longer reaches the field', async () => {
        const fix = fixture('d0')
        const { area } = mountField(fix)
        typeInto(area, 'd0한', true)
        for (const app of mounted.splice(0)) await unmount(app)
        flushStudioFields('leave')
        expect(fix.writes).toEqual([])
        expect(fix.steps.count).toBe(0)
    })

    test('insertText replaces the range through an input event and moves the caret', () => {
        const fix = fixture('hello world')
        const { area, exported } = mountField(fix)
        exported.insertText(6, 11, 'there', 11)
        expect(fix.writes).toEqual(['hello there'])
        expect(area.selectionStart).toBe(11)
        expect(area.dataset.studioFocusValue).toBe('hello there')
        expect(fix.steps.count).toBe(2)
    })

    test('insertText is ignored while read-only or composing', () => {
        const readonly = fixture('ab')
        mountField(readonly, { editable: false }).exported.insertText(0, 0, 'x', 1)
        expect(readonly.writes).toEqual([])
        const fix = fixture('ab')
        const { area, exported } = mountField(fix)
        area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        exported.insertText(0, 0, 'x', 1)
        expect(fix.writes).toEqual([])
    })
})

const overlayOf = (host: HTMLElement): HTMLElement => host.querySelector('[data-part="studio-lt-overlay"]') as HTMLElement
// The overlay draws the field text plus one trailing newline.
const overlayText = (host: HTMLElement): string => (overlayOf(host).textContent ?? '').slice(0, -1)
const namesIn = (host: HTMLElement): number => overlayOf(host).querySelectorAll('[data-kind="name"]').length
const updates = (): number => vi.mocked(tokenSpans).mock.calls.length
const compositionStartOn = (area: HTMLTextAreaElement): void => { area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })) }
const compositionEndOn = (area: HTMLTextAreaElement): void => { area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })) }

function advance(ms: number): void {
    vi.advanceTimersByTime(ms)
    flushSync()
}

// A clock that reads `durations[n]` ms for the n-th measured update (the update clock is read twice per update).
function clockOf(...durations: number[]): () => number {
    let calls = 0
    let now = 0
    return () => {
        calls += 1
        if (calls % 2 === 0) now += durations[calls / 2 - 1] ?? 0
        return now
    }
}

function finePointer(): void {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: fine)', media: query, addEventListener: () => {}, removeEventListener: () => {} }))
}

describe('B2 the overlay', () => {
    beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })

    test('B2-C1 it is aria-hidden and shows exactly the field text: at mount, after input, during composition and on a CRLF card', () => {
        const { area, host } = mountField(fixture('a\r\n<char>'))
        expect(overlayOf(host).getAttribute('aria-hidden')).toBe('true')
        expect(overlayText(host)).toBe('a\n<char>')
        expect(overlayText(host)).toBe(area.value)
        typeInto(area, 'a\n<char>X')
        flushSync()
        expect(overlayText(host)).toBe(area.value)
        compositionStartOn(area)
        typeInto(area, 'a\n<char>Xㅎ', true)
        flushSync()
        expect(overlayText(host)).toBe('a\n<char>Xㅎ')
        expect(overlayText(host)).toBe(area.value)
        expect(area.style.color).toBe('transparent')
    })

    test('B2-C1 spans follow 250 ms after the last change and never while composing', () => {
        const fix = fixture('{{char}} hi')
        const { area, host } = mountField(fix)
        expect(namesIn(host)).toBe(0)
        advance(249)
        expect(namesIn(host)).toBe(0)
        advance(1)
        expect(namesIn(host)).toBe(1)
        typeInto(area, '{{char}} hi{{user}}')
        flushSync()
        expect(namesIn(host)).toBe(1)
        advance(249)
        expect(namesIn(host)).toBe(1)
        advance(1)
        expect(namesIn(host)).toBe(2)
        const before = updates()
        compositionStartOn(area)
        typeInto(area, '{{char}} hi{{user}}{{bot}}', true)
        advance(2000)
        expect(updates()).toBe(before)
        expect(namesIn(host)).toBe(2)
        compositionEndOn(area)
        advance(250)
        expect(updates()).toBe(before + 1)
        expect(namesIn(host)).toBe(3)
    })

    // Notes are display state: the handler marks the first `AB` as a speaker note and a trailing `~tail` as unused.
    const notesOf = (text: string): Note[] => {
        const notes: Note[] = []
        const speaker = text.indexOf('AB')
        if (speaker >= 0) notes.push({ start: speaker, end: speaker + 2, note: 'speaker' })
        const tail = text.indexOf('~tail')
        if (tail >= 0) notes.push({ start: tail, end: text.length, note: 'notUsed' })
        return notes
    }
    const noteTexts = (host: HTMLElement, note: string): string[] => Array.from(overlayOf(host).querySelectorAll(`[data-note="${note}"]`)).map((el) => el.textContent ?? '')

    test('S5 extraMarks notes are drawn after the pause, shifted by an edit before it, and recomputed after it', () => {
        const fix = fixture('AB hi ~tail')
        const { area, host } = mountField(fix, { extraMarks: notesOf })
        expect(noteTexts(host, 'speaker')).toEqual([])
        advance(250)
        expect(noteTexts(host, 'speaker')).toEqual(['AB'])
        expect(noteTexts(host, 'notUsed')).toEqual(['~tail'])
        const speaker = overlayOf(host).querySelector('[data-note="speaker"]')
        expect(speaker?.classList.contains('underline')).toBe(true)
        for (const widening of ['font-bold', 'font-semibold', 'italic', 'tracking-wide', 'text-lg']) expect(speaker?.classList.contains(widening)).toBe(false)
        expect(overlayOf(host).querySelector('[data-note="notUsed"]')?.classList.contains('line-through')).toBe(true)
        typeInto(area, 'zz AB hi ~tail')
        flushSync()
        expect(overlayText(host)).toBe('zz AB hi ~tail')
        expect(noteTexts(host, 'speaker')).toEqual(['AB'])
        expect(noteTexts(host, 'notUsed')).toEqual(['~tail'])
        typeInto(area, 'zz ABxy hi ~tail')
        flushSync()
        expect(noteTexts(host, 'notUsed')).toEqual(['~tail'])
        advance(250)
        expect(noteTexts(host, 'speaker')).toEqual(['AB'])
        expect(noteTexts(host, 'notUsed')).toEqual(['~tail'])
    })

    test('S5 a field without extraMarks draws no notes and the overlay text is unchanged', () => {
        const { host } = mountField(fixture('AB hi ~tail'))
        advance(250)
        expect(overlayOf(host).querySelectorAll('[data-note]')).toHaveLength(0)
        expect(overlayText(host)).toBe('AB hi ~tail')
    })

    test('S5 a field the overlay does not colour (low power, not focused) never calls extraMarks', () => {
        setLowPower(true)
        const calls: string[] = []
        mountField(fixture('AB'), { extraMarks: (text) => { calls.push(text); return [] } })
        advance(1000)
        expect(calls).toEqual([])
    })

    test('S5 a plain-mode field never calls extraMarks', () => {
        const calls: string[] = []
        mountField(fixture('AB'), { mode: 'plain', extraMarks: (text) => { calls.push(text); return [] } })
        advance(1000)
        expect(calls).toEqual([])
    })

    test('B2-C1 above the window limit the overlay hides while typing and returns after the pause', () => {
        const long = 'x'.repeat(WINDOW_LIMIT + 1)
        const { area, host } = mountField(fixture(long))
        advance(250)
        expect(overlayOf(host).dataset.overlay).toBe('on')
        typeInto(area, `${long}y`)
        flushSync()
        expect(overlayOf(host).dataset.overlay).toBe('typing')
        expect(overlayOf(host).textContent).toBe('')
        expect(area.style.color).toBe('')
        advance(250)
        expect(overlayOf(host).dataset.overlay).toBe('on')
        expect(overlayText(host)).toBe(`${long}y`)
    })

    test('B2-C1 plain mode has no overlay and never colours', () => {
        const { host } = mountField(fixture('{{char}}'), { mode: 'plain' })
        advance(1000)
        expect(host.querySelector('[data-part="studio-lt-overlay"]')).toBeNull()
        expect(updates()).toBe(0)
    })

    test('B2-C2 two consecutive updates over 32 ms turn the overlay off with the note; a quick update in between does not', () => {
        setUpdateClockForTests(clockOf(40, 40))
        const { area, host } = mountField(fixture('{{char}}'))
        advance(250)
        expect(overlayOf(host).dataset.overlay).toBe('on')
        expect(host.querySelector('[data-part="studio-lt-hl-off"]')).toBeNull()
        typeInto(area, '{{char}}!')
        advance(250)
        expect(overlayOf(host).dataset.overlay).toBe('off')
        const note = host.querySelector('[data-part="studio-lt-hl-off"]') as HTMLElement
        expect(note.textContent).toBe(language.ltHlOff)
        expect(area.getAttribute('aria-describedby')).toBe(note.id)
        expect(area.style.color).toBe('')
        expect(note.getAttribute('aria-live')).toBeNull()
    })

    test('B2-C2 a 40 ms update then a 10 ms one keeps the overlay on', () => {
        setUpdateClockForTests(clockOf(40, 10, 40))
        const { area, host } = mountField(fixture('{{char}}'))
        advance(250)
        typeInto(area, '{{char}}!')
        advance(250)
        typeInto(area, '{{char}}!!')
        advance(250)
        expect(overlayOf(host).dataset.overlay).toBe('on')
        expect(host.querySelector('[data-part="studio-lt-hl-off"]')).toBeNull()
    })

    test('B2-C2 low power colours only the focused field', () => {
        setLowPower(true)
        const { area, host } = mountField(fixture('{{char}} hi'))
        advance(1000)
        expect(overlayOf(host).dataset.overlay).toBe('off')
        expect(namesIn(host)).toBe(0)
        area.focus()
        flushSync()
        expect(overlayOf(host).dataset.overlay).toBe('on')
        advance(250)
        expect(namesIn(host)).toBe(1)
        area.blur()
        flushSync()
        expect(overlayOf(host).dataset.overlay).toBe('off')
    })

    test('B2-C2 low power switches off a field above the window limit and says so', () => {
        setLowPower(true)
        const { area, host } = mountField(fixture('x'.repeat(WINDOW_LIMIT + 1)))
        area.focus()
        flushSync()
        advance(1000)
        expect(overlayOf(host).dataset.overlay).toBe('off')
        expect(host.querySelector('[data-part="studio-lt-hl-off"]')?.textContent).toBe(language.ltHlOff)
    })

    test('B2-C3 ArrowDown on the handle stores the cap for the field kind; another mount of that kind reads it and a greeting does not', () => {
        finePointer()
        const first = mountField(fixture('d0'))
        const handle = first.host.querySelector('[data-part="studio-lt-height-handle"]') as HTMLElement
        expect(handle.getAttribute('role')).toBe('separator')
        expect(handle.getAttribute('aria-label')).toBe(language.ltHeightHandle)
        const before = Number(handle.getAttribute('aria-valuenow'))
        handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
        flushSync()
        const stored = Number(localStorage.getItem('risuStudio.ltCap.desc'))
        expect(stored).toBeGreaterThan(before)
        expect(localStorage.getItem('risuStudio.ltCap.greeting')).toBeNull()
        expect(Number(handle.getAttribute('aria-valuenow'))).toBe(stored)
        const second = mountField(fixture('other'))
        expect(Number((second.host.querySelector('[data-part="studio-lt-height-handle"]') as HTMLElement).getAttribute('aria-valuenow'))).toBe(stored)
        const greeting = mountField(fixture('g0'), { kind: 'greeting', mode: 'html+cbs' })
        expect(Number((greeting.host.querySelector('[data-part="studio-lt-height-handle"]') as HTMLElement).getAttribute('aria-valuenow'))).toBe(before)
        expect(first.area.value).toBe('d0')
    })

    test('B2-C3 ArrowUp lowers the cap, and the handle is absent without a fine pointer', () => {
        const none = mountField(fixture('d0'))
        expect(none.host.querySelector('[data-part="studio-lt-height-handle"]')).toBeNull()
        finePointer()
        const { host } = mountField(fixture('d0'))
        const handle = host.querySelector('[data-part="studio-lt-height-handle"]') as HTMLElement
        const before = Number(handle.getAttribute('aria-valuenow'))
        handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
        flushSync()
        expect(Number(localStorage.getItem('risuStudio.ltCap.desc'))).toBeLessThan(before)
    })

    test('B2-C4 a composition that ends by blur recolours 250 ms later, as does compositionstart then a non-composing input', () => {
        const { area } = mountField(fixture('d0'))
        advance(250)
        vi.mocked(tokenSpans).mockClear()
        area.focus()
        compositionStartOn(area)
        typeInto(area, 'd0ㅎ', true)
        advance(1000)
        expect(updates()).toBe(0)
        area.blur()
        advance(249)
        expect(updates()).toBe(0)
        advance(1)
        expect(updates()).toBe(1)
        compositionStartOn(area)
        advance(1000)
        typeInto(area, 'd0ㅎx')
        advance(249)
        expect(updates()).toBe(1)
        advance(1)
        expect(updates()).toBe(2)
    })

    test('B2-x42 B2-x43 a mark is drawn by its severity, and the overlay never takes pointer events', async () => {
        const { host } = mountField(fixture('{{nope}} <char> {{#if x}}'))
        await advanceTokens(250)
        const markClass = (severity: string): string => (overlayOf(host).querySelector(`[data-severity="${severity}"]`) as HTMLElement).className
        expect(markClass('error')).toContain('decoration-wavy')
        expect(markClass('error')).toContain('decoration-draculared')
        expect(markClass('info')).toContain('decoration-dotted')
        expect(markClass('info')).not.toContain('decoration-wavy')
        expect(overlayOf(host).classList.contains('pointer-events-none')).toBe(true)
    })

    test('B2-x45 B2-x71 the overlay mirrors the textarea scroll position', () => {
        const { area, host } = mountField(fixture('a\nb\nc'))
        Object.defineProperty(area, 'scrollTop', { value: 120, configurable: true, writable: true })
        area.dispatchEvent(new Event('scroll'))
        flushSync()
        expect(overlayOf(host).scrollTop).toBe(120)
    })

    test('B2-x70 a scroll of a long text recolours it after the pause', () => {
        const { area } = mountField(fixture('x'.repeat(WINDOW_LIMIT + 1)))
        advance(250)
        vi.mocked(tokenSpans).mockClear()
        area.dispatchEvent(new Event('scroll'))
        advance(249)
        expect(updates()).toBe(0)
        advance(1)
        expect(updates()).toBe(1)
    })

    test('B2-x52 a long text hides the overlay while typing, and a short text shows it again at once', () => {
        const long = 'x'.repeat(WINDOW_LIMIT + 1)
        const { area, host } = mountField(fixture(long))
        advance(250)
        typeInto(area, `${long}y`)
        flushSync()
        expect(overlayOf(host).dataset.overlay).toBe('typing')
        typeInto(area, 'short')
        flushSync()
        expect(overlayOf(host).dataset.overlay).toBe('on')
    })

    test('B2-x59 low power runs no colouring for an unfocused field', () => {
        setLowPower(true)
        mountField(fixture('{{char}} hi'))
        advance(1000)
        expect(updates()).toBe(0)
    })

    test('B2-x69 a field whose overlay is off shows its own text, with no overlay caret colour', () => {
        setUpdateClockForTests(clockOf(40, 40))
        const { area, host } = mountField(fixture('{{char}}'))
        advance(250)
        expect(area.classList.contains('caret-textcolor')).toBe(true)
        typeInto(area, '{{char}}!')
        advance(250)
        expect(overlayOf(host).dataset.overlay).toBe('off')
        expect(area.classList.contains('caret-textcolor')).toBe(false)
        expect(area.style.color).toBe('')
    })

    test('M14b spans follow an edit before the pause: a character typed before a macro leaves its name span on the name', () => {
        const { area, host } = mountField(fixture('{{user}} x'))
        advance(250)
        typeInto(area, 'a{{user}} x')
        flushSync()
        const names = Array.from(overlayOf(host).querySelectorAll('[data-kind="name"]')).map((span) => span.textContent)
        expect(names).toEqual(['user'])
    })

    test('M52a2 the overlay colours the text the field shows, not the stored CRLF text', () => {
        const { host } = mountField(fixture('a\r\n{{user}}'))
        advance(250)
        const names = Array.from(overlayOf(host).querySelectorAll('[data-kind="name"]')).map((span) => span.textContent)
        expect(names).toEqual(['user'])
    })

    describe('the height cap', () => {
        const handleOf = (host: HTMLElement): HTMLElement => host.querySelector('[data-part="studio-lt-height-handle"]') as HTMLElement
        const capOf = (host: HTMLElement): number => Number(handleOf(host).getAttribute('aria-valuenow'))

        test('M19c the keyboard cap is stored under the field kind', () => {
            finePointer()
            const { host } = mountField(fixture('g0'), { kind: 'greeting', mode: 'html+cbs' })
            handleOf(host).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
            flushSync()
            expect(localStorage.getItem('risuStudio.ltCap.greeting')).not.toBeNull()
            expect(localStorage.getItem('risuStudio.ltCap.desc')).toBeNull()
        })

        test('M19d B2-x79 B2-x82 a drag follows the pointer, is stored only when released, and under the field kind', () => {
            finePointer()
            const { host } = mountField(fixture('g0'), { kind: 'greeting', mode: 'html+cbs' })
            const handle = handleOf(host)
            const start = capOf(host)
            handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 100, pointerId: 1 }))
            handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: 140, pointerId: 1 }))
            flushSync()
            expect(capOf(host)).toBe(start + 40)
            expect(localStorage.getItem('risuStudio.ltCap.greeting')).toBeNull()
            handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
            expect(localStorage.getItem('risuStudio.ltCap.greeting')).toBe(String(start + 40))
            expect(localStorage.getItem('risuStudio.ltCap.desc')).toBeNull()
        })

        test('B2-x75 the default cap is 60% of the window in the stacked layout and 70% in the wide one', () => {
            finePointer()
            vi.stubGlobal('innerHeight', 1000)
            try {
                studioScreen.layout = 'stack'
                expect(capOf(mountField(fixture('d0')).host)).toBe(600)
                studioScreen.layout = 'wide'
                expect(capOf(mountField(fixture('d0')).host)).toBe(700)
            } finally {
                studioScreen.layout = 'wide'
            }
        })

        test('B2-x76 B2-x77 B2-x84 the field grows with its text between three lines and the cap, and shrinks back', () => {
            localStorage.setItem('risuStudio.ltCap.desc', '300')
            const { area } = mountField(fixture('d0'))
            let content = 5000
            // A textarea never reports a content height below its own box height; `auto` lets it measure the content.
            Object.defineProperty(area, 'scrollHeight', { configurable: true, get: () => (area.style.height === 'auto' ? content : Math.max(content, parseFloat(area.style.height) || 0)) })
            window.dispatchEvent(new Event('resize'))
            expect(area.style.height).toBe('300px')
            content = 10
            window.dispatchEvent(new Event('resize'))
            expect(area.style.height).toBe('60px')
        })

        test('B2-x78 a cap is never lowered below its minimum', () => {
            finePointer()
            localStorage.setItem('risuStudio.ltCap.desc', '80')
            const { host } = mountField(fixture('d0'))
            expect(capOf(host)).toBe(80)
            handleOf(host).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
            flushSync()
            expect(capOf(host)).toBe(72)
        })
    })

    test('B2-C5 nothing runs after unmount', async () => {
        const { area } = mountField(fixture('d0'))
        typeInto(area, 'd0{{char}}')
        for (const app of mounted.splice(0)) await unmount(app)
        advance(2000)
        expect(updates()).toBe(0)
    })

    test('R6-4 after a normal input one recolouring runs, and the owner write the input caused adds none', () => {
        const { area } = mountField(fixture('d0'))
        advance(250)
        vi.mocked(tokenSpans).mockClear()
        typeInto(area, 'd0{{char}}')
        flushSync()
        advance(250)
        expect(updates()).toBe(1)
        advance(2000)
        expect(updates()).toBe(1)
    })
})

const chipOf = (host: HTMLElement): HTMLButtonElement => host.querySelector('[data-part="studio-lt-tokens"]') as HTMLButtonElement
const infoOf = (host: HTMLElement): HTMLButtonElement => host.querySelector('[data-part="studio-lt-tokens-info"]') as HTMLButtonElement
const panelOf = (host: HTMLElement): HTMLElement => host.querySelector('[data-part="studio-lt-tokens-panel"]') as HTMLElement
const blurOn = (area: HTMLTextAreaElement): void => { area.dispatchEvent(new FocusEvent('blur')) }

// Lets the counter's promise chain and the render that follows it run.
async function settleTokens(): Promise<void> {
    for (let turn = 0; turn < 6; turn += 1) await Promise.resolve()
    flushSync()
}

async function advanceTokens(ms: number): Promise<void> {
    advance(ms)
    await settleTokens()
}

// An IntersectionObserver whose reports the test controls, keyed by the margin each observer was made with.
class ControlledObserver {
    static all: ControlledObserver[] = []
    targets: Element[] = []
    constructor(private readonly callback: (records: { target: Element, isIntersecting: boolean }[]) => void, readonly options: { rootMargin?: string }) {
        ControlledObserver.all.push(this)
    }
    observe(node: Element): void { this.targets.push(node) }
    unobserve(): void {}
    disconnect(): void {}
    report(isIntersecting: boolean): void {
        this.callback(this.targets.map((target) => ({ target, isIntersecting })))
    }
}

describe('E1 the token chip', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        ControlledObserver.all = []
    })

    test('E1-C1 a count is asked 500 ms after mount and again only when the text changes; the chip shows it', async () => {
        const { area, host } = mountField(fixture('abcde'))
        await advanceTokens(499)
        expect(tokenRequests).toEqual([])
        await advanceTokens(1)
        expect(tokenRequests).toEqual([{ key: expect.any(String), text: 'abcde' }])
        expect(chipOf(host).textContent).toBe('ltTokens(5,M)')
        await advanceTokens(2000)
        expect(tokenRequests.length).toBe(1)
        typeInto(area, 'abcdef')
        flushSync()
        await advanceTokens(499)
        expect(tokenRequests.length).toBe(1)
        await advanceTokens(1)
        expect(tokenRequests.map((request) => request.text)).toEqual(['abcde', 'abcdef'])
        expect(chipOf(host).textContent).toBe('ltTokens(6,M)')
    })

    test('E1-C1 the text counted is the text the textarea shows, on a CRLF card too', async () => {
        mountField(fixture('a\r\nb'))
        await advanceTokens(500)
        expect(tokenRequests.map((request) => request.text)).toEqual(['a\nb'])
    })

    test('E1-C1 no request while composing; one after compositionend and the pause', async () => {
        const { area } = mountField(fixture('d0'))
        await advanceTokens(500)
        tokenRequests.length = 0
        compositionStartOn(area)
        typeInto(area, 'd0ㅎ', true)
        await advanceTokens(3000)
        expect(tokenRequests).toEqual([])
        compositionEndOn(area)
        await advanceTokens(499)
        expect(tokenRequests).toEqual([])
        await advanceTokens(1)
        expect(tokenRequests.map((request) => request.text)).toEqual(['d0ㅎ'])
    })

    test('E1-C1 a composition ended by blur, with no compositionend, is counted after the pause', async () => {
        const { area } = mountField(fixture('d0'))
        await advanceTokens(500)
        tokenRequests.length = 0
        compositionStartOn(area)
        typeInto(area, 'd0ㅎ', true)
        blurOn(area)
        await advanceTokens(499)
        expect(tokenRequests).toEqual([])
        await advanceTokens(1)
        expect(tokenRequests.map((request) => request.text)).toEqual(['d0ㅎ'])
    })

    test('E1-C1 a superseded answer (null) shows no chip and adds no description', async () => {
        tokenAnswer = async () => null
        const { area, host } = mountField(fixture('d0'))
        await advanceTokens(500)
        expect(tokenRequests.length).toBe(1)
        expect(chipOf(host).textContent).toBe('…')
        expect(area.getAttribute('aria-describedby')).toBeNull()
    })

    test('E1-x36 a superseded answer (null) never reaches the chip view', async () => {
        tokenAnswer = async () => null
        mountField(fixture('d0'))
        await advanceTokens(500)
        expect(tokenRequests.length).toBe(1)
        expect(vi.mocked(tokenChipView)).not.toHaveBeenCalled()
    })

    test('M20 a tap on the chip while composing asks for nothing', async () => {
        const { area, host } = mountField(fixture('abc'))
        await advanceTokens(500)
        tokenRequests.length = 0
        compositionStartOn(area)
        chipOf(host).click()
        await settleTokens()
        expect(tokenRequests).toEqual([])
    })

    test('E1-x34 E1-x35 a field that is already counted is not asked again when it is focused, blurred and focused again', async () => {
        const { area } = mountField(fixture('abc'))
        area.focus()
        flushSync()
        await advanceTokens(500)
        expect(tokenRequests.length).toBe(1)
        area.blur()
        flushSync()
        area.focus()
        flushSync()
        await advanceTokens(500)
        expect(tokenRequests.length).toBe(1)
    })

    test('E1-C1 in low power nothing is asked on the pause; one count on blur and one on a tap of the chip', async () => {
        setLowPower(true)
        const { area, host } = mountField(fixture('abc'))
        await advanceTokens(3000)
        expect(tokenRequests).toEqual([])
        blurOn(area)
        await settleTokens()
        expect(tokenRequests.length).toBe(1)
        chipOf(host).click()
        await settleTokens()
        expect(tokenRequests.length).toBe(2)
        expect(chipOf(host).textContent).toBe('ltTokens(3,M)')
    })

    test('E1-C1 after unmount nothing is asked, and a late answer is not an error', async () => {
        const { area } = mountField(fixture('d0'))
        typeInto(area, 'd0x')
        for (const app of mounted.splice(0)) await unmount(app)
        await advanceTokens(2000)
        expect(tokenRequests).toEqual([])
        let release: (result: TokenResult) => void = () => {}
        tokenAnswer = () => new Promise<TokenResult>((resolve) => { release = resolve })
        mountField(fixture('d0'))
        await advanceTokens(500)
        expect(tokenRequests.length).toBe(1)
        for (const app of mounted.splice(0)) await unmount(app)
        release({ kind: 'app-count', count: 2, tokenizer: 'o200k_base', model: 'M' })
        await settleTokens()
    })

    test('E1-C2 the disclosure is a button controlling a group; the chip joins the description; no mark is drawn', async () => {
        const { area, host } = mountField(fixture('abc'))
        expect(area.getAttribute('aria-describedby')).toBeNull()
        await advanceTokens(500)
        expect(area.getAttribute('aria-describedby')).toBe(chipOf(host).id)
        expect(infoOf(host).getAttribute('aria-expanded')).toBe('false')
        expect(infoOf(host).getAttribute('aria-controls')).toBe(panelOf(host).id)
        expect(panelOf(host).getAttribute('role')).toBe('group')
        expect(panelOf(host).hidden).toBe(true)
        infoOf(host).click()
        flushSync()
        expect(infoOf(host).getAttribute('aria-expanded')).toBe('true')
        expect(panelOf(host).hidden).toBe(false)
        // The note about the text counted as written is on an exact count too.
        expect(panelOf(host).textContent).toContain('ltTokNoteRaw')
        expect(host.querySelectorAll('[data-severity]').length).toBe(0)
    })

    test('E1-C2 an estimate is labelled as one, never with the exact key, and its panel gives the reason', async () => {
        tokenAnswer = async () => ({ kind: 'estimate', count: 5, model: 'M', reason: 'online-only' })
        const { host } = mountField(fixture('abcde'))
        await advanceTokens(500)
        expect(chipOf(host).textContent).toBe('ltTokensEst(5)')
        expect(chipOf(host).textContent).not.toContain('ltTokens(')
        expect(chipOf(host).dataset.estimate).toBe('true')
        expect(panelOf(host).textContent).toContain('ltTokEstOnline(M)')
        expect(panelOf(host).textContent).toContain('ltTokNoteRaw')
    })

    test('E1-C2 a field with no label still has its chip, and the header does not name the textarea', async () => {
        const { area, host } = mountField(fixture('abc'), { kind: 'greeting', mode: 'html+cbs' })
        await advanceTokens(500)
        expect(chipOf(host).textContent).toBe('ltTokens(3,M)')
        expect(area.getAttribute('aria-labelledby')).toBeNull()
    })

    test('E1-C3 a field far from the viewport and unfocused is not counted; near it is counted; far again, edits are not counted', async () => {
        vi.stubGlobal('IntersectionObserver', ControlledObserver)
        const { area } = mountField(fixture('abc'))
        await advanceTokens(3000)
        expect(tokenRequests).toEqual([])
        const near = ControlledObserver.all.find((observer) => observer.options.rootMargin === '100% 0px')
        const far = ControlledObserver.all.find((observer) => observer.options.rootMargin === '300% 0px')
        near?.report(true)
        flushSync()
        await advanceTokens(499)
        expect(tokenRequests).toEqual([])
        await advanceTokens(1)
        expect(tokenRequests.map((request) => request.text)).toEqual(['abc'])
        far?.report(false)
        flushSync()
        typeInto(area, 'abcd')
        await advanceTokens(3000)
        expect(tokenRequests.length).toBe(1)
    })

    test('E1-C3 a focused field far from the viewport is counted; with no IntersectionObserver the field counts', async () => {
        vi.stubGlobal('IntersectionObserver', ControlledObserver)
        const { area } = mountField(fixture('abc'))
        area.dispatchEvent(new FocusEvent('focus'))
        flushSync()
        await advanceTokens(500)
        expect(tokenRequests.length).toBe(1)
        vi.unstubAllGlobals()
        tokenRequests.length = 0
        mountField(fixture('xyz'))
        await advanceTokens(500)
        expect(tokenRequests.map((request) => request.text)).toEqual(['xyz'])
    })
})

const rowsOf = (host: HTMLElement): HTMLElement[] => Array.from(host.querySelectorAll<HTMLElement>('[data-part="studio-lt-problem-row"]'))
const rowPart = (row: HTMLElement, part: string): HTMLElement => row.querySelector(`[data-part="${part}"]`) as HTMLElement
const marksIn = (host: HTMLElement, severity: string): number => overlayOf(host).querySelectorAll(`[data-severity="${severity}"]`).length
const checks = (): number => vi.mocked(checkCbs).mock.calls.length

describe('C1 problems per field', () => {
    beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })

    test('C1-C1 an unclosed block is one error row with its line; the jump selects its text; the count is described', async () => {
        const { area, host } = mountField(fixture('a\n{{#if x}}b'))
        await advanceTokens(249)
        expect(rowsOf(host)).toHaveLength(0)
        await advanceTokens(1)
        const rows = rowsOf(host)
        expect(rows).toHaveLength(1)
        expect(rows[0].dataset.severity).toBe('error')
        expect(rowPart(rows[0], 'studio-lt-problem-line').textContent).toBe('ltProblemLine(2)')
        expect(rowPart(rows[0], 'studio-lt-problem-message').textContent).toBe('cbsUnclosed(#if x)')
        const count = host.querySelector('[data-part="studio-lt-problem-count"]') as HTMLElement
        expect(count.textContent).toBe('ltProblemCount(1)')
        expect(area.getAttribute('aria-describedby')?.split(' ')).toContain(count.id)
        rowPart(rows[0], 'studio-lt-problem-jump').click()
        expect(area.selectionStart).toBe(2)
        expect(area.selectionEnd).toBeGreaterThan(2)
        expect(document.activeElement).toBe(area)
        expect(marksIn(host, 'error')).toBeGreaterThan(0)
    })

    test('C1-C3 no check runs while composing; one runs after compositionend and the pause', async () => {
        const { area } = mountField(fixture('d0'))
        await advanceTokens(250)
        const before = checks()
        compositionStartOn(area)
        typeInto(area, '{{#if xㅎ', true)
        await advanceTokens(3000)
        expect(checks()).toBe(before)
        compositionEndOn(area)
        await advanceTokens(249)
        expect(checks()).toBe(before)
        await advanceTokens(1)
        expect(checks()).toBe(before + 1)
    })

    test('C1-C3 a stray close is unlisted in a greeting and listed as info in a description', async () => {
        const greeting = mountField(fixture('a}}b'), { kind: 'greeting', mode: 'html+cbs' })
        const description = mountField(fixture('a}}b'))
        await advanceTokens(250)
        expect(rowsOf(greeting.host)).toHaveLength(0)
        const rows = rowsOf(description.host)
        expect(rows.map((row) => row.dataset.severity)).toEqual(['info'])
        expect(rows[0].dataset.kind).toBe('stray-macro-close')
    })

    test('C1-C3 plain mode is not checked', async () => {
        const { host } = mountField(fixture('{{#if x}}'), { mode: 'plain' })
        await advanceTokens(2000)
        expect(checks()).toBe(0)
        expect(rowsOf(host)).toHaveLength(0)
    })

    test('C1-C6 each row names its severity in words, and its icon is aria-hidden', async () => {
        const { host } = mountField(fixture('{{nope}} <char> {{#if x}}'))
        await advanceTokens(250)
        const rows = rowsOf(host)
        expect(rows.map((row) => row.dataset.severity).sort()).toEqual(['error', 'info', 'warning'])
        const words: Record<string, string> = { error: language.ltSeverityError, warning: language.ltSeverityWarning, info: language.ltSeverityInfo }
        for (const row of rows) {
            expect(rowPart(row, 'studio-lt-problem-severity').textContent).toBe(words[row.dataset.severity as string])
            expect(rowPart(row, 'studio-lt-problem-icon').getAttribute('aria-hidden')).toBe('true')
        }
    })

    test('C1-x18 each severity has its own icon', async () => {
        const { host } = mountField(fixture('{{nope}} <char> {{#if x}}'))
        await advanceTokens(250)
        const iconOf = (severity: string): string => {
            const row = rowsOf(host).find((candidate) => candidate.dataset.severity === severity) as HTMLElement
            return Array.from(rowPart(row, 'studio-lt-problem-icon').children).map((shape) => `${shape.tagName}:${shape.getAttribute('d') ?? shape.getAttribute('r')}`).join('|')
        }
        expect(new Set([iconOf('error'), iconOf('warning'), iconOf('info')]).size).toBe(3)
    })

    test('C1-x19 rows are keyed: an edit that moves the problems replaces their row elements', async () => {
        const { area, host } = mountField(fixture('<char> <user>'))
        await advanceTokens(250)
        const before = rowsOf(host)
        expect(before).toHaveLength(2)
        typeInto(area, 'X<char> <user>')
        flushSync()
        const after = rowsOf(host)
        expect(after).toHaveLength(2)
        for (const row of before) expect(row.isConnected).toBe(false)
    })

    test('C1-C6 only the first 20 rows show until the rest is asked for', async () => {
        const { host } = mountField(fixture('<char>'.repeat(25)))
        await advanceTokens(250)
        expect(rowsOf(host)).toHaveLength(20)
        const all = host.querySelector('[data-part="studio-lt-problems-all"]') as HTMLButtonElement
        expect(all.textContent).toBe('ltProblemsShowAll(25)')
        all.click()
        flushSync()
        expect(rowsOf(host)).toHaveLength(25)
    })

    test('C1-U3 marks and rows follow an edit before the pause: a later edit moves them, an edit inside drops them', async () => {
        const fix = fixture('ab {{#if x}}')
        const { area, host } = mountField(fix)
        await advanceTokens(250)
        expect(rowsOf(host)).toHaveLength(1)
        const checksBefore = checks()
        typeInto(area, 'Xab {{#if x}}')
        flushSync()
        expect(rowsOf(host)).toHaveLength(1)
        expect(marksIn(host, 'error')).toBeGreaterThan(0)
        typeInto(area, 'Xab {{#iXf x}}')
        flushSync()
        expect(rowsOf(host)).toHaveLength(0)
        expect(marksIn(host, 'error')).toBe(0)
        expect(checks()).toBe(checksBefore)
        await advanceTokens(250)
        expect(checks()).toBe(checksBefore + 1)
        expect(rowsOf(host)).toHaveLength(1)
    })

    test('C1-C7 read-only: Fix is disabled and a click inserts nothing and checks nothing', async () => {
        const fix = fixture('<char>')
        const { host } = mountField(fix, { editable: false })
        await advanceTokens(250)
        const button = rowPart(rowsOf(host)[0], 'studio-lt-problem-fix') as HTMLButtonElement
        expect(button.disabled).toBe(true)
        const before = checks()
        button.click()
        await advanceTokens(0)
        expect(fix.writes).toEqual([])
        expect(checks()).toBe(before)
        expect(rowPart(rowsOf(host)[0], 'studio-lt-problem-jump')).not.toBeNull()
    })

    test('C1-C4 the fix replaces its own range as one input and keeps the CRLF style of the card', async () => {
        const fix = fixture('a\r\n<char>')
        const { area, host } = mountField(fix)
        await advanceTokens(250)
        const row = rowsOf(host)[0]
        expect(rowPart(row, 'studio-lt-problem-line').textContent).toBe('ltProblemLine(2)')
        expect(rowPart(row, 'studio-lt-problem-fix').textContent).toBe('ltProblemFix({{char}})')
        rowPart(row, 'studio-lt-problem-fix').click()
        expect(fix.writes).toEqual(['a\r\n{{char}}'])
        expect(area.value).toBe('a\n{{char}}')
        expect(area.selectionStart).toBe('a\n{{char}}'.length)
        expect(fix.steps.count).toBe(2)
    })

    test('C1-C5 a fix tapped after the text changed inserts nothing and checks again; the next tap applies', async () => {
        const fix = fixture('<char>')
        const { area, host } = mountField(fix)
        await advanceTokens(250)
        typeInto(area, '<char>x')
        flushSync()
        expect(fix.writes).toEqual(['<char>x'])
        const stepsBefore = fix.steps.count
        const checksBefore = checks()
        rowPart(rowsOf(host)[0], 'studio-lt-problem-fix').click()
        expect(fix.writes).toEqual(['<char>x'])
        expect(fix.steps.count).toBe(stepsBefore)
        expect(checks()).toBe(checksBefore)
        await advanceTokens(0)
        expect(checks()).toBe(checksBefore + 1)
        expect(area.value).toBe('<char>x')
        rowPart(rowsOf(host)[0], 'studio-lt-problem-fix').click()
        expect(fix.writes).toEqual(['<char>x', '{{char}}x'])
    })

    test('C1-C5 a fix tapped while composing inserts nothing', async () => {
        const fix = fixture('<char>')
        const { area, host } = mountField(fix)
        await advanceTokens(250)
        compositionStartOn(area)
        typeInto(area, '<char>ㅎ', true)
        flushSync()
        rowPart(rowsOf(host)[0], 'studio-lt-problem-fix').click()
        expect(fix.writes).toEqual([])
        expect(area.value).toBe('<char>ㅎ')
    })

    test('M25 a fix tapped while composing asks for no new check', async () => {
        const fix = fixture('<char>')
        const { area, host } = mountField(fix)
        await advanceTokens(250)
        compositionStartOn(area)
        typeInto(area, '<char>ㅎ', true)
        flushSync()
        const before = checks()
        rowPart(rowsOf(host)[0], 'studio-lt-problem-fix').click()
        await settleTokens()
        expect(checks()).toBe(before)
        expect(fix.writes).toEqual([])
    })

    function deferredIndex(): { promise: Promise<MacroIndex>, resolve: (index: MacroIndex) => void } {
        let resolve: (index: MacroIndex) => void = () => {}
        const promise = new Promise<MacroIndex>((done) => { resolve = done })
        return { promise, resolve }
    }

    test('C1-x21 a check result for text that has changed since the check began is dropped', async () => {
        const { area, host } = mountField(fixture('d0'))
        await advanceTokens(250)
        typeInto(area, '<char>')
        flushSync()
        const held = deferredIndex()
        vi.mocked(loadMacroIndex).mockImplementationOnce(() => held.promise)
        await advanceTokens(250)
        typeInto(area, '<char>x')
        flushSync()
        held.resolve(createMacroIndex(['char'].map(macroEntry)))
        await settleTokens()
        expect(rowsOf(host)).toHaveLength(0)
        expect(marksIn(host, 'info')).toBe(0)
    })

    test('C1-x22 when two checks of one text are waiting, the older answer is dropped even if it arrives last', async () => {
        const { area, host } = mountField(fixture('<char>{{char}}'))
        await advanceTokens(250)
        expect(rowsOf(host).map((row) => row.dataset.kind)).toEqual(['deprecated'])
        typeInto(area, '<char>{{char}}x')
        flushSync()
        const older = deferredIndex()
        const newer = deferredIndex()
        vi.mocked(loadMacroIndex).mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise)
        const fixButton = (): HTMLElement => rowPart(rowsOf(host)[0], 'studio-lt-problem-fix')
        fixButton().click()
        fixButton().click()
        newer.resolve(createMacroIndex(['char'].map(macroEntry)))
        await settleTokens()
        older.resolve(createMacroIndex([]))
        await settleTokens()
        expect(rowsOf(host).map((row) => row.dataset.kind)).toEqual(['deprecated'])
    })

    test('C1-x24 a check of a focused field is told where the caret is, so a macro still being typed is not reported', async () => {
        const { area, host } = mountField(fixture(''))
        area.focus()
        typeInto(area, '{{ch')
        area.setSelectionRange(4, 4)
        flushSync()
        await advanceTokens(250)
        expect(vi.mocked(checkCbs).mock.calls.at(-1)?.[2]?.typingAt).toBe(4)
        expect(rowsOf(host)).toHaveLength(0)
    })

    test('C1-x25 a problem with no width is listed but draws no mark', async () => {
        vi.mocked(checkCbs).mockImplementationOnce(() => ({ problems: [{ kind: 'unknown-macro', severity: 'warning', start: 2, end: 2, line: 1 }], valueDependent: false, judgedUntil: 4 }))
        const { host } = mountField(fixture('abcd'))
        await advanceTokens(250)
        expect(rowsOf(host)).toHaveLength(1)
        expect(marksIn(host, 'warning')).toBe(0)
        // A mark with no width would still cut the text at its offset; the overlay stays one piece.
        const pieces = Array.from(overlayOf(host).querySelectorAll('span:not([data-sentinel])')).map((span) => span.textContent)
        expect(pieces).toEqual(['abcd'])
    })

    test('C1 nothing is checked or rendered after the field is gone', async () => {
        const { area } = mountField(fixture('d0'))
        typeInto(area, '<char>')
        flushSync()
        for (const app of mounted.splice(0)) await unmount(app)
        await advanceTokens(2000)
        expect(checks()).toBe(0)
    })
})

const pickerOf = (host: HTMLElement): HTMLElement | null => host.querySelector('[data-part="studio-lt-picker"]')
const optionsOf = (host: HTMLElement): HTMLElement[] => Array.from(host.querySelectorAll<HTMLElement>('[data-part="studio-lt-picker-option"]'))
const optionNames = (host: HTMLElement): (string | null | undefined)[] => optionsOf(host).map((option) => option.querySelector('[data-part="studio-lt-picker-name"]')?.textContent)
const sheetOf = (host: HTMLElement): HTMLElement | null => host.querySelector('[role="dialog"]')
const sheetOptions = (host: HTMLElement): HTMLElement[] => Array.from(host.querySelectorAll<HTMLElement>('[data-part="studio-lt-sheet-option"]'))

function inputAs(area: HTMLTextAreaElement, value: string, inputType: string): void {
    area.value = value
    area.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, isComposing: inputType === 'insertCompositionText' }))
}

// Types `value` and lets the macro index load and the picker render.
async function typeOpen(area: HTMLTextAreaElement, value: string, composing = false): Promise<void> {
    typeInto(area, value, composing)
    flushSync()
    await settleTokens()
}

function keyOn(target: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    flushSync()
    return event
}

const optionByName = (options: HTMLElement[], name: string): HTMLElement => options.find((option) => option.textContent?.startsWith(`${name} `)) as HTMLElement

describe('C2 the macro picker', () => {
    beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })
    afterEach(() => {
        studioScreen.layout = 'wide'
        document.body.querySelectorAll('[data-test-outside]').forEach((element) => element.remove())
    })

    test('C2-C1 typing {{ opens it with every row; a paste, a deletion, the field\'s own insert and a caret move do not', async () => {
        const { area, host, exported } = mountField(fixture(''))
        area.focus()
        await typeOpen(area, '{{')
        expect(optionsOf(host)).toHaveLength(66)
        expect(pickerOf(host)?.querySelector('[role="listbox"]')).not.toBeNull()
        area.blur()
        flushSync()
        expect(pickerOf(host)).toBeNull()
        for (const inputType of ['insertFromPaste', 'insertFromDrop', 'deleteContentBackward']) {
            inputAs(area, '{{', inputType)
            flushSync()
            await settleTokens()
            expect(pickerOf(host), inputType).toBeNull()
        }
        exported.insertText(0, 2, '{{', 2)
        flushSync()
        await settleTokens()
        expect(pickerOf(host)).toBeNull()
    })

    test('C2-C1 a caret moved into an existing {{char}} opens nothing', async () => {
        const { area, host } = mountField(fixture('{{char}}'))
        area.focus()
        area.setSelectionRange(4, 4)
        area.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }))
        flushSync()
        await settleTokens()
        expect(pickerOf(host)).toBeNull()
    })

    test('C2-C1 it follows the name typed, ranks name prefixes first and closes when the {{ is left behind', async () => {
        const { area, host } = mountField(fixture(''))
        area.focus()
        await typeOpen(area, '{{ge')
        expect(optionNames(host).slice(0, 2)).toEqual(['getvar', 'getglobalvar'])
        await typeOpen(area, '{{ge}}')
        expect(pickerOf(host)).toBeNull()
    })

    test('C2-C1 a read-only field never opens it', async () => {
        const { area, host } = mountField(fixture(''), { editable: false })
        await typeOpen(area, '{{')
        expect(pickerOf(host)).toBeNull()
    })

    test('C2-C2 Enter after {{ is a newline and closes the list; after a name it inserts the first match as one input', async () => {
        const fix = fixture('')
        const { area, host } = mountField(fix)
        area.focus()
        await typeOpen(area, '{{')
        expect(keyOn(area, 'Enter').defaultPrevented).toBe(false)
        expect(pickerOf(host)).toBeNull()
        await typeOpen(area, '{{g')
        const stepsBefore = fix.steps.count
        const writesBefore = fix.writes.length
        expect(keyOn(area, 'Enter').defaultPrevented).toBe(true)
        expect(fix.writes.slice(writesBefore)).toEqual(['{{getvar::}}'])
        expect(area.value).toBe('{{getvar::}}')
        expect(area.selectionStart).toBe(10)
        expect(fix.steps.count).toBe(stepsBefore + 2)
        expect(area.dataset.studioFocusValue).toBe(area.value)
        expect(pickerOf(host)).toBeNull()
        expect(document.activeElement).toBe(area)
    })

    test('C2-C2 arrows move the choice and name it for assistive technology; Enter and Tab take it, Tab alone does not', async () => {
        const fix = fixture('')
        const { area, host } = mountField(fix)
        area.focus()
        await typeOpen(area, '{{')
        expect(keyOn(area, 'Tab').defaultPrevented).toBe(false)
        expect(pickerOf(host)).toBeNull()
        await typeOpen(area, '{{')
        expect(keyOn(area, 'ArrowDown').defaultPrevented).toBe(true)
        expect(keyOn(area, 'ArrowDown').defaultPrevented).toBe(true)
        const active = area.getAttribute('aria-activedescendant') as string
        expect(document.getElementById(active)).toBe(optionsOf(host)[1])
        expect(optionsOf(host)[1].getAttribute('aria-selected')).toBe('true')
        expect(keyOn(area, 'ArrowUp').defaultPrevented).toBe(true)
        expect(document.getElementById(area.getAttribute('aria-activedescendant') as string)).toBe(optionsOf(host)[0])
        expect(keyOn(area, 'ArrowDown').defaultPrevented).toBe(true)
        expect(keyOn(area, 'Tab').defaultPrevented).toBe(true)
        expect(area.value).toBe('{{char}}')
        expect(area.selectionStart).toBe(8)
    })

    test('C2-C2 Left, Right, Home and End close it without being prevented', async () => {
        const { area, host } = mountField(fixture(''))
        area.focus()
        for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
            await typeOpen(area, '{{')
            expect(pickerOf(host), key).not.toBeNull()
            expect(keyOn(area, key).defaultPrevented).toBe(false)
            expect(pickerOf(host), key).toBeNull()
        }
    })

    test('C2-C2 a click in the field closes it', async () => {
        const { area, host } = mountField(fixture(''))
        area.focus()
        await typeOpen(area, '{{')
        area.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        flushSync()
        expect(pickerOf(host)).toBeNull()
    })

    test('C2-C3 while composing it opens and filters, keys are ignored, and nothing is written until compositionend', async () => {
        const fix = fixture('')
        const { area, host } = mountField(fix)
        area.focus()
        compositionStartOn(area)
        await typeOpen(area, '{{ge', true)
        expect(optionNames(host).slice(0, 2)).toEqual(['getvar', 'getglobalvar'])
        expect(marksIn(host, 'error') + marksIn(host, 'warning') + marksIn(host, 'info')).toBe(0)
        expect(keyOn(area, 'Enter', { isComposing: true }).defaultPrevented).toBe(false)
        expect(keyOn(area, 'ArrowDown', { keyCode: 229 }).defaultPrevented).toBe(false)
        expect(pickerOf(host)).not.toBeNull()
        expect(fix.writes).toEqual([])
        compositionEndOn(area)
        expect(fix.writes).toEqual(['{{ge'])
    })

    test('C2-C4 Ctrl+Shift+Space opens the sheet, Ctrl+Space does not; the sheet is a titled modal dialog with its search focused', async () => {
        const { area, host } = mountField(fixture('abcd'))
        area.focus()
        expect(keyOn(area, ' ', { code: 'Space', ctrlKey: true }).defaultPrevented).toBe(false)
        expect(sheetOf(host)).toBeNull()
        expect(keyOn(area, ' ', { code: 'Space', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true)
        await settleTokens()
        const dialog = sheetOf(host) as HTMLElement
        expect(dialog.getAttribute('aria-modal')).toBe('true')
        expect(document.getElementById(dialog.getAttribute('aria-labelledby') as string)?.textContent).toBe('ltInsertMacro')
        expect(document.activeElement).toBe(host.querySelector('[data-part="studio-lt-sheet-search"]'))
        const groups = Array.from(host.querySelectorAll<HTMLElement>('[data-part="studio-lt-sheet-group"]')).map((group) => group.dataset.group)
        expect(groups).toEqual(['char', 'var', 'time', 'text', 'logic', 'display', 'block'])
        expect(sheetOptions(host)).toHaveLength(66)
    })

    test('C2-C4 the braces button opens the sheet and is disabled when read-only', async () => {
        const { host } = mountField(fixture('abcd'))
        const braces = host.querySelector('[data-part="studio-lt-braces"]') as HTMLButtonElement
        expect(braces.getAttribute('aria-label')).toBe('ltInsertMacro')
        braces.click()
        flushSync()
        expect(sheetOf(host)).not.toBeNull()
        const locked = mountField(fixture('abcd'), { editable: false })
        expect((locked.host.querySelector('[data-part="studio-lt-braces"]') as HTMLButtonElement).disabled).toBe(true)
    })

    test('C2-C4 choosing inserts at the selection saved when it opened, closes it and refocuses the field', async () => {
        const fix = fixture('abcd')
        const { area, host } = mountField(fix)
        area.focus()
        area.setSelectionRange(2, 2)
        keyOn(area, ' ', { code: 'Space', ctrlKey: true, shiftKey: true })
        await settleTokens()
        expect(document.activeElement).not.toBe(area)
        optionByName(sheetOptions(host), 'getvar').click()
        flushSync()
        expect(fix.writes).toEqual(['ab{{getvar::}}cd'])
        expect(area.selectionStart).toBe(12)
        expect(sheetOf(host)).toBeNull()
        expect(document.activeElement).toBe(area)
    })

    test('C2-C4 the sheet search filters, and Cancel closes it without a write', async () => {
        const fix = fixture('abcd')
        const { area, host } = mountField(fix)
        keyOn(area, ' ', { code: 'Space', ctrlKey: true, shiftKey: true })
        await settleTokens()
        const search = host.querySelector('[data-part="studio-lt-sheet-search"]') as HTMLInputElement
        search.value = 'getg'
        search.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        expect(sheetOptions(host).map((option) => option.textContent?.split(' ')[0])).toEqual(['getglobalvar'])
        ;(host.querySelector('[data-part="studio-lt-sheet-cancel"]') as HTMLButtonElement).click()
        flushSync()
        expect(sheetOf(host)).toBeNull()
        expect(fix.writes).toEqual([])
    })

    test('C2-C8 Esc is stopped only when it closes the picker or the sheet', async () => {
        const { area, host } = mountField(fixture(''))
        area.focus()
        const reached = vi.fn()
        document.body.addEventListener('keydown', reached)
        try {
            await typeOpen(area, '{{')
            const closing = keyOn(area, 'Escape')
            expect(closing.defaultPrevented).toBe(true)
            expect(pickerOf(host)).toBeNull()
            expect(reached).not.toHaveBeenCalled()
            const idle = keyOn(area, 'Escape')
            expect(idle.defaultPrevented).toBe(false)
            expect(reached).toHaveBeenCalledTimes(1)
            reached.mockClear()
            keyOn(area, ' ', { code: 'Space', ctrlKey: true, shiftKey: true })
            reached.mockClear()
            await settleTokens()
            const search = host.querySelector('[data-part="studio-lt-sheet-search"]') as HTMLElement
            expect(keyOn(search, 'Escape').defaultPrevented).toBe(true)
            expect(sheetOf(host)).toBeNull()
            expect(reached).not.toHaveBeenCalled()
        } finally {
            document.body.removeEventListener('keydown', reached)
        }
    })

    test('C2-C5 in the stacked layout the picker is a strip above the keyboard and follows the visual viewport', async () => {
        studioScreen.layout = 'stack'
        const listeners: (() => void)[] = []
        const viewport = { height: 400, offsetTop: 0, addEventListener: (_type: string, listener: () => void) => { listeners.push(listener) }, removeEventListener: () => {} }
        vi.stubGlobal('innerHeight', 800)
        vi.stubGlobal('visualViewport', viewport)
        const { area, host } = mountField(fixture(''))
        area.focus()
        await typeOpen(area, '{{')
        const strip = pickerOf(host) as HTMLElement
        expect(strip.dataset.layout).toBe('stack')
        expect(strip.style.bottom).toBe('400px')
        viewport.height = 800
        for (const listener of listeners) listener()
        flushSync()
        expect(strip.style.bottom).toBe('0px')
    })

    test('C2-C6(a) a press on the picker is prevented, and a tap inserts once, in one step pair, and closes it', async () => {
        const fix = fixture('')
        const { area, host } = mountField(fix)
        area.focus()
        await typeOpen(area, '{{ge')
        const root = pickerOf(host) as HTMLElement
        const down = new PointerEvent('pointerdown', { bubbles: true, cancelable: true })
        const mouse = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
        optionsOf(host)[0].dispatchEvent(down)
        optionsOf(host)[0].dispatchEvent(mouse)
        expect(down.defaultPrevented).toBe(true)
        expect(mouse.defaultPrevented).toBe(true)
        const writesBefore = fix.writes.length
        const stepsBefore = fix.steps.count
        optionsOf(host)[0].click()
        flushSync()
        expect(fix.writes.length).toBe(writesBefore + 1)
        expect(fix.writes[writesBefore]).toBe('{{getvar::}}')
        expect(fix.steps.count).toBe(stepsBefore + 2)
        expect(pickerOf(host)).toBeNull()
        expect(root.isConnected).toBe(false)
    })

    test('C2-C6(b) a pick made while composing ends the composition first: the held text is written, then one insert', async () => {
        const fix = fixture('')
        const { area, host } = mountField(fix)
        area.focus()
        compositionStartOn(area)
        await typeOpen(area, '{{ge', true)
        optionsOf(host)[0].click()
        flushSync()
        expect(fix.writes).toEqual(['{{ge', '{{getvar::}}'])
        expect(area.value).toBe('{{getvar::}}')
        expect(pickerOf(host)).toBeNull()
        compositionEndOn(area)
        expect(fix.writes).toEqual(['{{ge', '{{getvar::}}'])
    })

    test('C2-C6(c) moving focus to a control outside closes it', async () => {
        const { area, host } = mountField(fixture(''))
        area.focus()
        await typeOpen(area, '{{')
        const outside = document.createElement('button')
        outside.dataset.testOutside = ''
        document.body.appendChild(outside)
        outside.focus()
        flushSync()
        expect(pickerOf(host)).toBeNull()
    })

    test('C2-C6(d) focus that lands on the picker root keeps it open and the tap still inserts once, back in the field', async () => {
        const fix = fixture('')
        const { area, host } = mountField(fix)
        area.focus()
        await typeOpen(area, '{{ge')
        ;(pickerOf(host) as HTMLElement).focus()
        flushSync()
        expect(pickerOf(host)).not.toBeNull()
        const writesBefore = fix.writes.length
        optionsOf(host)[0].click()
        flushSync()
        expect(fix.writes.slice(writesBefore)).toEqual(['{{getvar::}}'])
        expect(document.activeElement).toBe(area)
        expect(pickerOf(host)).toBeNull()
    })

    test('C2-C6(e) from the picker root, focus going outside closes it', async () => {
        const { area, host } = mountField(fixture(''))
        area.focus()
        await typeOpen(area, '{{')
        ;(pickerOf(host) as HTMLElement).focus()
        flushSync()
        const outside = document.createElement('button')
        outside.dataset.testOutside = ''
        document.body.appendChild(outside)
        outside.focus()
        flushSync()
        expect(pickerOf(host)).toBeNull()
    })

    test('C2 a pick whose {{ is gone closes without inserting', async () => {
        const fix = fixture('')
        const { area, host } = mountField(fix)
        area.focus()
        await typeOpen(area, '{{ge')
        const option = optionsOf(host)[0]
        const writesBefore = fix.writes.length
        area.value = 'xx'
        area.setSelectionRange(2, 2)
        option.click()
        flushSync()
        expect(fix.writes.length).toBe(writesBefore)
        expect(area.value).toBe('xx')
        expect(pickerOf(host)).toBeNull()
    })

    const openSheetOn = async (area: HTMLTextAreaElement): Promise<void> => {
        keyOn(area, ' ', { code: 'Space', ctrlKey: true, shiftKey: true })
        await settleTokens()
    }

    test('M37a M37b focus that lands on the picker root, or goes back to the field, keeps the picker open', async () => {
        const { area, host } = mountField(fixture(''))
        area.focus()
        await typeOpen(area, '{{ge')
        const root = pickerOf(host) as HTMLElement
        root.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: root }))
        flushSync()
        expect(pickerOf(host)).not.toBeNull()
        root.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: area }))
        flushSync()
        expect(pickerOf(host)).not.toBeNull()
    })

    test('C2-x50 an option shows the usage of its registry entry', async () => {
        setMacroIndexForTests(createMacroIndex(['char', 'user', 'getvar', '#if', ':else'].map(macroEntry).map((entry) => entry.name === 'getvar' ? { ...entry, usage: '{{getvar::name}}' } : entry)))
        const { area, host } = mountField(fixture(''))
        area.focus()
        await typeOpen(area, '{{ge')
        const usage = pickerOf(host)?.querySelector('[data-part="studio-lt-picker-usage"]')
        expect(usage?.textContent).toBe('{{getvar::name}}')
    })

    test('C2-x53 the live count names how many items the picker lists now', async () => {
        const { area, host } = mountField(fixture(''))
        area.focus()
        const countText = (): string | null | undefined => pickerOf(host)?.querySelector('[data-part="studio-lt-picker-count"]')?.textContent
        await typeOpen(area, '{{')
        expect(countText()).toBe(`ltMacroMatches(${optionsOf(host).length})`)
        await typeOpen(area, '{{ge')
        expect(optionsOf(host).length).toBeLessThan(66)
        expect(countText()).toBe(`ltMacroMatches(${optionsOf(host).length})`)
    })

    test('C2-y08 the textarea names the list it controls while the picker is open', async () => {
        const { area, host } = mountField(fixture(''))
        area.focus()
        expect(area.getAttribute('aria-controls')).toBeNull()
        await typeOpen(area, '{{')
        const listbox = pickerOf(host)?.querySelector('[role="listbox"]') as HTMLElement
        expect(area.getAttribute('aria-controls')).toBe(listbox.id)
    })

    test('C2-x90 ArrowDown past the last item wraps to the first', async () => {
        const { area, host } = mountField(fixture(''))
        area.focus()
        await typeOpen(area, '{{')
        const total = optionsOf(host).length
        for (let press = 0; press < total + 1; press += 1) keyOn(area, 'ArrowDown')
        expect(document.getElementById(area.getAttribute('aria-activedescendant') as string)).toBe(optionsOf(host)[0])
    })

    test('C2-x91 ArrowUp with no choice yet takes the last item', async () => {
        const { area, host } = mountField(fixture(''))
        area.focus()
        await typeOpen(area, '{{')
        expect(keyOn(area, 'ArrowUp').defaultPrevented).toBe(true)
        expect(document.getElementById(area.getAttribute('aria-activedescendant') as string)).toBe(optionsOf(host).at(-1))
    })

    test('C2-x92 an arrow key with no list to move in is left alone', async () => {
        const { area } = mountField(fixture(''))
        area.focus()
        await typeOpen(area, '{{zzzz')
        expect(keyOn(area, 'ArrowDown').defaultPrevented).toBe(false)
        expect(area.getAttribute('aria-activedescendant')).toBeNull()
    })

    test('C2-x93 Tab alone, with a name typed and no arrow choice, inserts nothing and closes the picker', async () => {
        const fix = fixture('')
        const { area, host } = mountField(fix)
        area.focus()
        await typeOpen(area, '{{g')
        const writesBefore = fix.writes.length
        expect(keyOn(area, 'Tab').defaultPrevented).toBe(false)
        expect(fix.writes.length).toBe(writesBefore)
        expect(area.value).toBe('{{g')
        expect(pickerOf(host)).toBeNull()
    })

    test('C2-x94 the first arrow choice is taken by Tab', async () => {
        const { area } = mountField(fixture(''))
        area.focus()
        await typeOpen(area, '{{')
        keyOn(area, 'ArrowDown')
        expect(keyOn(area, 'Tab').defaultPrevented).toBe(true)
        expect(area.value).toBe('{{user}}')
    })

    test('C2-x88 Esc with a trigger open but nothing listed is not stopped, so it reaches the Studio screen', async () => {
        const { area } = mountField(fixture(''))
        area.focus()
        const reached = vi.fn()
        document.body.addEventListener('keydown', reached)
        try {
            await typeOpen(area, '{{zzzz')
            expect(keyOn(area, 'Escape').defaultPrevented).toBe(false)
            expect(reached).toHaveBeenCalledTimes(1)
        } finally {
            document.body.removeEventListener('keydown', reached)
        }
    })

    test('C2-x82 a read-only field does not open the sheet by its shortcut', async () => {
        const { area, host } = mountField(fixture('abcd'), { editable: false })
        await openSheetOn(area)
        expect(sheetOf(host)).toBeNull()
    })

    test('C2-x87 Cmd+Shift+Space opens the sheet like Ctrl+Shift+Space', async () => {
        const { area, host } = mountField(fixture('abcd'))
        area.focus()
        keyOn(area, ' ', { code: 'Space', metaKey: true, shiftKey: true })
        await settleTokens()
        expect(sheetOf(host)).not.toBeNull()
    })

    test('C2-y11 the braces button says whether the sheet is open', async () => {
        const { host } = mountField(fixture('abcd'))
        const braces = host.querySelector('[data-part="studio-lt-braces"]') as HTMLButtonElement
        expect(braces.getAttribute('aria-expanded')).toBe('false')
        braces.click()
        flushSync()
        expect(braces.getAttribute('aria-expanded')).toBe('true')
    })

    test('C2-y15 opening the sheet closes an open picker', async () => {
        const { area, host } = mountField(fixture(''))
        area.focus()
        await typeOpen(area, '{{')
        expect(pickerOf(host)).not.toBeNull()
        await openSheetOn(area)
        expect(pickerOf(host)).toBeNull()
        expect(sheetOf(host)).not.toBeNull()
    })

    test('C2-x80 the sheet inserts at the selection saved when it opened, not at the caret of the moment', async () => {
        const fix = fixture('abcd')
        const { area, host } = mountField(fix)
        area.focus()
        area.setSelectionRange(2, 2)
        await openSheetOn(area)
        area.setSelectionRange(0, 0)
        optionByName(sheetOptions(host), 'getvar').click()
        flushSync()
        expect(fix.writes).toEqual(['ab{{getvar::}}cd'])
    })

    test('C2-x81 a saved selection past the end of a text that has shrunk is clamped, and nothing throws', async () => {
        const fix = fixture('abcd')
        const { area, host } = mountField(fix)
        area.focus()
        area.setSelectionRange(3, 3)
        await openSheetOn(area)
        fix.owner.value = 'a'
        flushSync()
        optionByName(sheetOptions(host), 'getvar').click()
        flushSync()
        expect(fix.writes).toEqual(['a{{getvar::}}'])
        expect(sheetOf(host)).toBeNull()
    })

    test('C2-x57 C2-x58 C2-x84 Esc and Cancel close the sheet and bring the field back to focus', async () => {
        const { area, host } = mountField(fixture('abcd'))
        await openSheetOn(area)
        expect(document.activeElement).not.toBe(area)
        keyOn(host.querySelector('[data-part="studio-lt-sheet-search"]') as HTMLElement, 'Escape')
        expect(sheetOf(host)).toBeNull()
        expect(document.activeElement).toBe(area)
        area.blur()
        await openSheetOn(area)
        expect(document.activeElement).not.toBe(area)
        ;(host.querySelector('[data-part="studio-lt-sheet-cancel"]') as HTMLButtonElement).click()
        flushSync()
        expect(sheetOf(host)).toBeNull()
        expect(document.activeElement).toBe(area)
    })

    test('C2-x59 C2-x60 Tab from the last control of the sheet goes to the first, and Shift+Tab from the first to the last', async () => {
        const { area, host } = mountField(fixture('abcd'))
        await openSheetOn(area)
        const dialog = sheetOf(host) as HTMLElement
        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('input, button'))
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        last.focus()
        expect(keyOn(last, 'Tab').defaultPrevented).toBe(true)
        expect(document.activeElement).toBe(first)
        expect(keyOn(first, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true)
        expect(document.activeElement).toBe(last)
    })

    test('C2-x65 an entry no table row covers is listed in the sheet under its own group', async () => {
        setMacroIndexForTests(createMacroIndex(['char', 'user', 'getvar', '#if', ':else', 'tex'].map(macroEntry)))
        const { area, host } = mountField(fixture('abcd'))
        await openSheetOn(area)
        const other = host.querySelector('[data-part="studio-lt-sheet-group"][data-group="other"]')
        expect(other).not.toBeNull()
        expect(other?.textContent).toContain('tex')
    })

    test('C2 nothing opens or renders after the field is gone', async () => {
        const { area } = mountField(fixture(''))
        area.focus()
        await typeOpen(area, '{{')
        for (const app of mounted.splice(0)) await unmount(app)
        expect(document.querySelector('[data-part="studio-lt-picker"]')).toBeNull()
    })
})

describe('CHORE-815 the shared text layout', () => {
    // Records every observer the field creates: its observed targets, its disconnect, and a manual callback.
    class ProbeObserverStub {
        static instances: ProbeObserverStub[] = []
        static callOnObserve = false
        targets: Element[] = []
        disconnected = false
        constructor(private readonly callback: ResizeObserverCallback) {
            ProbeObserverStub.instances.push(this)
        }
        observe(target: Element): void {
            this.targets.push(target)
            if (ProbeObserverStub.callOnObserve) this.emit()
        }
        disconnect(): void { this.disconnected = true }
        emit(): void { this.callback([], this as unknown as ResizeObserver) }
    }

    function stubObservers(callOnObserve: boolean): void {
        ProbeObserverStub.instances = []
        ProbeObserverStub.callOnObserve = callOnObserve
        vi.stubGlobal('ResizeObserver', ProbeObserverStub)
    }

    function probeObserverOf(probe: Element): ProbeObserverStub {
        const found = ProbeObserverStub.instances.find((instance) => instance.targets.includes(probe))
        if (!found) throw new Error('no observer on the probe')
        return found
    }

    // Counts the reads of the textarea's `scrollHeight`, which `fit()` makes once per run and nothing else here does.
    function countScrollHeightReads(run: () => void): number {
        let reads = 0
        Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, get: () => { reads += 1; return 0 } })
        try {
            run()
        } finally {
            delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight
        }
        return reads
    }

    function stubProbeBox(probe: HTMLElement, box: { width: number, height: number }): void {
        Object.defineProperty(probe, 'offsetWidth', { configurable: true, get: () => box.width })
        Object.defineProperty(probe, 'offsetHeight', { configurable: true, get: () => box.height })
    }

    test('T5a one aria-hidden probe holding an M sits inside the relative wrapper', () => {
        const { area, host } = mountField(fixture('hi'))
        const probes = host.querySelectorAll('[data-part="studio-lt-metric-probe"]')
        expect(probes.length).toBe(1)
        const probe = probes[0] as HTMLElement
        expect(probe.getAttribute('aria-hidden')).toBe('true')
        expect(probe.textContent).toBe('M')
        for (const token of ['invisible', 'absolute', 'inline-block']) expect(probe.classList.contains(token), `probe lacks ${token}`).toBe(true)
        expect(probe.parentElement).toBe(area.parentElement)
        expect(area.parentElement?.classList.contains('relative')).toBe(true)
    })

    test('T5 a change of the probe box re-fits the textarea; an unchanged box does not', () => {
        stubObservers(false)
        const { host } = mountField(fixture('hi'))
        const probe = host.querySelector('[data-part="studio-lt-metric-probe"]') as HTMLElement
        const box = { width: 10, height: 20 }
        stubProbeBox(probe, box)
        const observer = probeObserverOf(probe)
        expect(countScrollHeightReads(() => observer.emit())).toBe(1)
        box.height = 26
        expect(countScrollHeightReads(() => observer.emit()), 'a taller probe re-fits once').toBeGreaterThan(0)
        expect(countScrollHeightReads(() => observer.emit()), 'the same box again does nothing').toBe(0)
        box.width = 13
        expect(countScrollHeightReads(() => observer.emit()), 'a wider probe re-fits').toBeGreaterThan(0)
    })

    test('T5b the probe skips its first callback: a mount with an observer that calls back on observe reads scrollHeight as often as a mount with none', () => {
        const none = countScrollHeightReads(() => { vi.stubGlobal('ResizeObserver', undefined); mountField(fixture('hi')) })
        stubObservers(true)
        const calling = countScrollHeightReads(() => { mountField(fixture('hi')) })
        expect(ProbeObserverStub.instances.length).toBeGreaterThan(1)
        expect(calling).toBe(none)
    })

    test('T5c the probe observer is disconnected when the field is destroyed', async () => {
        stubObservers(false)
        const { host } = mountField(fixture('hi'))
        const probe = host.querySelector('[data-part="studio-lt-metric-probe"]') as HTMLElement
        const observer = probeObserverOf(probe)
        expect(observer.disconnected).toBe(false)
        for (const app of mounted.splice(0)) await unmount(app)
        expect(observer.disconnected).toBe(true)
    })

    test('T3c the textarea and the overlay both carry every layout token, so they break lines identically', () => {
        const { area, host } = mountField(fixture('{{char}} hi'))
        for (const token of LT_TEXT_LAYOUT.split(' ')) {
            expect(area.classList.contains(token), `textarea lacks ${token}`).toBe(true)
            expect(overlayOf(host).classList.contains(token), `overlay lacks ${token}`).toBe(true)
        }
        expect(area.classList.contains('w-full')).toBe(true)
    })

    // The textarea and the overlay report different heights at a 24 px line height. `visible` stands for a field that
    // has layout; jsdom never gives one, so the check's hidden-field guard would otherwise skip every read.
    function divergeHeights(area: HTMLTextAreaElement, host: HTMLElement, visible: boolean): void {
        const lineHeight = document.createElement('div').style
        lineHeight.setProperty('line-height', '24px')
        vi.stubGlobal('getComputedStyle', () => lineHeight)
        Object.defineProperty(area, 'offsetParent', { configurable: true, get: () => (visible ? host : null) })
        Object.defineProperty(area, 'scrollHeight', { configurable: true, get: () => 1000 })
        Object.defineProperty(overlayOf(host), 'scrollHeight', { configurable: true, get: () => 952 })
    }

    test('T6 a textarea and overlay that break lines differently turn colouring off with the note, until remount', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const { area, host } = mountField(fixture('hello'))
        divergeHeights(area, host, true)
        typeInto(area, 'hello!')
        advance(250)
        expect(overlayOf(host).getAttribute('data-overlay')).toBe('off')
        expect(host.querySelector('[data-part="studio-lt-hl-off"]')).not.toBeNull()
        typeInto(area, 'hello!!')
        advance(250)
        expect(overlayOf(host).getAttribute('data-overlay'), 'sticky for the mount').toBe('off')
    })

    test('T6d the misalignment switch-off survives a low-power flip on and off', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const { area, host } = mountField(fixture('hello'))
        divergeHeights(area, host, true)
        typeInto(area, 'hello!')
        advance(250)
        expect(overlayOf(host).getAttribute('data-overlay')).toBe('off')
        // The heights agree again, so a re-check on a re-enabled overlay could not trip it a second time; only the sticky flag keeps colouring off.
        Object.defineProperty(overlayOf(host), 'scrollHeight', { configurable: true, get: () => 1000 })
        setLowPower(true)
        flushSync()
        setLowPower(false)
        flushSync()
        advance(250)
        expect(overlayOf(host).getAttribute('data-overlay'), 'sticky across the flip').toBe('off')
        expect(host.querySelector('[data-part="studio-lt-hl-off"]')).not.toBeNull()
    })

    test('T6c a diverged height does not trip a hidden field or an overlay that is not on (compatibility guard)', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const hidden = mountField(fixture('hello'))
        divergeHeights(hidden.area, hidden.host, false)
        typeInto(hidden.area, 'hello!')
        advance(250)
        expect(overlayOf(hidden.host).getAttribute('data-overlay')).toBe('on')
        expect(hidden.host.querySelector('[data-part="studio-lt-hl-off"]')).toBeNull()
        const typing = mountField(fixture('hello'))
        divergeHeights(typing.area, typing.host, true)
        typeInto(typing.area, 'x'.repeat(WINDOW_LIMIT + 1))
        flushSync()
        expect(overlayOf(typing.host).getAttribute('data-overlay')).toBe('typing')
        expect(typing.host.querySelector('[data-part="studio-lt-hl-off"]')).toBeNull()
        setLowPower(true)
        const off = mountField(fixture('hello'))
        divergeHeights(off.area, off.host, true)
        typeInto(off.area, 'hello!')
        advance(250)
        expect(overlayOf(off.host).getAttribute('data-overlay')).toBe('off')
        expect(off.host.querySelector('[data-part="studio-lt-hl-off"]')).toBeNull()
    })
})

describe('S3e-D the focus-layer API of the field', () => {
    test('D-U4 onvalue receives the initial LF text once at mount, then each changed text once', () => {
        const seenValues: string[] = []
        const { area } = mountField(fixture('a\r\nb'), { onvalue: (value) => seenValues.push(value) })
        expect(seenValues).toEqual(['a\nb'])
        typeInto(area, 'a\nbX')
        expect(seenValues).toEqual(['a\nb', 'a\nbX'])
        typeInto(area, 'a\nbX')
        expect(seenValues, 'an input that leaves the text as it was says nothing').toEqual(['a\nb', 'a\nbX'])
    })

    test('D-U4 onvalue follows a text change that has no DOM event (an owner write)', () => {
        const seenValues: string[] = []
        const fix = fixture('one')
        mountField(fix, { onvalue: (value) => seenValues.push(value) })
        fix.owner.value = 'two'
        flushSync()
        expect(seenValues).toEqual(['one', 'two'])
    })

    test('value() and selection() read the textarea, composing() follows the controller', () => {
        const { area, exported } = mountField(fixture('abcdef'))
        expect(exported.value()).toBe('abcdef')
        area.setSelectionRange(1, 4)
        expect(exported.selection()).toEqual({ start: 1, end: 4 })
        expect(exported.composing()).toBe(false)
        area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        expect(exported.composing()).toBe(true)
        area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        expect(exported.composing()).toBe(false)
    })

    test('D-C17 braces, Find and Maximize are consecutive siblings in that order (no previewSource), and Find and Maximize stay enabled when the field is read-only while the braces are disabled', () => {
        const { host } = mountField(fixture('x'), { editable: false })
        const braces = host.querySelector('[data-part="studio-lt-braces"]') as HTMLButtonElement
        const find = host.querySelector('[data-part="studio-lt-find"]') as HTMLButtonElement
        const maximize = host.querySelector('[data-part="studio-lt-focus"]') as HTMLButtonElement
        expect(find).not.toBeNull()
        expect(maximize).not.toBeNull()
        expect(braces.nextElementSibling).toBe(find)
        expect(find.nextElementSibling).toBe(maximize)
        expect(braces.disabled).toBe(true)
        expect(find.disabled).toBe(false)
        expect(find.getAttribute('aria-haspopup')).toBe('dialog')
        expect(find.getAttribute('aria-label')).toBe('ltFind')
        expect(maximize.disabled).toBe(false)
        expect(maximize.getAttribute('aria-haspopup')).toBe('dialog')
        expect(maximize.getAttribute('aria-expanded')).toBe('false')
        expect(maximize.getAttribute('aria-label')).toBe('ltFocus')
    })

    test('D-C17 the focus variant has no Maximize button, no label element and no height handle, and keeps the braces button', () => {
        finePointer()
        const { host } = mountField(fixture('x'), { variant: 'focus', label: 'Description' })
        expect(host.querySelector('[data-part="studio-lt-focus"]')).toBeNull()
        expect(host.querySelector('[data-part="studio-lt-find"]')).toBeNull()
        expect(host.querySelector('label')).toBeNull()
        expect(host.querySelector('[data-part="studio-lt-height-handle"]')).toBeNull()
        expect(host.querySelector('[data-part="studio-lt-braces"]')).not.toBeNull()
    })

    test('D-C17 an inline field has a height handle on a fine pointer (the focus variant omits it by variant, not by pointer)', () => {
        finePointer()
        const { host } = mountField(fixture('x'))
        expect(host.querySelector('[data-part="studio-lt-height-handle"]')).not.toBeNull()
    })

    test('reveal selects the range and focuses the field, then hands focus to the caller; keepScroll restores the scroll position', () => {
        const { area, host, exported } = mountField(fixture('abcdef'))
        const other = document.createElement('button')
        host.appendChild(other)
        exported.reveal(1, 4)
        expect(document.activeElement).toBe(area)
        expect([area.selectionStart, area.selectionEnd]).toEqual([1, 4])
        exported.reveal(2, 3, other)
        expect(document.activeElement).toBe(other)
        expect([area.selectionStart, area.selectionEnd]).toEqual([2, 3])

        area.scrollTop = 40
        let seenDuring = -1
        exported.keepScroll(() => { area.scrollTop = 0; seenDuring = area.scrollTop })
        expect(seenDuring).toBe(0)
        expect(area.scrollTop).toBe(40)
    })

    test('Ctrl+E is ignored while composing, with Alt or Shift, and in the focus variant', () => {
        const inline = mountField(fixture('x'))
        const maximize = inline.host.querySelector('[data-part="studio-lt-focus"]') as HTMLButtonElement
        inline.area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        const composingKey = keyOn(inline.area, 'e', { ctrlKey: true, isComposing: true })
        flushSync()
        expect(composingKey.defaultPrevented).toBe(false)
        expect(maximize.getAttribute('aria-expanded')).toBe('false')
        inline.area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        expect(keyOn(inline.area, 'e', { ctrlKey: true, altKey: true }).defaultPrevented).toBe(false)
        expect(keyOn(inline.area, 'e', { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false)
        const focus = mountField(fixture('x'), { variant: 'focus' })
        expect(keyOn(focus.area, 'e', { ctrlKey: true }).defaultPrevented).toBe(false)
    })
})

// A stand-in engine: `{{char}}` and `{{getvar::hp}}` are filled from the values, `random` marks the text as varying,
// and the sanitiser is the identity (the real one has its own rows in LongTextPreview.svelte.test.ts).
function fakeEngine(over: Partial<PreviewEngine> = {}): PreviewEngine {
    const base: PreviewEngine = {
        copiedChatValues: () => null,
        runPreview: (text, _kind, _source, values) => ({
            ok: true,
            text: text.replaceAll('{{char}}', values.char).replaceAll('{{getvar::hp}}', values.chat.hp ?? ''),
            writes: [],
            varies: text.includes('random'),
        }),
        sandboxKeysOf: (text) => ({ chat: text.includes('{{getvar::hp}}') ? ['hp'] : [], toggles: [] }),
        sandboxSourceOf: (live) => ({ name: live.name, defaultVariables: '', alternateGreetings: [], texts: {}, bindedPersona: null, modules: [], chatModules: [], customModuleToggle: '' }),
        sandboxUserName: () => 'Uma',
        variesIn: (text) => text.includes('random'),
        VARIES_NAMES: [],
        previewHtml: (text) => ({ html: text, mediaRemoved: 0 }),
    }
    return { ...base, ...over }
}

const previewFrom = (name = 'Alice'): (() => PreviewSourceInput) => () => ({ owner: { name } as character, chat: null, globals: {} })

describe('S3e-E2b the chip counts filled text and the Preview button', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        setPreviewEngineForTests(fakeEngine())
    })

    afterEach(() => { setPreviewEngineForTests(null) })

    async function counted(): Promise<void> {
        await advanceTokens(500)
        await settleTokens()
        await settleTokens()
    }

    test('E2-C7 with a source the chip counts the filled text with the filled note', async () => {
        const { host } = mountField(fixture('{{char}} hi'), { previewSource: previewFrom('Alice') })
        await counted()
        expect(tokenRequests.map((request) => request.text)).toEqual(['Alice hi'])
        expect(chipOf(host).textContent).toBe('ltTokens(8,M)')
        expect(panelOf(host).textContent).toContain('ltTokNote')
        expect(panelOf(host).textContent).not.toContain('ltTokNoteRaw')
    })

    test('E2-C7 an exact count of text that varies uses the varies key; an estimate stays an estimate', async () => {
        const first = mountField(fixture('random {{char}}'), { previewSource: previewFrom('Alice') })
        await counted()
        expect(chipOf(first.host).textContent).toBe('ltTokensVaries(12,M)')
        tokenAnswer = async () => ({ kind: 'estimate', count: 5, model: 'M', reason: 'online-only' })
        const second = mountField(fixture('random {{char}}'), { previewSource: previewFrom('Alice') })
        await counted()
        expect(chipOf(second.host).textContent).toBe('ltTokensEst(5)')
        expect(chipOf(second.host).textContent).not.toContain('Varies')
        expect(panelOf(second.host).textContent).toContain('ltTokNote')
    })

    test('E1-C2 amended: the raw note shows only on raw counts (no source, plain mode, a failed run, a failed engine load)', async () => {
        const noSource = mountField(fixture('{{char}} hi'))
        await counted()
        expect(tokenRequests.at(-1)?.text).toBe('{{char}} hi')
        expect(panelOf(noSource.host).textContent).toContain('ltTokNoteRaw')

        tokenRequests.length = 0
        const plain = mountField(fixture('{{char}} hi'), { mode: 'plain', previewSource: previewFrom() })
        await counted()
        expect(tokenRequests.at(-1)?.text).toBe('{{char}} hi')
        expect(panelOf(plain.host).textContent).toContain('ltTokNoteRaw')

        tokenRequests.length = 0
        setPreviewEngineForTests(fakeEngine({ runPreview: () => ({ ok: false }) }))
        const failedRun = mountField(fixture('{{char}} hi'), { previewSource: previewFrom() })
        await counted()
        expect(tokenRequests.at(-1)?.text).toBe('{{char}} hi')
        expect(panelOf(failedRun.host).textContent).toContain('ltTokNoteRaw')

        tokenRequests.length = 0
        setPreviewEngineForTests(() => Promise.reject(new Error('load failed')))
        const failedLoad = mountField(fixture('{{char}} hi'), { previewSource: previewFrom() })
        await counted()
        expect(tokenRequests.at(-1)?.text).toBe('{{char}} hi')
        expect(chipOf(failedLoad.host).textContent).toBe('ltTokens(11,M)')
        expect(panelOf(failedLoad.host).textContent).toContain('ltTokNoteRaw')
    })

    test('E2-C7 one value edit in the preview is one recount of the chip', async () => {
        const { host } = mountField(fixture('x{{getvar::hp}}'), { previewSource: previewFrom() })
        await counted()
        expect(tokenRequests.map((request) => request.text)).toEqual(['x'])
        ;(host.querySelector('[data-part="studio-lt-preview"]') as HTMLButtonElement).click()
        flushSync()
        await settleTokens()
        const input = host.querySelector('[data-part="studio-lt-preview-row"][data-key="hp"] input') as HTMLInputElement
        input.value = '9'
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
        flushSync()
        await counted()
        expect(tokenRequests.map((request) => request.text)).toEqual(['x', 'x9'])
    })

    test('the Preview button shows for a non-plain mode with a source only, never in the focus variant, and is not disabled when read-only', () => {
        expect(mountField(fixture('x'), { previewSource: previewFrom() }).host.querySelector('[data-part="studio-lt-preview"]')).not.toBeNull()
        expect(mountField(fixture('x'), { mode: 'plain', previewSource: previewFrom() }).host.querySelector('[data-part="studio-lt-preview"]')).toBeNull()
        expect(mountField(fixture('x')).host.querySelector('[data-part="studio-lt-preview"]')).toBeNull()
        expect(mountField(fixture('x'), { variant: 'focus', previewSource: previewFrom() }).host.querySelector('[data-part="studio-lt-preview"]')).toBeNull()
        const readOnly = mountField(fixture('x'), { editable: false, previewSource: previewFrom() })
        expect((readOnly.host.querySelector('[data-part="studio-lt-preview"]') as HTMLButtonElement).disabled).toBe(false)
    })

    test('D-C17 with a source the header order is braces, Find, Preview, Maximize', () => {
        const { host } = mountField(fixture('x'), { previewSource: previewFrom() })
        const braces = host.querySelector('[data-part="studio-lt-braces"]') as HTMLElement
        const find = host.querySelector('[data-part="studio-lt-find"]') as HTMLElement
        const preview = host.querySelector('[data-part="studio-lt-preview"]') as HTMLElement
        const maximize = host.querySelector('[data-part="studio-lt-focus"]') as HTMLElement
        expect(braces.nextElementSibling).toBe(find)
        expect(find.nextElementSibling).toBe(preview)
        expect(preview.nextElementSibling).toBe(maximize)
        expect(preview.getAttribute('aria-label')).toBe('ltPreview')
        expect(preview.getAttribute('aria-haspopup')).toBe('dialog')
    })

    test('E2-C1 the eye opens a modal sheet titled Preview; Esc closes only the sheet and the field stays', async () => {
        const { host, area } = mountField(fixture('hi'), { previewSource: previewFrom() })
        const eye = host.querySelector('[data-part="studio-lt-preview"]') as HTMLButtonElement
        eye.click()
        flushSync()
        const dialog = host.querySelector('[data-part="studio-lt-preview-sheet"]') as HTMLElement
        expect(dialog.getAttribute('role')).toBe('dialog')
        expect(dialog.getAttribute('aria-modal')).toBe('true')
        expect(document.getElementById(dialog.getAttribute('aria-labelledby') as string)?.textContent).toBe('ltPreview')
        expect(eye.getAttribute('aria-expanded')).toBe('true')
        const esc = keyOn(dialog, 'Escape')
        expect(esc.defaultPrevented).toBe(true)
        expect(host.querySelector('[data-part="studio-lt-preview-sheet"]')).toBeNull()
        expect(area.isConnected).toBe(true)
        expect(eye.getAttribute('aria-expanded')).toBe('false')
    })

    test('E2-C1 Back closes the sheet without bringing the field back into focus', async () => {
        back.layers.length = 0
        const { area, host } = mountField(fixture('hi'), { previewSource: previewFrom() })
        area.focus()
        ;(host.querySelector('[data-part="studio-lt-preview"]') as HTMLButtonElement).click()
        flushSync()
        expect(host.querySelector('[data-part="studio-lt-preview-sheet"]')).not.toBeNull()
        area.blur()
        const layer = back.layers.at(-1)
        expect(layer?.isOpen()).toBe(true)
        layer?.close()
        flushSync()
        expect(host.querySelector('[data-part="studio-lt-preview-sheet"]')).toBeNull()
        expect(document.activeElement).not.toBe(area)
    })

    test('E2-C1 opening the preview closes an open macro picker, also when the field has no focus to lose', async () => {
        const { area, host } = mountField(fixture(''), { previewSource: previewFrom() })
        await typeOpen(area, '{{')
        expect(pickerOf(host)).not.toBeNull()
        ;(host.querySelector('[data-part="studio-lt-preview"]') as HTMLButtonElement).click()
        flushSync()
        expect(pickerOf(host)).toBeNull()
        expect(host.querySelector('[data-part="studio-lt-preview-sheet"]')).not.toBeNull()
    })

    test('E2-C5 while the field is composing the sheet shows its old output; it updates 400 ms after the composition ends', async () => {
        const { area, host } = mountField(fixture('hi'), { previewSource: previewFrom() })
        ;(host.querySelector('[data-part="studio-lt-preview"]') as HTMLButtonElement).click()
        flushSync()
        await settleTokens()
        await settleTokens()
        await advanceTokens(450)
        const output = (): string => (host.querySelector('[data-part="studio-lt-preview-output"]')?.textContent ?? '').trim()
        expect(output()).toBe('hi')
        compositionStartOn(area)
        typeInto(area, 'hix', true)
        flushSync()
        await advanceTokens(3000)
        expect(output()).toBe('hi')
        compositionEndOn(area)
        flushSync()
        await advanceTokens(399)
        expect(output()).toBe('hi')
        await advanceTokens(1)
        expect(output()).toBe('hix')
    })
})