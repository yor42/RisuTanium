import { Store2BackendError } from '../backend/errors'
import type { Store2Backend } from '../backend/types'
import { classifyCommitRead } from '../commitKey'
import {
    keyOfTail, readUnit, refOfFrame, refsOfWith, UNIT_TYPE,
    type AssetList, type InlayList, type Manifest, type ModuleBucket, type ModuleIndexRoot, type Ref, type RefRow, type Shard, type UnitBody, type UnitType,
} from '../format'
import { PATH_TYPES } from '../recoveryPick'
import { checkManifestKey, readBatch } from '../tree'
import { ReferencedSetBuilder, type ListKind, type ListOwner, type ReferencedSet } from './referencedSet'
import { O3_ROWS, rowId, WALK_PARENT_TYPES, WALK_TABLE } from './rows'
import { checkFramedUnit } from './unitCheck'

/**
 * The raw-unit export of a `.rtb` file: every unit the commit key's `current` manifest reaches through `WALK_TABLE`, each
 * handed to the caller as its stored frame, once, in the bytes the store holds (never decoded and encoded again, so a
 * frame another writer laid out differently travels as it is). The export writes nothing.
 *
 * Preconditions and rules:
 *  - The caller holds a busy action for the whole walk, so the automatic collection pass neither starts nor continues
 *    past a batch. The commit-key re-check below is a defence behind that hold, not a replacement for it.
 *  - Every unit is checked against the Ref that names it (`checkFramedUnit`). A damaged or absent unit is left out and
 *    named only at the two rows of `O3_ROWS`, and only when every Ref to it sits at such a row; anywhere else it fails the
 *    export, naming the key and the row. A unit of a newer format, a backend failure and a moved `current` are never
 *    omissions.
 *  - Before a missing, damaged or too-new failure is thrown, and before any omission is returned, the commit key is read
 *    again: a `current` that no longer names the exported manifest means a peer commit or a collection pass removed the
 *    unit, which is `moved` and never damage.
 *  - Units are handed over before the walk ends, so a caller must discard everything it received when the call throws.
 */

const LEAF_BATCH = 16

export type ExportFailureKind = 'root' | 'unreadable' | 'missing' | 'damaged' | 'too-new' | 'conflict' | 'moved'

/** Why the export stopped. Every kind except `moved` and `unreadable` names a key; `row` is the reference position when one applies. */
export class ExportClosureError extends Error {
    constructor(
        readonly kind: ExportFailureKind,
        message: string,
        readonly key?: string,
        readonly row?: string,
        readonly backendCause?: Store2BackendError,
    ) {
        super(message)
        this.name = 'ExportClosureError'
    }
}

/** One unit of the closure: its full store key, its tail, its type and its stored frame. */
export interface ExportUnit {
    key: string
    tail: string
    type: UnitType
    bytes: Uint8Array
}

/** The entry the file's `omitted` list gets, plus the row (internal: it feeds notices and the restore defence, not manifest.json). */
export interface OmittedUnit {
    kind: 'unit'
    name: string
    reason: 'damaged'
    row: string
}

export interface ExportClosure {
    manifestKey: string
    /** The Ref of the exported manifest frame; the file's `meta.root`. */
    root: Ref
    /** `current.at` of the commit key the walk started from. */
    committedAt: number
    /** `req` of the exported manifest. */
    req: string[]
    /** Units handed to `onUnits`, the manifest included. */
    units: number
    omitted: OmittedUnit[]
    /** Sorted ids of the walk rows that yielded a Ref, rows whose only Ref was omitted included: the file's `meta.refs`. */
    refRows: string[]
    referenced: ReferencedSet
}

export interface ExportClosureOptions {
    /** Receives each verified batch; the walk reads nothing further until it resolves. */
    onUnits: (units: readonly ExportUnit[]) => Promise<void>
    /** Awaited between batches so a long export lets the page breathe. */
    yield?: () => Promise<void>
    /** Tests only: the rows to walk in place of `WALK_TABLE`. */
    table?: readonly RefRow[]
}

interface Seen {
    type: UnitType
    bytes: number
    crc: number
    count: number | null
    /** The first row that named the unit, for messages and the omission entry. */
    row: string
    /** Whether every row that named the unit so far is an O3 row. */
    allO3: boolean
    omitted: boolean
}

interface Child {
    tail: string
    key: string
    type: UnitType
    seen: Seen
}

interface ListUse {
    kind: ListKind
    owner: ListOwner
}

function unreadable(error: Store2BackendError, what: string): ExportClosureError {
    return new ExportClosureError('unreadable', `${what} could not be read: ${error.message}`, undefined, undefined, error)
}

/** The record counts of the chunks and alternatives a shard names, by tail: the Refs' fourth element. */
function countsOf(type: UnitType, body: UnitBody): Map<string, number> {
    const counts = new Map<string, number>()
    if (type === UNIT_TYPE.shard) {
        for (const entry of (body as Shard).entries) {
            for (const chat of entry.chats) {
                for (const ref of [...chat.chunks, ...chat.alt ?? []]) {
                    counts.set(ref[0], ref[3])
                }
            }
        }
    }
    return counts
}

/** The owners of the derived lists a parent names, by list tail. */
function listUsesOf(type: UnitType, body: UnitBody): Map<string, ListUse[]> {
    const uses = new Map<string, ListUse[]>()
    const add = (ref: Ref | null, kind: ListKind, owner: ListOwner): void => {
        if (ref !== null) {
            uses.set(ref[0], [...uses.get(ref[0]) ?? [], { kind, owner }])
        }
    }
    if (type === UNIT_TYPE.manifest) {
        const fixed = (body as Manifest).fixed
        add(fixed.configAl, 'asset', { kind: 'config' })
        add(fixed.il, 'inlay', { kind: 'config' })
    } else if (type === UNIT_TYPE.shard) {
        for (const entry of (body as Shard).entries) {
            add(entry.al, 'asset', { kind: 'character', entry })
            add(entry.il, 'inlay', { kind: 'character', entry })
        }
    } else if (type === UNIT_TYPE.moduleIndex || type === UNIT_TYPE.moduleBucket) {
        for (const entry of (body as ModuleBucket | Extract<ModuleIndexRoot, { v: 1 }>).entries ?? []) {
            add(entry.al, 'asset', { kind: 'module', entry })
            add(entry.il, 'inlay', { kind: 'module', entry })
        }
    }
    return uses
}

export async function exportClosure(backend: Store2Backend, options: ExportClosureOptions): Promise<ExportClosure> {
    const table = options.table ?? WALK_TABLE
    const pause = options.yield ?? (async () => {})
    const o3 = new Set(O3_ROWS)

    async function readCommitKey() {
        try {
            return classifyCommitRead(await backend.readCommit())
        } catch (error) {
            if (error instanceof Store2BackendError) {
                throw unreadable(error, 'The commit key')
            }
            throw error
        }
    }

    // ---- Root ----
    const commit = await readCommitKey()
    if (commit.status !== 'parsed') {
        throw new ExportClosureError(commit.status === 'too-new' ? 'too-new' : 'root', `The commit key is ${commit.status === 'absent' ? 'absent' : `${commit.status}: ${commit.reason}`}.`)
    }
    if (commit.value.current === null) {
        throw new ExportClosureError('root', 'The commit key names no current manifest.')
    }
    const manifestKey = commit.value.current.key
    const committedAt = commit.value.current.at
    if (checkManifestKey(manifestKey) !== null) {
        throw new ExportClosureError('root', `${manifestKey} is not a manifest key.`, manifestKey)
    }
    const rootRead = await readBatch(backend, [manifestKey])
    if (rootRead.status === 'unreadable') {
        throw unreadable(rootRead.cause, `The manifest ${manifestKey}`)
    }
    const rootBytes = rootRead.status === 'read' ? rootRead.units.get(manifestKey) ?? null : null
    if (rootBytes === null) {
        throw new ExportClosureError('root', rootRead.status === 'read' ? `The manifest ${manifestKey} is missing.` : `The manifest ${manifestKey} is not binary data.`, manifestKey)
    }
    const manifestUnit = readUnit(rootBytes, UNIT_TYPE.manifest)
    if (manifestUnit.status !== 'ok' && manifestUnit.status !== 'stale') {
        throw new ExportClosureError(manifestUnit.status === 'damaged' ? 'root' : 'too-new', `The manifest ${manifestKey} is ${manifestUnit.status}: ${manifestUnit.reason}`, manifestKey)
    }
    const manifest = manifestUnit.value.body as Manifest
    const root = refOfFrame(manifestKey, rootBytes)

    // ---- State of the walk ----
    const seen = new Map<string, Seen>()
    const refRows = new Set<string>()
    const omissions = new Map<string, OmittedUnit>()
    const uses = new Map<string, ListUse[]>()
    const builder = new ReferencedSetBuilder()
    let units = 0

    async function stillCurrent(): Promise<boolean> {
        const again = await readCommitKey()
        return again.status === 'parsed' && again.value.current?.key === manifestKey
    }

    async function requireCurrent(): Promise<void> {
        if (!await stillCurrent()) {
            throw new ExportClosureError('moved', 'The commit key no longer names the exported manifest; a save or a clean-up ran during the export.', manifestKey)
        }
    }

    async function fail(kind: 'missing' | 'damaged' | 'too-new', child: Child, detail: string): Promise<never> {
        await requireCurrent()
        const what = kind === 'missing' ? 'is missing' : kind === 'damaged' ? 'is damaged' : 'is of a newer format'
        throw new ExportClosureError(kind, `${child.key} (${child.seen.row}) ${what}${detail === '' ? '' : `: ${detail}`}.`, child.key, child.seen.row)
    }

    async function emit(batch: ExportUnit[]): Promise<void> {
        if (batch.length > 0) {
            units += batch.length
            await options.onUnits(batch)
        }
    }

    /** Reads `keys`; a key the store holds as non-binary data is damaged and the rest of the batch is read again. */
    async function readKeys(keys: readonly string[]): Promise<{ read: Map<string, Uint8Array | null>, notBinary: Set<string> }> {
        const read = new Map<string, Uint8Array | null>()
        const notBinary = new Set<string>()
        let rest = [...keys]
        while (rest.length > 0) {
            const result = await readBatch(backend, rest)
            if (result.status === 'unreadable') {
                throw unreadable(result.cause, 'A unit')
            }
            if (result.status === 'read') {
                for (const [key, bytes] of result.units) {
                    read.set(key, bytes)
                }
                break
            }
            const before = rest.length
            rest = rest.filter(key => key !== result.key)
            if (rest.length === before) {
                throw new ExportClosureError('unreadable', `The store reported ${result.key} as non-binary, which was not asked for.`)
            }
            notBinary.add(result.key)
            read.set(result.key, null)
        }
        return { read, notBinary }
    }

    /** The checked unit of one child, or null when it is left out. Throws when the unit fails the export. */
    async function judge(child: Child, bytes: Uint8Array | null, notBinary: ReadonlySet<string>): Promise<{ unit: ExportUnit, body: UnitBody | null } | null> {
        const { seen: info } = child
        const ref: Ref = info.count === null ? [child.tail, info.bytes, info.crc] : [child.tail, info.bytes, info.crc, info.count]
        const checked = notBinary.has(child.key)
            ? { status: 'damaged', reason: 'It is not binary data' } as const
            : checkFramedUnit(ref, child.type, bytes)
        if (checked.status === 'missing' || checked.status === 'damaged') {
            if (info.allO3) {
                omissions.set(child.tail, { kind: 'unit', name: child.tail, reason: 'damaged', row: info.row })
                info.omitted = true
                return null
            }
            return await fail(checked.status, child, checked.status === 'damaged' ? checked.reason : '')
        }
        if (checked.status === 'too-new') {
            return await fail('too-new', child, checked.reason)
        }
        const frame = bytes as Uint8Array
        const unit: ExportUnit = { key: child.key, tail: child.tail, type: child.type, bytes: frame }
        const owners = uses.get(child.tail) ?? []
        uses.delete(child.tail)
        for (const { kind, owner } of owners) {
            if (checked.status === 'ok') {
                if (kind === 'asset') {
                    builder.addAssetList(owner, checked.body as AssetList)
                } else {
                    builder.addInlayList(owner, checked.body as InlayList)
                }
            } else {
                builder.markUnusable(owner, kind, checked.reason)
            }
        }
        return { unit, body: checked.status === 'newer-list' ? null : checked.body }
    }

    async function walkChildren(parentType: UnitType, parentBody: UnitBody): Promise<void> {
        for (const [tail, list] of listUsesOf(parentType, parentBody)) {
            uses.set(tail, [...uses.get(tail) ?? [], ...list])
        }
        const counts = countsOf(parentType, parentBody)
        const fresh: Child[] = []
        for (const target of refsOfWith(table, parentType, parentBody)) {
            const row = rowId({ type: parentType, path: target.path })
            refRows.add(row)
            const type: UnitType | undefined = PATH_TYPES[target.path]
            if (type === undefined) {
                throw new TypeError(`No unit type is known for the reference position ${target.path}.`)
            }
            if (target.bytes === null || target.crc === null) {
                throw new TypeError(`${target.path}: a walked position holds a length and a checksum.`)
            }
            const key = keyOfTail(target.tail)
            const count = counts.get(target.tail) ?? null
            const known = seen.get(target.tail)
            if (known === undefined) {
                const info: Seen = { type, bytes: target.bytes, crc: target.crc, count, row, allO3: o3.has(row), omitted: false }
                seen.set(target.tail, info)
                fresh.push({ tail: target.tail, key, type, seen: info })
                continue
            }
            if (known.type !== type || known.bytes !== target.bytes || known.crc !== target.crc || (count !== null && known.count !== null && known.count !== count)) {
                throw new ExportClosureError('conflict', `${key} is named at ${known.row} and at ${row} with a different type, size, checksum or count.`, key, row)
            }
            known.allO3 &&= o3.has(row)
            if (known.omitted && !known.allO3) {
                return await fail('damaged', { tail: target.tail, key, type, seen: known }, 'It is named outside the rows that may be left out')
            }
        }

        const leaves = fresh.filter(child => !WALK_PARENT_TYPES.has(child.type))
        const parents = fresh.filter(child => WALK_PARENT_TYPES.has(child.type))
        for (let start = 0; start < leaves.length; start += LEAF_BATCH) {
            const batch = leaves.slice(start, start + LEAF_BATCH)
            const { read, notBinary } = await readKeys(batch.map(child => child.key))
            const out: ExportUnit[] = []
            for (const child of batch) {
                const judged = await judge(child, read.get(child.key) ?? null, notBinary)
                if (judged !== null) {
                    out.push(judged.unit)
                }
            }
            await emit(out)
            await pause()
        }
        for (const child of parents) {
            const { read, notBinary } = await readKeys([child.key])
            const judged = await judge(child, read.get(child.key) ?? null, notBinary)
            if (judged === null) {
                continue
            }
            await emit([judged.unit])
            await pause()
            // A parent type is never a derived list, so its body is always parsed.
            if (judged.body !== null) {
                await walkChildren(child.type, judged.body)
            }
        }
    }

    await emit([{ key: manifestKey, tail: root[0], type: UNIT_TYPE.manifest, bytes: rootBytes }])
    await walkChildren(UNIT_TYPE.manifest, manifest)

    const omitted = [...omissions.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    const referenced = await builder.resolve(
        async keys => (await readKeys(keys)).read,
        new Set(omitted.map(entry => keyOfTail(entry.name))),
    )
    if (omitted.length > 0) {
        await requireCurrent()
    }
    return {
        manifestKey,
        root,
        committedAt,
        req: [...manifest.req],
        units,
        omitted,
        refRows: [...refRows].sort(),
        referenced,
    }
}
