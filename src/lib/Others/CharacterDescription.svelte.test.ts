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
import { beforeEach, describe, expect, test, vi } from 'vitest'

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
