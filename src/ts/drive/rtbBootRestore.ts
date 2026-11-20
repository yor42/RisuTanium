import { get } from 'svelte/store'
import { alertError, alertNormalWait, alertStore, alertWait, waitAlert } from '../alert'
import { language } from 'src/lang'
import { markAppInitiatedReload } from '../reloadGuard'
import { beginBusy, type BusyHandle } from '../process/memory/busyActions'
import { assetDeletionSettled } from '../storage/assetDeleteHold'
import { refuseOnReadOnlyPage } from '../storage/readOnlyPage'
import { alertStore as alertStoreState } from '../stores.svelte'
import type { BootImportEnd, BootImportTarget } from '../storage/store2/legacy/bootImport'
import { omittedTailsOf, planRestore, RtbRestoreError, type RestorePlanInput, type RestoreRequest } from '../storage/store2/rtb/restoreBuild'
import { defaultSideBackends, type SideRestoreResult } from './rtb/sideStores'
import { refuseBackupLoadWhileBusy } from './backupWorkGuard'
import { skippedNoticesOf } from './backuplocal'
import { copyRtbEntries, landedFactsOf, withCopiedKept, type CopyEnd } from './rtbRestoreCopy'
import { leftOutLines, realSideDeps, restoreSides } from './rtbRestoreFinish'
import { acquireRestoreHold, type HoldAcquire, type RestoreHold } from './rtbRestoreHold'
import { clearPluginGrants, rereadUnits } from './rtbRestoreInstall'
import { realVerifyDeps, verifyAndConfirm, type PickedRtb, type RtbVerifyEnd, type VerifiedRtb } from './rtbRestorePlan'

/**
 * The start-up `.rtb` restore (CHORE-128 S14b): the shell that runs a `.rtb` over the boot's installer, for the first-life
 * offers and the recovery screen. It has no page mode, no committer and no restore run. It takes the hold, runs the shared
 * verification and prompts (`verifyAndConfirm`), copies the assets, plans the restore and hands the built tree to the boot
 * target's `installBuiltTree`, which shares the keep list, the snapshot and the entry's installer with the `.bin` import.
 *
 * Invariants:
 * - The hold has one release site for every end that returns: the `finally`, which releases it `false` unless `handedOff`
 *   is set. The first-life reload path is the only caller of `release(true)`; it sets `handedOff` immediately before that
 *   call and never returns. No other branch calls `release`. The page's rule (release `true` once its commit was called: on
 *   a throw, or on a commit result `conflict` or `unknown`) does not apply here: every end that returns hands control to a
 *   caller that may open a profile on this page, and a write lock kept closed would make every save of that page wait forever.
 * - Nothing is written to the profile before every question is answered. The busy re-check is the gate (`beforeFirstWrite`),
 *   the last check before the installer call; it never runs inside `build`, where a throw would leave the marker standing.
 *   After the gate returned `true` the installer has been handed control: a throw then ends `reclassify`, and the boot
 *   classifies again. Before it, a throw ends `cancelled`. A gate that returns `true` is not a promise of a profile write: on the
 *   exit entry the installer can still end with no profile write, and the fence may have been written.
 * - `reclassify` is not proof of a throw: it also comes from a first-life marker that ended `conflict`, `abandoned` or
 *   `unknown`, from a marker refused with `store-not-empty`, and from an install that ended `abandoned`.
 * - A first-life install that landed never returns: the side data is restored, the notices are shown, the hold is handed off
 *   and the page reloads once into the restored profile. `markReload` and `reload` must stay the two calls of the recovery
 *   screen's own reload. The recovery exit returns `installed` and its controller reloads.
 * - The shell never rejects.
 */

/** The boot `.rtb` plan: what was verified and confirmed; no page target and no base. */
export type RtbBootPlan = VerifiedRtb

export interface RtbBootDeps {
    beginBusy(): BusyHandle
    /** A pending asset deletion settles before the listing (CHORE-830). */
    settled(): Promise<void>
    refuseOnReadOnlyPage(): Promise<boolean>
    refuseWhileBusy(own: BusyHandle): boolean
    acquireHold(busy: BusyHandle): Promise<HoldAcquire>
    verify(picked: PickedRtb): Promise<RtbVerifyEnd>
    copy(plan: RtbBootPlan, hold: RestoreHold): Promise<CopyEnd>
    reread(plan: RtbBootPlan): ReturnType<typeof rereadUnits>
    planRestore(input: RestorePlanInput): RestoreRequest
    clearGrants(plan: RtbBootPlan): Promise<void>
    applySides(plan: RtbBootPlan): Promise<SideRestoreResult[]>
    /** An OK-only notice, resolved when the person dismisses it. */
    notice(text: string): Promise<void>
    error(text: string): void
    /** Resolves when the alert on screen is dismissed. */
    waitAlert(): Promise<void>
    wait(text: string): void
    clearAlert(): void
    markReload(): void
    reload(): void
}

function realBootDeps(): RtbBootDeps {
    return {
        beginBusy: () => beginBusy('backupLoad'),
        settled: assetDeletionSettled,
        refuseOnReadOnlyPage,
        refuseWhileBusy: (own) => refuseBackupLoadWhileBusy(own),
        acquireHold: (busy) => acquireRestoreHold(busy),
        verify: (picked) => verifyAndConfirm(picked, realVerifyDeps(), { newerBase: null }),
        copy: (plan, hold) => copyRtbEntries(plan, hold),
        reread: (plan) => rereadUnits(plan),
        planRestore,
        clearGrants: (plan) => clearPluginGrants(plan, defaultSideBackends),
        applySides: (plan) => restoreSides(plan, realSideDeps()),
        notice: alertNormalWait,
        error: alertError,
        waitAlert,
        wait: alertWait,
        // Clears the shell's own wait text only: an error or a notice the person has not read stays.
        clearAlert: () => {
            if (get(alertStoreState).type === 'wait') {
                alertStore.set({ type: 'none', msg: '' })
            }
        },
        markReload: markAppInitiatedReload,
        reload: () => location.reload(),
    }
}

const CANCELLED: BootImportEnd = { kind: 'cancelled' }

/**
 * The start-up restore of a `.rtb` over the boot's installer (first life or the recovery exit). Never rejects.
 * `cancelled`: the profile was not installed and the boot asks again (assets may already be copied).
 * `finished`: the installer's own result, for the dispatch or the recovery screen, as for a `.bin`.
 * A first-life install that landed never settles: the page reloads into the restored profile.
 */
export async function runRtbBootRestore(picked: PickedRtb, target: BootImportTarget, options: Partial<RtbBootDeps> = {}): Promise<BootImportEnd> {
    const deps: RtbBootDeps = { ...realBootDeps(), ...options }
    const installBuiltTree = target.installBuiltTree
    if (installBuiltTree === undefined) {
        // A test double of the target only: the real boot target always carries the method.
        deps.error(language.backupRestoreFailed)
        return CANCELLED
    }
    let busy: BusyHandle | null = null
    let hold: RestoreHold | null = null
    let handedOff = false
    // The copy writes assets and inlays; from then on a throw names what may already have been written.
    let copyBegan = false
    // True once the gate returned `true`: the installer has been handed control.
    let gatePassed = false
    try {
        const own = deps.beginBusy()
        busy = own
        await deps.settled()
        if (await deps.refuseOnReadOnlyPage()) {
            return CANCELLED
        }
        if (deps.refuseWhileBusy(own)) {
            return CANCELLED
        }
        // The hold is taken before the verification, as on the page: the asset listing and the copy run under it.
        const acquired = await deps.acquireHold(own)
        if (acquired.kind !== 'held') {
            return CANCELLED
        }
        const held = acquired.hold
        hold = held

        const verdict = await deps.verify(picked)
        if (verdict.kind === 'ended') {
            return CANCELLED
        }
        const plan = verdict.verified

        copyBegan = true
        const copied = await deps.copy(plan, held)
        if (copied.kind === 'stopped') {
            // The copy shows its own text; a stop whose alert failed falls back to the generic write-failed text.
            if (!copied.shown) {
                deps.error(language.restoreWriteFailed)
            }
            return CANCELLED
        }

        // I0: the units are read again and must be the ones the verification saw.
        const units = await deps.reread(plan)
        if (units.kind === 'changed') {
            console.error(units.detail)
            deps.error(language.backupFileChangedWhileReading)
            return CANCELLED
        }

        // I3: the plan. The target keep is null and `req` empty: the old-file keep is the boot installer's own step.
        let request: RestoreRequest
        try {
            request = deps.planRestore({
                frames: units.frames,
                root: plan.store2.root,
                omitted: omittedTailsOf(plan.manifest.omitted),
                target: { legacyKeep: null, req: [] },
            })
        } catch (error) {
            if (error instanceof RtbRestoreError) {
                console.error(error)
                deps.error(withCopiedKept(language.rtbRestoreDamaged))
                return CANCELLED
            }
            throw error
        }

        deps.wait(language.rtbRestoreInstalling)
        const built = await installBuiltTree.call(target, {
            newUnits: request.newUnits,
            build: request.build,
            // The last check before the installer call: busy, then the plugin grants (MC-2252).
            beforeFirstWrite: async () => {
                if (deps.refuseWhileBusy(own)) {
                    return false
                }
                await deps.clearGrants(plan)
                gatePassed = true
                return true
            },
        })
        const outcome = built.outcome
        if (outcome.status === 'not-started') {
            deps.error(withCopiedKept(language.backupLoadWorkInProgress))
            return CANCELLED
        }
        if (outcome.status !== 'installed') {
            // `reclassify` (also from a marker that ended `conflict`, `abandoned` or `unknown`, one refused with `store-not-empty`,
            // or an install that ended `abandoned`), `blocked` and `exit` (no profile write; the fence may have been written):
            // the dispatch or the recovery screen takes it from here, and the hold is released `false` by the `finally`.
            return { kind: 'finished', result: outcome }
        }

        // B11: the side data and the notices. A failure here is logged and never changes the end: the profile landed.
        try {
            const facts = landedFactsOf(copied.facts)
            const results = await deps.applySides(plan)
            for (const notice of skippedNoticesOf(facts.skippedAssets, facts.inlays.skipped, plan.assets.limit)) {
                await deps.notice(notice)
            }
            const lines = leftOutLines(plan, results)
            if (lines.length > 0) {
                await deps.notice(language.rtbRestoreLeftOut(lines))
            }
        } catch (error) {
            console.error(error)
        }

        if (built.entry === 'exit') {
            // The recovery controller shows "Installed" and reloads.
            return { kind: 'finished', result: outcome }
        }

        // First life: reload once into the restored profile, with the write lock kept closed until then.
        try {
            deps.wait(language.store2Boot.recoveryInstalledBody)
        } catch (error) {
            console.error(error)
        }
        try {
            handedOff = true
            await held.release(true)
            deps.markReload()
            deps.reload()
        } catch (error) {
            console.error(error)
            try {
                deps.wait(language.restoreSavedReloadOrRestart)
            } catch (alertFailure) {
                console.error(alertFailure)
            }
        }
        // The page is leaving, or a manual reload or restart opens the installed profile; nothing here may return.
        return await new Promise<BootImportEnd>(() => { })
    } catch (error) {
        console.error(error)
        if (gatePassed) {
            // No profile write is promised any more: the installer may have landed. The boot classifies again.
            try {
                deps.error(language.store2ImportUnconfirmed)
                await deps.waitAlert()
            } catch (alertFailure) {
                console.error(alertFailure)
            }
            return { kind: 'finished', result: { status: 'reclassify' } }
        }
        try {
            deps.error(copyBegan ? language.restoreWriteFailed : language.store2ImportReadFailed)
        } catch (alertFailure) {
            console.error(alertFailure)
        }
        return CANCELLED
    } finally {
        // The one release site: every end that returns, a throw included.
        if (!handedOff) {
            try {
                await hold?.release(false)
            } catch (error) {
                console.error(error)
            }
        }
        try {
            deps.clearAlert()
        } catch (error) {
            console.error(error)
        }
        try {
            busy?.end()
        } catch (error) {
            console.error(error)
        }
    }
}
