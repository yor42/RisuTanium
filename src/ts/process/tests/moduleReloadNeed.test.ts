import { describe, expect, test } from 'vitest'
import { isPointerInertModule, moduleChangeNeedsReload, POINTER_INERT_KEYS, type ModuleReloadBase } from '../moduleReloadNeed'
import type { RisuModule } from '../modules'
import { toAssetList } from 'src/ts/storage/assetList'
import { moduleStubOf } from 'src/ts/storage/store2/moduleStubMatch'
import type { ModuleEntry } from 'src/ts/storage/store2/format/types'

// Shape A is what the Settings producer writes; shape B is the loaded body of a module with empty list fields.
const shapeA = (id: string): RisuModule => ({ name: id, description: '', id })
const shapeB = (id: string): RisuModule => ({
    name: id, description: '', id, lorebook: [], regex: [], trigger: [], assets: toAssetList([]),
})
const stubOf = (id: string): RisuModule => {
    const entry: ModuleEntry = {
        id, name: id, description: '', unit: ['u-' + id, 10, 1, 1], al: ['a-' + id, 5, 2, 3], il: null, hasToggle: false, dsp: false,
    }
    return moduleStubOf(entry) as unknown as RisuModule
}

const SEL = 'c0|0'
const base = (...ids: string[]): ModuleReloadBase => ({ ids, selection: SEL })
const noRows = (_id: string): RisuModule[] => []
const rowsOf = (...rows: RisuModule[]) => (id: string) => rows.filter((row) => row.id === id)

describe('isPointerInertModule', () => {
    test.each([['A', shapeA], ['B', shapeB]] as const)('U9 shape %s with empty fields is inert', (_label, make) => {
        expect(isPointerInertModule(make('X'))).toBe(true)
    })

    test('U9 every empty form of a non-allow-listed key is inert', () => {
        for (const empty of [undefined, null, false, '', []]) {
            const module = { ...shapeA('X'), namespace: empty } as unknown as RisuModule
            expect(isPointerInertModule(module)).toBe(true)
        }
        expect(isPointerInertModule({ ...shapeA('X'), assets: toAssetList([]) })).toBe(true)
    })

    test('U9 a non-empty AssetList is not inert', () => {
        expect(isPointerInertModule({ ...shapeA('X'), assets: toAssetList([['a', 'b', 'c']]) })).toBe(false)
    })

    test('U7 a stub is not inert', () => {
        expect(isPointerInertModule(stubOf('S'))).toBe(false)
    })

    test.each([
        ['regex', { regex: [{ comment: '', in: 'a', out: 'b', type: 'editdisplay' }] }],
        ['lorebook', { lorebook: [{ key: 'k', comment: '', content: 'c', mode: 'normal', insertorder: 1, alwaysActive: false, secondkey: '', selective: false }] }],
        ['trigger', { trigger: [{ comment: '', type: 'manual', conditions: [], effect: [] }] }],
        ['assets', { assets: [['a', 'b', 'c']] }],
        ['namespace', { namespace: 'ns' }],
        ['customModuleToggle', { customModuleToggle: '<x>' }],
        ['an unknown future field', { futureField: 'x' }],
    ])('U7 %s makes the module affecting', (_label, extra) => {
        expect(isPointerInertModule({ ...shapeA('X'), ...extra } as unknown as RisuModule)).toBe(false)
    })

    test.each([
        ['U8a', 'mcp', { url: 'http://localhost' }],
        ['U8b', 'cjs', 'const a = 1'],
        ['U8c', 'lowLevelAccess', true],
        ['U8d', 'icon', 'icon.png'],
        ['U8e', 'name', 'Named'],
        ['U8f', 'description', 'Described'],
    ] as const)('%s a module carrying only %s is inert', (_label, key, value) => {
        const module = { id: 'X', name: '', description: '', [key]: value } as unknown as RisuModule
        expect(isPointerInertModule(module)).toBe(true)
    })

    test('hideIcon and backgroundEmbedding are inert', () => {
        expect(isPointerInertModule({ ...shapeA('X'), hideIcon: true })).toBe(true)
        expect(isPointerInertModule({ ...shapeA('X'), backgroundEmbedding: '<div></div>' })).toBe(true)
    })

    test('the allow-list holds exactly the nine display-inert fields', () => {
        expect([...POINTER_INERT_KEYS].sort()).toEqual([
            'backgroundEmbedding', 'cjs', 'description', 'hideIcon', 'icon', 'id', 'lowLevelAccess', 'mcp', 'name',
        ])
    })
})

describe('moduleChangeNeedsReload', () => {
    test('U1 no base always reloads', () => {
        expect(moduleChangeNeedsReload(null, [shapeA('X')], SEL, noRows)).toBe(true)
    })

    test('U2 a changed selection reloads even for an inert delta', () => {
        expect(moduleChangeNeedsReload({ ids: [], selection: 'c0|1' }, [shapeA('X')], SEL, noRows)).toBe(true)
    })

    test('U3 an empty delta reloads (reorder or duplicate shift)', () => {
        const a = shapeA('A')
        const b = shapeA('B')
        expect(moduleChangeNeedsReload(base('A', 'B'), [b, a], SEL, noRows)).toBe(true)
        expect(moduleChangeNeedsReload(base('A'), [a, a], SEL, noRows)).toBe(true)
    })

    test('an inert added row does not reload', () => {
        expect(moduleChangeNeedsReload(base(), [shapeB('X')], SEL, noRows)).toBe(false)
    })

    test('U4 an affecting or stub added row reloads', () => {
        expect(moduleChangeNeedsReload(base(), [{ ...shapeA('X'), namespace: 'ns' }], SEL, noRows)).toBe(true)
        expect(moduleChangeNeedsReload(base(), [stubOf('S')], SEL, noRows)).toBe(true)
    })

    test('an inert removed row does not reload', () => {
        expect(moduleChangeNeedsReload(base('X'), [], SEL, rowsOf(shapeA('X')))).toBe(false)
    })

    test('U5 a removed row whose current body is affecting reloads', () => {
        expect(moduleChangeNeedsReload(base('X'), [], SEL, rowsOf({ ...shapeA('X'), regex: [{ comment: '', in: 'a', out: 'b', type: 'editdisplay' }] }))).toBe(true)
    })

    test('U5 one affecting duplicate among the current rows reloads', () => {
        const rows = rowsOf(shapeA('X'), { ...shapeA('X'), customModuleToggle: '<x>' })
        expect(moduleChangeNeedsReload(base('X'), [], SEL, rows)).toBe(true)
    })

    test('U6 a removed id with no current row reloads', () => {
        expect(moduleChangeNeedsReload(base('X'), [], SEL, noRows)).toBe(true)
    })

    test('ids containing the join character are compared as ids, not as a split string', () => {
        const dashed = shapeA('a-b')
        expect(moduleChangeNeedsReload(base('a-b'), [dashed, shapeA('c')], SEL, noRows)).toBe(false)
    })

    test('U10 an equal selection with an empty base and one inert row does not reload', () => {
        expect(moduleChangeNeedsReload(base(), [shapeA('X')], SEL, noRows)).toBe(false)
    })
})
