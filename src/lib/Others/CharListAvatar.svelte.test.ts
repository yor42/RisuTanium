// @vitest-environment happy-dom

/**
 * `CharListAvatar.svelte`: the avatar of a character list entry. One element for its whole life,
 * so a button that holds focus keeps it when its picture arrives; the picture belongs to the
 * location it was resolved for.
 *
 * MOCKED: `getCharImage` is a spy whose promises the test settles by hand, so the order in which
 * pictures arrive is the test's, and `DBState` is a constant object. The style cache is reset
 * before every test.
 *
 * Test labels: every test is a feature test of a component that does not exist before the
 * windowed lists. The base behaviour it replaces (the avatar element being re-created when its
 * style resolves) is asserted through the screen in `GridCatalog.pick.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { getCharImageMock } = vi.hoisted(() => ({ getCharImageMock: vi.fn() }))

vi.mock('src/ts/characters', () => ({ getCharImage: getCharImageMock }))
// Only `DBState.db.hideAllImages` is read, as part of the cache key.
vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: { hideAllImages: false } } }))

import CharListAvatar, { CHAR_LIST_AVATAR_CACHE_LIMIT, CHAR_LIST_AVATAR_CACHE_MAX_LENGTH, resetCharListAvatarCacheForTest } from './CharListAvatar.svelte'

interface Deferred {
    loc: string
    resolve(style: string): void
    reject(reason: Error): void
}

const pending: Deferred[] = []

beforeEach(() => {
    resetCharListAvatarCacheForTest()
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

    test('a tile created again for a location that was resolved shows its picture at once and looks nothing up', async () => {
        const first = mountAvatar({ src: 'assets/a.png' })
        pending[0].resolve('background: url("data:a");')
        await settle()
        expect(styleOf(first.querySelector('.ico')!)).toContain('data:a')
        await unmount(mounted!.app as never)
        mounted!.target.remove()
        mounted = null
        getCharImageMock.mockClear()

        const second = mountAvatar({ src: 'assets/a.png' })
        expect(styleOf(second.querySelector('.ico')!)).toContain('data:a')
        await settle()
        expect(getCharImageMock).not.toHaveBeenCalled()
    })

    test('a location change on a tile still looks the new location up', async () => {
        const props = $state({ src: 'assets/a.png' })
        mountAvatar(props)
        pending[0].resolve('background: url("data:a");')
        await settle()
        props.src = 'assets/b.png'
        flushSync()
        await settle()
        expect(pending.map((p) => p.loc)).toEqual(['assets/a.png', 'assets/b.png'])
    })

    test('the cache is bounded: the oldest location is looked up again once the limit is passed', async () => {
        for (let i = 0; i <= CHAR_LIST_AVATAR_CACHE_LIMIT; i++) {
            const target = mountAvatar({ src: `assets/${i}.png` })
            pending[pending.length - 1].resolve(`background: url("data:${i}");`)
            await settle()
            expect(styleOf(target.querySelector('.ico')!)).toContain(`data:${i}`)
            await unmount(mounted!.app as never)
            mounted!.target.remove()
            mounted = null
        }
        getCharImageMock.mockClear()
        mountAvatar({ src: `assets/${CHAR_LIST_AVATAR_CACHE_LIMIT}.png` })
        expect(getCharImageMock).not.toHaveBeenCalled()
        await unmount(mounted!.app as never)
        mounted!.target.remove()
        mounted = null
        mountAvatar({ src: 'assets/0.png' })
        await settle()
        expect(getCharImageMock).toHaveBeenCalledTimes(1)
    })

    test('a failed lookup is not remembered: a tile created again asks again', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        mountAvatar({ src: 'assets/a.png' })
        pending[0].reject(new Error('no such asset'))
        await settle()
        await unmount(mounted!.app as never)
        mounted!.target.remove()
        mounted = null
        getCharImageMock.mockClear()

        mountAvatar({ src: 'assets/a.png' })
        await settle()
        expect(getCharImageMock).toHaveBeenCalledTimes(1)
    })

    async function remountAndCountLookups(src: string): Promise<number> {
        await unmount(mounted!.app as never)
        mounted!.target.remove()
        mounted = null
        getCharImageMock.mockClear()
        mountAvatar({ src })
        await settle()
        return getCharImageMock.mock.calls.length
    }

    test('a style that carries a whole file is not retained: a tile created again resolves again', async () => {
        const target = mountAvatar({ src: 'assets/big.gif' })
        const big = `background: url("data:image/gif;base64,${'A'.repeat(CHAR_LIST_AVATAR_CACHE_MAX_LENGTH)}");`
        pending[0].resolve(big)
        await settle()
        expect(styleOf(target.querySelector('.ico')!)).toContain('base64')
        expect(await remountAndCountLookups('assets/big.gif')).toBe(1)
    })

    test('a style with an empty URL is not retained, but the empty style of hide-all-images is', async () => {
        mountAvatar({ src: 'assets/a.png' })
        pending[0].resolve('background: url("");background-size: cover;')
        await settle()
        expect(await remountAndCountLookups('assets/a.png')).toBe(1)

        pending[pending.length - 1].resolve('')
        await settle()
        expect(await remountAndCountLookups('assets/a.png')).toBe(0)
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
