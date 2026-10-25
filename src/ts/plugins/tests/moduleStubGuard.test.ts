/**
 * `withoutModuleStubDowngrades`: the rule keyed by module id for what a plugin
 * offers as `modules`. Titles beginning "guard:" pin behaviour that may pass
 * before and after a change.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE } from '../../storage/moduleStub'
import type { RisuModule } from '../../process/modules'
import { withoutModuleStubDowngrades } from '../moduleStubGuard'

const full = (id: string): RisuModule => ({ id, name: id, description: id, lorebook: [] })
const stub = (id: string): RisuModule => ({ id, name: id, description: id, [MODULE_STUB_KEY]: MODULE_STUB_VALUE } as unknown as RisuModule)

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('withoutModuleStubDowngrades', () => {
    test('guard: an array without a stub comes back as the same object, and a non-array passes through', () => {
        const withoutStub = { modules: [full('A'), { id: 'B' } as RisuModule] }
        expect(withoutModuleStubDowngrades([full('A')], withoutStub, 'p')).toBe(withoutStub)
        const notAnArray = { modules: 'nope' }
        expect(withoutModuleStubDowngrades([full('A')], notAnArray, 'p')).toBe(notAnArray)
        const absent = {}
        expect(withoutModuleStubDowngrades([], absent, 'p')).toBe(absent)
    })

    test('a stub is replaced by the first live holder of its id, whatever that is, and dropped without one', () => {
        const liveFull = full('A')
        const liveStub = stub('B')
        const result = withoutModuleStubDowngrades(
            [liveFull, liveStub, full('A')],
            { modules: [stub('A'), stub('B'), stub('ghost'), full('C')], other: 1 },
            'p',
        )
        expect(result.modules[0]).toBe(liveFull)
        expect(result.modules[1]).toBe(liveStub)
        expect(result.modules).toHaveLength(3)
        expect(result.modules[2]).toEqual(full('C'))
        expect(result.other).toBe(1)
    })

    test('one warning per refused slot naming the plugin and the module id', () => {
        withoutModuleStubDowngrades([full('A')], { modules: [stub('A'), stub('ghost')] }, 'plug')
        const warnings = vi.mocked(console.warn).mock.calls.map((args) => String(args[0]))
        expect(warnings).toHaveLength(2)
        expect(warnings.every((text) => text.includes('plug'))).toBe(true)
        expect(warnings[1]).toContain('ghost')
    })
})
