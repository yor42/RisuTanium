/**
 * The build-time switch for the put-back measurement hooks, and the two
 * run-time switches read under it. This module imports nothing and `MEASURE`
 * stays a module-level constant: a function form would not fold at build time
 * and would leave every measurement branch in a normal build.
 */

/** True in development and in a build made with `VITE_RISU_MEASURE=1`. */
export const MEASURE: boolean = import.meta.env.DEV || import.meta.env.VITE_RISU_MEASURE === '1'

const PUT_BACK_KEY = 'risu-measure-putback'
const TRIPWIRE_KEY = 'risu-measure-tripwire'

let putBackCache: boolean | undefined
let tripwireCache: boolean | undefined

function readSwitch(key: string): string | null {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
    } catch {
        return null
    }
}

/** False only in a measurement build whose storage says `off`; read once. */
export function putBackEnabled(): boolean {
    if (!MEASURE) {
        return true
    }
    putBackCache ??= readSwitch(PUT_BACK_KEY) !== 'off'
    return putBackCache
}

/** True only in a measurement build whose storage says `on`; read once. */
export function tripwireEnabled(): boolean {
    if (!MEASURE) {
        return false
    }
    tripwireCache ??= readSwitch(TRIPWIRE_KEY) === 'on'
    return tripwireCache
}

export function resetMeasureFlagsForTest(): void {
    putBackCache = undefined
    tripwireCache = undefined
}
