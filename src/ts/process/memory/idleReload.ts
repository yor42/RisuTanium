/**
 * The idle reload's controller: one look at the gate per poll, the continuous
 * hold, and the reload itself. Everything it reads and does arrives through
 * `IdleReloadDeps`, so the web and desktop paths are tested without a browser;
 * the production binding is `idleReloadHost.ts`.
 *
 * On the web the final check and the reload call share one synchronous task: the
 * record is built, written and read back, and the page reloads, with nothing
 * able to run in between. On the desktop the record is written to a file, which
 * is asynchronous, so the final check is made again in the task that follows
 * the write and the reload is abandoned if anything it depends on moved.
 */

import {
    HOLD_MS,
    NOT_HOLDING,
    SELECTION_WITHDRAW_MS,
    idleGateBlockers,
    stepHold,
    type HoldState,
    type IdleSignals,
} from './idleGate'
import {
    writeHandoff,
    writeHandoffSync,
    type DraftsPart,
    type HandoffMedium,
    type SelectionPart,
    type SyncHandoffMedium,
} from './idleHandoff'

export interface IdleCarry {
    selection: SelectionPart
    drafts: DraftsPart
}

interface IdleReloadDepsBase {
    now(): number
    collectSignals(): IdleSignals
    /** Counters that only grow; a change in any restarts the hold and abandons a desktop reload. */
    epoch(): readonly number[]
    /** Builds the record from the live page. A throw abandons the reload. */
    buildCarry(now: number): IdleCarry
    /** Records the reload in the rate-limit history; true only when it reads back. */
    recordReload(now: number): boolean
    /** Called immediately before the page goes away. */
    markAppInitiatedReload(): void
}

export interface WebIdleReloadDeps extends IdleReloadDepsBase {
    platform: 'web'
    medium: SyncHandoffMedium
    /** Strips the launch inputs from the address and reloads. */
    reloadPage(): void
}

export interface DesktopIdleReloadDeps extends IdleReloadDepsBase {
    platform: 'desktop'
    medium: HandoffMedium
    relaunch(): Promise<void>
}

export type IdleReloadDeps = WebIdleReloadDeps | DesktopIdleReloadDeps

export interface IdleReloadController {
    /** One poll: reads the signals, advances the hold and reloads when it has held long enough. */
    look(): void
}

function sameEpoch(a: readonly number[], b: readonly number[]): boolean {
    return a.length === b.length && a.every((value, i) => value === b[i])
}

export function createIdleReloadController(deps: IdleReloadDeps): IdleReloadController {
    let hold: HoldState = NOT_HOLDING
    let desktopReloadRunning = false

    function withdraw(medium: HandoffMedium): void {
        for (const part of ['selection', 'drafts'] as const) {
            try {
                void Promise.resolve(medium.remove(part)).catch((error) => console.error(error))
            } catch (error) {
                console.error(error)
            }
        }
    }

    function reloadWeb(web: WebIdleReloadDeps): void {
        hold = NOT_HOLDING
        const now = web.now()
        let carry: IdleCarry
        try {
            carry = web.buildCarry(now)
        } catch (error) {
            console.error('The idle reload could not take its record:', error)
            return
        }
        if (!web.recordReload(now)) {
            return
        }
        let written = false
        try {
            written = writeHandoffSync(web.medium, carry.selection, carry.drafts)
        } catch (error) {
            console.error('The idle reload record could not be written:', error)
        }
        if (!written) {
            withdraw(web.medium)
            return
        }
        web.markAppInitiatedReload()
        web.reloadPage()
        // A reload the browser did not carry out (a plugin's own unload
        // listener can cancel it) must not leave a selection that a later boot
        // would apply. The drafts part stays: its text is put back without
        // displacing anything newer.
        setTimeout(() => {
            try {
                web.medium.remove('selection')
            } catch (error) {
                console.error(error)
            }
        }, SELECTION_WITHDRAW_MS)
    }

    async function reloadDesktop(desktop: DesktopIdleReloadDeps): Promise<void> {
        desktopReloadRunning = true
        try {
            hold = NOT_HOLDING
            const now = desktop.now()
            const before = desktop.epoch()
            let carry: IdleCarry
            try {
                carry = desktop.buildCarry(now)
            } catch (error) {
                console.error('The idle reload could not take its record:', error)
                return
            }
            let written = false
            try {
                written = await writeHandoff(desktop.medium, carry.selection, carry.drafts)
            } catch (error) {
                console.error('The idle reload record could not be written:', error)
            }
            // From here to the relaunch call everything is one synchronous task.
            if (!written) {
                withdraw(desktop.medium)
                return
            }
            if (idleGateBlockers(desktop.collectSignals()).length > 0 || !sameEpoch(before, desktop.epoch())) {
                withdraw(desktop.medium)
                return
            }
            if (!desktop.recordReload(desktop.now())) {
                withdraw(desktop.medium)
                return
            }
            desktop.markAppInitiatedReload()
            const relaunching = desktop.relaunch()
            await relaunching
        } catch (error) {
            console.error('The idle relaunch failed:', error)
            withdraw(desktop.medium)
        } finally {
            desktopReloadRunning = false
        }
    }

    return {
        look() {
            if (desktopReloadRunning) {
                return
            }
            const blockers = idleGateBlockers(deps.collectSignals())
            const step = stepHold(hold, { blocked: blockers.length > 0, epoch: deps.epoch(), now: deps.now() }, HOLD_MS)
            hold = step.state
            if (!step.fire) {
                return
            }
            if (deps.platform === 'web') {
                reloadWeb(deps)
            } else {
                void reloadDesktop(deps)
            }
        },
    }
}
