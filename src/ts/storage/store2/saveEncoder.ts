import type { JsonObject, JsonValue } from '../blockFrame'
import type { Database, character, groupChat } from '../database.svelte'
import type { CommitRequest } from './commit'
import {
    acknowledgedBytesOf, builtCommitOf, characterMatchesAcknowledged, characterMatchesAcknowledgedPlain, CodecInputError, isColdStub,
    movable, overlayStub, planScopedEncode, plainObject, previousEntriesOf, previousFrom, sameJsonValue, verdictBaseOf,
    type AcknowledgedVerdict, type EncodedTree, type EncodeScope, type ListDerivation, type PreviousEncoding, type ReusableUnit,
    type ScopedPlan, type SkippedCharacter, type VerdictBase,
} from './codec'
import { isModuleStub } from '../moduleStub'
import { defaultKeyEnv, type KeyEnv, type ShardEntry } from './format'
import { stubDescription } from '../../process/coldCharacter'
import { MEASURE } from '../../process/memory/measureFlag'
import {
    finishSavePass, noteNetShadow, noteNetShadowEvent, noteNetShadowTripwire, noteNetSlotPart, noteSavePassCommit, startSavePass,
    startSplit, type NetShadowTag, type SaveMarkPeek, type SavePassSplitRecorder,
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
    /** Existing units the new manifest names without writing them, and the names (taken at plan time) of the characters and modules carried by key. */
    readonly carried: ScopedPlan['carried']
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
    /**
     * Whether a character is a cold stub or a module is a module stub. Such a slot is not resident, so save mine over a
     * base that does not name this page's manifest would carry keys the store may no longer hold.
     */
    hasStubs(db: Database): boolean
    /**
     * Whether a resident character is what the acknowledged encoding holds: `characterMatchesAcknowledged` plus the
     * `lastInteraction` and `trashTime` entry fields, which that primitive leaves to the stub overlay. `clean` means a
     * pass naming the character plans nothing for it. `unknown` while an attempt is pending, and for any fault of the
     * read (logged): only a full pass can answer then.
     *
     * Its only state is the value shadows. A resident whose last verdict was `clean` against the current acknowledged
     * encoding keeps its plain JSON tree (the value `toPlainJson` read) and its live `type`; the next visit that reads
     * a tree equal to it, with the same prologue result, answers the primitive's `clean` without re-deriving. The
     * verdict of the primitive is a function of that tree, the live `type`, the acknowledged encoding and the
     * encoder's constants, so equal inputs give an equal verdict. Every replacement of the acknowledged encoding and
     * every pending attempt drops all shadows.
     */
    verdictOf(slot: character | groupChat): AcknowledgedVerdict
    /**
     * Drops the shadow of every character not in `residents`. The idle net calls it with the resident ids it computed
     * for the slot, before any early return, so a character that was put back stops being held.
     */
    pruneShadows(residents: ReadonlySet<string>): void
    /** How many shadows are held and what they are charged in total: at most `SHADOW_TOTAL_BUDGET`. */
    shadowStats(): { entries: number, charged: number }
    /**
     * Whether a cold stub would make a full pass refuse it, load it or write it: its handle is not held, it names a
     * unit other than the entry's, its id is shared, its entry is missing or its overlaid entry differs from the
     * acknowledged one. Pure: it changes no state. The idle net does not call it: it uses `netScan`, and this is
     * `netScan`'s reference predicate (the two answer alike).
     */
    stubsNeedFullPass(db: Database): boolean
    /** The chaIds of the resident characters the acknowledged encoding cannot carry: the new-character rule of `plan`. */
    unheldChaIds(db: Database): string[]
    /**
     * The idle net's checks in one pass over `db.characters`, with every character's `chaId` and `coldstorage` read
     * once. Against `unheldChaIds`, `stubsNeedFullPass` and the resident list, as the net decides over them: `unheld`
     * equals `unheldChaIds(db).length > 0`; `stubsNeedFull` equals `stubsNeedFullPass(db)`, a fault of the stub part
     * answering `true` as there; `residents` are the `chaId`s of the non-stub object slots in list order (what
     * `residentChaIds` returns). A fault reading a slot's `chaId` or `coldstorage` propagates, as it does from
     * `unheldChaIds`. The pass never stops early, so a later fault still propagates. Pure: it changes no state.
     */
    netScan(db: Database): NetScan
}

/** What `SaveEncoder.netScan` answers. */
export interface NetScan {
    unheld: boolean
    stubsNeedFull: boolean
    residents: string[]
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

/** The largest charge one character's shadow may have, and the most all shadows together may be charged. Engineering constants, not settings. */
export const SHADOW_CHARACTER_CAP = 16 * 1024 * 1024
export const SHADOW_TOTAL_BUDGET = 64 * 1024 * 1024

/**
 * What a shadow is charged: an upper bound of the heap its tree pins, from the acknowledged framed bytes of the
 * character (twice that for text V8 keeps at two bytes per unit, plus a margin), a header per string and a cost per
 * object or array. The tree can outlive its character's residency until the next prune, so bytes are charged in full.
 */
export function shadowChargeOf(acknowledgedBytes: number, strings: number, containers: number): number {
    return Math.ceil(acknowledgedBytes * 2.2 + strings * 32 + containers * 200)
}

/** The strings and containers (objects and arrays) of a plain tree; one pass, only run when a shadow is admitted. */
function weighPlain(root: JsonValue): { strings: number, containers: number } {
    let strings = 0
    let containers = 0
    const pending: JsonValue[] = [root]
    for (let value = pending.pop(); value !== undefined; value = pending.pop()) {
        if (typeof value === 'string') {
            strings++
        } else if (typeof value === 'object' && value !== null) {
            containers++
            for (const child of Array.isArray(value) ? value : Object.values(value)) {
                pending.push(child)
            }
        }
    }
    return { strings, containers }
}

type PrimitiveValue = string | number | boolean | bigint | symbol | null | undefined

function isPrimitive(value: unknown): value is PrimitiveValue {
    return value === null || (typeof value !== 'object' && typeof value !== 'function')
}

/** What a shadow keeps of a clean character: its plain tree, the live `type` read with it, and what it is charged. */
interface VerdictShadow {
    plain: JsonObject
    type: PrimitiveValue
    charged: number
}

/** The id a character's shadow is held under; null when the slot is not an object or its id cannot be read. */
function shadowKeyOf(slot: character | groupChat): string | null {
    try {
        return typeof slot === 'object' && slot !== null ? String((slot as { chaId?: unknown }).chaId ?? '') : null
    } catch {
        return null
    }
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

/** The fields of a slot that `overlayStub` reads, as `netScan` reads them. */
interface OverlaidFields {
    name?: unknown
    creatorNotes?: unknown
    image?: unknown
    lastInteraction?: unknown
    trashTime?: unknown
    type?: unknown
    characters?: unknown
    tags?: unknown
    creator?: unknown
    additionalData?: { creator?: unknown } | null
}

/**
 * What `stubDescription` gave an entry's slot notes. The description is a pure function of the notes string, so the
 * memo is keyed by the entry only to bound its lifetime and holds the notes it was made from: a different value
 * computes again. The comparison with the entry's own `creatorNotes` is never memoised.
 */
const stubDescriptions = new WeakMap<ShardEntry, { notes: string, description: string }>()

function descriptionOf(entry: ShardEntry, notes: unknown): string {
    if (typeof notes !== 'string') {
        return stubDescription(notes)
    }
    const memo = stubDescriptions.get(entry)
    if (memo !== undefined && Object.is(memo.notes, notes)) {
        return memo.description
    }
    const description = stubDescription(notes)
    stubDescriptions.set(entry, { notes, description })
    return description
}

/** The strings of `live` in order (holes and non-strings dropped, as `stubTags` and a group's member filter do) are exactly `held`. */
function sameStringList(live: unknown, held: unknown): boolean {
    if (!Array.isArray(held)) {
        return false
    }
    let next = 0
    if (Array.isArray(live)) {
        for (let index = 0; index < live.length; index++) {
            const item: unknown = live[index]
            if (typeof item === 'string') {
                if (next >= held.length || !Object.is(item, held[next])) {
                    return false
                }
                next++
            }
        }
    }
    return next === held.length
}

/**
 * Whether `overlayStub(before, slot)` equals `before` under `sameJsonValue`, read in place. The overlay leaves the
 * fields it does not touch as the same references, so only its own fields can differ. An overlaid key that `before`
 * lacks adds a key (different), and a key the overlay deletes that `before` holds removes one (different).
 * INVARIANT: this inlines the fields `overlayStub` reads. A field added to the overlay must be added here, or a change
 * to it would read as clean; the `netScan` drift test perturbs every key of `stubFromEntry`.
 */
function overlayLeavesEntry(slot: OverlaidFields, before: ShardEntry): boolean {
    const held = (key: keyof ShardEntry): boolean => Object.hasOwn(before, key)
    const name = slot.name
    if (typeof name === 'string' ? !(held('name') && Object.is(name, before.name)) : !held('name')) {
        return false
    }
    if (!(held('creatorNotes') && Object.is(descriptionOf(before, slot.creatorNotes), before.creatorNotes))) {
        return false
    }
    const image = slot.image
    if (typeof image === 'string' ? !(held('image') && Object.is(image, before.image)) : held('image')) {
        return false
    }
    const lastInteraction = slot.lastInteraction
    if (typeof lastInteraction === 'number' ? !(held('lastInteraction') && Object.is(lastInteraction, before.lastInteraction)) : held('lastInteraction')) {
        return false
    }
    const trashTime = slot.trashTime
    if (typeof trashTime === 'number' ? !(held('trashTime') && Object.is(trashTime, before.trashTime)) : held('trashTime')) {
        return false
    }
    if (slot.type === 'group') {
        return held('characters') && sameStringList(slot.characters, before.characters)
    }
    if (!(held('tags') && sameStringList(slot.tags, before.tags))) {
        return false
    }
    const edited = slot.additionalData?.creator
    let creator = ''
    if (typeof edited === 'string' && edited.length > 0) {
        creator = edited
    } else if (typeof slot.creator === 'string') {
        creator = slot.creator
    }
    return held('creator') && Object.is(creator, before.creator)
}

/** See `SaveEncoder.netScan`. */
function netScanOver(db: Database, previous: PreviousEncoding): NetScan {
    const characters = db.characters
    if (!Array.isArray(characters)) {
        return { unheld: false, stubsNeedFull: false, residents: [] }
    }
    // The count of object slots per id: a slot's occurrence is the count before it, and the final count is the id's holders.
    const holders = new Map<string, number>()
    const residents: string[] = []
    const candidates: Array<{ chaId: string, u: string, slot: OverlaidFields }> = []
    let unheld = false
    let stubsNeedFull = false
    for (const slot of characters) {
        if (typeof slot !== 'object' || slot === null) {
            continue
        }
        const chaId = String((slot as { chaId?: unknown }).chaId ?? '')
        const coldstorage = (slot as { coldstorage?: unknown }).coldstorage
        const occurrence = holders.get(chaId) ?? 0
        holders.set(chaId, occurrence + 1)
        if (!coldstorage) {
            if (!previous.entities.has(`${chaId}#${occurrence}`)) {
                unheld = true
            }
            residents.push(chaId)
            continue
        }
        if (stubsNeedFull) {
            continue
        }
        const u = previous.entities.get(`${chaId}#${occurrence}`)
        if (u === undefined || coldstorage !== u || previous.entities.has(`${chaId}#1`)) {
            stubsNeedFull = true
            continue
        }
        candidates.push({ chaId, u, slot: slot as OverlaidFields })
    }
    if (!stubsNeedFull && candidates.length > 0) {
        try {
            // Every holder count is final here, so a shared id is known before any entry is looked up.
            if (candidates.some(candidate => (holders.get(candidate.chaId) ?? 0) > 1)) {
                stubsNeedFull = true
            } else {
                const entries = previousEntriesOf(previous)
                for (const candidate of candidates) {
                    const before = entries.get(candidate.u)
                    if (before === undefined || !overlayLeavesEntry(candidate.slot, before)) {
                        stubsNeedFull = true
                        break
                    }
                }
            }
        } catch (error) {
            console.error('The cold stubs could not be checked against the acknowledged encoding; a full pass will decide.', error)
            stubsNeedFull = true
        }
    }
    return { unheld, stubsNeedFull, residents }
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

    // The value shadows (see `SaveEncoder.verdictOf`), by `chaId`. They belong to one acknowledged encoding: `shadowOf`
    // is the one they were taken against, and `resetShadows` runs wherever `previous` is replaced or `pending` is set.
    const shadows = new Map<string, VerdictShadow>()
    let shadowOf: PreviousEncoding = previous
    let shadowsCharged = 0

    function dropShadow(chaId: string | null): void {
        const held = chaId === null ? undefined : shadows.get(chaId)
        if (chaId !== null && held !== undefined) {
            shadowsCharged -= held.charged
            shadows.delete(chaId)
            if (MEASURE) {
                noteNetShadowEvent('cleared')
            }
        }
    }

    function resetShadows(): void {
        if (MEASURE && shadows.size > 0) {
            noteNetShadowEvent('cleared', shadows.size)
        }
        shadows.clear()
        shadowsCharged = 0
        shadowOf = previous
    }

    /** Keeps the clean character's tree when admission allows; a character's earlier shadow is gone either way. */
    function admitShadow(base: VerdictBase, plain: JsonObject, type: unknown): void {
        const replaced = shadows.get(base.chaId)
        if (replaced !== undefined) {
            shadowsCharged -= replaced.charged
            shadows.delete(base.chaId)
        }
        if (isPrimitive(type)) {
            const { strings, containers } = weighPlain(plain)
            const charged = shadowChargeOf(acknowledgedBytesOf(previous, base.acknowledged), strings, containers)
            if (charged <= SHADOW_CHARACTER_CAP && shadowsCharged + charged <= SHADOW_TOTAL_BUDGET) {
                shadows.set(base.chaId, { plain, type, charged })
                shadowsCharged += charged
                return
            }
        }
        if (MEASURE) {
            noteNetShadowEvent('refused')
        }
    }

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
                carried: scoped.carried,
                commitRequest: () => ({
                    newUnits: scoped.newUnits,
                    carry: { from: manifestKeyOf(base), units: scoped.carried.units },
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
                    resetShadows()
                    if (MEASURE) {
                        noteSavePassCommit(request, built.units, split === null ? null : { split, acknowledgeMs, entities: built.index.entities })
                    }
                },
                keepAsPending: () => {
                    if (built === null) {
                        throw new SavePlanError('The plan was kept as pending before any build ran.')
                    }
                    pending = built
                    resetShadows()
                },
            }
        },
        adoptIfCurrent(currentKey) {
            if (pending === null || currentKey !== pending.manifestKey) {
                return false
            }
            previous = previousFrom(pending)
            pending = null
            resetShadows()
            return true
        },
        get pendingKey() {
            return pending === null ? null : pending.manifestKey
        },
        get manifestKey() {
            return manifestKeyOf(previous)
        },
        acknowledged: () => previous,
        hasStubs: db => (Array.isArray(db.characters) && db.characters.some(slot => typeof slot === 'object' && slot !== null && isColdStub(slot)))
            || (Array.isArray(db.modules) && db.modules.some(slot => isModuleStub(slot))),
        verdictOf(slot) {
            if (pending !== null) {
                if (MEASURE) {
                    noteNetShadow('none')
                }
                return 'unknown'
            }
            try {
                const primitiveStartedAt = MEASURE ? performance.now() : 0
                const verdictOptions = { env, lists: options.lists, previous }
                let verdict: AcknowledgedVerdict = 'unknown'
                let tag: NetShadowTag = 'none' // measurement builds only; folded out of a normal build
                const base = verdictBaseOf(slot, previous)
                if (base === null) {
                    dropShadow(shadowKeyOf(slot))
                } else {
                    // A fault of the read answers `unknown` silently, as the primitive does for the same fault.
                    let plain: JsonObject | null = null
                    try {
                        plain = plainObject(slot, 'characters[0]')
                    } catch {
                        dropShadow(base.chaId)
                    }
                    if (plain !== null) {
                        // The live `type` is the one input of the entry that is not in the plain tree's compare: a boxed
                        // or `toJSON` value can leave the tree equal while the entry reads it differently.
                        const liveType: unknown = (slot as { type?: unknown }).type
                        const held = shadowOf === previous ? shadows.get(base.chaId) : undefined
                        if (held !== undefined && Object.is(held.type, liveType) && sameJsonValue(plain, held.plain)) {
                            verdict = 'clean'
                            if (MEASURE) {
                                tag = 'hit'
                            }
                        } else {
                            if (MEASURE) {
                                tag = 'miss'
                            }
                            verdict = characterMatchesAcknowledgedPlain(slot, plain, base, verdictOptions)
                            if (verdict === 'clean') {
                                admitShadow(base, plain, liveType)
                            } else {
                                dropShadow(base.chaId)
                            }
                        }
                    }
                }
                if (MEASURE) {
                    noteNetSlotPart('primitiveMs', performance.now() - primitiveStartedAt)
                    // Every eighth hit is judged again by the full primitive on the live slot, which re-reads everything.
                    if (noteNetShadow(tag) && tag === 'hit' && base !== null) {
                        const tripwireStartedAt = performance.now()
                        const full = characterMatchesAcknowledged(slot, verdictOptions)
                        noteNetShadowTripwire(performance.now() - tripwireStartedAt)
                        if (full !== 'clean') {
                            noteNetShadowEvent('disagreed')
                            dropShadow(base.chaId)
                            verdict = full
                        }
                    }
                }
                if (verdict !== 'clean' || base === null) {
                    return verdict
                }
                const movedStartedAt = MEASURE ? performance.now() : 0
                const movedMatch = movedFieldsMatch(slot, base.acknowledged)
                if (MEASURE) {
                    noteNetSlotPart('movedMs', performance.now() - movedStartedAt)
                }
                return movedMatch ? 'clean' : 'dirty'
            } catch (error) {
                dropShadow(shadowKeyOf(slot))
                console.error('The verdict of a resident character could not be read; a full pass will decide.', error)
                return 'unknown'
            }
        },
        pruneShadows(residents) {
            for (const chaId of [...shadows.keys()]) {
                if (!residents.has(chaId)) {
                    dropShadow(chaId)
                }
            }
        },
        shadowStats: () => ({ entries: shadows.size, charged: shadowsCharged }),
        stubsNeedFullPass(db) {
            try {
                return stubsNeedFullPassOver(db, previous)
            } catch (error) {
                console.error('The cold stubs could not be checked against the acknowledged encoding; a full pass will decide.', error)
                return true
            }
        },
        unheldChaIds: db => unheldChaIds(db, previous),
        netScan: db => netScanOver(db, previous),
    }
}
