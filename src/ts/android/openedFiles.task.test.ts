// @vitest-environment happy-dom

/**
 * The opened-files drain and an import card. A share that arrives while a result card is unanswered waits, and it keeps
 * waiting through a Retry round of that action: it runs only after the action's final answer.
 *
 * The real `alert.ts`, `alertTask.svelte.ts`, `importBatch.ts` and `busyActions.ts` run; the import of the share itself
 * is a recorder, and `alertStore` is a plain writable.
 *
 * Labels: (CG) compatibility guard, passes before and after the change; (RR) fails without the action-wide wait.
 */
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const importOpenedSourcesMock = vi.hoisted(() => vi.fn())

vi.mock(import('../stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('../stores.svelte'))

vi.mock(import('../platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('../platform'))

vi.mock('../characterCards', () => ({
    importOpenedSources: importOpenedSourcesMock,
    isOpenedSourceImportable: (name: string) => /\.(charx|risum|png|json)$/i.test(name),
}))
vi.mock('../drive/backuplocal', () => ({
    restoreOpenedBackup: vi.fn(async () => 'pageLive'),
}))
vi.mock('../storage/database.svelte', () => ({
    getDatabase: () => ({ didFirstSetup: true }),
}))

import { answerTask, resetTaskHostForTests, setTaskClockForTests, taskResultShowing } from '../alertTask.svelte'
import { runImportBatch, type ImportItem } from '../importBatch'
import { resetRestoreInProgressForTests } from '../drive/restoreInProgress'
import type { TaskClock } from '../../lib/Nexus/pattern/taskProgress'

const { androidOpenedFilesImport, resetOpenedFilesForTests } = await import('./openedFiles')

interface HostEntry {
    uri: string
    name: string
}

let queued: HostEntry[][] = []
const takeMock = vi.fn((): string => {
    const out = JSON.stringify(queued)
    queued = []
    return out
})

const settle = async () => {
    for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
}
const entry = (name: string): HostEntry => ({ uri: `content://provider/${name}`, name })
const TASK = { title: 'Importing', steps: ['read', 'check', 'assets', 'add'] as const }

let order: string[] = []

beforeEach(() => {
    queued = []
    order = []
    resetRestoreInProgressForTests()
    let now = 0
    const clock: TaskClock = {
        now: () => (now += 1000),
        setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
        clearTimeout: () => {},
        hidden: () => false,
    }
    setTaskClockForTests(clock)
    importOpenedSourcesMock.mockReset().mockImplementation(async (batch: { name: string }[]) => {
        order.push('import:' + batch.map((item) => item.name).join(','))
    })
    resetOpenedFilesForTests()
    window.__risuTaniumOpenedFilesHost = { take: takeMock }
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    resetTaskHostForTests()
    delete window.__risuTaniumOpenedFilesHost
    delete window.__risuTaniumOpenedFiles
    vi.restoreAllMocks()
})

//An action whose only file fails in its first round and, in the Retry round, runs until `release` is called.
function retryableAction() {
    let release: () => void = () => { }
    const held = new Promise<void>((resolve) => { release = resolve })
    let attempts = 0
    const item: ImportItem = {
        name: 'x.png',
        run: async () => {
            attempts += 1
            if (attempts === 1) {
                return { kind: 'failed', error: new Error('store full') }
            }
            await held
            return { kind: 'imported', index: null }
        },
    }
    return { action: runImportBatch([item], { task: TASK }), release }
}

async function untilResult(): Promise<void> {
    for (let i = 0; i < 400 && !taskResultShowing(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
}

describe('a share that arrives under an import card', () => {
    test('R-b23 (CG): a share waits while a result card is unanswered and runs after its answer', async () => {
        const { action } = retryableAction()
        await untilResult()
        queued = [[entry('share.charx')]]
        androidOpenedFilesImport()
        await settle()
        expect(order).toEqual([])

        answerTask({ kind: 'ok' })
        await action
        await settle()
        expect(order).toEqual(['import:share.charx'])
    })

    test('E8 (RR): pressing Retry does not release the share; it runs after the final OK of the action', async () => {
        const { action, release } = retryableAction()
        await untilResult()
        queued = [[entry('share.charx')]]
        androidOpenedFilesImport()
        await settle()
        expect(order).toEqual([])

        //The Retry round is running: its card is not a result yet, and the share must still be deferred.
        answerTask({ kind: 'action', id: 'retry' })
        await settle()
        expect(taskResultShowing()).toBe(false)
        expect(order).toEqual([])

        //The retry round's own result is showing: still deferred.
        release()
        await untilResult()
        await settle()
        expect(taskResultShowing()).toBe(true)
        expect(order).toEqual([])

        answerTask({ kind: 'ok' })
        await action
        await settle()
        expect(order).toEqual(['import:share.charx'])
    })
})
