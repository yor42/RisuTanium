import type { BackupIndexEntry, BinFile } from '../../../drive/backupContainer'
import { streamBinDatabase, type BinStreamDeclineReason, type BinStreamSink } from '../../../drive/binDatabaseStream'
import { repairCharacterIds } from '../../../process/chatIds'
import { characterIdProblem, isCharacterEntry } from '../../characterIds'
import { summarizeRepair } from '../../characterTreeRepair'
import type { Database } from '../../database.svelte'
import type { SalvageOmittedBlock } from '../../risuSave'
import { Store2BackendError } from '../backend/errors'
import { BULK_UNIT_THRESHOLD, type Store2Backend, type Store2Read, type UnitWrite } from '../backend/types'
import { createStreamedEncode, type StreamedEncode } from '../codec/scoped'
import { CodecError, type ListDerivation } from '../codec/types'
import { IMPORT_REPLACES_BASE, type BuildContext, type Committer, type StreamContext } from '../commit'
import { defaultKeyEnv, type KeyEnv, type LegacyList } from '../format'
import { BinFileChangedError } from './binReader'
import {
    applyImportOverlay, baseManifestOf, buildImport, confirmImportIncomplete, notePhase, repairImportRoot,
    type BaseManifest, type ImportHooks,type ImportOutcome, type ImportRequest, type ImportUnits, type PrepareStop, type RepairSummary,
} from './importTree'
import { LegacyReadError, resolveLegacyCharacter, resolveLegacyRoot, type IncompleteItem } from './resolve'

/**
 * The streamed counterpart of `prepareImport` and the commit that follows it, for a `.bin` whose database entry is read
 * in pieces (`streamBinDatabase`) instead of decoded whole. Two passes read the entry:
 *  - P1b (`prepareImportStream`) is a dry pass under a placeholder mint. It repairs ids, resolves and encodes every
 *    character as it arrives, keeps no unit, and learns what the whole prepare reports: the incomplete items, the
 *    count of units, the first unsavable detail, and the CRC-32 and length of the bytes it read. It writes nothing.
 *  - P2 (`streamedImportUnits`) is the `finalize` of the commit's build. It reads the entry again under the attempt's
 *    staged mint and puts each character's units at once. It commits only bytes whose CRC-32, length, incomplete
 *    signature and unit count equal P1b's; any difference is `BinFileChangedError('content')`, which aborts the commit.
 *
 * Invariants:
 *  - Every file the streamed prepare cannot answer exactly as the whole prepare does returns 'whole' (a decline of the
 *    decoder, an entry that is not a character object, an id that needs repair, a unit count under the threshold), and
 *    that answer is decided before the incomplete-data question, so the whole path asks it once.
 *  - Every step both prepares run is one function both call (`repairCharacterIds`, `resolveLegacyCharacter`,
 *    `repairImportRoot`, `resolveLegacyRoot`, `applyImportOverlay`, `confirmImportIncomplete`); the `CodecError`
 *    precedence lives in the codec. This module restates none of it.
 *  - P2 never decodes the whole entry and never falls back. `context.put` is awaited outside every `catch`, so a failed
 *    upload reaches the committer as its own stop and is never reported as a changed file.
 */

const DATABASE_ENTRY_NAME = 'database.risudat'

/** The plain data of a streamed import: where the entry is and what the earlier pass confirmed was left out of it. */
export interface StreamSource {
    file: BinFile
    entry: BackupIndexEntry
    /** The blocks the earlier decode left out and the person agreed to. A block this pass leaves out that is not here means the file changed. */
    omitted: ReadonlyMap<string, SalvageOmittedBlock>
    /** Applied to the root of the file before the root repairs, as the whole path applies it to the decoded tree (root-only). */
    adjustRoot?(root: Database): Database
    /** The fewest units for which the stream is taken; fewer is the whole path. Production never passes it. */
    minUnits?: number
    /** Observer of what the prepare decided; tests use it to see that a stream arm did not fall back. Production never passes it. */
    onPrepared?(verdict: 'whole' | 'stream' | 'stop'): void
}

export interface StreamPrepareRequest extends Pick<ImportRequest, 'reader' | 'lists' | 'env' | 'resolve' | 'taskPresets' | 'themePacks' | 'activeThemePack'> {
    stream: StreamSource
    /** Awaited after every chunk and every character of both passes. */
    yieldToMain: () => Promise<void>
}

/** What P1b learned; P2 must reproduce all of it. */
export interface StreamPrepared {
    /** The units the commit writes, the manifest included (the quantity `ScopedPlan.newUnits` reports). Boot wrapper units are not in it. */
    count: number
    signature: string
    crc: number
    length: number
    incomplete: readonly IncompleteItem[]
    repair: RepairSummary
}

interface PassResult {
    /** Why the decoder declined the entry, or null when it streamed. */
    decline: BinStreamDeclineReason | null
    done: { crc: number, length: number } | null
    idProblem: boolean
    heldRead: LegacyReadError | null
    incomplete: IncompleteItem[]
    root: Database | null
    omitted: ReadonlyMap<string, SalvageOmittedBlock>
    /** Units P2 has produced from characters (put or about to be). */
    produced: number
}

/** What a real pass does with each unit: put it, never past `limit` units (the count before the manifest). */
interface RealPass {
    put(unit: UnitWrite): Promise<void>
    limit: number
}

function contentChanged(cause: unknown): BinFileChangedError {
    return new BinFileChangedError('content', DATABASE_ENTRY_NAME, { cause })
}

/**
 * One pass over the entry. Dry (`real === null`): characters are repaired, resolved and encoded with their units
 * dropped, the first read failure is held and every later check still runs. Real: the same steps, each character's units
 * go to `real.put`, and any difference from what a dry pass can see is thrown at once as a changed file.
 */
async function runPass(request: StreamPrepareRequest, encode: StreamedEncode, real: RealPass | null): Promise<PassResult> {
    const assignedIds = new Set<string>()
    const assigned: ReadonlySet<unknown> = assignedIds
    const result: PassResult = { decline: null, done: null, idProblem: false, heldRead: null, incomplete: [], root: null, omitted: new Map(), produced: 0 }
    const sink: BinStreamSink = {
        async character(position, slot) {
            if (result.idProblem) {
                return
            }
            if (!isCharacterEntry(slot) || characterIdProblem(slot.chaId) !== null || assigned.has(slot.chaId)) {
                result.idProblem = true
                if (real !== null) {
                    throw contentChanged(new Error('A character of the entry has an id the streamed import does not take.'))
                }
                return
            }
            repairCharacterIds(slot, assignedIds)
            if (result.heldRead !== null) {
                return
            }
            let resolved: unknown
            try {
                resolved = await resolveLegacyCharacter(slot, position, request.reader, result.incomplete, request.resolve)
            } catch (error) {
                if (real === null && error instanceof LegacyReadError) {
                    result.heldRead = error
                    return
                }
                throw error
            }
            const units = await encode.character(resolved, position)
            if (real === null) {
                return
            }
            for (const unit of units) {
                result.produced += 1
                if (result.produced > real.limit) {
                    throw contentChanged(new Error('The entry produces more units than the first pass counted.'))
                }
                await real.put(unit)
            }
        },
        root(root) {
            result.root = root
        },
        omitted(omitted) {
            result.omitted = omitted
        },
    }
    const done = await streamBinDatabase(request.stream.file, request.stream.entry, sink, { yieldToMain: request.yieldToMain })
    if ('status' in done) {
        result.decline = done.reason
        return result
    }
    result.done = done
    return result
}

/** The root steps of both passes, after every character: the adjustment, the root repairs, the root resolve and the overlay. Rejects `LegacyReadError`. */
async function resolveRoot(request: StreamPrepareRequest, root: Database, incomplete: IncompleteItem[]): Promise<Database> {
    const adjusted = request.stream.adjustRoot === undefined ? root : request.stream.adjustRoot(root)
    repairImportRoot(adjusted)
    // The characters went through the encoder one by one; the root carries an empty stand-in list.
    const resolved = await resolveLegacyRoot(adjusted, [], request.reader, incomplete, request.resolve)
    applyImportOverlay(resolved, request)
    return resolved
}

function checkOmitted(request: StreamPrepareRequest, omitted: ReadonlyMap<string, SalvageOmittedBlock>): void {
    for (const name of omitted.keys()) {
        if (!request.stream.omitted.has(name)) {
            throw new BinFileChangedError('omitted', DATABASE_ENTRY_NAME)
        }
    }
}

/**
 * P1b. Returns 'whole' for every file the whole prepare must handle, a `PrepareStop` for what that prepare would stop
 * at, and the facts P2 must reproduce otherwise. Nothing is written. Throws `BinFileChangedError` for a file that is not
 * what the walk indexed or that leaves out a block nobody confirmed, and any other error for a failure the whole decode
 * would also have thrown.
 */
export async function prepareImportStream(request: StreamPrepareRequest, hooks: ImportHooks): Promise<'whole' | PrepareStop | StreamPrepared> {
    const verdict = await prepareDry(request, hooks)
    request.stream.onPrepared?.(verdict === 'whole' ? 'whole' : 'status' in verdict ? 'stop' : 'stream')
    return verdict
}

async function prepareDry(request: StreamPrepareRequest, hooks: ImportHooks): Promise<'whole' | PrepareStop | StreamPrepared> {
    const minUnits = request.stream.minUnits ?? BULK_UNIT_THRESHOLD + 1
    const env: KeyEnv = request.env ?? defaultKeyEnv
    const encode = createStreamedEncode(env, request.lists, request.yieldToMain)
    const pass = await runPass(request, encode, null)
    if (pass.decline !== null || pass.idProblem || pass.done === null || pass.root === null) {
        return 'whole'
    }
    checkOmitted(request, pass.omitted)
    notePhase(hooks, 'import repaired')
    let readFailure: LegacyReadError | null = pass.heldRead
    let root: Database | null = null
    if (readFailure === null) {
        try {
            root = await resolveRoot(request, pass.root, pass.incomplete)
        } catch (error) {
            if (!(error instanceof LegacyReadError)) {
                throw error
            }
            readFailure = error
        }
    }
    if (readFailure !== null) {
        return { status: 'read-failed', error: readFailure }
    }
    if (root === null) {
        throw new TypeError('The streamed root was not resolved.')
    }
    notePhase(hooks, 'import resolved')
    let count = 0
    let unsavable: CodecError | null = null
    try {
        count = (await encode.finish(root)).count
    } catch (error) {
        if (!(error instanceof CodecError)) {
            throw error
        }
        unsavable = error
    }
    if (unsavable === null && count < minUnits) {
        return 'whole'
    }
    if (!(await confirmImportIncomplete(pass.incomplete, hooks))) {
        return { status: 'declined' }
    }
    if (unsavable !== null) {
        return { status: 'unsavable', detail: unsavable.message }
    }
    notePhase(hooks, `import stream prepared, ${count} units`)
    return {
        count,
        signature: JSON.stringify(pass.incomplete),
        crc: pass.done.crc,
        length: pass.done.length,
        incomplete: pass.incomplete,
        repair: summarizeRepair([]),
    }
}

function isStreamContext(context: BuildContext): context is StreamContext {
    return typeof (context as Partial<StreamContext>).put === 'function'
}

/**
 * P2 as the build of an import: `buildImport(streamedImportUnits(...))` is handed to a streamed committer or installer,
 * whose context carries `put`. `newUnits` is P1b's count. The build reads the entry again, puts every character's units
 * as they are encoded, and returns the tail (front, modules, finish units and the manifest). A difference from P1b in
 * the bytes read, the incomplete items, a codec refusal or the number of units is `BinFileChangedError('content')`; a
 * read failure of the reader is the `LegacyReadError` it is.
 */
export function streamedImportUnits(prepared: StreamPrepared, request: StreamPrepareRequest, hooks: ImportHooks): ImportUnits {
    return {
        newUnits: prepared.count,
        async finalize(context) {
            if (!isStreamContext(context)) {
                throw new TypeError('A streamed import is built through a streamed committer.')
            }
            notePhase(hooks, 'import commit start')
            const env: KeyEnv = request.env ?? defaultKeyEnv
            const encode = createStreamedEncode(env, request.lists, request.yieldToMain, context)
            const pass = await runPass(request, encode, { put: context.put, limit: prepared.count - 1 })
            if (pass.decline !== null) {
                throw contentChanged(new Error(`The entry no longer streams (${pass.decline}).`))
            }
            if (pass.done === null || pass.root === null || pass.done.crc !== prepared.crc || pass.done.length !== prepared.length) {
                throw contentChanged(new Error('The entry is not the bytes the first pass read.'))
            }
            checkOmitted(request, pass.omitted)
            const root = await resolveRoot(request, pass.root, pass.incomplete)
            if (JSON.stringify(pass.incomplete) !== prepared.signature) {
                throw contentChanged(new Error('The items left incomplete differ from the first pass.'))
            }
            let finished: Awaited<ReturnType<StreamedEncode['finish']>>
            try {
                finished = await encode.finish(root)
            } catch (error) {
                if (error instanceof CodecError) {
                    throw contentChanged(error)
                }
                throw error
            }
            if (finished.count !== prepared.count || pass.produced + finished.built.units.length + 1 !== prepared.count) {
                throw contentChanged(new Error('The entry produces another number of units than the first pass counted.'))
            }
            return finished.built
        },
    }
}

export interface StreamCommitRequest extends StreamPrepareRequest {
    committer: Committer
    backend: Store2Backend
    legacyKeep?: LegacyList
}

/**
 * Steps 4 and 5 of the page import for a prepared stream: the base manifest from a fresh read of the commit key, then
 * one forced bulk commit whose build is P2. As `importLegacyTree`, nothing is built when the base cannot be read; the
 * commit's own outcomes pass through, and a build that throws propagates as the committer defines.
 */
export async function commitImportStreamed(request: StreamCommitRequest, prepared: StreamPrepared, hooks: ImportHooks): Promise<ImportOutcome> {
    const committer = request.committer
    if (committer.commitStreamed === undefined) {
        throw new TypeError('The committer cannot commit a streamed import.')
    }
    let read: Store2Read
    let base: BaseManifest
    try {
        read = await request.committer.readCommit()
        base = await baseManifestOf(request.backend, read)
    } catch (error) {
        if (error instanceof Store2BackendError) {
            return { status: 'failed', cause: error }
        }
        throw error
    }
    if (base.status === 'failed') {
        return { status: 'failed', cause: base.cause }
    }
    if (base.status === 'unreadable') {
        return { status: 'base-unreadable', detail: base.detail }
    }
    const built = buildImport(streamedImportUnits(prepared, request, hooks), { base: base.status === 'ok' ? base.manifest : undefined, list: request.legacyKeep })
    const result = await committer.commitStreamed(read, { newUnits: built.newUnits, build: built.build, label: 'import', force: true, carry: IMPORT_REPLACES_BASE })
    return result.status === 'committed' ? { ...result, repair: prepared.repair } : result
}
