/**
 * Every tool of every built-in client is classified by the app's own table, and an unclassified or
 * non-built-in name is never `read` or `free`. Drives the real clients' tool lists.
 */
import { describe, test, expect, vi } from 'vitest'
import '../../../polyfill'
import { classifiedInternalUrls, classifyTool, isToolClassified } from '../toolPermission'
import type { MCPTool } from '../mcplib'

vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) } }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))
vi.mock('dompurify', () => ({ default: { addHook: vi.fn(), sanitize: (html: string) => html } }))
vi.mock('../../../storage/characterSaveMarks', () => ({ markCharacterForSave: () => {} }))
vi.mock('../../../stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: {} }, CharEmotion: writable({}), selectedCharID: writable(-1), selIdState: { selId: 0 },
        CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
        HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''),
    }
})

type ToolSource = { getToolList(): Promise<MCPTool[]> }

async function realClients(): Promise<Record<string, ToolSource>> {
    const { RisuAccessClient } = await import('../risuaccess')
    const { FileSystemClient } = await import('../filesystemclient')
    const { AIAccessClient } = await import('../aiaccess')
    const { GoogleSearchClient } = await import('../googlesearchclient')
    const { GraphMemClient } = await import('../graphmem')
    const { DiceClient } = await import('../dice')
    const { WORKSPACE_TOOLS } = await import('../workspaceclient')
    return {
        // The workspace client lists no tools itself; the run advertises this constant.
        'internal:workspace': { getToolList: async () => [...WORKSPACE_TOOLS] },
        'internal:risuai': new RisuAccessClient(),
        'internal:fs': new FileSystemClient(),
        'internal:aiaccess': new AIAccessClient(),
        'internal:googlesearch': new GoogleSearchClient(),
        'internal:graphmem': new GraphMemClient(),
        'internal:dice': new DiceClient(),
    }
}

describe('the tool classification table', () => {
    test('every tool a built-in client lists is classified', async () => {
        const clients = await realClients()
        const unclassified: string[] = []
        let listed = 0
        for(const [url, client] of Object.entries(clients)) {
            for(const tool of await client.getToolList()) {
                listed++
                if(!isToolClassified(url, tool.name)) {
                    unclassified.push(`${url}#${tool.name}`)
                }
            }
        }
        expect(listed).toBeGreaterThan(40)
        expect(unclassified).toEqual([])
    })

    test('every table row names a tool its client lists', async () => {
        const clients = await realClients()
        for(const [url, client] of Object.entries(clients)) {
            const names = new Set((await client.getToolList()).map(tool => tool.name))
            expect(names.size).toBeGreaterThan(0)
            expect(classifiedInternalUrls()).toContain(url)
            for(const name of names) {
                expect(['read', 'free', 'mutating']).toContain(classifyTool(url, name))
            }
        }
    })

    test('the mutating tools are the risuaccess setters and deleters, the fs writers and writeMemory', () => {
        const setters = [
            'risu-set-character-info', 'risu-set-character-lorebook', 'risu-delete-character-lorebook',
            'risu-set-character-regex-scripts', 'risu-delete-character-regex-scripts',
            'risu-delete-character-additional-assets', 'risu-set-character-lua-script',
            'risu-set-module-info', 'risu-set-module-lorebook', 'risu-delete-module-lorebook',
            'risu-set-module-regex-script', 'risu-delete-module-regex-script', 'risu-set-module-lua-script',
        ]
        for(const name of setters) {
            expect(classifyTool('internal:risuai', name)).toBe('mutating')
        }
        for(const name of ['fs_write_file', 'fs_create_directory', 'fs_delete_file', 'fs_copy_file', 'fs_move_file']) {
            expect(classifyTool('internal:fs', name)).toBe('mutating')
        }
        expect(classifyTool('internal:graphmem', 'writeMemory')).toBe('mutating')
        expect(classifyTool('internal:graphmem', 'readMemory')).toBe('read')
    })

    test('the workspace reads are read and every workspace writer is mutating', () => {
        for(const name of ['list_files', 'read_file', 'search_files']) {
            expect(classifyTool('internal:workspace', name)).toBe('read')
        }
        for(const name of ['write_file', 'edit_file', 'delete_file', 'move_file']) {
            expect(classifyTool('internal:workspace', name)).toBe('mutating')
        }
    })

    test('runLLM, search and dice are free; reads are read', () => {
        expect(classifyTool('internal:aiaccess', 'runLLM')).toBe('free')
        expect(classifyTool('internal:googlesearch', 'google_search')).toBe('free')
        expect(classifyTool('internal:dice', 'rollDice')).toBe('free')
        expect(classifyTool('internal:fs', 'fs_read_file')).toBe('read')
        expect(classifyTool('internal:risuai', 'risu-list-characters')).toBe('read')
    })

    test('an unlisted internal tool is mutating, and a tool of another client keeps its own class', () => {
        expect(classifyTool('internal:fs', 'fs_new_tool')).toBe('mutating')
        expect(classifyTool('internal:unknown', 'anything')).toBe('mutating')
        expect(classifyTool('internal:dice', 'fs_read_file')).toBe('mutating')
        expect(classifyTool('internal:workspace', 'anything')).toBe('mutating')
    })

    test('a server outside the built-ins is third-party whatever its tool is called', () => {
        for(const url of ['https://x.test/mcp', 'plugin:p1', 'stdio:{"command":"x"}', 'http://localhost:1/sse']) {
            expect(classifyTool(url, 'fs_read_file')).toBe('third-party')
            expect(classifyTool(url, 'rollDice')).toBe('third-party')
        }
    })
})
