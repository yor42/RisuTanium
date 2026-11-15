// Starts the pack judge's module worker. It lives here because the node-API scan of the top-level theme-pack modules
// refuses `import.meta.url`, which the bundler needs to find the worker entry.
import type { JudgeWorkerLike } from '../judgeClient'

export function spawnJudgeWorker(): JudgeWorkerLike {
    return new Worker(new URL('./judgeWorker.ts', import.meta.url), { type: 'module' })
}
