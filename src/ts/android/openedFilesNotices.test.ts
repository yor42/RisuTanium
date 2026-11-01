// @vitest-environment happy-dom

/**
 * An import of opened files posts its outcome (the unsupported-files summary, or
 * an error) without waiting for it to be read. The drain waits for such a notice
 * to close before it starts the first import, the next import or the restore,
 * whose outcome or question would otherwise replace the notice unread. A held
 * take is confirmed to the host only after that wait.
 *
 * Drives the REAL `alert.ts` against a real `writable` standing in for
 * `alertStore` from `stores.svelte`. The import stand-in posts its outcome with
 * the real `alertError` and returns without waiting, as the import batch does;
 * the user's close is the `none` write `AlertComp.svelte` makes.
 *
 * Tests whose title starts with `guard:` pass with or without the fix: they
 * pin behaviour that must be preserved.
 */
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    didFirstSetup: true,
    heldRaw: null as string | null,
}))
const heldConfirmMock = vi.hoisted(() => vi.fn())
const importOpenedSourcesMock = vi.hoisted(() => vi.fn())
const restoreOpenedBackupMock = vi.hoisted(() => vi.fn())

vi.mock(import('../stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('../stores.svelte'))

vi.mock(import('../platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('../platform'))

vi.mock('../characterCards', () => ({
    importOpenedSources: importOpenedSourcesMock,
    // Stand-in for the shared allow-list; the real list is pinned in characterCards.picker.test.ts.
    isOpenedSourceImportable: (name: string) => /\.(charx|risum|risup|risupreset|preset)$/i.test(name),
}))
vi.mock('../drive/backuplocal', () => ({
    restoreOpenedBackup: restoreOpenedBackupMock,
}))
// A held take is what the channel host gives; the rest of the bridge stays real.
vi.mock('./hostBridge', async (importOriginal) => {
    const original = await importOriginal<typeof import('./hostBridge')>()
    return {
        ...original,
        openedFilesTake: (...args: Parameters<typeof original.openedFilesTake>) => {
            if (h.heldRaw === null) {
                return original.openedFilesTake(...args)
            }
            const raw = h.heldRaw
            h.heldRaw = null
            return Promise.resolve({ raw, held: true, confirm: heldConfirmMock })
        },
    }
})
vi.mock('../storage/database.svelte', () => ({
    getDatabase: () => ({ didFirstSetup: h.didFirstSetup }),
}))

import { alertError, alertToast, alertWait } from '../alert'
import { alertStore } from '../stores.svelte'
import { beginRestoreRun, resetRestoreInProgressForTests } from '../drive/restoreInProgress'

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

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const entry = (name: string): HostEntry => ({ uri: `content://provider/${name}`, name })
const closeAlert = () => alertStore.set({ type: 'none', msg: '' })

let order: string[] = []

beforeEach(() => {
    h.didFirstSetup = true
    queued = []
    order = []
    h.heldRaw = null
    heldConfirmMock.mockReset().mockImplementation(() => { order.push('confirm') })
    resetRestoreInProgressForTests()
    closeAlert()
    importOpenedSourcesMock.mockReset().mockImplementation(async (batch: { name: string }[]) => {
        const names = batch.map((item) => item.name).join(',')
        order.push('import:' + names)
        alertError('Not imported: ' + names)
    })
    restoreOpenedBackupMock.mockReset().mockImplementation(async (item: { name: string }) => {
        order.push('restore:' + item.name + ' over ' + get(alertStore).type)
        return 'pageLive'
    })
    resetOpenedFilesForTests()
    window.__risuTaniumOpenedFilesHost = { take: takeMock }
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    delete window.__risuTaniumOpenedFilesHost
    delete window.__risuTaniumOpenedFiles
    vi.restoreAllMocks()
})

describe('notices an import of opened files leaves up', () => {
    test('reproducer: the restore does not start until the unsupported-files notice is closed', async () => {
        queued = [[entry('notes.txt')], [entry('backup.bin')]]
        androidOpenedFilesImport()
        await settle()

        expect(get(alertStore)).toMatchObject({ type: 'error', msg: 'Not imported: notes.txt' })
        expect(restoreOpenedBackupMock).not.toHaveBeenCalled()

        closeAlert()
        await settle()
        expect(order).toEqual(['import:notes.txt', 'restore:backup.bin over none'])
    })

    test('two unsupported batches: the second import waits until the first notice is closed', async () => {
        queued = [[entry('a.txt')], [entry('b.txt')]]
        androidOpenedFilesImport()
        await settle()
        expect(order).toEqual(['import:a.txt'])

        closeAlert()
        await settle()
        expect(order).toEqual(['import:a.txt', 'import:b.txt'])
        closeAlert()
        await settle()
    })

    test('an error the import posts from its own catch is read before the restore', async () => {
        importOpenedSourcesMock.mockImplementationOnce(async () => {
            order.push('import-failed')
            alertError(new Error('boom'))
        })
        queued = [[entry('notes.txt')], [entry('backup.bin')]]
        androidOpenedFilesImport()
        await settle()
        expect(restoreOpenedBackupMock).not.toHaveBeenCalled()

        closeAlert()
        await settle()
        expect(order).toEqual(['import-failed', 'restore:backup.bin over none'])
    })

    test('reproducer: the first import waits until a notice already on screen is closed', async () => {
        alertError('This file is cut short')
        queued = [[entry('a.charx')]]
        androidOpenedFilesImport()
        await settle()
        expect(order).toEqual([])
        expect(get(alertStore)).toMatchObject({ type: 'error', msg: 'This file is cut short' })

        closeAlert()
        await settle()
        expect(order).toEqual(['import:a.charx'])
        closeAlert()
        await settle()
    })

    test('reproducer: a held take is not confirmed while an unread notice holds the first import', async () => {
        alertError('This file is cut short')
        h.heldRaw = JSON.stringify([[entry('a.charx')]])
        androidOpenedFilesImport()
        await settle()
        expect(order).toEqual([])

        closeAlert()
        await settle()
        expect(order).toEqual(['confirm', 'import:a.charx'])
        closeAlert()
        await settle()
    })

    test('reproducer: a held take whose wait spans a restore start is parked, not confirmed', async () => {
        alertError('This file is cut short')
        h.heldRaw = JSON.stringify([[entry('a.charx')]])
        androidOpenedFilesImport()
        await settle()

        const run = beginRestoreRun()
        closeAlert()
        await settle()
        expect(order).toEqual([])
        expect(heldConfirmMock).not.toHaveBeenCalled()
        run.end('canceled')
    })

    test('guard: a wait or a toast left up does not hold the drain', async () => {
        importOpenedSourcesMock.mockImplementationOnce(async () => {
            order.push('import:wait')
            alertWait('Still working')
        }).mockImplementationOnce(async () => {
            order.push('import:toast')
            alertToast('Imported')
        })
        queued = [[entry('a.charx')], [entry('b.charx')]]
        androidOpenedFilesImport()
        await settle()

        expect(order).toEqual(['import:wait', 'import:toast'])
    })

    test('guard: an import that leaves nothing up goes straight on to the next step', async () => {
        importOpenedSourcesMock.mockImplementation(async (batch: { name: string }[]) => {
            order.push('import:' + batch.map((item) => item.name).join(','))
        })
        queued = [[entry('a.charx')], [entry('b.charx')]]
        androidOpenedFilesImport()
        await settle()

        expect(order).toEqual(['import:a.charx', 'import:b.charx'])
    })
})
