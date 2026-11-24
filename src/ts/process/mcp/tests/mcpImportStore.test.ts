// @vitest-environment happy-dom
/**
 * The module `importMCPModule` stores for an in-app server. The module list and the Studio module list show it by
 * its name and description as text, so the stored shape is pinned: the server's name, the `MCP from <url>` description,
 * the `mcp.url`, a fresh id and the one always-active `@@mcp` lorebook entry; nothing is enabled.
 *
 * Compatibility guard (T9-MCP-STORE): it passes before and after. Drives the REAL `importMCPModule`, `getMCPMeta` and
 * the real `internal:dice` client. MOCKED: the alert (the prompt answers `internal:dice`), the database, the module
 * list reads and the network client class.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    alertInput: vi.fn(),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    db: { modules: [] as unknown[], enabledModules: [] as string[] },
}))

vi.mock('uuid', () => ({ v4: () => 'fresh-id' }))
vi.mock('src/ts/alert', () => ({
    alertInput: h.alertInput,
    alertError: h.alertError,
    alertNormal: h.alertNormal,
}))
vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: vi.fn(() => h.db) }))
vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: {} } }))
vi.mock('src/ts/process/modules', () => ({ getModuleMcpEntries: vi.fn(() => []), getModuleMcps: vi.fn(() => []) }))
vi.mock('src/ts/process/mcp/stdioApproval', () => ({ admitStdio: vi.fn() }))
vi.mock('src/ts/process/mcp/pluginmcp', () => ({ registeredCustomPluginMCPs: new Map() }))
vi.mock('src/ts/util', () => ({ sleep: vi.fn(async () => {}) }))
vi.mock('src/ts/process/mcp/mcplib', () => ({ MCPClient: class {} }))

import { importMCPModule } from 'src/ts/process/mcp/mcp'

beforeEach(() => {
    h.alertInput.mockReset()
    h.alertError.mockReset()
    h.alertNormal.mockReset()
    h.db.modules = []
    h.db.enabledModules = []
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('importMCPModule stores one module', () => {
    test('guard: internal:dice gives exactly the fields the lists show, one @@mcp lorebook entry and no enabled module', async () => {
        h.alertInput.mockResolvedValue('internal:dice')

        await importMCPModule()

        expect(h.alertError).not.toHaveBeenCalled()
        expect(h.db.modules).toHaveLength(1)
        const stored = h.db.modules[0] as Record<string, unknown>
        expect(Object.keys(stored).sort()).toEqual(['description', 'id', 'lorebook', 'mcp', 'name'])
        expect(stored.name).toBe('Dice')
        expect(stored.description).toBe('MCP from internal:dice')
        expect(stored.mcp).toEqual({ url: 'internal:dice' })
        expect(stored.id).toBe('fresh-id')
        const lorebook = stored.lorebook as { content: string, alwaysActive: boolean }[]
        expect(lorebook).toHaveLength(1)
        expect(lorebook[0].alwaysActive).toBe(true)
        expect(lorebook[0].content.startsWith('@@mcp\n\n<MCP Info>Name:Dice\nVersion:1.0.0\nInst:')).toBe(true)
        expect(h.db.enabledModules).toEqual([])
        expect(h.alertNormal).toHaveBeenCalledTimes(1)
    })
})
