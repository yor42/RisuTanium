import { alertError, alertSelect, alertUpdateOffer, alertWait, waitAlert } from "./alert";
import { language } from "../lang";
import { fillLang } from "../lang/fill";
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
    if(import.meta.env.DEV || !isTauriDesktop){
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
