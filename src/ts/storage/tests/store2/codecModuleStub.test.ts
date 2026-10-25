import { describe, expect, test } from 'vitest'
import type { JsonObject } from '../../blockFrame'
import { stubFromModuleEntry } from '../../store2/codec/stub'
import { ENTRY_FIELDS_VERSION } from '../../store2/codec/modules'
import { CodecInputError, StubRefusedError } from '../../store2/codec/types'
import type { ModuleEntry } from '../../store2/format'
import { SaveParkError } from '../../saveHold'
import { asDatabase, buildSmall, encodeWith, type Obj } from './codecFixtures'

// The literal marker: the encode row means the same on a build that has no stub leaf.
const MARKER_KEY = '\uEF02moduleStub'

function withModules(modules: Obj[]) {
    return asDatabase({ ...(buildSmall(1) as unknown as Obj), modules })
}

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
    unit: ['u-m1', 10, 1, ENTRY_FIELDS_VERSION],
    al: ['a-m1', 5, 2, 3],
    il: ['i-m1', 5, 3, 2],
    ...over,
})

describe('encodeDatabase with a module stub', () => {
    test('encodeModules-with-stub-throws: the codec refuses, naming the module, with neither a stub nor a park error', () => {
        const db = withModules([{ id: 'ok', name: 'Fine', description: '' }, { id: 'stub-id-1', name: 'Stub Module Name', description: '', [MARKER_KEY]: 1 }])
        let caught: unknown
        try {
            encodeWith(db)
        } catch (error) {
            caught = error
        }
        expect(caught).toBeInstanceOf(CodecInputError)
        expect(caught).not.toBeInstanceOf(StubRefusedError)
        expect(caught).not.toBeInstanceOf(SaveParkError)
        const message = (caught as Error).message
        expect(message).toContain('Stub Module Name')
        expect(message).toContain('stub-id-1')
    })

    test('guard: a database without a stub is encoded', () => {
        expect(() => encodeWith(withModules([{ id: 'ok', name: 'Fine', description: '' }]))).not.toThrow()
    })
})

describe('stubFromModuleEntry', () => {
    test('is the entry fields plus the marker, with no body arrays', () => {
        const stub = stubFromModuleEntry(entry())
        expect(stub[MARKER_KEY]).toBe(1)
        expect(stub).toMatchObject({ id: 'm1', name: 'Module one', description: 'about one', namespace: 'ns', icon: 'i.png', hideIcon: true, lowLevelAccess: false, hasToggle: true, dsp: true })
        for (const body of ['lorebook', 'regex', 'trigger', 'cjs', 'assets', 'backgroundEmbedding']) {
            expect(body in stub).toBe(false)
        }
    })

    test('carries mcp true verbatim', () => {
        expect(stubFromModuleEntry(entry()).mcp).toBe(true)
    })

    test('unit keeps its four elements and unit, al and il are fresh copies', () => {
        const source = entry()
        const stub = stubFromModuleEntry(source)
        expect(stub.unit).toEqual(source.unit)
        expect((stub.unit as unknown[]).length).toBe(4)
        expect(stub.unit).not.toBe(source.unit)
        expect(stub.al).toEqual(source.al)
        expect(stub.al).not.toBe(source.al)
        expect(stub.il).toEqual(source.il)
        expect(stub.il).not.toBe(source.il)
        ;(stub.unit as unknown[])[0] = 'changed'
        expect(source.unit[0]).toBe('u-m1')
    })

    test('a null il stays null', () => {
        expect(stubFromModuleEntry(entry({ il: null })).il).toBeNull()
    })

    test('is plain JSON', () => {
        const stub: JsonObject = stubFromModuleEntry(entry())
        expect(JSON.parse(JSON.stringify(stub))).toEqual(stub)
    })
})

describe('StubRefusedError of the module kind', () => {
    test('carries the module id and name and names the module in its message', () => {
        const error = new StubRefusedError('module', 'mod-id-9', null, { name: 'Named Module', reason: 'uncarriable' })
        expect(error.kind).toBe('module')
        expect(error.chaId).toBe('mod-id-9')
        expect(error.moduleName).toBe('Named Module')
        expect(error.reason).toBe('uncarriable')
        expect(error.message).toContain('Named Module')
        expect(error.message).toContain('mod-id-9')
        expect(error.code).toBe('stub')
    })

    test('the edited reason is carried', () => {
        expect(new StubRefusedError('module', 'm', null, { name: 'n', reason: 'edited' }).reason).toBe('edited')
    })

    test('a character refusal has no module name or reason', () => {
        const error = new StubRefusedError('character', 'cha-1', null)
        expect(error.moduleName).toBe('')
        expect(error.reason).toBeNull()
    })
})
