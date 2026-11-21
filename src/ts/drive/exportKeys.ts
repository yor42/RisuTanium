/**
 * The export side of wrapped connection keys, shared by the `.bin` and `.rtb` writers. Before a writer
 * opens, a snapshot reads every wrapped key the file would carry and one confirm names the keys it
 * cannot (this device can never read them, or cannot right now). After the writer opens, only the
 * snapshot and the synchronous reader are used: no vault call can stall or fail the export.
 *
 * A `.bin` snapshot covers only the connections its translation resolves (a slot, the root pair, a
 * preset, a custom model, an OpenAI-compatible provider); a `.rtb` snapshot covers every connection,
 * because its config unit carries them all.
 */
import { language } from 'src/lang'
import { alertConfirm } from '../alert'
import { keyStateOf, writeLegacyFromConnections } from '../connections/binTranslate'
import { storedConnections, type Connection } from '../connections/connections'
import {
    exportKeyReader, exportKeySnapshot, wrappedOf, type ExportKeyReader, type ExportKeySnapshot,
} from '../connections/keyVaultStore.svelte'
import { migrateConnections } from '../connections/migrate'
import { getDatabase, type Database, type StoredDatabase } from '../storage/database.svelte'
import { shownPromptNames } from './backupUpstreamSizes'
import { confirmDuringExport, type ExportSession } from './exportShell'
import type { SideRecord } from './rtb/rtbWriter'

/** The key side of a `.rtb` export, injected so a test can stand in for the page. */
export interface RtbExportKeys {
    /** Reads the wrapped keys the file would carry; runs before the writer opens. */
    snapshot(): Promise<ExportKeySnapshot>
    /** One confirm naming what cannot be carried; `false` is a decline and nothing is written. */
    confirm(session: ExportSession, snapshot: ExportKeySnapshot): Promise<boolean>
    /** The section's lines from the live carriers, synchronously, and the connections first found unreadable now. */
    lines(snapshot: ExportKeySnapshot): { records: SideRecord[], late: string[] }
}

/**
 * The connections a `.bin` of `db` reads keys from: the translation itself runs over the same
 * projection with a reader that records each connection it asks about, so the two cannot drift.
 */
export function binExportConnections(db: Database): Connection[] {
    const unaccounted = { ...db, account: undefined }
    const plain: StoredDatabase = unaccounted
    const state = keyStateOf(plain)
    migrateConnections(state)
    const seen = new Map<string, Connection>()
    const recorder: ExportKeyReader = {
        keyOf(conn) {
            if (!seen.has(conn.id)) {
                seen.set(conn.id, conn)
            }
            return ''
        },
        late: () => [],
    }
    writeLegacyFromConnections(state, keyStateOf(plain), recorder)
    return [...seen.values()]
}

/** The snapshot of a `.bin` of `db`. */
export function binKeySnapshot(db: Database): Promise<ExportKeySnapshot> {
    return exportKeySnapshot(binExportConnections(db))
}

function namesText(names: readonly string[]): string {
    return shownPromptNames(names).join(', ')
}

/** The text of the one key confirm, or null when every wrapped key can be carried. */
export function exportKeysConfirmText(snapshot: ExportKeySnapshot): string | null {
    const parts: string[] = []
    if (snapshot.unreadableNames.length > 0) {
        parts.push(language.vaultExportUnreadableKeys(namesText(snapshot.unreadableNames)))
    }
    if (snapshot.unavailableNames.length > 0) {
        parts.push(language.vaultExportKeysUnavailableNow(namesText(snapshot.unavailableNames)))
    }
    return parts.length === 0 ? null : parts.join('\n\n')
}

/** Asks the one key confirm; `true` when nothing is named or the person confirms. Declining writes nothing. */
export async function confirmExportKeys(session: ExportSession, snapshot: ExportKeySnapshot): Promise<boolean> {
    const text = exportKeysConfirmText(snapshot)
    return await confirmDuringExport(session, text !== null, async () => text === null || await alertConfirm(text))
}

/** The report text for keys found unreadable only after the writer opened; empty when there are none. */
export function exportKeysLateText(names: readonly string[]): string {
    return names.length === 0 ? '' : language.vaultExportKeysLeftOutLate(namesText(names))
}

function byCodeUnit(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0
}

/**
 * The `.rtb` section's lines: one per live carrier that holds an envelope and no plain key and whose
 * plain is known, sorted by (connection id, envelope). The reader is envelope-keyed, so a carrier whose
 * envelope the snapshot did not read gets no line and is returned as late.
 */
export function rtbKeyRecords(connections: readonly Connection[], snapshot: ExportKeySnapshot): { records: SideRecord[], late: string[] } {
    const reader = exportKeyReader(snapshot)
    const rows: Array<{ id: string, e: string, p: string }> = []
    for (const conn of connections) {
        const envelope = wrappedOf(conn)
        if (conn.key !== '' || envelope === undefined) {
            continue
        }
        const plain = reader.keyOf(conn)
        if (plain !== '') {
            rows.push({ id: conn.id, e: envelope, p: plain })
        }
    }
    rows.sort((a, b) => byCodeUnit(a.id, b.id) || byCodeUnit(a.e, b.e))
    return { records: rows.map((row) => ({ key: row.id, value: { e: row.e, p: row.p } })), late: reader.late() }
}

export function liveRtbExportKeys(): RtbExportKeys {
    return {
        snapshot: () => exportKeySnapshot(storedConnections(getDatabase())),
        confirm: confirmExportKeys,
        lines: (snapshot) => rtbKeyRecords(storedConnections(getDatabase()), snapshot),
    }
}
