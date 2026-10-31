// @vitest-environment happy-dom

/**
 * The re-drain after a restore waits for the notice the restore left on screen. A card that waited in the native queue is
 * imported only after the person has closed a failure message, because the import's own wait would replace it unread.
 * Real: `openedFiles.ts`, `restoreInProgress.ts` and `waitUnreadNotice` of the real alert module over a plain alert store.
 * Faked: the host, the importer and the restore itself (`restoreOpenedBackup`, which posts the failure the real one posts
 * through `alertError`). This module does not mock `waitUnreadNotice`, unlike the other opened-files tests.
 *
 * Titles starting `guard:` pass before and after the change.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { get, writable } from 'svelte/store'

const importedMock = vi.hoisted(() => vi.fn(async (_batch: unknown): Promise<void> => { }))
const restoreMock = vi.hoisted(() => vi.fn())

vi.mock(import('../stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }) as never,
}) as unknown as typeof import('../stores.svelte'))
vi.mock('../characterCards', () => ({
    importOpenedSources: importedMock,
    isOpenedSourceImportable: (name: string) => /\.(charx|risum|risup)$/i.test(name),
}))
vi.mock('../drive/backuplocal', () => ({ restoreOpenedBackup: restoreMock }))
vi.mock('../storage/database.svelte', () => ({ getDatabase: () => ({ didFirstSetup: true }) }))

import { beginRestoreRun, resetRestoreInProgressForTests } from '../drive/restoreInProgress'
import { alertStore as pageStore } from '../stores.svelte'
import { androidOpenedFilesImport, resetOpenedFilesForTests } from './openedFiles'
import { createHostChannelFake, type HostChannelFake } from './hostChannelFake'

const storeBox = { store: pageStore as unknown as { set: (value: { type: string, msg: string }) => void, subscribe: (run: (value: { type: string, msg: string }) => void) => () => void } }

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const settleFew = async () => { for (let i = 0; i < 6; i++) { await settle() } }

let queued: { uri: string, name: string }[][] = []
const take = (): string => {
    const out = JSON.stringify(queued)
    queued = []
    return out
}
const file = (name: string) => [{ uri: 'content://p/' + name, name }]
const shown = () => get(storeBox.store!)

beforeEach(() => {
    queued = []
    importedMock.mockClear()
    restoreMock.mockReset()
    storeBox.store!.set({ type: 'none', msg: '' })
    resetRestoreInProgressForTests()
    resetOpenedFilesForTests()
    window.__risuTaniumOpenedFilesHost = { take }
    delete window.__risuTaniumOpenedFiles
    vi.spyOn(console, 'warn').mockImplementation(() => { })
})

afterEach(() => {
    delete window.__risuTaniumOpenedFilesHost
    delete window.__risuTaniumOpenedFiles
    vi.restoreAllMocks()
})

describe('the re-drain after a restore waits for the notice it left', () => {
    test('R-N397: a card that arrived during an opened restore that failed is imported only after the failure message is closed', async () => {
        let finish: () => void = () => { }
        restoreMock.mockImplementation(() => new Promise<'pageLive'>((resolve) => {
            finish = () => {
                storeBox.store!.set({ type: 'error', msg: 'restore failed' })
                resolve('pageLive')
            }
        }))
        queued = [file('backup.bin')]
        androidOpenedFilesImport()
        await settleFew()
        expect(restoreMock).toHaveBeenCalledTimes(1)
        // The restore is working: a card arrives over progress and stays queued.
        storeBox.store!.set({ type: 'wait', msg: 'Loading backup...' })
        queued = [file('card1.charx')]
        window.__risuTaniumOpenedFiles?.()
        await settleFew()
        expect(importedMock).not.toHaveBeenCalled()
        finish()
        await settleFew()
        expect(shown().type, 'the failure message stays on screen').toBe('error')
        expect(importedMock, 'the import waits for the message').not.toHaveBeenCalled()
        storeBox.store!.set({ type: 'none', msg: '' })
        await settleFew()
        expect(importedMock).toHaveBeenCalledTimes(1)
    })

    test('R-N: a card that waited for a Settings restore that ended live with a failure message is imported only after OK', async () => {
        androidOpenedFilesImport()
        await settleFew()
        const run = beginRestoreRun()
        queued = [file('card1.charx')]
        window.__risuTaniumOpenedFiles?.()
        await settleFew()
        expect(importedMock, 'nothing is taken while the restore asks').not.toHaveBeenCalled()
        expect(queued).toHaveLength(1)
        storeBox.store!.set({ type: 'error', msg: 'restore failed' })
        run.end('failed')
        await settleFew()
        expect(importedMock, 'the import waits for the message').not.toHaveBeenCalled()
        storeBox.store!.set({ type: 'none', msg: '' })
        await settleFew()
        expect(importedMock).toHaveBeenCalledTimes(1)
        expect(queued).toHaveLength(0)
    })

    test('guard: a restore that ends live with nothing on screen imports the waiting card at once', async () => {
        androidOpenedFilesImport()
        await settleFew()
        const run = beginRestoreRun()
        queued = [file('card1.charx')]
        window.__risuTaniumOpenedFiles?.()
        await settleFew()
        run.end('canceled')
        await settleFew()
        expect(importedMock).toHaveBeenCalledTimes(1)
    })

    describe('over the host channel, whose reply keeps the batches until they are confirmed', () => {
        let fake: HostChannelFake

        const answer = async (n: number, result: unknown, through: number) => {
            expect(fake.postedTo('openedFiles', 'take').length, 'the take the host answers was sent').toBeGreaterThan(n)
            const id = fake.postedTo('openedFiles', 'take')[n].id
            fake.deliver(JSON.stringify({ id, result, through }))
            await settleFew()
        }

        beforeEach(() => {
            delete window.__risuTaniumOpenedFilesHost
            fake = createHostChannelFake()
            window.__risuTaniumHost = fake.channel
        })

        afterEach(() => {
            delete window.__risuTaniumHost
        })

        test('T-chan: a reply that lands after a restore began is not confirmed or imported; the host offers it again after a live end', async () => {
            androidOpenedFilesImport()
            await settleFew()
            expect(fake.postedTo('openedFiles', 'take')).toHaveLength(1)
            const run = beginRestoreRun()
            await answer(0, [[{ uri: 'content://x/1', name: 'a.charx' }]], 3)
            expect(importedMock, 'nothing is imported over the restore').not.toHaveBeenCalled()
            expect(fake.postedTo('openedFiles', 'confirm'), 'the held batch is not confirmed').toEqual([])
            run.end('canceled')
            await settleFew()
            expect(fake.postedTo('openedFiles', 'take'), 'a live end takes again').toHaveLength(2)
            await answer(1, [[{ uri: 'content://x/1', name: 'a.charx' }]], 3)
            expect(importedMock).toHaveBeenCalledTimes(1)
            expect(fake.postedTo('openedFiles', 'confirm')).toEqual([{ bridge: 'openedFiles', method: 'confirm', args: [3] }])
        })

        test('T-chain: a drain that starts while a restore is under way asks for nothing', async () => {
            const run = beginRestoreRun()
            androidOpenedFilesImport()
            await settleFew()
            expect(fake.postedTo('openedFiles', 'take'), 'no take is sent over the restore').toHaveLength(0)
            run.end('canceled')
            await settleFew()
            expect(fake.postedTo('openedFiles', 'take'), 'the live end takes').toHaveLength(1)
        })
    })

    test('a restore that landed leaves the card queued for the next page', async () => {
        androidOpenedFilesImport()
        await settleFew()
        const run = beginRestoreRun()
        queued = [file('card1.charx')]
        window.__risuTaniumOpenedFiles?.()
        run.end('committed')
        await settleFew()
        window.__risuTaniumOpenedFiles?.()
        await settleFew()
        expect(importedMock).not.toHaveBeenCalled()
        expect(queued).toHaveLength(1)
    })
})
