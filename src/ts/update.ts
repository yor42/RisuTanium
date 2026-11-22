import { alertClear, alertError, alertSelect, alertToast, alertUpdateOffer, alertWait, waitAlert } from "./alert";
import { language } from "../lang";
import { fillLang } from "../lang/fill";
import { isTauri } from "./platform"
import { hostChannelPresent, subscribeAppUpdateProgress } from "./android/hostBridge"
import {
    appUpdateInstallPermission,
    appUpdateOpenInstallSettings,
    cancelAppUpdate,
    checkAppUpdate,
    installAppUpdate,
    type AppUpdateErrorCode,
} from "./android/appUpdateHost"
import { formatDownloadSize, parseAndroidRelease, type AndroidRelease } from "./android/appUpdateRelease"
import {
    check,
} from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { isTauriDesktop } from "./tauriDesktop"
import versionData from "../../version.json"

const UPDATE_REMINDER_KEY = 'risu_update_reminder'

interface UpdateReminder {
    until: number
}

function getUpdateReminder(): UpdateReminder | null {
    try {
        const stored = localStorage.getItem(UPDATE_REMINDER_KEY)
        if (stored) {
            return JSON.parse(stored)
        }
    } catch {
        // Ignore parse errors
    }
    return null
}

function setUpdateReminder(days: number): void {
    const until = Date.now() + days * 24 * 60 * 60 * 1000
    localStorage.setItem(UPDATE_REMINDER_KEY, JSON.stringify({ until }))
}

function clearUpdateReminder(): void {
    localStorage.removeItem(UPDATE_REMINDER_KEY)
}

function isUpdateReminderActive(): boolean {
    const reminder = getUpdateReminder()
    if (reminder && reminder.until > Date.now()) {
        return true
    }
    if (reminder) {
        clearUpdateReminder()
    }
    return false
}

/**
 * How long the boot check waits for the release endpoint. A silent network would otherwise hold
 * "Checking Update..." for as long as the connection stays open; this bounds the check only, never
 * the download.
 */
const UPDATE_CHECK_TIMEOUT_MS = 10_000

function errorText(error: unknown): string {
    if (typeof error === 'string') {
        return error
    }
    if (error instanceof Error) {
        return error.message
    }
    return String(error)
}

async function remindLater(): Promise<void> {
    const options = [
        language.remindIgnore,
        language.remindLater1Day,
        language.remindLater3Days,
        language.remindLater5Days,
        language.remindLater1Week,
    ]

    const selected = await alertSelect(options, language.remindLaterQuestion, { cancel: '0' })
    const selectedIndex = parseInt(selected)

    switch (selectedIndex) {
        case 0:
            break
        case 1:
            setUpdateReminder(1)
            break
        case 2:
            setUpdateReminder(3)
            break
        case 3:
            setUpdateReminder(5)
            break
        case 4:
            setUpdateReminder(7)
            break
    }
}

const RELEASES_URL = 'https://github.com/yor42/RisuTanium/releases'

/**
 * An update failure the person can act on: the message, a line that names the manual route, and a button that opens
 * the releases page. `globalApi.svelte` imports this module, so it is loaded only when the button is pressed.
 */
function alertUpdateError(message: string): void {
    alertError(`${message}\n${language.updateManualInstallHint}`, {
        link: {
            label: language.updateOpenReleases,
            open: () => {
                void import('./globalApi.svelte').then((module) => module.openURL(RELEASES_URL)).catch(() => {})
            },
        },
    })
}

/** The message for an install error. The five file-level verification failures share one message; the wrong signer has its own. */
function installErrorMessage(code: AppUpdateErrorCode, needed: number | undefined): string {
    switch (code) {
        case 'network':
            return language.updateErrorNetwork
        case 'storage':
            return fillLang(language.updateErrorStorage, { size: formatDownloadSize(needed ?? 0) })
        case 'incomplete':
        case 'notApk':
        case 'wrongPackage':
        case 'notNewer':
        case 'notOffered':
            return language.updateErrorVerification
        case 'wrongSigner':
            return language.updateErrorWrongSigner
        default:
            return language.updateErrorOther
    }
}

/**
 * Explains the permission and opens its system page when the person agrees. `declined` means the person chose Cancel
 * at the explanation, which is a "not now" (MC-3608), not a failure; `allowed` and `off` are the state afterwards.
 */
async function explainAndOpenInstallSettings(): Promise<'allowed' | 'off' | 'declined'> {
    const choice = await alertSelect([language.updateOpenSettings, language.cancel], language.updatePermissionExplain, { cancel: '1' })
    if (choice !== '0') {
        return 'declined'
    }
    return (await appUpdateOpenInstallSettings()) ? 'allowed' : 'off'
}

async function reportPermissionStillOff(): Promise<void> {
    alertUpdateError(language.updatePermissionStillOff)
    await waitAlert()
}

/**
 * Shows the download notice and sends the install request in one synchronous run, so the notice's Cancel can only
 * come after the host has the request. Settles with the host's answer, or `cancelled` when the person pressed Cancel.
 */
async function downloadAndroidUpdate(release: AndroidRelease): Promise<{ cancelledByUser: boolean, answer: Awaited<ReturnType<typeof installAppUpdate>> }> {
    let cancelledByUser = false
    let finished = false
    const onCancel = () => {
        cancelledByUser = true
        cancelAppUpdate()
    }
    const notice = (received: number) => {
        alertWait(fillLang(language.updateDownloading, {
            received: formatDownloadSize(received),
            total: formatDownloadSize(release.size),
        }), onCancel)
    }
    const unsubscribe = subscribeAppUpdateProgress((progress) => {
        if (!finished) {
            notice(progress.received)
        }
    })
    notice(0)
    const pending = installAppUpdate(release.url, release.size, release.versionCode)
    try {
        const answer = await pending
        return { cancelledByUser, answer }
    } finally {
        finished = true
        unsubscribe()
    }
}

/**
 * The install half of an Android update, after the person chose Install. Every path returns normally and boot goes on:
 * a failure is an error alert boot waits on, a cancel or a return from the system installer is a toast.
 */
async function installAndroidUpdate(release: AndroidRelease): Promise<void> {
    if (!(await appUpdateInstallPermission())) {
        const permission = await explainAndOpenInstallSettings()
        if (permission === 'declined') {
            await remindLater()
            return
        }
        if (permission === 'off') {
            await reportPermissionStillOff()
            return
        }
    }
    let permissionRetried = false
    for (;;) {
        const { cancelledByUser, answer } = await downloadAndroidUpdate(release)
        if (cancelledByUser || (answer.kind === 'error' && answer.code === 'cancelled')) {
            alertClear()
            alertToast(language.updateDownloadCancelled)
            return
        }
        if (answer.kind === 'notInstalled') {
            alertClear()
            alertToast(language.updateNotInstalled)
            return
        }
        if (answer.code === 'permission') {
            // The permission went off while downloading: one more try after the person allows it again.
            if (!permissionRetried) {
                const permission = await explainAndOpenInstallSettings()
                if (permission === 'allowed') {
                    permissionRetried = true
                    continue
                }
                if (permission === 'declined') {
                    alertClear()
                    await remindLater()
                    return
                }
            }
            await reportPermissionStillOff()
            return
        }
        alertUpdateError(installErrorMessage(answer.code, answer.needed))
        await waitAlert()
        return
    }
}

/**
 * The Android boot check: the host fetches `latest-android.json`, this page validates it and offers the update, and
 * Install downloads, verifies and hands the file to the system installer. Silent when there is nothing to offer or the
 * host cannot say. The version and notes are untrusted text. Boot waits for the whole flow, as on desktop.
 */
async function checkAndroidUpdate(): Promise<void> {
    // While reminded no request is made at all.
    if(isUpdateReminderActive()){
        return
    }
    try {
        const checked = await checkAppUpdate()
        if(checked.kind !== 'ok'){
            return
        }
        const release = parseAndroidRelease(checked.json)
        if(!release || release.versionCode <= checked.installedVersionCode){
            return
        }
        const answer = await alertUpdateOffer({
            currentVersion: checked.installedVersionName,
            version: release.version,
            notes: release.notes,
            download: { sizeBytes: release.size, metered: checked.metered },
        })
        if(answer === 'install'){
            clearUpdateReminder()
            await installAndroidUpdate(release)
            return
        }
        await remindLater()
    } catch (error) {
        console.error(error)
    }
}

/**
 * Checks the fork's release endpoint once at boot and offers an update when there is one. Desktop
 * only: the updater plugin is not compiled into Android or iOS builds, and a dev build never polls
 * the endpoint or offers an install.
 *
 * The endpoint and the signing `pubkey` live under `plugins.updater` in `src-tauri/tauri.conf.json`
 * and change together: an update signed by a key other than that pubkey is rejected. An offer
 * appears only when the published release's version is higher than the app's `version`, the
 * top-level key of `src-tauri/tauri.conf.json` (Tauri uses it over `Cargo.toml`), so a release
 * needs that version raised. While no release is published the endpoint answers 404, `check()`
 * rejects and nothing is shown. The notes and versions come from `latest.json`, which the update
 * signature does not cover: they are untrusted text.
 *
 * Boot waits for this whole flow, so nothing loads behind an install and the installer cannot cut
 * a save short. A stalled download keeps the wait notice up; closing the window is safe and the
 * update is offered again at the next boot.
 */
export async function checkRisuUpdate(){
    if(import.meta.env.DEV){
        return
    }
    if(!isTauriDesktop){
        if(isTauri && hostChannelPresent()){
            await checkAndroidUpdate()
        }
        return
    }
    // While reminded no request is made at all.
    if(isUpdateReminderActive()){
        return
    }
    try {
        const update = await check({ timeout: UPDATE_CHECK_TIMEOUT_MS })
        if(!update){
            return
        }

        const answer = await alertUpdateOffer({
            currentVersion: update.currentVersion,
            version: update.version,
            notes: update.body ?? '',
        })

        if(answer === 'install'){
            clearUpdateReminder()
            alertWait(fillLang(language.alerts.updatingTo, { version: update.version }))
            try {
                await update.downloadAndInstall()
            } catch (error) {
                alertError(fillLang(language.updateInstallFailed, { error: errorText(error) }))
                await waitAlert()
                return
            }
            // The update is on disk by now; a failed restart is not an install failure.
            try {
                await relaunch()
            } catch (error) {
                console.error(error)
                alertError(language.updateRelaunchFailed)
                await waitAlert()
            }
            return
        }

        // Frees the Rust-side update resource; the offer is not taken.
        void update.close().catch(() => {})
        await remindLater()
    } catch (error) {
        console.error(error)
    }
}

declare global {
    interface Window {
        testUpdateReminder?: () => Promise<void>
    }
}

// Dev-only web console hook: shows the offer with sample data (not a real update). It never
// installs and never writes the reminder.
if (import.meta.env.DEV && typeof window !== 'undefined') {
    window.testUpdateReminder = async () => {
        const answer = await alertUpdateOffer({
            currentVersion: versionData.version,
            version: '9.9.9',
            notes: [
                '## Sample release notes (not a real update)',
                '',
                ...Array.from({ length: 30 }, (_, i) => `* Sample change ${i + 1}`),
                '<img src=x onerror="window.__updateXss=true">',
            ].join('\n'),
        })
        if (answer === 'install') {
            console.log('User chose to install')
            return
        }
        const options = [
            language.remindIgnore,
            language.remindLater1Day,
            language.remindLater3Days,
            language.remindLater5Days,
            language.remindLater1Week,
        ]
        const selected = await alertSelect(options, language.remindLaterQuestion, { cancel: '0' })
        console.log('Selected index:', selected)
    }
}
