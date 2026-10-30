/**
 * An in-memory record of errors the application caught and survived.
 *
 * Release builds strip every `console.*` call, so a caught error would otherwise leave no trace. The record keeps
 * the last `MAX_RECORDS` errors and is read through `window.__risuTaniumErrors`, which returns a copy. Nothing is
 * persisted, and nothing here changes what the caller does with the error.
 */

export interface CaughtErrorRecord {
    /** ISO time the error was caught. */
    time: string
    /** Where it was caught, for example `chat.message`. */
    site: string
    name: string
    /** Truncated to `MAX_MESSAGE_LENGTH` characters. */
    message: string
    /** The first `MAX_STACK_LINES` lines of the stack; empty when the thrown value had none. */
    stack: string
}

declare global {
    interface Window {
        /** A copy of the caught-error record, oldest first. */
        readonly __risuTaniumErrors?: CaughtErrorRecord[]
    }
}

export const MAX_RECORDS = 50
const MAX_MESSAGE_LENGTH = 300
const MAX_STACK_LINES = 4
const UNPRINTABLE_MESSAGE = '(value without a string form)'
// Bounds the memory of what was already printed; a full set starts over.
const MAX_PRINTED_KEYS = 200

const records: CaughtErrorRecord[] = []
const printedKeys = new Set<string>()

// Resolved at call time, through a computed member that the release build's console stripping does not match.
const printToConsole = (...args: unknown[]) => console['error'](...args)

function describe(error: unknown): { name: string, message: string, stack: string } {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: (error.stack ?? '').split('\n').slice(0, MAX_STACK_LINES).join('\n'),
        }
    }
    // A value without a string form (for example a null-prototype object) must not make the recorder throw.
    let message: string
    try {
        message = String(error)
    } catch {
        message = UNPRINTABLE_MESSAGE
    }
    return { name: 'NonError', message, stack: '' }
}

/**
 * Records a caught error. Every call is recorded (the ring is bounded); the console line is printed once per
 * site and message, so a failure that repeats on every update does not flood the console.
 */
export function recordCaughtError(site: string, error: unknown): void {
    const { name, message, stack } = describe(error)
    const shortMessage = message.length > MAX_MESSAGE_LENGTH ? message.slice(0, MAX_MESSAGE_LENGTH) : message
    records.push({ time: new Date().toISOString(), site, name, message: shortMessage, stack })
    if (records.length > MAX_RECORDS) {
        records.splice(0, records.length - MAX_RECORDS)
    }

    const key = `${site}\u0000${shortMessage}`
    if (!printedKeys.has(key)) {
        if (printedKeys.size >= MAX_PRINTED_KEYS) {
            printedKeys.clear()
        }
        printedKeys.add(key)
        printToConsole(`[caught error] ${site}: ${name}: ${shortMessage}`)
    }
}

if (typeof window !== 'undefined') {
    Object.defineProperty(window, '__risuTaniumErrors', {
        configurable: true,
        enumerable: false,
        get: () => records.map((record) => ({ ...record })),
    })
}
