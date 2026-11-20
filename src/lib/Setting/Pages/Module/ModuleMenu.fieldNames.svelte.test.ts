// @vitest-environment jsdom

/**
 * The text fields of the REAL `ModuleMenu.svelte` are named by their visible label (or a key when the
 * field has no visible label), with the label element listed first in `aria-describedby`. A label that
 * also holds a Help button names the field by the label text only. `Help` and `TextAreaInput` are the
 * real components with the highlighter mocked. The mock set is that of
 * `ModuleMenu.iconNames.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach } from 'vitest'
import { language } from 'src/lang'
import { controlDescription, controlName, unnamedControls } from 'src/lib/a11yNames.test-helpers'

//#region module mocks

vi.mock(import('src/ts/storage/tauriByteTransport'), async (importOriginal) => ({
    ...(await importOriginal()),
    isAndroidTransport: () => false,
    statStoredSize: async () => 0,
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isMobile: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn(async () => {}),
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
        disableHighlight: writable(false),
        popUpEditorStore: { open: false, value: '', mode: 'default', language: 'markdown' },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('src/ts/gui/guisize', () => ({
    textAreaSize: writable(0),
    textAreaTextSize: writable(1),
}))
vi.mock('src/ts/gui/highlight', () => ({
    highlighter: vi.fn(),
    getNewHighlightId: vi.fn(() => 1),
    removeHighlight: vi.fn(),
    AllCBS: [],
}))
vi.mock('src/ts/hotkey', () => ({
    hotkeyMatches: vi.fn(() => false),
}))

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

function mountEditor(): HTMLElement {
    const module: RisuModule = {
        name: 'Module', description: '', id: 'id-module', lorebook: [], regex: [], trigger: [],
        assets: [['clip', 'assets/c1.wav', 'wav']],
    }
    setDatabase({
        modules: [module],
        plugins: [],
        useAdditionalAssetsPreview: false,
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

const fieldsIn = (target: HTMLElement) => Array.from(target.querySelectorAll<HTMLElement>('input[type="text"], textarea, [role="textbox"]'))

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

//#endregion

describe('ModuleMenu field names', () => {
    test('regression reproducer: the general tab names name, description, namespace and the custom toggle fields by their labels', async () => {
        const target = mountEditor()
        const fields = fieldsIn(target)
        expect(fields.map(controlName)).toEqual([
            language.name, language.description, language.namespace, language.customPromptTemplateToggle,
        ])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: the namespace field is named by the label text alone, Help excluded', async () => {
        const target = mountEditor()
        const namespace = fieldsIn(target)[2]
        expect(controlName(namespace)).toBe(language.namespace)
        expect(controlDescription(namespace)).toBe(language.namespace)
        const label = document.getElementById(namespace.getAttribute('aria-labelledby')!)!
        expect(label.querySelector('button')).toBeNull()
        expect(target.querySelectorAll('button.help').length).toBeGreaterThan(0)
    })

    test('regression reproducer: the regex tab background field is named by its section label', async () => {
        const target = mountEditor()
        await openTab(target, 2)
        const fields = fieldsIn(target)
        expect(fields.length).toBe(1)
        expect(controlName(fields[0])).toBe(language.backgroundHTML)
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: the asset rename field is named by the name label', async () => {
        const target = mountEditor()
        await openTab(target, 4)
        const fields = fieldsIn(target)
        expect(fields.length).toBe(1)
        expect(controlName(fields[0])).toBe(language.name)
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })
})
