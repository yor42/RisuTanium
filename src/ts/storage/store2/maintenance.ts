import { startQuietTrigger, type QuietTrigger } from '../../process/memory/putBackQuiet'
import type { ByteStore } from '../store/contract'
import { getPageStorageMode } from '../pageStorageMode'
import { recordStartupCleanup } from '../startupCleanupState'
import { getStore2BootSession } from './bootActive'
import { runOldDataDeletion } from './oldData/delete'
import type { Store2Session } from './session'

/**
 * The deleters a store2 page runs on its own, one at a time, after the page has been quiet. Today that is the cutover
 * deletion of old-format files (`oldData/delete.ts`).
 *
 * - It runs only on a page whose own boot found a normal store2 profile (the "commit key parses with a readable tree" row),
 *   so the converted tree has been opened cold once before anything irreversible is deleted. The runner starts only on a
 *   boot whose session classified as a normal store2 boot (the commit key parses); a boot that installs the tree and then
 *   re-reads it cold in a later round can classify that way, which still meets the rule that deletion follows a cold read
 *   of the installed tree. A recovery boot and a legacy, block or read-only page never reach it.
 * - It waits for the quiet trigger of the character put-back: hidden after a committed save, or 30 s without input.
 * - The step is registered as the startup clean-up when it starts, so a backup load that waits on the startup clean-up
 *   waits for this step to end and no longer; the registered promise always settles and never rejects.
 * - It shows nothing to the person.
 */

/** What the page gives the runner: its byte store and the non-pruning numbered-backup listing. */
export interface MaintenanceEnv {
    store: () => Promise<ByteStore>
    listBackupTimes: () => Promise<number[]>
}

/** The replaceable parts, for tests. */
export interface MaintenanceSeams {
    session?: () => Store2Session | null
    startTrigger?: (run: () => void) => QuietTrigger
    deletion?: typeof runOldDataDeletion
}

let stepActive = false

/** Whether the boot that opened this session found the profile ready (row 5) instead of installing it. */
export function bootDidNotInstall(session: Store2Session): boolean {
    const decision = session.decision
    return decision.row === 5 && decision.mode === 'normal'
}

async function runStep(env: MaintenanceEnv, session: Store2Session, deletion: typeof runOldDataDeletion): Promise<void> {
    if (stepActive) {
        return
    }
    stepActive = true
    const step = (async () => {
        try {
            await deletion(session, { store: await env.store(), listBackupTimes: env.listBackupTimes })
        } catch (error) {
            console.error(error)
        } finally {
            stepActive = false
        }
    })()
    recordStartupCleanup(step)
    await step
}

/**
 * Starts the runner on this page, or does nothing: the page must be a store2 page whose boot did not install. Detached
 * by design: it never throws and the boot never awaits it. Returns the armed trigger, or `null` when nothing was started.
 */
export function startStore2Maintenance(env: MaintenanceEnv, seams: MaintenanceSeams = {}): QuietTrigger | null {
    try {
        if (getPageStorageMode().kind !== 'store2') {
            return null
        }
        const session = (seams.session ?? getStore2BootSession)()
        if (session === null || !bootDidNotInstall(session)) {
            return null
        }
        const deletion = seams.deletion ?? runOldDataDeletion
        const trigger = (seams.startTrigger ?? startQuietTrigger)(() => {
            trigger.stop()
            void runStep(env, session, deletion)
        })
        trigger.arm()
        return trigger
    } catch (error) {
        console.error(error)
        return null
    }
}

export function resetMaintenanceForTests(): void {
    stepActive = false
}
