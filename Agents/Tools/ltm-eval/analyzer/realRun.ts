// The real-run body, run inside the launcher's child: the path guards, the numbers-only progress file and the
// sealed analysis. The status file is written after the guards pass and again at every phase, so a crash leaves the
// last phase reached; every write is shape-checked and uses `fs` only, so it touches no sealed channel.
import v8 from 'node:v8'
import { analyzeBinSealed, writeAggregates, type AnalyzeResult } from './binRead'
import { checkRunPaths } from './runPaths.mjs'
import type { SealResult } from './seal'
import { IDLE_PROGRESS, STEP, startedStatus, statusOf, writeStatus, type RunProgress } from './status'

export type RealRunPaths = { bin: string; out: string; root: string; repoRoot: string }

export type RealRunObserver = {
    /** Awaited after each status write, with the phase it recorded. A test seam. */
    afterWrite?: (phase: number) => void | Promise<void>
    /** Minimum time between status writes caused by owner progress; default 2000. */
    ownerWriteIntervalMs?: number
}

const MIB = 1024 * 1024

/**
 * Runs the analysis of `bin` under the output seal and writes `ltm-status.json` (and, on success, `ltm-aggregates.json`)
 * into `out`. Throws a fixed message before any write when the path guards fail.
 */
export async function runRealAnalysis(paths: RealRunPaths, observe: RealRunObserver = {}): Promise<SealResult<AnalyzeResult>> {
    const problems = checkRunPaths(paths)
    if (problems.length > 0) throw new Error('ltm-eval: run paths refused, ' + problems.length + ' problems')
    const progress: RunProgress = { ...IDLE_PROGRESS }
    const interval = observe.ownerWriteIntervalMs ?? 2000
    let lastWrite = 0
    const sample = (): void => {
        const stats = v8.getHeapStatistics()
        progress.heapLimitMiB = Math.ceil(stats.heap_size_limit / MIB)
        // Sampled, so a lower bound: the heap can peak between two samples.
        progress.peakHeapMiB = Math.max(progress.peakHeapMiB, Math.ceil(stats.used_heap_size / MIB))
        progress.maxRssMiB = Math.ceil(process.resourceUsage().maxRSS / 1024)
    }
    const write = async (): Promise<void> => {
        sample()
        writeStatus(paths.out, startedStatus(progress))
        lastWrite = Date.now()
        await observe.afterWrite?.(progress.phase)
    }
    const result = await analyzeBinSealed(paths.bin, {
        async onPhase(phase) {
            progress.phase = phase
            if (phase === STEP.stream) progress.streamed = 1
            else if (phase === STEP.readDatabase) progress.streamed = 0
            await write()
        },
        async onOwner() {
            if (Date.now() - lastWrite >= interval) await write()
        },
        onDecline(index) { progress.declineReason = index },
    })
    sample()
    if (result.ok) {
        progress.streamed = result.value.streamed
        progress.declineReason = result.value.declineReason
    }
    writeStatus(paths.out, statusOf(result, progress))
    if (result.ok) writeAggregates(paths.out, result.value.aggregates)
    await observe.afterWrite?.(progress.phase)
    return result
}
