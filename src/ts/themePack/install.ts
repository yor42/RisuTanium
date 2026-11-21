// The install transaction of a theme pack (layout A: the verified archive is stored whole as one asset file, and one record
// under `Database.themePacks` names it). Data side only: every question to the person arrives as an injected callback and
// every outcome is a typed value, so this module shows no notice of its own.
//
// Write order (INV-6): the archive is written, read back and hash-checked, then the optional icon the same way, then the
// record is added, then the active id is set, all under one busy entry; a save is asked for after the entry ends. A
// failure at any step writes no record, and an archive or icon left behind is reclaimed by a later asset sweep. Neither
// Remove nor Replace deletes a file.
import { v4 } from 'uuid'
import { sha256Hex } from '../assetHash'
import { restoreInProgress } from '../drive/restoreInProgress'
import { requestSaveNow, saveAsset } from '../globalApi.svelte'
import { isBusy, withBusy } from '../process/memory/busyActions'
import { getPageStorageMode } from '../storage/pageStorageMode'
import { getAppStore } from '../storage/store/appStore'
import { DBState } from '../stores.svelte'
import { PACK_ARCHIVE_KEY, PACK_ICON_KEY } from './packRefs'
import { listThemePacks, type PackManifestFields, type ThemePackRecordV1 } from './packRecord'

/** The tile colours of a verified pack (lower-case `#rrggbb`), each present only when known. */
export interface PackTileColours {
    main?: string
    secondary?: string
}

/** The icon a verified pack names: exactly the bytes the check judged, and the extension their sniffed type gives. The install stores these bytes and never reads the archive again for them. */
export interface PackVerifyIcon {
    bytes: Uint8Array
    ext: 'png' | 'webp'
}

export type PackVerifyOutcome<R> = { ok: true, manifest: PackManifestFields, tile?: PackTileColours, icon?: PackVerifyIcon } | { ok: false, refusal: R }

export interface InstallRequest<R> {
    bytes: Uint8Array
    /** Runs the full intake over exactly these bytes. Called once; install stores the same `Uint8Array` it was given. A rejected promise propagates and nothing is written. */
    verify: (bytes: Uint8Array) => Promise<PackVerifyOutcome<R>>
    /** Asked only when a readable record has the same `packId`, or (neither has one) the same name. */
    confirmReplace: (existing: ThemePackRecordV1) => Promise<boolean>
    now?: () => number
    newId?: () => string
    /**
     * Called synchronously after the list write and just before the active id is set, so a caller registers its request
     * before the write that queues the driver. `replacedId` is the record this install replaced, or null. A throw is ignored.
     */
    onActivate?: (next: { id: string; replacedId: string | null }) => void
}

export type InstallOutcome<R> =
    | { ok: true, record: ThemePackRecordV1, replaced: boolean }
    | { ok: false, kind: 'busy' | 'restoring' | 'declinedReplace' | 'filesDamaged' | 'listUnreadable' }
    | { ok: false, kind: 'readOnly' }
    | { ok: false, kind: 'refused', refusal: R }
    | { ok: false, kind: 'writeFailed', error: unknown }

/** The name the archive is saved under: the store derives the key `assets/tp-<sha256>.risutheme` from it and the content id. */
const ARCHIVE_FILE_NAME = 'x.risutheme'

function isRecordObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether another action or a restore is running now. A restore may start during a dialog, so this is asked again before the write. */
function refusalWhileOtherWork(): 'busy' | 'restoring' | null {
    // An export waiting on an Android save dialog (marked) does not refuse an install; the second ask, before the write, counts it again.
    if (isBusy({ ignoreDialogWaits: true })) {
        return 'busy'
    }
    if (restoreInProgress()) {
        return 'restoring'
    }
    return null
}

/** Whether the page cannot write, by the same predicate the page's other whole-class writers use, without their alert. */
function pageIsReadOnly(): boolean {
    return getPageStorageMode().kind === 'read-only'
}

/**
 * The record a new pack replaces: the first readable record with the same `packId` when the manifest has one, else, when
 * neither the manifest nor the record has a `packId`, the first with the same name. A record with a `packId` never matches
 * a manifest without one by name, and the reverse; two different `packId`s never match, whatever their names.
 */
function findReplaceTarget(manifest: PackManifestFields): ThemePackRecordV1 | null {
    for (const { read } of listThemePacks(DBState.db.themePacks)) {
        if (!read.ok) {
            continue
        }
        const record = read.record
        if (manifest.packId !== undefined ? record.packId === manifest.packId : record.packId === undefined && record.name === manifest.name) {
            return record
        }
    }
    return null
}

/** The write phase, run under the busy entry: archive, read-back check, optional icon and its read-back check, record, active id. */
async function writePack<R>(request: InstallRequest<R>, manifest: PackManifestFields, tile: PackTileColours | undefined, icon: PackVerifyIcon | undefined, existing: ThemePackRecordV1 | null): Promise<InstallOutcome<R>> {
    const bytes = request.bytes
    let hash: string
    let key: string
    try {
        hash = await sha256Hex(bytes)
        key = await saveAsset(bytes, 'tp-' + hash, ARCHIVE_FILE_NAME)
    } catch (error) {
        return { ok: false, kind: 'writeFailed', error }
    }
    if (!PACK_ARCHIVE_KEY.test(key)) {
        return { ok: false, kind: 'writeFailed', error: new Error(`The store named the archive ${key}.`) }
    }
    // The file must read back as the bytes that were verified: a store that answers success for damaged or absent data
    // (or a file left from an earlier damaged write) never gets a record.
    try {
        const stored = (await (await getAppStore()).read(key)).bytes
        if (stored === null || await sha256Hex(stored) !== hash) {
            return { ok: false, kind: 'filesDamaged' }
        }
    } catch (error) {
        return { ok: false, kind: 'writeFailed', error }
    }
    // The icon is written after the archive and before the record, so a failure at any step leaves no record. It is always
    // stored as bytes (its size cap is far below the size at which the store splits an asset), so a read-back returns the bytes.
    let iconKey: string | undefined
    if (icon !== undefined) {
        let iconHash: string
        try {
            iconHash = await sha256Hex(icon.bytes)
            iconKey = await saveAsset(icon.bytes, 'tp-' + iconHash, 'x.' + icon.ext)
        } catch (error) {
            return { ok: false, kind: 'writeFailed', error }
        }
        if (!PACK_ICON_KEY.test(iconKey)) {
            return { ok: false, kind: 'writeFailed', error: new Error(`The store named the icon ${iconKey}.`) }
        }
        try {
            const storedIcon = (await (await getAppStore()).read(iconKey)).bytes
            if (storedIcon === null || await sha256Hex(storedIcon) !== iconHash) {
                return { ok: false, kind: 'filesDamaged' }
            }
        } catch (error) {
            return { ok: false, kind: 'writeFailed', error }
        }
    }
    const record: ThemePackRecordV1 = {
        v: 1,
        id: (request.newId ?? v4)(),
        name: manifest.name,
        version: manifest.version,
        license: manifest.license,
        attribution: manifest.attribution,
        modes: [...manifest.modes],
        fonts: manifest.fonts.map((font) => typeof font.attribution === 'string'
            ? { file: font.file, license: font.license, attribution: font.attribution }
            : { file: font.file, license: font.license }),
        archive: key,
        bytes: bytes.length,
        installedAt: (request.now ?? Date.now)(),
    }
    // Never an own `undefined` key: the optional id is set only when the manifest has one.
    if (typeof manifest.packId === 'string') {
        record.packId = manifest.packId
    }
    if (typeof tile?.main === 'string') {
        record.mainColor = tile.main
    }
    if (typeof tile?.secondary === 'string') {
        record.secondaryColor = tile.secondary
    }
    if (iconKey !== undefined) {
        record.icon = iconKey
    }
    const live = DBState.db.themePacks
    let replaced = false
    let replacedId: string | null = null
    if (live === undefined) {
        DBState.db.themePacks = [record]
    } else if (!Array.isArray(live)) {
        return { ok: false, kind: 'listUnreadable' }
    } else {
        // The target is found again by its id: the list may have changed while the dialog or the write was running.
        const at = existing === null ? -1 : listThemePacks(live).findIndex((item) => item.read.ok && item.read.record.id === existing.id)
        if (at >= 0) {
            live[at] = record
            replaced = true
            replacedId = existing === null ? null : existing.id
        } else {
            live.push(record)
        }
    }
    try {
        request.onActivate?.({ id: record.id, replacedId })
    } catch { }
    DBState.db.activeThemePack = record.id
    return { ok: true, record, replaced }
}

export async function installThemePack<R>(request: InstallRequest<R>): Promise<InstallOutcome<R>> {
    const early = refusalWhileOtherWork()
    if (early !== null) {
        return { ok: false, kind: early }
    }
    // Before the intake runs, so a question it asks is never put on a page that will refuse. The mode is fixed for the page's session.
    if (pageIsReadOnly()) {
        return { ok: false, kind: 'readOnly' }
    }
    const stored = DBState.db.themePacks
    if (stored !== undefined && !Array.isArray(stored)) {
        return { ok: false, kind: 'listUnreadable' }
    }
    const verdict = await request.verify(request.bytes)
    if (verdict.ok === false) {
        return { ok: false, kind: 'refused', refusal: verdict.refusal }
    }
    const existing = findReplaceTarget(verdict.manifest)
    if (existing !== null && !await request.confirmReplace(existing)) {
        return { ok: false, kind: 'declinedReplace' }
    }
    // The check and the busy entry are one synchronous step (no await between them), so a restore that checks for busy work
    // can never start beside the write phase.
    const again = refusalWhileOtherWork()
    if (again !== null) {
        return { ok: false, kind: again }
    }
    const outcome = await withBusy('themePack', () => writePack(request, verdict.manifest, verdict.tile, verdict.icon, existing))
    if (outcome.ok) {
        requestSaveNow()
    }
    return outcome
}

export type RemoveOutcome = { ok: true } | { ok: false, kind: 'changed' }

/**
 * Removes the entry at `index` if it is still `entry` (works for an unreadable entry too), and clears `activeThemePack` if
 * it names it. Never deletes a file: a sweep reclaims an archive once no entry names it. `entry` is the value read from the
 * live `DBState.db.themePacks` (as `listThemePacks(DBState.db.themePacks)` returns it), never a copy or the raw record an
 * install returned: the live list holds proxies, so a raw record is never equal to its entry and the call answers `changed`.
 */
export function removeThemePackAt(index: number, entry: unknown): RemoveOutcome {
    const list = DBState.db.themePacks
    if (!Array.isArray(list) || !Number.isInteger(index) || index < 0 || index >= list.length || list[index] !== entry) {
        return { ok: false, kind: 'changed' }
    }
    const id = isRecordObject(entry) ? entry.id : undefined
    if (typeof id === 'string' && DBState.db.activeThemePack === id) {
        delete DBState.db.activeThemePack
    }
    list.splice(index, 1)
    return { ok: true }
}

/** Sets or clears the active pack id (a record id or `builtin:<slug>`); `undefined` deletes the key, so no `undefined` value is stored. */
export function setActiveThemePack(id: string | undefined): void {
    if (id === undefined) {
        delete DBState.db.activeThemePack
    } else {
        DBState.db.activeThemePack = id
    }
}
