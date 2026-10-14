/**
 * Fixtures of the recovery pick and integration tests: a synthetic complete tree
 * (characters with chats and chunks, modules, plugin-storage buckets, asset and
 * inlay lists) planted under ordinary or staged keys, with options that leave a
 * unit out, corrupt one or make a list newer than this build; an independent
 * closure walk that checks every Ref against the stored bytes without the
 * library's own tree code; a deleter stand-in that follows the real gate; and
 * the page-reboot decision.
 */
import { crc32 } from 'src/ts/storage/blockFrame'
import { Store2CommitConflictError, Store2FenceConflictError, type Store2Backend, type UnitWrite } from 'src/ts/storage/store2/backend'
import { classifyBoot, openDeleterGate, probeStore2Presence, type BootDecision, type GateRefusal } from 'src/ts/storage/store2/boot'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { readFenceVerdict } from 'src/ts/storage/store2/fence'
import {
    encodeUnit, hexStemToBase64url, keyOfTail, newManifestKey, newShardKey, newStagedKey, newStagedManifestKey, newUnitKey,
    readUnit, refOfFrame, refsOf, UNIT_TYPE,
    type Manifest, type Ref, type KeyEnv, type UnitType,
} from 'src/ts/storage/store2/format'
import { INLAY_META_PREFIX, encodeInlayId, inlayMetaKey } from 'src/ts/process/files/inlayKeys'

export const UUID_FIXED = '11111111-2222-3333-4444-555555555555'
export const UUID_CHARACTER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

export type Role =
    | 'config' | 'statics' | 'order' | 'loadouts' | 'preset' | 'plugin' | 'legacy'
    | 'configAl' | 'fixedIl' | 'shard' | 'core' | 'lore' | 'scripts' | 'charAl' | 'charIl' | 'chatCore' | 'chunk'
    | 'moduleIndex' | 'module' | 'modAl' | 'modIl' | 'bucket' | 'value'

export interface TreeShape {
    characters: number
    chats: number
    chunks: number
    modules: number
    buckets: number
}

export interface PlantOptions {
    /** `ordinary`: `m-`, `s-`, `u-` keys. `staged`: a completed staged candidate under `store2/g-<stagingId>-`. */
    flavor?: 'ordinary' | { stagingId: string }
    shape?: Partial<TreeShape>
    /** The manifest body's `seq`. */
    seq?: number
    /** Units of this role are never stored (the Refs still name them). */
    omit?: Role
    /** Units of this role are stored with a flipped payload byte (the Refs name the intact bytes). */
    corrupt?: Role
    /** The Refs naming units of this role carry a size one too large (the stored unit is intact). */
    wrongSize?: Role
    /** The Refs naming units of this role carry a wrong checksum (the stored unit is intact). */
    wrongCrc?: Role
    /** Units of this role are stored under a frame format newer than this build (a valid header checksum). */
    tooNew?: Role
    /** The first list of this role is stored at version 2 (valid frame, newer than this build). */
    newerList?: 'configAl' | 'charAl' | 'modAl'
    /** The first list of this role is stored at version 0 (below this build's: stale, not trusted). */
    staleList?: 'configAl' | 'charAl' | 'modAl'
    /** Extra distinct literal asset names in the config asset list. */
    extraAssetNames?: number
    /** Extra ids and hash stems (by `hexOf` number) in the fixed inlay list. */
    extraInlays?: { u?: string[], o?: string[], hexes?: number[] }
    /** The first list of this role is marked overflow (`x`). */
    overflowIl?: 'fixedIl' | 'charIl' | 'modIl'
    /** The first unit of this role is stored under another frame type; its referrer's Ref matches the stored bytes. */
    wrongType?: Role
    /** The first preset is named a second time by the manifest, the repeat with a wrong size or checksum. */
    duplicateRef?: 'wrongSize' | 'wrongCrc'
}

export interface Planted {
    manifestKey: string
    body: Manifest
    /** Every key actually stored, the manifest included. */
    written: string[]
    byRole: Map<Role, string[]>
    /** Hex stems and lower-case literal names the asset lists name, distinct. */
    assetHexes: string[]
    assetNames: string[]
    /** `inlays/m-…` keys of the ids the inlay lists name (uuids and other ids). */
    inlayMetaKeys: string[]
    /** `inlays/m-assets%2F<hex>%2E` prefixes of the hash stems the inlay lists name. */
    inlayPrefixes: string[]
}

const DEFAULT_SHAPE: TreeShape = { characters: 2, chats: 2, chunks: 3, modules: 2, buckets: 2 }

export function hexOf(n: number): string {
    return n.toString(16).padStart(64, '0')
}

function newerFrame(bytes: Uint8Array): Uint8Array {
    const copy = bytes.slice()
    copy[4] = 2
    new DataView(copy.buffer).setUint32(12, crc32(copy.subarray(0, 12)), true)
    return copy
}

function corrupted(bytes: Uint8Array): Uint8Array {
    const copy = bytes.slice()
    copy[16] ^= 1
    return copy
}

export async function plantTree(backend: Store2Backend, env: KeyEnv, options: PlantOptions = {}): Promise<Planted> {
    const shape = { ...DEFAULT_SHAPE, ...options.shape }
    const flavor = options.flavor ?? 'ordinary'
    const mint = (kind: 's' | 'u'): string => flavor === 'ordinary'
        ? (kind === 's' ? newShardKey(env) : newUnitKey(env))
        : newStagedKey(flavor.stagingId, kind, env)
    const writes: UnitWrite[] = []
    const byRole = new Map<Role, string[]>()
    const assetHexes = new Set<string>()
    const assetNames = new Set<string>()
    const inlayIds = new Set<string>()
    const inlayStemHexes = new Set<string>()
    const typed = new Set<Role>()

    const put = (role: Role, type: UnitType, body: object, kind: 's' | 'u' = 'u', extra: unknown[] = []): Ref => {
        const key = mint(kind)
        let stored = type
        if (options.wrongType === role && !typed.has(role)) {
            typed.add(role)
            stored = type === UNIT_TYPE.scripts ? UNIT_TYPE.lore : UNIT_TYPE.scripts
        }
        const bytes = encodeUnit(stored, body)
        if (options.omit !== role) {
            writes.push({ key, bytes: options.corrupt === role ? corrupted(bytes) : options.tooNew === role ? newerFrame(bytes) : bytes })
        }
        byRole.set(role, [...(byRole.get(role) ?? []), key])
        const [tail, length, crc] = refOfFrame(key, bytes)
        return [tail, options.wrongSize === role ? length + 1 : length, options.wrongCrc === role ? (crc ^ 1) >>> 0 : crc, ...extra] as Ref
    }
    const assetList = (role: 'configAl' | 'charAl' | 'modAl', hexes: number[], names: string[]): Ref => {
        for (const hex of hexes) {
            assetHexes.add(hexOf(hex))
        }
        for (const name of names) {
            assetNames.add(name)
        }
        const newer = options.newerList === role && (byRole.get(role)?.length ?? 0) === 0
        const stale = options.staleList === role && (byRole.get(role)?.length ?? 0) === 0
        const body = newer
            ? { v: 2, h: '', l: [], future: true }
            : { v: stale ? 0 : 1, h: hexes.map(hex => hexStemToBase64url(hexOf(hex))).join(''), l: names }
        return put(role, UNIT_TYPE.assetList, body, 'u', [newer ? 2 : stale ? 0 : 1])
    }
    const inlayList = (role: 'fixedIl' | 'charIl' | 'modIl', u: string[], o: string[], hexes: number[] = []): Ref => {
        for (const id of [...u, ...o]) {
            inlayIds.add(id)
        }
        for (const hex of hexes) {
            inlayStemHexes.add(hexOf(hex))
        }
        const overflow = options.overflowIl === role && (byRole.get(role)?.length ?? 0) === 0
        const body = { v: 1, u, h: hexes.map(hex => hexStemToBase64url(hexOf(hex))).join(''), o, ...(overflow ? { x: true } : {}) }
        return put(role, UNIT_TYPE.inlayList, body, 'u', [1])
    }

    const entries = []
    for (let c = 0; c < shape.characters; c++) {
        const chats = []
        for (let k = 0; k < shape.chats; k++) {
            const chunks: Ref[] = []
            for (let n = 0; n < shape.chunks; n++) {
                chunks.push(put('chunk', UNIT_TYPE.chatChunk, { v: 1, msgs: [{ c: `${c}-${k}-${n}` }] }, 'u', [1]))
            }
            chats.push({ cid: `chat-${c}-${k}`, core: put('chatCore', UNIT_TYPE.chatCore, { v: 1, f: { name: `chat ${k}` } }), chunks })
        }
        entries.push({
            u: `char-${String(c).padStart(3, '0')}`,
            type: 'character',
            name: `Character ${c}`,
            chaId: `cha-${c}`,
            creatorNotes: '',
            chatPage: 0,
            firstMsgIndex: 0,
            core: put('core', UNIT_TYPE.characterCore, { v: 1, c }),
            lore: c === 0 ? put('lore', UNIT_TYPE.lore, { v: 1, book: [] }) : null,
            scripts: c === 0 ? put('scripts', UNIT_TYPE.scripts, { v: 1, list: [] }) : null,
            al: assetList('charAl', [10 + c], [`char${c}.png`]),
            il: c === 0 ? inlayList('charIl', [UUID_CHARACTER], []) : null,
            dsp: false,
            chats,
        })
    }
    const shardRef = put('shard', UNIT_TYPE.shard, { v: 1, entries }, 's')

    const moduleEntries = []
    for (let m = 0; m < shape.modules; m++) {
        moduleEntries.push({
            id: `module-${m}`,
            unit: put('module', UNIT_TYPE.module, { v: 1, m }),
            al: assetList('modAl', [100 + m], [`mod${m}.png`]),
            il: m === 0 ? inlayList('modIl', [], ['module inlay']) : null,
            name: `Module ${m}`,
            description: '',
            hasToggle: false,
            dsp: false,
        })
    }
    const moduleIndexRef = put('moduleIndex', UNIT_TYPE.moduleIndex, { v: 1, entries: moduleEntries })

    const bucketRefs: Ref[] = []
    for (let b = 0; b < shape.buckets; b++) {
        bucketRefs.push(put('bucket', UNIT_TYPE.pluginStorageBucket, {
            v: 1,
            entries: [
                { k: 'a', ref: put('value', UNIT_TYPE.pluginStorageValue, { v: 1, b, k: 'a' }) },
                { k: 'b', ref: put('value', UNIT_TYPE.pluginStorageValue, { v: 1, b, k: 'b' }) },
            ],
        }))
    }

    const configNames = ['background.png', 'icon.webp']
    for (let e = 0; e < (options.extraAssetNames ?? 0); e++) {
        configNames.push(`bulk-${e}.png`)
    }
    const presetRefs: Ref[] = [put('preset', UNIT_TYPE.preset, { v: 1, n: 0 }), put('preset', UNIT_TYPE.preset, { v: 1, n: 1 })]
    if (options.duplicateRef !== undefined) {
        const [tail, length, crc] = presetRefs[0]
        presetRefs.push([tail, options.duplicateRef === 'wrongSize' ? length + 1 : length, options.duplicateRef === 'wrongCrc' ? (crc ^ 1) >>> 0 : crc] as Ref)
    }
    const body: Manifest = {
        fmt: 1,
        req: [],
        seq: options.seq ?? 5,
        createdAt: env.now(),
        shardCount: 1,
        shards: [shardRef],
        fixed: {
            config: put('config', UNIT_TYPE.configRoot, { v: 1, theme: 'x' }),
            configAl: assetList('configAl', [1, 2], configNames) as Manifest['fixed']['configAl'],
            il: inlayList(
                'fixedIl',
                [UUID_FIXED, ...(options.extraInlays?.u ?? [])],
                ['custom-id', ...(options.extraInlays?.o ?? [])],
                options.extraInlays?.hexes ?? [],
            ) as Manifest['fixed']['il'],
            statics: put('statics', UNIT_TYPE.statics, { v: 1 }),
            order: put('order', UNIT_TYPE.order, { v: 1, list: [] }),
            loadouts: put('loadouts', UNIT_TYPE.loadouts, { v: 1 }),
            moduleIndex: moduleIndexRef,
            presets: presetRefs,
            plugins: [put('plugin', UNIT_TYPE.plugin, { v: 1, name: 'p' })],
            pluginStorage: { buckets: shape.buckets, refs: bucketRefs },
            legacyKeep: {
                unit: put('legacy', UNIT_TYPE.legacyList, { v: 1, iv: 1, files: [], h: '', l: [], i: { v: 1, u: [], h: '', o: [] } }),
                v: 1,
                files: [{ key: 'database/database.bin', status: 'ok' }],
            },
        },
    }
    const manifestKey = flavor === 'ordinary' ? newManifestKey(env) : newStagedManifestKey(flavor.stagingId, env)
    writes.push({ key: manifestKey, bytes: encodeUnit(UNIT_TYPE.manifest, body) })
    for (const write of writes) {
        await backend.putUnit(write.key, write.bytes)
    }
    return {
        manifestKey,
        body,
        written: writes.map(write => write.key),
        byRole,
        assetHexes: [...assetHexes],
        assetNames: [...assetNames],
        inlayMetaKeys: [...inlayIds].map(id => inlayMetaKey(id.toLowerCase()) as string),
        inlayPrefixes: [...inlayStemHexes].map(hex => INLAY_META_PREFIX + (encodeInlayId(`assets/${hex}.`) as string)),
    }
}

// ---- Independent closure walk ----

const DESCENT: Readonly<Record<string, UnitType>> = {
    'shards[]': UNIT_TYPE.shard,
    'fixed.moduleIndex': UNIT_TYPE.moduleIndex,
    'fixed.pluginStorage.refs[]': UNIT_TYPE.pluginStorageBucket,
}

export interface Closure {
    /** Every key the walk reached, the manifest included. */
    keys: Set<string>
    /** What is wrong, one line each: a missing unit or a Ref that does not match the stored bytes. */
    problems: string[]
}

/** The closure of one manifest by `refsOf` and a direct read of every unit; tolerant of a missing unit. */
export async function closureOf(backend: Store2Backend, manifestKey: string): Promise<Closure> {
    const keys = new Set<string>([manifestKey])
    const problems: string[] = []
    const manifestBytes = (await backend.readUnits([manifestKey])).get(manifestKey) ?? null
    if (manifestBytes === null) {
        return { keys, problems: [`${manifestKey} is missing`] }
    }
    const manifest = readUnit(manifestBytes, UNIT_TYPE.manifest)
    if (manifest.status !== 'ok') {
        return { keys, problems: [`${manifestKey} is ${manifest.status}`] }
    }
    const visit = async (type: UnitType, body: object, owner: string): Promise<void> => {
        for (const target of refsOf(type, body)) {
            const key = keyOfTail(target.tail)
            keys.add(key)
            const bytes = (await backend.readUnits([key])).get(key) ?? null
            if (bytes === null) {
                problems.push(`${key} named by ${owner} at ${target.path} is missing`)
                continue
            }
            const [, length, crc] = refOfFrame(key, bytes)
            if (length !== target.bytes || crc !== target.crc) {
                problems.push(`${key} named by ${owner} at ${target.path} does not match its Ref`)
            }
            const child = DESCENT[target.path]
            if (child !== undefined) {
                const unit = readUnit(bytes, child)
                if (unit.status === 'ok') {
                    await visit(child, unit.value.body, key)
                } else {
                    problems.push(`${key} is ${unit.status}`)
                }
            }
        }
    }
    await visit(UNIT_TYPE.manifest, manifest.value.body, manifestKey)
    return { keys, problems }
}

/** The manifests a parsed commit key names. */
async function namedManifests(backend: Store2Backend): Promise<string[]> {
    const read = classifyCommitRead(await backend.readCommit())
    if (read.status !== 'parsed') {
        return []
    }
    return [
        ...(read.value.current === null ? [] : [read.value.current.key]),
        ...read.value.retained.map(entry => entry.key),
        ...read.value.pins.map(pin => pin.key),
    ]
}

// ---- Deleter stand-in ----

export interface StandIn {
    /** Whether the gate opened; false means nothing was attempted. */
    ran: boolean
    refused: GateRefusal | null
    deleted: string[]
}

/**
 * A garbage-collection pass reduced to its safety skeleton: the real deleter gate,
 * then every store2 key that is not in the closure of a named manifest, not listed
 * by a parsable fence and not under the marker's staging prefix, removed through
 * `removeBatch` with the gate's tokens.
 */
export async function deleterStandIn(backend: Store2Backend): Promise<StandIn> {
    const gate = await openDeleterGate(backend, 'gc')
    if (gate.status === 'refused') {
        return { ran: false, refused: gate.reason, deleted: [] }
    }
    const live = new Set<string>(gate.liveKeys)
    for (const manifest of await namedManifests(backend)) {
        for (const key of (await closureOf(backend, manifest)).keys) {
            live.add(key)
        }
    }
    const prefix = gate.commit.staging?.prefix ?? null
    const doomed = (await backend.listStore2()).filter(key => !live.has(key) && !(prefix !== null && key.startsWith(prefix)))
    const deleted: string[] = []
    for (let start = 0; start < doomed.length; start += 25) {
        const batch = doomed.slice(start, start + 25)
        try {
            await backend.removeBatch(batch, gate.commitToken, gate.fenceToken)
        } catch (error) {
            if (error instanceof Store2CommitConflictError || error instanceof Store2FenceConflictError) {
                break
            }
            throw error
        }
        deleted.push(...batch)
    }
    return { ran: true, refused: null, deleted }
}

// ---- Reboot ----

/** What a fresh page load decides over the stored state (a new owner, no device-persisted id, no upstream main file). */
export async function rebootDecision(backend: Store2Backend, ownerId = 'z'.repeat(26)): Promise<BootDecision> {
    const commit = classifyCommitRead(await backend.readCommit())
    return classifyBoot({
        commit,
        fence: await readFenceVerdict(backend),
        presence: await probeStore2Presence(backend),
        tree: null,
        upstreamMainFile: false,
        ownerId,
        deviceOwner: false,
    })
}

// ---- Content fingerprint ----

const PARENT_UNIT_TYPES: readonly UnitType[] = [UNIT_TYPE.manifest, UNIT_TYPE.shard, UNIT_TYPE.moduleIndex, UNIT_TYPE.pluginStorageBucket]

function normalized(value: unknown): unknown {
    if (Array.isArray(value)) {
        if (typeof value[0] === 'string' && /^(?:[msu]-|g-)/.test(value[0]) && typeof value[1] === 'number' && typeof value[2] === 'number') {
            return ['REF', ...value.slice(3).map(normalized)]
        }
        return value.map(normalized)
    }
    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(Object.entries(value).map(([field, inner]) => [field, normalized(inner)]))
    }
    return value
}

/**
 * What a tree holds, independent of its keys: for every unit of the closure, a
 * leaf's bytes, or a parent's body with each Ref reduced to the elements after its
 * checksum (the manifest's `seq` and `createdAt` blanked). Sorted, so two trees of
 * the same content compare equal whatever their keys.
 */
export async function treeFingerprint(backend: Store2Backend, manifestKey: string): Promise<string[]> {
    const closure = await closureOf(backend, manifestKey)
    const out: string[] = []
    for (const key of closure.keys) {
        const bytes = (await backend.readUnits([key])).get(key) as Uint8Array
        const type = bytes[5]
        if (!PARENT_UNIT_TYPES.includes(type as UnitType)) {
            out.push(`leaf:${type}:${Buffer.from(bytes).toString('base64')}`)
            continue
        }
        const unit = readUnit(bytes)
        if (unit.status !== 'ok') {
            out.push(`parent:${type}:${unit.status}`)
            continue
        }
        const body = { ...unit.value.body } as Record<string, unknown>
        if (type === UNIT_TYPE.manifest) {
            body.seq = 0
            body.createdAt = 0
        }
        out.push(`parent:${type}:${JSON.stringify(normalized(body))}`)
    }
    return out.sort()
}