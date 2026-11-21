/**
 * `importDroppedFile` in `src/ts/dropImport.ts` on the task card: a dropped module, preset or card runs under one running
 * card and ends on a result card; a drop during a restore is refused before any card opens.
 *
 * The real `dropImport.ts`, `importBatch.ts`, `importProgress.ts` and `alertTask.svelte.ts` run. The module reader, the
 * preset importer and the card importer are recorders that note what they were handed: whether the progress is a task's
 * and whether a running card was shown while they worked.
 *
 * Labels: (RR-m) new behaviour pinned by the mutant that drops the runner; (CG) compatibility guard.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { risumBytes } from 'src/ts/process/tests/risumFixtures'

const h = vi.hoisted(() => ({
    restoring: false,
    refusals: 0,
    modules: [] as unknown[],
    presets: [] as string[],
    ordered: 0,
    /** What each collaborator saw when it ran, by name. */
    seen: [] as Array<{ who: string, tasked: boolean, running: boolean, handedBytes?: number, busy?: string[] }>,
    /** Legacy alerts of every kind. A tasked drop posts none. */
    alerts: [] as string[],
}))

vi.mock(import('src/ts/drive/backupWorkGuard'), () => ({
    refuseImportWhileRestoring: () => {
        if (h.restoring) {
            h.refusals++
        }
        return h.restoring
    },
}) as unknown as typeof import('src/ts/drive/backupWorkGuard'))

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => { h.alerts.push('confirm'); return true }),
    alertError: vi.fn((msg: string | Error) => { h.alerts.push('error:' + (msg instanceof Error ? msg.message : String(msg))) }),
    alertNormal: vi.fn((msg: string) => { h.alerts.push('normal:' + msg) }),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/characterCards'), () => ({
    importCharacterFile: vi.fn(async (_file: unknown, _run: unknown, progress: { tasked: boolean }) => {
        h.seen.push({ who: 'card', tasked: progress.tasked, running: !!taskHostViewNow() && !taskResultShowingNow(), busy: busyKindsNow() })
        return { kind: 'imported', index: 0 }
    }),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(() => { h.ordered++ }),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/process/modules'), () => ({
    readModule: vi.fn(async (source: { size: number, read: (start: number, end: number) => Promise<Uint8Array> }, opts: { progress: { tasked: boolean } }) => {
        const bytes = await source.read(0, source.size)
        h.seen.push({ who: 'module', tasked: opts.progress.tasked, running: !!taskHostViewNow() && !taskResultShowingNow(), handedBytes: bytes.length, busy: busyKindsNow() })
        return { name: 'Synthetic', id: 'x' }
    }),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/bootWindow'), () => ({
    markBootWrite: vi.fn(),
}) as unknown as typeof import('src/ts/bootWindow'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { modules: h.modules } } },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    importPreset: vi.fn(async (f: { name: string }) => {
        h.seen.push({ who: 'preset', tasked: true, running: !!taskHostViewNow() && !taskResultShowingNow(), busy: busyKindsNow() })
        h.presets.push(f.name)
    }),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

import { importDroppedFile } from 'src/ts/dropImport'
import { language } from 'src/lang'
import { answerTask, resetTaskHostForTests, setTaskClockForTests, taskHostView, taskResultShowing, taskShown } from 'src/ts/alertTask.svelte'
import type { TaskClock } from 'src/lib/Nexus/pattern/taskProgress'
import { answerImportCard } from 'src/ts/process/tests/answerImportCard'
import { busyKinds, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'

const busyKindsNow = () => busyKinds().map(String)
const taskHostViewNow = () => taskHostView()
const taskResultShowingNow = () => taskResultShowing()

const risum = risumBytes()
//A synthetic preset body; the importer is a recorder, so only its name and the card around it matter here.
const presetBytes = new TextEncoder().encode('{"name":"synthetic preset"}')
const dropped = (name: string): File => {
    const lower = name.toLowerCase()
    const bytes = lower.endsWith('.risum') ? risum : lower.endsWith('.risup') ? presetBytes : new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    return new File([bytes as BlobPart], name)
}

beforeEach(() => {
    h.restoring = false
    h.refusals = 0
    h.modules = []
    h.presets = []
    h.ordered = 0
    h.seen = []
    h.alerts = []
    let now = 0
    const clock: TaskClock = {
        now: () => (now += 1000),
        setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
        clearTimeout: () => {},
        hidden: () => false,
    }
    setTaskClockForTests(clock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    resetTaskHostForTests()
    setTaskClockForTests(null)
    resetBusyActionsForTest()
    vi.restoreAllMocks()
})

describe('a dropped file under the task card', () => {
    //(RR-m) Without the runner the collaborators get no task progress and no result card is shown.
    test.each([
        ['m.risum', 'module'],
        ['p.risup', 'preset'],
        ['c.png', 'card'],
    ])('R-b20: %s runs under a running card and ends on a result card', async (name, who) => {
        const card = await answerImportCard(() => importDroppedFile(dropped(name)))

        expect(h.seen).toHaveLength(1)
        expect(h.seen[0]).toMatchObject({ who, tasked: true, running: true })
        expect(card?.result?.headline).toBe(language.importTaskImported(1))
        expect(card?.title).toBe(language.importTaskFilesTitle)
        expect(card?.subtitle).toBe(name)
        expect(taskShown()).toBe(false)
        expect(h.alerts).toEqual([])
    })

    //(RR-m) The import scope belongs to the round: held while the file is read, released before the result card waits for its
    //answer, so maintenance and put-back are not paused until OK. A drop that takes a scope of its own before the runner
    //and never ends it leaves it held at the result.
    test.each([
        ['m.risum'],
        ['p.risup'],
        ['c.png'],
    ])('R-b20: %s holds the import scope while it runs and none while the result card shows', async (name) => {
        const done = importDroppedFile(dropped(name))
        let ended = false
        void done.then(() => { ended = true }, () => { ended = true })
        for (const deadline = performance.now() + 10_000; !ended && !taskResultShowing() && performance.now() < deadline;) {
            await new Promise((resolve) => setTimeout(resolve, 0))
        }
        const atResult = busyKinds()
        expect(taskResultShowing()).toBe(true)
        answerTask({ kind: 'ok' })
        await done

        expect(h.seen[0].busy).toContain('import')
        expect(atResult).toEqual([])
        expect(busyKinds()).toEqual([])
    })

    test('R-b20: the dropped module is read from the dropped bytes and added once', async () => {
        await answerImportCard(() => importDroppedFile(dropped('m.risum')))

        expect(h.seen[0].handedBytes).toBe(risum.length)
        expect(h.modules).toEqual([{ name: 'Synthetic', id: 'x' }])
    })

    //(CG) The refusal comes before any card opens; this passes before and after the change.
    test.each(['m.risum', 'p.risup', 'c.png'])('R-b20: %s dropped during a restore is refused before any card opens', async (name) => {
        h.restoring = true

        await expect(importDroppedFile(dropped(name))).resolves.toBeUndefined()

        expect(h.refusals).toBe(1)
        expect(taskShown()).toBe(false)
        expect(h.seen).toEqual([])
        expect(h.modules).toEqual([])
        expect(h.presets).toEqual([])
        expect(h.alerts).toEqual([])
    })
})
