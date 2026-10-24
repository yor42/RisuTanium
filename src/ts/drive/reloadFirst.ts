/**
 * The "reload first" offer before a backup export on Android. A used page with a large library holds a lot of
 * memory the export then needs, so the person may reload the page first. The page saves everything with one whole
 * pass (waiting up to `RELOAD_WAIT_CAP_MS`), leaves a short-lived note, reloads, and the booted page opens the
 * export by itself. Any doubt about the save means no reload: the export then runs in place.
 *
 * The orchestrator registers no busy entry around the prompt or the wait: its own refusal set reads busy state.
 */
import { language } from 'src/lang'
import { alertClear, alertIsShowing, alertSelect, alertToast, alertWait, type alertData } from '../alert'
import { pageCovered, promptWaiting } from '../alertPrompts'
import { DBState } from '../stores.svelte'
import { getPageStorageMode } from '../storage/pageStorageMode'
import { isAndroidTransport } from '../storage/tauriByteTransport'
import { isSaveLoopParked } from '../storage/store2/saveLoop'
import { getSaveMarkCount, isSaveClean, requestWholeSave, wholeSaveAvailable } from '../globalApi.svelte'
import { hasLocalDrafts } from '../localDrafts'
import { inFlightKinds } from '../process/inFlightWork'
import { anyChokePointInFlight, isBusy } from '../process/memory/busyActions'
import { sessionUse } from '../process/sessionUse'
import { markAppInitiatedReload } from '../reloadGuard'
import { exportThisTabBackup, SaveLocalBackup, type ExportOutcome } from './backuplocal'
import { reloadAfterRestore } from './restoreReload'
import {
    clearResumeNote, hasUsedSinceLaunch, readDeclined, shouldAskReloadFirst, workBlocksReload, writeDeclined, writeResumeNote,
    type ResumeOp, type WorkProbes,
} from './reloadFirstPolicy'

/** From the answer "Reload first" to giving up and exporting in place. */
export const RELOAD_WAIT_CAP_MS = 20_000
export const RELOAD_WAIT_POLL_MS = 250
/** How long a page that was told to reload may stay alive before the reload counts as not having happened. */
export const RELOAD_ALIVE_CHECK_MS = 5_000

export interface ReloadFirstDeps {
    android(): boolean
    storeMode(): string
    used(): boolean
    counts(): { characters: number, modules: number }
    storage(): Storage | null
    now(): number
    sleep(ms: number): Promise<void>
    work(): WorkProbes
    wholeSaveAvailable(): boolean
    requestWholeSave(): boolean
    isSaveClean(): boolean
    isSaveLoopParked(): boolean
    /** Asks the person; '0' is "Reload first", '1' is "No, continue". */
    ask(): Promise<string>
    showWait(): alertData
    noticeShown(notice: alertData): boolean
    clearNotice(): void
    toastDidNotReload(): void
    pageCovered(): boolean
    promptWaiting(): boolean
    exportInPlace(kind: ResumeOp): Promise<ExportOutcome>
    markReload(): void
    reload(): Promise<void>
}

let asking = false

type WaitOutcome = { kind: 'ready', notice: alertData } | { kind: 'refused', notice: alertData | null }

/**
 * Asks for one whole save and waits for the page to be clean, up to `deadlineAt`. Refuses, leaving the flag set
 * (the next pass is whole, which is harmless), when the request is not accepted, the loop parks, the deadline
 * passes or the wait notice is no longer the thing on screen.
 */
export async function waitForSavedState(deps: ReloadFirstDeps, deadlineAt: number): Promise<WaitOutcome> {
    if (!deps.requestWholeSave()) {
        return { kind: 'refused', notice: null }
    }
    const notice = deps.showWait()
    while (true) {
        if (!deps.noticeShown(notice) || deps.isSaveLoopParked()) {
            return { kind: 'refused', notice }
        }
        if (deps.isSaveClean()) {
            return { kind: 'ready', notice }
        }
        if (deps.now() >= deadlineAt) {
            return { kind: 'refused', notice }
        }
        await deps.sleep(RELOAD_WAIT_POLL_MS)
    }
}

/** Whether a reload now loses nothing: nothing in flight, the save is complete, the notice is still the one on screen, and no prompt waits. */
function safeToReload(deps: ReloadFirstDeps, notice: alertData): boolean {
    return !workBlocksReload(deps.work())
        && deps.isSaveClean()
        && !deps.isSaveLoopParked()
        && deps.noticeShown(notice)
        && !deps.promptWaiting()
}

/**
 * Runs the export of `kind` after the confirms the buttons already ask. With no offer, a refusal or "No" it runs in
 * place. A second call while the prompt, the wait or a covering alert is up does nothing; once an in-place export
 * has started the call no longer blocks another one.
 */
export async function askReloadFirstThenExport(kind: ResumeOp, deps: ReloadFirstDeps = realDeps()): Promise<void> {
    if (asking) {
        return
    }
    asking = true
    let released = false
    const releasing: ReloadFirstDeps = {
        ...deps,
        exportInPlace: (exportKind) => {
            released = true
            asking = false
            return deps.exportInPlace(exportKind)
        },
    }
    try {
        await run(kind, releasing)
    } finally {
        if (!released) {
            asking = false
        }
    }
}

async function run(kind: ResumeOp, deps: ReloadFirstDeps): Promise<void> {
    const storage = deps.storage()
    const counts = deps.counts()
    const blocked = workBlocksReload(deps.work()) || !deps.wholeSaveAvailable()
    const offer = shouldAskReloadFirst({
        android: deps.android(),
        storeMode: deps.storeMode(),
        used: deps.used(),
        characters: counts.characters,
        modules: counts.modules,
        declined: readDeclined(storage),
        workInFlight: blocked,
    })
    if (!offer) {
        await deps.exportInPlace(kind)
        return
    }
    const answer = await deps.ask()
    if (answer !== '0') {
        if (answer === '1') {
            writeDeclined(storage)
        }
        await deps.exportInPlace(kind)
        return
    }

    const outcome = await waitForSavedState(deps, deps.now() + RELOAD_WAIT_CAP_MS)
    if (outcome.kind === 'refused' || !safeToReload(deps, outcome.notice)) {
        await refuse(kind, deps, outcome.notice)
        return
    }
    if (!writeResumeNote(storage, kind, deps.now())) {
        await refuse(kind, deps, outcome.notice)
        return
    }
    if (!safeToReload(deps, outcome.notice)) {
        clearResumeNote(storage)
        await refuse(kind, deps, outcome.notice)
        return
    }
    deps.markReload()
    await deps.reload()
    // Still here: a plugin or the browser cancelled the reload. Nothing runs later.
    await deps.sleep(RELOAD_ALIVE_CHECK_MS)
    clearResumeNote(storage)
    deps.clearNotice()
    deps.toastDidNotReload()
}

/**
 * Exports in place, silently. When something else took the notice's place and covers the page (a save failure
 * report, a prompt), the export waits until the person has closed it, so a failure stays visible; a toast does not cover the page.
 */
async function refuse(kind: ResumeOp, deps: ReloadFirstDeps, notice: alertData | null): Promise<void> {
    const displaced = notice !== null && !deps.noticeShown(notice)
    if (displaced) {
        while (deps.pageCovered()) {
            await deps.sleep(RELOAD_WAIT_POLL_MS)
        }
    }
    await deps.exportInPlace(kind)
}

/** After a booted page is ready: runs the export a resume note asked for, only on an Android store2 page with no busy action. */
export async function runResumedExport(op: ResumeOp | null, deps: ResumeDeps = realResumeDeps()): Promise<void> {
    if (op === null || !deps.android() || deps.storeMode() !== 'store2' || deps.busy()) {
        return
    }
    await deps.exportInPlace(op)
}

export interface ResumeDeps {
    android(): boolean
    storeMode(): string
    busy(): boolean
    exportInPlace(kind: ResumeOp): Promise<ExportOutcome>
}

function exportInPlace(kind: ResumeOp): Promise<ExportOutcome> {
    return kind === 'export-full' ? SaveLocalBackup() : exportThisTabBackup()
}

function realResumeDeps(): ResumeDeps {
    return {
        android: isAndroidTransport,
        storeMode: () => getPageStorageMode().kind,
        busy: () => isBusy(),
        exportInPlace,
    }
}

function sessionStorageOrNull(): Storage | null {
    try {
        return window.sessionStorage
    } catch {
        return null
    }
}

function realDeps(): ReloadFirstDeps {
    return {
        android: isAndroidTransport,
        storeMode: () => getPageStorageMode().kind,
        used: () => hasUsedSinceLaunch(sessionUse(getSaveMarkCount())),
        counts: () => ({ characters: DBState.db.characters.length, modules: DBState.db.modules.length }),
        storage: sessionStorageOrNull,
        now: () => Date.now(),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        work: () => ({
            drafts: hasLocalDrafts(),
            inFlight: inFlightKinds().length > 0,
            busy: isBusy(),
            chokePoint: anyChokePointInFlight(),
            parked: isSaveLoopParked(),
        }),
        wholeSaveAvailable,
        requestWholeSave,
        isSaveClean,
        isSaveLoopParked,
        ask: () => alertSelect([language.reloadFirstYes, language.reloadFirstNo], language.reloadFirstPrompt),
        showWait: () => alertWait(language.store2RestoreSaving),
        noticeShown: alertIsShowing,
        clearNotice: alertClear,
        toastDidNotReload: () => alertToast(language.reloadFirstDidNotReload),
        pageCovered,
        promptWaiting,
        exportInPlace,
        markReload: markAppInitiatedReload,
        reload: reloadAfterRestore,
    }
}

export function resetReloadFirstForTest(): void {
    asking = false
}
