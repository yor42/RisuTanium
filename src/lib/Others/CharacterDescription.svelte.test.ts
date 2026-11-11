// @vitest-environment jsdom

/**
 * `CharacterDescription.svelte`: a catalog row's description. Before its row is
 * near the viewport it is plain text and nothing is parsed; after, it is the
 * markdown render with every media element removed (jsdom, so the removal runs
 * on a real HTML parser), reused from the cache when the same text comes back.
 * The clamp is a height cut that follows `clamped`, and the clamp measurement
 * is reported only for a visible description that was given a callback.
 *
 * MOCKED: `ParseMarkdown` (the full renderer needs the whole app) and the
 * colour scheme store.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { parseSpy } = vi.hoisted(() => ({
    parseSpy: vi.fn(async (text: string) => `<p>${text}</p><img src="https://example.com/a.png"><picture><source srcset="https://example.com/b.png"></picture><video src="https://example.com/c.mp4"></video>`),
}))

vi.mock('src/ts/parser/parser.svelte', () => ({
    ParseMarkdown: parseSpy,
}))

vi.mock('src/ts/gui/colorscheme', () => ({
    ColorSchemeTypeStore: writable(true),
}))

import { clearDescriptionCache } from '../../ts/gui/descriptionMarkdown'
import { previewCut } from '../../ts/gui/descriptionPreview'
import CharacterDescription from './CharacterDescription.svelte'

interface MountProps {
    text: string
    visible: boolean
    clamped?: boolean
    onClampChange?: (clamped: boolean) => void
}

async function settle(): Promise<void> {
    for (let i = 0; i < 8; i++) {
        flushSync()
        await Promise.resolve()
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
    flushSync()
}

async function withMounted(props: MountProps, body: (target: HTMLElement, props: MountProps) => void | Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const state = $state(props)
    const app = mount(CharacterDescription, { target, props: state }) as Record<string, unknown>
    try {
        await settle()
        await body(target, state)
    } finally {
        await unmount(app as never)
        target.remove()
    }
}

beforeEach(() => {
    parseSpy.mockClear()
    clearDescriptionCache()
})

describe('CharacterDescription', () => {
    test('shows plain text and parses nothing while the row is not near', async () => {
        await withMounted({ text: '**bold**', visible: false }, (target) => {
            expect(target.querySelector('[data-description]')?.textContent?.trim()).toBe('**bold**')
            expect(target.querySelector('p')).toBeNull()
            expect(parseSpy).not.toHaveBeenCalled()
        })
    })

    test('renders the markdown once visible, with every media element removed', async () => {
        await withMounted({ text: 'hello', visible: true }, (target) => {
            expect(target.querySelector('p')?.textContent).toBe('hello')
            expect(target.querySelector('img, picture, source, video, audio, iframe')).toBeNull()
            expect(parseSpy).toHaveBeenCalledTimes(1)
        })
    })

    test('turning visible later renders, and a second mount of the same text reuses the cache', async () => {
        await withMounted({ text: 'again', visible: false }, async (target, props) => {
            expect(target.querySelector('p')).toBeNull()
            props.visible = true
            await settle()
            expect(target.querySelector('p')?.textContent).toBe('again')
        })
        await withMounted({ text: 'again', visible: true }, (target) => {
            expect(target.querySelector('p')?.textContent).toBe('again')
            expect(parseSpy).toHaveBeenCalledTimes(1)
        })
    })

    test('a changed text shows the new render, never the old one', async () => {
        await withMounted({ text: 'first', visible: true }, async (target, props) => {
            expect(target.querySelector('p')?.textContent).toBe('first')
            props.text = 'second'
            await settle()
            expect(target.querySelector('p')?.textContent).toBe('second')
        })
    })

    test('the clamp is a height cut that follows the clamped prop', async () => {
        await withMounted({ text: 'x', visible: true, clamped: true }, async (target, props) => {
            const description = target.querySelector<HTMLElement>('[data-description]')!
            expect(description.classList.contains('max-h-18')).toBe(true)
            expect(description.classList.contains('overflow-hidden')).toBe(true)
            props.clamped = false
            await settle()
            expect(description.classList.contains('max-h-18')).toBe(false)
        })
    })

    test('the clamp measurement is reported only for a visible description given a callback', async () => {
        const hidden = vi.fn()
        await withMounted({ text: 'x', visible: false, onClampChange: hidden }, () => {
            expect(hidden).not.toHaveBeenCalled()
        })
        const shown = vi.fn()
        await withMounted({ text: 'x', visible: true, onClampChange: shown }, () => {
            expect(shown).toHaveBeenCalledWith(false)
        })
    })

    test('a failed render keeps the plain text', async () => {
        parseSpy.mockRejectedValueOnce(new Error('boom'))
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        try {
            await withMounted({ text: 'still here', visible: true }, (target) => {
                expect(target.querySelector('[data-description]')?.textContent?.trim()).toBe('still here')
                expect(warn).toHaveBeenCalled()
            })
        } finally {
            warn.mockRestore()
        }
    })
})

/**
 * A long note without markup is parsed as a prefix while its row is clamped.
 *
 * LAYOUT SEAM: jsdom has no layout, so `scrollHeight` and `clientHeight` of
 * the description block come from `layout`. The clamp measurement itself
 * (`measureClamp`, the escalation rule) is the real one.
 */
describe('CharacterDescription: prefix preview of a long note', () => {
    type Layout = (block: HTMLElement) => { scroll: number; client: number }
    let layout: Layout = () => ({ scroll: 0, client: 0 })

    const defaultParse = async (text: string): Promise<string> => `<p>${text}</p>`
    /** An eligible note: no markup, blank-line separated, with TAIL in the last paragraph only. */
    function eligibleNote(paragraphs: number, label = 'Paragraph'): string {
        const note = [...Array.from({ length: paragraphs }, (_, i) => `${label} ${i} holds plain words only and nothing else.`), 'TAIL final paragraph.'].join('\n\n')
        const cut = previewCut(note)
        expect(cut).not.toBeNull()
        expect(note.slice(0, cut!)).not.toContain('TAIL')
        return note
    }
    const prefixOf = (note: string): string => note.slice(0, previewCut(note)!)

    // Overflows (the clamp hides content) whatever is rendered.
    const alwaysOverflows: Layout = (block) => block.hasAttribute('data-description') ? { scroll: 100, client: 20 } : { scroll: 0, client: 0 }
    // Overflows only once the block holds the tail, as a clamp would when the prefix is shorter than the clamp.
    const overflowsWithTail: Layout = (block) => block.hasAttribute('data-description') ? { scroll: block.textContent?.includes('TAIL') ? 100 : 10, client: 20 } : { scroll: 0, client: 0 }

    function installLayoutStandIn(): () => void {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get(this: HTMLElement) { return layout(this).scroll } })
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get(this: HTMLElement) { return layout(this).client } })
        return () => {
            delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight
            delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight
        }
    }

    const parsedInputs = (): string[] => parseSpy.mock.calls.map((call) => call[0])
    const shownText = (target: HTMLElement): string => target.querySelector('[data-description]')?.textContent ?? ''

    let restoreLayout: () => void = () => {}

    beforeEach(() => {
        layout = () => ({ scroll: 0, client: 0 })
        parseSpy.mockImplementation(defaultParse)
        restoreLayout = installLayoutStandIn()
    })

    afterEach(() => {
        restoreLayout()
        parseSpy.mockImplementation(defaultParse)
    })

    // Reproducer: on the base the whole note reaches the parser.
    test('a clamped row hands the parser a prefix, never the whole long note', async () => {
        layout = alwaysOverflows
        const note = eligibleNote(250)
        expect(note.length).toBeGreaterThan(10_000)
        const onClampChange = vi.fn()
        await withMounted({ text: note, visible: true, clamped: true, onClampChange }, (target) => {
            expect(parsedInputs()).toEqual([prefixOf(note)])
            expect(Math.max(...parsedInputs().map((input) => input.length))).toBeLessThanOrEqual(2000)
            expect(shownText(target)).toContain('Paragraph 0 ')
            expect(shownText(target)).not.toContain('TAIL')
            expect(onClampChange).toHaveBeenLastCalledWith(true)
        })
    })

    // Guard: Show more renders the whole note; Show less returns to the cached prefix without a parse.
    test('expanding parses the whole note and collapsing shows the prefix again without a new parse', async () => {
        layout = alwaysOverflows
        const note = eligibleNote(60)
        await withMounted({ text: note, visible: true, clamped: true, onClampChange: vi.fn() }, async (target, props) => {
            expect(shownText(target)).not.toContain('TAIL')
            props.clamped = false
            await settle()
            expect(parsedInputs()).toEqual([prefixOf(note), note])
            expect(shownText(target)).toContain('TAIL')
            props.clamped = true
            await settle()
            expect(parsedInputs()).toHaveLength(2)
            expect(shownText(target)).not.toContain('TAIL')
        })
    })

    // Guard: a prefix shorter than the clamp renders the whole note, and the toggle is told only the final answer.
    test('a prefix that does not fill the clamp escalates to the whole note without reporting the underfill', async () => {
        layout = overflowsWithTail
        const note = eligibleNote(60)
        const onClampChange = vi.fn()
        await withMounted({ text: note, visible: true, clamped: true, onClampChange }, (target) => {
            expect(parsedInputs()).toEqual([prefixOf(note), note])
            expect(shownText(target)).toContain('TAIL')
            expect(onClampChange.mock.calls.map((call) => call[0])).not.toContain(false)
            expect(onClampChange).toHaveBeenLastCalledWith(true)
        })
    })

    // Guard: a row without a toggle (the Trash tab) escalates the same way.
    test('a row without onClampChange escalates too', async () => {
        layout = overflowsWithTail
        const note = eligibleNote(60)
        await withMounted({ text: note, visible: true, clamped: true }, (target) => {
            expect(parsedInputs()).toEqual([prefixOf(note), note])
            expect(shownText(target)).toContain('TAIL')
        })
    })

    // Guard for the rule: the plain-text stage (before the render arrives) is never a reason to parse more.
    test('a measurement before the render arrives does not escalate', async () => {
        layout = (block) => block.hasAttribute('data-description') && block.firstElementChild ? overflowsWithTail(block) : { scroll: 20, client: 20 }
        const note = eligibleNote(60)
        parseSpy.mockImplementation(() => new Promise<string>(() => {}))
        await withMounted({ text: note, visible: true, clamped: true, onClampChange: vi.fn() }, (target) => {
            expect(target.querySelector('[data-description]')?.firstElementChild).toBeNull()
            expect(parsedInputs()).toEqual([prefixOf(note)])
        })
    })

    // Guard for the rule: a hidden block (zero height) cannot tell an underfilled clamp from no layout.
    test('a block with no height does not escalate', async () => {
        layout = () => ({ scroll: 0, client: 0 })
        const note = eligibleNote(60)
        await withMounted({ text: note, visible: true, clamped: true, onClampChange: vi.fn() }, () => {
            expect(parsedInputs()).toEqual([prefixOf(note)])
        })
    })

    // Guard with identity falsification (scratch only): without `stripMedia` on the prefix path the media assertions fail.
    test('the prefix render carries no media, no app-control attribute and no non-web link', async () => {
        layout = alwaysOverflows
        parseSpy.mockImplementation(async (text: string) => `<p>${text}</p><img src="https://example.com/a.png"><picture><source srcset="https://example.com/b.png"></picture><video src="https://example.com/c.mp4"></video><button risu-btn="go">run</button><a href="javascript:void(0)">dead</a><a href="https://example.com/ok">ok</a>`)
        const note = eligibleNote(60)
        await withMounted({ text: note, visible: true, clamped: true, onClampChange: vi.fn() }, (target) => {
            expect(parsedInputs()).toEqual([prefixOf(note)])
            expect(target.querySelector('img, picture, source, video')).toBeNull()
            expect(target.querySelector('[risu-btn]')).toBeNull()
            expect(Array.from(target.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'))).toEqual(['https://example.com/ok'])
        })
    })

    // Guard: an escalation belongs to one text; a changed text starts again from its own prefix.
    test('a changed text starts again from its own prefix after an escalation', async () => {
        layout = overflowsWithTail
        const first = eligibleNote(60)
        const second = eligibleNote(70, 'Another')
        await withMounted({ text: first, visible: true, clamped: true, onClampChange: vi.fn() }, async (target, props) => {
            expect(parsedInputs()).toEqual([prefixOf(first), first])
            props.text = second
            await settle()
            expect(parsedInputs().slice(0, 4)).toEqual([prefixOf(first), first, prefixOf(second), second])
            expect(shownText(target)).toContain('TAIL')
        })
    })

    // Guard: after an escalation the row measures again even when the prefix and the whole note give the same HTML.
    test('the final measurement is reported after an escalation whose render is identical', async () => {
        layout = overflowsWithTail
        parseSpy.mockImplementation(async () => '<p>SAME</p>')
        const note = eligibleNote(60)
        const onClampChange = vi.fn()
        await withMounted({ text: note, visible: true, clamped: true, onClampChange }, () => {
            expect(parsedInputs()).toEqual([prefixOf(note), note])
            expect(onClampChange).toHaveBeenLastCalledWith(false)
        })
    })

    // Guard: notes that cannot be cut safely are parsed whole, as before.
    test('a long note with markup is parsed whole', async () => {
        layout = alwaysOverflows
        const note = `<p class="x">raw</p>\n\n${eligibleNote(60)}`
        expect(previewCut(note)).toBeNull()
        await withMounted({ text: note, visible: true, clamped: true, onClampChange: vi.fn() }, () => {
            expect(parsedInputs()).toEqual([note])
        })
    })
})
