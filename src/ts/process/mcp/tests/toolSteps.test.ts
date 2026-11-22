/**
 * A model-driven call gives exactly one step, reported after the call ends: `ran` on success, `error` when the
 * client is missing, throws or answers with a failure, `stopped` when the run was stopped before or during
 * dispatch, and the gate's own outcome when the call never dispatches. Drives the real `mcp.ts` and gate with a
 * stub client; nothing here says anything about a native backend.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { newToolLoop, type ToolStep } from '../../request/toolLoop'

const h = vi.hoisted(() => ({
    answer: (async () => 'once') as () => Promise<'once' | 'deny'>,
    /** Runs while a client is being ensured, before its call. */
    onEnsure: (() => {}) as () => void,
    /** What the client does with a call. */
    callTool: (async () => [{ type: 'text', text: 'fs-ran' }]) as () => Promise<Array<{ type: string, text: string }>>,
    calls: 0,
}))

vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) } }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))
vi.mock('dompurify', () => ({ default: { addHook: vi.fn(), sanitize: (html: string) => html } }))
vi.mock('../../../platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('../../../storage/database.svelte', () => ({ getDatabase: () => ({}) }))
vi.mock('../../../stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: {} }, CharEmotion: writable({}), selectedCharID: writable(-1), selIdState: { selId: 0 },
        CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
        HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''),
    }
})
vi.mock('../../../alert', () => ({ alertError: vi.fn(), alertInput: vi.fn(async () => ''), alertNormal: vi.fn() }))
vi.mock('../../../util', () => ({ sleep: async () => {} }))
vi.mock('../../modules', () => ({ getModuleMcpEntries: () => [], getModuleMcps: () => [] }))
vi.mock('../mcplib', () => ({ MCPClient: class {} }))
vi.mock('../toolApproval', () => ({
    TOOL_SUMMARY_LIMIT: 800,
    askToolApproval: vi.fn(async () => await h.answer()),
}))
vi.mock('../filesystemclient', () => ({
    FileSystemClient: class {
        url = 'internal:fs'
        serverInfo = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fs', version: '1' } }
        async checkHandshake() { h.onEnsure(); return this.serverInfo }
        async getToolList() { return [] }
        async callTool() { h.calls++; return await h.callTool() }
        destroy() {}
    },
}))

let mcp: typeof import('../mcp')

beforeEach(async () => {
    vi.resetModules()
    h.answer = async () => 'once'
    h.onEnsure = () => {}
    h.callTool = async () => [{ type: 'text', text: 'fs-ran' }]
    h.calls = 0
    mcp = await import('../mcp')
}, 60_000)

function stepLoop(controller?: AbortController) {
    const steps: ToolStep[] = []
    const toolLoop = newToolLoop(controller?.signal ?? null)
    toolLoop.onStep = (step) => { steps.push(step) }
    return { steps, toolLoop }
}

const WRITE = { path: 'a.txt', content: 'x' }

describe('one step per model-driven call', () => {
    test('a call that succeeds is one ran step', async () => {
        const { steps, toolLoop } = stepLoop()

        await mcp.callMCPTool('fs_write_file', WRITE, { mcpURL: 'internal:fs', toolLoop })

        expect(steps.map(step => step.outcome)).toEqual(['ran'])
        expect(h.calls).toBe(1)
    })

    test('a call whose client is missing is one error step', async () => {
        const { steps, toolLoop } = stepLoop()

        const result = await mcp.callMCPTool('fs_write_file', WRITE, { mcpURL: 'https://nowhere.invalid/mcp', toolLoop })

        expect(result).toEqual([{ type: 'text', text: 'Tool fs_write_file not found on any MCP' }])
        expect(steps.map(step => step.outcome)).toEqual(['error'])
    })

    test('a tool that throws is one error step and the error still reaches the caller', async () => {
        const { steps, toolLoop } = stepLoop()
        h.callTool = async () => { throw new Error('tool down') }

        await expect(mcp.callMCPTool('fs_write_file', WRITE, { mcpURL: 'internal:fs', toolLoop })).rejects.toThrow('tool down')

        expect(steps.map(step => step.outcome)).toEqual(['error'])
    })

    test.each([
        ['an Error text', 'Error: disk full'],
        ['an unknown tool text', 'Unknown tool: fs_write_file'],
        ['a workspace error answer', '{"error":"no such file","code":"not_found"}'],
    ])('a tool that answers with %s is one error step', async (_label, text) => {
        const { steps, toolLoop } = stepLoop()
        h.callTool = async () => [{ type: 'text', text }]

        const result = await mcp.callMCPTool('fs_write_file', WRITE, { mcpURL: 'internal:fs', toolLoop })

        expect(result).toEqual([{ type: 'text', text }])
        expect(steps.map(step => step.outcome)).toEqual(['error'])
    })

    test('a result that only mentions an error is a ran step', async () => {
        const { steps, toolLoop } = stepLoop()
        h.callTool = async () => [{ type: 'text', text: 'the Error: label is part of the file' }]

        await mcp.callMCPTool('fs_write_file', WRITE, { mcpURL: 'internal:fs', toolLoop })

        expect(steps.map(step => step.outcome)).toEqual(['ran'])
    })

    test('a client that answers with nothing is one ran step and the call still resolves', async () => {
        const { steps, toolLoop } = stepLoop()
        h.callTool = (async () => undefined) as unknown as typeof h.callTool

        await expect(mcp.callMCPTool('fs_write_file', WRITE, { mcpURL: 'internal:fs', toolLoop })).resolves.toBeUndefined()

        expect(steps.map(step => step.outcome)).toEqual(['ran'])
    })

    test('a Stop that lands while the client is ensured is one stopped step and calls nothing', async () => {
        const controller = new AbortController()
        const { steps, toolLoop } = stepLoop(controller)
        h.onEnsure = () => controller.abort()

        const result = await mcp.callMCPTool('fs_write_file', WRITE, { mcpURL: 'internal:fs', toolLoop })

        expect(result).toEqual([{ type: 'text', text: 'Stopped before fs_write_file ran.' }])
        expect(h.calls).toBe(0)
        expect(steps.map(step => step.outcome)).toEqual(['stopped'])
    })

    test('a Stop that lands while the tool runs is one stopped step', async () => {
        const controller = new AbortController()
        const { steps, toolLoop } = stepLoop(controller)
        h.callTool = async () => { controller.abort(); return [{ type: 'text', text: 'fs-ran' }] }

        await mcp.callMCPTool('fs_write_file', WRITE, { mcpURL: 'internal:fs', toolLoop })

        expect(steps.map(step => step.outcome)).toEqual(['stopped'])
    })

    test('a denial is one denied step and a refusal one refused step, neither dispatching', async () => {
        const denied = stepLoop()
        h.answer = async () => 'deny'
        await mcp.callMCPTool('fs_write_file', WRITE, { mcpURL: 'internal:fs', toolLoop: denied.toolLoop })

        const refused = stepLoop()
        await mcp.callMCPTool('fs_write_file', WRITE, { toolLoop: refused.toolLoop })

        expect(denied.steps.map(step => step.outcome)).toEqual(['denied'])
        expect(refused.steps.map(step => step.outcome)).toEqual(['refused'])
        expect(h.calls).toBe(0)
    })

    test('a hook that throws never changes the call', async () => {
        const { toolLoop } = stepLoop()
        toolLoop.onStep = () => { throw new Error('hook bug') }

        const result = await mcp.callMCPTool('fs_write_file', WRITE, { mcpURL: 'internal:fs', toolLoop })

        expect(result).toEqual([{ type: 'text', text: 'fs-ran' }])
    })
})
