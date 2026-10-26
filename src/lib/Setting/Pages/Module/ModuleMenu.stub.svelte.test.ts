// @vitest-environment happy-dom

/**
 * `ModuleMenu.svelte` renders nothing for a module stub, so no tab click can create body arrays on it; a resident
 * module keeps its tabs.
 *
 * Mounts the REAL `ModuleMenu.svelte` over a `$state` stand-in for `DBState`. Titles beginning "guard:" pin behaviour
 * that must be preserved; every other test is a regression reproducer for the behaviour it names.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach } from 'vitest'

//#region module mocks

const apiMocks = vi.hoisted(() => ({
    getFileSrc: vi.fn(async (path: string) => 'src:' + path),
    saveAsset: vi.fn(async (..._args: unknown[]) => 'assets/saved'),
    selectMultipleFile: vi.fn(async (_exts: string[]) => null as { name: string, data: Uint8Array }[] | null),
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

// Modules the editor's imports reach pull in other globalApi exports; any name
// not listed is an inert stub.
vi.mock(import('src/ts/globalApi.svelte'), () => {
    const stub: Record<string, unknown> = {
        downloadFile: vi.fn(async () => {}),
        getFileSrc: apiMocks.getFileSrc,
        saveAsset: apiMocks.saveAsset,
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

import type { RisuModule } from 'src/ts/process/modules'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE } from 'src/ts/storage/moduleStub'
import ModuleMenu from './ModuleMenu.svelte'

let mounted: { target: HTMLElement, app: Record<string, unknown> }[] = []

function open(module: RisuModule): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ModuleMenu, { target, props: { currentModule: module } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const tabButtons = (target: HTMLElement) => Array.from(target.querySelectorAll('div.flex.w-full > button')) as HTMLButtonElement[]

describe('the module editor form', () => {
    test('module-menu-renders-nothing-for-stub: a module stub shows no tabs and a click cannot create body arrays on it', () => {
        const stub = { name: 'Stubbed', description: '', id: 'id-stub', [MODULE_STUB_KEY]: MODULE_STUB_VALUE } as unknown as RisuModule
        const target = open(stub)
        expect(tabButtons(target)).toHaveLength(0)
        expect(target.querySelectorAll('button')).toHaveLength(0)
        expect(stub.lorebook).toBeUndefined()
        expect(stub.regex).toBeUndefined()
        expect(stub.trigger).toBeUndefined()
        expect(stub.assets).toBeUndefined()
    })

    test('guard: a resident module shows its tabs and a tab click creates its missing list', () => {
        const module = { name: 'Resident', description: '', id: 'id-res' } as unknown as RisuModule
        const target = open(module)
        const tabs = tabButtons(target)
        expect(tabs.length).toBeGreaterThan(1)
        tabs[1].click()
        flushSync()
        expect(Array.isArray(module.lorebook)).toBe(true)
    })
})
