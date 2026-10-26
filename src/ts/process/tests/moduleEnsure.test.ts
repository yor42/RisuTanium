/**
 * `ensureModulesForOrigin`, `ensureModulesOrAlert` and `ensureSelectedModules` (`../moduleEnsure.ts`) on the real
 * `moduleRefList.ts`, the real `moduleAcquire.ts` and the real run subject, with a loader double registered through
 * `registerModuleLoader` that replaces the slot the way the production loader does. The database is a plain object;
 * nothing here needs reactivity (the reactive trigger is driven in `moduleReferenceTrigger.svelte.test.ts`).
 *
 * Labels: every row is M. The symbols are new, so on the base the file fails at import; the evidence is a named mutant.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { MODULE_STUB_KEY } from '../../storage/moduleStub'

//#region module mocks

const h = vi.hoisted(() => ({
    state: { db: {} as Record<string, unknown> },
    alerts: [] as string[],
    waits: 0,
    persona: false as false | { embeddedModule?: { id: string } },
    breakDatabase: false,
}))

vi.mock(import('../../stores.svelte'), () => ({
    DBState: h.state,
    selectedCharID: writable(0),
}) as unknown as typeof import('../../stores.svelte'))

vi.mock(import('../../alert'), () => ({
    alertError: vi.fn((msg: string) => { h.alerts.push(msg) }),
    alertWait: vi.fn(() => { h.waits++ }),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../util'), () => ({
    checkPersonaBinded: vi.fn(() => h.persona),
}) as unknown as typeof import('../../util'))

vi.mock(import('../../storage/database.svelte'), () => {
    const getDatabase = () => {
        if (h.breakDatabase) {
            throw new Error('database unavailable')
        }
        return h.state.db
    }
    const getCurrentCharacter = () => (h.state.db.characters as unknown[])?.[0]
    const getCurrentChat = () => {
        const char = getCurrentCharacter() as { chats?: unknown[], chatPage?: number } | undefined
        return char?.chats?.[char.chatPage ?? 0]
    }
    return { getDatabase, getCurrentCharacter, getCurrentChat } as unknown as typeof import('../../storage/database.svelte')
})

//#endregion

import {
    ensureModulesForOrigin, ensureModulesOrAlert, ensureSelectedModules, ModuleEnsureError,
} from '../moduleEnsure'
import { hasModuleStubs } from '../moduleRefList'
import { ModuleLoadError, registerModuleLoader, unregisterModuleLoader } from '../../storage/store2/moduleAcquire'

type Plain = Record<string, unknown>

const ORIGIN = { chaId: 'a', chatId: 'cA' }
let calls: string[] = []

function stub(id: string, name: string, extra: Plain = {}): Plain {
    return { id, name, description: '', [MODULE_STUB_KEY]: 1, ...extra }
}

function resident(id: string, name: string): Plain {
    return { id, name, description: '', lorebook: [] }
}

function installDb(modules: Plain[], over: { enabled?: string[], integration?: string, chatModules?: string[], charModules?: string[] } = {}) {
    h.state.db = {
        characters: [{
            chaId: 'a', type: 'character', chatPage: 0, modules: over.charModules ?? [],
            chats: [{ id: 'cA', modules: over.chatModules ?? [], message: [] }],
        }],
        modules, enabledModules: over.enabled ?? [], moduleIntergration: over.integration ?? '', personas: [],
    }
}

function slots(): Plain[] {
    return h.state.db.modules as Plain[]
}

/** The loader double: records the handle, then replaces the slot with a resident body like the production loader. */
function registerInstallingLoader(options: { fail?: (id: string) => Error | null, hold?: (id: string) => Promise<void> | null } = {}) {
    registerModuleLoader(async (handle, signal) => {
        const id = handle.slice(0, handle.lastIndexOf('#'))
        calls.push(id)
        const held = options.hold?.(id)
        if (held) {
            await held
        }
        if (signal?.aborted) {
            throw signal.reason
        }
        const failure = options.fail?.(id)
        if (failure) {
            throw failure
        }
        const index = slots().findIndex((m) => m.id === id)
        slots()[index] = { id, name: id, description: '', lorebook: [] }
        return slots()[index] as never
    })
}

async function settleTasks() {
    for (let i = 0; i < 4; i++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
}

beforeEach(() => {
    calls = []
    h.alerts.length = 0
    h.waits = 0
    h.persona = false
    h.breakDatabase = false
})

afterEach(() => {
    unregisterModuleLoader()
})

describe('ensureModulesForOrigin', () => {
    test('M ensure-loads-namespace-reference', async () => {
        installDb([stub('m1', 'Alpha', { namespace: 'ns' })], { integration: 'ns' })
        registerInstallingLoader()
        await ensureModulesForOrigin(ORIGIN)
        expect(calls).toEqual(['m1'])
        expect(hasModuleStubs()).toBe(false)
    })

    test('M ensure-loads-chat-character-persona-refs', async () => {
        installDb(
            [stub('c1', 'Chat'), stub('c2', 'Char'), stub('c3', 'Persona'), stub('c4', 'Unreferenced')],
            { chatModules: ['c1'], charModules: ['c2'] },
        )
        h.persona = { embeddedModule: { id: 'c3' } }
        registerInstallingLoader()
        await ensureModulesForOrigin(ORIGIN)
        expect(calls.sort()).toEqual(['c1', 'c2', 'c3'])
        expect(slots().filter((m) => m[MODULE_STUB_KEY] === 1).map((m) => m.id)).toEqual(['c4'])
    })

    test('M ensure-reads-the-given-origin-not-the-selection', async () => {
        installDb([stub('m1', 'Alpha')])
        ;(h.state.db.characters as Plain[]).push({
            chaId: 'b', type: 'character', chatPage: 0, modules: ['m1'],
            chats: [{ id: 'cB', modules: [], message: [] }],
        })
        registerInstallingLoader()
        await ensureModulesForOrigin({ chaId: 'b', chatId: 'cB' })
        expect(calls).toEqual(['m1'])
    })

    test('M ensure-with-a-hint-resolves-a-duplicated-id-to-the-hinted-holder', async () => {
        installDb([stub('m1', 'Alpha')], { charModules: ['m1'] })
        const characters = h.state.db.characters as Plain[]
        const hinted = characters[0]
        characters.push({ ...hinted, modules: [], chats: [{ id: 'cTwin', modules: [], message: [] }] })
        registerInstallingLoader()
        await ensureModulesForOrigin(ORIGIN, undefined, { owner: hinted as never, chat: (hinted.chats as never[])[0] })
        expect(calls).toEqual(['m1'])
    })

    test('M ensure-failure-names-every-module', async () => {
        installDb([stub('m1', 'Alpha'), stub('m2', 'Beta')], { enabled: ['m1', 'm2'] })
        registerInstallingLoader({ fail: (id) => new ModuleLoadError('unreadable', id, id) })
        const error = await ensureModulesForOrigin(ORIGIN).then(() => null, (e: unknown) => e)
        expect(error).toBeInstanceOf(ModuleEnsureError)
        expect((error as ModuleEnsureError).names).toEqual(['Alpha', 'Beta'])
        expect(calls).toEqual(['m1', 'm2'])
    })

    test('M ensure-aborted-rethrows-silently', async () => {
        installDb([stub('m1', 'Alpha')], { enabled: ['m1'] })
        const controller = new AbortController()
        let release: () => void = () => {}
        registerInstallingLoader({ hold: () => new Promise<void>((resolve) => { release = resolve }) })
        const pending = ensureModulesOrAlert(ORIGIN, controller.signal)
        await settleTasks()
        controller.abort()
        release()
        await expect(pending).resolves.toBe(false)
        expect(h.alerts).toEqual([])
    })

    test('M ensure-uses-first-holder-dedupe', async () => {
        installDb([resident('m1', 'Alpha'), stub('m1', 'AlphaStub')], { enabled: ['m1'] })
        registerInstallingLoader()
        await ensureModulesForOrigin(ORIGIN)
        expect(calls).toEqual([])
    })

    test('M ensure-stub-first-resident-second-names-ambiguous', async () => {
        installDb([stub('m1', 'AlphaStub'), resident('m1', 'Alpha')], { enabled: ['m1'] })
        registerInstallingLoader()
        const error = await ensureModulesForOrigin(ORIGIN).then(() => null, (e: unknown) => e)
        expect(error).toBeInstanceOf(ModuleEnsureError)
        expect((error as ModuleEnsureError).names).toEqual(['AlphaStub'])
        expect(calls).toEqual([])
    })

    test('M ensure-no-stub-no-await', async () => {
        installDb([resident('m1', 'Alpha')], { enabled: ['m1'] })
        registerInstallingLoader()
        expect(hasModuleStubs()).toBe(false)
        await ensureModulesForOrigin(ORIGIN)
        expect(calls).toEqual([])
    })

    test('M ensure-holds-no-closeless-cover', async () => {
        installDb([stub('m1', 'Alpha')], { enabled: ['m1'] })
        let release: () => void = () => {}
        registerInstallingLoader({ hold: () => new Promise<void>((resolve) => { release = resolve }) })
        const pending = ensureModulesForOrigin(ORIGIN)
        await settleTasks()
        expect(h.waits).toBe(0)
        release()
        await pending
        expect(h.waits).toBe(0)
    })
})

describe('ensureModulesOrAlert', () => {
    test('M ensure-or-alert-shows-one-alert-for-several-failures', async () => {
        installDb([stub('m1', 'Alpha'), stub('m2', 'Beta')], { enabled: ['m1', 'm2'] })
        registerInstallingLoader({ fail: (id) => new ModuleLoadError('unreadable', id, id) })
        await expect(ensureModulesOrAlert(ORIGIN)).resolves.toBe(false)
        expect(h.alerts).toHaveLength(1)
        expect(h.alerts[0]).toContain('Alpha')
        expect(h.alerts[0]).toContain('Beta')
    })

    test('M ensure-or-alert-true-when-everything-loads', async () => {
        installDb([stub('m1', 'Alpha')], { enabled: ['m1'] })
        registerInstallingLoader()
        await expect(ensureModulesOrAlert(ORIGIN)).resolves.toBe(true)
        expect(h.alerts).toEqual([])
    })

    test('M ensure-retries-a-module-the-trigger-remembers-as-failed', async () => {
        installDb([stub('m1', 'Alpha')], { enabled: ['m1'] })
        let failing = true
        registerInstallingLoader({ fail: (id) => (failing ? new ModuleLoadError('unreadable', id, id) : null) })
        ensureSelectedModules(true)
        await settleTasks()
        expect(calls).toEqual(['m1'])
        failing = false
        await expect(ensureModulesOrAlert(ORIGIN)).resolves.toBe(true)
        expect(calls).toEqual(['m1', 'm1'])
        expect(hasModuleStubs()).toBe(false)
    })
})

describe('ensureSelectedModules', () => {
    test('M trigger-inert-until-ready', async () => {
        installDb([stub('m1', 'Alpha')], { enabled: ['m1'] })
        registerInstallingLoader()
        ensureSelectedModules(false)
        await settleTasks()
        expect(calls).toEqual([])
    })

    test('M trigger-failure-memory-keeps-a-failed-stub-from-restarting', async () => {
        installDb([stub('m1', 'Alpha')], { enabled: ['m1'] })
        registerInstallingLoader({ fail: (id) => new ModuleLoadError('unreadable', id, id) })
        ensureSelectedModules(true)
        await settleTasks()
        ensureSelectedModules(true)
        await settleTasks()
        expect(calls).toEqual(['m1'])
        expect(h.alerts).toHaveLength(1)
    })

    test('M trigger-replaced-slot-is-retried', async () => {
        installDb([stub('m1', 'Alpha')], { enabled: ['m1'] })
        registerInstallingLoader({ fail: (id) => new ModuleLoadError('unreadable', id, id) })
        ensureSelectedModules(true)
        await settleTasks()
        slots()[0] = stub('m1', 'Alpha')
        ensureSelectedModules(true)
        await settleTasks()
        expect(calls).toEqual(['m1', 'm1'])
        expect(h.alerts).toHaveLength(2)
    })

    test('M trigger-edited-failure-is-silent', async () => {
        installDb([stub('m1', 'Alpha')], { enabled: ['m1'] })
        registerInstallingLoader({ fail: (id) => new ModuleLoadError('edited', id, id) })
        ensureSelectedModules(true)
        await settleTasks()
        expect(calls).toEqual(['m1'])
        expect(h.alerts).toEqual([])
    })

    test('M trigger-failure-alerts-once-naming-all', async () => {
        installDb([stub('m1', 'Alpha'), stub('m2', 'Beta')], { enabled: ['m1', 'm2'] })
        registerInstallingLoader({ fail: (id) => new ModuleLoadError('unreadable', id, id) })
        ensureSelectedModules(true)
        await settleTasks()
        expect(h.alerts).toHaveLength(1)
        expect(h.alerts[0]).toContain('Alpha')
        expect(h.alerts[0]).toContain('Beta')
    })

    test('M rerun-during-held-load-does-not-start-queued-stub', async () => {
        installDb([stub('m1', 'Alpha'), stub('m2', 'Beta')], { enabled: ['m1', 'm2'] })
        let release: () => void = () => {}
        registerInstallingLoader({ hold: (id) => (id === 'm1' ? new Promise<void>((resolve) => { release = resolve }) : null) })
        ensureSelectedModules(true)
        await settleTasks()
        expect(calls).toEqual(['m1'])
        ensureSelectedModules(true)
        await settleTasks()
        expect(calls).toEqual(['m1'])
        release()
        await settleTasks()
        expect(calls).toEqual(['m1', 'm2'])
    })

    test('M trigger-throws-once-is-contained', async () => {
        installDb([stub('m1', 'Alpha')], { enabled: ['m1'] })
        registerInstallingLoader()
        h.breakDatabase = true
        expect(() => ensureSelectedModules(true)).not.toThrow()
        h.breakDatabase = false
        ensureSelectedModules(true)
        await settleTasks()
        expect(calls).toEqual(['m1'])
    })

    test('M trigger-terminates-after-install', async () => {
        installDb([stub('m1', 'Alpha')], { enabled: ['m1'] })
        registerInstallingLoader()
        ensureSelectedModules(true)
        await settleTasks()
        ensureSelectedModules(true)
        await settleTasks()
        expect(calls).toEqual(['m1'])
        expect(hasModuleStubs()).toBe(false)
    })
})
