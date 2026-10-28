/**
 * A backup load refused while another registered action runs shows today's
 * pop-up and also a line that the wait and progress alerts carry under their
 * message until the last registered action ends. The pop-up alone is replaced
 * by the running job's next progress write, so without the line the refusal
 * would vanish unread.
 *
 * Drives the REAL `alert.ts`, `exportCancel.ts`, guard and busy registry
 * against a real `writable` standing in for `alertStore` from `stores.svelte`.
 * The text shown is read through `displayAlertText`, the seam `AlertComp.svelte`
 * renders wait and progress messages through; the modules are read as
 * namespaces so a missing seam fails an assertion, not the import.
 *
 * Tests whose title starts with `guard:` pass with or without the fix: they
 * pin behaviour that must be preserved.
 */
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { alertData } from '../../alert'

const chatWork = vi.hoisted(() => ({ running: false }))

vi.mock(import('../../stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('../../stores.svelte'))

vi.mock(import('../../storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
}) as unknown as typeof import('../../storage/database.svelte'))

vi.mock(import('../../platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('../../platform'))

vi.mock(import('../../process/chatOrigin'), () => ({
    isWorkInProgress: () => chatWork.running,
}) as unknown as typeof import('../../process/chatOrigin'))

import { language } from '../../../lang'
import * as alertModule from '../../alert'
import * as busyModule from '../../process/memory/busyActions'
import { alertStore } from '../../stores.svelte'
import { ExportCancelToken, createExportWaitGate } from '../../exportCancel'
import { refuseBackupLoadWhileBusy } from '../backupWorkGuard'

const { beginBusy, beginChokePoint, resetBusyActionsForTest } = busyModule

function currentLine(): string | null {
    return busyModule.busyRefusalLine ? get(busyModule.busyRefusalLine) : null
}

/** What the alert on screen shows; before the seam existed that was the message alone. */
function shownText(value: alertData = get(alertStore)): string {
    return typeof alertModule.displayAlertText === 'function'
        ? alertModule.displayAlertText(value, currentLine())
        : value.msg
}

beforeEach(() => {
    resetBusyActionsForTest()
    chatWork.running = false
    alertStore.set({ type: 'none', msg: '' })
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    resetBusyActionsForTest()
    vi.restoreAllMocks()
})

describe('a backup load refused while an export runs', () => {
    test('reproducer: the export\'s next progress keeps showing the refusal until the export ends', () => {
        const exporting = beginBusy('export')
        const gate = createExportWaitGate(new ExportCancelToken(), false)
        gate.wait('Saving 10%')

        expect(refuseBackupLoadWhileBusy()).toBe(true)
        gate.wait('Saving 20%')
        const posted = get(alertStore)

        expect(shownText()).toBe('Saving 20%\n' + language.backupLoadRefusedLine)
        expect(posted.msg).toBe('Saving 20%')

        exporting.end()
        expect(shownText(posted)).toBe('Saving 20%')
    })

    test('guard: the gate still finds its own wait in the store, so its clear still closes it', () => {
        const exporting = beginBusy('export')
        const gate = createExportWaitGate(new ExportCancelToken(), true)
        gate.wait('Saving 10%')
        refuseBackupLoadWhileBusy()
        gate.wait('Saving 20%')

        // A cancellable wait keeps its cancel action, which is what draws the Cancel button.
        expect(get(alertStore).onCancel).toBeTypeOf('function')
        gate.clear()

        expect(get(alertStore).type).toBe('none')
        exporting.end()
    })

    test('the refusal still posts today\'s pop-up at once', () => {
        beginBusy('export')
        alertModule.alertWait('Saving 10%')

        refuseBackupLoadWhileBusy()

        expect(get(alertStore)).toMatchObject({ type: 'error', msg: language.backupLoadWorkInProgress })
        expect(currentLine()).toBe(language.backupLoadRefusedLine)
    })
})

describe('when the line is set and cleared', () => {
    test('guard: a refusal caused only by chat work posts the pop-up and sets no line', () => {
        chatWork.running = true

        expect(refuseBackupLoadWhileBusy()).toBe(true)

        expect(get(alertStore).type).toBe('error')
        expect(currentLine()).toBeNull()
    })

    test('guard: a refusal caused only by a choke-point write sets no line', () => {
        const point = beginChokePoint('asset')

        expect(refuseBackupLoadWhileBusy()).toBe(true)

        expect(currentLine()).toBeNull()
        point()
    })

    test('guard: the caller\'s own entry does not set the line when chat work is the cause', () => {
        const own = beginBusy('backupLoad')
        chatWork.running = true

        expect(refuseBackupLoadWhileBusy(own)).toBe(true)

        expect(currentLine()).toBeNull()
        own.end()
    })

    test('another entry beside the caller\'s own sets the line', () => {
        const own = beginBusy('backupLoad')
        const other = beginBusy('import')

        expect(refuseBackupLoadWhileBusy(own)).toBe(true)

        expect(currentLine()).toBe(language.backupLoadRefusedLine)
        other.end()
        own.end()
    })

    test('the line stays while one of two entries ends and clears when the last one ends', () => {
        const first = beginBusy('export')
        const second = beginBusy('import')
        refuseBackupLoadWhileBusy()

        first.end()
        expect(currentLine()).toBe(language.backupLoadRefusedLine)

        second.end()
        expect(currentLine()).toBeNull()
    })

    test('guard: the test reset clears the line', () => {
        beginBusy('export')
        refuseBackupLoadWhileBusy()

        resetBusyActionsForTest()

        expect(currentLine()).toBeNull()
    })
})

describe('displayAlertText', () => {
    const line = 'refused'

    test('appends the line to a wait and a progress', () => {
        expect(alertModule.displayAlertText({ type: 'wait', msg: 'Loading' }, line)).toBe('Loading\nrefused')
        expect(alertModule.displayAlertText({ type: 'progress', msg: 'Saving', submsg: '40' }, line)).toBe('Saving\nrefused')
    })

    test('leaves every other type, and a wait without a line, as it is', () => {
        expect(alertModule.displayAlertText({ type: 'error', msg: 'Broken' }, line)).toBe('Broken')
        expect(alertModule.displayAlertText({ type: 'normal', msg: 'Done' }, line)).toBe('Done')
        expect(alertModule.displayAlertText({ type: 'ask', msg: 'Sure?' }, line)).toBe('Sure?')
        expect(alertModule.displayAlertText({ type: 'wait', msg: 'Loading' }, null)).toBe('Loading')
    })

    test('does not touch the stored alert or its progress width', () => {
        const value: alertData = { type: 'progress', msg: 'Saving', submsg: '40' }

        alertModule.displayAlertText(value, line)

        expect(value).toEqual({ type: 'progress', msg: 'Saving', submsg: '40' })
    })
})
