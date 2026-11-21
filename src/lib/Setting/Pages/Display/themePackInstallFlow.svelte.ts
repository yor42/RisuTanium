// The install, remove and select flow behind the Settings "Theme pack" row. It owns the in-flight latch and the outcome the
// row shows, so a row that is closed and reopened mid-install reads the same state. Every call to a dialog, the file chooser,
// the file reader or the install transaction is resolved when the function runs (never at module load), so a narrow test
// mock throws inside a handler, never on import.
import { language } from 'src/lang'
import { alertConfirm, alertNormal } from 'src/ts/alert'
import { restoreInProgress } from 'src/ts/drive/restoreInProgress'
import { requestSaveNow } from 'src/ts/globalApi.svelte'
import { isBusy } from 'src/ts/process/memory/busyActions'
import { leavePackScheme } from 'src/ts/gui/colorscheme'
import { DBState } from 'src/ts/stores.svelte'
import type { LintError } from 'src/ts/themePack'
import { cancelPackSchemeRequest, requestPackScheme } from 'src/ts/themePack/activePack.svelte'
import { installThemePack, removeThemePackAt, setActiveThemePack, type InstallOutcome, type PackTileColours, type PackVerifyIcon } from 'src/ts/themePack/install'
import { APPLIED_AREAS, intakePackBytes, type IntakeRefusal, type IntakeResult, type VerifiedPack } from 'src/ts/themePack/intake'
import { createJudgeClient } from 'src/ts/themePack/judgeClient'
import type { PackTile } from 'src/ts/themePack/manifest'
import { checkPackIcon } from 'src/ts/themePack/packIcon'
import { listThemePacks } from 'src/ts/themePack/packRecord'
import { deriveTileColours } from 'src/ts/themePack/tileColours'
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
        isBusy: deps?.isBusy ?? (() => isBusy({ ignoreDialogWaits: true })),
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
    iconMissing: () => language.themePackRefuseIconMissing,
    iconType: () => language.themePackRefuseIconType,
    iconTooLarge: (refusal) => language.themePackRefuseIconTooLarge(formatPackSize(refusal.limitBytes)),
    iconDimensions: (refusal) => language.themePackRefuseIconDimensions(refusal.limitPx),
    iconAnimated: () => language.themePackRefuseIconAnimated,
    iconUnreadable: () => language.themePackRefuseIconUnreadable,
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

/** The notes the validator gave one accepted stylesheet. */
interface SheetWarnings {
    sheet: string
    warnings: readonly LintError[]
}

/** The accepted sheets that carry warnings, in area order. A judgement without the field throws, which the install reports as a failure before any write. */
function sheetWarningsOf(pack: VerifiedPack): SheetWarnings[] {
    const out: SheetWarnings[] = []
    for (const area of APPLIED_AREAS) {
        const { warnings } = pack.sheets[area]
        if (warnings.length > 0) {
            out.push({ sheet: `${area}.css`, warnings })
        }
    }
    return out
}

/** `sheetWarnings` shows only on an installed pack; every other outcome ignores it, so a failure after verify never shows notes about a pack that was not stored. */
function mapOutcome(outcome: InstallOutcome<InstallRefusal>, skippedAreas: readonly string[], sheetWarnings: readonly SheetWarnings[]): RowMessage | null {
    if (outcome.ok === true) {
        const lines = [language.themePackInstalled(outcome.record.name)]
        if (skippedAreas.length > 0) {
            lines.push(language.themePackSkippedAreas(skippedAreas.map((area) => `${area}.css`).join(', ')))
        }
        for (const { sheet, warnings } of sheetWarnings) {
            lines.push(language.themePackInstalledWithWarnings(sheet))
            for (const w of warnings) {
                lines.push(language.themePackLintLine(w.selector, w.prop, w.why))
            }
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
            return errorMessage(language.store2Boot.readOnlyRefusal)
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

/** One manifest refusal per tile field written wrongly, each field named once, in the order colors, icon. */
function tileFieldRefusals(tile: PackTile): IntakeRefusal[] {
    const fields: string[] = []
    for (const item of [tile.main, tile.secondary, tile.icon]) {
        if (item.kind === 'invalid' && !fields.includes(item.field)) {
            fields.push(item.field)
        }
    }
    return fields.map((field): IntakeRefusal => ({ code: 'manifestField', field }))
}

/** The colours to store: a colour the manifest gives wins over one the sheet declares; a field with neither is left out. */
function tileColoursOf(tile: PackTile, chatCanonical: string): PackTileColours {
    const given = { main: tile.main.kind === 'ok' ? tile.main.value : undefined, secondary: tile.secondary.kind === 'ok' ? tile.secondary.value : undefined }
    const derived = given.main !== undefined && given.secondary !== undefined ? {} : deriveTileColours(chatCanonical)
    const out: PackTileColours = {}
    const main = given.main ?? derived.main
    const secondary = given.secondary ?? derived.secondary
    if (main !== undefined) {
        out.main = main
    }
    if (secondary !== undefined) {
        out.secondary = secondary
    }
    return out
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
        }, [], []), d.notify)
        return
    }
    installFlowState.pending = true
    installFlowState.outcome = null
    try {
        const bytes = await d.readFile(file)
        let skippedAreas: readonly string[] = []
        let sheetWarnings: readonly SheetWarnings[] = []
        const outcome = await d.install<InstallRefusal>({
            bytes,
            verify: async (verifiedBytes) => {
                const result = await d.intake(verifiedBytes)
                if (result.ok === false) {
                    return { ok: false, refusal: { kind: 'intake', refusals: result.refusals } }
                }
                const pack = result.pack
                // Before the large-pack question, so a pack that will be refused is never asked about.
                const tileRefusals = tileFieldRefusals(pack.manifest.tile)
                if (tileRefusals.length > 0) {
                    return { ok: false, refusal: { kind: 'intake', refusals: tileRefusals } }
                }
                // The icon is judged before the derivation and before the question, and the bytes judged are the bytes stored.
                let icon: PackVerifyIcon | undefined
                if (pack.manifest.tile.icon.kind === 'ok') {
                    const checked = await checkPackIcon(verifiedBytes, pack, pack.manifest.tile.icon.value)
                    if (checked.ok === false) {
                        return { ok: false, refusal: { kind: 'intake', refusals: [checked.refusal] } }
                    }
                    icon = { bytes: checked.bytes, ext: checked.ext }
                }
                const tile = tileColoursOf(pack.manifest.tile, pack.sheets.chat?.canonical ?? '')
                if (pack.size.warn && !await d.confirm(language.themePackLargeConfirm(formatPackSize(pack.totalBytes)))) {
                    return { ok: false, refusal: { kind: 'declinedLarge' } }
                }
                skippedAreas = pack.skippedAreas
                sheetWarnings = sheetWarningsOf(pack)
                return icon === undefined ? { ok: true, manifest: pack.manifest, tile } : { ok: true, manifest: pack.manifest, tile, icon }
            },
            confirmReplace: (existing) => d.confirm(language.themePackReplaceConfirm(existing.name)),
            // At this moment `activeThemePack` still names the pack being replaced, so the classification reads current
            // state: replacing the active pack updates it, anything else is a turn-on (install always activates).
            onActivate: ({ id, replacedId }) => requestPackScheme(id, replacedId !== null && replacedId === DBState.db.activeThemePack ? 'update' : 'turnOn'),
        })
        publish(mapOutcome(outcome, skippedAreas, sheetWarnings), d.notify)
    } catch {
        cancelPackSchemeRequest()
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
    const entryId = typeof entry === 'object' && entry !== null && 'id' in entry ? entry.id : undefined
    const wasActive = typeof entryId === 'string' && DBState.db.activeThemePack === entryId
    if (found === undefined || !removeThemePackAt(found.index, entry).ok) {
        publish(errorMessage(language.themePackRemoveChanged), d.notify)
        return 'changed'
    }
    if (wasActive) {
        // Removing the active pack turns it off: the user's own scheme comes back, unless they picked another meanwhile.
        cancelPackSchemeRequest()
        leavePackScheme()
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
    if (id === undefined) {
        cancelPackSchemeRequest()
        leavePackScheme()
    } else {
        requestPackScheme(id, 'turnOn')
    }
    setActiveThemePack(id)
    requestSaveNow()
    return 'selected'
}
