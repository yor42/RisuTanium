import { alertClear, alertWait, type alertData } from "./alert"
import { alertStore } from "./stores.svelte"
import { get } from "svelte/store"

/** What a call of a cancelled export rejects with. It is the person's choice, never a failure to report. */
export class ExportCancelledError extends Error {
    constructor() {
        super('The export was cancelled')
        this.name = 'ExportCancelledError'
    }
}

/**
 * One cancel switch per export run. `cancel` is idempotent and runs each registered action once, at the first call.
 * `race` settles a pending call at once on a cancel, whether or not the call ever settles by itself.
 */
export class ExportCancelToken {
    private done = false
    private actions: (() => void)[] = []
    private rejecters = new Set<(error: ExportCancelledError) => void>()

    get cancelled(): boolean {
        return this.done
    }

    cancel(): void {
        if (this.done) {
            return
        }
        this.done = true
        const actions = this.actions
        this.actions = []
        for (const action of actions) {
            try {
                action()
            } catch (error) {
                console.error(error)
            }
        }
        const rejecters = [...this.rejecters]
        this.rejecters.clear()
        for (const reject of rejecters) {
            reject(new ExportCancelledError())
        }
    }

    throwIfCancelled(): void {
        if (this.done) {
            throw new ExportCancelledError()
        }
    }

    /** Runs `action` at the cancel; at once when the token is already cancelled. */
    onCancel(action: () => void): void {
        if (this.done) {
            action()
            return
        }
        this.actions.push(action)
    }

    /** `promise`, or a rejection with `ExportCancelledError` as soon as the token is cancelled; the loser is ignored. */
    race<T>(promise: Promise<T>): Promise<T> {
        if (this.done) {
            promise.catch(() => undefined)
            return Promise.reject(new ExportCancelledError())
        }
        return new Promise<T>((resolve, reject) => {
            const rejecter = (error: ExportCancelledError) => reject(error)
            this.rejecters.add(rejecter)
            promise.then(
                (value) => {
                    this.rejecters.delete(rejecter)
                    resolve(value)
                },
                (error: unknown) => {
                    this.rejecters.delete(rejecter)
                    reject(error)
                },
            )
        })
    }
}

/** The progress dialog of one export run, tied to its cancel token. */
export interface ExportWaitGate {
    /** Shows `msg` as the export's wait dialog; after a cancel it posts nothing. */
    wait(msg: string): void
    /** Removes the export's own wait if it is still the one on screen, so a prompt the export asks next is not hidden under it. */
    clear(): void
}

/**
 * The wait dialog of an export. With `cancellable`, each dialog carries a Cancel that cancels `token` and replaces the
 * dialog itself; the callback is safe to run twice because Back and Escape run it as well. A gate that is not
 * cancellable only shows the text.
 */
export function createExportWaitGate(token: ExportCancelToken, cancellable: boolean): ExportWaitGate {
    let current: alertData | null = null
    const clear = () => {
        if (current !== null && get(alertStore) === current) {
            alertClear()
        }
        current = null
    }
    const onCancel = () => {
        token.cancel()
        clear()
    }
    return {
        wait(msg) {
            if (token.cancelled) {
                return
            }
            current = cancellable ? alertWait(msg, onCancel) : alertWait(msg)
        },
        clear,
    }
}
