// @vitest-environment happy-dom

/**
 * A take whose reply lands late, after the moment that sent it has moved on. Over the host channel the reply keeps the
 * batches until they are confirmed, so a reply that no longer fits the restore's state is not confirmed: the host offers
 * the batches again, and the module takes them again at the right time.
 * - T-held-none: the take was sent over a restore question (a refusal), and the restore ended live with a failure message
 *   on screen before the reply came. The re-take waits for the message to be closed, because the import's own wait would
 *   replace it unread.
 * - T-held-working: the reply comes while the restore works. It is not confirmed; a live end takes again and imports once,
 *   and a landed restore leaves the batches for the next page.
 * Real: `openedFiles.ts`, `restoreInProgress.ts`, `hostBridge.ts` over the channel fake, and `waitUnreadNotice` of the real
 * alert module over a plain alert store. Faked: the host channel, the importer and the restore's own signal (a run).
 *
 * T-held-none is a compatibility guard against the layered rule (red only with the mutant that re-drains without the
 * notice wait); T-held-working is a compatibility guard as well: the chained drain's start check already holds the take
 * back, so the held branch in `working` is covered only together with that check.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { get, writable } from 'svelte/store'

const importedMock = vi.hoisted(() => vi.fn(async (_batch: unknown): Promise<void> => { }))

vi.mock(import('../stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }) as never,
}) as unknown as typeof import('../stores.svelte'))
vi.mock('../characterCards', () => ({
    importOpenedSources: importedMock,
    isOpenedSourceImportable: (name: string) => /\.(charx|risum|risup)$/i.test(name),
}))
vi.mock('../drive/backuplocal', () => ({ restoreOpenedBackup: vi.fn() }))
vi.mock('../storage/database.svelte', () => ({ getDatabase: () => ({ didFirstSetup: true }) }))

import { beginRestoreRun, resetRestoreInProgressForTests } from '../drive/restoreInProgress'
import { beginBusy, resetBusyActionsForTest } from '../process/memory/busyActions'
import { alertStore as pageStore } from '../stores.svelte'
import { androidOpenedFilesImport, resetOpenedFilesForTests } from './openedFiles'
import { createHostChannelFake, type HostChannelFake } from './hostChannelFake'

const storeBox = { store: pageStore as unknown as { set: (value: { type: string, msg: string }) => void, subscribe: (run: (value: { type: string, msg: string }) => void) => () => void } }

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const settleFew = async () => { for (let i = 0; i < 6; i++) { await settle() } }

const batch = [[{ uri: 'content://x/1', name: 'a.charx' }]]
const HELD_THROUGH = 5

let fake: HostChannelFake

/** The host answers the nth take it was sent. */
const answer = async (n: number, result: unknown, through: number) => {
    expect(fake.postedTo('openedFiles', 'take').length, 'the take the host answers was sent').toBeGreaterThan(n)
    const id = fake.postedTo('openedFiles', 'take')[n].id
    fake.deliver(JSON.stringify({ id, result, through }))
    await settleFew()
}
const takesSent = () => fake.postedTo('openedFiles', 'take').length
const confirmsSent = () => fake.postedTo('openedFiles', 'confirm')

beforeEach(() => {
    importedMock.mockClear()
    resetBusyActionsForTest()
    storeBox.store.set({ type: 'none', msg: '' })
    resetRestoreInProgressForTests()
    resetOpenedFilesForTests()
    delete window.__risuTaniumOpenedFilesHost
    delete window.__risuTaniumOpenedFiles
    fake = createHostChannelFake()
    window.__risuTaniumHost = fake.channel
    vi.spyOn(console, 'warn').mockImplementation(() => { })
})

afterEach(() => {
    delete window.__risuTaniumHost
    delete window.__risuTaniumOpenedFiles
    resetBusyActionsForTest()
    vi.restoreAllMocks()
})

describe('a held reply that lands after the restore moved on', () => {
    test('T-held-none: a take sent over a restore question, answered after the restore ended live with an error shown, is imported only after OK', async () => {
        androidOpenedFilesImport()
        await settleFew()
        await answer(0, [], 0)
        const run = beginRestoreRun()
        storeBox.store.set({ type: 'select', msg: 'pick' })
        window.__risuTaniumOpenedFiles?.()
        await settleFew()
        expect(takesSent(), 'the card over the question is taken to be refused').toBe(2)
        // The restore ends live with a failure message before the reply comes.
        storeBox.store.set({ type: 'error', msg: 'restore failed' })
        run.end('failed')
        await settleFew()

        await answer(1, batch, HELD_THROUGH)

        expect(confirmsSent(), 'a reply that no longer fits is not confirmed').toEqual([])
        expect(importedMock, 'nothing is imported over the message').not.toHaveBeenCalled()
        expect(takesSent(), 'the re-take waits for the message to be closed').toBe(2)
        expect(get(storeBox.store as never) as { type: string }).toMatchObject({ type: 'error' })

        storeBox.store.set({ type: 'none', msg: '' })
        await settleFew()
        expect(takesSent(), 'closing the message takes again').toBe(3)
        await answer(2, batch, HELD_THROUGH)
        expect(importedMock).toHaveBeenCalledTimes(1)
        expect(confirmsSent()).toEqual([{ bridge: 'openedFiles', method: 'confirm', args: [HELD_THROUGH] }])
    })

    test('T-held-working: a take sent over a restore question, answered while the restore works, is not confirmed; a live end imports it once', async () => {
        androidOpenedFilesImport()
        await settleFew()
        await answer(0, [], 0)
        const run = beginRestoreRun()
        storeBox.store.set({ type: 'select', msg: 'pick' })
        window.__risuTaniumOpenedFiles?.()
        await settleFew()
        expect(takesSent()).toBe(2)
        // The person picked: the restore works now.
        storeBox.store.set({ type: 'none', msg: '' })
        const work = beginBusy('backupLoad')

        await answer(1, batch, HELD_THROUGH)

        expect(confirmsSent(), 'a take answered over the working restore is not confirmed').toEqual([])
        expect(importedMock).not.toHaveBeenCalled()
        expect(takesSent(), 'no take is sent while the restore works').toBe(2)
        work.end()
        run.end('failed')
        await settleFew()
        expect(takesSent(), 'the live end takes again').toBe(3)
        await answer(2, batch, HELD_THROUGH)
        expect(importedMock).toHaveBeenCalledTimes(1)
        expect(confirmsSent()).toEqual([{ bridge: 'openedFiles', method: 'confirm', args: [HELD_THROUGH] }])
    })

    test('T-held-working: after a landed restore the held batches stay unconfirmed and a fresh page imports them', async () => {
        androidOpenedFilesImport()
        await settleFew()
        await answer(0, [], 0)
        const run = beginRestoreRun()
        storeBox.store.set({ type: 'select', msg: 'pick' })
        window.__risuTaniumOpenedFiles?.()
        await settleFew()
        storeBox.store.set({ type: 'none', msg: '' })
        const work = beginBusy('backupLoad')
        await answer(1, batch, HELD_THROUGH)
        work.end()
        run.end('committed')
        await settleFew()

        expect(takesSent(), 'a page that is ending takes nothing more').toBe(2)
        expect(confirmsSent()).toEqual([])
        expect(importedMock).not.toHaveBeenCalled()

        // The next page: a fresh module state over the same host.
        resetRestoreInProgressForTests()
        resetOpenedFilesForTests()
        fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        androidOpenedFilesImport()
        await settleFew()
        await answer(0, batch, HELD_THROUGH)
        expect(importedMock).toHaveBeenCalledTimes(1)
        expect(confirmsSent()).toEqual([{ bridge: 'openedFiles', method: 'confirm', args: [HELD_THROUGH] }])
    })
})
