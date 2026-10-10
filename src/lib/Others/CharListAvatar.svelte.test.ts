// @vitest-environment happy-dom

/**
 * `CharListAvatar.svelte`: the avatar of a character list entry. One element for its whole life,
 * so a button that holds focus keeps it when its picture arrives; the picture belongs to the
 * location it was resolved for.
 *
 * MOCKED: `getCharImage` is a spy whose promises the test settles by hand, so the order in which
 * pictures arrive is the test's. Nothing else is involved.
 *
 * Test labels: every test is a feature test of a component that does not exist before the
 * windowed lists. The base behaviour it replaces (the avatar element being re-created when its
 * style resolves) is asserted through the screen in `GridCatalog.pick.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { getCharImageMock } = vi.hoisted(() => ({ getCharImageMock: vi.fn() }))

vi.mock('src/ts/characters', () => ({ getCharImage: getCharImageMock }))

import CharListAvatar from './CharListAvatar.svelte'

interface Deferred {
    loc: string
    resolve(style: string): void
    reject(reason: Error): void
}

const pending: Deferred[] = []

beforeEach(() => {
    pending.length = 0
    getCharImageMock.mockReset()
    getCharImageMock.mockImplementation((loc: string) => new Promise<string>((resolve, reject) => {
        pending.push({ loc, resolve, reject })
    }))
})

let mounted: { app: Record<string, unknown>; target: HTMLElement } | null = null

function mountAvatar(props: Record<string, unknown>): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted = { app: mount(CharListAvatar, { target, props: props as never }) as Record<string, unknown>, target }
    flushSync()
    return target
}

afterEach(async () => {
    vi.restoreAllMocks()
    if (mounted) {
        await unmount(mounted.app as never)
        mounted.target.remove()
        mounted = null
    }
})

async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
        await Promise.resolve()
        flushSync()
    }
}

const styleOf = (el: Element): string => el.getAttribute('style') ?? ''

describe('CharListAvatar', () => {
    test('with a handler and a label it is one button named after the character', () => {
        const onclick = vi.fn()
        const target = mountAvatar({ src: '', label: 'Ann', onclick })
        const button = target.querySelector('button')!
        expect(button.classList.contains('ico')).toBe(true)
        expect(button.getAttribute('aria-label')).toBe('Ann')
        button.click()
        expect(onclick).toHaveBeenCalledTimes(1)
    })

    test('without them it is a decorative box that is hidden from assistive technology and takes no click', () => {
        const target = mountAvatar({ src: '' })
        expect(target.querySelector('button')).toBeNull()
        const box = target.querySelector('.ico')!
        expect(box.tagName).toBe('DIV')
        expect(box.getAttribute('aria-hidden')).toBe('true')
    })

    test('the button that holds focus is the same element, and keeps focus, when its picture arrives', async () => {
        const target = mountAvatar({ src: 'assets/a.png', label: 'Ann', onclick: () => {} })
        const before = target.querySelector('button')!
        before.focus()
        expect(document.activeElement).toBe(before)
        expect(styleOf(before)).toBe('')

        pending[0].resolve('background: url("data:a");')
        await settle()

        const after = target.querySelector('button')!
        expect(after).toBe(before)
        expect(document.activeElement).toBe(before)
        expect(styleOf(after)).toContain('data:a')
    })

    test('a picture that arrives after the location changed is dropped, and the new location never shows the old picture', async () => {
        const props = $state({ src: 'assets/a.png' })
        const target = mountAvatar(props)
        const box = target.querySelector('.ico')!
        expect(pending.map((p) => p.loc)).toEqual(['assets/a.png'])

        props.src = 'assets/b.png'
        flushSync()
        await settle()
        expect(pending.map((p) => p.loc)).toEqual(['assets/a.png', 'assets/b.png'])

        pending[1].resolve('background: url("data:b");')
        await settle()
        expect(styleOf(box)).toContain('data:b')

        pending[0].resolve('background: url("data:a");')
        await settle()
        expect(styleOf(box)).toContain('data:b')
        expect(styleOf(box)).not.toContain('data:a')
    })

    test('a new location shows no picture until its own arrives', async () => {
        const props = $state({ src: 'assets/a.png' })
        const target = mountAvatar(props)
        const box = target.querySelector('.ico')!
        pending[0].resolve('background: url("data:a");')
        await settle()
        expect(styleOf(box)).toContain('data:a')

        props.src = 'assets/b.png'
        flushSync()
        expect(styleOf(box)).not.toContain('data:a')
    })

    test('a lookup that fails leaves the avatar in place without a picture and logs a warning', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const target = mountAvatar({ src: 'assets/a.png' })
        const box = target.querySelector('.ico')!

        pending[0].reject(new Error('no such asset'))
        await settle()

        expect(target.querySelector('.ico')).toBe(box)
        expect(styleOf(box)).toBe('')
        expect(warn).toHaveBeenCalledTimes(1)
    })

    test('with no image it shows the fallback style and never looks an image up', () => {
        const target = mountAvatar({ src: '', fallbackStyle: 'background:red' })
        expect(getCharImageMock).not.toHaveBeenCalled()
        expect(styleOf(target.querySelector('.ico')!)).toContain('red')
    })

    test('a change of an unrelated prop does not look the image up again', async () => {
        const props = $state({ src: 'assets/a.png', label: 'Ann', onclick: () => {} })
        mountAvatar(props)
        pending[0].resolve('background: url("data:a");')
        await settle()

        props.label = 'Anne'
        flushSync()
        await settle()
        expect(getCharImageMock).toHaveBeenCalledTimes(1)
    })
})
