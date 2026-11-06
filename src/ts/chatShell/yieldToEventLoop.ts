export interface YieldHost {
    scheduler?: { yield?: () => Promise<unknown> }
    MessageChannel?: typeof MessageChannel
    setTimeout: (callback: () => void, delay: number) => unknown
}

const globalHost: YieldHost = {
    get scheduler() { return (globalThis as { scheduler?: YieldHost['scheduler'] }).scheduler },
    get MessageChannel() { return (globalThis as { MessageChannel?: typeof MessageChannel }).MessageChannel },
    setTimeout: (callback, delay) => setTimeout(callback, delay),
}

// Resolves on a later macrotask so the browser can run input, paint and other tasks between two pieces of work.
// requestAnimationFrame is avoided on purpose: a backgrounded WebView throttles it and the stream would stall.
export function createYieldToEventLoop(host: YieldHost = globalHost): () => Promise<void> {
    return () => {
        const scheduled = host.scheduler
        if (scheduled && typeof scheduled.yield === 'function') {
            return Promise.resolve(scheduled.yield.call(scheduled)).then(() => undefined)
        }
        if (typeof host.MessageChannel === 'function') {
            const Channel = host.MessageChannel
            return new Promise<void>((resolve) => {
                const channel = new Channel()
                channel.port1.onmessage = () => {
                    channel.port1.onmessage = null
                    channel.port1.close()
                    resolve()
                }
                channel.port2.postMessage(null)
            })
        }
        return new Promise<void>((resolve) => { host.setTimeout(resolve, 0) })
    }
}

export const yieldToEventLoop: () => Promise<void> = createYieldToEventLoop()
