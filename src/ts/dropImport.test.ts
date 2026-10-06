/**
 * `importDroppedFile` in `src/ts/dropImport.ts`: what the user is left looking at after a file is dropped on the app.
 * Its collaborators are replaced by recorders; the alert functions all write one slot, like the real store.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    last: 'none' as string,
    log: [] as string[],
    modules: [] as unknown[],
    presets: [] as string[],
    ordered: 0,
    readModule: null as null | (() => Promise<unknown>),
    /** what the module reader was handed */
    moduleInput: undefined as unknown,
    importCard: null as null | (() => Promise<unknown>),
    importPreset: null as null | (() => Promise<unknown>),
}))

vi.mock(import('src/ts/alert'), () => {
    const text = (msg: string | Error) => msg instanceof Error ? msg.message : String(msg)
    return {
        alertError: vi.fn((msg: string | Error) => { h.log.push('error:' + text(msg)); h.last = 'error:' + text(msg) }),
        alertNormal: vi.fn((msg: string) => { h.log.push('normal:' + msg); h.last = 'normal:' + msg }),
    } as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/characterCards'), () => ({
    importCharacterProcess: vi.fn(async () => h.importCard?.()),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(() => { h.ordered++ }),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/process/modules'), () => ({
    readModule: vi.fn(async (input: unknown) => {
        h.moduleInput = input
        return h.readModule?.()
    }),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { modules: h.modules } } },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    importPreset: vi.fn(async (f: { name: string }) => {
        await h.importPreset?.()
        h.presets.push(f.name)
    }),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

import { importDroppedFile } from 'src/ts/dropImport'
import { ModuleRefusal } from 'src/ts/process/moduleRefusal'
import { language } from 'src/lang'

const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name)

beforeEach(() => {
    h.last = 'none'
    h.log = []
    h.modules = []
    h.presets = []
    h.ordered = 0
    h.readModule = async () => ({ name: 'Synthetic', id: 'x' })
    h.importCard = async () => 0
    h.importPreset = null
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('a dropped file that cannot be imported', () => {
    test('a refused module shows its reason as the last message, adds nothing, and the drop does not reject', async () => {
        h.readModule = async () => { throw new ModuleRefusal(language.errors.noData) }
        await expect(importDroppedFile(file('m.risum'))).resolves.toBeUndefined()
        expect(h.modules).toEqual([])
        expect(h.log).toEqual(['error:' + language.errors.noData])
    })

    test('a module whose assets cannot be saved shows the real reason as the last message and adds nothing', async () => {
        h.readModule = async () => { throw new Error('Failed to save 3 assets') }
        await expect(importDroppedFile(file('m.risum'))).resolves.toBeUndefined()
        expect(h.modules).toEqual([])
        expect(h.last).toBe('error:Failed to save 3 assets')
    })

    test('a preset that fails shows the reason as the last message and no success message', async () => {
        h.importPreset = async () => { throw new Error('bad preset') }
        await expect(importDroppedFile(file('p.risup'))).resolves.toBeUndefined()
        expect(h.presets).toEqual([])
        expect(h.last).toBe('error:bad preset')
        expect(h.log).toEqual(['error:bad preset'])
    })

    test('a card that fails shows the reason as the last message and the card order is not refreshed', async () => {
        h.importCard = async () => { throw new Error('Failed to save 3 assets') }
        await expect(importDroppedFile(file('c.charx'))).resolves.toBeUndefined()
        expect(h.last).toBe('error:Failed to save 3 assets')
        expect(h.ordered).toBe(0)
    })
})

describe('a dropped file that imports (compatibility guard)', () => {
    test('a module is added once and reports success', async () => {
        await importDroppedFile(file('M.RISUM'))
        expect(h.modules).toEqual([{ name: 'Synthetic', id: 'x' }])
        expect(h.last).toBe('normal:' + language.successImport)
    })

    test('a preset is imported and reports success', async () => {
        await importDroppedFile(file('p.risup'))
        expect(h.presets).toEqual(['p.risup'])
        expect(h.last).toBe('normal:' + language.successImport)
    })

    test('any other file goes to the card importer and refreshes the card order', async () => {
        await importDroppedFile(file('c.charx'))
        expect(h.ordered).toBe(1)
        expect(h.log).toEqual([])
    })
})

describe('a dropped module file (regression reproducer)', () => {
    test('is handed to the reader as a source over the dropped file, not as one buffer', async () => {
        const dropped = new File([new Uint8Array([1, 2, 3, 4, 5])], 'm.risum')

        await importDroppedFile(dropped)

        expect(h.moduleInput).not.toBeInstanceOf(Uint8Array)
        const source = h.moduleInput as { size: number, read: (start: number, end: number) => Promise<Uint8Array> }
        expect(source.size).toBe(5)
        expect(Array.from(await source.read(1, 3))).toEqual([2, 3])
    })
})
