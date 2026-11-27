// @vitest-environment happy-dom

/**
 * The module editor's lorebook import and export keep their classic behaviour after sharing `parseLorebookImport` and
 * `lorebookExportBytes`: every picked file is parsed and pushed in turn, so a failing later file keeps the rows of the
 * earlier ones and shows the error text; the export writes the list verbatim. All titles are compatibility guards that
 * pass before and after the extraction.
 *
 * Mounts the REAL `ModuleMenu.svelte`; the REAL `lorebook.svelte` reader and `lorebookFile` producer are used.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'
import { Buffer } from 'buffer'

//#region module mocks

const apiMocks = vi.hoisted(() => ({
    selectMultipleFile: vi.fn(async (_exts: string[]) => null as { name: string, data: Uint8Array }[] | null),
    downloadFile: vi.fn(async (..._args: unknown[]) => true),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
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
    selectMultipleFile: apiMocks.selectMultipleFile,
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/globalApi.svelte'), () => {
    const stub: Record<string, unknown> = {
        downloadFile: apiMocks.downloadFile,
        getFileSrc: vi.fn(async (path: string) => 'src:' + path),
        saveAsset: vi.fn(async () => 'assets/saved'),
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
    alertNormal: apiMocks.alertNormal,
    alertError: apiMocks.alertError,
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
    const selection = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selection,
        selectedCharID: writable(-1),
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        SettingsMenuIndex: writable(-1),
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

vi.mock(import('src/ts/process/lorebook.svelte'), async (importOriginal) => {
    const original = await importOriginal()
    return { parseLorebookImport: original.parseLorebookImport, convertExternalLorebook: original.convertExternalLorebook }
})

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

import { language } from 'src/lang'
import type { RisuModule } from 'src/ts/process/modules'
import ModuleMenu from './ModuleMenu.svelte'

let mounted: { target: HTMLElement, app: Record<string, unknown> }[] = []

function open(module: RisuModule): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ModuleMenu, { target, props: { currentModule: module } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    const tabs = Array.from(target.querySelectorAll('div.flex.w-full > button')) as HTMLButtonElement[]
    tabs[1].click()
    flushSync()
    return target
}

const button = (target: HTMLElement, label: string) => target.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!

const file = (name: string, text: string) => ({ name, data: new Uint8Array(Buffer.from(text, 'utf-8')) })

const settle = async () => {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve()
    }
}

beforeEach(() => {
    apiMocks.selectMultipleFile.mockReset()
    apiMocks.downloadFile.mockClear()
    apiMocks.alertError.mockClear()
    apiMocks.alertNormal.mockClear()
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('the module editor lorebook import and export', () => {
    test('guard: two picked files are appended verbatim in order', async () => {
        const module = { name: 'M', description: '', id: 'm', lorebook: [{ key: 'kept' }] } as unknown as RisuModule
        const target = open(module)
        apiMocks.selectMultipleFile.mockResolvedValue([
            file('a.json', JSON.stringify({ type: 'risu', data: [{ key: 'a1', extra: 1 }, null] })),
            file('b.json', JSON.stringify({ type: 'risu', data: [{ key: 'b1' }] })),
        ])
        button(target, language.import).click()
        await settle()
        expect(module.lorebook).toEqual([{ key: 'kept' }, { key: 'a1', extra: 1 }, null, { key: 'b1' }])
        expect(apiMocks.alertError).not.toHaveBeenCalled()
    })

    test('guard: a bad second file keeps the first file rows and shows the error text', async () => {
        const module = { name: 'M', description: '', id: 'm', lorebook: [] } as unknown as RisuModule
        const target = open(module)
        apiMocks.selectMultipleFile.mockResolvedValue([
            file('a.json', JSON.stringify({ type: 'risu', data: [{ key: 'a1' }] })),
            file('b.json', '{nope'),
        ])
        button(target, language.import).click()
        await settle()
        expect(module.lorebook).toEqual([{ key: 'a1' }])
        expect(apiMocks.alertError).toHaveBeenCalledTimes(1)
        let expected = ''
        try {
            JSON.parse('{nope')
        } catch (error) {
            expected = `${error}`
        }
        expect(apiMocks.alertError.mock.calls[0][0]).toBe(expected)
    })

    test('guard: the export writes the list verbatim under the risu envelope', async () => {
        const list = [{ key: 'a', extra: { loreCache: [1] } }, null, 's']
        const module = { name: 'M', description: '', id: 'm', lorebook: list } as unknown as RisuModule
        const target = open(module)
        button(target, language.export).click()
        await settle()
        expect(apiMocks.downloadFile).toHaveBeenCalledTimes(1)
        const [name, bytes] = apiMocks.downloadFile.mock.calls[0] as [string, Uint8Array]
        expect(name).toBe('lorebook_export.json')
        expect(Buffer.from(bytes).toString('utf-8')).toBe(JSON.stringify({ type: 'risu', ver: 1, data: list }))
    })
})
