import { SvelteMap } from 'svelte/reactivity'
import type { TestOutcome } from './connectionTest'

/*
 * The last test result of each connection for this app session. Nothing here is persisted: a result
 * is lost on restart, so it adds no stored field and leaves the `.bin` translation unchanged. A
 * result is bound to the URL and key state it ran against through a stamp and reads as absent once
 * either has changed.
 */

type Entry = { outcome: TestOutcome, stamp: string }

const results = new SvelteMap<string, Entry>()

/** The identity of what a test ran against: the URL and the key state (never the key itself). */
export function testStamp(url: string | undefined, keyState: string): string {
    return JSON.stringify([url ?? '', keyState])
}

export function rememberTest(id: string, stamp: string, outcome: TestOutcome): void {
    results.set(id, { outcome, stamp })
}

/** The remembered result of `id`, or null when none exists or it ran against another URL or key. */
export function rememberedTest(id: string, stamp: string): TestOutcome | null {
    const entry = results.get(id)
    return entry !== undefined && entry.stamp === stamp ? entry.outcome : null
}

export function forgetTest(id: string): void {
    results.delete(id)
}
