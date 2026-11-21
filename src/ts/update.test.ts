/**
 * The desktop update flow of `checkRisuUpdate()`: when the check runs, what the offer carries, what
 * Install and Not now do, and that a failing check shows nothing.
 *
 * The updater plugin, the process plugin, the alert surface and the desktop flag are mocked; the
 * real `update.ts`, the real language table and the real reminder in localStorage are exercised.
 * Native updater behaviour (signature check, installer) is outside what a mock proves; the config
 * is pinned by `updaterConfig.test.ts`.
 *
 * Vitest's own default for `import.meta.env.DEV` is true, which would make `checkRisuUpdate()`
 * return early in every test; each test stubs it false, so a test that expects no call is not
 * satisfied by the dev early return.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from '../lang'
import { fillLang } from '../lang/fill'

const mocks = vi.hoisted(() => ({
    desktop: true,
    check: vi.fn(),
    downloadAndInstall: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    relaunch: vi.fn(async () => {}),
    alertUpdateOffer: vi.fn(async (): Promise<'install' | 'later'> => 'later'),
    alertSelect: vi.fn(async () => '0'),
    alertWait: vi.fn(),
    alertError: vi.fn(),
    waitAlert: vi.fn(async () => {}),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
    check: mocks.check,
}))

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: mocks.relaunch,
}))

vi.mock('./tauriDesktop', () => ({
    get isTauriDesktop() {
        return mocks.desktop
    },
}))

vi.mock('./alert', () => ({
    alertUpdateOffer: mocks.alertUpdateOffer,
    alertSelect: mocks.alertSelect,
    alertWait: mocks.alertWait,
    alertError: mocks.alertError,
    waitAlert: mocks.waitAlert,
}))

const REMINDER_KEY = 'risu_update_reminder'
const DAY_MS = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000

function offered(body: string | undefined) {
    return {
        currentVersion: '0.1.0',
        version: '0.2.0',
        body,
        downloadAndInstall: mocks.downloadAndInstall,
        close: mocks.close,
    }
}

async function run(): Promise<void> {
    const { checkRisuUpdate } = await import('./update')
    await checkRisuUpdate()
}

function allAlertMocksIdle(): void {
    expect(mocks.alertUpdateOffer).not.toHaveBeenCalled()
    expect(mocks.alertSelect).not.toHaveBeenCalled()
    expect(mocks.alertWait).not.toHaveBeenCalled()
    expect(mocks.alertError).not.toHaveBeenCalled()
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.desktop = true
    mocks.check.mockResolvedValue(offered('Notes'))
    mocks.alertUpdateOffer.mockResolvedValue('later')
    mocks.alertSelect.mockResolvedValue('0')
    vi.stubEnv('DEV', false)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    localStorage.clear()
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    localStorage.clear()
})

describe('when the check runs', () => {
    test('on desktop with no reminder it checks once, with a 10 second timeout', async () => {
        await run()

        expect(mocks.check).toHaveBeenCalledTimes(1)
        expect(mocks.check).toHaveBeenCalledWith({ timeout: 10_000 })
    })

    test('off desktop it makes no plugin call and shows nothing', async () => {
        mocks.desktop = false

        await run()

        expect(mocks.check).not.toHaveBeenCalled()
        allAlertMocksIdle()
    })

    test('a dev build never checks', async () => {
        vi.stubEnv('DEV', true)

        await run()

        expect(mocks.check).not.toHaveBeenCalled()
        allAlertMocksIdle()
    })

    test('an active reminder means no check and no offer', async () => {
        localStorage.setItem(REMINDER_KEY, JSON.stringify({ until: NOW + DAY_MS }))

        await run()

        expect(mocks.check).not.toHaveBeenCalled()
        allAlertMocksIdle()
    })

    test('an expired reminder is removed and the check runs', async () => {
        localStorage.setItem(REMINDER_KEY, JSON.stringify({ until: NOW - 1 }))

        await run()

        expect(localStorage.getItem(REMINDER_KEY)).toBeNull()
        expect(mocks.check).toHaveBeenCalledTimes(1)
    })

    test('no update available shows nothing', async () => {
        mocks.check.mockResolvedValue(null)

        await run()

        allAlertMocksIdle()
    })

    test('a rejected check (the endpoint answers 404 until a release is published) is swallowed with no alert', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        mocks.check.mockRejectedValue('Could not fetch a valid release JSON from the remote')

        await expect(run()).resolves.toBeUndefined()

        allAlertMocksIdle()
        expect(logged).toHaveBeenCalledTimes(1)
        logged.mockRestore()
    })
})

describe('the offer', () => {
    test('carries the installed version, the new version and the notes', async () => {
        await run()

        expect(mocks.alertUpdateOffer).toHaveBeenCalledWith({ currentVersion: '0.1.0', version: '0.2.0', notes: 'Notes' })
    })

    test('a missing body is empty notes', async () => {
        mocks.check.mockResolvedValue(offered(undefined))

        await run()

        expect(mocks.alertUpdateOffer).toHaveBeenCalledWith({ currentVersion: '0.1.0', version: '0.2.0', notes: '' })
    })
})

describe('Install', () => {
    beforeEach(() => {
        mocks.alertUpdateOffer.mockResolvedValue('install')
    })

    test('shows the updating wait, downloads and installs, then relaunches, in that order, and clears the reminder', async () => {
        localStorage.setItem(REMINDER_KEY, JSON.stringify({ until: NOW - 1 }))
        const order: string[] = []
        mocks.alertWait.mockImplementation(() => { order.push('wait') })
        mocks.downloadAndInstall.mockImplementationOnce(async () => { order.push('install') })
        mocks.relaunch.mockImplementationOnce(async () => { order.push('relaunch') })

        await run()

        expect(order).toEqual(['wait', 'install', 'relaunch'])
        expect(mocks.alertWait).toHaveBeenCalledWith(fillLang(language.alerts.updatingTo, { version: '0.2.0' }))
        expect(localStorage.getItem(REMINDER_KEY)).toBeNull()
        expect(mocks.alertSelect).not.toHaveBeenCalled()
    })

    test('a failed install shows the plugin message, never relaunches, replaces the wait and lets boot continue', async () => {
        mocks.downloadAndInstall.mockRejectedValueOnce('signature mismatch')

        await expect(run()).resolves.toBeUndefined()

        expect(mocks.alertError).toHaveBeenCalledTimes(1)
        const message = mocks.alertError.mock.calls[0][0] as string
        expect(message).toBe(fillLang(language.updateInstallFailed, { error: 'signature mismatch' }))
        expect(message).toContain('signature mismatch')
        expect(mocks.relaunch).not.toHaveBeenCalled()
        expect(mocks.waitAlert).toHaveBeenCalledTimes(1)
    })

    test('an Error from the install shows its message', async () => {
        mocks.downloadAndInstall.mockRejectedValueOnce(new Error('disk full'))

        await run()

        expect(mocks.alertError.mock.calls[0][0]).toContain('disk full')
    })

    test('an installed update whose relaunch fails says to reopen the app, not that the install failed', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        mocks.relaunch.mockRejectedValueOnce('no restart')

        await expect(run()).resolves.toBeUndefined()

        expect(mocks.alertError).toHaveBeenCalledTimes(1)
        expect(mocks.alertError).toHaveBeenCalledWith(language.updateRelaunchFailed)
        expect(mocks.waitAlert).toHaveBeenCalledTimes(1)
        logged.mockRestore()
    })
})

describe('Not now', () => {
    test('asks when to remind, frees the update resource and installs nothing', async () => {
        await run()

        expect(mocks.alertSelect).toHaveBeenCalledWith(
            [
                language.remindIgnore,
                language.remindLater1Day,
                language.remindLater3Days,
                language.remindLater5Days,
                language.remindLater1Week,
            ],
            language.remindLaterQuestion,
            { cancel: '0' },
        )
        expect(mocks.close).toHaveBeenCalledTimes(1)
        expect(mocks.downloadAndInstall).not.toHaveBeenCalled()
        expect(mocks.relaunch).not.toHaveBeenCalled()
    })

    test.each([
        ['1', 1],
        ['2', 3],
        ['3', 5],
        ['4', 7],
    ])('choice %s stores a reminder %i days out', async (choice, days) => {
        mocks.alertSelect.mockResolvedValue(choice)

        await run()

        expect(JSON.parse(localStorage.getItem(REMINDER_KEY) ?? 'null')).toEqual({ until: NOW + days * DAY_MS })
    })

    test('Ignore stores no reminder', async () => {
        mocks.alertSelect.mockResolvedValue('0')

        await run()

        expect(localStorage.getItem(REMINDER_KEY)).toBeNull()
    })
})

describe('the dev console hook', () => {
    afterEach(() => {
        delete window.testUpdateReminder
    })

    test('is absent when DEV is false', async () => {
        vi.resetModules()
        delete window.testUpdateReminder

        await import('./update')

        expect(window.testUpdateReminder).toBeUndefined()
    })

    test('is a function when DEV is true, and shows the offer without installing or storing a reminder', async () => {
        vi.stubEnv('DEV', true)
        vi.resetModules()
        delete window.testUpdateReminder
        mocks.alertSelect.mockResolvedValue('2')

        await import('./update')

        expect(typeof window.testUpdateReminder).toBe('function')
        await window.testUpdateReminder!()
        expect(mocks.alertUpdateOffer).toHaveBeenCalledTimes(1)
        expect(mocks.alertSelect).toHaveBeenCalledTimes(1)
        expect(mocks.downloadAndInstall).not.toHaveBeenCalled()
        expect(mocks.relaunch).not.toHaveBeenCalled()
        expect(localStorage.getItem(REMINDER_KEY)).toBeNull()
    })
})
