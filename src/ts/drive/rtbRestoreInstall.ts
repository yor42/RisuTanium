import { alertError, alertWait } from '../alert'
import { language } from 'src/lang'
import { Store2StalePageError } from '../storage/store2/backend/errors'
import type { Store2Backend, Store2Read } from '../storage/store2/backend/types'
import { IMPORT_REPLACES_BASE, type CommitResult, type Committer } from '../storage/store2/commit'
import { isKnownUnitType } from '../storage/store2/format'
import { baseManifestOf, type BaseManifest } from '../storage/store2/legacy/importTree'
import { omittedTailsOf, planRestore, RtbRestoreError, type RestorePlanInput, type RestoreRequest } from '../storage/store2/rtb/restoreBuild'
import { applySideAction, defaultSideBackends, type SideBackends } from './rtb/sideStores'
import { decodeBlock } from './rtb/unitBlocks'
import { RtbCouldNotReadError } from './rtb/rangeSource'
import { readEntry } from './rtb/zip64Reader'
import { copyRtbEntries, landedFactsOf, withCopiedKept, type CopyEnd, type RtbCopyCause, type RtbCopyDeps, type RtbCopyPlan, type RtbInstallFacts } from './rtbRestoreCopy'
import { checkAuthoritativeBase, isRtbBusyAbort, rtbGuardedCommitter, type RestoreHold } from './rtbRestoreHold'
import type { RestorePlan } from './rtbRestorePlan'
import type { Store2ImportRefusal } from './storeImport'

/**
 * The install stage of a `.rtb` restore (CHORE-128 S12a-2): after the copy, the file's units are re-read and checked
 * against what the verification saw (I0), the commit key is read again and the guards re-asked (I1, I2), the restore is
 * planned (I3), the plugin grants are cleared (MC-2252), and the profile is committed (I4).
 *
 * `installRtbRestore` never rejects. Every throw outside a decided stop becomes an end: `unconfirmed` once the commit was called, because the
 * commit may have landed and the write lock must then stay closed; otherwise `stopped` with `write-failed`. The hold is
 * released on every end but `landed` (the finish stage releases that one), and the release runs before the end's message,
 * each in a `try` of its own, so neither can keep the other from running.
 *
 * Invariants:
 * - Once `commit()` was called, no path reaches `release(false)` except a busy abort thrown by the flip's guard and a
 *   result the committer reported as not written.
 * - The commit goes through `rtbGuardedCommitter(...).commit`, never `commitStreamed`, so the busy check at the flip runs.
 * - The plugin grants are cleared after the guard and the plan, immediately before the commit, and not before.
 * - Every stop after the copy began names what the copy left on this device, unless its message already says so.
 */

export type RtbInstallCause =
    | RtbCopyCause
    | Store2ImportRefusal
    | 'base-moved'
    | 'declined'
    | 'damaged'
    | 'unconfirmed'

export type RtbInstallEnd =
    /** The commit landed; the hold is still held and the finish stage releases it. */
    | { kind: 'landed', flushed: boolean | undefined, facts: RtbInstallFacts }
    /** The commit may or may not have landed; the hold is released with the write lock kept closed. */
    | { kind: 'unconfirmed', cause: RtbInstallCause, facts: RtbInstallFacts }
    /** Nothing was committed; the hold is released. */
    | { kind: 'stopped', outcome: 'nothing-replaced' | 'failed', cause: RtbInstallCause, facts: RtbInstallFacts }

/** The part of the plan this stage reads. */
export type RtbInstallPlan = RtbCopyPlan & Pick<RestorePlan, 'store2' | 'manifest' | 'target' | 'base' | 'side'>

/** The calls the install makes outside the file; tests replace them to observe order and to keep the page out of it. */
export interface RtbInstallDeps {
    copy(plan: RtbInstallPlan, hold: RestoreHold): Promise<CopyEnd>
    /** Passed to the copy by the default `copy`. */
    copyDeps?: Partial<RtbCopyDeps>
    baseManifest(backend: Store2Backend, read: Store2Read): Promise<BaseManifest>
    planRestore(input: RestorePlanInput): RestoreRequest
    /** The facts of a landed end, built after the commit returned. */
    facts(copied: RtbInstallFacts): RtbInstallFacts
    sideBackends: SideBackends
    error(text: string): void
    wait(text: string): void
}

function realInstallDeps(): Omit<RtbInstallDeps, 'copy'> {
    return {
        baseManifest: baseManifestOf,
        planRestore,
        facts: landedFactsOf,
        sideBackends: defaultSideBackends,
        error: alertError,
        wait: alertWait,
    }
}

const PLUGIN_PERMISSIONS = 'side.plugin-permissions'

function emptyFacts(): RtbInstallFacts {
    return { assetsWritten: 0, assetsPresent: 0, skippedAssets: [], inlays: { written: 0, skipped: [], changed: false } }
}

/** The units of the file's blocks as the verification saw them, or the reason they are not. */
export async function rereadUnits(plan: Pick<RestorePlan, 'source' | 'index' | 'store2'>): Promise<{ kind: 'ok', frames: Map<string, Uint8Array> } | { kind: 'changed', detail: string }> {
    const frames = new Map<string, Uint8Array>()
    const seenTails = new Set<string>()
    for (const block of plan.store2.blocks) {
        const entry = plan.index.entry(block)
        const bytes = new Uint8Array(entry.uncompressedSize)
        let at = 0
        let overflowed = false
        try {
            const read = await readEntry(plan.source, plan.index, block, (chunk) => {
                if (at + chunk.length > bytes.length) {
                    overflowed = true
                    return
                }
                bytes.set(chunk, at)
                at += chunk.length
            })
            if (read.ok === false || overflowed) {
                return { kind: 'changed', detail: `${entry.name} no longer reads as it did` }
            }
        } catch (error) {
            if (error instanceof RtbCouldNotReadError) {
                return { kind: 'changed', detail: error.message }
            }
            throw error
        }
        const decoded = decodeBlock(bytes, seenTails)
        if (decoded.kind === 'damaged') {
            return { kind: 'changed', detail: `${entry.name}: ${decoded.reason}` }
        }
        for (const unit of decoded.units) {
            const seen = plan.store2.tails.get(unit.tail)
            if (seen === undefined) {
                // A unit of a type this build does not know was never kept by the verification, and the plan never reaches it.
                if (isKnownUnitType(unit.type)) {
                    return { kind: 'changed', detail: `the unit ${unit.tail} was not there when the file was checked` }
                }
                continue
            }
            const crc = new DataView(unit.frame.buffer, unit.frame.byteOffset, unit.frame.byteLength).getUint32(unit.frame.length - 4, true)
            if (seen.type !== unit.type || seen.length !== unit.frame.length || seen.crc !== crc) {
                return { kind: 'changed', detail: `the unit ${unit.tail} differs from the one the file check saw` }
            }
            frames.set(unit.tail, unit.frame)
        }
    }
    for (const tail of plan.store2.tails.keys()) {
        if (!frames.has(tail)) {
            return { kind: 'changed', detail: `the unit ${tail} is no longer in the file` }
        }
    }
    return { kind: 'ok', frames }
}

/** Clears the plugin grants (MC-2252). A failure is handled here and named by the finish stage's own application of the same action. */
export async function clearPluginGrants(plan: Pick<RestorePlan, 'side'>, backends: SideBackends): Promise<void> {
    const item = plan.side.find((candidate) => candidate.action.id === PLUGIN_PERMISSIONS)
    try {
        const result = await applySideAction(item?.action ?? { kind: 'clear', id: PLUGIN_PERMISSIONS, status: 'absent' }, null, backends)
        if (result.status === 'write-failed') {
            console.error(result.message)
        }
    } catch (error) {
        console.error(error)
    }
}

interface Decided {
    end: RtbInstallEnd | null
    /** The error shown for a `stopped` end; null when the stage that stopped has already shown its own. */
    message: string | null
}

export async function installRtbRestore(plan: RtbInstallPlan, hold: RestoreHold, options: Partial<RtbInstallDeps> = {}): Promise<RtbInstallEnd> {
    const deps: RtbInstallDeps = { ...realInstallDeps(), copy: (copyPlan, copyHold) => copyRtbEntries(copyPlan, copyHold, options.copyDeps), ...options }
    let commitStarted = false
    let facts = emptyFacts()
    const decided: Decided = { end: null, message: null }
    const stop = (outcome: 'nothing-replaced' | 'failed', cause: RtbInstallCause, text: string | null): RtbInstallEnd => {
        decided.message = text
        decided.end = { kind: 'stopped', outcome, cause, facts }
        return decided.end
    }
    const keptStop = (outcome: 'nothing-replaced' | 'failed', cause: RtbInstallCause, text: string): RtbInstallEnd => stop(outcome, cause, withCopiedKept(text))
    const unconfirmed = (): RtbInstallEnd => {
        decided.message = null
        decided.end = { kind: 'unconfirmed', cause: 'unconfirmed', facts }
        return decided.end
    }
    const fallback = (): RtbInstallEnd => commitStarted ? unconfirmed() : stop('failed', 'write-failed', language.restoreWriteFailed)
    const mapResult = (result: CommitResult): RtbInstallEnd => {
        switch (result.status) {
            case 'committed':
                decided.message = null
                decided.end = { kind: 'landed', flushed: result.flushed, facts: deps.facts(facts) }
                return decided.end
            case 'conflict':
            case 'unknown':
                return unconfirmed()
            case 'failed':
                console.error(result.cause)
                return result.cause instanceof Store2StalePageError
                    ? keptStop('failed', 'stale-page', language.restoreNotHappenedNotice)
                    : keptStop('failed', 'write-failed', language.internalBackupWriteFailed)
            case 'abandoned':
                console.error(result.cause ?? result.reason)
                return keptStop('failed', 'abandoned', language.store2ImportAbandoned)
            case 'refused':
                if (result.reason === 'marker-present') {
                    return keptStop('nothing-replaced', 'marker-standing', language.store2RestoreBulkMarker)
                }
                return result.reason === 'too-new'
                    ? keptStop('nothing-replaced', 'too-new', language.store2ImportTooNew)
                    : keptStop('nothing-replaced', 'library-refused', language.store2ImportRefused)
        }
    }
    try {
        const copied = await deps.copy(plan, hold)
        facts = copied.facts
        if (copied.kind === 'stopped') {
            // CopyEnd carries no text, so a stop whose own alert failed falls back to the generic write-failed text.
            return stop(copied.outcome, copied.cause, copied.shown ? null : language.restoreWriteFailed)
        }

        // I0: the units are read again and must be the ones the file check saw.
        const units = await rereadUnits(plan)
        if (units.kind === 'changed') {
            console.error(units.detail)
            return stop('nothing-replaced', 'could-not-read', language.backupFileChangedWhileReading)
        }

        // I1: the authoritative read of the commit key and the manifest it names.
        let read: Store2Read
        try {
            read = await plan.target.committer.readCommit()
        } catch (error) {
            console.error(error)
            return keptStop('nothing-replaced', 'commit-read-failed', language.store2ImportReadFailed)
        }
        const authoritative = checkAuthoritativeBase(plan.base, read)
        if (authoritative.kind === 'base-unreadable') {
            return keptStop('nothing-replaced', 'base-unreadable', language.store2ImportRefused)
        }
        if (authoritative.kind === 'base-moved') {
            return keptStop('nothing-replaced', 'base-moved', language.restoreNotHappenedNotice)
        }
        const base = await deps.baseManifest(plan.target.backend, read)
        if (base.status === 'failed') {
            console.error(base.cause)
            return keptStop('nothing-replaced', 'read-failed', language.store2ImportReadFailed)
        }
        if (base.status !== 'ok') {
            return keptStop('nothing-replaced', 'base-unreadable', language.store2ImportRefused)
        }

        // I2: edits marked since the guard of the preparation are asked about again.
        if (!await hold.guard.check()) {
            return stop('nothing-replaced', 'declined', language.rtbRestoreCopiedKept)
        }

        // I3: the plan. The page's theme packs and task presets are not kept: the file's are the profile.
        let request: RestoreRequest
        try {
            request = deps.planRestore({
                frames: units.frames,
                root: plan.store2.root,
                omitted: omittedTailsOf(plan.manifest.omitted),
                target: { legacyKeep: base.manifest.fixed.legacyKeep, req: base.manifest.req },
            })
        } catch (error) {
            if (error instanceof RtbRestoreError) {
                console.error(error)
                return keptStop('nothing-replaced', 'damaged', language.rtbRestoreDamaged)
            }
            throw error
        }
        await clearPluginGrants(plan, deps.sideBackends)

        // I4: the commit.
        deps.wait(language.rtbRestoreInstalling)
        const guarded: Committer = rtbGuardedCommitter(plan.target.committer, hold.busy)
        commitStarted = true
        let result: CommitResult
        try {
            result = await guarded.commit(read, { newUnits: request.newUnits, build: request.build, label: 'import', force: true, carry: IMPORT_REPLACES_BASE })
        } catch (error) {
            console.error(error)
            if (isRtbBusyAbort(error)) {
                return keptStop('nothing-replaced', 'busy', language.backupLoadWorkInProgress)
            }
            return unconfirmed()
        }
        return mapResult(result)
    } catch (error) {
        // A throw that escaped every decided outcome: after the commit was called the write may have landed, so it is unconfirmed.
        console.error(error)
        return decided.end ?? fallback()
    } finally {
        const end = decided.end ?? fallback()
        try {
            if (end.kind === 'stopped') {
                await hold.release(false)
            } else if (end.kind === 'unconfirmed') {
                await hold.release(true)
            }
        } catch (error) {
            console.error(error)
        }
        try {
            if (end.kind === 'unconfirmed') {
                deps.wait(language.store2ImportUnconfirmed)
            } else if (end.kind === 'stopped' && decided.message !== null) {
                deps.error(decided.message)
            }
        } catch (error) {
            console.error(error)
        }
    }
}
