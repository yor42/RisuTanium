// @vitest-environment happy-dom

/**
 * The previews of `AssetInput.svelte`: one classifier decides both the element
 * a row renders and the `use` of the URL it asks for. `getFileSrc` is replaced
 * by a stand-in of the Android gate: a `'whole'` use of a path containing
 * `huge` gets `''` (over the limit), a `'media'` use gets the URL, and a call
 * that names no use gets the URL, so a row that forgets to say what its URL is
 * for shows as a leaked image.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { character } from 'src/ts/storage/database.svelte'

const hoisted = vi.hoisted(() => ({
    testDb: { db: {} as { characters: unknown[] } },
    pending: new Map<string, (value: string) => void>(),
}))

vi.mock('src/ts/stores.svelte', () => ({
    DBState: hoisted.testDb,
}))

vi.mock('src/ts/storage/database.svelte', () => ({}))

vi.mock('src/ts/globalApi.svelte', () => ({
    getFileSrc: vi.fn(async (loc: string, use?: string) => {
        if (loc.startsWith('assets/pending')) {
            return await new Promise<string>((resolve) => { hoisted.pending.set(loc, resolve) })
        }
        return use === 'whole' && loc.includes('huge') ? '' : `src:${loc}`
    }),
    saveAssetFromBlob: vi.fn(),
    pickedAssetLimitBytes: vi.fn(async () => 1024 * 1024),
}))

vi.mock('src/ts/util', () => ({
    selectMultipleFileObjects: vi.fn(),
}))

vi.mock('src/ts/alert', () => ({
    alertError: vi.fn(),
}))

vi.mock('src/ts/storage/characterSaveMarks', () => ({
    markCharacterForSave: vi.fn(),
}))

import AssetInput from './AssetInput.svelte'
import { getFileSrc } from 'src/ts/globalApi.svelte'

type Row = [string, string, string]

let mounted: ReturnType<typeof mount> | null = null
let host: HTMLElement | null = null
let listedCharacter: character | null = null

async function flush(): Promise<void> {
    await new Promise<void>((r) => setTimeout(r, 0))
    await new Promise<void>((r) => setTimeout(r, 0))
    flushSync()
}

/** Mounts the list for `rows` and returns the row buttons (the add button excluded). */
async function mountRows(rows: Row[]): Promise<HTMLButtonElement[]> {
    const char = $state({ type: 'character', chaId: 'c', additionalAssets: rows } as unknown as character)
    hoisted.testDb.db = { characters: [char] }
    listedCharacter = char
    host = document.createElement('div')
    document.body.appendChild(host)
    mounted = mount(AssetInput, { target: host, props: { currentCharacter: char, onSelect: () => {} } })
    await flush()
    return Array.from(host.querySelectorAll('button')).slice(1) as HTMLButtonElement[]
}

beforeEach(() => {
    hoisted.pending.clear()
    vi.mocked(getFileSrc).mockClear()
})

afterEach(() => {
    if (mounted !== null) {
        unmount(mounted)
        mounted = null
    }
    host?.remove()
    host = null
})

describe('which element a row renders', () => {
    test('guard: a small mp4 is a video with its URL', async () => {
        const buttons = await mountRows([['a', 'assets/clip1', 'mp4']])

        expect(buttons[0].querySelector('video source')?.getAttribute('src')).toBe('src:assets/clip1')
    })

    test('reproducer: an upper-case MP4 is a video with its URL', async () => {
        const buttons = await mountRows([['b', 'assets/clip2', 'MP4']])

        expect(buttons[0].querySelector('video source')?.getAttribute('src')).toBe('src:assets/clip2')
    })

    test('contract: an mp4 asks for a media use, so an MP4 over the limit still plays', async () => {
        const buttons = await mountRows([['a', 'assets/huge-clip', 'MP4']])

        expect(getFileSrc).toHaveBeenCalledWith('assets/huge-clip', 'media')
        expect(buttons[0].querySelector('video source')?.getAttribute('src')).toBe('src:assets/huge-clip')
    })

    test.each(['mov', 'wav', 'webm', 'ogg', 'WAV'])('reproducer: a .%s row is a name box, with no image and no URL asked', async (ext) => {
        const buttons = await mountRows([['song name', 'assets/media-file', ext]])

        expect(buttons[0].querySelector('img')).toBeNull()
        expect(buttons[0].querySelector('video')).toBeNull()
        expect(buttons[0].textContent).toContain('song name')
        expect(getFileSrc).not.toHaveBeenCalled()
    })

    test('reproducer: an mp3 row is the name box and asks for no URL', async () => {
        const buttons = await mountRows([['tune', 'assets/tune', 'mp3']])

        expect(buttons[0].querySelector('img')).toBeNull()
        expect(buttons[0].textContent).toContain('tune')
        expect(getFileSrc).not.toHaveBeenCalled()
    })

    test.each(['png', 'PNG', 'avif', 'svg', 'webp'])('guard: a small .%s row is an image with its URL', async (ext) => {
        const buttons = await mountRows([['pic', 'assets/pic', ext]])

        expect(buttons[0].querySelector('img')?.getAttribute('src')).toBe('src:assets/pic')
    })

    test('contract: an image row asks for a whole use', async () => {
        await mountRows([['pic', 'assets/pic', 'png']])

        expect(getFileSrc).toHaveBeenCalledWith('assets/pic', 'whole')
    })

    test('reproducer: an image over the limit shows the name box instead of an image', async () => {
        const buttons = await mountRows([['big picture', 'assets/huge-pic', 'png']])

        expect(buttons[0].querySelector('img')).toBeNull()
        expect(buttons[0].textContent).toContain('big picture')
    })

    test('guard: an image whose URL is still being made shows nothing, and then the image', async () => {
        const buttons = await mountRows([['pic', 'assets/pending-pic', 'png']])

        expect(buttons[0].querySelector('img')).toBeNull()
        expect(buttons[0].textContent?.trim()).toBe('')

        hoisted.pending.get('assets/pending-pic')?.('src:assets/pending-pic')
        await flush()

        expect(buttons[0].querySelector('img')?.getAttribute('src')).toBe('src:assets/pending-pic')
    })
})

describe('a row whose asset changes', () => {
    test('reproducer: a row that was an over-limit video never shows its media URL in an image while the new URL is pending', async () => {
        await mountRows([['v', 'assets/huge-clip', 'mp4']])
        expect(host?.querySelector('video source')?.getAttribute('src')).toBe('src:assets/huge-clip')

        listedCharacter!.additionalAssets = [['p', 'assets/pending-pic', 'png']]
        flushSync()

        expect(host?.querySelectorAll('img').length).toBe(0)
        expect(host?.querySelectorAll('source').length).toBe(0)

        hoisted.pending.get('assets/pending-pic')?.('src:assets/pending-pic')
        await flush()

        expect(host?.querySelector('img')?.getAttribute('src')).toBe('src:assets/pending-pic')
    })

    test('reproducer: a URL that settles after the row names another asset is ignored', async () => {
        await mountRows([['a', 'assets/pending-a', 'png']])

        listedCharacter!.additionalAssets = [['b', 'assets/pending-b', 'png']]
        flushSync()
        hoisted.pending.get('assets/pending-b')?.('src:assets/pending-b')
        await flush()
        hoisted.pending.get('assets/pending-a')?.('src:assets/pending-a')
        await flush()

        expect(host?.querySelector('img')?.getAttribute('src')).toBe('src:assets/pending-b')
    })
})
