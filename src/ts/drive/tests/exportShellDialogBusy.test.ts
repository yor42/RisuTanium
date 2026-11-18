// @vitest-environment node
/**
 * `openOutsideBusy` (defined in `src/ts/drive/exportDialogBusy.ts`, re-exported by `src/ts/drive/exportShell.ts`): the one helper every export entry point wraps its save-dialog open
 * in. It marks the export's busy entry only on an Android page, so a lost dialog does not keep refusing the person's own
 * load, and ends the mark however the open settles. The real busy registry and the real Load guard run; the platform
 * and the modules around the shell are replaced.
 *
 * Labels: the Android legs are new-rule guards; the desktop and web legs are compatibility guards that run after the
 * change only, because the helper is new.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { alertError } from 'src/ts/alert'
import { refuseBackupLoadWhileBusy } from 'src/ts/drive/backupWorkGuard'
import { openOutsideBusy } from 'src/ts/drive/exportShell'
import { beginBusy, busyKinds, isBusy, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { inFlightKinds } from 'src/ts/process/inFlightWork'

const platformBox = vi.hoisted(() => ({ isTauri: true }))
const osBox = vi.hoisted(() => ({ os: 'android' }))

vi.mock('src/ts/platform', () => ({
    get isTauri() { return platformBox.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => osBox.os }))
vi.mock('src/ts/globalApi.svelte', () => ({ LocalWriter: class { }, TauriWriter: class { } }))
vi.mock('src/ts/alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn(), alertNormalWait: vi.fn(), alertClear: vi.fn(), alertWait: vi.fn() }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { alertStore: writable({ type: 'none', msg: '' }) }
})
vi.mock('@tauri-apps/plugin-fs', () => ({ remove: vi.fn(async () => { }) }))
vi.mock('src/ts/drive/exportModules', () => ({ ExportModuleUnreadableError: class extends Error { } }))
vi.mock('src/ts/drive/inlayBackupExport', () => ({ ExportReadError: class extends Error { } }))

beforeEach(() => {
    platformBox.isTauri = true
    osBox.os = 'android'
    resetBusyActionsForTest()
    vi.mocked(alertError).mockClear()
})

afterEach(() => {
    vi.restoreAllMocks()
})

/** An `open` that settles only when the test says so. */
function deferred<T>(): { open: () => Promise<T>, resolve: (value: T) => void, reject: (error: Error) => void } {
    let resolve: (value: T) => void = () => { }
    let reject: (error: Error) => void = () => { }
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { open: () => promise, resolve, reject }
}

describe('openOutsideBusy', () => {
    test('on Android the entry is marked while the open is pending: the Load guard does not refuse, every other reader counts it', async () => {
        const handle = beginBusy('export')
        const dialog = deferred<string>()

        const opening = openOutsideBusy(handle, dialog.open)

        expect(refuseBackupLoadWhileBusy()).toBe(false)
        expect(alertError).not.toHaveBeenCalled()
        expect(isBusy({ ignoreDialogWaits: true })).toBe(false)
        expect(isBusy()).toBe(true)
        expect(busyKinds()).toEqual(['export'])
        expect(inFlightKinds()).toContain('busy')

        dialog.resolve('picked')
        expect(await opening).toBe('picked')

        expect(isBusy({ ignoreDialogWaits: true })).toBe(true)
        expect(refuseBackupLoadWhileBusy()).toBe(true)
        handle.end()
    })

    test.each([
        { name: 'desktop', isTauri: true, os: 'windows' },
        { name: 'web', isTauri: false, os: 'android' },
    ])('on $name nothing is marked while the open is pending', async ({ isTauri, os }) => {
        platformBox.isTauri = isTauri
        osBox.os = os
        const handle = beginBusy('export')
        const dialog = deferred<string>()

        const opening = openOutsideBusy(handle, dialog.open)

        expect(refuseBackupLoadWhileBusy()).toBe(true)
        expect(isBusy({ ignoreDialogWaits: true })).toBe(true)

        dialog.resolve('picked')
        await opening
        handle.end()
    })

    test('without a busy entry the open runs unchanged', async () => {
        expect(await openOutsideBusy(undefined, async () => 7)).toBe(7)
        expect(isBusy()).toBe(false)
    })

    test('a rejected open rethrows the same error and ends the mark', async () => {
        const handle = beginBusy('export')
        const dialog = deferred<string>()
        const failure = new Error('the dialog failed')

        const opening = openOutsideBusy(handle, dialog.open)
        expect(isBusy({ ignoreDialogWaits: true })).toBe(false)
        dialog.reject(failure)

        await expect(opening).rejects.toBe(failure)
        expect(isBusy({ ignoreDialogWaits: true })).toBe(true)
        expect(refuseBackupLoadWhileBusy()).toBe(true)
        handle.end()
    })

    test('a null answer is returned and the mark ends', async () => {
        const handle = beginBusy('export')
        const dialog = deferred<string | null>()

        const opening = openOutsideBusy(handle, dialog.open)
        dialog.resolve(null)

        expect(await opening).toBeNull()
        expect(isBusy({ ignoreDialogWaits: true })).toBe(true)
        handle.end()
    })
})
