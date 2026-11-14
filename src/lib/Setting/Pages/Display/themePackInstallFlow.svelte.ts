// The install, remove and select flow behind the Settings "Theme pack" row. It owns the in-flight latch and the outcome the
// row shows, so a row that is closed and reopened mid-install reads the same state. Every call to a dialog, the file chooser,
// the file reader or the install transaction is resolved when the function runs (never at module load), so a narrow test
// mock throws inside a handler, never on import.
import { language } from 'src/lang'
import { alertConfirm, alertNormal } from 'src/ts/alert'
import { restoreInProgress } from 'src/ts/drive/restoreInProgress'
import { requestSaveNow } from 'src/ts/globalApi.svelte'
import { isBusy } from 'src/ts/process/memory/busyActions'
import { DBState } from 'src/ts/stores.svelte'
import { installThemePack, removeThemePackAt, setActiveThemePack, type InstallOutcome } from 'src/ts/themePack/install'
import { intakePackBytes, type IntakeRefusal, type IntakeResult } from 'src/ts/themePack/intake'
import { createJudgeClient } from 'src/ts/themePack/judgeClient'
import { listThemePacks } from 'src/ts/themePack/packRecord'
import { PACK_FILE_MAX_BYTES, PACK_MAX_UNPACKED_BYTES } from 'src/ts/themePack/zipTail'
import { readPickedFileBytes, selectSingleFileObject } from 'src/ts/util'

/** What the row shows under the Install button. */
export interface RowMessage {
    tone: 'info' | 'error'
    lines: string[]
}

/** The refusal the install transaction hands back: an intake refusal list, or the person declining the large-pack question. */
export type InstallRefusal =
    | { kind: 'intake', refusals: readonly IntakeRefusal[] }
    | { kind: 'declinedLarge' }

export interface InstallFlowDeps {
    pickFile: () => Promise<File | null>
    readFile: (file: File) => Promise<Uint8Array>
    intake: (bytes: Uint8Array) => Promise<IntakeResult>
    install: typeof installThemePack
    confirm: (message: string) => Promise<boolean>
    notify: (message: string) => void
    isBusy: () => boolean
    restoreInProgress: () => boolean
}

export type RemoveResult = 'removed' | 'declined' | 'changed' | 'busy'
export type SelectResult = 'selected' | 'busy'

/** Module-level so a remounted row reads the same latch and outcome. */
export const installFlowState = $state({ pending: false, outcome: null as RowMessage | null })

let attachedRows = 0

function resolveDeps(deps: Partial<InstallFlowDeps> | undefined): InstallFlowDeps {
    return {
        pickFile: deps?.pickFile ?? (() => selectSingleFileObject(['risutheme'])),
        readFile: deps?.readFile ?? ((file) => readPickedFileBytes(file)),
        intake: deps?.intake ?? ((bytes) => intakePackBytes(bytes, createJudgeClient())),
        install: deps?.install ?? ((request) => installThemePack(request)),
        confirm: deps?.confirm ?? ((message) => alertConfirm(message)),
        notify: deps?.notify ?? ((message) => alertNormal(message)),
        isBusy: deps?.isBusy ?? (() => isBusy()),
        restoreInProgress: deps?.restoreInProgress ?? (() => restoreInProgress()),
    }
}

/** A row calls this while it is mounted. The returned function detaches it; the last detach clears a settled outcome. */
export function attachRow(): () => void {
    attachedRows += 1
    let attached = true
    return () => {
        if (!attached) {
            return
        }
        attached = false
        attachedRows -= 1
        if (attachedRows === 0 && !installFlowState.pending) {
            installFlowState.outcome = null
        }
    }
}

/** Test seam: the latch, the outcome and the attach count return to their initial values. */
export function resetThemePackInstallFlowForTests(): void {
    installFlowState.pending = false
    installFlowState.outcome = null
    attachedRows = 0
}

const MIB = 1024 * 1024

/** The size shown to the person: KiB below 1 MiB, MiB from there on, one decimal. Units are not localised. */
export function formatPackSize(bytes: number): string {
    if (bytes < MIB) {
        return `${(bytes / 1024).toFixed(1)} KiB`
    }
    return `${(bytes / MIB).toFixed(1)} MiB`
}

type RefusalTexts = { [C in IntakeRefusal['code']]: (refusal: IntakeRefusal & { code: C }) => string }

const REFUSAL_TEXTS: RefusalTexts = {
    notAPack: () => language.themePackRefuseNotAPack,
    notThisKind: () => language.themePackRefuseNotThisKind,
    damaged: () => language.themePackRefuseDamaged,
    unsafeName: (refusal) => language.themePackRefuseUnsafeName(refusal.name),
    duplicateName: (refusal) => language.themePackRefuseDuplicateName(refusal.name),
    encrypted: () => language.themePackRefuseEncrypted,
    compression: (refusal) => language.themePackRefuseCompression(refusal.name),
    tooManyFiles: (refusal) => language.themePackRefuseTooManyFiles(refusal.limit),
    zip64: () => language.themePackRefuseZip64,
    fileTooLarge: (refusal) => language.themePackRefuseFileTooLarge(refusal.name, formatPackSize(refusal.limitBytes)),
    packTooLarge: (refusal) => language.themePackRefusePackTooLarge(formatPackSize(refusal.limitBytes)),
    manifestMissing: () => language.themePackRefuseManifestMissing,
    manifestUnreadable: () => language.themePackRefuseManifestUnreadable,
    manifestField: (refusal) => language.themePackRefuseManifestField(refusal.field),
    newerFormat: () => language.themePackRefuseNewerFormat,
    unknownFile: (refusal) => language.themePackRefuseUnknownFile(refusal.name),
    svg: (refusal) => language.themePackRefuseSvg(refusal.name),
    wrongContent: (refusal) => language.themePackRefuseWrongContent(refusal.name),
    notUtf8: (refusal) => language.themePackRefuseNotUtf8(refusal.name),
    target: (refusal) => language.themePackRefuseTarget(refusal.sheet, refusal.target),
    wrongKind: (refusal) => language.themePackRefuseWrongKind(refusal.sheet, refusal.target),
    fontLicense: (refusal) => language.themePackRefuseFontLicense(refusal.file),
    licenseWithoutFont: (refusal) => language.themePackRefuseLicenseWithoutFont(refusal.file),
    noArea: () => language.themePackRefuseNoArea,
    couldNotCheck: () => language.themePackCouldNotCheck,
    sheetRefused: (refusal) => [
        language.themePackSheetRefused(refusal.sheet),
        ...refusal.errors.map((error) => language.themePackLintLine(error.selector, error.prop, error.why)),
    ].join('\n'),
}

/** One refusal as text. A style refusal spans several lines, joined by newlines. */
export function refusalText(refusal: IntakeRefusal): string {
    const text = REFUSAL_TEXTS[refusal.code] as (refusal: IntakeRefusal) => string
    return text(refusal)
}

function errorMessage(...lines: string[]): RowMessage {
    return { tone: 'error', lines }
}

function mapOutcome(outcome: InstallOutcome<InstallRefusal>, skippedAreas: readonly string[]): RowMessage | null {
    if (outcome.ok === true) {
        const lines = [language.themePackInstalled(outcome.record.name)]
        if (skippedAreas.length > 0) {
            lines.push(language.themePackSkippedAreas(skippedAreas.map((area) => `${area}.css`).join(', ')))
        }
        return { tone: 'info', lines }
    }
    switch (outcome.kind) {
        case 'busy':
        case 'restoring':
            return errorMessage(language.themePackBusy)
        case 'declinedReplace':
            return null
        case 'filesDamaged':
            return errorMessage(language.themePackInstallFailedFiles)
        case 'listUnreadable':
            return errorMessage(language.themePackListUnreadable)
        case 'readOnly':
            return errorMessage(outcome.cause === 'opfs' ? language.opfsReadOnlyNotice : language.store2Boot.readOnlyRefusal)
        case 'refused':
            return outcome.refusal.kind === 'declinedLarge'
                ? null
                : errorMessage(language.themePackRefusedHeader, ...outcome.refusal.refusals.map(refusalText))
        case 'writeFailed':
            return errorMessage(language.themePackWriteFailed)
    }
}

/**
 * Shows a message on the row. With no row attached an error is alerted instead and not kept, so it is never lost; a success
 * is kept and shown once by the next row.
 */
function publish(message: RowMessage | null, notify: (text: string) => void): void {
    if (message === null) {
        installFlowState.outcome = null
        return
    }
    if (attachedRows === 0 && message.tone === 'error') {
        installFlowState.outcome = null
        notify(message.lines.join('\n'))
        return
    }
    installFlowState.outcome = message
}

/**
 * Picks a file, checks it and installs it. At most one run holds the latch; the latch is taken only after a file exists, so
 * a chooser that never answers cannot wedge it. Every question to the person comes before the first write.
 */
export async function runThemePackInstall(deps?: Partial<InstallFlowDeps>): Promise<void> {
    const d = resolveDeps(deps)
    const file = await d.pickFile()
    if (file === null) {
        return
    }
    if (installFlowState.pending) {
        publish(errorMessage(language.themePackBusy), d.notify)
        return
    }
    // The file is never read above the size cap: the same refusal intake gives for the same size.
    if (file.size > PACK_FILE_MAX_BYTES) {
        publish(mapOutcome({
            ok: false,
            kind: 'refused',
            refusal: { kind: 'intake', refusals: [{ code: 'packTooLarge', limitBytes: PACK_MAX_UNPACKED_BYTES }] },
        }, []), d.notify)
        return
    }
    installFlowState.pending = true
    installFlowState.outcome = null
    try {
        const bytes = await d.readFile(file)
        let skippedAreas: readonly string[] = []
        const outcome = await d.install<InstallRefusal>({
            bytes,
            verify: async (verifiedBytes) => {
                const result = await d.intake(verifiedBytes)
                if (result.ok === false) {
                    return { ok: false, refusal: { kind: 'intake', refusals: result.refusals } }
                }
                const pack = result.pack
                if (pack.size.warn && !await d.confirm(language.themePackLargeConfirm(formatPackSize(pack.totalBytes)))) {
                    return { ok: false, refusal: { kind: 'declinedLarge' } }
                }
                skippedAreas = pack.skippedAreas
                return { ok: true, manifest: pack.manifest }
            },
            confirmReplace: (existing) => d.confirm(language.themePackReplaceConfirm(existing.name)),
        })
        publish(mapOutcome(outcome, skippedAreas), d.notify)
    } catch {
        publish(errorMessage(language.themePackInstallFailed), d.notify)
    } finally {
        installFlowState.pending = false
    }
}

function refusedWhileOtherWork(d: InstallFlowDeps): boolean {
    return d.isBusy() || d.restoreInProgress()
}

/** Removes one list entry after a question. `entry` is the live value of `DBState.db.themePacks`, found again at confirm time. */
export async function removeThemePack(entry: unknown, name: string, deps?: Partial<InstallFlowDeps>): Promise<RemoveResult> {
    const d = resolveDeps(deps)
    if (refusedWhileOtherWork(d)) {
        publish(errorMessage(language.themePackBusy), d.notify)
        return 'busy'
    }
    if (!await d.confirm(language.themePackRemoveConfirm(name))) {
        return 'declined'
    }
    const found = listThemePacks(DBState.db.themePacks).find((item) => item.entry === entry)
    if (found === undefined || !removeThemePackAt(found.index, entry).ok) {
        publish(errorMessage(language.themePackRemoveChanged), d.notify)
        return 'changed'
    }
    requestSaveNow()
    installFlowState.outcome = null
    return 'removed'
}

/** Makes `id` the active pack, or none for `undefined`, and asks for a save. */
export function selectThemePack(id: string | undefined, deps?: Partial<InstallFlowDeps>): SelectResult {
    const d = resolveDeps(deps)
    if (refusedWhileOtherWork(d)) {
        publish(errorMessage(language.themePackBusy), d.notify)
        return 'busy'
    }
    installFlowState.outcome = null
    setActiveThemePack(id)
    requestSaveNow()
    return 'selected'
}
