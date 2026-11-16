import { describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock(import('../../stores.svelte'), () => ({
    CurrentTriggerIdStore: writable(null),
}) as unknown as typeof import('../../stores.svelte'))

import { checkCbs } from './cbsCheck'
import { classifyBlockStart, registryNameFor } from './cbsBlocks'
import { MACRO_ROWS } from './macroGroups'
import { createMacroIndex } from './macroIndex'
import { insertionFor, pickItems } from './macroPick'
import { collectMacroEntries } from './macroRegistry'

// The table pinned to the real registry and the real block checker: a row that fails here is corrected to the
// engine's spelling, never removed.
const index = createMacroIndex(collectMacroEntries())

// The row's insertion with a sample condition typed at the caret when the head takes one.
function skeleton(row: (typeof MACRO_ROWS)[number]): string {
    const insertion = insertionFor(row)
    if (row.kind !== 'block' || !row.head.endsWith(' ')) return insertion.text
    return `${insertion.text.slice(0, insertion.caret)}x${insertion.text.slice(insertion.caret)}`
}

describe('the macro table against the registry', () => {
    test('C2-U4(a) 66 rows with unique ids', () => {
        expect(MACRO_ROWS).toHaveLength(66)
        expect(new Set(MACRO_ROWS.map((row) => row.id)).size).toBe(66)
    })

    test('C2-U4(b) every plain and args row names a registered macro', () => {
        for (const row of MACRO_ROWS) {
            if (row.kind !== 'plain' && row.kind !== 'args') continue
            expect(index.lookup(row.name), row.id).not.toBeNull()
        }
    })

    test('C2-U4(b) a plain or args row inserts a name the engine runs', () => {
        for (const row of MACRO_ROWS) {
            if (row.kind !== 'plain' && row.kind !== 'args') continue
            const result = checkCbs(insertionFor(row).text, index, { mode: 'cbs', slotAllowed: false })
            expect(result.problems.filter((problem) => problem.kind === 'unknown-macro' || problem.kind === 'deprecated'), row.id).toEqual([])
        }
    })

    test('C2-U4(c) every block row is a block the checker knows and its skeleton is balanced', () => {
        for (const row of MACRO_ROWS) {
            if (row.kind !== 'block') continue
            const start = classifyBlockStart(row.head + (row.head.endsWith(' ') ? 'x' : ''), true)
            expect(start.kind, row.id).toBe('block')
            if (start.kind === 'block') expect(start.keyword, row.id).toBe(row.keyword)
            const problems = checkCbs(skeleton(row), index, { mode: 'cbs', slotAllowed: false }).problems
            expect(problems.filter((problem) => problem.kind === 'unclosed-block' || problem.kind === 'stray-block-close' || problem.kind === 'not-a-block'), row.id).toEqual([])
        }
    })

    test('C2-U4(d) :else and // are registered under their raw names and else sits inside a block', () => {
        const names = index.entries.map((entry) => entry.name)
        for (const row of MACRO_ROWS) {
            if (row.kind === 'else' || row.kind === 'comment') expect(names, row.id).toContain(row.raw)
        }
        const problems = checkCbs('{{#if x}}a{{:else}}b{{/if}}', index, { mode: 'cbs', slotAllowed: false }).problems
        expect(problems.filter((problem) => problem.kind === 'misplaced-else')).toEqual([])
    })

    test('a block row shows the usage of its registry name; code and func have none', () => {
        const items = pickItems(MACRO_ROWS, index, (id) => id)
        for (const row of MACRO_ROWS) {
            if (row.kind !== 'block') continue
            const name = registryNameFor(row.keyword)
            const shown = items.find((item) => item.key === `row:${row.id}`)
            if (name === null) expect(shown?.usage, row.id).toBeNull()
            else expect(shown?.usage, row.id).toBe(index.entries.find((entry) => entry.name === name)?.usage ?? null)
        }
    })
})

describe('the other macros', () => {
    const items = pickItems(MACRO_ROWS, index, (id) => id)
    const others = items.filter((item) => item.group === null)

    test('C2-U5 none is deprecated, doc-only or written as a block, and each is typeable by its name', () => {
        expect(others.length).toBeGreaterThan(0)
        for (const item of others) {
            const found = index.lookup(item.name)
            expect(found, item.name).not.toBeNull()
            expect(found?.deprecated, item.name).toBeNull()
            expect(found?.docOnly, item.name).toBe(false)
            expect(found?.blockSyntax, item.name).toBe(false)
            expect(index.typedNameWorks(found as NonNullable<typeof found>), item.name).toBe(true)
        }
    })

    test('C2-U5 no block, :else or // entry is offered twice', () => {
        expect(others.filter((item) => item.name.startsWith('#') || item.name.startsWith(':') || item.name === '//')).toEqual([])
    })

    test('C2-U5 time is offered once, by its row, and the entry it runs is the later registration', () => {
        expect(items.filter((item) => item.name === 'time')).toHaveLength(1)
        expect(others.find((item) => item.name === 'time')).toBeUndefined()
        expect(index.entries.filter((entry) => entry.name === 'time').length).toBeGreaterThan(1)
    })

    test('C2-U5 no other item is reached by a row', () => {
        const reached = new Set<unknown>()
        for (const row of MACRO_ROWS) {
            if (row.kind === 'plain' || row.kind === 'args') reached.add(index.lookup(row.name))
        }
        for (const item of others) expect(reached.has(index.lookup(item.name)), item.name).toBe(false)
    })

    test('C2-U5 an other item inserts {{name}} with the caret at its end', () => {
        for (const item of others) expect(item.insertion).toEqual({ text: `{{${item.name}}}`, caret: item.name.length + 4 })
    })
})
