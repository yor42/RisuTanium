/**
 * Page side of the Android update host: a typed client over the host message channel. Nothing here
 * throws; every call settles with a result, and a reply the page does not understand reads as the
 * `other` error. The page never holds APK bytes: the host downloads, verifies and hands the file to
 * the system installer.
 */
import { hostPost, hostRequest } from './hostBridge'

/** How long the boot check waits for the host's answer. This bounds the check only, never the download. */
export const APP_UPDATE_CHECK_TIMEOUT_MS = 10_000

export type AppUpdateErrorCode =
    | 'busy' | 'badRequest' | 'network' | 'storage' | 'incomplete' | 'notApk' | 'wrongPackage'
    | 'wrongSigner' | 'notNewer' | 'notOffered' | 'permission' | 'cancelled' | 'other'

const ERROR_CODES: ReadonlySet<string> = new Set<AppUpdateErrorCode>([
    'busy', 'badRequest', 'network', 'storage', 'incomplete', 'notApk', 'wrongPackage',
    'wrongSigner', 'notNewer', 'notOffered', 'permission', 'cancelled', 'other',
])

export type AppUpdateCheckResult =
    | { kind: 'ok'; json: string; installedVersionCode: number; installedVersionName: string; metered: boolean }
    | { kind: 'disabled' }
    | { kind: 'notPublished' }
    | { kind: 'timeout' }
    | { kind: 'error' }

export type AppUpdateInstallResult =
    /** The system installer came back while this page is still alive: nothing was installed. */
    | { kind: 'notInstalled' }
    | { kind: 'error'; code: AppUpdateErrorCode; needed?: number }

type HostReply = Record<string, unknown>

function isSafeCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Sends one request and settles with its reply; null when there is no channel, the send fails or the channel is released. */
function request(method: string, args: unknown[]): Promise<HostReply | null> {
    return new Promise((resolve) => {
        try {
            const pending = hostRequest('appUpdate', method, args)
            if (!pending) {
                resolve(null)
                return
            }
            pending.reply.then(resolve, () => resolve(null))
        } catch {
            resolve(null)
        }
    })
}

function readCheck(reply: HostReply | null): AppUpdateCheckResult {
    if (!reply) {
        return { kind: 'error' }
    }
    if (reply.update === 'disabled') {
        return { kind: 'disabled' }
    }
    if (reply.update === 'notPublished') {
        return { kind: 'notPublished' }
    }
    if (
        reply.update === 'ok'
        && typeof reply.json === 'string'
        && isSafeCount(reply.installedVersionCode)
        && typeof reply.installedVersionName === 'string'
        && typeof reply.metered === 'boolean'
    ) {
        return {
            kind: 'ok',
            json: reply.json,
            installedVersionCode: reply.installedVersionCode,
            installedVersionName: reply.installedVersionName,
            metered: reply.metered,
        }
    }
    return { kind: 'error' }
}

/** Asks the host for the release description. Silent outcomes are values; a silent host settles `timeout` after 10 seconds. */
export function checkAppUpdate(): Promise<AppUpdateCheckResult> {
    return new Promise((resolve) => {
        let pending: ReturnType<typeof hostRequest>
        try {
            pending = hostRequest('appUpdate', 'check', [])
        } catch {
            resolve({ kind: 'error' })
            return
        }
        if (!pending) {
            resolve({ kind: 'error' })
            return
        }
        const timer = setTimeout(() => {
            pending?.cancel()
            resolve({ kind: 'timeout' })
        }, APP_UPDATE_CHECK_TIMEOUT_MS)
        pending.reply.then(
            (reply) => {
                clearTimeout(timer)
                resolve(readCheck(reply))
            },
            () => {
                clearTimeout(timer)
                resolve({ kind: 'error' })
            },
        )
    })
}

function readAllowed(reply: HostReply | null): boolean {
    return reply !== null && reply.update === 'ok' && reply.allowed === true
}

/** Whether the app may install packages now. Any failure to learn that reads as not allowed. */
export async function appUpdateInstallPermission(): Promise<boolean> {
    return readAllowed(await request('installPermission', []))
}

/** Opens the system page for the permission and settles when the person returns: whether it is allowed now. */
export async function appUpdateOpenInstallSettings(): Promise<boolean> {
    return readAllowed(await request('openInstallSettings', []))
}

function readInstall(reply: HostReply | null): AppUpdateInstallResult {
    if (!reply) {
        return { kind: 'error', code: 'other' }
    }
    if (reply.update === 'ok' && reply.outcome === 'notInstalled') {
        return { kind: 'notInstalled' }
    }
    if (reply.update === 'error' && typeof reply.code === 'string' && ERROR_CODES.has(reply.code)) {
        const code = reply.code as AppUpdateErrorCode
        return isSafeCount(reply.needed) ? { kind: 'error', code, needed: reply.needed } : { kind: 'error', code }
    }
    return { kind: 'error', code: 'other' }
}

/**
 * Asks the host to download, verify and install. The request is posted synchronously inside this call, so a caller
 * that shows its wait notice first and calls this in the same task can only be cancelled after the host has the
 * request. It settles once, after the host's answer; there is no deadline.
 */
export function installAppUpdate(url: string, size: number, versionCode: number): Promise<AppUpdateInstallResult> {
    return request('install', [url, size, versionCode]).then(readInstall)
}

/** Tells the host to stop the update in flight; the answer to `installAppUpdate` follows. False when the host never got it. */
export function cancelAppUpdate(): boolean {
    return hostPost('appUpdate', 'cancel', [])
}
