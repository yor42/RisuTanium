import { describe, expect, test } from 'vitest'
import { pack, unpack } from 'msgpackr'
import { SaveParkError } from '../saveHold'
import { assertNoModuleStubs, isModuleStub, MODULE_STUB_KEY, MODULE_STUB_VALUE, ModuleStubRefusal } from '../moduleStub'
import { plainObject, toPlainJson } from '../store2/codec/normalize'

const stub = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id: 'm1', name: 'Module one', [MODULE_STUB_KEY]: MODULE_STUB_VALUE, ...extra })
const full = (): Record<string, unknown> => ({ id: 'm1', name: 'Module one', description: '', lorebook: [], regex: [], trigger: [] })

describe('isModuleStub', () => {
    test('is true for the marker and false for everything else', () => {
        expect(isModuleStub(stub())).toBe(true)
        expect(isModuleStub(full())).toBe(false)
        expect(isModuleStub(null)).toBe(false)
        expect(isModuleStub(undefined)).toBe(false)
        expect(isModuleStub([stub()])).toBe(false)
        expect(isModuleStub(Object.assign([], { [MODULE_STUB_KEY]: MODULE_STUB_VALUE }))).toBe(false)
        expect(isModuleStub('text')).toBe(false)
        expect(isModuleStub(1)).toBe(false)
        expect(isModuleStub(true)).toBe(false)
    })

    test('the marker key and value are exact', () => {
        expect(isModuleStub({ [MODULE_STUB_KEY]: 2 })).toBe(false)
        expect(isModuleStub({ [MODULE_STUB_KEY]: true })).toBe(false)
        expect(isModuleStub({ [MODULE_STUB_KEY]: '1' })).toBe(false)
        expect(isModuleStub({ [MODULE_STUB_KEY]: 0 })).toBe(false)
        expect(isModuleStub({ [MODULE_STUB_KEY]: null })).toBe(false)
    })

    test('a near-miss key is not the marker', () => {
        const withoutPrefix = MODULE_STUB_KEY.replace(/^\uEF02/, '')
        const prefixOnly = MODULE_STUB_KEY.slice(0, 1)
        expect(withoutPrefix).not.toBe(MODULE_STUB_KEY)
        expect(isModuleStub({ [withoutPrefix]: MODULE_STUB_VALUE })).toBe(false)
        expect(isModuleStub({ [prefixOnly + 'otherText']: MODULE_STUB_VALUE })).toBe(false)
        expect(isModuleStub({ [MODULE_STUB_KEY + 'x']: MODULE_STUB_VALUE })).toBe(false)
    })

    test('an inherited marker is not an own marker', () => {
        const inheriting = Object.create({ [MODULE_STUB_KEY]: MODULE_STUB_VALUE }) as object
        expect(isModuleStub(inheriting)).toBe(false)
    })

    test('the marker key is a string, so every plain-copy walk can see it', () => {
        expect(typeof MODULE_STUB_KEY).toBe('string')
        expect(Object.keys(stub())).toContain(MODULE_STUB_KEY)
    })
})

describe('the marker survives every carrier', () => {
    test('a $state proxy', () => {
        const live = $state(stub())
        expect(isModuleStub(live)).toBe(true)
        expect(Object.keys(live)).toContain(MODULE_STUB_KEY)
        const fullLive = $state(full())
        expect(isModuleStub(fullLive)).toBe(false)
    })

    test('asking a $state proxy about a missing marker adds no own key', () => {
        const live = $state(full())
        expect(isModuleStub(live)).toBe(false)
        expect(Object.keys(live)).not.toContain(MODULE_STUB_KEY)
    })

    test('$state.snapshot and structuredClone of the snapshot', () => {
        const live = $state(stub())
        const snapshot = $state.snapshot(live)
        expect(isModuleStub(snapshot)).toBe(true)
        expect(isModuleStub(structuredClone(snapshot))).toBe(true)
    })

    test('a JSON round trip', () => {
        expect(isModuleStub(JSON.parse(JSON.stringify(stub())))).toBe(true)
    })

    test('the codec plain copy walk, on a proxy as well', () => {
        expect(isModuleStub(toPlainJson(stub()))).toBe(true)
        expect(isModuleStub(plainObject(stub(), 'modules[0]'))).toBe(true)
        const live = $state(stub())
        expect(isModuleStub(plainObject(live, 'modules[0]'))).toBe(true)
    })

    test('msgpackr pack and unpack', () => {
        expect(isModuleStub(unpack(pack(stub())))).toBe(true)
    })
})

describe('assertNoModuleStubs', () => {
    test('tolerates absent, empty and non-list values', () => {
        expect(() => assertNoModuleStubs(undefined, 'here')).not.toThrow()
        expect(() => assertNoModuleStubs(null, 'here')).not.toThrow()
        expect(() => assertNoModuleStubs({}, 'here')).not.toThrow()
        expect(() => assertNoModuleStubs([], 'here')).not.toThrow()
        expect(() => assertNoModuleStubs('modules', 'here')).not.toThrow()
        expect(() => assertNoModuleStubs(5, 'here')).not.toThrow()
        expect(() => assertNoModuleStubs([full(), null, 3, 'x'], 'here')).not.toThrow()
    })

    test('scans an object of modules by its values', () => {
        expect(() => assertNoModuleStubs({ a: full() }, 'here')).not.toThrow()
        expect(() => assertNoModuleStubs({ a: full(), b: stub({ id: 'b1', name: 'B' }) }, 'here')).toThrow(ModuleStubRefusal)
    })

    test('refuses the first stub with a SaveParkError that names the module and where', () => {
        let caught: unknown
        try {
            assertNoModuleStubs([full(), stub({ id: 'first', name: 'First stub' }), stub({ id: 'second', name: 'Second stub' })], 'the test site')
        } catch (error) {
            caught = error
        }
        expect(caught).toBeInstanceOf(ModuleStubRefusal)
        expect(caught).toBeInstanceOf(SaveParkError)
        const refusal = caught as ModuleStubRefusal
        expect(refusal.what).toBe('modules')
        expect(refusal.kind).toBe('module-stub')
        expect(refusal.moduleId).toBe('first')
        expect(refusal.moduleName).toBe('First stub')
        expect(refusal.where).toBe('the test site')
        expect(refusal.message).toContain('First stub')
        expect(refusal.message).toContain('first')
        expect(refusal.message).toContain('the test site')
        expect(refusal.message).not.toContain('Second stub')
    })

    test('refuses a stub held by a $state proxy list', () => {
        const live = $state([full(), stub({ id: 'p1', name: 'Proxied' })])
        expect(() => assertNoModuleStubs(live, 'here')).toThrow(/Proxied/)
    })

    test('a stub with no id or name is still refused', () => {
        expect(() => assertNoModuleStubs([{ [MODULE_STUB_KEY]: MODULE_STUB_VALUE }], 'here')).toThrow(ModuleStubRefusal)
    })
})
