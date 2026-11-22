/**
 * "Allow this server for the rest of this chat" at the tool gate (MC-3413): the real `authorizeToolCall` and the real
 * server grants with a stub approver. A grant is held per (visible chat, server url), only in memory, and ends when the
 * visible chat changes; it is offered only to a third-party server called from the chat on screen.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ByteStore } from 'src/ts/storage/store/contract'
import type { RunSubject } from '../../chatOrigin'
import { createMemoryByteStore, type MemoryByteStore } from '../../files/tests/memoryByteStore'
import { newToolLoop, advertisedToolKey } from '../../request/toolLoop'
import type { ToolApprovalRequest, ToolDecision } from '../toolApproval'

const h = vi.hoisted(() => ({
    store: null as ByteStore | null,
    asked: [] as ToolApprovalRequest[],
    answer: 'once' as ToolDecision,
    onAsk: null as (() => void) | null,
}))

vi.mock('src/ts/storage/store/appStore', () => ({ getAppStore: async () => h.store }))
vi.mock('src/ts/alertPrompts', () => ({ queueNotice: () => { } }))
vi.mock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: {} }, selIdState: { selId: -1 } }))
vi.mock('../toolApproval', () => ({
    TOOL_SUMMARY_LIMIT: 800,
    askToolApproval: vi.fn(async (request: ToolApprovalRequest): Promise<ToolDecision> => {
        h.asked.push(request)
        h.onAsk?.()
        return h.answer
    }),
}))

import { authorizeToolCall } from '../toolAuthorize'
import { noteVisibleChat, resetServerChatGrantsForTests } from '../serverChatGrants.svelte'
import { resetToolGrantsForTests } from '../toolGrants'

const URL_A = 'https://mcp-a.example/sse'
const URL_B = 'https://mcp-b.example/sse'
const CHAT = 'cha1:chat1'

function subjectFor(chaId: string, chatId: string): RunSubject {
    return { origin: { chaId, chatId } } as unknown as RunSubject
}

const callAs = (subject: RunSubject | undefined, url = URL_A, name = 'lookup') =>
    authorizeToolCall(name, {}, { mcpURL: url, subject })

const here = subjectFor('cha1', 'chat1')

let store: MemoryByteStore

beforeEach(() => {
    store = createMemoryByteStore()
    h.store = store
    h.asked.length = 0
    h.answer = 'once'
    h.onAsk = null
    resetToolGrantsForTests()
    resetServerChatGrantsForTests()
    noteVisibleChat(CHAT)
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

describe('server grant for the visible chat', () => {
    test('a third-party call from the visible chat is offered the server option, and a server answer skips later questions for that url only', async () => {
        h.answer = 'server'
        expect(await callAs(here)).toBeNull()
        expect(h.asked[0].view).toMatchObject({ offerServer: true, offerAlways: false })

        h.answer = 'deny'
        expect(await callAs(here, URL_A, 'another_tool')).toBeNull()
        expect(h.asked).toHaveLength(1)

        expect(await callAs(here, URL_B)).not.toBeNull()
        expect(h.asked).toHaveLength(2)
    })

    test('a once answer saves nothing', async () => {
        expect(await callAs(here)).toBeNull()
        expect(await callAs(here)).toBeNull()
        expect(h.asked).toHaveLength(2)
    })

    test('a change of the visible chat clears the grant, and returning does not bring it back', async () => {
        h.answer = 'server'
        await callAs(here)
        noteVisibleChat('cha1:chat2')
        noteVisibleChat(CHAT)
        h.answer = 'once'
        await callAs(here)
        expect(h.asked).toHaveLength(2)
    })

    test('leaving every chat clears the grant', async () => {
        h.answer = 'server'
        await callAs(here)
        noteVisibleChat(null)
        noteVisibleChat(CHAT)
        await callAs(here)
        expect(h.asked).toHaveLength(2)
    })

    test('noting the same chat again keeps the grant', async () => {
        h.answer = 'server'
        await callAs(here)
        noteVisibleChat(CHAT)
        await callAs(here)
        expect(h.asked).toHaveLength(1)
    })

    test('the reset used by a restart clears the grant', async () => {
        h.answer = 'server'
        await callAs(here)
        resetServerChatGrantsForTests()
        noteVisibleChat(CHAT)
        await callAs(here)
        expect(h.asked).toHaveLength(2)
    })

    test('a server answer given after the user left the chat runs the call once and records nothing', async () => {
        h.answer = 'server'
        h.onAsk = () => noteVisibleChat('cha1:chat2')
        expect(await callAs(here)).toBeNull()
        noteVisibleChat(CHAT)
        h.onAsk = null
        await callAs(here)
        expect(h.asked).toHaveLength(2)
    })

    test('the grant never reaches the byte store', async () => {
        h.answer = 'server'
        await callAs(here)
        await callAs(here)
        expect(store.writes).toEqual([])
    })

    test('a run stopped after the answer records no grant', async () => {
        const controller = new AbortController()
        h.answer = 'server'
        h.onAsk = () => controller.abort()
        const loop = newToolLoop(controller.signal)
        loop.advertised = new Set([advertisedToolKey('lookup', URL_A)])
        const result = await authorizeToolCall('lookup', {}, { mcpURL: URL_A, subject: here, toolLoop: loop })
        expect(result?.[0]).toMatchObject({ text: 'Stopped before lookup ran.' })
        h.onAsk = null
        await callAs(here)
        expect(h.asked).toHaveLength(2)
    })
})

describe('no server option', () => {
    test('a call with no subject is asked without it, and a server answer saves nothing', async () => {
        h.answer = 'server'
        await callAs(undefined)
        expect(h.asked[0].view?.offerServer).toBeFalsy()
        await callAs(undefined)
        expect(h.asked).toHaveLength(2)
    })

    test('a call from a chat that is not the visible one is asked without it, and it cannot use the visible chat grant', async () => {
        const other = subjectFor('cha1', 'chat2')
        h.answer = 'server'
        await callAs(here)
        await callAs(other)
        expect(h.asked).toHaveLength(2)
        expect(h.asked[1].view?.offerServer).toBeFalsy()
        await callAs(other)
        expect(h.asked).toHaveLength(3)
    })

    test('with no chat on screen the option is not offered', async () => {
        noteVisibleChat(null)
        await callAs(here)
        expect(h.asked[0].view?.offerServer).toBeFalsy()
    })

    test('an internal mutating tool outside a workspace keeps once and deny', async () => {
        h.answer = 'server'
        await callAs(here, 'internal:risuai', 'risu-set-character-info')
        await callAs(here, 'internal:risuai', 'risu-set-character-info')
        expect(h.asked).toHaveLength(2)
        for (const request of h.asked) {
            expect(request.view?.offerServer).toBeFalsy()
        }
    })

    test('an internal workspace tool is never offered the server option and a server answer is not a grant', async () => {
        const loop = newToolLoop(null)
        loop.workspace = { id: 'ws1' }
        loop.advertised = new Set([advertisedToolKey('write_file', 'internal:workspace')])
        h.answer = 'server'
        for (let i = 0; i < 2; i++) {
            await authorizeToolCall('write_file', { path: 'a.txt', text: 'x' }, { mcpURL: 'internal:workspace', subject: here, toolLoop: loop })
        }
        expect(h.asked).toHaveLength(2)
        for (const request of h.asked) {
            expect(request.view?.offerServer).toBeFalsy()
        }
    })
})
