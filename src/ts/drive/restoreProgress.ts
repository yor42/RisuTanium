import { language } from 'src/lang'
import { alertWait } from '../alert'
import { createExportTask, type ExportTask, type ExportTaskDef, type ExportTaskStepDef } from '../exportTask'
import { ExportCancelToken } from '../exportCancel'
import { isTauri } from '../platform'

/** The card of one restore run: its title and ordered steps, built where `language` is read. */
export type RestoreCardDef = ExportTaskDef<string> & { readonly steps: readonly ExportTaskStepDef<string>[] }

/** What a restore reports while it runs: a card run shows it on the task card, a legacy run as today's wait dialog. */
export interface RestoreProgress {
    /** The run moves to `step`; a legacy run shows `text` as its wait, or nothing new when `text` is null. */
    phase(step: string, text: string | null): void
    bytes(step: string, done: number, total: number, text: string | null): void
    /** A surface the TaskHost yield cannot cover (the .rtb password prompt): a card stands aside until the next report. */
    aside<T>(ask: () => Promise<T>): Promise<T>
    /** True once the person pressed Cancel (or Back/Escape while Cancel was offered); never true after a granted lockCancel. Legacy: false. */
    readonly cancelRequested: boolean
    /** An unbounded wait (the start-up clean-up): rejects with ExportCancelledError at a Cancel. Legacy: returns `wait`. */
    race<T>(wait: Promise<T>): Promise<T>
    /** The point of no return: true when no Cancel came first, and from then on the card shows the MC-2620 line. False after a Cancel. Legacy: true. */
    lockCancel(): boolean
    /** The cancelled ending ("Cancelled · Nothing was changed", OK). After a granted lockCancel it only leaves. Legacy: nothing. Never throws. */
    cancelled(): void
    /** The restore-point card after an old numbered backup was picked: the same run under the older-backup def, at `step`. Legacy: itself. */
    handOver(def: RestoreCardDef, step: string): RestoreProgress
    /** Takes the card away for good, without a result; idempotent. Legacy: nothing. Never throws. */
    leave(): void
}

/** What the `.rtb` preparation needs of a run's Cancel; a RestoreProgress satisfies it structurally. */
export type RestoreCancelGate = Pick<RestoreProgress, 'cancelRequested' | 'lockCancel'>

/** Exactly today's raw wait dialogs: a null text posts nothing, and there is no Cancel. */
export function legacyRestoreProgress(): RestoreProgress {
    const progress: RestoreProgress = {
        phase(_step, text) {
            if (text !== null) alertWait(text)
        },
        bytes(_step, _done, _total, text) {
            if (text !== null) alertWait(text)
        },
        aside: (ask) => ask(),
        cancelRequested: false,
        race: (wait) => wait,
        lockCancel: () => true,
        cancelled() {},
        handOver: () => progress,
        leave() {},
    }
    return progress
}

/** A card call must never throw into the restore it reports on. */
function guarded(call: () => void): void {
    try {
        call()
    } catch (error) {
        console.error(error)
    }
}

/**
 * Shows the restore on the task card with Cancel offered until `lockCancel`. Every card call is synchronous and guarded,
 * so the restore's order and side effects are the legacy route's. A granted lock is final: no Cancel can be accepted
 * after it, so `cancelled` then only leaves and a result card can never follow a commit.
 */
export function cardRestoreProgress(def: RestoreCardDef, token: ExportCancelToken = new ExportCancelToken()): RestoreProgress {
    let task: ExportTask<string> | null = null
    guarded(() => {
        const created = createExportTask<string>(def)
        created.useToken(token)
        created.open()
        task = created
    })
    let locked = false
    // Set when the run was handed over to another card: this instance then reports nothing.
    let inert = false
    const live = (): ExportTask<string> | null => (inert ? null : task)

    return {
        phase(step) {
            guarded(() => live()?.step(step))
        },
        bytes(step, done, total) {
            guarded(() => {
                const active = live()
                if (active === null) return
                active.step(step)
                active.bytes(done, total)
            })
        },
        aside(ask) {
            const active = live()
            if (active === null) return ask()
            try {
                return active.holdAside(ask)
            } catch (error) {
                console.error(error)
                return ask()
            }
        },
        get cancelRequested() {
            return token.cancelled
        },
        race: (wait) => token.race(wait),
        lockCancel() {
            let granted = !token.cancelled
            guarded(() => {
                const active = live()
                if (active !== null) granted = active.lockCancel()
            })
            if (granted) locked = true
            return granted
        },
        cancelled() {
            guarded(() => {
                const active = live()
                if (active === null) return
                if (locked) active.close()
                else active.cancelled(false)
            })
        },
        handOver(next, step) {
            const successor = cardRestoreProgress(next, token)
            successor.phase(step, null)
            inert = true
            return successor
        },
        leave() {
            guarded(() => live()?.close())
        },
    }
}

const step = (id: string, label: string, extra: Partial<ExportTaskStepDef<string>> = {}): ExportTaskStepDef<string> => ({ id, label, ...extra })

/** The other-tabs step exists only where a Web Lock hold is taken: not on Tauri. */
const tabsStep = (): ExportTaskStepDef<string>[] => (isTauri ? [] : [step('tabs', language.restoreStepTabs)])

export function restorePointCardDef(): RestoreCardDef {
    return {
        title: language.restorePointTaskTitle,
        steps: [step('save', language.restoreStepSave), ...tabsStep(), step('load', language.restoreStepLoad)],
    }
}

export function restoreOldCardDef(): RestoreCardDef {
    return {
        title: language.restoreOldTaskTitle,
        steps: [step('save', language.restoreStepSave), step('read', language.restoreStepRead), ...tabsStep(), step('load', language.restoreStepLoad)],
    }
}

export function binCardDef(): RestoreCardDef {
    return {
        title: language.restoreTaskTitle,
        steps: [
            step('save', language.restoreStepSave),
            step('check', language.importStepCheck),
            step('read', language.restoreStepRead),
            ...tabsStep(),
            step('copy', language.restoreStepCopy, { mark: 'transfer_in' }),
            step('files', language.restoreStepFinishFiles),
            step('load', language.restoreStepLoad),
        ],
    }
}

export function rtbCardDef(): RestoreCardDef {
    return {
        title: language.restoreTaskTitle,
        steps: [
            step('save', language.restoreStepSave),
            ...tabsStep(),
            step('check', language.importStepCheck),
            step('copy', language.restoreStepCopy, { mark: 'transfer_in' }),
            step('load', language.restoreStepLoad),
            step('finish', language.restoreStepFinish),
        ],
    }
}

export function restoreCleanupCardDef(): RestoreCardDef {
    return {
        title: language.restoreTaskTitle,
        steps: [step('cleanup', language.restoreStepCleanup)],
    }
}
