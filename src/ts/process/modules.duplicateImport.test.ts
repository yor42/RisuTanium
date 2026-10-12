/**
 * Duplicate handling of `importModule` in `src/ts/process/modules.ts`: the Replace / Skip / Add anyway decision, the
 * in-place replace, the module cache and the module screens after a replace, and the notes about a changed namespace.
 *
 * The real `modules.ts`, `moduleDuplicates.ts`, `importBatch.ts`, `moduleImportStop.ts` and `processzip.ts` run on
 * synthetic files; the card importer and everything else around them are replaced by recorders. The module list is one
 * array that both `DBState.db.modules` and `getDatabase().modules` return, as in the application.
 *
 * Labels: "feature" tests cover behaviour that did not exist (they fail against the sources before the duplicate
 * decision); "guard" tests pin behaviour that holds before and after and are the kill for a named mutant.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ImportOutcome } from 'src/ts/importBatch'
import type { character } from 'src/ts/storage/database.svelte'
import { patterned, risumBytes } from 'src/ts/process/tests/risumFixtures'

type Stored = { id: string, name?: unknown, description?: string, namespace?: string, lowLevelAccess?: boolean, mcp?: unknown }

const h = vi.hoisted(() => ({
    log: [] as string[],
    /** what the single alert slot holds: every alert function replaces it */
    last: 'none' as string,
    db: { modules: [] as unknown[], enabledModules: [] as string[] },
    files: [] as File[],
    confirm: true,
    prompts: [] as string[],
    /** the select answers in order; a missing answer is Skip */
    answers: [] as string[],
    asked: [] as { options: string[], display: string | undefined }[],
    onAsk: null as null | (() => void),
    events: [] as string[],
    /** the descriptions in the list at each asset save */
    listAtSave: [] as (string | undefined)[][],
    marks: [] as number[],
    ids: 0,
    card: null as null | ((arg: { name: string, data: File }) => Promise<ImportOutcome>),
}))

vi.mock('uuid', () => ({ v4: () => 'uuid' + (++h.ids) }))

vi.mock(import('src/ts/alert'), () => {
    const text = (msg: string | Error) => msg instanceof Error ? msg.message : String(msg)
    return {
        alertClear: vi.fn(() => { h.last = 'none' }),
        alertConfirm: vi.fn(async (msg: string) => { h.prompts.push(msg); h.events.push('confirm'); return h.confirm }),
        alertError: vi.fn((msg: string | Error) => { h.log.push('error:' + text(msg)); h.last = 'error:' + text(msg) }),
        alertModuleSelect: vi.fn(),
        alertNormal: vi.fn((msg: string) => { h.log.push('normal:' + msg); h.last = 'normal:' + msg }),
        alertSelect: vi.fn(async (options: string[], display?: string) => {
            h.asked.push({ options, display })
            h.events.push('ask')
            h.onAsk?.()
            return h.answers.shift() ?? '1'
        }),
        alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
        alertWait: vi.fn((msg: string) => { h.last = 'wait:' + msg }),
    } as unknown as typeof import('src/ts/alert')
})

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
    saveAsset: vi.fn(async (data: Uint8Array) => {
        h.events.push('save:' + data[0])
        h.listAtSave.push((h.db.modules as Stored[]).map((m) => m.description))
        await new Promise((resolve) => setTimeout(resolve, 1))
        return 'saved-asset'
    }),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/util'), () => ({
    checkPersonaBinded: vi.fn(),
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
    convertCharacterToModule: vi.fn((c: { name: string, moduleNamespace?: string }) => ({ id: 'converted', name: c.name, description: 'card', namespace: c.moduleNamespace })),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

vi.mock(import('src/ts/characterCards'), () => ({
    exportCharacterCard: vi.fn(),
    importCharacterFile: vi.fn(async (arg: { name: string, data: File }) => {
        h.events.push('card:start')
        await new Promise((resolve) => setTimeout(resolve, 2))
        h.events.push('card:end')
        return h.card ? h.card(arg) : { kind: 'imported', index: null, character: { name: 'Dup' } as unknown as character }
    }),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/bootWindow'), () => ({
    markBootWrite: vi.fn(() => { h.marks.push(h.db.modules.length) }),
}) as unknown as typeof import('src/ts/bootWindow'))

import { getModules, importModule } from 'src/ts/process/modules'
import { ReloadGUIPointer } from 'src/ts/stores.svelte'
import { get } from 'svelte/store'
import { language } from 'src/lang'

const risum = (fileName: string, moduleName: string | undefined, over: { records?: Uint8Array[], module?: Record<string, unknown> } = {}) =>
    new File([risumBytes({ records: over.records, module: { name: moduleName, description: 'new', ...over.module } })], fileName)
const json = (fileName: string, value: unknown) => new File([JSON.stringify(value)], fileName)
const charx = (fileName: string) => new File([new Uint8Array([1])], fileName)
const list = () => h.db.modules as Stored[]
const installed = (id: string, name: unknown, extra: Partial<Stored> = {}): Stored => ({ id, name, description: 'old', ...extra })
const optionCount = (i: number) => h.asked[i].options.length

beforeEach(() => {
    h.log = []
    h.last = 'none'
    h.db = { modules: [], enabledModules: [] }
    h.files = []
    h.confirm = true
    h.prompts = []
    h.answers = []
    h.asked = []
    h.onAsk = null
    h.events = []
    h.listAtSave = []
    h.marks = []
    h.ids = 0
    h.card = null
    ReloadGUIPointer.set(0)
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('replace', () => {
    test('feature: Replace keeps the id, position and enabled state and takes everything else from the new file', async () => {
        h.db.modules = [installed('a', 'Other'), installed('t', 'Dup', { namespace: 'old-ns' }), installed('c', 'Third')]
        h.db.enabledModules = ['t']
        h.files = [risum('dup.risum', 'Dup', { module: { namespace: 'new-ns', lowLevelAccess: true, cjs: 'x' } })]
        h.answers = ['0']
        await importModule()
        expect(list().map((m) => m.id)).toEqual(['a', 't', 'c'])
        expect(list()[1]).toMatchObject({ id: 't', name: 'Dup', description: 'new', namespace: 'new-ns', lowLevelAccess: true })
        expect(h.db.enabledModules).toEqual(['t'])
        expect(h.marks).toEqual([3])
    })

    test('feature: a replace that changed the namespace of a single .risum shows only the note', async () => {
        h.db.modules = [installed('t', 'Dup', { namespace: 'old-ns' })]
        h.files = [risum('dup.risum', 'Dup', { module: { namespace: 'new-ns' } })]
        h.answers = ['0']
        await importModule()
        expect(h.log).toEqual(['normal:' + language.moduleReplaceNamespaceChanged('Dup', 'old-ns', 'new-ns')])
    })

    test('feature: a replace that keeps the namespace shows nothing', async () => {
        h.db.modules = [installed('t', 'Dup', { namespace: 'same' })]
        h.files = [risum('dup.risum', 'Dup', { module: { namespace: 'same' } })]
        h.answers = ['0']
        await importModule()
        expect(h.log).toEqual([])
        expect(list()[0].description).toBe('new')
    })

    test('feature: a single .charx replace with a changed namespace shows exactly one alert with the success text and the note', async () => {
        h.db.modules = [installed('t', 'Dup', { namespace: 'old-ns' })]
        h.card = async () => ({ kind: 'imported', index: null, character: { name: 'Dup', moduleNamespace: 'new-ns' } as unknown as character })
        h.files = [charx('dup.charx')]
        h.answers = ['0']
        await importModule()
        const message = `${language.successImport}\n${language.moduleReplaceNamespaceChanged('Dup', 'old-ns', 'new-ns')}`
        expect(h.log).toEqual(['normal:' + message])
        expect(h.last).toBe('normal:' + message)
        expect(list()).toMatchObject([{ id: 't', description: 'card', namespace: 'new-ns' }])
    })

    test('feature: a json module replaces in place too', async () => {
        h.db.modules = [installed('t', 'Dup')]
        h.files = [json('dup.json', { type: 'risuModule', name: 'Dup', id: 'x', description: 'from json' })]
        h.answers = ['0']
        await importModule()
        expect(list()).toMatchObject([{ id: 't', description: 'from json' }])
    })

    test('feature: a lorebook file replaces a module of the same name', async () => {
        h.db.modules = [installed('t', 'Imported Lorebook')]
        h.files = [json('book.json', { type: 'risu', data: [], description: 'book' })]
        h.answers = ['0']
        await importModule()
        expect(list()).toMatchObject([{ id: 't', description: 'book' }])
    })

    test('feature: a .risum replace waits for the read: the list still holds the old module while assets are saved', async () => {
        h.db.modules = [installed('t', 'Dup')]
        h.files = [risum('dup.risum', 'Dup', { records: [patterned(10, 1), patterned(10, 2)] })]
        h.answers = ['0']
        await importModule()
        expect(h.listAtSave).toEqual([['old'], ['old']])
        expect(list()[0].description).toBe('new')
    })

    test('feature: a charx replace happens after the card was read in full', async () => {
        h.db.modules = [installed('t', 'Dup')]
        h.files = [charx('dup.charx')]
        h.answers = ['0']
        await importModule()
        expect(h.events).toEqual(['card:start', 'card:end', 'ask'])
    })

    test('feature: a target that vanished during the prompt makes the replace an add with a fresh id', async () => {
        h.db.modules = [installed('x', 'Keep'), installed('t', 'Dup')]
        h.files = [risum('dup.risum', 'Dup')]
        h.answers = ['0']
        h.onAsk = () => { h.db.modules = list().filter((m) => m.id !== 't') }
        await importModule()
        expect(list().map((m) => m.id)).toEqual(['x', 'uuid1'])
        expect(list()[1].description).toBe('new')
        expect(get(ReloadGUIPointer)).toBe(0)
    })
})

describe('skip and add anyway', () => {
    test('feature: Skip writes nothing and shows nothing; a .risum saves no asset', async () => {
        h.db.modules = [installed('t', 'Dup')]
        h.files = [risum('dup.risum', 'Dup', { records: [patterned(10, 1)] })]
        h.answers = ['1']
        await importModule()
        expect(list()).toEqual([installed('t', 'Dup')])
        expect(h.events).toEqual(['ask'])
        expect(h.marks).toEqual([])
        expect(h.log).toEqual([])
    })

    test('feature: Skip on a charx and on a json writes nothing', async () => {
        h.db.modules = [installed('t', 'Dup')]
        for (const file of [charx('dup.charx'), json('dup.json', { type: 'risuModule', name: 'Dup', id: 'x' })]) {
            h.files = [file]
            h.answers = ['1']
            await importModule()
        }
        expect(list()).toEqual([installed('t', 'Dup')])
        expect(h.marks).toEqual([])
        expect(h.log).toEqual([])
    })

    test('guard (passes before and after, since adding was always the outcome): Add anyway appends a second module with a fresh id', async () => {
        h.db.modules = [installed('t', 'Dup')]
        h.files = [risum('dup.risum', 'Dup')]
        h.answers = ['2']
        await importModule()
        expect(list().map((m) => [m.id, m.description])).toEqual([['t', 'old'], ['uuid1', 'new']])
        expect(get(ReloadGUIPointer)).toBe(0)
    })

    test('feature: the duplicate question comes after the low-level question and neither saves an asset when declined', async () => {
        h.db.modules = [installed('t', 'Dup')]
        h.files = [risum('dup.risum', 'Dup', { records: [patterned(10, 1)], module: { lowLevelAccess: true } })]
        h.answers = ['0']
        await importModule()
        expect(h.events).toEqual(['confirm', 'ask', 'save:' + patterned(10, 1)[0]])
        h.events = []
        h.confirm = false
        await importModule()
        expect(h.events).toEqual(['confirm'])
    })
})

describe('batches', () => {
    test('feature: an all-remaining answer is sticky, asks once and still adds names that are not installed', async () => {
        h.db.modules = [installed('t', 'Dup')]
        h.files = [risum('a.risum', 'Dup'), risum('b.risum', 'Dup'), risum('c.risum', 'Fresh')]
        h.answers = ['3']
        await importModule()
        expect(h.asked).toHaveLength(1)
        expect(list().map((m) => [m.id, m.name])).toEqual([['t', 'Dup'], ['uuid3', 'Fresh']])
        expect(get(ReloadGUIPointer)).toBe(1)
    })

    test('feature: the all-remaining options are offered only while a later file remains', async () => {
        h.db.modules = [installed('t', 'Dup')]
        h.files = [risum('a.risum', 'Dup'), risum('b.risum', 'Dup')]
        h.answers = ['1', '1']
        await importModule()
        expect(h.asked).toHaveLength(2)
        expect([optionCount(0), optionCount(1)]).toEqual([6, 3])
    })

    test('feature: a single file is offered three options', async () => {
        h.db.modules = [installed('t', 'Dup')]
        h.files = [risum('a.risum', 'Dup')]
        await importModule()
        expect(optionCount(0)).toBe(3)
        expect(h.asked[0].display).toBe(language.moduleDuplicatePrompt('Dup', 'a.risum'))
    })

    test('feature: a name repeated inside the batch is a duplicate of the file imported before it', async () => {
        h.files = [risum('a.risum', 'New'), risum('b.risum', 'New')]
        h.answers = ['2']
        await importModule()
        expect(h.asked).toHaveLength(1)
        expect(h.asked[0].display).toBe(language.moduleDuplicatePrompt('New', 'b.risum'))
        expect(list()).toHaveLength(2)
    })

    test('feature: a batch with two replaces bumps the module screens once and ends on a count with the notes', async () => {
        h.db.modules = [installed('a', 'A', { namespace: 'one' }), installed('b', 'B', { namespace: 'two' })]
        h.files = [risum('a.risum', 'A', { module: { namespace: 'one-new' } }), risum('b.risum', 'B', { module: { namespace: 'two-new' } })]
        h.answers = ['3']
        await importModule()
        expect(get(ReloadGUIPointer)).toBe(1)
        expect(h.log).toEqual(['normal:' + [
            language.importModulesDone(2, 0),
            language.moduleReplaceNamespaceChanged('A', 'one', 'one-new'),
            language.moduleReplaceNamespaceChanged('B', 'two', 'two-new'),
        ].join('\n')])
    })

    test('feature: skipped files are counted in the end message', async () => {
        h.db.modules = [installed('t', 'Dup')]
        h.files = [risum('a.risum', 'Dup'), risum('b.risum', 'Other')]
        h.answers = ['1']
        await importModule()
        expect(h.log).toEqual(['normal:' + language.importModulesDone(1, 1)])
    })
})

describe('what counts as a duplicate', () => {
    test('feature: the names are compared trimmed and case-sensitively', async () => {
        h.db.modules = [installed('t', '  Dup  ')]
        h.files = [risum('a.risum', 'Dup ')]
        await importModule()
        expect(h.asked).toHaveLength(1)
        h.asked = []
        h.files = [risum('b.risum', 'dup')]
        await importModule()
        expect(h.asked).toEqual([])
        expect(list()).toHaveLength(2)
    })

    test('guard (passes before and after; it pins the MCP exclusion against the mutant that matches MCP modules): an MCP module of the same name is never the target and nothing is asked', async () => {
        h.db.modules = [installed('t', 'Dup', { mcp: { url: 'x' } })]
        h.files = [risum('a.risum', 'Dup')]
        await importModule()
        expect(h.asked).toEqual([])
        expect(list().map((m) => m.id)).toEqual(['t', 'uuid1'])
    })

    test('feature: a name containing the select separator is shown with single bars and the options stay intact', async () => {
        h.db.modules = [installed('t', 'A||B')]
        h.files = [risum('a||b.risum', 'A||B')]
        h.answers = ['1']
        await importModule()
        expect(h.asked[0].display).toBe(language.moduleDuplicatePrompt('A|B', 'a|b.risum'))
        expect(h.asked[0].display).not.toContain('||')
        expect(optionCount(0)).toBe(3)
    })

    test('feature: runs of three or four bars in a name leave no separator in the header, single file and batch', async () => {
        h.db.modules = [installed('t', 'A|||B'), installed('u', '|||Lore|||'), installed('v', 'C||||D')]
        h.files = [risum('a.risum', 'A|||B')]
        h.answers = ['1']
        await importModule()
        h.files = [risum('b.risum', '|||Lore|||'), risum('c.risum', 'C||||D')]
        h.answers = ['1', '1']
        await importModule()
        expect(h.asked).toHaveLength(3)
        for (const ask of h.asked) {
            expect(ask.display).not.toContain('||')
        }
        expect(h.asked.map((a) => a.options.length)).toEqual([3, 6, 3])
        expect(list()).toHaveLength(3)
    })

    test('guard (passes before and after; it pins that a missing name neither matches nor throws): a nameless stored module never matches and an incoming nameless .risum imports without a question', async () => {
        h.db.modules = [installed('n', undefined), installed('m', 7)]
        h.files = [risum('a.risum', undefined)]
        await importModule()
        expect(h.asked).toEqual([])
        expect(list()).toHaveLength(3)
        h.files = [risum('b.risum', 'Named')]
        await importModule()
        expect(h.asked).toEqual([])
        expect(list()).toHaveLength(4)
    })
})

describe('cache and module screens', () => {
    test('feature: after a replace getModules returns the new module and the screens are bumped once', async () => {
        h.db.modules = [installed('t', 'Dup')]
        h.db.enabledModules = ['t']
        const before = getModules()
        expect(before).toMatchObject([{ id: 't', description: 'old' }])
        expect(getModules()).toBe(before)
        h.files = [risum('a.risum', 'Dup')]
        h.answers = ['0']
        await importModule()
        const after = getModules()
        expect(after).not.toBe(before)
        expect(after).toMatchObject([{ id: 't', description: 'new' }])
        expect(get(ReloadGUIPointer)).toBe(1)
    })

    test('guard: an import without a replace leaves the module screens alone', async () => {
        h.files = [risum('a.risum', 'Fresh'), risum('b.risum', 'Other')]
        await importModule()
        expect(get(ReloadGUIPointer)).toBe(0)
    })
})
