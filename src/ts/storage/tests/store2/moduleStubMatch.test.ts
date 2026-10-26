// @vitest-environment node
import fc from 'fast-check'
import { describe, expect, test, vi } from 'vitest'
import type { JsonObject } from '../../blockFrame'
import { MODULE_STUB_KEY } from '../../moduleStub'
import { sameJsonValue } from '../../store2/codec/normalize'
import type { ModuleEntry } from '../../store2/format'
import { isRecordedStub, moduleStubOf, slotIsRecordedStub } from '../../store2/moduleStubMatch'

// The leaf must load with none of the heavy modules: a boot-time or install-time caller imports it alone.
vi.mock('../../store2/codec/stub', () => { throw new Error('the stub leaf imported codec/stub') })
vi.mock('../../store2/codec/split', () => { throw new Error('the stub leaf imported codec/split') })
vi.mock('uuid', () => { throw new Error('the stub leaf imported uuid') })
vi.mock('../../../process/coldCharacter', () => { throw new Error('the stub leaf imported coldCharacter') })

/**
 * `isRecordedStub` is the one definition of "this slot is still the stub minted from its recorded entry": the plain
 * value of the slot and `moduleStubOf(entry)` hold the same JSON value, symmetrically. A field the slot gained and a
 * field it lost both read as different; key order does not count.
 */

const entry = (over: Partial<ModuleEntry> = {}): ModuleEntry => ({
    id: 'm1',
    name: 'Module one',
    description: 'about one',
    namespace: 'ns',
    icon: 'i.png',
    hideIcon: true,
    lowLevelAccess: false,
    mcp: true,
    hasToggle: true,
    dsp: true,
    unit: ['u-m1', 10, 1, 1],
    al: ['a-m1', 5, 2, 3],
    il: ['i-m1', 5, 3, 2],
    ...over,
})

const stubOf = (over: Partial<ModuleEntry> = {}): JsonObject => moduleStubOf(entry(over))

describe('the leaf', () => {
    test('load guard: it loads with codec/stub, codec/split, uuid and coldCharacter replaced by modules that throw', async () => {
        vi.resetModules()
        const leaf = await import('../../store2/moduleStubMatch')
        expect(typeof leaf.isRecordedStub).toBe('function')
        expect(typeof leaf.moduleStubOf).toBe('function')
        expect(typeof leaf.slotIsRecordedStub).toBe('function')
    })
})

describe('isRecordedStub table', () => {
    const CASES: [string, (stub: JsonObject) => void, boolean][] = [
        ['equal', () => {}, true],
        ['an extra key', (stub) => { stub.lorebook = [] }, false],
        ['a missing key', (stub) => { delete stub.description }, false],
        ['a changed scalar', (stub) => { stub.name = 'other' }, false],
        ['a changed array element', (stub) => { (stub.al as unknown[])[0] = 'x' }, false],
        ['a changed array length', (stub) => { (stub.il as unknown[]).push(1) }, false],
        ['a unit of 3 elements against 4', (stub) => { stub.unit = (stub.unit as unknown[]).slice(0, 3) as never }, false],
        ['a trailing element on al', (stub) => { (stub.al as unknown[]).push('future') }, false],
        ['marker value 2', (stub) => { stub[MODULE_STUB_KEY] = 2 }, false],
        ['marker key absent', (stub) => { delete stub[MODULE_STUB_KEY] }, false],
        ['mcp lost', (stub) => { delete stub.mcp }, false],
        ['a different key order', (stub) => {
            const keys = Object.keys(stub).reverse()
            const copy = { ...stub }
            for (const key of Object.keys(stub)) {
                delete stub[key]
            }
            for (const key of keys) {
                stub[key] = copy[key]
            }
        }, true],
    ]

    test.each(CASES)('%s', (_label, change, expected) => {
        const stub = stubOf()
        change(stub)
        expect(isRecordedStub(stub, entry())).toBe(expected)
    })

    test('an entry that holds a field the stub lacks is different, and the swapped roles agree', () => {
        const withExtra = entry({ ...({ future: 1 } as object) })
        const plain = stubOf()
        expect(isRecordedStub(plain, withExtra)).toBe(false)
        expect(isRecordedStub(moduleStubOf(withExtra), entry())).toBe(false)
    })

    test('moduleStubOf copies unit, al and il element for element, a trailing element included', () => {
        const recorded = entry()
        ;(recorded.unit as unknown[]).push('future-unit')
        ;(recorded.al as unknown[]).push('future-al')
        ;(recorded.il as unknown[]).push('future-il')
        const stub = moduleStubOf(recorded)
        expect(stub.unit).toEqual(recorded.unit)
        expect(stub.al).toEqual(recorded.al)
        expect(stub.il).toEqual(recorded.il)
        expect(isRecordedStub(stub, recorded)).toBe(true)
    })

    test('mcp present on one side only is different both ways', () => {
        const without = entry()
        delete without.mcp
        expect(isRecordedStub(moduleStubOf(entry()), without)).toBe(false)
        expect(isRecordedStub(moduleStubOf(without), entry())).toBe(false)
    })

    test('a null il against a list is different both ways', () => {
        expect(isRecordedStub(stubOf({ il: null }), entry())).toBe(false)
        expect(isRecordedStub(stubOf(), entry({ il: null }))).toBe(false)
        expect(isRecordedStub(stubOf({ il: null }), entry({ il: null }))).toBe(true)
    })
})

describe('isRecordedStub is sameJsonValue over moduleStubOf', () => {
    const text = fc.string({ maxLength: 6 })
    const refArb = fc.tuple(fc.string({ minLength: 1, maxLength: 6 }), fc.nat(500), fc.nat(500))
    const entryArb: fc.Arbitrary<ModuleEntry> = fc.record({
        id: text,
        name: text,
        description: text,
        hasToggle: fc.boolean(),
        dsp: fc.boolean(),
        unit: refArb.map(([tail, bytes, crc]) => [tail, bytes, crc, 1] as ModuleEntry['unit']),
        al: refArb.map(([tail, bytes, crc]) => [tail, bytes, crc, 1] as ModuleEntry['al']),
        il: fc.option(refArb.map(([tail, bytes, crc]) => [tail, bytes, crc, 1] as NonNullable<ModuleEntry['il']>), { nil: null }),
        namespace: text,
        icon: text,
        hideIcon: fc.boolean(),
        lowLevelAccess: fc.boolean(),
        mcp: fc.constant(true),
    }, { requiredKeys: ['id', 'name', 'description', 'hasToggle', 'dsp', 'unit', 'al', 'il'] }) as fc.Arbitrary<ModuleEntry>

    type Perturbation = 'none' | 'reorder' | 'add-key' | 'remove-key' | 'scalar' | 'array-element' | 'array-length' | 'marker'
    const KINDS: Perturbation[] = ['none', 'reorder', 'add-key', 'remove-key', 'scalar', 'array-element', 'array-length', 'marker']
    /** Equality the test expects from the perturbation alone, without asking `sameJsonValue`. */
    const EXPECTED_EQUAL: Record<Perturbation, boolean> = {
        'none': true, 'reorder': true, 'add-key': false, 'remove-key': false, 'scalar': false, 'array-element': false, 'array-length': false, 'marker': false,
    }

    function perturbed(source: ModuleEntry, kind: Perturbation): JsonObject {
        const stub = JSON.parse(JSON.stringify(moduleStubOf(source))) as JsonObject
        switch (kind) {
            case 'reorder': {
                const reordered: JsonObject = {}
                for (const key of Object.keys(stub).reverse()) {
                    reordered[key] = stub[key]
                }
                return reordered
            }
            case 'add-key':
                stub.addedByTest = 0
                return stub
            case 'remove-key':
                delete stub.name
                return stub
            case 'scalar':
                stub.description = `${source.description}!`
                return stub
            case 'array-element':
                stub.unit = [...(stub.unit as unknown[]).slice(0, 1).map(value => `${String(value)}!`), ...(stub.unit as unknown[]).slice(1)] as never
                return stub
            case 'array-length':
                stub.al = [...(stub.al as unknown[]), 7] as never
                return stub
            case 'marker':
                stub[MODULE_STUB_KEY] = 2
                return stub
            default:
                return stub
        }
    }

    test('over generated entries and perturbations the verdict is the perturbation\'s and equals sameJsonValue', () => {
        fc.assert(fc.property(entryArb, fc.constantFrom(...KINDS), (source, kind) => {
            const plain = perturbed(source, kind)
            expect(isRecordedStub(plain, source)).toBe(EXPECTED_EQUAL[kind])
            expect(isRecordedStub(plain, source)).toBe(sameJsonValue(plain, moduleStubOf(source)))
        }), { numRuns: 300, seed: 20261026 })
    })
})

describe('slotIsRecordedStub', () => {
    test('a plain slot is compared like its plain copy', () => {
        expect(slotIsRecordedStub(stubOf(), entry())).toBe(true)
        expect(slotIsRecordedStub({ ...stubOf(), extra: 1 }, entry())).toBe(false)
    })

    test('a slot that cannot be read as JSON throws rather than reading as different', () => {
        expect(() => slotIsRecordedStub(null, entry())).toThrow()
    })
})
