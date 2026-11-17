// @vitest-environment happy-dom
/**
 * `importMCPModule` asks for a module URL. Its cancel is a value no text field produces, and the
 * function returns before it reads the module, so a cancelled prompt never reaches a URL check,
 * a network request or a module write.
 *
 * Drives the REAL `importMCPModule`. MOCKED: the alert (the prompt answers with the cancel its caller
 * offered, and rejects when none was offered), the module list and the MCP client, which count calls.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    alertInput: vi.fn(),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    getMCPMeta: vi.fn(),
}))

vi.mock('src/ts/alert', () => ({
    alertInput: h.alertInput,
    alertError: h.alertError,
    alertNormal: h.alertNormal,
}))
vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: vi.fn(() => ({ modules: [] })) }))
vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: {} } }))
vi.mock('src/ts/process/modules', () => ({ getModuleMcpEntries: vi.fn(() => []), getModuleMcps: vi.fn(() => []) }))
vi.mock('src/ts/process/mcp/stdioApproval', () => ({ admitStdio: vi.fn() }))
vi.mock('src/ts/process/mcp/pluginmcp', () => ({ registeredCustomPluginMCPs: [] }))
vi.mock('src/ts/util', () => ({ sleep: vi.fn(async () => {}) }))
vi.mock('src/ts/process/mcp/mcplib', () => ({
    MCPClient: class {
        constructor() {
            h.getMCPMeta()
        }
    },
}))

import { importMCPModule } from 'src/ts/process/mcp/mcp'

beforeEach(() => {
    h.alertInput.mockReset()
    h.alertError.mockReset()
    h.alertNormal.mockReset()
    h.getMCPMeta.mockReset()
})

describe('importMCPModule', () => {
    test('answering the offered cancel ends the import: no error, no client, no module', async () => {
        h.alertInput.mockImplementation(async (_msg: string, _list?: unknown, _value?: string, options?: { cancel?: string }) => {
            return options?.cancel ?? Promise.reject(new Error('no cancel offered'))
        })

        await importMCPModule()

        expect(h.alertInput).toHaveBeenCalledTimes(1)
        expect(h.alertError).not.toHaveBeenCalled()
        expect(h.alertNormal).not.toHaveBeenCalled()
        expect(h.getMCPMeta).not.toHaveBeenCalled()
    })

    test('guard: a typed address that is not a URL still says it is invalid', async () => {
        h.alertInput.mockResolvedValue('not-a-url')

        await importMCPModule()

        expect(h.alertError).toHaveBeenCalledTimes(1)
        expect(h.getMCPMeta).not.toHaveBeenCalled()
    })
})
