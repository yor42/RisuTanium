// @vitest-environment happy-dom

/**
 * `RecentStrip.svelte`: the recent characters at the top of the shell sidebar.
 *
 * Invariants exercised here:
 * - The strip shows five avatars in the follow and wide overlays and four when docked, and always
 *   offers "All characters".
 * - Names sit under the avatars except in the follow overlay, where each avatar keeps a tooltip.
 * - The open character carries `aria-current`, even when it falls outside the first few by recency.
 * - A group is a strip member with a glyph; a tap hands the entry to the caller, never a direct switch.
 * - Keyboard focus on an avatar follows its character when the strip reorders or the character's
 *   slot object is replaced, and focus that went elsewhere is never taken back. Those scenarios
 *   live in `RecentStrip.scenarios.test-helpers.svelte.ts` and run here under the async
 *   scheduler the app ships.
 *
 * MOCKED: the avatar thumbnail lookup (`getCharImage`), since the fixtures carry no image.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../../ts/storage/database.svelte'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('src/ts/stores.svelte')
})

import { language } from 'src/lang'
import RecentStrip from './RecentStrip.svelte'
import { registerRecentStripFocusSuite } from './RecentStrip.scenarios.test-helpers.svelte'

type Entry = Database['characters'][number]
type Layout = 'follow' | 'wide' | 'docked'

function character(chaId: string, extra: Record<string, unknown> = {}): Entry {
    return { type: 'character', chaId, name: `Name ${chaId}`, image: '', chats: [], chatPage: 0, ...extra } as unknown as Entry
}

const many = (): Entry[] => ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => character(id))

let mounted: Array<Record<string, unknown>> = []
let target: HTMLElement

function render(props: { characters: Entry[], current?: Entry, layout: Layout, onpick?: (entry: Entry, event: MouseEvent) => void, onall?: () => void }) {
    target = document.createElement('div')
    document.body.append(target)
    mounted.push(mount(RecentStrip, {
        target,
        props: { current: undefined, onpick: () => {}, onall: () => {}, ...props },
    }) as Record<string, unknown>)
    flushSync()
}

afterEach(() => {
    for (const app of mounted) {
        unmount(app)
    }
    mounted = []
    flushSync()
    target?.remove()
})

const avatars = () => Array.from(target.querySelectorAll<HTMLButtonElement>('[data-part="strip-avatar"]'))

describe('how many avatars and whether they carry names', () => {
    test.each([['follow', 5], ['wide', 5], ['docked', 4]] as Array<[Layout, number]>)('TB6: the %s layout shows %i avatars', (layout, count) => {
        render({ characters: many(), layout })
        expect(avatars().length).toBe(count)
        expect(avatars().map((b) => b.getAttribute('aria-label'))).toEqual(many().slice(0, count).map((c) => c.name))
    })

    test('TB6: fewer characters than slots show only those', () => {
        render({ characters: many().slice(0, 2), layout: 'docked' })
        expect(avatars().length).toBe(2)
    })

    test('TB6: names show under the avatars in the wide and docked layouts', () => {
        for (const layout of ['wide', 'docked'] as const) {
            render({ characters: many(), layout })
            expect(target.querySelectorAll('[data-part="strip-name"]').length).toBe(avatars().length)
            target.remove()
        }
    })

    test('TB6: the follow layout shows no names and gives each avatar a tooltip', () => {
        render({ characters: many(), layout: 'follow' })
        expect(target.querySelectorAll('[data-part="strip-name"]').length).toBe(0)
        expect(avatars().map((b) => b.getAttribute('title'))).toEqual(many().slice(0, 5).map((c) => c.name))
    })

    test('TB6: All characters is always offered and calls back', () => {
        const onall = vi.fn()
        render({ characters: many(), layout: 'docked', onall })
        const all = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.getAttribute('aria-label') === language.chatShellAllCharacters)
        expect(all).toBeTruthy()
        all!.click()
        expect(onall).toHaveBeenCalledTimes(1)
    })
})

describe('the ring and the tap', () => {
    test('TB7: the open character is ringed with aria-current and no other is', () => {
        const list = many()
        render({ characters: list, current: list[2], layout: 'wide' })
        const current = avatars().filter((b) => b.getAttribute('aria-current') === 'true')
        expect(current.length).toBe(1)
        expect(current[0].getAttribute('aria-label')).toBe(list[2].name)
    })

    test('TB7: an open character outside the first slots still appears, ringed', () => {
        const list = many()
        render({ characters: list, current: list[6], layout: 'docked' })
        expect(avatars().length).toBe(4)
        const current = avatars().filter((b) => b.getAttribute('aria-current') === 'true')
        expect(current.map((b) => b.getAttribute('aria-label'))).toEqual([list[6].name])
    })

    test('TB7: a group is a member of the strip with a glyph, and a tap hands over the entry', () => {
        const onpick = vi.fn()
        const grp = { type: 'group', chaId: 'grp', name: 'The group', image: '', chats: [], chatPage: 0 } as unknown as Entry
        render({ characters: [character('a'), grp], layout: 'wide', onpick })
        const buttons = avatars()
        expect(buttons.length).toBe(2)
        expect(buttons[1].querySelector('[data-part="strip-group-glyph"]')).not.toBeNull()
        expect(buttons[0].querySelector('[data-part="strip-group-glyph"]')).toBeNull()
        buttons[1].click()
        expect(onpick).toHaveBeenCalledTimes(1)
        expect(onpick.mock.calls[0][0]).toBe(grp)
    })
})

registerRecentStripFocusSuite()
