import { recordCaughtError } from '../caughtErrors'

/**
 * Install-time self-check (SC1) of the explicit write hook. The hook is only as live as the patched Svelte runtime
 * that calls it: a build that ships the stock runtime would register a callback nothing ever invokes, and every
 * DBState write would go unmarked without a sign. This writes once to a throwaway `$state` created here (a runes
 * module, so the compiler turns it into a state proxy) and asks whether the hook's callback saw it.
 *
 * `arm` hands the proxy to the hook before the write, `wasSeen` reads the hook's observation after it and `disarm`
 * always runs. A write that was not seen is recorded as `dbWriteHook.selfCheck`; nothing is marked and no error is
 * thrown, so the effects safety net keeps running as it always did. Returns whether the hook was live.
 */
export function checkWriteHookLive(arm: (probe: object) => void, wasSeen: () => boolean, disarm: () => void): boolean {
    const probe = $state({ n: 0 })
    try {
        arm(probe)
        probe.n = 1
    } catch (error) {
        recordCaughtError('dbWriteHook.selfCheck', error)
        return false
    } finally {
        disarm()
    }
    if (wasSeen()) return true
    recordCaughtError('dbWriteHook.selfCheck', new Error('the write hook callback did not observe a write to a throwaway state'))
    return false
}
