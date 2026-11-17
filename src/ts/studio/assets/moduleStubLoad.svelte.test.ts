// @vitest-environment jsdom
// Loading a module that is not loaded when it is selected: the id is "loading" from the call, however the load ends it
// leaves the set, and nothing is thrown out of the call.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ModuleStubLoad } from 'src/ts/storage/store2/saveActive'

const loader = vi.hoisted(() => ({ load: vi.fn() }))

// The real loader is not spread in: evaluating it loads the app graph (the parser's top-level effect then throws in
// jsdom), and nothing under test reads any other export of it.
vi.mock('src/ts/process/moduleLoader', () => ({ loadModuleStubsOf: loader.load, loadModule: vi.fn() }))

import { isStudioModuleLoading, requestStudioModuleLoad, resetStudioModuleLoadsForTests } from './moduleStubLoad.svelte'

function pending(): { promise: Promise<ModuleStubLoad>, settle: (value: ModuleStubLoad) => void, fail: (error: Error) => void } {
    let settle: (value: ModuleStubLoad) => void = () => {}
    let fail: (error: Error) => void = () => {}
    const promise = new Promise<ModuleStubLoad>((resolve, reject) => {
        settle = resolve
        fail = reject
    })
    return { promise, settle, fail }
}

beforeEach(() => {
    loader.load.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    resetStudioModuleLoadsForTests()
    vi.restoreAllMocks()
})

describe('requesting the load of a module that is not loaded', () => {
    test('the id is loading at once, before anything is awaited, and leaves when the load is done', async () => {
        const held = pending()
        loader.load.mockReturnValue(held.promise)
        const done = requestStudioModuleLoad('A')
        expect(isStudioModuleLoading('A')).toBe(true)
        expect(isStudioModuleLoading('B')).toBe(false)
        await vi.dynamicImportSettled()
        expect(loader.load).toHaveBeenCalledWith('A')
        held.settle({ kind: 'loaded' })
        await done
        expect(isStudioModuleLoading('A')).toBe(false)
    })

    test('a refused load leaves the set too', async () => {
        loader.load.mockResolvedValue({ kind: 'refused' })
        await requestStudioModuleLoad('A')
        expect(isStudioModuleLoading('A')).toBe(false)
    })

    test('a load that defers stays loading until the person has answered', async () => {
        let answer: () => void = () => {}
        const settled = new Promise<void>((resolve) => { answer = resolve })
        loader.load.mockResolvedValue({ kind: 'deferred', settled })
        const done = requestStudioModuleLoad('A')
        await vi.dynamicImportSettled()
        for (let turn = 0; turn < 5; turn++) await Promise.resolve()
        expect(isStudioModuleLoading('A')).toBe(true)
        answer()
        await done
        expect(isStudioModuleLoading('A')).toBe(false)
    })

    test('a request for an id that is already loading does not call the loader again', async () => {
        const held = pending()
        loader.load.mockReturnValue(held.promise)
        const first = requestStudioModuleLoad('A')
        // The first request has reached the loader and waits on it before the second is made.
        await vi.dynamicImportSettled()
        expect(loader.load).toHaveBeenCalledTimes(1)
        const second = requestStudioModuleLoad('A')
        await vi.dynamicImportSettled()
        for (let turn = 0; turn < 5; turn++) await Promise.resolve()
        expect(loader.load).toHaveBeenCalledTimes(1)
        expect(isStudioModuleLoading('A')).toBe(true)
        held.settle({ kind: 'refused' })
        await Promise.all([first, second])
        expect(loader.load).toHaveBeenCalledTimes(1)
        expect(isStudioModuleLoading('A')).toBe(false)
    })

    test('a load that rejects leaves the set, is logged and throws nothing', async () => {
        const failure = new Error('read failed')
        loader.load.mockRejectedValue(failure)
        await expect(requestStudioModuleLoad('A')).resolves.toBeUndefined()
        expect(isStudioModuleLoading('A')).toBe(false)
        expect(console.error).toHaveBeenCalledWith(failure)
    })

    test('a null id is never loading', () => {
        expect(isStudioModuleLoading(null)).toBe(false)
    })

    test('a loader module that cannot be imported leaves the set, is logged and throws nothing', async () => {
        vi.resetModules()
        vi.doMock('src/ts/process/moduleLoader', () => { throw new Error('chunk did not load') })
        try {
            const fresh = await import('./moduleStubLoad.svelte')
            await expect(fresh.requestStudioModuleLoad('A')).resolves.toBeUndefined()
            expect(fresh.isStudioModuleLoading('A')).toBe(false)
            expect(console.error).toHaveBeenCalled()
        } finally {
            vi.doUnmock('src/ts/process/moduleLoader')
        }
    })
})
