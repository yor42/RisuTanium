// Reads a `.bin` through the application's own import reader (the CHORE-807 census steps) and aggregates the
// resolved database. This module has no reader of its own: if an application module cannot load under the
// harness, the run fails. Errors leave a step only as a StepError (indices, no message from the application).
// The application's modules touch stores and alerts, so the caller (the harness) mocks them.
//
// Two paths read the database entry. The streamed path (`streamBinDatabase`) hands out one character at a time and
// holds no character list; the whole path decodes the tree. The streamed path declines files whose layout it cannot
// reproduce; the whole path then runs from a fresh state, so nothing from the declined attempt is counted twice.
import fs from 'node:fs'
import path from 'node:path'
import { indexBackupEntries, type BinFile, type BinSlice } from 'src/ts/drive/backupContainer'
import { streamBinDatabase } from 'src/ts/drive/binDatabaseStream'
import { createBinImportReader, decodeBinDatabase, readBinDatabase, scanBinForImport } from 'src/ts/drive/storeImport'
import { resolveLegacyCharacter, resolveLegacyRoot, resolveLegacyTree, type IncompleteItem } from 'src/ts/storage/store2/legacy/resolve'
import type { Database } from 'src/ts/storage/database.svelte'
import { aggregateDatabase, createAggregator, type LtmAggregates } from './aggregate'
import { checkAggregates } from './allowList'
import { withSealedOutput, type SealResult } from './seal'
import { STEP, declineIndexOf, safeStep } from './status'

export type TreeCounts = { aggregates: LtmAggregates; incompleteUnits: number; omittedBlocks: number }
/** `streamed` is 1 for the streamed path and 0 for the whole path; `declineReason` is the decline index or -1. */
export type AnalyzeResult = TreeCounts & { streamed: number; declineReason: number }

export type AnalyzeOptions = {
    /** `whole` never tries the streamed path. Default `auto`: stream, and fall back to the whole path on a decline. */
    mode?: 'auto' | 'whole'
    /** Awaited before each step, with its STEP index; -1 once before the file is opened. */
    onPhase?: (phase: number) => void | Promise<void>
    /** Called once for every resolved owner that is fed to the aggregator, in both paths. */
    onOwner?: (owner: unknown) => void | Promise<void>
    /** Called with a DECLINE_REASONS index when the streamed path declines. */
    onDecline?: (index: number) => void
}

/** A `BinFile` over a Node file descriptor: each slice reads its own range when asked, so nothing is held between reads. */
export function nodeBinFile(fd: number, size: number): BinFile {
    const sliceOf = (start: number, end: number): BinSlice => ({
        size: end - start,
        slice: (from: number, to?: number) => sliceOf(start + from, to === undefined ? end : Math.min(end, start + to)),
        arrayBuffer: async () => {
            const length = end - start
            // Unzeroed memory: every byte of the returned buffer is overwritten by a read, or cut off when the file is short.
            const buffer = Buffer.allocUnsafeSlow(length)
            let done = 0
            while (done < length) {
                const n = fs.readSync(fd, buffer, done, length - done, start + done)
                if (n === 0) break
                done += n
            }
            const backing = buffer.buffer
            if (done === length && buffer.byteOffset === 0 && buffer.byteLength === backing.byteLength) return backing as ArrayBuffer
            return backing.slice(buffer.byteOffset, buffer.byteOffset + done) as ArrayBuffer
        },
    })
    return { size, slice: (start: number, end?: number) => sliceOf(start, Math.min(size, end ?? size)) }
}

/** Aggregates a resolved database and merges the two reader counts into `totals`. */
export async function analyzeTree(
    db: Pick<Database, 'characters' | 'modules' | 'enabledModules'>, incompleteUnits: number, omittedBlocks: number,
): Promise<TreeCounts> {
    const aggregates = await safeStep(STEP.aggregate, () => aggregateDatabase(db))
    aggregates.totals.incompleteUnits = incompleteUnits
    aggregates.totals.omittedBlocks = omittedBlocks
    return { aggregates, incompleteUnits, omittedBlocks }
}

type IndexScan = ReturnType<typeof scanBinForImport>
const missingFetch = async () => ({ status: 'missing' }) as never
const yieldToMain = (): Promise<void> => new Promise<void>((resolve) => { setImmediate(resolve) })

/**
 * The streamed path. Everything it holds (aggregator, incomplete list, root) lives in this call, so a decline drops it
 * all. At most one resolved character is alive at a time; the root is resolved against an empty character list.
 */
async function streamedPath(
    file: BinFile, scan: IndexScan, options: AnalyzeOptions,
): Promise<{ result: AnalyzeResult } | { declined: number }> {
    await options.onPhase?.(STEP.stream)
    const reader = createBinImportReader(file, scan.index, missingFetch)
    const aggregator = createAggregator()
    const incomplete: IncompleteItem[] = []
    const held: { root: Database | null; omittedBlocks: number } = { root: null, omittedBlocks: 0 }
    const done = await safeStep(STEP.stream, () => streamBinDatabase(file, scan.database!, {
        async character(position, slot) {
            const resolved = await safeStep(STEP.resolve, () => resolveLegacyCharacter(slot, position, reader, incomplete))
            await safeStep(STEP.aggregate, () => aggregator.addOwner(resolved))
            await options.onOwner?.(resolved)
        },
        root(root) { held.root = root },
        // Only the size is read: the values carry block names and error messages.
        omitted(omitted) { held.omittedBlocks = omitted.size },
    }, { yieldToMain }))
    if ('status' in done) {
        const index = declineIndexOf(done.reason)
        options.onDecline?.(index)
        return { declined: index }
    }
    await options.onPhase?.(STEP.resolve)
    const root = await safeStep(STEP.resolve, () => {
        if (held.root === null) throw new Error('no root')
        return resolveLegacyRoot(held.root, [], reader, incomplete)
    })
    await options.onPhase?.(STEP.aggregate)
    const aggregates = await safeStep(STEP.aggregate, () => {
        aggregator.addRoot(root)
        return aggregator.finish()
    })
    aggregates.totals.incompleteUnits = incomplete.length
    aggregates.totals.omittedBlocks = held.omittedBlocks
    return {
        result: { aggregates, incompleteUnits: incomplete.length, omittedBlocks: held.omittedBlocks, streamed: 1, declineReason: -1 },
    }
}

async function wholePath(file: BinFile, scan: IndexScan, options: AnalyzeOptions, declineReason: number): Promise<AnalyzeResult> {
    await options.onPhase?.(STEP.readDatabase)
    const bytes = await safeStep(STEP.readDatabase, () => readBinDatabase(file, scan.database!))
    await options.onPhase?.(STEP.decode)
    const decoded = await safeStep(STEP.decode, () => decodeBinDatabase(bytes))
    await options.onPhase?.(STEP.resolve)
    const resolved = await safeStep(STEP.resolve, () => {
        const reader = createBinImportReader(file, scan.index, missingFetch)
        return resolveLegacyTree(decoded.tree, reader)
    })
    if (options.onOwner) for (const owner of resolved.database.characters as unknown[]) await options.onOwner(owner)
    await options.onPhase?.(STEP.aggregate)
    // Only the size of `decoded.omitted` is read: its values carry block names and error messages.
    const counts = await analyzeTree(resolved.database, resolved.incomplete.length, decoded.omitted.size)
    return { ...counts, streamed: 0, declineReason }
}

export async function analyzeBin(binPath: string, options: AnalyzeOptions = {}): Promise<AnalyzeResult> {
    let fd = -1
    try {
        // Phase -1: before the file is opened.
        await options.onPhase?.(-1)
        await options.onPhase?.(STEP.index)
        const file = await safeStep(STEP.index, () => {
            fd = fs.openSync(binPath, 'r')
            return nodeBinFile(fd, fs.fstatSync(fd).size)
        })
        const walked = await safeStep(STEP.index, () => indexBackupEntries(file))
        await options.onPhase?.(STEP.scan)
        const scan = await safeStep(STEP.scan, () => {
            const found = scanBinForImport(walked.entries, walked.names)
            if (found.database === null) throw new Error('no database entry')
            return found
        })
        let declineReason = -1
        if (options.mode !== 'whole') {
            const attempt = await streamedPath(file, scan, options)
            if ('result' in attempt) return attempt.result
            declineReason = attempt.declined
        }
        return await wholePath(file, scan, options, declineReason)
    } finally {
        if (fd >= 0) fs.closeSync(fd)
    }
}

/** The real-run path: the analysis under the output seal. */
export function analyzeBinSealed(binPath: string, options: AnalyzeOptions = {}): Promise<SealResult<AnalyzeResult>> {
    return withSealedOutput(() => analyzeBin(binPath, options))
}

/** Writes `ltm-aggregates.json` only when it conforms to the allow-list; otherwise nothing is written. */
export function writeAggregates(outDir: string, value: unknown): void {
    const violations = checkAggregates(value)
    if (violations.length > 0) throw new Error('ltm-eval: output refused, ' + violations.length + ' allow-list violations')
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, 'ltm-aggregates.json'), JSON.stringify(value, null, 1))
}
