/**
 * The Android update flow of `checkRisuUpdate()`: when the host is asked, what the offer carries, the permission round
 * trip, the download notice with its Cancel and progress, and the message every failure maps to. The real `update.ts`,
 * the real host client and bridge, the real parser and the real language table run against a fake host channel; the
 * alert surface and the platform flags are mocked. A pass proves the page side only: the native download, the
 * verification and the system installer are outside what a fake channel proves.
 *
 * Vitest's default for `import.meta.env.DEV` is true, which would make the check return early in every test; each test
 * stubs it false, so a test that expects no request is not satisfied by the dev early return.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from '../lang'
import { fillLang } from '../lang/fill'
import { createHostChannelFake, type HostChannelFake } from './android/hostChannelFake'
import { connectHostBridge } from './android/hostBridge'

const mocks = vi.hoisted(() => ({
    desktop: false,
    tauri: true,
    check: vi.fn(),
    relaunch: vi.fn(async () => {}),
    alertUpdateOffer: vi.fn(async (_offer: unknown): Promise<'install' | 'later'> => 'later'),
    alertSelect: vi.fn(async (_options: string[], _question?: string, _opts?: unknown) => '0'),
    alertWait: vi.fn((_msg: string, _onCancel?: () => void) => undefined),
    alertError: vi.fn(),
    alertToast: vi.fn(),
    alertClear: vi.fn(),
    waitAlert: vi.fn(async () => {}),
    openURL: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({ check: mocks.check }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: mocks.relaunch }))
vi.mock('./tauriDesktop', () => ({
    get isTauriDesktop() {
        return mocks.desktop
    },
}))
vi.mock('./platform', () => ({
    get isTauri() {
        return mocks.tauri
    },
}))
vi.mock('./alert', () => ({
    alertUpdateOffer: mocks.alertUpdateOffer,
    alertSelect: mocks.alertSelect,
    alertWait: mocks.alertWait,
    alertError: mocks.alertError,
    alertToast: mocks.alertToast,
    alertClear: mocks.alertClear,
    waitAlert: mocks.waitAlert,
}))
vi.mock('./globalApi.svelte', () => ({ openURL: mocks.openURL }))

const REMINDER_KEY = 'risu_update_reminder'
const DAY_MS = 24 * 60 * 60 * 1000
const RELEASES_URL = 'https://github.com/yor42/RisuTanium/releases'
const APK_URL = 'https://github.com/yor42/RisuTanium/releases/download/v0.2.0/RisuTanium_0.2.0_android-universal.apk'

let host: HostChannelFake

function releaseJson(change: Record<string, unknown> = {}): string {
    return JSON.stringify({ version: '0.2.0', versionCode: 2000, notes: 'Fixed a thing', url: APK_URL, size: 280_000_000, ...change })
}

function checkReply(change: Record<string, unknown> = {}, json: string = releaseJson()) {
    return { update: 'ok', json, installedVersionCode: 1000, installedVersionName: '0.1.0', metered: false, ...change }
}

function posts(method: string): Array<Record<string, unknown>> {
    return host.postedTo('appUpdate', method)
}

function allPosts(): Array<Record<string, unknown>> {
    return host.posted().filter((message) => message.bridge === 'appUpdate')
}

/** Answers the newest request of `method`, the way the host does: on its id, naming the method. */
function reply(method: string, body: Record<string, unknown>): void {
    const message = posts(method).at(-1)
    expect(message, `a posted ${method} request`).toBeDefined()
    host.deliver(JSON.stringify({ id: message!.id, method: `appUpdate.${method}`, ...body }))
}

async function posted(method: string, count = 1): Promise<void> {
    await vi.waitFor(() => {
        expect(posts(method)).toHaveLength(count)
    })
}

async function run(): Promise<void> {
    const { checkRisuUpdate } = await import('./update')
    await checkRisuUpdate()
}

/** Boots the flow, answers the check with a newer release and presses Install; resolves once the page asks about the permission. */
async function toPermissionQuestion(): Promise<{ done: Promise<void> }> {
    mocks.alertUpdateOffer.mockResolvedValue('install')
    const done = run()
    await posted('check')
    reply('check', checkReply())
    await posted('installPermission')
    return { done }
}

/** As above, with the permission already on: resolves once `install` is posted. */
async function toInstallPost(): Promise<{ done: Promise<void> }> {
    const { done } = await toPermissionQuestion()
    reply('installPermission', { update: 'ok', allowed: true })
    await posted('install')
    return { done }
}

function installError(code: string, extra: Record<string, unknown> = {}): void {
    reply('install', { update: 'error', code, ...extra })
}

function lastAlertWait(): { msg: string, onCancel?: () => void } {
    const call = mocks.alertWait.mock.calls.at(-1)
    expect(call, 'a wait notice').toBeDefined()
    return { msg: call![0], onCancel: call![1] }
}

function expectNothingShown(): void {
    expect(mocks.alertUpdateOffer).not.toHaveBeenCalled()
    expect(mocks.alertSelect).not.toHaveBeenCalled()
    expect(mocks.alertWait).not.toHaveBeenCalled()
    expect(mocks.alertError).not.toHaveBeenCalled()
    expect(mocks.alertToast).not.toHaveBeenCalled()
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.desktop = false
    mocks.tauri = true
    mocks.alertUpdateOffer.mockResolvedValue('later')
    mocks.alertSelect.mockResolvedValue('0')
    mocks.waitAlert.mockResolvedValue(undefined)
    vi.stubEnv('DEV', false)
    localStorage.clear()
    host = createHostChannelFake()
    window.__risuTaniumHost = host.channel
    connectHostBridge()
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    localStorage.clear()
    delete window.__risuTaniumHost
    // Lets go of the channel so the next case starts unbound.
    connectHostBridge()
})

describe('the offer', () => {
    test('T-F1: a newer release is offered with its versions, notes, size and the connection kind', async () => {
        const done = run()
        await posted('check')
        reply('check', checkReply({ metered: true }))
        await done

        expect(mocks.alertUpdateOffer).toHaveBeenCalledTimes(1)
        expect(mocks.alertUpdateOffer).toHaveBeenCalledWith({
            currentVersion: '0.1.0',
            version: '0.2.0',
            notes: 'Fixed a thing',
            download: { sizeBytes: 280_000_000, metered: true },
        })
    })

    test('T-F2: a versionCode equal to or below the installed one is not offered', async () => {
        for (const versionCode of [1000, 999]) {
            vi.clearAllMocks()
            host = createHostChannelFake()
            window.__risuTaniumHost = host.channel
            const done = run()
            await posted('check')
            reply('check', checkReply({}, releaseJson({ versionCode })))
            await done
            expect(mocks.alertUpdateOffer).not.toHaveBeenCalled()
        }
    })

    test('T-F3: while a reminder is active the host is not asked at all', async () => {
        localStorage.setItem(REMINDER_KEY, JSON.stringify({ until: Date.now() + DAY_MS }))

        await run()

        expect(allPosts()).toEqual([])
        expectNothingShown()
    })

    test.each([
        ['malformed JSON', checkReply({}, 'not json')],
        ['a release missing its size', checkReply({}, JSON.stringify({ version: '0.2.0', versionCode: 2000, url: APK_URL }))],
        ['disabled', { update: 'disabled' }],
        ['notPublished', { update: 'notPublished' }],
        ['a host error', { update: 'error', code: 'network' }],
        ['a reply with the wrong shape', { update: 'ok' }],
    ])('T-F4: %s shows nothing and boot goes on', async (_name, body) => {
        const done = run()
        await posted('check')
        reply('check', body)
        await done

        expectNothingShown()
        expect(posts('installPermission')).toEqual([])
    })

    test('T-F5: a silent host is given up on after 10 seconds, shows nothing and its request is forgotten', async () => {
        await import('./update')
        vi.useFakeTimers()
        const done = run()
        await vi.advanceTimersByTimeAsync(0)
        expect(posts('check')).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(9_999)
        let finished = false
        void done.then(() => { finished = true })
        await vi.advanceTimersByTimeAsync(0)
        expect(finished).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        await done
        expectNothingShown()
        // A late answer settles nothing.
        reply('check', checkReply())
        await vi.advanceTimersByTimeAsync(0)
        expect(mocks.alertUpdateOffer).not.toHaveBeenCalled()
    })
})

describe('Not now and Install', () => {
    test('T-F12: Not now asks when to remind, posts no install, and stores the chosen reminder', async () => {
        mocks.alertSelect.mockResolvedValue('1')
        const done = run()
        await posted('check')
        reply('check', checkReply())
        await done

        expect(mocks.alertSelect).toHaveBeenCalledTimes(1)
        expect(mocks.alertSelect.mock.calls[0][1]).toBe(language.remindLaterQuestion)
        expect(JSON.parse(localStorage.getItem(REMINDER_KEY) ?? 'null').until).toBeGreaterThan(Date.now())
        expect(posts('installPermission')).toEqual([])
        expect(posts('install')).toEqual([])
    })

    test('T-F6: Install asks about the permission, then posts install with url, size and versionCode, and clears the reminder', async () => {
        localStorage.setItem(REMINDER_KEY, JSON.stringify({ until: Date.now() - 1 }))
        const { done } = await toInstallPost()

        expect(allPosts().map((message) => message.method)).toEqual(['check', 'installPermission', 'install'])
        expect(posts('install')[0].args).toEqual([APK_URL, 280_000_000, 2000])
        expect(localStorage.getItem(REMINDER_KEY)).toBeNull()
        reply('install', { update: 'ok', outcome: 'notInstalled' })
        await done
    })
})

describe('the install permission', () => {
    test('T-F7: allowed after the explanation and settings, the install goes ahead', async () => {
        const { done } = await toPermissionQuestion()
        reply('installPermission', { update: 'ok', allowed: false })
        await posted('openInstallSettings')
        expect(mocks.alertSelect).toHaveBeenCalledWith([language.updateOpenSettings, language.cancel], language.updatePermissionExplain, { cancel: '1' })
        reply('openInstallSettings', { update: 'ok', allowed: true })
        await posted('install')
        reply('install', { update: 'ok', outcome: 'notInstalled' })
        await done
    })

    test('T-F7: still off after the settings, a still-off alert with the manual link is shown and nothing is downloaded', async () => {
        const { done } = await toPermissionQuestion()
        reply('installPermission', { update: 'ok', allowed: false })
        await posted('openInstallSettings')
        reply('openInstallSettings', { update: 'ok', allowed: false })
        await done

        expect(posts('install')).toEqual([])
        expect(mocks.alertError).toHaveBeenCalledTimes(1)
        const [message, options] = mocks.alertError.mock.calls[0]
        expect(message).toContain(language.updatePermissionStillOff)
        expect(message).toContain(language.updateManualInstallHint)
        expect(options.link.label).toBe(language.updateOpenReleases)
        expect(mocks.waitAlert).toHaveBeenCalled()
    })

    test('T-F7: Cancel on the explanation is a "not now": no settings, no install, no error, the remind-later choice', async () => {
        // '1' answers both the explanation (Cancel) and the remind-later choice (one day).
        mocks.alertSelect.mockResolvedValue('1')
        const { done } = await toPermissionQuestion()
        reply('installPermission', { update: 'ok', allowed: false })
        await done

        expect(posts('openInstallSettings')).toEqual([])
        expect(posts('install')).toEqual([])
        expect(mocks.alertError).not.toHaveBeenCalled()
        expect(mocks.alertSelect.mock.calls.at(-1)?.[1]).toBe(language.remindLaterQuestion)
        expect(JSON.parse(localStorage.getItem(REMINDER_KEY) ?? 'null').until).toBeGreaterThan(Date.now())
    })
})

describe('the download notice', () => {
    test('T-F9c: the wait notice and the install post happen in one synchronous run', async () => {
        const events: string[] = []
        mocks.alertWait.mockImplementation(() => {
            events.push('wait')
            queueMicrotask(() => events.push('microtask'))
            return undefined
        })
        host.channel.postMessage.mockImplementation((raw: string) => {
            const message = JSON.parse(raw) as { method?: string }
            if (message.method === 'install') {
                events.push('install')
            }
        })
        const { done } = await toInstallPost()

        expect(events.slice(0, 3)).toEqual(['wait', 'install', 'microtask'])
        reply('install', { update: 'ok', outcome: 'notInstalled' })
        await done
    })

    test('T-F10: progress replaces the wait text, in readable sizes', async () => {
        const { done } = await toInstallPost()
        expect(lastAlertWait().msg).toBe(fillLang(language.updateDownloading, { received: '0 B', total: '280.0 MB' }))

        host.deliver('{"event":"appUpdateProgress","received":50000000,"total":280000000}')

        expect(lastAlertWait().msg).toBe(fillLang(language.updateDownloading, { received: '50.0 MB', total: '280.0 MB' }))
        expect(typeof lastAlertWait().onCancel).toBe('function')
        reply('install', { update: 'ok', outcome: 'notInstalled' })
        await done
    })

    test('progress after the answer does not bring the notice back', async () => {
        const { done } = await toInstallPost()
        reply('install', { update: 'ok', outcome: 'notInstalled' })
        await done
        const calls = mocks.alertWait.mock.calls.length

        host.deliver('{"event":"appUpdateProgress","received":1,"total":2}')

        expect(mocks.alertWait.mock.calls.length).toBe(calls)
    })

    test('T-F9: Cancel posts cancel with no id, and the host answering cancelled is a toast, not an error', async () => {
        const { done } = await toInstallPost()

        lastAlertWait().onCancel?.()

        expect(posts('cancel')).toHaveLength(1)
        expect('id' in posts('cancel')[0]).toBe(false)
        expect(posts('cancel')[0].args).toEqual([])
        installError('cancelled')
        await done
        expect(mocks.alertToast).toHaveBeenCalledWith(language.updateDownloadCancelled)
        expect(mocks.alertError).not.toHaveBeenCalled()
    })

    test.each([
        ['an installer return', { update: 'ok', outcome: 'notInstalled' }],
        ['a network error', { update: 'error', code: 'network' }],
        ['a verification error', { update: 'error', code: 'wrongSigner' }],
        ['a permission error', { update: 'error', code: 'permission' }],
        ['an unknown error', { update: 'error', code: 'nonsense' }],
    ])('T-F9b: after the page pressed Cancel, %s is only the cancelled toast', async (_name, body) => {
        const { done } = await toInstallPost()
        lastAlertWait().onCancel?.()

        reply('install', body)
        await done

        expect(mocks.alertToast).toHaveBeenCalledTimes(1)
        expect(mocks.alertToast).toHaveBeenCalledWith(language.updateDownloadCancelled)
        expect(mocks.alertError).not.toHaveBeenCalled()
        expect(posts('install')).toHaveLength(1)
        expect(posts('openInstallSettings')).toEqual([])
    })
})

describe('how an install ends', () => {
    test('T-F11: the installer coming back is one toast, not an alert', async () => {
        const { done } = await toInstallPost()
        reply('install', { update: 'ok', outcome: 'notInstalled' })
        await done

        expect(mocks.alertToast).toHaveBeenCalledTimes(1)
        expect(mocks.alertToast).toHaveBeenCalledWith(language.updateNotInstalled)
        expect(mocks.alertError).not.toHaveBeenCalled()
    })

    test('T-F11: the host answering cancelled without a page Cancel is the cancelled toast', async () => {
        const { done } = await toInstallPost()
        installError('cancelled')
        await done

        expect(mocks.alertToast).toHaveBeenCalledWith(language.updateDownloadCancelled)
        expect(mocks.alertError).not.toHaveBeenCalled()
    })

    test('T-F11: permission off at hand-off: explanation, settings allowed, exactly one more install', async () => {
        const { done } = await toInstallPost()
        installError('permission')
        await posted('openInstallSettings')
        reply('openInstallSettings', { update: 'ok', allowed: true })
        await posted('install', 2)

        installError('permission')
        await done

        expect(posts('install')).toHaveLength(2)
        expect(posts('openInstallSettings')).toHaveLength(1)
        expect(mocks.alertError.mock.calls[0][0]).toContain(language.updatePermissionStillOff)
    })

    test('T-F11: permission off at hand-off and Cancel on the explanation: the remind-later choice, no error, no second install', async () => {
        const { done } = await toInstallPost()
        mocks.alertSelect.mockResolvedValue('1')
        installError('permission')
        await done

        expect(posts('install')).toHaveLength(1)
        expect(posts('openInstallSettings')).toEqual([])
        expect(mocks.alertError).not.toHaveBeenCalled()
        expect(mocks.alertSelect.mock.calls.at(-1)?.[1]).toBe(language.remindLaterQuestion)
    })

    test('T-F11: permission off at hand-off and still off after the settings: the still-off alert, no second install', async () => {
        const { done } = await toInstallPost()
        installError('permission')
        await posted('openInstallSettings')
        reply('openInstallSettings', { update: 'ok', allowed: false })
        await done

        expect(posts('install')).toHaveLength(1)
        expect(mocks.alertError.mock.calls[0][0]).toContain(language.updatePermissionStillOff)
    })

    test('T-F11: a second attempt that goes through ends like any other', async () => {
        const { done } = await toInstallPost()
        installError('permission')
        await posted('openInstallSettings')
        reply('openInstallSettings', { update: 'ok', allowed: true })
        await posted('install', 2)
        reply('install', { update: 'ok', outcome: 'notInstalled' })
        await done

        expect(mocks.alertToast).toHaveBeenCalledWith(language.updateNotInstalled)
    })

    const wrong = language.updateErrorVerification
    test.each<[string, Record<string, unknown>, string]>([
        ['network', {}, language.updateErrorNetwork],
        ['storage', { needed: 600_000_000 }, fillLang(language.updateErrorStorage, { size: '600.0 MB' })],
        ['incomplete', {}, wrong],
        ['notApk', {}, wrong],
        ['wrongPackage', {}, wrong],
        ['notNewer', {}, wrong],
        ['notOffered', {}, wrong],
        ['wrongSigner', {}, language.updateErrorWrongSigner],
        ['busy', {}, language.updateErrorOther],
        ['badRequest', {}, language.updateErrorOther],
        ['other', {}, language.updateErrorOther],
        ['a code this page does not know', {}, language.updateErrorOther],
    ])('T-F8: %s shows its message, the manual hint and the releases link', async (name, extra, expected) => {
        const code = name === 'a code this page does not know' ? 'brandNew' : name
        const { done } = await toInstallPost()
        installError(code, extra)
        await done

        expect(mocks.alertError).toHaveBeenCalledTimes(1)
        const [message, options] = mocks.alertError.mock.calls[0]
        expect(message).toContain(expected)
        expect(message).toContain(language.updateManualInstallHint)
        expect(options.link.label).toBe(language.updateOpenReleases)
        expect(mocks.waitAlert).toHaveBeenCalled()
        options.link.open()
        await vi.waitFor(() => {
            expect(mocks.openURL).toHaveBeenCalledWith(RELEASES_URL)
        })
    })

    test('T-F8: the wrong-signer message never suggests uninstalling', () => {
        expect(language.updateErrorWrongSigner.toLowerCase()).not.toContain('uninstall')
        expect(language.updateErrorVerification.toLowerCase()).not.toContain('uninstall')
    })

})

describe('where the Android flow runs', () => {
    test('T-F13: on desktop the host is never asked and the desktop updater is', async () => {
        mocks.desktop = true
        mocks.check.mockResolvedValue(null)

        await run()

        expect(mocks.check).toHaveBeenCalledTimes(1)
        expect(allPosts()).toEqual([])
    })

    test('a dev build never asks the host', async () => {
        vi.stubEnv('DEV', true)

        await run()

        expect(allPosts()).toEqual([])
        expectNothingShown()
    })

    test('without Tauri, or without the host channel, nothing is asked', async () => {
        mocks.tauri = false
        await run()
        expect(allPosts()).toEqual([])

        mocks.tauri = true
        delete window.__risuTaniumHost
        await run()
        expect(host.posted().filter((message) => message.bridge === 'appUpdate')).toEqual([])
        expect(mocks.check).not.toHaveBeenCalled()
    })
})
