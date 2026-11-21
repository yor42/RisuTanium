/**
 * Test-only support for the suites that watch the legacy restore route's wait texts.
 *
 * The matchers derive the texts from `rtbRestoreChecking` and `rtbRestoreCopying`, so they hold in
 * every UI language and follow a wording change without a regex over translated text.
 *
 * `armTrigger` registers a fault or phase trigger that a test relies on. `expectEveryTriggerFired`
 * (run in `afterEach`) fails a trigger that stayed unfired, so a trigger that no longer recognises
 * the production text cannot go silently dead.
 */
import { language } from 'src/lang'

function percentOf(text: string, template: (percent: number) => string): number | null {
    for (let percent = 0; percent <= 100; percent++) {
        if (text === template(percent)) return percent
    }
    return null
}

/** The integer percent of a walk (check) wait text, or null when `text` is not one. */
export function restoreCheckPercent(text: string): number | null {
    return percentOf(text, (percent) => language.rtbRestoreChecking(percent))
}

/** The integer percent of a copy wait text, or null when `text` is not one. */
export function restoreCopyPercent(text: string): number | null {
    return percentOf(text, (percent) => language.rtbRestoreCopying(percent))
}

/** True exactly when `text` is `rtbRestoreChecking(n)` for an integer n in 0..100. */
export function isRestoreCheckText(text: string): boolean {
    return restoreCheckPercent(text) !== null
}

/** True exactly when `text` is `rtbRestoreCopying(n)` for an integer n in 0..100. */
export function isRestoreCopyText(text: string): boolean {
    return restoreCopyPercent(text) !== null
}

export type TriggerExpectation = 'fires' | 'never'

export interface ArmedTrigger {
    /** Records that the trigger fired. */
    hit(): void
    /** How many times the trigger fired. */
    fired(): number
}

interface TriggerEntry {
    name: string
    expect: TriggerExpectation
    count: number
}

const triggerRegistry: TriggerEntry[] = []

/**
 * Registers a trigger. A test whose scenario legitimately ends before the trigger can fire arms it with
 * `{ expect: 'never' }` and says why next to the call.
 */
export function armTrigger(name: string, opts?: { expect?: TriggerExpectation }): ArmedTrigger {
    const entry: TriggerEntry = { name, expect: opts?.expect ?? 'fires', count: 0 }
    triggerRegistry.push(entry)
    return {
        hit: () => {
            entry.count++
        },
        fired: () => entry.count,
    }
}

/** Fails for an unfired 'fires' trigger and for a fired 'never' trigger, then clears the registry. */
export function expectEveryTriggerFired(): void {
    const problems: string[] = []
    for (const entry of triggerRegistry) {
        if (entry.expect === 'fires' && entry.count === 0) {
            problems.push(`trigger "${entry.name}" was armed but never fired`)
        }
        if (entry.expect === 'never' && entry.count > 0) {
            problems.push(`trigger "${entry.name}" fired but was expected not to`)
        }
    }
    triggerRegistry.length = 0
    if (problems.length > 0) throw new Error(problems.join('\n'))
}
