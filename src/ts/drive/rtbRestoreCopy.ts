import { alertError, alertWait } from '../alert'
import { language } from 'src/lang'
import { noteAndSettleAssetWrite } from '../globalApi.svelte'
import type { BusyHandle } from '../process/memory/busyActions'
import { InlayUnreadableError, inlayAttachmentLimit, withInlayLock, writeAppInlay, type InlayAsset } from '../process/files/inlayStore'
import { inlayMetaKey } from '../process/files/inlayKeys'
import { createYieldBudget, yieldToEventLoop, type YieldBudget } from '../storage/saveYield'
import { getAppStore } from '../storage/store/appStore'
import type { ByteStore, PieceWriter } from '../storage/store/contract'
import { StoreInvalidKeyError, UploadCapacityError, UploadGoneError } from '../storage/store/errors'
import { NodeHttpError } from '../storage/store/nodeHttpStore'
import { CHUNK_MAX } from '../storage/tauriByteTransport'
import type { RestoreAssetPipeline } from './assetBatchPipeline'
import { refuseBackupLoadWhileBusy } from './backupWorkGuard'
import { createRestoreAssetPipeline } from './backuplocal'
import type { InlayRestoreResult, InlaySkipped } from './inlayBackupImport'
import { unescAssetName } from './rtb/assetName'
import { crc32Final, crc32Update, CRC32_INIT } from './rtb/crc32Running'
import { decodeInlayMeta, type InlayPair } from './rtb/inlayEntries'
import { RtbCouldNotReadError } from './rtb/rangeSource'
import { readEntry, type ContainerFinding } from './rtb/zip64Reader'
import type { RestoreHold } from './rtbRestoreHold'
import type { RestorePlan } from './rtbRestorePlan'

/**
 * The copy stage of a `.rtb` restore (CHORE-128 S12a-1): the file's assets (C1) and inlays (C2) are written to the page's
 * stores before anything of the profile is committed. It never releases the hold; the caller's exit does. It shows its own
 * stop message, with the line that names what was already copied where the message does not say so itself, and resolves
 * with `shown: true`. Handled stops resolve `nothing-replaced`; an unexpected throw resolves `failed`. It does not reject
 * through its own handling.
 *
 * Invariants:
 * - Every `assets/` key is noted as written this page, and the deletion in flight settled, before its first read or write
 *   (the CHORE-830 contract), so the sweep never deletes under the copy.
 * - An entry's bytes reach their final key only after the entry's CRC-32 matched: the small path writes after `readEntry`
 *   returned `ok`, and the large path finishes its writer only then and aborts it otherwise.
 * - Nothing is written to the profile here, and no write of this stage is a commit.
 */

/** An asset the restore left out, in the shape the notice builder reads. */
export interface SkippedAssetFact {
    name: string
    reason: 'invalidName' | 'tooLarge'
}

export interface RtbInstallFacts {
    assetsWritten: number
    /** The plan's equal hash names plus the literal names whose CRC-32 matched at the copy. */
    assetsPresent: number
    skippedAssets: readonly SkippedAssetFact[]
    inlays: InlayRestoreResult
}

export type RtbCopyCause = 'busy' | 'no-writer' | 'corrupt-entry' | 'could-not-read' | 'node-refused' | 'write-failed'

export type CopyEnd =
    | { kind: 'copied', facts: RtbInstallFacts }
    | { kind: 'stopped', outcome: 'nothing-replaced' | 'failed', cause: RtbCopyCause, facts: RtbInstallFacts, shown: boolean }

/** The part of the plan this stage reads. */
export type RtbCopyPlan = Pick<RestorePlan, 'source' | 'index' | 'assets' | 'inlays'>
export type RtbCopyHold = Pick<RestoreHold, 'busy'>
export type RtbAssetPipeline = Pick<RestoreAssetPipeline, 'batchBytes' | 'failure' | 'add' | 'drain' | 'invalidAssets' | 'stopStreams'>

/** The calls the copy makes outside the file; tests replace them to observe order and to keep the page out of it. */
export interface RtbCopyDeps {
    store(): Promise<ByteStore>
    createPipeline(): Promise<RtbAssetPipeline | null>
    noteAndSettle(key: string): Promise<void>
    refuseWhileBusy(own: BusyHandle): boolean
    inlayLimit(type: InlayAsset['type'] | undefined): number
    /** The largest entry compared by CRC-32 and, without a pipeline, written whole. */
    chunkMax: number
    yieldBudget(): YieldBudget
    error(text: string): void
    wait(text: string): void
}

const RESTORE_YIELD_INTERVAL_MS = 50
const SHOWN_NAME_CHARS = 100

function realCopyDeps(): RtbCopyDeps {
    return {
        store: getAppStore,
        createPipeline: createRestoreAssetPipeline,
        noteAndSettle: noteAndSettleAssetWrite,
        refuseWhileBusy: (own) => refuseBackupLoadWhileBusy(own),
        inlayLimit: (type) => inlayAttachmentLimit(type),
        chunkMax: CHUNK_MAX,
        yieldBudget: () => createYieldBudget({ budgetMs: RESTORE_YIELD_INTERVAL_MS, yieldFn: yieldToEventLoop }),
        error: alertError,
        wait: alertWait,
    }
}

/** A stop's message with the line that names what the copy already left on this device. */
export function withCopiedKept(text: string): string {
    return `${text}\n\n${language.rtbRestoreCopiedKept}`
}

function shownName(name: string): string {
    return name.length > SHOWN_NAME_CHARS ? `${name.slice(0, SHOWN_NAME_CHARS)}...` : name
}

/** A handled stop: what to show and how the restore ends. `text` already holds the copied-kept wording when `kept` is false. */
interface Halt {
    cause: RtbCopyCause
    text: string
    kept: boolean
}

interface CopyCounts {
    submitted: number
    equal: number
    skipped: SkippedAssetFact[]
    inlaysWritten: number
    inlaysSkipped: InlaySkipped[]
}

interface CopyState extends CopyCounts {
    plan: RtbCopyPlan
    deps: RtbCopyDeps
    store: ByteStore
    open(key: string): PieceWriter
    pipeline: RtbAssetPipeline | null
    isNode: boolean
    totalBytes: number
    doneBytes: number
    lastPercent: number
}

function freshCounts(): CopyCounts {
    return { submitted: 0, equal: 0, skipped: [], inlaysWritten: 0, inlaysSkipped: [] }
}

function factsOf(plan: RtbCopyPlan, state: CopyCounts): RtbInstallFacts {
    const skippedAssets: SkippedAssetFact[] = [
        ...plan.assets.uncreatable.map((item) => ({ name: item.key, reason: 'invalidName' as const })),
        ...plan.assets.oversize.map((item) => ({ name: item.key, reason: 'tooLarge' as const })),
        ...state.skipped,
    ]
    const inlayLimit = plan.inlays.limit ?? undefined
    return {
        assetsWritten: state.submitted,
        assetsPresent: plan.assets.present + state.equal,
        skippedAssets,
        inlays: {
            written: state.inlaysWritten,
            skipped: [...plan.inlays.oversize.map((pair): InlaySkipped => ({ label: pair.id, reason: 'tooLarge', limit: inlayLimit })), ...state.inlaysSkipped],
            changed: false,
        },
    }
}

function showStop(deps: RtbCopyDeps, text: string): boolean {
    try {
        deps.error(text)
        return true
    } catch (error) {
        console.error(error)
        return false
    }
}

function progress(state: CopyState, bytes: number): void {
    state.doneBytes += bytes
    if (state.totalBytes <= 0) {
        return
    }
    const percent = Math.min(100, Math.floor(state.doneBytes * 100 / state.totalBytes))
    if (percent !== state.lastPercent) {
        state.lastPercent = percent
        state.deps.wait(language.rtbRestoreCopying(percent))
    }
}

/** What a failed write means: a name the store refuses is skipped, a Node refusal stops, anything else is unexpected. */
function classifyWriteError(state: CopyState, error: unknown, name: string, whole: boolean): Halt | null {
    if (error instanceof RtbCouldNotReadError) {
        console.error(error)
        return { cause: 'could-not-read', text: language.backupFileChangedWhileReading, kept: false }
    }
    if (error instanceof StoreInvalidKeyError) {
        console.error(error)
        state.skipped.push({ name, reason: 'invalidName' })
        return null
    }
    if (state.isNode) {
        if (error instanceof NodeHttpError && error.status === 413 && (!whole || error.operation === 'write')) {
            console.error(error)
            return { cause: 'node-refused', text: language.restoreAssetRefusedTooLarge(shownName(name)), kept: false }
        }
        if (error instanceof UploadGoneError || error instanceof UploadCapacityError) {
            console.error(error)
            return { cause: 'node-refused', text: language.restoreAssetUploadStopped(shownName(name)), kept: false }
        }
    }
    throw error
}

const corruptEntry = (finding: ContainerFinding): Halt => {
    console.error(finding)
    return { cause: 'corrupt-entry', text: language.rtbRestoreDamaged, kept: true }
}

/** Whether the target already holds the entry's bytes: the same length and the same CRC-32. A failed read is "not equal". */
async function targetHolds(state: CopyState, key: string, size: number, crc: number): Promise<boolean> {
    try {
        const held = (await state.store.read(key)).bytes
        return held !== null && held.length === size && crc32Final(crc32Update(CRC32_INIT, held)) === crc
    } catch (error) {
        console.error(error)
        return false
    }
}

async function writeSmall(state: CopyState, i: number, key: string, name: string): Promise<Halt | null> {
    const { plan } = state
    const size = plan.index.entry(i).uncompressedSize
    const data = new Uint8Array(size)
    let at = 0
    try {
        const read = await readEntry(plan.source, plan.index, i, (chunk) => {
            if (at + chunk.length > size) {
                throw new RangeError(`the entry ${name} delivered more than its ${size} bytes`)
            }
            data.set(chunk, at)
            at += chunk.length
        })
        if (read.ok === false) {
            return corruptEntry(read.finding)
        }
    } catch (error) {
        return classifyWriteError(state, error, name, false)
    }
    try {
        if (state.pipeline !== null) {
            await state.pipeline.add({ key, name, index: i, data })
        } else {
            await state.store.write(key, data, 'unconditional')
        }
        state.submitted++
    } catch (error) {
        return classifyWriteError(state, error, name, true)
    }
    return null
}

async function writeLarge(state: CopyState, i: number, key: string, name: string): Promise<Halt | null> {
    const { plan } = state
    // Entries that fold to one key are written in file order: what the pipeline holds lands first.
    await state.pipeline?.drain()
    let writer: PieceWriter
    try {
        writer = state.open(key)
    } catch (error) {
        return classifyWriteError(state, error, name, false)
    }
    try {
        const read = await readEntry(plan.source, plan.index, i, (chunk) => writer.write(chunk.slice()))
        if (read.ok === false) {
            await writer.abort()
            return corruptEntry(read.finding)
        }
        await writer.finish()
        state.submitted++
    } catch (error) {
        await writer.abort()
        return classifyWriteError(state, error, name, false)
    }
    return null
}

async function copyAssets(state: CopyState): Promise<Halt | null> {
    const { plan, deps, pipeline } = state
    const smallLimit = pipeline?.batchBytes ?? deps.chunkMax
    const budget = deps.yieldBudget()
    let halt: Halt | null = null
    try {
        for (let n = 0; n < plan.assets.copy.length && halt === null; n++) {
            if (pipeline?.failure) {
                break
            }
            const i = plan.assets.copy[n]
            const entry = plan.index.entry(i)
            const name = unescAssetName(entry.name.slice(2))
            if (name === null) {
                throw new TypeError(`${entry.name} is not a canonical asset entry name.`)
            }
            const key = `assets/${name}`
            await deps.noteAndSettle(key)
            if (plan.assets.mode[n] === 1 && entry.uncompressedSize <= deps.chunkMax && await targetHolds(state, key, entry.uncompressedSize, entry.crc)) {
                state.equal++
            } else {
                halt = entry.uncompressedSize <= smallLimit
                    ? await writeSmall(state, i, key, name)
                    : await writeLarge(state, i, key, name)
            }
            progress(state, entry.uncompressedSize)
            await budget.maybeYield()
        }
    } finally {
        // Every way out waits for the batches in flight, so no message shows over a write still running.
        if (pipeline !== null) {
            await pipeline.drain()
            const refused = pipeline.invalidAssets()
            for (const asset of refused) {
                state.skipped.push({ name: asset.name, reason: 'invalidName' })
            }
            state.submitted -= refused.length
        }
    }
    if (halt === null && pipeline?.failure) {
        throw pipeline.failure.error
    }
    return halt
}

function inlayTypeOf(fields: Record<string, unknown>): InlayAsset['type'] | undefined {
    const type = fields.type
    return type === 'image' || type === 'video' || type === 'audio' || type === 'signature' ? type : undefined
}

async function readWhole(state: CopyState, name: string): Promise<{ kind: 'ok', bytes: Uint8Array } | { kind: 'halt', halt: Halt }> {
    const { plan } = state
    const found = plan.index.find(name)
    if (found.length !== 1) {
        return { kind: 'halt', halt: { cause: 'could-not-read', text: language.backupFileChangedWhileReading, kept: false } }
    }
    const parts: Uint8Array[] = []
    let total = 0
    try {
        const read = await readEntry(plan.source, plan.index, found[0], (chunk) => {
            parts.push(chunk.slice())
            total += chunk.length
        })
        if (read.ok === false) {
            return { kind: 'halt', halt: corruptEntry(read.finding) }
        }
    } catch (error) {
        if (error instanceof RtbCouldNotReadError) {
            console.error(error)
            return { kind: 'halt', halt: { cause: 'could-not-read', text: language.backupFileChangedWhileReading, kept: false } }
        }
        throw error
    }
    const bytes = new Uint8Array(total)
    let at = 0
    for (const part of parts) {
        bytes.set(part, at)
        at += part.length
    }
    return { kind: 'ok', bytes }
}

async function copyInlay(state: CopyState, pair: InlayPair, ordinal: number): Promise<Halt | null> {
    const { plan, deps } = state
    const meta = await readWhole(state, pair.metaName)
    if (meta.kind === 'halt') {
        return meta.halt
    }
    const decoded = decodeInlayMeta(meta.bytes, pair.bodySize)
    if (decoded.kind === 'damaged') {
        // The directory was verified before the copy, so a meta that no longer decodes means the file changed.
        console.error(decoded.reason)
        return { cause: 'could-not-read', text: language.backupFileChangedWhileReading, kept: false }
    }
    const fields = decoded.meta
    const unknownCount = Object.keys(fields.unknown).length
    if (unknownCount > 0) {
        console.warn(`Inlay ${ordinal} of the backup carries ${unknownCount} meta field(s) this version does not restore.`)
    }
    const limit = deps.inlayLimit(inlayTypeOf(fields.fields))
    if (pair.bodySize > limit) {
        state.inlaysSkipped.push({ label: pair.id, reason: 'tooLarge', limit })
        return null
    }
    if (inlayMetaKey(pair.id) === null) {
        state.inlaysSkipped.push({ label: pair.id, reason: 'notStored' })
        return null
    }
    const bodyIndex = plan.index.find(pair.bodyName)
    if (bodyIndex.length !== 1) {
        return { cause: 'could-not-read', text: language.backupFileChangedWhileReading, kept: false }
    }
    const pieces: Blob[] = []
    try {
        const read = await readEntry(plan.source, plan.index, bodyIndex[0], (chunk) => { pieces.push(new Blob([chunk.slice()])) })
        if (read.ok === false) {
            return corruptEntry(read.finding)
        }
    } catch (error) {
        if (error instanceof RtbCouldNotReadError) {
            console.error(error)
            return { cause: 'could-not-read', text: language.backupFileChangedWhileReading, kept: false }
        }
        throw error
    }
    const body = new Blob(pieces, { type: fields.repr === 'blob' ? fields.mime : '' })
    try {
        const textRepr = fields.repr === 'blob' ? undefined : fields.repr
        await withInlayLock(pair.id, async () => {
            await writeAppInlay(state.store, pair.id, { ...fields.fields, data: body }, { textRepr })
        })
        state.inlaysWritten++
    } catch (error) {
        console.error(error)
        if (error instanceof InlayUnreadableError) {
            return { cause: 'could-not-read', text: language.backupFileChangedWhileReading, kept: false }
        }
        state.inlaysSkipped.push({ label: pair.id, reason: 'notStored' })
    }
    return null
}

async function copyInlays(state: CopyState): Promise<Halt | null> {
    const budget = state.deps.yieldBudget()
    const { copy } = state.plan.inlays
    for (let n = 0; n < copy.length; n++) {
        const halt = await copyInlay(state, copy[n], n)
        if (halt !== null) {
            return halt
        }
        progress(state, copy[n].bodySize)
        await budget.maybeYield()
    }
    return null
}

export async function copyRtbEntries(plan: RtbCopyPlan, hold: RtbCopyHold, deps: Partial<RtbCopyDeps> = {}): Promise<CopyEnd> {
    const all: RtbCopyDeps = { ...realCopyDeps(), ...deps }
    let state: CopyState | null = null
    const stop = (outcome: 'nothing-replaced' | 'failed', cause: RtbCopyCause, text: string, shown: boolean | null): CopyEnd => ({
        kind: 'stopped',
        outcome,
        cause,
        facts: factsOf(plan, state ?? freshCounts()),
        shown: shown ?? showStop(all, text),
    })
    try {
        // C0: nothing is written before these checks.
        if (all.refuseWhileBusy(hold.busy)) {
            // The refusal showed its own message.
            return stop('nothing-replaced', 'busy', '', true)
        }
        const store = await all.store()
        const openWriter = store.openWriter
        if (openWriter === undefined) {
            return stop('nothing-replaced', 'no-writer', language.rtbRestoreNeedsStore2, null)
        }
        state = {
            plan, deps: all, store,
            open: (key) => openWriter.call(store, key),
            pipeline: await all.createPipeline(),
            isNode: plan.assets.limit !== null,
            ...freshCounts(),
            totalBytes: plan.assets.copyBytes + plan.inlays.copyBytes, doneBytes: 0, lastPercent: -1,
        }
        const halt = await copyAssets(state) ?? await copyInlays(state)
        if (halt !== null) {
            return stop('nothing-replaced', halt.cause, halt.kept ? withCopiedKept(halt.text) : halt.text, null)
        }
        return { kind: 'copied', facts: factsOf(plan, state) }
    } catch (error) {
        console.error(error)
        return stop('failed', 'write-failed', language.restoreWriteFailed, null)
    }
}
