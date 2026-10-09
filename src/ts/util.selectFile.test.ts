// @vitest-environment happy-dom

/**
 * The file pickers of `src/ts/util.ts`: nothing picked is a defined answer on
 * every platform. `selectFileByDom` resolves `[]` when the chooser is closed
 * without a choice (the `cancel` event) or confirmed empty; `selectSingleFile`
 * and `selectMultipleFile` turn that into `null`. On Android the multi-select
 * uses the web view's chooser, like the single select, and never the dialog
 * plugin or the path plugin's `basename`. The chooser is played by
 * `util.domPickerHarness.ts`; a pass says nothing about the native chooser.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { installDomPicker, settledWithin, type DomPicker } from './util.domPickerHarness'

const h = vi.hoisted(() => ({
    isTauri: true,
    os: 'android',
}))

const openDialog = vi.hoisted(() => vi.fn(async () => null))
const basename = vi.hoisted(() => vi.fn(async (path: string) => path.split(/[\\/]/).pop()))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: openDialog }))
vi.mock('@tauri-apps/api/path', () => ({ basename, appDataDir: vi.fn(), join: vi.fn() }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => h.os }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 14 },
    readFile: vi.fn(async () => new Uint8Array()),
    open: vi.fn(),
    exists: vi.fn(),
    mkdir: vi.fn(),
    remove: vi.fn(),
    readDir: vi.fn(),
    rename: vi.fn(),
    writeFile: vi.fn(),
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return h.isTauri },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ characters: [], allowAllExtentionFiles: false })),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: { subscribe: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/characters'), () => ({
    createBlankChar: vi.fn(),
    getCharImage: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({})),
}))

vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))

import { selectFileByDom, selectMultipleFile, selectSingleFile } from 'src/ts/util'

let picker: DomPicker

beforeEach(() => {
    h.isTauri = true
    h.os = 'android'
    openDialog.mockClear()
    basename.mockClear()
    picker = installDomPicker()
})

afterEach(() => {
    picker.restore()
})

function file(name: string, bytes: number[]): File {
    return new File([Uint8Array.from(bytes)], name)
}

describe.each([
    ['android', true, 'android'],
    ['desktop', true, 'windows'],
    ['web', false, 'android'],
] as const)('selectFileByDom on %s', (_name, isTauri, os) => {
    beforeEach(() => {
        h.isTauri = isTauri
        h.os = os
    })

    test('a closed chooser resolves with nothing and leaves no input behind', async () => {
        const pending = selectFileByDom(['png'], 'single')

        picker.cancel()

        expect(await settledWithin(pending)).toEqual({ pending: false, value: [] })
        expect(picker.leftInDocument()).toBe(false)
    })

    test('a chooser confirmed empty resolves with nothing and leaves no input behind', async () => {
        const pending = selectFileByDom(['png'], 'single')

        picker.emptyChange()

        expect(await settledWithin(pending)).toEqual({ pending: false, value: [] })
        expect(picker.leftInDocument()).toBe(false)
    })

    test('guard: picked files come back, filtered by extension, and the input is removed', async () => {
        const pending = selectFileByDom(['png'], 'multiple')

        picker.pick([file('a.png', [1]), file('b.txt', [2])])

        const result = await settledWithin(pending)
        expect(result.pending).toBe(false)
        expect(result.value?.map((item) => item.name)).toEqual(['a.png'])
        expect(picker.leftInDocument()).toBe(false)
    })

    test('a second event after the first settles changes nothing', async () => {
        const pending = selectFileByDom(['png'], 'single')

        picker.cancel()
        picker.pick([file('late.png', [1])])

        expect(await settledWithin(pending)).toEqual({ pending: false, value: [] })
    })
})

describe('selectFileByDom accept token and extension filter', () => {
    test('regression: on Android the chooser is opened for any file, so types without a MIME mapping are selectable', async () => {
        const pending = selectFileByDom(['png'], 'single')

        expect(picker.settings().accept).toBe('*/*')
        picker.cancel()
        await settledWithin(pending)
    })

    test('guard: on Android a pick with an extension outside the list is still dropped', async () => {
        const pending = selectFileByDom(['png'], 'single')

        picker.pick([file('notes.txt', [1])])

        expect(await settledWithin(pending)).toEqual({ pending: false, value: [] })
    })

    test('guard: on Android a pick with an extension in the list returns the file', async () => {
        const pending = selectFileByDom(['lorebook'], 'single')

        picker.pick([file('a.lorebook', [1])])

        const result = await settledWithin(pending)
        expect(result.value?.map((item) => item.name)).toEqual(['a.lorebook'])
    })

    test('guard: on Android an accept-all list applies no filter', async () => {
        const pending = selectFileByDom(['*'], 'single')

        picker.pick([file('notes.txt', [1])])

        const result = await settledWithin(pending)
        expect(result.value?.map((item) => item.name)).toEqual(['notes.txt'])
    })

    test.each([
        ['desktop', true, 'windows'],
        ['web', false, 'android'],
    ] as const)('guard: on %s the accept list still names the extensions', async (_name, isTauri, os) => {
        h.isTauri = isTauri
        h.os = os
        const pending = selectFileByDom(['png'], 'single')

        expect(picker.settings().accept).toBe('.png')
        picker.cancel()
        await settledWithin(pending)
    })

    test.each([
        ['desktop', true, 'windows'],
        ['web', false, 'android'],
        ['android', true, 'android'],
    ] as const)('regression: a dotted extension in the list matches the picked file on %s', async (_name, isTauri, os) => {
        h.isTauri = isTauri
        h.os = os
        const pending = selectFileByDom(['.json'], 'single')

        picker.pick([file('cache.json', [1])])

        const result = await settledWithin(pending)
        expect(result.value?.map((item) => item.name)).toEqual(['cache.json'])
    })

    test('regression: the list and the picked name are compared in lower case with one leading dot stripped', async () => {
        h.isTauri = false
        const pending = selectFileByDom(['.JSON', 'lorebook'], 'single')

        expect(picker.settings().accept).toBe('.json,.lorebook')
        picker.pick([file('X.Json', [1])])

        const result = await settledWithin(pending)
        expect(result.value?.map((item) => item.name)).toEqual(['X.Json'])
    })
})

describe('selectSingleFile', () => {
    test('a closed chooser answers null', async () => {
        const pending = selectSingleFile(['png'])

        picker.cancel()

        expect(await settledWithin(pending)).toEqual({ pending: false, value: null })
    })

    test('a chooser confirmed empty answers null', async () => {
        const pending = selectSingleFile(['png'])

        picker.emptyChange()

        expect(await settledWithin(pending)).toEqual({ pending: false, value: null })
    })

    test('a pick that the extension filter drops answers null', async () => {
        const pending = selectSingleFile(['png'])

        picker.pick([file('notes.txt', [1])])

        expect(await settledWithin(pending)).toEqual({ pending: false, value: null })
    })

    test('guard: a picked file answers its name and bytes', async () => {
        const pending = selectSingleFile(['png'])

        picker.pick([file('a.png', [4, 5, 6])])

        const result = await settledWithin(pending)
        expect(result.pending).toBe(false)
        const value = result.value
        expect(value?.name).toBe('a.png')
        expect(Array.from(value?.data ?? [])).toEqual([4, 5, 6])
    })
})

describe('selectMultipleFile on Android', () => {
    /** The web view chooser is the one that opened; the dialog plugin was not asked. */
    function expectWebViewChooser(count = 1): void {
        expect(openDialog).not.toHaveBeenCalled()
        expect(picker.inputs).toHaveLength(count)
    }

    test('uses the web view chooser: two picked files come back and neither plugin is called', async () => {
        const pending = selectMultipleFile(['png', 'webp'])

        expectWebViewChooser()
        picker.pick([file('a.png', [1]), file('b.webp', [2, 3])])

        const result = await settledWithin(pending)
        expect(result.pending).toBe(false)
        const value = result.value
        expect(value?.map((item) => item.name)).toEqual(['a.png', 'b.webp'])
        expect(Array.from(value?.[1].data ?? [])).toEqual([2, 3])
        expect(picker.settings().multiple).toBe(true)
        expect(openDialog).not.toHaveBeenCalled()
        expect(basename).not.toHaveBeenCalled()
    })

    test('a closed chooser answers null', async () => {
        const pending = selectMultipleFile(['png'])

        expectWebViewChooser()
        picker.cancel()

        expect(await settledWithin(pending)).toEqual({ pending: false, value: null })
    })

    test('a chooser confirmed empty, and a pick the extension filter drops, answer null', async () => {
        const empty = selectMultipleFile(['png'])
        expectWebViewChooser()
        picker.emptyChange()
        expect(await settledWithin(empty)).toEqual({ pending: false, value: null })

        const dropped = selectMultipleFile(['png'])
        expectWebViewChooser(2)
        picker.pick([file('notes.txt', [1])])
        expect(await settledWithin(dropped)).toEqual({ pending: false, value: null })
    })
})

describe('selectMultipleFile on the web', () => {
    test('a closed chooser answers null', async () => {
        h.isTauri = false
        const pending = selectMultipleFile(['png'])

        picker.cancel()

        expect(await settledWithin(pending)).toEqual({ pending: false, value: null })
    })
})
