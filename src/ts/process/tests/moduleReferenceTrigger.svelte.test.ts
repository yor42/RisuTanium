/**
 * The reactive load trigger: the module effect in the real `stores.svelte.ts` starts the load of a referenced module
 * stub whenever the references of the selected origin change, once boot has finished. The real `stores.svelte`, the
 * real `process/modules` and the real `moduleEnsure` run together; the only double is the module loader, registered
 * through `registerModuleLoader`, which records its calls and replaces the slot the way the production loader does.
 *
 * The rows that drive the effect do not import any `moduleEnsure` symbol, so on a base without the trigger they fail
 * at an assertion (the loader is never called) instead of at import.
 * Labels: R = regression reproducer, G = guard (passes before and after).
 */
import { flushSync, tick } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ alerts: [] as string[] }))

vi.mock(import('src/ts/alert'), async () => {
    const { writable } = await import('svelte/store')
    return {
        alertError: vi.fn((msg: unknown) => { h.alerts.push(String(msg)) }),
        alertToast: vi.fn(),
        alertInput: vi.fn(async () => ''),
        alertNormal: vi.fn(),
        alertSelect: vi.fn(async () => ''),
        alertConfirm: vi.fn(async () => true),
        alertClear: vi.fn(),
        alertModuleSelect: vi.fn(async () => -1),
        alertStore: writable({ type: '', msg: '' }),
        alertWait: vi.fn(),
    } as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

import { DBState, loadedStore, selectedCharID } from 'src/ts/stores.svelte'
import { MODULE_STUB_KEY } from 'src/ts/storage/moduleStub'
import { ModuleLoadError, registerModuleLoader, unregisterModuleLoader } from 'src/ts/storage/store2/moduleAcquire'

type Plain = Record<string, unknown>

function stub(id: string, name: string, extra: Plain = {}): Plain {
    return { id, name, description: '', [MODULE_STUB_KEY]: 1, ...extra }
}

function character(chaId: string, modules: string[] = []): Plain {
    return { chaId, type: 'character', chatPage: 0, modules, chats: [{ id: `${chaId}-chat`, modules: [], message: [] }] }
}

function freshDb(modules: Plain[], enabled: string[], characters: Plain[] = [character('x')]): void {
    DBState.db = {
        modules, enabledModules: enabled, moduleIntergration: '', personas: [], characters,
    } as unknown as typeof DBState.db
}

function live(): { modules: Plain[], enabledModules: string[], moduleIntergration: string, characters: Plain[] } {
    return DBState.db as unknown as { modules: Plain[], enabledModules: string[], moduleIntergration: string, characters: Plain[] }
}

async function settle(): Promise<void> {
    flushSync()
    await tick()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    flushSync()
    await tick()
}

let calls: string[] = []

/** Records the call and installs a resident body in the slot the id names, as the production loader does. */
function installingLoader(options: { hold?: (id: string) => Promise<void> | null, fail?: (id: string) => Error | null } = {}) {
    registerModuleLoader(async (handle) => {
        const id = handle.slice(0, handle.lastIndexOf('#'))
        calls.push(id)
        const held = options.hold?.(id)
        if (held) {
            await held
        }
        const failure = options.fail?.(id)
        if (failure) {
            throw failure
        }
        const index = live().modules.findIndex((m) => m.id === id)
        live().modules[index] = { id, name: id, description: '', lorebook: [] }
        return live().modules[index] as never
    })
}

beforeEach(async () => {
    calls = []
    h.alerts.length = 0
    loadedStore.set(false)
    selectedCharID.set(0)
    freshDb([], [])
    await settle()
})

afterEach(() => {
    unregisterModuleLoader()
})

describe('a reference-adding write on the selected origin loads the stub', () => {
    type Write = { name: string, modules: () => Plain[], enabled: string[], write: () => void }
    const writes: Write[] = [
        { name: 'global toggle push', modules: () => [stub('b1', 'B1')], enabled: [], write: () => { live().enabledModules.push('b1') } },
        { name: 'chat list push', modules: () => [stub('b1', 'B1')], enabled: [], write: () => { (live().characters[0].chats as Plain[])[0].modules = ['b1'] } },
        { name: 'character list push', modules: () => [stub('b1', 'B1')], enabled: [], write: () => { (live().characters[0].modules as string[]).push('b1') } },
        { name: 'loadout enabledModules assignment', modules: () => [stub('b1', 'B1')], enabled: [], write: () => { live().enabledModules = ['b1'] } },
        { name: 'preset moduleIntergration assignment', modules: () => [stub('b1', 'B1')], enabled: [], write: () => { live().moduleIntergration = 'b1' } },
        { name: 'moduleIntergration by namespace', modules: () => [stub('b1', 'B1', { namespace: 'ns' })], enabled: [], write: () => { live().moduleIntergration = 'ns' } },
        { name: 'plugin-style list replacement', modules: () => [], enabled: ['b1'], write: () => { live().modules = [stub('b1', 'B1')] } },
    ]

    test.each(writes)('R reference-change-on-selected-origin-loads: $name', async ({ modules, enabled, write }) => {
        installingLoader()
        freshDb(modules(), enabled)
        loadedStore.set(true)
        await settle()
        expect(calls).toEqual([])
        write()
        await settle()
        expect(calls).toEqual(['b1'])
    })

    test('R restore-loads-chat-and-character-refs', async () => {
        installingLoader()
        loadedStore.set(true)
        freshDb([stub('b1', 'B1')], [], [character('x', ['b1'])])
        await settle()
        expect(calls).toEqual(['b1'])
    })

    test('R selected-character-switch-loads', async () => {
        installingLoader()
        freshDb([stub('b1', 'B1')], [], [character('x'), character('y', ['b1'])])
        loadedStore.set(true)
        await settle()
        expect(calls).toEqual([])
        selectedCharID.set(1)
        await settle()
        expect(calls).toEqual(['b1'])
    })
})

describe('failure memory', () => {
    test('R failed-stub-not-reread-on-unrelated-rerun', async () => {
        installingLoader({ fail: (id) => new ModuleLoadError('unreadable', id, id) })
        freshDb([stub('b2', 'B2')], ['b2'])
        loadedStore.set(true)
        await settle()
        expect(calls).toEqual(['b2'])
        live().characters[0].backgroundHTML = 'changed'
        await settle()
        expect(calls).toEqual(['b2'])
    })

    test('R failed-stub-not-realerted-on-integration-typing', async () => {
        installingLoader({ fail: (id) => new ModuleLoadError('unreadable', id, id) })
        freshDb([stub('b2', 'B2')], ['b2'])
        loadedStore.set(true)
        await settle()
        for (const typed of ['n', 'ns', 'nsX', 'nsX,', 'nsX,y']) {
            live().moduleIntergration = typed
            await settle()
        }
        expect(calls).toEqual(['b2'])
        expect(h.alerts).toHaveLength(1)
    })

    test('R failed-stub-retried-after-slot-replaced', async () => {
        installingLoader({ fail: (id) => new ModuleLoadError('unreadable', id, id) })
        freshDb([stub('b2', 'B2')], ['b2'])
        loadedStore.set(true)
        await settle()
        live().modules[0] = stub('b2', 'B2')
        await settle()
        expect(calls).toEqual(['b2', 'b2'])
        expect(h.alerts).toHaveLength(2)
    })

    test('R edited-failure-is-silent-in-trigger', async () => {
        installingLoader({ fail: (id) => new ModuleLoadError('edited', id, id) })
        freshDb([stub('b3', 'B3')], ['b3'])
        loadedStore.set(true)
        await settle()
        expect(calls).toEqual(['b3'])
        expect(h.alerts).toEqual([])
    })

    test('R edited-stub-is-not-re-requested-on-unrelated-rerun', async () => {
        installingLoader({ fail: (id) => new ModuleLoadError('edited', id, id) })
        freshDb([stub('b3', 'B3')], ['b3'])
        loadedStore.set(true)
        await settle()
        expect(calls).toEqual(['b3'])
        live().moduleIntergration = 'zz'
        await settle()
        expect(calls).toEqual(['b3'])
        expect(h.alerts).toEqual([])
    })

    test('R trigger-failure-alerts-once-naming-all', async () => {
        installingLoader({ fail: (id) => new ModuleLoadError('unreadable', id, id) })
        freshDb([stub('b4', 'Four'), stub('b5', 'Five')], ['b4', 'b5'])
        loadedStore.set(true)
        await settle()
        expect(h.alerts).toHaveLength(1)
        expect(h.alerts[0]).toContain('Four')
        expect(h.alerts[0]).toContain('Five')
    })
})

describe('loads in flight and termination', () => {
    test('R stub-loading-is-not-restarted', async () => {
        let release: () => void = () => {}
        installingLoader({ hold: () => new Promise<void>((resolve) => { release = resolve }) })
        freshDb([stub('c1', 'C1')], ['c1'])
        loadedStore.set(true)
        await settle()
        live().moduleIntergration = 'zz'
        await settle()
        expect(calls).toEqual(['c1'])
        release()
        await settle()
    })

    test('R rerun-during-held-load-does-not-start-queued-stub', async () => {
        let release: () => void = () => {}
        installingLoader({ hold: (id) => (id === 'c1' ? new Promise<void>((resolve) => { release = resolve }) : null) })
        freshDb([stub('c1', 'C1'), stub('c2', 'C2')], ['c1', 'c2'])
        loadedStore.set(true)
        await settle()
        expect(calls).toEqual(['c1'])
        live().moduleIntergration = 'zz'
        await settle()
        expect(calls).toEqual(['c1'])
        release()
        await settle()
        await settle()
        expect(calls).toEqual(['c1', 'c2'])
    })

    test('R trigger-terminates-after-install', async () => {
        installingLoader()
        freshDb([stub('c1', 'C1'), stub('c2', 'C2')], ['c1', 'c2'])
        loadedStore.set(true)
        await settle()
        await settle()
        live().moduleIntergration = 'zzz'
        await settle()
        expect(calls).toEqual(['c1', 'c2'])
    })

    test('R stub-fields-the-loader-reads-do-not-rerun-the-effect-during-a-load', async () => {
        let release: () => void = () => {}
        let effectRuns = 0
        registerModuleLoader(async (handle) => {
            const id = handle.slice(0, handle.lastIndexOf('#'))
            calls.push(id)
            // The synchronous part of the production loader reads the slot's name and every field of its stub.
            void JSON.stringify(live().modules.find((m) => m.id === id))
            await new Promise<void>((resolve) => { release = resolve })
            return null as never
        })
        const watched = character('x')
        Object.defineProperty(watched, 'backgroundHTML', { enumerable: true, configurable: true, get() { effectRuns++; return '' } })
        freshDb([stub('c1', 'C1')], ['c1'], [watched])
        loadedStore.set(true)
        await settle()
        expect(calls).toEqual(['c1'])
        const runsBeforeWrite = effectRuns
        expect(runsBeforeWrite).toBeGreaterThan(0)
        live().modules[0].description = 'written while loading'
        await settle()
        expect(effectRuns).toBe(runsBeforeWrite)
        release()
        await settle()
    })
})

describe('boot gate', () => {
    test('R trigger-inert-before-boot-loads-when-boot-ends', async () => {
        installingLoader()
        freshDb([stub('b1', 'B1')], ['b1'])
        await settle()
        freshDb([stub('b1', 'B1')], ['b1'])
        await settle()
        expect(calls).toEqual([])
        loadedStore.set(true)
        await settle()
        expect(calls).toEqual(['b1'])
    })
})
