import { type as osType } from '@tauri-apps/plugin-os'
import { alertConfirm, alertError, alertWait } from '../alert'
import { language } from 'src/lang'
import type { BusyHandle } from '../process/memory/busyActions'
import { refuseOnReadOnlyPage } from '../storage/readOnlyPage'
import { getPageStorageMode, type PageStorageMode } from '../storage/pageStorageMode'
import { selectedStoreIsNode, storeAssetLimitBytes } from '../storage/assetLimit'
import { getAppStore, getAppStoreKind } from '../storage/store/appStore'
import type { FilePlatform } from '../storage/store/keyRules'
import { isAssetBatchReadAvailable, listAssetsSized } from '../storage/tauriAssetBatch'
import { transportKind } from '../storage/tauriByteTransport'
import { inlayAttachmentLimit } from '../process/files/inlayStore'
import type { Store2Read } from '../storage/store2/backend/types'
import { clearAbandonedMarker } from '../storage/store2/abandonedMarker'
import type { AbandonResult, Committer, HeldBulk } from '../storage/store2/commit'
import { classifyCommitRead } from '../storage/store2/commitKey'
import type { OmittedEntry as FileOmittedEntry, RtbManifest } from './rtb/manifest'
import type { RtbNotice } from './rtb/rtbClassify'
import type { SectionRow } from './rtb/sections'
import { rangeSourceFrom, type RangeSource } from './rtb/rangeSource'
import type { ZipIndex } from './rtb/zip64Reader'
import { planAssets, type AssetPlanDeps, type AssetsPlan, type CreatableRule, type InlaysPlan, type SizedListing } from './rtb/rtbAssetPlan'
import { verifyRtb, type NewerItem, type RtbVerdict, type SidePlanItem, type Store2Plan, type VerifyOptions } from './rtb/rtbVerify'
import type { ImportSource } from '../importSource'
import { nodePieceStore } from './assetPieces'
import { refuseBackupLoadWhileBusy } from './backupWorkGuard'
import { acquireRestoreHold, baseOfRead, type BaseRead, type HoldAcquire, type HoldOptions, type RestoreHold } from './rtbRestoreHold'
import { askToClearForeignMarker, checkStore2Import, confirmImportScale, type ForeignMarkerQuestion, type Store2ImportCheck, type Store2ImportRefusal, type Store2ImportTarget } from './storeImport'
import { saveFirst, SAVE_FIRST_BOUND_MS } from './storeRestore'

/**
 * The page-target front half of a `.rtb` restore (CHORE-128 S11): the refusals before anything is written,
 * the verification of the file, and the prompts. It returns a `RestorePlan` and the `RestoreHold` that S12's commit step
 * consumes. It writes nothing: the only writes before it returns are `saveFirst`'s commit, `checkStore2Import`'s clear of a
 * proven-dead foreign marker, and the web lock's storage-epoch token.
 *
 * The caller opens the restore run, takes the `backupLoad` busy entry and asks the Settings confirmations before calling
 * `prepareRtbRestore`; no busy entry and no lock is held across the picker.
 *
 * Order (A7): read-only page, busy, store2 mode, `checkStore2Import`, `saveFirst`, the lock, the unsaved-edits guard, the
 * classifying read of the commit key, the file's verification, then the prompts (newer data, scale, Node oversize,
 * uncreatable names; the newer-data question is skipped for the Welcome restore).
 * Every exit that is not `ready` releases the hold in one `finally`, a throw included.
 *
 * File-supplied text (the device label, asset and inlay names, row ids, `req` tokens, `refs` rows) only ever goes to
 * `alertConfirm` and `alertError`, which render it as text; it never goes to a markdown alert.
 */

export interface PickedRtb {
    name: string | null
    size: number
    lastModified: number | null
    source: ImportSource
}

export type { BaseRead, RestoreHold }
export type { AssetsPlan, InlaysPlan, NewerItem, SidePlanItem, Store2Plan }

export interface NewerCheck {
    targetAt: number
    backupAt: number
    exportedAt: number | null
    deviceLabel: string
}

export interface RestoreNoticeItems {
    unknownOptionalRows: readonly { id: string, v: number }[]
    outsideEntryCount: number
    omittedUnits: readonly string[]
    /** The file's omitted entries that are not units. */
    omittedEntries: readonly FileOmittedEntry[]
    unreadableLists: number
}

export interface RestorePlan {
    kind: 'rtb-page'
    file: { name: string | null, size: number, lastModified: number | null }
    source: RangeSource
    index: ZipIndex
    manifest: RtbManifest
    rows: readonly SectionRow[]
    target: Store2ImportTarget
    base: BaseRead
    /** The bulk marker a Node restore holds from before the asset listing until its final write; null elsewhere. */
    held?: HeldBulk | null
    store2: Store2Plan
    assets: AssetsPlan
    inlays: InlaysPlan
    /** One item per side section, in `SIDE_SECTION_IDS` order. */
    side: readonly SidePlanItem[]
    /** Set when the newer-data warning was shown and accepted. */
    newer: NewerCheck | null
    notice: RestoreNoticeItems
}

export type RtbPrepareCause =
    | 'busy' | 'read-only' | 'not-store2' | 'other-tab' | 'declined' | Store2ImportRefusal
    | 'not-an-rtb' | 'encrypted' | 'damaged' | 'newer' | 'could-not-read' | 'unexpected' | 'base-moved'

export type RtbPrepareEnd =
    | { kind: 'ready', plan: RestorePlan, hold: RestoreHold }
    | { kind: 'ended', outcome: 'canceled' | 'nothing-replaced' | 'failed', cause: RtbPrepareCause | null }

/** The calls `prepareRtbRestore` makes outside the file; tests replace them to observe order and to keep the page out of it. */
export interface RtbPrepareDeps {
    refuseOnReadOnlyPage(): Promise<boolean>
    refuseWhileBusy(own: BusyHandle): boolean
    pageKind(): PageStorageMode['kind']
    /** Whether the restore holds its own bulk marker through the asset listing and the copy (a Node page). */
    heldMarker(): boolean
    /** The Wait or Clear question about another operation's marker found while the restore opens its own. */
    askForeignMarker: ForeignMarkerQuestion
    checkImport(): Promise<Store2ImportCheck>
    saveFirst(boundMs: number): Promise<void>
    acquireHold(busy: BusyHandle, options: HoldOptions): Promise<HoldAcquire>
    verify(source: RangeSource, options: VerifyOptions): Promise<RtbVerdict>
    assetDeps(): AssetPlanDeps
    confirmScale(fileSize: number, entries: number, databaseBytes: number, unitBytes: number): Promise<boolean>
    confirm(text: string): Promise<boolean>
    error(text: string): void
    wait(text: string): void
}

export interface RtbPrepareOptions {
    /** Test seam: how long `saveFirst` may wait. */
    saveBoundMs?: number
    /** Test seam: the cap on the side sections the verification reads through. */
    sideCheckCapBytes?: number
    /** Called once when the lock is granted. */
    onHoldGranted?: () => void
    /**
     * The Welcome restore: the newer-data question is not asked (maintainer decision); every other refusal and prompt is
     * unchanged. A stale Welcome tab whose sibling tab already saved newer data is not told either, the same as the
     * Welcome `.bin` restore.
     */
    firstRun?: boolean
    deps?: Partial<RtbPrepareDeps>
}

// ---- file text for the prompts ----

const SHOWN_NAMES = 20
const SHOWN_NAME_CHARS = 100
const DEVICE_LABEL_CHARS = 64
const NEWER_TEXT_CHARS = 200

function shownNames(names: readonly string[]): string[] {
    return names.slice(0, SHOWN_NAMES).map((name) => name.length > SHOWN_NAME_CHARS ? `${name.slice(0, SHOWN_NAME_CHARS)}...` : name)
}

function cut(text: string, chars: number): string {
    return text.length > chars ? `${text.slice(0, chars)}...` : text
}

/** What made the file newer, in words the refusal can name. */
export function describeNewer(item: NewerItem): string {
    switch (item.why) {
        case 'rtb':
            return `file format ${item.rtb}`
        case 'required-row':
            return `the section "${item.id}" at version ${item.v}`
        case 'refs':
            return `the reference rows ${item.refs.join(', ')}`
        case 'req':
            return `the required feature ${item.tokens.join(', ')}`
        case 'unit':
            return 'a kind of saved data this version does not know'
    }
}

// ---- the real calls ----

function filePlatform(): FilePlatform {
    if (transportKind() === 'android') {
        return 'posix'
    }
    try {
        return osType() === 'windows' ? 'windows' : 'posix'
    } catch {
        return typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent) ? 'windows' : 'posix'
    }
}

/** The page's asset-store calls as the plan reads them; exported so the listing gates can be tested against a stubbed store. */
export function realAssetDeps(): AssetPlanDeps {
    return {
        isNodeStore: selectedStoreIsNode,
        probePieceStore: async () => {
            await nodePieceStore()
        },
        assetLimit: storeAssetLimitBytes,
        inlayLimit: () => inlayAttachmentLimit(),
        rule: async (): Promise<CreatableRule> => ({ kind: await getAppStoreKind(), platform: filePlatform() }),
        sizedListing: async (): Promise<SizedListing | null> => {
            if (isAssetBatchReadAvailable() && await getAppStoreKind() === 'tauri') {
                return { kind: 'tauri-sized', items: await listAssetsSized() }
            }
            if (selectedStoreIsNode()) {
                const listed = await (await getAppStore()).listSized?.('assets/', 0) ?? null
                return listed === null ? null : { kind: 'node-sized', items: listed }
            }
            return null
        },
    }
}

function realDeps(): RtbPrepareDeps {
    return {
        refuseOnReadOnlyPage,
        refuseWhileBusy: (own) => refuseBackupLoadWhileBusy(own),
        pageKind: () => getPageStorageMode().kind,
        heldMarker: selectedStoreIsNode,
        // Loaded when first asked: the peer UI's module graph is not needed by a restore that meets no foreign marker.
        askForeignMarker: async (marker) => (await import('../storage/store2/ui/peerUi')).askForeignMarkerQuestion(marker),
        checkImport: checkStore2Import,
        saveFirst,
        acquireHold: acquireRestoreHold,
        verify: verifyRtb,
        assetDeps: realAssetDeps,
        confirmScale: confirmImportScale,
        confirm: alertConfirm,
        error: alertError,
        wait: alertWait,
    }
}

// ---- the preparation ----

type RtbEnded = Extract<RtbPrepareEnd, { kind: 'ended' }>

const ended = (outcome: 'canceled' | 'nothing-replaced' | 'failed', cause: RtbPrepareCause | null): RtbEnded => ({ kind: 'ended', outcome, cause })

function noticeOf(verified: { notice: RtbNotice, manifest: RtbManifest, store2: Store2Plan }): RestoreNoticeItems {
    return {
        unknownOptionalRows: verified.notice.unknownOptionalRows,
        outsideEntryCount: verified.notice.outsideEntryCount,
        omittedUnits: verified.store2.omitted.map((unit) => unit.tail),
        omittedEntries: verified.manifest.omitted.filter((entry) => entry.kind !== 'unit'),
        unreadableLists: verified.store2.unreadableLists.length,
    }
}

/** What the verification and the prompts produced; the page plan adds its target and base, the boot plan adds nothing. */
export interface VerifiedRtb {
    file: { name: string | null, size: number, lastModified: number | null }
    source: RangeSource
    index: ZipIndex
    manifest: RtbManifest
    rows: readonly SectionRow[]
    store2: Store2Plan
    assets: AssetsPlan
    inlays: InlaysPlan
    side: readonly SidePlanItem[]
    newer: NewerCheck | null
    notice: RestoreNoticeItems
}

export type RtbVerifyDeps = Pick<RtbPrepareDeps, 'verify' | 'assetDeps' | 'confirmScale' | 'confirm' | 'error' | 'wait'>
export type RtbVerifyEnd = { kind: 'ok', verified: VerifiedRtb } | RtbEnded

/** The verification and prompt calls of the real page; the start-up restore uses the same ones. */
export function realVerifyDeps(): RtbVerifyDeps {
    return {
        verify: verifyRtb,
        assetDeps: realAssetDeps,
        confirmScale: confirmImportScale,
        confirm: alertConfirm,
        error: alertError,
        wait: alertWait,
    }
}

/**
 * V and P.1-P.5: the file's verification, then the prompts. Writes nothing. Every caller runs it under its restore hold:
 * P.2 lists the store's assets, and the copy that relies on that listing runs under the same hold. The newer-data
 * question (P.1) is asked only when `newerBase` is given: the page passes its base (null for the Welcome restore), a boot
 * has none. A throw propagates to the caller.
 *
 * Any decryption of the file belongs inside this function (in `verifyRtb` or here, carried by `VerifiedRtb.source`), never
 * in `prepareRtbRestore` or in the restore run: the start-up restore shares this middle and would otherwise need a second copy.
 */
export async function verifyAndConfirm(picked: PickedRtb, deps: RtbVerifyDeps, options: { newerBase: BaseRead | null, sideCheckCapBytes?: number, beforeAssetPlan?: () => Promise<RtbEnded | null> }): Promise<RtbVerifyEnd> {
    // V: the file.
    let lastPercent = -1
    const source = rangeSourceFrom(picked.source)
    const verdict = await deps.verify(source, {
        sideCheckCapBytes: options.sideCheckCapBytes,
        onProgress: (percent) => {
            if (percent !== lastPercent) {
                lastPercent = percent
                deps.wait(language.rtbRestoreChecking(percent))
            }
        },
    })
    switch (verdict.kind) {
        case 'could-not-read':
            console.error(verdict.message)
            deps.error(language.backupFileUnreadable)
            return ended('nothing-replaced', 'could-not-read')
        case 'not-an-rtb':
            deps.error(language.rtbRestoreNotRtb)
            return ended('nothing-replaced', 'not-an-rtb')
        case 'encrypted':
            deps.error(language.rtbRestoreEncrypted)
            return ended('nothing-replaced', 'encrypted')
        case 'damaged':
            console.error(verdict.reason)
            deps.error(language.rtbRestoreDamaged)
            return ended('nothing-replaced', 'damaged')
        case 'newer':
            console.warn(verdict.item)
            deps.error(language.rtbRestoreNewer(cut(describeNewer(verdict.item), NEWER_TEXT_CHARS)))
            return ended('nothing-replaced', 'newer')
        case 'ok':
            break
    }
    const verified = verdict.verified

    // P.1: the target was saved after the backup was made.
    const origin = verified.manifest.source
    const backupAt = origin.unsavedExcluded ? origin.committedAt : verified.manifest.createdAt
    let newer: NewerCheck | null = null
    if (options.newerBase !== null && options.newerBase.at > backupAt) {
        const targetAt = options.newerBase.at
        const exportedAt = origin.unsavedExcluded && verified.manifest.createdAt !== backupAt ? verified.manifest.createdAt : null
        const deviceLabel = cut(origin.device.label, DEVICE_LABEL_CHARS)
        const question = language.rtbRestoreTargetNewerConfirm(
            new Date(targetAt).toLocaleString(),
            new Date(backupAt).toLocaleString(),
            exportedAt === null ? null : new Date(exportedAt).toLocaleString(),
            deviceLabel,
        )
        if (!await deps.confirm(question)) {
            return ended('canceled', 'declined')
        }
        newer = { targetAt, backupAt, exportedAt, deviceLabel }
    }

    // P.1b: the caller's step between the newer-data question and the asset listing; an answer ends the run.
    if (options.beforeAssetPlan !== undefined) {
        const stopped = await options.beforeAssetPlan()
        if (stopped !== null) {
            return stopped
        }
    }

    // P.2: what is copied, skipped, oversize and uncreatable. Read-only.
    const { assets, inlays } = await planAssets(verified.index, verified.inlays, deps.assetDeps())

    // P.3: the scale of the copy.
    const copyBytes = assets.copyBytes + inlays.copyBytes
    const copyEntries = assets.copy.length + 2 * inlays.copy.length
    if (!await deps.confirmScale(copyBytes + verified.store2.bytes, copyEntries, verified.store2.bytes, 0)) {
        return ended('canceled', 'declined')
    }

    // P.4: what a Node server cannot take.
    if (assets.limit !== null && inlays.limit !== null && (assets.oversize.length > 0 || inlays.oversize.length > 0)) {
        const names = shownNames(assets.oversize.map((item) => item.key))
        const inlayNames = shownNames(inlays.oversize.map((pair) => pair.id))
        const inlayLimit = inlays.limit
        const question = inlays.oversize.length === 0
            ? language.restoreOversizedAssetsConfirm(assets.oversize.length, names, assets.limit)
            : assets.oversize.length === 0
                ? language.restoreOversizedInlaysConfirm(inlays.oversize.length, inlayNames, inlayLimit)
                : language.restoreOversizedWithInlaysConfirm(assets.oversize.length, names, inlays.oversize.length, inlayNames, inlayLimit)
        if (!await deps.confirm(question)) {
            return ended('canceled', 'declined')
        }
    }

    // P.5: names the page's store cannot create.
    if (assets.uncreatable.length > 0) {
        if (!await deps.confirm(language.rtbRestoreUncreatableConfirm(assets.uncreatable.length, shownNames(assets.uncreatable.map((item) => item.key))))) {
            return ended('canceled', 'declined')
        }
    }

    return {
        kind: 'ok',
        verified: {
            file: { name: picked.name, size: picked.size, lastModified: picked.lastModified },
            source,
            index: verified.index,
            manifest: verified.manifest,
            rows: verified.rows,
            store2: verified.store2,
            assets,
            inlays,
            side: verified.side,
            newer,
            notice: noticeOf(verified),
        },
    }
}

export async function prepareRtbRestore(picked: PickedRtb, busy: BusyHandle, options: RtbPrepareOptions = {}): Promise<RtbPrepareEnd> {
    const deps: RtbPrepareDeps = { ...realDeps(), ...options.deps }
    let hold: RestoreHold | null = null
    let ready = false
    /** The marker P.1b wrote and the committer that holds it; set by the P.1b closure, read by `finally`. */
    const standing: { held: HeldBulk | null, committer: Committer | null } = { held: null, committer: null }
    try {
        // R0.1: the refusals that need nothing held.
        if (await deps.refuseOnReadOnlyPage()) {
            return ended('nothing-replaced', 'read-only')
        }
        if (deps.refuseWhileBusy(busy)) {
            return ended('nothing-replaced', 'busy')
        }
        if (deps.pageKind() !== 'store2') {
            deps.error(language.rtbRestoreNeedsStore2)
            return ended('nothing-replaced', 'not-store2')
        }
        const checked = await deps.checkImport()
        if (checked.kind === 'refused') {
            return ended('nothing-replaced', checked.cause)
        }
        const target = checked.target

        // R0.2-R0.4: save, hold the lock, ask once about edits that could not be saved.
        await deps.saveFirst(options.saveBoundMs ?? SAVE_FIRST_BOUND_MS)
        const acquired = await deps.acquireHold(busy, { onGranted: options.onHoldGranted })
        if (acquired.kind === 'declined') {
            return ended('canceled', 'declined')
        }
        if (acquired.kind === 'refused') {
            return ended('nothing-replaced', 'other-tab')
        }
        hold = acquired.hold
        if (!await hold.guard.check()) {
            return ended('canceled', 'declined')
        }

        // R0.5: the classifying read of the commit key, taken after the lock so no save can move it.
        let read: Store2Read
        try {
            read = await target.committer.readCommit()
        } catch (error) {
            console.error(error)
            deps.error(language.store2ImportReadFailed)
            return ended('nothing-replaced', 'commit-read-failed')
        }
        const based = baseOfRead(read)
        if (based.kind === 'too-new') {
            deps.error(language.store2ImportTooNew)
            return ended('nothing-replaced', 'too-new')
        }
        if (based.kind !== 'ok') {
            deps.error(language.store2ImportRefused)
            return ended('nothing-replaced', based.kind)
        }
        let base = based.base

        // P.1b (a Node page): the restore's own bulk marker, between the newer-data question and the asset listing, so no
        // Node deleter can remove an asset the listing is about to count as present. The marker moves `seq` and nothing
        // else, so the plan's base becomes the read-back.
        const readFresh = async (): Promise<Store2Read | RtbEnded> => {
            try {
                return await target.committer.readCommit()
            } catch (error) {
                console.error(error)
                deps.error(language.store2ImportReadFailed)
                return ended('nothing-replaced', 'commit-read-failed')
            }
        }
        /** Clears the marker a failed bulk of this page load left, and answers the fresh read the retry opens over. */
        const clearOwnLeftover = async (): Promise<Store2Read | RtbEnded> => {
            const leftover = await readFresh()
            if ('kind' in leftover) {
                return leftover
            }
            const outcome = await clearAbandonedMarker(target.committer, leftover, null)
            if (outcome.marker !== null && !outcome.own) {
                // Another operation's marker: the person chooses Wait or Clear. Clear consents to exactly this marker, and the
                // read below re-checks the base before the retry. Wait ends the restore; the question replaced the refusal text.
                const answer = await askToClearForeignMarker(target.committer, leftover, outcome.marker, deps.askForeignMarker)
                if (answer === 'waited') {
                    return ended('nothing-replaced', 'foreign-marker')
                }
                if (answer === 'kept') {
                    deps.error(language.store2RestoreBulkMarker)
                    return ended('nothing-replaced', 'foreign-marker')
                }
            } else
            if (outcome.marker !== null && outcome.result?.status !== 'cleared' && outcome.result?.status !== 'nothing') {
                console.error('The leftover bulk marker of this page was not cleared.', outcome.result)
            }
            const after = await readFresh()
            if ('kind' in after) {
                return after
            }
            // The page's own earlier bulk is the only thing the clear may have moved: any other change to `current` is a peer's.
            const classified = classifyCommitRead(after)
            if (classified.status !== 'parsed' || classified.value.staging !== null || classified.value.current?.key !== base.currentKey) {
                deps.error(language.restoreNotHappenedNotice)
                return ended('nothing-replaced', 'base-moved')
            }
            return after
        }
        const holdMarker = async (): Promise<RtbEnded | null> => {
            const committer = target.committer
            if (committer.openHeldBulk === undefined || committer.clearHeld === undefined) {
                deps.error(language.store2ImportRefused)
                return ended('nothing-replaced', 'library-refused')
            }
            let from = read
            for (let attempt = 0; attempt < 2; attempt++) {
                const opened = await committer.openHeldBulk(from, { label: 'restore' })
                switch (opened.status) {
                    case 'opened': {
                        standing.held = opened.held
                        standing.committer = committer
                        const advanced = baseOfRead(opened.read)
                        if (advanced.kind !== 'ok') {
                            deps.error(language.store2ImportRefused)
                            return ended('nothing-replaced', advanced.kind)
                        }
                        base = advanced.base
                        return null
                    }
                    case 'conflict':
                        // The call has cleared its own marker; a clear that did not complete leaves it standing.
                        logUncleared(opened.cleared)
                        deps.error(language.restoreNotHappenedNotice)
                        return ended('nothing-replaced', 'base-moved')
                    case 'failed':
                    case 'unknown':
                        logUncleared(opened.cleared)
                        console.error(opened.cause)
                        deps.error(language.store2ImportReadFailed)
                        return ended('failed', 'commit-read-failed')
                    case 'refused': {
                        if (opened.reason !== 'marker-present') {
                            deps.error(language.store2ImportRefused)
                            return ended('nothing-replaced', 'library-refused')
                        }
                        if (attempt === 1) {
                            deps.error(language.store2RestoreBulkMarker)
                            return ended('nothing-replaced', 'marker-standing')
                        }
                        const next = await clearOwnLeftover()
                        if ('kind' in next) {
                            return next
                        }
                        from = next
                        break
                    }
                }
            }
            return ended('nothing-replaced', 'marker-standing')
        }

        // V and P.1-P.5: the file and the prompts, shared with the start-up restore.
        const verifiedEnd = await verifyAndConfirm(picked, deps, {
            newerBase: options.firstRun === true ? null : base,
            sideCheckCapBytes: options.sideCheckCapBytes,
            beforeAssetPlan: deps.heldMarker() ? holdMarker : undefined,
        })
        if (verifiedEnd.kind === 'ended') {
            return verifiedEnd
        }
        const plan: RestorePlan = { kind: 'rtb-page', ...verifiedEnd.verified, target, base, held: standing.held }
        ready = true
        return { kind: 'ready', plan, hold }
    } catch (error) {
        console.error(error)
        deps.error(language.store2ImportReadFailed)
        return ended('failed', 'unexpected')
    } finally {
        if (!ready) {
            // The marker is cleared while the locks are still held, and a clear that throws never keeps the release from running.
            if (standing.held !== null && standing.committer !== null && standing.committer.clearHeld !== undefined) {
                try {
                    logUncleared(await standing.committer.clearHeld(standing.held))
                } catch (error) {
                    console.error(error)
                }
            }
            if (hold !== null) {
                try {
                    await hold.release(false)
                } catch (error) {
                    console.error(error)
                }
            }
        }
    }
}

/** What a marker clear came to: anything but `cleared` or `nothing` means the marker may still stand. */
function logUncleared(result: AbandonResult | null): void {
    if (result === null || (result.status !== 'cleared' && result.status !== 'nothing')) {
        console.error('The restore marker may still stand.', result)
    }
}
