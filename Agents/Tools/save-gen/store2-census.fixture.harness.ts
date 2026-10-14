/**
 * Synthetic end-to-end test of the store2 census (store2-census.ts) through the
 * real-size-report harness. No real data: the `.bin` is built here, under the OS
 * temp directory, and the harness runs on it in a child vitest process with
 * RISU_SIZE_BIN and RISU_SIZE_OUTPUT_DIR pointing at the temp files.
 *
 * Run (from the repo root; PowerShell):
 *   npx vitest run --config Agents/Tools/vitest.harness.config.ts store2-census.fixture
 *
 * RISU_CENSUS_CONFIG names the vitest config the child run uses (default: the
 * harness config). A mutated copy of that config is how the privacy assertion is
 * shown to fail when the report emits a name, without editing the repository.
 * RISU_CENSUS_KEEP_REPORT names a file the child's report is copied to.
 *
 * Every name, id, message, key and file name in the fixture carries the marker
 * `ZQXMARK`; the ids that cannot carry text (uuids, hashes) are listed exactly.
 * The assertion is that none of them, nor any marker-bearing text, appears in
 * the written JSON.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

//#region module mocks, as in real-size-report.harness.ts (risuSave is loaded to write the fixture)
const store = new Map<string, unknown>()

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => store.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => {
                store.set(key, value)
            }),
            removeItem: vi.fn(async (key: string) => {
                store.delete(key)
            }),
        }),
    },
}))

vi.mock(
    import('src/ts/globalApi.svelte'),
    () =>
        ({
            forageStorage: {
                keys: vi.fn(async () => []),
                getItem: vi.fn(async () => null),
                setItem: vi.fn(async () => {}),
            },
            // characters.ts binds this export at load.
            readImage: vi.fn(async () => new Uint8Array()),
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})

vi.mock(
    import('src/ts/storage/database.svelte'),
    () =>
        ({
            getDatabase: vi.fn(() => { throw new Error('no live database in tests') }),
            presetTemplate: { name: 'test-preset' },
        }) as unknown as typeof import('src/ts/storage/database.svelte'),
)

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))
//#endregion

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../..')
const CHILD_TIMEOUT_MS = 10 * 60 * 1000

//#region fixture
const MARK = 'ZQXMARK'

const uuidOf = (n: number): string => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`
const HASH_A = 'a'.repeat(63) + '1'
const HASH_B = 'b'.repeat(63) + '2'
const HASH_C = 'c'.repeat(63) + '3'

const UUID_CHAR_UNIT = '10000000-0000-4000-8000-000000000001'
const UUID_CHAT_UNIT = '10000000-0000-4000-8000-000000000002'
const UUID_MISSING_UNIT = '10000000-0000-4000-8000-000000000003'
const UUID_OTHER_STUB_UNIT = '10000000-0000-4000-8000-000000000004'
const UUID_MISSING_CHAT_UNIT = '10000000-0000-4000-8000-000000000005'
const UUID_PLUGIN_UNIT = '10000000-0000-4000-8000-000000000006'
const UUID_PLUGIN_GONE = '10000000-0000-4000-8000-000000000007'
const UUID_CHAR_INLAY = '20000000-0000-4000-8000-000000000001'
const UUID_MODULE_INLAY = '20000000-0000-4000-8000-000000000002'
const UUID_STORAGE_INLAY = '20000000-0000-4000-8000-000000000003'
const COLD_HEADER = 'COLDSTORAGE'

/** Ids and file names the report must never contain, beyond anything marker-bearing. */
const EXACT_PRIVATE_STRINGS: readonly string[] = [
    UUID_CHAR_UNIT, UUID_CHAT_UNIT, UUID_MISSING_UNIT, UUID_OTHER_STUB_UNIT, UUID_MISSING_CHAT_UNIT, UUID_PLUGIN_UNIT, UUID_PLUGIN_GONE,
    UUID_CHAR_INLAY, UUID_MODULE_INLAY, UUID_STORAGE_INLAY, uuidOf(1), uuidOf(4100), uuidOf(220_000),
    HASH_A, HASH_B, HASH_C,
]

/** The report text may not hold a marker, an exact private string, or a base64url stem of a fixture hash. */
export function findLeaks(reportText: string, hashStems: readonly string[]): string[] {
    const leaks: string[] = []
    if (reportText.toLowerCase().includes(MARK.toLowerCase())) {
        leaks.push('marker')
    }
    for (const text of [...EXACT_PRIVATE_STRINGS, ...hashStems]) {
        if (reportText.includes(text)) {
            leaks.push(text.slice(0, 8))
        }
    }
    return leaks
}

/** The 43-character unpadded base64url form of a 64-digit hex hash: the form the list bodies store. */
function base64urlOfHex(hex: string): string {
    return Buffer.from(hex, 'hex').toString('base64url')
}

function message(data: string, role = 'user'): Record<string, unknown> {
    return { role, data, time: 1 }
}

/** A chat whose seven 50 KB messages seal into four chunks (the cap is 128 KiB). */
function bigChat(): Record<string, unknown> {
    const messages = Array.from({ length: 7 }, (_, i) => message(`${MARK}-message-${i} ` + 'x'.repeat(50_000)))
    messages[0] = message(
        `${MARK}-message-0 {{inlay::${UUID_CHAR_INLAY}}} {{inlayed::assets/${HASH_A}.png}} {{inlay::${MARK}-other-inlay-id}} ` + 'x'.repeat(50_000),
    )
    return {
        id: `${MARK}-chat-a-id`,
        name: `${MARK}-chat-a-name`,
        message: messages,
        note: `${MARK}-note`,
        localLore: [],
        lastDate: 5,
        scriptstate: { counter: 1 },
        isStreaming: true,
    }
}

function smallChat(tag: string, count: number): Record<string, unknown> {
    return {
        id: `${MARK}-chat-${tag}-id`,
        name: `${MARK}-chat-${tag}-name`,
        message: Array.from({ length: count }, (_, i) => message(`${MARK}-${tag}-text-${i}`)),
        note: '',
        localLore: [],
    }
}

function stub(tag: string, unitKey: string, chatUnits: string[]): Record<string, unknown> {
    return {
        type: 'character',
        name: `${MARK}-stub-${tag}-name`,
        chaId: `${MARK}-stub-${tag}-id`,
        creatorNotes: `${MARK}-notes`,
        coldstorage: unitKey,
        coldStoragedChats: chatUnits,
        chats: [{ id: `${MARK}-dummy-${tag}`, message: [{ time: 1, data: '', role: 'char' }], note: '', name: '', localLore: [] }],
        chatPage: 0,
        firstMsgIndex: 0,
        coldVersion: 3,
        coldChatCount: 2,
        tags: [],
        creator: '',
    }
}

function pointerChat(unitKey: string): Record<string, unknown> {
    return { id: `${MARK}-pointer-${unitKey.slice(-1)}`, message: [{ time: 1, data: COLD_HEADER + unitKey, role: 'char' }], note: '', name: '', localLore: [] }
}

function uuidText(from: number, count: number): string {
    return Array.from({ length: count }, (_, i) => uuidOf(from + i)).join(' ')
}

function module(tag: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { id: `${MARK}-module-${tag}-id`, name: `${MARK}-module-${tag}-name`, description: `${MARK}-description`, lorebook: [], ...extra }
}

function buildDatabase(): Record<string, unknown> {
    return {
        ZQXMARK_unknown_db: NaN,
        botPresets: [{ name: `${MARK}-preset`, temperature: 1 }],
        plugins: [{ name: `${MARK}-plugin`, script: 'x' }],
        loadouts: [],
        characterOrder: [],
        modules: [
            module('with-ids', {
                lorebook: [{ key: `${MARK}-lore`, content: `{{inlay::${UUID_MODULE_INLAY}}} {{inlayed::assets/${HASH_B}.png}} {{inlay::${MARK}-module-other}}` }],
            }),
            module('plain'),
            // Above the old collector cap of 4,096 ids, below the body size parameter.
            module('over-cap', { lorebook: [{ key: `${MARK}-lore`, content: uuidText(1, 4100) }] }),
            // Over the 8 MiB inlay body parameter: written as the overflow marker, and itself an oversize unit.
            module('overflow', { lorebook: [{ key: `${MARK}-lore`, content: uuidText(100_000, 220_000) + ' ' + 'p'.repeat(1_100_000) }] }),
        ],
        pluginCustomStorage: {
            [`${MARK}-key-a`]: { v: `${MARK}-value-a` },
            [`${MARK}-key-b`]: `text holding ${UUID_STORAGE_INLAY}`,
            _coldplugin: { [`${MARK}-key-cold`]: UUID_PLUGIN_UNIT, [`${MARK}-key-gone`]: UUID_PLUGIN_GONE },
        },
        characters: [
            {
                type: 'character',
                name: `${MARK}-live-name`,
                chaId: `${MARK}-live-id`,
                image: `${MARK}-avatar.png`,
                additionalAssets: [['label', `${MARK}-extra.wav`]],
                emotionImages: [['happy', `assets/${HASH_C}.png`]],
                firstMsgIndex: 0,
                chatPage: 0,
                reloadKeys: 3,
                ZQXMARK_unknown_char: NaN,
                globalLore: [],
                chats: [bigChat()],
            },
            stub('archived', UUID_CHAR_UNIT, [UUID_CHAT_UNIT]),
            stub('gone', UUID_MISSING_UNIT, []),
            stub('half', UUID_OTHER_STUB_UNIT, [UUID_MISSING_CHAT_UNIT]),
        ],
    }
}

/** Cold units by entry name: the archived character with a pointer chat, its chat unit, a plugin value, and a stub whose chat unit is absent. */
function coldUnits(): Record<string, unknown> {
    return {
        [`coldstorage_${UUID_CHAR_UNIT}.json`]: {
            character: {
                type: 'character',
                name: `${MARK}-stub-archived-name`,
                chaId: `${MARK}-stub-archived-id`,
                firstMsgIndex: 0,
                chatPage: 0,
                chats: [pointerChat(UUID_CHAT_UNIT), smallChat('inline', 2)],
            },
        },
        [`coldstorage_${UUID_CHAT_UNIT}.json`]: { message: [message(`${MARK}-cold-0`), message(`${MARK}-cold-1`), message(`${MARK}-cold-2`)] },
        [`coldstorage_${UUID_OTHER_STUB_UNIT}.json`]: {
            character: { type: 'character', name: `${MARK}-half`, chaId: `${MARK}-stub-half-id`, chats: [pointerChat(UUID_MISSING_CHAT_UNIT)] },
        },
        [`coldstorage_${UUID_PLUGIN_UNIT}.json`]: { stored: `${MARK}-plugin-cold-value` },
    }
}
//#endregion

//#region container
/** LocalWriter's framing: [u32le nameLength][name][u32le dataLength][data] per entry. */
function writeContainer(entries: { name: string, data: Uint8Array }[]): Uint8Array {
    const parts: Uint8Array[] = []
    for (const { name, data } of entries) {
        const nameBytes = new TextEncoder().encode(name)
        parts.push(new Uint8Array(new Uint32Array([nameBytes.byteLength]).buffer), nameBytes, new Uint8Array(new Uint32Array([data.byteLength]).buffer), data)
    }
    const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}
//#endregion

function dig(root: unknown, dotted: string): unknown {
    let value: unknown = root
    for (const segment of dotted.split('.')) {
        if (value === null || typeof value !== 'object') {
            return undefined
        }
        value = (value as Record<string, unknown>)[segment]
    }
    return value
}

let report: Record<string, unknown> = {}
let reportText = ''
let childOutput = ''
const hashStems: string[] = []

describe('store2 census over a synthetic backup', () => {
    beforeAll(async () => {
        // msgpackr decides once, when it is evaluated, whether to use Node's Buffer; the app runs it without one. It is
        // an external module, so it is evaluated by Node itself, and only that import runs with Buffer absent: removing
        // Buffer while vitest still has its own module loads in flight throws in vitest's code.
        const savedBuffer = globalThis.Buffer
        // The Buffer-less environment the app runs in; restored immediately below.
        delete globalThis.Buffer
        try {
            await import('msgpackr/index-no-eval')
        } finally {
            globalThis.Buffer = savedBuffer
        }
        const encode = (await import('src/ts/storage/risuSave')).encodeRisuSaveLegacy
        for (const hash of [HASH_A, HASH_B, HASH_C]) {
            hashStems.push(base64urlOfHex(hash))
        }

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-store2-census-'))
        const binPath = path.join(dir, 'fixture.bin')
        const outDir = path.join(dir, 'out')
        const entries: { name: string, data: Uint8Array }[] = [
            { name: 'database.risudat', data: new Uint8Array(encode(buildDatabase(), 'compression')) },
            { name: `${MARK}-asset-file.png`, data: new Uint8Array([1, 2, 3]) },
        ]
        for (const [name, body] of Object.entries(coldUnits())) {
            entries.push({ name, data: new TextEncoder().encode(JSON.stringify(body)) })
        }
        fs.writeFileSync(binPath, writeContainer(entries))

        const vitestEntry = path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs')
        const config = process.env.RISU_CENSUS_CONFIG ?? path.join('Agents', 'Tools', 'vitest.harness.config.ts')
        const child = spawnSync(process.execPath, [vitestEntry, 'run', '--config', config, 'real-size-report'], {
            cwd: REPO_ROOT,
            env: { ...process.env, RISU_SIZE_BIN: binPath, RISU_SIZE_OUTPUT_DIR: outDir, NODE_OPTIONS: '--max-old-space-size=4096' },
            encoding: 'utf8',
            timeout: CHILD_TIMEOUT_MS,
            maxBuffer: 64 * 1024 * 1024,
        })
        childOutput = `${child.stdout}\n${child.stderr}`
        const reportPath = path.join(outDir, 'real-size-report.json')
        expect(fs.existsSync(reportPath), `child run produced no report (exit ${child.status})\n${childOutput.slice(-4000)}`).toBe(true)
        reportText = fs.readFileSync(reportPath, 'utf8')
        report = JSON.parse(reportText) as Record<string, unknown>
        if (process.env.RISU_CENSUS_KEEP_REPORT) {
            fs.copyFileSync(reportPath, path.resolve(process.env.RISU_CENSUS_KEEP_REPORT))
        }
        fs.rmSync(dir, { recursive: true, force: true })
    }, CHILD_TIMEOUT_MS + 60_000)

    it('re-attaches cold units and skips owners it cannot, by reason', () => {
        expect(dig(report, 'database.decodeError')).toBeNull()
        expect(dig(report, 'store2.failed')).toBeUndefined()
        expect(dig(report, 'store2.scope.charactersInDatabase')).toBe(4)
        expect(dig(report, 'store2.scope.ownersAttempted')).toBe(4)
        expect(dig(report, 'store2.scope.ownersEncoded')).toBe(2)
        expect(dig(report, 'store2.scope.stubCharactersReattached')).toBe(1)
        expect(dig(report, 'store2.scope.coldChatsReattached')).toBe(1)
        expect(dig(report, 'store2.scope.ownersSkippedByReason')).toEqual({ 'character-unit-missing': 1, 'chat-unit-missing': 1 })
        expect(dig(report, 'store2.coldRetention.unitsNotRetainedOverBudget')).toBe(0)
    })

    it('counts units, chunks and chats', () => {
        expect(dig(report, 'store2.chats.chats')).toBe(3)
        expect(dig(report, 'store2.chats.chunksPerChat.max')).toBe(4)
        expect(dig(report, 'store2.chats.chunksPerChat.count')).toBe(3)
        expect(dig(report, 'store2.unitFrameBytes.byKind.chatChunk.count')).toBe(6)
        expect(dig(report, 'store2.unitFrameBytes.byKind.chatCore.count')).toBe(3)
        expect(dig(report, 'store2.unitFrameBytes.byKind.characterCore.count')).toBe(2)
        expect(dig(report, 'store2.unitFrameBytes.byKind.module.count')).toBe(4)
        expect(dig(report, 'store2.chats.messagesPerChat.max')).toBe(7)
        expect(Number(dig(report, 'store2.chats.largestMessageBytesPerChat.max'))).toBeGreaterThan(50_000)
        expect(dig(report, 'store2.chats.chunkEntryThreshold.chatsWithMoreChunksThan.256')).toBe(0)
        expect(dig(report, 'store2.coreF.characterCoreFJsonBytes.count')).toBe(2)
        expect(dig(report, 'store2.shardsAndManifest.shardCount')).toBe(16)
        expect(dig(report, 'store2.shardsAndManifest.shardEntriesTotal')).toBe(2)
        expect(Number(dig(report, 'store2.shardsAndManifest.manifestBytes'))).toBeGreaterThan(0)
        expect(dig(report, 'store2.unitFrameBytes.byKind.shard.count')).toBe(16)
    })

    it('flags the oversize module unit once and no unit above 64 MiB', () => {
        expect(dig(report, 'store2.unitFrameBytes.flags.above8MiB.count')).toBe(1)
        expect(dig(report, 'store2.unitFrameBytes.flags.above8MiB.units.0.kind')).toBe('module')
        expect(dig(report, 'store2.unitFrameBytes.flags.above64MiB.count')).toBe(0)
    })

    it('counts plugin storage keys, cold mapping keys and buckets', () => {
        expect(dig(report, 'store2.pluginStorage.storedKeys')).toBe(3)
        expect(dig(report, 'store2.pluginStorage.coldPluginMappingKeys')).toBe(2)
        expect(dig(report, 'store2.pluginStorage.coldPluginValuesResolved')).toBe(1)
        expect(dig(report, 'store2.pluginStorage.coldPluginUnavailableByReason')).toEqual({ missing: 1 })
        expect(dig(report, 'store2.pluginStorage.resolvedKeys')).toBe(4)
        expect(dig(report, 'store2.pluginStorage.bucketCount')).toBe(16)
        const perBucket = dig(report, 'store2.pluginStorage.perBucket') as { keys: number }[]
        expect(perBucket).toHaveLength(16)
        expect(perBucket.reduce((sum, bucket) => sum + bucket.keys, 0)).toBe(4)
        expect(dig(report, 'store2.pluginStorage.valueUnitBytes.count')).toBe(4)
    })

    it('counts inlay owners by kind, id shape, cap and overflow', () => {
        expect(dig(report, 'store2.inlays.scope.characters.owners')).toBe(2)
        expect(dig(report, 'store2.inlays.scope.characters.ownersWithAnyInlayId')).toBe(1)
        expect(dig(report, 'store2.inlays.scope.characters.idShapes.uuid.total')).toBe(1)
        // The inlay token's hash and the emotion image's hash: the scan reads every string of the owner.
        expect(dig(report, 'store2.inlays.scope.characters.idShapes.assetShaped.total')).toBe(2)
        expect(dig(report, 'store2.inlays.scope.characters.idShapes.other.total')).toBe(1)
        expect(dig(report, 'store2.inlays.scope.modules.owners')).toBe(4)
        expect(dig(report, 'store2.inlays.scope.modules.ownersWithAnyInlayId')).toBe(3)
        expect(dig(report, 'store2.inlays.scope.modules.ownersAbove4096Ids')).toBe(2)
        expect(dig(report, 'store2.inlays.scope.modules.ownersWrittenAsOverflow')).toBe(1)
        expect(dig(report, 'store2.inlays.scope.modules.idShapes.uuid.total')).toBe(1 + 4100 + 220_000)
        expect(dig(report, 'store2.inlays.scope.modules.idShapes.assetShaped.total')).toBe(1)
        expect(dig(report, 'store2.inlays.scope.modules.idShapes.other.total')).toBe(1)
        expect(dig(report, 'store2.inlays.scope.modules.idsPerOwner.max')).toBe(220_000)
        expect(dig(report, 'store2.inlays.scope.config.owners')).toBe(1)
        expect(dig(report, 'store2.inlays.scope.config.ownersWithAnyInlayId')).toBe(1)
        // The key-b value and the two _coldplugin unit ids.
        expect(dig(report, 'store2.inlays.scope.config.idShapes.uuid.total')).toBe(3)
        expect(dig(report, 'store2.inlays.scope.pluginValues.owners')).toBe(4)
        expect(dig(report, 'store2.inlays.scope.pluginValues.ownersWithAnyInlayId')).toBe(2)
    })

    it('counts asset list entries per owner', () => {
        expect(dig(report, 'store2.assetLists.characters.owners')).toBe(2)
        expect(dig(report, 'store2.assetLists.characters.literalNames.max')).toBe(2)
        expect(dig(report, 'store2.assetLists.characters.hashStems.max')).toBe(1)
        expect(dig(report, 'store2.assetLists.modules.owners')).toBe(4)
        expect(dig(report, 'store2.assetLists.config.owners')).toBe(1)
    })

    it('counts residual normalisations and reports unknown fields without names', () => {
        const kinds = dig(report, 'store2.residualNormalisations.byUnitKind')
        expect(dig(kinds, 'characterCore.paths')).toEqual({ 'removed:reloadKeys': 1, 'changed:unknown-field': 1 })
        expect(dig(kinds, 'chat.paths')).toEqual({ 'removed:chats.[].isStreaming': 1 })
        expect(dig(kinds, 'configRoot.paths')).toEqual({ 'changed:unknown-field': 1 })
        expect(dig(kinds, 'plugin.paths')).toEqual({ 'added:pluginV2': 1 })
        expect(dig(report, 'store2.residualNormalisations.assembleFailuresByReason')).toEqual({})
    })

    it('records timing and memory', () => {
        expect(Number(dig(report, 'store2.timing.totalMs'))).toBeGreaterThan(0)
        expect(Number(dig(report, 'store2.memory.peakRssSampledBytes'))).toBeGreaterThan(0)
    })

    it('writes no marker, id, hash or name anywhere in the report', () => {
        expect(reportText.length).toBeGreaterThan(1000)
        expect(findLeaks(reportText, hashStems)).toEqual([])
        // The same assertion over the child's console output: the run prints no name either.
        expect(findLeaks(childOutput, hashStems)).toEqual([])
    })

    it('the privacy check fails when one name is emitted', () => {
        const clean = { ordinal: 'character#0', bytes: 12 }
        expect(findLeaks(JSON.stringify(clean), hashStems)).toEqual([])
        expect(findLeaks(JSON.stringify({ ...clean, ordinal: `character#0#${MARK}-live-name` }), hashStems)).toEqual(['marker'])
        expect(findLeaks(JSON.stringify({ ...clean, id: UUID_CHAR_INLAY }), hashStems)).toEqual([UUID_CHAR_INLAY.slice(0, 8)])
        expect(findLeaks(JSON.stringify({ ...clean, stem: hashStems[0] }), hashStems)).toEqual([hashStems[0].slice(0, 8)])
    })
})
