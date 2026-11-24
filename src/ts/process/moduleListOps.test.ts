// @vitest-environment happy-dom
/**
 * The shared module list operations, called by the classic Modules page and by the Studio module list. They take the
 * clicked row object, never an index or an id alone, because the list can change while an alert is open.
 *
 * The real helpers and the real `useModuleRow` run over a plain database object. MOCKED: the alert, the module store's
 * acquire (it counts its calls), the export functions and the conversion (which throws for an MCP module, as the real
 * one does). A stub is minted by `moduleStubOf` from a store2 index entry, as the boot path mints it.
 *
 * Tests named T9-DELETE and T9-EXPORT are the fast form of the page rows of the same name; the mutants of the spec's
 * section 8 are what they kill.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuModule } from 'src/ts/process/modules'
import { language } from 'src/lang'
import { residentModule, stubModule } from 'src/ts/studio/studioFixtures.test-helpers'

const h = vi.hoisted(() => ({
    alertError: vi.fn(),
    acquire: vi.fn(),
    release: vi.fn(),
    exportModule: vi.fn(),
    exportModuleLegacy: vi.fn(),
    refreshModules: vi.fn(),
    checkCharOrder: vi.fn(),
    db: { current: null as unknown },
}))

vi.mock('uuid', () => ({ v4: () => 'new-id' }))
vi.mock('src/ts/alert', () => ({ alertError: h.alertError }))
vi.mock('src/ts/stores.svelte', () => ({
    DBState: { get db() { return h.db.current } },
}))
vi.mock('src/ts/storage/store2/moduleAcquire', () => ({ acquireModule: h.acquire }))
vi.mock('src/ts/process/modules', () => ({
    exportModule: h.exportModule,
    exportModuleLegacy: h.exportModuleLegacy,
    refreshModules: h.refreshModules,
}))
vi.mock('src/ts/globalApi.svelte', () => ({ checkCharOrder: h.checkCharOrder }))
vi.mock('src/ts/interchangeability', async () => {
    const { language: lang } = await import('src/lang')
    return {
        convertModuleToCharacter: (m: RisuModule) => {
            if (m.mcp) throw new Error(lang.errors.mcpModuleConversionUnsupported)
            return { chaId: 'made-' + m.id, name: m.name }
        },
    }
})

import {
    convertModuleRow, createModule, exportModuleRow, moduleIntegrationState, removeModuleRow, setModuleGlobal,
} from 'src/ts/process/moduleListOps'

type Db = { modules: RisuModule[], enabledModules: string[], moduleIntergration: string, characters: unknown[] }

function installDb(modules: RisuModule[], enabled: string[] = [], integration = ''): Db {
    const db: Db = { modules, enabledModules: enabled, moduleIntergration: integration, characters: [] }
    h.db.current = db
    return db
}

const mod = (id: string, over: Partial<RisuModule> = {}): RisuModule => residentModule(id, over)
const mcpBody = (id: string): RisuModule => ({ ...mod(id), mcp: { url: 'internal:dice' } })

beforeEach(() => {
    for (const fn of [h.alertError, h.acquire, h.release, h.exportModule, h.exportModuleLegacy, h.refreshModules, h.checkCharOrder]) fn.mockReset()
})

describe('T9-DELETE (unit): removeModuleRow', () => {
    test('removes the clicked row by reference, also when a row with the same id comes first', () => {
        const first = mod('shared', { name: 'First' })
        const second = mod('shared', { name: 'Second' })
        const db = installDb([first, second, mod('other')], ['shared'])
        expect(removeModuleRow(second)).toBe(true)
        expect(db.modules).toEqual([first, expect.objectContaining({ id: 'other' })])
        expect(db.modules[0]).toBe(first)
    })

    test('removes the clicked row when the list was reordered or grew since the row was drawn', () => {
        const target = mod('t')
        const db = installDb([mod('a'), target, mod('c')])
        db.modules.unshift(mod('new'))
        db.modules.reverse()
        expect(removeModuleRow(target)).toBe(true)
        expect(db.modules.map((m) => m.id)).toEqual(['c', 'a', 'new'])
    })

    test('a row that is no longer in the list changes nothing and refreshes nothing', () => {
        const gone = mod('gone')
        const db = installDb([mod('a')], ['gone'])
        expect(removeModuleRow(gone)).toBe(false)
        expect(db.modules).toHaveLength(1)
        expect(db.enabledModules).toEqual(['gone'])
        expect(h.refreshModules).not.toHaveBeenCalled()
    })

    test('the id stays in enabledModules while another row holds it and leaves it otherwise', () => {
        const a = mod('shared')
        const b = mod('shared')
        const db = installDb([a, b, mod('solo')], ['shared', 'solo'])
        removeModuleRow(a)
        expect(db.enabledModules).toEqual(['shared', 'solo'])
        removeModuleRow(b)
        expect(db.enabledModules).toEqual(['solo'])
    })

    test('refreshes the module memo once after the removal', () => {
        const row = mod('r')
        installDb([row])
        removeModuleRow(row)
        expect(h.refreshModules).toHaveBeenCalledTimes(1)
    })

    test('a stub row is removed without acquiring it', () => {
        const stub = stubModule('S1')
        const db = installDb([stub, mod('a')], ['S1'])
        expect(removeModuleRow(stub)).toBe(true)
        expect(h.acquire).not.toHaveBeenCalled()
        expect(db.modules.map((m) => m.id)).toEqual(['a'])
        expect(db.enabledModules).toEqual([])
    })
})

describe('createModule', () => {
    test('pushes the classic shape with a fresh id and returns the slot read back from the list', () => {
        const db = installDb([mod('a')])
        const slot = createModule('Name')
        expect(db.modules).toHaveLength(2)
        expect(db.modules[1]).toEqual({ name: 'Name', description: '', id: 'new-id' })
        expect(slot).toBe(db.modules[1])
    })
})

describe('setModuleGlobal', () => {
    test('pushes the id when turned on and splices its first occurrence when turned off', () => {
        const db = installDb([mod('a')], ['x', 'a', 'a'])
        setModuleGlobal('b', true)
        expect(db.enabledModules).toEqual(['x', 'a', 'a', 'b'])
        setModuleGlobal('a', false)
        expect(db.enabledModules).toEqual(['x', 'a', 'b'])
    })

    test('turning on an id that is already enabled adds no second entry', () => {
        const db = installDb([mod('a')], ['a'])
        setModuleGlobal('a', true)
        expect(db.enabledModules).toEqual(['a'])
    })
})

describe('moduleIntegrationState', () => {
    const state = (row: RisuModule, enabled: string[], integration: string) =>
        moduleIntegrationState(row, { enabledModules: enabled, moduleIntergration: integration } as Pick<Database, 'enabledModules' | 'moduleIntergration'>)

    test('global wins over every integration entry', () => {
        expect(state(mod('a'), ['a'], 'a')).toBe('global')
    })

    test('an id or a namespace in the integration string is integration, whitespace around entries ignored', () => {
        expect(state(mod('a'), [], 'x, a ,y')).toBe('integration')
        expect(state(mod('a', { namespace: 'ns' }), [], 'x, ns')).toBe('integration')
    })

    test('otherwise off, and an empty namespace or an empty string never matches', () => {
        expect(state(mod('a', { namespace: '' }), [], 'x,,y')).toBe('off')
        expect(state(mod('a'), [], '')).toBe('off')
        expect(state(mod(''), [], '')).toBe('off')
    })
})

describe('T9-EXPORT (unit): exportModuleRow', () => {
    test('CharX exports the acquired body and Legacy the legacy file, each through the row the click named', async () => {
        const row = mod('a')
        installDb([row])
        await exportModuleRow(row, 'charx')
        expect(h.exportModule).toHaveBeenCalledWith(row)
        expect(h.exportModuleLegacy).not.toHaveBeenCalled()
        await exportModuleRow(row, 'risum')
        expect(h.exportModuleLegacy).toHaveBeenCalledWith(row)
    })

    test('a stub is acquired once, exported as the acquired body, and released once', async () => {
        const stub = stubModule('S1')
        const body = mod('S1', { name: 'Loaded' })
        installDb([stub])
        h.acquire.mockResolvedValue({ module: body, release: h.release })
        await exportModuleRow(stub, 'charx')
        expect(h.acquire).toHaveBeenCalledTimes(1)
        expect(h.exportModule).toHaveBeenCalledWith(body)
        expect(h.release).toHaveBeenCalledTimes(1)
    })

    test('the release happens when the export throws, and the error reaches the caller', async () => {
        const stub = stubModule('S1')
        installDb([stub])
        h.acquire.mockResolvedValue({ module: mod('S1'), release: h.release })
        h.exportModule.mockRejectedValue(new Error('disk full'))
        await expect(exportModuleRow(stub, 'charx')).rejects.toThrow('disk full')
        expect(h.release).toHaveBeenCalledTimes(1)
    })

    test('a stub that cannot be loaded exports nothing', async () => {
        const stub = stubModule('S1')
        installDb([stub])
        h.acquire.mockResolvedValue(null)
        await exportModuleRow(stub, 'risum')
        expect(h.exportModule).not.toHaveBeenCalled()
        expect(h.exportModuleLegacy).not.toHaveBeenCalled()
    })

    test('an MCP module is refused by the helper itself, resident or as a stub, with no export call', async () => {
        const resident = mcpBody('m1')
        const stub = { ...stubModule('m2'), mcp: true } as unknown as RisuModule
        installDb([resident, stub])
        await exportModuleRow(resident, 'charx')
        await exportModuleRow(stub, 'risum')
        expect(h.alertError).toHaveBeenCalledTimes(2)
        expect(h.alertError).toHaveBeenCalledWith(language.errors.mcpModuleConversionUnsupported)
        expect(h.exportModule).not.toHaveBeenCalled()
        expect(h.exportModuleLegacy).not.toHaveBeenCalled()
        expect(h.acquire).not.toHaveBeenCalled()
    })
})

describe('convertModuleRow', () => {
    test('pushes the converted character, checks the order once and returns the character', async () => {
        const row = mod('a', { name: 'Alpha' })
        const db = installDb([row])
        const made = await convertModuleRow(row)
        expect(made).toEqual({ chaId: 'made-a', name: 'Alpha' })
        expect(db.characters).toEqual([made])
        expect(db.characters[0]).toBe(made)
        expect(h.checkCharOrder).toHaveBeenCalledTimes(1)
    })

    test('a stub is acquired, converted as the acquired body and released once', async () => {
        const stub = stubModule('S1')
        const db = installDb([stub])
        h.acquire.mockResolvedValue({ module: mod('S1', { name: 'Loaded' }), release: h.release })
        const made = await convertModuleRow(stub)
        expect(made).toEqual({ chaId: 'made-S1', name: 'Loaded' })
        expect(db.characters).toHaveLength(1)
        expect(h.release).toHaveBeenCalledTimes(1)
    })

    test('an MCP module shows the message, pushes no character and still releases the stub', async () => {
        const stub = { ...stubModule('m2'), mcp: true } as unknown as RisuModule
        const db = installDb([stub, mcpBody('m1')])
        h.acquire.mockResolvedValue({ module: mcpBody('m2'), release: h.release })
        expect(await convertModuleRow(stub)).toBeNull()
        expect(await convertModuleRow(db.modules[1])).toBeNull()
        expect(h.alertError).toHaveBeenCalledTimes(2)
        expect(h.alertError).toHaveBeenCalledWith(language.errors.mcpModuleConversionUnsupported)
        expect(db.characters).toEqual([])
        expect(h.checkCharOrder).not.toHaveBeenCalled()
        expect(h.release).toHaveBeenCalledTimes(1)
    })

    test('a stub that cannot be loaded makes no character', async () => {
        const stub = stubModule('S1')
        const db = installDb([stub])
        h.acquire.mockResolvedValue(null)
        expect(await convertModuleRow(stub)).toBeNull()
        expect(db.characters).toEqual([])
    })
})
