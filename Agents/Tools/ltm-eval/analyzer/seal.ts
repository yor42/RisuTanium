// The in-process output seal. While `fn` runs, every console method, the stdout and stderr writers and
// process.emitWarning are replaced by counting no-ops, so nothing the application logs on the import path can
// reach a terminal, a file or the test reporter. The seal works on channels, not on log sites. The originals are
// restored exactly in `finally`. It never stores an argument, a message or an error object.
import { StepError, classIndexOf } from './status'

export type SealCounts = { console: number; streams: number; warnings: number }
export type SealResult<T> =
    | { ok: true; value: T; counts: SealCounts }
    | { ok: false; failedStep: number; errorClass: number; counts: SealCounts }

type Slot = { target: object; name: string; own: boolean; original: unknown }

function isFunctionAt(target: object, name: string): boolean {
    try {
        return typeof (target as Record<string, unknown>)[name] === 'function'
    } catch {
        return false
    }
}

function consoleMethodNames(): string[] {
    const names = new Set<string>(Object.getOwnPropertyNames(globalThis.console))
    const proto = Object.getPrototypeOf(globalThis.console)
    if (proto !== null && proto !== Object.prototype) for (const name of Object.getOwnPropertyNames(proto)) names.add(name)
    names.delete('constructor')
    return [...names].filter((name) => isFunctionAt(globalThis.console, name))
}

export async function withSealedOutput<T>(fn: () => Promise<T> | T): Promise<SealResult<T>> {
    const counts: SealCounts = { console: 0, streams: 0, warnings: 0 }
    const slots: Slot[] = []
    const replace = (target: object, name: string, stub: () => unknown): void => {
        const holder = target as Record<string, unknown>
        const own = Object.prototype.hasOwnProperty.call(target, name)
        const original = holder[name]
        try {
            holder[name] = stub
        } catch {
            return
        }
        slots.push({ target, name, own, original })
    }
    try {
        for (const name of consoleMethodNames()) replace(globalThis.console, name, () => { counts.console += 1 })
        replace(process.stdout, 'write', () => { counts.streams += 1; return true })
        replace(process.stderr, 'write', () => { counts.streams += 1; return true })
        replace(process, 'emitWarning', () => { counts.warnings += 1 })
        const value = await fn()
        return { ok: true, value, counts }
    } catch (error) {
        if (error instanceof StepError) return { ok: false, failedStep: error.step, errorClass: error.errorClass, counts }
        return { ok: false, failedStep: -1, errorClass: classIndexOf(error), counts }
    } finally {
        for (const { target, name, own, original } of slots.reverse()) {
            const holder = target as Record<string, unknown>
            if (own) holder[name] = original
            else delete holder[name]
        }
    }
}
