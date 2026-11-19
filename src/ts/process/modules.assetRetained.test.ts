/**
 * The retained-paths field of a module through the module file formats. The field names this device's files, so a module
 * file never carries it and an incoming file never supplies it:
 * - export: the `.risum` main block (`exportModuleLegacy`, which is also the CharX `module.risum`) and the Realm payload
 *   (`realmModuleJson`) are written from a copy, so the field is absent and the live module still holds it;
 * - import: `.risum` (`scanRisum`) and `.json` (`importModuleJson`) drop it before the module is placed, whether it came
 *   from bytes written by the build at 1cfa819ee (which wrote it) or from a payload shaped like the Realm export;
 * - replace: the installed module's field stays, a stub target is loaded before the write, and a target that cannot be
 *   loaded ends the import with nothing written.
 *
 * Every test is a feature guard (the field did not exist before). What runs for real: `exportModuleLegacy`,
 * `snapshotModuleForRisum`, the `.risum` stream writer and scanner, `readModule`, `importModule`, `commitModule`,
 * `placeModule`, `applyModulePlacement`, `realmModuleJson` and `isModuleStub`. What is replaced: the database list, asset
 * storage, alerts, the module loader (it records its call and installs a body, or fails) and the card importer. The
 * RPack layer applies the permutation the app ships (`rpack_map.bin`), so fixture bytes decode as real ones.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    log: [] as string[],
    calls: [] as string[],
    modules: [] as unknown[],
    file: null as unknown as File,
    /** What the stubbed module loader does for a target id: install the body, or leave the stub. */
    load: (async () => ({ kind: 'loaded' })) as (id: string) => Promise<{ kind: string }>,
}))

vi.mock('uuid', () => ({ v4: () => 'uuid' }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/alert'), () => {
    const text = (msg: string | Error) => msg instanceof Error ? msg.message : String(msg)
    return {
        alertClear: vi.fn(),
        alertConfirm: vi.fn(async () => false),
        alertError: vi.fn((msg: string | Error) => { h.log.push('error:' + text(msg)) }),
        alertModuleSelect: vi.fn(),
        alertNormal: vi.fn((msg: string) => { h.log.push('normal:' + msg) }),
        alertSelect: vi.fn(async () => '0'),
        alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
        alertWait: vi.fn(),
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
    AppendableBuffer: class {
        parts: Uint8Array[] = []
        append(b: Uint8Array) { this.parts.push(b) }
        get buffer() { return Buffer.concat(this.parts) }
    },
    AssetSourceChangedError: class AssetSourceChangedError extends Error {},
    saveAssetFromPieces: vi.fn(async () => 'piece.png'),
    LocalWriter: class {},
    VirtualWriter: class {},
    downloadFile: vi.fn(),
    forageStorage: {},
    readImage: vi.fn(async () => undefined),
    saveAsset: vi.fn(async () => 'saved.png'),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/util'), () => ({
    checkPersonaBinded: vi.fn(),
    selectFileByDom: vi.fn(async () => [h.file]),
    sleep: vi.fn(async () => undefined),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: Uint8Array) => d),
}) as unknown as typeof import('src/ts/media'))

// The permutation the app ships, read from its map file, so bytes written by another build decode as they would in the app.
vi.mock(import('src/ts/rpack/rpack_js'), async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const map = new Uint8Array(readFileSync(join(process.cwd(), 'src/ts/rpack/rpack_map.bin')))
    const apply = (table: Uint8Array, data: Uint8Array) => Uint8Array.from(data, (byte) => table[byte])
    return {
        encodeRPack: vi.fn(async (data: Uint8Array) => apply(map.subarray(0, 256), data)),
        decodeRPack: vi.fn(async (data: Uint8Array) => apply(map.subarray(256, 512), data)),
    } as unknown as typeof import('src/ts/rpack/rpack_js')
})

vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { get db() { return { modules: h.modules } } },
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
    importCharacterFile: vi.fn(async () => ({ kind: 'declined' })),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/process/moduleLoader'), () => ({
    loadModuleStubsOf: vi.fn(async (id: string) => {
        h.calls.push('load:' + id)
        return await h.load(id)
    }),
}) as unknown as typeof import('src/ts/process/moduleLoader'))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeRPack } from 'src/ts/rpack/rpack_js'
import { exportModuleLegacy, importModule as importModuleOnCard, type RisuModule } from 'src/ts/process/modules'
import { language } from 'src/lang'
import { resetTaskHostForTests } from 'src/ts/alertTask.svelte'
import { answerImportCard, type ImportCard } from 'src/ts/process/tests/answerImportCard'
import { realmModuleJson } from 'src/ts/process/moduleUse'
import { stubModule } from 'src/ts/studio/studioFixtures.test-helpers'
import { ASSET_FOLDER_KEY, ASSET_RETAINED_KEY } from 'src/ts/studio/assets/assetOwnerKeys'

type Obj = Record<string, unknown>

const KEPT = [['gone', 'assets/K.png']]
const FOLDERS = { v: 1, additional: { order: ['Faces'], of: [['smile', 'Faces']] } }

const fixture = JSON.parse(readFileSync(
    join(process.cwd(), 'src/ts/storage/tests/store2/fixtures/laneD-1cfa819ee/risum-main-block.json'), 'utf8',
)) as { module: Obj, risumBase64: string }
const fixtureBytes = () => Uint8Array.from(Buffer.from(fixture.risumBase64, 'base64'))

function moduleOf(extra: Obj = {}): RisuModule {
    return { id: 'module-1', name: 'Retained Module', description: 'd', lorebook: [], ...extra } as RisuModule
}

/** The module JSON a `.risum` main block holds, read straight from the bytes. */
async function mainBlockOf(bytes: Uint8Array): Promise<{ type: string, module: Obj }> {
    const length = bytes[2] + bytes[3] * 0x100 + bytes[4] * 0x10000 + bytes[5] * 0x1000000
    const decoded = await decodeRPack(bytes.slice(6, 6 + length))
    return JSON.parse(Buffer.from(decoded).toString('utf-8'))
}

async function risumBytesOf(module: RisuModule): Promise<Uint8Array<ArrayBuffer>> {
    const buffer = await exportModuleLegacy(module, { alertEnd: false, saveData: false })
    if (buffer === null) {
        throw new Error('The export refused a module with no assets.')
    }
    return Uint8Array.from(buffer)
}

/** The card the last picked import ended on, or null when the import closed without one. */
let lastCard: ImportCard = null

/** Runs the real import of one picked file, answers its result card and returns the module list it left. */
async function importPicked(bytes: Uint8Array<ArrayBuffer> | string, name: string): Promise<RisuModule[]> {
    h.file = new File([bytes], name)
    lastCard = await answerImportCard(importModuleOnCard)
    return h.modules as RisuModule[]
}

beforeEach(() => {
    h.log = []
    h.calls = []
    h.modules = []
    h.load = async () => ({ kind: 'loaded' })
    lastCard = null
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    resetTaskHostForTests()
    vi.restoreAllMocks()
})

describe('a module file never carries the retained field', () => {
    test('the .risum main block of the real writer lacks it, and the live module still holds it', async () => {
        const live = moduleOf({ [ASSET_RETAINED_KEY]: KEPT, [ASSET_FOLDER_KEY]: FOLDERS })

        const block = await mainBlockOf(await risumBytesOf(live))

        expect(block.type).toBe('risuModule')
        expect(block.module.name).toBe('Retained Module')
        expect(Object.hasOwn(block.module, ASSET_RETAINED_KEY)).toBe(false)
        expect(block.module[ASSET_FOLDER_KEY]).toEqual(FOLDERS)
        expect(live[ASSET_RETAINED_KEY]).toEqual(KEPT)
    })

    test('the Realm payload lacks it, and the live module still holds it', async () => {
        const live = moduleOf({ [ASSET_RETAINED_KEY]: KEPT, [ASSET_FOLDER_KEY]: FOLDERS })
        h.modules = [live]

        const payload = await realmModuleJson(0)

        expect(payload).not.toBeNull()
        const sent = JSON.parse(payload?.json ?? '{}') as Obj
        expect(sent.type).toBe('risuModule')
        expect(Object.hasOwn(sent, ASSET_RETAINED_KEY)).toBe(false)
        expect(sent[ASSET_FOLDER_KEY]).toEqual(FOLDERS)
        expect(live[ASSET_RETAINED_KEY]).toEqual(KEPT)
    })

    test('the field of a module that holds another shape is stripped just the same', async () => {
        const live = moduleOf({ [ASSET_RETAINED_KEY]: { a: ['assets/K2.png'] } })
        expect(Object.hasOwn((await mainBlockOf(await risumBytesOf(live))).module, ASSET_RETAINED_KEY)).toBe(false)
    })
})

describe('an import drops the field before the module is placed', () => {
    test('a .risum written by the build at 1cfa819ee, which wrote the field, imports without it', async () => {
        // The fixture really holds the field, so the drop is what removes it.
        expect((await mainBlockOf(fixtureBytes())).module[ASSET_RETAINED_KEY]).toEqual(fixture.module[ASSET_RETAINED_KEY])

        const imported = await importPicked(fixtureBytes() as Uint8Array<ArrayBuffer>, 'old.risum')

        expect(h.log).toEqual([])
        expect(imported).toHaveLength(1)
        expect(imported[0].name).toBe('Risum module')
        expect(Object.hasOwn(imported[0], ASSET_RETAINED_KEY)).toBe(false)
    })

    test('a .json payload shaped like the Realm export imports without the field, whatever its shape', async () => {
        for (const value of [KEPT, { a: ['assets/K2.png'] }, 'text']) {
            h.modules = []
            const payload = JSON.stringify({ ...fixture.module, [ASSET_RETAINED_KEY]: value, type: 'risuModule' })

            const imported = await importPicked(payload, 'realm.json')

            expect(imported).toHaveLength(1)
            expect(imported[0].name).toBe('Risum module')
            expect(Object.hasOwn(imported[0], ASSET_RETAINED_KEY)).toBe(false)
        }
    })

    test('a lorebook or regex file builds a new module that carries no field even if the file names one', async () => {
        const lorebook = JSON.stringify({ type: 'risu', data: [], name: 'Lore', [ASSET_RETAINED_KEY]: KEPT })
        const imported = await importPicked(lorebook, 'lore.json')
        expect(imported).toHaveLength(1)
        expect(Object.hasOwn(imported[0], ASSET_RETAINED_KEY)).toBe(false)
    })
})

describe('a replace keeps what the installed module holds and never takes the file\'s', () => {
    function installed(extra: Obj = {}): RisuModule {
        return moduleOf({ id: 'installed-1', name: 'Same', ...extra })
    }

    const jsonOf = (extra: Obj = {}) => JSON.stringify({ id: 'file-id', name: 'Same', description: 'from file', type: 'risuModule', ...extra })

    test('the resident module keeps its retained field by reference whatever the file holds', async () => {
        const previous = installed({ [ASSET_RETAINED_KEY]: KEPT })
        h.modules = [previous]

        const list = await importPicked(jsonOf({ [ASSET_RETAINED_KEY]: [['file', 'assets/File.png']] }), 'same.json')

        expect(list).toHaveLength(1)
        expect(list[0].id).toBe('installed-1')
        expect(list[0].description).toBe('from file')
        expect(list[0][ASSET_RETAINED_KEY]).toBe(KEPT)
        expect(h.calls).toEqual([])
    })

    test('an installed module with no field stays without one, so the file cannot give it one', async () => {
        h.modules = [installed()]
        const list = await importPicked(jsonOf({ [ASSET_RETAINED_KEY]: KEPT }), 'same.json')
        expect(Object.hasOwn(list[0], ASSET_RETAINED_KEY)).toBe(false)
    })

    test('the .risum route keeps the field too', async () => {
        h.modules = [installed({ [ASSET_RETAINED_KEY]: KEPT })]
        const same = await risumBytesOf(moduleOf({ id: 'file-id', name: 'Same', description: 'from risum' }))

        const list = await importPicked(same, 'same.risum')

        expect(list).toHaveLength(1)
        expect(list[0].description).toBe('from risum')
        expect(list[0][ASSET_RETAINED_KEY]).toEqual(KEPT)
    })

    test('a folder-less file keeps the installed folders, and a file that holds the folder document wins whatever its shape', async () => {
        h.modules = [installed({ [ASSET_FOLDER_KEY]: FOLDERS })]
        const kept = await importPicked(jsonOf(), 'same.json')
        expect(kept[0][ASSET_FOLDER_KEY]).toEqual(FOLDERS)

        for (const incoming of [{ v: 1, additional: { order: [], of: [] } }, { v: 9, x: 1 }, 'garbage']) {
            h.modules = [installed({ [ASSET_FOLDER_KEY]: FOLDERS })]
            const list = await importPicked(jsonOf({ [ASSET_FOLDER_KEY]: incoming }), 'same.json')
            expect(list[0][ASSET_FOLDER_KEY]).toEqual(incoming)
        }
    })

    test('the .risum route keeps the installed folders for a folder-less file', async () => {
        h.modules = [installed({ [ASSET_FOLDER_KEY]: FOLDERS })]
        const list = await importPicked(await risumBytesOf(moduleOf({ id: 'file-id', name: 'Same' })), 'same.risum')
        expect(list[0][ASSET_FOLDER_KEY]).toEqual(FOLDERS)
    })

    test('a stub target is loaded before the write, and the loaded body\'s field and folders stay', async () => {
        const stub = stubModule('installed-1', { name: 'Same' })
        h.modules = [stub]
        h.load = async (id) => {
            h.modules[0] = installed({ [ASSET_RETAINED_KEY]: KEPT, [ASSET_FOLDER_KEY]: FOLDERS, id })
            return { kind: 'loaded' }
        }

        const list = await importPicked(jsonOf(), 'same.json')

        expect(h.calls).toEqual(['load:installed-1'])
        expect(h.log).toEqual([])
        expect(list).toHaveLength(1)
        expect(list[0].description).toBe('from file')
        expect(list[0][ASSET_RETAINED_KEY]).toEqual(KEPT)
        expect(list[0][ASSET_FOLDER_KEY]).toEqual(FOLDERS)
    })

    test('a stub target whose body cannot be loaded refuses the import and leaves the list as it was', async () => {
        const stub = stubModule('installed-1', { name: 'Same' })
        h.modules = [stub]
        const before = structuredClone(stub)
        h.load = async () => ({ kind: 'refused' })

        const list = await importPicked(jsonOf(), 'same.json')

        expect(h.calls).toEqual(['load:installed-1'])
        expect(list).toEqual([before])
        expect(list[0]).toBe(stub)
        expect(h.log).toEqual([])
        expect(lastCard?.failure?.detail).toBe(language.moduleLoadFailed('Same'))
    })

    test('the .risum route loads a stub target before the write too', async () => {
        h.modules = [stubModule('installed-1', { name: 'Same' })]
        h.load = async (id) => {
            h.modules[0] = installed({ [ASSET_RETAINED_KEY]: KEPT, id })
            return { kind: 'loaded' }
        }

        const list = await importPicked(await risumBytesOf(moduleOf({ id: 'file-id', name: 'Same' })), 'same.risum')

        expect(h.calls).toEqual(['load:installed-1'])
        expect(list[0][ASSET_RETAINED_KEY]).toEqual(KEPT)
    })

    test('a module that is not a stub is never loaded', async () => {
        h.modules = [installed()]
        await importPicked(jsonOf(), 'same.json')
        expect(h.calls).toEqual([])
    })
})
