/**
 * `requestSubtitleModel` (`../subtitleRequest.ts`) on the real `moduleEnsure.ts`, `moduleRefList.ts`,
 * `moduleAcquire.ts` and run subject, with a loader double registered through `registerModuleLoader` that replaces the
 * slot the way the production loader does. `requestChatData` and the alert module are mocks, so nothing leaves the test.
 *
 * Both subtitle call sites (the audio request and the transcript translation) call this one function, so these rows
 * cover both. What each site does with a null result (the first clears its loading text, the second leaves the
 * transcript) lives in the component and is not mounted here.
 *
 * Labels: R rows fail against the extraction without the wait; G rows pass on that base too.
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

import { requestSubtitleModel } from '../subtitleRequest'
import { registerModuleLoader, unregisterModuleLoader } from '../../storage/store2/moduleAcquire'

type Plain = Record<string, unknown>

const PROMPT = [{ role: 'user' as const, content: 'transcribe' }]
const RESPONSE = { type: 'success' as const, result: 'WEBVTT' }
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
    registerModuleLoader(async (handle) => {
        const id = handle.slice(0, handle.lastIndexOf('#'))
        loaderCalls.push(id)
        await new Promise<void>((resolve) => { release = resolve })
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

describe('requestSubtitleModel with module stubs in the chat', () => {
    test('R subtitle-waits-for-the-referenced-modules-before-the-request', async () => {
        installDb([stub()])
        registerGatedLoader(false)

        const result = requestSubtitleModel(PROMPT)
        await settleTasks()
        expect(loaderCalls).toEqual(['m1'])
        expect(h.request).not.toHaveBeenCalled()

        release!()
        await expect(result).resolves.toBe(RESPONSE)
        expect(h.request).toHaveBeenCalledTimes(1)
        expect(h.request).toHaveBeenCalledWith({ formated: PROMPT, bias: {}, useStreaming: true }, 'model')
        expect(h.alerts).toEqual([])
    })

    test('R subtitle-returns-null-without-a-request-when-a-module-fails-and-alerts-once', async () => {
        installDb([stub()])
        registerGatedLoader(true)

        const result = requestSubtitleModel(PROMPT)
        await settleTasks()
        release!()

        await expect(result).resolves.toBeNull()
        expect(h.request).not.toHaveBeenCalled()
        expect(h.alerts).toHaveLength(1)
    })
})

describe('requestSubtitleModel without module stubs', () => {
    test('G no-stubs-adds-no-await: the request is made in the same turn', () => {
        installDb([{ id: 'm1', name: 'Alpha', description: '', lorebook: [] }])
        registerGatedLoader(false)

        const result = requestSubtitleModel(PROMPT)

        expect(h.request).toHaveBeenCalledTimes(1)
        expect(loaderCalls).toEqual([])
        return expect(result).resolves.toBe(RESPONSE)
    })
})
