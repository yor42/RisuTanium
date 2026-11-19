/**
 * `importModule` in `src/ts/process/modules.ts` asks once before a multi-file pick starts: the file count and the exact
 * total size. Declining closes the card and nothing was read, asked or saved; confirming imports as it always did; a
 * single file shows no question.
 *
 * The real `modules.ts`, `importBatch.ts` and `processzip.ts` run on synthetic files; the card importer and everything
 * else around them are replaced by recorders. The RPack layer is the identity.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { patterned, risumBytes } from 'src/ts/process/tests/risumFixtures'

const h = vi.hoisted(() => ({
    modules: [] as unknown[],
    files: [] as File[],
    confirm: false,
    prompts: [] as string[],
    errors: [] as string[],
    /** every asset save, in the order it started */
    events: [] as string[],
    busyBegins: [] as string[],
}))

vi.mock('uuid', () => ({ v4: () => 'uuid' }))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async (msg: string) => { h.prompts.push(msg); return h.confirm }),
    alertError: vi.fn((msg: string | Error) => { h.errors.push(msg instanceof Error ? msg.message : String(msg)) }),
    alertModuleSelect: vi.fn(),
    alertNormal: vi.fn(),
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

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
    importCharacterFile: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/bootWindow'), () => ({
    markBootWrite: vi.fn(),
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

import { importModule } from 'src/ts/process/modules'
import { answerTask, confirmTask, declineTask, resetTaskHostForTests, taskConfirmShowing, taskHostView, taskResultShowing } from 'src/ts/alertTask.svelte'
import { taskMiB } from 'src/lib/Nexus/pattern/taskProgress'
import { language } from 'src/lang'

const risum = (fileName: string, moduleName: string, over: { records?: Uint8Array[], module?: Record<string, unknown> } = {}) =>
    new File([risumBytes({ records: over.records, module: { name: moduleName, ...over.module } })], fileName)
const names = () => (h.modules as { name: string }[]).map((m) => m.name)

/** Lets the import run until `until` holds or the import resolved. */
async function runUntil(done: Promise<void>, until: () => boolean) {
    let ended = false
    void done.then(() => { ended = true }, () => { ended = true })
    for (let i = 0; i < 400 && !ended && !until(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
}

beforeEach(() => {
    h.modules = []
    h.files = []
    h.confirm = false
    h.prompts = []
    h.errors = []
    h.events = []
    h.busyBegins = []
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
    resetTaskHostForTests()
    vi.restoreAllMocks()
})

describe('importModule preflight', () => {
    test('regression reproducer: a two-file pick asks once with the count and the exact total size before any save, busy scope or module', async () => {
        const a = risum('a.risum', 'A', { records: [patterned(10, 1)] })
        const b = risum('b.risum', 'B')
        h.files = [a, b]
        const done = importModule()
        await runUntil(done, taskConfirmShowing)
        expect(taskConfirmShowing()).toBe(true)
        const confirm = taskHostView()?.confirm
        expect(confirm?.headline).toBe(language.importPreflightHeadline(2))
        expect(confirm?.consequences?.[0]).toBe(language.importPreflightSize(taskMiB(a.size + b.size)))
        expect(h.busyBegins).toEqual([])
        expect(h.events).toEqual([])
        expect(names()).toEqual([])

        confirmTask()
        await runUntil(done, taskResultShowing)
        answerTask({ kind: 'ok' })
        await done
        expect(names()).toEqual(['A', 'B'])
        expect(h.busyBegins).toEqual(['import'])
        expect(h.prompts).toEqual([])
    })

    test('regression reproducer: declining saves no asset or module and asks neither a low-level nor a duplicate question', async () => {
        h.modules = [{ id: 'old', name: 'A', namespace: 'same' }]
        h.files = [
            risum('a.risum', 'A', { records: [patterned(10, 1)], module: { lowLevelAccess: true, namespace: 'same' } }),
            risum('b.risum', 'B'),
        ]
        const done = importModule()
        await runUntil(done, taskConfirmShowing)
        expect(taskConfirmShowing()).toBe(true)
        declineTask()
        await done
        expect(h.events).toEqual([])
        expect(h.prompts).toEqual([])
        expect(h.errors).toEqual([])
        expect(h.modules).toEqual([{ id: 'old', name: 'A', namespace: 'same' }])
        expect(h.busyBegins).toEqual([])
        expect(taskHostView()).toBeNull()
    })

    test('guard: a single file shows no question and imports (passes before and after)', async () => {
        h.files = [risum('a.risum', 'A')]
        const done = importModule()
        await runUntil(done, () => taskConfirmShowing() || taskResultShowing())
        expect(taskConfirmShowing()).toBe(false)
        if (taskResultShowing()) answerTask({ kind: 'ok' })
        await done
        expect(names()).toEqual(['A'])
    })
})
