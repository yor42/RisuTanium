// @vitest-environment happy-dom

/**
 * A card dropped on the app while a backup restore is open. Real: `importDroppedFile`, the refusal in
 * `backupWorkGuard.ts`, the restore signal, the busy line and the real alert functions over a plain alert store. Replaced:
 * the card importer (a recorder) and the stores module.
 * What is asserted is what the person is left looking at (`displayAlertText` over the store and the line) and that the
 * importer was never called; a refusal that only returned early would leave the first of these empty.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { get, writable } from 'svelte/store'

const h = vi.hoisted(() => ({ imported: [] as string[] }))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: { modules: [] } },
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    importCharacterProcess: vi.fn(async (card: { name: string }) => { h.imported.push(card.name) }),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/process/modules'), () => ({
    readModule: vi.fn(),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/bootWindow'), () => ({
    markBootWrite: vi.fn(),
}) as unknown as typeof import('src/ts/bootWindow'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    importPreset: vi.fn(),
    getDatabase: vi.fn(() => ({ promptInfoInsideChat: false })),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import { alertNormal, alertWait, displayAlertText } from 'src/ts/alert'
import { alertStore } from 'src/ts/stores.svelte'
import { importDroppedFile } from 'src/ts/dropImport'
import { busyRefusalLine, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { beginRestoreRun, resetRestoreInProgressForTests, restorePhase } from 'src/ts/drive/restoreInProgress'
import { language } from 'src/lang'

const card = () => new File([new Uint8Array([1])], 'c.charx')
const shown = () => get(alertStore)
const screen = () => displayAlertText(get(alertStore), get(busyRefusalLine))

beforeEach(() => {
    h.imported = []
    resetBusyActionsForTest()
    resetRestoreInProgressForTests()
    alertStore.set({ type: 'none', msg: '' })
})

afterEach(() => {
    resetBusyActionsForTest()
    resetRestoreInProgressForTests()
})

describe('a card dropped during a restore', () => {
    test('over nothing: refused, not imported, and the existing pop-up is shown', async () => {
        const run = beginRestoreRun()
        await importDroppedFile(card())
        expect(h.imported).toEqual([])
        expect(shown().type).toBe('error')
        expect(screen()).toBe(language.backupLoadWorkInProgress)
        run.end('canceled')
    })

    test('over a restore notice: the notice stays the shown alert, the line is set, nothing is imported', async () => {
        const run = beginRestoreRun()
        alertNormal('store2RestoreNotFlushed')
        await importDroppedFile(card())
        expect(h.imported).toEqual([])
        expect(shown()).toMatchObject({ type: 'normal', msg: 'store2RestoreNotFlushed' })
        expect(get(busyRefusalLine)).toBe(language.backupLoadRefusedLine)
        run.end('canceled')
    })

    test('over a wait: the line is drawn under the wait message and the wait stays', async () => {
        const run = beginRestoreRun()
        alertWait('Loading backup...')
        await importDroppedFile(card())
        expect(h.imported).toEqual([])
        expect(shown().type).toBe('wait')
        expect(screen()).toBe('Loading backup...\n' + language.backupLoadRefusedLine)
        run.end('committed')
        expect(restorePhase()).toBe('pageEnding')
        expect(screen()).toBe('Loading backup...\n' + language.backupLoadRefusedLine)
    })

    test('a refusal line left by a restore that ended live is cleared, and the same drop then imports', async () => {
        const run = beginRestoreRun()
        alertNormal('notice')
        await importDroppedFile(card())
        run.end('failed')
        expect(get(busyRefusalLine)).toBeNull()

        alertStore.set({ type: 'none', msg: '' })
        await importDroppedFile(card())
        expect(h.imported).toEqual(['c.charx'])
    })
})
