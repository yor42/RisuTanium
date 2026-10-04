/**
 * `refuseBackupLoadWhileBusy` refuses a backup load while any registered action
 * other than the caller's own, or any write choke point, is in flight.
 *
 * Guards named `guard:` pin behaviour that must be preserved; the others are
 * regression tests for the behaviour they name.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const alertErrorMock = vi.hoisted(() => vi.fn())
const chatWork = vi.hoisted(() => ({ running: false }))

vi.mock(import('../../alert'), () => ({
    alertError: alertErrorMock,
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../process/chatOrigin'), () => ({
    isWorkInProgress: () => chatWork.running,
}) as unknown as typeof import('../../process/chatOrigin'))

import { language } from '../../../lang'
import { refuseBackupLoadWhileBusy } from '../backupWorkGuard'
import {
    beginBusy,
    beginChokePoint,
    busyKinds,
    isBusy,
    resetBusyActionsForTest,
    type BusyKind,
    type ChokePoint,
} from '../../process/memory/busyActions'

beforeEach(() => {
    resetBusyActionsForTest()
    alertErrorMock.mockReset()
    chatWork.running = false
})

afterEach(() => {
    resetBusyActionsForTest()
})

const busyKindsThatRefuse: BusyKind[] = ['import', 'export', 'cleanup', 'assetAdd', 'imageAdd', 'backupSave', 'integrityCheck', 'hypaBulk', 'mcpWrite']
const chokePointsThatRefuse: ChokePoint[] = ['asset', 'inlay', 'coldStorage', 'pluginBridge']

describe('refuseBackupLoadWhileBusy', () => {
    test('guard: nothing registered: does not refuse and shows nothing', () => {
        expect(refuseBackupLoadWhileBusy()).toBe(false)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('guard: chat work in progress refuses even for a registered caller', () => {
        const own = beginBusy('backupLoad')
        chatWork.running = true

        expect(refuseBackupLoadWhileBusy(own)).toBe(true)
        expect(alertErrorMock).toHaveBeenCalledWith(language.backupLoadWorkInProgress)
    })

    test.each(busyKindsThatRefuse)('a registered %s action refuses with the work-in-progress message', (kind) => {
        beginBusy(kind)

        const refused = refuseBackupLoadWhileBusy()

        expect(refused).toBe(true)
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(language.backupLoadWorkInProgress)
    })

    test.each(chokePointsThatRefuse)('a write in flight at the %s choke point refuses with the work-in-progress message', (point) => {
        beginChokePoint(point)

        const refused = refuseBackupLoadWhileBusy()

        expect(refused).toBe(true)
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(language.backupLoadWorkInProgress)
    })

    test('guard: the caller\'s own entry does not refuse it', () => {
        const own = beginBusy('backupLoad')

        expect(refuseBackupLoadWhileBusy(own)).toBe(false)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('another entry refuses a caller that is itself registered', () => {
        const own = beginBusy('backupLoad')
        beginBusy('import')

        expect(refuseBackupLoadWhileBusy(own)).toBe(true)
        expect(alertErrorMock).toHaveBeenCalledWith(language.backupLoadWorkInProgress)
    })

    test('a choke point in flight refuses a caller that is itself registered', () => {
        const own = beginBusy('backupLoad')
        beginChokePoint('coldStorage')

        expect(refuseBackupLoadWhileBusy(own)).toBe(true)
    })

    test('a refusal does not register an entry of its own', () => {
        const other = beginBusy('import')

        expect(refuseBackupLoadWhileBusy()).toBe(true)

        expect(busyKinds()).toEqual(['import'])
        other.end()
        expect(isBusy()).toBe(false)
    })

    test('a retry proceeds once the other work has ended', () => {
        const other = beginBusy('import')
        const point = beginChokePoint('asset')
        expect(refuseBackupLoadWhileBusy()).toBe(true)

        other.end()
        expect(refuseBackupLoadWhileBusy()).toBe(true)
        point()

        expect(refuseBackupLoadWhileBusy()).toBe(false)
    })
})
