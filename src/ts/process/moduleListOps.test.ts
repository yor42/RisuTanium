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
    alertConfirm: vi.fn(),
    acquire: vi.fn(),
    release: vi.fn(),
    exportModule: vi.fn(),
    exportModuleLegacy: vi.fn(),
    refreshModules: vi.fn(),
    checkCharOrder: vi.fn(),
    db: { current: null as unknown },
}))

vi.mock('uuid', () => ({ v4: () => 'new-id' }))
vi.mock('src/ts/alert', () => ({ alertError: h.alertError, alertConfirm: h.alertConfirm }))
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
// moduleListOf selects over the same plain database; the run context holds no chat, character or persona.
vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: () => h.db.current, getCurrentChat: () => null, getCurrentCharacter: () => null }))
vi.mock('src/ts/util', () => ({ checkPersonaBinded: () => null }))
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
    convertModuleRow, createModule, exportModuleRow, giveModuleCopyOwnId, moduleCopyIdState, moduleIntegrationState, removeModuleRow, setModuleGlobal,
} from 'src/ts/process/moduleListOps'
import { moduleListOf } from 'src/ts/process/moduleRefList'

type Db = { modules: RisuModule[], enabledModules: string[], moduleIntergration: string, characters: unknown[] }

function installDb(modules: RisuModule[], enabled: string[] = [], integration = ''): Db {
    const db: Db = { modules, enabledModules: enabled, moduleIntergration: integration, characters: [] }
    h.db.current = db
    return db
}

const mod = (id: string, over: Partial<RisuModule> = {}): RisuModule => residentModule(id, over)
const mcpBody = (id: string): RisuModule => ({ ...mod(id), mcp: { url: 'internal:dice' } })

beforeEach(() => {
    for (const fn of [h.alertError, h.alertConfirm, h.acquire, h.release, h.exportModule, h.exportModuleLegacy, h.refreshModules, h.checkCharOrder]) fn.mockReset()
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

describe('moduleCopyIdState', () => {
    test('a later holder of a shared id is ok; the first holder, a unique row, a stub and a removed row are not', () => {
        const first = mod('X')
        const later = mod('X')
        const unique = mod('U')
        const stub = stubModule('S')
        const modules = [first, later, unique, stub, mod('S2')]
        expect(moduleCopyIdState(modules, later)).toBe('ok')
        expect(moduleCopyIdState(modules, first)).toBe('first-holder')
        expect(moduleCopyIdState(modules, unique)).toBe('not-shared')
        expect(moduleCopyIdState(modules, stub)).toBe('stub')
        expect(moduleCopyIdState(modules, mod('X'))).toBe('gone')
    })

    test('a stub that shares its id is a stub, whichever holder it is', () => {
        const resident = mod('X')
        const stub = stubModule('X')
        expect(moduleCopyIdState([resident, stub], stub)).toBe('stub')
    })
})

describe('giveModuleCopyOwnId: the later copy gets a fresh id and nothing else changes', () => {
    const rich = (id: string, tag: string, over: Partial<RisuModule> = {}): RisuModule => ({
        ...mod(id, { name: `Module ${tag}`, description: `about ${tag}` }),
        lorebook: [{ key: tag, secondkey: '', insertorder: 1, comment: tag, content: tag, mode: 'normal', alwaysActive: false, selective: false }],
        assets: [[`asset-${tag}`, `assets/${tag}.png`, 'png']],
        risutanium_asset_retained: [[`kept-${tag}`, `assets/${tag}-kept.png`]],
        ...over,
    }) as unknown as RisuModule

    function world() {
        const a = rich('X', 'a')
        const b = rich('X', 'b', { namespace: 'ns' })
        const c = rich('X', 'c')
        const db = installDb([a, b, c], ['X'], 'ns')
        return { a, b, c, db, before: JSON.parse(JSON.stringify(b)) as unknown }
    }

    // Guard (the helper is new; the mutants below fail it): only the id of the clicked row changes.
    test('T5: the clicked later copy is replaced by a shallow copy with only its id different; every other row keeps identity and every reference is untouched', () => {
        const { a, b, c, db, before } = world()
        const made = giveModuleCopyOwnId(b, () => 'Y')
        expect(made).not.toBeNull()
        expect(made).toBe(db.modules[1])
        expect(made).not.toBe(b)
        expect(made!.id).toBe('Y')
        expect(JSON.parse(JSON.stringify({ ...made, id: 'X' }))).toEqual(before)
        expect(b.id).toBe('X')
        expect(db.modules).toHaveLength(3)
        expect(db.modules[0]).toBe(a)
        expect(db.modules[2]).toBe(c)
        expect(a.id).toBe('X')
        expect(c.id).toBe('X')
        expect(db.enabledModules).toEqual(['X'])
        expect(db.moduleIntergration).toBe('ns')
        expect(h.refreshModules).toHaveBeenCalledTimes(1)
        expect(h.acquire).not.toHaveBeenCalled()
    })

    test('T5: the first holder keeps its id and its place when a later copy is re-identified', () => {
        const { a, db } = world()
        giveModuleCopyOwnId(db.modules[2], () => 'Y')
        expect(db.modules.map((row) => row.id)).toEqual(['X', 'X', 'Y'])
        expect(db.modules[0]).toBe(a)
    })

    test('T5: the default mint is the v4 id of the uuid package (mocked to a fixed value here)', () => {
        const { b } = world()
        expect(giveModuleCopyOwnId(b)!.id).toBe('new-id')
    })

    describe('T6: each refusal writes nothing, refreshes nothing and acquires nothing', () => {
        function expectRefusedUntouched(db: Db, row: RisuModule, mint: () => string = () => 'Y'): void {
            const snapshot = JSON.stringify(db.modules)
            const identities = [...db.modules]
            expect(giveModuleCopyOwnId(row, mint)).toBeNull()
            expect(JSON.stringify(db.modules)).toBe(snapshot)
            expect(db.modules.every((entry, index) => entry === identities[index])).toBe(true)
            expect(h.refreshModules).not.toHaveBeenCalled()
            expect(h.acquire).not.toHaveBeenCalled()
        }

        test('the first holder keeps its id', () => {
            const { a, db } = world()
            expectRefusedUntouched(db, a)
        })

        test('a row that is not shared has nothing to give up', () => {
            const only = mod('U')
            const db = installDb([mod('X'), only])
            expectRefusedUntouched(db, only)
        })

        test('a stub that shares its id is never acquired or renamed', () => {
            const stub = stubModule('X')
            const db = installDb([mod('X'), stub])
            expectRefusedUntouched(db, stub)
        })

        test('a row that left the list, or was replaced since the click, is gone', () => {
            const { b, db } = world()
            db.modules.splice(1, 1)
            expectRefusedUntouched(db, b)
            const replaced = mod('X')
            const later = installDb([mod('X'), replaced])
            const stale = { ...replaced }
            expectRefusedUntouched(later, stale)
        })

        test('a minted id that any row already holds is refused', () => {
            const { b, db } = world()
            db.modules.push(rich('Q', 'q'))
            expectRefusedUntouched(db, b, () => 'Q')
            expectRefusedUntouched(db, b, () => 'X')
        })
    })

    describe('T13: which row a run uses before and after the re-id', () => {
        // Guard: the runtime rule (filter by id or namespace, then first holder per id) is the existing one.
        test('(a) a run that references X by id uses the first holder before and after', () => {
            const { a, b, db } = world()
            expect(moduleListOf(db.enabledModules)).toEqual([a])
            const made = giveModuleCopyOwnId(b, () => 'Y')
            expect(moduleListOf(db.enabledModules)).toEqual([a])
            expect(db.enabledModules).toEqual(['X'])
            expect(moduleListOf(['X'])).not.toContain(made)
        })

        test('(b) a run that references only the copy\'s namespace uses the copy before (as X) and after (as Y)', () => {
            const first = mod('X')
            const copy = mod('X', { namespace: 'n' })
            const db = installDb([first, copy])
            expect(moduleListOf(['n'])).toEqual([copy])
            const made = giveModuleCopyOwnId(copy, () => 'Y')!
            expect(moduleListOf(['n'])).toEqual([made])
            expect(moduleListOf(['n'])[0].id).toBe('Y')
            expect(db.modules[0]).toBe(first)
        })

        test('(c) a namespace both rows match drops the copy before the re-id and lists both after it', () => {
            const first = mod('X', { namespace: 'n' })
            const copy = mod('X', { namespace: 'n' })
            installDb([first, copy])
            expect(moduleListOf(['n'])).toEqual([first])
            const made = giveModuleCopyOwnId(copy, () => 'Y')!
            expect(moduleListOf(['n'])).toEqual([first, made])
        })
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

describe('T9-CONVERT (unit, L3): the low-level ask', () => {
    const flagOnes: [string, boolean | number][] = [['true', true], ['a truthy foreign 1', 1]]

    test.each(flagOnes)('a resident module with lowLevelAccess %s asks with its name; Yes pushes a character with the flag on', async (_label, flag) => {
        const row = mod('a', { name: 'Alpha', lowLevelAccess: flag as boolean })
        const db = installDb([row])
        h.alertConfirm.mockResolvedValue(true)
        const made = await convertModuleRow(row)
        expect(h.alertConfirm).toHaveBeenCalledTimes(1)
        expect(h.alertConfirm).toHaveBeenCalledWith(language.studioModuleListConvertLowLevel('Alpha'))
        expect(made).toEqual({ chaId: 'made-a', name: 'Alpha' })
        expect(db.characters).toHaveLength(1)
        expect(h.checkCharOrder).toHaveBeenCalledTimes(1)
    })

    test('Cancel makes no character, checks no order and still releases the acquired stub', async () => {
        const stub = stubModule('S1')
        const db = installDb([stub])
        h.acquire.mockResolvedValue({ module: mod('S1', { name: 'Loaded', lowLevelAccess: true }), release: h.release })
        h.alertConfirm.mockResolvedValue(false)
        expect(await convertModuleRow(stub)).toBeNull()
        expect(h.alertConfirm).toHaveBeenCalledTimes(1)
        expect(db.characters).toEqual([])
        expect(h.checkCharOrder).not.toHaveBeenCalled()
        expect(h.release).toHaveBeenCalledTimes(1)
    })

    test('stub case: the stub shows no flag, the acquired body holds 1, and the ask reads the body after the acquire', async () => {
        const stub = stubModule('S1')
        expect((stub as { lowLevelAccess?: unknown }).lowLevelAccess).toBeFalsy()
        const db = installDb([stub])
        h.acquire.mockResolvedValue({ module: mod('S1', { name: 'Loaded', lowLevelAccess: 1 as unknown as boolean }), release: h.release })
        h.alertConfirm.mockResolvedValue(true)
        expect(await convertModuleRow(stub)).toEqual({ chaId: 'made-S1', name: 'Loaded' })
        expect(h.alertConfirm).toHaveBeenCalledWith(language.studioModuleListConvertLowLevel('Loaded'))
        expect(db.characters).toHaveLength(1)
    })

    test.each([['off', false], ['absent', undefined]])('a module with the flag %s never asks', async (_label, flag) => {
        const row = mod('a', { lowLevelAccess: flag })
        installDb([row])
        expect(await convertModuleRow(row)).not.toBeNull()
        expect(h.alertConfirm).not.toHaveBeenCalled()
    })
})
