/**
 * A model-driven tool call is decided at the `callMCPTool` entry, before any client is looked up or started.
 * Drives the real `mcp.ts` and the real gate with stub clients and a stub approver; no module set is
 * selected, so a call reaches only the URL it names. Nothing here says anything about a native backend.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { language } from 'src/lang'
import { fillLang } from 'src/lang/fill'
import { newToolLoop, advertisedToolKey, type ToolStep } from '../../request/toolLoop'

const h = vi.hoisted(() => ({
    /** Every client built, by URL. */
    created: [] as string[],
    destroyed: [] as string[],
    /** Every tool call a client received, as `url#name`. */
    calls: [] as string[],
    /** Every stdio admission asked for. */
    admissions: 0,
    /** What the approver answers; a function may hold the answer back. */
    answer: (async () => 'once') as () => Promise<'once' | 'deny'>,
    /** Runs while a client is being ensured, before its first call. */
    onEnsure: (() => {}) as () => void,
    approvals: [] as Array<{ tool: string, url: string, kind: string, summary: string }>,
}))

vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) } }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('@tauri-apps/plugin-shell', () => ({ Command: { create: () => { throw new Error('no program may start in this file') } } }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))
vi.mock('dompurify', () => ({ default: { addHook: vi.fn(), sanitize: (html: string) => html } }))
vi.mock('../../../platform',() => ({ isTauri: true, isNodeServer: false }))
vi.mock('../../../storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../storage/tauriByteTransport')>()),
    isAndroidTransport: () => false,
}))
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
vi.mock('../../modules', () => ({ getModuleMcpEntries: () => [], getModuleMcps: () => [] }))
vi.mock('../../../util', () => ({ sleep: async () => {} }))
vi.mock('../mcplib',() => ({ MCPClient: class {} }))
vi.mock('../stdioApproval', () => ({ admitStdio: vi.fn(async () => { h.admissions++; return false }) }))
vi.mock('../toolApproval', () => ({
    TOOL_SUMMARY_LIMIT: 800,
    askToolApproval: vi.fn(async (request: { tool: string, url: string, kind: string, summary: string }) => {
        h.approvals.push(request)
        return await h.answer()
    }),
}))
vi.mock('../toolGrants', () => ({
    hasToolGrant: vi.fn(async () => false),
    addToolGrant: vi.fn(async () => true),
    toolGrantsOffered: () => true,
}))
vi.mock('../filesystemclient', () => ({
    FileSystemClient: class {
        url = 'internal:fs'
        serverInfo = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fs', version: '1' } }
        constructor() { h.created.push('internal:fs') }
        async checkHandshake() { h.onEnsure(); return this.serverInfo }
        async getToolList() { return [] }
        async callTool(name: string) { h.calls.push(`internal:fs#${name}`); return [{ type: 'text', text: `fs-ran:${name}` }] }
        destroy() { h.destroyed.push('internal:fs') }
    },
}))
vi.mock('../pluginmcp', () => {
    const client = {
        url: 'plugin:p1',
        serverInfo: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'p', version: '1' } },
        async checkHandshake() { h.created.push('plugin:p1'); return client.serverInfo },
        async getToolList() { return [{ name: 'plug_tool', description: '', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }] },
        async callTool(name: string) { h.calls.push(`plugin:p1#${name}`); return [{ type: 'text', text: `plug-ran:${name}` }] },
        destroy() { h.destroyed.push('plugin:p1') },
    }
    return { registeredCustomPluginMCPs: new Map([['plugin:p1', client]]) }
})

const STDIO_URL = 'stdio:{"command":"npx","args":["-y","@x/server"]}'

let mcp: typeof import('../mcp')

beforeEach(async () => {
    vi.resetModules()
    h.created.length = 0
    h.destroyed.length = 0
    h.calls.length = 0
    h.approvals.length = 0
    h.admissions = 0
    h.onEnsure = () => {}
    h.answer = async () => 'once'
    mcp = await import('../mcp')
})

afterEach(() => {
    vi.useRealTimers()
})

const textOf = (content: Array<{ type: string, text?: string }>) => content.map(c => c.text ?? '').join('|')

describe('a mutating built-in tool', () => {
    test('prompts once, then runs when the user allows it', async () => {
        const result = await mcp.callMCPTool('fs_write_file', { path: 'a.txt', content: 'x' }, { mcpURL: 'internal:fs' })

        expect(h.approvals).toHaveLength(1)
        expect(h.approvals[0]).toMatchObject({ tool: 'fs_write_file', url: 'internal:fs', kind: 'mutating' })
        expect(h.approvals[0].summary).toContain('a.txt')
        expect(textOf(result)).toBe('fs-ran:fs_write_file')
        expect(h.calls).toEqual(['internal:fs#fs_write_file'])
    })

    test('a denied call starts no client and calls nothing', async () => {
        h.answer = async () => 'deny'

        const result = await mcp.callMCPTool('fs_write_file', { path: 'a.txt', content: 'x' }, { mcpURL: 'internal:fs' })

        expect(textOf(result)).toBe('Denied by the user: fs_write_file')
        expect(h.created).toEqual([])
        expect(h.calls).toEqual([])
    })

    test('a denied stdio call asks no program admission and starts no program', async () => {
        h.answer = async () => 'deny'

        const result = await mcp.callMCPTool('anything', {}, { mcpURL: STDIO_URL })

        expect(textOf(result)).toBe('Denied by the user: anything')
        expect(h.approvals[0]).toMatchObject({ kind: 'third-party', url: STDIO_URL })
        expect(h.admissions).toBe(0)
    })

    test('an approval that arrives after the client was swept still reaches a live client', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
        await mcp.callMCPTool('fs_read_file', { path: 'a.txt' }, { mcpURL: 'internal:fs' })
        expect(h.created).toEqual(['internal:fs'])

        let release!: () => void
        h.answer = () => new Promise<'once'>(resolve => { release = () => resolve('once') })
        const pending = mcp.callMCPTool('fs_write_file', { path: 'a.txt', content: 'x' }, { mcpURL: 'internal:fs' })
        await vi.waitFor(() => { expect(h.approvals).toHaveLength(1) })

        vi.setSystemTime(new Date('2026-01-01T01:00:00Z'))
        await mcp.initializeMCPs()
        expect(h.destroyed).toEqual(['internal:fs'])
        release()
        const result = await pending

        expect(textOf(result)).toBe('fs-ran:fs_write_file')
        expect(h.created).toEqual(['internal:fs', 'internal:fs'])
    })
})

describe('a read or free tool', () => {
    test('never prompts', async () => {
        const result = await mcp.callMCPTool('fs_read_file', { path: 'a.txt' }, { mcpURL: 'internal:fs' })

        expect(h.approvals).toEqual([])
        expect(textOf(result)).toBe('fs-ran:fs_read_file')
    })
})

describe('a third-party tool', () => {
    test('prompts although the server marks the tool read-only', async () => {
        const result = await mcp.callMCPTool('plug_tool', { a: 1 }, { mcpURL: 'plugin:p1' })

        expect(h.approvals).toHaveLength(1)
        expect(h.approvals[0]).toMatchObject({ tool: 'plug_tool', url: 'plugin:p1', kind: 'third-party' })
        expect(textOf(result)).toBe('plug-ran:plug_tool')
    })
})

describe('refusals decided before any prompt', () => {
    test('a call with no routing URL is refused: nothing asked, nothing started', async () => {
        const result = await mcp.callMCPTool('fs_write_file', { path: 'a.txt', content: 'x' })

        expect(textOf(result)).toContain('without a server')
        expect(h.approvals).toEqual([])
        expect(h.created).toEqual([])
    })

    test('a call outside the run\'s advertised set is refused, whatever its class', async () => {
        const toolLoop = newToolLoop(null)
        toolLoop.advertised = new Set([advertisedToolKey('fs_read_file', 'internal:fs')])

        const result = await mcp.callMCPTool('fs_write_file', { path: 'a.txt', content: 'x' }, { mcpURL: 'internal:fs', toolLoop })
        const other = await mcp.callMCPTool('fs_write_file', { path: 'a.txt', content: 'x' }, { mcpURL: 'plugin:p1', toolLoop })

        expect(textOf(result)).toBe('Tool fs_write_file is not available.')
        expect(textOf(other)).toBe('Tool fs_write_file is not available.')
        expect(h.approvals).toEqual([])
        expect(h.created).toEqual([])
    })

    test('a call inside the advertised set goes through the normal decision', async () => {
        const toolLoop = newToolLoop(null)
        toolLoop.advertised = new Set([advertisedToolKey('fs_write_file', 'internal:fs')])

        await mcp.callMCPTool('fs_write_file', { path: 'a.txt', content: 'x' }, { mcpURL: 'internal:fs', toolLoop })

        expect(h.approvals).toHaveLength(1)
        expect(h.calls).toEqual(['internal:fs#fs_write_file'])
    })

    test('a run that advertised nothing is not refused for it', async () => {
        const toolLoop = newToolLoop(null)

        await mcp.callMCPTool('fs_read_file', { path: 'a.txt' }, { mcpURL: 'internal:fs', toolLoop })

        expect(h.calls).toEqual(['internal:fs#fs_read_file'])
    })

    test('a workspace tool without a bound workspace is refused before any prompt', async () => {
        const result = await mcp.callMCPTool('workspace_write', { path: 'a.md' }, { mcpURL: 'internal:workspace', toolLoop: newToolLoop(null) })

        expect(textOf(result)).toBe('Tool workspace_write is not available.')
        expect(h.approvals).toEqual([])
        expect(h.created).toEqual([])
    })

    test('a workspace tool with a bound workspace is decided like any internal tool', async () => {
        h.answer = async () => 'deny'
        const toolLoop = newToolLoop(null)
        toolLoop.workspace = { id: 'ws-1' }

        const result = await mcp.callMCPTool('workspace_write', { path: 'a.md' }, { mcpURL: 'internal:workspace', toolLoop })

        expect(h.approvals).toHaveLength(1)
        expect(textOf(result)).toBe('Denied by the user: workspace_write')
    })

    test('a workspace writer prompt leads with the file it changes, even behind a long text', async () => {
        h.answer = async () => 'deny'
        const toolLoop = newToolLoop(null)
        toolLoop.workspace = { id: 'ws-1' }
        const text = 'x'.repeat(5000)

        await mcp.callMCPTool('write_file', { text, path: 'notes/a.md' }, { mcpURL: 'internal:workspace', toolLoop })
        await mcp.callMCPTool('move_file', { from: 'a.md', to: 'b.md' }, { mcpURL: 'internal:workspace', toolLoop })
        await mcp.callMCPTool('delete_file', { path: 'a.md' }, { mcpURL: 'internal:workspace', toolLoop })

        expect(h.approvals.map(a => a.kind)).toEqual(['mutating', 'mutating', 'mutating'])
        expect(h.approvals[0].summary.startsWith(`${fillLang(language.toolApprovalActionWriteFile, { path: 'notes/a.md' })}: write_file(`)).toBe(true)
        expect(h.approvals[1].summary.startsWith(fillLang(language.toolApprovalActionMoveFile, { from: 'a.md', to: 'b.md' }))).toBe(true)
        expect(h.approvals[2].summary).toContain(fillLang(language.toolApprovalActionDeleteFile, { path: 'a.md' }))
    })

    test('a move that overwrites names the file it deletes first, even behind a very long from path', async () => {
        h.answer = async () => 'deny'
        const toolLoop = newToolLoop(null)
        toolLoop.workspace = { id: 'ws-1' }
        const from = `${Array.from({ length: 8 }, () => 'd'.repeat(101)).join('/')}/x.md`

        await mcp.callMCPTool('move_file', { from, to: 'AGENTS.md', overwrite: true }, { mcpURL: 'internal:workspace', toolLoop })
        await mcp.callMCPTool('move_file', { from: 'a.md', to: 'b.md', overwrite: true }, { mcpURL: 'internal:workspace', toolLoop })
        await mcp.callMCPTool('move_file', { from: 'a.md', to: 'b.md' }, { mcpURL: 'internal:workspace', toolLoop })

        const [long, short, plain] = h.approvals.map(a => a.summary)
        expect(long.length).toBeLessThanOrEqual(803)
        expect(long.startsWith(fillLang(language.toolApprovalActionMoveOverwrite, { to: 'AGENTS.md', from: from.slice(0, 5) }).split(from.slice(0, 5))[0])).toBe(true)
        expect(long.indexOf('(AGENTS.md)')).toBeLessThan(long.indexOf('ddddd'))
        expect(long).toContain('x.md')
        expect(short.startsWith(fillLang(language.toolApprovalActionMoveOverwrite, { to: 'b.md', from: 'a.md' }))).toBe(true)
        expect(plain).toBe(`${fillLang(language.toolApprovalActionMoveFile, { from: 'a.md', to: 'b.md' })}: move_file({"from":"a.md","to":"b.md"})`)
    })

    test('a truthy non-boolean overwrite gets no delete warning, matching the tool, which refuses it', async () => {
        h.answer = async () => 'deny'
        const toolLoop = newToolLoop(null)
        toolLoop.workspace = { id: 'ws-1' }

        await mcp.callMCPTool('move_file', { from: 'a.md', to: 'b.md', overwrite: 'true' }, { mcpURL: 'internal:workspace', toolLoop })

        expect(h.approvals[0].summary.startsWith(fillLang(language.toolApprovalActionMoveFile, { from: 'a.md', to: 'b.md' }))).toBe(true)
    })

    test('a long path in an action line keeps its start and its file name', async () => {
        h.answer = async () => 'deny'
        const toolLoop = newToolLoop(null)
        toolLoop.workspace = { id: 'ws-1' }
        const path = `start/${'m'.repeat(500)}/end.md`

        await mcp.callMCPTool('delete_file', { path }, { mcpURL: 'internal:workspace', toolLoop })

        const [head, tail] = fillLang(language.toolApprovalActionDeleteFile, { path: '\u0000' }).split('\u0000')
        expect(h.approvals[0].summary.startsWith(`${head}start/`)).toBe(true)
        expect(h.approvals[0].summary).toContain(`/end.md${tail}`)
    })

    test('the template text comes from the language keys, so a translated line is used as it is', async () => {
        h.answer = async () => 'deny'
        const toolLoop = newToolLoop(null)
        toolLoop.workspace = { id: 'ws-1' }
        const { language: live } = await import('src/lang')
        const saved = live.toolApprovalActionDeleteFile
        live.toolApprovalActionDeleteFile = 'LOCALIZED {path} END'
        try {
            await mcp.callMCPTool('delete_file', { path: 'a.md' }, { mcpURL: 'internal:workspace', toolLoop })
        } finally {
            live.toolApprovalActionDeleteFile = saved
        }

        expect(h.approvals[0].summary.startsWith('LOCALIZED a.md END: delete_file(')).toBe(true)
    })

    test('a path with a bidi control in an action line is shown escaped', async () => {
        h.answer = async () => 'deny'
        const toolLoop = newToolLoop(null)
        toolLoop.workspace = { id: 'ws-1' }

        await mcp.callMCPTool('delete_file', { path: 'a\u202Eb.md' }, { mcpURL: 'internal:workspace', toolLoop })

        expect(h.approvals[0].summary).toContain('a\\u202eb.md')
        expect(h.approvals[0].summary).not.toContain('\u202E')
    })

    test('a workspace read runs without a prompt and a workspace writer in the same run prompts', async () => {
        const toolLoop = newToolLoop(null)
        toolLoop.workspace = { id: 'ws-1' }

        await mcp.callMCPTool('read_file', { path: 'a.md' }, { mcpURL: 'internal:workspace', toolLoop })
        expect(h.approvals).toEqual([])
        await mcp.callMCPTool('edit_file', { path: 'a.md', old_text: 'a', new_text: 'b' }, { mcpURL: 'internal:workspace', toolLoop })
        expect(h.approvals).toHaveLength(1)
    })
})

describe('Stop', () => {
    test('a run stopped while the question was open runs nothing, even when the user allowed it', async () => {
        const controller = new AbortController()
        h.answer = async () => { controller.abort(); return 'once' }

        const result = await mcp.callMCPTool('fs_write_file', { path: 'a.txt', content: 'x' }, { mcpURL: 'internal:fs', toolLoop: newToolLoop(controller.signal) })

        expect(textOf(result)).toContain('Stopped')
        expect(h.created).toEqual([])
        expect(h.calls).toEqual([])
    })

    test('the run\'s Stop signal is handed to the approver, so a pending question can be withdrawn', async () => {
        const { askToolApproval } = await import('../toolApproval')
        const controller = new AbortController()

        await mcp.callMCPTool('fs_write_file', { path: 'a.txt', content: 'x' }, { mcpURL: 'internal:fs', toolLoop: newToolLoop(controller.signal) })

        expect(vi.mocked(askToolApproval).mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({ signal: controller.signal }))
    })

    test('a Stop that lands while the client is being ensured dispatches nothing', async () => {
        const controller = new AbortController()
        const toolLoop = newToolLoop(controller.signal)
        h.onEnsure = () => controller.abort()

        const result = await mcp.callMCPTool('fs_write_file', { path: 'a.txt', content: 'x' }, { mcpURL: 'internal:fs', toolLoop })

        expect(textOf(result)).toContain('Stopped')
        expect(h.calls).toEqual([])
    })

    test('a run already stopped asks nothing', async () => {
        const controller = new AbortController()
        controller.abort()

        const result = await mcp.callMCPTool('fs_write_file', { path: 'a.txt', content: 'x' }, { mcpURL: 'internal:fs', toolLoop: newToolLoop(controller.signal) })

        expect(textOf(result)).toContain('Stopped')
        expect(h.approvals).toEqual([])
        expect(h.created).toEqual([])
    })
})

describe('step events', () => {
    function stepLoop(controller?: AbortController) {
        const steps: ToolStep[] = []
        const toolLoop = newToolLoop(controller?.signal ?? null)
        toolLoop.workspace = { id: 'ws-1' }
        toolLoop.onStep = (step) => { steps.push(step) }
        return { steps, toolLoop }
    }
    const WS = 'internal:workspace'

    test('a read, a denied write and an unadvertised call each give one step with their outcome', async () => {
        const { steps, toolLoop } = stepLoop()
        toolLoop.advertised = new Set([advertisedToolKey('read_file', WS), advertisedToolKey('delete_file', WS)])
        h.answer = async () => 'deny'

        await mcp.callMCPTool('read_file', { path: 'a.md' }, { mcpURL: WS, toolLoop })
        await mcp.callMCPTool('delete_file', { path: 'b.md' }, { mcpURL: WS, toolLoop })
        await mcp.callMCPTool('write_file', { path: 'c.md', text: 'x' }, { mcpURL: WS, toolLoop })

        expect(steps).toEqual([
            // The bound workspace has no stored files here, so the real workspace client answers with a failure.
            { name: 'read_file', summary: 'a.md', outcome: 'error' },
            { name: 'delete_file', summary: 'b.md', outcome: 'denied' },
            { name: 'write_file', summary: 'c.md', outcome: 'refused' },
        ])
    })

    test('a call without a server and a workspace tool without a workspace are refused steps', async () => {
        const { steps, toolLoop } = stepLoop()
        delete toolLoop.workspace

        await mcp.callMCPTool('read_file', { path: 'a.md' }, { mcpURL: WS, toolLoop })
        await mcp.callMCPTool('read_file', { path: 'a.md' }, { toolLoop })

        expect(steps.map(step => step.outcome)).toEqual(['refused', 'refused'])
    })

    test('a run stopped before or during the question gives stopped steps', async () => {
        const during = new AbortController()
        const first = stepLoop(during)
        h.answer = async () => { during.abort(); return 'once' }
        await mcp.callMCPTool('delete_file', { path: 'a.md' }, { mcpURL: WS, toolLoop: first.toolLoop })

        const before = new AbortController()
        before.abort()
        const second = stepLoop(before)
        await mcp.callMCPTool('delete_file', { path: 'a.md' }, { mcpURL: WS, toolLoop: second.toolLoop })

        expect(first.steps.map(step => step.outcome)).toEqual(['stopped'])
        expect(second.steps.map(step => step.outcome)).toEqual(['stopped'])
    })

    test('an approved write that the workspace client fails is one error step', async () => {
        const { steps, toolLoop } = stepLoop()

        await mcp.callMCPTool('write_file', { path: 'a.md', text: 'x' }, { mcpURL: WS, toolLoop })

        expect(steps).toEqual([{ name: 'write_file', summary: 'a.md', outcome: 'error' }])
    })

    test('a decision that throws gives an error step and the error still reaches the caller', async () => {
        const { steps, toolLoop } = stepLoop()
        h.answer = async () => { throw new Error('approver down') }

        await expect(mcp.callMCPTool('write_file', { path: 'a.md', text: 'x' }, { mcpURL: WS, toolLoop })).rejects.toThrow('approver down')

        expect(steps).toEqual([{ name: 'write_file', summary: 'a.md', outcome: 'error' }])
    })

    test('a hook that throws changes nothing about the answer', async () => {
        const { toolLoop } = stepLoop()
        toolLoop.onStep = () => { throw new Error('hook bug') }
        h.answer = async () => 'deny'

        const result = await mcp.callMCPTool('delete_file', { path: 'a.md' }, { mcpURL: WS, toolLoop })

        expect(textOf(result)).toBe('Denied by the user: delete_file')
    })
})