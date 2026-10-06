/**
 * `importModule` in `src/ts/process/modules.ts` for a `.risum` file, with the real `readModule`: which messages the
 * user is left with and what is added to the module list when the file is refused or fails.
 *
 * The real `modules.ts` runs on synthetic `.risum` bytes; everything it reaches around it is replaced by recorders.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    log: [] as string[],
    /** what the single alert slot holds: every alert function replaces it */
    last: 'none' as string,
    modules: [] as unknown[],
    file: { name: 'm.risum', data: new Uint8Array() } as { name: string, data: Uint8Array },
    saveFails: false,
    /** the registry's kinds seen at each asset save */
    busyAtSave: [] as string[][],
    busyKinds: (() => []) as () => string[],
}))

vi.mock('uuid', () => ({ v4: () => 'uuid' }))

vi.mock(import('src/ts/alert'), () => {
    const text = (msg: string | Error) => msg instanceof Error ? msg.message : String(msg)
    return {
        alertClear: vi.fn(() => { h.last = 'none' }),
        alertConfirm: vi.fn(async () => false),
        alertError: vi.fn((msg: string | Error) => { h.log.push('error:' + text(msg)); h.last = 'error:' + text(msg) }),
        alertModuleSelect: vi.fn(),
        alertNormal: vi.fn((msg: string) => { h.log.push('normal:' + msg); h.last = 'normal:' + msg }),
        alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
        alertWait: vi.fn((msg: string) => { h.last = 'wait:' + msg }),
    } as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(),
    getCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => ({ modules: h.modules })),
    setCurrentCharacter: vi.fn(),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    LocalWriter: class {},
    VirtualWriter: class {},
    downloadFile: vi.fn(),
    forageStorage: {},
    readImage: vi.fn(),
    saveAsset: vi.fn(async () => {
        h.busyAtSave.push(h.busyKinds())
        if (h.saveFails) throw new Error('storage full')
        return 'saved-asset'
    }),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/util'), () => ({
    checkPersonaBinded: vi.fn(),
    selectSingleFileObject: vi.fn(async () => new File([new Uint8Array(h.file.data)], h.file.name)),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(),
}) as unknown as typeof import('src/ts/media'))

// The RPack layer is the identity here, so a synthetic file is plain JSON.
vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(async (d: Uint8Array) => d),
    encodeRPack: vi.fn(async (d: Uint8Array) => d),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { modules: h.modules } } },
    HideIconStore: { set: vi.fn() },
    moduleBackgroundEmbedding: { set: vi.fn() },
    ReloadGUIPointer: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

vi.mock(import('src/ts/characterCards'), () => ({
    exportCharacterCard: vi.fn(),
    importCharacterProcess: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

import { importModule } from 'src/ts/process/modules'
import { language } from 'src/lang'
import { busyKinds, isBusy } from 'src/ts/process/memory/busyActions'

/** magic, version, length-prefixed main block, then the given tail (asset marks, then 0 for the end) */
function risum(opts: { magic?: number, version?: number, type?: string, assets?: number, tail?: number[] } = {}): Uint8Array {
    const main = Buffer.from(JSON.stringify({
        type: opts.type ?? 'risuModule',
        module: {
            name: 'Synthetic',
            description: 'd',
            id: 'x',
            assets: Array.from({ length: opts.assets ?? 0 }, (_, i) => ['a' + i, 'path' + i, 'png']),
        },
    }))
    const len = Buffer.alloc(4)
    len.writeUInt32LE(main.length, 0)
    const assetBlocks: number[] = []
    for (let i = 0; i < (opts.assets ?? 0); i++) {
        assetBlocks.push(1, 2, 0, 0, 0, 7, 7)
    }
    return new Uint8Array(Buffer.concat([
        Buffer.from([opts.magic ?? 111, opts.version ?? 0]),
        len,
        main,
        Buffer.from(opts.tail ?? [...assetBlocks, 0]),
    ]))
}

beforeEach(() => {
    h.log = []
    h.last = 'none'
    h.modules = []
    h.saveFails = false
    h.busyAtSave = []
    h.busyKinds = busyKinds
    h.file = { name: 'm.risum', data: risum() }
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('importModule with a .risum file', () => {
    test('a valid module is added once and shows no error (compatibility guard)', async () => {
        await importModule()
        expect(h.modules).toHaveLength(1)
        expect(h.modules[0]).toMatchObject({ name: 'Synthetic', id: 'uuid' })
        expect(h.log).toEqual([])
    })

    test('a valid module with assets saves every asset and is added once (compatibility guard)', async () => {
        h.file = { name: 'm.risum', data: risum({ assets: 3 }) }
        await importModule()
        expect(h.modules).toHaveLength(1)
        expect((h.modules[0] as { assets: string[][] }).assets.map((a) => a[1])).toEqual(['saved-asset', 'saved-asset', 'saved-asset'])
        expect(h.log).toEqual([])
    })

    test.each([
        ['a wrong magic byte', { magic: 0 }],
        ['an unsupported version', { version: 1 }],
        ['a wrong module type', { type: 'somethingElse' }],
        ['a bad block mark', { tail: [2] }],
    ])('%s is refused with one error and adds nothing to the module list', async (_label, opts) => {
        h.file = { name: 'm.risum', data: risum(opts) }
        await importModule()
        expect(h.modules).toEqual([])
        expect(h.log).toEqual(['error:' + language.errors.noData])
        expect(h.last).toBe('error:' + language.errors.noData)
    })

    test('assets that cannot be saved show the real reason as the last message and add nothing', async () => {
        h.file = { name: 'm.risum', data: risum({ assets: 2 }) }
        h.saveFails = true
        await importModule()
        expect(h.modules).toEqual([])
        expect(h.last).toBe('error:Failed to save 2 assets')
        expect(h.log).toEqual(['error:Failed to save 2 assets'])
    })

    test('the import is registered as busy during the asset saves and its entry ends after, also when the module is refused', async () => {
        h.file = { name: 'm.risum', data: risum({ assets: 2 }) }
        await importModule()
        expect(h.busyAtSave).toEqual([['import'], ['import']])
        expect(isBusy()).toBe(false)

        h.saveFails = true
        h.busyAtSave = []
        await importModule()
        expect(h.busyAtSave.length).toBeGreaterThan(0)
        expect(h.busyAtSave.every((kinds) => kinds.length === 1 && kinds[0] === 'import')).toBe(true)
        expect(isBusy()).toBe(false)

        h.file = { name: 'm.risum', data: risum({ magic: 0 }) }
        await importModule()
        expect(isBusy()).toBe(false)
    })

    test('a file that is not a module at all shows one error and adds nothing (compatibility guard)', async () => {
        h.file = { name: 'm.risum', data: new Uint8Array([111]) }
        await importModule()
        expect(h.modules).toEqual([])
        expect(h.log).toHaveLength(1)
        expect(h.last.startsWith('error:')).toBe(true)
    })
})
