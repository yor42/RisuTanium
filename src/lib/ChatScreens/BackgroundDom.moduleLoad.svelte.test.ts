// @vitest-environment jsdom

/**
 * On a chat's first open the card background parses once, after the selected modules loaded, and carries their
 * embedding. The real `BackgroundDom.svelte`, `moduleEnsure.ts`, `moduleRefList.ts`, `moduleAcquire.ts` and
 * `moduleGuiBump.ts` run on a real `$state` `DBState.db`; the loader is a held double that installs the way the
 * production loader does (the embedding the installed module contributes, then the coalesced GUI bump). The parser is a
 * held double. These rows assert call timing, not sanitizer output, so identity-sanitizer falsification does not apply.
 *
 * Labels: R = regression reproducer (the base parses before the last bump), G = guard (passes before and after).
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    parses: [] as Array<{ args: unknown[], resolve: (html: string) => void }>,
}))

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: {} as Record<string, unknown> })
    const selIdState = $state({ selId: 0 })
    return {
        DBState,
        selIdState,
        selectedCharID: writable(0),
        ReloadGUIPointer: writable(0),
        moduleBackgroundEmbedding: writable(''),
    }
})
vi.mock('src/ts/parser/parser.svelte', () => ({
    risuChatParser: vi.fn((text: string) => text),
    ParseMarkdown: vi.fn((...args: unknown[]) => new Promise<string>((resolve) => { h.parses.push({ args, resolve }) })),
}))
vi.mock('src/ts/storage/database.svelte', async () => {
    const stores = await import('src/ts/stores.svelte')
    const db = () => (stores.DBState as unknown as { db: { characters: Array<{ chats: unknown[] }> } }).db
    const owner = () => db().characters[0]
    return {
        getDatabase: () => db(),
        getCurrentCharacter: () => owner(),
        getCurrentChat: () => owner()?.chats[0],
    }
})
vi.mock('src/ts/alert', () => ({ alertError: vi.fn() }))
vi.mock('src/ts/util', () => ({ checkPersonaBinded: vi.fn(() => false) }))

import BackgroundDom from 'src/lib/ChatScreens/BackgroundDom.svelte'
import { clearChatBodyRenderCache } from 'src/lib/ChatScreens/chatBodyRenderCache'
import { DBState, ReloadGUIPointer, moduleBackgroundEmbedding, selectedCharID, selIdState } from 'src/ts/stores.svelte'
import { ParseMarkdown } from 'src/ts/parser/parser.svelte'
import { alertError } from 'src/ts/alert'
import { MODULE_STUB_KEY } from 'src/ts/storage/moduleStub'
import { ModuleLoadError, registerModuleLoader, unregisterModuleLoader } from 'src/ts/storage/store2/moduleAcquire'
import { ensureSelectedModules } from 'src/ts/process/moduleEnsure'
import { bumpModuleGui } from 'src/ts/process/moduleGuiBump'

type Plain = Record<string, unknown>

const live = () => DBState.db as unknown as { modules: Plain[], enabledModules: string[], characters: Plain[] }
const stub = (id: string): Plain => ({ id, name: id, description: '', [MODULE_STUB_KEY]: 1 })
const wait = async (ms = 0) => { await new Promise((r) => setTimeout(r, ms)); flushSync() }
const backParses = () => vi.mocked(ParseMarkdown).mock.calls.filter((call) => call[2] === 'back')

let releaseLoads: () => void = () => {}
let backParsesAtLastBump = -1
const mounted: Array<{ instance: object, target: HTMLElement }> = []

/** Holds every load until `releaseLoads`, then installs (or fails) like the production loader. */
function registerHeldLoader(failing: string[] = []) {
    backParsesAtLastBump = -1
    const gate = new Promise<void>((resolve) => { releaseLoads = resolve })
    registerModuleLoader(async (handle) => {
        const id = handle.slice(0, handle.lastIndexOf('#'))
        await gate
        if (failing.includes(id)) {
            throw new ModuleLoadError('unreadable', id, id)
        }
        const index = live().modules.findIndex((m) => m.id === id)
        live().modules[index] = { id, name: id, description: '', backgroundEmbedding: `EMBED-${id}` }
        moduleBackgroundEmbedding.update((value) => value + `\nEMBED-${id}\n`)
        bumpModuleGui()
        backParsesAtLastBump = backParses().length
        return live().modules[index] as never
    })
}

function setUp(stubs: string[]) {
    DBState.db = {
        modules: stubs.map(stub),
        enabledModules: stubs,
        moduleIntergration: '',
        characters: [{ chaId: 'a', chatPage: 0, chats: [{ id: 'cA' }], backgroundHTML: 'CARD' }],
    } as never
}

function mountBackground() {
    const target = document.createElement('div')
    document.body.append(target)
    mounted.push({ instance: mount(BackgroundDom, { target }), target })
    flushSync()
    return target
}

beforeEach(() => {
    h.parses.length = 0
    selIdState.selId = 0
    selectedCharID.set(0)
    ReloadGUIPointer.set(0)
    moduleBackgroundEmbedding.set('')
    clearChatBodyRenderCache()
    vi.clearAllMocks()
})

afterEach(async () => {
    releaseLoads()
    await wait(20)
    unregisterModuleLoader()
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
})

describe('first open of a chat with module stubs', () => {
    test('R T10: no parse before the last bump, then exactly one parse carrying the embedding', async () => {
        setUp(['m1', 'm2'])
        registerHeldLoader()
        const target = mountBackground()
        ensureSelectedModules(true)
        await wait(20)
        expect(backParses()).toHaveLength(0)
        expect(target.querySelector('div')).toBeNull()

        releaseLoads()
        await wait(20)
        await tick()
        expect(backParsesAtLastBump).toBe(0)
        expect(backParses()).toHaveLength(1)
        expect(String(backParses()[0][0])).toContain('EMBED-m1')
        expect(String(backParses()[0][0])).toContain('EMBED-m2')
        h.parses[0].resolve('<style>.x{}</style><div id="bg">final</div>')
        await wait(20)
        expect(target.querySelector('#bg')?.textContent).toBe('final')
        expect(get(moduleBackgroundEmbedding)).toContain('EMBED-m2')
    })

    test('R T11: one failing module ends the wait with one parse and the single alert', async () => {
        setUp(['m1', 'm2'])
        registerHeldLoader(['m1'])
        const target = mountBackground()
        ensureSelectedModules(true)
        await wait(20)
        expect(backParses()).toHaveLength(0)

        releaseLoads()
        await wait(20)
        await tick()
        expect(backParses()).toHaveLength(1)
        expect(String(backParses()[0][0])).not.toContain('EMBED-m1')
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(String(vi.mocked(alertError).mock.calls[0][0])).toContain('m1')
        h.parses[0].resolve('<div id="bg">shown</div>')
        await wait(20)
        expect(target.querySelector('#bg')?.textContent).toBe('shown')
    })

    test('R T11b: every module failing (no install, no pointer bump) still ends the wait', async () => {
        setUp(['m1', 'm2'])
        registerHeldLoader(['m1', 'm2'])
        mountBackground()
        ensureSelectedModules(true)
        await wait(20)
        expect(backParses()).toHaveLength(0)

        releaseLoads()
        await wait(20)
        await tick()
        expect(backParses()).toHaveLength(1)
        expect(alertError).toHaveBeenCalledTimes(1)
    })
})
