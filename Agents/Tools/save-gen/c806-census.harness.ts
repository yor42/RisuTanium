// @vitest-environment node
/**
 * CHORE-806 stage 0 (profiling tooling, diagnostic; not a regression test): the in-process census of a synthetic library.
 *
 * The library comes from c806-library.mjs. The store2 tree is made by the app's own first-boot import,
 * `bootImportLegacyTree`, on the memory backend, under a first-life grant labelled `import` (as bootDispatch's import
 * does). The census walks commit key -> manifest -> `refsOf` descent, checking every named unit exists, frames and matches
 * its Ref (length and CRC), and counts units and bytes per type, per group and per character. Two save passes then run
 * through the real `createSaveEncoder` plan, `commitRequest().build` and `acknowledge`: one with nothing marked and one with a
 * single character marked and edited. The .bin writer (c806-bin-write.mjs) is checked on a tiny library by decoding its
 * output with the app's `decodeRisuSave`.
 *
 * Run (from the repo root; name this one file, never the whole folder: a folder run rewrites golden fixtures):
 *   npx --no-install vitest run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/c806-census.harness.ts
 *
 * Without C806_SCALE or C806_SWEEP only the self-checks run (5 characters x 2 chats). Environment:
 *   C806_SCALE=1            run the census at C806_CHARACTERS (1000), C806_CHATS (20), C806_MEDIAN (messages per chat median),
 *                           C806_MODULES (180), C806_ARCHIVE on|off; outputs go to <C806_OUT_ROOT>/<C806_TAG>/
 *   C806_SWEEP=0.5,1,2      stream the library at each median and total the character JSON bytes (no import)
 *   C806_OUT_ROOT           default <os temp>/risu-b715/b61/c806/runs/stage0; never inside the repository
 *   C806_FAULT=<name>       fault knob that must turn a self-check red: drop-chat (T0a), unseeded (T0b), drop-unit and
 *                           flip-bytes (T0c), bin-corrupt (T0d)
 *   C806_RSS_LIMIT_MB, C806_MIN_FREE_MB   memory guard: stop before a swap-bound run (default 14336 and 3072)
 * Scale runs expect NODE_OPTIONS=--max-old-space-size=16384; the harness asserts the heap limit took.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as v8 from 'node:v8'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

//#region module mocks, as in bootImport.test.ts
vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) }) },
}))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) },
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: true }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock(import('src/ts/alert'), () => ({ alertNormalWait: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/alert'))
vi.mock('src/ts/process/coldUnitLocation', () => ({
    coldUnitKeyOfStoreKey: (key: string) => {
        const name = key.slice('coldstorage/'.length)
        return key.startsWith('coldstorage/') && !name.includes('/') ? name : null
    },
}))
//#endregion

import { createMemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { createKeyMint } from 'src/ts/storage/store2/commit'
import { encodeDatabase, previousFrom } from 'src/ts/storage/store2/codec'
import { firstLifeGrant } from 'src/ts/storage/store2/firstLife'
import { decodeFrame, keyOfRef, readUnit, refOfFrame, refsOf, UNIT_TYPE, type Manifest, type Ref, type UnitType } from 'src/ts/storage/store2/format'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
import { bootImportLegacyTree } from 'src/ts/storage/store2/legacy/bootImport'
import { freshOwnerId } from 'src/ts/storage/store2/owner'
import { createSaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import { seededEnv } from 'src/ts/storage/tests/store2/codecFixtures'
import type { Database } from 'src/ts/storage/database.svelte'
// @ts-expect-error - plain ESM tooling files without type declarations
import { buildLibrary, charactersDigest, characterJsonBytes, buildCharacter, databaseDigest, libraryCounts, normalizeParams, GENERATOR_ID } from './c806-library.mjs'
// @ts-expect-error - plain ESM tooling files without type declarations
import { SIDECAR_SUFFIX, writeBin } from './c806-bin-write.mjs'

//#region configuration
const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HARNESS_DIR, '..', '..', '..')
const FAULT = process.env.C806_FAULT ?? ''
const SCALE = process.env.C806_SCALE === '1'
const SWEEP = process.env.C806_SWEEP ?? ''
const TAG = process.env.C806_TAG ?? (SCALE ? 'scale' : 'selfcheck')
const OUT_ROOT = process.env.C806_OUT_ROOT ?? path.join(os.tmpdir(), 'risu-b715', 'b61', 'c806', 'runs', 'stage0')
const RSS_LIMIT = Number(process.env.C806_RSS_LIMIT_MB ?? '14336') * 1024 * 1024
const MIN_FREE = Number(process.env.C806_MIN_FREE_MB ?? '3072') * 1024 * 1024
const MIB = 1024 * 1024
const PASS_NOW = 1_700_000_000_000
const EDIT_TEXT = ' [edited]'
//#endregion

//#region memory guard
const guardSamples: { label: string, rssMiB: number, heapUsedMiB: number, freeMiB: number }[] = []
const peak = { rss: 0, heapUsed: 0, minFree: Number.POSITIVE_INFINITY, label: '' }

/** Records the process's memory and stops the run, with the label, before it becomes swap-bound. */
function guard(label: string): void {
    const rss = process.memoryUsage().rss
    const heapUsed = v8.getHeapStatistics().used_heap_size
    const free = os.freemem()
    if (rss > peak.rss) {
        peak.rss = rss
        peak.label = label
    }
    peak.heapUsed = Math.max(peak.heapUsed, heapUsed)
    peak.minFree = Math.min(peak.minFree, free)
    guardSamples.push({ label, rssMiB: Math.round(rss / MIB), heapUsedMiB: Math.round(heapUsed / MIB), freeMiB: Math.round(free / MIB) })
    if (rss > RSS_LIMIT || free < MIN_FREE) {
        throw new Error(`MEMORY_GUARD at ${label}: rss ${Math.round(rss / MIB)} MiB (limit ${Math.round(RSS_LIMIT / MIB)}), free ${Math.round(free / MIB)} MiB (floor ${Math.round(MIN_FREE / MIB)})`)
    }
}
//#endregion

//#region walk and census
interface WalkFaults {
    /** Do not report a unit the walk cannot read (turns T0c red). */
    skipMissing?: boolean
    /** Do not check frames and Refs (turns T0c red). */
    skipFrame?: boolean
}

interface Stat { count: number, bytes: number, min: number, p50: number, p95: number, max: number }

interface CharacterRow {
    chaId: string
    units: number
    bytes: number
    chats: number
    chunkUnits: number
    messages: number
}

interface Census {
    manifestKey: string
    problems: string[]
    totals: { units: number, bytes: number }
    byType: Record<string, Stat>
    shards: { count: number, bytes: number, perShard: Stat | null }
    fixed: { units: number, bytes: number }
    modules: { count: number, units: number, bytes: number }
    characters: { count: number, units: number, bytes: number, perCharacter: Stat | null, rows: CharacterRow[] }
    chats: number
    messages: number
    configEnabledModules: number | null
    configArchiveCharacters: boolean | null
}

const TYPE_NAME: Record<number, string> = Object.fromEntries(Object.entries(UNIT_TYPE).map(([name, id]) => [id, name]))
const PARSED_TYPES: ReadonlySet<number> = new Set<number>([
    UNIT_TYPE.manifest, UNIT_TYPE.shard, UNIT_TYPE.moduleIndex, UNIT_TYPE.moduleBucket, UNIT_TYPE.pluginStorageBucket, UNIT_TYPE.chatChunk, UNIT_TYPE.configRoot,
])

function statOf(sizes: number[]): Stat {
    const sorted = [...sizes].sort((a, b) => a - b)
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
    return { count: sorted.length, bytes: sorted.reduce((sum, n) => sum + n, 0), min: sorted[0], p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] }
}

interface WalkItem {
    key: string
    ref: Ref | null
    group: 'fixed' | 'shard' | 'module' | 'character'
    chaId?: string
}

async function walkCensus(backend: MemoryBackend, faults: WalkFaults = {}): Promise<Census> {
    const problems: string[] = []
    const commit = classifyCommitRead(await backend.readCommit())
    if (commit.status !== 'parsed' || commit.value.current === null) {
        throw new Error(`The commit key is ${commit.status}, or names no current manifest.`)
    }
    const manifestKey = commit.value.current.key
    const sizesByType = new Map<number, number[]>()
    const groups = { fixed: { units: 0, bytes: 0 }, shard: { units: 0, bytes: 0 }, module: { units: 0, bytes: 0 }, character: { units: 0, bytes: 0 } }
    const shardSizes: number[] = []
    const rows = new Map<string, CharacterRow>()
    const rowOf = (chaId: string) => {
        let row = rows.get(chaId)
        if (row === undefined) {
            row = { chaId, units: 0, bytes: 0, chats: 0, chunkUnits: 0, messages: 0 }
            rows.set(chaId, row)
        }
        return row
    }
    let chats = 0
    let messages = 0
    let moduleEntries = 0
    let enabled: number | null = null
    let archive: boolean | null = null
    const seen = new Set<string>([manifestKey])
    let level: WalkItem[] = [{ key: manifestKey, ref: null, group: 'fixed' }]

    while (level.length > 0) {
        const next: WalkItem[] = []
        for (let start = 0; start < level.length; start += 256) {
            const batch = level.slice(start, start + 256)
            const read = await backend.readUnits(batch.map(item => item.key))
            for (const item of batch) {
                const bytes = read.get(item.key) ?? null
                if (bytes === null) {
                    if (!faults.skipMissing) {
                        problems.push(`missing: ${item.key}`)
                    }
                    continue
                }
                const frame = decodeFrame(bytes)
                if (!faults.skipFrame) {
                    if (frame.status !== 'ok') {
                        problems.push(`damaged frame: ${item.key}`)
                        continue
                    }
                    if (item.ref !== null) {
                        const actual = refOfFrame(item.key, bytes)
                        if (actual[1] !== item.ref[1] || actual[2] !== item.ref[2]) {
                            problems.push(`ref mismatch (bytes or crc): ${item.key}`)
                            continue
                        }
                    }
                }
                if (frame.status !== 'ok') {
                    continue
                }
                const type = frame.type as number
                const size = bytes.length
                const sizes = sizesByType.get(type)
                if (sizes === undefined) {
                    sizesByType.set(type, [size])
                } else {
                    sizes.push(size)
                }
                groups[item.group].units++
                groups[item.group].bytes += size
                if (type === UNIT_TYPE.shard) {
                    shardSizes.push(size)
                }
                if (item.chaId !== undefined) {
                    const row = rowOf(item.chaId)
                    row.units++
                    row.bytes += size
                    if (type === UNIT_TYPE.chatChunk) {
                        row.chunkUnits++
                    }
                }
                if (!PARSED_TYPES.has(type)) {
                    if (type === UNIT_TYPE.chatCore) {
                        chats++
                    }
                    continue
                }
                const parsed = readUnit(bytes, type as UnitType)
                if (parsed.status !== 'ok') {
                    problems.push(`unreadable ${TYPE_NAME[type]}: ${item.key}: ${parsed.status}`)
                    continue
                }
                const body = parsed.value.body as unknown as Record<string, unknown>
                if (type === UNIT_TYPE.chatChunk) {
                    const count = (body.msgs as unknown[]).length
                    messages += count
                    if (item.chaId !== undefined) {
                        rowOf(item.chaId).messages += count
                    }
                    continue
                }
                if (type === UNIT_TYPE.configRoot) {
                    const fields = body.f as Record<string, unknown> | undefined
                    enabled = Array.isArray(fields?.enabledModules) ? (fields.enabledModules as unknown[]).length : null
                    archive = typeof fields?.archiveCharacters === 'boolean' ? fields.archiveCharacters : null
                    continue
                }
                if (type === UNIT_TYPE.moduleIndex || type === UNIT_TYPE.moduleBucket) {
                    moduleEntries += Array.isArray(body.entries) ? body.entries.length : 0
                }
                const enqueue = (targets: ReturnType<typeof refsOf>, group: WalkItem['group'], chaId?: string, chatHolder?: string) => {
                    for (const target of targets) {
                        const key = `store2/${target.tail}`
                        if (seen.has(key)) {
                            continue
                        }
                        seen.add(key)
                        next.push({ key, ref: [target.tail, target.bytes ?? 0, target.crc ?? 0] as unknown as Ref, group, chaId })
                        if (chatHolder !== undefined && target.path.endsWith('chats[].core')) {
                            rowOf(chatHolder).chats++
                        }
                    }
                }
                if (type === UNIT_TYPE.shard) {
                    for (const entry of (body.entries as Record<string, unknown>[])) {
                        const chaId = entry.chaId as string
                        rowOf(chaId)
                        enqueue(refsOf(UNIT_TYPE.shard, { entries: [entry] }), 'character', chaId, chaId)
                    }
                    continue
                }
                const group = type === UNIT_TYPE.moduleIndex || type === UNIT_TYPE.moduleBucket ? 'module' : 'fixed'
                enqueue(refsOf(type as UnitType, body), item.group === 'fixed' && type === UNIT_TYPE.manifest ? 'fixed' : group)
                if (type === UNIT_TYPE.manifest) {
                    // the shards are named by the manifest but belong to their own group
                    const manifest = body as unknown as Manifest
                    for (const ref of manifest.shards) {
                        const found = next.find(entry => entry.key === keyOfRef(ref))
                        if (found !== undefined) {
                            found.group = 'shard'
                        }
                    }
                }
            }
        }
        level = next
    }
    const byType: Record<string, Stat> = {}
    let units = 0
    let total = 0
    for (const [type, sizes] of [...sizesByType.entries()].sort((a, b) => a[0] - b[0])) {
        byType[TYPE_NAME[type] ?? String(type)] = statOf(sizes)
        units += sizes.length
        total += sizes.reduce((sum, n) => sum + n, 0)
    }
    const characterRows = [...rows.values()]
    return {
        manifestKey, problems, totals: { units, bytes: total }, byType,
        shards: { count: shardSizes.length, bytes: groups.shard.bytes + 0, perShard: shardSizes.length > 0 ? statOf(shardSizes) : null },
        fixed: groups.fixed,
        modules: { count: moduleEntries, units: groups.module.units, bytes: groups.module.bytes },
        characters: {
            count: characterRows.length, units: groups.character.units, bytes: groups.character.bytes,
            perCharacter: characterRows.length > 0 ? statOf(characterRows.map(row => row.bytes)) : null, rows: characterRows,
        },
        chats, messages, configEnabledModules: enabled, configArchiveCharacters: archive,
    }
}
//#endregion

//#region import and passes
interface ImportTimings {
    phases: { phase: string, atMs: number }[]
    importMs: number
    status: string
}

/** Imports `db` into a fresh memory backend exactly as the boot import does. The tree `db` is consumed. */
async function importLibrary(db: Database): Promise<{ backend: MemoryBackend, timings: ImportTimings }> {
    const backend = createMemoryBackend()
    const store = createMemoryByteStore()
    const granted = firstLifeGrant({ decision: { row: 1, mode: 'first-life', action: 'seed' }, commitRead: await backend.readCommit(), startupClear: null }, { label: 'import' })
    if (granted.status !== 'granted') {
        throw new Error('No first-life grant.')
    }
    const phases: ImportTimings['phases'] = []
    const begun = performance.now()
    const result = await bootImportLegacyTree({
        source: { tree: db },
        reader: { read: async () => ({ status: 'missing' }) },
        backend,
        entry: { kind: 'first-life', grant: granted.grant },
        owner: freshOwnerId(),
        lists: createListDerivation(),
        oldData: { store, listBackupTimes: async () => [] },
        upstreamMainFile: async () => false,
    }, {
        confirmIncomplete: async () => true,
        onPhase: phase => {
            phases.push({ phase, atMs: Math.round(performance.now() - begun) })
            guard(`import ${phase}`)
        },
    })
    const importMs = Math.round(performance.now() - begun)
    if (result.status !== 'installed') {
        throw new Error(`The boot import ended ${result.status}.`)
    }
    return { backend, timings: { phases, importMs, status: result.status } }
}

interface PassRow {
    name: string
    planMs: number
    buildMs: number
    acknowledgeMs: number
    writtenUnits: number
    writtenBytes: number
    writtenByType: Record<string, number>
}

async function savePass(db: Database, base: ReturnType<typeof previousFrom>, name: string, marked: string[], edit?: () => () => void): Promise<PassRow> {
    const revert = edit?.()
    try {
        const encoder = createSaveEncoder({ previous: base, lists: createListDerivation(), env: seededEnv(77), now: () => PASS_NOW })
        const t0 = performance.now()
        const plan = await encoder.plan(db, { marked: new Set(marked), modules: false, whole: false })
        const t1 = performance.now()
        const { mint } = createKeyMint(seededEnv(900), null)
        const built = await plan.commitRequest().build({ mint, seq: 2, now: PASS_NOW })
        const t2 = performance.now()
        plan.acknowledge()
        const t3 = performance.now()
        const typeOfKey = new Map<string, number>()
        for (const [, unit] of encoder.acknowledged().units) {
            typeOfKey.set(unit.key, unit.type)
        }
        const writtenByType: Record<string, number> = {}
        let writtenBytes = 0
        for (const unit of built.units) {
            const type = typeOfKey.get(unit.key)
            const label = type === undefined ? 'unnamed' : (TYPE_NAME[type] ?? String(type))
            writtenByType[label] = (writtenByType[label] ?? 0) + 1
            writtenBytes += unit.bytes.length
        }
        return {
            name, planMs: Math.round(t1 - t0), buildMs: Math.round(t2 - t1), acknowledgeMs: Math.round(t3 - t2),
            writtenUnits: built.units.length, writtenBytes, writtenByType,
        }
    } finally {
        revert?.()
    }
}

async function encoderPasses(params: Record<string, unknown>): Promise<{ baseEncodeMs: number, passes: PassRow[] }> {
    const db = buildLibrary(params) as Database
    guard('passes: library built')
    const t0 = performance.now()
    const base = previousFrom(encodeDatabase(db, { env: seededEnv(1), lists: createListDerivation(), seq: 1, createdAt: PASS_NOW }))
    const baseEncodeMs = Math.round(performance.now() - t0)
    guard('passes: base encoded')
    const passes: PassRow[] = [await savePass(db, base, 'unmarked', [])]
    guard('passes: unmarked done')
    const target = db.characters[Math.floor(db.characters.length / 2)] as unknown as Record<string, unknown> & { chaId: string }
    passes.push(await savePass(db, base, 'one-character-marked', [target.chaId], () => {
        const before = target.desc as string
        target.desc = before + EDIT_TEXT
        return () => { target.desc = before }
    }))
    guard('passes: marked done')
    return { baseEncodeMs, passes }
}
//#endregion

//#region pipeline
interface PipelineResult {
    expected: Record<string, unknown>
    census: Census
    importTimings: ImportTimings
    buildMs: number
    walkMs: number
    passes: { baseEncodeMs: number, passes: PassRow[] } | null
}

async function pipeline(rawParams: Record<string, unknown>, options: { faults?: WalkFaults, dropChat?: boolean, passes: boolean }): Promise<PipelineResult> {
    const params = normalizeParams(rawParams) as Record<string, number | boolean>
    const t0 = performance.now()
    const db = buildLibrary(params, { onCharacter: (i: number) => { if (i % 50 === 0) guard(`build character ${i}`) } }) as Database & { characters: { chats: unknown[] }[] }
    const buildMs = Math.round(performance.now() - t0)
    guard('library built')
    const counts = libraryCounts(db)
    const expected = {
        params,
        characters: params.characters,
        chats: (params.characters as number) * (params.chatsPerCharacter as number),
        messages: counts.messages,
        modules: params.modules,
        enabledModules: Math.min(3, params.modules as number),
        archiveCharacters: params.archiveCharacters,
    }
    if (options.dropChat) {
        db.characters[0].chats.pop()
    }
    const imported = await importLibrary(db)
    guard('imported')
    const w0 = performance.now()
    const census = await walkCensus(imported.backend, options.faults)
    const walkMs = Math.round(performance.now() - w0)
    guard('census walked')
    const passes = options.passes ? await encoderPasses(params) : null
    return { expected, census, importTimings: imported.timings, buildMs, walkMs, passes }
}

interface Check { id: string, expected: unknown, actual: unknown, ok: boolean }

function checksOf(result: PipelineResult): Check[] {
    const { expected, census } = result
    const row = (id: string, want: unknown, got: unknown): Check => ({ id, expected: want, actual: got, ok: want === got })
    return [
        row('walk problems', 0, census.problems.length),
        row('characters', expected.characters, census.characters.count),
        row('chats', expected.chats, census.chats),
        row('decoded messages', expected.messages, census.messages),
        row('modules', expected.modules, census.modules.count),
        row('enabled modules', expected.enabledModules, census.configEnabledModules),
        row('archiveCharacters', expected.archiveCharacters, census.configArchiveCharacters),
    ]
}
//#endregion

//#region provenance and output
function sha256OfFile(file: string): string {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function git(...args: string[]): string {
    const out = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' })
    return (out.stdout ?? '').trim()
}

function outsideRepo(dir: string): string {
    const resolved = path.resolve(dir)
    const rel = path.relative(fs.realpathSync(REPO_ROOT), fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved)
    if (!(rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel))) {
        throw new Error(`refusing to write inside the repository: ${resolved}`)
    }
    return resolved
}

function provenance(extra: Record<string, unknown>): Record<string, unknown> {
    const heap = v8.getHeapStatistics()
    return {
        base: git('rev-parse', 'HEAD'),
        statusAgentsToolsAndSrc: git('status', '--short', 'Agents/Tools', 'src').split('\n'),
        tools: Object.fromEntries(['c806-library.mjs', 'c806-bin-write.mjs', 'c806-census.harness.ts'].map(name => [name, sha256OfFile(path.join(HARNESS_DIR, name))])),
        generator: GENERATOR_ID, fault: FAULT || null, node: process.version, nodeOptions: process.env.NODE_OPTIONS ?? null,
        heapSizeLimitMiB: Math.round(heap.heap_size_limit / MIB),
        cpu: os.cpus()[0]?.model, cpus: os.cpus().length, totalRamMiB: Math.round(os.totalmem() / MIB),
        caveat: 'Diagnostic only: numbers come from a best-case desktop (i9-13900KF class) with a synthetic library; they are not thresholds and say nothing about phones or a Pi.',
        ...extra,
    }
}

function writeJson(dir: string, name: string, value: unknown): void {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2))
}

/** The heap limit the process actually got, against what NODE_OPTIONS asked for. */
function assertHeapLimit(): void {
    const asked = /--max-old-space-size=(\d+)/.exec(process.env.NODE_OPTIONS ?? '')
    if (asked === null) {
        throw new Error('NODE_OPTIONS must carry --max-old-space-size for a scale run.')
    }
    const limit = v8.getHeapStatistics().heap_size_limit
    expect(limit, 'heap_size_limit took the requested value').toBeGreaterThanOrEqual(Number(asked[1]) * MIB * 0.9)
}
//#endregion

//#region self-checks (5 characters x 2 chats)
const TINY = { seed: 806, characters: 5, chatsPerCharacter: 2, messagesPerChat: 3, modules: 8, archiveCharacters: true }

let decodeRisuSave: typeof import('src/ts/storage/risuSave').decodeRisuSave

beforeAll(async () => {
    // decodeRisuSave loads lazily with global Buffer removed, as the app's webview runs without it.
    const savedBuffer = globalThis.Buffer
    // @ts-expect-error - simulating the Buffer-less webview risuSave.ts runs in; restored right below.
    delete globalThis.Buffer
    try {
        decodeRisuSave = (await import('src/ts/storage/risuSave')).decodeRisuSave
    } finally {
        globalThis.Buffer = savedBuffer
    }
})

describe('c806 self-checks', () => {
    test('T0a: the census of the imported tree equals the parameters', async () => {
        const result = await pipeline(TINY, { dropChat: FAULT === 'drop-chat', passes: true })
        const failed = checksOf(result).filter(check => !check.ok)
        expect(failed).toEqual([])
        expect(result.passes?.passes.map(pass => pass.name)).toEqual(['unmarked', 'one-character-marked'])
        // the marked pass writes the edited character's units and the unmarked pass none of them
        expect(result.passes!.passes[1].writtenUnits).toBeGreaterThan(result.passes!.passes[0].writtenUnits)
    })

    test('T0b: the builder is deterministic and prefix-stable', () => {
        const first = buildLibrary(TINY)
        const secondSeed = FAULT === 'unseeded' ? Math.floor(Math.random() * 0xFFFFFFFF) : TINY.seed
        const second = buildLibrary({ ...TINY, seed: secondSeed })
        expect(databaseDigest(second)).toBe(databaseDigest(first))
        const larger = buildLibrary({ ...TINY, characters: 8, seed: secondSeed })
        expect(charactersDigest(larger, 0, 5)).toBe(charactersDigest(first, 0, 5))
        expect(larger.modules.slice(0, 8)).toEqual(first.modules)
        expect(buildCharacter(TINY, 3)).toEqual(first.characters[3])
        expect(() => normalizeParams({ ...TINY, archiveCharacters: undefined })).toThrow(/archiveCharacters/)
    })

    test('T0c: the walk detects a missing and a damaged unit', async () => {
        const imported = await importLibrary(buildLibrary(TINY) as Database)
        const faults: WalkFaults = { skipMissing: FAULT === 'drop-unit', skipFrame: FAULT === 'flip-bytes' }
        const clean = await walkCensus(imported.backend, faults)
        expect(clean.problems).toEqual([])
        const chunkKeys = (await imported.backend.listStore2()).filter(key => key !== 'store2-commit')
        const manifestKey = clean.manifestKey
        const victims = chunkKeys.filter(key => key !== manifestKey)
        const [missingKey, damagedKey] = [victims[Math.floor(victims.length / 3)], victims[Math.floor(victims.length * 2 / 3)]]
        const damaged = (await imported.backend.readUnits([damagedKey])).get(damagedKey) as Uint8Array
        const flipped = Uint8Array.from(damaged)
        flipped[Math.floor(flipped.length / 2)] ^= 0xFF
        imported.backend.poke(missingKey, null)
        imported.backend.poke(damagedKey, flipped)
        const broken = await walkCensus(imported.backend, faults)
        expect(broken.problems.some(problem => problem.startsWith('missing: ') && problem.endsWith(missingKey))).toBe(true)
        expect(broken.problems.some(problem => problem.includes(damagedKey))).toBe(true)
    })

    test('T0d: the .bin writer round-trips through the app decoder and refuses the repository', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c806-bin-'))
        try {
            const db = buildLibrary(TINY)
            const out = path.join(dir, 'tiny.bin')
            const written = writeBin({ database: db, out, params: TINY })
            const sidecar = JSON.parse(fs.readFileSync(out + SIDECAR_SUFFIX, 'utf8'))
            const bytes = fs.readFileSync(out)
            expect(sidecar.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
            expect(sidecar.generator).toBe(GENERATOR_ID)
            expect(written.fileBytes).toBe(bytes.length)
            if (FAULT === 'bin-corrupt') {
                bytes[bytes.length - 20] ^= 0xFF
            }
            const nameLength = bytes.readUInt32LE(0)
            expect(bytes.subarray(4, 4 + nameLength).toString('utf8')).toBe('database.risudat')
            const dataLength = bytes.readUInt32LE(4 + nameLength)
            const data = new Uint8Array(bytes.subarray(8 + nameLength, 8 + nameLength + dataLength))
            expect(8 + nameLength + dataLength).toBe(bytes.length)
            const decoded = await decodeRisuSave(data)
            expect(JSON.stringify(decoded)).toBe(JSON.stringify(db))
            const insideRepo = path.join(REPO_ROOT, 'c806-must-not-exist.bin')
            expect(() => writeBin({ database: db, out: insideRepo, params: TINY })).toThrow(/inside the repository/)
            expect(fs.existsSync(insideRepo)).toBe(false)
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })
})
//#endregion

//#region scale census and size sweep
describe.skipIf(!SCALE)('c806 scale census', () => {
    test('census, timings and checks of one library', { timeout: 6 * 60 * 60 * 1000 }, async () => {
        assertHeapLimit()
        const dir = outsideRepo(path.join(OUT_ROOT, TAG))
        fs.mkdirSync(dir, { recursive: true })
        const ticker = setInterval(() => guard('tick'), 1000)
        ticker.unref()
        const archive = process.env.C806_ARCHIVE ?? 'on'
        const params = {
            seed: Number(process.env.C806_SEED ?? '806'),
            characters: Number(process.env.C806_CHARACTERS ?? '1000'),
            chatsPerCharacter: Number(process.env.C806_CHATS ?? '20'),
            messagesPerChat: Number(process.env.C806_MEDIAN ?? '1'),
            modules: Number(process.env.C806_MODULES ?? '180'),
            archiveCharacters: archive !== 'off',
        }
        writeJson(dir, 'run.json', provenance({ tag: TAG, params, archive }))
        let result: PipelineResult
        try {
            result = await pipeline(params, { passes: true })
        } finally {
            clearInterval(ticker)
            writeJson(dir, 'memory.json', { peakRssMiB: Math.round(peak.rss / MIB), peakRssAt: peak.label, peakHeapUsedMiB: Math.round(peak.heapUsed / MIB), minFreeMiB: Math.round(peak.minFree / MIB), samples: guardSamples })
        }
        const checks = checksOf(result)
        writeJson(dir, 'census.json', { expected: result.expected, census: result.census })
        writeJson(dir, 'timings.json', { buildMs: result.buildMs, importMs: result.importTimings.importMs, phases: result.importTimings.phases, walkMs: result.walkMs, passes: result.passes })
        writeJson(dir, 'checks.json', checks)
        expect(checks.filter(check => !check.ok)).toEqual([])
    })
})

describe.skipIf(SWEEP === '')('c806 size sweep', () => {
    test('character JSON bytes per message median, streamed', { timeout: 6 * 60 * 60 * 1000 }, async () => {
        assertHeapLimit()
        const dir = outsideRepo(path.join(OUT_ROOT, TAG))
        fs.mkdirSync(dir, { recursive: true })
        const characters = Number(process.env.C806_CHARACTERS ?? '1000')
        const rows: Record<string, unknown>[] = []
        for (const median of SWEEP.split(',').map(Number)) {
            const params = { seed: 806, characters, chatsPerCharacter: Number(process.env.C806_CHATS ?? '20'), messagesPerChat: median, modules: 0, archiveCharacters: true }
            const t0 = performance.now()
            let characterBytes = 0
            let messages = 0
            for (let i = 0; i < characters; i++) {
                const character = buildCharacter(params, i)
                characterBytes += characterJsonBytes(character)
                for (const chat of character.chats) {
                    messages += chat.message.length
                }
                if (i % 50 === 0) {
                    guard(`sweep ${median} character ${i}`)
                }
            }
            rows.push({ median, characters, characterJsonMiB: +(characterBytes / MIB).toFixed(1), messages, messagesPerChat: +(messages / (characters * params.chatsPerCharacter)).toFixed(2), ms: Math.round(performance.now() - t0) })
        }
        writeJson(dir, 'sweep.json', { tool: GENERATOR_ID, rows })
        writeJson(dir, 'run.json', provenance({ tag: TAG, sweep: SWEEP }))
        expect(rows.length).toBeGreaterThan(0)
    })
})

afterAll(() => {
    if (FAULT !== '') {
        console.log(`c806 fault knob set: ${FAULT}`)
    }
})
//#endregion
