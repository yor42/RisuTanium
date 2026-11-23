import { bodyIntercepterStore } from "src/ts/stores.svelte"
import { raceAbort, type RaceOutcome } from "../abortRace"

type InterceptorCallback = (typeof bodyIntercepterStore)[number]['callback']

/**
 * The one loop that calls the registered body interceptors, in registration order. Each call is raced on
 * `signal`: an interceptor that never settles cannot hold the caller after a Stop, and no later interceptor
 * is called once one is abandoned. A throw is logged and the next interceptor runs.
 */
async function forEachBodyInterceptor(
    signal: AbortSignal | null | undefined,
    call: (callback: InterceptorCallback) => Promise<unknown>,
): Promise<{ settled: boolean }> {
    for (const interceptor of bodyIntercepterStore) {
        try {
            const raced = await raceAbort(signal, () => call(interceptor.callback), { label: 'A body interceptor' })
            if (!raced.settled) {
                return { settled: false }
            }
        }
        catch (e) {
            console.error(e)
        }
    }
    return { settled: true }
}

/**
 * Chaining entry point: each interceptor receives the current payload, and a falsy return keeps it.
 * Used by `globalFetch` and `fetchNative`.
 */
export async function runBodyInterceptors<T>(payload: T, kind: string, signal: AbortSignal | null | undefined): Promise<RaceOutcome<T>> {
    const outcome = await forEachBodyInterceptor(signal, async (callback) => {
        payload = (await callback(payload, kind)) || payload
    })
    return outcome.settled ? { settled: true, value: payload } : { settled: false }
}

/**
 * Non-chaining entry point: each interceptor receives `argumentOf()`, evaluated for that call, and its return
 * value is ignored. Used by the Gemini event callbacks.
 */
export async function notifyBodyInterceptors(argumentOf: () => unknown, kind: string, signal: AbortSignal | null | undefined): Promise<RaceOutcome<void>> {
    const outcome = await forEachBodyInterceptor(signal, async (callback) => {
        await callback(argumentOf(), kind)
    })
    return outcome.settled ? { settled: true, value: undefined } : { settled: false }
}
