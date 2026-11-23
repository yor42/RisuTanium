import { yieldByMessage } from '../storage/saveYield'
import { shouldBypassFrozenPagePaths } from '../storage/tauriByteTransport'

/**
 * The order in which plugin database writes land, and the wait a plugin's own other calls have for its write.
 *
 * Arrival order: a write takes its place in one FIFO synchronously in the task its message arrives in, so writes land in
 * the order they arrived. The waits that exist before the turn stay before it: a plugin-list prompt, an archived-character
 * restore, the first permission lookup of the session (a stored-grant read, prompt or not) and the plugin's first
 * script-hash computation after it loads. A write waiting there takes its place when that wait ends, and today it lands
 * only after that wait as well.
 *
 * Same-plugin order: while a plugin's latest write is open, each of that plugin's other calls waits until the write lands
 * or fails. The plugin's own database writes are never gated; they take their FIFO place at arrival.
 *
 * Deadlock freedom: a turn awaits only the previous hand-on and message yields, never a guest, a prompt or a gated call,
 * and a landing never rejects.
 */

interface Deferred {
    promise: Promise<void>
    resolve: () => void
}

function deferred(): Deferred {
    let resolve: () => void = () => {}
    const promise = new Promise<void>((done) => { resolve = done })
    return { promise, resolve }
}

/**
 * Answers, for one call of a plugin, the promise the call waits for before it is invoked, or null when it runs at once.
 * Evaluated once, synchronously, in the task the call's message arrives in.
 */
export type CallGate = (type: 'CALL_ROOT' | 'CALL_INSTANCE', method: string) => Promise<void> | null

/** Replaces the yield and the hidden-page test of the plugin write; only the plugin write reaches them. */
export interface PluginWriteYieldHooks {
    yieldFn?: () => Promise<void>
    skip?: () => boolean
}

const DATABASE_WRITE_METHODS: ReadonlySet<string> = new Set(['setDatabase', 'setDatabaseLite'])

let writeTail: Promise<void> = Promise.resolve()
/** The turns not yet handed on: open, waiting for their predecessor, or waiting for their own hand-on yield. */
let queued = 0
const latestByPlugin = new Map<string, Promise<void>>()
let testHooks: PluginWriteYieldHooks | null = null

/** Whether the plugin write posts no further yield: the page is hidden, and a hidden page may freeze with a message pending. */
export function pluginWriteYieldSkipped(): boolean {
    return testHooks?.skip?.() ?? shouldBypassFrozenPagePaths()
}

async function postYield(): Promise<void> {
    await (testHooks?.yieldFn ?? yieldByMessage)()
}

/**
 * One message yield of the plugin write: an ordinary task that waits its turn among the page's other tasks, and none at
 * all on a hidden page. The hidden-page test is read at each call.
 */
export async function pluginWriteYield(): Promise<void> {
    if (pluginWriteYieldSkipped()) {
        return
    }
    await postYield()
}

/** Whether any turn is open or waiting to be handed on. */
export function writesQueued(): boolean {
    return queued > 0
}

/** The promise that settles when the latest open write of `pluginName` has landed or failed; null when it has none. Never rejects. */
export function pluginWriteLanding(pluginName: string): Promise<void> | null {
    return latestByPlugin.get(pluginName) ?? null
}

/** The gate of one plugin's calls: every call but its own database writes waits for the plugin's latest write. */
export function pluginCallGate(pluginName: string): CallGate {
    return (type, method) => type === 'CALL_ROOT' && DATABASE_WRITE_METHODS.has(method) ? null : pluginWriteLanding(pluginName)
}

/**
 * Runs `body` in the next place of the write FIFO. The place is taken before this returns control to the caller. When
 * another turn is queued behind this one, the next turn starts one message task after this one lands, so every call this
 * landing releases finishes its microtask-only part first; with nothing queued the hand-on is immediate.
 */
export async function withWriteTurn<T>(pluginName: string | undefined, body: () => Promise<T>): Promise<T> {
    queued += 1
    const ready = writeTail
    const landing = deferred()
    const handOn = deferred()
    writeTail = handOn.promise
    if (pluginName !== undefined) {
        latestByPlugin.set(pluginName, landing.promise)
    }
    const release = (): void => {
        if (pluginName !== undefined && latestByPlugin.get(pluginName) === landing.promise) {
            latestByPlugin.delete(pluginName)
        }
        landing.resolve()
        void handOnAfterYield(handOn)
    }
    try {
        await ready
        return await body()
    } finally {
        release()
    }
}

async function handOnAfterYield(handOn: Deferred): Promise<void> {
    try {
        if (queued > 1 && !pluginWriteYieldSkipped()) {
            await postYield()
        }
    } finally {
        queued -= 1
        handOn.resolve()
    }
}

export function setPluginWriteYieldForTest(hooks: PluginWriteYieldHooks | null): void {
    testHooks = hooks
}

export function resetPluginWriteTurnsForTest(): void {
    writeTail = Promise.resolve()
    queued = 0
    latestByPlugin.clear()
}
