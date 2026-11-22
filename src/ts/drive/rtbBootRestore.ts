import { get } from 'svelte/store'
import { alertError, alertNormalWait, alertStore, alertWait, waitAlert } from '../alert'
import { askRtbPassword } from './rtbSealedOpen'
import { cardRestoreProgress, rtbBootCardDef, type RestoreProgress } from './restoreProgress'
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
import { copyRtbEntries, landedFactsOf, withCopiedKept, type CopyEnd, type RtbCopyDeps } from './rtbRestoreCopy'
import { leftOutLines, realSideDeps, restoreSides, stageConnectionKeys } from './rtbRestoreFinish'
import { acquireRestoreHold, type HoldAcquire, type HoldOptions, type RestoreHold } from './rtbRestoreHold'
import { clearPluginGrants, rereadUnits } from './rtbRestoreInstall'
import { realVerifyDeps, verifyAndConfirm, type PickedRtb, type RtbVerifyDeps, type RtbVerifyEnd, type VerifiedRtb } from './rtbRestorePlan'

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
 *   The gate then clears the plugin grants and stages `side.connection-keys` (add-only), so every staging record is durable
 *   before the profile commit can land; every other side section runs after the install landed, and the finish never applies a
 *   connection-keys `restore`. A staging that fails is named in the notice and does not stop the install.
 *   After the gate returned `true` the installer has been handed control: a throw then ends `reclassify`, and the boot
 *   classifies again. Before it, a throw ends `cancelled`. A gate that returns `true` is not a promise of a profile write: on the
 *   exit entry the installer can still end with no profile write, and the fence may have been written.
 * - `reclassify` is not proof of a throw: it also comes from a first-life marker that ended `conflict`, `abandoned` or
 *   `unknown`, from a marker refused with `store-not-empty`, and from an install that ended `abandoned`.
 * - A first-life install that landed never returns: the side data is restored, the notices are shown, the hold is handed off
 *   and the page reloads once into the restored profile. `markReload` and `reload` must stay the two calls of the recovery
 *   screen's own reload. The recovery exit returns `installed` and its controller reloads.
 * - The shell never rejects.
 * - The run shows its phases on the task card with no Cancel (MC-3634). Every card call is synchronous and guarded, so a card
 *   failure never changes how the restore ends or the order of any other call. The card is gone before the shell's own
 *   error and notice alerts, before the stop alerts of the verification and the copy, and before the first-life installed
 *   text, and `leaveCard` is called again, idempotently, by the `finally`. An early refusal inside a dep (read-only page,
 *   busy, hold refused) raises its alert with the card still open: the host yields to that alert and the `finally` leaves
 *   right after.
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
    /** Stages the connection keys inside the gate, before the profile commit can land; never rejects. */
    stageKeys(plan: RtbBootPlan): Promise<SideRestoreResult | null>
    /** `staged` is the result `stageKeys` returned: a connection-keys `restore` is not applied again here. */
    applySides(plan: RtbBootPlan, staged: SideRestoreResult | null): Promise<SideRestoreResult[]>
    /** An OK-only notice, resolved when the person dismisses it. */
    notice(text: string): Promise<void>
    error(text: string): void
    /** Resolves when the alert on screen is dismissed. */
    waitAlert(): Promise<void>
    wait(text: string): void
    clearAlert(): void
    markReload(): void
    reload(): void
    /** Opens the restore's task card, with no Cancel (MC-3634). A throw means the restore runs with the legacy wait dialogs. */
    openCard(): RestoreProgress
}

/** The card the run holds, read by the real `verify`, `copy` and `wait`; null before it opens and once it left. */
interface CardBox {
    card: RestoreProgress | null
}

/**
 * The start-up restore's calls on the card: the file check reports the `check` step, the sealed file's password prompt
 * stands the card aside, the copy's bytes move the `copy` step, and a stop's alert comes after the card leaves.
 */
export function bootCardWiring(progress: RestoreProgress): { verifyDeps: Partial<RtbVerifyDeps>, copyDeps: Partial<RtbCopyDeps> } {
    const showError = (text: string): void => {
        progress.leave()
        alertError(text)
    }
    return {
        verifyDeps: {
            wait: () => progress.phase('check', null),
            password: (reason) => progress.aside(() => askRtbPassword(reason)),
            error: showError,
        },
        copyDeps: {
            bytes: (done, total) => progress.bytes('copy', done, total, null),
            error: showError,
        },
    }
}

/**
 * The hold's other-tabs wait on a non-Tauri boot: with the card open it reports the card's `check` step (the boot card has
 * no tabs step) and raises no wait alert over it; without a card the hold keeps its own wait.
 */
export function bootHoldOptions(card: RestoreProgress | null): HoldOptions {
    return card === null ? {} : { checking: () => card.phase('check', null) }
}

function realBootDeps(box: CardBox): RtbBootDeps {
    return {
        beginBusy: () => beginBusy('backupLoad'),
        settled: assetDeletionSettled,
        refuseOnReadOnlyPage,
        refuseWhileBusy: (own) => refuseBackupLoadWhileBusy(own),
        acquireHold: (busy) => acquireRestoreHold(busy, bootHoldOptions(box.card)),
        verify: (picked) => verifyAndConfirm(picked, box.card === null ? realVerifyDeps() : { ...realVerifyDeps(), ...bootCardWiring(box.card).verifyDeps }, { newerBase: null }),
        copy: (plan, hold) => copyRtbEntries(plan, hold, box.card === null ? {} : bootCardWiring(box.card).copyDeps),
        reread: (plan) => rereadUnits(plan),
        planRestore,
        clearGrants: (plan) => clearPluginGrants(plan, defaultSideBackends),
        stageKeys: (plan) => stageConnectionKeys(plan, realSideDeps()),
        applySides: (plan, staged) => restoreSides(plan, realSideDeps(), staged),
        notice: alertNormalWait,
        error: alertError,
        waitAlert,
        // While the card is open the `load` step is its own wait text; the first-life texts come after it left.
        wait: (text) => {
            if (box.card === null) {
                alertWait(text)
            }
        },
        openCard: () => cardRestoreProgress(rtbBootCardDef(), null),
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
    const box: CardBox = { card: null }
    const deps: RtbBootDeps = { ...realBootDeps(box), ...options }
    const installBuiltTree = target.installBuiltTree
    if (installBuiltTree === undefined) {
        // A test double of the target only: the real boot target always carries the method.
        deps.error(language.backupRestoreFailed)
        return CANCELLED
    }
    // A card failure never changes how the restore ends: every call is guarded, and without a card the run is the legacy one.
    const cardPhase = (step: string): void => {
        try {
            box.card?.phase(step, null)
        } catch (error) {
            console.error(error)
        }
    }
    // The card is gone before any error, notice or wait alert of the shell; idempotent, and the `finally` calls it again.
    const leaveCard = (): void => {
        const card = box.card
        box.card = null
        try {
            card?.leave()
        } catch (error) {
            console.error(error)
        }
    }
    let busy: BusyHandle | null = null
    let hold: RestoreHold | null = null
    let handedOff = false
    // The copy writes assets and inlays; from then on a throw names what may already have been written.
    let copyBegan = false
    // True once the gate returned `true`: the installer has been handed control.
    let gatePassed = false
    // The connection-keys staging result of the gate; null when that action is not a `restore`.
    let staged: SideRestoreResult | null = null
    try {
        // Opened with no await before it and before `beginBusy`: a throwing `beginBusy` leaves no card behind (the `finally` leaves it).
        try {
            box.card = deps.openCard()
        } catch (error) {
            console.error(error)
        }
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

        cardPhase('check')
        const verdict = await deps.verify(picked)
        if (verdict.kind === 'ended') {
            return CANCELLED
        }
        if (verdict.kind === 'settings') {
            // A settings-only file cannot set up a profile: refused with the hint, nothing is copied, planned or installed.
            leaveCard()
            deps.error(language.rtbRestoreSettingsAtStart)
            return CANCELLED
        }
        const plan = verdict.verified

        copyBegan = true
        cardPhase('copy')
        const copied = await deps.copy(plan, held)
        if (copied.kind === 'stopped') {
            // The copy shows its own text; a stop whose alert failed falls back to the generic write-failed text.
            leaveCard()
            if (!copied.shown) {
                deps.error(language.restoreWriteFailed)
            }
            return CANCELLED
        }

        // I0: the units are read again and must be the ones the verification saw.
        const units = await deps.reread(plan)
        if (units.kind === 'changed') {
            console.error(units.detail)
            leaveCard()
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
                leaveCard()
                deps.error(withCopiedKept(language.rtbRestoreDamaged))
                return CANCELLED
            }
            throw error
        }

        cardPhase('load')
        deps.wait(language.rtbRestoreInstalling)
        const built = await installBuiltTree.call(target, {
            newUnits: request.newUnits,
            build: request.build,
            // The last check before the installer call: busy, then the plugin grants (MC-2252), then the connection keys,
            // staged so every record is durable before the profile commit can land.
            beforeFirstWrite: async () => {
                if (deps.refuseWhileBusy(own)) {
                    return false
                }
                await deps.clearGrants(plan)
                staged = await deps.stageKeys(plan)
                gatePassed = true
                return true
            },
        })
        const outcome = built.outcome
        if (outcome.status === 'not-started') {
            leaveCard()
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
            cardPhase('finish')
            const results = await deps.applySides(plan, staged)
            leaveCard()
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
        leaveCard()
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
        leaveCard()
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
        leaveCard()
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
