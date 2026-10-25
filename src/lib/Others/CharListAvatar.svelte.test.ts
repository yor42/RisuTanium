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

import CharListAvatar, {
    CHAR_LIST_AVATAR_CACHE_MAX_ENTRIES,
    CHAR_LIST_AVATAR_CACHE_MAX_LENGTH,
    CHAR_LIST_AVATAR_CACHE_MAX_TOTAL,
    charListAvatarCacheTotalForTest,
    resetCharListAvatarCacheForTest,
} from './CharListAvatar.svelte'

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

    async function releaseMounted(): Promise<void> {
        await unmount(mounted!.app as never)
        mounted!.target.remove()
        mounted = null
    }

    // Resolves one location through a tile and releases the tile, as a windowed list does while scrolling.
    async function resolveAndRelease(src: string, style: string): Promise<void> {
        mountAvatar({ src })
        pending[pending.length - 1].resolve(style)
        await settle()
        await releaseMounted()
    }

    // A style of exactly `length` UTF-16 units that is unique to `i`.
    function styleOfLength(i: number, length: number): string {
        const head = `background: url("data:image/webp;base64,${i}-`
        const tail = '");'
        return head + 'A'.repeat(length - head.length - tail.length) + tail
    }

    async function lookupsOnRemount(src: string): Promise<number> {
        getCharImageMock.mockClear()
        mountAvatar({ src })
        await settle()
        const calls = getCharImageMock.mock.calls.length
        await releaseMounted()
        return calls
    }

    test('a scroll pass over 625 thumbnail-sized styles keeps every one: the first is not looked up again', async () => {
        for (let i = 0; i < 625; i++) {
            await resolveAndRelease(`assets/${i}.png`, styleOfLength(i, 13 * 1024))
        }
        expect(await lookupsOnRemount('assets/0.png')).toBe(0)
        expect(await lookupsOnRemount('assets/624.png')).toBe(0)
    })

    test('the size budget evicts the least recently used style, and a style hit since survives', async () => {
        const perEntry = CHAR_LIST_AVATAR_CACHE_MAX_LENGTH
        const fitting = CHAR_LIST_AVATAR_CACHE_MAX_TOTAL / perEntry
        for (let i = 0; i < fitting; i++) {
            await resolveAndRelease(`assets/${i}.png`, styleOfLength(i, perEntry))
        }
        expect(charListAvatarCacheTotalForTest()).toBe(CHAR_LIST_AVATAR_CACHE_MAX_TOTAL)
        expect(await lookupsOnRemount('assets/0.png')).toBe(0)

        await resolveAndRelease(`assets/${fitting}.png`, styleOfLength(fitting, perEntry))
        expect(charListAvatarCacheTotalForTest()).toBeLessThanOrEqual(CHAR_LIST_AVATAR_CACHE_MAX_TOTAL)
        expect(await lookupsOnRemount('assets/0.png')).toBe(0)
        expect(await lookupsOnRemount(`assets/${fitting}.png`)).toBe(0)
        expect(await lookupsOnRemount('assets/1.png')).toBe(1)
    })

    test('the entry cap evicts the least recently used style when styles are tiny', async () => {
        for (let i = 0; i <= CHAR_LIST_AVATAR_CACHE_MAX_ENTRIES; i++) {
            await resolveAndRelease(`assets/${i}.png`, `background: url("d:${i}");`)
        }
        expect(await lookupsOnRemount(`assets/${CHAR_LIST_AVATAR_CACHE_MAX_ENTRIES}.png`)).toBe(0)
        expect(await lookupsOnRemount('assets/1.png')).toBe(0)
        expect(await lookupsOnRemount('assets/0.png')).toBe(1)
    })

    test('the running total follows a key stored again with another length, and returns to zero on reset', async () => {
        const first = mountAvatar({ src: 'assets/a.png' })
        const firstApp = mounted!.app
        const second = document.createElement('div')
        document.body.appendChild(second)
        const secondApp = mount(CharListAvatar, { target: second, props: { src: 'assets/a.png' } as never }) as Record<string, unknown>
        flushSync()
        expect(pending.map((p) => p.loc)).toEqual(['assets/a.png', 'assets/a.png'])

        const long = styleOfLength(1, 5000)
        const short = styleOfLength(2, 300)
        pending[0].resolve(long)
        await settle()
        expect(charListAvatarCacheTotalForTest()).toBe(long.length)
        pending[1].resolve(short)
        await settle()
        expect(charListAvatarCacheTotalForTest()).toBe(short.length)
        expect(styleOf(first.querySelector('.ico')!)).toContain('1-')

        await unmount(secondApp as never)
        second.remove()
        await unmount(firstApp as never)
        first.remove()
        mounted = null

        expect(await lookupsOnRemount('assets/a.png')).toBe(0)
        resetCharListAvatarCacheForTest()
        expect(charListAvatarCacheTotalForTest()).toBe(0)
        expect(await lookupsOnRemount('assets/a.png')).toBe(1)
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

    test('reproducer: a style with a blob: URL is painted but not retained, since deleting its asset revokes the URL', async () => {
        const target = mountAvatar({ src: 'assets/a.mp4' })
        pending[0].resolve('background: url("blob:http://localhost/a1");background-size: cover;')
        await settle()
        expect(styleOf(target.querySelector('.ico')!)).toContain('blob:http://localhost/a1')
        expect(await remountAndCountLookups('assets/a.mp4')).toBe(1)
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

    // Abort siblings of the lookup tests above: the avatar abandons a lookup it no longer needs and leaves
    // no trace of it. The mock returns whatever the test settles, so it can model both the abort sentinel
    // and a plain string arriving after the abort.
    function signalOf(call: number): AbortSignal {
        return (getCharImageMock.mock.calls[call][2] as { signal: AbortSignal }).signal
    }

    test('the lookup carries an abort signal that is aborted when the tile goes away', async () => {
        mountAvatar({ src: 'assets/a.png' })
        expect(getCharImageMock.mock.calls[0][1]).toBe('thumbcss')
        expect(signalOf(0).aborted).toBe(false)

        await unmount(mounted!.app as never)
        mounted!.target.remove()
        mounted = null
        expect(signalOf(0).aborted).toBe(true)
    })

    test('a location change aborts the previous location lookup only', async () => {
        const props = $state({ src: 'assets/a.png' })
        mountAvatar(props)
        props.src = 'assets/b.png'
        flushSync()
        await settle()

        expect(signalOf(0).aborted).toBe(true)
        expect(signalOf(1).aborted).toBe(false)
    })

    test('a lookup abandoned by an unmount is not remembered even if a style still arrives', async () => {
        mountAvatar({ src: 'assets/a.png' })
        await unmount(mounted!.app as never)
        mounted!.target.remove()
        mounted = null

        pending[0].resolve('background: url("data:late");')
        await settle()
        expect(await lookupsOnRemount('assets/a.png')).toBe(1)
    })

    test('the aborted outcome is neither painted nor remembered nor logged', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const aborted = Symbol('aborted')
        getCharImageMock.mockImplementationOnce(() => Promise.resolve(aborted))
        const target = mountAvatar({ src: 'assets/a.png' })
        await settle()

        expect(styleOf(target.querySelector('.ico')!)).toBe('')
        expect(warn).not.toHaveBeenCalled()
        expect(await remountAndCountLookups('assets/a.png')).toBe(1)
    })

    test('a rejection that arrives after the abort is not logged', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        mountAvatar({ src: 'assets/a.png' })
        await unmount(mounted!.app as never)
        mounted!.target.remove()
        mounted = null

        pending[0].reject(new Error('gone'))
        await settle()
        expect(warn).not.toHaveBeenCalled()
    })

    test('the visibility prop reaches the lookup as a live function and a change of it looks nothing up again', async () => {
        let onScreen = false
        const props = $state({ src: 'assets/a.png', visible: () => onScreen })
        mountAvatar(props)
        const passed = (getCharImageMock.mock.calls[0][2] as { visible: () => boolean }).visible
        expect(passed()).toBe(false)
        onScreen = true
        expect(passed()).toBe(true)

        props.visible = () => false
        flushSync()
        await settle()
        expect(getCharImageMock).toHaveBeenCalledTimes(1)
        expect(passed()).toBe(false)
    })

    test('without a visibility prop the lookup counts as visible', () => {
        mountAvatar({ src: 'assets/a.png' })
        const passed = (getCharImageMock.mock.calls[0][2] as { visible: () => boolean }).visible
        expect(passed()).toBe(true)
    })
})
