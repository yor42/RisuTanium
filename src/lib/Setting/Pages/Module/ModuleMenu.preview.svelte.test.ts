// @vitest-environment happy-dom

/**
 * The asset previews of the REAL `ModuleMenu.svelte`: one classifier decides
 * both the element a row renders and the `use` of the URL it asks for.
 * `getFileSrc` is replaced by a stand-in of the Android gate: a `'whole'` use
 * of a path containing `huge` gets `''` (over the limit), a `'media'` use gets
 * the URL, and a call that names no use gets the URL, so a row that forgets to
 * say what its URL is for shows as a leaked image. The mock set is that of
 * `ModuleMenu.assets.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

//#region module mocks

const apiMocks = vi.hoisted(() => {
    const pending = new Map<string, (value: string) => void>()
    // Every call for a path in `holdPaths` hangs until released through `hung`.
    const holdPaths = new Set<string>()
    const hung = new Map<string, Array<() => void>>()
    const android = { on: false, sizes: new Map<string, number>() }
    return {
        pending,
        holdPaths,
        hung,
        android,
        // A path starting with `assets/pending` settles only when the test resolves it. A whole use joins the passed
        // budget synchronously, as the real `getFileSrc` does, and a refused row gets `''`.
        getFileSrc: vi.fn(async (path: string, use?: string, budget?: { admit(key: string): Promise<boolean> }) => {
            const admission = use === 'whole' && budget !== undefined ? budget.admit(path) : undefined
            if (path.startsWith('assets/pending')) {
                return await new Promise<string>((resolve) => { pending.set(path, resolve) })
            }
            if (holdPaths.has(path)) {
                await new Promise<void>((resolve) => { hung.set(path, [...(hung.get(path) ?? []), resolve]) })
            }
            if (admission !== undefined && !(await admission)) {
                return ''
            }
            return use === 'whole' && path.includes('huge') ? '' : 'src:' + path
        }),
    }
})

vi.mock(import('src/ts/storage/tauriByteTransport'), async (importOriginal) => ({
    ...(await importOriginal()),
    isAndroidTransport: () => apiMocks.android.on,
    statStoredSize: async (key: string) => apiMocks.android.sizes.get(key) ?? 0,
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    encryptBuffer: vi.fn(async (d: unknown) => d),
    selectSingleFile: vi.fn(async () => null),
    selectMultipleFile: vi.fn(async () => null),
    selectMultipleFileObjects: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/globalApi.svelte'), () => {
    const stub: Record<string, unknown> = {
        downloadFile: vi.fn(async () => {}),
        getFileSrc: apiMocks.getFileSrc,
        saveAssetFromBlob: vi.fn(async () => 'assets/saved'),
        pickedAssetLimitBytes: vi.fn(async () => 1024 * 1024),
        forageStorage: {
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
        },
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(),
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    defaultColorScheme: { bgcolor: '#000000' },
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    createHypaV3Preset: vi.fn((name: string, settings: unknown) => ({ name, settings })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/translator/presets'), () => ({
    normalizeTranslatorPresetState: vi.fn(),
}) as unknown as typeof import('src/ts/translator/presets'))

vi.mock(import('src/ts/polyfill'), () => ({
    safeStructuredClone: vi.fn((v: unknown) => JSON.parse(JSON.stringify(v))),
}) as unknown as typeof import('src/ts/polyfill'))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(-1),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/model/modellist'), async () => {
    const types = await import('src/ts/model/types')
    return {
        LLMFlags: types.LLMFlags,
        LLMFormat: types.LLMFormat,
        LLMTokenizer: types.LLMTokenizer,
    }
})

vi.mock('src/ts/rpack/rpack_js.js', () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => data),
    decodeRPack: vi.fn(async (data: Uint8Array) => data),
}))

vi.mock(import('src/ts/process/memory/busyActions'), () => ({
    beginBusy: vi.fn(() => ({ end: vi.fn() })),
}) as unknown as typeof import('src/ts/process/memory/busyActions'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/process/scripts'), () => ({
    exportRegex: vi.fn(),
    importRegex: vi.fn(),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock('src/lib/SideBars/LoreBook/LoreBookList.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/SideBars/Scripts/RegexList.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/SideBars/Scripts/TriggerList.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Others/Help.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/UI/GUI/TextAreaInput.svelte', () => ({ default: () => {} }))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import { setDatabase, type Database } from 'src/ts/storage/database.svelte'
import type { AssetTuple } from 'src/ts/storage/assetList'
import type { RisuModule } from 'src/ts/process/modules'
import ModuleMenu from './ModuleMenu.svelte'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

let mounted: { target: HTMLElement, app: Record<string, unknown> }[] = []

/** Mounts the editor on a module holding `assets`, at the asset tab, with the preview option on; returns the name cells of the rows. */
async function openRows(assets: AssetTuple[]): Promise<HTMLElement[]> {
    const module: RisuModule = { name: 'Module', description: '', id: 'id-module', lorebook: [], regex: [], trigger: [], assets }
    setDatabase({
        modules: [module],
        plugins: [],
        useAdditionalAssetsPreview: true,
        pluginCustomStorage: {},
    } as unknown as Database)
    flushSync()
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ModuleMenu, { target, props: { currentModule: DBState.db.modules[0] } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    const tabs = Array.from(target.querySelectorAll('div.flex.w-full > button')) as HTMLButtonElement[]
    tabs[4].click()
    await settle()
    return Array.from(target.querySelectorAll('table td.font-medium')) as HTMLElement[]
}

beforeEach(() => {
    apiMocks.pending.clear()
    apiMocks.holdPaths.clear()
    apiMocks.hung.clear()
    apiMocks.android.on = false
    apiMocks.android.sizes.clear()
    apiMocks.getFileSrc.mockClear()
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('which element a row renders', () => {
    test('guard: a small mp4 is a video, an mp3 an audio element, each with its URL', async () => {
        const cells = await openRows([['v', 'assets/clip', 'mp4'], ['a', 'assets/tune', 'mp3']])

        expect(cells[0].querySelector('video source')?.getAttribute('src')).toBe('src:assets/clip')
        expect(cells[1].querySelector('audio source')?.getAttribute('src')).toBe('src:assets/tune')
    })

    test('contract: video and audio ask for a media use, so an upper-case MP4 over the limit still plays', async () => {
        const cells = await openRows([['v', 'assets/huge-clip', 'MP4'], ['a', 'assets/huge-tune', 'MP3']])

        expect(apiMocks.getFileSrc).toHaveBeenCalledWith('assets/huge-clip', 'media')
        expect(apiMocks.getFileSrc).toHaveBeenCalledWith('assets/huge-tune', 'media')
        expect(cells[0].querySelector('video source')?.getAttribute('src')).toBe('src:assets/huge-clip')
        expect(cells[1].querySelector('audio source')?.getAttribute('src')).toBe('src:assets/huge-tune')
    })

    test.each(['mov', 'wav', 'webm', 'ogg'])('reproducer: a .%s row is a name box, with no image and no URL asked', async (ext) => {
        const cells = await openRows([['clip name', 'assets/media-file', ext]])

        expect(cells[0].querySelector('img')).toBeNull()
        expect(cells[0].textContent).toContain('clip name')
        expect(apiMocks.getFileSrc).not.toHaveBeenCalled()
    })

    test.each(['png', 'PNG', 'avif', 'svg'])('guard: a small .%s row is an image with its URL', async (ext) => {
        const cells = await openRows([['pic', 'assets/pic', ext]])

        expect(cells[0].querySelector('img')?.getAttribute('src')).toBe('src:assets/pic')
    })

    test('contract: an image row asks for a whole use', async () => {
        await openRows([['pic', 'assets/pic', 'png']])

        expect(apiMocks.getFileSrc).toHaveBeenCalledWith('assets/pic', 'whole', expect.anything())
    })

    test('reproducer: an image over the limit shows the name box instead of an image', async () => {
        const cells = await openRows([['big picture', 'assets/huge-pic', 'png']])

        expect(cells[0].querySelector('img')).toBeNull()
        expect(cells[0].textContent).toContain('big picture')
    })
})

describe('a row whose asset changes', () => {
    function rowCells(): HTMLElement[] {
        return Array.from(document.querySelectorAll('table td.font-medium')) as HTMLElement[]
    }

    test('reproducer: a row that was an over-limit video never shows its media URL in an image while the new URL is pending', async () => {
        const cells = await openRows([['v', 'assets/huge-clip', 'mp4']])
        expect(cells[0].querySelector('video source')?.getAttribute('src')).toBe('src:assets/huge-clip')

        DBState.db.modules[0].assets = [['p', 'assets/pending-pic', 'png']]
        await settle()

        expect(rowCells()[0].querySelectorAll('img').length).toBe(0)
        expect(rowCells()[0].querySelectorAll('source').length).toBe(0)

        apiMocks.pending.get('assets/pending-pic')?.('src:assets/pending-pic')
        await settle()

        expect(rowCells()[0].querySelector('img')?.getAttribute('src')).toBe('src:assets/pending-pic')
    })

    test('reproducer: a URL that settles after the row names another asset is ignored', async () => {
        await openRows([['a', 'assets/pending-a', 'png']])

        DBState.db.modules[0].assets = [['b', 'assets/pending-b', 'png']]
        await settle()
        apiMocks.pending.get('assets/pending-b')?.('src:assets/pending-b')
        await settle()
        apiMocks.pending.get('assets/pending-a')?.('src:assets/pending-a')
        await settle()

        expect(rowCells()[0].querySelector('img')?.getAttribute('src')).toBe('src:assets/pending-b')
    })
})

describe('the whole-read budget of the asset list on Android', () => {
    const MIB = 1024 * 1024
    // 60.55 MiB: one of them fits the 64 MiB budget of a list and a second does not.
    const BIG_BYTES = 63494348

    function rowCells(): HTMLElement[] {
        return Array.from(document.querySelectorAll('table td.font-medium')) as HTMLElement[]
    }

    function rowsOfSize(count: number, prefix: string, bytes: number): AssetTuple[] {
        apiMocks.android.on = true
        return Array.from({ length: count }, (_, i) => {
            apiMocks.android.sizes.set(`assets/${prefix}${i}`, bytes)
            return [`${prefix}${i}`, `assets/${prefix}${i}`, 'png'] as AssetTuple
        })
    }

    function countIn(cells: HTMLElement[]): { images: number, boxes: number } {
        return {
            images: cells.reduce((sum, cell) => sum + cell.querySelectorAll('img').length, 0),
            boxes: cells.reduce((sum, cell) => sum + cell.querySelectorAll('div.bg-slate-500').length, 0),
        }
    }

    test('reproducer: six 60.55 MiB images give one image on row 0 and five name boxes', async () => {
        const cells = await openRows(rowsOfSize(6, 'big', BIG_BYTES))

        expect(countIn(cells)).toEqual({ images: 1, boxes: 5 })
        expect(cells[0].querySelector('img')).not.toBeNull()
    })

    test('reproducer: twelve 6 MiB images give ten images and two name boxes', async () => {
        const cells = await openRows(rowsOfSize(12, 'mid', 6 * MIB))

        expect(countIn(cells)).toEqual({ images: 10, boxes: 2 })
    })

    test('guard: off Android every image shows', async () => {
        const rows = rowsOfSize(6, 'big', BIG_BYTES)
        apiMocks.android.on = false
        const cells = await openRows(rows)

        expect(countIn(cells)).toEqual({ images: 6, boxes: 0 })
    })

    test('reproducer: a superseded run that settles late does not store the URL its own budget admitted', async () => {
        apiMocks.android.on = true
        apiMocks.android.sizes.set('assets/a', 4 * MIB)
        apiMocks.android.sizes.set('assets/b', 60 * MIB)
        apiMocks.android.sizes.set('assets/c', 10 * MIB)
        apiMocks.holdPaths.add('assets/b')
        await openRows([['a', 'assets/a', 'png'], ['b', 'assets/b', 'png']])

        // Row 0 now names a 10 MiB file, so the new run's budget refuses row 1.
        apiMocks.holdPaths.delete('assets/b')
        DBState.db.modules[0].assets = [['c', 'assets/c', 'png'], ['b', 'assets/b', 'png']]
        await settle()
        for (const release of apiMocks.hung.get('assets/b') ?? []) release()
        await settle()

        expect(rowCells()[1].querySelector('img')).toBeNull()
        expect(rowCells()[1].querySelectorAll('div.bg-slate-500').length).toBe(1)
    })

    test('reproducer: turning the preview off supersedes the runs before it', async () => {
        apiMocks.android.on = true
        apiMocks.android.sizes.set('assets/a', 4 * MIB)
        apiMocks.android.sizes.set('assets/b', 60 * MIB)
        apiMocks.android.sizes.set('assets/c', 10 * MIB)
        apiMocks.holdPaths.add('assets/b')
        await openRows([['a', 'assets/a', 'png'], ['b', 'assets/b', 'png']])

        DBState.db.useAdditionalAssetsPreview = false
        await settle()
        DBState.db.modules[0].assets = [['c', 'assets/c', 'png'], ['b', 'assets/b', 'png']]
        await settle()
        for (const release of apiMocks.hung.get('assets/b') ?? []) release()
        await settle()
        DBState.db.useAdditionalAssetsPreview = true
        await settle()

        // Row 1 waits for its own run; the late URL of the run before the preview was turned off is not shown.
        expect(rowCells()[1].querySelector('img')).toBeNull()
        expect(rowCells()[1].querySelectorAll('div.bg-slate-500').length).toBe(0)
    })
})
