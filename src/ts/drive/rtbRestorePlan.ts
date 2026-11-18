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
import { checkStore2Import, confirmImportScale, type Store2ImportCheck, type Store2ImportRefusal, type Store2ImportTarget } from './storeImport'
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
 * uncreatable names). Every exit that is not `ready` releases the hold in one `finally`, a throw included.
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
    | 'not-an-rtb' | 'encrypted' | 'damaged' | 'newer' | 'could-not-read' | 'unexpected'

export type RtbPrepareEnd =
    | { kind: 'ready', plan: RestorePlan, hold: RestoreHold }
    | { kind: 'ended', outcome: 'canceled' | 'nothing-replaced' | 'failed', cause: RtbPrepareCause | null }

/** The calls `prepareRtbRestore` makes outside the file; tests replace them to observe order and to keep the page out of it. */
export interface RtbPrepareDeps {
    refuseOnReadOnlyPage(): Promise<boolean>
    refuseWhileBusy(own: BusyHandle): boolean
    pageKind(): PageStorageMode['kind']
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

const ended = (outcome: 'canceled' | 'nothing-replaced' | 'failed', cause: RtbPrepareCause | null): RtbPrepareEnd => ({ kind: 'ended', outcome, cause })

function noticeOf(verified: { notice: RtbNotice, manifest: RtbManifest, store2: Store2Plan }): RestoreNoticeItems {
    return {
        unknownOptionalRows: verified.notice.unknownOptionalRows,
        outsideEntryCount: verified.notice.outsideEntryCount,
        omittedUnits: verified.store2.omitted.map((unit) => unit.tail),
        omittedEntries: verified.manifest.omitted.filter((entry) => entry.kind !== 'unit'),
        unreadableLists: verified.store2.unreadableLists.length,
    }
}

export async function prepareRtbRestore(picked: PickedRtb, busy: BusyHandle, options: RtbPrepareOptions = {}): Promise<RtbPrepareEnd> {
    const deps: RtbPrepareDeps = { ...realDeps(), ...options.deps }
    let hold: RestoreHold | null = null
    let ready = false
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
        const base = based.base

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
        if (base.at > backupAt) {
            const exportedAt = origin.unsavedExcluded && verified.manifest.createdAt !== backupAt ? verified.manifest.createdAt : null
            const deviceLabel = cut(origin.device.label, DEVICE_LABEL_CHARS)
            const question = language.rtbRestoreTargetNewerConfirm(
                new Date(base.at).toLocaleString(),
                new Date(backupAt).toLocaleString(),
                exportedAt === null ? null : new Date(exportedAt).toLocaleString(),
                deviceLabel,
            )
            if (!await deps.confirm(question)) {
                return ended('canceled', 'declined')
            }
            newer = { targetAt: base.at, backupAt, exportedAt, deviceLabel }
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

        const plan: RestorePlan = {
            kind: 'rtb-page',
            file: { name: picked.name, size: picked.size, lastModified: picked.lastModified },
            source,
            index: verified.index,
            manifest: verified.manifest,
            rows: verified.rows,
            target,
            base,
            store2: verified.store2,
            assets,
            inlays,
            side: verified.side,
            newer,
            notice: noticeOf(verified),
        }
        ready = true
        return { kind: 'ready', plan, hold }
    } catch (error) {
        console.error(error)
        deps.error(language.store2ImportReadFailed)
        return ended('failed', 'unexpected')
    } finally {
        if (!ready && hold !== null) {
            try {
                await hold.release(false)
            } catch (error) {
                console.error(error)
            }
        }
    }
}
