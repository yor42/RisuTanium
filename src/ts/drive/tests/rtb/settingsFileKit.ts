import { writeSettingsRtb, type RtbSource, type SideRecord } from 'src/ts/drive/rtb/rtbWriter'
import { RTB_MIMETYPE } from 'src/ts/drive/rtb/sniff'
import type { KeyEnv } from 'src/ts/storage/store2/format/keys'
import { Zip64Writer, type FillPiece, type ZipMethod } from 'src/ts/drive/rtb/zip64Writer'
import { SegmentSink } from './segmentSink'
import { rangeSourceOfSink } from './sparseSource'
import type { RangeSource } from 'src/ts/drive/rtb/rangeSource'

export const SETTINGS_CREATED = Date.UTC(2026, 10, 22, 9, 0, 0)

const ENV: KeyEnv = { random: (n) => Uint8Array.from({ length: n }, (_, i) => (i * 5 + 9) & 255), now: () => SETTINGS_CREATED }
const encoder = new TextEncoder()

export const SETTINGS_SOURCE: RtbSource = { device: { label: 'test-phone', platform: 'android' }, committedAt: SETTINGS_CREATED - 1000, unsavedExcluded: false }

export interface BuiltFile {
    source: RangeSource
    /** The whole file; only for a file known to be small. */
    bytes(): Uint8Array
}

function builtOf(sink: SegmentSink): BuiltFile {
    return { source: rangeSourceOfSink(sink), bytes: () => sink.toBytes() }
}

export interface SettingsFileInput {
    settings: readonly SideRecord[]
    uiPrefs?: readonly SideRecord[]
    bufferLimit?: number
}

/** A settings-only file as the product's writer makes it. */
export async function settingsFile(input: SettingsFileInput): Promise<BuiltFile> {
    const sink = new SegmentSink()
    await writeSettingsRtb({
        sink,
        clock: () => SETTINGS_CREATED,
        keyEnv: ENV,
        writer: { app: 'risutanium', version: '1.0.0', build: 'test' },
        settings: input.settings,
        uiPrefs: input.uiPrefs,
        source: SETTINGS_SOURCE,
        bufferLimit: input.bufferLimit,
    })
    return builtOf(sink)
}

export interface CraftedEntry {
    name: string
    body: string | Uint8Array | FillPiece
    method?: ZipMethod
}

export interface CraftedRow {
    id: string
    v?: number
    required?: boolean
    prefix: string
    meta?: Record<string, unknown>
}

type Json = Record<string, unknown>

/**
 * A container with exactly the entries and rows given, for a file the writer would never make (a row beside the
 * settings row, a second data entry, an oversize entry). Row counts come from the entries unless `rows` rewrites them.
 */
export async function craftedFile(options: { entries: readonly CraftedEntry[], defs: readonly CraftedRow[], rows?: (rows: Json[]) => Json[] }): Promise<BuiltFile> {
    const sizeOf = (body: CraftedEntry['body']): number => typeof body === 'string' ? encoder.encode(body).length : 'length' in body ? body.length : 0
    const computed: Json[] = options.defs.map((def) => {
        const own = options.entries.filter((entry) => entry.name.startsWith(def.prefix))
        return {
            id: def.id,
            v: def.v ?? 1,
            required: def.required ?? false,
            prefix: def.prefix,
            entries: own.length,
            bytes: own.reduce((sum, entry) => sum + sizeOf(entry.body), 0),
            ...(def.meta ? { meta: def.meta } : {}),
        }
    })
    const manifest = {
        rtb: 1,
        writer: { app: 'risutanium', version: '1.0.0', build: 'test' },
        createdAt: SETTINGS_CREATED,
        snapshot: { id: 'a'.repeat(26), parent: null, lineage: [] },
        source: SETTINGS_SOURCE,
        sections: options.rows ? options.rows(computed) : computed,
        omitted: [],
    }
    const manifestBody = encoder.encode(JSON.stringify(manifest))
    const sink = new SegmentSink()
    const writer = new Zip64Writer({ sink, createdAt: SETTINGS_CREATED, bufferLimit: 1024 })
    const mime = encoder.encode(RTB_MIMETYPE)
    await writer.addBuffered('mimetype', 0, mime, mime.length)
    for (const entry of options.entries) {
        const method = entry.method ?? 0
        if (typeof entry.body === 'string' || entry.body instanceof Uint8Array) {
            const body = typeof entry.body === 'string' ? encoder.encode(entry.body) : entry.body
            await writer.addBuffered(entry.name, method, body, body.length)
        } else {
            const fill = entry.body
            await writer.addStreamed(entry.name, 0, (async function* () { yield fill })(), null)
        }
    }
    await writer.addBuffered('manifest.json', 8, manifestBody, manifestBody.length)
    await writer.finish({ firstCentral: 'manifest.json' })
    return builtOf(sink)
}

/** The settings row of a hand-made file: required, at its prefix. */
export const SETTINGS_ROW: CraftedRow = { id: 'settings', prefix: 'settings/', required: true }
