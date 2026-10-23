import type { Database, character, groupChat } from '../database.svelte'
import type { CommitRequest } from './commit'
import {
    builtCommitOf, characterMatchesAcknowledged, CodecInputError, isColdStub, movable, overlayStub, planScopedEncode, previousEntriesOf,
    previousEntryOf, previousFrom,
    type AcknowledgedVerdict, type EncodedTree, type EncodeScope, type ListDerivation, type PreviousEncoding, type ReusableUnit,
    type SkippedCharacter,
} from './codec'
import { defaultKeyEnv, type KeyEnv, type ShardEntry } from './format'
import { MEASURE } from '../../process/memory/measureFlag'
import {
    finishSavePass, noteSavePassCommit, startSavePass, startSplit, type SaveMarkPeek, type SavePassSplitRecorder,
} from './savePassMeter'

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
    /** The module effect flags fired, or the idle net has no resident character to carry the module check and the check is due. */
    modules: boolean
    /** Every resident non-stub character and the modules: the full-reload triggers. */
    whole: boolean
    /**
     * Idle net: one more resident character per tick. `modules` takes module scope at most once per the loop's
     * `moduleIntervalMs`; a check that fails waits for the next one.
     */
    net?: { chaId: string | null, modules: boolean }
    /**
     * Save mine: every unit but a stub's is written anew, nothing is reused. A stub's units are carried, since a stub
     * has no body to rewrite.
     */
    rewriteAll?: boolean
    /** Called after each module and each character that was encoded, so a long pass hands control back between them. */
    yield?: () => Promise<void>
    /**
     * Measurement builds only, set by the save loop for an idle-net tick: copies the tracker's marks without writing
     * them. The meter calls it at the plan's start and at its acknowledgement; nothing else reads it.
     */
    peekMarks?: () => SaveMarkPeek
    /** Measurement builds only: this plan is the second one of a tick, made after a stub was loaded. */
    retry?: boolean
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
    /**
     * The named characters this pass could not read and went on without: carried from the acknowledged encoding when it
     * holds them, left out when it does not. They count for nothing in `unchanged`.
     */
    readonly skipped: readonly SkippedCharacter[]
    /** The `chaId` of every character this pass encoded. */
    readonly encoded: readonly string[]
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
    /**
     * Whether a resident character is what the acknowledged encoding holds: `characterMatchesAcknowledged` plus the
     * `lastInteraction` and `trashTime` entry fields, which that primitive leaves to the stub overlay. `clean` means a
     * pass naming the character plans nothing for it. `unknown` while an attempt is pending, and for any fault of the
     * read (logged): only a full pass can answer then. Pure: it changes no state.
     */
    verdictOf(slot: character | groupChat): AcknowledgedVerdict
    /**
     * Whether a cold stub would make a full pass refuse it, load it or write it: its handle is not held, it names a
     * unit other than the entry's, its id is shared, its entry is missing or its overlaid entry differs from the
     * acknowledged one. Pure: it changes no state.
     */
    stubsNeedFullPass(db: Database): boolean
    /** The chaIds of the resident characters the acknowledged encoding cannot carry: the new-character rule of `plan`. */
    unheldChaIds(db: Database): string[]
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

const MOVED_ENTRY_FIELDS = ['lastInteraction', 'trashTime'] as const

/**
 * Whether the live `lastInteraction` and `trashTime` are what the entry holds. A pass writes a field to the entry only
 * when the codec would move it (`movable`), so an unmovable or removed value expects the entry without the field.
 */
function movedFieldsMatch(slot: character | groupChat, entry: ShardEntry): boolean {
    for (const name of MOVED_ENTRY_FIELDS) {
        const live = slot[name]
        const expected = live !== undefined && movable(name, live)
        if (expected !== Object.hasOwn(entry, name) || (expected && !Object.is(live, entry[name]))) {
            return false
        }
    }
    return true
}

function sameJsonValue(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) {
        return true
    }
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) {
        return false
    }
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    const keys = Object.keys(left)
    return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameJsonValue(left[key], right[key]))
}

function stubsNeedFullPassOver(db: Database, previous: PreviousEncoding): boolean {
    if (!Array.isArray(db.characters)) {
        return false
    }
    const slots = db.characters.filter((slot): slot is character | groupChat => typeof slot === 'object' && slot !== null)
    const holders = new Map<string, number>()
    for (const slot of slots) {
        const chaId = String((slot as { chaId?: unknown }).chaId ?? '')
        holders.set(chaId, (holders.get(chaId) ?? 0) + 1)
    }
    let entries: Map<string, ShardEntry> | null = null
    const seen = new Map<string, number>()
    for (const slot of slots) {
        const chaId = String((slot as { chaId?: unknown }).chaId ?? '')
        const occurrence = seen.get(chaId) ?? 0
        seen.set(chaId, occurrence + 1)
        if (!isColdStub(slot)) {
            continue
        }
        const u = previous.entities.get(`${chaId}#${occurrence}`)
        if (u === undefined || (slot as { coldstorage?: unknown }).coldstorage !== u
            || (holders.get(chaId) ?? 0) > 1 || previous.entities.has(`${chaId}#1`)) {
            return true
        }
        entries ??= previousEntriesOf(previous)
        const before = entries.get(u)
        if (before === undefined || !sameJsonValue(overlayStub(before, slot), before)) {
            return true
        }
    }
    return false
}

/** The encoding with no digest on any unit: nothing in it can be reused, while every key stays taken and every identity stays known. */
function withoutDigests(encoding: PreviousEncoding): PreviousEncoding {
    const units = new Map<string, ReusableUnit>()
    for (const [identity, unit] of encoding.units) {
        units.set(identity, { key: unit.key, type: unit.type, ref: unit.ref })
    }
    return { ...encoding, units }
}

function scopeOf(db: Database, previous: PreviousEncoding, request: SavePassRequest, split: SavePassSplitRecorder | null): EncodeScope {
    const everything = request.whole || request.rewriteAll === true
    const modules = everything || request.modules || request.net?.modules === true
    if (everything) {
        return { modules, characters: 'all', yield: request.yield, skipUnsavableCharacters: true }
    }
    const characters = new Set<string>(request.marked)
    const netChaId = request.net?.chaId
    if (typeof netChaId === 'string') {
        characters.add(netChaId)
    }
    const unheld = unheldChaIds(db, previous)
    if (MEASURE && split !== null) {
        split.noteUnheld(unheld)
    }
    for (const chaId of unheld) {
        characters.add(chaId)
    }
    return { modules, characters, yield: request.yield, skipUnsavableCharacters: true }
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
            const measuredAt = MEASURE ? startSavePass() : null
            const split = MEASURE ? startSplit(request) : null
            const scopeStarted = MEASURE && split !== null ? split.now() : 0
            const scope = scopeOf(db, base, request, split)
            if (MEASURE && split !== null) {
                split.addMs('splitScopeMs', split.now() - scopeStarted)
            }
            const scoped = await planScopedEncode(
                db,
                { env, lists: options.lists, seq: 0, createdAt: now(), previous: request.rewriteAll === true ? withoutDigests(base) : base },
                MEASURE && split !== null ? { ...scope, split } : scope,
            )
            if (MEASURE) {
                finishSavePass(measuredAt, request, scope.modules, scoped.encoded.length, split)
            }
            let built: EncodedTree | null = null
            return {
                newUnits: scoped.newUnits,
                unchanged: scoped.unchanged && pending === null && previous === base,
                skipped: scoped.skipped,
                encoded: scoped.encoded,
                commitRequest: () => ({
                    newUnits: scoped.newUnits,
                    build: (context) => {
                        const buildStarted = MEASURE && split !== null ? split.now() : 0
                        built = scoped.finalize(context)
                        if (MEASURE && split !== null) {
                            split.commitBuildMs(split.now() - buildStarted)
                        }
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
                    const acknowledgeStarted = MEASURE && split !== null ? split.now() : 0
                    previous = previousFrom(built)
                    const acknowledgeMs = MEASURE && split !== null ? split.now() - acknowledgeStarted : 0
                    pending = null
                    if (MEASURE) {
                        noteSavePassCommit(request, built.units, split === null ? null : { split, acknowledgeMs, entities: built.index.entities })
                    }
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
        verdictOf(slot) {
            if (pending !== null) {
                return 'unknown'
            }
            try {
                const verdict = characterMatchesAcknowledged(slot, { env, lists: options.lists, previous })
                if (verdict !== 'clean') {
                    return verdict
                }
                const chaId = String((slot as { chaId?: unknown }).chaId ?? '')
                const u = previous.entities.get(`${chaId}#0`)
                const entry = u === undefined ? undefined : previousEntryOf(previous, u)
                return entry !== undefined && movedFieldsMatch(slot, entry) ? 'clean' : 'dirty'
            } catch (error) {
                console.error('The verdict of a resident character could not be read; a full pass will decide.', error)
                return 'unknown'
            }
        },
        stubsNeedFullPass(db) {
            try {
                return stubsNeedFullPassOver(db, previous)
            } catch (error) {
                console.error('The cold stubs could not be checked against the acknowledged encoding; a full pass will decide.', error)
                return true
            }
        },
        unheldChaIds: db => unheldChaIds(db, previous),
    }
}
