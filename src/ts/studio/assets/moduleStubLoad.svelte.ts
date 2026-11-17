// Loading a module that is not loaded when it is selected in Studio. The ids being loaded are reactive, so the detail
// shows "Loading module" while one is in flight. `process/moduleLoader` is imported when the first request is made: it
// pulls in most of the app and a page that selects no stub never needs it.
import { untrack } from 'svelte'
import { SvelteSet } from 'svelte/reactivity'

const loading = new SvelteSet<string>()

/** Whether a load of the module with this raw id is in flight. Reactive. */
export function isStudioModuleLoading(rawId: string | null): boolean {
    return rawId !== null && loading.has(rawId)
}

/**
 * Loads the module's body, asking the person when the loader has to. The id is in the loading set from the moment this
 * is called, before the first await, and leaves it however the load ends. A failed import or load is logged and leaves
 * the stub where it is; nothing is thrown, so an effect may call this without catching. A request for an id that is
 * already loading does nothing, because the loader shares its flight anyway.
 */
export async function requestStudioModuleLoad(rawId: string): Promise<void> {
    if (untrack(() => loading.has(rawId))) return
    loading.add(rawId)
    try {
        const loader = await import('../../process/moduleLoader')
        const result = await loader.loadModuleStubsOf(rawId)
        // The person is being asked: the load goes on until the answer.
        if (result.kind === 'deferred') await result.settled
    } catch (error) {
        console.error(error)
    } finally {
        loading.delete(rawId)
    }
}

export function resetStudioModuleLoadsForTests(): void {
    loading.clear()
}
