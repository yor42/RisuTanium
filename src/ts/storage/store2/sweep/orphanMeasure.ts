import type { AppStoreKind } from '../../store/appStore'
import type { ByteStore } from '../../store/contract'
import type { GateRefusal } from '../boot'
import { AssetKeySet } from './assetKey'
import { createBackendClosureReader } from './backendReader'
import { DEFAULT_SAMPLE, type KeepSetReport, type SweepDryRunSession } from './dryRun'
import { checkFences, type FenceReason } from './fences'
import { buildClosureAssetKeepSet, legacyFilesOf } from './keepSet'
import type { AssetCount } from './limit'
import type { AssetKeepSet, KeepSetResult } from './types'

/**
 * The measurement of the assets no manifest of a store2 page refers to. It lists the stored assets and reports how many, and how
 * many bytes, nothing protects at two depths: from the current head alone, and from the current manifest plus the retained
 * restore points and the pins (the keep-set a deleting sweep would apply). It reads and never writes: no delete, no put, no
 * `store2-sweep` record, so measuring starts no age clock. It reuses the sweep's gate, closure reader, keep-set builder and
 * fence check unchanged; the page's own references (resident database, assets written this page) count as protected in both.
 *
 * A tier is reported only when every keep-set it depends on is complete: otherwise it is `null`, never a partial count.
 */

export interface AssetOrphanEnv {
    session: SweepDryRunSession
    /** The page's byte store: `assets/` is listed and sized through it. */
    store: ByteStore
    /** The asset names the live database refers to now; read once, after the stored assets are listed. */
    residentRefs(): Iterable<string>
    /** The `assets/<name>` keys this page wrote or tried to write; read with `residentRefs`. */
    writtenThisPage(): Iterable<string>
    /** How many names each tier lists; defaults to `DEFAULT_SAMPLE`. */
    sampleSize?: number
    /** Whether the stored sizes are summed; defaults to true. False leaves every `bytes` null and reads no size. */
    measureBytes?: boolean
    storeKind?: AppStoreKind
    /**
     * The stored size of a key without moving its body: `null` for an absent key, a rejection for any other failure.
     * Takes precedence over every other size source.
     */
    sizeOf?: (key: string) => Promise<number | null>
}

/** What a caller of the console action may set; the rest of the environment comes from the page. */
export type AssetOrphanOptions = Pick<AssetOrphanEnv, 'measureBytes' | 'sampleSize'>

export interface OrphanTier {
    /** How many names the tier holds, whatever the sample lists. */
    count: number
    /** The summed stored size, or null when the sizes were not measured or the pass failed. */
    bytes: number | null
    /** The first `sampleSize` names in ordinal order. */
    sample: string[]
}

export type OrphanBytesSource = 'stat' | 'listSized' | 'readValue' | 'read'

export type AssetOrphanReport =
    | { status: 'refused', stage: 'gate', reason: GateRefusal, detail: string }
    | { status: 'refused', stage: 'fences', reasons: FenceReason[] }
    | { status: 'failed', stage: 'assets-listing', detail: string }
    | {
        status: 'done'
        storeKind: AppStoreKind | null
        currentManifest: string
        retained: number
        pins: number
        /** Whether the current manifest carries a converted profile's legacy list, which may hold old orphans in both tiers. */
        legacyKeepInHead: boolean
        listed: number
        /** The `assets/` count the store gave, or `unknown`. */
        count: AssetCount
        keep: { head: KeepSetReport, full: KeepSetReport }
        /** Unprotected by the current manifest alone; needs `keep.head` complete. */
        notInHead: OrphanTier | null
        /** Unprotected by current, retained and pinned manifests: the dry run's candidates. Needs `keep.full` complete. */
        notInAny: OrphanTier | null
        /** Held only by restore points or pins: in `notInHead` but not in `notInAny`. Needs both. */
        restorePointsOnly: OrphanTier | null
        /** Protected only by this page (resident database or written this page); its bytes are not measured. */
        pageOnly: OrphanTier | null
        /** The source the sizes came from, or the one that failed; null when no size pass ran or the source could not be chosen (`bytesDetail` then names the failure). */
        bytesSource: OrphanBytesSource | null
        bytesDetail?: string
        /** Names the size source found absent between the listing and the size pass; they count 0 bytes. */
        vanished: number
    }

const ASSETS_PREFIX = 'assets/'

function failureDetail(error: unknown): string {
    return error instanceof Error ? error.message : 'The store failed.'
}

function keepReport<K extends AssetKeepSet>(result: KeepSetResult<K>): KeepSetReport {
    return result.status === 'complete' ? { keepSet: 'complete' } : { keepSet: 'incomplete', reasons: result.reasons }
}

/** The stored size of one name from the first source the store offers. */
interface SizeSource {
    source: OrphanBytesSource
    /** The size in bytes, or null when the key is absent. */
    sizeOf(name: string): Promise<number | null>
}

async function chooseSizeSource(env: AssetOrphanEnv): Promise<SizeSource> {
    const { store } = env
    if (env.sizeOf !== undefined) {
        const sizeOf = env.sizeOf
        return { source: 'stat', sizeOf: name => sizeOf(`${ASSETS_PREFIX}${name}`) }
    }
    if (store.listSized !== undefined) {
        const sized = await store.listSized(ASSETS_PREFIX, 0)
        if (sized !== null) {
            // The answer holds only keys above the minimum, so a key it omits is empty (or gone since the listing), not absent.
            const sizes = new Map(sized.map(entry => [entry.key, entry.size]))
            return { source: 'listSized', sizeOf: async name => sizes.get(`${ASSETS_PREFIX}${name}`) ?? 0 }
        }
    }
    if (store.readValue !== undefined) {
        const readValue = store.readValue.bind(store)
        return {
            source: 'readValue',
            sizeOf: async name => {
                const value = await readValue(`${ASSETS_PREFIX}${name}`)
                if (value === null) {
                    return null
                }
                return value instanceof Uint8Array ? value.length : value.size
            },
        }
    }
    return {
        source: 'read',
        sizeOf: async name => {
            const { bytes } = await store.read(`${ASSETS_PREFIX}${name}`)
            return bytes === null ? null : bytes.length
        },
    }
}

interface SizePass {
    source: OrphanBytesSource | null
    sizes: Map<string, number> | null
    vanished: number
    detail?: string
}

/** Sizes `names` one at a time; any failure ends the pass with no sizes, never a partial sum. */
async function sizePass(env: AssetOrphanEnv, names: readonly string[]): Promise<SizePass> {
    let source: OrphanBytesSource | null = null
    try {
        const chosen = await chooseSizeSource(env)
        source = chosen.source
        const sizes = new Map<string, number>()
        let vanished = 0
        for (const name of names) {
            const size = await chosen.sizeOf(name)
            if (size === null) {
                vanished++
                sizes.set(name, 0)
            } else {
                sizes.set(name, size)
            }
        }
        return { source, sizes, vanished }
    } catch (error) {
        return { source, sizes: null, vanished: 0, detail: failureDetail(error) }
    }
}

function tierOf(names: readonly string[], sizes: ReadonlyMap<string, number> | null, sampleSize: number): OrphanTier {
    const sorted = [...names].sort()
    let bytes: number | null = null
    if (sizes !== null) {
        bytes = 0
        for (const name of sorted) {
            bytes += sizes.get(name) ?? 0
        }
    }
    return { count: sorted.length, bytes, sample: sorted.slice(0, sampleSize) }
}

export async function measureAssetOrphans(env: AssetOrphanEnv): Promise<AssetOrphanReport> {
    const gate = await env.session.openGate('sweep')
    if (gate.status === 'refused') {
        return { status: 'refused', stage: 'gate', reason: gate.reason, detail: gate.detail }
    }
    const { backend } = env.session
    if (backend === null || gate.commit.current === null) {
        return { status: 'refused', stage: 'gate', reason: 'no-current', detail: 'The session has no backend or the commit key names no current manifest.' }
    }
    const { store } = env
    const sampleSize = env.sampleSize ?? DEFAULT_SAMPLE

    let assetNames: string[]
    let assetCount: AssetCount
    try {
        const keys = await store.list(ASSETS_PREFIX)
        assetNames = keys.map(key => key.slice(ASSETS_PREFIX.length)).filter(name => !name.includes('/'))
        assetCount = store.countPrefix === undefined ? keys.length : (await store.countPrefix(ASSETS_PREFIX)) ?? 'unknown'
    } catch (error) {
        return { status: 'failed', stage: 'assets-listing', detail: failureDetail(error) }
    }

    const page = new AssetKeySet()
    for (const name of env.residentRefs()) {
        page.addName(name)
    }
    for (const name of env.writtenThisPage()) {
        page.addName(name)
    }

    // One reader serves both builds, so each unit is read once; the head key walks the current manifest alone.
    const reader = createBackendClosureReader(backend)
    const full = await buildClosureAssetKeepSet({ commitKey: gate.commit, reader })
    const head = await buildClosureAssetKeepSet({ commitKey: { ...gate.commit, retained: [], pins: [] }, reader })

    const manifests = [...reader.manifests().values()]
    const fences = checkFences({
        commitKey: { status: 'ok', value: gate.commit },
        fence: gate.fence === 'absent' ? 'absent' : 'present',
        legacyFiles: legacyFilesOf(manifests),
        tauriFlushPending: false,
        bulkMarkersSet: true,
    })
    if (fences.status === 'refused') {
        return { status: 'refused', stage: 'fences', reasons: fences.reasons }
    }

    const headKeep = head.status === 'complete' ? head.keep : null
    const fullKeep = full.status === 'complete' ? full.keep : null

    const inHead = headKeep === null ? null : assetNames.filter(name => !headKeep.holds(name) && !page.holds(name))
    const inAny = fullKeep === null ? null : assetNames.filter(name => !fullKeep.holds(name) && !page.holds(name))
    const restoreOnly = inHead === null || fullKeep === null ? null : inHead.filter(name => fullKeep.holds(name))
    const pageNames = fullKeep === null ? null : assetNames.filter(name => !fullKeep.holds(name) && page.holds(name))

    // The tiers that need a measured size are all subsets of `inHead`, so one pass over it sizes them.
    let pass: SizePass = { source: null, sizes: null, vanished: 0 }
    if (env.measureBytes !== false && inHead !== null) {
        pass = await sizePass(env, inHead)
    }

    return {
        status: 'done',
        storeKind: env.storeKind ?? null,
        currentManifest: gate.commit.current.key,
        retained: gate.commit.retained.length,
        pins: gate.commit.pins.length,
        legacyKeepInHead: reader.manifests().get(gate.commit.current.key)?.fixed.legacyKeep != null,
        listed: assetNames.length,
        count: assetCount,
        keep: { head: keepReport(head), full: keepReport(full) },
        notInHead: inHead === null ? null : tierOf(inHead, pass.sizes, sampleSize),
        notInAny: inAny === null ? null : tierOf(inAny, pass.sizes, sampleSize),
        restorePointsOnly: restoreOnly === null ? null : tierOf(restoreOnly, pass.sizes, sampleSize),
        pageOnly: pageNames === null ? null : tierOf(pageNames, null, sampleSize),
        bytesSource: pass.source,
        ...(pass.detail === undefined ? {} : { bytesDetail: pass.detail }),
        vanished: pass.vanished,
    }
}
