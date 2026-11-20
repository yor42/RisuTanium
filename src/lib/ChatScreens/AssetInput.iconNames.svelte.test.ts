// @vitest-environment jsdom

/**
 * The REAL `AssetInput.svelte`: the add button and every asset button, whatever the row renders
 * (name box, video, image, a URL still being made, a withheld URL), is named by the asset's own name,
 * every Lucide glyph is hidden, and the list uses theme tokens. Rows are the `[name, path, extension]`
 * tuples the add path pushes.
 *
 * MOCKED: the module set of `AssetInput.preview.svelte.test.ts`, with `getFileSrc` the same stand-in of
 * the Android gate: a path under `assets/pending` never settles, and a `whole` use of a `huge` path gets `''`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { character } from 'src/ts/storage/database.svelte'

const hoisted = vi.hoisted(() => ({
    testDb: { db: {} as { characters: unknown[] } },
}))

vi.mock('src/ts/storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    isAndroidTransport: () => false,
    statStoredSize: async () => 0,
}))

vi.mock('src/ts/stores.svelte', () => ({
    DBState: hoisted.testDb,
}))

vi.mock('src/ts/storage/database.svelte', () => ({}))

vi.mock('src/ts/globalApi.svelte', () => ({
    getFileSrc: vi.fn(async (loc: string, use?: string, budget?: { admit(key: string): Promise<boolean> }) => {
        const admission = use === 'whole' && budget !== undefined ? budget.admit(loc) : undefined
        if (loc.startsWith('assets/pending')) {
            return await new Promise<string>(() => {})
        }
        if (admission !== undefined && !(await admission)) {
            return ''
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

import { language } from 'src/lang'
import { controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import AssetInput from './AssetInput.svelte'

type Row = [string, string, string]

const ROWS: Row[] = [
    ['song', 'assets/s1.mp3', 'mp3'],
    ['clip', 'assets/clip1.mp4', 'mp4'],
    ['pic', 'assets/p1.png', 'png'],
    ['wait', 'assets/pending1.png', 'png'],
    ['big', 'assets/huge1.png', 'png'],
]

let mounted: ReturnType<typeof mount> | null = null
let host: HTMLElement | null = null

async function mountRows(): Promise<HTMLElement> {
    const char = $state({ type: 'character', chaId: 'c', additionalAssets: ROWS } as unknown as character)
    hoisted.testDb.db = { characters: [char] }
    host = document.createElement('div')
    document.body.appendChild(host)
    mounted = mount(AssetInput, { target: host, props: { currentCharacter: char, onSelect: () => {} } })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    flushSync()
    return host
}

afterEach(() => {
    if (mounted !== null) {
        unmount(mounted)
        mounted = null
    }
    host?.remove()
    host = null
})

describe('AssetInput accessible names', () => {
    test('regression reproducer: the add button and every asset row button are named and every glyph hidden', async () => {
        const root = await mountRows()
        expect(unnamedControls(root)).toEqual([])
        expect(exposedIcons(root)).toEqual([])
    })

    test('regression reproducer: each asset button is named by the asset name and the add button by Add', async () => {
        const root = await mountRows()
        const buttons = Array.from(root.querySelectorAll('button'))
        expect(buttons.map(controlName)).toEqual([language.add, ...ROWS.map((row) => row[0])])
    })

    test('regression reproducer: the add button and the name box use theme tokens', async () => {
        const root = await mountRows()
        expect(paletteClasses(root)).toEqual([])
        const add = root.querySelector('button')!
        expect(add.classList.contains('hover:bg-darkbutton')).toBe(true)
        const boxes = root.querySelectorAll('[data-part="asset-name-box"]')
        expect(boxes.length).toBeGreaterThan(0)
        for (const box of Array.from(boxes)) {
            expect(box.classList.contains('bg-darkbutton')).toBe(true)
        }
    })
})
