/**
 * The pure reader of upstream's plugin storage index (`process/pluginStorageIndex.ts`) and its conversion into the fork's
 * per-key `_coldplugin` slots. The slot rules mirror upstream's loader: `l` beats `s`, a later entry for a key replaces
 * an earlier one, an entry without a string `k` is skipped, `trash` and `version` are not read.
 *
 * Tests whose title starts with `guard:` hold both before and after any change to the conversion; the others are
 * reproducers of the rule they name (the module is new, so they have no earlier base).
 */
import { describe, test, expect } from 'vitest'
import { v4 } from 'uuid'
import {
    convertPluginStorageIndex,
    isPluginStorageIndex,
    isPluginUnitId,
    largeIdsOfIndex,
    mergeIndexIntoSlotMap,
    pluginIndexPointer,
    slotsOfIndex,
    type PluginIndexIo,
    type PluginIndexRead,
    type PluginStorageIndex,
} from '../pluginStorageIndex'

function uid(n: number): string {
    return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
}

function indexOf(entries: unknown[], extra: Record<string, unknown> = {}): PluginStorageIndex {
    const index: unknown = { type: 'risu-plugin-storage-index', version: 1, entries, trash: [], ...extra }
    if (!isPluginStorageIndex(index)) {
        throw new Error('fixture is not an index')
    }
    return index
}

describe('isPluginStorageIndex', () => {
    test.each([
        ['null', null],
        ['an array', []],
        ['a string', 'risu-plugin-storage-index'],
        ['a wrong type', { type: 'other', entries: [], trash: [] }],
        ['no type', { entries: [], trash: [] }],
        ['entries that are not an array', { type: 'risu-plugin-storage-index', entries: {}, trash: [] }],
        ['no trash', { type: 'risu-plugin-storage-index', entries: [] }],
        ['trash that is not an array', { type: 'risu-plugin-storage-index', entries: [], trash: null }],
    ])('refuses %s', (_label, value) => {
        expect(isPluginStorageIndex(value)).toBe(false)
    })

    test('accepts the loader\'s requirements and nothing more: version and entry contents are not checked', () => {
        expect(isPluginStorageIndex({ type: 'risu-plugin-storage-index', entries: [1, null, 'x'], trash: ['junk'], version: 99 })).toBe(true)
    })
})

describe('slotsOfIndex', () => {
    test('a small entry is JSON text, a large entry a unit id, in entry order', () => {
        expect(slotsOfIndex(indexOf([{ k: 'a', s: '1' }, { k: 'b', l: uid(1) }]))).toEqual([
            { key: 'a', kind: 'small', json: '1' },
            { key: 'b', kind: 'large', id: uid(1) },
        ])
    })

    test('l beats s in the same entry', () => {
        expect(slotsOfIndex(indexOf([{ k: 'a', s: '"ignored"', l: uid(1) }]))).toEqual([{ key: 'a', kind: 'large', id: uid(1) }])
    })

    test('an l that is not a string leaves the s in force', () => {
        expect(slotsOfIndex(indexOf([{ k: 'a', s: '2', l: 5 }]))).toEqual([{ key: 'a', kind: 'small', json: '2' }])
    })

    test.each([
        ['small then small', [{ k: 'a', s: '1' }, { k: 'a', s: '2' }], { key: 'a', kind: 'small', json: '2' }],
        ['small then large', [{ k: 'a', s: '1' }, { k: 'a', l: uid(1) }], { key: 'a', kind: 'large', id: uid(1) }],
        ['large then small', [{ k: 'a', l: uid(1) }, { k: 'a', s: '3' }], { key: 'a', kind: 'small', json: '3' }],
        ['large then an entry with neither', [{ k: 'a', l: uid(1) }, { k: 'a' }], { key: 'a', kind: 'large', id: uid(1) }],
    ])('a duplicate k: the last usable entry wins (%s)', (_label, entries, expected) => {
        expect(slotsOfIndex(indexOf(entries))).toEqual([expected])
    })

    test.each([
        ['no k', { s: '1' }],
        ['a numeric k', { k: 1, s: '1' }],
        ['a null k', { k: null, s: '1' }],
        ['an object k', { k: { a: 1 }, s: '1' }],
        ['neither s nor l', { k: 'a' }],
        ['an object s', { k: 'a', s: { v: 1 } }],
        ['a numeric s', { k: 'a', s: 1 }],
        ['null', null],
        ['a number', 5],
        ['a string', 'text'],
        ['an array', ['a', 's']],
    ])('skips an entry with %s', (_label, entry) => {
        expect(slotsOfIndex(indexOf([entry]))).toEqual([])
    })

    test.each(['null', '0', 'false', '""', '"text"', '[]', '{}', '{"a":[1,null]}'])('keeps small JSON text %s verbatim (null and primitives included)', (json) => {
        expect(slotsOfIndex(indexOf([{ k: 'a', s: json }]))).toEqual([{ key: 'a', kind: 'small', json }])
    })

    test('trash and version are ignored', () => {
        const entries = [{ k: 'a', s: '1' }, { k: 'b', l: uid(2) }]
        const plain = slotsOfIndex(indexOf(entries))
        const noisy = slotsOfIndex(indexOf(entries, { version: 'x', trash: [{ id: uid(2), at: 1 }, null, 7] }))
        expect(noisy).toEqual(plain)
    })

    test('a key keeps the position of its first entry, as upstream\'s map does', () => {
        expect(slotsOfIndex(indexOf([{ k: 'a', s: '1' }, { k: 'b', s: '2' }, { k: 'a', s: '3' }])).map((slot) => slot.key)).toEqual(['a', 'b'])
    })
})

describe('largeIdsOfIndex', () => {
    test('lists every string l, also those a later entry replaces and those without a usable k', () => {
        const index = indexOf([
            { k: 'a', l: uid(1) },
            { k: 'a', s: '1' },
            { l: uid(2) },
            { k: 3, l: uid(3) },
            { k: 'b', l: 4 },
            null,
            { k: 'c', s: '1' },
        ])
        expect(largeIdsOfIndex(index)).toEqual([uid(1), uid(2), uid(3)])
    })
})

describe('pluginIndexPointer', () => {
    test.each([
        [{ _coldpluginIndex: uid(1) }, uid(1)],
        [{ _coldpluginIndex: 5 }, null],
        [{ _coldpluginIndex: null }, null],
        [{}, null],
        [undefined, null],
        [null, null],
    ])('reads %j as %s', (storage, expected) => {
        expect(pluginIndexPointer(storage)).toBe(expected)
    })
})

describe('mergeIndexIntoSlotMap', () => {
    test('index entries win, other legacy entries stay, dropped keys go', () => {
        const merged = mergeIndexIntoSlotMap(
            { shared: uid(1), kept: uid(2), gone: uid(3) },
            new Map([['shared', uid(4)], ['fresh', uid(5)]]),
            new Set(['gone']),
        )
        expect(merged).toEqual({ shared: uid(4), kept: uid(2), fresh: uid(5) })
    })

    test.each([['undefined', undefined], ['null', null], ['an array', [uid(1)]], ['a string', 'x']])('treats %s as no legacy map', (_label, legacy) => {
        expect(mergeIndexIntoSlotMap(legacy, new Map([['a', uid(1)]]), new Set())).toEqual({ a: uid(1) })
    })

    test('a key named __proto__ stays an own property and changes no prototype', () => {
        const merged = mergeIndexIntoSlotMap(undefined, new Map([['__proto__', uid(1)]]), new Set())
        expect(Object.keys(merged)).toEqual(['__proto__'])
        expect(Object.getPrototypeOf(merged)).toBe(Object.prototype)
    })
})

//#region conversion

interface IoFixture {
    io: PluginIndexIo
    units: Map<string, unknown>
    reads: string[]
    writes: string[]
}

/** In-memory units; `failWrite` names ids (or `*`) whose write answers false, `throwWrite` ones whose write throws. */
function makeIo(options: { units?: Record<string, unknown>, readResult?: PluginIndexRead, failWrite?: string[], throwWrite?: boolean, observe?: (id: string) => void } = {}): IoFixture {
    const units = new Map<string, unknown>(Object.entries(options.units ?? {}))
    const reads: string[] = []
    const writes: string[] = []
    let minted = 0
    const io: PluginIndexIo = {
        async read(id) {
            reads.push(id)
            if (options.readResult) {
                return options.readResult
            }
            return units.has(id) ? { status: 'ok', value: units.get(id) } : { status: 'missing' }
        },
        async write(id, value) {
            options.observe?.(id)
            expect(value).not.toBeUndefined()
            if (options.throwWrite) {
                throw new Error('write failed')
            }
            if (options.failWrite && (options.failWrite.includes('*') || options.failWrite.includes(id))) {
                return false
            }
            writes.push(id)
            units.set(id, value)
            return true
        },
        mint: () => uid(0x1000 + minted++),
    }
    return { io, units, reads, writes }
}

const POINTER = uid(0xa1)

function storageWith(index: unknown, extra: Record<string, unknown> = {}) {
    return { fixture: { _coldpluginIndex: POINTER, ...extra } as Record<string, unknown>, units: { [POINTER]: index } }
}

describe('convertPluginStorageIndex', () => {
    test('small entries become units equal to the parsed value (null and primitives included), large ones keep their unit, the pointer is gone', async () => {
        const { fixture, units } = storageWith(indexOf([
            { k: 'obj', s: '{"a":[1,null]}' },
            { k: 'nul', s: 'null' },
            { k: 'num', s: '0' },
            { k: 'txt', s: '""' },
            { k: 'big', l: uid(0xb1) },
        ]))
        const { io, units: store } = makeIo({ units })

        const result = await convertPluginStorageIndex(fixture, io)

        expect(result.missing).toEqual([])
        expect(Object.keys(fixture)).toEqual(['_coldplugin'])
        const slots = fixture._coldplugin as Record<string, string>
        expect(slots.big).toBe(uid(0xb1))
        expect(Object.fromEntries(['obj', 'nul', 'num', 'txt'].map((key) => [key, store.get(slots[key])]))).toEqual({
            obj: { a: [1, null] },
            nul: null,
            num: 0,
            txt: '',
        })
        expect(result.minted.sort()).toEqual(['obj', 'nul', 'num', 'txt'].map((key) => slots[key]).sort())
        for (const id of result.minted) {
            expect(isPluginUnitId(id)).toBe(true)
        }
    })

    test('the index wins over a _coldplugin key it also defines; other keys stay', async () => {
        const { fixture, units } = storageWith(indexOf([{ k: 'shared', s: '{"from":"index"}' }]), { _coldplugin: { shared: uid(1), kept: uid(2) } })
        const { io, units: store } = makeIo({ units })

        const result = await convertPluginStorageIndex(fixture, io)

        const slots = fixture._coldplugin as Record<string, string>
        expect(slots.kept).toBe(uid(2))
        expect(slots.shared).not.toBe(uid(1))
        expect(store.get(slots.shared)).toEqual({ from: 'index' })
        expect(result.missing).toEqual([])
    })

    test('a mapping is set only after its unit was written', async () => {
        const { fixture, units } = storageWith(indexOf([{ k: 'a', s: '1' }]))
        const seen: unknown[] = []
        const { io } = makeIo({ units, observe: () => seen.push((fixture._coldplugin as Record<string, string> | undefined)?.a ?? null) })

        await convertPluginStorageIndex(fixture, io)

        expect(seen).toEqual([null])
        expect((fixture._coldplugin as Record<string, string>).a).toBe(uid(0x1000))
    })

    test('a failed write leaves the key unmapped, drops the older mapping of that key, reports the minted id and converts the other keys', async () => {
        const { fixture, units } = storageWith(
            indexOf([{ k: 'bad', s: '1' }, { k: 'good', s: '2' }]),
            { _coldplugin: { bad: uid(1), kept: uid(2) } },
        )
        const { io, units: store } = makeIo({ units, failWrite: [uid(0x1000)] })

        const result = await convertPluginStorageIndex(fixture, io)

        expect(result.missing).toEqual([uid(0x1000)])
        const slots = fixture._coldplugin as Record<string, string>
        expect(Object.keys(slots).sort()).toEqual(['good', 'kept'])
        expect(store.get(slots.good)).toBe(2)
        expect(result.minted).toEqual([slots.good])
        expect('_coldpluginIndex' in fixture).toBe(false)
    })

    test('a write that throws is a failed write', async () => {
        const { fixture, units } = storageWith(indexOf([{ k: 'a', s: '1' }]))
        const { io } = makeIo({ units, throwWrite: true })

        const result = await convertPluginStorageIndex(fixture, io)

        expect(result.missing).toEqual([uid(0x1000)])
        expect(result.minted).toEqual([])
        expect('_coldpluginIndex' in fixture).toBe(false)
        expect(fixture._coldplugin).toEqual({})
    })

    test('small JSON text that does not parse is reported, never written as a value', async () => {
        const { fixture, units } = storageWith(indexOf([{ k: 'a', s: '{not json' }, { k: 'b', s: '1' }]))
        const { io, writes } = makeIo({ units })

        const result = await convertPluginStorageIndex(fixture, io)

        expect(result.missing).toEqual([uid(0x1000)])
        expect(writes).toEqual([uid(0x1001)])
        expect(Object.keys(fixture._coldplugin as object)).toEqual(['b'])
    })

    test('a large id that is no unit id is reported and not mapped', async () => {
        const { fixture, units } = storageWith(indexOf([{ k: 'a', l: '../escape' }]))
        const { io } = makeIo({ units })

        const result = await convertPluginStorageIndex(fixture, io)

        expect(result.missing).toEqual(['../escape'])
        expect(fixture._coldplugin).toEqual({})
    })

    test.each([
        ['a missing unit', { readResult: { status: 'missing' } as PluginIndexRead }, undefined],
        ['an unreadable unit', { readResult: { status: 'error', error: new Error('x') } as PluginIndexRead }, undefined],
        ['a unit that is not an index', {}, { type: 'other', entries: [], trash: [] }],
        ['a null unit', {}, null],
    ])('%s: the index unit is reported, nothing is turned into an empty value, the pointer is gone, the fork map is untouched', async (_label, options, unit) => {
        const { fixture, units } = storageWith(unit, { _coldplugin: { kept: uid(2) } })
        if (unit === undefined) {
            delete units[POINTER]
        }
        const { io, writes } = makeIo({ units, ...options })

        const result = await convertPluginStorageIndex(fixture, io)

        expect(result).toEqual({ minted: [], missing: [POINTER] })
        expect(writes).toEqual([])
        expect(fixture).toEqual({ _coldplugin: { kept: uid(2) } })
    })

    test('a read that throws is an unreadable unit', async () => {
        const { fixture } = storageWith(null)
        const io: PluginIndexIo = { read: async () => { throw new Error('boom') }, write: async () => true, mint: () => uid(1) }

        const result = await convertPluginStorageIndex(fixture, io)

        expect(result).toEqual({ minted: [], missing: [POINTER] })
        expect('_coldpluginIndex' in fixture).toBe(false)
    })

    test('a pointer that is no unit id is reported without a read', async () => {
        const fixture: Record<string, unknown> = { _coldpluginIndex: '../x' }
        const { io, reads } = makeIo()

        const result = await convertPluginStorageIndex(fixture, io)

        expect(result).toEqual({ minted: [], missing: ['../x'] })
        expect(reads).toEqual([])
        expect(fixture).toEqual({})
    })

    test('a pointer that is not a string is removed and reports nothing, as upstream reads a pointer only when it is a string', async () => {
        const fixture: Record<string, unknown> = { _coldpluginIndex: 7, _coldplugin: { kept: uid(2) } }
        const { io, reads } = makeIo()

        expect(await convertPluginStorageIndex(fixture, io)).toEqual({ minted: [], missing: [] })
        expect(reads).toEqual([])
        expect(fixture).toEqual({ _coldplugin: { kept: uid(2) } })
    })

    test.each([['a tree without the pointer', { _coldplugin: { kept: uid(2) } }], ['no storage', undefined], ['null storage', null]])('guard: %s is left alone', async (_label, storage) => {
        const before = JSON.stringify(storage)
        const { io, reads } = makeIo()

        expect(await convertPluginStorageIndex(storage, io)).toEqual({ minted: [], missing: [] })
        expect(reads).toEqual([])
        expect(JSON.stringify(storage)).toBe(before)
    })

    test('an index with no entries installs no map of its own', async () => {
        const { fixture, units } = storageWith(indexOf([]))
        const { io } = makeIo({ units })

        expect(await convertPluginStorageIndex(fixture, io)).toEqual({ minted: [], missing: [] })
        expect(fixture).toEqual({})
    })

    test('guard: the uuid package\'s ids, which the import mints, are unit ids', () => {
        for (let i = 0; i < 20; i++) {
            expect(isPluginUnitId(v4())).toBe(true)
        }
    })
})

//#endregion
