/**
 * The settings-only `.rtb` export (#161 S1d), through `runSettingsRtbExportGuarded`: real busy registry, real S7
 * shell, real `buildSettingsRecords`, real `writeSettingsRtb`, real sealing engine, and the real reader (`verifyRtb`,
 * `readSettingsPayload`) on the written bytes. The sealed file is opened with the test-only `referenceOpen`, which
 * shares no code with the engine. The platform writer and the stores are fakes.
 *
 * Labels: guards of a new contract (the module is new, so no pre-fix base exists); each turns red on a named scratch
 * mutant: a credential or connection field on the allowlist, an omitted preset field exported, the password ignored,
 * the whole database snapshotted, `saveCurrentPreset` called by the export, a missing `checkField` on export.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { isBusy, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { PRESET_FIELD_RULE, EXCLUDED_FIELDS, SETTINGS_FIELDS } from 'src/ts/drive/rtb/settingsFields'
import { readSettingsPayload, rebuildJson, type SettingsSource } from 'src/ts/drive/rtb/settingsPayload'
import { verifyRtb } from 'src/ts/drive/rtb/rtbVerify'
import { UI_PREFS_KEYS } from 'src/ts/drive/rtb/sideStoreConfig'
import { runSettingsRtbExportGuarded, settingsBackupFileName, settingsExportKeys, type SettingsRtbDeps } from 'src/ts/drive/rtbSettingsExport'
import { startSettingsRtbExport } from 'src/ts/drive/rtbExportEntry'
import { SECRET_FIELDS } from 'src/ts/secretFields'
import { SHARE_ENDPOINT_FIELDS } from 'src/ts/shareStrip'
import { presetFromWorkingSettings, type Database, type botPreset } from 'src/ts/storage/database.svelte'
import { DBState } from 'src/ts/stores.svelte'
import type { KeyEnv } from 'src/ts/storage/store2/format/keys'
import { readDirectory, readEntry } from 'src/ts/drive/rtb/zip64Reader'
import type { ExportCancelToken } from 'src/ts/exportCancel'
import { rangeSourceOfBytes } from './sparseSource'
import { referenceOpen, sequenceRandom, VECTOR_INPUT } from './sealed/sealedReference'
import { realisticDb } from './settingsTestKit'

// The real `setDatabase`, `presetFromWorkingSettings` and `saveCurrentPreset` run; only the modules whose import graph
// would start effects (the reactive stores and the global API) are replaced by plain stand-ins.
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    alertStore: writable({ type: 'none', msg: '' }),
    selectedCharID: writable(-1),
    selIdState: { selId: -1 },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock('src/ts/globalApi.svelte', () => {
    class TauriWriter {
        touchedFile = true
        constructor(public path: string) { }
        async write(): Promise<void> { }
        async close(): Promise<void> { }
    }
    return { LocalWriter: class { }, TauriWriter, downloadFile: vi.fn(), saveAsset: vi.fn(), readImage: vi.fn(), isSaveClean: () => true, moduleCommitVerdict: () => 'saved' as const }
})
vi.mock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }))
vi.mock('src/ts/alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn(), alertNormalWait: vi.fn(), alertClear: vi.fn(), alertWait: vi.fn(), alertConfirm: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ remove: vi.fn(async () => { }), writeFile: vi.fn(async () => { }), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined), convertFileSrc: (path: string) => path }))
vi.mock('src/ts/drive/exportModules', () => ({ ExportModuleUnreadableError: class extends Error { } }))
vi.mock('src/ts/storage/store/appStore', () => ({
    getAppStore: async () => { throw new Error('the page store is not part of this test') },
    getAppStoreKind: async () => 'tauri',
    pageStoreIsOpfsTransitional: async () => false,
}))

type Obj = Record<string, unknown>

const PASSWORD = 'settings-test-pw'
const SEAL_PARAMS = { m: 256, t: 2, chunkSize: 4096 }
const CLOCK = Date.UTC(2026, 10, 22, 9, 0, 0)
const KEY_ENV: KeyEnv = { random: (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 255), now: () => CLOCK }

/** The writer of a test: it keeps what it was given and applies the run's cancel switch like the real one. */
class FakeLocalWriter {
    readonly chunks: Uint8Array[] = []
    writes = 0
    closes = 0
    cancel?: ExportCancelToken

    async write(chunk: Uint8Array): Promise<void> {
        this.cancel?.throwIfCancelled()
        this.writes++
        this.chunks.push(chunk.slice())
    }

    async close(): Promise<void> {
        this.closes++
    }

    bytes(): Uint8Array {
        return Buffer.concat(this.chunks)
    }
}

/** Every entry of a file by name, read with the product reader. */
async function readRtbFile(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
    const source = rangeSourceOfBytes(bytes)
    const walk = await readDirectory(source)
    if (walk.findings.length > 0 || !walk.index) {
        throw new Error('the file directory is not readable')
    }
    const files = new Map<string, Uint8Array>()
    for (let i = 0; i < walk.index.count; i++) {
        const parts: Uint8Array[] = []
        const read = await readEntry(source, walk.index, i, (chunk) => { parts.push(chunk.slice()) })
        if (!read.ok) {
            throw new Error('the entry ' + walk.index.entry(i).name + ' does not read')
        }
        files.set(walk.index.entry(i).name, Buffer.concat(parts))
    }
    return files
}

beforeEach(() => {
    resetBusyActionsForTest()
    resetPageStorageModeForTests()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

/** The sentinels a test planted, by the path they sit at. */
type Planted = Map<string, string>

/** Puts `value` into `target[field]` at the path `sub` of a `SECRET_FIELDS` entry (`''`, `.x`, `[].x`, `[*]`, `[][1]`). */
function plant(target: Obj, field: string, sub: string, value: string): void {
    if (sub === '') {
        target[field] = value
    } else if (sub === '[*]') {
        target[field] = { ...(target[field] as Obj | undefined), planted: value }
    } else if (sub === '[][1]') {
        target[field] = [['planted', value]]
    } else if (sub.startsWith('[].')) {
        const existing = target[field]
        const list = (Array.isArray(existing) && existing.length > 0 ? existing : [{}]) as Obj[]
        list[0][sub.slice(3)] = value
        target[field] = list
    } else if (sub.startsWith('.')) {
        target[field] = { ...(target[field] as Obj | undefined), [sub.slice(1)]: value }
    } else {
        throw new Error(`the test cannot plant at ${field}${sub}`)
    }
}

/** A realistic database with a non-empty sentinel in every credential leaf, every excluded field and every omitted preset field. */
function seededDb(): { db: Database, planted: Planted } {
    const db = realisticDb()
    const record = db as unknown as Obj
    const planted: Planted = new Map()
    const next = (path: string): string => {
        const value = `SENTINEL-${planted.size}-${path.replace(/[^A-Za-z0-9]/g, '_')}`
        planted.set(path, value)
        return value
    }
    const presets = [...db.botPresets]
    const second = presetFromWorkingSettings(db, 'Second', '')
    second.id = 'second-id'
    presets.push(second)
    presets.forEach((entry, at) => { entry.id ??= `p${at}` })
    db.botPresets = presets

    const characters: Obj = { chaId: 'c1' }
    record.characters = [characters]
    // The character list holds the character-scope credential, so the excluded-field pass leaves it alone.
    const seeded = new Set<string>(['characters'])
    for (const entry of SECRET_FIELDS) {
        if ('notCredential' in entry && entry.notCredential === true) {
            continue
        }
        const sub = 'sub' in entry ? entry.sub : ''
        const path = `${entry.scope}:${entry.field}${sub}`
        if (entry.scope === 'botPreset') {
            // A saved preset and the selected slot both hold the credential.
            for (const preset of presets) {
                const value = next(`${path}@${preset.id}`)
                plant(preset as unknown as Obj, entry.field, sub, value)
            }
            continue
        }
        const value = next(path)
        if (entry.scope === 'database') {
            plant(record, entry.field, sub, value)
            seeded.add(entry.field)
        } else {
            plant(characters, entry.field, sub, value)
        }
    }
    for (const field of EXCLUDED_FIELDS) {
        if (!seeded.has(field)) {
            record[field] = next(`database:${field}`)
        }
    }
    for (const { field } of SHARE_ENDPOINT_FIELDS) {
        for (const preset of presets) {
            (preset as unknown as Obj)[field] = next(`preset:${field}@${preset.id}`)
        }
    }
    for (const [field, rule] of Object.entries(PRESET_FIELD_RULE)) {
        if (rule === 'omit') {
            for (const preset of presets) {
                const held = (preset as unknown as Obj)[field]
                // A field already holding a sentinel keeps it, so every planted value is really in the database.
                if (typeof held !== 'string' || !held.startsWith('SENTINEL-')) {
                    (preset as unknown as Obj)[field] = next(`preset:${field}@${preset.id}`)
                }
            }
        }
    }
    return { db, planted }
}

function sourceFor(db: Database, reads: string[] = []): SettingsRtbDeps['source'] {
    return (keys) => {
        const allowed = new Set<string>(keys)
        const source: SettingsSource = {
            get(key) {
                if (!allowed.has(key)) {
                    throw new Error(`the export read ${String(key)}, which it did not ask for`)
                }
                reads.push(key)
                return structuredClone(db[key])
            },
        }
        return source
    }
}

interface Local { length: number, key(at: number): string | null, getItem(key: string): string | null }

function localOf(entries: Record<string, string>): Local {
    const keys = Object.keys(entries)
    return { length: keys.length, key: (at) => keys[at] ?? null, getItem: (key) => entries[key] ?? null }
}

interface RunExtra {
    reads?: string[]
    local?: Record<string, string>
    over?: Partial<SettingsRtbDeps>
}

function depsFor(db: Database, extra: RunExtra = {}) {
    const writer = new FakeLocalWriter()
    const openWriter = vi.fn(async (session: Parameters<SettingsRtbDeps['openWriter']>[0]) => {
        writer.cancel = session.cancel
        session.writer = writer as never
        return writer
    })
    const deps: SettingsRtbDeps = {
        openWriter,
        source: sourceFor(db, extra.reads),
        sideBackends: {
            forage: () => { throw new Error('the settings export reads no forage store') },
            local: () => localOf(extra.local ?? {}) as never,
        },
        writerInfo: { app: 'risutanium', version: '0.0.0-test', build: 'test' },
        platform: () => ({ platform: 'web', label: 'Browser' }),
        clock: () => CLOCK,
        keyEnv: KEY_ENV,
        seal: { params: SEAL_PARAMS, random: sequenceRandom([VECTOR_INPUT.master, VECTOR_INPUT.salt, VECTOR_INPUT.wrapNonce, VECTOR_INPUT.fileId]) },
        ...extra.over,
    }
    return { deps, writer, openWriter }
}

async function run(db: Database, password?: string, extra: RunExtra = {}) {
    const built = depsFor(db, extra)
    const result = await runSettingsRtbExportGuarded(built.deps, { password })
    if (result.status !== 'ended' || result.outcome.status !== 'saved' || result.report === null) {
        throw new Error(`the export did not save: ${JSON.stringify(result.status === 'ended' ? result.outcome : result)}`)
    }
    return { ...built, report: result.report, bytes: Buffer.from(built.writer.bytes()) }
}

async function verified(plain: Uint8Array) {
    const verdict = await verifyRtb(rangeSourceOfBytes(plain))
    if (verdict.kind !== 'settings') {
        throw new Error(`the file verified as ${verdict.kind}`)
    }
    const read = readSettingsPayload(verdict.verified)
    if ('refused' in read) {
        throw new Error(read.refused)
    }
    return { verdict, read }
}

function textOf(files: ReadonlyMap<string, Uint8Array>): string {
    return [...files.values()].map((bytes) => new TextDecoder('latin1').decode(bytes)).join('\n')
}

const LISTS = new Set(['botPresets', 'botPresetsId', 'presetFolders', 'hypaV3Presets', 'hypaV3PresetId', 'translatorPresets', 'translatorPresetId'])

describe('T14 (guard): a plain and a sealed settings export read back through the real reader', () => {
    function expectCarried(db: Database, read: Awaited<ReturnType<typeof verified>>['read']) {
        const source = db as unknown as Obj
        const carried = read.fields as Obj
        for (const name of SETTINGS_FIELDS) {
            if (LISTS.has(name)) continue
            const value = rebuildJson(source[name])
            if (value === undefined) {
                expect(name in carried, name).toBe(false)
            } else {
                expect(carried[name], name).toEqual(value)
            }
        }
    }

    test('plain: the file is a settings file, every carried field is the source value, nothing is dropped or skipped', async () => {
        const db = realisticDb()
        const record = db as unknown as Obj
        record.theme = 'waifu'
        record.zoomsize = 123
        record.customCSS = '.a { color: red }'
        const sent = await run(db, undefined, { local: { [UI_PREFS_KEYS[0]]: 'dark' } })
        expect(sent.report.skipped).toEqual([])
        expect(sent.report.uiPrefsLeftOut).toBe(false)
        expect(sent.report.length).toBe(sent.bytes.length)
        expect(sent.bytes.subarray(0, 2).toString('latin1')).toBe('PK')
        expect(sent.writer.closes).toBe(1)
        const { verdict, read } = await verified(sent.bytes)
        expect(read.dropped).toBe(0)
        expectCarried(db, read)
        expect(read.fields.theme).toBe('waifu')
        expect(read.fields.zoomsize).toBe(123)
        expect(read.presets!.length).toBe(db.botPresets.length)
        expect(verdict.verified.uiPrefs).toEqual([{ key: UI_PREFS_KEYS[0], value: 'dark' }])
        expect(read.uiPrefs).toEqual([{ key: UI_PREFS_KEYS[0], value: 'dark' }])
        expect(sent.report.fields).toBe(verdict.verified.values.length)
    })

    test('sealed: the file opens by the reference and holds the plain export byte for byte', async () => {
        const db = realisticDb()
        const plain = await run(db, undefined, { local: { [UI_PREFS_KEYS[0]]: 'dark' } })
        const sealed = await run(db, PASSWORD, { local: { [UI_PREFS_KEYS[0]]: 'dark' } })
        const inside = referenceOpen(sealed.bytes, PASSWORD)
        expect(inside.equals(plain.bytes)).toBe(true)
        expect(sealed.report.length).toBe(sealed.bytes.length)
        expect(sealed.report.length).not.toBe(inside.length)
        expect(sealed.bytes.subarray(0, 2).toString('latin1')).not.toBe('PK')
        const { read } = await verified(inside)
        expect(read.dropped).toBe(0)
        expectCarried(db, read)
        expect(() => referenceOpen(sealed.bytes, 'not-the-password')).toThrow()
        expect(sealed.writer.closes).toBe(1)
    })

    test('a password the sealed format refuses rejects before busy, a writer or a read; nothing is written', async () => {
        const db = realisticDb()
        const reads: string[] = []
        const built = depsFor(db, { reads })
        await expect(runSettingsRtbExportGuarded(built.deps, { password: '' })).rejects.toThrow(TypeError)
        expect(isBusy()).toBe(false)
        expect(built.openWriter).not.toHaveBeenCalled()
        expect(reads).toEqual([])
        expect(built.writer.writes).toBe(0)
    })

    test('a dismissed save dialog ends declined and writes nothing', async () => {
        const db = realisticDb()
        const built = depsFor(db, { over: { openWriter: async () => null } })
        const result = await runSettingsRtbExportGuarded(built.deps, {})
        expect(result.status === 'ended' && result.outcome).toEqual({ status: 'declined', cause: 'save-dialog-cancelled' })
        expect(result.status === 'ended' && result.report).toBeNull()
        expect(built.writer.writes).toBe(0)
    })

    test('an unreadable interface-preference store leaves the row out and is reported', async () => {
        const db = realisticDb()
        const sent = await run(db, undefined, { over: { sideBackends: { forage: () => { throw new Error('none') }, local: () => { throw new Error('storage denied') } } } })
        expect(sent.report.uiPrefsLeftOut).toBe(true)
        const { verdict } = await verified(sent.bytes)
        expect(verdict.verified.uiPrefs).toBeNull()
    })

    test('the suggested name is settings-YYYYMMDD.rtb of the local date', async () => {
        expect(settingsBackupFileName(new Date(2026, 10, 2))).toBe('settings-20261102.rtb')
        const sent = await run(realisticDb())
        expect(sent.report.fileName).toMatch(/^settings-\d{8}\.rtb$/)
    })
})

describe('T5 (guard): no credential, connection, endpoint or omitted preset field is in any byte the export writes', () => {
    test('every planted sentinel is absent from the file, its decoded entries and the sealed file\'s plaintext', async () => {
        const { db, planted } = seededDb()
        expect(planted.size).toBeGreaterThan(40)
        for (const [path, value] of planted) {
            expect(value.length, path).toBeGreaterThan(8)
        }
        // The seeded database must really hold every sentinel, or the scan below proves nothing.
        const held = JSON.stringify(db)
        for (const [path, value] of planted) {
            expect(held.includes(value), path).toBe(true)
        }
        const reads: string[] = []
        for (const password of [undefined, PASSWORD]) {
            const sent = await run(db, password, { reads })
            const plain = password === undefined ? sent.bytes : referenceOpen(sent.bytes, password)
            const files = await readRtbFile(plain)
            const entries = textOf(files)
            const raw = plain.toString('latin1')
            for (const [path, value] of planted) {
                expect(entries, `decoded entries hold ${path}`).not.toContain(value)
                expect(raw, `raw bytes hold ${path}`).not.toContain(value)
            }
            const { verdict, read } = await verified(plain)
            const payload = JSON.stringify({ values: verdict.verified.values, read })
            for (const [path, value] of planted) {
                expect(payload, `payload holds ${path}`).not.toContain(value)
            }
            expect(read.dropped).toBe(0)
        }
        // The export never even asks the database for an excluded field.
        for (const field of EXCLUDED_FIELDS) {
            expect(reads, field).not.toContain(field)
        }
        expect(reads).not.toContain('characters')
    })

    test('the selected preset is carried without its omitted fields, other presets too', async () => {
        const { db } = seededDb()
        const sent = await run(db)
        const { read } = await verified(sent.bytes)
        const omitted = Object.entries(PRESET_FIELD_RULE).filter(([, rule]) => rule === 'omit').map(([field]) => field)
        expect(omitted.length).toBe(10)
        expect(read.presets!.length).toBe(2)
        for (const preset of read.presets!) {
            for (const field of omitted) {
                expect(field in preset, `${preset.id} ${field}`).toBe(false)
            }
        }
    })

    test('the export asks the source for the allowlist and the working preset fields only', async () => {
        const reads: string[] = []
        await run(realisticDb(), undefined, { reads })
        const allowed = new Set<string>(settingsExportKeys())
        expect(reads.length).toBeGreaterThan(50)
        for (const key of reads) {
            expect(allowed.has(key), key).toBe(true)
        }
        expect(reads).not.toContain('characters')
        expect(reads).not.toContain('koboldURL')
        expect(reads).not.toContain('proxyConnectionId')
    })
})

describe('T15 (guard): the export writes nothing and marks nothing', () => {
    test('the database is unchanged, the working preset is read but not saved into its slot', async () => {
        const db = realisticDb()
        DBState.db = db
        db.temperature = 0.123
        db.botPresets.forEach((entry, at) => { entry.id ??= `p${at}` })
        const slotBefore = db.botPresets[db.botPresetsId].temperature
        expect(slotBefore).not.toBe(0.123)
        const before = JSON.stringify(db)
        const sent = await run(db)
        expect(JSON.stringify(db)).toBe(before)
        expect(db.botPresets[db.botPresetsId].temperature).toBe(slotBefore)
        const { read } = await verified(sent.bytes)
        // The file holds the working value as the selected preset.
        const carried = read.presets![db.botPresetsId] as unknown as botPreset
        expect(carried.temperature).toBe(0.123)
        expect(read.fields.temperature).toBe(0.123)
    })

    test('a value the reader would drop is skipped and named, and the export still saves', async () => {
        const db = realisticDb()
        ;(db as unknown as Obj).zoomsize = Number.NaN
        ;(db as unknown as Obj).iconsize = 'wide'
        const sent = await run(db)
        expect(sent.report.skipped).toEqual(expect.arrayContaining(['zoomsize', 'iconsize']))
        const { read } = await verified(sent.bytes)
        expect(read.dropped).toBe(0)
        expect('zoomsize' in read.fields).toBe(false)
        expect('iconsize' in read.fields).toBe(false)
    })
})

describe('the entry (guard)', () => {
    test('startSettingsRtbExport passes the password and a card, and ignores a second start while one runs', async () => {
        let release: () => void = () => { }
        const seen: Obj[] = []
        const deps = {
            isTauri: false,
            run: vi.fn(async (options: Obj) => {
                seen.push(options)
                await new Promise<void>((resolve) => { release = resolve })
                return { status: 'ended' as const, outcome: { status: 'declined' as const, cause: 'save-dialog-cancelled' as const }, report: null }
            }),
        }
        const first = startSettingsRtbExport(deps as never, { password: 'p' })
        expect(await startSettingsRtbExport(deps as never)).toBeNull()
        release()
        await first
        expect(deps.run).toHaveBeenCalledTimes(1)
        expect(seen[0].password).toBe('p')
        const card = seen[0].card as { def: { steps: { id: string }[] } }
        expect(card.def.steps.map((step) => step.id)).toEqual(['prepare', 'side', 'finish'])
    })
})
