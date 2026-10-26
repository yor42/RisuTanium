// @vitest-environment happy-dom

/**
 * The module editor's asset tab edits a module that the real `setDatabase`
 * installed, so its `assets` is an `AssetList` and is not reactive. Every edit
 * (rename, add, delete) must still re-render the rows and schedule a save, and
 * a rename must not reload the previews. Opening the editor, or its trigger
 * tab, must not write the module's optional flags or mark the block dirty.
 *
 * Mounts the REAL `ModuleMenu.svelte` on `DBState.db.modules[0]`, with the real
 * `setDatabase` and the real `registerDbChangeEffects` over a `$state`
 * stand-in for `DBState`. Titles beginning "guard:" pin behaviour that must be
 * preserved; every other test is a regression reproducer for the behaviour it
 * names.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

//#region module mocks

const apiMocks = vi.hoisted(() => ({
    getFileSrc: vi.fn(async (path: string) => 'src:' + path),
    saveAssetFromBlob: vi.fn(async (..._args: unknown[]) => 'assets/saved'),
    selectMultipleFileObjects: vi.fn(async (_exts: string[]) => null as File[] | null),
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
    selectMultipleFileObjects: apiMocks.selectMultipleFileObjects,
}) as unknown as typeof import('src/ts/util'))

// Modules the editor's imports reach pull in other globalApi exports; any name
// not listed is an inert stub.
vi.mock(import('src/ts/globalApi.svelte'), () => {
    const stub: Record<string, unknown> = {
        downloadFile: vi.fn(async () => {}),
        getFileSrc: apiMocks.getFileSrc,
        saveAssetFromBlob: apiMocks.saveAssetFromBlob,
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
import { registerDbChangeEffects } from 'src/ts/storage/dbChangeEffects.svelte'
import { AssetList, type AssetTuple } from 'src/ts/storage/assetList'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { RisuModule } from 'src/ts/process/modules'
import type { RisuPlugin } from 'src/ts/plugins/plugins.svelte'
import { language } from 'src/lang'
import { alertError } from 'src/ts/alert'
import ModuleMenu from './ModuleMenu.svelte'

//#region helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

function makeTuples(count: number): AssetTuple[] {
    const out: AssetTuple[] = []
    for (let i = 0; i < count; i++) {
        out.push([`name-${i}`, `assets/path-${i}`, 'png'])
    }
    return out
}

function makeModule(count: number): RisuModule {
    return { name: 'Module', description: '', id: 'id-module', lorebook: [], regex: [], trigger: [], assets: makeTuples(count) }
}

const V21_PLUGIN = { name: 'legacy', script: '', version: '2.1', enabled: true, arguments: {}, realArg: {}, customLink: [], argMeta: {} } as RisuPlugin

function makeTracker(): toSaveType {
    return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

interface Editor {
    target: HTMLElement
    tracker: toSaveType
}

let mounted: { target: HTMLElement, app: Record<string, unknown> }[] = []
let cleanup: (() => void) | undefined

/**
 * Installs a database holding `module` through the real `setDatabase`, registers
 * the dirty tracker, and mounts the editor on the module's basic-info tab.
 * Registration marks the modules block dirty once, so the flag is cleared after
 * registration and before the mount: whatever it reads afterwards was set by the
 * editor.
 */
function openEditor(module: RisuModule, options: { preview?: boolean, plugins?: RisuPlugin[] } = {}): Editor {
    setDatabase({
        modules: [module],
        plugins: options.plugins ?? [],
        useAdditionalAssetsPreview: options.preview ?? false,
        pluginCustomStorage: {},
    } as unknown as Database)
    const tracker = makeTracker()
    cleanup = $effect.root(() => {
        registerDbChangeEffects({ tracker, markChanged: vi.fn() })
    })
    flushSync()
    tracker.modules = false

    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ModuleMenu, { target, props: { currentModule: DBState.db.modules[0] } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return { target, tracker }
}

const tabButtons = (target: HTMLElement) => Array.from(target.querySelectorAll('div.flex.w-full > button')) as HTMLButtonElement[]

/** Installs a database holding one module through the real `setDatabase`, and mounts the editor on it at the asset tab. */
function openAssetTab(count: number, options: { preview?: boolean, plugins?: RisuPlugin[] } = {}): Editor {
    const editor = openEditor(makeModule(count), options)
    // The editor mounts on the basic-info tab and the mount itself writes nothing.
    expect(editor.tracker.modules).toBe(false)
    // The fixture already has an `assets` list, so opening the tab writes nothing
    // either; every flag the tests below read comes from the tab's own controls.
    tabButtons(editor.target)[4].click()
    flushSync()
    expect(editor.tracker.modules).toBe(false)
    return editor
}

const inputs = (target: HTMLElement) => Array.from(target.querySelectorAll('table input')) as HTMLInputElement[]
const addButton = (target: HTMLElement) => target.querySelector('table tr th button') as HTMLButtonElement
const trashButtons = (target: HTMLElement) => Array.from(target.querySelectorAll('table td + th button')) as HTMLButtonElement[]

/** Types into a row the way a keystroke does: an `input` event and no `change` or blur. */
function type(input: HTMLInputElement, value: string): void {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

const names = (target: HTMLElement) => inputs(target).map((i) => i.value)
const savedNames = () => DBState.db.modules[0].assets!.map((a) => a[0])

beforeEach(() => {
    apiMocks.getFileSrc.mockClear()
    apiMocks.saveAssetFromBlob.mockReset()
    apiMocks.saveAssetFromBlob.mockImplementation(async () => 'assets/saved')
    apiMocks.selectMultipleFileObjects.mockReset()
    vi.mocked(alertError).mockClear()
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    cleanup?.()
    cleanup = undefined
})

//#endregion

describe('the module asset editor on an installed AssetList', () => {
    test('the editor opens on an AssetList and lists every asset', () => {
        const { target } = openAssetTab(3)

        expect(DBState.db.modules[0].assets instanceof AssetList).toBe(true)
        expect(names(target)).toEqual(['name-0', 'name-1', 'name-2'])
    })

    test('a rename by input event alone updates the saved name and schedules a save', () => {
        const { target, tracker } = openAssetTab(3)

        type(inputs(target)[1], 'renamed')

        expect(tracker.modules).toBe(true)
        expect(savedNames()).toEqual(['name-0', 'renamed', 'name-2'])
        expect(names(target)).toEqual(['name-0', 'renamed', 'name-2'])
    })

    test('every keystroke of a rename is saved without waiting for change or blur', () => {
        const { target, tracker } = openAssetTab(2)

        type(inputs(target)[0], 'n')
        expect(savedNames()[0]).toBe('n')
        tracker.modules = false
        type(inputs(target)[0], 'ne')
        expect(savedNames()[0]).toBe('ne')
        expect(tracker.modules).toBe(true)
    })

    test('adding an asset adds a row and schedules a save', async () => {
        const { target, tracker } = openAssetTab(2)
        const picked = new File([new Uint8Array(1)], 'New.PNG')
        apiMocks.selectMultipleFileObjects.mockResolvedValue([picked])

        addButton(target).click()
        await settle()

        expect(apiMocks.saveAssetFromBlob).toHaveBeenCalledWith(picked, 'png')
        expect(inputs(target)).toHaveLength(3)
        expect(DBState.db.modules[0].assets![2]).toEqual(['New.PNG', 'assets/saved', 'png'])
        expect(tracker.modules).toBe(true)
        expect(DBState.db.modules[0].assets instanceof AssetList).toBe(true)
    })

    test('regression reproducer: a mixed pick adds the files within the limit in order, then shows one notice naming the refused ones', async () => {
        const { target } = openAssetTab(1)
        const big = (name: string, size: number) => {
            const file = new File([new Uint8Array(1)], name)
            Object.defineProperty(file, 'size', { value: size })
            Object.defineProperty(file, 'slice', { value: () => { throw new Error('an oversized file must not be read') } })
            return file
        }
        apiMocks.selectMultipleFileObjects.mockResolvedValue([
            new File([new Uint8Array(1)], 'ok1.png'),
            big('big1.mp4', 1024 * 1024 + 1),
            new File([new Uint8Array(1)], 'ok2.png'),
            big('big2.mp4', 1024 * 1024 * 2),
        ])

        addButton(target).click()
        await settle()

        expect(apiMocks.saveAssetFromBlob.mock.calls.map((call) => (call[0] as File).name)).toEqual(['ok1.png', 'ok2.png'])
        expect(savedNames()).toEqual(['name-0', 'ok1.png', 'ok2.png'])
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(alertError).toHaveBeenCalledWith('"big1.mp4" and "big2.mp4" are larger than the 1 MB limit, so they were not added.')
        expect(vi.mocked(alertError).mock.invocationCallOrder[0]).toBeGreaterThan(apiMocks.saveAssetFromBlob.mock.invocationCallOrder[1])
    })

    test('guard: choosing no file adds nothing and schedules no save', async () => {
        const { target, tracker } = openAssetTab(2)
        apiMocks.selectMultipleFileObjects.mockResolvedValue(null)

        addButton(target).click()
        await settle()

        expect(inputs(target)).toHaveLength(2)
        expect(tracker.modules).toBe(false)
    })

    test('two adds that overlap while their uploads are pending keep both assets', async () => {
        const { target } = openAssetTab(1)
        const uploads: ((path: string) => void)[] = []
        apiMocks.saveAssetFromBlob.mockImplementation(() => new Promise<string>((resolve) => { uploads.push(resolve) }))
        apiMocks.selectMultipleFileObjects
            .mockResolvedValueOnce([new File([new Uint8Array(1)], 'first.png')])
            .mockResolvedValueOnce([new File([new Uint8Array(1)], 'second.png')])

        addButton(target).click()
        await settle()
        addButton(target).click()
        await settle()
        expect(uploads).toHaveLength(2)

        uploads[1]('assets/second')
        await settle()
        uploads[0]('assets/first')
        await settle()

        expect(savedNames()).toEqual(['name-0', 'second.png', 'first.png'])
        expect(inputs(target)).toHaveLength(3)
    })

    test('deleting an asset removes its row and schedules a save', () => {
        const { target, tracker } = openAssetTab(3)

        trashButtons(target)[1].click()
        flushSync()

        expect(savedNames()).toEqual(['name-0', 'name-2'])
        expect(names(target)).toEqual(['name-0', 'name-2'])
        expect(tracker.modules).toBe(true)
    })

    test('renaming an asset and renaming it back saves both times and ends with the original block', () => {
        const { target, tracker } = openAssetTab(3)
        const original = JSON.stringify(DBState.db.modules)

        type(inputs(target)[0], 'B')
        expect(tracker.modules).toBe(true)
        expect(JSON.stringify(DBState.db.modules)).not.toBe(original)

        tracker.modules = false
        type(inputs(target)[0], 'name-0')
        expect(tracker.modules).toBe(true)
        expect(JSON.stringify(DBState.db.modules)).toBe(original)
    })

    test('an edited list is still an AssetList, and the other tuples are untouched', () => {
        const { target } = openAssetTab(3)

        type(inputs(target)[1], 'renamed')

        const assets = DBState.db.modules[0].assets!
        expect(assets instanceof AssetList).toBe(true)
        expect(assets[0]).toEqual(['name-0', 'assets/path-0', 'png'])
        expect(assets[1]).toEqual(['renamed', 'assets/path-1', 'png'])
    })

    test('reproducer: an enabled V2.1 plugin does not keep the list a plain array, an edit installs an AssetList', () => {
        const { target, tracker } = openAssetTab(3, { plugins: [V21_PLUGIN] })

        type(inputs(target)[0], 'renamed')

        expect(DBState.db.modules[0].assets instanceof AssetList).toBe(true)
        expect(savedNames()[0]).toBe('renamed')
        expect(tracker.modules).toBe(true)
    })
})

describe('the asset previews', () => {
    test('guard: a rename does not reload any preview', async () => {
        const { target } = openAssetTab(50, { preview: true })
        await settle()
        expect(apiMocks.getFileSrc).toHaveBeenCalledTimes(50)
        apiMocks.getFileSrc.mockClear()

        type(inputs(target)[3], 'renamed')
        await settle()

        expect(apiMocks.getFileSrc).not.toHaveBeenCalled()
    })

    test('guard: an added asset gets a preview', async () => {
        const { target } = openAssetTab(2, { preview: true })
        await settle()
        apiMocks.getFileSrc.mockClear()
        apiMocks.selectMultipleFileObjects.mockResolvedValue([new File([new Uint8Array(1)], 'New.png')])

        addButton(target).click()
        await settle()

        expect(apiMocks.getFileSrc).toHaveBeenCalledWith('assets/saved', 'whole')
        expect(target.querySelectorAll('table img')).toHaveLength(3)
    })
})

describe('the module editor on a module lacking its optional flags', () => {
    const bare = (): RisuModule => ({ name: 'Module', description: '', id: 'id-bare' })
    const checkbox = (target: HTMLElement, label: string) =>
        target.querySelector(`input[type="checkbox"][alt="${label}"]`) as HTMLInputElement

    test('opening the editor leaves the module unchanged and the modules block clean', () => {
        const before = JSON.stringify(bare())
        const { target, tracker } = openEditor(bare())

        expect(JSON.stringify(DBState.db.modules[0])).toBe(before)
        expect('hideIcon' in DBState.db.modules[0]).toBe(false)
        expect(tracker.modules).toBe(false)
        expect(checkbox(target, language.hideChatIcon).checked).toBe(false)
    })

    test('opening the trigger tab on a module that has its lists leaves lowLevelAccess unset and the block clean', () => {
        const { target, tracker } = openEditor({ ...bare(), lorebook: [], regex: [], trigger: [] })

        tabButtons(target)[3].click()
        flushSync()

        expect('lowLevelAccess' in DBState.db.modules[0]).toBe(false)
        expect(tracker.modules).toBe(false)
        expect(checkbox(target, language.lowLevelAccess).checked).toBe(false)
    })

    test('guard: toggling the hide-icon checkbox writes a boolean and marks the block dirty', () => {
        const { target, tracker } = openEditor(bare())
        const box = checkbox(target, language.hideChatIcon)

        box.click()
        flushSync()
        expect(DBState.db.modules[0].hideIcon).toBe(true)
        expect(tracker.modules).toBe(true)

        tracker.modules = false
        box.click()
        flushSync()
        expect(DBState.db.modules[0].hideIcon).toBe(false)
        expect(tracker.modules).toBe(true)
    })

    test('guard: toggling the low-level-access checkbox writes a boolean and marks the block dirty', () => {
        const { target, tracker } = openEditor({ ...bare(), lorebook: [], regex: [], trigger: [] })
        tabButtons(target)[3].click()
        flushSync()
        const box = checkbox(target, language.lowLevelAccess)

        box.click()
        flushSync()
        expect(DBState.db.modules[0].lowLevelAccess).toBe(true)
        expect(tracker.modules).toBe(true)

        tracker.modules = false
        box.click()
        flushSync()
        expect(DBState.db.modules[0].lowLevelAccess).toBe(false)
        expect(tracker.modules).toBe(true)
    })
})
