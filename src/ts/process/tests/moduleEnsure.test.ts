/**
 * `ensureModulesForOrigin`, `ensureModulesOrAlert`, `ensureSelectedModules`, `ensureCurrentModules` and
 * `ensureCurrentModulesOrAlert` (`../moduleEnsure.ts`) on the real
 * `moduleRefList.ts`, the real `moduleAcquire.ts` and the real run subject, with a loader double registered through
 * `registerModuleLoader` that replaces the slot the way the production loader does. The database is a plain object;
 * nothing here needs reactivity (the reactive trigger is driven in `moduleReferenceTrigger.svelte.test.ts`).
 *
 * Labels: every row is M except the G rows (`current-resolves-true-...`, `trigger-after-a-normal-boot-...` and the
 * type-level memory/signal guard), which
 * pass on any correct implementation. The symbols are new, so on the base the file fails at import; the evidence of an
 * M row is a named mutant.
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
    createModuleFailureMemory, ensureCurrentModules, ensureCurrentModulesOrAlert, ensureModulesForOrigin,
    ensureModulesOrAlert, ensureSelectedModules, ModuleEnsureError,
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

    test('G trigger-after-a-normal-boot-starts-no-load-and-raises-no-alert', async () => {
        // A normal boot: nothing selected, the globally referenced modules resident, the unreferenced ones stubs.
        installDb([resident('m1', 'Alpha'), stub('m2', 'Beta'), stub('m3', 'Gamma')], { enabled: ['m1'] })
        h.state.db.characters = []
        registerInstallingLoader()
        const alertsBefore = [...h.alerts]
        ensureSelectedModules(true)
        await settleTasks()
        expect(calls).toEqual([])
        expect(h.alerts).toEqual(alertsBefore)
        expect(slots().filter((m) => m[MODULE_STUB_KEY] === 1).map((m) => m.id)).toEqual(['m2', 'm3'])
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

function failingLoader() {
    return (id: string) => new ModuleLoadError('unreadable', id, id)
}

/** Holds each id's load until `release(id)`; the held load then fails or installs as `fail` decides. */
function registerGatedLoader(fail: (id: string) => Error | null) {
    const gates = new Map<string, () => void>()
    registerInstallingLoader({
        fail,
        hold: (id) => new Promise<void>((resolve) => { gates.set(id, resolve) }),
    })
    return (id: string) => { gates.get(id)?.() }
}

describe('ensureCurrentModules', () => {
    test('M current-loads-the-stubs-the-current-chat-references', async () => {
        installDb([stub('m1', 'Alpha'), stub('m2', 'Beta')], { chatModules: ['m1'] })
        registerInstallingLoader()
        await expect(ensureCurrentModules()).resolves.toBe(true)
        expect(calls).toEqual(['m1'])
        expect(slots().filter((m) => m[MODULE_STUB_KEY] === 1).map((m) => m.id)).toEqual(['m2'])
    })

    test('M current-passes-the-owner-and-chat-hint-so-a-duplicated-id-names-the-current-holder', async () => {
        installDb([stub('m1', 'Alpha')], { charModules: ['m1'] })
        const characters = h.state.db.characters as Plain[]
        characters.push({ ...characters[0], modules: [], chats: [{ id: 'cTwin', modules: [], message: [] }] })
        registerInstallingLoader()
        await expect(ensureCurrentModules()).resolves.toBe(true)
        expect(calls).toEqual(['m1'])
    })

    test('M current-failure-shows-one-alert-naming-every-module-and-returns-false', async () => {
        installDb([stub('m1', 'Alpha'), stub('m2', 'Beta')], { enabled: ['m1', 'm2'] })
        registerInstallingLoader({ fail: failingLoader() })
        await expect(ensureCurrentModules()).resolves.toBe(false)
        expect(h.alerts).toHaveLength(1)
        expect(h.alerts[0]).toContain('Alpha')
        expect(h.alerts[0]).toContain('Beta')
    })

    test('M current-alert-false-fails-silently', async () => {
        installDb([stub('m1', 'Alpha')], { enabled: ['m1'] })
        registerInstallingLoader({ fail: failingLoader() })
        await expect(ensureCurrentModules({ alert: false })).resolves.toBe(false)
        expect(h.alerts).toEqual([])
    })

    test('M current-abort-returns-false-silently', async () => {
        installDb([stub('m1', 'Alpha')], { enabled: ['m1'] })
        const controller = new AbortController()
        let release: () => void = () => {}
        registerInstallingLoader({ hold: () => new Promise<void>((resolve) => { release = resolve }) })
        const pending = ensureCurrentModules({ signal: controller.signal })
        await settleTasks()
        controller.abort()
        release()
        await expect(pending).resolves.toBe(false)
        expect(h.alerts).toEqual([])
    })

    test('M current-or-alert-forwards-the-signal-and-alerts-on-failure', async () => {
        installDb([stub('m1', 'Alpha')], { enabled: ['m1'] })
        registerInstallingLoader({ fail: failingLoader() })
        await expect(ensureCurrentModulesOrAlert()).resolves.toBe(false)
        expect(h.alerts).toHaveLength(1)
    })

    test('G current-resolves-true-without-loading-for-no-stubs-a-group-owner-or-no-selection', async () => {
        installDb([resident('m1', 'Alpha')], { enabled: ['m1'] })
        registerInstallingLoader({ fail: failingLoader() })
        await expect(ensureCurrentModules()).resolves.toBe(true)

        installDb([stub('m1', 'Alpha')], { enabled: ['m1'] })
        ;(h.state.db.characters as Plain[])[0].type = 'group'
        await expect(ensureCurrentModules()).resolves.toBe(true)

        h.state.db.characters = []
        await expect(ensureCurrentModules()).resolves.toBe(true)
        expect(calls).toEqual([])
        expect(h.alerts).toEqual([])
    })
})

describe('ensureCurrentModules with a failure memory', () => {
    test('G memory-and-signal-or-alert-together-do-not-compile', async () => {
        // The guard is the type check: with the directives unused (a union that accepts both) pnpm check fails.
        installDb([resident('m1', 'Alpha')], { enabled: ['m1'] })
        const memory = createModuleFailureMemory()
        // @ts-expect-error a memory and a signal cannot be combined
        await expect(ensureCurrentModules({ memory, signal: new AbortController().signal })).resolves.toBe(true)
        // @ts-expect-error a memory and an alert switch cannot be combined
        await expect(ensureCurrentModules({ memory, alert: false })).resolves.toBe(true)
        expect(calls).toEqual([])
    })

    test('M memory-second-check-stops-with-no-load-attempt-and-no-alert', async () => {
        installDb([stub('m1', 'Alpha')], { enabled: ['m1'] })
        registerInstallingLoader({ fail: failingLoader() })
        const memory = createModuleFailureMemory()
        await expect(ensureCurrentModules({ memory })).resolves.toBe(false)
        await expect(ensureCurrentModules({ memory })).resolves.toBe(false)
        expect(calls).toEqual(['m1'])
        expect(h.alerts).toHaveLength(1)
    })

    test('M memory-chat-change-attempts-and-alerts-again', async () => {
        installDb([stub('m1', 'Alpha')], { enabled: ['m1'] })
        ;((h.state.db.characters as Plain[])[0].chats as Plain[]).push({ id: 'cB', modules: [], message: [] })
        registerInstallingLoader({ fail: failingLoader() })
        const memory = createModuleFailureMemory()
        await ensureCurrentModules({ memory })
        ;(h.state.db.characters as Plain[])[0].chatPage = 1
        await expect(ensureCurrentModules({ memory })).resolves.toBe(false)
        expect(calls).toEqual(['m1', 'm1'])
        expect(h.alerts).toHaveLength(2)
        expect(memory.key).toBe('a:cB')
    })

    test('M memory-a-slot-replaced-by-a-loaded-body-proceeds', async () => {
        installDb([stub('m1', 'Alpha')], { enabled: ['m1'] })
        registerInstallingLoader({ fail: failingLoader() })
        const memory = createModuleFailureMemory()
        await ensureCurrentModules({ memory })
        slots()[0] = resident('m1', 'Alpha')
        await expect(ensureCurrentModules({ memory })).resolves.toBe(true)
        expect(calls).toEqual(['m1'])
        expect(h.alerts).toHaveLength(1)
    })

    test('M memory-a-new-stub-object-in-the-slot-is-attempted-again', async () => {
        installDb([stub('m1', 'Alpha')], { enabled: ['m1'] })
        let failing = true
        registerInstallingLoader({ fail: (id) => (failing ? failingLoader()(id) : null) })
        const memory = createModuleFailureMemory()
        await ensureCurrentModules({ memory })
        slots()[0] = stub('m1', 'Alpha')
        failing = false
        await expect(ensureCurrentModules({ memory })).resolves.toBe(true)
        expect(calls).toEqual(['m1', 'm1'])
    })

    test('M memory-two-checks-started-during-one-failing-load-give-one-alert-and-one-ensure', async () => {
        installDb([stub('m1', 'Alpha')], { enabled: ['m1'] })
        const release = registerGatedLoader(failingLoader())
        const memory = createModuleFailureMemory()
        const first = ensureCurrentModules({ memory })
        const second = ensureCurrentModules({ memory })
        await settleTasks()
        release('m1')
        await expect(Promise.all([first, second])).resolves.toEqual([false, false])
        expect(h.alerts).toHaveLength(1)
        expect(calls).toEqual(['m1'])
        await expect(ensureCurrentModules({ memory })).resolves.toBe(false)
        expect(h.alerts).toHaveLength(1)
        expect(calls).toEqual(['m1'])
        expect(memory.inFlight).toBeNull()
    })

    test('M memory-a-waiter-on-an-owner-that-succeeds-proceeds-with-no-second-ensure', async () => {
        installDb([stub('m1', 'Alpha')], { enabled: ['m1'] })
        const release = registerGatedLoader(() => null)
        const memory = createModuleFailureMemory()
        const first = ensureCurrentModules({ memory })
        const second = ensureCurrentModules({ memory })
        await settleTasks()
        release('m1')
        await expect(Promise.all([first, second])).resolves.toEqual([true, true])
        expect(calls).toEqual(['m1'])
        expect(h.alerts).toEqual([])
    })

    test('M memory-a-key-change-during-the-flight-does-not-leave-or-clobber-the-in-flight-promise', async () => {
        installDb([stub('m1', 'Alpha'), stub('m2', 'Beta')])
        const character = (h.state.db.characters as Plain[])[0]
        ;(character.chats as Plain[])[0].modules = ['m1']
        ;(character.chats as Plain[]).push({ id: 'cB', modules: ['m2'], message: [] })
        const release = registerGatedLoader(failingLoader())
        const memory = createModuleFailureMemory()
        const first = ensureCurrentModules({ memory })
        await settleTasks()
        character.chatPage = 1
        const second = ensureCurrentModules({ memory })
        await settleTasks()
        release('m1')
        await expect(first).resolves.toBe(false)
        expect(memory.inFlight).not.toBeNull()
        release('m2')
        await expect(second).resolves.toBe(false)
        expect(memory.inFlight).toBeNull()
        expect(memory.key).toBe('a:cB')
        await expect(ensureCurrentModules({ memory })).resolves.toBe(false)
        expect(h.alerts).toHaveLength(2)
        expect(calls).toEqual(['m1', 'm2'])
    })

    test('M memory-a-failure-after-a-key-change-is-not-recorded-in-the-new-chats-memory', async () => {
        installDb([stub('m1', 'Alpha'), stub('m2', 'Beta')])
        const character = (h.state.db.characters as Plain[])[0]
        ;(character.chats as Plain[])[0].modules = ['m1']
        ;(character.chats as Plain[]).push({ id: 'cB', modules: ['m2'], message: [] })
        let failingM1 = true
        const release = registerGatedLoader((id) => (id === 'm1' && failingM1 ? failingLoader()(id) : null))
        const memory = createModuleFailureMemory()
        const first = ensureCurrentModules({ memory })
        await settleTasks()
        character.chatPage = 1
        const second = ensureCurrentModules({ memory })
        await settleTasks()
        release('m2')
        await expect(second).resolves.toBe(true)
        release('m1')
        await expect(first).resolves.toBe(false)
        failingM1 = false
        ;(character.chats as Plain[])[1].modules = ['m1', 'm2']
        const third = ensureCurrentModules({ memory })
        await settleTasks()
        release('m1')
        await expect(third).resolves.toBe(true)
        expect(calls).toEqual(['m1', 'm2', 'm1'])
    })
})
