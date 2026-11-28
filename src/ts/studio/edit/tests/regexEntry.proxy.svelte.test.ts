// The JSON-safe walk and the row classes over a real `$state` root: a Svelte proxy reports the target's prototype, so
// reactive lists read as plain, and a msgpack-decoded or null-prototype object is plain too.
import { describe, expect, test } from 'vitest'
import { Packr, Unpackr } from 'msgpackr/index-no-eval'
import { classifyRegexList, isJsonSafe } from '../regexEntry'

const classicEntry = { comment: 'a', in: 'x', out: 'y', type: 'editinput', ableFlag: false, flag: 'g' }

describe('over a $state root', () => {
    test('the proxy reports the target prototype and reads as plain', () => {
        const root = $state({ list: [{ ...classicEntry, x_future: { a: 1 } }] as unknown[] })
        expect(Object.getPrototypeOf(root.list[0])).toBe(Object.prototype)
        expect(Array.isArray(root.list)).toBe(true)
        expect(isJsonSafe(root.list)).toBe(true)
        expect(classifyRegexList(root.list)).toEqual({ kind: 'rows', rows: [{ kind: 'ok' }] })
    })

    test('a bad value injected through the proxy is found', () => {
        const root = $state({ list: [classicEntry] as unknown[] })
        root.list.push({ ...classicEntry, x: { y: undefined } })
        expect(isJsonSafe(root.list)).toBe(false)
        expect(classifyRegexList(root.list)).toEqual({ kind: 'notJsonSafe' })
    })

    test('a msgpack-decoded list and a null-prototype entry in a proxy are safe', () => {
        const packr = new Packr({ useRecords: false })
        const unpackr = new Unpackr({ int64AsType: 'number', useRecords: false })
        const decoded: unknown[] = unpackr.unpack(packr.pack([classicEntry]))
        const bare: unknown = Object.assign(Object.create(null), classicEntry)
        const root = $state({ list: decoded })
        root.list.push(bare)
        expect(isJsonSafe(root.list)).toBe(true)
        expect(classifyRegexList(root.list)).toEqual({ kind: 'rows', rows: [{ kind: 'ok' }, { kind: 'ok' }] })
    })

    test('a cycle through the proxy is found', () => {
        const root = $state({ list: [] as unknown[] })
        const entry: Record<string, unknown> = { ...classicEntry }
        root.list.push(entry)
        ;(root.list[0] as Record<string, unknown>).self = root.list
        expect(isJsonSafe(root.list)).toBe(false)
    })

    test('a raw cycle assigned into the tree is refused, though each read yields a new proxy', () => {
        const root = $state({ list: [] as unknown[] })
        const entry: Record<string, unknown> = { ...classicEntry }
        entry.self = entry
        root.list.push(entry)
        expect(isJsonSafe(root.list)).toBe(false)
    })
})
