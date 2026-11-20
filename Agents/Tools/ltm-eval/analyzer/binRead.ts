// Reads a `.bin` through the application's own import reader (the CHORE-807 census steps) and aggregates the
// resolved database. This module has no reader of its own: if an application module cannot load under the
// harness, the run fails. Errors leave a step only as a StepError (indices, no message from the application).
// The application's modules touch stores and alerts, so the caller (the harness) mocks them.
import fs from 'node:fs'
import path from 'node:path'
import { indexBackupEntries, type BinFile, type BinSlice } from 'src/ts/drive/backupContainer'
import { createBinImportReader, decodeBinDatabase, readBinDatabase, scanBinForImport } from 'src/ts/drive/storeImport'
import { resolveLegacyTree } from 'src/ts/storage/store2/legacy/resolve'
import type { Database } from 'src/ts/storage/database.svelte'
import { aggregateDatabase, type LtmAggregates } from './aggregate'
import { checkAggregates } from './allowList'
import { withSealedOutput, type SealResult } from './seal'
import { STEP, safeStep } from './status'

export type AnalyzeResult = { aggregates: LtmAggregates; incompleteUnits: number; omittedBlocks: number }

/** A `BinFile` over a Node file descriptor: each slice reads its own range when asked, so nothing is held between reads. */
function nodeBinFile(fd: number, size: number): BinFile {
    const sliceOf = (start: number, end: number): BinSlice => ({
        size: end - start,
        slice: (from: number, to?: number) => sliceOf(start + from, to === undefined ? end : Math.min(end, start + to)),
        arrayBuffer: async () => {
            const length = end - start
            const buffer = Buffer.alloc(length)
            let done = 0
            while (done < length) {
                const n = fs.readSync(fd, buffer, done, length - done, start + done)
                if (n === 0) break
                done += n
            }
            return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + done) as ArrayBuffer
        },
    })
    return { size, slice: (start: number, end?: number) => sliceOf(start, Math.min(size, end ?? size)) }
}

/** Aggregates a resolved database and merges the two reader counts into `totals`. */
export async function analyzeTree(
    db: Pick<Database, 'characters' | 'modules' | 'enabledModules'>, incompleteUnits: number, omittedBlocks: number,
): Promise<AnalyzeResult> {
    const aggregates = await safeStep(STEP.aggregate, () => aggregateDatabase(db))
    aggregates.totals.incompleteUnits = incompleteUnits
    aggregates.totals.omittedBlocks = omittedBlocks
    return { aggregates, incompleteUnits, omittedBlocks }
}

export async function analyzeBin(binPath: string): Promise<AnalyzeResult> {
    let fd = -1
    try {
        const file = await safeStep(STEP.index, () => {
            fd = fs.openSync(binPath, 'r')
            return nodeBinFile(fd, fs.fstatSync(fd).size)
        })
        const walked = await safeStep(STEP.index, () => indexBackupEntries(file))
        const scan = await safeStep(STEP.scan, () => {
            const found = scanBinForImport(walked.entries, walked.names)
            if (found.database === null) throw new Error('no database entry')
            return found
        })
        const bytes = await safeStep(STEP.readDatabase, () => readBinDatabase(file, scan.database!))
        const decoded = await safeStep(STEP.decode, () => decodeBinDatabase(bytes))
        const resolved = await safeStep(STEP.resolve, () => {
            const reader = createBinImportReader(file, scan.index, async () => ({ status: 'missing' }) as never)
            return resolveLegacyTree(decoded.tree, reader)
        })
        // Only the size of `decoded.omitted` is read: its values carry block names and error messages.
        return await analyzeTree(resolved.database, resolved.incomplete.length, decoded.omitted.size)
    } finally {
        if (fd >= 0) fs.closeSync(fd)
    }
}

/** The real-run path: the analysis under the output seal. */
export function analyzeBinSealed(binPath: string): Promise<SealResult<AnalyzeResult>> {
    return withSealedOutput(() => analyzeBin(binPath))
}

/** Writes `ltm-aggregates.json` only when it conforms to the allow-list; otherwise nothing is written. */
export function writeAggregates(outDir: string, value: unknown): void {
    const violations = checkAggregates(value)
    if (violations.length > 0) throw new Error('ltm-eval: output refused, ' + violations.length + ' allow-list violations')
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, 'ltm-aggregates.json'), JSON.stringify(value, null, 1))
}
