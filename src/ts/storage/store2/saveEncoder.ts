import type { Database } from '../database.svelte'
import type { CommitRequest } from './commit'
import {
    builtCommitOf, CodecInputError, isColdStub, planScopedEncode, previousFrom,
    type EncodedTree, type EncodeScope, type ListDerivation, type PreviousEncoding, type ReusableUnit,
} from './codec'
import { defaultKeyEnv, type KeyEnv } from './format'

/**
 * The save encoder layer: between the mark tracker and `committer.commit`. It holds the encoding the store last
 * acknowledged and builds each pass over it with `planScopedEncode`.
 *
 * Every pass encodes the fixed group (config, order, statics, loadouts, presets, plugins, plugin storage, the lists,
 * the shards and the manifest) and compares it by digest, so a mutation of any of those needs no mark. Characters and
 * modules are the carried part: a resident character that is not named and the modules when they are not flagged are
 * kept from the acknowledged encoding. Only a character, or the modules, that a mark, a whole-resident pass, the idle
 * net or the new-character rule names is encoded.
 *
 * Single in flight: one plan is committed or abandoned before the next is made over the same encoder.
 */

export interface SavePassRequest {
    /** The chaIds of the characters the marks name (explicit marks, the selected-character effects, the identity tracker). */
    marked: ReadonlySet<string>
    /** The module effect flags fired, or the idle net owns the modules this tick. */
    modules: boolean
    /** Every resident non-stub character and the modules: the full-reload triggers. */
    whole: boolean
    /** Idle net: one more resident character per tick; `modules` is set on the first tick of a cycle. */
    net?: { chaId: string | null, modules: boolean }
    /**
     * Save mine: every unit but a stub's is written anew, nothing is reused. A stub's units are carried, since a stub
     * has no body to rewrite.
     */
    rewriteAll?: boolean
    /** Called after each character that was encoded, so a long pass hands control back between characters. */
    yield?: () => Promise<void>
}

export interface SavePlan {
    /** `CommitRequest.newUnits`: the units the commit writes, the manifest included. */
    readonly newUnits: number
    /**
     * No unit but the manifest would be written: the pass changed nothing and the commit can be skipped. Never true
     * while an attempt is pending: its write may have landed, so a pass that reverts it must commit. Nor is it ever true
     * when the acknowledged encoding moved while the plan was made: the plan compared against a base that is no longer
     * the store's, so its acknowledgement throws instead of the pass being skipped.
     */
    readonly unchanged: boolean
    /** The commit request of this plan; its build runs `finalize` under the attempt's own mint and keeps that tree. */
    commitRequest(): CommitRequest
    /**
     * After `committed`: the tree of the attempt that landed becomes the acknowledged encoding. Throws when no build
     * ran, and when the acknowledged encoding moved since this plan was made (a stale plan names keys it must not).
     */
    acknowledge(): void
    /** After `unknown`: the attempt is remembered so a later base read that shows its manifest current can adopt it. */
    keepAsPending(): void
}

export interface SaveEncoder {
    /** Plans one pass over the acknowledged encoding. Errors of the codec surface typed and unmodified. */
    plan(db: Database, request: SavePassRequest): Promise<SavePlan>
    /**
     * Adopts the pending attempt when `currentKey` is its manifest: the attempt landed after all. Every plan made
     * before an adoption is stale and must be made again.
     */
    adoptIfCurrent(currentKey: string | null): boolean
    /**
     * The manifest key of the attempt kept as pending, null when none: set by `keepAsPending`, cleared by an adoption
     * or by the acknowledgement of a later plan. The caller resolves it against the base read (`adoptIfCurrent`, or
     * the clearing acknowledgement) before it plans: a plan made before an adoption is stale and cannot be
     * acknowledged.
     */
    readonly pendingKey: string | null
    /** The manifest key of the acknowledged encoding. */
    readonly manifestKey: string
    /** The acknowledged encoding, read only: the loop compares a later put-back against the latest committed tree. */
    acknowledged(): PreviousEncoding
    hasStubs(db: Database): boolean
}

export interface SaveEncoderOptions {
    /** The acknowledged encoding of the tree the page booted from. */
    previous: PreviousEncoding
    lists: ListDerivation
    env?: KeyEnv
    now?: () => number
}

/** A plan used out of its protocol: acknowledged without a build, or after the acknowledged encoding moved. */
export class SavePlanError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'SavePlanError'
    }
}

function manifestKeyOf(encoding: PreviousEncoding): string {
    const unit = encoding.units.get('manifest')
    if (unit === undefined) {
        throw new CodecInputError('The acknowledged encoding holds no manifest unit.')
    }
    return unit.key
}

/** The chaIds of the resident characters whose handle (`chaId#occurrence`) the encoding does not hold: they cannot be carried. */
function unheldChaIds(db: Database, previous: PreviousEncoding): string[] {
    if (!Array.isArray(db.characters)) {
        return []
    }
    const occurrences = new Map<string, number>()
    const out: string[] = []
    for (const slot of db.characters) {
        if (typeof slot !== 'object' || slot === null) {
            continue
        }
        const chaId = String((slot as { chaId?: unknown }).chaId ?? '')
        const occurrence = occurrences.get(chaId) ?? 0
        occurrences.set(chaId, occurrence + 1)
        if (!isColdStub(slot) && !previous.entities.has(`${chaId}#${occurrence}`)) {
            out.push(chaId)
        }
    }
    return out
}

/** The encoding with no digest on any unit: nothing in it can be reused, while every key stays taken and every identity stays known. */
function withoutDigests(encoding: PreviousEncoding): PreviousEncoding {
    const units = new Map<string, ReusableUnit>()
    for (const [identity, unit] of encoding.units) {
        units.set(identity, { key: unit.key, type: unit.type, ref: unit.ref })
    }
    return { ...encoding, units }
}

function scopeOf(db: Database, previous: PreviousEncoding, request: SavePassRequest): EncodeScope {
    const everything = request.whole || request.rewriteAll === true
    const modules = everything || request.modules || request.net?.modules === true
    if (everything) {
        return { modules, characters: 'all', yield: request.yield }
    }
    const characters = new Set<string>(request.marked)
    const netChaId = request.net?.chaId
    if (typeof netChaId === 'string') {
        characters.add(netChaId)
    }
    for (const chaId of unheldChaIds(db, previous)) {
        characters.add(chaId)
    }
    return { modules, characters, yield: request.yield }
}

export function createSaveEncoder(options: SaveEncoderOptions): SaveEncoder {
    const env = options.env ?? defaultKeyEnv
    const now = options.now ?? (() => Date.now())
    let previous = options.previous
    let pending: EncodedTree | null = null
    manifestKeyOf(previous)

    return {
        async plan(db, request) {
            const base = previous
            const scoped = await planScopedEncode(
                db,
                { env, lists: options.lists, seq: 0, createdAt: now(), previous: request.rewriteAll === true ? withoutDigests(base) : base },
                scopeOf(db, base, request),
            )
            let built: EncodedTree | null = null
            return {
                newUnits: scoped.newUnits,
                unchanged: scoped.unchanged && pending === null && previous === base,
                commitRequest: () => ({
                    newUnits: scoped.newUnits,
                    build: (context) => {
                        built = scoped.finalize(context)
                        return builtCommitOf(built)
                    },
                }),
                acknowledge: () => {
                    if (built === null) {
                        throw new SavePlanError('The plan was acknowledged before any build ran.')
                    }
                    if (previous !== base) {
                        throw new SavePlanError('The acknowledged encoding moved since this plan was made.')
                    }
                    previous = previousFrom(built)
                    pending = null
                },
                keepAsPending: () => {
                    if (built === null) {
                        throw new SavePlanError('The plan was kept as pending before any build ran.')
                    }
                    pending = built
                },
            }
        },
        adoptIfCurrent(currentKey) {
            if (pending === null || currentKey !== pending.manifestKey) {
                return false
            }
            previous = previousFrom(pending)
            pending = null
            return true
        },
        get pendingKey() {
            return pending === null ? null : pending.manifestKey
        },
        get manifestKey() {
            return manifestKeyOf(previous)
        },
        acknowledged: () => previous,
        hasStubs: db => Array.isArray(db.characters) && db.characters.some(slot => typeof slot === 'object' && slot !== null && isColdStub(slot)),
    }
}
