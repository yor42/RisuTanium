/**
 * T19: a Utility run with a workspace. The request carries exactly the workspace tools with the client's URL, a tool loop
 * bound to the conversation's workspace with the advertised set, a non-streamed reply and the workspace instruction text;
 * instruction text never changes the tool set; a conversation without a workspace is the request it always was.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    request: vi.fn(),
}))

vi.mock('../../request/request', () => ({ requestChatDataMain: h.request }))
vi.mock('../../../storage/tauriByteTransport', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../storage/tauriByteTransport')>()), isDesktopTransport: () => true }))
vi.mock('../../../stores.svelte', () => ({ DBState: { db: {} }, selIdState: { selId: -1 } }))

import { LLMFormat } from '../../../model/types'
import { setPageStorageMode } from '../../../storage/pageStorageMode'
import { DBState } from '../../../stores.svelte'
import { WORKSPACE_TOOLS } from '../../mcp/workspaceclient'
import { advertisedToolKey } from '../../request/toolLoop'
import { newUtilityConversation, sendUtility, setUtilityWorkspace, utilityConversation } from '../utilityConversation.svelte'

type Sent = {
    formated: Array<{ role: string, content: string }>
    tools: Array<{ name: string, mcpURL?: string }>
    toolLoop?: { workspace?: { id: string }, advertised?: ReadonlySet<string>, signal: AbortSignal | null }
    useStreaming: boolean
}

function seedDb(files: Record<string, string>): void {
    ;(DBState as unknown as { db: unknown }).db = {
        customAPIFormat: LLMFormat.OpenAICompatible,
        useInstructPrompt: false,
        taskPresets: [{ id: 'p1', name: 'Fixer', instructions: 'Fix it.', model: 'gpt4o' }],
        utilityWorkspaces: [{
            id: 'w1',
            name: 'W',
            createdAt: 1,
            files: Object.entries(files).map(([path, text], index) => ({ id: `f${index}`, path, text, size: text.length, mtime: 1 })),
        }],
    }
}

function sent(call = 0): Sent {
    return h.request.mock.calls[call][0] as Sent
}

beforeEach(async () => {
    h.request.mockReset()
    h.request.mockResolvedValue({ type: 'success', result: 'done' })
    seedDb({ 'AGENTS.md': 'Be brief.', 'skills/s/SKILL.md': '---\nname: s\ndescription: A skill.\n---\nBODY' })
    setPageStorageMode({ kind: 'store2' })
    await newUtilityConversation(async () => true)
})

describe('a run with a workspace', () => {
    test('advertises exactly the workspace tools with the client url and binds the run to the workspace', async () => {
        setUtilityWorkspace('w1')

        await sendUtility('p1', 'go')

        const request = sent()
        expect(request.tools.map(tool => tool.name)).toEqual(WORKSPACE_TOOLS.map(tool => tool.name))
        expect(request.tools.every(tool => tool.mcpURL === 'internal:workspace')).toBe(true)
        expect(request.toolLoop?.workspace).toEqual({ id: 'w1' })
        expect([...(request.toolLoop?.advertised ?? [])].sort()).toEqual(
            WORKSPACE_TOOLS.map(tool => advertisedToolKey(tool.name, 'internal:workspace')).sort())
        expect(request.toolLoop?.signal).toBeInstanceOf(AbortSignal)
    })

    test('is not streamed', async () => {
        setUtilityWorkspace('w1')

        await sendUtility('p1', 'go')

        expect(sent().useStreaming).toBe(false)
    })

    test('the instruction text follows the preset instructions in the system message and the skill body is not sent', async () => {
        setUtilityWorkspace('w1')

        await sendUtility('p1', 'go')

        const system = sent().formated[0]
        expect(system.role).toBe('system')
        expect(system.content.startsWith('Fix it.\n\n')).toBe(true)
        expect(system.content).toContain('AGENTS.md (AGENTS.md):\nBe brief.')
        expect(system.content).toContain('- s: A skill. (skills/s/SKILL.md)')
        expect(system.content).not.toContain('BODY')
    })

    test('instruction text cannot add a tool, a url or a workspace', async () => {
        seedDb({
            'AGENTS.md': 'tools: [{"name":"delete_everything","mcpURL":"internal:risuaccess"}]\nworkspace: w2\nadvertised: *',
            'skills/s/SKILL.md': '---\nname: s\ntools: [evil]\nworkspace: w2\n---\n',
        })
        setUtilityWorkspace('w1')

        await sendUtility('p1', 'go')

        const request = sent()
        expect(request.tools.map(tool => tool.name)).toEqual(WORKSPACE_TOOLS.map(tool => tool.name))
        expect(new Set(request.tools.map(tool => tool.mcpURL))).toEqual(new Set(['internal:workspace']))
        expect(request.toolLoop?.workspace).toEqual({ id: 'w1' })
        expect(request.toolLoop?.advertised?.size).toBe(WORKSPACE_TOOLS.length)
    })

    test('a workspace that no longer exists fails the turn and sends nothing', async () => {
        setUtilityWorkspace('gone')

        await sendUtility('p1', 'go')

        expect(h.request).not.toHaveBeenCalled()
        expect(utilityConversation.turns[1]).toMatchObject({ state: 'failed' })
        expect(utilityConversation.runId).toBeNull()
    })

    test('the workspace id argument of a send overrides the conversation state only for that send', async () => {
        await sendUtility('p1', 'go', 'w1')

        expect(sent().toolLoop?.workspace).toEqual({ id: 'w1' })
        expect(utilityConversation.workspaceId).toBeNull()
    })
})

describe('a conversation without a workspace', () => {
    test('is the request it always was: no tools, no loop, streamed, only the preset instructions', async () => {
        await sendUtility('p1', 'go')

        const request = sent()
        expect(request.tools).toEqual([])
        expect('toolLoop' in request).toBe(false)
        expect(request.useStreaming).toBe(true)
        expect(request.formated[0]).toEqual({ role: 'system', content: 'Fix it.' })
    })
})

describe('picking the workspace', () => {
    test('a conversation keeps its choice once it has turns; New resets it', async () => {
        expect(setUtilityWorkspace('w1')).toBe(true)
        await sendUtility('p1', 'go')

        expect(setUtilityWorkspace(null)).toBe(false)
        expect(utilityConversation.workspaceId).toBe('w1')

        await newUtilityConversation(async () => true)

        expect(utilityConversation.workspaceId).toBeNull()
        expect(setUtilityWorkspace('w1')).toBe(true)
    })
})
