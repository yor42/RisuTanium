// The worker path of the store: a step holding an object-list op is diffed against its previous step and rebuilt from
// the edits, and what the entry carries (an own `__proto__` key, a value shaped like a field-presence marker, deep
// nesting) comes back deep-equal. A compatibility guard: the protocol exists before the obj ops, so it may pass before
// and after; it guards the new payloads.
import { describe, expect, test } from 'vitest'
import { applyEdits, diffEntry } from '../studioStoreProtocol'
import type { ObjFamilyOp } from '../objectListOps'

function deep(depth: number): unknown {
    let value: unknown = 'leaf'
    for (let level = 0; level < depth; level += 1) {
        value = { nested: value, level }
    }
    return value
}

// `JSON.parse` makes `__proto__` an own key, as the store's read path does.
const entry = JSON.parse('{"comment":"c","content":"x","marker":{"had":true,"value":1},"__proto__":{"polluted":true},"deep":null}') as Record<string, unknown>
entry.deep = deep(12)

const insert: ObjFamilyOp = { op: 'objInsert', list: 'lore', index: 0, entry: entry as ObjFamilyOp extends { entry: infer E } ? E : never, counts: { content: 1 } }
const set: ObjFamilyOp = {
    op: 'objSet',
    list: 'lore',
    index: 0,
    field: 'extentions',
    before: { had: false },
    after: { had: true, value: JSON.parse('{"__proto__":{"x":1},"had":true,"value":{"a":[1,2,{"b":null}]}}') },
    anchorBefore: 1,
    anchorAfter: 2,
}

function stepOf(id: string, ops: ObjFamilyOp[]): Record<string, unknown> {
    return { id, at: 1, label: { kind: 'obj', list: 'lore', action: 'edit', name: null }, ops }
}

describe('T57: obj payloads survive the delta protocol', () => {
    test.each([
        ['insert after a set', stepOf('s1', [set]), stepOf('s1', [insert])],
        ['set after an insert', stepOf('s1', [insert]), stepOf('s1', [set])],
        ['an edited insert', stepOf('s1', [insert]), stepOf('s1', [{ ...insert, index: 3 } as ObjFamilyOp])],
    ])('%s is rebuilt deep-equal, own __proto__ keys kept', (_name, base, next) => {
        const edits = diffEntry(next, base)
        expect(edits).not.toBeNull()
        const rebuilt = applyEdits(base, edits ?? [])
        expect(rebuilt).toEqual(next)
        expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(next))
        const rebuiltOps = rebuilt.ops as ObjFamilyOp[]
        const rebuiltEntry = rebuiltOps[0].op === 'objInsert' ? rebuiltOps[0].entry : undefined
        if (rebuiltEntry !== undefined) {
            expect(Object.hasOwn(rebuiltEntry, '__proto__')).toBe(true)
            expect(Object.getPrototypeOf(rebuiltEntry)).toBe(Object.prototype)
            expect(({} as Record<string, unknown>).polluted).toBeUndefined()
        }
        const rebuiltSet = rebuiltOps[0].op === 'objSet' && rebuiltOps[0].after.had ? rebuiltOps[0].after.value : undefined
        if (typeof rebuiltSet === 'object' && rebuiltSet !== null) {
            expect(Object.hasOwn(rebuiltSet, '__proto__')).toBe(true)
        }
    })
})
