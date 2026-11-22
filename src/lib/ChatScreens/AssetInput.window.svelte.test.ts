// @vitest-environment jsdom

/**
 * The windowed grid of `AssetInput.svelte` (`grid`), the new chat screen's sticker picker: tiles sit in rows of a
 * fixed height, only the rows near the scroller's view are mounted, and only mounted tiles ask for a URL.
 *
 * The first two tests are regression reproducers: the picker without a grid mounts every tile and asks for every
 * URL, so a 1000-asset character fails both bounds. The others guard the grid's request bookkeeping and the
 * unchanged inline layout.
 *
 * MOCKED: geometry through `setWindowGeometryForTests` (jsdom has no layout: the scroller is 300 px tall at the top
 * of the viewport, and the segment's top is minus the scroll offset); `getFileSrc` (an immediate URL, or a
 * rejection for a path containing `broken`). jsdom gives the grid no width, so it keeps its fallback of 5 columns.
 */

import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { character } from 'src/ts/storage/database.svelte'

const hoisted = vi.hoisted(() => ({
    testDb: { db: {} as { characters: unknown[] } },
}))

vi.mock('src/ts/stores.svelte', () => ({
    DBState: hoisted.testDb,
}))

vi.mock('src/ts/storage/database.svelte', () => ({}))

vi.mock('src/ts/globalApi.svelte', () => ({
    getFileSrc: vi.fn(async (loc: string) => {
        if (loc.includes('broken')) {
            throw new Error('no url')
        }
        return `src:${loc}`
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
import { setWindowGeometryForTests } from 'src/ts/windowing/windowHost.svelte'

const TILE_PX = 72
const COLUMNS = 5

let scrollTop = 0
let frames: Array<() => void> = []
let box: HTMLElement
let app: ReturnType<typeof mount> | undefined

function makeCharacter(paths: string[]): character {
    return {
        type: 'character',
        chaId: 'c1',
        additionalAssets: paths.map((path, i) => [`a${i}`, path, 'png'] as [string, string, string]),
    } as unknown as character
}

function pathsOf(n: number, at: (i: number) => string = (i) => `assets/p${i}.png`): string[] {
    return Array.from({ length: n }, (_, i) => at(i))
}

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        await tick()
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
}

function runFrames(): void {
    const pending = frames
    frames = []
    for (const frame of pending) {
        frame()
    }
}

async function render(cha: character, grid: boolean): Promise<void> {
    hoisted.testDb.db = { characters: [cha] }
    app = mount(AssetInput, { target: box, props: { currentCharacter: cha, onSelect: vi.fn(), grid } })
    await settle()
    runFrames()
    await settle()
}

async function scrollTo(px: number): Promise<void> {
    scrollTop = px
    box.dispatchEvent(new Event('scroll'))
    runFrames()
    await settle()
    runFrames()
    await settle()
}

// The asset tiles in the DOM (the add button has no asset name).
function tiles(): HTMLButtonElement[] {
    return Array.from(box.querySelectorAll<HTMLButtonElement>('button[aria-label^="a"]'))
}

function requestedPaths(): string[] {
    return vi.mocked(getFileSrc).mock.calls.map((call) => call[0] as string)
}

beforeEach(() => {
    vi.mocked(getFileSrc).mockClear()
    scrollTop = 0
    frames = []
    box = document.body.appendChild(document.createElement('div'))
    box.style.overflowY = 'auto'
    box.style.height = '300px'
    setWindowGeometryForTests({
        rectOf: (element) => {
            if (element === box) {
                return { top: 0, height: 300 }
            }
            if (element.getAttribute('role') === 'list') {
                return { top: -scrollTop, height: 0 }
            }
            return { top: 0, height: 0 }
        },
        viewport: () => 800,
        scrollBy: () => {},
        schedule: (callback) => {
            frames.push(callback)
            return () => {
                frames = frames.filter((frame) => frame !== callback)
            }
        },
    })
})

afterEach(() => {
    if (app) {
        unmount(app)
        app = undefined
    }
    box.remove()
    setWindowGeometryForTests(undefined)
})

describe('AssetInput grid', () => {
    test('a 1000-asset character mounts a bounded band of tiles and asks URLs only for them', async () => {
        await render(makeCharacter(pathsOf(1000)), true)

        const shown = tiles()
        expect(shown.length).toBeGreaterThan(0)
        expect(shown.length).toBeLessThanOrEqual(100)
        // Every request is for a mounted tile, and every mounted image tile asked once.
        const mountedPaths = shown.map((tile) => `assets/p${Number((tile.getAttribute('aria-label') as string).slice(1))}.png`)
        expect(new Set(requestedPaths())).toEqual(new Set(mountedPaths))
        expect(requestedPaths()).toHaveLength(mountedPaths.length)
        // The tiles are laid out in rows of the column count, the add button first.
        const rows = box.querySelectorAll('[data-window-key]')
        expect(rows[0].querySelectorAll('button')).toHaveLength(COLUMNS)
        expect(rows[0].querySelector('button')?.getAttribute('aria-label')).not.toMatch(/^a\d/)
    })

    test('scrolling mounts the rows in view and asks for their URLs; a tile scrolled back is not asked again', async () => {
        await render(makeCharacter(pathsOf(1000)), true)
        const firstRequests = requestedPaths().length

        // Row 100 holds cells 500..504, which are assets 499..503.
        await scrollTo(100 * TILE_PX)
        const labels = tiles().map((tile) => tile.getAttribute('aria-label'))
        expect(labels).toContain('a499')
        expect(labels).not.toContain('a0')
        expect(requestedPaths()).toContain('assets/p499.png')
        expect(requestedPaths().length).toBeGreaterThan(firstRequests)
        expect(box.querySelector('img[alt="a499"]')?.getAttribute('src')).toBe('src:assets/p499.png')

        await scrollTo(0)
        expect(tiles().map((tile) => tile.getAttribute('aria-label'))).toContain('a0')
        expect(requestedPaths().filter((path) => path === 'assets/p0.png')).toHaveLength(1)
    })

    test('a URL that cannot be made shows the name box and is not asked again', async () => {
        await render(makeCharacter(pathsOf(20, (i) => i === 3 ? 'assets/broken3.png' : `assets/p${i}.png`)), true)

        const broken = box.querySelector('button[aria-label="a3"]') as HTMLElement
        expect(broken.querySelector('[data-part="asset-name-box"]')).not.toBeNull()
        await scrollTo(1)
        expect(requestedPaths().filter((path) => path === 'assets/broken3.png')).toHaveLength(1)
    })
})

describe('AssetInput inline (legacy chat screen)', () => {
    test('without a grid every tile is mounted and asks for its URL', async () => {
        await render(makeCharacter(pathsOf(150)), false)

        expect(tiles()).toHaveLength(150)
        expect(new Set(requestedPaths())).toEqual(new Set(pathsOf(150)))
        expect(box.querySelector('[data-window-key]')).toBeNull()
    })
})
