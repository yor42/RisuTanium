/**
 * `realmModuleJson` in `src/ts/process/moduleUse.ts`: the Realm upload payload of a module row. The payload is a copy
 * tagged `risuModule`; the live slot is never written, the row (not its id) picks the module, a stub is loaded first, a
 * failed load resolves null after the user was told which module, and the usable module's release is always called.
 *
 * All rows are M: the helper is new, so before the change they fail at import. Their evidence is a named mutant applied
 * in a scratch copy (tag written onto the slot, module chosen by id, release skipped).
 *
 * The real `moduleUse.ts` runs; the loader behind `acquireModule` is a double that follows the real
 * contract (first holder of an id wins, a stub is replaced by a full body) and the surrounding services are recorders.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MODULE_STUB_KEY } from 'src/ts/storage/moduleStub'

type Row = Record<string, unknown> & { id: string, name: string }

const h = vi.hoisted(() => ({
    log: [] as string[],
    db: { modules: [] as unknown[] },
    /** how many times a usable module was released */
    released: 0,
    /** the full body the loader double installs for a stub id; null makes the load resolve null */
    bodies: new Map<string, unknown>(),
    loaderFails: false,
}))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn((msg: string | Error) => { h.log.push('error:' + (msg instanceof Error ? msg.message : String(msg))) }),
    alertModuleSelect: vi.fn(),
    alertNormal: vi.fn(),
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/store2/moduleAcquire'), async (importOriginal) => ({
    ...await importOriginal(),
    acquireModule: vi.fn(async (id: string) => {
        if (h.loaderFails) throw new Error('unreadable')
        const first = (h.db.modules as Row[]).find((row) => row.id === id)
        if (first === undefined) return null
        const body = h.bodies.get(id)
        const module = (body ?? first) as Row
        return { module, release: () => { h.released += 1 } }
    }),
}) as unknown as typeof import('src/ts/storage/store2/moduleAcquire'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(),
    getCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => h.db),
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
    saveAsset: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/util'), () => ({
    checkPersonaBinded: vi.fn(),
    selectFileByDom: vi.fn(async () => []),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: Uint8Array) => d),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(async (d: Uint8Array) => new Uint8Array(d)),
    encodeRPack: vi.fn(async (d: Uint8Array) => new Uint8Array(d)),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { get db() { return h.db } },
        HideIconStore: { set: vi.fn() },
        moduleBackgroundEmbedding: { set: vi.fn() },
        ReloadGUIPointer: writable(0),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

vi.mock(import('src/ts/characterCards'), () => ({
    exportCharacterCard: vi.fn(),
    importCharacterFile: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

import { realmModuleJson } from 'src/ts/process/moduleUse'
import { language } from 'src/lang'

const resident = (id: string, name: string, extra: Record<string, unknown> = {}): Row => ({ id, name, description: `about ${name}`, ...extra })
const stubOf = (id: string, name: string): Row => ({ id, name, [MODULE_STUB_KEY]: 1 })

beforeEach(() => {
    h.log = []
    h.db = { modules: [] }
    h.released = 0
    h.bodies = new Map()
    h.loaderFails = false
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('realmModuleJson', () => {
    test('M: the payload is the module tagged risuModule and the live slot is not written', async () => {
        const row = resident('a', 'Alpha', { lorebook: [] })
        h.db.modules = [row]
        const before = structuredClone(row)
        const payload = await realmModuleJson(0)
        expect(payload).not.toBeNull()
        expect(JSON.parse(payload!.json)).toEqual({ ...before, type: 'risuModule' })
        expect(row).toEqual(before)
        expect(Object.hasOwn(row, 'type')).toBe(false)
    })

    test('M: it returns the name, which the file name is built from', async () => {
        h.db.modules = [resident('a', 'Alpha')]
        expect((await realmModuleJson(0))?.name).toBe('Alpha')
    })

    test('M: a stub exports the loaded module, not the empty stand-in', async () => {
        h.db.modules = [stubOf('s', 'Stubbed')]
        h.bodies.set('s', resident('s', 'Stubbed', { lorebook: [{ comment: 'c' }], cjs: 'return 1' }))
        const payload = await realmModuleJson(0)
        const parsed = JSON.parse(payload!.json) as Record<string, unknown>
        expect(parsed.type).toBe('risuModule')
        expect(parsed.cjs).toBe('return 1')
        expect(parsed.lorebook).toEqual([{ comment: 'c' }])
        expect(Object.hasOwn(parsed, MODULE_STUB_KEY)).toBe(false)
    })

    test('M: the row picks the module, not its id: two modules sharing an id export their own bodies', async () => {
        h.db.modules = [resident('same', 'First'), resident('same', 'Second')]
        const payload = await realmModuleJson(1)
        expect(payload?.name).toBe('Second')
        expect((JSON.parse(payload!.json) as Row).description).toBe('about Second')
    })

    test('M: a load failure resolves null and tells the user which module', async () => {
        h.db.modules = [stubOf('s', 'Stubbed')]
        h.loaderFails = true
        expect(await realmModuleJson(0)).toBeNull()
        expect(h.log).toEqual(['error:' + language.moduleLoadFailed('Stubbed')])
    })

    test('M: an absent row resolves null without a message', async () => {
        h.db.modules = [resident('a', 'Alpha')]
        expect(await realmModuleJson(3)).toBeNull()
        expect(h.log).toEqual([])
    })

    test('M: a loaded stub is released once the payload is built', async () => {
        h.db.modules = [stubOf('s', 'Stubbed')]
        h.bodies.set('s', resident('s', 'Stubbed'))
        await realmModuleJson(0)
        expect(h.released).toBe(1)
    })

    test('M: the release also happens when the payload cannot be serialised', async () => {
        h.db.modules = [stubOf('s', 'Stubbed')]
        const cyclic: Row = resident('s', 'Stubbed')
        cyclic.self = cyclic
        h.bodies.set('s', cyclic)
        await expect(realmModuleJson(0)).rejects.toThrow()
        expect(h.released).toBe(1)
    })
})
