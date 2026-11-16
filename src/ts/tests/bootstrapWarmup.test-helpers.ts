import { expect } from 'vitest'
import type { WorkerGlobalState } from 'vitest'

// Boot-helper test files pay the cold transform of `src/ts/bootstrap` in `beforeAll(warmBootstrap,
// COLD_TRANSFORM_HOOK_MS)` instead of inside their first test's clock. The import runs under the file's own
// `vi.mock` registrations, so the mocked collaborators apply to it. It starts no boot: `bootstrap` only defines
// functions, and `loadData` is never called here. `vi.resetModules()` in the file's `beforeEach` clears evaluation
// but keeps the transform, so later imports only re-evaluate.
// A file may adopt this only if its mock factories survive one extra evaluation of `bootstrap`: a factory that
// captures a `vi.fn` consumed by a later assertion (the archive-reachability test's `startCharacterRearchive`)
// would see the warm-up's calls and must stay out.
//
// `expectBootstrapTransformed` reads the vitest worker's module-runner cache and asserts that a transformed
// `src/ts/bootstrap.ts` (a node holding `meta.code`) exists when a test starts. `vi.resetModules()` keeps `meta`, so
// after the hook the check holds before every test; without the hook it fails before the first one. A vitest change
// to the worker global or to `meta` retention makes it fail loudly, not pass.
// It is not a hook-adoption guard when the worker graph is shared (`isolate: false`, or any shared worker): there it
// passes whenever an earlier file in the same worker already transformed `bootstrap`, which is true about the cold
// cost but no longer shows that this file runs the hook. Red/green evidence uses single-file runs.

export async function warmBootstrap(): Promise<void> {
    await import('src/ts/bootstrap')
}

export function expectBootstrapTransformed(): void {
    const workerState = (globalThis as { __vitest_worker__?: WorkerGlobalState }).__vitest_worker__
    if (!workerState?.evaluatedModules) {
        throw new Error('bootstrapWarmup: vitest worker module cache (__vitest_worker__.evaluatedModules) is unavailable')
    }
    let found = false
    for (const [id, node] of workerState.evaluatedModules.idToModuleMap) {
        const path = id.replace(/\\/g, '/').split('?')[0]
        if (path.endsWith('/src/ts/bootstrap.ts') && node.meta && 'code' in node.meta) {
            found = true
            break
        }
    }
    expect(found, 'src/ts/bootstrap.ts must be transformed before the test starts').toBe(true)
}
