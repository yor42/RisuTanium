import { setDatabase, type Database, type StoredDatabase } from 'src/ts/storage/database.svelte'
import type { SettingsPayloadInput, SettingsSource } from 'src/ts/drive/rtb/settingsPayload'
import { decodeSideLines, encodeSideLine } from 'src/ts/drive/rtb/sideLines'

/** A database as a boot leaves it for a profile that has set nothing: the production `setDatabase` over an empty one. */
export function realisticDb(): Database {
    const db = {} as StoredDatabase
    setDatabase(db)
    return db as unknown as Database
}

/** A source over a plain database object; `reads` records every key asked for. */
export function sourceOf(db: Database, reads: string[] = []): SettingsSource {
    return {
        get(key) {
            reads.push(key)
            return db[key]
        },
    }
}

/** The lines of a settings payload as the writer's `encodeSideLine` makes them, decoded again as the reader does. */
export function inputOf(records: readonly { key: string, value: unknown }[], uiPrefs: readonly { key: string, value: unknown }[] | null = null): SettingsPayloadInput {
    const parts = records.map((record) => encodeSideLine(record.key, record.value, []))
    const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of parts) {
        bytes.set(part, at)
        at += part.length
    }
    const decoded = decodeSideLines(bytes, [])
    if (decoded.kind !== 'ok') {
        throw new Error(`the test payload did not decode: ${decoded.reason}`)
    }
    return { values: decoded.values, uiPrefs }
}

/** A raw line the writer would refuse, as bytes, for a crafted file (`__proto__` keys survive `JSON.parse` only as own data). */
export function rawLine(text: string): Uint8Array {
    return new TextEncoder().encode(`${text}\n`)
}

/** Decodes raw lines the way a file's section does. */
export function inputOfRaw(lines: readonly string[]): SettingsPayloadInput {
    const decoded = decodeSideLines(rawLine(lines.join('\n')), [])
    if (decoded.kind !== 'ok') {
        throw new Error(`the crafted payload did not decode: ${decoded.reason}`)
    }
    return { values: decoded.values, uiPrefs: null }
}
