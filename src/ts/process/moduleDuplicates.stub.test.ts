/**
 * The import duplicate flow reads list fields only (name, id, namespace, MCP flag), so a module stub in the list is
 * matched and replaced without its body being loaded. Compatibility guards: they pass before and after the module UI
 * load helper exists.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { RisuModule } from 'src/ts/process/modules'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE } from 'src/ts/storage/moduleStub'
import { registerModuleLoader, unregisterModuleLoader } from 'src/ts/storage/store2/moduleAcquire'

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: { modules: [] } },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertSelect: vi.fn(async () => '0'),
}) as unknown as typeof import('src/ts/alert'))

import { DuplicateSession, applyModulePlacement, findDuplicateIndex } from 'src/ts/process/moduleDuplicates'

const stub = (id: string, name: string, extra: Record<string, unknown> = {}) =>
    ({ id, name, description: '', [MODULE_STUB_KEY]: MODULE_STUB_VALUE, ...extra }) as unknown as RisuModule

afterEach(() => {
    unregisterModuleLoader()
})

describe('import duplicate flow over a module stub', () => {
    test('guard: a stub is found by name, replaced in place and decided on without loading its body', async () => {
        const loader = vi.fn(async () => null)
        registerModuleLoader(loader)
        const list = [stub('a', 'Other'), stub('t', 'Target', { namespace: 'old' })]
        expect(findDuplicateIndex(list, 'Target')).toBe(1)
        const decision = await new DuplicateSession().decide(list, 'Target', 'Target.risum', false)
        expect(decision.choice).toBe('replace')
        const incoming = { id: 'n', name: 'Target', description: '', lorebook: [] } as RisuModule
        const placement = applyModulePlacement(list, incoming, decision)
        expect(placement.kind).toBe('replaced')
        expect(list[1].lorebook).toEqual([])
        expect(loader).not.toHaveBeenCalled()
    })

    test('guard: a stub that carries the MCP flag is never a duplicate target', () => {
        expect(findDuplicateIndex([stub('a', 'Same', { mcp: true })], 'Same')).toBe(-1)
    })
})
