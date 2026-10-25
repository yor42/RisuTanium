import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// The seam reads only DBState.db.modules; the real store module starts the page's effects.
vi.mock('../../../stores.svelte', () => ({ DBState: { db: undefined } }))

import {
    acquireModule, ModuleAcquireError, ModuleAmbiguousError, ModuleLoaderMissingError, registerModuleLoader, unregisterModuleLoader,
} from '../../store2/moduleAcquire'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE } from '../../moduleStub'
import { DBState } from '../../../stores.svelte'
import type { Database } from '../../database.svelte'
import type { RisuModule } from '../../../process/modules'

const full = (id: string, name = `Module ${id}`): RisuModule => ({ id, name, description: '' })
const stub = (id: string, name = `Stub ${id}`): RisuModule => ({ id, name, description: '', [MODULE_STUB_KEY]: MODULE_STUB_VALUE } as RisuModule)

function setModules(modules: RisuModule[]): void {
    DBState.db = { modules } as unknown as Database
}

let before: Database

beforeEach(() => {
    before = DBState.db
    unregisterModuleLoader()
})

afterEach(() => {
    unregisterModuleLoader()
    DBState.db = before
})

describe('acquireModule', () => {
    test('a resident module is the live slot, and the loader is not called', async () => {
        const loader = vi.fn()
        registerModuleLoader(loader)
        setModules([full('a'), full('b')])
        const slot = DBState.db.modules[1]
        const got = await acquireModule('b')
        expect(got).not.toBeNull()
        expect(got?.module).toBe(slot)
        expect(typeof got?.release).toBe('function')
        got?.release()
        expect(loader).not.toHaveBeenCalled()
    })

    test('the first holder of a duplicated resident id wins, and the loader is not called', async () => {
        const loader = vi.fn()
        registerModuleLoader(loader)
        setModules([full('d', 'first'), full('d', 'second')])
        const slot = DBState.db.modules[0]
        const got = await acquireModule('d')
        expect(got?.module).toBe(slot)
        expect(got?.module.name).toBe('first')
        expect(loader).not.toHaveBeenCalled()
    })

    test('an absent id resolves null and the loader is not called', async () => {
        const loader = vi.fn()
        registerModuleLoader(loader)
        setModules([full('a'), stub('s')])
        await expect(acquireModule('nope')).resolves.toBeNull()
        expect(loader).not.toHaveBeenCalled()
    })

    test('the list is read at call time', async () => {
        setModules([full('a')])
        await expect(acquireModule('late')).resolves.toBeNull()
        DBState.db.modules.push(full('late'))
        await expect(acquireModule('late')).resolves.not.toBeNull()
    })

    test('a stub with no loader rejects with ModuleLoaderMissingError naming the module', async () => {
        setModules([stub('s1', 'Stubby')])
        const error = await acquireModule('s1').then(() => null, (reason: unknown) => reason)
        expect(error).toBeInstanceOf(ModuleLoaderMissingError)
        expect(error).toBeInstanceOf(ModuleAcquireError)
        const named = error as ModuleAcquireError
        expect(named.moduleId).toBe('s1')
        expect(named.moduleName).toBe('Stubby')
        expect(named.message).toContain('Stubby')
        expect(named.message).toContain('s1')
    })

    test('a stub with a loader: the loader gets the handle and the signal, and its result is returned', async () => {
        setModules([full('a'), stub('s2')])
        const loaded = full('s2', 'Loaded')
        const loader = vi.fn(async () => loaded)
        registerModuleLoader(loader)
        const controller = new AbortController()
        const got = await acquireModule('s2', controller.signal)
        expect(loader).toHaveBeenCalledTimes(1)
        expect(loader).toHaveBeenCalledWith('s2#0', controller.signal)
        expect(got?.module).toBe(loaded)
    })

    test('a loader that returns null resolves null', async () => {
        setModules([stub('s3')])
        registerModuleLoader(async () => null)
        await expect(acquireModule('s3')).resolves.toBeNull()
    })

    test('a loader failure is a rejection', async () => {
        setModules([stub('s4')])
        registerModuleLoader(async () => { throw new Error('load failed') })
        await expect(acquireModule('s4')).rejects.toThrow('load failed')
    })

    test('a stub first match with another holder of the id rejects with ModuleAmbiguousError, without calling the loader', async () => {
        const loader = vi.fn()
        registerModuleLoader(loader)
        setModules([stub('x', 'Stub X'), full('x', 'Other X')])
        const error = await acquireModule('x').then(() => null, (reason: unknown) => reason)
        expect(error).toBeInstanceOf(ModuleAmbiguousError)
        expect(error).toBeInstanceOf(ModuleAcquireError)
        expect((error as ModuleAcquireError).moduleId).toBe('x')
        expect((error as ModuleAcquireError).moduleName).toBe('Stub X')
        expect((error as ModuleAcquireError).message).toContain('Stub X')
        expect(loader).not.toHaveBeenCalled()
    })

    test('a resident first match is returned even when a stub holds the same id later', async () => {
        const loader = vi.fn()
        registerModuleLoader(loader)
        setModules([full('y'), stub('y')])
        const slot = DBState.db.modules[0]
        const got = await acquireModule('y')
        expect(got?.module).toBe(slot)
        expect(loader).not.toHaveBeenCalled()
    })

    test('unregistering the loader restores the missing-loader rejection', async () => {
        setModules([stub('z')])
        registerModuleLoader(async () => full('z'))
        unregisterModuleLoader()
        await expect(acquireModule('z')).rejects.toBeInstanceOf(ModuleLoaderMissingError)
    })
})
