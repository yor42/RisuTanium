/**
 * `requestSuggestionData` (`../suggestionRequest.ts`) on the real `moduleEnsure.ts`, `moduleRefList.ts`,
 * `moduleAcquire.ts` and run subject, with a loader double registered through `registerModuleLoader` that replaces the
 * slot the way the production loader does. `requestChatData` and the alert module are mocks, so nothing leaves the test.
 *
 * Labels: R rows fail against the extraction without the wait (the request is made at once, or after the wait with no
 * stop); G rows pass on that base too and guard the profile without stubs and the successful path.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { MODULE_STUB_KEY } from '../../storage/moduleStub'

//#region module mocks

const h = vi.hoisted(() => ({
    state: { db: {} as Record<string, unknown> },
    alerts: [] as string[],
    request: vi.fn(),
}))

vi.mock(import('../../stores.svelte'), () => ({
    DBState: h.state,
    selectedCharID: writable(0),
}) as unknown as typeof import('../../stores.svelte'))

vi.mock(import('../../alert'), () => ({
    alertError: vi.fn((msg: string) => { h.alerts.push(msg) }),
    alertWait: vi.fn(),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../util'), () => ({
    checkPersonaBinded: vi.fn(() => false),
}) as unknown as typeof import('../../util'))

vi.mock(import('../../storage/database.svelte'), () => {
    const getCurrentCharacter = () => (h.state.db.characters as unknown[])?.[0]
    const getCurrentChat = () => {
        const char = getCurrentCharacter() as { chats?: unknown[], chatPage?: number } | undefined
        return char?.chats?.[char.chatPage ?? 0]
    }
    return { getDatabase: () => h.state.db, getCurrentCharacter, getCurrentChat } as unknown as typeof import('../../storage/database.svelte')
})

vi.mock(import('../request/request'), () => ({
    requestChatData: h.request,
}) as unknown as typeof import('../request/request'))

//#endregion

import { requestSuggestionData } from '../suggestionRequest'
import type { character } from '../../storage/database.svelte'
import { registerModuleLoader, unregisterModuleLoader } from '../../storage/store2/moduleAcquire'

type Plain = Record<string, unknown>

const PROMPT = [{ role: 'user' as const, content: 'hello' }]
const CHAR = { chaId: 'a' } as unknown as character
const RESPONSE = { type: 'success' as const, result: '- one' }
let loaderCalls: string[] = []
let release: (() => void) | null = null

function installDb(modules: Plain[]) {
    h.state.db = {
        characters: [{
            chaId: 'a', type: 'character', chatPage: 0, modules: [],
            chats: [{ id: 'cA', modules: ['m1'], message: [] }],
        }],
        modules, enabledModules: [], moduleIntergration: '', personas: [],
    }
}

function stub(): Plain {
    return { id: 'm1', name: 'Alpha', description: '', [MODULE_STUB_KEY]: 1 }
}

/** The loader double: holds until `release`, then fails or replaces the slot with a resident body. */
function registerGatedLoader(fails: boolean) {
    registerModuleLoader(async (handle, signal) => {
        const id = handle.slice(0, handle.lastIndexOf('#'))
        loaderCalls.push(id)
        await new Promise<void>((resolve) => { release = resolve })
        if (signal?.aborted) {
            throw signal.reason
        }
        if (fails) {
            throw new Error('damaged')
        }
        const slots = h.state.db.modules as Plain[]
        const index = slots.findIndex((m) => m.id === id)
        slots[index] = { id, name: id, description: '', lorebook: [] }
        return slots[index] as never
    })
}

async function settleTasks() {
    for (let i = 0; i < 4; i++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
}

beforeEach(() => {
    loaderCalls = []
    release = null
    h.alerts.length = 0
    h.request.mockReset()
    h.request.mockResolvedValue(RESPONSE)
})

afterEach(() => {
    unregisterModuleLoader()
})

describe('requestSuggestionData with module stubs in the chat', () => {
    test('R suggestion-waits-for-the-referenced-modules-before-the-request', async () => {
        installDb([stub()])
        registerGatedLoader(false)

        const result = requestSuggestionData(PROMPT, CHAR, null, () => true)
        await settleTasks()
        expect(loaderCalls).toEqual(['m1'])
        expect(h.request).not.toHaveBeenCalled()

        release!()
        await expect(result).resolves.toBe(RESPONSE)
        expect(h.request).toHaveBeenCalledTimes(1)
        expect(h.request).toHaveBeenCalledWith({ formated: PROMPT, bias: {}, currentChar: CHAR }, 'submodel', null)
        expect(h.alerts).toEqual([])
    })

    test('R suggestion-stops-silently-when-a-module-fails', async () => {
        installDb([stub()])
        registerGatedLoader(true)

        const result = requestSuggestionData(PROMPT, CHAR, null, () => true)
        await settleTasks()
        release!()

        await expect(result).resolves.toBeNull()
        expect(h.request).not.toHaveBeenCalled()
        expect(h.alerts).toEqual([])
    })

    test('R suggestion-abort-during-the-wait-makes-no-request', async () => {
        installDb([stub()])
        registerGatedLoader(false)
        const controller = new AbortController()

        const result = requestSuggestionData(PROMPT, CHAR, controller.signal, () => true)
        await settleTasks()
        controller.abort()
        release?.()

        await expect(result).resolves.toBeNull()
        expect(h.request).not.toHaveBeenCalled()
        expect(h.alerts).toEqual([])
    })

    test('R suggestion-no-request-when-the-run-is-stale-after-the-wait-without-a-signal', async () => {
        installDb([stub()])
        registerGatedLoader(false)
        let current = true

        const result = requestSuggestionData(PROMPT, CHAR, null, () => current)
        await settleTasks()
        current = false
        release!()

        await expect(result).resolves.toBeNull()
        expect(h.request).not.toHaveBeenCalled()
    })

    test('G suggestion-requests-with-the-signal-once-the-modules-are-loaded', async () => {
        installDb([stub()])
        registerGatedLoader(false)
        const controller = new AbortController()

        const result = requestSuggestionData(PROMPT, CHAR, controller.signal, () => true)
        await settleTasks()
        release!()

        await expect(result).resolves.toBe(RESPONSE)
        expect(h.request.mock.calls[0][2]).toBe(controller.signal)
    })
})

describe('requestSuggestionData without module stubs', () => {
    test('G no-stubs-adds-no-await: the request is made in the same turn', () => {
        installDb([{ id: 'm1', name: 'Alpha', description: '', lorebook: [] }])
        registerGatedLoader(false)

        const result = requestSuggestionData(PROMPT, CHAR, null, () => false)

        expect(h.request).toHaveBeenCalledTimes(1)
        expect(loaderCalls).toEqual([])
        return expect(result).resolves.toBe(RESPONSE)
    })
})
