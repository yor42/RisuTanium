/**
 * `importModule` in `src/ts/process/modules.ts` with several picked files, the single-file feedback table, and the
 * `beforeAssets` hook of `readModule`.
 *
 * The real `modules.ts`, `importBatch.ts`, `moduleImportStop.ts` and `processzip.ts` run on synthetic files; the card
 * importer and everything else around them are replaced by recorders. The RPack layer is the identity.
 *
 * Labels: "regression reproducer" fails on the single-file picker; "feature" tests cover behaviour that did not exist;
 * "guard" tests pin behaviour that holds before and after.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ImportOutcome } from 'src/ts/importBatch'
import type { character } from 'src/ts/storage/database.svelte'
import { assetName, patterned, risumBytes } from 'src/ts/process/tests/risumFixtures'

const h = vi.hoisted(() => ({
    log: [] as string[],
    /** what the single alert slot holds: every alert function replaces it */
    last: 'none' as string,
    modules: [] as unknown[],
    files: [] as File[],
    confirm: false,
    prompts: [] as string[],
    waits: 0,
    /** every asset save and card import, in the order they started and ended */
    events: [] as string[],
    marks: [] as number[],
    busyBegins: [] as string[],
    card: null as null | ((arg: { name: string, data: File, returnCharacter?: boolean, lowLevelLabel?: string | ((name: string) => string) }) => Promise<ImportOutcome>),
    cardArgs: [] as { name: string, label?: string }[],
}))

vi.mock('uuid', () => ({ v4: () => 'uuid' }))

vi.mock(import('src/ts/alert'), () => {
    const text = (msg: string | Error) => msg instanceof Error ? msg.message : String(msg)
    return {
        alertClear: vi.fn(() => { h.last = 'none' }),
        alertConfirm: vi.fn(async (msg: string) => { h.prompts.push(msg); return h.confirm }),
        alertError: vi.fn((msg: string | Error) => { h.log.push('error:' + text(msg)); h.last = 'error:' + text(msg) }),
        alertModuleSelect: vi.fn(),
        alertNormal: vi.fn((msg: string) => { h.log.push('normal:' + msg); h.last = 'normal:' + msg }),
        alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
        alertWait: vi.fn((msg: string) => { h.waits++; h.last = 'wait:' + msg }),
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
    saveAsset: vi.fn(async (data: Uint8Array) => {
        h.events.push('save:' + data[0])
        await new Promise((resolve) => setTimeout(resolve, 1))
        return 'saved-asset'
    }),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/util'), () => ({
    checkPersonaBinded: vi.fn(),
    // The single-file picker of the old importModule: it can hand over only the first file.
    selectSingleFileObject: vi.fn(async () => h.files[0] ?? null),
    selectFileByDom: vi.fn(async () => h.files),
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

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { modules: h.modules } } },
    HideIconStore: { set: vi.fn() },
    moduleBackgroundEmbedding: { set: vi.fn() },
    ReloadGUIPointer: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn((c: { name: string }) => ({ id: 'converted', name: c.name })),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

vi.mock(import('src/ts/characterCards'), () => ({
    exportCharacterCard: vi.fn(),
    importCharacterFile: vi.fn(async (arg: { name: string, data: File, returnCharacter?: boolean, lowLevelLabel?: string | ((name: string) => string) }) => {
        h.cardArgs.push({ name: arg.name, label: typeof arg.lowLevelLabel === 'function' ? arg.lowLevelLabel('Card') : arg.lowLevelLabel })
        h.events.push('card:start')
        await new Promise((resolve) => setTimeout(resolve, 2))
        h.events.push('card:end')
        return h.card ? h.card(arg) : { kind: 'imported', index: null, character: { name: 'Card' } as unknown as character }
    }),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/bootWindow'), () => ({
    markBootWrite: vi.fn(() => { h.marks.push(h.modules.length) }),
}) as unknown as typeof import('src/ts/bootWindow'))

vi.mock(import('src/ts/process/memory/busyActions'), async (importOriginal) => {
    const real = await importOriginal()
    return {
        ...real,
        withBusy: ((kind: string, work: () => Promise<unknown>) => {
            h.busyBegins.push(kind)
            return real.withBusy(kind as 'import', work)
        }) as typeof real.withBusy,
    }
})

import { importModule, readModule } from 'src/ts/process/modules'
import { ModuleImportStopped } from 'src/ts/process/moduleImportStop'
import { charxLimits } from 'src/ts/process/processzip'
import { isBusy } from 'src/ts/process/memory/busyActions'
import { language } from 'src/lang'

const limitDefaults = { ...charxLimits }

const risum = (fileName: string, moduleName: string, over: { records?: Uint8Array[], module?: Record<string, unknown>, magic?: number } = {}) =>
    new File([risumBytes({ records: over.records, magic: over.magic, module: { name: moduleName, ...over.module } })], fileName)
const json = (fileName: string, value: unknown) => new File([JSON.stringify(value)], fileName)
const names = () => (h.modules as { name: string }[]).map((m) => m.name)

beforeEach(() => {
    h.log = []
    h.last = 'none'
    h.modules = []
    h.files = []
    h.confirm = false
    h.prompts = []
    h.waits = 0
    h.events = []
    h.marks = []
    h.busyBegins = []
    h.card = null
    h.cardArgs = []
    Object.assign(charxLimits, limitDefaults)
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    Object.assign(charxLimits, limitDefaults)
    vi.restoreAllMocks()
})

describe('several picked files', () => {
    test('regression reproducer: two files through importModule both import, and the end message is a count', async () => {
        h.files = [risum('a.risum', 'A'), risum('b.risum', 'B')]
        await importModule()
        expect(names()).toEqual(['A', 'B'])
        expect(h.log).toEqual(['normal:' + language.importModulesDone(2, 0)])
    })

    test('feature: five files with the third refused import the other four and end on one message naming the failure', async () => {
        h.files = [
            risum('f1.risum', 'One'), risum('f2.risum', 'Two'), risum('f3.risum', 'Three', { magic: 0 }),
            risum('f4.risum', 'Four'), risum('f5.risum', 'Five'),
        ]
        await importModule()
        expect(names()).toEqual(['One', 'Two', 'Four', 'Five'])
        const message = language.importFilesNotImported(1, 5, 'f3.risum: ' + language.errors.noData)
        expect(h.log).toEqual(['error:' + message])
        expect(h.last).toBe('error:' + message)
    })

    test('feature: the first failure is in the summary when later files fail too', async () => {
        h.files = [risum('f1.risum', 'One', { magic: 0 }), risum('f2.risum', 'Two'), risum('f3.risum', 'Three', { magic: 0 })]
        await importModule()
        expect(h.log).toEqual(['error:' + language.importFilesNotImported(2, 3, `f1.risum: ${language.errors.noData}\nf3.risum: ${language.errors.noData}`)])
    })

    test('feature: an unsupported file is listed with the short reason and the rest import', async () => {
        h.files = [risum('a.risum', 'A'), new File(['x'], 'notes.txt')]
        await importModule()
        expect(names()).toEqual(['A'])
        expect(h.log).toEqual(['error:' + language.importFilesNotImported(1, 2, 'notes.txt: ' + language.importUnsupportedFile)])
    })

    test('feature: a declined low-level prompt is listed in a multi-file summary, saves no asset and adds no module', async () => {
        h.files = [risum('a.risum', 'A', { records: [patterned(10, 1)], module: { lowLevelAccess: true } }), risum('b.risum', 'B')]
        await importModule()
        expect(names()).toEqual(['B'])
        expect(h.events).toEqual([])
        expect(h.prompts).toHaveLength(1)
        expect(h.prompts[0]).toBe(`${language.moduleLowLevelNamed('A', 'a.risum')}\n${language.lowLevelAccessConfirm}`)
        expect(h.log).toEqual(['error:' + language.importFilesNotImported(1, 2, 'a.risum: ' + language.importDeclinedLowLevel)])
    })

    test('feature: a confirmed low-level prompt imports the module', async () => {
        h.confirm = true
        h.files = [risum('a.risum', 'A', { records: [patterned(10, 1)], module: { lowLevelAccess: true } }), risum('b.risum', 'B')]
        await importModule()
        expect(names()).toEqual(['A', 'B'])
        expect(h.events).toEqual(['save:' + patterned(10, 1)[0]])
    })

    test('feature: the whole pick runs inside one busy scope that ends with it', async () => {
        h.files = [risum('a.risum', 'A'), risum('b.risum', 'B'), risum('c.risum', 'C')]
        await importModule()
        expect(h.busyBegins).toEqual(['import'])
        expect(isBusy()).toBe(false)
    })

    test('feature: files are imported one after another, never interleaved', async () => {
        h.files = [
            risum('a.risum', 'A', { records: [patterned(10, 1), patterned(10, 2)] }),
            new File([new Uint8Array([1, 2, 3])], 'card.charx'),
            risum('b.risum', 'B', { records: [patterned(10, 3)] }),
        ]
        await importModule()
        expect(h.events).toEqual([
            'save:' + patterned(10, 1)[0], 'save:' + patterned(10, 2)[0],
            'card:start', 'card:end',
            'save:' + patterned(10, 3)[0],
        ])
        expect(names()).toEqual(['A', 'Card', 'B'])
    })

    test('feature: a charx in a batch gets a prompt label naming the card and its file, and a lower-case suffix name', async () => {
        h.files = [new File([new Uint8Array([1])], 'Card.CHARX'), risum('b.risum', 'B')]
        await importModule()
        expect(h.cardArgs).toEqual([{ name: 'Card.charx', label: language.moduleLowLevelNamed('Card', 'Card.CHARX') }])
    })

    test('feature: markBootWrite is called once for each module, before the module is in the list', async () => {
        h.files = [
            risum('a.risum', 'A'), json('j.json', { type: 'risu', name: 'L', data: [] }),
            new File([new Uint8Array([1])], 'card.charx'),
        ]
        await importModule()
        expect(h.marks).toEqual([0, 1, 2])
        expect(names()).toHaveLength(3)
    })

    test('feature: a failure in the card importer does not stop the files after it', async () => {
        h.card = async () => { throw new Error('boom') }
        h.files = [new File([new Uint8Array([1])], 'card.charx'), risum('b.risum', 'B')]
        await importModule()
        expect(names()).toEqual(['B'])
        expect(h.log).toEqual(['error:' + language.importFilesNotImported(1, 2, 'card.charx: boom')])
    })

    test('feature: an empty pick shows nothing and starts no import', async () => {
        h.files = []
        await importModule()
        expect(h.log).toEqual([])
        expect(h.busyBegins).toEqual([])
    })
})

describe('one picked file: what the user is left looking at', () => {
    test('a .risum that imports shows nothing', async () => {
        h.files = [risum('a.risum', 'A')]
        await importModule()
        expect(names()).toEqual(['A'])
        expect(h.log).toEqual([])
    })

    test('a .risum that is refused shows the reason as an error', async () => {
        h.files = [risum('a.risum', 'A', { magic: 0 })]
        await importModule()
        expect(h.modules).toEqual([])
        expect(h.log).toEqual(['error:' + language.errors.noData])
    })

    test('feature: a .risum whose low-level prompt is declined shows nothing, saves no asset and adds no module', async () => {
        h.files = [risum('a.risum', 'A', { records: [patterned(10, 1)], module: { lowLevelAccess: true } })]
        await importModule()
        expect(h.modules).toEqual([])
        expect(h.events).toEqual([])
        expect(h.log).toEqual([])
        expect(h.prompts).toEqual([`${language.moduleLowLevelNamed('A')}\n${language.lowLevelAccessConfirm}`])
    })

    test('a .charx that imports shows the success message', async () => {
        h.files = [new File([new Uint8Array([1])], 'card.charx')]
        await importModule()
        expect(h.modules).toEqual([{ id: 'converted', name: 'Card' }])
        expect(h.log).toEqual(['normal:' + language.successImport])
    })

    test('a .charx that is declined shows nothing', async () => {
        h.card = async () => ({ kind: 'declined' })
        h.files = [new File([new Uint8Array([1])], 'card.charx')]
        await importModule()
        expect(h.log).toEqual([])
        expect(h.modules).toEqual([])
    })

    test('a .charx that is refused shows the reason as an error', async () => {
        h.card = async () => ({ kind: 'refused', reason: language.cardFileIncomplete })
        h.files = [new File([new Uint8Array([1])], 'card.charx')]
        await importModule()
        expect(h.log).toEqual(['error:' + language.cardFileIncomplete])
    })

    test('the single-file charx prompt label names the card and no file', async () => {
        h.files = [new File([new Uint8Array([1])], 'card.charx')]
        await importModule()
        expect(h.cardArgs).toEqual([{ name: 'card.charx', label: language.moduleLowLevelNamed('Card') }])
    })

    test('a json risuModule, a risu lorebook, an external lorebook and a regex list import and show nothing', async () => {
        for (const value of [
            { type: 'risuModule', name: 'M', id: 'x' },
            { type: 'risu', data: [] },
            { entries: {} },
            { type: 'regex', data: [] },
        ]) {
            h.modules = []
            h.files = [json('x.json', value)]
            await importModule()
            expect(h.modules, JSON.stringify(value)).toHaveLength(1)
        }
        expect(h.log).toEqual([])
    })

    test('a json risuModule without a name or an id is an error', async () => {
        h.files = [json('x.json', { type: 'risuModule', name: 'M' })]
        await importModule()
        expect(h.modules).toEqual([])
        expect(h.log).toEqual(['error:' + language.errors.noData])
    })

    test('a json that is not usable, or does not parse, is a normal alert (compatibility guard: same level as before)', async () => {
        for (const file of [json('x.json', { hello: 1 }), new File(['{ not json'], 'y.lorebook')]) {
            h.log = []
            h.files = [file]
            await importModule()
            expect(h.log).toEqual(['normal:' + language.errors.noData])
        }
        expect(h.modules).toEqual([])
    })

    test('a json risuModule whose low-level prompt is declined shows nothing; confirmed it imports with the plain prompt text', async () => {
        h.files = [json('x.json', { type: 'risuModule', name: 'M', id: 'x', lowLevelAccess: true })]
        await importModule()
        expect(h.modules).toEqual([])
        expect(h.log).toEqual([])
        h.confirm = true
        await importModule()
        expect(h.modules).toHaveLength(1)
        expect(h.prompts).toEqual([language.lowLevelAccessConfirm, language.lowLevelAccessConfirm])
    })

    test('feature: an unsupported file is a normal alert naming the file', async () => {
        h.files = [new File(['x'], 'notes.txt')]
        await importModule()
        expect(h.log).toEqual(['normal:' + language.moduleUnsupportedFile('notes.txt')])
        expect(h.modules).toEqual([])
    })

    test('feature: an upper-case X.RISUM imports', async () => {
        h.files = [risum('X.RISUM', 'Upper')]
        await importModule()
        expect(names()).toEqual(['Upper'])
        expect(h.log).toEqual([])
    })

    test('feature: an upper-case X.CHARX imports and the card importer is handed a lower-case suffix', async () => {
        h.files = [new File([new Uint8Array([1])], 'X.CHARX')]
        await importModule()
        expect(h.cardArgs.map((a) => a.name)).toEqual(['X.charx'])
        expect(h.modules).toHaveLength(1)
        expect(h.log).toEqual(['normal:' + language.successImport])
    })
})

describe('readModule beforeAssets', () => {
    const big = () => {
        charxLimits.assetBytes = 64 * 1024 * 1024
        return risumBytes({ records: [patterned(9 * 1024 * 1024, 1)], module: { name: 'Big' } })
    }

    test('feature: a hook that throws on a source above the reading threshold saves nothing and leaves the alert cleared', async () => {
        const bytes = big()
        await expect(readModule(bytes, { beforeAssets: async () => { throw new ModuleImportStopped('declined') } }))
            .rejects.toBeInstanceOf(ModuleImportStopped)
        expect(h.waits).toBeGreaterThan(0)
        expect(h.events).toEqual([])
        expect(h.last).toBe('none')
    })

    test('feature: the hook sees the scanned module before any asset is saved', async () => {
        let seen = ''
        let savedBefore = -1
        await readModule(risumBytes({ records: [patterned(10, 1)], module: { name: 'Seen' } }), {
            beforeAssets: async (module) => { seen = module.name; savedBefore = h.events.length },
        })
        expect(seen).toBe('Seen')
        expect(savedBefore).toBe(0)
        expect(h.events).toHaveLength(1)
    })

    test('guard: without the option the module is read as before', async () => {
        const module = await readModule(risumBytes({ records: [patterned(10, 1)], module: { name: 'Plain' } }))
        expect(module.name).toBe('Plain')
        expect(module.assets?.[0]?.[1]).toBe('saved-asset')
        expect(assetName(0)).toBe(module.assets?.[0]?.[0])
    })
})
