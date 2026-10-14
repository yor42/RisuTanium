import { describe, expect, test } from 'vitest'
import type { JsonObject } from '../../blockFrame'
import { assembleModules, isUnchanged, moduleEntryFields, unitsToWrite } from '../../store2/codec'
import { UNIT_TYPE, type ModuleEntry, type ModuleIndex } from '../../store2/format'
import {
    asDatabase, bodyOf, buildSmall, encodeWith, previousFrom, roundTrip, seededEnv, unitOf, type Obj,
} from './codecFixtures'

function withModules(modules: Obj[]) {
    return asDatabase({ ...(buildSmall(1) as unknown as Obj), modules })
}

const mod = (id: string, extra: JsonObject = {}): JsonObject => ({ name: `Module ${id}`, description: `about ${id}`, id, lorebook: [], regex: [], trigger: [], ...extra })

describe('module units', () => {
    test('each module is one unit of type 9 and the index lists them in order', () => {
        const tree = encodeWith(withModules([mod('b'), mod('a'), mod('c')]))
        const index = bodyOf(unitOf(tree, 'moduleIndex')) as unknown as ModuleIndex
        expect(index.entries.map(entry => entry.id)).toEqual(['b', 'a', 'c'])
        for (const entry of index.entries) {
            const unit = unitOf(tree, `module:${entry.id}#0`)
            expect(unit.type).toBe(UNIT_TYPE.module)
            expect(entry.unit).toEqual(unit.ref)
            expect((bodyOf(unit).module as Obj).id).toBe(entry.id)
        }
        expect(tree.units.filter(unit => unit.type === UNIT_TYPE.module)).toHaveLength(3)
    })

    test('the index entry shows the list fields, typed copies only, and dsp is true', () => {
        const entry = moduleEntryFields(mod('x', { namespace: 'ns', icon: 'i.png', hideIcon: true, lowLevelAccess: false, customModuleToggle: '<t>' }))
        expect(entry).toEqual({ id: 'x', name: 'Module x', description: 'about x', namespace: 'ns', icon: 'i.png', hideIcon: true, lowLevelAccess: false, hasToggle: true, dsp: true })
        const odd = moduleEntryFields(mod('y', { namespace: 3, icon: null, hideIcon: 'yes', customModuleToggle: '' }))
        expect(odd).toEqual({ id: 'y', name: 'Module y', description: 'about y', hasToggle: false, dsp: true })
    })

    test('asset and inlay lists of a module are units named by the index entry', () => {
        const tree = encodeWith(withModules([mod('m1', { assets: [['a', 'assets/AB.PNG', 'png']] })]))
        const entry = (bodyOf(unitOf(tree, 'moduleIndex')) as unknown as ModuleIndex).entries[0] as ModuleEntry
        const list = unitOf(tree, 'al:module:m1#0')
        expect(list.type).toBe(UNIT_TYPE.assetList)
        expect(entry.al.slice(0, 3)).toEqual(list.ref)
        expect(bodyOf(list).l).toEqual(['ab.png'])
        expect(entry.il).toBeNull()
    })

    test('modules sharing an id are both stored in order', () => {
        const db = withModules([mod('dup', { name: 'first' }), mod('dup', { name: 'second' })])
        const { assembled } = roundTrip(db)
        expect(assembled.modules.map(module => module.name)).toEqual(['first', 'second'])
    })

    test('a module round trips with its unknown fields', () => {
        const module = mod('u', { futureModuleField: { deep: [1, { x: 2 }] }, cjs: 'return 1' })
        const { assembled } = roundTrip(withModules([module]))
        expect(assembled.modules[0]).toEqual(module)
    })

    test('an unchanged module keeps its units when another module changes', () => {
        const first = encodeWith(withModules([mod('a'), mod('b')]), { env: seededEnv(1) })
        const next = encodeWith(withModules([mod('a'), mod('b', { cjs: 'changed' })]), { env: seededEnv(2), previous: previousFrom(first) })
        const written = unitsToWrite(next).map(unit => unit.identity).sort()
        expect(written).toEqual(['manifest', 'module:b#0', 'moduleIndex'].sort())
        expect(isUnchanged(encodeWith(withModules([mod('a'), mod('b')]), { env: seededEnv(3), previous: previousFrom(first) }))).toBe(true)
    })

    test('assemble refuses a module unit that is not an object', () => {
        const index: ModuleIndex = { v: 1, entries: [{ ...moduleEntryFields(mod('z')), unit: ['u-x', 1, 1], al: ['u-y', 1, 1, 1], il: null }] }
        expect(() => assembleModules(index, () => 5 as never)).toThrow(/not an object/)
    })
})
