/**
 * A plugin MCP tool call that never settles cannot hold the tool loop after a Stop: the call is raced on the
 * loop's signal and reports `stopped`.
 * A rejecting call, stopped or not, leaves no unhandled rejection for the page's error dialog. Drives the real
 * `mcp.ts` and the real plugin client `registerMCPModule` builds.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { newToolLoop, type ToolStep } from '../../request/toolLoop'
import type { RPCToolCallContent } from '../mcplib'

const h = vi.hoisted(() => ({
    alertError: vi.fn(),
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
vi.mock('../../../alert', () => ({ alertError: h.alertError, alertInput: vi.fn(async () => ''), alertNormal: vi.fn() }))
vi.mock('../../../util', () => ({ sleep: async () => {} }))
vi.mock('../../modules', () => ({ getModuleMcpEntries: () => [], getModuleMcps: () => [] }))
vi.mock('../mcplib', () => ({ MCPClient: class {} }))
vi.mock('../toolApproval', () => ({
    TOOL_SUMMARY_LIMIT: 800,
    askToolApproval: vi.fn(async () => 'once'),
}))

let mcp: typeof import('../mcp')
let pluginMcp: typeof import('../pluginmcp')
let unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => { unhandled.push(reason) }

beforeEach(async () => {
    vi.resetModules()
    mcp = await import('../mcp')
    pluginMcp = await import('../pluginmcp')
    unhandled = []
    h.alertError.mockClear()
    process.on('unhandledRejection', onUnhandled)
}, 60_000)

afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
    vi.restoreAllMocks()
})

function stepLoop(controller?: AbortController) {
    const steps: ToolStep[] = []
    const toolLoop = newToolLoop(controller?.signal ?? null)
    toolLoop.onStep = (step) => { steps.push(step) }
    return { steps, toolLoop }
}

async function register(callTool: (name: string, args: unknown) => Promise<RPCToolCallContent[]>) {
    await pluginMcp.registerMCPModule({ identifier: 'plugin:t', name: 't', version: '1', description: 'd' }, async () => [], callTool)
}

/** Two macrotask flushes, so a late rejection would have reached the process handler. */
async function flush() {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('a plugin MCP tool call after a Stop', () => {
    test('MCP-2: a call that never settles returns and is reported stopped', async () => {
        await register(() => new Promise(() => {}))
        const controller = new AbortController()
        const { steps, toolLoop } = stepLoop(controller)
        vi.spyOn(console, 'warn').mockImplementation(() => {})

        let settled = false
        const call = mcp.callMCPTool('t', {}, { mcpURL: 'plugin:t', toolLoop }).then((value) => { settled = true; return value })
        await flush()
        expect(settled).toBe(false)
        controller.abort()
        await flush()

        expect(settled).toBe(true)
        expect(await call).toEqual([])
        expect(steps.map((step) => step.outcome)).toEqual(['stopped'])
    })

    test('MCP-6: an abandoned call that rejects later is one console warning and no unhandled rejection', async () => {
        let rejectLate: (error: Error) => void = () => {}
        await register(() => new Promise((_resolve, reject) => { rejectLate = reject }))
        const controller = new AbortController()
        const { steps, toolLoop } = stepLoop(controller)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})

        let settled = false
        const call = mcp.callMCPTool('t', {}, { mcpURL: 'plugin:t', toolLoop }).then((value) => { settled = true; return value })
        await flush()
        controller.abort()
        await flush()
        expect(settled).toBe(true)
        expect(await call).toEqual([])
        expect(steps.map((step) => step.outcome)).toEqual(['stopped'])

        const late = new Error('late')
        rejectLate(late)
        await flush()

        expect(unhandled).toEqual([])
        expect(warn).toHaveBeenCalledWith('An MCP tool call', late)
        expect(error).not.toHaveBeenCalled()
        expect(h.alertError).not.toHaveBeenCalled()
    })

    test('MCP-5: guard, a rejecting call with no Stop reaches the caller, reports error and leaves no unhandled rejection', async () => {
        const failure = new Error('tool failed')
        await register(async () => { throw failure })
        const controller = new AbortController()
        const { steps, toolLoop } = stepLoop(controller)

        await expect(mcp.callMCPTool('t', {}, { mcpURL: 'plugin:t', toolLoop })).rejects.toBe(failure)
        await flush()

        expect(steps.map((step) => step.outcome)).toEqual(['error'])
        expect(unhandled).toEqual([])
        expect(h.alertError).not.toHaveBeenCalled()
    })

    test('MCP-4: guard, an unaborted tool loop and a call with no tool loop return the plugin result', async () => {
        await register(async () => [{ type: 'text', text: 'plugin-ran' }])
        const { toolLoop } = stepLoop(new AbortController())

        expect(await mcp.callMCPTool('t', {}, { mcpURL: 'plugin:t', toolLoop })).toEqual([{ type: 'text', text: 'plugin-ran' }])
        expect(await mcp.callMCPTool('t', {}, { mcpURL: 'plugin:t' })).toEqual([{ type: 'text', text: 'plugin-ran' }])
    })
})
