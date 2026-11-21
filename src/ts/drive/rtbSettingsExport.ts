/**
 * The settings-only `.rtb` export (#161): the carried settings of the live database, and the interface preferences of
 * the device, written as one small file. It reads the database and `localStorage` and writes neither.
 *
 * Contracts:
 *  - The snapshot is taken per key, from `SETTINGS_FIELDS` and the working preset fields alone, so no character, chat,
 *    key, connection or endpoint is ever read, and the file cannot carry one (MC-3359).
 *  - Nothing registers busy or opens a writer before the password is checked. A refused password rejects with a
 *    TypeError, as the full export does.
 *  - The export saves nothing and marks nothing: the working preset is read as `saveCurrentPreset` would save it, and
 *    the database is left as it was.
 *  - With a password the key derivation runs before the writer opens, the sealing sink is finished after the archive's
 *    last byte and before `close()`, and every exit abandons the prepared seal.
 *  - `saved` is reported only after the writer's `close()` resolved.
 */
import { withBusy } from '../process/memory/busyActions'
import { appVer, type Database } from '../storage/database.svelte'
import { yieldToEventLoop } from '../storage/saveYield'
import type { KeyEnv } from '../storage/store2/format/keys'
import { localBackupFileName } from './backupFileName'
import { ensureGestureForWriter, openWriterOutsideBusy, runExport, type ExportSession, type ExportShellCard } from './exportShell'
import type { ExportOutcome } from './operationEnd'
import { CoalescingSink } from './rtb/coalescingSink'
import { passwordBytes } from './rtb/sealed/password'
import { DEFAULT_SEAL_PARAMS, type SealParams } from './rtb/sealed/policy'
import { prepareSeal, type PreparedSeal, type SealDeps } from './rtb/sealed/sealWriter'
import { PRESET_SOURCE_FIELDS, SETTINGS_FIELDS } from './rtb/settingsFields'
import { buildSettingsRecords, type SettingsSource } from './rtb/settingsPayload'
import { writeSettingsRtb, type SideRecord } from './rtb/rtbWriter'
import { defaultSideBackends, readSideStore, type SideBackends } from './rtb/sideStores'
import { livePlatform, openRtbWriter, type RtbExportProgress, type RtbPlatform } from './rtbExportSources'
import { settingsSource } from './rtbSettingsSource.svelte'

/** The steps of the run's task card, by the ids the run reports; the entry owns their labels. */
export type SettingsRtbStep = 'prepare' | 'side' | 'finish'

export interface SettingsRtbCard {
    readonly def: ExportShellCard['def']
    /** The done card's text after a saved run. */
    readonly summary: string[]
}

export interface SettingsRtbOptions {
    /** The run's task card. Without it the run is card-less and shows the wait dialog of `progressText`. */
    card?: SettingsRtbCard
    onProgress?: (event: RtbExportProgress) => void
    progressText?: (event: RtbExportProgress) => string
    /** The suggested name; `settings-YYYYMMDD.rtb` of the device's local date when absent. */
    fileName?: string
    /** Seals the file under this password; text the sealed format refuses rejects with a TypeError before anything starts. */
    password?: string
}

export interface SettingsRtbDeps {
    openWriter(session: ExportSession, fileName: string): Promise<{ write(chunk: Uint8Array): Promise<void>, close(): Promise<void> } | null>
    /** Where the carried values are read from: one snapshot per requested key. */
    source(keys: readonly (keyof Database)[]): SettingsSource
    sideBackends: SideBackends
    writerInfo: { app: string, version: string, build: string }
    platform(): RtbPlatform
    clock(): number
    keyEnv?: KeyEnv
    /** Tests only: the key-derivation cost and the injected seams of the seal; live uses the policy defaults. */
    seal?: { params: SealParams } & SealDeps
}

export interface SettingsRtbReport {
    fileName: string
    length: number
    createdAt: number
    /** The carried keys written, and the keys or nested paths left out because the file could not carry them. */
    fields: number
    skipped: string[]
    /** The interface preferences could not be read, so the file has none. */
    uiPrefsLeftOut: boolean
}

export type SettingsRtbResult = { status: 'ended', outcome: ExportOutcome, report: SettingsRtbReport | null }

/** `settings-YYYYMMDD.rtb`, the device's local date. */
export function settingsBackupFileName(date: Date): string {
    return localBackupFileName(date).replace(/^local-/, 'settings-').replace(/\.bin$/, '.rtb')
}

/** Every key the export may read: the carried fields and the working preset fields of the selected preset. */
export function settingsExportKeys(): (keyof Database)[] {
    return [...new Set<keyof Database>([...SETTINGS_FIELDS, ...PRESET_SOURCE_FIELDS])]
}

async function writeSettings(deps: SettingsRtbDeps, options: SettingsRtbOptions, session: ExportSession, holder: { report: SettingsRtbReport | null }): Promise<ExportOutcome> {
    const emit = (event: RtbExportProgress): void => {
        options.onProgress?.(event)
        const text = options.progressText === undefined ? null : options.progressText(event)
        switch (event.phase) {
            case 'opening':
                session.progress.phase('prepare', text)
                break
            case 'side':
                session.progress.phase('side', text)
                break
            case 'finishing':
                session.progress.phase('finish', text)
                break
        }
    }
    const fileName = options.fileName ?? settingsBackupFileName(new Date(deps.clock()))

    emit({ phase: 'opening' })
    session.cancel.throwIfCancelled()
    let seal: PreparedSeal | null = null
    try {
        if (options.password !== undefined) {
            await yieldToEventLoop()
            const { params, ...sealDeps } = deps.seal ?? { params: DEFAULT_SEAL_PARAMS }
            seal = await prepareSeal(options.password, params, sealDeps)
            session.cancel.throwIfCancelled()
        }
        await ensureGestureForWriter(session)
        const writer = await openWriterOutsideBusy(session, () => deps.openWriter(session, fileName))
        session.cancel.throwIfCancelled()
        if (writer === null) {
            return { status: 'declined', cause: 'save-dialog-cancelled' }
        }

        emit({ phase: 'side', section: 'settings' })
        const built = buildSettingsRecords(deps.source(settingsExportKeys()))
        const prefs = await readSideStore('side.ui-prefs', deps.sideBackends)
        const uiPrefs: SideRecord[] | undefined = 'records' in prefs ? await collect(prefs.records) : undefined
        session.cancel.throwIfCancelled()

        const enc = seal === null ? null : seal.sink((sealed) => writer.write(sealed))
        const sink = new CoalescingSink((chunk) => (enc === null ? writer.write(chunk) : enc.write(chunk)))
        const platform = deps.platform()
        const createdAt = deps.clock()
        const result = await writeSettingsRtb({
            sink,
            writer: deps.writerInfo,
            clock: () => createdAt,
            keyEnv: deps.keyEnv,
            settings: built.records,
            uiPrefs,
            // The live values are written as they are, so nothing of the page is left out for being unsaved.
            source: { device: { label: platform.label, platform: platform.platform }, committedAt: createdAt, unsavedExcluded: false },
        })

        emit({ phase: 'finishing' })
        await sink.flush()
        if (enc !== null) {
            await enc.finish()
        }
        await writer.close()

        holder.report = {
            fileName,
            length: enc === null ? result.length : enc.bytesWritten,
            createdAt: result.createdAt,
            fields: built.records.length,
            skipped: built.skipped,
            uiPrefsLeftOut: uiPrefs === undefined,
        }
        if (options.card !== undefined) {
            session.progress.done(options.card.summary)
        }
        return { status: 'saved', notices: [], suggestedName: fileName, omitted: { assets: [], oversize: [], units: [], inlays: [], oldStoreUnlisted: false, repaired: null }, inlays: { exported: 0, leftOut: [], oldStoreUnlisted: false } }
    } finally {
        seal?.abandon()
    }
}

async function collect(records: AsyncIterable<SideRecord>): Promise<SideRecord[]> {
    const out: SideRecord[] = []
    for await (const record of records) {
        out.push(record)
    }
    return out
}

/**
 * The guarded export: the password check, then the busy entry, then the S7 shell around the run. `withBusy` and
 * `runExport` are the production ones.
 */
export async function runSettingsRtbExportGuarded(deps: SettingsRtbDeps, options: SettingsRtbOptions = {}): Promise<SettingsRtbResult> {
    if (options.password !== undefined) {
        const bytes = passwordBytes(options.password)
        if (typeof bytes === 'string') {
            throw new TypeError(`The backup password cannot be used: ${bytes}.`)
        }
        bytes.fill(0)
    }
    const holder: { report: SettingsRtbReport | null } = { report: null }
    const outcome = await withBusy('backupSave', (busy) => runExport((session) => writeSettings(deps, options, session, holder), busy, options.card ?? null))
    return { status: 'ended', outcome, report: outcome.status === 'saved' ? holder.report : null }
}

export function liveSettingsRtbDeps(): SettingsRtbDeps {
    return {
        openWriter: openRtbWriter,
        source: settingsSource,
        sideBackends: defaultSideBackends,
        writerInfo: { app: 'risutanium', version: appVer, build: import.meta.env.MODE },
        platform: livePlatform,
        clock: Date.now,
    }
}

export function exportSettingsRtb(options: SettingsRtbOptions = {}): Promise<SettingsRtbResult> {
    return runSettingsRtbExportGuarded(liveSettingsRtbDeps(), options)
}
