// @vitest-environment jsdom

/**
 * The lorebook, regex and asset toolbars of the REAL `ModuleMenu.svelte`: every icon-only control
 * has an accessible name, every Lucide glyph is hidden from assistive technology and the screen
 * uses scheme tokens instead of Tailwind default palette classes. The mock set is that of
 * `ModuleMenu.preview.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach } from 'vitest'
import { language } from 'src/lang'
import { controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'

//#region module mocks

vi.mock(import('src/ts/storage/tauriByteTransport'), async (importOriginal) => ({
    ...(await importOriginal()),
    isAndroidTransport: () => false,
    statStoredSize: async () => 0,
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
        getFileSrc: vi.fn(async (path: string) => 'src:' + path),
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
import type { RisuModule } from 'src/ts/process/modules'
import ModuleMenu from './ModuleMenu.svelte'

//#region helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

let mounted: { target: HTMLElement, app: Record<string, unknown> }[] = []

/** Mounts the editor on a module with one wav asset (rendered as the name box), with the preview option on. */
function mountEditor(): HTMLElement {
    const module: RisuModule = {
        name: 'Module', description: '', id: 'id-module', lorebook: [], regex: [], trigger: [],
        assets: [['clip', 'assets/c1.wav', 'wav']],
    }
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
    return target
}

async function openTab(target: HTMLElement, index: number): Promise<void> {
    const tabs = Array.from(target.querySelectorAll('div.flex.w-full > button')) as HTMLButtonElement[]
    tabs[index].click()
    await settle()
}

const buttonsIn = (target: HTMLElement, selector: string) => Array.from(target.querySelectorAll(`${selector} button`))

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

//#endregion

describe('ModuleMenu toolbars', () => {
    test('regression reproducer: the lorebook toolbar buttons are named and their glyphs hidden', async () => {
        const target = mountEditor()
        await openTab(target, 1)
        expect(buttonsIn(target, 'div.text-textcolor2.mt-2.flex').map(controlName)).toEqual([
            language.add, language.export, language.chatShellNewFolder, language.import,
        ])
        expect(unnamedControls(target)).toEqual([])
        expect(exposedIcons(target)).toEqual([])
        expect(paletteClasses(target)).toEqual([])
    })

    test('regression reproducer: the regex toolbar buttons are named and their glyphs hidden', async () => {
        const target = mountEditor()
        await openTab(target, 2)
        expect(buttonsIn(target, 'div.text-textcolor2.mt-2.flex.gap-2').map(controlName)).toEqual([
            language.add, language.export, language.import,
        ])
        expect(unnamedControls(target)).toEqual([])
        expect(exposedIcons(target)).toEqual([])
        expect(paletteClasses(target)).toEqual([])
    })

    test('regression reproducer: the asset add and remove buttons are named, the name box is a scheme tile and every glyph is hidden', async () => {
        const target = mountEditor()
        await openTab(target, 4)
        expect(buttonsIn(target, 'th').map(controlName)).toEqual([language.add, language.remove])
        expect(target.querySelectorAll('[data-part="asset-name-box"]').length).toBe(1)
        expect(unnamedControls(target)).toEqual([])
        expect(exposedIcons(target)).toEqual([])
        expect(paletteClasses(target)).toEqual([])
    })

    test('regression reproducer: the remove hover uses the danger token', async () => {
        const target = mountEditor()
        await openTab(target, 4)
        expect(buttonsIn(target, 'th')[1].classList.contains('hover:text-draculared')).toBe(true)
    })
})
