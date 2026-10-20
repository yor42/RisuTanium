import type { JsonObject, JsonValue } from '../../blockFrame'
import type { Database, character, groupChat } from '../../database.svelte'
import { characterCreator, stubDescription, stubTags } from '../../../process/coldCharacter'
import {
    encodeUnit, KEY_ALPHABET, keyOfTail, refOfFrame, tailOfKey, UNIT_TYPE,
    type KeyEnv, type Manifest, type ModuleIndex, type Ref, type Shard, type ShardEntry, type UnitType,
} from '../format'
import type { BuildContext, BuiltCommit, KeyMint } from '../commit'
import { defineOwn } from './normalize'
import { isUnchanged, unitDigest, UnitNotReusedError, UnitSink, type UnitKeyKind } from './reuse'
import {
    checkDatabase, encodeCharacter, encodeFront, encodeModuleSet, Encoder, finishTree, IDENTITY,
    type ModuleSet,
} from './split'
import { isColdStub } from './stub'
import {
    CodecError, CodecInputError, SharedChaIdStubError, StubRefusedError, type EncodedTree, type EncodedUnit, type EncodeOptions,
    type ListDerivation, type PreviousEncoding, type ReusableUnit,
} from './types'

/**
 * Owner-scoped encode: the pass encodes only what the caller says changed and
 * carries the rest from `previous`. A carried unit costs nothing: it is stored
 * already, it is not in `units`, and it stays in `index.units` so the next pass
 * can carry or reuse it. Everything outside the carried set is encoded every
 * pass (config, order, statics, loadouts, presets, plugins, plugin storage and
 * its buckets, the shards, the manifest); a unit whose bytes did not change is
 * still reused by `UnitSink`, so it writes nothing.
 */

type Slot = character | groupChat

export interface EncodeScope {
    /** Encode the modules and the module index; false carries both from `previous`. */
    modules: boolean
    /**
     * The `chaId` of the resident characters to encode (every holder of that id), or `'all'` for every resident
     * non-stub character. A resident character not named is carried from `previous`; a stub is never encoded.
     */
    characters: ReadonlySet<string> | 'all'
    /** Called once after each character that was encoded, so a long pass hands control back between characters. */
    yield?: () => Promise<void>
}

interface ParentBody {
    type: EncodedUnit['type']
    body: object
}

function previousEntriesOf(previous: PreviousEncoding | null): Map<string, ShardEntry> {
    const shards = previous?.objects?.shards
    if (shards === undefined) {
        throw new CodecInputError('A carried character needs the previous encoding\'s shards, which it does not hold.')
    }
    const entries = new Map<string, ShardEntry>()
    for (const shard of shards) {
        for (const entry of shard.entries) {
            entries.set(entry.u, entry)
        }
    }
    return entries
}

/** The module index and its Ref as the previous encoding holds them. */
function carriedModuleSet(previous: PreviousEncoding | null): ModuleSet {
    const body = previous?.objects?.moduleIndex
    const unit = previous?.units.get(IDENTITY.moduleIndex)
    if (body === undefined || unit === undefined) {
        throw new CodecInputError('The modules are carried from the previous encoding, which does not hold a module index.')
    }
    return { body, ref: [unit.ref[0], unit.ref[1], unit.ref[2]] }
}

/**
 * A stub's shard entry: the previous entry with the fields a stub may change
 * since then. The stub's own `chatPage` and `firstMsgIndex` are placeholders
 * and its chats are a pointer, so the previous entry's values stay; no body of
 * the stub is encoded.
 */
export function overlayStub(before: ShardEntry, slot: Slot): ShardEntry {
    const entry: ShardEntry = { ...before }
    entry.name = typeof slot.name === 'string' ? slot.name : before.name
    entry.creatorNotes = stubDescription(slot.creatorNotes)
    if (typeof slot.image === 'string') {
        entry.image = slot.image
    } else {
        delete entry.image
    }
    if (typeof slot.lastInteraction === 'number') {
        entry.lastInteraction = slot.lastInteraction
    } else {
        delete entry.lastInteraction
    }
    if (typeof slot.trashTime === 'number') {
        entry.trashTime = slot.trashTime
    } else {
        delete entry.trashTime
    }
    if (slot.type === 'group') {
        entry.characters = Array.isArray(slot.characters) ? slot.characters.filter((member): member is string => typeof member === 'string') : []
    } else {
        entry.tags = stubTags(slot)
        entry.creator = characterCreator(slot)
    }
    return entry
}

function carriedEntry(slot: Slot, chaId: string, encoder: Encoder, previousEntries: () => Map<string, ShardEntry>): ShardEntry {
    const stub = isColdStub(slot)
    let u: string
    try {
        u = encoder.carriedU(chaId)
    } catch (error) {
        // A stub the previous encoding does not hold has no body to fall back on: refuse, never invent one.
        if (stub && error instanceof CodecInputError) {
            throw new StubRefusedError('character', chaId, null)
        }
        throw error
    }
    const before = previousEntries().get(u)
    if (before === undefined) {
        if (stub) {
            throw new StubRefusedError('character', chaId, null)
        }
        throw new CodecInputError(`The character ${chaId} is carried from the previous encoding, whose shards do not hold it.`)
    }
    // A stub names its units by `u`. One that names another entity's units, a legacy file or a `u` this encoding no
    // longer holds under this id would be saved over an entry it does not stand for.
    if (stub && (slot as { coldstorage?: unknown }).coldstorage !== u) {
        throw new StubRefusedError('character', chaId, null)
    }
    return stub ? overlayStub(before, slot) : before
}

type Owner = { kind: 'character', u: string } | { kind: 'modules' } | null

/** The entity id of an identity, `u` being 26 digits. */
const ENTITY_ID_LENGTH = 26

/** What owns a previous unit, by its identity; null for a unit every pass encodes again. */
function ownerOf(identity: string): Owner {
    if (identity.startsWith(IDENTITY.char) || identity.startsWith(IDENTITY.chat)) {
        // `char:` and `chat:` have the same length.
        const start = IDENTITY.char.length
        const end = start + ENTITY_ID_LENGTH
        return identity[end] === ':' ? { kind: 'character', u: identity.slice(start, end) } : null
    }
    if (identity.startsWith(IDENTITY.alChar) || identity.startsWith(IDENTITY.ilChar)) {
        const start = IDENTITY.alChar.length
        return identity.length === start + ENTITY_ID_LENGTH ? { kind: 'character', u: identity.slice(start) } : null
    }
    if (identity === IDENTITY.moduleIndex || identity.startsWith(IDENTITY.module)
        || identity.startsWith(IDENTITY.alModule) || identity.startsWith(IDENTITY.ilModule)) {
        return { kind: 'modules' }
    }
    return null
}

/** The previous units this pass kept: those of a carried character and, when the modules are carried, the modules'. */
function carriedUnits(previous: PreviousEncoding | null, carriedOwners: ReadonlySet<string>, modulesCarried: boolean): Map<string, ReusableUnit> {
    const carried = new Map<string, ReusableUnit>()
    if (previous === null) {
        return carried
    }
    for (const [identity, unit] of previous.units) {
        const owner = ownerOf(identity)
        if (owner === null) {
            continue
        }
        if (owner.kind === 'character' ? carriedOwners.has(owner.u) : modulesCarried) {
            carried.set(identity, unit)
        }
    }
    return carried
}

/**
 * The `chaId`s held by more than one character of `db`, or by more than one handle of the previous encoding. The
 * entity id of a repeated id is matched by occurrence, which a deletion or a reorder of the holders shifts.
 */
function ambiguousChaIds(characters: readonly Slot[], previous: PreviousEncoding | null): Set<string> {
    const ambiguous = new Set<string>()
    const seen = new Set<string>()
    for (const slot of characters) {
        const chaId = String((slot as { chaId?: unknown } | null)?.chaId ?? '')
        if (seen.has(chaId)) {
            ambiguous.add(chaId)
        }
        seen.add(chaId)
    }
    if (previous !== null) {
        for (const handle of previous.entities.keys()) {
            const split = handle.lastIndexOf('#')
            if (split >= 0 && handle.slice(split + 1) !== '0') {
                ambiguous.add(handle.slice(0, split))
            }
        }
    }
    return ambiguous
}

async function encodeScopedParts(db: Database, options: EncodeOptions, scope: EncodeScope): Promise<{ tree: EncodedTree, parents: ReadonlyMap<string, ParentBody> }> {
    checkDatabase(db, options)
    const previous = options.previous ?? null
    const encoder = new Encoder(options, previous)
    const front = encodeFront(db, encoder)
    const moduleSet = scope.modules ? encodeModuleSet(db, encoder) : carriedModuleSet(previous)

    let previousEntries: Map<string, ShardEntry> | null = null
    const entriesOfPrevious = (): Map<string, ShardEntry> => {
        previousEntries ??= previousEntriesOf(previous)
        return previousEntries
    }
    const entries: ShardEntry[] = []
    const carriedOwners = new Set<string>()
    // One consistent character list per pass: `db.characters` is read here, before any await, and never again. A
    // list edit during a yield (splice, reassign, unshift) reaches the next pass, so the committed tree holds exactly
    // this list. Each slot is encoded synchronously on its turn; an edit inside a slot after its turn is the next
    // pass's. `finishTree` takes its characters from `entries` and `configFields` leaves the field out.
    const characters: readonly Slot[] = [...db.characters]
    const ambiguous = ambiguousChaIds(characters, previous)
    for (let position = 0; position < characters.length; position++) {
        const slot = characters[position]
        if (typeof slot !== 'object' || slot === null) {
            throw new CodecInputError(`characters[${position}] is not an object.`)
        }
        const chaId = String((slot as { chaId?: unknown }).chaId ?? '')
        const stub = isColdStub(slot)
        if (stub && ambiguous.has(chaId)) {
            throw new SharedChaIdStubError(chaId)
        }
        // A shared id is never carried: which previous entry belongs to which holder cannot be told from the id.
        const named = !stub && (scope.characters === 'all' || scope.characters.has(chaId) || ambiguous.has(chaId))
        if (named) {
            entries.push(encodeCharacter(slot, position, encoder))
            await scope.yield?.()
        } else {
            const entry = carriedEntry(slot, chaId, encoder, entriesOfPrevious)
            carriedOwners.add(entry.u)
            entries.push(entry)
        }
    }
    const carried = carriedUnits(previous, carriedOwners, !scope.modules)
    return { tree: finishTree(db, encoder, front, moduleSet, entries, carried), parents: encoder.parents }
}

/**
 * Encodes `db` for the pass `scope` describes. With every character named and
 * the modules flagged the result is `encodeDatabase`'s, key for key. Keys come
 * from `options.keys` when given.
 */
export async function encodeScoped(db: Database, options: EncodeOptions, scope: EncodeScope): Promise<EncodedTree> {
    return (await encodeScopedParts(db, options, scope)).tree
}

// ---- mint bridge ----

/** Leading digits of every placeholder key; a real key is random, so none of its Refs begins with these. */
const PLACEHOLDER_LEAD = 'vvvvvvvvvv'
const PLACEHOLDER_COUNTER_DIGITS = 16

/** Mints keys of the right shape that name nothing real: the first encode of a plan runs under them. */
function placeholderMint(): KeyMint {
    let counter = 0
    const digits = (): string => {
        counter++
        let rest = counter
        let out = ''
        for (let i = 0; i < PLACEHOLDER_COUNTER_DIGITS; i++) {
            out = KEY_ALPHABET[rest % KEY_ALPHABET.length] + out
            rest = Math.floor(rest / KEY_ALPHABET.length)
        }
        return PLACEHOLDER_LEAD + out
    }
    return {
        shard: () => keyOfTail(`s-${digits()}`),
        unit: () => keyOfTail(`u-${digits()}`),
        manifest: () => keyOfTail(`m-${digits()}`),
    }
}

function isRefShape(value: JsonValue[]): value is [string, number, number, ...JsonValue[]] {
    return (value.length === 3 || value.length === 4)
        && typeof value[0] === 'string' && typeof value[1] === 'number' && typeof value[2] === 'number'
}

function rewriteValue(value: JsonValue, finalRefs: ReadonlyMap<string, Ref>): JsonValue {
    if (Array.isArray(value)) {
        const target = isRefShape(value) ? finalRefs.get(value[0]) : undefined
        if (target !== undefined) {
            return [target[0], target[1], target[2], ...value.slice(3).map(item => rewriteValue(item, finalRefs))]
        }
        return value.map(item => rewriteValue(item, finalRefs))
    }
    if (typeof value === 'object' && value !== null) {
        const copy: JsonObject = {}
        for (const key of Object.keys(value)) {
            defineOwn(copy, key, rewriteValue(value[key], finalRefs))
        }
        return copy
    }
    return value
}

/**
 * A copy of the parent body with every Ref to a placeholder unit replaced by the
 * unit's final Ref. Only parent bodies are walked. Besides Refs they hold user
 * strings (names, descriptions, tags) and fields carried from earlier bodies;
 * those are scalars or arrays of strings, and a rewrite needs an array that
 * starts with a placeholder tail and continues with two numbers, which neither
 * can be.
 */
function rewriteRefs<T extends object>(body: T, finalRefs: ReadonlyMap<string, Ref>): T {
    // The parent bodies are format objects of JSON values; the walk returns the same shape.
    return rewriteValue(body as unknown as JsonValue, finalRefs) as unknown as T
}

/**
 * The tree under real keys: every unit the plan would write gets a key of `mint`,
 * in the order a single encode under that mint would draw them. A unit whose
 * bytes do not hold a Ref (a leaf) keeps its bytes. A parent is rewritten, and
 * framed again, over the final Refs of its children; children precede their
 * parents in `units`, so one in-order pass has every Ref it needs.
 */
function rekey(tree: EncodedTree, parents: ReadonlyMap<string, ParentBody>, context: BuildContext): EncodedTree {
    const { mint } = context
    const finalRefs = new Map<string, Ref>()
    const rewritten = new Map<string, object>()
    const units: EncodedUnit[] = []
    for (const unit of tree.units) {
        if (unit.reused) {
            units.push(unit)
            continue
        }
        const key = unit.type === UNIT_TYPE.shard ? mint.shard() : unit.type === UNIT_TYPE.manifest ? mint.manifest() : mint.unit()
        const parent = parents.get(unit.identity)
        let bytes = unit.bytes
        let digest = unit.digest
        if (parent !== undefined) {
            let body = rewriteRefs(parent.body, finalRefs)
            if (unit.type === UNIT_TYPE.manifest) {
                // The attempt's own seq and clock reading, not the plan-time ones.
                body = { ...(body as Manifest), seq: context.seq, createdAt: context.now }
            }
            rewritten.set(unit.identity, body)
            bytes = encodeUnit(parent.type, body)
            digest = unitDigest(bytes)
        }
        const next: EncodedUnit = { ...unit, key, bytes, digest, ref: refOfFrame(key, bytes) }
        finalRefs.set(tailOfKey(unit.key), next.ref)
        units.push(next)
    }

    const rewrittenOr = <T extends object>(identity: string, fallback: T): T => {
        const body = rewritten.get(identity)
        return body === undefined ? fallback : body as T
    }
    const indexUnits = new Map(tree.index.units)
    for (const unit of units) {
        if (!unit.reused) {
            indexUnits.set(unit.identity, { key: unit.key, type: unit.type, ref: unit.ref, digest: unit.digest })
        }
    }
    const before = tree.index.objects
    const manifest = rewrittenOr('manifest', tree.manifest)
    const shards = (before?.shards ?? []).map((shard: Shard, index) => rewrittenOr(`shard:${index}`, shard))
    const moduleIndex = before?.moduleIndex === undefined ? undefined : rewrittenOr<ModuleIndex>(IDENTITY.moduleIndex, before.moduleIndex)
    const objects = moduleIndex === undefined ? { manifest, shards } : { manifest, shards, moduleIndex }
    return {
        manifestKey: units[units.length - 1].key,
        manifest,
        units,
        index: { units: indexUnits, entities: tree.index.entities, objects },
    }
}

export interface ScopedPlan {
    /** How many units the commit writes, the manifest included: the `newUnits` of the `CommitRequest`, known before any key exists. */
    newUnits: number
    /** True iff the only unit the commit would write is the manifest: nothing changed, and the caller can skip the commit. */
    unchanged: boolean
    /**
     * The tree under the keys of `context.mint`, its manifest carrying `context.seq` and `context.now`. Pure over the
     * plan: a commit that builds again on a retry calls it again with the retry's own context, and every call gives a
     * tree whose written units are exactly `newUnits` under that mint's keys. The next pass's `previous` must come only
     * from the tree of the attempt that committed: the tree of a failed or abandoned attempt names keys never written.
     */
    finalize(context: BuildContext): EncodedTree
}

/**
 * Encodes once under placeholder keys to learn which units are new, then hands
 * back a plan whose `finalize` gives every new unit a key of the commit
 * attempt's mint. A new unit never matches a previous key, so a parent differs
 * from its previous bytes exactly when one of its children is new or its own
 * content changed, and the decision is the same under the real keys. `options.keys`
 * is ignored: the plan owns the keys.
 */
export async function planScopedEncode(db: Database, options: EncodeOptions, scope: EncodeScope): Promise<ScopedPlan> {
    const { tree, parents } = await encodeScopedParts(db, { ...options, keys: placeholderMint() }, scope)
    return {
        newUnits: tree.units.filter(unit => !unit.reused).length,
        unchanged: isUnchanged(tree),
        finalize: context => rekey(tree, parents, context),
    }
}

// ---- acknowledged-state verdict ----

/**
 * Whether a live character is what the latest acknowledged encoding holds for it: `clean` when every unit is the
 * acknowledged one and the entry agrees outside the overlay fields (`lastInteraction`, `trashTime`), `dirty` when not,
 * `unknown` when the acknowledged encoding cannot answer.
 */
export type AcknowledgedVerdict = 'clean' | 'dirty' | 'unknown'

export interface VerdictOptions {
    env: KeyEnv
    lists: ListDerivation
    /** The latest acknowledged encoding, never an older one. */
    previous: PreviousEncoding
}

/**
 * An encoder that only checks reuse. Every unit goes to a reuse-only sink over the real previous units, so no key of
 * the profile is copied and the first unit that differs ends the encode. The base class gets the previous encoding
 * without its units: it needs only the entity ids, and its own sink is never used.
 */
class ReuseOnlyEncoder extends Encoder {
    private readonly checking: UnitSink

    constructor(options: EncodeOptions, previous: PreviousEncoding) {
        super(options, { units: new Map<string, ReusableUnit>(), entities: previous.entities, objects: previous.objects })
        this.checking = new UnitSink(options.env, previous, undefined, { reuseOnly: true })
    }

    override put(identity: string, type: UnitType, body: object, kind: UnitKeyKind = 'unit'): EncodedUnit {
        return this.checking.put(identity, type, body, kind)
    }
}

function previousEntryOf(previous: PreviousEncoding, u: string): ShardEntry | undefined {
    for (const shard of previous.objects?.shards ?? []) {
        const entry = shard.entries.find(candidate => candidate.u === u)
        if (entry !== undefined) {
            return entry
        }
    }
    return undefined
}

/** The identity of every unit the entry names. */
function identitiesOf(entry: ShardEntry): string[] {
    const identities = [`${IDENTITY.char}${entry.u}:core`, `${IDENTITY.alChar}${entry.u}`]
    if (entry.lore !== null) {
        identities.push(`${IDENTITY.char}${entry.u}:lore`)
    }
    if (entry.scripts !== null) {
        identities.push(`${IDENTITY.char}${entry.u}:scripts`)
    }
    if (entry.il !== null) {
        identities.push(`${IDENTITY.ilChar}${entry.u}`)
    }
    for (const chat of entry.chats) {
        identities.push(`${IDENTITY.chat}${entry.u}:${chat.cid}:core`)
        chat.chunks.forEach((_, k) => identities.push(`${IDENTITY.chat}${entry.u}:${chat.cid}:chunk:${k}`))
    }
    return identities
}

/** Whether two Refs agree on their first `known` fields; a field past them is one this build does not know. */
function sameRefFields(a: readonly unknown[] | null, b: readonly unknown[] | null, known: number): boolean {
    if (a === null || b === null) {
        return a === b
    }
    for (let i = 0; i < known; i++) {
        if (a[i] !== b[i]) {
            return false
        }
    }
    return true
}

/**
 * Whether two entries agree on what a pass would write that the units do not carry: the entity, its kind, id, the
 * moved `chatPage` and `firstMsgIndex`, and the Refs of every unit it names. Left out: the fields a stub overlays
 * (`name`, `image`, `creatorNotes`, `lastInteraction`, `trashTime`, `characters`, `tags`, `creator`), which a stub
 * carries and a pass rewrites from the live object; `dsp`, which every pass writes as `true`; and every field this
 * build does not know, which the shard carry copies forward and so never differs in what the next pass writes.
 */
function sameKnownFields(fresh: ShardEntry, acknowledged: ShardEntry): boolean {
    if (fresh.u !== acknowledged.u || fresh.type !== acknowledged.type || fresh.chaId !== acknowledged.chaId
        || fresh.chatPage !== acknowledged.chatPage || fresh.firstMsgIndex !== acknowledged.firstMsgIndex
        || !sameRefFields(fresh.core, acknowledged.core, 3) || !sameRefFields(fresh.lore, acknowledged.lore, 3)
        || !sameRefFields(fresh.scripts, acknowledged.scripts, 3) || !sameRefFields(fresh.al, acknowledged.al, 4)
        || !sameRefFields(fresh.il, acknowledged.il, 4) || fresh.chats.length !== acknowledged.chats.length) {
        return false
    }
    return fresh.chats.every((chat, index) => {
        const other = acknowledged.chats[index]
        return chat.cid === other.cid && sameRefFields(chat.core, other.core, 3) && chat.chunks.length === other.chunks.length
            && chat.chunks.every((chunk, k) => sameRefFields(chunk, other.chunks[k], 4))
    })
}

/**
 * The verdict for a resident character against the latest acknowledged encoding. It encodes the character under the
 * entity id that encoding holds and requires every unit to be that encoding's unit, and the entry to agree on the
 * known fields `sameKnownFields` names. The overlay fields `lastInteraction` and `trashTime` are not compared: a
 * clean character may still differ in them, and they survive only when it is replaced by a stub that carries them
 * (`overlayStub`). `unknown` when the id is
 * shared (the handle `#1` is held), the entry or one of its units' digests is missing (a unit with no digest is never
 * reused, so an unhydrated character must not look clean), or the character cannot be encoded.
 */
export function characterMatchesAcknowledged(slot: Slot, options: VerdictOptions): AcknowledgedVerdict {
    const { previous } = options
    if (typeof slot !== 'object' || slot === null || isColdStub(slot)) {
        return 'unknown'
    }
    const chaId = String((slot as { chaId?: unknown }).chaId ?? '')
    const u = previous.entities.get(`${chaId}#0`)
    if (previous.entities.has(`${chaId}#1`) || u === undefined) {
        return 'unknown'
    }
    const acknowledged = previousEntryOf(previous, u)
    if (acknowledged === undefined) {
        return 'unknown'
    }
    for (const identity of identitiesOf(acknowledged)) {
        if (previous.units.get(identity)?.digest === undefined) {
            return 'unknown'
        }
    }
    const encodeOptions: EncodeOptions = { env: options.env, lists: options.lists, seq: 0, createdAt: 0, previous }
    try {
        const fresh = encodeCharacter(slot, 0, new ReuseOnlyEncoder(encodeOptions, previous))
        return sameKnownFields(fresh, acknowledged) ? 'clean' : 'dirty'
    } catch (error) {
        if (error instanceof UnitNotReusedError) {
            return 'dirty'
        }
        if (error instanceof CodecError) {
            return 'unknown'
        }
        throw error
    }
}

/** The commit's build result for a tree: the new units other than the manifest, and the manifest. */
export function builtCommitOf(tree: EncodedTree): BuiltCommit {
    return {
        units: tree.units
            .filter(unit => !unit.reused && unit.type !== UNIT_TYPE.manifest)
            .map(unit => ({ key: unit.key, bytes: unit.bytes })),
        manifest: { key: tree.manifestKey, body: tree.manifest },
    }
}
