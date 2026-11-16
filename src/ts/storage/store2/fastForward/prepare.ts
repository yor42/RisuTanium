import type { JsonObject, JsonValue } from '../../blockFrame'
import type { Database, character, groupChat } from '../../database.svelte'
import {
    characterBodyMatches, configFields, isColdStub, overlayStub, pickFields, sameJsonValue, stubFromEntry, toPlainJson, unitDigest,
    type ListDerivation, type PreviousEncoding,
} from '../codec'
import { encodeUnit, keyOfRef, readUnit, UNIT_TYPE, type ContentBody, type KeyEnv, type Ref, type ShardEntry } from '../format'
import type { StoredTree } from '../previousOfTree'
import { checkedBytes, registerEntityUnits } from '../previousOfTree'
import { residentSetOf } from '../residencyPolicy'
import {
    classifyCharacter, classifyCharacterOrder, classifyConfig, classifyMembership, mergeStatics, movedFieldsOf,
    type MovedFields, type Member,
} from './delta'
import type { DeferClass } from './defer'
import type { GuardEntry } from './guard'
import { decideSwitch, PERSONA_OPS, PERSONA_RECORD_FIELDS, PRESET_RECORD_FIELDS, type SwitchOps, type SwitchSide } from './records'

/**
 * The synchronous middle of the fast-forward: from the acknowledged encoding (base), the live database (mine) and the
 * peer's tree (theirs) it decides every record and builds the steps that write the result. Nothing here writes: a park
 * or a throw leaves the database as it was. Every value written is a copy, so the database never aliases the
 * acknowledged encoding's bodies.
 */

type Value = JsonValue | undefined
type Slot = character | groupChat

/** What the fast-forward needs from the page, supplied lazily so the boot dispatch imports no page module. */
export interface FastForwardHost {
    /** The characters open here: the selection, the previous selection with its group members. */
    inUse(): ReadonlySet<string>
    /** A reply is being written into this character. */
    writing(chaId: string): boolean
    /** A busy action or a choke point is in flight (deferral D2). */
    busy(): boolean
    /** A send is running (deferral D1). */
    sending(): boolean
    /** Runs `fn` so that installing a character object the store holds raises no save mark. */
    installQuietly<T>(fn: () => T): T
    /** Forgets what the page keeps about a loaded character object that is being replaced. */
    forgetLoaded(slot: character | groupChat): void
    /** The preset record's operations, bound to the page's own `setPreset` and `presetFromWorkingSettings`. */
    presetOps(): SwitchOps
}

export interface PrepareInput {
    db: Database
    old: PreviousEncoding
    target: StoredTree
    next: PreviousEncoding
    host: FastForwardHost
    replyOwners: ReadonlySet<string>
    env: KeyEnv
    lists: ListDerivation
}

/** One write of the apply, with the undo that restores it and the check that its result is what was decided. */
export interface Step {
    apply(): () => void
    verify(): boolean
    /** Run once after every step applied and verified. */
    after?: () => void
}

export type Prepared =
    | { kind: 'park', reason: string }
    | { kind: 'ready', defers: ReadonlySet<DeferClass>, steps: Step[], guard: GuardEntry[] }

function isSlotObject(value: JsonObject): value is JsonObject & Slot {
    return typeof value.chaId === 'string'
}

/** The field of `db` as plain JSON. */
function liveField(db: Database, name: string): Value {
    return toPlainJson(Reflect.get(db, name))
}

function fieldStep(db: Database, name: string, value: Value): Step {
    const expected = value === undefined ? undefined : structuredClone(value)
    return {
        apply() {
            const had = Object.hasOwn(db, name)
            const before: unknown = Reflect.get(db, name)
            if (expected === undefined) {
                Reflect.deleteProperty(db, name)
            } else {
                Reflect.set(db, name, structuredClone(expected))
            }
            return () => {
                if (had) {
                    Reflect.set(db, name, before)
                } else {
                    Reflect.deleteProperty(db, name)
                }
            }
        },
        verify: () => sameJsonValue(liveField(db, name), expected),
    }
}

/** Writes a moved field on a live character or stub; a value of undefined removes it. */
function movedStep(slot: Slot, name: string, value: number | undefined): Step {
    return {
        apply() {
            const had = Object.hasOwn(slot, name)
            const before: unknown = Reflect.get(slot, name)
            if (value === undefined) {
                Reflect.deleteProperty(slot, name)
            } else {
                Reflect.set(slot, name, value)
            }
            return () => {
                if (had) {
                    Reflect.set(slot, name, before)
                } else {
                    Reflect.deleteProperty(slot, name)
                }
            }
        },
        verify: () => Reflect.get(slot, name) === value,
    }
}

function stringList(value: Value): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function entriesOf(encoding: PreviousEncoding): Map<string, ShardEntry> {
    const out = new Map<string, ShardEntry>()
    for (const shard of encoding.objects?.shards ?? []) {
        for (const entry of shard.entries) {
            out.set(entry.u, entry)
        }
    }
    return out
}

function membersOf(order: ContentBody | undefined, entries: ReadonlyMap<string, ShardEntry>): Member[] | null {
    if (order === undefined) {
        return null
    }
    const members: Member[] = []
    for (const u of stringList(order.chars)) {
        const entry = entries.get(u)
        if (entry === undefined) {
            return null
        }
        members.push({ chaId: entry.chaId, u })
    }
    return members
}

function slotChaId(slot: Slot): string {
    return String(Reflect.get(slot, 'chaId') ?? '')
}

function liveMoved(slot: Slot): MovedFields {
    const out: MovedFields = {}
    for (const name of ['lastInteraction', 'trashTime', 'chatPage', 'firstMsgIndex'] as const) {
        const value: unknown = Reflect.get(slot, name)
        if (typeof value === 'number') {
            out[name] = value
        }
    }
    return out
}

/** The stub's fields that a stub shows from its entry equal the entry's (what `overlayStub` would write back). */
function stubMatchesEntry(slot: Slot, entry: ShardEntry): boolean {
    if (!isColdStub(slot) || Reflect.get(slot, 'coldstorage') !== entry.u) {
        return false
    }
    const overlaid = overlayStub(entry, slot)
    return ['name', 'image', 'chaId', 'creatorNotes', 'tags', 'creator', 'characters'].every(name => sameJsonValue(Reflect.get(overlaid, name), Reflect.get(entry, name)))
}

function stubProjectionMatches(slot: Slot, entry: ShardEntry, moved: MovedFields): boolean {
    const built = stubFromEntry(entry)
    return ['name', 'image', 'chaId', 'creatorNotes', 'coldstorage', 'tags', 'creator', 'characters'].every(name => sameJsonValue(toPlainJson(Reflect.get(slot, name)), built[name]))
        && Reflect.get(slot, 'lastInteraction') === moved.lastInteraction && Reflect.get(slot, 'trashTime') === moved.trashTime
}

/** The identities of the units `entry` names, as the acknowledged encoding registers them. */
function identitiesOfEntry(entry: ShardEntry): Map<string, string> {
    const out = new Map<string, string>()
    registerEntityUnits(entry, (identity, _type, ref) => { out.set(identity, keyOfRef(ref)) })
    return out
}

function unitEntries(old: PreviousEncoding, entry: ShardEntry, theirs: ShardEntry): GuardEntry[] {
    const target = identitiesOfEntry(theirs)
    const out: GuardEntry[] = []
    for (const [identity, key] of identitiesOfEntry(entry)) {
        const held = old.units.get(identity)
        if (held?.digest !== undefined && target.get(identity) !== key) {
            out.push({ kind: 'unit', identity, digest: held.digest })
        }
    }
    return out
}

function sameKeyLists(a: readonly Ref[] | undefined, b: readonly Ref[] | undefined): boolean {
    return (a ?? []).length === (b ?? []).length && (a ?? []).every((ref, index) => keyOfRef(ref) === keyOfRef((b ?? [])[index]))
}

function sideOf(config: JsonObject, listName: string, idName: string, list: readonly JsonValue[] | undefined, fields: readonly string[]): SwitchSide {
    const held = config[listName]
    const own: readonly JsonValue[] = Array.isArray(held) ? held : []
    return { list: list ?? own, id: config[idName], working: pickFields(config, fields) }
}

export function prepareFastForward(input: PrepareInput): Prepared {
    const { db, old, target, next, host } = input
    const baseObjects = old.objects
    const nextObjects = next.objects
    const baseConfig = baseObjects?.config
    const theirsConfig = nextObjects?.config
    if (baseObjects === undefined || nextObjects === undefined || baseConfig === undefined || theirsConfig === undefined
        || baseObjects.manifest === undefined || nextObjects.manifest === undefined) {
        return { kind: 'park', reason: 'no-base' }
    }
    const steps: Step[] = []
    const guard: GuardEntry[] = []
    const defers = new Set<DeferClass>()
    const needDefer = (wanted: DeferClass): void => {
        defers.add(wanted)
    }
    const parked = (reason: string): Prepared => ({ kind: 'park', reason })
    const mineConfig = configFields(db)

    // Config, outside the two switchable records.
    const recordFields = new Set<string>([
        ...PRESET_RECORD_FIELDS, 'botPresetsId', 'personas', 'selectedPersona', ...PERSONA_RECORD_FIELDS,
    ])
    const config = classifyConfig(baseConfig, mineConfig, theirsConfig, recordFields)
    if (config.park.length > 0) {
        return parked(`config:${config.park[0]}`)
    }
    for (const [name, value] of config.take) {
        steps.push(fieldStep(db, name, value))
        guard.push({ kind: 'field', path: name, before: Object.hasOwn(baseConfig, name) ? baseConfig[name] : undefined, expected: value })
    }

    // The two switchable records, each decided whole.
    const records: Array<{ ops: SwitchOps, list: string, id: string, fields: readonly string[], baseList: readonly JsonValue[] | undefined, theirsList: readonly JsonValue[] | undefined, unitIdentities: boolean }> = [
        {
            ops: host.presetOps(), list: 'botPresets', id: 'botPresetsId', fields: PRESET_RECORD_FIELDS,
            baseList: baseObjects.presets, theirsList: nextObjects.presets, unitIdentities: true,
        },
        { ops: PERSONA_OPS, list: 'personas', id: 'selectedPersona', fields: PERSONA_RECORD_FIELDS, baseList: undefined, theirsList: undefined, unitIdentities: false },
    ]
    for (const record of records) {
        const names = [record.id, ...record.fields, ...(record.unitIdentities ? [] : [record.list])]
        const sideFields = record.unitIdentities ? record.fields : PERSONA_RECORD_FIELDS
        const base = sideOf(baseConfig, record.list, record.id, record.baseList, sideFields)
        const theirs = sideOf(theirsConfig, record.list, record.id, record.theirsList, sideFields)
        const presetKeysChanged = record.unitIdentities && !sameKeyLists(baseObjects.manifest.fixed.presets, nextObjects.manifest.fixed.presets)
        const changed = presetKeysChanged || !sameJsonValue(base.id, theirs.id) || !sameJsonValue(base.working, theirs.working)
            || (!record.unitIdentities && !sameJsonValue(base.list, theirs.list))
        if (!changed) {
            continue
        }
        if (record.unitIdentities && (record.baseList === undefined || record.theirsList === undefined)) {
            return parked('no-base-presets')
        }
        const mineList = record.unitIdentities
            ? (Array.isArray(db.botPresets) ? db.botPresets.map(item => toPlainJson(item) ?? null) : [])
            : sideOf(mineConfig, record.list, record.id, undefined, sideFields).list
        const mine: SwitchSide = { list: mineList, id: mineConfig[record.id], working: pickFields(mineConfig, sideFields) }
        const decision = decideSwitch(base, mine, theirs, record.ops)
        if (decision.kind === 'park') {
            return parked(`${record.list}:${decision.reason}`)
        }
        if (decision.kind !== 'take') {
            continue
        }
        needDefer('d1')
        steps.push(fieldStep(db, record.list, [...decision.value.list]))
        steps.push(fieldStep(db, record.id, decision.value.id))
        for (const name of sideFields) {
            steps.push(fieldStep(db, name, Object.hasOwn(decision.value.working, name) ? decision.value.working[name] : undefined))
        }
        for (const name of names) {
            const before = Object.hasOwn(baseConfig, name) ? baseConfig[name] : undefined
            const expected = Object.hasOwn(theirsConfig, name) ? theirsConfig[name] : undefined
            if (!sameJsonValue(before, expected)) {
                guard.push({ kind: 'field', path: name, before, expected })
            }
        }
        if (record.unitIdentities) {
            nextObjects.manifest.fixed.presets.forEach((ref, index) => {
                const held = old.units.get(`preset:${index}`)
                if (held?.digest !== undefined && held.key !== keyOfRef(ref)) {
                    guard.push({ kind: 'unit', identity: `preset:${index}`, digest: held.digest })
                }
            })
        }
    }

    // Task presets are not taken.
    if (!sameKeyLists(baseObjects.manifest.fixed.taskPresets, nextObjects.manifest.fixed.taskPresets)) {
        return parked('task-presets')
    }

    // Statics, by key.
    if (old.units.get('statics')?.key !== next.units.get('statics')?.key) {
        const decision = mergeStatics(baseObjects.statics?.value, liveField(db, 'statics'), nextObjects.statics?.value)
        if (decision.kind === 'park') {
            return parked(decision.reason)
        }
        if (decision.kind === 'take' || decision.kind === 'merge') {
            steps.push(fieldStep(db, 'statics', decision.value))
            const held = old.units.get('statics')
            if (decision.kind === 'take' && held?.digest !== undefined) {
                guard.push({ kind: 'unit', identity: 'statics', digest: held.digest })
            }
        }
    }

    // Loadouts, whole.
    if (old.units.get('loadouts')?.key !== next.units.get('loadouts')?.key) {
        const bytes = checkedBytes(target.source, target.manifest.fixed.loadouts)
        const parsed = bytes === undefined ? null : readUnit(bytes, UNIT_TYPE.loadouts)
        const items = parsed !== null && (parsed.status === 'ok' || parsed.status === 'stale') ? (parsed.value.body as ContentBody).items : undefined
        const mineItems = (Array.isArray(db.loadouts) ? db.loadouts : []).map(item => toPlainJson(item) ?? null)
        const heldDigest = old.units.get('loadouts')?.digest
        if (!Array.isArray(items) || heldDigest === undefined || unitDigest(encodeUnit(UNIT_TYPE.loadouts, { v: 1, items: mineItems })) !== heldDigest) {
            return parked('loadouts')
        }
        steps.push(fieldStep(db, 'loadouts', items))
        guard.push({ kind: 'unit', identity: 'loadouts', digest: heldDigest })
    }

    // The order: characterOrder by its own rule, membership by append.
    const baseEntries = entriesOf(old)
    const theirsEntries = entriesOf(next)
    const baseOrder = baseObjects.order
    const theirsOrder = nextObjects.order
    const order = classifyCharacterOrder(baseOrder.characterOrder, liveField(db, 'characterOrder'), theirsOrder.characterOrder)
    if (order.kind === 'park') {
        return parked('character-order')
    }
    if (order.kind === 'take' || order.kind === 'merge') {
        steps.push(fieldStep(db, 'characterOrder', order.value))
    }
    const baseMembers = membersOf(baseOrder, baseEntries)
    const theirsMembers = membersOf(theirsOrder, theirsEntries)
    if (baseMembers === null || theirsMembers === null) {
        return parked('order')
    }
    const slots: Slot[] = Array.isArray(db.characters) ? db.characters : []
    const seen = new Map<string, number>()
    const mineMembers: Member[] = slots.map((slot) => {
        const chaId = slotChaId(slot)
        const occurrence = seen.get(chaId) ?? 0
        seen.set(chaId, occurrence + 1)
        return { chaId, u: old.entities.get(`${chaId}#${occurrence}`) ?? '' }
    })
    // The residency id test applies whether or not archiving is on: a stub stands for an id only when the id is usable and unshared.
    const residentU = residentSetOf({ entries: [...theirsEntries.values()], config: { ...theirsConfig, archiveCharacters: true }, plugins: [] })
    const residentChaIds = new Set([...theirsEntries.values()].filter(entry => residentU.has(entry.u)).map(entry => entry.chaId))
    const membership = classifyMembership(baseMembers, mineMembers, theirsMembers, chaId => residentChaIds.has(chaId))
    if (membership.kind === 'park') {
        return parked(`membership:${membership.reason}`)
    }
    if (membership.kind === 'append') {
        needDefer('d2')
        for (const member of membership.members) {
            const entry = theirsEntries.get(member.u)
            if (entry === undefined) {
                return parked('membership:no-entry')
            }
            const stub = stubFromEntry(entry)
            steps.push({
                apply() {
                    const characters = db.characters
                    host.installQuietly(() => {
                        if (isSlotObject(stub)) {
                            characters.push(stub)
                        }
                    })
                    const index = characters.length - 1
                    return () => { host.installQuietly(() => { characters.splice(index, 1) }) }
                },
                verify: () => isColdStub(db.characters[db.characters.length - 1]) && Reflect.get(db.characters[db.characters.length - 1], 'coldstorage') === entry.u,
            })
        }
    }

    // The characters the peer changed.
    const heldBy = new Map<string, number>()
    for (const entry of baseEntries.values()) {
        heldBy.set(entry.chaId, (heldBy.get(entry.chaId) ?? 0) + 1)
    }
    const inUseSet = host.inUse()
    for (const [u, theirsEntry] of theirsEntries) {
        const baseEntry = baseEntries.get(u)
        if (baseEntry === undefined || sameJsonValue(baseEntry, theirsEntry)) {
            continue
        }
        const index = mineMembers.findIndex(member => member.u === u)
        if (index < 0) {
            return parked('character-missing')
        }
        const slot = slots[index]
        const chaId = slotChaId(slot)
        const stub = isColdStub(slot)
        // A stub holds placeholders for the two view fields, so what it stands for is the entry's.
        const baseMoved = movedFieldsOf(baseEntry)
        const mineMoved: MovedFields = stub
            ? { ...liveMoved(slot), chatPage: baseMoved.chatPage, firstMsgIndex: baseMoved.firstMsgIndex }
            : liveMoved(slot)
        const bodyClean = stub
            ? stubMatchesEntry(slot, baseEntry)
            : characterBodyMatches(slot, { env: input.env, lists: input.lists, previous: old }) === 'clean'
        const replyOwner = input.replyOwners.has(chaId)
        const decision = classifyCharacter({
            base: baseEntry, theirs: theirsEntry, bodyClean,
            inUse: inUseSet.has(chaId) || replyOwner || host.writing(chaId), replyOwner,
            shared: (heldBy.get(baseEntry.chaId) ?? 0) > 1, resident: residentU.has(u), mine: mineMoved,
        })
        if (decision.kind === 'park') {
            return parked(`character:${decision.reason}`)
        }
        if (decision.kind === 'keep') {
            continue
        }
        const movedOf = (name: 'lastInteraction' | 'trashTime' | 'chatPage' | 'firstMsgIndex'): { value: number | undefined, wrote: boolean } => {
            const moved = decision.moved[name]
            if (moved.kind === 'take' || moved.kind === 'merge') {
                if (moved.kind === 'take' && moved.defer === true) {
                    needDefer('d1')
                }
                return { value: moved.value, wrote: true }
            }
            return { value: mineMoved[name], wrote: false }
        }
        if (decision.kind === 'fields') {
            for (const name of ['lastInteraction', 'trashTime', 'chatPage', 'firstMsgIndex'] as const) {
                const { value, wrote } = movedOf(name)
                if (wrote && !(stub && (name === 'chatPage' || name === 'firstMsgIndex'))) {
                    steps.push(movedStep(slot, name, value))
                }
            }
            continue
        }
        needDefer('d2')
        const finalMoved: MovedFields = { lastInteraction: movedOf('lastInteraction').value, trashTime: movedOf('trashTime').value }
        const replacement = stubFromEntry(theirsEntry)
        if (!isSlotObject(replacement)) {
            return parked('character:no-chaid')
        }
        guard.push(...unitEntries(old, baseEntry, theirsEntry))
        steps.push({
            apply() {
                const characters = db.characters
                const before = characters[index]
                host.installQuietly(() => { characters[index] = replacement })
                for (const name of ['lastInteraction', 'trashTime'] as const) {
                    if (finalMoved[name] === undefined) {
                        Reflect.deleteProperty(replacement, name)
                    } else {
                        Reflect.set(replacement, name, finalMoved[name])
                    }
                }
                return () => { host.installQuietly(() => { characters[index] = before }) }
            },
            verify: () => stubProjectionMatches(db.characters[index], theirsEntry, finalMoved),
            after: () => host.forgetLoaded(slot),
        })
    }
    return { kind: 'ready', defers, steps, guard }
}
