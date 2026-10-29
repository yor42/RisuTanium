/**
 * Module installs announce themselves through `bumpModuleGui`; every announcement reloads every chat body. A load loop
 * holds its bumps and announces once. The real `stores.svelte`, `process/modules` and `moduleEnsure` run together; the
 * only double is the module loader, which mirrors the production install tail (slot write, `refreshModules`,
 * `bumpModuleGui`).
 *
 * Labels: R = regression reproducer (fails on the base at a bump count), G = guard (passes before and after).
 */
import { flushSync, tick } from 'svelte'
import { get } from 'svelte/store'
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

import { DBState, loadedStore, ReloadGUIPointer, selectedCharID } from 'src/ts/stores.svelte'
import { MODULE_STUB_KEY } from 'src/ts/storage/moduleStub'
import { ModuleLoadError, registerModuleLoader, unregisterModuleLoader } from 'src/ts/storage/store2/moduleAcquire'
import { bumpModuleGui, refreshModules } from 'src/ts/process/modules'
import { ensureModulesForOrigin, ModuleEnsureError } from 'src/ts/process/moduleEnsure'
import { registerGuiReloadHook } from 'src/ts/guiReloadHooks'

type Plain = Record<string, unknown>

function stub(id: string): Plain {
    return { id, name: id, description: '', [MODULE_STUB_KEY]: 1 }
}

function character(chaId: string, modules: string[] = []): Plain {
    return { chaId, type: 'character', chatPage: 0, modules, chats: [{ id: `${chaId}-chat`, modules: [], message: [] }] }
}

function live(): { modules: Plain[], enabledModules: string[], characters: Plain[] } {
    return DBState.db as unknown as { modules: Plain[], enabledModules: string[], characters: Plain[] }
}

function freshDb(modules: Plain[], enabled: string[], characters: Plain[] = [character('x')]): void {
    DBState.db = {
        modules, enabledModules: enabled, moduleIntergration: '', personas: [], characters,
    } as unknown as typeof DBState.db
}

async function settle(): Promise<void> {
    flushSync()
    await tick()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    flushSync()
    await tick()
}

function originOfCharacter(index: number) {
    const owner = live().characters[index] as Plain
    const chat = (owner.chats as Plain[])[0]
    return {
        origin: { chaId: owner.chaId as string, chatId: chat.id as string },
        hint: { owner: owner as never, chat: chat as never },
    }
}

let loaderCalls: string[] = []
let held = new Map<string, () => void>()

/** Installs like the production loader. `hold` ids wait for `held.get(id)()`; `fail` ids reject. */
function installingLoader(options: { hold?: string[], fail?: string[], rejectOnAbort?: boolean } = {}) {
    registerModuleLoader(async (handle, signal) => {
        const id = handle.slice(0, handle.lastIndexOf('#'))
        loaderCalls.push(id)
        if (options.hold?.includes(id)) {
            await new Promise<void>((resolve, reject) => {
                held.set(id, resolve)
                if (options.rejectOnAbort) {
                    signal?.addEventListener('abort', () => reject(signal.reason))
                }
            })
        }
        if (options.fail?.includes(id)) {
            throw new ModuleLoadError('unreadable', id, id)
        }
        const index = live().modules.findIndex((m) => m.id === id)
        live().modules[index] = { id, name: id, description: '', lorebook: [] }
        refreshModules()
        bumpModuleGui()
        return live().modules[index] as never
    })
}

let pointerChanges = 0
let unsubscribe: () => void = () => {}

function countPointer() {
    pointerChanges = 0
    let first = true
    unsubscribe = ReloadGUIPointer.subscribe(() => {
        if (first) {
            first = false
            return
        }
        pointerChanges += 1
    })
}

beforeEach(async () => {
    loaderCalls = []
    held = new Map()
    h.alerts.length = 0
    loadedStore.set(false)
    selectedCharID.set(0)
    freshDb([], [])
    await settle()
})

afterEach(() => {
    // A load still held would leave its hold open for the rest of the file.
    for (const release of held.values()) {
        release()
    }
    unsubscribe()
    unregisterModuleLoader()
})

describe('a background load announces once', () => {
    test('R T1: five selected stubs give one pointer change, after the last install', async () => {
        const ids = ['m1', 'm2', 'm3', 'm4', 'm5']
        installingLoader()
        freshDb(ids.map(stub), ids)
        await settle()
        countPointer()
        loadedStore.set(true)
        await settle()

        expect(loaderCalls).toEqual(ids)
        expect(live().modules.some((m) => MODULE_STUB_KEY in m)).toBe(false)
        expect(pointerChanges).toBe(1)
    })

    test('G T4: every load fails, the hold is not left open', async () => {
        installingLoader({ fail: ['m1', 'm2'] })
        freshDb(['m1', 'm2'].map(stub), ['m1', 'm2'])
        loadedStore.set(true)
        await settle()
        expect(loaderCalls).toEqual(['m1', 'm2'])

        countPointer()
        bumpModuleGui()
        expect(pointerChanges).toBe(1)
    })
})

describe('a send announces once, before it continues', () => {
    test('R T2: three stubs give one bump and one reload hook, both before the ensure resolves', async () => {
        const ids = ['m1', 'm2', 'm3']
        installingLoader()
        freshDb(ids.map(stub), [], [character('x', ids)])
        await settle()
        const events: string[] = []
        const removeHook = registerGuiReloadHook(() => { events.push('hook') })
        try {
            countPointer()
            const { origin, hint } = originOfCharacter(0)
            await ensureModulesForOrigin(origin, undefined, hint)
            events.push('resolved')
        } finally {
            removeHook()
        }

        expect(loaderCalls).toEqual(ids)
        expect(pointerChanges).toBe(1)
        expect(events).toEqual(['hook', 'resolved'])
    })

    test('G T3: with a background run still holding, a send still announces before it continues', async () => {
        installingLoader({ hold: ['bg'] })
        freshDb([stub('bg'), stub('send')], [], [character('x', ['bg']), character('y', ['send'])])
        loadedStore.set(true)
        await settle()
        expect(loaderCalls).toEqual(['bg'])

        countPointer()
        const { origin, hint } = originOfCharacter(1)
        await ensureModulesForOrigin(origin, undefined, hint)
        expect(loaderCalls).toEqual(['bg', 'send'])
        expect(pointerChanges).toBe(1)

        held.get('bg')!()
        await settle()
    })

    test('G T4a: a failed load releases the hold', async () => {
        installingLoader({ fail: ['m1'] })
        freshDb([stub('m1')], [], [character('x', ['m1'])])
        const { origin, hint } = originOfCharacter(0)
        await expect(ensureModulesForOrigin(origin, undefined, hint)).rejects.toBeInstanceOf(ModuleEnsureError)

        countPointer()
        bumpModuleGui()
        expect(pointerChanges).toBe(1)
    })

    test('G T4b: an aborted load releases the hold', async () => {
        installingLoader({ hold: ['m1'], rejectOnAbort: true })
        freshDb([stub('m1')], [], [character('x', ['m1'])])
        const { origin, hint } = originOfCharacter(0)
        const controller = new AbortController()
        const pending = ensureModulesForOrigin(origin, controller.signal, hint)
        await settle()
        controller.abort(new Error('stop'))
        await expect(pending).rejects.toThrow('stop')

        countPointer()
        bumpModuleGui()
        expect(pointerChanges).toBe(1)
        expect(get(ReloadGUIPointer)).toBeGreaterThan(0)
    })
})
