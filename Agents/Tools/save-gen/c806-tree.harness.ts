// @vitest-environment node
/**
 * CHORE-806 stage 1 (profiling tooling, diagnostic; not a regression test): writes a c806 library as a store2 tree on disk and
 * takes the offline census of any such tree.
 *
 * Modes (C806_MODE), one per run; without it only the self-checks run (5 characters x 2 chats):
 *   write    route A (C806_ROUTE=A, default): the stage 0 producer (c806-library.mjs, the app's own boot import on the memory
 *            backend), then the commit key and every store2 unit are streamed in batches into <C806_ROOT>/data/<tag>/pristine/ as
 *            files named hex(utf8 key), the names the Node server uses under save/. Route C (C806_ROUTE=node): the same producer
 *            over createNodeBackend(createNodeHttpStore) against a scratch server started from C806_DIST; the tree then lives in
 *            that server's save/. Both write tree.json (params, commit key hash, counts) into the run folder.
 *   census   offline census of C806_TREE_DIR (a pristine tree or a server's save/): commit key -> manifest -> refsOf descent,
 *            checking every named unit exists, frames and matches its Ref; writes census.json.
 *   compare  C806_CENSUS_A and C806_CENSUS_B (census.json files): counts per unit type equal, totals within 1%; writes checks.json.
 *   bin      writes a .bin of the same library (c806-bin-write.mjs) to C806_BIN_OUT, with its sidecar.
 * Parameters as in c806-census.harness.ts: C806_SEED, C806_CHARACTERS (default 3), C806_CHATS (2), C806_MEDIAN (3),
 * C806_MODULES (8), C806_ARCHIVE on|off (on), C806_HEAVY=index,chats,messages (one character with its own chat and message counts; unset
 * means the plain library, whose tree is unchanged). C806_TAG names the run; outputs go to <C806_OUT_ROOT>/<tag>/ (default
 * <os temp>/risu-b715/b61/c806/runs/stage1), never inside the repository.
 *
 * Run (from the repo root; name this one file, never the whole folder: a folder run rewrites golden fixtures):
 *   npx --no-install vitest run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/c806-tree.harness.ts
 *
 * C806_FAULT=<name> must turn a check red: drop-chat (T1c: one chat missing on the written side), drop-unit and bad-hex (T1a:
 * a unit file missing / named with UTF-16 hex, so the offline census differs from the in-memory one), heavy-off (T2a: the library is
 * built without its heavy character while the recorded parameters still name it).
 * Scale writes expect NODE_OPTIONS=--max-old-space-size=16384.
 */
import { afterAll, describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as v8 from 'node:v8'
import { createHash, webcrypto } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

//#region module mocks, as in c806-census.harness.ts
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
import { createMemoryBackend } from 'src/ts/storage/store2/backend'
import { createNodeBackend } from 'src/ts/storage/store2/backend/node'
import type { Store2Backend, Store2Read } from 'src/ts/storage/store2/backend/types'
import { createNodeHttpStore } from 'src/ts/storage/store/nodeHttpStore'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { firstLifeGrant } from 'src/ts/storage/store2/firstLife'
import { decodeFrame, keyOfRef, readUnit, refOfFrame, refsOf, UNIT_TYPE, type Manifest, type Ref, type UnitType } from 'src/ts/storage/store2/format'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
import { bootImportLegacyTree } from 'src/ts/storage/store2/legacy/bootImport'
import { freshOwnerId } from 'src/ts/storage/store2/owner'
import type { Database } from 'src/ts/storage/database.svelte'
// @ts-expect-error - plain ESM tooling files without type declarations
import { buildLibrary, libraryCounts, normalizeParams, charactersDigest, heavyExpected, GENERATOR_ID } from './c806-library.mjs'
// @ts-expect-error - plain ESM tooling files without type declarations
import { writeBin } from './c806-bin-write.mjs'
// @ts-expect-error - plain ESM tooling files without type declarations
import { startServer, prepareDist, dirsOf, commitKeyHash } from '../node-scale/c806-server.mjs'

//#region configuration
const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HARNESS_DIR, '..', '..', '..')
const FAULT = process.env.C806_FAULT ?? ''
const MODE = process.env.C806_MODE ?? ''
const ROUTE = process.env.C806_ROUTE ?? 'A'
const ROOT = path.resolve(process.env.C806_ROOT ?? path.join(os.tmpdir(), 'risu-b715', 'b61', 'c806'))
const TAG = process.env.C806_TAG ?? 'tree'
const OUT_ROOT = process.env.C806_OUT_ROOT ?? path.join(ROOT, 'runs', 'stage1')
const RSS_LIMIT = Number(process.env.C806_RSS_LIMIT_MB ?? '14336') * 1024 * 1024
const MIN_FREE = Number(process.env.C806_MIN_FREE_MB ?? '3072') * 1024 * 1024
const MIB = 1024 * 1024
const BATCH = 256
/** Per-character unit keys in census.json: the page runner compares what an opened character read with them. C806_ROW_KEYS=0 leaves them out. */
const ROW_KEYS = process.env.C806_ROW_KEYS !== '0'
const COMMIT_KEY = 'store2-commit'
const FENCE_KEY = 'store2-fence'
//#endregion

//#region helpers
function guard(label: string): void {
    const rss = process.memoryUsage().rss
    const free = os.freemem()
    if (rss > RSS_LIMIT || free < MIN_FREE) {
        throw new Error(`MEMORY_GUARD at ${label}: rss ${Math.round(rss / MIB)} MiB (limit ${Math.round(RSS_LIMIT / MIB)}), free ${Math.round(free / MIB)} MiB (floor ${Math.round(MIN_FREE / MIB)})`)
    }
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

function writeJson(dir: string, name: string, value: unknown): void {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2))
}

const hexOf = (key: string) => Buffer.from(key, 'utf8').toString('hex')
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** One character with its own chat and message counts (see c806-library.mjs); absent from the parameters of a plain library. */
interface HeavyParams { index: number, chatsPerCharacter: number, messagesPerChat: number, messageCountMax?: number }
type LibraryParams = Record<string, number | boolean | HeavyParams>

/** C806_HEAVY=index,chats,messages; unset means no heavy character. */
function heavyFromEnv(): HeavyParams | undefined {
    const text = process.env.C806_HEAVY
    if (text === undefined || text === '') {
        return undefined
    }
    const parts = text.split(',').map(Number)
    if (parts.length !== 3 || parts.some(part => !Number.isInteger(part) || part < 0)) {
        throw new Error(`C806_HEAVY must be index,chats,messages (non-negative integers): ${text}`)
    }
    return { index: parts[0], chatsPerCharacter: parts[1], messagesPerChat: parts[2] }
}

function paramsFromEnv(): LibraryParams {
    const heavy = heavyFromEnv()
    return normalizeParams({
        seed: Number(process.env.C806_SEED ?? '806'),
        characters: Number(process.env.C806_CHARACTERS ?? '3'),
        chatsPerCharacter: Number(process.env.C806_CHATS ?? '2'),
        messagesPerChat: Number(process.env.C806_MEDIAN ?? '3'),
        modules: Number(process.env.C806_MODULES ?? '8'),
        archiveCharacters: (process.env.C806_ARCHIVE ?? 'on') !== 'off',
        ...(heavy === undefined ? {} : { heavy }),
    }) as LibraryParams
}

/** The tool files a tree is made with, by path under the repository; their hashes go into run.json so a tree names its tools. */
const TOOL_FILES = [
    'Agents/Tools/save-gen/c806-tree.harness.ts', 'Agents/Tools/save-gen/c806-library.mjs', 'Agents/Tools/save-gen/c806-bin-write.mjs',
    'Agents/Tools/save-gen/c806-census.harness.ts', 'Agents/Tools/node-scale/c806-server.mjs', 'Agents/Tools/node-scale/c806-reqlog.cjs',
]

function toolSha256(): Record<string, string | null> {
    return Object.fromEntries(TOOL_FILES.map((file) => {
        const full = path.join(REPO_ROOT, file)
        return [file, fs.existsSync(full) ? sha256(fs.readFileSync(full)) : null]
    }))
}

function provenance(extra: Record<string, unknown>): Record<string, unknown> {
    return {
        base: git('rev-parse', 'HEAD'),
        statusAgentsToolsAndSrc: git('status', '--short', 'Agents/Tools', 'src').split('\n'),
        toolSha256: toolSha256(),
        generator: GENERATOR_ID, fault: FAULT || null, node: process.version, nodeOptions: process.env.NODE_OPTIONS ?? null,
        heapSizeLimitMiB: Math.round(v8.getHeapStatistics().heap_size_limit / MIB),
        cpu: os.cpus()[0]?.model, cpus: os.cpus().length, totalRamMiB: Math.round(os.totalmem() / MIB),
        caveat: 'Diagnostic only: numbers come from a best-case desktop (i9-13900KF class) with a synthetic library; they are not thresholds and say nothing about phones or a Pi.',
        ...extra,
    }
}
//#endregion

//#region producer: the boot import on a backend
type WalkBackend = Pick<Store2Backend, 'readCommit' | 'readUnits'>

/** Imports `db` into `backend` exactly as the boot import does. The tree `db` is consumed. */
async function importInto(db: Database, backend: Store2Backend): Promise<{ importMs: number }> {
    const store = createMemoryByteStore()
    const granted = firstLifeGrant({ decision: { row: 1, mode: 'first-life', action: 'seed' }, commitRead: await backend.readCommit(), startupClear: null }, { label: 'import' })
    if (granted.status !== 'granted') {
        throw new Error('No first-life grant.')
    }
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
        onPhase: phase => guard(`import ${phase}`),
    })
    if (result.status !== 'installed') {
        throw new Error(`The boot import ended ${result.status}.`)
    }
    return { importMs: Math.round(performance.now() - begun) }
}

function builtLibrary(params: LibraryParams): Database {
    // heavy-off: the tree is built plain while the recorded parameters still name the heavy character (T2a must see the difference)
    const { heavy: _heavy, ...withoutHeavy } = params
    const db = buildLibrary(FAULT === 'heavy-off' ? withoutHeavy : params, { onCharacter: (i: number) => { if (i % 50 === 0) guard(`build character ${i}`) } }) as Database & { characters: { chats: unknown[] }[] }
    if (FAULT === 'drop-chat') {
        db.characters[0].chats.pop()
    }
    return db
}
//#endregion

//#region route A writer
interface WrittenTree {
    dir: string
    files: number
    bytes: number
    commitHash: string | null
    fencePresent: boolean
    writeMs: number
}

/** Streams the commit key and every store2 unit of `backend` into `dir` as hex(utf8 key) files, a batch at a time (no snapshot copy). */
async function streamTreeToDir(backend: Store2Backend & { readFence: () => Promise<Store2Read> }, dir: string): Promise<WrittenTree> {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    const t0 = performance.now()
    const keys = await backend.listStore2()
    let files = 0
    let bytes = 0
    for (let start = 0; start < keys.length; start += BATCH) {
        const batch = keys.slice(start, start + BATCH)
        const read = await backend.readUnits(batch)
        for (const key of batch) {
            const unit = read.get(key)
            if (unit === null || unit === undefined) {
                throw new Error(`unit vanished while streaming: ${key}`)
            }
            let name = hexOf(key)
            if (FAULT === 'bad-hex' && files === Math.floor(keys.length / 2)) {
                name = Buffer.from(key, 'utf16le').toString('hex')
            }
            if (FAULT === 'drop-unit' && files === Math.floor(keys.length / 3)) {
                files++
                continue
            }
            fs.writeFileSync(path.join(dir, name), unit)
            files++
            bytes += unit.length
        }
        guard(`stream ${start}`)
    }
    const commit = await backend.readCommit()
    if (commit.bytes === null) {
        throw new Error('The imported tree has no commit key.')
    }
    fs.writeFileSync(path.join(dir, hexOf(COMMIT_KEY)), commit.bytes)
    files++
    bytes += commit.bytes.length
    const fence = await backend.readFence()
    return { dir, files, bytes, commitHash: sha256(commit.bytes), fencePresent: fence.bytes !== null, writeMs: Math.round(performance.now() - t0) }
}
//#endregion

//#region route C: a scratch server and its login
const b64u = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

async function loginKey(baseUrl: string): Promise<() => Promise<string>> {
    const { publicKey, privateKey } = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const pub = await webcrypto.subtle.exportKey('jwk', publicKey)
    const post = async (route: string, body: unknown) => {
        const response = await fetch(baseUrl + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        return { status: response.status, text: await response.text() }
    }
    const digest = (await post('/api/crypto', { data: 'c806-route-c-synthetic' })).text
    const set = await post('/api/set_password', { password: digest })
    const login = await post('/api/login', { password: digest, publicKey: pub })
    if (set.status !== 200 || login.status !== 200) {
        throw new Error(`route C login failed: set ${set.status}, login ${login.status}`)
    }
    return async () => {
        const iat = Math.floor(Date.now() / 1000)
        const head = b64u({ alg: 'ES256', typ: 'JWT' })
        const payload = b64u({ iat, exp: iat + 3000, pub })
        const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, Buffer.from(`${head}.${payload}`))
        return `${head}.${payload}.${Buffer.from(signature).toString('base64url')}`
    }
}
//#endregion

//#region offline census (the walk of c806-census.harness.ts, over a directory)
interface Stat { count: number, bytes: number, min: number, p50: number, p95: number, max: number }
interface CharacterRow { chaId: string, units: number, bytes: number, chats: number, chunkUnits: number, messages: number, keys?: { key: string, type: string }[] }
interface Census {
    manifestKey: string
    problems: string[]
    foreignFiles: number
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

interface WalkItem { key: string, ref: Ref | null, group: 'fixed' | 'shard' | 'module' | 'character', chaId?: string }

/** The store keys a hex-named file stands for; a file whose name is not hex(utf8 key) of a store2 key or a top-level key is foreign. */
function storeKeyOfFileName(name: string): string | null {
    if (!/^(?:[0-9a-f]{2})+$/.test(name)) {
        return null
    }
    const key = Buffer.from(name, 'hex').toString('utf8')
    if (hexOf(key) !== name) {
        return null
    }
    return key.startsWith('store2/') || key === COMMIT_KEY || key === FENCE_KEY || key === 'store2-sweep' ? key : null
}

/** A read-only backend over a save-style directory: reads are file reads; a name that is not hex(utf8 key) is never found. */
function directoryBackend(dir: string): { backend: WalkBackend, foreignFiles: () => number } {
    const readFile = (key: string): Uint8Array | null => {
        const file = path.join(dir, hexOf(key))
        return fs.existsSync(file) ? new Uint8Array(fs.readFileSync(file)) : null
    }
    return {
        backend: {
            readCommit: async () => {
                const bytes = readFile(COMMIT_KEY)
                return { bytes, token: { kind: 'bytes', bytes } } as unknown as Store2Read
            },
            readUnits: async (keys) => new Map(keys.map(key => [key, readFile(key)] as const)),
        },
        foreignFiles: () => fs.readdirSync(dir).filter(name => !name.startsWith('__') && storeKeyOfFileName(name) === null).length,
    }
}

async function walkCensus(backend: WalkBackend): Promise<Census> {
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
            row = { chaId, units: 0, bytes: 0, chats: 0, chunkUnits: 0, messages: 0, keys: ROW_KEYS ? [] : undefined }
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
        for (let start = 0; start < level.length; start += BATCH) {
            const batch = level.slice(start, start + BATCH)
            const read = await backend.readUnits(batch.map(item => item.key))
            for (const item of batch) {
                const bytes = read.get(item.key) ?? null
                if (bytes === null) {
                    problems.push(`missing: ${item.key}`)
                    continue
                }
                const frame = decodeFrame(bytes)
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
                    row.keys?.push({ key: item.key, type: TYPE_NAME[type] ?? String(type) })
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
        manifestKey, problems, foreignFiles: 0, totals: { units, bytes: total }, byType,
        shards: { count: shardSizes.length, bytes: groups.shard.bytes, perShard: shardSizes.length > 0 ? statOf(shardSizes) : null },
        fixed: groups.fixed,
        modules: { count: moduleEntries, units: groups.module.units, bytes: groups.module.bytes },
        characters: {
            count: characterRows.length, units: groups.character.units, bytes: groups.character.bytes,
            perCharacter: characterRows.length > 0 ? statOf(characterRows.map(row => row.bytes)) : null, rows: characterRows,
        },
        chats, messages, configEnabledModules: enabled, configArchiveCharacters: archive,
    }
}

/** The census of a directory; foreign files (names that are not hex(utf8 key)) are counted and reported as problems. */
async function censusOfDirectory(dir: string): Promise<Census> {
    const { backend, foreignFiles } = directoryBackend(dir)
    const census = await walkCensus(backend)
    census.foreignFiles = foreignFiles()
    if (census.foreignFiles > 0) {
        census.problems.push(`${census.foreignFiles} file(s) in the tree folder are not named hex(utf8 key)`)
    }
    return census
}

interface CensusDiff { ok: boolean, differences: string[] }

/** Counts per unit type must be equal; byte totals may differ by `tolerance` (a fraction). */
function diffCensus(a: Census, b: Census, tolerance: number): CensusDiff {
    const differences: string[] = []
    for (const name of new Set([...Object.keys(a.byType), ...Object.keys(b.byType)])) {
        const left = a.byType[name]?.count ?? 0
        const right = b.byType[name]?.count ?? 0
        if (left !== right) {
            differences.push(`${name} count ${left} vs ${right}`)
        }
    }
    for (const field of ['chats', 'messages', 'configEnabledModules', 'configArchiveCharacters'] as const) {
        if (a[field] !== b[field]) {
            differences.push(`${field} ${String(a[field])} vs ${String(b[field])}`)
        }
    }
    if (a.characters.count !== b.characters.count) {
        differences.push(`characters ${a.characters.count} vs ${b.characters.count}`)
    }
    if (a.modules.count !== b.modules.count) {
        differences.push(`modules ${a.modules.count} vs ${b.modules.count}`)
    }
    const larger = Math.max(a.totals.bytes, b.totals.bytes, 1)
    if (Math.abs(a.totals.bytes - b.totals.bytes) / larger > tolerance) {
        differences.push(`total bytes ${a.totals.bytes} vs ${b.totals.bytes} (over ${tolerance * 100}%)`)
    }
    if (a.problems.length > 0) {
        differences.push(`A has ${a.problems.length} problem(s): ${a.problems[0]}`)
    }
    if (b.problems.length > 0) {
        differences.push(`B has ${b.problems.length} problem(s): ${b.problems[0]}`)
    }
    return { ok: differences.length === 0, differences }
}
//#endregion

//#region self-checks (5 characters x 2 chats)
const TINY = { seed: 806, characters: 5, chatsPerCharacter: 2, messagesPerChat: 3, modules: 8, archiveCharacters: true }

describe.skipIf(MODE !== '')('c806 tree self-checks', () => {
    test('T1a: the offline census of a written route A tree equals the in-memory census', async () => {
        const backend = createMemoryBackend()
        const db = builtLibrary(normalizeParams(TINY) as LibraryParams)
        await importInto(db, backend)
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c806-tree-'))
        try {
            await streamTreeToDir(backend, dir)
            const offline = await censusOfDirectory(dir)
            const memoryCensus = await walkCensus(backend)
            expect(offline.problems).toEqual([])
            expect(diffCensus(offline, memoryCensus, 0).differences).toEqual([])
            expect(offline.totals).toEqual(memoryCensus.totals)
            expect(offline.byType).toEqual(memoryCensus.byType)
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    test('T1c: two trees of the same parameters compare equal, and a dropped chat is seen', async () => {
        const params = normalizeParams(TINY) as LibraryParams
        const left = createMemoryBackend()
        await importInto(buildLibrary(params) as Database, left)
        const right = createMemoryBackend()
        const second = buildLibrary(params) as Database & { characters: { chats: unknown[] }[] }
        if (FAULT === 'drop-chat') {
            second.characters[0].chats.pop()
        }
        await importInto(second, right)
        const diff = diffCensus(await walkCensus(left), await walkCensus(right), 0.01)
        expect(diff.differences).toEqual([])
    })

    test('T2a: the heavy character shows its own chat and message counts in the census; every other character equals the plain library', async () => {
        const heavyIndex = 2
        const params = normalizeParams({ ...TINY, heavy: { index: heavyIndex, chatsPerCharacter: 3, messagesPerChat: 5 } }) as LibraryParams
        const expected = heavyExpected(params) as { index: number, chats: number, messages: number }
        const plain = buildLibrary(normalizeParams(TINY)) as Database
        const db = builtLibrary(params)
        const heavyChaId = db.characters[heavyIndex].chaId
        // digests are taken before the import, which consumes the library
        for (let i = 0; i < TINY.characters; i++) {
            if (i !== heavyIndex) {
                expect(charactersDigest(db, i, i + 1), `character ${i}`).toBe(charactersDigest(plain, i, i + 1))
            }
        }
        const backend = createMemoryBackend()
        await importInto(db, backend)
        const census = await walkCensus(backend)
        const row = census.characters.rows.find(candidate => candidate.chaId === heavyChaId)
        expect(row, 'the heavy character has a census row').toBeDefined()
        expect({ chats: row?.chats, messages: row?.messages }).toEqual({ chats: expected.chats, messages: expected.messages })
        expect(census.chats).toBe((TINY.characters - 1) * TINY.chatsPerCharacter + expected.chats)
    })

    test('the directory census refuses a damaged tree', async () => {
        const backend = createMemoryBackend()
        await importInto(buildLibrary(normalizeParams(TINY)) as Database, backend)
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c806-tree-'))
        try {
            await streamTreeToDir(backend, dir)
            const names = fs.readdirSync(dir).filter(name => name !== hexOf(COMMIT_KEY))
            fs.rmSync(path.join(dir, names[Math.floor(names.length / 2)]))
            fs.writeFileSync(path.join(dir, names[0]), Buffer.from('damaged'))
            const census = await censusOfDirectory(dir)
            expect(census.problems.length).toBeGreaterThanOrEqual(1)
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })
})
//#endregion

//#region modes
describe.skipIf(MODE !== 'write')('c806 tree write', () => {
    test('write the tree of C806_* parameters', { timeout: 6 * 60 * 60 * 1000 }, async () => {
        const run = outsideRepo(path.join(OUT_ROOT, TAG))
        fs.mkdirSync(run, { recursive: true })
        const params = paramsFromEnv()
        if (Number(params.characters) > 20) {
            const asked = /--max-old-space-size=(\d+)/.exec(process.env.NODE_OPTIONS ?? '')
            expect(asked, 'NODE_OPTIONS must carry --max-old-space-size for a scale write').not.toBeNull()
            expect(v8.getHeapStatistics().heap_size_limit).toBeGreaterThanOrEqual(Number(asked![1]) * MIB * 0.9)
        }
        const t0 = performance.now()
        const db = builtLibrary(params)
        const counts = libraryCounts(db)
        const buildMs = Math.round(performance.now() - t0)
        guard('library built')
        let tree: Record<string, unknown>
        if (ROUTE === 'A') {
            const backend = createMemoryBackend()
            const imported = await importInto(db, backend)
            const pristine = outsideRepo(path.join(ROOT, 'data', TAG, 'pristine'))
            const written = await streamTreeToDir(backend, pristine)
            tree = { route: 'A', dir: pristine, ...written, importMs: imported.importMs }
        } else if (ROUTE === 'node') {
            const dist = process.env.C806_DIST
            expect(dist, 'C806_DIST (the measurement dist) is required for route C').toBeTruthy()
            prepareDist(TAG, dist)
            const server = await startServer({ tag: TAG, reqlog: false })
            try {
                const authHeader = await loginKey(server.baseUrl)
                const backend = createNodeBackend(createNodeHttpStore({ authHeader, baseUrl: server.baseUrl }))
                const imported = await importInto(db, backend)
                const dir = dirsOf(TAG).save
                tree = { route: 'node', dir, importMs: imported.importMs, commitHash: commitKeyHash(dir) }
            } finally {
                await server.stop()
            }
        } else {
            throw new Error(`unknown C806_ROUTE ${ROUTE}`)
        }
        writeJson(run, 'tree.json', { params, counts, buildMs, tree })
        writeJson(run, 'run.json', provenance({ tag: TAG, mode: 'write', route: ROUTE, params }))
        expect(typeof tree.dir).toBe('string')
    })
})

describe.skipIf(MODE !== 'census')('c806 tree census', () => {
    test('census of C806_TREE_DIR', { timeout: 6 * 60 * 60 * 1000 }, async () => {
        const run = outsideRepo(path.join(OUT_ROOT, TAG))
        fs.mkdirSync(run, { recursive: true })
        const dir = path.resolve(process.env.C806_TREE_DIR ?? '')
        expect(fs.existsSync(dir), `C806_TREE_DIR exists: ${dir}`).toBe(true)
        const t0 = performance.now()
        const census = await censusOfDirectory(dir)
        writeJson(run, 'census.json', { dir, walkMs: Math.round(performance.now() - t0), census })
        writeJson(run, 'run.json', provenance({ tag: TAG, mode: 'census', dir, commitHash: commitKeyHash(dir) }))
        expect(census.problems).toEqual([])
    })
})

describe.skipIf(MODE !== 'compare')('c806 tree compare', () => {
    test('census A equals census B', () => {
        const run = outsideRepo(path.join(OUT_ROOT, TAG))
        fs.mkdirSync(run, { recursive: true })
        const load = (file: string) => (JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as { census: Census }).census
        const diff = diffCensus(load(process.env.C806_CENSUS_A ?? ''), load(process.env.C806_CENSUS_B ?? ''), 0.01)
        writeJson(run, 'checks.json', { a: process.env.C806_CENSUS_A, b: process.env.C806_CENSUS_B, ...diff })
        expect(diff.differences).toEqual([])
    })
})

describe.skipIf(MODE !== 'bin')('c806 tree bin', () => {
    test('write the .bin of C806_* parameters to C806_BIN_OUT', { timeout: 6 * 60 * 60 * 1000 }, () => {
        const params = paramsFromEnv()
        const out = path.resolve(process.env.C806_BIN_OUT ?? '')
        const written = writeBin({ database: buildLibrary(params), out, params })
        expect(written.fileBytes).toBeGreaterThan(0)
    })
})

afterAll(() => {
    if (FAULT !== '') {
        console.log(`c806 fault knob set: ${FAULT}`)
    }
})
//#endregion
