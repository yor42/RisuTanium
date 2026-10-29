// @vitest-environment happy-dom

/**
 * Where a `.bin` opened from another Android app goes. A drain is one `take()`. A backup is restored only when it is the
 * one backup of its batch and the drain imports nothing else (a restore would replace what the imports just added); an
 * unsupported name such as a PNG does not count as an import. Every other `.bin` is refused, all refusals of a kind in one
 * awaited notice: the notice that a backup was not opened alone comes after every import of the drain, and the notice that
 * only one backup restores at a time is closed before the restore asks its confirmation.
 *
 * These tests pin the routing rules; they are not labelled one by one as reproducers or guards.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { language } from 'src/lang'

const h = vi.hoisted(() => ({
    didFirstSetup: false,
}))
const importOpenedSourcesMock = vi.hoisted(() => vi.fn())
const alertNormalWaitMock = vi.hoisted(() => vi.fn())
const restoreOpenedBackupMock = vi.hoisted(() => vi.fn())

vi.mock(import('../stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('../stores.svelte'))
vi.mock('../characterCards', () => ({
    importOpenedSources: importOpenedSourcesMock,
    // Stand-in for the shared allow-list; the real list is pinned against the import in characterCards.picker.test.ts.
    isOpenedSourceImportable: (name: string) => /\.(charx|risum|risup|risupreset|preset)$/i.test(name),
}))
vi.mock('../alert', () => ({
    alertNormalWait: alertNormalWaitMock,
    waitUnreadNotice: async () => { },
}))
vi.mock('../drive/backuplocal', () => ({
    restoreOpenedBackup: restoreOpenedBackupMock,
}))
vi.mock('../storage/database.svelte', () => ({
    getDatabase: () => ({ didFirstSetup: h.didFirstSetup }),
}))

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

/** A promise the test settles by hand, to hold a step open and see what runs meanwhile. */
function deferred(): { promise: Promise<void>, release: () => void } {
    let release: () => void = () => { }
    const promise = new Promise<void>((resolve) => { release = resolve })
    return { promise, release }
}

let order: string[] = []

beforeEach(() => {
    h.didFirstSetup = true
    queued = []
    order = []
    takeMock.mockClear()
    importOpenedSourcesMock.mockReset().mockImplementation(async (batch: { name: string }[]) => {
        order.push('import:' + batch.map((item) => item.name).join(','))
    })
    alertNormalWaitMock.mockReset().mockImplementation(async (message: string) => {
        order.push('notice:' + message)
    })
    restoreOpenedBackupMock.mockReset().mockImplementation(async (item: { name: string }) => {
        order.push('restore:' + item.name)
        return 'pageLive'
    })
    resetOpenedFilesForTests()
    delete window.__risuTaniumOpenedFiles
    window.__risuTaniumOpenedFilesHost = { take: takeMock }
    vi.spyOn(console, 'warn').mockImplementation(() => { })
})

afterEach(() => {
    delete window.__risuTaniumOpenedFilesHost
    delete window.__risuTaniumOpenedFiles
    vi.restoreAllMocks()
})

describe('a .bin opened from another app', () => {
    test('a lone .bin in a drain with a card is refused, the card imports, and the notice comes after the import', async () => {
        const importing = deferred()
        importOpenedSourcesMock.mockImplementationOnce(async () => {
            order.push('import-start')
            await importing.promise
            order.push('import-end')
        })
        queued = [[entry('card.charx')], [entry('backup.bin')]]
        androidOpenedFilesImport()
        await settle()
        expect(order).toEqual(['import-start'])
        importing.release()
        await settle()
        expect(restoreOpenedBackupMock).not.toHaveBeenCalled()
        expect(order).toEqual(['import-start', 'import-end', 'notice:' + language.openedBackupNotAlone(['backup.bin'])])
    })

    test('the not-alone notice is awaited: a later drain does not start until it is closed', async () => {
        const closed = deferred()
        alertNormalWaitMock.mockImplementationOnce(async () => {
            order.push('notice-open')
            await closed.promise
            order.push('notice-closed')
        })
        queued = [[entry('card.charx')], [entry('backup.bin')]]
        androidOpenedFilesImport()
        await settle()
        queued = [[entry('later.charx')]]
        window.__risuTaniumOpenedFiles?.()
        await settle()
        expect(order).toEqual(['import:card.charx', 'notice-open'])
        closed.release()
        await settle()
        expect(order).toEqual(['import:card.charx', 'notice-open', 'notice-closed', 'import:later.charx'])
    })

    test('every .bin of the drain is named in one notice', async () => {
        queued = [[entry('card.charx')], [entry('one.bin')], [entry('two.BIN')]]
        androidOpenedFilesImport()
        await settle()
        expect(alertNormalWaitMock).toHaveBeenCalledTimes(1)
        expect(alertNormalWaitMock).toHaveBeenCalledWith(language.openedBackupNotAlone(['one.bin', 'two.BIN']))
        expect(restoreOpenedBackupMock).not.toHaveBeenCalled()
    })

    test('a .png beside a lone .bin does not block the restore, and the .png goes to the import to be refused as today', async () => {
        queued = [[entry('notes.png')], [entry('backup.bin')]]
        androidOpenedFilesImport()
        await settle()
        expect(restoreOpenedBackupMock).toHaveBeenCalledTimes(1)
        expect(restoreOpenedBackupMock).toHaveBeenCalledWith({ name: 'backup.bin', path: 'content://provider/backup.bin' })
        expect(importOpenedSourcesMock).toHaveBeenCalledWith([{ name: 'notes.png', path: 'content://provider/notes.png' }])
        expect(alertNormalWaitMock).not.toHaveBeenCalled()
    })

    test('guard: a lone .bin alone in the drain is restored once and nothing is imported or announced', async () => {
        queued = [[entry('backup.bin')]]
        androidOpenedFilesImport()
        await settle()
        expect(order).toEqual(['restore:backup.bin'])
        expect(importOpenedSourcesMock).not.toHaveBeenCalled()
    })

    test('a .bin in a multi-entry batch is refused while the others import', async () => {
        queued = [[entry('card.charx'), entry('backup.bin'), entry('preset.risup')]]
        androidOpenedFilesImport()
        await settle()
        expect(importOpenedSourcesMock).toHaveBeenCalledTimes(1)
        expect(importOpenedSourcesMock.mock.calls[0][0].map((item: { name: string }) => item.name)).toEqual(['card.charx', 'preset.risup'])
        expect(restoreOpenedBackupMock).not.toHaveBeenCalled()
        expect(alertNormalWaitMock).toHaveBeenCalledWith(language.openedBackupNotAlone(['backup.bin']))
    })

    test('reproducer: a .png shared in the same batch as one .bin does not block the restore, and the .png goes to the import to be refused', async () => {
        queued = [[entry('backup.bin'), entry('notes.png')]]
        androidOpenedFilesImport()
        await settle()
        expect(restoreOpenedBackupMock).toHaveBeenCalledTimes(1)
        expect(restoreOpenedBackupMock).toHaveBeenCalledWith({ name: 'backup.bin', path: 'content://provider/backup.bin' })
        expect(importOpenedSourcesMock).toHaveBeenCalledWith([{ name: 'notes.png', path: 'content://provider/notes.png' }])
        expect(order).toEqual(['import:notes.png', 'restore:backup.bin'])
        expect(alertNormalWaitMock).not.toHaveBeenCalled()
    })

    test('a .bin shared with an unsupported file and a card in one batch is refused while the card imports', async () => {
        queued = [[entry('backup.bin'), entry('notes.txt'), entry('card.charx')]]
        androidOpenedFilesImport()
        await settle()
        expect(restoreOpenedBackupMock).not.toHaveBeenCalled()
        expect(importOpenedSourcesMock.mock.calls[0][0].map((item: { name: string }) => item.name)).toEqual(['notes.txt', 'card.charx'])
        expect(alertNormalWaitMock).toHaveBeenCalledWith(language.openedBackupNotAlone(['backup.bin']))
    })

    test('two .bin in one batch beside an unsupported file are both refused and nothing is restored', async () => {
        queued = [[entry('one.bin'), entry('two.bin'), entry('notes.png')]]
        androidOpenedFilesImport()
        await settle()
        expect(restoreOpenedBackupMock).not.toHaveBeenCalled()
        expect(alertNormalWaitMock).toHaveBeenCalledWith(language.openedBackupNotAlone(['one.bin', 'two.bin']))
    })

    test('two lone .bin: the first restores, and the one-at-a-time notice is closed before the restore starts', async () => {
        const closed = deferred()
        alertNormalWaitMock.mockImplementationOnce(async (message: string) => {
            order.push('notice-open:' + message)
            await closed.promise
            order.push('notice-closed')
        })
        queued = [[entry('first.bin')], [entry('second.bin')], [entry('third.bin')]]
        androidOpenedFilesImport()
        await settle()
        expect(order).toEqual(['notice-open:' + language.openedBackupOneAtATime(['second.bin', 'third.bin'])])
        expect(restoreOpenedBackupMock).not.toHaveBeenCalled()
        closed.release()
        await settle()
        expect(order.slice(1)).toEqual(['notice-closed', 'restore:first.bin'])
        expect(alertNormalWaitMock).toHaveBeenCalledTimes(1)
    })

    test('a restore that throws is logged and a later drain still works', async () => {
        restoreOpenedBackupMock.mockRejectedValueOnce(new Error('boom'))
        queued = [[entry('backup.bin')]]
        androidOpenedFilesImport()
        await settle()
        queued = [[entry('card.charx')]]
        window.__risuTaniumOpenedFiles?.()
        await settle()
        expect(importOpenedSourcesMock).toHaveBeenCalledTimes(1)
    })

    test('guard: before first setup a .bin stays with the host; after setup it is restored', async () => {
        h.didFirstSetup = false
        queued = [[entry('backup.bin')]]
        androidOpenedFilesImport()
        await settle()
        expect(takeMock).not.toHaveBeenCalled()
        expect(restoreOpenedBackupMock).not.toHaveBeenCalled()
        expect(queued).toHaveLength(1)

        h.didFirstSetup = true
        window.__risuTaniumOpenedFiles?.()
        await settle()
        expect(restoreOpenedBackupMock).toHaveBeenCalledTimes(1)
    })

    test('after a restore that ended the page, a later hook with a card takes nothing and imports nothing', async () => {
        restoreOpenedBackupMock.mockResolvedValueOnce('pageEnding')
        queued = [[entry('backup.bin')]]
        androidOpenedFilesImport()
        await settle()
        expect(takeMock).toHaveBeenCalledTimes(1)
        queued = [[entry('card.charx')]]
        window.__risuTaniumOpenedFiles?.()
        await settle()
        expect(takeMock).toHaveBeenCalledTimes(1)
        expect(importOpenedSourcesMock).not.toHaveBeenCalled()
        expect(queued).toHaveLength(1)
    })
})
