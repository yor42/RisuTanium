/**
 * A call the user makes on purpose from the Playground runs without an approval, whatever the tool's class,
 * and reaches exactly the client of the URL it names. Drives the real `mcp.ts` with a stub client and a stub
 * approver.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
    created: [] as string[],
    calls: [] as string[],
    approvals: 0,
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
    askToolApproval: vi.fn(async () => { h.approvals++; return 'deny' }),
}))
vi.mock('../filesystemclient', () => ({
    FileSystemClient: class {
        url = 'internal:fs'
        serverInfo = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fs', version: '1' } }
        constructor() { h.created.push('internal:fs') }
        async checkHandshake() { return this.serverInfo }
        async getToolList() { return [] }
        async callTool(name: string) { h.calls.push(`internal:fs#${name}`); return [{ type: 'text', text: `fs-ran:${name}` }] }
        destroy() {}
    },
}))

let mcp: typeof import('../mcp')

beforeEach(async () => {
    vi.resetModules()
    h.created.length = 0
    h.calls.length = 0
    h.approvals = 0
    mcp = await import('../mcp')
}, 60_000)

describe('callMCPToolByUser', () => {
    test('runs a mutating tool without asking, even where the model-driven path would be denied', async () => {
        const byUser = await mcp.callMCPToolByUser('internal:fs', 'fs_write_file', { path: 'a.txt', content: 'x' })

        expect(h.approvals).toBe(0)
        expect(byUser).toEqual([{ type: 'text', text: 'fs-ran:fs_write_file' }])
        expect(h.calls).toEqual(['internal:fs#fs_write_file'])

        const modelDriven = await mcp.callMCPTool('fs_write_file', { path: 'a.txt', content: 'x' }, { mcpURL: 'internal:fs' })

        expect(h.approvals).toBe(1)
        expect(modelDriven).toEqual([{ type: 'text', text: 'Denied by the user: fs_write_file' }])
        expect(h.calls).toEqual(['internal:fs#fs_write_file'])
    })

    test('reaches only the client of the URL it names', async () => {
        const result = await mcp.callMCPToolByUser('https://nowhere.invalid/mcp', 'fs_write_file', {})

        expect(h.created).toEqual([])
        expect(result).toEqual([{ type: 'text', text: 'Tool fs_write_file not found on any MCP' }])
    })
})
