/**
 * `encodeRisuSaveParts` refuses a tree whose `modules` list holds a module stub at the call itself, before any piece is
 * requested, so every consumer of the pieces (the streamed export's gzip sink among them) gets the refusal without
 * having started anything.
 *
 * New-behaviour tests: they are red on the base that has no check in the wrapper and are pinned by two scratch mutants
 * (the wrapper line deleted; the check moved inside the generator, where it would only fire at the first `next()`). The
 * clean-tree row is a compatibility guard that passes before and after. Platform boundaries are mocked as in the other
 * risuSave tests.
 */
import { describe, expect, test, vi } from 'vitest'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
        removeItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: true }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))

import { encodeRisuSaveLegacy, encodeRisuSaveParts, encodeRisuSaveStreamed } from 'src/ts/storage/risuSave'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE, ModuleStubRefusal } from 'src/ts/storage/moduleStub'

const HEADER_LENGTH = 11

type Entry = Record<string, unknown>

const stubModule = (): Entry => ({ id: 'stub-id-1', name: 'Stub Module Name', [MODULE_STUB_KEY]: MODULE_STUB_VALUE })
const fullModule = (): Entry => ({ id: 'full-id-1', name: 'Full Module', lorebook: [], regex: [] })

function treeWith(modules: unknown[]): object {
    return { formatversion: 5, botPresets: [{ name: 'preset one' }], modules, characters: [{ chaId: 'cha-a', name: 'A' }] }
}

function refusalOf(run: () => unknown): ModuleStubRefusal {
    let caught: unknown
    try {
        run()
    } catch (error) {
        caught = error
    }
    expect(caught).toBeInstanceOf(ModuleStubRefusal)
    return caught as ModuleStubRefusal
}

describe('encodeRisuSaveParts and a module stub', () => {
    test('new behaviour: the call itself throws ModuleStubRefusal, with no piece requested', () => {
        // The expression below never calls next(): a check that lives in the generator body would not throw here.
        const refusal = refusalOf(() => encodeRisuSaveParts(treeWith([fullModule(), stubModule()])))
        expect(refusal.where).toBe('encodeRisuSaveParts')
        expect(refusal.what).toBe('modules')
        expect(refusal.moduleId).toBe('stub-id-1')
    })

    test('new behaviour: encodeRisuSaveStreamed gets the refusal from the parts encoder', () => {
        const refusal = refusalOf(() => encodeRisuSaveStreamed(treeWith([stubModule()])))
        expect(refusal.where).toBe('encodeRisuSaveParts')
    })

    test('guard: a tree with a normal module encodes byte-equal to the module\'s own whole encode', () => {
        const tree = treeWith([fullModule()])
        const pieces: Uint8Array[] = []
        for (const piece of encodeRisuSaveParts(tree)) {
            pieces.push(piece.slice())
        }
        const joined = Buffer.concat(pieces)
        const whole = Buffer.from(encodeRisuSaveLegacy(tree, 'noCompression').subarray(HEADER_LENGTH))
        expect(joined.equals(whole)).toBe(true)
    })
})
