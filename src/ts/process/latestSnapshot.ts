/**
 * Reads a stream as fast as it produces and hands the consumer only the newest kept value.
 *
 * The pump loop awaits nothing but `reader.read()`, so an eager producer is never held back and a consumer that is busy
 * skips the values superseded meanwhile. Order inside `next()`: cancelled, then the pending value, then a stored failure
 * (sticky), then the end, then wait. The pending value therefore always comes before the end or an error the pump has
 * already met. Values still queued inside the source when it errors are discarded by the stream itself.
 *
 * `next()` supports one caller at a time. No timer is used anywhere, and a stream failure is kept as a value so that
 * nothing rejects before a consumer asks.
 */

type Pending<T> = { value: T }
type Failure = { error: unknown }
type LatestResult<T> = { done: false, value: T } | { done: true }

export function readLatest<T>(reader: ReadableStreamDefaultReader<T>, keep: (value: T) => boolean): {
    next(): Promise<LatestResult<T>>
    cancel(reason?: unknown): Promise<void>
} {
    let pending: Pending<T> | null = null
    let failure: Failure | null = null
    let ended = false
    let cancelled = false
    let wake: (() => void) | null = null

    const notify = () => {
        const waiter = wake
        wake = null
        waiter?.()
    }

    const pump = async () => {
        try {
            while(!cancelled){
                const readed = await reader.read()
                if(cancelled){
                    return
                }
                if(readed.done){
                    ended = true
                    return
                }
                if(keep(readed.value)){
                    pending = { value: readed.value }
                    notify()
                }
            }
        }
        catch(error){
            if(!cancelled){
                failure = { error }
            }
        }
        finally {
            notify()
        }
    }
    void pump()

    return {
        async next(){
            while(true){
                if(cancelled){
                    return { done: true }
                }
                if(pending){
                    const box = pending
                    pending = null
                    return { done: false, value: box.value }
                }
                if(failure){
                    throw failure.error
                }
                if(ended){
                    return { done: true }
                }
                await new Promise<void>((resolve) => {
                    wake = resolve
                })
            }
        },
        cancel(reason){
            cancelled = true
            pending = null
            notify()
            return reader.cancel(reason).catch(() => {})
        },
    }
}

/** One posted-message task: timers, frames and idle callbacks are never involved. Always resolves. */
export function yieldTask(): Promise<void> {
    if(typeof MessageChannel !== 'function'){
        return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
        const channel = new MessageChannel()
        channel.port1.onmessage = () => {
            channel.port1.close()
            resolve()
        }
        channel.port2.postMessage(null)
    })
}
