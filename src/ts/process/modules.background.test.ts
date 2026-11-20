/**
 * `importModule` in `src/ts/process/modules.ts` with "Keep going in the background": the offer comes only after the last
 * file's duplicate decision of a round that replaced nothing (MC-2498, MC-2509), a replaced round guards every other card
 * until it ends (MC-2513), the module screens are told when a round with a replace ends (not when the action ends), and
 * the write order is the same whether the card stays in front or is sent away.
 *
 * The real `modules.ts`, `moduleDuplicates.ts`, `importBatch.ts`, `alertTask.svelte.ts`, `moduleImportStop.ts` and
 * `processzip.ts` run on synthetic files built like the real writer; the card importer and everything else around them
 * are replaced by recorders, as in `modules.duplicateImport.test.ts`. The toast presenter is a fake.
 *
 * Labels: (RR) fails on the tree before the wiring; (CG) compatibility guard that holds before and after.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { get } from 'svelte/store'
import { patterned, risumBytes } from 'src/ts/process/tests/risumFixtures'

type Stored = { id: string, name?: unknown, description?: string }

const h = vi.hoisted(() => ({
    db: { modules: [] as unknown[], enabledModules: [] as string[] },
    files: [] as File[],
    confirm: true,
    /** the select answers in order; a missing answer is Skip */
    answers: [] as string[],
    /** while set, the duplicate select waits for it before it answers */
    hold: null as null | Promise<void>,
    events: [] as string[],
    marks: [] as number[],
    /** what the shown card's `background` was at each moment a probe ran, by the probe's name */
    probes: [] as { at: string, background: true | undefined, shown: boolean }[],
    probe: null as null | ((at: string) => void),
    ids: 0,
}))

vi.mock('uuid', () => ({ v4: () => 'uuid' + (++h.ids) }))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => { h.probe?.('confirm'); return h.confirm }),
    alertError: vi.fn(),
    alertModuleSelect: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => {
        h.events.push('ask')
        if (h.hold) await h.hold
        return h.answers.shift() ?? '1'
    }),
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

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
        h.probe?.('save:' + data[0])
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
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

vi.mock(import('src/ts/characterCards'), () => ({
    exportCharacterCard: vi.fn(),
    importCharacterFile: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/bootWindow'), () => ({
    markBootWrite: vi.fn(() => {
        h.marks.push(h.db.modules.length)
        h.probe?.('mark')
    }),
}) as unknown as typeof import('src/ts/bootWindow'))

import { importModule } from 'src/ts/process/modules'
import { ReloadGUIPointer } from 'src/ts/stores.svelte'
import {
    alertTask,
    answerTask,
    backgroundOffered,
    backgroundTask,
    confirmTask,
    resetTaskHostForTests,
    setTaskClockForTests,
    setTaskToastPresenter,
    taskConfirmShowing,
    taskHostView,
    taskResultShowing,
    taskShown,
    type TaskToastPresenter,
} from 'src/ts/alertTask.svelte'
import type { TaskClock } from 'src/lib/Nexus/pattern/taskProgress'

const MARK = 'mark'

let ends: { open(): void, end(): void }[] = []

function installPresenter(): void {
    ends = []
    const presenter: TaskToastPresenter = {
        post: (_view, on) => { ends.push(on); return ends.length },
        update: () => { },
        end: () => { },
    }
    setTaskToastPresenter(presenter)
}

const risum = (fileName: string, moduleName: string, over: { records?: Uint8Array[], module?: Record<string, unknown> } = {}) =>
    new File([risumBytes({ records: over.records, module: { name: moduleName, description: 'new', ...over.module } })], fileName)
const list = () => h.db.modules as Stored[]
const installed = (id: string, name: string): Stored => ({ id, name, description: 'old' })
const withAsset = (seed: number) => ({ records: [patterned(8, seed)] })

async function until(condition: () => boolean): Promise<boolean> {
    for (let i = 0; i < 400 && !condition(); i++) {
        if (taskConfirmShowing()) confirmTask()
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return condition()
}

/** Starts the pick; the caller drives and answers the card. */
function start(): Promise<void> {
    return importModule()
}

async function finishWithOk(done: Promise<void>): Promise<void> {
    expect(await until(() => taskResultShowing())).toBe(true)
    answerTask({ kind: 'ok' })
    await done
}

/** Probes the shown card's `background` whenever the flow reaches the named hook. */
function record(): void {
    h.probe = (at) => { h.probes.push({ at, background: taskHostView()?.background, shown: taskShown() }) }
}
const at = (name: string) => h.probes.filter((probe) => probe.at === name)

beforeEach(() => {
    h.db = { modules: [], enabledModules: [] }
    h.files = []
    h.confirm = true
    h.answers = []
    h.hold = null
    h.events = []
    h.marks = []
    h.probes = []
    h.probe = null
    h.ids = 0
    ReloadGUIPointer.set(0)
    const clock: TaskClock = {
        now: () => 0,
        setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
        clearTimeout: () => { },
        hidden: () => false,
    }
    setTaskClockForTests(clock)
    installPresenter()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'info').mockImplementation(() => { })
})

afterEach(() => {
    resetTaskHostForTests()
    vi.restoreAllMocks()
})

describe('when the card first offers the background', () => {
    test('R4-37 (RR): a one-file add has no button during the scan and the low-level question, and one while its assets save', async () => {
        h.files = [risum('a.risum', 'A', { ...withAsset(1), module: { lowLevelAccess: true } })]
        record()
        const done = start()
        await finishWithOk(done)
        expect(at('confirm').map((probe) => probe.background)).toEqual([undefined])
        expect(at('save:' + patterned(8, 1)[0]).map((probe) => probe.background)).toEqual([true])
        expect(list().map((m) => m.name)).toEqual(['A'])
    })

    test('R4-37 (RR): in a batch of adds only the last file is offered, after its own decision', async () => {
        h.files = [risum('a.risum', 'A', withAsset(1)), risum('b.risum', 'B', withAsset(2))]
        record()
        const done = start()
        await finishWithOk(done)
        expect(at('save:' + patterned(8, 1)[0]).map((probe) => probe.background)).toEqual([undefined])
        expect(at('save:' + patterned(8, 2)[0]).map((probe) => probe.background)).toEqual([true])
    })

    test('R4-37 (RR): a Replace in the first file keeps the button away for the second too', async () => {
        h.db.modules = [installed('t', 'A')]
        h.files = [risum('a.risum', 'A', withAsset(1)), risum('b.risum', 'B', withAsset(2))]
        h.answers = ['0']
        record()
        const done = start()
        await finishWithOk(done)
        expect(at('save:' + patterned(8, 1)[0]).map((probe) => probe.background)).toEqual([undefined])
        expect(at('save:' + patterned(8, 2)[0]).map((probe) => probe.background)).toEqual([undefined])
        expect(list().map((m) => m.description)).toEqual(['new', 'new'])
    })

    test('R4-36 (RR): an Add answer after a name collision is offered; a Replace answer is not, and the page is covered at its commit', async () => {
        h.db.modules = [installed('t', 'A')]
        h.files = [risum('a.risum', 'A', withAsset(1))]
        h.answers = ['2']
        record()
        await finishWithOk(start())
        expect(at('save:' + patterned(8, 1)[0]).map((probe) => probe.background)).toEqual([true])

        h.probes = []
        h.db.modules = [installed('t', 'A')]
        h.answers = ['0']
        const done = start()
        expect(await until(() => at(MARK).length === 1)).toBe(true)
        expect(taskHostView()?.background).toBeUndefined()
        expect(backgroundTask()).toBe(false)
        expect(at(MARK)[0].shown).toBe(true)
        await finishWithOk(done)
    })

    test('R4-36 (RR): a Replace answer is never offered, not even while its assets save', async () => {
        h.db.modules = [installed('t', 'A')]
        h.files = [risum('a.risum', 'A', withAsset(1))]
        h.answers = ['0']
        record()
        await finishWithOk(start())
        expect(at('save:' + patterned(8, 1)[0]).map((probe) => probe.background)).toEqual([undefined])
        expect(backgroundTask()).toBe(false)
    })
})

describe('a replaced round', () => {
    test('E-1 (RR): while a replaced Modules round runs no card offers the background, and one does after it ends', async () => {
        h.db.modules = [installed('t', 'A')]
        h.files = [risum('a.risum', 'A', withAsset(1))]
        h.answers = ['2']
        let release: () => void = () => { }
        h.hold = new Promise<void>((resolve) => { release = resolve })
        const done = start()
        expect(await until(() => h.events.includes('ask'))).toBe(true)
        // A drop card takes the slot while the Modules round waits on its duplicate question.
        alertTask({ title: 'Drop', steps: [{ label: 'x' }], background: true })
        expect(backgroundOffered()).toBe(false)
        expect(backgroundTask()).toBe(false)
        release()
        expect(await until(() => h.events.includes('save:' + patterned(8, 1)[0]))).toBe(true)
        expect(backgroundOffered()).toBe(false)
        expect(backgroundTask()).toBe(false)
        await done
        expect(backgroundOffered()).toBe(true)
        expect(list().map((m) => m.description)).toEqual(['old', 'new'])
        resetTaskHostForTests()
    })
})

describe('the module screens', () => {
    test('R4-30 (RR): a round with a Replace moves the pointer before its result is answered, an add-only round does not', async () => {
        h.db.modules = [installed('t', 'A')]
        h.files = [risum('a.risum', 'A')]
        h.answers = ['0']
        const done = start()
        expect(await until(() => taskResultShowing())).toBe(true)
        expect(get(ReloadGUIPointer)).toBe(1)
        answerTask({ kind: 'ok' })
        await done
        // One bump per round with a replace; the answer adds none.
        expect(get(ReloadGUIPointer)).toBe(1)

        ReloadGUIPointer.set(0)
        h.db.modules = []
        h.files = [risum('b.risum', 'B')]
        const adds = start()
        expect(await until(() => taskResultShowing())).toBe(true)
        expect(get(ReloadGUIPointer)).toBe(0)
        answerTask({ kind: 'ok' })
        await adds
        expect(get(ReloadGUIPointer)).toBe(0)
    })
})

describe('write order', () => {
    test('R4-28 (CG): the same pick writes the same events whether the card stays in front or goes to the background', async () => {
        const files = () => [risum('a.risum', 'A', withAsset(1)), risum('b.risum', 'B', withAsset(2))]
        h.files = files()
        await finishWithOk(start())
        const inFront = { events: [...h.events], marks: [...h.marks], names: list().map((m) => m.name) }

        h.events = []
        h.marks = []
        h.db = { modules: [], enabledModules: [] }
        h.files = files()
        let pressed = false
        h.probe = (name) => {
            if (name === 'save:' + patterned(8, 2)[0] && !pressed) {
                pressed = backgroundTask()
            }
        }
        const done = start()
        expect(await until(() => ends.length === 1)).toBe(true)
        expect(pressed).toBe(true)
        // The toast's end acts only once the result is posted.
        let finished = false
        void done.then(() => { finished = true })
        expect(await until(() => { ends[0].end(); return finished })).toBe(true)
        await done
        expect({ events: h.events, marks: h.marks, names: list().map((m) => m.name) }).toEqual(inFront)
    })
})
