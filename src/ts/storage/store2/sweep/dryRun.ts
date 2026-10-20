import { inlayIdFromMetaKey, INLAY_META_PREFIX } from '../../../process/files/inlayKeys'
import type { ByteStore } from '../../store/contract'
import type { GateRefusal } from '../boot'
import { readUnit, SWEEP_KEY, UNIT_TYPE, type SweepRecord } from '../format'
import type { Store2Session } from '../session'
import { createBackendClosureReader } from './backendReader'
import { checkFences, type FenceReason } from './fences'
import { decideInlayDeletions, type InlayKeepReason } from './inlayRule'
import { buildClosureAssetKeepSet, buildInlayKeepSet, legacyFilesOf } from './keepSet'
import { decideAutoSweep, type AssetCount } from './limit'
import { SWEEP_AUTO_LIMIT } from './params'
import type { Incomplete, OwnerRef } from './types'

/**
 * The dry run of the asset sweep and of the inlay clean-up on a store2 page. It builds the
 * keep-sets exactly as a deleting pass would, lists the stored assets and inlays, and reports
 * what would be removed. It reads and never writes: no delete, no put, and no `store2-sweep`
 * record, so running it starts no age clock for a later sweep.
 *
 * Every refusal a deleting pass honours ends the run with its reason: the deleter gate (idle
 * session, absent or unusable commit key, fence, standing marker) first, then the fence check
 * over the manifests' legacy files. An incomplete keep-set reports its reasons and zero
 * candidates, never a partial list.
 */

/** The pieces of the session a dry run uses. */
export type SweepDryRunSession = Pick<Store2Session, 'backend' | 'openGate'>

export interface SweepDryRunEnv {
    session: SweepDryRunSession
    /** The page's byte store: `assets/`, `inlays/` and the age record are read through it. */
    store: ByteStore
    /** The asset names the live database refers to now; read once, after the stored assets are listed. */
    residentRefs(): Iterable<string>
    /** The `assets/<name>` keys this page wrote or tried to write; read with `residentRefs`. */
    writtenThisPage(): Iterable<string>
    /** Which of `ids` the resident database mentions. */
    residentInlays(ids: readonly string[]): Promise<ReadonlySet<string>>
    /** Whether the resident database speaks for every inlay id of the owner (see `decideInlayDeletions`). */
    isOwnerResident(owner: OwnerRef): boolean
    now?: () => number
    /** The automatic-sweep limit; defaults to `SWEEP_AUTO_LIMIT`. */
    limit?: number
    /** How many candidate names a report lists; defaults to `DEFAULT_SAMPLE`. */
    sampleSize?: number
}

export const DEFAULT_SAMPLE = 20

export interface CandidateSummary {
    /** How many candidates there are, whatever the sample holds. */
    count: number
    /** The first `sampleSize` candidates in ordinal order. */
    sample: string[]
}

export type KeepSetReport =
    | { keepSet: 'complete' }
    | { keepSet: 'incomplete', reasons: Incomplete[] }

export interface AssetsReport {
    /** The `assets/` count the store gave, or `unknown`. */
    count: AssetCount
    /** How many top-level asset names the listing returned. */
    listed: number
    limit: number
    /** Whether a sweep would run on its own: false above the limit or for an unknown count. */
    auto: boolean
    limitReason: 'within-limit' | 'over-limit' | 'unknown-count'
    keep: KeepSetReport
    /** Assets no keep-set member protects: zero while the keep-set is incomplete. */
    candidates: CandidateSummary
}

export interface InlaysReport {
    keep: KeepSetReport
    /** Stored inlay ids; zero candidates are decided while the keep-set is incomplete. */
    stored: number
    wouldDelete: CandidateSummary
    kept: Partial<Record<InlayKeepReason, number>>
    unknownOwners: number
}

export type AgeRecordReport =
    | { state: 'absent' | 'unreadable' | 'too-new' }
    | { state: 'ok', at: number, ageMs: number, items: number, stillCandidates: number }

export type SweepDryRunReport =
    | { status: 'refused', stage: 'gate', reason: GateRefusal, detail: string }
    | { status: 'refused', stage: 'fences', reasons: FenceReason[] }
    | { status: 'failed', stage: 'assets-listing' | 'inlay-listing', detail: string }
    | { status: 'done', currentManifest: string, assets: AssetsReport, inlays: InlaysReport, ageRecord: AgeRecordReport }

const ASSETS_PREFIX = 'assets/'

function summarize(names: readonly string[], sampleSize: number): CandidateSummary {
    const sorted = [...names].sort()
    return { count: sorted.length, sample: sorted.slice(0, sampleSize) }
}

/** The age record as stored, read and never written. */
async function readAgeRecord(store: ByteStore, candidates: ReadonlySet<string>, now: number): Promise<AgeRecordReport> {
    let bytes: Uint8Array | null
    try {
        bytes = (await store.read(SWEEP_KEY)).bytes
    } catch {
        return { state: 'unreadable' }
    }
    if (bytes === null) {
        return { state: 'absent' }
    }
    const unit = readUnit(bytes, UNIT_TYPE.sweepRecord)
    switch (unit.status) {
        case 'ok':
        case 'stale': {
            const record = unit.value.body as SweepRecord
            return {
                state: 'ok',
                at: record.at,
                ageMs: now - record.at,
                items: record.items.length,
                stillCandidates: record.items.filter(item => candidates.has(item[0])).length,
            }
        }
        case 'too-new':
            return { state: 'too-new' }
        default:
            return { state: 'unreadable' }
    }
}

function failureDetail(error: unknown): string {
    return error instanceof Error ? error.message : 'The store failed.'
}

export async function runSweepDryRun(env: SweepDryRunEnv): Promise<SweepDryRunReport> {
    const gate = await env.session.openGate('sweep')
    if (gate.status === 'refused') {
        return { status: 'refused', stage: 'gate', reason: gate.reason, detail: gate.detail }
    }
    const { backend } = env.session
    if (backend === null || gate.commit.current === null) {
        return { status: 'refused', stage: 'gate', reason: 'no-current', detail: 'The session has no backend or the commit key names no current manifest.' }
    }
    const { store } = env
    const now = (env.now ?? Date.now)()
    const limit = env.limit ?? SWEEP_AUTO_LIMIT
    const sampleSize = env.sampleSize ?? DEFAULT_SAMPLE

    let assetNames: string[]
    let assetCount: AssetCount
    let inlayIds: string[]
    try {
        const keys = await store.list(ASSETS_PREFIX)
        assetNames = keys.map(key => key.slice(ASSETS_PREFIX.length)).filter(name => !name.includes('/'))
        assetCount = store.countPrefix === undefined ? keys.length : (await store.countPrefix(ASSETS_PREFIX)) ?? 'unknown'
    } catch (error) {
        return { status: 'failed', stage: 'assets-listing', detail: failureDetail(error) }
    }
    try {
        inlayIds = (await store.list(INLAY_META_PREFIX))
            .map(inlayIdFromMetaKey)
            .filter((id): id is string => id !== null)
    } catch (error) {
        return { status: 'failed', stage: 'inlay-listing', detail: failureDetail(error) }
    }

    const reader = createBackendClosureReader(backend)
    const assetKeep = await buildClosureAssetKeepSet({
        commitKey: gate.commit,
        reader,
        residentRefs: env.residentRefs(),
        writtenThisPage: env.writtenThisPage(),
    })
    const inlayKeep = await buildInlayKeepSet({ commitKey: gate.commit, reader })

    const fences = checkFences({
        commitKey: { status: 'ok', value: gate.commit },
        fence: gate.fence === 'absent' ? 'absent' : 'present',
        legacyFiles: legacyFilesOf([...reader.manifests().values()]),
        tauriFlushPending: false,
        bulkMarkersSet: true,
    })
    if (fences.status === 'refused') {
        return { status: 'refused', stage: 'fences', reasons: fences.reasons }
    }

    const limitDecision = decideAutoSweep(assetCount, limit)
    const candidateNames = assetKeep.status === 'complete' ? assetNames.filter(name => !assetKeep.keep.holds(name)) : []
    const assets: AssetsReport = {
        count: assetCount,
        listed: assetNames.length,
        limit,
        auto: limitDecision.auto,
        limitReason: limitDecision.reason,
        keep: assetKeep.status === 'complete' ? { keepSet: 'complete' } : { keepSet: 'incomplete', reasons: assetKeep.reasons },
        candidates: summarize(candidateNames, sampleSize),
    }

    let inlays: InlaysReport
    if (inlayKeep.status === 'complete') {
        const resident = await env.residentInlays(inlayIds)
        const decision = decideInlayDeletions({
            keep: inlayKeep.keep,
            candidates: inlayIds,
            inResidentDatabase: id => resident.has(id),
            isOwnerResident: env.isOwnerResident,
        })
        const kept: Partial<Record<InlayKeepReason, number>> = {}
        for (const entry of decision.kept) {
            kept[entry.reason] = (kept[entry.reason] ?? 0) + 1
        }
        inlays = {
            keep: { keepSet: 'complete' },
            stored: inlayIds.length,
            wouldDelete: summarize(decision.delete, sampleSize),
            kept,
            unknownOwners: inlayKeep.keep.unknownOwners.length,
        }
    } else {
        inlays = {
            keep: { keepSet: 'incomplete', reasons: inlayKeep.reasons },
            stored: inlayIds.length,
            wouldDelete: summarize([], sampleSize),
            kept: {},
            unknownOwners: 0,
        }
    }

    return {
        status: 'done',
        currentManifest: gate.commit.current.key,
        assets,
        inlays,
        ageRecord: await readAgeRecord(store, new Set(candidateNames), now),
    }
}
