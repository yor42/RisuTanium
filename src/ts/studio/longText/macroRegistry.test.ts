// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock(import('../../stores.svelte'), () => ({
    CurrentTriggerIdStore: writable(null),
}) as unknown as typeof import('../../stores.svelte'))

import { collectMacroEntries } from './macroRegistry'
import { createMacroIndex } from './macroIndex'

const all = collectMacroEntries()
const index = createMacroIndex(all)

describe('real registry', () => {
    test('A3a-r1: no name is registered twice (pinned; update if the registry changes)', () => {
        const seen = new Map<string, number>()
        for (const e of all) {
            for (const raw of new Set([e.name, ...e.aliases])) {
                seen.set(raw, (seen.get(raw) ?? 0) + 1)
            }
        }
        const duplicated = [...seen].filter(([, n]) => n > 1).map(([name]) => name)
        expect(duplicated).toEqual([])
    })

    test('A3a-r1: time is one entry, the formatting one, and lookup reaches it', () => {
        const times = index.entries.filter((e) => e.name === 'time')
        expect(times).toHaveLength(1)
        const only = times[0]
        expect(only.summary.startsWith('Formats date/time using custom format string.')).toBe(true)
        expect(only.usage?.startsWith('{{time}}')).toBe(true)
        for (const typed of ['time', 'TIME', 'time::HH:mm']) {
            expect(index.lookup(typed)).toBe(only)
        }
    })

    test('A3a-r1: block syntax names', () => {
        for (const name of ['#if', '#when', ':else', '#each']) {
            expect(all.find((e) => e.name === name)?.blockSyntax, name).toBe(true)
        }
        expect(all.find((e) => e.name === 'user')?.blockSyntax).toBe(false)
    })

    test('A3a-r1: no internal entry in entries; the internal name cannot be typed (its key is empty)', () => {
        expect(index.entries.some((e) => e.internalOnly)).toBe(false)
        const internal = all.filter((e) => e.internalOnly)
        expect(internal.map((e) => e.name)).toEqual(['__'])
        expect(index.typedNameWorks(internal[0])).toBe(false)
    })

    test('A3a-r1: exactly three deprecated entries', () => {
        expect(all.filter((e) => e.deprecated !== null).map((e) => e.name).sort()).toEqual(['#if', '#if_pure', '#pure'])
    })

    test('A3a-r1: usage is non-null wherever the description carries Usage::', () => {
        const withUsage = all.filter((e) => e.usage !== null)
        // Pinned (update if the registry changes): 175 entries, 174 with a usage. The marker
        // is split off, so no summary keeps it and no entry is left with an empty usage.
        expect(all).toHaveLength(175)
        expect(withUsage).toHaveLength(174)
        expect(all.filter((e) => e.summary.includes('Usage::'))).toHaveLength(0)
        for (const e of withUsage) {
            expect(e.usage, e.name).not.toBe('')
        }
        expect(all.find((e) => e.name === 'user')?.usage).toBe('{{user}}')
    })

    test('A3a-r1: names a user cannot type are recorded, not hidden', () => {
        const failing = index.entries.filter((e) => !index.typedNameWorks(e)).map((e) => e.name)
        // Pinned (update if the registry changes): a new unreachable name must be noticed.
        expect(failing).toEqual(['video-img', '#if_pure', ':else'])
        for (const name of failing) {
            expect(index.lookup(name)?.name === name).toBe(false)
        }
    })
})
