// What the startup screen shows. Boot is split into seven steps that exist on every platform, so the bar
// never jumps backwards and never pretends to know how long a step takes: it shows which step is running
// and, when a step reports counts, how far through that step it is.
import type { BrandStatus } from '../brand/brandStatus'

export type BootStep = 'storage' | 'save' | 'library' | 'app' | 'files' | 'plugins' | 'finish'

/** `waiting` means boot is paused on a message the user has to answer; `failed` means it stopped. */
export type BootState = 'running' | 'waiting' | 'failed' | 'ready'

export interface BootCount {
    readonly done: number
    readonly total: number
}

export interface BootProgress {
    readonly step: BootStep
    readonly state: BootState
    /** Counted work inside the step, such as characters archived so far. */
    readonly count?: BootCount
    /** More specific text for the step, already translated. */
    readonly detail?: string
    /** The library step is reading backups because the save file could not be decoded. */
    readonly recovering?: boolean
}

export const bootSteps: readonly BootStep[] = ['storage', 'save', 'library', 'app', 'files', 'plugins', 'finish']

// English fallbacks. The save file holds the language setting and is not read yet while these show,
// so a wired screen picks its strings from the browser language instead.
export const bootStepLabels: Record<BootStep, string> = {
    storage: 'Opening storage',
    save: 'Reading your save',
    library: 'Preparing your library',
    app: 'Checking the app',
    files: 'Listing stored files',
    plugins: 'Loading plugins',
    finish: 'Applying settings',
}

export const bootStateLabels: Record<Exclude<BootState, 'running'>, string> = {
    waiting: 'Waiting for you',
    failed: 'Startup stopped',
    ready: 'Ready',
}

const recoveringLabel = 'Recovering from a backup'

const stepStatus: Record<BootStep, BrandStatus> = {
    storage: 'scanning',
    save: 'transfer_in',
    library: 'preparing',
    app: 'scanning',
    files: 'scanning',
    plugins: 'tool_call',
    finish: 'finishing',
}

/** The status mark for a boot state. No new mark statuses: boot reuses the run and data ones. */
export function bootMarkStatus(progress: BootProgress): BrandStatus {
    if (progress.state === 'failed') return 'error'
    if (progress.state === 'waiting') return 'waiting'
    if (progress.state === 'ready') return 'done'
    if (progress.step === 'library' && progress.recovering) return 'transfer_in'
    return stepStatus[progress.step]
}

/**
 * The text for the live region. Changes only with the step or state, so a count ticking through a large
 * library does not queue an announcement per item; the count goes in the progress bar's value text.
 */
export function bootAnnouncement(progress: BootProgress): string {
    if (progress.state !== 'running') return bootStateLabels[progress.state]
    if (progress.step === 'library' && progress.recovering) return recoveringLabel
    return bootStepLabels[progress.step]
}

/** The visible text: the specific detail when there is one, otherwise the step or state label. */
export function bootLabel(progress: BootProgress): string {
    if (progress.state !== 'running') return bootStateLabels[progress.state]
    return progress.detail ?? bootStepLabels[progress.step]
}

/**
 * Fraction of the bar to fill, 0 to 1. Every step gets an equal share until boot timings are measured;
 * a counted step fills its share by its count, an uncounted one fills nothing until it ends (the screen
 * shows motion inside the current share instead). Callers keep the largest value they have shown, so a
 * count that restarts never moves the bar back.
 */
export function bootFraction(progress: BootProgress): number {
    if (progress.state === 'ready') return 1
    const index = bootSteps.indexOf(progress.step)
    const count = progress.count
    const within = count && count.total > 0 ? Math.min(Math.max(count.done / count.total, 0), 1) : 0
    return (index + within) / bootSteps.length
}

// The strings bootstrap.ts and bootArchiveHost.ts write into LoadingStatusState.text today. Lets a
// screen be built before the boot code reports structured progress. Unknown text keeps the previous step.
// Text alone never yields `waiting` or `failed`: boot shows those through the alert slot, so a screen
// built on this mapping alone has no pause or failure states. With a BootNotice, bootStateWithNotice
// supplies `waiting`; `failed` still has to come from boot's failure path.
const legacyText: readonly (readonly [string, BootStep, Partial<BootProgress>?])[] = [
    ['Checking Files...', 'storage'],
    ['Reading Save File...', 'save'],
    ['Loading Local Save File...', 'save'],
    ['Decoding Save File...', 'library'],
    ['Decoding Local Save File...', 'library'],
    ['Reading Backup Files...', 'library', { recovering: true, detail: recoveringLabel }],
    ['Checking Update...', 'app'],
    ['Checking Service Worker...', 'app'],
    ['Listing Stored Files...', 'files'],
    ['Loading Plugins...', 'plugins'],
    ['Checking For Format Update...', 'finish'],
    ['Updating States...', 'finish'],
]

const countedText = /^(Updating archived characters|Archiving characters) (\d+)\/(\d+)$/

export function bootProgressFromLegacyText(text: string, previous: BootStep = 'storage'): BootProgress {
    const exact = legacyText.find(([known]) => known === text)
    if (exact) return { step: exact[1], state: 'running', ...exact[2] }
    if (text.startsWith('Reading Backup File ')) {
        return { step: 'library', state: 'running', recovering: true, detail: recoveringLabel }
    }
    const counted = countedText.exec(text)
    if (counted) {
        const done = Number(counted[2])
        const total = Number(counted[3])
        // The text counts the item being worked on, from 1; the bar counts finished ones.
        return { step: 'library', state: 'running', detail: text, count: { done: Math.max(done - 1, 0), total } }
    }
    return { step: previous, state: 'running' }
}

/**
 * A boot-time alert shown inline under the bar instead of as the global alert modal (audit AUD-06).
 * While !$loadedStore the app adapter maps these $alertStore types here and skips <AlertComp /> for them:
 * - `normal` (alertNormal, alertNormalWait, bootUi.notify): kind 'normal' with onDismiss;
 * - `wait2` (alertErrorWait): kind 'error' with onDismiss;
 * - `error` (alertError): kind 'error' with onDismiss, `detail` = submsg, `stackTrace` = stackTrace;
 * - `wait` (alertWait): kind 'wait', with `onCancel` when the alert carries one.
 * Every other type, including the save-damage prompts (`select` from bootUi.choose, `ask` from bootUi.confirm
 * and the data-corruption questions, `markdown` reports), `staleAccountNotice`, `toast` and `progress`, stays
 * in AlertComp. Full mapping: AUDIT_RESPONSE.md R-06.
 */
export interface BootNotice {
    kind: 'normal' | 'error' | 'wait'
    /** Already translated. */
    message: string
    /** Secondary text, such as alertError's submsg (network-fetch help). */
    detail?: string
    /** alertError's stack trace, shown collapsed under "Technical details". */
    stackTrace?: string
    /** normal and error: the adapter sets alertStore to none, which resolves the awaiting caller and resumes boot. */
    onDismiss?: () => void
    dismissLabel?: string
    /** wait only: alertWait's onCancel. Without it a wait notice has no button. */
    onCancel?: () => void
    cancelLabel?: string
}

/**
 * The state the boot screen shows while a notice is up (review F-2d). A normal or error notice waits for the
 * person, so the mark and bar show `waiting` and the slow hint stays hidden. A wait notice keeps the boot state.
 * `failed` and `ready` come from boot itself and always win: a fatal error is the boot failure path
 * (the outer catch in bootstrap.ts's loadData) reporting `failed` with its alertError shown as the notice.
 */
export function bootStateWithNotice(state: BootState, notice?: BootNotice): BootState {
    if (!notice || state === 'failed' || state === 'ready' || notice.kind === 'wait') return state
    return 'waiting'
}
